/**
 * The live map's navigation maths: coordinates, fixes, the flight plan and
 * the steering the autopilot's NAV mode follows. Pure — no DOM, no three.js —
 * so tests/features/livemap.mjs runs all of it in node.
 *
 * COORDINATES. The game's world is metres: x east, z south, (0, 0) the middle
 * of the map. A real FMS talks latitude and longitude, so every map is given
 * a place on the globe (originFor: the World Map preview at N12°00' W045°00',
 * every other map somewhere of its own in a warm ocean, from its id) and the
 * mapping is a plain equirectangular one round that origin — one minute of
 * latitude is one nautical mile (1,852 m), a minute of longitude that times
 * cos(origin latitude). Exact both ways, which is what matters: a position
 * typed back in lands on the metre it was read off.
 *
 *   N12°34.5' W045°12.3'    what the map shows and the entry box takes
 *   12.575 -45.205          decimal degrees (or 12.575N 45.205W)
 *   12.3 km E 4.5 km N      the simple grid from the middle of the map
 *   HERON, XHVN, Haven      a fix, an airport code or a place by name
 *
 * FIXES. Real FMS waypoints are five-letter names. These are ORIGINAL ones
 * (FIX_NAMES, then made-up pronounceable ones), placed the way real ones
 * are: an approach fix off each end of every runway and en-route fixes on
 * the legs between neighbouring fields. Deterministic per map.
 *
 * STEERING. A leg is flown by pure pursuit: aim at a point a fixed time
 * ahead along the leg (the "carrot"). It converges on the track from either
 * side without overshoot for any turn rate the autopilot has, and it is what
 * keeps a 25-degree bank limit honest. DIRECT TO is a leg from where you are
 * now, as on a real Garmin (D→) or an Airbus MCDU (DIR).
 */

export const NM_M = 1852;
/** Metres in one degree of latitude (60 nautical miles). */
export const DEG_LAT_M = NM_M * 60;
const RAD = Math.PI / 180;
const KT = 1.94384;

/** Places on the globe for maps that want a particular one. */
const ORIGINS = Object.freeze({
  'world-preview': { lat: 12, lon: -45 },
  kestrel: { lat: 17, lon: -62 },
});

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** This map's origin, { lat, lon } in degrees (whole minutes). */
export function originFor(mapId) {
  const id = String(mapId || 'kestrel');
  if (ORIGINS[id]) return ORIGINS[id];
  const h = hash(id);
  const lat = 8 + (h % 3000) / 100; // 8°N .. 38°N
  const lon = -(20 + ((h >>> 12) % 5000) / 100); // 20°W .. 70°W
  return { lat: Math.round(lat * 60) / 60, lon: Math.round(lon * 60) / 60 };
}

/** World (x, z) → { lat, lon } in degrees. */
export function toLatLon(x, z, o) {
  return { lat: o.lat - z / DEG_LAT_M, lon: o.lon + x / (DEG_LAT_M * Math.cos(o.lat * RAD)) };
}

/** { lat, lon } in degrees → world { x, z }. */
export function fromLatLon(lat, lon, o) {
  return { x: (lon - o.lon) * DEG_LAT_M * Math.cos(o.lat * RAD), z: (o.lat - lat) * DEG_LAT_M };
}

function dm(v, degDigits) {
  const a = Math.abs(v);
  let d = Math.floor(a);
  let m = Math.round((a - d) * 600) / 10;
  if (m >= 60) {
    d += 1;
    m = 0;
  }
  return `${String(d).padStart(degDigits, '0')}°${m.toFixed(1).padStart(4, '0')}'`;
}

export function fmtLat(lat) {
  return `${lat < 0 ? 'S' : 'N'}${dm(lat, 2)}`;
}
export function fmtLon(lon) {
  return `${lon < 0 ? 'W' : 'E'}${dm(lon, 3)}`;
}
/** "N12°34.5' W045°12.3'". */
export function fmtLatLon(lat, lon) {
  return `${fmtLat(lat)} ${fmtLon(lon)}`;
}
/** A world position as the map shows it. */
export function fmtPos(x, z, o) {
  const p = toLatLon(x, z, o);
  return fmtLatLon(p.lat, p.lon);
}

/** The simple grid: kilometres east and north of the middle of the map. */
export function gridText(x, z) {
  const e = x / 1000;
  const n = -z / 1000;
  return `${Math.abs(e).toFixed(1)} km ${e < 0 ? 'W' : 'E'} · ${Math.abs(n).toFixed(1)} km ${n < 0 ? 'S' : 'N'}`;
}

const NUM = '(\\d+(?:\\.\\d+)?)';
const RE_PREFIX = new RegExp(`^([NS])\\s*${NUM}(?:\\s*[°\\s]\\s*${NUM}?\\s*'?)?\\s*[,/ ]?\\s*([EW])\\s*${NUM}(?:\\s*[°\\s]\\s*${NUM}?\\s*'?)?$`, 'i');
const RE_SUFFIX = new RegExp(`^${NUM}(?:\\s*[°\\s]\\s*${NUM}?\\s*'?)?\\s*([NS])\\s*[,/ ]?\\s*${NUM}(?:\\s*[°\\s]\\s*${NUM}?\\s*'?)?\\s*([EW])$`, 'i');
const RE_DEC = /^(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)$/;
const RE_GRID = /^(-?\d+(?:\.\d+)?)\s*km\s*([EW])\s*[,·/ ]*\s*(-?\d+(?:\.\d+)?)\s*km\s*([NS])$/i;

function degOf(d, m) {
  const D = Number(d);
  const M = m == null || m === '' ? 0 : Number(m);
  if (!Number.isFinite(D) || !Number.isFinite(M) || M >= 60) return NaN;
  // "12.575" with no minutes is decimal degrees; "12 34.5" is degrees and minutes.
  return D + M / 60;
}

/**
 * Text typed into the entry box → { x, z, how } or null. `how` says which
 * form it was read as ('latlon' | 'decimal' | 'grid'). Names (fixes,
 * airports, places) are the caller's: see `findPlace`.
 */
export function parsePosition(text, o) {
  const t = String(text || '').trim().replace(/[’′]/g, "'").replace(/[″"]/g, '').replace(/\s+/g, ' ');
  if (!t) return null;
  let lat = NaN;
  let lon = NaN;
  let how = 'latlon';
  let m = RE_PREFIX.exec(t);
  if (m) {
    lat = degOf(m[2], m[3]) * (m[1].toUpperCase() === 'S' ? -1 : 1);
    lon = degOf(m[5], m[6]) * (m[4].toUpperCase() === 'W' ? -1 : 1);
  } else if ((m = RE_SUFFIX.exec(t))) {
    lat = degOf(m[1], m[2]) * (m[3].toUpperCase() === 'S' ? -1 : 1);
    lon = degOf(m[4], m[5]) * (m[6].toUpperCase() === 'W' ? -1 : 1);
  } else if ((m = RE_DEC.exec(t))) {
    lat = Number(m[1]);
    lon = Number(m[2]);
    how = 'decimal';
  } else if ((m = RE_GRID.exec(t))) {
    const e = Number(m[1]) * (m[2].toUpperCase() === 'W' ? -1 : 1);
    const n = Number(m[3]) * (m[4].toUpperCase() === 'S' ? -1 : 1);
    if (!Number.isFinite(e) || !Number.isFinite(n) || Math.abs(e) > 2000 || Math.abs(n) > 2000) return null;
    return { x: e * 1000, z: -n * 1000, how: 'grid' };
  }
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 89 || Math.abs(lon) > 180) return null;
  const p = fromLatLon(lat, lon, o);
  // Anywhere within 2,000 km of the map is a place you could fly to; further is a typo.
  if (Math.hypot(p.x, p.z) > 2e6) return null;
  return { x: p.x, z: p.z, how };
}

/** True bearing from a to b (x east, z south), 0..360. */
export function bearingDeg(ax, az, bx, bz) {
  return ((Math.atan2(bx - ax, -(bz - az)) / RAD) + 360) % 360;
}
export function distM(ax, az, bx, bz) {
  return Math.hypot(bx - ax, bz - az);
}
/** "087°". */
export function fmtBrg(deg) {
  const d = Math.round(((deg % 360) + 360) % 360) % 360;
  return `${String(d === 0 ? 360 : d).padStart(3, '0')}°`;
}
/** Kilometres at the precision that helps at that distance. */
export function fmtKm(m) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 20000 ? 1 : 0)} km`;
}
export function fmtNm(m) {
  return `${(m / NM_M).toFixed(m < 37040 ? 1 : 0)} NM`;
}
/** Minutes to fly `m` metres at `gsKts` (a slow 120 kt when not yet moving). */
export function etaMin(m, gsKts) {
  const kts = gsKts > 40 ? gsKts : 120;
  return m / (kts / KT) / 60;
}
export function fmtEta(min) {
  if (!Number.isFinite(min)) return '—';
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(Math.round(min - h * 60)).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Fixes                                                               */
/* ------------------------------------------------------------------ */

/**
 * Original five-letter fix names (none is a real published fix that this
 * project knows of; they are sea and shore words bent to five letters).
 */
export const FIX_NAMES = Object.freeze([
  'HERON', 'SKUAH', 'GANNT', 'PETRL', 'FULMR', 'KITTI', 'TERNA', 'OSPRA', 'MERLN', 'PLOVR',
  'AVOCT', 'EGRTT', 'CRAKE', 'GREBY', 'BRANT', 'DUNLN', 'KNOTT', 'SANDR', 'WHIMB', 'CURLW',
  'SNIPA', 'SHAGG', 'AUKLA', 'MURRA', 'LOONA', 'SCOTR', 'EIDRA', 'SMEWE', 'RAZRB', 'GUILM',
  'COVEY', 'REEFS', 'SHOAL', 'SWELL', 'BRINE', 'CORAL', 'DRIFT', 'KELPY', 'LAGNA', 'TIDAL',
  'BREAM', 'MULET', 'SPRAT', 'WRASS', 'GURNA', 'POLLK', 'HADDO', 'SKATE', 'BASKR', 'ORCAS',
]);

const CONS = 'BCDFGKLMNPRSTVWZ';
const VOWS = 'AEIOU';

/** A made-up pronounceable five-letter name (CVCVC), for maps that need more than the list. */
export function madeUpFix(seed) {
  let h = hash(`fix${seed}`);
  const c = () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507) >>> 0;
    return CONS[h % CONS.length];
  };
  const v = () => {
    h = Math.imul(h ^ (h >>> 13), 3266489909) >>> 0;
    return VOWS[h % VOWS.length];
  };
  return `${c()}${v()}${c()}${v()}${c()}`;
}

/**
 * The fixes for a map: an approach fix 12 km off each end of every field's
 * runway, and en-route fixes on the leg from each field to its two nearest
 * neighbours (more than 40 km apart: the middle; longer, at thirds). Fixes
 * closer than 6 km to one already placed are dropped. Names are assigned in
 * a fixed order, so the same map always has the same fixes.
 *
 * @param {string} mapId
 * @param {Array<{id, x, z, hdg?}>} fields
 * @returns {Array<{id, name, x, z, kind: 'fix', role: 'approach' | 'enroute', field?}>}
 */
export function makeFixes(mapId, fields, opts = {}) {
  const out = [];
  const minGap = opts.minGap || 6000;
  const near = (x, z) => out.some((f) => Math.hypot(f.x - x, f.z - z) < minGap) || fields.some((f) => Math.hypot(f.x - x, f.z - z) < 4000);
  const add = (x, z, role, field) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || near(x, z)) return;
    out.push({ x: Math.round(x), z: Math.round(z), role, field: field || null });
  };
  const list = fields.filter((f) => f && Number.isFinite(f.x) && Number.isFinite(f.z));
  for (const f of list) {
    const h = ((f.hdg ?? 90) * RAD);
    const ux = Math.sin(h);
    const uz = -Math.cos(h);
    const out12 = (f.halfLen || 1000) + 12000;
    add(f.x - ux * out12, f.z - uz * out12, 'approach', f.id);
    add(f.x + ux * out12, f.z + uz * out12, 'approach', f.id);
  }
  if (list.length > 1) {
    for (const f of list) {
      const others = list.filter((g) => g !== f).sort((a, b) => Math.hypot(a.x - f.x, a.z - f.z) - Math.hypot(b.x - f.x, b.z - f.z)).slice(0, 2);
      for (const g of others) {
        const d = Math.hypot(g.x - f.x, g.z - f.z);
        if (d < 40000) continue;
        const parts = d > 120000 ? [1 / 3, 2 / 3] : [0.5];
        for (const t of parts) add(f.x + (g.x - f.x) * t, f.z + (g.z - f.z) * t, 'enroute', null);
      }
    }
  }
  // Names, in a fixed order (west to east, then north to south) so they never shuffle.
  out.sort((a, b) => a.x - b.x || a.z - b.z);
  const start = hash(String(mapId || '')) % FIX_NAMES.length;
  const used = new Set((opts.reserved || []).map((s) => String(s).toUpperCase()));
  let k = 0;
  for (const f of out) {
    let name = null;
    for (let tries = 0; tries < FIX_NAMES.length && !name; tries++) {
      const n = FIX_NAMES[(start + k++) % FIX_NAMES.length];
      if (!used.has(n)) name = n;
    }
    for (let s = 0; !name; s++) {
      const n = madeUpFix(`${mapId}:${k}:${s}`);
      if (!used.has(n)) name = n;
    }
    used.add(name);
    f.id = `fix:${name}`;
    f.name = name;
    f.kind = 'fix';
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Steering                                                            */
/* ------------------------------------------------------------------ */

/** How far ahead along the leg the autopilot aims: 25 s of flight, 1.5 to 12 km. */
export function lookAhead(gsMs) {
  return Math.max(1500, Math.min(12000, (gsMs || 0) * 25));
}

/** The point on leg A→B the autopilot aims at from P (pure pursuit). */
export function pursuitPoint(px, pz, ax, az, bx, bz, look) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz;
  if (L2 < 1) return { x: bx, z: bz, t: 1, xtk: 0 };
  const len = Math.sqrt(L2);
  const ux = dx / len;
  const uz = dz / len;
  let t = ((px - ax) * dx + (pz - az) * dz) / L2;
  t = Math.max(0, Math.min(1, t));
  const qx = ax + dx * t;
  const qz = az + dz * t;
  // Cross-track, positive right of the track.
  const xtk = (px - ax) * -uz + (pz - az) * ux;
  const left = (1 - t) * len;
  if (left <= look) return { x: bx, z: bz, t, xtk };
  return { x: qx + ux * look, z: qz + uz * look, t, xtk };
}

/** A point on a circle of radius R round C, ahead of P in direction `dir` (1 clockwise seen from above). */
export function orbitPoint(px, pz, cx, cz, R, dir = 1, look = 1500) {
  const d = Math.hypot(px - cx, pz - cz);
  if (d > R * 2.5) return { x: cx, z: cz };
  const a = Math.atan2(pz - cz, px - cx);
  const da = (dir * Math.min(look, R * 1.5)) / Math.max(1, R);
  return { x: cx + Math.cos(a + da) * R, z: cz + Math.sin(a + da) * R };
}

/** A comfortable orbit for this ground speed: a 20-degree bank, 1.2 to 6 km. */
export function orbitRadius(gsMs) {
  const v = Math.max(30, gsMs || 0);
  return Math.max(1200, Math.min(6000, ((v * v) / (9.81 * Math.tan(20 * RAD))) * 1.15));
}

/** The radius of a 25-degree-bank turn at this ground speed (the autopilot's turn). */
export function turnRadius(gsMs) {
  const v = Math.max(20, gsMs || 0);
  return (v * v) / (9.81 * Math.tan(25 * RAD));
}

/** Within this of a waypoint it counts as reached: 8 s of flight, at least 800 m. */
export function arriveRadius(gsMs) {
  return Math.max(800, (gsMs || 0) * 8);
}

/* ------------------------------------------------------------------ */
/* The flight plan                                                     */
/* ------------------------------------------------------------------ */

/**
 * FROM (where DIRECT TO was pressed, or where the first waypoint was added)
 * → waypoints → the last one. One leg active at a time; reaching its end
 * sequences to the next, and reaching the last one holds: an orbit round it
 * (a helicopter: the hover over it).
 *
 *   wp: { id, name, x, z, kind: 'pin' | 'fix' | 'airport' | 'heliport' | 'town', ref? }
 */
export class FlightPlan {
  constructor() {
    this.clear();
  }

  clear() {
    this.origin = null;
    this.legs = [];
    this.active = 0;
    /** 'idle' (nothing to fly) | 'active' | 'holding' (reached the last one). */
    this.state = 'idle';
    this.orbitDir = 1;
    this.rev = (this.rev || 0) + 1;
    return this;
  }

  get empty() {
    return this.legs.length === 0;
  }

  /** The waypoint the active leg goes to (null when there is none). */
  get to() {
    return this.legs[this.active] || null;
  }

  /** Where leg i starts. */
  fromOf(i) {
    return i <= 0 ? this.origin : this.legs[i - 1];
  }

  /** DIRECT TO: one leg, from here to there. Replaces whatever was being flown. */
  directTo(wp, px, pz) {
    this.origin = { id: 'ppos', name: 'PPOS', x: px, z: pz, kind: 'ppos' };
    this.legs = [{ ...wp }];
    this.active = 0;
    this.state = 'active';
    this.rev++;
    return this.legs[0];
  }

  /**
   * DIRECT TO a waypoint already in the plan: the legs before it go, the ones
   * after it stay (a real FMS's "DIR TO" a downstream fix).
   */
  directToIndex(i, px, pz) {
    if (i < 0 || i >= this.legs.length) return null;
    this.legs = this.legs.slice(i);
    this.origin = { id: 'ppos', name: 'PPOS', x: px, z: pz, kind: 'ppos' };
    this.active = 0;
    this.state = 'active';
    this.rev++;
    return this.legs[0];
  }

  /** Add a waypoint to the end of the plan (the first one starts it, from here). */
  add(wp, px, pz) {
    if (!wp) return null;
    const last = this.legs[this.legs.length - 1];
    if (last && Math.hypot(last.x - wp.x, last.z - wp.z) < 50) return last;
    if (!this.legs.length || !this.origin) this.origin = { id: 'ppos', name: 'PPOS', x: px, z: pz, kind: 'ppos' };
    this.legs.push({ ...wp });
    if (this.state !== 'active') {
      // Holding at the old last waypoint: the new one is the next leg.
      if (this.state === 'holding') this.active = this.legs.length - 1;
      this.state = 'active';
    }
    this.rev++;
    return this.legs[this.legs.length - 1];
  }

  remove(i) {
    if (i < 0 || i >= this.legs.length) return;
    this.legs.splice(i, 1);
    if (!this.legs.length) return this.clear();
    if (i < this.active) this.active--;
    if (this.active >= this.legs.length) {
      this.active = this.legs.length - 1;
      this.state = 'holding';
    }
    this.rev++;
  }

  /**
   * Where to aim now, from P at ground speed gs (m/s): the carrot on the
   * active leg, the orbit round the last waypoint once it is reached, or the
   * waypoint itself for a hover. null when there is nothing to fly.
   */
  steer(px, pz, gsMs, hover = false) {
    const to = this.to;
    if (!to || this.state === 'idle') return null;
    if (this.state === 'holding') {
      if (hover) return { x: to.x, z: to.z };
      return orbitPoint(px, pz, to.x, to.z, orbitRadius(gsMs), this.orbitDir, lookAhead(gsMs) * 0.6);
    }
    const from = this.fromOf(this.active) || { x: px, z: pz };
    const p = pursuitPoint(px, pz, from.x, from.z, to.x, to.z, lookAhead(gsMs));
    return { x: p.x, z: p.z, xtk: p.xtk };
  }

  /**
   * Has the active leg's waypoint been reached? Sequences or holds.
   * @returns {null | {type: 'sequenced', wp, next} | {type: 'arrived', wp}}
   */
  update(px, pz, gsMs) {
    const to = this.to;
    if (!to || this.state !== 'active') return null;
    const d = Math.hypot(to.x - px, to.z - pz);
    const from = this.fromOf(this.active);
    const next = this.legs[this.active + 1] || null;
    let passed = false;
    let early = false;
    if (from) {
      const dx = to.x - from.x;
      const dz = to.z - from.z;
      const L2 = dx * dx + dz * dz;
      const t = L2 > 1 ? ((px - from.x) * dx + (pz - from.z) * dz) / L2 : 1;
      // Past it abeam (the leg's far end behind you) counts too: a fast jet a
      // little off the track would otherwise circle back for it.
      passed = t > 1 && d < arriveRadius(gsMs) * 3;
      // A fly-by waypoint, as a real FMS flies one: the turn onto the next leg
      // starts a turn's lead short of it (radius × tan(half the course change)),
      // so the aeroplane rolls out on the next leg instead of overshooting it.
      if (next && L2 > 1) {
        const inC = bearingDeg(from.x, from.z, to.x, to.z);
        const outC = bearingDeg(to.x, to.z, next.x, next.z);
        const turn = Math.abs(((outC - inC + 540) % 360) - 180);
        const lead = Math.min(turnRadius(gsMs) * Math.tan(Math.min(turn, 150) * RAD / 2), Math.sqrt(L2) * 0.5, 15000);
        early = (1 - t) * Math.sqrt(L2) < lead && d < lead * 1.6 + arriveRadius(gsMs);
      }
    }
    if (d > arriveRadius(gsMs) && !passed && !early) return null;
    if (next) {
      this.active++;
      this.rev++;
      return { type: 'sequenced', wp: to, next };
    }
    this.state = 'holding';
    // Orbit the way that is the gentler turn from the heading you arrived on.
    if (from) {
      const cross = (to.x - from.x) * (pz - to.z) - (to.z - from.z) * (px - to.x);
      this.orbitDir = cross >= 0 ? 1 : -1;
    }
    this.rev++;
    return { type: 'arrived', wp: to };
  }

  /** The plan as a flight plan reads: each leg's distance and time from where you are. */
  summary(px, pz, gsKts) {
    const rows = [];
    let total = 0;
    let fx = px;
    let fz = pz;
    for (let i = 0; i < this.legs.length; i++) {
      const w = this.legs[i];
      if (i < this.active) {
        rows.push({ i, wp: w, done: true, dist: 0, eta: 0, brg: null });
        continue;
      }
      const d = Math.hypot(w.x - fx, w.z - fz);
      total += d;
      rows.push({ i, wp: w, done: false, active: i === this.active, dist: d, brg: bearingDeg(fx, fz, w.x, w.z), eta: etaMin(d, gsKts), cum: total, cumEta: etaMin(total, gsKts) });
      fx = w.x;
      fz = w.z;
    }
    return { rows, total, totalEta: etaMin(total, gsKts) };
  }
}

/**
 * World Map traffic: who flies where, and how, on rails. Pure — no meshes,
 * no DOM; features/world-traffic.js draws it and node runs it as it is
 * (tests/features/wm-traffic.mjs).
 *
 * The owner, 2026-10-31: "on worldmap it should show all planes" — traffic in
 * the sky, so the 200 km sea feels busy. N aircraft at a time (TIERS), each
 * flying one route between two World Map fields:
 *
 *   jet / wide   airliners between the long runways (2,300 m and up; the
 *                widebodies 2,800 m), cruising FL150-FL350 as the leg allows
 *   prop         the Q400 between the regionals and the hubs
 *   light        Skylarks, Couriers and Tempests between the strips and
 *                anywhere, low
 *   heli         helicopters between the heliports and the fields' pads,
 *                a few hundred metres over the ground
 *   mil          a C-17, a C-5, an F-22 or an F/A-18 now and then between
 *                the air base and the air station
 * and each kind has a few RARE types that turn up now and then (pickTypeId).
 *
 * BUSY WHERE YOU ARE. Each new one is, most of the time (LOCAL_BIAS), given
 * the route of four that passes nearest you; at the flight's start they are
 * put along their routes near where those pass you (never within 4 km), so
 * the sky round you has someone in it even at Low's eight.
 *
 * ON RAILS. A route is compiled once into a path (straight legs joined by
 * turns of the radius the type flies at that speed: v² / g·tan(bank)) and a
 * height profile sampled every 250 m: the climb, a cruise level by the
 * semicircular rule (east odd thousands, west even), the descent, a gate on
 * the runway's extended centreline and the three-degree slope to the
 * touchdown aim point, then the roll-out and the turn off the runway. The
 * profile never goes under the ground along the route plus the type's
 * clearance (sampled from the real height field, the climb started early
 * enough to make it at the type's own gradient). Stepping one is: s += v·dt,
 * read the path and the profile at s, add the avoidance offset. No flight
 * model; a few dozen multiplies a frame each.
 *
 * THE RUNWAY RULE (no incursions, ever). Nobody takes off or lands at a field
 * within NO_RUNWAY_M (8 km) of you:
 *   - nobody takes off at all: a departure appears already airborne, on the
 *     climb-out past the runway end, and only where nobody can see it appear
 *     (further than the tier's draw range from you and the camera), and never
 *     from a field within NO_RUNWAY_M of you;
 *   - an arrival reaching its join point (a few km out on the extended
 *     centreline) with you within NO_RUNWAY_M of the field, or with someone
 *     else still on that runway's final, HOLDS there (a right-hand circle,
 *     stacked 300 m apart) and after HOLD_MAX diverts to another field;
 *   - already past the join point when you come within NO_RUNWAY_M: it goes
 *     around, turning away from you, and holds;
 *   - on a long final (despawnOut from the threshold) out of sight, it is
 *     gone there — which is nearly always; in sight, it lands, rolls out and
 *     turns off the runway beside it, and is gone once out of sight.
 *
 * SEPARATION (TCAS-like). Every frame, against your predicted path over the
 * next 60 s: a closest point inside SEP_H x SEP_V (1.5 km, 300 m), with some
 * margin, and it climbs or descends away from your height (never into the
 * ground) and steps sideways away from where you will be, at its own climb
 * rate and over half its speed sideways (a 35-degree turn away); clear for a few seconds and it
 * eases back onto its rails. On the final, where a step aside is wrong, it
 * goes around instead. A collision can only be your doing: chasing one down.
 *
 * AND FROM EACH OTHER (cheap, every half second). A departure that would
 * appear within 3 km and 600 m of another waits (another route is tried, or
 * the next spawn); a hold stacks 300 m over everyone holding at that field,
 * whatever they are; and two that will close inside SEP_H x SEP_V in the
 * next 30 s take different levels: the one with the most room to move (not
 * on its approach, the newer of the two) climbs or descends to 450 m clear
 * of the other, and eases back onto its profile once clear.
 */

import { AIRPORTS as WP_AIRPORTS, PREVIEW } from './preview.js';

/**
 * Per tier: how many fly at once, how many full models near the camera, their range, and the proxies' range.
 *
 * The owner, 2026-11-11: "add more npc aircraft". Medium, High and Ultra fly about 40% more than they did
 * (16 / 24 / 32 before), from a bigger fleet, with one or two more full models near you at High and Ultra.
 * LOW IS AS IT WAS, number for number: it is what the school iPads and Chromebooks start on
 * (render/weak-device.js), and LOW_WAS below is what the tests hold it to.
 */
export const TIERS = Object.freeze({
  low: Object.freeze({ n: 8, models: 2, near: 2500, far: 9000, fleet: 6, buildGap: 6 }),
  medium: Object.freeze({ n: 22, models: 3, near: 3500, far: 12000, fleet: 13, buildGap: 2 }),
  high: Object.freeze({ n: 34, models: 5, near: 4500, far: 15000, fleet: 18, buildGap: 1.5 }),
  ultra: Object.freeze({ n: 46, models: 8, near: 6000, far: 18000, fleet: 26, buildGap: 1 }),
});
/** Low before the busier skies: the cap a weak device is held to. */
export const LOW_WAS = Object.freeze({ n: 8, models: 2, fleet: 6 });

/** No take-off or landing at a field this close to the player (metres, horizontal). */
export const NO_RUNWAY_M = 8000;
/** The separation they keep from you: horizontal and vertical. */
export const SEP_H = 1500;
export const SEP_V = 300;
/** Seconds of your predicted path they look along. */
export const LOOK_S = 60;
/** Seconds between the traffic-to-traffic checks (each pair, both ways: a few hundred multiplies at Ultra). */
export const TT_EVERY = 0.5;
/** Seconds a traffic-to-traffic level change is held after the conflict has gone. */
export const TT_HOLD = 8;
/** Seconds a hold lasts before it diverts somewhere else. */
export const HOLD_MAX = 150;
/** Stack spacing in a hold, metres. */
export const STACK_M = 300;
/** The fastest the drawn heading turns, degrees a second (the paths themselves turn at the type's bank). */
export const HDG_RATE = 30;
/** Profile sample spacing, metres. */
export const DS = 250;

const DEG = Math.PI / 180;
const G = 9.81;
const FT = 0.3048;
const TAN3 = Math.tan(3 * DEG);
/** 10,000 ft, and 250 knots: the speed limit under it. */
export const FL100 = 10000 * FT;
export const V250 = 250 / 1.94384;

/**
 * The kinds of traffic. Speeds in m/s, gradients as rise/run, heights in
 * metres above the sea. `gate` and `join` are distances out from the
 * threshold along the extended centreline (the join is further out).
 */
export const CATS = Object.freeze({
  jet: Object.freeze({
    types: ['a320', 'b737', 'a321', 'meridian'], rare: ['concorde'], share: 0.34, minRunway: 2300, minLeg: 30000, maxLeg: Infinity,
    climb: 0.1, desc: 0.055, vClimb: 135, vCruise: 205, vApp: 82, vFinal: 72, maxVs: 13, accel: 1.1, decelDist: 30000,
    cruiseMin: 4500, cruiseMax: 10700, gate: 14000, join: 6000, spawnOut: 6000, despawnOut: 10000, bank: 25, clear: 450,
    rollout: 1600, aoa: 2.5, appAoa: 4, wide: false, slope: TAN3,
  }),
  wide: Object.freeze({
    types: ['b787', 'a350', 'b777', 'b747', 'a380'], rare: ['belugaxl', 'dreamlifter', 'an225'], share: 0.1, minRunway: 2800, minLeg: 50000, maxLeg: Infinity,
    climb: 0.085, desc: 0.055, vClimb: 140, vCruise: 225, vApp: 85, vFinal: 76, maxVs: 12, accel: 1.0, decelDist: 32000,
    cruiseMin: 5500, cruiseMax: 11300, gate: 15000, join: 6000, spawnOut: 7000, despawnOut: 11000, bank: 25, clear: 450,
    rollout: 2000, aoa: 2.5, appAoa: 4, wide: true, slope: TAN3,
  }),
  prop: Object.freeze({
    types: ['q400'], share: 0.18, minRunway: 1300, minLeg: 15000, maxLeg: 170000,
    climb: 0.08, desc: 0.06, vClimb: 90, vCruise: 135, vApp: 64, vFinal: 58, maxVs: 9, accel: 0.9, decelDist: 14000,
    cruiseMin: 2400, cruiseMax: 7600, gate: 9000, join: 4500, spawnOut: 4500, despawnOut: 7000, bank: 25, clear: 400,
    rollout: 900, aoa: 2, appAoa: 3, slope: TAN3,
  }),
  light: Object.freeze({
    types: ['skylark', 'courier', 'tempest'], share: 0.22, minRunway: 0, minLeg: 9000, maxLeg: 75000,
    climb: 0.07, desc: 0.06, vClimb: 38, vCruise: 56, vApp: 36, vFinal: 32, maxVs: 4, accel: 0.7, decelDist: 4000,
    cruiseMin: 900, cruiseMax: 2700, gate: 4500, join: 2500, spawnOut: 2500, despawnOut: 4000, bank: 25, clear: 300,
    rollout: 350, aoa: 2, appAoa: 4, slope: TAN3, vfr: true, side: 0.71,
  }),
  heli: Object.freeze({
    types: ['bell407', 'h145', 'aw139', 'r44'], rare: ['uh60', 'ch47'], share: 0.1, pads: true, minLeg: 8000, maxLeg: 60000,
    climb: 0.12, desc: 0.1, vClimb: 40, vCruise: 62, vApp: 26, vFinal: 12, maxVs: 6, accel: 1.1, decelDist: 3000,
    cruiseMin: 0, cruiseMax: 0, agl: 330, gate: 1700, join: 1200, spawnOut: 1300, despawnOut: 1700, bank: 20, clear: 300,
    rollout: 0, aoa: 0, appAoa: 0, slope: 0.12, side: 0.71,
  }),
  mil: Object.freeze({
    types: ['c17', 'c5', 'f22', 'fa18'], rare: ['b1b'], share: 0.06, minRunway: 2300, minLeg: 40000, maxLeg: Infinity, only: ['sandmere', 'farwatch'],
    climb: 0.09, desc: 0.06, vClimb: 130, vCruise: 200, vApp: 70, vFinal: 65, maxVs: 12, accel: 1.0, decelDist: 28000,
    cruiseMin: 4500, cruiseMax: 9500, gate: 13000, join: 6000, spawnOut: 6000, despawnOut: 10000, bank: 25, clear: 450,
    rollout: 1300, aoa: 3, appAoa: 4, slope: TAN3,
  }),
});
export const CAT_IDS = Object.freeze(Object.keys(CATS));
/** How often a kind's `rare` types turn up instead of its everyday ones. */
export const RARE_P = 0.08;
/**
 * A type for one of a kind: mostly its everyday `types`, now and then one of its `rare` ones (Concorde among
 * the jets, the outsize freighters among the widebodies, an army helicopter, a bomber). `have(id)` says
 * whether the roster has it (an edition without a type simply never flies it).
 */
export function pickTypeId(catId, rand, have = null) {
  const C = CATS[catId];
  const ok = (l) => (have ? l.filter(have) : l);
  // One draw for both questions, so a sky is the same sky it was for a given seed.
  const r = rand();
  const rare = C.rare ? ok(C.rare) : [];
  if (rare.length && r < RARE_P) return rare[Math.floor((r / RARE_P) * rare.length)];
  const list = ok(C.types);
  const u = rare.length ? (r - RARE_P) / (1 - RARE_P) : r;
  return list.length ? list[Math.min(list.length - 1, Math.floor(u * list.length))] : C.types[0];
}

/* ------------------------------------------------------------------ */
/* Small maths                                                         */
/* ------------------------------------------------------------------ */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
/** Compass degrees (clockwise from north, -Z north) of a direction (dx, dz). */
export const compass = (dx, dz) => ((Math.atan2(dx, -dz) / DEG) + 360) % 360;
function adiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}
/** A small seeded generator (mulberry32). */
export function makeRand(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Turn radius at this speed and bank. */
export function turnRadius(v, bankDeg) {
  return (v * v) / (G * Math.tan(bankDeg * DEG));
}

/* ------------------------------------------------------------------ */
/* The fields and the pads                                             */
/* ------------------------------------------------------------------ */

/**
 * Endpoints a route can join: every airport ({ runway: true }) and every
 * helicopter pad. `padsIn` is MAP.scenery.pads shaped ({ id, name, x, z,
 * kind, ... }); `padY(p)` the pad's surface height.
 */
export function endpoints({ airports = WP_AIRPORTS, pads = (PREVIEW.scenery && PREVIEW.scenery.pads) || [], padY = null } = {}) {
  const fields = airports.map((a) => ({
    id: a.id, code: a.code, name: a.name, kind: a.kind, x: a.x, z: a.z, elev: a.elev, length: a.length, halfWidth: a.halfWidth,
    runway: true, airport: a,
  }));
  const heli = pads.map((p) => {
    const field = /^field-/.test(p.id) ? fields.find((f) => `field-${f.id}` === p.id) : null;
    const y = typeof padY === 'function' ? padY(p) : (p.elev != null ? p.elev : field ? field.elev : 0);
    return {
      id: `pad:${p.id}`, code: field ? field.code : 'H', name: p.name, kind: 'pad', x: p.x, z: p.z, elev: y, length: 0, halfWidth: 0,
      runway: false, field: field ? field.id : null,
    };
  });
  return { fields, pads: heli, all: fields.concat(heli) };
}

/** Which pairs each kind of traffic may fly, as [from, to] endpoint pairs. */
export function routePairs(E) {
  const out = {};
  for (const id of CAT_IDS) {
    const c = CATS[id];
    const list = c.pads ? E.pads : E.fields.filter((f) => f.length >= (c.minRunway || 0) && (id !== 'light' || f.kind !== 'remote'));
    const pairs = [];
    for (const a of list) {
      for (const b of list) {
        if (a === b) continue;
        if (c.only && !c.only.includes(a.id) && !c.only.includes(b.id)) continue;
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (d < c.minLeg || d > c.maxLeg) continue;
        // A pad's helicopter does not fly from one pad to another on the same field.
        if (c.pads && a.field && a.field === b.field) continue;
        pairs.push([a, b]);
      }
    }
    out[id] = pairs;
  }
  return out;
}

/**
 * The runway in use, as the direction a landing (and a take-off) rolls along
 * x: +1 for 09 (into an easterly wind), -1 for 27. The same rule as the
 * player's guidance (features/world-preview.js routeTarget).
 */
export function runwayDir(windDirDeg = 80) {
  return Math.cos(((windDirDeg - 90) * Math.PI) / 180) >= 0 ? 1 : -1;
}

/* ------------------------------------------------------------------ */
/* The path: straight legs and turns                                   */
/* ------------------------------------------------------------------ */

/**
 * Compile waypoints [{ x, z, v? }] into elements. A turn at each interior
 * point at the radius its speed needs (clipped to fit the legs either side).
 * Returns { els, len, sAt } — sAt[i] is the distance along the path at the
 * middle of point i's turn (or at the point, where there is none).
 */
export function compilePath(pts, bankDeg = 25, minR = 40) {
  const els = [];
  const sAt = new Array(pts.length).fill(0);
  let s = 0;
  let cx = pts[0].x;
  let cz = pts[0].z;
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    const c = pts[i + 1];
    let ex = b.x;
    let ez = b.z;
    let arc = null;
    const d1x0 = b.x - cx;
    const d1z0 = b.z - cz;
    const l1 = Math.hypot(d1x0, d1z0);
    if (l1 < 1e-6) {
      sAt[i] = s;
      continue;
    }
    const d1x = d1x0 / l1;
    const d1z = d1z0 / l1;
    if (c) {
      const d2x0 = c.x - b.x;
      const d2z0 = c.z - b.z;
      const l2 = Math.hypot(d2x0, d2z0);
      if (l2 > 1e-6) {
        const d2x = d2x0 / l2;
        const d2z = d2z0 / l2;
        const th = Math.atan2(d1x * d2z - d1z * d2x, d1x * d2x + d1z * d2z);
        const ath = Math.abs(th);
        if (ath > 0.004) {
          const R = Math.max(minR, b.r || turnRadius(b.v || 60, bankDeg));
          let t = R * Math.tan(ath / 2);
          const tMax = Math.min(l1 * 0.98, l2 * 0.49);
          let r = R;
          if (t > tMax) {
            t = tMax;
            r = t / Math.tan(ath / 2);
          }
          ex = b.x - d1x * t;
          ez = b.z - d1z * t;
          const sg = th > 0 ? 1 : -1;
          // The centre is on the turn's side of the incoming leg.
          arc = { kind: 1, x0: ex, z0: ez, dx: d1x, dz: d1z, sg, r, cx: ex + sg * r * -d1z, cz: ez + sg * r * d1x, len: r * ath, s0: 0 };
        }
      }
    }
    const ll = Math.hypot(ex - cx, ez - cz);
    if (ll > 1e-6) {
      els.push({ kind: 0, x0: cx, z0: cz, dx: d1x, dz: d1z, len: ll, s0: s });
      s += ll;
    }
    if (arc) {
      arc.s0 = s;
      els.push(arc);
      sAt[i] = s + arc.len / 2;
      s += arc.len;
      // Where the turn comes out.
      const ph = arc.len / arc.r * arc.sg;
      const c0 = Math.cos(ph);
      const s0 = Math.sin(ph);
      cx = arc.cx + (arc.x0 - arc.cx) * c0 - (arc.z0 - arc.cz) * s0;
      cz = arc.cz + (arc.x0 - arc.cx) * s0 + (arc.z0 - arc.cz) * c0;
    } else {
      sAt[i] = s;
      cx = b.x;
      cz = b.z;
    }
  }
  return { els, len: s, sAt };
}

/**
 * The point at distance s along the path: out.x, out.z, and the direction
 * of travel out.dx, out.dz. `cur` is { i } — the element looked in last,
 * moved on (or back) from there, so a walk along the path costs nothing.
 */
export function evalPath(path, s, out, cur = { i: 0 }) {
  const E = path.els;
  if (!E.length) {
    out.x = 0;
    out.z = 0;
    out.dx = 1;
    out.dz = 0;
    return out;
  }
  s = clamp(s, 0, path.len);
  let i = clamp(cur.i | 0, 0, E.length - 1);
  while (i < E.length - 1 && s > E[i].s0 + E[i].len) i++;
  while (i > 0 && s < E[i].s0) i--;
  cur.i = i;
  const e = E[i];
  const u = clamp(s - e.s0, 0, e.len);
  if (e.kind === 0) {
    out.x = e.x0 + e.dx * u;
    out.z = e.z0 + e.dz * u;
    out.dx = e.dx;
    out.dz = e.dz;
  } else {
    const ph = (u / e.r) * e.sg;
    const c = Math.cos(ph);
    const sn = Math.sin(ph);
    const rx = e.x0 - e.cx;
    const rz = e.z0 - e.cz;
    out.x = e.cx + rx * c - rz * sn;
    out.z = e.cz + rx * sn + rz * c;
    out.dx = e.dx * c - e.dz * sn;
    out.dz = e.dx * sn + e.dz * c;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* A route                                                             */
/* ------------------------------------------------------------------ */

/** The semicircular rule: east (000-179) odd thousands of feet, west even; VFR adds 500 ft. */
export function cruiseLevel(want, bearingDeg, vfr = false) {
  const east = bearingDeg < 180;
  const ftWant = want / FT;
  let k = Math.ceil(ftWant / 1000);
  if (east ? k % 2 === 0 : k % 2 === 1) k++;
  return (k * 1000 + (vfr ? 500 : 0)) * FT;
}

/** Where a field's runway is, for a landing (and a departure) rolling along `dir` (+1 east). */
export function runwayGeo(f, dir) {
  return {
    dir,
    thrX: f.x - dir * (f.length / 2), thrZ: f.z,
    endX: f.x + dir * (f.length / 2), endZ: f.z,
    ux: dir, uz: 0,
  };
}

/**
 * Plan a route. `from` an endpoint or a start state { x, z, alt, dx, dz, v }
 * (a go-around, a divert); `to` the endpoint. Returns the plan (path,
 * profile, the named distances) or null.
 *
 *   ground(x, z)  the height field (0 at sea)
 *   windDirDeg    which way the runways are being used
 */
export function planRoute(catId, from, to, { ground = () => 0, windDirDeg = 80, start = null, extra = 0, cruiseCap = null } = {}) {
  const C = CATS[catId];
  if (!C || !to) return null;
  const heli = !!C.pads;
  const dirTo = runwayDir(windDirDeg);
  const pts = [];
  let alt0;
  // Departure: airborne, out past the runway end on the climb-out.
  if (!start) {
    if (heli) {
      const bx = to.x - from.x;
      const bz = to.z - from.z;
      const l = Math.hypot(bx, bz) || 1;
      const ux = bx / l;
      const uz = bz / l;
      pts.push({ x: from.x + ux * C.spawnOut, z: from.z + uz * C.spawnOut, v: C.vClimb });
      alt0 = Math.max(from.elev + 150, ground(pts[0].x, pts[0].z) + 150);
    } else {
      const R = runwayGeo(from, dirTo);
      const sx = R.endX + R.ux * C.spawnOut;
      pts.push({ x: sx, z: R.endZ, v: C.vClimb });
      pts.push({ x: sx + R.ux * 3000, z: R.endZ, v: C.vClimb });
      alt0 = from.elev + 35 + (C.spawnOut + from.length * 0.4) * C.climb;
    }
  } else {
    pts.push({ x: start.x, z: start.z, v: start.v });
    let bx = start.x;
    let bz = start.z;
    // Still heading the way it was (a go-around turns off the final): straight on a little first, then the turn,
    // not a snap onto the new heading.
    if (start.hx != null) {
      const d1 = Math.max(300, 0.4 * turnRadius(start.v || C.vApp, C.bank));
      bx += start.hx * d1;
      bz += start.hz * d1;
      pts.push({ x: bx, z: bz, v: start.v });
    }
    const lead = start.lead != null ? start.lead : Math.max(1500, turnRadius(start.v || C.vApp, C.bank));
    pts.push({ x: bx + start.dx * lead, z: bz + start.dz * lead, v: start.v });
    alt0 = start.alt;
  }
  // Arrival: the join point, the gate, the threshold, the roll-out, off the runway.
  let ux;
  let uz;
  let thrX;
  let thrZ;
  let aimDist;
  if (heli) {
    const A = pts[pts.length - 1];
    const bx = to.x - A.x;
    const bz = to.z - A.z;
    const l = Math.hypot(bx, bz) || 1;
    ux = bx / l;
    uz = bz / l;
    thrX = to.x;
    thrZ = to.z;
    aimDist = 0;
  } else {
    const R = runwayGeo(to, dirTo);
    ux = R.ux;
    uz = R.uz;
    thrX = R.thrX;
    thrZ = R.thrZ;
    aimDist = Math.min(300, to.length * 0.25);
  }
  const gx = thrX - ux * C.gate;
  const gz = thrZ - uz * C.gate;
  const join = C.join + extra;
  const jx = gx - ux * join;
  const jz = gz - uz * join;
  const Rapp = turnRadius(C.vApp, C.bank);
  // Turning back from the climb-out (or a go-around, a divert) towards the join point: round a circle of the
  // type's own radius, in 45-degree pieces, not one hairpin at the corner (compilePath would clip a 180 there
  // into a spin on the spot).
  if (pts.length >= 2) {
    const L0 = pts[pts.length - 2];
    const L = pts[pts.length - 1];
    const v = L.v || C.vClimb;
    const R = Math.max(150, turnRadius(v, C.bank)) * 1.08;
    let hx = L.x - L0.x;
    let hz = L.z - L0.z;
    const hl = Math.hypot(hx, hz) || 1;
    hx /= hl;
    hz /= hl;
    let px = L.x;
    let pz = L.z;
    const off = () => Math.atan2(hx * (jz - pz) - hz * (jx - px), hx * (jx - px) + hz * (jz - pz));
    const a0 = off();
    if (Math.abs(a0) > 80 * DEG) {
      const sg = a0 > 0 ? 1 : -1;
      const step = 45 * DEG;
      const chord = 2 * R * Math.sin(step / 2);
      for (let k = 0; k < 8 && Math.abs(off()) > 60 * DEG; k++) {
        const a = (sg * step) / 2;
        px += (hx * Math.cos(a) - hz * Math.sin(a)) * chord;
        pz += (hx * Math.sin(a) + hz * Math.cos(a)) * chord;
        const b = sg * step;
        const nx = hx * Math.cos(b) - hz * Math.sin(b);
        const nz = hx * Math.sin(b) + hz * Math.cos(b);
        hx = nx;
        hz = nz;
        pts.push({ x: px, z: pz, v, r: R / 1.08 });
      }
    }
  }
  // Coming from ahead of the join point: round by a point abeam it first, so no turn is past ~135 degrees.
  const A = pts[pts.length - 1];
  const ax = A.x - jx;
  const az = A.z - jz;
  if (!heli && ax * ux + az * uz > -Rapp * 0.5) {
    const side = Math.sign(ux * az - uz * ax) || 1;
    // The perpendicular on A's side of the course.
    const nx = -uz * side;
    const nz = ux * side;
    pts.push({ x: jx + nx * 2.4 * Rapp - ux * Rapp, z: jz + nz * 2.4 * Rapp - uz * Rapp, v: C.vApp * 1.15 });
  }
  const iJ = pts.length;
  pts.push({ x: jx, z: jz, v: C.vApp });
  const iG = pts.length;
  pts.push({ x: gx, z: gz, v: C.vFinal });
  const iT = pts.length;
  pts.push({ x: thrX, z: thrZ, v: C.vFinal });
  let iE = -1;
  let iP = -1;
  let park = null;
  if (!heli) {
    const ex = thrX + ux * C.rollout;
    const ez = thrZ + uz * C.rollout;
    iE = pts.length;
    pts.push({ x: ex, z: ez, v: 8, r: 60 });
    // Off the runway to the north side (no field here has anything built on its north edge within this),
    // clear of it by the half width and a wing.
    park = { x: ex + ux * 140, z: ez - (to.halfWidth + 50) };
    iP = pts.length;
    pts.push({ x: park.x, z: park.z, v: 6 });
  }
  const path = compilePath(pts, C.bank);
  const sJ = path.sAt[iJ];
  const sG = path.sAt[iG];
  const sT = path.sAt[iT];
  const sTD = heli ? path.len : sT + aimDist;
  const sE = heli ? path.len : path.sAt[iE];
  // The profile.
  const n = Math.max(2, Math.ceil(path.len / DS) + 1);
  const alt = new Float32Array(n);
  const gnd = new Float32Array(n);
  const P = { x: 0, z: 0, dx: 1, dz: 0 };
  const cur = { i: 0 };
  let gMax = 0;
  for (let k = 0; k < n; k++) {
    const s = Math.min(path.len, k * DS);
    evalPath(path, s, P, cur);
    // The ground here and a wing's worth either side.
    let g = Math.max(0, ground(P.x, P.z));
    const lx = -P.dz * 500;
    const lz = P.dx * 500;
    g = Math.max(g, ground(P.x + lx, P.z + lz), ground(P.x - lx, P.z - lz));
    gnd[k] = g;
    if (s > 1500 && s < sG && g > gMax) gMax = g;
  }
  const elevT = to.elev;
  const slope = C.slope;
  const altG = elevT + Math.max(0, sTD - sG) * slope;
  const bearing = compass(to.x - pts[0].x, to.z - pts[0].z);
  let cruise;
  if (heli) {
    cruise = Infinity; // the floor (ground + agl) carries it
  } else {
    // As high as the leg lets it climb and come down again, in the type's band.
    // Climbing from alt0 and coming down to the gate in sG: (h - alt0) / climb + (h - altG) / desc = sG.
    const legLen = Math.max(0, sG);
    const reach = (legLen + alt0 / C.climb + altG / C.desc) / (1 / C.climb + 1 / C.desc);
    let want = clamp(reach, C.cruiseMin, C.cruiseMax);
    if (cruiseCap != null) want = Math.min(want, cruiseCap);
    want = Math.max(want, gMax + C.clear);
    cruise = cruiseLevel(want, bearing, !!C.vfr);
  }
  const clearH = heli ? C.agl : C.clear;
  for (let k = 0; k < n; k++) {
    const s = Math.min(path.len, k * DS);
    let a;
    if (s >= sG) a = elevT + Math.max(0, sTD - s) * slope;
    else {
      const up = alt0 + s * C.climb;
      const down = altG + (sG - s) * C.desc;
      // Not down faster than the type's own gradient from where it starts (a divert from a cruise).
      const fromStart = alt0 - s * C.desc;
      a = Math.min(up, Math.max(cruise, fromStart), down);
      if (heli) a = Math.min(Math.max(alt0, gnd[k] + C.agl), down);
    }
    alt[k] = a;
  }
  // The floor: the ground and the clearance, between the climb-out and the gate (the approaches are clear:
  // worldmap/preview.js checkAirport proves 6 km of 3-degree slope; the gate is checked by the test).
  const kG = Math.floor(sG / DS);
  for (let k = 0; k < n; k++) {
    const s = k * DS;
    if (s < 1000 || k >= kG) continue;
    const f = gnd[k] + clearH;
    if (alt[k] < f) alt[k] = f;
  }
  // Climb to it early enough, at the type's gradient, and come down after it no faster than it may. A fresh
  // departure that needs more than the climb-out gives appears that much higher; a go-around or a divert
  // starts where it is (and climbs as hard as it must for the first kilometre).
  for (let k = kG - 1; k >= (start ? 1 : 0); k--) {
    const lim = alt[k + 1] - C.climb * DS;
    if (alt[k] < lim && (!start || k * DS > 1000)) alt[k] = lim;
  }
  for (let k = 1; k < kG; k++) {
    const lim = alt[k - 1] - C.desc * DS;
    if (alt[k] < lim) alt[k] = lim;
  }
  if (start) alt[0] = alt0;
  else alt0 = alt[0];
  const plan = {
    catId, cat: C, heli, from: start ? null : from, to, path, alt, gnd, n, cruise: heli ? null : cruise, alt0, altG,
    sJ, sG, sT, sTD, sE, sP: path.len, sD: Math.max(sJ, sT - C.despawnOut), ux, uz, thrX, thrZ, jx, jz, park,
    bearing, elev: elevT,
  };
  // Too high for the gate (a go-around or a divert close in): a longer straight-in, once.
  if (start && !extra && altAt(plan, sG - 1) > altG + 60) {
    const over = altAt(plan, Math.max(0, sJ - 1)) - (altG + (sG - sJ) * C.desc);
    if (over > 30) return planRoute(catId, from, to, { ground, windDirDeg, start, extra: over / C.desc * 1.1 + 500, cruiseCap });
  }
  return plan;
}

/** The profile's height at distance s (the final, from the gate, exactly: the slope to the aim point). */
export function altAt(plan, s) {
  if (s >= plan.sG) return plan.elev + Math.max(0, plan.sTD - s) * plan.cat.slope;
  const f = clamp(s / DS, 0, plan.n - 1);
  const k = Math.floor(f);
  const t = f - k;
  const a = plan.alt[k];
  const b = plan.alt[Math.min(plan.n - 1, k + 1)];
  return a + (b - a) * t;
}

/** The ground under the profile at distance s (the sampled max either side). */
export function groundAt(plan, s) {
  const k = clamp(Math.round(s / DS), 0, plan.n - 1);
  return plan.gnd[k];
}

/** The speed the route wants at s (m/s). */
export function speedAt(plan, s, alt) {
  const C = plan.cat;
  if (s >= plan.sTD) {
    if (plan.heli) return 0;
    if (s >= plan.sE) return clamp(((plan.sP - s) / 120) * 6, 1.5, 6);
    return 8;
  }
  if (s >= plan.sG) {
    if (plan.heli) return Math.max(2, C.vFinal * clamp((plan.sTD - s) / Math.max(1, plan.sTD - plan.sG), 0, 1) + 1);
    return C.vFinal;
  }
  if (s >= plan.sJ - 2000) return C.vApp;
  const above = alt - plan.elev;
  let v = C.vApp + (C.vCruise - C.vApp) * clamp((above - 500) / 3000, 0, 1);
  if (s < 4000 && !plan.heli && plan.from) v = Math.min(v, C.vClimb);
  const toJ = plan.sJ - s;
  v = Math.min(v, C.vApp + (toJ / C.decelDist) * (C.vCruise - C.vApp));
  // 250 knots below 10,000 feet, as everywhere: slowed to it before the descent gets there.
  if (v > V250) {
    const ahead = altAt(plan, s + 20000);
    if (alt < FL100 || (ahead < FL100 && ahead < alt)) v = Math.min(v, V250);
  }
  return Math.max(C.vApp * 0.9, v);
}

/* ------------------------------------------------------------------ */
/* Choosing who flies                                                  */
/* ------------------------------------------------------------------ */

/** How often a new one is given the route (of four) passing nearest you, rather than any. */
export const LOCAL_BIAS = 0.65;

/** How near (x, z) comes to the straight line from a to b: { d, t } (t 0..1 along it). */
export function segDist(x, z, a, b) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const L2 = dx * dx + dz * dz || 1;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
  return { d: Math.hypot(a.x + dx * t - x, a.z + dz * t - z), t };
}

/** Pick a kind of traffic by its share. */
export function pickCat(rand) {
  let r = rand();
  for (const id of CAT_IDS) {
    r -= CATS[id].share;
    if (r <= 0) return id;
  }
  return 'jet';
}

/* ------------------------------------------------------------------ */
/* The traffic, stepped                                                */
/* ------------------------------------------------------------------ */

const P0 = { x: 0, z: 0, dx: 1, dz: 0 };

/**
 * Everybody flying, stepped on rails. Construct with
 *   { tier, ground, rand, endpoints (endpoints()), windDirDeg }
 * then step(dt, ctx) each frame with ctx = { player: {x,y,z,vx,vy,vz} | null,
 * cam: {x,y,z} | null, windDirDeg }. Each aircraft (this.list) carries
 * x, y, z, vx, vy, vz, hdg (deg), pitch, bank (deg), onGround, gear (0..1),
 * phase, catId, typeId, from, to — what the drawing reads.
 */
export class TrafficSim {
  constructor({ tier = 'medium', ground = () => 0, rand = makeRand(7), endpoints: E = endpoints(), windDirDeg = 80, n = null, pickType = null } = {}) {
    this.tier = TIERS[tier] ? tier : 'medium';
    this.T = TIERS[this.tier];
    this.n = n != null ? n : this.T.n;
    this.ground = ground;
    this.rand = rand;
    this.E = E;
    this.pairs = routePairs(E);
    this.windDirDeg = windDirDeg;
    this.list = [];
    this.nextId = 1;
    this.clock = 0;
    this.spawnT = 0;
    this.events = [];
    this.pickType = pickType;
    this.cache = new Map();
    this.stats = { spawned: 0, despawned: 0, holds: 0, goArounds: 0, diverts: 0, landed: 0, avoid: 0, minSepH: Infinity, minSep3: Infinity, planMs: 0, plans: 0, knocked: 0, stepMs: 0, tcas: 0, delayed: 0 };
    this.ttT = 0;
    this.onEvent = null;
  }

  /** Log an event (bounded), for the tests and the console. */
  _ev(type, c, extra = {}) {
    const e = { t: Math.round(this.clock * 10) / 10, type, id: c.id, cat: c.catId, ...extra };
    this.events.push(e);
    if (this.events.length > 400) this.events.splice(0, 100);
    if (this.onEvent) {
      try {
        this.onEvent(e, c);
      } catch (err) {
        /* a listener's problem */
      }
    }
  }

  _plan(catId, from, to, opts = {}) {
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const key = opts.start ? null : `${catId}|${from.id}|${to.id}|${runwayDir(this.windDirDeg)}`;
    let p = key ? this.cache.get(key) : null;
    if (!p) {
      p = planRoute(catId, from, to, { ground: this.ground, windDirDeg: this.windDirDeg, ...opts });
      if (key && p) {
        this.cache.set(key, p);
        if (this.cache.size > 160) this.cache.delete(this.cache.keys().next().value);
      }
      this.stats.plans++;
    }
    this.stats.planMs += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return p;
  }

  /** Is (x, z) further than the drawing reaches from you and the camera? */
  hidden(x, y, z, ctx, far = this.T.far) {
    const P = ctx && ctx.player;
    const C = ctx && ctx.cam;
    if (P && Math.hypot(x - P.x, y - P.y, z - P.z) < far) return false;
    if (C && Math.hypot(x - C.x, y - C.y, z - C.z) < far) return false;
    return true;
  }

  /** Is this field (or pad) too near you for a take-off or a landing? */
  nearPlayer(ep, ctx, margin = 0) {
    const P = ctx && ctx.player;
    if (!P) return false;
    return Math.hypot(ep.x - P.x, ep.z - P.z) < NO_RUNWAY_M + margin;
  }

  /**
   * Put one aircraft in the sky. `mode` 'start' (the flight is starting: anywhere on a
   * route, at least 4 km from you) or 'hidden' (only where you cannot see it appear).
   */
  spawn(ctx, mode = 'hidden', want = {}) {
    const catId = want.catId || pickCat(this.rand);
    const pairs = this.pairs[catId];
    if (!pairs || !pairs.length) return null;
    const P = ctx && ctx.player;
    for (let tries = 0; tries < 6; tries++) {
      // Busy where you are: most of the time the route of a few that passes nearest you.
      let pr = want.pair || null;
      let near = null;
      if (!pr) {
        pr = pairs[Math.floor(this.rand() * pairs.length)];
        if (P && this.rand() < LOCAL_BIAS) {
          let best = segDist(P.x, P.z, pr[0], pr[1]);
          for (let k = 0; k < 3; k++) {
            const q = pairs[Math.floor(this.rand() * pairs.length)];
            const d = segDist(P.x, P.z, q[0], q[1]);
            if (d.d < best.d) {
              best = d;
              pr = q;
            }
          }
          near = best;
        }
      }
      const [from, to] = pr;
      if (this.nearPlayer(from, ctx, 1000)) continue;
      const plan = this._plan(catId, from, to);
      if (!plan) continue;
      // Where on the route: the start of the climb-out, or (a flight starting) anywhere up to the join point —
      // near where it passes you, if it was picked for that.
      let s = 0;
      if (mode === 'start' || want.s != null) {
        const top = Math.max(0, plan.sJ - 500);
        s = want.s != null ? want.s : near ? clamp(near.t * plan.path.len + (this.rand() - 0.5) * 30000, 0, top) : this.rand() * top;
        evalPath(plan.path, s, P0);
        const y = altAt(plan, s);
        if (P && want.s == null) {
          const dh = Math.hypot(P0.x - P.x, P0.z - P.z);
          if (dh < 4000 || (dh < SEP_H * 3 && Math.abs(y - P.y) < SEP_V * 3)) continue;
        }
        if (P && want.s == null && this.nearPlayer(to, ctx) && plan.sJ - s < 15000) continue;
        if (want.s == null && this._crowded(P0.x, y, P0.z)) {
          this.stats.delayed++;
          continue;
        }
      } else {
        evalPath(plan.path, 0, P0);
        if (!this.hidden(P0.x, plan.alt0, P0.z, ctx)) continue;
        // Someone just off that runway (or crossing its climb-out): the departure waits.
        if (this._crowded(P0.x, plan.alt0, P0.z)) {
          this.stats.delayed++;
          continue;
        }
      }
      const c = this._make(catId, plan, s);
      this.list.push(c);
      this.stats.spawned++;
      this._ev('spawn', c, { field: from.id, x: Math.round(c.x), z: Math.round(c.z), y: Math.round(c.y), airborne: !c.onGround, mode, playerToField: ctx && ctx.player ? Math.round(Math.hypot(from.x - ctx.player.x, from.z - ctx.player.z)) : null });
      return c;
    }
    return null;
  }

  /** Anyone within `r` horizontally and `v` vertically of (x, y, z)? */
  _crowded(x, y, z, r = SEP_H * 2, v = SEP_V * 2) {
    for (const o of this.list) {
      if (o.gone || o.knocked) continue;
      if (Math.abs(o.y - y) < v && Math.hypot(o.x - x, o.z - z) < r) return true;
    }
    return false;
  }

  /** Can it take a level change for someone else? In a hold, or short of its join point (not on the ground or falling). */
  _canStep(c) {
    if (c.gone || c.knocked || c.onGround) return false;
    return c.state === 'hold' || (c.state === 'fly' && c.s < c.plan.sJ - 300);
  }

  /**
   * Traffic against traffic: each pair that will close inside SEP_H x SEP_V in
   * the next 30 s (or is inside it now) gets a level change for one of them.
   */
  _separate() {
    const L = this.list;
    const H = LOOK_S / 2;
    for (let i = 0; i < L.length; i++) {
      const a = L[i];
      if (a.gone || a.knocked || a.onGround) continue;
      for (let j = i + 1; j < L.length; j++) {
        const b = L[j];
        if (b.gone || b.knocked || b.onGround) continue;
        const rx = b.x - a.x;
        const rz = b.z - a.z;
        const ry = b.y - a.y;
        if (Math.abs(rx) > 12000 || Math.abs(rz) > 12000) continue;
        const wx = b.vx - a.vx;
        const wz = b.vz - a.vz;
        const wy = b.vy - a.vy;
        const w2 = wx * wx + wz * wz;
        const t = w2 > 1e-3 ? clamp(-(rx * wx + rz * wz) / w2, 0, H) : 0;
        const dh = Math.hypot(rx + wx * t, rz + wz * t);
        const dv = ry + wy * t;
        const now = Math.hypot(rx, rz) < SEP_H && Math.abs(ry) < SEP_V;
        if (!now && !(dh < SEP_H && Math.abs(dv) < SEP_V)) continue;
        // Who moves: one free to (not on its approach or in a hold), the newer if both are.
        const ca = this._canStep(a);
        const cb = this._canStep(b);
        if (!ca && !cb) continue;
        const m = ca && cb ? (a.n > b.n ? a : b) : ca ? a : b;
        const o = m === a ? b : a;
        if (!(m.ttT > 0)) this.stats.tcas++;
        let sense = m.y >= o.y ? 1 : -1;
        const floor = groundAt(m.plan, m.s) + 150;
        if (sense < 0 && o.y - SEP_V - 150 < floor) sense = 1;
        m.ttY = o.y + sense * (SEP_V + 150) - m.railY;
        m.ttT = TT_HOLD;
      }
    }
  }

  _make(catId, plan, s) {
    const C = CATS[catId];
    const typeId = this.pickType ? this.pickType(catId, this.rand) : pickTypeId(catId, this.rand);
    const c = {
      n: this.nextId, ttT: 0, ttY: 0,
      id: `wmt-${this.nextId++}`, catId, cat: C, typeId, plan, from: plan.from, to: plan.to, s, cur: { i: 0 },
      v: 0, state: 'fly', x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, hdg: 0, pitch: 0, bank: 0, onGround: false, gear: 0, flaps: 0,
      phase: 'climb', ox: 0, oz: 0, oy: 0, threatT: 0, holdU: 0, holdT: 0, holdLaps: 0, stack: 0, holdY: 0, holdX: 0, holdZ: 0, holdDx: 1, holdDz: 0, diverts: 0, goArounds: 0,
      parkedT: 0, knocked: false, gone: false, railX: 0, railZ: 0, railY: 0, avoiding: false, lastHdg: null,
      callsign: '', livery: null, data: {},
    };
    this._rail(c, 0);
    c.v = speedAt(plan, s, c.railY);
    this._rail(c, 0);
    c.x = c.railX;
    c.y = c.railY;
    c.z = c.railZ;
    c.hdg = compass(P0.dx, P0.dz);
    return c;
  }

  /** Where the rails put it now (railX/Y/Z and the direction), in the hold or along the route. */
  _rail(c, dt) {
    const plan = c.plan;
    if (c.state === 'hold') {
      const C = c.cat;
      const r = c.holdR;
      c.holdU += c.v * dt;
      const ph = c.holdU / r;
      // A right-hand circle from where the route is at the join point (the middle of the turn there, not the
      // corner the turn cuts), heading the way it was, back to it the same way: no jump going in or coming out.
      const ux = c.holdDx;
      const uz = c.holdDz;
      const ccx = c.holdX + r * -uz;
      const ccz = c.holdZ + r * ux;
      const rx = c.holdX - ccx;
      const rz = c.holdZ - ccz;
      const co = Math.cos(ph);
      const sn = Math.sin(ph);
      c.railX = ccx + rx * co - rz * sn;
      c.railZ = ccz + rx * sn + rz * co;
      c.rdx = ux * co - uz * sn;
      c.rdz = ux * sn + uz * co;
      const want = altAt(plan, plan.sJ) + c.stack * STACK_M;
      const dy = clamp(want - c.holdY, -C.maxVs * 0.6 * dt, C.maxVs * 0.6 * dt);
      c.holdY += dy;
      c.railY = c.holdY;
      c.rvy = dt > 0 ? dy / dt : 0;
      return;
    }
    const s0 = c.s;
    evalPath(plan.path, c.s, P0, c.cur);
    c.railX = P0.x;
    c.railZ = P0.z;
    c.rdx = P0.dx;
    c.rdz = P0.dz;
    const y = altAt(plan, s0);
    const ahead = altAt(plan, s0 + 20);
    c.railY = y;
    c.rvy = ((ahead - y) / 20) * c.v;
  }

  /** The routing decisions: the runway rule, the sequence, the hold, a divert, the despawn. */
  _decide(c, s0, ctx) {
    const plan = c.plan;
    const to = plan.to;
    if (c.state === 'fly') {
      // Reaching the join point: in, or hold.
      if (s0 < plan.sJ && c.s >= plan.sJ) {
        // Not back at its level (a level change for someone else): it holds there until it is.
        const why = this.nearPlayer(to, ctx, 500) ? 'player' : this._finalBusy(c) || Math.abs(c.oy) > 60 ? 'sequence' : '';
        if (why) {
          c.s = plan.sJ;
          this._startHold(c, why);
          return;
        }
      }
      // Past it and you come close: around, away from you, and hold.
      if (c.s > plan.sJ && s0 < plan.sTD && this.nearPlayer(to, ctx)) {
        this._goAround(c, ctx);
        return;
      }
      // Not back on the centreline by the gate (a step aside for you): around, and in again.
      if (s0 < plan.sG && c.s >= plan.sG && Math.hypot(c.ox, c.oz) > 250) {
        this._goAround(c, ctx);
        return;
      }
      // A long final out of sight: gone.
      if (s0 < plan.sD && c.s >= plan.sD && this.hidden(c.x, c.y, c.z, ctx)) {
        this._despawn(c, 'final');
        return;
      }
      if (s0 < plan.sTD && c.s >= plan.sTD) {
        c.onGround = true;
        this.stats.landed++;
        this._ev('touchdown', c, { field: to.id, x: Math.round(c.x), z: Math.round(c.z), playerToField: ctx && ctx.player ? Math.round(Math.hypot(to.x - ctx.player.x, to.z - ctx.player.z)) : null });
      }
      if (c.s >= plan.sP - 0.5) {
        c.v = 0;
        c.state = 'parked';
        c.parkedT = 0;
      }
    } else if (c.state === 'hold') {
      const r = c.holdR;
      const lap = 2 * Math.PI * r;
      if (c.holdU >= lap) {
        c.holdU -= lap;
        c.holdLaps++;
        const why = this.nearPlayer(to, ctx, 1500) ? 'player' : this._finalBusy(c) ? 'sequence' : '';
        // A level change for someone else still on: one more lap.
        if (!why && c.stack === 0 && !(c.ttT > 0)) {
          // Out of the hold, onto the approach, at the join point.
          c.state = 'fly';
          c.s = plan.sJ + 1;
          c.cur.i = 0;
          c._new = true;
          // Still stepping down from a higher level of the stack: eased onto the profile, not dropped onto it.
          c.oy = c.holdY + c.oy - altAt(plan, c.s);
          this._releaseStack(c);
          return;
        }
        if (c.holdT > HOLD_MAX || (why === 'player' && c.holdLaps >= 2)) this._divert(c, ctx);
      }
    } else if (c.state === 'parked') {
      if (this.hidden(c.x, c.y, c.z, ctx)) this._despawn(c, 'parked');
    }
  }

  /** Someone else on this runway's final, or about to be (or on its pad). */
  _finalBusy(c) {
    const id = c.plan.to.id;
    for (const o of this.list) {
      if (o === c || o.gone || o.knocked || o.plan.to.id !== id) continue;
      if (o.state === 'fly' && o.s > o.plan.sJ && o.s < o.plan.sE - 1) return true;
      if (c.plan.heli && (o.state === 'parked' || o.onGround)) return true;
    }
    return false;
  }

  _startHold(c, why) {
    const plan = c.plan;
    let k = 0;
    // Over everyone holding for that field, airliner or light aircraft alike.
    for (const o of this.list) if (o !== c && !o.gone && o.state === 'hold' && o.plan.to.id === plan.to.id) k = Math.max(k, o.stack + 1);
    c.state = 'hold';
    c.stack = k;
    c.holdU = 0;
    c.holdT = 0;
    c.holdLaps = 0;
    c.holdY = c.railY;
    c.holdR = Math.max(500, turnRadius(c.cat.vApp, c.cat.bank));
    evalPath(plan.path, plan.sJ, P0, { i: 0 });
    c.holdX = P0.x;
    c.holdZ = P0.z;
    c.holdDx = P0.dx;
    c.holdDz = P0.dz;
    // On the circle from this frame on (step() puts it back on its rails at once).
    c._new = true;
    this.stats.holds++;
    this._ev('hold', c, { field: plan.to.id, why, stack: k });
  }

  /** The bottom of the stack goes in: everybody above steps down one. */
  _releaseStack(c) {
    const id = c.plan.to.id;
    for (const o of this.list) if (o !== c && !o.gone && o.state === 'hold' && o.plan.to.id === id && o.stack > 0) o.stack--;
  }

  _goAround(c, ctx) {
    const C = c.cat;
    const P = ctx && ctx.player;
    // Turn 40 degrees off the final, to the side away from you.
    let side = 1;
    if (P) {
      const cr = c.rdx * (P.z - c.z) - c.rdz * (P.x - c.x);
      side = cr > 0 ? -1 : 1;
    }
    const a = 40 * DEG * side;
    const dx = c.rdx * Math.cos(a) - c.rdz * Math.sin(a);
    const dz = c.rdx * Math.sin(a) + c.rdz * Math.cos(a);
    const start = { x: c.x, z: c.z, alt: c.y, dx, dz, hx: c.rdx, hz: c.rdz, v: Math.max(c.v, C.vApp), lead: Math.max(2500, turnRadius(C.vApp, C.bank) * 1.5) };
    const plan = this._plan(c.catId, null, c.plan.to, { start, cruiseCap: altAt(c.plan, c.plan.sJ) + 300 });
    if (!plan) return this._despawn(c, 'no-plan');
    c.goArounds++;
    this.stats.goArounds++;
    this._ev('goAround', c, { field: c.plan.to.id, x: Math.round(c.x), z: Math.round(c.z) });
    this._reroute(c, plan);
  }

  _divert(c, ctx) {
    const C = c.cat;
    const pairs = this.pairs[c.catId] || [];
    const here = c.plan.to;
    const opts = [];
    const seen = new Set();
    for (const [a, b] of pairs) {
      for (const e of [a, b]) {
        if (e === here || seen.has(e.id)) continue;
        seen.add(e.id);
        const d = Math.hypot(e.x - c.x, e.z - c.z);
        if (d < 8000 || d > (Number.isFinite(C.maxLeg) ? C.maxLeg : 250000)) continue;
        if (this.nearPlayer(e, ctx, 3000)) continue;
        opts.push({ e, d });
      }
    }
    if (!opts.length) {
      // Nowhere to go: it keeps holding (and goes at the next out-of-sight moment).
      c.holdT = 0;
      if (this.hidden(c.x, c.y, c.z, ctx)) this._despawn(c, 'no-divert');
      return;
    }
    opts.sort((p, q) => p.d - q.d);
    const pick = opts[Math.min(opts.length - 1, Math.floor(this.rand() * Math.min(3, opts.length)))].e;
    const start = { x: c.x, z: c.z, alt: c.y, dx: c.rdx, dz: c.rdz, v: c.v };
    const plan = this._plan(c.catId, null, pick, { start });
    if (!plan) return this._despawn(c, 'no-plan');
    this._releaseStack(c);
    c.diverts++;
    this.stats.diverts++;
    this._ev('divert', c, { field: here.id, to: pick.id });
    this._reroute(c, plan);
  }

  _reroute(c, plan) {
    c.plan = plan;
    c.to = plan.to;
    // The new route starts where it is: this frame's distance along it already flown (no one-frame stop).
    c.s = Math.min(plan.path.len * 0.5, c.v * (this._dt || 0));
    c.cur.i = 0;
    c.state = 'fly';
    c.stack = 0;
    c._new = true;
    // The avoidance offset is folded into the new route's start (it starts where the aircraft is).
    c.ox = 0;
    c.oz = 0;
    c.oy = 0;
  }

  _despawn(c, why) {
    if (c.gone) return;
    if (c.state === 'hold') this._releaseStack(c);
    c.gone = true;
    c.state = 'gone';
    this.stats.despawned++;
    this._ev('despawn', c, { why, x: Math.round(c.x), z: Math.round(c.z) });
  }

  /** Knocked by a collision (sky.js): off its rails, falling. */
  knock(c) {
    if (c.knocked || c.gone) return;
    c.knocked = true;
    c.state = 'knocked';
    this.stats.knocked++;
    this._ev('knocked', c, {});
  }

  /** The TCAS-like step aside: offsets towards where they keep you clear, eased back when clear. */
  _avoid(c, dt, ctx) {
    const P = ctx && ctx.player;
    const C = c.cat;
    const onFinal = c.state === 'fly' && c.s >= c.plan.sG;
    const ground = c.onGround || (c.state === 'fly' && c.s >= c.plan.sTD);
    let tx = 0;
    let tz = 0;
    let ty = 0;
    let threat = false;
    if (P && !ground) {
      const rx = c.x - P.x;
      const ry = c.y - P.y;
      const rz = c.z - P.z;
      const dh0 = Math.hypot(rx, rz);
      if (dh0 < 25000) {
        const wx = c.vx - (P.vx || 0);
        const wy = c.vy - (P.vy || 0);
        const wz = c.vz - (P.vz || 0);
        const w2 = wx * wx + wz * wz;
        const t = w2 > 1e-3 ? clamp(-(rx * wx + rz * wz) / w2, 0, LOOK_S) : 0;
        const hx = rx + wx * t;
        const hz = rz + wz * t;
        const dh = Math.hypot(hx, hz);
        const dv = ry + wy * t;
        const near = dh0 < SEP_H * 1.3 && Math.abs(ry) < SEP_V * 1.7;
        const cpa = dh < SEP_H * 1.3 && Math.abs(dv) < SEP_V * 1.7;
        const sep = Math.max(dh0 / SEP_H, Math.abs(ry) / SEP_V);
        if (sep < this.stats.minSep3) this.stats.minSep3 = sep;
        if (Math.abs(ry) < SEP_V && dh0 < this.stats.minSepH) this.stats.minSepH = dh0;
        if (near || cpa) {
          if (onFinal && c.y - c.plan.elev > 40) {
            this._goAround(c, ctx);
            return;
          }
          if (c.threatT <= 0) {
            this.stats.avoid++;
            c.sense = ry >= 0 ? 1 : -1;
            // Not down into the ground: under you and low, it climbs past instead... unless you are climbing at it.
            const floor = groundAt(c.plan, c.s) + 150;
            if (c.sense < 0 && P.y - SEP_V - 250 < floor) c.sense = 1;
            c.away = dh > 50 ? { x: hx / dh, z: hz / dh } : { x: -c.rdz, z: c.rdx };
          }
          c.threatT = 6;
          threat = true;
        }
      }
    }
    if (c.threatT > 0) {
      c.threatT -= dt;
      threat = true;
    }
    if (threat && P) {
      // A height step away from yours, and sideways away from where you will be.
      const want = P.y + c.sense * (SEP_V + 250);
      ty = c.sense > 0 ? Math.max(c.oy, want - c.railY) : Math.min(c.oy, want - c.railY);
      const lat = Math.min(2500, SEP_H * 1.5);
      tx = c.away.x * lat;
      tz = c.away.z * lat;
      if (onFinal) {
        tx = c.ox;
        tz = c.oz;
      }
    }
    c.avoiding = threat;
    // Clear of you but not of another: the level change for that one (still on its own track).
    let tt = false;
    if (!threat && c.ttT > 0 && this._canStep(c)) {
      ty = c.ttY;
      tt = true;
    } else if (c.ttT > 0 && !this._canStep(c)) c.ttT = 0;
    // Ease towards the targets: the type's own climb rate, sin 35° of its speed sideways; back at half that.
    const k = threat || tt ? 1 : 0.5;
    const vy = C.maxVs * k * dt;
    const vl = Math.max(4, c.v * (C.side || 0.57)) * k * dt;
    c.oy += clamp(ty - c.oy, -vy, vy);
    const ex = tx - c.ox;
    const ez = tz - c.oz;
    const el = Math.hypot(ex, ez);
    if (el > 1e-6) {
      const m = Math.min(el, vl) / el;
      c.ox += ex * m;
      c.oz += ez * m;
    }
    // Never down into the ground.
    const g = c.state === 'hold' ? 0 : groundAt(c.plan, c.s);
    if (c.railY + c.oy < g + 150 && c.oy < 0) c.oy = Math.min(0, g + 150 - c.railY);
  }

  /** One frame. */
  step(dt, ctx = {}) {
    if (!(dt > 0)) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    if (dt > 1) dt = 1;
    this._dt = dt;
    this.clock += dt;
    if (ctx.windDirDeg != null) this.windDirDeg = ctx.windDirDeg;
    for (let i = 0; i < this.list.length; i++) {
      const c = this.list[i];
      if (c.gone) continue;
      if (c.knocked) {
        this._fall(c, dt);
        continue;
      }
      const C = c.cat;
      const plan = c.plan;
      const px = c.x;
      const py = c.y;
      const pz = c.z;
      // Speed: towards what the route wants, at the type's rate (harder on the runway).
      const vT = c.state === 'hold' ? C.vApp : c.state === 'parked' ? 0 : speedAt(plan, c.s, c.railY);
      const acc = c.onGround ? 2.2 : C.accel;
      c.v += clamp(vT - c.v, -acc * dt, acc * dt);
      if (c.state === 'parked') {
        c.v = 0;
        c.parkedT += dt;
      }
      const s0 = c.s;
      if (c.state === 'fly') c.s = Math.min(plan.sP, c.s + c.v * dt);
      if (c.state === 'hold') c.holdT += dt;
      this._rail(c, dt);
      this._decide(c, s0, ctx);
      if (c.gone || c.knocked) continue;
      // _decide may have rerouted it (a go-around, a divert): on the new rails now.
      if (c._new) {
        c._new = false;
        this._rail(c, 0);
      }
      this._avoid(c, dt, ctx);
      if (c.gone) continue;
      if (c._new) {
        c._new = false;
        this._rail(c, 0);
      }
      c.x = c.railX + c.ox;
      c.y = c.railY + c.oy;
      c.z = c.railZ + c.oz;
      if (c.state === 'fly' && c.s >= plan.sTD && !plan.heli) c.y = plan.elev;
      c.onGround = (c.state === 'fly' && c.s >= plan.sTD) || c.state === 'parked';
      // What it is doing, as the map and the tests read it.
      c.phase = this._phase(c);
      // Velocity and attitude, from how it moved (the rails and the offset together).
      const vx = (c.x - px) / dt;
      const vy = (c.y - py) / dt;
      const vz = (c.z - pz) / dt;
      if (vx * vx + vz * vz < 1e8) {
        c.vx = vx;
        c.vy = vy;
        c.vz = vz;
      } else {
        // A reroute or the first frame: the rails' own direction.
        c.vx = c.rdx * c.v;
        c.vz = c.rdz * c.v;
        c.vy = 0;
      }
      const gs = Math.hypot(c.vx, c.vz);
      const h = gs > 1 ? compass(c.vx, c.vz) : compass(c.rdx, c.rdz);
      const turn = c.lastHdg == null ? 0 : adiff(c.lastHdg, h) / dt;
      // The nose follows the track at no more than HDG_RATE: a step aside starting (or ending) is a turn, not a
      // one-frame twitch of the model.
      c.hdg = c.lastHdg == null ? h : (c.hdg + clamp(adiff(c.hdg, h), -HDG_RATE * dt, HDG_RATE * dt) + 360) % 360;
      c.lastHdg = h;
      const wantBank = c.onGround ? 0 : clamp((Math.atan((gs * turn * DEG) / G) / DEG), -C.bank - 5, C.bank + 5);
      c.bank += clamp(wantBank - c.bank, -15 * dt, 15 * dt);
      const gam = gs > 5 ? Math.atan2(c.vy, gs) / DEG : 0;
      const appr = c.state === 'hold' || (c.state === 'fly' && c.s >= plan.sJ - 3000);
      const wantPitch = c.onGround ? 0 : gam + (appr ? C.appAoa : C.aoa);
      c.pitch += clamp(wantPitch - c.pitch, -6 * dt, 6 * dt);
      const gearWant = c.onGround || (c.state === 'fly' && c.s >= plan.sG - 2000) ? 1 : 0;
      c.gear += clamp(gearWant - c.gear, -dt / 7, dt / 7);
      c.flaps = appr ? (c.s >= plan.sG ? 1 : 0.5) : 0;
    }
    // Tidy the ones that have gone.
    for (let i = this.list.length - 1; i >= 0; i--) if (this.list[i].gone) this.list.splice(i, 1);
    // From each other, every half second.
    for (const c of this.list) if (c.ttT > 0) c.ttT -= dt;
    this.ttT -= dt;
    if (this.ttT <= 0) {
      this.ttT = TT_EVERY;
      this._separate();
    }
    // Keep the sky full: one at a time, every couple of seconds, out of sight.
    this.spawnT -= dt;
    if (this.spawnT <= 0) {
      this.spawnT = 1.5 + this.rand() * 2.5;
      if (this.list.length < this.n) this.spawn(ctx, 'hidden');
    }
    if (t0) this.stats.stepMs = this.stats.stepMs * 0.95 + (performance.now() - t0) * 0.05;
  }

  /** The flight start: fill the sky at once, on routes, away from you. */
  populate(ctx) {
    let guard = this.n * 6;
    while (this.list.length < this.n && guard-- > 0) this.spawn(ctx, 'start');
  }

  _phase(c) {
    if (c.knocked) return 'falling';
    if (c.state === 'hold') return 'holding';
    if (c.state === 'parked') return 'parked';
    const p = c.plan;
    if (c.s >= p.sTD) return p.heli ? 'landed' : 'landing';
    if (c.s >= p.sG) return 'final';
    if (c.s >= p.sJ - 2000) return 'approach';
    if (c.avoiding) return 'avoiding';
    const a = altAt(p, c.s);
    const ahead = altAt(p, c.s + 2000);
    if (ahead > a + 20) return 'climb';
    if (ahead < a - 20) return 'descent';
    return 'cruise';
  }

  _fall(c, dt) {
    c.vy -= 6 * dt;
    if (c.vy < -40) c.vy = -40;
    const k = Math.max(0, 1 - 0.25 * dt);
    c.vx *= k;
    c.vz *= k;
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    c.z += c.vz * dt;
    c.bank = Math.min(70, c.bank + 20 * dt);
    c.pitch = Math.max(-35, c.pitch - 8 * dt);
    const g = Math.max(0, this.ground(c.x, c.z));
    if (c.y <= g + 1) {
      c.y = g + 1;
      this._despawn(c, 'knocked');
    }
  }

  /** Remove everybody. */
  clear() {
    for (const c of this.list) c.gone = true;
    this.list.length = 0;
  }
}

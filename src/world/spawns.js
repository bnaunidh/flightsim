/**
 * Where a Free Flight may start, by aircraft class — data and a pure resolver.
 *
 * Today every aeroplane starts lined up on runway 09 (RUNWAY_START), a
 * helicopter on the field pad, and a military jet on the carrier if you ask.
 * This is the rest of it: an airliner at a gate, nose-in to the jet bridge;
 * a light aeroplane on the GA stands or in a hangar; a jet on the air base's
 * flight line; a helicopter on any pad the map names; a seaplane (when there
 * is one) at the harbour. The runtime (features/spawns.js) and its "Start
 * at" picker are built on this file, and so is tests/features/spawns.mjs,
 * which resolves every map × every class with no page.
 *
 * THE DATA ARE SEMANTIC, NOT COORDINATES. `{ stand: 'contact', size: 'heavy' }`,
 * `{ pad: 'hospital' }`, `'carrier'`, `{ base: 'shelter' }`,
 * `{ hover: 'offshore', agl: 150 }`. Each is resolved against what the loaded
 * map actually has — airportLayout()'s stands and hangars, the pads list,
 * harbourBerth(), the carrier's berth and the air base — so when the phase-2
 * re-layouts move a stand or a pad, the spawn moves with it and nobody has to
 * re-key a number. Coordinates appear nowhere in SPAWN_DEFAULTS or SPAWNS.
 *
 * CLASSES (spawnClassOf, in this order):
 *   heli      class Helicopter
 *   airliner  category or class Airliner
 *   military  `military`, category military, or class Fighter / Carrier
 *   water     an `amphibian` or `floats` flag (no type has one yet)
 *   open      span over 90 m or a `huge` flag (the queued CL-1201)
 *   light     everything else — Trainer, Tourer, Racer, special
 *
 * CLEAR. A point is clear when it is not inside an obstacle box (margin
 * span/2 + 5 m; on a stand, the aeroplane's own nose-to-tail plan with 5 m
 * round it: footprintOf), not on a stand the airport has parked its own aeroplane on,
 * not within span/2 + 5 m of any traffic aeroplane, not on a runway (unless
 * it IS the runway fallback), and dry and level for its kind — land, a deck
 * or roof platform, or water at least 3 m deep for the water class.
 *
 * PLACEMENT. An airliner goes nose-in with its nose NOSE_STOP short of the
 * stand's nose line, the same arithmetic the apron and the traffic use with
 * the type's plan.nose. The height is never written here: the runtime calls
 * aircraft.reset({ altAGL: null }) and settleOnGear puts it on its wheels.
 *
 * FALLBACK. If nothing fits, the answer is today's start — the runway, 80 m
 * in from the 09 threshold — flagged `fallback: true` so a test can list it.
 */

import { heightAt, platformAt, OBSTACLES, MAP, AIRPORT, isOnAnyRunway, harbourBerth } from './terrain.js';
import { airportLayout, standFits, standTaken, NOSE_STOP } from './airport-layout.js';
import { RUNWAY } from './airport.js';
import { PADS } from './pads.js';
import { chooseBerth } from './carrier-berth.js';
import { DECK } from './carrier.js';
import { getAircraft, performanceFor } from '../aircraft/types.js';

/** Every class, in the order spawnClassOf() decides them. */
export const CLASSES = Object.freeze(['heli', 'airliner', 'military', 'water', 'open', 'light']);

/** Metres kept between a spawned aeroplane and anything solid, over its half span. */
export const CLEAR_MARGIN = 5;
/** The water class wants at least this under it. */
export const WATER_DEPTH = 3;
/** How far the hover start is off the 09 threshold, metres, into wind. */
export const HOVER_OFF = 1500;

/* ------------------------------------------------------------------ */
/* Classes                                                             */
/* ------------------------------------------------------------------ */

export function spawnClassOf(type) {
  if (!type) return 'light';
  const cls = String(type.class || '').toLowerCase();
  const cat = String(type.category || '').toLowerCase();
  if (/heli|rotor/.test(cls) || (type.shape && type.shape.power && type.shape.power.rotor)) return 'heli';
  if (cat === 'airliner' || cls === 'airliner') return 'airliner';
  if (type.military || cat === 'military' || cls === 'fighter' || cls === 'carrier') return 'military';
  if (type.amphibian || type.floats) return 'water';
  const span = (type.plan && type.plan.span) || (type.aero && type.aero.wingSpan) || 0;
  if (type.huge || span > 90) return 'open';
  return 'light';
}

/* ------------------------------------------------------------------ */
/* Data                                                                */
/* ------------------------------------------------------------------ */

/**
 * Per class, the places tried in order. Each entry is a semantic reference;
 * resolveRef() turns one into zero or more candidate points on the map that
 * is loaded. The runway fallback is always appended by candidatesFor().
 */
export const SPAWN_DEFAULTS = Object.freeze({
  airliner: [
    { stand: 'contact', bridge: true },
    { stand: 'remote' },
  ],
  light: [
    { stand: 'light' },
    { stand: 'any' },
    { hangar: 'front' },
    { strip: 'outpost' },
  ],
  military: [
    'carrier',
    { base: 'shelter' },
    { stand: 'any' },
  ],
  heli: [
    { pad: 'field' },
    { pad: 'ground' },
    { pad: 'hospital' },
    { pad: 'roof' },
    { pad: 'deck' },
  ],
  water: [
    { harbour: 'berth' },
  ],
  open: [
    { hover: 'offshore', agl: 150 },
    { apron: 'open' },
  ],
});

/**
 * Map overrides: a class's list is REPLACED by the map's. Everything stays a
 * reference; the base's shelters, the hover pads and the decks are looked up
 * live, so phase 2 may move any of them.
 */
export const SPAWNS = Object.freeze({
  airbase: {
    military: [{ base: 'shelter' }, 'carrier', { stand: 'any' }],
    // Medium remote stands take an A320 or a Meridian; a heavy falls back to the runway.
    airliner: [{ stand: 'remote', size: 'medium' }],
  },
  northwatch: {
    military: [{ base: 'shelter' }, { pad: 'hover1' }, { pad: 'hover2' }, 'carrier'],
  },
  gateway: {
    airliner: [
      { stand: 'contact', size: 'heavy', bridge: true },
      { stand: 'contact', size: 'medium', bridge: true },
      { stand: 'remote' },
    ],
  },
  carriergroup: {
    military: ['carrier', { stand: 'any' }],
    heli: [{ pad: 'field' }, { pad: 'hospital' }, { pad: 'deck' }],
  },
  rigs: {
    heli: [{ pad: 'field' }, { pad: 'flotel' }, { pad: 'deck' }, { pad: 'hospital' }],
  },
  stacks: {
    heli: [{ pad: 'hospital' }, { pad: 'field' }, { pad: 'ground' }],
  },
  ravencrag: {
    heli: [{ pad: 'hospital' }, { pad: 'field' }, { pad: 'ground' }],
  },
  meridian: {
    heli: [{ pad: 'plaza' }, { pad: 'field' }, { pad: 'hospital' }, { pad: 'roof' }],
  },
  // The World Map preview: the departure's own pad, the rigs (out at sea,
  // there is no field near them to start from), then the nearest pads of any
  // kind (its pads are listed nearest the departure first: worldmap/preview.js).
  'world-preview': {
    heli: [{ pad: 'field' }, { pad: 'deck' }, { pad: 'any' }],
  },
});

/** The picker's named choices, by class: id → the refs that choice means. */
export const CHOICES = Object.freeze({
  airliner: [
    { id: 'gate', label: 'Gate (jet bridge)', refs: [{ stand: 'contact', bridge: true }] },
    { id: 'remote', label: 'Remote stand', refs: [{ stand: 'remote' }] },
  ],
  light: [
    { id: 'ga', label: 'GA apron', refs: [{ stand: 'light' }, { stand: 'any' }] },
    { id: 'hangar', label: 'Hangar', refs: [{ hangar: 'front' }] },
    { id: 'strip', label: 'Outpost strip', refs: [{ strip: 'outpost' }] },
  ],
  military: [
    { id: 'carrier', label: 'Carrier', refs: ['carrier'] },
    { id: 'base', label: 'Air-base flight line', refs: [{ base: 'shelter' }] },
    { id: 'ga', label: 'Apron stand', refs: [{ stand: 'any' }] },
  ],
  heli: [], // one per pad, built by spawnChoices()
  water: [
    { id: 'dock', label: 'Harbour dock', refs: [{ harbour: 'berth' }] },
  ],
  open: [
    { id: 'hover', label: 'Offshore, airborne', refs: [{ hover: 'offshore', agl: 150 }] },
    { id: 'apron', label: 'Open apron', refs: [{ apron: 'open' }] },
  ],
});

/**
 * The refs a class tries on a map, overrides first, the runway last.
 *
 * A type that says how much runway it needs (`minRunway`, the giants in
 * aircraft/extra/giants.js) changes two things, and only for itself:
 *   - on a map whose main runway is shorter, it starts in the air offshore
 *     (300 m up, lined up for 09) — a stand it could never take off from is
 *     no start at all;
 *   - where no stand fits it (the An-225 is 88 m across, the C-5 75 m long
 *     on 74 m stands), the open apron of a hub comes before the runway.
 * A type marked `carrier: false` (the B-1B Lancer, aircraft/extra/lancer.js:
 * 42 m across, no hook, no catapult bar) never starts on the carrier's deck;
 * the rest of its class's list is unchanged.
 * `type` is optional; without one the lists are exactly as before.
 */
export function candidatesFor(mapId, cls, type = null) {
  const over = SPAWNS[mapId] && SPAWNS[mapId][cls];
  let list = over || SPAWN_DEFAULTS[cls] || SPAWN_DEFAULTS.light;
  if (type && type.carrier === false) list = list.filter((ref) => ref !== 'carrier');
  const need = type && Number(type.minRunway);
  if (!need) return [...list, 'runway'];
  const pre = runwayLength() < need ? [{ hover: 'offshore', agl: 300 }] : [];
  return [...pre, ...list, { apron: 'open' }, 'runway'];
}

/** The loaded map's main runway, metres (the one every runway start and hover start uses). */
export function runwayLength() {
  return (RUNWAY && RUNWAY.length) || (AIRPORT && AIRPORT.runway && AIRPORT.runway.length) || 0;
}

/** True when this type needs more runway than the loaded map's main one. */
export function needsLongerRunway(type) {
  const need = type && Number(type.minRunway);
  return !!need && runwayLength() < need;
}

/* ------------------------------------------------------------------ */
/* The aircraft's size                                                 */
/* ------------------------------------------------------------------ */

/**
 * A big jet (wave 18): 50 m across or 60 m long and more — the A380, the
 * BelugaXL, the 747, the C-17, the An-225, the C-5. Only a Code F field
 * (world/airport-layout.js CODE_F: the hubs) gives one a gate, a stand, a
 * hangar, the open apron or a taxi start; anywhere else it is lined up on the
 * runway, and told why (bigJetNote).
 */
export function isBigJet(type) {
  const t = typeof type === 'string' ? getAircraft(type) : type;
  if (!t) return false;
  const z = sizeOf(t);
  return z.span >= 50 || z.length >= 60;
}

/** The word for a big jet lined up on the runway because this field's taxiways are too small for it. */
export function bigJetNote(type, mapName = (MAP && MAP.name) || 'this field') {
  const t = typeof type === 'string' ? getAircraft(type) : type;
  return `The ${(t && t.name) || 'aeroplane'} is too big for ${mapName}'s taxiways and gates — lined up on the runway instead.`;
}

/** Does this field take big jets on the ground (Code F taxiways)? */
export function fieldTakesBigJets(lay = safeLayout()) {
  return !!(lay && lay.codeF);
}

/** Span, length and nose offset for a type (the plan first, the aero after). */
export function sizeOf(type) {
  const t = typeof type === 'string' ? getAircraft(type) : type || getAircraft();
  const p = t.plan;
  const span = (p && p.span) || (t.aero && t.aero.wingSpan) || 12;
  const nose = p && Number.isFinite(p.nose) ? p.nose : -span * 0.25;
  const tail = p && Number.isFinite(p.tail) ? p.tail : span * 0.4;
  return { type: t, span, length: tail - nose, nose, tail };
}

/* ------------------------------------------------------------------ */
/* Clear?                                                              */
/* ------------------------------------------------------------------ */

const D2R = Math.PI / 180;

function groundAt(x, z) {
  const p = platformAt(x, z);
  if (p) return { y: p.y, platform: p };
  return { y: heightAt(x, z), platform: null };
}

/**
 * The reasons a point is not clear, or an empty list. `pt` is
 * { x, z, headingDeg, kind, span, length }; `ctx.traffic` is sim.traffic.
 */
export function clearReasons(pt, ctx = {}) {
  const out = [];
  const span = pt.span || 12;
  const m = span / 2 + CLEAR_MARGIN;
  const x = pt.x;
  const z = pt.z;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return ['not a point'];
  // The carrier's deck: the ship is built on every map and carrier-ops places
  // the jet on its catapult itself. Nothing on the ground is asked.
  if (pt.kind === 'carrier') return out;
  const g = groundAt(x, z);
  const y = g.y;

  if (pt.kind === 'water') {
    if (!(heightAt(x, z) <= -WATER_DEPTH)) out.push(`water ${(-heightAt(x, z)).toFixed(1)} m deep (needs ${WATER_DEPTH})`);
  } else if (pt.kind === 'hover') {
    const h = Math.max(0, heightAt(x, z));
    if (!(pt.agl > 60)) out.push('hover start too low');
    if (h > 400) out.push('hover start over high ground');
  } else {
    // Dry and level: the middle and the four points span/2 out, within 1.5 m.
    if (!g.platform && !(y > 1.5)) out.push(`wet ground (${y.toFixed(1)} m)`);
    const r = Math.max(3, span / 2);
    let lo = y;
    let hi = y;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const gg = groundAt(x + dx, z + dz);
      // A roof or deck pad is level by construction; its edge may fall to the ground.
      if (g.platform && gg.platform !== g.platform) continue;
      if (gg.y < lo) lo = gg.y;
      if (gg.y > hi) hi = gg.y;
    }
    if (hi - lo > 1.5) out.push(`not level (${(hi - lo).toFixed(1)} m across ${Math.round(2 * r)} m)`);
  }

  if (pt.kind !== 'runway' && pt.kind !== 'hover' && isOnAnyRunway(x, z, span / 2)) out.push('on a runway');

  // Solid things, with the aircraft's half span and a margin round them, at
  // its own height: a hangar's lintel over the door is above a parked trainer,
  // and a rig's plant module or a hospital's walls end UNDER the pad on top.
  // On a stand, an obstacle the square catches is asked again against the
  // aeroplane's own plan (see footprintHits): the square round the middle of
  // an A380 (45 m each way) reached the floodlight masts at the back of the
  // apron, ahead of its nose, on every heavy gate at Gateway.
  if (pt.kind !== 'hover') {
    const top = y + 8;
    const plan = pt.kind === 'stand' ? footprintOf(pt) : null;
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      if (o.y0 > top || o.y1 <= y + 0.5) continue;
      if (x >= o.x0 - m && x <= o.x1 + m && z >= o.z0 - m && z <= o.z1 + m) {
        if (plan && !footprintHits(plan, o)) continue;
        out.push(`inside ${o.what || 'an obstacle'} (+${m.toFixed(0)} m)`);
        break;
      }
    }
  }

  // The airport's own aeroplane on this stand.
  if (pt.stand && standTaken(pt.stand)) out.push(`${pt.stand.id} is taken`);

  // The traffic, parked or rolling.
  const tr = ctx.traffic;
  if (Array.isArray(tr)) {
    for (let i = 0; i < tr.length; i++) {
      const t = tr[i];
      if (!t || !t.pos) continue;
      const d = Math.hypot(t.pos.x - x, t.pos.z - z);
      const r = m + ((t.span || 12) / 2);
      if (d < r) {
        out.push(`traffic ${t.callsign || t.id || ''} ${d.toFixed(0)} m away`);
        break;
      }
    }
  }
  return out;
}

/*
 * THE PLAN OF A NOSE-IN AEROPLANE. A stand start knows exactly where the
 * aeroplane is: its heading, and from the type's plan how far the nose is
 * ahead of the origin and the tail behind it. Its outline from above is then
 * a rectangle, nose to tail by wingtip to wingtip, which holds every part of
 * it (the wing, the tailplane, the engines); CLEAR_MARGIN is kept all round.
 * The square test above is a disc's worth of span round the middle, which
 * for a long, wide aeroplane reaches well past its nose. Only a stand point
 * with a nose and a tail is asked this way; everything else keeps the square.
 */
export function footprintOf(pt) {
  if (!pt || !Number.isFinite(pt.headingDeg) || !Number.isFinite(pt.nose) || !Number.isFinite(pt.tail)) return null;
  const h = pt.headingDeg * D2R;
  return {
    x: pt.x, z: pt.z,
    fx: Math.sin(h), fz: -Math.cos(h),
    // Along the nose (forward +): from the tail to the nose tip, plus the margin.
    a0: -pt.tail - CLEAR_MARGIN, a1: -pt.nose + CLEAR_MARGIN,
    // Across: half the span plus the margin.
    b: (pt.span || 12) / 2 + CLEAR_MARGIN,
  };
}

/** Does an obstacle box (x0..x1, z0..z1) overlap the plan? Separating axes: the box's two and the plan's two. */
export function footprintHits(p, o) {
  const rx = -p.fz;
  const rz = p.fx;
  // The plan's corners, for the box's axes.
  let minX = Infinity; let maxX = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const a of [p.a0, p.a1]) {
    for (const b of [-p.b, p.b]) {
      const cx = p.x + p.fx * a + rx * b;
      const cz = p.z + p.fz * a + rz * b;
      if (cx < minX) minX = cx;
      if (cx > maxX) maxX = cx;
      if (cz < minZ) minZ = cz;
      if (cz > maxZ) maxZ = cz;
    }
  }
  if (maxX < o.x0 || minX > o.x1 || maxZ < o.z0 || minZ > o.z1) return false;
  // The box's corners, for the plan's axes.
  let a0 = Infinity; let a1 = -Infinity; let b0 = Infinity; let b1 = -Infinity;
  for (const cx of [o.x0, o.x1]) {
    for (const cz of [o.z0, o.z1]) {
      const dx = cx - p.x;
      const dz = cz - p.z;
      const a = dx * p.fx + dz * p.fz;
      const b = dx * rx + dz * rz;
      if (a < a0) a0 = a;
      if (a > a1) a1 = a;
      if (b < b0) b0 = b;
      if (b > b1) b1 = b;
    }
  }
  return !(a1 < p.a0 || a0 > p.a1 || b1 < -p.b || b0 > p.b);
}

export function isClear(pt, ctx = {}) {
  return clearReasons(pt, ctx).length === 0;
}

/* ------------------------------------------------------------------ */
/* Resolving one reference into candidate points                      */
/* ------------------------------------------------------------------ */

/** The aeroplane's origin for a nose-in stop at (noseX, noseZ), facing headingDeg. */
export function noseInPoint(noseX, noseZ, headingDeg, noseOffset) {
  const h = headingDeg * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  // The nose tip stops NOSE_STOP short of the line; the origin is -plan.nose behind the tip.
  const back = NOSE_STOP - noseOffset;
  return { x: noseX - fx * back, z: noseZ - fz * back };
}

/** A big jet on a field that is not Code F: no ground start of any kind (isBigJet). */
function bigJetBarred(size, lay) {
  return !!(size && size.type && isBigJet(size.type) && !fieldTakesBigJets(lay));
}

function standPoints(ref, size, lay) {
  const out = [];
  if (bigJetBarred(size, lay)) return out;
  const stands = (lay && lay.stands) || [];
  const want = ref.stand;
  for (const st of stands) {
    if (want === 'contact' && !st.bridge) continue;
    if (want === 'remote' && st.bridge) continue;
    if (want === 'light' && st.size !== 'light') continue;
    if (ref.size && st.size !== ref.size) continue;
    if (ref.bridge && !st.bridge) continue;
    if (!standFits(st, size.span, size.length)) continue;
    const p = noseInPoint(st.noseX, st.noseZ, st.headingDeg, size.nose);
    out.push({
      x: p.x, z: p.z, headingDeg: st.headingDeg, kind: 'stand', stand: st, standId: st.id,
      label: `${st.bridge ? 'Gate' : 'Stand'} ${st.number ?? st.id}`,
      atc: `on stand ${st.number ?? st.id}`,
    });
  }
  // The tightest fit first, so a heavy stand stays free for a heavy aeroplane.
  out.sort((a, b) => a.stand.maxSpan - b.stand.maxSpan);
  return out;
}

function hangarPoints(size, lay) {
  const out = [];
  if (bigJetBarred(size, lay)) return out;
  for (const h of (lay && lay.hangars) || []) {
    if (h.parked || (h.occupant && !(lay.undrawn && lay.undrawn.has(h)))) continue;
    const s = h.slot;
    if (!s || size.span > s.maxSpan - 4 || size.length > s.maxLength) continue;
    out.push({ x: s.x, z: s.z, headingDeg: s.headingDeg, kind: 'hangar', label: `Hangar ${h.number ?? h.id}`, atc: 'at the hangar' });
  }
  return out;
}

function outpostPoints() {
  const o = MAP && MAP.outpost;
  if (!o) return [];
  const along = Math.max(40, (o.halfLen || 200) - 60);
  return [{ x: o.cx - along, z: o.cz, headingDeg: 90, kind: 'strip', label: 'Outpost strip', atc: 'at the outpost strip' }];
}

/** The carrier's deck: the ship's berth on this map, the deck's own height. */
export function carrierSpot(ctx = {}) {
  const c = ctx.carrier;
  if (c && c.pos) {
    return { x: c.pos.x, z: c.pos.z, y: c.deckY ?? DECK.y, headingDeg: c.headingDeg || 0 };
  }
  const b = chooseBerth({ map: MAP, airport: AIRPORT, heightAt });
  if (b.why === 'none') return null;
  return { x: b.x, z: b.z, y: DECK.y, headingDeg: 0 };
}

/**
 * The air base's shelter aprons, the same arithmetic scenery.js's addAirBase
 * uses, with the first four left to the base's own parked jets (parkJets).
 */
export function baseSpots(base = MAP && MAP.scenery && MAP.scenery.base) {
  if (!base) return [];
  const { cx = 0, cz = 0 } = base;
  const count = base.shelters ?? 8;
  const spread = base.spread ?? 620;
  const out = [];
  for (let i = 0; i < count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const along = (Math.floor(i / 2) - (count / 4 - 0.5)) * 150;
    const x = cx + along;
    const z = cz + side * spread;
    out.push({ i, x, z: z - side * 26, headingDeg: side > 0 ? 0 : 180, taken: i < 4, shelter: i + 1 });
  }
  return out;
}

function basePoints() {
  return baseSpots()
    .filter((s) => !s.taken)
    .map((s) => ({ x: s.x, z: s.z, headingDeg: s.headingDeg, kind: 'base', label: `Flight line, shelter ${s.shelter}`, atc: 'on the flight line' }));
}

function padPoints(ref, size) {
  const want = ref.pad;
  const out = [];
  for (const p of PADS) {
    if (!p || !p.pos) continue;
    const match = want === 'any'
      || p.id === want
      || (want === 'hospital' && p.role === 'hospital')
      || (want === 'ground' && p.kind === 'ground' && p.id !== 'field' && p.role !== 'hospital')
      || (want === 'roof' && p.kind === 'roof')
      || (want === 'deck' && p.kind === 'deck')
      || (want === 'stack' && p.kind === 'stack');
    if (!match) continue;
    // Room: the rotor disc (plan span) inside the pad's painted circle, with a little to spare.
    if (size.span / 2 > (p.r || 11) + 4) continue;
    out.push({ x: p.pos.x, z: p.pos.z, y: p.pos.y, headingDeg: 90, kind: 'pad', pad: p, padId: p.id, label: `Helipad: ${p.name}`, atc: 'on the pad' });
  }
  return out;
}

function harbourPoints() {
  const b = harbourBerth();
  if (!b) return [];
  // Just off the quay, in the basin, pointing out of the mouth.
  const h = b.headingDeg * D2R;
  return [{ x: b.x + Math.sin(h) * 30, z: b.z - Math.cos(h) * 30, y: 0, headingDeg: b.headingDeg, kind: 'water', label: 'Harbour dock', atc: 'at the harbour' }];
}

function hoverPoints(ref, size) {
  const r = RUNWAY;
  const hdg = r.headingDeg ?? 90;
  const h = hdg * D2R;
  const x = r.thresholdWest.x - Math.sin(h) * HOVER_OFF;
  const z = r.thresholdWest.z + Math.cos(h) * HOVER_OFF;
  let speed = 60;
  try {
    const perf = performanceFor(size.type.id);
    speed = Math.max(40, Math.round((perf.stallClean / 1.94384) * 1.35));
  } catch (e) {
    /* the default will do */
  }
  return [{ x, z, headingDeg: hdg, kind: 'hover', agl: ref.agl || 150, speed, label: 'Offshore, airborne', atc: 'airborne, inbound' }];
}

function apronPoints(size, lay) {
  if (!lay || !lay.taxiway || !lay.apron) return [];
  const big = lay.cls === 'hub';
  if (!big) return [];
  // The far end of the parallel taxiway, where nothing is parked.
  const t = lay.taxiway.rect;
  const z = (t.z0 + t.z1) / 2;
  return [
    { x: t.x1 - 120, z, headingDeg: 270, kind: 'apron', label: 'Open apron (east)', atc: 'on the taxiway' },
    { x: t.x0 + 120, z, headingDeg: 90, kind: 'apron', label: 'Open apron (west)', atc: 'on the taxiway' },
  ];
}

/** Today's start: 80 m in from the 09 threshold, lined up. */
export function runwayStart() {
  const r = RUNWAY;
  const hdg = r.headingDeg ?? 90;
  const h = hdg * D2R;
  return {
    x: r.thresholdWest.x + Math.sin(h) * 80,
    z: r.thresholdWest.z - Math.cos(h) * 80,
    y: r.elev,
    headingDeg: hdg,
    kind: 'runway',
    label: 'Runway 09 (lined up)',
    atc: 'on the runway',
  };
}

/**
 * All the points one reference names on the loaded map, in preference order,
 * before any clearance test.
 */
export function resolveRef(ref, size, ctx = {}) {
  const lay = ctx.layout || safeLayout();
  if (ref === 'runway') return [runwayStart()];
  if (ref === 'carrier') {
    const c = carrierSpot(ctx);
    return c ? [{ ...c, kind: 'carrier', handoff: 'carrier', label: 'Carrier', atc: 'on the carrier' }] : [];
  }
  if (typeof ref !== 'object' || !ref) return [];
  if (ref.stand) return standPoints(ref, size, lay);
  if (ref.hangar) return hangarPoints(size, lay);
  if (ref.strip) return outpostPoints();
  if (ref.base) return basePoints();
  if (ref.pad) return padPoints(ref, size);
  if (ref.harbour) return harbourPoints();
  if (ref.hover) return hoverPoints(ref, size);
  if (ref.apron) return apronPoints(size, lay);
  return [];
}

function safeLayout() {
  try {
    return airportLayout();
  } catch (e) {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* The resolver                                                        */
/* ------------------------------------------------------------------ */

function finish(p, size, cls, ref, fallback) {
  const g = p.kind === 'hover' ? null : groundAt(p.x, p.z);
  return {
    x: p.x,
    y: p.kind === 'hover' ? Math.max(0, heightAt(p.x, p.z)) + (p.agl || 150) : p.y != null ? p.y : g.y,
    z: p.z,
    headingDeg: p.headingDeg,
    agl: p.kind === 'hover' ? p.agl || 150 : null,
    speed: p.speed || 0,
    kind: p.kind,
    cls,
    ref,
    label: p.label,
    atc: p.atc,
    standId: p.standId || null,
    padId: p.padId || null,
    handoff: p.handoff || null,
    span: size.span,
    // The plan along the heading (clearReasons' footprint on a stand).
    nose: size.nose,
    tail: size.tail,
    fallback: !!fallback,
  };
}

/**
 * Resolve a start for `type` (an aircraft type or id) of class `cls` on
 * `mapId`.
 *
 *   opts.choice   a picker id ('gate', 'carrier', 'pad:hospital', 'runway', …)
 *                 or 'auto' (the default): the class's own list
 *   opts.random   with 'auto', pick at random among the first reference's
 *                 clear points (a function returning 0..1, or true for
 *                 Math.random)
 *   opts.ctx      { layout, traffic, carrier } — what the runtime knows
 *
 * Returns { x, y, z, headingDeg, agl, speed, kind, label, atc, standId, padId,
 * handoff, fallback, why, tried }. `fallback` is true when the answer is the
 * runway because nothing else was clear; `tried` lists what was refused and
 * why, for the tests and the console.
 */
export function resolveSpawn(mapId, cls, opts = {}) {
  const size = sizeOf(opts.type || (opts.ctx && opts.ctx.type));
  const ctx = opts.ctx || {};
  const choice = opts.choice || 'auto';
  let refs;
  if (choice === 'auto') refs = candidatesFor(mapId, cls, size.type);
  else refs = [...refsForChoice(cls, choice), 'runway'];
  const tried = [];
  const rnd = opts.random === true ? Math.random : typeof opts.random === 'function' ? opts.random : null;
  for (let i = 0; i < refs.length; i++) {
    const ref = refs[i];
    const pts = resolveRef(ref, size, ctx);
    const clear = [];
    for (const p of pts) {
      const reasons = clearReasons({ ...p, span: size.span, length: size.length, nose: size.nose, tail: size.tail }, ctx);
      if (reasons.length) tried.push({ ref, label: p.label, why: reasons.join('; ') });
      else clear.push(p);
    }
    if (!clear.length) continue;
    const pick = rnd && clear.length > 1 ? clear[Math.min(clear.length - 1, Math.floor(rnd() * clear.length))] : clear[0];
    const isFallback = ref === 'runway' && (i > 0 || choice !== 'runway');
    const out = finish(pick, size, cls, ref, isFallback);
    out.why = isFallback ? 'nothing else was clear' : 'ok';
    out.tried = tried;
    return out;
  }
  // Even the runway was refused (something parked on it): still the runway, today's start.
  const out = finish(runwayStart(), size, cls, 'runway', true);
  out.why = 'runway refused too; today\'s start regardless';
  out.tried = tried;
  return out;
}

/** The refs a picker choice id means for a class. */
export function refsForChoice(cls, id) {
  if (id === 'runway') return [];
  if (id === 'auto') return candidatesFor(MAP && MAP.id, cls).slice(0, -1);
  if (id.startsWith('pad:')) return [{ pad: id.slice(4) }];
  const c = (CHOICES[cls] || []).find((q) => q.id === id);
  return c ? c.refs : [];
}

/**
 * The picker's entries for a class on a map: Auto first, the class's named
 * places that actually resolve to a point here (clear or not — a stand with
 * traffic on it is still a place), the runway last. At most `max` entries.
 */
export function spawnChoices(mapId, cls, opts = {}) {
  const max = opts.max || 6;
  const size = sizeOf(opts.type || (opts.ctx && opts.ctx.type));
  const ctx = opts.ctx || {};
  const out = [{ id: 'auto', label: 'Auto (fits your aircraft)' }];
  if (cls === 'heli') {
    // One entry per pad, in the map's own order of preference.
    const seen = new Set();
    for (const ref of candidatesFor(mapId, 'heli')) {
      if (ref === 'runway') continue;
      for (const p of resolveRef(ref, size, ctx)) {
        if (seen.has(p.padId)) continue;
        seen.add(p.padId);
        out.push({ id: `pad:${p.padId}`, label: p.label, kind: 'pad' });
        if (out.length >= max - 1) break;
      }
      if (out.length >= max - 1) break;
    }
  } else {
    for (const c of CHOICES[cls] || []) {
      // No carrier entry for a type that never goes to sea (candidatesFor).
      if (size.type && size.type.carrier === false && c.refs.includes('carrier')) continue;
      let any = false;
      for (const ref of c.refs) if (resolveRef(ref, size, ctx).length) { any = true; break; }
      if (!any) continue;
      out.push({ id: c.id, label: c.label, kind: c.id });
      if (out.length >= max - 1) break;
    }
  }
  out.push({ id: 'runway', label: 'Runway 09 (lined up)', kind: 'runway' });
  return out.slice(0, max);
}

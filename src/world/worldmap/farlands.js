/**
 * World Map: what is past the sea. Owner, 2026-11-03: "on the border of the
 * map, is mountains, if you fly into those mountains after 40km is the
 * farlands, from minecraft but if WE MADE IT, tha stretches on for 100 km
 * then the world ends and its just a void".
 *
 * From the sea box outward, on all four sides, `D` metres past the coast:
 *
 *   0 .. 40 km     THE BORDER RANGE: a continuous wall of mountains, with
 *                  eight passes through it (CUTS) low enough for a Skylark.
 *   40 .. 140 km   THE FARLANDS: the ground forgetting how to be ground. It
 *                  opens on a rift and a banded wall, then in turn: the Stair
 *                  (noise cut into benches), the Ribs (walls in repeating
 *                  bands that straighten and tighten as you go), the Stacks
 *                  (towers on a grid that gets more exact), the Fray (coarse
 *                  blocks settling onto one last plate). The CUTS carry on as
 *                  slot canyons to the end, so every aeroplane can get there.
 *   140 km         THE EDGE, torn, and past it THE VOID: no ground, no sea,
 *                  for ever (owner, 2026-11-08: "let the void go on forever").
 *   240 km         LANTERNREACH, a floating city with a field, a hundred
 *                  kilometres out along one canyon's line (void-city.js).
 *                  Hidden from every chart. Past it the deep void.
 *
 * Original to this game: no block, texture or layout of anybody else's. The
 * idea is the only thing borrowed, that the world's arithmetic gives out if
 * you go far enough, and here it gives out into a pattern.
 *
 * WHY THIS IS NOT IN terrain.js. Only the World Map has it. `MAP._outer` is
 * this object (features/world-preview.js sets it when the World Map is first
 * chosen, and the workers when they are told `def.farlands`), and heightAt
 * asks it first. On every other map that is one property read and terrain.js
 * goes on as it always did, so no other map's ground changes, and this file
 * and the rest of the ring load with the World Map only.
 *
 * Every field, town, road and island is inside the box, so the ring cannot
 * touch checkPlacement or the "same ground whichever field" guarantee
 * (tests/features/farlands.mjs proves it: the 1.45 R of every island is
 * more than the wobble clear of the ring).
 *
 * THE VOID IS A HEIGHT. heightAt there is VOID_H, far under the sea floor:
 * under y = 0 the terrain shader draws nothing (terrain.js SEA_CUT), the
 * stream keeps no tile, and the charts paint it black. The run ends
 * (features/farlands-run.js) at VOID_FLOOR_Y, long before an aeroplane could
 * meet the sea plane, which is switched off out here anyway.
 *
 * Pure: no meshes, no DOM. A sample costs about a third of a mainland one (a
 * dozen value-noise lookups at the very most, no island list), and the ring is
 * the same streamed tiles as anywhere, so the budget is the mainland's. No tree
 * or prop stands out here: flora and props are planted island by island.
 */
import { coverAt, vnoise, fbm2 } from './landcover.js';
import { CITY, outerHeight, cityTouches, hush, hushed } from './void-city.js';

export { CITY };

/** The sea box's half width, and the radius of its corners (metres). The furthest island's 1.45 R is 106.8 km. */
export const SEA_HALF = 114000;
export const CORNER = 26000;
/** The range's depth, the Farlands' depth, and where the land stops. */
export const RANGE_DEEP = 40000;
export const FAR_DEEP = 100000;
export const EDGE_D = RANGE_DEEP + FAR_DEEP;
/** Metres the whole ring's zones wander in and out by, and the tear on top of that at the edge. */
export const WOBBLE = 3200;
export const TEAR = 5200;
/** heightAt in the void: charts black (under -99), no tile, nothing a warning could call ground. */
export const VOID_H = -1500;
/** The run ends this high over the sea's level with nothing under you. Flying on never ends it: the void goes on for ever. */
export const VOID_FLOOR_Y = 150;
/** Past the city the deep void: darker still, by D. */
export const DEEP_FROM = EDGE_D + CITY.pastEdge + 15000;
export const DEEP_BY = EDGE_D + CITY.pastEdge + 75000;
/** No peak reaches this (39,370 ft): under the fighters' ceilings. */
export const PEAK_MAX = 12000;
/** The eight passes' highest ground in the range (with PASS_ROUGH of rough ground on it), and the highest a slot's floor climbs to past it. */
export const PASS_TOP = 1650;
const PASS_ROUGH = 240;
export const SLOT_TOP = 2350;
/** The chart's half width: all of it, and a margin of nothing. */
export const CHART_HALF = SEA_HALF + EDGE_D + 16000;
/** How a vertex tells the shader how deep in it is: 0..1 over these metres of D (farlands-look.js RING_FRAG). */
export const ZONE_START = RANGE_DEEP - 3000;
export const ZONE_M = FAR_DEEP + 3000 + TEAR;

/** Metres over which the land breaks off at the edge. */
const EDGE_LIP = 210;
const INNER = SEA_HALF - CORNER;
const SKIRT = WOBBLE + 100;
const smooth = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const ridged = (n) => 1 - Math.abs(2 * n - 1);

/** Metres past the sea box (a rounded square), before any wobble; negative inside it. */
export function depthOf(x, z) {
  const qx = (x < 0 ? -x : x) - INNER;
  const qz = (z < 0 ? -z : z) - INNER;
  const ox = qx > 0 ? qx : 0;
  const oz = qz > 0 ? qz : 0;
  return Math.sqrt(ox * ox + oz * oz) + Math.min(Math.max(qx, qz), 0) - CORNER;
}

/** Is this the ring's to answer? Asked by every heightAt on the World Map: the sea's own answer is two compares. */
export function past(x, z) {
  if ((x < 0 ? -x : x) < INNER && (z < 0 ? -z : z) < INNER) return false;
  return depthOf(x, z) > -SKIRT;
}

/** Could this square have ground of the ring's on it? (The stream's "is there land here".) */
export function touches(cx, cz, size) {
  const h = size / 2;
  const ax = Math.abs(cx);
  const az = Math.abs(cz);
  if (depthOf(ax + h, az + h) < -SKIRT) return false;
  return depthOf(Math.max(0, ax - h), Math.max(0, az - h)) < EDGE_D + WOBBLE + TEAR || cityTouches(cx, cz, size);
}

/** Where a point is, with the wander: D metres past the coast. */
export function wanderOf(x, z) {
  return depthOf(x, z) + (fbm2(x / 21000, z / 21000, 31) - 0.5) * 2 * WOBBLE;
}

/** Where the land stops, in D, here. Bays, then teeth: a tear, not a line. */
export function edgeAt(x, z) {
  const bays = (vnoise(x / 9000, z / 9000, 37) - 0.5) * TEAR * 1.1;
  const teeth = ridged(vnoise(x / 1900, z / 1900, 38)) * 1100 - 550;
  return EDGE_D + bays + teeth;
}

/*
 * The passes. Each runs straight out from the coast, one side's pair at a
 * time (a point only ever asks its own side's), wandering a little, right
 * through the range and on through the Farlands as a slot canyon to the edge.
 * `at` is where along that side it leaves the coast.
 */
export const CUTS = Object.freeze({
  east: [{ at: 36000, seed: 1.1 }, { at: -52000, seed: 2.7 }],
  west: [{ at: -18000, seed: 3.9 }, { at: 62000, seed: 5.3 }],
  north: [{ at: -34000, seed: 6.1 }, { at: 48000, seed: 7.7 }],
  south: [{ at: 22000, seed: 8.3 }, { at: -64000, seed: 9.9 }],
});

/** A cut's centre line, across its side, at D metres out. Eases into its wander at the coast. */
export function cutCentre(c, D) {
  const k = smooth(0, 14000, D);
  return c.at + k * (2600 * Math.sin(D / 10500 + c.seed) + 1000 * Math.sin(D / 3900 + c.seed * 2.3));
}

/** The floor of a cut at D: up from the coast to the saddle, down into the rift, then the long slot to the edge. */
export function cutFloor(D) {
  if (D < 20000) return lerp(40, PASS_TOP, smooth(800, 20000, D));
  if (D < RANGE_DEEP + 6000) return lerp(PASS_TOP, 1050, smooth(20000, RANGE_DEEP + 6000, D));
  const u = (D - RANGE_DEEP - 6000) / (FAR_DEEP - 6000);
  return 1050 + (SLOT_TOP - 1050) * Math.sin(Math.min(1, u) * Math.PI * 0.82) ** 2;
}

/** Half width of a cut at D: a wide pass, a tight slot, opening towards the edge. */
function cutHalf(D) {
  if (D < RANGE_DEEP) return 2300;
  const u = (D - RANGE_DEEP) / FAR_DEEP;
  return lerp(2300, 760, smooth(0, 0.14, u)) + 1500 * smooth(0.82, 1, u);
}

/** How much of a cut this is, 0..1, and which (the nearer of the side's two). */
function cutAt(x, z, D) {
  const ax = x < 0 ? -x : x;
  const az = z < 0 ? -z : z;
  const eastWest = ax >= az;
  const list = eastWest ? (x > 0 ? CUTS.east : CUTS.west) : (z > 0 ? CUTS.south : CUTS.north);
  const along = eastWest ? z : x;
  const hw = cutHalf(D);
  let best = 0;
  for (let i = 0; i < 2; i++) {
    const off = Math.abs(along - cutCentre(list[i], D));
    const w = 1 - smooth(hw, hw + 700 + hw * 0.5, off);
    if (w > best) best = w;
  }
  return best;
}

/** h cut into steps `step` metres high: the treads level, the risers `sharp` of a step wide (0..0.5). */
function steps(h, step, sharp) {
  const t = h / step;
  const i = Math.floor(t);
  return (i + smooth(0.5 - sharp, 0.5 + sharp, t - i)) * step;
}

/** The mountains: ridges on ridges, up from the coast, the lines of them bent so nothing runs along a grid. */
function rangeAt(x, z, D) {
  const coast = lerp(-60, 70, smooth(-200, 2600, D));
  const body = smooth(1200, 13000, D);
  if (body <= 0) return coast;
  const wx = x + (vnoise(x / 5200, z / 5200, 55) - 0.5) * 3800;
  const wz = z + (vnoise(x / 5200 + 9.3, z / 5200, 56) - 0.5) * 3800;
  const r1 = ridged(fbm2(wx / 17000, wz / 17000, 51));
  const r2 = ridged(vnoise(wx / 6100, wz / 6100, 53));
  const r3 = ridged(vnoise(wx / 2300, wz / 2300, 54));
  const r4 = ridged(vnoise(x / 880, z / 880, 58));
  const big = r1 * r1;
  // A spine down the middle of it, so nothing but a pass goes through.
  const spine = 620 * smooth(9000, 19000, D) * (1 - smooth(27000, 36000, D));
  return coast + body * (240 + spine + big * 1700 + r2 * r2 * (420 + big * 1000) + r3 * (220 + big * 700) + r4 * (70 + big * 220));
}

/** The Farlands, `u` 0..1 of the way through. The floor between things is `floor`. */
function farAt(x, z, D, u) {
  // Slow fields everything hangs off. Two lookups, whatever the zone.
  const slow = vnoise(x / 16000, z / 16000, 41);
  const mid = vnoise(x / 5600, z / 5600, 43);
  const floor = lerp(1050, 1700, smooth(0.06, 0.4, u)) - 450 * smooth(0.8, 1, u);
  let h = floor;

  // The Threshold: past the rift one banded wall, the first thing you see past the last peak.
  const wall = smooth(0.045, 0.062, u) * (1 - smooth(0.085, 0.13, u));
  if (wall > 0) h = Math.max(h, floor + wall * (2600 + mid * 2400));

  // The Stair: the ground's own noise, cut into benches, each riser a cliff of its own.
  const stair = smooth(0.07, 0.14, u) * (1 - smooth(0.3, 0.46, u));
  if (stair > 0) h = Math.max(h, lerp(floor, floor + steps(900 + (slow * 0.55 + mid * 0.45) * 4400, 430 + 200 * mid, 0.09), stair));

  // The Ribs: walls in bands round the whole ring. The wander dies away and the period closes up, so they get
  // more exact the further in you are, which is what is wrong with them.
  const ribs = smooth(0.22, 0.34, u) * (1 - smooth(0.62, 0.76, u));
  if (ribs > 0) {
    const close = smooth(0.25, 0.68, u);
    const period = lerp(6400, 2900, close);
    const phase = (D + (slow - 0.5) * 11000 * (1 - close * 0.92)) / period;
    const f = 0.5 + 0.5 * Math.cos(phase * Math.PI * 2);
    // Flat-topped, and never narrower than a kilometre: a thin crest would saw on the coarser tiles.
    const crest = smooth(lerp(0.34, 0.52, close), lerp(0.62, 0.68, close), f);
    // Some walls are breached, and the breaches line up less as the bands line up more.
    const breach = smooth(0.34, 0.5, vnoise(x / 8000 + Math.floor(phase) * 3.7, z / 8000, 45));
    const top = lerp(2800, 8800, smooth(0.25, 0.6, u)) * (0.6 + 0.4 * slow) * breach;
    h = Math.max(h, floor + ribs * steps(top * crest, lerp(800, 520, close), 0.16));
  }

  // The Stacks: towers on a grid, a few of them thin, the grid getting truer as you go.
  const stacks = smooth(0.56, 0.68, u) * (1 - smooth(0.86, 0.97, u));
  if (stacks > 0) {
    const cell = 5400;
    const exact = smooth(0.6, 0.86, u);
    const wx = x + (1 - exact) * (mid - 0.5) * 2600;
    const wz = z + (1 - exact) * (slow - 0.5) * 2600;
    const ix = Math.floor(wx / cell);
    const iz = Math.floor(wz / cell);
    const fx = Math.abs(wx / cell - ix - 0.5);
    const fz = Math.abs(wz / cell - iz - 0.5);
    const hash = vnoise(ix * 0.5 + 0.25, iz * 0.5 + 0.25, 47);
    const hash2 = vnoise(ix * 0.5 + 0.25, iz * 0.5 + 0.25, 48);
    const r = hash2 < 0.34 ? 0.13 + hash2 * 0.3 : 0.2 + hash * 0.2;
    const dist = lerp(Math.hypot(fx, fz), Math.max(fx, fz), exact * 0.7);
    const body = 1 - smooth(r - 0.045, r + 0.03, dist);
    const shoulder = 1 - smooth(r + 0.03, r + 0.15, dist);
    // A square-cut crown on the widest, the top stepped in like the rest.
    const crown = 1 - smooth(r * 0.55, r * 0.72, dist);
    const top = (2600 + 7600 * hash * (0.55 + 0.9 * (1 - r / 0.4))) * lerp(0.75, 1, slow);
    h = Math.max(h, floor + stacks * (body * steps(top * (0.86 + 0.14 * crown), 640, 0.14) + (1 - body) * shoulder * 900));
  }

  // The Fray: whatever is left, in blocks that get coarser, sinking to one last plate.
  const fray = smooth(0.78, 0.98, u);
  if (fray > 0) h = lerp(h, floor + 300 * mid, fray * fray);
  if (u > 0.5) h = lerp(h, steps(h, lerp(200, 900, smooth(0.5, 0.98, u)), 0.1), smooth(0.5, 0.7, u));

  // The slots: a net of narrow canyons, cut through all of it. They widen as the ground comes apart.
  const line = Math.abs(2 * fbm2(x / 13000 + 5.5, z / 13000, 49) - 1);
  const wide = lerp(0.016, 0.03, smooth(0.1, 0.9, u));
  const slot = (1 - smooth(wide, wide + 0.02, line)) * smooth(0.075, 0.14, u) * (1 - smooth(0.86, 0.96, u));
  if (slot > 0 && h > floor) h = lerp(h, floor, slot);
  return h;
}

/** The ground of the ring. Only asked where past() said so. */
export function height(x, z) {
  const d = depthOf(x, z);
  // Past the land's end: the void, or the city floating in it (void-city.js; hushed while a chart samples).
  if (d > EDGE_D + WOBBLE + TEAR) return outerHeight(x, z);
  const D = d + (fbm2(x / 21000, z / 21000, 31) - 0.5) * 2 * WOBBLE;
  if (D <= -200) return -60;
  const edge = D > EDGE_D - TEAR - 500 ? edgeAt(x, z) : Infinity;
  if (D >= edge) return VOID_H;
  let h;
  if (D < RANGE_DEEP - 3000) h = rangeAt(x, z, D);
  else {
    const u = (D - RANGE_DEEP) / FAR_DEEP;
    const far = farAt(x, z, D, u > 0 ? u : 0);
    // The range's back falls away into the rift, in about four kilometres.
    h = D >= RANGE_DEEP + 1200 ? far : lerp(rangeAt(x, z, D), far, smooth(RANGE_DEEP - 3000, RANGE_DEEP + 1200, D));
  }
  const cut = cutAt(x, z, D);
  if (cut > 0) {
    const f = cutFloor(D) + (D < RANGE_DEEP ? PASS_ROUGH * vnoise(x / 1500, z / 1500, 57) * smooth(3000, 12000, D) : 0);
    if (h > f) h = lerp(h, f, cut);
  }
  // The break itself: a lip two or three tile cells wide, so the tear is a line and not a saw of cells.
  if (D > edge - EDGE_LIP) h = lerp(h, VOID_H, smooth(edge - EDGE_LIP, edge, D));
  return h < PEAK_MAX ? h : PEAK_MAX;
}

/**
 * The cover of a ring point, as landcover.js coverAt's `out`. The range is
 * ordinary country, so it is the ordinary rule. The Farlands' look is painted
 * from height (worldmap/farlands-look.js); all a vertex carries is how steep
 * it is, as rock, and how deep in it is, in the town channel, which is free.
 */
export function coverOf(x, z, h, slope, out) {
  const D = wanderOf(x, z);
  if (D < RANGE_DEEP - 3000) {
    coverAt(x, z, h, slope, false, out);
    // No beach under a mountain wall: a sand band all round the sea, and the low sun lit it as one pale line. Shingle.
    out[2] += out[0];
    out[0] = 0;
    // No field out here, and the high ground bare: the rock itself is painted by height (farlands-look.js).
    const bare = 1 - smooth(500, 1000, h);
    out[3] = 0;
    out[4] *= bare;
    out[5] *= bare;
    return out;
  }
  const steep = slope <= 0.3 ? 0 : slope >= 1.1 ? 1 : (slope - 0.3) / 0.8;
  out[0] = 0; out[1] = 1 - steep; out[2] = steep;
  out[3] = 0; out[4] = 0; out[5] = 0; out[6] = 0;
  out[7] = Math.min(1, (D - ZONE_START) / ZONE_M);
  return out;
}

/** The live map's names for it, on all four sides (places.js regions). */
const LABELS = [];
for (const [dx, dz, side] of [[1, 0, 'e'], [-1, 0, 'w'], [0, -1, 'n'], [0, 1, 's']]) {
  for (const [name, D] of [['The Border Range', RANGE_DEEP / 2], ['The Farlands', RANGE_DEEP + FAR_DEEP / 2], ['The Edge', EDGE_D + 7000]]) {
    LABELS.push({ id: `${name}-${side}`, name, x: dx * (SEA_HALF + D), z: dz * (SEA_HALF + D) });
  }
}

/** What terrain.js, the stream, the charts and the live map read. */
export const FARLANDS = Object.freeze({ past, height, touches, cover: coverOf, depthOf, voidH: VOID_H, chartHalf: CHART_HALF, skirt: 3600, labels: LABELS, hush, hushed });

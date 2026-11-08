/**
 * NULLSPIRE: the hidden city out in the void. The owner, 2026-11-08: "let
 * the void go on forever, and if u fly 100 km into the void theres an super
 * cool city that doesnt show on minimap (in dev mode u can tp to it) ...
 * then the actual void begins" and "make the city have a big airport too".
 *
 * WHERE. A hundred kilometres past the edge, straight out along the line of
 * the east side's first slot canyon (farlands.js CUTS.east[0]): fly that
 * canyon to its torn end and hold 090 and it comes up out of the black. That
 * is the only hint. D = EDGE_D + 100 km, so the live map, the pin's map and
 * the minimap's whole-ring picture (all ±CHART_HALF) never reach it, and the
 * minimap's close-in window is told to look away (hush) while it samples.
 *
 * WHAT. A floating slab of ground, SLAB_Y high, its cliffs falling into
 * nothing (the ring shader tears off anything under a few hundred metres, so
 * the slab hangs in the void with no underside). On it, Nullspire: a dense
 * grid of towers lit at every window, a few landmark spires, light bridges
 * between the tall ones, a glowing rim, and on its south half LANTERNREACH
 * INTERNATIONAL, a hub-class field in the outstations' own format
 * (worldmap/outstation.js buildField), 09/27, long enough for anything.
 *
 * This file is PURE: numbers, the ground, the layout. The meshes are
 * void-city-look.js; the lifecycle (built within reach, disposed far away,
 * the notice, the dev teleport) is features/farlands-run.js and
 * features/world-preview.js. All of it loads with the World Map's ring only.
 */
import { vnoise } from './landcover.js';

/* The centre: SEA_HALF + EDGE_D + 100 km east, on the east[0] canyon's line (its end is at z ≈ 39,150). */
export const CITY = Object.freeze({
  name: 'Nullspire',
  x: 354000,
  z: 39000,
  /** Fly this heading out of the canyon's end to find it. */
  headingDeg: 90,
  /** Metres past the edge. */
  pastEdge: 100000,
});

/** The slab's top (the city's ground and the field's elevation), its half-axes (x along the canyon's line), and the void under it. */
export const SLAB_Y = 1500;
export const SLAB_RX = 4300;
export const SLAB_RZ = 3100;
/** The rim's wander and the metres over which the top breaks off into the cliff. */
const RIM_WOBBLE = 340;
const LIP = 170;
/** heightAt where there is nothing: farlands.js VOID_H, repeated here so this file imports nothing of the ring. */
export const VOID_H = -1500;

const smooth = (a, b, x) => {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
};

/** 0 at the rim, 1 well inside: the slab's own "how far in", by its ellipse, with the rim wandering. */
export function slabIn(x, z) {
  const dx = x - CITY.x;
  const dz = z - CITY.z;
  // Quick rejects: a box, then the ellipse.
  if (dx > SLAB_RX + RIM_WOBBLE || dx < -SLAB_RX - RIM_WOBBLE || dz > SLAB_RZ + RIM_WOBBLE || dz < -SLAB_RZ - RIM_WOBBLE) return 0;
  const e = Math.hypot(dx / SLAB_RX, dz / SLAB_RZ);
  if (e > 1 + RIM_WOBBLE / SLAB_RZ) return 0;
  const wobble = (vnoise(x / 1100, z / 1100, 61) - 0.5) * 2 * RIM_WOBBLE;
  // Metres from the (wandered) rim, inwards.
  const inM = (1 - e) * SLAB_RZ + wobble;
  return smooth(0, LIP, inM);
}

/** The ground at the city: the slab, or the void. */
export function cityHeight(x, z) {
  const k = slabIn(x, z);
  if (k <= 0) return VOID_H;
  if (k >= 1) return SLAB_Y;
  return VOID_H + (SLAB_Y - VOID_H) * k;
}

/** Could this square have the slab on it? (The stream's and the skirt's question.) */
export function cityTouches(cx, cz, size) {
  const h = size / 2 + RIM_WOBBLE + 50;
  return Math.abs(cx - CITY.x) < SLAB_RX + h && Math.abs(cz - CITY.z) < SLAB_RZ + h;
}

/* ------------------------------------------------------------------ */
/* Hush: the charts look away                                         */
/* ------------------------------------------------------------------ */

let HUSH = false;
/** While on, the city's ground answers as the void (the minimap's window, sampling). */
export function hush(on) {
  HUSH = !!on;
}
export function hushed() {
  return HUSH;
}

/** What the ring's height() asks, past the land's end. */
export function outerHeight(x, z) {
  return HUSH ? VOID_H : cityHeight(x, z);
}

/* ------------------------------------------------------------------ */
/* Nullspire International                                          */
/* ------------------------------------------------------------------ */

/**
 * The field, in worldmap/outstation.js's format (the same as
 * preview-data.js's airports, so buildField makes it the way it makes every
 * other field: the runway in the runway material, taxiway, connectors,
 * turnpads, apron, terminal, tower, hangars, fuel, fire, windsock, the
 * lights, the PAPI). 09/27, 3,600 m by 60 m: a heavy lands on it with room.
 * In the field's own frame x runs along the runway and -z is north, so the
 * terminal and the city are to the north of a 09 approach, on your left.
 */
export const CITY_FIELD = Object.freeze({
  id: 'nullspire',
  code: 'XNUL',
  name: 'Nullspire International',
  place: 'Nullspire',
  region: 'void',
  kind: 'hub',
  x: CITY.x - 200,
  z: CITY.z + 1050,
  length: 3600,
  halfWidth: 30,
  prevailingDeg: 90,
  parking: true,
  elev: SLAB_Y,
  persona: 'gateway',
  layout: {
    cls: 'hub',
    dropped: [],
    pavement: [
      { kind: 'taxiway', x0: -1680, x1: 1680, z0: -236, z1: -180 },
      { kind: 'connector', x0: -1662, x1: -1606, z0: -180, z1: -30 },
      { kind: 'connector', x0: -848, x1: -792, z0: -180, z1: -30 },
      { kind: 'connector', x0: -28, x1: 28, z0: -180, z1: -30 },
      { kind: 'connector', x0: 792, x1: 848, z0: -180, z1: -30 },
      { kind: 'connector', x0: 1606, x1: 1662, z0: -180, z1: -30 },
      { kind: 'turnpad', x0: -1820, x1: -1660, z0: 30, z1: 56 },
      { kind: 'turnpad', x0: -1820, x1: -1660, z0: -56, z1: -30 },
      { kind: 'turnpad', x0: -1820, x1: -1800, z0: -56, z1: 56 },
      { kind: 'turnpad', x0: 1660, x1: 1820, z0: 30, z1: 56 },
      { kind: 'turnpad', x0: 1660, x1: 1820, z0: -56, z1: -30 },
      { kind: 'turnpad', x0: 1800, x1: 1820, z0: -56, z1: 56 },
      // A `ramp`, not an `apron`: buildField parks no airliners on it (field-look.js apronDressing). Its craft are void-city-craft.js's.
      { kind: 'ramp', x0: -1000, x1: 760, z0: -400, z1: -236 },
      { kind: 'lead', x0: -1230, x1: -1090, z0: -270, z1: -236 },
      { kind: 'lead', x0: -1420, x1: -1280, z0: -270, z1: -236 },
      { kind: 'lead', x0: 1000, x1: 1100, z0: -270, z1: -236 },
      { kind: 'drive', x0: 820, x1: 880, z0: -270, z1: -236 },
    ],
    terminal: { x0: -980, x1: 560, z0: -470, z1: -404, h: 30 },
    tower: { x0: 620, x1: 646, z0: -468, z1: -442, h: 84 },
    hangars: [
      { x0: -1230, x1: -1090, z0: -380, z1: -270, h: 36 },
      { x0: -1420, x1: -1280, z0: -380, z1: -270, h: 36 },
      { x0: 1000, x1: 1100, z0: -340, z1: -270, h: 26 },
    ],
    fire: { x0: 820, x1: 880, z0: -300, z1: -270, h: 8 },
    fuel: { x0: 1300, x1: 1430, z0: -380, z1: -300, tanks: 4, r: 12, h: 18 },
    carPark: { x0: 1130, x1: 1280, z0: -380, z1: -280 },
    windsock: { x: -1600, z: -110 },
  },
  extras: [{ kind: 'concourse', x0: -500, x1: -280, z0: -540, z1: -500, h: 18, x: -390, z: -520 }],
  landmarks: [],
});

/** Where the Javelin (aircraft/extra/javelin.js) is parked, in the field's frame: the west end of the ramp, nose to the terminal. */
export const JAVELIN_SPOT = Object.freeze({ x: -930, z: -330 });
/** ...and in the world. */
export function javelinAt() {
  return { x: CITY_FIELD.x + JAVELIN_SPOT.x, y: SLAB_Y, z: CITY_FIELD.z + JAVELIN_SPOT.z };
}

/** The runway as terrain.js setOtherRunways / isOnAnyRunway want it. */
export function cityRunway() {
  return { cx: CITY_FIELD.x, cz: CITY_FIELD.z, length: CITY_FIELD.length, halfWidth: CITY_FIELD.halfWidth };
}

/**
 * Where the dev teleport puts you: on a long final for 09, `outM` west of the
 * threshold, `aboveM` over the field, nose on the runway.
 */
export function approachStart(outM = 11000, aboveM = 620) {
  return { x: CITY_FIELD.x - CITY_FIELD.length / 2 - outM, y: SLAB_Y + aboveM, z: CITY_FIELD.z, headingDeg: 90 };
}

/* ------------------------------------------------------------------ */
/* The towers                                                          */
/* ------------------------------------------------------------------ */

/** The city's core: north of the field, an ellipse of its own, towers tallest at its heart. */
const CORE = Object.freeze({ x: 150, z: -1150, rx: 3300, rz: 1750 });
/** The street grid's pitch (metres), and how far south (city metres) a tower may stand: the field's concourse starts at +510. */
export const STREET = 118;
const FIELD_KEEPOUT_Z = 380;

/** A cheap hash in 0..1 from two integers and a salt. */
function h2(i, k, s) {
  const v = Math.sin(i * 127.1 + k * 311.7 + s * 74.7) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * The towers, in city metres (relative to CITY.x, CITY.z; y from SLAB_Y):
 * { x, z, w, d, h, seed, spire }. Deterministic, the same at every tier; the
 * tier takes the first `count` of them, so Low is the same city, thinner.
 * The five spires come first so every tier has its landmarks.
 */
export function towerLayout(count = 560) {
  const out = [];
  // The spires: the landmarks, tall and thin, placed by hand round the heart.
  const spires = [[150, -1150, 560], [-900, -800, 470], [1250, -1400, 430], [-250, -1900, 390], [700, -500, 410]];
  for (const [x, z, h] of spires) out.push({ x, z, w: 34, d: 34, h, seed: h / 1000, spire: true });
  const cols = Math.floor((CORE.rx * 2) / STREET);
  const rows = Math.floor((CORE.rz * 2) / STREET);
  const cand = [];
  for (let i = 0; i < cols; i++) {
    for (let k = 0; k < rows; k++) {
      const x = CORE.x - CORE.rx + (i + 0.5) * STREET + (h2(i, k, 1) - 0.5) * 14;
      const z = CORE.z - CORE.rz + (k + 0.5) * STREET + (h2(i, k, 2) - 0.5) * 14;
      const e = Math.hypot((x - CORE.x) / CORE.rx, (z - CORE.z) / CORE.rz);
      if (e > 0.98 || z > FIELD_KEEPOUT_Z) continue;
      if (slabIn(CITY.x + x, CITY.z + z) < 1) continue;
      // Not on a spire's plot, and a few plots left open as squares.
      if (spires.some(([sx, sz]) => Math.abs(sx - x) < 70 && Math.abs(sz - z) < 70)) continue;
      const open = h2(i, k, 3);
      if (open < 0.11) continue;
      // Taller to the heart, with a streaky noise so there are districts, not one cone.
      const heart = 1 - e * e;
      const streak = vnoise(x / 420 + 3, z / 420, 63);
      const r = h2(i, k, 4);
      let h = 30 + heart * (90 + 210 * streak) + r * r * 120 * heart;
      if (r > 0.93 && heart > 0.35) h *= 1.35;
      h = Math.min(330, Math.round(h));
      const w = 26 + Math.round(h2(i, k, 5) * 30);
      const d = 26 + Math.round(h2(i, k, 6) * 30);
      cand.push({ x: Math.round(x), z: Math.round(z), w, d, h, seed: h2(i, k, 7), spire: false, rank: heart + 0.25 * h2(i, k, 8) });
    }
  }
  // The heart first, so a thinner tier keeps the skyline and loses the fringe.
  cand.sort((a, b) => b.rank - a.rank);
  for (const c of cand) {
    if (out.length >= count) break;
    delete c.rank;
    out.push(c);
  }
  return out;
}

/** Light bridges: between pairs of tall neighbours, { ax, az, bx, bz, y }. At most `most`. */
export function bridgeLayout(towers, most = 70) {
  const tall = towers.filter((t) => t.h >= 130);
  const out = [];
  for (let i = 0; i < tall.length && out.length < most; i++) {
    const a = tall[i];
    for (let k = i + 1; k < tall.length && out.length < most; k++) {
      const b = tall[k];
      const dist = Math.hypot(a.x - b.x, a.z - b.z);
      if (dist < 90 || dist > 2 * STREET + 20) continue;
      if (h2(i, k, 9) < 0.55) continue;
      const top = Math.min(a.h, b.h);
      out.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, y: Math.round(top * (0.45 + 0.35 * h2(i, k, 10))) });
      break;
    }
  }
  return out;
}

/** The counts each tier builds. */
export const CITY_TIERS = Object.freeze({
  low: { towers: 340, bridges: 40 },
  medium: { towers: 560, bridges: 70 },
  high: { towers: 560, bridges: 70 },
  ultra: { towers: 560, bridges: 70 },
});

/** Metres from the city's centre to a point: when to build it, when to let it go. */
export function cityDist(x, z) {
  return Math.hypot(x - CITY.x, z - CITY.z);
}
export const BUILD_WITHIN = 60000;
export const DROP_BEYOND = 80000;
/** The notice: this close to the centre, the first time. */
export const FOUND_WITHIN = 9000;

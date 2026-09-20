/**
 * Island terrain.
 *
 * A single analytic height function drives everything: the mesh, the aircraft's
 * ground collision, and where trees and buildings get placed. That means the
 * wheels always touch exactly the ground you can see.
 *
 * The airport sits on a flattened coastal plateau on the main island. The
 * delivery island is a second, smaller landmass to the south-east.
 */

import * as THREE from '../vendor/three.module.js';
import { fbm, clamp, smoothstep, lerp, makeRandom } from '../core/noise.js';
import { getMap, DEFAULT_MAP_ID } from './maps.js';
import {
  grassTexture,
  sandTexture,
  rockTexture,
  terrainSplatNoise,
  groundNormal,
} from '../render/textures.js';

/**
 * Airport geometry. Heading 090 means the runway points east (+X).
 *
 * Deliberately identical on every map: same position, same length, same
 * elevation. That is what lets the tutorial, all the missions and the landing
 * scoring work unchanged wherever you choose to fly.
 */
const KESTREL_AIRPORT = {
  elev: 14,
  headingDeg: 90,
  runway: { cx: 0, cz: 0, length: 1100, halfWidth: 17 },
  /**
   * The crosswind runway, 18/36, crossing the main one east of the apron.
   *
   * One runway means a strong crosswind is simply a bad day. Two crossing
   * runways means it is a decision — which is the interesting version, and it
   * is why real airfields are laid out like this. Deliberately shorter and
   * narrower than 09/27, so choosing it costs you something.
   */
  runway2: { cx: 250, cz: -70, length: 900, halfWidth: 15, headingDeg: 180 },
  // Smooth flattening region (a bit larger than the paved area).
  pad: { x0: -680, x1: 680, z0: -230, z1: 190, blend: 190 },
  // ...and a second one for 18/36, so its ends are level too.
  pad2: { x0: 170, x1: 330, z0: -580, z1: 440, blend: 170 },
};

/**
 * The valley kept clear along the extended runway centreline, so runway 09/27
 * has a flyable approach and departure at both ends. Every map gets one,
 * including the mountainous ones — especially the mountainous ones.
 *
 * These used to be fixed for the whole game, which was fine while every map
 * was an island with a 1,100 m strip in the middle of it. It is not fine for a
 * map built for driving: a 5.4 km trench 760 m wide, held down to field
 * elevation plus ten, will flatten the entire spine of a peninsula and leave
 * nothing for a road to climb. So the numbers are defaults now and a map may
 * say otherwise. The objects are mutated in place rather than replaced,
 * because they are exported and `scatter` holds the binding.
 */
/*
 * How steeply the cleared lane climbs away from the threshold, metres per
 * metre. A light aeroplane climbs at about one in ten.
 *
 * The WIDTH of the lane was not the problem and narrowing it broke the
 * circuit: measured, the aeroplane stopped reaching the runway at all and the
 * crosswind landing came down at 1,209 fpm, 39 m off the centreline. The lane
 * has to be wide because a ten-year-old's final approach is wide. What made
 * the maps ugly was DEPTH — flattening a three-hundred-metre peak to twenty-
 * four — and that is what the cap below fixes.
 */
const APPROACH_SLOPE = 0.12;
/**
 * How fast the lane's ceiling rises SIDEWAYS from the centreline.
 *
 * The corridor used to hold one flat ceiling right across its width, so what
 * it produced was a trench with a level floor seven hundred metres wide —
 * which is why the sheet still showed a bright green band through Kestrel
 * after the glideslope fix, a third of the island cut by up to 345 m. An
 * aeroplane on final is over the centreline, not over the hillside a quarter
 * of a mile to the left of it; the ground out there only has to be below the
 * wing, not level with the runway. So the ceiling climbs away from the
 * centreline too, and what you get is a VALLEY with sides, which is both what
 * the approach needs and what the ground looks like anywhere real.
 *
 * 0.35 is about nineteen degrees — a hillside, not a cliff and not a plain.
 */
const APPROACH_SIDE_SLOPE = 0.35;
/**
 * The deepest a corridor may cut.
 *
 * Generous, because on Kestrel there is a 278 m hill one kilometre short of
 * the runway and carving the approach valley through it is the corridor's
 * actual job — capped at 70 m the aeroplane flew into it and the circuit
 * stopped working at all. What the cap is for is the far end: a mountain four
 * kilometres out is scenery, not an obstacle, and the rising ceiling has
 * already let it alone by then. This only stops the pathological case.
 */
const MAX_APPROACH_CUT = 260;
const CORRIDOR_DEFAULT = Object.freeze({ halfWidth: 380, blend: 320, fadeFrom: 3600, length: 5400 });
/**
 * The same idea for 18/36, running north-south instead — at a fifth of the
 * size, because the second runway is not the one anybody flies.
 *
 * This was 300/260/2600/4200: a lane 1,120 m wide and 8.4 km end to end, laid
 * at right angles across the first one, on maps whose island is 2.4 km across.
 * The two of them crossing IS the green cross, and the north-south arm of it
 * is paid for by a runway a ten-year-old will use about never. Measured over
 * all thirty-two maps: cutting it to this takes Fjord from 16% of its land
 * cut to 7% and costs nothing anywhere else. The lane is still there, and
 * still clear enough to land 18/36 on if you want it.
 */
const CORRIDOR2_DEFAULT = Object.freeze({ halfWidth: 200, blend: 180, fadeFrom: 1500, length: 2400 });
export const CORRIDOR = { ...CORRIDOR_DEFAULT };
export const CORRIDOR2 = { ...CORRIDOR2_DEFAULT };

/* ------------------------------------------------------------------ */
/* Active map                                                          */
/* ------------------------------------------------------------------ */

/**
 * These are `let`, not `const`, and everything that imports them gets a live
 * binding — so swapping the map really does swap the world underneath.
 * Call `applyMap()` and then rebuild the terrain, ocean and scenery.
 */
/**
 * The airfield you are flying from.
 *
 * This was a `const`, which quietly meant every map in the game had the same
 * runway in the same place — fine while every map was an island with one strip,
 * and wrong the moment a real airport with four parallel runways turns up. It
 * is now a live binding like MAP and ISLANDS, so a map may bring its own.
 *
 * A map that does not specify one gets Kestrel's, so nothing that existed
 * before has to change.
 */
export let AIRPORT = KESTREL_AIRPORT;

export let MAP = getMap(DEFAULT_MAP_ID);
export let SEA_FLOOR = MAP.seaFloor;
export let ISLANDS = MAP.islands;
export let PALETTE = MAP.palette;

export function applyMap(idOrDef) {
  MAP = typeof idOrDef === 'string' ? getMap(idOrDef) : idOrDef;
  SEA_FLOOR = MAP.seaFloor;
  ISLANDS = MAP.islands;
  AIRPORT = MAP.airport || KESTREL_AIRPORT;
  PALETTE = MAP.palette;
  // A map that says nothing about its approach corridors gets the numbers the
  // game has always used, so nothing that existed before changes.
  Object.assign(CORRIDOR, CORRIDOR_DEFAULT, MAP.corridor || {});
  Object.assign(CORRIDOR2, CORRIDOR2_DEFAULT, MAP.corridor2 || {});
  // Work out where the authored flat ground actually sits before anything asks
  // heightAt a question. Done here rather than at a fifth call site because
  // applyMap is already called from four places and one of them would be
  // forgotten.
  resolveFlats();
  // Harbours, channels, shoals and roads: bounding boxes and, for the nine
  // flight maps, the harbour's position on a coastline that is made of noise.
  // Once per map load, not once per sample.
  resolveWaters(MAP);
  return MAP;
}

/**
 * How "inside" an island a point is: 1 in the middle, 0 out at sea.
 * The early distance rejection matters — this runs millions of times while the
 * terrain mesh is built and a few hundred times a frame for wheel contact.
 */
function islandField(x, z, isl) {
  const dx = x - isl.cx;
  const dz = z - isl.cz;
  const d2 = dx * dx + dz * dz;
  // Coastline wobble is at most ±42%, so anything past 1.45 R is open water.
  const maxR = isl.radius * 1.45;
  if (d2 > maxR * maxR) return 0;
  const d = Math.sqrt(d2);
  // Wobble the coastline so islands are not circles.
  const ang = Math.atan2(dz, dx);
  const wob =
    fbm(Math.cos(ang) * 2 + isl.seed, Math.sin(ang) * 2, { octaves: 3, seed: isl.seed }) - 0.5;
  const r = isl.radius * (1 + wob * 0.42);
  return 1 - smoothstep(r * 0.55, r, d);
}

/** Weight of the flattened airport plateau at this point (0..1). */
function regionWeight(p, x, z) {
  // A map with only one runway has no second pad, and reading x0 off nothing
  // threw on the first height sample — before a single frame had been drawn.
  if (!p) return 0;
  if (x < p.x0 - p.blend || x > p.x1 + p.blend || z < p.z0 - p.blend || z > p.z1 + p.blend) return 0;
  const inX = smoothstep(p.x0 - p.blend, p.x0, x) * (1 - smoothstep(p.x1, p.x1 + p.blend, x));
  const inZ = smoothstep(p.z0 - p.blend, p.z0, z) * (1 - smoothstep(p.z1, p.z1 + p.blend, z));
  return inX * inZ;
}

/** Both runways sit on the same level plateau, so take whichever is stronger. */
export function padWeight(x, z) {
  return Math.max(regionWeight(AIRPORT.pad, x, z), regionWeight(AIRPORT.pad2, x, z));
}

/**
 * The outlying delivery strip. Somebody bulldozed this flat, exactly like the
 * airfield — which is why you can put a cargo crate on it or, if you are
 * feeling brave, land on it. On the fjords map it is the only level ground for
 * miles.
 */
function outpostWeight(x, z) {
  const o = MAP.outpost;
  if (!o) return 0;
  const dx = Math.abs(x - o.cx);
  const dz = Math.abs(z - o.cz);
  if (dx > o.halfLen + o.blend || dz > o.halfWidth + o.blend) return 0;
  const inX = 1 - smoothstep(o.halfLen, o.halfLen + o.blend, dx);
  const inZ = 1 - smoothstep(o.halfWidth, o.halfWidth + o.blend, dz);
  return inX * inZ;
}

/* ------------------------------------------------------------------ */
/* Authored level ground                                               */
/* ------------------------------------------------------------------ */

/**
 * Flat ground a map asks for by name: a quay, a depot yard, a village green,
 * a causeway, a bench on a hillside for a relay mast.
 *
 * Until now the only places in this world that were deliberately level were
 * the airfield pad and the outlying strip, both special-cased inside heightAt.
 * That is enough for a game about aeroplanes, where the only flat thing you
 * need is somewhere to land. It is not enough for a game about driving, where
 * every destination is somewhere a lorry has to be able to stand.
 *
 * The hard part is not the flattening — it is the same regionWeight blend the
 * pad already uses, and deliberately so, because a second way to deform
 * terrain is a thing that drifts. The hard part is the ELEVATION. The ground
 * is noise: nobody, including whoever wrote the map, knows what height the
 * land is at a given point until it is evaluated. Hand-tuned numbers are why
 * every existing map carries a magic `outpost.elev` like 52 or 74, and why a
 * bench authored at the wrong height would cut a two-hundred-metre pit into a
 * hillside.
 *
 * So `elev: 'auto'` means "sample the natural ground and level to that". Nine
 * samples over the middle of the rectangle, median rather than mean so one
 * noise spike cannot drag the whole bench, and `minElev` / `maxElev` to clamp.
 * The rectangle's own corners are left to the blend skirt, which is what a
 * cutting or an embankment is.
 *
 * One rule that is not optional: a flat whose seaward end hangs over water
 * must give a NUMBER, not 'auto'. Auto would average land and seabed and level
 * the quay to something like minus twelve.
 */
export let FLATS = [];
/** Weight of the flat that `flatAt` last returned — avoids computing it twice. */
let FLAT_W = 0;
/**
 * True only while resolveFlats is measuring the natural ground.
 *
 * This is the recursion guard, and it is a flag rather than a second height
 * function because a second height function is a thing that drifts. It turns
 * off the two features that would otherwise poison a measurement: a carrier
 * deck moored over the quay, and the outlying strip's own blend.
 */
let RESOLVING = false;
/** The outlying strip's resolved elevation — see resolveFlats. */
let OUTPOST_ELEV = 0;

function flatWeight(f, x, z) {
  const b = f.blend;
  if (x < f.x0 - b || x > f.x1 + b || z < f.z0 - b || z > f.z1 + b) return 0;
  const inX = smoothstep(f.x0 - b, f.x0, x) * (1 - smoothstep(f.x1, f.x1 + b, x));
  const inZ = smoothstep(f.z0 - b, f.z0, z) * (1 - smoothstep(f.z1, f.z1 + b, z));
  return inX * inZ;
}

/**
 * The strongest flat at this point, or null.
 *
 * The precomputed bounds make the miss path — which is nearly everywhere in
 * the world — four compares per flat, and a map has about five. heightAt runs
 * roughly 200,000 times per terrain build, so this has to stay arithmetic and
 * never allocate.
 */
export function flatAt(x, z) {
  let best = null;
  let bw = 0;
  for (let i = 0; i < FLATS.length; i++) {
    const f = FLATS[i];
    if (x < f.bx0 || x > f.bx1 || z < f.bz0 || z > f.bz1) continue;
    const w = flatWeight(f, x, z);
    if (w > bw) { bw = w; best = f; }
  }
  FLAT_W = bw;
  return best;
}

export function getFlat(id) {
  for (let i = 0; i < FLATS.length; i++) if (FLATS[i].id === id) return FLATS[i];
  return null;
}

/**
 * What this point is surfaced with, if a map said so — 'tarmac', 'gravel' or
 * 'grass'. Null everywhere else, so whoever writes surfaceAt() can ask this
 * first and fall back to its own rules.
 */
export function flatSurfaceAt(x, z) {
  if (!FLATS.length) return null;
  const f = flatAt(x, z);
  return f && FLAT_W > 0.5 ? f.surface : null;
}

/** Median of nine samples over a rectangle — one spike cannot move it. */
function medianGround(x0, x1, z0, z1) {
  const s = [];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) s.push(heightAt(lerp(x0, x1, i / 2), lerp(z0, z1, j / 2)));
  }
  s.sort((a, b) => a - b);
  return s[4];
}

export function resolveFlats() {
  // Empty FIRST: that is what stops the flats seeing themselves while their
  // own elevations are being measured.
  FLATS = [];
  RESOLVING = true;

  /*
   * The outlying strip, resolved the same way.
   *
   * Every map in the game carries a hand-measured number here — 52 at San
   * Francisco, 74 at Los Angeles — which somebody worked out by flying there
   * and looking. `elev: 'auto'` makes that unnecessary and makes it impossible
   * to get wrong when an island's seed changes. A plain number still works, so
   * no existing map has to be touched.
   */
  const o = MAP.outpost;
  if (o) {
    OUTPOST_ELEV = typeof o.elev === 'number'
      ? o.elev
      : medianGround(
          o.cx - o.halfLen * 0.6, o.cx + o.halfLen * 0.6,
          o.cz - o.halfWidth * 0.6, o.cz + o.halfWidth * 0.6
        );
    if (typeof o.minElev === 'number') OUTPOST_ELEV = Math.max(OUTPOST_ELEV, o.minElev);
    if (typeof o.maxElev === 'number') OUTPOST_ELEV = Math.min(OUTPOST_ELEV, o.maxElev);
  }

  const out = [];
  for (const d of MAP.flats || []) {
    const f = {
      id: d.id || `flat${out.length}`,
      name: d.name || d.id || 'level ground',
      kind: d.kind || 'yard',
      x0: Math.min(d.x0, d.x1), x1: Math.max(d.x0, d.x1),
      z0: Math.min(d.z0, d.z1), z1: Math.max(d.z0, d.z1),
      blend: d.blend ?? 90,
      surface: d.surface || 'tarmac',
      y: 0,
    };
    // Nothing grows on made ground. A green is still a green, though, which is
    // why this follows the surface rather than being true for every flat —
    // otherwise the town builder, which scatters, would refuse to put a single
    // building on its own village green.
    f.clear = d.clear ?? (f.surface === 'tarmac' || f.surface === 'gravel');
    f.cx = (f.x0 + f.x1) / 2;
    f.cz = (f.z0 + f.z1) / 2;
    f.bx0 = f.x0 - f.blend; f.bx1 = f.x1 + f.blend;
    f.bz0 = f.z0 - f.blend; f.bz1 = f.z1 + f.blend;
    // Sample the middle 70%, not the corners: the corners are what the blend
    // skirt is for, and including them drags a hillside bench down the hill.
    f.y = typeof d.elev === 'number'
      ? d.elev
      : medianGround(
          lerp(f.x0, f.x1, 0.15), lerp(f.x0, f.x1, 0.85),
          lerp(f.z0, f.z1, 0.15), lerp(f.z0, f.z1, 0.85)
        );
    if (typeof d.minElev === 'number') f.y = Math.max(f.y, d.minElev);
    if (typeof d.maxElev === 'number') f.y = Math.min(f.y, d.maxElev);
    out.push(f);
  }

  RESOLVING = false;
  FLATS = out;
  return FLATS;
}

/**
 * Solid structures you can fly into.
 *
 * The ground has always been solid; buildings were not, so the tower and the
 * terminal were scenery you passed straight through. Each entry is an
 * axis-aligned box in world metres — good enough for a tower, a hangar or a
 * terminal, and cheap enough to test every hard point against every frame.
 *
 * The world owns these: `buildWorld` clears the list and each piece registers
 * itself as it is built, so switching map or graphics level cannot leave a
 * ghost building behind to crash into.
 */
export const OBSTACLES = [];

export function clearObstacles() {
  OBSTACLES.length = 0;
}

/**
 * @param {object} box {x0,x1,y0,y1,z0,z1, what} — `what` is the crash message.
 */
export function addObstacle(box) {
  OBSTACLES.push(box);
  return box;
}

/** Register a box by centre and size, which is how everything is modelled. */
export function addObstacleAt(cx, cz, width, depth, baseY, height, what) {
  return addObstacle({
    x0: cx - width / 2,
    x1: cx + width / 2,
    z0: cz - depth / 2,
    z1: cz + depth / 2,
    y0: baseY,
    y1: baseY + height,
    what,
  });
}

/** The structure at this point, or null. */
export function obstacleAt(x, y, z) {
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && y >= o.y0 && y <= o.y1) return o;
  }
  return null;
}

/** Terrain height in metres above sea level (sea level is y = 0). */
/**
 * Flat surfaces standing above the world: the carrier deck, and anything else
 * you are meant to be able to land on that is not the ground.
 *
 * Kept as a list the world can register into, rather than special-cased inside
 * heightAt, so adding a second ship — or an oil rig, or a rooftop pad — costs
 * one push and nothing else has to know.
 */
export const PLATFORMS = [];

export function clearPlatforms() {
  PLATFORMS.length = 0;
}

/**
 * @param {number} cx centre
 * @param {number} cz centre
 * @param {number} w  full width  (across)
 * @param {number} d  full depth  (along)
 * @param {number} y  deck height above sea level
 * @param {string} name
 */
/**
 * @param {object} [arrest] world-space {z0, z1} band where the wires are, if
 *   this deck has any. A deck without it is just somewhere to land.
 */
export function addPlatform(cx, cz, w, d, y, name, arrest = null) {
  PLATFORMS.push({ cx, cz, hw: w / 2, hd: d / 2, y, name, arrest });
}

/** The deck under this point, or null. */
export function platformAt(x, z) {
  for (let i = 0; i < PLATFORMS.length; i++) {
    const p = PLATFORMS[i];
    if (Math.abs(x - p.cx) <= p.hw && Math.abs(z - p.cz) <= p.hd) return p;
  }
  return null;
}


/* ==================================================================== *
 * Waters: harbours, dredged channels, shoals and shelves.
 *
 * Why these exist at all. Run the height function out to sea on any map in
 * the game and it returns exactly `seaFloor` — the same number, every sample,
 * everywhere outside an island's own radius. The sea is a flat plate. That is
 * invisible from an aeroplane at 3,000 ft and it is the whole problem with the
 * boat: there is nothing out there to steer round, nothing to read a chart
 * for, and nowhere that is different from anywhere else. These three terms are
 * what put shape under the water, and they are the only thing in the boat game
 * that the terrain system does not already do.
 *
 * All three are shaped like `outpostWeight` above: a bounding-box reject that
 * returns immediately for essentially every sample on the map, and only then
 * a smoothstep blend. That reject is not optional. heightAt runs a few hundred
 * times a frame for hull contact, about ninety thousand times while the mesh
 * is built, and 262,144 times to build one chart tile. Measured over a window
 * the size of that tile: 160 ns a sample as it stands, 174 ns with Sennen's
 * harbour and shoals, 179 ns with the Skerries' sixteen. That is +9% and +12%,
 * and away from the harbour it is nearer nothing.
 *
 * ONE RULE, and the brief had it the other way round: a dredged channel only
 * ever DEEPENS. Writing the floor to -7 the way it was first specified would
 * have built a shallow bar down the middle of the approach on every existing
 * map in the game, because their sea floors are -22 (the atoll) to -60 (the
 * fjords) and -7 is nineteen metres of sand piled up. The test below is
 * `if (h > floor)`, and a channel is therefore worth having only on a map with
 * a shelf to cut it into — which is why the three boat maps carry one and the
 * nine flight maps get an approach shelf generated for them.
 * ==================================================================== */

/**
 * Work out, once per map load, everything the per-sample terms would
 * otherwise have to recompute millions of times: the harbour's mouth axis and
 * its bounding radius, and the bounding boxes of the channel and the shoals.
 *
 * A harbour may give its position two ways. Three hand-authored boat maps know
 * exactly where their harbour is and say so. The nine flight maps do not — and
 * hand-measuring nine wobbling noise coastlines, then re-measuring all nine
 * every time somebody nudges an island's peak, is precisely the sort of
 * authoring cost that never gets paid twice. So they give an island and a
 * bearing, and the shore is found the way `coastline` in features.js already
 * finds it: march out along the bearing until the ground goes under water,
 * then bisect. About a hundred height samples, once, at map load.
 *
 * `_pending` is the trick that keeps that from eating itself: the ray-march
 * calls heightAt, heightAt asks the harbour term for its answer, and the
 * harbour term does not have one yet. While the flag is up the term returns
 * the natural ground, so the search sees the coastline the harbour is about
 * to be cut into rather than the harbour.
 */
export function resolveWaters(map) {
  const w = map.waters;
  if (!w || w._ready) return;

  const H = w.harbour;
  if (H) {
    if (H.cx === undefined || H.cz === undefined) {
      H._pending = true;
      const isl = map.islands[H.island || 0];
      // Game bearing, the same as everywhere else: 0 is -z, 90 is +x.
      const a = ((H.bearingDeg ?? 180) * Math.PI) / 180;
      const dx = Math.sin(a);
      const dz = -Math.cos(a);
      const step = isl.radius * 0.01;
      let r = isl.radius * 1.6;
      while (r > isl.radius * 0.1 && heightAt(isl.cx + dx * r, isl.cz + dz * r) < 0) r -= step;
      let lo = r;
      let hi = r + step;
      for (let i = 0; i < 8; i++) {
        const mid = (lo + hi) / 2;
        if (heightAt(isl.cx + dx * mid, isl.cz + dz * mid) > 0) lo = mid;
        else hi = mid;
      }
      const shore = (lo + hi) / 2;
      // Far enough out that the quay stands just inside the natural shoreline
      // and the basin is in the water, whatever the coast wobble did here.
      const out = shore + (H.offset ?? H.length / 2 - 20);
      H.cx = Math.round(isl.cx + dx * out);
      H.cz = Math.round(isl.cz + dz * out);
      H.mouthDeg = H.mouthDeg ?? H.bearingDeg ?? 180;
      H._pending = false;
      /*
       * And an approach shelf, unless the map says otherwise.
       *
       * An auto-sited harbour on a flight map opens straight into fifty metres
       * of water, so the depth gauge reads "deep water" from the berth to the
       * horizon and the chart is one flat blue. A shoaling approach is what a
       * coast actually has, it is one more entry in a list the loop below
       * already walks, and it is what gives the nine flight maps a chart worth
       * looking at without a line of per-map authoring.
       */
      if (H.shelf !== false) {
        /*
         * Four lobes, not one circle.
         *
         * This was a single r=1150 shoal, and on the contact sheet of all
         * thirty-two maps it read as exactly what it was: a perfect pale blue
         * disc stamped on the sea off Longbank and the Skerries, with a
         * compass-drawn edge you could see from three thousand feet. Nothing
         * in the sea is a circle. A bank built out of overlapping lobes at
         * different depths costs three more bounding-box rejects per sample
         * and stops looking drawn.
         *
         * The angles and sizes come off the harbour's own coordinates, so a
         * map gets the same bank every load and two maps do not get the same
         * bank as each other.
         */
        const a2 = ((H.mouthDeg) * Math.PI) / 180;
        const R0 = H.shelfR || 1150;
        const T0 = H.shelfTop ?? -8;
        const n = Math.abs(Math.sin(H.cx * 0.0137 + H.cz * 0.0091));
        const lobes = [
          { turn: 0, out: 520, r: R0, top: T0 },
          { turn: 0.62 + n * 0.35, out: 700 + n * 220, r: R0 * 0.74, top: T0 - 3.4 },
          { turn: -0.74 - n * 0.3, out: 640 + n * 260, r: R0 * 0.82, top: T0 - 2.6 },
          { turn: 0.16 - n * 0.4, out: 1420 + n * 320, r: R0 * 0.62, top: T0 - 6.5 },
        ];
        const arr = w.shoals || (w.shoals = []);
        for (let i = lobes.length - 1; i >= 0; i--) {
          const L = lobes[i];
          const a = a2 + L.turn;
          arr.unshift({
            name: i ? 'approach bank' : 'approach shelf',
            cx: Math.round(H.cx + Math.sin(a) * L.out),
            cz: Math.round(H.cz - Math.cos(a) * L.out),
            r: Math.round(L.r),
            top: Math.round(L.top * 10) / 10,
            pow: 0.7,
          });
        }
      }
    }
    const rad = (H.mouthDeg * Math.PI) / 180;
    H._du = Math.sin(rad);
    H._dv = -Math.cos(rad);
    H._reach =
      Math.hypot(H.length / 2, H.width / 2) + (H.wallW || 26) * 1.7 + (H.blend || 150);
  }

  const C = w.channel;
  if (C && C.path && C.path.length > 1) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const [x, z] of C.path) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (z < z0) z0 = z;
      if (z > z1) z1 = z;
    }
    const pad = (C.halfWidth || 55) + (C.blend || 40);
    C._x0 = x0 - pad;
    C._x1 = x1 + pad;
    C._z0 = z0 - pad;
    C._z1 = z1 + pad;
  }

  const S = w.shoals;
  if (S && S.length) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const s of S) {
      x0 = Math.min(x0, s.cx - s.r);
      x1 = Math.max(x1, s.cx + s.r);
      z0 = Math.min(z0, s.cz - s.r);
      z1 = Math.max(z1, s.cz + s.r);
    }
    w._sx0 = x0;
    w._sx1 = x1;
    w._sz0 = z0;
    w._sz1 = z1;
  }
  /*
   * And the roads. Same trick as the channel: one bounding box per road, grown
   * by the corridor's own width, so a sample away from the road costs four
   * compares instead of walking every segment of every road. Without this the
   * bbox test silently compares against `undefined`, which is false every
   * time, and the reject never fires — the road is correct and the terrain
   * build is several times slower than it needs to be.
   */
  const R = w.roads;
  if (R && R.length) {
    for (const rd of R) {
      const reach = (rd.halfWidth || 26) + (rd.blend || 55);
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (const pt of rd.path) {
        if (pt[0] < x0) x0 = pt[0];
        if (pt[0] > x1) x1 = pt[0];
        if (pt[1] < z0) z0 = pt[1];
        if (pt[1] > z1) z1 = pt[1];
      }
      rd._x0 = x0 - reach;
      rd._x1 = x1 + reach;
      rd._z0 = z0 - reach;
      rd._z1 = z1 + reach;
    }
  }

  w._ready = true;
}

/**
 * Shoals — and, with the same six lines, drying rocks, offshore stacks and the
 * coastal shelf.
 *
 * They started as three ideas and collapsed into one when the island system
 * turned out not to be able to make a rock. Every island in the game, whatever
 * its profile, begins with a fixed lerp out of the water — `lerp(-8, 34, ...)`
 * for a ridge — and that lerp saturates within a couple of hundred metres of
 * the middle. So an island of radius 150 is not a stack, it is a flat-topped
 * mesa forty-four metres high with sheer sides, and every one of them is the
 * same height as every other. A bump on the sea floor with a top you choose is
 * a rock when the top is above water, a shoal when it is just under, and a
 * shelf when it is enormous and gentle.
 *
 * `top` is an absolute height, not a rise, because the number a chart band and
 * a depth gauge care about is how much water is over the thing — not how far
 * it stands off a sea floor nobody can see. Shelves go FIRST in the array:
 * each entry lifts from whatever the last one left, so a rock listed after a
 * shelf stands on the shelf, which is what a rock does.
 *
 * `if (s.top <= h) continue` is what stops a shelf from flooding an island.
 * A shoal may only ever raise the bottom, never lower the land.
 */
function shoalHeight(h, x, z) {
  const w = MAP.waters;
  const S = w && w.shoals;
  if (!S || !S.length) return h;
  if (x < w._sx0 || x > w._sx1 || z < w._sz0 || z > w._sz1) return h;
  for (let i = 0; i < S.length; i++) {
    const s = S[i];
    const dx = x - s.cx;
    const dz = z - s.cz;
    if (dx < -s.r || dx > s.r || dz < -s.r || dz > s.r) continue;
    if (s.top <= h) continue;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (d >= s.r) continue;
    let t = 1 - smoothstep(0, s.r, d);
    if (s.pow) t = Math.pow(t, s.pow);
    h = lerp(h, s.top, t);
  }
  return h;
}

/**
 * A dredged channel: a lane cut through shallow water, deep enough to float a
 * boat that the ground either side of it would stop.
 *
 * This is what makes the buoys mean something. Without it a line of marks on
 * the water is decoration you can ignore by steering round the outside of it,
 * which is exactly what a ten-year-old will do the first time.
 *
 * It only ever deepens. See the note at the head of this section — writing the
 * floor unconditionally would raise a bar down the middle of the approach on
 * every map whose sea floor is deeper than the channel, which is nine of the
 * twelve.
 */
function channelHeight(h, x, z) {
  const C = MAP.waters && MAP.waters.channel;
  if (!C || !C.depth) return h;
  if (x < C._x0 || x > C._x1 || z < C._z0 || z > C._z1) return h;
  const floor = -C.depth;
  if (h <= floor) return h;
  const hw = C.halfWidth || 55;
  const blend = C.blend || 40;
  const p = C.path;
  let best = Infinity;
  for (let i = 1; i < p.length; i++) {
    const ax = p[i - 1][0];
    const az = p[i - 1][1];
    const ex = p[i][0] - ax;
    const ez = p[i][1] - az;
    const len2 = ex * ex + ez * ez;
    let t = len2 > 0 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t - x;
    const qz = az + ez * t - z;
    const d2 = qx * qx + qz * qz;
    if (d2 < best) best = d2;
  }
  const d = Math.sqrt(best);
  if (d > hw + blend) return h;
  return lerp(h, floor, 1 - smoothstep(hw, hw + blend, d));
}

/**
 * The harbour.
 *
 * An airfield gives a flight a beginning and an end and the world has nine of
 * them. It has no harbour at all, which is the single reason the boat reads as
 * a toy inside the flight sim: you start off a beach, nowhere, and there is
 * nowhere to come back to.
 *
 * Everything is measured in the harbour's own frame: `u` along the axis the
 * mouth faces, `v` across it. `sd` is the signed distance to a rectangle — the
 * standard box distance field, five arithmetic operations — so one expression
 * gives the basin, the walls, the quay and the blend into whatever is behind.
 *
 *   sd <= 0            the dredged basin, flat at -depth, so coming alongside
 *                      is the same job on every map in the game
 *   the mouth          a gap in the seaward side, basin depth carried straight
 *                      out through it, which is where the channel begins
 *   sd small, u < 0    the quay: a flat stone apron at +3.2, landward
 *   sd small, u > 0    the breakwater arms: steep inner face, rubble slope out
 *   beyond             blended back into the natural ground over `blend`
 *
 * What the height field deliberately does NOT try to do is LOOK like a
 * harbour. The terrain mesh is twenty-five metres a vertex, so a twenty-six
 * metre breakwater is one vertex wide and would render as a smear. The
 * breakwaters, the quay edge, the bollards and the buoys are geometry, built
 * by harbour.js and sitting on this. What this owes the game is the three
 * things the mesh cannot fake: the depth under the keel, somewhere flat to
 * come alongside, and a bottom that stops you. That is also why the boat maps
 * need no fine terrain chunks and cost no extra draw calls.
 */
function harbourHeight(h, x, z) {
  const H = MAP.waters && MAP.waters.harbour;
  if (!H || H._pending) return h;
  const dx = x - H.cx;
  const dz = z - H.cz;
  if (dx < -H._reach || dx > H._reach || dz < -H._reach || dz > H._reach) return h;

  const u = dx * H._du + dz * H._dv;
  const v = -dx * H._dv + dz * H._du;
  const A = H.length / 2;
  const B = H.width / 2;
  const qx = Math.abs(u) - A;
  const qz = Math.abs(v) - B;
  const sd =
    Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);

  const wallW = H.wallW || 26;
  const blend = H.blend || 150;
  const floor = -(H.depth || 6);

  if (sd <= 0) return floor;

  // The mouth. Carrying the basin depth out through the gap is what stops
  // there being a bar across the entrance you would touch on the way out.
  if (u > 0 && Math.abs(v) < (H.mouthWidth || 70) / 2) {
    const outer = wallW * 1.6;
    if (sd < outer) return floor;
    const w = 1 - smoothstep(outer, outer + blend, sd);
    return h > floor ? lerp(h, floor, w) : h;
  }

  if (u < 0) {
    // The quay, and the ground behind it. A flat apron first, then a blend up
    // into whatever the island is doing — which at Sennen is a cliff, and that
    // is right: the harbour is cut into a headland.
    const quayW = H.quayW || wallW;
    const top = H.quayY ?? 3.2;
    if (sd < quayW) return lerp(floor, top, smoothstep(0, quayW * 0.55, sd));
    const w = 1 - smoothstep(quayW, quayW + blend, sd);
    return lerp(h, top, w);
  }

  // A breakwater arm: near-vertical on the harbour side, armoured slope on the
  // sea side, which is both what one looks like and what the coarse mesh can
  // actually draw.
  const top = H.wallY ?? 4.2;
  const crest = wallW * 0.5;
  if (sd < crest) return lerp(floor, top, smoothstep(0, crest, sd));
  const outer = wallW * 1.7;
  const bed = h > floor ? floor : h;
  if (sd < outer) return lerp(top, bed, smoothstep(crest, outer, sd));
  const w = 1 - smoothstep(outer, outer + blend * 0.5, sd);
  return h > floor ? lerp(h, floor, w) : h;
}

/**
 * The three of them, in the order that makes sense: the sea floor is shaped
 * first, the channel is cut through whatever shape that left, and the harbour
 * is built last because a harbour wins over everything.
 */
/**
 * A road: a corridor of ground levelled along a path.
 *
 * Not a ribbon laid on top of the terrain — a cut through it, the same way
 * the runway pad and the approach corridors already work, because a ribbon
 * drawn on this mesh cannot be seen. The terrain is 30 to 70 metres per quad
 * (39 on Kestrel), so the narrowest feature the geometry can actually hold is
 * about three quads, 70 to 120 m. A 10 m road is a quarter of one quad: it
 * would float over every rise and sink into every dip between two vertices,
 * and no amount of care in the road's own mesh would fix that, because the
 * error is in the ground underneath it.
 *
 * So the corridor is deliberately wide and blended wider still. What the
 * player reads as "a road" is the strip of tarmac drawn down the middle of
 * it; what makes the strip sit flat is that the land around it was levelled
 * to meet it.
 */
function roadHeight(h, x, z) {
  const R = MAP.waters && MAP.waters.roads;
  if (!R || !R.length) return h;
  /*
   * Never on the runway.
   *
   * A road corridor levels the ground it crosses, and a road passing near
   * runway zero nine would happily level the runway to its own height and dig
   * a trench across it. The pad is already flat and already correct, so the
   * road has no say there — the same rule the approach corridors follow, for
   * the same reason. It fades out over the last of the pad rather than
   * stopping dead, or the ground steps at the boundary.
   */
  const padW = padWeight(x, z);
  if (padW > 0.98) return h;
  const padFade = 1 - smoothstep(0.86, 0.98, padW);
  /*
   * THE STRONGEST ROAD WINS, rather than each one being blended in turn.
   *
   * Applying them in sequence averages them where two corridors overlap, and
   * two roads that converge on the same town from different directions overlap
   * for hundreds of metres. Measured on Cullen Sands, where the Cullen road
   * and the quay road pass within 46 m of each other at different heights: the
   * sequential blend put the ground 7.5 m above the road that was directly
   * underfoot and made a 42% wall out of two roads that were each a flat 8%.
   * Taking the nearest road's own answer means the ground under a road is that
   * road's height, whatever else is nearby.
   */
  let bestW = 0;
  let bestY = h;
  for (let i = 0; i < R.length; i++) {
    const rd = R[i];
    if (x < rd._x0 || x > rd._x1 || z < rd._z0 || z > rd._z1) continue;
    const hw = rd.halfWidth || 18;
    const blend = rd.blend || 55;
    const p = rd.path;
    let near = Infinity;
    /*
     * The height is a weighted average of every segment within reach, not the
     * single nearest one.
     *
     * Taking the nearest is right in the middle of a straight and wrong at a
     * bend: the nearest segment switches from one leg to the other in a single
     * step, and the two legs' profiles differ by a whole profile step, so the
     * ground jumps. Measured on Cape Vessel: 39% at a bend on a road whose own
     * profile is a flat 8%. Weighting by inverse square distance blends the
     * two legs through the corner, which is what a road does at a corner.
     */
    let sum = 0;
    let wsum = 0;
    // A path point is [x, z, y]: the two map coordinates first, the elevation
    // last. See the note over `path.push` in roads.js — the authored networks
    // in maps.js are written the same way, and a transposed one would look
    // perfectly ordinary here and cut a trench in the wrong place.
    for (let k = 1; k < p.length; k++) {
      const ax = p[k - 1][0];
      const az = p[k - 1][1];
      const ex = p[k][0] - ax;
      const ez = p[k][1] - az;
      const len2 = ex * ex + ez * ez;
      let t = len2 > 0 ? ((x - ax) * ex + (z - az) * ez) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t - x;
      const qz = az + ez * t - z;
      const d2 = qx * qx + qz * qz;
      if (d2 < near) near = d2;
      if (d2 < 40000) {
        // The road's own height at this point: the eased profile, so it follows
        // the land at a grade a child can drive rather than ignoring it.
        const wk = 1 / (d2 + 400);
        sum += lerp(p[k - 1][2] ?? h, p[k][2] ?? h, t) * wk;
        wsum += wk;
      }
    }
    const y = wsum > 0 ? sum / wsum : h;
    const d = Math.sqrt(near);
    if (d > hw + blend) continue;
    const w = 1 - smoothstep(hw, hw + blend, d);
    if (w > bestW) {
      bestW = w;
      bestY = y;
    }
  }
  return bestW > 0 ? lerp(h, bestY, bestW * padFade) : h;
}

function applyWaters(h, x, z) {
  if (!MAP.waters) return h;
  h = shoalHeight(h, x, z);
  h = channelHeight(h, x, z);
  h = harbourHeight(h, x, z);
  return roadHeight(h, x, z);
}

/**
 * What is under the keel, which is the one number a small boat is steered by.
 *
 * heightAt is negative at sea, so -h is the depth of water, and taking the
 * draught off it gives what actually matters: the gap between the bottom of
 * the boat and the bottom of the sea. It is the altimeter upside down, and it
 * belongs in the altimeter's slot on the HUD.
 */
export function depthUnderKeel(x, z, draughtM = 1.0) {
  return -heightAt(x, z) - draughtM;
}

/** Where the lifeboat lies: alongside the quay, inside the basin. */
export function harbourBerth() {
  const H = MAP.waters && MAP.waters.harbour;
  if (!H) return null;
  const u = -H.length / 2 + 46;
  const v = -H.width / 2 + 34;
  return {
    x: H.cx + H._du * u - H._dv * v,
    z: H.cz + H._dv * u + H._du * v,
    headingDeg: H.mouthDeg,
  };
}

/** The middle of the entrance, looking out. Where the channel starts. */
export function harbourMouth() {
  const H = MAP.waters && MAP.waters.harbour;
  if (!H) return null;
  const u = H.length / 2 + (H.wallW || 26);
  return { x: H.cx + H._du * u, z: H.cz + H._dv * u, headingDeg: H.mouthDeg };
}

/**
 * The buoyage, worked out from the channel rather than listed by hand.
 *
 * IALA Region A, and the direction of buoyage is always INTO the harbour — so
 * walking the path outward, as it is stored, the red can buoys lie to the
 * outward-bound boat's starboard hand. Say it to the child once, in the first
 * mission, in one sentence: coming home, keep the red ones on your left.
 *
 * Derived rather than authored because a hand-written buoy list drifts out of
 * step with the channel the moment anybody moves a waypoint, and then the
 * marks are lying — which is worse than having none.
 */
export function channelMarks(spacing = 260) {
  let C = MAP.waters && MAP.waters.channel;
  /*
   * A harbour with no authored channel gets one anyway.
   *
   * Only four of the seventeen boat-capable maps declare a `channel`, so on
   * the other thirteen the chart was a blank blue rectangle where the buoyage
   * should be — and buoyage is how a child learns which water is safe. The
   * harbour already knows where the quay is and which way the mouth faces, and
   * a channel is a line from one out through the other: berth, mouth, and
   * eight hundred metres of approach on the same bearing. Authored beats
   * derived, so an authored one always wins.
   */
  if (!C || !C.path || C.path.length < 2) {
    const b = harbourBerth();
    const m = harbourMouth();
    if (b && m) {
      const dx = m.x - b.x;
      const dz = m.z - b.z;
      const l = Math.hypot(dx, dz) || 1;
      C = {
        halfWidth: (MAP.waters.harbour && MAP.waters.harbour.mouthWidth / 2) || 55,
        path: [
          [b.x, b.z],
          [m.x, m.z],
          [m.x + (dx / l) * 800, m.z + (dz / l) * 800],
        ],
      };
    }
  }
  if (!C || !C.path || C.path.length < 2) return [];
  const hw = (C.halfWidth || 55) + 14;
  const out = [];
  let carried = 0;
  let side = 1;
  for (let i = 1; i < C.path.length; i++) {
    const ax = C.path[i - 1][0];
    const az = C.path[i - 1][1];
    const ex = C.path[i][0] - ax;
    const ez = C.path[i][1] - az;
    const len = Math.hypot(ex, ez);
    if (len < 1) continue;
    const ix = ex / len;
    const iz = ez / len;
    // Port hand of the OUTWARD direction is (-iz, ix); the red marks are the
    // other side, because the direction of buoyage runs the other way.
    for (let d = spacing - carried; d < len; d += spacing) {
      const x = ax + ix * d;
      const z = az + iz * d;
      const red = side > 0;
      const n = red ? 1 : -1;
      out.push({
        x: x + -iz * hw * n,
        z: z + ix * hw * n,
        kind: red ? 'port' : 'starboard', // named for the boat coming home
        colour: red ? 0xc0392b : 0x2e9e52,
        topmark: red ? 'can' : 'cone',
      });
      side = -side;
      carried = 0;
    }
    carried = (carried + len) % spacing;
  }
  const end = C.path[C.path.length - 1];
  out.push({ x: end[0], z: end[1], kind: 'fairway', colour: 0xd44b3c, topmark: 'sphere' });
  /*
   * And a buoy that came out ashore is not a buoy.
   *
   * The marks are offset from the centreline by half the channel width, so
   * where the channel runs close to a headland one side of the pair lands on
   * the headland. Measured across the seventeen: three of them. A missing
   * mark is a gap in the buoyage; a mark standing in a field is the chart
   * lying about where the water is, which is worse.
   */
  return out.filter((k) => heightAt(k.x, k.z) < -0.3);
}

/**
 * The shoals shallow enough that the sea breaks over them.
 *
 * A hazard nothing marks is not a challenge, it is an ambush: the ocean is an
 * opaque plane at y=0, so a rock with a metre of water over it is completely
 * invisible from the helm and the first a child knows of it is the bang. The
 * chart answers for the deep ones. The shallow ones get broken water, drawn by
 * seamarks.js, and that split IS the difficulty gradient — what you can see,
 * and what you have to have read.
 */
export function dryingShoals(limit = 1.8) {
  const S = (MAP.waters && MAP.waters.shoals) || [];
  return S.filter((s) => s.top > -limit && s.r < 900);
}


/**
 * A corridor is a clearing, not a quarry.
 *
 * The rule was: anywhere inside the lane, take the ground down to the ceiling,
 * however far down that is. Measured, that removed 46% of Kestrel's land and
 * 42% of Fjord's, cutting up to 345 m on one and 800 m on the other — a bright
 * green cross carved through thirty of the thirty-two maps, and on Fjord a
 * canyon straight through both of its named mountains. It is invisible from
 * the cockpit on final, which is the only place anyone ever looked at it.
 *
 * So the cut is capped. Where the ground is gently above the lane it is taken
 * down and you get a valley; where it is a mountain, the mountain stays and
 * the map has a blocked approach, which is a fact about the map and something
 * its author can fix. Levelling a 300 m peak to make the numbers work is not
 * fixing it, it is hiding it.
 */
function clearForApproach(h, ceiling, w) {
  if (h <= ceiling || w <= 0) return h;
  const wanted = h - ceiling;
  return h - Math.min(wanted, MAX_APPROACH_CUT) * w;
}

/**
 * How high the ground may be, this far out along an approach.
 *
 * This was a FLAT ceiling — field elevation plus ten metres, held for five and
 * a half kilometres, in a band nearly a mile wide, in both directions. On an
 * island 2.4 km across that is not a corridor, it is a cross bulldozed through
 * the whole place, and it is why thirty of the thirty-two maps have a bright
 * green plus-sign carved into them. You cannot see it from the cockpit on
 * final, which is the only place anybody ever looked; you can see nothing else
 * the moment you look down at the island from above.
 *
 * An approach does not need a trench. It needs the ground to stay below the
 * glideslope, and a glideslope RISES. Three degrees from the threshold is what
 * every real instrument approach uses, and at five and a half kilometres that
 * is nearly three hundred metres of clearance — so the hills at the far end of
 * the valley keep their tops, and only what would actually be in the way is
 * taken down.
 *
 * Measured after the change: Kestrel's peak goes from 341 m to its declared
 * 300-odd, Fjord stops having a 3.3 by 5.2 km flat trench through both of its
 * named mountains, and the cross is gone from every map that had one.
 */
function approachCeiling(along, across, floorW) {
  /*
   * Flat over the strip itself, then a climb-out gradient away from it.
   *
   * `along` is measured from the runway CENTRE, so the flat part only has to
   * reach the threshold — half the runway's own length. Past that the ceiling
   * climbs at the rate a light aeroplane climbs, which is what the corridor is
   * for: not a level trench to the horizon, a lane you can get out along.
   */
  const flat = (AIRPORT.runway.length || 1100) / 2;
  const rise = Math.max(0, along - flat) * APPROACH_SLOPE;
  // And the valley sides. The floor stays a runway's width across — wide
  // enough that a wandering final is still over flat ground — and climbs from
  // there, so a hill beside the lane keeps most of itself.
  const shoulder = Math.max(0, (across || 0) - 120) * APPROACH_SIDE_SLOPE;
  /*
   * And the floor is not a floor. Clamping to one number gives a valley with
   * a spirit-level bottom, which from three thousand feet is the one thing
   * that says "somebody levelled this". A few metres of undulation costs
   * nothing and no aeroplane ever notices it.
   */
  const roll = 9 * wobble(along * 1.7 + (floorW || 0) * 3.1, 0.0013, 5.1);
  return AIRPORT.elev + 10 + rise + shoulder + roll;
}

/**
 * A slow wobble in [0, 1]. Two sines at incommensurable rates: not noise, but
 * it never repeats over the five kilometres anybody sees of it, and it costs
 * two sines rather than three octaves of fbm on a function that runs a
 * quarter of a million times to build one chart tile.
 */
function wobble(t, rate, phase) {
  return 0.5 + 0.35 * Math.sin(t * rate + phase) + 0.15 * Math.sin(t * rate * 2.7 + phase * 1.9);
}

/**
 * The lane's own half-width at this distance out.
 *
 * A valley is not a corridor of constant width and an island with one through
 * it looks like an airfield somebody bulldozed — which is exactly what the
 * contact sheet showed. This keeps the lane at least 210 m wide either side,
 * which is wider than any final approach a ten-year-old flies, and lets it
 * open out and neck in between.
 */
function laneWidth(halfWidth, along) {
  return Math.max(210, halfWidth * (0.72 + 0.5 * wobble(along, 0.0011, 0.8)));
}

export function heightAt(x, z) {
  // A deck wins over whatever is underneath it — that is the point of a deck.
  // Not, however, while the authored flats are being measured: a carrier
  // moored across a quay would hand the quay a twenty-metre deck height and
  // bury the harbour under it for the rest of the session.
  if (PLATFORMS.length && !RESOLVING) {
    const p = platformAt(x, z);
    if (p) return p.y;
  }

  /*
   * Authored level ground, found here so the airfield short-circuit below
   * cannot skip past it. On the nine maps that have no flats this is a single
   * array-length check; on a courier map it is about twenty compares, against
   * the three fbm evaluations the island loop below is about to do.
   */
  const flat = FLATS.length ? flatAt(x, z) : null;
  const flatW = flat ? FLAT_W : 0;

  // Ground operations happen almost entirely on the airfield, so short-circuit
  // the whole noise stack when we are well inside the flattened plateau.
  const padW = padWeight(x, z);
  if (padW > 0.9995 && !flat) return AIRPORT.elev;

  let h = SEA_FLOOR;

  for (let i = 0; i < ISLANDS.length; i++) {
    const isl = ISLANDS[i];
    const m = islandField(x, z, isl);
    if (m <= 0.0001) continue;

    const s = 1 / 900;
    const hills = fbm(x * s, z * s, { octaves: 4, gain: 0.52, seed: isl.seed * 7 });
    const ridge =
      1 - Math.abs(fbm(x * s * 0.45 + 30, z * s * 0.45, { octaves: 3, seed: isl.seed * 13 }) - 0.5) * 2;
    const detail = fbm(x / 130, z / 130, { octaves: 2, seed: isl.seed * 3 });

    // Beach → inland: rise quickly out of the water, then roll into whatever
    // shape this island is supposed to be.
    let local;
    switch (isl.profile) {
      case 'plains': {
        // Wide and gentle. No ridge term at all, so there is nothing steep
        // anywhere — this is the map you learn to land on.
        const inland = smoothstep(0.02, 0.6, m);
        local =
          lerp(-4, 22, smoothstep(0, 0.3, m)) + inland * hills * isl.peak * 0.85 + inland * detail * 5;
        break;
      }
      case 'flat': {
        // A sandy cay barely out of the water: broad beaches, a low spine of
        // scrub down the middle.
        const inland = smoothstep(0.04, 0.5, m);
        local =
          lerp(-3, 9, smoothstep(0, 0.36, m)) + inland * hills * isl.peak * 0.6 + inland * detail * 3;
        break;
      }
      case 'ridge': {
        // Steep and craggy, with the ridges running right down into the water.
        const inland = smoothstep(0.01, 0.42, m);
        local =
          lerp(-8, 34, smoothstep(0, 0.2, m)) +
          inland * (Math.pow(ridge, 1.5) * isl.peak * 1.05 + hills * isl.peak * 0.3) +
          inland * detail * 15;
        break;
      }
      case 'cone': {
        // A volcano.
        //
        // This used to be shaped from `m`, the island field — but that
        // saturates at 1 across the whole middle of the island, so the "cone"
        // came out as a flat table 2 km wide at a constant height and the
        // "crater" never appeared at all. That is why Ember Isle read as a
        // mountain rather than a volcano.
        //
        // Shape it from the radius instead. The summit is the crater *rim*,
        // the flanks fall away from there with the slight concavity a real
        // strato-volcano has, and the middle is a genuine bowl you can fly
        // down into.
        const dRel = Math.min(1, Math.hypot(x - isl.cx, z - isl.cz) / isl.radius);
        const rimRel = (isl.craterRadius || isl.radius * 0.12) / isl.radius;
        const inland = smoothstep(0.02, 0.5, m);

        // 1 at the rim, 0 down at the shoreline.
        const flank = Math.pow(clamp((1 - dRel) / (1 - rimRel), 0, 1), 1.55);
        /*
         * Radial gullies down the flanks — real cones are fluted, not smooth.
         *
         * One sine at thirteen cycles gives thirteen identical flutes at
         * thirteen identical spacings, which from above is a dartboard: it is
         * what made Ember's cone read as a drawn symbol rather than a
         * mountain. Three rates that do not divide into each other, and the
         * flutes come out different widths and different depths, which is
         * what erosion does. Still three sines per sample, and only inside a
         * cone island.
         */
        const ang = Math.atan2(z - isl.cz, x - isl.cx);
        const flute =
          0.55 * Math.sin(ang * 9 + isl.seed) +
          0.28 * Math.sin(ang * 17 + isl.seed * 1.7) +
          0.17 * Math.sin(ang * 29 + isl.seed * 0.6);
        const gully = (flute * 0.5 + 0.5) * smoothstep(rimRel, 0.85, dRel);
        // The crater bowl: flat-floored in the middle, up to the rim.
        const bowl = 1 - smoothstep(rimRel * 0.55, rimRel, dRel);

        local =
          lerp(-5, 20, smoothstep(0, 0.3, m)) +
          inland * (flank * isl.peak * (1 - gully * 0.045) + hills * isl.peak * 0.06) -
          inland * (isl.crater || 0) * bowl +
          inland * detail * 7;
        break;
      }
      default: {
        const inland = smoothstep(0.02, 0.55, m);
        local =
          lerp(-4, 26, smoothstep(0, 0.28, m)) +
          inland * (hills * isl.peak * 0.55 + Math.pow(ridge, 2.2) * isl.peak * 0.75) +
          inland * detail * 9;
      }
    }

    // Islands are far apart, so max() keeps each coastline clean.
    const candidate = lerp(SEA_FLOOR, local, smoothstep(0, 0.16, m));
    if (candidate > h) h = candidate;
  }

  if (padW > 0) h = lerp(h, AIRPORT.elev, padW);

  // The outlying strip. Its elevation is resolved once at map load rather than
  // read from the map every call, so a map may write `elev: 'auto'` and stop
  // guessing at a number it cannot know.
  const outW = RESOLVING ? 0 : outpostWeight(x, z);
  if (outW > 0) h = lerp(h, OUTPOST_ELEV, outW);

  // Approach corridor. Without this the airfield sits in a bowl with 1,100 ft
  // hills a kilometre off each end of the runway, and every take-off and every
  // approach flies straight into one. Keeping the extended centreline low turns
  // it into a valley through the hills, which is both flyable and good-looking.
  const along = Math.abs(x - AIRPORT.runway.cx);
  const across = Math.abs(z - AIRPORT.runway.cz);
  if (along < CORRIDOR.length && across < (CORRIDOR.halfWidth + CORRIDOR.blend) * 1.5) {
    const hw = laneWidth(CORRIDOR.halfWidth, along);
    const bl = CORRIDOR.blend * (0.75 + 0.5 * wobble(along, 0.0019, 2.6));
    if (across < hw + bl) {
      const lateral = 1 - smoothstep(hw, hw + bl, across);
      const longitudinal = 1 - smoothstep(CORRIDOR.fadeFrom, CORRIDOR.length, along);
      const w = lateral * longitudinal;
      h = clearForApproach(h, approachCeiling(along, across, hw), w);
    }
  }

  /*
   * And the same the other way, for 18/36. A second runway you cannot approach
   * is not a second runway.
   *
   * Which way "the other way" runs has to be read off the runway rather than
   * assumed. This measured `along` up the z axis and `across` up x whatever
   * the map said, which is right for a strip on heading 180 and wrong at Los
   * Angeles, where the second runway is parallel to the first: there the
   * canyon was cut sideways across the runway and off into the ground either
   * side of it, while the approach it exists to clear was left alone.
   */
  const r2 = AIRPORT.runway2;
  /*
   * A map may have one runway. regionWeight and isOnRunway2 already allowed
   * for that; this did not, and reading a heading off nothing threw a
   * TypeError on the very first height sample — before a single frame was
   * drawn, so the whole game came up black. Found by building a boat map
   * whose airfield is one grass strip.
   */
  if (r2) {
    const r2AlongX = Math.abs((((r2.headingDeg ?? 180) % 180) - 90)) < 45;
    const along2 = r2AlongX ? Math.abs(x - r2.cx) : Math.abs(z - r2.cz);
    const across2 = r2AlongX ? Math.abs(z - r2.cz) : Math.abs(x - r2.cx);
    if (along2 < CORRIDOR2.length && across2 < (CORRIDOR2.halfWidth + CORRIDOR2.blend) * 1.5) {
      const hw2 = laneWidth(CORRIDOR2.halfWidth, along2 + 1900);
      const bl2 = CORRIDOR2.blend * (0.75 + 0.5 * wobble(along2 + 1900, 0.0019, 2.6));
      if (across2 < hw2 + bl2) {
        const lateral = 1 - smoothstep(hw2, hw2 + bl2, across2);
        const longitudinal = 1 - smoothstep(CORRIDOR2.fadeFrom, CORRIDOR2.length, along2);
        const w = lateral * longitudinal;
        h = clearForApproach(h, approachCeiling(along2, across2, hw2), w);
      }
    }
  }

  /*
   * Last, so a shoal can raise the sea floor without fighting the island
   * field or the approach corridors — and so that a map with no `waters`
   * block pays one property read and nothing else.
   */
  // Harbour, dredged channel, shoals and roads. Last, because a harbour wins
  // over the ground it was dug out of, and because every one of them rejects
  // on a bounding box before it costs anything.
  /*
   * Authored level ground, applied LAST so it beats everything else.
   *
   * The pad goes on before the approach corridors, which is right for a pad —
   * the corridor should be free to carve a valley through a hill the airfield
   * happens to sit under. A quay is the opposite: whoever wrote the map said
   * the ground is level here, and nothing downstream should argue. Putting it
   * last also means the causeway on Cullen Sands survives the corridor running
   * the length of it, which it would not if the order were the other way.
   */
  if (flat && flatW > 0) h = lerp(h, flat.y, flatW);

  return MAP.waters ? applyWaters(h, x, z) : h;
}

/** Surface normal from finite differences — used for tyre friction and props. */
export function normalAt(x, z, out = new THREE.Vector3()) {
  const e = 4;
  const hl = heightAt(x - e, z);
  const hr = heightAt(x + e, z);
  const hd = heightAt(x, z - e);
  const hu = heightAt(x, z + e);
  out.set(hl - hr, 2 * e, hd - hu).normalize();
  return out;
}

export function isOnRunway(x, z, margin = 0) {
  const r = AIRPORT.runway;
  return (
    Math.abs(z - r.cz) <= r.halfWidth + margin &&
    Math.abs(x - r.cx) <= r.length / 2 + margin
  );
}

/**
 * The second runway.
 *
 * It used to be assumed north-south, because on Kestrel it is. At a real field
 * the second strip may well be parallel to the first — that is exactly what
 * makes Los Angeles feel like Los Angeles — so it now reads its own heading
 * and tests along whichever axis it actually lies on. Assuming was fine while
 * there was one airport; it is a silent bug the moment there are four.
 */
export function isOnRunway2(x, z, margin = 0) {
  const r = AIRPORT.runway2;
  if (!r) return false;
  const alongX = Math.abs((((r.headingDeg ?? 180) % 180) - 90)) < 45;
  if (alongX) {
    return (
      Math.abs(z - r.cz) <= r.halfWidth + margin &&
      Math.abs(x - r.cx) <= r.length / 2 + margin
    );
  }
  return (
    Math.abs(x - r.cx) <= r.halfWidth + margin &&
    Math.abs(z - r.cz) <= r.length / 2 + margin
  );
}

/** On either runway — what landing scoring and the ATC should ask. */
export function isOnAnyRunway(x, z, margin = 0) {
  return isOnRunway(x, z, margin) || isOnRunway2(x, z, margin);
}

/**
 * Which runway the wind favours, and by how much.
 * Returns the better of the four directions with its head- and crosswind.
 */
export function bestRunway(windDirDeg, windKts) {
  const options = [
    { name: '09', headingDeg: 90, runway: AIRPORT.runway },
    { name: '27', headingDeg: 270, runway: AIRPORT.runway },
    { name: '18', headingDeg: 180, runway: AIRPORT.runway2 },
    { name: '36', headingDeg: 360, runway: AIRPORT.runway2 },
  ].map((o) => {
    const rel = ((windDirDeg - o.headingDeg + 540) % 360) - 180;
    const rad = (rel * Math.PI) / 180;
    return {
      ...o,
      headwind: Math.cos(rad) * windKts,
      crosswind: Math.abs(Math.sin(rad)) * windKts,
    };
  });
  // Most headwind wins; a tailwind is disqualifying before anything else.
  options.sort((a, b) => b.headwind - a.headwind);
  return options[0];
}

/** True when the point is paved (runway, taxiway or apron). */
export function isPaved(x, z) {
  // A steel deck is as paved as it gets.
  if (PLATFORMS.length && platformAt(x, z)) return true;
  if (isOnRunway(x, z, 2)) return true;
  // The crosswind runway.
  if (isOnRunway2(x, z, 2)) return true;
  // Taxiway running parallel, south of the runway.
  if (Math.abs(z + 95) <= 12 && Math.abs(x) <= 430) return true;
  // Two connectors.
  if (Math.abs(x - -430) <= 12 && z >= -95 && z <= 0) return true;
  if (Math.abs(x - 0) <= 12 && z >= -95 && z <= 0) return true;
  // Apron.
  // The apron runs right up to the taxiway edge. It used to stop 3 m short,
  // leaving a strip of grass between them that you had to taxi across.
  if (x >= -260 && x <= 100 && z >= -190 && z <= -106) return true;
  return false;
}

function buildChunk(centerX, centerZ, size, segments, materialFactory) {
  const geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const count = pos.count;
  const blend = new Float32Array(count * 3);
  const arr = pos.array;

  // Pass 1: sample the height once per vertex. PlaneGeometry lays vertices out
  // row by row, which lets pass 2 read slopes straight out of this array
  // instead of calling the (expensive) height function four more times.
  const W = segments + 1;
  const heights = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const x = arr[i * 3] + centerX;
    const z = arr[i * 3 + 2] + centerZ;
    const h = heightAt(x, z);
    heights[i] = h;
    arr[i * 3 + 1] = h;
  }
  pos.needsUpdate = true;

  // Pass 2: slope from neighbouring samples → sand / grass / rock weights.
  const spacing = size / segments;
  for (let iy = 0; iy < W; iy++) {
    for (let ix = 0; ix < W; ix++) {
      const i = iy * W + ix;
      const h = heights[i];
      const hl = heights[iy * W + Math.max(0, ix - 1)];
      const hr = heights[iy * W + Math.min(W - 1, ix + 1)];
      const hd = heights[Math.max(0, iy - 1) * W + ix];
      const hu = heights[Math.min(W - 1, iy + 1) * W + ix];
      const slope = Math.hypot(hr - hl, hu - hd) / (2 * spacing);

      let sand = 1 - smoothstep(2, 30, h);
      let rock = clamp(smoothstep(0.30, 0.95, slope) * 0.9 + smoothstep(150, 300, h) * 0.5, 0, 1);
      let grass = clamp(1 - sand - rock, 0, 1);
      // The airfield plateau is mown grass, never sand or rock.
      const x = arr[i * 3] + centerX;
      const z = arr[i * 3 + 2] + centerZ;
      if (Math.abs(x) < 900 && z > -420 && z < 360 && Math.abs(h - AIRPORT.elev) < 3) {
        sand = 0;
        rock = 0;
        grass = 1;
      }
      const sum = sand + grass + rock || 1;
      blend[i * 3] = sand / sum;
      blend[i * 3 + 1] = grass / sum;
      blend[i * 3 + 2] = rock / sum;
    }
  }

  geo.setAttribute('aBlend', new THREE.BufferAttribute(blend, 3));
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(geo, materialFactory());
  mesh.position.set(centerX, 0, centerZ);
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  return mesh;
}

/**
 * Terrain material: three procedural textures blended per-vertex by
 * height + slope, with a low-frequency tint to hide the tiling.
 */
function makeTerrainMaterial() {
  const grass = grassTexture();
  const sand = sandTexture();
  const rock = rockTexture();
  const splat = terrainSplatNoise();
  grass.repeat.set(150, 150);
  sand.repeat.set(150, 150);
  rock.repeat.set(150, 150);
  splat.repeat.set(6, 6);

  // A relief normal map at a different tiling rate from the colour maps gives
  // the ground real surface texture instead of flat shading.
  const nrm = groundNormal().clone();
  nrm.needsUpdate = true;
  nrm.wrapS = nrm.wrapT = THREE.RepeatWrapping;
  nrm.repeat.set(620, 620);

  const mat = new THREE.MeshStandardMaterial({
    map: grass,
    normalMap: nrm,
    normalScale: new THREE.Vector2(0.55, 0.55),
    roughness: 0.9,
    metalness: 0,
    envMapIntensity: 0.35,
  });

  // Per-map ground tint. The three procedural textures are generated once and
  // shared by every map; a multiply in the shader is what turns tropical green
  // into fjord grey or volcanic ash, for no extra memory and no rebuild cost.
  const tint = PALETTE || {};
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSand = { value: sand };
    shader.uniforms.uRock = { value: rock };
    shader.uniforms.uSplat = { value: splat };
    shader.uniforms.uTintGrass = { value: new THREE.Vector3(...(tint.grass || [1, 1, 1])) };
    shader.uniforms.uTintSand = { value: new THREE.Vector3(...(tint.sand || [1, 1, 1])) };
    shader.uniforms.uTintRock = { value: new THREE.Vector3(...(tint.rock || [1, 1, 1])) };
    shader.uniforms.uShallow = { value: new THREE.Vector3(...(tint.shallow || [0.31, 0.84, 0.78])) };
    // Snow line. Off by default — a start height above anything on the map
    // costs one compare per fragment and changes nothing.
    shader.uniforms.uSnow = { value: new THREE.Vector2(...(tint.snow || [99999, 99999])) };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aBlend;\nvarying vec3 vBlend;\nvarying float vGroundY;'
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n  vBlend = aBlend;\n  vGroundY = position.y;'
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vBlend;
         varying float vGroundY;
         uniform sampler2D uSand;
         uniform sampler2D uRock;
         uniform sampler2D uSplat;
         uniform vec3 uTintGrass;
         uniform vec3 uTintSand;
         uniform vec3 uTintRock;
         uniform vec3 uShallow;
         uniform vec2 uSnow;`
      )
      .replace(
        '#include <map_fragment>',
        `
        // De-tiling: sample every ground texture twice — once at the base
        // scale and once smaller, rotated and offset — then cross-fade with a
        // very low-frequency mask. A single tiled sample reads as an obvious
        // repeating grid from the air; this does not.
        vec2 uvA = vMapUv;
        mat2 rot = mat2(0.8433, -0.5374, 0.5374, 0.8433); // ~32 degrees
        vec2 uvB = rot * vMapUv * 0.41 + vec2(0.37, 0.61);
        float mask = texture2D(uSplat, vMapUv * 0.0045).r;
        mask = smoothstep(0.25, 0.75, mask);

        vec4 texGrass = mix(texture2D(map, uvA), texture2D(map, uvB), mask);
        vec4 texSand  = mix(texture2D(uSand, uvA), texture2D(uSand, uvB), mask);
        vec4 texRock  = mix(texture2D(uRock, uvA), texture2D(uRock, uvB), mask);
        texGrass.rgb *= uTintGrass;
        texSand.rgb  *= uTintSand;
        texRock.rgb  *= uTintRock;
        vec4 blended  = texSand * vBlend.x + texGrass * vBlend.y + texRock * vBlend.z;
        // Large-scale tint breaks up the repeating pattern.
        float tint = texture2D(uSplat, vMapUv * 0.012).r;
        float tint2 = texture2D(uSplat, vMapUv * 0.0031).r;
        blended.rgb *= mix(0.80, 1.16, tint);
        // A second, much larger-scale variation stops the island looking like
        // one flat colour from the air.
        blended.rgb *= mix(0.88, 1.10, tint2);
        // Warm the low ground and cool the high ground very slightly.
        blended.rgb *= mix(vec3(1.03, 1.0, 0.94), vec3(0.95, 0.99, 1.05), vBlend.z);
        // Wet sand. The terrain grid is tens of metres across, so where nearly
        // flat land crosses sea level the waterline lands on polygon edges and
        // reads as a hard staircase from the air. Fading the last few metres
        // into the shallow-water colour hides the geometry under a gradient
        // that matches the sea it meets.
        float wet = 1.0 - smoothstep(-0.6, 3.2, vGroundY);
        blended.rgb = mix(blended.rgb, uShallow, wet * 0.88);
        // Snow on the high ground. The splat noise ragged-edges the snow line
        // so it follows the terrain instead of drawing a contour ring, and
        // steep faces keep their rock — snow does not sit on a cliff.
        float snow = smoothstep(uSnow.x, uSnow.y, vGroundY + (tint - 0.5) * 90.0);
        snow *= 1.0 - vBlend.z * 0.55;
        blended.rgb = mix(blended.rgb, vec3(0.93, 0.95, 0.99), snow);
        diffuseColor *= blended;
        `
      );
  };
  return mat;
}

export function createTerrain(scene, quality = 'high') {
  const group = new THREE.Group();
  group.name = 'terrain';
  const detail = quality === 'low' ? 0.55 : quality === 'medium' ? 0.78 : quality === 'ultra' ? 1.4 : 1;
  const mat = makeTerrainMaterial();
  const factory = () => mat;

  for (const c of MAP.chunks) {
    group.add(buildChunk(c.cx, c.cz, c.size, Math.round(c.segments * detail), factory));
  }
  scene.add(group);
  return group;
}

/**
 * Scatter helper: returns positions on land that satisfy a predicate.
 * Used for palm trees and the island town.
 */
export function scatter({ cx, cz, radius, count, seed = 1, minH = 3, maxH = 400, maxSlope = 0.4, avoidAirport = true }) {
  const rnd = makeRandom(seed);
  const out = [];
  let guard = 0;
  while (out.length < count && guard++ < count * 40) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * radius;
    const x = cx + Math.cos(a) * r;
    const z = cz + Math.sin(a) * r;
    const h = heightAt(x, z);
    if (h < minH || h > maxH) continue;
    const e = 12;
    const slope =
      Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) /
      (2 * e);
    if (slope > maxSlope) continue;
    /*
     * Nothing on the airfield itself. This test was the box `Math.abs(x) < 900
     * && z > -420 && z < 380`, which is Kestrel's pad plus its blend skirt
     * written out by hand — so on every other map the exclusion was the wrong
     * size and in the wrong place. Los Angeles puts its second runway a
     * kilometre south of the first, well outside that little box, and got a
     * solid stand of trees planted the length of it. padWeight() already knows
     * both pads of whichever map is loaded, blend included, and is what the
     * height field itself flattens by.
     */
    if (avoidAirport && padWeight(x, z) > 0) continue;
    /*
     * Nothing grows on made ground. Unconditional, not guarded by
     * `avoidAirport`, because a palm tree standing in the middle of the quay is
     * the same bug as a palm tree on the runway whoever asked for the scatter.
     * Village greens set `clear: false` and keep their trees.
     */
    if (FLATS.length) {
      const f = flatAt(x, z);
      if (f && f.clear) continue;
    }
    // Nothing tall in the approach corridor.
    if (avoidAirport && Math.abs(x) < CORRIDOR.length && Math.abs(z) < CORRIDOR.halfWidth) continue;
    out.push({ x, z, y: h, rot: rnd() * Math.PI * 2, scale: 0.75 + rnd() * 0.6 });
  }
  return out;
}

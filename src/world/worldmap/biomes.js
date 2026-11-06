/**
 * World Map — what kind of country this is (owner: "more biomes, and better
 * trees etc in those biomes").
 *
 * Six regions in three climate bands painted one green. This says which of
 * seven biomes a point belongs to, from where it is and how high it stands,
 * as soft weights that overlap, so no biome has an edge: each is an oval on
 * the sea with its border wandering on slow noise, some eight kilometres wide.
 *
 *   DESERT    the Southern Sands: sand, real dunes, red rock mesas cut by canyons
 *   SAVANNA   round the desert and north to Marram Point: gold grass, flat-topped trees
 *   JUNGLE    the Sunstring: tall closed canopy
 *   MANGROVE  jungle's low flat coasts: roots in tidal mud
 *   AUTUMN    the south-west of Westreach
 *   SNOWY     the cold band (landcover.js climateAt), pines under snow
 *   ALPINE    high ground anywhere: thin trees, then rock, then snow
 *
 * The first four are weights in space (biomeAt); they go to the shader as one
 * vertex attribute (aBiome). Mangrove, snowy and alpine follow from those plus
 * height and slope, so the shader and flora.js work them out where they need them.
 *
 * Pure arithmetic: the same in the tile worker, on the main thread and in
 * node. All of it is lazy (the World Map's), never in the first load.
 */
import { vnoise, fbm2, baseCover, climateAt, forestNoise, setCover } from './landcover.js';

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

const oval = (x, z, cx, cz, rx, rz) => Math.hypot((x - cx) / rx, (z - cz) / rz);

/** The wandering border, the same for every biome so two that meet do not leave a gap between them. */
const wander = (x, z) => (fbm2(x / 9000, z / 9000, 21) - 0.5) * 0.46 + (vnoise(x / 2300, z / 2300, 22) - 0.5) * 0.14;

const BW = new Float32Array(4);

/** [desert, savanna, jungle, autumn], each 0..1 and at most 1 together. Everywhere north of z = -6 km: all nothing, cheaply. */
export function biomeAt(x, z, out = BW) {
  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
  if (z < -6000) return out;
  const w = wander(x, z);
  const desert = 1 - smoothstep(0.76, 1.0, oval(x, z, -26000, 75000, 42000, 26000) + w);
  const savanna = (1 - smoothstep(0.78, 1.02, oval(x, z, -14000, 46000, 62000, 42000) + w)) * (1 - desert);
  const jungle = (1 - smoothstep(0.82, 1.04, oval(x, z, 62000, 52000, 52000, 50000) + w)) * (1 - desert - savanna);
  out[0] = desert;
  out[1] = savanna;
  out[2] = jungle;
  out[3] = (1 - smoothstep(0.78, 1.04, oval(x, z, -82000, 12000, 17000, 15000) + w * 1.3)) * (1 - savanna);
  return out;
}

/**
 * Which way along the dunes a point is: its fraction is 0 at a trough, 0.72 at the crest, then the steep lee
 * face. Sines, not noise, because world-terrain.js works out the very same number per pixel and shades the lee
 * faces with it, sharp at any distance whatever the size of the ground's triangles.
 */
export const dunePhase = (x, z) => (x * 0.82 + z * 0.57 + 260 * Math.sin(x / 1700 + 1.3 * Math.sin(z / 2300)) + 180 * Math.sin(z / 1300 + x / 3100)) / 560;
const duneSize = (x, z) => smoothstep(0.2, 0.7, vnoise(x / 1900, z / 1900, 32));

/** terrain.js calmAt, once it has been handed to sculpt (biomeCover wants it and is not given it). */
let calmOf = null;

/** Where the jungle comes down to a low flat shore, mangrove (0..1). `jungle` is biomeAt's. */
export function mangroveAt(x, z, h, slope, jungle) {
  if (jungle <= 0.01 || h > 14) return 0;
  const stretch = smoothstep(0.36, 0.48, fbm2(x / 1500, z / 1500, 23));
  return jungle * stretch * (1 - smoothstep(9.5, 14, h)) * smoothstep(0.13, 0.05, slope);
}

/** Where the trees give out on high ground (0 below it, 1 bare). Colder is lower. */
export function alpineAt(h, cold) {
  const line = 620 - cold * 330;
  return smoothstep(line - 140, line + 240, h);
}

/**
 * landcover.js's cover with the biomes laid over it. That file is in the first
 * load and every byte there counts, so this sits on top of it: it answers for
 * coverAt from the moment the World Map's code is loaded (setCover, below).
 * Writes the weights to out[11..14] when out is long enough.
 */
export function biomeCover(x, z, h, slope, onFlat, out) {
  baseCover(x, z, h, slope, onFlat, out);
  const B = biomeAt(x, z);
  const desert = B[0];
  const savanna = B[1];
  const jungle = B[2];
  out[11] = desert; out[12] = savanna; out[13] = jungle; out[14] = B[3];
  if (onFlat && h > 1) return out;
  const { cold } = climateAt(z);
  // The base ground: above the last thin trees it is bare; mud under the mangroves; the desert is sand to the first rock.
  const mangrove = mangroveAt(x, z, h, slope, jungle);
  // (And the tables in the desert are rock from the first ledge up: taller than any dune, however gentle.)
  const rock = Math.max(out[2], alpineAt(h, cold) * 0.92, desert * smoothstep(56, 74, h) * 0.95);
  const sand = Math.max(out[0] * (1 - mangrove * 0.85), desert * (1 - rock));
  const grass = Math.max(0, 1 - sand - rock);
  const sum = sand + grass + rock || 1;
  out[0] = sand / sum;
  out[1] = grass / sum;
  out[2] = rock / sum;
  let forest = out[4] * (1 - savanna * 0.85) * (1 - desert);
  if (jungle > 0.01) {
    // The jungle closes over nearly everything landcover.js would have left open.
    const land = smoothstep(1.5, 5, h) * (1 - out[0]);
    const closed = smoothstep(0.28, 0.4, forestNoise(x, z)) * (1 - smoothstep(0.55, 0.9, slope)) * land;
    forest += (Math.max(forest, closed) - forest) * jungle;
  }
  if (cold > 0.01) {
    // And the cold band's woods run further over the low ground than the mainland's.
    const pines = smoothstep(0.42, 0.54, forestNoise(x, z)) * (1 - smoothstep(0.55, 0.9, slope)) * smoothstep(1.5, 5, h) * (1 - out[0]) * (1 - alpineAt(h, cold));
    forest += (Math.max(forest, pines) - forest) * cold * 0.8;
  }
  forest *= 1 - mangrove;
  const open = out[4] < 1 ? (1 - forest) / (1 - out[4]) : 1;
  out[3] *= open * (1 - desert) * (1 - savanna * 0.88);
  out[4] = forest;
  out[5] *= open * (1 - desert * 0.8);
  // A desert has no marsh: there this channel tells the shader how much dune stands here, so a runway's calm ground has no lee faces.
  out[6] = desert > 0.5 ? desert * (calmOf ? 1 - calmOf(x, z) : 1) * duneSize(x, z) : Math.max(out[6] * (1 - desert), mangrove);
  return out;
}
setCover(biomeCover);

/* ------------------------------------------------------------------ */
/* The ground itself                                                   */
/* ------------------------------------------------------------------ */

/**
 * The desert's shape: terrain.js heightAt asks this of every point on the map
 * that carries it (MAP._sculpt, only the World Map). The Sands are flat cays
 * five metres high, so nothing would read as a dune. Added here, never where
 * the ground has to stay calm (calmAt: fields, lanes, towns, roads).
 *
 *   DUNES    long ridges across the wind, a gentle back and a steep lee face,
 *            their height changing along the crest, up to 38 m;
 *   MESAS    in the badlands, tables of red rock 80-120 m high in steps, with
 *            canyons winding through them down to the desert floor.
 */
export function sculpt(h, x, z, calmAt) {
  calmOf = calmAt;
  if (z < 46000 || h < 3.5) return h;
  const desert = 1 - smoothstep(0.76, 1.0, oval(x, z, -26000, 75000, 42000, 26000) + wander(x, z));
  if (desert <= 0.01) return h;
  const calm = calmAt(x, z);
  if (calm >= 1) return h;
  const k = desert * (1 - calm) * smoothstep(4.5, 8.5, h);
  if (k <= 0) return h;
  const a = dunePhase(x, z);
  const ph = a - Math.floor(a);
  const crest = ph < 0.72 ? ph / 0.72 : (1 - ph) / 0.28;
  const along = vnoise((z * 0.82 - x * 0.57) / 420, (x * 0.82 + z * 0.57) / 900, 33);
  const dune = 38 * duneSize(x, z) * crest * crest * (3 - 2 * crest) * (0.5 + 0.5 * along);
  let table = 0;
  const bad = 1 - smoothstep(0.7, 1.0, oval(x, z, -46000, 80000, 22000, 13000));
  if (bad > 0) {
    const plateau = smoothstep(0.545, 0.57, fbm2(x / 3100, z / 3100, 34)) * bad;
    if (plateau > 0) {
      const slot = 1 - smoothstep(0.015, 0.055, Math.abs(fbm2(x / 2100 + 5, z / 2100, 36) - 0.5));
      const m = plateau * (1 - slot) * (80 + 42 * vnoise(x / 1700, z / 1700, 37));
      const t = m / 16;
      const f = t - Math.floor(t);
      table = (Math.floor(t) + smoothstep(0.7, 1, f)) * 16;
    }
  }
  return h + k * Math.max(dune, table);
}


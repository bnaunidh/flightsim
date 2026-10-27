/**
 * World Map — Preview: what covers the ground.
 *
 * Owner, Oct 26, on the islands: "maps sad as hell" — a flat uniform green
 * carpet, sparse single trees, empty. Real land is a patchwork: forests on
 * the hills and in the valleys, farmland in fields with hedges between them
 * on the flat low ground, heath and scrub on the uplands, rock and snow
 * higher still, marsh where the land is flat and wet by the sea, beaches
 * that are wide in one bay and a strip of shingle in the next. This decides
 * which, everywhere, from the ground itself (height, slope, how far north or
 * south) and slow noise — the same answer in the tile worker, on the main
 * thread and in node, because it is pure arithmetic on the position.
 *
 * Who reads it:
 *   - worldmap/tiles.js writes each vertex's cover into the tile (aBlend:
 *     sand / grass / rock as before, but with beaches of varying width;
 *     aCover: farmland / forest / scrub / wetland), and the World Map's own
 *     terrain material (worldmap/world-terrain.js) paints them: crop fields
 *     with hedgerows, dark forest floor, olive heath, marsh, snow in the
 *     north;
 *   - worldmap/flora.js plants its trees by the forest weight, so a forest
 *     you see from 10,000 ft has trees in it when you get down to it.
 *
 * CLIMATE by latitude, like the real world: the Northern Skerries and the
 * Far Outposts (z < -100 km) are cold, the Sunstring and the Southern Sands
 * (z > +50 km) tropical, the mainland and the Sound between.
 *
 * Nothing here moves the ground: a field, a town and a road are flats
 * (onFlat), and get no cover at all — mown grass, as before.
 */

/* ------------------------------------------------------------------ */
/* Noise                                                               */
/* ------------------------------------------------------------------ */

function hash2(ix, iz, seed) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise, 0..1. */
export function vnoise(x, z, seed = 0) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  let fx = x - ix;
  let fz = z - iz;
  fx = fx * fx * (3 - 2 * fx);
  fz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** Two octaves of it. */
export function fbm2(x, z, seed = 0) {
  return vnoise(x, z, seed) * 0.66 + vnoise(x * 2.03 + 17.1, z * 2.03 - 9.4, seed + 1) * 0.34;
}

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/* ------------------------------------------------------------------ */
/* Climate                                                             */
/* ------------------------------------------------------------------ */

/** How cold (0..1) and how tropical (0..1) the world is at this z (north is -z). */
export function climateAt(z) {
  return {
    cold: smoothstep(-92000, -112000, z),
    tropical: smoothstep(45000, 62000, z),
  };
}

/* ------------------------------------------------------------------ */
/* Cover                                                               */
/* ------------------------------------------------------------------ */

/** The slow noise the forests follow (0..1); a point under 0.3 can never be forest. */
export function forestNoise(x, z) {
  return fbm2(x / 2900, z / 2900, 3) * 0.75 + vnoise(x / 650, z / 650, 4) * 0.25;
}

/**
 * The cover at a point, into `out` (length 8):
 *   [0] sand  [1] grass  [2] rock     the base ground (sum 1)
 *   [3] farm  [4] forest [5] scrub [6] wet   what is on it (each 0..1)
 *   [7] urban  a town's streets and roofs (coverFor sets it, on a town's ground)
 * `h` metres above the sea, `slope` rise over run, `onFlat` made ground.
 */
export function coverAt(x, z, h, slope, onFlat, out) {
  const { cold, tropical } = climateAt(z);
  if (onFlat && h > 1) {
    // Made ground is mown grass — burnt dry in the tropics, tundra-brown in the north.
    out[0] = 0; out[1] = 1; out[2] = 0;
    out[3] = 0; out[4] = 0; out[5] = 0.3 * tropical + 0.35 * cold; out[6] = 0; out[7] = 0;
    return out;
  }
  // Beaches: a band whose top runs from 2.5 m (shingle under a bluff) to
  // 13 m (a wide bay of dunes), wider in the tropics, narrower in the north.
  const bn = fbm2(x / 1700, z / 1700, 11);
  const beachTop = 2.5 + 10.5 * smoothstep(0.32, 0.78, bn) * (1 + tropical * 0.4) * (1 - cold * 0.6);
  let sand = 1 - smoothstep(Math.min(1.5, beachTop - 1), beachTop, h);
  let rock = Math.min(1, Math.max(0, smoothstep(0.3, 0.95, slope) * 0.9 + smoothstep(150 - cold * 60, 320 - cold * 120, h) * 0.5));
  // Cold coasts are rock and shingle more than sand.
  rock = Math.max(rock, sand * cold * 0.55 * smoothstep(0.45, 0.6, vnoise(x / 400, z / 400, 5)));
  sand *= 1 - cold * 0.45;
  let grass = Math.max(0, 1 - sand - rock);
  const sum = sand + grass + rock || 1;
  out[0] = sand / sum;
  out[1] = grass / sum;
  out[2] = rock / sum;

  const land = smoothstep(1.5, 5, h) * (1 - out[0]);
  // Forest: big slow patches, more on the hills, thinning to a tree line.
  const treeLine = 820 - cold * 480;
  const fN = forestNoise(x, z);
  const hillBias = 0.14 * smoothstep(25, 180, h) - 0.06 * cold + tropical * 0.05;
  let forest = smoothstep(0.5, 0.6, fN + hillBias) * (1 - smoothstep(treeLine - 200, treeLine, h)) * (1 - smoothstep(0.55, 0.9, slope));
  forest *= land * (1 - 0.45 * smoothstep(0.42, 0.55, fbm2(x / 5200, z / 5200, 9)));
  // Marsh and mangrove: flat, low and close to the sea.
  const wN = fbm2(x / 1300, z / 1300, 7);
  let wet = (1 - smoothstep(9, 16, h)) * smoothstep(0.06, 0.025, slope) * smoothstep(0.52, 0.62, wN) * smoothstep(1.5, 3, h) * (1 - cold * 0.5);
  wet *= 1 - forest * 0.7;
  // Farmland: flat, low, not forest, not marsh; big farming districts with
  // gaps between them; little of it in the cold north.
  const aN = fbm2(x / 5200, z / 5200, 9);
  let farm = smoothstep(0.36, 0.46, aN) * smoothstep(0.13, 0.06, slope) * smoothstep(4, 9, h) * (1 - smoothstep(230, 360, h));
  farm *= (1 - forest) * (1 - wet) * (1 - cold * 0.75) * land;
  // Heath and scrub: the uplands, the cold and the dry, where nothing else is.
  let scrub = Math.max(smoothstep(90, 260, h), cold * 0.8, tropical * 0.35 * smoothstep(0.55, 0.7, vnoise(x / 900, z / 900, 13)));
  scrub *= (1 - forest) * (1 - farm) * (1 - wet) * (1 - out[2] * 0.6) * land;
  out[3] = farm;
  out[4] = forest;
  out[5] = scrub;
  out[6] = wet;
  out[7] = 0;
  return out;
}

/**
 * The cover function tiles.js wants for a terrain module `T`: null on any
 * map that has not asked for it (every regular map), so they are untouched.
 */
export function coverFor(T) {
  if (!T || !T.MAP || !T.MAP.landcover) return null;
  const out = new Float32Array(8);
  return (x, z, h, slope) => {
    const f = T.flatAt ? T.flatAt(x, z) : null;
    // A town's level ground is not mown from edge to edge: gardens and greens in the middle, the
    // country's own cover fading back in towards the edge, so no square of lawn shows from the air.
    if (f && f.kind === 'town') {
      coverAt(x, z, h, slope, false, out);
      const hx = (f.x1 - f.x0) / 2;
      const hz = (f.z1 - f.z0) / 2;
      const d = Math.hypot((x - (f.x0 + hx)) / hx, (z - (f.z0 + hz)) / hz);
      const core = 1 - smoothstep(0.35, 1.05, d);
      out[3] *= 1 - core;
      out[4] *= (1 - core) * (1 - core);
      out[5] *= 1 - core * 0.7;
      out[6] *= 1 - core;
      // The town itself, out past its houses: streets, roofs and gardens on the ground (worldmap/world-terrain.js).
      out[7] = 1 - smoothstep(0.55, 1.0, d + (vnoise(x / 160, z / 160, 21) - 0.5) * 0.25);
      return out;
    }
    return coverAt(x, z, h, slope, !!(f && T.flatSurfaceAt(x, z)), out);
  };
}

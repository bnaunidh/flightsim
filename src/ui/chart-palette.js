/**
 * The minimap's land colours, from the same palette the terrain is painted
 * with (maps.js `palette`, read by terrain.js's ground shader).
 *
 * Owner (Oct 25): "on Nunatak Reach the minimap paints the land GREEN". The
 * chart tinted its grass by `palette.grass` and stopped there, but on a snow
 * map the green is never seen: the terrain shader's snow term (`palette.snow`,
 * a height band) covers everything above the line, and steep faces keep their
 * rock. This does the same three things the shader does, per chart pixel:
 *
 *   sand -> grass with height, rock on the high ground   (as before)
 *   rock on the steep faces                                (crags read grey)
 *   snow over the lot inside `palette.snow`, kept off the cliffs, shaded
 *   blue-grey rather than brown on the slopes facing away from the light
 *
 * and frozen water (a map's `flats` with `surface: 'ice'`) is pale ice.
 *
 * Pure: no DOM, no three.js, so tests/features/airport-look.mjs can ask it
 * what colour a map's land is and compare that with the palette.
 */

/** The terrain shader's snow colour (terrain.js: vec3(0.93, 0.95, 0.99)), in bytes. */
export const SNOW_RGB = Object.freeze([237, 242, 252]);
/** Pale sea ice / a frozen lake. */
export const ICE_RGB = Object.freeze([206, 224, 236]);

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}

function tint(r, g, b, mul) {
  return [Math.min(255, r * (mul ? mul[0] : 1)), Math.min(255, g * (mul ? mul[1] : 1)), Math.min(255, b * (mul ? mul[2] : 1))];
}

/**
 * The chart's colour set for a palette, worked out once.
 *   { SAND, GRASS, ROCK, LAND, snow: [lo, hi] | null }
 */
export function chartColours(pal) {
  const p = pal || {};
  return {
    SAND: tint(176, 158, 118, p.sand),
    GRASS: tint(74, 104, 62, p.grass),
    ROCK: tint(124, 116, 104, p.rock),
    // The boat chart's land: one flat buff (a snow map's is snow).
    LAND: p.snow ? SNOW_RGB.slice() : tint(198, 184, 152, p.sand),
    snow: Array.isArray(p.snow) && p.snow.length === 2 ? [p.snow[0], p.snow[1]] : null,
  };
}

/**
 * The frozen water on a map: its ice flats, as cheap shapes to test a point
 * against. A lake is the ellipse in its rectangle (terrain.js: "only the disc
 * is ice"); a strip is its rectangle.
 */
export function iceShapes(flats) {
  const out = [];
  for (const f of flats || []) {
    if (!f || f.surface !== 'ice') continue;
    out.push({ lake: f.kind === 'lake', x0: f.x0, x1: f.x1, z0: f.z0, z1: f.z1, cx: (f.x0 + f.x1) / 2, cz: (f.z0 + f.z1) / 2, rx: (f.x1 - f.x0) / 2, rz: (f.z1 - f.z0) / 2 });
  }
  return out;
}

export function onIce(ice, x, z) {
  for (let i = 0; i < ice.length; i++) {
    const s = ice[i];
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
    if (!s.lake) return true;
    const u = (x - s.cx) / s.rx;
    const v = (z - s.cz) / s.rz;
    if (u * u + v * v <= 1) return true;
  }
  return false;
}

/**
 * One pixel of land.
 *
 * @param {number} h      ground height, m (> 0)
 * @param {number} slope  rise per metre to the north-west neighbours, signed:
 *                        positive faces the light. (dWest + dNorth) / step.
 * @param {object} C      chartColours(palette)
 * @param {number[]} out  [r, g, b], written and returned
 * @param {number} noise  0..1, a little per-pixel raggedness for the snow line
 */
export function landColour(h, slope, C, out = [0, 0, 0], noise = 0.5) {
  const beach = clamp01(h / 14);
  const high = clamp01((h - 130) / 420);
  let r = C.SAND[0] + (C.GRASS[0] - C.SAND[0]) * beach;
  let g = C.SAND[1] + (C.GRASS[1] - C.SAND[1]) * beach;
  let b = C.SAND[2] + (C.GRASS[2] - C.SAND[2]) * beach;
  // Crags: rock wherever it is steep, as well as wherever it is high.
  const steep = Math.abs(slope);
  const rocky = Math.max(high, smoothstep(0.55, 1.3, steep) * clamp01(h / 20));
  r += (C.ROCK[0] - r) * rocky;
  g += (C.ROCK[1] - g) * rocky;
  b += (C.ROCK[2] - b) * rocky;
  // Hillshade, lit from the north-west (the old chart's +-42%).
  const shade = 1 + Math.max(-0.42, Math.min(0.42, slope * 2));
  r *= shade;
  g *= shade;
  b *= shade;
  if (C.snow) {
    // The shader's own term: a height band, ragged by noise, kept off cliffs.
    let s = smoothstep(C.snow[0], C.snow[1], h + (noise - 0.5) * 90);
    s *= 1 - smoothstep(0.9, 1.8, steep) * 0.7;
    if (s > 0) {
      // Snow in shadow goes blue-grey, not brown: the shade moves the red and
      // green more than the blue, and never takes it below a pale slate.
      const k = 1 + Math.max(-0.3, Math.min(0.14, slope * 1.4));
      const sr = SNOW_RGB[0] * k;
      const sg = SNOW_RGB[1] * (0.03 + k * 0.97);
      const sb = SNOW_RGB[2] * Math.min(1, 0.12 + k * 0.88);
      r += (sr - r) * s;
      g += (sg - g) * s;
      b += (sb - b) * s;
    }
  }
  out[0] = r;
  out[1] = g;
  out[2] = b;
  return out;
}

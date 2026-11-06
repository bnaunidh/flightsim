/**
 * What the water looks like from inside it, as plain numbers: pure, so
 * tests/features/water-crash.mjs can hold it.
 *
 * Near the surface on a clear day it is a bright blue-green; it loses the
 * red first, then the green, and goes to a dark blue as you go down. At
 * night it is the same water by moonlight: dark, but you can still tell the
 * wreck from the water. `day` is weather.timeInfo.daylight, 0 night .. 1 noon,
 * `depth` metres under the surface.
 */

const lerp = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** Linear RGB. */
export const WATER = Object.freeze({
  top: [0.035, 0.2, 0.25],
  mid: [0.01, 0.095, 0.15],
  deep: [0.003, 0.026, 0.065],
  moon: [0.012, 0.03, 0.055],
});

/** Fog: how thick the water is. Clear enough to see the bottom from the top of most of these seas. */
export const CLARITY = Object.freeze({ density: 0.02, lowDensity: 0.024, deepen: 0.00012 });

/** What the depth leaves of the light, 0..1. */
export function lightAt(depth) {
  return Math.exp(-Math.max(0, depth) / 42);
}

/** How much the night leaves of it. Never nothing: the moon is up and a wreck should still read. */
export function dayLight(day) {
  const d = Math.max(0, Math.min(1, day));
  return 0.1 + 0.9 * Math.pow(d, 0.7);
}

/**
 * { fog, top, deep, sun, ambient, density, shafts, caustics }. fog/top/deep
 * are colours; sun and ambient scale the scene's lights; `shafts` and
 * `caustics` are how strong the sun's patterns are.
 */
export function waterLook(depth, day = 1, low = false) {
  const d = Math.max(0, depth);
  const k = 1 - lightAt(d);
  const dl = dayLight(day);
  const base = d < 22 ? mix3(WATER.top, WATER.mid, d / 22) : mix3(WATER.mid, WATER.deep, Math.min(1, (d - 22) / 46));
  const fog = mix3(WATER.moon, base, Math.pow(dl, 1.2));
  const up = mix3(fog, mix3(WATER.moon, WATER.top, dl), 0.65);
  const down = mix3(fog, WATER.deep, 0.75 + 0.2 * k);
  const sunny = Math.max(0, Math.min(1, (day - 0.15) / 0.5));
  return {
    fog,
    top: up,
    deep: mix3(down, [down[0] * 0.5, down[1] * 0.5, down[2] * 0.5], k),
    sun: (0.65 * lightAt(d) + 0.04) * dl,
    ambient: (0.5 + 0.5 * lightAt(d * 0.6)) * dl,
    density: (low ? CLARITY.lowDensity : CLARITY.density) + d * CLARITY.deepen,
    shafts: sunny * lightAt(d * 1.2),
    caustics: sunny * lightAt(d * 0.8),
  };
}

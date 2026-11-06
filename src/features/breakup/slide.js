/**
 * WHAT A WRECK SLIDES ON (the owner, 2026-11-05: "with a sliding momentumu
 * should slide"). The speed of the crash carries into a slide, and how far it
 * goes depends on what it is sliding on. Pure: no scene, no page, so
 * tests/features/water-crash.mjs reads every number here.
 *
 *   mu       Coulomb friction, the part of the stopping that does not care
 *            how fast it is going
 *   plough   how fast the surface takes speed off it by digging in, 1/s: a
 *            wreck ploughing a trench through sand loses a share of its speed
 *            every second, a wreck on ice loses none of it that way
 *   sparks   metal on something hard: sparks instead of a dust cloud
 *   dust     what flies up [r, g, b], and dustSize how big a cloud of it
 *   scar     the mark it leaves [r, g, b], how dark (alpha) and how wide a
 *            share of the airframe's width
 *
 * Friction is what the rigid body uses (src/game/breakup-body.js stepGround),
 * so what the numbers mean is what stopDistance() says, give or take the
 * bounces. stopDistance() is also what the tests hold the body to.
 */

const G = 9.81;

export const SLIDE = Object.freeze({
  concrete: { mu: 0.42, plough: 0.02, sparks: 1, dust: [0.45, 0.44, 0.42], dustSize: 0.7, scar: [0.46, 0.45, 0.43], alpha: 0.6, width: 0.5 },
  deck: { mu: 0.4, plough: 0.02, sparks: 1, dust: [0.4, 0.4, 0.42], dustSize: 0.5, scar: [0.4, 0.4, 0.42], alpha: 0.58, width: 0.5 },
  grass: { mu: 0.62, plough: 0.09, sparks: 0, dust: [0.34, 0.3, 0.2], dustSize: 1, scar: [0.25, 0.19, 0.11], alpha: 0.62, width: 0.62 },
  dirt: { mu: 0.68, plough: 0.12, sparks: 0, dust: [0.52, 0.41, 0.28], dustSize: 1.5, scar: [0.3, 0.21, 0.13], alpha: 0.66, width: 0.7 },
  sand: { mu: 0.78, plough: 0.3, sparks: 0, dust: [0.8, 0.71, 0.53], dustSize: 1.7, scar: [0.52, 0.44, 0.3], alpha: 0.72, width: 1 },
  snow: { mu: 0.24, plough: 0.2, sparks: 0, dust: [0.94, 0.96, 1], dustSize: 2, scar: [0.68, 0.74, 0.84], alpha: 0.78, width: 1 },
  ice: { mu: 0.07, plough: 0.02, sparks: 0.25, dust: [0.86, 0.92, 0.98], dustSize: 0.7, scar: [0.95, 0.97, 1], alpha: 0.55, width: 0.45 },
  water: { mu: 0.5, plough: 0.9, sparks: 0, dust: [0.92, 0.96, 0.98], dustSize: 1, scar: null, alpha: 0, width: 0 },
});

/** Where the map's shaders stop drawing sand and start drawing grass (terrain.js: sand = 1 - smoothstep(2, 30, h)). */
const SAND_TOP = 13;

/**
 * What is under a point. `P` holds the probes, so this stays pure:
 *   { deck(x, z), paved(x, z), ice(x, z), made(x, z), h(x, z), snowLine, snowCover, rocky(x, z) }
 * made is a map's own surface for a flat ('tarmac', 'gravel', 'grass', 'ice'),
 * snowLine the height the map's snow starts at, snowCover 0..1 of lying snow.
 */
export function slideKind(x, z, P) {
  if (P.deck && P.deck(x, z)) return 'deck';
  if (P.ice && P.ice(x, z)) return 'ice';
  const made = P.made ? P.made(x, z) : null;
  if (P.paved && P.paved(x, z)) {
    if (P.snowCover > 0.5) return 'snow';
    return 'concrete';
  }
  if (made === 'gravel') return 'dirt';
  const h = P.h(x, z);
  if (h < 0) return 'water';
  if (P.snowCover > 0.5 && h > 0.5) return 'snow';
  if (Number.isFinite(P.snowLine) && h > P.snowLine) return 'snow';
  if (made === 'grass') return 'grass';
  if (h < SAND_TOP) return 'sand';
  if (P.rocky && P.rocky(x, z)) return 'dirt';
  return 'grass';
}

/** How the speed runs down on this surface, m/s²: Coulomb plus plough. */
export function slideDecel(speed, kind) {
  const s = SLIDE[kind] || SLIDE.grass;
  return s.mu * G + s.plough * speed;
}

/** How far a wreck slides from `speed` on this surface, metres (the sum the body does, on flat ground). */
export function stopDistance(speed, kind) {
  let v = Math.max(0, speed);
  let d = 0;
  const h = 1 / 90;
  for (let i = 0; i < 90 * 120 && v > 0.05; i++) {
    d += v * h;
    v -= slideDecel(v, kind) * h;
  }
  return d;
}

/** How long that takes, seconds. */
export function stopTime(speed, kind) {
  let v = Math.max(0, speed);
  let t = 0;
  const h = 1 / 90;
  while (v > 0.05 && t < 120) {
    t += h;
    v -= slideDecel(v, kind) * h;
  }
  return t;
}

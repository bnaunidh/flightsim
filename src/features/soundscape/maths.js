/**
 * The numbers behind the soundscape (./layers.js), pure so the node test can
 * hold each one to its physics without a sound card: which way the engine is
 * facing you, the ground's echo, how often a raindrop hits, a spool's lag.
 */

/** Speed of sound, m/s. */
export const C = 343;

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Where the listener is round the engine: the cosine between the aeroplane's
 * nose and the line out to the ear. 1 dead ahead, 0 abeam, -1 dead astern.
 */
export function aspectCos(fx, fy, fz, dx, dy, dz) {
  const a = Math.hypot(fx, fy, fz) * Math.hypot(dx, dy, dz);
  return a > 1e-6 ? clamp((fx * dx + fy * dy + fz * dz) / a, -1, 1) : 0;
}

/**
 * How each part of an engine carries to a listener at `cos` (aspectCos).
 *   front  a fan's whine leaves by the intake: loudest ahead
 *   rear   the jet's roar is the exhaust mixing with the air: loudest behind
 *   disc   a propeller's noise is loudest in the plane of the blades: abeam
 * All 1 when `near` (the cockpit, the chase view): the camera is on the
 * aeroplane, and only the cockpit's own muffling applies.
 */
export function aspectGains(cos, near) {
  if (near) return { front: 1, rear: 1, disc: 1 };
  const ahead = (1 + cos) / 2;
  const behind = (1 - cos) / 2;
  return {
    // Each 1 abeam, so walking round an aeroplane moves the sound about without making it louder overall.
    front: +((0.45 + 0.85 * ahead ** 1.5) / 0.7505).toFixed(4),
    rear: +((0.5 + 0.9 * behind ** 1.2) / 0.8918).toFixed(4),
    disc: +((0.6 + 0.65 * (1 - cos * cos)) / 1.25).toFixed(4),
  };
}

/** How much of the sound a surface throws back (an echo off it, 0 to 1). */
export const REFLECT = { paved: 0.7, grass: 0.42, water: 0.85, snow: 0.25 };

/**
 * The ground's echo: the sound off the ground arrives a little after the
 * sound straight from the aeroplane, and the two comb each other. As a
 * low aeroplane goes by, that delay sweeps and the comb with it: the
 * "phasing" whoosh of every fly-by heard from the ground.
 *   r   horizontal distance, metres;  ha, hc  heights above the ground of
 *   the aeroplane and the ear. Returns the delay (s) and the echo's level.
 * A long echo (the ear high above the ground) is no comb but a faint repeat,
 * and is faded out.
 */
export function groundEcho(r, ha, hc, surface = 'grass') {
  const a = Math.max(0, ha);
  const c = Math.max(0.5, hc);
  const direct = Math.hypot(r, a - c);
  const bounce = Math.hypot(r, a + c);
  const delay = (bounce - direct) / C;
  let gain = (REFLECT[surface] != null ? REFLECT[surface] : REFLECT.grass) * (direct / Math.max(1e-6, bounce));
  if (delay > 0.03) gain *= clamp(1 - (delay - 0.03) / 0.04, 0, 1);
  return { delay: +delay.toFixed(6), gain: +gain.toFixed(4) };
}

/**
 * How much of the engine goes to the reverb: none from the cockpit, a touch
 * close by outside (the ground and the buildings answer), more far off where
 * the reflected sound is a bigger share; less with the ear high in open sky.
 */
export function reverbSend(dist, inside, earAgl = 2, near = 60) {
  if (inside) return 0;
  const far = clamp((dist - near) / 700, 0, 1);
  const open = 1 - 0.75 * clamp(earAgl / 500, 0, 1);
  return +((0.06 + 0.5 * far) * open).toFixed(4);
}

/**
 * Raindrops and hailstones are clicks: white noise through a shaper that
 * passes only its top 1% (CLICK_T). Turning the noise up by `k` lets more of
 * it past the threshold, so the rate of clicks per second is
 *   rate = sampleRate * (1 - T / k)
 * and this is the `k` for a wanted rate. Exact for uniform white noise.
 */
export const CLICK_T = 0.99;
export function clickGain(rate, sampleRate = 44100) {
  const p = clamp(rate / sampleRate, 0, 0.2);
  return p <= 0 ? 0 : CLICK_T / (1 - p);
}

/** Drops a second on the airframe: more of them when it is wetter and faster (it flies into them). */
export function rainRate(rain, ias, inside) {
  if (!(rain > 0.002)) return 0;
  const fly = 1 + clamp(ias / 60, 0, 1.5);
  return Math.round(rain * (inside ? 200 : 140) * fly);
}

/**
 * Hail: only out of a thunderstorm's core, and it comes in shafts, so most of
 * a storm has none. `shaft` is 0..1 (a slow wander), `inCloud` the immersion.
 * Never on snow maps (precip 'snow': the storm falls quietly there).
 */
export function hailLevel(cond, shaft, inCloud = 0, snow = false) {
  if (snow || !cond) return 0;
  const core = clamp((cond.storm || 0) * Math.max(cond.cb || 0, 0.5) * (cond.rain || 0), 0, 1);
  if (core < 0.3) return 0;
  const open = clamp((shaft - 0.62) / 0.25, 0, 1);
  return +(core * clamp(open + inCloud * 0.6, 0, 1)).toFixed(4);
}

/**
 * The extra weight of a touchdown: the struts' thump (by the sink rate the
 * game's impact already measures) and the scrub of tyres spinning up from
 * standstill (by how fast the ground is going by).
 */
export function touchdownExtra(impact, groundSpeed, heavy = 0) {
  const i = clamp(impact, 0, 1);
  return {
    thump: +((0.08 + 0.92 * i ** 1.2) * (0.6 + 0.4 * heavy)).toFixed(4),
    scrub: +(clamp(groundSpeed / 65, 0, 1) * (0.35 + 0.65 * i)).toFixed(4),
  };
}

/** One spool step: towards `target` at `up` or `down` per second (first-order lag). */
export function spool(cur, target, up, down, dt) {
  return cur + (target - cur) * Math.min(1, dt * (target > cur ? up : down));
}

/**
 * The town's traffic as one bed of sound: each moving car within range adds
 * by its speed and falls off with distance. Parked ones are silent.
 */
export function carBed(cars, x, z, range = 160) {
  let w = 0;
  let near = Infinity;
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    if (!c || c.parked || c.hidden || !(c.speed > 0.5)) continue;
    const d = Math.hypot(c.px - x, c.pz - z);
    if (d > range) continue;
    w += clamp(c.speed / 14, 0, 2) / (1 + (d / 22) ** 2);
    if (d < near) near = d;
  }
  return { weight: +w.toFixed(4), near };
}

/** The nearest `max` other aircraft within `range` metres of the ear, closest first. */
export function nearestBodies(list, x, y, z, max = 2, range = 1800) {
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const b = list[i];
    if (!b || b.gone || !b.pos) continue;
    const d = Math.hypot(b.pos.x - x, b.pos.y - y, b.pos.z - z);
    if (d > range) continue;
    out.push({ b, d });
  }
  out.sort((p, q) => p.d - q.d);
  return out.slice(0, max);
}

/** What another aircraft sounds like, from its body (features/sky.js): a helicopter, a jet or a propeller. */
export function bodyVoice(b, family) {
  if (b && b.rotor) return 'rotor';
  if (family) return family === 'piston' || family === 'turboprop' ? 'prop' : family === 'rotor' ? 'rotor' : 'jet';
  return b && b.radius > 14 ? 'jet' : 'prop';
}

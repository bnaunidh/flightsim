/**
 * Afterburners (reheat) and the sound barrier, for the fast jets.
 *
 * The owner, 2026-10-25: "ultra fast planes aren't fast". Measured with the
 * flight model as it was (level, full throttle, 300 s, scratchpad
 * topspeed.mjs): the F-22 topped out at 321 kt at 2,500 m and 212 kt at
 * 11,000 m, Concorde at 276 and 206, the Hornet 316 and 258, Air Massimo 480
 * and 272. Only the B-1B, which already had a jet's thrust law
 * (./extra/lancer.js), got past Mach 1.
 *
 * The reason is the one thrust law every engine shares (physics.js): full
 * thrust times the density ratio times a propeller's efficiency, which falls
 * with forward speed to 0.12 by 176 m/s (340 kt). Right for a propeller, and
 * it is what holds the airliners and the dry jets to their cruise; but it
 * left a fighter with an eighth of its thrust at the speed it is built to
 * fly, and the higher it climbed the slower it went, which is the opposite of
 * a jet. The v70.1 thin air above the service ceiling (ceilingFactor) was
 * never the cause: every type here is far below 1.05 x its ceiling.
 *
 * WHAT CHANGES, and only for the types in PROFILES below:
 *
 *   the burners  the throttle's last 15% (from BURNER_FROM) lights them, as
 *                the B-1B's do. Their thrust follows a jet's law: falling
 *                with height only as the 0.75 power of the density, and
 *                RISING with Mach number as the intake rams air in,
 *                1 + ram x M^2. Below the burner detent nothing changes, so
 *                the approach, the carrier, the hover and every cruise the
 *                autopilot flies are exactly as they were.
 *   the barrier  a transonic drag rise from just under the drag-divergence
 *                Mach number `mdd` to its `wave` peak just past Mach 1,
 *                easing to two thirds of it by 1.2; and the inlets' limit:
 *                past `choke` the drag climbs steeply, so each type's top
 *                speed up high is its published one, not "as fast as the
 *                maths allows".
 *   the q-limit  the engine control trims the burners back as the indicated
 *                airspeed passes 95% of the red line (SPEC.vne), fully back
 *                by 99%, as real engine controls schedule thrust at high
 *                dynamic pressure. Full throttle, level, never takes an
 *                aeroplane through its red line, and so never breaks it up
 *                (physics.js: 1.35 x vne): low down a fighter goes as fast
 *                as its airframe allows, and only up high, in thin air, does
 *                it go supersonic — which is how real ones fly.
 *
 * Every number is per type, and `target` is what tests/features/top-speed.mjs
 * holds each to: level at `alt` metres, flat out, it must reach 90% or more
 * of Mach `mach`. The rams were bisected against the real flight model
 * (scratchpad fit-reheat.mjs) to reach the target with a little in hand; the
 * inlet limit then holds it there.
 *
 * Pure: no DOM, no THREE. physics.js asks reheatScale() and waveDrag() once a
 * step, for the type being flown, and nothing else.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (t) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};

/** Throttle (spooled) at which the burners begin to light; full at 1. */
export const BURNER_FROM = 0.85;
/** The burners' thrust falls as this power of the density ratio. */
export const LAPSE = 0.75;
/** The q-limit: burners trimmed from this share of vne (indicated)... */
export const Q_FROM = 0.92;
/** ...to nothing by this one. */
export const Q_TO = 0.97;

/**
 * Per type. `mach` at `alt` (m): the published top speed, flown level at a
 * height where the red line (indicated) allows it. `ram`: the burners' Mach
 * gain, 1.6 x the least that reaches the target from 300 kt (bisected
 * against the flight model, scratchpad fit-reheat), so it gets there in one
 * to two minutes rather than creeping up on it for five. `mdd`, `wave`: the
 * transonic drag rise. `choke`: the inlets' wall, 2% over the target, which
 * is what then holds the top speed at the target (measured: 1-3% over).
 */
export const PROFILES = Object.freeze({
  // The racer: "the fastest thing in the game, and not by a little".
  massimo: Object.freeze({ mach: 2.5, alt: 13000, ram: 0.75, mdd: 0.93, wave: 0.008, choke: 2.55 }),
  // F-22: Mach 2.25 published; at 15 km (49,000 ft), where its red line allows it.
  f22: Object.freeze({ mach: 2.2, alt: 15000, ram: 0.7, mdd: 0.9, wave: 0.022, choke: 2.24 }),
  // The Vanguard (a Mirage 2000-class delta): Mach 2.0 at 13 km.
  vanguard: Object.freeze({ mach: 2.0, alt: 13000, ram: 0.68, mdd: 0.9, wave: 0.022, choke: 2.04 }),
  // F/A-18: Mach 1.8.
  fa18: Object.freeze({ mach: 1.8, alt: 13000, ram: 0.65, mdd: 0.88, wave: 0.024, choke: 1.84 }),
  // F-35B: Mach 1.6.
  f35b: Object.freeze({ mach: 1.6, alt: 12000, ram: 0.58, mdd: 0.88, wave: 0.026, choke: 1.63 }),
  // Concorde: Mach 2.04 cruise at 50,000-60,000 ft; 2.0 at 17 km (55,800 ft). Four
  // Olympus engines that give more as they go faster: the biggest ram here.
  concorde: Object.freeze({ mach: 2.0, alt: 17000, ram: 3.6, mdd: 0.95, wave: 0.012, choke: 2.04 }),
});

/**
 * T-Pose Harrison flies on Massimo's numbers and must be exactly 1 km/h
 * faster at the top (extra/tpose.js). Flat out at 2,500 m both are held by
 * the q-limit rather than by their drag alone, and his 0.19% less drag then
 * comes to 1.11 km/h (measured over 900 s); his limiter sits this much lower
 * on the red line to make it 1.00 (bisected; tests/features/fighters.mjs
 * measures the 1 km/h, +/- 0.25).
 */
export const HARRISON_Q = -0.000075;
const HARRISON = Object.freeze({ ...PROFILES.massimo, qShift: HARRISON_Q });

/** The profile for a type id, or null (every type without burners: nothing changes). */
export function reheatFor(id) {
  if (id === 'tpose') return HARRISON;
  return PROFILES[id] || null;
}

/** The speed of sound, m/s, at `alt` metres (the standard atmosphere, as extra/lancer.js). */
export function speedOfSound(alt) {
  const h = Math.max(0, alt || 0);
  const T = h < 11000 ? 288.15 - 0.0065 * h : 216.65;
  return Math.sqrt(1.4 * 287.053 * T);
}

export function machOf(tas, alt) {
  return (tas || 0) / speedOfSound(alt);
}

/** How lit the burners are, 0..1, from the spooled engine (rpm) and the indicated speed against vne. */
export function burnerShare(rpm, iasRatio = 0, P = null) {
  const thr = clamp(((rpm || 0) - 0.18) / 0.82, 0, 1);
  const ab = clamp((thr - BURNER_FROM) / (1 - BURNER_FROM), 0, 1);
  if (!(ab > 0)) return 0;
  const q = (P && P.qShift) || 0;
  return ab * (1 - smooth((iasRatio - Q_FROM - q) / (Q_TO - Q_FROM)));
}

/**
 * The multiple of the shared law's propeller efficiency the engine gives:
 * `propEff` with the burners out, the jet's law with them lit, blended.
 * `sigma` is the plain density ratio (no ceiling fade: physics.js applies
 * that to the density it multiplies by).
 */
export function reheatEff(P, { ab, M, sigma, propEff }) {
  if (!P || !(ab > 0)) return propEff;
  const s = clamp(sigma, 0.02, 1.2);
  const jet = Math.pow(s, LAPSE - 1) * (1 + P.ram * M * M);
  return (1 - ab) * propEff + ab * Math.max(propEff, jet);
}

/**
 * The burners' share above the service ceiling. `cf` is physics.js
 * ceilingFactor() (1 up to 1.05 x the ceiling, down to `floor` by 1.25 x).
 * Without this the jet's law (which grows with Mach and loses only the 0.75
 * power of the density) out-pulled the ceiling fade, and checked flat out in
 * a steady climb (scratchpad zoom probe) the F/A-18 and F-35B, both
 * 50,000 ft aeroplanes, climbed to the 70,000 ft top of the sky, as did
 * Concorde (60,000). Faded with the air, the burners are gone by 1.25 x the
 * ceiling and the shared law's climb runs out where it always did
 * (tests/features/aircraft-specs.mjs). 1 below 1.05 x: every speed run
 * (PROFILES' heights are all under it) is untouched.
 */
export function ceilingBurner(cf, floor = 0.35) {
  if (!(cf < 1)) return 1;
  return smooth((cf - floor) / (1 - floor));
}

/** The transonic and supersonic drag coefficient added at Mach M. */
export function waveDrag(P, M) {
  if (!P || !(M > P.mdd - 0.08)) return 0;
  const m0 = P.mdd - 0.08;
  const mPeak = 1.04;
  let cd = M <= mPeak ? P.wave * smooth((M - m0) / (mPeak - m0)) : P.wave * (1 - (1 / 3) * smooth((M - mPeak) / 0.16));
  if (M > P.choke) {
    const d = M - P.choke;
    cd += 6 * d * d + 0.2 * d;
  }
  return cd;
}

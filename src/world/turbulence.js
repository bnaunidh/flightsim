/**
 * Turbulence as filtered random noise — the Dryden model (F1 of the rival
 * brief; MIL-F-8785C / MIL-HDBK-1797, in textbook form).
 *
 * The gusts the aeroplane flies through used to be a sum of sine products
 * (weather.js gustVector): global, the same at every speed and height, and
 * periodic — after a minute you could hum them. Here each gust axis is white
 * noise through a first-order low-pass whose time constant is a scale length
 * divided by the airspeed, so:
 *   - the bumps are random, never periodic;
 *   - flying faster brings them quicker (τ = L / V);
 *   - low level is choppier: below 1,000 ft the vertical scale length is the
 *     height itself and the strength is set by the 20 ft wind; above 2,000 ft
 *     the scale lengths are 1,750 ft and the strength comes from the
 *     weather's turbulence level; in between, a blend;
 *   - the integration is exact for any frame time: the state decays by
 *     exp(−dt/τ) and the new noise is scaled by √(1 − decay²), so the
 *     variance is the same at 30 and 120 frames a second.
 *
 * Besides the three gust velocities (u forward, v right, w up — metres per
 * second) it gives three unit-variance channels (np, nq, nr) with the same
 * filtering, for the roll, pitch and yaw buffet moments physics.js applies,
 * so those stop being sines too. Seeded, so a test can replay it.
 */

const FT = 3.28084;
const KT_TO_FTS = 1.68781;

/** The model's constants, in the units the standard writes them. */
export const DRYDEN = Object.freeze({
  /** Low altitude band ends (ft) and the high band begins (ft); blended between. */
  lowFt: 1000,
  highFt: 2000,
  /** Scale length at altitude, ft (the standard's 1,750). */
  highScaleFt: 1750,
  /**
   * Gust strength at altitude for a turbulence level of 1 (ft/s): "moderate"
   * is about 10, "severe" 20. It goes with the level SQUARED: clear air at
   * cruise is smooth (a clear sky's 0.12 gives the floor), cloud a little
   * (0.32 → 1.4 ft/s), a storm the lot — and a steady autopilot run in clear
   * air stays inside the game's 0.15° wander cap (tests/features/shake.mjs).
   */
  highSigmaFtS: 14,
  /** Low-level strength: σw = 0.1 × the 20 ft wind (ft/s), times (1 + this × the weather's turbulence level). */
  lowSigmaPerW20: 0.1,
  roughnessBoost: 2.0,
  /** Floors so a dead-calm day still has a whisper and the filters never divide by zero. */
  minSigmaFtS: 0.3,
  minSpeedMps: 8,
  minHeightFt: 10,
});

/** mulberry32: a small seeded generator, 0..1. */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The standard's scale lengths (ft) and strengths (ft/s) at height `hFt`
 * for a 20 ft wind `w20Kts` and a turbulence level `level` (0..1).
 */
export function drydenParams(hFt, w20Kts, level = 0.2) {
  const h = Math.max(DRYDEN.minHeightFt, hFt);
  // Low altitude.
  const W20 = Math.max(0, w20Kts) * KT_TO_FTS;
  const f = Math.pow(0.177 + 0.000823 * Math.min(h, DRYDEN.lowFt), 1.2);
  const Lw_low = Math.min(h, DRYDEN.lowFt);
  const Lu_low = Lw_low / f;
  const sw_low = Math.max(DRYDEN.minSigmaFtS, DRYDEN.lowSigmaPerW20 * W20 * (1 + DRYDEN.roughnessBoost * level));
  const su_low = sw_low / Math.pow(0.177 + 0.000823 * Math.min(h, DRYDEN.lowFt), 0.4);
  // Altitude.
  const L_high = DRYDEN.highScaleFt;
  const s_high = Math.max(DRYDEN.minSigmaFtS, DRYDEN.highSigmaFtS * level * level);
  // Blend 1,000..2,000 ft.
  const t = Math.min(1, Math.max(0, (h - DRYDEN.lowFt) / (DRYDEN.highFt - DRYDEN.lowFt)));
  const mix = (a, b) => a + (b - a) * t;
  return {
    Lu: mix(Lu_low, L_high),
    Lv: mix(Lu_low, L_high),
    Lw: mix(Lw_low, L_high),
    su: mix(su_low, s_high),
    sv: mix(su_low, s_high),
    sw: mix(sw_low, s_high),
  };
}

export class DrydenGusts {
  constructor(seed = 7) {
    this.rng = makeRng(seed);
    this._spare = null;
    this.u = 0;
    this.v = 0;
    this.w = 0;
    this.np = 0;
    this.nq = 0;
    this.nr = 0;
    this.out = { u: 0, v: 0, w: 0, np: 0, nq: 0, nr: 0, sigmaW: 0 };
  }

  /** A standard normal, Box–Muller from the seeded generator. */
  gauss() {
    if (this._spare !== null) {
      const s = this._spare;
      this._spare = null;
      return s;
    }
    let u1 = 0;
    while (u1 <= 1e-12) u1 = this.rng();
    const u2 = this.rng();
    const r = Math.sqrt(-2 * Math.log(u1));
    const a = 2 * Math.PI * u2;
    this._spare = r * Math.sin(a);
    return r * Math.cos(a);
  }

  /** One first-order step: decay by exp(−dt/τ), new noise scaled by √(1−a²) so the variance holds. */
  _filter(state, dt, tau, sigma) {
    const a = Math.exp(-dt / Math.max(1e-3, tau));
    return a * state + sigma * Math.sqrt(Math.max(0, 1 - a * a)) * this.gauss();
  }

  /**
   * Advance by `dt` seconds. { V: airspeed m/s, aglM: height above ground m,
   * w20Kts: the surface wind kt, level: the weather's turbulence 0..1,
   * spanM: wingspan m, scale: an overall multiplier }. Returns the gusts
   * { u, v, w } in m/s (body axes: forward, right, up) and the unit
   * channels { np, nq, nr }.
   */
  step(dt, { V = 50, aglM = 100, w20Kts = 8, level = 0.2, spanM = 11, scale = 1 } = {}) {
    if (!(dt > 0)) return this.out;
    const Vf = Math.max(DRYDEN.minSpeedMps, V) * FT;
    const P = drydenParams(aglM * FT, w20Kts, level);
    // Velocities, ft/s → m/s.
    this.u = this._filter(this.u, dt, P.Lu / Vf, P.su);
    this.v = this._filter(this.v, dt, P.Lv / Vf, P.sv);
    this.w = this._filter(this.w, dt, P.Lw / Vf, P.sw);
    /*
     * The rate channels: the roll gust's break frequency is πV/(4b), and the
     * pitch and yaw buffet are kept at the same quick clock (a buzz the
     * airframe's own damping and the autopilot average out), so the slow
     * wander comes only from the gust velocities themselves.
     */
    const bFt = Math.max(3, spanM) * FT;
    const tauP = (4 * bFt) / (Math.PI * Vf);
    const tauQ = tauP * 1.5;
    const tauR = tauP * 1.5;
    this.np = this._filter(this.np, dt, tauP, 1);
    this.nq = this._filter(this.nq, dt, tauQ, 1);
    this.nr = this._filter(this.nr, dt, tauR, 1);
    const o = this.out;
    o.u = (this.u / FT) * scale;
    o.v = (this.v / FT) * scale;
    o.w = (this.w / FT) * scale;
    o.np = this.np;
    o.nq = this.nq;
    o.nr = this.nr;
    // The vertical gust strength (ft/s): what the buffet moments are sized by.
    o.sigmaW = P.sw * scale;
    return o;
  }

  reset() {
    this.u = this.v = this.w = this.np = this.nq = this.nr = 0;
    this._spare = null;
  }
}

/**
 * The log wind profile (F3): the wind felt at `hAgl` metres over ground of
 * roughness length `z0` (metres: 0.0002 water, 0.01 pavement, 0.03 short
 * grass, 0.5 towns and forest), as a multiple of the CHOSEN wind.
 *
 * The chosen wind is what the tower, the HUD, the windsock and every
 * mission's "sixteen knots across" mean: the standard 10 m wind over an
 * airfield's grass (WIND_REF_M; the brief's h_ref). Below that it fades as
 * ln(h/z0) — over the last fifty feet of an approach, and on the runway the
 * wheels feel about four fifths of it — and above it the wind strengthens
 * up to `capM`, where every surface agrees (about 1.5× at 200 m), so
 * nothing jumps when the surface under you changes up there.
 * (Checker, realism-1: this was normalised to the wind at 200 m, which cut
 * every reported crosswind to half at the wheels.)
 */
export const ROUGHNESS = Object.freeze({ water: 0.0002, paved: 0.01, grass: 0.03, town: 0.5 });
export const WIND_REF_M = 10;
export function windProfile(hAgl, z0 = ROUGHNESS.grass, capM = 200) {
  const z = Math.max(1e-4, z0);
  const h = Math.min(capM, Math.max(z * Math.E, hAgl));
  // The wind at the cap, from the chosen 10 m wind over grass; then down to h over this surface.
  const atCap = Math.log(capM / ROUGHNESS.grass) / Math.log(WIND_REF_M / ROUGHNESS.grass);
  return (atCap * Math.log(h / z)) / Math.log(capM / z);
}

/**
 * Ground effect for a fixed wing (F4): McCormick's factor on the induced
 * drag, φ = (16h/b)² / (1 + (16h/b)²), for a wing `hM` above the ground
 * and a span `bM`. 1 well above a span up; about 0.5 at b/16 (the flare).
 */
export function groundEffectInduced(hM, bM) {
  const b = Math.max(1, bM);
  const x = (16 * Math.max(0.05, hM)) / b;
  const x2 = x * x;
  return x2 / (1 + x2);
}

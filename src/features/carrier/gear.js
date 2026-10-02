/**
 * The deck machinery as numbers: the arresting gear's pull, the catapult's
 * shot, and where the tail hook is on any aeroplane.
 *
 * Pure, for tests/features/carrier.mjs.
 *
 * THE ARRESTING GEAR. A real Mk 7 engine is set for each aeroplane's weight
 * and speed so that every trap stops in about the same run-out — roughly a
 * hundred metres, in two to three seconds. Here the run-out is 1.45 m per
 * m/s of touchdown speed, between 50 and 110 m, so the stop always takes
 * about 2.9 s: 62 m/s (120 kt) stops in 90 m. The pull builds over the first
 * quarter second as the wire takes up its slack, then holds, and at the end
 * the wire pulls the jet back a metre and a half — the roll-back you see on
 * every real trap before the pilot raises the hook.
 *
 * THE CATAPULT. Zero to flying speed in about two seconds: a constant
 * acceleration to `catEndOverStall` times the clean stall speed in
 * `catSeconds`, which for the Hornet here is 109 kt in 2.1 s at 2.7 g.
 */

export const ARREST = {
  runoutPerMs: 1.45,
  minRunout: 50,
  maxRunout: 110,
  ramp: 0.25,
  rollback: 1.5,
  rollbackTime: 0.9,
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function runoutFor(v0) {
  return clamp(v0 * ARREST.runoutPerMs, ARREST.minRunout, ARREST.maxRunout);
}

/** Distance to a stop under a pull that ramps to A over tau, then holds. */
export function stopDistance(v0, A, tau = ARREST.ramp) {
  if (A * tau / 2 >= v0) {
    // Stops inside the ramp: v0 = A t²/(2 tau).
    const t = Math.sqrt((2 * tau * v0) / A);
    return v0 * t - (A * t * t * t) / (6 * tau);
  }
  const v1 = v0 - (A * tau) / 2;
  return v0 * tau - (A * tau * tau) / 6 + (v1 * v1) / (2 * A);
}

/** The pull that stops a jet arriving at v0 in exactly D metres. */
export function solveArrest(v0, D, tau = ARREST.ramp) {
  let lo = 0.5;
  let hi = 400;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (stopDistance(v0, mid, tau) > D) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Where the jet is t seconds after the wire takes it: paid-out metres, speed, and whether it has stopped. */
export function arrestAt(v0, A, t, tau = ARREST.ramp) {
  if (t <= tau) {
    const v = v0 - (A * t * t) / (2 * tau);
    if (v > 0) return { s: v0 * t - (A * t * t * t) / (6 * tau), v, a: (A * t) / tau, stopped: false };
  }
  const v1 = v0 - (A * tau) / 2;
  const s1 = v0 * tau - (A * tau * tau) / 6;
  const d = t - tau;
  const v = v1 - A * d;
  if (v <= 0) return { s: s1 + (v1 * v1) / (2 * A), v: 0, a: 0, stopped: true, tStop: tau + v1 / A };
  return { s: s1 + v1 * d - (A * d * d) / 2, v, a: A, stopped: false };
}

/** A whole arrestment, planned at the moment of the catch. */
export function planArrest(v0) {
  const D = runoutFor(v0);
  const A = solveArrest(v0, D);
  const tStop = ARREST.ramp + (v0 - (A * ARREST.ramp) / 2) / A;
  return { v0, D, A, tStop, peakG: A / 9.80665 };
}

/** The catapult shot for an aeroplane whose clean stall is `stallMs`. */
export function planShot(stallMs, endOverStall = 1.45, seconds = 2.1) {
  const vEnd = Math.max(30, stallMs * endOverStall);
  const a = vEnd / seconds;
  return { vEnd, a, seconds, stroke: 0.5 * a * seconds * seconds, peakG: a / 9.80665 };
}

/**
 * Where the hook is, in the aeroplane's own frame (metres, +x right, +y up,
 * -z forward), worked out from the same gear and strike points the flight
 * model uses, so it is right for every type: a little above the main wheels'
 * contact line — it touches the deck first only when the nose is up, which
 * is the attitude every carrier approach is flown at — and four-fifths of
 * the way from the main wheels to the tail.
 */
export function hookGeometry(spec) {
  const gp = (spec && spec.gearPoints) || [];
  const mains = gp.filter((g) => g.name !== 'nose');
  const use = mains.length ? mains : gp;
  let mainY = 0;
  let mainZ = 0;
  if (use.length) {
    mainY = Math.min(...use.map((g) => g.pos.y));
    mainZ = use.reduce((s, g) => s + g.pos.z, 0) / use.length;
  }
  const tail = ((spec && spec.hardPoints) || []).find((h) => h.part === 'tail');
  const tailZ = tail ? tail.pos.z : mainZ + 5;
  const span = Math.max(1.5, tailZ - mainZ);
  const point = { x: 0, y: mainY + 0.12, z: mainZ + span * 0.8 };
  const pivot = { x: 0, y: mainY * 0.35, z: mainZ + span * 0.45 };
  return { point, pivot, length: Math.hypot(point.y - pivot.y, point.z - pivot.z) };
}

/**
 * The numbers T-Pose Harrison's model and his moves share, with no imports
 * at all — the model is built from inside the aircraft roster (types.js ->
 * extra/tpose.js -> models/tpose-harrison.js), and anything that imported
 * the flight model from there would be a cycle.
 *
 * SIGNAL: while he spins, the three stick bytes of his snapshot (pitch,
 * roll, rudder — the spin flies him, so it is not using them) carry this
 * exact pattern; his model, on every player's screen, spins while it reads
 * it for SIGNAL.hold seconds. No hand holds three exact fractions still for
 * a fifth of a second. They survive protocol.js's int8 quantising (1/127)
 * to within 1/254.
 */

export const KT = 1.94384;

/** The spin, as drawn: turns per second (the climb itself is moves.js's). */
export const SPIN_TURNS = 1.5;

export const SIGNAL = { pitch: 0.25, roll: 0.75, yaw: -0.75, tol: 0.006, hold: 0.15 };

export function setSpinSignal(c) {
  c.pitch = SIGNAL.pitch;
  c.roll = SIGNAL.roll;
  c.yaw = SIGNAL.yaw;
}

/** True if these controls carry the pattern (one frame's worth). */
export function isSpinSignal(c) {
  if (!c) return false;
  const t = SIGNAL.tol;
  return Math.abs((c.pitch || 0) - SIGNAL.pitch) < t && Math.abs((c.roll || 0) - SIGNAL.roll) < t && Math.abs((c.yaw || 0) - SIGNAL.yaw) < t;
}

/** The speed of sound at a height, m/s (ISA, flat above the tropopause). */
export function soundSpeed(alt) {
  return Math.max(295.1, 340.3 - 0.00405 * Math.max(0, alt || 0));
}

export function machOf(speed, alt) {
  return speed / soundSpeed(alt);
}

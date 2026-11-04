/**
 * Was that a ditching, and how good a one? Pure: no page, no scene, so
 * tests/features/ditching.mjs reads every rule without flying.
 *
 * The three questions are the ones a pilot is taught: wings level, coming
 * down gently, not too fast. A nose dug in or a tail dragged too hard is the
 * fourth. Over water that is the whole difference between an aeroplane that
 * slides to a stop in one piece and the crash in crashes/kinds.js.
 *
 *   sink    6.5 m/s (1,280 ft/min), and a third less with the wheels hanging,
 *           which catch the water and pull the nose in
 *   bank    14 degrees
 *   pitch   10 down to 18 up
 *   speed   1.6 x this type's clean stall (1.45 x for a fast jet), 10% less
 *           with the wheels down. Flaps are how you get under it.
 * Easy and Realistic move the sink and bank limits as they do for a runway.
 */

export const DITCH = Object.freeze({
  sinkFpm: 1280,
  bankDeg: 14,
  pitchDownDeg: -10,
  pitchUpDeg: 18,
  stallFactor: 1.6,
  fastStallFactor: 1.45,
  gearSink: 0.72,
  gearSpeed: 0.9,
  easy: 1.3,
  realistic: 0.8,
});

/** What the people aboard do about it: 'airliner' slides and rafts, 'light' wings and a raft, 'fast' one dinghy. Null: not this type. */
export function ditchClass(type) {
  if (!type || !type.shape) return null;
  const p = type.shape.power || {};
  if (p.rotor || /heli|rotor/i.test(String(type.class || ''))) return null; // a helicopter keeps its own ending
  if (type.id === 'tpose' || type.aero.floats) return null; // a man in a T-pose, and a floatplane is not ditching
  if (/airliner/i.test(String(type.class || '')) || type.aero.mass >= 12000 && !/fighter|carrier/i.test(String(type.class || ''))) return 'airliner';
  if (type.military || /fighter|carrier|racer/i.test(String(type.class || ''))) return 'fast';
  return 'light';
}

/** How long the aeroplane stays up after it has stopped, seconds. */
export function sinkSeconds(cls, massKg = 0) {
  if (cls === 'fast') return 95;
  if (cls === 'light') return 130;
  return 150 + Math.min(60, massKg / 500);
}

/** The limits for this type, wheels and difficulty. `stallKts` is performanceFor(id).stallClean. */
export function ditchLimits({ stallKts = 60, cls = 'light', gearDown = false, difficulty = 'normal' } = {}) {
  const hard = difficulty === 'easy' ? DITCH.easy : difficulty === 'realistic' ? DITCH.realistic : 1;
  const speedKts = stallKts * (cls === 'fast' ? DITCH.fastStallFactor : DITCH.stallFactor) * (gearDown ? DITCH.gearSpeed : 1);
  return {
    speedKts: Math.round(speedKts),
    sinkFpm: Math.round(DITCH.sinkFpm * hard * (gearDown ? DITCH.gearSink : 1)),
    bankDeg: DITCH.bankDeg * hard,
    pitchDownDeg: DITCH.pitchDownDeg,
    pitchUpDeg: DITCH.pitchUpDeg,
  };
}

/**
 * Judge one arrival. `a`: { speedKts, sinkFpm, bank, pitch }, the last two in
 * degrees, sinkFpm positive down. Returns { ok, why, over } where `over` says
 * which limit was broken.
 */
export function survivable(a, limits) {
  if (a.sinkFpm > limits.sinkFpm) return { ok: false, over: 'sink', why: 'Too steep' };
  if (Math.abs(a.bank) > limits.bankDeg) return { ok: false, over: 'bank', why: 'A wing dug in' };
  if (a.pitch < limits.pitchDownDeg) return { ok: false, over: 'pitch', why: 'The nose dug in' };
  if (a.pitch > limits.pitchUpDeg) return { ok: false, over: 'pitch', why: 'The tail dug in' };
  if (a.speedKts > limits.speedKts) return { ok: false, over: 'speed', why: 'Too fast' };
  return { ok: true, over: null, why: '' };
}

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/**
 * The score, the same 0..100 a runway gets. Sink counts most, as it does on
 * a runway; the wheels left down and a rough sea cost marks, and flaps out
 * earn their share.
 */
export function gradeDitching(a, limits, { gearDown = false, flaps = 0, rough = 0 } = {}) {
  const sink = clamp01(1 - a.sinkFpm / limits.sinkFpm);
  const speed = clamp01(1 - a.speedKts / (limits.speedKts * 1.15));
  const level = clamp01(1 - Math.abs(a.bank) / limits.bankDeg);
  const attitude = clamp01(1 - Math.abs(a.pitch - 4) / 14);
  let score = 12 + sink * 42 + speed * 58 * 0.5 + level * 12 + attitude * 5;
  score += clamp01(flaps) * 6;
  if (gearDown) score -= 12;
  score -= clamp01(rough) * 8;
  score = Math.max(0, Math.min(100, Math.round(score)));
  const grade = score >= 88 ? 'Textbook' : score >= 74 ? 'Good' : score >= 56 ? 'Firm' : 'Rough';
  // The touchdown card's and the runner's own word for the same thing.
  const quality = score >= 88 ? 'perfect' : score >= 74 ? 'good' : score >= 56 ? 'firm' : 'rough';
  return { score, grade, quality };
}

/** How hard the sea pulls, as a fraction of g, at this speed: planing at first, then the hull is in it. */
export function waterDecelG(speedMps, nearestStop = 0) {
  const v = Math.max(0, speedMps);
  return 0.22 + Math.min(0.5, (v * v) / 4200) + nearestStop;
}

/**
 * Her height at rest above the keel-on-the-water line: a hull floats well down
 * in the water, about two fifths of the way up from the belly to the centre
 * line, which puts a low wing's root at the waterline and a door's sill a foot
 * or two above it. `belly` is the belly hard point's height, negative.
 */
export function floatHeight(belly) {
  return -belly * 0.58;
}

/** After a bad arrival in a mission that wanted a good one: which limit it was, in numbers, so the next try knows. */
export function missWords({ arrival: a, limits: l, over }) {
  if (over === 'speed') return `You reached the water at ${Math.round(a.speedKts)} knots, and she has to be under ${l.speedKts}. Flaps down, and let her slow up.`;
  if (over === 'sink') return `You came down at ${Math.round(a.sinkFpm)} feet a minute, and she holds together under ${l.sinkFpm}. Raise the nose a little in the last hundred feet.`;
  if (over === 'bank') return `You were ${Math.round(Math.abs(a.bank))} degrees banked and a wing dug in. Wings level, all the way down.`;
  if (a.pitch < 0) return `Her nose was ${Math.round(-a.pitch)} degrees down and it dug in. Hold it a little above the horizon.`;
  return `Her nose was ${Math.round(a.pitch)} degrees up and the tail dug in. Hold it just above the horizon.`;
}

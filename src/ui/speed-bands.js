/**
 * The speeds the HUD's words and the coach's hints are measured against, for
 * the aeroplane you are actually in.
 *
 * They were the Skylark's for everything: 52 kt "flying speed", 70 kt "good
 * cruising speed", "lift off at 55 knots", "aim for 70 knots" on final. In an
 * A321neo (clean stall 89 kt in this game) the speed box said "good cruising
 * speed" below the stall, and the take-off roll was told to lift off at 55 —
 * found flying it the way an A320 home-cockpit pilot would (w16-tom).
 *
 * The Skylark's numbers are kept exactly (its clean stall, 49 kt, is the
 * yardstick); anything that stalls faster has them scaled by its own clean
 * stall, and the airliners' rotate and approach speeds come from their
 * landing stall the way features/airliners.js's take-off hint already does
 * (x 1.3, to the nearest 5 kt), so the hint and the coach say the same number.
 *
 * `perf` is aircraft/types.js performanceFor(id): { stallClean, stallLanding }.
 */
const SKYLARK_STALL = 49;
const r5 = (v) => Math.round(v / 5) * 5;

export function speedBands(perf) {
  const sc = perf && perf.stallClean > 0 ? perf.stallClean : SKYLARK_STALL;
  const sl = perf && perf.stallLanding > 0 ? perf.stallLanding : 40;
  const s = Math.max(1, sc / SKYLARK_STALL);
  const big = s > 1.05;
  const rotate = big ? r5(sl * 1.3) : 52;
  const approach = big ? r5(sl * 1.35) : 70;
  return {
    scale: s,
    // The speed box's words.
    tooSlow: 30 * s,
    flying: 52 * s,
    cruise: 70 * s,
    fast: 110 * s,
    veryFast: 150 * s,
    // The coach.
    rotate,
    liftOff: big ? rotate : 55,
    approach,
    tooFastToLand: approach + 25,
    // Airborne and slower than this: "Too slow!" (with flaps out, the landing stall's margin).
    tooSlowAir: (flapsOut) => (big ? Math.round((flapsOut ? sl * 1.15 : sc * 1.05)) : 52),
  };
}

/** The word under the airspeed, for an aeroplane (not a helicopter). */
export function speedWord(ias, bands, onGround = false, groundKts = 0) {
  const b = bands || speedBands(null);
  let word = 'stopped';
  if (ias > b.veryFast) word = 'very fast';
  else if (ias > b.fast) word = 'fast';
  else if (ias > b.cruise) word = 'good cruising speed';
  else if (ias > b.flying) word = 'flying speed';
  else if (ias > b.tooSlow) word = 'too slow to fly';
  else if (ias > 3) word = 'rolling';
  // Parked into a breeze the airspeed reads the wind: a 6 kt headwind said
  // "rolling" with the parking brake on. On the ground, below flying speed,
  // the word is what the wheels are doing.
  if (onGround && ias <= b.tooSlow) word = groundKts > 1.5 ? 'rolling' : 'stopped';
  return word;
}

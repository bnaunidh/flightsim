/**
 * How the Skyhook handles, and the equipment that makes it handleable.
 *
 * Everything in this file exists because of one measurement. A ten-year-old
 * closing a control loop on a Chromebook keyboard has a bang-bang input — the
 * key is down or it is up, there is no halfway — and between that key and the
 * number they are trying to hold there were four integrators:
 *
 *     key held -> throttleTarget ramps -> out.throttle lags -> rpm spools
 *              -> vertical acceleration -> vertical speed -> height
 *
 * A human cannot close a loop round that. Adults cannot close a loop round
 * that. It is a fact about control theory and no amount of encouraging mission
 * text fixes it. So this file does three separate jobs, and it is worth being
 * clear about which is which, because two of them are BUG FIXES and only one
 * of them is an assist:
 *
 *   1. TUNING. The rotor control arms in types.js were guesses and they were
 *      three to four times too large. Measured on the unmodified build, full
 *      deflection held for three seconds gave a sustained 206 deg/s of roll,
 *      165 deg/s of pitch and 197 deg/s of yaw. A real light helicopter rolls
 *      at about 70, pitches at about 45 and pedal-turns at about 65. The
 *      numbers in ROTOR_TUNE are solved backwards from those three rates.
 *
 *   2. THE SIGN. See the note on ROTOR_TUNE.signFix. The cyclic roll and the
 *      pedal were wired backwards on the helicopter only, and that is not a
 *      matter of taste — "roll right" banked it eighty-five degrees to the
 *      LEFT in one second, measured.
 *
 *   3. HOVER ASSIST, which is the only part of this file that is actually an
 *      assist. Height hold, drift damping, heading hold. It is real equipment
 *      — every search-and-rescue helicopter in the world has all three — it
 *      ships ON, it says so on the HUD, and it can be switched off. It is not
 *      hidden, because a child who finds out later that the machine was flying
 *      itself has been cheated of the thing they were proud of.
 *
 * Nothing here knows about missions, winches or pads. It is given an aircraft
 * and a timestep and it returns four numbers.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp } from '../core/noise.js';
import { heightAt, platformAt, PLATFORMS, OBSTACLES } from '../world/terrain.js';
import { PADS } from '../world/pads.js';

const G = 9.80665;
const RHO0 = 1.225;

/**
 * Every number that decides how the helicopter feels, in one place.
 *
 * The three control arms are not free choices: each is solved from the rate it
 * is meant to produce. A rotor's control moment is (disc thrust) x (arm), the
 * disc thrust at hover collective is 0.675 * m * g, and the airframe damping
 * below gives a first-order rate response, so
 *
 *     arm = (rate we want) * (damping) * (axis inertia) / (0.675 * m * g)
 *
 * With m = 2200 kg that gives 0.45, 0.33 and 0.79. Change a rate here and the
 * arm in types.js has to be recomputed; the check is at the bottom of this
 * file in `describeRotorFeel()`, which prints what the current numbers
 * actually produce so nobody has to take this comment on trust.
 *
 * IMPORTANT: the damping constants are used TWICE — once by the airframe, in
 * the moment block in physics.js, and once here, where the assist solves its
 * derivative gain for whatever damping the airframe already has. They must be
 * the same numbers, which is why they live here and not as literals in two
 * files that will drift apart.
 */
export const ROTOR_TUNE = {
  /* --- airframe rate damping, 1/s. Bigger = crisper stop, less float. --- */
  dampRoll: 1.8,
  dampPitch: 1.45,
  dampYaw: 1.7,

  /* --- what full deflection is allowed to buy, rad/s (for reference) --- */
  rateRoll: 1.21, // 69 deg/s
  ratePitch: 0.79, // 45 deg/s
  rateYaw: 1.13, // 65 deg/s

  /*
   * The collective is a lever, not a throttle.
   *
   * The engine model ramps rpm toward its target at 2.4/s going up and 1.1/s
   * coming down. On a piston aeroplane that is right and it is part of the
   * character. On a helicopter it is nonsense — the rotor turns at a constant
   * speed and the collective changes blade pitch through a mechanical linkage,
   * which happens now. Worse, the asymmetry means a child who has climbed too
   * high and lowers the lever waits the better part of a second for anything
   * to happen, which is the single most common way a hover turns into a crash.
   *
   * collSpool 12/s is a 0.08 s lag: enough to stop a step input ringing the
   * integrator, far too quick to feel.
   *
   * collFloor is what the lever reads at the bottom of its travel. It was
   * 0.18, the aeroplane's idle, which meant a helicopter could never fully
   * lower the collective. 0.06 keeps the engine audio above its own running
   * threshold (audio/engine.js treats rpm <= 0.04 as stopped) and puts hover
   * at 47% of stick travel instead of 39% — which matters on a tablet, where
   * the thumb wants the hover point near the middle of the slider.
   *
   * CORRECTION, measured 2026-09-23. Neither number above was ever wired in.
   * Nothing outside this file read collFloor or collSpool: the rotor took
   * `ac.rpm` as its collective, and rpm is the aeroplane's engine model —
   * 0.18 + 0.82 * lever, spooling at 2.4/s up and 1.1/s down. So the lever
   * still floored at 0.18, hover still sat at 39% of travel, and lowering the
   * lever waited on a piston spool-down. Measured on the unmodified build,
   * lever 90% -> 3% over two seconds of Ctrl: vertical speed stayed at +12.7
   * m/s for 1.5 s and was still +11.9 at 2.0 s.
   *
   * collSpool is now real: the blades follow the lever at 12/s through
   * `leverCollective()` below, and rpm goes back to being only the engine
   * note. The lever's idle stays at `leverIdle` (0.18), because that is the
   * model realistic mode has always flown and the three-games suite parks the
   * raw machine on `hoverLever` expecting it to be off-trim — see the note on
   * hoverLever at the bottom of rotorAssist(). collFloor survives only as the
   * scale hoverLever and trimRequest are published on.
   */
  collFloor: 0.06,
  collSpool: 12,
  leverIdle: 0.18,

  /*
   * The two numbers that bound the vertical.
   *
   * maxLift is the most the rotor can pull as a multiple of the machine's own
   * weight, and discCD is the drag coefficient of the disc treated as a flat
   * plate when the machine is going straight up or straight down. Together
   * they give a best rate of climb near 13 m/s empty and near 10 m/s with
   * three people aboard, and a maximum vertical descent near 23 m/s. Before
   * them, full collective accelerated upwards at one g without limit.
   *
   * HOW it was capped mattered, and the first way was wrong. It was written
   * `min(collective * 2, maxLift)`, which reaches the cap at 65% and is flat
   * from there to the top: the top 35% of the lever did nothing at all. With
   * the lever at 90% you could pull it down to 65% and the machine did not
   * notice. It is now two straight lines through the same three points —
   * nothing at 0, one weight at 50%, maxLift at 100% — so hover is still
   * exactly half and the best climb is unchanged, but every bit of lever
   * above the hover does something. See rotorLiftRatio().
   */
  maxLift: 1.3,
  discCD: 1.1,
  /*
   * A skid's scrub fore and aft, as a share of the load on the skids: the
   * tyre code's sideways grip is 0.75-0.92, and a little under half of it
   * keeps a run-on landing a slide rather than a somersault. Used by the
   * rotor block in physics.js; see the note there.
   */
  skidScrub: 0.35,

  /* --- hover assist: where it works --- */
  // Ground speed, m/s. Full assist below fadeLo, none above fadeHi.
  // 10.3 m/s is 20 kt and 23.2 m/s is 45 kt, which is the brief's window and
  // is also above anything you would call a hover and below anything you
  // would call a cruise.
  fadeLo: 10.3,
  fadeHi: 23.2,

  /* --- height hold --- */
  // Collective per metre of height error, and per m/s of vertical speed.
  // Collective-to-vertical-acceleration is 2g, so hhD = 0.36 is a velocity
  // loop with a 0.14 s time constant and hhP = 0.055 gives wn = 1.04 rad/s
  // at zeta = 3.4. Deliberately over-damped: it settles in about five seconds
  // and it never, ever overshoots, and overshoot near a cliff kills.
  hhP: 0.055,
  hhD: 0.36,
  // How much collective the assist may add or take away. A casualty and a
  // stretcher is about 95 kg on a 2200 kg machine, which needs 0.043 of
  // collective. Two of them plus a winchman needs 0.09. So 0.30 hides a
  // useful load and runs out on a hot, heavy, high-altitude lift — which is
  // exactly where the power margin is supposed to become the player's
  // problem rather than the autopilot's.
  hhClamp: 0.3,
  // Seconds the pilot must leave the lever alone before the height is
  // captured, and the vertical speed above which it refuses to capture at all
  // (so parking a thumb on the touch slider in a climb does not make the
  // assist fight the climb).
  captureDelay: 0.3,
  /*
   * The vertical speed above which the assist refuses to take the height.
   *
   * This was 2.2 m/s and it was too strict to be useful on a keyboard. A
   * quarter-second tap of the collective key is 0.075 of lever, which is
   * 1.5 m/s^2, which is 2.5 m/s of sink by the time the key has sprung back
   * and the capture timer has run — so every single tap fell through the
   * test and the assist never caught anything the pilot actually did. At 3.0
   * a tap becomes what it should be: one small step down, arrested, held.
   * Much above 3.0 and it starts fighting deliberate climbs and descents,
   * which is the opposite failure and the worse one.
   */
  captureVS: 3,
  // Capture where the machine is GOING, not where it is, or releasing the key
  // in a 3 m/s climb bounces it back down. 0.8 s of lead cancels that.
  captureLead: 0.8,
  /*
   * How fast the assist hands its own correction back to the pilot's lever.
   *
   * Without this the assist is a hidden integrator and it kills people. What
   * happened, measured: tapping the collective-down key every four seconds
   * from 30 m, the height hold quietly cancelled each tap, so the lever crept
   * 0.30 below the hover point while the machine sat level and the HUD read a
   * steady height. On the fifth tap the correction hit its stop and the
   * machine fell out of the sky — 23.8 m to 1.6 m in four seconds, 2,400
   * ft/min, crashed. No warning, and nothing the pilot did explained it.
   *
   * So the assist does what a real force-trim does: it winds its steady
   * correction into the lever itself and lets go of it. 0.5/s is a two-second
   * time constant — slow enough that it is never felt as the machine moving,
   * fast enough that the lever is back under the hover mark before the next
   * tap. The lever on screen creeps to where the hover actually is, which is
   * the single most useful thing the POWER gauge can show: pick up a casualty
   * and you watch the lever rise.
   */
  collBackDrive: 0.5,
  // Rate of change of the commanded collective, per second, above which the
  // pilot counts as flying it. The key ramp is 0.62/s and the touch slider is
  // far faster, so 0.09 is well clear of both and well above the residue of
  // the input smoother.
  cmdMoving: 0.09,
  // The height term fades out below 3 m so the machine settles onto its skids
  // instead of hovering a metre up for ever. The vertical-speed term does NOT
  // fade: that is what makes the touchdown gentle.
  flareLo: 1,
  flareHi: 3,

  /* --- drift damping --- */
  // Wanted horizontal deceleration per m/s of drift, 1/s. 0.55 gives a 1.8 s
  // time constant: hands off at 2 m/s, under 0.5 m/s in about four seconds,
  // which is the brief's number and is slow enough that it never feels like
  // the machine took the controls away.
  driftGain: 0.55,
  // How far the assist is allowed to tilt the machine to do it, radians.
  // 8 degrees is 1.38 m/s^2 — enough to stop a 2 m/s drift inside the 12 m
  // circle, small enough that the horizon never swings alarmingly.
  tiltMax: 0.14,
  /*
   * Wind trim, and why a proportional loop was not enough.
   *
   * Drift damping alone balances a steady wind at a steady speed instead of
   * stopping it. Measured with the proportional loop only, a 20 kt wind: the
   * machine settled into a permanent 1.11 m/s crawl downwind — under the
   * 1.5 m/s drift limit, so the HUD said the hover was good, and out of a
   * 12 m circle in eleven seconds, so the winch run failed anyway. That is the
   * worst possible failure: the instrument says you are doing it right while
   * you lose.
   *
   * So the assist also learns the lean the wind needs, slowly, and holds it.
   * This is exactly what a pilot does with the stick and exactly what a real
   * hover hold does with a trim actuator. The gain is solved for a damping
   * ratio of about 0.9 against the proportional loop above: wn = sqrt(g*kI),
   * zeta = driftGain / (2*wn), so kI = 0.0095 gives wn = 0.31 rad/s and a
   * trim that takes some ten seconds to settle and never hunts.
   *
   * It is stored in WORLD axes, not the machine's, so a pedal turn in the
   * middle of a winch run does not scramble a trim that was already right.
   */
  trimGain: 0.0095,
  trimMax: 0.11, // radians of lean the trim alone may ask for: a 25 kt wind
  tiltTotal: 0.2, // radians, proportional + trim together: 11.5 degrees
  // The trim bleeds away when the assist is not flying, so a machine parked
  // on a pad does not take off leaning into yesterday's wind.
  trimBleed: 0.6,

  /* --- the attitude loop underneath the drift loop --- */
  // Natural frequency of the inner attitude hold, rad/s, and its damping
  // ratio. Slightly over-damped so it never overshoots into a wobble. These
  // are frequencies, not gains: the gains are solved per axis from the
  // authority the rotor actually has, exactly as the wing leveller in
  // physics.js does, so they stay correct if the arms change.
  wnRoll: 2.6,
  wnPitch: 2.1,
  wnYaw: 1.6,
  zeta: 1.05,

  /* --- handing control back --- */
  // The assist fades out as the stick moves, so a deliberate input is never
  // fought, and fades back in as it centres. Full assist below `stickDead`,
  // none by `stickDead + stickBand`.
  stickDead: 0.05,
  stickBand: 0.3,

  /*
   * THE SIGN FIX, recorded here because it is the kind of thing that gets
   * "tidied" back in by somebody who has not measured it.
   *
   * The wing writes its roll moment as `Cl = ... - Clda * aileron`, with the
   * comment "positive aileron input rolls right". The rotor block wrote
   * `_t.z += aileron * disc * arm`, and +Z torque is defined in this file as
   * LEFT WING DOWN. So the helicopter's cyclic roll was the opposite way
   * round from every aeroplane in the game. The pedal had the same fault:
   * the wing does `Cn = ... - Cndr * rudder` and the rotor did `_t.y += ...`,
   * and +Y is nose LEFT.
   *
   * Measured on the unmodified build, realistic mode, hovering:
   *   "roll right" held one second  -> 85.4 degrees of bank to the LEFT
   *   "yaw right"  held one second  -> 144 degrees of heading to the LEFT
   *   "pitch up"   held one second  -> 75.1 degrees nose UP (this one was fine)
   *
   * It also means the simplified-mode wing leveller had positive feedback on
   * the helicopter, which is what the long comment at physics.js:601 is
   * describing when it says "2 degrees of bank became 7, then 36, then 105 in
   * four seconds". That fix reduced the gain of a loop whose sign was wrong,
   * so it diverged more slowly. Measured on the unmodified build, simplified
   * mode, released from 2 degrees of bank at 60 kt: crashed at 24.6 s.
   * Pitch was never affected, which is why it was never caught: hovering and
   * climbing worked, and only turning killed you.
   */
  signFix: true,

  /*
   * THE ENVELOPE, realistic mode only (kid mode never gets near it).
   *
   * The cyclic is a rate control: hold it and the machine keeps rotating at
   * 45 deg/s for as long as you hold it. Measured on the unmodified build,
   * hovering, W held for four seconds: the nose went through -87 degrees,
   * the machine went over on its back (heading 90 -> 270) and hit the ground
   * at 21.8 m/s with only 8.7 m/s of groundspeed to show for it. One held key
   * is not a mistake anybody should be able to die of in a school lesson.
   *
   * So the stick's authority fades out as the attitude approaches a limit —
   * pitch from 15 to 30 degrees, bank from 25 to 40, the third set of
   * numbers tried (the first two are below) — and past the limit the
   * machine is pushed back. Inside the limits nothing changes at all, so
   * everything a realistic pilot does on purpose is untouched.
   */
  // Measured with the first numbers (25-40 pitch, 35-55 bank): W held four
  // seconds peaked at -47.8 degrees and A held four at 63.6, because the
  // machine is already rolling at 45-70 deg/s when the fade begins.
  //
  // Measured again with 20-35 and 30-45 (the review of the first kid build):
  // W held four seconds still peaked at -43.5 and A at 56 degrees of bank,
  // and letting go of W left the nose at -34 degrees, where it ran on to
  // 55 m/s. Fading the stick out does not stop a rotation that is already
  // going; the airframe's own damping lets it coast most of another thirty
  // degrees. So inside the band the envelope now also brakes the rotation
  // towards the limit (envArrest, per rad/s), and with the stick let go it
  // eases the machine back to the band's near edge (envReturn, per radian)
  // rather than leaving it hanging on the far one. Measured with these, in
  // the kid playtest's realistic section: W held four seconds peaks at
  // -30.8 and is at +5.5 three seconds after letting go (the hover assist
  // braking the drift it built up); A held four peaks at 42.0 degrees of
  // bank and is back to 19.0 three seconds after.
  //
  // CORRECTION, measured 2026-09-26: that +5.5 was true only from the
  // playtest's hover, where the lever sits at 39% and W never gets past
  // 19 m/s. The review of 30a4007 settled its hover with taps from a
  // full-lever climb, which leaves the lever at 90% (the height hold taking
  // the rest off): the same four seconds of W peaked at -31.3, and let go it
  // came up to -14.3, went back down and sat at -24.8 degrees at 51 m/s for
  // the next minute. The aeroplane's trim assist in physics.js — above
  // 20 m/s with the stick centred it winds the trim against any pitch rate,
  // which is an attitude hold — had wound to its -0.45 stop, holding the
  // nose down against envReturn's 0.24. So while the envelope is bringing
  // the nose back, nose-down trim bleeds away at envTrimBleed. Measured
  // with it, from the review's hover: -21.0 a second after letting go,
  // -11.5 at two, then -12 to -15 for the rest of the minute at 45 m/s,
  // trim inside -0.12. From the playtest's hover, unchanged: +6.3 at three
  // seconds. (A is unchanged too: 42 degrees of bank at the peak, and let
  // go it sits at 18.5, inside envBankLo, turning. A helicopter does not
  // level its own wings, and realistic mode does not pretend it does.)
  envPitchLo: 0.262, // 15 deg
  envPitchHi: 0.524, // 30 deg
  envBankLo: 0.436, // 25 deg
  envBankHi: 0.698, // 40 deg
  envArrest: 2.5,
  envReturn: 2,
  envTrimBleed: 3, // 1/s

  /*
   * KID MODE. The default: easy and normal difficulty, hover assist on.
   *
   * Realistic mode is a helicopter with equipment. Kid mode is a helicopter
   * with a flight computer, because the measurement at the top of this file
   * is a fact about keyboards and ten-year-olds and no amount of tuning the
   * equipment changed it. What the keys mean here:
   *
   *   Shift / Ctrl   a VERTICAL SPEED, not a lever. Shift climbs at `climb`,
   *                  Ctrl comes down at `descend`, and letting go holds the
   *                  height you are at. Taking off is holding Shift; landing
   *                  is holding Ctrl. The descent eases from `descend` to
   *                  `landSlow` over the last `landBand` metres above the
   *                  skids, so holding Ctrl all the way to the ground is a
   *                  gentle landing and not a crash.
   *   W A S D        an ATTITUDE: the machine tilts to `tiltMax` and no
   *                  further — total tilt, both axes together — and when you
   *                  let go it flies itself level, brakes to a stop and holds
   *                  that spot over the ground.
   *   A / D at speed also steer: past `turnHi` over the ground they turn the
   *                  nose like a car, and the lateral hold keeps the flight
   *                  path on the nose.
   *   Q / E          a yaw RATE. Let go and it stops and holds the heading.
   *
   * It moves the rotor's controls, exactly as the hover assist does, and the
   * rotor, the wind, the weight on the winch and the ground are all still the
   * real flight model. It is not a camera on a rail.
   */
  kid: {
    climb: 4.5, // m/s up, Shift held
    descend: 3.0, // m/s down, Ctrl held
    landSlow: 0.5, // m/s at the skids
    landBand: 6, // metres above the skids over which the descent eases off
    landFloor: 1, // m: below this it is at landSlow
    liftDead: 0.15, // of the spring-centred lift command
    // Vertical speed loop. 2.2/s is a 0.45 s response; the integrator mops up
    // what the model inversion does not know about (rotor drag in a climb,
    // the tiny wing, a winch load arriving).
    vK: 2.2,
    // Integrated only while the error is under a metre and a half a second,
    // and small. At 0.9 and wound through the whole of a climb it made the
    // capture ring: +4.8 m/s released, down to -1.0 m/s a second later.
    vI: 0.35,
    vIMax: 0.8,
    aMax: 3.0, // m/s^2 of vertical acceleration it may ask for
    collRate: 3.0, // /s: the fastest the computer may move the collective
    hP: 0.8, // 1/s: height error to vertical speed while holding
    // Capture where it is GOING to stop, not where it is: the stopping
    // distance at this much deceleration. Released from a 4.8 m/s climb the
    // held height is 4.8 m above the key-up point, and it arrives there
    // without going past.
    holdDecel: 2.4,
    tiltMax: 0.314, // 18 degrees, total, both axes together
    velK: 0.75, // 1/s: velocity error to acceleration
    /*
     * The wind lean, learned — and ONLY while slow. Wound during a stop from
     * cruise it learned the braking as if it were wind: measured, braking
     * from 23 m/s filled the whole 11 degrees of lean and the spot hold then
     * rocked +-13 degrees and +-3 m/s for twenty seconds unwinding it.
     */
    velI: 0.18, // 1/s^2
    leanMax: 1.9, // m/s^2 the wind lean may hold (11 degrees, a 30 kt wind)
    /*
     * ...and only once the spot has been held, settled, for leanAfter
     * seconds. Winding it whenever the stick was centred and the machine
     * slow learned the glide after every tap as if it were wind: measured,
     * a tap of D every two seconds towards a spot 19 m away walked the
     * machine steadily AWAY from it, 0.6 m/s the wrong way, for as long as
     * the taps went on. A child nudging over a winch circle does exactly that.
     */
    leanAfter: 3, // s
    leanWithin: 3, // m of the spot
    posK: 0.4, // 1/s: position error to velocity while holding the spot
    posVmax: 3, // m/s: the fastest it will walk back to the spot
    capture: 1.2, // m/s over the ground below which it takes the spot
    keepLift: 6, // m/s: below this, a lift over high ground is kept (see the floor)
    grefDown: 8, // s: how slowly, at speed, the held height follows the ground down
    liftHold: 2, // s: after a lift, how long before the hold may bring it back down
    // s: a press shorter than this, in the hover, is a tap. Measured on the
    // stick, which the input smoother holds over the dead band for about
    // 0.2 s after the key comes up: a 0.4 s press is 0.6 s of stick.
    tapMax: 0.7,
    nudge: 1.2, // m: how far one tap moves the spot it holds
    backMax: 8, // m/s: the fastest S will fly it backwards
    slideMax: 10, // m/s: the fastest A/D will slide it sideways in the hover
    stickDead: 0.08,
    yawRate: 0.785, // 45 deg/s at full pedal
    /*
     * A/D at speed: how fast the nose turns. The rotor can only bend the
     * flight path at g*tan(18 deg), 3.2 m/s^2, so a fixed 20 deg/s at 50 m/s
     * left the path so far behind the nose that the machine skated sideways
     * and bled off to 9 m/s. So it is a turn the path can nearly follow —
     * turnAccel / speed — between turnMin and turnRate: 20 deg/s below
     * 13 m/s, 7 deg/s at 50.
     */
    turnRate: 0.35,
    turnMin: 0.12,
    turnAccel: 4.5,
    // Forward speed (not groundspeed: sliding sideways is not cruising) at
    // which A/D hands over from sliding to steering.
    turnLo: 4,
    turnHi: 10,
    /*
     * Rising ground, roofs and sea stacks ahead. Two probes along the flight
     * path, near and far; keep this much air under the skids per m/s of
     * groundspeed over 3 m/s; and if the far one is higher than the climb
     * can reach before getting there, slow down until it can. Every summit
     * pad on The Stacks is 170-255 m up and a child flies at the beacon at
     * whatever height they happen to be.
     */
    lookNear: 1.5, // s
    lookFar: 3.5, // s
    lookFarMin: 60, // m
    // ...and never nearer than it takes to stop. Measured with the far probe
    // at 3.5 s alone: at 60 m/s it saw Gannet Stack 210 m out, the stop takes
    // ~360 m, and the rotor hit the rock at 64 m up. So the far probe is at
    // least the braking distance at this deceleration, plus a margin, and the
    // highest ground it has seen is REMEMBERED until the machine is past it —
    // a probe that has swept over the summit to the sea behind it must not
    // conclude the rock has gone.
    brakeDecel: 3.5,
    brakeMargin: 40,
    /*
     * How far below the floor it may be and still move towards it. At zero,
     * a machine hovering a few centimetres under the floor beside a roof —
     * which is where the floor holds it — was not allowed to move towards the
     * roof at all: measured, Last Light, W held beside St Brendan at 75.1 m
     * under a 75.2 m floor, vAllow 0, and the H 12 m away was unreachable for
     * a minute and a half. The floor lifts the last metre in about a second.
     */
    needSlack: 1,
    soonS: 10, // s: how far ahead in time it starts climbing for high ground
    /*
     * How fast the computer itself may climb for ground ahead: 8 m/s, not the
     * 4.5 a child gets on Shift (full lever is about 13). Measured at 4.5:
     * crossing Port Kestrel to Needle Rock the machine braked from 50 m/s to
     * about 1 m/s twice and crept up the slopes for 45 s and 60 s, which is
     * safe and is also a child sitting and watching nothing happen.
     */
    terrainClimb: 8,
    /*
     * The sea is not a landing site. Measured on the first kid build: Ctrl
     * held over open water brought it down at a perfect 0.4 m/s and the
     * touchdown was "You flew into the sea". A child holding Ctrl has asked
     * to land, and there is nowhere here to do it, so the computer stops
     * this far above the waves and the panel says why.
     */
    seaFloor: 3,
    /*
     * Ground beside the machine, not only under it. Measured: holding Ctrl
     * beside the flank of Gannet Stack, the skids were 27 m above the rock
     * under them and the nose went into the rock in front — "The propeller
     * struck the ground". So the ground under the nose, the tail and both
     * sides is sampled, and none of those points is let within `sideClear`
     * of it — but only where that ground stands `sideStep` above what the
     * skids would touch, so a gentle slope still lands.
     *
     * CORRECTION, measured 2026-09-25: "a gentle slope still lands" was not
     * true. With 0.8 m of clearance on points hung up to 7 m ahead, and
     * compared with the ground under the MAST rather than under the skid
     * that touches first, a rise of 0.11 m seven metres ahead — a 1.6% slope
     * — was enough to refuse a landing. In the browser, Free Flight, Ctrl
     * held for seventy seconds on the grass west of Kestrel's pad (a 6
     * degree slope) hovered at 1.35 m saying TOO CLOSE TO THE GROUND. Now the
     * points are the airframe's own SPEC.hardPoints, held level, against the
     * height at which the first SKID touches, with 0.2 m to spare, and each
     * point is also sampled `sideLead` seconds along the drift, which is what
     * the 7 m point was standing in for on the stacks' jagged flanks.
     */
    sideClear: 0.2,
    sideLead: 0.8,
    skidStep: 0.6, // m: the most the ground may differ between the skids
    boxPad: 5, // m: how wide a deck or a building counts, round its edges
    treePad: 1.5, // m: and a tree
    clearPerMs: 0.6,
    clearMax: 22,
    /*
     * The skids go down only when the machine has stopped and nobody is on
     * the stick. Measured on the first kid build, 2026-09-24: W and Ctrl held
     * together from a 30 m cruise flew it into the grass at 35.5 m/s — "The
     * propeller struck the ground" — and from a 3 m hover W+Ctrl, S+Ctrl and
     * Q+W+Ctrl all ended the same way, nose or tail first, at 3.7-5.6 m/s.
     * A child flying at an H holds both keys; that is what "go there and come
     * down" means on a keyboard. So below `gateH` over the surface the
     * descent is refused while the machine is sliding faster than `landGs`
     * or a W A S D key is down, and the panel says to let go.
     */
    landGs: 2.5, // m/s over the ground
    gateH: 2.5, // m of air under the skids it keeps until then
    /*
     * And the tilt near the ground. At the full 18 degrees the nose hangs
     * 1.16 m lower than level (it is 3.74 m ahead of the mast) and the tail
     * 1.75 m lower (5.68 m behind it), against 1.69 m from the mast to the
     * skids — so eighteen degrees with the skids under a metre up puts the
     * nose or the tail into the ground first. The limit runs from 6 degrees
     * at the skids to the full 18 at `lowTiltFull` metres.
     */
    lowTiltMin: 0.105, // 6 degrees
    lowTiltFull: 4, // m
    /*
     * How hard the pedal brakes a turn when Q or E is let go, 1/s, on top of
     * the airframe's own yaw damping. Measured at 2.5: E held one second or
     * three, let go, and the nose ran on another 12.7-13.0 degrees before it
     * stopped. See the heading block in kidFly().
     */
    yawBrake: 7,
    /*
     * The turn, beside a hill. sideGuard() asks about the heading the
     * machine is ON, and a turn swings the tail (5.7 m behind the mast) and
     * the nose (3.7 m ahead) round at 45 deg/s — 4.5 m/s at the tail. Beside
     * a 64-degree cliff that is ground rising under the tail at 9.6 m/s,
     * faster than the floor can lift anything. Measured 2026-09-26 in
     * headless Chrome, Kestrel, kid mode, at the review's three cliff spots
     * (1128,942 / 770,1481 / -1660,-1166): Ctrl parked it 6-11 m up at TOO
     * STEEP THIS WAY — whose words were "Turn with Q or E" — and E or Q,
     * with Ctrl or without, or E from an 8 m hover, crashed 9 of 12 tries in
     * 0.9-4.5 s, "The tail struck the ground" or "The propeller struck the
     * ground", having climbed 0-1.2 m.
     *
     * So while it is turning, or asked to, the floor is also taken over the
     * next `yawLook` degrees of the turn, level, at half and full. Where that
     * is higher than the floor it has now, the turn slows from full rate
     * `yawGapHi` above it to nothing `yawGapLo` above it, and — only while a
     * key is asking for the turn — it climbs to `yawGapHi` over it. It goes
     * up, then round; it never swings anything into the hill. Skipped more
     * than `yawSkip` over the floor: thirty degrees of swing moves the tail
     * 2.9 m, which on the steepest rock on these maps is under 9 m of rise.
     */
    yawLook: 30, // degrees
    yawGapLo: 0.3, // m
    yawGapHi: 1.5, // m
    yawSkip: 10, // m
    /*
     * Any key beside steep rock. With the turn guard above in, 15 spots on
     * Kestrel of 27 to 68 degrees (seed 99, headless Chrome, 2026-09-26),
     * Ctrl down to the card and then E with Ctrl, Q, D, A, and 30 s of
     * random keys: no crash from any turn. One crash, from Q, D and Ctrl held
     * together at (1863, -1534), 63 degrees: the turn stopped as it should,
     * but the machine was coming down at 2.9 m/s, sliding sideways at 1-2 m/s
     * and turning, all at once, and the tip and then (in a second try with a
     * drift guard added to sideGuard) the tail went into the rock. Traced:
     * the collective was at its stop for the last 1.3 s — a rotor that finds
     * about 2.5 m/s^2 of climb cannot turn a 3 m/s descent round in the time
     * a sideways drift closes on 63 degrees of rock — and the attitude was
     * still 10-13 degrees nose-up from braking, which hangs the tail 1-1.3 m
     * lower. Every guard that looks a short way ahead of one part of the
     * machine was too late for some mixture of keys.
     *
     * So: whenever a key is down (W A S D Q E) or it is sliding faster than
     * `roomGs`, the ground is also taken round the whole circle `roomR` about
     * the mast — the tail is 5.7 m back, so every hard point on any heading is
     * inside it — `roomN` samples, `sideLead` along the drift. Where that
     * circle holds rock more than `roomSteep` m above the ground under the
     * skids, the machine goes straight up until its skids are `roomClear` m
     * over the highest of it, and only then moves or turns: the stick is
     * taken away while it is more than half of `roomBand` below that, and the
     * turn eases in over the band. Hands off and stopped, none of this — it
     * comes down beside the rock under the side guard, which never crashed.
     * On grass and gentle hills (under about 18 degrees the circle's far edge
     * is not 2 m up) it never switches on, so the hill card's turn, which
     * lands on up to 15 degrees, is as it was. Nor above `roomMaxGs`: flying
     * along, the probes ahead and the gate's height keep it off the hills
     * (see probeAhead and gateH), and a circle 6 m round a point 0.8 s ahead
     * would take W away from a child cruising low over a slope.
     */
    /*
     * roomSlide. CORRECTION, measured 2026-09-26: "every crash was under
     * 5 m/s" held for the probe that set it and not for the next one. Seed
     * 31337's cliff probe (15 spots of 25-68 degrees on Kestrel) crashed once:
     * at (793, 1222), 67.6 degrees, Q, D and Ctrl held together spiralled the
     * machine until it was sliding TAIL-first at the rock at 5.0-5.3 m/s,
     * coming down. Traced: the circle was off for being over 5 m/s, came on
     * at 4.8 once the brake had started, and "The tail struck the ground"
     * 1.2 s later. Flying nose-first the probes ahead look where the machine
     * is going and the child is looking there too; sliding, backing or
     * spiralling, the tail or a tip leads and neither does. So the circle is
     * taken at any speed while the forward speed is under `turnLo` — S and
     * A/D in the hover top out at backMax and slideMax anyway — and only
     * W's cruise keeps the 5 m/s limit.
     */
    roomR: 6.2, // m
    roomN: 12,
    roomSteep: 2, // m
    roomClear: 1, // m
    roomBand: 1, // m
    roomGs: 1, // m/s
    roomMaxGs: 5, // m/s, nose-first; see roomSlide
    /*
     * roomHold. Measured 2026-09-26 in the node harness (the flight model,
     * input layer and kid computer stepped as main.js steps them, no
     * renderer): with roomSlide and brakeTilt in, 300 cliff runs (five seeds
     * of 15 spots of 25-72 degrees on Kestrel, four winds) still crashed 8
     * times, all tail or tip first, all with Ctrl held — Q+D+Ctrl 7, S+Ctrl
     * 1. Traced at (-988, 1133), 62.8 degrees: Ctrl was bringing it down at
     * 3.4 m/s while D slid it backwards at the face, the circle's rock was
     * still 5 m under the skids, and half a second later it was over them;
     * the tail went in 1.7 s after that with the climb only just started.
     * Coming down is what closed the gap. A pilot does not come down while
     * moving about beside rock, so: while the circle holds steep rock and a
     * key is down or it is sliding, it holds its height at least. Landing
     * is hands off (the gate waits for that anyway), so Ctrl alone still
     * comes down beside it under the side guard.
     */
    /*
     * THE WALL. Rock beside the machine at its own height, the way it is
     * going. Measured 2026-09-26 in the node harness on The Stacks: from 45 m
     * off the middle of each sea stack, 20, 50 and 90 m over the water, W, S
     * or D held for 15 s at the stack — nose, tail or side first — and then
     * 20 s hands off, in a calm, crashed 47 of 86 runs on b1d130b (four more
     * starts were inside the rock and are not counted): S and D nearly every
     * time, "The tail struck the ground" / "The right wing tip hit the
     * ground". Traced at Gannet Stack, 50 m, S: the face was 9 m behind the
     * mast; the side guard and the circle do not run 40 m over the surface
     * under the skids, which here is the sea; the probes ahead look from 15 m
     * out and only once it is doing 2 m/s; and the brake they ask for is the
     * gentle stopping loop. The tail hit 3.2 s after S went down, at 3 m/s.
     *
     * So a face beside a hover is looked for from the point of the machine
     * that leads (tail, tip, nose or skid, at the attitude it has), at the
     * height of its lowest point: the first of the samples WALL_S beyond it
     * where the ground stands higher than that is the wall. It may close on
     * the wall at `wallRate` per metre of room left over `wallMargin` — the
     * last metres as slow as the first, because the attitude loop takes over
     * a second to swing a lean round and a stopping-distance limit (tried
     * first, 2 m/s^2 after 0.6 s) overran it into the rock. The limit is a
     * cap on the lean towards the wall (`wallK`, less the wind's measured
     * push), so the key eases off before the limit rather than the brake
     * catching up after it. Stopped within `wallStop` of it, a key pushing
     * that way does nothing (the card says ROCK IN THE WAY); every other way
     * still works, and so does Shift. At any height; only in the hover and
     * slide regime, where the probes ahead do not look (see roomSlide).
     * With it: 0 of 86 in a calm, 12 kt from 140 and 20 kt from 020.
     */
    wallRate: 0.5, // (m/s) per metre of room
    wallMargin: 1.5, // m
    wallK: 1.2, // 1/s
    wallStop: 0.5, // m
    wallBelow: 0.3, // m under the lowest point still counts as clear
    wallNearR: 25, // m
    /*
     * brakeTilt. The tilt near the ground is limited by the lower of the
     * height under the skids and the guard's gap (see lowTiltMin), because
     * tilting swings a hard point down. In the same trace, with the tail a
     * few metres off the rock the guard's gap was 0.6 m, so the tilt limit
     * was the 6-degree minimum and the brake could take 1 m/s^2 off a
     * 5 m/s slide at the face: 4.8 m/s to 3.4 m/s in the last second. But
     * braking tilts the machine AWAY from where it is going, which lifts the
     * side nearest what it is closing on. So while it is braking for ground
     * ahead (the probes' speed limit, or the circle with its highest rock
     * the way it is going), the braking part of the tilt may take the limit
     * for the height under the skids alone; anything across the brake keeps
     * the lower one. See the tilt limit in kidFly().
     */
    /*
     * And the hill card is honest about which way round lands. It said "turn
     * with Q or E" wherever the hillside was what refused the landing, and
     * on anything much over 15 degrees no heading lands at all (see the
     * slope table in sideGuard): measured by the review, E held for 15 s
     * (656 degrees) on slopes of 15.3-32 degrees ended still on TOO STEEP.
     * So when the hill refuses it, `ring` headings round the circle are asked
     * the same question, `ringPer` at each guard tick (sixteen take 0.1 s),
     * and the card says turn with E, turn with Q — whichever is the shorter
     * way to one that lands — or that no way round lands here. Asked again
     * when it has moved `ringMove` metres.
     */
    ring: 16,
    ringPer: 4,
    ringMove: 1.5, // m
    /*
     * Coming down from high up. `descend` is 3 m/s at every height, which is
     * right for the last few metres and slow from the top of a climb: the
     * review measured Shift held 60 s to 270 m, then Ctrl took 94 s to land.
     * So it comes down at up to `descendHigh` when the skids are
     * `descendHighAt` metres up, easing to `descend` by `descendLowAt`. The
     * guard beside and below runs whenever Ctrl is held (not only under
     * 40 m), so a town block's roof under a fast descent is seen 3 s ahead
     * and the descent brought down to 0.8 m/s per metre of gap, as it is low.
     */
    descendHigh: 7, // m/s
    descendHighAt: 60, // m
    descendLowAt: 15, // m
    // The hard stop. Past this the stick is ignored and the machine is put
    // back level, whatever anything else is asking for.
    guard: 0.436, // 25 degrees
    /*
     * Top speed. At eighteen degrees the realistic airframe runs out at
     * 46.3 m/s (measured, W held a minute) because its rotor drag is 130 N
     * per m/s and its blade stall starts at 46 m/s — 89 kt, a slow machine.
     * A light single-engine helicopter cruises nearer 60 m/s at well under
     * eighteen degrees. Kid mode flies with 72% of the rotor drag and the
     * stall moved to 62 m/s, which tops out near 60 at full forward tilt;
     * realistic keeps both numbers exactly as they were.
     *
     * That is over flat ground or the sea (55.3 m/s after 45 s of W, flying
     * east from the Kestrel start). Over hills the ground-ahead brake holds
     * it to what the climb can out-run: the review of the first kid build
     * measured 40.5 m/s after 55 s of W heading 158, into the Kestrel hills.
     * That is the brake working, not the top speed; see probeAhead().
     */
    dragScale: 0.72,
    stallAt: 62,
  },
};

/**
 * Rotor thrust as a multiple of the empty machine's weight at sea level, for a
 * collective of 0..1. Two straight lines: 0 -> 0, 0.5 -> 1, 1 -> maxLift.
 * physics.js builds the force from this and the kid computer inverts it, so
 * they cannot disagree about what the collective does.
 */
export function rotorLiftRatio(c) {
  return c <= 0.5 ? c * 2 : 1 + (c - 0.5) * 2 * (ROTOR_TUNE.maxLift - 1);
}

/** The collective that makes a lift ratio. The inverse of rotorLiftRatio. */
export function collectiveForLift(r) {
  if (r <= 1) return clamp(r * 0.5, 0, 0.5);
  return clamp(0.5 + (r - 1) / (2 * (ROTOR_TUNE.maxLift - 1)), 0.5, 1);
}

/**
 * Where the pilot's lever puts the blades: the lever's idle-to-full map, at
 * the rotor's own collSpool rather than the engine's spool. `rpm` caps it, so
 * a stopped engine still means a stopped rotor.
 */
function leverCollective(ac, S, dt) {
  const T = ROTOR_TUNE;
  const want = ac.engineOn ? T.leverIdle + clamp(ac.controls.throttle, 0, 1) * (1 - T.leverIdle) : 0;
  S.lever += (want - S.lever) * Math.min(1, dt * T.collSpool);
  return ac.engineOn ? S.lever : Math.min(S.lever, ac.rpm);
}

/** Is this machine being flown by the kid computer? */
export function isKidMode(ac) {
  return ac.mode === 'simplified' && ac.hoverAssist !== false;
}

/*
 * Two of the Aircraft's own rules, taught what a helicopter is.
 *
 * Both rules are written in physics.js for aeroplanes, in code that is not
 * the rotor's, so rather than branch inside it the helicopter's version is
 * put in front of it here, on this one Aircraft, once. Each wrapper asks
 * S.rotor — set by rotorAssist() on every helicopter step and cleared by
 * physics.js on every other — and otherwise hands straight through, so an
 * aeroplane gets exactly the method it always had.
 *
 *   gradeTouchdown  A helicopter lands on an H, not on a centreline, and at a
 *                   walk, not at 62 kt. Measured 2026-09-25 on the unmodified
 *                   rules: a 90 ft/min vertical touchdown scored 33/100 "not
 *                   on the runway", and one on the middle of St Brendan's H
 *                   was scored by its distance from runway 09's centreline.
 *                   See rotorTouchdown().
 *
 *   stopEngine      In kid mode the engine key does nothing in the air.
 *                   Measured on the first kid build: I pressed in a 23.7 m
 *                   hover stopped the engine, and 2.5 s later it hit the
 *                   ground at 17.4 m/s, "You came down far too fast" — from
 *                   one key, which the card itself advertises ("Press I to
 *                   start the engine"). A real engine-off landing is an
 *                   autorotation, which the kid computer does not fly; so in
 *                   kid mode the key is refused until the skids are down and
 *                   the card says why for three seconds (S.keptEngine). Only
 *                   the key: running out of fuel, a failure, a mission that
 *                   kills the engine and realistic mode all stop it exactly
 *                   as before.
 */
function hookAircraft(ac, S) {
  S.hooked = true;
  if (typeof ac.gradeTouchdown === 'function') {
    const grade = ac.gradeTouchdown;
    ac.gradeTouchdown = function gradeTouchdownRotor(vsFpm, bank, centreline) {
      const g = grade.call(this, vsFpm, bank, centreline);
      if (S.rotor && g) rotorTouchdown(this, S, g);
      return g;
    };
  }
  if (typeof ac.stopEngine === 'function') {
    const stop = ac.stopEngine;
    ac.stopEngine = function stopEngineRotor(reason = 'shutdown') {
      if (reason === 'shutdown' && S.rotor && S.kidOn && this.engineOn && !this.onGround && !this.crashed) {
        S.keptEngine = 3;
        return;
      }
      return stop.call(this, reason);
    };
  }
}

/**
 * Re-score a helicopter's touchdown, in place. The crash tests, the quality
 * words and the sink rate are the aeroplane's and are kept; what changes is
 * WHERE counts and what "centred" and "slow enough" mean:
 *
 *   - on an H is inside any pad's painted circle at the pad's own height,
 *     or on any deck. pads.js registers a ground pad as a platform only
 *     where the ground is dead level; measured 2026-09-25, every pad on the
 *     seven helicopter maps is one today, so this and platformAt() agree —
 *     the circle is asked first because it is the H the child can see;
 *   - centred is the distance from the H's middle, and that distance is what
 *     `centreline` then reports;
 *   - the speed wanted is none (under 3 m/s over the ground scores);
 *   - open grass is a fair place to put a helicopter down: 0.85, not half.
 *
 * Same weights as physics.js: 52 smooth, 20 centred, 16 level, 12 speed.
 */
function rotorTouchdown(ac, S, g) {
  const x = ac.pos.x;
  const z = ac.pos.z;
  const skidY = ac.pos.y - (S.skidOff != null ? S.skidOff : 1.69);
  let d = Infinity;
  let half = 0;
  for (let i = 0; i < PADS.length; i++) {
    const p = PADS[i];
    const dd = Math.hypot(x - p.pos.x, z - p.pos.z);
    if (dd <= p.r && dd < d && Math.abs(skidY - p.pos.y) < 2) {
      d = dd;
      half = p.r;
    }
  }
  if (d === Infinity) {
    const q = platformAt(x, z);
    if (q) {
      d = Math.hypot(x - q.cx, z - q.cz);
      half = Math.max(q.hw, q.hd);
    }
  }
  const onPad = d !== Infinity;
  const smooth = clamp(1 - Math.abs(g.vsFpm) / 700, 0, 1);
  const centred = onPad ? clamp(1 - d / Math.max(4, half), 0, 1) : 0.6;
  const level = clamp(1 - Math.abs(g.bank) / 18, 0, 1);
  const speedOk = clamp(1 - ac.groundSpeed / 3, 0, 1);
  const score = Math.round((smooth * 52 + centred * 20 + level * 16 + speedOk * 12) * (onPad ? 1 : 0.85));
  g.onRunway = onPad;
  if (onPad) g.centreline = Math.round(d * 10) / 10;
  g.score = clamp(score, 0, 100);
  g.onPad = onPad;
  return g;
}

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Loop gains solved for a natural frequency and damping ratio, from the
// acceleration a unit of control buys (A) and the damping already there (D).
function gainP(wn, A) {
  return (wn * wn) / A;
}
function gainD(wn, D, A) {
  return Math.max(0, (2 * ROTOR_TUNE.zeta * wn - D) / A);
}
// How much of the assist survives the pilot's own input on that axis.
function handsOff(x) {
  return 1 - clamp((Math.abs(x) - ROTOR_TUNE.stickDead) / ROTOR_TUNE.stickBand, 0, 1);
}

/**
 * How much of the assist applies at this ground speed. 1 in the hover, 0 in
 * the cruise. Exported because physics.js needs the same number to fade the
 * aeroplane wing leveller OUT as this fades IN, or the two loops argue in the
 * 20-45 kt band and the machine wallows.
 */
export function hoverAuthority(groundSpeed) {
  return 1 - smoothstep(ROTOR_TUNE.fadeLo, ROTOR_TUNE.fadeHi, groundSpeed);
}

/**
 * Run the assist for one step.
 *
 * Writes four control deltas into a reused object and returns it, and hangs
 * the readouts the hover HUD needs off `ac.rotor` — the drift in the pilot's
 * own fore/aft and left/right sense, the total collective including whatever
 * the assist is adding, and where the hover point sits on that scale. The HUD
 * must not have to recompute any of this; it is all here already.
 *
 * The caller adds `cyclicPitch`, `cyclicRoll` and `pedal` to the pilot's stick
 * and `collective` to the pilot's lever. It never replaces them.
 */
export function rotorAssist(ac, SPEC, dt) {
  const T = ROTOR_TUNE;
  const S =
    ac._rotorAssist ||
    (ac._rotorAssist = {
      cyclicPitch: 0,
      cyclicRoll: 0,
      pedal: 0,
      collective: 0,
      heldAGL: null,
      heldHdg: null,
      still: 0,
      lastCmd: null,
      // Learned lean against a steady wind, radians, in world axes.
      trimX: 0,
      trimZ: 0,
      leanSaturated: false,
      lastRequest: 0,
      // Its own scratch vector. Borrowing _tmp is how the wind and the wheel
      // maths once ended up sharing one vector, and that bug is documented
      // three times in physics.js. One name, one owner.
      f: new THREE.Vector3(),
      // Where the pilot's lever has put the blades (see leverCollective), and
      // the total collective the blades actually get this step, assist and
      // all. physics.js reads `coll`; it no longer reads rpm for this.
      lever: 0,
      coll: 0,
      // rotorLiftRatio(coll): the rotor's thrust over the machine's weight.
      // physics.js builds the lift from this and no longer imports the curve.
      lift: 0,
      // True while the kid computer is flying it. physics.js then takes the
      // cyclic and pedal below as the rotor's controls outright rather than
      // adding them to the stick.
      kidOn: false,
      kid: null,
      // True while this Aircraft is a rotorcraft: set here every step, and
      // cleared by physics.js on every step it is not. See hookAircraft().
      rotor: true,
      hooked: false,
      // Seconds left of "the engine stays on in the air" on the card.
      keptEngine: 0,
    });
  S.rotor = !!SPEC.rotor;
  if (!S.hooked) hookAircraft(ac, S);

  S.cyclicPitch = 0;
  S.cyclicRoll = 0;
  S.pedal = 0;
  S.collective = 0;

  /*
   * A new flight. ac.reset() zeroes both the airborne and the ground clocks,
   * and nothing else ever has both at zero — after one step one of them is
   * counting. Every held height, held spot and learned lean belongs to the
   * flight it was learned on: carried over, a position hold from the last
   * mission drags the machine back across the map towards where it was.
   */
  if (ac.airborneTime === 0 && ac.groundTime === 0) {
    S.heldAGL = null;
    S.heldHdg = null;
    S.still = 0;
    S.lastCmd = null;
    S.trimX = 0;
    S.trimZ = 0;
    S.leanSaturated = false;
    S.lastRequest = 0;
    S.kid = null;
    S.lever = ac.engineOn ? T.leverIdle + clamp(ac.controls.throttle, 0, 1) * (1 - T.leverIdle) : 0;
  }

  /*
   * Ground-referenced drift, in the machine's own fore/aft and left/right
   * sense — and referenced to the HORIZON, not to the tilted body. A banked
   * helicopter's body axes are tilted, so body-frame velocity would tell the
   * pilot they were sliding downwards, which is true and useless. What the
   * drift cross has to show is movement over the GROUND relative to where the
   * nose is pointing, which is the heading frame.
   */
  const f = ac.forward(S.f);
  let fx = f.x;
  let fz = f.z;
  const fl = Math.hypot(fx, fz);
  if (fl > 1e-4) {
    fx /= fl;
    fz /= fl;
  } else {
    // Pointing straight up or straight down. Rare, but atan2 of nothing is
    // nonsense and a NaN here would poison the whole control loop.
    fx = 0;
    fz = -1;
  }
  // right = forward x up, which for (0,0,-1) gives (1,0,0) as it must.
  const driftFwd = ac.vel.x * fx + ac.vel.z * fz;
  const driftRight = ac.vel.x * -fz + ac.vel.z * fx;

  S.kidOn = !!SPEC.rotor && isKidMode(ac);
  if (S.kidOn) {
    kidFly(ac, SPEC, dt, S, f, fx, fz, driftFwd, driftRight);
    S.lift = rotorLiftRatio(clamp(S.coll, 0, 1));
    return S;
  }
  S.kid = null;
  S.keptEngine = 0;
  const lever = leverCollective(ac, S, dt);

  const auth = ac.hoverAssist === false ? 0 : hoverAuthority(ac.groundSpeed);
  const live = !!SPEC.rotor && auth > 0.01 && ac.engineOn && !ac.crashed;

  /* ---------------------------------------------------------- height --- */
  /*
   * Height hold. Three integrators become one.
   *
   * It engages when the pilot has left the lever alone for a third of a
   * second AND is not already going up or down quickly — that second test is
   * what stops it fighting a deliberate climb held on a touch slider, where
   * a parked thumb looks exactly like no input at all.
   */
  const cmd = ac.controls.throttle;
  /*
   * Subtract the assist's OWN trim from the movement it sees, or it mistakes
   * its own hand on the lever for the pilot's and disengages permanently.
   *
   * This cost an afternoon. With the trim follow-up switched on, the height
   * hold never captured again after the first tap: the follow-up moved the
   * lever, the movement test saw the lever move, and the assist concluded the
   * pilot was flying. Measured, tapping down every four seconds from 30 m:
   * the lever ran all the way to zero and the machine hit the ground at
   * 1,769 ft/min. A control loop that cannot tell its own output from its
   * input is not a control loop.
   */
  const selfMove = (S.lastRequest || 0) * dt;
  const moving = S.lastCmd === null || Math.abs(cmd - S.lastCmd - selfMove) > T.cmdMoving * dt;
  S.lastCmd = cmd;
  if (moving || ac.onGround || !live) {
    S.still = 0;
    S.heldAGL = null;
  } else if (S.heldAGL === null) {
    S.still += dt;
    if (S.still > T.captureDelay && Math.abs(ac.vs) < T.captureVS) {
      S.heldAGL = ac.agl + clamp(ac.vs, -4, 4) * T.captureLead;
    }
  }
  if (S.heldAGL !== null) {
    const settle = smoothstep(T.flareLo, T.flareHi, ac.agl);
    const err = ac.agl - S.heldAGL;
    S.collective =
      clamp(-err * T.hhP * settle - ac.vs * T.hhD, -T.hhClamp, T.hhClamp) * auth;
  }

  /* ------------------------------------------------- control authority --- */
  /*
   * Solve the gains from the moment the rotor can actually make, the way the
   * wing leveller does, rather than writing two constants that were tuned
   * once and will be wrong the moment anybody touches an arm or a mass.
   *
   * Note which inertia goes with which axis. physics.js integrates
   * alpha = (tx/Ixx, ty/Iyy, tz/Izz) and its own comment says X is PITCH, Y
   * is YAW and Z is ROLL — so pitch runs on Ixx and yaw runs on Iyy, which
   * reads wrong and is right. The rotor damping block in physics.js had these
   * two swapped, which made pitch 43% stiffer and yaw 30% floppier than they
   * were meant to be; that is fixed alongside this.
   */
  const coll = clamp(lever + S.collective, 0, 1);
  S.coll = coll;
  const disc = (0.35 + coll * 0.65) * SPEC.mass * G;
  const aRoll = Math.max(0.2, (disc * SPEC.rotorRollArm) / SPEC.Izz);
  const aPitch = Math.max(0.2, (disc * SPEC.rotorPitchArm) / SPEC.Ixx);
  const aYaw = Math.max(0.2, (disc * SPEC.rotorYawArm) / SPEC.Iyy);

  // gainP, gainD and handsOff are module functions now: written here as
  // arrow functions they were three new closures every physics step.

  /* ------------------------------------------------------- wind trim --- */
  /*
   * Wind up the trim while the assist is flying and the stick is centred;
   * bleed it away when it is not. Anti-windup is the saturation test on the
   * total demand further down — the integrator is frozen there rather than
   * here, because it is the TOTAL lean that runs out of room, not the trim.
   */
  const stickCentred =
    Math.abs(ac.controls.roll) < T.stickDead && Math.abs(ac.controls.pitch) < T.stickDead;
  if (live && stickCentred && !S.leanSaturated) {
    // The trim vector points the way the machine must LEAN, so it winds
    // against the drift: a persistent drift to the east asks for a lean to
    // the west, and once the lean matches the wind the drift stops and the
    // integrator stops winding, which is the whole trick.
    S.trimX -= T.trimGain * ac.vel.x * dt * auth;
    S.trimZ -= T.trimGain * ac.vel.z * dt * auth;
    const tm = Math.hypot(S.trimX, S.trimZ);
    if (tm > T.trimMax) {
      S.trimX *= T.trimMax / tm;
      S.trimZ *= T.trimMax / tm;
    }
  } else {
    const bleed = Math.max(0, 1 - T.trimBleed * dt);
    S.trimX *= bleed;
    S.trimZ *= bleed;
  }
  const trimFwd = S.trimX * fx + S.trimZ * fz;
  const trimRight = S.trimX * -fz + S.trimZ * fx;

  if (live) {
    /* ------------------------------------------------------- attitude --- */
    /*
     * Outer loop: how far to lean to kill the drift. Inner loop: hold that
     * lean. Two shallow loops in series are stable and one deep one is not,
     * which is the whole reason a hover is hard to fly and easy to stabilise.
     *
     * Signs, worked out once and then measured (see t3 in the notes):
     *   bank is positive right-wing-down, and a positive bank accelerates the
     *   machine to the RIGHT, so killing a rightward drift needs a negative
     *   bank. Bank rate is -omega.z, because +Z torque is left-wing-down.
     *   Pitch is positive nose-up and a nose-up attitude decelerates, so
     *   killing a forward drift needs a positive pitch. Pitch rate is +omega.x.
     */
    const bank = ac.bankAngleRad();
    const pitch = Math.asin(clamp(f.y, -1, 1));
    const propBank = clamp(Math.atan((-T.driftGain * driftRight) / G), -T.tiltMax, T.tiltMax);
    const propPitch = clamp(Math.atan((T.driftGain * driftFwd) / G), -T.tiltMax, T.tiltMax);
    /*
     * Signs, once, carefully, because getting one of these backwards gives a
     * machine that accelerates into the wind instead of holding against it:
     *   a positive bank is right-wing-down and accelerates RIGHT, so a drift
     *   to the right is killed by a NEGATIVE bank;
     *   a positive pitch is nose-up and decelerates, so a drift FORWARD is
     *   killed by a POSITIVE pitch.
     * The trim vector leans the way the machine must lean, so its rightward
     * component adds straight into the bank demand, and its forward component
     * subtracts from the pitch demand.
     */
    const rawBank = propBank + trimRight;
    const rawPitch = propPitch - trimFwd;
    const tgtBank = clamp(rawBank, -T.tiltTotal, T.tiltTotal);
    const tgtPitch = clamp(rawPitch, -T.tiltTotal, T.tiltTotal);
    // Anti-windup. Once the lean is at its stop the integrator must stop
    // winding, or a machine held against a wind it cannot beat spends the
    // next minute unwinding a trim it should never have accumulated. Read on
    // the NEXT step, which costs one frame of lag and keeps this a single
    // straight-line pass with no second guess at the tilt.
    S.leanSaturated = rawBank !== tgtBank || rawPitch !== tgtPitch;

    const wRoll = auth * handsOff(ac.controls.roll);
    if (wRoll > 0.001) {
      const kp = gainP(T.wnRoll, aRoll);
      const kd = gainD(T.wnRoll, T.dampRoll, aRoll);
      const bankRate = -ac.omega.z;
      S.cyclicRoll = clamp((tgtBank - bank) * kp - bankRate * kd, -1, 1) * wRoll;
    }

    const wPitch = auth * handsOff(ac.controls.pitch);
    if (wPitch > 0.001) {
      const kp = gainP(T.wnPitch, aPitch);
      const kd = gainD(T.wnPitch, T.dampPitch, aPitch);
      const pitchRate = ac.omega.x;
      S.cyclicPitch = clamp((tgtPitch - pitch) * kp - pitchRate * kd, -1, 1) * wPitch;
    }

    /* -------------------------------------------------------- heading --- */
    /*
     * Heading hold matters more than it sounds. Drift damping works in the
     * machine's own fore/aft sense, so a slow unnoticed yaw turns a stable
     * hover into a slow spiral: the assist keeps correcting a drift that is
     * rotating underneath it. Ten seconds is long enough for that to happen.
     * Holding the heading costs nine lines and removes the failure mode.
     *
     * `heading` is degrees and increases to the RIGHT. After the sign fix,
     * positive pedal yaws right, and yaw rate to the right is -omega.y.
     */
    const wYaw = auth * handsOff(ac.controls.yaw);
    if (wYaw > 0.001) {
      if (S.heldHdg === null && Math.abs(ac.omega.y) < 0.25) S.heldHdg = ac.heading;
      if (S.heldHdg !== null) {
        let e = ac.heading - S.heldHdg;
        while (e > 180) e -= 360;
        while (e < -180) e += 360;
        const kp = gainP(T.wnYaw, aYaw);
        const kd = gainD(T.wnYaw, T.dampYaw, aYaw);
        const yawRateRight = -ac.omega.y;
        S.pedal = clamp((-e * Math.PI) / 180 * kp - yawRateRight * kd, -1, 1) * wYaw;
      }
    } else {
      S.heldHdg = null;
    }
  } else {
    S.heldHdg = null;
  }

  /* -------------------------------------------------------- envelope --- */
  /*
   * See envPitchLo in ROTOR_TUNE. The pilot's stick is faded towards the
   * limit it is pushing at — never away from it, so recovering is always
   * full authority — and past the limit the machine is flown back. Done as a
   * correction added to the assist's output, because the caller adds that to
   * the stick: `-stick * (1 - fade)` is the stick scaled by `fade`.
   */
  if (SPEC.rotor && !ac.onGround && !ac.crashed) {
    const pitchNow = Math.asin(clamp(f.y, -1, 1));
    const bankNow = ac.bankAngleRad();
    const sp = clamp(ac.controls.pitch, -1, 1);
    const sr = clamp(ac.controls.roll, -1, 1);
    // Positive stick pitch is nose UP; positive stick roll is right wing DOWN.
    const towardP = sp > 0 ? pitchNow : -pitchNow;
    const towardR = sr > 0 ? bankNow : -bankNow;
    const fadeP = 1 - smoothstep(T.envPitchLo, T.envPitchHi, towardP);
    const fadeR = 1 - smoothstep(T.envBankLo, T.envBankHi, towardR);
    S.cyclicPitch -= sp * (1 - fadeP);
    S.cyclicRoll -= sr * (1 - fadeR);
    /*
     * Brake the rotation outwards across the band, and hands off, come back
     * to its near edge. See envArrest. Pitch rate is +omega.x (nose up);
     * bank rate is -omega.z (right wing down).
     */
    const sgP = pitchNow < 0 ? -1 : 1;
    const sgR = bankNow < 0 ? -1 : 1;
    const outP = Math.abs(pitchNow);
    const outR = Math.abs(bankNow);
    const rateOutP = sgP * ac.omega.x;
    const rateOutR = sgR * -ac.omega.z;
    if (outP > T.envPitchLo) {
      const band = smoothstep(T.envPitchLo, T.envPitchHi, outP);
      if (rateOutP > 0) S.cyclicPitch -= sgP * clamp(rateOutP * T.envArrest, 0, 1) * band;
      if (Math.abs(sp) < T.stickDead) {
        S.cyclicPitch -= sgP * clamp((outP - T.envPitchLo) * T.envReturn, 0, 0.6);
        // And the aeroplane's trim assist is not allowed to hold it out
        // there: see envTrimBleed. Trim adds to the elevator, + is nose up.
        if (ac.trim * sgP > 0) ac.trim *= Math.max(0, 1 - T.envTrimBleed * dt);
      }
    }
    if (outR > T.envBankLo) {
      const band = smoothstep(T.envBankLo, T.envBankHi, outR);
      if (rateOutR > 0) S.cyclicRoll -= sgR * clamp(rateOutR * T.envArrest, 0, 1) * band;
      if (Math.abs(sr) < T.stickDead) S.cyclicRoll -= sgR * clamp((outR - T.envBankLo) * T.envReturn, 0, 0.6);
    }
    const overP = Math.abs(pitchNow) - T.envPitchHi;
    if (overP > 0) S.cyclicPitch -= Math.sign(pitchNow) * clamp(overP * 4, 0, 1) + ac.omega.x * 0.4;
    const overR = Math.abs(bankNow) - T.envBankHi;
    if (overR > 0) S.cyclicRoll -= Math.sign(bankNow) * clamp(overR * 4, 0, 1) - ac.omega.z * 0.4;
  }

  /* -------------------------------------------------- readouts for HUD --- */
  const R = ac.rotor || (ac.rotor = {});
  R.kid = false;
  R.kidState = null;
  R.driftFwd = driftFwd;
  R.driftRight = driftRight;
  R.drift = Math.hypot(driftFwd, driftRight);
  R.hoverAuth = auth;
  R.assistOn = ac.hoverAssist !== false;
  R.assistActive = live && (S.heldAGL !== null || auth > 0.01);
  R.holdingHeight = S.heldAGL !== null;
  R.heldAGL = S.heldAGL;
  R.windTrimDeg = +((Math.hypot(S.trimX, S.trimZ) * 180) / Math.PI).toFixed(1);
  /*
   * What the assist would like the pilot's lever to do, in units of
   * controls.throttle per second. The caller applies it; this module does not
   * reach into the input layer, and the input layer does not know the flight
   * model exists. Divided by (1 - collFloor) because the lever travels 0 to 1
   * and the collective it commands travels collFloor to 1.
   */
  R.trimRequest =
    S.heldAGL !== null && !moving && live
      ? (S.collective * T.collBackDrive) / (1 - T.collFloor)
      : 0;
  S.lastRequest = R.trimRequest;
  R.collective = coll;
  R.collectivePilot = clamp(lever, 0, 1);
  publishHoverPoint(R, ac, SPEC);
  R.heightAbove = heightAboveSkids(ac, S, SPEC);
  R.vsTarget = null;
  R.holdingSpot = false;
  R.lift = 0;
  R.engineKept = false;

  S.lift = rotorLiftRatio(coll);
  return S;
}

/**
 * Where the collective has to sit to hold a hover right now, so the POWER
 * gauge can mark it and the gap above it IS the power margin. Rotor thrust is
 * rotorLiftRatio(collective) * m * g * (rho/rho0), so hover is wherever that
 * ratio equals the loaded weight over the density ratio.
 */
function publishHoverPoint(R, ac, SPEC) {
  const loaded = (SPEC.mass + (ac.extraMass || 0)) / SPEC.mass;
  R.hoverPoint = collectiveForLift(loaded / Math.max(0.3, ac.density / RHO0));
  R.powerMargin = 1 - R.hoverPoint;
  /*
   * The same mark on the LEVER's scale rather than the collective's, because
   * the touch slider and the POWER gauge are not the same 0-to-1.
   *
   * NOTE, measured 2026-09-23: this is on the collFloor scale, and the lever
   * has never travelled that scale — see the correction on collFloor. The
   * true hover lever is (hoverPoint - leverIdle) / (1 - leverIdle), 0.39 and
   * not 0.47. tests/selftest-three-games.js section 21 parks the unassisted
   * machine on THIS number and passes only because it is off-trim there (the
   * raw machine climbs about 5 m/s). Left as it was and labelled, because
   * making it true turns that check red for a reason that has nothing to do
   * with whether the assist works.
   */
  R.hoverLever = clamp((R.hoverPoint - ROTOR_TUNE.collFloor) / (1 - ROTOR_TUNE.collFloor), 0, 1);
}

/**
 * How far, in metres over the ground plan, the airframe's nearest hard point
 * would be from anything standing taller than a deck at height `y`, parked
 * level with the mast at (x, z) and the nose on `headingDeg`. For choosing
 * which way round to put a helicopter down on a pad, and whether the pad is
 * fit to start on at all. Not for the physics step: it walks the whole
 * obstacle list.
 *
 * Measured 2026-09-25 in headless Chrome: Free Flight on Kestrel starts on
 * the Cottage Hospital's roof pad, with a town block 7 m taller than the deck
 * standing 5.9 m west of the H's middle. Parked nose east, as it was in a
 * calm, the tail boom ended 0.2 m from that wall.
 */
export function parkingClearance(SPEC, x, y, z, headingDeg) {
  const h = (headingDeg * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const hp = SPEC.hardPoints;
  let best = Infinity;
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    if (o.y1 <= y + 0.5) continue;
    if (x < o.x0 - 20 || x > o.x1 + 20 || z < o.z0 - 20 || z > o.z1 + 20) continue;
    for (let j = 0; j < hp.length; j++) {
      const p = hp[j].pos;
      // Body -Z is forward and +X is right; right = forward x up = (-fz, fx).
      const px = x - fx * p.z - fz * p.x;
      const pz = z - fz * p.z + fx * p.x;
      const dx = Math.max(o.x0 - px, 0, px - o.x1);
      const dz = Math.max(o.z0 - pz, 0, pz - o.z1);
      best = Math.min(best, Math.hypot(dx, dz));
    }
  }
  return best;
}

/*
 * Where the Follow camera sits behind a helicopter parked on a pad, as
 * measured rather than as read off camera.js: in headless Chrome, 2.5 s after
 * Free Flight started on seven maps in four winds, it was 18.0-18.5 m from the
 * machine's centre and 6.1-6.3 m above it — 17 m back along the nose, the
 * rest up. The centre sits 1.7 m over the deck (the skids are at -1.69).
 */
const VIEW_BACK = 17;
const VIEW_UP = 6.2;
const VIEW_CENTRE = 1.7;
// How far round a building's box the sight line must stay. The drawn blocks
// are a little bigger than their boxes: measured below, the ray met the roof
// 2.4 m from a camera that was 0.9 m over the box top and 0.6 m inside its edge.
const VIEW_PAD = 1.2;
// The last few metres of the sight line are the pad itself, and the deck the
// skids stand on is not in the way of seeing them.
const VIEW_NEAR = 2.5;

/**
 * Can the Follow camera see a helicopter parked level on a deck at height `y`,
 * mast at (x, z), nose on `headingDeg`? True when the camera spot is out of
 * every building and the ground, and the sight lines from it to the machine's
 * centre and to its mast top pass clear of both. For choosing the Free Flight
 * start; it walks the obstacle list, so not for the physics step.
 *
 * Measured 2026-09-25 in headless Chrome (the reviewer's find, then mine):
 * Free Flight on Kestrel parked the Skyhook on the Cottage Hospital's roof pad
 * nose 157.5, which put the camera at (753.5, 80.3, 544.3) — 0.9 m above the
 * roof of the town block next door, whose box is x 730.8-754.1, z 544.2-564.2,
 * top 79.4. A ray from the camera to the machine met that roof 2.4 m out, and
 * the first thing a child saw was a grey slab with no helicopter in it, in
 * three winds out of seven. Nose 22.5 on the same pad: all five rays clear.
 */
export function chaseViewClear(x, y, z, headingDeg) {
  const h = (headingDeg * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const cx = x - fx * VIEW_BACK;
  const cz = z - fz * VIEW_BACK;
  const yc = y + VIEW_CENTRE;
  // camera.js never lets the camera below 2.2 m over the ground.
  const cy = Math.max(yc + VIEW_UP, heightAt(cx, cz) + 2.2);
  const x0 = Math.min(cx, x) - VIEW_PAD;
  const x1 = Math.max(cx, x) + VIEW_PAD;
  const z0 = Math.min(cz, z) - VIEW_PAD;
  const z1 = Math.max(cz, z) + VIEW_PAD;
  for (let pass = 0; pass < 2; pass++) {
    const ty = pass === 0 ? yc : yc + 1.6; // the centre, then the mast top
    const dx = x - cx;
    const dy = ty - cy;
    const dz = z - cz;
    const len = Math.hypot(dx, dy, dz);
    const n = Math.ceil((len - VIEW_NEAR) / 0.5);
    for (let i = 0; i <= n; i++) {
      const t = Math.min(i * 0.5, len - VIEW_NEAR) / len;
      const sx = cx + dx * t;
      const sy = cy + dy * t;
      const sz = cz + dz * t;
      if (sy < heightAt(sx, sz) + 0.3) return false;
      for (let j = 0; j < OBSTACLES.length; j++) {
        const o = OBSTACLES[j];
        if (o.x1 < x0 || o.x0 > x1 || o.z1 < z0 || o.z0 > z1) continue;
        if (
          sx > o.x0 - VIEW_PAD && sx < o.x1 + VIEW_PAD
          && sz > o.z0 - VIEW_PAD && sz < o.z1 + VIEW_PAD
          && sy > o.y0 - VIEW_PAD && sy < o.y1 + VIEW_PAD
        ) return false;
      }
    }
  }
  return true;
}

/** Metres between the skids and whatever is under them — sea, rock or deck. */
function heightAboveSkids(ac, S, SPEC) {
  if (S.skidOff == null) {
    let low = 0;
    for (const g of SPEC.gearPoints) low = Math.min(low, g.pos.y);
    S.skidOff = -low;
  }
  const ground = ac.pos.y - ac.agl; // heightAt() under the machine, last step
  return ac.pos.y - Math.max(0, ground) - S.skidOff;
}

/* ================================================================== *
 * THE KID COMPUTER
 * ================================================================== */

/**
 * The fastest it may close on something `d` metres ahead that it must climb
 * `need` metres to clear, with 12 m kept in hand for its own length: the
 * computer climbs for ground ahead at `terrainClimb`, and this counts on 70%
 * of that.
 *
 * CORRECTION, measured 2026-09-26: that counted on the climb from the moment
 * the rock was seen, and a machine coming down has to stop coming down
 * first. Kestrel, seed 31337 cliff probe, (793, 1222), 67.6 degrees: Q, D
 * and Ctrl held together slid it tail-first at the rock at 5 m/s while it
 * came down at 2.3-4.5 m/s, and with the vertical loop's `aMax` of 3 m/s^2
 * turning a 4.5 m/s descent into a 5.6 m/s climb takes 3.4 s, not none. So
 * a sink of `sink` m/s adds the time to stop it and the height lost while
 * it does. Level or climbing it is the same number as before.
 */
function allowedSpeed(K, d, need, sink) {
  const c = K.terrainClimb * 0.7;
  const t = (need + (sink * sink) / (2 * K.aMax)) / c + sink / K.aMax;
  return Math.max(0, d - 12) / t;
}

/**
 * The ground ahead, along the flight path: how high it is safe to be, and how
 * fast it is safe to go.
 *
 * One probe was not enough, and neither was two. Measured: lifting off the
 * Port Kestrel quay pad towards the cove, the cut face behind the quay rises
 * 140 m in 100 m — 55 degrees — and with the probes at 1.5 s and 3.5 s ahead
 * the machine crept up it at 3-5 m/s climbing 4.5 m/s, a 45-degree path
 * under a 55-degree slope, and put the rotor into the hillside at 180 m. So
 * the path is sampled at four distances out to the braking distance and the
 * speed is held to what out-climbs the STEEPEST of them, down to a stop: it
 * then climbs straight up until the way ahead is clear.
 */
function probeAhead(ac, S, k, K, gs, ux, uz, surfaceY) {
  const far = Math.max(K.lookFarMin, gs * K.lookFar, (gs * gs) / (2 * K.brakeDecel) + K.brakeMargin);
  const clear = S.skidOff + clamp((gs - 3) * K.clearPerMs, 1, K.clearMax);
  // Coming down now: the climb starts once that is stopped (allowedSpeed).
  const sink = Math.max(0, -ac.vel.y);
  // Forget the remembered rock once it is behind us or well off the path.
  if (k.wallY !== null) {
    const along = (k.wallX - ac.pos.x) * ux + (k.wallZ - ac.pos.z) * uz;
    const across = Math.abs((k.wallX - ac.pos.x) * -uz + (k.wallZ - ac.pos.z) * ux);
    if (along < 0 || across > 60 || ac.pos.y > k.wallY + K.clearMax + S.skidOff) k.wallY = null;
  }
  let top = surfaceY;
  let vAllow = Infinity;
  // Climb now only for ground it will reach within `soonS`; further out, the
  // speed limit alone keeps it safe. Measured without this: hovering at 6 m
  // beside the quay's cut face in First Light, a tap of W at 2 m/s saw the
  // 150 m hilltop 60 m away and lifted it clean out of the 4-11 m band.
  const soon = Math.max(20, gs * K.soonS);
  for (let i = 1; i <= 4; i++) {
    const d = i === 1 ? Math.max(15, gs * K.lookNear) : (far * i) / 4;
    const px = ac.pos.x + ux * d;
    const pz = ac.pos.z + uz * d;
    const h = Math.max(0, heightAt(px, pz));
    if (h > top && d <= soon) top = h;
    const need = h + clear - ac.pos.y;
    if (need > K.needSlack) vAllow = Math.min(vAllow, allowedSpeed(K, d, need, sink));
    if (i === 4 && h > surfaceY + 2 && (k.wallY === null || h > k.wallY)) {
      k.wallX = px;
      k.wallZ = pz;
      k.wallY = h;
    }
  }
  /*
   * Decks and roofs, tested as boxes against the flight path. A line of
   * point probes finds hills, which are wide; a hospital roof is 22 m across
   * and a kid flies at it "roughly". Measured: approaching St Brendan at
   * 25 m/s a few degrees off the pad's centre, the probes first touched the
   * roof 67 m out, too late to climb 30 m or to stop, and the nose went into
   * the side of the building. PLATFORMS is a dozen boxes; checking them all is
   * cheaper than one more heightAt() on Port Kestrel (14 us, measured).
   */
  for (let i = 0; i < PLATFORMS.length; i++) {
    const p = PLATFORMS[i];
    const rx = p.cx - ac.pos.x;
    const rz = p.cz - ac.pos.z;
    const half = Math.max(p.hw, p.hd);
    const along = rx * ux + rz * uz;
    if (along < -half || along > far + half) continue;
    if (Math.abs(-rx * uz + rz * ux) > half + 12) continue;
    const d = Math.max(0, along - half);
    if (p.y > top && d <= soon) top = p.y;
    const need = p.y + clear - ac.pos.y;
    if (need > K.needSlack) vAllow = Math.min(vAllow, allowedSpeed(K, d, need, sink));
  }
  /*
   * And buildings. They are obstacles, not ground, so heightAt() has never
   * seen them. Measured in the browser: On Call, bringing a casualty home to
   * St Brendan, the machine flew into one of Port Kestrel's town blocks —
   * the town round the hospital runs up to 200 m tall. 1,375 boxes on that
   * map, 1,304 of them tree trunks; everything whose top is below us by more
   * than the clearance is skipped on the first compare.
   */
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    if (o.y1 + clear < ac.pos.y) continue;
    const rx = (o.x0 + o.x1) * 0.5 - ac.pos.x;
    const rz = (o.z0 + o.z1) * 0.5 - ac.pos.z;
    const half = Math.max(o.x1 - o.x0, o.z1 - o.z0) * 0.5;
    const along = rx * ux + rz * uz;
    if (along < -half || along > far + half) continue;
    if (Math.abs(-rx * uz + rz * ux) > half + 12) continue;
    const d = Math.max(0, along - half);
    if (o.y1 > top && d <= soon) top = o.y1;
    const need = o.y1 + clear - ac.pos.y;
    if (need > K.needSlack) vAllow = Math.min(vAllow, allowedSpeed(K, d, need, sink));
  }
  if (k.wallY !== null) {
    const d = (k.wallX - ac.pos.x) * ux + (k.wallZ - ac.pos.z) * uz;
    if (k.wallY > top && d <= soon) top = k.wallY;
    const need = k.wallY + clear - ac.pos.y;
    if (need > K.needSlack) vAllow = Math.min(vAllow, allowedSpeed(K, d, need, sink));
  }
  k.floorY = top + clear;
  k.vAllow = vAllow;
}

// Obstacles near the machine this step, and one hard point. Module scratch.
const NEAR = [];
const HP = new THREE.Vector3();
/*
 * What sideGuard() last found in the way. `hill` is true when it was the
 * hillside itself — bare ground rising under a hard point, or the skids
 * straddling ground that falls away, with no deck, roof or tree involved.
 * `tree` is true when it was a tree: measured 2026-09-26, Kestrel, Ctrl held
 * at (1330, 1332) hovered 13 m up over a 5.4-degree slope saying "Something
 * under you is too high or not flat" — true, it was beside a 13 m trunk,
 * and the card can say so. `floor` is the lowest the centre may be with
 * nothing touching at all, skids included, which is what a turn has to stay
 * above (see yawAhead).
 * Module scratch, read straight after the call, so the guard stays one
 * number and allocates nothing.
 */
const GUARD = { hill: false, tree: false, floor: -Infinity };
const DEG = Math.PI / 180;

/**
 * The lowest the machine's centre may go without any hard point — nose,
 * tail, tips, belly — coming within `sideClear` of the ground, a deck or a
 * building under it, with the machine held level at this heading, as the
 * kid computer holds it. -Infinity when the skids would touch first, which
 * is a landing. See the correction on ROTOR_TUNE.kid.sideClear.
 *
 * `level`: place the hard points level on the heading (fx, fz) instead of
 * where the attitude has them now, which is how a heading the machine is
 * not yet on is asked about — the turn ahead, and the ring of headings the
 * hill card is chosen from.
 */
function sideGuard(ac, SPEC, K, fx, fz, calm, level = false) {
  const rx = -fz; // right = forward x up
  const rz = fx;
  /*
   * Coming straight down onto a deck, hands off, a building beside the deck
   * counts `treePad` round its edges and not `boxPad`. Measured 2026-09-25 in
   * headless Chrome, Free Flight on Kestrel: the start pad on the Cottage
   * Hospital roof has a town block 7 m taller than the deck standing 5.9 m
   * from the H's middle, and with every building counted 5 m wide the nose
   * (3.7 m ahead of the mast, 2.2 m from that wall) kept the machine 6.5 m
   * over the pad it had just lifted from, saying CAN'T LAND HERE, for as
   * long as Ctrl was held. boxPad is for a machine moving beside a roof
   * (see below); one sinking at a walk over a deck with nobody on the stick
   * has no tap to walk it into the wall, and the lead sample still covers
   * whatever it is drifting at.
   */
  let deck = false;
  if (calm) {
    for (let j = 0; j < PLATFORMS.length; j++) {
      const q = PLATFORMS[j];
      if (Math.abs(ac.pos.x - q.cx) <= q.hw && Math.abs(ac.pos.z - q.cz) <= q.hd && q.y < ac.pos.y) {
        deck = true;
        break;
      }
    }
  }
  const lx = ac.vel.x * K.sideLead;
  const lz = ac.vel.z * K.sideLead;
  // Where the first skid touches: the highest ground under any gear point.
  let contact = -Infinity;
  let lowest = Infinity;
  const gp = SPEC.gearPoints;
  for (let i = 0; i < gp.length; i++) {
    const p = gp[i].pos;
    const x = ac.pos.x - fx * p.z + rx * p.x;
    const z = ac.pos.z - fz * p.z + rz * p.x;
    const y = Math.max(0, heightAt(x, z)) - p.y;
    if (y > contact) contact = y;
    if (y < lowest) lowest = y;
  }
  /*
   * One skid on a roof and the other over the drop is not a landing.
   * Measured 2026-09-25, On Call: Ctrl held with the centre 1.3 m off the
   * south edge of St Brendan's deck; the right skid touched the deck, the
   * left had 30 m of air under it, and the machine rolled off the edge —
   * "You flew into a building". The skids must all find ground within
   * `skidStep` of each other, or it hovers above the highest of them.
   */
  const straddle = contact - lowest > K.skidStep;
  /*
   * Buildings and trees whose tops are near our height. Trees are modelled
   * as trunks and the rotor disc is not a strike point, so this is the hard
   * points against the boxes (1 m margin), never a circle round the mast: a
   * guard the width of the disc forbade landing within 6 m of any tree.
   */
  NEAR.length = 0;
  // Three metres down, and three seconds of whatever it is sinking at:
  // measured, On Call, Ctrl held over the town at 3 m/s, a roof top 3.1 m
  // below the mast was skipped here until it was 0.9 m below, and 0.9 m is
  // not enough to stop 3 m/s.
  const below = ac.pos.y - 3 + Math.min(0, ac.vel.y) * 3;
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    if (o.y1 < below) continue;
    if (ac.pos.x < o.x0 - 12 || ac.pos.x > o.x1 + 12 || ac.pos.z < o.z0 - 12 || ac.pos.z > o.z1 + 12) continue;
    NEAR.push(o);
  }
  // The hard points where they really are, at this attitude: a tap of S
  // pitches the tail down by 0.7 m, which is the whole margin at a roof edge.
  let need = -Infinity;
  let needHill = false;
  let needTree = false;
  const hp = SPEC.hardPoints;
  for (let i = 0; i < hp.length; i++) {
    const hq = hp[i].pos;
    const p = level
      ? HP.set(rx * hq.x - fx * hq.z, hq.y, rz * hq.x - fz * hq.z)
      : HP.copy(hq).applyQuaternion(ac.quat);
    const x = ac.pos.x + p.x;
    const z = ac.pos.z + p.z;
    let g = Math.max(0, heightAt(x, z), heightAt(x + lx, z + lz));
    const bare = g;
    let gTree = false;
    /*
     * Decks and buildings are boxes with sheer sides, so they are tested
     * `boxPad` wide as well: a hard point 1 m off a roof edge, below the
     * deck, is one tap from being under it. Measured: Last Light, hovering
     * beside St Brendan with the centre at deck height, a tap of D banked
     * the right wing tip 0.4 m down and 1.2 m sideways into the roof, and
     * the lead sample had been 0.85 m short of the edge. At 1.5 m the same
     * mission, another day's gusts, came down beside the hospital at 3 m/s,
     * 10 m off its corner, and a tap of D walked it in under the deck: so it
     * is 5 m, most of a rotor's radius, which is how close a pilot would put
     * the disc to a wall anyway. Trees keep `treePad`: a guard the width of
     * the disc round every trunk forbade landing in most clearings.
     */
    const P = K.boxPad;
    for (let j = 0; j < PLATFORMS.length; j++) {
      const q = PLATFORMS[j];
      if (q.y <= g) continue;
      if (Math.abs(x - q.cx) <= q.hw + P && Math.abs(z - q.cz) <= q.hd + P) g = q.y;
      else if (Math.abs(x + lx - q.cx) <= q.hw + P && Math.abs(z + lz - q.cz) <= q.hd + P) g = q.y;
    }
    for (let j = 0; j < NEAR.length; j++) {
      const o = NEAR[j];
      if (o.y1 <= g) continue;
      // A tree is a trunk a metre or two across; a building is not.
      const tree = o.x1 - o.x0 < 3 && o.z1 - o.z0 < 3;
      const W = tree || deck ? K.treePad : P;
      const inNow = x > o.x0 - W && x < o.x1 + W && z > o.z0 - W && z < o.z1 + W;
      const inLead = x + lx > o.x0 - W && x + lx < o.x1 + W && z + lz > o.z0 - W && z + lz < o.z1 + W;
      if (inNow || inLead) {
        g = o.y1;
        gTree = tree;
      }
    }
    const y = g - p.y + K.sideClear;
    if (y > need) {
      need = y;
      needHill = g === bare && bare > 0;
      needTree = gTree;
    }
  }
  /*
   * Which of these was the hillside, so the card can say what to do about
   * it. The review of the first kid build found 3 of 24 random spots on
   * Kestrel, slopes of 8.8-11.2 degrees, where Ctrl held for 40 s hovered
   * at 1-8 m saying CAN'T LAND HERE. Measured 2026-09-26, Kestrel, calm,
   * kid mode, Ctrl held from a 6 m hover over bare grass:
   *   9.8 deg   nose up the hill: hovered at 1.3 m for all 20 s. Across it
   *             either way, or facing down it: landed, 98-99 ft/min.
   *   12.7 deg  up and across: refused. Facing down: landed, 98 ft/min.
   *   14.5 deg  facing down: landed, 99 ft/min.
   * That is geometry, not a tuning. Level at first skid contact, the nose
   * hard point is 2.5 m ahead of the nose skid and 0.5 m above it, which
   * with sideClear rules out an up-slope ahead of about 7 degrees; across
   * the hill the skids are 2.9 m apart and skidStep allows about 12; facing
   * down it, the tail is 5 m behind the rear of the skids and 1.5 m up,
   * about 15. Pilots put a slope beside or behind them for the same reason.
   * So a hill is not something to fly away from, as a roof edge is: turning
   * round lands. With the card saying so ('hill' in hud-rotor.js), a child
   * who reads it and holds E with Ctrl still down landed on both the 9.8
   * and the 14.5 degree hill, 100-101 ft/min.
   */
  GUARD.floor = Math.max(need, contact);
  if (straddle) {
    const skids = contact + K.sideClear;
    GUARD.hill = skids >= need ? !platformAt(ac.pos.x, ac.pos.z) : needHill;
    GUARD.tree = skids < need && needTree;
    return Math.max(need, skids);
  }
  GUARD.hill = need > contact && needHill;
  GUARD.tree = need > contact && needTree;
  return need > contact ? need : -Infinity;
}

/*
 * Where the wall is looked for, in metres beyond the hard point that leads
 * (see ROTOR_TUNE.kid, THE WALL). Module constant: nothing allocated.
 */
const WALL_S = [0.5, 1.5, 3, 4.5, 6.5, 9, 12, 16, 21];
const WALL_C = Math.cos(40 * (Math.PI / 180));
const WALL_SIN = Math.sin(40 * (Math.PI / 180));

/** The speed it may close on a wall `d` metres off: see THE WALL. */
function wallSpeed(K, d) {
  return d === Infinity ? Infinity : K.wallRate * Math.max(0, d - K.wallMargin);
}

/**
 * The wall: metres of clear air between the part of the machine that leads
 * in direction (ux, uz) — a unit vector over the ground — and the first
 * ground, deck or rock that stands above the machine's lowest point less
 * `wallBelow`. Infinity when there is none within the last sample. Uses the
 * attitude as it is: tilting to slide dips the leading side, and that is
 * the side that meets the rock.
 */
function wallAhead(ac, SPEC, K, ux, uz) {
  let reach = 0;
  let low = Infinity;
  const pts = SPEC.hardPoints;
  for (let i = 0; i < pts.length; i++) {
    HP.copy(pts[i].pos).applyQuaternion(ac.quat);
    const a = HP.x * ux + HP.z * uz;
    if (a > reach) reach = a;
    if (HP.y < low) low = HP.y;
  }
  const gp = SPEC.gearPoints;
  for (let i = 0; i < gp.length; i++) {
    HP.copy(gp[i].pos).applyQuaternion(ac.quat);
    const a = HP.x * ux + HP.z * uz;
    if (a > reach) reach = a;
    if (HP.y < low) low = HP.y;
  }
  const level = ac.pos.y + low - K.wallBelow;
  for (let j = 0; j < WALL_S.length; j++) {
    const d = reach + WALL_S[j];
    // Somewhere between the last clear sample and this one: the middle.
    if (heightAt(ac.pos.x + ux * d, ac.pos.z + uz * d) > level) return (WALL_S[j] + (j ? WALL_S[j - 1] : 0)) * 0.5;
  }
  return Infinity;
}

/**
 * The turn ahead: the highest `GUARD.floor` over the next `yawLook` of
 * heading in direction `dir` (+1 right, -1 left), sampled at half and full,
 * held level. See ROTOR_TUNE.kid.yawLook for why the turn needs its own look.
 */
function yawAhead(ac, SPEC, K, dir, calm) {
  let worst = -Infinity;
  for (let i = 1; i <= 2; i++) {
    const h = (ac.heading + dir * K.yawLook * i * 0.5) * DEG;
    sideGuard(ac, SPEC, K, Math.sin(h), -Math.cos(h), calm, true);
    if (GUARD.floor > worst) worst = GUARD.floor;
  }
  return worst;
}

/**
 * Fly the machine for the pilot's intent. Writes the rotor's controls into S
 * (cyclicPitch, cyclicRoll, pedal, coll) and the HUD's readouts onto
 * ac.rotor. See ROTOR_TUNE.kid for what each key means.
 *
 * Allocation-free: every piece of state lives on S.kid, created once per
 * flight.
 */
function kidFly(ac, SPEC, dt, S, f, fx, fz, vF, vR) {
  const T = ROTOR_TUNE;
  const K = T.kid;
  const c = ac.controls;
  const k =
    S.kid ||
    (S.kid = {
      // The held height is height ABOVE THE GROUND (smoothed): see gref.
      holdH: null,
      gref: null,
      holdX: null,
      holdZ: null,
      hdg: null,
      vsInt: 0,
      iX: 0,
      iZ: 0,
      // Start where a flight starts: on the pad with the lever down, or, for
      // an airborne start, at the hover so it does not drop out of the sky
      // on the first frame.
      coll: ac.onGround ? T.leverIdle : collectiveForLift((SPEC.mass + (ac.extraMass || 0)) / SPEC.mass),
      state: 'ground',
      terrain: false,
      holdAge: 0,
      landed: ac.onGround,
      // The highest ground seen ahead and not yet passed. wallY null = none.
      wallX: 0,
      wallZ: 0,
      wallY: null,
      // What probeAhead() last found: the lowest safe height, and the fastest
      // it may go and still out-climb what is in front of it.
      probeT: 0,
      liftT: 0,
      // Taps: how long each key has been down, which way, and the step owed.
      tapP: 0,
      tapR: 0,
      tapPs: 0,
      tapRs: 0,
      nudgeF: 0,
      nudgeR: 0,
      floorY: -Infinity,
      vAllow: Infinity,
      guardT: 0,
      guardY: -Infinity,
      // The guard's gap is the hillside itself, or a tree: see GUARD.
      hill: false,
      tree: false,
      // The circle round it (see roomR): the height to go up to before a key
      // moves it, and whether it is going up to it now.
      roomY: -Infinity,
      room: false,
      // ...and whether that rock is the way it is going (see brakeTilt).
      roomAhead: false,
      // The wall (see THE WALL): clear metres to it, the speed that can
      // still stop short of it, whether it was looked for along the keys'
      // push (stopped), and whether that push is being refused.
      wallT: 0,
      wallD: Infinity,
      wallKeys: false,
      wallHold: false,
      wallCapped: false,
      // The looks (see the wall in kidFly): x, z and speed limit for the
      // keys' push, the path, and the path 40 degrees either side.
      walls: new Float64Array([0, 0, Infinity, 0, 0, Infinity, 0, 0, Infinity, 0, 0, Infinity]),
      // Is there ground near its height within wallNearR at all (5 Hz).
      wallNear: false,
      wallNearT: 0,
      // The look the cap last held it on, for the wind lean.
      wallCapX: 0,
      wallCapZ: 0,
      // The push besides its own tilt (the wind), world axes, m/s^2, and
      // the last step's velocity it is worked out from.
      extX: 0,
      extZ: 0,
      pvx: null,
      pvz: 0,
      // Touched down slowly and still on the ground: see `sit`.
      sat: false,
      // The turn ahead (see yawLook): the floor it would swing into, and how
      // much of the asked-for turn that leaves.
      yawY: -Infinity,
      yawScale: 1,
      yawHeld: false,
      // The ring of headings asked on a hill (see ring): how many asked,
      // where, and which of them land, one bit each.
      ringN: 0,
      ringX: 0,
      ringZ: 0,
      ringMask: 0,
      // Ctrl held and the card has said which way to turn: the turn stops
      // on the first heading that lands.
      hillTurn: false,
      // Holding its height over ground that is falling or rising under it.
      follow: false,
      grefV: 0,
      // The lift command as it arrived, and the lever written back in its
      // place: see "the keys" below.
      cmdIn: 0.5,
      leverOut: null,
    });

  const R = ac.rotor || (ac.rotor = {});
  const pitch = Math.asin(clamp(f.y, -1, 1));
  const bank = ac.bankAngleRad();
  const q = ac.quat;
  // The body's up axis, y component: cos of the total tilt. No allocation.
  const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
  /*
   * What is pushing it over the ground besides its own tilt — the wind on
   * the airframe, mostly — as an acceleration in world axes, smoothed over
   * 0.4 s: what it measures, less what the disc's lean accounts for (the
   * disc's horizontal share of a thrust that holds the height). The wall
   * cap below leans against it. Measured without it, The Stacks in 20 kt
   * from 020 (node harness): 20 of 86 runs at the stacks still crashed,
   * the wall's "slow to 0.25 m/s" asked for a 7-degree lean and the wind
   * wanted as much again the other way.
   */
  if (k.pvx !== null && dt > 0 && !ac.onGround) {
    const upX = 2 * (q.x * q.y - q.w * q.z);
    const upZ = 2 * (q.y * q.z + q.w * q.x);
    const tY = Math.max(0.5, upY);
    const ex = (ac.vel.x - k.pvx) / dt - (G * upX) / tY;
    const ez = (ac.vel.z - k.pvz) / dt - (G * upZ) / tY;
    const w = Math.min(1, dt / 0.4);
    k.extX += (ex - k.extX) * w;
    k.extZ += (ez - k.extZ) * w;
  } else if (ac.onGround) {
    k.extX = 0;
    k.extZ = 0;
  }
  k.pvx = ac.vel.x;
  k.pvz = ac.vel.z;
  const skidH = heightAboveSkids(ac, S, SPEC);
  const surfaceY = ac.pos.y - skidH - S.skidOff;
  // Water under the machine: heightAt() below sea level and no deck there.
  const overWater = ac.pos.y - ac.agl < 0;
  const vs = ac.vel.y;
  const gs = ac.groundSpeed;

  /* ------------------------------------------------------- the keys --- */
  /*
   * controls.throttle arrives as the lift command and leaves as the lever.
   *
   * In kid mode the input layer puts the spring-centred lift command in
   * controls.throttle (0.5 hold, 1 up, 0 down), and on the first kid build
   * it stayed there, so for anybody else reading sim.aircraft.controls the
   * helicopter's "throttle" meant something no other aircraft's does — the
   * hover read 50%, where the lever that holds the same hover reads 41%
   * (measured over Kestrel's hospital roof; 39% at sea level). So once
   * the command is read, the lever that would put the blades where the
   * computer has put them is written back (end of this function): the
   * collective on the lever's own 0-1, exactly what realistic mode's lever
   * reads in the same hover. main.js writes a fresh command before every
   * frame, and a frame runs one to twelve physics steps; a step that finds
   * its own lever still there has had no new command, and flies the last one.
   */
  let cmd = c.throttle;
  if (k.leverOut !== null && cmd === k.leverOut) cmd = k.cmdIn;
  k.cmdIn = cmd;
  const lift = clamp((cmd - 0.5) * 2, -1, 1);
  if (S.keptEngine > 0) S.keptEngine = Math.max(0, S.keptEngine - dt);
  const up = lift > K.liftDead;
  const down = lift < -K.liftDead;
  const sp = clamp(c.pitch, -1, 1); // + is S, nose up
  const sr = clamp(c.roll, -1, 1); // + is D, right
  const pd = clamp(c.yaw, -1, 1); // + is E, right
  // `let`: the side guard below takes the stick away while something beside
  // the machine stands higher than it is.
  let pitchActive = Math.abs(sp) > K.stickDead;
  let rollActive = Math.abs(sr) > K.stickDead;
  let centred = !pitchActive && !rollActive;
  const running = ac.engineOn && !ac.crashed;

  /* ------------------------------------------------------- vertical --- */
  /*
   * Sitting: on the ground and not asking to go up. The collective runs down
   * to the lever's idle and stays there, so the machine is planted on its
   * skids and a crosswind cannot skate it about. Nothing else happens until
   * Shift.
   */
  /*
   * ...once it has touched down slowly. A skid brushing rock while the
   * machine is still sliding is not a landing: measured 2026-09-26, Q, D and
   * Ctrl beside the 63-degree rock at (1863, -1534) with a drift guard that
   * was later taken out, a skid touched the face at 2.9 m/s, the computer
   * sat — cyclic central, lever running down to idle, on 63 degrees — and
   * it tipped to 37 degrees of bank before it bounced clear. Sitting now
   * needs the touch to be under landGs, and then stays sat until it leaves
   * the ground.
   */
  const sit = !running || (ac.onGround && !up && (k.sat || ac.groundSpeed < K.landGs));
  k.sat = sit && ac.onGround;
  // Gentlest allowed descent this close to the ground: `descend` up high,
  // easing to `landSlow` at the skids.
  // The ease starts landBand + landFloor up and reaches landSlow a metre
  // above the skids, not at them: the vertical-speed loop lags by about half
  // a second, and eased to the skids it was still doing 1.0 m/s a metre up
  // (measured). Now the last metre is at the slow rate.
  // And faster from high up: see descendHigh.
  const descendNow =
    K.descend + (K.descendHigh - K.descend) * clamp((skidH - K.descendLowAt) / (K.descendHighAt - K.descendLowAt), 0, 1);
  const landLimit = K.landSlow + (descendNow - K.landSlow) * clamp((skidH - K.landFloor) / K.landBand, 0, 1);
  let vsT = 0;
  k.terrain = false;
  /*
   * "Let go and it holds this height" means the height on the panel: the
   * height above whatever is underneath. Held as an ALTITUDE, the machine
   * that the terrain floor had lifted over St Brendan's roof then settled
   * back towards its old altitude and landed itself on the roof with nobody
   * touching anything — measured, in Last Light. The ground under it is
   * smoothed (0.6 s in the hover, 2.5 s at speed) so a bump in the hill does
   * not bob the machine, and the terrain floor still looks after the cliffs.
   *
   * But in the hover it only ever follows the ground UP. Measured 2026-09-25,
   * Man Overboard, bringing the swimmer home: the machine drifted a few
   * metres off the east edge of St Brendan's roof while shuffling over the
   * H, the ground under it dropped from the 72 m deck to the 44 m hillside,
   * and "hold this height above whatever is underneath" took it down 28 m to
   * sit BESIDE the building, below the deck. The next tap of S backed the
   * tail into the roof. Shuffling at a walk, a roof edge is not a reason to
   * go down; flying along over the hills, the ground is.
   */
  /*
   * And at speed it follows the ground down at a third of the rate it
   * follows it up. Measured in the browser, Free Flight from Kestrel Cottage
   * Hospital's roof: W held off the edge, the ground under it fell 30 m and
   * the card said HOLDING HEIGHT while it went down at 600 ft/min to get
   * back to 13 m over the hillside. Up is urgent; down can take its time.
   */
  const tau = gs < 3 ? 0.6 : surfaceY > (k.gref ?? surfaceY) ? 2.5 : K.grefDown;
  const gref0 = k.gref;
  if (k.gref === null) k.gref = surfaceY;
  else if (gs >= 3 || surfaceY > k.gref) k.gref += (surfaceY - k.gref) * Math.min(1, dt / tau);
  // How fast the ground it is holding its height over is moving, smoothed
  // over half a second: the card's FOLLOWING THE GROUND.
  k.grefV += ((gref0 === null ? 0 : (k.gref - gref0) / dt) - k.grefV) * Math.min(1, dt / 0.5);
  if (sit) {
    k.holdH = null;
  } else if (up || down) {
    k.holdH = null;
    vsT = up ? lift * K.climb : Math.max(lift * descendNow, -landLimit);
    if (down && overWater) vsT = Math.max(vsT, clamp((K.seaFloor - skidH) * 1.2, -descendNow, K.climb));
  } else {
    if (k.holdH === null) k.holdH = ac.pos.y + (vs * Math.abs(vs)) / (2 * K.holdDecel) - k.gref;
    vsT = clamp((k.gref + k.holdH - ac.pos.y) * K.hP, -K.descend, K.climb);
    vsT = Math.max(vsT, -landLimit);
    if (overWater) vsT = Math.max(vsT, clamp((K.seaFloor - skidH) * 1.2, -K.descend, K.climb));
  }
  /*
   * Rising ground and roofs ahead. Only when not deliberately coming down —
   * Ctrl means the pilot has chosen the ground — and scaled with groundspeed,
   * so a hover at four metres stays at four metres and a cruise at thirty
   * metres climbs over a hill instead of into it.
   */
  /*
   * Which way to look: along the flight path, or — stopped at the foot of a
   * slope with W held — where the nose points, so that pushing on towards a
   * cliff climbs it instead of doing nothing.
   */
  let lookX = 0;
  let lookZ = 0;
  let lookV = 0;
  if (gs > 2) {
    lookX = ac.vel.x / gs;
    lookZ = ac.vel.z / gs;
    lookV = gs;
  } else if (pitchActive && sp < 0) {
    lookX = fx;
    lookZ = fz;
    lookV = 2;
  }
  // Ctrl held while flying along is not "I have chosen the ground": the
  // landing gate below keeps it off the grass, and this keeps it off the hill.
  const cruising = pitchActive || rollActive || gs > K.landGs;
  if (!sit && (!down || cruising) && lookV > 0) {
    /*
     * Probed at 40 Hz, not every physics step: five heightAt() calls a step
     * at 120 Hz is 600 a second for an answer that moves by centimetres.
     */
    k.probeT -= dt;
    if (k.probeT <= 0) {
      k.probeT = 1 / 40;
      probeAhead(ac, S, k, K, lookV, lookX, lookZ, surfaceY);
    }
    /*
     * The floor lifts it; it does not move the held height. Measured with
     * the held height raised to the floor: over North Kestrel Hills the
     * machine was pushed from 60 m to 234 m and then cruised on to the cove
     * at 200 m above the ground, because that was now "the height". Left
     * alone, the hold brings it back down after the hill, and the floor
     * keeps it clear of the ground on the way.
     */
    if (ac.pos.y < k.floorY) {
      k.terrain = true;
      vsT = Math.max(vsT, clamp((k.floorY - ac.pos.y) * 0.9, 0, K.terrainClimb));
      /*
       * ...except when it is lifting it onto something it is slowing down
       * for. Measured 2026-09-25, Last Light, arriving at St Brendan low: the
       * floor lifted the machine to the roof, the probe stopped looking once
       * it was down to a walk, and the hold took it straight back down to its
       * old height BESIDE the building — 83 m to 69 m, below the 72 m deck —
       * where the next shuffle put a hard point into the block. Below
       * `keepLift` over the ground, where it has been lifted to is where it
       * stays.
       */
      if (k.holdH !== null && gs < K.keepLift) k.holdH = Math.max(k.holdH, ac.pos.y - k.gref);
      k.liftT = K.liftHold;
    }
  } else {
    k.floorY = -Infinity;
    k.vAllow = Infinity;
    k.probeT = 0;
    if (sit || (down && !cruising)) k.wallY = null;
  }
  /*
   * And for `liftHold` seconds after the floor last lifted it, the hold does
   * not take it back down. Measured 2026-09-25, Last Light, braking past the
   * east side of St Brendan at 20 -> 3 m/s: the probes looked along the path,
   * the roof was beside it rather than ahead, so the floor blinked on and off
   * every quarter second and in between the hold descended at the full
   * 3 m/s towards its old height — into the building. Cresting a hill at
   * cruise it now waits two seconds before it comes back down, which nobody
   * notices; beside a roof it does not come down at all until it has passed.
   */
  if (k.liftT > 0) {
    k.liftT -= dt;
    if (!down) vsT = Math.max(vsT, 0);
  }
  const vAllow = k.vAllow;

  /*
   * The turn asked for: Q/E, and A/D once it is going fast enough to steer.
   * Worked out here for the turn guard; the heading block below flies it.
   */
  const steer = smoothstep(K.turnLo, K.turnHi, vF);
  const turn = clamp(K.turnAccel / Math.max(1, vF), K.turnMin, K.turnRate);
  const yawWant = pd * Math.abs(pd) * K.yawRate + (rollActive ? sr * turn * steer : 0);
  const yawRateRight = -ac.omega.y;
  // W A S D as pressed, before any guard below takes the stick away.
  const keysOn = pitchActive || rollActive;

  /*
   * The wall (see THE WALL in ROTOR_TUNE.kid), at 40 Hz and at any height,
   * in the hover and slide regime. Up to four looks, each with its own
   * speed limit: the way the keys push (or, hands off, the way to the spot
   * it is walking back to), the way it is going, and 40 degrees either side
   * of that — a crosswind swings the path round, and measured on The Stacks
   * in 20 kt, looking only straight along the path the wall "ahead" went
   * from 11 m to 2 m in a second as the path swung onto the face beside it.
   * The keys' look is kept apart from the path's so that a machine bouncing
   * off the brake is still held: measured, with one look that switched from
   * the keys to the path above 0.5 m/s, S held into Gannet Stack stopped it,
   * bounced it away, let S push again, and the tail went in on the third
   * swing. And none of it runs unless some ground within `wallNearR` stands
   * within 2 m of the skids' height (two rings of eight, at 5 Hz), so open
   * sky and open sea cost 80 heightAt() calls a second.
   */
  k.wallT -= dt;
  if (k.wallT <= 0) {
    k.wallT = 1 / 40;
    const W = k.walls;
    for (let i = 2; i < 12; i += 3) W[i] = Infinity;
    k.wallD = Infinity;
    k.wallKeys = false;
    const regime = !sit && !ac.onGround && (gs < K.roomMaxGs || vF < K.turnLo);
    k.wallNearT -= 1 / 40;
    if (!regime) k.wallNear = false;
    else if (k.wallNearT <= 0) {
      k.wallNearT = 0.2;
      const lowY = ac.pos.y - S.skidOff - 2;
      k.wallNear = false;
      for (let n = 0; n < 16 && !k.wallNear; n++) {
        const h = ((n % 8) / 8) * Math.PI * 2 + (n < 8 ? 0 : Math.PI / 8);
        const r = n < 8 ? K.wallNearR : K.wallNearR * 0.5;
        if (heightAt(ac.pos.x + Math.sin(h) * r, ac.pos.z - Math.cos(h) * r) > lowY) k.wallNear = true;
      }
    }
    if (regime && k.wallNear) {
      if (keysOn) {
        // The keys' push over the ground: W forward (sp < 0), D right, and
        // right is (-fz, fx).
        const aF = pitchActive ? -sp : 0;
        const aR = rollActive ? sr : 0;
        const m = Math.hypot(aF, aR);
        W[0] = (fx * aF - fz * aR) / m;
        W[1] = (fz * aF + fx * aR) / m;
        k.wallD = wallAhead(ac, SPEC, K, W[0], W[1]);
        W[2] = wallSpeed(K, k.wallD);
        k.wallKeys = true;
      } else if (k.holdX !== null) {
        // Hands off, walking back to the spot it holds: that way. Measured
        // without it, Gannet Stack: stopped against the face with S held,
        // let go, and the spot hold walked the tail from 6.6 m to 1.3 m off
        // the rock in five seconds.
        const ex = k.holdX - ac.pos.x;
        const ez = k.holdZ - ac.pos.z;
        const e = Math.hypot(ex, ez);
        if (e > 0.3) {
          W[0] = ex / e;
          W[1] = ez / e;
          W[2] = wallSpeed(K, wallAhead(ac, SPEC, K, W[0], W[1]));
        }
      }
      // Down to a creep: let go against the face in 12 kt, the machine
      // drifted onto it at 0.2 m/s, below any look that waited for 0.5.
      if (gs > 0.1) {
        const ux = ac.vel.x / gs;
        const uz = ac.vel.z / gs;
        W[3] = ux;
        W[4] = uz;
        W[5] = wallSpeed(K, wallAhead(ac, SPEC, K, ux, uz));
        W[6] = ux * WALL_C - uz * WALL_SIN;
        W[7] = ux * WALL_SIN + uz * WALL_C;
        W[8] = wallSpeed(K, wallAhead(ac, SPEC, K, W[6], W[7]));
        W[9] = ux * WALL_C + uz * WALL_SIN;
        W[10] = -ux * WALL_SIN + uz * WALL_C;
        W[11] = wallSpeed(K, wallAhead(ac, SPEC, K, W[9], W[10]));
      }
    }
  }
  // Stopped against it, and the keys still pushing that way: they do nothing.
  k.wallHold = k.wallKeys && k.wallD - K.wallMargin < K.wallStop && gs < 1;
  if (k.wallHold) {
    pitchActive = false;
    rollActive = false;
    centred = true;
  }

  // Beside it: see sideClear. Checked at 40 Hz while low and flying, and
  // whenever Ctrl is held (see descendHigh).
  if (!sit && (skidH < 40 || down)) {
    k.guardT -= dt;
    if (k.guardT <= 0) {
      k.guardT = 1 / 40;
      const calm = !pitchActive && !rollActive && gs < K.landGs;
      k.guardY = sideGuard(ac, SPEC, K, fx, fz, calm);
      k.hill = GUARD.hill;
      k.tree = GUARD.tree;
      const floorNow = GUARD.floor;
      /*
       * The turn ahead: see yawLook. Which way it is turning is the key if
       * one is down, or the way it is still going if not.
       */
      const yawDir = Math.abs(yawWant) > 0.02 ? Math.sign(yawWant) : Math.abs(yawRateRight) > 0.05 ? Math.sign(yawRateRight) : 0;
      k.yawY = -Infinity;
      if (yawDir !== 0 && ac.pos.y - floorNow < K.yawSkip) {
        const ahead = yawAhead(ac, SPEC, K, yawDir, calm);
        if (ahead > floorNow + 0.05) k.yawY = ahead;
      }
      /*
       * The ring (see `ring`): only while the hillside is what refuses it
       * and it is not going anywhere. Taken again from scratch when it has
       * moved; a few headings a tick until all of them are known.
       */
      if (k.hill && gs < K.landGs) {
        if (k.ringN > 0 && Math.hypot(ac.pos.x - k.ringX, ac.pos.z - k.ringZ) > K.ringMove) k.ringN = 0;
        if (k.ringN === 0) {
          k.ringX = ac.pos.x;
          k.ringZ = ac.pos.z;
          k.ringMask = 0;
        }
        for (let n = 0; n < K.ringPer && k.ringN < K.ring; n++) {
          const h = (k.ringN / K.ring) * Math.PI * 2;
          if (sideGuard(ac, SPEC, K, Math.sin(h), -Math.cos(h), calm, true) === -Infinity) k.ringMask |= 1 << k.ringN;
          k.ringN++;
        }
      } else if (!k.hill) {
        k.ringN = 0;
      }
      /*
       * The circle (see roomR): only while a key is down or it is sliding.
       * Twelve heightAt() calls at 40 Hz.
       */
      k.roomY = -Infinity;
      k.roomAhead = false;
      // Under roomMaxGs, or at any speed while it is not flying nose-first:
      // see roomSlide.
      if ((keysOn || Math.abs(yawWant) > 0.02 || gs > K.roomGs) && (gs < K.roomMaxGs || vF < K.turnLo)) {
        const cx = ac.pos.x + ac.vel.x * K.sideLead;
        const cz = ac.pos.z + ac.vel.z * K.sideLead;
        let top = 0;
        let topS = 0;
        for (let n = 0; n < K.roomN; n++) {
          const h = (n / K.roomN) * Math.PI * 2;
          const g = heightAt(cx + Math.sin(h) * K.roomR, cz - Math.cos(h) * K.roomR);
          if (g > top) {
            top = g;
            topS = h;
          }
        }
        if (top - surfaceY > K.roomSteep) {
          k.roomY = top + S.skidOff + K.roomClear;
          // Is that rock the way it is going? Then braking lifts the side
          // nearest it (see brakeTilt).
          k.roomAhead =
            gs > K.roomGs &&
            (cx + Math.sin(topS) * K.roomR - ac.pos.x) * ac.vel.x + (cz - Math.cos(topS) * K.roomR - ac.pos.z) * ac.vel.z > 0;
        }
      }
    }
  } else {
    k.guardY = -Infinity;
    k.hill = false;
    k.tree = false;
    k.yawY = -Infinity;
    k.ringN = 0;
    k.roomY = -Infinity;
    k.roomAhead = false;
  }
  /*
   * Up before anything moves, beside steep rock: see roomR. The stick is
   * taken away and the turn held (below, with the turn guard) until the
   * skids are over the highest rock within reach.
   */
  /*
   * On a hill with Ctrl held, once the card has said which way to turn, the
   * turn stops on the first heading the guard says lands, so "keep holding
   * Ctrl and turn" ends on the ground rather than spinning past the one
   * heading that would — and the room-to-turn climb stands down with it.
   * Measured with the climb left on: seed 777's two hill spots (9.6 and 10.6
   * degrees) stopped turning within 3 and 10 degrees and then hovered for
   * the whole 20 s the key was held, landing only once it was let go. (And
   * a turn stopped there is not a turn to the circle below either.)
   */
  const hillStop = down && k.hillTurn && k.guardY === -Infinity;
  k.room = false;
  let roomScale = 1;
  if (k.roomY > -Infinity && (keysOn || (Math.abs(yawWant) > 0.02 && !hillStop) || gs > K.roomGs)) {
    // And never down while it moves or turns beside it: see roomHold.
    vsT = Math.max(vsT, 0);
    const below = k.roomY - ac.pos.y;
    if (below > 0) {
      k.room = true;
      vsT = Math.max(vsT, clamp(below * 1.5, 0, K.terrainClimb));
      roomScale = clamp(1 - below / K.roomBand, 0, 1);
      if (below > K.roomBand * 0.5) {
        pitchActive = false;
        rollActive = false;
        centred = true;
      }
    }
  }
  /*
   * Slow the turn to what the floor ahead leaves room for, and — while a key
   * is asking for the turn — go up to make the room. See yawLook.
   */
  k.yawScale = 1;
  k.yawHeld = false;
  if (k.yawY > -Infinity && !hillStop) {
    const gapY = ac.pos.y - k.yawY;
    k.yawScale = clamp((gapY - K.yawGapLo) / (K.yawGapHi - K.yawGapLo), 0, 1);
    if (Math.abs(yawWant) > 0.02) {
      vsT = Math.max(vsT, clamp((k.yawY + K.yawGapHi - ac.pos.y) * 1.5, 0, K.terrainClimb));
      k.yawHeld = k.yawScale < 1;
    }
  }
  // And the circle's hold on the turn: see roomR.
  if (roomScale < 1) k.yawScale = Math.min(k.yawScale, roomScale);
  k.tooClose = false;
  let guardGap = Infinity;
  if (k.guardY > -Infinity) {
    // Come down on it no faster than it can stop: 0.8 m/s per metre of gap,
    // so a 3 m/s descent is already slowing four metres out. Inside a metre,
    // back up, whatever the keys say. (Half a metre was not enough once the
    // guard was made honest: one tap of S at a roof edge pitched the tail
    // down 0.7 m.)
    const gap = ac.pos.y - k.guardY;
    guardGap = gap;
    vsT = Math.max(vsT, clamp((1 - gap) * 1.2, -descendNow, K.climb), -Math.max(0, gap - 1) * 0.8);
    if (gap < 2) k.tooClose = true;
    /*
     * Below it: stop where it is and climb out, whatever the stick says.
     * Measured: shuffling sideways at 63 m towards St Brendan's pad, whose
     * deck is at 72.5, the tail went into the edge of the roof. Going up is
     * always safe; going sideways into a building never is.
     */
    if (gap < 0.3 && !ac.onGround) {
      pitchActive = false;
      rollActive = false;
      centred = true;
    }
  }

  /*
   * The landing gate: see landGs and gateH. The tuning for this was written
   * down with its measurement and the code never was — measured 2026-09-25
   * in the node harness, W+Ctrl from a 30 m cruise still went into the grass
   * at 39.5 m/s ("The propeller struck the ground"), and from a 3 m hover
   * W+Ctrl, S+Ctrl and Q+W+Ctrl all hit nose or tail first at 4-6 m/s.
   *
   * So while the machine is sliding or a W A S D key is down, the lowest it
   * goes is gateH, plus clearPerMs for every m/s over landGs — a slow
   * shuffle can be low, a 40 m/s dash with Ctrl held is 22 m up. Ctrl still
   * comes down to that; the last of it waits until the child lets go and the
   * machine has stopped. The panel says so ('gate').
   */
  k.gated = false;
  const handsOn = pitchActive || rollActive;
  if (!sit && !ac.onGround && (handsOn || gs > K.landGs)) {
    const minSkid = K.gateH + clamp((gs - K.landGs) * K.clearPerMs, 0, K.clearMax);
    if (skidH < minSkid + 1) {
      const floorVs = clamp((minSkid - skidH) * 1.2, -K.descend, K.climb);
      if (floorVs > vsT) {
        vsT = floorVs;
        if (down) k.gated = true;
      }
    }
  }
  // The tilt the stick may ask for this close to the ground: see lowTiltMin.
  // "The ground" is also a roof or a rock beside it that a hard point is
  // over — the guard's gap, which is measured to that.
  const tiltLim =
    K.lowTiltMin + (K.tiltMax - K.lowTiltMin) * clamp(Math.min(skidH, guardGap - 1) / K.lowTiltFull, 0, 1);
  // ...and braking away from rock it is closing on, the ground under the
  // skids only: see brakeTilt.
  const tiltLimSkid = K.lowTiltMin + (K.tiltMax - K.lowTiltMin) * clamp(skidH / K.lowTiltFull, 0, 1);

  const mTot = SPEC.mass + (ac.extraMass || 0);
  if (sit) {
    k.vsInt = 0;
    const floor = running ? T.leverIdle : 0;
    k.coll = Math.max(floor, k.coll - dt * K.collRate * 0.5);
  } else {
    const err = vsT - vs;
    if (Math.abs(err) < 1.5) k.vsInt = clamp(k.vsInt + err * K.vI * dt, -K.vIMax, K.vIMax);
    const aCmd = clamp(err * K.vK + k.vsInt, -K.aMax, K.aMax);
    // The disc as a drag plate going up or down — physics.js adds exactly this.
    const discArea = Math.PI * SPEC.rotorRadius * SPEC.rotorRadius;
    const discDrag = 0.5 * ac.density * vs * Math.abs(vs) * discArea * T.discCD;
    const ettl = 1 + clamp(ac.airspeed / 24, 0, 1) * 0.11;
    const rough = ac.failures && ac.failures.roughEngine ? 0.45 : 1;
    const need = mTot * (G + aCmd) + discDrag;
    const have = SPEC.mass * G * (ac.density / RHO0) * ettl * Math.max(0.5, upY) * rough;
    const want = collectiveForLift(need / have);
    k.coll += clamp(want - k.coll, -K.collRate * dt, K.collRate * dt);
  }
  // A stopped engine is a stopped rotor, computer or no computer.
  S.coll = running ? clamp(k.coll, 0, 1) : Math.min(k.coll, ac.rpm);

  /* ----------------------------------------------------- horizontal --- */
  /*
   * The spot. Taken when the sticks are centred and the machine has slowed
   * to a walk, held until a stick moves. Holding it is two loops in series,
   * position to velocity to lean, which is the same shape as the hover
   * assist's drift damping with a position loop wrapped round the outside.
   */
  /*
   * A tap is a step. A child lines up over an H with quick taps, and a
   * tap of an attitude key is over before the machine has tilted: measured
   * 2026-09-25, Night Deck, over Ironhead Infirmary's roof in 20 kt, taps of
   * W and A every two and a half seconds from six metres off the H moved it
   * nowhere for eight minutes and the mission ran out of time. So a press
   * shorter than `tapMax`, in the hover, moves the spot it stops on by
   * `nudge` metres that way, and the spot hold walks it there.
   */
  if (!sit && gs < 3) {
    if (pitchActive) {
      k.tapP += dt;
      k.tapPs = sp;
    } else if (k.tapP > 0) {
      if (k.tapP < K.tapMax) k.nudgeF -= Math.sign(k.tapPs) * K.nudge;
      k.tapP = 0;
    }
    if (rollActive) {
      k.tapR += dt;
      k.tapRs = sr;
    } else if (k.tapR > 0) {
      if (k.tapR < K.tapMax) k.nudgeR += Math.sign(k.tapRs) * K.nudge;
      k.tapR = 0;
    }
  } else {
    k.tapP = 0;
    k.tapR = 0;
    k.nudgeF = 0;
    k.nudgeR = 0;
  }
  if (!centred || sit || ac.onGround) {
    k.holdX = null;
    k.holdZ = null;
    k.holdAge = 0;
  } else if (k.holdX === null && gs < K.capture) {
    // Where it is going to stop, not where it is: taken at the moment the
    // stick centres, with the machine still gliding, the spot was behind it
    // and every tap of W ended with a walk backwards. Plus any tap's step.
    k.holdX = ac.pos.x + ac.vel.x / K.velK + fx * k.nudgeF - fz * k.nudgeR;
    k.holdZ = ac.pos.z + ac.vel.z / K.velK + fz * k.nudgeF + fx * k.nudgeR;
    k.nudgeF = 0;
    k.nudgeR = 0;
    // And the height it has now. The terrain floor may have lifted it over a
    // hill on the way here; stopping means "stay HERE", not "go back down to
    // the height I set before the hill".
    if (k.holdH !== null) k.holdH = ac.pos.y + (vs * Math.abs(vs)) / (2 * K.holdDecel) - k.gref;
  }
  /*
   * Stopped against a wall (see THE WALL), the spot is where it stopped,
   * not where the glide was heading — which is into the rock. Measured
   * without this on The Stacks in 20 kt: S held into Gannet Stack stopped
   * it 1 m short, the spot was 1.04 m on, and let go the wind lean wound
   * up towards the spot until the machine slid round the cap and put the
   * tail into the face 5 s later.
   */
  if (k.wallHold && k.holdX !== null) {
    k.holdX = ac.pos.x;
    k.holdZ = ac.pos.z;
  }
  let vxC = 0;
  let vzC = 0;
  let spotErr = Infinity;
  if (k.holdX !== null) {
    k.holdAge += dt;
    spotErr = Math.hypot(k.holdX - ac.pos.x, k.holdZ - ac.pos.z);
    vxC = (k.holdX - ac.pos.x) * K.posK;
    vzC = (k.holdZ - ac.pos.z) * K.posK;
    const m = Math.hypot(vxC, vzC);
    if (m > K.posVmax) {
      vxC *= K.posVmax / m;
      vzC *= K.posVmax / m;
    }
  }
  const vFc = vxC * fx + vzC * fz;
  const vRc = -vxC * fz + vzC * fx;

  /*
   * The wind lean, learned in WORLD axes like the hover assist's trim, so a
   * pedal turn does not scramble it. Wound only while nobody is on the stick
   * and the machine is flying; bled away on the ground.
   */
  if (sit || ac.onGround) {
    const bleed = Math.max(0, 1 - T.trimBleed * dt);
    k.iX *= bleed;
    k.iZ *= bleed;
  } else if (centred && k.holdAge > K.leanAfter && spotErr < K.leanWithin) {
    let dX = (vxC - ac.vel.x) * K.velI * dt;
    let dZ = (vzC - ac.vel.z) * K.velI * dt;
    // Not towards a wall the cap is holding it off (see THE WALL): that
    // lean would only wind up against the cap until it slid round it.
    if (k.wallCapped) {
      const t = dX * k.wallCapX + dZ * k.wallCapZ;
      if (t > 0) {
        dX -= t * k.wallCapX;
        dZ -= t * k.wallCapZ;
      }
    }
    k.iX += dX;
    k.iZ += dZ;
    const m = Math.hypot(k.iX, k.iZ);
    if (m > K.leanMax) {
      k.iX *= K.leanMax / m;
      k.iZ *= K.leanMax / m;
    }
  }
  const iF = k.iX * fx + k.iZ * fz;
  const iR = -k.iX * fz + k.iZ * fx;

  // A/D slide in the hover and steer at speed; `steer`, worked out above for
  // the turn guard, is how far along that hand-over we are.

  /*
   * Forward. W and S are an attitude; hands off, a velocity (zero, or back
   * to the spot). Nose down accelerates, so a wanted forward acceleration
   * is a NEGATIVE pitch.
   */
  /*
   * With a key down in the hover the wind lean stays in: the key tilts the
   * machine from where the wind needs it, not from level, or every press
   * gives the wind the machine for as long as the press lasts.
   */
  const hoverShare = 1 - smoothstep(K.turnLo, K.turnHi, vF);
  let tgtPitch;
  if (pitchActive) tgtPitch = sp * tiltLim - Math.atan(iF / G) * hoverShare;
  else tgtPitch = -Math.atan((K.velK * (vFc - vF) + iF) / G);

  /*
   * Sideways. A positive bank is right wing down and accelerates RIGHT. In
   * the hover A/D is an attitude — slide. At speed A/D is a turn (the yaw
   * below) and this axis keeps the flight path on the nose, which is what
   * banks the machine into the turn.
   */
  let tgtBank;
  const keepOnNose = Math.atan((K.velK * (vRc - vR) + iR) / G);
  if (rollActive) tgtBank = (sr * tiltLim + Math.atan(iR / G)) * (1 - steer) + keepOnNose * steer;
  else tgtBank = keepOnNose;

  /*
   * Backwards and sideways are for shuffling, not for travelling. S and A/D
   * in the hover are an attitude, and eighteen degrees held is 3.2 m/s^2 for
   * as long as the key is down: measured 2026-09-25, S+A+Ctrl held from a
   * 10 m hover ran backwards-left to 53 m/s and flew tail-first into Port
   * Kestrel's hill at 110 m, because the ground-ahead brake below only ever
   * braked FORWARD speed. A light helicopter's rearward and sideways limits
   * are 15-30 kt. So: backMax and slideMax, held by the same velocity loop
   * that stops it when you let go.
   */
  if (vF < -K.backMax) tgtPitch = Math.min(tgtPitch, -Math.atan((K.velK * (-K.backMax - vF)) / G));
  if (vR > K.slideMax) tgtBank = Math.min(tgtBank, Math.atan((K.velK * (K.slideMax - vR)) / G));
  else if (vR < -K.slideMax) tgtBank = Math.max(tgtBank, Math.atan((K.velK * (-K.slideMax - vR)) / G));
  /*
   * Ground ahead it cannot out-climb: brake to a speed it can, W or no W —
   * along the flight path, which is the way the probes looked, and not only
   * fore and aft.
   */
  if (gs > vAllow) {
    const sc = vAllow / gs;
    const brakeP = -Math.atan((K.velK * (vF * sc - vF)) / G);
    const brakeB = Math.atan((K.velK * (vR * sc - vR)) / G);
    tgtPitch = vF > 0 ? Math.max(tgtPitch, brakeP) : Math.min(tgtPitch, brakeP);
    tgtBank = vR > 0 ? Math.min(tgtBank, brakeB) : Math.max(tgtBank, brakeB);
  }
  /*
   * And rock beside it at its own height (see THE WALL): the tilt towards it
   * is capped at what brings the speed that way to vWall in 1/wallK
   * seconds, so the key eases off before the limit instead of the brake
   * swinging the attitude round after it, and past the limit it brakes.
   */
  let wallBrake = false;
  k.wallCapped = false;
  let keyCapped = false;
  for (let i = 0; i < 12; i += 3) {
    const lim = k.walls[i + 2];
    if (lim === Infinity) continue;
    const ux = k.walls[i];
    const uz = k.walls[i + 1];
    const uF = ux * fx + uz * fz;
    const uR = -ux * fz + uz * fx;
    const vU = ac.vel.x * ux + ac.vel.z * uz;
    const extU = k.extX * ux + k.extZ * uz;
    const capU = Math.atan((K.wallK * (lim - vU) - extU) / G);
    const aU = -tgtPitch * uF + tgtBank * uR;
    if (aU > capU) {
      const d = aU - capU;
      tgtPitch += d * uF;
      tgtBank -= d * uR;
      if (capU < 0) wallBrake = true;
      if (i === 0 && k.wallKeys) keyCapped = true;
      if (!k.wallCapped) {
        k.wallCapped = true;
        k.wallCapX = ux;
        k.wallCapZ = uz;
      }
    }
  }

  // The tilt limit is on the TOTAL tilt, both axes together — except that
  // the part of it braking away from rock it is closing on may use the limit
  // for the ground under the skids: see brakeTilt.
  const closing = gs > 0.5 && (gs > vAllow || wallBrake || (k.room && k.roomAhead));
  if (closing && tiltLimSkid > tiltLim) {
    // As accelerations, forward and right (a negative pitch is forward),
    // split along the brake (u, against the velocity) and across it.
    const uF = -vF / gs;
    const uR = -vR / gs;
    const b = Math.max(0, -tgtPitch * uF + tgtBank * uR);
    let pF = -tgtPitch - b * uF;
    let pR = tgtBank - b * uR;
    const pm = Math.hypot(pF, pR);
    if (pm > tiltLim) {
      pF *= tiltLim / pm;
      pR *= tiltLim / pm;
    }
    const bm = Math.min(b, Math.sqrt(Math.max(0, tiltLimSkid * tiltLimSkid - pF * pF - pR * pR)));
    tgtPitch = -(bm * uF + pF);
    tgtBank = bm * uR + pR;
  } else {
    const tilt = Math.hypot(tgtPitch, tgtBank);
    if (tilt > tiltLim) {
      tgtPitch *= tiltLim / tilt;
      tgtBank *= tiltLim / tilt;
    }
  }

  /*
   * The attitude loop, gains solved from the authority the rotor really has
   * at this collective (as the hover assist does) plus the stub wing's
   * elevator, which at 50 m/s is half as strong again as the cyclic and,
   * left out, runs the loop 50% over its design gain. The damping includes
   * the extra rate damping simplified mode adds in physics.js (900 and 900
   * N·m per rad/s, scaled by inertia), because that is what kid mode flies.
   */
  const disc = (0.35 + S.coll * 0.65) * SPEC.mass * G;
  const qS = 0.5 * ac.density * ac.airspeed * ac.airspeed * SPEC.wingArea;
  const aPitch = Math.max(0.2, (disc * SPEC.rotorPitchArm + qS * SPEC.chord * Math.abs(SPEC.Cmde)) / SPEC.Ixx);
  const aRoll = Math.max(0.2, (disc * SPEC.rotorRollArm + qS * SPEC.wingSpan * SPEC.Clda) / SPEC.Izz);
  const aYaw = Math.max(0.2, (disc * SPEC.rotorYawArm) / SPEC.Iyy);
  const dPitch = T.dampPitch + 900 / 1800;
  const dRoll = T.dampRoll + 900 / 1300;
  const dYaw = T.dampYaw + 1100 / 2600;

  if (sit) {
    // Planted. The skids and the ground hold it; the cyclic stays central so
    // a key pressed on the pad does not rock it over on its skids.
    S.cyclicPitch = 0;
    S.cyclicRoll = 0;
    S.pedal = 0;
    k.hdg = null;
  } else {
    S.cyclicPitch = clamp((tgtPitch - pitch) * gainP(T.wnPitch, aPitch) - ac.omega.x * gainD(T.wnPitch, dPitch, aPitch), -1, 1);
    S.cyclicRoll = clamp((tgtBank - bank) * gainP(T.wnRoll, aRoll) + ac.omega.z * gainD(T.wnRoll, dRoll, aRoll), -1, 1);

    /* ------------------------------------------------------ heading --- */
    /*
     * The turn asked for, slowed to what the hill beside it leaves room for
     * (yawScale, see yawLook), and stopped on a heading that lands (see
     * hillStop).
     */
    const yawScale = hillStop ? 0 : k.yawScale;
    const rateCmd = (pd * Math.abs(pd) * K.yawRate + (rollActive ? sr * turn * steer : 0)) * yawScale;
    if (Math.abs(rateCmd) > 0.02) {
      k.hdg = null;
      // Feed forward what the damping will take, and correct the rest.
      S.pedal = clamp((rateCmd * dYaw + (rateCmd - yawRateRight) * K.yawBrake) / aYaw, -1, 1);
    } else {
      if (k.hdg === null && Math.abs(yawRateRight) < 0.12) k.hdg = ac.heading;
      if (k.hdg !== null) {
        let e = ac.heading - k.hdg;
        while (e > 180) e -= 360;
        while (e < -180) e += 360;
        S.pedal = clamp(
          ((-e * Math.PI) / 180) * gainP(T.wnYaw, aYaw) - yawRateRight * gainD(T.wnYaw, dYaw, aYaw),
          -1,
          1
        );
      } else {
        // Still turning from the last input: stop the turn, then take the heading.
        S.pedal = clamp((-yawRateRight * K.yawBrake) / aYaw, -1, 1);
      }
    }

    // The hard stop. Nothing above should ever get here; this is what makes
    // "cannot flip it from the keyboard" a guarantee rather than a tuning.
    if (Math.abs(pitch) > K.guard) S.cyclicPitch = -Math.sign(pitch);
    if (Math.abs(bank) > K.guard) S.cyclicRoll = -Math.sign(bank);
  }

  /* ------------------------------------------------ what it is doing --- */
  /*
   * Too close to a hillside is not the same news as too close to a roof.
   * On a hill, the ring (see `ring`) says whether any way round lands and,
   * if one does, which key is the shorter turn to it. Until the ring is
   * complete — a tenth of a second — the card says what it said before.
   */
  let hillWord = null;
  if (k.hill && k.ringN >= K.ring) {
    if (!k.ringMask) hillWord = 'steep';
    else {
      let best = 360;
      for (let i = 0; i < K.ring; i++) {
        if (!(k.ringMask & (1 << i))) continue;
        let d = (i * 360) / K.ring - ac.heading;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        if (Math.abs(d) < Math.abs(best)) best = d;
      }
      hillWord = best >= 0 ? 'hille' : 'hillq';
    }
  }
  // Following the ground down or up while it holds its height over it:
  // measured by the review, W held 10 s from the Kestrel start went from
  // 92.2 m to 78.2 m with HOLDING HEIGHT on the card and "down 380-520
  // ft/min" under it. It is the ground under the held height that moves,
  // not the height: in at 0.6 m/s of that, out at 0.3, so it does not
  // flicker, and only while the machine itself is going up or down.
  k.follow = Math.abs(k.grefV) > (k.follow ? 0.3 : 0.6) && Math.abs(vs) > 0.3;
  let state;
  if (!running) state = 'off';
  else if (S.keptEngine > 0) state = 'engine';
  else if (sit) state = 'ground';
  // Asked to turn, and going up first so nothing swings into the hill.
  else if (k.yawHeld) state = 'turnroom';
  // Asked to move beside steep rock, and going up first (see roomR): with
  // Ctrl held too, what to do about it is let go, as at the landing gate.
  else if (k.room) state = down && keysOn ? 'gate' : !keysOn && Math.abs(yawWant) > 0.02 ? 'turnroom' : 'room';
  // Stopped against rock beside it, a key still pushing that way.
  else if (k.wallHold || (keyCapped && gs < 1)) state = 'wall';
  else if (k.tooClose && (!k.hill || hillWord)) state = k.hill ? hillWord : k.tree ? 'tree' : 'tooclose';
  // Ctrl held with W A S D down and something holding it up: what to do
  // about it is let go, whichever of the two is doing the holding. Measured
  // in the browser: W and Ctrl together at 39 m/s said CLIMBING OVER HIGH
  // GROUND over flat grass, because the cruise floor and the gate are the
  // same height there.
  else if (down && handsOn && (k.gated || k.terrain)) state = 'gate';
  else if (k.terrain) state = 'terrain';
  else if (up) state = ac.onGround ? 'lifting' : 'climbing';
  else if (down && overWater && skidH < K.seaFloor + 2) state = 'water';
  else if (k.gated) state = 'settle';
  else if (down) state = skidH < K.landBand ? 'landing' : 'descending';
  else if (k.follow && k.holdX === null) state = 'following';
  else state = 'holding';
  k.state = state;
  if (!down || sit) k.hillTurn = false;
  else if (state === 'hille' || state === 'hillq') k.hillTurn = true;
  k.landed = ac.onGround;

  R.kid = true;
  R.kidState = state;
  R.driftFwd = vF;
  R.driftRight = vR;
  R.drift = Math.hypot(vF, vR);
  R.hoverAuth = 1;
  R.assistOn = true;
  R.assistActive = running;
  R.holdingHeight = k.holdH !== null && !sit;
  R.heldAGL = k.holdH;
  R.holdingSpot = k.holdX !== null;
  R.windTrimDeg = +((Math.atan(Math.hypot(k.iX, k.iZ) / G) * 180) / Math.PI).toFixed(1);
  R.trimRequest = 0;
  S.lastRequest = 0;
  R.collective = S.coll;
  R.collectivePilot = S.coll;
  R.lift = up ? 1 : down ? -1 : 0;
  R.vsTarget = vsT;
  R.heightAbove = skidH;
  R.landLimit = landLimit;
  R.engineKept = S.keptEngine > 0;
  publishHoverPoint(R, ac, SPEC);
  // The lever back into controls.throttle: see "the keys" above.
  k.leverOut = running ? clamp((S.coll - T.leverIdle) / (1 - T.leverIdle), 0, 1) : 0;
  c.throttle = k.leverOut;
}

/**
 * Print what the current numbers actually produce.
 *
 * Every claim in the comments above is a measurement, and this is how they
 * were measured. Call it from the console after changing anything in
 * ROTOR_TUNE or in the three arms in types.js:
 *
 *   (await import('/src/aircraft/rotor-assist.js')).describeRotorFeel(SPEC)
 */
export function describeRotorFeel(SPEC) {
  const T = ROTOR_TUNE;
  const disc = 0.675 * SPEC.mass * G;
  const rate = (arm, I, damp) => ((disc * arm) / I / damp) * 57.2958;
  return {
    rollRateDegPerSec: +rate(SPEC.rotorRollArm, SPEC.Izz, T.dampRoll).toFixed(1),
    pitchRateDegPerSec: +rate(SPEC.rotorPitchArm, SPEC.Ixx, T.dampPitch).toFixed(1),
    yawRateDegPerSec: +rate(SPEC.rotorYawArm, SPEC.Iyy, T.dampYaw).toFixed(1),
    hoverCollective: 0.5,
    hoverStickTravel: +((0.5 - T.collFloor) / (1 - T.collFloor)).toFixed(3),
  };
}

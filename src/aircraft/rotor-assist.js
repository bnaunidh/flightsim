/**
 * How the Skyhook handles, and the equipment that makes it handleable.
 *
 * Everything in this file exists because of one measurement. Anybody closing
 * a control loop on a laptop keyboard has a bang-bang input — the key is down
 * or it is up, there is no halfway — and between that key and the number they
 * are trying to hold there were four integrators:
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
 *   3. THE STABILITY ASSIST, which is the only part of this file that is
 *      actually an assist. Height hold, drift damping, heading hold and
 *      auto-level. It is real equipment — every search-and-rescue helicopter
 *      in the world has the first three — it ships ON, it says so on the HUD,
 *      and it can be switched off. It is not hidden, because a pilot who
 *      finds out later that the machine was flying itself has been cheated of
 *      the thing they were proud of. Every player flies the same lever, stick
 *      and pedals; the assist only ever moves those.
 *
 * Nothing here knows about missions, winches or pads. It is given an aircraft
 * and a timestep and it returns four numbers.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp } from '../core/noise.js';
const lerp = (a, b, t) => a + (b - a) * t;
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
  /*
   * The hold that was here (a PD on the height, 0.3 of collective at most,
   * captured only below 3 m/s and only below 45 kt) is replaced by the one
   * under THE STABILITY ASSIST further down: it captures at any vertical
   * speed and at any airspeed, on altitude rather than on the radar
   * altimeter, and it flies a vertical-speed loop through collectiveFor().
   * Two lessons from the old one are kept, because both were paid for:
   *
   * THE FORCE-TRIM. Without it the assist is a hidden integrator and it kills
   * people. Measured: tapping the collective-down key every four seconds from
   * 30 m, the old hold quietly cancelled each tap, so the lever crept 0.30
   * below the hover point while the machine sat level and the HUD read a
   * steady height; on the fifth tap the correction hit its stop and the
   * machine fell 23.8 m to 1.6 m in four seconds, 2,400 ft/min. So while the
   * hold flies, the lever on screen follows the collective it is using
   * (`leverFollow`), which is the single most useful thing the POWER gauge
   * can show: pick up a casualty and you watch the lever rise.
   *
   * ITS OWN HAND. The hold must not mistake the lever it is moving for the
   * pilot's. The input layer now says when a hand is on the lever
   * (controls.leverHeld); a caller that does not gets the old test below.
   */
  // Seconds the lever must be let go before the hold takes the height.
  captureDelay: 0.15,
  // Rate of change of the commanded collective, per second, above which the
  // pilot counts as flying it when nobody says so outright. The key ramp is
  // 0.62/s and the touch slider is far faster, so 0.09 is well clear of both
  // and well above the residue of the input smoother.
  cmdMoving: 0.09,

  /* --- drift damping --- */
  // Wanted horizontal deceleration per m/s of drift, 1/s. 0.55 gives a 1.8 s
  // time constant: hands off at 2 m/s, under 0.5 m/s in about four seconds,
  // which is the brief's number and is slow enough that it never feels like
  // the machine took the controls away.
  driftGain: 0.55,
  /*
   * Hover hold: the spot as well as the drift. Drift damping alone stops the
   * machine wherever it happens to be, and in wind every correction a pilot
   * makes leaves it a little further downwind: the heli missions' own pilot,
   * shuffling over a winch circle on Gannet Stack in 18 kt with taps of
   * W A S D, never held the circle long enough and ran out of time (600 s),
   * and could not settle onto Night Deck's rig in 20 kt for twelve minutes.
   * So with the stick centred and the machine slowed under spotTake, the
   * spot is taken and the drift loop is asked for a walk back to it — spotK
   * per metre, at most spotVmax — with the wind trim learning the rest. A
   * tap moves the machine and it holds where it stops.
   */
  spotTake: 1.2, // m/s over the ground
  spotSettle: 0.8, // s of the stick let go first
  trimAfter: 4, // s of the stick let go before the wind trim learns
  spotK: 0.3, // 1/s
  spotVmax: 2, // m/s
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
  windLean: 0.0045, // rad of lean per m/s of wind at the machine (see the feed-forward)
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
  // How hard the pedal brakes a turn the pilot has let go of, 1/s, before the
  // heading hold takes the heading (see the heading block in rotorAssist).
  yawBrake: 12,
  // The turn rate full pedal asks for in the hover, rad/s: 45 deg/s, so a turn
  // on the spot can be stopped where you wanted it (the airframe alone does 62).
  hoverYawRate: 0.785,
  /*
   * Q/E at speed is a turn, not a skid. With the assist on, full pedal in a
   * cruise also asks for this much bank (24 deg, inside envBankLo so the
   * envelope never pushes back on it), fading in with the cruise as the
   * hover's pedal rate fades out; the coordination below then keeps the nose
   * on the flight path. Measured in the node harness before: E held 6 s at
   * 45 m/s turned the nose 28 deg and the track 1 deg — she flew on
   * sideways, slowing, with the HUD saying "Q and E turn".
   */
  pedalBank: 0.42,
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
   * THE ENVELOPE, in every mode and with the assist on or off.
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
  // Measured again with 20-35 and 30-45 (the review of the first easy-mode build):
  // W held four seconds still peaked at -43.5 and A at 56 degrees of bank,
  // and letting go of W left the nose at -34 degrees, where it ran on to
  // 55 m/s. Fading the stick out does not stop a rotation that is already
  // going; the airframe's own damping lets it coast most of another thirty
  // degrees. So inside the band the envelope now also brakes the rotation
  // towards the limit (envArrest, per rad/s), and with the stick let go it
  // eases the machine back to the band's near edge (envReturn, per radian)
  // rather than leaving it hanging on the far one. Measured with these, in
  // the heli playtest's realistic section: W held four seconds peaks at
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
   * THE GROUND: the stick on and just over the skids, in every mode.
   * The envelope above starts where the skids leave the ground, and it was
   * not enough. Shift and W pressed together from the pad — the first thing
   * a player who has flown the aeroplane does, "power and go" — had the
   * stick full forward before the skids were light, so the lift-off went
   * nose first: measured (v62 checker, and the node harness, W pressed 0 to
   * 0.8 s after Shift, Normal or Realistic), "The propeller struck the
   * ground" at 0.5 m with the nose 15 to 19 degrees down; Shift and S, the
   * tail. From 1.0 s after Shift the skids were already clear and it flew.
   * The nose hard point is 0.9 m below the middle and about 5 m forward, so
   * on the skids it touches at about 18 degrees; v61's computer capped the
   * tilt at 18 and lifted off. So from the skids to liftClearHi metres of air
   * under them the stick is faded to liftStick of itself, the assist's own
   * lean is kept inside liftTilt, and the attitude is held inside liftTilt
   * (blending out to the envelope's near edge on the way up) by a stop like
   * the envelope's own. Parked, lever at idle, none of it touches a machine
   * resting on its skids (see the H1 note on `parked`), so a landing on a
   * slope is left where it sat. And it is a lift-off and touchdown guard, not
   * a low-flying one: it fades out with the ground speed (all there under
   * liftGsLo, gone by liftGsHi), so a pilot skimming the runway and flaring
   * has the whole stick, as before. Measured with these, Shift+W from the
   * pad: off the pad level and flying forward, no strike, in both modes.
   */
  liftClearLo: 0.3, // m of air under the skids: still on them
  liftClearHi: 2.5, // m: clear of the ground, the stick is all the pilot's
  liftGsLo: 6, // m/s over the ground: the guard is all there below this
  liftGsHi: 14, // m/s: and gone above this
  liftStick: 0.3, // the share of the stick kept on the skids
  liftTilt: 0.14, // radians, 8 degrees: the most it may tilt on or just over the skids
  liftReturn: 6, // per radian over liftTilt
  liftDamp: 0.5, // per rad/s of rotation while over it

  /*
   * THE POWER MARGIN, with the assist on.
   * The pitch and bank limits are separate, and together they let the disc
   * tilt further than full lever can hold up: at the envelope's -30 of pitch
   * and -37 of bank the disc points 46 degrees off the vertical and maxLift
   * (1.3 weights) carries 0.93 of the weight. Measured (v62 checker, node
   * harness): W held 8 s then W and A held, the height hold's lever pinned at
   * 100% and the machine sinking from -1 to -4.8 m/s as the speed climbed
   * past 70 m/s — 40 m lost in 15 s from 120 m, "The propeller struck the
   * ground" from 40 m — with the assist on and the panel saying it held the
   * height. W alone (30 of pitch, cos 0.87) and A alone (bank let go at 38)
   * each have the margin; it is the two together that run out. So while the
   * assist flies, the disc's tilt — pitch and bank together — is kept where
   * full lever still has powerReserve of the weight to spare: the stick
   * pushing it further fades out across powerBand below the limit, the
   * rotation outwards is braked (envArrest), and past it the machine is eased
   * back along both axes in proportion to their share of the tilt
   * (powerReturn). A hand on the lever or the assist switched off, nothing
   * here runs: a realistic pilot who dives and banks together has the lever
   * for it.
   */
  powerReserve: 0.06, // of the weight: lift to spare at full lever at the limit
  powerBand: 0.09, // radians, 5 degrees: the stick fades across this below the limit
  powerReturn: 3, // per radian over the limit

  /*
   * THE STABILITY ASSIST — what the hover assist adds now that every player
   * flies the lever. On by default; `ac.hoverAssist === false` switches all
   * of it off (Settings > Flying, or the assist key in the air).
   *
   * There used to be a second, separate flight computer here for easy and
   * normal: Shift and Ctrl were a spring-centred climb and descent COMMAND,
   * W A S D an attitude command, no autopilot, and the engine key refused in
   * the air. The game is for everybody now, so that is gone. What a first
   * flight needed from it is kept as assist equipment on the real controls:
   *
   *   Height hold   Let go of the lever, at any vertical speed, and the
   *                 machine stops where it can stop gently and holds that
   *                 altitude — at any speed, not only in the hover. The lever
   *                 then follows the hold (the force-trim note on
   *                 the height hold above), so the POWER gauge shows the hover point
   *                 and Shift or Ctrl pick up from there. It holds ALTITUDE,
   *                 not height above the ground: a hold on the radar
   *                 altimeter climbed sixty metres the moment a hover slid
   *                 off a hospital roof's edge onto the street.
   *
   *   Gentle arrival  While the lever is coming down, the sink is limited by
   *                 the height under the skids (landSinkMin, landDecel), so Ctrl held all
   *                 the way to the ground is a firm-but-fine touchdown and not
   *                 a crash.
   *
   *   Auto-level    Let go of the stick and the attitude comes back to level
   *                 at any speed; in the hover the drift damping and wind trim
   *                 above stop it over the ground as well.
   *
   * None of it moves the machine: it moves the lever and the cyclic, so the
   * rotor, the weight on the winch, the wind and the ground are all still the
   * real flight model.
   */
  // Height hold: where it may decide to stop, and how it gets there. The
  // capture point is the stopping point at hhDecel; the vertical-speed loop
  // round it asks for at most hhAMax and flies a square-root profile capped
  // at hhVsMax, so a capture from a 12 m/s climb never overshoots.
  hhDecel: 3, // m/s^2
  hhAMax: 4, // m/s^2
  hhVsMax: 6, // m/s
  hhPos: 0.8, // 1/s: height error to vertical speed near the target
  hhVk: 2.2, // 1/s: vertical-speed error to acceleration
  hhVi: 0.35, // integrator on the vertical-speed error, 1/s
  hhViMax: 0.08, // of collective
  // How fast the lever follows the hold, per second of collective error.
  leverFollow: 3,
  // Most collective the assist may add or take away before the lever has
  // caught up — and while Ctrl is held, what it may add to soften the arrival.
  assistClamp: 0.5,
  // Gentle arrival: the fastest sink allowed with this much air under the
  // skids is the speed that stops at landDecel and arrives at landSinkMin:
  // sqrt(landSinkMin^2 + 2 * landDecel * metres), up to landSinkMax. 7.4 m/s
  // at twenty metres, 3.5 at five, 1.6 at one.
  landSinkMin: 0.6, // m/s at the skids
  landDecel: 1.2, // m/s^2
  /*
   * The skids straddling a drop: one point over the deck, another over the
   * sea or the street. More than this many metres between the air under the
   * skid points and it is an edge, not a slope (a 14 degree slope across the
   * 2.4 m skids is 0.6 m): the arrival stops with the skids 1.2 m clear and
   * says CAN'T LAND HERE. Measured: the missions' pilot holding Ctrl with the
   * middle 3 m past Night Deck's rig edge in 20 kt set her down on the deck
   * skids alone, she tipped, and "The propeller struck the ground".
   */
  landStraddle: 1.5, // m
  landSinkMax: 9, // m/s
  /*
   * ...and not at speed. W and Ctrl held together is what "go there and come
   * down" means on a keyboard, and measured in the node harness it flew the
   * machine into the runway nose first at 56 m/s ("The propeller struck the
   * ground"), from a 3 s run-up as from an 8 s one. So while the lever is
   * coming down the skids are kept landKeepPerMs metres up for every m/s of
   * groundspeed over landGs (at most landKeepMax), and the card says to slow
   * down; let go of W, or brake with S, and it comes down the rest. A slide
   * onto a pad at a walk is not touched.
   */
  landGs: 5, // m/s
  landKeepPerMs: 0.6, // m per m/s
  landKeepMax: 15, // m
  /*
   * The height hold looks where it is going. Holding an altitude is what a
   * real altitude hold does, and it flies you into the next hill: the heli
   * missions' own pilot (heli-missions.browser.js), 45 m up out of Kestrel's
   * harbour with W held at Cormorant Cove, hit the hillside 17 s in, and
   * On Call's flew into a tower. So while the hold has the height and the
   * machine is moving, it keeps the skids landKeepPerMs metres per m/s of
   * groundspeed over landGs (as the arrival does, at most landKeepMax) above
   * the highest ground or roof under the next aheadS seconds of its track,
   * and climbs for it at up to floorVs. The new height is kept: it does not
   * dive back down the far side. A hover, or a walk over a pad, is not
   * touched; nor is anything with a hand on the lever.
   */
  aheadS: [1, 2, 3, 4.5, 6, 8, 10],
  hardClear: 2.5, // m: the least the hold leaves under any hard point
  floorVs: 12, // m/s: near full power
  // Auto-level at speed: the attitude loop's targets fade from the hover
  // assist's lean to level as the hover authority fades. Pitch and bank
  // natural frequencies are the hover loop's (wnRoll, wnPitch).

  /*
   * The airframe at speed: rotor drag and where the retreating blade stalls.
   *
   * At eighteen degrees the old numbers (full rotor drag, stall from
   * 46 m/s) ran out at 46.3 m/s — 89 kt, a slow machine — because rotor
   * drag is 130 N per m/s. A light single-engine helicopter cruises nearer
   * 60 m/s at well under eighteen degrees. These are the numbers the easy
   * and normal flight computer flew with, measured at 55.3 m/s after 45 s of
   * W flying east from the Kestrel start; they are the Skyhook's for
   * everybody now.
   */
  dragScale: 0.72,
  stallAt: 62,

  /*
   * THE AIR THE ROTOR WORKS IN (demo-helis, 2026-10-24). Four things a real
   * rotor does that the disc above did not, each a multiplier on the lift
   * that rotorAir() works out once a step and both physics.js (the force)
   * and collectiveFor() (the hold that inverts it) read — so the height
   * hold can never disagree with the lift about what the ground is doing.
   *
   *  GROUND EFFECT. Within about one rotor diameter of the ground the
   *  downwash is squeezed and the disc lifts more for the same pitch: up to
   *  geGain at the skids (hub about half a radius up), nothing at a hub
   *  height of 2 R. Real IGE figures run 10-25% at R/2; this is the gentler
   *  end, because the height hold has to fly through it without a bump.
   *
   *  TRANSLATIONAL LIFT. Flying out of its own downwash the rotor gets
   *  ettlGain more lift, fading in between ettlLo and ettlHi m/s (14-25 kt).
   *  It was a straight line to 24 m/s; this is the S-curve a pilot feels as
   *  the shudder-and-climb of ETL.
   *
   *  VORTEX RING STATE. Sinking fast (vrsVsLo..vrsVsHi m/s of descent) with
   *  power on and little airspeed (none above vrsGsHi) the disc settles into
   *  its own downwash and loses up to vrsLoss of its lift, with a buffet.
   *  The way out is airspeed (push forward) or the lever down — pulling more
   *  pitch deepens it, which is why the loss does not depend on the lever
   *  here (the hold would invert that into pulling harder). Scaled by the
   *  difficulty: the whole thing on Realistic, half on Normal, a quarter on
   *  Easy — the assisted descent profile (landSinkMax 9 m/s) only grazes
   *  its onset, so a child's vertical landing shudders and says so on the
   *  card, and a sim fan who drops at 11 m/s vertically gets the real thing.
   *
   *  THE ROTOR'S OWN SPEED (NR). Governed at 1 with the engine running.
   *  Engine out, it is driven by the air coming UP through the disc — the
   *  descent, and a flare's forward speed turned up through a nose-high
   *  disc — and bled by the blade pitch the lever asks for: autorotation.
   *  Lift goes with NR squared, and the upflow adds nrInflowColl of
   *  collective per nrInflowRef m/s of inflow (the induced angle of attack
   *  that makes a windmilling rotor lift at all). Lever down keeps NR;
   *  flare to arrest the descent and spin it up; pull at the bottom to
   *  cushion on what is stored in the blades. With the assist on it flies
   *  the whole thing (see autorotation in rotorAssist); off, it is yours.
   *
   *  RETREATING BLADE STALL at speed is the airframe's `rotorStallAt`
   *  (types.js, per type; the Skyhook's is stallAt above), with a nose-up
   *  and roll-away moment and a vibration scaled by rbsMoment, on top of
   *  the drag rise it always had.
   */
  geGain: 0.14,
  ettlLo: 7, // m/s
  ettlHi: 13, // m/s
  ettlGain: 0.11,
  vrsVsLo: 7, // m/s of descent
  vrsVsHi: 12, // m/s
  vrsGsLo: 6, // m/s of airspeed: fully in below
  vrsGsHi: 12, // m/s: none above
  vrsLoss: 0.35,
  vrsBuffet: 0.5, // of full-stick moment, fully in: a wobble a pilot feels, at a few radians a second
  // 1/s: engine on, NR comes up to 95% in about 3 s (the old visual spool's
  // 3 s). It was 0.35/s, which is 8.6 s to 95%: from a cold start a pilot
  // holding the lever full sat on the ground for 5.4 s after the engine came
  // on (0.9 s before this wave) — the card says "hold Shift until she lifts"
  // and nothing happened (checker, 2026-10-24).
  nrSpool: 1.0,
  nrInflowRef: 10, // m/s of upflow
  nrGain: 0.6, // 1/s per nrInflowRef of upflow, times the room left to 1.12
  nrBleed: 0.04, // 1/s at flat pitch
  nrCollBleed: 0.25, // 1/s more at full lever: a Bell 206 class rotor holds about 1 MJ against 300 kW at the hover, so the lever left up after a failure bleeds it at ~0.16/s
  nrInflowColl: 0.35, // collective the upflow is worth, per nrInflowRef
  autoColl: 0.08, // the lever the assist flies the glide at
  autoSpeed: 25, // m/s along the nose it holds in the glide (49 kt)
  autoFlareH: 45, // m under the skids: the flare begins
  autoPullH: 20, // m: level and pull — the sink profile takes the lever
  autoFlarePitch: 0.26, // radians, the envelope's 15 degrees
  autoFlareLowH: 8, // m: the flare is held down to here, then eased level
  autoDecel: 0.95, // m/s^2: the arrival's sink profile
  autoRunOnH: 3, // m: under this the sink is held, not slowed further
  autoRunOnVs: 1.5, // m/s: the run-on touchdown (300 ft/min, firm)
  rbsMoment: 0.03, // of the disc thrust times the arm, fully stalled
};

/**
 * Lift multiplier for the ground, from the hub's height over it: geGain at
 * z = R/2 (about the skids), 1 at 2 R and above. Pure, so settleOnGear()
 * can ask it for the parked machine.
 */
export function groundEffectFactor(hubHeight, R) {
  const z = Math.max(0.1, hubHeight);
  const t = clamp(1 - z / (2 * R), 0, 1);
  return 1 + ROTOR_TUNE.geGain * t * t * (1 / 0.5625); // t = 0.75 at R/2 → geGain exactly
}

/** How hard vortex ring state and retreating blade stall bite at this difficulty. */
export function realismScale(ac) {
  const d = ac && ac.difficulty;
  return d === 'realistic' ? 1 : d === 'easy' ? 0.25 : 0.5;
}

const AIR_UP = new THREE.Vector3();
/**
 * The air at the rotor this step: { ge, ettl, vrs, eff, inflow }, cached on
 * the Aircraft (ac._rotorAir), worked out once by rotorAssist() and read by
 * physics.js and collectiveFor(). `inflow` is the air coming up through the
 * disc, m/s, body up axis (positive in a descent or a flare).
 */
export function rotorAir(ac, SPEC) {
  const T = ROTOR_TUNE;
  const A = ac._rotorAir || (ac._rotorAir = { ge: 1, ettl: 1, vrs: 0, eff: 1, inflow: 0 });
  const R = SPEC.rotorRadius || 4.2;
  const hubY = Number.isFinite(SPEC.rotorHubY) ? SPEC.rotorHubY : 1.6;
  A.ge = groundEffectFactor(ac.agl + hubY, R);
  const V = ac.airspeed || 0;
  A.ettl = 1 + T.ettlGain * smoothstep(T.ettlLo, T.ettlHi, V);
  const up = ac.up(AIR_UP);
  // The machine's velocity through the air (physics.js _airRel: velocity less
  // the wind), when physics has worked it out; its ground velocity before.
  const air = ac._airRel || ac.vel;
  const rx = air.x;
  const ry = air.y;
  const rz = air.z;
  A.inflow = -(rx * up.x + ry * up.y + rz * up.z);
  const horiz = Math.hypot(rx, rz);
  const sink = smoothstep(T.vrsVsLo, T.vrsVsHi, -ac.vel.y);
  const slow = 1 - smoothstep(T.vrsGsLo, T.vrsGsHi, horiz);
  A.vrs = ac.engineOn && !ac.onGround ? sink * slow * realismScale(ac) : 0;
  A.eff = A.ge * A.ettl * (1 - A.vrs * T.vrsLoss);
  return A;
}

/**
 * Rotor thrust as a multiple of the empty machine's weight at sea level, for a
 * collective of 0..1. Two straight lines: 0 -> 0, 0.5 -> 1, 1 -> maxLift.
 * physics.js builds the force from this and the height hold inverts it (see
 * collectiveFor), so they cannot disagree about what the collective does.
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
  // Engine out, the lever is still the blade pitch (autorotation needs it
  // down, then pulled at the bottom); the idle's share of it goes with the
  // engine. The lift itself goes with NR squared, so a stopped rotor is
  // still a stopped rotor whatever the lever says.
  const want = (ac.engineOn ? T.leverIdle : 0) + clamp(ac.controls.throttle, 0, 1) * (1 - T.leverIdle);
  S.lever += (want - S.lever) * Math.min(1, dt * T.collSpool);
  return S.lever;
}

/**
 * The rotor's speed, NR, as a share of governed, and the collective the
 * upflow through a windmilling disc is worth. See THE ROTOR'S OWN SPEED in
 * ROTOR_TUNE. `S.nr` is the state; `ac.rotorNr` the published copy that
 * physics.js and the models read.
 */
function rotorSpeed(ac, S, dt, coll) {
  const T = ROTOR_TUNE;
  if (S.nr == null) S.nr = ac.engineOn ? 1 : 0;
  if (ac.engineOn) {
    S.nr += (1 - S.nr) * Math.min(1, dt * T.nrSpool);
  } else {
    const air = ac._rotorAir;
    const inflow = air ? Math.max(0, air.inflow) : 0;
    const drive = (inflow / T.nrInflowRef) * T.nrGain * Math.max(0, 1.12 - S.nr);
    const bleed = (T.nrBleed + clamp(coll, 0, 1) * T.nrCollBleed) * S.nr;
    // On the skids the blades simply wind down.
    S.nr = clamp(S.nr + (ac.onGround ? -bleed - 0.15 * S.nr : drive - bleed) * dt, 0, 1.12);
  }
  ac.rotorNr = S.nr;
  return S.nr;
}

/** Collective the upflow is worth on a windmilling rotor (0 with the engine running). */
function inflowCollective(ac) {
  if (ac.engineOn) return 0;
  const air = ac._rotorAir;
  return air ? clamp((Math.max(0, air.inflow) / ROTOR_TUNE.nrInflowRef) * ROTOR_TUNE.nrInflowColl, 0, 0.5) : 0;
}

/*
 * The total collective that gives a vertical acceleration of `aUp` m/s^2 right
 * now: the weight with whatever the winch carries, the air's density, the
 * translational lift and the tilt of the disc, and the disc's own drag going
 * up or down — every term physics.js applies to the rotor. The height hold,
 * the gentle arrival and the helicopter autopilot all ask this one function,
 * so none of them can disagree with the force.
 */
export function collectiveFor(ac, SPEC, aUp) {
  const mTot = SPEC.mass + (ac.extraMass || 0);
  const vs = ac.vel.y;
  const discArea = Math.PI * SPEC.rotorRadius * SPEC.rotorRadius;
  const discDrag = 0.5 * ac.density * vs * Math.abs(vs) * discArea * ROTOR_TUNE.discCD;
  // The air at the rotor (ground effect, translational lift, vortex ring),
  // as physics.js applies it; worked out here too for a caller that asks
  // before the first step.
  const air = ac._rotorAir || rotorAir(ac, SPEC);
  const rough = ac.failures && ac.failures.roughEngine ? 0.45 : 1;
  const nr = Number.isFinite(ac.rotorNr) ? Math.max(0.3, ac.rotorNr) : 1;
  const upY = ac.up(UP_TMP).y;
  const need = mTot * (G + aUp) + discDrag;
  const have = SPEC.mass * G * (ac.density / RHO0) * air.eff * Math.max(0.5, upY) * rough * nr * nr;
  // Less what the upflow already gives a windmilling disc — taken off the
  // UNCLAMPED inverse, or a pull past the top of the curve read as 1 minus
  // the inflow and the autorotation's cushion stopped at 0.86 of the lever
  // (measured in headless Chrome, 2026-10-24).
  const r = need / have;
  const raw = r <= 1 ? r * 0.5 : 0.5 + (r - 1) / (2 * (ROTOR_TUNE.maxLift - 1));
  return clamp(raw - inflowCollective(ac), 0, 1);
}
const UP_TMP = new THREE.Vector3();

/** The lever position (controls.throttle, 0..1) that puts the blades at `coll`. */
export function leverFor(coll) {
  const T = ROTOR_TUNE;
  return clamp((coll - T.leverIdle) / (1 - T.leverIdle), 0, 1);
}

/*
 * One of the Aircraft's own rules, taught what a helicopter is.
 *
 * The rule is written in physics.js for aeroplanes, in code that is not the
 * rotor's, so rather than branch inside it the helicopter's version is put in
 * front of it here, on this one Aircraft, once. The wrapper asks S.rotor —
 * set by rotorAssist() on every helicopter step and cleared by physics.js on
 * every other — and otherwise hands straight through, so an aeroplane gets
 * exactly the method it always had.
 *
 *   gradeTouchdown  A helicopter lands on an H, not on a centreline, and at a
 *                   walk, not at 62 kt. Measured 2026-09-25 on the unmodified
 *                   rules: a 90 ft/min vertical touchdown scored 33/100 "not
 *                   on the runway", and one on the middle of St Brendan's H
 *                   was scored by its distance from runway 09's centreline.
 *                   See rotorTouchdown().
 *
 * (A second wrapper refused the engine key in the air for the old easy-mode
 * flight computer, which could not fly an autorotation. That computer is
 * gone, and the key does what it does in every other aircraft.)
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
      // The altitude the height hold is holding (world y, metres), or null.
      heldY: null,
      // The total collective the hold wants, for the lever to follow.
      leverWant: null,
      // The hold's vertical-speed integrator, m/s^2.
      hhI: 0,
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
      // True while this Aircraft is a rotorcraft: set here every step, and
      // cleared by physics.js on every step it is not. See hookAircraft().
      rotor: true,
      hooked: false,
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
   * counting. Every held height and learned lean belongs to the flight it was
   * learned on: carried over, a hold from the last mission drags the machine
   * towards a height that belonged to a different island.
   */
  if (ac.airborneTime === 0 && ac.groundTime === 0) {
    S.heldY = null;
    S.leverWant = null;
    S.hhI = 0;
    S.floorClimb = false;
    S.floorY = -Infinity;
    S.spot = null;
    S.heldHdg = null;
    S.still = 0;
    S.lastCmd = null;
    S.trimX = 0;
    S.trimZ = 0;
    S.leanSaturated = false;
    S.lastRequest = 0;
    S.lever = ac.engineOn ? T.leverIdle + clamp(ac.controls.throttle, 0, 1) * (1 - T.leverIdle) : 0;
    S.nr = ac.engineOn ? 1 : 0;
    S.autoT = 0;
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

  const lever = leverCollective(ac, S, dt);
  const skidH = heightAboveSkids(ac, S, SPEC);
  // The air at the disc this step, and the rotor's own speed through it.
  rotorAir(ac, SPEC);
  const nr = rotorSpeed(ac, S, dt, lever + S.collective);
  const inflowColl = inflowCollective(ac);
  /*
   * Resting on its skids with the lever at idle. Nothing in the attitude
   * loop or the ground stop below may touch a machine parked like this: see
   * the H1 note on the attitude loop (it rocked a parked machine) and the
   * ground note in ROTOR_TUNE (a landing on a slope is left where it sat).
   */
  const parked = ac.onGround && lever <= T.leverIdle + 0.02;
  // How much of "on the ground" the machine is: 1 on the skids, 0 with
  // liftClearHi metres of air under them or moving faster than liftGsHi
  // over the ground. See THE GROUND in ROTOR_TUNE.
  const nearG = (1 - smoothstep(T.liftClearLo, T.liftClearHi, skidH)) * (1 - smoothstep(T.liftGsLo, T.liftGsHi, ac.groundSpeed));
  // The most the machine may tilt here, radians: liftTilt on the skids,
  // blending out to the envelope's near edge as it climbs away.
  const liftLimP = T.liftTilt + (T.envPitchLo - T.liftTilt) * (1 - nearG);
  const liftLimR = T.liftTilt + (T.envBankLo - T.liftTilt) * (1 - nearG);

  /*
   * Who is flying it. `hoverAssist === false` is the switch, and switched off
   * none of this runs. When the autopilot is flying a helicopter it is the
   * pilot (main.js sets `autopilotOn`): it holds its own height, speed and
   * heading through the lever and the stick, and two loops on one machine is
   * the argument the fade below was written to stop. The envelope at the end
   * runs either way.
   */
  const assist = !!SPEC.rotor && ac.hoverAssist !== false && !ac.autopilotOn && !ac.crashed;
  /*
   * Autorotation, flown by the assist: engine out, in the air, the rotor
   * still turning. It lowers the lever to the glide setting, holds autoSpeed
   * along the nose (a glide needs airspeed: a vertical autorotation comes
   * down at twice the rate and has nothing to flare with), and from
   * autoFlareH flies the gentle-arrival sink profile on the lever with the
   * nose coming up to trade the speed for lift — the same profile a landing
   * under power uses, so the ground arrives at the same gentle rate. With
   * the assist off the pilot does all of it: lever down, nose down, flare,
   * pull. The drift loop, the spot hold and the heading hold stand down (a
   * glide is not a hover); the attitude loop flies the pitch target below.
   */
  const auto = assist && !ac.engineOn && !ac.onGround && nr > 0.15;
  const on = assist && (ac.engineOn || auto);
  // The hover regime's share: drift damping, wind trim and the heading hold.
  const auth = on && !auto ? hoverAuthority(ac.groundSpeed) : 0;
  const live = auth > 0.01;
  S.autoT = auto ? (S.autoT || 0) + dt : 0;

  /* ---------------------------------------------------------- height --- */
  /*
   * Is the pilot's hand on the lever? The input layer says so outright
   * (`controls.leverHeld`: a collective key down, a trigger pulled, a thumb on
   * the touch slider). Anything that only writes `controls.throttle` — a test
   * harness, a replay — gets the old guess, which is whether the lever is
   * moving; subtracting the assist's OWN follow-up from what it sees, or it
   * mistakes its own hand on the lever for the pilot's (that cost an
   * afternoon once: the hold never captured again after the first tap).
   */
  const cmd = ac.controls.throttle;
  const selfMove = (S.lastRequest || 0) * dt;
  const moving = S.lastCmd === null || Math.abs(cmd - S.lastCmd - selfMove) > T.cmdMoving * dt;
  S.lastCmd = cmd;
  const held = typeof ac.controls.leverHeld === 'boolean' ? ac.controls.leverHeld : moving;

  /*
   * Height hold. Let go of the lever and, a moment later, the machine stops
   * where it CAN stop gently — the stopping point at hhDecel from whatever it
   * is doing, climbing at twelve metres a second or sinking at five — and
   * holds that altitude. The old hold refused to capture above 3 m/s, so
   * Shift held for four seconds left the lever at 100% and the machine
   * climbed at 12 m/s to 228 m with the panel saying HOVER ASSIST; that was
   * the first thing every new pilot found.
   */
  let arriving = false;
  let autoPitch = 0;
  if (auto) {
    S.still = 0;
    S.heldY = null;
    S.hhI = 0;
    S.floorClimb = false;
    S.spot = null;
    // Forward speed along the nose, for the glide and the flare.
    const vFwd = driftFwd;
    if (skidH > T.autoFlareH) {
      // The glide: lever to the autorotation setting, nose for autoSpeed.
      S.leverWant = T.autoColl;
      autoPitch = clamp((vFwd - T.autoSpeed) * 0.06, -0.26, 0.26);
    } else {
      /*
       * The arrival, in the order a pilot flies it. FLARE first: from
       * autoFlareH the nose comes up (to the envelope's 15 degrees at the
       * glide speed) with the lever still down, so the forward speed goes
       * up through the disc — the descent slows and NR builds instead of
       * bleeding. Then LEVEL AND PULL: under autoPullH the gentle landing's
       * own sink profile takes the lever, cushioning on what the blades
       * have stored, and the nose eases level for the skids (the tail guard
       * touches at nineteen degrees; see models/skyhook.js).
       */
      const room = Math.max(0, skidH);
      if (skidH > T.autoPullH) {
        S.leverWant = T.autoColl;
      } else {
        /*
         * Its own profile: decelerate at autoDecel down to autoRunOnH, then
         * hold autoRunOnVs to the ground — a run-on touchdown at a steady
         * metre and a half a second. A powered landing's profile ends at
         * 0.6 m/s and asks for its hardest pull in the last four metres,
         * which is exactly where a windmilling rotor has the least to give:
         * measured, the lever hit its stop at 4 m with NR at 0.84 and the
         * sink ran away again to 4.7 m/s at the ground.
         */
        const sinkMax = Math.min(T.landSinkMax, Math.sqrt(T.autoRunOnVs * T.autoRunOnVs + 2 * T.autoDecel * Math.max(0, room - T.autoRunOnH)));
        const vErr = -sinkMax - ac.vs;
        const want = collectiveFor(ac, SPEC, clamp(T.autoDecel + vErr * T.hhVk, 0, T.hhAMax));
        S.leverWant = vErr > -0.5 ? Math.max(T.autoColl, want) : T.autoColl;
      }
      // The full flare from 20 m/s up: the speed the glide actually settles at.
      const speedFrac = clamp(vFwd / 20, 0, 1.2);
      // Held to autoFlareLowH, then eased level for the skids by 2.5 m.
      // (Level by the last metre and a half: a tail-low touch on wheels
      // far aft rocks a long machine onto its nose — the Chinook, measured.)
      const flare = Math.min(T.autoFlarePitch * speedFrac, lerp(0.0, T.autoFlarePitch, smoothstep(1.5, T.autoFlareLowH, skidH)));
      autoPitch = vFwd > 3 ? flare : 0;
    }
    S.collective = clamp(S.leverWant - lever, -1, 1);
    arriving = skidH <= T.autoFlareH && S.collective > 0.005;
  } else if (!on || held || ac.onGround) {
    S.still = 0;
    S.heldY = null;
    S.leverWant = null;
    S.hhI = 0;
    S.floorClimb = false;
  } else if (S.heldY === null) {
    S.still += dt;
    if (S.still >= T.captureDelay) {
      const vs = ac.vs;
      // Never under the ground: a capture in a fast descent stops a metre
      // over whatever the skids are coming down on.
      S.heldY = Math.max(ac.pos.y + (vs * Math.abs(vs)) / (2 * T.hhDecel), ac.pos.y - skidH + 1);
      S.hhI = 0;
    }
  }
  let gated = false;
  let edge = false;
  let floorUp = false;
  if (auto) {
    /* flown above */
  } else if (S.heldY !== null) {
    // Over the ground ahead: see aheadS. Looked at ten times a second.
    S.aheadT = (S.aheadT || 0) - dt;
    if (S.aheadT <= 0) {
      S.aheadT = 0.1;
      const keep = clamp((ac.groundSpeed - T.landGs) * T.landKeepPerMs, 0, T.landKeepMax);
      S.floorY = keep > 0 ? groundAhead(ac, S, T) + (S.skidOff || 1.69) + keep : -Infinity;
      /*
       * And in the hover, the tail, the nose and the wing tips kept clear of
       * the ground under each of them, not only the skids of the ground
       * under the middle. Measured: the missions' pilot holding a winch hover
       * 16.5 m over Gannet Stack's ledge, drifting at 1 m/s in 18 kt, put the
       * tail into the higher rock behind it.
       */
      S.floorY = Math.max(S.floorY, hardFloor(ac, SPEC, T.hardClear));
    }
    if (S.floorY > S.heldY) {
      S.heldY = S.floorY;
      floorUp = true;
      S.floorClimb = true;
    }
    // A square-root profile towards the held height, so the last metres are
    // as gentle as the first: it never overshoots, and overshoot by a cliff
    // or under a winch cable is the one thing a height hold must not do.
    const err = S.heldY - ac.pos.y;
    const e = Math.abs(err);
    if (e < 2) S.floorClimb = false;
    const vsCap = err > 0 && S.floorClimb ? T.floorVs : T.hhVsMax;
    const vsWant = Math.sign(err) * Math.min(e * T.hhPos, Math.sqrt(2 * T.hhDecel * e), vsCap);
    const vErr = vsWant - ac.vs;
    if (Math.abs(vErr) < 1.5) S.hhI = clamp(S.hhI + vErr * T.hhVi * dt, -0.8, 0.8);
    const aCmd = clamp(vErr * T.hhVk + S.hhI, -T.hhAMax, T.hhAMax);
    S.leverWant = collectiveFor(ac, SPEC, aCmd);
    S.collective = clamp(S.leverWant - lever, -T.assistClamp, T.assistClamp);
  } else if (on && held && !ac.onGround) {
    /*
     * Gentle arrival. The lever coming down at the bottom of its travel is a
     * third of a g of lift, which is a 6 m/s^2 fall; held to the ground, that
     * was a crash from any height worth the name. So while the pilot is
     * flying the lever the sink is limited by the air under the skids: up to
     * 9 m/s high up, 3.5 m/s at five metres, 0.6 m/s at the skids — a
     * profile that slows at landDecel, so it can be flown. It only ever adds
     * lift, and only near and past the limit. Moving fast over the ground it
     * stops short of it (see landGs), and under that height it climbs back.
     */
    const keep = clamp((ac.groundSpeed - T.landGs) * T.landKeepPerMs, 0, T.landKeepMax);
    // The structures under her count too (see nearBoxes): a box is not
    // ground the skids can stand on, so over one she stops clear of it.
    NEAR = nearBoxes(ac, S, dt);
    NEAR_Y = ac.pos.y;
    BOX_HIT = false;
    const skidClear = Math.min(skidH, pointsClear(ac, SPEC.gearPoints, skidH));
    // A wing tip, the nose or the tail over something the skids are not
    // (a deck's or a roof's edge, a rock): it stops with them clear rather
    // than putting them into it, and the card says why.
    const hardClear = pointsClear(ac, SPEC.hardPoints, Infinity);
    NEAR = null;
    const hardEdge = hardClear < skidClear + 0.05;
    // And the skids themselves across an edge: see landStraddle.
    const straddle = pointsClear(ac, SPEC.gearPoints, -Infinity, true) - skidClear > T.landStraddle;
    edge = hardEdge || straddle || BOX_HIT;
    const room = Math.min(
      skidClear,
      hardEdge ? hardClear - T.hardClear : Infinity,
      straddle ? skidClear - 1.2 : Infinity,
      BOX_HIT ? Math.min(skidClear, hardClear) - T.hardClear : Infinity
    ) - keep;
    const sinkMax = room >= 0
      ? Math.min(T.landSinkMax, Math.sqrt(T.landSinkMin * T.landSinkMin + 2 * T.landDecel * room))
      : -Math.min(2, -room * 0.8);
    gated = keep > 0 && room < 1.5;
    const vErr = -sinkMax - ac.vs;
    if (vErr > -0.5) {
      // The profile's own deceleration, fed forward, plus the error.
      const want = collectiveFor(ac, SPEC, clamp(T.landDecel + vErr * T.hhVk, 0, T.hhAMax));
      if (want > lever) {
        // Kept up at speed it may take the whole lever: the stub wing pushes
        // down hard with the nose 25 degrees down at 60 m/s.
        S.collective = Math.min(want - lever, keep > 0 ? 1 : T.assistClamp);
        arriving = S.collective > 0.005;
      }
    }
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
   * reads wrong and is right.
   */
  const coll = clamp(lever + S.collective, 0, 1);
  S.coll = coll;
  const disc = (0.35 + coll * 0.65) * SPEC.mass * G;
  const aRoll = Math.max(0.2, (disc * SPEC.rotorRollArm) / SPEC.Izz);
  const aPitch = Math.max(0.2, (disc * SPEC.rotorPitchArm) / SPEC.Ixx);
  const aYaw = Math.max(0.2, (disc * SPEC.rotorYawArm) / SPEC.Iyy);

  /* ------------------------------------------------------- wind trim --- */
  /*
   * Wind up the trim while the assist is flying the hover and the stick is
   * centred; bleed it away when it is not. Anti-windup is the saturation
   * test on the total demand further down — the integrator is frozen there
   * rather than here, because it is the TOTAL lean that runs out of room.
   */
  const stickCentred =
    Math.abs(ac.controls.roll) < T.stickDead && Math.abs(ac.controls.pitch) < T.stickDead;
  /* ------------------------------------------------------ hover hold --- */
  // See spotTake. The velocity the drift loop is asked for, in world axes.
  let wantVx = 0;
  let wantVz = 0;
  if (!live || !stickCentred || ac.onGround || auth < 0.9) {
    S.spot = null;
    S.spotWait = 0;
  } else {
    // How long the stick has been let go (the wind trim asks too).
    S.spotWait = (S.spotWait || 0) + dt;
  }
  if (!S.spot && S.spotWait > 0) {
    // Not the moment the stick centres: a short tap has hardly started the
    // machine moving by then, and a spot taken there pulls it straight back
    // (measured: 0.15 s taps moved it nowhere). Once it has been let go for
    // spotSettle and is slow, the spot is where the drift damping would
    // stop it anyway (it slows at driftGain per second).
    if (S.spotWait >= T.spotSettle && ac.groundSpeed < T.spotTake) {
      S.spot = { x: ac.pos.x + ac.vel.x / T.driftGain, z: ac.pos.z + ac.vel.z / T.driftGain };
    }
  }
  if (S.spot) {
    const ex = S.spot.x - ac.pos.x;
    const ez = S.spot.z - ac.pos.z;
    const ed = Math.hypot(ex, ez);
    if (ed > 40) S.spot = null;
    else if (ed > 0.05) {
      const v = Math.min(ed * T.spotK, T.spotVmax);
      wantVx = (ex / ed) * v;
      wantVz = (ez / ed) * v;
    }
  }
  const errVx = ac.vel.x - wantVx;
  const errVz = ac.vel.z - wantVz;
  // Learned only while the stick has been let go for trimAfter: wound in the
  // gaps between taps, it took the taps themselves for wind and leaned
  // against them, and the machine wandered 2 m back once they stopped.
  const settled = (S.spotWait || 0) >= T.trimAfter;
  if (live && stickCentred && settled && !S.leanSaturated) {
    // The trim vector points the way the machine must LEAN, so it winds
    // against the drift: a persistent drift to the east asks for a lean to
    // the west, and once the lean matches the wind the drift stops and the
    // integrator stops winding, which is the whole trick.
    S.trimX -= T.trimGain * errVx * dt * auth;
    S.trimZ -= T.trimGain * errVz * dt * auth;
    const tm = Math.hypot(S.trimX, S.trimZ);
    if (tm > T.trimMax) {
      S.trimX *= T.trimMax / tm;
      S.trimZ *= T.trimMax / tm;
    }
  } else if (!live || ac.onGround) {
    const bleed = Math.max(0, 1 - T.trimBleed * dt);
    S.trimX *= bleed;
    S.trimZ *= bleed;
  }
  // ...and with a hand on the stick in the hover it is kept, not bled. It
  // bled whenever the stick was off centre, so every tap of W A S D to
  // shuffle over a winch circle threw away the wind's lean and the machine
  // sagged downwind for the ten seconds it took to learn it again.
  /*
   * And the lean the wind needs, felt rather than learned: the wind at the
   * machine is its velocity less its velocity through the air, and in the
   * hover the lean that balances it is windLean per m/s (the trim this loop
   * learns, measured hands off: 0.011 rad at 5 kt, 0.047 at 20, 0.072 at 30,
   * the same at any heading). Learning alone took four seconds hands off and
   * ten to settle, so a player tapping W A S D every few seconds in 20 kt
   * sagged back downwind after every tap and never got closer: the missions'
   * pilot spent ten minutes 7 m off Night Deck's rig (node harness, 60 taps:
   * 5.8-7.0 m off before; see the playtest's tap check after). The trim
   * still learns what is left over.
   */
  const air = ac._airRel;
  const ffX = air && live ? -T.windLean * (ac.vel.x - air.x) : 0;
  const ffZ = air && live ? -T.windLean * (ac.vel.z - air.z) : 0;
  const leanX = S.trimX + ffX;
  const leanZ = S.trimZ + ffZ;
  const trimFwd = leanX * fx + leanZ * fz;
  const trimRight = leanX * -fz + leanZ * fx;

  if (on) {
    /* ------------------------------------------------------- attitude --- */
    /*
     * In the hover: outer loop, how far to lean to kill the drift; inner
     * loop, hold that lean. Two shallow loops in series are stable and one
     * deep one is not, which is the whole reason a hover is hard to fly and
     * easy to stabilise. At speed the lean it asks for fades to LEVEL with
     * the hover authority: let go of the stick in a cruise and the machine
     * rolls its wings level and lifts its nose to the horizon, which slows
     * it until the hover assist takes over and stops it over the ground.
     *
     * Signs, worked out once and then measured:
     *   bank is positive right-wing-down, and a positive bank accelerates the
     *   machine to the RIGHT, so killing a rightward drift needs a negative
     *   bank. Bank rate is -omega.z, because +Z torque is left-wing-down.
     *   Pitch is positive nose-up and a nose-up attitude decelerates, so
     *   killing a forward drift needs a positive pitch. Pitch rate is +omega.x.
     *   The trim vector leans the way the machine must lean, so its rightward
     *   component adds straight into the bank demand, and its forward
     *   component subtracts from the pitch demand.
     */
    const bank = ac.bankAngleRad();
    const pitch = Math.asin(clamp(f.y, -1, 1));
    let tgtBank = 0;
    let tgtPitch = 0;
    if (live) {
      // The drift against what the hover hold wants, in the heading frame.
      const eFwd = errVx * fx + errVz * fz;
      const eRight = errVx * -fz + errVz * fx;
      const propBank = clamp(Math.atan((-T.driftGain * eRight) / G), -T.tiltMax, T.tiltMax);
      const propPitch = clamp(Math.atan((T.driftGain * eFwd) / G), -T.tiltMax, T.tiltMax);
      const rawBank = propBank + trimRight;
      const rawPitch = propPitch - trimFwd;
      tgtBank = clamp(rawBank, -T.tiltTotal, T.tiltTotal);
      tgtPitch = clamp(rawPitch, -T.tiltTotal, T.tiltTotal);
      // Anti-windup. Once the lean is at its stop the integrator must stop
      // winding. Read on the NEXT step, which costs one frame of lag and
      // keeps this a single straight-line pass.
      S.leanSaturated = rawBank !== tgtBank || rawPitch !== tgtPitch;
      tgtBank *= auth;
      tgtPitch *= auth;
      // On and just over the skids the assist's own lean is kept inside the
      // ground stop's limit too (THE GROUND in ROTOR_TUNE): a lift-off into a
      // 25 kt wind is not a lift-off at eleven degrees.
      if (nearG > 0.001) {
        tgtBank = clamp(tgtBank, -liftLimR, liftLimR);
        tgtPitch = clamp(tgtPitch, -liftLimP, liftLimP);
      }
    } else {
      S.leanSaturated = false;
    }
    // Autorotation: the glide's nose, wings level (see `auto` above).
    if (auto) {
      tgtPitch = autoPitch;
      tgtBank = 0;
    }
    // See pedalBank: the pedal at speed banks her into the turn.
    const wCruise = 1 - auth;
    if (wCruise > 0.001 && !ac.onGround) tgtBank += clamp(ac.controls.yaw, -1, 1) * T.pedalBank * wCruise;

    /*
     * Not on the skids with the lever down. Nothing here knew the machine
     * was standing on the ground, so the attitude loop commanded cyclic to
     * "level" a machine already resting on settled skids and rocked it:
     * measured in tests/features/settle.mjs, realistic, engine at idle, it
     * ended 0.601 degrees off the attitude it spawned in (the limit is 0.6).
     * Parked, 0.174. It comes back the moment the lever rises off idle or the
     * skids unload, so a lift-off is levelled exactly as before. `parked` is
     * worked out once, beside the lever, because the ground stop in the
     * envelope asks the same question.
     */
    const wRoll = parked ? 0 : handsOff(ac.controls.roll);
    if (wRoll > 0.001) {
      const kp = gainP(T.wnRoll, aRoll);
      const kd = gainD(T.wnRoll, T.dampRoll, aRoll);
      const bankRate = -ac.omega.z;
      S.cyclicRoll = clamp((tgtBank - bank) * kp - bankRate * kd, -1, 1) * wRoll;
    }

    const wPitch = parked ? 0 : handsOff(ac.controls.pitch);
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
     * rotating underneath it. Hover regime only — at speed the fin keeps the
     * nose on the flight path by itself.
     *
     * `heading` is degrees and increases to the RIGHT. After the sign fix,
     * positive pedal yaws right, and yaw rate to the right is -omega.y.
     */
    /*
     * And the pedals are a RATE while the hover assist flies: the turn follows
     * the pedal, and stops when it is let go. Left to the airframe's own
     * damping, E held two seconds and let go ran on another 35 degrees
     * (measured in the node harness), and braking only once the key was up
     * still ran on 19, because the pedal takes a fifth of a second to spring
     * back and the machine was turning at 62 deg/s. Asking for the rate the
     * pedal stands for — hoverYawRate at full travel, nothing centred — brakes
     * the moment the pedal starts back. With the pedal centred and the turn
     * stopped, the heading hold takes the heading.
     */
    const wYaw = live ? auth : 0;
    const yawRateRight = -ac.omega.y;
    const kb = Math.max(0, (T.yawBrake - T.dampYaw) / aYaw);
    if (wYaw > 0.001) {
      const centred = Math.abs(ac.controls.yaw) < T.stickDead;
      if (!centred) S.heldHdg = null;
      else if (S.heldHdg === null && Math.abs(ac.omega.y) < 0.06) S.heldHdg = ac.heading;
      if (S.heldHdg === null) {
        // Up to twice full pedal: it is added to the pilot's, which is still
        // springing back, and has to be able to outweigh it.
        const cmdRate = clamp(ac.controls.yaw, -1, 1) * T.hoverYawRate;
        S.pedal = clamp((cmdRate - yawRateRight) * kb, -2, 2) * wYaw;
      } else {
        let e = ac.heading - S.heldHdg;
        while (e > 180) e -= 360;
        while (e < -180) e += 360;
        const kp = gainP(T.wnYaw, aYaw);
        const kd = gainD(T.wnYaw, T.dampYaw, aYaw);
        S.pedal = clamp((-e * Math.PI) / 180 * kp - yawRateRight * kd, -1, 1) * wYaw;
      }
    } else {
      S.heldHdg = null;
    }
    /*
     * A banked turn at speed, coordinated: the nose is turned at the rate the
     * bank is turning the flight path, and kept on it. Without it A or D at
     * 28 m/s banked to 39 degrees and the nose came round only 13 degrees in
     * four seconds — the machine sliding sideways through the turn, which a
     * pilot fixes with the pedals and an aeroplane's own fin does by itself.
     * Fades in with the cruise; the pilot's pedal still adds to it.
     */
    const wTurn = 1 - auth;
    if (wTurn > 0.001 && !ac.onGround) {
      const bankNow = ac.bankAngleRad();
      const turnRate = (G * Math.tan(clamp(bankNow, -1.2, 1.2))) / Math.max(10, ac.airspeed);
      S.pedal += clamp((turnRate - yawRateRight) * kb + ac.beta * 1.5, -1, 1) * wTurn;
    }
  } else {
    S.heldHdg = null;
    S.leanSaturated = false;
  }

  /* -------------------------------------------------------- envelope --- */
  /*
   * See envPitchLo in ROTOR_TUNE. The pilot's stick is faded towards the
   * limit it is pushing at — never away from it, so recovering is always
   * full authority — and past the limit the machine is flown back. Done as a
   * correction added to the assist's output, because the caller adds that to
   * the stick: `-stick * (1 - fade)` is the stick scaled by `fade`.
   */
  if (SPEC.rotor && !ac.crashed) {
    const pitchNow = Math.asin(clamp(f.y, -1, 1));
    const bankNow = ac.bankAngleRad();
    const sp = clamp(ac.controls.pitch, -1, 1);
    const sr = clamp(ac.controls.roll, -1, 1);
    // Pitch rate is +omega.x (nose up); bank rate is -omega.z (right wing
    // down). `sg` is which way out the attitude is, `rateOut` how fast it is
    // going further that way.
    const sgP = pitchNow < 0 ? -1 : 1;
    const sgR = bankNow < 0 ? -1 : 1;
    const outP = Math.abs(pitchNow);
    const outR = Math.abs(bankNow);
    const rateOutP = sgP * ac.omega.x;
    const rateOutR = sgR * -ac.omega.z;
    if (!ac.onGround) {
      // Positive stick pitch is nose UP; positive stick roll is right wing DOWN.
      const towardP = sp > 0 ? pitchNow : -pitchNow;
      const towardR = sr > 0 ? bankNow : -bankNow;
      const fadeP = 1 - smoothstep(T.envPitchLo, T.envPitchHi, towardP);
      const fadeR = 1 - smoothstep(T.envBankLo, T.envBankHi, towardR);
      S.cyclicPitch -= sp * (1 - fadeP);
      S.cyclicRoll -= sr * (1 - fadeR);
      /*
       * Brake the rotation outwards across the band, and hands off, come back
       * to its near edge. See envArrest.
       */
      if (outP > T.envPitchLo) {
        const band = smoothstep(T.envPitchLo, T.envPitchHi, outP);
        if (rateOutP > 0) S.cyclicPitch -= sgP * clamp(rateOutP * T.envArrest, 0, 1) * band;
        if (Math.abs(sp) < T.stickDead) {
          S.cyclicPitch -= sgP * clamp((outP - T.envPitchLo) * T.envReturn, 0, 0.6);
          // And the aeroplane's trim is not allowed to hold it out there: see
          // envTrimBleed. Trim adds to the elevator, + is nose up.
          if (ac.trim * sgP > 0) ac.trim *= Math.max(0, 1 - T.envTrimBleed * dt);
        }
      }
      if (outR > T.envBankLo) {
        const band = smoothstep(T.envBankLo, T.envBankHi, outR);
        if (rateOutR > 0) S.cyclicRoll -= sgR * clamp(rateOutR * T.envArrest, 0, 1) * band;
        if (Math.abs(sr) < T.stickDead) S.cyclicRoll -= sgR * clamp((outR - T.envBankLo) * T.envReturn, 0, 0.6);
      }
      const overP = outP - T.envPitchHi;
      if (overP > 0) S.cyclicPitch -= Math.sign(pitchNow) * clamp(overP * 4, 0, 1) + ac.omega.x * 0.4;
      const overR = outR - T.envBankHi;
      if (overR > 0) S.cyclicRoll -= Math.sign(bankNow) * clamp(overR * 4, 0, 1) - ac.omega.z * 0.4;

      /* ------------------------------------------------- power margin --- */
      /*
       * See THE POWER MARGIN in ROTOR_TUNE. The disc's tilt from the vertical
       * is pitch and bank together — its up vector's height is
       * cos(pitch) * cos(bank) — and the limit is the tilt at which full
       * lever still carries the weight plus powerReserve. The stick fades
       * out, the rotation outwards is braked and the machine is eased back
       * along both axes in proportion to their share of the tilt.
       */
      if (on) {
        const upY = clamp(Math.cos(pitchNow) * Math.cos(bankNow), -1, 1);
        const tiltNow = Math.acos(upY);
        const tiltHi = Math.acos(clamp((1 + T.powerReserve) / T.maxLift, 0, 1));
        const band = smoothstep(tiltHi - T.powerBand, tiltHi, tiltNow);
        if (band > 0.001) {
          const shP = outP / Math.max(1e-3, outP + outR);
          const shR = 1 - shP;
          // The stick pushing the tilt further out: nose further from level,
          // or bank further from level.
          if (sp * pitchNow > 0) S.cyclicPitch -= sp * band;
          if (sr * bankNow > 0) S.cyclicRoll -= sr * band;
          if (rateOutP > 0) S.cyclicPitch -= sgP * clamp(rateOutP * T.envArrest, 0, 1) * band * shP;
          if (rateOutR > 0) S.cyclicRoll -= sgR * clamp(rateOutR * T.envArrest, 0, 1) * band * shR;
          const over = tiltNow - tiltHi;
          if (over > 0) {
            S.cyclicPitch -= sgP * clamp(over * T.powerReturn * shP, 0, 0.6);
            S.cyclicRoll -= sgR * clamp(over * T.powerReturn * shR, 0, 0.6);
          }
        }
      }
    }

    /* ------------------------------------------------------ the ground --- */
    /*
     * See THE GROUND in ROTOR_TUNE. On and just over the skids: the stick is
     * faded to liftStick of itself, and — not parked — the attitude is held
     * inside liftLim by a stop like the envelope's hard one above, so a
     * lift-off with the stick already forward leaves the pad level instead
     * of nose first into it.
     */
    if (nearG > 0.001) {
      const keep = 1 - nearG * (1 - T.liftStick);
      S.cyclicPitch -= sp * (1 - keep);
      S.cyclicRoll -= sr * (1 - keep);
      if (!parked) {
        const overP = outP - liftLimP;
        if (overP > 0) S.cyclicPitch -= (sgP * clamp(overP * T.liftReturn, 0, 1) + ac.omega.x * T.liftDamp) * nearG;
        const overR = outR - liftLimR;
        if (overR > 0) S.cyclicRoll -= (sgR * clamp(overR * T.liftReturn, 0, 1) - ac.omega.z * T.liftDamp) * nearG;
      }
    }
  }

  /* -------------------------------------------------- readouts for HUD --- */
  const R = ac.rotor || (ac.rotor = {});
  R.driftFwd = driftFwd;
  R.driftRight = driftRight;
  R.drift = Math.hypot(driftFwd, driftRight);
  R.hoverAuth = auth;
  R.assistOn = ac.hoverAssist !== false;
  R.assistActive = on && (S.heldY !== null || live || arriving || auto);
  // The air at the rotor and the rotor itself, for the card and the tests.
  const AIR = ac._rotorAir;
  R.nr = nr;
  R.autorotating = !ac.engineOn && !ac.onGround && nr > 0.15;
  R.autoAssist = auto;
  R.autoFlare = auto && skidH <= T.autoFlareH;
  R.vrs = AIR ? AIR.vrs : 0;
  R.groundEffect = AIR ? AIR.ge - 1 : 0;
  R.translationalLift = AIR ? AIR.ettl - 1 : 0;
  R.inflow = AIR ? AIR.inflow : 0;
  R.holdingHeight = S.heldY !== null;
  R.holdingSpot = !!S.spot;
  R.heldY = S.heldY;
  // The held height over the surface under the machine now, for the panel.
  R.heldAGL = S.heldY !== null ? S.heldY - (ac.pos.y - skidH) : null;
  R.arriving = arriving;
  R.landGate = gated;
  R.landEdge = edge;
  R.climbingOver = S.heldY !== null && !!S.floorClimb;
  R.windTrimDeg = +((Math.hypot(S.trimX, S.trimZ) * 180) / Math.PI).toFixed(1);
  /*
   * What the assist would like the pilot's lever to do, in units of
   * controls.throttle per second. The caller applies it; this module does not
   * reach into the input layer, and the input layer does not know the flight
   * model exists. It is the force-trim: while the height hold is flying, the
   * lever follows the collective the hold is using, so the POWER gauge shows
   * the hover point (pick up a casualty and you watch the lever rise) and the
   * correction the hold is adding on its own never grows into a hidden
   * integrator that runs to its stop and drops the machine.
   */
  /*
   * Engine off on the skids (an autorotation just ended): the lever comes
   * down, as a pilot lowers it after touchdown. Left where the cushion's pull
   * trimmed it — full, measured — the next engine start lifted her off on a
   * full lever and climbed at 8-11 m/s (checker, 2026-10-24).
   */
  const leverDown = assist && !ac.engineOn && ac.onGround && !held && cmd > 0.005;
  R.trimRequest =
    S.leverWant !== null && on && !held
      ? clamp((leverFor(S.leverWant) - clamp(cmd, 0, 1)) * T.leverFollow, -2, 2)
      : leverDown
        ? -clamp(cmd * T.leverFollow, 0.3, 2)
        : 0;
  S.lastRequest = R.trimRequest;
  R.collective = coll;
  R.collectivePilot = clamp(lever, 0, 1);
  publishHoverPoint(R, ac, SPEC);
  R.heightAbove = skidH;
  // For the rotor sound (audio/vehicles.js): this type's blade-pass rate at
  // governed NR — an R44's two blades at 408 rpm thump at 13.6 Hz, a Black
  // Hawk's four at 258 rpm at 17.2, the Skyhook's 26.7.
  R.bladePassHz = (SPEC.rotorHz || 6.5) * (SPEC.rotorBlades || 4);

  // What the blades lift: the pitch they are at plus what the upflow gives a
  // windmilling disc, at the speed the rotor is actually turning.
  S.lift = rotorLiftRatio(clamp(coll + inflowColl, 0, 1)) * nr * nr;
  return S;
}

/**
 * The autopilot, flying a helicopter: the stick, pedal and lever positions
 * that hold a height, a heading and a speed — or, slow, a hover over a spot.
 *
 * The aeroplane autopilot (flight/autopilot.js) holds height with the
 * elevator and speed with the throttle. On a helicopter that is backwards:
 * the lever is the height and the nose is the speed. Measured on the old
 * build before it was barred from the helicopter: P in a 13 m hover took it
 * forward at 25 m/s and up at 4.5 m/s, 13 m to 222 m in 40 s, nobody on the
 * keys. So autopilot.js keeps its modes, its plans and its hand-backs and
 * asks this for the controls, and the stability assist stands down while it
 * flies (rotorAssist, `autopilotOn`). The envelope still runs.
 *
 * `want`: { vs (m/s up), hdg (deg, or null to hold the one it has), speed
 * (m/s along the nose), hover (bool), x, z (the spot to hover over, or
 * null) }. Writes { pitch, roll, yaw, throttle } into `out`.
 */
export function rotorAutopilot(ac, SPEC, dt, want, out) {
  const T = ROTOR_TUNE;
  const A = ac._rotorAP || (ac._rotorAP = { vI: 0, sI: 0, f: new THREE.Vector3() });
  if (want.reset) {
    A.vI = 0;
    A.sI = 0;
  }
  const f = ac.forward(A.f);
  let fx = f.x;
  let fz = f.z;
  const fl = Math.hypot(fx, fz) || 1;
  fx /= fl;
  fz /= fl;
  const vF = ac.vel.x * fx + ac.vel.z * fz;
  const vR = ac.vel.x * -fz + ac.vel.z * fx;

  /* ---- the lever: a vertical-speed loop through the force itself ---- */
  const vErr = want.vs - ac.vs;
  if (Math.abs(vErr) < 1.5) A.vI = clamp(A.vI + vErr * T.hhVi * dt, -0.8, 0.8);
  const coll = collectiveFor(ac, SPEC, clamp(vErr * T.hhVk + A.vI, -T.hhAMax, T.hhAMax));

  /* ---- where to lean ---- */
  let aF;
  let aR;
  if (want.hover) {
    // Walk back to the spot at up to 3 m/s, then hold it.
    let wF = 0;
    let wR = 0;
    if (want.x != null) {
      const dx = want.x - ac.pos.x;
      const dz = want.z - ac.pos.z;
      const d = Math.hypot(dx, dz);
      const v = Math.min(d * 0.4, 3);
      if (d > 0.05) {
        wF = ((dx * fx + dz * fz) / d) * v;
        wR = ((dx * -fz + dz * fx) / d) * v;
      }
    }
    aF = clamp((wF - vF) * 0.75, -2.5, 2.5);
    aR = clamp((wR - vR) * 0.75, -2.5, 2.5);
    A.sI = 0;
  } else {
    // Speed along the nose; an integrator learns the lean the drag needs.
    const sErr = want.speed - vF;
    A.sI = clamp(A.sI + sErr * 0.12 * dt, -3, 3);
    aF = clamp(sErr * 0.45 + A.sI, -2.5, 3);
    // Slow, it also stops any sideways slide; fast, the bank below turns it.
    aR = clamp(-vR * 0.6, -2, 2) * hoverAuthority(Math.abs(vF));
  }
  let tgtPitch = clamp(Math.atan(-aF / G), -0.32, 0.26);
  let tgtBank = clamp(Math.atan(aR / G), -0.3, 0.3);

  /* ---- heading: the pedals in the hover, a banked turn in the cruise ---- */
  const hover = hoverAuthority(Math.abs(vF));
  let hErr = 0;
  if (want.hdg != null) {
    hErr = want.hdg - ac.heading;
    while (hErr > 180) hErr -= 360;
    while (hErr < -180) hErr += 360;
  }
  // Bank to turn at cruise: 0.8 degrees of bank per degree off, up to 25.
  tgtBank += (1 - hover) * clamp((hErr * 0.8 * Math.PI) / 180, -0.436, 0.436);
  tgtPitch = clamp(tgtPitch, -0.32, 0.26);

  const disc = (0.35 + clamp(coll, 0, 1) * 0.65) * SPEC.mass * G;
  const aRoll = Math.max(0.2, (disc * SPEC.rotorRollArm) / SPEC.Izz);
  const aPitch = Math.max(0.2, (disc * SPEC.rotorPitchArm) / SPEC.Ixx);
  const aYaw = Math.max(0.2, (disc * SPEC.rotorYawArm) / SPEC.Iyy);
  const bank = ac.bankAngleRad();
  const pitch = Math.asin(clamp(f.y, -1, 1));
  out.roll = clamp((tgtBank - bank) * gainP(T.wnRoll, aRoll) + ac.omega.z * gainD(T.wnRoll, T.dampRoll, aRoll), -1, 1);
  out.pitch = clamp((tgtPitch - pitch) * gainP(T.wnPitch, aPitch) - ac.omega.x * gainD(T.wnPitch, T.dampPitch, aPitch), -1, 1);
  // Pedal: hold the heading in the hover (at most 30 deg/s of turn), and
  // keep the tail behind the nose in the cruise.
  const wantRate = clamp(hErr * 0.04, -0.52, 0.52) * hover; // rad/s, to the right
  const yawRateRight = -ac.omega.y;
  out.yaw = clamp((wantRate - yawRateRight) * gainP(T.wnYaw, aYaw) / T.wnYaw + ac.beta * 1.2 * (1 - hover), -1, 1);
  out.throttle = leverFor(coll);
  return out;
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

/*
 * The highest ground or roof under the next few seconds of the track (see
 * aheadS in ROTOR_TUNE), from the ground and from the boxes within NEAR_AHEAD
 * of the machine, gathered again every NEAR_MOVE metres.
 */
const NEAR_AHEAD = 450;
const NEAR_MOVE = 60;
function groundAhead(ac, S, T) {
  const x = ac.pos.x;
  const z = ac.pos.z;
  const near = S.near || (S.near = []);
  if (S.nearN !== OBSTACLES.length || !(Math.abs(x - S.nearX) < NEAR_MOVE && Math.abs(z - S.nearZ) < NEAR_MOVE)) {
    S.nearX = x;
    S.nearZ = z;
    S.nearN = OBSTACLES.length;
    near.length = 0;
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      if (o.x1 < x - NEAR_AHEAD || o.x0 > x + NEAR_AHEAD || o.z1 < z - NEAR_AHEAD || o.z0 > z + NEAR_AHEAD) continue;
      near.push(o);
    }
  }
  let top = -Infinity;
  for (let k = 0; k < T.aheadS.length; k++) {
    const px = x + ac.vel.x * T.aheadS[k];
    const pz = z + ac.vel.z * T.aheadS[k];
    top = Math.max(top, heightAt(px, pz));
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      // The rotor is 10.5 m across: a box within 6 m of the track counts.
      if (px > o.x0 - 6 && px < o.x1 + 6 && pz > o.z0 - 6 && pz < o.z1 + 6 && o.y1 > top) top = o.y1;
    }
  }
  return Math.max(0, top);
}

/*
 * The least air under any of these points (the skids, or the hard points) —
 * or, with `most`, the most (the skids straddling an edge, see landStraddle),
 * not only under the middle. Measured: the missions' pilot coming down on
 * Night Deck's rig in 20 kt with the middle of the machine just off the
 * deck's edge was judged 20 m up (the sea), so the arrival allowed 7 m/s,
 * and the skid met the deck: "You came down far too fast"; 1.5 m further
 * out, a wing tip met it. Asked only while arriving (the lever coming down),
 * so it costs eight ground lookups a step and only then.
 */
const SKID_TMP = new THREE.Vector3();
function pointsClear(ac, gp, least, most = false) {
  for (let i = 0; i < gp.length; i++) {
    const w = SKID_TMP.copy(gp[i].pos).applyQuaternion(ac.quat).add(ac.pos);
    const ground = most ? Math.max(0, heightAt(w.x, w.z)) : groundNear(w.x, w.z);
    least = most ? Math.max(least, w.y - ground) : Math.min(least, w.y - ground);
  }
  return least;
}

/*
 * The ground under a point, or — when there is an edge within EDGE_PAD of it
 * (more than landStraddle between the highest and the lowest of five
 * samples) — the top of that edge. A point a metre past a deck's edge is
 * not over the sea for landing purposes: in 20 kt the machine drifts that
 * far, and measured in the node harness, Ctrl held with a wing tip 0.1 m
 * past Night Deck's rig sank her 16 m beside the deck, then the drift
 * put the tip back under its edge: "The left wing tip hit the ground".
 * A slope never has that spread over 1.5 m, so slope landings are as before.
 */
const EDGE_PAD = 1.5;
function groundNear(x, z) {
  const g = sampleGround(x, z);
  const gBox = lastBox;
  let hi = g;
  let hiBox = gBox;
  let lo = g;
  for (let k = 0; k < 4; k++) {
    const q = sampleGround(x + (k === 0 ? EDGE_PAD : k === 1 ? -EDGE_PAD : 0), z + (k === 2 ? EDGE_PAD : k === 3 ? -EDGE_PAD : 0));
    if (q > hi) {
      hi = q;
      hiBox = lastBox;
    }
    if (q < lo) lo = q;
  }
  if (hi - lo > ROTOR_TUNE.landStraddle) {
    if (hiBox) BOX_HIT = true;
    return hi;
  }
  if (gBox) BOX_HIT = true;
  return g;
}

/*
 * The structures near her while she arrives: the boxes a hard point flies
 * into (OBSTACLES), which heightAt does not know. Ironhead Foxtrot's
 * structure stands a metre wider than its deck and 13 m further south:
 * Ctrl held 4 m past the deck's edge in 20 kt brought her down beside the
 * deck into it, "You flew into Ironhead Foxtrot" (heli-playtest). Only a box
 * whose top is under her counts (a wall beside her is not ground), and over
 * one the arrival stops her clear and says CAN'T LAND HERE: the skids stand
 * on heightAt alone, so a box top is never somewhere to set down. Gathered
 * within 30 m, again every 10 m of travel or two seconds, so the eight
 * points' five samples each look at a handful of boxes, not the map's.
 */
let NEAR = null;
let NEAR_Y = 0;
let BOX_HIT = false;
let lastBox = false;
function sampleGround(x, z) {
  let g = Math.max(0, heightAt(x, z));
  lastBox = false;
  if (NEAR) {
    for (let i = 0; i < NEAR.length; i++) {
      const o = NEAR[i];
      if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && o.y1 <= NEAR_Y && o.y1 > g + 0.3) {
        g = o.y1;
        lastBox = true;
      }
    }
  }
  return g;
}
function nearBoxes(ac, S, dt) {
  const p = ac.pos;
  S.nearBT = (S.nearBT || 0) - dt;
  if (!S.nearB || S.nearBT <= 0 || Math.abs(p.x - S.nearBX) > 10 || Math.abs(p.z - S.nearBZ) > 10) {
    S.nearBX = p.x;
    S.nearBZ = p.z;
    S.nearBT = 2;
    const out = S.nearB || (S.nearB = []);
    out.length = 0;
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      if (o.x1 > p.x - 30 && o.x0 < p.x + 30 && o.z1 > p.z - 30 && o.z0 < p.z + 30) out.push(o);
    }
  }
  return S.nearB;
}

/** The lowest the middle may be held with every hard point `clear` m over what is under it. */
function hardFloor(ac, SPEC, clear) {
  let need = -Infinity;
  const hp = SPEC.hardPoints;
  for (let i = 0; i < hp.length; i++) {
    const w = SKID_TMP.copy(hp[i].pos).applyQuaternion(ac.quat).add(ac.pos);
    need = Math.max(need, Math.max(0, heightAt(w.x, w.z)) + clear - (w.y - ac.pos.y));
  }
  return need;
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

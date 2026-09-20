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

const G = 9.80665;

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
   */
  collFloor: 0.06,
  collSpool: 12,

  /*
   * The two numbers that bound the vertical.
   *
   * maxLift is the most the rotor can pull as a multiple of the machine's own
   * weight, and discCD is the drag coefficient of the disc treated as a flat
   * plate when the machine is going straight up or straight down. Together
   * they give a best rate of climb near 13 m/s empty and near 10 m/s with
   * three people aboard, and a maximum vertical descent near 23 m/s. Before
   * them, full collective accelerated upwards at one g without limit.
   */
  maxLift: 1.3,
  discCD: 1.1,

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
};

function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
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
    });

  S.cyclicPitch = 0;
  S.cyclicRoll = 0;
  S.pedal = 0;
  S.collective = 0;

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
  const coll = clamp(ac.rpm + S.collective, 0, 1);
  const disc = (0.35 + coll * 0.65) * SPEC.mass * G;
  const aRoll = Math.max(0.2, (disc * SPEC.rotorRollArm) / SPEC.Izz);
  const aPitch = Math.max(0.2, (disc * SPEC.rotorPitchArm) / SPEC.Ixx);
  const aYaw = Math.max(0.2, (disc * SPEC.rotorYawArm) / SPEC.Iyy);

  const gainP = (wn, A) => (wn * wn) / A;
  const gainD = (wn, D, A) => Math.max(0, (2 * T.zeta * wn - D) / A);

  // How much of the assist survives the pilot's own input on that axis.
  const handsOff = (x) => 1 - clamp((Math.abs(x) - T.stickDead) / T.stickBand, 0, 1);

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

  /* -------------------------------------------------- readouts for HUD --- */
  const R = ac.rotor || (ac.rotor = {});
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
  R.collective = clamp(ac.rpm + S.collective, 0, 1);
  R.collectivePilot = clamp(ac.rpm, 0, 1);
  // Where the lever has to sit to hold a hover right now, so the POWER gauge
  // can mark it and the gap above it IS the power margin. Rotor thrust is
  // collective * 2 * m * g * (rho/rho0), so hover is at half of the density
  // ratio, plus whatever the winch has picked up.
  const loaded = (SPEC.mass + (ac.extraMass || 0)) / SPEC.mass;
  R.hoverPoint = clamp((0.5 * loaded) / Math.max(0.3, ac.density / 1.225), 0, 1);
  R.powerMargin = 1 - R.hoverPoint;
  // The same mark on the LEVER's scale rather than the collective's, because
  // the touch slider and the POWER gauge are not the same 0-to-1: the lever
  // travels 0 to 1 and commands collFloor to 1.
  R.hoverLever = clamp((R.hoverPoint - T.collFloor) / (1 - T.collFloor), 0, 1);

  return S;
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

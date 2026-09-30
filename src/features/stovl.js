/**
 * STOVL: the F-35B's hover, on the T key (and a HOVER button on a tablet).
 *
 * "Add F-35B" was on the wishlist, and the thing an F-35B does that nothing
 * else in the game does is stop in mid-air, swing its nozzle down and land on
 * a spot. So that is what this is: press T, the tailpipe swivels down, the
 * lift-fan door opens behind the canopy, and the jet holds itself up.
 *
 * It is built like the Skyhook's hover assist (../aircraft/rotor-assist.js)
 * and for the same reason: a ten-year-old on a keyboard has bang-bang inputs
 * and cannot close a control loop round four integrators. So the hover is
 * flown the way the real F-35B's flight computer lets its pilots fly it:
 *
 *   THROTTLE is a lift lever. The middle of its travel (35-65%) holds the
 *   height you are at; above it climbs, below it comes down, and the last few
 *   metres to the ground are always slow — a touchdown is at most about
 *   0.8 m/s, 160 ft/min, which the landing grader calls "perfect".
 *
 *   STICK FORWARD / BACK asks for a SPEED over the ground, not a pitch angle:
 *   let go and it stops where it is. Left / right slides sideways.
 *   RUDDER (Q / E) turns on the spot.
 *
 *   Above about 60 kt it switches itself off, says so, swings the nozzle aft
 *   and keeps holding the jet up while the wing takes over, rather than
 *   dropping it out of the sky at the moment the pilot is busiest. Leaving
 *   by T does the same. Either way the lever goes to full power, it climbs
 *   away to 60 m over whatever is below, and the jet only lets go once the
 *   wing is carrying it, whatever the lever says — and never while the stick
 *   is still held forward, which in a hover meant "go forward" and on the
 *   wing means "dive".
 *
 *   Press T at speed (up to 200 kt) and it CONVERTS: nozzle down, height
 *   held, and it slows itself to a hover. That is how you arrive at a pad.
 *
 * HOW IT TOUCHES THE FLIGHT MODEL, since main.js is not ours to edit. The
 * physics steps at 120 Hz inside main's loop and the extension hooks run once
 * a frame, which is too coarse to hold a hover. So `install` wraps the
 * aircraft's own `update` — the per-step call — with a before and an after:
 *
 *   before: the pilot's stick is read and taken off the control surfaces in
 *           proportion to the hover's authority (the jet flies the attitude
 *           while it is hovering), and SPEC.thrustMax is scaled by the cosine
 *           of the nozzle angle, because a nozzle pointing at the ground does
 *           not push the aeroplane forward.
 *   after:  the stick is put back, and the jet-borne forces are applied as
 *           velocity and body-rate increments — lift, the translation the
 *           vane boxes give, and the reaction-control moments.
 *
 * SPEC is a live binding shared with the whole game, so the one number this
 * changes is restored the moment the nozzle is aft, when the feature stops,
 * when the aeroplane changes, and when anything in here throws. A throw
 * inside the wrapper is caught, logged once, and switches STOVL off for the
 * session — it runs inside main's physics loop, outside the extension
 * layer's own fence, so it has to build its own.
 *
 * Nothing here is written for any aeroplane by name: a type with `stovl: true`
 * in its roster entry gets it. The model shows it through `userData.stovlRig`
 * (../fleet/extra/fighters.js); a model without one simply does not animate.
 */
import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { SPEC } from '../aircraft/physics.js';

const G = 9.80665;
const KT = 1.94384;

/** Every number that decides how the hover feels. */
export const STOVL_TUNE = {
  /* --- when it works --- */
  hoverKt: 60, // the hover hands over to the wing above this
  offKt: 62, // and switches itself off above this (2 kt of hysteresis)
  convertMaxKt: 200, // T above this is refused: too fast to convert

  /* --- the nozzle --- */
  nozzleRate: 1 / 2.2, // fraction of 90 degrees per second: 2.2 s end to end

  /* --- lift --- */
  maxLift: 1.25, // most the jet can lift, as a multiple of its weight
  // The lift lever: below `holdLo` descends, above `holdHi` climbs.
  holdLo: 0.35,
  holdHi: 0.65,
  maxDown: 3.0, // m/s at the bottom of the lever
  maxUp: 5.0, // m/s at the top
  // The ground cushion: descent limited to (flareBase + wheel height *
  // flareSlope), measured from the WHEELS, not the centre of gravity — keyed
  // to the CG it let the jet arrive at 272 ft/min, 1.7 m of leg too early.
  flareBase: 0.55,
  flareSlope: 0.35,
  flareFrom: 8, // metres of wheel height where the limit starts to bite
  vsGain: 1.6, // 1/s: vertical acceleration per m/s of vertical-speed error
  vsInt: 0.8, // 1/s²: the integrator that finds the wing's share and the trim
  vsIntExit: 1.5, // 1/s²: the same on the way out, where the wing's share grows fast
  holdGain: 0.8, // 1/s: vertical speed per metre off the held height
  stopDecel: 2.5, // m/s² it is assumed to stop a climb or sink with, for the capture

  /* --- translation --- */
  /*
   * "Able to move while hovering" was on the owner's list, and on a keyboard
   * it could not really be done: W is always full stick, full stick was
   * "depart", and holding W to go forward took the jet past 60 kt in eleven
   * seconds and switched the hover OFF. Now full stick moves you at a brisk
   * hover-taxi and the hover stays on; you fly away with full stick AND the
   * lift lever up (W + Shift) — or with T, as ever. Measured in
   * tests/features/aircrew.browser.js through the real keys.
   */
  fwdSpeed: 18, // m/s over the ground at full forward stick (35 kt)...
  departSpeed: 40, // ...unless the lever is up as well: then it goes, and
  departStick: 0.9, // leaving 60 kt switches the hover off
  backSpeed: 8,
  sideSpeed: 10,
  transGain: 0.7, // 1/s
  // 1/s²: wind trim, as the Skyhook's hover has — learned only while the
  // stick is centred. Learned while the pilot was asking for 8 m/s it wound
  // up and carried the jet 51 m past where a two-second nudge was let go.
  transInt: 0.15,
  transMax: 4.0, // m/s², about 0.4 g of vectored thrust: it answers the keys at once
  convertDecel: 2.2, // m/s² the conversion slows the jet by

  /* --- attitude (reaction control) --- */
  wnPitch: 2.4,
  wnRoll: 3.0,
  zeta: 1.0,
  yawRate: 0.5, // rad/s at full rudder
  yawGain: 2.2,
  // Heading hold with the rudder centred. Without it a 26 kt crosswind
  // weathercocked the hovering jet 38 degrees in a minute.
  hdgGain: 0.9, // rad/s of turn per radian off the held heading
  hdgRateMax: 0.3,
  hoverPitchDeg: 3, // an F-35B hovers slightly nose-up
  leanDeg: 1.4, // degrees of lean per m/s² of translation, so it looks like it means it

  /* --- getting out --- */
  // The jet lets go when the wing has it: past 1.1 x the wing's own speed
  // (wingKt, CL 1), up at exitSafeAgl, the stick let go, and the jet down to
  // this share of the weight. Then the stick comes back over handBackS,
  // trimmed, and the lift that is left is faded, not cut.
  handoverLift: 0.12,
  fadeS: 1.5, // seconds to fade the last of the jet lift after the handover
  capFallS: 1.2, // the lift cap never falls faster than full-to-nothing in this
  // The jet lift is a backstop that runs out with SPEED, not time: full up
  // to capFullWing x wingKt, nothing by capZeroWing x wingKt (158 and 203 kt
  // for the F-35B). Counting down on a 14 s clock instead, a half-throttle
  // exit was still short of the wing's speed when the clock ran out and put a
  // 15 m hover on its wing tip.
  capFullWing: 1.4,
  capZeroWing: 1.8,
  // Flying away CLIMBS, to this many metres over the ground (or the sea)
  // below, before it lets go. exitClimb is the most it asks for; slower than
  // exitClimb / exitClimbSlope m/s it asks for less, so the jet is not
  // hanging nose-high on its nozzle at walking pace.
  exitSafeAgl: 60,
  exitSafeSlack: 6, // it may let go this far short of it
  exitClimb: 4,
  exitClimbSlope: 0.07,
  exitPitchDeg: 5, // the attitude it holds while the wing takes over
  exitGammaMaxDeg: 4, // most climb angle it adds to that
  exitStickDeg: 8, // pitch the stick adds to that, once it has been let go
  pitchInt: 6.0, // 1/s³: the exit's attitude integrator
  pitchIntMax: 1.5, // rad/s², with the nozzle and fan alone...
  pitchIntElev: 0.5, // ...plus this share of what the elevator can do
  handBackS: 1.0, // the stick comes back over this long, once the wing has it
  // Once past 1.1 x wingKt: after exitMaxS the stick comes back even if the
  // wing is not quite there, unless it is being pushed. Still short of that
  // speed after exitGiveUpS, it goes back to (or slows to) a hover.
  exitMaxS: 20,
  exitGiveUpS: 45,
  exitStallS: 8, // still under hoverKt this long after T: back to the hover
  stickFree: 0.15, // |stick| under this counts as let go
  // T with the wheels rolling faster than this is refused. Pressed on the
  // take-off roll at 20-58 kt it used to park the jet: no thrust, brakes on.
  rollKt: 8,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** How far below the centre of gravity the wheels are (positive metres). */
function lowestGear() {
  let low = 0;
  for (const g of SPEC.gearPoints || []) if (g.pos.y < low) low = g.pos.y;
  return low;
}
/** Height over the ground, a deck, or the sea (y 0), whichever is highest. */
function aboveSurface(ac) {
  return ac.pos.y - Math.max(0, ac.pos.y - ac.agl);
}
function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * The hover itself. No DOM, no game object: an aircraft in, forces out, so
 * tests/features/fighters.mjs can fly it against the real flight model.
 *
 * mode: 'off' | 'convert' (slowing from wing-borne flight) | 'hover' |
 *       'exit' (nozzle going aft, the wing taking over)
 */
export class StovlController {
  constructor() {
    this.mode = 'off';
    this.nozzle = 0;
    this.notes = [];
    this.lift = 0; // jet lift as a fraction of weight, for the HUD and the sound
    this.vsCmd = 0;
    this.broken = false;
    this._spec = null;
    this._baseThrust = 0;
    this._heldY = null;
    this._iv = 0;
    this._iF = 0;
    this._iR = 0;
    this._exitT = 0;
    this._entryKt = 0;
    this._stickFree = false;
    this._handBack = 0;
    this._handingBack = false;
    this._iP = 0; // pitch integrator of the reaction control, rad/s²
    this._trim = 0;
    this._trimFrozen = false;
    this._ac = null; // the aircraft last flown, so reset() can clear its jetBorne
    this._capFrac = 0;
    this._heldHdg = null;
    this._pilot = { pitch: 0, roll: 0, yaw: 0, brakes: 0 };
    this._fwd = new THREE.Vector3();
    this._warnedGear = false;
    /**
     * Where the hover wants the throttle lever put, or null. The game side
     * (press() and the update hook) moves the real lever and clears it; the
     * controller never depends on it being honoured — a finger held on the
     * touch slider wins, and the exit has to be safe at any lever.
     */
    this.leverRequest = null;
  }

  /** On the way out, and the stick has not been let go since. */
  get waitingForStick() {
    return this.mode === 'exit' && !this._stickFree && !this._handingBack;
  }

  /** Anything to do this step: a mode, a nozzle not yet aft, or lift still fading. */
  get active() {
    return this.mode !== 'off' || this.nozzle > 0 || this.lift > 0;
  }

  note(text, kind = 'info', seconds = 3.6) {
    this.notes.push({ text, kind, seconds });
    if (this.notes.length > 6) this.notes.shift();
  }

  /** The T key. Returns what happened, for the tests. */
  toggle(ac) {
    if (this.broken) return 'broken';
    if (!ac || ac.crashed) return 'crashed';
    const kt = (ac.ias || 0) * KT;
    const T = STOVL_TUNE;
    if (this.mode === 'off' || this.mode === 'exit') {
      if (!ac.engineOn) {
        this.note('Start the engine first (I) — the hover needs it.', 'warn');
        return 'no-engine';
      }
      if (!ac.onGround && kt > T.convertMaxKt) {
        this.note(`Too fast to hover — slow below ${T.convertMaxKt} kt first.`, 'warn');
        return 'too-fast';
      }
      if (ac.onGround && (ac.groundSpeed || 0) * KT > T.rollKt) {
        this.note('Stop first — the nozzle only comes down when you are standing still.', 'warn');
        return 'rolling';
      }
      this._iv = 0;
      this._iF = 0;
      this._iR = 0;
      this._heldY = null;
      this._warnedGear = false;
      if (!ac.onGround && kt > T.hoverKt) {
        this.mode = 'convert';
        this._entryKt = kt;
        this.leverRequest = 0.5;
        this.note('Nozzle down — slowing to a hover. Middle throttle holds your height.', 'good', 4.5);
        return 'convert';
      }
      this.mode = 'hover';
      // In the air, put the lever where the hover holds height, so it neither
      // shoots up nor drops the moment the nozzle comes down. On the ground
      // leave it: the note says to push it up to lift off.
      if (!ac.onGround) this.leverRequest = 0.5;
      this.note(ac.onGround
        ? 'Nozzle down. Throttle UP to lift off, middle to hover.'
        : 'Hovering! Stick (W A S D) slides you about, rudder (Q E) turns you, throttle is up and down. T to fly away.', 'good', 5.5);
      return 'hover';
    }
    // On: stow it.
    if (ac.onGround) {
      this.mode = 'off';
      this.leverRequest = 0;
      this.note('Nozzle aft — taxi as normal.', 'info');
      return 'stowed';
    }
    this._startExit('Nozzle aft, full power — climbing away. The wing takes over in a few seconds.');
    return 'exit';
  }

  _startExit(text) {
    this.mode = 'exit';
    this._exitT = 0;
    this._heldY = null;
    // Whatever the stick was doing, it meant "hover that way" a moment ago.
    // Held hard forward to leave the hover, it would mean "dive" the instant
    // the hover let go — so the jet keeps the attitude until it is let go.
    this._stickFree = false;
    this._handBack = 0;
    this._handingBack = false;
    this._iP = 0;
    // Flying away needs thrust. The hover asked for the middle of the lever,
    // and left there a keyboard pilot had 59% power while the note said
    // "T to fly away".
    this.leverRequest = 1;
    if (text) this.note(text, 'info', 4);
  }

  /** Switch everything off and give SPEC back. */
  reset() {
    this.mode = 'off';
    this.nozzle = 0;
    this.lift = 0;
    this.vsCmd = 0;
    this._heldY = null;
    this._capFrac = 0;
    this._handBack = 0;
    this._handingBack = false;
    this._iP = 0;
    this._trimFrozen = false;
    this.leverRequest = null;
    if (this._ac) this._ac.jetBorne = false;
    this.restore();
  }

  restore() {
    if (this._spec && this._spec === SPEC && this._baseThrust > 0) SPEC.thrustMax = this._baseThrust;
    this._spec = null;
  }

  /**
   * Before a physics step. The pilot's stick is saved and scaled off the
   * control surfaces as the hover takes the attitude; the forward thrust is
   * cut by the nozzle angle.
   */
  preStep(ac, dt) {
    const T = STOVL_TUNE;
    if (ac.crashed) {
      if (this.mode !== 'off' || this.nozzle > 0) this.reset();
      return;
    }
    const want = this.mode === 'off' || this.mode === 'exit' ? 0 : 1;
    this.nozzle = clamp(this.nozzle + clamp(want - this.nozzle, -T.nozzleRate * dt, T.nozzleRate * dt), 0, 1);

    // SPEC is replaced whenever the aeroplane changes; re-read its thrust
    // from the new object rather than writing a stale number into it.
    if (this._spec !== SPEC) {
      this._spec = SPEC;
      this._baseThrust = SPEC.thrustMax;
    }
    // Sitting with the hover on, no thrust goes backwards out of the nozzle
    // at all, and the brakes are held: the first vertical take-off rolled
    // 22 m down the runway while the nozzle was still swinging down.
    const parked = this.mode === 'hover' && ac.onGround;
    SPEC.thrustMax = parked ? 0 : this._baseThrust * Math.max(0, Math.cos(this.nozzle * Math.PI * 0.5));

    const p = this._pilot;
    p.pitch = ac.controls.pitch;
    p.roll = ac.controls.roll;
    p.yaw = ac.controls.yaw;
    p.brakes = ac.controls.brakes;
    if (parked) ac.controls.brakes = 1;
    if (this.mode === 'exit') {
      if (!this._stickFree && Math.abs(p.pitch) < T.stickFree && Math.abs(p.roll) < T.stickFree) this._stickFree = true;
      // The stick comes back only once the wing is carrying the jet (postStep
      // decides). Handed back at 90 kt, as soon as it was let go, the jet
      // lift was still carrying 70% of the weight and the airframe's own
      // hands-off attitude — alpha zero, the trim for 205 kt — put the nose
      // 4 degrees down and left the jet to carry more than all of it.
      if (this._handingBack) this._handBack = Math.min(1, this._handBack + dt / T.handBackS);
    }
    const auth = this.attitudeAuthority(ac);
    if (auth > 0) {
      const keep = 1 - auth;
      ac.controls.pitch *= keep;
      ac.controls.roll *= keep;
      ac.controls.yaw *= keep;
    }
    /*
     * While the jet holds the attitude, the aeroplane's own trim stays where
     * it is. Realistic mode's auto-trim runs whenever the stick is centred —
     * which the line above makes it — and it trims against a climb: on the
     * way out of a hover left at 62 kt it wound 0.23 of nose-down trim
     * against the jet's attitude hold, the nose went from 7 degrees up to 7
     * down at 200 kt, and the jet flew into the ground 20 s after the hover
     * switched off. Handed back, the trim is the wing's again.
     */
    this._trimFrozen = auth > 0 && !this._handingBack && Number.isFinite(ac.trim);
    if (this._trimFrozen) this._trim = ac.trim;
  }

  /**
   * How much of the attitude the hover owns. All of it while hovering — the
   * stick means "go that way" then, and passing it to the elevator as well
   * pitched the jet 52 degrees nose-down at 55 kt and held it there. On the
   * way out, all of it until the stick has been let go, then none of it
   * over a second.
   */
  attitudeAuthority(ac) {
    void ac;
    // In a hover, as strong as the lift it can make — which falls no faster
    // than capFallS, so T twice (hover, fly away, hover again) does not let
    // the attitude go while the nozzle is swinging back down.
    if (this.mode === 'hover') return Math.max(this.nozzleFloor(), clamp(this._capFrac, 0, 1));
    if (this.mode === 'exit') return 1 - this._handBack;
    return 0;
  }

  /** The hover is only as strong as the nozzle is down (or on its way up). */
  nozzleFloor() {
    return this.mode === 'exit' ? 1 : smoothstep(0.15, 0.7, this.nozzle);
  }

  /** After a physics step: the jet-borne forces. */
  postStep(ac, dt) {
    const T = STOVL_TUNE;
    const p = this._pilot;
    // Give the pilot back their stick before anything can return early.
    if (!ac.crashed) {
      ac.controls.pitch = p.pitch;
      ac.controls.roll = p.roll;
      ac.controls.yaw = p.yaw;
      ac.controls.brakes = p.brakes;
      if (this._trimFrozen) ac.trim = this._trim;
    }
    this._trimFrozen = false;
    if (ac.crashed) {
      this.reset();
      return;
    }
    this._ac = ac;
    if (this.mode === 'off') {
      ac.jetBorne = false;
      // Handed over: what jet lift was left fades out over fadeS rather than
      // vanishing in one step. Cut at once it was 0.2-0.26 g, and in
      // realistic mode that took the jet from -1.9 to -4.2 m/s.
      if (this.lift > 0) {
        if (ac.onGround || !ac.engineOn) this.lift = 0;
        else {
          this.lift = Math.max(0, this.lift - dt / T.fadeS);
          ac.vel.y += this.lift * G * dt;
        }
      }
      this._capFrac = 0;
      if (this.nozzle <= 0 && this.lift <= 0) this.restore();
      return;
    }

    const kt = (ac.ias || 0) * KT;
    const running = ac.engineOn && ac.rpm > 0.12;
    const wingKt = this.wingKt(ac);

    /* ---------------------------------------------------- mode changes --- */
    if (this.mode === 'convert') {
      if (kt <= T.hoverKt) {
        this.mode = 'hover';
        this.note('Hovering! Stick (W A S D) slides you about, rudder (Q E) turns you, throttle is up and down.', 'good', 5.5);
      } else if (kt > this._entryKt + 15) {
        this._startExit('Speeding up — hover cancelled, nozzle aft, full power.');
      }
    } else if (this.mode === 'hover' && kt > T.offKt) {
      this._startExit(`Over ${T.hoverKt} knots — hover off, full power. Let go of the stick: it climbs away by itself.`);
    } else if (this.mode === 'exit') {
      this._exitT += dt;
      /*
       * Let go when the WING has it, not when a speed is reached. Handed over
       * at 1.1 x wingKt with the jet still carrying a quarter of the weight,
       * a hands-off F-35B flew on into the ground from a 15 m hover within
       * 25 s, even at full power.
       */
      if (ac.onGround) {
        this.mode = 'off';
        this.lift = 0;
        return;
      }
      // The clocks only count once the wing COULD fly it. A clock on its own
      // handed a lever-at-idle exit over at 64 kt with 0.8 g still on the
      // jet, and it went into the sea from 45 m.
      const fast = kt > 1.1 * wingKt;
      const high = aboveSurface(ac) > T.exitSafeAgl - T.exitSafeSlack;
      const wingHasIt = fast && high && this.lift < T.handoverLift && this._stickFree;
      // A stick still held FORWARD is not handed back on the clock. W is "go
      // forward" in the hover and "nose down" on the wing: held from the
      // hover straight through the switch-off, handing it back at the clock
      // dived the jet into the runway from 40 m. The panel says let go.
      //
      // Nor is it handed back pushed on ANY clock. There used to be a 45 s
      // one that let go whatever the stick said: W held from the hover and
      // never let go, which is what "W goes forward" teaches, was handed to
      // the elevator 45 s after the switch-off as full nose-down, and the jet
      // went from 60 m into the sea in both flight modes. Held, the jet just
      // carries on climbing away 60 m over the ground, saying let go.
      const pushing = p.pitch < -T.stickFree;
      const letGo = wingHasIt || (fast && !pushing && this._exitT > T.exitMaxS);
      if (!this._handingBack && letGo) {
        this._handingBack = true;
        this._trimOver(ac);
      }
      if (this._handBack >= 1) {
        this.mode = 'off'; // this.lift is kept, and faded out above
        this._capFrac = 0;
        this.note('The wing is flying — you have it. Pull back (S) to climb.', 'good', 4.5);
        return;
      }
      // Not getting anywhere: the lever pulled back and still under 60 kt,
      // or not up to the wing's speed after exitGiveUpS whatever the lever.
      // Better a hover than a jet hanging on its nozzle — and above 60 kt
      // that means slowing to one, not a hover that would leave again at
      // once. (Anywhere above holdLo it does get there: 59% took 21 s into
      // a 26 kt tailwind, realistic mode.)
      const stuck = this._exitT > T.exitStallS && kt < T.hoverKt && ac.controls.throttle < T.holdLo;
      if (!this._handingBack && (stuck || (!fast && this._exitT > T.exitGiveUpS))) {
        this.mode = kt > T.hoverKt ? 'convert' : 'hover';
        this._entryKt = kt;
        this._heldY = null;
        this._iF = 0;
        this._iR = 0;
        this.leverRequest = 0.5;
        this.note('Not enough power to fly away — back in the hover. Throttle up, then T.', 'warn', 5);
      }
    }

    /* ---------------------------------------------------------- vertical --- */
    const t = clamp(ac.controls.throttle, 0, 1);
    let vsCmd;
    if (this.mode === 'exit') {
      // Climb away to exitSafeAgl over whatever is below (the sea counts as
      // ground), then hold; never ask to sink, and never pull it back down if
      // the wing lifts it higher. Held LEVEL instead, a 15 m hover over the
      // Kestrel runway was handed over at 20 m and simplified mode, hands
      // off, flew it level into the 28 m rise past the runway's east end.
      if (this._heldY === null || ac.pos.y > this._heldY) this._heldY = ac.pos.y;
      const floor = ac.pos.y - aboveSurface(ac) + T.exitSafeAgl;
      const climb = Math.min(T.exitClimb, Math.max(0.5, ac.airspeed * T.exitClimbSlope));
      vsCmd = clamp((Math.max(this._heldY, floor) - ac.pos.y) * T.holdGain, 0, climb);
    } else if (t < T.holdLo) {
      this._heldY = null;
      vsCmd = -T.maxDown * (T.holdLo - t) / T.holdLo;
    } else if (t > T.holdHi) {
      this._heldY = null;
      vsCmd = T.maxUp * (t - T.holdHi) / (1 - T.holdHi);
    } else {
      // Capture where it will STOP, not where it is. A fixed 0.6 s of lead
      // captured 1.8 m above a 5 m/s climb that needs 4 m to stop, so it
      // went 2.6 m past and came back down at 2.5 m/s — the first thing
      // anyone sees after their first vertical take-off.
      if (this._heldY === null) this._heldY = ac.pos.y + clamp((ac.vs * Math.abs(ac.vs)) / (2 * T.stopDecel), -6, 6);
      vsCmd = clamp((this._heldY - ac.pos.y) * T.holdGain, -1.5, 1.5);
    }
    // The ground cushion: however hard the lever is down, the last metres
    // are slow. This is what makes a pad landing gentle on a keyboard.
    const wheels = ac.agl + lowestGear();
    if (wheels < T.flareFrom) vsCmd = Math.max(vsCmd, -(T.flareBase + Math.max(0, wheels) * T.flareSlope));
    this.vsCmd = vsCmd;

    let up = 0; // jet lift, m/s² of the jet's own weight
    if (running) {
      const err = vsCmd - ac.vs;
      if (ac.onGround && vsCmd <= 0.05) {
        // Sitting on the wheels: let the lift go, gently.
        this._iv = 0;
        up = Math.max(0, this.lift * G - 3 * G * dt);
      } else {
        // Integrate only near the target: winding up through a climb is
        // what pushed a 5 m/s command to 6.4 and overshot the release.
        // On the way out there is no climb to wind up through, and the gate
        // stopped the integrator following the wing as it took the weight:
        // with the error past 1 m/s it froze, and the jet kept pushing 0.3 g
        // while the jet climbed at 1.8 m/s it had not asked for.
        const exiting = this.mode === 'exit';
        if (exiting || Math.abs(err) < 1) {
          this._iv = clamp(this._iv + err * (exiting ? T.vsIntExit : T.vsInt) * dt, -1.0 * G, 0.4 * G);
        }
        up = G + clamp(err * T.vsGain, -3.5, 3.5) + this._iv;
      }
      /*
       * The jet gives the lift up as the wing earns it — which the height
       * hold does by itself, since wing lift is lift it no longer has to
       * make. So on the way out the cap is only a backstop, and it runs out
       * with airspeed, well past the wing's own speed. It used to fall
       * linearly from 1 to 1.25 x wingKt, faster than the wing picks up at a
       * 5 degree attitude, and a departure sank 12.7 m.
       */
      const want = this.mode === 'exit'
        ? clamp((T.capZeroWing * wingKt - kt) / ((T.capZeroWing - T.capFullWing) * wingKt), 0, 1)
        : this.nozzleFloor();
      // Rises as fast as the nozzle allows, falls no faster than capFallS.
      this._capFrac = want >= this._capFrac ? want : Math.max(want, this._capFrac - dt / T.capFallS);
      up = clamp(up, 0, T.maxLift * G * this._capFrac);
    } else {
      this._iv = 0;
    }
    this.lift = up / G;
    ac.vel.y += up * dt;
    // For the stall warners: while the jet carries most of the weight, the
    // wing's angle of attack is not a warning. (Descending in a hover into a
    // 20 kt wind puts it past the horn's 13.5 degrees.)
    ac.jetBorne = this.lift > 0.5;

    /* ------------------------------------------------------- translation --- */
    const f = ac.forward(this._fwd);
    let fx = f.x, fz = f.z;
    const fl = Math.hypot(fx, fz);
    if (fl > 1e-4) { fx /= fl; fz /= fl; } else { fx = 0; fz = -1; }
    const rx = -fz, rz = fx;
    const vF = ac.vel.x * fx + ac.vel.z * fz;
    const vR = ac.vel.x * rx + ac.vel.z * rz;
    let aF = 0, aR = 0;
    const auth = this.attitudeAuthority(ac);
    if (running && !ac.onGround) {
      if (this.mode === 'convert') {
        // Vanes and nozzle angled slightly forward: slow down, steadily.
        aF = -T.convertDecel * this.nozzleFloor() * clamp(vF / 20, 0, 1);
      } else if (this.mode === 'hover' && auth > 0) {
        const sp = p.pitch;
        const departing = -sp >= T.departStick && clamp(ac.controls.throttle, 0, 1) > T.holdHi;
        const cmdF = -sp <= -0.02
          ? -sp * T.backSpeed
          : departing ? T.departSpeed : Math.min(1, -sp) * T.fwdSpeed;
        const cmdR = p.roll * T.sideSpeed;
        if (Math.abs(sp) < 0.05 && Math.abs(p.roll) < 0.05) {
          this._iF = clamp(this._iF + (cmdF - vF) * T.transInt * dt, -1.2, 1.2);
          this._iR = clamp(this._iR + (cmdR - vR) * T.transInt * dt, -1.2, 1.2);
        } else {
          const bleed = 1 - Math.min(1, dt * 0.8);
          this._iF *= bleed;
          this._iR *= bleed;
        }
        aF = clamp((cmdF - vF) * T.transGain + this._iF, -T.transMax, T.transMax) * auth;
        aR = clamp((cmdR - vR) * T.transGain + this._iR, -T.transMax, T.transMax) * auth;
      }
    } else {
      this._iF *= 0.98;
      this._iR *= 0.98;
    }
    ac.vel.x += (aF * fx + aR * rx) * dt;
    ac.vel.z += (aF * fz + aR * rz) * dt;

    /* ---------------------------------------------------------- attitude --- */
    // Reaction control: the roll posts and the split between fan and nozzle.
    // Off while the wheels are carrying it — the gear holds the attitude
    // then, and a controller pulling against the springs only rocks it.
    const sitting = ac.onGround && this.lift < 0.9;
    if (sitting || auth <= 0) this._heldHdg = null;
    if (auth > 0 && running && !sitting) {
      const pitchNow = Math.asin(clamp(f.y, -1, 1));
      const bank = ac.bankAngleRad();
      const lean = THREE.MathUtils.degToRad(T.leanDeg);
      // On the way out, a stick that has been let go once steers the
      // attitude a little — the pilot asked to fly away, not to sit still.
      // And it adds the climb's flight-path angle, so the wing keeps its
      // angle of attack while it climbs and the handover is not put off.
      const gamma = this.mode === 'exit' ? Math.min(Math.atan2(Math.max(0, this.vsCmd), Math.max(ac.airspeed, 20)) * 57.2958, T.exitGammaMaxDeg) : 0;
      const exitDeg = T.exitPitchDeg + gamma + (this._stickFree ? clamp(p.pitch, -1, 1) * T.exitStickDeg : 0);
      const pitchWant = THREE.MathUtils.degToRad(this.mode === 'exit' ? exitDeg : T.hoverPitchDeg) - aF * lean;
      const bankWant = aR * lean;
      const wP = T.wnPitch, wR = T.wnRoll, z = T.zeta;
      let ax = wP * wP * (pitchWant - pitchNow) - 2 * z * wP * ac.omega.x;
      if (this.mode === 'exit') {
        // On the way out the wing's own pitching moment grows with speed and
        // the proportional term alone let a 5 degree hold sag to 3 by 88 kt.
        // Its limit grows with the tailplane's authority: at speed the flight
        // computer has the stabilator as well as the nozzle and the fan, and
        // simplified mode's height hold pushes the nose down against a climb
        // with an elevator that is worth 8 rad/s² per unit at 200 kt.
        const iMax = T.pitchIntMax + T.pitchIntElev * this.elevatorAuthority(ac);
        this._iP = clamp(this._iP + (pitchWant - pitchNow) * T.pitchInt * dt, -iMax, iMax);
        ax += this._iP;
      }
      const az = wR * wR * (bank - bankWant) - 2 * z * wR * ac.omega.z;
      // Turn rate wanted, right positive: the rudder's, or the held heading's.
      let turn = p.yaw * T.yawRate;
      if (Math.abs(p.yaw) < 0.05) {
        if (this._heldHdg === null) this._heldHdg = ac.heading;
        const off = ((((this._heldHdg - ac.heading) % 360) + 540) % 360) - 180;
        turn = clamp(THREE.MathUtils.degToRad(off) * T.hdgGain, -T.hdgRateMax, T.hdgRateMax);
      } else {
        this._heldHdg = null;
      }
      // +Y body rate is nose LEFT, so a right turn wants omega.y negative.
      const ay = -T.yawGain * (turn + ac.omega.y);
      ac.omega.x += ax * auth * dt;
      ac.omega.z += az * auth * dt;
      ac.omega.y += ay * auth * dt;
    }

    if (this.mode === 'hover' && !ac.gearDown && ac.agl < 25 && ac.vs < -0.3 && !this._warnedGear) {
      this._warnedGear = true;
      this.note('Gear is UP — press G before you land!', 'warn', 5);
    }
    if (ac.gearDown) this._warnedGear = false;
  }

  /**
   * Hand the attitude over trimmed. The reaction control's integrator has
   * been holding the pitching moment the wing makes at the exit attitude;
   * dropped with it, the nose fell and the jet sank 1 m/s straight after the
   * handover. So it becomes elevator trim — the aeroplane's own, which
   * realistic mode keeps and simplified mode eases out over a second while
   * its height hold takes over.
   */
  _trimOver(ac) {
    const perUnit = this.elevatorAuthority(ac, 20);
    if (!(perUnit > 0) || !Number.isFinite(ac.trim)) return;
    ac.trim = clamp(ac.trim + this._iP / perUnit, -0.45, 0.45);
    this._iP = 0;
  }

  /** Pitch acceleration, rad/s², one unit of elevator is worth at this airspeed. */
  elevatorAuthority(ac, minV = 0) {
    const rho = ac.density || 1.225;
    const V = Math.max(minV, ac.airspeed || ac.ias || 0);
    return (Math.abs(SPEC.Cmde || 1) * 0.5 * rho * V * V * SPEC.wingArea * SPEC.chord) / SPEC.Iyy;
  }

  /** The airspeed at which the wing alone holds the jet up at CL 1. */
  wingKt(ac) {
    const rho = ac.density || 1.225;
    const ms = Math.sqrt((2 * SPEC.mass * G) / (rho * SPEC.wingArea * 1.0));
    return ms * KT;
  }
}

/* ------------------------------------------------------------------ *
 * The game side: the key, the button, the panel, the sound, the model.
 * ------------------------------------------------------------------ */

const ctl = new StovlController();
let wrapped = null; // the aircraft instance whose update we wrap
let ui = null;
let sound = null;
let rigModel = null;
let rig = null;
let lastUiMode = '';
// What the panel last showed, as numbers, so an unchanged frame writes
// nothing to the DOM and allocates nothing.
const shown = { t: -1, agl: -1, vs: -1e9, kt: -1 };
let quietWing = false;

/** Hide the wing's stall advice while the jet holds itself up. */
function setQuietWing(on) {
  if (on === quietWing || typeof document === 'undefined' || !document.body) return;
  quietWing = on;
  document.body.classList.toggle('stovl-hovering', on);
}

/**
 * Out of the cockpit: driving the boat or the car (which keep state 'flying'
 * and the last aircraftType), or walking about. The on-foot flag is guessed
 * at, since that feature is being built alongside this one: any of these
 * being truthy counts.
 */
function outOfCockpit(sim) {
  if (sim.mode === 'drive') return true;
  const f = sim.onFoot || sim.onfoot || sim.walking;
  if (f && (f === true || f.active === true || f.on === true)) return true;
  // As that feature stands (wish-partial/onfoot-2) it sets no flag: it holds
  // the empty aeroplane parked through sim.override — throttle 0, brakes on —
  // for as long as you are out, and passes T on to the other features. A
  // hover cannot lift on a lever held at 0 anyway. You can only climb out on
  // the ground, so a test holding the lever shut in the air is still flying.
  const o = sim.override;
  const ac = sim.aircraft;
  return !!(o && o.throttle === 0 && o.brakes === 1 && ac && ac.onGround);
}

/**
 * The F-35B is the aeroplane AND the player is in it. Checked on the type
 * alone, the HOVER panel stayed on screen in the boat after a flight in the
 * F-35B and T was taken from the boat, putting the (parked) jet in a hover.
 */
const isStovl = (sim) => !!(sim && sim.aircraftType && sim.aircraftType.stovl && !outOfCockpit(sim));

function fail(sim, err) {
  if (ctl.broken) return;
  ctl.broken = true;
  try { ctl.reset(); } catch (e) { void e; }
  console.error('[stovl] switched off for this session:', err);
  try { sim && sim.hud && sim.hud.notify('Hover system fault — hover off for this flight.', 'warn', 4); } catch (e) { void e; }
}

/**
 * Wrap the aircraft's per-step update. Done once per Aircraft instance, and
 * guarded, because this runs inside main's physics loop where nothing is
 * fenced off for us.
 */
function wrap(sim) {
  const ac = sim && sim.aircraft;
  if (!ac || wrapped === ac || typeof ac.update !== 'function') return;
  const inner = ac.update;
  ac.update = function stovlStep(dt, weather) {
    const on = !ctl.broken && ctl.active && isStovl(sim);
    if (on) {
      try { ctl.preStep(this, dt); } catch (e) { fail(sim, e); }
    }
    const out = inner.call(this, dt, weather);
    if (on && !ctl.broken) {
      try { ctl.postStep(this, dt); } catch (e) { fail(sim, e); }
    }
    return out;
  };
  wrapped = ac;
}

const CSS = `
.stovl-panel { position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
  width: 132px; padding: 10px 10px 12px; border-radius: 14px; background: rgba(12,20,34,.78);
  border: 1px solid var(--panel-line, rgba(140,180,230,.18)); color: var(--text, #eaf1fb);
  font: 600 12px/1.25 var(--font, system-ui, sans-serif); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px); display: none; user-select: none; }
.stovl-panel.is-shown { display: block; }
.stovl-btn { pointer-events: auto; display: block; width: 100%; padding: 9px 0 8px; border-radius: 10px;
  border: 1px solid rgba(140,180,230,.35); background: rgba(88,198,255,.12); color: inherit; cursor: pointer;
  font: 800 14px/1 var(--font, system-ui, sans-serif); letter-spacing: .06em; touch-action: manipulation; }
.stovl-btn small { display: block; margin-top: 3px; font-size: 10px; font-weight: 600; letter-spacing: 0; opacity: .75; }
.stovl-btn.is-on { background: rgba(79,214,132,.22); border-color: rgba(79,214,132,.7); color: #c9ffdd; }
.stovl-btn.is-busy { background: rgba(255,194,71,.18); border-color: rgba(255,194,71,.65); color: #ffe6b3; }
.stovl-body { display: none; margin-top: 10px; grid-template-columns: 26px 1fr; gap: 8px; align-items: stretch; }
.stovl-panel.is-live .stovl-body { display: grid; }
.stovl-lever { position: relative; height: 118px; border-radius: 8px; background: rgba(255,255,255,.07);
  border: 1px solid rgba(140,180,230,.22); overflow: hidden; }
.stovl-band { position: absolute; left: 0; right: 0; background: rgba(79,214,132,.28);
  border-top: 1px solid rgba(79,214,132,.8); border-bottom: 1px solid rgba(79,214,132,.8); }
.stovl-knob { position: absolute; left: -1px; right: -1px; height: 6px; margin-top: -3px; border-radius: 3px;
  background: #fff; box-shadow: 0 0 6px rgba(0,0,0,.6); }
.stovl-read { display: flex; flex-direction: column; justify-content: space-between; font-variant-numeric: tabular-nums; }
.stovl-read b { display: block; font-size: 16px; font-weight: 800; }
.stovl-read span { color: var(--text-dim, #9fb2cc); font-weight: 600; font-size: 10.5px; }
.stovl-speed { height: 5px; border-radius: 3px; background: rgba(255,255,255,.12); margin-top: 3px; overflow: hidden; }
.stovl-speed i { display: block; height: 100%; width: 0; background: var(--accent, #58c6ff); }
.stovl-speed.is-high i { background: var(--amber, #ffc247); }
.stovl-hint { margin-top: 8px; font-size: 10.5px; font-weight: 600; color: var(--text-dim, #9fb2cc); text-align: center; }
.stovl-hint.is-warn { color: #ffe6b3; }
.stovl-move { display: none; margin-top: 6px; font-size: 10.5px; font-weight: 700; color: #c9ffdd; text-align: center; line-height: 1.35; }
.stovl-panel.is-live .stovl-move.is-on { display: block; }
.stovl-move kbd { font: 700 9.5px/1 var(--font, system-ui, sans-serif); padding: 0 3px; border-radius: 3px; background: rgba(255,255,255,.14); }
@media (max-width: 700px) { .stovl-panel { right: 8px; width: 116px; } .stovl-lever { height: 92px; } }
/* A short landscape phone: centred, the panel would sit on the touch
   throttle (bottom right, 196 px tall), so it goes up under the wind box. */
@media (max-height: 560px) { .stovl-panel { top: 64px; transform: none; padding: 7px 8px 8px; }
  .stovl-lever { height: 70px; } .stovl-read b { font-size: 13px; } .stovl-hint { display: none; } }
/*
 * While the jet is holding itself up, the game's own stall banner and coach
 * are the wing's advice, and they are wrong: hovering at 7 kt they read
 * "TOO SLOW — add power" and "lower the nose with W", which in a hover means
 * "shoot upwards and fly off". The panel above says what to do instead.
 */
body.stovl-hovering .hud-stall, body.stovl-hovering .hud-coach { display: none !important; }
`;

function buildUi(sim) {
  if (ui || typeof document === 'undefined') return ui;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.className = 'stovl-panel';
  panel.innerHTML = `
    <button class="stovl-btn" type="button" aria-label="Hover on or off"><span class="stovl-state">HOVER</span><small>press T</small></button>
    <div class="stovl-body">
      <div class="stovl-lever"><div class="stovl-band"></div><div class="stovl-knob"></div></div>
      <div class="stovl-read">
        <div><span>HEIGHT</span><b class="stovl-agl">0 m</b></div>
        <div><span>UP / DOWN</span><b class="stovl-vs">0</b></div>
        <div><span>SPEED</span><b class="stovl-kt">0 kt</b><div class="stovl-speed"><i></i></div></div>
      </div>
    </div>
    <div class="stovl-hint"></div>
    <div class="stovl-move"></div>`;
  extLayer().appendChild(panel);
  const q = (s) => panel.querySelector(s);
  const btn = q('.stovl-btn');
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (sim.state === 'flying' && isStovl(sim)) press(sim);
  });
  const band = q('.stovl-band');
  band.style.top = `${(1 - STOVL_TUNE.holdHi) * 100}%`;
  band.style.height = `${(STOVL_TUNE.holdHi - STOVL_TUNE.holdLo) * 100}%`;
  ui = {
    panel, btn, state: q('.stovl-state'), knob: q('.stovl-knob'), agl: q('.stovl-agl'), vs: q('.stovl-vs'),
    kt: q('.stovl-kt'), speed: q('.stovl-speed'), speedFill: q('.stovl-speed i'), hint: q('.stovl-hint'), move: q('.stovl-move'),
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  };
  if (ui.touch) ui.btn.querySelector('small').textContent = 'tap';
  ui.move.innerHTML = ui.touch
    ? 'Stick: slide about<br>Rudder: turn'
    : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> slide · <kbd>Q</kbd><kbd>E</kbd> turn<br><kbd>W</kbd>+<kbd>Shift</kbd> fly away';
  return ui;
}

function press(sim) {
  wrap(sim);
  const before = ctl.mode;
  const what = ctl.toggle(sim.aircraft);
  applyLever(sim);
  if (what === 'hover' || what === 'convert' || what === 'exit' || what === 'stowed') chime(sim, before === 'off' || before === 'exit');
  flushNotes(sim);
  return what;
}

/**
 * Move the real throttle lever where the hover asked: the middle when a
 * hover starts in the air, idle when the nozzle is stowed on the ground, full
 * when it flies away (T, or on its own past 60 kt — which is why the update
 * hook calls this too). A finger on the touch slider still wins; the
 * controller is built to be safe at whatever lever it actually gets.
 */
function applyLever(sim) {
  const want = ctl.leverRequest;
  if (want === null || want === undefined) return;
  ctl.leverRequest = null;
  if (sim.input && Number.isFinite(want)) sim.input.throttleTarget = clamp(want, 0, 1);
}

function flushNotes(sim) {
  while (ctl.notes.length) {
    const n = ctl.notes.shift();
    try { sim.hud && sim.hud.notify(n.text, n.kind, n.seconds); } catch (e) { void e; }
  }
}

/* --- sound: quiet, procedural, and only while the fan is turning --- */
function chime(sim, rising) {
  const a = sim.audio;
  if (!a || !a.available || !a.mixer) return;
  const f = rising ? [520, 780] : [780, 520];
  a.mixer.tone({ bus: 'alerts', freq: f[0], duration: 0.14, gain: 0.07, type: 'sine' });
  setTimeout(() => { try { a.mixer.tone({ bus: 'alerts', freq: f[1], duration: 0.18, gain: 0.07, type: 'sine' }); } catch (e) { void e; } }, 120);
}

function updateSound(sim) {
  const a = sim.audio;
  const want = ctl.active && ctl.lift > 0.02 && isStovl(sim);
  if (!a || !a.available || !a.mixer || !a.mixer.ctx) return;
  const mx = a.mixer;
  if (want && !sound) {
    const src = mx.noiseSource(true);
    const filter = mx.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 400;
    const gain = mx.ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(mx.bus('engine'));
    sound = { src, filter, gain, kq: -1 };
  }
  if (!sound) return;
  if (!want && ctl.nozzle <= 0) {
    stopSound();
    return;
  }
  const k = want ? clamp(ctl.lift, 0, 1.3) : 0;
  // Only schedule a new target when the level has moved by a step. Once a
  // frame, every frame, it piled up two automation events per frame for as
  // long as the jet hovered.
  const kq = Math.round(k * 40);
  if (kq === sound.kq) return;
  sound.kq = kq;
  const t = mx.time;
  sound.gain.gain.setTargetAtTime(0.055 * k, t, 0.12);
  sound.filter.frequency.setTargetAtTime(380 + 520 * k, t, 0.2);
}

/**
 * The stall horn is the wing's, and in a hover the wing is not what is
 * holding the jet up. audio/alerts.js runs before this hook each frame; if
 * it has sounded the horn while the jet carries the weight, it is put back
 * to silent in the same frame. (The proper fix is one line in alerts.js,
 * reading ac.jetBorne — see the integration notes; this covers the gap.)
 */
function quietHorn(sim) {
  const al = sim.audio && sim.audio.alerts;
  const ac = sim.aircraft;
  if (!al || !al.stallActive || typeof al.setStall !== 'function' || !ac || !ac.jetBorne) return;
  al.setStall(false, 0);
}

function stopSound() {
  if (!sound) return;
  const s = sound;
  sound = null;
  try {
    s.gain.gain.value = 0;
    s.src.stop();
    s.src.disconnect();
    s.gain.disconnect();
  } catch (e) { void e; }
}

/* --- the model: nozzle angle and fan door, on this aeroplane only --- */
function updateRig(sim) {
  const model = sim.model;
  if (model !== rigModel) {
    rigModel = model;
    rig = null;
    if (model) model.traverse((o) => { if (!rig && o.userData && o.userData.stovlRig) rig = o.userData.stovlRig; });
  }
  if (!rig) return;
  rig.nozzle = ctl.nozzle;
  rig.doors = ctl.mode === 'off' && ctl.nozzle <= 0.02 ? 0 : 1;
}

function updateUi(sim) {
  if (!ui) return;
  const show = isStovl(sim) && sim.state === 'flying' && !(sim.hud && (sim.hud.enabled === false || sim.hud.hidden));
  ui.panel.classList.toggle('is-shown', show);
  setQuietWing(show && !ctl.broken && ctl.mode !== 'off');
  if (!show) return;
  const ac = sim.aircraft;
  const mode = ctl.broken ? 'broken' : ctl.mode;
  if (mode !== lastUiMode) {
    lastUiMode = mode;
    const label = { off: 'HOVER', convert: 'SLOWING', hover: 'HOVER ON', exit: 'NOZZLE AFT', broken: 'HOVER' }[mode];
    ui.state.textContent = label;
    ui.btn.classList.toggle('is-on', mode === 'hover');
    ui.btn.classList.toggle('is-busy', mode === 'convert' || mode === 'exit');
    ui.panel.classList.toggle('is-live', mode !== 'off' && mode !== 'broken');
  }
  if (mode === 'off' || mode === 'broken') return;
  const t = clamp(ac.controls.throttle, 0, 1);
  const kt = (ac.ias || 0) * KT;
  const agl = Math.max(0, ac.agl || 0);
  const vs = ac.vs || 0;
  // Only touch the DOM when something visible changed.
  const tq = Math.round(t * 100), aq = Math.round(agl), vq = Math.round(vs * 10), kq = Math.round(kt);
  if (tq === shown.t && aq === shown.agl && vq === shown.vs && kq === shown.kt) return;
  shown.t = tq; shown.agl = aq; shown.vs = vq; shown.kt = kq;
  ui.knob.style.top = `${(1 - t) * 100}%`;
  ui.agl.textContent = `${Math.round(agl)} m`;
  ui.vs.textContent = Math.abs(vs) < 0.15 ? 'steady' : `${vs > 0 ? '▲' : '▼'} ${Math.abs(vs).toFixed(1)}`;
  ui.kt.textContent = `${Math.round(kt)} kt`;
  ui.speedFill.style.width = `${clamp(kt / STOVL_TUNE.hoverKt, 0, 1) * 100}%`;
  ui.speed.classList.toggle('is-high', kt > STOVL_TUNE.hoverKt * 0.8);
  let hint = '';
  let warn = false;
  if (!ac.gearDown && agl < 40) { hint = 'Gear is up — press G'; warn = true; }
  else if (ctl.mode === 'convert') hint = 'Slowing down to hover…';
  else if (ctl.mode === 'exit') {
    if (ctl.waitingForStick) { hint = 'Let go of the stick'; warn = true; }
    else hint = t < 0.9 ? 'More throttle — the wing takes over' : 'Climbing away — the wing takes over';
  }
  else if (ac.onGround) hint = t > STOVL_TUNE.holdHi ? 'Lifting off…' : 'Throttle up to lift off';
  else if (t < STOVL_TUNE.holdLo) hint = 'Coming down';
  else if (t > STOVL_TUNE.holdHi) hint = 'Going up';
  else hint = 'Holding height';
  ui.hint.textContent = hint;
  ui.hint.classList.toggle('is-warn', warn);
  ui.move.classList.toggle('is-on', ctl.mode === 'hover' && !ac.onGround);
}

function off(sim) {
  ctl.reset();
  lastUiMode = '';
  shown.t = -1;
  stopSound();
  if (rig) { rig.nozzle = 0; rig.doors = 0; }
  if (ui) ui.panel.classList.remove('is-shown', 'is-live');
  setQuietWing(false);
  void sim;
}

registerExtension({
  id: 'stovl',
  install(sim) {
    wrap(sim);
    buildUi(sim);
  },
  startMode(sim) {
    off(sim);
    ctl.broken = false;
    wrap(sim);
  },
  stop(sim) {
    off(sim);
  },
  update(sim) {
    if (!isStovl(sim)) {
      if (ctl.active || quietWing) off(sim);
      if (ui) ui.panel.classList.remove('is-shown');
      return;
    }
    wrap(sim);
    if (sim.aircraft && sim.aircraft.crashed && ctl.active) ctl.reset();
    // The hover leaves on its own past 60 kt, inside the physics step: this
    // is where that exit gets its full power.
    applyLever(sim);
    flushNotes(sim);
    updateRig(sim);
    updateUi(sim);
    updateSound(sim);
    quietHorn(sim);
  },
  key(sim, code, down, e) {
    if (code !== 'KeyT' || !isStovl(sim)) return false;
    if (down && !(e && e.repeat)) press(sim);
    return true;
  },
  devActions: [
    {
      label: 'F-35B: start in a hover',
      hint: '40 m over the runway, nozzle down, gear down',
      run(sim) {
        if (!isStovl(sim)) {
          sim.hud && sim.hud.notify('Choose the F-35B first.', 'warn', 3);
          return;
        }
        const ac = sim.aircraft;
        ac.reset({ pos: new THREE.Vector3(-200, 0, 0), headingDeg: 90, speed: 0, altAGL: 40, engineOn: true, gearDown: true });
        ac.rpm = 0.6;
        off(sim);
        wrap(sim);
        ctl.nozzle = 1;
        ctl.toggle(ac);
        if (sim.input) sim.input.throttleTarget = 0.5;
        flushNotes(sim);
      },
    },
  ],
});

/** For the browser check and the console: the live controller. */
export function stovlState() {
  return ctl;
}

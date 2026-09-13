/**
 * Flight dynamics.
 *
 * A proper six-degree-of-freedom rigid body with real aerodynamic coefficients
 * for a light single-engine trainer, plus a three-point landing-gear model with
 * springs, brakes, nose-wheel steering and tyre side friction. That is what
 * makes crosswind landings feel like crosswind landings.
 *
 * Two flight modes share the same model:
 *   realistic  — you fly it, it can stall and it will drift in a crosswind.
 *   simplified — the same physics plus gentle auto-levelling, stall protection,
 *                automatic rudder coordination and softened gusts, so the plane
 *                naturally returns to straight and level when you let go.
 *
 * Body axes: -Z is forward (out of the nose), +Y is up, +X is out of the right
 * wing. That matches three.js so the cockpit camera needs no extra rotation.
 */

import * as THREE from '../vendor/three.module.js';
import { getAircraft, specFor, DEFAULT_AIRCRAFT_ID } from './types.js';
import { clamp, lerp } from '../core/noise.js';
import { heightAt, isPaved, isOnRunway, isOnAnyRunway, obstacleAt, platformAt, AIRPORT } from '../world/terrain.js';

const RHO0 = 1.225;
const G = 9.80665;
const KTS = 1.94384; // m/s → knots
const FPM = 196.85; // m/s → feet per minute
const FT = 3.28084;

/**
 * The aeroplane currently being flown, and the numbers that describe it.
 *
 * These are `let`, not `const`, and every module that imports them gets a live
 * binding — so choosing a different aeroplane in the hangar really does change
 * what you are flying, with no reload. Same trick the maps use.
 *
 * All the stability derivatives are per radian of angle or angular rate. The
 * three control-power terms (Cmde, Clda, Cndr) are per *unit of control input*
 * (-1..1) instead. `gearPoints` and `hardPoints` are worked out from the same
 * shape the model is drawn from, so the wheels touch where they look like they
 * touch. See types.js.
 */
export let TYPE = getAircraft(DEFAULT_AIRCRAFT_ID);
export let SPEC = specFor(DEFAULT_AIRCRAFT_ID);

export function applyAircraft(id) {
  TYPE = getAircraft(id);
  SPEC = specFor(TYPE.id);
  return TYPE;
}

export const EVENTS = {
  TOUCHDOWN: 'touchdown',
  LIFTOFF: 'liftoff',
  CRASH: 'crash',
  STALL: 'stall',
  STALL_RECOVER: 'stallRecover',
  GEAR: 'gear',
  ENGINE_START: 'engineStart',
  ENGINE_STOP: 'engineStop',
  OVERSPEED: 'overspeed',
  FUEL_LOW: 'fuelLow',
  BOUNCE: 'bounce',
  ARRESTED: 'arrested',
  DAMAGE: 'damage',
};

export class Aircraft {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.omega = new THREE.Vector3(); // body-frame angular velocity (rad/s)

    this.controls = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0, trim: 0 };
    this.gearDown = true;
    this.gearPos = 1; // 0 = up, 1 = down
    this.flaps = 0;
    this.flapsTarget = 0;
    this.trim = 0;
    // Holds the aeroplane still while you read the briefing; releases itself as
    // soon as you add power.
    this.parkingBrake = true;

    this.engineOn = false;
    /**
     * Things that have gone wrong. Nothing here happens on its own — every one
     * is armed deliberately from the Free Flight triggers panel, so an ordinary
     * flight is never sabotaged by surprise.
     */
    this.failures = {
      engine: false, // dead engine, and it will not restart
      fuelLeak: false, // empties the tanks several times faster than normal
      elevator: false, // pitch control jammed where you left it
      icing: false, // drag up, lift down, stall comes earlier
      gear: false, // undercarriage stuck where it is
      brakes: false, // no wheel braking at all
      roughEngine: false, // running on part power, and shaking
      tyre: false, // a burst main tyre, which drags to one side
    };
    this._jammedPitch = null;
    /*
     * Battle damage, 0..1 per part.
     *
     * Separate from `failures`, which are switches a player arms on purpose.
     * This is what happens TO you: clipping a tree, taking a hit. A damaged
     * aeroplane still flies — that is the whole point of it — it just flies
     * worse, and in a way that tells you which part is hurt.
     */
    this.damage = { leftWing: 0, rightWing: 0, nose: 0, tail: 0, fuselage: 0, gear: 0 };
    /*
     * Off unless the game turns it on — it is behind Dev mode for now, and a
     * flight model that silently changed how crashing works would invalidate
     * every score anybody has already set.
     */
    this.survivableStrikes = false;
    this._hitCool = 0;
    this.arrested = 0;
    /** Seconds the tanks last once a leak starts. */
    this.fuelLeakSeconds = 260;
    this.starting = 0;
    this.rpm = 0;
    this.fuel = SPEC.fuelCapacity;
    /** Flat 1% of the tank every 30 s when on. Settings -> Flying. */
    this.realisticFuel = false;
    this.mode = 'simplified';
    /**
     * How much help you get. 'easy' | 'normal' | 'realistic'.
     *
     * `mode` stays as it was so nothing that reads it has to change; this is
     * the dial underneath it. Normal is exactly the game as it has always
     * played, so nobody's saved scores suddenly mean something different.
     */
    this.difficulty = 'normal';

    // Derived readouts.
    this.airspeed = 0;
    this.ias = 0;
    this.alt = 0;
    this.agl = 0;
    this.vs = 0;
    this.heading = 90;
    this.alpha = 0;
    this.beta = 0;
    this.gLoad = 1;
    this.onGround = true;
    this.wheelsRolling = false;
    this.stalled = false;
    this.crashed = false;
    this.crashReason = '';
    this.groundSpeed = 0;
    this.propBlur = 0;
    this.slipBall = 0;
    this.turnRate = 0;
    this.contactCount = 0;
    this.wheelLoad = 0;
    this.sideScrub = 0;
    this._groundLong = 0;
    this.buffet = 0;
    this.lastTouchdown = null;
    this.airborneTime = 0;
    this.groundTime = 0;
    this.distanceFlown = 0;
    this.brakeHeat = 0;

    this.listeners = new Map();

    this._f = new THREE.Vector3();
    this._t = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    /*
     * The strike test gets its own two scratch vectors rather than borrowing
     * _tmp2, which is already spoken for by the gust and the wheel maths. The
     * camera's look-behind bug was exactly this: two names for one vector, and
     * the second write silently destroyed the first.
     */
    this._hitR = new THREE.Vector3();
    this._hitV = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._m = new THREE.Matrix4();
    this._airRel = new THREE.Vector3();
    this._bodyVel = new THREE.Vector3();
    this._invQ = new THREE.Quaternion();
    this._stallTimer = 0;
    this._lowFuelWarned = false;
    this._overspeedWarned = 0;
    this._rollHeading = null;
    this._steerAssist = 0;
  }

  on(evt, fn) {
    if (!this.listeners.has(evt)) this.listeners.set(evt, []);
    this.listeners.get(evt).push(fn);
    return this;
  }

  emit(evt, data) {
    const l = this.listeners.get(evt);
    if (l) for (const fn of l) fn(data);
  }

  /** Place the aircraft, either parked on the ground or airborne. */
  reset({ pos, headingDeg = 90, speed = 0, altAGL = null, engineOn = true, gearDown = true, fuel = 1 }) {
    this.pos.copy(pos);
    const hdg = THREE.MathUtils.degToRad(headingDeg);
    // Heading 0 = north = -Z. Rotate about Y so the nose points that way.
    this.quat.setFromEuler(new THREE.Euler(0, -hdg + Math.PI, 0, 'YXZ'));
    // Correct for forward = -Z: heading 0 must give forward (0,0,-1).
    this.quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -hdg);
    this.omega.set(0, 0, 0);
    this.vel.set(0, 0, 0);
    if (speed > 0) {
      this.forward(this._tmp);
      this.vel.copy(this._tmp).multiplyScalar(speed);
    }
    if (altAGL !== null) this.pos.y = heightAt(pos.x, pos.z) + altAGL;
    else {
      // Stand it on its wheels. This used to be a flat 1.5 m, which is the
      // trainer's undercarriage and nobody else's — so the bigger aeroplanes
      // spawned with their wheels below the tarmac and their tails in it, and
      // once the springs were stiff enough to actually hold their weight, that
      // buried spring fired them a hundred metres into the air on frame one.
      const lowest = SPEC.gearPoints.reduce((m, g) => Math.min(m, g.pos.y), 0);
      this.pos.y = heightAt(pos.x, pos.z) - lowest;
    }
    this._spawnOnGround = altAGL === null;
    this.gearDown = gearDown;
    this.gearPos = gearDown ? 1 : 0;
    this.engineOn = engineOn;
    for (const k in this.failures) this.failures[k] = false;
    this._jammedPitch = null;
    this.arrested = 0;
    for (const k in this.damage) this.damage[k] = 0;
    this._hitCool = 0;
    this.rpm = engineOn ? 0.18 : 0;
    this.fuel = SPEC.fuelCapacity * fuel;
    this.crashed = false;
    this.crashReason = '';
    this.stalled = false;
    this.controls.throttle = 0;
    this.controls.brakes = 0;
    this.parkingBrake = speed === 0;
    this.flaps = 0;
    this.flapsTarget = 0;
    this.trim = 0;
    this._rollHeading = altAGL === null ? headingDeg : null;
    this.lastTouchdown = null;
    this.airborneTime = 0;
    this.groundTime = 0;
    this.distanceFlown = 0;
    this._lowFuelWarned = false;
    this.onGround = altAGL === null || altAGL < 3;

    // Clear the derived readouts too, so the HUD (and anything polling the
    // aeroplane before the next physics step) never shows the old flight.
    this.airspeed = speed;
    this.ias = speed;
    this.groundSpeed = speed;
    this.vs = 0;
    this.alpha = 0;
    this.beta = 0;
    this.gLoad = 1;
    this.alt = this.pos.y;
    this.agl = this.pos.y - heightAt(this.pos.x, this.pos.z);
    this.heading = headingDeg;
    this.turnRate = 0;
    this.slipBall = 0;
    this.buffet = 0;
    this.brakeHeat = 0;
    this.contactCount = 0;
    this.wheelLoad = 0;
    this.sideScrub = 0;
    this._groundLong = 0;

    if (this._spawnOnGround) this.settleOnGear();
  }

  /**
   * Place the aeroplane in its true static attitude, with every strut already
   * carrying its share of the weight.
   *
   * Without this the aeroplane is dropped onto its main wheels with the nose
   * eight centimetres high, and gravity immediately rocks it forward onto the
   * nose leg. In calm air that is only a wobble; in a crosswind it combines with
   * the roll and drives the propeller into the runway a second after you spawn.
   * A short relaxation solves for the height and pitch that balance the forces.
   */
  settleOnGear() {
    const W = SPEC.mass * G;
    const ground = heightAt(this.pos.x, this.pos.z);
    let pitch = 0;
    const point = new THREE.Vector3();

    for (let iter = 0; iter < 200; iter++) {
      let netF = -W;
      let netM = 0;
      for (const gp of SPEC.gearPoints) {
        // Rotate the contact point by the trial pitch (about the lateral axis).
        const cy = Math.cos(pitch);
        const sy = Math.sin(pitch);
        point.set(gp.pos.x, gp.pos.y * cy - gp.pos.z * sy, gp.pos.y * sy + gp.pos.z * cy);
        const pen = ground - (this.pos.y + point.y);
        if (pen <= 0) continue;
        const N =
          pen <= gp.travel
            ? gp.k * pen
            : gp.k * gp.travel + gp.k * gp.stopRate * (pen - gp.travel);
        netF += N;
        // Pitching moment about the lateral axis is r x F, so an upward force
        // at local z contributes -z*N. A load AFT of the centre of gravity
        // therefore pitches the nose DOWN. Getting this backwards parks the
        // aeroplane nose-high, which in any wind at all makes it fly itself off
        // the ground the instant you spawn.
        netM -= N * point.z;
      }
      this.pos.y += netF * 1.5e-6;
      pitch += netM * 3e-7;
      if (Math.abs(netF) < 2 && Math.abs(netM) < 2) break;
    }

    // Apply the settled pitch on top of the heading rotation.
    this.quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch));
    this._spawnOnGround = false;
  }

  forward(out = new THREE.Vector3()) {
    return out.set(0, 0, -1).applyQuaternion(this.quat);
  }
  up(out = new THREE.Vector3()) {
    return out.set(0, 1, 0).applyQuaternion(this.quat);
  }
  right(out = new THREE.Vector3()) {
    return out.set(1, 0, 0).applyQuaternion(this.quat);
  }

  /** Flaps move in four steps: 0, 10, 20 and 30 degrees. */
  setFlaps(step) {
    this.flapsTarget = clamp(step, 0, 3) / 3;
    return Math.round(this.flapsTarget * 3);
  }

  flapStep() {
    return Math.round(this.flapsTarget * 3);
  }

  toggleGear() {
    if (this.airspeed > SPEC.maxGearSpeed) return false;
    this.gearDown = !this.gearDown;
    this.emit(EVENTS.GEAR, { down: this.gearDown });
    return true;
  }

  startEngine() {
    if (this.engineOn || this.fuel <= 0 || this.failures.engine) return;
    this.starting = 1.8;
    this.emit(EVENTS.ENGINE_START, {});
  }

  stopEngine(reason = 'shutdown') {
    if (!this.engineOn) return;
    this.engineOn = false;
    this.emit(EVENTS.ENGINE_STOP, { reason });
  }

  /** Air density at the current altitude (ISA-ish). */
  get density() {
    return RHO0 * Math.exp(-Math.max(0, this.pos.y) / 8500);
  }

  /** Main entry point. dt is clamped and sub-stepped by the caller. */
  update(dt, weather) {
    if (this.crashed) {
      this.rpm = Math.max(0, this.rpm - dt * 0.6);
      this.controls.throttle = 0;
      return;
    }

    // ---- Engine -------------------------------------------------------
    if (this.starting > 0) {
      this.starting -= dt;
      if (this.starting <= 0) {
        this.engineOn = true;
        this.rpm = 0.18;
      }
    }
    if (this.fuel <= 0 && this.engineOn) this.stopEngine('fuel');
    if (this.failures.engine && this.engineOn) this.stopEngine('failure');

    /*
     * The collective, for a beginner, commands a RATE OF CLIMB — not power.
     *
     * Hovering on the shipped control was not possible, and it is worth being
     * precise about why rather than calling it "hard". Shift and Ctrl move
     * `throttleTarget` at 0.62 a second, so collective is a rate control; the
     * engine then spools towards it with lag. That puts two integrators
     * between the key and the thrust, and a hover asks you to hold one exact
     * power setting with neither of them settled.
     *
     * Measured, with a control pattern better than any ten-year-old could
     * manage — always the correct direction, a quarter-second reaction — the
     * machine wandered 214 metres up and down and hit the ground inside a
     * minute. That is not a difficulty curve, it is a wall.
     *
     * So in simplified mode the lever means "go up", "go down" or, in the
     * middle, "stay where you are", and an inner loop works out the power.
     * Centre it and the machine holds its height. That is what a collective
     * feels like to fly even though it is not what a collective does, and it
     * is the difference between the helicopter being playable and not.
     * Realistic mode keeps the real lever, untouched.
     */
    if (SPEC.rotor && this.mode === 'simplified' && this.engineOn && !this.onGround) {
      const demand = (clamp(this.controls.throttle, 0, 1) - 0.5) * 2;
      const centred = Math.abs(demand) < 0.06;
      /*
       * Centred means "stay at this height", and that needs the height in the
       * loop — not just the rate of climb.
       *
       * Holding vertical speed at zero sounds like the same thing and is not:
       * with no altitude term any small steady error simply integrates, and
       * measured it climbed 117 m in a minute with nobody touching anything.
       * So the moment the lever comes to the middle the machine remembers
       * where it is, and flies back to it.
       */
      if (centred) {
        if (this._holdAlt === null || this._holdAlt === undefined) this._holdAlt = this.pos.y;
      } else {
        this._holdAlt = null;
      }
      const wantVs = centred
        ? clamp((this._holdAlt - this.pos.y) * 0.45, -3.5, 3.5)
        : demand * 4.5;
      const err = wantVs - this.vs;
      this._rotorTrim = clamp(
        (this._rotorTrim ?? this.controls.throttle) + (err * 0.55 - this.vs * 0.05) * dt,
        0,
        1
      );
    } else {
      this._rotorTrim = null;
      this._holdAlt = null;
    }
    const collective = this._rotorTrim ?? this.controls.throttle;
    const targetRpm = this.engineOn ? 0.18 + collective * 0.82 : 0;
    // Engines spool with lag; spin-down is slower than spin-up.
    const spool = targetRpm > this.rpm ? 2.4 : 1.1;
    this.rpm += (targetRpm - this.rpm) * Math.min(1, dt * spool);
    if (this.engineOn) {
      // Realistic fuel: a flat one per cent of the tank every thirty seconds,
      // so a full tank lasts fifty minutes whatever you do with the throttle.
      const burn = this.realisticFuel
        ? SPEC.fuelCapacity * (0.01 / 30)
        : SPEC.fuelBurnMax * (0.16 + this.controls.throttle * 0.84);
      // A leak takes fuel whether the engine wants it or not.
      if (this.failures.fuelLeak) {
        // How long the tanks last with the leak — set on the Free Flight
        // screen, and a sensible default when triggered from the pause menu.
        const seconds = this.fuelLeakSeconds || 260;
        this.fuel = Math.max(0, this.fuel - (SPEC.fuelCapacity / seconds) * dt);
      }
      this.fuel = Math.max(0, this.fuel - burn * dt);
      const pct = this.fuel / SPEC.fuelCapacity;
      if (pct < 0.12 && !this._lowFuelWarned) {
        this._lowFuelWarned = true;
        this.emit(EVENTS.FUEL_LOW, { pct });
      }
      if (pct > 0.2) this._lowFuelWarned = false;
    }

    // A jammed elevator stays exactly where it was when it jammed — you fly
    // on trim, power and the rudder, which is the whole exercise.
    if (this.failures.elevator) {
      if (this._jammedPitch === null) this._jammedPitch = this.controls.pitch;
      this.controls.pitch = this._jammedPitch;
    } else {
      this._jammedPitch = null;
    }

    // Gear animation. A jammed undercarriage does not move.
    const gearTarget = this.failures.gear ? this.gearPos : this.gearDown ? 1 : 0;
    this.gearPos += clamp(gearTarget - this.gearPos, -dt / 2.4, dt / 2.4);

    // Flaps run out slowly, like an electric flap motor.
    this.flaps += clamp(this.flapsTarget - this.flaps, -dt / 3, dt / 3);

    // The parking brake lets go as soon as real power goes in.
    if (this.parkingBrake && (this.controls.throttle > 0.15 || this.controls.brakes > 0.5)) {
      this.parkingBrake = false;
      // Remember which way we were pointing: the ground assist holds this.
      this._rollHeading = this.heading;
    }
    if (!this.onGround) this._rollHeading = null;
    else if (this._rollHeading === null && this.groundSpeed < 2) this._rollHeading = this.heading;
    const brakeInput = this.failures.brakes
      ? 0
      : Math.max(this.controls.brakes, this.parkingBrake ? 1 : 0);

    // ---- Relative wind ------------------------------------------------
    const wind = weather.windVector(this._tmp);
    const gust = weather.gustVector(this._tmp2);
    // The steady wind is felt in full in both modes — a 20 kt crosswind must
    // really be a 20 kt crosswind, or the HUD readout would be a lie. Only the
    // gusty part is softened for beginners.
    /*
     * Gusts, identical in easy and normal.
     *
     * Easy had these at half again softer, and measurement showed the calmer
     * air actually got the aeroplane off the ground *earlier* — 24 s against
     * 31 s — which is airborne before it has the speed to stay there. Every
     * handling difference I tried for easy behaved like that, so easy now
     * flies precisely as normal does, and helps only where it provably can.
     */
    const gustScale = this.mode === 'simplified' ? 0.45 : 1;
    this._airRel.copy(this.vel);
    this._airRel.x -= wind.x + gust.x * gustScale;
    // Sinking air in a microburst. This is felt in full in both modes: the
    // whole point of it is that no amount of assist saves you, only flying out
    // of it does.
    this._airRel.y -= gust.y * 0.6 * gustScale - (weather.downdraft || 0);

    // A tornado is a place rather than a number, so its wind depends on where
    // you are: spin around the core, inflow towards it, and a violent
    // updraught in the middle. Felt in full in both modes, for the same reason.
    if (weather.vortex && weather.vortex.active) {
      this._vortex = this._vortex || new THREE.Vector3();
      const vw = weather.vortex.windAt(this.pos, this._vortex);
      this._airRel.x -= vw.x;
      this._airRel.y -= vw.y;
      this._airRel.z -= vw.z;
    }
    this._airRel.z -= wind.z + gust.z * gustScale;

    const V = this._airRel.length();
    this.airspeed = V;
    const rho = this.density;
    this.ias = V * Math.sqrt(rho / RHO0);
    this.groundSpeed = Math.hypot(this.vel.x, this.vel.z);

    this._invQ.copy(this.quat).invert();
    this._bodyVel.copy(this._airRel).applyQuaternion(this._invQ);
    const u = -this._bodyVel.z; // forward
    const v = this._bodyVel.x; // right
    const w = this._bodyVel.y; // up

    // Angle of attack. The old form clamped the forward component to a floor,
    // which turned any airflow from BEHIND (a parked aeroplane in a tailwind)
    // into a nonsense angle of attack of nearly ninety degrees — and promptly
    // stood the aeroplane on its nose. Compute it honestly instead, and fade
    // the whole linear model out as the forward airflow dies, because linear
    // aerodynamic coefficients mean nothing in reversed or stationary air.
    this.alpha = V > 1.2 && u > 0.5 ? Math.atan2(-w, u) : 0;
    // Clamp the sideslip used by the aerodynamics: past about 25° the linear
    // coefficients stop meaning anything and the model would blow up.
    this.beta = V > 1.2 ? clamp(Math.asin(clamp(v / Math.max(1, V), -1, 1)), -0.45, 0.45) : 0;
    // 1 in normal forward flight, 0 when the air is not flowing over the wing
    // front-to-back. Only ever less than 1 in degenerate cases.
    const aeroFade = clamp(u / 8, 0, 1);

    // ---- Control inputs (with mode assists) ---------------------------
    let elevator = clamp(this.controls.pitch, -1, 1);
    let aileron = clamp(this.controls.roll, -1, 1);
    let rudder = clamp(this.controls.yaw, -1, 1);
    const simple = this.mode === 'simplified';

    // Trim assist. A real aeroplane is trimmed with a wheel so it flies
    // hands-off; rather than adding another control to learn, a slow integrator
    // does it automatically whenever the stick is centred. Without this the
    // aeroplane always settles nose-down and gains speed.
    /*
     * Trim: the pilot's if they have set one, otherwise the assist's.
     *
     * A pilot who tested this pointed out that trim was not a control at all —
     * the flight model had a trim value and wound it automatically, so the
     * thing that makes precise flying possible was being done FOR you and
     * could not be done BY you. Now `controls.trim` is a real axis wound by
     * hand, and while it is set it owns the trim outright.
     *
     * The automatic integrator survives as what it always was — an assist —
     * and only runs when the pilot has left trim alone. That way a beginner
     * never has to know it exists, and someone who wants it gets a trim wheel
     * that nothing fights them for.
     */
    const manualTrim = Math.abs(this.controls.trim || 0) > 0.001;
    if (manualTrim) {
      this.trim = clamp(this.controls.trim * 0.45, -0.45, 0.45);
    } else if (!simple && !this.onGround && Math.abs(this.controls.pitch) < 0.05 && V > 20) {
      this.trim = clamp(this.trim + (-this.omega.x * 1.1 - this.vs * 0.006) * dt * 0.55, -0.45, 0.45);
    } else if (this.onGround || simple) {
      this.trim *= 1 - Math.min(1, dt * 0.8);
    }
    elevator = clamp(elevator + this.trim, -1, 1);

    if (simple) {
      // Auto-coordinate: rudder follows aileron so turns stay tidy. Strictly an
      // in-flight assist — on the ground the rudder steers the nose wheel, and
      // feeding sideslip into it makes the aeroplane chase the crosswind
      // straight off the side of the runway.
      if (!this.onGround && Math.abs(rudder) < 0.05) {
        rudder = clamp(aileron * 0.42 + this.beta * 1.4, -1, 1);
      }

      // On the ground, hold the wings level. A real pilot rolls aileron into a
      // crosswind during the take-off roll and the roll-out; without it the
      // upwind wing lifts and the downwind tip eventually finds the tarmac.
      if (this.onGround && V > 6 && Math.abs(this.controls.roll) < 0.06) {
        // Aileron into the wind (the beta term) plus wings-level feedback.
        aileron = clamp(
          aileron + this.beta * 0.9 - this.bankAngleRad() * 4.5 - this.omega.z * 0.8,
          -1,
          1
        );
      }

      // Keep the weight off the nose wheel during the ground roll. This is the
      // gentle back pressure every pilot is taught to hold, and it is what
      // stops brake torque and crosswind roll from walking the nose down until
      // the propeller reaches the tarmac.
      if (this.onGround && V > 6 && Math.abs(this.controls.pitch) < 0.06) {
        const pitchAngle = Math.asin(clamp(this.forward(this._tmp).y, -1, 1));
        const hold = (-0.045 - pitchAngle) * 5.5 - this.omega.x * 0.9;
        elevator = clamp(elevator + Math.max(0, hold), -1, 1);
      }

      // Hands-off self-levelling. These assists move the *controls*, not the
      // aeroplane, so they scale with airspeed exactly like a real pilot's
      // inputs — a raw torque would be far too weak at cruise and far too
      // strong on the approach.
      if (!this.onGround && V > 14) {
        if (Math.abs(this.controls.roll) < 0.06) {
          // Wings level.
          //
          // These gains used to be two constants tuned on the trainer, and
          // they did not survive meeting a different aeroplane. The trainer
          // has enormous natural roll damping; the fighter has about a third
          // of it for the same aileron response, so the same gain gave a
          // damping ratio of 0.35, the control-rate limit added lag on top,
          // and the assist drove a roll oscillation out to 58 degrees of bank
          // at 200 degrees a second with the stick centred. The airframe was
          // fine — in realistic mode, with no assist, it held the wings level
          // to a tenth of a degree.
          //
          // So the gains are worked out from the aeroplane instead. `A` is the
          // roll acceleration a unit of aileron actually buys and `D` is the
          // damping the airframe already has; solving for a fixed natural
          // frequency and damping ratio gives an assist that feels the same in
          // all five and is stable in all five.
          const bank = this.bankAngleRad();
          const qNow = 0.5 * this.density * V * V;
          const b = SPEC.wingSpan;
          const base = (qNow * SPEC.wingArea * b) / SPEC.Izz;
          /*
           * On a helicopter the roll comes from the cyclic, not the aileron.
           *
           * This sized the leveller's gain from aileron authority alone. On
           * the Skyhook the real roll moment comes from the rotor block
           * further down, and it is about nine times stronger — so the loop
           * ran at nine times the gain it thought it had and was violently
           * unstable in simplified mode, which is the default and the setting
           * a struggling child picks. Measured hands-off from straight and
           * level: 2 degrees of bank became 7, then 36, then 105 in four
           * seconds, and the machine hit the ground at 22.8 s. With the
           * assists off, in realistic mode, it did not roll at all.
           */
          let A = Math.max(0.5, base * SPEC.Clda); // roll accel per unit aileron
          if (SPEC.rotor) {
            const coll = clamp(this.rpm, 0, 1);
            // Same expression the cyclic block below uses for the roll moment.
            A += ((0.35 + coll * 0.65) * SPEC.mass * G * SPEC.rotorRollArm) / SPEC.Izz;
          }
          const D = Math.abs(base * SPEC.Clp * (b / (2 * V))); // natural damping
          // How brisk the leveller is allowed to be.
          //
          // A fixed 3.5 rad/s worked on the light aeroplanes and wrecked the
          // fighter, whose Dutch roll sits near 1 rad/s: a roll loop running
          // three times faster than the aeroplane's own lateral mode fights
          // it, and the two argue. So the leveller is tied to that mode — it
          // stays comfortably slower than the aeroplane's natural wallow and
          // therefore damps it instead of exciting it.
          const baseYaw = (qNow * SPEC.wingArea * b) / SPEC.Iyy;
          const wnDutch = Math.sqrt(Math.max(0.05, baseYaw * SPEC.Cnb));
          /*
           * Easy levels the wings harder and sooner.
           *
           * A 12 kt crosswind rolled a beginner's take-off straight into the
           * ground — measured, airborne at 24 s and a wing tip down by 18 ft.
           * The leveller was working, just not urgently enough to catch a
           * departure that starts the moment the wheels leave. A faster loop
           * is exactly the instructor's hand that easy is supposed to be.
           */
          const WN = clamp(0.8 * wnDutch, 1.2, 3.5);
          const ZETA = 1.15; // a shade over-damped, so it never overshoots
          // Bound the *gain*, not the output. Clipping the output was the
          // first attempt and it made the assist a bang-bang controller: on a
          // fast jet at low speed the demand ran into the limit at any real
          // bank angle, so it slammed to one end, overshot, slammed to the
          // other, and rang for half a minute. Limiting the proportional gain
          // instead keeps the loop linear, and the damping term is then solved
          // for whatever frequency that gain actually achieves — so it stays
          // properly damped rather than merely quiet.
          const kp = (WN * WN) / A;
          const kd = Math.max(0, (2 * ZETA * WN - D) / A);
          aileron = clamp(aileron - bank * kp - this.omega.z * kd, -1, 1);
        }
        if (Math.abs(this.controls.pitch) < 0.06) {
          /*
           * Hold height: pull when sinking, push when climbing.
           *
           * The two gains below are fixed numbers tuned against a wing's
           * elevator. A rotor's pitch moment comes from the cyclic instead
           * and is roughly twenty-seven times stronger at low speed, so the
           * same numbers drove the helicopter into a pitch oscillation it
           * could not damp — it wandered off in bank and height and, with the
           * roll loop over-gained too, flew itself into the ground in under
           * half a minute. Scaling the demand by how much more authority the
           * rotor actually has keeps the loop where it was designed.
           */
          let pitchAuth = 1;
          if (SPEC.rotor) {
            const coll = clamp(this.rpm, 0, 1);
            const rotorAcc = ((0.35 + coll * 0.65) * SPEC.mass * G * SPEC.rotorPitchArm) / SPEC.Iyy;
            const wingAcc = Math.max(0.05, (0.5 * this.density * V * V * SPEC.wingArea * SPEC.chord * Math.abs(SPEC.Cmde)) / SPEC.Iyy);
            pitchAuth = wingAcc / (wingAcc + rotorAcc);
          }
          elevator = clamp(
            elevator - (this.vs * 0.085 + this.omega.x * 0.38) * pitchAuth,
            -1,
            1
          );
        }
        // Turn coordination was tried here and taken out again: feeding rudder
        // in proportion to sideslip acts like a bigger fin, which raises the
        // Dutch roll frequency and *lowers* its damping ratio. It made the
        // wallow it was meant to cure marginally worse. Yaw rate is the thing
        // to feed back, and the yaw damper above already does that.
      }

    }

    // Yaw damper. Fitted to the jets, active in both modes, because it is part
    // of the aeroplane rather than a beginner's aid. The gain is solved for
    // each airframe: work out the Dutch roll frequency and the damping the fin
    // already provides, then add whatever rudder is needed to bring the
    // damping ratio up to something a passenger would not notice.
    if (SPEC.yawDamper && !this.onGround && V > 20) {
      const qNow = 0.5 * this.density * V * V;
      const b = SPEC.wingSpan;
      const baseY = (qNow * SPEC.wingArea * b) / SPEC.Iyy;
      const wnDutch = Math.sqrt(Math.max(0.05, baseY * SPEC.Cnb));
      const natural = Math.abs(baseY * SPEC.Cnr * (b / (2 * V)));
      const authority = Math.max(0.02, baseY * SPEC.Cndr);
      const want = 2 * 0.5 * wnDutch; // damping ratio one half
      const kYaw = Math.max(0, (want - natural) / authority);
      // Sign: Cndr is positive-yaws-right, and +Y body torque is nose LEFT, so
      // positive rudder makes omega.y negative. To oppose a positive yaw rate
      // the damper therefore feeds in *positive* rudder. Getting this backwards
      // turns the damper into an oscillator, which is exactly what it did.
      rudder = clamp(rudder + this.omega.y * kYaw, -1, 1);
    }

    if (this.mode === 'simplified') {
      /*
       * How much the aeroplane helps, by level.
       *
       * Easy is not "normal with bigger numbers" — it targets the two places
       * a beginner actually loses the aeroplane. `lowSpeedElevator` is the
       * rotate and the flare, which is where most people are either heaving
       * or doing nothing. `stallGuard` is how early the aeroplane refuses to
       * be pulled into a stall. Everything else is left alone, because an
       * aeroplane that cannot be flown badly is not an aeroplane.
       */
      /*
       * Easy and normal fly identically. The difference is the undercarriage.
       *
       * Five measured attempts at making the *handling* easier every one made
       * it worse, and the last was the clearest. Easy's earlier stall guard
       * bleeds off elevator sooner, so the aeroplane rotates less, accelerates
       * better and leaves the ground at 24 s instead of 31 — at a low pitch
       * attitude and low speed, where a 12 kt crosswind puts a wing tip in the
       * grass. Every "help" I added moved the take-off earlier and made it
       * more fragile.
       *
       * What a beginner actually needs is not a different aeroplane, it is to
       * survive the arrival and keep playing. So easy flies exactly as normal
       * does, and takes 1,350 fpm on touchdown where normal takes 900 —
       * measured at 1,100 fpm, easy walks away and normal does not. That is a
       * real difference in a place that cannot make the aeroplane behave
       * strangely, which is more than any of the others managed.
       */
      const help = { lowSpeedElevator: 0.55, stallGuard: 0.045, guardSpan: 0.12 };
      if (V < 45) elevator = clamp(elevator * (1 + (1 - V / 45) * help.lowSpeedElevator), -1, 1);
      const margin = (SPEC.alphaStall - help.stallGuard - this.alpha) / help.guardSpan;
      if (elevator > 0 && margin < 1) elevator *= clamp(margin, 0, 1);
    }

    // Nose-down authority on the ground, both modes.
    //
    // Once the nose leg is carrying weight, shoving the stick further forward
    // achieves nothing on a real aeroplane — the leg is already on its stop and
    // the elevator is in the propeller's wake. Here it kept right on pitching:
    // full forward stick during the roll-out lifted BOTH main wheels, pivoted
    // the aeroplane about the nose wheel and put the propeller into the tarmac
    // about half a second after a perfectly good landing. Wings level, belly
    // and wing tips still metres clear, so from the cockpit it looked like
    // crashing on the runway for no reason at all.
    //
    // The limit tapers in from -3 degrees and reaches zero by -7, which is well
    // short of the 12 degrees the propeller needs. Full deflection comes
    // straight back the moment the wheels leave the ground.
    if (this.onGround) {
      const pitchNow = Math.asin(clamp(this.forward(this._tmp).y, -1, 1));
      const room = clamp((pitchNow + 0.105) / 0.06, 0, 1);
      const pushLimit = -0.3 * room;
      if (elevator < pushLimit) elevator = pushLimit;

    }

    // ---- Aerodynamics -------------------------------------------------
    const q = 0.5 * rho * V * V;
    const S = SPEC.wingArea;
    const qS = q * S;

    // Flaps add camber (more lift, more drag) and stall a little earlier.
    const flapCL = this.flaps * 0.62;
    const flapCD = this.flaps * 0.031;

    // Lift curve with a soft stall break.
    let CL;
    const aStall = SPEC.alphaStall - this.flaps * 0.03 - (this.failures.icing ? 0.06 : 0);
    const aAbs = Math.abs(this.alpha);
    const sign = this.alpha < 0 ? -1 : 1;
    if (aAbs <= aStall) {
      CL = SPEC.CL0 + flapCL + SPEC.CLa * this.alpha;
    } else {
      // Post-stall: lift falls away, and keeps falling if you hold it in.
      const over = aAbs - aStall;
      /*
       * Only the angle-of-attack term changes sign, not the camber.
       *
       * This read `(SPEC.CL0 + flapCL) * sign + ...`, which flipped the
       * camber the wing carries at zero alpha as well — and a wing does not
       * lose its camber because you pushed the nose down. The effect was that
       * passing the negative stalling angle did not break the lift, it
       * STEPPED it, the wrong way: measured across the fleet at full flap,
       * CL jumped from -0.46 to -2.14 on the trainer and from -0.16 to -1.68
       * on the flying wing, four to ten times over, inside a single frame.
       * Push over hard in the Osprey on approach and the wing that was
       * supposed to be giving up hit you with an extra 1.4 g downwards.
       */
      const peak = SPEC.CL0 + flapCL + SPEC.CLa * aStall * sign;
      CL = peak * Math.max(0.28, 1 - over * 2.1);
    }
    /*
     * The wing stalls at a large angle of attack either way up, so the lift
     * curve above rightly works on |alpha|. The *warning* does not.
     *
     * A stall warner is a vane or a lift transducer on the leading edge, and
     * it can only sense positive angle of attack — push the nose down hard and
     * a real one stays silent, because you are the furthest thing from a stall
     * that you can be. Keying the warning off |alpha| meant a firm push-over
     * set off the stall alert, which is exactly backwards and teaches the
     * opposite of the right reflex.
     *
     * Buffet keeps the symmetric test: an aeroplane held at a big negative
     * angle really does shake, whatever the horn thinks.
     */
    const aerodynamicStall = aAbs > aStall && V > 8;
    const warnStall = this.alpha > aStall && V > 8;
    if (warnStall !== this.stalled) {
      this.stalled = warnStall;
      this.emit(warnStall ? EVENTS.STALL : EVENTS.STALL_RECOVER, { alpha: this.alpha });
    }
    this.buffet = aerodynamicStall ? clamp((aAbs - aStall) * 6, 0, 1) : 0;

    const gearDrag = SPEC.gearDragArea * this.gearPos * 0.02;
    const CD =
      SPEC.CD0 + (this.failures.icing ? 0.022 : 0) + flapCD + SPEC.k * CL * CL + gearDrag + Math.abs(this.beta) * 0.36;

    /*
     * What the damage does to the wing.
     *
     * A hurt wing makes less lift and more drag. Both wings hurt equally and
     * the aeroplane simply sinks; one wing worse than the other and it rolls
     * towards the bad side, which is the part you can feel and fly against.
     */
    const dmg = this.damage;
    const wingHurt = (dmg.leftWing + dmg.rightWing) / 2;
    const wingAsym = dmg.leftWing - dmg.rightWing;
    const lift = qS * CL * aeroFade * (1 - wingHurt * 0.34);
    const drag = qS * (CD + wingHurt * 0.05 + dmg.nose * 0.03 + dmg.tail * 0.02 + dmg.fuselage * 0.04);
    const sideForce = qS * SPEC.CYb * this.beta * aeroFade;

    // Thrust falls off with forward speed like a fixed-pitch propeller.
    const propEff = clamp(1 - 0.5 * (u / 100), 0.12, 1);
    // A rough engine still runs — it just cannot make full power, which is a
    // far more interesting problem than one that has stopped: you can still
    // fly, you just have to decide where you are going to get to.
    const rough = this.failures.roughEngine ? 0.45 : 1;
    // A hit up front costs you power, and at the top end costs you the engine.
    const noseHurt = 1 - dmg.nose * 0.55;
    const thrust =
      this.rpm * SPEC.thrustMax * (rho / RHO0) * propEff * rough * noseHurt * (simple ? 1.12 : 1);

    // Body-frame aerodynamic force.
    //
    // Lift acts perpendicular to the relative wind, which in body axes is the
    // direction (0, cosα, -sinα). Drag opposes the relative wind itself — and
    // it is written as a true vector here rather than assuming the air arrives
    // from straight ahead, so a tailwind pushes the aeroplane forwards like it
    // should instead of backwards.
    const ca = Math.cos(this.alpha);
    const sa = Math.sin(this.alpha);
    let fx = sideForce;
    let fy = lift * ca;
    let fz = -thrust - lift * sa; // -Z is forward
    if (V > 0.15) {
      const inv = 1 / V;
      // Body-frame airspeed direction: (v, w, -u) normalised.
      fx -= drag * v * inv;
      fy -= drag * w * inv;
      fz -= drag * -u * inv;
    }

    /*
     * A rotor, for the helicopter.
     *
     * The trick is that it needs almost no new machinery. Rotor thrust acts
     * along the body's own up axis, and the body frame rotates with the
     * aircraft — so tilting the nose down tilts the thrust vector forward and
     * the machine translates, which is exactly how a real helicopter moves.
     * There is no separate "forward speed" term anywhere; cyclic is just the
     * pitch and roll you already have, and the geometry does the rest.
     *
     * Collective is the throttle. Hover sits near the middle of its range, so
     * the stick has somewhere to go in both directions — a helicopter that
     * hovers at full power cannot climb.
     */
    if (SPEC.rotor) {
      const collective = clamp(this.rpm, 0, 1);
      // Sized so that hover lands near 50% collective at sea level.
      const hoverThrust = SPEC.mass * G;
      const rotor = collective * hoverThrust * 2.0 * (rho / RHO0) * rough;
      // Translational lift: a rotor is measurably more efficient once it flies
      // out of its own downwash, which is why a helicopter that will not lift
      // vertically can often run along the ground and get away.
      const ettl = 1 + clamp(V / 24, 0, 1) * 0.11;
      fy += rotor * ettl;
      // The disc drags as it is tilted into the airflow.
      /*
       * Rotor drag opposes the way you are actually going.
       *
       * This was `fz += ...`: a force along body +Z, aft, sized by the total
       * airspeed and pointed the same way whatever the machine was doing. So
       * a vertical climb — where V is the climb rate and nothing is moving
       * forward at all — shoved it backwards at 1,820 N. Measured: climbing
       * straight up in still air, it accelerated to 42 m/s rearwards and
       * ended 295 m from where it started. Hovering in a tailwind it crept
       * upwind. The aerodynamic drag a few lines above is written correctly
       * as a vector along the relative wind; this one simply was not.
       */
      const rd = clamp(V, 0, 60) * SPEC.rotorDrag * 0.5;
      if (V > 0.15) {
        // Same body-frame airflow direction the drag above uses: (v, w, -u).
        const inv = 1 / V;
        fx -= rd * v * inv;
        fy -= rd * w * inv;
        fz -= rd * -u * inv;
      }
    }

    this._f.set(fx, fy, fz).applyQuaternion(this.quat);
    this._f.y -= SPEC.mass * G;

    // ---- Moments ------------------------------------------------------
    const p = this.omega.z; // roll rate (about Z)
    const qRate = this.omega.x; // pitch rate (about X)
    const r = this.omega.y; // yaw rate (about Y)
    const b = SPEC.wingSpan;
    const c = SPEC.chord;
    const vSafe = Math.max(12, V);

    // Sign conventions in this body frame (-Z forward, +Y up, +X right):
    //   +X torque = nose up, +Z torque = left wing down, +Y torque = nose LEFT.
    // Positive beta means the relative wind comes from the right, so a stable
    // fin must yaw the nose to the RIGHT — hence the minus signs below. (Getting
    // this backwards makes the aeroplane diverge in yaw in any crosswind.)
    // Pitch: +X torque is nose up, which matches the usual aerodynamic sign
    // convention, so the coefficients go straight in.
    let Cm = SPEC.Cmalpha * this.alpha + SPEC.Cmq * (qRate * c) / (2 * vSafe) + SPEC.Cmde * -elevator;

    // Roll: +Z torque rolls LEFT (left wing down), so every term is written for
    // that sense rather than negating a standard-convention total.
    // On the ground the wing is in ground effect and partly shielded, and the
    // aeroplane is on its wheels: the roll-due-to-sideslip that matters in
    // flight is far weaker. Full strength here rolls a taxiing aeroplane over
    // in any real crosswind.
    const dihedral = Math.abs(SPEC.Clb) * (this.onGround ? 0.35 : 1);
    let Cl =
      dihedral * this.beta - // dihedral: wind from the right rolls left
      SPEC.Clda * aileron - // positive aileron input rolls right
      Math.abs(SPEC.Clp) * (p * b) / (2 * vSafe); // roll damping

    // Yaw: +Y torque yaws LEFT.
    let Cn =
      -SPEC.Cnb * this.beta - // weathercock: nose swings into the wind
      SPEC.Cndr * rudder - // positive rudder input yaws right
      Math.abs(SPEC.Cnr) * (r * b) / (2 * vSafe); // yaw damping

    // Post-stall wing drop: one wing lets go before the other. This is real
    // aerodynamics, so it follows the symmetric stall, not the warner.
    if (aerodynamicStall) {
      Cl += Math.sin(this.pos.x * 0.3 + this.pos.z * 0.17) * 0.05 * clamp((aAbs - aStall) * 4, 0, 1);
      Cm -= 0.12 * clamp((aAbs - aStall) * 3, 0, 1); // nose drops
    }

    /*
     * A damaged tail stops doing as it is told, and a lopsided wing rolls you.
     *
     * The roll is written as a coefficient rather than a torque so it scales
     * with dynamic pressure like every other aerodynamic term — which means
     * it bites hardest when you are fast, and you can fly slower to tame it.
     * That is a real decision for the player, not just a penalty.
     */
    const tailAuth = 1 - dmg.tail * 0.62;
    Cm *= tailAuth;
    Cn *= tailAuth;
    /*
     * A lopsided wing rolls you towards the damaged side.
     *
     * Sign and size were both settled by measurement, at one known state, one
     * step at a time — flying it for a few seconds and watching the bank was
     * useless, because the propeller torque roll swamps this and the bank
     * angle wraps past 180 and lies to you.
     *
     * Measured: full aileron is about 6 rad/s² of roll. A completely destroyed
     * wing is set to about 80% of that, so the worst possible damage is a
     * handful you can still fly against with the stick, and half-damage is a
     * nuisance you can trim out with a little aileron held in.
     */
    Cl += wingAsym * 0.025;

    // Torque about body axes: X = pitch, Y = yaw, Z = roll. Faded out with the
    // forward airflow for the same reason as the forces above.
    this._t.set(Cm * qS * c * aeroFade, Cn * qS * b * aeroFade, Cl * qS * b * aeroFade);

    /*
     * Cyclic and tail rotor — control that works when standing still.
     *
     * This is the piece that actually makes a helicopter a helicopter, and its
     * absence is invisible until you try to hover. Every control moment above
     * comes from dynamic pressure: elevator, aileron and rudder all scale with
     * q = ½ρV², so at zero airspeed they produce nothing at all. On a wing
     * that is exactly right. On a rotorcraft it means the machine hovers
     * beautifully and cannot be pointed — measured, the stick held hard over
     * for ten seconds in a hover moved the nose zero degrees.
     *
     * A rotor does not work that way. Cyclic tilts the disc and the thrust
     * vector with it, so the moment it generates is proportional to how hard
     * the rotor is pulling, not to how fast the machine is going through the
     * air. The tail rotor is the same: it is a propeller in its own right and
     * has full authority at a standstill, which is why a helicopter can spin
     * on the spot.
     */
    if (SPEC.rotor) {
      const collective = clamp(this.rpm, 0, 1);
      // Enough authority to be crisp in the hover, without being twitchy.
      const disc = (0.35 + collective * 0.65) * SPEC.mass * G;
      this._t.x += elevator * disc * SPEC.rotorPitchArm;
      this._t.z += aileron * disc * SPEC.rotorRollArm;
      this._t.y += rudder * disc * SPEC.rotorYawArm;
      // And damping, or it rings: a real rotor resists being rotated.
      this._t.x -= this.omega.x * SPEC.Iyy * 0.9;
      this._t.z -= this.omega.z * SPEC.Izz * 1.1;
      this._t.y -= this.omega.y * SPEC.Ixx * 0.7;
    }

    // Propeller torque and P-factor: the aeroplane pulls left at high power.
    // Deliberately mild — enough to notice and correct with rudder, not enough
    // to swap ends on the runway before a beginner reacts.
    // Propeller effects: the slipstream corkscrewing back over the fin yaws
    // you left, and the engine torque rolls you the other way to the
    // propeller. Both belong to aeroplanes that have a propeller.
    const torqueScale = (simple ? 0.25 : 0.7) * (SPEC.propeller ? 1 : 0);
    this._t.y += this.rpm * 180 * (1 - clamp(u / 60, 0, 0.8)) * torqueScale;
    // A burst left main drags: the aeroplane pulls that way, harder the faster
    // you are rolling, and you hold it straight on the rudder and the brakes.
    if (this.failures.tyre && this.onGround) {
      this._t.y += clamp(this.groundSpeed / 18, 0, 1) * SPEC.mass * 0.9;
    }
    this._t.z += this.rpm * 90 * torqueScale;

    // Turbulence buffeting.
    const turb = weather.turbulenceLevel() * (simple ? 0.45 : 1);
    if (turb > 0.001 && !this.onGround) {
      const tScale = turb * clamp(V / 40, 0.2, 1.4);
      const tt = weather.time_s;
      this._t.x += Math.sin(tt * 7.3 + 1.1) * 620 * tScale * Math.sin(tt * 2.1);
      this._t.y += Math.sin(tt * 5.7 + 3.3) * 520 * tScale * Math.sin(tt * 1.3);
      this._t.z += Math.sin(tt * 9.1 + 0.7) * 700 * tScale * Math.sin(tt * 1.7);
      this._f.y += Math.sin(tt * 6.1) * 1500 * tScale;
    }

    // Simplified mode: extra rate damping so nothing ever feels twitchy. The
    // self-levelling itself happens up in the control-input section, where it
    // can scale with airspeed properly.
    if (simple) {
      // Bank limit near the ground. A wheel leaves the tarmac past about five
      // degrees of bank, so beyond ten the aeroplane is on its way to dragging
      // a wing tip and no tyre friction will stop it. Applied by height rather
      // than by wheel contact, because it usually lifts a wheel first.
      if (this.onGround || this.agl < 4) {
        // A positive (right-wing-down) bank needs a positive Z torque to pick
        // the wing back up — see the sign conventions above the moment block.
        const bankNow = this.bankAngleRad();
        const overBank = Math.abs(bankNow) - 0.17; // ~10 degrees
        if (overBank > 0) this._t.z += Math.sign(bankNow) * overBank * 300000 - p * 12000;
      }
      // These were flat torques, which meant the trainer got 0.69 rad/s² of
      // roll damping per rad/s and the fighter — ten times the inertia — got
      // a tenth of that. The mode that is supposed to be the forgiving one was
      // barely helping the aeroplanes that needed it most. Scaling by inertia
      // gives every aeroplane the same deceleration.
      this._t.x -= qRate * 900 * (SPEC.Ixx / 1800);
      this._t.y -= r * 1100 * (SPEC.Iyy / 2600);
      this._t.z -= p * 900 * (SPEC.Izz / 1300);

      // Ground steering assist. Damping the yaw rate is what a beginner
      // actually needs: the nose then holds whatever direction it is pointing
      // (down the runway) and the tyres do the rest. Chasing the velocity
      // vector instead would be unstable at walking pace, where the "track" is
      // mostly sideways drift.
      if (this.onGround) {
        this._t.y -= r * 4200;



        // With little or no airflow — stopped, or rolling out downwind — the
        // elevator has no authority at all, so the attitude has to be held
        // directly. This stands in for the nose strut and the pilot, and it is
        // what stops a downwind roll-out from tipping onto the propeller.
        const pitchNow = Math.asin(clamp(this.forward(this._tmp).y, -1, 1));
        // Stiffer against nose-down than nose-up: the nose strut is what is
        // being modelled here, and it only pushes one way.
        const err = -0.05 - pitchNow;
        this._t.x += (err * (err > 0 ? 90000 : 25000) - qRate * 9000) * (1 - aeroFade * 0.7);
        // Hold the heading the roll started on (the runway heading) and kill
        // sideways drift, so a light crosswind cannot quietly walk a beginner
        // off the centreline. A strong crosswind still wins.
        if (this.groundSpeed > 2 && Math.abs(rudder) < 0.06 && this._rollHeading !== null) {
          const hdgErr = ((this.heading - this._rollHeading + 540) % 360) - 180;
          this._t.y += THREE.MathUtils.degToRad(clamp(hdgErr, -25, 25)) * 19000;

          const rightV = this.right(this._tmp2);
          rightV.y = 0;
          rightV.normalize();
          const vLat = this.vel.x * rightV.x + this.vel.z * rightV.z;
          this._t.y += clamp(vLat, -3, 3) * 4200;

          // Also steer the nose wheel. That is the mechanism that actually
          // holds a real aeroplane on the centreline — a yaw torque alone just
          // points the nose while the aeroplane keeps tracking off the side.
          this._steerAssist = clamp(-hdgErr * 0.05 - vLat * 0.22, -0.7, 0.7);
        } else {
          this._steerAssist = 0;
        }
      }
    }

    // ---- Landing gear / ground contact --------------------------------
    this.contactCount = 0;
    this.wheelLoad = 0;
    this.sideScrub = 0;
    this._groundLong = 0;
    let maxImpact = 0;
    const wasOnGround = this.onGround;

    if (this.gearPos > 0.5 || true) {
      for (const gp of SPEC.gearPoints) {
        // Retracted gear cannot hold the aeroplane up.
        const extend = this.gearPos;
        const local = this._tmp.copy(gp.pos);
        if (extend < 1) local.y = lerp(-0.35, gp.pos.y, extend);
        const world = local.clone().applyQuaternion(this.quat).add(this.pos);
        const gh = heightAt(world.x, world.z);
        const pen = gh - world.y;
        if (pen <= 0) continue;
        if (extend < 0.85) {
          // Gear-up contact: this is a belly landing, and the belly is where
          // it hit — `world` is the leg's own position, which is close enough
          // to the skin the aeroplane slid along.
          this.crash('You landed with the wheels up', {
            worldPoint: world.clone(),
            part: 'fuselage',
          });
          return;
        }
        this.contactCount++;

        // Velocity of this contact point (rigid body).
        const rWorld = local.clone().applyQuaternion(this.quat);
        const pointVel = this._tmp2
          .copy(this.omega)
          .applyQuaternion(this.quat)
          .cross(rWorld)
          .add(this.vel);

        // Oleo strut: linear over its usable travel, then a mechanical stop
        // that gets very stiff very fast. Without the stop, brake torque simply
        // compresses the nose leg until the propeller reaches the ground, and a
        // firm landing sinks the aeroplane onto its own belly — both of which
        // crash you with nothing visibly touching.
        const vN = pointVel.y;
        const travel = gp.travel;
        const spring =
          pen <= travel
            ? gp.k * pen
            : gp.k * travel + gp.k * gp.stopRate * (pen - travel);
        // The damper can push back hard, but never so hard that it launches the
        // aeroplane back into the air on its own.
        const damping = clamp(-gp.c * vN, -spring * 0.85, spring * 1.4 + 3000);
        let N = clamp(spring + damping, 0, 160000);
        this.wheelLoad += N;
        maxImpact = Math.max(maxImpact, -vN);

        const force = new THREE.Vector3(0, N, 0);

        // Tyre friction: split the horizontal velocity into rolling and
        // scrubbing components using the wheel's steer angle.
        const fwd = this.forward(new THREE.Vector3());
        fwd.y = 0;
        if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
        fwd.normalize();
        let steerAngle = 0;
        if (gp.steer) {
          const authority = clamp(1 - this.groundSpeed / 40, 0.12, 1);
          steerAngle = -(rudder + (simple ? this._steerAssist || 0 : 0)) * 0.42 * authority;
        }
        const rollDir = fwd.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), steerAngle);
        const sideDir = new THREE.Vector3(-rollDir.z, 0, rollDir.x);

        const hv = new THREE.Vector3(pointVel.x, 0, pointVel.z);
        const vRoll = hv.dot(rollDir);
        const vSide = hv.dot(sideDir);

        const paved = isPaved(world.x, world.z);
        // A wet runway really is more slippery.
        const wet = 1 - 0.3 * weather.cond.rain;
        const muSide = (paved ? 0.92 : 0.75) * wet;
        const muRoll = paved ? 0.022 : 0.075;
        // Braking is limited by the physical tip-over condition: the nose-down
        // moment it makes about the nose wheel can never exceed the moment the
        // aeroplane's own weight makes the other way. This is the real limit a
        // pilot works to, and it means no amount of brake can stand the
        // aeroplane on its propeller.
        // 0.7 keeps a real margin below the tipping moment rather than sitting
        // exactly on it. Still gives roughly half-g braking, which is plenty.
        const tipLimit = (0.7 * SPEC.mass * G * 1.15) / 1.5 / 2; // per braked wheel
        const brakeCap = gp.brake ? Math.min(N * (paved ? 0.55 : 0.4), tipLimit) : 0;
        const brakeMu = N > 1 ? (brakeInput * brakeCap) / N : 0;

        // Tyre friction, impulse limited. Two rules keep this stable:
        //   1. The force is proportional to slip velocity near zero rather than
        //      flipping sign with it — a sign-based force chatters violently
        //      once the wheel is nearly stopped, which is what made braking
        //      throw the aeroplane around.
        //   2. It is never allowed to exceed the force that would exactly stop
        //      this contact point within one step, so friction can decelerate
        //      the aeroplane but can never reverse it or add energy.
        const impulseCap = (SPEC.mass * 0.6) / Math.max(dt, 1 / 240);
        const sideF = clamp(
          -vSide * 2600,
          -Math.min(N * muSide, Math.abs(vSide) * impulseCap),
          Math.min(N * muSide, Math.abs(vSide) * impulseCap)
        );
        const rollLimit = Math.min(N * (muRoll + brakeMu), Math.abs(vRoll) * impulseCap);
        const rollF = clamp(-vRoll * 3000, -rollLimit, rollLimit);
        force.addScaledVector(sideDir, sideF);
        force.addScaledVector(rollDir, rollF);
        this.sideScrub += Math.abs(vSide) * clamp(N / 12000, 0, 1);
        this._groundLong += rollF;

        this._f.add(force);
        // Torque from the contact patch, expressed in body axes.
        const torqueWorld = rWorld.clone().cross(force);
        this._t.add(torqueWorld.applyQuaternion(this._invQ));
      }
    }

    // Fuselage / wingtip / propeller strike. Naming the part that hit is the
    // difference between "that was unfair" and "ah, I braked too hard".
    //
    // Over water the impact surface is the sea, not the sea bed — otherwise you
    // can fly thirty metres underwater quite happily.
    for (const hp of SPEC.hardPoints) {
      const world = this._tmp.copy(hp.pos).applyQuaternion(this.quat).add(this.pos);
      const gh = heightAt(world.x, world.z);
      const overWater = gh < 0;
      const surface = overWater ? 0 : gh;
      if (world.y < surface) {
        // The sea is not survivable. Everything else might be.
        if (!overWater && this.glancingBlow(hp, world, surface)) continue;
        this.crash(overWater ? 'You flew into the sea' : hp.what, {
          worldPoint: world.clone(),
          part: hp.part,
          surfaceKind: overWater ? 'water' : undefined,
        });
        return;
      }
      // Buildings are solid now. The tower and the terminal used to be scenery
      // you flew straight through, which rather undersold them.
      const hit = obstacleAt(world.x, world.y, world.z);
      if (hit) {
        if (this.glancingBlow(hp, world, world.y, hit.what)) continue;
        this.crash(hit.what, { worldPoint: world.clone(), surfaceKind: 'concrete' });
        return;
      }
    }

    /*
     * The wire pulling.
     *
     * A real arrestor gear is a constant-force hydraulic ram: it takes the
     * same load whatever you weigh, which is why it stops a heavy aeroplane in
     * the same distance as a light one. Scaling with mass here does the same
     * job and keeps every aeroplane in the game stoppable on the same deck.
     */
    if (this._hitCool > 0) this._hitCool -= dt;

    if (this.arrested > 0) {
      this.arrested -= dt;
      const v = Math.hypot(this.vel.x, this.vel.z);
      if (v < 0.6 || !this.onGround) {
        this.arrested = 0;
      } else {
        // About 2.2 g, which brings 130 kt to a stop in roughly 90 metres.
        const pull = Math.min(v / Math.max(dt, 1 / 240), 2.2 * G);
        this.vel.x -= (this.vel.x / v) * pull * dt;
        this.vel.z -= (this.vel.z / v) * pull * dt;
      }
    }

    this.onGround = this.contactCount > 0;
    this.wheelsRolling = this.onGround && this.groundSpeed > 0.4;

    if (this.onGround) {
      this.groundTime += dt;
      this.airborneTime = 0;
      this.brakeHeat = clamp(this.brakeHeat + brakeInput * this.groundSpeed * dt * 0.02 - dt * 0.05, 0, 1);
    } else {
      this.airborneTime += dt;
      this.groundTime = 0;
      this.brakeHeat = clamp(this.brakeHeat - dt * 0.08, 0, 1);
    }

    // Touchdown / lift-off detection with real quality grading.
    if (!wasOnGround && this.onGround) {
      /*
       * Caught a wire?
       *
       * Checked on touchdown only, the way a real hook is: catching one on the
       * roll-out because you wandered back over the band would be absurd.
       */
      const deck = platformAt(this.pos.x, this.pos.z);
      const wires = deck && deck.arrest;
      if (wires && this.groundSpeed > 18) {
        const inBand = wires.along
          ? this.pos.z >= wires.z0 && this.pos.z <= wires.z1
          : this.pos.x >= wires.x0 && this.pos.x <= wires.x1;
        if (inBand) {
          this.arrested = 2.6; // seconds of wire, which is about what it takes
          this.emit(EVENTS.ARRESTED, { speedKts: this.ias * KTS });
        }
      }
      const vsFpm = -this.vs * FPM;
      const bank = this.bankAngleDeg();
      /*
       * How far off the centreline, measured against whichever surface you
       * actually landed on.
       *
       * This was a flat `|z - 0|` — the axis of runway one and nothing else —
       * which is meaningless on a north-south strip and meaningless on a
       * carrier. It read as hundreds of metres off centre for a landing that
       * was dead on the paint.
       */
      const centreline = this.centrelineError();
      const grade = this.gradeTouchdown(vsFpm, bank, centreline);
      this.lastTouchdown = grade;
      this.emit(EVENTS.TOUCHDOWN, grade);
      if (grade.crashed) {
        /*
         * A bad landing hits on the undercarriage, not on whatever happens to
         * sit nearest the aeroplane's centre. Without a point here, every
         * heavy landing tore the canopy off — the same wreck regardless of how
         * you arrived, which is the opposite of what a landing grade is for.
         */
        const bellyPoint =
          (SPEC.hardPoints || []).find((h) => /belly/i.test(h.what)) || null;
        const belly = bellyPoint
          ? this._tmp.copy(bellyPoint.pos).applyQuaternion(this.quat).add(this.pos).clone()
          : this.pos.clone();
        this.crash(grade.reason, { worldPoint: belly, part: 'fuselage' });
        return;
      }
    } else if (wasOnGround && !this.onGround && this.groundSpeed > 12) {
      this.emit(EVENTS.LIFTOFF, { speedKts: this.ias * KTS });
    }

    // ---- Integrate ----------------------------------------------------
    const accel = this._f.divideScalar(SPEC.mass);
    // Load factor for the g-meter (before gravity is removed).
    const upV = this.up(this._tmp2);
    /*
     * Load factor: the specific force along the aeroplane's OWN up axis.
     *
     * This was computed correctly and then overwritten on the next line by a
     * world-vertical version, which reads 1 g in a 60-degree bank that is
     * actually pulling 2, and +1 inverted. The G-meter has been lying in every
     * turn since it was added.
     */
    this.gLoad = clamp((accel.dot(upV) + G * upV.y) / G, -3, 6);

    this.vel.addScaledVector(accel, dt);
    this.pos.addScaledVector(this.vel, dt);
    this.distanceFlown += this.groundSpeed * dt;

    // Angular: I·ω̇ = τ - ω × (I·ω)
    const Iw = new THREE.Vector3(
      SPEC.Ixx * this.omega.x,
      SPEC.Iyy * this.omega.y,
      SPEC.Izz * this.omega.z
    );
    const gyro = this.omega.clone().cross(Iw);
    const alphaAng = new THREE.Vector3(
      (this._t.x - gyro.x) / SPEC.Ixx,
      (this._t.y - gyro.y) / SPEC.Iyy,
      (this._t.z - gyro.z) / SPEC.Izz
    );
    this.omega.addScaledVector(alphaAng, dt);
    // Safety clamp: keeps the sim stable if something extreme happens.
    this.omega.clampLength(0, 3.6);

    const wq = this._q.set(this.omega.x, this.omega.y, this.omega.z, 0);
    // dq = 0.5 * q * ω
    const dq = new THREE.Quaternion(
      0.5 * (this.quat.w * wq.x + this.quat.y * wq.z - this.quat.z * wq.y),
      0.5 * (this.quat.w * wq.y + this.quat.z * wq.x - this.quat.x * wq.z),
      0.5 * (this.quat.w * wq.z + this.quat.x * wq.y - this.quat.y * wq.x),
      0.5 * (-this.quat.x * wq.x - this.quat.y * wq.y - this.quat.z * wq.z)
    );
    this.quat.x += dq.x * dt;
    this.quat.y += dq.y * dt;
    this.quat.z += dq.z * dt;
    this.quat.w += dq.w * dt;
    this.quat.normalize();

    // ---- Readouts -----------------------------------------------------
    this.vs = this.vel.y;
    const fwd = this.forward(this._tmp);
    this.heading = (THREE.MathUtils.radToDeg(Math.atan2(fwd.x, -fwd.z)) + 360) % 360;
    this.alt = this.pos.y;
    this.agl = this.pos.y - heightAt(this.pos.x, this.pos.z);
    this.turnRate = THREE.MathUtils.radToDeg(-this.omega.y);
    this.slipBall = clamp(this.beta * 3.2, -1, 1);
    this.propBlur = clamp((this.rpm - 0.25) / 0.5, 0, 1);

    if (this.ias > SPEC.vne) {
      this._overspeedWarned += dt;
      if (this._overspeedWarned > 0.4) {
        this.emit(EVENTS.OVERSPEED, { ias: this.ias * KTS });
        this._overspeedWarned = -2;
      }
    }

    // Hard structural limit: pulling too hard at high speed breaks things.
    if (this.ias > SPEC.vne * 1.35) this.crash('Too fast — the aeroplane came apart');

    // Optional force breakdown, used when tuning the flight model.
    if (this.debug) {
      this.debugData = {
        thrust: Math.round(thrust),
        lift: Math.round(lift),
        drag: Math.round(drag),
        CL: +CL.toFixed(3),
        CD: +CD.toFixed(3),
        alphaDeg: +(this.alpha * 57.3).toFixed(1),
        betaDeg: +(this.beta * 57.3).toFixed(1),
        contacts: this.contactCount,
        wheelLoad: Math.round(this.wheelLoad),
        groundLong: Math.round(this._groundLong || 0),
        sideScrub: +this.sideScrub.toFixed(2),
        elevator: +elevator.toFixed(2),
      };
    }
  }

  /** Bank angle in the usual aviation sense: positive = right wing down. */
  bankAngleDeg() {
    return THREE.MathUtils.radToDeg(this.bankAngleRad());
  }

  bankAngleRad() {
    const r = this.right(this._bankR || (this._bankR = new THREE.Vector3()));
    const u = this.up(this._bankU || (this._bankU = new THREE.Vector3()));
    return -Math.atan2(r.y, u.y);
  }

  pitchAngleDeg() {
    const f = this.forward(new THREE.Vector3());
    return THREE.MathUtils.radToDeg(Math.asin(clamp(f.y, -1, 1)));
  }

  /**
   * Distance from the middle of whatever you landed on.
   *
   * A deck first, because a platform is unambiguous. Then the runway whose
   * own axis you are nearest, measured across that axis rather than across
   * the world. Falls back to runway one's centreline, which is what the whole
   * game used to assume.
   */
  centrelineError() {
    const deck = platformAt(this.pos.x, this.pos.z);
    if (deck) {
      // The deck box is axis-aligned and `along` says which way it runs.
      const across = deck.arrest && deck.arrest.along === false
        ? this.pos.z - deck.cz
        : this.pos.x - deck.cx;
      return Math.abs(across);
    }
    /*
     * Read off AIRPORT rather than the airport module's RUNWAY objects:
     * terrain.js is already imported here, and importing airport.js would
     * close a cycle (airport imports terrain).
     */
    const a = AIRPORT || {};
    const r1 = a.runway ? Math.abs(this.pos.z - a.runway.cz) : Math.abs(this.pos.z);
    const r2 = a.runway2 ? Math.abs(this.pos.x - a.runway2.cx) : Infinity;
    return Math.min(r1, r2);
  }

  gradeTouchdown(vsFpm, bank, centreline) {
    /*
     * Either runway, and the deck.
     *
     * This asked `isOnRunway`, which is runway one alone — while terrain.js
     * exports `isOnAnyRunway` with a comment saying in as many words that it
     * is what landing scoring should ask. So a textbook arrival on the
     * crosswind strip, or a carrier trap, was graded as an arrival in a
     * field: `centred` collapsed to 0.25 and the whole score was halved, the
     * banner said "not on the runway" and the tower asked whether you were
     * able to taxi. A deck landing is the hardest thing in the game and it
     * scored about forty.
     */
    const onRunway =
      isOnAnyRunway(this.pos.x, this.pos.z, 6) || !!platformAt(this.pos.x, this.pos.z);
    const paved = isPaved(this.pos.x, this.pos.z);
    const sink = Math.abs(vsFpm);
    let crashed = false;
    let reason = '';
    let quality = 'good';

    /*
     * How hard an arrival the undercarriage will take.
     *
     * This is the one that matters for someone learning. Nobody gives up
     * because the aeroplane was hard to rotate — they give up because the
     * landing they were quite pleased with ended in a fireball. Easy raises
     * the limit by half, so a heavy arrival is a bad landing and a bounce
     * rather than the end of the flight; realistic keeps the real number.
     */
    const sinkLimit =
      this.difficulty === 'easy' ? 1350 : this.difficulty === 'realistic' ? 820 : 900;
    if (sink > sinkLimit) {
      crashed = true;
      reason = 'You came down far too fast';
    } else if (Math.abs(bank) > 22) {
      crashed = true;
      reason = 'A wing hit the ground first';
    } else if (this.groundSpeed > 62) {
      crashed = true;
      reason = 'Way too fast for a landing';
    }

    if (!crashed) {
      if (sink < 150) quality = 'perfect';
      else if (sink < 320) quality = 'good';
      else if (sink < 560) quality = 'firm';
      else quality = 'rough';
    }

    // Score out of 100: smoothness, then centreline, then wings level.
    const smooth = clamp(1 - sink / 700, 0, 1);
    const centred = onRunway ? clamp(1 - centreline / 18, 0, 1) : 0.25;
    const level = clamp(1 - Math.abs(bank) / 18, 0, 1);
    const speedOk = clamp(1 - Math.abs(this.ias * KTS - 62) / 45, 0, 1);
    const score = Math.round((smooth * 52 + centred * 20 + level * 16 + speedOk * 12) * (onRunway ? 1 : 0.5));

    return {
      crashed,
      reason,
      quality,
      vsFpm: Math.round(vsFpm),
      bank: Math.round(bank),
      centreline: Math.round(centreline * 10) / 10,
      onRunway,
      paved,
      speedKts: Math.round(this.ias * KTS),
      score: clamp(score, 0, 100),
    };
  }

  /**
   * @param {string} reason  what the player is told
   * @param {object} [contact]  where and how it hit: { worldPoint, surfaceKind }
   *
   * The contact travels with the event because the model needs it and only
   * this function knows it. It is the difference between an aeroplane that
   * loses the wing tip that touched the ground and one that loses whichever
   * part happens to sit nearest its own centre — which, tested, was the
   * canopy, every single time, however you hit.
   *
   * The velocity is captured BEFORE the damping below, because that damping
   * exists to stop the wreck sliding across the island and would otherwise
   * hand the impact an aeroplane that was barely moving.
   */
  /**
   * Hurt a part. The one way anything damages this aeroplane.
   *
   * `severity` is 0..1. Damage accumulates rather than replacing, so three
   * small hits on the same wing add up to a big one, and it saturates at 1 —
   * a wing cannot be more than completely wrecked.
   *
   * Returns the part's new damage level so the caller can react to it.
   */
  takeHit(part, severity, reason = '') {
    if (!(part in this.damage)) return 0;
    const add = clamp(severity, 0, 1);
    if (add <= 0) return this.damage[part];
    const before = this.damage[part];
    this.damage[part] = clamp(before + add, 0, 1);
    this.emit(EVENTS.DAMAGE, {
      part,
      severity: add,
      level: this.damage[part],
      reason,
      worsened: this.damage[part] > before + 0.001,
    });
    return this.damage[part];
  }

  /**
   * Did that hit break the aeroplane, or just hurt it?
   *
   * Clipping a treetop at taxi speed should not be the same event as flying a
   * wing into a hillside at two hundred knots, and until now it was: any
   * contact at all, anywhere, ended the flight.
   *
   * How hard you hit is the closing speed of the part that touched — not the
   * aeroplane's speed, because a wingtip coming down in a roll can be moving
   * far faster than the aeroplane is. Below `SOFT` it is always survivable,
   * above `HARD` never, and in between it is a weighted coin: the harder you
   * hit, the likelier it ends badly. That is the "chance based on how strong
   * it was" the game wants, and it means two identical-looking scrapes can go
   * differently, which is what makes the near miss worth talking about.
   *
   * A survivable blow pushes the aeroplane clear, takes a big bite out of its
   * energy, and damages the part that touched.
   */
  glancingBlow(hp, world, surface, what = '') {
    if (!this.survivableStrikes) return false;
    if (this._hitCool > 0) return true; // already dealt with this contact
    if (!(hp.part in this.damage)) return false;

    // Velocity of this particular point, which is the aeroplane's velocity
    // plus whatever the rotation is doing to a point that far out.
    const r = this._hitR.copy(hp.pos).applyQuaternion(this.quat);
    const pv = this._hitV.copy(this.omega).cross(r).add(this.vel);
    const closing = Math.max(-pv.y, 0);
    const speed = pv.length();

    // Easy mode forgives more, because the class it was built for needs it to.
    const forgiving = this.difficulty === 'easy' ? 1.45 : this.difficulty === 'realistic' ? 0.75 : 1;
    const SOFT = 4 * forgiving;
    const HARD = 16 * forgiving;
    /*
     * How hard it was is mostly how fast you were going DOWN into it.
     *
     * Forward speed counts for something — scraping along at 45 m/s is worse
     * than at 10 — but only a little. Weighting it as heavily as the closing
     * speed made every contact at normal flying speed a near-certain crash,
     * which is the behaviour this was meant to replace.
     */
    const blow = closing + speed * 0.08;
    if (blow > HARD) return false;
    if (blow > SOFT) {
      const oddsItEnds = (blow - SOFT) / (HARD - SOFT);
      if (Math.random() < oddsItEnds) return false;
    }

    const severity = clamp(blow / HARD, 0.08, 0.75);
    this.takeHit(hp.part, severity, what || hp.what);

    /*
     * Scraping on landing is not the same event as flying into a hillside.
     *
     * What follows pushes the aeroplane back out of whatever it hit and
     * reverses its descent — which is right when you have clipped scenery and
     * badly wrong on a runway. A nose or a wingtip brushing the tarmac during
     * a normal landing was being bounced back into the air: measured with the
     * suite's own approach, the aeroplane touched, ballooned to thirty feet,
     * and came back down at 1,842 ft/min with the autopilot chasing it — a
     * greased 444 ft/min arrival turned into a crash by the act of turning
     * damage on. A child would have felt exactly that.
     *
     * So on the ground, with the wheels down, a soft scrape costs you the
     * damage and nothing else. The aeroplane stays where it is and the
     * undercarriage goes on doing its job.
     */
    /*
     * `onGround` is no use here: it is recomputed from the contact count
     * further down the frame, so at the instant of the first touch it is
     * still false and a guard written on it never fires. What IS true at that
     * instant is that the wheels are down, the aeroplane is coming down
     * slowly, and there is a made surface underneath.
     */
    const scraping =
      this.gearDown
      && this.gearPos > 0.5
      && closing < SOFT
      && isPaved(this.pos.x, this.pos.z);
    if (!scraping) {
      // Out of the ground, and a great deal slower for having hit it.
      const lift = surface - world.y + 0.05;
      if (lift > 0) this.pos.y += lift;
      if (this.vel.y < 0) this.vel.y *= -0.2;
    }
    this.vel.multiplyScalar(1 - 0.28 * severity * (scraping ? 0.35 : 1));
    this.omega.multiplyScalar(scraping ? 0.85 : 0.55);
    this._hitCool = 0.5;
    return true;
  }

  /** Worst single part, 0..1 — what the HUD shows as "how bad is it". */
  get worstDamage() {
    let w = 0;
    for (const k in this.damage) w = Math.max(w, this.damage[k]);
    return w;
  }

  /** How full the tank is, 0..1. */
  fuelFraction() {
    return SPEC.fuelCapacity > 0 ? clamp(this.fuel / SPEC.fuelCapacity, 0, 1) : 1;
  }

  crash(reason, contact = null) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.engineOn = false;
    const impactVel = this.vel.clone();
    const impactOmega = this.omega.clone();
    this.vel.multiplyScalar(0.12);
    this.omega.multiplyScalar(0.1);
    this.emit(EVENTS.CRASH, { reason, contact, impactVel, impactOmega });
  }

  /** Instrument-friendly snapshot. */
  readouts() {
    return {
      iasKts: this.ias * KTS,
      tasKts: this.airspeed * KTS,
      groundKts: this.groundSpeed * KTS,
      altFt: this.alt * FT,
      aglFt: this.agl * FT,
      vsFpm: this.vs * FPM,
      heading: this.heading,
      throttle: this.controls.throttle,
      rpm: this.rpm,
      fuelPct: this.fuel / SPEC.fuelCapacity,
      fuelL: this.fuel,
      gLoad: this.gLoad,
      bank: this.bankAngleDeg(),
      pitch: this.pitchAngleDeg(),
      slip: this.slipBall,
      gearDown: this.gearDown,
      gearPos: this.gearPos,
      onGround: this.onGround,
      stalled: this.stalled,
      engineOn: this.engineOn,
      alphaDeg: THREE.MathUtils.radToDeg(this.alpha),
      turnRate: this.turnRate,
      brakes: Math.max(this.controls.brakes, this.parkingBrake ? 1 : 0),
      flaps: this.flaps,
      flapStep: this.flapStep(),
      parkingBrake: this.parkingBrake,
    };
  }
}

export const UNITS = { KTS, FPM, FT };

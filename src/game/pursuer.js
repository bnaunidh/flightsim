/**
 * A jet that chases you.
 *
 * Nothing in this game has ever flown except the player. The nearest thing was
 * Island Patrol, where the "three unidentified contacts" are bare coordinates
 * with no aeroplane at them — which works right up until somebody flies over
 * one and finds empty sky.
 *
 * This is the smallest thing that genuinely reads as another aeroplane hunting
 * you: it has a real model, it steers, it closes, it loses you in cloud, and
 * it overshoots when you break hard. It is NOT a flight model. It does not
 * stall, it has no fuel, and it cannot be crashed into — every one of those
 * would cost frames and none of them would be noticed from the cockpit of the
 * aeroplane running away.
 *
 * The one rule it never breaks: it is a picture with a position, not a
 * collider. You cannot be killed by touching it.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp, lerp } from '../core/noise.js';
import { heightAt } from '../world/terrain.js';

/** Speeds in m/s. The player's Vanguard tops out at 164, measured. */
const SPEED_MIN = 95;
/*
 * 178, not 195.
 *
 * The player tops out at 164 m/s. At 195 the pursuer is 19% faster, which from
 * the cockpit reads as the game cheating — you are at the stop and he is still
 * reeling you in, and nothing you do with the aeroplane matters. At 178 he is
 * 8.5% faster: a committed dive genuinely holds him, and the cloud is what
 * actually saves you.
 */
const SPEED_MAX = 178;
const ACCEL = 8; // m/s², slew-limited so he cannot teleport up to speed

/** Sustained 4.2 g turn: omega = g·sqrt(n²−1)/V, about 13.4°/s at 170 m/s. */
const TURN_G = 4.2;

/** He never flies into a hill, because that is not the drama. */
const FLOOR_AGL = 90;

export class Pursuer {
  /**
   * @param {THREE.Scene} scene
   * @param {(opts:object)=>THREE.Object3D} makeModel the game's aircraft factory
   * @param {object} type the aircraft type to wear
   */
  constructor(scene, makeModel, type, { name = 'Ironhead One' } = {}) {
    this.scene = scene;
    this.name = name;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0; // degrees, 0 = north
    this.speed = 150;
    this.alive = true;

    // State for the two scripted behaviours.
    this.overshootFor = 0;
    this.overshootCool = 0;
    this.joinUpFor = 0;
    this.escorting = false;

    // Gunnery. He fires warning bursts that can clip you — he is trying to
    // make you land, not to destroy you, which is the same tone the escort
    // ending is written in.
    this.shotCool = 3;
    this.tracer = null;
    this.tracerT = 0;

    // How long you have been out of sight, and how long he has been close.
    this.breakT = 0;
    this.closeT = 0;
    this.contact = true;
    /** How much cloud it takes to lose them. Set per mission. */
    this.cloudHides = 0.45;

    // The line-of-sight raymarch is the one genuinely costly thing here, so it
    // runs at 10 Hz and the answer is remembered in between.
    this._losT = 0;
    this._losClear = true;

    this.model = null;
    try {
      this.model = makeModel({ type });
      scene.add(this.model);
    } catch (e) {
      console.warn('The pursuer could not be built; the chase will be invisible.', e);
    }
    this._q = new THREE.Quaternion();
    this._tmp = new THREE.Vector3();
    // Gunnery gets its own scratch, because _tmp and _q are both already in
    // use by the model sync running in the same frame.
    this._shotA = new THREE.Vector3();
    this._shotB = new THREE.Vector3();
    this._shotQ = new THREE.Quaternion();
  }

  /** Put him somewhere, usually dead astern of the player. */
  placeBehind(ac, distance = 2200) {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(ac.quat).setY(0).normalize();
    this.pos.copy(ac.pos).addScaledVector(back, distance);
    this.pos.y = Math.max(ac.pos.y, heightAt(this.pos.x, this.pos.z) + FLOOR_AGL);
    this.heading = ac.readouts().heading;
    this.speed = Math.max(ac.airspeed, 120);
    this.breakT = 0;
    this.closeT = 0;
  }

  get rangeTo() {
    return this._range || 0;
  }

  /**
   * Can he see you?
   *
   * Four tests, cheapest first, and the second one is the entire mission: get
   * into cloud and stay more than 900 m ahead and he loses you. Close enough
   * and he can see you through anything, because a jet a few hundred metres
   * off your tail in cloud can still see your lights.
   */
  hasContact(ac, sim, dt) {
    const range = this._range;
    if (range > 4600) return false;
    const inCloud = (sim.cloudImmersion || 0) > (this.cloudHides ?? 0.45);
    if (inCloud && range > 900) return false;

    // Terrain masking, at 10 Hz.
    this._losT -= dt;
    if (this._losT <= 0) {
      this._losT = 0.1;
      this._losClear = true;
      const steps = 12;
      for (let i = 1; i < steps; i++) {
        const f = i / steps;
        const x = lerp(this.pos.x, ac.pos.x, f);
        const z = lerp(this.pos.z, ac.pos.z, f);
        const y = lerp(this.pos.y, ac.pos.y, f);
        if (heightAt(x, z) > y) {
          this._losClear = false;
          break;
        }
      }
    }
    return this._losClear;
  }

  update(dt, ac, sim) {
    if (!this.alive) return;

    this._range = this.pos.distanceTo(ac.pos);
    const range = this._range;
    this.contact = this.escorting ? true : this.hasContact(ac, sim, dt);

    // The escape clock. Losing him counts up; being seen counts back down,
    // slower than it went up, so a moment of bad luck in the cloud does not
    // throw away everything you have built.
    if (this.contact) this.breakT = Math.max(0, this.breakT - dt * 1.2);
    else this.breakT += dt;

    /*
     * 140 m, not 250.
     *
     * They now start at 240 m, which under the old radius meant the caught
     * clock began ticking before the first word of the brief. Knife range has
     * to be closer than the range they arrive at, or the mission is lost
     * before it starts.
     */
    this.closeT = range < 140 && this.contact ? this.closeT + dt : 0;

    // --- steering ---------------------------------------------------------
    this.overshootCool = Math.max(0, this.overshootCool - dt);
    if (this.overshootFor > 0) {
      // Committed: he is going straight past you, which is what a real
      // overshoot looks like and what makes breaking hard worth doing.
      this.overshootFor -= dt;
    } else {
      const wantHeading = this.bearingTo(ac.pos);
      const maxTurn = (9.81 * Math.sqrt(TURN_G * TURN_G - 1)) / Math.max(this.speed, 40);
      const turn = THREE.MathUtils.radToDeg(maxTurn) * dt;
      this.heading = approachAngle(this.heading, wantHeading, turn);
    }

    // --- speed ------------------------------------------------------------
    /*
     * How much faster than you he flies, by how far away he is.
     *
     * The mid-band number started at 6 m/s and made the mission a stalemate:
     * a player who ignored the brief and just ran flat out sat at 2,400 m
     * while he crept in at six metres a second — six and a half minutes to
     * reach knife range, which is not a chase, it is a queue. At 20 he arrives
     * in about a hundred seconds, which is long enough to try things and short
     * enough that ignoring the brief has a consequence you actually meet.
     *
     * None of this endangers the escape: in cloud he loses contact beyond
     * 900 m however fast he is going, and the escape clock runs on contact,
     * not on range.
     */
    let gain = 0;
    if (this.overshootFor > 0) gain = 25;
    else if (this.escorting || this.joinUpFor > 0) gain = 12;
    else if (range > 2500) gain = 26;
    else if (range > 900) gain = 20;
    else gain = 8;
    /*
     * Match the player's speed ACROSS THE GROUND, not their airspeed.
     *
     * Measured before this: the player climbing at full power made 140 kt of
     * airspeed but only about 90 across the ground, because the rest of it was
     * going upwards — while the pursuer kept all of his horizontally and ate
     * 2.2 km in forty seconds. The mission asks you to climb into the cloud,
     * so that punished the one thing it tells you to do.
     */
    const hor = Math.hypot(ac.vel.x, ac.vel.z);
    const want = clamp(hor + gain, SPEED_MIN, SPEED_MAX);
    this.speed += clamp(want - this.speed, -ACCEL * dt, ACCEL * dt);

    // --- move -------------------------------------------------------------
    /*
     * Heading to direction, the way the rest of the game does it.
     *
     * physics.js reset() rotates (0,0,-1) by -heading about Y, which gives
     * forward = (+sin h, 0, -cos h). This had -sin, so every pursuer flew off
     * on a mirrored track the instant it spawned: matched speed, matched
     * heading, and 225 metres of separation opening every second. From the
     * cockpit that is "there is no jet".
     *
     * The gunnery already reads its nose from `vel` rather than rebuilding it,
     * which is why the sign error survived there unnoticed — it was wrong in
     * exactly one place and consistently wrong with itself everywhere else.
     */
    const rad = THREE.MathUtils.degToRad(this.heading);
    this.vel.set(Math.sin(rad) * this.speed, 0, -Math.cos(rad) * this.speed);
    // Match your height, but never fly into the ground doing it.
    const wantY = Math.max(ac.pos.y, heightAt(this.pos.x, this.pos.z) + FLOOR_AGL);
    this.vel.y = clamp((wantY - this.pos.y) * 0.6, -55, 55);
    this.pos.addScaledVector(this.vel, dt);

    if (this.tracer) {
      this.tracerT = Math.max(0, this.tracerT - dt);
      this.tracer.material.opacity = this.tracerT > 0 ? this.tracerT / 0.12 : 0;
      this.tracer.visible = this.tracerT > 0;
    }

    this.syncModel(dt);
  }

  /**
   * Take a shot, if he has one.
   *
   * Only from behind and only from close in — he has to be inside 700 m, have
   * you in sight, and be pointing roughly at you. Returns the part he hit, or
   * null, so the caller decides what that means.
   *
   * Deliberately sparse: a burst every few seconds at worst, and most of them
   * miss. Being hit should be an event you remember, not a drizzle.
   */
  tryShot(ac, dt) {
    this.shotCool -= dt;
    if (this.shotCool > 0 || !this.contact || this.escorting) return null;
    const range = this._range;
    if (range > 700 || range < 60) return null;

    /*
     * Is he actually pointing at you? A jet cannot shoot sideways.
     *
     * The nose direction is taken from the velocity he is ALREADY flying,
     * rather than rebuilt from his heading. Rebuilding it got the sign of X
     * wrong and pointed him backwards — the dot product came out at -0.54 with
     * both aeroplanes on the same heading, so he never fired once. Reading the
     * vector he is actually using cannot disagree with itself.
     */
    const toYou = this._shotA.copy(ac.pos).sub(this.pos).normalize();
    const nose = this._shotB.copy(this.vel).setY(0);
    if (nose.lengthSq() < 1) return null;
    nose.normalize();
    if (nose.dot(toYou) < 0.94) return null;

    this.shotCool = 3.5 + Math.random() * 2.5;
    this.fireTracer(ac);

    // Most bursts miss. The closer he is, the likelier one lands.
    const odds = clamp(1 - (range - 60) / 640, 0.12, 0.62);
    if (Math.random() > odds) return null;

    /*
     * Where it lands: from dead astern he is hitting the tail; from off to one
     * side he is hitting that wing. Worked out from HIS position in YOUR
     * frame, so the part named is the part actually facing him.
     */
    const local = this._shotA.copy(this.pos).sub(ac.pos).applyQuaternion(
      this._shotQ.copy(ac.quat).invert()
    );
    const behind = local.z > 0;
    let part;
    if (Math.abs(local.x) > Math.abs(local.z) * 0.55) part = local.x < 0 ? 'leftWing' : 'rightWing';
    else part = behind ? 'tail' : 'nose';
    return { part, severity: 0.16 + Math.random() * 0.2 };
  }

  /** A line of light going past the canopy. Built once, reused. */
  fireTracer(ac) {
    if (!this.scene) return;
    if (!this.tracer) {
      const geo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(),
        new THREE.Vector3(),
      ]);
      const mat = new THREE.LineBasicMaterial({
        color: 0xffd66b,
        transparent: true,
        opacity: 0,
        depthWrite: false,
      });
      this.tracer = new THREE.Line(geo, mat);
      this.tracer.frustumCulled = false;
      this.scene.add(this.tracer);
    }
    const pts = this.tracer.geometry.attributes.position;
    // From his nose to just past your shoulder, so it reads as going by you
    // rather than into you.
    const miss = new THREE.Vector3(
      (Math.random() - 0.5) * 26,
      (Math.random() - 0.5) * 14,
      0
    ).applyQuaternion(ac.quat);
    pts.setXYZ(0, this.pos.x, this.pos.y, this.pos.z);
    pts.setXYZ(1, ac.pos.x + miss.x, ac.pos.y + miss.y, ac.pos.z + miss.z);
    pts.needsUpdate = true;
    this.tracerT = 0.12;
  }

  /**
   * Break hard and he goes sailing past.
   *
   * Called by the mission when the player holds a steep bank inside knife
   * range. It is scripted rather than emergent because he out-turns the player
   * at every bank the player can hold — 13.4°/s against 9.5°/s — so without
   * this there is no answer to him at all except the cloud.
   */
  tryOvershoot() {
    if (this.overshootCool > 0 || this.overshootFor > 0) return false;
    this.overshootFor = 3;
    this.overshootCool = 12;
    return true;
  }

  /** Formate on the player's wing. The end of the chase, not a kill. */
  beginEscort() {
    this.escorting = true;
  }

  /** Inverse of the same convention: forward is (+sin h, 0, -cos h). */
  bearingTo(p) {
    const dx = p.x - this.pos.x;
    const dz = p.z - this.pos.z;
    return (THREE.MathUtils.radToDeg(Math.atan2(dx, -dz)) + 360) % 360;
  }

  syncModel(dt) {
    if (!this.model) return;
    this.model.position.copy(this.pos);
    this._q.setFromAxisAngle(
      this._tmp.set(0, 1, 0),
      -THREE.MathUtils.degToRad(this.heading)
    );
    this.model.quaternion.slerp(this._q, clamp(dt * 3, 0, 1));
    // Enough state to keep its propeller or nozzle alive without pretending
    // there is a flight model behind it.
    if (this.model.userData.update) {
      this.model.userData.update(dt, {
        controls: { pitch: 0, roll: 0, yaw: 0, throttle: 1, brakes: 0 },
        rpm: 0.95,
        flaps: 0,
        gearPos: 0,
        gearDown: false,
        onGround: false,
        groundSpeed: 0,
        engineOn: true,
        agl: 500,
        alt: this.pos.y,
        vel: this.vel,
        pos: this.pos,
        quat: this.model.quaternion,
      }, { isNight: false, cond: { cloud: 0 } });
    }
  }

  dispose() {
    this.alive = false;
    if (this.model) this.scene.remove(this.model);
    if (this.tracer) {
      this.scene.remove(this.tracer);
      this.tracer.geometry.dispose();
      this.tracer.material.dispose();
    }
    this.tracer = null;
    this.model = null;
  }
}

/** Turn towards a heading by at most `maxStep` degrees, the short way round. */
function approachAngle(from, to, maxStep) {
  let d = ((to - from + 540) % 360) - 180;
  d = clamp(d, -maxStep, maxStep);
  return (from + d + 360) % 360;
}

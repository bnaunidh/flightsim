/**
 * T-Pose Harrison's two tricks, as motion: the SPIN CLIMB (T) and the BOOST
 * (P three times). No DOM, no scene — the node tests fly them against the
 * real flight model (tests/features/tpose.mjs), and ../tpose.js plugs them
 * into the game.
 *
 *   SPIN CLIMB  "if you press T on Harrison, he starts spinning and going up
 *               at 500 kt" (the owner). He swings head-up to vertical,
 *               spins round his own body like a drill (1.5 turns a second,
 *               arms out) and climbs straight up, accelerating to 500 kt.
 *               T again, or a firm pull or push on the stick, stops the spin
 *               and he eases back to level flight; near the top of the world
 *               (CEILING_M) he levels off by himself.
 *
 *   BOOST       "if you press P 3 times on Harrison, you go at 1000 kt". He
 *               goes 1000 kt head-first along his flight path — Mach 1.5 at
 *               sea level — and you still fly him: bank with the stick, pull
 *               to turn, push to dive. Three more presses, or the throttle at
 *               idle, and he slows back to his own speeds.
 *
 * HOW. Both are flown, not faked: the real flight model still runs every
 * step (engine, fuel, the ground, every building and the sea — crash at
 * 1000 kt into a hill and it is an ordinary crash), but WHERE he goes is
 * decided here. Each step the move sets the aeroplane's velocity along the
 * path it wants, with the nose trimmed to zero lift so the wing does not
 * argue, lets physics.js do its step (and its crash checks), then puts the
 * position, velocity and attitude exactly where the move says. So there is
 * one path, everything downstream (the HUD, the camera, the multiplayer
 * snapshot) reads it as an ordinary flight, and the 1 km/h top speed of his
 * ordinary flight is never touched: with no move running the step is
 * physics.js's own, untouched.
 *
 * THE SPIN IS HIS, NOT THE AEROPLANE'S. The flight model's attitude never
 * rolls: it points straight up with the wings level, so the camera, the
 * horizon in his head view and every instrument stay steady. The body
 * spinning round its own axis is drawn by the model. Other players need to
 * see it too, and the snapshot has no bit for it — so while he spins the
 * three stick bytes (pitch, roll, rudder), which the move is not using,
 * carry an exact pattern no hand holds for a fifth of a second (SIGNAL), and
 * his model spins when it reads it. The real Harrison's model reads the same
 * bytes, so what you see is what they see.
 */

import * as THREE from '../../vendor/three.module.js';
import { SPEC } from '../../aircraft/physics.js';
import { heightAt } from '../../world/terrain.js';
import { KT, SPIN_TURNS, SIGNAL, setSpinSignal, isSpinSignal, soundSpeed, machOf } from './signal.js';

export { KT, SIGNAL, setSpinSignal, isSpinSignal, soundSpeed, machOf };
const G = 9.81;
const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * The top of the world, metres. There was no such number in the game — the
 * sky is a dome 30 km across and the autopilot stops at 12,000 ft — and a
 * 500 kt climb that never stops would find the edge of the sky in two
 * minutes. 12 km is where airliners cruise and where his engine, which
 * breathes the air like everybody's, has a quarter of its push left.
 */
export const CEILING_M = 12000;

export const SPIN = {
  kt: 500,
  speed: 500 / KT, // 257 m/s
  turnsPerSec: SPIN_TURNS, // a steady drill, drawn by the model
  accel: 22, // m/s² towards 500 kt: about 2 g
  swingG: 8, // how hard he swings up to vertical
  levelG: 5, // and eases back to level
  bodyRate: 2.4, // rad/s his body can swing at walking pace (the path has not caught up yet)
  pitchDeg: 89, // "vertical": a degree short, so the heading stays defined
  stickStop: 0.7, // a FIRM pull or push on the stick stops it...
  stickHold: 0.25, // ...held this long (s)
};

export const BOOST = {
  kt: 1000,
  speed: 1000 / KT, // 514 m/s
  accel: 45, // m/s²: from his top speed to 1000 kt in about six seconds
  slow: 24, // m/s² back down again
  handBack: 265, // m/s: his own flight model takes over again here (his top speed is 262)
  maxG: 6, // pulling
  minG: -2, // pushing
  rollRate: 2.2, // rad/s at full stick
  presses: 3, // P, P, P
  window: 1.0, // s, first press to third
  wait: 0.4, // s a single P waits to see whether more follow (it is the autopilot key)
  vne: (1000 / KT) * 1.3, // his red line while boosting, m/s: no "overspeed", no breaking up
};

/** 1.4 x his clean stalling speed, m/s, from the flight model's own numbers. */
export function safeSpeed() {
  const cl = (SPEC.CL0 || 0.3) + (SPEC.CLa || 3) * (SPEC.alphaStall || 0.3);
  const vs = Math.sqrt((2 * (SPEC.mass || 1000) * G) / (1.225 * (SPEC.wingArea || 16) * Math.max(0.3, cl)));
  return 1.4 * vs;
}

/* ------------------------------------------------------------------ */
/* Attitude helpers                                                    */
/* ------------------------------------------------------------------ */

const _m = new THREE.Matrix4();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();

/**
 * A quaternion for a body whose nose points along `nose`, whose wings lie
 * along `rightHint` (made square to the nose), banked `bank` radians (right
 * wing down positive, as physics.js's bankAngleRad).
 */
export function attitude(out, nose, rightHint, bank = 0) {
  _y.crossVectors(rightHint, nose).normalize(); // up, unbanked
  _x.crossVectors(nose, _y).normalize(); // right, unbanked
  const c = Math.cos(bank);
  const s = Math.sin(bank);
  const ux = _y.x * c + _x.x * s;
  const uy = _y.y * c + _x.y * s;
  const uz = _y.z * c + _x.z * s;
  const rx = _x.x * c - _y.x * s;
  const ry = _x.y * c - _y.y * s;
  const rz = _x.z * c - _y.z * s;
  _y.set(ux, uy, uz);
  _x.set(rx, ry, rz);
  _z.copy(nose).negate();
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/* ------------------------------------------------------------------ */
/* P, P, P                                                             */
/* ------------------------------------------------------------------ */

/**
 * Counts presses of the autopilot key. press(t) returns 'triple' on the
 * third press inside BOOST.window; tick(t) returns 'single' once a lone press
 * has waited BOOST.wait with nothing after it (the autopilot then toggles,
 * once), or 'double' for two (on and off again: nothing to do).
 */
export class PressCounter {
  constructor() {
    this.n = 0;
    this.first = 0;
    this.last = 0;
  }

  press(t) {
    if (this.n && t - this.first > BOOST.window) this.n = 0;
    if (!this.n) this.first = t;
    this.n++;
    this.last = t;
    if (this.n >= BOOST.presses) {
      this.n = 0;
      return 'triple';
    }
    return null;
  }

  tick(t) {
    if (!this.n || t - this.last < BOOST.wait) return null;
    const n = this.n;
    this.n = 0;
    return n === 1 ? 'single' : 'double';
  }

  get pending() {
    return this.n > 0;
  }

  clear() {
    this.n = 0;
  }
}

/* ------------------------------------------------------------------ */
/* The moves                                                           */
/* ------------------------------------------------------------------ */

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _a = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _p0 = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

/**
 * One Harrison's moves. `mode`:
 *   'off'    ordinary flight: the step is physics.js's own
 *   'spin'   swinging up, spinning, climbing to 500 kt
 *   'level'  the spin has stopped; easing back to level flight
 *   'boost'  1000 kt along his flight path, flown with the stick
 *   'ease'   slowing back down from the boost to his own speeds
 */
export class Moves {
  constructor() {
    this.heading = new THREE.Vector3(1, 0, 0); // horizontal, unit
    this.right = new THREE.Vector3(0, 0, 1); // horizontal, unit
    this.dir = new THREE.Vector3(1, 0, 0); // where he is going, unit
    this.reset();
  }

  reset() {
    this._vneOrig = null;
    this._vneSet = null;
    this.mode = 'off';
    this.why = '';
    this.t = 0;
    this.v = 0;
    this.path = 0; // path pitch, rad (spin and level)
    this.body = 0; // body pitch, rad (it leads the path at walking pace)
    this.bank = 0;
    this.stickT = 0;
    this.peakKt = 0;
    this.n = 1; // load factor of the move's last step, g
    this.events = [];
    return this;
  }

  get active() {
    return this.mode !== 'off';
  }

  get spinning() {
    return this.mode === 'spin';
  }

  get boosting() {
    return this.mode === 'boost';
  }

  /** What happened since the caller last asked (start, level, ceiling, boom...). */
  take() {
    const e = this.events;
    this.events = [];
    return e;
  }

  /** Pick up the flight where it is: heading, path, speed, bank. */
  _from(ac) {
    const f = _v.set(0, 0, -1).applyQuaternion(ac.quat);
    const speed = ac.vel.length();
    _w.set(f.x, 0, f.z);
    if (_w.lengthSq() < 1e-4) _w.set(ac.vel.x, 0, ac.vel.z);
    if (_w.lengthSq() < 1e-4) _w.set(1, 0, 0);
    this.heading.copy(_w.normalize());
    this.right.crossVectors(this.heading, UP).normalize();
    this.v = speed;
    this.body = Math.asin(clamp(f.y, -1, 1));
    this.path = speed > 1 ? Math.asin(clamp(ac.vel.y / speed, -1, 1)) : this.body;
    this.bank = typeof ac.bankAngleRad === 'function' ? ac.bankAngleRad() : 0;
    if (speed > 1) this.dir.copy(ac.vel).divideScalar(speed);
    else this.dir.copy(f);
  }

  startSpin(ac) {
    if (!ac || ac.crashed) return false;
    this._from(ac);
    // From a standstill (or nearly) he goes straight up and the body follows.
    if (this.v < 25) this.path = SPIN.pitchDeg * D2R;
    this.mode = 'spin';
    this.why = '';
    this.t = 0;
    this.stickT = 0;
    this.events.push('spin');
    return true;
  }

  startBoost(ac) {
    if (!ac || ac.crashed) return false;
    this._from(ac);
    this.mode = 'boost';
    this.why = '';
    this.t = 0;
    this.peakKt = 0;
    this.events.push('boost');
    return true;
  }

  /** His red line, lifted for the boost (SPEC is the live flight spec; put back exactly). */
  _raiseVne(v) {
    if (this._vneOrig == null) this._vneOrig = SPEC.vne;
    const want = Math.max(this._vneOrig, BOOST.vne, v * 1.3);
    if (SPEC.vne < want) SPEC.vne = want;
    this._vneSet = SPEC.vne;
  }

  _restoreVne() {
    if (this._vneOrig == null) return;
    // Only if it is still ours: a new flight re-applies the type's own numbers.
    if (SPEC.vne === this._vneSet) SPEC.vne = this._vneOrig;
    this._vneOrig = null;
    this._vneSet = null;
  }

  /** Spin -> level, boost -> ease. `why`: 'key', 'stick', 'ceiling', 'idle', 'touch'. */
  stop(why = 'key') {
    if (this.mode === 'spin') {
      this.mode = 'level';
      this.why = why;
      this.events.push(why === 'ceiling' ? 'ceiling' : 'level');
      return true;
    }
    if (this.mode === 'boost') {
      this.mode = 'ease';
      this.why = why;
      this.events.push('ease');
      return true;
    }
    return false;
  }

  /** Off at once, nothing eased (a crash, a new flight, getting out). */
  cancel(why = 'cancel', ac = null) {
    if (this.mode !== 'off') this.events.push('off');
    this.mode = 'off';
    this.why = why;
    this._restoreVne();
    if (ac && ac.controls && isSpinSignal(ac.controls)) ac.controls.pitch = ac.controls.roll = ac.controls.yaw = 0;
  }

  /**
   * One physics step. `inner` is the flight model's own step. With no move
   * running it is simply called. `input` is { pitch, roll, throttle } as the
   * pilot is holding them (the controls already in `ac.controls`).
   */
  step(ac, dt, weather, inner, input = null) {
    if (this.mode === 'off' || ac.crashed) {
      if (this.mode !== 'off' && ac.crashed) this.cancel('crash', ac);
      return inner.call(ac, dt, weather);
    }
    this.t += dt;
    const inp = input || ac.controls;
    if (this.mode === 'spin' || this.mode === 'level') this._spinPath(ac, dt, inp);
    else this._boostPath(ac, dt, inp);
    if (this.mode === 'off') {
      this._restoreVne();
      return inner.call(ac, dt, weather);
    }
    return this._fly(ac, dt, weather, inner);
  }

  /* ---- the spin climb ------------------------------------------------ */

  _spinPath(ac, dt, inp) {
    const top = SPIN.pitchDeg * D2R;
    const spin = this.mode === 'spin';
    // The stick, held firmly, stops it; so does the top of the world.
    if (spin) {
      const p = Math.abs(inp.pitch || 0);
      this.stickT = p >= SPIN.stickStop ? this.stickT + dt : 0;
      if (this.stickT >= SPIN.stickHold && this.t > 0.4) {
        this.stop('stick');
      } else {
        // Levelling off from a path angle p on a circle of radius R gains R(1 - cos p).
        const R = (this.v * this.v) / (SPIN.levelG * G);
        if (ac.pos.y + R * (1 - Math.cos(Math.max(0, this.path))) * 1.15 + 120 >= CEILING_M) this.stop('ceiling');
      }
    }
    const want = this.mode === 'spin' ? top : 0;
    const g = (this.mode === 'spin' ? SPIN.swingG : SPIN.levelG) * G;
    // The path turns no faster than `g` allows at this speed, easing in at the end.
    const err = want - this.path;
    let rate = Math.min(1.6, g / Math.max(this.v, 1));
    rate *= clamp(Math.abs(err) / 0.3, 0.12, 1);
    const turn = clamp(err, -rate * dt, rate * dt);
    this.path += turn;
    // The body follows the path; at walking pace (straight up off the ground)
    // the path is ahead of it and the body swings up after it — never so far,
    // that close to the ground, that his feet would touch.
    const room = Math.asin(clamp((ac.agl - 0.2) / 2.5, 0, 1));
    const bodyWant = this.path > 0 ? Math.min(this.path, Math.max(room, Math.min(this.body, this.path))) : this.path;
    const bRate = Math.max(SPIN.bodyRate, rate);
    this.body += clamp(bodyWant - this.body, -bRate * dt, bRate * dt);
    // Wings level.
    this.bank += clamp(-this.bank, -2 * dt, 2 * dt);
    // Speed: to 500 kt while spinning; held as it is while levelling off —
    // but never handed back slower than he can fly (T twice on the runway
    // is a hop, not a drop).
    if (this.mode === 'spin') this.v += clamp(SPIN.speed - this.v, -SPIN.accel * dt, SPIN.accel * dt);
    else this.v += clamp(safeSpeed() - this.v, 0, SPIN.accel * dt);
    this.dir.copy(this.heading).multiplyScalar(Math.cos(this.path)).addScaledVector(UP, Math.sin(this.path));
    this.n = (turn / Math.max(dt, 1e-6)) * (this.v / G) + Math.cos(this.path);
    if (this.mode === 'level' && Math.abs(this.path) < 0.02 && Math.abs(this.bank) < 0.02) {
      this.path = 0;
      this.events.push('levelled');
      this.mode = 'off';
    }
  }

  /* ---- the boost ----------------------------------------------------- */

  _boostPath(ac, dt, inp) {
    const boosting = this.mode === 'boost';
    if (boosting && (inp.throttle || 0) < 0.04 && this.t > 0.3) this.stop('idle');
    // Speed.
    if (this.mode === 'boost') this.v += clamp(BOOST.speed - this.v, -BOOST.accel * dt, BOOST.accel * dt);
    else this.v -= BOOST.slow * dt;
    this.peakKt = Math.max(this.peakKt, this.v * KT);
    // Bank: the stick rolls him; in the simplified mode he levels his own wings when you let go.
    const roll = clamp(inp.roll || 0, -1, 1);
    this.bank += roll * BOOST.rollRate * dt;
    if (Math.abs(roll) < 0.05 && ac.mode === 'simplified' && Math.abs(this.bank) < 1.1) this.bank += clamp(-this.bank, -0.7 * dt, 0.7 * dt);
    if (this.bank > Math.PI) this.bank -= 2 * Math.PI;
    if (this.bank < -Math.PI) this.bank += 2 * Math.PI;
    // The path frame: forward, and a right that stays put through the vertical.
    const f = this.dir;
    const r = this.right.addScaledVector(f, -this.right.dot(f));
    if (r.lengthSq() < 1e-6) r.crossVectors(f, UP);
    r.normalize();
    const up0 = _w.crossVectors(r, f).normalize();
    const cb = Math.cos(this.bank);
    const sb = Math.sin(this.bank);
    const upB = _a.copy(up0).multiplyScalar(cb).addScaledVector(r, sb);
    // Load factor: what keeps his path straight (and his height, in a bank —
    // upside down too), plus what the stick asks. Past about 70 degrees of
    // bank there is not enough of it, and he slides down, as anything does.
    const gam = Math.asin(clamp(f.y, -1, 1));
    const cg = Math.cos(gam);
    let n0 = Math.abs(upB.y) > 0.05 ? (cg * cg) / upB.y : 3 * Math.sign(upB.y || 1);
    n0 = clamp(n0, -1, 3);
    const pitch = clamp(inp.pitch || 0, -1, 1);
    let n = pitch >= 0 ? n0 + pitch * (BOOST.maxG - n0) : n0 + pitch * (n0 - BOOST.minG);
    // The top of the world: no climbing through it.
    const room = CEILING_M - ac.pos.y;
    if (room < 1500 && gam > 0) n -= clamp((gam - (Math.max(0, room) / 1500) * 0.5) * 6, 0, 6);
    n = clamp(n, BOOST.minG, BOOST.maxG);
    this.n = n;
    // Turn the path: lift along his up, gravity down, only the part across the path.
    _v.copy(upB).multiplyScalar(n * G);
    _v.y -= G;
    _v.addScaledVector(f, -_v.dot(f));
    f.addScaledVector(_v, dt / Math.max(this.v, 30)).normalize();
    this.heading.set(f.x, 0, f.z);
    if (this.heading.lengthSq() > 1e-6) this.heading.normalize();
    if (this.mode === 'ease' && this.v <= BOOST.handBack) {
      this.v = BOOST.handBack;
      this.events.push('slowed');
      this.mode = 'off';
    }
  }

  /* ---- one step along the path, through the flight model ------------- */

  _fly(ac, dt, weather, inner) {
    const v = this.v;
    // The attitude the move wants: nose along the path (the body pitch leads
    // it at walking pace in the spin), wings as banked.
    const nose = _a;
    if (this.mode === 'spin' || this.mode === 'level') {
      nose.copy(this.heading).multiplyScalar(Math.cos(this.body)).addScaledVector(UP, Math.sin(this.body)).normalize();
      attitude(_q, nose, this.right, this.bank);
    } else {
      nose.copy(this.dir);
      attitude(_q, nose, this.right, this.bank);
    }
    // For the flight model's own step: the same, with the nose trimmed to
    // zero lift (the camber of his flaps included), and the air along it.
    // Near the ground, slow, the trim is left off: his chin is close to it.
    const trimK = clamp((v - 20) / 60, 0, 1) * clamp((ac.agl - 2) / 6, 0, 1);
    const trim = ((SPEC.CL0 + (ac.flaps || 0) * 0.62) / Math.max(0.5, SPEC.CLa)) * trimK;
    _qt.setFromAxisAngle(_w.set(1, 0, 0), -trim);
    ac.quat.copy(_q).multiply(_qt);
    // The air along the nose for the flight model's step (so no stall, no
    // buffet while the body catches the path up); where he really goes is
    // `dir`, put back below.
    ac.vel.copy(nose).multiplyScalar(v);
    ac.omega.set(0, 0, 0);
    const c = ac.controls;
    const keep = { pitch: c.pitch, roll: c.roll, yaw: c.yaw, brakes: c.brakes, throttle: c.throttle };
    c.pitch = 0;
    c.roll = 0;
    c.yaw = 0;
    c.brakes = 0;
    // He means it: the engine runs flat out (the sound, the fuel) while a move flies him.
    c.throttle = this.mode === 'ease' || this.mode === 'level' ? Math.max(keep.throttle || 0, 0.6) : 1;
    _p0.copy(ac.pos);
    // Faster than his red line: lift it while the move flies him (and for as
    // long as it does — the warnings read it every frame), so no "overspeed"
    // and no coming apart at 1000 kt. Put back when the move ends.
    if (this.mode === 'boost' || this.mode === 'ease' || v > 0.9 * (this._vneOrig ?? SPEC.vne)) this._raiseVne(v);
    let out;
    try {
      out = inner.call(ac, dt, weather);
    } finally {
      c.pitch = keep.pitch;
      c.roll = keep.roll;
      c.yaw = keep.yaw;
      c.brakes = keep.brakes;
      c.throttle = keep.throttle;
    }
    if (ac.crashed) {
      this.cancel('crash', ac);
      return out;
    }
    // Exactly where the move says.
    _v.copy(this.dir).multiplyScalar(v);
    ac.vel.copy(_v);
    ac.pos.copy(_p0).addScaledVector(_v, dt);
    ac.quat.copy(_q);
    ac.omega.set(0, 0, 0);
    ac.airspeed = v;
    ac.ias = v * Math.sqrt(Math.exp(-Math.max(0, ac.pos.y) / 8500));
    ac.groundSpeed = Math.hypot(_v.x, _v.z);
    ac.vs = _v.y;
    ac.alpha = 0;
    ac.beta = 0;
    ac.alt = ac.pos.y;
    ac.agl = ac.pos.y - heightAt(ac.pos.x, ac.pos.z);
    _a.set(0, 0, -1).applyQuaternion(ac.quat);
    if (Math.abs(_a.y) < 0.9999) ac.heading = ((Math.atan2(_a.x, -_a.z) * 180) / Math.PI + 360) % 360;
    ac.turnRate = 0;
    ac.gLoad = clamp(this.n, -3, 6);
    // Transonic buffet: slight, and only through the sound barrier.
    const M = machOf(v, ac.pos.y);
    ac.buffet = M > 0.88 && M < 1.12 ? 0.18 * (1 - Math.abs(M - 1) / 0.12) : 0;
    if ((this.mode === 'boost' || this.mode === 'ease') && this._lastM !== undefined && this._lastM < 1 && M >= 1) this.events.push('boom');
    this._lastM = M;
    if (this.mode === 'spin') setSpinSignal(c);
    else if (isSpinSignal(c)) c.pitch = c.roll = c.yaw = 0; // the spin is over: nothing left on the stick
    return out;
  }
}

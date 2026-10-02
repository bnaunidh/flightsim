/**
 * A ragdoll for the walking pilot.
 *
 * "if someone hits you with anything, a plane etc, you get pushed to the
 * ground, WASTED showing on your screen (ragdoll physics)" — the owner.
 *
 * WHAT IT IS. Fifteen points with weight — head, chest, both shoulders,
 * elbows and hands, the pelvis, both hips, knees and feet — held together by
 * distance constraints: the bones (exact lengths, straight off the person's
 * rig in ./staff/person.js), the chest and the pelvis (two stiff triangles,
 * joined by a waist that may bend a little), and JOINT LIMITS written the
 * same way, as a smallest and a largest distance: an elbow folds to about
 * 140° and no further, a knee the same, a thigh swings back about 40° and
 * forward about 110°, the head nods and tilts a little, a hand cannot go
 * through the chest and a knee cannot go through the face. Knees bend one way
 * only (a hinge, below). Each point is a ball with a radius, and the balls
 * stand on the ground as drawn, float in the sea and are pushed out of
 * buildings and parked things (whatever `world` says those are).
 *
 * HOW IT MOVES: position-based dynamics (Müller et al.), the way game
 * ragdolls are made cheap. Each sub-step moves every point by its velocity
 * and gravity, then nudges the points until the constraints hold (ten
 * passes), then reads the velocity back off how far each point really went.
 * Constraints only ever move points towards a shape the body can have, so
 * nothing can "explode": a limb can be bent, never stretched. Heavier points
 * move less (the chest, 10 kg, against a hand, 1 kg), which is what gives
 * the fall its weight. Friction on the ground is strong and the body falls
 * asleep once it has been still for a moment, so it never jitters where it
 * lies. Sub-steps are at most 1/120 s whatever the frame rate, and as small
 * as the frame (slow motion) — which also means two games that simulate
 * the same knock from the same pose, on the same ground, get the same fall.
 *
 * COST. 15 points, 66 constraints, ten passes, two sub-steps a frame at
 * 60 fps: about 2,000 small sums a frame, and nothing allocated. Measured in
 * tests/features/ragdoll.mjs.
 *
 * SHOWN WITH THE PERSON THAT IS ALREADY THERE. applyTo(person) turns the
 * person's own jointed groups (hips, chest, head, upper and lower arms and
 * legs) to match the points, so the ragdoll is the very same figure — the
 * pilot's uniform, the airline captain's — not a second model. capture()
 * goes the other way: it starts the ragdoll in exactly the pose the person
 * was drawn in that frame, mid-stride, so there is no jump when it starts.
 *
 * KID-SAFE: a toy figure falls over and lies still. Nothing comes off,
 * nothing is red.
 *
 *   const rd = new Ragdoll();
 *   rd.capture(person)  or  rd.standAt(x, y, z, headingDeg)
 *   rd.knock({ x, y, z }, hitY)        // the hitter's velocity (m/s), how high it struck
 *   rd.step(dt, world)                 // world: { floor(x, z), water(x, z), collide(p, r) }
 *   rd.applyTo(person)
 *   rd.pelvis / rd.asleep / rd.facing() / rd.lyingFaceUp()
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt } from '../world/terrain.js';
import { floorAt, solidAt } from './staff/walk.js';

/* ------------------------------------------------------------------ */
/* The body, standing, in the person's own frame (person.js)           */
/* ------------------------------------------------------------------ */

/** The rig's own measurements (person.js): the bones are these lengths. */
export const RIG = {
  hipY: 0.845,
  chestY: 0.06,
  headY: 0.62,
  shoulderX: 0.235,
  shoulderY: 0.42,
  upperArm: 0.28,
  forearm: 0.29,
  hipX: 0.095,
  thigh: 0.42,
  shin: 0.385,
};

/** Which point is which. */
export const PT = Object.freeze({
  HEAD: 0, CHEST: 1, LS: 2, RS: 3, LE: 4, RE: 5, LW: 6, RW: 7,
  PELVIS: 8, LH: 9, RH: 10, LK: 11, RK: 12, LF: 13, RF: 14,
});
export const COUNT = 15;

const B = RIG.hipY;
const C = B + RIG.chestY;
/*
 * Where each point sits on a person standing at the origin facing -Z, every
 * joint at rest. CHEST and PELVIS are a little in front of the middle of the
 * chest and the hips, so each of the two is a proper triangle with a front.
 */
const REST = [
  [0, C + RIG.headY + 0.03, 0], // head (the middle of it)
  [0, C + 0.25, -0.06], // chest, front
  [-RIG.shoulderX, C + RIG.shoulderY, 0], // left shoulder
  [RIG.shoulderX, C + RIG.shoulderY, 0],
  [-RIG.shoulderX, C + RIG.shoulderY - RIG.upperArm, 0], // elbows
  [RIG.shoulderX, C + RIG.shoulderY - RIG.upperArm, 0],
  [-RIG.shoulderX, C + RIG.shoulderY - RIG.upperArm - RIG.forearm, 0], // hands
  [RIG.shoulderX, C + RIG.shoulderY - RIG.upperArm - RIG.forearm, 0],
  [0, B + 0.02, -0.05], // pelvis, front
  [-RIG.hipX, B, 0], // hips
  [RIG.hipX, B, 0],
  [-RIG.hipX, B - RIG.thigh, 0], // knees
  [RIG.hipX, B - RIG.thigh, 0],
  [-RIG.hipX, B - RIG.thigh - RIG.shin, 0], // feet (the ankle)
  [RIG.hipX, B - RIG.thigh - RIG.shin, 0],
];

/** kg. A 75 kg grown-up, about where the weight really is. */
const MASS = [4.5, 10, 7, 7, 2, 2, 1, 1, 10, 8, 8, 4.5, 4.5, 2, 2];
/** Each point's ball: how far the body's surface is from it. */
const RADIUS = [0.13, 0.08, 0.12, 0.12, 0.05, 0.05, 0.05, 0.05, 0.08, 0.11, 0.11, 0.06, 0.06, 0.05, 0.05];

/** The knobs. */
export const RAGDOLL = {
  gravity: 11,
  /** Passes over the constraints per sub-step. */
  iterations: 10,
  /** Longest sub-step, seconds. */
  maxStep: 1 / 120,
  /** Most frame time taken in one go (a stalled tab does not fling the body). */
  maxFrame: 0.1,
  /** Ground friction, 1/s: how quickly sliding stops. */
  friction: 9,
  /** Air drag, 1/s. */
  drag: 0.05,
  /** Fastest any point may move, m/s. */
  maxSpeed: 30,
  /** Still for this long (every point slower than sleepSpeed) and on the ground: asleep. */
  sleepSpeed: 0.09,
  sleepAfter: 0.45,
  /** How hard a knock throws the body at most: m/s along, and up. */
  maxThrow: 9,
  maxLift: 4.6,
  /** In water: how strongly it floats (× gravity, fully under), and how thick the water is (1/s). */
  buoyancy: 1.25,
  waterDrag: 3.2,
};

/* ------------------------------------------------------------------ */
/* Constraints                                                         */
/* ------------------------------------------------------------------ */

const restLen = (a, b) => Math.hypot(REST[a][0] - REST[b][0], REST[a][1] - REST[b][1], REST[a][2] - REST[b][2]);

/** [a, b, min, max] — a bone is min = max. Built once; every ragdoll shares the list. */
const CONS = [];
function bone(a, b) {
  const l = restLen(a, b);
  CONS.push([a, b, l, l]);
}
function range(a, b, lo, hi) {
  const l = restLen(a, b);
  CONS.push([a, b, lo * l, hi * l]);
}
function apart(a, b, min) {
  CONS.push([a, b, min, Infinity]);
}
function between(a, b, min, max) {
  CONS.push([a, b, min, max]);
}
{
  const { HEAD, CHEST, LS, RS, LE, RE, LW, RW, PELVIS, LH, RH, LK, RK, LF, RF } = PT;
  // The chest and the pelvis: two stiff triangles.
  bone(CHEST, LS); bone(CHEST, RS); bone(LS, RS);
  bone(PELVIS, LH); bone(PELVIS, RH); bone(LH, RH);
  // The waist: they may bend and twist on each other, a little.
  for (const [a, b] of [[LS, LH], [RS, RH], [LS, RH], [RS, LH], [CHEST, PELVIS], [CHEST, LH], [CHEST, RH], [PELVIS, LS], [PELVIS, RS]]) range(a, b, 0.95, 1.035);
  // The head: nods and tilts, a little.
  range(HEAD, LS, 0.97, 1.03); range(HEAD, RS, 0.97, 1.03); range(HEAD, CHEST, 0.95, 1.04);
  // Arms: the bones, and the elbow folds to about 140° (shoulder to hand no closer than this).
  bone(LS, LE); bone(LE, LW); bone(RS, RE); bone(RE, RW);
  apart(LS, LW, 0.2); apart(RS, RW, 0.2);
  // Not through the chest: an elbow keeps off the other shoulder, a hand off the chest and the pelvis.
  apart(LE, RS, 0.24); apart(RE, LS, 0.24);
  apart(LW, CHEST, 0.12); apart(RW, CHEST, 0.12); apart(LW, PELVIS, 0.1); apart(RW, PELVIS, 0.1);
  // Legs: the bones; the knee folds to about 140°; the thigh swings back ~40°, forward ~110°.
  bone(LH, LK); bone(LK, LF); bone(RH, RK); bone(RK, RF);
  between(LH, LF, 0.3, RIG.thigh + RIG.shin); between(RH, RF, 0.3, RIG.thigh + RIG.shin);
  between(LK, PELVIS, 0.22, 0.52); between(RK, PELVIS, 0.22, 0.52);
  // ...and not through each other, nor up into the face.
  apart(LK, RK, 0.14); apart(LF, RF, 0.1); apart(LK, RH, 0.15); apart(RK, LH, 0.15);
  apart(LK, CHEST, 0.3); apart(RK, CHEST, 0.3); apart(LF, PELVIS, 0.24); apart(RF, PELVIS, 0.24);
  apart(LK, HEAD, 0.35); apart(RK, HEAD, 0.35);
}
export const CONSTRAINT_COUNT = CONS.length;

/** The two legs, for the knee hinge: [hip, knee, foot]. */
const LEGS = [[PT.LH, PT.LK, PT.LF], [PT.RH, PT.RK, PT.RF]];

/* ------------------------------------------------------------------ */
/* Small vector sums on flat arrays (no allocation in a frame)         */
/* ------------------------------------------------------------------ */

const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* Scratch: three-vectors as plain arrays. */
const _a = [0, 0, 0];
const _b = [0, 0, 0];
const _c = [0, 0, 0];
const _n = [0, 0, 0];

function sub(out, p, i, j) {
  out[0] = p[i * 3] - p[j * 3];
  out[1] = p[i * 3 + 1] - p[j * 3 + 1];
  out[2] = p[i * 3 + 2] - p[j * 3 + 2];
  return out;
}
function len(v) {
  return Math.hypot(v[0], v[1], v[2]);
}
function norm(v) {
  const l = len(v);
  if (l > 1e-9) {
    v[0] /= l;
    v[1] /= l;
    v[2] /= l;
  }
  return v;
}
function dot(u, v) {
  return u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
}
function cross(out, u, v) {
  const x = u[1] * v[2] - u[2] * v[1];
  const y = u[2] * v[0] - u[0] * v[2];
  const z = u[0] * v[1] - u[1] * v[0];
  out[0] = x;
  out[1] = y;
  out[2] = z;
  return out;
}

/* ------------------------------------------------------------------ */
/* The ragdoll                                                         */
/* ------------------------------------------------------------------ */

const DEFAULT_WORLD = {
  floor: () => 0,
  water: () => -Infinity,
  collide: null,
};

export class Ragdoll {
  constructor() {
    this.p = new Float64Array(COUNT * 3);
    this.v = new Float64Array(COUNT * 3);
    this.prev = new Float64Array(COUNT * 3);
    this.floorY = new Float64Array(COUNT);
    this.waterY = new Float64Array(COUNT);
    this.w = new Float64Array(COUNT);
    for (let i = 0; i < COUNT; i++) this.w[i] = 1 / MASS[i];
    /** Seconds simulated. */
    this.t = 0;
    this.still = 0;
    this.asleep = false;
    /** How many sub-steps, for the tests. */
    this.steps = 0;
    /** Points on the ground this sub-step (a bit per point). */
    this.contact = 0;
    /** The deepest any point has been under the floor after a step, metres (the tests: nothing sinks). */
    this.maxSink = 0;
    /** The worst a bone has been off its length after a step, metres (the tests: nothing stretches). */
    this.maxStretch = 0;
    this._pt = { x: 0, y: 0, z: 0 };
    this.pelvis = new THREE.Vector3();
  }

  /** Stand it up at (x, y = the ground, z), facing a compass heading. */
  standAt(x, y, z, headingDeg = 0) {
    const h = headingDeg * D2R;
    // The person faces -Z; a compass heading turns it clockwise seen from above.
    const c = Math.cos(h);
    const s = Math.sin(h);
    for (let i = 0; i < COUNT; i++) {
      const [rx, ry, rz] = REST[i];
      // Turned by -h about +Y: forward (0, 0, -1) goes to (sin h, 0, -cos h).
      this.p[i * 3] = x + rx * c - rz * s;
      this.p[i * 3 + 1] = y + ry;
      this.p[i * 3 + 2] = z + rx * s + rz * c;
    }
    this.v.fill(0);
    this._reset();
    return this;
  }

  /**
   * Start from the pose a person is drawn in right now (person.js rig):
   * every point read off the person's own joints, in the world.
   */
  capture(person) {
    const rig = person && person.userData && person.userData.rig;
    if (!rig || rig.lite) return false;
    person.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const put = (i, obj, x, y, z) => {
      v.set(x, y, z);
      obj.localToWorld(v);
      this.p[i * 3] = v.x;
      this.p[i * 3 + 1] = v.y;
      this.p[i * 3 + 2] = v.z;
    };
    put(PT.HEAD, rig.head, 0, 0.03, 0);
    put(PT.CHEST, rig.chest, 0, 0.25, -0.06);
    put(PT.PELVIS, rig.body, 0, 0.02, -0.05);
    for (const a of rig.arms) {
      const l = a.side < 0;
      put(l ? PT.LS : PT.RS, a.arm, 0, 0, 0);
      put(l ? PT.LE : PT.RE, a.elbow, 0, 0, 0);
      put(l ? PT.LW : PT.RW, a.elbow, 0, -RIG.forearm, 0);
    }
    for (const g of rig.legs) {
      const l = g.side < 0;
      put(l ? PT.LH : PT.RH, g.leg, 0, 0, 0);
      put(l ? PT.LK : PT.RK, g.knee, 0, 0, 0);
      put(l ? PT.LF : PT.RF, g.knee, 0, -RIG.shin, 0);
    }
    this.v.fill(0);
    this._reset();
    return true;
  }

  _reset() {
    this.t = 0;
    this.still = 0;
    this.asleep = false;
    this.steps = 0;
    this.maxSink = 0;
    this.maxStretch = 0;
    this._updatePelvis();
  }

  /**
   * Hit by something moving at `vel` (m/s, world), striking at `hitY`
   * metres above the feet. The points near that height are swept along at
   * the hitter's speed (up to maxThrow), the rest lag behind — so a bumper
   * takes the legs and the body folds over it, a wing at chest height
   * knocks the top half back. A little lift, more the faster the hit.
   */
  knock(vel, hitY = 0.9) {
    const vx = Number.isFinite(vel && vel.x) ? vel.x : 0;
    const vz = Number.isFinite(vel && vel.z) ? vel.z : 0;
    const vy0 = Number.isFinite(vel && vel.y) ? vel.y : 0;
    const sp = Math.hypot(vx, vz);
    const k = sp > RAGDOLL.maxThrow ? RAGDOLL.maxThrow / sp : 1;
    const tx = vx * k;
    const tz = vz * k;
    const thrown = sp * k;
    const lift = clamp(0.9 + 0.2 * thrown + Math.max(0, vy0) * 0.5, 0, RAGDOLL.maxLift);
    let low = Infinity;
    for (let i = 0; i < COUNT; i++) low = Math.min(low, this.p[i * 3 + 1]);
    const at = low + clamp(hitY, 0.1, 1.9);
    for (let i = 0; i < COUNT; i++) {
      const dy = this.p[i * 3 + 1] - at;
      // Full speed within 25 cm of where it struck, falling off to 40% a metre and a bit away.
      const f = clamp(1 - (Math.abs(dy) - 0.25) / 1.4, 0.4, 1);
      this.v[i * 3] += tx * f;
      this.v[i * 3 + 2] += tz * f;
      // The part struck goes up most; the head least (it is thrown back over the top).
      this.v[i * 3 + 1] += lift * (dy <= 0.3 ? 1 : 0.55);
    }
    this.asleep = false;
    this.still = 0;
  }

  /** Advance by dt seconds of game time. `world` is where the ground, the sea and the walls are. */
  step(dt, world = DEFAULT_WORLD) {
    if (!(dt > 0) || this.asleep) return;
    dt = Math.min(dt, RAGDOLL.maxFrame);
    const n = Math.max(1, Math.ceil(dt / RAGDOLL.maxStep - 1e-9));
    const h = dt / n;
    const W = world || DEFAULT_WORLD;
    // The ground under each point, read once a frame (the floor is a lookup into the drawn terrain).
    for (let i = 0; i < COUNT; i++) {
      const x = this.p[i * 3];
      const z = this.p[i * 3 + 2];
      let f = W.floor ? W.floor(x, z) : 0;
      if (!Number.isFinite(f)) f = 0;
      this.floorY[i] = f;
      const wy = W.water ? W.water(x, z) : -Infinity;
      this.waterY[i] = Number.isFinite(wy) && wy > f ? wy : -Infinity;
    }
    // Never started inside the ground (a pose read off a model a few centimetres low on a slope, a
    // friend's pilot put where their game had them): the whole body lifted clear, not flung up.
    if (this.steps === 0) {
      let lift = 0;
      for (let i = 0; i < COUNT; i++) lift = Math.max(lift, this.floorY[i] + RADIUS[i] - this.p[i * 3 + 1]);
      if (lift > 0) for (let i = 0; i < COUNT; i++) this.p[i * 3 + 1] += lift;
    }
    for (let s = 0; s < n; s++) this._sub(h, W);
    this.t += dt;
    this._measure();
    this._updatePelvis();
    // Asleep once it has been still a moment, on the ground or floating.
    let fast = 0;
    for (let i = 0; i < COUNT; i++) fast = Math.max(fast, Math.hypot(this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]));
    if (fast < RAGDOLL.sleepSpeed && this.contact !== 0) this.still += dt;
    else this.still = 0;
    if (this.still > RAGDOLL.sleepAfter) {
      this.asleep = true;
      this.v.fill(0);
    }
  }

  _sub(h, W) {
    const p = this.p;
    const v = this.v;
    const prev = this.prev;
    const g = RAGDOLL.gravity;
    const drag = Math.exp(-RAGDOLL.drag * h);
    const maxS = RAGDOLL.maxSpeed;
    // 1. Move.
    for (let i = 0; i < COUNT; i++) {
      const o = i * 3;
      prev[o] = p[o];
      prev[o + 1] = p[o + 1];
      prev[o + 2] = p[o + 2];
      let vy = v[o + 1] - g * h;
      let vx = v[o];
      let vz = v[o + 2];
      const wy = this.waterY[i];
      if (wy > -Infinity) {
        // Under water: floats, and the water is thick.
        const under = clamp((wy - (p[o + 1] - RADIUS[i])) / (2 * RADIUS[i]), 0, 1);
        if (under > 0) {
          vy += g * RAGDOLL.buoyancy * under * h;
          const wd = Math.exp(-RAGDOLL.waterDrag * under * h);
          vx *= wd;
          vy *= wd;
          vz *= wd;
        }
      }
      vx *= drag;
      vy *= drag;
      vz *= drag;
      const sp = Math.hypot(vx, vy, vz);
      if (sp > maxS) {
        vx *= maxS / sp;
        vy *= maxS / sp;
        vz *= maxS / sp;
      }
      p[o] += vx * h;
      p[o + 1] += vy * h;
      p[o + 2] += vz * h;
    }
    // 2. Hold the shape, and stand on the ground.
    const iters = RAGDOLL.iterations;
    for (let it = 0; it < iters; it++) {
      this._constraints();
      this._knees();
      this._ground();
    }
    // 3. Walls, once, and the shape once more after them.
    if (W.collide) {
      const q = this._pt;
      for (let i = 0; i < COUNT; i++) {
        const o = i * 3;
        q.x = p[o];
        q.y = p[o + 1];
        q.z = p[o + 2];
        if (W.collide(q, RADIUS[i])) {
          p[o] = q.x;
          p[o + 1] = q.y;
          p[o + 2] = q.z;
        }
      }
      this._constraints();
      this._ground();
    }
    // 4. Velocity from where the points actually went; friction where they touch.
    const fr = Math.exp(-RAGDOLL.friction * h);
    let contact = 0;
    for (let i = 0; i < COUNT; i++) {
      const o = i * 3;
      let vx = (p[o] - prev[o]) / h;
      let vy = (p[o + 1] - prev[o + 1]) / h;
      let vz = (p[o + 2] - prev[o + 2]) / h;
      if (p[o + 1] - RADIUS[i] <= this.floorY[i] + 0.004) {
        contact |= 1 << i;
        vx *= fr;
        vz *= fr;
        // No bounce into the ground; and the ground's push is a stop, never a launch.
        if (vy < 0) vy = 0;
        else if (vy > 3) vy = 3;
        if (Math.hypot(vx, vz) < 0.03) {
          vx = 0;
          vz = 0;
        }
      }
      v[o] = vx;
      v[o + 1] = vy;
      v[o + 2] = vz;
    }
    this.contact = contact;
    this.steps++;
  }

  _constraints() {
    const p = this.p;
    const w = this.w;
    for (let k = 0; k < CONS.length; k++) {
      const c = CONS[k];
      const a = c[0] * 3;
      const b = c[1] * 3;
      const dx = p[b] - p[a];
      const dy = p[b + 1] - p[a + 1];
      const dz = p[b + 2] - p[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      let want;
      if (d < c[2]) want = c[2];
      else if (d > c[3]) want = c[3];
      else continue;
      if (d < 1e-9) continue;
      const wa = w[c[0]];
      const wb = w[c[1]];
      const s = (d - want) / (d * (wa + wb));
      p[a] += dx * s * wa;
      p[a + 1] += dy * s * wa;
      p[a + 2] += dz * s * wa;
      p[b] -= dx * s * wb;
      p[b + 1] -= dy * s * wb;
      p[b + 2] -= dz * s * wb;
    }
  }

  /**
   * Knees bend one way. The way a knee may go is square to the hip-to-foot
   * line, in the plane square to the hips' axis (the hips' left-to-right):
   * standing, that is forwards; sitting with the leg out, it is up. A knee
   * found the other side of the line is put back on it, and the bones pull
   * the leg straight from there.
   */
  _knees() {
    const p = this.p;
    sub(_a, p, PT.RH, PT.LH);
    norm(_a); // the hips' axis, left to right
    for (const [H, K, F] of LEGS) {
      sub(_b, p, F, H);
      const l = len(_b);
      if (l < 1e-6) continue;
      _b[0] /= l;
      _b[1] /= l;
      _b[2] /= l;
      cross(_n, _a, _b); // which way this knee may go
      if (len(_n) < 0.2) continue; // leg along the hips' axis: no telling
      norm(_n);
      sub(_c, p, K, H);
      const along = dot(_c, _b);
      _c[0] -= _b[0] * along;
      _c[1] -= _b[1] * along;
      _c[2] -= _b[2] * along;
      const wrong = dot(_c, _n);
      if (wrong >= 0) continue;
      const o = K * 3;
      p[o] -= _n[0] * wrong;
      p[o + 1] -= _n[1] * wrong;
      p[o + 2] -= _n[2] * wrong;
    }
  }

  _ground() {
    const p = this.p;
    for (let i = 0; i < COUNT; i++) {
      const o = i * 3 + 1;
      const low = this.floorY[i] + RADIUS[i];
      if (p[o] < low) p[o] = low;
    }
  }

  _measure() {
    const p = this.p;
    let sink = 0;
    for (let i = 0; i < COUNT; i++) sink = Math.max(sink, this.floorY[i] + RADIUS[i] - p[i * 3 + 1]);
    this.maxSink = Math.max(this.maxSink, sink);
    let stretch = 0;
    for (let k = 0; k < CONS.length; k++) {
      const c = CONS[k];
      if (c[2] !== c[3]) continue;
      sub(_a, p, c[0], c[1]);
      stretch = Math.max(stretch, Math.abs(len(_a) - c[2]));
    }
    this.maxStretch = Math.max(this.maxStretch, stretch);
  }

  _updatePelvis() {
    const p = this.p;
    const l = PT.LH * 3;
    const r = PT.RH * 3;
    this.pelvis.set((p[l] + p[r]) / 2, (p[l + 1] + p[r + 1]) / 2, (p[l + 2] + p[r + 2]) / 2);
  }

  /** A point, as { x, y, z } (a fresh object: for the tests and the get-up). */
  point(i) {
    return { x: this.p[i * 3], y: this.p[i * 3 + 1], z: this.p[i * 3 + 2] };
  }

  /** Every point, flat [x, y, z, ...] (a copy). */
  points() {
    return Array.from(this.p);
  }

  /** Fastest point, m/s. */
  speed() {
    let f = 0;
    for (let i = 0; i < COUNT; i++) f = Math.max(f, Math.hypot(this.v[i * 3], this.v[i * 3 + 1], this.v[i * 3 + 2]));
    return f;
  }

  /** Compass heading from the feet to the head, lying down: which way to stand up facing. */
  facing() {
    const p = this.p;
    const fx = p[PT.HEAD * 3] - (p[PT.LF * 3] + p[PT.RF * 3]) / 2;
    const fz = p[PT.HEAD * 3 + 2] - (p[PT.LF * 3 + 2] + p[PT.RF * 3 + 2]) / 2;
    if (Math.hypot(fx, fz) < 0.05) return 0;
    return ((Math.atan2(fx, -fz) / D2R) % 360 + 360) % 360;
  }

  /** True when the chest faces the sky. */
  lyingFaceUp() {
    const p = this.p;
    sub(_a, p, PT.RS, PT.LS);
    const mx = (p[PT.LS * 3] + p[PT.RS * 3]) / 2;
    const my = (p[PT.LS * 3 + 1] + p[PT.RS * 3 + 1]) / 2;
    const mz = (p[PT.LS * 3 + 2] + p[PT.RS * 3 + 2]) / 2;
    _b[0] = p[PT.CHEST * 3] - mx;
    _b[1] = p[PT.CHEST * 3 + 1] - my;
    _b[2] = p[PT.CHEST * 3 + 2] - mz;
    return _b[1] > 0;
  }

  /** How high the head is over the lowest foot: about 1.6 standing, under 0.4 lying down. */
  height() {
    const p = this.p;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < COUNT; i++) {
      lo = Math.min(lo, p[i * 3 + 1]);
      hi = Math.max(hi, p[i * 3 + 1]);
    }
    return hi - lo;
  }

  /* ---------------------------------------------------------------- */
  /* Drawn: the person's own joints turned to match                    */
  /* ---------------------------------------------------------------- */

  /**
   * Pose a person (person.js rig) to match the points. Sets the person's
   * position and turn, and every joint's. The person must be in a group
   * with no turn or scale of its own (the scene, or the multiplayer group).
   */
  applyTo(person) {
    const rig = person && person.userData && person.userData.rig;
    if (!rig || rig.lite) return false;
    const p = this.p;
    // Hips and chest: a frame from each triangle (left-to-right, and the front point).
    frameTri(p, PT.LH, PT.RH, PT.PELVIS, _qb, REST_Q.body);
    frameTri(p, PT.LS, PT.RS, PT.CHEST, _qc, REST_Q.chest);
    // Root: at the ground under the hips, not turned; the hips are the body group.
    const hx = (p[PT.LH * 3] + p[PT.RH * 3]) / 2;
    const hy = (p[PT.LH * 3 + 1] + p[PT.RH * 3 + 1]) / 2;
    const hz = (p[PT.LH * 3 + 2] + p[PT.RH * 3 + 2]) / 2;
    person.quaternion.identity();
    person.position.set(hx, hy - RIG.hipY, hz);
    rig.body.position.set(0, RIG.hipY, 0);
    rig.body.quaternion.copy(_qb);
    rig.body.scale.set(1, 1, 1);
    // The chest where its shoulders are: slid a centimetre or two if the waist has bent.
    _v.set((p[PT.LS * 3] + p[PT.RS * 3]) / 2, (p[PT.LS * 3 + 1] + p[PT.RS * 3 + 1]) / 2, (p[PT.LS * 3 + 2] + p[PT.RS * 3 + 2]) / 2);
    _w.set(0, RIG.shoulderY, 0).applyQuaternion(_qc);
    _v.sub(_w);
    _co.copy(_v); // the chest's origin, in the world
    _v.sub(_u.set(hx, hy, hz));
    _qi.copy(_qb).invert();
    _v.applyQuaternion(_qi);
    rig.chest.position.copy(_v);
    rig.chest.quaternion.copy(_qi).multiply(_qc);
    rig.chest.scale.set(1, 1, 1);
    // Head: up from the middle of the shoulders, square to the chest, and its middle where the point is.
    _ax.set(1, 0, 0).applyQuaternion(_qc);
    frameHead(p, _ax, _qh);
    _qi.copy(_qc).invert();
    rig.head.quaternion.copy(_qi).multiply(_qh);
    _v.set(0, 0.03, 0).applyQuaternion(_qh);
    _v.set(p[PT.HEAD * 3] - _v.x, p[PT.HEAD * 3 + 1] - _v.y, p[PT.HEAD * 3 + 2] - _v.z).sub(_co).applyQuaternion(_qi);
    rig.head.position.copy(_v);
    // Arms and legs: each upper and lower bone, the joint's axis read off how it is bent.
    _ax.set(1, 0, 0).applyQuaternion(_qc);
    for (const a of rig.arms) {
      const l = a.side < 0;
      limbPair(p, l ? PT.LS : PT.RS, l ? PT.LE : PT.RE, l ? PT.LW : PT.RW, _ax, 1, _qu, _ql);
      a.arm.quaternion.copy(_qc).invert().multiply(_qu);
      a.elbow.quaternion.copy(_qu).invert().multiply(_ql);
    }
    _ax.set(1, 0, 0).applyQuaternion(_qb);
    for (const g of rig.legs) {
      const l = g.side < 0;
      limbPair(p, l ? PT.LH : PT.RH, l ? PT.LK : PT.RK, l ? PT.LF : PT.RF, _ax, -1, _qu, _ql);
      g.leg.quaternion.copy(_qb).invert().multiply(_qu);
      g.knee.quaternion.copy(_qu).invert().multiply(_ql);
    }
    return true;
  }
}

/* ---- frames for applyTo ---------------------------------------------- */

const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _qu = new THREE.Quaternion();
const _ql = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _u = new THREE.Vector3();
const _ax = new THREE.Vector3();
const _co = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _X = new THREE.Vector3();
const _Y = new THREE.Vector3();
const _Z = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _hinge = new THREE.Vector3();
const _s1 = new THREE.Vector3();
const _s2 = new THREE.Vector3();

/** A frame (X along left-to-right, Z out of the back) from a triangle: its quaternion, times the inverse of the same at rest. */
function triBasis(xa, ya, za, xb, yb, zb, xf, yf, zf, out) {
  _X.set(xb - xa, yb - ya, zb - za).normalize();
  // Front point, from the middle of the two.
  _Z.set(xf - (xa + xb) / 2, yf - (ya + yb) / 2, zf - (za + zb) / 2);
  _Z.addScaledVector(_X, -_Z.dot(_X)).normalize().negate();
  _Y.crossVectors(_Z, _X);
  _m.makeBasis(_X, _Y, _Z);
  return out.setFromRotationMatrix(_m);
}

function frameTri(p, a, b, f, out, rest) {
  triBasis(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2], p[f * 3], p[f * 3 + 1], p[f * 3 + 2], out);
  return out.multiply(rest);
}

/** The rest frames' inverses, so a body at rest comes out as no turn at all. */
const REST_Q = (() => {
  const r = (a, b, f) => {
    const q = new THREE.Quaternion();
    triBasis(...REST[a], ...REST[b], ...REST[f], q);
    return q.invert();
  };
  return { body: r(PT.LH, PT.RH, PT.PELVIS), chest: r(PT.LS, PT.RS, PT.CHEST) };
})();

/** A bone's frame: Y up the bone (from `to` back towards `from`), X as near `side` as it can be. */
function boneBasis(fromX, fromY, fromZ, toX, toY, toZ, side, out) {
  _Y.set(fromX - toX, fromY - toY, fromZ - toZ).normalize();
  _X.copy(side).addScaledVector(_Y, -side.dot(_Y));
  if (_X.lengthSq() < 1e-8) {
    // The side hint lies along the bone: any square direction will do.
    _X.set(1, 0, 0).addScaledVector(_Y, -_Y.x);
    if (_X.lengthSq() < 1e-8) _X.set(0, 0, 1);
  }
  _X.normalize();
  _Z.crossVectors(_X, _Y);
  _m.makeBasis(_X, _Y, _Z);
  return out.setFromRotationMatrix(_m);
}

/** The head: Y up from the middle of the shoulders to the head, X as near the chest's as it can be. */
function frameHead(p, side, out) {
  const mx = (p[PT.LS * 3] + p[PT.RS * 3]) / 2;
  const my = (p[PT.LS * 3 + 1] + p[PT.RS * 3 + 1]) / 2;
  const mz = (p[PT.LS * 3 + 2] + p[PT.RS * 3 + 2]) / 2;
  const h = PT.HEAD * 3;
  return boneBasis(p[h], p[h + 1], p[h + 2], mx, my, mz, side, out);
}

/**
 * Upper and lower bone of an arm or a leg. The hinge's axis is the cross
 * of the two bones (an elbow's sign as it is, a knee's turned round: a knee
 * folds the other way), eased onto the parent's left-to-right as the limb
 * straightens, where the cross says nothing.
 */
function limbPair(p, a, b, c, parentX, sign, outU, outL) {
  _s1.set(p[b * 3] - p[a * 3], p[b * 3 + 1] - p[a * 3 + 1], p[b * 3 + 2] - p[a * 3 + 2]);
  _s2.set(p[c * 3] - p[b * 3], p[c * 3 + 1] - p[b * 3 + 1], p[c * 3 + 2] - p[b * 3 + 2]);
  const l1 = _s1.length() || 1;
  const l2 = _s2.length() || 1;
  _bend.crossVectors(_s1, _s2).multiplyScalar(sign / (l1 * l2));
  const s = _bend.length();
  // 0 straight, 1 bent past about 15°.
  const k = clamp((s - 0.05) / 0.2, 0, 1);
  const kk = k * k * (3 - 2 * k);
  if (s > 1e-6) _bend.multiplyScalar(1 / s);
  _hinge.copy(parentX).multiplyScalar(1 - kk).addScaledVector(_bend, kk);
  if (_hinge.lengthSq() < 1e-8) _hinge.copy(parentX);
  boneBasis(p[a * 3], p[a * 3 + 1], p[a * 3 + 2], p[b * 3], p[b * 3 + 1], p[b * 3 + 2], _hinge, outU);
  boneBasis(p[b * 3], p[b * 3 + 1], p[b * 3 + 2], p[c * 3], p[c * 3 + 1], p[c * 3 + 2], _hinge, outL);
}

/* ------------------------------------------------------------------ */
/* The world it falls in                                               */
/* ------------------------------------------------------------------ */

/*
 * Where the ground, the sea and the walls are for a body: the walker's own
 * (staff/walk.js), so a body lies where a walker would stand — on the drawn
 * terrain, the runway's surface, a pad's disc — and is pushed out of the
 * buildings (OBSTACLES), the apron's things (props) and whatever solids the
 * caller lists (the parked aeroplane you got out of). Except the things that
 * are MOVING: the follow-me van lapping the apron is a solid box to a walker,
 * and a body lying in its path was bulldozed round the apron with it
 * (measured: still sliding at 6-7 m/s five seconds after the knock). A box
 * seen to move in the last half second is driven over instead.
 */
const boxSeen = new WeakMap();
const nowS = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()) / 1000;
function movingBox(b) {
  if (b.fx === undefined) return false; // a building: never moves
  const t = nowS();
  let s = boxSeen.get(b);
  if (!s) {
    s = { x: b.x, z: b.z, at: -1e9 };
    boxSeen.set(b, s);
    return false;
  }
  if (s.x !== b.x || s.z !== b.z) {
    s.x = b.x;
    s.z = b.z;
    s.at = t;
  }
  return t - s.at < 0.5;
}

/**
 * Out of one box, through its nearest side (or up onto its top, if that is
 * nearer): world boxes (OBSTACLES: x0..x1, z0..z1) and oriented ones (props
 * and solids: x, z, fx, fz, hl, hw), both with y0..y1.
 */
export function pushOut(p, r, b) {
  const top = (b.y1 ?? Infinity) + r - p.y;
  if (b.fx !== undefined && b.hl !== undefined) {
    const dx = p.x - b.x;
    const dz = p.z - b.z;
    const a = dx * b.fx + dz * b.fz;
    const s = dx * -b.fz + dz * b.fx;
    const pens = [b.hl + r - a, a + b.hl + r, b.hw + r - s, s + b.hw + r];
    let k = 0;
    for (let i = 1; i < 4; i++) if (pens[i] < pens[k]) k = i;
    if (top >= 0 && top < pens[k]) {
      p.y += top;
      return true;
    }
    let na = a;
    let ns = s;
    if (k === 0) na = b.hl + r;
    else if (k === 1) na = -b.hl - r;
    else if (k === 2) ns = b.hw + r;
    else ns = -b.hw - r;
    p.x = b.x + na * b.fx - ns * b.fz;
    p.z = b.z + na * b.fz + ns * b.fx;
    return true;
  }
  if (b.x0 === undefined) return false;
  const pens = [b.x1 + r - p.x, p.x - (b.x0 - r), b.z1 + r - p.z, p.z - (b.z0 - r)];
  let k = 0;
  for (let i = 1; i < 4; i++) if (pens[i] < pens[k]) k = i;
  if (top >= 0 && top < pens[k]) {
    p.y += top;
    return true;
  }
  if (k === 0) p.x = b.x1 + r;
  else if (k === 1) p.x = b.x0 - r;
  else if (k === 2) p.z = b.z1 + r;
  else p.z = b.z0 - r;
  return true;
}

/** A world for Ragdoll.step(): the game's ground and sea, and its walls plus `solids()` (oriented boxes, or null). */
export function groundWorld(solids = () => null) {
  return {
    floor: (x, z) => floorAt(x, z),
    water: (x, z) => (heightAt(x, z) < 0 ? 0 : -Infinity),
    collide(p, r) {
      let list = null;
      try {
        list = solids ? solids() : null;
      } catch (e) {
        list = null;
      }
      const box = solidAt(p.x, p.z, p.y - r, r, list, 2 * r);
      if (!box || movingBox(box)) return false;
      return pushOut(p, r, box);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Getting up: from where it lies back into the walk, eased            */
/* ------------------------------------------------------------------ */

/**
 * The joints posePerson() never touches, back to nothing. It sets only some
 * angles (a leg's swing, an arm's swing and lift, the chest's lean and twist)
 * and leaves the rest of each joint's rotation as it found it — so a leg the
 * ragdoll left twisted would walk on twisted for ever. Called when the
 * ragdoll lets go, and on every frame of the get-up.
 */
export function cleanRig(person) {
  const rig = person && person.userData && person.userData.rig;
  if (!rig) return;
  rig.body.rotation.set(0, 0, 0);
  rig.body.position.x = 0;
  rig.body.position.z = 0;
  rig.chest.position.set(0, RIG.chestY, 0);
  rig.chest.rotation.z = 0;
  rig.head.rotation.z = 0;
  rig.head.position.set(0, RIG.headY, 0);
  for (const a of rig.arms) {
    a.arm.rotation.y = 0;
    a.elbow.rotation.y = 0;
    a.elbow.rotation.z = 0;
  }
  for (const g of rig.legs) {
    g.leg.rotation.y = 0;
    g.leg.rotation.z = 0;
    g.knee.rotation.y = 0;
    g.knee.rotation.z = 0;
  }
}

/**
 * Remember a person's joints as the ragdoll left them, then ease from those
 * to whatever the walk animation poses each frame after, over `secs`: the
 * pilot gets up rather than popping upright.
 */
export class GetUp {
  constructor() {
    this.q = [];
    this.t = 1;
    this.secs = 0.6;
    this.on = false;
  }

  _joints(rig) {
    const out = [rig.body, rig.chest, rig.head];
    for (const a of rig.arms) out.push(a.arm, a.elbow);
    for (const g of rig.legs) out.push(g.leg, g.knee);
    return out;
  }

  /** The person as the ragdoll left them; the joints are then put back to rest for the walk to pose. */
  begin(person, secs = 0.6) {
    const rig = person && person.userData && person.userData.rig;
    if (!rig) return false;
    const js = this._joints(rig);
    while (this.q.length < js.length + 1) this.q.push({ q: new THREE.Quaternion(), p: new THREE.Vector3() });
    this.q[0].q.copy(person.quaternion);
    this.q[0].p.copy(person.position);
    for (let i = 0; i < js.length; i++) {
      this.q[i + 1].q.copy(js[i].quaternion);
      this.q[i + 1].p.copy(js[i].position);
    }
    cleanRig(person);
    this.t = 0;
    this.secs = secs;
    this.on = true;
    return true;
  }

  /** After the walk has posed the person this frame: blend from the ragdoll's pose. Returns false once done. */
  apply(person, dt) {
    if (!this.on) return false;
    const rig = person && person.userData && person.userData.rig;
    if (!rig) {
      this.on = false;
      return false;
    }
    // What the walk asked for, clean of last frame's blend.
    cleanRig(person);
    this.t += dt / this.secs;
    if (this.t >= 1) {
      this.on = false;
      return false;
    }
    const u = this.t * this.t * (3 - 2 * this.t);
    const js = this._joints(rig);
    _qi.copy(person.quaternion);
    person.quaternion.slerpQuaternions(this.q[0].q, _qi, u);
    _w.copy(person.position);
    person.position.lerpVectors(this.q[0].p, _w, u);
    for (let i = 0; i < js.length; i++) {
      const j = js[i];
      _qi.copy(j.quaternion);
      j.quaternion.slerpQuaternions(this.q[i + 1].q, _qi, u);
      _w.copy(j.position);
      j.position.lerpVectors(this.q[i + 1].p, _w, u);
    }
    return true;
  }
}

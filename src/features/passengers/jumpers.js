/**
 * Everybody under a parachute who is not you: an airliner's passengers and
 * cabin crew, out of the doors one after another.
 *
 * Hundreds of them (an A380 carries 555), so nobody is a real person model:
 * one InstancedMesh for every canopy, one for every body and one for every
 * head — three draws for the whole crowd, whatever its size, and nothing at
 * all until somebody jumps. The player keeps their own full parachute
 * (eject/chute.js); this is the crowd round them.
 *
 * HOW ONE FALLS. Out of the door with the aeroplane's speed, a push away from
 * the skin and a little down. For the first second they barely slow — so they
 * drop clear BELOW the wing (doors over the wing are not used at all, see
 * passengers.js pickDoors) instead of being blown back through it — then a
 * strong cartoon drag (eject/chute.js's) takes the speed off, the canopy pops
 * at 2.2 s and fills in under a second. Under it: a slow glide and the wind,
 * down at 16 m/s high up so a crowd from 3,000 m is down in a few minutes,
 * slowing to 4 m/s for the last 60 m — a gentle landing. On the ground the
 * canopy folds down beside them and they stand; in the sea they float, head
 * and shoulders up, and the canopy lies on the water.
 *
 * School-safe: nobody is hurt. Everybody floats down; the counts on screen
 * say so.
 */

import * as THREE from '../../vendor/three.module.js';

const G = 9.81;

export const JUMP = {
  push: 2.4, // m/s out of the door, along its normal
  drop: 1.2, // and down
  cling: 1.0, // seconds of barely slowing: clear of the wing first
  clingDrag: 0.0006,
  fallDrag: 0.004,
  openAt: 2.2,
  openTime: 0.8,
  glide: 3.2,
  sinkHigh: 16,
  sinkLow: 4,
  lowFrom: 60,
  settle: 1.4,
  /** Re-read the ground under someone this often (seconds), or every frame near it. */
  groundEvery: 0.4,
  /**
   * Everybody jumps a little differently: harder or softer off the sill, a
   * step forward or back, spread-eagled or tucked (the drag), a second sooner
   * or later to the canopy. Without it every person out of a door followed the
   * one before along the very same line, and on screen four solid streams of
   * figures ran down the same pixels several times a second: a strobe (the
   * flicker probe put 11% of a 10-degree field over WCAG's flash line; the
   * other half of the cure is evac.js's pace with Reduce flashing on). The
   * cling never goes below 0.9 s, so they still drop clear under the wing.
   */
  spread: {
    push: [0.4, 2.0], // x JUMP.push
    along: 5.0, // m/s, either way along the fuselage
    drop: [0.2, 3.5], // x JUMP.drop
    drag: [0.4, 2.2], // x the fall drag
    cling: [0.9, 1.3], // x JUMP.cling
    openAt: [0.7, 1.8], // x JUMP.openAt
    sill: 0.35, // m, either way along the door, where they leave from
  },
};
const lerp = (a, b, t) => a + (b - a) * t;

/** Canopy colours: passengers get bright mixes, the crew the airline's navy and gold. */
const PAX_CANOPIES = [0xff7a1a, 0x45a2dd, 0xffd23f, 0xe0473c, 0x3aa66b, 0x9b59d0, 0xf4f4f0, 0x1fb5ad, 0xff5c8a];
const CREW_CANOPY = 0x1d2a45;
const PAX_CLOTHES = [0x2f4f8a, 0xb5402f, 0x3a7d44, 0x6b4f9a, 0xd9a03f, 0x445566, 0xc7c2b8, 0x8a3b5c, 0x2b8a8a, 0x5a5a5a];
const CREW_CLOTHES = 0x1d2a45;
const SKIN = [0xf2d0b5, 0xe0b48f, 0xc68c5a, 0x9a6440, 0x6e4528, 0xf5dcc6];

/* ------------------------------------------------------------------ */
/* Geometry, made once                                                 */
/* ------------------------------------------------------------------ */

/** Merge simple geometries into one non-indexed BufferGeometry (positions and normals). */
function merge(list) {
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  for (const g of list) g.dispose();
  for (const g of parts) if (!list.includes(g)) g.dispose();
  out.computeBoundingSphere();
  return out;
}

const box = (w, h, d, x, y, z, rx = 0, rz = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
};

/** A person, feet at the origin, arms up holding the risers. 1.75 m. */
export function bodyGeometry() {
  return merge([
    box(0.4, 0.58, 0.24, 0, 1.18, 0), // torso
    box(0.15, 0.84, 0.17, -0.1, 0.44, 0), // legs
    box(0.15, 0.84, 0.17, 0.1, 0.44, 0),
    box(0.1, 0.56, 0.11, -0.25, 1.7, 0, 0, -0.25), // arms, up
    box(0.1, 0.56, 0.11, 0.25, 1.7, 0, 0, 0.25),
  ]);
}

/** A person sitting (for the cabin): bottom on the seat at y 0.45. */
export function seatedGeometry() {
  return merge([
    box(0.4, 0.6, 0.24, 0, 0.78, 0.02), // torso
    box(0.15, 0.16, 0.46, -0.1, 0.5, -0.2), // thighs, forward
    box(0.15, 0.16, 0.46, 0.1, 0.5, -0.2),
    box(0.14, 0.48, 0.15, -0.1, 0.24, -0.42), // shins
    box(0.14, 0.48, 0.15, 0.1, 0.24, -0.42),
    box(0.1, 0.4, 0.11, -0.25, 0.8, -0.08, 0.5), // arms on the armrests
    box(0.1, 0.4, 0.11, 0.25, 0.8, -0.08, 0.5),
  ]);
}

export function headGeometry(y = 1.62) {
  const g = new THREE.SphereGeometry(0.125, 10, 7);
  g.translate(0, y, 0);
  return g;
}

const CANOPY_R = 2.8;
const CANOPY_H = 4.9; // skirt above the feet
function canopyGeometry() {
  const dome = new THREE.SphereGeometry(CANOPY_R, 14, 4, 0, Math.PI * 2, 0, 1.05);
  dome.scale(1, 0.6, 1);
  dome.translate(0, CANOPY_H - CANOPY_R * 0.6 * Math.cos(1.05), 0);
  // Four risers down to the shoulders, as thin boxes (one draw with the dome).
  const lines = [];
  const skirt = CANOPY_R * Math.sin(1.05);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const top = new THREE.Vector3(Math.cos(a) * skirt, CANOPY_H, Math.sin(a) * skirt);
    const bot = new THREE.Vector3(Math.sign(top.x) * 0.22, 1.95, 0);
    const len = top.distanceTo(bot);
    const g = new THREE.BoxGeometry(0.03, len, 0.03);
    const mid = top.clone().add(bot).multiplyScalar(0.5);
    const dir = top.clone().sub(bot).normalize();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
    g.translate(mid.x, mid.y, mid.z);
    lines.push(g);
  }
  return merge([dome, ...lines]);
}

let GEO = null;
let MAT = null;
function shared() {
  if (!GEO) GEO = { canopy: canopyGeometry(), body: bodyGeometry(), head: headGeometry() };
  if (!MAT) {
    MAT = {
      canopy: new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }),
      body: new THREE.MeshLambertMaterial({ color: 0xffffff }),
      head: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    };
  }
  return { GEO, MAT };
}

/* ------------------------------------------------------------------ */
/* The crowd                                                            */
/* ------------------------------------------------------------------ */

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _w = new THREE.Vector3();

export class Jumpers {
  /**
   * `scene`: where to draw them. `max`: room for this many. `ground(x, z)`:
   * the height of the ground there (sea level at least for water: the caller
   * says which with `water(x, z)`).
   */
  constructor(scene, max, { ground, water } = {}) {
    const { GEO: g, MAT: m } = shared();
    this.scene = scene;
    this.max = Math.max(1, max | 0);
    this.ground = ground || (() => 0);
    this.water = water || (() => false);
    this.list = [];
    this.root = new THREE.Group();
    this.root.name = 'passengers:jumpers';
    const mk = (geo, mat, name) => {
      const im = new THREE.InstancedMesh(geo, mat, this.max);
      im.name = name;
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.root.add(im);
      return im;
    };
    this.canopies = mk(g.canopy, m.canopy, 'passengers:canopies');
    this.bodies = mk(g.body, m.body, 'passengers:bodies');
    this.heads = mk(g.head, m.head, 'passengers:heads');
    scene.add(this.root);
    this.landed = 0;
    this.inWater = 0;
    this._col = new THREE.Color();
  }

  get count() {
    return this.list.length;
  }

  /**
   * One more out of the door. `pos`, `vel` world; `out` the door's outward
   * direction (world, roughly horizontal); `who` 'pax' | 'crew'.
   */
  launch(pos, vel, out, who = 'pax', seed = this.list.length) {
    if (this.list.length >= this.max) return null;
    const i = this.list.length;
    const r = (k) => {
      const x = Math.sin((seed + 1) * 12.9898 + k * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };
    const sp = JUMP.spread;
    // Along the fuselage: the horizontal at right angles to the door's way out.
    _w.set(-out.z, 0, out.x);
    if (_w.lengthSq() < 1e-6) _w.set(0, 0, 1);
    _w.normalize();
    const j = {
      i,
      who,
      pos: pos.clone().addScaledVector(_w, (r(7) - 0.5) * 2 * sp.sill),
      vel: vel
        .clone()
        .addScaledVector(out, JUMP.push * lerp(sp.push[0], sp.push[1], r(8)))
        .addScaledVector(_w, (r(9) - 0.5) * 2 * sp.along),
      drag: lerp(sp.drag[0], sp.drag[1], r(10)),
      cling: JUMP.cling * lerp(sp.cling[0], sp.cling[1], r(11)),
      openAt: JUMP.openAt * lerp(sp.openAt[0], sp.openAt[1], r(12)),
      t: 0,
      open: 0,
      heading: Math.atan2(out.x, -out.z) + (r(1) - 0.5) * 1.6,
      turn: (r(2) - 0.5) * 0.5,
      sway: r(3) * 6.28,
      groundY: this.ground(pos.x, pos.z),
      groundT: 0,
      landed: false,
      landT: 0,
      wet: false,
      settled: false,
    };
    j.vel.y -= JUMP.drop * lerp(sp.drop[0], sp.drop[1], r(13));
    this.list.push(j);
    const c = this._col;
    this.canopies.setColorAt(i, c.setHex(who === 'crew' ? CREW_CANOPY : PAX_CANOPIES[Math.floor(r(4) * PAX_CANOPIES.length)]));
    this.bodies.setColorAt(i, c.setHex(who === 'crew' ? CREW_CLOTHES : PAX_CLOTHES[Math.floor(r(5) * PAX_CLOTHES.length)]));
    this.heads.setColorAt(i, c.setHex(SKIN[Math.floor(r(6) * SKIN.length)]));
    for (const im of [this.canopies, this.bodies, this.heads]) {
      im.count = this.list.length;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    this._pose(j, 0);
    return j;
  }

  /** Move everyone. `wind` a world Vector3 (m/s). */
  update(dt, wind) {
    if (!(dt > 0) || !this.list.length) return;
    dt = Math.min(dt, 0.1);
    let changed = false;
    for (const j of this.list) {
      if (j.settled) continue;
      changed = true;
      if (!j.landed) this._fly(j, dt, wind);
      else {
        j.landT += dt;
        if (j.landT > 2.5) j.settled = true;
      }
      this._pose(j, dt);
    }
    if (changed) {
      this.canopies.instanceMatrix.needsUpdate = true;
      this.bodies.instanceMatrix.needsUpdate = true;
      this.heads.instanceMatrix.needsUpdate = true;
    }
  }

  _fly(j, dt, wind) {
    j.t += dt;
    const v = j.vel;
    if (j.t >= j.openAt) j.open = Math.min(1, j.open + dt / JUMP.openTime);
    // The ground: re-read now and then, every frame near it.
    j.groundT -= dt;
    const agl0 = j.pos.y - j.groundY;
    if (j.groundT <= 0 || agl0 < 25) {
      j.groundY = this.ground(j.pos.x, j.pos.z);
      j.groundT = JUMP.groundEvery;
    }
    const agl = j.pos.y - j.groundY;
    const free = 1 - j.open;
    v.y -= G * dt * free;
    const sp = v.length();
    const k = (j.t < j.cling ? JUMP.clingDrag : JUMP.fallDrag * j.drag) * free;
    if (sp > 0) v.multiplyScalar(Math.max(0, 1 - k * sp * dt));
    if (j.open > 0) {
      j.heading += j.turn * dt * j.open;
      const low = agl < JUMP.lowFrom;
      const lowK = Math.max(0, Math.min(1, agl / JUMP.lowFrom));
      const sink = low ? JUMP.sinkLow + (JUMP.sinkHigh - JUMP.sinkLow) * lowK * 0.25 : JUMP.sinkHigh;
      const wx = wind ? wind.x : 0;
      const wz = wind ? wind.z : 0;
      const tx = Math.sin(j.heading) * JUMP.glide + wx;
      const tz = -Math.cos(j.heading) * JUMP.glide + wz;
      const r = Math.min(1, dt * JUMP.settle * (0.4 + j.open * 2));
      v.x += (tx - v.x) * r;
      v.z += (tz - v.z) * r;
      v.y += (-sink - v.y) * r;
    }
    j.pos.addScaledVector(v, dt);
    if (j.pos.y <= j.groundY && j.t > 0.3) {
      j.pos.y = j.groundY;
      j.landed = true;
      j.landT = 0;
      j.wet = this.water(j.pos.x, j.pos.z);
      this.landed++;
      if (j.wet) this.inWater++;
    }
  }

  _pose(j, dt) {
    const i = j.i;
    j.sway += dt * 1.7;
    if (!j.landed) {
      // Hanging: a little pendulum swing under the canopy; tumbling a bit before it opens.
      const tilt = j.open > 0.5 ? Math.sin(j.sway) * 0.08 : 0.9 * (1 - j.open);
      _e.set(tilt, -j.heading, Math.cos(j.sway * 0.8) * 0.06, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(j.pos, _q, _s.set(1, 1, 1));
      this.bodies.setMatrixAt(i, _m);
      this.heads.setMatrixAt(i, _m);
      const o = j.open;
      _e.set(Math.sin(j.sway) * 0.06, -j.heading, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(j.pos, _q, _s.set(Math.max(0.001, o), Math.max(0.001, o), Math.max(0.001, o)));
      this.canopies.setMatrixAt(i, _m);
      return;
    }
    const k = Math.min(1, j.landT / 1.8);
    if (j.wet) {
      // Floating: head and shoulders out, bobbing; the canopy flat on the water.
      _p.set(j.pos.x, j.groundY - 1.15 + Math.sin(j.sway * 1.3) * 0.05, j.pos.z);
      _e.set(0, -j.heading, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(_p, _q, _s.set(1, 1, 1));
      this.bodies.setMatrixAt(i, _m);
      this.heads.setMatrixAt(i, _m);
    } else {
      _e.set(0, -j.heading, 0, 'YXZ');
      _q.setFromEuler(_e);
      _m.compose(j.pos, _q, _s.set(1, 1, 1));
      this.bodies.setMatrixAt(i, _m);
      this.heads.setMatrixAt(i, _m);
    }
    // The canopy settles: squashed down to a heap of cloth a hand's height
    // deep, and drawn off to lie beside them, the way they were gliding.
    _w.set(Math.sin(j.heading), 0, -Math.cos(j.heading));
    const sy = 1 - 0.96 * k;
    const base = j.wet ? j.groundY : j.pos.y;
    // Scaled about the feet: the skirt, 4.9 m up, comes down to 0.2 m.
    _p.set(j.pos.x + _w.x * 3.2 * k, base, j.pos.z + _w.z * 3.2 * k);
    _e.set(0, -j.heading, 0, 'YXZ');
    _q.setFromEuler(_e);
    _m.compose(_p, _q, _s.set(1 + 0.15 * k, sy, 1 + 0.15 * k));
    this.canopies.setMatrixAt(i, _m);
  }

  /** How many are still in the air, by who. */
  airborne(who) {
    let n = 0;
    for (const j of this.list) if (!j.landed && (!who || j.who === who)) n++;
    return n;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const im of [this.canopies, this.bodies, this.heads]) im.dispose();
    this.list.length = 0;
  }
}

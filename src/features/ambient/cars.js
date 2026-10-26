/**
 * The ambient cars: one InstancedMesh per kind of vehicle, driven along the
 * lanes of ../ambient/lanes.js.
 *
 *   LOD       the real shape within 400 m; a box of the right size and
 *             colour from 400 m to 1.5 km (one shared InstancedMesh); nothing
 *             beyond. Matrices are written only for instances that are drawn,
 *             and at half rate beyond 600 m.
 *   LANES     right-hand lanes; at a lane's end a car goes straight on to a
 *             lane that starts or passes there, turns off at a junction now
 *             and then, or turns round at a dead end.
 *   SIGNALS   where streets cross: a clock per junction, a stop line per
 *             lane, instanced signal heads whose lamp changes colour.
 *   NIGHT     headlights as one Points draw, two per car in view.
 *   YIELDING  on the driving maps a car holds 25 m clear of the player's car,
 *             ahead or behind; it is never solid.
 *
 * Nothing is allocated per frame: positions live in flat arrays, the matrix
 * and colour scratch objects live at module scope.
 */

import * as THREE from '../../vendor/three.module.js';
import { Batch, instanced } from '../../world/airport-kit.js';
import { fireEngineGeometry } from '../../world/airport-vehicles.js';
import { sampleLane, signalGreen } from './lanes.js';
import { makeRandom } from '../../core/noise.js';
import { wearRealVehicle } from '../../aircraft/real-models.js';

/** Metres: the real shape up to here. */
export const CAR_NEAR = 400;
/** Metres: the box stand-in up to here, nothing beyond. */
export const CAR_FAR = 1500;
/** Beyond this the matrices are written every other frame. */
const HALF_RATE = 600;
/** A car holds this far from the player's car. */
export const YIELD_GAP = 25;

const D2R = Math.PI / 180;
const _m = new THREE.Matrix4();
const _c = new THREE.Color();
const S = { x: 0, y: 0, z: 0, i: 0, heading: 0 };

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/** Size and speed per kind. Length along -Z (the nose), width across X, height. */
export const KINDS = Object.freeze({
  car: { L: 4.4, W: 1.75, H: 1.5, speed: 13, colour: 0xd8d8dc, vary: true },
  taxi: { L: 4.5, W: 1.8, H: 1.6, speed: 13, colour: 0xf2c230 },
  bus: { L: 11, W: 2.5, H: 3.2, speed: 9, colour: 0x2d6fb8 },
  van: { L: 5.4, W: 2.0, H: 2.3, speed: 11, colour: 0xf2f2f0 },
  truck: { L: 8, W: 2.5, H: 3.3, speed: 8, colour: 0x5a6b4e },
  jeep: { L: 4, W: 1.8, H: 1.9, speed: 11, colour: 0x6b7a5a },
  fourx4: { L: 4.8, W: 1.95, H: 2.0, speed: 10, colour: 0x8a3b2e },
  tractor: { L: 3.6, W: 1.9, H: 2.7, speed: 4, colour: 0x2f8a3c },
  firetruck: { L: 9.4, W: 2.6, H: 3.4, speed: 0, colour: 0xc8322a },
});

function wheels(b, halfTrack, axles, r, w = 0.3) {
  for (const z of axles) for (const s of [-1, 1]) b.cyl(r, r, w, s * halfTrack, r - w / 2, z, 0x17191c, 10, { matrix: wheelMatrix(s * halfTrack, r, z) });
}
const _wm = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
function wheelMatrix(x, y, z) {
  _q.setFromAxisAngle(_p.set(0, 0, 1), Math.PI / 2);
  _p.set(x, y, z);
  return _wm.compose(_p, _q, _s);
}

function carShape(k, colour) {
  const b = new Batch();
  const d = KINDS[k];
  const L = d.L;
  const W = d.W;
  const glass = 0x2a3440;
  if (k === 'bus') {
    b.slab(-W / 2, W / 2, 0.5, d.H, -L / 2, L / 2, colour);
    b.slab(-W / 2 - 0.02, W / 2 + 0.02, 1.6, 2.6, -L / 2 + 0.6, L / 2 - 0.4, glass);
    b.slab(-W / 2 + 0.1, W / 2 - 0.1, 1.2, 2.9, -L / 2 - 0.03, -L / 2 + 0.02, glass);
    wheels(b, W / 2 - 0.15, [-L / 2 + 1.6, L / 2 - 2.2], 0.5, 0.35);
  } else if (k === 'truck' || k === 'firetruck') {
    // A cab and a body.
    b.slab(-W / 2, W / 2, 0.75, 2.5, -L / 2, -L / 2 + 2.2, k === 'firetruck' ? colour : 0x4a5a40);
    b.slab(-W / 2 + 0.1, W / 2 - 0.1, 1.6, 2.4, -L / 2 - 0.02, -L / 2 + 0.03, glass);
    b.slab(-W / 2, W / 2, 0.8, d.H, -L / 2 + 2.4, L / 2, colour);
    if (k === 'firetruck') {
      b.slab(-W / 2 - 0.02, W / 2 + 0.02, 1.4, 1.65, -L / 2 + 2.4, L / 2, 0xf2d24a);
      b.slab(-0.9, 0.9, 2.5, 2.7, -L / 2 + 0.4, -L / 2 + 0.9, 0x1d4fb8);
    }
    wheels(b, W / 2 - 0.15, [-L / 2 + 1.3, L / 2 - 2.6, L / 2 - 1.0], 0.55, 0.4);
  } else if (k === 'tractor') {
    b.slab(-0.6, 0.6, 0.6, 1.5, -1.8, 0.4, colour);
    b.slab(-0.8, 0.8, 1.5, 2.7, -0.6, 0.8, colour);
    b.slab(-0.72, 0.72, 1.7, 2.5, -0.62, 0.78, glass);
    b.cyl(0.9, 0.9, 0.5, -0.95, 0, 0.6, 0x17191c, 10, { matrix: wheelMatrix(-0.95, 0.9, 0.6) });
    b.cyl(0.9, 0.9, 0.5, 0.95, 0, 0.6, 0x17191c, 10, { matrix: wheelMatrix(0.95, 0.9, 0.6) });
    b.cyl(0.45, 0.45, 0.3, -0.8, 0, -1.3, 0x17191c, 10, { matrix: wheelMatrix(-0.8, 0.45, -1.3) });
    b.cyl(0.45, 0.45, 0.3, 0.8, 0, -1.3, 0x17191c, 10, { matrix: wheelMatrix(0.8, 0.45, -1.3) });
  } else {
    // Car, taxi, van, jeep, 4x4: a body and a cabin.
    const cabH = k === 'van' ? d.H : d.H * 0.98;
    const cabFront = k === 'van' ? -L / 2 + 1.2 : -L / 2 + 1.5;
    const cabBack = k === 'van' ? L / 2 : L / 2 - 0.6;
    b.slab(-W / 2, W / 2, 0.45, 0.45 + d.H * 0.5, -L / 2, L / 2, colour);
    b.slab(-W / 2 + 0.12, W / 2 - 0.12, 0.45 + d.H * 0.5, cabH, cabFront, cabBack, k === 'van' ? colour : colour);
    b.slab(-W / 2 + 0.14, W / 2 - 0.14, 0.45 + d.H * 0.52, cabH - 0.12, cabFront - 0.02, cabFront + 0.9, glass);
    for (const s of [-1, 1]) b.slab(s * (W / 2 - 0.12) - 0.02, s * (W / 2 - 0.12) + 0.02, 0.45 + d.H * 0.55, cabH - 0.15, cabFront + 0.3, cabBack - 0.3, glass);
    if (k === 'taxi') b.slab(-0.35, 0.35, cabH, cabH + 0.22, -0.3, 0.3, 0xf2f2f0);
    wheels(b, W / 2 - 0.1, [-L / 2 + 0.9, L / 2 - 0.9], k === 'fourx4' || k === 'jeep' ? 0.42 : 0.34);
  }
  return b.geometry();
}

/** Headlight positions per kind, worked out once: nothing is made per car per frame. */
const LAMPS = Object.freeze(Object.fromEntries(Object.entries(KINDS).map(([k, d]) => [k, Object.freeze({ y: 0.75, x: d.W / 2 - 0.3, z: -d.L / 2 + 0.05 })])));
function lampsOf(k) {
  return LAMPS[k];
}

/* ------------------------------------------------------------------ */
/* The layer                                                           */
/* ------------------------------------------------------------------ */

const CAR_TINTS = [0xd8d8dc, 0x1f2a3a, 0x8a1f1f, 0x2f5f9a, 0xe8e2d0, 0x3a3a3c, 0x6d8a3a, 0xb8b8bc, 0xd79a2a, 0x5b2a6e];

export class CarLayer {
  /**
   * @param {THREE.Group} group    where the meshes go (disposed with the world)
   * @param {object} net           buildLanes()'s result
   */
  /**
   * `shadows`: whether the vehicles cast shadows. Off below High: the shadow
   * pass draws every instanced mesh a second time, and at Medium that was
   * the difference between +8 and +12 draw calls on a town street.
   */
  constructor(group, net, { shadows = true } = {}) {
    this.group = group;
    this.net = net;
    this.shadows = !!shadows;
    this.cars = []; // { kind, lane, s, hint, speed, want, stopped, parked, tint, px, py, pz, heading, dist, far, near }
    this.meshes = new Map(); // kind -> InstancedMesh (detail)
    this.meshList = []; // the same, as an array the frame loop walks without an iterator
    this.proxy = null;
    this.signalHeads = null;
    this.signalLamps = null;
    this.lights = null;
    this.lightPos = null;
    this.frame = 0;
    this.t = 0;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 });
    this.proxyMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.1 });
    this.boxGeo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
    this.rnd = makeRandom(31);
    this.thin = []; // { x, z, r }
    this.stats = { placed: 0, drawn: 0, proxies: 0, ms: 0 };
    this.player = null; // { pos } of the player's car, for yielding
  }

  /** Put `count` vehicles of `kind` on lanes of the given kinds ('street', 'road', 'loop'), or parked round a point. */
  populate(kind, count, { laneKinds = ['street', 'road'], park = null } = {}) {
    if (!KINDS[kind] || count <= 0) return 0;
    const lanes = this.net.lanes.map((l, i) => i).filter((i) => laneKinds.includes(this.net.lanes[i].kind));
    let made = 0;
    for (let k = 0; k < count; k++) {
      const car = { kind, lane: -1, s: 0, hint: 0, speed: 0, want: KINDS[kind].speed, stopped: false, parked: !!park, tint: KINDS[kind].vary ? CAR_TINTS[Math.floor(this.rnd() * CAR_TINTS.length)] : KINDS[kind].colour, px: 0, py: 0, pz: 0, heading: 0, dist: Infinity, idx: this.cars.length, hidden: false };
      if (park) {
        const ang = (k / Math.max(1, count)) * Math.PI * 2 + 0.4;
        car.px = park.x + Math.sin(ang) * park.r;
        car.pz = park.z - Math.cos(ang) * park.r;
        car.py = park.y != null ? park.y : 0;
        car.heading = ((ang * 180) / Math.PI + 90) % 360;
        car.speed = 0;
      } else {
        if (!lanes.length) break;
        const li = lanes[Math.floor(this.rnd() * lanes.length)];
        const L = this.net.lanes[li];
        car.lane = li;
        car.s = this.rnd() * Math.max(1, L.len - 8);
        car.speed = car.want * (0.8 + this.rnd() * 0.3);
        car.want = car.speed;
        sampleLane(L, car.s, S, 0);
        car.px = S.x;
        car.py = S.y;
        car.pz = S.z;
        car.heading = S.heading;
        car.hint = S.i;
      }
      this.cars.push(car);
      made++;
    }
    return made;
  }

  /** Build the meshes once the cars are known. */
  build() {
    const byKind = new Map();
    for (const c of this.cars) byKind.set(c.kind, (byKind.get(c.kind) || 0) + 1);
    let k = 0;
    for (const [kind, n] of byKind) {
      const geo = kind === 'firetruck' ? fireEngineGeometry() : carShape(kind, KINDS[kind].colour);
      const m = instanced(geo, this.mat, n, { cast: this.shadows, receive: false, name: `ambient-${kind}` });
      // REAL MODELS: the road traffic in its real shapes, when that file is here (aircraft/real-models.js).
      wearRealVehicle(m, kind);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.userData.next = 0;
      this.meshes.set(kind, m);
      this.meshList.push(m);
      this.group.add(m);
      k++;
    }
    for (const c of this.cars) {
      const m = this.meshes.get(c.kind);
      c.slot = m.userData.next++;
      _c.set(c.tint);
      m.setColorAt(c.slot, _c);
      zero(m, c.slot);
    }
    if (this.cars.length) {
      this.proxy = instanced(this.boxGeo, this.proxyMat, this.cars.length, { cast: false, receive: false, name: 'ambient-car-proxy' });
      this.proxy.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cars.length * 3), 3);
      this.proxy.frustumCulled = false;
      for (const c of this.cars) {
        _c.set(c.tint).multiplyScalar(0.8);
        this.proxy.setColorAt(c.idx, _c);
        zero(this.proxy, c.idx);
      }
      this.group.add(this.proxy);
      // Headlights: two points a car, placed each frame for the ones in view.
      const n = this.cars.length * 2;
      this.lightPos = new Float32Array(n * 3);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(this.lightPos, 3).setUsage(THREE.DynamicDrawUsage));
      this.lights = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff3d0, size: 1.1, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
      this.lights.name = 'ambient-headlights';
      this.lights.frustumCulled = false;
      this.lights.visible = false;
      this.group.add(this.lights);
    }
    // Signal heads: a pole and a lamp per group at each signalled junction.
    const sigs = this.net.signals.filter((s) => s.lanes.length);
    if (sigs.length) {
      const pole = new Batch();
      pole.cyl(0.08, 0.1, 4.2, 0, 0, 0, 0x33373c, 6);
      pole.slab(-0.18, 0.18, 4.2, 5.0, -0.18, 0.18, 0x1c1f23);
      this.signalHeads = instanced(pole.geometry(), this.mat, sigs.length * 2, { cast: false, receive: false, name: 'ambient-signals' });
      const lamp = new THREE.BoxGeometry(0.26, 0.26, 0.26).translate(0, 4.75, 0);
      this.signalLampMat = new THREE.MeshStandardMaterial({ color: 0xff3020, emissive: 0xff3020, emissiveIntensity: 1.2 });
      this.signalLamps = instanced(lamp, this.signalLampMat, sigs.length * 2, { cast: false, receive: false, name: 'ambient-signal-lamps' });
      this.signalLamps.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sigs.length * 6), 3);
      this.signalLamps.instanceColor.setUsage(THREE.DynamicDrawUsage);
      sigs.forEach((sg, i) => {
        // One head for each direction group, 6 m off the junction on the kerb.
        for (let g = 0; g < 2; g++) {
          const x = sg.x + (g ? 6 : -6);
          const z = sg.z + (g ? -6 : 6);
          _m.makeTranslation(x, sg.y, z);
          this.signalHeads.setMatrixAt(i * 2 + g, _m);
          this.signalLamps.setMatrixAt(i * 2 + g, _m);
        }
        sg.heads = i;
      });
      this.signalHeads.instanceMatrix.needsUpdate = true;
      this.signalLamps.instanceMatrix.needsUpdate = true;
      this.signalHeads.computeBoundingSphere();
      this.signalHeads.frustumCulled = true;
      this.signalLamps.computeBoundingSphere();
      this.signalLamps.frustumCulled = true;
      this.group.add(this.signalHeads);
      this.group.add(this.signalLamps);
      this.sigs = sigs;
      this.sigState = new Int8Array(sigs.length).fill(9);
    }
    this.stats.placed = this.cars.length;
    this.visible = true;
  }

  setVisible(on) {
    this.visible = on;
    for (const m of this.meshes.values()) m.visible = on;
    if (this.proxy) this.proxy.visible = on;
    if (this.signalHeads) this.signalHeads.visible = on;
    if (this.signalLamps) this.signalLamps.visible = on;
    if (this.lights && !on) this.lights.visible = false;
  }

  /** Hide every car within r of (x, z) — an emergency scene's ground. */
  thinAround(x, z, r) {
    this.thin.push({ x, z, r });
  }

  clearThin() {
    this.thin.length = 0;
  }

  /** Red or green for a lane's stop line at this time. */
  stopAt(car, lane) {
    for (let k = 0; k < lane.stops.length; k++) {
      const st = lane.stops[k];
      const ahead = st.s - car.s;
      if (ahead < -2 || ahead > 14) continue;
      const g = signalGreen(this.net.signals[st.signal], this.t);
      if (g !== st.group) return ahead;
    }
    return -1;
  }

  /**
   * One frame. `cam` is the camera position; `night` switches the lights;
   * `player` is { x, z, heading } of the player's car on a driving map, or null.
   */
  update(dt, cam, night, player) {
    if (!this.visible || !this.cars.length) return;
    const t0 = performance.now();
    this.t += dt;
    this.frame++;
    const lanes = this.net.lanes;
    let drawn = 0;
    let proxies = 0;
    let lit = 0;
    const half = this.frame & 1;
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      if (!c.parked && c.lane >= 0) {
        const L = lanes[c.lane];
        // Speed: stop at a red, hold behind the player's car, else cruise.
        let want = c.want;
        const stop = this.stopAt(c, L);
        if (stop >= 0) want = stop > 3 ? Math.min(want, stop * 1.2) : 0;
        if (player) {
          const dx = player.x - c.px;
          const dz = player.z - c.pz;
          const d = Math.hypot(dx, dz);
          if (d < YIELD_GAP) want = 0;
          else if (d < YIELD_GAP * 2.5) {
            const h = c.heading * D2R;
            const ahead = dx * Math.sin(h) - dz * Math.cos(h);
            if (ahead > 0) want = Math.min(want, (d - YIELD_GAP) * 0.6);
          }
        }
        c.speed += Math.max(-6 * dt, Math.min(2.5 * dt, want - c.speed));
        if (c.speed < 0.05) c.speed = 0;
        c.s += c.speed * dt;
        // A junction to turn off at, now and then.
        for (let j = 0; j < L.junctions.length; j++) {
          const J = L.junctions[j];
          if (J.s <= c.s && J.s > c.s - c.speed * dt - 0.01 && this.rnd() < 0.3) {
            c.lane = J.lane;
            c.s = 0;
            c.hint = 0;
            break;
          }
        }
        const L2 = lanes[c.lane];
        if (c.s >= L2.len) {
          const nx = L2.next;
          if (nx.length) {
            const pick = nx[Math.floor(this.rnd() * nx.length)];
            c.lane = pick.lane;
            c.s = pick.s + (c.s - L2.len);
          } else {
            c.lane = L2.reverse;
            c.s = c.s - L2.len;
          }
          c.hint = 0;
        }
        const L3 = lanes[c.lane];
        sampleLane(L3, c.s, S, c.hint);
        c.hint = S.i;
        c.px = S.x;
        c.py = S.y;
        c.pz = S.z;
        c.heading = S.heading;
      }
      const dx = c.px - cam.x;
      const dz = c.pz - cam.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      c.dist = dist;
      let hidden = dist > CAR_FAR;
      if (!hidden && this.thin.length) {
        for (let k = 0; k < this.thin.length; k++) {
          const T = this.thin[k];
          if ((c.px - T.x) ** 2 + (c.pz - T.z) ** 2 < T.r * T.r) {
            hidden = true;
            break;
          }
        }
      }
      const m = this.meshes.get(c.kind);
      if (hidden) {
        if (!c.hidden) {
          zero(m, c.slot);
          zero(this.proxy, c.idx);
          c.hidden = true;
        }
        continue;
      }
      c.hidden = false;
      // Half rate far out, every frame near.
      if (dist > HALF_RATE && (i & 1) !== half && c.speed > 0) continue;
      const near = dist < CAR_NEAR;
      if (near) {
        pose(m, c.slot, c.px, c.py, c.pz, c.heading, 1, 1, 1);
        if (c.wasProxy) zero(this.proxy, c.idx);
        c.wasProxy = false;
        drawn++;
        if (night && this.lightPos) {
          const lp = lampsOf(c.kind);
          const h = c.heading * D2R;
          const sh = Math.sin(h);
          const ch = Math.cos(h);
          for (let s = -1; s <= 1; s += 2) {
            const lx = c.px + ch * lp.x * s + sh * -lp.z;
            const lz = c.pz + sh * lp.x * s - ch * -lp.z;
            this.lightPos[lit * 3] = lx;
            this.lightPos[lit * 3 + 1] = c.py + lp.y;
            this.lightPos[lit * 3 + 2] = lz;
            lit++;
          }
        }
      } else {
        const d = KINDS[c.kind];
        pose(this.proxy, c.idx, c.px, c.py, c.pz, c.heading, d.W, d.H, d.L);
        if (!c.wasProxy) zero(m, c.slot);
        c.wasProxy = true;
        proxies++;
      }
    }
    for (let k = 0; k < this.meshList.length; k++) {
      const m = this.meshList[k];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor && !m.userData.coloured) {
        m.instanceColor.needsUpdate = true;
        m.userData.coloured = true;
      }
    }
    if (this.proxy) {
      this.proxy.instanceMatrix.needsUpdate = true;
      if (!this.proxy.userData.coloured) {
        this.proxy.instanceColor.needsUpdate = true;
        this.proxy.userData.coloured = true;
      }
    }
    if (this.lights) {
      const show = night && lit > 0;
      this.lights.visible = show;
      if (show) {
        this.lights.geometry.setDrawRange(0, lit);
        this.lights.geometry.attributes.position.needsUpdate = true;
      }
    }
    // Signals: the lamp colour, written only when a phase changes.
    if (this.sigs) {
      for (let i = 0; i < this.sigs.length; i++) {
        const g = signalGreen(this.sigs[i], this.t);
        if (this.sigState[i] === g) continue;
        this.sigState[i] = g;
        for (let grp = 0; grp < 2; grp++) {
          _c.set(g === grp ? 0x30e060 : g === -1 ? 0xffb020 : 0xff3020);
          this.signalLamps.setColorAt(i * 2 + grp, _c);
        }
        this.signalLamps.instanceColor.needsUpdate = true;
      }
    }
    this.stats.drawn = drawn;
    this.stats.proxies = proxies;
    this.stats.ms = performance.now() - t0;
  }

  dispose() {
    for (const m of this.meshes.values()) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes.clear();
    if (this.proxy) {
      this.group.remove(this.proxy);
      this.proxy = null;
    }
    if (this.lights) {
      this.group.remove(this.lights);
      this.lights.geometry.dispose();
      this.lights.material.dispose();
      this.lights = null;
    }
    for (const m of [this.signalHeads, this.signalLamps]) {
      if (!m) continue;
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.signalHeads = this.signalLamps = null;
    this.boxGeo.dispose();
    this.mat.dispose();
    this.proxyMat.dispose();
    if (this.signalLampMat) this.signalLampMat.dispose();
    this.cars.length = 0;
  }
}

/** Write a pose into an instance: position, heading about Y, a scale. */
function pose(mesh, slot, x, y, z, headingDeg, sx, sy, sz) {
  if (!mesh) return;
  const h = -headingDeg * D2R;
  const c = Math.cos(h);
  const s = Math.sin(h);
  const e = _m.elements;
  e[0] = c * sx; e[1] = 0; e[2] = -s * sx; e[3] = 0;
  e[4] = 0; e[5] = sy; e[6] = 0; e[7] = 0;
  e[8] = s * sz; e[9] = 0; e[10] = c * sz; e[11] = 0;
  e[12] = x; e[13] = y; e[14] = z; e[15] = 1;
  mesh.setMatrixAt(slot, _m);
}

function zero(mesh, slot) {
  if (!mesh) return;
  const e = _m.elements;
  for (let i = 0; i < 16; i++) e[i] = 0;
  e[15] = 1;
  mesh.setMatrixAt(slot, _m);
  mesh.instanceMatrix.needsUpdate = true;
}

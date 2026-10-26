/**
 * The apron's service vehicles on their rounds: a baggage train, a fuel
 * bowser, an apron bus and a catering truck driving the loop plan.js lays
 * round the apron, one after another, at apron speed.
 *
 * The SHAPES are the airport's own (world/airport-vehicles.js — the ones the
 * crews park round every airliner) and, where the real-models file has one,
 * the real shape: the baggage tractor and its carts wear the downloaded
 * tractor and cart (aircraft/real-models.js wearRealVehicle), as the apron's
 * do, never on Low. The apron bus is drawn here: a low, wide, glass-sided
 * airside bus, white with a blue band. One InstancedMesh a kind, however many
 * drive; their beacons are one Points, flashing once a second (flash-safe:
 * render/flash-safety.js blinkLevel swells them instead with Reduce
 * flashing on).
 *
 * MANNERS. Each looks ahead along its route: anything in the way within
 * its braking distance — an aeroplane (yours or the traffic, with its
 * wingspan round it), somebody walking, the vehicle in front — and it slows
 * to a stop and waits; nothing is ever driven through.
 */

import * as THREE from '../../vendor/three.module.js';
import { Batch, vcMaterial, glowPoints } from '../../world/airport-kit.js';
import * as V from '../../world/airport-vehicles.js';
import { wearRealVehicle } from '../../aircraft/real-models.js';
import { blinkLevel } from '../../render/flash-safety.js';

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const CART_COLOURS = [0x2f5f9e, 0xd23c3c, 0x2f8f5b, 0xe9b925, 0x7d4a9e, 0xe9ecee];

/** A polyline sampled by distance, closed or open. Allocation-free sampling. */
export class Route {
  constructor(points, closed) {
    this.x = points.map((p) => p.x);
    this.y = points.map((p) => p.y || 0);
    this.z = points.map((p) => p.z);
    this.closed = !!closed;
    this.at = [0];
    let d = 0;
    const n = points.length;
    for (let i = 1; i < n; i++) {
      d += Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1], this.y[i] - this.y[i - 1]);
      this.at.push(d);
    }
    if (this.closed && n > 1) d += Math.hypot(this.x[0] - this.x[n - 1], this.z[0] - this.z[n - 1], this.y[0] - this.y[n - 1]);
    this.length = Math.max(1e-3, d);
  }

  /** Writes { x, y, z, yaw } at distance d (wrapped on a closed route, clamped on an open one). */
  sample(d, out) {
    const n = this.x.length;
    if (n === 1) {
      out.x = this.x[0];
      out.y = this.y[0];
      out.z = this.z[0];
      return out;
    }
    const L = this.length;
    const dd = this.closed ? ((d % L) + L) % L : Math.max(0, Math.min(L, d));
    let i = 0;
    const segs = this.closed ? n : n - 1;
    while (i < segs - 1 && this.at[i + 1] <= dd) i++;
    const j = (i + 1) % n;
    const a0 = this.at[i];
    const a1 = i + 1 < n ? this.at[i + 1] : L;
    const t = a1 - a0 > 1e-6 ? (dd - a0) / (a1 - a0) : 0;
    const dx = this.x[j] - this.x[i];
    const dz = this.z[j] - this.z[i];
    out.x = this.x[i] + dx * t;
    out.y = this.y[i] + (this.y[j] - this.y[i]) * t;
    out.z = this.z[i] + dz * t;
    if (dx * dx + dz * dz > 1e-8) out.yaw = Math.atan2(-dx, -dz);
    return out;
  }
}

/** The airside bus: 13.5 m, low floor, glass all down both sides, white with a blue band. */
export function apronBusGeometry() {
  const b = new Batch();
  const L = 13.5;
  const W = 2.9;
  const WHITE = 0xe9ecee;
  const BLUE = 0x1f5aa8;
  const GLASS = 0x26323d;
  const TYRE = 0x17191c;
  b.slab(-W / 2, W / 2, 0.35, 3.0, -L / 2, L / 2, WHITE);
  b.slab(-W / 2 - 0.02, W / 2 + 0.02, 0.9, 2.65, -L / 2 + 0.6, L / 2 - 0.6, GLASS);
  b.slab(-W / 2 - 0.03, W / 2 + 0.03, 0.42, 0.78, -L / 2 + 0.2, L / 2 - 0.2, BLUE);
  b.slab(-W / 2 + 0.15, W / 2 - 0.15, 1.0, 2.7, -L / 2 - 0.03, -L / 2 + 0.02, GLASS);
  b.slab(-W / 2 + 0.15, W / 2 - 0.15, 1.2, 2.7, L / 2 - 0.02, L / 2 + 0.03, GLASS);
  b.slab(-W / 2 + 0.1, W / 2 - 0.1, 3.0, 3.18, -L / 2 + 0.4, L / 2 - 0.4, 0xc9ced3);
  for (const z of [-L / 2 + 2.0, L / 2 - 2.2]) {
    for (const s of [-1, 1]) {
      const m = new THREE.Matrix4().makeRotationZ(Math.PI / 2).setPosition(s * (W / 2 - 0.25), 0.45, z);
      b.cyl(0.45, 0.45, 0.32, s * (W / 2 - 0.25), 0.45, z, TYRE, 10, { matrix: m });
    }
  }
  return b.geometry();
}

/** Each kind: its meshes (built on demand), length, and where its beacon sits. */
const KINDS = {
  baggage: { L: 3.4, beacon: [0, 2.1, 0.3], carts: 3 },
  fuelTruck: { L: 10, beacon: [0, 3.2, -3.5] },
  bus: { L: 13.5, beacon: [0, 3.35, -5.8] },
  cateringTruck: { L: 8, beacon: [0, 3.3, -3.4] },
};

export class VanFleet {
  /** `vans`: plan.js's list; `elev` the field elevation; `opts.shadows`. */
  constructor(vans, elev, { shadows = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'world-life:vans';
    this.elev = elev;
    this.t = 0;
    this.mat = vcMaterial({ roughness: 0.55, metalness: 0.25 });
    this.list = vans.map((v, i) => ({
      kind: v.kind,
      route: new Route(v.path, v.mode === 'loop'),
      // The plan's own path array: shared by every vehicle on the same loop
      // (each has its own Route over it), so "the one in front" is found by it.
      path: v.path,
      mode: v.mode,
      speed: v.speed,
      v: v.speed,
      d: v.d0 || 0,
      dir: 1,
      wait: 0,
      yielding: false,
      pos: { x: 0, y: 0, z: 0, yaw: 0 },
      i,
    }));
    const count = (k) => this.list.filter((v) => v.kind === k).length;
    this.geos = [];
    const mk = (geo, n, name, realKind) => {
      this.geos.push(geo);
      const m = new THREE.InstancedMesh(geo, this.mat, Math.max(1, n));
      m.name = name;
      m.count = n;
      m.castShadow = shadows;
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      if (realKind) wearRealVehicle(m, realKind);
      this.group.add(m);
      return m;
    };
    this.meshes = {};
    const nb = count('baggage');
    if (nb) {
      this.meshes.tractor = mk(V.baggageTractorGeometry(), nb, 'life:tractor', 'tractor');
      this.meshes.cart = mk(V.baggageCartGeometry(), nb * KINDS.baggage.carts, 'life:cart', 'cart');
      for (let i = 0; i < nb * KINDS.baggage.carts; i++) this.meshes.cart.setColorAt(i, _c.set(CART_COLOURS[(i * 2 + 1) % CART_COLOURS.length]));
    }
    if (count('fuelTruck')) this.meshes.fuelTruck = mk(V.fuelTruckGeometry(), count('fuelTruck'), 'life:fuel');
    if (count('bus')) this.meshes.bus = mk(apronBusGeometry(), count('bus'), 'life:bus');
    if (count('cateringTruck')) {
      this.meshes.cateringTruck = mk(V.cateringTruckGeometry(), count('cateringTruck'), 'life:catering');
      this.meshes.cateringBox = mk(V.cateringBoxGeometry(), count('cateringTruck'), 'life:catering-box');
    }
    // Beacons: one glow each, hidden until they flash.
    const pos = new Array(this.list.length * 3).fill(0);
    const col = [];
    for (let i = 0; i < this.list.length; i++) col.push(1, 0.62, 0.12);
    this.beacons = this.list.length ? glowPoints(pos, col, 1.9, { opacity: 0.9, name: 'life:beacons' }) : null;
    if (this.beacons) {
      this.beacons.geometry.attributes.position.setUsage(THREE.DynamicDrawUsage);
      this.beacons.frustumCulled = false;
      this.group.add(this.beacons);
    }
    // Slots per kind.
    const next = {};
    for (const v of this.list) {
      v.slot = next[v.kind] || 0;
      next[v.kind] = v.slot + 1;
    }
    this._a = { x: 0, y: 0, z: 0, yaw: 0 };
    this.stats = { yields: 0 };
    this.step(0, [], []);
  }

  /**
   * Drive them. `aircraft`: [{ x, z, r }] — every aeroplane about, with its
   * keep-clear radius; `people`: the walkers [{ x, z, hidden }].
   */
  step(dt, aircraft, people, night = false) {
    this.t += dt;
    const a = this._a;
    for (const v of this.list) {
      // Look ahead: the next 6 + v² / 2a metres of the route (braking at 2 m/s²) and the vehicle's own length.
      const look = 6 + (v.speed * v.speed) / 4 + KINDS[v.kind].L / 2;
      let blocked = false;
      for (let k = 1; k <= 3 && !blocked; k++) {
        v.route.sample(v.d + v.dir * look * (k / 3), a);
        for (const c of aircraft) {
          if (Math.hypot(a.x - c.x, a.z - c.z) < c.r) {
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          for (const p of people) {
            if (p.hidden) continue;
            if (Math.abs(a.x - p.x) < 2.6 && Math.abs(a.z - p.z) < 2.6) {
              blocked = true;
              break;
            }
          }
        }
        if (!blocked) {
          for (const o of this.list) {
            if (o === v) continue;
            const gap = v.route.closed ? (((o.d - v.d) % v.route.length) + v.route.length) % v.route.length : (o.d - v.d) * v.dir;
            if (o.path === v.path && gap > 0 && gap < look + KINDS[o.kind].L / 2 + 6) {
              blocked = true;
              break;
            }
          }
        }
      }
      if (blocked && !v.yielding) this.stats.yields++;
      v.yielding = blocked;
      const want = blocked ? 0 : v.speed;
      // 2 m/s² either way.
      v.v = v.v < want ? Math.min(want, v.v + 2 * dt) : Math.max(want, v.v - 2.5 * dt);
      if (v.mode === 'pingpong') {
        if (v.wait > 0) {
          v.wait -= dt;
        } else {
          v.d += v.dir * v.v * dt;
          if (v.d >= v.route.length || v.d <= 0) {
            v.d = Math.max(0, Math.min(v.route.length, v.d));
            v.dir = -v.dir;
            v.wait = 8;
          }
        }
      } else {
        v.d += v.v * dt;
      }
      v.route.sample(v.d, v.pos);
      if (v.mode === 'pingpong' && v.dir < 0) v.pos.yaw += Math.PI;
      this.place(v);
    }
    // Beacons: once a second, brighter at night.
    if (this.beacons) {
      const lit = blinkLevel(this.t, 1, 0.45);
      this.beacons.visible = lit > 0.01;
      this.beacons.material.opacity = (night ? 1 : 0.75) * lit;
      this.beacons.geometry.attributes.position.needsUpdate = true;
    }
    for (const m of Object.values(this.meshes)) m.instanceMatrix.needsUpdate = true;
  }

  place(v) {
    const y = this.elev;
    const p = v.pos;
    const set = (mesh, slot, x, z, yaw, yy = y) => {
      _q.setFromAxisAngle(UP, yaw);
      _p.set(x, yy, z);
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(slot, _m);
    };
    const b = KINDS[v.kind].beacon;
    if (v.kind === 'baggage') {
      set(this.meshes.tractor, v.slot, p.x, p.z, p.yaw);
      const a = this._a;
      for (let i = 0; i < KINDS.baggage.carts; i++) {
        v.route.sample(v.d - v.dir * (3.1 + i * 2.9), a);
        set(this.meshes.cart, v.slot * KINDS.baggage.carts + i, a.x, a.z, v.mode === 'pingpong' && v.dir < 0 ? a.yaw + Math.PI : a.yaw);
      }
    } else if (v.kind === 'cateringTruck') {
      set(this.meshes.cateringTruck, v.slot, p.x, p.z, p.yaw);
      set(this.meshes.cateringBox, v.slot, p.x, p.z, p.yaw, y + V.CATER_BED_Y + 0.15);
    } else {
      set(this.meshes[v.kind], v.slot, p.x, p.z, p.yaw);
    }
    if (this.beacons) {
      const s = Math.sin(p.yaw);
      const c = Math.cos(p.yaw);
      const attr = this.beacons.geometry.attributes.position;
      attr.setXYZ(v.i, p.x + c * b[0] + s * b[2], y + b[1], p.z - s * b[0] + c * b[2]);
    }
  }

  setVisible(v) {
    this.group.visible = !!v;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    // Our own shapes, and the copy of a real one a mesh was given in their place.
    for (const m of Object.values(this.meshes)) {
      if (m.userData && m.userData.realVehicle && m.geometry) m.geometry.dispose();
      m.dispose && m.dispose();
    }
    for (const g of this.geos) g.dispose();
    this.mat.dispose();
    if (this.beacons) {
      this.beacons.geometry.dispose();
    }
  }
}

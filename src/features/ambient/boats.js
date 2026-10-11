/**
 * The ambient boats: ferries, trawlers, yachts, barges, lifeboats, RHIBs,
 * supply and patrol boats and dive boats, one InstancedMesh per kind, on the
 * routes ../ambient/lanes.js worked out in deep water.
 *
 * They bob and roll on the swell, hold 60 m off a marked channel (the route
 * does; see lanes.js), stop while the player's boat is within 150 m, and are
 * never solid. The same flat arrays and scratch matrix as the cars: nothing
 * allocated per frame.
 */

import * as THREE from '../../vendor/three.module.js';
import { Batch, instanced } from '../../world/airport-kit.js';
import { sampleLane } from './lanes.js';
import { makeRandom } from '../../core/noise.js';

/** A boat stops while the player's boat is within this. */
export const BOAT_HOLD = 150;
/** Metres: the full shape up to here; a hull box beyond, nothing past CAR_FAR-like 2.5 km. */
export const BOAT_FAR = 2500;

const D2R = Math.PI / 180;
const _m = new THREE.Matrix4();
const S = { x: 0, y: 0, z: 0, i: 0, heading: 0 };

/** Length (along -Z, the bow), beam, speed m/s, hull colour. */
export const KINDS = Object.freeze({
  ferry: { L: 34, W: 8.5, speed: 7, hull: 0x1f3f6e, draught: 1.2 },
  trawler: { L: 16, W: 5, speed: 3.5, hull: 0x9a2a22, draught: 0.9 },
  yacht: { L: 12, W: 3.6, speed: 3, hull: 0xeeeeea, draught: 0.5 },
  barge: { L: 28, W: 7, speed: 2.5, hull: 0x3a3a3c, draught: 0.8 },
  lifeboat: { L: 14, W: 4.4, speed: 9, hull: 0xf07a1c, draught: 0.7 },
  rhib: { L: 8, W: 2.8, speed: 11, hull: 0x2a2f36, draught: 0.3 },
  supply: { L: 30, W: 8, speed: 5, hull: 0xd14a1f, draught: 1.3 },
  patrol: { L: 22, W: 5.5, speed: 8, hull: 0x5a6670, draught: 0.9 },
  dive: { L: 10, W: 3.4, speed: 5, hull: 0x2f8ac8, draught: 0.5 },
});

function hull(b, L, W, D, colour, y0) {
  // A pointed bow: the box, and a wedge at the front made of two slabs.
  b.slab(-W / 2, W / 2, y0, y0 + D, -L / 2 + L * 0.22, L / 2, colour);
  for (let k = 0; k < 4; k++) {
    const t = k / 4;
    const w = (W / 2) * (1 - t * 0.85);
    const z0 = -L / 2 + L * 0.22 * (1 - (k + 1) / 4);
    const z1 = -L / 2 + L * 0.22 * (1 - k / 4);
    b.slab(-w, w, y0, y0 + D, z0, z1, colour);
  }
}

function boatShape(k) {
  const d = KINDS[k];
  const b = new Batch();
  const white = 0xf2f4f0;
  const dark = 0x1f2429;
  const glass = 0x28323c;
  const L = d.L;
  const W = d.W;
  hull(b, L, W, L * 0.1, d.hull, -0.2);
  if (k === 'ferry') {
    b.slab(-W / 2 + 0.3, W / 2 - 0.3, L * 0.1 - 0.2, L * 0.1 + 3.0, -L / 2 + 6, L / 2 - 2, white);
    b.slab(-W / 2 + 0.6, W / 2 - 0.6, L * 0.1 + 3.0, L * 0.1 + 5.6, -L / 2 + 9, L / 2 - 4, white);
    b.slab(-W / 2 + 0.28, W / 2 - 0.28, L * 0.1 + 1.2, L * 0.1 + 2.0, -L / 2 + 6.2, L / 2 - 2.2, glass);
    b.slab(-W / 2 + 0.9, W / 2 - 0.9, L * 0.1 + 5.6, L * 0.1 + 7.8, -L / 2 + 8, -L / 2 + 12, white); // bridge
    b.slab(-1.0, 1.0, L * 0.1 + 5.6, L * 0.1 + 9.4, L / 2 - 9, L / 2 - 7, d.hull); // funnel
  } else if (k === 'trawler' || k === 'supply' || k === 'patrol') {
    const h0 = L * 0.1 - 0.2;
    b.slab(-W / 2 + 0.4, W / 2 - 0.4, h0, h0 + 2.6, -L / 2 + L * 0.25, -L / 2 + L * 0.55, k === 'patrol' ? 0x8a949c : white);
    b.slab(-W / 2 + 0.42, W / 2 - 0.42, h0 + 1.5, h0 + 2.3, -L / 2 + L * 0.25 - 0.02, -L / 2 + L * 0.55, glass);
    b.cyl(0.12, 0.14, 7, -W / 4, h0 + 2.6, -L / 2 + L * 0.45, 0xb8bcc0, 6); // mast
    if (k === 'supply') b.slab(-W / 2 + 0.5, W / 2 - 0.5, h0, h0 + 0.6, -L / 2 + L * 0.6, L / 2 - 1, 0x2a2f36); // the open deck
    if (k === 'trawler') b.slab(-0.9, 0.9, h0, h0 + 1.0, L * 0.1, L * 0.3, 0xf0a030); // fish boxes
  } else if (k === 'yacht') {
    b.slab(-W / 2 + 0.4, W / 2 - 0.4, L * 0.1 - 0.2, L * 0.1 + 0.8, -L / 2 + 3, L / 2 - 3, 0xe8e2d0);
    b.cyl(0.08, 0.1, 15, 0.4, L * 0.1 + 0.8, -L / 2 + 5, 0xd0d0d0, 5);
    b.tri([0.5, L * 0.1 + 1.6, -L / 2 + 5], [0.5, L * 0.1 + 15, -L / 2 + 5], [0.5, L * 0.1 + 1.6, L / 2 - 2], [0, 0], [0, 1], [1, 0], 0xf8f8f4);
  } else if (k === 'barge') {
    b.slab(-W / 2 + 0.3, W / 2 - 0.3, L * 0.1 - 0.2, L * 0.1 + 1.6, -L / 2 + 2, L / 2 - 6, 0x6a5a3a); // the load
    b.slab(-W / 2 + 0.6, W / 2 - 0.6, L * 0.1 - 0.2, L * 0.1 + 3.4, L / 2 - 5.5, L / 2 - 1, white); // the wheelhouse aft
  } else if (k === 'lifeboat') {
    b.slab(-W / 2 + 0.4, W / 2 - 0.4, L * 0.1 - 0.2, L * 0.1 + 2.4, -L / 2 + 4, L / 2 - 3, 0x2a4a8a);
    b.slab(-W / 2 + 0.42, W / 2 - 0.42, L * 0.1 + 1.2, L * 0.1 + 2.0, -L / 2 + 3.98, L / 2 - 3, glass);
    b.slab(-0.2, 0.2, L * 0.1 + 2.4, L * 0.1 + 4.4, 0, 0.4, 0xd0d0d0);
  } else if (k === 'rhib') {
    b.cyl(0.45, 0.45, L - 1, 0, 0, 0, 0x3a3f46, 8, { rx: Math.PI / 2 }); // the tube
    b.slab(-0.5, 0.5, 0.3, 1.2, -1, 1.5, dark);
  } else {
    b.slab(-W / 2 + 0.4, W / 2 - 0.4, L * 0.1 - 0.2, L * 0.1 + 2.0, -L / 2 + 3, L / 2 - 2.5, white);
    b.slab(-W / 2 + 0.42, W / 2 - 0.42, L * 0.1 + 1.0, L * 0.1 + 1.7, -L / 2 + 2.98, L / 2 - 2.5, glass);
  }
  return b.geometry();
}

export class BoatLayer {
  /** `shadows`: as the cars — off below High, where the shadow pass would draw each hull again. */
  constructor(group, { shadows = true } = {}) {
    this.group = group;
    this.shadows = !!shadows;
    this.boats = []; // { kind, route, s, dir, speed, want, phase, px, pz, heading, slot }
    this.meshes = new Map();
    this.meshList = [];
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.08, side: THREE.DoubleSide });
    this.rnd = makeRandom(53);
    this.t = 0;
    this.thin = [];
    this.stats = { placed: 0, drawn: 0, ms: 0 };
    this.visible = true;
  }

  /** `count` boats of `kind` on `route` (routeArrays()'s shape). */
  populate(kind, count, route) {
    if (!KINDS[kind] || !route || !(route.len > 20) || count <= 0) return 0;
    for (let k = 0; k < count; k++) {
      const b = { kind, route, s: ((k + 0.3) / count) * route.len, dir: 1, speed: KINDS[kind].speed, want: KINDS[kind].speed, phase: this.rnd() * 6, px: 0, pz: 0, heading: 0, hint: 0, idx: this.boats.length, hidden: false };
      b.speed *= 0.85 + this.rnd() * 0.3;
      b.want = b.speed;
      sampleLane(route, b.s, S, 0);
      b.px = S.x;
      b.pz = S.z;
      b.heading = S.heading;
      this.boats.push(b);
    }
    return count;
  }

  build() {
    const byKind = new Map();
    for (const b of this.boats) byKind.set(b.kind, (byKind.get(b.kind) || 0) + 1);
    for (const [kind, n] of byKind) {
      const m = instanced(boatShape(kind), this.mat, n, { cast: this.shadows, receive: false, name: `ambient-boat-${kind}` });
      m.frustumCulled = false;
      m.userData.next = 0;
      this.meshes.set(kind, m);
      this.meshList.push(m);
      this.group.add(m);
    }
    for (const b of this.boats) {
      const m = this.meshes.get(b.kind);
      b.slot = m.userData.next++;
    }
    this.stats.placed = this.boats.length;
  }

  setVisible(on) {
    this.visible = on;
    for (const m of this.meshes.values()) m.visible = on;
  }

  thinAround(x, z, r) {
    this.thin.push({ x, z, r });
  }

  clearThin() {
    this.thin.length = 0;
  }

  /** `player` is { x, z } of the player's boat, or null; `swell` 0..1 from the weather. */
  update(dt, cam, player, swell = 0) {
    if (!this.visible || !this.boats.length) return;
    const t0 = performance.now();
    this.t += dt;
    let drawn = 0;
    for (let i = 0; i < this.boats.length; i++) {
      const b = this.boats[i];
      const R = b.route;
      let want = b.want;
      if (player && Math.hypot(player.x - b.px, player.z - b.pz) < BOAT_HOLD) want = 0;
      b.speed += Math.max(-1.5 * dt, Math.min(0.6 * dt, want - b.speed));
      if (b.speed < 0.02) b.speed = 0;
      b.s += b.speed * b.dir * dt;
      if (R.loop) {
        if (b.s >= R.len) b.s -= R.len;
        if (b.s < 0) b.s += R.len;
      } else if (b.s >= R.len) {
        b.s = R.len - (b.s - R.len);
        b.dir = -1;
      } else if (b.s <= 0) {
        b.s = -b.s;
        b.dir = 1;
      }
      sampleLane(R, b.s, S, b.hint);
      b.hint = S.i;
      b.px = S.x;
      b.pz = S.z;
      // Turn gently onto the leg's heading rather than snapping at a corner.
      const want_h = b.dir > 0 ? S.heading : S.heading + 180;
      let dh = ((want_h - b.heading + 540) % 360) - 180;
      const maxTurn = 40 * dt;
      dh = Math.max(-maxTurn, Math.min(maxTurn, dh));
      b.heading = (b.heading + dh + 360) % 360;
      const m = this.meshes.get(b.kind);
      const dist = Math.hypot(b.px - cam.x, b.pz - cam.z);
      let hidden = dist > BOAT_FAR;
      if (!hidden) for (let k = 0; k < this.thin.length; k++) if ((b.px - this.thin[k].x) ** 2 + (b.pz - this.thin[k].z) ** 2 < this.thin[k].r ** 2) hidden = true;
      if (hidden) {
        if (!b.hidden) {
          zero(m, b.slot);
          b.hidden = true;
        }
        continue;
      }
      b.hidden = false;
      const bob = Math.sin(this.t * 1.1 + b.phase) * 0.3 * (1 + swell);
      const roll = Math.sin(this.t * 0.8 + b.phase) * 0.045 * (1 + swell);
      pose(m, b.slot, b.px, bob, b.pz, b.heading, roll);
      drawn++;
    }
    for (let k = 0; k < this.meshList.length; k++) this.meshList[k].instanceMatrix.needsUpdate = true;
    this.stats.drawn = drawn;
    this.stats.ms = performance.now() - t0;
  }

  dispose() {
    for (const m of this.meshes.values()) {
      this.group.remove(m);
      m.geometry.dispose();
    }
    this.meshes.clear();
    this.mat.dispose();
    this.boats.length = 0;
  }
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3(1, 1, 1);
function pose(mesh, slot, x, y, z, headingDeg, roll) {
  if (!mesh) return;
  _e.set(0, -headingDeg * D2R, roll, 'YXZ');
  _q.setFromEuler(_e);
  _p.set(x, y, z);
  _m.compose(_p, _q, _s);
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

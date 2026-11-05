/**
 * What comes out of a ditched aeroplane: inflated rafts and slides at an
 * airliner's doors, a raft (and people on a low wing) beside a light
 * aeroplane, one dinghy beside a fast jet, and whoever comes for them. No
 * more than four draw calls, instanced and pooled; loaded only when an
 * aeroplane is going to meet the sea (../ditching.js loadScene).
 */

import * as THREE from '../../vendor/three.module.js';
import { Batch, instanced } from '../../world/airport-kit.js';
import { createBoat } from '../../vehicles/models.js';
import { heightAt } from '../../world/terrain.js';
import { createAircraftModel } from '../../aircraft/model-adapter.js';
import { getAircraft } from '../../aircraft/types.js';

const NONE = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _w = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const UP = new THREE.Vector3(0, 1, 0);
const TUBE = 0xd9a425; // slide-raft yellow
const TUBE2 = 0xa89a78; // its grey upper tube
const FLOOR = 0x4f5459;
const DINGHY = 0xd9692a;
/** A slide-raft's length against its size, and its width against its length. */
export const RAFT_LENGTH = 1.3;

/** A rubber tube swept round a stadium (long axis z): `len` by `wid`, tube radius `r`. */
function stadiumTube(len, wid, r, ends = 6, radial = 6) {
  const b = wid / 2;
  const c = len / 2 - b;
  const path = [];
  for (let i = 0; i <= ends; i++) {
    const a = (i / ends) * Math.PI;
    path.push([Math.cos(a), Math.sin(a), c]);
  }
  for (let i = 0; i <= ends; i++) {
    const a = Math.PI + (i / ends) * Math.PI;
    path.push([Math.cos(a), Math.sin(a), -c]);
  }
  const pos = [];
  const nrm = [];
  const idx = [];
  path.forEach(([nx, nz, zc], i) => {
    for (let j = 0; j < radial; j++) {
      const f = (j / radial) * Math.PI * 2;
      const out = Math.cos(f);
      const up = Math.sin(f);
      pos.push(nx * (b + r * out), r * up, zc + nz * (b + r * out));
      nrm.push(nx * out, up, nz * out);
      const i2 = (i + 1) % path.length;
      const j2 = (j + 1) % radial;
      idx.push(i * radial + j, i2 * radial + j2, i2 * radial + j, i * radial + j, i * radial + j2, i2 * radial + j2);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function stadiumFloor(len, wid) {
  const b = wid / 2;
  const c = len / 2 - b;
  const sh = new THREE.Shape();
  sh.absarc(0, c, b, 0, Math.PI, false);
  sh.absarc(0, -c, b, Math.PI, Math.PI * 2, false);
  sh.closePath();
  return new THREE.ShapeGeometry(sh, 5).rotateX(-Math.PI / 2);
}

/**
 * A slide-raft, one metre long before scaling (RAFT_LENGTH x its size): the
 * long twin yellow-and-grey tubes of the real thing, a dark floor, open to the
 * sky, with its long axis running out from the door.
 */
function raftGeometry() {
  const b = new Batch();
  const low = stadiumTube(1, 0.42, 0.038);
  const high = stadiumTube(0.97, 0.39, 0.03);
  const floor = stadiumFloor(0.98, 0.4);
  b.add(low, _m.identity().makeTranslation(0, 0.038, 0), TUBE);
  b.add(high, _m.identity().makeTranslation(0, 0.1, 0), TUBE2);
  b.add(floor, _m.identity().makeTranslation(0, 0.03, 0), FLOOR);
  for (const g of [low, high, floor]) g.dispose();
  return b.geometry();
}

/** A round four-seat raft, one metre across before scaling, for a light aeroplane or a dinghy for a fast jet. */
function openRaftGeometry() {
  const b = new Batch();
  const ring = new THREE.TorusGeometry(0.4, 0.1, 6, 14).rotateX(Math.PI / 2);
  b.add(ring, _m.identity().makeTranslation(0, 0.1, 0), DINGHY);
  b.add(new THREE.CircleGeometry(0.42, 14).rotateX(-Math.PI / 2), _m.identity().makeTranslation(0, 0.05, 0), FLOOR);
  ring.dispose();
  return b.geometry();
}

/** Somebody in a lifejacket, seen from a distance: 1.7 m standing, sliced at the water when seated. */
function personGeometry() {
  const b = new Batch();
  for (const side of [-1, 1]) {
    b.cyl(0.07, 0.08, 0.84, side * 0.095, 0, 0, 0x28303a, 5); // a leg
    b.cyl(0.05, 0.055, 0.56, side * 0.235, 0.82, 0, 0x3a4048, 5); // an arm
  }
  b.cyl(0.17, 0.16, 0.56, 0, 0.82, 0, 0x3a4048, 6);
  b.cyl(0.205, 0.195, 0.34, 0, 1.03, 0, 0xe0902a, 6); // the jacket
  const head = new THREE.SphereGeometry(0.11, 8, 6);
  b.add(head, _m.identity().makeTranslation(0, 1.54, 0), 0xc9a07e);
  head.dispose();
  return b.geometry();
}

/** A slide, 1.7 m wide and one metre long before scaling: two round rails and the lane between them. */
function slideGeometry() {
  const b = new Batch();
  const rail = new THREE.CylinderGeometry(0.21, 0.21, 1, 8).rotateX(Math.PI / 2);
  for (const side of [-1, 1]) b.add(rail, _m.identity().makeTranslation(side * 0.64, 0.21, 0), TUBE);
  b.slab(-0.64, 0.64, 0.08, 0.14, -0.5, 0.5, TUBE2);
  rail.dispose();
  return b.geometry();
}

export class DitchScene {
  constructor(scene, { low = false } = {}) {
    this.scene = scene;
    this.low = low;
    this.mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0, side: THREE.DoubleSide });
    this.RAFTS = low ? 4 : 8;
    this.PEOPLE = low ? 14 : 36;
    this.group = new THREE.Group();
    this.group.name = 'ditching';
    this.rafts = instanced(raftGeometry(), this.mat, this.RAFTS, { cast: false, receive: false, name: 'ditch-rafts' });
    this.dinghy = instanced(openRaftGeometry(), this.mat, 2, { cast: false, receive: false, name: 'ditch-dinghy' });
    this.slides = instanced(slideGeometry(), this.mat, this.RAFTS, { cast: false, receive: false, name: 'ditch-slides' });
    this.people = instanced(personGeometry(), this.mat, this.PEOPLE, { cast: false, receive: false, name: 'ditch-people' });
    this.group.add(this.rafts, this.dinghy, this.slides, this.people);
    this.group.visible = false;
    scene.add(this.group);
    this.hide();
    this.plan = null;
    this.rescue = null;
    this.t = 0;
  }

  hide() {
    for (const m of [this.rafts, this.slides, this.people]) {
      for (let i = 0; i < m.count; i++) m.setMatrixAt(i, NONE);
      m.instanceMatrix.needsUpdate = true;
    }
    for (let i = 0; i < 2; i++) this.dinghy.setMatrixAt(i, NONE);
    this.dinghy.instanceMatrix.needsUpdate = true;
  }

  /**
   * Plan it, once, at rest: where every raft, slide and person goes, in the
   * aeroplane's frame as it lay when it stopped. `info`:
   * { cls, ac, model, type, belly, seed }.
   */
  deploy(info) {
    const { cls, ac, model, type } = info;
    const rafts = [];
    const people = [];
    const halfW = Math.max(1.1, Math.abs(info.belly) * 1.05);
    const plan = type.plan || { nose: -6, tail: 6, span: 12 };
    const s = (type.shape && type.shape.scale) || 1;
    if (cls === 'airliner') {
      const list = ((model && model.userData.doors && model.userData.doors.list) || []).filter((d) => d.kind !== 'overwing' && d.deck !== 'upper' && d.kind !== 'cargo');
      const doors = [];
      const wanted = this.low ? 2 : 4;
      for (const side of [-1, 1]) {
        const own = list.filter((d) => Math.sign(d.x) === side).sort((a, b) => a.z - b.z);
        const pick = own.length ? own : [{ x: side * halfW, y: 0.1, z: plan.nose * 0.68, sill: -halfW * 0.4 }, { x: side * halfW, y: 0.1, z: plan.tail * 0.62, sill: -halfW * 0.4 }];
        const step = Math.max(1, (pick.length - 1) / (wanted - 1 || 1));
        for (let i = 0, n = Math.min(wanted, pick.length); i < n; i++) doors.push(pick[Math.round(i * step)]);
      }
      const big = Math.min(5.5, 3 + plan.span / 24);
      const long = big * RAFT_LENGTH;
      for (const d of doors.slice(0, this.RAFTS)) {
        const side = Math.sign(d.x) || 1;
        const sillY = (d.y ?? 0) + (d.sill ?? 0) * 0.7;
        // The lane runs out from the sill about twice as far as the door stands above the water.
        const lane = 1.5 + Math.max(0, sillY + info.floatY) * 1.6;
        rafts.push({ x: d.x + side * (lane + long * 0.5), y: 0, z: d.z, size: big, long, kind: 'canopy', door: [d.x, sillY, d.z], side, start: 2 + rafts.length * 1.1, seats: 0 });
      }
      // People on the wing at the overwing exits: what everybody remembers from the
      // pictures. A high wing has no such thing. From the root to the tip it climbs by its dihedral.
      const rootY = (type.shape.wingY ?? -0.4) * s;
      if (rootY < 0) {
        const tip = info.tip || { x: plan.span / 2, y: rootY };
        const onWing = (x) => rootY + 0.12 + (Math.abs(x) / Math.max(1, Math.abs(tip.x))) * (tip.y - rootY);
        for (const side of [-1, 1]) {
          for (let i = 0, n = this.low ? 1 : 3; i < n; i++) {
            const x = side * (halfW + 1.2 + i * 1.1);
            people.push({ on: 'ac', x, y: onWing(x), z: (type.shape.wingZ ?? 0) * s + 0.8 + i * 0.5, at: 6 + i * 1.3 });
          }
        }
      }
    } else if (cls === 'light') {
      const low = (type.shape.wingY ?? 0) < 0;
      const side = 1;
      rafts.push({ x: side * (halfW + 3), y: 0, z: 0.2, size: 2.2, kind: 'open', door: null, side, start: 3, seats: 0 });
      if (low) {
        for (const sd of [-1, 1]) people.push({ on: 'ac', x: sd * (halfW + 1.4), y: (type.shape.wingY ?? -0.4) * s + 0.1, z: 0.4, at: sd > 0 ? 3 : 4.5 });
      }
    } else {
      rafts.push({ x: halfW + 3.2, y: 0, z: plan.nose * 0.3, size: 1.5, kind: 'open', door: null, side: 1, start: 5, seats: 0 });
    }

    // Fill the rafts up to the pool, front ones first. Seated, a person shows from the chest up.
    const seats = cls === 'airliner' ? 4 : cls === 'light' ? 3 : 1;
    for (let k = 0; k < seats; k++) {
      for (let r = 0; r < rafts.length; r++) {
        const R = rafts[r];
        if (people.length >= this.PEOPLE) break;
        const a = (k / seats) * Math.PI * 2 + r;
        // Along the raft (out from the door) and across it, then into the world's frame.
        const along = R.long ? R.long * 0.3 : R.size * 0.24;
        const across = R.long ? R.long * 0.11 : R.size * 0.24;
        _v.set(Math.cos(a) * along, 0, Math.sin(a) * across).applyQuaternion(ac.quat);
        people.push({ on: 'raft', raft: r, x: _v.x, y: -0.72, z: _v.z, at: R.start + 2.5 + k * 1.6 });
      }
    }
    // Round the wing root, not in it: the raft is put where the water is clear of the aeroplane's own frame.
    _v.set(1, 0, 0).applyQuaternion(ac.quat);
    this.plan = { rafts, people, yaw: Math.atan2(_v.x, _v.z), base: { pos: ac.pos.clone(), quat: ac.quat.clone() } };
    this.group.visible = true;
    this.t = 0;
    return this.plan;
  }

  /** `depth` how far the aeroplane has settled (metres, 0 afloat), `time` seconds since it stopped. */
  update(dt, ac, time, depth, sunk) {
    const P = this.plan;
    if (!P) return;
    this.t += dt;
    const base = P.base;
    let nr = 0;
    let nd = 0;
    let ns = 0;
    for (let i = 0; i < P.rafts.length; i++) {
      const R = P.rafts[i];
      const k = THREE.MathUtils.clamp((time - R.start) / 1.6, 0, 1);
      const open = k * k * (3 - 2 * k);
      // Cut loose once the door has gone under, and drifting off.
      const drift = R.door && depth > 1 ? Math.min(14, (depth - 1) * 1.6) : 0;
      _v.set(R.x + R.side * drift * 0.8, 0, R.z).applyQuaternion(base.quat).add(base.pos);
      _v.y = 0.02 + Math.sin(this.t * 1.1 + i * 1.7) * 0.07;
      R.wx = _v.x;
      R.wz = _v.z;
      R.wy = _v.y;
      // A slide-raft lies along the line of its slide, out from the door.
      _e.set(Math.sin(this.t * 0.9 + i) * 0.03, P.yaw, Math.cos(this.t * 0.8 + i) * 0.03);
      _q.setFromEuler(_e);
      const o = Math.max(0.05, open);
      _s.setScalar((R.long || R.size) * o);
      _m.compose(_v, _q, _s);
      if (time < R.start) _m.copy(NONE);
      if (R.kind === 'canopy') this.rafts.setMatrixAt(nr++, _m);
      else if (nd < 2) this.dinghy.setMatrixAt(nd++, _m);
      if (R.door && ns < this.RAFTS) {
        // The slide: door sill to the raft's near edge. Off once the door is awash.
        if (time < R.start || depth > 1 || sunk) {
          this.slides.setMatrixAt(ns++, NONE);
        } else {
          _w.set(R.door[0], R.door[1], R.door[2]).applyQuaternion(ac.quat).add(ac.pos);
          // To the raft's near end, not its middle.
          const cx = _v.x - _w.x;
          const cz = _v.z - _w.z;
          const c = Math.hypot(cx, cz) || 1;
          const len = Math.max(0.5, c - (R.long || 0) * 0.48);
          const dx = (cx / c) * len;
          const dz = (cz / c) * len;
          const dy = 0.12 - _w.y;
          const L = Math.hypot(len, dy);
          _s.set(1, 1, L * open);
          _e.set(Math.atan2(-dy, len), Math.atan2(dx, dz), 0);
          _q.setFromEuler(_e);
          _v.set(_w.x + dx * 0.5 * open, _w.y + dy * 0.5 * open, _w.z + dz * 0.5 * open);
          _m.compose(_v, _q, _s);
          this.slides.setMatrixAt(ns++, _m);
        }
      }
    }
    for (let i = nr; i < this.RAFTS; i++) this.rafts.setMatrixAt(i, NONE);
    for (let i = nd; i < 2; i++) this.dinghy.setMatrixAt(i, NONE);
    for (let i = ns; i < this.RAFTS; i++) this.slides.setMatrixAt(i, NONE);
    let np = 0;
    for (let i = 0; i < P.people.length && np < this.PEOPLE; i++) {
      const q = P.people[i];
      if (time < q.at) continue;
      if (q.on === 'raft') {
        const R = P.rafts[q.raft];
        _v.set(R.wx + q.x, R.wy + q.y, R.wz + q.z);
        _s.set(1, 1, 1);
        _q.identity();
      } else {
        // On a wing: they stay until it is awash, then they are in the water with a jacket on; the raft has them.
        if (depth > Math.max(0.4, q.y + 0.9)) continue;
        _v.set(q.x, q.y, q.z).applyQuaternion(ac.quat).add(ac.pos);
        _s.set(1, 1, 1);
        _q.copy(ac.quat);
      }
      _m.compose(_v, _q, _s);
      this.people.setMatrixAt(np++, _m);
    }
    for (let i = np; i < this.PEOPLE; i++) this.people.setMatrixAt(i, NONE);
    this.rafts.instanceMatrix.needsUpdate = true;
    this.dinghy.instanceMatrix.needsUpdate = true;
    this.slides.instanceMatrix.needsUpdate = true;
    this.people.instanceMatrix.needsUpdate = true;
    if (this.rescue) this.updateRescue(dt);
  }

  /**
   * Somebody coming. `kind` 'boat' or 'heli', from `from` to `to` (world
   * x, z), arriving `eta` seconds from now.
   */
  callRescue(kind, from, to, eta, seaFx, weather) {
    if (this.rescue) return;
    let model = null;
    if (kind === 'boat') {
      model = createBoat();
      model.name = 'rescue-boat';
    } else {
      model = createAircraftModel({ type: getAircraft('aw139'), landingLight: false });
      model.name = 'rescue-heli';
    }
    this.scene.add(model);
    this.rescue = { kind, model, from, to, eta, t: 0, spin: 0, seaFx, weather, wakeT: 0, h: Math.atan2(to.x - from.x, -(to.z - from.z)) };
    this.placeRescue(0);
  }

  placeRescue(dt) {
    const r = this.rescue;
    r.t += dt;
    const k = Math.min(1, r.t / r.eta);
    // Fast, then slowing the last hundred metres, the way a coxswain comes alongside.
    const e = 1 - (1 - k) * (1 - k);
    const x = r.from.x + (r.to.x - r.from.x) * e;
    const z = r.from.z + (r.to.z - r.from.z) * e;
    const m = r.model;
    if (r.kind === 'boat') {
      const heave = Math.sin(r.t * 1.2) * 0.12;
      m.position.set(x, heave, z);
      m.quaternion.setFromAxisAngle(UP, -r.h);
      m.rotateX((k < 1 ? 0.05 : 0) + Math.sin(r.t * 0.9) * 0.02);
      const speed = (2 * (1 - k) * Math.hypot(r.to.x - r.from.x, r.to.z - r.from.z)) / r.eta;
      if (r.seaFx && speed > 1.5 && (r.wakeT -= dt) <= 0) {
        r.wakeT = 0.2;
        const a = -r.h;
        r.seaFx.wake(x + Math.sin(r.h) * -7, z + Math.cos(r.h) * 7, a, 2.4, 3.2, 1.2);
      }
    } else {
      const y = 12 + (1 - e) * 90;
      m.position.set(x, y, z);
      m.quaternion.setFromAxisAngle(UP, -r.h);
      r.spin += dt;
      if (m.userData.update) {
        m.userData.update(dt, {
          controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brakes: 0 },
          rpm: 0.8, flaps: 0, gearPos: 1, gearDown: true, onGround: false, propBlur: 1, rotorNr: 1,
          groundSpeed: 12, engineOn: true, agl: y, alt: y, vel: UP, pos: m.position, quat: m.quaternion,
        }, r.weather);
      }
    }
  }

  updateRescue(dt) {
    this.placeRescue(dt);
  }

  get rescueHere() {
    return !!this.rescue && this.rescue.t >= this.rescue.eta;
  }

  clear() {
    this.hide();
    this.plan = null;
    this.group.visible = false;
    if (this.rescue) {
      disposeRescue(this.rescue.model);
      this.rescue = null;
    }
  }
}

/**
 * Out of the scene AND off the GPU, the way main.js disposes an aeroplane it
 * swaps out (and warnings.js its drill model): the boat or the helicopter was
 * built for this one ditching, and a new one is built for the next. Textures
 * stay: the skins are cached by the painter, and this file does not own them.
 */
export function disposeRescue(model) {
  if (!model) return;
  if (model.parent) model.parent.remove(model);
  if (model.userData && model.userData.fleetBridge && typeof model.userData.dispose === 'function') {
    try {
      model.userData.dispose();
      return;
    } catch (e) {
      /* the plain walk, then */
    }
  }
  const seen = new Set();
  model.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      if (seen.has(m)) continue;
      seen.add(m);
      m.dispose();
    }
  });
}

/**
 * Which way can a boat come from? The first of twelve bearings with deep water
 * for the whole `reach`, or null: then it is the helicopter.
 */
export function clearApproach(x, z, reach = 800, depth = 1.5) {
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    let ok = true;
    for (let d = 100; d <= reach; d += 100) {
      if (heightAt(x + Math.sin(a) * d, z + Math.cos(a) * d) > -depth) {
        ok = false;
        break;
      }
    }
    if (ok) return { x: x + Math.sin(a) * reach, z: z + Math.cos(a) * reach };
  }
  return null;
}

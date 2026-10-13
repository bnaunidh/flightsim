/**
 * What the owner's trolls look like (./trolls.js, ./disasters.js): rubber
 * ducks falling round somebody, a lightning bolt, an aircraft painted hot
 * pink, T-Pose Harrison standing in for an aircraft, an aircraft drawn tiny or
 * giant. Cheap on purpose — a class of Chromebooks:
 *
 *   - the ducks are three instanced meshes (body, head, beak) per shower, 28
 *     ducks each, so a shower is three draw calls however many ducks fall;
 *   - a bolt is one line of a dozen segments, shown for a third of a second;
 *   - pink paint swaps each mesh's material for ONE shared pink one and puts
 *     the old ones back after — nothing is cloned, nothing is disposed;
 *   - Harrison is the game's own T-Pose model (aircraft/models/tpose-harrison.js),
 *     built once per aircraft he stands in for and kept, hidden, between uses;
 *   - tiny / giant is the model's own scale, remembered and put back.
 *
 * Everything here is drawing only. Nothing in it moves an aircraft.
 */

import * as THREE from '../../vendor/three.module.js';
import { createAircraftModel, syncAircraftModel } from '../../aircraft/model-adapter.js';
import { getAircraft } from '../../aircraft/types.js';
import { schemeFor } from '../../aircraft/liveries.js';
import { heightAt } from '../../world/terrain.js';

/* ---- pink paint --------------------------------------------------------------- */

export const PINK = '#ff2d95';
let pinkMat = null;
function pink() {
  if (!pinkMat) pinkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PINK), roughness: 0.5, metalness: 0.08, name: 'owner-pink' });
  return pinkMat;
}

/**
 * Paint a model pink: every mesh in it (not sprites, lines or points, and not
 * the cockpit, which is the instrument panel). Returns the undo for it.
 */
export function paintPink(model, skip = null) {
  const saved = [];
  if (!model) return { model, saved, undo() {} };
  const p = pink();
  model.traverse((o) => {
    if (!o.isMesh || o.isSprite || o.isLine || o.isPoints || o.material === p) return;
    if (skip && (o === skip || (typeof skip.getObjectById === 'function' && isUnder(o, skip)))) return;
    saved.push([o, o.material]);
    o.material = p;
  });
  return {
    model,
    saved,
    undo() {
      for (const [o, m] of saved) if (o.material === p) o.material = m;
      saved.length = 0;
    },
  };
}

function isUnder(o, root) {
  for (let p = o; p; p = p.parent) if (p === root) return true;
  return false;
}

/** How many meshes of `model` are pink right now (for the checks). */
export function pinkCount(model) {
  let n = 0;
  if (model) model.traverse((o) => { if (o.isMesh && o.material === pinkMat) n++; });
  return n;
}

/* ---- tiny / giant -------------------------------------------------------------- */

/** Scale a model by `f` from what it was; returns the undo. Re-asserted each frame by the caller (some models write their own scale). */
export function scaleModel(model, f) {
  if (!model) return { undo() {}, hold() {} };
  const base = model.scale.clone();
  const want = base.clone().multiplyScalar(f);
  const hold = () => {
    if (model.scale.x !== want.x || model.scale.y !== want.y || model.scale.z !== want.z) model.scale.copy(want);
  };
  hold();
  return {
    model,
    base,
    hold,
    undo() {
      model.scale.copy(base);
    },
  };
}

/* ---- Harrison ------------------------------------------------------------------- */

const harrisons = new Map();
const FAKE = {
  pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), omega: new THREE.Vector3(),
  controls: { pitch: 0, roll: 0, yaw: 0, brakes: 0, throttle: 0.6 }, rpm: 0.8, flaps: 0, gearPos: 0, gearDown: false, onGround: false,
  groundSpeed: 0, engineOn: true, agl: 500, crashed: false,
};

/**
 * T-Pose Harrison, built once per `key` (whose aircraft he stands in for) and
 * kept. Null if the T-Pose aircraft is not in this copy of the game.
 */
export function harrisonFor(key, group) {
  let h = harrisons.get(key);
  if (h && h.parent) return h;
  const type = getAircraft('tpose');
  if (!type || type.id !== 'tpose' || !group) return null;
  if (!h) {
    try {
      h = createAircraftModel({ type, livery: schemeFor(type, 'house') });
    } catch (e) {
      return null;
    }
    const lights = [];
    h.traverse((o) => { if (o.isLight) lights.push(o); });
    for (const l of lights) if (l.parent) l.parent.remove(l);
    h.name = `owner-harrison-${key}`;
    harrisons.set(key, h);
  }
  group.add(h);
  h.visible = false;
  return h;
}

/** Put Harrison where an aircraft is (pos, quat — an aircraft or a drawn remote), facing the way it does. */
export function poseHarrison(h, pos, quat, vel = null, dt = 1 / 60, weather = null) {
  if (!h) return;
  FAKE.pos.copy(pos);
  FAKE.quat.copy(quat);
  if (vel) FAKE.vel.copy(vel);
  else FAKE.vel.set(0, 0, 0);
  FAKE.groundSpeed = Math.hypot(FAKE.vel.x, FAKE.vel.z);
  try {
    syncAircraftModel(h, FAKE);
    if (h.userData.update) h.userData.update(dt, FAKE, weather);
  } catch (e) {
    h.position.copy(pos);
    h.quaternion.copy(quat);
  }
  h.visible = true;
}

export function hideHarrisons() {
  for (const h of harrisons.values()) h.visible = false;
}

/** The world was rebuilt: the models it held are gone. */
export function forgetHarrisons() {
  harrisons.clear();
}

/* ---- duck rain -------------------------------------------------------------------- */

export const DUCKS_PER_SHOWER = 28;
/** Ducks a second while it rains, and how many come down together the moment it starts (so it is seen at once, however slowly the frames come). */
export const DUCKS_PER_SECOND = 6;
export const DUCK_BURST = 5;
const DUCK_FALL = 11; // m/s, a rubber duck's leisurely terminal velocity
const DUCK_G = 9;
/** A duck that has not met the ground by then is gone: they fall round the aeroplane, not to an island a kilometre below. */
export const DUCK_LIFE_S = 6;

let duckGeo = null;
function duckParts() {
  if (duckGeo) return duckGeo;
  const body = new THREE.SphereGeometry(0.55, 10, 8);
  body.scale(1, 0.8, 1.25);
  const head = new THREE.SphereGeometry(0.34, 9, 7);
  head.translate(0, 0.55, -0.45);
  const beak = new THREE.ConeGeometry(0.13, 0.3, 6);
  beak.rotateX(-Math.PI / 2);
  beak.translate(0, 0.5, -0.86);
  duckGeo = {
    body, head, beak,
    yellow: new THREE.MeshStandardMaterial({ color: 0xffd400, roughness: 0.45 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xff7a00, roughness: 0.5 }),
  };
  return duckGeo;
}

/** One shower of ducks: three instanced meshes, re-aimed at a moving place each frame. */
export class DuckShower {
  constructor(group) {
    const g = duckParts();
    this.group = new THREE.Group();
    this.group.name = 'owner-ducks';
    this.parts = [g.body, g.head, g.beak].map((geo, i) => {
      const m = new THREE.InstancedMesh(geo, i === 2 ? g.orange : g.yellow, DUCKS_PER_SHOWER);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      this.group.add(m);
      return m;
    });
    group.add(this.group);
    this.ducks = [];
    for (let i = 0; i < DUCKS_PER_SHOWER; i++) this.ducks.push({ live: false, age: 0, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler(), spin: new THREE.Vector3(), rest: 0 });
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3(1, 1, 1);
    this.on = false;
    this.spawnAcc = 0;
    this.dropped = 0;
  }

  /** `at`: where to rain (a function returning { x, y, z }, or null to stop spawning and let the last ducks land). */
  start(at) {
    this.at = at;
    this.on = true;
    // The first frame drops a handful together: the rain is seen the moment it arrives.
    this.spawnAcc = Math.max(this.spawnAcc, DUCK_BURST);
  }

  stop() {
    this.on = false;
    this.at = null;
  }

  /** True once nothing is falling or resting any more. */
  get idle() {
    return !this.on && this.ducks.every((d) => !d.live);
  }

  update(dt) {
    const at = this.on && this.at ? this.at() : null;
    if (at) {
      this.spawnAcc += dt * DUCKS_PER_SECOND;
      while (this.spawnAcc >= 1) {
        this.spawnAcc -= 1;
        const d = this.ducks.find((x) => !x.live);
        if (!d) break;
        d.live = true;
        d.rest = 0;
        d.age = 0;
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 38;
        d.pos.set(at.x + Math.cos(a) * r, at.y + 45 + Math.random() * 55, at.z + Math.sin(a) * r);
        d.vel.set((Math.random() - 0.5) * 3, -2, (Math.random() - 0.5) * 3);
        d.rot.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        d.spin.set((Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 4);
        this.dropped++;
      }
    }
    let n = 0;
    for (const d of this.ducks) {
      if (!d.live) continue;
      if (d.rest > 0) {
        d.rest -= dt;
        if (d.rest <= 0) {
          d.live = false;
          continue;
        }
      } else {
        d.age += dt;
        if (d.age > DUCK_LIFE_S) {
          d.live = false;
          continue;
        }
        d.vel.y = Math.max(-DUCK_FALL, d.vel.y - DUCK_G * dt);
        d.pos.addScaledVector(d.vel, dt);
        d.rot.x += d.spin.x * dt;
        d.rot.y += d.spin.y * dt;
        d.rot.z += d.spin.z * dt;
        const floor = Math.max(0, heightAt(d.pos.x, d.pos.z)) + 0.5;
        if (d.pos.y <= floor) {
          d.pos.y = floor;
          d.rot.set(0, d.rot.y, 0);
          d.rest = 1.6;
        }
      }
      this._q.setFromEuler(d.rot);
      this._m.compose(d.pos, this._q, this._s);
      for (const p of this.parts) p.setMatrixAt(n, this._m);
      n++;
    }
    for (const p of this.parts) {
      if (p.count !== n) p.count = n;
      if (n) p.instanceMatrix.needsUpdate = true;
    }
  }

  dispose() {
    this.group.removeFromParent();
  }
}

/* ---- lightning bolts --------------------------------------------------------------- */

export const BOLT_SECS = 0.35;

/** A bolt from the cloud to a point on the ground, for a third of a second. */
export class Bolts {
  constructor(group, n = 3) {
    this.group = new THREE.Group();
    this.group.name = 'owner-bolts';
    group.add(this.group);
    this.bolts = [];
    const mat = new THREE.LineBasicMaterial({ color: 0xdff4ff, transparent: true, opacity: 0.95, toneMapped: false });
    for (let i = 0; i < n; i++) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(14 * 3), 3));
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false;
      line.visible = false;
      this.group.add(line);
      this.bolts.push({ line, t: 0 });
    }
    this.struck = 0;
  }

  /** Strike at (x, z): a jagged line from 600 m up down to the ground there. */
  strike(x, z) {
    const b = this.bolts.reduce((a, c) => (c.t <= a.t ? c : a), this.bolts[0]);
    const y0 = Math.max(0, heightAt(x, z));
    const top = y0 + 600;
    const a = b.line.geometry.getAttribute('position');
    for (let i = 0; i < 14; i++) {
      const k = i / 13;
      const jag = i === 0 || i === 13 ? 0 : 1;
      a.setXYZ(i, x + (Math.random() - 0.5) * 60 * jag, top - (top - y0) * k, z + (Math.random() - 0.5) * 60 * jag);
    }
    a.needsUpdate = true;
    b.line.visible = true;
    b.t = BOLT_SECS;
    this.struck++;
  }

  update(dt) {
    for (const b of this.bolts) {
      if (b.t <= 0) continue;
      b.t -= dt;
      if (b.t <= 0) b.line.visible = false;
    }
  }

  get lit() {
    return this.bolts.filter((b) => b.t > 0).length;
  }

  dispose() {
    this.group.removeFromParent();
  }
}

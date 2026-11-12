/**
 * The Dev photo studio (the door is ../photo-studio.js; this is fetched the
 * first time it is opened, and only in Dev mode).
 *
 *   SPAWN      any aeroplane on the roster as a prop: parked on its wheels, or
 *              in the air frozen in an attitude (pitch / bank / heading, gear,
 *              flaps), in any paint. Several at once. No AI and no physics:
 *              with the world running a prop in the air flies straight on at
 *              the speed it was given, its propellers and rotors turning.
 *   CAMERA     detached and flown anywhere (WASD / QE and the mouse; on a
 *              touch screen two sticks, a drag and a pinch), speed, roll and
 *              field of view (wide to telephoto), an orbit round the selected
 *              aeroplane, riding along with it, and five snap-to framings.
 *   THE WORLD  frozen: nothing moves at all, because sim.update() is not run
 *              (the physics, the traffic, the cars and people, the sea, the
 *              clouds, the particles and the propellers are all advanced by
 *              it). Running: at 0.05x to 1x (the same dt scaling as the
 *              WASTED beat). One frame at a time.
 *   SHOTS      the interface off (the Photo HUD and U's clean shot, the
 *              panel too), the time of day and the sky, letterbox bars, and
 *              a PNG of the canvas at its own resolution (drawn and read in
 *              one task, so no preserveDrawingBuffer is needed).
 *   TRAILER    2-6 camera keys (place, aim, lens, roll and whether the world
 *              runs and how fast), played back along an eased spline with
 *              everything hidden, for a screen recording.
 *
 * Leaving puts back the camera, the view, the HUD, the sky, the clock and
 * your aeroplane (where it was, if the world was run), and takes every prop
 * out of the scene. The post pipeline (render/post.js) has no depth pass, so
 * there is no depth of field to offer.
 */

import * as THREE from '../../vendor/three.module.js';
import { AIRCRAFT, getAircraft, specFor } from '../../aircraft/types.js';
import { createAircraftModel, syncAircraftModel, groundOffsetFor } from '../../aircraft/model-adapter.js';
import { liveriesFor, schemeFor } from '../../aircraft/liveries.js';
import { isHiddenAircraft } from '../../core/edition.js';
import { heightAt } from '../../world/terrain.js';
import { isKey, heldKey } from '../../flight/input.js';
import * as Prog from '../../game/progression.js';
import { capturePose, applyPose } from '../../story/save.js';
import { buildUi } from './studio-ui.js';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const KT = 0.514444;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const ease = (x) => 0.5 - 0.5 * Math.cos(Math.PI * clamp(x, 0, 1));

export const SNAPS = ['chase', 'wing', 'belly', 'nose', 'top'];
export const SNAP_LABELS = { chase: 'Chase', wing: 'Wing', belly: 'Belly', nose: 'Nose-on', top: 'Top-down' };
export const SKIES = ['clear', 'cloudy', 'rainy', 'stormy'];
export const MAX_KEYS = 6;

const S = {
  sim: null, on: false, inner: null, wrapped: false,
  frozen: true, scale: 1, stepN: 0, ran: false,
  props: [], nextId: 1, sel: 'own',
  cam: { mode: 'free', pos: new THREE.Vector3(), yaw: 0, pitch: 0, roll: 0, fov: 60, speed: 20, az: 0, el: 0.3, dist: 30, follow: false, lastT: null },
  keys: new Set(), shift: false, look: { dx: 0, dy: 0 }, touch: { mx: 0, my: 0, lx: 0, ly: 0, up: 0 },
  saved: null, ui: null, panelHidden: false, letterbox: false, lastShot: null,
  trailer: { keys: [], seconds: 12, playing: false, t: 0, curve: null, lookCurve: null, ended: false, hideUi: true },
  listeners: [],
};

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _m = new THREE.Matrix4();
const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------ the roster -- */

/** Every aeroplane the studio can place: the whole roster this copy ships. */
export function roster() {
  return AIRCRAFT.filter((a) => !isHiddenAircraft(a.id));
}

/** The roster filtered by a search (id or a part of the name, any order of words). */
export function search(q) {
  const words = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const all = roster();
  if (!words.length) return all;
  return all.filter((a) => {
    const hay = `${a.id} ${a.name} ${a.class || ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export function paintsFor(typeId) {
  const t = getAircraft(typeId);
  return liveriesFor(t).map((l) => ({ id: l.id, name: l.name }));
}

/* ------------------------------------------------------------------ props -- */

function groundUnder(x, z) {
  return Math.max(heightAt(x, z), 0);
}

/** How far the CG sits above the ground on its wheels (physics.js reset: heightAt - lowest gear point). */
function cgHeight(typeId) {
  try {
    const gp = specFor(typeId).gearPoints || [];
    const low = Math.min(...gp.map((p) => p.pos.y));
    return Number.isFinite(low) ? -low : 1.5;
  } catch (e) {
    return 1.5;
  }
}

function measure(model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  const centre = sphere.center.clone().sub(model.position).applyQuaternion(model.quaternion.clone().invert());
  return { radius: Math.max(2, sphere.radius), centre };
}

function poseProp(p) {
  const a = p.fake;
  _e.set(p.pitch * D2R, -p.heading * D2R, -p.bank * D2R, 'YXZ');
  a.quat.setFromEuler(_e);
  if (p.onGround) {
    p.pos.y = groundUnder(p.pos.x, p.pos.z) + p.cg;
  }
  a.pos.copy(p.pos);
  a.onGround = p.onGround;
  a.gearPos = p.gear ? 1 : 0;
  a.gearDown = p.gear;
  a.flaps = p.flaps;
  a.agl = p.onGround ? 0 : Math.max(1, p.pos.y - groundUnder(p.pos.x, p.pos.z));
  a.rpm = p.engines ? (p.onGround ? 0.35 : 0.85) : 0;
  a.engineOn = true;
  const v = p.onGround ? 0 : p.speedKt * KT;
  _v.set(0, 0, -1).applyQuaternion(a.quat).multiplyScalar(v);
  a.vel.copy(_v);
  a.airspeed = v;
  a.groundSpeed = Math.hypot(_v.x, _v.z);
  a.controls.throttle = p.engines ? 0.7 : 0;
  try {
    syncAircraftModel(p.model, a);
  } catch (e) {
    p.model.position.copy(a.pos);
    p.model.quaternion.copy(a.quat);
  }
}

/** Run a prop's own animation (gear, flaps, propellers) for dt seconds; rpm 0 settles it without turning anything. */
function animateProp(p, dt, settle = false) {
  const ud = p.model.userData;
  if (!ud || typeof ud.update !== 'function') return;
  const a = p.fake;
  const rpm = a.rpm;
  if (settle) a.rpm = 0;
  try {
    ud.update(dt, a, S.sim && S.sim.weather);
  } catch (e) {
    /* a prop that will not animate still stands there */
  }
  a.rpm = rpm;
  // The pack poses the model in its update; keep it where the studio put it.
  try {
    syncAircraftModel(p.model, a);
  } catch (e) {
    /* as posed */
  }
}

function settleProp(p) {
  poseProp(p);
  for (let i = 0; i < 40; i++) animateProp(p, 1 / 20, true);
}

/**
 * A prop: { type, livery, at: 'air' | 'ground' | 'beside', pitch, bank, heading, gear, flaps, speedKt, engines }.
 * Placed ahead of the camera (the air or the ground there) or beside your aeroplane.
 */
export function spawn(typeId, o = {}) {
  const sim = S.sim;
  if (!S.on || !sim) return null;
  const type = getAircraft(typeId);
  if (!type || type.id !== typeId) return null;
  const liveryId = o.livery || 'house';
  const model = createAircraftModel({ type, livery: schemeFor(type, liveryId), realModel: true, landingLight: false });
  // No lights of their own: a light more in the scene is a new program for every material in the world.
  const lights = [];
  model.traverse((n) => { if (n.isLight) lights.push(n); });
  for (const l of lights) l.parent && l.parent.remove(l);
  try {
    model.userData.groundOffsetY = model.userData.fleetBridge ? groundOffsetFor(model, specFor(type.id)) : 0;
  } catch (e) {
    model.userData.groundOffsetY = 0;
  }
  model.name = `studio-prop-${S.nextId}`;
  sim.scene.add(model);
  const at = o.at || 'air';
  const p = {
    id: S.nextId++, type: type.id, name: type.name, livery: liveryId, model,
    pos: new THREE.Vector3(), cg: cgHeight(type.id), onGround: at !== 'air',
    pitch: o.pitch ?? 0, bank: o.bank ?? 0, heading: 0,
    gear: o.gear ?? at !== 'air', flaps: o.flaps ?? 0, speedKt: o.speedKt ?? (at === 'air' ? 160 : 0), engines: o.engines ?? at === 'air',
    radius: 10, centre: new THREE.Vector3(),
    fake: {
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), omega: new THREE.Vector3(),
      controls: { pitch: 0, roll: 0, yaw: 0, brakes: 1, throttle: 0 }, rpm: 0, flaps: 0, gearPos: 1, gearDown: true,
      onGround: true, groundSpeed: 0, airspeed: 0, engineOn: true, agl: 0, crashed: false,
    },
  };
  // Size it first, then place it clear of the camera by its own size.
  poseProp(p);
  Object.assign(p, measure(model));
  const cam = sim.camera;
  const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
  const camHdg = Math.atan2(fwd.x, -fwd.z) * R2D;
  if (at === 'beside' && sim.aircraft) {
    const own = sim.aircraft;
    const side = _v2.set(1, 0, 0).applyQuaternion(own.quat);
    side.y = 0;
    side.normalize();
    p.pos.copy(own.pos).addScaledVector(side, p.radius * 2 + 12);
    const of = _v.set(0, 0, -1).applyQuaternion(own.quat);
    p.heading = (Math.atan2(of.x, -of.z) * R2D + 360) % 360;
  } else if (at === 'ground') {
    const flat = _v2.set(fwd.x, 0, fwd.z);
    if (flat.lengthSq() < 1e-6) flat.set(0, 0, -1);
    flat.normalize();
    p.pos.copy(cam.position).addScaledVector(flat, p.radius * 2.2 + 8);
    p.heading = o.heading ?? (camHdg + 90 + 360) % 360;
  } else {
    p.pos.copy(cam.position).addScaledVector(fwd, p.radius * 2.6 + 10);
    p.pos.y = Math.max(p.pos.y, groundUnder(p.pos.x, p.pos.z) + p.radius + 3);
    p.heading = o.heading ?? (camHdg + 90 + 360) % 360;
  }
  if (o.pos) p.pos.set(o.pos[0], o.pos[1], o.pos[2]);
  if (Number.isFinite(o.heading)) p.heading = o.heading;
  settleProp(p);
  S.props.push(p);
  S.sel = p.id;
  if (sim.warmShaders) sim.warmShaders(model, { chunked: true });
  S.ui && S.ui.sync();
  return p;
}

export function remove(id) {
  const i = S.props.findIndex((p) => p.id === id);
  if (i < 0) return false;
  const [p] = S.props.splice(i, 1);
  disposeModel(p.model);
  if (S.sel === id) S.sel = S.props.length ? S.props[S.props.length - 1].id : 'own';
  S.ui && S.ui.sync();
  return true;
}

function disposeModel(model) {
  if (!model) return;
  if (model.parent) model.parent.remove(model);
  const seen = new Set();
  model.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) if (!seen.has(m)) { seen.add(m); m.dispose(); }
  });
  if (model.userData && model.userData.realModel) model.userData.realModel.dead = true;
}

export function prop(id) {
  return S.props.find((p) => p.id === id) || null;
}

/** Change the selected prop (any of pitch, bank, heading, gear, flaps, speedKt, engines, onGround) and repose it. */
export function edit(id, fields = {}) {
  const p = prop(id);
  if (!p) return null;
  const gearWas = p.gear;
  const flapsWas = p.flaps;
  for (const k of ['pitch', 'bank', 'heading', 'flaps', 'speedKt']) if (Number.isFinite(fields[k])) p[k] = fields[k];
  for (const k of ['gear', 'engines']) if (typeof fields[k] === 'boolean') p[k] = fields[k];
  if (typeof fields.onGround === 'boolean' && fields.onGround !== p.onGround) {
    p.onGround = fields.onGround;
    if (!p.onGround) p.pos.y = groundUnder(p.pos.x, p.pos.z) + p.radius * 1.5 + 20;
    else { p.pitch = 0; p.bank = 0; p.gear = true; }
  }
  if (p.onGround) { p.pitch = 0; p.bank = 0; }
  if (p.gear !== gearWas || p.flaps !== flapsWas) settleProp(p);
  else poseProp(p);
  return p;
}

/** Bring the selected prop to where the camera is looking, at the distance its size wants. */
export function bringToCamera(id) {
  const p = prop(id);
  if (!p || !S.sim) return null;
  const cam = S.sim.camera;
  const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
  p.pos.copy(cam.position).addScaledVector(fwd, p.radius * 2.6 + 10);
  if (!p.onGround) p.pos.y = Math.max(p.pos.y, groundUnder(p.pos.x, p.pos.z) + p.radius + 3);
  poseProp(p);
  return p;
}

function tickProps(gameDt) {
  for (const p of S.props) {
    if (gameDt > 0 && !p.onGround && p.speedKt > 0) {
      _v.set(0, 0, -1).applyQuaternion(p.fake.quat);
      p.pos.addScaledVector(_v, p.speedKt * KT * gameDt);
    }
    if (gameDt > 0) {
      poseProp(p);
      animateProp(p, gameDt);
    }
  }
}

/* ------------------------------------------------------------- targets -- */

/** The selected aeroplane's middle in the world, its size, and its attitude. */
export function target(out = new THREE.Vector3()) {
  const sim = S.sim;
  const p = S.sel === 'own' ? null : prop(S.sel);
  if (p) {
    out.copy(p.centre).applyQuaternion(p.model.quaternion).add(p.model.position);
    return { pos: out, radius: p.radius, quat: p.model.quaternion };
  }
  const m = sim.model;
  const own = S.ownFrame || { radius: 12, centre: new THREE.Vector3() };
  out.copy(own.centre).applyQuaternion(m.quaternion).add(m.position);
  return { pos: out, radius: own.radius, quat: m.quaternion };
}

/* -------------------------------------------------------------- camera -- */

function camFromCamera() {
  const c = S.sim.camera;
  S.cam.pos.copy(c.position);
  _e.setFromQuaternion(c.quaternion, 'YXZ');
  S.cam.pitch = _e.x;
  S.cam.yaw = _e.y;
  S.cam.roll = _e.z;
}

function applyCamera() {
  const c = S.sim.camera;
  const k = S.cam;
  c.position.copy(k.pos);
  _e.set(k.pitch, k.yaw, k.roll, 'YXZ');
  c.quaternion.setFromEuler(_e);
  c.up.set(0, 1, 0);
  if (c.fov !== k.fov || c.near !== 0.1) {
    c.fov = k.fov;
    c.near = 0.1;
    c.updateProjectionMatrix();
  }
  c.updateMatrixWorld(true);
}

/** Look from `pos` at `at`, with the picture's up as close to `up` as it goes; the roll is what is left over. */
function aim(pos, at, up = UP) {
  _m.lookAt(pos, at, up);
  _q.setFromRotationMatrix(_m);
  _e.setFromQuaternion(_q, 'YXZ');
  S.cam.pos.copy(pos);
  S.cam.pitch = _e.x;
  S.cam.yaw = _e.y;
  S.cam.roll = _e.z;
}

function orbitFromCamera() {
  const t = target(_v2).pos;
  const d = _v.copy(S.cam.pos).sub(t);
  S.cam.dist = Math.max(2, d.length());
  S.cam.el = Math.asin(clamp(d.y / S.cam.dist, -1, 1));
  S.cam.az = Math.atan2(d.x, d.z);
}

export function setCamMode(mode) {
  if (mode === S.cam.mode) return;
  if (mode === 'orbit') orbitFromCamera();
  S.cam.mode = mode === 'orbit' ? 'orbit' : 'free';
  S.cam.lastT = null;
  S.ui && S.ui.sync();
}

/** Snap the camera to a framing of the selected aeroplane, then leave it free there. */
export function snap(name) {
  const t = target(new THREE.Vector3());
  const R = t.radius;
  const q = t.quat;
  const off = {
    chase: [0, 0.32, 2.3], wing: [-1.7, 0.12, 0.25], belly: [0.05, -1.25, 0.35], nose: [0, 0.08, -2.2], top: [0, 2.6, 0.02],
  }[name];
  if (!off) return false;
  const pos = _v.set(off[0] * R, off[1] * R, off[2] * R).applyQuaternion(q).add(t.pos);
  const minY = groundUnder(pos.x, pos.z) + 0.25;
  if (pos.y < minY) pos.y = minY;
  const up = name === 'top' ? _v2.set(0, 0, -1).applyQuaternion(q) : _v2.set(0, 1, 0).applyQuaternion(q);
  if (name !== 'top') { up.lerp(UP, 0.5).normalize(); }
  aim(pos.clone(), t.pos, up.clone());
  if (S.cam.mode === 'orbit') orbitFromCamera();
  S.cam.lastT = null;
  return true;
}

export function setFov(f) {
  S.cam.fov = clamp(f, 8, 110);
}

function tickCamera(dt, sim) {
  const k = S.cam;
  const keys = S.keys;
  const held = (a) => heldKey(sim, a, keys);
  const tch = S.touch;
  const fwd = (held('pitchDown') ? 1 : 0) - (held('pitchUp') ? 1 : 0) + tch.my;
  const side = (held('rollRight') ? 1 : 0) - (held('rollLeft') ? 1 : 0) + tch.mx;
  const up = (held('yawRight') ? 1 : 0) - (held('yawLeft') ? 1 : 0) + tch.up;
  const boost = S.shift ? 4 : 1;
  const lookRate = 1.6 * dt * (k.fov / 60);
  const lx = (held('lookRight') ? 1 : 0) - (held('lookLeft') ? 1 : 0) + tch.lx;
  const ly = (held('lookUp') ? 1 : 0) - (held('lookDown') ? 1 : 0) + tch.ly;
  const rollIn = (held('trimUp') ? 1 : 0) - (held('trimDown') ? 1 : 0);
  if (rollIn) k.roll = clamp(k.roll - rollIn * dt * 0.8, -Math.PI, Math.PI);
  const sens = 0.0032 * (k.fov / 60);
  const t = target(_v2);
  // Ride along: the camera moves with the selected aeroplane.
  if (k.follow || k.mode === 'orbit') {
    if (k.lastT && k.mode === 'free') k.pos.add(_v.copy(t.pos).sub(k.lastT));
    k.lastT = (k.lastT || new THREE.Vector3()).copy(t.pos);
  } else k.lastT = null;
  if (k.mode === 'orbit') {
    k.az -= S.look.dx * sens + (side + lx) * lookRate;
    k.el = clamp(k.el + S.look.dy * sens + (up + ly) * lookRate, -1.45, 1.45);
    k.dist = clamp(k.dist * (1 - fwd * dt * 0.9), 1.5, 20000);
    const c = Math.cos(k.el);
    const pos = _v.set(Math.sin(k.az) * c, Math.sin(k.el), Math.cos(k.az) * c).multiplyScalar(k.dist).add(t.pos);
    const minY = groundUnder(pos.x, pos.z) + 0.25;
    if (pos.y < minY) pos.y = minY;
    const roll = k.roll;
    aim(pos.clone(), t.pos);
    k.roll = roll;
  } else {
    k.yaw -= S.look.dx * sens + lx * lookRate;
    k.pitch = clamp(k.pitch - S.look.dy * sens + ly * lookRate, -1.55, 1.55);
    _e.set(k.pitch, k.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    const v = k.speed * boost * dt;
    if (fwd) k.pos.addScaledVector(_v.set(0, 0, -1).applyQuaternion(_q), fwd * v);
    if (side) k.pos.addScaledVector(_v.set(1, 0, 0).applyQuaternion(_q), side * v);
    if (up) k.pos.y += up * v;
    const minY = groundUnder(k.pos.x, k.pos.z) + 0.25;
    if (k.pos.y < minY) k.pos.y = minY;
  }
  S.look.dx = 0;
  S.look.dy = 0;
  applyCamera();
}

/* -------------------------------------------------------------- trailer -- */

function aimPoint() {
  // What the camera is looking at: the selected aeroplane if it is in front, else 60 m ahead.
  const cam = S.sim.camera;
  const fwd = _v.set(0, 0, -1).applyQuaternion(cam.quaternion);
  const t = target(new THREE.Vector3());
  const d = t.pos.clone().sub(cam.position).dot(fwd);
  return cam.position.clone().addScaledVector(fwd, d > 2 ? d : 60);
}

/** A key from where the camera is now, with the world's state. */
export function addKey() {
  const tr = S.trailer;
  if (tr.keys.length >= MAX_KEYS) return null;
  const cam = S.sim.camera;
  const k = {
    pos: cam.position.toArray(), look: aimPoint().toArray(), fov: S.cam.fov, roll: S.cam.roll,
    frozen: S.frozen, scale: S.scale,
  };
  tr.keys.push(k);
  S.ui && S.ui.sync();
  return k;
}

export function removeKey(i) {
  S.trailer.keys.splice(i, 1);
  S.ui && S.ui.sync();
}

export function gotoKey(i) {
  const k = S.trailer.keys[i];
  if (!k) return;
  S.cam.mode = 'free';
  aim(new THREE.Vector3().fromArray(k.pos), new THREE.Vector3().fromArray(k.look));
  S.cam.roll = k.roll;
  S.cam.fov = k.fov;
  applyCamera();
  S.ui && S.ui.sync();
}

function cr(a, b, c, d, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
}
function scalarAt(vals, u) {
  const n = vals.length;
  if (n === 1) return vals[0];
  const x = u * (n - 1);
  const i = Math.min(n - 2, Math.floor(x));
  const f = x - i;
  return cr(vals[Math.max(0, i - 1)], vals[i], vals[i + 1], vals[Math.min(n - 1, i + 2)], f);
}

export function play(opts = {}) {
  const tr = S.trailer;
  if (tr.keys.length < 2) return false;
  if (Number.isFinite(opts.seconds)) tr.seconds = clamp(opts.seconds, 2, 120);
  if (typeof opts.hideUi === 'boolean') tr.hideUi = opts.hideUi;
  if (typeof opts.letterbox === 'boolean') setLetterbox(opts.letterbox);
  const pts = tr.keys.map((k) => new THREE.Vector3().fromArray(k.pos));
  const looks = tr.keys.map((k) => new THREE.Vector3().fromArray(k.look));
  tr.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  tr.lookCurve = new THREE.CatmullRomCurve3(looks, false, 'centripetal');
  tr.t = 0;
  tr.playing = true;
  tr.ended = false;
  tr.wasHidden = S.panelHidden;
  if (tr.hideUi) setPanelHidden(true);
  S.cam.mode = 'free';
  S.cam.follow = false;
  trailerFrame(0);
  S.ui && S.ui.sync();
  return true;
}

export function stop(atEnd = false) {
  const tr = S.trailer;
  if (!tr.playing) return;
  tr.playing = false;
  tr.ended = atEnd;
  if (tr.hideUi) setPanelHidden(!!tr.wasHidden);
  camFromCamera();
  S.ui && S.ui.sync();
}

function trailerFrame(dt) {
  const tr = S.trailer;
  tr.t += dt;
  const x = clamp(tr.t / tr.seconds, 0, 1);
  const u = ease(x);
  // Even speed along the path (arc length), eased in and out; the aim, lens and roll keyed to the same keys.
  const pos = tr.curve.getPointAt(u, _v);
  const ut = tr.curve.getUtoTmapping(u);
  const look = tr.lookCurve.getPoint(ut, _v2);
  const n = tr.keys.length;
  const seg = Math.min(n - 2, Math.floor(ut * (n - 1)));
  const a = tr.keys[seg];
  const b = tr.keys[seg + 1];
  S.frozen = !!a.frozen;
  S.scale = a.frozen || b.frozen ? a.scale : a.scale + (b.scale - a.scale) * (ut * (n - 1) - seg);
  aim(pos.clone(), look.clone());
  S.cam.roll = scalarAt(tr.keys.map((k) => k.roll), ut);
  S.cam.fov = clamp(scalarAt(tr.keys.map((k) => k.fov), ut), 8, 110);
  applyCamera();
  if (x >= 1) stop(true);
}

/* ---------------------------------------------------------- the world -- */

export function setFrozen(on) {
  S.frozen = !!on;
  const mix = S.sim.audio && S.sim.audio.available && S.sim.audio.mixer;
  if (mix) on ? mix.suspend() : mix.resume();
  S.ui && S.ui.sync();
}

export function setScale(x) {
  S.scale = clamp(x, 0.05, 1);
  S.ui && S.ui.sync();
}

/** One frame of the world (1/60 s of game time), the rest staying frozen. */
export function stepFrame(n = 1) {
  S.stepN += n;
}

/** The sky and the light again, after the hour or the weather changed with the world frozen. */
function refreshLook() {
  const sim = S.sim;
  const W = sim.weather;
  try {
    sim.sky && sim.sky.update(W);
    sim.ocean && sim.ocean.update(0, W);
    sim.clouds && sim.clouds.update(0, W, sim.aircraft.pos);
  } catch (e) {
    /* the next running frame paints it */
  }
}

export function setHour(h) {
  const W = S.sim.weather;
  if (!W || !Number.isFinite(h)) return;
  W.setHour(h);
  refreshLook();
  S.ui && S.ui.sync();
}

export function setSky(id) {
  const W = S.sim.weather;
  if (!W) return;
  if (id === 'flight') W._tempCond = S.saved ? S.saved.tempCond : null;
  else if (SKIES.includes(id)) W.temporaryCondition(id, 1e9);
  S.sky = id;
  refreshLook();
  S.ui && S.ui.sync();
}

/* ------------------------------------------------------------- shots -- */

export function setPanelHidden(on) {
  S.panelHidden = !!on;
  S.ui && S.ui.setHidden(S.panelHidden);
}

export function setLetterbox(on) {
  S.letterbox = !!on;
  S.ui && S.ui.setLetterbox(S.letterbox);
}

/** The picture as a PNG at the canvas's own size: drawn and read in the same task. */
export function shot({ download = true } = {}) {
  const sim = S.sim;
  const canvas = sim.renderer.domElement;
  return new Promise((resolve) => {
    sim.renderFrame();
    canvas.toBlob((blob) => {
      S.lastShot = blob ? { blob, width: canvas.width, height: canvas.height, at: Date.now() } : null;
      if (blob && download) {
        const d = new Date();
        const pad = (x) => String(x).padStart(2, '0');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `island-flight-sim-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
      resolve(S.lastShot);
    }, 'image/png');
  });
}

/* ------------------------------------------------------- the frame -- */

/*
 * What a game draws INTO the picture for the player and a clean shot does not
 * want: the guidance rails and beacons, and screen-sized labels (Dev mode's
 * traffic name tags: sprites with sizeAttenuation off). The game shows them
 * again on its next frame, so they are hidden after every frame the world runs.
 */
let labels = [];
let labelsAt = 0;
function declutter(sim) {
  for (const g of [sim.navGuide && sim.navGuide.group, sim.beacon && sim.beacon.group, sim.destBeacon && sim.destBeacon.group]) if (g) g.visible = false;
  if (--labelsAt <= 0) {
    labelsAt = 30;
    labels = [];
    sim.scene.traverse((o) => {
      if (o.isSprite && o.material && o.material.sizeAttenuation === false) labels.push(o);
    });
  }
  for (const o of labels) o.visible = false;
}

function frame(sim, dt, rest) {
  const st = sim.state;
  if (st !== 'flying') {
    // A pause from elsewhere, the debrief, the menu: the studio steps out of the way and closes.
    close(sim);
    return S.inner.call(sim, dt, ...rest);
  }
  const real = Math.min(Math.max(dt, 0), 0.1);
  if (S.trailer.playing) trailerFrame(real);
  let gameDt = S.frozen ? 0 : real * S.scale;
  if (S.stepN > 0) {
    S.stepN--;
    gameDt = 1 / 60;
  }
  if (gameDt > 0) {
    S.ran = true;
    S.inner.call(sim, gameDt, ...rest);
    if (sim.state !== 'flying') {
      close(sim);
      return undefined;
    }
  } else if (sim.input && sim.input.endFrame) sim.input.endFrame();
  tickProps(gameDt);
  declutter(sim);
  if (!S.trailer.playing) tickCamera(real, sim);
  else applyCamera();
  return undefined;
}

function wrap(sim) {
  if (S.wrapped) return;
  S.wrapped = true;
  const inner = sim.update;
  S.inner = inner;
  sim.update = function updateWithStudio(dt, ...rest) {
    if (!S.on) return inner.call(this, dt, ...rest);
    return frame(this, dt, rest);
  };
}

/* ------------------------------------------------------------- input -- */

function listen(target, type, fn, opts) {
  target.addEventListener(type, fn, opts);
  S.listeners.push(() => target.removeEventListener(type, fn, opts));
}

function onKey(down) {
  return (ev) => {
    if (!S.on) return;
    S.shift = !!ev.shiftKey;
    const t = ev.target;
    const typing = t && (/^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName) || t.isContentEditable);
    const sim = S.sim;
    // Nothing of a key reaches the game while the studio is open (its own input listens on window too).
    ev.stopImmediatePropagation();
    if (typing) {
      if (down && isKey(sim, 'pause', ev.code)) t.blur();
      return;
    }
    if (!down) {
      S.keys.delete(ev.code);
      return;
    }
    if (ev.altKey && isKey(sim, 'hideUi', ev.code)) {
      ev.preventDefault();
      close(sim);
      return;
    }
    if (!ev.metaKey && !ev.ctrlKey) ev.preventDefault();
    S.keys.add(ev.code);
    if (ev.repeat) return;
    const code = ev.code;
    if (isKey(sim, 'pause', code)) {
      if (S.trailer.playing) stop();
      else if (S.panelHidden) setPanelHidden(false);
      else close(sim);
    } else if (isKey(sim, 'hideUi', code)) setPanelHidden(!S.panelHidden);
    else if (isKey(sim, 'brakes', code)) setFrozen(!S.frozen);
    else if (isKey(sim, 'guide', code)) { if (S.frozen) stepFrame(); }
    else if (isKey(sim, 'camera', code)) {
      S.snapAt = ((S.snapAt ?? -1) + 1) % SNAPS.length;
      snap(SNAPS[S.snapAt]);
    } else if (isKey(sim, 'lookBehind', code)) setCamMode(S.cam.mode === 'orbit' ? 'free' : 'orbit');
    else if (isKey(sim, 'trimReset', code)) S.cam.roll = 0;
    else if (isKey(sim, 'starter', code)) shot();
  };
}

/** The picture's own gestures (the overlay under the panel): drag to look or orbit, wheel and pinch for the lens. */
export function pointerLayer(el) {
  const fingers = new Map();
  let pinch = null;
  let moved = 0;
  el.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (S.trailer.playing) {
      stop();
      return;
    }
    el.setPointerCapture && el.setPointerCapture(e.pointerId);
    fingers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (fingers.size === 2) {
      const [a, b] = [...fingers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: S.cam.fov };
    }
  });
  el.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    const f = fingers.get(e.pointerId);
    if (!f) return;
    const dx = e.clientX - f.x;
    const dy = e.clientY - f.y;
    f.x = e.clientX;
    f.y = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (fingers.size >= 2 && pinch) {
      const [a, b] = [...fingers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) setFov(pinch.fov * (pinch.d / d));
      return;
    }
    S.look.dx += dx;
    S.look.dy += dy;
  });
  const up = (e) => {
    e.stopPropagation();
    if (!fingers.has(e.pointerId)) return;
    fingers.delete(e.pointerId);
    if (fingers.size < 2) pinch = null;
    // A tap on the picture with the panel away brings it back (the only way, on a touch screen).
    if (!fingers.size && moved < 6 && S.panelHidden && e.type === 'pointerup') setPanelHidden(false);
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', up);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFov(S.cam.fov * Math.exp(e.deltaY * 0.0012));
  }, { passive: false });
  for (const t of ['mousedown', 'mouseup', 'mousemove', 'click', 'contextmenu']) el.addEventListener(t, (e) => { e.stopPropagation(); if (t === 'contextmenu') e.preventDefault(); });
}

/* -------------------------------------------------------- open / close -- */

export function isOpen() {
  return S.on;
}

export function open(sim) {
  if (S.on) return true;
  if (!sim || !Prog.isDev(sim.prog || Prog.load())) return false;
  if (sim.state === 'paused') sim.resume();
  if (sim.state !== 'flying' || sim.mode === 'drive' || !sim.model) {
    sim.hud && sim.hud.notify('The photo studio opens in a flight', 'info', 3);
    return false;
  }
  S.sim = sim;
  wrap(sim);
  const cam = sim.camera;
  const W = sim.weather;
  const hud = sim.hud;
  S.saved = {
    pos: cam.position.clone(), quat: cam.quaternion.clone(), up: cam.up.clone(), fov: cam.fov, near: cam.near, far: cam.far,
    view: sim.rig && sim.rig.mode, density: hud && hud.density, hidden: hud && hud.hidden,
    clean: document.documentElement.classList.contains('ui-clean'),
    hour: W && W.hour, preset: W && W.preset, tempCond: W && W._tempCond,
    autoPause: sim.autoPauseOnHide, pose: capturePose(sim), timeScale: sim.timeScale,
  };
  if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  if (sim.input) {
    sim.input.keys && sim.input.keys.clear();
    sim.input._lookFinger = null;
    sim.input.rightDown = false;
  }
  sim.autoPauseOnHide = false;
  // From outside, so the aeroplane is drawn: one tiny step lets the view settle its model and cockpit.
  if (sim.rig && sim.rig.mode === 'cockpit' && sim.rig.setMode) {
    sim.rig.setMode('chase');
    for (let i = 0; i < 3; i++) S.inner.call(sim, 1 / 600);
  }
  S.ownFrame = measure(sim.model);
  if (hud) {
    hud.setDensity && hud.setDensity('photo');
    hud.setHidden && hud.setHidden(true);
    hud.setCleanShot && hud.setCleanShot(true);
  }
  S.on = true;
  S.ran = false;
  S.frozen = true;
  S.scale = 1;
  S.stepN = 0;
  S.sel = 'own';
  S.sky = 'flight';
  S.panelHidden = false;
  S.keys.clear();
  Object.assign(S.touch, { mx: 0, my: 0, lx: 0, ly: 0, up: 0 });
  S.cam.mode = 'free';
  S.cam.follow = false;
  S.cam.lastT = null;
  S.cam.fov = clamp(cam.fov, 8, 110);
  camFromCamera();
  const mix = sim.audio && sim.audio.available && sim.audio.mixer;
  if (mix) mix.suspend();
  listen(window, 'keydown', onKey(true), true);
  listen(window, 'keyup', onKey(false), true);
  listen(window, 'blur', () => S.keys.clear());
  labelsAt = 0;
  declutter(sim);
  S.ui = buildUi(api, sim);
  document.documentElement.classList.add('pst-on');
  S.ui.sync();
  return true;
}

export function close(sim = S.sim) {
  if (!S.on) return;
  S.on = false;
  S.trailer.playing = false;
  for (const off of S.listeners.splice(0)) off();
  S.keys.clear();
  for (const p of S.props.splice(0)) disposeModel(p.model);
  S.sel = 'own';
  document.documentElement.classList.remove('pst-on');
  if (S.ui) S.ui.destroy();
  S.ui = null;
  const v = S.saved;
  if (!v || !sim) return;
  const W = sim.weather;
  if (W) {
    W._tempCond = v.tempCond;
    if (v.preset && W.setTime) W.setTime(v.preset);
    else if (Number.isFinite(v.hour)) W.setHour(v.hour);
  }
  if (S.ran && v.pose && sim.state === 'flying') {
    try {
      applyPose(sim, v.pose);
    } catch (e) {
      console.warn('[studio] could not put the aeroplane back', e);
    }
  }
  sim.timeScale = v.timeScale;
  sim.autoPauseOnHide = v.autoPause;
  const cam = sim.camera;
  cam.position.copy(v.pos);
  cam.quaternion.copy(v.quat);
  cam.up.copy(v.up);
  cam.fov = v.fov;
  cam.near = v.near;
  cam.far = v.far;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld(true);
  if (sim.rig && v.view && sim.rig.mode !== v.view && sim.rig.setMode) sim.rig.setMode(v.view);
  const hud = sim.hud;
  if (hud) {
    hud.setDensity && hud.setDensity(v.density);
    hud.setHidden && hud.setHidden(!!v.hidden);
    hud.setCleanShot && hud.setCleanShot(!!v.clean);
  }
  if (sim.state === 'flying' && sim.wakeAudio) sim.wakeAudio();
  refreshLook();
  S.saved = null;
}

/** Everything above, in one object: for the panel, the door, the tests and the trailer scripts. */
export const api = {
  open, close, isOpen, spawn, remove, prop, edit, bringToCamera, target, setCamMode, snap, setFov,
  addKey, removeKey, gotoKey, play, stop, setFrozen, setScale, stepFrame, setHour, setSky,
  setPanelHidden, setLetterbox, shot, roster, search, paintsFor, pointerLayer, applyCamera, aim,
  select(id) {
    S.sel = id === 'own' || prop(id) ? id : 'own';
    if (S.cam.mode === 'orbit') orbitFromCamera();
    S.cam.lastT = null;
    S.ui && S.ui.sync();
  },
  get state() { return S; },
  get props() { return S.props; },
  get cam() { return S.cam; },
  get trailer() { return S.trailer; },
};

if (typeof window !== 'undefined') window.__studio = api;

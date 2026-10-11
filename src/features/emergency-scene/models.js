/**
 * What an emergency scene is made of, as shapes: the fire engine (a crash
 * tender, borrowed from the unfinished emergency branch's models), the
 * ambulance, cones, barriers and tape. The police cars are the flight
 * events' own (events/vehicles.js createPoliceCar), so a car at a cordon
 * looks like the ones that meet a hijacked jet.
 *
 * CHEAP, like the airfield: each body is one merged vertex-coloured
 * geometry, built once a session and shared by every copy; a vehicle costs
 * a Group, its body mesh and three or four glow sprites. The beacons flash
 * by changing two shared sprite materials, so eight vehicles flashing is a
 * handful of property writes a frame.
 *
 * THE LIGHT BARS GO THROUGH REDUCE FLASHING (render/flash-safety.js):
 *   switch ON (the default)   one soft pulse every 1.1 s, the two sides
 *                             swelling against each other, no brighter than
 *                             CAPS.strobe — never a hard flash, never two in
 *                             one second
 *   switch OFF                the two sides alternate, each lit for 0.4 s:
 *                             1.25 flashes a second a side, under WCAG's
 *                             three and never two closer than MIN_FLASH_GAP
 * beaconLevels(t) is the pure arithmetic, so a test can count the flashes.
 *
 * None of these is a collider: pictures with a position, the rule the police
 * cars follow. Nobody can crash into the fire crew, and nobody is hurt.
 */

import * as THREE from '../../vendor/three.module.js';
import { Batch, trse } from '../../world/airport-kit.js';
import { coneGeometry } from '../../world/airport-vehicles.js';
import { FLASH, CAPS, MIN_FLASH_GAP } from '../../render/flash-safety.js';

const RED = 0xc8322a;
const STRIPE = 0xf2d24a;
const STEEL = 0xa7aeb6;
const DARK = 0x262b31;
const TYRE = 0x17191c;
const GLASS = 0x2f3d4a;
const WHITE = 0xf2f4f6;
const YELLOW = 0xf2d23a;

const _m = new THREE.Matrix4();
let SH = null;

/** With the switch off, each side is lit this long and dark this long (seconds). */
export const FLASH_HALF = 0.4;
/** With the switch on, one soft pulse a side every this many seconds: under 1 Hz, so no second holds two. */
export const SOFT_PERIOD = 1.1;

function glow() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.22, 'rgba(255,255,255,0.6)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function word(text, bg, fg, band) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 48;
  const g = c.getContext('2d');
  if (band) {
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = (x / 32) % 2 ? band[0] : band[1];
      g.fillRect(x, 0, 32, 48);
    }
    g.fillStyle = bg;
    g.fillRect(6, 9, 244, 30);
  } else {
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 48);
  }
  g.fillStyle = fg;
  g.font = 'bold 26px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(text, 128, 25);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function tyres(b, halfTrack, axles, r, width = 0.35) {
  for (const z of axles) {
    for (const s of [-1, 1]) {
      b.cyl(r, r, width, s * halfTrack, r - width / 2, z, TYRE, 10, {
        matrix: trse(s * halfTrack, r, z, 0, 0, Math.PI / 2, 1, 1, 1, _m),
      });
    }
  }
}

/** The fire engine's body: a red six-wheeler with a roof monitor, nose along -Z. */
function tenderBody() {
  const b = new Batch();
  b.slab(-1.35, 1.35, 0.8, 3.1, -2.8, 5.0, RED);
  b.slab(-1.35, 1.35, 0.9, 2.5, -5.2, -2.9, RED);
  b.slab(-1.23, 1.23, 1.7, 2.38, -5.22, -5.15, GLASS);
  for (const s of [-1, 1]) b.slab(s * 1.35 - 0.02, s * 1.35 + 0.02, 1.7, 2.35, -5.0, -3.2, GLASS);
  b.slab(-1.4, 1.4, 2.5, 2.58, -5.25, -2.85, DARK);
  b.slab(-1.37, 1.37, 1.4, 1.65, -5.2, 5.0, STRIPE);
  b.slab(-1.2, 1.2, 3.1, 3.3, -2.6, 4.6, STEEL);
  b.cyl(0.35, 0.4, 0.4, 0, 3.3, -1.6, DARK, 10);
  b.tube(0, 3.75, -1.6, 0, 4.0, -3.3, 0.12, STEEL, 8); // the monitor, pointing forward and up
  b.slab(-0.25, 0.25, 0.75, 0.95, -5.45, -5.2, STEEL);
  for (const s of [-1, 1]) {
    for (let k = 0; k < 3; k++) b.slab(s * 1.36 - 0.01, s * 1.36 + 0.01, 1.75, 2.9, -2.4 + k * 2.4, -0.6 + k * 2.4, 0xb52b24);
  }
  tyres(b, 1.2, [-3.6, 1.6, 3.7], 0.65, 0.5);
  return b.geometry();
}

/** The ambulance: a box body behind a low cab, nose along -Z. */
function ambulanceBody() {
  const b = new Batch();
  b.slab(-1.08, 1.08, 0.45, 3.0, -0.9, 3.4, WHITE);
  b.slab(-1.0, 1.0, 0.45, 2.15, -3.2, -0.9, WHITE);
  b.slab(-0.94, 0.94, 1.45, 2.05, -3.22, -3.1, GLASS);
  for (const s of [-1, 1]) b.slab(s * 1.0 - 0.01, s * 1.0 + 0.01, 1.45, 2.0, -2.9, -1.4, GLASS);
  b.slab(-1.0, 1.0, 0.3, 0.75, -3.35, -3.1, 0x33373c);
  b.slab(-1.09, 1.09, 0.95, 1.25, -0.9, 3.4, YELLOW);
  b.slab(-0.6, 0.6, 1.2, 2.6, 3.4, 3.43, 0xdfe3e6);
  b.slab(-0.9, 0.9, 3.0, 3.12, -0.85, -0.55, DARK);
  b.slab(-0.9, 0.9, 3.0, 3.12, 3.0, 3.3, DARK);
  tyres(b, 0.92, [-2.3, 2.2], 0.4, 0.3);
  return b.geometry();
}

/** A road barrier: a red-and-white plank on two trestle legs, 2.4 m wide along X. */
function barrierBody() {
  const b = new Batch();
  for (let k = 0; k < 6; k++) b.slab(-1.2 + k * 0.4, -0.8 + k * 0.4, 0.75, 1.0, -0.03, 0.03, k % 2 ? WHITE : RED);
  for (const s of [-1, 1]) {
    b.slab(s * 1.1 - 0.03, s * 1.1 + 0.03, 0, 0.75, -0.03, 0.03, 0x4a4f55);
    b.slab(s * 1.1 - 0.25, s * 1.1 + 0.25, 0, 0.04, -0.25, 0.25, 0x4a4f55);
  }
  return b.geometry();
}

function shared() {
  if (SH) return SH;
  const tex = glow();
  const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.12 });
  const sprite = (color) => new THREE.SpriteMaterial({ map: tex, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9, fog: false });
  SH = {
    tender: tenderBody(),
    ambulance: ambulanceBody(),
    cone: coneGeometry(),
    barrier: barrierBody(),
    plane: new THREE.PlaneGeometry(1, 1),
    vc,
    blueA: sprite(0x3a7bff),
    blueB: sprite(0x3a7bff),
    work: sprite(0xfff2d6),
    tape: new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide }),
    ambWord: new THREE.MeshBasicMaterial({ map: word('AMBULANCE', '#ffffff', '#1f8a4c', ['#f2d23a', '#1f8a4c']) }),
    fireWord: new THREE.MeshBasicMaterial({ map: word('FIRE RESCUE', '#c8322a', '#ffffff') }),
    tex,
  };
  SH.work.opacity = 0.3;
  return SH;
}

function beacon(mat, x, y, z, size) {
  const s = new THREE.Sprite(mat);
  s.position.set(x, y, z);
  s.scale.setScalar(size);
  s.userData.base = size;
  s.renderOrder = 3;
  return s;
}

function sideWords(g, mat, w, h, x, y, z) {
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(shared().plane, mat);
    p.scale.set(w, h, 1);
    p.position.set(side * x, y, z);
    p.rotation.y = side * Math.PI / 2;
    g.add(p);
  }
}

/** A fire engine, nose along -Z, origin mid-wheelbase on the ground. */
export function createTender() {
  const S = shared();
  const g = new THREE.Group();
  g.name = 'scene-fire-engine';
  const body = new THREE.Mesh(S.tender, S.vc);
  body.castShadow = true;
  g.add(body);
  sideWords(g, S.fireWord, 3.6, 0.55, 1.38, 2.15, 1.4);
  const lamps = [beacon(S.blueA, -0.85, 2.72, -4.0, 1.7), beacon(S.blueB, 0.85, 2.72, -4.0, 1.7), beacon(S.blueB, -1.0, 3.45, 4.6, 1.4), beacon(S.blueA, 1.0, 3.45, 4.6, 1.4)];
  for (const l of lamps) g.add(l);
  g.add(beacon(S.work, 0, 3.4, -2.7, 3.2));
  g.userData.kind = 'fire';
  g.userData.lamps = lamps;
  return g;
}

/** An ambulance, nose along -Z. */
export function createAmbulance() {
  const S = shared();
  const g = new THREE.Group();
  g.name = 'scene-ambulance';
  const body = new THREE.Mesh(S.ambulance, S.vc);
  body.castShadow = true;
  g.add(body);
  sideWords(g, S.ambWord, 3.9, 0.62, 1.1, 1.62, 1.25);
  const lamps = [beacon(S.blueA, -0.62, 3.2, -0.7, 1.4), beacon(S.blueB, 0.62, 3.2, -0.7, 1.4), beacon(S.blueB, -0.62, 3.2, 3.15, 1.2), beacon(S.blueA, 0.62, 3.2, 3.15, 1.2)];
  for (const l of lamps) g.add(l);
  g.userData.kind = 'ambulance';
  g.userData.lamps = lamps;
  return g;
}

/** A traffic cone. */
export function createCone() {
  const S = shared();
  const m = new THREE.Mesh(S.cone, S.vc);
  m.name = 'scene-cone';
  return m;
}

/** A barrier, 2.4 m along its local X. */
export function createBarrier() {
  const S = shared();
  const m = new THREE.Mesh(S.barrier, S.vc);
  m.name = 'scene-barrier';
  m.castShadow = true;
  return m;
}

/**
 * Police tape between two points at height y: a thin yellow ribbon. Its
 * geometry is this tape's own (dispose it with the scene).
 */
export function createTape(ax, az, bx, bz, y) {
  const S = shared();
  const L = Math.hypot(bx - ax, bz - az);
  const g = new THREE.PlaneGeometry(L, 0.12);
  const m = new THREE.Mesh(g, S.tape);
  m.name = 'scene-tape';
  m.position.set((ax + bx) / 2, y, (az + bz) / 2);
  m.rotation.y = -Math.atan2(bz - az, bx - ax);
  m.userData.own = g;
  return m;
}

/**
 * The two beacon phases at time t (seconds), each 0..1. Pure. With Reduce
 * flashing on: one raised-cosine pulse a second on each side, in antiphase,
 * capped at CAPS.strobe. Off: the sides alternate every FLASH_HALF seconds,
 * hard, full brightness.
 */
export function beaconLevels(t, out = { a: 0, b: 0 }) {
  if (FLASH.reduce) {
    const s = 0.5 - 0.5 * Math.cos((t / SOFT_PERIOD) * Math.PI * 2);
    out.a = s * CAPS.strobe;
    out.b = (1 - s) * CAPS.strobe;
  } else {
    const on = Math.floor(t / FLASH_HALF) % 2 === 0;
    out.a = on ? 1 : 0;
    out.b = on ? 0 : 1;
  }
  return out;
}

/** The gap between two flashes of one side with the switch off: twice the half period. */
export const FLASH_PERIOD = FLASH_HALF * 2;
/* The flash safety file's floor on a gap between flashes; the pattern above clears it. */
export { MIN_FLASH_GAP };

const LV = { a: 0, b: 0 };

/** Drive every beacon's shared materials for time t. */
export function flashBeacons(t) {
  if (!SH) return;
  beaconLevels(t, LV);
  SH.blueA.opacity = 0.06 + 0.94 * LV.a;
  SH.blueB.opacity = 0.06 + 0.94 * LV.b;
}

/** Keep a beacon readable from far off: never under `px` pixels on screen. */
export function keepVisible(obj, camPos, pxPerRad, px = 5) {
  const lamps = obj.userData.lamps;
  if (!lamps) return;
  const d = camPos.distanceTo(obj.position);
  const need = (px / pxPerRad) * d;
  for (const l of lamps) {
    const s = Math.max(l.userData.base, need);
    if (l.scale.x !== s) l.scale.setScalar(s);
  }
}

/** For the tests: the shared set exists and which pieces it has. */
export function sharedState() {
  return SH ? Object.keys(SH) : [];
}

/**
 * The cars in the flight events: airport police cars with light bars, and a
 * column of light that marks where to taxi.
 *
 * Built from boxes and cylinders like everything else in the game, and built
 * CHEAPLY: every geometry and every material here is made once for the whole
 * session and shared by every car, so a police car costs a Group and a
 * handful of Mesh wrappers and nothing that has to go to the GPU again. The
 * light bars flash by changing two shared materials, so three cars flashing
 * is two property writes a frame, not six.
 *
 * None of these is a collider. They are pictures with a position, the same
 * rule the chasing jets follow: nobody should be able to crash into a police
 * car that is there to help.
 */

import * as THREE from '../../vendor/three.module.js';
import { createPerson as rigPerson, posePerson, disposePerson } from '../staff/person.js';
import { heightAt } from '../../world/terrain.js';
import { FLASH, CAPS } from '../../render/flash-safety.js';

let G = null; // shared geometry
let M = null; // shared materials

function canvasTexture(w, h, paint) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function glowTexture() {
  return canvasTexture(64, 64, (g) => {
    const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 64, 64);
  });
}

function shared() {
  if (M) return { G, M };
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15, ...extra });
  const glow = glowTexture();
  const word = canvasTexture(256, 48, (g, w, h) => {
    g.fillStyle = '#1d4fb8';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffd23f';
    for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 16, 8);
    g.fillStyle = '#ffffff';
    g.font = 'bold 30px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('POLICE', w / 2, h / 2 + 4);
  });
  M = {
    white: std(0xf4f6f8),
    blue: std(0x1d4fb8),
    glass: std(0x1b2430, { roughness: 0.15, metalness: 0.4 }),
    tyre: std(0x14161a, { roughness: 0.95, metalness: 0 }),
    bar: std(0x202328),
    red: new THREE.MeshStandardMaterial({ color: 0xff2a1f, emissive: 0xff2a1f, emissiveIntensity: 1 }),
    blueLens: new THREE.MeshStandardMaterial({ color: 0x2a6bff, emissive: 0x2a6bff, emissiveIntensity: 1 }),
    redGlow: new THREE.SpriteMaterial({ map: glow, color: 0xff3322, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 }),
    blueGlow: new THREE.SpriteMaterial({ map: glow, color: 0x3a7bff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 }),
    word: new THREE.MeshBasicMaterial({ map: word }),
    pillar: new THREE.MeshBasicMaterial({ color: 0x8fdcff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    // The tactical team's van, the stairs truck, and the people.
    navy: std(0x1a2233, { roughness: 0.6 }),
    vanWord: new THREE.MeshBasicMaterial({ map: canvasTexture(256, 48, (g, w, h) => {
      g.fillStyle = '#1a2233';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffd23f';
      g.fillRect(0, h - 7, w, 7);
      g.fillStyle = '#ffffff';
      g.font = 'bold 30px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('POLICE', w / 2, h / 2 - 2);
    }) }),
    stairsYellow: std(0xf2c230, { roughness: 0.7 }),
    step: std(0x9aa3ad, { roughness: 0.5, metalness: 0.5 }),
    uniform: std(0x23324d, { roughness: 0.85, metalness: 0 }),
    tactical: std(0x1b1f26, { roughness: 0.85, metalness: 0 }),
    hiVis: std(0xd8f23a, { roughness: 0.8, metalness: 0 }),
    hoodie: std(0x7d8590, { roughness: 0.9, metalness: 0 }),
    skin: std(0xd9a67c, { roughness: 0.85, metalness: 0 }),
    jeans: std(0x2e3f5c, { roughness: 0.9, metalness: 0 }),
  };
  const wheel = new THREE.CylinderGeometry(0.36, 0.36, 0.28, 12);
  wheel.rotateZ(Math.PI / 2);
  G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    wheel,
    plane: new THREE.PlaneGeometry(1, 1),
    pillar: new THREE.CylinderGeometry(6, 6, 110, 24, 1, true),
    torso: new THREE.CylinderGeometry(0.26, 0.3, 0.72, 8),
    head: new THREE.SphereGeometry(0.17, 10, 8),
    legs: new THREE.BoxGeometry(0.36, 0.82, 0.22),
    cap: new THREE.CylinderGeometry(0.19, 0.19, 0.1, 10),
  };
  return { G, M };
}

function part(geo, mat, sx, sy, sz, x, y, z) {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

function wheels(g, halfTrack, halfBase) {
  const { G: g2, M: m } = shared();
  for (const x of [-halfTrack, halfTrack]) {
    for (const z of [-halfBase, halfBase]) {
      const w = new THREE.Mesh(g2.wheel, m.tyre);
      w.position.set(x, 0.36, z);
      g.add(w);
    }
  }
}

/**
 * An airport police car, nose along -Z like everything else in the game.
 * About 4.8 m long — life size, which from an airliner's flight deck is
 * small, so the light bar is what you actually see.
 */
export function createPoliceCar() {
  const { G: g2, M: m } = shared();
  const g = new THREE.Group();
  g.name = 'police-car';
  g.add(part(g2.box, m.white, 1.9, 0.72, 4.8, 0, 0.66, 0));
  g.add(part(g2.box, m.blue, 1.94, 0.24, 4.84, 0, 0.74, 0));
  g.add(part(g2.box, m.glass, 1.72, 0.56, 2.4, 0, 1.3, 0.25));
  g.add(part(g2.box, m.white, 1.74, 0.06, 2.24, 0, 1.6, 0.25));
  g.add(part(g2.box, m.bar, 1.3, 0.12, 0.36, 0, 1.69, 0.05));
  g.add(part(g2.box, m.red, 0.56, 0.16, 0.3, -0.34, 1.78, 0.05));
  g.add(part(g2.box, m.blueLens, 0.56, 0.16, 0.3, 0.34, 1.78, 0.05));
  // The word on both sides, so it reads from any angle but the ends.
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(g2.plane, m.word);
    w.scale.set(2.4, 0.46, 1);
    w.position.set(side * 0.975, 0.72, -0.1);
    w.rotation.y = side * Math.PI / 2;
    g.add(w);
  }
  wheels(g, 0.9, 1.55);
  const red = new THREE.Sprite(m.redGlow);
  red.position.set(-0.34, 1.82, 0.05);
  red.scale.setScalar(3.4);
  const blue = new THREE.Sprite(m.blueGlow);
  blue.position.set(0.34, 1.82, 0.05);
  blue.scale.setScalar(3.4);
  g.add(red, blue);
  return g;
}

/**
 * The police tactical team's van: dark, square and much bigger than a police
 * car, with the same light bar so it flashes in step with every other one.
 */
export function createVan() {
  const { G: g2, M: m } = shared();
  const g = new THREE.Group();
  g.name = 'police-van';
  g.add(part(g2.box, m.navy, 2.1, 2.1, 5.4, 0, 1.45, 0));
  g.add(part(g2.box, m.glass, 1.96, 0.7, 0.08, 0, 1.95, -2.71));
  g.add(part(g2.box, m.bar, 1.5, 0.12, 0.4, 0, 2.56, -1.9));
  g.add(part(g2.box, m.red, 0.62, 0.16, 0.32, -0.4, 2.66, -1.9));
  g.add(part(g2.box, m.blueLens, 0.62, 0.16, 0.32, 0.4, 2.66, -1.9));
  for (const side of [-1, 1]) {
    const w = new THREE.Mesh(g2.plane, m.vanWord);
    w.scale.set(3.6, 0.68, 1);
    w.position.set(side * 1.06, 1.5, 0.2);
    w.rotation.y = side * Math.PI / 2;
    g.add(w);
  }
  wheels(g, 1.0, 1.9);
  const red = new THREE.Sprite(m.redGlow);
  red.position.set(-0.4, 2.7, -1.9);
  red.scale.setScalar(4.2);
  const blue = new THREE.Sprite(m.blueGlow);
  blue.position.set(0.4, 2.7, -1.9);
  blue.scale.setScalar(4.2);
  g.add(red, blue);
  return g;
}

/**
 * An airstair truck, the kind that drives up to an aeroplane's door when
 * there is no jet bridge — which, at a stand the police have chosen, there
 * never is. Nose (-Z) is the platform end: it drives straight at the door.
 *
 * `height` is the door sill above the ground, so the same truck serves a
 * forty-seat twin and a jumbo. userData.bottom and .top are the foot and the
 * head of the stairs in the truck's own frame, for the people climbing them.
 */
export function createStairs(height = 4) {
  const { G: g2, M: m } = shared();
  const g = new THREE.Group();
  g.name = 'police-stairs';
  const h = Math.max(2, Math.min(9, height));
  const run = h * 1.35;
  const low = 0.35;
  // A low chassis, with the cab tucked under the high end of the stairs.
  g.add(part(g2.box, m.white, 2.2, 0.55, run * 0.7 + 1.2, 0, 0.6, run * 0.35 - 0.2));
  g.add(part(g2.box, m.white, 2.2, 1.35, 1.9, 0, 1.15, 0.5));
  g.add(part(g2.box, m.glass, 2.0, 0.55, 0.08, 0, 1.45, -0.47));
  wheels(g, 1.0, 1.3);
  // The platform at the top, and the flight of stairs down to the back.
  g.add(part(g2.box, m.stairsYellow, 1.7, 0.16, 1.3, 0, h, -0.45));
  const steps = Math.max(6, Math.min(26, Math.round(h / 0.26)));
  for (let i = 1; i <= steps; i++) {
    const k = i / steps;
    g.add(part(g2.box, m.step, 1.5, 0.07, 0.34, 0, h - k * (h - low), 0.2 + k * run));
  }
  // Handrails: two slanted bars along the flight, and a post each side of the platform.
  const len = Math.hypot(run, h - low);
  const tilt = Math.atan2(h - low, run);
  for (const side of [-1, 1]) {
    const rail = part(g2.box, m.stairsYellow, 0.07, 0.07, len, side * 0.8, (h + low) / 2 + 0.95, 0.2 + run / 2);
    rail.rotation.x = tilt;
    g.add(rail);
    g.add(part(g2.box, m.stairsYellow, 0.07, 1.0, 0.07, side * 0.8, h + 0.5, -0.95));
  }
  g.userData.top = new THREE.Vector3(0, h, -0.6);
  g.userData.bottom = new THREE.Vector3(0, 0, 0.2 + run + 0.7);
  g.userData.height = h;
  return g;
}

/**
 * A person, about 1.75 m tall, standing on the origin and facing -Z.
 *
 *   'police'    navy uniform, a hi-vis vest and a cap
 *   'tactical'  dark kit and a helmet — the team that boards
 *   'hijacker'  a grey hoodie and jeans
 *
 * Three boxes and a sphere from the shared set, so a crowd costs nothing
 * the GPU has not already got.
 */
export function createPerson(kind = 'police') {
  /*
   * The same jointed person as everybody else on the airfield
   * (staff/person.js), in its police, tactical or hoodie outfit — lite, five
   * draw calls — so they walk with their legs (hijack.js poses them) rather
   * than sliding across the apron as three boxes with a hop.
   */
  const outfit = kind === 'tactical' || kind === 'hijacker' ? kind : 'police';
  const g = rigPerson({ outfit, lite: true, seed: 101 + 17 * (personSeed++ % 23) });
  g.name = `person-${kind}`;
  return g;
}

let personSeed = 0;

/** Pose one of them for this frame: walking at `speed` m/s, or standing. */
export function posePersonAt(obj, dt, speed) {
  POSE.speed = speed;
  posePerson(obj, dt, POSE);
}
const POSE = { speed: 0, air: false, wave: null };

/** Free one of them (its geometry is its own). */
export function disposeEventPerson(obj) {
  disposePerson(obj);
}

/**
 * Tests only (tests/features/flicker.mjs): stand-in light-bar materials, so the
 * pattern below can be measured in node without building a car. null restores.
 */
let savedM = null;
export function __setPoliceMaterials(m) {
  if (m) {
    savedM = savedM || { M };
    M = m;
  } else if (savedM) {
    M = savedM.M;
    savedM = null;
  }
}

/** Flash every light bar. `t` is seconds; the pattern is double-flash, alternate sides. */
export function flashPolice(t) {
  if (!M) return;
  let red;
  let blue;
  if (FLASH.reduce) {
    /*
     * Reduce flashing (render/flash-safety.js). The bar below flickers each
     * colour 6.5 times a second while that side is on — five flashes in the
     * worst second, saturated red among them, the very kind the guidelines
     * are strictest about, and the police cars of the hijack park all round
     * the aeroplane. With the switch on the two colours swell back and forth
     * at the same 1.1 a second, dimmer.
     */
    const s = 0.5 - 0.5 * Math.cos(t * 2.2 * Math.PI);
    red = (1 - s) * CAPS.strobe;
    blue = s * CAPS.strobe;
  } else {
    const phase = (t * 2.2) % 2;
    const beat = (t * 13) % 2 < 1;
    red = phase < 1 && beat ? 1 : 0;
    blue = phase >= 1 && beat ? 1 : 0;
  }
  M.redGlow.opacity = 0.08 + 0.92 * red;
  M.blueGlow.opacity = 0.08 + 0.92 * blue;
  M.red.emissiveIntensity = 0.25 + 1.95 * red;
  M.blueLens.emissiveIntensity = 0.25 + 1.95 * blue;
}

/** A column of light over the place you are meant to taxi to. */
export function createPillar() {
  const { G: g2, M: m } = shared();
  const p = new THREE.Mesh(g2.pillar, m.pillar);
  p.name = 'taxi-pillar';
  p.renderOrder = 2;
  return p;
}

export function pulsePillar(t) {
  if (M) M.pillar.opacity = 0.16 + 0.1 * (0.5 + 0.5 * Math.sin(t * 3));
}

/**
 * Something with wheels that drives towards a point.
 *
 * Not a vehicle model — a heading, a speed, a turn-rate limit and the
 * ground underneath. That is all a police car crossing an airfield needs to
 * look like it is being driven, and it allocates nothing per frame.
 */
export class Driver {
  constructor(obj) {
    this.obj = obj;
    this.pos = new THREE.Vector3();
    this.heading = 0; // degrees, 0 = north, forward = (sin h, 0, -cos h)
    this.speed = 0;
    this.parked = false;
  }

  place(x, z, headingDeg = 0) {
    this.pos.set(x, heightAt(x, z), z);
    this.heading = headingDeg;
    this.speed = 0;
    this.sync();
  }

  /**
   * One frame of driving towards (tx, tz). Returns the distance left.
   * `matchSpeed`, if given, is what to settle at once close — so a chasing
   * car sits on the tail of the one it is chasing instead of stopping dead.
   */
  driveTo(tx, tz, dt, { maxSpeed = 18, accel = 6, stopAt = 5, turnRate = 85, matchSpeed = 0 } = {}) {
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const dist = Math.hypot(dx, dz);
    let want = maxSpeed;
    if (dist < stopAt) want = matchSpeed;
    else want = Math.min(maxSpeed, Math.max(matchSpeed, (dist - stopAt) * 0.8 + matchSpeed));
    if (dist > 0.5) {
      const brg = (Math.atan2(dx, -dz) * 180) / Math.PI;
      let diff = ((brg - this.heading + 540) % 360) - 180;
      // Slow down for a tight turn, the way a driver would.
      if (Math.abs(diff) > 70) want = Math.min(want, 7);
      const maxTurn = turnRate * dt * Math.min(1, 0.25 + this.speed / 8);
      diff = Math.max(-maxTurn, Math.min(maxTurn, diff));
      this.heading = (this.heading + diff + 360) % 360;
    }
    const dv = want - this.speed;
    this.speed += Math.max(-accel * 1.6 * dt, Math.min(accel * dt, dv));
    if (this.speed < 0) this.speed = 0;
    const r = (this.heading * Math.PI) / 180;
    this.pos.x += Math.sin(r) * this.speed * dt;
    this.pos.z -= Math.cos(r) * this.speed * dt;
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    this.sync();
    return dist;
  }

  sync() {
    if (!this.obj) return;
    this.obj.position.copy(this.pos);
    this.obj.rotation.set(0, -(this.heading * Math.PI) / 180, 0);
  }
}

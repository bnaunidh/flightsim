/**
 * The cars in the flight events: airport police cars with light bars, one
 * lost pizza delivery car, the stretch of perimeter fence it drives through,
 * and a column of light that marks where to taxi.
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
  const pizzaTop = canvasTexture(128, 128, (g) => {
    g.fillStyle = '#d9a441';
    g.beginPath(); g.arc(64, 64, 63, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f7d35c';
    g.beginPath(); g.arc(64, 64, 54, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#c0392b';
    const dots = [[40, 42], [82, 38], [64, 66], [36, 84], [88, 84], [60, 98], [96, 60], [30, 62]];
    for (const [x, y] of dots) { g.beginPath(); g.arc(x, y, 8, 0, Math.PI * 2); g.fill(); }
    g.fillStyle = '#3f8f3a';
    for (const [x, y] of [[52, 50], [74, 80], [48, 74], [80, 56]]) g.fillRect(x, y, 6, 3);
  });
  const pizzaSign = canvasTexture(256, 64, (g, w, h) => {
    g.fillStyle = '#ffd23f';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#c0392b';
    g.font = 'bold 40px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('PIZZA!', w / 2, h / 2 + 2);
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
    pink: std(0xff6fb1),
    cream: std(0xfff4e0),
    pizza: new THREE.MeshStandardMaterial({ map: pizzaTop, roughness: 0.8 }),
    crust: std(0xc98a35, { roughness: 0.9, metalness: 0 }),
    sign: new THREE.MeshBasicMaterial({ map: pizzaSign }),
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
    disc: new THREE.CylinderGeometry(1, 1, 1, 24),
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

/** The lost pizza car: small, pink, and carrying a pizza the size of a table. */
export function createPizzaCar() {
  const { G: g2, M: m } = shared();
  const g = new THREE.Group();
  g.name = 'pizza-car';
  g.add(part(g2.box, m.pink, 1.7, 0.7, 3.7, 0, 0.64, 0));
  g.add(part(g2.box, m.glass, 1.5, 0.55, 1.9, 0, 1.25, 0.25));
  g.add(part(g2.box, m.cream, 1.52, 0.08, 1.8, 0, 1.56, 0.25));
  // The sign on the roof, readable from both sides.
  const sign = new THREE.Mesh(g2.box, [m.cream, m.cream, m.cream, m.cream, m.sign, m.sign]);
  sign.scale.set(1.3, 0.45, 0.1);
  sign.position.set(0, 1.86, -0.25);
  sign.rotation.y = Math.PI / 2;
  g.add(sign);
  // The pizza, tilted a little, because it is not very well tied on.
  const pizza = new THREE.Mesh(g2.disc, [m.crust, m.pizza, m.crust]);
  pizza.scale.set(1.35, 0.12, 1.35);
  pizza.position.set(0, 1.72, 0.8);
  pizza.rotation.x = 0.12;
  g.add(pizza);
  wheels(g, 0.82, 1.2);
  g.userData.pizza = pizza;
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

/** Flash every light bar. `t` is seconds; the pattern is double-flash, alternate sides. */
export function flashPolice(t) {
  if (!M) return;
  const phase = (t * 2.2) % 2;
  const beat = (t * 13) % 2 < 1;
  const redOn = phase < 1 && beat;
  const blueOn = phase >= 1 && beat;
  M.redGlow.opacity = redOn ? 1 : 0.08;
  M.blueGlow.opacity = blueOn ? 1 : 0.08;
  M.red.emissiveIntensity = redOn ? 2.2 : 0.25;
  M.blueLens.emissiveIntensity = blueOn ? 2.2 : 0.25;
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
 * A stretch of chain-link fence between two points, following the ground,
 * with one panel — the one the pizza car goes through — built separately so
 * it can fall over.
 *
 * @returns {{ panel: THREE.Group, knockDown(): void, reset(): void, update(dt): void }}
 */
export function buildFence(group, a, b, breach, breachWidth = 10) {
  /*
   * Its own geometry and materials, not the shared set the cars use. The
   * fence lives in the world group, and main.js disposes everything in a
   * world group — geometry, materials and their textures — every time the
   * world is rebuilt. Sharing would hand the police cars a disposed box.
   */
  const chain = canvasTexture(64, 64, (g) => {
    g.clearRect(0, 0, 64, 64);
    g.strokeStyle = 'rgba(190,196,204,1)';
    g.lineWidth = 3;
    for (let i = -64; i < 128; i += 16) {
      g.beginPath(); g.moveTo(i, 0); g.lineTo(i + 64, 64); g.stroke();
      g.beginPath(); g.moveTo(i + 64, 0); g.lineTo(i, 64); g.stroke();
    }
  });
  chain.wrapS = chain.wrapT = THREE.RepeatWrapping;
  const m = {
    post: new THREE.MeshStandardMaterial({ color: 0x8a9199, roughness: 0.55, metalness: 0.5 }),
    wire: new THREE.MeshStandardMaterial({ map: chain, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.4 }),
  };
  const g2 = { box: new THREE.BoxGeometry(1, 1, 1) };
  const dir = new THREE.Vector3().subVectors(b, a).setY(0);
  const len = dir.length();
  dir.normalize();
  const H = 2.4;
  // Posts, one instanced mesh for the lot.
  const spacing = 4;
  const n = Math.max(2, Math.floor(len / spacing) + 1);
  const posts = new THREE.InstancedMesh(g2.box, m.post, n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    const x = a.x + dir.x * i * spacing;
    const z = a.z + dir.z * i * spacing;
    const y = heightAt(x, z);
    d.position.set(x, y + H / 2 + 0.1, z);
    d.scale.set(0.12, H + 0.2, 0.12);
    d.updateMatrix();
    posts.setMatrixAt(i, d.matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  group.add(posts);

  // Where along the fence the breach is, and the wire either side of it.
  const along = new THREE.Vector3().subVectors(breach, a).dot(dir);
  const s0 = Math.max(0, along - breachWidth / 2);
  const s1 = Math.min(len, along + breachWidth / 2);
  const strip = (from, to) => {
    const l = to - from;
    if (l < 1) return;
    const segs = Math.max(1, Math.round(l / 12));
    const geo = new THREE.PlaneGeometry(l, H, segs, 1);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const s = from + (pos.getX(i) + l / 2);
      const x = a.x + dir.x * s;
      const z = a.z + dir.z * s;
      const up = pos.getY(i) + H / 2;
      pos.setXYZ(i, x, heightAt(x, z) + 0.1 + up, z);
      uv.setXY(i, (s / H) * 1.0, up / H);
    }
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, m.wire);
    group.add(mesh);
  };
  strip(0, s0);
  strip(s1, len);

  // The panel that falls. Its pivot sits on the ground line so it hinges
  // at the bottom, the way a panel that has been driven into does.
  const mid = (s0 + s1) / 2;
  const pivot = new THREE.Group();
  const px = a.x + dir.x * mid;
  const pz = a.z + dir.z * mid;
  pivot.position.set(px, heightAt(px, pz) + 0.1, pz);
  // Local +X along the fence.
  pivot.rotation.y = Math.atan2(-dir.z, dir.x);
  const pgeo = new THREE.PlaneGeometry(s1 - s0, H);
  pgeo.translate(0, H / 2, 0);
  const uvp = pgeo.attributes.uv;
  for (let i = 0; i < uvp.count; i++) uvp.setX(i, uvp.getX(i) * ((s1 - s0) / H));
  const panel = new THREE.Mesh(pgeo, m.wire);
  pivot.add(panel);
  group.add(pivot);

  let fall = 0;
  let falling = false;
  let side = -1;
  return {
    pivot,
    /** Knock it flat, away from `from` (a world point on the side the car came from). */
    knockDown(from) {
      if (falling) return;
      falling = true;
      // Which way is away from the car: local +Z is the fence's normal.
      const nx = Math.sin(pivot.rotation.y);
      const nz = Math.cos(pivot.rotation.y);
      const s = (from.x - px) * nx + (from.z - pz) * nz;
      side = s > 0 ? -1 : 1;
    },
    reset() {
      falling = false;
      fall = 0;
      pivot.rotation.x = 0;
    },
    update(dt) {
      if (!falling || fall >= 1) return;
      fall = Math.min(1, fall + dt * 2.4);
      // A little bounce at the end, because it is a cartoon.
      const e = fall < 1 ? fall * fall : 1;
      pivot.rotation.x = side * (Math.PI / 2 - 0.06) * e;
    },
  };
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

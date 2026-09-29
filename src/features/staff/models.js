/**
 * The ramp crew's vehicles: a pushback tug, a baggage tractor and its carts,
 * a stair truck and a catering truck.
 *
 * Each is built from boxes and cylinders merged into ONE vertex-coloured mesh
 * (the same trick as the people in person.js), plus a separate mesh for the
 * one part that moves on its own — the stairs, the catering box. A vehicle is
 * two or three draw calls instead of the forty a box-per-part model costs,
 * and five of them sit on the apron at once.
 *
 * Frame: -Z forward, +X right, y = 0 on the ground, origin in the middle of
 * the wheelbase — which is where SurfaceVehicle keeps `pos` and where its four
 * wheel probes are centred. Sizes are real ones, rounded.
 *
 * Wheels are merged in and do not turn. At the 10–25 km/h these things do,
 * spinning hubs are not something anybody watches, and separate wheels would
 * have been twenty more draw calls.
 */

import * as THREE from '../../vendor/three.module.js';
import { part, mergeParts } from './person.js';

const YELLOW = 0xf2c53d;
const DARK = 0x262b31;
const TYRE = 0x17191c;
const HUB = 0x9aa2aa;
const GLASS = 0x2d3c4a;
const WHITE = 0xeef1f3;
const STEEL = 0xa8b0b8;
const GREEN = 0x2f8f5b;
const BLUE = 0x2f5f9e;
const ORANGE = 0xf06a1d;
const RED = 0xc8322a;
const GREY = 0x6b737c;

/* Unit primitives, shared, never drawn themselves. */
let PRIM = null;
function prims() {
  if (PRIM) return PRIM;
  PRIM = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(1, 1, 1, 12),
    cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  };
  return PRIM;
}

let MAT = null;
export function vehicleMaterial() {
  if (!MAT) MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
  return MAT;
}
let BEACON = null;
/** The one orange beacon material every vehicle shares; staff.js pulses it. */
export function beaconMaterial() {
  if (!BEACON) {
    BEACON = new THREE.MeshStandardMaterial({ color: ORANGE, emissive: 0xff6a00, emissiveIntensity: 0.6, roughness: 0.4 });
  }
  return BEACON;
}

/** A little parts list with the three shapes everything here is made of. */
class Kit {
  constructor() {
    this.parts = [];
    this.P = prims();
  }
  /** Box by centre and size. */
  box(w, h, d, x, y, z, color, rx = 0, ry = 0, rz = 0) {
    this.parts.push(part(this.P.box, color, x, y, z, rx, ry, rz, w, h, d));
    return this;
  }
  /** Box by its extents. */
  slab(x0, x1, y0, y1, z0, z1, color) {
    return this.box(x1 - x0, y1 - y0, z1 - z0, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, color);
  }
  /** Upright cylinder. */
  cyl(r, h, x, y, z, color, rx = 0, rz = 0) {
    this.parts.push(part(this.P.cyl, color, x, y, z, rx, 0, rz, r, h, r));
    return this;
  }
  /** A wheel lying on its side, on the ground. */
  wheel(r, width, x, z) {
    this.parts.push(part(this.P.cyl, TYRE, x, r, z, 0, 0, Math.PI / 2, r, width, r));
    this.parts.push(part(this.P.cyl6, HUB, x + Math.sign(x || 1) * (width / 2 + 0.005), r, z, 0, 0, Math.PI / 2, r * 0.45, 0.02, r * 0.45));
    return this;
  }
  wheels(r, width, halfTrack, zs) {
    for (const z of zs) for (const s of [-1, 1]) this.wheel(r, width, s * halfTrack, z);
    return this;
  }
  /** A thin bar from one point to another. */
  bar(x0, y0, z0, x1, y1, z1, r, color) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    const g = this.P.cyl6.index ? this.P.cyl6.toNonIndexed() : this.P.cyl6.clone();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx / len, dy / len, dz / len));
    m.compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, new THREE.Vector3(r, len, r));
    g.applyMatrix4(m);
    const c = new THREE.Color(color);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.parts.push(g);
    return this;
  }
  mesh() {
    const m = new THREE.Mesh(mergeParts(this.parts), vehicleMaterial());
    m.castShadow = true;
    m.receiveShadow = true;
    this.parts = [];
    return m;
  }
}

/** A cab: box, windscreen and side windows as dark insets, a roof. */
function cab(k, w, h, z0, z1, y0, color, cx = 0) {
  const a = cx - w / 2;
  const b = cx + w / 2;
  k.slab(a, b, y0, y0 + h, z0, z1, color);
  k.slab(a + 0.1, b - 0.1, y0 + h * 0.45, y0 + h - 0.1, z0 - 0.02, z0 + 0.04, GLASS);
  for (const x of [a, b]) k.slab(x - 0.02, x + 0.02, y0 + h * 0.45, y0 + h - 0.12, z0 + 0.15, z1 - 0.2, GLASS);
  k.slab(a - 0.04, b + 0.04, y0 + h, y0 + h + 0.07, z0 - 0.04, z1 + 0.04, DARK);
}

function beacon(group, x, y, z) {
  const b = new THREE.Mesh(prims().cyl, beaconMaterial());
  b.scale.set(0.11, 0.16, 0.11);
  b.position.set(x, y + 0.08, z);
  group.add(b);
  return b;
}

function finish(group, info) {
  group.userData.staff = info;
  group.name = `staff:${info.kind}`;
  return group;
}

/* ------------------------------------------------------------------ */

/**
 * Pushback tug. Low, wide and heavy, with the driver sunk into a cab at the
 * back corner so he can see past the nose, and a towbar out in front whose
 * tip pins to the aeroplane's nose leg. `hitch` is how far ahead of the
 * origin that tip is.
 */
export function createTug() {
  const k = new Kit();
  // Body: a heavy slab with a sloped nose.
  k.slab(-1.25, 1.25, 0.32, 1.15, -2.7, 2.6, YELLOW);
  k.box(2.4, 0.42, 1.0, 0, 0.98, -2.35, YELLOW, -0.45, 0, 0);
  k.slab(-1.3, 1.3, 0.22, 0.42, -2.85, 2.75, DARK); // rubbing strip
  // The sunken cab, off to the left.
  cab(k, 1.25, 1.05, 0.9, 2.45, 1.15, YELLOW, -0.55);
  // Black-and-yellow hazard bands across the nose.
  for (let i = -2; i <= 2; i += 2) k.slab(i * 0.45 - 0.2, i * 0.45 + 0.2, 0.46, 0.8, -2.88, -2.84, DARK);
  k.wheels(0.55, 0.45, 1.12, [-1.4, 1.4]);
  // Towbar: an A-frame from the nose to a ring at the tip.
  const tip = 5.2;
  k.bar(-0.55, 0.5, -2.8, 0, 0.45, -tip + 0.2, 0.06, STEEL);
  k.bar(0.55, 0.5, -2.8, 0, 0.45, -tip + 0.2, 0.06, STEEL);
  k.box(0.35, 0.12, 0.4, 0, 0.45, -tip + 0.1, DARK);
  k.cyl(0.08, 0.35, 0, 0.3, -tip + 0.3, DARK); // little wheel under the bar
  const g = new THREE.Group();
  g.add(k.mesh());
  beacon(g, -0.55, 2.27, 1.7);
  return finish(g, {
    kind: 'tug',
    name: 'Pushback tug',
    halfLength: 2.85,
    halfWidth: 1.3,
    height: 2.3,
    hitch: tip,
    eye: [-0.55, 1.9, 1.3],
  });
}

/**
 * Baggage tractor: small, green, a roll-cage roof and a tow hitch at the
 * back. Its carts are separate models (createCart) that follow it.
 */
export function createBaggageTractor() {
  const k = new Kit();
  k.slab(-0.72, 0.72, 0.28, 1.0, -1.45, 1.35, GREEN);
  k.slab(-0.7, 0.7, 0.9, 1.25, -1.45, -0.5, GREEN); // bonnet
  k.slab(-0.55, 0.55, 1.0, 1.45, 0.2, 0.75, DARK); // seat back
  k.slab(-0.6, 0.6, 1.0, 1.08, -0.3, 0.9, DARK); // seat
  for (const s of [-1, 1]) {
    k.bar(s * 0.66, 1.0, -0.45, s * 0.66, 2.15, -0.35, 0.04, DARK);
    k.bar(s * 0.66, 1.0, 1.25, s * 0.66, 2.15, 1.2, 0.04, DARK);
  }
  k.slab(-0.76, 0.76, 2.13, 2.2, -0.55, 1.35, DARK); // roof
  k.slab(-0.12, 0.12, 1.0, 1.45, -0.55, -0.35, DARK); // steering column
  k.cyl(0.2, 0.04, 0, 1.45, -0.45, DARK, 0.9, 0);
  k.slab(-0.75, 0.75, 0.2, 0.35, -1.55, -1.4, DARK); // bumper
  k.wheels(0.38, 0.3, 0.68, [-0.9, 0.9]);
  k.box(0.2, 0.12, 0.35, 0, 0.42, 1.52, DARK); // hitch
  const g = new THREE.Group();
  g.add(k.mesh());
  beacon(g, 0, 2.2, 0.4);
  return finish(g, {
    kind: 'baggage',
    name: 'Baggage tractor',
    halfLength: 1.55,
    halfWidth: 0.78,
    height: 2.25,
    rearHitch: 1.62,
    eye: [0, 1.75, 0.25],
  });
}

/**
 * A baggage cart: a bed, four posts, a canvas roof, and a load of cases you
 * can see through the open sides. Its drawbar reaches `drawbar` metres ahead
 * of its middle; it pulls the next cart from `rearHitch` behind it.
 */
export function createCart(seed = 1) {
  const k = new Kit();
  k.slab(-0.8, 0.8, 0.55, 0.7, -1.3, 1.3, GREY);
  for (const x of [-0.75, 0.75]) for (const z of [-1.25, 1.25]) k.slab(x - 0.04, x + 0.04, 0.7, 2.0, z - 0.04, z + 0.04, STEEL);
  k.slab(-0.84, 0.84, 2.0, 2.08, -1.34, 1.34, BLUE);
  k.slab(-0.84, 0.84, 0.7, 2.0, 1.28, 1.34, BLUE); // back sheet
  // Cases, stacked a little untidily. Deterministic, so a rebuild matches.
  const colours = [0x2f5d8a, 0xb23a3a, 0x3a3a3a, 0xe0a030, 0x6a4a8a, 0x2a7a6a];
  let s = seed * 7919;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 7; i++) {
    const w = 0.35 + rnd() * 0.3;
    const h = 0.28 + rnd() * 0.3;
    const d = 0.5 + rnd() * 0.25;
    const x = -0.45 + (i % 3) * 0.45 + (rnd() - 0.5) * 0.1;
    const z = -0.9 + Math.floor(i / 3) * 0.75;
    const y = 0.7 + h / 2 + (i >= 6 ? 0.55 : 0);
    k.box(w, h, d, x, y, z, colours[i % colours.length], 0, (rnd() - 0.5) * 0.4, 0);
  }
  k.bar(0, 0.45, -1.3, 0, 0.42, -2.2, 0.035, DARK); // drawbar
  k.wheels(0.3, 0.22, 0.62, [-0.85, 0.85]);
  const g = new THREE.Group();
  g.add(k.mesh());
  return finish(g, {
    kind: 'cart',
    name: 'Baggage cart',
    halfLength: 1.35,
    halfWidth: 0.85,
    height: 2.1,
    drawbar: 2.2,
    rearHitch: 1.35,
  });
}

/**
 * Stair truck. A truck with a flight of steps on its back that rises toward
 * the front, over the cab, to a platform with rails: you drive it nose-first
 * at the aeroplane's door. The steps are their own mesh, built to rise ONE
 * metre and scaled to the door's height, so the same truck serves a trainer
 * sill and an airliner's.
 */
export function createStairTruck() {
  const k = new Kit();
  // Chassis and cab.
  k.slab(-1.05, 1.05, 0.45, 0.85, -3.3, 3.2, DARK);
  cab(k, 2.1, 1.35, -3.5, -1.8, 0.75, WHITE);
  k.slab(-1.08, 1.08, 0.75, 1.1, -3.55, -3.4, DARK); // bumper
  k.slab(-1.0, 1.0, 0.85, 1.05, -1.8, 3.2, STEEL); // deck
  k.wheels(0.5, 0.4, 1.0, [-2.3, 2.0]);
  const g = new THREE.Group();
  g.add(k.mesh());

  /*
   * The flight of steps, built one metre high: bottom tread at the back on
   * the deck, top tread at the front. It is scaled in y to the platform's
   * height above the deck. The handrail is its own mesh, scaled the same but
   * lifted 0.95 m, and the platform is NOT scaled — it only moves — so its
   * rails stay rails at any height.
   */
  const s = new Kit();
  const n = 12;
  const zBack = 3.0;
  const zTop = -2.2;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const z = zBack + (zTop - zBack) * t;
    s.slab(-0.75, 0.75, t - 0.012, t + 0.012, z - 0.2, z + 0.2, STEEL);
  }
  for (const x of [-0.8, 0.8]) s.bar(x, 0, zBack, x, 1, zTop, 0.05, WHITE);
  for (const x of [-0.7, 0.7]) s.slab(x - 0.06, x + 0.06, 0, 1, -3.0, -2.85, WHITE); // legs under the platform
  const flight = s.mesh();
  const r = new Kit();
  // No posts: a vertical post in a mesh scaled in y is a post of the wrong
  // height. The rail meets the platform's own (unscaled) posts at the top.
  for (const x of [-0.8, 0.8]) r.bar(x, 0, zBack, x, 1, zTop, 0.03, YELLOW);
  const rail = r.mesh();
  const p = new Kit();
  p.slab(-0.85, 0.85, -0.03, 0, -3.9, zTop, STEEL);
  for (const x of [-0.85, 0.85]) {
    p.slab(x - 0.03, x + 0.03, 0.9, 0.95, -3.85, zTop, YELLOW);
    for (const z of [-3.85, -3.0, zTop]) p.slab(x - 0.03, x + 0.03, 0, 0.95, z - 0.03, z + 0.03, YELLOW);
  }
  p.slab(-0.9, 0.9, -0.1, 0, -4.05, -3.9, DARK);
  const platform = p.mesh();
  const lift = new THREE.Group();
  lift.add(flight, rail, platform);
  g.add(lift);
  beacon(g, 0.6, 2.2, -2.4);
  const info = {
    kind: 'stairs',
    name: 'Stair truck',
    halfLength: 3.6,
    halfWidth: 1.1,
    height: 3.2,
    /** The platform's leading edge, metres ahead of the origin. */
    reach: 4.05,
    deck: 1.05,
    lift,
    flight,
    rail,
    platform,
    liftMin: 2.0,
    liftMax: 5.2,
    eye: [0, 2.05, -2.7],
  };
  setLift(finish(g, info), 2.2);
  return g;
}

/**
 * Catering truck: a blue cab and a white box on a scissor lift. The box
 * lifts until its front platform, which reaches out over the cab, is level
 * with the galley door.
 */
export function createCateringTruck() {
  const k = new Kit();
  k.slab(-1.1, 1.1, 0.45, 0.85, -3.8, 3.8, DARK);
  cab(k, 2.2, 1.45, -4.1, -2.4, 0.75, BLUE);
  k.slab(-1.12, 1.12, 0.75, 1.1, -4.15, -4.0, DARK);
  k.wheels(0.52, 0.42, 1.02, [-2.7, 2.5]);
  const g = new THREE.Group();
  g.add(k.mesh());

  const b = new Kit();
  // The box, unit-positioned: its floor at y = 0 of the lift group.
  b.slab(-1.2, 1.2, 0, 2.5, -2.1, 3.7, WHITE);
  b.slab(-1.21, 1.21, 1.0, 1.25, -2.1, 3.7, RED); // livery stripe
  b.slab(-1.0, 1.0, 0.0, 0.05, -4.3, -2.1, STEEL); // platform over the cab
  for (const x of [-1.0, 1.0]) b.slab(x - 0.03, x + 0.03, 0.05, 1.0, -4.25, -2.1, YELLOW);
  b.slab(-1.05, 1.05, -0.08, 0.05, -4.45, -4.3, DARK);
  const box = b.mesh();
  // Scissor struts, a separate mesh scaled with the lift height.
  const sc = new Kit();
  for (const x of [-0.9, 0.9]) {
    sc.bar(x, 0, -1.6, x, 1, 3.0, 0.07, STEEL);
    sc.bar(x, 1, -1.6, x, 0, 3.0, 0.07, STEEL);
  }
  const scissor = sc.mesh();
  scissor.position.y = 0.9;
  const lift = new THREE.Group();
  lift.add(box);
  g.add(lift, scissor);
  beacon(g, -0.6, 2.2, -3.0);
  const info = {
    kind: 'catering',
    name: 'Catering truck',
    halfLength: 4.1,
    halfWidth: 1.2,
    height: 3.6,
    reach: 4.45,
    deck: 0.9,
    lift,
    scissor,
    liftMin: 1.05,
    liftMax: 5.4,
    eye: [0, 2.1, -3.2],
  };
  setLift(finish(g, info), 1.05);
  return g;
}

/**
 * Raise or lower whatever lifts on this vehicle so its platform is `h`
 * metres above the ground. Clamped to what the machine can reach.
 */
export function setLift(model, h) {
  const info = model && model.userData && model.userData.staff;
  if (!info || !info.lift) return 0;
  const want = Math.max(info.liftMin, Math.min(info.liftMax, h));
  if (info.kind === 'stairs') {
    const rise = Math.max(0.2, want - info.deck);
    info.flight.position.y = info.deck;
    info.flight.scale.y = rise;
    info.rail.position.y = info.deck + 0.95;
    info.rail.scale.y = rise;
    info.platform.position.y = want;
  } else if (info.kind === 'catering') {
    info.lift.position.y = want;
    if (info.scissor) info.scissor.scale.y = Math.max(0.05, want - info.deck);
  }
  info.liftH = want;
  return want;
}

/** Every vehicle the ramp crew drives, by id. */
export const BUILDERS = {
  tug: createTug,
  baggage: createBaggageTractor,
  stairs: createStairTruck,
  catering: createCateringTruck,
};

/** Free a vehicle's geometry. The materials are shared and stay. */
export function disposeVehicle(model) {
  if (!model) return;
  model.traverse((o) => {
    if (o.isMesh && o.geometry && !Object.values(prims()).includes(o.geometry)) o.geometry.dispose();
  });
  if (model.parent) model.parent.remove(model);
}

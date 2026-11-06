/**
 * A crowd: every ambient person on the airfield in ONE draw call.
 *
 * staff/person.js builds one figure as a rig of jointed groups — eleven draw
 * calls a walker, right for the one you play and the dozen in a story scene,
 * far too many for a hundred people on an apron. Here a person is one INSTANCE
 * of one mesh: the whole figure is a single geometry (figureGeometry) whose
 * vertices know which part of the body they are (`aRig`), and the vertex
 * shader walks it. So a walking person costs the frame loop one matrix and
 * four numbers, and a person who is not walking costs nothing more.
 *
 * THE FIGURE. 1.75 m, feet at y = 0, facing -Z, in real proportions (seven and
 * a half heads, hips at 0.93, shoulders 0.42 across): tapered limbs on real
 * joints, knees and elbows that bend, hands, shoes, a face. The clothes are in
 * the geometry and switched per instance, so the same mesh is a traveller in
 * a T-shirt and shorts with a roller case, a business suit on the phone, a
 * pilot in a white shirt and cap, a guard in olive, or a ramp worker in hi-vis
 * with reflective bands and ear defenders. A part someone is not wearing folds
 * to a point inside the body and draws nothing.
 *
 * SWAPPING IT. Better people can come later (the owner's Sketchfab sign-in is
 * pending). Anything that supplies `position`, `normal`, `color` (the shade)
 * and `aRig` (part, side, tint: the PART and TINT tables below) can replace
 * figureGeometry(): pass it as `opts.figure`. Everything that drives the crowd
 * talks to draw(), not to the figure.
 *
 * ON LOW the same figure with fewer sides, and the same walk: fewer people, not
 * a different kind of person.
 *
 * COST. Nothing allocated per frame. Matrices are written only for the people
 * drawn — within DRAW_FAR of the camera — packed to the front of the mesh
 * (mesh.count is the drawn count), at half rate past HALF_RATE; a person's
 * clothes are written only when they change slot. One bounding sphere round
 * the airfield culls the lot when it is behind you. Lambert, smooth-shaded;
 * shadows only on High and Ultra.
 */

import * as THREE from '../../vendor/three.module.js';

/** Metres: nobody is drawn further away than this (a person is 1.7 m — four pixels by then). */
export const DRAW_FAR = 650;
/** Beyond this the matrices are written every other frame. */
const HALF_RATE = 220;

/** Which part of the body a vertex is (aRig.x). */
export const PART = Object.freeze({ body: 0, head: 1, armUp: 2, armLow: 3, legUp: 4, legLow: 5, roller: 6, pack: 7, satchel: 8, vest: 9, hat: 10, longHair: 11, ears: 12, hair: 13, visor: 14 });
/** What colours it (aRig.z): the person's palette, or 6: only the vertex colour. */
export const TINT = Object.freeze({ shirt: 0, trousers: 1, skin: 2, hair: 3, accent: 4, bag: 5, fixed: 6, sleeve: 7, shin: 8 });
/** The bits of a person's flags. */
export const WEAR = Object.freeze({ vest: 1, hat: 2, longHair: 4, shortSleeves: 8, shorts: 16, phone: 32, ears: 64 });

/** Shirt, trousers, the extras per outfit (plan.js OUTFIT). */
const OUTFITS = [
  { shirt: 0x24324a, trousers: 0x24324a, accent: 0xd8f21c, wear: WEAR.vest | WEAR.ears }, // hi-vis yellow over navy overalls
  { shirt: 0x24324a, trousers: 0x24324a, accent: 0xf3701c, wear: WEAR.vest | WEAR.ears }, // hi-vis orange
  { shirt: 0xf4f6f8, trousers: 0x1f2a3a, accent: 0x1f2a3a, wear: WEAR.hat }, // pilot: white shirt, dark trousers, cap
  { shirt: 0x4b5a3a, trousers: 0x3e4a30, accent: 0x2f3826, wear: WEAR.hat }, // base guard: olive, dark cap
  { shirt: 0x2b3a55, trousers: 0x2b3a55, accent: 0xd8f21c, wear: WEAR.vest }, // crew chief: blue coveralls
  null, // travellers: chosen per person
  { shirt: 0x1d2b4a, trousers: 0x1d2b4a, accent: 0xc8362e, wear: WEAR.hat }, // cabin crew: navy, a red cap band
  { shirt: 0x252b33, trousers: 0x252b33, accent: 0x252b33, wear: 0 }, // terminal staff: dark suit
];
const SHIRTS = [0xc8453b, 0x2f6fbd, 0x3a8f63, 0xd9a02e, 0x7a4fb0, 0xe4e4e0, 0x2b9c9a, 0x30343a, 0xa8552c, 0x74838f, 0xd96f93, 0x1f3b66, 0x55606b, 0xb9a98c];
const TROUSERS = [0x2b3444, 0x4e3e30, 0x35587f, 0x3e3e3e, 0x626a75, 0xb8a98c, 0x1d1d1f, 0x31405a];
const SKIN = [0xf0ccb0, 0xe2b48f, 0xc99468, 0xa87349, 0x825433, 0x5c3a22];
const HAIR = [0x2a1b12, 0x45291a, 0x74461f, 0xbf9346, 0x151515, 0x8f8f8f, 0xa8522a];
const CASES = [0x1f2a3a, 0x7c1d28, 0x2a568f, 0x30343a, 0xb8a98c, 0x2a6044];

const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** A colour as one float: three 8-bit channels, linear. The shader unpacks them. */
function pack(hex) {
  _c.set(hex);
  return Math.round(_c.r * 255) * 65536 + Math.round(_c.g * 255) * 256 + Math.round(_c.b * 255);
}

/* ------------------------------------------------------------------ */
/* The figure                                                          */
/* ------------------------------------------------------------------ */

/** Collects pieces into one geometry, every vertex knowing its part, side and tint. */
class Figure {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.rig = [];
    this.col = [];
    this.idx = [];
  }

  /** Any indexed geometry as (part, side, tint), in colour `hex` (the vertex shade). */
  add(g, part, side, tint, hex = 0xffffff) {
    const base = this.pos.length / 3;
    const P = g.attributes.position;
    const N = g.attributes.normal;
    _c.set(hex);
    for (let i = 0; i < P.count; i++) {
      this.pos.push(P.getX(i), P.getY(i), P.getZ(i));
      this.nrm.push(N.getX(i), N.getY(i), N.getZ(i));
      this.rig.push(part, side, tint);
      this.col.push(_c.r, _c.g, _c.b);
    }
    const I = g.index;
    if (I) for (let i = 0; i < I.count; i++) this.idx.push(base + I.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
    g.dispose();
  }

  /** A loft through elliptical rings { y, rx, rz, x?, z? }, capped at both ends. */
  tube(rings, sides, part, side, tint, hex) {
    const pos = [];
    const idx = [];
    for (const r of rings) {
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        pos.push((r.x || 0) + Math.cos(a) * r.rx, r.y, (r.z || 0) + Math.sin(a) * r.rz);
      }
    }
    const up = rings[rings.length - 1].y >= rings[0].y;
    for (let j = 0; j < rings.length - 1; j++) {
      for (let i = 0; i < sides; i++) {
        const a = j * sides + i;
        const b = j * sides + ((i + 1) % sides);
        const c = a + sides;
        const d = b + sides;
        if (up) idx.push(a, c, b, b, c, d);
        else idx.push(a, b, c, b, d, c);
      }
    }
    const n = pos.length / 3;
    const c0 = rings[0];
    const c1 = rings[rings.length - 1];
    pos.push(c0.x || 0, c0.y, c0.z || 0, c1.x || 0, c1.y, c1.z || 0);
    const last = (rings.length - 1) * sides;
    for (let i = 0; i < sides; i++) {
      const j = (i + 1) % sides;
      if (up) idx.push(n, i, j, n + 1, last + j, last + i);
      else idx.push(n, j, i, n + 1, last + i, last + j);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.add(g, part, side, tint, hex);
  }

  box(w, h, d, x, y, z, part, side, tint, hex) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    this.add(g, part, side, tint, hex);
  }

  sphere(rx, ry, rz, x, y, z, part, side, tint, hex, seg = 10, rows = 7, thetaLen = Math.PI) {
    const g = new THREE.SphereGeometry(1, seg, rows, 0, Math.PI * 2, 0, thetaLen);
    g.scale(rx, ry, rz);
    g.translate(x, y, z);
    this.add(g, part, side, tint, hex);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aRig', new THREE.Float32BufferAttribute(this.rig, 3));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/**
 * One person, every garment and bag on at once. `detail`: 0 for Low (fewest
 * sides, no face), 1 Medium, 2 High and Ultra.
 */
export function figureGeometry(detail = 2) {
  const f = new Figure();
  const s = detail >= 2 ? 9 : detail === 1 ? 7 : 5;
  const limb = detail >= 2 ? 7 : detail === 1 ? 6 : 4;
  const { body, head, armUp, armLow, legUp, legLow, roller, pack: backpack, satchel, vest, hat, longHair, ears, hair, visor } = PART;
  const SILVER = 0xdfe4e6;
  const DARK = 0x1d2024;

  // The torso, hips to neck: wider at the shoulder and the hip than at the waist, flatter front to back.
  const trunk = [
    { y: 0.87, rx: 0.155, rz: 0.1 },
    { y: 0.96, rx: 0.175, rz: 0.115 },
    { y: 1.08, rx: 0.155, rz: 0.1 },
    { y: 1.22, rx: 0.175, rz: 0.115, z: -0.005 },
    { y: 1.36, rx: 0.19, rz: 0.115, z: -0.005 },
    { y: 1.44, rx: 0.165, rz: 0.085 },
    { y: 1.475, rx: 0.06, rz: 0.055 },
  ];
  // Hips in the trousers' colour, the rest the shirt.
  f.tube(trunk.slice(0, 3), s, body, 0, TINT.trousers);
  f.tube(trunk.slice(2), s, body, 0, TINT.shirt);
  f.tube([{ y: 1.46, rx: 0.052, rz: 0.052 }, { y: 1.54, rx: 0.048, rz: 0.05 }], limb, body, 0, TINT.skin);
  // The head, and hair over its crown and back.
  f.sphere(0.092, 0.115, 0.104, 0, 1.635, 0, head, 0, TINT.skin, 0xffffff, s + 1, detail >= 1 ? 7 : 5);
  f.sphere(0.098, 0.1, 0.11, 0, 1.655, 0.012, hair, 0, TINT.hair, 0xffffff, s + 1, detail >= 1 ? 5 : 3, Math.PI * 0.58);
  if (detail >= 1) {
    // A face: the nose, and the eyes and mouth as shadows across it.
    f.box(0.022, 0.05, 0.03, 0, 1.625, -0.103, head, 0, TINT.skin);
    for (const x of [-0.036, 0.036]) f.box(0.024, 0.012, 0.01, x, 1.655, -0.094, head, 0, TINT.fixed, 0x241a14);
    f.box(0.05, 0.008, 0.01, 0, 1.575, -0.094, head, 0, TINT.fixed, 0x7a4a3c);
    // Long hair, down to the shoulders.
    f.tube([{ y: 1.7, rx: 0.1, rz: 0.1, z: 0.02 }, { y: 1.56, rx: 0.115, rz: 0.1, z: 0.035 }, { y: 1.44, rx: 0.095, rz: 0.06, z: 0.06 }], s, longHair, 0, TINT.hair);
  }
  // A cap: crown, band and peak.
  f.tube([{ y: 1.685, rx: 0.103, rz: 0.113, z: 0.004 }, { y: 1.735, rx: 0.113, rz: 0.122, z: 0.006 }, { y: 1.775, rx: 0.1, rz: 0.11, z: 0.008 }], s, hat, 0, TINT.accent);
  f.box(0.16, 0.012, 0.09, 0, 1.695, -0.135, visor, 0, TINT.fixed, 0x15181c);
  // Ear defenders over the crown.
  if (detail >= 1) {
    for (const x of [-1, 1]) f.box(0.03, 0.07, 0.07, x * 0.1, 1.635, 0, ears, 0, TINT.fixed, 0x202428);
    f.box(0.2, 0.014, 0.024, 0, 1.76, 0, ears, 0, TINT.fixed, 0x202428);
  }
  // A hi-vis vest over the torso, reflective bands round it, and round the shins.
  f.tube([{ y: 0.98, rx: 0.183, rz: 0.125 }, { y: 1.08, rx: 0.17, rz: 0.115 }, { y: 1.22, rx: 0.188, rz: 0.128, z: -0.005 }, { y: 1.36, rx: 0.202, rz: 0.128, z: -0.005 }, { y: 1.44, rx: 0.172, rz: 0.095 }], s, vest, 0, TINT.accent);
  if (detail >= 1) {
    f.tube([{ y: 1.1, rx: 0.176, rz: 0.121 }, { y: 1.15, rx: 0.183, rz: 0.126 }], s, vest, 0, TINT.fixed, SILVER);
    f.tube([{ y: 1.27, rx: 0.2, rz: 0.134, z: -0.005 }, { y: 1.32, rx: 0.206, rz: 0.134, z: -0.005 }], s, vest, 0, TINT.fixed, SILVER);
  }

  for (const side of [-1, 1]) {
    const hip = side * 0.095;
    // The thigh, from the hip to the knee, then the shin and shoe (the leg's joints are in the shader).
    f.tube([{ y: 0.93, rx: 0.085, rz: 0.09, x: hip }, { y: 0.74, rx: 0.075, rz: 0.08, x: hip }, { y: 0.52, rx: 0.056, rz: 0.06, x: hip }], limb, legUp, side, TINT.trousers);
    f.tube([{ y: 0.52, rx: 0.056, rz: 0.06, x: hip }, { y: 0.36, rx: 0.056, rz: 0.062, x: hip, z: 0.005 }, { y: 0.12, rx: 0.038, rz: 0.044, x: hip }, { y: 0.08, rx: 0.04, rz: 0.05, x: hip }], limb, legLow, side, TINT.shin);
    f.tube([{ y: 0.0, rx: 0.05, rz: 0.13, x: hip, z: -0.05 }, { y: 0.05, rx: 0.052, rz: 0.13, x: hip, z: -0.05 }, { y: 0.1, rx: 0.042, rz: 0.08, x: hip, z: -0.005 }], limb, legLow, side, TINT.fixed, 0x1f1f22);
    // The arm: shoulder to elbow, elbow to wrist, a hand.
    const sh = side * 0.222;
    f.sphere(0.058, 0.06, 0.062, sh, 1.405, 0, armUp, side, TINT.shirt, 0xffffff, limb + 1, 4);
    f.tube([{ y: 1.42, rx: 0.052, rz: 0.055, x: sh }, { y: 1.26, rx: 0.046, rz: 0.05, x: sh + side * 0.008 }, { y: 1.12, rx: 0.04, rz: 0.043, x: sh + side * 0.014 }], limb, armUp, side, TINT.shirt);
    f.tube([{ y: 1.12, rx: 0.04, rz: 0.043, x: sh + side * 0.014 }, { y: 1.0, rx: 0.038, rz: 0.042, x: sh + side * 0.018 }, { y: 0.86, rx: 0.028, rz: 0.03, x: sh + side * 0.022 }], limb, armLow, side, TINT.sleeve);
    f.tube([{ y: 0.865, rx: 0.028, rz: 0.03, x: sh + side * 0.022 }, { y: 0.81, rx: 0.026, rz: 0.042, x: sh + side * 0.024 }, { y: 0.76, rx: 0.017, rz: 0.034, x: sh + side * 0.025 }], Math.max(4, limb - 2), armLow, side, TINT.skin);
  }

  // A roller case (in the shader it stands beside you or rolls behind, tipped on its wheels), the handle up.
  f.box(0.36, 0.52, 0.22, 0, 0.33, 0, roller, 1, TINT.bag);
  if (detail >= 1) for (const x of [-0.12, 0, 0.12]) f.box(0.012, 0.5, 0.232, x, 0.33, 0, roller, 1, TINT.fixed, DARK);
  f.box(0.03, 0.42, 0.02, -0.05, 0.78, 0.09, roller, 1, TINT.fixed, 0x3a3e42);
  f.box(0.03, 0.42, 0.02, 0.05, 0.78, 0.09, roller, 1, TINT.fixed, 0x3a3e42);
  f.box(0.14, 0.025, 0.03, 0, 0.99, 0.09, roller, 1, TINT.fixed, DARK);
  f.box(0.3, 0.05, 0.05, 0, 0.04, 0.1, roller, 1, TINT.fixed, 0x15161a);
  // A backpack, its straps over the shoulders.
  f.tube([{ y: 1.04, rx: 0.13, rz: 0.08, z: 0.19 }, { y: 1.2, rx: 0.15, rz: 0.1, z: 0.2 }, { y: 1.36, rx: 0.13, rz: 0.08, z: 0.19 }, { y: 1.42, rx: 0.08, rz: 0.04, z: 0.17 }], limb, backpack, 0, TINT.bag);
  if (detail >= 1) for (const x of [-0.11, 0.11]) f.box(0.04, 0.3, 0.26, x, 1.3, -0.005, backpack, 0, TINT.fixed, DARK);
  // A shoulder bag on the left hip, its strap across the chest.
  f.box(0.28, 0.2, 0.09, -0.21, 0.97, 0.03, satchel, 0, TINT.bag);
  if (detail >= 1) f.box(0.5, 0.03, 0.02, 0, 1.22, -0.123, satchel, 0, TINT.fixed, DARK);
  return f.geometry();
}

/* ------------------------------------------------------------------ */
/* The walk, in the shader                                             */
/* ------------------------------------------------------------------ */

const RIG_PARS = /* glsl */ `
  attribute vec3 aRig;
  attribute vec4 iPose;   // walk phase, how much walking (0..1), how much sitting (0..1), light (0..1)
  attribute vec4 iCol;    // shirt, trousers, skin, hair
  attribute vec4 iLook;   // accent, what they wear (bits), the bag's colour, which bag (0 none, 1 roller, 2 pack, 3 satchel)
  vec3 unpackRGB(float v) { return vec3(floor(v / 65536.0), mod(floor(v / 256.0), 256.0), mod(v, 256.0)) / 255.0; }
  float bitOf(float f, float b) { return mod(floor(f / b), 2.0); }
  vec3 rotX(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(v.x, v.y * c - v.z * s, v.y * s + v.z * c); }
  /* Walk one vertex and its normal along the joints it hangs from. */
  void walkRig(inout vec3 p, inout vec3 n) {
    float part = aRig.x;
    float side = aRig.y;
    float walk = iPose.y;
    float sit = iPose.z;
    float flags = iLook.y;
    float bag = iLook.w;
    bool none = (part > 5.5 && part < 6.5 && bag != 1.0) || (part > 6.5 && part < 7.5 && bag != 2.0) || (part > 7.5 && part < 8.5 && bag != 3.0)
      || (part > 8.5 && part < 9.5 && bitOf(flags, 1.0) < 0.5) || (part > 9.5 && part < 10.5 && bitOf(flags, 2.0) < 0.5)
      || (part > 10.5 && part < 11.5 && (bitOf(flags, 4.0) < 0.5 || bitOf(flags, 2.0) > 0.5)) || (part > 11.5 && part < 12.5 && bitOf(flags, 64.0) < 0.5)
      || (part > 13.5 && bitOf(flags, 2.0) < 0.5);
    if (none) { p = vec3(0.0, 1.2, 0.0); return; }
    float ph = iPose.x + (side > 0.0 ? 3.14159265 : 0.0);
    if (part > 1.5 && part < 3.5) {
      // Arm: swinging against its own leg, the elbow a little bent; sat, hands on the knees.
      float swing = -sin(ph) * 0.42 * walk;
      float elbow = 0.14 + walk * (0.18 + 0.22 * max(0.0, sin(ph)));
      if (bag == 1.0 && side > 0.0) { swing = -0.34 * max(walk, 0.5); elbow = 0.1; }
      if (bitOf(flags, 32.0) > 0.5 && side < 0.0 && walk < 0.5) { swing = 0.5; elbow = 2.35; }
      swing = mix(swing, 0.42, sit);
      elbow = mix(elbow, 0.95, sit);
      vec3 sh = vec3(side * 0.222, 1.42, 0.0);
      vec3 el = vec3(side * 0.236, 1.12, 0.0);
      if (part > 2.5) { p = el + rotX(p - el, elbow); n = rotX(n, elbow); }
      p = sh + rotX(p - sh, swing);
      n = rotX(n, swing);
    } else if (part > 3.5 && part < 5.5) {
      // Leg: the hip swings it, the knee folds on the way through.
      float swing = sin(ph) * 0.44 * walk;
      float knee = -walk * (0.1 + 0.95 * pow(max(0.0, cos(ph)), 2.0));
      swing = mix(swing, 1.5, sit);
      knee = mix(knee, -1.5, sit);
      vec3 hp = vec3(side * 0.095, 0.93, 0.0);
      vec3 kn = vec3(side * 0.095, 0.52, 0.0);
      if (part > 4.5) { p = kn + rotX(p - kn, knee); n = rotX(n, knee); }
      p = hp + rotX(p - hp, swing);
      n = rotX(n, swing);
    } else if (part > 5.5 && part < 6.5) {
      // The case: stood by your side, or rolling behind, tipped back on its wheels.
      float tip = -0.5 * walk;
      vec3 wheel = vec3(0.0, 0.0, 0.1);
      p = wheel + rotX(p - wheel, tip);
      n = rotX(n, tip);
      p += vec3(0.32, 0.0, mix(0.1, 0.42, walk));
    }
    // The body rises and falls a little on each step (the feet stay down).
    if (part < 3.5 || part > 6.5) p.y += abs(sin(iPose.x)) * 0.02 * walk;
  }
`;

const RIG_COLOUR = /* glsl */ `
  {
    float tint = aRig.z;
    vec3 pal = vec3(1.0);
    if (tint < 0.5) pal = unpackRGB(iCol.x);
    else if (tint < 1.5) pal = unpackRGB(iCol.y);
    else if (tint < 2.5) pal = unpackRGB(iCol.z);
    else if (tint < 3.5) pal = unpackRGB(iCol.w);
    else if (tint < 4.5) pal = unpackRGB(iLook.x);
    else if (tint < 5.5) pal = unpackRGB(iLook.z);
    else if (tint > 6.5 && tint < 7.5) pal = bitOf(iLook.y, 8.0) > 0.5 ? unpackRGB(iCol.z) : unpackRGB(iCol.x);
    else if (tint > 7.5) pal = bitOf(iLook.y, 16.0) > 0.5 ? unpackRGB(iCol.z) : unpackRGB(iCol.y);
    vColor.rgb *= pal * iPose.w;
  }
`;

/** Lambert with the rig: the colour material, and (for shadows) the depth one. */
function rigged(mat, colour) {
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${RIG_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  { vec3 q = vec3(0.0, 1.0, 0.0); walkRig(transformed, q); }');
    if (colour) {
      sh.vertexShader = sh.vertexShader
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  { vec3 q = position; walkRig(q, objectNormal); }')
        .replace('#include <color_vertex>', `#include <color_vertex>\n${RIG_COLOUR}`);
    }
  };
  mat.customProgramCacheKey = () => (colour ? 'crowd-rig-v1' : 'crowd-rig-depth-v1');
  return mat;
}

/* ------------------------------------------------------------------ */
/* The crowd                                                           */
/* ------------------------------------------------------------------ */

export class Crowd {
  /**
   * `max` people at most. opts: `shadows` lets them cast (High and Ultra);
   * `simple` Low's figure; `detail` overrides it (0, 1, 2); `figure` a
   * geometry of your own (figureGeometry's attributes).
   */
  constructor(max, { shadows = false, rnd = Math.random, simple = false, detail = null, figure = null } = {}) {
    this.max = Math.max(1, max | 0);
    this.group = new THREE.Group();
    this.group.name = 'world-life:people';
    this.simple = !!simple;
    this.geo = figure ? figure.clone() : figureGeometry(detail != null ? detail : simple ? 0 : shadows ? 2 : 1);
    this.mat = rigged(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), true);
    const N = this.max;
    const mesh = new THREE.InstancedMesh(this.geo, this.mat, N);
    mesh.name = 'people:crowd';
    mesh.count = 0;
    mesh.castShadow = !!shadows;
    mesh.receiveShadow = false;
    mesh.frustumCulled = true;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (shadows) {
      this.depthMat = rigged(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), false);
      mesh.customDepthMaterial = this.depthMat;
    }
    this.mesh = mesh;
    this.meshes = [mesh];
    this.group.add(mesh);
    const attr = (name) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(N * 4), 4);
      a.setUsage(THREE.DynamicDrawUsage);
      this.geo.setAttribute(name, a);
      return a;
    };
    this.pose4 = attr('iPose');
    this.col4 = attr('iCol');
    this.look4 = attr('iLook');
    // Per person: looks, chosen once.
    this.looks = [];
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    for (let i = 0; i < N; i++) {
      const r = rnd();
      let wear = 0;
      if (rnd() < 0.45) wear |= WEAR.longHair;
      if (rnd() < 0.4) wear |= WEAR.shortSleeves;
      if (rnd() < 0.15) wear |= WEAR.shorts;
      if (rnd() < 0.18) wear |= WEAR.phone;
      if (rnd() < 0.08) wear |= WEAR.hat;
      this.looks.push({
        shirt: pack(pick(SHIRTS)),
        trousers: pack(pick(TROUSERS)),
        skin: pack(pick(SKIN)),
        hair: pack(pick(HAIR)),
        bagCol: pack(pick(CASES)),
        accent: pack(pick(SHIRTS)),
        // Without a roller case, about half carry something else.
        bag2: r < 0.3 ? 2 : r < 0.5 ? 3 : 0,
        wear,
        height: 0.92 + rnd() * 0.13,
      });
    }
    this.outfits = OUTFITS.map((o) => (o ? { shirt: pack(o.shirt), trousers: pack(o.trousers), accent: pack(o.accent), wear: o.wear } : null));
    this.drawn = 0;
    this.frame = 0;
  }

  /** One sphere round everybody, so the whole crowd culls as one when it is out of view. */
  setBounds(x, y, z, r) {
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(x, y, z), r);
  }

  /**
   * Draw everybody. `people` is the runtime's list (features/world-life.js):
   * { x, y, z, yaw, walk (phase, radians), moving, shift, outfit, bag,
   * hidden, look, dim?, sit? }. `cam` is a Vector3.
   */
  draw(people, cam) {
    this.frame++;
    let n = 0;
    const far2 = DRAW_FAR * DRAW_FAR;
    const half2 = HALF_RATE * HALF_RATE;
    const odd = this.frame & 1;
    let dressed = false;
    for (let i = 0; i < people.length && n < this.max; i++) {
      const p = people[i];
      if (p.hidden) continue;
      const dx = p.x - cam.x;
      const dz = p.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2) continue;
      // Far ones every other frame — their slots stay put if the list order does not change.
      const moved = p.slotN !== n;
      if (moved) {
        this.dress(n, p);
        dressed = true;
      }
      if (moved || d2 < half2 || (i & 1) === odd || p.dim < 1) this.pose(n, p);
      p.slotN = n;
      n++;
    }
    const m = this.mesh;
    if (m.count !== n) m.count = n;
    m.instanceMatrix.needsUpdate = true;
    this.pose4.needsUpdate = true;
    if (dressed) {
      this.col4.needsUpdate = true;
      this.look4.needsUpdate = true;
    }
    this.drawn = n;
    return n;
  }

  /** What person `p` wears, into slot `n`. */
  dress(n, p) {
    const look = this.looks[p.look % this.looks.length];
    const o = this.outfits[p.outfit] || null;
    const c = this.col4.array;
    const l = this.look4.array;
    const k = n * 4;
    c[k] = o ? o.shirt : look.shirt;
    c[k + 1] = o ? o.trousers : look.trousers;
    c[k + 2] = look.skin;
    c[k + 3] = look.hair;
    l[k] = o ? o.accent : look.accent;
    l[k + 1] = o ? o.wear : look.wear;
    l[k + 2] = look.bagCol;
    // A carried case is a roller; the rest may have a bag of their own.
    l[k + 3] = o ? 0 : p.bag ? 1 : look.bag2;
  }

  /** Where person `p` is and what they are doing, into slot `n`. */
  pose(n, p) {
    const look = this.looks[p.look % this.looks.length];
    const k = look.height;
    const sit = p.sit ? 1 : 0;
    _q.setFromAxisAngle(UP, p.yaw + (p.moving ? 0 : Math.sin(p.shift) * 0.08));
    _p.set(p.x, p.y - sit * 0.46 * k, p.z);
    _s.set(k, k, k);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(n, _m);
    const a = this.pose4.array;
    const q = n * 4;
    a[q] = p.walk;
    a[q + 1] = p.moving ? 1 : 0;
    a[q + 2] = sit;
    a[q + 3] = p.dim === undefined ? 1 : p.dim;
  }

  setVisible(v) {
    this.group.visible = !!v;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.geo.dispose();
    this.mat.dispose();
    if (this.depthMat) this.depthMat.dispose();
    this.mesh.dispose();
  }
}

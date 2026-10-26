/**
 * A crowd: every ambient person on the airfield in six draw calls.
 *
 * staff/person.js builds one figure as a rig of jointed groups — eleven
 * draw calls a walker, right for the one you play and the dozen in a story
 * scene, far too many for a hundred people on an apron. Here a person is
 * six INSTANCES, one in each of six InstancedMeshes shared by the whole
 * crowd: torso (with the hips and the neck), head, hair, an arm (twice) and
 * a leg (twice), plus a wheeled case for the ones who carry one. Each part
 * is tinted per instance (shirt, skin, hair, trousers), so the same six
 * meshes dress a ramp crew in hi-vis, a pilot in white, a guard in olive,
 * and a terminal's worth of travellers in whatever they put on.
 *
 * The figure is the game's: 1.72 m, feet at y = 0, facing -Z, the same
 * proportions as staff/person.js, flat-shaded and plain at the distance an
 * apron is seen from. It walks: legs and arms swing from hip and shoulder
 * with the distance covered, the body bobs a centimetre; standing, it shifts
 * its weight now and then.
 *
 * COST. Nothing allocated per frame. Matrices are written only for the
 * people drawn — within DRAW_FAR of the camera — and packed to the front of
 * each mesh (mesh.count is the drawn count), at half rate past HALF_RATE.
 * One bounding sphere round the airfield culls the lot when it is behind
 * you. Lambert materials, no shadows on Low and Medium.
 */

import * as THREE from '../../vendor/three.module.js';

/** Metres: nobody is drawn further away than this (a person is 1.7 m — four pixels by then). */
export const DRAW_FAR = 650;
/** Beyond this the matrices are written every other frame. */
const HALF_RATE = 220;

/** Shirt, trousers per outfit (plan.js OUTFIT). */
const OUTFITS = [
  { shirt: 0xd8f21c, trousers: 0x24324a, vest: true }, // hi-vis yellow over navy overalls
  { shirt: 0xf3701c, trousers: 0x24324a, vest: true }, // hi-vis orange
  { shirt: 0xf4f6f8, trousers: 0x1f2a3a, cap: 0x1f2a3a }, // pilot: white shirt, dark trousers, cap
  { shirt: 0x4b5a3a, trousers: 0x3e4a30, cap: 0x2f3826 }, // base guard: olive, beret-dark cap
  { shirt: 0x2b3a55, trousers: 0x2b3a55, vest: true, vestColour: 0xd8f21c }, // crew chief: blue coveralls
  null, // travellers: chosen per person
];
const SHIRTS = [0xe0473c, 0x2f7fd8, 0x3aa66b, 0xf2b233, 0x8a52c9, 0xe8e8e8, 0x2bb3b0, 0x30343a, 0xb5582a, 0x7a8a9a, 0xf07fa8, 0x1f3b66];
const TROUSERS = [0x2b3444, 0x5a4636, 0x3b5f8a, 0x444444, 0x6b7280, 0xc8b89a, 0x1d1d1f];
const SKIN = [0xf6d3b8, 0xe8b894, 0xd09a6e, 0xb07a4e, 0x8a5a36, 0x5e3b22];
const HAIR = [0x2a1b12, 0x4a2e1a, 0x7a4a24, 0xc89a4a, 0x151515, 0x9a9a9a, 0xb5582a];
const CASES = [0x1f2a3a, 0x8a1f2a, 0x2f5f9e, 0x30343a, 0xc8b89a, 0x2f6b4a];

const _m = new THREE.Matrix4();
const _b = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/* ------------------------------------------------------------------ */
/* The parts                                                           */
/* ------------------------------------------------------------------ */

/** A box with its top at y = 0 hanging down `h` (a limb from its joint). */
function limb(w, h, d, taper = 0.85) {
  const g = new THREE.CylinderGeometry((w / 2) * taper, w / 2, h, 6, 1);
  g.translate(0, -h / 2, 0);
  g.scale(1, 1, d / w);
  return g;
}

function merge(list) {
  // Positions and normals only, flat; small enough to do by hand.
  const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.computeBoundingSphere();
  return out;
}

/** Merge [geometry, colour] pairs into one vertex-coloured geometry. */
function mergeColoured(pairs) {
  const geo = merge(pairs.map(([g]) => g));
  const n = geo.attributes.position.count;
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const [g, hex] of pairs) {
    const k = (g.index ? g.toNonIndexed() : g).attributes.position.count;
    _c.set(hex);
    for (let i = 0; i < k; i++) col.set([_c.r, _c.g, _c.b], (o + i) * 3);
    o += k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

/**
 * Low's figure, two meshes for the whole crowd instead of six: the upper
 * body with the arms at its sides (tinted by the shirt), and the head,
 * hair and legs in one vertex-coloured piece (a mid skin, dark hair, dark
 * trousers) — no swing, no cases. Measured on Low the six-part crowd cost
 * the frame up to a tenth; this is the budget's share.
 */
function simpleGeometries(g) {
  const arms = [-1, 1].map((s) => {
    const a = g.arm.clone();
    a.rotateZ(s * 0.07);
    a.translate(s * 0.235, 1.43, 0);
    return a;
  });
  const upper = merge([g.torso, ...arms]);
  const legs = [-1, 1].map((s) => g.leg.clone().translate(s * 0.085, 0.9, 0));
  const rest = mergeColoured([[g.head, 0xd09a6e], [g.hair, 0x2a1b12], [legs[0], 0x2b3444], [legs[1], 0x2b3444]]);
  for (const t of [...arms, ...legs]) t.dispose();
  return { upper, rest };
}

function partGeometries() {
  // Torso: a tapered body from the hips (0.92) to the shoulders (1.46), a neck on top.
  const chest = new THREE.CylinderGeometry(0.2, 0.165, 0.54, 8, 1);
  chest.scale(1, 1, 0.62);
  chest.translate(0, 1.19, 0);
  const hips = new THREE.CylinderGeometry(0.165, 0.17, 0.14, 8, 1);
  hips.scale(1, 1, 0.66);
  hips.translate(0, 0.93, 0);
  const neck = new THREE.CylinderGeometry(0.05, 0.055, 0.08, 6, 1);
  neck.translate(0, 1.5, 0);
  const torso = merge([chest, hips, neck]);
  // Head: a slightly long sphere; hair a cap over its back and crown.
  const head = new THREE.SphereGeometry(0.105, 10, 8);
  head.scale(0.92, 1.08, 1);
  head.translate(0, 1.62, 0);
  const hair = new THREE.SphereGeometry(0.112, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  hair.scale(0.94, 1.0, 1.04);
  hair.translate(0, 1.635, 0.012);
  const arm = limb(0.085, 0.6, 0.09);
  const leg = limb(0.13, 0.9, 0.14, 0.75);
  // A shoe at the foot of the leg, part of it.
  const shoe = new THREE.BoxGeometry(0.1, 0.07, 0.24);
  shoe.translate(0, -0.875, -0.04);
  const legShod = merge([leg, shoe]);
  // A wheeled case with its handle up: 0.38 x 0.55 x 0.24, handle to 0.95.
  const box = new THREE.BoxGeometry(0.38, 0.55, 0.24);
  box.translate(0, 0.34, 0);
  const handle = new THREE.BoxGeometry(0.03, 0.4, 0.03);
  handle.translate(0, 0.8, 0.06);
  const grip = new THREE.BoxGeometry(0.16, 0.03, 0.03);
  grip.translate(0, 1.0, 0.06);
  const caseGeo = merge([box, handle, grip]);
  return { torso, head, hair, arm, leg: legShod, case: caseGeo };
}

/* ------------------------------------------------------------------ */
/* The crowd                                                           */
/* ------------------------------------------------------------------ */

export class Crowd {
  /**
   * `max` people at most; `opts.shadows` lets the torsos cast (High and Ultra).
   */
  constructor(max, { shadows = false, rnd = Math.random, simple = false } = {}) {
    this.max = Math.max(1, max | 0);
    this.group = new THREE.Group();
    this.group.name = 'world-life:people';
    const g = partGeometries();
    this.geos = g;
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const mk = (geo, n, name, cast = false) => {
      const m = new THREE.InstancedMesh(geo, this.mat, Math.max(1, n));
      m.name = name;
      m.count = 0;
      m.castShadow = cast;
      m.receiveShadow = false;
      m.frustumCulled = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _c.set(0xffffff));
      this.group.add(m);
      return m;
    };
    const N = this.max;
    this.simple = !!simple;
    if (this.simple) {
      const sg = simpleGeometries(g);
      this.geos.upper = sg.upper;
      this.geos.rest = sg.rest;
      this.matVC = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
      this.upper = mk(sg.upper, N, 'people:upper');
      this.rest = mk(sg.rest, N, 'people:rest');
      this.rest.material = this.matVC;
      this.rest.instanceColor = null;
      this.meshes = [this.upper, this.rest];
    }
    this.torso = this.simple ? null : mk(g.torso, N, 'people:torso', shadows);
    if (!this.simple) {
      this.head = mk(g.head, N, 'people:head');
      this.hair = mk(g.hair, N, 'people:hair');
      this.arm = mk(g.arm, N * 2, 'people:arm');
      this.leg = mk(g.leg, N * 2, 'people:leg', shadows);
      this.case = mk(g.case, N, 'people:case');
      this.meshes = [this.torso, this.head, this.hair, this.arm, this.leg, this.case];
    }
    // Per person: looks, chosen once.
    this.looks = [];
    for (let i = 0; i < N; i++) {
      this.looks.push({
        shirt: SHIRTS[Math.floor(rnd() * SHIRTS.length)],
        trousers: TROUSERS[Math.floor(rnd() * TROUSERS.length)],
        skin: SKIN[Math.floor(rnd() * SKIN.length)],
        hair: HAIR[Math.floor(rnd() * HAIR.length)],
        case: CASES[Math.floor(rnd() * CASES.length)],
        height: 0.94 + rnd() * 0.12,
      });
    }
    this.drawn = 0;
    this.frame = 0;
  }

  /** One sphere round everybody, so the whole crowd culls as one when it is out of view. */
  setBounds(x, y, z, r) {
    const s = new THREE.Sphere(new THREE.Vector3(x, y, z), r);
    for (const m of this.meshes) m.boundingSphere = s.clone();
  }

  /**
   * Draw everybody. `people` is the runtime's list (features/world-life.js):
   * { x, y, z, yaw, walk (phase, radians), moving, shift, outfit, bag,
   * hidden, slot } — `slot` picks the person's looks. `cam` is a Vector3.
   */
  draw(people, cam) {
    this.frame++;
    let n = 0;
    let nc = 0;
    const far2 = DRAW_FAR * DRAW_FAR;
    const half2 = HALF_RATE * HALF_RATE;
    const odd = this.frame & 1;
    for (let i = 0; i < people.length && n < this.max; i++) {
      const p = people[i];
      if (p.hidden) continue;
      const dx = p.x - cam.x;
      const dz = p.z - cam.z;
      const d2 = dx * dx + dz * dz;
      if (d2 > far2) continue;
      // Far ones every other frame — their slots stay put if the list order does not change.
      const fresh = d2 < half2 || ((i & 1) === odd) || p.slotN !== n;
      if (fresh) this.pose(n, p);
      p.slotN = n;
      if (p.bag && !this.simple) {
        if (fresh || p.caseN !== nc) this.poseCase(nc, p);
        p.caseN = nc;
        nc++;
      }
      n++;
    }
    for (const m of this.meshes) {
      const c = m === this.arm || m === this.leg ? n * 2 : m === this.case ? nc : n; // (simple: upper and rest, n each)
      if (m.count !== c) m.count = c;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.drawn = n;
    return n;
  }

  /** Write person `p` into instance `n` of every part. */
  pose(n, p) {
    const look = this.looks[p.look % this.looks.length];
    const o = OUTFITS[p.outfit] || null;
    const k = look.height;
    // The body: where it stands, which way it faces, a little bob in its step.
    const bob = p.moving ? Math.abs(Math.sin(p.walk)) * 0.025 : 0;
    _q.setFromAxisAngle(UP, p.yaw + (p.moving ? 0 : Math.sin(p.shift) * 0.08));
    _p.set(p.x, p.y + bob, p.z);
    _s.set(k, k, k);
    _b.compose(_p, _q, _s);
    if (this.simple) {
      this.upper.setMatrixAt(n, _b);
      this.upper.setColorAt(n, _c.set(o ? o.shirt : look.shirt));
      this.rest.setMatrixAt(n, _b);
      return;
    }
    this.torso.setMatrixAt(n, _b);
    this.torso.setColorAt(n, _c.set(o ? o.shirt : look.shirt));
    this.head.setMatrixAt(n, _b);
    this.head.setColorAt(n, _c.set(look.skin));
    this.hair.setMatrixAt(n, _b);
    this.hair.setColorAt(n, _c.set(o && o.cap ? o.cap : look.hair));
    // Limbs: legs swing opposite, arms opposite their legs; standing, a weight shift.
    const swing = p.moving ? Math.sin(p.walk) * 0.55 : Math.sin(p.shift) * 0.04;
    const trousers = o ? o.trousers : look.trousers;
    const sleeve = o ? (o.vest ? o.trousers : o.shirt) : look.shirt;
    for (let s = 0; s < 2; s++) {
      const side = s ? 1 : -1;
      const sw = s ? -swing : swing;
      // Leg from the hip.
      _e.set(sw, 0, 0);
      _q.setFromEuler(_e);
      _p.set(side * 0.085, 0.9, 0);
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s).premultiply(_b);
      this.leg.setMatrixAt(n * 2 + s, _m);
      this.leg.setColorAt(n * 2 + s, _c.set(trousers));
      // Arm from the shoulder, swinging against the leg; a case-carrier's trailing arm is still.
      const carry = p.bag && s === 1;
      _e.set(carry ? 0.32 : -sw * 0.75, 0, side * 0.07);
      _q.setFromEuler(_e);
      _p.set(side * 0.235, 1.43, 0);
      _m.compose(_p, _q, _s).premultiply(_b);
      this.arm.setMatrixAt(n * 2 + s, _m);
      this.arm.setColorAt(n * 2 + s, _c.set(sleeve));
    }
  }

  /** The case, rolled behind on the right. */
  poseCase(n, p) {
    const look = this.looks[p.look % this.looks.length];
    const s = Math.sin(p.yaw);
    const c = Math.cos(p.yaw);
    // Behind and to the right of the body, tilted back onto its wheels when moving.
    const lx = 0.3;
    const lz = p.moving ? 0.45 : 0.25;
    _p.set(p.x + c * lx + s * lz, p.y, p.z - s * lx + c * lz);
    _e.set(p.moving ? -0.38 : 0, p.yaw, 0, 'YXZ');
    _q.setFromEuler(_e);
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    this.case.setMatrixAt(n, _m);
    this.case.setColorAt(n, _c.set(look.case));
  }

  setVisible(v) {
    this.group.visible = !!v;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    for (const k of Object.keys(this.geos)) this.geos[k].dispose();
    this.mat.dispose();
    if (this.matVC) this.matVC.dispose();
    for (const m of this.meshes) m.dispose && m.dispose();
  }
}

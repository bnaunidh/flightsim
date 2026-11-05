/**
 * The people walking across the apron to the stairs (and back, getting off):
 * boarding.js's Streams, drawn.
 *
 * Two draws for the whole line however long it is — one InstancedMesh of
 * bodies (each pulling a little suitcase) and one of heads — and nothing at
 * all while nobody is walking, or while the camera is far enough off that a
 * person would be a pixel (NEAR). Clothes and skin vary person by person
 * (instance colours over the geometry's own shading: trousers darker than the
 * shirt, the case darker still, hair over the face). A walk, cheaply: a
 * stride whose forward leg swaps every step (the body mirrored), and a small
 * bob. Up the stairs they climb, because the path does.
 *
 * Not part of the aeroplane's model: they stand on the ground, in the scene,
 * and are gone the moment they reach the door.
 */

import * as THREE from '../../vendor/three.module.js';

/** Metres from the camera beyond which nobody is drawn. */
export const NEAR = 420;

const CLOTHES = [0x2f4f8a, 0xb5402f, 0x3a7d44, 0x6b4f9a, 0xd9a03f, 0x445566, 0xc7c2b8, 0x8a3b5c, 0x2b8a8a, 0xe6e6e1, 0x7a2f2f, 0x35506b];
const SKIN = [0xf2d0b5, 0xe0b48f, 0xc68c5a, 0x9a6440, 0x6e4528, 0xf5dcc6];

/** Boxes (and a sphere) into one geometry with a shade per part, for the instance colour to tint. */
function build(parts) {
  const geos = [];
  for (const p of parts) {
    let g = p.sphere ? new THREE.SphereGeometry(p.sphere, 10, 7, 0, Math.PI * 2, 0, p.cap || Math.PI) : new THREE.BoxGeometry(p.w, p.h, p.d);
    if (p.rx) g.rotateX(p.rx);
    if (p.rz) g.rotateZ(p.rz);
    g.translate(p.x || 0, p.y || 0, p.z || 0);
    if (g.index) {
      const ng = g.toNonIndexed();
      g.dispose();
      g = ng;
    }
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3).fill(p.shade == null ? 1 : p.shade);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(g);
  }
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/** A person walking, feet at the origin, facing -Z, 1.72 m, pulling a case behind on the right. */
export function walkerGeometry() {
  return build([
    // Legs mid-stride: the left one forward, the right one back.
    { w: 0.14, h: 0.84, d: 0.16, x: -0.09, y: 0.42, z: -0.06, rx: 0.2, shade: 0.42 },
    { w: 0.14, h: 0.84, d: 0.16, x: 0.09, y: 0.42, z: 0.06, rx: -0.2, shade: 0.42 },
    // Shoes.
    { w: 0.13, h: 0.07, d: 0.25, x: -0.09, y: 0.035, z: -0.2, shade: 0.18 },
    { w: 0.13, h: 0.07, d: 0.25, x: 0.09, y: 0.035, z: 0.17, shade: 0.18 },
    // Torso and arms (the right arm back to the case's handle).
    { w: 0.38, h: 0.6, d: 0.22, y: 1.14, shade: 1 },
    { w: 0.09, h: 0.56, d: 0.1, x: -0.24, y: 1.1, z: 0.04, rx: -0.15, shade: 0.95 },
    { w: 0.09, h: 0.56, d: 0.1, x: 0.24, y: 1.06, z: 0.12, rx: -0.45, shade: 0.95 },
    // The suitcase on its wheels, and its handle.
    { w: 0.3, h: 0.44, d: 0.18, x: 0.3, y: 0.27, z: 0.52, rx: -0.3, shade: 0.3 },
    { w: 0.03, h: 0.5, d: 0.03, x: 0.3, y: 0.66, z: 0.38, rx: -0.55, shade: 0.2 },
  ]);
}

/** A head with hair on top, sitting on walkerGeometry()'s shoulders. */
export function walkerHeadGeometry() {
  return build([
    { sphere: 0.115, y: 1.6, shade: 1 },
    { sphere: 0.122, y: 1.615, z: 0.012, cap: Math.PI * 0.45, shade: 0.28 },
  ]);
}

let GEO = null;
let MAT = null;
/** The walker's body and head geometry and its material, made once (the Cabin view's aisle uses them too). */
export function walkerParts() {
  return shared();
}
function shared() {
  if (!GEO) GEO = { body: walkerGeometry(), head: walkerHeadGeometry() };
  if (!MAT) {
    // Double-sided: the stride is mirrored person by person, step by step.
    MAT = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide });
  }
  return { GEO, MAT };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _at = { x: 0, y: 0, z: 0, yaw: 0 };

function hash(k, salt) {
  const x = Math.sin((k + 1) * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class Walkers {
  constructor(scene, max = 160) {
    const { GEO: g, MAT: m } = shared();
    this.scene = scene;
    this.max = max;
    this.root = new THREE.Group();
    this.root.name = 'passengers:walkers';
    const mk = (geo, name) => {
      const im = new THREE.InstancedMesh(geo, m, max);
      im.name = name;
      im.count = 0;
      im.frustumCulled = false;
      im.castShadow = false;
      im.receiveShadow = false;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Make the colour buffer now, so the first frame's setColorAt has somewhere to go.
      im.setColorAt(0, _c.setHex(0xffffff));
      this.root.add(im);
      return im;
    };
    this.bodies = mk(g.body, 'passengers:walker-bodies');
    this.heads = mk(g.head, 'passengers:walker-heads');
    this.shown = 0;
    scene.add(this.root);
  }

  /**
   * Draw everybody on these streams ([{ stream, salt, lane }]) now. `cam` is
   * the camera's position (null: draw anyway). Returns how many are drawn.
   */
  draw(list, cam = null) {
    let n = 0;
    for (const L of list || []) {
      const S = L && L.stream;
      if (!S || !S.list.length) continue;
      const path = S.path;
      if (cam && path.p.length) {
        const q = path.p[path.p.length - 1];
        if (Math.hypot(cam.x - q.x, cam.z - q.z) > NEAR + path.length) continue;
      }
      const salt = L.salt || 0;
      for (const w of S.list) {
        if (n >= this.max) break;
        if (w.s < 0) continue;
        path.sample(w.s, _at);
        const k = w.k;
        const side = k % 2 ? 1 : -1;
        const off = side * (0.27 + (hash(k, salt + 3) - 0.5) * 0.12) * (L.lane ?? 1);
        const yaw = _at.yaw;
        // Right of the way they walk: (cos, -sin) for a yaw facing (-sin, -cos).
        _p.set(_at.x + Math.cos(yaw) * off, _at.y, _at.z - Math.sin(yaw) * off);
        const phase = (w.s / 0.72) * Math.PI + hash(k, salt + 5) * 6.28;
        _p.y += 0.035 * Math.abs(Math.sin(phase));
        _q.setFromAxisAngle(_up, yaw + (hash(k, salt + 7) - 0.5) * 0.15);
        const h = 0.93 + hash(k, salt + 11) * 0.14;
        _s.set(Math.sin(phase) >= 0 ? h : -h, h, h);
        _m.compose(_p, _q, _s);
        this.bodies.setMatrixAt(n, _m);
        this.heads.setMatrixAt(n, _m);
        this.bodies.setColorAt(n, _c.setHex(CLOTHES[Math.floor(hash(k, salt + 13) * CLOTHES.length)]));
        this.heads.setColorAt(n, _c.setHex(SKIN[Math.floor(hash(k, salt + 17) * SKIN.length)]));
        n++;
      }
    }
    this.bodies.count = this.heads.count = n;
    if (n) {
      for (const im of [this.bodies, this.heads]) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
    }
    this.root.visible = n > 0;
    this.shown = n;
    return n;
  }

  clear() {
    this.bodies.count = this.heads.count = 0;
    this.root.visible = false;
    this.shown = 0;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.bodies.dispose();
    this.heads.dispose();
  }
}

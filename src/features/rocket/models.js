/**
 * What the rockets look like, and their flame and smoke.
 *
 * "Better rockets": each one is built like the real thing it is modelled on
 * — Petrel 9 a reusable two-stage booster with nine engines under it, legs
 * folded up its sides and grid fins at the top; Albatross a heavier one with
 * seven, a wide "hammerhead" nose that splits in two; Starling a sounding
 * rocket with tail fins. Engine bells are turned on a lathe with a real bell
 * curve; the interstage is an open tube the upper stage's big vacuum nozzle
 * hides inside, so at separation the parts really do come apart; the skin
 * is a painted texture (panel lines, the name up the side, soot on a booster
 * that has flown before), drawn in code like every other texture here.
 *
 * Still cheap enough for a classroom Chromebook: everything that does not
 * move is BAKED — merged into one geometry per material with the colours in
 * the vertices — so a whole booster is about seven draw calls: its skin, its
 * paint, its engines, its interstage, and one instanced mesh each for the
 * four legs, their struts and the four grid fins, which setLegs()/setFins()
 * move by writing four matrices.
 *
 * Every model's origin is its BOTTOM CENTRE with +Y up the body, which is
 * what the physics calls the body's position, so placing one is a copy. An
 * upper stage's nozzle hangs below its origin, into the interstage.
 *
 * Built facing +X (the launch direction) with +Z towards the camera's side:
 * the name and the windows are on +Z, and rocket.js turns each part to the
 * launch direction.
 */

import * as THREE from '../../vendor/three.module.js';

/** Shared materials, per flight, so dispose() can find them all. */
export class Kit {
  constructor() {
    this.mats = [];
    this.geos = [];
    this.texs = [];
  }

  mat(opts) {
    const m = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05, ...opts });
    this.mats.push(m);
    return m;
  }

  geo(g) {
    this.geos.push(g);
    return g;
  }

  tex(t) {
    this.texs.push(t);
    return t;
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    for (const g of this.geos) g.dispose();
    for (const t of this.texs) t.dispose();
    this.mats.length = this.geos.length = this.texs.length = 0;
  }
}

/* ------------------------------------------------------------------ */
/* Baking: many small parts, one draw call                             */
/* ------------------------------------------------------------------ */

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();

/** A placement: position, rotation (radians, Euler `order`), scale. */
export function mtx(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, order = 'XYZ') {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz, order)), _s.set(sx, sy, sz));
}

/** Blend two sRGB hex colours. */
export function mixHex(a, b, t) {
  const A = new THREE.Color(a);
  return A.lerp(new THREE.Color(b), Math.max(0, Math.min(1, t))).getHex();
}

/**
 * Collects positioned, coloured geometry and glues it into one buffer.
 * `color` is an sRGB hex, or a function (x, y, z) of the part's own local
 * coordinates returning one — how an engine bell gets its heat tint.
 */
export class Bake {
  constructor(withUV = false) {
    // Whole geometries arrive as typed-array chunks; faces and boxes written
    // here go into plain arrays. One copy into the final buffer at the end —
    // so a site of a thousand parts builds without a garbage-collector storm.
    this.chunks = [];
    this.p = [];
    this.n = [];
    this.c = [];
    this.t = withUV ? [] : null;
    this.count = 0;
  }

  get empty() {
    return this.count === 0;
  }

  add(geo, color, m = null) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!g.attributes.normal) g.computeVertexNormals();
    const P = g.attributes.position.array;
    const fn = typeof color === 'function';
    if (!fn) _c.set(color);
    const cols = new Float32Array(P.length);
    for (let i = 0; i < P.length; i += 3) {
      if (fn) _c.set(color(P[i], P[i + 1], P[i + 2]));
      cols[i] = _c.r;
      cols[i + 1] = _c.g;
      cols[i + 2] = _c.b;
    }
    if (m) g.applyMatrix4(m);
    const n = P.length / 3;
    this.chunks.push({
      p: g.attributes.position.array,
      n: g.attributes.normal.array,
      c: cols,
      t: this.t ? (g.attributes.uv ? g.attributes.uv.array : new Float32Array(n * 2)) : null,
      count: n,
    });
    this.count += n;
    g.dispose();
    return this;
  }

  /** A box, written straight in: eight corners, six faces, no geometry object. */
  box(w, h, d, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
    _q.setFromEuler(_e.set(rx, ry, rz));
    return this.boxQ(w, h, d, color, x, y, z, _q);
  }

  boxQ(w, h, d, color, x, y, z, q) {
    const cs = [];
    for (let i = 0; i < 8; i++) {
      _v.set(i & 1 ? w / 2 : -w / 2, i & 2 ? h / 2 : -h / 2, i & 4 ? d / 2 : -d / 2).applyQuaternion(q);
      cs.push([_v.x + x, _v.y + y, _v.z + z]);
    }
    for (const [a, b, c2, e, nx, ny, nz] of BOX_FACES) {
      _s.set(nx, ny, nz).applyQuaternion(q);
      this.poly([cs[a], cs[b], cs[c2], cs[e]], color, [_s.x, _s.y, _s.z]);
    }
    return this;
  }

  cyl(rt, rb, h, seg, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, open = false) {
    return this.add(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), color, mtx(x, y, z, rx, ry, rz));
  }

  /** A box from point a to point b (a beam), `w` thick. */
  beam(ax, ay, az, bx, by, bz, w, color, d = w) {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz) || 1e-3;
    const q = new THREE.Quaternion().setFromUnitVectors(_v.set(0, 1, 0), _s.set(dx / len, dy / len, dz / len));
    return this.boxQ(w, len, d, color, (ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, q);
  }

  /**
   * A flat face through `pts` ([x, y, z] each, in order round the edge),
   * turned to face roughly `hint`. `uvs` ([u, v] per point) for a textured bake.
   */
  poly(pts, color, hint, uvs = null) {
    let nx = 0;
    let ny = 0;
    let nz = 0;
    const L = pts.length;
    for (let i = 0; i < L; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % L];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const flip = nx * hint[0] + ny * hint[1] + nz * hint[2] < 0;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const fn = typeof color === 'function';
    if (!fn) _c.set(color);
    const at = (k) => (flip ? (L - k) % L : k);
    for (let k = 1; k < L - 1; k++) {
      for (const i of [at(0), at(k), at(k + 1)]) {
        const p = pts[i];
        this.p.push(p[0], p[1], p[2]);
        this.n.push(nx, ny, nz);
        if (fn) _c.set(color(p[0], p[1], p[2]));
        this.c.push(_c.r, _c.g, _c.b);
        if (this.t) this.t.push(uvs ? uvs[i][0] : 0, uvs ? uvs[i][1] : 0);
        this.count++;
      }
    }
    return this;
  }

  quad(a, b, c, d, color, hint, uvs = null) {
    return this.poly([a, b, c, d], color, hint, uvs);
  }

  geometry() {
    const n = this.count;
    const P = new Float32Array(n * 3);
    const N = new Float32Array(n * 3);
    const Cc = new Float32Array(n * 3);
    const U = this.t ? new Float32Array(n * 2) : null;
    let o = 0;
    for (const ch of this.chunks) {
      P.set(ch.p, o * 3);
      N.set(ch.n, o * 3);
      Cc.set(ch.c, o * 3);
      if (U) U.set(ch.t, o * 2);
      o += ch.count;
    }
    P.set(this.p, o * 3);
    N.set(this.n, o * 3);
    Cc.set(this.c, o * 3);
    if (U) U.set(this.t, o * 2);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('color', new THREE.BufferAttribute(Cc, 3));
    if (U) g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
    g.computeBoundingSphere();
    return g;
  }

  mesh(kit, mat, name = '') {
    const m = new THREE.Mesh(kit.geo(this.geometry()), mat);
    m.castShadow = true;
    if (name) m.name = name;
    return m;
  }
}

/** A box's six faces: four corner indices (bit 0 = +x, 1 = +y, 2 = +z) and the outward normal. */
const BOX_FACES = [
  [1, 3, 7, 5, 1, 0, 0],
  [0, 4, 6, 2, -1, 0, 0],
  [2, 6, 7, 3, 0, 1, 0],
  [0, 1, 5, 4, 0, -1, 0],
  [4, 5, 7, 6, 0, 0, 1],
  [0, 2, 3, 1, 0, 0, -1],
];

/** A material that takes its colour from the vertices. */
export function paintMat(kit, opts = {}) {
  return kit.mat({ vertexColors: true, roughness: 0.55, metalness: 0.05, ...opts });
}

/* ------------------------------------------------------------------ */
/* Painted skins                                                       */
/* ------------------------------------------------------------------ */

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function canvasTex(kit, c, aniso = 4) {
  const t = kit.tex(new THREE.CanvasTexture(c));
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/** A tiny seeded random, so a rocket's soot is the same every launch. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/**
 * The island emblem: a green island under an orbit with a rocket on it.
 * Drawn on the upper stage, the hangar and the signs.
 */
export function drawEmblem(g, cx, cy, R, accent = '#ffc247') {
  g.save();
  g.translate(cx, cy);
  g.fillStyle = '#1d2a44';
  g.beginPath();
  g.arc(0, 0, R, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#ffffff';
  g.lineWidth = Math.max(1, R * 0.07);
  g.beginPath();
  g.arc(0, 0, R * 0.9, 0, Math.PI * 2);
  g.stroke();
  // The sea and the island.
  g.fillStyle = '#2e7bbf';
  g.beginPath();
  g.arc(0, 0, R * 0.82, 0.12 * Math.PI, 0.88 * Math.PI);
  g.closePath();
  g.fill();
  g.fillStyle = '#5bbf6a';
  g.beginPath();
  g.ellipse(-R * 0.12, R * 0.3, R * 0.5, R * 0.2, 0, Math.PI, 0);
  g.fill();
  // The orbit and the rocket.
  g.strokeStyle = accent;
  g.lineWidth = Math.max(1, R * 0.08);
  g.beginPath();
  g.ellipse(0, -R * 0.05, R * 0.7, R * 0.28, -0.35, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(R * 0.05, -R * 0.62);
  g.quadraticCurveTo(R * 0.2, -R * 0.35, R * 0.14, -R * 0.02);
  g.lineTo(-R * 0.04, -R * 0.02);
  g.quadraticCurveTo(-R * 0.1, -R * 0.35, R * 0.05, -R * 0.62);
  g.fill();
  g.fillStyle = '#ff7a2f';
  g.beginPath();
  g.moveTo(-R * 0.03, 0);
  g.lineTo(R * 0.13, 0);
  g.lineTo(R * 0.05, R * 0.16);
  g.fill();
  g.restore();
}

/**
 * One stage's skin, mapped round a cylinder whose seam is at the back: the
 * middle of the canvas faces +Z (the camera's side). Pixels are square in
 * metres, so the lettering is not stretched.
 */
function skinTexture(kit, o) {
  const { len, r, accent = '#ffc247' } = o;
  const W = 256;
  const pxm = W / (2 * Math.PI * r);
  const H = Math.min(1024, Math.max(64, Math.round(len * pxm)));
  const sy = H / len;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  const Y = (m) => H - m * sy;
  const rand = rng(o.seed || 7);
  g.fillStyle = o.base || '#f2f4f7';
  g.fillRect(0, 0, W, H);
  // A faint sheen down the middle, and a cooler edge — paint is not flat.
  const sheen = g.createLinearGradient(0, 0, W, 0);
  sheen.addColorStop(0, 'rgba(120,130,150,0.10)');
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  sheen.addColorStop(1, 'rgba(120,130,150,0.10)');
  g.fillStyle = sheen;
  g.fillRect(0, 0, W, H);
  // Ring welds every couple of metres, and the vertical seams.
  for (let m = o.weld || 2.3; m < len - 0.2; m += o.weld || 2.3) {
    g.fillStyle = 'rgba(120,128,140,0.45)';
    g.fillRect(0, Y(m), W, 1);
    g.fillStyle = 'rgba(255,255,255,0.7)';
    g.fillRect(0, Y(m) + 1, W, 1);
  }
  g.fillStyle = 'rgba(120,128,140,0.28)';
  for (const u of [0.0, 0.25, 0.75]) g.fillRect(Math.round(u * W), 0, 1, H);
  // Access hatches and stencils.
  g.strokeStyle = 'rgba(110,118,130,0.6)';
  g.lineWidth = 1;
  for (let i = 0; i < (o.hatches || 4); i++) {
    const hx = (0.12 + rand() * 0.76) * W;
    const hy = Y(len * (0.08 + rand() * 0.8));
    const hw = 4 + rand() * 7;
    g.strokeRect(hx, hy, hw, hw * (1 + rand()));
  }
  // Colour bands.
  for (const b of o.bands || []) {
    g.fillStyle = b.c || accent;
    g.fillRect(0, Y(b.y + b.h), W, Math.max(2, b.h * sy));
  }
  // Chevrons near the bottom, as on a stage's lifting points.
  if (o.chevrons) {
    g.fillStyle = '#1d2433';
    for (const u of [0.32, 0.68]) {
      const cx = u * W;
      const cy = Y(o.chevrons);
      g.beginPath();
      g.moveTo(cx - 6, cy);
      g.lineTo(cx, cy - 6);
      g.lineTo(cx + 6, cy);
      g.lineTo(cx + 6, cy + 3);
      g.lineTo(cx, cy - 3);
      g.lineTo(cx - 6, cy + 3);
      g.fill();
    }
  }
  // The name, up the side facing the camera.
  if (o.name) {
    const nm = o.name;
    const fs = Math.round(Math.min(W * 0.2, (o.nameLen * sy) / (nm.length * 0.62)));
    g.save();
    g.translate(W / 2, Y(o.nameAt));
    g.rotate(-Math.PI / 2);
    g.font = `900 ${fs}px "Arial Black", Arial, sans-serif`;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillStyle = '#18202e';
    g.fillText(nm, 0, 0);
    g.restore();
  }
  // The emblem and a flag-stripe on an upper stage.
  if (o.emblemAt) {
    const R = Math.min(W * 0.12, (o.emblemR || 0.6) * sy);
    drawEmblem(g, W / 2, Y(o.emblemAt), R, accent);
  }
  if (o.small) {
    g.fillStyle = '#5b6474';
    g.font = `bold ${Math.max(6, Math.round(0.16 * sy))}px Arial, sans-serif`;
    g.textAlign = 'center';
    for (const s of o.small) g.fillText(s.t, s.u * W, Y(s.y));
  }
  // Soot: a booster that has flown before is dirty at the bottom, in streaks.
  if (o.soot > 0) {
    const top = len * 0.42;
    const grad = g.createLinearGradient(0, Y(0), 0, Y(top));
    grad.addColorStop(0, `rgba(48,44,40,${0.75 * o.soot})`);
    grad.addColorStop(0.35, `rgba(70,64,58,${0.32 * o.soot})`);
    grad.addColorStop(1, 'rgba(90,84,78,0)');
    g.fillStyle = grad;
    g.fillRect(0, Y(top), W, top * sy);
    for (let i = 0; i < 70; i++) {
      const x = rand() * W;
      const h = top * sy * (0.25 + rand() * 0.75);
      g.fillStyle = `rgba(40,36,32,${(0.05 + rand() * 0.16) * o.soot})`;
      g.fillRect(x, H - h, 1 + rand() * 3, h);
    }
    // Soot also streaks DOWN from the interstage after re-entry.
    const g2 = g.createLinearGradient(0, Y(len), 0, Y(len - len * 0.12));
    g2.addColorStop(0, `rgba(50,46,42,${0.35 * o.soot})`);
    g2.addColorStop(1, 'rgba(50,46,42,0)');
    g.fillStyle = g2;
    g.fillRect(0, 0, W, len * 0.12 * sy);
  }
  return canvasTex(kit, c);
}

/** A cylinder whose UV seam is at the back, so u = 0.5 faces +Z. */
function skinGeometry(r, len, seg = 40) {
  return new THREE.CylinderGeometry(r, r, len, seg, 1, true, Math.PI, Math.PI * 2);
}

/* ------------------------------------------------------------------ */
/* The rockets                                                         */
/* ------------------------------------------------------------------ */

const C = {
  white: 0xf2f4f7,
  offwhite: 0xe2e5e9,
  carbon: 0x1b1d21,
  carbon2: 0x2a2d32,
  heat: 0x393b3f,
  steel: 0x8d939b,
  dark: 0x4a4e55,
  bell: 0x3b3f46,
  copper: 0x9c6a42,
  gold: 0xd2a347,
  cell: 0x1f3566,
};

/** How each rocket differs from the others. Anything new gets a sensible default. */
const STYLE = {
  starling: { name: 'STARLING', engines: 1, soot: 0, inter: 0 },
  petrel: { name: 'PETREL 9', engines: 9, soot: 0.6, inter: 2.6 },
  albatross: { name: 'ALBATROSS', engines: 7, soot: 0.3, inter: 3.0, bulge: 1.16 },
};

function styleOf(def) {
  return STYLE[def.id] || { name: String(def.name || 'ROCKET').toUpperCase(), engines: def.stages.length > 1 ? 9 : 1, soot: 0.2, inter: 2.6 };
}

/** How far out a deployed leg leans from straight down: 57 degrees. */
const LEG_OUT = (57 * Math.PI) / 180;
const LEG_COS = Math.cos(LEG_OUT);

/** An engine bell turned on a lathe: wide mouth at y = 0, throat at the top. */
function bellPoints(re, rt, L, k = 1.75) {
  const pts = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    pts.push(new THREE.Vector2(rt + (re - rt) * Math.pow(1 - t, k), t * L));
  }
  pts.push(new THREE.Vector2(rt * 1.35, L + rt * 0.5));
  pts.push(new THREE.Vector2(rt * 1.35, L + rt * 1.6));
  return pts;
}

/**
 * The engines under a first stage. Returns where the flame comes out and
 * how high the base heat shield is.
 */
function engineCluster(metal, paint, r, n) {
  let ring = 0;
  let count = 0;
  let re;
  if (n >= 9) { ring = r * 0.63; count = 8; re = r * 0.235; }
  else if (n >= 7) { ring = r * 0.6; count = 6; re = r * 0.27; }
  else if (n >= 4) { ring = r * 0.45; count = 4; re = r * 0.3; }
  else { re = r * 0.56; }
  const L = re * (n > 1 ? 2.45 : 1.9);
  const rt = re * 0.36;
  const tint = (x, y) => mixHex(C.bell, C.copper, Math.max(0, (y / L - 0.45) * 1.8));
  const spots = [[0, 0]];
  for (let k = 0; k < count; k++) {
    const a = (k / count) * Math.PI * 2 + Math.PI / count;
    spots.push([Math.cos(a) * ring, Math.sin(a) * ring]);
  }
  for (const [x, z] of spots) {
    metal.add(new THREE.LatheGeometry(bellPoints(re, rt, L), 18), tint, mtx(x, 0, z));
    // A bright lip round the mouth of each bell.
    metal.add(new THREE.TorusGeometry(re, re * 0.045, 4, 18), C.steel, mtx(x, 0.01, z, Math.PI / 2));
  }
  const base = L * (n > 1 ? 0.72 : 0.62);
  // The heat shield the bells hang out of.
  paint.cyl(r * 0.995, r * 0.995, 0.14, 40, C.heat, 0, base + 0.07, 0);
  return { base, exitR: count ? ring + re : re, exitY: 0, L };
}

/** Grid fin: a frame and a lattice, hinge at the origin, lying along +Y (stowed). */
function gridFinGeometry(w, l, th) {
  const b = new Bake();
  const col = 0x3a3e45;
  const fb = 0.06;
  b.box(th, fb, w, col, th / 2, fb / 2, 0);
  b.box(th, fb, w, col, th / 2, l - fb / 2, 0);
  b.box(th, l, fb, col, th / 2, l / 2, -w / 2 + fb / 2);
  b.box(th, l, fb, col, th / 2, l / 2, w / 2 - fb / 2);
  // The lattice, at 45 degrees as on the real ones: each bar clipped to the frame.
  const step = 0.16;
  for (const sg of [1, -1]) {
    for (let c = -w - l; c <= w + l; c += step) {
      // The line y = c + sg·z, cut to |z| <= w/2, 0 <= y <= l.
      const hits = [];
      for (const z of [-w / 2, w / 2]) {
        const y = c + sg * z;
        if (y >= 0 && y <= l) hits.push([z, y]);
      }
      for (const y of [0, l]) {
        const z = (y - c) * sg;
        if (z >= -w / 2 && z <= w / 2) hits.push([z, y]);
      }
      if (hits.length < 2) continue;
      hits.sort((p, q) => p[0] - q[0]);
      const [p, q] = [hits[0], hits[hits.length - 1]];
      if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 0.05) continue;
      b.beam(th / 2, p[1], p[0], th / 2, q[1], q[0], th * 0.9, col, 0.024);
    }
  }
  // The hinge block.
  b.box(th * 1.6, 0.22, 0.3, 0x2a2d32, th * 0.4, 0, 0);
  return b.geometry();
}

/** One landing leg, hinge at the origin, lying along +Y (stowed) and outside +X. */
function legGeometry(len) {
  const b = new Bake();
  const slab = new THREE.CylinderGeometry(0.2, 0.34, len, 4, 1);
  slab.rotateY(Math.PI / 4);
  slab.scale(0.62, 1, 1);
  b.add(slab, C.carbon, mtx(0.15, len / 2, 0));
  // A pale stripe down the middle of the leg, and the foot.
  b.box(0.02, len * 0.7, 0.07, 0x7d838c, 0.3, len * 0.45, 0);
  // The foot: level when the leg is down.
  b.add(new THREE.CylinderGeometry(0.4, 0.5, 0.16, 14), C.dark, mtx(0.2, len + 0.02, 0, 0, 0, Math.PI - LEG_OUT));
  // The hinge.
  b.box(0.3, 0.4, 0.5, C.dark, 0.1, 0.05, 0);
  return b.geometry();
}

function firstStage(kit, M, s, st, i, def, accent) {
  const g = new THREE.Group();
  g.name = `rocket:${s.id}`;
  const r = s.radius;
  const h = s.height;
  const paint = new Bake();
  const metal = new Bake();
  const carbon = new Bake();
  const two = def.stages.length > 1;
  const iH = two ? Math.min(st.inter || 2.6, h * 0.2) : 0;
  const eng = engineCluster(metal, paint, r, st.engines);
  let tankBot = eng.base;
  if (!two) {
    // Starling: a boat-tail from the engine up to the full body.
    paint.cyl(r, r * 0.8, 0.8, 32, C.offwhite, 0, eng.base + 0.4, 0, 0, 0, 0, true);
    tankBot = eng.base + 0.8;
  }
  const tankH = h - iH - tankBot;
  const tex = skinTexture(kit, {
    len: tankH,
    r,
    accent,
    soot: st.soot,
    seed: 11 + i,
    name: st.name,
    nameAt: tankH * (two ? 0.4 : 0.3),
    nameLen: tankH * (two ? 0.45 : 0.5),
    bands: two
      ? [{ y: tankH - 0.75, h: 0.45 }, { y: tankH - 1.0, h: 0.08 }, { y: 0.35, h: 0.18, c: '#1d2433' }]
      : [{ y: tankH - 0.5, h: 0.35 }, { y: 0.1, h: 0.3 }],
    chevrons: 1.2,
    small: two ? [{ t: 'LOX', u: 0.62, y: tankH * 0.82 }, { t: 'RP-1', u: 0.62, y: tankH * 0.2 }] : [{ t: 'DANGER', u: 0.62, y: 0.8 }],
    hatches: 6,
  });
  const skin = new THREE.Mesh(kit.geo(skinGeometry(r, tankH)), kit.mat({ map: tex, roughness: 0.42, metalness: 0.05 }));
  skin.position.y = tankBot + tankH / 2;
  skin.castShadow = true;
  skin.name = 'skin';
  g.add(skin);
  // The raceway: the cable tunnel down the back-left of the tank.
  const ra = Math.PI * 0.8;
  paint.box(0.14, tankH * 0.82, 0.24, C.offwhite, Math.cos(ra) * (r + 0.05), tankBot + tankH * 0.47, Math.sin(ra) * (r + 0.05), 0, -ra);

  let finsOut = null;
  let legsOut = null;
  if (two) {
    // The interstage: a black open tube with the tank's top dome at its foot.
    const y0 = h - iH;
    carbon.add(new THREE.CylinderGeometry(r * 1.004, r * 1.004, iH, 40, 1, true), C.carbon, mtx(0, y0 + iH / 2, 0));
    carbon.add(new THREE.RingGeometry(r * 0.94, r * 1.004, 40), C.carbon2, mtx(0, h, 0, -Math.PI / 2));
    const dome = new THREE.SphereGeometry(r * 0.97, 24, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    dome.scale(1, 0.32, 1);
    paint.add(dome, 0x6a6f76, mtx(0, y0 + 0.02, 0));
    // The pusher at the middle of the dome that shoves the upper stage off.
    paint.cyl(0.1, 0.16, 0.5, 10, C.steel, 0, y0 + 0.4, 0);
    // Seam ring where the tank meets the interstage.
    paint.cyl(r * 1.008, r * 1.008, 0.06, 40, C.carbon2, 0, y0, 0, 0, 0, 0, true);
  }
  if (s.landable) {
    // Grid fins at the top, on the four sides.
    const fw = r * 1.25;
    const fl = r * 1.12;
    const hingeY = h - iH + 0.25;
    const finGeo = kit.geo(gridFinGeometry(fw, fl, 0.13));
    const fins = new THREE.InstancedMesh(finGeo, M.carbon, 4);
    fins.name = 'gridfins';
    fins.castShadow = true;
    fins.frustumCulled = false;
    g.add(fins);
    finsOut = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      finsOut.push({ a, x: Math.cos(a) * (r + 0.02), y: hingeY, z: Math.sin(a) * (r + 0.02) });
      // The actuator housing each fin swings from.
      paint.box(0.18, 0.5, 0.42, C.carbon2, Math.cos(a) * (r + 0.06), hingeY - 0.1, Math.sin(a) * (r + 0.06), 0, -a);
    }
    finsOut.mesh = fins;
    // Four legs folded up the sides, between the fins, with their struts.
    const legLen = Math.round(h * 0.29 * 10) / 10;
    // High enough that a deployed foot's sole is level with the engines' mouths.
    const pivotY = legLen * LEG_COS + 0.26;
    const legs = new THREE.InstancedMesh(kit.geo(legGeometry(legLen)), M.carbon, 4);
    legs.name = 'legs';
    legs.castShadow = true;
    legs.frustumCulled = false;
    const sleeve = new THREE.InstancedMesh(kit.geo(new THREE.CylinderGeometry(0.1, 0.1, 1, 8).translate(0, 0.5, 0)), M.metal, 4);
    const rod = new THREE.InstancedMesh(kit.geo(new THREE.CylinderGeometry(0.06, 0.06, 1, 8).translate(0, 0.5, 0)), M.metal, 4);
    for (const m of [sleeve, rod]) {
      m.castShadow = true;
      m.frustumCulled = false;
      g.add(m);
    }
    g.add(legs);
    legsOut = [];
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
      legsOut.push({ a, x: Math.cos(a) * r * 0.97, y: pivotY, z: Math.sin(a) * r * 0.97 });
      // Where the strut meets the body, and the bracket there.
      paint.box(0.2, 0.3, 0.36, C.carbon2, Math.cos(a) * (r + 0.04), pivotY + legLen * 0.36, Math.sin(a) * (r + 0.04), 0, -a);
    }
    legsOut.rig = { legs, sleeve, rod, r, legLen, pivotY, braceY: legLen * 0.36, braceAt: 0.55 };
  }
  if (!two) {
    // Starling's tail fins: swept, thin, in the rocket's colour.
    const shape = new THREE.Shape();
    shape.moveTo(0, 0.1);
    shape.lineTo(1.1, 0.25);
    shape.lineTo(1.18, 1.0);
    shape.lineTo(0, 2.6);
    shape.lineTo(0, 0.1);
    const fg = new THREE.ExtrudeGeometry(shape, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.02, bevelSegments: 1 });
    fg.translate(0, 0, -0.035);
    const fins = new Bake();
    for (let k = 0; k < 4; k++) {
      const a = (k / 4) * Math.PI * 2;
      fins.add(fg.clone(), accent, mtx(Math.cos(a) * r * 0.82, eng.base, Math.sin(a) * r * 0.82, 0, -a));
    }
    fg.dispose();
    const finMesh = fins.mesh(kit, M.paint, 'fins');
    g.add(finMesh);
    // A camera pod looking down the side, and the umbilical plate.
    paint.box(0.16, 0.34, 0.18, C.carbon2, Math.cos(0.9) * (r + 0.06), h * 0.62, Math.sin(0.9) * (r + 0.06), 0, -0.9);
    paint.box(0.05, 0.5, 0.36, 0x6a6f76, -(r + 0.02), eng.base + 1.6, 0);
  }
  g.add(metal.mesh(kit, M.metal, 'engines'));
  g.add(paint.mesh(kit, M.paint, 'paint'));
  if (!carbon.empty) g.add(carbon.mesh(kit, M.carbon, 'interstage'));
  return { g, exit: { y: eng.exitY, r: eng.exitR }, fins: finsOut, legs: legsOut, base: eng.base };
}

function upperStage(kit, M, s, st, below, def, accent) {
  const g = new THREE.Group();
  g.name = `rocket:${s.id}`;
  const r = s.radius;
  const h = s.height;
  const paint = new Bake();
  const metal = new Bake();
  // The vacuum engine: a big bell hanging below, inside the interstage.
  const iH = Math.min(st.inter || 2.6, below.height * 0.2);
  const L = iH - 0.35;
  const re = r * 0.8;
  const rt = r * 0.13;
  const cut = 0.32;
  const tint = (x, y) => {
    const t = y / (L - 0.55);
    if (t > 1) return C.copper;
    return t < cut ? mixHex(0x26282c, 0x3a3c41, t / cut) : mixHex(0x5d5148, C.copper, (t - cut) / (1 - cut));
  };
  metal.add(new THREE.LatheGeometry(bellPoints(re, rt, L - 0.55, 2.1), 28), tint, mtx(0, -L, 0));
  metal.add(new THREE.TorusGeometry(re, 0.03, 4, 28), 0x9aa0a8, mtx(0, -L + 0.01, 0, Math.PI / 2));
  // The thrust frame, the engine's top and the bottom of the tank.
  paint.cyl(r * 0.5, r * 0.22, 0.5, 16, 0x3a3d42, 0, -0.25, 0);
  paint.cyl(r * 0.995, r * 0.995, 0.08, 40, 0x5a5e64, 0, 0.04, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.4;
    paint.cyl(0.07, 0.07, 0.5, 6, C.steel, Math.cos(a) * r * 0.35, -0.3, Math.sin(a) * r * 0.35, 0.35 * Math.sin(a), 0, -0.35 * Math.cos(a));
  }
  const tankH = h - 0.3;
  const tex = skinTexture(kit, {
    len: tankH,
    r,
    accent,
    seed: 23,
    weld: 1.8,
    bands: [{ y: tankH - 0.42, h: 0.3 }, { y: 0.05, h: 0.12, c: '#1d2433' }],
    emblemAt: tankH * 0.5,
    emblemR: Math.min(0.7, r * 0.62),
    small: [{ t: 'STAGE 2', u: 0.5, y: tankH * 0.18 }],
    hatches: 3,
  });
  const skin = new THREE.Mesh(kit.geo(skinGeometry(r, tankH)), kit.mat({ map: tex, roughness: 0.42, metalness: 0.05 }));
  skin.position.y = tankH / 2;
  skin.castShadow = true;
  skin.name = 'skin';
  g.add(skin);
  // The payload adapter ring at the top.
  paint.cyl(r * 1.003, r * 1.003, 0.3, 40, 0x2a2d32, 0, h - 0.15, 0, 0, 0, 0, true);
  g.add(metal.mesh(kit, M.metal, 'mvac'));
  g.add(paint.mesh(kit, M.paint, 'paint'));
  return { g, exit: { y: -L, r: re } };
}

/** Euler for something on a cone's side at angle `a`, leaning in by `lean`. */
function onSide(a, lean, x, y, z) {
  return new THREE.Matrix4().compose(_v.set(x, y, z), _q.setFromEuler(_e.set(-lean, a, 0, 'YXZ')), _s.set(1, 1, 1));
}

function capsule(kit, M, R, H, accent) {
  const g = new THREE.Group();
  const b = new Bake();
  // The trunk, with solar cells on the side facing out.
  const tH = H * 0.34;
  b.cyl(R, R, tH, 40, C.white, 0, tH / 2, 0, 0, 0, 0, true);
  b.add(new THREE.CylinderGeometry(R * 1.006, R * 1.006, tH * 0.78, 32, 1, true, -Math.PI * 0.55, Math.PI * 1.1), C.cell, mtx(0, tH / 2, 0));
  for (const y of [tH * 0.11, tH * 0.5, tH * 0.89]) b.cyl(R * 1.01, R * 1.01, 0.03, 32, 0xb9bec6, 0, y, 0, 0, 0, 0, true);
  // The capsule: a cone-sided cup, the dark heat-shield seam, windows, thrusters.
  const cH = H * 0.5;
  const r0 = R * 0.98;
  const r1 = R * 0.6;
  b.cyl(r1, r0, cH, 40, C.white, 0, tH + cH / 2, 0);
  b.cyl(R * 0.995, R * 0.995, 0.08, 40, 0x2a2c30, 0, tH + 0.04, 0, 0, 0, 0, true);
  const lean = Math.atan((r0 - r1) / cH);
  const rAt = (y) => r0 + (r1 - r0) * (y / cH);
  for (const a of [-0.38, 0.38]) {
    const y = cH * 0.58;
    const rr = rAt(y) + 0.01;
    b.add(new THREE.BoxGeometry(0.28, 0.22, 0.04), 0x0d1726, onSide(a, lean, Math.sin(a) * rr, tH + y, Math.cos(a) * rr));
  }
  for (const a of [Math.PI / 4, (3 * Math.PI) / 4, (5 * Math.PI) / 4, (7 * Math.PI) / 4]) {
    const y = cH * 0.3;
    const rr = rAt(y) + 0.02;
    b.add(new THREE.BoxGeometry(0.22, 0.42, 0.08), 0x3a3d42, onSide(a, lean, Math.sin(a) * rr, tH + y, Math.cos(a) * rr));
  }
  b.cyl(rAt(cH * 0.8) + 0.008, rAt(cH * 0.76) + 0.008, cH * 0.05, 40, accent, 0, tH + cH * 0.78, 0, 0, 0, 0, true);
  // The nose cap.
  const cap = new THREE.SphereGeometry(r1, 28, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  cap.scale(1, (H - tH - cH) / r1, 1);
  b.add(cap, C.white, mtx(0, tH + cH, 0));
  b.cyl(r1 * 1.01, r1 * 1.01, 0.04, 28, 0x8a9099, 0, tH + cH + 0.02, 0, 0, 0, 0, true);
  g.add(b.mesh(kit, M.paint, 'capsule'));
  return g;
}

function probe(kit, M, R, H, accent) {
  const g = new THREE.Group();
  const b = new Bake();
  const pts = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    pts.push(new THREE.Vector2(Math.max(0.015, R * Math.pow(1 - Math.pow(t, 1.7), 0.62)), t * H));
  }
  b.add(new THREE.LatheGeometry(pts, 32), (x, y) => (y > H * 0.82 ? accent : y < 0.28 && y > 0.12 ? accent : C.white));
  // The pitot needle on the tip.
  b.cyl(0.012, 0.02, 0.45, 6, C.steel, 0, H + 0.2, 0);
  g.add(b.mesh(kit, M.paint, 'probe'));
  return g;
}

function cellTexture(kit) {
  const c = canvas(128, 64);
  const g = c.getContext('2d');
  g.fillStyle = '#1b2f5c';
  g.fillRect(0, 0, 128, 64);
  g.strokeStyle = 'rgba(160,190,240,0.55)';
  g.lineWidth = 1;
  for (let x = 0; x <= 128; x += 8) {
    g.beginPath();
    g.moveTo(x + 0.5, 0);
    g.lineTo(x + 0.5, 64);
    g.stroke();
  }
  for (let y = 0; y <= 64; y += 8) {
    g.beginPath();
    g.moveTo(0, y + 0.5);
    g.lineTo(128, y + 0.5);
    g.stroke();
  }
  g.strokeStyle = '#c8ccd2';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, 125, 61);
  return canvasTex(kit, c);
}

function satellite(kit, M, R, H) {
  const sat = new THREE.Group();
  const b = new Bake();
  const metal = new Bake();
  // The adapter cone, the gold-wrapped bus, a white radiator.
  b.cyl(R * 0.42, R * 0.78, 0.6, 28, 0x34373c, 0, 0.3, 0);
  b.box(1.5, 2.2, 1.5, C.gold, 0, 1.7, 0);
  b.box(1.52, 0.08, 1.52, 0xb98a35, 0, 0.62, 0);
  b.box(1.52, 0.08, 1.52, 0xb98a35, 0, 2.78, 0);
  b.box(1.0, 1.6, 0.04, 0xeef0f2, 0, 1.7, 0.77);
  // Thrusters and a star tracker.
  for (const [x, z] of [[0.6, 0.6], [-0.6, 0.6], [0.6, -0.6], [-0.6, -0.6]]) b.cyl(0.04, 0.08, 0.16, 8, C.dark, x, 2.88, z);
  b.box(0.22, 0.3, 0.22, 0x2a2d32, 0.45, 2.98, -0.4);
  // The dish, its boom and its feed.
  const dish = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    dish.push(new THREE.Vector2(t * 0.82, t * t * 0.32));
  }
  metal.add(new THREE.LatheGeometry(dish, 24), 0xf1f2f4, mtx(0, 3.22, 0));
  metal.cyl(0.05, 0.05, 0.36, 6, C.steel, 0, 3.0, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    metal.beam(Math.cos(a) * 0.62, 3.42, Math.sin(a) * 0.62, 0, 3.98, 0, 0.025, C.steel);
  }
  metal.cyl(0.07, 0.11, 0.16, 8, C.dark, 0, 4.02, 0);
  sat.add(b.mesh(kit, M.paint, 'bus'));
  sat.add(metal.mesh(kit, M.metal, 'dish'));
  // Two solar wings of three panels each, folded until it is let go.
  const cell = kit.mat({ map: cellTexture(kit), roughness: 0.32, metalness: 0.45, emissive: 0x0a1a3a, emissiveIntensity: 0.4 });
  const wing = new Bake(true);
  for (let p = 0; p < 3; p++) {
    const box = new THREE.BoxGeometry(1.15, 0.04, 1.1);
    wing.add(box, 0xffffff, mtx(0.35 + p * 1.2 + 0.575, 0, 0));
  }
  wing.add(new THREE.BoxGeometry(0.4, 0.05, 0.06), 0xc8ccd2, mtx(0.18, 0, 0));
  const wingGeo = kit.geo(wing.geometry());
  const panels = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.76, 1.7, 0);
    const pn = new THREE.Mesh(wingGeo, cell);
    pn.castShadow = true;
    pn.scale.x = side;
    arm.add(pn);
    arm.scale.set(0.08, 1, 1);
    sat.add(arm);
    panels.push(arm);
  }
  sat.userData.panels = panels;
  return sat;
}

/**
 * The nose that splits in two: a lathe profile — a boat-tail out to the
 * hammerhead's width, a cylinder, an ogive — cut down the middle. Each half
 * hangs from a hinge at its foot, so rocket.js can swing it open like a
 * clamshell before it tumbles away.
 */
function fairingHalves(kit, M, R, H, bulge, accent) {
  const Rf = R * bulge;
  const pts = [new THREE.Vector2(R * 1.0, 0), new THREE.Vector2(R * 1.0, 0.12)];
  const tail = 0.75;
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    pts.push(new THREE.Vector2(R + (Rf - R) * (1 - Math.cos(t * Math.PI)) / 2, 0.12 + t * (tail - 0.12)));
  }
  const cylTop = H * 0.55;
  pts.push(new THREE.Vector2(Rf, cylTop));
  for (let i = 1; i <= 14; i++) {
    const t = i / 14;
    pts.push(new THREE.Vector2(Math.max(0.06, Rf * Math.pow(1 - Math.pow(t, 1.8), 0.6)), cylTop + t * (H - cylTop)));
  }
  const band = [cylTop - 0.62, cylTop - 0.28];
  const colour = (x, y) => (y > band[0] && y < band[1] ? accent : C.white);
  const halves = [];
  const gap = 0.006;
  for (const k of [0, 1]) {
    const half = new THREE.Group();
    half.name = `rocket:fairing${k}`;
    const hinge = new THREE.Group();
    const side = k === 0 ? 1 : -1;
    hinge.position.x = side * R;
    const b = new Bake();
    b.add(new THREE.LatheGeometry(pts, 24, k * Math.PI + gap, Math.PI - gap * 2), colour);
    // Seam rings, and the separation rails down both cut edges.
    for (const y of [tail, cylTop]) b.add(new THREE.CylinderGeometry(Rf * 1.004, Rf * 1.004, 0.035, 24, 1, true, k * Math.PI, Math.PI), 0x9aa0a8, mtx(0, y, 0));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const c = pts[i];
      for (const z of [1, -1]) b.beam(0, a.y, z * (a.x + 0.012), 0, c.y, z * (c.x + 0.012), 0.05, 0x3a3d42, 0.03);
    }
    const mesh = b.mesh(kit, M.paintDouble, 'fairing');
    mesh.position.x = -side * R;
    hinge.add(mesh);
    half.add(hinge);
    half.userData.hinge = hinge;
    half.userData.side = side;
    halves.push(half);
  }
  return halves;
}

/**
 * The parts of one rocket, each a group with its own bottom at y = 0, so
 * they can be stacked into one body and split into two at separation.
 *
 * Returns { parts: {stageId: Group, payload: Group}, fairing: [L, R] | null,
 * heights: {id: m}, exits: {stageId: {y, r}}, legs, fins, sat }.
 */
export function buildRocket(kit, def) {
  const st = styleOf(def);
  const accent = def.colour || '#ffc247';
  const M = {
    paint: paintMat(kit, { roughness: 0.5 }),
    paintDouble: paintMat(kit, { roughness: 0.45, side: THREE.DoubleSide }),
    metal: paintMat(kit, { roughness: 0.36, metalness: 0.62, side: THREE.DoubleSide }),
    carbon: paintMat(kit, { roughness: 0.5, metalness: 0.25, side: THREE.DoubleSide }),
  };
  const parts = {};
  const heights = {};
  const exits = {};
  let legs = [];
  let fins = [];
  let mount = null;

  for (let i = 0; i < def.stages.length; i++) {
    const s = def.stages[i];
    heights[s.id] = s.height;
    let built;
    if (i === 0) {
      built = firstStage(kit, M, s, st, i, def, accent);
      mount = { r: s.radius, base: built.base };
      if (built.legs) legs = built.legs;
      if (built.fins) fins = built.fins;
    } else {
      built = upperStage(kit, M, s, st, def.stages[i - 1], def, accent);
    }
    parts[s.id] = built.g;
    exits[s.id] = built.exit;
  }

  // What rides on top.
  const top = def.stages[def.stages.length - 1];
  const R = top.radius;
  const P = def.payload || { kind: 'probe', height: 2.5 };
  heights.payload = P.height;
  let pay;
  let sat = null;
  if (P.kind === 'capsule') pay = capsule(kit, M, R, P.height, accent);
  else if (P.kind === 'satellite') {
    sat = satellite(kit, M, R, P.height);
    pay = new THREE.Group();
    pay.add(sat);
  } else pay = probe(kit, M, R, P.height, accent);
  pay.name = 'rocket:payload';

  let fairing = null;
  if (def.fairing) {
    const H = P.height + 0.6;
    fairing = fairingHalves(kit, M, R, H, st.bulge || 1.08, accent);
    heights.payload = H;
  }
  parts.payload = pay;
  if (legs.length) setLegs(legs, 0);
  if (fins.length) setFins(fins, 0);
  return { parts, heights, exits, legs, fins, fairing, sat, mount, inter: def.stages.length > 1 ? Math.min(st.inter || 2.6, def.stages[0].height * 0.2) : 0 };
}

const _m1 = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _m3 = new THREE.Matrix4();
const _m4 = new THREE.Matrix4();

/** Legs out (0 = folded up the side, 1 = down and out), struts with them. */
export function setLegs(legs, k) {
  const rig = legs.rig;
  if (!rig) return;
  const ang = -k * (Math.PI - LEG_OUT);
  const { r, legLen, pivotY, braceY, braceAt } = rig;
  for (let i = 0; i < legs.length; i++) {
    const L = legs[i];
    // Leg: pivot, turn to face out, then swing about the tangent.
    _m1.makeTranslation(L.x, L.y, L.z);
    _m2.makeRotationY(-L.a);
    _m3.makeRotationZ(ang);
    _m1.multiply(_m2).multiply(_m3);
    rig.legs.setMatrixAt(i, _m1);
    // Strut: from the body above the pivot to a point down the leg, in the
    // leg's own radial plane (x out from the body, y up).
    const bx = r * 0.97 + 0.12;
    const by = pivotY + braceY;
    const d = legLen * braceAt;
    const px = r * 0.97 + 0.18 * Math.cos(ang) - d * Math.sin(ang);
    const py = pivotY + 0.18 * Math.sin(ang) + d * Math.cos(ang);
    const dx = px - bx;
    const dy = py - by;
    const len = Math.hypot(dx, dy);
    const phi = Math.atan2(-dx, dy);
    const sleeve = Math.min(len, 1.3);
    for (const [mesh, ox, oy, l, flip] of [[rig.sleeve, bx, by, sleeve, 0], [rig.rod, px, py, Math.max(0.05, len - 0.9), Math.PI]]) {
      _m1.makeRotationY(-L.a);
      _m2.makeTranslation(ox, oy, 0);
      _m3.makeRotationZ(phi + flip);
      _m1.multiply(_m2).multiply(_m3).multiply(_m4.makeScale(1, l, 1));
      mesh.setMatrixAt(i, _m1);
    }
  }
  rig.legs.instanceMatrix.needsUpdate = true;
  rig.sleeve.instanceMatrix.needsUpdate = true;
  rig.rod.instanceMatrix.needsUpdate = true;
}

/** Grid fins: folded up flat against the body (0), or out and working (1). */
export function setFins(fins, k) {
  const mesh = fins.mesh;
  if (!mesh) return;
  for (let i = 0; i < fins.length; i++) {
    const f = fins[i];
    _m1.makeTranslation(f.x, f.y, f.z);
    _m2.makeRotationY(-f.a);
    _m3.makeRotationZ(-k * Math.PI * 0.5);
    _m1.multiply(_m2).multiply(_m3);
    mesh.setMatrixAt(i, _m1);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

/* ------------------------------------------------------------------ */
/* The flame                                                           */
/* ------------------------------------------------------------------ */

const plumeVert = /* glsl */ `
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vT = 0.5 - position.y;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`;
const plumeFrag = /* glsl */ `
  uniform float uTime;
  uniform float uPower;
  uniform float uThin;
  uniform float uDia;
  varying float vT;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float edge = abs(dot(normalize(vN), normalize(vV)));
    float flick = 0.86 + 0.14 * sin(uTime * 41.0 + vT * 17.0) * sin(uTime * 23.0 - vT * 9.0);
    float core = pow(edge, 1.5);
    float along = pow(1.0 - clamp(vT, 0.0, 1.0), mix(1.25, 2.4, uThin));
    vec3 hot = vec3(1.0, 0.98, 0.9);
    vec3 warm = vec3(1.0, 0.66, 0.24);
    vec3 red = vec3(0.95, 0.3, 0.12);
    vec3 col = mix(hot, warm, smoothstep(0.04, 0.42, vT));
    col = mix(col, red, smoothstep(0.42, 0.95, vT));
    col = mix(col, vec3(0.62, 0.74, 1.0), uThin * 0.5 * smoothstep(0.05, 0.8, vT));
    // Shock diamonds: bright beads down the middle of the flame in thick
    // air, fading as the air thins and the flame balloons out.
    float ph = vT / max(uDia, 0.002);
    float bead = pow(max(0.0, cos(ph * 6.2832)), 12.0) * step(0.5, ph);
    float dia = bead * pow(edge, 5.0) * exp(-ph * 0.32) * (1.0 - smoothstep(0.15, 0.6, uThin));
    col += vec3(1.0, 0.86, 0.6) * dia * 1.6;
    // White-hot right at the nozzle.
    col = mix(col, vec3(1.0), (1.0 - smoothstep(0.0, 0.1, vT)) * 0.55);
    float a = (core * along * flick * mix(1.0, 0.5, uThin) + dia * 0.9) * uPower;
    gl_FragColor = vec4(col * a * 2.0, a);
  }
`;

function glowTexture(kit) {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,250,235,1)');
  grad.addColorStop(0.25, 'rgba(255,214,150,0.55)');
  grad.addColorStop(0.6, 'rgba(255,150,70,0.14)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return canvasTex(kit, c, 1);
}

/**
 * A flame hanging under a nozzle, and a glow where it leaves it. Long and
 * narrow in thick air, with shock diamonds down the middle; in thin air the
 * exhaust has nothing pushing it in, so it balloons wide, goes paler and the
 * diamonds go — which is also a real thing you can see on launch videos.
 * `radius` is the mouth: the whole cluster for a first stage.
 */
export function buildPlume(kit, radius, exitY = 0) {
  const group = new THREE.Group();
  group.name = 'rocket:plume';
  const geo = kit.geo(new THREE.CylinderGeometry(0.5, 1, 1, 22, 8, true));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uThin: { value: 0 }, uDia: { value: 0.1 } },
    vertexShader: plumeVert,
    fragmentShader: plumeFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  kit.mats.push(mat);
  const cone = new THREE.Mesh(geo, mat);
  cone.frustumCulled = false;
  cone.renderOrder = 5;
  const glowMat = new THREE.SpriteMaterial({ map: glowTexture(kit), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
  kit.mats.push(glowMat);
  const glow = new THREE.Sprite(glowMat);
  glow.renderOrder = 6;
  glow.frustumCulled = false;
  group.add(cone, glow);
  group.userData = { radius, exitY, cone, glow };
  group.visible = false;
  return group;
}

/** Set a flame for this frame. `thin` 0 at sea level … 1 in space. */
export function updatePlume(m, t, power, thin, radius) {
  if (power <= 0.01) {
    m.visible = false;
    return;
  }
  m.visible = true;
  const { cone, glow, exitY } = m.userData;
  const u = cone.material.uniforms;
  u.uTime.value = t;
  u.uPower.value = Math.min(1, power);
  u.uThin.value = thin;
  const r = radius || m.userData.radius;
  const len = r * (7 + 10 * power) * (1 + thin * 1.6);
  const bottom = r * (1.0 + thin * 5.5);
  // The geometry is a unit cone with radius 0.5 at its top and 1 at its
  // bottom; scale it so the top is the nozzle's width and the bottom spreads.
  cone.scale.set(bottom, len, bottom);
  cone.position.y = exitY - len / 2;
  // A diamond about every nozzle-width and a third down the flame.
  u.uDia.value = Math.min(0.5, (r * 2.6) / len);
  const flick = 0.9 + 0.1 * Math.sin(t * 37);
  const gs = r * (3.2 + 2.5 * thin) * (0.7 + 0.3 * power) * flick;
  glow.scale.set(gs, gs, 1);
  glow.position.y = exitY - r * 0.5;
  glow.material.opacity = Math.min(1, power) * (0.85 - thin * 0.3);
}

/* ------------------------------------------------------------------ */
/* Smoke, steam and water                                              */
/* ------------------------------------------------------------------ */

const smokeVert = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute float aShade;
  varying float vA;
  varying float vS;
  uniform float uScale;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(1.0, -mv.z);
    vA = aAlpha;
    vS = aShade;
    gl_Position = projectionMatrix * mv;
  }
`;
const smokeFrag = /* glsl */ `
  uniform vec3 uColor;
  varying float vA;
  varying float vS;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = dot(p, p);
    if (d > 1.0) discard;
    float a = (1.0 - d) * (1.0 - d) * vA;
    // A little lighter on top, as if lit by the sun.
    float lit = 0.84 + 0.16 * (1.0 - d) + 0.08 * (-p.y);
    gl_FragColor = vec4(uColor * vS * lit, a);
  }
`;

/**
 * Pooled puffs: exhaust smoke, steam out of the flame trench, and the
 * deluge's water. Positions are world metres; each puff grows and fades on
 * its own clock and has its own lift (steam rises, water falls) and shade.
 * `emit()` is cheap and a full pool simply reuses the oldest, so a long burn
 * never allocates.
 */
export class Smoke {
  constructor(kit, count = 220) {
    this.n = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.shade = new Float32Array(count).fill(1);
    this.age = new Float32Array(count).fill(99);
    this.life = new Float32Array(count).fill(1);
    this.grow = new Float32Array(count);
    this.lift = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.peak = new Float32Array(count);
    this.next = 0;
    const geo = kit.geo(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aShade', new THREE.BufferAttribute(this.shade, 1).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0xe9ecef) }, uScale: { value: 600 } },
      vertexShader: smokeVert,
      fragmentShader: smokeFrag,
      transparent: true,
      depthWrite: false,
    });
    kit.mats.push(mat);
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.geo = geo;
  }

  /**
   * One puff. `lift` is its upward acceleration (steam rises, −9.8 for
   * water), `drag` how fast the air slows it, `peak` its thickest opacity.
   */
  emit(x, y, z, vx, vy, vz, size, life, grow, shade = 1, lift = 0.6, drag = 0.9, peak = 0.55) {
    const i = this.next;
    this.next = (this.next + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.age[i] = 0;
    this.life[i] = life;
    this.grow[i] = grow;
    this.shade[i] = shade;
    this.lift[i] = lift;
    this.drag[i] = drag;
    this.peak[i] = peak;
  }

  update(dt, viewportH) {
    this.points.material.uniforms.uScale.value = viewportH * 0.9;
    for (let i = 0; i < this.n; i++) {
      if (this.age[i] >= this.life[i]) {
        this.alpha[i] = 0;
        continue;
      }
      this.age[i] += dt;
      const k = this.age[i] / this.life[i];
      const drag = Math.exp(-dt * this.drag[i]);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag + dt * this.lift[i];
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = Math.min(1, k * 8) * (1 - k) * this.peak[i];
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
    this.geo.attributes.aShade.needsUpdate = true;
  }

  clear() {
    this.age.fill(99);
    this.alpha.fill(0);
  }
}

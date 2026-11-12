/**
 * PLANE DEPTH: what makes a procedural aeroplane read as a solid machine up
 * close, laid over any model the game builds itself (model.js, the civil
 * builders in ./models/, the fleet pack and ./extra/). Medium and up only,
 * never on a weak device (model-adapter.js decides), loaded on demand.
 *
 *   1. Ambient occlusion from the model's own shape, per vertex: the wing
 *      root, the gaps round a flap or an aileron, the gear bays, the
 *      engine pylons and the fin fillet go darker, as the baked real models
 *      do (tools/real-models/detail.py). Computed once per type on a voxel
 *      grid of the airframe (rays marched from each vertex) and kept, so
 *      a second copy of the same aeroplane costs nothing. It rides on a
 *      `depthAO` attribute whose second component is a flag (0.5): a mesh
 *      without the attribute reads a default of 0 or 1 there and is left as
 *      it was, so a material shared with an aeroplane built without it is
 *      never darkened by mistake.
 *   2. The small parts every real aeroplane has: static wicks on the
 *      trailing edges, blade antennas top and bottom, a pitot probe, lens
 *      housings on the navigation lights and the beacons, flap-track
 *      fairings under an airliner's wing. Placed by probing the drawn
 *      geometry (the voxel grid, then an exact ray), each part is hung on
 *      the very mesh it sits on -- an aileron's wick moves with the
 *      aileron, a wing that breaks off takes its parts -- and drawn only
 *      within a few model lengths of the camera (THREE.LOD).
 *   3. The painted skin's relief: the shared 256 px panel-line normal map
 *      the civil builders and model.js paint with gives way to a sharper one
 *      on the same panel grid as the livery's drawn lines -- grooved seams,
 *      a rivet on every drawn rivet, the odd access hatch -- and a
 *      roughness map that sets each panel a shade apart, so the skin reads
 *      as sheets of metal rather than one moulding.
 *
 * The flight geometry, the gear, the strike points, the cockpits and the
 * breakup zones are not touched: nothing here edits a builder or moves a
 * vertex, and every part sits inside the aeroplane's own outline.
 */
import * as THREE from '../vendor/three.module.js';
import { REAL_MODELS, realModelsOn } from './real-models.js';
import { airframeNormal } from '../render/textures.js';

/** Not airframe: the look of a moment, or something that spins. */
const SKIP = /disc|blur|cone|glow|flame|plume|vapou?r|shock|halo|beam|spot ?light|shadow|haze|afterburner|propell|spinner|prop ?blade|^prop|rotor|blade|surface detail/i;
/** The undercarriage: shaded, but it casts no shade on the airframe (it folds away). */
const GEAR = /landing gear|main gear|nose gear|skid|oleo|axle|nose fork|wheel|tyre|tire|gear door|gear leg/i;
/** Civil builders whose own pitot / aerials are merged into the airframe (models/courier.js, meridian.js, helis.js). */
const OWN_PITOT = new Set(['courier', 'meridian', 'bell407', 'h145', 'r44', 'aw139', 'uh60', 'ch47', 'ah64', 'vh3d']);
const OWN_AERIALS = new Set(['courier', 'meridian']);
/** Grid cells across the model's longest side. */
const CELLS = 112;
/** How far (cells) a ray looks for something that shades the vertex. */
const REACH = 14;
/** Darkest a corner may go (the real models' bakes floor at 0.22-0.25). */
const MAX_DARK = 0.72;

let mats = null;

function sharedMaterials() {
  if (mats) return mats;
  const std = (color, rough, metal, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  mats = {
    dark: std(0x1b1e22, 0.55, 0.2),
    metal: std(0xc4c8cc, 0.28, 0.85),
    red: std(0xb0121a, 0.12, 0.1, { emissive: 0x5a0508, emissiveIntensity: 0.6 }),
    green: std(0x0d8f2c, 0.12, 0.1, { emissive: 0x034a12, emissiveIntensity: 0.6 }),
    clear: std(0xdfe6ec, 0.1, 0.2, { emissive: 0x20252a, emissiveIntensity: 0.3 }),
  };
  for (const [k, m] of Object.entries(mats)) {
    m.name = `depth ${k}`;
    m.userData.shared = true;
  }
  return mats;
}

/* ------------------------------------------------------------------ *
 * Survey
 * ------------------------------------------------------------------ */

function shownIn(o, root) {
  for (let p = o; p && p !== root; p = p.parent) if (!p.visible) return false;
  return true;
}
function named(o, root, re) {
  for (let p = o; p && p !== root; p = p.parent) if (re.test(p.name || '')) return true;
  return false;
}
/** Child-index path from the root: the same mesh in every build of a type. */
function pathOf(o, root) {
  const out = [];
  for (let p = o; p && p !== root; p = p.parent) out.push(p.parent ? p.parent.children.indexOf(p) : -1);
  return out.reverse().join('.');
}
function byPath(root, path) {
  let o = root;
  for (const k of path.split('.')) {
    o = o && o.children[Number(k)];
    if (!o) return null;
  }
  return o;
}
const opaque = (m) => m && !m.transparent && m.visible !== false && !m.isSpriteMaterial;

function survey(model) {
  const rootInv = new THREE.Matrix4().copy(model.matrixWorld).invert();
  const meshes = [];
  const geoUse = new Map();
  model.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || o.isSprite) return;
    const g = o.geometry;
    if (!g || !g.attributes.position || !shownIn(o, model) || named(o, model, SKIP)) return;
    const list = [].concat(o.material);
    if (!list.some(opaque)) return;
    geoUse.set(g, (geoUse.get(g) || 0) + 1);
    const M = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    meshes.push({ o, g, M, gear: named(o, model, GEAR), path: pathOf(o, model), std: list.some((m) => m && m.isMeshStandardMaterial) });
  });
  for (const m of meshes) m.shared = geoUse.get(m.g) > 1;
  return { meshes, rootInv };
}

/* ------------------------------------------------------------------ *
 * The voxel grid
 * ------------------------------------------------------------------ */

function triangles(m, fn) {
  const pos = m.g.attributes.position;
  const idx = m.g.index;
  const n = idx ? idx.count : pos.count;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i + 2 < n; i += 3) {
    const ia = idx ? idx.getX(i) : i;
    const ib = idx ? idx.getX(i + 1) : i + 1;
    const ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(m.M);
    b.fromBufferAttribute(pos, ib).applyMatrix4(m.M);
    c.fromBufferAttribute(pos, ic).applyMatrix4(m.M);
    fn(a, b, c);
  }
}

function buildGrid(meshes) {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const m of meshes) {
    if (m.gear) continue;
    const pos = m.g.attributes.position;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m.M));
  }
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const cell = Math.max(size.x, size.y, size.z) / CELLS;
  const pad = REACH + 3;
  const o = box.min.clone().subScalar(cell * pad);
  const nx = Math.ceil(size.x / cell) + pad * 2;
  const ny = Math.ceil(size.y / cell) + pad * 2;
  const nz = Math.ceil(size.z / cell) + pad * 2;
  const cells = new Uint8Array(nx * ny * nz);
  const inv = 1 / cell;
  const mark = (x, y, z) => {
    const i = ((x - o.x) * inv) | 0;
    const j = ((y - o.y) * inv) | 0;
    const k = ((z - o.z) * inv) | 0;
    cells[(k * ny + j) * nx + i] = 1;
  };
  const step = cell * 0.5;
  for (const m of meshes) {
    if (m.gear) continue;
    triangles(m, (a, b, c) => {
      const lab = a.distanceTo(b);
      const lac = a.distanceTo(c);
      const nu = Math.min(400, Math.ceil(lab / step));
      const nv = Math.min(400, Math.ceil(lac / step));
      for (let s = 0; s <= nu; s++) {
        const u = s / nu;
        for (let t = 0; t <= nv * (1 - u) + 1e-6; t++) {
          const w = t / nv;
          if (u + w > 1) break;
          mark(a.x + (b.x - a.x) * u + (c.x - a.x) * w, a.y + (b.y - a.y) * u + (c.y - a.y) * w, a.z + (b.z - a.z) * u + (c.z - a.z) * w);
        }
      }
      // the far edge (b-c), which the fan above can step past
      const lbc = b.distanceTo(c);
      const ne = Math.min(400, Math.ceil(lbc / step));
      for (let s = 0; s <= ne; s++) {
        const u = s / ne;
        mark(b.x + (c.x - b.x) * u, b.y + (c.y - b.y) * u, b.z + (c.z - b.z) * u);
      }
    });
  }
  const G = { o, cell, inv, nx, ny, nz, cells, box, size };
  G.at = (i, j, k) => (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz ? 0 : cells[(k * ny + j) * nx + i]);
  G.ix = (x) => Math.floor((x - o.x) * inv);
  G.iy = (y) => Math.floor((y - o.y) * inv);
  G.iz = (z) => Math.floor((z - o.z) * inv);
  G.x = (i) => o.x + (i + 0.5) * cell;
  G.y = (j) => o.y + (j + 0.5) * cell;
  G.z = (k) => o.z + (k + 0.5) * cell;
  return G;
}

/* ------------------------------------------------------------------ *
 * 1. Ambient occlusion
 * ------------------------------------------------------------------ */

const DIRS = (() => {
  const out = [];
  const n = 32;
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (2 * (i + 0.5)) / n;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  return out;
})();

/** Occlusion at a point on the skin with normal n (model frame): 0 open .. 1 shut in. */
function occAt(G, px, py, pz, nx0, ny0, nz0) {
  const { cells, nx, ny, nz, o, inv, cell } = G;
  const start = cell * 1.6;
  // Both ways off the surface, the more open one taken: a loft wound inside out (some face in,
  // drawn double-sided) is shaded from its outside all the same, and a thin plate from its open side.
  let best = 1;
  for (const sgn of [1, -1]) {
    const ax = nx0 * sgn;
    const ay = ny0 * sgn;
    const az = nz0 * sgn;
    const sx = px + ax * start;
    const sy = py + ay * start;
    const sz = pz + az * start;
    let occ = 0;
    let tot = 0;
    for (const d of DIRS) {
      const w = d[0] * ax + d[1] * ay + d[2] * az;
      if (w < 0.17) continue;
      tot += w;
      for (let s = 1; s <= REACH; s++) {
        const t = s * cell;
        const i = ((sx + d[0] * t - o.x) * inv) | 0;
        const j = ((sy + d[1] * t - o.y) * inv) | 0;
        const k = ((sz + d[2] * t - o.z) * inv) | 0;
        if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) break;
        if (cells[(k * ny + j) * nx + i]) {
          occ += w * (1 - (s - 1) / REACH);
          break;
        }
      }
    }
    const f = tot > 0 ? occ / tot : 0;
    if (f < best) best = f;
    // open on the normal's own side: the other cannot be more open by enough to matter
    if (best < 0.12) break;
  }
  return best;
}

/**
 * Per-vertex shade for one mesh. A vertex's shade is spread over every triangle it is a corner
 * of, so on a coarse mesh (the fleet pack's lofts, a metre a facet) one dark corner at a root
 * greyed a whole fin. There each corner is sampled a third of the way into each of its
 * triangles instead, and the samples averaged: the shade stays where the corner is.
 */
function occlusion(m, G) {
  const pos = m.g.attributes.position;
  const nor = m.g.attributes.normal;
  const out = new Float32Array(pos.count);
  if (!nor) return out;
  const nm = new THREE.Matrix3().getNormalMatrix(m.M);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  const cell = G.cell;
  let edge = 0;
  let ne = 0;
  triangles(m, (a, b, c) => {
    if (ne < 6000) {
      edge += a.distanceTo(b) + b.distanceTo(c) + c.distanceTo(a);
      ne += 3;
    }
  });
  const coarse = ne ? edge / ne / cell : 1;
  const idx = m.g.index;
  const nTri = (idx ? idx.count : pos.count) / 3;
  const gain = 1.5;
  const normalOf = (v) => {
    n.fromBufferAttribute(nor, v).applyMatrix3(nm);
    const len = n.length();
    return len < 1e-6 ? null : n.multiplyScalar(1 / len);
  };
  if (coarse > 2.5 && nTri < 20000) {
    const sum = new Float32Array(pos.count);
    const cnt = new Float32Array(pos.count);
    const P = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const cen = new THREE.Vector3();
    for (let t = 0; t < nTri; t++) {
      const vs = [0, 1, 2].map((q) => (idx ? idx.getX(t * 3 + q) : t * 3 + q));
      for (let q = 0; q < 3; q++) P[q].fromBufferAttribute(pos, vs[q]).applyMatrix4(m.M);
      cen.copy(P[0]).add(P[1]).add(P[2]).multiplyScalar(1 / 3);
      for (let q = 0; q < 3; q++) {
        const nn = normalOf(vs[q]);
        if (!nn) continue;
        // a third of the way in, but never more than a few cells from the corner
        p.copy(cen).sub(P[q]);
        const l = p.length();
        p.multiplyScalar(Math.min(0.34, (cell * 3) / Math.max(l, 1e-6))).add(P[q]);
        sum[vs[q]] += occAt(G, p.x, p.y, p.z, nn.x, nn.y, nn.z);
        cnt[vs[q]]++;
      }
    }
    for (let v = 0; v < pos.count; v++) out[v] = cnt[v] ? Math.min(MAX_DARK, (sum[v] / cnt[v]) * gain) : 0;
    return out;
  }
  for (let v = 0; v < pos.count; v++) {
    p.fromBufferAttribute(pos, v).applyMatrix4(m.M);
    const nn = normalOf(v);
    if (!nn) continue;
    out[v] = Math.min(MAX_DARK, occAt(G, p.x, p.y, p.z, nn.x, nn.y, nn.z) * gain);
  }
  return out;
}

const PATCHED = '|depthAO';
function patchMaterial(mat) {
  if (!mat || !mat.isMeshStandardMaterial || mat.userData.depthAO) return;
  mat.userData.depthAO = true;
  const before = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey ? mat.customProgramCacheKey() : '';
  mat.onBeforeCompile = function (sh, r) {
    if (typeof before === 'function') before.call(this, sh, r);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 depthAO;\nvarying float vDepthAO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDepthAO = abs(depthAO.y - 0.5) < 0.25 ? depthAO.x : 0.0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDepthAO;')
      .replace(
        '#include <aomap_fragment>',
        `#include <aomap_fragment>
{
  // the ambient light shut out (squared: a corner reads as a corner), and part of the sun as the
  // real models' bakes take it (real-detail.js DIRECT_AO), so a lit side stays lit
  float depthL = 1.0 - vDepthAO;
  float depthK = depthL * depthL;
  reflectedLight.indirectDiffuse *= depthK;
  reflectedLight.indirectSpecular *= mix(1.0, depthK, 0.85);
  reflectedLight.directDiffuse *= mix(1.0, depthL, 0.7);
  reflectedLight.directSpecular *= mix(1.0, depthL, 0.7);
}`,
      );
  };
  mat.customProgramCacheKey = () => key + PATCHED;
  mat.needsUpdate = true;
}

/* ------------------------------------------------------------------ *
 * 3. The skin's relief
 * ------------------------------------------------------------------ */

let skinMaps = null;
/** The panel grid of textures.js airframeTexture (10 x 8 panels, a rivet every 18/1024), sharper. */
function skinRelief() {
  if (skinMaps) return skinMaps;
  const S = 512;
  const k = S / 1024;
  const H = new Float32Array(S * S);
  const panel = new Float32Array(S * S);
  const rnd = (a, b) => {
    const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return x - Math.floor(x);
  };
  const g = (d, w) => Math.exp(-(d * d) / (w * w));
  const pitch = 18 * k;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      // canvas coordinates, as the livery's lines are drawn
      const fx = (x / S) * 10;
      const fy = (y / S) * 8;
      const dx = Math.abs(fx - Math.round(fx)) * (S / 10);
      const dy = Math.abs(fy - Math.round(fy)) * (S / 8);
      const onX = Math.round(fx) > 0 && Math.round(fx) < 10;
      const onY = Math.round(fy) > 0 && Math.round(fy) < 8;
      let h = 0;
      if (onX) h -= g(dx, 1.4);
      if (onY) h -= g(dy, 1.4);
      // rivets: domes on the lines, where the livery draws its dots
      if (onX && dx < 3) {
        const r = Math.abs(((y - 6 * k) % pitch + pitch) % pitch);
        const dr = Math.min(r, pitch - r);
        h += 0.55 * g(Math.hypot(dr, dx), 1.3);
      }
      if (onY && dy < 3) {
        const r = Math.abs(((x - 6 * k) % pitch + pitch) % pitch);
        const dr = Math.min(r, pitch - r);
        h += 0.55 * g(Math.hypot(dr, dy), 1.3);
      }
      // an access hatch in one panel in four: a shallow groove round a small rectangle
      const px = Math.floor(fx);
      const py = Math.floor(fy);
      if (rnd(px, py) < 0.25) {
        const cx = (px + 0.3 + rnd(py, px) * 0.4) * (S / 10);
        const cy = (py + 0.3 + rnd(px + 7, py) * 0.4) * (S / 8);
        const hw = (S / 10) * 0.16;
        const hh = (S / 8) * 0.13;
        const ex = Math.abs(Math.abs(x - cx) - hw);
        const ey = Math.abs(Math.abs(y - cy) - hh);
        if (Math.abs(x - cx) < hw + 2 && Math.abs(y - cy) < hh + 2) h -= 0.6 * Math.max(Math.abs(y - cy) <= hh ? g(ex, 0.7) : 0, Math.abs(x - cx) <= hw ? g(ey, 0.7) : 0);
      }
      const row = S - 1 - y; // the canvas is drawn top down, a DataTexture bottom up
      H[row * S + x] = h;
      panel[row * S + x] = rnd(px + 3, py + 11) + (onX ? g(dx, 2.5) : 0) * 0.5 + (onY ? g(dy, 2.5) : 0) * 0.5;
    }
  }
  const nd = new Uint8Array(S * S * 4);
  const rd = new Uint8Array(S * S * 4);
  const K = 2;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const hx = H[y * S + ((x + 1) % S)] - H[y * S + ((x - 1 + S) % S)];
      const hy = H[((y + 1) % S) * S + x] - H[((y - 1 + S) % S) * S + x];
      let nx = -K * hx * 0.5;
      let ny = -K * hy * 0.5;
      const l = Math.hypot(nx, ny, 1);
      nd[i * 4] = Math.round(((nx / l) * 0.5 + 0.5) * 255);
      nd[i * 4 + 1] = Math.round(((ny / l) * 0.5 + 0.5) * 255);
      nd[i * 4 + 2] = Math.round(((1 / l) * 0.5 + 0.5) * 255);
      nd[i * 4 + 3] = 255;
      // roughness (G): each panel a shade apart, the seams a little rougher
      const r = Math.min(1, 0.86 + (panel[i] - 0.5) * 0.1);
      rd[i * 4] = rd[i * 4 + 2] = 255;
      rd[i * 4 + 1] = Math.round(r * 255);
      rd[i * 4 + 3] = 255;
    }
  }
  const tex = (data) => {
    const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.anisotropy = 8;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  skinMaps = { normal: tex(nd), rough: tex(rd) };
  skinMaps.normal.name = 'airframe relief (detail)';
  skinMaps.rough.name = 'airframe panels (roughness)';
  return skinMaps;
}

/** Swap the shared low-res relief for the sharp one on this model's painted skin. */
function reliefOn(model) {
  const old = airframeNormal();
  let n = 0;
  const done = new Set();
  const meshes = [];
  model.traverse((o) => o.isMesh && meshes.push(o));
  for (const o of meshes) {
    for (const mat of [].concat(o.material)) {
      if (!mat || done.has(mat) || mat.normalMap !== old) continue;
      done.add(mat);
      const R = skinRelief();
      mat.normalMap = R.normal;
      if (!mat.roughnessMap) {
        mat.roughnessMap = R.rough;
        // the map averages ~0.86 of the material's own roughness: put the average back
        mat.roughness = Math.min(1, mat.roughness / 0.86);
      }
      mat.needsUpdate = true;
      n++;
    }
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * 2. The small parts
 * ------------------------------------------------------------------ */

/** Plain non-indexed triangles from a list of [x,y,z] corners, flat normals, one uv. */
function prism(faces) {
  const p = [];
  for (const f of faces) for (let i = 1; i + 1 < f.length; i++) p.push(...f[0], ...f[i], ...f[i + 1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((p.length / 3) * 2), 2));
  return g;
}

/** A blade antenna: base along +Z (aft), standing up +Y, swept back, `h` tall. */
function bladeGeo(h) {
  const c0 = h * 0.72;
  const c1 = h * 0.32;
  const sw = h * 0.5;
  const t0 = c0 * 0.09;
  const t1 = c1 * 0.06;
  const B = [
    [-t0, 0, -c0 / 2], [t0, 0, -c0 / 2], [t0, 0, c0 / 2], [-t0, 0, c0 / 2],
  ];
  const T = [
    [-t1, h, -c0 / 2 + sw], [t1, h, -c0 / 2 + sw], [t1, h, -c0 / 2 + sw + c1], [-t1, h, -c0 / 2 + sw + c1],
  ];
  // leading and trailing edges sharpened: the side faces meet in a line fore and aft
  const LE0 = [0, 0, -c0 / 2 - t0 * 2];
  const LE1 = [0, h, -c0 / 2 + sw - t1 * 2];
  const TE0 = [0, 0, c0 / 2 + t0];
  const TE1 = [0, h, -c0 / 2 + sw + c1 + t1];
  return prism([
    [B[1], LE0, LE1, T[1]].reverse(),
    [B[0], T[0], LE1, LE0].reverse(),
    [B[1], T[1], T[2], B[2]],
    [B[0], B[3], T[3], T[0]],
    [B[2], T[2], TE1, TE0],
    [B[3], TE0, TE1, T[3]],
    [T[0], T[3], TE1, T[2], T[1], LE1],
  ]);
}

function cyl(r0, r1, len, seg = 6) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1, false);
  g.translate(0, len / 2, 0);
  return g.toNonIndexed();
}

/** A static wick: a thin rod from its root along +Z, with a holder. */
function wickGeo(len) {
  const r = Math.max(0.006, len * 0.045);
  const rod = cyl(r * 1.4, r * 0.7, len, 5);
  rod.rotateX(Math.PI / 2);
  const tip = cyl(r * 0.7, r * 0.2, len * 0.12, 5);
  tip.rotateX(Math.PI / 2);
  tip.translate(0, 0, len);
  return merge([rod, tip]);
}

/** A pitot probe: a strut out along +Y, the tube forward (-Z) from its end. */
function pitotGeo(strut, tube) {
  const r = Math.max(0.008, strut * 0.11);
  const s = cyl(r * 1.6, r * 0.9, strut, 6);
  const t = cyl(r, r * 0.8, tube, 8);
  t.rotateX(-Math.PI / 2);
  t.translate(0, strut, tube * 0.3);
  const head = cyl(r * 0.8, r * 0.45, tube * 0.12, 8);
  head.rotateX(-Math.PI / 2);
  head.translate(0, strut, -tube * 0.7);
  return merge([s, t, head]);
}

/** A lens or beacon dome: a flattened half sphere on +Y, `long` times as long along Z. */
function domeGeo(r, long = 1, flat = 0.55) {
  const g = new THREE.SphereGeometry(r, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2).toNonIndexed();
  g.scale(1, flat, long);
  return g;
}

/** A flap-track fairing: a canoe along +Z under the wing (hanging -Y), `len` long. */
function fairingGeo(len, h, w) {
  const pts = [];
  const n = 10;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // blunt ahead, a long taper aft
    const r = Math.sin(Math.PI * Math.min(1, t * 1.6) * 0.5) * (t < 0.62 ? 1 : 1 - ((t - 0.62) / 0.38) ** 1.6 * 0.92);
    pts.push(new THREE.Vector2(Math.max(0.001, r), t * len));
  }
  const g = new THREE.LatheGeometry(pts, 10).toNonIndexed();
  // along +Y -> along +Z, then flattened: deep (h) and narrow (w)
  g.rotateX(Math.PI / 2);
  g.scale(w, h, 1);
  // only the lower half shows: lift it so its top sits in the wing
  g.translate(0, -h * 0.35, 0);
  return g;
}

function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const U = new Float32Array(n * 2);
  let o = 0;
  for (const g0 of list) {
    const g = g0.index ? g0.toNonIndexed() : g0;
    if (!g.attributes.normal) g.computeVertexNormals();
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array.subarray(0, c * 2), o * 2);
    o += c;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return g;
}

/** Put `geo` at `at` (root frame) with +Y along `up` and +Z toward `aft`, into `toParent`'s frame. */
function placed(geo, at, up, aft, toParent, uv = null) {
  const Y = up.clone().normalize();
  const Z = aft.clone().addScaledVector(Y, -aft.dot(Y));
  if (Z.lengthSq() < 1e-8) Z.set(0, 0, 1).addScaledVector(Y, -Y.z);
  Z.normalize();
  const X = new THREE.Vector3().crossVectors(Y, Z);
  const m = new THREE.Matrix4().makeBasis(X, Y, Z).setPosition(at);
  const g = geo.clone();
  g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toParent, m));
  if (uv) {
    const u = g.attributes.uv;
    for (let i = 0; i < u.count; i++) u.setXY(i, uv.x, uv.y);
  }
  return g;
}

function dress(model, type, sv, G) {
  const s = model.scale.x || 1; // metres per model unit
  const B = G.box;
  const L = B.max.z - B.min.z;
  const spanM = (B.max.x - B.min.x) * s;
  const lenM = L * s;
  const big = Math.max(spanM, lenM);
  const heli = !!(type && type.shape && type.shape.power && type.shape.power.rotor);
  const jet = !!(type && type.shape && type.shape.power && type.shape.power.kind === 'jet');
  const targets = sv.meshes.filter((m) => !m.gear).map((m) => m.o);
  const ray = new THREE.Raycaster();
  const W = model.matrixWorld;
  const wInv = sv.rootInv;
  // the rays must see a skin from either side (some lofts face in)
  const sides = [];
  for (const o of targets) for (const m of [].concat(o.material)) if (m && m.side !== THREE.DoubleSide) sides.push([m, m.side]);
  for (const [m] of sides) m.side = THREE.DoubleSide;
  const cast = (from, dir, far) => {
    ray.set(from.clone().applyMatrix4(W), dir.clone().transformDirection(W));
    ray.far = far * W.getMaxScaleOnAxis();
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) return null;
    const p = hit.point.clone().applyMatrix4(wInv);
    const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld).transformDirection(wInv) : dir.clone().negate();
    if (n.dot(dir) > 0) n.negate();
    const list = [].concat(hit.object.material);
    const mi = hit.face && list[hit.face.materialIndex] ? hit.face.materialIndex : 0;
    return { p, n, o: hit.object, uv: hit.uv || null, mat: list[mi], mi: Array.isArray(hit.object.material) ? mi : -1, d: hit.distance / W.getMaxScaleOnAxis() };
  };
  const out = new Map(); // `${path}#${material key}` -> { path, mat, list: [geo] }
  const put = (hit, geo, up, aft, mat, uv = null) => {
    if (!hit || !hit.o) return;
    const toParent = new THREE.Matrix4().multiplyMatrices(wInv, hit.o.matrixWorld).invert();
    // a shared part material by name, or the skin it sits on by its index on that mesh
    const key = typeof mat === 'string' ? mat : `skin${hit.mi}`;
    const path = pathOf(hit.o, model);
    const k = `${path}#${key}`;
    if (!out.has(k)) out.set(k, { path, mat: key, list: [] });
    out.get(k).list.push(placed(geo, hit.p, up, aft, toParent, uv));
  };
  const M = { dark: 'dark', metal: 'metal', red: 'red', green: 'green', clear: 'clear' };
  const UP = new THREE.Vector3(0, 1, 0);
  const DOWN = new THREE.Vector3(0, -1, 0);
  const AFT = new THREE.Vector3(0, 0, 1);
  const FWD = new THREE.Vector3(0, 0, -1);
  const c = G.cell;
  const i0 = G.ix(0);
  const count = { wicks: 0, antennas: 0, pitot: 0, lenses: 0, fairings: 0 };
  // What the model already has, by name (the fleet pack's parts) or by type (a civil builder's,
  // merged into its airframe batch, nameless): not drawn twice.
  const has = (re) => {
    let f = false;
    model.traverse((o) => {
      if (re.test(o.name || '')) f = true;
    });
    return f;
  };
  const id = (type && type.id) || '';
  const ownPitot = OWN_PITOT.has(id) || has(/pitot/i);
  const ownAerials = OWN_AERIALS.has(id) || has(/antenna|aerial/i);

  // -- the fuselage, along its centreline column --
  const col = (k) => {
    let top = -1;
    let bot = -1;
    for (let j = G.ny - 1; j >= 0; j--) if (G.at(i0, j, k) || G.at(i0 - 1, j, k)) { top = j; break; }
    for (let j = 0; j < G.ny; j++) if (G.at(i0, j, k) || G.at(i0 - 1, j, k)) { bot = j; break; }
    return top < 0 ? null : { top, bot };
  };
  let kN = -1;
  let kT = -1;
  for (let k = 0; k < G.nz; k++) if (col(k)) { if (kN < 0) kN = k; kT = k; }
  if (kN < 0) return count;
  const zN = G.z(kN);
  const zT = G.z(kT);
  const BL = zT - zN;
  const zAt = (f) => zN + BL * f;
  const axisY = (z) => {
    const cc = col(G.iz(z));
    return cc ? (G.y(cc.top) + G.y(cc.bot)) / 2 : (B.min.y + B.max.y) / 2;
  };
  // the body's half width: the run of cells out from the centreline, median over the middle
  const halves = [];
  for (let k = Math.round(kN + (kT - kN) * 0.3); k <= Math.round(kN + (kT - kN) * 0.7); k++) {
    const cc = col(k);
    if (!cc) continue;
    const j = (cc.top + cc.bot) >> 1;
    let i = i0;
    while (i < G.nx && (G.at(i, j, k) || G.at(i, j + 1, k) || G.at(i, j - 1, k))) i++;
    halves.push(G.x(i) - 0);
  }
  halves.sort((a, b) => a - b);
  const bodyHalf = halves.length ? halves[halves.length >> 1] : c * 4;

  // -- the wing: its tip, and its trailing edge tracked inboard --
  let iTip = -1;
  for (let i = G.nx - 1; i > i0 && iTip < 0; i--) for (let k = 0; k < G.nz && iTip < 0; k++) for (let j = 0; j < G.ny; j++) if (G.at(i, j, k)) { iTip = i; break; }
  const xTip = iTip > 0 ? G.x(iTip) : 0;
  const winged = !heli && xTip > bodyHalf * 2.2;
  /** Slice i: the run of the surface nearest height jRef, within kLo..kHi -> { le, te, j } (cells). */
  const sliceRun = (i, jRef, kLo = 0, kHi = G.nz - 1, tol = 3) => {
    let le = -1;
    let te = -1;
    const js = [];
    for (let k = kLo; k <= kHi; k++)
      for (let j = Math.max(0, jRef - tol); j <= Math.min(G.ny - 1, jRef + tol); j++)
        if (G.at(i, j, k)) {
          if (le < 0) le = k;
          te = k;
          js.push(j);
        }
    if (le < 0) return null;
    js.sort((a, b) => a - b);
    return { le, te, j: js[js.length >> 1] };
  };
  const tipRef = (iT, kLo, kHi) => {
    const js = [];
    for (let k = kLo; k <= kHi; k++) for (let j = 0; j < G.ny; j++) if (G.at(iT, j, k)) js.push(j);
    js.sort((a, b) => a - b);
    return js.length ? js[js.length >> 1] : -1;
  };
  /** Track a lifting surface from its tip slice inboard to x: { le, te, y } in model units, right side. */
  const track = (iT, x, kLo, kHi) => {
    let jRef = tipRef(iT, kLo, kHi);
    if (jRef < 0) return null;
    let run = null;
    for (let i = iT; i >= G.ix(x); i--) {
      const r = sliceRun(i, jRef, kLo, kHi);
      if (!r) return null;
      run = r;
      jRef = r.j;
    }
    return run && { le: G.z(run.le) - c / 2, te: G.z(run.te) + c / 2, y: G.y(run.j), j: run.j };
  };
  /** The exact trailing edge at x near zGuess: downward rays, the last that still hits the surface near y. */
  const trailing = (x, y, zGuess, tolY) => {
    const above = y + c * 6;
    const hitAt = (z) => {
      const h = cast(new THREE.Vector3(x, above, z), DOWN, c * 12);
      return h && Math.abs(h.p.y - y) < tolY ? h : null;
    };
    let lo = zGuess - c * 1.5;
    let hi = zGuess + c * 1.5;
    let hLo = hitAt(lo);
    if (!hLo) {
      lo = zGuess - c * 3;
      hLo = hitAt(lo);
      if (!hLo) return null;
    }
    if (hitAt(hi)) return null;
    for (let it = 0; it < 7; it++) {
      const mid = (lo + hi) / 2;
      const h = hitAt(mid);
      if (h) {
        lo = mid;
        hLo = h;
      } else hi = mid;
    }
    return hLo;
  };
  const wickLen = Math.min(0.42, Math.max(0.12, big * 0.0065)) / s;
  const wick = wickGeo(wickLen);
  const addWick = (h, side, out_ = 0.12) => {
    if (!h) return;
    // the wick's root a little ahead of the edge (in the skin), pointing aft and a touch outboard
    h.p.z -= wickLen * 0.12;
    put(h, wick, h.n.y > 0 ? UP : DOWN, new THREE.Vector3(side * out_, 0, 1), M.dark);
    count.wicks++;
  };

  const wantsWicks = !heli && (jet || big > 14);
  const mid = (zN + zT) / 2;
  const kMidAft = G.iz(mid + BL * 0.18);
  if (winged) {
    // the main wing's chordwise window: everything ahead of the tailplanes
    const tipLe = (() => {
      let le = G.nz;
      let te = -1;
      for (let k = 0; k < G.nz; k++) for (let j = 0; j < G.ny; j++) if (G.at(iTip, j, k)) { le = Math.min(le, k); te = Math.max(te, k); }
      return { le, te };
    })();
    const kLo = Math.max(0, tipLe.le - Math.round(BL / c));
    const kHi = Math.min(G.nz - 1, tipLe.te + Math.round((BL * 0.12) / c));
    if (wantsWicks) {
      for (const f of [0.035, 0.085, 0.14]) {
        const x = xTip * (1 - f);
        const t = track(iTip, x, kLo, kHi);
        if (!t) continue;
        for (const side of [1, -1]) addWick(trailing(side * x, t.y, t.te, c * 2.5), side);
      }
    }
    // the pitot: a jet's on each side of the nose, a light aeroplane's under the left wing
    if (!jet && !ownPitot) {
      for (const f of [0.55, 0.64, 0.72]) {
        const x = xTip * f;
        const t = track(iTip, x, kLo, kHi);
        if (!t) continue;
        const chord = t.te - t.le;
        const h = cast(new THREE.Vector3(-x, t.y - c * 8, t.le + chord * 0.22), UP, c * 10);
        if (!h || Math.abs(h.p.y - t.y) > c * 2.5 || h.n.y > -0.4) continue;
        const strut = Math.min(0.16, Math.max(0.07, big * 0.006)) / s;
        put(h, pitotGeo(strut, chord * 0.45 + strut), DOWN, AFT, M.metal);
        count.pitot++;
        break;
      }
    }
    // flap-track fairings: a swept airliner wing's
    const military = !!(type && type.military);
    const hasOwn = (() => {
      let f = false;
      model.traverse((o) => {
        if (/fairing|flap track|canoe/i.test(o.name || '')) f = true;
      });
      return f;
    })();
    if (jet && !military && spanM > 18 && !hasOwn && !(type && type.shape && type.shape.flyingWing)) {
      const ts = [0.3, 0.5, 0.7].map((f) => track(iTip, xTip * f, kLo, kHi));
      const deltaLike = ts.some((t) => !t || t.te - t.le > BL * 0.33);
      if (!deltaLike) {
        for (let q = 0; q < 3; q++) {
          const t = ts[q];
          const x = xTip * [0.3, 0.5, 0.7][q];
          if (x < bodyHalf * 1.5) continue;
          const chord = t.te - t.le;
          for (const side of [1, -1]) {
            const h = cast(new THREE.Vector3(side * x, t.y - c * 8, t.te - chord * 0.3), UP, c * 10);
            if (!h || Math.abs(h.p.y - t.y) > c * 3 || h.n.y > -0.3) continue;
            const len = chord * 0.62;
            h.p.z -= chord * 0.18;
            put(h, fairingGeo(len, chord * 0.11, chord * 0.055), UP, AFT, null, h.uv);
            count.fairings++;
          }
        }
      }
    }
  }
  // -- the jet's pitots, either side of the nose --
  if (jet && !heli && !ownPitot) {
    const z = zN + BL * 0.11;
    const y = axisY(z) + c * 0.5;
    for (const side of [1, -1]) {
      const h = cast(new THREE.Vector3(side * (bodyHalf + c * 10), y, z), new THREE.Vector3(-side, 0, 0), bodyHalf + c * 12);
      if (!h || Math.abs(h.n.x) < 0.45) continue;
      const strut = Math.min(0.14, Math.max(0.05, big * 0.004)) / s;
      put(h, pitotGeo(strut, strut * 2.4), h.n, FWD.clone().negate(), M.metal);
      count.pitot++;
    }
  }
  // -- the tailplane and the fin, for wicks --
  if (wantsWicks) {
    let iTT = -1;
    for (let i = G.nx - 1; i > i0 && iTT < 0; i--) for (let k = kMidAft; k < G.nz && iTT < 0; k++) for (let j = 0; j < G.ny; j++) if (G.at(i, j, k)) { iTT = i; break; }
    const xTT = iTT > 0 ? G.x(iTT) : 0;
    if (xTT > bodyHalf * 2 && xTT < xTip * 0.72) {
      for (const f of [0.05, 0.13]) {
        const x = xTT * (1 - f);
        const t = track(iTT, x, kMidAft, G.nz - 1);
        if (!t) continue;
        for (const side of [1, -1]) addWick(trailing(side * x, t.y, t.te, c * 2.5), side, 0.08);
      }
    }
    // the fin: its top, and the trailing edge just below it
    let jTop = -1;
    let kTop = -1;
    for (let j = G.ny - 1; j >= 0 && jTop < 0; j--) for (let k = kMidAft; k < G.nz; k++) if (G.at(i0, j, k) || G.at(i0 - 1, j, k)) { jTop = j; kTop = k; break; }
    const cc = kTop >= 0 ? col(G.iz(mid)) : null;
    if (jTop > 0 && cc && jTop > cc.top + 3) {
      for (const f of [0.06, 0.16]) {
        const jj = Math.round(jTop - (jTop - cc.top) * f) - 1;
        let te = -1;
        for (let k = kMidAft; k < G.nz; k++) if (G.at(i0, jj, k) || G.at(i0 - 1, jj, k)) te = k;
        if (te < 0) continue;
        const y = G.y(jj);
        const at = (z) => {
          const h = cast(new THREE.Vector3(c * 8, y, z), new THREE.Vector3(-1, 0, 0), c * 16);
          return h && Math.abs(h.p.x) < c * 3 ? h : null;
        };
        let lo = G.z(te) - c * 1.5;
        let hi = G.z(te) + c * 1.5;
        let hLo = at(lo);
        if (!hLo || at(hi)) continue;
        for (let it = 0; it < 7; it++) {
          const m = (lo + hi) / 2;
          const h = at(m);
          if (h) {
            lo = m;
            hLo = h;
          } else hi = m;
        }
        hLo.p.z -= wickLen * 0.12;
        hLo.p.x = 0;
        put(hLo, wick, new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0.25, 1), M.dark);
        count.wicks++;
      }
    }
  }
  // -- blade antennas on the spine and the belly, and the beacons --
  const bladeH = Math.min(0.55, Math.max(0.14, big * 0.011)) / s;
  const blade = bladeGeo(bladeH);
  const onSpine = (f, up) => {
    const z = zAt(f);
    const cc = col(G.iz(z));
    if (!cc) return null;
    const yEdge = up ? G.y(cc.top) : G.y(cc.bot);
    const h = cast(new THREE.Vector3(0, yEdge + (up ? c * 6 : -c * 6), z), up ? DOWN : UP, c * 9);
    if (!h || (up ? h.n.y < 0.6 : h.n.y > -0.6)) return null;
    if (h.mat && (h.mat.name === 'glass' || h.mat.transparent)) return null;
    return h;
  };
  const spineList = heli || ownAerials ? [] : jet ? [0.3, 0.62] : [0.58];
  const bellyList = ownAerials ? [] : heli ? [0.34, 0.5] : jet ? [0.24, 0.66] : [0.62];
  for (const f of spineList) {
    const h = onSpine(f, true);
    if (h) {
      put(h, blade, h.n, AFT, null, h.uv);
      count.antennas++;
    }
  }
  for (const f of bellyList) {
    const h = onSpine(f, false);
    if (h) {
      put(h, blade, h.n, AFT, M.dark);
      count.antennas++;
    }
  }
  // -- lens housings over the lamps the model already has --
  const lensR = Math.min(0.22, Math.max(0.045, big * 0.0042)) / s;
  model.traverse((o) => {
    if (!o.isSprite || !o.material || !o.material.color) return;
    const col_ = o.material.color;
    const at = o.getWorldPosition(new THREE.Vector3()).applyMatrix4(wInv);
    const red = col_.r > 0.8 && col_.g < 0.45 && col_.b < 0.45;
    const green = col_.g > 0.8 && col_.r < 0.45;
    const white = col_.r > 0.85 && col_.g > 0.85 && col_.b > 0.85;
    let h = null;
    let mat = null;
    let long = 1.6;
    let r = lensR;
    if ((red || green) && Math.abs(at.x) > xTip * 0.6 && winged) {
      const side = Math.sign(at.x);
      h = cast(new THREE.Vector3(at.x + side * c * 4, at.y, at.z), new THREE.Vector3(-side, 0, 0), c * 8);
      if (h && h.p.distanceTo(at) > c * 4) h = null;
      mat = red ? M.red : M.green;
    } else if (red && Math.abs(at.x) < bodyHalf * 1.2) {
      const up = at.y > axisY(at.z);
      h = cast(new THREE.Vector3(at.x, at.y + (up ? c * 4 : -c * 4), at.z), up ? DOWN : UP, c * 8);
      if (h && h.p.distanceTo(at) > c * 4) h = null;
      mat = M.red;
      long = 1;
    } else if (white && Math.abs(at.x) < bodyHalf && at.z > mid + BL * 0.3 && o.scale.x < 0.5) {
      h = cast(new THREE.Vector3(at.x, at.y, at.z + c * 4), FWD, c * 8);
      if (h && h.p.distanceTo(at) > c * 4) h = null;
      mat = M.clear;
      long = 1;
      // a tail light is a small lens: no wider than the surface it sits on (a fighter's fin edge is a few cm)
      const w = cast(new THREE.Vector3(at.x + c * 4, h ? h.p.y : at.y, h ? h.p.z - c * 0.3 : at.z), new THREE.Vector3(-1, 0, 0), c * 8);
      const w2 = cast(new THREE.Vector3(at.x - c * 4, h ? h.p.y : at.y, h ? h.p.z - c * 0.3 : at.z), new THREE.Vector3(1, 0, 0), c * 8);
      if (w && w2) r = Math.min(r * 0.6, Math.max(0.025 / s, (w.p.x - w2.p.x) * 0.5 + 0.01 / s));
      else r *= 0.6;
    }
    if (!h) return;
    put(h, domeGeo(r, long), h.n, Math.abs(h.n.z) > 0.8 ? UP : AFT, mat);
    count.lenses++;
  });
  for (const [m, side] of sides) m.side = side;

  const groups = [...out.values()].map((g) => ({ path: g.path, mat: g.mat, geo: merge(g.list) }));
  return { count, groups, near: Math.max(60, Math.min(260, big * 5)) / s };
}

/** Hang a plan's parts on this copy of the model: one mesh per part and material, near the camera only. */
function hang(model, plan) {
  const M = sharedMaterials();
  const byParent = new Map();
  for (const g of plan.groups) {
    const parent = byPath(model, g.path);
    if (!parent || !parent.isMesh) continue;
    let mat = M[g.mat];
    if (!mat) {
      const i = Number(g.mat.slice(4));
      mat = i >= 0 ? [].concat(parent.material)[i] : [].concat(parent.material)[0];
    }
    if (!mat) continue;
    const mesh = new THREE.Mesh(g.geo, mat);
    mesh.name = 'surface detail';
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(mesh);
  }
  const made = [];
  for (const [parent, list] of byParent) {
    const g = new THREE.Group();
    g.name = 'surface detail';
    for (const m of list) g.add(m);
    // Hidden until the LOD first sees a camera (three.js LOD.update shows it then): a parked
    // aeroplane baked straight after it is built (world/airport-kit.js bakeModel, the apron, the
    // flyers far off) leaves the parts out, rather than keep them at every distance.
    g.visible = false;
    const lod = new THREE.LOD();
    lod.name = 'surface detail';
    lod.addLevel(g, 0);
    lod.addLevel(new THREE.Object3D(), plan.near);
    parent.add(lod);
    made.push(lod);
  }
  return made;
}

/* ------------------------------------------------------------------ *
 * Entry
 * ------------------------------------------------------------------ */

const plans = new Map(); // `${id}|${signature}` -> { ao: Map(path -> darkness), dress }
const PLAN_MAX = 48;

function applyAO(sv, plan) {
  let n = 0;
  for (const m of sv.meshes) {
    const dark = plan.ao.get(m.path);
    if (!dark || m.g.attributes.depthAO || dark.length !== m.g.attributes.position.count) continue;
    const a = new Float32Array(dark.length * 2);
    for (let i = 0; i < dark.length; i++) {
      a[i * 2] = dark[i];
      a[i * 2 + 1] = 0.5;
    }
    m.g.setAttribute('depthAO', new THREE.BufferAttribute(a, 2));
    for (const mat of [].concat(m.o.material)) patchMaterial(mat);
    n++;
  }
  return n;
}

/** Give a freshly built procedural aeroplane its shade and its small parts. Never throws. */
export function deepen(model, type) {
  const ud = model && model.userData;
  if (!ud || ud.depth) return model;
  const id = (type && type.id) || 'unknown';
  if (REAL_MODELS[id] && realModelsOn()) return model;
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  ud.depth = { ao: 0, relief: 0, parts: null, ms: 0, cached: false };
  try {
    model.updateMatrixWorld(true);
    const sv = survey(model);
    const key = `${id}|${sv.meshes.map((m) => `${m.path}:${m.g.attributes.position.count}`).join(',')}`;
    let plan = plans.get(key);
    ud.depth.cached = !!plan;
    if (!plan) {
      const G = buildGrid(sv.meshes);
      if (!G) return model;
      const ao = new Map();
      for (const m of sv.meshes) {
        if (!m.std || m.shared || m.g.attributes.depthAO || !m.g.attributes.normal || m.g.attributes.position.count > 60000) continue;
        ao.set(m.path, occlusion(m, G));
      }
      const dressed = type && typeof type.buildModel === 'function' ? null : dress(model, type, sv, G);
      plan = { ao, dressed };
      if (plans.size >= PLAN_MAX) plans.delete(plans.keys().next().value);
      plans.set(key, plan);
    }
    ud.depth.ao = applyAO(sv, plan);
    ud.depth.relief = reliefOn(model);
    if (plan.dressed) {
      ud.depthParts = hang(model, plan.dressed);
      ud.depth.parts = plan.dressed.count;
    }
    if (typeof ud.onRealSkin === 'function' && ud.depthParts) for (const p of ud.depthParts) ud.onRealSkin(p);
  } catch (e) {
    console.warn(`Plane depth: ${id} keeps its plain look.`, e);
  }
  ud.depth.ms = typeof performance !== 'undefined' ? +(performance.now() - t0).toFixed(1) : 0;
  return model;
}

/** For the tests: forget what was worked out (the next build of each type does it again). */
export function clearDepthCache() {
  plans.clear();
}

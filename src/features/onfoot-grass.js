/**
 * GRASS AT YOUR FEET, on foot (owner, 2026-11-11: "make us have grass so its
 * more cinematic"). From the walker's eye the terrain was a flat green blur.
 *
 * A field of small blade clumps round the walker, only where the ground is
 * plain terrain (not tarmac, road, a pad or water), laid on a world grid with
 * a hash per cell so the grass stays put as you walk through it, thinning out
 * towards the edge of the patch so there is no line where it stops. The tips
 * lean in a slow breeze. One instanced draw; none of it while flying.
 *
 * Per tier (aircraft/model-quality.js rank): Low none; Medium a 16 m patch;
 * High 18 m; Ultra 24 m, denser. LONG GRASS (owner: "add long grass aswell"):
 * in meadow patches some 25 m across the tufts stand 0.6-1.1 m, thicker,
 * blending into the short grass round them; they sway more (taller). Built on first use, the layout redone when
 * the walker has moved a few metres.
 */
import * as THREE from '../vendor/three.module.js';
import { groundAt, groundKind } from './staff/walk.js';
import { qualityRank } from '../aircraft/model-quality.js';

const TIERS = [null, { radius: 12, cell: 0.42 }, { radius: 18, cell: 0.34 }, { radius: 24, cell: 0.3 }];
const MOVE = 3;

let mesh = null;
let mat = null;
let built = null; // tier object the mesh was sized for
const last = { x: Infinity, z: Infinity };
const time = { value: 0 };
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/** A clump: seven thin blades fanned out and curving over, darker at the root (vertex colours, no texture). */
function clumpGeometry() {
  const pos = [];
  const col = [];
  const idx = [];
  const blades = 7;
  for (let b = 0; b < blades; b++) {
    const a = (b / blades) * Math.PI * 2 + 0.37 * b;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const lean = 0.18 + 0.22 * ((b * 37) % 7) / 7; // how far the tip falls over, outwards
    const r0 = 0.04 * ((b * 13) % 5) / 5; // roots spread a little
    const hgt = 0.75 + 0.25 * ((b * 29) % 6) / 6;
    const w = 0.022;
    const base = pos.length / 3;
    // three rings up the blade, then the tip; it narrows and bends outwards
    const rows = [[0, 1], [0.4, 0.8], [0.75, 0.5]];
    for (const [t, wk] of rows) {
      const out = r0 + lean * t * t;
      const x = ca * out;
      const z = sa * out;
      // the blade's width runs across its lean direction
      pos.push(x - sa * w * wk, t * hgt, z + ca * w * wk, x + sa * w * wk, t * hgt, z - ca * w * wk);
      for (let k = 0; k < 2; k++) col.push(0.36 + 0.2 * t, 0.56 + 0.22 * t, 0.2 + 0.1 * t);
    }
    const tipOut = r0 + lean;
    pos.push(ca * tipOut, hgt, sa * tipOut);
    col.push(0.66, 0.84, 0.38);
    for (let r = 0; r < 2; r++) {
      const i0 = base + r * 2;
      idx.push(i0, i0 + 1, i0 + 3, i0, i0 + 3, i0 + 2);
    }
    idx.push(base + 4, base + 5, base + 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // Lit as the ground is (from above), not blade by blade: a field of grass reads as one surface.
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, n.getX(i) * 0.35, 1, n.getZ(i) * 0.35);
  g.normalizeNormals();
  return g;
}

function material() {
  const m = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uGrassT = time;
    sh.vertexShader = `uniform float uGrassT;\n${sh.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
  #ifdef USE_INSTANCING
  vec3 gw = instanceMatrix[3].xyz;
  float sway = sin(uGrassT * 1.6 + gw.x * 0.35 + gw.z * 0.27) * 0.5 + sin(uGrassT * 2.7 + gw.z * 0.6) * 0.25;
  transformed.x += sway * 0.12 * transformed.y * transformed.y;
  transformed.z += sway * 0.05 * transformed.y * transformed.y;
  #endif`,
    );
  };
  m.customProgramCacheKey = () => 'onfoot-grass';
  return m;
}

/** 0..1: how much of a meadow of long grass this spot is (smooth, world-fixed, ~25 m patches). */
export function meadowAt(x, z) {
  const n = Math.sin(x * 0.043 + Math.sin(z * 0.021) * 2.1) * Math.cos(z * 0.039 - Math.sin(x * 0.017) * 1.7)
    + 0.5 * Math.sin((x + z) * 0.071 + 1.3) * Math.cos((x - z) * 0.053);
  return Math.max(0, Math.min(1, (n - 0.35) * 2.2));
}

function hash(ix, iz, k) {
  let h = (ix * 374761393 + iz * 668265263 + k * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function build(scene, tier) {
  const n = Math.ceil((tier.radius * 2) / tier.cell) ** 2;
  if (mesh) {
    mesh.removeFromParent();
    mesh.dispose();
  }
  mat = mat || material();
  mesh = new THREE.InstancedMesh(clumpGeometry(), mat, n);
  mesh.name = 'onfoot grass';
  mesh.frustumCulled = false;
  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
  mesh.count = 0;
  scene.add(mesh);
  built = tier;
}

function layout(cx, cz, tier) {
  const { radius, cell } = tier;
  const r2 = radius * radius;
  let i = 0;
  const x0 = Math.floor((cx - radius) / cell);
  const x1 = Math.ceil((cx + radius) / cell);
  const z0 = Math.floor((cz - radius) / cell);
  const z1 = Math.ceil((cz + radius) / cell);
  const cap = mesh.instanceMatrix.count;
  for (let ix = x0; ix <= x1 && i < cap; ix++) {
    for (let iz = z0; iz <= z1 && i < cap; iz++) {
      const x = (ix + hash(ix, iz, 1)) * cell;
      const z = (iz + hash(ix, iz, 2)) * cell;
      const d2 = (x - cx) * (x - cx) + (z - cz) * (z - cz);
      if (d2 > r2) continue;
      // thinner towards the rim, and in natural patches
      const edge = 1 - d2 / r2;
      const patch = 0.55 + 0.45 * Math.sin(ix * 0.21 + iz * 0.13) * Math.cos(iz * 0.17 - ix * 0.07);
      const meadow = meadowAt(x, z);
      if (hash(ix, iz, 3) > Math.min(1, edge * 2.6) * (0.5 + 0.5 * patch + 0.4 * meadow) + 0.3) continue;
      const y = groundAt(x, z);
      if (!Number.isFinite(y) || groundKind() !== 0 || y < 0.4) continue;
      const short = (0.16 + 0.22 * hash(ix, iz, 4)) * patch;
      const tall = 0.6 + 0.5 * hash(ix, iz, 10);
      const hgt = (short + (tall - short) * meadow) * (0.5 + 0.5 * Math.min(1, edge * 3));
      _p.set(x, y - 0.02, z);
      _q.setFromAxisAngle(_up, hash(ix, iz, 5) * Math.PI * 2);
      // long grass is narrower for its height (it stands up rather than out)
      const spread = hgt * (1.1 + 0.6 * hash(ix, iz, 6)) * (1 - 0.45 * meadow);
      _s.set(spread, hgt, hgt * (1.1 + 0.6 * hash(ix, iz, 7)) * (1 - 0.45 * meadow));
      _m.compose(_p, _q, _s);
      mesh.setMatrixAt(i, _m);
      const v = hash(ix, iz, 8);
      // long grass a touch drier and paler at the top
      _c.setRGB(0.88 + 0.22 * v + 0.04 * meadow, 0.95 + 0.15 * hash(ix, iz, 9), 0.8 + 0.25 * v - 0.04 * meadow);
      mesh.setColorAt(i, _c);
      i++;
    }
  }
  mesh.count = i;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/** Every frame on foot (onfoot.js walkFrame). */
export function updateGrass(sim, walker, dt) {
  const tier = TIERS[Math.min(3, qualityRank())] || null;
  if (!tier || !sim || !sim.scene || (sim.settings && sim.settings.performanceMode)) {
    hideGrass();
    return;
  }
  if (!mesh || built !== tier || mesh.parent !== sim.scene) {
    build(sim.scene, tier);
    last.x = Infinity;
  }
  time.value += dt || 0;
  mesh.visible = true;
  if (Math.hypot(walker.x - last.x, walker.z - last.z) > MOVE) {
    last.x = walker.x;
    last.z = walker.z;
    layout(walker.x, walker.z, tier);
  }
}

/** Off the picture: not on foot any more. */
export function hideGrass() {
  if (mesh) mesh.visible = false;
  last.x = Infinity;
}

/** For the tests: how many clumps are laid, and where the patch is. */
export function grassStats() {
  return { count: mesh ? mesh.count : 0, visible: !!(mesh && mesh.visible), at: { x: last.x, z: last.z } };
}

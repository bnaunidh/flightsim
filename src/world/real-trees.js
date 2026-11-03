/**
 * REAL TREES, close up: the downloaded palm, pine, birch and oak
 * (world/real-scenery.js) drawn in place of the game's own trees nearest the
 * camera — on Medium and up only. Everywhere else, and on Low, the trees stay
 * what they were: scenery.js's own (a few hundred triangles each, one
 * instanced draw per species) and the World Map's tree cards. The World Map's
 * cards were redrawn from these models (tree-cards.js); scenery.js's own trees
 * were not recoloured, so the pine's needles (and the cards' conifer) are
 * tinted to the firs' green (real-scenery.js leafTint, tree-cards.js
 * CONIFER_CARD_TINT): on the boreal maps near and far are one wood.
 *
 * How. Every instanced tree mesh registers itself here with its species
 * (scenery.js addTrees, worldmap/flora.js). A few times a second the trees
 * within the tier's radius of the camera are found, nearest first, up to the
 * tier's count per species; each of those is taken out of its own mesh
 * (its matrix scaled to nothing, the old one kept) and drawn instead by one
 * InstancedMesh per part of the real model (bark, leaves) with the SAME
 * matrix — both kinds are built one unit tall and carry their height in the
 * instance's scale — and the same per-tree tint. A tree that leaves the set
 * gets its own matrix back. A mesh refilled behind our back (the World Map's
 * pool, when a cell arrives) is noticed by its version and simply re-read.
 *
 * Cost, by tier: two draw calls per species shown (bark and leaves, and their
 * shadows on High), plus a few kilobytes of matrices a second while moving.
 * The hitboxes are the game's own trees' and stay as they were.
 */
import * as THREE from '../vendor/three.module.js';
import { loadRealScenery, realSceneryOn, realSceneryTemplate } from './real-scenery.js';
import { qualityRank } from '../aircraft/model-quality.js';

/** The game's species (scenery.js FLORA order) -> the real model drawn for it close up. Scrub and thorn keep their own. */
export const SPECIES_MODEL = { palm: 'tree-palm', broadleaf: 'tree-oak', conifer: 'tree-pine', birch: 'tree-birch' };

/** Per tier: how far out (m) and how many of each species at most. Low: none. */
export const NEAR_TIERS = Object.freeze({
  medium: Object.freeze({ radius: 140, cap: 36, shadows: false }),
  high: Object.freeze({ radius: 220, cap: 80, shadows: true }),
  ultra: Object.freeze({ radius: 340, cap: 160, shadows: true }),
});
const TIER_BY_RANK = [null, 'medium', 'high', 'ultra'];

const ZERO = new Float32Array(16); // scaled to nothing (w = 0 stays out of the picture)
const ORIGIN_SNAP = 1024;

const sources = []; // { mesh, model, hidden: Map(index -> saved Float32Array(16)), version }
const pools = new Map(); // model id -> { parts: [InstancedMesh], cap }
let group = null;
let enabledTier = undefined;
let lastAt = { x: Infinity, y: Infinity, z: Infinity, t: -1 };
let clock = 0;
const stats = { shown: 0, updates: 0, sources: 0, byModel: {} };

/** Register an instanced tree mesh of a species ('palm', 'broadleaf', ...). Ignored for species with no real model. */
export function addTreeSource(mesh, species) {
  const model = SPECIES_MODEL[species];
  if (!mesh || !mesh.isInstancedMesh || !model) return false;
  if (sources.some((s) => s.mesh === mesh)) return true;
  sources.push({ mesh, model, hidden: new Map(), version: -1 });
  if (realSceneryOn()) loadRealScenery(model);
  return true;
}

/** Everything back as it was (tests; a world torn down). */
export function clearTreeSources() {
  for (const s of sources) restoreAll(s);
  sources.length = 0;
  for (const p of pools.values()) for (const m of p.parts) m.count = 0;
}

function sceneOf(o) {
  let n = o;
  while (n && n.parent) n = n.parent;
  return n && n.isScene ? n : null;
}

function restoreAll(s) {
  const arr = s.mesh.instanceMatrix.array;
  if (s.version === s.mesh.instanceMatrix.version) {
    for (const [i, m] of s.hidden) arr.set(m, i * 16);
    if (s.hidden.size) bump(s);
  }
  s.hidden.clear();
}

function bump(s) {
  s.mesh.instanceMatrix.needsUpdate = true;
  s.version = s.mesh.instanceMatrix.version;
}

function poolFor(model, tier, scene) {
  let p = pools.get(model);
  const tpl = realSceneryTemplate(model);
  if (!tpl) return null;
  if (p && p.cap >= tier.cap) return p;
  if (p) for (const m of p.parts) { group.remove(m); m.dispose(); }
  if (!group) {
    group = new THREE.Group();
    group.name = 'real-trees';
  }
  if (scene && group.parent !== scene) scene.add(group);
  const parts = [];
  for (const [name, src] of tpl.parts) {
    const m = new THREE.InstancedMesh(src.geometry, src.material, tier.cap);
    m.name = `real-trees:${model}:${name}`;
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = !!tier.shadows;
    m.receiveShadow = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    group.add(m);
    parts.push(m);
  }
  p = { parts, cap: tier.cap };
  pools.set(model, p);
  return p;
}

const _m = new THREE.Matrix4();
const _w = new THREE.Matrix4();

/**
 * Each frame (scenery.js lod, the World Map preview): cheap unless the camera
 * moved a few metres or a quarter of a second went by.
 */
export function updateRealTrees(cam, dt = 0.016) {
  clock += dt;
  const tierName = realSceneryOn() ? TIER_BY_RANK[Math.min(3, qualityRank())] : null;
  const tier = tierName ? NEAR_TIERS[tierName] : null;
  // Forget meshes that have left the scene (a world rebuilt): nothing to give back to them.
  for (let i = sources.length - 1; i >= 0; i--) {
    if (!sceneOf(sources[i].mesh)) sources.splice(i, 1);
  }
  stats.sources = sources.length;
  if (!tier || !cam) {
    if (enabledTier) {
      for (const s of sources) restoreAll(s);
      for (const p of pools.values()) for (const m of p.parts) m.count = 0;
    }
    enabledTier = null;
    return stats;
  }
  if (enabledTier !== tierName) {
    enabledTier = tierName;
    lastAt.t = -1;
  }
  // A refilled source (the World Map pool): its whole array was rewritten, so nothing of it is hidden now.
  let refilled = false;
  for (const s of sources) {
    if (s.version !== s.mesh.instanceMatrix.version) {
      s.hidden.clear();
      s.version = s.mesh.instanceMatrix.version;
      refilled = true;
    }
  }
  const camY = Number.isFinite(cam.y) ? cam.y : 0;
  const moved = Math.hypot(cam.x - lastAt.x, camY - lastAt.y, cam.z - lastAt.z);
  if (!refilled && moved < 6 && clock - lastAt.t < 0.25) return stats;
  lastAt = { x: cam.x, y: camY, z: cam.z, t: clock };
  stats.updates++;
  const R2 = tier.radius * tier.radius;
  const ox = Math.round(cam.x / ORIGIN_SNAP) * ORIGIN_SNAP;
  const oz = Math.round(cam.z / ORIGIN_SNAP) * ORIGIN_SNAP;
  if (group) group.position.set(ox, 0, oz);
  // Candidates per model: [d2, source, index].
  const byModel = new Map();
  let waiting = false;
  for (const s of sources) {
    if (!realSceneryTemplate(s.model)) {
      loadRealScenery(s.model);
      waiting = true;
      continue;
    }
    const mesh = s.mesh;
    if (!mesh.visible) continue;
    mesh.updateWorldMatrix(true, false);
    const e = mesh.matrixWorld.elements;
    const arr = mesh.instanceMatrix.array;
    const n = mesh.count;
    let list = byModel.get(s.model);
    if (!list) byModel.set(s.model, (list = []));
    for (let i = 0; i < n; i++) {
      const saved = s.hidden.get(i);
      const src = saved || arr.subarray(i * 16, i * 16 + 16);
      if (src[15] === 0) continue;
      // world x/y/z of the instance (the meshes carry a translation at most)
      const x = src[12] * e[0] + src[14] * e[8] + e[12];
      const y = src[13] * e[5] + e[13];
      const z = src[12] * e[2] + src[14] * e[10] + e[14];
      const dx = x - cam.x;
      const dz = z - cam.z;
      // The distance to the camera, height and all (checker, 2026-11-01): by ground distance alone,
      // from 300 m up the real oaks 300+ m away were drawn, their leaf cut-outs thinned by the
      // mipmaps to dark specks among the game's green trees. From that high the game's own are drawn.
      const dy = y - camY;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < R2) list.push([d2, s, i]);
    }
  }
  stats.shown = 0;
  const scene = sources.length ? sceneOf(sources[0].mesh) : null;
  const want = new Map(sources.map((s) => [s, new Set()]));
  for (const [model, list] of byModel) {
    list.sort((a, b) => a[0] - b[0]);
    const pick = list.slice(0, tier.cap);
    const pool = poolFor(model, tier, scene);
    if (!pool) continue;
    let k = 0;
    for (const [, s, i] of pick) {
      want.get(s).add(i);
      const arr = s.mesh.instanceMatrix.array;
      const own = s.hidden.get(i) || arr.slice(i * 16, i * 16 + 16);
      // world matrix of the tree, relative to the pool's origin
      _m.fromArray(own);
      _w.multiplyMatrices(s.mesh.matrixWorld, _m);
      _w.elements[12] -= ox;
      _w.elements[14] -= oz;
      for (const part of pool.parts) {
        _w.toArray(part.instanceMatrix.array, k * 16);
        if (part.instanceColor && s.mesh.instanceColor) part.instanceColor.array.set(s.mesh.instanceColor.array.subarray(i * 3, i * 3 + 3), k * 3);
      }
      k++;
    }
    for (const part of pool.parts) {
      part.count = k;
      part.visible = k > 0;
      part.castShadow = !!tier.shadows;
      part.instanceMatrix.needsUpdate = true;
      if (part.instanceColor) part.instanceColor.needsUpdate = true;
    }
    stats.byModel[model] = k;
    stats.shown += k;
  }
  // Hide the chosen ones in their own meshes; give the rest back.
  for (const s of sources) {
    const w = want.get(s);
    const arr = s.mesh.instanceMatrix.array;
    let changed = false;
    for (const [i, saved] of s.hidden) {
      if (w.has(i)) continue;
      arr.set(saved, i * 16);
      s.hidden.delete(i);
      changed = true;
    }
    for (const i of w) {
      if (s.hidden.has(i)) continue;
      s.hidden.set(i, arr.slice(i * 16, i * 16 + 16));
      arr.set(ZERO, i * 16);
      changed = true;
    }
    if (changed) bump(s);
  }
  // A model still on its way: look again next frame, not only once the camera has moved on.
  if (waiting) lastAt.t = -1;
  // Pools of models nothing asked for this time: empty.
  for (const [model, p] of pools) {
    if (byModel.has(model)) continue;
    for (const m of p.parts) m.count = 0;
    stats.byModel[model] = 0;
  }
  return stats;
}

export const realTreeStats = () => ({ ...stats, tier: enabledTier, byModel: { ...stats.byModel } });
/** Tests: the real trees' group (or null). */
export const realTreeGroup = () => group;

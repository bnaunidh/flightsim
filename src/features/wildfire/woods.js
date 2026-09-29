/**
 * A wood for a forest fire to burn.
 *
 * The maps plant their trees sparsely — Harrier Flats has one tree to every
 * forty-odd fire cells across its whole upland — which is right for a view
 * from a mile up and wrong for a forest fire: the fire was burning across
 * what was plainly open fields, with forest-sized flames standing on bare
 * grass. So a mission that is about a forest names where the forest is
 * (`spec.woods`, discs of ground) and this plants it: a tree or two on every
 * burnable cell inside, and nothing on rock, sand, road or the town, because
 * it asks the fire's own classifier.
 *
 * The same `woods` go to the classifier (ground.js), so the cells with these
 * trees on them burn as forest — longer, taller, throwing embers — in the
 * game and in the node tests alike. Only the pictures are made here.
 *
 * Two instanced meshes, conifer and broadleaf, one draw call each; the
 * trunk and crown colours are baked into the vertices and the fire chars
 * them through the per-instance colour, the same way it chars the map's own.
 * No obstacles are registered: a tree here is scenery for the fire, and a
 * scooper skimming the treetops on its way in should not be killed by a
 * tree that only exists during this mission.
 */

import * as THREE from '../../vendor/three.module.js';
import { FUEL } from './grid.js';

const BARK = [0.32, 0.22, 0.14];

function merge(parts) {
  const pos = [];
  const norm = [];
  const col = [];
  for (const { geo, color } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i++) pos.push(p[i]);
    for (let i = 0; i < n.length; i++) norm.push(n[i]);
    for (let i = 0; i < g.attributes.position.count; i++) col.push(color[0], color[1], color[2]);
    geo.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** One metre tall; scaled per instance. About forty triangles. */
function conifer() {
  return merge([
    { geo: new THREE.CylinderGeometry(0.025, 0.045, 0.5, 5, 1, true).translate(0, 0.25, 0), color: BARK },
    { geo: new THREE.ConeGeometry(0.3, 0.46, 7, 1, true).translate(0, 0.4, 0), color: [0.07, 0.19, 0.07] },
    { geo: new THREE.ConeGeometry(0.23, 0.42, 7, 1, true).translate(0, 0.64, 0), color: [0.09, 0.23, 0.08] },
    { geo: new THREE.ConeGeometry(0.15, 0.34, 7, 1, true).translate(0, 0.86, 0), color: [0.07, 0.19, 0.07] },
  ]);
}

function broadleaf() {
  const a = new THREE.IcosahedronGeometry(0.3, 0);
  a.scale(1, 0.85, 1);
  a.translate(0, 0.62, 0);
  const b = new THREE.IcosahedronGeometry(0.22, 0);
  b.translate(0.14, 0.78, -0.06);
  return merge([
    { geo: new THREE.CylinderGeometry(0.035, 0.06, 0.5, 5, 1, true).translate(0, 0.25, 0), color: BARK },
    { geo: a, color: [0.12, 0.26, 0.07] },
    { geo: b, color: [0.16, 0.31, 0.09] },
  ]);
}

let GEOS = null;

function hash(i, k) {
  let h = Math.imul(i ^ (k * 0x27d4eb2d), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * Plant the woods of `spec.woods` on `grid`, at most `max` trees.
 *
 * @param grid     the FireGrid, window already set and sampler in place
 * @param woods    [{x, z, r}]
 * @param surfaceY (x, z) -> the drawn ground height
 * @param max      how many trees this quality setting can afford
 * @returns {{ meshes: THREE.InstancedMesh[], cells: Map<number, Array> } | null}
 *   `cells` maps a fire cell to [mesh, index, mesh, index, ...] for charring.
 */
export function plantWoods(grid, woods, surfaceY, max = 2400, shadows = false) {
  if (!woods || !woods.length) return null;
  if (!GEOS) GEOS = [conifer(), broadleaf()];
  // Which cells, and how many trees on each: one, and a second on some.
  const spots = [];
  const c = grid.cell;
  for (const w of woods) {
    const r2 = w.r * w.r;
    for (let z = w.z - w.r; z <= w.z + w.r; z += c) {
      for (let x = w.x - w.r; x <= w.x + w.r; x += c) {
        if ((x - w.x) * (x - w.x) + (z - w.z) * (z - w.z) > r2) continue;
        const i = grid.indexAt(x, z);
        if (i < 0 || grid.fuelOf(i) !== FUEL.FOREST) continue;
        spots.push(i);
      }
    }
  }
  if (!spots.length) return null;
  // Deduplicate overlapping discs.
  const uniq = [...new Set(spots)];
  const perCell = Math.max(0.3, Math.min(1.6, max / uniq.length));
  const trees = [];
  for (const i of uniq) {
    const n = Math.floor(perCell) + (hash(i, 1) < perCell % 1 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = grid.cellX(i) + (hash(i, 2 + k) - 0.5) * c * 0.9;
      const z = grid.cellZ(i) + (hash(i, 5 + k) - 0.5) * c * 0.9;
      trees.push({ i, x, z, kind: hash(i, 9 + k) < 0.62 ? 0 : 1, s: 9 + hash(i, 13 + k) * 7, rot: hash(i, 17 + k) * 6.283 });
    }
  }
  const byKind = [trees.filter((t) => t.kind === 0), trees.filter((t) => t.kind === 1)];
  const cells = new Map();
  const meshes = [];
  const d = new THREE.Object3D();
  const white = new THREE.Color(1, 1, 1);
  byKind.forEach((list, kind) => {
    if (!list.length) return;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const mesh = new THREE.InstancedMesh(GEOS[kind], mat, list.length);
    mesh.name = 'wildfire-woods';
    mesh.castShadow = shadows;
    mesh.receiveShadow = false;
    list.forEach((t, k) => {
      d.position.set(t.x, surfaceY(t.x, t.z) - 0.3, t.z);
      d.rotation.set(0, t.rot, 0);
      const h = kind === 0 ? t.s * 1.15 : t.s * 0.95;
      d.scale.set(h, h, h);
      d.updateMatrix();
      mesh.setMatrixAt(k, d.matrix);
      mesh.setColorAt(k, white);
      let entry = cells.get(t.i);
      if (!entry) cells.set(t.i, (entry = []));
      entry.push(mesh, k);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    // The bounding sphere of an instanced mesh is only computed once; do it
    // after the matrices are in, or the whole wood is culled as a point.
    mesh.computeBoundingSphere();
    meshes.push(mesh);
  });
  return { meshes, cells, count: trees.length };
}

/** Take the wood out of the scene. The shared geometry stays for the next one. */
export function removeWoods(w, group) {
  if (!w) return;
  for (const m of w.meshes) {
    if (group) group.remove(m);
    m.material.dispose();
    m.dispose();
  }
}

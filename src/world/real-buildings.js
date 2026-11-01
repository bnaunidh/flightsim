/**
 * REAL BUILDINGS: a downloaded building (world/real-scenery.js) put where the
 * game's own one stands, once its file has arrived -- the airport's fire
 * station, the air base's guard posts, watchtower and garage, the village
 * houses, the harbour's sailboats, the farm windmills.
 *
 * Fetched only at Medium and up, after the menu (the callers import this
 * module themselves when it is wanted: never in the first load's graph, and
 * Low never asks). The game's own building is built as always; when the real
 * one arrives it is hidden (`hide`) and the real one stands in its footprint.
 * Obstacles, lights and anything that moves stay the game's: a real model
 * here is only ever a picture over the same box.
 */
import * as THREE from '../vendor/three.module.js';
import { loadRealScenery } from './real-scenery.js';

/**
 * Put one real model in `parent`. Placement in world (or parent) units:
 *   at [x, y, z], rotY (radians), and one of scale / height / width / length / fit [w, d]
 *   (the file's own size along that axis is read off its bounds).
 * `hide`: the game's own objects it stands for, hidden when it arrives.
 * Resolves to the placed group, or null (no file: the game's own stays).
 */
export async function placeReal(parent, id, opts = {}) {
  const tpl = await loadRealScenery(id);
  if (!tpl || (opts.alive && !opts.alive())) return null;
  const g = tpl.root.clone();
  g.name = `real:${id}`;
  g.userData = { realScenery: id };
  const size = tpl.extras && tpl.extras.size ? tpl.extras.size : sizeOf(tpl.root);
  let s = opts.scale ?? 1;
  if (opts.height) s = opts.height / size[1];
  else if (opts.width) s = opts.width / size[0];
  else if (opts.length) s = opts.length / size[2];
  else if (opts.fit) s = Math.min(opts.fit[0] / size[0], opts.fit[1] / size[2]); // inside a footprint [w, d]
  g.scale.setScalar(s);
  const at = opts.at || [0, 0, 0];
  g.position.set(at[0], at[1], at[2]);
  g.rotation.y = opts.rotY || 0;
  g.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = opts.shadows !== false;
    o.receiveShadow = true;
  });
  parent.add(g);
  for (const h of opts.hide || []) if (h) h.visible = false;
  return g;
}

/**
 * Many copies of one model as instanced meshes (one per part): the houses,
 * boats and windmills. `spots`: [{ x, y, z, rotY, scale }]. Resolves to the
 * group, or null.
 */
export async function placeRealMany(parent, id, spots, opts = {}) {
  const tpl = await loadRealScenery(id);
  if (!tpl || !spots.length || (opts.alive && !opts.alive())) return null;
  const g = new THREE.Group();
  g.name = `real:${id}:many`;
  const d = new THREE.Object3D();
  for (const [name, src] of tpl.parts) {
    const m = new THREE.InstancedMesh(src.geometry, src.material, spots.length);
    m.name = `real:${id}:${name}`;
    m.castShadow = opts.shadows !== false;
    m.receiveShadow = true;
    spots.forEach((p, i) => {
      d.position.set(p.x, p.y, p.z);
      d.rotation.set(0, p.rotY || 0, 0);
      d.scale.setScalar(p.scale || 1);
      d.updateMatrix();
      m.setMatrixAt(i, d.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
    g.add(m);
  }
  parent.add(g);
  return g;
}

function sizeOf(root) {
  const b = new THREE.Box3().setFromObject(root);
  return [b.max.x - b.min.x, b.max.y - b.min.y, b.max.z - b.min.z];
}

/** The file's own size (metres, before scaling), once loaded; null otherwise. */
export async function realSize(id) {
  const tpl = await loadRealScenery(id);
  if (!tpl) return null;
  return tpl.extras && tpl.extras.size ? tpl.extras.size : sizeOf(tpl.root);
}

/**
 * Farm wind pumps (the 'windmill' model): the tower and vane instanced, the wheel instanced too and
 * turned about its own hub and axis (the file's extras.pivots.wheel) by `update(dt)`. `spots`:
 * [{ x, y, z, rotY }]. Resolves to { group, update } or null.
 */
export async function placeWindmills(parent, spots, opts = {}) {
  const tpl = await loadRealScenery('windmill');
  if (!tpl || !spots.length || (opts.alive && !opts.alive())) return null;
  const pv = tpl.extras && tpl.extras.pivots && tpl.extras.pivots.wheel;
  const g = new THREE.Group();
  g.name = 'real:windmills';
  const d = new THREE.Object3D();
  const meshes = {};
  for (const [name, src] of tpl.parts) {
    const m = new THREE.InstancedMesh(src.geometry, src.material, spots.length);
    m.name = `real:windmill:${name}`;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    meshes[name] = m;
    g.add(m);
  }
  const base = spots.map((p) => {
    d.position.set(p.x, p.y, p.z);
    d.rotation.set(0, p.rotY || 0, 0);
    d.scale.setScalar(1);
    d.updateMatrix();
    return d.matrix.clone();
  });
  if (meshes.body) {
    base.forEach((m, i) => meshes.body.setMatrixAt(i, m));
    meshes.body.instanceMatrix.needsUpdate = true;
  }
  const hub = new THREE.Vector3().fromArray(pv ? pv.hub : [0, 0, 0]);
  const axis = new THREE.Vector3().fromArray(pv ? pv.axis : [0, 0, 1]).normalize();
  const toHub = new THREE.Matrix4().makeTranslation(hub.x, hub.y, hub.z);
  const fromHub = new THREE.Matrix4().makeTranslation(-hub.x, -hub.y, -hub.z);
  const turn = new THREE.Matrix4();
  const m4 = new THREE.Matrix4();
  let angle = 0;
  const wheel = meshes.wheel;
  const update = (dt = 0, wind = 1) => {
    if (!wheel) return;
    // A wind pump turns slowly and steadily: about one turn every two seconds in a breeze.
    angle += dt * (1.6 + 1.6 * Math.min(1, wind));
    spots.forEach((p, i) => {
      turn.makeRotationAxis(axis, angle + i * 0.7);
      m4.copy(base[i]).multiply(toHub).multiply(turn).multiply(fromHub);
      wheel.setMatrixAt(i, m4);
    });
    wheel.instanceMatrix.needsUpdate = true;
  };
  update(0);
  parent.add(g);
  return { group: g, update };
}

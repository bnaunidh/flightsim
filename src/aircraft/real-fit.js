/**
 * REAL MODELS' FLAPS, SLATS AND SPOILERS: which of the procedural model's lie
 * on the real wing (aircraft/real-models.js dress). Only those are drawn over
 * a real skin; the rest stay under it and the real wing keeps its own shape
 * (v81.2: the 747's flaps hung off the real wing's trailing edge as a pale
 * slab whenever they were out -- "the wing line glitched").
 *
 * Loaded with a real model's file (loadRealModel), never at start.
 */
import * as THREE from '../vendor/three.module.js';

/** How far (m) a retracted device may sit off the real model's surface, and the share of its points that must. */
export const FIT_TOL = 0.2;
export const FIT_SHARE = 0.9;

/**
 * The real model's surface seen from above, once per type: a grid in the model's (x, z), each cell
 * the lowest and highest y of the skin over it (every triangle rasterised at the cell centres it
 * covers, and at its corners and edge midpoints, so thin ones count too).
 */
export function planOf(tpl) {
  if (tpl.plan) return tpl.plan;
  const root = tpl.root;
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const span = Math.max(box.max.x - box.min.x, box.max.z - box.min.z, 1);
  const cell = Math.max(0.12, span / 400);
  const nx = Math.ceil((box.max.x - box.min.x) / cell) + 1;
  const nz = Math.ceil((box.max.z - box.min.z) / cell) + 1;
  const lo = new Float32Array(nx * nz).fill(Infinity);
  const hi = new Float32Array(nx * nz).fill(-Infinity);
  const put = (x, z, y) => {
    const i = Math.floor((x - box.min.x) / cell);
    const k = Math.floor((z - box.min.z) / cell);
    if (i < 0 || k < 0 || i >= nx || k >= nz) return;
    const c = k * nx + i;
    if (y < lo[c]) lo[c] = y;
    if (y > hi[c]) hi[c] = y;
  };
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pos = o.geometry.attributes.position;
    const idx = o.geometry.index;
    const n = idx ? idx.count : pos.count;
    const mw = o.matrixWorld;
    for (let t = 0; t + 2 < n; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(mw);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(mw);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(mw);
      put(a.x, a.z, a.y);
      put(b.x, b.z, b.y);
      put(c.x, c.z, c.y);
      put((a.x + b.x) / 2, (a.z + b.z) / 2, (a.y + b.y) / 2);
      put((b.x + c.x) / 2, (b.z + c.z) / 2, (b.y + c.y) / 2);
      put((a.x + c.x) / 2, (a.z + c.z) / 2, (a.y + c.y) / 2);
      const x0 = Math.min(a.x, b.x, c.x);
      const x1 = Math.max(a.x, b.x, c.x);
      const z0 = Math.min(a.z, b.z, c.z);
      const z1 = Math.max(a.z, b.z, c.z);
      if (x1 - x0 < cell && z1 - z0 < cell) continue;
      const d = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
      if (Math.abs(d) < 1e-9) continue;
      for (let i = Math.floor((x0 - box.min.x) / cell); i * cell + box.min.x <= x1; i++) {
        const x = box.min.x + (i + 0.5) * cell;
        for (let k = Math.floor((z0 - box.min.z) / cell); k * cell + box.min.z <= z1; k++) {
          const z = box.min.z + (k + 0.5) * cell;
          const u = ((b.z - c.z) * (x - c.x) + (c.x - b.x) * (z - c.z)) / d;
          const v = ((c.z - a.z) * (x - c.x) + (a.x - c.x) * (z - c.z)) / d;
          const w = 1 - u - v;
          if (u < -1e-6 || v < -1e-6 || w < -1e-6) continue;
          put(x, z, u * a.y + v * b.y + w * c.y);
        }
      }
    }
  });
  tpl.plan = { box, cell, nx, nz, lo, hi };
  return tpl.plan;
}

/** The share of a mesh's points (model frame, as posed now) that lie on the real skin within FIT_TOL. */
export function onRealSurface(plan, mesh, toModel, maxPoints = 600) {
  const pos = mesh.geometry && mesh.geometry.attributes.position;
  if (!pos || !pos.count) return 1;
  const v = new THREE.Vector3();
  const step = Math.max(1, Math.floor(pos.count / maxPoints));
  let on = 0;
  let all = 0;
  for (let p = 0; p < pos.count; p += step) {
    v.fromBufferAttribute(pos, p).applyMatrix4(toModel);
    all++;
    const i = Math.floor((v.x - plan.box.min.x) / plan.cell);
    const k = Math.floor((v.z - plan.box.min.z) / plan.cell);
    let hit = false;
    for (let dk = -1; dk <= 1 && !hit; dk++) {
      for (let di = -1; di <= 1 && !hit; di++) {
        const ii = i + di;
        const kk = k + dk;
        if (ii < 0 || kk < 0 || ii >= plan.nx || kk >= plan.nz) continue;
        const c = kk * plan.nx + ii;
        if (v.y >= plan.lo[c] - FIT_TOL && v.y <= plan.hi[c] + FIT_TOL) hit = true;
      }
    }
    if (hit) on++;
  }
  return all ? on / all : 1;
}

/**
 * Which of the procedural flaps, slats and spoilers lie on the real wing (mesh -> bool): measured
 * retracted AND fully out (fleet/aircraft-realism.js: its rests and travels, the pack's 0.6 rad of
 * flap). A real model's wing is whole -- its flaps are not cut out of it -- so a procedural flap
 * run out aft and down below it is a second trailing edge hanging off the first: it fails here,
 * stays under the skin, and the real wing keeps its own shape. Once per type.
 */
export function deviceFit(model, airframe, tpl, meshes) {
  const out = new Map();
  if (!meshes.length) return out;
  const cache = tpl.deviceFit || (tpl.deviceFit = new Map());
  const keyOf = (o) => {
    let k = '';
    for (let n = o; n && n !== airframe; n = n.parent) k = `${n.name}#${n.parent ? n.parent.children.indexOf(n) : 0}/${k}`;
    return k;
  };
  const todo = meshes.filter((o) => {
    const k = keyOf(o);
    if (cache.has(k)) out.set(o, cache.get(k));
    return !cache.has(k);
  });
  if (!todo.length) return out;
  const re = model.userData.realism || airframe.userData.realism || {};
  const saved = [];
  for (const d of [...(re.fowler || []), ...(re.slats || []), ...(re.spoilers || [])]) saved.push([d.node, d.node.position.clone(), d.node.quaternion.clone()]);
  const X = new THREE.Vector3(1, 0, 0);
  const q = new THREE.Quaternion();
  const pose = (k) => {
    for (const f of re.fowler || []) {
      f.node.position.set(f.rest.x, f.rest.y - f.down * k, f.rest.z + f.aft * k);
      f.node.rotation.x = 0.6 * k;
    }
    for (const sl of re.slats || []) {
      sl.node.position.copy(sl.rest).addScaledVector(sl.fwd, sl.travel * k);
      sl.node.quaternion.copy(sl.restQ).multiply(q.setFromAxisAngle(X, -sl.side * sl.droop * k));
    }
    for (const sp of re.spoilers || []) sp.node.quaternion.copy(sp.restQ).multiply(q.setFromAxisAngle(X, -sp.side * 0.85 * k));
    model.updateMatrixWorld(true);
  };
  try {
    const plan = planOf(tpl);
    const inv = new THREE.Matrix4();
    const m = new THREE.Matrix4();
    const share = new Map(todo.map((o) => [o, 1]));
    for (const k of [0, 1]) {
      pose(k);
      inv.copy(model.matrixWorld).invert();
      for (const o of todo) share.set(o, Math.min(share.get(o), onRealSurface(plan, o, m.multiplyMatrices(inv, o.matrixWorld))));
    }
    for (const o of todo) {
      const ok = share.get(o) >= FIT_SHARE;
      out.set(o, ok);
      cache.set(keyOf(o), ok);
    }
  } catch (e) {
    for (const o of todo) out.set(o, false);
  } finally {
    for (const [n, p, qq] of saved) {
      n.position.copy(p);
      n.quaternion.copy(qq);
    }
    model.updateMatrixWorld(true);
  }
  return out;
}

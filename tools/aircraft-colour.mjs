/**
 * An aeroplane's geometry WITH its paint, for rendering it somewhere a person
 * can look at it.
 *
 * tools/silhouette.mjs gives you triangles, which is enough to judge a
 * planform. It is not enough to judge "does this look like an airliner",
 * because an outline cannot show you a window line, a glazed cockpit or where
 * the livery stripe runs. This groups the same triangles by material colour,
 * so tools/blender_aircraft.py can light them properly.
 *
 * It goes through createAircraftModel in src/aircraft/model-adapter.js — the
 * call main.js makes — because five of the aeroplanes are drawn by model.js
 * and the rest by src/fleet, and measuring the wrong one has cost this project
 * days before.
 *
 *   node tools/aircraft-colour.mjs <id> <out.json> [treeRoot]
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
};

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const [id, out, root] = process.argv.slice(2);
if (!id || !out) {
  console.error('usage: node tools/aircraft-colour.mjs <id> <out.json> [treeRoot]');
  process.exit(2);
}
const HERE = pathToFileURL(resolve(root || new URL('..', import.meta.url).pathname, 'src') + '/').href;
const THREE = await import(HERE + 'vendor/three.module.js');
const { getAircraft } = await import(HERE + 'aircraft/types.js');
const { createAircraftModel } = await import(HERE + 'aircraft/model-adapter.js');

const built = createAircraftModel({ type: getAircraft(id) });
const rootObj = built.group || built.object || built.root || built;
rootObj.updateMatrixWorld(true);

const groups = new Map();
const v = new THREE.Vector3();
rootObj.traverse((o) => {
  if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
  for (let p = o; p; p = p.parent) if (!p.visible) return;
  const mat = Array.isArray(o.material) ? o.material[0] : o.material;
  if (!mat) return;
  const op = mat.opacity === undefined ? 1 : mat.opacity;
  if (mat.transparent && op <= 0.02) return;
  const c = mat.color || { r: 0.7, g: 0.7, b: 0.7 };
  const key = [c.r, c.g, c.b].map((n) => n.toFixed(3)).join(',') + `|${mat.transparent ? op.toFixed(2) : 1}|${mat.name || ''}`;
  let g = groups.get(key);
  if (!g) {
    g = {
      color: [c.r, c.g, c.b],
      opacity: mat.transparent ? op : 1,
      metalness: mat.metalness || 0,
      roughness: mat.roughness === undefined ? 0.8 : mat.roughness,
      name: mat.name || '',
      tris: [],
    };
    groups.set(key, g);
  }
  const geo = o.geometry;
  const pos = geo.attributes.position;
  const idx = geo.index ? geo.index.array : null;
  const n = idx ? idx.length : pos.count;
  const M = new THREE.Matrix4();
  const inst = new THREE.Matrix4();
  const copies = o.isInstancedMesh ? o.count : 1;
  for (let k = 0; k < copies; k++) {
    if (o.isInstancedMesh) { o.getMatrixAt(k, inst); M.multiplyMatrices(o.matrixWorld, inst); } else M.copy(o.matrixWorld);
    const take = (j) => { v.fromBufferAttribute(pos, j).applyMatrix4(M); return [+v.x.toFixed(4), +v.y.toFixed(4), +v.z.toFixed(4)]; };
    for (let i = 0; i + 2 < n; i += 3) {
      const a = idx ? idx[i] : i;
      const b = idx ? idx[i + 1] : i + 1;
      const c2 = idx ? idx[i + 2] : i + 2;
      g.tris.push([take(a), take(b), take(c2)]);
    }
  }
});
const result = { id, groups: [...groups.values()] };
writeFileSync(out, JSON.stringify(result));
console.log(`${id}: ${result.groups.length} material groups, ${result.groups.reduce((s, g) => s + g.tris.length, 0)} triangles -> ${out}`);

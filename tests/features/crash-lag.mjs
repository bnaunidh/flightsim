/**
 * Node checks for the crash LAG (the owner on a school iPad, November 2026:
 * "ran well apart from a lag spike when the plane crashes"). Run with plain node:
 *
 *   node tests/features/crash-lag.mjs
 *
 * The crash frame's hot loops were rewritten to walk the arrays. They must
 * still give the answers they gave, to the last bit where it can be held:
 *
 *   1. indexedNormals against three's computeVertexNormals, on the Float32
 *      normals of the drawn models and the Int8 normals of the real ones.
 *   2. geometryPoints against the Vector3-and-string version it replaced.
 *   3. supportPoints against the version it replaced.
 *
 * What only the running game shows is tests/features/crash-lag.browser.js.
 */
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);
const THREE = await imp('vendor/three.module.js');
const BM = await imp('game/breakup-mesh.js');
const C = await imp('fleet/common.js');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}

let seed = 12345;
const rnd = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;

/* ---- 1. the normals --------------------------------------------------------- */
function mesh(verts, tris, Normals, normalized) {
  const g = new THREE.BufferGeometry();
  const p = new Float32Array(verts * 3);
  for (let i = 0; i < p.length; i++) p[i] = (rnd() - 0.5) * 8;
  g.setAttribute('position', new THREE.BufferAttribute(p, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(new Normals(verts * 3), 3, normalized));
  const idx = new Uint32Array(tris * 3);
  for (let i = 0; i < idx.length; i++) idx[i] = Math.floor(rnd() * verts);
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
for (const [label, Normals, normalized] of [['Float32', Float32Array, false], ['normalized Int8', Int8Array, true]]) {
  const g = mesh(400, 900, Normals, normalized);
  g.computeVertexNormals();
  const want = g.attributes.normal.array.slice();
  const out = new Normals(want.length).fill(5);
  BM.indexedNormals(g.attributes.position.array, out, g.index.array, g.index.count);
  let diff = 0;
  for (let i = 0; i < want.length; i++) if (want[i] !== out[i]) diff++;
  ok(`crash-lag: indexedNormals is three's computeVertexNormals on ${label} normals, to the bit`, diff === 0, `${diff} of ${want.length} differ`);
}

/* ---- 2. the points ---------------------------------------------------------- */
function oldPoints(model, nodes, relative = new THREE.Matrix4(), opaque = false) {
  model.updateWorldMatrix(true, true);
  const visible = (node) => {
    for (let n = node; n && n !== model; n = n.parent) if (!n.visible) return false;
    return true;
  };
  const points = [];
  const seen = new Set();
  const instance = new THREE.Matrix4();
  const transform = new THREE.Matrix4();
  const visited = new Set();
  for (const r of nodes)
    r.traverse((node) => {
      if (visited.has(node) || !node.isMesh || !visible(node)) return;
      visited.add(node);
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      if (opaque && materials.every((m) => m.transparent)) return;
      const attr = node.geometry.attributes.position;
      for (let k = 0; k < (node.isInstancedMesh ? node.count : 1); k++) {
        transform.multiplyMatrices(relative, node.matrixWorld);
        if (node.isInstancedMesh) {
          node.getMatrixAt(k, instance);
          transform.multiply(instance);
        }
        for (let i = 0; i < attr.count; i++) {
          const p = new THREE.Vector3().fromBufferAttribute(attr, i).applyMatrix4(transform);
          const key = `${p.x.toFixed(4)},${p.y.toFixed(4)},${p.z.toFixed(4)}`;
          if (!seen.has(key)) {
            seen.add(key);
            points.push(p);
          }
        }
      }
    });
  return points;
}
{
  const model = new THREE.Group();
  model.position.set(120.5, 33.25, -80.125);
  model.rotation.set(0.2, 1.1, -0.3);
  const mat = new THREE.MeshBasicMaterial();
  const box = new THREE.Mesh(new THREE.BoxGeometry(4, 2, 9, 6, 6, 6), mat); // shares its corners between faces
  const ball = new THREE.Mesh(new THREE.SphereGeometry(2, 24, 16), mat);
  ball.position.set(3, 1, 2);
  const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), mat, 12);
  for (let i = 0; i < 12; i++) inst.setMatrixAt(i, new THREE.Matrix4().makeTranslation(i * 0.7, 2, 1));
  const hidden = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
  hidden.visible = false;
  const clear = new THREE.Mesh(new THREE.BoxGeometry(9, 9, 1), new THREE.MeshBasicMaterial({ transparent: true }));
  model.add(box, ball, inst, hidden, clear);
  const same = (a, b) => a.length === b.length && a.every((p, i) => p.x === b[i].x && p.y === b[i].y && p.z === b[i].z);
  const world = C.geometryPoints(model, [model]);
  ok('crash-lag: geometryPoints gives the old points, in the old order, in the world', same(world, oldPoints(model, [model])) && world.length > 100, `${world.length} points`);
  const inv = model.matrixWorld.clone().invert();
  const local = C.geometryPoints(model, [model], inv, true);
  ok('crash-lag: and opaque only, in the model\'s own frame', same(local, oldPoints(model, [model], inv, true)), `${local.length} points`);
}

/* ---- 3. the support points -------------------------------------------------- */
function oldSupport(points, cells = 9) {
  const MAX = 320;
  if (points.length <= MAX) return points;
  const dirs = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < 98; i++) {
    const y = 1 - ((i + 0.5) * 2) / 98;
    const r = Math.sqrt(1 - y * y);
    dirs.push(new THREE.Vector3(Math.cos(i * g) * r, y, Math.sin(i * g) * r));
  }
  const keep = new Set();
  for (const d of dirs) {
    let best = -1;
    let bd = -Infinity;
    for (let i = 0; i < points.length; i++) {
      const v = points[i].dot(d);
      if (v > bd) {
        bd = v;
        best = i;
      }
    }
    if (best >= 0) keep.add(best);
  }
  const box = new THREE.Box3().setFromPoints(points);
  const size = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const cell = Math.max(size.x, size.y, size.z) / cells || 1;
  const grid = new Map();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const k = `${Math.floor((p.x - box.min.x) / cell)},${Math.floor((p.y - box.min.y) / cell)},${Math.floor((p.z - box.min.z) / cell)}`;
    const far = (p.x - c.x) ** 2 / (size.x * size.x + 1e-6) + (p.y - c.y) ** 2 / (size.y * size.y + 1e-6) + (p.z - c.z) ** 2 / (size.z * size.z + 1e-6);
    const q = grid.get(k);
    if (!q || far > q.far) grid.set(k, { i, far });
  }
  for (const q of grid.values()) keep.add(q.i);
  return [...keep].sort((a, b) => a - b).slice(0, MAX * 2).map((i) => points[i]);
}
{
  const pts = [];
  for (let i = 0; i < 6000; i++) pts.push(new THREE.Vector3((rnd() - 0.5) * 70, (rnd() - 0.5) * 12, (rnd() - 0.5) * 60));
  const a = C.supportPoints(pts);
  const b = oldSupport(pts);
  ok('crash-lag: supportPoints keeps the points it kept', a.length === b.length && a.every((p, i) => p === b[i]) && a.length > 50, `${a.length} of ${pts.length}`);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

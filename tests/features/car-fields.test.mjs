/**
 * The crop patch under the van, in node, no browser:
 *
 *   node tests/features/car-fields.test.mjs
 *
 * roads.js fieldPatchSampler says which crop patch is drawn at a point, for
 * the word under the van's speed ("field" on the pale stubble round First
 * Run's yard on Drover's Flat, where it said "grass"). Patches are laid as
 * features.js buildFields lays them — 6 x 6 vertices, rotated — and here two
 * overlap, the second a centimetre higher, and a third has a quad folded
 * away the way clearRoadsOfFields folds the ones on a road. On a 7 m grid
 * the sampler must name the same patch as a ray dropped from above (the
 * one that is seen), and nothing where the ray hits nothing.
 *
 * The first version returned the first patch it found: in the browser,
 * round First Run's yard, it disagreed with the ray at 164 of 558 spots.
 *
 * The patchwork is now cut finer where a field is bigger (features.js:
 * 4 to 12 quads a side), and the sampler read every patch as 6 x 6
 * vertices; so two more fields here are 9 and 4 quads a side, one of them
 * over the pasture.
 */
globalThis.document = globalThis.document || { createElement: () => ({ getContext: () => null, style: {} }) };
const THREE = await import('../../src/vendor/three.module.js');
const { fieldPatchSampler } = await import('../../src/world/roads.js');

let N = 5;
const pos = [];
const col = [];
const idx = [];
let base = 0;
function patch(cx, cz, w, d, rot, y, rgb) {
  const ca = Math.cos(rot);
  const sa = Math.sin(rot);
  for (let iy = 0; iy <= N; iy++) {
    for (let ix = 0; ix <= N; ix++) {
      const lx = (ix / N - 0.5) * w;
      const lz = (iy / N - 0.5) * d;
      pos.push(cx + lx * ca - lz * sa, y, cz + lx * sa + lz * ca);
      col.push(...rgb);
    }
  }
  for (let iy = 0; iy < N; iy++) {
    for (let ix = 0; ix < N; ix++) {
      const a0 = base + iy * (N + 1) + ix;
      idx.push(a0, a0 + N + 1, a0 + 1, a0 + 1, a0 + N + 1, a0 + N + 2);
    }
  }
  base += (N + 1) * (N + 1);
}
patch(0, 0, 300, 200, 0.4, 10, [0.62, 0.66, 0.34]); // pasture
patch(100, 50, 200, 200, 1.1, 10.01, [0.84, 0.79, 0.46]); // stubble, over it
patch(1000, 1000, 250, 250, 2.0, 5, [0.46, 0.38, 0.27]); // ploughed earth
const fold = 2 * N * N * 6 + (2 * N + 2) * 6; // the third patch's middle quad
for (const t of [fold, fold + 3]) {
  idx[t + 1] = idx[t];
  idx[t + 2] = idx[t];
}
N = 9;
patch(-150, 120, 260, 180, -0.3, 10.02, [0.74, 0.66, 0.42]); // stubble, cut finer, over the pasture
N = 4;
patch(600, -200, 170, 150, 0.8, 7, [0.88, 0.8, 0.24]); // rapeseed, coarser
const geo = new THREE.BufferGeometry();
geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
geo.setIndex(idx);
const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, polygonOffset: true }));
const group = new THREE.Group();
group.add(mesh);
group.updateMatrixWorld(true);

const sample = fieldPatchSampler(group);
const ray = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);
let n = 0;
let onPatch = 0;
let overlap = 0;
let failed = 0;
const bad = [];
for (let x = -400; x <= 1300; x += 7) {
  for (let z = -400; z <= 1300; z += 7) {
    ray.set(new THREE.Vector3(x, 100, z), down);
    const hits = ray.intersectObject(mesh, false);
    const want = hits.length ? col.slice(hits[0].face.a * 3, hits[0].face.a * 3 + 3) : null;
    const got = sample ? sample(x, z) : null;
    n++;
    if (want) onPatch++;
    if (hits.length > 1 && hits[0].face.a !== hits[hits.length - 1].face.a) overlap++;
    const same = (!got && !want) || (got && want && got.every((c, i) => Math.abs(c - want[i]) < 1e-6));
    if (!same) {
      failed++;
      if (bad.length < 5) bad.push(`${x},${z}: ${got ? got.map((c) => c.toFixed(2)).join('/') : 'none'} against ${want ? want.map((c) => c.toFixed(2)).join('/') : 'none'}`);
    }
  }
}
const ok = !!sample && failed === 0 && onPatch > 1000 && overlap > 100;
console.log(`${ok ? 'PASS' : 'FAIL'} ${n - failed} of ${n} points name the patch a ray from above sees (${onPatch} on a patch, ${overlap} where two overlap)`);
for (const b of bad) console.log('  ' + b);
if (typeof process !== 'undefined') process.exitCode = ok ? 0 : 1;

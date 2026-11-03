/**
 * REAL SCENERY (src/world/real-scenery.js, src/world/real-trees.js), checked
 * in node against the shipped files.
 *
 *   node tests/features/real-scenery.mjs
 *
 * Per model:
 *   - the file is there, parses with the game's own reader, is small, and
 *     carries NO images, textures or samplers (the leaves' picture is a file
 *     of its own, WebP, at most 512 px and 100 KB);
 *   - its credit is in the file, on the Credits screen and in LICENSES.md;
 *   - a tree is one unit tall, standing on y = 0, its trunk on the origin.
 * The close-up trees:
 *   - on Medium and up the trees nearest the camera are drawn by the real
 *     model, with the SAME matrix, and taken out of their own mesh; the ones
 *     further than the tier's radius are not; moving away gives every one its
 *     own matrix back; Low draws none and gives everything back;
 *   - a source refilled behind its back (the World Map pool) is re-read;
 *   - the module and the files wait for the menu: not in main.js's static
 *     graph, not in sw.js's precache list.
 * Every check fails on the tree before this file existed.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';

global.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('src/', ROOT).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const RS = await import(SRC + 'world/real-scenery.js');
const RT = await import(SRC + 'world/real-trees.js');
const Q = await import(SRC + 'aircraft/model-quality.js');
const { parseGLB } = await import(SRC + 'vehicles/glb.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  — ${detail}` : ''}`);
}
const read = (p) => readFileSync(new URL(p, ROOT));
const disk = (url) => {
  const b = readFileSync(new URL(url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
RS.setRealSceneryLoader(disk, async () => null);
Q.setModelQuality('medium');
{
  // A tree registered before its model has arrived, the camera then standing still: drawn once it has.
  const f0 = forest(40);
  RT.addTreeSource(f0.mesh, 'conifer');
  RT.updateRealTrees(new THREE.Vector3(100, 10, 60), 0.01);
  await RS.loadRealScenery('tree-pine');
  RT.updateRealTrees(new THREE.Vector3(100, 10, 60), 0.01);
  ok('close-up: a model that arrives while the camera stands still is drawn at once', RT.realTreeStats().byModel['tree-pine'] > 0);
  f0.scene.remove(f0.mesh);
  RT.updateRealTrees(new THREE.Vector3(100, 10, 60), 1);
  RT.clearTreeSources();
}

function glbJson(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len)));
}
const credits = read('src/ui/credits.js').toString();
const licences = read('assets/models/LICENSES.md').toString();
const sw = read('sw.js').toString();
const TREES = ['tree-palm', 'tree-pine', 'tree-birch', 'tree-oak'];

for (const id of Object.keys(RS.REAL_SCENERY)) {
  const e = RS.REAL_SCENERY[id];
  const p = `assets/models/real/scenery/${e.file}`;
  const there = existsSync(new URL(p, ROOT));
  ok(`${id}: ${p} is there`, there);
  if (!there) continue;
  const buf = read(p);
  const size = statSync(new URL(p, ROOT)).size;
  ok(`${id}: under ${e.maxKB || 450} KB`, size <= (e.maxKB || 450) * 1024, `${(size / 1024).toFixed(0)} KB`);
  const j = glbJson(buf);
  ok(`${id}: no images, textures or samplers inside`, !j.images && !j.textures && !j.samplers);
  const root = j.nodes.find((n) => n.name === id);
  ok(`${id}: a root node named ${id} with its credit`, !!(root && root.extras && root.extras.credit && root.extras.credit.includes(e.url) && /CC BY 4\.0/.test(root.extras.credit)));
  ok(`${id}: on the Credits screen`, credits.includes(e.url) && credits.includes(e.title.replace(/'/g, '&rsquo;')) || credits.includes(e.url) && credits.includes(e.title));
  ok(`${id}: in assets/models/LICENSES.md`, licences.includes(e.url) && licences.includes(`scenery/${e.file}`));
  const parsed = parseGLB(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), { warn: () => {} });
  const box = new THREE.Box3().setFromObject(parsed.scene);
  if (TREES.includes(id)) {
    ok(`${id}: one unit tall, on y = 0`, Math.abs(box.max.y - box.min.y - 1) < 0.01 && Math.abs(box.min.y) < 0.01, `${box.min.y.toFixed(3)}..${box.max.y.toFixed(3)}`);
    // the trunk's foot on the origin: the middle of what is in the lowest 2% is within 3% of the height of it
    let fx = 0, fz = 0, fn = 0;
    parsed.scene.traverse((o) => {
      if (!o.isMesh) return;
      const pa = o.geometry.attributes.position;
      for (let i = 0; i < pa.count; i++) if (pa.getY(i) < 0.02) { fx += pa.getX(i); fz += pa.getZ(i); fn++; }
    });
    const off = fn ? Math.hypot(fx / fn, fz / fn) : 1;
    ok(`${id}: standing on its trunk at the origin`, off < 0.03, `foot ${off.toFixed(3)} off it`);
    ok(`${id}: a leaves part and its picture`, !!e.leaf && existsSync(new URL(`assets/models/real/scenery/${e.leaf}`, ROOT)));
    if (e.leaf) {
      const lb = read(`assets/models/real/scenery/${e.leaf}`);
      // WebP: RIFF....WEBP, VP8X canvas size at 24..29 (24-bit, minus one)
      const isWebp = lb.subarray(0, 4).toString() === 'RIFF' && lb.subarray(8, 12).toString() === 'WEBP';
      const w = isWebp && lb.subarray(12, 16).toString() === 'VP8X' ? 1 + (lb[24] | (lb[25] << 8) | (lb[26] << 16)) : 0;
      ok(`${id}: the leaf picture is WebP, at most 512 px and 100 KB`, isWebp && w > 0 && w <= 512 && lb.length <= 100 * 1024, `${w} px, ${(lb.length / 1024).toFixed(0)} KB`);
    }
    const tpl = await RS.loadRealScenery(id);
    ok(`${id}: loads through the game's loader, bark and leaves`, !!(tpl && tpl.parts.has('bark') && tpl.parts.has('leaves')));
    if (tpl) ok(`${id}: its leaves are alpha-tested and two-sided`, tpl.parts.get('leaves').material.alphaTest > 0 && tpl.parts.get('leaves').material.side === THREE.DoubleSide);
  }
}
ok('tree cards: the real trees\' picture is there and small', existsSync(new URL('assets/models/real/scenery/tree-cards.webp', ROOT)) && statSync(new URL('assets/models/real/scenery/tree-cards.webp', ROOT)).size < 150 * 1024);
const cardsSrc = read('src/world/worldmap/tree-cards.js').toString();
ok('tree cards: tree-cards.js paints the real trees\' picture over its drawing', /tree-cards\.webp/.test(cardsSrc) && /repaintFromRealTrees/.test(cardsSrc));

/* ---- the close-up trees ---- */
function forest(n, spacing = 20) {
  const scene = new THREE.Scene();
  const geo = new THREE.BoxGeometry(0.3, 1, 0.3).translate(0, 0.5, 0);
  const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial(), n);
  const d = new THREE.Object3D();
  for (let i = 0; i < n; i++) {
    d.position.set((i % 20) * spacing, 2, Math.floor(i / 20) * spacing);
    d.rotation.set(0, i * 0.7, 0);
    const h = 8 + (i % 5);
    d.scale.set(h, h, h);
    d.updateMatrix();
    mesh.setMatrixAt(i, d.matrix);
    mesh.setColorAt(i, new THREE.Color(0.9 + (i % 3) * 0.05, 1, 1));
  }
  mesh.name = 'trees:broadleaf';
  scene.add(mesh);
  return { scene, mesh };
}
const zero = (m, i) => m.instanceMatrix.array[i * 16 + 15] === 0 && m.instanceMatrix.array[i * 16] === 0;

Q.setModelQuality('medium');
RT.clearTreeSources();

const { scene, mesh } = forest(400);
const orig = mesh.instanceMatrix.array.slice();
ok('close-up: a broadleaf mesh registers (as the oak)', RT.addTreeSource(mesh, 'broadleaf') && RT.SPECIES_MODEL.broadleaf === 'tree-oak');
ok('close-up: scrub and thorn keep their own (nothing to register)', !RT.addTreeSource(mesh, 'scrub') && !RT.addTreeSource(mesh, 'thorn'));
await RS.loadRealScenery('tree-oak');
const cam = new THREE.Vector3(100, 10, 100);
RT.updateRealTrees(cam, 1);
let st = RT.realTreeStats();
const tier = RT.NEAR_TIERS.medium;
const inR = [];
// (the distance to the camera, height and all: real-trees.js)
const dist3 = (i, c = cam) => Math.hypot(orig[i * 16 + 12] - c.x, orig[i * 16 + 13] - c.y, orig[i * 16 + 14] - c.z);
for (let i = 0; i < 400; i++) if (dist3(i) < tier.radius) inR.push(i);
ok('close-up (Medium): as many real oaks as trees in range, up to the cap', st.byModel['tree-oak'] === Math.min(tier.cap, inR.length), `${st.byModel['tree-oak']} shown, ${inR.length} in range, cap ${tier.cap}`);
const group = RT.realTreeGroup();
const pool = group && group.children.find((c) => /real-trees:tree-oak:leaves/.test(c.name));
ok('close-up: the real trees are in the scene, one instanced mesh per part', !!(pool && group.parent === scene && group.children.filter((c) => /tree-oak/.test(c.name)).length === 2));
const hiddenN = [...Array(400).keys()].filter((i) => zero(mesh, i)).length;
ok('close-up: each shown tree is taken out of its own mesh', hiddenN === st.byModel['tree-oak'], `${hiddenN} hidden`);
let farHidden = 0;
for (let i = 0; i < 400; i++) if (zero(mesh, i) && dist3(i) >= tier.radius) farHidden++;
ok('close-up: none beyond the radius is taken', farHidden === 0);
// The same matrix: the nearest tree's real copy, back in world space, is the tree's own.
if (pool) {
  const m0 = new THREE.Matrix4().fromArray(pool.instanceMatrix.array, 0);
  m0.premultiply(new THREE.Matrix4().makeTranslation(group.position.x, group.position.y, group.position.z));
  const near = inR.sort((a, b) => dist3(a) - dist3(b))[0];
  const want = new THREE.Matrix4().fromArray(orig, near * 16);
  const diff = m0.elements.reduce((s, v, k) => s + Math.abs(v - want.elements[k]), 0);
  ok('close-up: the nearest real tree stands on the tree\'s own matrix (place, turn, height)', diff < 1e-3, diff.toFixed(5));
  ok('close-up: and wears its tint', Math.abs(pool.instanceColor.array[0] - mesh.instanceColor.array[near * 3]) < 1e-6);
  ok('close-up: no shadows on Medium', !pool.castShadow);
}
// High above the same wood (the checker's 300 m frames, 2026-11-01: by ground distance the real
// oaks 300+ m off were drawn, their cut-outs thinned to dark specks among the game's green trees):
// from up there the game's own trees, on Medium and on High.
for (const q of ['medium', 'high']) {
  Q.setModelQuality(q);
  RT.updateRealTrees(new THREE.Vector3(100, 300, 100), 1);
  ok(`close-up (${q}): 300 m above the wood no real tree is drawn (the distance counts the height)`, RT.realTreeStats().shown === 0 && mesh.instanceMatrix.array.every((v, k) => v === orig[k]), `${RT.realTreeStats().shown} shown`);
}
Q.setModelQuality('medium');
RT.updateRealTrees(new THREE.Vector3(100, 60, 100), 1);
{
  const c60 = new THREE.Vector3(100, 60, 100);
  let n60 = 0;
  for (let i = 0; i < 400; i++) if (dist3(i, c60) < tier.radius) n60++;
  ok('close-up: 60 m up, the trees within the radius counted in three dimensions', RT.realTreeStats().shown === Math.min(tier.cap, n60) && n60 > 0, `${RT.realTreeStats().shown} shown, ${n60} in range`);
}
// Away: everything back.
RT.updateRealTrees(new THREE.Vector3(5000, 10, 5000), 1);
const back = mesh.instanceMatrix.array.every((v, k) => v === orig[k]);
ok('close-up: moving away gives every tree its own matrix back', back);
ok('close-up: and draws no real tree', RT.realTreeStats().shown === 0);
// High: further, more, shadows.
Q.setModelQuality('high');
RT.updateRealTrees(cam, 1);
st = RT.realTreeStats();
ok('close-up (High): more trees than Medium, with shadows', st.shown > Math.min(tier.cap, inR.length) && group.children.some((c) => c.castShadow), `${st.shown}`);
// A refill behind its back (the World Map pool rewrites the array): re-read, nothing lost.
mesh.instanceMatrix.array.set(orig);
mesh.instanceMatrix.needsUpdate = true;
RT.updateRealTrees(cam, 1);
const hiddenAfter = [...Array(400).keys()].filter((i) => zero(mesh, i)).length;
ok('close-up: a source refilled behind its back is re-read (the near trees hidden again)', hiddenAfter === RT.realTreeStats().byModel['tree-oak'] && hiddenAfter > 0);
// Low: none, and everything back.
Q.setModelQuality('low');
RT.updateRealTrees(cam, 1);
ok('close-up (Low): no real trees', RT.realTreeStats().shown === 0 || RT.realTreeStats().tier === null);
ok('close-up (Low): every tree its own matrix back', mesh.instanceMatrix.array.every((v, k) => v === orig[k]));
// Removed from the scene: let go.
Q.setModelQuality('medium');
scene.remove(mesh);
RT.updateRealTrees(cam, 1);
ok('close-up: a mesh gone from the scene is let go', RT.realTreeStats().sources === 0);
RT.clearTreeSources();

/* ---- the buildings (world/real-buildings.js) ---- */
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20)); return fn(); };
const RB = await import(SRC + 'world/real-buildings.js');
{
  const parent = new THREE.Group();
  const own = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));
  parent.add(own);
  const g = await RB.placeReal(parent, 'firestation', { at: [10, 2, -5], rotY: Math.PI, fit: [30, 20], hide: [own] });
  const b = new THREE.Box3().setFromObject(g);
  ok('placeReal: inside the footprint it is given, on its ground, the game\'s own hidden', !!g && b.max.x - b.min.x <= 30.01 && b.max.z - b.min.z <= 20.01 && Math.abs(b.min.y - 2) < 0.01 && own.visible === false,
    `${(b.max.x - b.min.x).toFixed(1)} x ${(b.max.z - b.min.z).toFixed(1)}`);
  const none = await RB.placeReal(parent, 'no-such-model', { hide: [own] });
  ok('placeReal: no file, nothing placed', none === null);
  const wm = await RB.placeWindmills(parent, [{ x: 0, y: 0, z: 0 }, { x: 50, y: 3, z: 0, rotY: 1 }]);
  const wheel = wm && wm.group.children.find((c) => /wheel/.test(c.name));
  const tpl = RS.realSceneryTemplate('windmill');
  const hub = new THREE.Vector3(...tpl.extras.pivots.wheel.hub);
  const m0 = new THREE.Matrix4();
  wheel.getMatrixAt(0, m0);
  const h0 = hub.clone().applyMatrix4(m0);
  wm.update(0.7);
  wheel.getMatrixAt(0, m0);
  const h1 = hub.clone().applyMatrix4(m0);
  ok('windmills: the wheel turns about its own hub (the hub stays put)', h0.distanceTo(h1) < 1e-4 && !m0.equals(new THREE.Matrix4()), h0.distanceTo(h1).toFixed(6));
  ok('windmills: one instanced mesh per part, a wheel and a body', !!wheel && wm.group.children.length === 2 && wheel.count === 2);
  ok('windmill: about 12 m tall, its wheel axis fore-and-aft', Math.abs(tpl.extras.size[1] - 12) < 0.05 && Math.abs(Math.abs(tpl.extras.pivots.wheel.axis[2]) - 1) < 0.05);
}
{
  const Terrain = await import(SRC + 'world/terrain.js');
  const AP = await import(SRC + 'world/airport.js');
  Q.setModelQuality('low');
  const sceneL = new THREE.Scene();
  const aL = new AP.Airport(sceneL);
  ok('airport (Low): the fire station drawn into the field\'s shared batches, as before', !aL.isolated && !aL.group.getObjectByName('own:fireStation'));
  Q.setModelQuality('medium');
  const sceneM = new THREE.Scene();
  const aM = new AP.Airport(sceneM);
  const own = aM.group.getObjectByName('own:fireStation');
  ok('airport (Medium): the fire station drawn into meshes of its own', !!own && own.children.length > 0);
  ok('airport: the crash tenders are not part of it (they stay)', !!aM.group.getObjectByName('fire-engines') && !own.getObjectByName('fire-engines'));
  await until(() => aM.realFireStation);
  ok('airport (Medium): the real fire station stands in its place, the game\'s own hidden', !!aM.realFireStation && own.visible === false);
  if (aM.realFireStation) {
    const f = aM.layout.fire;
    const b = new THREE.Box3().setFromObject(aM.realFireStation);
    ok('airport: inside the fire station\'s footprint', b.max.x - b.min.x <= Math.max(f.width, f.depth) + 0.05 && b.max.z - b.min.z <= Math.max(f.width, f.depth) + 0.05);
  }
  void Terrain;
}
{
  const SC = await import(SRC + 'world/scenery.js');
  const g = new THREE.Group();
  const sc = new THREE.Scene();
  sc.add(g);
  const spots = [];
  for (let i = 0; i < 60; i++) spots.push({ x: 300 + (i % 10) * 30, z: -600 + Math.floor(i / 10) * 30, y: 5, lo: 5, rot: 0, kind: 'house', w: 10 + (i % 4), d: 9, front: 1 });
  // (synthetic spots: the roof builder's own NaN warnings for them are not this test's business)
  const warn = console.error;
  console.error = () => {};
  const t0 = SC.addTown(g, spots, { realHouses: 0 });
  ok('town: with no real share every house is the game\'s own, as before', !t0.real && !g.getObjectByName('town-houses-for-real'));
  const g2 = new THREE.Group();
  sc.add(g2);
  const t1 = SC.addTown(g2, spots, { realHouses: 0.35 });
  console.error = warn;
  const n = t1.real ? t1.real.spots.length : 0;
  ok('town (Medium): about a third of the houses set aside for the real one', n > 8 && n < 35, `${n} of 60`);
  ok('town: those drawn into meshes of their own (their walls and roofs)', !!t1.real && t1.real.own.children.length === 2);
  ok('town: and still solid, like every house', t1.facts.sizes.length === 60);
}
{
  const V = R => R;
  void V;
  const RM = await import(SRC + 'aircraft/real-models.js');
  ok('vehicles: the fuel truck is one of the real vehicles', RM.REAL_VEHICLES.kinds.includes('fuelTruck') && RM.REAL_VEHICLES.credits.some((c) => /15a96ac34ece464480a9b8620dc3a3d3/.test(c.url)));
  const vj = glbJson(read('assets/models/real/vehicles.glb'));
  const fn = vj.nodes.find((x) => x.name === 'fuelTruck');
  ok('vehicles.glb: a fuelTruck shape, vertex-coloured, no images', !!fn && !vj.images);
  const vans = read('src/features/life/vans.js').toString();
  ok('vans.js: the fuel trucks on their rounds wear it too', /'life:fuel', 'fuelTruck'\)/.test(vans));
}
ok('scenery.js: the yachts wear the real sailboat (at sea and on the moorings)', /wearRealSailboats\(boats\.filter/.test(read('src/world/scenery.js').toString()) && /harbour-yachts/.test(read('src/world/scenery.js').toString()));
ok('scenery.js: the air base gets its guarded compound', /'base-outpost'/.test(read('src/world/scenery.js').toString()) && /'base-watchtower'/.test(read('src/world/scenery.js').toString()));
ok('features.js: wind pumps on the farmland, turning', /placeWindmills/.test(read('src/world/features.js').toString()) && /this\.windmills\.update/.test(read('src/world/features.js').toString()));

/* ---- first load ---- */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
const seen = new Set();
const { resolve, dirname } = await import('node:path');
const { fileURLToPath } = await import('node:url');
const ROOTP = fileURLToPath(ROOT);
(function walk(f) {
  if (seen.has(f)) return;
  seen.add(f);
  let t = '';
  try { t = readFileSync(f, 'utf8'); } catch { return; }
  let m;
  while ((m = IMPORT_RE.exec(t))) if (m[1].startsWith('.')) walk(resolve(dirname(f), m[1]));
})(resolve(ROOTP, 'src/main.js'));
ok('first load: real-trees.js is not in main.js\'s static graph (fetched at Medium+, after the menu)', ![...seen].some((f) => f.endsWith('src/world/real-trees.js')));
ok('first load: real-scenery.js is not in main.js\'s static graph', ![...seen].some((f) => f.endsWith('src/world/real-scenery.js')));
ok('first load: real-buildings.js is not in main.js\'s static graph', ![...seen].some((f) => f.endsWith('src/world/real-buildings.js')));
ok('sw.js: no real scenery file in the install list', !/assets\/models\/real\/scenery\//.test(sw));
ok('sw.js: the two modules are in it (offline once seen)', sw.includes("'src/world/real-trees.js'") && sw.includes("'src/world/real-scenery.js'"));

/*
 * The boreal maps: the near real pines were paler and yellower than the far firs (scenery.js's own), and the
 * World Map's conifer cards (drawn from the same pine) the same. Measured in the game (headless Chrome): the
 * pine's needle picture averages linear (0.156, 0.209, 0.083), times the model's vertex colour 0.866; the
 * conifer card's side (0.085, 0.095, 0.041). The firs' green is read from scenery.js's conifer geometry here.
 */
{
  const SC = await import(SRC + 'world/scenery.js');
  const g = SC.treeGeometry(2);
  const c = g.attributes.color;
  const sum = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < c.count; i++) {
    const r = c.getX(i);
    const gg = c.getY(i);
    if (gg > r * 2) {
      sum[0] += r;
      sum[1] += gg;
      sum[2] += c.getZ(i);
      n++;
    }
  }
  const fir = sum.map((v) => v / Math.max(1, n));
  const near = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol * Math.max(b[i], 0.01));
  const tint = RS.REAL_SCENERY['tree-pine'].leafTint;
  const needles = tint ? [0.156, 0.209, 0.083].map((v, i) => v * 0.866 * tint[i]) : [0.156 * 0.866, 0.209 * 0.866, 0.083 * 0.866];
  ok('boreal: the near real pine\'s needles are the far firs\' green (within 20% a channel), not paler and yellower', near(needles, fir, 0.2),
    `needles ${needles.map((v) => v.toFixed(3))} vs firs ${fir.map((v) => v.toFixed(3))}${tint ? '' : ' (no tint)'}`);
  const src = read('src/world/real-scenery.js').toString();
  ok('boreal: ...applied to the needles\' material when the picture arrives (the bark keeps its own)', /const tint = REAL_SCENERY\[id\]\.leafTint;\s*if \(tint\) m\.color\.setRGB\(tint\[0\], tint\[1\], tint\[2\]\)/.test(src));
  const TC = await import(SRC + 'world/worldmap/tree-cards.js');
  const ct = TC.CONIFER_CARD_TINT;
  const card = ct ? [0.085, 0.095, 0.041].map((v, i) => v * ct[i]) : [0.085, 0.095, 0.041];
  ok('boreal: the World Map\'s conifer cards the same green as the firs in front of them (within 20% a channel)', near(card, fir, 0.2),
    `cards ${card.map((v) => v.toFixed(3))} vs firs ${fir.map((v) => v.toFixed(3))}`);
  // The cell tint on a stand-in canvas: a needle pixel goes to the firs' green, a bark pixel is left alone.
  const px = new Uint8ClampedArray([120, 150, 60, 255, 140, 110, 90, 255]);
  const ctx = { getImageData: () => ({ data: px }), putImageData() {} };
  const did = typeof TC.tintCells === 'function' && TC.tintCells(ctx, 0, 0, 2, 1, ct);
  ok('boreal: the card tint changes the needles and leaves the bark brown', !!did && px[0] < 100 && px[1] > 120 && px[4] === 140 && px[5] === 110 && px[6] === 90 && px[3] === 255,
    `needle ${[...px.slice(0, 4)]}, bark ${[...px.slice(4, 8)]}`);
  const tcs = read('src/world/worldmap/tree-cards.js').toString();
  ok('boreal: ...and the real pictures get it on arrival (the conifer cells)', /tintCells\(g, 256, 0, 256, c\.height, CONIFER_CARD_TINT\)/.test(tcs));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

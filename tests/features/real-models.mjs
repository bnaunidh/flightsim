/**
 * REAL MODELS (src/aircraft/real-models.js), checked in node against the
 * shipped files, the real roster and the real fleet factory.
 *
 *   node tests/features/real-models.mjs [id ...]
 *
 * Per type:
 *   - the file is there, parses with the game's own reader, and is small;
 *   - it carries NO images, textures or samplers at all, and nothing in it
 *     but its credit names a real airline or maker (the paint is the
 *     game's parody liveries, applied at run time);
 *   - its credit is in the file, on the Credits screen and in LICENSES.md;
 *   - its length is within 3% of the game's airframe, its span within 3%
 *     of the type's real span, and nothing of it hangs below the game's
 *     wheels (the gear contact the flight model lands on);
 *   - worn by the game's own model: the skin goes on, the procedural
 *     outside goes to the hidden layer while the gear, doors and lamps stay,
 *     the skin steps aside from the seat and on any damage, and comes back
 *     after a reset;
 * and for the loader: a file that fails, the switch off, a short-of-memory
 * device and a Low tier's parked aeroplanes all keep the built-in model,
 * without throwing; and sw.js never precaches the files.
 */
import { readFileSync, existsSync, statSync } from 'node:fs';

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('src/', ROOT).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const T = await import(SRC + 'aircraft/types.js');
const A = await import(SRC + 'aircraft/model-adapter.js');
const R = await import(SRC + 'aircraft/real-models.js');
const L = await import(SRC + 'aircraft/liveries.js');
const TX = await import(SRC + 'render/textures.js');
const { parseGLB } = await import(SRC + 'vehicles/glb.js');
const K = await import(SRC + 'world/airport-kit.js');

let failed = 0;
let passed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  — ${detail}` : ''}`);
}

const read = (p) => readFileSync(new URL(p, ROOT));
const diskLoader = (url) => {
  const b = readFileSync(new URL(url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
R.setRealModelLoader(diskLoader);

/** The JSON chunk of a GLB. */
function glbJson(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const len = dv.getUint32(12, true);
  return JSON.parse(new TextDecoder().decode(buf.subarray(20, 20 + len)));
}

/** Real names that may appear in a credit (the uploader's title) and nowhere else in a file. */
const REAL_NAMES = /lion|qantas|qatar|boeing|airbus|bombardier|lockheed|cessna|emirates|lufthansa|british airways|air france|united|delta|american|ana\b|jal\b|klm|ryanair|easyjet/i;
const ROLES = new Set(['skin_l', 'skin_r', 'fin', 'wing', 'cowl', 'lip', 'duct', 'core', 'glass', 'window', 'dark', 'metal', 'prop']);

const credits = read('src/ui/credits.js').toString();
const licences = read('assets/models/LICENSES.md').toString();
const sw = read('sw.js').toString();

const ARGS = process.argv.slice(2);
const IDS = Object.keys(R.REAL_MODELS).filter((id) => !ARGS.length || ARGS.includes(id));
let totalBytes = 0;

for (const id of IDS) {
  const def = R.REAL_MODELS[id];
  const path = `assets/models/real/${def.file}`;
  ok(`${id}: ${path} is shipped`, existsSync(new URL(path, ROOT)));
  if (!existsSync(new URL(path, ROOT))) continue;
  const buf = read(path);
  const bytes = statSync(new URL(path, ROOT)).size;
  totalBytes += bytes;
  ok(`${id}: under 1.5 MB`, bytes < 1.5 * 1024 * 1024, `${(bytes / 1024).toFixed(0)} KB`);
  const j = glbJson(buf);
  // No images of any kind: nothing a real livery or logo could hide in.
  const texKeys = (j.materials || []).flatMap((m) => [
    ...Object.keys(m.pbrMetallicRoughness || {}).filter((k) => /Texture$/.test(k)),
    ...['normalTexture', 'occlusionTexture', 'emissiveTexture'].filter((k) => m[k]),
    ...Object.keys(m.extensions || {}),
  ]);
  ok(`${id}: no images, textures or samplers in the file`, !j.images && !j.textures && !j.samplers && texKeys.length === 0 && !/image\/(png|jpeg)/.test(buf.toString('latin1')),
    texKeys.join(', '));
  const names = [...(j.materials || []).map((m) => m.name), ...(j.nodes || []).map((n) => n.name), ...(j.meshes || []).map((m) => m.name)];
  ok(`${id}: only the game's own part names (no source material or node names)`,
    names.every((n) => n === id || ROLES.has(n) || ROLES.has(String(n).replace(/^rm_/, ''))), names.filter((n) => n !== id && !ROLES.has(n) && !ROLES.has(String(n).replace(/^rm_/, ''))).join(', '));
  const extras = (j.nodes.find((n) => n.name === id) || {}).extras || {};
  const scrubbed = JSON.stringify({ ...j, nodes: j.nodes.map((n) => ({ ...n, extras: n.extras ? { ...n.extras, credit: '' } : undefined })) });
  ok(`${id}: no real airline or maker name anywhere but the credit`, !REAL_NAMES.test(scrubbed), (scrubbed.match(REAL_NAMES) || [])[0] || '');
  ok(`${id}: the CC BY credit is in the file`, extras.license === 'CC BY 4.0' && typeof extras.credit === 'string' && extras.credit.includes(def.url.split('/').pop()));
  const author = def.author.split(' (')[0].replace(/,.*$/, '');
  ok(`${id}: credited on the Credits screen and in LICENSES.md`, credits.includes(author) && credits.includes(def.url.split('/').pop()) && licences.includes(def.file) && licences.includes(author));

  // The roster's own airframe.
  const type = T.getAircraft(id);
  const proc = A.createAircraftModel({ type });
  const fg = proc.userData.flightGeometry;
  const gameLen = fg.bounds.max[2] - fg.bounds.min[2];
  const parsed = parseGLB(buf, { warn: () => {} });
  const box = new THREE.Box3().setFromObject(parsed.scene);
  const len = box.max.z - box.min.z;
  const span = box.max.x - box.min.x;
  const realSpan = type.aero.wingSpan;
  ok(`${id}: length within 3% of the game's airframe`, Math.abs(len / gameLen - 1) < 0.03, `${len.toFixed(2)} m against ${gameLen.toFixed(2)}`);
  ok(`${id}: span within 3% of the real span`, Math.abs(span / realSpan - 1) < 0.03, `${span.toFixed(2)} m against ${realSpan}`);
  ok(`${id}: nose on the game's nose, tail on its tail`, Math.abs(box.min.z - fg.bounds.min[2]) < 0.3 && Math.abs(box.max.z - fg.bounds.max[2]) < 0.6,
    `${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)} against ${fg.bounds.min[2].toFixed(2)}..${fg.bounds.max[2].toFixed(2)}`);
  const ground = Math.min(...fg.gearPoints.map((g) => g.pos[1]));
  ok(`${id}: nothing hangs below the game's wheels (the gear contact the flight model lands on)`, box.min.y > ground + 0.05,
    `lowest ${box.min.y.toFixed(2)} m, wheels ${ground.toFixed(2)} m`);
  ok(`${id}: centred on the centreline`, Math.abs(box.max.x + box.min.x) < 0.04 * span, `${((box.max.x + box.min.x) / 2).toFixed(2)} m off`);
  {
    // Drawn one-sided: every part wound the way its normals face, or it is see-through
    // from outside (the A321's right engine and wing were), and each side's nacelles
    // sorted alike (a nacelle wound inside out came out as all duct, dark).
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const fn = new THREE.Vector3();
    const vn = new THREE.Vector3();
    const bad = [];
    const sideArea = {};
    parsed.scene.traverse((o) => {
      if (!o.isMesh) return;
      const role = o.parent.name;
      const g = o.geometry;
      const p = g.attributes.position;
      const nn = g.attributes.normal;
      const idx = g.index ? g.index.array : null;
      const count = idx ? idx.length : p.count;
      let against = 0;
      let total = 0;
      for (let t = 0; t < count; t += 3) {
        const i0 = idx ? idx[t] : t;
        const i1 = idx ? idx[t + 1] : t + 1;
        const i2 = idx ? idx[t + 2] : t + 2;
        a.fromBufferAttribute(p, i0);
        b.fromBufferAttribute(p, i1);
        c.fromBufferAttribute(p, i2);
        fn.subVectors(b, a).cross(c.clone().sub(a));
        const area = fn.length() / 2;
        total += area;
        if (nn) {
          vn.fromBufferAttribute(nn, i0).add(c.fromBufferAttribute(nn, i1)).add(b.fromBufferAttribute(nn, i2));
          if (fn.dot(vn) < 0) against += area;
        }
        a.fromBufferAttribute(p, i0).add(b.fromBufferAttribute(p, i1)).add(c.fromBufferAttribute(p, i2));
        const k = `${role}${a.x < 0 ? 'L' : 'R'}`;
        sideArea[k] = (sideArea[k] || 0) + area;
      }
      if (total && against / total > 0.03) bad.push(`${role} ${((100 * against) / total).toFixed(0)}%`);
    });
    ok(`${id}: every part wound the way its normals face (drawn one-sided, so none see-through)`, bad.length === 0, bad.join(', '));
    // The painted cowl, and the dark of the intake and the exhaust together (the A-10's
    // source has a fan face on one side only, dark either way).
    const area = (side, ...rs) => rs.reduce((s, r) => s + (sideArea[r + side] || 0), 0);
    const lop = [['cowl'], ['duct', 'core']].filter((rs) => area('L', ...rs) + area('R', ...rs) > 0 && Math.abs(area('L', ...rs) / (area('R', ...rs) || 1e-9) - 1) > 0.1);
    ok(`${id}: the engines on the two sides sorted alike (cowl, and duct with core, areas within 10%)`, lop.length === 0,
      lop.map((rs) => `${rs.join('+')} ${area('L', ...rs).toFixed(1)} / ${area('R', ...rs).toFixed(1)} m²`).join(', '));
  }
  const roles = new Set();
  parsed.scene.traverse((o) => o.isMesh && roles.add(o.parent.name));
  // A centreline fin, unless the type has twin fins (the A-10's are painted with the wings).
  const twinFins = !!(proc.userData.config && proc.userData.config.fin && proc.userData.config.fin.mirror);
  ok(`${id}: has a fuselage on both sides${twinFins ? '' : ', a fin'} and a wing`, ['skin_l', 'skin_r', 'wing', ...(twinFins ? [] : ['fin'])].every((k) => roles.has(k)), [...roles].join(' '));
  const livery = !!proc.userData.realPaint;

  // Worn by the game's own model.
  await R.loadRealModel(id);
  const scheme = L.schemeFor(type, 'house');
  const m = A.createAircraftModel({ type, livery: scheme, realModel: true });
  const rm = m.userData.realModel;
  ok(`${id}: the player's model wears it`, !!rm && rm.state === 'on' && rm.on && !!m.getObjectByName('Real model'));
  if (!rm || !rm.skin) continue;
  {
    // A bake (the apron's parked aeroplanes, the ground crew's door finder) takes the
    // procedural airframe only: the skin's shell on top of it was the aeroplane twice.
    const tris = (b) => b.parts.reduce((s, p) => s + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 0);
    R.setRealModels(false);
    const bare = A.createAircraftModel({ type, livery: scheme });
    R.setRealModels(true);
    const worn = A.createAircraftModel({ type, livery: scheme });
    const a = tris(K.bakeModel(worn));
    const b = tris(K.bakeModel(bare));
    ok(`${id}: a bake of it is the procedural airframe alone (not both shells)`, !!worn.userData.realSkin && a === b, `${a} triangles worn, ${b} bare`);
  }
  const layerOf = (o) => o.layers.mask;
  let hiddenSkin = 0;
  let shownGear = 0;
  let gearTotal = 0;
  let hiddenGear = 0;
  m.children[0].traverse((o) => {
    if (!o.isMesh) return;
    const gearish = /landing gear|bogie|twin tyres|oleo/i.test(o.name) || (o.parent && /landing gear|bogie/i.test(o.parent.name));
    if (gearish) {
      gearTotal++;
      if (layerOf(o) === 1) shownGear++;
      else hiddenGear++;
    }
    if (/skin|wing surface|Fan cowl/i.test(o.name) && !/^Door /.test(o.name) && !/door/i.test(o.parent.name) && layerOf(o) !== 1) hiddenSkin++;
  });
  ok(`${id}: the procedural outside goes under it, its gear stays in view`, hiddenSkin > 0 && gearTotal > 0 && hiddenGear === 0, `${hiddenSkin} hidden, gear ${shownGear}/${gearTotal}`);
  const sprites = [];
  m.traverse((o) => o.isSprite && sprites.push(o));
  ok(`${id}: the lamps stay`, sprites.length >= 5 && sprites.every((s) => s.layers.mask === 1));
  let skinMats = 0;
  let unpainted = 0;
  rm.skin.traverse((o) => {
    if (!o.isMesh) return;
    skinMats++;
    const role = o.parent.name;
    if (/^skin_/.test(role) && !(o.material.map && o.geometry.attributes.uv)) unpainted++;
  });
  if (livery) ok(`${id}: the fuselage is painted with the livery (texture and coordinates)`, skinMats > 0 && unpainted === 0);
  else {
    // No livery map (a military type): the skin in the procedural skin's own flat colour, no texture at all.
    let flat = true;
    rm.skin.traverse((o) => { if (o.isMesh && o.material.map) flat = false; });
    ok(`${id}: painted flat in its own paint (no livery map, no texture)`, skinMats > 0 && flat);
  }
  const fin = rm.skin.getObjectByName('fin');
  const finMesh = fin && fin.children.find((c) => c.isMesh);
  const tail = scheme && scheme.tail != null ? new THREE.Color(scheme.tail) : new THREE.Color(type.accent || '#c8102e');
  if (livery) ok(`${id}: the fin wears the tail colour`, !!finMesh && finMesh.material.color.getHex() === tail.getHex(), finMesh ? `#${finMesh.material.color.getHexString()} against #${tail.getHexString()}` : 'no fin');
  // From the seat, and back.
  R.realModelInterior(m, true);
  ok(`${id}: from the seat the procedural model is drawn, not the skin`, !rm.skin.visible && !rm.on);
  R.realModelInterior(m, false);
  ok(`${id}: ...and the skin is back outside`, rm.skin.visible && rm.on);
  // Damage: the breakup pieces are the procedural model's.
  m.userData.update(1 / 60, { crashed: false, gearPos: 1, onGround: true }, {});
  if (typeof m.userData.damagePart === 'function') {
    try {
      m.userData.damagePart('leftWing', 0.4, 'bendWing');
    } catch (e) {
      /* the hook ran before it, which is what is checked */
    }
    ok(`${id}: any damage hands the airframe back to the procedural model`, !rm.on && !rm.skin.visible);
    m.userData.resetDamage();
    m.userData.update(1 / 60, { crashed: false, gearPos: 1, onGround: true }, {});
    ok(`${id}: ...until it is reset`, rm.on && rm.skin.visible);
  }
  m.userData.update(1 / 60, { crashed: true, gearPos: 1, onGround: true }, {});
  ok(`${id}: a crashed aeroplane is drawn by the procedural model`, !rm.on);
  m.userData.dispose();
}

/* ------------------------------------------------------------ loader -- */
{
  const type = T.getAircraft('b737');
  await R.loadRealModel('b737');
  R.setRealModels(false);
  const off = A.createAircraftModel({ type, realModel: true });
  ok('switched off: the built-in model, no skin', !off.userData.realModel && !off.getObjectByName('Real model'));
  R.setRealModels(true);

  // Parked and traffic aeroplanes wear it only once it is here, and never on Low.
  TX.setTextureTier('low');
  const parked = A.createAircraftModel({ type });
  ok('Low: a parked aeroplane keeps the built-in model', !parked.userData.realModel);
  const own = A.createAircraftModel({ type, realModel: true });
  ok("Low: the player's own still wears it", !!own.userData.realModel && own.userData.realModel.on);
  TX.setTextureTier('high');
  const parked2 = A.createAircraftModel({ type });
  ok('High: a parked aeroplane of a type already loaded wears it too', !!parked2.userData.realModel && parked2.userData.realModel.on);

  // A memory-starved phone keeps the built-in models.
  const nav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { deviceMemory: 2 }, configurable: true });
  const phone = A.createAircraftModel({ type, realModel: true });
  ok('2 GB device: the built-in model', !phone.userData.realModel);
  if (nav) Object.defineProperty(globalThis, 'navigator', nav);
  else delete globalThis.navigator;

  // A file that will not come: the built-in model, quietly, and nothing throws.
  const id = 'a350';
  const warn = console.warn;
  const warned = [];
  console.warn = (...a) => warned.push(a.join(' '));
  R.setRealModelLoader(() => {
    throw new Error('offline');
  });
  let threw = null;
  let m = null;
  try {
    // a fresh id the earlier loop may have loaded: use a type whose template is not cached
    m = A.createAircraftModel({ type: T.getAircraft(id), realModel: true });
  } catch (e) {
    threw = e;
  }
  const status = await R.loadRealModel(id);
  console.warn = warn;
  const cached = R.realModelReady(id);
  ok('a file that cannot be fetched: no throw, and the built-in model stays drawn', !threw && !!m && (cached ? m.userData.realModel.on : !m.getObjectByName('Real model')),
    cached ? '(already loaded earlier in this run)' : `status ${R.realModelStatus(id)}, ${warned.length} warning(s)`);
  R.setRealModelLoader(diskLoader);
}

/* ----------------------------------------------------------- vehicles -- */
{
  const V = await import(SRC + 'world/airport-vehicles.js');
  const C = await import(SRC + 'features/ambient/cars.js');
  const path = `assets/models/real/${R.REAL_VEHICLES.file}`;
  ok('vehicles: the file is shipped', existsSync(new URL(path, ROOT)));
  const buf = read(path);
  totalBytes += buf.length;
  const j = glbJson(buf);
  ok('vehicles: no images, textures or samplers', !j.images && !j.textures && !j.samplers && !/image\/(png|jpeg)/.test(buf.toString('latin1')));
  const extras = (j.nodes.find((n) => n.name === 'vehicles') || {}).extras || {};
  ok('vehicles: every credit in the file, on the Credits screen and in LICENSES.md',
    R.REAL_VEHICLES.credits.every((c) => (extras.credit || []).some((x) => x.includes(c.url.split('/').pop())) && credits.includes(c.url.split('/').pop()) && licences.includes(c.url.split('/').pop())));
  TX.setTextureTier('high');
  const geos = await R.loadRealVehicles();
  ok('vehicles: every kind loads', !!geos && R.REAL_VEHICLES.kinds.every((k) => geos.has(k)), geos ? [...geos.keys()].join(' ') : 'none');
  if (geos) {
    const box = (k) => (geos.get(k).computeBoundingBox(), geos.get(k).boundingBox);
    const sizes = [];
    for (const k of ['car', 'taxi', 'bus', 'van', 'jeep', 'fourx4']) {
      const b = box(k);
      const L = b.max.z - b.min.z;
      sizes.push(`${k} ${L.toFixed(2)}/${C.KINDS[k].L}`);
      if (Math.abs(L / C.KINDS[k].L - 1) > 0.03) ok(`vehicles: ${k} is the road traffic's length`, false, `${L.toFixed(2)} m against ${C.KINDS[k].L}`);
    }
    ok('vehicles: the cars are the road traffic\'s lengths (within 3%)', true, sizes.join(', '));
    const truck = box('truck');
    ok('vehicles: the truck is the traffic truck\'s height and no longer than its slot', Math.abs(truck.max.y - C.KINDS.truck.H) < 0.1 && truck.max.z - truck.min.z <= C.KINDS.truck.L);
    const all = R.REAL_VEHICLES.kinds.map((k) => [k, box(k)]);
    ok('vehicles: every one stands on the ground (y = 0) and is centred', all.every(([, b]) => Math.abs(b.min.y) < 0.02 && Math.abs(b.max.x + b.min.x) < 0.25),
      all.filter(([, b]) => !(Math.abs(b.min.y) < 0.02 && Math.abs(b.max.x + b.min.x) < 0.25)).map(([k]) => k).join(' '));
    const tug = box('tug');
    ok('vehicles: the tug\'s towbar reaches the nose leg (TUG_BAR_TIP ahead of its middle)', Math.abs(-tug.min.z - V.TUG_BAR_TIP) < 0.1, `${(-tug.min.z).toFixed(2)} m against ${V.TUG_BAR_TIP}`);
    ok('vehicles: the tug carries its beacon where the glow is drawn', tug.max.y > V.TUG_BEACON[1] - 0.15 && tug.max.y < V.TUG_BEACON[1] + 0.3, `top ${tug.max.y.toFixed(2)} m, glow ${V.TUG_BEACON[1]}`);
    ok('vehicles: vertex colours on every one', all.every(([k]) => !!geos.get(k).attributes.color));
    // Worn by an InstancedMesh of that kind.
    const mesh = new THREE.InstancedMesh(V.tugGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true }), 2);
    const own = mesh.geometry;
    R.wearRealVehicle(mesh, 'tug');
    ok('vehicles: an apron tug wears it (its own copy), the instances untouched', mesh.geometry !== own && mesh.geometry !== geos.get('tug') && mesh.count === 2 && mesh.userData.realVehicle === 'tug');
    TX.setTextureTier('low');
    const low = new THREE.InstancedMesh(V.baggageCartGeometry(), new THREE.MeshStandardMaterial(), 3);
    const lowOwn = low.geometry;
    R.wearRealVehicle(low, 'cart');
    ok('vehicles: Low keeps the built-in shapes', low.geometry === lowOwn && !low.userData.realVehicle);
    TX.setTextureTier('high');
    const fire = new THREE.InstancedMesh(V.fireEngineGeometry(), new THREE.MeshStandardMaterial(), 1);
    ok('vehicles: a kind without a real model is left alone', R.wearRealVehicle(fire, 'firetruck') === false && !fire.userData.realVehicle);
  }
}

/* ------------------------------------------------------- the shipping -- */
ok('sw.js precaches the module', sw.includes("'src/aircraft/real-models.js'"));
{
  const lists = sw.slice(sw.indexOf('const PRECACHE'), sw.indexOf("self.addEventListener('install'"));
  const entries = lists.split('\n').map((l) => l.match(/^\s*'([^']+)',?/)).filter(Boolean).map((x) => x[1]);
  ok('sw.js never precaches a model file (they are fetched when picked, kept once seen)', entries.length > 50 && !entries.some((e) => e.startsWith('assets/models/real/')));
}
ok('tools/sync-precache.mjs leaves them out too', read('tools/sync-precache.mjs').toString().includes("'assets/models/real'"));
if (!ARGS.length) ok('all the real models together stay under 6 MB', totalBytes < 6 * 1024 * 1024, `${(totalBytes / 1024 / 1024).toFixed(2)} MB`);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

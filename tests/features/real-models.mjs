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
  if (def.slats === false) {
    // The procedural slats did not sit on this download's leading edge (a plank ahead of and below it, out for take-off).
    const slats = [];
    m.children[0].traverse((o) => {
      if (!o.isMesh) return;
      for (let n = o; n && n !== m; n = n.parent) if (/slats|leading edge slat/i.test(n.name || '')) return slats.push(o);
    });
    ok(`${id}: its procedural slats stay under the real wing`, slats.length > 0 && slats.every((o) => !o.layers.isEnabled(0)), `${slats.length} slat meshes`);
  }
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

/* --------------------------------------------------------- the A-10 -- */
// The download draws its flaps, split ailerons and elevators deflected well down, and carries
// its own pylons and racks under the wings and the fuselage. Worn as it came, the tailplane read
// from behind as two slabs with blocks under them, the wings drooped, and pylons the game does
// not use hung beside the game's own stores. tools/real-models (models.py a10: hinges, wedges,
// bends, dropPieces) puts the surfaces back to neutral and leaves the source's pylons out.
if (IDS.includes('a10')) {
  const parsed = parseGLB(read('assets/models/real/a10.glb'), { warn: () => {} });
  parsed.scene.updateMatrixWorld(true);
  const tris = [];
  let verts = 0;
  parsed.scene.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    verts += p.count;
    const idx = o.geometry.index ? o.geometry.index.array : null;
    const n = idx ? idx.length : p.count;
    const v = new THREE.Vector3();
    for (let t = 0; t < n; t += 3) {
      const tri = [];
      for (let k = 0; k < 3; k++) tri.push(v.fromBufferAttribute(p, idx ? idx[t + k] : t + k).applyMatrix4(o.matrixWorld).toArray());
      tris.push(tri);
    }
  });
  /** Where the airframe crosses the plane x = const: points [y, z]. */
  const section = (x) => {
    const out = [];
    for (const tri of tris) {
      for (let k = 0; k < 3; k++) {
        const a = tri[k];
        const b = tri[(k + 1) % 3];
        if ((a[0] - x) * (b[0] - x) < 0) {
          const t = (x - a[0]) / (b[0] - a[0]);
          out.push([a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
        }
      }
    }
    return out;
  };
  const type = T.getAircraft('a10');
  const proc = A.createAircraftModel({ type });
  const w = proc.userData.config.wing;
  // The wing's underside, from the real wing itself (its lowest point between the leading and trailing edges).
  const bad = [];
  // Where the source's pylons hung (|x| 1.4-1.65, 3.45-3.7, 4.5-4.8, 5.6-5.75, game metres), clear of the gear pods (2.62).
  for (const ax of [1.5, 3.55, 4.65, 5.68]) {
    for (const s of [-1, 1]) {
      const pts = section(s * ax).filter(([, z]) => z > w.rootZ - 1 && z < w.rootZ + w.rootChord + 1);
      const wing = pts.filter(([y]) => y > -0.6);
      const under = Math.min(...wing.map(([y]) => y));
      const hang = pts.filter(([y]) => y < under - 0.12);
      if (hang.length) bad.push(`x ${s * ax}: ${hang.length} edges ${(under - Math.min(...hang.map(([y]) => y))).toFixed(2)} m under the wing`);
    }
  }
  ok('a10: none of the source\'s own pylons or racks hang under the wings (the game hangs its own stores)', bad.length === 0, bad.slice(0, 4).join('; '));
  // The tailplane: thin and level, its trailing edge on its chord (the elevators were drawn ~20 degrees down).
  const tailBad = [];
  for (const ax of [0.9, 1.5, 2.2, 2.6]) {
    for (const s of [-1, 1]) {
      const pts = section(s * ax).filter(([y, z]) => z > 6.0 && y < 0.8);
      if (pts.length < 4) {
        tailBad.push(`x ${s * ax}: no tailplane`);
        continue;
      }
      const le = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
      const te = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
      const depth = Math.max(...pts.map(([y]) => y)) - Math.min(...pts.map(([y]) => y));
      if (depth > 0.4 || te[0] < le[0] - 0.12) tailBad.push(`x ${s * ax}: ${depth.toFixed(2)} m deep, trailing edge ${(le[0] - te[0]).toFixed(2)} m below the leading edge`);
    }
  }
  ok('a10: the tailplane is thin and level, the elevators neutral (no slabs from behind)', tailBad.length === 0, tailBad.slice(0, 4).join('; '));
  // The wing: the trailing edge on the chord's line, flaps and ailerons neutral (no droop from the side).
  const wingBad = [];
  for (const ax of [1.8, 3.6, 5.2, 6.2, 7.6]) {
    for (const s of [-1, 1]) {
      const pts = section(s * ax).filter(([y, z]) => z > w.rootZ - 1 && z < w.rootZ + w.rootChord + 1 && y > -0.75 && y < 0.8);
      const le = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
      const te = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
      const top = Math.max(...pts.map(([y]) => y));
      // a straight wing's trailing edge sits about level with its leading edge, well below its crown
      if (te[0] < le[0] - 0.2 || te[0] > top - 0.05) wingBad.push(`x ${s * ax}: trailing edge ${(te[0] - le[0]).toFixed(2)} m from the leading edge's height`);
    }
  }
  ok('a10: the wings\' trailing edges are on the chord (flaps and ailerons neutral, no droop)', wingBad.length === 0, wingBad.slice(0, 4).join('; '));
  // ...and one line from root to tip: the ailerons drawn again from the leading edge through the
  // middle of the wing's rear face rode up a cambered wing's and stood 0.3 m above the flaps' edge.
  const stepBad = [];
  for (const s of [-1, 1]) {
    let last = null;
    for (let ax = 3.0; ax <= 7.01; ax += 0.2) {
      const pts = section(s * ax).filter(([y, z]) => z > w.rootZ - 1 && z < w.rootZ + w.rootChord + 1 && y > -0.75 && y < 0.8);
      if (!pts.length) continue;
      const le = pts.reduce((a, b) => (b[1] < a[1] ? b : a));
      const te = pts.reduce((a, b) => (b[1] > a[1] ? b : a));
      const rel = te[0] - le[0];
      if (last !== null && Math.abs(rel - last) > 0.06) stepBad.push(`x ${(s * ax).toFixed(1)}: ${((rel - last) * 100).toFixed(0)} cm`);
      last = rel;
    }
  }
  ok('a10: the wings\' trailing edge is one line, flaps to ailerons (no step)', stepBad.length === 0, stepBad.slice(0, 4).join('; '));
  ok('a10: smooth-shaded (vertices shared across faces, not three to every facet)', verts < 1.5 * tris.length, `${verts} vertices, ${tris.length} triangles`);
  ok('a10: cheap enough for Low (under 32,000 triangles)', tris.length < 32000, `${tris.length}`);

  // Worn: nothing of the procedural airframe is left in view but its gear, its lamps and its stores --
  // and every store it keeps hangs from a pylon it keeps.
  await R.loadRealModel('a10');
  const m = A.createAircraftModel({ type, realModel: true });
  const rm = m.userData.realModel;
  const shown = [];
  m.children[0].traverse((o) => {
    if (!(o.isMesh || o.isInstancedMesh) || o.isSprite || !o.layers.isEnabled(0)) return;
    shown.push(o.name);
  });
  const allowed = /tyres|oleo|landing gear|rocket pod|heat haze|missile|pylon store/i;
  const stray = shown.filter((n) => !allowed.test(n));
  ok('a10: worn, the procedural tail, fins, wings and engines are all under the skin (only gear and stores show)', !!rm && rm.on && stray.length === 0, stray.slice(0, 6).join(', '));
  const pods = shown.filter((n) => /rocket pod$/.test(n)).length;
  const podPylons = shown.filter((n) => /rocket pod pylon/.test(n)).length;
  ok('a10: each rocket pod hangs from its own pylon, in view under the skin', pods === 2 && podPylons === 2, `${pods} pods, ${podPylons} pylons`);
  m.userData.dispose();
}

/* ------------------------------------------- nothing is see-through -- */
// Rays at the airframe: the first triangle a ray meets, front or back, must be one the game
// draws (front-facing, or a material drawn both sides). A back face it would skip is a hole.
// The A321neo download's intake walls are wound inside out (from ahead the fan's blades seemed
// to stick out of the nacelle); the A-10's tail cone is drawn facing in (from behind, an open
// shell with ragged edges).
{
  const holes = (m, origin, targets) => {
    m.updateMatrixWorld(true);
    const meshes = [];
    m.userData.realModel.skin.traverse((o) => o.isMesh && meshes.push(o));
    const rc = new THREE.Raycaster();
    let n = 0;
    let bad = 0;
    for (const t of targets) {
      const o = m.localToWorld(origin.clone());
      rc.set(o, m.localToWorld(t.clone()).sub(o).normalize());
      const seen = rc.intersectObjects(meshes, false)[0];
      const sides = meshes.map((x) => x.material.side);
      for (const x of meshes) x.material.side = THREE.DoubleSide;
      const first = rc.intersectObjects(meshes, false)[0];
      meshes.forEach((x, i) => (x.material.side = sides[i]));
      if (!first) continue;
      n++;
      if (!seen || seen.distance > first.distance + 1e-3) bad++;
    }
    return [bad, n];
  };
  const grid = (cx, cy, z, rx, ry, k = 9) => {
    const a = [];
    for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) a.push(new THREE.Vector3(cx + rx * ((2 * i) / (k - 1) - 1), cy + ry * ((2 * j) / (k - 1) - 1), z));
    return a;
  };
  for (const id of ['a320', 'a321'].filter((k) => IDS.includes(k))) {
    await R.loadRealModel(id);
    const type = T.getAircraft(id);
    const m = A.createAircraftModel({ type, realModel: true });
    const out = [];
    for (const s of [-1, 1]) {
      const ex = 5.65 * s;
      for (const [from, o] of [['ahead and outboard', new THREE.Vector3(ex + 5 * s, -1.3, -9)], ['ahead and inboard', new THREE.Vector3(ex - 3 * s, -1.3, -12)]]) {
        const [bad, n] = holes(m, o, grid(ex, -1.75, -4.0, 0.9, 0.9));
        // a ray or two grazing a seam is not a hole (the inside-out intake let half of them through)
        if (bad > 2 || n < 40) out.push(`${s < 0 ? 'left' : 'right'} engine from ${from}: ${bad} of ${n} rays through`);
      }
    }
    ok(`${id}: its nacelles are not see-through from ahead (the intake's walls drawn both sides)`, out.length === 0, out.join('; '));
    m.userData.dispose();
  }
  if (IDS.includes('a10')) {
    await R.loadRealModel('a10');
    const m = A.createAircraftModel({ type: T.getAircraft('a10'), realModel: true });
    const out = [];
    for (const [from, o] of [['behind', new THREE.Vector3(0, 0.8, 14)], ['above and behind', new THREE.Vector3(1.5, 1.6, 10.5)]]) {
      const [bad, n] = holes(m, o, grid(0, 0.3, 6.5, 0.45, 0.45));
      if (bad || n < 40) out.push(`from ${from}: ${bad} of ${n} rays through`);
    }
    ok('a10: its tail cone is not an open shell from behind', out.length === 0, out.join('; '));
    // The nozzles: the real exhaust is its own unlit copy, not the hot nozzle the engines light.
    const core = [];
    m.userData.realModel.skin.traverse((o) => o.isMesh && o.name === 'core' && core.push(o.material));
    const hot = [];
    m.traverse((o) => o.isMesh && o.material && o.material.name === 'Aircraft_hot_nozzle' && hot.push(o.material));
    for (const h of hot) h.emissiveIntensity = 1.2; // full power (fleet/aircraft-core.js)
    ok('a10: its real exhaust does not glow (a turbofan: the hot nozzle\'s orange read as two flames)',
      core.length > 0 && core.every((c) => !hot.includes(c) && (c.emissiveIntensity === 0 || c.emissive.getHex() === 0)), `${core.length} core, ${hot.length} hot`);
    for (const h of hot) h.emissiveIntensity = 0;
    m.userData.dispose();
  }
}

/* ---------------------------------- the A-10's nozzles, the A320 deck -- */
{
  /** Triangles of one role in a shipped file: centroid, unit normal, area. */
  const trisOf = (id, role) => {
    const g = parseGLB(read(`assets/models/real/${id}.glb`), { warn: () => {} });
    g.scene.updateMatrixWorld(true);
    const out = [];
    g.scene.traverse((o) => {
      if (!o.isMesh || o.name !== role) return;
      const p = o.geometry.attributes.position;
      const idx = o.geometry.index;
      const n = idx ? idx.count : p.count;
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      for (let t = 0; t < n; t += 3) {
        a.fromBufferAttribute(p, idx ? idx.getX(t) : t).applyMatrix4(o.matrixWorld);
        b.fromBufferAttribute(p, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld);
        c.fromBufferAttribute(p, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
        const fn = b.clone().sub(a).cross(c.clone().sub(a));
        const area = fn.length() / 2;
        out.push({ c: a.clone().add(b).add(c).divideScalar(3), n: fn.normalize(), area });
      }
    });
    return out;
  };
  if (IDS.includes('a10')) {
    // Core is the nozzle inside; the nacelle's tapering outside there is cowl. Sorted by radius
    // alone, the outside near the nozzle came out in ragged dark teeth: rays from all round each
    // nacelle's back half, at its axis, must meet no core first.
    const g = parseGLB(read('assets/models/real/a10.glb'), { warn: () => {} });
    g.scene.updateMatrixWorld(true);
    const meshes = [];
    g.scene.traverse((o) => o.isMesh && meshes.push(o));
    const rc = new THREE.Raycaster();
    let rays = 0;
    let core = 0;
    for (const s of [-1, 1]) {
      const box = new THREE.Box3();
      const cowl = meshes.find((o) => o.name === 'cowl');
      const p = cowl.geometry.attributes.position;
      const v = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) if (v.fromBufferAttribute(p, i).applyMatrix4(cowl.matrixWorld).x * s > 0.5) box.expandByPoint(v);
      const cx = (box.min.x + box.max.x) / 2;
      const cy = (box.min.y + box.max.y) / 2;
      const z0 = (box.min.z + box.max.z) / 2;
      // up to the cowl's back edge (the core's own nozzle stands out behind it), and from the
      // outboard side, above and below (not from inside the fuselage or the other nacelle)
      for (let z = z0; z < box.max.z - 0.25; z += 0.06) {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2;
          if (s * Math.cos(a) < -0.3) continue;
          const o = new THREE.Vector3(cx + 2.5 * Math.cos(a), cy + 2.5 * Math.sin(a), z);
          rc.set(o, new THREE.Vector3(cx, cy, z).sub(o).normalize());
          rc.far = 2.5;
          const hit = rc.intersectObjects(meshes, false)[0];
          if (!hit) continue;
          rays++;
          if (hit.object.name === 'core') core++;
        }
      }
    }
    ok('a10: from outside, its nacelles\' backs are cowl, not the nozzles\' dark core', rays > 300 && core === 0, `${core} of ${rays} rays meet core first`);
  }
  for (const id of ['a320', 'a321'].filter((k) => IDS.includes(k))) {
    const w = A.createAircraftModel({ type: T.getAircraft(id) }).userData.config.wing;
    // Ahead of the wing there is no wing: the flight deck's crown came out as wing-grey teeth.
    const teeth = trisOf(id, 'wing').filter((t) => Math.abs(t.c.x) < 2.4 && t.c.z < w.rootZ - 1);
    ok(`${id}: nothing ahead of the wing is painted as wing (the flight deck's crown is fuselage)`, teeth.length === 0, `${teeth.length} triangles`);
    // The windscreen's front panes are the download's own glass, not a hole where they were left
    // out: looking straight at them from ahead, either side of the centre post, rays meet glass.
    {
      const g = parseGLB(read(`assets/models/real/${id}.glb`), { warn: () => {} });
      g.scene.updateMatrixWorld(true);
      const meshes = [];
      g.scene.traverse((o) => o.isMesh && meshes.push(o));
      const glass = meshes.find((o) => o.name === 'glass');
      const gb = new THREE.Box3().setFromObject(glass);
      const rc = new THREE.Raycaster();
      const met = [];
      for (const x of [-0.45, -0.3, 0.3, 0.45]) {
        for (const f of [0.4, 0.55, 0.7]) {
          rc.set(new THREE.Vector3(x, gb.min.y + f * (gb.max.y - gb.min.y), gb.min.z - 6), new THREE.Vector3(0, 0, 1));
          const hit = rc.intersectObjects(meshes, false)[0];
          met.push(hit ? hit.object.name : 'nothing');
        }
      }
      ok(`${id}: its windscreen has its front panes (looked at from ahead: glass)`, met.every((n) => n === 'glass'), met.join(','));
    }
    ok(`${id}: the procedural flight deck's panes are not painted on over its own windscreen`, R.REAL_MODELS[id].ownDeckGlass === true);
  }
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

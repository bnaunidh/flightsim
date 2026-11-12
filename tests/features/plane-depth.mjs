/**
 * Node checks for PLANE DEPTH (src/aircraft/plane-depth.js): the shade and
 * the small parts laid over every aeroplane the game draws itself.
 *
 *   node tests/features/plane-depth.mjs
 *
 *   1. EVERY PROCEDURAL TYPE takes it without a throw: occlusion on its
 *      airframe (flagged, within bounds, darker in its corners than on its
 *      open skin), and the parts it should have -- lenses, wicks on the
 *      jets, a pitot on what has none of its own.
 *   2. NOTHING THAT FLIES CHANGES: the flight geometry, the gear and strike
 *      points, the drawn outline (the hangar's span and length) are the same
 *      after as before, and no builder's geometry is moved.
 *   3. THE REAL MODELS' TYPES are left alone (their skin is drawn instead).
 *   4. A SECOND COPY is worked out from the first (cached) and costs next to
 *      nothing.
 *   5. THE BREAK-UP still works on a dressed model: the parts go with the
 *      piece they sit on, and restoring puts everything back.
 *   6. THE SHADER: a patched material keeps its own program key and hook,
 *      and a mesh without the attribute reads no shade.
 *   7. THE GATE (model-adapter.js): nothing in node, nothing on Low, nothing
 *      on an iPad or a Chromebook; on a desktop at Medium, the module is
 *      fetched on demand and the model dressed.
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
const T = await imp('aircraft/types.js');
const A = await imp('aircraft/model-adapter.js');
const R = await imp('aircraft/real-models.js');
const D = await imp('aircraft/plane-depth.js');
const Q = await imp('aircraft/model-quality.js');
const B = await imp('game/breakup.js');
const BM = await imp('game/breakup-mesh.js');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}
const t0All = performance.now();

const outline = (m) => {
  m.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  m.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh) return;
    for (let p = o; p && p !== m; p = p.parent) if (!p.visible) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
  return box;
};
const positionsOf = (m) => {
  const out = new Map();
  m.traverse((o) => {
    if (o.isMesh && o.name !== 'surface detail') out.set(o, o.geometry.attributes.position.array.slice());
  });
  return out;
};

/* ---- 1-3. every type ------------------------------------------------------ */
const realOn = R.realModelsOn();
const dressed = {};
for (const type of T.AIRCRAFT) {
  const id = type.id;
  const m = A.createAircraftModel({ type });
  ok(`${id}: not dressed by the gate in node (no window)`, !m.userData.depth);
  if (R.REAL_MODELS[id] && realOn) {
    D.deepen(m, type);
    ok(`${id}: a real model's type is left alone`, !m.userData.depthParts && !(m.userData.depth && m.userData.depth.ao));
    continue;
  }
  const fg = JSON.stringify(m.userData.flightGeometry || null);
  const before = outline(m);
  const pos = positionsOf(m);
  let threw = null;
  try {
    D.deepen(m, type);
  } catch (e) {
    threw = e;
  }
  const d = m.userData.depth;
  ok(`${id}: dressed without a throw`, !threw && !!d, threw ? String(threw) : '');
  if (!d) continue;
  dressed[id] = { type, m };
  // occlusion
  let n = 0;
  let bad = 0;
  let hi = 0;
  let lo = 0;
  m.traverse((o) => {
    const a = o.isMesh && o.geometry.attributes.depthAO;
    if (!a) return;
    n++;
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i);
      if (!(x >= 0 && x <= 0.75) || a.getY(i) !== 0.5) bad++;
      if (x > 0.3) hi++;
      if (x < 0.05) lo++;
    }
  });
  ok(`${id}: occlusion on its airframe, flagged and in bounds (0..0.75)`, n > 0 && !bad && d.ao === n, `${n} meshes, ${bad} bad`);
  ok(`${id}: shade in its corners, open skin left clear`, hi > 0 && lo > hi * 0.5, `${hi} shaded, ${lo} open`);
  // parts
  const p = d.parts;
  const person = typeof type.buildModel === 'function';
  const heli = !!(type.shape.power && type.shape.power.rotor);
  const jet = type.shape.power && type.shape.power.kind === 'jet';
  if (person) ok(`${id}: a person gets shade but no aeroplane parts`, !p);
  else {
    const total = p ? Object.values(p).reduce((a, b) => a + b, 0) : 0;
    ok(`${id}: small parts placed (${p ? Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${v} ${k}`).join(', ') : 'none'})`, total > 0);
    if (jet && !heli && !type.shape.flyingWing) ok(`${id}: a jet has static wicks`, p.wicks >= 2, `${p.wicks}`);
    if (heli) ok(`${id}: a helicopter has no wicks and no wing pitot`, p.wicks === 0);
    // every part hung on the mesh it sits on, inside a LOD
    const lods = m.userData.depthParts || [];
    ok(`${id}: parts hung on airframe meshes, each set drawn near the camera only (LOD)`, lods.length > 0 && lods.every((l) => l.isLOD && l.parent && l.parent.isMesh && l.levels.length === 2 && l.levels[1].distance > 0));
    ok(`${id}: ...and hidden until a camera sees them, so a bake straight after the build leaves them out`, lods.every((l) => l.levels[0].object.visible === false));
  }
  // nothing that flies changes
  ok(`${id}: the flight geometry is unchanged`, JSON.stringify(m.userData.flightGeometry || null) === fg);
  const after = outline(m);
  const sz0 = before.getSize(new THREE.Vector3());
  const grow = Math.max(before.min.distanceTo(after.min), before.max.distanceTo(after.max));
  ok(`${id}: the drawn outline stays within 2% (span ${sz0.x.toFixed(1)}, length ${sz0.z.toFixed(1)})`, grow < Math.max(sz0.x, sz0.z) * 0.02, `moved ${grow.toFixed(3)}`);
  let moved = 0;
  for (const [o, arr] of pos) {
    const now = o.geometry.attributes.position.array;
    if (now.length !== arr.length || now.some((v, i) => v !== arr[i])) moved++;
  }
  ok(`${id}: no builder's vertex moved`, moved === 0, `${moved} meshes`);
}

/* ---- the skin's relief ---------------------------------------------------- */
{
  const TX = await imp('render/textures.js');
  for (const id of ['skylark', 'courier', 'meridian', 'tempest', 'petrel'].filter((k) => dressed[k])) {
    const { m } = dressed[id];
    let sharp = 0;
    let old = 0;
    m.traverse((o) => {
      for (const mat of o.isMesh ? [].concat(o.material) : []) {
        if (!mat) continue;
        if (mat.normalMap === TX.airframeNormal()) old++;
        if (mat.normalMap && /airframe relief \(detail\)/.test(mat.normalMap.name) && mat.roughnessMap) sharp++;
      }
    });
    ok(`${id}: its painted skin wears the sharp panel relief and per-panel roughness`, sharp > 0 && old === 0 && m.userData.depth.relief > 0, `${sharp} sharp, ${old} old`);
  }
}

/* ---- 4. a second copy ----------------------------------------------------- */
for (const id of ['skylark', 'meridian', 'vanguard', 'c17'].filter((k) => dressed[k])) {
  const type = T.getAircraft(id);
  const m = A.createAircraftModel({ type });
  D.deepen(m, type);
  const d = m.userData.depth;
  ok(`${id}: a second copy reuses the first's work (${d.ms} ms)`, d.cached && d.ms < 25 && d.ao === dressed[id].m.userData.depth.ao);
  const g1 = [];
  const g2 = [];
  for (const l of dressed[id].m.userData.depthParts || []) l.traverse((o) => o.isMesh && g1.push(o.geometry));
  for (const l of m.userData.depthParts || []) l.traverse((o) => o.isMesh && g2.push(o.geometry));
  ok(`${id}: ...and shares its part geometry (no copies per aeroplane)`, g1.length === g2.length && g1.every((g, i) => g === g2[i]));
}

/* ---- a parked aeroplane's bake ------------------------------------------- */
{
  const K = await imp('world/airport-kit.js');
  const tris = (b) => b.parts.reduce((n, p) => n + (p.geometry.index ? p.geometry.index.count : p.geometry.attributes.position.count) / 3, 0);
  for (const id of ['meridian', 'skylark', 'c17'].filter((k) => dressed[k])) {
    const type = T.getAircraft(id);
    const bare = A.createAircraftModel({ type });
    const worn = A.createAircraftModel({ type });
    D.deepen(worn, type);
    const a = tris(K.bakeModel(worn));
    const b = tris(K.bakeModel(bare));
    ok(`${id}: a parked bake (the apron's) is the airframe alone, no parts at every distance`, a === b && (worn.userData.depthParts || []).length > 0, `${a} dressed, ${b} bare`);
  }
}

/* ---- 5. the break-up ------------------------------------------------------ */
for (const id of ['meridian', 'vanguard', 'skylark', 'c17', 'bell407'].filter((k) => dressed[k])) {
  const { type, m } = dressed[id];
  const config = m.userData.fleetBridge ? m.userData.config : null;
  const before = new Map();
  m.traverse((o) => {
    if (o.isMesh) before.set(o, o.geometry);
  });
  // the parts as a camera close by would show them (LOD), then a red lens out on the left wing tip, if it has one
  m.updateMatrixWorld(true);
  const eye = new THREE.PerspectiveCamera();
  eye.position.set(0, 3, 12);
  eye.updateMatrixWorld(true);
  for (const l of m.userData.depthParts || []) l.update(eye);
  const span = outline(m).getSize(new THREE.Vector3()).x;
  let leftLens = 0;
  m.traverse((o) => {
    if (o.isMesh && o.material && o.material.name === 'depth red') {
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
      if (c.x < -span * 0.35) leftLens++;
    }
  });
  const survey = BM.surveyModel(m);
  const layout = B.layoutFor(B.refineFrame(B.frameFor(type, config), survey));
  const asg = BM.classifyModel(survey, layout);
  const which = layout.family === 'rotor' ? [['rotor'], ['tailRotor']] : [['wingOuterL'], ['fin']];
  let pieces = [];
  let threw = null;
  try {
    pieces = BM.breakZones(asg, which, { rotorBlades: 4 });
  } catch (e) {
    threw = e;
  }
  ok(`${id}: the dressed model still breaks (${which.flat().join(', ')})`, !threw && pieces.length >= 2, threw ? String(threw) : pieces.map((p) => `${p.zones.join('+')}:${p.tris}`).join(' '));
  if (layout.family !== 'rotor' && leftLens) {
    // the left wing's red lens goes with the left outer wing
    let red = 0;
    for (const p of pieces) if (p.zones.includes('wingOuterL')) p.group.traverse((o) => o.isMesh && o.material && o.material.name === 'depth red' && red++);
    ok(`${id}: the left wing tip's lens leaves with the left outer wing`, red > 0);
  }
  BM.restoreModel(m);
  let wrong = 0;
  for (const [o, g] of before) if (o.geometry !== g) wrong++;
  ok(`${id}: restoring after the break puts every mesh back, parts too`, !wrong && !BM.isBroken(m), `${wrong} wrong`);
  for (const p of pieces) BM.disposePiece(p.group);
}

/* ---- 6. the shader -------------------------------------------------------- */
{
  const { m } = dressed.skylark || Object.values(dressed)[0];
  let mat = null;
  m.traverse((o) => {
    if (!mat && o.isMesh && o.geometry.attributes.depthAO) mat = [].concat(o.material).find((x) => x.userData.depthAO);
  });
  ok('shader: the airframe material is patched once, with its own program key', !!mat && /\|depthAO$/.test(mat.customProgramCacheKey()));
  const sh = {
    vertexShader: '#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main() {\n#include <aomap_fragment>\n}',
  };
  mat.onBeforeCompile(sh, null);
  ok('shader: the vertex stage reads the flagged attribute (a mesh without it reads 0 or 1 there: no shade)',
    /attribute vec2 depthAO/.test(sh.vertexShader) && /abs\(depthAO\.y - 0\.5\) < 0\.25 \? depthAO\.x : 0\.0/.test(sh.vertexShader));
  ok('shader: shade on the ambient and part of the sun, after three.js\'s own AO', /#include <aomap_fragment>[\s\S]*indirectDiffuse \*= depthK[\s\S]*directDiffuse \*= mix\(1\.0, depthL, 0\.7\)/.test(sh.fragmentShader));
}

/* ---- 7. the gate ---------------------------------------------------------- */
{
  const setNav = (nav) => Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
  const keepNav = globalThis.navigator;
  globalThis.window = globalThis.window || {};
  const sky = T.getAircraft('skylark');
  const tick = () => new Promise((r) => setTimeout(r, 30));
  const desk = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/130', maxTouchPoints: 0, hardwareConcurrency: 8 };
  for (const [label, nav, q, want] of [
    ['an iPad', { userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)', maxTouchPoints: 5, hardwareConcurrency: 6 }, 'high', false],
    ['an iPad that says it is a Mac', { ...desk, maxTouchPoints: 5 }, 'high', false],
    ['a Chromebook', { userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) Chrome/130', maxTouchPoints: 0, hardwareConcurrency: 8 }, 'high', false],
    ['a four-core laptop', { ...desk, hardwareConcurrency: 4 }, 'high', false],
    ['a desktop on Low', desk, 'low', false],
    ['node (the tests: a window stub, Node.js navigator)', { userAgent: 'Node.js/26', maxTouchPoints: 0, hardwareConcurrency: 12 }, 'high', false],
    ['a desktop on Medium', desk, 'medium', true],
  ]) {
    setNav(nav);
    Q.setModelQuality(q);
    const m = A.createAircraftModel({ type: sky });
    await tick();
    await tick();
    ok(`gate: ${label} ${want ? 'is' : 'is not'} dressed`, !!m.userData.depth === want);
  }
  Q.setModelQuality('high');
  delete globalThis.window;
  setNav(keepNav);
}

console.log(`\n${pass} passed, ${fail} failed (${((performance.now() - t0All) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);

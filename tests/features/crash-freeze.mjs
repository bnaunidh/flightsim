/**
 * Node checks for the crash FREEZE fix (the owner, 2026-10-17: "everytime i
 * crash on any device theres a huge freeze"). Run with plain node:
 *
 *   node tests/features/crash-freeze.mjs
 *
 * What froze, and what guards it now:
 *
 *   1. THE LIGHT COUNT. wreck.js's firelight used to hang on the wreck group,
 *      which is hidden until a crash: showing it added a point light to the
 *      scene, and three.js recompiled every lit shader in the world (144
 *      materials) on the crash frame. The light now lives on the scene itself
 *      at zero intensity, so what the renderer can see (traverseVisible) has
 *      the same lights whole as wrecked.
 *   2. THE SURVEY, STEPWISE. classifyModelSteps() is classifyModel() one mesh
 *      at a time, so features/breakup.js can build the player's zone survey a
 *      few milliseconds a frame while they fly. It must give the SAME record:
 *      every zone's triangle count, every box, every per-triangle zone array.
 *   3. THE CACHE'S KEY. The survey bakes the gear and flap meshes where they
 *      are, so the cache is keyed on them and waits for the gear to settle.
 *
 * The real crash frame, in the running game, is tests/features/crash-freeze.browser.js.
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
const TER = await imp('world/terrain.js');
const A = await imp('aircraft/model-adapter.js');
const B = await imp('game/breakup.js');
const BM = await imp('game/breakup-mesh.js');
const W = await imp('game/wreck.js');
const F = await imp('features/breakup.js');
TER.applyMap(TER.MAP.id);

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}

/* ---- 1. the wreck's light is in the scene whole or wrecked ---------------- */
{
  const scene = new THREE.Scene();
  scene.add(new THREE.DirectionalLight(0xffffff, 1));
  const wreck = new W.Wreck(scene);
  const seen = () => {
    const out = [];
    scene.traverseVisible((o) => {
      if (o.isLight) out.push(o.type);
    });
    return out;
  };
  const whole = seen();
  ok('wreck: the firelight is a child of the scene, not of the hidden wreck group', wreck.light.parent === scene && wreck.light.parent !== wreck.group, `parent ${wreck.light.parent && wreck.light.parent.type}`);
  ok('wreck: before any crash the renderer can see the firelight (at zero intensity, out of the way)', whole.includes('PointLight') && wreck.light.intensity === 0 && wreck.light.position.y < -1000 && !wreck.group.visible, `${whole.join(',')} · ${wreck.light.intensity} · y ${wreck.light.position.y}`);
  wreck.start(new THREE.Vector3(100, 20, 100), new THREE.Vector3(40, -10, 0), false);
  wreck.update(1 / 60);
  const wrecked = seen();
  ok('wreck: a crash lights it (and moves it to the wreck) without adding a light the shaders were not compiled for', wrecked.length === whole.length && wrecked.filter((t) => t === 'PointLight').length === 1 && wreck.light.intensity > 0 && wreck.light.position.distanceTo(new THREE.Vector3(100, 24, 100)) < 0.01, `${whole.length} -> ${wrecked.length} lights, intensity ${wreck.light.intensity.toFixed(0)}`);
  wreck.clear();
  ok('wreck: clear() puts it out and keeps it in the scene', wreck.light.intensity === 0 && wreck.light.parent === scene && seen().length === whole.length, '');
  ok('wreck: warm() exists for the shaders, and is harmless without a renderer', typeof wreck.warm === 'function' && wreck.warm(null, null) === false && !wreck.group.visible, '');
}

/* ---- 2. the stepwise survey is the whole survey ------------------------------ */
{
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  let worstYields = 0;
  let allSame = true;
  const notes = [];
  for (const t of T.AIRCRAFT) {
    const model = A.createAircraftModel({ type: t });
    const config = model.userData.fleetBridge ? model.userData.config : null;
    const survey = BM.surveyModel(model);
    const layout = B.layoutFor(B.refineFrame(B.frameFor(t, config), survey));
    const whole = BM.classifyModel(survey, layout);
    // The same survey again (classify does not touch it), one step at a time.
    const steps = BM.classifyModelSteps(survey, layout);
    let yields = 0;
    let r = steps.next();
    while (!r.done) {
      yields++;
      r = steps.next();
    }
    const stepped = r.value;
    worstYields = Math.max(worstYields, yields);
    const countsSame = JSON.stringify(whole.counts) === JSON.stringify(stepped.counts);
    const boxesSame = JSON.stringify(whole.boxes) === JSON.stringify(stepped.boxes);
    const zonesSame = whole.items.length === stepped.items.length && whole.items.every((it, i) => it.e.obj === stepped.items[i].e.obj && same(it.zone, stepped.items[i].zone));
    if (!(countsSame && boxesSame && zonesSame)) {
      allSame = false;
      notes.push(`${t.id}: counts ${countsSame} boxes ${boxesSame} zones ${zonesSame}`);
    } else notes.push(`${t.id} ${yields} steps`);
  }
  ok('survey: classifyModelSteps gives classifyModel\'s record exactly, for every aircraft (counts, boxes, every triangle\'s zone)', allSame, notes.join(' · '));
  ok('survey: it yields between meshes, so a frame can stop after any one of them', worstYields >= 4, `${worstYields} steps on the biggest`);
}

/* ---- 3. the cache's key and budget ---------------------------------------------- */
{
  ok('cache: the background survey has a per-frame budget of a few milliseconds', F.ZONE_CACHE && F.ZONE_CACHE.budgetMs >= 1 && F.ZONE_CACHE.budgetMs <= 6, JSON.stringify(F.ZONE_CACHE));
  const D = F.breakupDebug();
  ok('cache: the feature reports its cache and can finish it on demand (for the browser checks)', D.zoneCache && typeof D.precompute === 'function' && typeof D.clearZoneCache === 'function' && D.zoneCache.hits === 0 && D.zoneCache.misses === 0, JSON.stringify(D.zoneCache));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

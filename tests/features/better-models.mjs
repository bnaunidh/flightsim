/**
 * Better cars, people and buildings, in node: the shapes themselves.
 *
 *   node tests/features/better-models.mjs [--quiet]
 *
 *   CARS      every better kind builds, fits its own box (cars.js KINDS), stands on its wheels,
 *             is cheaper than the downloaded model it replaces, and knows paint from trim;
 *             a layer that is not asked for them (Low) builds the old boxes, as it did
 *   PEOPLE    Low's figure is the triangle it was; Medium and up have a skirt, a jacket and
 *             a hat's brim to wear; some of a crowd wear them, nobody on Low does
 *   BUILDINGS a town's blocks get shopfronts, awnings and (High and up) balconies inside a
 *             budget, in two meshes under a LOD that lets go of them; nothing at Low; the
 *             streamed flats keep Low's and Medium's shape and gain balconies when rich
 */
globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const src = new URL('../../src/', import.meta.url).href;
const THREE = await import(src + 'vendor/three.module.js');
const CARS = await import(src + 'features/ambient/cars.js');
const CM = await import(src + 'features/ambient/car-models.js');
const PPL = await import(src + 'features/life/people.js');
const TD = await import(src + 'world/town-dress.js');
const TS = await import(src + 'world/worldmap/town-stream.js');
const TG = await import(src + 'world/worldmap/town-grid.js');

const quiet = process.argv.includes('--quiet');
let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fail++;
  if (!cond || !quiet) console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ' -- ' + detail : ''}`);
};
const tris = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;

/* ---- cars ---- */
{
  const bad = [];
  const counts = [];
  for (const k of CM.BETTER_KINDS) {
    const d = CARS.KINDS[k];
    const g = CM.betterCarGeometry(k, d);
    if (!g) { bad.push(`${k}: none`); continue; }
    g.computeBoundingBox();
    const b = g.boundingBox;
    const n = tris(g);
    counts.push(`${k} ${n}`);
    // Inside its box: a mirror or a bumper may stand a hand's width proud, a spare wheel 0.2 m.
    if (b.min.x < -d.W / 2 - 0.16 || b.max.x > d.W / 2 + 0.16) bad.push(`${k}: ${(b.max.x - b.min.x).toFixed(2)} wide for ${d.W}`);
    if (b.min.z < -d.L / 2 - 0.1 || b.max.z > d.L / 2 + 0.2) bad.push(`${k}: ${(b.max.z - b.min.z).toFixed(2)} long for ${d.L}`);
    if (b.max.y > d.H + 0.15 || b.max.y < d.H - 0.35) bad.push(`${k}: ${b.max.y.toFixed(2)} high for ${d.H}`);
    if (Math.abs(b.min.y) > 0.02) bad.push(`${k}: wheels at ${b.min.y.toFixed(3)}`);
    if (n > 700 || n < 250) bad.push(`${k}: ${n} triangles`);
    const fx = g.attributes.aFixed;
    const col = g.attributes.color;
    const nrm = g.attributes.normal;
    if (!fx || !col || !nrm) { bad.push(`${k}: attributes`); continue; }
    let paint = 0;
    let unit = true;
    let whitePaint = true;
    for (let i = 0; i < fx.count; i++) {
      if (fx.getX(i) < 0.5) {
        paint++;
        if (col.getX(i) < 0.99 || col.getY(i) < 0.99 || col.getZ(i) < 0.99) whitePaint = false;
      }
      if (Math.abs(Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) - 1) > 1e-3) unit = false;
    }
    const share = paint / fx.count;
    if (share < 0.05 || share > 0.7) bad.push(`${k}: ${(share * 100).toFixed(0)}% paint`);
    if (!unit) bad.push(`${k}: a normal that is not one long`);
    if (!whitePaint) bad.push(`${k}: paint that is not white (the instance colours it)`);
  }
  ok('cars: every better kind builds, fits its box, stands on its wheels, 250-700 triangles', bad.length === 0, bad.length ? bad.join('; ') : counts.join(', '));
  ok('cars: an estate and an SUV are kinds of their own, with a box', !!CARS.KINDS.estate && !!CARS.KINDS.suv && CARS.KINDS.estate.vary && CARS.KINDS.suv.vary);
  ok('cars: a tractor and a fire engine keep their own shapes', CM.betterCarGeometry('tractor', CARS.KINDS.tractor) === null && CM.betterCarGeometry('firetruck', CARS.KINDS.firetruck) === null);

  // A layer: one lane, a few cars. Asked for nothing (Low): the boxes it always built. Asked for better: these.
  const lane = { kind: 'street', len: 400, n: 2, xs: [0, 400], zs: [0, 0], ys: [0, 0], cum: [0, 400], junctions: [], stops: [], poly: 0, next: [], oneWay: false };
  const net = { lanes: [lane], signals: [], polylines: [{ pts: [[0, 0], [400, 0]], hw: 6, kind: 'street' }] };
  const build = (opts) => {
    const group = new THREE.Group();
    const layer = new CARS.CarLayer(group, net, opts);
    for (let i = 0; i < 30; i++) layer.cars.push(layer.record('car', opts.variety ? layer.pick(i / 30) : 'car', false));
    layer.cars.push(layer.record('van', 'van', false), layer.record('bus', 'bus', false));
    layer.build();
    return { layer, meshes: group.children.filter((m) => m.isInstancedMesh && /^ambient-/.test(m.name) && m.name !== 'ambient-car-proxy') };
  };
  const low = build({ variety: false });
  const lowOld = low.meshes.every((m) => !m.userData.better && !m.geometry.attributes.aFixed);
  const want = tris(CARS.carShape('car', CARS.KINDS.car.colour));
  ok('cars: at Low the layer builds the boxes it always did (three meshes: car, van, bus)', lowOld && low.meshes.length === 3 && tris(low.meshes.find((m) => m.name === 'ambient-car').geometry) === want && !low.layer.mat.onBeforeCompile.toString().includes('aFixed'), `${low.meshes.map((m) => `${m.name} ${tris(m.geometry)}`).join(', ')}`);
  const med = build({ variety: true, better: true });
  ok('cars: at Medium the same number of meshes as before (saloon, hatchback, pick-up, van, bus), all better', med.meshes.length === 5 && med.meshes.every((m) => m.userData.better && m.geometry.attributes.aFixed), med.meshes.map((m) => m.name).join(' '));
  const high = build({ variety: true, better: true, rich: true });
  ok('cars: at High an estate and an SUV among them (two more meshes)', high.meshes.length === 7 && ['estate', 'suv'].every((k) => high.meshes.some((m) => m.name === `ambient-${k}`)), high.meshes.map((m) => m.name).join(' '));
  const tints = new Set(high.layer.cars.map((c) => c.tint));
  ok('cars: a dozen paints or so on thirty cars, white, silver and black among them', tints.size >= 8, `${tints.size} colours`);
  // The paint patch: a vertex with aFixed keeps its own colour.
  const sh = { vertexShader: '#include <common>\n#include <color_vertex>', fragmentShader: '' };
  med.layer.mat.onBeforeCompile(sh);
  ok('cars: the material keeps a fixed vertex its own colour (and paints the rest)', /attribute float aFixed/.test(sh.vertexShader) && /mix\(vColor\.xyz, color\.rgb, aFixed\)/.test(sh.vertexShader));
}

/* ---- people ---- */
{
  const g0 = PPL.figureGeometry(0);
  const g1 = PPL.figureGeometry(1);
  const g2 = PPL.figureGeometry(2);
  const parts = (g) => {
    const s = new Set();
    for (let i = 0; i < g.attributes.aRig.count; i++) s.add(g.attributes.aRig.getX(i));
    return s;
  };
  ok('people: Low\'s figure is the 734 triangles it was, with no street clothes in it', tris(g0) === 734 && ![PPL.PART.skirt, PPL.PART.jacket, PPL.PART.brim].some((p) => parts(g0).has(p)), `${tris(g0)} triangles`);
  ok('people: Medium\'s and High\'s have a skirt, a jacket and a brim, for under 200 triangles more', [g1, g2].every((g) => [PPL.PART.skirt, PPL.PART.jacket, PPL.PART.brim].every((p) => parts(g).has(p))) && tris(g1) <= 1318 + 200 && tris(g2) < 2400, `${tris(g1)} and ${tris(g2)} triangles`);
  const rnd = () => {
    rnd.s = (rnd.s * 1664525 + 1013904223) >>> 0;
    return rnd.s / 4294967296;
  };
  rnd.s = 7;
  const crowd = new PPL.Crowd(200, { rnd });
  const W = PPL.WEAR;
  const n = (bit) => crowd.looks.filter((l) => l.wear & bit).length;
  ok('people: in a crowd of 200, jackets, skirts, dresses, sun hats and woolly hats', n(W.jacket) > 30 && n(W.skirt) > 12 && n(W.dress) > 3 && n(W.brim) > 3 && n(W.beanie) > 3, `${n(W.jacket)} jackets, ${n(W.skirt)} skirts (${n(W.dress)} dresses), ${n(W.brim)} sun hats, ${n(W.beanie)} woolly hats`);
  ok('people: a skirt goes with bare legs, never with shorts; nobody wears two hats', crowd.looks.every((l) => !(l.wear & W.skirt) || (l.trousers === l.skin && !(l.wear & W.shorts))) && crowd.looks.every((l) => ((l.wear & W.hat) ? 1 : 0) + ((l.wear & W.brim) ? 1 : 0) + ((l.wear & W.beanie) ? 1 : 0) <= 1));
  ok('people: builds from slight to broad', Math.min(...crowd.looks.map((l) => l.build)) < 0.96 && Math.max(...crowd.looks.map((l) => l.build)) > 1.08 && crowd.looks.every((l) => l.build > 0.9 && l.build < 1.13));
  rnd.s = 7;
  const lowCrowd = new PPL.Crowd(200, { rnd, simple: true });
  ok('people: on Low nobody is given any of it', lowCrowd.looks.every((l) => !(l.wear & (W.skirt | W.jacket | W.brim | W.beanie | W.dress)) && l.build === 1));
  rnd.s = 7;
  const again = new PPL.Crowd(200, { rnd });
  const used = rnd.s;
  rnd.s = 7;
  new PPL.Crowd(200, { rnd, simple: true });
  ok('people: dressing them asks the shared random numbers for no more than it did', used === rnd.s && again.looks.every((l, i) => l.wear === crowd.looks[i].wear));
  // The uniformed staff are dressed by their outfit, not by any of this.
  crowd.dress(0, { look: 3, outfit: 2, bag: false });
  ok('people: a pilot is still in a white shirt and a cap, whatever the person under it wears', crowd.look4.array[1] === W.hat);
  crowd.dispose();
  lowCrowd.dispose();
  again.dispose();
}

/* ---- buildings ---- */
{
  // A street of blocks along x, fronts to +z, on level ground.
  const plan = [];
  for (let i = 0; i < 40; i++) plan.push({ s: { x: i * 30, y: 10, z: 0, rot: 0, front: 1 }, kind: 'block', w: 21, d: 14, h: 13 + (i % 5) * 6.6 });
  plan.push({ s: { x: -40, y: 10, z: 0, rot: 0, front: 1 }, kind: 'house', w: 9, d: 8, h: 6 });
  const top = (b) => b.s.y + b.h;
  const run = (quality, ground = () => 10) => {
    const group = new THREE.Group();
    const nightMats = [{ emissiveIntensity: 1.15 }];
    return { group, nightMats, f: TD.dressBlocks(group, plan, { quality, top, nightMats, ground }) };
  };
  const low = run('low');
  ok('buildings: nothing is added at Low', low.group.children.length === 0 && low.f.triangles === 0 && low.nightMats.length === 1);
  const med = run('medium');
  const high = run('high');
  const ultra = run('ultra');
  ok('buildings: at Medium shopfronts and awnings, no balconies', med.f.shops > 40 && med.f.awnings > 10 && med.f.balconies === 0, JSON.stringify({ ...med.f, lod: undefined }));
  ok('buildings: at High balconies too, ten a block at the most', high.f.balconies > 30 && high.f.balconies <= 40 * TD.BALCONY_CAP[2] && ultra.f.balconies >= high.f.balconies, `${high.f.balconies} at High, ${ultra.f.balconies} at Ultra`);
  ok('buildings: forty blocks dressed for under 16,000 triangles at High (400 a block), 8,000 at Medium', high.f.triangles < 16000 && med.f.triangles < 8000 && ultra.f.triangles < 22000, `${med.f.triangles} / ${high.f.triangles} / ${ultra.f.triangles}`);
  const lod = high.f.lod;
  const inner = lod.levels[0].object;
  ok('buildings: two meshes (the painted, the lit glass) under a LOD that drops them past the town', lod.isLOD && high.group.children.length === 1 && inner.children.length === 2 && lod.levels.length === 2 && lod.levels[1].object.children.length === 0 && lod.levels[1].distance > TD.DRESS_FAR && lod.levels[1].distance < TD.DRESS_FAR + 700, `gone at ${Math.round(lod.levels[1].distance)} m`);
  ok('buildings: none of it casts a shadow (no second pass)', inner.children.every((m) => m.castShadow === false));
  const glass = inner.children.find((m) => /shop-glass/.test(m.name));
  ok('buildings: the shop windows light with the town\'s other windows, from the moment they arrive', high.nightMats.length === 2 && high.nightMats[1] === glass.material && glass.material.emissiveIntensity === 1.15);
  // Everything stands on the front wall or out over the pavement in front of it, between the pavement and the roof.
  inner.updateMatrixWorld(true);
  lod.updateMatrixWorld(true);
  let outside = 0;
  for (const m of inner.children) {
    const p = m.geometry.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
      if (v.y < 9.9 || v.y > 10 + 40 || v.z < -7.2 || v.z > 7 + 1.4 || v.x < -11 || v.x > 39 * 30 + 11) outside++;
    }
  }
  ok('buildings: every piece is on its block: the pavement to the roof, no further out than an awning', outside === 0, `${outside} vertices outside`);
  // On a slope the shops are left off (no shopfront half in the ground).
  const slope = run('high', (x) => 10 + (x % 30) * 0.2);
  ok('buildings: no shopfronts where the pavement runs up or down the front', slope.f.shops < high.f.shops * 0.2, `${slope.f.shops} on the slope, ${high.f.shops} on the level`);

  // The streamed towns' flats: as they were unless rich.
  const plain = TS.townGeometry(TG.KIND.FLATS, false);
  const rich = TS.townGeometry(TG.KIND.FLATS, true);
  ok('buildings: the streamed flats are the ten triangles they were at Low and Medium; rich, balconies and a roof', tris(plain) === 10 && tris(rich) > 80 && tris(rich) < 200, `${tris(plain)} plain, ${tris(rich)} rich`);
  ok('buildings: the streamed shop at Low and Medium as it was', tris(TS.townGeometry(TG.KIND.SHOP, false)) === 10 && tris(TS.townGeometry(TG.KIND.SHOP, true)) < 40);
}

console.log(`${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);

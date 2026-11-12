/**
 * No trees standing in the World Map's lakes or rivers (owner, 2026-11-11: "i love my trees in
 * the water" -- a lake on the farmland full of them). worldmap/flora.js placeCell rejects any
 * spot inside a lake's shore (its wobble and a margin) or within a river's width + 12 m.
 *
 *   node tests/features/worldmap-water-trees.mjs
 */
const T = await import('../../src/world/terrain.js');
const PV = await import('../../src/world/worldmap/preview.js');
const M = await import('../../src/world/maps.js');
const FL = await import('../../src/world/worldmap/flora.js');
let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const D = PV.PREVIEW;
PV.setDeparture('haven');
const def = PV.previewDef();
M.registerExtraMap(def);
T.applyMap(def);
const ctx = FL.floraContext(D);
const noWater = { ...ctx, lakes: [], rivers: [] };
ok('the context carries every lake and river', ctx.lakes.length === (D.lakes || []).length && ctx.rivers.length === (D.rivers || []).length, `${ctx.lakes.length} lakes, ${ctx.rivers.length} rivers`);
const wet = (x, z) => FL.inWater(x, z, ctx.lakes, ctx.rivers);
const inLake = (x, z) => ctx.lakes.some((l) => Math.hypot(x - l.x, z - l.z) < l.r * 0.95);
let before = 0;
let after = 0;
let afterWet = 0;
let trees = 0;
const cells = new Set();
for (const l of ctx.lakes) {
  for (let ix = Math.floor((l.x - l.r * 1.2) / FL.CELL); ix <= Math.floor((l.x + l.r * 1.2) / FL.CELL); ix++) {
    for (let iz = Math.floor((l.z - l.r * 1.2) / FL.CELL); iz <= Math.floor((l.z + l.r * 1.2) / FL.CELL); iz++) cells.add(`${ix},${iz}`);
  }
}
for (const key of cells) {
  const [ix, iz] = key.split(',').map(Number);
  for (const [c, add] of [[noWater, (x, z) => { if (inLake(x, z)) before++; }], [ctx, (x, z) => { trees++; if (inLake(x, z)) after++; if (wet(x, z)) afterWet++; }]]) {
    const t = FL.placeCell(T, c, ix, iz, 400) || [];
    for (let k = 0; k < t.length; k += 6) add(t[k], t[k + 2]);
  }
}
ok('before the fix, trees stood in the lakes (the bug this guards)', before > 0, `${before} in lakes`);
ok('now: not one tree in a lake', after === 0, `${after} of ${trees} trees round the lakes`);
ok('now: not one tree within a lake\'s shore or a river\'s width (+ margin)', afterWet === 0, `${afterWet}`);
ok('the woods round the lakes are still there', trees > 100, `${trees} trees in ${cells.size} cells`);
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

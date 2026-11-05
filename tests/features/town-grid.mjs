/**
 * The World Map's towns (owner, 2026-11-04: "SIR ARE THESE HOUSES??"): one street
 * plan for the paint and the buildings. In node, from the repo root:
 *
 *   node tests/features/town-grid.mjs
 *
 *   - the plan's arithmetic: the grid and its inverse, the shader's hash
 *   - every town has 3D coverage matching its painted area, right out to the suburbs
 *   - no building stands on a street, a road, a runway, an approach lane or a helipad
 *   - each lot is planted exactly once, whichever cell asks, and Low plants real
 *     houses too
 *   - the obstacle boxes cover the buildings, and fit their cell's buildings' count
 *   - the planner's downtown has the towers the town asks for, and every map's
 *     towers (world/skyline.js) have what the owner asked for: no plain tall boxes
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');

globalThis.window ??= undefined;
const T = await import('../../src/world/terrain.js');
const P = await import('../../src/world/worldmap/preview.js');
const G = await import('../../src/world/worldmap/town-grid.js');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

const def = P.previewDef();
T.applyMap(def);
const D = P.PREVIEW;
const ctx = G.townContext(D, T.FLATS, def.waters.roads);
const { GRID, KIND } = G;

/* ---- the arithmetic ---- */
ok('every town has a frame', ctx.towns.length === D.towns.length, `${ctx.towns.length} of ${D.towns.length}`);
{
  let worst = 0;
  for (const F of ctx.towns) {
    for (let i = 0; i < 40; i++) {
      const x = F.cx + (i - 20) * 37;
      const z = F.cz + (20 - i) * 23;
      const [u, v] = G.toGrid(F, x, z);
      const [bx, bz] = G.fromGrid(F, u, v);
      worst = Math.max(worst, Math.hypot(bx - x, bz - z));
    }
  }
  ok('the street coordinates turn back into the world to a millimetre', worst < 0.001, `worst ${worst.toFixed(5)} m`);
}
ok('the hash matches its 32-bit form', G.tuh(1, 2, 3) === G.tuh(1, 2, 3) && G.tuh(-5, 7, 2) >>> 0 === G.tuh(-5, 7, 2) && G.tuh(1, 2, 3) !== G.tuh(2, 1, 3), `tuh(1,2,3) = ${G.tuh(1, 2, 3)}`);
{
  // The shader's hash, read as text: the same constants in the same order.
  const glsl = G.GLSL_TOWN;
  ok('the shader is written from the same plan (hash constants, spacing, bend)', /0x9E3779B1u/.test(glsl) && /0x85EBCA77u/.test(glsl) && /0xC2B2AE3Du/.test(glsl) && /0x2C1B3C6Du/.test(glsl) && glsl.includes(`TPU = ${GRID.PU}`) && glsl.includes(`TPV = ${GRID.PV}`));
  const terrain = src('src/world/worldmap/world-terrain.js');
  ok('the paint has no plan of its own: it asks town-grid.js (no copy of the old district grid)', /townQ\(wp, vTownCS\)/.test(terrain) && !/floor\(wp \/ 3000\.0\)/.test(terrain));
}

/* ---- planted, everywhere the paint says ---- */
const high = G.TOWN_TIERS.high;
const all = [];
const perCell = new Map();
for (const key of G.townCells(ctx)) {
  const [ix, iz] = key.split(':').map(Number);
  const c = G.placeTownCell(T, ctx, ix, iz, high);
  perCell.set(key, c);
  if (!c) continue;
  c.kinds.forEach((k, kind) => {
    for (let i = 0; i < k.n; i++) {
      const m = k.m;
      const o = i * 16;
      all.push({
        kind, ix, iz,
        x: m[o + 12] + ix * G.TOWN_CELL, y: m[o + 13], z: m[o + 14] + iz * G.TOWN_CELL,
        w: Math.hypot(m[o], m[o + 2]), h: Math.hypot(m[o + 4], m[o + 5], m[o + 6]), d: Math.hypot(m[o + 8], m[o + 10]),
        rot: Math.atan2(m[o + 8], m[o + 10]),
      });
    }
  });
}
const buildings = all.filter((b) => b.kind <= KIND.GARAGE);
const houses = all.filter((b) => b.kind <= KIND.PORCH);
ok('a real number of houses: thousands across the towns', houses.length > 3500, `${houses.length} houses, ${buildings.length} buildings`);
ok('three or more house types, and shops and flats among them', [KIND.GABLE, KIND.HIP, KIND.ELL, KIND.PORCH, KIND.SHOP, KIND.FLATS].every((k) => all.some((b) => b.kind === k)));

/* Coverage: sample the painted roofs' ground (urbanAt over the paint's cut) and find real buildings near them. */
for (const F of ctx.towns) {
  let painted = 0;
  let covered = 0;
  const near = buildings.filter((b) => Math.abs(b.x - F.cx) < F.hx * 1.2 && Math.abs(b.z - F.cz) < F.hz * 1.2);
  const grid = new Map();
  const K = (x, z) => Math.floor(x / 60) * 100003 + Math.floor(z / 60);
  for (const b of near) {
    if (!grid.has(K(b.x, b.z))) grid.set(K(b.x, b.z), []);
    grid.get(K(b.x, b.z)).push(b);
  }
  const hit = (x, z) => {
    for (let a = -1; a <= 1; a++) for (let c = -1; c <= 1; c++) if (grid.has(K(x + a * 60, z + c * 60))) return true;
    return false;
  };
  for (let x = F.cx - F.hx; x <= F.cx + F.hx; x += 40) {
    for (let z = F.cz - F.hz; z <= F.cz + F.hz; z += 40) {
      const f = T.flatAt(x, z);
      if (!f || f.kind !== 'town' || G.urbanAt(F, x, z) < 0.55 || G.zoneAt(F, x, z) < 0.3) continue;
      if (T.heightAt(x, z) < 1) continue;
      painted++;
      if (hit(x, z)) covered++;
    }
  }
  ok(`${F.name}: real buildings across the painted town`, painted === 0 || covered / painted > 0.8, `${covered} of ${painted} samples within a block of one`);
}

/* The furthest house from the middle: right out to the suburbs. */
{
  const A = ctx.towns.find((t) => t.name === 'Aldermere');
  const far = Math.max(...houses.filter((b) => Math.hypot(b.x - A.cx, b.z - A.cz) < 1400).map((b) => Math.hypot(b.x - A.cx, b.z - A.cz)));
  ok('Gateway\'s houses run right out to the town\'s edge', far > A.hx * 0.8, `${far.toFixed(0)} m from the middle, the level ground is ${A.hx} m`);
}

/* ---- nothing stands in the way of anything ---- */
function streetClear(F, b) {
  // Corners of the footprint, in street coordinates: outside the road reserve.
  const c = Math.cos(b.rot);
  const s = Math.sin(b.rot);
  for (const [a, e] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) {
    const px = b.x + c * a * b.w + s * e * b.d;
    const pz = b.z - s * a * b.w + c * e * b.d;
    const [U, V] = G.toGrid(F, px, pz);
    const i = Math.round(U / GRID.PU);
    const j = Math.round(V / GRID.PV);
    const hu = G.mainU(i) ? GRID.ROW_MAIN : GRID.ROW;
    const hv = G.mainV(j) ? GRID.ROW_MAIN : GRID.ROW;
    // (0.3 m of give: the bend shears a footprint by that much over its length.)
    if (Math.abs(U - i * GRID.PU) < hu - 0.5 || Math.abs(V - j * GRID.PV) < hv - 0.5) return false;
  }
  return true;
}
const frameOf = (b) => ctx.towns.find((F) => Math.abs(b.x - F.cx) < F.hx * 1.15 && Math.abs(b.z - F.cz) < F.hz * 1.15);
{
  const bad = [];
  for (const b of buildings) {
    const F = frameOf(b);
    if (!F) { bad.push(`no town at ${b.x.toFixed(0)},${b.z.toFixed(0)}`); continue; }
    if (b.kind === KIND.GARAGE) continue; // (it stands behind its house, well in from the kerb)
    if (!streetClear(F, b)) bad.push(`${F.name} kind ${b.kind} at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
  }
  ok('no building on a street', bad.length === 0, bad.slice(0, 4).join('; ') || `${buildings.length} checked`);
}
{
  const bad = [];
  const segs = [];
  for (const r of def.waters.roads) {
    for (let i = 1; i < r.path.length; i++) segs.push([r.path[i - 1][0], r.path[i - 1][1], r.path[i][0], r.path[i][1], G.roadClear(r.halfWidth || 8)]);
  }
  for (const b of buildings) {
    if (b.kind === KIND.GARAGE) continue;
    for (const s of segs) {
      const bx = s[2] - s[0];
      const bz = s[3] - s[1];
      if (Math.max(Math.abs(b.x - s[0]), Math.abs(b.z - s[1])) > 400) continue;
      const t = Math.max(0, Math.min(1, ((b.x - s[0]) * bx + (b.z - s[1]) * bz) / (bx * bx + bz * bz || 1)));
      if (Math.hypot(b.x - s[0] - bx * t, b.z - s[1] - bz * t) < s[4] + Math.min(b.w, b.d) / 2 - 0.5) {
        bad.push(`kind ${b.kind} at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
        break;
      }
    }
  }
  ok('no building on a road', bad.length === 0, bad.slice(0, 4).join('; ') || 'every road segment checked');
}
{
  const bad = [];
  for (const a of D.airports) {
    for (const b of all) {
      if (Math.abs(b.z - a.z) < 420 && Math.abs(b.x - a.x) < a.length / 2 + 3200) bad.push(`${a.code}: kind ${b.kind} at ${b.x.toFixed(0)},${b.z.toFixed(0)}`);
    }
  }
  ok('nothing in a runway\'s lanes (a runway\'s length plus 3.2 km each way, 420 m either side)', bad.length === 0, bad.slice(0, 4).join('; '));
  const flats = buildings.filter((b) => {
    const f = T.flatAt(b.x, b.z);
    return !f || f.kind !== 'town';
  });
  ok('every building on its town\'s level ground, none on a field\'s', flats.length === 0, flats.slice(0, 3).map((b) => `${b.x.toFixed(0)},${b.z.toFixed(0)}`).join('; '));
  const air = buildings.filter((b) => Math.abs(b.y - T.heightAt(b.x, b.z)) > 0.6);
  ok('every building on the ground under it', air.length === 0, air.slice(0, 3).map((b) => `${b.y.toFixed(1)} over ${T.heightAt(b.x, b.z).toFixed(1)}`).join('; '));
  const padsBad = [];
  for (const p of [...D.heliports, ...D.scenery.pads]) {
    if (p.kind === 'deck') continue;
    for (const b of buildings) if (Math.hypot(b.x - p.x, b.z - p.z) < (p.r || 11) + 8) padsBad.push(`${p.name}`);
  }
  ok('nothing on a helipad', padsBad.length === 0, padsBad.slice(0, 3).join('; '));
}

/* ---- each lot once ---- */
{
  const seen = new Set();
  let twice = 0;
  for (const b of buildings) {
    const k = `${b.kind}:${Math.round(b.x * 10)}:${Math.round(b.z * 10)}`;
    if (seen.has(k)) twice++;
    seen.add(k);
  }
  ok('no building planted twice across cell edges', twice === 0, `${twice} doubled`);
  const [ix, iz] = [...G.townCells(ctx)].find((k) => perCell.get(k) && perCell.get(k).kinds[0].n > 3).split(':').map(Number);
  const a = G.placeTownCell(T, ctx, ix, iz, high);
  const b = G.placeTownCell(T, ctx, ix, iz, high);
  ok('a cell comes out the same every time, in any order (the plan has no state)', a.kinds.every((k, i) => k.n === b.kinds[i].n && k.m.every((v, j) => v === b.kinds[i].m[j])));
  let overlaps = 0;
  const hs = buildings.filter((q) => q.kind <= KIND.FLATS).sort((p, q) => p.x - q.x);
  for (let i = 0; i < hs.length; i++) {
    for (let j = i + 1; j < hs.length && hs[j].x - hs[i].x < 30; j++) {
      const r = Math.min(hs[i].w, hs[i].d) / 2 + Math.min(hs[j].w, hs[j].d) / 2;
      if (Math.hypot(hs[i].x - hs[j].x, hs[i].z - hs[j].z) < r * 0.9) overlaps++;
    }
  }
  ok('no two buildings stand in each other', overlaps === 0, `${overlaps} of ${hs.length}`);
}

/* ---- Low still has real houses, and each tier's cells stay within the pool ---- */
{
  let low = 0;
  for (const key of G.townCells(ctx)) {
    const [ix, iz] = key.split(':').map(Number);
    const c = G.placeTownCell(T, ctx, ix, iz, G.TOWN_TIERS.low);
    if (c) low += c.kinds.slice(0, 4).reduce((s, k) => s + k.n, 0);
  }
  ok('Low has the same real houses (only the extras go)', low === houses.length && G.TOWN_TIERS.low.radius >= 900, `${low} houses, out to ${G.TOWN_TIERS.low.radius} m`);
}

/* ---- solid ---- */
{
  let boxes = 0;
  let inside = 0;
  let cell = null;
  for (const c of perCell.values()) {
    if (!c) continue;
    boxes += c.solid.length / 6;
    if (!cell && c.solid.length > 120) cell = c;
  }
  ok('solid boxes for the buildings', boxes >= buildings.length, `${boxes} boxes for ${buildings.length} buildings`);
  for (let i = 0; i < cell.solid.length; i += 6) {
    if (cell.solid[i] < cell.solid[i + 1] && cell.solid[i + 2] < cell.solid[i + 3] && cell.solid[i + 4] < cell.solid[i + 5]) inside++;
  }
  ok('every box is a real box', inside === cell.solid.length / 6);
}

/* ---- downtown ---- */
{
  const A = ctx.towns.find((t) => t.name === 'Aldermere');
  const spots = G.planDowntown(T, ctx, A, { want: 357, towers: 20, towerMaxH: A.towerMaxH });
  const towers = spots.filter((s) => s.kind === 'tower');
  ok('Gateway has its towers, tallest in the middle, and lower glass offices among the rest', towers.length >= 20 && towers[0].h > towers[19].h && Math.max(...towers.map((t) => t.h)) > 110, `${towers.length}, ${towers.map((t) => Math.round(t.h)).slice(0, 5).join(' ')}...`);
  ok('and a downtown round them', spots.length > 200, `${spots.length} buildings`);
  const low = G.planDowntown(T, ctx, A, { want: 189, towers: 11, towerMaxH: A.towerMaxH });
  ok('Low thins the whole downtown, not one side of it', low.length < spots.length && low.length > 100, `${low.length}`);
  let bad = 0;
  for (const s of spots) if (!streetClear(A, { ...s, rot: s.rot })) bad++;
  ok('none of it on a street', bad === 0, `${bad} of ${spots.length}`);
  const st = G.townStreets(A);
  ok('the cars have the main streets to drive on (features/ambient/lanes.js)', st.length >= 4 && st.every((q) => q.pts.length > 2 && q.painted), `${st.length} main streets`);
}

/* ---- towers: no plain tall boxes ---- */
{
  const sky = src('src/world/skyline.js');
  ok('a tower is podium, shaft and roof, in six forms, with mullions, spandrels and lit rooms', ['Setbacks', 'Corners cut', 'Two blades', 'Cut on a slant', 'The city\'s own', 'A drum'].every((w) => sky.includes(w)) && /skMull/.test(sky) && /skSpan/.test(sky) && /totalEmissiveRadiance/.test(sky));
  const sc = src('src/world/scenery.js');
  ok('every map\'s towers come from it (no box and crown left in addTown)', /addSkyline\(group,/.test(sc) && !/towerFacadeTexture/.test(sc));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

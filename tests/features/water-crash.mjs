/**
 * THE SLIDE AND THE SEA (the owner, 2026-11-05): a crash's speed carries into a
 * slide that depends on what it slides on, a hard arrival on the water slews
 * and digs in, the wreck goes under and down to a real sea bed. What can be
 * held without a page. tests/features/water-crash.browser.js holds the rest.
 *
 *   node tests/features/water-crash.mjs
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const imp = (p) => import(new URL(`../../src/${p}`, import.meta.url).href);

const THREE = await imp('vendor/three.module.js');
const SL = await imp('features/breakup/slide.js');
const BB = await imp('game/breakup-body.js');
const F = await imp('features/breakup.js');
const V = await imp('features/breakup/crash-view.js');
const TI = await imp('features/underwater/tint.js');
const SC = await imp('features/breakup/scars.js');

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  -- ${detail}` : ''}`);
};
const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));

/* ---- how far, on what ---- */
const LAND = ['concrete', 'grass', 'dirt', 'sand', 'snow', 'ice'];
for (const k of LAND) {
  ok(`slide: on ${k} a fast crash goes much further than a slow one`, SL.stopDistance(70, k) > SL.stopDistance(25, k) * 3, `${f1(SL.stopDistance(25, k))} m from 25 m/s, ${f1(SL.stopDistance(70, k))} m from 70`);
}
{
  const d = Object.fromEntries(LAND.map((k) => [k, SL.stopDistance(60, k)]));
  ok('slide: each surface feels different: ice, then concrete and snow, then grass, dirt, and sand stops it soonest', d.ice > d.concrete && d.ice > d.snow && d.concrete > d.grass && d.snow > d.grass && d.grass > d.dirt && d.dirt > d.sand, JSON.stringify(Object.fromEntries(LAND.map((k) => [k, Math.round(d[k])]))));
  ok('slide: a real sum of it: 60 m/s on grass stops in 150-300 m, on sand in under 110', d.grass > 150 && d.grass < 300 && d.sand < 110, `${f1(d.grass)}, ${f1(d.sand)}`);
}

/* ---- the same, on the rigid body itself ---- */
function slideOn(kind, speed) {
  const T = SL.SLIDE[kind];
  const env = {
    surface(x, z, o) {
      o.y = 0;
      o.nx = 0;
      o.ny = 1;
      o.nz = 0;
      o.kind = kind === 'concrete' ? 'paved' : 'ground';
      o.mu = T.mu;
      o.plough = T.plough;
      o.slide = kind;
      return o;
    },
  };
  const b = BB.makeBody({ position: new THREE.Vector3(0, 0.62, 0), velocity: new THREE.Vector3(speed, 0, 0), mass: 2000, size: new THREE.Vector3(10, 1.2, 8) });
  for (let t = 0; t < 60 && !b.sleeping; t += 1 / 30) BB.stepBody(b, 1 / 30, env);
  return b.pos.x;
}
for (const k of LAND) {
  const a = slideOn(k, 30);
  const b = slideOn(k, 65);
  ok(`body: on ${k} the body goes further the faster it was going`, b > a * 2, `${f1(a)} m from 30, ${f1(b)} m from 65`);
}
{
  const d = Object.fromEntries(LAND.map((k) => [k, slideOn(k, 60)]));
  ok('body: the surfaces come in the same order on the real body', d.ice > d.concrete && d.concrete > d.grass && d.grass > d.dirt && d.dirt > d.sand, JSON.stringify(Object.fromEntries(LAND.map((k) => [k, Math.round(d[k])]))));
  const want = SL.stopDistance(60, 'grass');
  ok('body: and stopDistance is what the body does, within a third', Math.abs(d.grass - want) / want < 0.34, `${f1(d.grass)} against ${f1(want)}`);
}

/* ---- what is under it ---- */
{
  const base = { deck: () => false, ice: () => false, made: () => null, paved: () => false, h: () => 80, rocky: () => false, snowLine: Infinity, snowCover: 0 };
  ok('kind: a runway is concrete, a deck is a deck, ice is ice', SL.slideKind(0, 0, { ...base, paved: () => true }) === 'concrete' && SL.slideKind(0, 0, { ...base, deck: () => true }) === 'deck' && SL.slideKind(0, 0, { ...base, ice: () => true, paved: () => true }) === 'ice');
  ok('kind: grass high up, sand by the sea, the sea under it', SL.slideKind(0, 0, base) === 'grass' && SL.slideKind(0, 0, { ...base, h: () => 4 }) === 'sand' && SL.slideKind(0, 0, { ...base, h: () => -3 }) === 'water');
  ok('kind: a gravel strip and a steep bank are dirt', SL.slideKind(0, 0, { ...base, made: () => 'gravel' }) === 'dirt' && SL.slideKind(0, 0, { ...base, rocky: () => true }) === 'dirt');
  ok('kind: above the map\'s snow line, or under lying snow, it is snow, runway and all', SL.slideKind(0, 0, { ...base, snowLine: 40 }) === 'snow' && SL.slideKind(0, 0, { ...base, snowCover: 0.9 }) === 'snow' && SL.slideKind(0, 0, { ...base, paved: () => true, snowCover: 0.9 }) === 'snow');
}

/* ---- the sea takes hold of it ---- */
const SEA = (floor) => ({
  surface(x, z, o) {
    o.y = 0;
    o.nx = 0;
    o.ny = 1;
    o.nz = 0;
    o.kind = 'water';
    o.floor = floor;
    return o;
  },
});
const hullPts = [];
for (const x of [-5, 5]) for (const y of [-0.6, 0.6]) for (const z of [-4, 4]) hullPts.push([x, y, z]);
{
  const go = (bank) => {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, bank));
    const b = BB.makeBody({ position: new THREE.Vector3(0, 0.5, 0), quaternion: q, velocity: new THREE.Vector3(0, -2, -60), mass: 1500, size: new THREE.Vector3(10, 1.2, 8), hull: hullPts, waterHull: true, noSkip: true, restitution: 0.1 });
    for (let i = 0; i < 90; i++) BB.stepBody(b, 1 / 60, SEA(-40));
    return b;
  };
  const level = go(0);
  const low = go(0.35);
  const yaw = (b) => Math.abs(new THREE.Euler().setFromQuaternion(b.quat, 'YXZ').y);
  ok('sea: wing low, the water holds that wing and the rest slews round it', yaw(low) > yaw(level) + 0.08, `${f1(yaw(low) * 57.3)} degrees against ${f1(yaw(level) * 57.3)}`);
  ok('sea: it loses most of its way in a second and a half', Math.hypot(level.vel.x, level.vel.z) < 42, `${f1(Math.hypot(level.vel.x, level.vel.z))} m/s left of 60`);
}
{
  const b = BB.makeBody({ position: new THREE.Vector3(0, -0.6, 0), velocity: new THREE.Vector3(0, -1, -40), mass: 1500, size: new THREE.Vector3(10, 1.2, 8), hull: hullPts, waterHull: true, noSkip: true });
  BB.stepBody(b, 1 / 30, SEA(-1.2));
  ok('shallows: arriving on a shallow bed at speed it drags along it, it does not stop dead', !b.sunk && b.vel.length() > 20, `${f1(b.vel.length())} m/s after a frame, sunk ${b.sunk}`);
  for (let i = 0; i < 900 && !b.sunk; i++) BB.stepBody(b, 1 / 30, SEA(-1.2));
  ok('shallows: and comes to rest on it, not through it', b.sunk && b.pos.y > -1.3, `y ${f1(b.pos.y)} over a -1.2 m bed`);
}
{
  const go = (deep) => {
    const b = BB.makeBody({ position: new THREE.Vector3(0, -1, 0), mass: 400, size: new THREE.Vector3(3, 1, 2), float: 1.2, floatT: 0.2, deep });
    for (let i = 0; i < 90 * 90 && !b.sunk; i++) BB.stepBody(b, 1 / 45, SEA(-30));
    return b;
  };
  const a = go(false);
  const b = go(true);
  ok('pieces: a piece left alone stops a couple of metres under, as it always did', a.sunk && a.pos.y > -6, `y ${f1(a.pos.y)}`);
  ok('pieces: one the sea is showing goes on down to the bed', b.sunk && b.pos.y < -25, `y ${f1(b.pos.y)}`);
}

/* ---- going under ---- */
for (const [name, L, top, draft, belly] of [['a trainer', 7.4, 1.6, 0.31, 0.6], ['an A320', 37.6, 11.8, 1.23, 2.24], ['an A380', 72.7, 24, 2.56, 4.65]]) {
  const k = { L, top, draft, belly, bot: -belly, floor: -34 };
  const P0 = { y: -draft, pitch: 0, roll: 0 };
  const d = { ...F.diveTimes(L, top), t: 0, v: 0, y: P0.y, pitch: 0, roll: 0, bed: false };
  let under = Infinity;
  let bedT = Infinity;
  let low = Infinity;
  let P = null;
  for (let t = 0; t < 40; t += 1 / 30) {
    P = F.diveStep(k, d, 1 / 30, -draft);
    if (under === Infinity && P.under) under = t;
    if (bedT === Infinity && d.bed) bedT = t;
    low = Math.min(low, P.y);
  }
  ok(`dive: ${name} is under inside 7 seconds`, under < 7, `${f1(under)} s`);
  ok(`dive: ${name} comes to rest on the bed, never through it`, d.bed && low >= k.floor, `lowest ${f1(low)}, bed ${k.floor}, there at ${f1(bedT)} s`);
}
{
  const k = { L: 37.6, top: 11.8, draft: 1.2, belly: 2.2, bot: -2.2, floor: -4 };
  const d = { ...F.diveTimes(k.L, k.top), t: 0, v: 0, y: -1.2, pitch: 0, roll: 0, bed: false };
  let P = null;
  for (let t = 0; t < 30; t += 1 / 30) P = F.diveStep(k, d, 1 / 30, -1.2);
  ok('dive: an airliner on a 4 m bed stays there with its top out: aground, not under', P.phase === 'aground' && !P.under, `${P.phase}, top at ${f1(P.y + P.highest)}`);
}
ok('dive: the slow sink nobody is waiting on is what it was', F.sinkTimes(7.4).total >= 20 && F.sinkTimes(72.7).total <= 60);
ok('card: a crash at sea is never more than 13 s from the hit to the card', 2.2 + V.VIEW.sinkMax <= 13, `${f1(2.2 + V.VIEW.sinkMax)} s`);
ok('card: nor a slide more than 10 s', 2.2 + V.VIEW.slideMax <= 10, `${f1(2.2 + V.VIEW.slideMax)} s`);
{
  const w = { y: -6, top: -2, L: 8, floor: -20 };
  ok('lens: over the water while the wreck is on it', V.sinkLensHeight({ y: -0.5, top: 1, L: 8 }, 0) > 2.5);
  ok('lens: under it once the water has closed', V.sinkLensHeight(w, 1) < 0);
  ok('lens: never into the sea bed', V.sinkLensHeight({ y: -29, top: -27, L: 8, floor: -30 }, 3) >= -28.5);
}

ok('lens: under the water it stands near enough to see an A380 and a trainer', V.underRange(72.7) <= 38 && V.underRange(7.4) >= 11, `${f1(V.underRange(7.4))} m, ${f1(V.underRange(72.7))} m`);

/* ---- how hard ---- */
ok('hardness: harder the faster and the steeper, always something', F.waterHardness(70, 0.1) > F.waterHardness(35, 0.1) && F.waterHardness(50, 0.6) > F.waterHardness(50, 0.1) && F.waterHardness(0, 0) > 0 && F.waterHardness(200, 1) <= 1);

/* ---- what it looks like ---- */
{
  const lum = (c) => c[0] + c[1] + c[2];
  const a = TI.waterLook(3, 1);
  const b = TI.waterLook(30, 1);
  const c = TI.waterLook(70, 1);
  ok('look: darker the deeper', lum(a.fog) > lum(b.fog) && lum(b.fog) > lum(c.fog), `${lum(a.fog).toFixed(3)}, ${lum(b.fog).toFixed(3)}, ${lum(c.fog).toFixed(3)}`);
  ok('look: blue-green, the red gone first', a.fog[1] > a.fog[0] * 2.5 && a.fog[2] > a.fog[0] * 2.5);
  const n = TI.waterLook(3, 0);
  ok('look: night is dark, not black, and has no shafts or caustics', lum(n.fog) < lum(a.fog) * 0.4 && lum(n.fog) > 0.02 && n.shafts === 0 && n.caustics === 0, lum(n.fog).toFixed(3));
  ok('look: Low sees a little less far', TI.waterLook(10, 1, true).density > TI.waterLook(10, 1, false).density);
}

/* ---- the mark ---- */
{
  const parent = new THREE.Group();
  const s = new SC.Scars(parent, 'low');
  const g = () => 10;
  for (let i = 0; i < 40; i++) s.add(i * 3.2, 0, i * 0.1, 'grass', 3, g);
  ok('scars: a station every few metres, on the ground', s.n === 40 && s.pos[1] > 10 && s.mesh.visible, `${s.n}`);
  const full = s.geo.drawRange.count;
  s.showUpTo(1);
  ok('scars: the replay shows it as far as it had got', s.geo.drawRange.count > 0 && s.geo.drawRange.count < full);
  s.showUpTo(-1);
  ok('scars: nothing before the hit', !s.mesh.visible);
  for (let i = 0; i < 500; i++) s.add(1000 + i * 4, 0, 9, 'grass', 3, g);
  ok('scars: never past its pool', s.n === s.cap, `${s.n}`);
  s.clear();
  ok('scars: clear() takes it away', s.n === 0 && !s.mesh.visible);
  s.dispose();
  ok('scars: gone from the scene when disposed', parent.children.length === 0);
}

/* ---- nothing added to the first load ---- */
{
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    let t = '';
    try {
      t = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    let m;
    while ((m = IMPORT_RE.exec(t))) if (m[1].startsWith('.')) walk(resolve(dirname(file), m[1]));
  };
  walk(resolve(ROOT, 'src/main.js'));
  walk(resolve(ROOT, 'src/features/index.js'));
  const lazy = ['src/features/underwater/index.js', 'src/features/underwater/seabed.js', 'src/features/underwater/water.js', 'src/features/underwater/tint.js', 'src/features/breakup/water-impact.js', 'src/features/breakup/scars.js'];
  for (const l of lazy) ok(`lazy: ${l} is in neither the first load nor the flight's bundle`, !seen.has(resolve(ROOT, l)));
  const b = src('src/features/breakup.js');
  ok('lazy: breakup.js fetches them with import()', b.includes("import('./underwater/index.js')") && b.includes("import('./breakup/water-impact.js')") && b.includes("import('./breakup/scars.js')"));
  const sw = src('sw.js');
  for (const l of [...lazy, 'src/features/breakup/slide.js', 'src/features/breakup/crash-view.js']) ok(`offline: ${l} is in the offline list`, sw.includes(`'${l}'`));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

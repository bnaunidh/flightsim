/**
 * Node checks for "NOW ENTERING" and the heading tape's place in the top lane
 * (src/features/livemap/where.js, src/ui/ribbon.js). Run from anywhere:
 *
 *   node tests/features/where.mjs [--verbose]
 *
 *   THE WATCH    the island you start on is known, not announced; crossing
 *                onto another announces it once (NOW ENTERING, its name, its
 *                region and nearest field), only after 2 s on it; a flight
 *                along its coast (in and out of the radius) does not repeat
 *                it; coming back inside two minutes does not either; hill
 *                ranges are not islands; a full stop at a field after a
 *                flight is WELCOME TO, once.
 *   REAL MAPS    Kestrel → Mango Cay announces Mango Cay; the World Map
 *                preview, Haven → Farhold, announces what lies between.
 *   THE BANNER   one at a time, the welcome first; held while a warning is
 *                lit or low on an approach, and dropped after 8 s held; the
 *                Photo HUD and a hidden interface show nothing (and save
 *                nothing up); it never flashes (a fade of half a second and
 *                more, off under Reduce motion).
 *   THE LANE     the tape and the banner live in the top lane (a column) with
 *                the objective under them, so nothing overlaps; the Photo HUD
 *                hides the lane; a phone gets a narrower tape.
 *
 * Exits non-zero if anything fails.
 */

global.document = global.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
if (typeof globalThis.localStorage === 'undefined') {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
}
import { readFileSync } from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const SRC = new URL('src/', ROOT).href;
const VERBOSE = process.argv.includes('--verbose');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (!pass || VERBOSE) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

await import(SRC + 'features/index.js');
const W = await import(SRC + 'features/livemap/where.js');

/** Fly a straight line from a to b at v m/s, `dt` a step; collect the events. */
function fly(watch, a, b, v = 60, dt = 0.25, extra = {}) {
  const d = Math.hypot(b.x - a.x, b.z - a.z);
  const n = Math.ceil(d / (v * dt));
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const e = watch.update(dt, { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, onGround: false, gsKts: v * 1.94, ...extra });
    if (e) out.push(e);
  }
  return out;
}

/* ---------------- the watch ---------------- */
{
  const islands = [
    { id: 'isl:Home', name: 'Home Island', x: 0, z: 0, r: 3000, region: 'r1' },
    { id: 'isl:Far', name: 'Far Cay', x: 12000, z: 0, r: 1500, region: 'r1' },
    { id: 'isl:Rock', name: 'Little Rock', x: 6000, z: 3000, r: 200 },
  ];
  const fields = [{ id: 'f1', code: 'XHOM', name: 'Home Field', place: 'Home Island', x: 500, z: 0, runways: [{ length: 1600 }] }];
  const regions = [{ id: 'r1', name: 'The Sound' }];
  const w = new W.LocationWatch({ islands, fields, regions });
  w.prime(0, 0);
  const startEv = fly(w, { x: 0, z: 0 }, { x: 100, z: 0 });
  ok('the island you start on is known, not announced', startEv.length === 0 && w.cur && w.cur.name === 'Home Island', JSON.stringify(startEv));
  const ev = fly(w, { x: 100, z: 0 }, { x: 12000, z: 0 });
  ok('crossing onto another island announces it once: NOW ENTERING Far Cay, with its region and the nearest field', ev.length === 1 && ev[0].title === 'NOW ENTERING' && ev[0].name === 'Far Cay' && /The Sound/.test(ev[0].sub) && /Home Field \d/.test(ev[0].sub),
    JSON.stringify(ev));
  ok('a rock too small to be a place is not announced', !ev.some((e) => e.name === 'Little Rock'), '');
  // Along its coast: in and out of the radius, repeatedly.
  const coast = [];
  for (let k = 0; k < 40; k++) {
    const r = k % 2 ? 1500 * 0.95 : 1500 * 1.05;
    const a = (k / 40) * Math.PI;
    const e = w.update(1, { x: 12000 + Math.cos(a) * r, z: Math.sin(a) * r, onGround: false, gsKts: 120 });
    if (e) coast.push(e);
  }
  ok('flying along its coast, in and out of its edge, does not repeat it (hysteresis)', coast.length === 0, JSON.stringify(coast));
  const quick = fly(w, { x: 12000, z: 0 }, { x: 12000, z: 4000 }, 150).concat(fly(w, { x: 12000, z: 4000 }, { x: 12000, z: 0 }, 150));
  ok('leaving and coming straight back inside two minutes does not announce it again', quick.length === 0, JSON.stringify(quick));
  const brief = new W.LocationWatch({ islands, fields, regions });
  brief.prime(0, 0);
  const flick = [];
  for (const x of [11000, 10400, 11000, 10400]) {
    const e = brief.update(0.5, { x, z: 0, onGround: false, gsKts: 120 });
    if (e) flick.push(e);
  }
  ok('a second over the edge is not enough: it must be 2 s on the island', flick.length === 0, JSON.stringify(flick));
  // A flight that ends with a full stop at the field.
  const home = new W.LocationWatch({ islands, fields, regions });
  home.prime(500, 0);
  let wel = [];
  for (let i = 0; i < 120; i++) {
    const e = home.update(0.5, { x: 5000, z: 0, onGround: false, gsKts: 120 });
    if (e) wel.push(e);
  }
  wel = [];
  for (let i = 0; i < 20; i++) {
    const e = home.update(0.5, { x: 700, z: 0, onGround: true, gsKts: i < 10 ? 60 : 15 });
    if (e) wel.push(e);
  }
  wel = wel.filter((e) => e.kind === 'welcome');
  ok('a full stop at a field after a flight: WELCOME TO Home Field, once', wel.length === 1 && wel[0].title === 'WELCOME TO' && wel[0].name === 'Home Field' && /XHOM/.test(wel[0].sub), JSON.stringify(wel));
}

/* ---------------- real maps ---------------- */
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const PV = await import(SRC + 'world/worldmap/preview.js');
const PL = await import(SRC + 'features/livemap/places.js');
{
  T.applyMap('kestrel');
  const P = PL.collectPlaces({});
  const w = new W.LocationWatch({ islands: P.islands, fields: P.airports, regions: P.regions });
  w.prime(0, 0);
  const mango = P.islands.find((i) => /Mango/.test(i.name));
  const ev = fly(w, { x: 0, z: 0 }, { x: mango.x, z: mango.z }, 60);
  ok('Kestrel → Mango Cay: NOW ENTERING Mango Cay (and nothing for the hills on Kestrel)', ev.length === 1 && ev[0].name === 'Mango Cay', JSON.stringify(ev.map((e) => e.name)));
}
{
  M.registerExtraMap(PV.previewDef());
  T.applyMap(PV.WORLD_PREVIEW_ID);
  const P = PL.collectPlaces({});
  const w = new W.LocationWatch({ islands: P.islands, fields: P.airports, regions: P.regions });
  const a = P.airports.find((f) => f.id === 'haven');
  const b = P.airports.find((f) => f.id === 'farhold') || P.airports[4];
  w.prime(a.x, a.z);
  const ev = fly(w, a, b, 120, 0.5);
  const isl = P.islands.find((i) => Math.hypot(i.x - b.x, i.z - b.z) < i.r);
  ok(`the World Map: Haven → ${b.name} announces the islands on the way, ${isl ? isl.name : 'its island'} last, each with its region`, ev.length >= 1 && (!isl || ev[ev.length - 1].name === isl.name) && ev.every((e) => e.sub.length > 3),
    ev.map((e) => `${e.name} (${e.sub})`).join('; '));
}

/* ---------------- the banner ---------------- */
{
  const B = new W.Banner();
  B.push({ id: 'a', title: 'NOW ENTERING', name: 'A', prio: 2 });
  B.push({ id: 'w', title: 'WELCOME TO', name: 'W', prio: 3 });
  B.push({ id: 'a', title: 'NOW ENTERING', name: 'A', prio: 2 });
  B.tick(0.1, '', false);
  ok('one at a time, the welcome first, a repeat ignored', B.cur && B.cur.name === 'W' && B.queue.length === 1, `${B.cur && B.cur.name} then ${B.queue.map((q) => q.name)}`);
  for (let i = 0; i < 60; i++) B.tick(0.1, '', false);
  ok('it stays about four seconds, then the next', B.shown.length === 2 && B.shown[1].name === 'A', B.shown.map((s) => s.name).join(' '));
  const H = new W.Banner();
  H.push({ id: 'x', title: 'NOW ENTERING', name: 'X', prio: 2 });
  for (let i = 0; i < 50; i++) H.tick(0.1, 'busy', false);
  const heldStill = H.queue.length === 1 && !H.cur;
  for (let i = 0; i < 40; i++) H.tick(0.1, 'busy', false);
  ok('held while a warning is lit or low on an approach, and dropped once held for 8 s', heldStill && H.queue.length === 0 && H.shown.length === 0, `${heldStill} ${H.queue.length}`);
  const Q = new W.Banner();
  Q.push({ id: 'as', title: 'ENTERING AIRSPACE', name: 'MANGO APPROACH', quiet: true, prio: 1 });
  Q.tick(0.1, '', false);
  Q.push({ id: 'isl', title: 'NOW ENTERING', name: 'Mango Cay', prio: 2 });
  for (let i = 0; i < 12; i++) Q.tick(0.1, '', false);
  ok('an airspace line gives way at once to an island\'s title', Q.cur && Q.cur.name === 'Mango Cay', Q.shown.map((s) => s.name).join(' → '));
  const P2 = new W.Banner();
  P2.push({ id: 'y', title: 'NOW ENTERING', name: 'Y' });
  P2.tick(0.1, '', true);
  ok('the Photo HUD or a hidden interface: nothing shown, nothing saved up', !P2.cur && P2.queue.length === 0 && P2.shown.length === 0, '');
  const blocked = W.bannerBlocked({ state: 'flying', hud: { density: 'photo' } }) && W.bannerBlocked({ state: 'flying', hud: { hidden: true } }) && !W.bannerBlocked({ state: 'flying', hud: { density: 'clean' } });
  ok('blocked in the Photo HUD and with the interface hidden; shown in the Clean HUD', blocked, '');
  const quiet = W.quietReason({ warnings: { active: () => ['pullup'] } }) === 'urgent' && W.quietReason({ warnings: { active: () => ['sinkrate'] } }) === 'busy' && W.quietReason({ warnings: { active: () => [] } }) === '';
  ok('what holds it: a red warning (urgent, it closes one already up), an amber one (busy)', quiet, '');
}

/* ---------------- the lane ---------------- */
{
  const css = readFileSync(new URL('styles/main.css', ROOT), 'utf8');
  const where = readFileSync(new URL('src/features/livemap/where.js', ROOT), 'utf8');
  const hud = readFileSync(new URL('src/ui/hud.js', ROOT), 'utf8');
  ok('the tape and the banner are in the top lane (a column), above the objective: stacked, never overlapping',
    /top\.appendChild\(this\.dest\.el\);\s*\n\s*top\.appendChild\(this\.objective\)/.test(hud) && /lane\.insertBefore\(el, tape\.nextSibling\)/.test(where) && /\.hud-top \{[^}]*flex-direction: column/.test(css), '');
  ok('the Photo HUD hides the top lane (the tape) and the banner; the open map hides the banner', /\.hud\.is-photo \.hud-top/.test(css) && /\.hud\.is-photo \.loc-banner/.test(where) && /html\.lm-open \.loc-banner/.test(where), '');
  ok('a phone gets a narrower tape and a smaller name', /@media \(max-width: 560px\) \{\s*\.hud-dest \{ width: min\(100%, 260px\)/.test(css) && /@media \(max-width: 560px\) \{ \.loc-banner \.loc-name \{ font-size: 19px/.test(where), '');
  const fade = /transition: opacity 0\.6s/.test(where) && /reduce-motion \.loc-banner \{ transition: none/.test(where) && !/animation:/.test(where.split('const CSS')[1].split('`;')[0]);
  ok('it fades (0.6 s), it never flashes, and Reduce motion takes the fade away', fade, '');
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

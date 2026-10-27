/**
 * Node checks for the full-screen LIVE map (src/features/livemap/): the key,
 * the no-pause rule, the chart and the level of detail. Run from anywhere:
 *
 *   node tests/features/livemap.mjs [--verbose]
 *
 *   THE KEY       `worldMap` is a game action on 5 (M is the mute key, so it
 *                 is not taken), in every vehicle's game, labelled for Settings
 *                 and the H card, registered once (the live map's, not the
 *                 preview's), and no default clashes.
 *   NEVER PAUSES  neither the live map nor the World Map preview's map opener
 *                 pauses the sim (the old overlay called sim.pause()); urgent
 *                 warnings (PULL UP, stall, fire) are the ones that close it.
 *   THE CHART     a coast is anti-aliased (the pixel on the crossing is a blend,
 *                 not land or sea), deeper water is darker, the north-west
 *                 slope is lit and the south-east one shaded, contours only
 *                 close in; the tile levels: about one chart pixel per screen
 *                 pixel at every zoom, never past the tier's finest.
 *   LABELS        no two placed labels overlap, and the higher priority wins.
 *   PLACES        on Kestrel, Gateway, Fjord, the air base and the World Map
 *                 preview: every field has a code (unique), a runway at its
 *                 true heading, a control zone and a frequency; the hill
 *                 ranges are not islands; the chart's square covers every
 *                 island.
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
const read = (p) => readFileSync(new URL(p, ROOT), 'utf8');

/* ---------------- the key ---------------- */
await import(SRC + 'features/index.js');
const I = await import(SRC + 'flight/input.js');
const A = I.ACTIONS.worldMap;
ok('the map key: worldMap on 5, in the aeroplane, the helicopter, the boat and the van', !!A && A.default.join() === 'Digit5' && ['plane', 'heli', 'boat', 'car'].every((c) => A.ctx.includes(c)), A && `${A.default} ${A.ctx}`);
ok('the map key is labelled as the full-screen map on every map (Settings, the H card)', !!A && /full-screen map/i.test(A.label) && !/preview/i.test(A.label), A && A.label);
ok('M stays the mute key (so the map does not take it)', I.ACTIONS.mute && I.ACTIONS.mute.default.includes('KeyM') && !A.default.includes('KeyM'), I.ACTIONS.mute && I.ACTIONS.mute.default.join());
ok('no default key clashes with the map key', !Object.keys(I.findConflicts(I.defaultBindings())).length, JSON.stringify(I.findConflicts(I.defaultBindings())).slice(0, 200));
const wpSrc = read('src/features/world-preview.js');
ok('the World Map preview no longer registers its own map key (one registry entry, the live map\'s)', !/worldMap:\s*\{\s*label/.test(wpSrc), '');
const H = I.actionsFor('plane');
ok('the H card lists the map key in the aeroplane', !!H.worldMap, Object.keys(H).length);
{
  // In a game with friends 5 is the quick chat's "Race you!" (as it always was): the live map's key() runs
  // before multiplayer's, so it must step aside for a chat key (the checker, w18: 5 opened the map in a lobby).
  const L0 = await import(SRC + 'features/livemap/livemap.js');
  const X = await import(SRC + 'game/extensions.js');
  const ext = X.extensions().find((e) => e.id === 'livemap');
  const order = X.extensions().map((e) => e.id);
  const chatKey = Object.keys(I.ACTIONS).filter((a) => /^mpChat\d+$/.test(a)).find((a) => I.ACTIONS[a].default.includes('Digit5'));
  const fake = { state: 'menu', input: null };
  const was = L0.__livemap.MP.ref;
  L0.__livemap.MP.ref = { role: 'host' };
  const inMp = ext.key(fake, 'Digit5', true, {});
  L0.__livemap.MP.ref = { role: null };
  const solo = ext.key(fake, 'Digit5', true, {});
  L0.__livemap.MP.ref = was;
  ok('in multiplayer the live map leaves a quick-chat key (5) to the chat; solo, 5 is the map',
    !!chatKey && order.indexOf('livemap') < order.indexOf('multiplayer') && inMp === false && solo === true && L0.mpChatKey({ input: null }, 'Digit5') === false,
    `chat action on 5: ${chatKey}; in a lobby ${inMp}, solo ${solo}`);
}

/* ---------------- never pauses ---------------- */
const lmSrc = read('src/features/livemap/livemap.js');
const openBody = (src, name) => {
  const i = src.indexOf(`export function ${name}(`);
  if (i < 0) return '';
  const j = src.indexOf('\n}\n', i);
  return src.slice(i, j);
};
ok('opening the live map never pauses the sim', !/\.pause\(\)/.test(openBody(lmSrc, 'open')) && !/\.pause\(\)/.test(lmSrc), '');
ok('the preview\'s map button opens the live map without pausing', !/sim\.pause\(\)/.test(openBody(wpSrc, 'openMap')) && /liveMap\.open\(\)/.test(openBody(wpSrc, 'openMap')) && !/pausedForMap/.test(wpSrc), '');
const L = await import(SRC + 'features/livemap/livemap.js');
ok('urgent warnings close it: PULL UP, TERRAIN, windshear, stall, engine fire', ['pullup', 'terrain', 'windshear', 'stall', 'engineFire'].every((k) => L.URGENT.includes(k)), L.URGENT.join(' '));
{
  // Every red warning closes it: the map covers the warnings panel, so one left out is lit unseen (the checker, w18: ENGINE FAIL, GEAR NOT DOWN).
  const WR = await import(SRC + 'features/warnings-rules.js');
  const red = Object.keys(WR.DEFS).filter((k) => WR.DEFS[k].level === 'warning');
  const missing = red.filter((k) => !L.URGENT.includes(k));
  ok('every red warning (the master WARNING ones) closes the map', red.length >= 8 && !missing.length, `missing: ${missing.join(' ') || 'none'}`);
}
ok('the mouse is the map\'s while it is open (input.js mapOpen), the keys and a joystick still fly', /if \(this\.mapOpen\) return;/.test(read('src/flight/input.js')) && /input\.mapOpen = true/.test(lmSrc), '');
const tc = (await import(SRC + 'ui/touch-coverage.js')).TOUCH_COVERAGE.worldMap;
ok('touch: tap the minimap to open it, an ✕ to close it', !!tc && /minimap/.test(tc.where) && /✕/.test(tc.where) && read(tc.file).includes(tc.needle), tc && tc.where);
ok('the minimap is tappable (pointer events on, a button) once the live map is installed', /html\.lm-tap #ui > \.minimap \{ pointer-events: auto/.test(lmSrc) && /mm\.addEventListener\('click'/.test(lmSrc), '');

/* ---------------- the chart ---------------- */
const SH = await import(SRC + 'features/livemap/shade.js');
const style = SH.chartStyle({});
// A coast running north-south: land east of x = 0, a 1:20 slope.
const coast = (x, z) => x * 0.05;
{
  const n = 16;
  const step = 10;
  const out = SH.shadeTile(coast, -n * step / 2 + 2.5, 0, step, n, style);
  const px = (i) => [out[(4 * n + i) * 4], out[(4 * n + i) * 4 + 1], out[(4 * n + i) * 4 + 2]];
  const seaPx = px(0);
  const landPx = px(n - 1);
  const mid = px(n / 2 - 1);
  const isBlend = mid.some((v, k) => Math.abs(v - seaPx[k]) > 6) && mid.some((v, k) => Math.abs(v - landPx[k]) > 6);
  ok('the coast is anti-aliased: the pixel on the crossing is neither the sea nor the land colour', isBlend, `${seaPx} | ${mid} | ${landPx}`);
}
{
  const depth = (d) => {
    const out = SH.shadeTile(() => -d, 0, 0, 50, 4, style);
    return out[20] + out[21] + out[22];
  };
  ok('deeper water is darker (1, 5, 20, 60 m)', depth(1) > depth(5) && depth(5) > depth(20) && depth(20) > depth(60), [1, 5, 20, 60].map(depth).join(' > '));
  const light = (gx, gz) => {
    const out = SH.shadeTile((x, z) => 300 + gx * x + gz * z, 0, 0, 30, 4, style);
    return out[20] + out[21] + out[22];
  };
  // Rising to the south-east faces north-west: lit. Rising to the north-west: shaded.
  ok('hillshade: a slope facing north-west is lit, one facing south-east is in shade', light(0.3, 0.3) > light(0, 0) && light(0, 0) > light(-0.3, -0.3), `${light(0.3, 0.3)} ${light(0, 0)} ${light(-0.3, -0.3)}`);
  const terraces = (step) => {
    const n = 32;
    const out = SH.shadeTile((x) => 150 + x * 0.4, 0, 0, step, n, style);
    let changes = 0;
    for (let i = 1; i < n; i++) if (Math.abs(out[(4 * n + i) * 4] - out[(4 * n + i - 1) * 4]) > 8) changes++;
    return changes;
  };
  ok('100 m contours appear close in (10 m a pixel) and not zoomed out (60 m a pixel)', terraces(10) >= 1 && terraces(60) === 0, `${terraces(10)} / ${terraces(60)}`);
}
const C = await import(SRC + 'features/livemap/chart.js');
{
  const size = 400000;
  const maxL = C.maxLevelFor(size, C.CHART_TIER.medium.minStep);
  let worst = 0;
  for (const mpp of [2000, 600, 200, 60, 20, 8]) {
    const L = C.levelFor(size, 1 / mpp, 1, maxL);
    const chartPx = size / (256 * (1 << L)); // metres a chart pixel
    worst = Math.max(worst, chartPx / mpp);
  }
  ok('every zoom gets a level about as sharp as the screen (no chart pixel over 1.2 screen pixels)', worst <= 1.2, worst.toFixed(2));
  const deep = C.levelFor(size, 1 / 1.2, 2, maxL);
  ok('the deepest level stops at the tier\'s finest (Medium 6 m a pixel; Low 12 m)', size / (256 * (1 << deep)) >= C.CHART_TIER.medium.minStep * 0.99 && C.CHART_TIER.low.minStep >= 12 && C.CHART_TIER.low.inflight === 1, `${(size / (256 * (1 << deep))).toFixed(1)} m`);
}

/* ---------------- labels ---------------- */
const R = await import(SRC + 'features/livemap/render.js');
{
  const P = new R.LabelPlacer();
  const g = {
    font: '', textAlign: '', textBaseline: '', lineJoin: '', strokeStyle: '', lineWidth: 1, fillStyle: '',
    measureText: (t) => ({ width: t.length * 7 }), strokeText() {}, fillText() {},
  };
  const st = { font: '12px x', size: 12, fill: '#fff' };
  P.block(100, 100, 140, 108); // a runway
  // Tern Fell sat on top of XTRN in the owner's screenshot: two places 6 px apart.
  P.add('XTRN', 120, 104, 70, { ...st, sub: 'Tern Field', subFont: '10px x', subSize: 10 });
  P.add('Tern Fell', 124, 108, 25, st);
  for (let i = 0; i < 40; i++) P.add(`Place ${i}`, 60 + (i % 8) * 25, 60 + Math.floor(i / 8) * 18, i % 3, st);
  const n = P.draw(g, 400, 300);
  const placed = P.items.filter((it) => it.placed);
  let overlaps = 0;
  const b = P.boxes;
  for (let i = 0; i < b.length; i += 4) for (let j = i + 4; j < b.length; j += 4) if (b[i] < b[j + 2] && b[i + 2] > b[j] && b[i + 1] < b[j + 3] && b[i + 3] > b[j + 1]) overlaps++;
  ok('labels never overlap each other or the symbols', overlaps === 0 && n === placed.length, `${n} placed, ${overlaps} overlaps`);
  ok('the airport code beats the place name crowding it (hierarchy)', !!P.items.find((it) => it.text === 'XTRN').placed, '');
}

/* ---------------- places ---------------- */
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
const PV = await import(SRC + 'world/worldmap/preview.js');
const PL = await import(SRC + 'features/livemap/places.js');
for (const id of ['kestrel', 'gateway', 'fjord', 'airbase', PV.WORLD_PREVIEW_ID]) {
  if (id === PV.WORLD_PREVIEW_ID) {
    M.registerExtraMap(PV.previewDef());
  }
  T.applyMap(id);
  const P = PL.collectPlaces({});
  const codes = P.airports.map((a) => a.code);
  const uniq = new Set(codes).size === codes.length && codes.every((c) => /^[A-Z]{4}$/.test(c));
  const rw = P.airports.every((a) => a.runways.length && a.runways.every((r) => Number.isFinite(r.hdg) && r.length > 200 && /^\d\d\/\d\d$/.test(r.ident)));
  const zones = P.zones.length === P.airports.length && P.zones.every((z) => /^1[1-3]\d\.\d\d$/.test(z.freq) && z.r >= 6000);
  const fixes = P.fixes.length >= 2 && new Set(P.fixes.map((f) => f.name)).size === P.fixes.length && P.fixes.every((f) => /^[A-Z]{5}$/.test(f.name));
  const isl = id === PV.WORLD_PREVIEW_ID ? PV.PREVIEW.islands : T.ISLANDS;
  const b = P.box;
  const covered = isl.every((i) => i.cx - i.radius >= b.x0 && i.cx + i.radius <= b.x0 + b.size && i.cz - i.radius >= b.z0 && i.cz + i.radius <= b.z0 + b.size);
  ok(`places on ${id}: ${P.airports.length} field(s) with unique codes, runways at their heading, a zone and a frequency each, ${P.fixes.length} five-letter fixes, the chart covering every island`,
    uniq && rw && zones && fixes && covered, `${codes.join(' ')} · ${P.zones.map((z) => z.freq).join(' ')} · ${P.fixes.map((f) => f.name).join(' ')}`);
  if (id === 'kestrel') {
    ok('Kestrel\'s hill ranges are hills on the island, not islands of their own', P.islands.some((i) => i.name === 'Kestrel Island') && !P.islands.some((i) => /Hills/.test(i.name)) && P.hills.some((h) => /Hills/.test(h.name)), P.islands.map((i) => i.name).join(', '));
    ok('Kestrel: both runways (09/27 and 18/36), the strip on Mango Cay, the pads as heliports', P.airports[0].runways.map((r) => r.ident).join() === '09/27,18/36' && P.airports.some((a) => /Mango/.test(a.name)), P.airports.map((a) => `${a.code} ${a.runways.map((r) => r.ident)}`).join('; '));
  }
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

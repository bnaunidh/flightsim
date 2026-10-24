/**
 * Node checks for the fuel a spawn starts with (src/features/spawns.js
 * spawnFuel; the owner, 2026-10-17: "i spawn with full fuel" made the stand's
 * "Fuelling and loading" pointless). Run with plain node:
 *
 *   node tests/features/stand-fuel.mjs
 *
 *   - a STAND or HANGAR start has 35-60% in the tanks, the same every time for
 *     the same stand and aircraft, and different stands differ;
 *   - the runway, airborne, the water, a pad, the flight line: full;
 *   - a fuel the start options name always wins, clamped to 5-100%;
 *   - at the bowser's rate (a twentieth of the tanks a second, airport-services.js)
 *     the fill is visible for 8-13 seconds, not over in a blink.
 */

globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
};
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const root = new URL('../../src/', import.meta.url);
const imp = (p) => import(new URL(p, root).href);
const SP = await imp('features/spawns.js');

let pass = 0;
let fail = 0;
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? '  — ' + detail : ''}`);
}

const stand = (id) => ({ kind: 'stand', id, label: `Stand ${id}` });
const f = SP.spawnFuel;
ok('spawnFuel is exported, with the stand range 35-60%', typeof f === 'function' && SP.STAND_FUEL.min === 0.35 && SP.STAND_FUEL.max === 0.6, JSON.stringify(SP.STAND_FUEL));

const fuels = [];
for (const id of ['gateway:16', 'gateway:12', 'gateway:3', 'northwatch:1', 'ironhead:2', 'hangar-a']) for (const t of ['skylark', 'a320', 'a380', 'courier']) fuels.push(f(id === 'hangar-a' ? { kind: 'hangar', id } : stand(id), t));
ok('every stand and hangar start has between 35% and 60% in the tanks', fuels.every((v) => v >= 0.35 && v <= 0.6), fuels.map((v) => Math.round(v * 100)).join(' '));
ok('the same stand and aircraft always get the same fuel', f(stand('gateway:16'), 'a320') === f(stand('gateway:16'), 'a320'), String(f(stand('gateway:16'), 'a320')));
ok('…and different stands or aircraft differ (it is by the trip, not one number)', new Set(fuels.map((v) => Math.round(v * 100))).size >= 6, `${new Set(fuels.map((v) => Math.round(v * 100))).size} distinct values`);

for (const kind of ['runway', 'hover', 'water', 'pad', 'base', 'strip', 'apron']) ok(`a ${kind} start is full`, f({ kind, id: kind }, 'skylark') === 1, String(f({ kind, id: kind }, 'skylark')));
ok('no spawn record at all: full', f(null, 'skylark') === 1 && f(undefined, undefined) === 1, '');

ok('a fuel the start options name wins, at a stand too', f(stand('gateway:16'), 'a320', 0.8) === 0.8 && f({ kind: 'runway' }, 'a320', 0.2) === 0.2, '');
ok('…clamped to 5-100%', f(stand('x'), 'a320', 0) === 0.05 && f(stand('x'), 'a320', 7) === 1, `${f(stand('x'), 'a320', 0)} ${f(stand('x'), 'a320', 7)}`);

// The bowser fills at a twentieth of the tanks a second (airport-services.js: cap / 20 * dt).
const secs = fuels.map((v) => (1 - v) * 20);
ok('at the bowser\'s rate the fill takes 8-13 seconds: long enough to watch, short enough to wait', secs.every((s) => s >= 8 - 1e-9 && s <= 13 + 1e-9), `${Math.min(...secs).toFixed(1)}-${Math.max(...secs).toFixed(1)} s`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

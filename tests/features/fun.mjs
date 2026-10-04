/**
 * Node checks for Fun Stuff and the Wildfire disaster. Plain node:
 *
 *   node tests/features/fun.mjs
 *
 *   1. The Wildfire disaster is on the list you can arm, in the random pool,
 *      and does nothing (and says nothing) when there is no fire to start.
 *   2. The smoke colours, and the save.
 *   3. The plug-in registers itself and survives being loaded without a page.
 *
 * Fun Stuff used to also carry a Star Hunt, Stunts and a sticker book — see
 * git history for their node checks (star placement geometry, the stunt
 * meter flown with made-up attitudes, the sticker/colour-unlock table).
 */

// fx.js and wildfire's modules paint small textures on import.
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

const D = await imp('game/disasters.js');
// The Wildfire disaster is the crashes team's (features/wildfire-disaster.js registers it).
await imp('features/wildfire-disaster.js');
const C = await imp('features/fun/smoke.js');
const V = await imp('features/fun/save.js');
const { MAPS } = await imp('world/maps.js');

let passed = 0;
let failed = 0;
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

/* ---- 1. the disaster -------------------------------------------------- */
{
  const ev = D.findEvent('wildfire');
  ok('disaster: Wildfire is a natural disaster', !!ev && ev.name === 'Wildfire');
  ok('disaster: …you can arm it before a flight', D.SELECTABLE_EVENTS.some((e) => e.id === 'wildfire'));
  ok('disaster: …and Randomised disasters can pick it', D.poolForMap(MAPS[0]).some((e) => e.id === 'wildfire'));
  ok('disaster: its hint says what to do (water, X)', /water/i.test(ev.hint) && /\bX\b/.test(ev.hint), ev.hint);
  // How it starts, and that it never starts in a mission, is tested in crashes.mjs with the implementation.
}

/* ---- 2. smoke colours and the save ------------------------------------ */
{
  ok('colours: every colour has its own id and a name', new Set(C.SMOKE_COLOURS.map((c) => c.id)).size === C.SMOKE_COLOURS.length && C.SMOKE_COLOURS.every((c) => c.name));
  const d = V.blankFun();
  ok('colours: a new player flies white', C.activeColour(d).id === 'white');
  d.smoke.color = 'rainbow';
  ok('colours: every colour is available, Rainbow included', C.activeColour(d).id === 'rainbow');
  d.smoke.color = 'not-a-colour';
  ok('colours: an unknown saved colour falls back to white', C.activeColour(d).id === 'white');

  const mem = new Map();
  const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const d2 = V.blankFun();
  d2.smoke.color = 'blue';
  ok('save: it saves', V.saveFun(d2, store));
  const back = V.loadFun(store);
  ok('save: …and loads back the same', JSON.stringify(back) === JSON.stringify(d2));
  mem.set(V.FUN_KEY, '{not json');
  ok('save: a broken save starts fresh instead of throwing', JSON.stringify(V.loadFun(store)) === JSON.stringify(V.blankFun()));
  // An old (v55) save had stars/stickers/stunts/storm fields too; they are
  // simply not read back — no throw, no console error, smoke.color still
  // comes through.
  mem.set(V.FUN_KEY, JSON.stringify({
    v: 1, stars: { 'flight:kestrel': ['1:2'] }, stickers: { roll: '2026-09-29' }, stunts: { best: { flight: 400 }, count: { roll: 2 } }, smoke: { color: 'green' }, storm: 12,
  }));
  const old = V.loadFun(store);
  ok('save: an old save with the removed fields loads quietly, keeping just the smoke colour', old.smoke.color === 'green' && !('stars' in old) && !('stickers' in old) && !('stunts' in old), JSON.stringify(old));
  ok('save: no storage at all is fine', V.saveFun(d2, null) === false && V.loadFun(null).v === 2);
}

/* ---- 3. the plug-in ---------------------------------------------------- */
{
  const ext = await imp('game/extensions.js');
  let err = null;
  try {
    await imp('features/fun.js');
  } catch (e) {
    err = e;
  }
  ok('plug-in: features/fun.js loads without a page', !err, err && err.message);
  const st = ext.extStatus().find((e) => e.id === 'fun');
  ok('plug-in: it registers as "fun"', !!st && st.live);
  const reg = ext.extensions().find((e) => e.id === 'fun');
  ok('plug-in: …with the hooks it needs', reg && ['install', 'buildWorld', 'startMode', 'stop', 'update', 'key'].every((h) => typeof reg[h] === 'function'));
  const idx = (await import('node:fs')).readFileSync(new URL('features/index.js', root), 'utf8');
  ok('plug-in: it is listed in features/index.js', /import '\.\/fun\.js';/.test(idx));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

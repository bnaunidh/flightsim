/**
 * Paint per aeroplane (wave 18, owner: "the paint should modify THAT plane,
 * not all of them"), in plain node:
 *
 *   node tests/features/plane-paint.mjs
 *
 *   - painting plane A leaves plane B in its own paint (core/plane-paint.js);
 *   - the paint persists across a reload (core/storage.js, a fake localStorage);
 *   - an old save's ONE global livery moves to the plane that save had
 *     selected, every other plane goes back to 'house', the old key is gone,
 *     and the migration runs once;
 *   - multiplayer sends the flown plane's paint (mplook's `l`; mpskin has its
 *     own test), and nothing in src reads the old global `settings.livery`;
 *   - the hangar's swatch writes `liveries.<shown plane>`, not a global paint.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

globalThis.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
  documentElement: { classList: { toggle() {} } },
  addEventListener() {},
  hidden: false,
};
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let passed = 0;
const failed = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed.push(name);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
}

const ROOT = new URL('../../', import.meta.url).pathname;
const P = await import('../../src/core/plane-paint.js');
const ST = await import('../../src/core/storage.js');
const KEY = 'islandsim.settings.v1';

/* ---- A does not paint B ---------------------------------------------------- */
{
  const s = { aircraft: 'skylark', liveries: {} };
  P.setLiveryOf(s, 'b747', 'potus');
  ok('paint: painting the 747 paints the 747', P.liveryOf(s, 'b747') === 'potus');
  ok('paint: …and leaves the Skylark in its own colours', P.liveryOf(s, 'skylark') === 'house');
  P.setLiveryOf(s, 'skylark', 'liberty');
  ok('paint: painting the Skylark leaves the 747 alone', P.liveryOf(s, 'b747') === 'potus' && P.liveryOf(s, 'skylark') === 'liberty');
  P.setLiveryOf(s, 'b747', 'house');
  ok('paint: back to house clears the entry (the map holds real choices only)', !('b747' in s.liveries) && P.liveryOf(s, 'b747') === 'house');
  ok('paint: the flown type is the one the game is in', P.currentLivery({ aircraftType: { id: 'skylark' }, settings: s }) === 'liberty'
    && P.currentLivery({ aircraftType: null, settings: { ...s, aircraft: 'skylark' } }) === 'liberty');
}

/* ---- a new install, a reload ------------------------------------------------- */
{
  store.clear();
  const s = ST.loadSettings();
  ok('storage: a new install has an empty paint map and no global paint', s.liveries && Object.keys(s.liveries).length === 0 && !('livery' in s));
  P.setLiveryOf(s, 'a320', 'bleuciel');
  ok('storage: the defaults are never painted through a loaded object', Object.keys(ST.DEFAULT_SETTINGS.liveries || {}).length === 0 && !('livery' in ST.DEFAULT_SETTINGS));
  ST.saveSettings(s);
  const s2 = ST.loadSettings();
  ok('storage: one plane\'s paint persists across a reload, the others stay house', P.liveryOf(s2, 'a320') === 'bleuciel' && P.liveryOf(s2, 'b747') === 'house' && P.liveryOf(s2, 'skylark') === 'house');
}

/* ---- the migration ------------------------------------------------------------ */
{
  store.clear();
  store.set(KEY, JSON.stringify({ aircraft: 'b747', livery: 'abyssinia', muted: true }));
  const s = ST.loadSettings();
  ok('migrate: the plane that save had selected keeps the old paint', P.liveryOf(s, 'b747') === 'abyssinia');
  ok('migrate: every other plane goes back to its own colours', ['skylark', 'a320', 'f22', 'courier'].every((t) => P.liveryOf(s, t) === 'house'));
  ok('migrate: the global key is gone from the loaded settings', !('livery' in s));
  const raw = JSON.parse(store.get(KEY));
  ok('migrate: …and from the save, written back once', !('livery' in raw) && raw.liveries && raw.liveries.b747 === 'abyssinia' && raw.muted === true);
  // Change the paint after the migration: a reload must not migrate again.
  P.setLiveryOf(s, 'b747', 'house');
  P.setLiveryOf(s, 'skylark', 'liberty');
  ST.saveSettings(s);
  const s2 = ST.loadSettings();
  ok('migrate: runs once (a later reload keeps what was chosen since)', P.liveryOf(s2, 'b747') === 'house' && P.liveryOf(s2, 'skylark') === 'liberty');

  store.clear();
  store.set(KEY, JSON.stringify({ aircraft: 'skylark', livery: 'house' }));
  const s3 = ST.loadSettings();
  ok('migrate: an old save on house colours leaves every plane on house', Object.keys(s3.liveries).length === 0 && !('livery' in s3));

  store.clear();
  store.set(KEY, JSON.stringify({ livery: 'potus' }));
  const s4 = ST.loadSettings();
  ok('migrate: an old save with no aeroplane recorded gives the old paint to the default aeroplane', P.liveryOf(s4, ST.DEFAULT_SETTINGS.aircraft) === 'potus', JSON.stringify(s4.liveries));

  store.clear();
  store.set(KEY, JSON.stringify({ aircraft: 'a320', livery: 'potus', liveries: { b747: 'liberty' } }));
  const s5 = ST.loadSettings();
  ok('migrate: a save that already has the map is not re-migrated by a stray old key', P.liveryOf(s5, 'b747') === 'liberty' && P.liveryOf(s5, 'a320') === 'house' && !('livery' in s5));
}

/* ---- multiplayer look ---------------------------------------------------------- */
{
  const LOOK = await import('../../src/features/mplook.js');
  const sim = { state: 'flying', mode: 'flight', aircraftType: { id: 'b747' }, settings: { aircraft: 'b747', liveries: { b747: 'potus', skylark: 'liberty' } } };
  const a = LOOK.myLook(sim).l;
  sim.aircraftType = { id: 'skylark' };
  const b = LOOK.myLook(sim).l;
  sim.aircraftType = { id: 'courier' };
  const c = LOOK.myLook(sim).l;
  ok('mplook: the look sends the flown plane\'s paint', a === 'potus' && b === 'liberty' && c === 'house', `${a} ${b} ${c}`);
  ok('mplook: an older copy\'s single paint is still a paint', LOOK.myLook({ state: 'flying', mode: 'flight', settings: { livery: 'potus' } }).l === 'potus');
}

/* ---- the source: nobody reads the old global paint ----------------------------- */
{
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== 'vendor') walk(p); } else if (f.endsWith('.js')) files.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  const offenders = files.filter((f) => !f.endsWith('plane-paint.js') && /settings(Ref)?\s*(\.|&&\s*\w+\.)\s*livery\b(?!\s*\()/.test(readFileSync(f, 'utf8').replace(/settings(Ref)?\.liveries/g, '')));
  ok('source: nothing outside core/plane-paint.js reads settings.livery', offenders.length === 0, offenders.map((f) => f.slice(ROOT.length)).join(', '));
  const hs = readFileSync(join(ROOT, 'src/ui/hangar-showcase-ui.js'), 'utf8');
  ok('source: the hangar swatch paints the plane on show (liveries.<id>), not the fleet', /onSetting\(`liveries\.\$\{typeId\}`/.test(hs) && !/onSetting\('livery'/.test(hs));
  const menus = readFileSync(join(ROOT, 'src/ui/menus.js'), 'utf8');
  ok('source: each fleet card is drawn in its own plane\'s paint', /aircraftThumbnail\(a, liveryOf\(this\.settingsRef, a\.id\)\)/.test(menus));
  const main = readFileSync(join(ROOT, 'src/main.js'), 'utf8');
  ok('source: the game aeroplane wears its own type\'s paint', (main.match(/schemeFor\(this\.aircraftType, liveryOf\(this\.settings, /g) || []).length === 2);
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);

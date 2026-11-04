/**
 * The plane, the Free Flight screen and the map after a reload: what can be
 * checked without a browser (the reloads themselves are remember-last.browser.js).
 *
 *   /opt/homebrew/bin/node tests/features/remember-last.mjs           one line per check
 *   /opt/homebrew/bin/node tests/features/remember-last.mjs --quiet   failures and the summary
 *
 *   - settleGameMaps: the map boot builds and the map each game remembers, from
 *     saves of every age, a borrowed map, the World Map, and junk
 *   - loadSettings with storage that throws (a private window) and with a save
 *     that is not JSON
 *   - from the source: only a choice writes the memory, and nothing at boot
 *     builds the World Map
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
const quiet = process.argv.includes('--quiet');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  if (!pass || !quiet) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
console.warn = () => {};

const mem = new Map();
const plain = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v), removeItem: (k) => mem.delete(k) };
globalThis.localStorage = plain;
const S = await import(new URL('../../src/core/storage.js', import.meta.url).href);
const KEY = 'islandsim.settings.v1';

const settle = (s) => S.settleGameMaps(s);

/* ---- the map boot builds ---- */
{
  const a = settle({ map: 'alpine' });
  ok('old save: the map it had is the flight game\'s', a.map === 'alpine' && a.gameMap.flight === 'alpine', JSON.stringify(a));
  const b = settle({ map: 'alpine', gameMap: { flight: 'kestrel', boat: 'sennen' } });
  ok('the flight game\'s choice beats a map left over from another game or a mission', b.map === 'kestrel' && b.gameMap.boat === 'sennen', JSON.stringify(b));
  const c = settle({ map: 'world-preview' });
  ok('old save on the World Map: remembered, and the default is what boots', c.map === 'kestrel' && c.gameMap.flight === 'world-preview', JSON.stringify(c));
  const d = settle({ map: 'alpine', gameMap: { flight: 'world-preview' } });
  ok('the World Map is never what boots', d.map === 'kestrel', JSON.stringify(d));
  const e = settle({ map: 'no-such-map', gameMap: { flight: 'no-such-map' } });
  ok('an unknown id stays for getMap and maps-retired to put right', e.map === 'no-such-map', JSON.stringify(e));
  const f = settle({ map: 12, gameMap: 'junk' });
  ok('junk: the default', f.map === 'kestrel' && typeof f.gameMap === 'object', JSON.stringify(f));
  const g = settle({ map: 'alpine', gameMap: { flight: 9, boat: null, car: 'drovers' } });
  ok('junk in the memory is dropped, the rest kept', g.map === 'alpine' && g.gameMap.flight === 'alpine' && !('boat' in g.gameMap) && g.gameMap.car === 'drovers', JSON.stringify(g));
  const h = settle({ map: 'kestrel', gameMap: ['flight'] });
  ok('an array is not a memory', h.map === 'kestrel', JSON.stringify(h));
}

/* ---- loadSettings ---- */
{
  mem.clear();
  const fresh = S.loadSettings();
  ok('first boot: no save is written by reading', !mem.has(KEY) && fresh.map === 'kestrel' && fresh.gameMap.flight === 'kestrel');
  mem.set(KEY, JSON.stringify({ map: 'alpine', gameMap: { flight: 'kestrel', boat: 'sennen' }, freeSetup: { fuel: 0.4 } }));
  const s = S.loadSettings();
  ok('the memory and the setup come through a load', s.map === 'kestrel' && s.gameMap.boat === 'sennen' && s.freeSetup.fuel === 0.4, JSON.stringify(s.gameMap));
  mem.set(KEY, '{not json');
  ok('not JSON: the defaults', S.loadSettings().map === 'kestrel');
  globalThis.localStorage = {
    getItem() { throw new Error('private window'); },
    setItem() { throw new Error('private window'); },
    removeItem() { throw new Error('private window'); },
  };
  let threw = '';
  try {
    const p = S.loadSettings();
    p.gameMap.flight = 'alpine';
    S.saveSettings(p);
    S.hasSavedSettings();
  } catch (e) {
    threw = e.message;
  }
  ok('storage that throws: loads and saves, and the game goes on', !threw, threw);
  globalThis.localStorage = plain;
}

/* ---- from the source ---- */
const main = src('src/main.js');
const writes = main.match(/settings\.gameMap = /g) || [];
ok('source: one place writes the memory', writes.length === 1, `${writes.length}`);
const setMap = main.slice(main.indexOf('  setMap(id) {'), main.indexOf('  async unlockAudio()'));
ok('source: and it is the map you chose (a borrowed one goes round setMap)', /settings\.gameMap = /.test(setMap));
const boot = main.slice(main.indexOf('  async boot() {'), main.indexOf("    this.state = 'menu';", main.indexOf('  async boot() {')));
ok('source: boot does not choose the World Map, only a hook does', !/worldPreview\.choose\b|choosePreview/.test(boot) && /flyChosen\(opts\)/.test(boot));
ok('source: the first load does not know the World Map\'s modules', !/worldmap\/preview/.test(main));
const wp = src('src/features/world-preview.js');
ok('source: the memory of the pin is the settings\', so Reset all takes it', /settings\.worldPin = /.test(wp));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

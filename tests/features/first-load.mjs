/**
 * FIRST LOAD (the Chromebook pass, 2026-10-30): what a first visit fetches
 * before the menu, checked against the source. Run from the repo root:
 *
 *   node tests/features/first-load.mjs
 *
 * The facts that have to hold:
 *   - main.js's STATIC module graph does not reach features/index.js, the
 *     Story, multiplayer, the live map, the World Map preview or the rest of
 *     the plug-ins: they come after the menu (loadFeatures). A budget on the
 *     graph's gzipped size and module count keeps the menu light as code is
 *     added (the baseline on v75.5 was 244 modules / 2.7 MB gzipped).
 *   - main.js fetches neither the Blender .glb vehicles nor the airline fonts
 *     before the menu, and registers the service worker only through
 *     installOffline(), which a player's boot does not call.
 *   - startMode / startDrive wait for featuresReady before starting.
 *   - game/extensions.js can install a feature that arrives late: into the
 *     standing world, and told a running mode has started.
 *   - sw.js serves code cache-first (a repeat visit on slow wifi does not
 *     download the game again) and precaches a few files at a time.
 * Every check here fails on v75.5.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

/* ---- the static graph from main.js ---- */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
function staticGraph(entry) {
  const nodes = new Map();
  const walk = (file) => {
    const rel = relative(ROOT, file);
    if (nodes.has(rel)) return;
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      nodes.set(rel, { gz: 0, missing: true });
      return;
    }
    nodes.set(rel, { gz: gzipSync(text, { level: 6 }).length });
    let m;
    while ((m = IMPORT_RE.exec(text))) {
      if (m[1].startsWith('.')) walk(resolve(dirname(file), m[1]));
    }
  };
  walk(resolve(ROOT, entry));
  return nodes;
}
const graph = staticGraph('src/main.js');
const gz = [...graph.values()].reduce((t, n) => t + n.gz, 0);
const has = (suffix) => [...graph.keys()].some((k) => k.endsWith(suffix));

ok('first-load: features/index.js is not in main.js\'s static graph', !has('src/features/index.js'));
ok('first-load: the Story is not in the static graph', !has('src/story/index.js'));
for (const heavy of ['src/features/multiplayer.js', 'src/features/livemap/livemap.js', 'src/features/world-preview.js', 'src/features/breakup.js', 'src/features/traffic.js', 'src/features/achievements/index.js', 'src/world/worldmap/preview-data.js']) {
  ok(`first-load: ${heavy} waits for the menu`, !has(heavy));
}
ok('first-load: no missing module in the static graph', ![...graph.values()].some((n) => n.missing));
// The budget: v75.5 was 244 modules / 2714 KB gzipped before the menu; the target is well under 1.6 MB.
ok('first-load: the static graph is at most 160 modules', graph.size <= 160, `${graph.size} modules`);
ok('first-load: the static graph is at most 1.6 MB gzipped', gz <= 1.6 * 1024 * 1024, `${(gz / 1024).toFixed(0)} KB`);

/* ---- main.js: what boot does and does not do ---- */
const main = src('src/main.js');
const bootStart = main.indexOf('  async boot() {');
const menuAt = main.indexOf("    this.state = 'menu';", bootStart);
ok('first-load: boot() and its menu line are where expected', bootStart > 0 && menuAt > bootStart);
const boot = main.slice(bootStart, menuAt);
ok('first-load: boot() does not fetch the Blender vehicles before the menu', !/preloadVehicleModels\(\)/.test(boot));
ok('first-load: boot() does not fetch the airline fonts before the menu', !/loadAirlineFonts\(\)/.test(boot));
ok('first-load: boot() does not import the features before the menu on the player\'s path', /if \(!this\.playerPath\) \{\s*setLoad\([^)]*\);[\s\S]*?await this\.loadFeatures\(\{ lateJoin: false \}\);/.test(boot));
ok('first-load: the features are imported dynamically after the menu, and join the standing world', /loadFeatures\(\{ lateJoin = true \} = \{\}\) \{[\s\S]*?import\('\.\/features\/index\.js'\)/.test(main) && main.indexOf('this.loadFeatures({ lateJoin: true });', menuAt) > 0 && /lateJoin \? extLateJoin\(this, THREE\) : \[\]/.test(main));
const registrations = main.match(/\.register\('sw\.js'\)/g) || [];
ok('first-load: the service worker is registered in one place, installOffline()', registrations.length === 1 && /installOffline\(why[^)]*\) \{[\s\S]*?\.register\('sw\.js'\)/.test(main));
ok('first-load: a player\'s boot defers the registration (first flight, 30 s on the menu, or idle after the bundle and the binaries)', /this\._offlineTimer = setTimeout\(\(\) => this\.installOffline\('menu-idle'\), 30000\)/.test(main) && /this\.featuresReady\.then\(\(\) => \(this\._binariesLoading \|\| Promise\.resolve\(\)\)\)\.then\(\(\) => \{\s*if \(typeof requestIdleCallback === 'function'\) requestIdleCallback\(\(\) => this\.installOffline\('idle'\)/.test(main));
ok('first-load: the first flight registers the offline copy', /this\.installOffline\('first-flight'\)/.test(main) && /this\.installOffline\('first-drive'\)/.test(main));
const startMode = main.slice(main.indexOf('  async startMode(mode, opts = {}) {'));
ok('first-load: startMode waits for featuresReady, then goes through the wrapped startMode again', /if \(!this\._featuresIn\) \{\s*await this\.featuresReady;\s*return this\.startMode\(mode, opts\);/.test(startMode.slice(0, 1200)));
const startDrive = main.slice(main.indexOf("  startDrive(kind = 'boat', opts = {}) {"));
ok('first-load: startDrive waits for featuresReady', /if \(!this\._featuresIn\) \{\s*this\.featuresReady\.then\(\(\) => this\.startDrive\(kind, opts\)\);\s*return;/.test(startDrive.slice(0, 600)));
// The checker's pass: the .glb parse (about a second of main thread on a Celeron) must not land in the first flight.
const loadFeat = main.slice(main.indexOf('  loadFeatures({ lateJoin = true } = {}) {'));
ok('first-load: the Blender vehicles are fetched at once but parsed off the flight on the player\'s path', /const gate = this\.playerPath \? \(\) => this\.offFlight\(\) : \(\) => Promise\.resolve\(\);\s*jobs\.push\(\s*preloadVehicleModels\(\{\s*load: \(url\) =>[\s\S]*?\.then\(\(buf\) => gate\(\)\.then\(\(\) => buf\)\)/.test(loadFeat.slice(0, 4000)));
ok('first-load: offFlight() waits while a flight runs', /offFlight\(\) \{\s*return new Promise\(\(resolve\) => \{\s*const check = \(\) => \(this\.state === 'flying' \? setTimeout\(check, 500\) : resolve\(\)\);/.test(main));
ok('first-load: startMode rebuilds a helicopter whose Blender model arrived after its stand-in was built', /BLENDER_AIRCRAFT\[this\.aircraftType\.id\] && !this\.model\.userData\.blenderModel\) \{\s*const st = blenderModelStatus\(\);\s*if \(st\.enabled !== false && st\[BLENDER_AIRCRAFT\[this\.aircraftType\.id\]\] === 'ready'\) this\.aircraftType = null;\s*\}\s*this\.setAircraft\(mode === 'free'/.test(startMode.slice(0, 6000)));
ok('first-load: the late features\' world groups are warmed on the menu, one after another, chunked', /if \(ids\.length\) this\.warmLateFeatures\(ids\);/.test(main) && /warmLateFeatures\(ids\) \{[\s\S]*?\.reduce\(\(p, g\) => p\.then\(\(\) => \(g\.parent \? this\.warmShaders\(g, \{ chunked: true \}\) : false\)\), Promise\.resolve\(\)\)/.test(main));
{
  const warm = src('src/render/shader-warm.js');
  ok('first-load: shader-warm uses its own compileAsync, which waits for no program a disposed material lost', /export function compileAsyncSafe\(renderer, object, camera, scene\)/.test(warm) && /ready = !prog \|\| typeof prog\.isReady !== 'function' \|\| prog\.isReady\(\);/.test(warm) && /fn === 'compileAsync' && renderer\.properties \? compileAsyncSafe\(/.test(warm));
}
ok('first-load: an import cut short by the update reload is not logged as an error', /if \(this\._reloadingForUpdate\) console\.info\('\[features\] the import was cut short by the update reload'\);\s*else console\.error\('\[features\] the feature bundle failed to load/.test(main));
ok('first-load: main.js reaches the achievement notes through the no-import shim', /from '\.\/features\/achievements\/notes\.js'/.test(main) && !/from '\.\/features\/achievements\/index\.js'/.test(main));
const notes = src('src/features/achievements/notes.js');
ok('first-load: the notes shim imports nothing', !/^\s*import\s/m.test(notes));
ok('first-load: achievements/index.js plugs its notes into the shim', /setAchievementNotes\(\{ noteLiftoff, noteTouchdown, noteArrested, noteCeiling, noteMissionComplete \}\)/.test(src('src/features/achievements/index.js')));

/* ---- extensions.js: a late feature joins the standing world ---- */
global.window = global.window || { addEventListener() {}, removeEventListener() {} };
global.document = global.document || { createElement: () => ({ style: {}, appendChild() {} }), body: { appendChild() {} }, documentElement: { classList: { toggle() {} } } };
const Ext = await import(new URL('../../src/game/extensions.js', import.meta.url).href);
ok('first-load: extensions.js exports extLateJoin and extInstalled', typeof Ext.extLateJoin === 'function' && typeof Ext.extInstalled === 'function');
{
  const calls = [];
  class Group { constructor() { this.name = ''; } }
  const THREE = { Group };
  const scene = { add: (g) => calls.push(['scene.add', g.name]) };
  const sim = { scene, worldGroups: [], state: 'menu', mode: null, modeOpts: null };
  Ext.registerExtension({ id: 'fl-early', install: () => calls.push(['install', 'fl-early']) });
  const first = Ext.extInstall(sim);
  ok('first-load: extInstall returns the newcomers it installed', first.length === 1 && first[0].id === 'fl-early');
  const again = Ext.extInstall(sim);
  ok('first-load: a second extInstall installs nothing twice', again.length === 0 && calls.filter((c) => c[0] === 'install' && c[1] === 'fl-early').length === 1);
  // The bundle lands while the menu world stands: the newcomer gets its group in that world.
  Ext.registerExtension({
    id: 'fl-late',
    install: () => calls.push(['install', 'fl-late']),
    buildWorld: (s, g) => calls.push(['buildWorld', g.name]),
    startMode: (s, mode) => calls.push(['startMode', mode]),
  });
  Ext.registerExtension({ id: 'fl-late-noinstall', buildWorld: (s, g) => calls.push(['buildWorld', g.name]) });
  const ids = Ext.extLateJoin(sim, THREE);
  ok('first-load: extLateJoin installs only the newcomers', ids.length === 2 && ids.includes('fl-late') && ids.includes('fl-late-noinstall'), JSON.stringify(ids));
  ok('first-load: a late feature is built into the standing world', calls.some((c) => c[0] === 'buildWorld' && c[1] === 'ext:fl-late') && calls.some((c) => c[0] === 'buildWorld' && c[1] === 'ext:fl-late-noinstall') && sim.worldGroups.length === 2 && calls.some((c) => c[0] === 'scene.add'));
  ok('first-load: on the menu no startMode is replayed', !calls.some((c) => c[0] === 'startMode'));
  // The player took off before the bundle came: the newcomer is told the flight started.
  sim.state = 'flying'; sim.mode = 'free'; sim.modeOpts = { aircraft: 'skylark' };
  Ext.registerExtension({ id: 'fl-midflight', startMode: (s, mode, opts) => calls.push(['startMode', mode, opts.aircraft]) });
  const ids2 = Ext.extLateJoin(sim, THREE);
  ok('first-load: a feature landing mid-flight is told the mode started', ids2.length === 1 && calls.some((c) => c[0] === 'startMode' && c[1] === 'free' && c[2] === 'skylark'));
  ok('first-load: extInstalled lists them all', ['fl-early', 'fl-late', 'fl-late-noinstall', 'fl-midflight'].every((id) => Ext.extInstalled().includes(id)));
}

/* ---- sw.js ---- */
const sw = src('sw.js');
ok('first-load: sw.js precaches at most 3 files at a time', /const PRECACHE_PARALLEL = [123];/.test(sw));
ok('first-load: sw.js serves code cache-first (no network race for modules)', /if \(hit && isCode\) return hit;/.test(sw) && !/if \(isCode\) \{\s*event\.respondWith/.test(sw));
ok('first-load: sw.js still serves a navigation network-first with the 2.5 s timer', /if \(req\.mode === 'navigate'\) \{[\s\S]*?setTimeout\(\(\) => rej\(new Error\('slow'\)\), 2500\)/.test(sw));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

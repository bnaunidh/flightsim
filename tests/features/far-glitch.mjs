/**
 * Node checks for the instruments giving out deep in the Farlands
 * (src/features/far-glitch.js).
 *
 *   node tests/features/far-glitch.mjs
 *
 *   - the curve: 0 everywhere before a quarter of the way into the Farlands
 *     (RANGE_DEEP + 25 km), rising without a dip to 1 at the edge, 1 all
 *     through the void
 *   - for an aeroplane: 0 on any map but the World Map, and 0 at home on it
 *   - the radio's garble leaves a line before the threshold alone, and never
 *     a word's spaces
 *   - the picked changes are held for at least a third of a second (WCAG
 *     2.3.1), and the intensity eases, so a teleport never snaps
 *   - the module is lazy: nothing of it in main.js's static graph, nor in
 *     features/index.js; it comes with the ring (world-preview.js loadRing)
 *   - no file of the other lane's is touched for it
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(resolve(ROOT, p), 'utf8');

global.document = global.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {}, appendChild() {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
  }),
  body: { appendChild() {} },
  head: { appendChild() {} },
  documentElement: { classList: { toggle() {}, add() {}, remove() {} } },
  getElementById: () => null,
};
const store = new Map();
global.localStorage = global.localStorage || { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global.window || { addEventListener() {}, removeEventListener() {} };

let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} far-glitch: ${name}${detail ? ` -- ${detail}` : ''}`);
};

const F = await import('../../src/world/worldmap/farlands.js');
const G = await import('../../src/features/far-glitch.js');
const T = await import('../../src/world/terrain.js');
const WP = await import('../../src/features/world-preview.js');
const { glitchIntensity, intensityFor, START_D, TICK_S, EASE_PER_S, garble, K } = G;

/* ---- the curve ---- */
ok('the failures start a quarter of the way into the Farlands', START_D === F.RANGE_DEEP + F.FAR_DEEP / 4 && START_D === 65000, `${START_D} m`);
let before = 0;
for (let d = -200000; d <= START_D; d += 250) if (glitchIntensity(d) !== 0) before++;
ok('0 everywhere before the quarter mark (the sea, the range, the first 25 km)', before === 0, `${before} points off`);
let dips = 0;
let prev = 0;
for (let d = START_D; d <= F.EDGE_D; d += 100) {
  const k = glitchIntensity(d);
  if (k < prev - 1e-12) dips++;
  prev = k;
}
ok('rises without a dip to the edge', dips === 0, `${dips} dips`);
ok('exactly 1 at the edge', glitchIntensity(F.EDGE_D) === 1, String(glitchIntensity(F.EDGE_D)));
ok('about 0.5 half way', Math.abs(glitchIntensity((START_D + F.EDGE_D) / 2) - 0.5) < 1e-9, glitchIntensity((START_D + F.EDGE_D) / 2).toFixed(3));
ok('just past the quarter mark it is small but on', glitchIntensity(START_D + 2000) > 0 && glitchIntensity(START_D + 2000) < 0.01, glitchIntensity(START_D + 2000).toFixed(4));
let voidOff = 0;
for (let d = F.EDGE_D; d <= F.EDGE_D + 400000; d += 500) if (glitchIntensity(d) !== 1) voidOff++;
ok('1 all through the void', voidOff === 0, `${voidOff} points off`);
ok('nothing for a NaN or an undefined depth', glitchIntensity(NaN) === 0 && glitchIntensity(undefined) === 0);
ok('the order of the thresholds', K.clock < K.autopilot && K.autopilot < K.numbers && K.numbers < K.dashes && K.dashes < K.spin && K.spin < K.freeze && K.freeze < 1, JSON.stringify(K));

/* ---- for an aeroplane ---- */
const SH = F.SEA_HALF;
const fake = (x, z) => ({ aircraft: { pos: { x, y: 3000, z }, ias: 50, alt: 900, agl: 800, vs: 0, heading: 90 }, state: 'flying' });
const was = T.MAP.id;
ok('0 on the map the game boots on', !WP.active() && intensityFor(fake(SH + 120000, 0)) === 0, `map ${T.MAP.id}`);
// The World Map, by its def (world/worldmap/preview.js), as choosing it does.
const { previewDef } = await import('../../src/world/worldmap/preview.js');
const def = previewDef();
if (def && T.MAP) {
  const saved = { ...T.MAP };
  Object.assign(T.MAP, def);
  ok('on the World Map: 0 at home', WP.active() && intensityFor(fake(0, 0)) === 0, `active ${WP.active()}`);
  ok('on the World Map: 0 in the range and the first quarter', intensityFor(fake(SH + 20000, 0)) === 0 && intensityFor(fake(SH + START_D - 100, 0)) === 0);
  ok('on the World Map: on deep in, by depthOf, on every side', intensityFor(fake(SH + 120000, 0)) > 0.5 && intensityFor(fake(0, -SH - 120000)) > 0.5 && intensityFor(fake(-SH - 120000, 0)) > 0.5);
  ok('on the World Map: 1 in the void', intensityFor(fake(SH + F.EDGE_D + 30000, 0)) === 1);
  // Nullspire (owner, 2026-11-08: "make instruments come back near nullspire").
  const C = await import('../../src/world/worldmap/void-city.js');
  const at = (dx, dz) => intensityFor(fake(C.CITY.x + dx, C.CITY.z + dz));
  ok('Nullspire: the void around it is still dead', glitchIntensity(F.depthOf(C.CITY.x, C.CITY.z)) === 1 && at(0, -G.CLEAR_OUT - 5000) === 1, `${at(0, -G.CLEAR_OUT - 5000)}`);
  ok('Nullspire: every instrument reads true over the city and the field', at(0, 0) === 0 && at(C.CITY_FIELD.x - C.CITY.x, C.CITY_FIELD.z - C.CITY.z) === 0 && at(C.SLAB_RX, 0) === 0);
  const ap = C.approachStart();
  ok('Nullspire: true on the long final the teleport puts you on', intensityFor(fake(ap.x, ap.z)) === 0, `${(C.cityDist(ap.x, ap.z) / 1000).toFixed(1)} km out`);
  let rise = 0, prevC = -1;
  for (let d = 0; d <= G.CLEAR_OUT + 10000; d += 250) { const k = at(-d, 0); if (k < prevC - 1e-12) rise++; prevC = k; }
  ok('Nullspire: they give out again smoothly, flying away from it', rise === 0 && at(-(G.CLEAR_IN + G.CLEAR_OUT) / 2, 0) > 0.3 && at(-(G.CLEAR_IN + G.CLEAR_OUT) / 2, 0) < 0.7, `${rise} dips`);
  ok('Nullspire: the clear factor is pure and safe', G.cityClear(NaN) === 1 && G.cityClear(0) === 0 && G.cityClear(1e9) === 1);
  ok('no aeroplane, nothing', intensityFor({ state: 'flying' }) === 0 && intensityFor(null) === 0);
  for (const key of Object.keys(T.MAP)) delete T.MAP[key];
  Object.assign(T.MAP, saved);
  ok('the map is put back', T.MAP.id === was && !WP.active(), T.MAP.id);
} else ok('the World Map def is reachable for the check', false, 'previewDef missing');

/* ---- the radio ---- */
const line = 'Skylark two one, cleared to land runway zero nine, wind calm';
ok('a line under the dash threshold is not touched', garble(line, K.dashes) === line && garble(line, 0.2) === line);
const g1 = garble(line, 1);
ok('deep in, a line is garbled but the same length, spaces kept', g1 !== line && g1.length === line.length && [...line].every((c, i) => c !== ' ' || g1[i] === ' '), g1);
let changed = 0;
for (let i = 0; i < line.length; i++) if (g1[i] !== line[i]) changed++;
ok('and never all of it (a reader still gets some of the words)', changed > 0 && changed < line.length * 0.85, `${changed} of ${line.length}`);
ok('an empty line stays empty', garble('', 1) === '' && garble(null, 1) === null);

/* ---- flash safety, by construction ---- */
ok('picked changes hold for over a third of a second (WCAG 2.3.1)', TICK_S >= 0.34, `${TICK_S} s`);
ok('the intensity eases: a teleport to the void takes seconds to bite, and seconds to let go', EASE_PER_S > 0 && 1 / EASE_PER_S >= 2, `${(1 / EASE_PER_S).toFixed(1)} s for 0 to 1`);
const css = read('src/features/far-glitch.js');
ok('no CSS animation or keyframes of its own (transitions only)', !/@keyframes|animation:/.test(css));
ok('nothing of the game\'s physics is written to', !/ac\.(vel|pos|quat|omega|controls|fuel|engineOn)\s*=/.test(css) && !/\.crash\(/.test(css));

/* ---- lazy ---- */
const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
function staticGraph(entry) {
  const nodes = new Set();
  const walk = (file) => {
    if (nodes.has(file)) return;
    nodes.add(file);
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      return;
    }
    let m;
    while ((m = IMPORT_RE.exec(text))) if (m[1].startsWith('.')) walk(resolve(dirname(file), m[1]));
  };
  walk(resolve(ROOT, entry));
  return nodes;
}
const inMain = [...staticGraph('src/main.js')].some((f) => f.endsWith('far-glitch.js'));
const inFeatures = [...staticGraph('src/features/index.js')].some((f) => f.endsWith('far-glitch.js'));
ok('not in main.js\'s static graph (nothing on first load)', !inMain);
ok('not in features/index.js\'s graph either (nothing on any other map)', !inFeatures);
const wp = read('src/features/world-preview.js');
ok('loaded with the ring, from loadRing, and only after the ring', /RING\.then\(\(m\) => \(m \? import\('\.\/far-glitch\.js'\) : null\)\)/.test(wp));
ok('the other lane\'s files are not touched for it', !/far-glitch/.test(read('src/features/farlands-run.js')) && !/far-glitch/.test(read('src/world/worldmap/farlands.js')) && !/far-glitch/.test(read('src/world/worldmap/farlands-look.js')));
ok('reads the depth itself, from the ring\'s own exports', /import \{[^}]*depthOf[^}]*\} from '\.\.\/world\/worldmap\/farlands\.js'/.test(css));

console.log(`\nfar-glitch: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

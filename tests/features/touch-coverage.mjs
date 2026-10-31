/**
 * Node checks for the touch controls (src/ui/touch.js, src/ui/touch-coverage.js).
 *
 *   node tests/features/touch-coverage.mjs
 *
 * 1. EVERY ACTION HAS A THUMB. Every plug-in feature is imported for real, so
 *    the registry (flight/input.js ACTIONS) is the whole game's; each action
 *    is then looked up in TOUCH_COVERAGE: it has a touch control (and the
 *    file named really builds it — the id or the needle is in its source), or
 *    it is flagged desktop-only with a reason of at least a sentence. A row
 *    for an action that no longer exists fails too, so the table cannot rot.
 * 2. THE SHEETS. ui/touch.js builds the GROUND and SYSTEMS pads and sheets
 *    with the owner's list on them: the crew / pushback / stop, the push's
 *    way round, the parking brake, autopilot, assist, trim, look behind,
 *    mayday, map, range, controls. main.js answers each.
 * 3. THE PUSH'S WAY ROUND. airport-services.js takes a preference and
 *    refuses nonsense.
 *
 * The same thing with real taps in a real page is
 * tests/features/touch-coverage.browser.js; on emulated phone and tablet
 * screens, tests/features/touch-coverage.playtest.mjs.
 */

import { readFileSync, existsSync } from 'node:fs';

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);
const read = (p) => readFileSync(new URL(p, root), 'utf8');

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}

/* ---------------- 1. every action has a thumb ---------------- */

await load('src/features/index.js');
const { ACTIONS } = await load('src/flight/input.js');
const { TOUCH_COVERAGE, TOUCH_VIAS, coverageGaps } = await load('src/ui/touch-coverage.js');

const ids = Object.keys(ACTIONS);
ok('the registry is the whole game\'s (99 actions or more)', ids.length >= 99, `${ids.length} actions`);
const gaps = coverageGaps(ACTIONS);
ok('every registered action has a touch control or is flagged desktop-only', gaps.missing.length === 0, gaps.missing.length ? `no touch row: ${gaps.missing.join(', ')}` : 'all covered');
ok('no row is for an action that no longer exists', gaps.stale.length === 0, gaps.stale.join(', ') || 'none stale');
ok('every row is well formed (a way in TOUCH_VIAS, a where and a file; or a desktop-only reason of a sentence)', gaps.bad.length === 0, gaps.bad.join(', ') || 'all well formed');

const sources = new Map();
const src = (f) => {
  if (!sources.has(f)) sources.set(f, existsSync(new URL(f, root)) ? read(f) : null);
  return sources.get(f);
};
const unbacked = [];
const desktopOnly = [];
const byVia = {};
for (const id of ids) {
  const c = TOUCH_COVERAGE[id];
  if (!c) continue;
  if (c.desktopOnly) {
    desktopOnly.push(id);
    continue;
  }
  byVia[c.via] = (byVia[c.via] || 0) + 1;
  const text = src(c.file);
  const needle = c.needle || `'${id}'`;
  if (text === null) unbacked.push(`${id}: ${c.file} does not exist`);
  else if (!text.includes(needle)) unbacked.push(`${id}: ${c.file} has no "${needle}"`);
}
ok('every touch row names a file that really builds the control (the id or its needle is in the source)', unbacked.length === 0, unbacked.join('; ') || `${ids.length - desktopOnly.length} rows backed by source`);
{
  // Last Flight Out (features/scp-escape.js): closing the ramp is the mission's one decision, so it has a
  // big round button of its own on a touch screen as well as the card's, and shares the ramp key by design.
  const row = TOUCH_COVERAGE.lastFlightClose;
  const lfo = src('src/features/scp-escape.js') || '';
  ok('Last Flight Out: Close ramp has a feature button in the table, built in its source, 92 px round, with the card\'s own button beside it',
    !!row && row.via === 'feature' && /lfo-go/.test(lfo) && /\.lfo-go \{[^}]*width: 92px; height: 92px/.test(lfo) && /lfo-btn/.test(lfo) && ACTIONS.lastFlightClose && ACTIONS.lastFlightClose.default[0] === 'Digit6' && ACTIONS.cargoRamp.default.includes('Digit6'),
    row ? `${row.via}: ${row.where}` : 'no row');
}
ok('the desktop-only list is short: the parachute\'s two look keys and the hijack\'s cut-scene skip, nothing else',
  desktopOnly.length <= 3 && desktopOnly.every((id) => ['chuteLookLeft', 'chuteLookRight', 'eventSkip'].includes(id)),
  desktopOnly.join(', '));
ok('the ways a finger reaches things are all in use', TOUCH_VIAS.filter((v) => v !== 'pill').every((v) => byVia[v]), Object.entries(byVia).map(([v, n]) => `${v} ${n}`).join(' · '));

/* ---------------- 2. the sheets ---------------- */

const touch = read('src/ui/touch.js');
ok('ui/touch.js builds the two sheet pads, GROUND and SYSTEMS', /sheetPad\('GROUND', 'ground'\)/.test(touch) && /sheetPad\('SYSTEMS', 'systems'\)/.test(touch));
const wanted = {
  'the ground crew / pushback / stop button': "'services'",
  'push back nose left': "'pushNoseLeft'",
  'push back nose right': "'pushNoseRight'",
  'push back the tug\'s way (auto)': "'pushAuto'",
  'the parking brake': "'parkingBrake'",
  autopilot: "'autopilot'",
  'the helicopter\'s assist': "'heliAssist'",
  'trim nose down (held)': "'trimDown', { hold: true }",
  'trim nose up (held)': "'trimUp', { hold: true }",
  'trim neutral': "'trimReset'",
  'look behind (held)': "'lookBehind', { hold: true",
  'the mayday': "'brace'",
  'the map': "'minimap'",
  'the map range': "'minimapRange'",
  'the controls card': "'help'",
};
const notOnSheet = Object.entries(wanted).filter(([, n]) => !touch.includes(n)).map(([k]) => k);
ok('the sheets carry the owner\'s list: crew, pushback and stop, its way round, parking brake, autopilot, assist, trim, look behind, mayday, map, range, controls', notOnSheet.length === 0, notOnSheet.join(', ') || `${Object.keys(wanted).length} buttons`);
ok('the GROUND pad is the aeroplane\'s (hidden in the helicopter with the other wing pads) and starts hidden', /groundPad\.classList\.add\('is-wing'\)/.test(touch) && /groundPad\.hidden = true/.test(touch));
ok('a sheet closing lets go of every held key, and hiding the layer closes the sheets', /releaseHolds\(\)/.test(touch) && /setVisible\(on\) \{\s*if \(!on\) this\.closeSheets\(\);/.test(touch));
ok('the sheet is placed by measuring the stick, the pads and the rudder, never by a guessed pixel', /placeSheet\(s\)/.test(touch) && /getBoundingClientRect/.test(touch.slice(touch.indexOf('placeSheet(s) {'))));

const main = read('src/main.js');
ok('main.js wires the sheets: onHold and state into TouchControls, holdAction and touchState', /onHold: \(a, down\) => this\.holdAction\(a, down\)/.test(main) && /state: \(\) => this\.touchState\(\)/.test(main) && /^\s+holdAction\(a, down\) \{/m.test(main) && /^\s+touchState\(\) \{/m.test(main));
const answers = ['parkingBrake', 'pushAuto', 'pushNoseLeft', 'pushNoseRight', 'heliAssist', 'trimReset', 'emergencyLand', 'emergencyCircle'];
const unanswered = answers.filter((a) => !new RegExp(`case '${a}'`).test(main));
ok('hudAction answers the sheets\' own actions and the mayday card\'s two answers', unanswered.length === 0, unanswered.join(', ') || answers.join(', '));
ok('hudAction\'s default presses a registered action\'s own key, so Settings → Controls still applies', /default:[\s\S]{0,400}if \(ACTIONS\[a\]\)[\s\S]{0,200}this\.tap\(code\)/.test(main));
ok('the mayday card\'s rows are buttons that answer (ui/hud.js)', /button[^>]*class="hud-choice-row"[^>]*data-choice/.test(read('src/ui/hud.js')) && /action: 'emergencyLand'/.test(main) && /action: 'emergencyCircle'/.test(main));

const css = read('styles/main.css');
ok('the sheet and its buttons have styles, with 44 px targets', /\.touch-sheet \{/.test(css) && /\.touch-sheet-btn \{[^}]*min-height: 48px/.test(css) && /\.touch-sheet-close \{[^}]*height: 44px/.test(css));
ok('a phone on its side (760 px or wider) puts the pads three to a row, and narrows the rudder bar clear of them', /@media \(max-height: 460px\) and \(min-width: 760px\) \{[\s\S]{0,900}\.hud\.is-touch \.touch-pads \{ grid-template-columns: repeat\(3, 62px\); gap: 8px; \}/.test(css) && /\.hud\.is-touch:not\(\.is-boat\) \.touch-rudder \{ width: min\(230px, 26vw\); \}/.test(css));
ok('the stand prompt steps aside while a sheet is open', /html\.has-touch-sheet \.ap-prompt \{ opacity: 0 !important/.test(css) && /has-touch-sheet/.test(touch));
ok('the van hides the sheet pads with the other flight pads (vehicles/driving.js)', /this\.groundPad, this\.systemsPad/.test(read('src/vehicles/driving.js')));

/* ---------------- 3. the push's way round ---------------- */

const SVC = await load('src/features/airport-services.js');
const X = SVC.__airportServices;
ok('airport-services exposes the push preference', typeof X.setPushPref === 'function' && typeof X.pushPref === 'function' && Array.isArray(SVC.PUSH_PREFS));
ok('it starts as auto (the tug\'s choice, towards the runway)', X.pushPref() === 'auto', X.pushPref());
ok('nose left and nose right are remembered', X.setPushPref('noseLeft') === 'noseLeft' && X.pushPref() === 'noseLeft' && X.setPushPref('noseRight') === 'noseRight');
ok('anything else is auto', X.setPushPref('sideways') === 'auto' && X.setPushPref(null) === 'auto');
const svcSrc = read('src/features/airport-services.js');
ok('planPush tries the asked-for way first, and still the other way when that one is blocked', /S\.pushPref === 'noseLeft' \? 1 : S\.pushPref === 'noseRight' \? -1/.test(svcSrc) && /for \(const turn of (found \? \[\] : )?\[first, -first\]\)/.test(svcSrc));

/* ---------------- report ---------------- */

let fails = 0;
for (const r of results) {
  if (!r.pass) fails++;
  console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
}
console.log(`\n${results.length - fails}/${results.length} passed`);
process.exit(fails ? 1 : 0);

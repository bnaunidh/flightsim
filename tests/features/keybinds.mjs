/**
 * Node checks for the one key registry (src/flight/input.js) and Settings →
 * Controls. Run from the repo root with plain node:
 *
 *   node tests/features/keybinds.mjs
 *
 * 1. EVERY KEY IS AN ACTION. Every plug-in feature is imported for real and
 *    every action checked: a label, a group, the games it listens in, its
 *    default keys — and no two of the defaults clash.
 * 2. NOTHING HARD-CODED. The features, games, vehicles and HUDs are read as
 *    text and fail on a raw key code compared with, looked up in a held-keys
 *    table or tested in a Set — `code === 'KeyO'`, `K.KeyW`, `.has('Space')`.
 *    A feature asks the registry: isKey(sim, 'getOut', code). The only raw
 *    codes allowed outside a registerActions() default are the handful of
 *    browser keys that are nobody's action (Esc, Tab, Cmd, Alt), and the
 *    dialog boxes' own Enter / Esc (a form, not a game key).
 * 3. THE INPUT. A real Input on stand-in browser globals: rebinding, the
 *    clash question and its swap, per-game reset, reset all, saving, the
 *    helicopter's and the boat's own keys through Input.update(), and the
 *    hints naming the player's key (rekey, keyName, kbd).
 *
 * The same thing through the real Settings screen in a real page is
 * tests/features/keybinds.browser.js.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
}

/* ---------------- 1. every feature's keys are in the registry ---------------- */

await load('src/features/index.js');
const I = await load('src/flight/input.js');
const { ACTIONS, GROUPS, CONTEXTS, defaultBindings, findConflicts, groupedActions } = I;

const groupIds = GROUPS.map((g) => g.id);
const ids = Object.keys(ACTIONS);
ok('the registry has every game and feature in it (99 actions or more)', ids.length >= 99, `${ids.length} actions`);
const badShape = ids.filter((id) => {
  const a = ACTIONS[id];
  return !a.label || !groupIds.includes(a.group) || !Array.isArray(a.ctx) || !a.ctx.length
    || a.ctx.some((c) => !CONTEXTS.includes(c)) || !Array.isArray(a.default) || !a.default.length;
});
ok('every action has a label, a group, its games and default keys', badShape.length === 0, badShape.join(', ') || 'all well formed');
const clashes = findConflicts(defaultBindings());
ok('no two default keys clash (shares like Space = brakes and PvP fire are by design)', Object.keys(clashes).length === 0, JSON.stringify(clashes).slice(0, 300));

const counts = {};
for (const g of groupedActions()) counts[g.id] = g.items.length;
const needGroups = ['Flying', 'Helicopter', 'Boat', 'Car', 'Rocket', 'On foot', 'Multiplayer & PvP', 'Fun Stuff', 'Missions & events', 'View', 'Game'];
const empty = needGroups.filter((g) => !counts[g]);
ok('every game has a group of its own keys', empty.length === 0, `${Object.entries(counts).map(([g, n]) => `${g} ${n}`).join(' · ')}${empty.length ? ` — empty: ${empty.join(', ')}` : ''}`);

// The ones the owner named, each a real action now.
const named = {
  'O get out': 'getOut', 'Enter eject': 'eject', 'Enter fly again': 'flyAgain', 'Backspace self-destruct': 'selfDestruct',
  'T smoke': 'smoke', 'Space PvP fire': 'pvpFire', 'the rocket launch': 'rocketAction', 'the rocket burn': 'rocketBurn',
  'helicopter up': 'heliUp', 'boat faster': 'boatFaster', 'van go': 'carGo', 'walk forward': 'walkForward',
  'F-35B hover': 'stovlHover', 'event answer 8': 'eventChoice1', 'squawk 7': 'eventSquawk', 'water drop': 'drop',
  'H help': 'help', 'hush warnings R': 'ackWarnings', 'ground crew Y': 'services', 'zapper Z': 'zap',
  'player list Tab': 'mpPlayers', 'quick chat 3': 'mpChat1', 'wands': 'marshalCome', 'parachute steer': 'chuteLeft',
};
const missing = Object.entries(named).filter(([, id]) => !ACTIONS[id]).map(([k]) => k);
ok('every key named in the request is an action', missing.length === 0, missing.join(', ') || Object.keys(named).length + ' found');
const want = { getOut: 'KeyO', eject: 'Enter', flyAgain: 'Enter', selfDestruct: 'Backspace', smoke: 'KeyT', pvpFire: 'Space', rocketAction: 'Space', eventChoice1: 'Digit8', eventSquawk: 'Digit7', help: 'KeyH', ackWarnings: 'KeyR', services: 'KeyY', zap: 'KeyZ', mpPlayers: 'Tab', mpChat1: 'Digit3', heliUp: 'ShiftLeft', carGo: 'KeyW', boatStop: 'Space' };
const moved = Object.entries(want).filter(([id, code]) => !ACTIONS[id] || !ACTIONS[id].default.includes(code)).map(([id, c]) => `${id} (${c})`);
ok('defaults are what they always were', moved.length === 0, moved.join(', ') || 'unchanged');

/* ---------------- 2. no stray hard-coded key codes ---------------- */

const CODE = String.raw`(?:Key[A-Z]|Digit\d|Numpad\w+|Arrow(?:Up|Down|Left|Right)|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Meta(?:Left|Right)|Space|Enter|Backspace|Escape|Tab|Period|Comma|Slash|Semicolon|Quote|Minus|Equal)`;
const RULES = [
  { why: 'a key code compared', re: new RegExp(String.raw`\b(?:code|\w+\.code)\s*[!=]==?\s*'${CODE}'|'${CODE}'\s*[!=]==?\s*(?:code|\w+\.code)\b`) },
  { why: 'a held-keys table read by code', re: new RegExp(String.raw`\b(?:K|keys|S\.keys|R\.keys)\.${CODE}\b`) },
  { why: 'a key code looked up', re: new RegExp(String.raw`\.(?:has|includes|indexOf|add|delete)\('${CODE}'\)`) },
  { why: 'a switch on key codes', re: new RegExp(String.raw`case '${CODE}':`) },
  { why: 'a set of key codes', re: new RegExp(String.raw`new Set\(\[[^\]]*'(?!Escape'|Tab'|MetaLeft'|MetaRight'|AltLeft'|AltRight')${CODE}'`) },
];
const SCAN = ['src/features', 'src/game', 'src/vehicles', 'src/ui', 'src/main.js', 'src/flight/camera.js', 'src/flight/autopilot.js', 'src/aircraft', 'src/fleet', 'src/world', 'src/audio'];
const files = [];
const walk = (p) => {
  const abs = new URL(p, root).pathname;
  if (statSync(abs).isDirectory()) for (const f of readdirSync(abs)) walk(join(p, f));
  else if (p.endsWith('.js')) files.push(p);
};
for (const p of SCAN) walk(p);
const stray = [];
for (const f of files) {
  const lines = readFileSync(new URL(f, root), 'utf8').split('\n');
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t.startsWith('*') || t.startsWith('//') || t.startsWith('/*')) return;
    for (const r of RULES) if (r.re.test(line)) stray.push(`${f}:${i + 1} ${r.why}: ${t.slice(0, 90)}`);
  });
}
ok(`no feature, game or HUD hard-codes a key (${files.length} files read)`, stray.length === 0, stray.slice(0, 8).join('\n  ') || 'every key goes through the registry');

// A plain e.key check is a form's own Enter / Esc (the briefing card, a code
// box, the search box, the tray) — never a game key. List them so a new one
// is a decision, not an accident.
const FORM_KEYS = new Set(['src/ui/briefing.js', 'src/ui/menus.js', 'src/ui/hud.js', 'src/features/multiplayer/ui.js', 'src/features/multiplayer/lobbyui.js', 'src/features/owner.js']);
const formHits = [];
for (const f of files) {
  const s = readFileSync(new URL(f, root), 'utf8');
  if (/\be\.key\s*===\s*'(Enter|Escape)'/.test(s) && !FORM_KEYS.has(f)) formHits.push(f);
}
ok('the only e.key checks are form keys in the known dialogs', formHits.length === 0, formHits.join(', ') || `${FORM_KEYS.size} dialogs`);

/* ---------------- 3. the input itself ---------------- */

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const win = new EventTarget();
globalThis.window = win;
const dom = { addEventListener() {}, removeEventListener() {}, requestPointerLock() {} };
const fire = (type, code) => {
  const e = new Event(type, { cancelable: true });
  e.code = code;
  win.dispatchEvent(e);
  return e;
};

const inp = new I.Input(dom);
ok('a fresh Input has every registered action on its defaults', ids.every((id) => JSON.stringify(inp.bindings[id]) === JSON.stringify(ACTIONS[id].default)), '');
ok('no clash on the defaults (as Settings sees them)', Object.keys(inp.conflicts()).length === 0, JSON.stringify(inp.conflicts()).slice(0, 200));

// Eject onto K: K is the map range, in the same game — the clash question.
const c1 = inp.clashes('eject', 'KeyK');
ok('a key that already does something in the same game is a clash: "K already does Map range"', c1.length === 1 && c1[0].id === 'minimapRange', JSON.stringify(c1));
// Get out onto W: Get out works in every vehicle AND on foot, so W clashes with all of their W's.
const c2 = inp.clashes('getOut', 'KeyW');
ok('Get out (every vehicle, and on foot) onto W clashes with pitch, the van, the boat and walking', ['pitchDown', 'carGo', 'boatFaster', 'walkForward'].every((id) => c2.some((c) => c.id === id)), c2.map((c) => c.id).join(', '));
// A key in another game only is not a clash: the rocket's lean is A, the aeroplane's roll is A.
ok('a key used only in another game is not a clash (the rocket\'s keys vs the aeroplane\'s)', inp.clashes('rocketLeanLeft', 'KeyQ').length === 0, JSON.stringify(inp.clashes('rocketLeanLeft', 'KeyQ')));

// Swap: eject ↔ self-destruct. Eject goes on Backspace, self-destruct gets Enter.
const preview = inp.bind('eject', 'Backspace', { swap: true, dryRun: true });
ok('the swap question can say what the other one will get, without changing anything', preview.length === 1 && preview[0].id === 'selfDestruct' && preview[0].gets === 'Enter' && inp.bindings.eject[0] === 'Enter', JSON.stringify(preview));
inp.bind('eject', 'Backspace', { swap: true });
ok('swapping puts eject on Backspace and self-destruct on Enter', inp.bindings.eject.join() === 'Backspace' && inp.bindings.selfDestruct.join() === 'Enter', `eject ${inp.bindings.eject} · self-destruct ${inp.bindings.selfDestruct}`);
ok('after a swap nothing clashes', Object.keys(inp.conflicts()).length === 0, JSON.stringify(inp.conflicts()).slice(0, 200));
const sim = { input: inp };
ok('the feature hook now answers to Backspace for eject, and not to Enter', I.isKey(sim, 'eject', 'Backspace') && !I.isKey(sim, 'eject', 'Enter') && !I.isKey(sim, 'eject', 'NumpadEnter'), '');
ok('the hints name Backspace', I.keyName('eject') === 'Backspace' && I.kbd('eject') === '<kbd class="k">Backspace</kbd>', `${I.keyName('eject')} ${I.kbd('eject')}`);

// A swap that would only move the clash somewhere else: eject onto K (the map
// range). Eject's old keys are Backspace now; the map range listens on foot
// too, where nothing has Backspace, so it gets it. Then walking forward onto
// J (the map): W would clash with the aeroplane's pitch, so the map is left with no key.
inp.bind('eject', 'KeyK', { swap: true });
ok('the map range takes eject\'s old key when that fits everywhere it listens', inp.bindings.minimapRange.join() === 'Backspace' && !Object.keys(inp.conflicts()).length, `map range ${inp.bindings.minimapRange}`);
const r2 = inp.bind('walkForward', 'KeyJ', { swap: true });
ok('...and when nothing fits, the other action is left with no key rather than a new clash', r2.length === 1 && r2[0].id === 'minimap' && r2[0].gets === null && inp.bindings.minimap.length === 0 && !Object.keys(inp.conflicts()).length, JSON.stringify(r2));
inp.resetBindings('Game');
inp.resetBindings('On foot');
inp.bind('eject', 'Backspace', { swap: true });

// Without a swap the key is shared and Settings marks the clash on both rows.
inp.bind('smoke', 'KeyG');
const cf = inp.conflicts();
ok('a clash left in place is marked on both actions', cf.smoke && cf.gear && cf.smoke[0].with.some((w) => w.id === 'gear'), Object.keys(cf).join(', '));
inp.resetBindings('Fun Stuff');
ok('Reset Fun Stuff keys puts smoke back on T and the clash goes', inp.bindings.smoke.join() === 'KeyT' && !inp.conflicts().smoke, inp.bindings.smoke.join());
ok('...and leaves the other groups as the player set them', inp.bindings.eject.join() === 'Backspace', inp.bindings.eject.join());

// Saved with the settings: a new Input (the next visit) has them.
const inp2 = new I.Input(dom);
ok('the keys are saved and come back on the next visit', inp2.bindings.eject.join() === 'Backspace' && inp2.bindings.selfDestruct.join() === 'Enter', `${inp2.bindings.eject} ${inp2.bindings.selfDestruct}`);
inp2.dispose();
I.useInput(inp);

// Keyboard: the held keys and a press, with the moved binding.
fire('keydown', 'Backspace');
ok('pressed() on the new key', inp.pressed('eject') && !inp.pressed('selfDestruct'), '');
fire('keyup', 'Backspace');
inp.endFrame();

// The hints the game wrote with the defaults name the player's key.
inp.context = 'plane';
inp.bind('gear', 'Semicolon');
ok('the coach line "Press <kbd>G</kbd>" names the moved gear key', I.rekey('Landing gear! Press <kbd>G</kbd> before you land') === 'Landing gear! Press <kbd>;</kbd> before you land', I.rekey('Landing gear! Press <kbd>G</kbd> before you land'));
inp.bind('drop', 'KeyB', { swap: true });
ok('a mission\'s "Press X to release" names the moved drop key', I.rekey('Press X to release the crate right over the yellow target!') === 'Press B to release the crate right over the yellow target!', I.rekey('Press X to release the crate right over the yellow target!'));
ok('...and the key it swapped with says its own new key ("Hold B" to look behind is now X)', I.rekey('Hold B to look behind') === 'Hold X to look behind', I.rekey('Hold B to look behind'));
ok('a hint already naming the live key (live()) is left alone', I.rekey(I.live('press X to drop')) === 'press X to drop', I.rekey(I.live('press X to drop')));
inp.context = 'car';
inp.bind('carGo', 'KeyI');
ok('in the van, "Go <kbd>W</kbd>" is the van\'s go key, not the aeroplane\'s', I.rekey('Go <kbd>W</kbd>/<kbd>&uarr;</kbd>') === 'Go <kbd>I</kbd>/<kbd>I</kbd>', I.rekey('Go <kbd>W</kbd>/<kbd>&uarr;</kbd>'));
inp.context = 'plane';
ok('the aeroplane\'s own W is not touched by the van\'s', I.rekey('lower the nose with <kbd>W</kbd>') === 'lower the nose with <kbd>W</kbd>', I.rekey('lower the nose with <kbd>W</kbd>'));

// Per-game keys through Input.update(): the helicopter and the boat.
inp.resetBindings();
inp.bind('heliForward', 'Semicolon');
fire('keydown', 'Semicolon');
let o = { pitch: 0 };
for (let i = 0; i < 30; i++) o = inp.update(1 / 60, { simple: true, map: I.HELI_MAP });
const heliNose = o.pitch;
fire('keyup', 'Semicolon');
for (let i = 0; i < 60; i++) inp.update(1 / 60, { simple: true, map: I.HELI_MAP });
fire('keydown', 'KeyW');
for (let i = 0; i < 30; i++) o = inp.update(1 / 60, { simple: true, map: I.HELI_MAP });
const heliW = o.pitch;
fire('keyup', 'KeyW');
for (let i = 0; i < 60; i++) inp.update(1 / 60, { simple: true });
fire('keydown', 'KeyW');
for (let i = 0; i < 30; i++) o = inp.update(1 / 60, { simple: true });
const planeW = o.pitch;
fire('keyup', 'KeyW');
ok('the helicopter flies forward on its own moved key, not on the aeroplane\'s W — and the aeroplane keeps W', heliNose < -0.5 && Math.abs(heliW) < 0.01 && planeW < -0.5, `heli ; ${heliNose.toFixed(2)}, heli W ${heliW.toFixed(2)}, plane W ${planeW.toFixed(2)}`);
for (let i = 0; i < 60; i++) inp.update(1 / 60, { simple: true });
fire('keydown', 'ArrowLeft');
for (let i = 0; i < 20; i++) o = inp.update(1 / 60, { simple: true, map: I.BOAT_MAP });
const boatArrow = o.roll;
inp.freeLook = true;
for (let i = 0; i < 60; i++) o = inp.update(1 / 60, { simple: true, map: I.BOAT_MAP });
const boatArrowLook = o.roll;
inp.freeLook = false;
fire('keyup', 'ArrowLeft');
ok('the boat steers on its arrows — and with free look on they are the camera\'s, as before', boatArrow < -0.5 && Math.abs(boatArrowLook) < 0.05, `arrow ${boatArrow.toFixed(2)}, with free look ${boatArrowLook.toFixed(2)}`);

inp.resetBindings();
ok('Reset all keys: every action back on its defaults', ids.every((id) => JSON.stringify(inp.bindings[id]) === JSON.stringify(ACTIONS[id].default)), '');
ok('...and the hints say the defaults again', I.rekey('Press <kbd>G</kbd>') === 'Press <kbd>G</kbd>' && I.keyName('eject') === 'Enter', `${I.rekey('Press <kbd>G</kbd>')} ${I.keyName('eject')}`);

// Esc cancels the "press a key" wait; any other key is handed over.
let got = 'none';
inp.listen((c) => { got = c; });
const ev = fire('keydown', 'Escape');
ok('Esc while Settings waits for a key cancels (and the game never sees it)', got === null && !inp.pressed('pause') && ev.defaultPrevented, `got ${got}`);
inp.listen((c) => { got = c; });
fire('keydown', 'KeyJ');
ok('any other key is the new key, and does not also fire its old action', got === 'KeyJ' && !inp.pressed('minimap'), `got ${got}`);
fire('keyup', 'KeyJ');

// A feature that registers after the game started gets its saved keys.
store.set('islandsim.bindings.v1', JSON.stringify({ ...inp.bindings, lateFeature: ['KeyZ'] }));
const inp3 = new I.Input(dom);
I.registerActions({ lateFeature: { label: 'A late one', group: 'Fun Stuff', ctx: ['plane'], default: ['Quote'] } });
ok('a feature registered later still gets the key the player saved for it', inp3.bindings.lateFeature && inp3.bindings.lateFeature.join() === 'KeyZ', String(inp3.bindings.lateFeature));
inp3.dispose();
I.useInput(inp);

/* ---------------- report ---------------- */

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

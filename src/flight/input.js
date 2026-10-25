/**
 * Input: keyboard (fully remappable), optional mouse flying and gamepad.
 *
 * Raw key presses are turned into smoothly moving control surfaces — real
 * controls do not snap to full deflection — and the springs recentre faster in
 * simplified mode so the aeroplane always settles down when you let go.
 *
 * ONE KEY REGISTRY. Every key the game listens to, in every game and every
 * plug-in feature, is a named action in ACTIONS below: a label a child can
 * read, a group (one per game, plus the shared ones), the games it works in
 * (`ctx`) and its default keys. The game's own actions are declared here; a
 * feature declares its own with registerActions() when it loads, and then
 * ASKS — isKey(sim, 'getOut', code), heldKey(sim, 'jump', keys),
 * keyName('eject') — instead of writing 'KeyO' into its code. That is what
 * lets Settings move any of them, and what lets the hints on the screen name
 * the key you actually have to press. tests/features/keybinds.mjs fails the
 * build if a feature goes back to comparing raw key codes.
 */

import { clamp, lerp } from '../core/noise.js';

/*
 * The games a key can belong to. Two actions may share a key when they never
 * listen at the same time (W walks on foot and pitches the aeroplane); they
 * clash when their games overlap.
 */
export const CONTEXTS = ['plane', 'heli', 'boat', 'car', 'rocket', 'foot', 'chute'];
const ALL = CONTEXTS;
const AIR = ['plane', 'heli'];
const VEHICLES = ['plane', 'heli', 'boat', 'car'];
/** Everywhere the game's own keys still work (the rocket takes every key but Pause and Mute). */
const NOT_ROCKET = ['plane', 'heli', 'boat', 'car', 'foot', 'chute'];

/** The groups in Settings and on the H card, in order. `ctx` is the game a group belongs to. */
export const GROUPS = [
  { id: 'Flying', ctx: 'plane' },
  { id: 'Autopilot', ctx: 'plane' },
  // The military jets' heat-seekers and flares (src/features/heatseek.js).
  { id: 'Weapons', ctx: 'plane' },
  { id: 'Helicopter', ctx: 'heli' },
  { id: 'Boat', ctx: 'boat' },
  { id: 'Car', ctx: 'car' },
  { id: 'Rocket', ctx: 'rocket' },
  { id: 'On foot', ctx: 'foot' },
  { id: 'Multiplayer & PvP' },
  { id: 'Racing' },
  { id: 'Fun Stuff' },
  { id: 'Missions & events' },
  { id: 'View' },
  { id: 'Game' },
];
const GROUP_IDS = GROUPS.map((g) => g.id);
/** The group a game's own keys are in — the one Settings and the H card open with. */
export const CONTEXT_GROUP = { plane: 'Flying', heli: 'Helicopter', boat: 'Boat', car: 'Car', rocket: 'Rocket', foot: 'On foot', chute: 'Flying' };

export const ACTIONS = {
  pitchDown: { label: 'Pitch down (nose down)', group: 'Flying', ctx: ['plane'], default: ['KeyW'] },
  pitchUp: { label: 'Pitch up (nose up)', group: 'Flying', ctx: ['plane'], default: ['KeyS'] },
  rollLeft: { label: 'Roll left', group: 'Flying', ctx: ['plane'], default: ['KeyA'] },
  rollRight: { label: 'Roll right', group: 'Flying', ctx: ['plane'], default: ['KeyD'] },
  yawLeft: { label: 'Rudder left', group: 'Flying', ctx: ['plane'], default: ['KeyQ'] },
  yawRight: { label: 'Rudder right', group: 'Flying', ctx: ['plane'], default: ['KeyE'] },
  // Arrow keys are bound alongside Shift/Ctrl because "how do I slow down?" is
  // the first question every new pilot asks, and Ctrl is easy to miss.
  throttleUp: { label: 'More power', group: 'Flying', ctx: ['plane'], default: ['ShiftLeft', 'ShiftRight', 'ArrowUp'] },
  throttleDown: { label: 'Less power (slow down)', group: 'Flying', ctx: ['plane'], default: ['ControlLeft', 'ControlRight', 'ArrowDown'] },
  starter: { label: 'Start / stop engine', group: 'Flying', ctx: AIR, default: ['KeyI'] },
  brakes: { label: 'Wheel brakes', group: 'Flying', ctx: AIR, default: ['Space'] },
  /*
   * The landing drag chute (features/eject/dragchute.js): it comes out only
   * when you pull it, and only Air Massimo and T-Pose Harrison carry one.
   * Semicolon, because every letter and digit already means something in the
   * cockpit (T smoke, R hush the warnings, Y ground crew, Z the zapper, O get
   * out, 3-6 quick chat, 7-0 the event cards) — and it sits on the home row,
   * right of L. A touch screen gets a CHUTE button on the landing roll.
   */
  dragChute: { label: 'Drag chute (Air Massimo, T-Pose Harrison: on the landing roll)', group: 'Flying', ctx: ['plane'], default: ['Semicolon'] },
  gear: { label: 'Landing gear up / down', group: 'Flying', ctx: AIR, default: ['KeyG'] },
  flapsDown: { label: 'Flaps down', group: 'Flying', ctx: ['plane'], default: ['KeyF'] },
  flapsUp: { label: 'Flaps up', group: 'Flying', ctx: ['plane'], default: ['KeyV'] },
  camera: { label: 'Change camera view', group: 'View', ctx: VEHICLES, default: ['KeyC'] },
  lookBehind: { label: 'Look behind (hold)', group: 'View', ctx: AIR, default: ['KeyB'] },
  // L, because it is nowhere near the flight controls. Pressing it by
  // accident would shut the engine off, so it asks twice — see main.js.
  brace: { label: 'Declare an emergency (press twice)', group: 'Missions & events', ctx: AIR, default: ['KeyL'] },
  emergencyLand: { label: 'Emergency: attempt to land', group: 'Missions & events', ctx: AIR, default: ['Digit1'] },
  emergencyCircle: { label: 'Emergency: circle the airport', group: 'Missions & events', ctx: AIR, default: ['Digit2'] },
  drop: { label: 'Release cargo / drop water', group: 'Missions & events', ctx: AIR, default: ['KeyX'] },
  pause: { label: 'Pause / menu', group: 'Game', ctx: ALL, default: ['Escape'] },
  help: { label: 'Show controls', group: 'Game', ctx: NOT_ROCKET, default: ['KeyH'] },
  // Full / Clean / Photo (ui/conditions.js). Every letter is spoken for (H is
  // the controls card), so this takes Delete: on every keyboard, in nobody's
  // way, and the dock has a button for it. Settings → Controls moves it.
  hudMode: { label: 'HUD mode: Full / Clean / Photo', group: 'View', ctx: ['plane', 'heli', 'boat', 'car'], default: ['Delete'] },
  hideUi: { label: 'Hide / show the whole interface', group: 'View', ctx: NOT_ROCKET, default: ['KeyU'] },
  guide: { label: 'Guidance lines to the target', group: 'View', ctx: NOT_ROCKET, default: ['KeyN'] },
  autopilot: { label: 'Autopilot on / off', group: 'Flying', ctx: AIR, default: ['KeyY'] },
  // Free look. These share the arrow keys with the throttle: whichever one is
  // listening depends on whether free look is switched on, and the throttle
  // always has Shift and Ctrl regardless.
  lookUp: { label: 'Look up (free look on)', group: 'View', ctx: AIR, default: ['ArrowUp'], noHint: true },
  lookDown: { label: 'Look down (free look on)', group: 'View', ctx: AIR, default: ['ArrowDown'], noHint: true },
  lookLeft: { label: 'Look left (free look on)', group: 'View', ctx: AIR, default: ['ArrowLeft'], noHint: true },
  lookRight: { label: 'Look right (free look on)', group: 'View', ctx: AIR, default: ['ArrowRight'], noHint: true },
  mute: { label: 'Mute sound', group: 'Game', ctx: ALL, default: ['KeyM'] },
  // M was already the mute key, so the map gets J — next to the other
  // view keys and free on every layout that matters.
  minimap: { label: 'Show the map', group: 'Game', ctx: NOT_ROCKET, default: ['KeyJ'] },
  minimapRange: { label: 'Map range', group: 'Game', ctx: NOT_ROCKET, default: ['KeyK'] },
  /*
   * Trim. Comma and full stop, because they sit side by side like the wheel
   * they represent and because every other sensible key was already taken.
   * Held down they wind continuously, which is how a trim wheel works.
   */
  trimDown: { label: 'Trim nose down', group: 'Flying', ctx: AIR, default: ['Comma'] },
  trimUp: { label: 'Trim nose up', group: 'Flying', ctx: AIR, default: ['Period'] },
  trimReset: { label: 'Trim back to neutral', group: 'Flying', ctx: AIR, default: ['Slash'] },

  /*
   * Dial the autopilot's bugs while it keeps flying — the owner's long-
   * standing ask. Every letter, digit and the punctuation a trim wheel or a
   * mission key could want was already spoken for in the aeroplane, so these
   * take what was left: the two quote keys for heading, minus/equal (the
   * keyboard's own -/+) for speed, and the numeric keypad's own +/- for the
   * climb and descent rate. Plane only — the stick still overrides exactly
   * as before, and these never touch it.
   */
  apHdgLeft: { label: 'Autopilot: heading left 5 degrees', group: 'Autopilot', ctx: ['plane'], default: ['Backquote'] },
  apHdgRight: { label: 'Autopilot: heading right 5 degrees', group: 'Autopilot', ctx: ['plane'], default: ['Quote'] },
  apSpdDown: { label: 'Autopilot: speed -5 kt', group: 'Autopilot', ctx: ['plane'], default: ['Minus'] },
  apSpdUp: { label: 'Autopilot: speed +5 kt', group: 'Autopilot', ctx: ['plane'], default: ['Equal'] },
  apVsDown: { label: 'Autopilot: climb/descend rate -100 ft/min', group: 'Autopilot', ctx: ['plane'], default: ['NumpadSubtract'] },
  apVsUp: { label: 'Autopilot: climb/descend rate +100 ft/min', group: 'Autopilot', ctx: ['plane'], default: ['NumpadAdd'] },

  /*
   * The helicopter, the boat and the van. They used to borrow the aeroplane's
   * keys (the van's "go" was More power OR Pitch down), so moving the
   * aeroplane's W moved the van's too. Each game has its own now, with the
   * same defaults: the helicopter and the boat through Input.update()'s map,
   * the van through vehicles/driving.js.
   */
  heliForward: { label: 'Cyclic forward (nose down)', group: 'Helicopter', ctx: ['heli'], default: ['KeyW'] },
  heliBack: { label: 'Cyclic back (nose up, slow down)', group: 'Helicopter', ctx: ['heli'], default: ['KeyS'] },
  heliLeft: { label: 'Cyclic left (slide or bank left)', group: 'Helicopter', ctx: ['heli'], default: ['KeyA'] },
  heliRight: { label: 'Cyclic right (slide or bank right)', group: 'Helicopter', ctx: ['heli'], default: ['KeyD'] },
  heliTurnLeft: { label: 'Turn left (tail rotor)', group: 'Helicopter', ctx: ['heli'], default: ['KeyQ'] },
  heliTurnRight: { label: 'Turn right (tail rotor)', group: 'Helicopter', ctx: ['heli'], default: ['KeyE'] },
  heliUp: { label: 'Collective up (more lift)', group: 'Helicopter', ctx: ['heli'], default: ['ShiftLeft', 'ShiftRight', 'ArrowUp'] },
  heliDown: { label: 'Collective down (less lift)', group: 'Helicopter', ctx: ['heli'], default: ['ControlLeft', 'ControlRight', 'ArrowDown'] },
  // F, which the helicopter does not use (flaps are the aeroplane's).
  heliAssist: { label: 'Stability assist on / off', group: 'Helicopter', ctx: ['heli'], default: ['KeyF'] },

  boatFaster: { label: 'Faster (lever forward)', group: 'Boat', ctx: ['boat'], default: ['ShiftLeft', 'ShiftRight', 'ArrowUp', 'KeyW'] },
  boatSlower: { label: 'Slower (lever back)', group: 'Boat', ctx: ['boat'], default: ['ControlLeft', 'ControlRight', 'ArrowDown', 'KeyS'] },
  boatLeft: { label: 'Steer left', group: 'Boat', ctx: ['boat'], default: ['KeyA', 'ArrowLeft'] },
  boatRight: { label: 'Steer right', group: 'Boat', ctx: ['boat'], default: ['KeyD', 'ArrowRight'] },
  boatStop: { label: 'Crash stop', group: 'Boat', ctx: ['boat'], default: ['Space'] },

  carGo: { label: 'Go', group: 'Car', ctx: ['car'], default: ['ShiftLeft', 'ShiftRight', 'ArrowUp', 'KeyW'] },
  carBrake: { label: 'Brake (hold when stopped to reverse)', group: 'Car', ctx: ['car'], default: ['ControlLeft', 'ControlRight', 'ArrowDown', 'KeyS'] },
  carLeft: { label: 'Steer left', group: 'Car', ctx: ['car'], default: ['KeyA', 'ArrowLeft'] },
  carRight: { label: 'Steer right', group: 'Car', ctx: ['car'], default: ['KeyD', 'ArrowRight'] },
  carHandbrake: { label: 'Handbrake', group: 'Car', ctx: ['car'], default: ['Space'] },
};
/** The actions declared above, which the game's own loop reads (as against a feature's). */
for (const k in ACTIONS) ACTIONS[k].core = true;

/** Which flying actions the helicopter and the boat read in place of the aeroplane's. */
export const HELI_MAP = Object.freeze({
  pitchDown: 'heliForward', pitchUp: 'heliBack', rollLeft: 'heliLeft', rollRight: 'heliRight',
  yawLeft: 'heliTurnLeft', yawRight: 'heliTurnRight', throttleUp: 'heliUp', throttleDown: 'heliDown',
});
export const BOAT_MAP = Object.freeze({ rollLeft: 'boatLeft', rollRight: 'boatRight' });

const STORAGE_KEY = 'islandsim.bindings.v1';
const LOOK_ACTIONS = ['lookUp', 'lookDown', 'lookLeft', 'lookRight'];

/*
 * SAVED KEYS FROM BEFORE A DEFAULT MOVED.
 *
 * save() keeps EVERY binding, the ones the player never touched included. So
 * when v69.3 moved the autopilot from P to Y and gave P to the ground crew
 * (services), anyone who had ever saved their settings kept autopilot = P:
 * one press of P at the stand called the pushback AND switched the autopilot
 * on, and the POWER bar climbed while the tug pushed (the owner, 2026-10-17).
 *
 * The saved set carries a version (BINDINGS_VERSION, under `_v` in the same
 * object; a plain array-only object is version 1). On load, a saved binding
 * that still equals an action's OLD default is moved to the NEW one, once; a
 * binding the player genuinely changed (anything else) is kept exactly. The
 * whole saved object is migrated, not only the actions registered so far, so
 * a feature that registers after the game started (_adopt) finds its keys
 * already moved: the order the features load in does not matter.
 *
 * To move a default again: bump BINDINGS_VERSION and add a row
 * { v: <the new version>, action, from: [old default], to: [new default] }.
 */
export const BINDINGS_VERSION = 2;
export const MIGRATIONS = Object.freeze([
  { v: 2, action: 'autopilot', from: ['KeyP'], to: ['KeyY'] },
  { v: 2, action: 'services', from: ['KeyY'], to: ['KeyP'] },
  { v: 2, action: 'harrisonBoost', from: ['KeyP'], to: ['KeyY'] },
]);
const VERSION_KEY = '_v';

/** The saved set's version: 1 for one saved before versions were kept. */
export function savedVersion(saved) {
  const v = saved && saved[VERSION_KEY];
  return Number.isInteger(v) && v > 0 ? v : 1;
}

/** Are these the same keys, in order? */
function sameKeys(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((c, i) => c === b[i]);
}

/**
 * The keys `action` should have, given what was saved for it at version
 * `fromV`: the saved keys moved on by every migration newer than that whose
 * OLD default they still equal; otherwise exactly what was saved.
 * `codes` may be null (nothing saved for it) — null comes back.
 */
export function migrateBinding(action, codes, fromV) {
  if (!Array.isArray(codes)) return codes;
  let out = codes;
  for (const m of MIGRATIONS) {
    if (m.v <= fromV || m.action !== action) continue;
    if (sameKeys(out, m.from)) out = m.to.slice();
  }
  return out;
}

/**
 * A whole saved set brought up to BINDINGS_VERSION: { bindings, moved }, where
 * `moved` lists the actions whose keys changed. Pure: the saved object is not
 * touched.
 */
export function migrateSaved(saved) {
  const fromV = savedVersion(saved);
  const out = {};
  const moved = [];
  for (const k in saved || {}) {
    if (k === VERSION_KEY) continue;
    const v = saved[k];
    if (!Array.isArray(v)) continue;
    const next = migrateBinding(k, v, fromV);
    out[k] = next;
    if (next !== v) moved.push(k);
  }
  out[VERSION_KEY] = BINDINGS_VERSION;
  return { bindings: out, moved };
}

/** The one live Input (main.js makes exactly one); null in node tests. */
let LIVE_INPUT = null;
/** For the tests and the console: make this Input the one the hints and features ask. */
export function useInput(inp) {
  LIVE_INPUT = inp || null;
  VERSION++;
}
/** Bumped whenever any binding changes, so cached hint text can tell it is stale. */
let VERSION = 0;
export function bindingsVersion() {
  return VERSION;
}

/**
 * A feature's keys, declared once when it loads:
 *
 *   registerActions({
 *     getOut: { label: 'Get out / get in', group: 'On foot', ctx: [...], default: ['KeyO'] },
 *   });
 *
 * `group` is one of GROUPS; `ctx` the games it listens in (all of them if
 * left out). Registering an id twice keeps the first, as extensions do.
 * Returns the ids it registered.
 */
export function registerActions(defs) {
  const out = [];
  for (const id in defs || {}) {
    const d = defs[id];
    if (!d || !Array.isArray(d.default)) throw new Error(`registerActions: "${id}" needs a default key list`);
    if (ACTIONS[id]) continue;
    ACTIONS[id] = {
      label: d.label || id,
      group: GROUP_IDS.includes(d.group) ? d.group : 'Game',
      ctx: Array.isArray(d.ctx) && d.ctx.length ? d.ctx.slice() : ALL,
      default: d.default.slice(),
      ...(d.noHint ? { noHint: true } : null),
    };
    out.push(id);
    if (LIVE_INPUT) LIVE_INPUT._adopt(id);
  }
  if (out.length) VERSION++;
  return out;
}

export function defaultBindings() {
  const out = {};
  for (const k in ACTIONS) out[k] = [...ACTIONS[k].default];
  return out;
}

/** Keys whose name is a symbol a child can find on the keyboard: ; not "Semicolon". */
const PUNCT = {
  Comma: ',', Period: '.', Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']',
  Backslash: '\\', Minus: '-', Equal: '=', Backquote: '`', IntlBackslash: '\\',
};

export function keyLabel(code) {
  if (!code) return '—';
  if (PUNCT[code]) return PUNCT[code];
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code
    .replace('Key', '')
    .replace('Digit', '')
    .replace('Arrow', '')
    .replace('Left', ' L')
    .replace('Right', ' R')
    .replace('Shift', 'Shift')
    .replace('Control', 'Ctrl')
    .replace('Space', 'Space')
    .replace('Escape', 'Esc');
}

/** The short name a hint uses: Shift, Ctrl, ↑, Space, O, Enter. */
const SHORT = {
  ShiftLeft: 'Shift', ShiftRight: 'Shift', ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt',
  MetaLeft: 'Cmd', MetaRight: 'Cmd', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Escape: 'Esc',
  Space: 'Space', Enter: 'Enter', NumpadEnter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Comma: ',', Period: '.',
  Slash: '/', Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\', Minus: '-', Equal: '=',
  Backquote: '`', CapsLock: 'Caps Lock', Delete: 'Delete', NumpadAdd: 'Num +', NumpadSubtract: 'Num -',
};
export function shortKey(code) {
  if (!code) return '—';
  if (SHORT[code]) return SHORT[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return code.slice(6);
  return keyLabel(code);
}

/* ------------------------------------------------------------------ */
/* Asking the registry                                                 */
/* ------------------------------------------------------------------ */

/**
 * The keys bound to an action right now. `sim` is optional: a feature tested
 * in node against a stand-in game (no input, or bindings that list only a
 * few actions) gets the defaults, which is what the game would have.
 */
export function codesFor(action, sim) {
  const inp = sim ? sim.input : LIVE_INPUT;
  const b = inp && inp.bindings;
  if (b && Array.isArray(b[action])) return b[action];
  const a = ACTIONS[action];
  return a ? a.default : [];
}

/** Is `code` one of the keys for `action`? (For a feature's key(sim, code, down) hook.) */
export function isKey(sim, action, code) {
  return !!code && codesFor(action, sim).indexOf(code) >= 0;
}

/**
 * Is `action` held down? `keys` is whatever the caller tracks pressed keys
 * in — a Set (the game's input.keys) or a plain { code: true } table (the
 * walker's, the parachute's, the rocket's). Without one, the game's own.
 */
export function heldKey(sim, action, keys) {
  const k = keys || (sim && sim.input && sim.input.keys) || (LIVE_INPUT && LIVE_INPUT.keys);
  if (!k) return false;
  const set = typeof k.has === 'function';
  for (const c of codesFor(action, sim)) if (set ? k.has(c) : k[c]) return true;
  return false;
}

/**
 * The key to name in a hint: "Press O", "<kbd>Enter</kbd> fly again". The
 * first key bound, in its short form; '—' when the player has unbound it.
 * `all` joins every key ("Shift / ↑ / W").
 */
export function keyName(action, sim, all = false) {
  const names = shortNames(action, sim);
  if (!names.length) return '—';
  return all ? names.join(' / ') : names[0];
}

/**
 * <kbd> for the key of an action (or each of its keys, de-duplicated: Shift L
 * and Shift R are both "Shift"). class="k" marks it as already live, so
 * rekey() leaves it alone wherever it ends up.
 */
export function kbd(action, sim, all = false) {
  const names = shortNames(action, sim);
  if (!names.length) return '<kbd class="k">—</kbd>';
  return (all ? names : names.slice(0, 1)).map((s) => `<kbd class="k">${escapeKey(s)}</kbd>`).join('');
}

function shortNames(action, sim) {
  const out = [];
  for (const c of codesFor(action, sim)) {
    const s = shortKey(c);
    if (out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

function escapeKey(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Has the player moved one of the game's OWN actions (the aeroplane's, not
 * a feature's) onto `code`? A feature that has a key by default — R to hush
 * the warnings, Z for the zapper — leaves it to a player who has put
 * something of their own there. A key the two share by default (and so by
 * design) does not count.
 */
export function playerClaimed(sim, code, mine) {
  const inp = sim && sim.input;
  const b = inp && inp.bindings;
  if (!b) return false;
  const own = ACTIONS[mine];
  for (const id in b) {
    if (id === mine || !Array.isArray(b[id]) || b[id].indexOf(code) < 0) continue;
    const a = ACTIONS[id];
    if (a && !a.core) continue;
    if (a && own && a.default.indexOf(code) >= 0 && own.default.indexOf(code) >= 0) continue;
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Clashes                                                             */
/* ------------------------------------------------------------------ */

function overlaps(a, b) {
  for (const c of a.ctx) if (b.ctx.indexOf(c) >= 0) return true;
  return false;
}

/**
 * Two actions clash on a key when they both have it, they listen in the same
 * game, and it is not a share the game was designed with (both defaults have
 * it: Space is the brakes and the PvP trigger, T is smoke and the F-35B's
 * hover, the arrows are power and free look).
 */
function clashOn(idA, idB, code) {
  const a = ACTIONS[idA];
  const b = ACTIONS[idB];
  if (!a || !b || !overlaps(a, b)) return false;
  return !(a.default.indexOf(code) >= 0 && b.default.indexOf(code) >= 0);
}

/** Who else answers to `code` in a game `action` plays in: [{ id, label, group }]. */
export function clashesFor(bindings, action, code) {
  const out = [];
  for (const id in ACTIONS) {
    if (id === action) continue;
    const codes = bindings[id] || [];
    if (codes.indexOf(code) < 0) continue;
    if (clashOn(action, id, code)) out.push({ id, label: ACTIONS[id].label, group: ACTIONS[id].group });
  }
  return out;
}

/** Every clash in a set of bindings: { action: [{ code, with: [{ id, label, group }] }] }. */
export function findConflicts(bindings) {
  const out = {};
  for (const id in ACTIONS) {
    for (const code of bindings[id] || []) {
      const w = clashesFor(bindings, id, code);
      if (w.length) (out[id] = out[id] || []).push({ code, with: w });
    }
  }
  return out;
}

/**
 * The groups, in order, each with its actions — the game you are in first,
 * then the rest. With `onlyCtx`, only the actions that work in that game (the
 * H card). Returns [{ id, items: [{ key, label, group, ctx, default }] }].
 */
export function groupedActions(ctx, { onlyCtx = false } = {}) {
  const first = ctx ? CONTEXT_GROUP[ctx] : null;
  const order = first ? [first, ...GROUP_IDS.filter((g) => g !== first)] : GROUP_IDS.slice();
  const by = {};
  for (const key in ACTIONS) {
    const a = ACTIONS[key];
    if (onlyCtx && ctx && a.ctx.indexOf(ctx) < 0) continue;
    (by[a.group] = by[a.group] || []).push({ key, ...a });
  }
  return order.filter((g) => by[g] && by[g].length).map((g) => ({ id: g, items: by[g] }));
}

/** The same, as an ACTIONS-shaped object in that order, for hud.showControls(). */
export function actionsFor(ctx) {
  const out = {};
  for (const g of groupedActions(ctx, { onlyCtx: !!ctx })) for (const it of g.items) out[it.key] = ACTIONS[it.key];
  return out;
}

/* ------------------------------------------------------------------ */
/* Hints that name keys                                                */
/* ------------------------------------------------------------------ */

/*
 * The game's own instructions were written with the default keys in them —
 * "Hold <kbd>Shift</kbd> for full power", "Press X to release the crate" —
 * in a hundred places. rekey() puts the player's key in their place when the
 * player has moved it, at the few points they reach the screen (the coach
 * pill, the objective, the toasts, the key lines). It only touches a key it
 * can pin on exactly one of the game's own actions in the game being played,
 * so "Space" in a boat is the crash stop and in the van the handbrake.
 *
 * A feature that already names the live key (keyName(), kbd()) marks its text
 * with live() so it is left alone: after a swap its "press P" is the new P,
 * not the autopilot's old one.
 */
export const LIVE_MARK = '⁣';
export function live(text) {
  return typeof text === 'string' && !text.endsWith(LIVE_MARK) ? text + LIVE_MARK : text;
}

/** The words the hints use for keys, and the codes they mean. */
const WORDS = {
  Shift: ['ShiftLeft', 'ShiftRight'], Ctrl: ['ControlLeft', 'ControlRight'], Space: ['Space'],
  Esc: ['Escape'], Enter: ['Enter'], Backspace: ['Backspace'], Tab: ['Tab'],
  '↑': ['ArrowUp'], '↓': ['ArrowDown'], '←': ['ArrowLeft'], '→': ['ArrowRight'],
  '&uarr;': ['ArrowUp'], '&darr;': ['ArrowDown'], '&larr;': ['ArrowLeft'], '&rarr;': ['ArrowRight'],
  ',': ['Comma'], '.': ['Period'], '/': ['Slash'],
};
for (let c = 65; c <= 90; c++) WORDS[String.fromCharCode(c)] = [`Key${String.fromCharCode(c)}`];
for (let d = 0; d <= 9; d++) WORDS[String(d)] = [`Digit${d}`];

function rekeyWord(word, ctx, bindings) {
  const codes = WORDS[word];
  if (!codes) return null;
  let hit = null;
  for (const id in ACTIONS) {
    const a = ACTIONS[id];
    if (!a.core || a.noHint || (ctx && a.ctx.indexOf(ctx) < 0)) continue;
    if (!a.default.some((c) => codes.indexOf(c) >= 0)) continue;
    if (hit) return null; // two of the game's actions: cannot tell which is meant
    hit = id;
  }
  if (!hit) return null;
  const now = bindings[hit] || [];
  if (!now.length || now.some((c) => codes.indexOf(c) >= 0)) return null; // unbound, or still there
  return shortKey(now[0]);
}

/** The game's own hint text, with the player's keys in it. See above. */
export function rekey(text, ctx) {
  if (typeof text !== 'string' || !text) return text;
  if (text.endsWith(LIVE_MARK)) return text.slice(0, -1);
  const inp = LIVE_INPUT;
  if (!inp || !inp.anyCoreRebound()) return text;
  const c = ctx || inp.context;
  const b = inp.bindings;
  return text
    .replace(/<kbd>([^<]{1,10})<\/kbd>/g, (m, w) => {
      const r = rekeyWord(w, c, b);
      return r ? `<kbd>${escapeKey(r)}</kbd>` : m;
    })
    .replace(/\b(Press|press|Hold|hold|Tap|tap) (Shift|Ctrl|Space|Esc|Enter|[A-Z0-9])(?![\w'’])/g, (m, verb, w) => {
      const r = rekeyWord(w, c, b);
      return r ? `${verb} ${r}` : m;
    });
}

/* ------------------------------------------------------------------ */
/* The keyboard                                                        */
/* ------------------------------------------------------------------ */

export class Input {
  constructor(domElement) {
    this.dom = domElement;
    this.bindings = defaultBindings();
    /** What was saved, kept whole: a feature that registers later still gets its saved keys. */
    this._saved = null;
    this.load();
    LIVE_INPUT = this;
    /**
     * The game being played, for the hints and the H card: 'plane', 'heli',
     * 'boat', 'car', 'rocket', 'foot' or 'chute'. Set every frame by main.js.
     */
    this.context = 'plane';

    this.keys = new Set();
    this.pressedThisFrame = new Set();
    this.mouseEnabled = false;
    this.gamepadEnabled = true;
    this.sensitivity = 1;
    this.invertMouse = false;

    this.mouse = { x: 0, y: 0, active: false, locked: false };
    this.lookYaw = 0;
    this.lookPitch = 0;
    this.rightDown = false;
    /**
     * Free look: move your head around the cockpit with the mouse or the
     * arrow keys, without holding anything down. Off by default because it
     * takes the arrow keys away from the throttle; toggled from the pause
     * menu or Settings.
     */
    this.freeLook = false;
    /** Seconds since you last moved your head, used to ease it back forward. */
    this._lookIdle = 0;
    /**
     * Head look with a finger: in the cockpit view (main.js sets
     * `touchLook` while it is up), a finger dragged across the picture
     * itself — not on a control — turns your head the way the mouse does with
     * free look on. It needs no setting: a touch screen has no mouse to free.
     * The head stays where the finger leaves it while it is down, and eases
     * back to straight ahead after, unless free look is on.
     */
    this.touchLook = false;
    this._lookFinger = null;

    // Smoothed control outputs. `leverHeld` is true while a hand is on the
    // throttle or collective — a key held, a trigger pulled, a thumb on the
    // touch slider — so the helicopter's height hold can tell the pilot's
    // hand from its own (rotor-assist.js) without guessing from movement.
    this.out = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 0, trim: 0, leverHeld: false };
    /** Manual trim, -1 (nose down) to +1 (nose up). Does not spring back. */
    this.trimInput = 0;
    this.throttleTarget = 0;
    /**
     * Set by the on-screen controls on a touch device. Left null when there is
     * no touch layer, so a keyboard flight never pays for this.
     */
    this.touch = null;

    this._onKeyDown = (e) => {
      // Let the browser handle typing, but only for things you actually type
      // into. This used to bail on any INPUT or SELECT, which meant that after
      // touching a slider or a dropdown in Settings the focus stayed on it and
      // *every* game key stopped working — including the one that brings the
      // interface back. A range slider is not a text field.
      const el = e.target;
      if (el) {
        const tag = el.tagName;
        const typing =
          tag === 'TEXTAREA' ||
          el.isContentEditable ||
          (tag === 'INPUT' && !/^(range|checkbox|radio|button|submit|color)$/i.test(el.type || 'text'));
        if (typing) return;
      }
      // Settings is waiting for a key: it is Settings' (see _onCapture).
      if (this.captureNext) return;
      // Tab moves focus round the menus; it is a game key only if a game
      // action has been put on it.
      if (e.code === 'Tab' && !this.isGameKey('Tab')) return;
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code);
      this.keys.add(e.code);
      // Stop the page scrolling / browser shortcuts for game keys.
      if (this.isGameKey(e.code)) e.preventDefault();
    };
    /*
     * Settings asking "press the new key": the very next key goes to it, and
     * to nothing else — in the capture phase, so no other listener (a menu's
     * Enter, the pause key resuming the game, a feature) acts on it too.
     * Esc cancels, which is why Esc itself cannot be chosen here (Pause keeps
     * it by default, and "Reset" puts it back).
     */
    this._onCapture = (e) => {
      if (!this.captureNext) return;
      if (/^(Meta|Alt|OS)/.test(e.code) || !e.code) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const cb = this.captureNext;
      this.captureNext = null;
      cb(e.code === 'Escape' ? null : e.code);
    };
    window.addEventListener('keydown', this._onCapture, true);
    this._onKeyUp = (e) => {
      this.keys.delete(e.code);
    };
    this._onBlur = () => this.keys.clear();

    this._onMouseMove = (e) => {
      if (!this.mouseEnabled && !this.rightDown && !this.freeLook) return;
      const dx = e.movementX || 0;
      const dy = e.movementY || 0;
      // Holding the right button looks around — but only when free look is
      // actually on. It used to work regardless, so with the setting off a
      // right-drag still swung your head, which is precisely the "free look is
      // on even though it should be off" complaint.
      if ((this.freeLook && (this.rightDown || !this.mouse.locked))) {
        this.lookYaw = clamp(this.lookYaw - dx * 0.0035, -2.4, 2.4);
        this.lookPitch = clamp(this.lookPitch - dy * 0.0035, -1.0, 0.75);
        this._lookIdle = 0;
        return;
      }
      const s = 0.0022 * this.sensitivity;
      this.mouse.x = clamp(this.mouse.x + dx * s, -1, 1);
      this.mouse.y = clamp(this.mouse.y + dy * s * (this.invertMouse ? -1 : 1), -1, 1);
      this.mouse.active = true;
    };
    this._onMouseDown = (e) => {
      if (e.button === 2) this.rightDown = true;
    };
    this._onMouseUp = (e) => {
      if (e.button === 2) this.rightDown = false;
    };
    this._onContext = (e) => e.preventDefault();
    this._onLookDown = (e) => {
      if (e.pointerType !== 'touch' || !this.touchLook || this._lookFinger || e.target !== this.dom) return;
      this._lookFinger = { id: e.pointerId, x: e.clientX, y: e.clientY };
    };
    this._onLookMove = (e) => {
      const f = this._lookFinger;
      if (!f || e.pointerId !== f.id) return;
      const dx = e.clientX - f.x;
      const dy = e.clientY - f.y;
      f.x = e.clientX;
      f.y = e.clientY;
      // The mouse's way round: swipe right to look right, up to look up. A
      // full swipe across a tablet (~1000 px) turns the head about 110 degrees.
      this.lookYaw = clamp(this.lookYaw - dx * 0.0019, -2.4, 2.4);
      this.lookPitch = clamp(this.lookPitch - dy * 0.0019, -1.0, 0.75);
      this._lookIdle = 0;
    };
    this._onLookUp = (e) => {
      if (this._lookFinger && e.pointerId === this._lookFinger.id) this._lookFinger = null;
    };

    window.addEventListener('keydown', this._onKeyDown, { passive: false });
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('mousemove', this._onMouseMove);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.dom.addEventListener('contextmenu', this._onContext);
    window.addEventListener('pointerdown', this._onLookDown, { passive: true });
    window.addEventListener('pointermove', this._onLookMove, { passive: true });
    window.addEventListener('pointerup', this._onLookUp, { passive: true });
    window.addEventListener('pointercancel', this._onLookUp, { passive: true });
  }

  /**
   * A key the game's own loop listens for, so the browser should not also
   * act on it (scroll on Space, find on '). Only the game's own actions: a
   * feature's key is stopped by the feature when it takes it, and Enter —
   * the eject key — must still press a focused button in the menus.
   */
  isGameKey(code) {
    for (const a in this.bindings) {
      if (ACTIONS[a] && !ACTIONS[a].core) continue;
      if (this.bindings[a].includes(code)) return true;
    }
    return false;
  }

  /**
   * A feature registered after the game started: its saved keys (brought up
   * to date if they were saved before its default moved), or its defaults.
   */
  _adopt(id) {
    // load() brought the whole saved set up to date, this feature's keys with it.
    const saved = this._saved && this._saved[id];
    this.bindings[id] = Array.isArray(saved) ? saved.filter((c) => typeof c === 'string') : [...ACTIONS[id].default];
    this._noteChange();
  }

  load() {
    /** The version the saved set was read at, and the actions the read moved on (for Settings and the tests). */
    this._savedVersion = BINDINGS_VERSION;
    this._migrated = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          const fromV = savedVersion(parsed);
          const { bindings: saved, moved } = migrateSaved(parsed);
          this._saved = saved;
          this._savedVersion = fromV;
          this._migrated = moved;
          for (const k in this.bindings) {
            if (Array.isArray(saved[k])) this.bindings[k] = saved[k].filter((c) => typeof c === 'string');
          }
          // Written back at once, so the move happens exactly once.
          if (fromV < BINDINGS_VERSION) {
            try {
              localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
            } catch (e) {
              /* storage blocked: it is migrated again next time, to the same keys */
            }
          }
        }
      }
    } catch (e) {
      /* first run, or storage blocked — defaults are fine */
    }
    this._noteChange();
  }

  /**
   * Saved with the settings: everything bound, plus whatever was saved for a
   * feature that has not loaded this time (so switching one off does not
   * lose its keys). resetAll() in core/storage.js clears it with the rest.
   */
  save() {
    this._noteChange();
    try {
      const out = { ...(this._saved || {}), ...this.bindings, [VERSION_KEY]: BINDINGS_VERSION };
      this._saved = out;
      this._savedVersion = BINDINGS_VERSION;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch (e) {
      /* ignore */
    }
  }

  _noteChange() {
    VERSION++;
    let moved = false;
    for (const id in ACTIONS) {
      if (!ACTIONS[id].core) continue;
      const now = this.bindings[id] || [];
      const def = ACTIONS[id].default;
      if (now.length !== def.length || now.some((c, i) => c !== def[i])) {
        moved = true;
        break;
      }
    }
    this._coreMoved = moved;
  }

  /** Has the player moved any of the game's own keys? (rekey() does nothing until they have.) */
  anyCoreRebound() {
    return !!this._coreMoved;
  }

  /** Every key back to the default — or only one group's ("Reset Car keys"). */
  resetBindings(group) {
    if (!group) {
      this.bindings = defaultBindings();
      this._saved = null;
    } else {
      for (const id in ACTIONS) if (ACTIONS[id].group === group) this.bindings[id] = [...ACTIONS[id].default];
    }
    this.save();
  }

  /** Who else answers to `code` in a game `action` plays in (the "already does X" question). */
  clashes(action, code) {
    return clashesFor(this.bindings, action, code);
  }

  /** Every clash there is now, for Settings to mark. */
  conflicts() {
    return findConflicts(this.bindings);
  }

  /**
   * Put `action` on `code` (it then answers to that key alone).
   *
   * swap: every action that clashed on that key takes this one's old key in
   * its place — "This key already does X — swap them?" — as long as that
   * does not make a new clash for it somewhere else (eject's Enter would
   * clash with "fly again" on foot if it went to the map); then the next of
   * the old keys, and if none fits it is left with no key, which Settings
   * says plainly. Without swap the key is simply shared, and the clash shows
   * in Settings until it is sorted out.
   *
   * Returns [{ id, label, gets }] — who lost the key and what they got
   * instead (a code, or null). dryRun works it out without changing a thing,
   * for the question Settings asks first.
   */
  bind(action, code, { swap = false, dryRun = false } = {}) {
    if (!ACTIONS[action] || !code) return [];
    const was = this.bindings;
    const b = {};
    for (const id in was) b[id] = was[id].slice();
    const old = (b[action] || []).slice();
    const others = swap ? clashesFor(b, action, code) : [];
    b[action] = [code];
    const out = [];
    for (const o of others) {
      const list = b[o.id] || [];
      let gets = null;
      for (const c of old) {
        if (c === code || list.indexOf(c) >= 0) continue;
        const trial = list.map((x) => (x === code ? c : x));
        b[o.id] = trial;
        if (!clashesFor(b, o.id, c).length) {
          gets = c;
          break;
        }
      }
      b[o.id] = gets ? list.map((x) => (x === code ? gets : x)) : list.filter((x) => x !== code);
      out.push({ id: o.id, label: o.label, gets });
    }
    if (!dryRun) {
      this.bindings = b;
      this.save();
    }
    return out;
  }

  /** The next key pressed, for Settings; null if it was Esc (cancel). */
  listen(done) {
    this.captureNext = done;
  }

  /** The old one-step form: the next key goes straight onto the action (and swaps out of anything it clashed with). */
  capture(action, done) {
    this.listen((code) => {
      if (code) this.bind(action, code, { swap: true });
      done(code);
    });
  }

  cancelCapture() {
    this.captureNext = null;
  }

  /**
   * Wind the throttle lever by a small amount, in lever units per call.
   *
   * The hover assist's height hold produces a steady collective correction,
   * and if it simply holds that correction for ever it is a hidden integrator
   * that runs to its stop and then drops the machine with no warning. So it
   * hands the correction back to the lever, which is exactly what a real
   * force-trim does, and the lever on screen moves to where the hover is.
   *
   * A finger on the touch slider owns the lever outright while it is down;
   * the assist does not fight a thumb.
   */
  nudgeThrottle(d) {
    if (!d) return;
    if (this.touch && this.touch.dragging) return;
    this.throttleTarget = Math.max(0, Math.min(1, this.throttleTarget + d));
  }

  /** A key free look uses (so, while it is on, the camera's). */
  _isLookCode(code) {
    for (const id of LOOK_ACTIONS) {
      const codes = this.bindings[id];
      if (codes && codes.indexOf(code) >= 0) return true;
    }
    return false;
  }

  held(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.keys.has(c)) return true;
    return false;
  }

  pressed(action) {
    const codes = this.bindings[action];
    if (!codes) return false;
    for (const c of codes) if (this.pressedThisFrame.has(c)) return true;
    return false;
  }

  requestMouseFlying(on) {
    this.mouseEnabled = on;
    if (on && this.dom.requestPointerLock) {
      this.dom.requestPointerLock();
    } else if (!on && document.exitPointerLock && document.pointerLockElement) {
      document.exitPointerLock();
    }
    this.mouse.x = 0;
    this.mouse.y = 0;
  }

  gamepad() {
    if (!this.gamepadEnabled || !navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  /**
   * Produce control values for this frame.
   * `simple` gives stronger self-centring, which suits younger pilots.
   *
   * `map` swaps in another game's actions for the aeroplane's — HELI_MAP for
   * the helicopter, BOAT_MAP for the boat's wheel — so each game has keys of
   * its own and still gets exactly the same feel. While free look is on, a
   * mapped key that is also a look key (the boat's ← →) is the camera's.
   */
  update(dt, { simple = true, map = null } = {}) {
    const rate = simple ? 3.1 : 2.3; // how fast the controls move
    const center = simple ? 4.4 : 2.4; // how fast they spring back
    const A = (id) => (map && map[id]) || id;
    const axis = (id) => {
      if (!map || !map[id]) return this.held(id);
      const codes = this.bindings[map[id]];
      if (!codes) return false;
      for (const c of codes) {
        if (!this.keys.has(c)) continue;
        if (this.freeLook && this._isLookCode(c)) continue;
        return true;
      }
      return false;
    };

    /*
     * Trim, wound by hand.
     *
     * Unlike every other control this one does NOT spring back — that is the
     * entire point of it. You set it and the aeroplane holds the attitude
     * without you holding the stick, which is what makes long flights and
     * precise approaches possible. It winds while the key is held, at a rate
     * chosen so a full sweep takes about four seconds: fast enough not to be
     * tedious, slow enough to stop on the value you wanted.
     */
    if (this.held('trimReset')) this.trimInput = 0;
    else {
      const tRate = 0.5;
      if (this.held('trimUp')) this.trimInput = clamp((this.trimInput || 0) + tRate * dt, -1, 1);
      if (this.held('trimDown')) this.trimInput = clamp((this.trimInput || 0) - tRate * dt, -1, 1);
    }
    this.out.trim = this.trimInput || 0;

    let pitchIn = 0;
    let rollIn = 0;
    let yawIn = 0;

    if (axis('pitchUp')) pitchIn += 1;
    if (axis('pitchDown')) pitchIn -= 1;
    if (axis('rollRight')) rollIn += 1;
    if (axis('rollLeft')) rollIn -= 1;
    if (axis('yawRight')) yawIn += 1;
    if (axis('yawLeft')) yawIn -= 1;

    // ---- Free look -------------------------------------------------------
    // Arrow keys swing your head around the cockpit. They only do this while
    // free look is on; otherwise they stay on the throttle, where beginners
    // find them.
    if (this.freeLook) {
      const lookRate = 1.5 * dt;
      let moved = false;
      if (this.held('lookLeft')) { this.lookYaw += lookRate; moved = true; }
      if (this.held('lookRight')) { this.lookYaw -= lookRate; moved = true; }
      if (this.held('lookUp')) { this.lookPitch += lookRate; moved = true; }
      if (this.held('lookDown')) { this.lookPitch -= lookRate; moved = true; }
      this.lookYaw = clamp(this.lookYaw, -2.4, 2.4);
      this.lookPitch = clamp(this.lookPitch, -1.0, 0.75);
      this._lookIdle = moved ? 0 : this._lookIdle + dt;
      // Ease the head back to straight ahead once you stop looking around, so
      // you never end up flying an approach staring at the side window.
      if (this._lookIdle > 1.6) {
        const back = clamp((this._lookIdle - 1.6) * dt * 1.6, 0, 1);
        this.lookYaw = lerp(this.lookYaw, 0, back);
        this.lookPitch = lerp(this.lookPitch, 0, back);
      }
    } else if (this._lookFinger && this.touchLook) {
      // A finger is turning the head: it stays where the finger has it.
      this._lookIdle = 0;
    } else {
      /*
       * Free look is off, so the head always comes back to straight ahead.
       *
       * This used to be skipped while the right button was held, and nothing
       * re-centred when the setting was switched off — so turning free look
       * off while your head was turned left you stuck staring at the side
       * window with no way back short of restarting. Off means off.
       */
      this.lookYaw = lerp(this.lookYaw, 0, clamp(dt * 3, 0, 1));
      this.lookPitch = lerp(this.lookPitch, 0, clamp(dt * 3, 0, 1));
      if (Math.abs(this.lookYaw) < 0.002) this.lookYaw = 0;
      if (Math.abs(this.lookPitch) < 0.002) this.lookPitch = 0;
    }

    // On-screen controls. They add to the keyboard rather than replacing it,
    // so a tablet with a keyboard attached can use either at any moment.
    if (this.touch) {
      if (this.touch.stickHeld) {
        rollIn = clamp(rollIn + this.touch.roll, -1, 1);
        pitchIn = clamp(pitchIn + this.touch.pitch, -1, 1);
      }
      if (this.touch.rudderHeld) yawIn = clamp(yawIn + this.touch.yaw, -1, 1);
    }

    // Mouse flying overrides the keyboard when it is moving.
    if (this.mouseEnabled) {
      // The virtual stick slowly recentres so you can let go.
      this.mouse.x = lerp(this.mouse.x, 0, clamp(dt * 0.8, 0, 1));
      this.mouse.y = lerp(this.mouse.y, 0, clamp(dt * 0.8, 0, 1));
      rollIn = clamp(rollIn + this.mouse.x * 1.6, -1, 1);
      pitchIn = clamp(pitchIn - this.mouse.y * 1.6, -1, 1);
    }

    const pad = this.gamepad();
    let padThrottle = null;
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      rollIn = clamp(rollIn + dz(pad.axes[0] || 0), -1, 1);
      pitchIn = clamp(pitchIn - dz(pad.axes[1] || 0), -1, 1);
      yawIn = clamp(yawIn + dz(pad.axes[2] || 0), -1, 1);
      // Triggers as throttle (standard mapping puts them on buttons 6/7).
      const rt = pad.buttons[7] ? pad.buttons[7].value : 0;
      const lt = pad.buttons[6] ? pad.buttons[6].value : 0;
      if (rt > 0.02 || lt > 0.02) padThrottle = clamp(this.throttleTarget + (rt - lt) * dt * 1.2, 0, 1);
      this.padButtons = this.padButtons || {};
      const edge = (i) => {
        const now = pad.buttons[i] && pad.buttons[i].pressed;
        const was = this.padButtons[i];
        this.padButtons[i] = now;
        return now && !was;
      };
      this.padEdges = {
        gear: edge(0),
        camera: edge(3),
        brakes: pad.buttons[1] && pad.buttons[1].pressed,
        pause: edge(9),
        drop: edge(2),
      };
    } else {
      this.padEdges = null;
    }

    // Move the smoothed controls toward the input.
    for (const [key, target] of [['pitch', pitchIn], ['roll', rollIn], ['yaw', yawIn]]) {
      const cur = this.out[key];
      if (Math.abs(target) > 0.01) {
        this.out[key] = clamp(cur + Math.sign(target) * rate * dt * (0.4 + Math.abs(target)), -1, 1);
        // Do not overshoot a partial analogue input.
        if (Math.abs(this.out[key]) > Math.abs(target) && Math.abs(target) < 0.98) this.out[key] = target;
      } else {
        this.out[key] = Math.abs(cur) < 0.02 ? 0 : cur - Math.sign(cur) * Math.min(Math.abs(cur), center * dt);
      }
    }

    // Throttle: held keys ramp it, gamepad triggers set it.
    if (padThrottle !== null) this.throttleTarget = padThrottle;
    if (this.touch && this.touch.throttle !== null && this.touch.throttle !== undefined) {
      this.throttleTarget = this.touch.throttle;
    }
    // The arrow keys belong to the throttle until free look claims them, so
    // check the modifier keys separately from the shared arrows.
    const throttleKey = (action, arrows) => {
      const codes = this.bindings[A(action)] || [];
      for (const c of codes) {
        if (!arrows && (c === 'ArrowUp' || c === 'ArrowDown')) continue;
        if (this.keys.has(c)) return true;
      }
      return false;
    };
    const arrowsFree = !this.freeLook;
    const up = throttleKey('throttleUp', arrowsFree);
    const down = throttleKey('throttleDown', arrowsFree);
    if (up) this.throttleTarget = clamp(this.throttleTarget + dt * 0.62, 0, 1);
    if (down) this.throttleTarget = clamp(this.throttleTarget - dt * 0.62, 0, 1);
    this.out.throttle = lerp(this.out.throttle, this.throttleTarget, clamp(dt * 6, 0, 1));
    this.out.leverHeld = up || down || padThrottle !== null
      || !!(this.touch && this.touch.throttle !== null && this.touch.throttle !== undefined);

    const braking =
      this.held('brakes') ||
      (this.padEdges && this.padEdges.brakes) ||
      !!(this.touch && this.touch.brakes);
    this.out.brakes = lerp(this.out.brakes, braking ? 1 : 0, clamp(dt * 9, 0, 1));

    return this.out;
  }

  endFrame() {
    this.pressedThisFrame.clear();
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keydown', this._onCapture, true);
    if (LIVE_INPUT === this) LIVE_INPUT = null;
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    window.removeEventListener('mousemove', this._onMouseMove);
    window.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    window.removeEventListener('pointerdown', this._onLookDown);
    window.removeEventListener('pointermove', this._onLookMove);
    window.removeEventListener('pointerup', this._onLookUp);
    window.removeEventListener('pointercancel', this._onLookUp);
    this.dom.removeEventListener('contextmenu', this._onContext);
  }
}

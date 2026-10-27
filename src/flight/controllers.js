/**
 * Real flight-sim gear: every connected controller, read every frame.
 *
 * The browser's Gamepad API hands over each USB game device as its own
 * "gamepad" — a sidestick, a throttle quadrant and a set of rudder pedals are
 * three of them — and only an Xbox / PlayStation pad comes with the 'standard'
 * mapping. Everything else arrives with its axes in whatever order its HID
 * report lists them. So:
 *
 *   - a STANDARD pad (and anything we do not recognise, which is how the game
 *     has always treated every pad) keeps the game's old Xbox layout exactly:
 *     input.js reads it the way it always did;
 *   - a recognised piece of sim gear gets a built-in PROFILE by its id (the
 *     TCA Sidestick and Quadrant Airbus, Thrustmaster pedals, a generic
 *     joystick-with-throttle, a generic yoke), which the player can change in
 *     Settings → Controls → Controllers: assign by "move the lever you want",
 *     invert, deadzone, curve, calibrate, and bind buttons by "press it";
 *   - the result is one `state` per frame — roll, pitch, yaw, the thrust
 *     levers (with the Airbus IDLE / CL / FLX-MCT / TOGA detents and the
 *     reverse range below idle), the two toe brakes, the speedbrake and flap
 *     levers — that input.js adds to the keyboard, the touch controls and
 *     the mouse.
 *
 * Buttons bound to one of the game's registered actions (input.js ACTIONS)
 * press that action's key: a synthetic keydown / keyup with the action's
 * first key, dispatched on window — exactly what the tests' keyboard does —
 * so every feature that listens for a key answers a button with no change
 * of its own. A few things are not keys: the wheel brakes held, the parking
 * brake, the autopilot disconnect and the engine master switches ('@…').
 *
 * Pure apart from the injected getPads(), storage and dispatch, so the whole
 * mapping is tested in node (tests/features/controllers.mjs).
 */

import { ACTIONS, codesFor } from './input.js';

export const STORAGE_KEY = 'islandsim.controllers.v1';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

/**
 * The axes a controller can drive. `kind`: 'centre' (springs back to the
 * middle: -1..+1) or 'lever' (stays where it is put: 0..1). `detents`: the
 * Airbus thrust-lever detents may be switched on for it.
 */
export const AXIS_ROLES = Object.freeze([
  { id: 'roll', label: 'Roll (stick left / right)', kind: 'centre' },
  { id: 'pitch', label: 'Pitch (stick back = nose up)', kind: 'centre' },
  { id: 'yaw', label: 'Rudder / yaw (pedals or twist)', kind: 'centre' },
  { id: 'throttle', label: 'Throttle (one lever)', kind: 'lever', detents: true },
  { id: 'throttle1', label: 'Throttle — engine 1 (left lever)', kind: 'lever', detents: true },
  { id: 'throttle2', label: 'Throttle — engine 2 (right lever)', kind: 'lever', detents: true },
  { id: 'brakeL', label: 'Left toe brake', kind: 'lever' },
  { id: 'brakeR', label: 'Right toe brake', kind: 'lever' },
  { id: 'speedbrake', label: 'Speedbrake lever', kind: 'lever' },
  { id: 'flaps', label: 'Flaps lever (optional)', kind: 'lever' },
]);
export const ROLE = Object.freeze(Object.fromEntries(AXIS_ROLES.map((r) => [r.id, r])));

/** A POV hat axis value → { x, y } (right and up positive), from its eight positions -1, -5/7 … 1 (clockwise from up). */
export function hatDir(v) {
  const k = ((Math.round(((v + 1) * 7) / 2) % 8) + 8) % 8;
  const a = (k * Math.PI) / 4;
  const x = Math.round(Math.sin(a) * 1000) / 1000;
  const y = Math.round(Math.cos(a) * 1000) / 1000;
  return { x: Math.abs(x) < 1e-3 ? 0 : x, y: Math.abs(y) < 1e-3 ? 0 : y };
}

/**
 * What a button can do besides pressing an action's key. `brakes` is the
 * game's own action, but held from a button it is the wheel brakes directly
 * (its Space is also the PvP trigger, by design, and a brake button must not
 * fire a gun).
 */
export const BUTTON_SPECIALS = Object.freeze({
  brakes: { label: 'Wheel brakes (hold)', hold: true },
  '@parkingBrake': { label: 'Parking brake on / off' },
  '@apDisconnect': { label: 'Autopilot disconnect (the red button)' },
  '@master1': { label: 'Engine master 1 (switch: ON starts, both OFF stops)', latch: true },
  '@master2': { label: 'Engine master 2 (switch: ON starts, both OFF stops)', latch: true },
});

/** The label of a button action: a special's, or the registered action's. */
export function actionLabel(id) {
  if (BUTTON_SPECIALS[id]) return BUTTON_SPECIALS[id].label;
  const a = ACTIONS[id];
  return a ? a.label : id;
}

/**
 * The actions Settings offers a button, in order: the specials first, then
 * the ones a pilot at a desk wants (the gear, the flaps, the levers, the
 * camera…), then every other registered action. [{ id, label, group }]
 */
export const PILOT_ACTIONS = Object.freeze([
  'gear', 'flapsUp', 'flapsDown', 'spoilers', 'reversers', 'autopilot', 'starter', 'camera', 'lookBehind',
  'services', 'atcRequest', 'lights', 'pause', 'trimUp', 'trimDown', 'trimReset', 'apHdgLeft', 'apHdgRight',
  'apSpdDown', 'apSpdUp', 'apVsDown', 'apVsUp', 'drop', 'hudMode', 'minimap', 'help', 'mute',
]);
export function bindableActions() {
  const out = [];
  for (const id in BUTTON_SPECIALS) out.push({ id, label: BUTTON_SPECIALS[id].label, group: 'Controls' });
  const seen = new Set(out.map((o) => o.id));
  for (const id of PILOT_ACTIONS) {
    if (seen.has(id) || !ACTIONS[id]) continue;
    seen.add(id);
    out.push({ id, label: ACTIONS[id].label, group: ACTIONS[id].group });
  }
  for (const id in ACTIONS) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: ACTIONS[id].label, group: ACTIONS[id].group });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Device ids                                                          */
/* ------------------------------------------------------------------ */

const hex4 = (s) => String(s || '').toLowerCase().replace(/^0x/, '').padStart(4, '0').slice(-4);

/**
 * A gamepad id, in any browser's format, as { name, vendor, product }:
 *   Chrome / Edge  "Thrustmaster TCA Sidestick Airbus (Vendor: 044f Product: 0405)"
 *   Firefox        "44f-405-Thrustmaster TCA Sidestick Airbus"
 *   Safari         "Thrustmaster TCA Sidestick Airbus" (name only, sometimes)
 * vendor / product are four lower-case hex digits, or null.
 */
export function parseId(id) {
  let name = String(id || '').trim();
  let vendor = null;
  let product = null;
  let m = name.match(/\(([^()]*?)Vendor:\s*([0-9a-f]{1,4})\s+Product:\s*([0-9a-f]{1,4})\s*\)/i);
  if (m) {
    vendor = hex4(m[2]);
    product = hex4(m[3]);
    name = (name.slice(0, m.index) + name.slice(m.index + m[0].length)).trim();
  } else if ((m = name.match(/^([0-9a-f]{1,4})-([0-9a-f]{1,4})-(.*)$/i))) {
    vendor = hex4(m[1]);
    product = hex4(m[2]);
    name = m[3].trim();
  }
  name = name.replace(/\((?:STANDARD GAMEPAD|XInput[^)]*)\)/gi, '').replace(/\s{2,}/g, ' ').trim();
  return { name: name || 'Controller', vendor, product };
}

/* ------------------------------------------------------------------ */
/* Profiles                                                            */
/* ------------------------------------------------------------------ */

/** The Airbus thrust-lever detents, as lever positions 0 (full aft) … 1 (TOGA). */
export const AIRBUS_DETENTS = Object.freeze({ rev: true, idle: 0.3, cl: 0.62, flx: 0.82, toga: 0.97, band: 0.035 });
/** The thrust each detent commands, as the game's throttle (0 idle … 1 full). */
export const DETENT_THRUST = Object.freeze({ IDLE: 0, CL: 0.88, FLX: 0.95, TOGA: 1 });

const ax = (axis, more) => ({ axis, invert: false, deadzone: 0.04, curve: 0, min: -1, max: 1, center: 0, ...more });
const lever = (axis, more) => ({ axis, invert: false, deadzone: 0.02, curve: 0, min: -1, max: 1, center: 0, ...more });

/**
 * The built-in profiles, best match first. `ids` are [vendor, product]
 * pairs; `name` a pattern on the device's name. The axis numbers and the
 * buttons are a best guess at how the browser lists each device's HID report
 * — every one of them can be moved in Settings, and the "move each lever"
 * check after a connect says at once if one is wrong.
 *
 * Two browsers, two orders. Firefox and Safari list the axes the device has,
 * one after another (X, Y, Rz, Slider → 0, 1, 2, 3). Chrome and Edge put each
 * axis at the index of its HID usage (X 0, Y 1, Z 2, Rx 3, Ry 4, Rz 5,
 * Slider 6, Dial 7, Wheel 8, the hat 9 — which is why a hat reads as axis 9
 * on Chrome), leaving the gaps at 0. So a twist or a rudder on Rz is axis 2
 * in Firefox and axis 5 in Chrome. `chrome` is that index, used for a device
 * with Chrome's id format ("… (Vendor: 044f Product: 0405)") whose axes
 * reach it (resolveProfileAxes).
 */
export const PROFILES = Object.freeze([
  {
    id: 'tca-sidestick',
    name: 'TCA Sidestick Airbus',
    kind: 'stick',
    ids: [['044f', '0405']],
    name_re: /TCA\s*Sidestick|Sidestick\s*Airbus/i,
    axes: {
      roll: ax(0),
      pitch: ax(1),
      // The twist (HID Rz). Pedals, when they are plugged in too, win (prio).
      yaw: ax(2, { prio: 1, deadzone: 0.08, chrome: 5 }),
      // The throttle lever on the base (HID Slider): forward is the top of its range.
      throttle: lever(3, { invert: true, prio: 1, chrome: 6 }),
    },
    buttons: {
      // Airbus habit: the trigger is brakes for a pilot without toe brakes,
      // the red button on the head is the autopilot's instinctive disconnect.
      0: 'brakes', 1: '@apDisconnect', 2: 'camera', 3: 'lookBehind', 4: 'gear', 5: 'flapsUp', 6: 'flapsDown',
      7: 'spoilers', 8: 'reversers', 9: 'autopilot',
    },
    notes: 'Stick X/Y = roll/pitch, twist = rudder, base lever = throttle, trigger = brakes, red button = AP disconnect.',
  },
  {
    id: 'tca-quadrant',
    name: 'TCA Quadrant Airbus',
    kind: 'throttle',
    ids: [['044f', '0407'], ['044f', '0408']],
    name_re: /TCA\s*Q-?\s*Eng|TCA\s*Quadrant|Throttle\s*Quadrant\s*Airbus/i,
    axes: {
      throttle1: lever(0, { detents: { ...AIRBUS_DETENTS } }),
      throttle2: lever(1, { detents: { ...AIRBUS_DETENTS } }),
      // The add-on's levers, when it is fitted (the quadrant reports them).
      speedbrake: lever(2, { optional: true }),
      flaps: lever(3, { optional: true }),
    },
    buttons: { 0: '@master1', 1: '@master2' },
    notes: 'Two thrust levers with the Airbus detents (IDLE / CL / FLX-MCT / TOGA) and reverse below idle; engine masters start and stop the engines.',
  },
  {
    id: 'tm-pedals',
    name: 'Thrustmaster rudder pedals',
    kind: 'pedals',
    ids: [['044f', 'b679'], ['044f', 'b678'], ['044f', 'b68f'], ['044f', 'b68e']],
    name_re: /T-?\s*Rudder|TFRP|T\.?\s*Flight\s*Rudder|\bTPR\b|Pendular\s*Rudder/i,
    axes: {
      brakeL: lever(0),
      brakeR: lever(1),
      // The rudder is HID Rz (X and Y are the toe brakes).
      yaw: ax(2, { prio: 3, deadzone: 0.03, chrome: 5 }),
    },
    buttons: {},
    notes: 'Rudder = yaw and nose-wheel steering; the toe brakes brake each side, so pressing one turns you on the ground.',
  },
  {
    id: 'pedals',
    name: 'Rudder pedals',
    kind: 'pedals',
    ids: [['06a3', '0763'], ['16d0', '0a38'], ['046d', 'c264']],
    name_re: /rudder|pedal/i,
    axes: { brakeL: lever(0), brakeR: lever(1), yaw: ax(2, { prio: 3, deadzone: 0.03, chrome: 5 }) },
    buttons: {},
    notes: 'A generic guess: X and Y the toe brakes, the third axis the rudder.',
  },
  {
    id: 'x52',
    name: 'Saitek / Logitech X52',
    kind: 'hotas',
    ids: [['06a3', '075c'], ['06a3', '0255'], ['06a3', '0762']],
    name_re: /\bX-?52\b/i,
    axes: { roll: ax(0), pitch: ax(1), throttle: lever(2, { invert: true }), yaw: ax(5, { prio: 1, deadzone: 0.08 }) },
    buttons: { 0: 'brakes', 1: '@apDisconnect', 2: 'gear', 3: 'camera', 4: 'flapsUp', 5: 'flapsDown' },
    notes: 'Stick = roll/pitch, twist = rudder, the throttle unit = throttle.',
  },
  {
    id: 'yoke',
    name: 'Yoke (Logitech / Saitek / Honeycomb style)',
    kind: 'yoke',
    ids: [['06a3', '0bac'], ['294b', '1900'], ['046d', 'c2b9']],
    name_re: /yoke|Honeycomb\s*Alpha|Alpha\s*Flight\s*Controls/i,
    axes: { roll: ax(0), pitch: ax(1), throttle: lever(2, { invert: true, optional: true }) },
    buttons: { 0: 'brakes', 1: '@apDisconnect', 2: 'gear', 3: 'camera' },
    notes: 'Yoke turn = roll, push/pull = pitch; the first lever (if it has one) = throttle.',
  },
  {
    id: 'bravo',
    name: 'Throttle quadrant (Honeycomb Bravo style)',
    kind: 'throttle',
    ids: [['294b', '1901']],
    name_re: /Bravo\s*Throttle|Throttle\s*Quadrant|TWCS|Throttle/i,
    axes: { throttle1: lever(0, { optional: true }), throttle2: lever(1, { optional: true }) },
    buttons: {},
    notes: 'A generic guess: the first two levers are the engines\' thrust.',
  },
  {
    id: 'hotas',
    name: 'Joystick with throttle (T.16000M / T.Flight / Extreme 3D style)',
    kind: 'hotas',
    ids: [['044f', 'b10a'], ['044f', 'b108'], ['044f', 'b67b'], ['044f', 'b67c'], ['046d', 'c215'], ['0738', '2221'], ['0738', 'a221']],
    name_re: /T\.?16000|T\.?\s*Flight|HOTAS|X-?56|Extreme\s*3D|Joystick|Flight\s*Stick|Sidewinder/i,
    axes: { roll: ax(0), pitch: ax(1), yaw: ax(2, { prio: 1, deadzone: 0.08, chrome: 5 }), throttle: lever(3, { invert: true, optional: true, chrome: 6 }) },
    buttons: { 0: 'brakes', 1: '@apDisconnect', 2: 'gear', 3: 'camera', 4: 'flapsUp', 5: 'flapsDown' },
    notes: 'Stick = roll/pitch, twist = rudder, slider = throttle.',
  },
]);

/** The two that are not sim gear. */
export const STANDARD_PROFILE = Object.freeze({
  id: 'standard',
  name: 'Gamepad (Xbox / PlayStation layout)',
  kind: 'gamepad',
  axes: {},
  buttons: {},
  notes: 'Left stick flies, right stick X is the rudder, the triggers are the throttle, A gear, B brakes, X drop, Y camera, Start pause.',
});
export const NONE_PROFILE = Object.freeze({ id: 'none', name: 'Ignore this device', kind: 'none', axes: {}, buttons: {}, notes: 'The game does not read it at all.' });
export const CUSTOM_PROFILE = Object.freeze({ id: 'custom', name: 'My own setup', kind: 'custom', axes: {}, buttons: {}, notes: 'Start from nothing and assign every axis yourself.' });

/** Chrome's / Edge's id format ("Name (Vendor: 044f Product: 0405)"): axes sit at their HID usage's index. */
const CHROME_ID = /\([^()]*Vendor:\s*[0-9a-f]{1,4}\s+Product:\s*[0-9a-f]{1,4}\s*\)/i;

/**
 * A profile's axes for one device: each role with a `chrome` index moves to
 * it when the id is Chrome's format and the device has that many axes
 * (`nAxes` unknown: it moves). The profile's own copy, changed in place.
 */
export function resolveProfileAxes(axes, id, nAxes) {
  if (!axes || !CHROME_ID.test(String(id || ''))) return axes;
  for (const r in axes) {
    const a = axes[r];
    if (a && Number.isFinite(a.chrome) && !(Number.isFinite(nAxes) && a.chrome >= nAxes)) a.axis = a.chrome;
  }
  return axes;
}

/**
 * Cockpit panels that are not flight controls — an FCU, an EFIS, an MCDU, a
 * radio or switch panel. Many show up as a HID "joystick" with dozens of
 * buttons; read with the gamepad layout their buttons would be the gear and
 * the pause. Ignored unless the player picks a profile for one.
 */
const PANEL_RE = /\b(?:FCU|EFIS|MCDU|CDU|ECAM|PFP|RMP|ACP)\b|Radio\s*Panel|Switch\s*Panel|Multi\s*Panel|Instrument\s*Panel|Stream\s*Deck|Button\s*Box/i;
/** A device the browser does not map as a gamepad with this many buttons is a panel, not a pad. */
export const PANEL_BUTTONS = 28;

export function profileById(id) {
  if (id === 'standard') return STANDARD_PROFILE;
  if (id === 'none') return NONE_PROFILE;
  if (id === 'custom') return CUSTOM_PROFILE;
  return PROFILES.find((p) => p.id === id) || null;
}

/**
 * The built-in profile for a device. A known vendor:product wins, then the
 * name; anything else — an Xbox or PlayStation pad, a no-name USB pad, a
 * device nobody has seen — gets the standard layout, which is what every pad
 * got before this file existed.
 */
export function matchProfile(id, mapping = '', nButtons = 0) {
  const info = typeof id === 'object' && id ? id : parseId(id);
  if (info.vendor && info.product) {
    for (const p of PROFILES) if (p.ids.some(([v, pr]) => v === info.vendor && pr === info.product)) return p;
  }
  // A pad the browser itself maps as 'standard' is a gamepad, whatever its name says.
  if (mapping === 'standard') return STANDARD_PROFILE;
  if (PANEL_RE.test(info.name)) return NONE_PROFILE;
  for (const p of PROFILES) if (p.name_re.test(info.name)) return p;
  if (nButtons >= PANEL_BUTTONS) return NONE_PROFILE;
  return STANDARD_PROFILE;
}

/* ------------------------------------------------------------------ */
/* Shaping an axis                                                     */
/* ------------------------------------------------------------------ */

/**
 * A raw axis value (-1..1, as the browser gives it) through the device's
 * calibration (min / max / centre), invert, deadzone and curve.
 *   centre axes: -1..+1, with the deadzone round the centre
 *   levers:       0..1,  with the deadzone at each end (so the stop is the stop)
 * `curve` 0 is linear; towards 1 the middle gets softer (an expo), the ends
 * still reach full.
 */
export function shapeAxis(raw, cfg = {}, kind = 'centre') {
  let v = Number(raw);
  if (!Number.isFinite(v)) v = 0;
  const min = Number.isFinite(cfg.min) ? cfg.min : -1;
  const max = Number.isFinite(cfg.max) ? cfg.max : 1;
  const dz = clamp(Number(cfg.deadzone) || 0, 0, 0.5);
  const curve = clamp(Number(cfg.curve) || 0, 0, 1);
  if (kind === 'lever') {
    let t = max > min ? (v - min) / (max - min) : 0;
    t = clamp(t, 0, 1);
    if (cfg.invert) t = 1 - t;
    if (dz > 0) t = t <= dz ? 0 : t >= 1 - dz ? 1 : (t - dz) / (1 - 2 * dz);
    if (curve > 0) t = (1 - curve) * t + curve * t * t * t;
    return clamp(t, 0, 1);
  }
  const c = Number.isFinite(cfg.center) ? clamp(cfg.center, min, max) : (min + max) / 2;
  let t = v >= c ? (max > c ? (v - c) / (max - c) : 0) : c > min ? (v - c) / (c - min) : 0;
  t = clamp(t, -1, 1);
  if (cfg.invert) t = -t;
  const a = Math.abs(t);
  let m = a <= dz ? 0 : (a - dz) / (1 - dz);
  if (curve > 0) m = (1 - curve) * m + curve * m * m * m;
  return clamp(Math.sign(t) * m, -1, 1);
}

/**
 * A thrust lever (0 full aft … 1 full forward) through the Airbus detents.
 * Returns { thrust, detent, reverse }:
 *   thrust   the game's throttle, 0..1 (0 in the reverse range)
 *   detent   'REV' | 'IDLE' | 'CL' | 'FLX' | 'TOGA', or 'MAN' between two
 *   reverse  0..1, how far into the reverse range (0 when forward of idle)
 * Inside `band` of a detent the lever sits in it, as the real one clicks into
 * its gate. Between two detents the thrust is in proportion. With `rev`
 * false the lever has no reverse range: idle is the aft stop.
 */
export function airbusThrust(t, det = AIRBUS_DETENTS, wasRev = false) {
  const d = { ...AIRBUS_DETENTS, ...(det || {}) };
  const band = clamp(Number(d.band) || 0, 0, 0.1);
  const idle = d.rev ? clamp(d.idle, 0.05, 0.9) : 0;
  const cl = clamp(d.cl, idle + 0.02, 0.98);
  const flx = clamp(d.flx, cl + 0.01, 0.99);
  const toga = clamp(d.toga, flx + 0.01, 1);
  const x = clamp(Number(t) || 0, 0, 1);
  /*
   * A lever resting on the edge of the reverse range must not flick the
   * reversers in and out with the sensor's noise: once in REV it stays there
   * until it is REV_HYST forward of the edge (still inside the IDLE gate, so
   * the thrust is 0 either way).
   */
  if (d.rev && (x < idle - band || (wasRev && x < idle - band + REV_HYST))) {
    const r = clamp((idle - band - x) / Math.max(0.01, idle - band), 0, 1);
    return { thrust: 0, detent: 'REV', reverse: Math.max(r, 1e-3) };
  }
  if (x <= idle + band) return { thrust: 0, detent: 'IDLE', reverse: 0 };
  if (Math.abs(x - cl) <= band) return { thrust: DETENT_THRUST.CL, detent: 'CL', reverse: 0 };
  if (Math.abs(x - flx) <= band) return { thrust: DETENT_THRUST.FLX, detent: 'FLX', reverse: 0 };
  if (x >= toga - band) return { thrust: DETENT_THRUST.TOGA, detent: 'TOGA', reverse: 0 };
  const seg = (a, b, ta, tb) => ta + ((x - a) / (b - a)) * (tb - ta);
  let thrust;
  if (x < cl) thrust = seg(idle + band, cl - band, 0, DETENT_THRUST.CL);
  else if (x < flx) thrust = seg(cl + band, flx - band, DETENT_THRUST.CL, DETENT_THRUST.FLX);
  else thrust = seg(flx + band, toga - band, DETENT_THRUST.FLX, DETENT_THRUST.TOGA);
  return { thrust: clamp(thrust, 0, 1), detent: 'MAN', reverse: 0 };
}

/** How far forward of the reverse edge a lever in REV must come to leave it (lever travel 0..1). */
export const REV_HYST = 0.02;

/**
 * The game's reverser detent (systems.js REVERSE_DETENTS: 0 / 0.5 / 1) for a
 * lever's reverse range. `prev`, the detent it is in now: MAX holds down to
 * 0.5 of the range, so a lever resting at 0.6 does not flick between them.
 */
export function reverseDetent(r, prev = 0) {
  if (!(r > 0)) return 0;
  if (prev >= 1 && r >= 0.5) return 1;
  return r >= 0.6 ? 1 : 0.5;
}

/**
 * Differential toe brakes: { brakes, left, right, diff }. `brakes` is the
 * harder of the two (what the old single-brake flight model reads);
 * left / right are each side's, for the wheels.
 */
export function toeBrakes(left, right) {
  const l = clamp(Number(left) || 0, 0, 1);
  const r = clamp(Number(right) || 0, 0, 1);
  return { brakes: Math.max(l, r), left: l, right: r, diff: r - l };
}

/** A deep copy of a config (they are small, plain objects). */
const copy = (o) => (o == null ? o : JSON.parse(JSON.stringify(o)));

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * One device's saved settings, as read back from storage, made safe: a
 * broken or hand-edited entry must never put NaN on the throttle or throw
 * every frame. Returns null when nothing usable is left.
 */
export function sanitizeSaved(s) {
  if (!isObj(s)) return null;
  const out = { profile: typeof s.profile === 'string' && (s.profile === 'auto' || profileById(s.profile)) ? s.profile : 'auto' };
  if (isObj(s.axes)) {
    out.axes = {};
    for (const role in s.axes) {
      const a = s.axes[role];
      const axis = num(a && a.axis);
      if (!ROLE[role] || !isObj(a) || axis === undefined || axis < 0 || axis > 63 || axis !== Math.floor(axis)) continue;
      const c = { axis, invert: !!a.invert };
      for (const k of ['deadzone', 'curve', 'min', 'max', 'center', 'prio', 'chrome']) if (num(a[k]) !== undefined) c[k] = a[k];
      if (c.min !== undefined && c.max !== undefined && !(c.max > c.min)) {
        delete c.min;
        delete c.max;
      }
      if (a.optional) c.optional = true;
      if (isObj(a.detents)) {
        const d = { ...AIRBUS_DETENTS };
        for (const k of ['idle', 'cl', 'flx', 'toga', 'band']) if (num(a.detents[k]) !== undefined) d[k] = clamp(a.detents[k], 0, 1);
        d.rev = a.detents.rev !== false;
        c.detents = d;
      }
      out.axes[role] = c;
    }
  }
  if (isObj(s.buttons)) {
    out.buttons = {};
    for (const idx in s.buttons) {
      const act = s.buttons[idx];
      if (/^\d{1,3}$/.test(idx) && typeof act === 'string' && (BUTTON_SPECIALS[act] || ACTIONS[act])) out.buttons[idx] = act;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The manager                                                         */
/* ------------------------------------------------------------------ */

function defaultGetPads() {
  try {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return [];
    return navigator.getGamepads() || [];
  } catch (e) {
    return [];
  }
}

function defaultStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/**
 * Press an action's key the way the keyboard would: its first bound code, on
 * window. Returns false when there is no window or the action has no key.
 */
function defaultDispatch(action, down) {
  if (typeof window === 'undefined' || typeof KeyboardEvent === 'undefined') return false;
  const code = codesFor(action)[0];
  if (!code) return false;
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
  return true;
}

/** An engine-master input that goes OFF within this long of going ON was a push-button, not a switch. */
export const MOMENTARY_MS = 700;

const ROLE_PRIO = { yaw: 2, throttle: 2, throttle1: 2, throttle2: 2 };

export class Controllers {
  constructor({ getPads = defaultGetPads, storage = defaultStorage(), dispatch = defaultDispatch, clock = null } = {}) {
    this.getPads = getPads;
    /** ms. Unset: the game's own time (the dt each poll is handed), else the wall clock. */
    this.clock = clock;
    this._gameMs = 0;
    this.storage = storage;
    this.dispatch = dispatch;
    this.enabled = true;
    /** { [device id]: { profile: 'auto' | id, axes?, buttons? } } — what the player changed. */
    this.saved = {};
    /** Every device seen this session (connect notices fire once each). */
    this.seen = new Set();
    /** [{ type: 'connect' | 'disconnect', key, name, profile }] for the HUD (drained by it). */
    this.events = [];
    /** The devices this scan: see scan(). */
    this.devices = [];
    /** Per device and button: was it down last poll? */
    this._btn = new Map();
    /** The buttons whose action key we pressed, and that action (so a release — or an unplug — sends its key up). */
    this._down = new Map();
    /** Engine-master inputs: when each went ON (a momentary button is not a switch). */
    this._latchOn = new Map();
    /** Thrust roles now in the reverse range (its hysteresis). */
    this._inRev = {};
    /** Per device: the last value applied for the speedbrake / flaps levers (they act on a change). */
    this._detect = null;
    this._calib = null;
    this.state = this._emptyState();
    this.load();
  }

  _emptyState() {
    return {
      any: false, roll: null, pitch: null, yaw: null,
      throttle: null, eng: null, split: 0, detents: null, reverse: null,
      brakeL: null, brakeR: null, brakes: null, brakeHold: false,
      speedbrake: null, flaps: null,
      edges: { parkingBrake: false, apDisconnect: false },
      masters: { changed: false, anyOn: false, known: false },
      thrustDevice: null,
      /** A hat switch (POV): { x, y } in -1..1 (right and up positive), 0, 0 when centred; null with none. */
      hat: null,
    };
  }

  /* ---- storage ---------------------------------------------------- */

  load() {
    this.version = (this.version || 0) + 1;
    this.saved = {};
    try {
      const raw = this.storage && this.storage.getItem(STORAGE_KEY);
      if (raw) {
        const p = JSON.parse(raw);
        if (isObj(p) && isObj(p.devices)) {
          for (const k in p.devices) {
            const s = sanitizeSaved(p.devices[k]);
            if (s) this.saved[k] = s;
          }
        }
      }
    } catch (e) {
      /* blocked or broken: the built-in profiles */
    }
  }

  save() {
    try {
      if (this.storage) this.storage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, devices: this.saved }));
    } catch (e) {
      /* storage blocked: the change lasts this session */
    }
  }

  /** The player's changes for one device back to the built-in profile. */
  resetDevice(key) {
    delete this.saved[key];
    this.save();
    this._rescan();
  }

  /** Every device back to its profile. */
  resetAll() {
    this.saved = {};
    this.save();
    this._rescan();
  }

  /* ---- configs ---------------------------------------------------- */

  /** The device's shape: { axes, buttons } counts, from the last scan (undefined when it is not connected). */
  _shape(key) {
    const d = this.devices.find((x) => x.key === key);
    return d ? { axes: d.axes.length, buttons: d.buttons.length } : {};
  }

  /** The profile a device is using: the player's choice, or the built-in match. */
  profileFor(key, mapping = '', shape = this._shape(key)) {
    const s = this.saved[key];
    const chosen = s && s.profile && s.profile !== 'auto' ? profileById(s.profile) : null;
    return chosen || matchProfile(String(key).replace(/ #\d+$/, ''), mapping, shape.buttons || 0);
  }

  /** { profile, auto, axes, buttons, mode } — what a device does right now. */
  configFor(key, mapping = '', shape = this._shape(key)) {
    const s = this.saved[key] || null;
    const profile = this.profileFor(key, mapping, shape);
    const auto = !s || !s.profile || s.profile === 'auto';
    const axes = s && s.axes ? s.axes : resolveProfileAxes(copy(profile.axes), key, shape.axes);
    const buttons = s && s.buttons ? s.buttons : copy(profile.buttons);
    let mode = 'mapped';
    if (profile.id === 'none') mode = 'off';
    else if (profile.id === 'standard' && !(s && (s.axes || s.buttons))) mode = 'standard';
    return { profile, auto, axes, buttons, mode };
  }

  /** The editable copy of a device's config, made the player's own (saved). */
  _own(key, mapping = '') {
    const c = this.configFor(key, mapping);
    const s = this.saved[key] || (this.saved[key] = { profile: 'auto' });
    if (!s.axes) s.axes = copy(c.axes);
    if (!s.buttons) s.buttons = copy(c.buttons);
    return s;
  }

  /** Choose a profile for a device ('auto' for the built-in match). Clears the player's own axes and buttons. */
  setProfile(key, id) {
    this.saved[key] = { profile: id || 'auto' };
    if (this.saved[key].profile === 'auto') delete this.saved[key];
    this.save();
    this._rescan();
  }

  /** Put a role on an axis of a device (null clears it). Whatever else was on that axis of that device comes off it. */
  assignAxis(key, role, axis, mapping = '') {
    if (!ROLE[role]) return false;
    const s = this._own(key, mapping);
    if (axis === null || axis === undefined) delete s.axes[role];
    else {
      const was = s.axes[role] || {};
      const isLever = ROLE[role].kind === 'lever';
      s.axes[role] = {
        axis: Number(axis), invert: !!was.invert, deadzone: Number.isFinite(was.deadzone) ? was.deadzone : isLever ? 0.02 : 0.04,
        curve: was.curve || 0, min: -1, max: 1, center: 0,
        ...(was.detents ? { detents: was.detents } : null),
        ...(was.prio ? { prio: was.prio } : null),
      };
    }
    // One job per axis: the flaps put on the stick's base lever take the throttle off it.
    if (axis !== null && axis !== undefined) {
      for (const r in s.axes) if (r !== role && s.axes[r] && s.axes[r].axis === Number(axis)) delete s.axes[r];
    }
    // A role lives on one device: assigning it here takes it off the others.
    if (axis !== null && axis !== undefined) {
      for (const k in this.saved) {
        if (k === key) continue;
        if (this.saved[k].axes && this.saved[k].axes[role]) delete this.saved[k].axes[role];
      }
      for (const d of this.devices) {
        if (d.key === key || this.saved[d.key]) continue;
        if (d.cfg && d.cfg.axes && d.cfg.axes[role]) {
          const o = this._own(d.key, d.mapping);
          delete o.axes[role];
        }
      }
    }
    this.save();
    this._rescan();
    return true;
  }

  /** Change one setting of a role's axis: invert, deadzone, curve, detents, min, max, center. */
  setAxisOption(key, role, opt, value, mapping = '') {
    const s = this._own(key, mapping);
    const a = s.axes[role];
    if (!a) return false;
    if (opt === 'detents') a.detents = value ? { ...AIRBUS_DETENTS, ...(typeof value === 'object' ? value : {}) } : undefined;
    else if (opt === 'reverse') a.detents = a.detents ? { ...a.detents, rev: !!value } : a.detents;
    else if (opt === 'invert') a.invert = !!value;
    else a[opt] = Number(value);
    if (a.detents === undefined) delete a.detents;
    this.save();
    this._rescan();
    return true;
  }

  /** Put a button on an action (null clears the button). */
  bindButton(key, index, action, mapping = '') {
    const s = this._own(key, mapping);
    if (action) s.buttons[String(index)] = action;
    else delete s.buttons[String(index)];
    this.save();
    this._rescan();
    return true;
  }

  /** Set an Airbus detent ('idle' | 'cl' | 'flx' | 'toga') of a thrust role at the lever's position now. */
  setDetentHere(key, role, which, mapping = '') {
    const d = this.devices.find((x) => x.key === key);
    const s = this._own(key, mapping);
    const a = s.axes[role];
    if (!d || !a || !['idle', 'cl', 'flx', 'toga'].includes(which)) return false;
    const t = shapeAxis(d.axes[a.axis], { ...a, deadzone: 0, curve: 0 }, 'lever');
    a.detents = { ...AIRBUS_DETENTS, ...(a.detents || {}), [which]: Math.round(t * 1000) / 1000 };
    this.save();
    this._rescan();
    return true;
  }

  /* ---- detection and calibration ---------------------------------- */

  /**
   * "Move the lever you want" (kind 'axis') or "press the button" (kind
   * 'button'): the next one that moves on any device answers
   * done({ key, index }) — or done(null) after `timeout` seconds. While it
   * waits, no button presses an action.
   */
  detect(kind, done, timeout = 10) {
    this._detect = { kind, done, base: null, t0: now(), timeout };
  }

  cancelDetect() {
    const d = this._detect;
    this._detect = null;
    if (d && d.done) d.done(null);
  }

  get detecting() {
    return this._detect ? this._detect.kind : null;
  }

  /** Calibrate a device: move every axis through its whole travel, leave the stick centred, then finish. */
  startCalibration(key) {
    this._calib = { key, min: {}, max: {} };
  }

  /** Writes min / max / centre into every role on that device; returns how many axes it saw move. */
  finishCalibration() {
    const c = this._calib;
    this._calib = null;
    if (!c) return 0;
    const d = this.devices.find((x) => x.key === c.key);
    if (!d) return 0;
    const s = this._own(c.key, d.mapping);
    let n = 0;
    for (const role in s.axes) {
      const a = s.axes[role];
      const lo = c.min[a.axis];
      const hi = c.max[a.axis];
      if (!(Number.isFinite(lo) && Number.isFinite(hi)) || hi - lo < 0.2) continue;
      a.min = Math.round(lo * 1000) / 1000;
      a.max = Math.round(hi * 1000) / 1000;
      if (ROLE[role].kind === 'centre') a.center = Math.round(clamp(d.axes[a.axis], lo, hi) * 1000) / 1000;
      n++;
    }
    this.save();
    this._rescan();
    return n;
  }

  get calibrating() {
    return this._calib ? this._calib.key : null;
  }

  /* ---- reading the devices ---------------------------------------- */

  /** configFor(), kept between frames until a setting changes (scan() runs every frame). */
  _cfg(key, mapping, shape) {
    const c = this._cfgCache || (this._cfgCache = new Map());
    const id = `${key}\n${mapping}\n${shape.axes}\n${shape.buttons}`;
    const hit = c.get(id);
    if (hit && hit.v === (this.version || 0)) return hit.cfg;
    const cfg = this.configFor(key, mapping, shape);
    c.set(id, { v: this.version || 0, cfg });
    return cfg;
  }

  _rescan() {
    this.version = (this.version || 0) + 1;
    for (const d of this.devices) d.cfg = this.configFor(d.key, d.mapping, { axes: d.axes.length, buttons: d.buttons.length });
  }

  /**
   * Read every connected device: this.devices = [{ key, index, id, name,
   * vendor, product, mapping, axes: [..], buttons: [{ pressed, value }],
   * cfg }]. Safe to call any number of times a frame (Settings' meters do);
   * it never presses a button's action — poll() does that.
   */
  scan() {
    let pads = [];
    if (this.enabled) {
      try {
        pads = this.getPads() || [];
      } catch (e) {
        pads = [];
      }
    }
    const out = [];
    const count = {};
    for (const p of Array.from(pads)) {
      if (!p || p.connected === false) continue;
      const base = String(p.id || 'Controller');
      // Two of the same device (a second quadrant) are told apart by order.
      count[base] = (count[base] || 0) + 1;
      const key = count[base] > 1 ? `${base} #${count[base]}` : base;
      const info = parseId(base);
      const mapping = p.mapping || '';
      const axes = Array.from(p.axes || [], (v) => (Number.isFinite(v) ? v : 0));
      const buttons = Array.from(p.buttons || [], (b) =>
        typeof b === 'object' && b ? { pressed: !!b.pressed, value: Number(b.value) || (b.pressed ? 1 : 0) } : { pressed: !!b, value: b ? 1 : 0 });
      out.push({ key, index: p.index, id: base, name: info.name, vendor: info.vendor, product: info.product, mapping, axes, buttons, pad: p, cfg: this._cfg(key, mapping, { axes: axes.length, buttons: buttons.length }) });
    }
    // Connects and disconnects, once each.
    const keys = new Set(out.map((d) => d.key));
    for (const d of out) {
      if (!this.devices.some((x) => x.key === d.key)) {
        const first = !this.seen.has(d.key);
        this.seen.add(d.key);
        this.events.push({ type: 'connect', key: d.key, name: d.name, profile: d.cfg.profile.name, profileId: d.cfg.profile.id, first, roles: Object.keys(d.cfg.axes) });
      }
    }
    for (const d of this.devices) if (!keys.has(d.key)) this.events.push({ type: 'disconnect', key: d.key, name: d.name });
    if (this.events.length > 20) this.events.splice(0, this.events.length - 20);
    this.devices = out;
    this._watch();
    return out;
  }

  /** Detection and calibration, on each scan. */
  _watch() {
    const c = this._calib;
    if (c) {
      const d = this.devices.find((x) => x.key === c.key);
      if (d) {
        d.axes.forEach((v, i) => {
          if (Math.abs(v) > 1.05) return; // a hat switch's "centred" value, not an axis
          c.min[i] = Math.min(c.min[i] ?? v, v);
          c.max[i] = Math.max(c.max[i] ?? v, v);
        });
      }
    }
    const t = this._detect;
    if (!t) return;
    if (!t.base) {
      t.base = {};
      for (const d of this.devices) t.base[d.key] = { axes: d.axes.slice(), buttons: d.buttons.map((b) => b.pressed) };
      return;
    }
    let hit = null;
    let best = 0;
    for (const d of this.devices) {
      const b = t.base[d.key];
      if (!b) {
        t.base[d.key] = { axes: d.axes.slice(), buttons: d.buttons.map((x) => x.pressed) };
        continue;
      }
      if (t.kind === 'axis') {
        d.axes.forEach((v, i) => {
          if (Math.abs(v) > 1.05 || Math.abs(b.axes[i] ?? v) > 1.05) return;
          const moved = Math.abs(v - (b.axes[i] ?? v));
          if (moved > 0.5 && moved > best) {
            best = moved;
            hit = { key: d.key, index: i, mapping: d.mapping };
          }
        });
      } else {
        d.buttons.forEach((x, i) => {
          if (!hit && x.pressed && !b.buttons[i]) hit = { key: d.key, index: i, mapping: d.mapping };
        });
      }
    }
    if (hit || now() - t.t0 > t.timeout * 1000) {
      this._detect = null;
      // The button that answered must not also press its action as it comes up.
      if (hit && t.kind === 'button') this._btn.set(`${hit.key}|${hit.index}`, true);
      if (t.done) t.done(hit);
    }
  }

  /** The standard-layout pads (input.js reads these with the game's old Xbox code). */
  standardPads() {
    return this.devices.filter((d) => d.cfg.mode === 'standard').map((d) => d.pad);
  }

  /**
   * A hat switch, if this device has one. Browsers report a POV hat as ONE
   * axis (Chrome puts it at HID index 9 — the TCA sidestick's thumb hat):
   * eight positions spread over -1..1 clockwise from up (-1 up, -5/7 up
   * right, -3/7 right ... 1 up left) and about 9/7 when centred. The axis is
   * known by that centred value (no stick or lever ever reads it), so no
   * profile has to name it. Returns { x, y } or null.
   */
  _hatOf(d) {
    const map = this._hatAxis || (this._hatAxis = new Map());
    let i = map.get(d.key);
    if (i == null) {
      i = d.axes.findIndex((v) => Math.abs(v) > 1.05 && Math.abs(v) < 1.6);
      if (i < 0) return null;
      map.set(d.key, i);
    }
    const v = d.axes[i];
    if (!Number.isFinite(v) || Math.abs(v) > 1.05) return { x: 0, y: 0 };
    return hatDir(v);
  }

  /** One role's live value on one device (Settings' meters), or null. */
  roleValue(d, role) {
    const a = d && d.cfg.axes[role];
    if (!a || !(a.axis < d.axes.length)) return null;
    return shapeAxis(d.axes[a.axis], a, ROLE[role].kind);
  }

  /**
   * Read everything for this frame: scan(), then every role from the device
   * that has it (the highest `prio`: pedals' rudder beats a stick's twist; a
   * quadrant's two levers beat a stick's single throttle), and the buttons.
   * Returns this.state (see _emptyState); null fields are "no device has it".
   */
  poll(dt) {
    if (Number.isFinite(dt) && dt > 0) this._gameMs += dt * 1000;
    this.scan();
    const st = this._emptyState();
    const pick = {};
    for (const d of this.devices) {
      if (d.cfg.mode !== 'mapped') continue;
      st.any = true;
      for (const role in d.cfg.axes) {
        const a = d.cfg.axes[role];
        if (!ROLE[role] || !a || !(a.axis >= 0 && a.axis < d.axes.length)) continue;
        const prio = Number.isFinite(a.prio) ? a.prio : ROLE_PRIO[role] || 2;
        if (pick[role] && pick[role].prio >= prio) continue;
        pick[role] = { prio, d, a, v: shapeAxis(d.axes[a.axis], a, ROLE[role].kind) };
      }
    }
    for (const r of ['roll', 'pitch', 'yaw', 'speedbrake', 'flaps']) if (pick[r]) st[r] = pick[r].v;
    // The hat (POV) switch: the look-around on a sidestick (input.js turns it into free look).
    for (const d of this.devices) {
      if (d.cfg.mode !== 'mapped') continue;
      const h = this._hatOf(d);
      if (h) {
        st.hat = h;
        if (h.x || h.y) break;
      }
    }

    // Thrust: two levers if any device has them (then a single lever elsewhere is ignored), else one.
    const inRev = {};
    const lev = (p, role) => {
      if (!p.a.detents) return { thrust: p.v, detent: null, reverse: 0, hasRev: false };
      const id = `${p.d.key}|${role}`;
      const l = airbusThrust(p.v, p.a.detents, !!this._inRev[id]);
      if (l.detent === 'REV') inRev[id] = true;
      return l;
    };
    const hasRev = (p) => !!(p && p.a.detents && p.a.detents.rev !== false);
    if (pick.throttle1 || pick.throttle2) {
      const p1 = pick.throttle1 || pick.throttle2;
      const p2 = pick.throttle2 || pick.throttle1;
      const l1 = lev(p1, pick.throttle1 ? 'throttle1' : 'throttle2');
      const l2 = lev(p2, pick.throttle2 ? 'throttle2' : 'throttle1');
      st.eng = [l1.thrust, l2.thrust];
      st.throttle = (l1.thrust + l2.thrust) / 2;
      st.split = pick.throttle1 && pick.throttle2 ? l2.thrust - l1.thrust : 0;
      st.detents = [l1.detent, l2.detent];
      st.reverse = hasRev(p1) || hasRev(p2) ? Math.max(l1.reverse, l2.reverse) : null;
      st.thrustDevice = p1.d.key;
    } else if (pick.throttle) {
      const l = lev(pick.throttle, 'throttle');
      st.throttle = l.thrust;
      st.detents = [l.detent];
      st.reverse = hasRev(pick.throttle) ? l.reverse : null;
      st.thrustDevice = pick.throttle.d.key;
    }
    this._inRev = inRev;
    if (pick.brakeL || pick.brakeR) {
      const b = toeBrakes(pick.brakeL ? pick.brakeL.v : 0, pick.brakeR ? pick.brakeR.v : 0);
      st.brakeL = b.left;
      st.brakeR = b.right;
      st.brakes = b.brakes;
    }

    // Buttons.
    const quiet = !!this._detect;
    const t = this.clock ? this.clock() : Number.isFinite(dt) ? this._gameMs : now();
    let masterKnown = false;
    let masterOn = false;
    let masterChanged = false;
    /** The action keys still legitimately held this poll (any other we pressed is let go below). */
    const live = new Set();
    for (const d of this.devices) {
      if (d.cfg.mode !== 'mapped') continue;
      for (const idx in d.cfg.buttons) {
        const action = d.cfg.buttons[idx];
        const b = d.buttons[Number(idx)];
        if (!action || !b) continue;
        const id = `${d.key}|${idx}`;
        const was = this._btn.get(id);
        const nowDown = b.pressed;
        this._btn.set(id, nowDown);
        if (nowDown && this._down.get(id) === action) live.add(id);
        const spec = BUTTON_SPECIALS[action];
        if (spec && spec.latch) {
          masterKnown = true;
          if (nowDown) masterOn = true;
          if (nowDown && !was) this._latchOn.set(id, t);
          if (was !== undefined && was !== nowDown) {
            /*
             * A switch stays where it is put; a push-button (the profile's
             * guess may be an A/THR disconnect, not a master) comes back up
             * at once. A release that quick is not "master OFF" — it must
             * never shut the engines down in flight.
             */
            const since = this._latchOn.get(id);
            const momentary = !nowDown && Number.isFinite(since) && t - since < MOMENTARY_MS;
            if (!momentary) masterChanged = true;
          }
          continue;
        }
        if (spec && spec.hold) {
          if (nowDown && !quiet) st.brakeHold = true;
          continue;
        }
        if (was === undefined) continue; // the first look at a button is not a press
        if (nowDown === !!was || quiet) continue;
        if (action === '@parkingBrake' || action === '@apDisconnect') {
          if (nowDown) st.edges[action.slice(1)] = true;
          continue;
        }
        if (!ACTIONS[action]) continue;
        // Up only after our own down: a button held when the game first saw it, or the one that
        // answered "press the button", never sends a key up nobody pressed.
        if (nowDown) {
          if (this.dispatch(action, true) !== false) {
            this._down.set(id, action);
            live.add(id);
          }
        }
      }
    }
    // Released, unplugged, ignored, rebound, or "Use game controllers" off: the key comes up — never stuck down.
    for (const [id, action] of this._down) {
      if (live.has(id)) continue;
      this._down.delete(id);
      this.dispatch(action, false);
    }
    st.masters = { changed: masterChanged && !quiet, anyOn: masterOn, known: masterKnown };
    this.state = st;
    return st;
  }

  /** Let go of every action key a button holds down (the controllers switched off). */
  releaseAll() {
    for (const [, action] of this._down) this.dispatch(action, false);
    this._down.clear();
    this._btn.clear();
  }

  /** The connects and disconnects since the last call. */
  drainEvents() {
    return this.events.splice(0, this.events.length);
  }
}

function now() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

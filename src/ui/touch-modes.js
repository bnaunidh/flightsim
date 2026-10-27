/**
 * Touch flying modes (wave 18, owner: "on mobile maybe u can control plane
 * with ur fingers"): the maths, pure, so tests/features/touch-modes.mjs checks
 * every axis in node. ui/touch.js wires it to fingers and the gyroscope.
 *
 *   Stick           the fixed on-screen stick, as it always was.
 *   Drag anywhere   a finger down anywhere on the left 55% of the picture (not
 *                   on a button, a sheet or the map) puts a floating stick under
 *                   it; dragging is pitch and roll, lifting springs it back.
 *                   Drag down to climb, like the stick. The default on phones.
 *   Tilt            steer by tilting the phone (Infinite Flight's way): tilt it
 *                   left and right to roll, top edge towards you to climb.
 *                   "Level" takes the way you are holding it as centre; a
 *                   sensitivity slider; landscape-aware (the screen's own axes,
 *                   whichever way round it is). No gyroscope, or no permission:
 *                   Drag anywhere instead.
 *
 * Settings: `touchFlying` ('auto' | 'stick' | 'drag' | 'tilt'; auto is Drag
 * anywhere on a phone and the Stick on a tablet), `tiltSensitivity`
 * (0.5-2), `tiltLevel` ({ roll, pitch } degrees, or null for "level it the
 * first time"), and the existing `sensitivity` (mouse & touch) for Drag.
 */

export const TOUCH_FLYING = Object.freeze(['auto', 'stick', 'drag', 'tilt']);

/** A phone, by the size of its screen in CSS pixels: the short side at most 540. */
export function isPhoneScreen(w, h) {
  const s = Math.min(Number(w) || 0, Number(h) || 0);
  return s > 0 && s <= 540;
}

/** The mode a choice means on this device. `tilt: false` = no gyroscope / no permission. */
export function resolveTouchFlying(choice, { phone = false, tilt = true } = {}) {
  const c = TOUCH_FLYING.includes(choice) ? choice : 'auto';
  if (c === 'auto') return phone ? 'drag' : 'stick';
  if (c === 'tilt' && tilt === false) return 'drag';
  return c;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * One axis shaped: a small dead zone, the gain (sensitivity), and an expo
 * curve — the same curve as a flight stick's (flight/controllers.js): 0 is
 * linear, towards 1 the middle gets softer and the ends stay where they are.
 */
export function shapeAxis(v, sens = 1, curve = 0, dead = 0.03) {
  const a = Math.abs(v);
  if (!(a > dead)) return 0;
  let t = clamp(((a - dead) / (1 - dead)) * (Number(sens) || 1), 0, 1);
  const c = clamp(Number(curve) || 0, 0, 1);
  if (c > 0) t = (1 - c) * t + c * t * t * t;
  return Math.sign(v) * t;
}

/** Full deflection this far from where the finger went down, CSS px. */
export const DRAG_RADIUS = 62;

/**
 * The floating stick: (dx, dy) px from where the finger went down. Returns
 * { roll, pitch, kx, ky } — the axes (pitch + is pulled back: drag down to
 * climb) and the knob's offset, clamped to the ring.
 */
export function dragAxes(dx, dy, { radius = DRAG_RADIUS, sens = 1, boat = false } = {}, out = {}) {
  const R = Math.max(10, radius);
  const len = Math.hypot(dx, dy);
  const f = len > R ? R / len : 1;
  const nx = (dx * f) / R;
  const ny = (dy * f) / R;
  out.kx = nx * R;
  out.ky = boat ? 0 : ny * R;
  out.roll = shapeAxis(nx, sens, 0);
  out.pitch = boat ? 0 : shapeAxis(ny, sens, 0);
  return out;
}

const D2R = Math.PI / 180;

/**
 * Which way is up, in the device's own frame (x right, y up the screen in
 * portrait, z out of the glass), from DeviceOrientationEvent's beta (front
 * to back, about x) and gamma (left to right, about y). Flat on a table, face
 * up: (0, 0, 1); upright in portrait: (0, 1, 0).
 */
export function upInDevice(beta, gamma) {
  const b = (Number(beta) || 0) * D2R;
  const g = (Number(gamma) || 0) * D2R;
  return { x: -Math.cos(b) * Math.sin(g), y: Math.sin(b), z: Math.cos(b) * Math.cos(g) };
}

/**
 * The same, in the SCREEN's frame (x right, y up as the picture is drawn),
 * for a screen turned `angle` degrees (screen.orientation.angle: 0 portrait,
 * 90 landscape with the top of the phone to the left, 270 to the right).
 */
export function upOnScreen(up, angle = 0) {
  const a = (((Number(angle) || 0) % 360) + 360) % 360;
  const r = a * D2R;
  const c = Math.round(Math.cos(r) * 1e6) / 1e6;
  const s = Math.round(Math.sin(r) * 1e6) / 1e6;
  return { x: up.x * c - up.y * s, y: up.x * s + up.y * c, z: up.z };
}

/**
 * How the phone is held, in degrees, in the screen's frame:
 *   roll   tilted to the right (its right side down) is +, whether it is held
 *          upright like a steering wheel or nearly flat;
 *   pitch  0 upright facing you, 90 flat face up: the top edge tipped towards
 *          you (pulling back) makes it bigger.
 */
export function holdAngles(beta, gamma, angle = 0) {
  const u = upOnScreen(upInDevice(beta, gamma), angle);
  return {
    roll: Math.atan2(-u.x, Math.hypot(u.y, u.z)) / D2R,
    pitch: Math.atan2(u.z, u.y) / D2R,
  };
}

/** Degrees of tilt from level for full deflection, at sensitivity 1. */
export const TILT_RANGE = 28;
/** Where "level" is before the player has levelled it: a phone held at about 40° from flat. */
export const TILT_DEFAULT_LEVEL = Object.freeze({ roll: 0, pitch: 50 });

/**
 * The tilt as stick axes. `level` the angles that are centre; `sens` the tilt
 * sensitivity (0.5-2); a soft centre (curve 0.35) so a hand that is not
 * perfectly still does not wander the aeroplane about.
 */
export function tiltAxes(beta, gamma, angle = 0, { level = TILT_DEFAULT_LEVEL, sens = 1, boat = false } = {}, out = {}) {
  const h = holdAngles(beta, gamma, angle);
  const lv = level || TILT_DEFAULT_LEVEL;
  let dp = h.pitch - (Number(lv.pitch) || 0);
  let dr = h.roll - (Number(lv.roll) || 0);
  // Wrap, for a phone tipped past flat.
  if (dp > 180) dp -= 360;
  if (dp < -180) dp += 360;
  if (dr > 180) dr -= 360;
  if (dr < -180) dr += 360;
  const range = TILT_RANGE / clamp(Number(sens) || 1, 0.25, 4);
  out.roll = shapeAxis(clamp(dr / range, -1, 1), 1, 0.35, 0.05);
  out.pitch = boat ? 0 : shapeAxis(clamp(dp / range, -1, 1), 1, 0.35, 0.05);
  out.held = Math.abs(out.roll) > 0 || Math.abs(out.pitch) > 0;
  out.angles = h;
  return out;
}

/**
 * What a finger keeps for itself: anything you can press. A tap on one of
 * these is never the floating stick (ui/touch.js asks `closest()` of the
 * element under the finger, and anything drawn with a pointer cursor counts too).
 */
export const TOUCH_KEEP = [
  'button', 'a', 'input', 'select', 'textarea', 'label', '[role="button"]', '[role="dialog"]', '[data-touch-keep]',
  '.minimap', '.touch-pads', '.touch-pad', '.touch-sheet', '.touch-throttle', '.touch-rudder', '.touch-stick', '.touch-tilt-level',
  '.touch-wheel', '.touch-pedals', '.touch-lever', '.hud-buttons', '.screen', '.menu', '.modal',
].join(', ');

/**
 * Should a finger that came down at x on `target` start the floating stick?
 * Only on the picture — the canvas itself, or a readout drawn over it that
 * cannot be pressed (`pressable(target)` false) — on the left 55% of the
 * screen, never the mouse, and one finger at a time. So never on a button,
 * a sheet, a card or the map.
 */
export function dragClaims({ target, surface, x, width, busy = false, pointerType = 'touch', pressable = null }) {
  if (busy || !surface || !target) return false;
  if (pointerType === 'mouse') return false;
  if (!(x >= 0 && x < (Number(width) || 0) * 0.55)) return false;
  if (target === surface) return true;
  return typeof pressable === 'function' ? !pressable(target) : false;
}

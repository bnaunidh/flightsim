/**
 * Touch flying modes (wave 18): the axis maths of every mode, in node.
 *
 *   node tests/features/touch-modes.mjs
 *
 *   - the choice: auto is Drag anywhere on a phone and the Stick on a tablet;
 *     Tilt without a gyroscope (or permission) is Drag anywhere;
 *   - Drag anywhere: drag down climbs, right rolls right, full deflection at
 *     the ring, clamped beyond it, the knob stays on the ring, a boat has no
 *     pitch, the sensitivity scales it, a twitch at the centre is nothing;
 *   - Tilt: level is centre; right side down rolls right, top edge towards
 *     you climbs — in portrait AND in both landscapes, held upright or nearly
 *     flat; the sensitivity scales it; the boat has no pitch; the centre is soft;
 *   - only a finger on the picture, left of 55%, starts the floating stick:
 *     never one on a button, a sheet or the map, never the mouse, never a
 *     second finger;
 *   - the settings have the choice, and the touch layer and main.js use it.
 */

import { readFileSync } from 'node:fs';

const M = await import('../../src/ui/touch-modes.js');

let passed = 0;
const failed = [];
function ok(name, pass, detail = '') {
  if (pass) passed++;
  else failed.push(name);
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail !== '' ? `  (${detail})` : ''}`);
}
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

/* ---- the choice ---- */
ok('choice: auto is Drag anywhere on a phone', M.resolveTouchFlying('auto', { phone: true }) === 'drag');
ok('choice: auto is the Stick on a tablet', M.resolveTouchFlying('auto', { phone: false }) === 'stick');
ok('choice: the Stick when asked, on a phone too', M.resolveTouchFlying('stick', { phone: true }) === 'stick');
ok('choice: Tilt falls back to Drag anywhere with no gyroscope or no permission', M.resolveTouchFlying('tilt', { tilt: false }) === 'drag' && M.resolveTouchFlying('tilt', { tilt: true }) === 'tilt');
ok('choice: nonsense is auto', M.resolveTouchFlying('zzz', { phone: true }) === 'drag');
ok('phone: 375x812 and 812x375 are phones, 768x1024 is not', M.isPhoneScreen(375, 812) && M.isPhoneScreen(812, 375) && !M.isPhoneScreen(768, 1024));

/* ---- drag anywhere ---- */
{
  const R = M.DRAG_RADIUS;
  const down = M.dragAxes(0, R);
  ok('drag: down by the ring\'s radius is full pull back (climb)', near(down.pitch, 1) && near(down.roll, 0), JSON.stringify(down));
  const up = M.dragAxes(0, -R / 2);
  ok('drag: up is nose down, half way is about half', up.pitch < -0.45 && up.pitch > -0.55);
  const right = M.dragAxes(R, 0);
  ok('drag: right is roll right', near(right.roll, 1) && near(right.pitch, 0));
  const far = M.dragAxes(R * 3, R * 4);
  ok('drag: past the ring it is clamped, the knob stays on the ring', Math.hypot(far.roll, far.pitch) <= 1 + 1e-9 && near(Math.hypot(far.kx, far.ky), R, 1e-6), `${far.roll.toFixed(2)},${far.pitch.toFixed(2)}`);
  ok('drag: a twitch at the centre is nothing', M.dragAxes(1, 1).roll === 0 && M.dragAxes(1, 1).pitch === 0);
  const boat = M.dragAxes(R / 2, R, { boat: true });
  ok('drag: a boat has no pitch (and the knob does not move up and down)', boat.pitch === 0 && boat.ky === 0 && boat.roll > 0.4);
  const soft = M.dragAxes(R / 2, 0, { sens: 0.5 }).roll;
  const hot = M.dragAxes(R / 2, 0, { sens: 1.6 }).roll;
  ok('drag: the sensitivity setting scales it', soft < 0.3 && hot > 0.75 && hot <= 1, `${soft.toFixed(2)} ${hot.toFixed(2)}`);
}

/* ---- tilt ---- */
{
  ok('tilt: flat face up is up out of the glass; upright portrait is up the screen', (() => {
    const a = M.upInDevice(0, 0);
    const b = M.upInDevice(90, 0);
    return near(a.z, 1) && near(b.y, 1) && near(b.z, 0, 1e-9);
  })());
  // A pose from screen-frame angles: build beta/gamma by searching (the real
  // sensor's numbers), so the test does not assume the very formula it checks.
  const pose = (angle, rollDeg, pitchDeg) => {
    let best = null;
    for (let b = -180; b <= 180; b += 1) {
      for (let g = -90; g <= 90; g += 1) {
        const h = M.holdAngles(b, g, angle);
        const e = Math.abs(h.roll - rollDeg) + Math.abs(h.pitch - pitchDeg);
        if (!best || e < best.e) best = { b, g, e };
      }
    }
    return best;
  };
  for (const angle of [0, 90, 270]) {
    const where = angle === 0 ? 'portrait' : angle === 90 ? 'landscape (top to the left)' : 'landscape (top to the right)';
    const lv = { roll: 0, pitch: 50 };
    const c = pose(angle, 0, 50);
    const centre = M.tiltAxes(c.b, c.g, angle, { level: lv });
    ok(`tilt ${where}: held at level is centre`, Math.abs(centre.roll) < 0.05 && Math.abs(centre.pitch) < 0.05, `${centre.roll.toFixed(2)} ${centre.pitch.toFixed(2)}`);
    // The physical test: the right side of the SCREEN down. In landscape that is the phone's top or bottom.
    const dn = pose(angle, 20, 50);
    const r = M.tiltAxes(dn.b, dn.g, angle, { level: lv });
    ok(`tilt ${where}: right side of the screen down rolls right`, r.roll > 0.4 && Math.abs(r.pitch) < 0.2, `${r.roll.toFixed(2)} ${r.pitch.toFixed(2)}`);
    const back = pose(angle, 0, 70);
    const p = M.tiltAxes(back.b, back.g, angle, { level: lv });
    ok(`tilt ${where}: top edge towards you climbs`, p.pitch > 0.4 && Math.abs(p.roll) < 0.2, `${p.roll.toFixed(2)} ${p.pitch.toFixed(2)}`);
    const fwd = pose(angle, 0, 30);
    ok(`tilt ${where}: tipped away dives`, M.tiltAxes(fwd.b, fwd.g, angle, { level: lv }).pitch < -0.4);
  }
  // The device-frame facts the screen frame rests on, without the search:
  // portrait, right side down = gamma +; landscape top-left, the screen's
  // right side is the phone's bottom, so it goes down when the phone's top comes up (beta +).
  ok('tilt: portrait — gamma + (right side down) is roll right', M.tiltAxes(50, 25, 0, { level: { roll: 0, pitch: 40 } }).roll > 0.3);
  ok('tilt: landscape, top to the left — the phone\'s top up (its bottom, the screen\'s right, down) is roll right', (() => {
    const l = M.holdAngles(10, -45, 90);
    const r = M.holdAngles(25, -45, 90);
    return r.roll > l.roll + 5;
  })());
  ok('tilt: landscape the other way round is the mirror', (() => {
    const l = M.holdAngles(10, 45, 270);
    const r = M.holdAngles(25, 45, 270);
    return r.roll < l.roll - 5;
  })());
  const lv = { roll: 0, pitch: 40 };
  const lo = M.tiltAxes(50, 8, 0, { level: lv, sens: 0.6 }).roll;
  const hi = M.tiltAxes(50, 8, 0, { level: lv, sens: 1.8 }).roll;
  ok('tilt: the sensitivity slider scales it', hi > lo * 1.8 && hi <= 1, `${lo.toFixed(2)} ${hi.toFixed(2)}`);
  const shake = M.tiltAxes(50.8, 1, 0, { level: lv });
  ok('tilt: a hand that is not quite still is nothing (a soft centre)', shake.roll === 0 && shake.pitch === 0 && !shake.held);
  ok('tilt: a boat has no pitch', M.tiltAxes(70, 20, 0, { level: lv, boat: true }).pitch === 0);
  ok('tilt: never past full deflection, however far it is tipped', (() => {
    for (let b = -180; b <= 180; b += 15) for (let g = -90; g <= 90; g += 15) {
      const t = M.tiltAxes(b, g, 90, { level: lv, sens: 2 });
      if (Math.abs(t.roll) > 1 || Math.abs(t.pitch) > 1 || !Number.isFinite(t.roll + t.pitch)) return false;
    }
    return true;
  })());
}

/* ---- which finger ---- */
{
  const canvas = { id: 'canvas' };
  const button = { id: 'button' };
  const W = 812;
  ok('finger: on the picture, on the left, starts the floating stick', M.dragClaims({ target: canvas, surface: canvas, x: 200, width: W }));
  ok('finger: never one on a button, a sheet or the map (anything over the picture that can be pressed)', !M.dragClaims({ target: button, surface: canvas, x: 200, width: W })
    && !M.dragClaims({ target: button, surface: canvas, x: 200, width: W, pressable: () => true }));
  ok('finger: a readout drawn over the picture that cannot be pressed lets it through', M.dragClaims({ target: { id: 'speed tape' }, surface: canvas, x: 200, width: W, pressable: () => false }));
  ok('finger: the map and every pad, sheet and lever are kept', ['.minimap', '.touch-sheet', '.touch-pads', '.touch-throttle', '.hud-buttons', 'button'].every((k) => M.TOUCH_KEEP.includes(k)));
  ok('finger: the right side is the throttle\'s and the pads\'', !M.dragClaims({ target: canvas, surface: canvas, x: W * 0.6, width: W }));
  ok('finger: a second finger while one flies does not take over', !M.dragClaims({ target: canvas, surface: canvas, x: 100, width: W, busy: true }));
  ok('finger: the mouse never does (desktop free look stays the mouse\'s)', !M.dragClaims({ target: canvas, surface: canvas, x: 100, width: W, pointerType: 'mouse' }));
}

/* ---- wired ---- */
{
  const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const st = read('src/core/storage.js');
  ok('settings: touchFlying (auto), tiltSensitivity and tiltLevel are saved settings', /touchFlying:\s*'auto'/.test(st) && /tiltSensitivity:\s*1/.test(st) && /tiltLevel:\s*null/.test(st));
  const menus = read('src/ui/menus.js');
  ok('settings: Controls has the Touch flying choice, the tilt slider and Level', /data-set="touchFlying"/.test(menus) && /data-set="tiltSensitivity"/.test(menus) && /data-tilt-level/.test(menus));
  const touch = read('src/ui/touch.js');
  ok('touch layer: the three modes are built (setFlyMode, the floating stick, the tilt)', /setFlyMode\(/.test(touch) && /touch-float/.test(touch) && /deviceorientation/.test(touch) && /requestPermission/.test(touch));
  const main = read('src/main.js');
  ok('main: the setting reaches the touch layer', /touchFlying/.test(main) && /setFlyMode/.test(main));
}

console.log(`\n${passed} passed, ${failed.length} failed`);
if (failed.length) {
  console.log(failed.map((f) => `  FAILED: ${f}`).join('\n'));
  process.exit(1);
}
process.exit(0);

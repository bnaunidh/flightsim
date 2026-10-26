/**
 * Node checks for real flight-sim gear (src/flight/controllers.js and its
 * use in src/flight/input.js). Run from the repo root:
 *
 *   node tests/features/controllers.mjs
 *
 * A fake navigator.getGamepads() with the owner's YouTuber's cockpit — a TCA
 * Sidestick Airbus, a TCA Quadrant Airbus (Q-Eng 1&2) and Thrustmaster
 * pedals, each its own device with its own axes — plus an Xbox pad:
 *
 *   1. ids        Chrome's, Firefox's and Safari's id formats parse.
 *   2. profiles   each device gets its built-in profile by vendor:product or
 *                 by name; an Xbox pad and an unknown pad keep the standard
 *                 layout (what every pad had before).
 *   3. shaping    deadzone, invert, curve and calibration; levers 0..1.
 *   4. detents    the Airbus IDLE / CL / FLX-MCT / TOGA gates and the reverse
 *                 range below idle.
 *   5. mixing     pedals' rudder beats the stick's twist; the quadrant's two
 *                 levers beat the stick's single throttle; the toe brakes per
 *                 side; split levers give a thrust split.
 *   6. buttons    a press is the action's key down, the release its key up;
 *                 the first look is not a press; engine masters latch.
 *   7. assign     "move the lever" and "press the button" detection; a role
 *                 moves off the device it was on.
 *   8. storage    saved per device id, read back, reset; blocked storage is
 *                 harmless.
 *   9. Input      the standard pad flies exactly as before; the quadrant's
 *                 axis 2 is never the rudder any more; sim gear drives roll /
 *                 pitch / yaw / throttle / toe brakes / reverse; a key takes
 *                 the throttle back from the lever.
 */

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
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

const store = new Map();
const storage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.localStorage = storage;
const win = new EventTarget();
globalThis.window = win;

await load('src/features/index.js');
const I = await load('src/flight/input.js');
const K = await load('src/flight/controllers.js');

/* ---------------- fake devices ---------------- */

const btns = (n) => Array.from({ length: n }, () => ({ pressed: false, value: 0 }));
function pad(index, id, nAxes, nButtons, mapping = '') {
  return { index, id, mapping, connected: true, axes: new Array(nAxes).fill(0), buttons: btns(nButtons), timestamp: 0 };
}
const STICK_ID = 'Thrustmaster TCA Sidestick Airbus (Vendor: 044f Product: 0405)';
const QUAD_ID = 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)';
const PEDAL_ID = 'T-Rudder (Vendor: 044f Product: b679)';
const XBOX_ID = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';
function cockpit() {
  const stick = pad(0, STICK_ID, 4, 16);
  const quad = pad(1, QUAD_ID, 2, 8);
  const pedals = pad(2, PEDAL_ID, 3, 0);
  // At rest: stick centred, its base lever at idle (raw +1 = aft, inverted),
  // the thrust levers at idle (0.3 of the travel = raw -0.4), toe brakes up (-1).
  stick.axes[3] = 1;
  quad.axes[0] = quad.axes[1] = -0.4;
  pedals.axes[0] = pedals.axes[1] = -1;
  return { stick, quad, pedals };
}
const lever = (t) => t * 2 - 1; // a lever position 0..1 as the raw axis value

/* ---------------- 1. ids ---------------- */

{
  const a = K.parseId(STICK_ID);
  ok('Chrome id: name, vendor, product', a.name === 'Thrustmaster TCA Sidestick Airbus' && a.vendor === '044f' && a.product === '0405', JSON.stringify(a));
  const b = K.parseId('44f-407-TCA Q-Eng 1&2');
  ok('Firefox id: vendor and product padded to four digits', b.name === 'TCA Q-Eng 1&2' && b.vendor === '044f' && b.product === '0407', JSON.stringify(b));
  const c = K.parseId('T-Rudder');
  ok('Safari id: name only', c.name === 'T-Rudder' && c.vendor === null, JSON.stringify(c));
  const x = K.parseId(XBOX_ID);
  ok('an Xbox id loses its "STANDARD GAMEPAD" tag', x.name === 'Xbox Wireless Controller' && x.vendor === '045e', JSON.stringify(x));
}

/* ---------------- 2. profiles ---------------- */

{
  const m = (id, mapping) => K.matchProfile(id, mapping).id;
  ok('TCA Sidestick by vendor:product', m(STICK_ID) === 'tca-sidestick', m(STICK_ID));
  ok('TCA Quadrant by vendor:product', m(QUAD_ID) === 'tca-quadrant', m(QUAD_ID));
  ok('Thrustmaster pedals by vendor:product', m(PEDAL_ID) === 'tm-pedals', m(PEDAL_ID));
  ok('...and by name alone (Safari)', m('TCA Q-Eng 1&2') === 'tca-quadrant' && m('Thrustmaster TCA Sidestick Airbus') === 'tca-sidestick' && m('T-Rudder') === 'tm-pedals' && m('TFRP Rudder') === 'tm-pedals');
  ok('a T.16000M is a joystick with throttle', m('T.16000M (Vendor: 044f Product: b10a)') === 'hotas');
  ok('an X52 has its own', m('Saitek X52 Flight Control System') === 'x52');
  ok('a Honeycomb Alpha is a yoke', m('Alpha Flight Controls (Vendor: 294b Product: 1900)') === 'yoke');
  ok('an Xbox pad keeps the standard layout', m(XBOX_ID, 'standard') === 'standard');
  ok('an unknown USB pad keeps the standard layout too (no regression)', m('USB Gamepad (Vendor: 0079 Product: 0006)', '') === 'standard');
  const quad = K.matchProfile(QUAD_ID);
  ok('the quadrant profile: two thrust levers with detents and reverse', quad.axes.throttle1.detents && quad.axes.throttle2.detents && quad.axes.throttle1.detents.rev === true);
  ok('...and engine masters on its switches', Object.values(quad.buttons).includes('@master1') && Object.values(quad.buttons).includes('@master2'));
  const ped = K.matchProfile(PEDAL_ID);
  ok('the pedals profile: rudder + two toe brakes', ped.axes.yaw && ped.axes.brakeL && ped.axes.brakeR);
  const st = K.matchProfile(STICK_ID);
  ok('the sidestick profile: roll, pitch, twist yaw, trigger = brakes, red button = AP disconnect', st.axes.roll && st.axes.pitch && st.axes.yaw && st.buttons[0] === 'brakes' && st.buttons[1] === '@apDisconnect');
  const bad = K.PROFILES.flatMap((p) => Object.values(p.buttons).filter((a) => !K.BUTTON_SPECIALS[a] && !I.ACTIONS[a]).map((a) => `${p.id}:${a}`));
  ok('every profile button is a real action', bad.length === 0, bad.join(', '));
}

/* ---------------- 3. shaping ---------------- */

{
  const s = K.shapeAxis;
  ok('centre axis: inside the deadzone is 0', s(0.03, { deadzone: 0.05 }) === 0);
  ok('centre axis: the ends reach ±1 through the deadzone', s(1, { deadzone: 0.1 }) === 1 && s(-1, { deadzone: 0.1 }) === -1);
  ok('centre axis: rescaled past the deadzone (0.55 with dz 0.1 → 0.5)', near(s(0.55, { deadzone: 0.1 }), 0.5));
  ok('invert flips it', s(0.5, { invert: true }) === -0.5);
  ok('a curve softens the middle and keeps the ends', s(0.5, { curve: 1 }) < 0.2 && s(1, { curve: 1 }) === 1);
  ok('calibration: a stick centred at 0.1 reads 0 there', s(0.1, { center: 0.1 }) === 0 && near(s(0.55, { center: 0.1 }), 0.5));
  ok('calibration: a short travel (−0.8..0.8) still reaches full', s(0.8, { min: -0.8, max: 0.8 }) === 1);
  ok('lever: −1..1 is 0..1', s(-1, {}, 'lever') === 0 && s(1, {}, 'lever') === 1 && near(s(0, {}, 'lever'), 0.5));
  ok('lever inverted: forward (−1) is full', s(-1, { invert: true }, 'lever') === 1);
  ok('lever: the deadzone is at the ends', s(lever(0.01), { deadzone: 0.02 }, 'lever') === 0 && s(lever(0.99), { deadzone: 0.02 }, 'lever') === 1);
  ok('junk in is the middle, not NaN', s(NaN, {}) === 0 && s(undefined, {}, 'lever') === 0.5);
}

/* ---------------- 4. detents ---------------- */

{
  const T = (t) => K.airbusThrust(t);
  const D = K.AIRBUS_DETENTS;
  ok('IDLE: thrust 0', T(D.idle).detent === 'IDLE' && T(D.idle).thrust === 0, JSON.stringify(T(D.idle)));
  ok('CL clicks in within the band', T(D.cl + 0.02).detent === 'CL' && T(D.cl).thrust === K.DETENT_THRUST.CL);
  ok('FLX / MCT', T(D.flx).detent === 'FLX' && T(D.flx).thrust === K.DETENT_THRUST.FLX);
  ok('TOGA at the stop is full power', T(1).detent === 'TOGA' && T(1).thrust === 1);
  const mid = T((D.idle + D.cl) / 2);
  ok('between IDLE and CL: manual thrust in proportion', mid.detent === 'MAN' && mid.thrust > 0.3 && mid.thrust < 0.6, JSON.stringify(mid));
  const rising = [0.35, 0.45, 0.55, 0.62, 0.7, 0.82, 0.9, 1].map((t) => T(t).thrust);
  ok('thrust never goes down as the lever goes forward', rising.every((v, i) => i === 0 || v >= rising[i - 1]), rising.map((v) => v.toFixed(2)).join(' '));
  ok('below idle is the reverse range', T(0.15).detent === 'REV' && T(0.15).thrust === 0 && T(0.15).reverse > 0.3 && T(0.15).reverse < 0.7, JSON.stringify(T(0.15)));
  ok('full aft is MAX reverse', T(0).reverse === 1);
  ok('reverse detents: shallow = idle reverse, deep = MAX', K.reverseDetent(0.3) === 0.5 && K.reverseDetent(0.9) === 1 && K.reverseDetent(0) === 0);
  const noRev = K.airbusThrust(0.02, { rev: false });
  ok('a lever without reverse: the aft stop is IDLE', noRev.detent === 'IDLE' && noRev.reverse === 0, JSON.stringify(noRev));
  const moved = K.airbusThrust(0.5, { cl: 0.5 });
  ok('a detent moved by the player is where it clicks', moved.detent === 'CL', JSON.stringify(moved));
  const b = K.toeBrakes(0.8, 0.2);
  ok('toe brakes: the harder pedal is "the brakes", and each side its own', b.brakes === 0.8 && b.left === 0.8 && b.right === 0.2 && near(b.diff, -0.6));
}

/* ---------------- 5. mixing ---------------- */

let CLOCK = 0; // ms, for the engine masters' switch-or-button test
const fresh = (pads, { dispatch } = {}) => {
  store.delete(K.STORAGE_KEY);
  return new K.Controllers({ getPads: () => pads, storage, dispatch: dispatch || (() => true), clock: () => CLOCK });
};

{
  const { stick, quad, pedals } = cockpit();
  const C = fresh([stick, quad, pedals]);
  let st = C.poll();
  ok('three devices, all mapped', C.devices.length === 3 && C.devices.every((d) => d.cfg.mode === 'mapped'), C.devices.map((d) => `${d.name}:${d.cfg.mode}`).join(', '));
  ok('at rest: no roll, pitch or yaw', st.roll === 0 && st.pitch === 0 && st.yaw === 0, JSON.stringify([st.roll, st.pitch, st.yaw]));
  ok('at rest: both levers in IDLE, thrust 0', st.throttle === 0 && st.detents.join() === 'IDLE,IDLE', JSON.stringify(st.detents));
  ok('at rest: toe brakes off', st.brakeL === 0 && st.brakeR === 0);
  stick.axes[0] = 0.6;
  stick.axes[1] = -0.5; // pushed forward
  stick.axes[2] = 0.9; // twisted right
  pedals.axes[2] = -0.4; // left rudder
  st = C.poll();
  ok('stick: roll right', st.roll > 0.5, st.roll);
  ok('stick: pushed forward is nose DOWN (a real stick, not a gamepad)', st.pitch < -0.4, st.pitch);
  ok('pedals\' rudder wins over the stick\'s twist', st.yaw < -0.3, st.yaw);
  quad.axes[0] = lever(K.AIRBUS_DETENTS.cl);
  quad.axes[1] = lever(1);
  stick.axes[3] = -1; // the stick's own throttle full forward: ignored, the quadrant has two levers
  st = C.poll();
  ok('split levers: engine 1 CL, engine 2 TOGA', st.detents.join() === 'CL,TOGA' && near(st.eng[0], K.DETENT_THRUST.CL) && st.eng[1] === 1, JSON.stringify(st.detents));
  ok('...throttle is their average', near(st.throttle, (K.DETENT_THRUST.CL + 1) / 2), st.throttle);
  ok('...and the split is engine 2 minus engine 1', near(st.split, 1 - K.DETENT_THRUST.CL), st.split);
  ok('the stick\'s single throttle is ignored while the quadrant is there', st.thrustDevice === QUAD_ID, st.thrustDevice);
  quad.axes[0] = quad.axes[1] = lever(0.05);
  st = C.poll();
  ok('both levers pulled back through idle: reverse', st.detents.join() === 'REV,REV' && st.reverse > 0.6 && st.throttle === 0, JSON.stringify([st.detents, st.reverse]));
  pedals.axes[0] = 1; // left toe brake full
  st = C.poll();
  ok('left toe brake only: brakeL 1, brakeR 0', st.brakeL === 1 && st.brakeR === 0 && st.brakes === 1);

  // Without the quadrant the stick's own lever is the throttle.
  const solo = fresh([cockpit().stick]);
  solo.devices = [];
  const s2 = solo.poll();
  ok('stick alone: its base lever is the throttle (at idle)', s2.throttle === 0 && s2.reverse === null && s2.eng === null, JSON.stringify([s2.throttle, s2.reverse]));
  ok('stick alone: the twist is the rudder', s2.yaw === 0);
}

/* ---------------- 6. buttons ---------------- */

{
  const { stick, quad, pedals } = cockpit();
  const sent = [];
  const C = fresh([stick, quad, pedals], { dispatch: (a, down) => sent.push(`${a}:${down ? 'down' : 'up'}`) });
  stick.buttons[4].pressed = true; // gear, held when the game first looks
  C.poll();
  ok('a button already held at the first look is not a press', sent.length === 0, sent.join());
  stick.buttons[4].pressed = false;
  C.poll();
  stick.buttons[4].pressed = true;
  C.poll();
  C.poll();
  stick.buttons[4].pressed = false;
  C.poll();
  ok('press and release: the action\'s key down once, up once (and no stray up for the held one)', sent.join() === 'gear:down,gear:up', sent.join());
  stick.buttons[0].pressed = true;
  let st = C.poll();
  ok('the trigger holds the wheel brakes (not a key: Space is also the PvP gun)', st.brakeHold === true && !sent.some((s) => s.startsWith('brakes')), sent.join());
  stick.buttons[0].pressed = false;
  stick.buttons[1].pressed = true;
  st = C.poll();
  ok('the red button: autopilot disconnect, as an edge', st.edges.apDisconnect === true);
  st = C.poll();
  ok('...once', st.edges.apDisconnect === false);
  quad.buttons[0].pressed = true;
  st = C.poll();
  ok('engine master 1 to ON: changed, one on', st.masters.changed && st.masters.anyOn && st.masters.known);
  st = C.poll();
  ok('...a held switch is not a change', !st.masters.changed && st.masters.anyOn);
  CLOCK += 5000;
  quad.buttons[0].pressed = false;
  st = C.poll();
  ok('both masters OFF: changed, none on', st.masters.changed && !st.masters.anyOn);
  // The profile's master may really be a push-button (an A/THR disconnect): a quick press and release.
  quad.buttons[0].pressed = true;
  st = C.poll();
  ok('a master input to ON is a change (starts the engines)', st.masters.changed && st.masters.anyOn);
  CLOCK += 150;
  quad.buttons[0].pressed = false;
  st = C.poll();
  ok('...but coming back up 0.15 s later is a push-button, not "master OFF": the engines are not stopped', !st.masters.changed && !st.masters.anyOn);
}

/* ---------------- 6b. no stuck keys ---------------- */

{
  const { stick, quad, pedals } = cockpit();
  let pads = [stick, quad, pedals];
  const sent = [];
  const C = new K.Controllers({ getPads: () => pads, storage, dispatch: (a, down) => sent.push(`${a}:${down ? 'down' : 'up'}`) });
  C.poll();
  stick.buttons[4].pressed = true; // gear, pressed and held
  C.poll();
  pads = [quad, pedals]; // the stick unplugged mid-flight, button still in
  C.poll();
  ok('unplugged with a button held: its key comes up (not stuck down)', sent.join() === 'gear:down,gear:up', sent.join());
  pads = [stick, quad, pedals]; // plugged back in, still held
  C.poll();
  C.poll();
  ok('...plugged back in still held: not a new press', sent.length === 2, sent.join());
  stick.buttons[4].pressed = false;
  C.poll();
  stick.buttons[4].pressed = true;
  C.poll();
  C.bindButton(stick.id, 4, 'camera'); // rebound while held
  C.poll();
  ok('rebound while held: the OLD action\'s key comes up', sent.slice(2).join() === 'gear:down,gear:up', sent.join());
  stick.buttons[4].pressed = false;
  C.poll();
  stick.buttons[4].pressed = true;
  C.poll();
  C.setProfile(stick.id, 'none'); // ignored while held
  C.poll();
  ok('ignored while held: its key comes up', sent.slice(-1)[0] === 'camera:up', sent.join());
  C.setProfile(stick.id, 'auto');
  stick.buttons[4].pressed = false;
  C.poll();
  stick.buttons[4].pressed = true;
  C.poll();
  C.releaseAll();
  ok('releaseAll (controllers switched off): every held key up', sent.slice(-2).join() === 'gear:down,gear:up', sent.join());
  store.delete(K.STORAGE_KEY);
}

/* ---------------- 6c. resting on a boundary ---------------- */

{
  const d = K.AIRBUS_DETENTS;
  const edge = d.idle - d.band;
  const jitter = [-0.003, 0.003, -0.002, 0.004, -0.001, 0.003];
  let rev = false;
  const seen = jitter.map((j) => {
    const r = K.airbusThrust(edge + j, d, rev);
    rev = r.detent === 'REV';
    return `${r.detent}:${K.reverseDetent(r.reverse)}`;
  });
  ok('a lever jittering on the reverse edge: once in REV it stays (no reversers flicking in and out)', seen.slice(0).every((x) => x === 'REV:0.5'), seen.join(' '));
  const out = K.airbusThrust(edge + K.REV_HYST + 0.002, d, true);
  ok('...and leaves REV once clearly forward, in the IDLE gate (thrust 0)', out.detent === 'IDLE' && out.thrust === 0, JSON.stringify(out));
  ok('...from forward, the edge itself is still IDLE', K.airbusThrust(edge + 0.003, d, false).detent === 'IDLE');
  ok('MAX reverse holds down to half the range (no MAX / idle-reverse flicker at 0.6)', K.reverseDetent(0.58, 1) === 1 && K.reverseDetent(0.58, 0.5) === 0.5 && K.reverseDetent(0.45, 1) === 0.5);
  // The thrust is continuous through every gate: jitter at a gate's edge cannot jump the power.
  let worst = 0;
  for (let x = 0.31; x < 1; x += 0.0005) worst = Math.max(worst, Math.abs(K.airbusThrust(x + 0.0005).thrust - K.airbusThrust(x).thrust));
  ok('thrust has no step anywhere forward of idle (largest change per 0.0005 of lever)', worst < 0.01, worst);
  // In poll(), through a device.
  const { quad } = cockpit();
  const C = fresh([quad]);
  C.poll();
  const states = [];
  const at = (t) => lever(t * 0.96 + 0.02); // through the lever's 0.02 end deadzone: exactly t at the gates
  quad.axes[0] = quad.axes[1] = at(edge - 0.01);
  states.push(C.poll().detents.join());
  for (const j of jitter) {
    quad.axes[0] = quad.axes[1] = at(edge + j);
    states.push(C.poll().detents.join());
  }
  quad.axes[0] = quad.axes[1] = at(edge + K.REV_HYST + 0.003);
  const leave = C.poll().detents.join();
  ok('poll(): levers pulled into reverse and left resting on its edge stay REV', states.every((x) => x === 'REV,REV'), states.join(' '));
  ok('poll(): ...and come out of it into IDLE when pushed clearly forward', leave === 'IDLE,IDLE', leave);
  store.delete(K.STORAGE_KEY);
}

/* ---------------- 6d. Chrome's axis order ---------------- */

{
  // Chrome / Edge index axes by HID usage (Rz 5, Slider 6, the hat 9); Firefox and Safari pack them.
  const chromeStick = pad(0, STICK_ID, 10, 16);
  const chromePedals = pad(1, PEDAL_ID, 6, 0);
  const ffStick = pad(2, '44f-405-Thrustmaster TCA Sidestick Airbus', 4, 16);
  const C = fresh([chromeStick, chromePedals, ffStick]);
  C.scan();
  const [cs, cp, fs] = C.devices;
  ok('Chrome stick: twist (Rz) is axis 5, the base lever (Slider) axis 6', cs.cfg.axes.yaw.axis === 5 && cs.cfg.axes.throttle.axis === 6, JSON.stringify([cs.cfg.axes.yaw.axis, cs.cfg.axes.throttle.axis]));
  ok('Chrome pedals: the rudder (Rz) is axis 5, the toe brakes X / Y', cp.cfg.axes.yaw.axis === 5 && cp.cfg.axes.brakeL.axis === 0 && cp.cfg.axes.brakeR.axis === 1);
  ok('Firefox stick: the packed order, twist 2 and lever 3', fs.cfg.axes.yaw.axis === 2 && fs.cfg.axes.throttle.axis === 3);
  chromeStick.axes[9] = 1.2857; // Chrome's hat, centred
  chromePedals.axes[5] = 0.7;
  chromePedals.axes[0] = chromePedals.axes[1] = -1;
  chromeStick.axes[6] = 1; // the base lever aft (inverted): idle
  const st = C.poll();
  ok('Chrome: the pedals\' Rz is the rudder, and the hat is no axis', near(st.yaw, (0.7 - 0.03) / 0.97, 1e-6), st.yaw);
  store.delete(K.STORAGE_KEY);
}

/* ---------------- 6e. cockpit panels ---------------- */

{
  ok('an FCU is not a flight control: ignored', K.matchProfile('WINWING FCU-320 (Vendor: 4098 Product: bb10)').id === 'none');
  ok('...nor an EFIS panel', K.matchProfile('Airbus EFIS L (Vendor: 1234 Product: 0001)').id === 'none');
  ok('a 32-button unknown "joystick" (an Arduino-built panel) is ignored', K.matchProfile('Arduino Leonardo (Vendor: 2341 Product: 8036)', '', 32).id === 'none');
  ok('...a 12-button no-name pad still gets the gamepad layout, as always', K.matchProfile('USB Gamepad (Vendor: 0079 Product: 0006)', '', 12).id === 'standard');
  ok('...and a standard-mapped pad with many buttons is a gamepad', K.matchProfile('Fancy Pad (Vendor: 1111 Product: 2222)', 'standard', 40).id === 'standard');
}

/* ---------------- 7. assign ---------------- */

{
  const { stick, quad, pedals } = cockpit();
  const C = fresh([stick, quad, pedals]);
  C.poll();
  let hit = 'waiting';
  C.detect('axis', (h) => (hit = h));
  C.scan();
  ok('detection waits for something to move', hit === 'waiting');
  quad.axes[1] = lever(1); // engine 2 lever to TOGA
  C.scan();
  ok('"move the lever": the quadrant\'s axis 1', hit && hit.key === QUAD_ID && hit.index === 1, JSON.stringify(hit));
  C.assignAxis(hit.key, 'flaps', hit.index);
  ok('assigned: flaps on the quadrant axis 1', C.configFor(QUAD_ID).axes.flaps.axis === 1);
  // Put roll on the pedals' axis 2: it leaves the stick.
  C.assignAxis(PEDAL_ID, 'roll', 2);
  ok('a role lives on one device: roll left the stick', !C.configFor(STICK_ID).axes.roll && C.configFor(PEDAL_ID).axes.roll.axis === 2);
  ok('one job per axis: the pedals\' rudder came off their axis 2', !C.configFor(PEDAL_ID).axes.yaw, JSON.stringify(C.configFor(PEDAL_ID).axes));
  C.assignAxis(PEDAL_ID, 'yaw', 2);
  ok('...and putting the rudder back takes roll off it again', C.configFor(PEDAL_ID).axes.yaw.axis === 2 && !C.configFor(PEDAL_ID).axes.roll);
  let btn = null;
  C.detect('button', (h) => (btn = h));
  C.scan();
  stick.buttons[7].pressed = true;
  C.scan();
  ok('"press the button": stick button 7', btn && btn.key === STICK_ID && btn.index === 7, JSON.stringify(btn));
  C.bindButton(btn.key, btn.index, 'atcRequest');
  ok('bound: button 7 → ATC request', C.configFor(STICK_ID).buttons['7'] === 'atcRequest');
  const sent = [];
  C.dispatch = (a, d) => sent.push(`${a}:${d}`);
  stick.buttons[7].pressed = false;
  C.poll();
  ok('the button that answered the question does not press its action on the way up... beyond a key up', !sent.includes('atcRequest:true'), sent.join());
  let none = 'waiting';
  C.detect('axis', (h) => (none = h), 0);
  C.scan();
  C.scan();
  ok('detection gives up (null) after its timeout', none === null);
  C.setAxisOption(QUAD_ID, 'throttle1', 'invert', true);
  ok('invert is saved', C.configFor(QUAD_ID).axes.throttle1.invert === true);
  quad.axes[0] = lever(0.5);
  C.scan();
  C.setDetentHere(QUAD_ID, 'throttle1', 'cl');
  ok('"set CL here" puts the detent where the lever is', near(C.configFor(QUAD_ID).axes.throttle1.detents.cl, 0.5, 0.002), C.configFor(QUAD_ID).axes.throttle1.detents.cl);
  // Calibration.
  C.startCalibration(STICK_ID);
  for (const v of [-0.9, 0.9, 0.05]) {
    stick.axes[0] = v;
    C.scan();
  }
  C.finishCalibration();
  const yawCfg = C.configFor(STICK_ID).axes.pitch; // only axis 0 moved: pitch (axis 1) did not
  const st0 = C.saved[STICK_ID].axes;
  ok('calibration: an axis that did not move is left alone', yawCfg.min === -1 && yawCfg.max === 1, JSON.stringify(yawCfg));
  C.assignAxis(STICK_ID, 'roll', 0);
  C.startCalibration(STICK_ID);
  for (const v of [-0.9, 0.9, 0.05]) {
    stick.axes[0] = v;
    C.scan();
  }
  C.finishCalibration();
  const rc = C.configFor(STICK_ID).axes.roll;
  ok('calibration: min, max and the centre it was left at', rc.min === -0.9 && rc.max === 0.9 && rc.center === 0.05, JSON.stringify(rc) + JSON.stringify(Object.keys(st0)));
  ok('...and a calibrated stick reads 0 where it rests and ±1 at its ends', C.roleValue(C.devices[0], 'roll') === 0 && (stick.axes[0] = 0.9, C.scan(), C.roleValue(C.devices[0], 'roll') === 1));
  const rollCfg = C.configFor(PEDAL_ID).axes.yaw;
  ok('calibration only touches the device calibrated', rollCfg.min === -1 && rollCfg.max === 1);
}

/* ---------------- 8. storage ---------------- */

{
  const { stick, quad, pedals } = cockpit();
  const C = fresh([stick, quad, pedals]);
  C.poll();
  C.assignAxis(QUAD_ID, 'speedbrake', 1);
  C.bindButton(QUAD_ID, 5, 'gear');
  const raw = store.get(K.STORAGE_KEY);
  ok('saved under islandsim.controllers.v1, by device id', raw && JSON.parse(raw).devices[QUAD_ID], raw && raw.slice(0, 120));
  const C2 = new K.Controllers({ getPads: () => [stick, quad, pedals], storage, dispatch: () => true });
  C2.poll();
  ok('read back: the quadrant\'s speedbrake and gear button', C2.configFor(QUAD_ID).axes.speedbrake.axis === 1 && C2.configFor(QUAD_ID).buttons['5'] === 'gear');
  ok('...and the other devices untouched', !C2.saved[PEDAL_ID] && C2.configFor(PEDAL_ID).profile.id === 'tm-pedals');
  C2.setProfile(STICK_ID, 'hotas');
  ok('choosing a profile by hand', C2.configFor(STICK_ID).profile.id === 'hotas' && !C2.configFor(STICK_ID).auto);
  C2.resetDevice(QUAD_ID);
  ok('reset to defaults: the built-in profile again', !C2.saved[QUAD_ID] && C2.configFor(QUAD_ID).axes.throttle1.axis === 0 && !C2.configFor(QUAD_ID).buttons['5']);
  C2.resetAll();
  ok('reset all: nothing saved', Object.keys(C2.saved).length === 0 && JSON.parse(store.get(K.STORAGE_KEY)).devices && Object.keys(JSON.parse(store.get(K.STORAGE_KEY)).devices).length === 0);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  let threw = false;
  try {
    const C3 = new K.Controllers({ getPads: () => [stick], storage: broken, dispatch: () => true });
    C3.poll();
    C3.assignAxis(STICK_ID, 'yaw', 1);
    C3.poll();
  } catch (e) {
    threw = e;
  }
  ok('blocked storage: no throw, the change lasts the session', !threw, threw && threw.message);
  store.set(K.STORAGE_KEY, '{not json');
  const C4 = new K.Controllers({ getPads: () => [stick], storage, dispatch: () => true });
  ok('broken JSON: the built-in profiles', Object.keys(C4.saved).length === 0);
  store.delete(K.STORAGE_KEY);
}

/* ---------------- 8b. corrupted storage ---------------- */

{
  const { stick, quad } = cockpit();
  const bad = [
    { [QUAD_ID]: { profile: 'auto', axes: { throttle1: { axis: 0, detents: { idle: 'x', cl: null, toga: 'NaN' } }, throttle2: { axis: 1, detents: 'bad' } } } },
    { [QUAD_ID]: null, [STICK_ID]: 'a string' },
    { [QUAD_ID]: { axes: { throttle1: { axis: 'abc' }, throttle2: null, roll: { axis: 1e9 } }, buttons: [null, 5] } },
    { [QUAD_ID]: { profile: 'no-such-profile', axes: 7, buttons: { 0: 'no-such-action', 1: '@master2' } } },
    { [STICK_ID]: { axes: { roll: { axis: 0, min: 1, max: -1, deadzone: 'lots' } } } },
  ];
  for (const [n, devices] of bad.entries()) {
    store.set(K.STORAGE_KEY, JSON.stringify({ v: 1, devices }));
    quad.axes[0] = quad.axes[1] = lever(0.7);
    stick.axes[0] = 0.5;
    let threw = null;
    let st = null;
    try {
      const C = new K.Controllers({ getPads: () => [stick, quad], storage, dispatch: () => true });
      st = C.poll();
      C.assignAxis(STICK_ID, 'pitch', 1);
      C.bindButton(QUAD_ID, 3, 'gear');
      C.setAxisOption(STICK_ID, 'roll', 'invert', true);
      C.setDetentHere(QUAD_ID, 'throttle1', 'cl');
      st = C.poll();
    } catch (e) {
      threw = e.message;
    }
    const finite = st && [st.throttle, st.split, st.roll, st.pitch].every((v) => v === null || Number.isFinite(v));
    ok(`corrupted saved settings #${n + 1}: no throw, no NaN on the controls`, !threw && finite, threw || JSON.stringify(st && [st.throttle, st.split, st.roll]));
  }
  store.set(K.STORAGE_KEY, JSON.stringify({ v: 1, devices: { [QUAD_ID]: { profile: 'no-such-profile' } } }));
  const C = new K.Controllers({ getPads: () => [quad], storage, dispatch: () => true });
  C.poll();
  ok('...an unknown saved profile falls back to the built-in one', C.devices[0].cfg.profile.id === 'tca-quadrant');
  store.delete(K.STORAGE_KEY);
}

/* ---------------- 9. Input ---------------- */

const dom = { addEventListener() {}, removeEventListener() {}, requestPointerLock() {} };
let PADS = [];
Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => PADS }, configurable: true, writable: true });
const run = (inp, s, opts = { simple: false }) => {
  const n = Math.round(s * 60);
  let out;
  for (let i = 0; i < n; i++) {
    out = inp.update(1 / 60, opts);
    inp.endFrame();
  }
  return out;
};

{
  // The standard pad, exactly the old behaviour (the old code, worked by hand).
  const x = pad(0, XBOX_ID, 4, 17, 'standard');
  PADS = [x];
  store.delete(K.STORAGE_KEY);
  const inp = new I.Input(dom);
  x.axes[0] = 0.5;
  x.axes[1] = -0.6; // stick pushed up: a gamepad's nose UP, as it always was
  x.axes[2] = 0.3;
  let out = run(inp, 2);
  ok('Xbox pad: roll settles on the stick', near(out.roll, 0.5, 0.01), out.roll);
  ok('Xbox pad: pushed up is nose up, exactly as before', near(out.pitch, 0.6, 0.01), out.pitch);
  ok('Xbox pad: right stick X is the rudder (axis 2), as before', near(out.yaw, 0.3, 0.01), out.yaw);
  x.axes[0] = 0.08; // inside the old 0.12 deadzone
  out = run(inp, 2);
  ok('Xbox pad: the old 0.12 deadzone', out.roll === 0, out.roll);
  x.buttons[7] = { pressed: true, value: 1 };
  run(inp, 0.5);
  ok('Xbox pad: right trigger winds the throttle up (1.2 per second)', near(inp.throttleTarget, 0.6, 0.02), inp.throttleTarget);
  x.buttons[7] = { pressed: false, value: 0 };
  x.buttons[0] = { pressed: true, value: 1 };
  inp.update(1 / 60);
  const e1 = inp.padEdges && inp.padEdges.gear;
  inp.update(1 / 60);
  const e2 = inp.padEdges && inp.padEdges.gear;
  ok('Xbox pad: A is the gear, once per press', e1 === true && e2 === false);
  x.buttons[1] = { pressed: true, value: 1 };
  out = run(inp, 0.5);
  ok('Xbox pad: B holds the brakes', out.brakes > 0.9 && out.brakeL === null, out.brakes);
  ok('gamepad() is the Xbox pad (the van reads it)', inp.gamepad() === x);
  inp.dispose();
}

{
  // The bug this was built for: a TCA quadrant alone used to be read as an
  // Xbox pad — its axis 2 the rudder, its axis 1 the pitch.
  const { quad } = cockpit();
  PADS = [quad];
  store.delete(K.STORAGE_KEY);
  const inp = new I.Input(dom);
  run(inp, 0.2);
  quad.axes[0] = quad.axes[1] = lever(1);
  const out = run(inp, 1);
  ok('TCA quadrant alone: no pitch, no roll, no yaw from its levers', out.pitch === 0 && out.roll === 0 && out.yaw === 0, JSON.stringify([out.pitch, out.roll, out.yaw]));
  ok('...it is not a "gamepad" for the van either', inp.gamepad() === null);
  ok('...its levers are the throttle: TOGA after they move', near(inp.throttleTarget, 1, 0.001), inp.throttleTarget);
  inp.dispose();
}

{
  const { stick, quad, pedals } = cockpit();
  PADS = [stick, quad, pedals];
  store.delete(K.STORAGE_KEY);
  const inp = new I.Input(dom);
  const keys = [];
  inp.controllers.dispatch = (a, down) => {
    keys.push(a);
    const e = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
    e.code = I.codesFor(a)[0];
    win.dispatchEvent(e);
    return true;
  };
  run(inp, 0.2);
  ok('sim gear: the spawn throttle is left alone until a lever moves', inp.throttleTarget === 0 && inp._hwThr.own === false);
  inp.throttleTarget = 0.7; // a spawn in the air
  run(inp, 0.2);
  ok('...a spawn\'s power stays while the levers sit still', near(inp.throttleTarget, 0.7, 1e-9), inp.throttleTarget);
  stick.axes[0] = -0.8;
  stick.axes[1] = 0.5; // pulled back
  let out = inp.update(1 / 60);
  ok('sim stick: roll and pitch at once, no keyboard smoothing', near(out.roll, K.shapeAxis(-0.8, { deadzone: 0.04 }), 1e-9) && out.pitch > 0.45, JSON.stringify([out.roll, out.pitch]));
  pedals.axes[2] = 0.5;
  out = inp.update(1 / 60);
  ok('pedals: rudder', out.yaw > 0.45, out.yaw);
  quad.axes[0] = lever(K.AIRBUS_DETENTS.flx);
  quad.axes[1] = lever(K.AIRBUS_DETENTS.flx);
  out = run(inp, 1);
  ok('quadrant moved to FLX: the lever owns the throttle', inp._hwThr.own && near(inp.throttleTarget, K.DETENT_THRUST.FLX, 1e-9), inp.throttleTarget);
  ok('...and the throttle follows it', near(out.throttle, K.DETENT_THRUST.FLX, 0.01), out.throttle);
  quad.axes[1] = lever(1);
  out = run(inp, 0.3);
  ok('lever 2 to TOGA: thrust split +', out.thrustSplit > 0.04, out.thrustSplit);
  pedals.axes[1] = 1; // right toe brake
  out = run(inp, 0.5);
  ok('right toe brake: brakeR, not brakeL', out.brakeR > 0.95 && out.brakeL < 0.05 && out.brakes > 0.95, JSON.stringify([out.brakeL, out.brakeR]));
  pedals.axes[1] = -1;
  // A key takes the throttle back.
  const shift = new Event('keydown');
  shift.code = 'ShiftLeft';
  win.dispatchEvent(shift);
  inp.update(1 / 60);
  const up = new Event('keyup');
  up.code = 'ShiftLeft';
  win.dispatchEvent(up);
  ok('Shift on the keyboard: the lever lets go', inp._hwThr.own === false);
  const before = inp.throttleTarget;
  run(inp, 0.3);
  ok('...and the throttle stays where the key left it', near(inp.throttleTarget, before, 1e-9), `${before} → ${inp.throttleTarget}`);
  quad.axes[0] = quad.axes[1] = lever(K.AIRBUS_DETENTS.cl);
  run(inp, 0.3);
  ok('...until a lever moves again (CL)', inp._hwThr.own && near(inp.throttleTarget, K.DETENT_THRUST.CL, 1e-9), inp.throttleTarget);
  quad.axes[0] = quad.axes[1] = lever(0);
  run(inp, 0.2);
  ok('both levers to full reverse: hw.reverse 1, throttle 0', inp.hw.reverse === 1 && inp.throttleTarget === 0, JSON.stringify([inp.hw.reverse, inp.throttleTarget]));
  // A bound button presses its action's key.
  stick.buttons[4].pressed = true; // gear
  inp.update(1 / 60);
  ok('stick button 5 (index 4): the gear key, pressed this frame', inp.pressed('gear') && keys.includes('gear'), keys.join());
  inp.endFrame();
  stick.buttons[4].pressed = false;
  inp.update(1 / 60);
  ok('...and released', !inp.held('gear'));
  // Off in Settings means off.
  inp.gamepadEnabled = false;
  stick.axes[0] = 1;
  out = run(inp, 0.5);
  ok('"Use a gamepad" off: sim gear is not read either', inp.hw === null && Math.abs(out.roll) < 0.02, JSON.stringify([inp.hw, out.roll]));
  inp.dispose();
}

{
  // Keyboard flying is untouched with sim gear plugged in and at rest.
  const { stick, quad, pedals } = cockpit();
  PADS = [stick, quad, pedals];
  const inp = new I.Input(dom);
  const kd = new Event('keydown');
  kd.code = 'KeyD';
  win.dispatchEvent(kd);
  const out = run(inp, 1);
  ok('keyboard roll still works beside sim gear at rest', out.roll > 0.9, out.roll);
  inp.dispose();
  PADS = [];
}

{
  // Unplugged mid-flight with the stick hard over, a toe brake in and a bound button held: nothing stays stuck.
  const { stick, quad, pedals } = cockpit();
  PADS = [stick, quad, pedals];
  store.delete(K.STORAGE_KEY);
  const inp = new I.Input(dom);
  inp.controllers.dispatch = (a, down) => {
    const e = new Event(down ? 'keydown' : 'keyup', { cancelable: true });
    e.code = I.codesFor(a)[0];
    win.dispatchEvent(e);
    return true;
  };
  run(inp, 0.2);
  stick.axes[0] = 1;
  pedals.axes[1] = lever(1);
  stick.buttons[4] = { pressed: true, value: 1 }; // gear
  let out = run(inp, 0.5);
  const before = [out.roll, out.brakeR, inp.held('gear')];
  PADS = [];
  out = run(inp, 1);
  ok('unplugged mid-flight: roll back to centre, brakes off, the button\'s key up', before[0] > 0.9 && before[1] > 0.9 && before[2] === true
    && out.roll === 0 && out.brakeL === null && out.brakes < 0.01 && !inp.held('gear') && inp.hw === null,
  JSON.stringify({ before, roll: out.roll, brakes: out.brakes, gear: inp.held('gear') }));
  // Plugged back in, still hard over: the stick reads again at once.
  PADS = [stick, quad, pedals];
  out = run(inp, 0.3);
  ok('...plugged back in: read again', out.roll > 0.9 && out.brakeR > 0.9, JSON.stringify([out.roll, out.brakeR]));
  // "Use game controllers" off with the button held: its key comes up.
  stick.buttons[4] = { pressed: false, value: 0 };
  run(inp, 0.1);
  stick.buttons[4] = { pressed: true, value: 1 };
  run(inp, 0.1);
  const held = inp.held('gear');
  inp.gamepadEnabled = false;
  run(inp, 0.1);
  ok('"Use game controllers" switched off with a button held: its key comes up', held && !inp.held('gear'));
  inp.dispose();
  PADS = [];
}

{
  // A phone or a tablet: no Gamepad API at all, or one that throws.
  const was = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
  let threw = null;
  let out;
  try {
    const inp = new I.Input(dom);
    out = run(inp, 0.5);
    ok('no Gamepad API (a phone): no controllers, the old outputs', inp.hw === null && inp.gamepad() === null && out.brakeL === null && out.roll === 0);
    inp.dispose();
    Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => { throw new Error('blocked'); } }, configurable: true, writable: true });
    const inp2 = new I.Input(dom);
    out = run(inp2, 0.5);
    inp2.dispose();
  } catch (e) {
    threw = e.message;
  }
  ok('...a Gamepad API that throws (a permissions policy) is harmless too', !threw, threw);
  Object.defineProperty(globalThis, 'navigator', { value: was, configurable: true, writable: true });
}

/* ---------------- report ---------------- */

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `\n      ${r.detail}` : ''}`);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

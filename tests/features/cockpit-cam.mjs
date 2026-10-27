/**
 * Node checks for the cockpit camera (flight/camera.js THE NATURAL HEAD,
 * features/cockpit-cam.js, the hat in flight/controllers.js and input.js):
 *
 *   node tests/features/cockpit-cam.mjs [--verbose]
 *
 *   THE HEAD     in a steady rate-one turn the view looks into it (right turn,
 *                right) by about 5 degrees and never more than 10; it leans a
 *                little towards the horizon in a bank; straight and level it
 *                looks straight ahead; all of it eased (under 1 Hz) — the
 *                real flight model in a turn, frame by frame
 *   SNAPS        left, right, back, up and the panel are eased there (no
 *                frame moves the view more than a few degrees), held, and the
 *                same key again goes back ahead
 *   ZOOM         35 to 90 degrees whatever is asked, eased, and back to the
 *                aeroplane's own on reset
 *   MEMORY       snap and zoom round-trip per aircraft, never "back"
 *   THE HAT      the eight positions of a POV hat axis, the centred value
 *                found by itself (the TCA's Chrome axis 9); held, the head
 *                turns; let go, it comes back
 *   KEYS         the numpad snaps and zoom are in the registry (View group),
 *                clash with nothing, and have a touch way (drag, pinch)
 *
 * Exits non-zero if anything fails.
 */

global.document = global.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
if (typeof globalThis.localStorage === 'undefined' || !globalThis.localStorage || typeof globalThis.localStorage.getItem !== 'function') {
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
}

const SRC = new URL('../../src/', import.meta.url).href;
const VERBOSE = process.argv.includes('--verbose');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (!pass || VERBOSE) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

await import(SRC + 'features/index.js');
const THREE = await import(SRC + 'vendor/three.module.js');
const PH = await import(SRC + 'aircraft/physics.js');
const CAM = await import(SRC + 'flight/camera.js');
const { Weather } = await import(SRC + 'world/weather.js');
const AP = await import(SRC + 'flight/autopilot.js');
const T = await import(SRC + 'world/terrain.js');
T.applyMap('kestrel');
const DEG = 180 / Math.PI;

/** The camera's yaw, pitch and roll relative to the aeroplane's body, degrees. */
function headAngles(cam, ac) {
  const q = ac.quat.clone().invert().multiply(cam.quaternion);
  const e = new THREE.Euler().setFromQuaternion(q, 'YXZ');
  return { yaw: e.y * DEG, pitch: e.x * DEG, roll: e.z * DEG };
}

function setup(id = 'skylark', kts = 110) {
  PH.applyAircraft(id);
  const ac = new PH.Aircraft();
  ac.mode = 'simplified';
  ac.reset({ pos: new THREE.Vector3(0, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: kts / 1.94384, altAGL: 1200 });
  ac.pos.y = 1200;
  const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 60000);
  const rig = new CAM.CameraRig(camera, ac);
  rig.setMode('cockpit');
  const w = new Weather();
  w.windSpeedKts = 0;
  return { ac, rig, camera, w };
}
const input = { lookYaw: 0, lookPitch: 0, held: () => false };

/* ---------------- the head in a turn ---------------- */
{
  const { ac, rig, camera, w } = setup();
  const ap = new AP.Autopilot();
  ap.setEngaged(true, ac);
  const dt = 1 / 60;
  const level = [];
  const turn = [];
  const steps = [];
  let prev = null;
  for (let f = 0; f < 60 * 50; f++) {
    // Straight for 10 s, then a right turn (heading +120).
    if (f === 600) ap.holdHeadingDeg = (ac.readouts().heading + 120) % 360;
    const o = ap.update(dt, ac, null);
    Object.assign(ac.controls, { pitch: o.pitch, roll: o.roll, yaw: o.yaw, throttle: o.throttle });
    const { n, h } = PH.frameSteps(dt);
    for (let i = 0; i < n; i++) ac.update(h, w);
    rig.update(dt, ac, input, w);
    const a = headAngles(camera, ac);
    const bank = ac.bankAngleDeg();
    if (f > 300 && f < 590) level.push(a);
    if (f > 900 && Math.abs(bank) > 15) turn.push({ ...a, bank });
    if (prev) steps.push(Math.hypot(a.yaw - prev.yaw, a.pitch - prev.pitch, a.roll - prev.roll));
    prev = a;
  }
  const meanLevel = level.reduce((s, a) => s + Math.abs(a.yaw), 0) / Math.max(1, level.length);
  const into = turn.length ? turn.reduce((s, a) => s + a.yaw, 0) / turn.length : 0;
  const maxInto = Math.max(...turn.map((a) => Math.abs(a.yaw)), 0);
  const tilt = turn.length ? turn.reduce((s, a) => s + a.roll, 0) / turn.length : 0;
  ok('straight and level, the head looks straight ahead', meanLevel < 0.5, `${meanLevel.toFixed(2)}°`);
  ok('in a right turn the head looks right, into it (2-8°), never more than 10°', turn.length > 60 && into < -2 && into > -8 && maxInto <= 10.01, `mean ${into.toFixed(1)}°, most ${maxInto.toFixed(1)}° over ${turn.length} frames at ${turn.length ? turn[0].bank.toFixed(0) : '-'}° bank`);
  ok('and leans a little towards the horizon (against the bank, at most 4°)', tilt > 0.5 && tilt <= 4.01, `${tilt.toFixed(2)}°`);
  const worstStep = Math.max(...steps);
  ok('none of it jumps: no frame moves the view more than 0.3° (eased, under 1 Hz)', worstStep < 0.3, `${worstStep.toFixed(3)}° in a frame`);
}

/* ---------------- snaps and zoom ---------------- */
{
  const { ac, rig, camera, w } = setup();
  const dt = 1 / 60;
  const frames = (n, fn) => {
    let worst = 0;
    let prev = headAngles(camera, ac);
    for (let i = 0; i < n; i++) {
      ac.update(dt, w);
      rig.update(dt, ac, input, w);
      const a = headAngles(camera, ac);
      worst = Math.max(worst, Math.abs(((a.yaw - prev.yaw + 540) % 360) - 180), Math.abs(a.pitch - prev.pitch));
      prev = a;
      if (fn) fn(i, a);
    }
    return { worst, a: prev };
  };
  frames(30);
  rig.snapTo('left');
  const L = frames(90);
  ok('look left: eased round to about 80° left, no frame jumping more than 6°', L.a.yaw > 70 && L.a.yaw < 90 && L.worst < 6, `${L.a.yaw.toFixed(1)}°, worst step ${L.worst.toFixed(2)}°`);
  rig.snapTo('left');
  const back = frames(90);
  ok('the same key again goes back ahead', rig.snap === 'front' && Math.abs(back.a.yaw) < 3, `${rig.snap} ${back.a.yaw.toFixed(1)}°`);
  rig.snapTo('panel');
  const P = frames(90);
  rig.snapTo('up');
  const U = frames(90);
  rig.snapTo('back');
  const B = frames(120);
  ok('the panel is below, up is above, back is over the shoulder', P.a.pitch < -20 && U.a.pitch > 20 && Math.abs(B.a.yaw) > 140, `panel ${P.a.pitch.toFixed(0)}°, up ${U.a.pitch.toFixed(0)}°, back ${B.a.yaw.toFixed(0)}°`);
  rig.resetLook();
  frames(60);
  const own = camera.fov;
  for (let i = 0; i < 40; i++) rig.zoomBy(1.3);
  frames(90);
  const tight = camera.fov;
  for (let i = 0; i < 40; i++) rig.zoomBy(1 / 1.3);
  frames(90);
  const wide = camera.fov;
  rig.resetLook();
  frames(120);
  ok('zoom: never under 35° nor over 90°, eased there, and back to the aeroplane\'s own on reset', Math.abs(tight - CAM.ZOOM_MIN) < 0.5 && Math.abs(wide - CAM.ZOOM_MAX) < 0.5 && Math.abs(camera.fov - own) < 1,
    `${own.toFixed(1)} → ${tight.toFixed(1)} → ${wide.toFixed(1)} → ${camera.fov.toFixed(1)}`);
  rig.lookState = { snap: 'panel', zoomFov: 50 };
  const st = rig.lookState;
  rig.lookState = { snap: 'nonsense', zoomFov: 500 };
  ok('a look round-trips (and nonsense is put straight)', st.snap === 'panel' && st.zoomFov === 50 && rig.snap === 'front' && rig.zoomFov === CAM.ZOOM_MAX, JSON.stringify([st, rig.lookState]));
}

/* ---------------- memory ---------------- */
const CC = await import(SRC + 'features/cockpit-cam.js');
ok('remembered per aircraft: the snap and the zoom, but never "back"', JSON.stringify(CC.rememberable({ snap: 'back', zoomFov: 44.4 })) === '{"snap":"front","zoomFov":44}' && CC.rememberable({ snap: 'panel', zoomFov: null }).snap === 'panel',
  JSON.stringify(CC.rememberable({ snap: 'back', zoomFov: 44.4 })));

/* ---------------- the hat ---------------- */
const CTL = await import(SRC + 'flight/controllers.js');
{
  const pos = [-1, -5 / 7, -3 / 7, -1 / 7, 1 / 7, 3 / 7, 5 / 7, 1].map((v) => CTL.hatDir(v));
  const words = pos.map((p) => `${p.x > 0 ? 'R' : p.x < 0 ? 'L' : ''}${p.y > 0 ? 'U' : p.y < 0 ? 'D' : ''}`).join(' ');
  ok('a POV hat axis: up, up-right, right … up-left, clockwise from -1', words === 'U RU R RD D LD L LU', words);
  const c = new CTL.Controllers({ getGamepads: () => [], storage: null });
  const dev = { key: 'k', axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9 / 7], cfg: { mode: 'mapped' } };
  const centred = c._hatOf(dev);
  dev.axes[9] = -3 / 7;
  const right = c._hatOf(dev);
  ok('the hat is found by its centred value (Chrome\'s axis 9 on the TCA sidestick), no profile needed', centred && centred.x === 0 && centred.y === 0 && right && right.x === 1 && right.y === 0, JSON.stringify([centred, right]));
}
{
  const I = await import(SRC + 'flight/input.js');
  const src = (await import('node:fs')).readFileSync(new URL('flight/input.js', SRC), 'utf8');
  ok('input.js: a held hat turns the head (free look or not) and lets it come back when let go', /const hat = this\.hw && this\.hw\.hat;/.test(src) && /\|\| hatOn\) \{/.test(src) && /this\.lookYaw = clamp\(this\.lookYaw - hat\.x/.test(src), '');
  const A = I.ACTIONS;
  const ids = ['camLookLeft', 'camLookRight', 'camLookBack', 'camLookUp', 'camLookPanel', 'camLookFront', 'camZoomIn', 'camZoomOut'];
  ok('the snap and zoom keys are in the registry (View), on the numpad, clashing with nothing', ids.every((id) => A[id] && A[id].group === 'View' && /^Numpad/.test(A[id].default[0])) && !Object.keys(I.findConflicts(I.defaultBindings())).length,
    ids.map((id) => `${id} ${A[id] && A[id].default}`).join(', '));
  const TC = (await import(SRC + 'ui/touch-coverage.js')).TOUCH_COVERAGE;
  ok('each has a touch way: a finger drags the view, two pinch to zoom', ids.every((id) => TC[id] && TC[id].via === 'drag'), '');
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);

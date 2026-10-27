/**
 * Browser check for the cockpit camera (flight/camera.js, features/cockpit-cam.js):
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/cockpit-cam.browser.js check "" 1
 *
 *   - in the cockpit, numpad 4 looks left (eased, not a cut), 4 again ahead
 *   - the mouse wheel zooms (35-90°), numpad 5 puts the zoom back
 *   - a TCA sidestick's hat (Chrome's axis 9, a fake gamepad): held right,
 *     the head turns right; let go, it comes back — and the stick still flies
 *   - the look is remembered for this aircraft: a new flight in it starts
 *     with the same snap and zoom
 * The view, the player's controller setup and Free Flight are put back.
 */

export const id = 'cockpit-cam';

export async function check(sim, r, say) {
  say && say('cockpit-cam: snaps, zoom, the hat, memory');
  const wasAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const run = (s) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) sim.step(1 / 60);
  };
  const tap = (code) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
  };
  const rig = sim.rig;
  const view0 = rig.mode;
  const hadOwn = Object.prototype.hasOwnProperty.call(navigator, 'getGamepads');
  const realGet = navigator.getGamepads;
  let K;
  let savedCtl = null;
  try {
    K = await import('../../src/flight/controllers.js');
    savedCtl = localStorage.getItem(K.STORAGE_KEY);
  } catch (e) {
    /* storage blocked */
  }
  const yawOf = () => {
    const ac = sim.aircraft;
    const q = ac.quat.clone().invert().multiply(sim.camera.quaternion);
    const e = new sim.camera.rotation.constructor().setFromQuaternion(q, 'YXZ');
    return (e.y * 180) / Math.PI;
  };
  try {
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    rig.setMode('cockpit');
    sim.cockpitCam.reset();
    run(1);
    const y0 = yawOf();
    tap('Numpad4');
    run(1 / 60);
    const y1 = yawOf();
    run(1.2);
    const y2 = yawOf();
    r.ok('cockpit-cam: numpad 4 looks left, eased round (not a cut) to about 80°', y1 - y0 < 15 && y2 > 65, `${y0.toFixed(1)} → ${y1.toFixed(1)} after a frame → ${y2.toFixed(1)}°`);
    tap('Numpad4');
    run(1.2);
    r.ok('cockpit-cam: numpad 4 again looks ahead', Math.abs(yawOf()) < 4 && rig.snap === 'front', `${yawOf().toFixed(1)}°`);

    const cv = sim.renderer.domElement;
    const f0 = sim.camera.fov;
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -600, bubbles: true, cancelable: true }));
    run(1);
    const f1 = sim.camera.fov;
    for (let i = 0; i < 10; i++) cv.dispatchEvent(new WheelEvent('wheel', { deltaY: 900, bubbles: true, cancelable: true }));
    run(1.2);
    const f2 = sim.camera.fov;
    r.ok('cockpit-cam: the wheel zooms in, and out no further than 90°', f1 < f0 - 8 && f2 <= 90.5 && f2 > 85, `${f0.toFixed(1)} → ${f1.toFixed(1)} → ${f2.toFixed(1)}°`);
    tap('Numpad5');
    run(1.5);
    r.ok('cockpit-cam: numpad 5 puts the zoom back to the aeroplane\'s own', Math.abs(sim.camera.fov - f0) < 2 && rig.zoomFov === null, `${sim.camera.fov.toFixed(1)}°`);

    /* ---- the hat ---- */
    const btns = (n) => Array.from({ length: n }, () => ({ pressed: false, value: 0, touched: false }));
    const stick = { index: 0, id: 'Thrustmaster TCA Sidestick Airbus (Vendor: 044f Product: 0405)', mapping: '', connected: true, axes: new Array(10).fill(0), buttons: btns(16), timestamp: 0 };
    stick.axes[6] = 1; // the base lever aft (Chrome's slider index), idle
    stick.axes[9] = 9 / 7; // the hat, centred
    Object.defineProperty(navigator, 'getGamepads', { value: () => [stick], configurable: true, writable: true });
    try {
      localStorage.removeItem(K.STORAGE_KEY);
    } catch (e) {
      /* fine */
    }
    if (sim.input.controllers && sim.input.controllers.load) sim.input.controllers.load();
    run(0.5);
    const h0 = yawOf();
    stick.axes[9] = -3 / 7; // right
    run(0.8);
    const h1 = yawOf();
    stick.axes[1] = 0.6; // and the stick back a little at the same time (HID: down the axis is aft)
    run(0.3);
    const pitchUp = sim.aircraft.controls.pitch;
    stick.axes[1] = 0;
    stick.axes[9] = 9 / 7; // let go
    run(2.5);
    const h2 = yawOf();
    r.ok('cockpit-cam: the sidestick\'s hat, held right, turns the head right; let go, it comes back; the stick still flies meanwhile',
      h1 < h0 - 20 && Math.abs(h2 - h0) < 6 && Math.abs(pitchUp) > 0.2, `${h0.toFixed(1)} → ${h1.toFixed(1)} → ${h2.toFixed(1)}°, elevator ${pitchUp.toFixed(2)}`);
    Object.defineProperty(navigator, 'getGamepads', { value: () => [], configurable: true, writable: true });
    run(0.2);

    /* ---- memory ---- */
    tap('Numpad2');
    sim.cockpitCam.zoom(1.4);
    run(1);
    const want = sim.cockpitCam.state();
    rig.resetLook();
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    run(0.2);
    const got = sim.cockpitCam.state();
    r.ok('cockpit-cam: the look is remembered for this aircraft (the panel, the zoom) and put back next flight', got.snap === 'panel' && want.snap === 'panel' && Math.abs(got.zoomFov - want.zoomFov) < 1, `${JSON.stringify(want)} → ${JSON.stringify(got)}`);
    sim.cockpitCam.reset();
    run(0.6);
  } catch (err) {
    r.ok('cockpit-cam: the check ran to the end', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    if (hadOwn) Object.defineProperty(navigator, 'getGamepads', { value: realGet, configurable: true, writable: true });
    else delete navigator.getGamepads;
    try {
      if (K) {
        if (savedCtl === null) localStorage.removeItem(K.STORAGE_KEY);
        else localStorage.setItem(K.STORAGE_KEY, savedCtl);
      }
      if (sim.input.controllers && sim.input.controllers.load) sim.input.controllers.load();
    } catch (e) {
      /* fine */
    }
    if (sim.cockpitCam) sim.cockpitCam.reset();
    rig.setMode(view0);
    sim.autoPauseOnHide = wasAutoPause;
  }
}

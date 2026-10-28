/**
 * Browser check for the Tomm1z video pass, item 4 — HARDWARE THROTTLE +
 * ENGINE START SAFETY (.claude/devtools/briefs/tomm1z-video.md: 1:35 the
 * Skylark rolled off its stand on engine start; 3:20 "why is my power only
 * at 50%?"), in the real game: a fake TCA quadrant whose levers were moved
 * end to end and left at CL (as the connect-time card asks); the engine
 * start takes idle, not climb power, the HUD says to move the lever to idle,
 * the aeroplane stays on its stand with the parking brake held, and
 * idle-then-forward hands the lever the power. And the helicopter: I on the
 * pad with the rotor running does not shut it down on one press ("wasn't the
 * engine already started?").
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/tomm1z-throttle.browser.js check "" 1
 */

export const id = 'tomm1z-throttle';

const toasts = () => [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ');

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`tomm1z-throttle: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const hadOwn = Object.prototype.hasOwnProperty.call(navigator, 'getGamepads');
  const realGet = navigator.getGamepads;
  const K = await import('../../src/flight/controllers.js');
  const C = sim.input.controllers;
  const savedStore = (() => {
    try {
      return localStorage.getItem(K.STORAGE_KEY);
    } catch (e) {
      return null;
    }
  })();
  let PADS = [];
  try {
    say('tomm1z-throttle: a quadrant lever at climb power on an engine start');
    const btns = (n) => Array.from({ length: n }, () => ({ pressed: false, value: 0, touched: false }));
    const mk = (index, id, nA, nB, mapping = '') => ({ index, id, mapping, connected: true, axes: new Array(nA).fill(0), buttons: btns(nB), timestamp: 0 });
    const quad = mk(1, 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', 4, 12);
    const lever = (t) => t * 2 - 1;
    const D = K.AIRBUS_DETENTS;
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    quad.axes[2] = quad.axes[3] = -1;
    try {
      localStorage.removeItem(K.STORAGE_KEY);
    } catch (e) {
      void e;
    }
    C.load();
    PADS = [quad];
    Object.defineProperty(navigator, 'getGamepads', { value: () => PADS, configurable: true, writable: true });
    await sim.startMode('free', { aircraft: 'skylark', startAt: 'stand', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac = sim.aircraft;
    if (ac.engineOn) ac.stopEngine('shutdown');
    sim.step(0.5);
    // The levers are moved end to end (the connect-time card asks for it) and left at CL.
    quad.axes[0] = quad.axes[1] = lever(1);
    sim.step(0.3);
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    sim.step(0.3);
    quad.axes[0] = quad.axes[1] = lever(D.cl);
    sim.step(0.5);
    ok('the levers own the throttle at CL before the start (engine off)', sim.input._hwThr.own && sim.input.throttleTarget > 0.8, `own=${sim.input._hwThr.own} ${sim.input.throttleTarget.toFixed(2)}`);
    ok('...and the parking brake is still on: a lever moved with the engine off does not release it', ac.parkingBrake === true, `brake ${ac.parkingBrake}`);
    const pos0 = ac.pos.clone();
    const park0 = ac.parkingBrake;
    sim.tap('KeyI');
    sim.step(6);
    ok('engine started with the lever at CL: the power is idle, not climb power', ac.engineOn && ac.controls.throttle < 0.05 && sim.input.throttleTarget < 0.05, `engineOn ${ac.engineOn} throttle ${ac.controls.throttle.toFixed(2)} target ${sim.input.throttleTarget.toFixed(2)}`);
    ok('...the HUD said to move the lever to idle', /throttle lever to idle/i.test(toasts()), toasts().slice(-200));
    const moved = pos0.distanceTo(ac.pos);
    ok('...and the aeroplane stays on its stand with the parking brake held', moved < 0.5 && ac.parkingBrake === true, `moved ${moved.toFixed(2)} m, brake ${park0} → ${ac.parkingBrake}`);
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    sim.step(0.5);
    quad.axes[0] = quad.axes[1] = lever(D.cl);
    sim.step(1);
    ok('to idle and forward again: the lever has the power', sim.input._hwThr.own && ac.controls.throttle > 0.7, ac.controls.throttle.toFixed(2));
    // One lever only, in a single: full power.
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    sim.step(0.5);
    quad.axes[0] = lever(1);
    sim.step(1);
    ok('one lever to TOGA in the Skylark is 100% (it was the average: 50%)', ac.controls.throttle > 0.95, ac.controls.throttle.toFixed(2));

    say('tomm1z-throttle: I in a running helicopter');
    PADS = [];
    await sim.startMode('free', { aircraft: 'h145', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
    sim.step(0.5);
    const h = sim.aircraft;
    ok('the helicopter starts on its pad with the engine running', h.engineOn === true);
    sim.tap('KeyI');
    sim.step(0.5);
    ok('one press of I does not shut it down; it says it is already running', h.engineOn === true && /already running/i.test(toasts()), `engineOn ${h.engineOn} — ${toasts().slice(-160)}`);
    sim.tap('KeyI');
    sim.step(0.5);
    ok('...a second press within 3 s does', h.engineOn === false);
  } finally {
    if (hadOwn) Object.defineProperty(navigator, 'getGamepads', { value: realGet, configurable: true, writable: true });
    else delete navigator.getGamepads;
    try {
      if (savedStore === null) localStorage.removeItem(K.STORAGE_KEY);
      else localStorage.setItem(K.STORAGE_KEY, savedStore);
      C.load();
    } catch (e) {
      void e;
    }
    sim.autoPauseOnHide = autoPause;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      void e;
    }
  }
}

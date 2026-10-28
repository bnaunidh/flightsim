/**
 * Node checks for the Tomm1z video pass, item 4 — HARDWARE THROTTLE + ENGINE
 * START SAFETY (.claude/devtools/briefs/tomm1z-video.md: 1:35 the Skylark
 * rolled off its stand on engine start; 3:20 "why is my power only at 50%?").
 *
 *   node tests/features/tomm1z-throttle.mjs
 *
 * A single takes the further-forward of a quadrant's two levers (one lever
 * at TOGA is 100%, not 50%; a twin keeps the average and the split); a lever
 * that has not synced — at idle, or passing through the power set now — does
 * not take over, and says it is waiting; a key on the power makes it sync
 * again, so the keyboard and the lever never fight; pedals that rest off
 * centre have that rest as their centre. The engine start itself (the lever
 * at CL, the parking brake, the hint): tests/features/tomm1z-throttle.browser.js.
 */
import { win, load, near, ok, report } from './tomm1z-common.mjs';
void win;
void near;

/* ---------------- 4. the hardware throttle ---------------- */
{
  await load('src/features/index.js');
  const I = await load('src/flight/input.js');
  const K = await load('src/flight/controllers.js');
  const btns = (n) => Array.from({ length: n }, () => ({ pressed: false, value: 0 }));
  const pad = (index, id, nAxes, nButtons, mapping = '') => ({ index, id, mapping, connected: true, axes: new Array(nAxes).fill(0), buttons: btns(nButtons), timestamp: 0 });
  const QUAD_ID = 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)';
  const PEDAL_ID = 'T-Rudder (Vendor: 044f Product: b679)';
  const lever = (t) => t * 2 - 1;
  const D = K.AIRBUS_DETENTS;
  const dom = { addEventListener() {}, removeEventListener() {}, requestPointerLock() {} };
  let PADS = [];
  const was = globalThis.navigator;
  Object.defineProperty(globalThis, 'navigator', { value: { getGamepads: () => PADS }, configurable: true, writable: true });
  const run = (inp, s) => {
    const n = Math.round(s * 60);
    let out;
    for (let i = 0; i < n; i++) {
      out = inp.update(1 / 60, { simple: false });
      inp.endFrame();
    }
    return out;
  };
  const store = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
  });

  // Controllers.poll: the further-forward lever is reported beside the average.
  {
    const quad = pad(1, QUAD_ID, 2, 8);
    quad.axes[0] = lever(1);
    quad.axes[1] = lever(D.idle);
    const C = new K.Controllers({ getPads: () => [quad], storage: null, dispatch: () => true });
    const st = C.poll(1 / 60);
    ok('poll(): one lever at TOGA and one at idle — the average is 0.5, the further-forward lever 1', near(st.throttle, 0.5) && near(st.throttleMax, 1) && st.levers === 2, JSON.stringify([st.throttle, st.throttleMax, st.levers]));
  }

  // Input: a single takes the further-forward lever; a twin the average.
  for (const [engines, want] of [[1, 1], [2, 0.5]]) {
    const quad = pad(1, QUAD_ID, 2, 8);
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    PADS = [quad];
    store.delete(K.STORAGE_KEY);
    const inp = new I.Input(dom);
    inp.engineCount = engines;
    run(inp, 0.3);
    quad.axes[0] = lever(1); // one lever to the stop, the other left at idle
    run(inp, 1);
    ok(`${engines === 1 ? 'a single (the Skylark)' : 'a twin'}: one lever to TOGA, the other at idle → power ${want * 100}%`, near(inp.throttleTarget, want, 0.01), inp.throttleTarget);
    inp.dispose();
  }

  // The sync gate: a lever away from idle does not take over until it comes to idle.
  {
    const quad = pad(1, QUAD_ID, 2, 8);
    quad.axes[0] = quad.axes[1] = lever(D.cl); // sitting at CL when the game first sees it
    PADS = [quad];
    store.delete(K.STORAGE_KEY);
    const inp = new I.Input(dom);
    inp.engineCount = 2;
    run(inp, 0.3);
    ok('levers found at CL: the power stays at 0, the lever does not own it', inp.throttleTarget === 0 && !inp._hwThr.own);
    quad.axes[0] = quad.axes[1] = lever(D.flx);
    run(inp, 0.3);
    ok('...pushed on to FLX: still 0, and the lever is "waiting" (the HUD says to move it to idle)', inp.throttleTarget === 0 && !inp._hwThr.own && inp.hwLeverWaiting === true, `${inp.throttleTarget} own=${inp._hwThr.own} waiting=${inp.hwLeverWaiting}`);
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    run(inp, 0.3);
    ok('...pulled to idle: synced, no longer waiting', inp._hwThr.armed === true && inp.hwLeverWaiting === false && inp.throttleTarget === 0);
    quad.axes[0] = quad.axes[1] = lever(1);
    run(inp, 0.5);
    ok('...and from idle to TOGA it owns the power: 100%', inp._hwThr.own && near(inp.throttleTarget, 1, 0.01), inp.throttleTarget);

    // A key on the power: the lever lets go and must sync again — no fight.
    inp.keys.add('ControlLeft');
    run(inp, 1);
    inp.keys.delete('ControlLeft');
    const afterKey = inp.throttleTarget;
    ok('Ctrl held a second: the key has the power (≈ 38%), the lever let go', !inp._hwThr.own && afterKey > 0.3 && afterKey < 0.45, afterKey);
    quad.axes[0] = quad.axes[1] = lever(0.93); // a wobble on the lever, still far from the power set
    run(inp, 0.5);
    ok('...a lever wobble of 7% does not snatch it back (it used to)', !inp._hwThr.own && near(inp.throttleTarget, afterKey, 1e-9), `${inp.throttleTarget} own=${inp._hwThr.own}`);
    // Sweep the lever down through the power set now (airbusThrust: idle+band … CL maps 0 … 0.88).
    for (let t = 0.93; t >= D.idle; t -= 0.01) {
      quad.axes[0] = quad.axes[1] = lever(t);
      run(inp, 0.05);
    }
    ok('...sweeping it down through that power picks the throttle up again, now at idle', inp._hwThr.own && inp.throttleTarget < 0.02, `${inp.throttleTarget} own=${inp._hwThr.own}`);
    inp.releaseHardwareLevers();
    ok('releaseHardwareLevers() (a new flight, an engine start) makes it sync again', !inp._hwThr.own && !inp._hwThr.armed);
    inp.dispose();
  }

  // Pedals that rest off centre.
  {
    const pedals = pad(2, PEDAL_ID, 3, 0);
    pedals.axes[0] = pedals.axes[1] = -1;
    pedals.axes[2] = -0.12; // the rudder axis rests 12% left
    PADS = [pedals];
    store.delete(K.STORAGE_KEY);
    const inp = new I.Input(dom);
    let out = run(inp, 0.5);
    const early = out.yaw;
    out = run(inp, 2);
    ok('pedals resting 12% off centre: within two seconds that is the centre — no rudder', out.yaw === 0, `before ${early.toFixed(3)} after ${out.yaw.toFixed(3)}`);
    ok('...the learned rest is readable', near(inp.controllers.restOf(PEDAL_ID, 2), -0.12, 1e-9), inp.controllers.restOf(PEDAL_ID, 2));
    pedals.axes[2] = 0.6;
    out = run(inp, 0.5);
    ok('...and a real pedal press still steers', out.yaw > 0.4, out.yaw.toFixed(3));
    pedals.axes[2] = -0.6; // held well off centre for a while: a hand on it, not a new rest
    out = run(inp, 2.5);
    ok('...held 60% left for 2.5 s is a hand on it, not a rest (still steers left)', out.yaw < -0.4 && near(inp.controllers.restOf(PEDAL_ID, 2), -0.12, 1e-9), out.yaw.toFixed(3));
    inp.dispose();
  }
  Object.defineProperty(globalThis, 'navigator', { value: was, configurable: true, writable: true });
}


report();

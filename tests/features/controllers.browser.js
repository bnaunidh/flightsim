/**
 * Browser check for real sim gear (src/flight/controllers.js,
 * src/ui/controllers-panel.js, src/features/controllers-hud.js).
 *
 * A fake navigator.getGamepads() with three devices, the way the browser
 * hands over an A320 home cockpit — a TCA Sidestick Airbus, a TCA Quadrant
 * Airbus with the flaps / speedbrake add-on, Thrustmaster pedals — each with
 * its own axes in its own order:
 *
 *   - connecting: "… connected — … profile loaded" and the MOVE EACH LEVER
 *     card, ticked as each lever goes end to end;
 *   - the A320 on the runway: the thrust levers to TOGA roll it, the
 *     detent word shows, back to IDLE and through into reverse brings the
 *     reversers out (MAX), forward again stows them;
 *   - the toe brakes: the right pedal alone turns it right, the left alone
 *     left;
 *   - in the air: the stick rolls and pitches it (pushed forward = nose
 *     down), the pedals yaw it, split levers yaw it towards the slow engine;
 *     the flap lever sets the flaps, the speedbrake lever the speedbrake;
 *   - engine masters: both OFF stops the engines, one ON starts them;
 *   - a button bound to the gear puts the gear down;
 *   - Settings → Controls → Controllers: the three devices by name with
 *     their profiles; Assign + move a lever puts flaps on it; "Press the
 *     button" binds a button; Reset to defaults puts the profile back;
 *     the "press any button" hint with nothing connected;
 *   - an Xbox pad beside them all still flies the old way (A = gear).
 *
 * The player's own controller setup and the real getGamepads are put back
 * at the end, whatever happens.
 */

export const id = 'controllers';

export async function check(sim, r, say) {
  say && say('controllers: a fake A320 home cockpit');
  let K;
  let H;
  let P;
  try {
    K = await import('../../src/flight/controllers.js');
    H = await import('../../src/features/controllers-hud.js');
    P = await import('../../src/ui/controllers-panel.js');
  } catch (err) {
    r.ok('controllers: modules load', false, String(err && err.message));
    return;
  }
  const ok = (name, pass, detail = '') => r.ok(`controllers: ${name}`, !!pass, `${name}${detail !== '' ? ` — ${detail}` : ''}`);
  const C = sim.input.controllers;
  const savedStore = (() => {
    try {
      return localStorage.getItem(K.STORAGE_KEY);
    } catch (e) {
      return null;
    }
  })();
  const hadOwn = Object.prototype.hasOwnProperty.call(navigator, 'getGamepads');
  const realGet = navigator.getGamepads;
  const wasAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;

  const btns = (n) => Array.from({ length: n }, () => ({ pressed: false, value: 0, touched: false }));
  const mk = (index, id, nA, nB, mapping = '') => ({ index, id, mapping, connected: true, axes: new Array(nA).fill(0), buttons: btns(nB), timestamp: 0 });
  const stick = mk(0, 'Thrustmaster TCA Sidestick Airbus (Vendor: 044f Product: 0405)', 4, 16);
  const quad = mk(1, 'TCA Q-Eng 1&2 (Vendor: 044f Product: 0407)', 4, 12);
  const pedals = mk(2, 'T-Rudder (Vendor: 044f Product: b679)', 3, 0);
  const lever = (t) => t * 2 - 1;
  const D = K.AIRBUS_DETENTS;
  const rest = () => {
    stick.axes.fill(0);
    stick.axes[3] = 1; // the base lever aft (inverted: idle)
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    quad.axes[2] = -1; // speedbrake in
    quad.axes[3] = -1; // flaps up
    pedals.axes[0] = pedals.axes[1] = -1;
    pedals.axes[2] = 0;
  };
  rest();
  let PADS = [];
  const press = (p, i, down = true) => {
    p.buttons[i] = { pressed: down, value: down ? 1 : 0, touched: down };
  };

  const run = (s) => sim.step(s);
  try {
    localStorage.removeItem(K.STORAGE_KEY);
  } catch (e) {
    void e;
  }
  C.load();
  Object.defineProperty(navigator, 'getGamepads', { value: () => PADS, configurable: true, writable: true });

  try {
    /* ---------- the hint, before anything is connected ---------- */
    const S = sim.menus.screens.settings;
    const host = S && S.querySelector('[data-controllers]');
    ok('the Controllers panel is in Settings → Controls', !!host && !!host.querySelector('[data-ctl]'));
    const hint = host && host.querySelector('[data-ctl-hint]');
    ok('it says to press any button first', hint && /press any button/i.test(hint.textContent), hint && hint.textContent.slice(0, 90));

    /* ---------- connecting, on the runway in the A320 ---------- */
    await sim.startMode('free', { aircraft: 'a320', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac = sim.aircraft;
    run(0.5);
    PADS = [stick, quad, pedals];
    run(0.3);
    const hs = H.controllersHudState();
    const quadNote = hs.notes.find((n) => /TCA Q-Eng 1&2 connected/.test(n));
    ok('the quadrant connects with its profile', quadNote && /TCA Quadrant Airbus profile loaded/.test(quadNote), hs.notes.join(' | '));
    ok('so do the stick and the pedals', hs.notes.some((n) => /Sidestick Airbus connected — TCA Sidestick Airbus profile/.test(n)) && hs.notes.some((n) => /T-Rudder connected — Thrustmaster rudder pedals profile/.test(n)), hs.notes.join(' | '));
    const toast = [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ');
    ok('...and the notice is on the HUD', /connected — .*profile loaded/.test(toast), toast.slice(0, 160));
    ok('the MOVE EACH LEVER card is up', hs.cardShown && hs.check && hs.check.roles.length >= 3, JSON.stringify(hs.check));
    // The last device to connect owns the card: the pedals. Move each of its axes end to end.
    const checkRoles = hs.check ? hs.check.roles.slice() : [];
    for (const v of [1, -1, 0]) {
      pedals.axes[2] = v;
      pedals.axes[0] = pedals.axes[1] = v === 0 ? -1 : v;
      run(0.15);
    }
    const hs2 = H.controllersHudState();
    ok('moving each lever ticks it off, then the card goes', !hs2.check || checkRoles.every((role) => hs2.check.seen[role]), JSON.stringify(hs2.check || 'card done'));
    rest();
    run(0.2);

    /* ---------- thrust levers on the ground ---------- */
    if (!ac.engineOn) {
      ac.startEngine();
      run(2.5);
    }
    ac.parkingBrake = false;
    quad.axes[0] = quad.axes[1] = lever(1);
    run(0.8);
    ok('levers to TOGA: the throttle is full', sim.input._hwThr.own && ac.controls.throttle > 0.95, `throttle ${ac.controls.throttle.toFixed(2)}`);
    const det = [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ');
    ok('...and the HUD says TOGA', /Thrust levers: TOGA/.test(det), det.slice(-160));
    run(8);
    ok('...and she rolls', ac.groundSpeed > 8 && ac.onGround, `${ac.groundSpeed.toFixed(1)} m/s`);
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    run(0.8);
    ok('back to IDLE: thrust 0', ac.controls.throttle < 0.05 && sim.input.hw.detents.join() === 'IDLE,IDLE', `${ac.controls.throttle.toFixed(2)} ${sim.input.hw.detents}`);
    quad.axes[0] = quad.axes[1] = lever(0);
    run(0.2);
    ok('pulled through idle to the stop: MAX reverse', ac.reverse === 1, `reverse ${ac.reverse}`);
    const v0 = ac.groundSpeed;
    run(1.5);
    ok('...which slows the roll', ac.groundSpeed < v0, `${v0.toFixed(1)} → ${ac.groundSpeed.toFixed(1)} m/s`);
    quad.axes[0] = quad.axes[1] = lever(D.idle);
    run(0.2);
    ok('forward to idle: the reversers stow', ac.reverse === 0, `reverse ${ac.reverse}`);

    /* ---------- differential toe brakes ---------- */
    const turnWith = (side) => {
      ac.reverse = 0;
      quad.axes[0] = quad.axes[1] = lever(D.idle);
      // A straight roll at 12 m/s down the runway's heading.
      ac.vel.set(0, 0, -12).applyQuaternion(ac.quat);
      ac.omega && ac.omega.set(0, 0, 0);
      pedals.axes[0] = side === 'left' ? 1 : -1;
      pedals.axes[1] = side === 'right' ? 1 : -1;
      const h0 = ac.heading;
      run(2);
      pedals.axes[0] = pedals.axes[1] = -1;
      return ((ac.heading - h0 + 540) % 360) - 180;
    };
    const right = turnWith('right');
    const left = turnWith('left');
    ok('right toe brake turns her one way, the left the other', Math.abs(right) > 0.3 && Math.abs(left) > 0.3 && Math.sign(right) !== Math.sign(left), `right ${right.toFixed(2)}°, left ${left.toFixed(2)}°`);
    ok('...right is to the right', right > 0, `${right.toFixed(2)}° (heading grows clockwise)`);

    /* ---------- engine masters ---------- */
    // Real switches: each stays where it is put (a release within 0.7 s is a push-button, below).
    press(quad, 0, true);
    press(quad, 1, true);
    run(1);
    press(quad, 0, false);
    run(0.1);
    ok('master 1 OFF, master 2 still ON: the engines run', ac.engineOn);
    press(quad, 1, false);
    run(0.3);
    ok('both masters OFF: the engines stop', !ac.engineOn, `engineOn ${ac.engineOn}`);
    press(quad, 0, true);
    run(3);
    ok('master 1 ON: they start', ac.engineOn || ac.starting > 0, `engineOn ${ac.engineOn}`);
    // The profile's guess may be wrong and button 1 a push-button (an A/THR disconnect): a quick press must not cut the engines.
    press(quad, 0, false);
    run(0.5);
    if (!ac.engineOn) {
      ac.startEngine();
      run(3);
    }
    const runBefore = ac.engineOn;
    press(quad, 1, true);
    run(0.15);
    press(quad, 1, false);
    run(0.5);
    ok('masters OFF, engines running: a quick press and release of a master input (a push-button) does not stop them', runBefore && ac.engineOn, `engineOn ${runBefore} → ${ac.engineOn}`);

    /* ---------- resting on the reverse gate ---------- */
    {
      ac.vel.set(0, 0, -15).applyQuaternion(ac.quat);
      // The lever's position after its 0.02 end deadzone is the one the gates read: put it exactly on the reverse edge.
      const at = (t) => lever(t * 0.96 + 0.02);
      const edge = D.idle - D.band;
      quad.axes[0] = quad.axes[1] = at(edge - 0.01);
      run(0.3);
      const dep = ac.reverse;
      let flips = 0;
      let was = ac.reverse;
      for (let i = 0; i < 40; i++) {
        quad.axes[0] = quad.axes[1] = at(edge + (i % 2 ? 0.004 : -0.004));
        run(1 / 30);
        if (ac.reverse !== was) flips++;
        was = ac.reverse;
      }
      ok('levers resting on the reverse gate, sensor noise ±0.004: the reversers stay out, no flicker', dep > 0 && flips === 0 && ac.reverse > 0, `deployed ${dep}, ${flips} flips, now ${ac.reverse}`);
      quad.axes[0] = quad.axes[1] = lever(D.idle);
      run(0.3);
      ok('...lever into the IDLE gate: stowed', ac.reverse === 0, `reverse ${ac.reverse}`);
    }

    /* ---------- in the air ---------- */
    await sim.startMode('free', { aircraft: 'a320', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const air = sim.aircraft;
    rest();
    run(0.5);
    const thrSpawn = sim.input.throttleTarget;
    ok('spawned in the air: the levers at idle do not cut the power', thrSpawn > 0.3 && !sim.input._hwThr.own, `throttle ${thrSpawn.toFixed(2)}`);
    // Reverse is a ground thing: pulled in the air, the reversers stay stowed (and the power goes to idle).
    quad.axes[0] = quad.axes[1] = lever(D.cl);
    run(0.5);
    quad.axes[0] = quad.axes[1] = lever(0);
    run(0.5);
    ok('in the air, levers pulled to full reverse: reversers stay stowed', !air.onGround && air.reverse === 0 && air.controls.throttle < 0.05, `reverse ${air.reverse}, throttle ${air.controls.throttle.toFixed(2)}`);
    ok('...and the HUD says why', [...document.querySelectorAll('.hud-toast')].some((t) => /locked out in the air/.test(t.textContent)), [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ').slice(-160));
    quad.axes[0] = quad.axes[1] = lever(0.97);
    run(0.5);
    rest();
    quad.axes[0] = quad.axes[1] = lever(0.97);
    run(0.2);
    stick.axes[0] = 0.8;
    run(0.05);
    ok('stick right: roll right, at once', air.controls.roll > 0.7, air.controls.roll.toFixed(2));
    const b0 = air.readouts().bank;
    run(1.2);
    ok('...and she banks right', air.readouts().bank > b0 + 5 || air.readouts().bank > 10, `${b0.toFixed(1)} → ${air.readouts().bank.toFixed(1)}°`);
    stick.axes[0] = 0;
    stick.axes[1] = -0.6; // pushed forward
    run(0.05);
    ok('stick pushed forward: nose down (a real stick)', air.controls.pitch < -0.5, air.controls.pitch.toFixed(2));
    stick.axes[1] = 0;
    pedals.axes[2] = -0.7;
    stick.axes[2] = 0.9; // twisted the other way: the pedals win
    run(0.05);
    ok('pedals left (stick twisted right): the pedals win', air.controls.yaw < -0.6, air.controls.yaw.toFixed(2));
    rest();
    run(0.5);
    // Split levers: engine 1 at idle, engine 2 at TOGA — the nose goes left (towards the idle one).
    const yawRun = (l1, l2) => {
      sim.override = { roll: 0, pitch: 0, yaw: 0 };
      air.omega && air.omega.set(0, 0, 0);
      quad.axes[0] = lever(l1);
      quad.axes[1] = lever(l2);
      run(0.1);
      const h0 = air.heading;
      run(1.5);
      sim.override = null;
      lastSplit = air.controls.thrustSplit;
      return ((air.heading - h0 + 540) % 360) - 180;
    };
    let lastSplit = 0;
    const even = yawRun(0.97, 0.97);
    const rightHigh = yawRun(D.idle, 1);
    ok('split levers: engine 2 minus engine 1 on the controls', lastSplit > 0.9, `${lastSplit}`);
    ok('engine 2 at TOGA, engine 1 at IDLE: the nose swings left', rightHigh < even - 0.3, `even ${even.toFixed(2)}°, split ${rightHigh.toFixed(2)}°`);
    quad.axes[0] = quad.axes[1] = lever(0.62);
    quad.axes[3] = lever(0.67);
    run(0.3);
    ok('the flap lever: two thirds is flaps 2', air.flapStep() === 2, `flaps ${air.flapStep()}`);
    quad.axes[2] = lever(1);
    run(0.2);
    ok('the speedbrake lever: full out', air.speedbrake === 1, `speedbrake ${air.speedbrake}`);
    quad.axes[2] = lever(0);
    run(0.2);
    ok('...and in', air.speedbrake === 0, `speedbrake ${air.speedbrake}`);
    // The flap lever resting between two positions: sensor noise must not run the flaps up and down.
    {
      const f0 = air.flapStep();
      let flaps = 0;
      let wasF = f0;
      for (let i = 0; i < 30; i++) {
        quad.axes[3] = lever(0.5 + (i % 2 ? 0.006 : -0.006));
        run(1 / 30);
        if (air.flapStep() !== wasF) flaps++;
        wasF = air.flapStep();
      }
      ok('the flap lever resting halfway between two positions: no flap flicker', flaps <= 1, `${flaps} changes from flaps ${f0}`);
      quad.axes[3] = lever(0.67);
      run(0.2);
    }
    // Unplugged mid-flight with the stick hard over and the pedals in: nothing stays stuck.
    {
      stick.axes[0] = 1;
      pedals.axes[2] = 0.8;
      run(0.2);
      const held = [air.controls.roll, air.controls.yaw];
      const keep = PADS;
      PADS = [];
      run(0.6);
      ok('unplugged mid-flight, stick and rudder hard over: both back to centre', held[0] > 0.9 && held[1] > 0.6 && Math.abs(air.controls.roll) < 0.02 && Math.abs(air.controls.yaw) < 0.02 && sim.input.hw === null,
        `held ${held.map((v) => v.toFixed(2))} → ${air.controls.roll.toFixed(2)}, ${air.controls.yaw.toFixed(2)}`);
      PADS = keep;
      run(0.2);
      ok('...plugged back in: read again at once', air.controls.roll > 0.9, air.controls.roll.toFixed(2));
      stick.axes[0] = 0;
      pedals.axes[2] = 0;
      run(0.3);
    }

    /* ---------- the Settings panel ---------- */
    const panel = sim.controllersPanel;
    sim.pause();
    const pauseBtn = sim.menus.screens.pause.querySelector('[data-act="settings"]');
    if (pauseBtn) pauseBtn.click();
    const tab = S.querySelector('[data-tab="controls"]');
    if (tab) tab.click();
    panel.tick();
    const cards = [...host.querySelectorAll('.ctl-dev')];
    ok('three devices, by name', cards.length === 3 && /Sidestick Airbus/.test(cards[0].textContent) && /TCA Q-Eng/.test(cards[1].textContent) && /T-Rudder/.test(cards[2].textContent), cards.map((c) => c.querySelector('b').textContent).join(' | '));
    const box = host.querySelector('[data-ctl]');
    ok('the panel fits its column (no sideways scroll)', box.scrollWidth <= box.clientWidth + 1, `${box.scrollWidth} in ${box.clientWidth}`);
    ok('each says which profile is active', /Profile: TCA Quadrant Airbus \(automatic\)/.test(cards[1].querySelector('[data-ctl-active]').textContent), cards[1].querySelector('[data-ctl-active]').textContent);
    // Live meters.
    quad.axes[0] = lever(1);
    panel.tick();
    const val = cards.length ? host.querySelectorAll('.ctl-dev')[1].querySelector('[data-ctl-val="throttle1"]') : null;
    ok('the meters are live: lever 1 reads TOGA', val && /TOGA/.test(val.textContent), val && val.textContent);
    // Assign: flaps onto the stick's base lever (axis 3), by moving it.
    const stickCard = () => host.querySelectorAll('.ctl-dev')[0];
    stickCard().querySelector('[data-role="flaps"] [data-ctl-assign]').click();
    const status = host.querySelector('[data-ctl-status]');
    ok('Assign asks you to move the lever', !status.hidden && /Move the lever/.test(status.textContent), status.textContent);
    panel.tick();
    stick.axes[3] = -1; // the base lever all the way forward
    panel.tick();
    const desc = P.describe(C);
    ok('moving the stick\'s lever puts flaps on it (axis 3), off the quadrant', desc[0].axes.flaps === 3 && desc[1].axes.flaps === undefined, JSON.stringify(desc.map((d) => d.axes)));
    ok('...and one job per axis: the stick\'s throttle came off that lever', desc[0].axes.throttle === undefined, JSON.stringify(desc[0].axes));
    ok('...and says so', /Flaps lever.*axis 3/.test(host.querySelector('[data-ctl-status]').textContent), host.querySelector('[data-ctl-status]').textContent);
    // Invert, from the panel.
    const inv = stickCard().querySelector('[data-role="flaps"] [data-ctl-opt="invert"]');
    inv.checked = true;
    inv.dispatchEvent(new Event('change', { bubbles: true }));
    ok('invert from the panel', C.configFor(stick.id).axes.flaps.invert === true);
    // A button: Landing gear on the quadrant's button 6 (index 5).
    const qCard = () => host.querySelectorAll('.ctl-dev')[1];
    const sel = qCard().querySelector('[data-ctl-action]');
    sel.value = 'gear';
    qCard().querySelector('[data-ctl-bind]').click();
    panel.tick();
    press(quad, 5, true);
    panel.tick();
    press(quad, 5, false);
    panel.tick();
    ok('"Press the button": quadrant button 6 → Landing gear', C.configFor(quad.id).buttons['5'] === 'gear', JSON.stringify(C.configFor(quad.id).buttons));
    ok('...listed on its card', /Button 6 → Landing gear/.test(qCard().textContent));
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(K.STORAGE_KEY));
    } catch (e) {
      void e;
    }
    ok('saved per device id', saved && saved.devices && saved.devices[quad.id] && saved.devices[quad.id].buttons['5'] === 'gear' && saved.devices[stick.id].axes.flaps.axis === 3);
    // Back to flying: the button puts the gear down.
    sim.menus.show('pause');
    sim.resume();
    run(0.2);
    const gear0 = air.gearDown;
    press(quad, 5, true);
    run(0.1);
    press(quad, 5, false);
    run(0.1);
    ok('in flight, that button works the gear', air.gearDown !== gear0, `gear ${gear0} → ${air.gearDown}`);
    // Reset to defaults.
    sim.pause();
    if (pauseBtn) pauseBtn.click();
    if (tab) tab.click();
    panel.tick();
    qCard().querySelector('[data-ctl-reset]').click();
    panel.tick();
    ok('Reset to defaults: the quadrant back on its profile', !C.saved[quad.id] && !C.configFor(quad.id).buttons['5'] && /\(automatic\)$/.test(qCard().querySelector('[data-ctl-active]').textContent.trim()), qCard().querySelector('[data-ctl-active]').textContent);
    // Choosing a profile by hand.
    const ps = stickCard().querySelector('[data-ctl-profile]');
    ps.value = 'none';
    ps.dispatchEvent(new Event('change', { bubbles: true }));
    ok('a device can be ignored', C.configFor(stick.id).mode === 'off' && /ignoring/.test(stickCard().textContent));
    host.querySelector('[data-ctl-reset-all]').click();
    ok('Reset all controllers', Object.keys(C.saved).length === 0 && C.configFor(stick.id).profile.id === 'tca-sidestick');

    /* ---------- an Xbox pad still flies the old way ---------- */
    sim.menus.show('pause');
    sim.resume();
    const xbox = mk(3, 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', 4, 17, 'standard');
    rest();
    PADS = [stick, quad, pedals, xbox];
    run(0.3);
    ok('an Xbox pad beside them is the standard layout', C.devices.find((d) => d.key === xbox.id).cfg.mode === 'standard' && sim.input.gamepad() === xbox);
    const g1 = air.gearDown;
    press(xbox, 0, true);
    run(0.1);
    press(xbox, 0, false);
    run(0.1);
    ok('...A is the gear, as always', air.gearDown !== g1, `${g1} → ${air.gearDown}`);
    xbox.axes[0] = -0.7;
    run(0.6);
    ok('...its left stick rolls her', air.controls.roll < -0.5, air.controls.roll.toFixed(2));
    xbox.axes[0] = 0;
    PADS = [];
    run(0.2);
    const hs3 = H.controllersHudState();
    ok('unplugged: "… disconnected"', hs3.notes.some((n) => /disconnected/.test(n)), hs3.notes.slice(-3).join(' | '));
  } finally {
    sim.override = null;
    if (hadOwn) Object.defineProperty(navigator, 'getGamepads', { value: realGet, configurable: true, writable: true });
    else delete navigator.getGamepads;
    try {
      if (savedStore === null) localStorage.removeItem(K.STORAGE_KEY);
      else localStorage.setItem(K.STORAGE_KEY, savedStore);
    } catch (e) {
      void e;
    }
    C.load();
    C.scan();
    sim.autoPauseOnHide = wasAutoPause;
  }
}

/**
 * The C-17 Globemaster III in the real game: picked, spawned and looked at
 * on Kestrel; its ramp panel and key — the ramp comes down on the ground,
 * the panel follows it, the button works; in the air it is refused when
 * fast, allowed when slow, and shuts itself when the aeroplane speeds up;
 * then a whole circuit flown by the scripted pilot (./circuit-pilot.js)
 * through sim.override — take-off, a left-hand pattern, a three-degree
 * final and a landing to a stop on the 1,100 m strip; the hangar files it
 * under Military; a multiplayer remote's model and the wire — with no
 * console errors.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects. Every step is
 * fenced, so a missing piece reports a failure rather than taking the suite
 * down.
 */

const KT = 1.94384;

export async function check(sim, r, say) {
  const M = {};
  try {
    M.ext = await import('../../src/game/extensions.js');
    M.types = await import('../../src/aircraft/types.js');
    M.terrain = await import('../../src/world/terrain.js');
    M.adapter = await import('../../src/aircraft/model-adapter.js');
    M.minimap = await import('../../src/ui/minimap.js');
    M.protocol = await import('../../src/features/multiplayer/protocol.js');
    M.pilot = await import('./circuit-pilot.js');
    M.physics = await import('../../src/aircraft/physics.js');
    M.ramp = await import('../../src/features/cargo-ramp.js');
    M.menus = await import('../../src/ui/menus.js').catch(() => null);
    M.THREE = await import('../../src/vendor/three.module.js');
  } catch (e) {
    r.ok('c17: modules load', false, String(e && e.message));
    return;
  }
  const live = (id) => {
    const s = M.ext.extStatus().find((e) => e.id === id);
    return !!(s && s.live);
  };
  r.ok('c17: the cargo-ramp feature is registered and live', live('cargo-ramp'));
  r.ok('c17: in the roster', M.types.AIRCRAFT.some((t) => t.id === 'c17'));

  const wait = (ms) => new Promise((f) => setTimeout(f, ms));
  const goTo = async (id) => {
    if (M.terrain.MAP.id === id && sim.settings.map === id) return true;
    const before = sim.scenery;
    sim.setMap(id);
    for (let i = 0; i < 1500 && (sim.scenery === before || M.terrain.MAP.id !== id); i++) await wait(10);
    await wait(60);
    return M.terrain.MAP.id === id;
  };
  const key = (code, type = 'keydown') => window.dispatchEvent(new KeyboardEvent(type, { code, key: code, bubbles: true }));
  const tap = (code) => {
    key(code, 'keydown');
    key(code, 'keyup');
  };

  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    errors.push(a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 200));
    realError.apply(console, a);
  };
  const onErr = (e) => errors.push(`uncaught: ${(e && e.message) || e}`.slice(0, 200));
  window.addEventListener('error', onErr);
  const notes = [];
  const realNotify = sim.hud.notify.bind(sim.hud);
  sim.hud.notify = (text, ...rest) => {
    notes.push(String(text));
    return realNotify(text, ...rest);
  };

  const startMap = sim.settings.map;
  const before = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  const autoPause = sim.autoPauseOnHide;
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.autoPauseOnHide = false;
  try {
    /* ---- Kestrel: spawn, look, the ramp on the ground ---- */
    say('c17: on kestrel');
    if (!(await goTo('kestrel'))) r.ok('c17: kestrel loads', false, M.terrain.MAP.id);
    await sim.startMode('free', { aircraft: 'c17', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac = sim.aircraft;
    const type = sim.aircraftType;
    sim.step(0.2);
    r.ok('c17: selected', type && type.id === 'c17');
    const cargo = sim.model.userData.cargo;
    r.ok('c17: drawn by its own hand-built model, with the ramp API', sim.model.userData.aircraftId === 'c17' && !!sim.model.userData.fleetBridge && !!cargo);
    r.ok('c17: tyres sit on the physics contact points', Math.abs(sim.model.userData.groundOffsetY || 0) < 0.05, `${(sim.model.userData.groundOffsetY || 0).toFixed(3)} m`);
    r.ok('c17: take-off flap set for you on the ground', ac.flapStep() === type.takeoffFlaps, `flaps ${ac.flapStep()}, wanted ${type.takeoffFlaps}`);
    r.ok('c17: told how to lower the ramp', notes.some((n) => /lower the cargo ramp/.test(n)), notes.slice(-3).join(' | '));
    const cp = sim.cockpit;
    const eye = sim.model.userData.flightGeometry && sim.model.userData.flightGeometry.eye;
    r.ok("c17: the cockpit is placed from the type's eye, full size, high on the nose",
      !!cp && Math.abs(cp.scale.x - 1) < 1e-6 && !!eye && Math.abs(cp.position.z - (eye[2] - 0.06)) < 0.01 && eye[1] > 2,
      cp ? `scale ${cp.scale.x.toFixed(2)}, z ${cp.position.z.toFixed(2)}, eye ${eye && eye.join(',')}` : 'no cockpit');
    r.ok('c17: JetSound and a yaw damper', (!sim.audio || sim.audio.engineKind === 'jet') && M.physics.SPEC.yawDamper === true, `audio ${sim.audio && sim.audio.engineKind}`);
    r.ok('c17: the minimap draws it as an aeroplane', M.minimap.resolveMode(sim) === 'flight');
    sim.step(3);
    r.ok('c17: stands on its own wheels after spawning', !ac.crashed && ac.onGround && Math.abs(ac.pitchAngleDeg()) < 2 && ac.groundSpeed < 2.5,
      ac.crashed ? ac.crashReason : `pitch ${ac.pitchAngleDeg().toFixed(2)}, creeping ${ac.groundSpeed.toFixed(2)} m/s`);
    sim.rig.setMode('chase');
    sim.step(1.5);
    const g = M.types.getAircraft('c17').plan;
    const d = sim.camera.position.distanceTo(ac.pos);
    r.ok('c17: follow camera stands clear of the tail', d > g.tail + 4, `${d.toFixed(1)} m back, tail ${g.tail} m`);

    const panel = document.querySelector('.ramp-panel');
    r.ok('ramp: the panel is up: RAMP, CLOSED, an OPEN button', !!panel && panel.classList.contains('is-shown') && /CLOSED/.test(panel.textContent) && /OPEN/.test(panel.textContent),
      panel ? panel.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : 'no panel');
    r.ok('ramp: shut at the start', cargo && cargo.state === 'closed' && cargo.amount() === 0);
    notes.length = 0;
    tap('Digit6');
    sim.step(0.5);
    r.ok('ramp: 6 on the ground starts it down, and says so', cargo.state === 'opening' && cargo.amount() > 0 && notes.some((n) => /Ramp coming down/.test(n)), `${cargo.state} ${cargo.amount().toFixed(2)}; ${notes.join(' | ')}`);
    sim.step(0.5);
    r.ok('ramp: the panel follows it: OPENING, the bar part way, the button now CLOSE', /OPENING/.test(panel.textContent) && /CLOSE/.test(panel.textContent) && parseFloat(panel.querySelector('.ramp-bar i').style.width) > 0,
      panel.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
    sim.step(9);
    r.ok('ramp: down in about eight seconds, the toe on the tarmac', cargo.state === 'open' && cargo.isOpen && /OPEN/.test(panel.textContent) && !/OPENING/.test(panel.textContent), `${cargo.state} ${cargo.amount()}`);
    {
      // The toe: the end of the ramp deck, in the world, over the runway.
      const deck = cargo.nodes.ramp.children.find((c) => c.name === 'Ramp deck');
      const toe = new M.THREE.Vector3(0, 0.1, cargo.length);
      sim.model.updateMatrixWorld(true);
      deck.localToWorld(toe);
      const agl = toe.y - M.terrain.heightAt(toe.x, toe.z);
      r.ok('ramp: the toe is on the ground behind the aeroplane', agl > -0.3 && agl < 0.5, `${agl.toFixed(2)} m above the runway`);
    }
    // The button: a pointer press closes it again.
    const btn = panel.querySelector('.ramp-btn');
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'touch' }));
    sim.step(0.3);
    r.ok('ramp: the panel\'s button (a tap on a phone) closes it', cargo.state === 'closing' && cargo.target === 0, `${cargo.state}`);
    sim.step(9);
    r.ok('ramp: shut again', cargo.state === 'closed' && cargo.amount() === 0);

    // A touch screen: the ramp is a pad among the touch pads (OPEN RAMP beside
    // the camera), and the card stays out of the right-hand column. A stand-in
    // touch layer where the page has none (this headless desktop).
    {
      const realTouch = !!document.querySelector('.touch-pads');
      let stub = null;
      if (!realTouch) {
        stub = document.createElement('div');
        stub.className = 'touch-pads';
        stub.style.cssText = 'position:absolute;right:0;bottom:0;display:grid';
        document.body.appendChild(stub);
      }
      M.ramp.dropPad();
      sim.step(0.3);
      const pad = document.querySelector('.ramp-pad');
      const st = M.ramp.rampState();
      r.ok('ramp: on a touch screen, an OPEN RAMP pad joins the touch pads and the card goes', !!pad && pad.parentNode.classList.contains('touch-pads') && !pad.hidden && /OPEN RAMP/.test(pad.textContent) && !panel.classList.contains('is-shown'),
        JSON.stringify(st.pad) + ` card ${st.shown}`);
      pad && pad.click();
      sim.step(0.5);
      r.ok('ramp: a tap on the pad starts it down; the pad lights and reads CLOSE RAMP', cargo.state === 'opening' && pad.classList.contains('is-on') && /CLOSE RAMP/.test(pad.textContent), `${cargo.state} ${pad && pad.textContent}`);
      cargo.close({ instant: true });
      M.ramp.dropPad();
      if (stub) stub.remove();
      sim.step(0.3);
      r.ok('ramp: without the touch layer, the card is back', !!realTouch || panel.classList.contains('is-shown'));
    }

    /* ---- In the air: refused fast, allowed slow, shuts itself ---- */
    say('c17: ramp in the air');
    const THREE = M.THREE;
    const Rw = M.terrain.AIRPORT.runway;
    ac.reset({ pos: new THREE.Vector3(Rw.cx, 0, Rw.cz - 3000), headingDeg: 90, speed: 110, altAGL: 600, engineOn: true, gearDown: false });
    ac.pos.y = M.terrain.heightAt(ac.pos.x, ac.pos.z) + 600;
    ac.setFlaps(0);
    sim.step(0.5);
    notes.length = 0;
    tap('Digit6');
    sim.step(0.3);
    r.ok('ramp: at 210 kt in the air, 6 is refused, with the reason', cargo.state === 'closed' && notes.some((n) => /Too fast for the ramp/.test(n)), `${(ac.ias * KT).toFixed(0)} kt; ${notes.join(' | ')}`);
    ac.reset({ pos: ac.pos.clone(), headingDeg: 90, speed: 62, altAGL: 600, engineOn: true, gearDown: false });
    ac.pos.y = M.terrain.heightAt(ac.pos.x, ac.pos.z) + 600;
    ac.setFlaps(2);
    sim.step(0.5);
    notes.length = 0;
    tap('Digit6');
    sim.step(0.5);
    r.ok('ramp: at 120 kt it opens, and says to stay under 150', cargo.state === 'opening' && notes.some((n) => /under 150 knots/.test(n)), `${(ac.ias * KT).toFixed(0)} kt; ${cargo.state}; ${notes.join(' | ')}`);
    notes.length = 0;
    ac.reset({ pos: ac.pos.clone(), headingDeg: 90, speed: 100, altAGL: 600, engineOn: true, gearDown: false });
    ac.pos.y = M.terrain.heightAt(ac.pos.x, ac.pos.z) + 600;
    sim.step(0.5);
    r.ok('ramp: open and sped up past 165 kt, it shuts itself and says why', cargo.target === 0 && notes.some((n) => /closed itself/.test(n)), `${(ac.ias * KT).toFixed(0)} kt; ${cargo.state}; ${notes.join(' | ')}`);
    cargo.close({ instant: true });

    /* ---- The circuit ---- */
    say('c17: circuit');
    await sim.startMode('free', { aircraft: 'c17', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac2 = sim.aircraft;
    sim.step(0.5);
    const R = M.terrain.AIRPORT.runway;
    const runway = { x0: R.cx - R.length / 2, z0: R.cz, headingDeg: 90, length: R.length, elev: M.terrain.heightAt(R.cx, R.cz) };
    const pilot = M.pilot.circuitPilot({
      ac: ac2, runway, perf: M.types.performanceFor('c17'), giant: false, heightAt: M.terrain.heightAt,
      gear: (down) => { if (ac2.gearDown !== down) sim.tap('KeyG'); },
      flaps: (s) => ac2.setFlaps(s),
    });
    const out = {};
    const CTRL = {};
    Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { Object.assign(out, pilot.step(1 / 30)); return out.pitch; } });
    for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return out[k]; } });
    sim.renderer.render = () => {};
    sim.override = CTRL;
    let secs = 0;
    const errs0 = errors.length;
    try {
      while (!pilot.done && secs < 900) {
        sim.step(0.5, 1 / 30);
        secs += 0.5;
        clearTimeout(sim._crashDebriefT);
        if (ac2.crashed) pilot.fail(`crashed: ${ac2.crashReason} (${pilot.phase})`);
        if (sim.state !== 'flying' && !ac2.crashed) pilot.fail(`left the flight (${sim.state})`);
        if (secs % 30 === 0) await wait(0);
      }
      if (!pilot.done) pilot.fail(`timed out (${pilot.phase})`);
    } finally {
      sim.override = null;
      sim.renderer.render = realRender;
    }
    const S = pilot.state;
    const half = (R.halfWidth || 17) - 3;
    r.ok('c17: takes off, flies a circuit and lands on Kestrel, stopping on the runway',
      pilot.ok && !ac2.crashed && S.stopAlong < runway.length && Math.abs(S.stopCross) < half,
      `${Math.round(secs)} s; ${pilot.log.filter((l) => /airborne|final|touchdown|stopped|crash|timed|left/.test(l)).join('; ')}${ac2.lastTouchdown ? ` (${ac2.lastTouchdown.quality})` : ''}`);
    r.ok('c17: no console errors while it flew', errors.length === errs0, errors.slice(errs0, errs0 + 3).join(' | '));

    /* ---- Where the rest of the game files it ---- */
    if (M.menus) r.ok('c17: the hangar files it under Military', M.menus.aircraftCategory(type) === 'military', M.menus.aircraftCategory(type));
    {
      let built = false;
      let detail = '';
      try {
        const m = M.adapter.createAircraftModel({ type, livery: { id: 'multiplayer', name: 'Multiplayer', base: '#3a7bd5', accent: '#ffffff', cheatline: 'rgba(255,255,255,0.9)', tail: 0x3a7bd5, reg: null } });
        built = !!m.userData.fleetBridge && !!m.userData.cargo;
        m.userData.dispose();
      } catch (e) {
        detail = String(e && e.message);
      }
      const wire = M.protocol.decodeStates(M.protocol.encodeState({ id: 2, seq: 1, t: 0, pos: { x: 1, y: 2, z: 3 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'c17' }));
      r.ok('c17: a multiplayer remote builds it in a player\'s colour, ramp and all, and the type crosses the wire', built && wire[0] && wire[0].type === 'c17', detail);
    }
    r.ok('c17: no console errors overall', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    r.ok('c17: the check itself ran', false, String(e && (e.stack || e.message)).slice(0, 300));
  } finally {
    console.error = realError;
    window.removeEventListener('error', onErr);
    sim.hud.notify = realNotify;
    sim.renderer.render = realRender;
    sim.override = null;
    sim.autoPauseOnHide = autoPause;
    try {
      if (sim.settings.map !== startMap) await goTo(startMap);
      await sim.startMode('free', { aircraft: before, time: 'day', condition: 'clear' });
      if (sim.quitToMenu) sim.quitToMenu();
    } catch (e) { void e; }
  }
}

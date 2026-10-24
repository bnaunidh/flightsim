/**
 * The B-1B Lancer in the real game: picked, spawned and looked at on
 * Kestrel; its wing panel and keys; a whole circuit flown by the scripted
 * pilot (./circuit-pilot.js) through sim.override — take-off, a left-hand
 * pattern, a three-degree final and a landing to a stop on the 1,100 m strip;
 * then through the sound barrier at 40,000 ft with the burners lit and the
 * wing back; a start at Ironhead Air Base that is never the carrier; a
 * multiplayer remote's model and the wire — with no console errors.
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
    M.swing = await import('../../src/features/swing-wing.js');
    M.lancer = await import('../../src/aircraft/extra/lancer.js');
    M.spawns = await import('../../src/features/spawns.js').catch(() => null);
  } catch (e) {
    r.ok('lancer: modules load', false, String(e && e.message));
    return;
  }
  const live = (id) => {
    const s = M.ext.extStatus().find((e) => e.id === id);
    return !!(s && s.live);
  };
  r.ok('lancer: the swing-wing feature is registered and live', live('swing-wing'));
  r.ok('lancer: in the roster', M.types.AIRCRAFT.some((t) => t.id === 'b1b'));

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
  const wing = M.swing.swingState();
  try {
    /* ---- Kestrel: spawn, look, keys ---- */
    say('lancer: on kestrel');
    if (!(await goTo('kestrel'))) r.ok('lancer: kestrel loads', false, M.terrain.MAP.id);
    await sim.startMode('free', { aircraft: 'b1b', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac = sim.aircraft;
    const type = sim.aircraftType;
    sim.step(0.2);
    r.ok('lancer: selected', type && type.id === 'b1b');
    const rig = sim.model.userData.sweepRig;
    r.ok('lancer: drawn by its own hand-built model, with the swing-wing rig', sim.model.userData.aircraftId === 'b1b' && !!sim.model.userData.fleetBridge && !!rig);
    r.ok('lancer: tyres sit on the physics contact points', Math.abs(sim.model.userData.groundOffsetY || 0) < 0.05, `${(sim.model.userData.groundOffsetY || 0).toFixed(3)} m`);
    r.ok('lancer: take-off flap set for you on the ground, and the wing forward in AUTO', ac.flapStep() === type.takeoffFlaps && wing.mode === 'auto' && wing.sweep === 15 && rig.shown === 15,
      `flaps ${ac.flapStep()}, ${wing.mode} ${wing.sweep}`);
    r.ok('lancer: and told so', notes.some((n) => /flaps 20° for take-off/.test(n)), notes.slice(-3).join(' | '));
    const cp = sim.cockpit;
    const eye = sim.model.userData.flightGeometry && sim.model.userData.flightGeometry.eye;
    r.ok("lancer: the cockpit is placed from the type's eye, full size",
      !!cp && Math.abs(cp.scale.x - 1) < 1e-6 && !!eye && Math.abs(cp.position.z - (eye[2] - 0.06)) < 0.01,
      cp ? `scale ${cp.scale.x.toFixed(2)}, z ${cp.position.z.toFixed(2)}, eye ${eye && eye[2]}` : 'no cockpit');
    r.ok('lancer: JetSound and a yaw damper', (!sim.audio || sim.audio.engineKind === 'jet') && M.physics.SPEC.yawDamper === true, `audio ${sim.audio && sim.audio.engineKind}`);
    r.ok('lancer: the minimap draws it as an aeroplane', M.minimap.resolveMode(sim) === 'flight');
    sim.step(3);
    r.ok('lancer: stands on its own wheels after spawning', !ac.crashed && ac.onGround && Math.abs(ac.pitchAngleDeg()) < 2 && ac.groundSpeed < 2.5,
      ac.crashed ? ac.crashReason : `pitch ${ac.pitchAngleDeg().toFixed(2)}, creeping ${ac.groundSpeed.toFixed(2)} m/s`);
    sim.rig.setMode('chase');
    sim.step(1.5);
    const g = M.types.getAircraft('b1b').plan;
    const d = sim.camera.position.distanceTo(ac.pos);
    r.ok('lancer: follow camera stands clear of the tail', d > g.tail + 4, `${d.toFixed(1)} m back, tail ${g.tail} m`);
    const panel = document.querySelector('.swing-panel');
    r.ok('lancer: the wing panel is up: WINGS 15°, AUTO', !!panel && panel.classList.contains('is-shown') && /15°/.test(panel.textContent) && /AUTO/.test(panel.textContent),
      panel ? panel.textContent.replace(/\s+/g, ' ').trim().slice(0, 80) : 'no panel');
    // The keys, on the ground: ] is refused while the flaps are down.
    notes.length = 0;
    tap('BracketRight');
    sim.step(0.1);
    r.ok('keys: ] with the take-off flap down is refused, with the reason (and not the carrier\'s "no tail hook")',
      wing.mode === 'auto' && notes.some((n) => /Flaps up first/.test(n)) && !notes.some((n) => /tail hook/.test(n)), notes.join(' | '));
    ac.setFlaps(0);
    sim.step(2.5);
    notes.length = 0;
    tap('BracketRight');
    sim.step(5);
    r.ok('keys: ] with the flaps up takes the wing to 25° in MANUAL; the panel says so; the model follows',
      wing.mode === 'manual' && Math.abs(wing.sweep - 25) < 0.01 && /MANUAL/.test(panel.textContent) && /25°/.test(panel.textContent) && Math.abs(rig.shown - 25) < 0.01,
      `${wing.mode} ${wing.sweep.toFixed(1)}; ${panel.textContent.replace(/\s+/g, ' ').trim().slice(0, 60)}`);
    tap('BracketLeft');
    tap('BracketLeft');
    sim.step(2.5);
    r.ok('keys: [ then [ at the forward stop: 15° and AUTO again', wing.mode === 'auto' && Math.abs(wing.sweep - 15) < 0.01 && /AUTO/.test(panel.textContent), `${wing.mode} ${wing.sweep.toFixed(1)}`);
    r.ok('keys: the carrier never heard them (no hook note)', !notes.some((n) => /tail hook|catapult/i.test(n)), notes.join(' | '));
    ac.setFlaps(type.takeoffFlaps);
    sim.step(2.5);

    /* ---- The circuit ---- */
    say('lancer: the circuit');
    const errs0 = errors.length;
    const R = M.terrain.AIRPORT.runway;
    const runway = { x0: R.cx - R.length / 2, z0: R.cz, headingDeg: 90, length: R.length, elev: M.terrain.heightAt(R.cx, R.cz) };
    // From the take-off position: 80 m in, lined up.
    await sim.startMode('free', { aircraft: 'b1b', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac2 = sim.aircraft;
    sim.step(0.2);
    const pilot = M.pilot.circuitPilot({
      ac: ac2, runway, perf: M.types.performanceFor('b1b'), giant: false, heightAt: M.terrain.heightAt,
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
    let maxSweep = 0;
    let lit = 0;
    try {
      while (!pilot.done && secs < 900) {
        sim.step(0.5, 1 / 30);
        secs += 0.5;
        maxSweep = Math.max(maxSweep, wing.sweep);
        if (wing.burner > 0.5) lit++;
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
    r.ok('lancer: takes off, flies a circuit and lands on Kestrel\'s 1,100 m, stopping on the runway',
      pilot.ok && !ac2.crashed && S.stopAlong < R.length && Math.abs(S.stopCross) < half,
      `${Math.round(secs)} s; ${pilot.log.filter((l) => /airborne|final|touchdown|stopped|crash|timed|left/.test(l)).join('; ')}${ac2.lastTouchdown ? ` (${ac2.lastTouchdown.quality})` : ''}`);
    r.ok('lancer: the burners lit for the take-off; the wing stayed forward round the slow circuit (AUTO)', lit > 0 && maxSweep < 26, `lit ${lit} half-seconds, most sweep ${maxSweep.toFixed(1)}`);
    r.ok('lancer: no console errors while it flew', errors.length === errs0, errors.slice(errs0, errs0 + 3).join(' | '));

    /* ---- Through the sound barrier ---- */
    say('lancer: the sound barrier');
    const THREE = await import('../../src/vendor/three.module.js');
    await sim.startMode('free', { aircraft: 'b1b', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const ac3 = sim.aircraft;
    ac3.reset({ pos: new THREE.Vector3(-8000, 0, 3000), headingDeg: 90, speed: 262, altAGL: 12000, engineOn: true, gearDown: false });
    ac3.pos.y = 12000;
    ac3.setFlaps(0);
    ac3.rpm = 1;
    const hold = {};
    Object.defineProperty(hold, 'pitch', {
      enumerable: true,
      get() {
        const wantVs = Math.max(-8, Math.min(8, (12000 - ac3.pos.y) * 0.08));
        return Math.max(-0.8, Math.min(0.8, (wantVs - ac3.vs) * 0.05 - ac3.omega.x * 1.5));
      },
    });
    Object.assign(hold, { roll: 0, yaw: 0, throttle: 1, brakes: 0 });
    sim.renderer.render = () => {};
    sim.override = hold;
    let m1 = null;
    let maxM = 0;
    let dashSeen = 0;
    const errs1 = errors.length;
    try {
      for (let t = 0; t < 300 && !ac3.crashed; t += 0.5) {
        sim.step(0.5, 1 / 30);
        maxM = Math.max(maxM, wing.mach);
        if (document.body.classList.contains('swing-dash')) dashSeen++;
        if (m1 === null && wing.mach >= 1) m1 = t;
        if (t % 30 === 0) await wait(0);
      }
    } finally {
      sim.override = null;
      sim.renderer.render = realRender;
    }
    r.ok('lancer: at 40,000 ft, burners lit, the wing sweeps back and it goes through Mach 1', m1 !== null && maxM >= 1.15 && !ac3.crashed && wing.sweep === 67.5 && rig.shown === 67.5,
      `Mach 1 at ${m1} s, M ${maxM.toFixed(3)} at most, ${(ac3.airspeed * KT).toFixed(0)} kt true, wing ${wing.sweep}${ac3.crashed ? `, ${ac3.crashReason}` : ''}`);
    sim.step(0.1);
    r.ok('lancer: the panel reads the Mach number and AB is lit (steady, not flashing)', /M 1\.\d\d/.test(panel.textContent) && panel.querySelector('.swing-ab.is-lit') !== null,
      panel.textContent.replace(/\s+/g, ' ').trim().slice(0, 80));
    r.ok('lancer: on the burners, under the red line, the coach does not tell it to slow down', dashSeen > 500, `${dashSeen} of 600 half-seconds`);
    const tip = M.lancer.tipAt(67.5);
    const sprites = sim.model.children.filter((o) => o.isSprite && Math.abs(Math.abs(o.position.x) - tip.x) < 1.5);
    r.ok('lancer: the wing-tip lamps went back with the tips', sprites.length >= 4, `${sprites.length} lamps near x ${tip.x.toFixed(1)}`);
    r.ok('lancer: no console errors going supersonic', errors.length === errs1, errors.slice(errs1, errs1 + 3).join(' | '));

    /* ---- Ironhead Air Base: an Auto start, never the carrier ---- */
    if (await goTo('airbase')) {
      say('lancer: ironhead');
      await sim.startMode('free', { aircraft: 'b1b', startAt: 'auto', taxi: false, time: 'day', condition: 'clear', windSpeedKts: 0 });
      sim.step(3);
      const ac4 = sim.aircraft;
      r.ok('lancer: a new flight puts the coach back', !document.body.classList.contains('swing-dash'));
      const st = M.spawns && M.spawns.spawnsState ? M.spawns.spawnsState() : null;
      const where = st && st.last ? `${st.last.kind} ${st.last.label}` : 'no spawn record';
      const deck = sim.carrier && sim.carrier.deckY !== undefined ? Math.abs(ac4.pos.y - sim.carrier.deckY) < 3 : false;
      r.ok('lancer: on Ironhead Air Base an Auto start is on the ground at the base (the flight line, or the runway where the 42 m wing will not fit beside a shelter, as a 747 does), standing on its wheels, never the carrier',
        !ac4.crashed && ac4.onGround && !deck && !(st && st.last && st.last.kind === 'carrier'), where);
    }

    /* ---- A remote player's model and the wire ---- */
    try {
      const t = M.types.getAircraft('b1b');
      const m = M.adapter.createAircraftModel({ type: t, livery: { id: 'multiplayer', name: 'Multiplayer', base: '#3a7bd5', accent: '#ffffff', cheatline: 'rgba(255,255,255,0.9)', tail: 0x3a7bd5, reg: null } });
      const okModel = !!m.userData.fleetBridge && m.userData.aircraftId === 'b1b' && !!m.userData.sweepRig;
      // A remote flying fast sweeps by itself.
      for (let i = 0; i < 200; i++) m.userData.update(0.05, { rpm: 1, gearPos: 0, onGround: false, vel: new THREE.Vector3(0, 0, -280) }, sim.weather);
      const swept = m.userData.sweepRig.shown;
      m.userData.dispose();
      const buf = M.protocol.encodeState({ id: 3, seq: 1, t: 0, pos: { x: 1, y: 2, z: 3 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'b1b' });
      const back = M.protocol.decodeStates(buf);
      r.ok("lancer: a multiplayer remote builds in a player's colour, sweeps its wings at speed by itself, and the type crosses the wire",
        okModel && swept > 60 && back && back[0] && back[0].type === 'b1b', `model ${okModel}, swept ${swept && swept.toFixed(1)}, wire ${back && back[0] && back[0].type}`);
    } catch (e) {
      r.ok('lancer: a multiplayer remote builds its model', false, String(e && e.message));
    }
  } finally {
    sim.override = null;
    sim.renderer.render = realRender;
    sim.autoPauseOnHide = autoPause;
    sim.hud.notify = realNotify;
    console.error = realError;
    window.removeEventListener('error', onErr);
    try {
      if (startMap && sim.settings.map !== startMap) await goTo(startMap);
      sim.setAircraft(before);
    } catch (e) {
      /* the suite restores its own state after this */
    }
  }
}

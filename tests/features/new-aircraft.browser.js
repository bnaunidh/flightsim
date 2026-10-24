/**
 * The aeroplanes added by new-aircraft, in the real game: each one picked,
 * spawned, looked at, and flown round a whole circuit — take-off, a
 * left-hand pattern, a three-degree final, a landing to a stop — on the
 * map it is meant for (the popular six on Kestrel's 1,100 m, the giants on
 * Gateway's 3,800 m), by the scripted pilot in ./circuit-pilot.js through
 * sim.override, with no console errors on the way. Then a giant started on a
 * short map (in the air, and told why), the minimap, a multiplayer remote's
 * model and the wire format.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects. Every step is
 * fenced, so a missing piece reports a failure rather than taking the suite
 * down. `opts.ids` limits which types fly (all of them by default).
 */

const POPULAR = ['b737', 'a321', 'b787', 'a350', 'b777', 'q400', 'concorde'];
const GIANTS = ['belugaxl', 'dreamlifter', 'an225', 'c5'];
const MAP_OF = (id) => (GIANTS.includes(id) ? 'gateway' : 'kestrel');
const KT = 1.94384;

export async function check(sim, r, say, opts = {}) {
  let M = {};
  try {
    M.ext = await import('../../src/game/extensions.js');
    M.types = await import('../../src/aircraft/types.js');
    M.airliners = await import('../../src/features/airliners.js');
    M.giants = await import('../../src/features/giants.js');
    M.terrain = await import('../../src/world/terrain.js');
    M.adapter = await import('../../src/aircraft/model-adapter.js');
    M.liveries = await import('../../src/aircraft/liveries.js');
    M.minimap = await import('../../src/ui/minimap.js');
    M.protocol = await import('../../src/features/multiplayer/protocol.js');
    M.pilot = await import('./circuit-pilot.js');
    M.physics = await import('../../src/aircraft/physics.js');
  } catch (e) {
    r.ok('new aircraft: modules load', false, String(e && e.message));
    return;
  }
  const live = (id) => {
    const s = M.ext.extStatus().find((e) => e.id === id);
    return !!(s && s.live);
  };
  r.ok('new aircraft: the giants feature is registered and live', live('giants'));
  const ids = (opts.ids || [...POPULAR, ...GIANTS]).filter((id) => M.types.AIRCRAFT.some((t) => t.id === id));
  r.ok('new aircraft: all eleven in the roster', [...POPULAR, ...GIANTS].every((id) => M.types.AIRCRAFT.some((t) => t.id === id)));

  const wait = (ms) => new Promise((f) => setTimeout(f, ms));
  /** setMap() rebuilds behind a paint; wait for the new scenery (tests/features/maps.browser.js). */
  const goTo = async (id) => {
    if (M.terrain.MAP.id === id && sim.settings.map === id) return true;
    const before = sim.scenery;
    sim.setMap(id);
    for (let i = 0; i < 1500 && (sim.scenery === before || M.terrain.MAP.id !== id); i++) await wait(10);
    await wait(60);
    return M.terrain.MAP.id === id;
  };

  // Console errors while these fly: counted, and named in the failure.
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    errors.push(a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 200));
    realError.apply(console, a);
  };
  const onErr = (e) => errors.push(`uncaught: ${(e && e.message) || e}`.slice(0, 200));
  window.addEventListener('error', onErr);

  const startMap = sim.settings.map;
  const before = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  const autoPause = sim.autoPauseOnHide;
  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.autoPauseOnHide = false;
  try {
    for (const id of ids) {
      const map = MAP_OF(id);
      say(`new aircraft: ${id} on ${map}`);
      const errs0 = errors.length;
      if (!(await goTo(map))) {
        r.ok(`${id}: ${map} loads`, false, M.terrain.MAP.id);
        continue;
      }
      await sim.startMode('free', { aircraft: id, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
      const ac = sim.aircraft;
      const type = sim.aircraftType;
      r.ok(`${id}: selected`, type && type.id === id);
      r.ok(`${id}: drawn by its own hand-built model`, sim.model.userData.aircraftId === id && !!sim.model.userData.fleetBridge);
      r.ok(`${id}: tyres sit on the physics contact points`, Math.abs(sim.model.userData.groundOffsetY || 0) < 0.05, `${(sim.model.userData.groundOffsetY || 0).toFixed(3)} m`);
      r.ok(`${id}: take-off flap set for you on the runway`, ac.flapStep() === M.airliners.TAKEOFF_FLAPS[id], `flaps ${ac.flapStep()}, wanted ${M.airliners.TAKEOFF_FLAPS[id]}`);
      const cp = sim.cockpit;
      const eye = sim.model.userData.flightGeometry && sim.model.userData.flightGeometry.eye;
      r.ok(`${id}: the cockpit is placed from the type's eye, full size`,
        !!cp && Math.abs(cp.scale.x - 1) < 1e-6 && !!eye && Math.abs(cp.position.z - (eye[2] - 0.06)) < 0.01,
        cp ? `scale ${cp.scale.x.toFixed(2)}, z ${cp.position.z.toFixed(2)}, eye ${eye && eye[2]}` : 'no cockpit');
      const kind = type.shape.power.kind;
      r.ok(`${id}: ${kind === 'jet' ? 'JetSound and a yaw damper' : 'the propeller sound, no yaw damper'}`,
        (!sim.audio || sim.audio.engineKind === kind) && M.physics.SPEC.yawDamper === (kind === 'jet'),
        `audio ${sim.audio && sim.audio.engineKind}, damper ${M.physics.SPEC.yawDamper}`);
      r.ok(`${id}: the minimap draws it as an aeroplane`, M.minimap.resolveMode(sim) === 'flight');
      sim.step(3);
      r.ok(`${id}: stands on its own wheels after spawning`,
        !ac.crashed && ac.onGround && Math.abs(ac.pitchAngleDeg()) < 2 && ac.groundSpeed < 2.5,
        ac.crashed ? ac.crashReason : `pitch ${ac.pitchAngleDeg().toFixed(2)} deg, creeping ${ac.groundSpeed.toFixed(2)} m/s`);
      sim.rig.setMode('chase');
      sim.step(1.5);
      const g = M.types.getAircraft(id).plan;
      const d = sim.camera.position.distanceTo(ac.pos);
      r.ok(`${id}: follow camera stands clear of the tail`, d > g.tail + 4, `${d.toFixed(1)} m from the centre of gravity, tail ${g.tail.toFixed(1)} m back`);

      // The circuit.
      const R = M.terrain.AIRPORT.runway;
      const runway = { x0: R.cx - R.length / 2, z0: R.cz, headingDeg: 90, length: R.length, elev: M.terrain.heightAt(R.cx, R.cz) };
      const pilot = M.pilot.circuitPilot({
        ac, runway, perf: M.types.performanceFor(id), giant: !!type.minRunway, heightAt: M.terrain.heightAt,
        gear: (down) => { if (ac.gearDown !== down) sim.tap('KeyG'); },
        flaps: (s) => ac.setFlaps(s),
      });
      const out = {};
      const CTRL = {};
      Object.defineProperty(CTRL, 'pitch', { enumerable: true, get() { Object.assign(out, pilot.step(1 / 30)); return out.pitch; } });
      for (const k of ['roll', 'yaw', 'throttle', 'brakes']) Object.defineProperty(CTRL, k, { enumerable: true, get() { return out[k]; } });
      sim.renderer.render = () => {};
      sim.override = CTRL;
      let secs = 0;
      try {
        while (!pilot.done && secs < 900) {
          sim.step(0.5, 1 / 30);
          secs += 0.5;
          clearTimeout(sim._crashDebriefT);
          if (ac.crashed) pilot.fail(`crashed: ${ac.crashReason} (${pilot.phase})`);
          if (sim.state !== 'flying' && !ac.crashed) pilot.fail(`left the flight (${sim.state})`);
          if (secs % 30 === 0) await wait(0);
        }
        if (!pilot.done) pilot.fail(`timed out (${pilot.phase})`);
      } finally {
        sim.override = null;
        sim.renderer.render = realRender;
      }
      const S = pilot.state;
      const usable = type.minRunway || runway.length;
      // On the runway: inside its length and its width, less a wheel track's margin.
      const half = (R.halfWidth || 17) - 3;
      r.ok(`${id}: takes off, flies a circuit and lands on ${map}, stopping on the runway`,
        pilot.ok && !ac.crashed && S.stopAlong < usable && Math.abs(S.stopCross) < half,
        `${Math.round(secs)} s; ${pilot.log.filter((l) => /airborne|final|touchdown|stopped|crash|timed|left/.test(l)).join('; ')}${ac.lastTouchdown ? ` (${ac.lastTouchdown.quality})` : ''}`);
      r.ok(`${id}: no console errors while it flew`, errors.length === errs0, errors.slice(errs0, errs0 + 3).join(' | '));
    }

    /* A giant on a short map: the Free Flight start puts it in the air, and says why. */
    if (await goTo('kestrel')) {
      const notes = [];
      const realNotify = sim.hud.notify.bind(sim.hud);
      sim.hud.notify = (text, ...rest) => { notes.push(String(text)); return realNotify(text, ...rest); };
      try {
        await sim.startMode('free', { aircraft: 'belugaxl', startAt: 'auto', taxi: false, time: 'day', condition: 'clear', windSpeedKts: 0 });
        sim.step(4);
        const ac = sim.aircraft;
        const said = notes.find((t) => /needs about 2,000 m/.test(t));
        r.ok('belugaxl on Kestrel: starts in the air offshore, flying, not on a strip it cannot leave', !ac.crashed && !ac.onGround && ac.agl > 200 && ac.ias > 40,
          `agl ${ac.agl.toFixed(0)} m, ${(ac.ias * KT).toFixed(0)} kt${ac.crashed ? `, ${ac.crashReason}` : ''}`);
        r.ok('belugaxl on Kestrel: and is told it needs a long runway, and where one is', !!said && /in the air/.test(said) && /Gateway International/.test(said), said || notes.slice(-3).join(' | '));
      } catch (e) {
        r.ok('belugaxl on Kestrel: the short-map start', false, String(e && e.message));
      } finally {
        sim.hud.notify = realNotify;
      }
    }
    if (await goTo('gateway')) {
      await sim.startMode('free', { aircraft: 'an225', startAt: 'auto', taxi: false, time: 'day', condition: 'clear', windSpeedKts: 0 });
      sim.step(3);
      const ac = sim.aircraft;
      const st = sim.spawns && sim.spawns.state();
      r.ok('an225 on Gateway: starts on the ground (the open apron: no stand takes 88 m), standing on its wheels',
        !ac.crashed && ac.onGround && !!st && !!st.last && st.last.kind === 'apron', st && st.last ? `${st.last.kind} ${st.last.label}` : 'no spawn');
    }

    /* A remote player's model (features/multiplayer/remotes.js builds it this way) and the wire. */
    for (const id of [...POPULAR, ...GIANTS]) {
      try {
        const t = M.types.getAircraft(id);
        const m = M.adapter.createAircraftModel({ type: t, livery: { id: 'multiplayer', name: 'Multiplayer', base: '#3a7bd5', accent: '#ffffff', cheatline: 'rgba(255,255,255,0.9)', tail: 0x3a7bd5, reg: null } });
        const okModel = !!m.userData.fleetBridge && m.userData.aircraftId === id;
        m.userData.dispose();
        const buf = M.protocol.encodeState({ id: 3, seq: 1, t: 0, pos: { x: 1, y: 2, z: 3 }, quat: { w: 1 }, vel: {}, game: 'flight', type: id });
        const back = M.protocol.decodeStates(buf);
        const typeBack = back && back[0] ? back[0].type : null;
        r.ok(`${id}: a multiplayer remote builds its model in a player's colour, and the type crosses the wire`, okModel && typeBack === id, `model ${okModel}, wire ${typeBack}`);
      } catch (e) {
        r.ok(`${id}: a multiplayer remote builds its model`, false, String(e && e.message));
      }
    }
  } finally {
    sim.override = null;
    sim.renderer.render = realRender;
    sim.autoPauseOnHide = autoPause;
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

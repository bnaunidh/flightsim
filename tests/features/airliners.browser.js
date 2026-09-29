/**
 * The three airliners in the real game: picked, spawned, looked at and flown
 * off the Kestrel runway with the same inputs tests/playtest.js uses.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects. Everything this
 * imports is fetched dynamically and every step is fenced, so a missing piece
 * reports a failure rather than taking the suite down.
 */

const IDS = ['a320', 'b747', 'a380'];
const KT = 1.94384;

export async function check(sim, r, say) {
  let GEO = null;
  let ext = null;
  let FLAPS = null;
  try {
    ({ AIRLINER_GEOMETRY: GEO } = await import('../../src/aircraft/extra/airliners.js'));
    ext = await import('../../src/game/extensions.js');
    ({ TAKEOFF_FLAPS: FLAPS } = await import('../../src/features/airliners.js'));
  } catch (e) {
    r.ok('airliners: modules load', false, String(e && e.message));
    return;
  }
  const status = ext.extStatus().find((e) => e.id === 'airliners');
  r.ok('airliners: feature registered and live', !!(status && status.live),
    status ? '' : 'src/features/airliners.js is not imported by src/features/index.js');
  // physics.js's settleOnGear() solves every type now; the feature's wrapper
  // for these three is gone and nothing may put one back.
  r.ok('airliners: stood on the wheels by the flight model\'s own settle, not a wrapper',
    !!(sim.aircraft && !sim.aircraft.__airlinerSettle && !Object.prototype.hasOwnProperty.call(sim.aircraft, 'settleOnGear')));
  r.ok('airliners: camera stretch installed on the rig', !!(sim.rig && sim.rig.__airlinerStretch));
  try {
    const PROG = await import('../../src/game/progression.js');
    for (const id of IDS) {
      r.ok(`${id}: for sale in the hangar, so it can be picked at all`, PROG.costOf(id) > 0, `${PROG.costOf(id)} credits`);
    }
  } catch (e) {
    r.ok('airliners: progression loads', false, String(e && e.message));
  }

  const before = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  try {
    for (const id of IDS) {
      say(`airliners: ${id}`);
      const g = GEO[id];
      await sim.startMode('free', { aircraft: id, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
      const ac = sim.aircraft;
      r.ok(`${id}: selected`, sim.aircraftType && sim.aircraftType.id === id);
      r.ok(`${id}: drawn by its own hand-built model`, sim.model.userData.aircraftId === id);
      r.ok(`${id}: tyres sit on the physics contact points`, Math.abs(sim.model.userData.groundOffsetY || 0) < 0.05,
        `${(sim.model.userData.groundOffsetY || 0).toFixed(3)} m`);
      r.ok(`${id}: take-off flap set for you on the runway`, ac.flapStep() === FLAPS[id],
        `flaps ${ac.flapStep()}, wanted ${FLAPS[id]}`);
      const cp = sim.cockpit;
      const eye = sim.model.userData.flightGeometry && sim.model.userData.flightGeometry.eye;
      r.ok(`${id}: instrument panel full size and at the pilot's seat`,
        !!cp && Math.abs(cp.scale.x - 1) < 1e-6 && !!eye && Math.abs(cp.position.z - (eye[2] - 0.06)) < 0.01,
        cp ? `scale ${cp.scale.x.toFixed(2)}, z ${cp.position.z.toFixed(2)}` : 'no cockpit');
      sim.step(3);
      /*
       * On its wheels, level, not crashed. Not "not moving": with the parking
       * brake on and the engines at idle every jet in the game creeps — the
       * Meridian measured 1.18 m/s after 3 s, the Tempest 0.91 — because the
       * tyre friction in physics.js is linear in speed and holds nothing at
       * zero. These do the same (1.3-1.5 m/s), so the bound is the Meridian's
       * behaviour with room, not zero.
       */
      r.ok(`${id}: stands on its wheels after spawning`,
        !ac.crashed && ac.onGround && Math.abs(ac.pitchAngleDeg()) < 2 && ac.groundSpeed < 2.5,
        ac.crashed ? ac.crashReason : `pitch ${ac.pitchAngleDeg().toFixed(2)} deg, creeping ${ac.groundSpeed.toFixed(2)} m/s`);

      // The chase view has to be outside the aeroplane, behind the fin.
      sim.rig.setMode('chase');
      sim.step(1.5);
      const d = sim.camera.position.distanceTo(ac.pos);
      r.ok(`${id}: follow camera stands clear of the tail`, d > (g.length + g.noseZ) + 4,
        `${d.toFixed(1)} m from the centre of gravity, tail ${(g.length + g.noseZ).toFixed(1)} m back`);

      // Take-off: full power with the flap the game set, rotate at 1.25 x the
      // approach speed — what a player who touches nothing but the throttle
      // and the stick gets.
      const { performanceFor } = await import('../../src/aircraft/types.js');
      const vr = performanceFor(id).stallLanding * 1.25;
      sim.override = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
      let at15 = null;
      for (let t = 0; t < 70 && at15 === null && !ac.crashed; t += 0.2) {
        if (ac.onGround) sim.override.pitch = ac.ias * KT > vr ? 0.45 : 0;
        else sim.override.pitch = Math.max(-0.5, Math.min(0.6, (10 - ac.pitchAngleDeg()) * 0.05));
        sim.step(0.2);
        if (!ac.onGround && ac.agl > 15 + Math.abs(g.ground)) at15 = ac.pos.x + 470;
      }
      sim.override = null;
      r.ok(`${id}: takes off inside the 1,100 m runway`, !ac.crashed && at15 !== null && at15 < 1020,
        ac.crashed ? ac.crashReason : `15 m up at ${at15 === null ? 'never' : Math.round(at15)} m from brake release`);
    }
  } finally {
    sim.override = null;
    sim.autoPauseOnHide = autoPause;
    try {
      sim.setAircraft(before);
    } catch (e) {
      /* the suite restores its own state after this */
    }
  }
}

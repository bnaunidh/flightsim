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

    /*
     * The stretched follow view and a crash, with Reduce flashing (the
     * default) and without. The rig stops its own camera for a wreck; the
     * stretch used to scale about the rig's moving look-at point and turned
     * the A380's slow pitch-over into a steady 6 m/s camera descent (25-42%
     * of a 10-degree field in the crash sweep). Now it scales about a point
     * held at the crash, and stands CRASH_BACK_REDUCED times further back,
     * eased in over CRASH_BACK_EASE s. With the switch off it follows the
     * wreck as it always did.
     */
    say('airliners: the follow view and a crash');
    {
      const cr = await import('../../src/features/crashes.js');
      const AL = await import('../../src/features/airliners.js');
      const reduceWas = sim.settings.reduceFlashing;
      const comicWas = sim.settings.comicEffects;
      const noDebrief = () => clearTimeout(sim._crashDebriefT);
      const crashWatched = async (reduce) => {
        sim.applySetting('reduceFlashing', reduce);
        sim.applySetting('comicEffects', false);
        await sim.startMode('free', { aircraft: 'a380', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0 });
        sim.step(0.3);
        sim.rig.setMode('chase');
        sim.step(1);
        const staged = cr.stageCrash(sim, 'noseplant');
        noDebrief();
        sim.rig.initialised = false;
        sim.step(1 / 60);
        noDebrief();
        const d0 = sim.camera.position.distanceTo(sim.rig.lookAt);
        sim.step(AL.CRASH_BACK_EASE + 0.9);
        noDebrief();
        const d1 = sim.camera.position.distanceTo(sim.rig.lookAt);
        const last = sim.camera.position.clone();
        const from = last.clone();
        let moved = 0;
        for (let i = 0; i < 30; i++) {
          sim.step(1 / 30);
          noDebrief();
          moved = Math.max(moved, sim.camera.position.distanceTo(last));
          last.copy(sim.camera.position);
        }
        // Net travel over that second, not the largest step: a piece landing
        // kicks the rig's shake (stretched with the view, a few tenths of a
        // metre and back), which is not the camera going anywhere.
        const drift = sim.camera.position.distanceTo(from);
        // The instant replay closing starts the rig's view again over the
        // wreck (rig.initialised = false): the stretch must scale about the
        // new look-at point, not the one held from before (that left the
        // A380's view 21 m from its centre, inside the wreck).
        let dReplay = null;
        let offLine = null;
        const BU = await import('../../src/features/breakup.js');
        if (reduce && BU.canReplay() && BU.startReplay(sim, false)) {
          for (let i = 0; i < 900 && BU.breakupDebug().replaying; i++) {
            sim.step(1 / 30);
            noDebrief();
          }
          if (BU.breakupDebug().replaying) BU.endReplay(sim, false);
          sim.step(1 / 30);
          noDebrief();
          dReplay = sim.camera.position.distanceTo(sim.aircraft.pos);
          // On the rig's own line through its look-at point, stood back
          // k x CRASH_BACK_REDUCED (level parts only: the height is lifted
          // and floored). Scaled about the stale point it is off that line by
          // (k x back - 1) times however far the wreck's centre went.
          const s = AL.viewScale('a380') * AL.CRASH_BACK_REDUCED;
          const ux = sim.camera.position.x - sim.rig.lookAt.x;
          const uz = sim.camera.position.z - sim.rig.lookAt.z;
          const vx = (sim.rig.chasePos.x - sim.rig.lookAt.x) * s;
          const vz = (sim.rig.chasePos.z - sim.rig.lookAt.z) * s;
          offLine = Math.hypot(ux - vx, uz - vz);
        }
        return { staged: !!staged, crashed: !!sim.aircraft.crashed, d0, d1, moved, drift, dReplay, offLine };
      };
      try {
        const on = await crashWatched(true);
        r.ok('a380: with Reduce flashing the follow view stands still for the wreck (the stretch no longer turns the look-at point’s drift into camera travel)',
          on.staged && on.crashed && on.drift < 0.75, `${on.staged ? 'crashed' : 'no crash staged'}; went ${on.drift.toFixed(2)} m in the second from 1.5 s after the crash (it used to sink about 6 m/s; largest step ${on.moved.toFixed(3)} m)`);
        r.ok(`a380: …and has stood back ${AL.CRASH_BACK_REDUCED}x from the wreck by then`,
          on.staged && Math.abs(on.d1 / on.d0 - AL.CRASH_BACK_REDUCED) < 0.15, `${on.d0.toFixed(1)} m on the first frame, ${on.d1.toFixed(1)} m after ${(AL.CRASH_BACK_EASE + 0.9).toFixed(1)} s (${(on.d1 / on.d0).toFixed(2)}x)`);
        r.ok('a380: …and after the instant replay the follow view comes back stood off from the wreck, not inside it',
          on.dReplay !== null && on.dReplay > 0.6 * on.d0 && on.dReplay < 3 * on.d0 && on.offLine < 3,
          on.dReplay === null ? 'no replay' : `${on.dReplay.toFixed(1)} m from the wreck's centre after the replay (first frame ${on.d0.toFixed(1)} m), ${on.offLine.toFixed(2)} m off the rig's line`);
        const off = await crashWatched(false);
        r.ok('a380: …with it off the follow view goes with the wreck as it always did', off.staged && off.crashed && off.moved > 0.01 && Math.abs(off.d1 / off.d0 - 1) < 0.2,
          `moved ${off.moved.toFixed(3)} m a frame; ${off.d0.toFixed(1)} m then ${off.d1.toFixed(1)} m (${(off.d1 / off.d0).toFixed(2)}x)`);
      } finally {
        noDebrief();
        if (sim.settings.reduceFlashing !== reduceWas) sim.applySetting('reduceFlashing', reduceWas !== false);
        if (sim.settings.comicEffects !== comicWas) sim.applySetting('comicEffects', comicWas === true);
      }
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

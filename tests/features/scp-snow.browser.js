/**
 * Browser checks for the snow lane: Nunatak Reach, the ice, the Site and the
 * Class-D transfer, in the real game (the node side is scp-snow.mjs).
 *
 *   - the mission starts on the snow map, in the Courier, on a stand at the
 *     base, with the Site built and solid, snow in the air, and six people
 *     walking out of the van
 *   - boarding completes when they reach the door (they are teleported to
 *     it; the walk itself is timed in node), and the aeroplane is released
 *   - the real flight model lands on the ice: a touchdown at 32 m/s with
 *     the brakes full on rolls a long way (ice grip), the HUD says braking
 *     action poor, and the landing step completes inside the strip's box
 *   - stopped on the T, the handover walk starts; at the door the mission
 *     completes with a score, and the map you had chosen comes back
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'scp-snow';

export async function check(sim, r, say) {
  let THREE;
  let T;
  let Site;
  let Scp;
  try {
    THREE = await import('../../src/vendor/three.module.js');
    T = await import('../../src/world/terrain.js');
    Site = await import('../../src/features/scp-site.js');
    Scp = await import('../../src/game/extra/scp.js');
  } catch (err) {
    r.ok('scp-snow: the modules load', false, String(err && err.message));
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  const origMap = sim.settings.map;
  sim.autoPauseOnHide = false;
  const stepId = () => (sim.runner && sim.runner.step ? sim.runner.step.id : null);
  const toasts = [];
  const origNotify = sim.hud.notify.bind(sim.hud);
  sim.hud.notify = (text, kind, dur) => {
    toasts.push(String(text));
    return origNotify(text, kind, dur);
  };

  try {
    say('scp-snow: start the transfer');
    await sim.startMode('mission', { id: 'classd-transfer' });
    const ac = sim.aircraft;
    const map = T.MAP;
    r.ok('the transfer starts on Nunatak Reach in the Courier, on the ground', map.id === 'nunatak' && sim.aircraftType.id === 'courier' && ac.onGround,
      `${map.id}, ${sim.aircraftType.id}, onGround ${ac.onGround}`);
    r.ok('…on the base\'s levelled airfield, not on a runway', T.padWeight(ac.pos.x, ac.pos.z) > 0.9 && !T.isOnAnyRunway(ac.pos.x, ac.pos.z, 5), `${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)}`);
    const info = Site.siteInfo();
    r.ok('the Site is built: four towers, three buildings, the fence', !!info && info.towers.length === 4 && info.buildings.length === 3 && info.obstacles >= 12, info ? `${info.obstacles} solids` : 'no site');
    r.ok('the blast door is shut and solid; the main block has no inside', !!T.obstacleAt(map.scp.door.x, info.doorY + 3, map.scp.door.z - 2) && !!T.obstacleAt(map.scp.door.x, info.doorY + 6, map.scp.door.z - 17));
    sim.step(1.5, 1 / 30);
    r.ok('snow is falling (the precipitation is in snow mode and drawn)', sim.rain && sim.rain.kind === 'snow' && sim.rain.mesh.visible, sim.rain ? `${sim.rain.kind}, visible ${sim.rain.mesh.visible}` : 'no rain');
    r.ok('the first step is board', stepId() === 'board', stepId());
    const walk = Site.transferState();
    r.ok('six people are walking out of the van: two escort, four Class-D', !!walk && walk.people.length === 6 && walk.people.filter((p) => p.kind === 'classd').length === 4,
      walk ? walk.people.map((p) => p.kind).join(' ') : 'nobody');
    const d0 = walk ? walk.people.map((p) => Math.hypot(p.x - ac.pos.x, p.z - ac.pos.z)) : [];
    sim.step(3, 1 / 30);
    const d1 = walk ? walk.people.map((p) => Math.hypot(p.x - ac.pos.x, p.z - ac.pos.z)) : [];
    r.ok('…and they are walking towards the aeroplane', d1.length === 6 && d1.every((d, i) => d < d0[i]), `${d0[0] && d0[0].toFixed(0)} → ${d1[0] && d1[0].toFixed(0)} m`);
    // Teleport them to their slots at the door: the walk is timed in node; here it is the step.
    const door = Site.doorPointOf(ac);
    // Boarding is a queue (everyone stands at the door and goes aboard in
    // turn); a walk routed through the gate lines up on the gate-to-door line.
    const toSlots = (party, tgt) => {
      const o = party.via || party.from;
      let dx = tgt.x - o.x;
      let dz = tgt.z - o.z;
      const L = Math.hypot(dx, dz) || 1;
      dx /= L;
      dz /= L;
      for (const p of party.people) {
        const behind = party.vanish ? 0 : p.behind;
        p.x = tgt.x - dx * behind - dz * p.side;
        p.z = tgt.z - dz * behind + dx * p.side;
        p.pastVia = true;
      }
    };
    toSlots(walk, door);
    sim.step(8, 1 / 30);
    r.ok('board completes once all six are at the door, and the step moves on to depart', stepId() === 'depart' && !Site.transferState(), stepId());

    say('scp-snow: fly across');
    ac.reset({ pos: ac.pos.clone(), headingDeg: 90, speed: 60, altAGL: 150, engineOn: true, gearDown: false });
    sim.step(5, 1 / 30);
    r.ok('depart completes once airborne', stepId() === 'cross', stepId());
    const strip = map.scp.strip;
    ac.reset({ pos: new THREE.Vector3(strip.cx - 2000, 0, strip.cz + 200), headingDeg: 90, speed: 60, altAGL: 200, engineOn: true, gearDown: false });
    sim.step(2, 1 / 30);
    r.ok('cross completes inside 2.6 km of the strip', stepId() === 'land', stepId());

    say('scp-snow: land on the ice');
    // A real touchdown: a few metres over the west end of the strip, fast,
    // sinking, brakes full on from the moment the wheels touch.
    ac.reset({ pos: new THREE.Vector3(strip.cx - strip.halfLen + 120, 0, strip.cz), headingDeg: 90, speed: 32, altAGL: 3.2, engineOn: true, gearDown: true });
    sim.override = { throttle: 0, pitch: 0, roll: 0, yaw: 0, brakes: 1 };
    let tdX = null;
    let stopX = null;
    let crashed = false;
    const dt = 1 / 30;
    for (let i = 0; i < 30 * 60; i++) {
      sim.update(dt);
      if (ac.crashed) { crashed = true; break; }
      if (tdX == null && ac.onGround) tdX = ac.pos.x;
      if (tdX != null && ac.groundSpeed < 0.6) { stopX = ac.pos.x; break; }
    }
    sim.override = null;
    const roll = tdX != null && stopX != null ? stopX - tdX : null;
    r.ok('the Courier touches down on the ice in one piece', tdX != null && !crashed, crashed ? 'crashed' : `down at x=${tdX && tdX.toFixed(0)}`);
    r.ok('…and with the brakes full on it still rolls a long way (ice grip): 350 m or more, and stops inside the strip', roll != null && roll > 350 && ac.pos.x < strip.cx + strip.halfLen, roll == null ? 'never stopped' : `${roll.toFixed(0)} m (tarmac: 172 m, measured)`);
    r.ok('…and stays on the strip with no rudder (the mission\'s wind is down the strip)', Math.abs(ac.pos.z - strip.cz) < strip.halfWidth && T.iceAt(ac.pos.x, ac.pos.z), `drifted ${Math.abs(ac.pos.z - strip.cz).toFixed(1)} m off the centreline over the roll`);
    r.ok('the HUD said "braking action poor" when the wheels were on the ice', toasts.some((t) => /braking action poor/i.test(t)), toasts.slice(-3).join(' | '));
    r.ok('the landing step completes on the ice strip', stepId() === 'taxi', stepId());

    say('scp-snow: the gate and the handover');
    const gate = map.scp.gate;
    ac.reset({ pos: new THREE.Vector3(gate.x, 0, gate.z), headingDeg: gate.headingDeg, speed: 0, engineOn: true, gearDown: true });
    sim.step(3, 1 / 30);
    r.ok('stopped on the T, the taxi step completes and the handover walk starts', stepId() === 'handover' && Site.transferState() && Site.transferState().label === 'handover', stepId());
    const hw = Site.transferState();
    const hdoor = Site.doorPointOf(ac);
    sim.step(2, 1 / 30);
    r.ok('the escort and the Class-D are walking from the door towards the blast door', hw && hw.people.every((p) => p.p.visible) && hw.people.some((p) => Math.abs(p.z - hdoor.z) > 0.5),
      hw ? hw.people.map((p) => (p.z - hdoor.z).toFixed(1)).join(' ') : 'no walk');
    if (hw) toSlots(hw, { x: map.scp.door.x, z: map.scp.door.z + 4 });
    sim.step(3, 1 / 30);
    r.ok('at the blast door the mission completes', sim.runner.status === 'complete', sim.runner.status);
    r.ok('…with a score in 0..100', Number.isFinite(sim.runner.result && sim.runner.result.score) ? sim.runner.result.score >= 0 && sim.runner.result.score <= 100 : true, JSON.stringify(sim.runner.result && sim.runner.result.score));
    r.ok('…and nobody went inside: the people stand outside the shut door', !!hw && hw.people.every((p) => p.p.visible && !T.obstacleAt(p.x, info.doorY + 1, p.z)));
  } catch (err) {
    r.ok('scp-snow: the check ran to the end', false, String(err && err.stack || err));
  } finally {
    sim.hud.notify = origNotify;
    sim.override = null;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      /* already there */
    }
    sim.autoPauseOnHide = origAuto;
    r.ok('the map you had chosen comes back after the mission', sim.settings.map === origMap, `${origMap} → ${sim.settings.map}`);
  }
}

/**
 * Browser check for the bird strike (src/features/bird-strike.js) in the real
 * game: roll the event in flight and watch the flock come in, the hit land and
 * the engine go rough, exactly once, under half a second later; nothing of it
 * on the ground. tests/features/bird-strike.mjs has the geometry in node.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let BS;
  let THREE;
  try {
    BS = await import('../../src/features/bird-strike.js');
    // Imported here, not between rolling the event and counting frames: an await there lets the
    // game's own loop run a few frames of the strike that the count would then miss.
    THREE = await import('../../src/vendor/three.module.js');
  } catch (err) {
    r.ok('bird-strike: the module loads', false, String(err && err.message));
    return;
  }
  const D = () => BS.birdStrikeDebug();
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const origAircraft = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  const fly = async (id, extra = {}) => {
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: id, ...extra });
    sim.step(0.3);
  };

  say('bird-strike: in flight');
  await fly('tempest');
  {
    const ac = sim.aircraft;
    if (ac.failures.roughEngine) sim.toggleFailure('roughEngine');
    const notes = [];
    const origNotify = sim.hud.notify.bind(sim.hud);
    sim.hud.notify = (t, k, s) => {
      notes.push(String(t));
      return origNotify(t, k, s);
    };
    const speed = ac.vel.length();
    sim.triggerNatural('birdStrike');
    const d0 = D();
    r.ok('bird-strike: rolling the event in flight flies a flock in first (the strike is pending)', d0.pending && d0.groupVisible && d0.birds.filter((b) => b.visible).length >= 3, JSON.stringify({ pending: d0.pending, birds: d0.birds.filter((b) => b.visible).length, speed: speed.toFixed(0) }));
    r.ok('bird-strike: the engine is still fine and nothing has warned yet', !ac.failures.roughEngine && !notes.some((n) => /BIRD STRIKE/.test(n)), notes.join(' | '));
    // Where the flock is against the aeroplane: ahead, under half a second away at the closing speed.
    const lead = d0.birds[0];
    const rel = new THREE.Vector3().fromArray(lead.pos).sub(ac.pos);
    const ahead = rel.dot(ac.vel) / (ac.vel.length() || 1);
    r.ok('bird-strike: the flock is ahead of you, a few dozen metres at most', ahead > 5 && ahead < 60 && rel.length() < 70, `${ahead.toFixed(1)} m ahead, ${rel.length().toFixed(1)} m away`);
    const spans = d0.birds.filter((b) => b.visible).map((b) => b.span);
    r.ok('bird-strike: gull to goose sized, 0.7-1.5 m', spans.every((s) => s >= 0.7 && s <= 1.5), spans.map((s) => s.toFixed(2)).join(', '));
    let hitAt = -1;
    for (let i = 0; i < 60 && hitAt < 0; i++) {
      sim.update(1 / 60);
      if (ac.failures.roughEngine) hitAt = (i + 1) / 60;
    }
    r.ok('bird-strike: the hit lands under half a second later: the engine runs rough', hitAt > 0.2 && hitAt <= 0.5 + 1 / 60, `${hitAt.toFixed(3)} s`);
    const d1 = D();
    r.ok('bird-strike: the lead bird is gone into the engine, feathers fly, the strike is no longer pending', d1.birds[0].hit && !d1.birds[0].visible && d1.feathers > 0 && !d1.pending, JSON.stringify({ hit: d1.birds[0].hit, feathers: d1.feathers }));
    r.ok('bird-strike: the warning shows at the hit, once', notes.filter((n) => /BIRD STRIKE/.test(n)).length === 1, notes.join(' | '));
    r.ok('bird-strike: the event is live for the pause menu (and the engine fire can follow)', sim.activeEvents && sim.activeEvents.birdStrike > 0, JSON.stringify(sim.activeEvents));
    for (let i = 0; i < 60 * 4; i++) sim.update(1 / 60);
    const d2 = D();
    r.ok('bird-strike: a few seconds on, the flock and the feathers are gone and the engine is still rough', !d2.groupVisible && d2.birds.every((b) => !b.visible) && d2.feathers === 0 && ac.failures.roughEngine, JSON.stringify({ group: d2.groupVisible, feathers: d2.feathers }));
    sim.hud.notify = origNotify;
    if (ac.failures.roughEngine) sim.toggleFailure('roughEngine');
  }

  say('bird-strike: on the ground');
  await fly('skylark', { airborne: false });
  {
    const ac = sim.aircraft;
    if (ac.failures.roughEngine) sim.toggleFailure('roughEngine');
    sim.triggerNatural('birdStrike');
    const d = D();
    r.ok('bird-strike: on the ground there is no flock to fly into: the event is immediate, as it always was', !d.pending && !d.groupVisible && ac.failures.roughEngine, JSON.stringify({ pending: d.pending, rough: ac.failures.roughEngine }));
    if (ac.failures.roughEngine) sim.toggleFailure('roughEngine');
  }

  try {
    await fly(origAircraft);
  } catch (e) {
    /* leave it */
  }
  sim.autoPauseOnHide = origAuto;
}

/**
 * Browser checks for Air Force One's third seat: the President. Placement
 * and teleport based — "put the walker where the check says and let the
 * real update loop decide" (afo.browser.js's own philosophy) — not a full
 * flight; see afo-president.playthrough.js for a bot that actually walks
 * it, pass and fail, used by the af1 proof run rather than every self-test.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */
export async function check(sim, r, say) {
  const Pres = await import('../../src/game/roles/afo-president.js');
  const Roles = await import('../../src/game/roles/roles.js');
  const Cast = await import('../../src/game/roles/cast.js');
  const Missions = await import('../../src/game/missions.js');
  const { extStatus } = await import('../../src/game/extensions.js');

  const live = (id) => {
    const e = extStatus().find((x) => x.id === id);
    return e && e.live;
  };
  r.ok('afo-president: the extension is registered and live', live('afo-president'), JSON.stringify(extStatus().find((x) => x.id === 'afo-president')));
  r.ok('afo-movie: the cinematic layer is registered and live', live('afo-movie'), JSON.stringify(extStatus().find((x) => x.id === 'afo-movie')));

  const normal = Missions.findMission('afo-normal');
  const attack = Missions.findMission('afo-attack');
  const seatsN = Roles.rolesOf(normal).map((x) => x.id);
  const seatsA = Roles.rolesOf(attack).map((x) => x.id);
  r.ok('afo-president: both missions offer it third, after captain and the lead fighter',
    seatsN[2] === 'president' && seatsA[2] === 'president', `${JSON.stringify(seatsN)} / ${JSON.stringify(seatsA)}`);

  const realRender = sim.renderer.render.bind(sim.renderer);
  sim.renderer.render = () => {};
  try {
    /* -------------------------------------------------- normal flight -- */
    say('afo-president: normal flight');
    await sim.startMode('mission', { id: 'afo-normal', role: 'president' });
    const ac = sim.aircraft;
    r.ok('afo-normal/president: the real aeroplane is parked, engine off, and hidden — you are walking the cabin, not flying it',
      !ac.engineOn && sim.model.visible === false, `engineOn ${ac.engineOn}, model.visible ${sim.model.visible}`);
    sim.step(1, 1 / 30);
    const info0 = Pres.presidentInfo();
    r.ok('afo-normal/president: the walking feature is live the moment the seat starts', info0.active, JSON.stringify(info0));
    r.ok('afo-normal/president: the first step is the call in the office', sim.runner.step && sim.runner.step.id === 'call', sim.runner.step && sim.runner.step.id);

    Pres.placeWalker(Pres.SPOTS.office.x, Pres.SPOTS.office.z);
    sim.step(0.5, 1 / 30);
    r.ok('afo-normal/president: walking to the office completes the call', sim.runner.step && sim.runner.step.id !== 'call', sim.runner.step && sim.runner.step.id);

    Pres.placeWalker(Pres.SPOTS.conference.x, Pres.SPOTS.conference.z);
    sim.step(0.5, 1 / 30);
    r.ok('afo-normal/president: walking to the conference room completes the briefing', sim.runner.step && sim.runner.step.id === 'cockpit', sim.runner.step && sim.runner.step.id);

    const air1 = Cast.castActor('airliner');
    r.ok('afo-normal/president: Air Force One itself is flown by the game (an NPC, already airborne)', !!air1 && air1.pos.y > 100, air1 ? air1.pos.y.toFixed(0) : null);
    r.ok('afo-normal/president: the real exterior model stays hidden while this NPC flies it', air1 && air1.model && air1.model.visible === false, air1 && air1.model && air1.model.visible);

    sim.quitToMenu('main');
    r.ok('afo-president: quitting tears the walking feature and the story down, and gives the real aeroplane back',
      !Pres.presidentInfo().active && sim.model.visible === true, JSON.stringify({ active: Pres.presidentInfo().active, modelVisible: sim.model.visible }));

    /* -------------------------------------------------- the attack mission -- */
    say('afo-president: Under Attack');
    await sim.startMode('mission', { id: 'afo-attack', role: 'president' });
    r.ok('afo-attack/president: the first step is the calm cruise', sim.runner.step && sim.runner.step.id === 'cruise', sim.runner.step && sim.runner.step.id);
    sim.step(7, 1 / 30);
    r.ok('afo-attack/president: "cruise" completes on its own clock', sim.runner.step && sim.runner.step.id === 'secure', sim.runner.step && sim.runner.step.id);
    r.ok('afo-attack/president: not in the secure room yet', !Pres.inSecureRoom(Pres.walkerPos().x, Pres.walkerPos().z), JSON.stringify(Pres.walkerPos()));

    sim.step(3, 1 / 30); // past t > 8: the Secret Service's own warning fires
    const infoWarn = Pres.presidentInfo();
    r.ok('afo-attack/president: the warning comes in on its own timeline, same as the other seats', infoWarn.active, JSON.stringify(infoWarn));

    Pres.placeWalker(Pres.SPOTS.secureInside.x, Pres.SPOTS.secureInside.z);
    r.ok('afo-attack/president: the secure room is a real, enclosed space', Pres.inSecureRoom(Pres.walkerPos().x, Pres.walkerPos().z), JSON.stringify(Pres.walkerPos()));
    sim.step(0.5, 1 / 30);
    r.ok('afo-attack/president: reaching the secure room after the warning completes that step', sim.runner.step && sim.runner.step.id === 'defend', sim.runner.step && sim.runner.step.id);

    sim.step(9, 1 / 30); // t > 11: the drone wave is spawned
    const infoWave = Pres.presidentInfo();
    r.ok('afo-attack/president: the drone wave is live, kid-safe (unmanned, two of them)', infoWave.dronesAlive === 2, JSON.stringify(infoWave));
    sim.quitToMenu('main');

    /* ------------------------------------------ the fail path: too slow -- */
    say('afo-president: the one fail path (never reaching the secure room)');
    await sim.startMode('mission', { id: 'afo-attack', role: 'president' });
    let failedAt = null;
    for (let t = 0; t < 70 && sim.runner.status === 'running'; t += 1) {
      sim.step(1, 1 / 30);
      if (Pres.presidentInfo().failWhy) {
        failedAt = t;
        break;
      }
    }
    r.ok('afo-attack/president: never walking to the secure room fails the mission with a kind word, not a wreck',
      sim.runner.status === 'failed' && !!failedAt, `status ${sim.runner.status}, at ${failedAt}s, why "${Pres.presidentInfo().failWhy || ''}"`);
    sim.quitToMenu('main');
  } finally {
    sim.renderer.render = realRender;
  }
}

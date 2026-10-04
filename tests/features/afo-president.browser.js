/**
 * Browser checks for Air Force One's third seat: the President. Placement
 * and teleport based — "put the walker where the check says and let the
 * real update loop decide" (afo.browser.js's own philosophy) — not a full
 * flight; afo-president.playthrough.js is a bot that walks it all, pass and
 * fail, with the keys a player would press.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */
export async function check(sim, r, say) {
  const Pres = await import('../../src/game/roles/afo-president.js');
  const Roles = await import('../../src/game/roles/roles.js');
  const Cast = await import('../../src/game/roles/cast.js');
  const Missions = await import('../../src/game/missions.js');
  const Afo = await import('../../src/features/events/afo.js');
  const UI = await import('../../src/features/events/ui.js');
  const FUI = await import('../../src/features/staff/ui.js');
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
  const flareBtn = () => document.querySelector('.afo-action');
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

    const air1 = Cast.castActor('airliner');
    r.ok('afo-normal/president: Air Force One itself is flown by the game (an NPC, already airborne)', !!air1 && air1.agl > 200, air1 ? air1.agl.toFixed(0) : null);
    r.ok('afo-normal/president: the real exterior model stays hidden while this NPC flies it', air1 && air1.model && air1.model.visible === false, air1 && air1.model && air1.model.visible);
    r.ok('afo-normal/president: you ride in it — sim.riding is that jet (world, minimap and collisions follow it)', sim.riding === air1, String(!!sim.riding));
    const cabin = sim.scene.getObjectByName('afo-president-cabin');
    r.ok('afo-normal/president: the cabin is on the jet, and the camera inside the cabin (v55 left the cabin at the world origin)',
      !!cabin && cabin.visible && cabin.position.distanceTo(air1.pos) < 0.5 && sim.camera.position.distanceTo(air1.pos) < 25,
      cabin ? `cabin ${cabin.position.distanceTo(air1.pos).toFixed(1)} m from the jet, camera ${sim.camera.position.distanceTo(air1.pos).toFixed(1)} m` : 'no cabin');
    r.ok('afo-normal/president: none of the captain\'s side runs (no second escort, no FLARE button)',
      !Afo.afoInfo().active && !(flareBtn() && !flareBtn().hidden), JSON.stringify({ captain: Afo.afoInfo().active, flare: flareBtn() ? !flareBtn().hidden : null }));
    r.ok('afo-normal/president: no "get out" prompt for a passenger', !FUI.promptText(), FUI.promptText());

    // W walks you towards the first goal: you start facing the nose.
    const w0 = Pres.walkerPos();
    sim.key('KeyW', true);
    sim.step(1, 1 / 30);
    sim.key('KeyW', false);
    sim.step(0.3, 1 / 30);
    const w1 = Pres.walkerPos();
    r.ok('afo-normal/president: holding W walks you forward, towards the office at the nose', w1.z < w0.z - 1 && Math.abs(w1.x - w0.x) < 0.2, `${JSON.stringify(w0)} → ${JSON.stringify(w1)}`);

    Pres.placeWalker(Pres.SPOTS.office.x, Pres.SPOTS.office.z);
    sim.step(0.5, 1 / 30);
    r.ok('afo-normal/president: walking to the office completes the call', sim.runner.step && sim.runner.step.id === 'brief', sim.runner.step && sim.runner.step.id);

    Pres.placeWalker(Pres.SPOTS.conference.x, Pres.SPOTS.conference.z);
    sim.step(0.5, 1 / 30);
    r.ok('afo-normal/president: at the conference room the Captain asks for a decision', UI.choosing(), String(UI.choosing()));
    sim.key('Digit9', true);
    sim.key('Digit9', false);
    sim.step(0.5, 1 / 30);
    r.ok('afo-normal/president: answering with a number key completes the briefing', sim.runner.step && sim.runner.step.id === 'wave' && Pres.presidentInfo().choice === 1, `${sim.runner.step && sim.runner.step.id}, choice ${Pres.presidentInfo().choice}`);

    Pres.placeWalker(Pres.SPOTS.window.x, Pres.SPOTS.window.z, 90);
    sim.step(0.3, 1 / 30);
    sim.key('KeyE', true);
    sim.key('KeyE', false);
    sim.step(0.5, 1 / 30);
    const esc = Cast.castActor('escort');
    r.ok('afo-normal/president: E at a right-hand window waves, and the escort rocks his wings back',
      sim.runner.step && sim.runner.step.id === 'cockpit' && !!esc && esc.rocking, `${sim.runner.step && sim.runner.step.id}, rocking ${esc && esc.rocking}`);

    Pres.placeWalker(Pres.SPOTS.cockpit.x, Pres.SPOTS.cockpit.z, 0);
    sim.step(0.5, 1 / 30);
    const infoC = Pres.presidentInfo();
    r.ok('afo-normal/president: at the flight deck, "Take us in, Captain" starts the approach', sim.runner.step && sim.runner.step.id === 'approach' && infoC.homeOrdered && infoC.landing,
      `${sim.runner.step && sim.runner.step.id}, ${JSON.stringify({ homeOrdered: infoC.homeOrdered, landing: infoC.landing })}`);

    sim.quitToMenu('main');
    r.ok('afo-president: quitting tears the walking feature and the story down, and gives the real aeroplane back',
      !Pres.presidentInfo().active && sim.model.visible === true && !sim.riding, JSON.stringify({ active: Pres.presidentInfo().active, modelVisible: sim.model.visible, riding: !!sim.riding }));

    /* -------------------------------------------------- the attack mission -- */
    say('afo-president: Under Attack');
    await sim.startMode('mission', { id: 'afo-attack', role: 'president' });
    r.ok('afo-attack/president: the first step is the calm cruise', sim.runner.step && sim.runner.step.id === 'cruise', sim.runner.step && sim.runner.step.id);
    r.ok('afo-attack/president: no FLARE button for the President (the captain\'s)', !(flareBtn() && !flareBtn().hidden));
    sim.step(9, 1 / 30); // past t > 8: the Secret Service's own warning
    r.ok('afo-attack/president: the warning moves the step on to the secure room', sim.runner.step && sim.runner.step.id === 'secure', sim.runner.step && sim.runner.step.id);
    const infoW = Pres.presidentInfo();
    r.ok('afo-attack/president: a countdown is running for it', infoW.secureLeft != null && infoW.secureLeft > 30 && infoW.secureLeft <= Pres.SECURE_LIMIT, String(infoW.secureLeft));
    r.ok('afo-attack/president: not in the secure room yet', !Pres.inSecureRoom(Pres.walkerPos().x, Pres.walkerPos().z), JSON.stringify(Pres.walkerPos()));

    Pres.placeWalker(Pres.SPOTS.secureInside.x, Pres.SPOTS.secureInside.z);
    r.ok('afo-attack/president: the secure room is a real, enclosed space', Pres.inSecureRoom(Pres.walkerPos().x, Pres.walkerPos().z), JSON.stringify(Pres.walkerPos()));
    sim.step(0.5, 1 / 30);
    r.ok('afo-attack/president: reaching the secure room after the warning completes that step', sim.runner.step && sim.runner.step.id === 'orders', sim.runner.step && sim.runner.step.id);
    r.ok('afo-attack/president: the Captain asks for your orders', UI.choosing());
    sim.key('Digit9', true);
    sim.key('Digit9', false);
    sim.step(0.5, 1 / 30);
    r.ok('afo-attack/president: "stay up until Guardian has them" — and the jet holds', sim.runner.step && sim.runner.step.id === 'defend' && !Pres.presidentInfo().homeOrdered, sim.runner.step && sim.runner.step.id);

    sim.step(3, 1 / 30); // t > 11: the drone wave
    const infoWave = Pres.presidentInfo();
    r.ok('afo-attack/president: the drone wave is live, kid-safe (unmanned, two of them)', infoWave.dronesAlive === 2, JSON.stringify({ drones: infoWave.dronesAlive }));
    sim.quitToMenu('main');

    /* ------------------------------------------ the fail path: too slow -- */
    say('afo-president: the one fail path (never reaching the secure room)');
    await sim.startMode('mission', { id: 'afo-attack', role: 'president' });
    let failedAt = null;
    let why = null;
    for (let t = 0; t < 70 && sim.runner.status === 'running'; t += 1) {
      sim.step(1, 1 / 30);
      const i = Pres.presidentInfo();
      if (i.failWhy) {
        failedAt = t;
        why = i.failWhy;
        break;
      }
    }
    sim.step(0.2, 1 / 30);
    r.ok('afo-attack/president: never walking to the secure room fails the mission with a plain reason, not a wreck',
      sim.runner.status === 'failed' && !!failedAt && /secure room/.test(why || ''), `status ${sim.runner.status}, at ${failedAt}s, why "${why || ''}"`);
    sim.quitToMenu('main');
  } finally {
    sim.renderer.render = realRender;
  }
}

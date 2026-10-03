/**
 * Browser checks for Air Force One: both missions, both seats, on the real
 * game. Placement-based and quick — "put the aeroplane where the check
 * says and let the real update loop decide" (events.browser.js's own
 * philosophy) — not a full flight; see afo.playthrough.js for a bot that
 * actually flies each one, pass and fail, used by the af1 proof run rather
 * than every self-test.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */
export async function check(sim, r, say) {
  const THREE = await import('../../src/vendor/three.module.js');
  const AfoFeat = await import('../../src/features/events/afo.js');
  const AfoLead = await import('../../src/game/roles/afo-lead.js');
  const Roles = await import('../../src/game/roles/roles.js');
  const Cast = await import('../../src/game/roles/cast.js');
  const Missions = await import('../../src/game/missions.js');
  const Prog = await import('../../src/game/progression.js');
  const { extStatus } = await import('../../src/game/extensions.js');

  const live = () => {
    const e = extStatus().find((x) => x.id === 'afo');
    return e && e.live;
  };
  r.ok('afo: the extension is registered and live', live(), JSON.stringify(extStatus().find((x) => x.id === 'afo')));

  const normal = Missions.findMission('afo-normal');
  const attack = Missions.findMission('afo-attack');
  r.ok('afo: both missions are in the mission list', !!normal && !!attack, `normal ${!!normal}, attack ${!!attack}`);
  if (!normal || !attack) return;

  r.ok('afo: the normal flight is not gated; the attack is, like a military aeroplane', !normal.military && attack.military === true,
    `normal.military ${normal.military}, attack.military ${attack.military}`);

  const p = Prog.load();
  const was = p.militaryUnlocked;
  try {
    p.militaryUnlocked = false;
    r.ok('afo: without the passcode, the attack mission is gated and the normal one is not',
      Prog.needsPasscode(p, attack) && !Prog.needsPasscode(p, normal),
      `attack ${Prog.needsPasscode(p, attack)}, normal ${Prog.needsPasscode(p, normal)}`);
    p.militaryUnlocked = true;
    r.ok('afo: the passcode opens it, live — no reload, same object', !Prog.needsPasscode(p, attack), Prog.needsPasscode(p, attack));
  } finally {
    p.militaryUnlocked = was;
  }

  r.ok('afo: each mission offers exactly two seats, captain first', Roles.rolesOf(normal).length === 2 && Roles.rolesOf(attack).length === 2
    && Roles.defaultRoleId(normal) === 'captain' && Roles.defaultRoleId(attack) === 'captain',
    `${JSON.stringify(Roles.rolesOf(normal).map((x) => x.id))} / ${JSON.stringify(Roles.rolesOf(attack).map((x) => x.id))}`);

  const escortVariant = Roles.withRole(attack, 'escort');
  r.ok('afo: the escort seat of the attack mission is a composed variant that keeps the military flag',
    escortVariant.baseId === 'afo-attack' && escortVariant.roleId === 'escort' && escortVariant.military === true,
    JSON.stringify({ baseId: escortVariant.baseId, roleId: escortVariant.roleId, military: escortVariant.military }));

  /* ---------------------------------------------------- captain, normal -- */
  say('afo: captain, normal flight');
  await sim.startMode('mission', { id: 'afo-normal' });
  const ac = sim.aircraft;
  r.ok('afo-normal/captain: starts on the ground in the 747', sim.aircraftType.id === 'b747' && ac.onGround, `${sim.aircraftType.id}, onGround ${ac.onGround}`);
  sim.step(3, 1 / 30);
  r.ok('afo-normal/captain: the first step is depart', sim.runner.step && sim.runner.step.id === 'depart', sim.runner.step && sim.runner.step.id);
  // Put the aeroplane where "depart" asks, and let the real check decide.
  ac.reset({ pos: ac.pos.clone(), headingDeg: ac.heading, speed: 90, altAGL: 150, engineOn: true });
  sim.step(4, 1 / 30);
  r.ok('afo-normal/captain: "depart" completes once airborne', sim.runner.step && sim.runner.step.id !== 'depart', sim.runner.step && sim.runner.step.id);
  const info1 = AfoFeat.afoInfo();
  r.ok('afo-normal/captain: the escort feature is active, kind "normal"', info1.active && info1.kind === 'normal', JSON.stringify(info1));
  sim.quitToMenu('main');
  r.ok('afo: quitting tears the escort down', !AfoFeat.afoInfo().active, JSON.stringify(AfoFeat.afoInfo()));

  /* ---------------------------------------------------- captain, attack -- */
  say('afo: captain, attack');
  await sim.startMode('mission', { id: 'afo-attack' });
  const spawnOk = Math.abs(ac.pos.x - AfoLead.ATTACK_AIR_START.x) < 5 && Math.abs(ac.pos.z - AfoLead.ATTACK_AIR_START.z) < 5;
  r.ok('afo-attack/captain: spawns at the same point the escort seat joins', spawnOk, `${ac.pos.x.toFixed(0)},${ac.pos.z.toFixed(0)} vs ${AfoLead.ATTACK_AIR_START.x},${AfoLead.ATTACK_AIR_START.z}`);
  sim.step(0.5, 1 / 30);
  r.ok('afo-attack/captain: gear is up for the cruise start (not reset()\'s default)', !ac.gearDown, ac.gearDown);
  sim.step(9, 1 / 30);
  const infoWarn = AfoFeat.afoInfo();
  r.ok('afo-attack/captain: the warning comes in on its own timeline', infoWarn.warned, JSON.stringify(infoWarn));
  sim.step(4, 1 / 30);
  const infoWave = AfoFeat.afoInfo();
  r.ok('afo-attack/captain: the drone wave is spawned, kid-safe (unmanned, two of them)', infoWave.waveSent && infoWave.dronesAlive === 2, JSON.stringify(infoWave));
  sim.quitToMenu('main');

  /* ------------------------------------------------- escort, normal -- */
  say('afo: escort (lead fighter), normal flight');
  await sim.startMode('mission', { id: 'afo-normal', role: 'escort' });
  r.ok('afo-normal/escort: flies the fighter, from the ground (a scramble)',
    (sim.aircraftType.class === 'Fighter' || /vanguard|f22/.test(sim.aircraftType.id)) && sim.aircraft.onGround,
    `${sim.aircraftType.id}, onGround ${sim.aircraft.onGround}`);
  r.ok('afo-normal/escort: the first step is scramble', sim.runner.step && sim.runner.step.id === 'scramble', sim.runner.step && sim.runner.step.id);
  const air1 = Cast.castActor('airliner');
  r.ok('afo-normal/escort: the NPC captain (Air Force One) is live, airborne already', !!air1 && air1.pos.y > 100, air1 ? air1.pos.y.toFixed(0) : null);
  sim.quitToMenu('main');

  /* ------------------------------------------------- escort, attack -- */
  say('afo: escort (lead fighter), attack');
  await sim.startMode('mission', { id: 'afo-attack', role: 'escort' });
  r.ok('afo-attack/escort: gear is up for the cruise join-up', !sim.aircraft.gearDown, sim.aircraft.gearDown);
  const air2 = Cast.castActor('airliner');
  r.ok('afo-attack/escort: Air Force One (the NPC) is at the agreed point, in the "potus" livery', !!air2
    && Math.abs(air2.pos.x - AfoLead.ATTACK_AIR_START.x) < 50 && Math.abs(air2.pos.z - AfoLead.ATTACK_AIR_START.z) < 50,
    air2 ? `${air2.pos.x.toFixed(0)},${air2.pos.z.toFixed(0)}` : null);
  sim.step(12, 1 / 30);
  // afoInfo() is the captain-seat feature's own state; from the escort seat
  // the drones are read back through castInfo() instead, same as a step's
  // own check() in afo-lead.js does.
  const attackInfo = Cast.castInfo();
  r.ok('afo-attack/escort: the drones are live and trackable through castInfo()', attackInfo.dronesAlive >= 0 && typeof attackInfo.stats === 'object',
    JSON.stringify({ dronesAlive: attackInfo.dronesAlive, stats: attackInfo.stats }));
  sim.quitToMenu('main');

  /* -------------------------------------------- the fail paths, directly -- */
  say('afo: fail paths');
  // afo-attack/captain: two hits trips failIf with a kind word, no wreck.
  // A trivial auto-level (not a navigator — nothing here steers anywhere) so
  // 150 s of hands-off coasting proves the missile fail path, not a drift
  // into the sea that would fail it for the wrong reason.
  const ac2 = sim.aircraft;
  const levelOut = () => {
    const bank = ac2.bankAngleDeg();
    return { roll: Math.max(-0.4, Math.min(0.4, -bank * 0.05 - ac2.omega.z * 0.4)), pitch: Math.max(-0.3, Math.min(0.3, -ac2.vs * 0.1 - ac2.omega.x * 0.5)), yaw: 0, throttle: 0.6, brakes: 0 };
  };
  const LEVEL = {};
  for (const k of ['roll', 'pitch', 'yaw', 'throttle', 'brakes']) Object.defineProperty(LEVEL, k, { enumerable: true, get() { return levelOut()[k]; } });
  await sim.startMode('mission', { id: 'afo-attack' });
  sim.override = LEVEL;
  sim.step(14, 1 / 30); // past the warning and the wave
  // Fast-forward without ever touching the flares: the drones' own missiles,
  // once launched, are unguarded except by the player's flares (the escort's
  // gun only ever aims at drones, never at a missile already in the air).
  let hitSeen = false;
  for (let t = 0; t < 150 && sim.runner.status === 'running'; t += 1) {
    sim.step(1, 1 / 30);
    if (AfoFeat.afoInfo().failWhy) { hitSeen = true; break; }
  }
  sim.override = null;
  r.ok('afo-attack/captain: two missile hits fail the mission with a kind word, not a crash', hitSeen && sim.runner.status === 'failed' && !sim.aircraft.crashed,
    `hitSeen ${hitSeen}, status ${sim.runner.status}, crashed ${sim.aircraft.crashed}, why "${AfoFeat.afoInfo().failWhy || ''}"`);
  sim.quitToMenu('main');

  // afo-normal/escort: too close to the airliner trips its own failIf.
  await sim.startMode('mission', { id: 'afo-normal', role: 'escort' });
  const air3 = Cast.castActor('airliner');
  sim.aircraft.pos.copy(air3.pos);
  sim.aircraft.pos.y += 1;
  sim.step(1, 1 / 30);
  r.ok('afo-normal/escort: closing on Air Force One itself (not the wing slot) fails the mission', sim.runner.status === 'failed', sim.runner.status);
  sim.quitToMenu('main');
}

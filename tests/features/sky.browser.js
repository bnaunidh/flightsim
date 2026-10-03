/**
 * Browser checks for THE SKY (src/features/sky.js): every other aircraft in
 * one list, so the player can collide with any of them and the minimap
 * draws all of them — the owner's "as captain you can hit other planes,
 * including NPCs — this goes to all missions" and "each plane has a new
 * minimap". The real game, the real flight model, the real traffic, the
 * real stories.
 *
 *   1. The feature is registered and live, and the traffic's aeroplanes are
 *      bodies from their first frame.
 *   2. Free Flight: flown into an AI aeroplane on final, you CRASH — the
 *      crash system names it a mid-air bump, the reason says who you hit —
 *      and the AI aeroplane is no ghost: it is knocked down, its crew come
 *      out under parachutes, and it is retired when it reaches the ground.
 *   3. The minimap draws the bodies, in the story's colours, and nothing of
 *      the interface sits on top of it — the desk layout and the touch
 *      layout — with the sky full.
 *   4. A mission's NPC (the airliner you intercept as the lead fighter) is
 *      solid too: the collision ends the flight and the mission.
 *   5. A fighter escort (the hijack's jets) and a pursuer (Shake the Tail)
 *      take the hit and come down; a drone pops.
 *   6. The yellow "Races" button is gone from the flight screen (the owner:
 *      "remove this yellow thing please"); one quiet "🏁 Races" remains.
 *   7. It costs nothing a Chromebook would feel: well under a tenth of a
 *      millisecond a frame on average with the sky full.
 *
 * Every import is dynamic, the same rule as the other feature checks.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let SKY;
  let TR;
  let CR;
  let ext;
  let THREE;
  let Cast;
  let EscortMod;
  let Terrain;
  try {
    SKY = await import('../../src/features/sky.js');
    TR = await import('../../src/features/traffic.js');
    CR = await import('../../src/features/crashes.js');
    ext = await import('../../src/game/extensions.js');
    THREE = await import('../../src/vendor/three.module.js');
    Cast = await import('../../src/game/roles/cast.js');
    EscortMod = await import('../../src/features/events/escort.js');
    Terrain = await import('../../src/world/terrain.js');
  } catch (err) {
    r.ok('sky: the modules load', false, String(err && err.message));
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const html = document.documentElement;
  const wasTouch = html.classList.contains('is-touch-device');
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const free = (extra = {}) => sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, ...extra });
  const steps = (secs, dt = 1 / 30) => {
    for (let t = 0; t < secs; t += dt) {
      sim.step(dt, dt);
      noDebrief();
    }
  };
  const quit = () => {
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu();
  };
  const bodiesNow = () => (sim.aircraftAround && sim.aircraftAround.bodies ? sim.aircraftAround.bodies.filter((b) => !b.gone) : []);
  const ground = (x, z) => Math.max(0, Terrain.heightAt(x, z));

  /**
   * Put the aeroplane `back` metres behind a body along its heading, at its
   * height, flying at it `faster` m/s quicker than it goes — and fly until
   * the crash, or `cap` seconds. Returns the seconds it took, or -1.
   */
  const flyInto = (body, { back = 150, faster = 40, cap = 10 } = {}) => {
    const ac = sim.aircraft;
    const hdg = Number.isFinite(body.heading) ? body.heading : 90;
    const h = (hdg * Math.PI) / 180;
    const spd = (body.vel ? Math.hypot(body.vel.x, body.vel.z) : 0) + faster;
    const pos = new THREE.Vector3(body.pos.x - Math.sin(h) * back, body.pos.y, body.pos.z + Math.cos(h) * back);
    ac.reset({ pos, headingDeg: hdg, speed: Math.max(45, spd), altAGL: Math.max(5, pos.y - ground(pos.x, pos.z)), engineOn: true, gearDown: false });
    ac.controls.throttle = 1;
    sim.input.throttleTarget = 1;
    let t = 0;
    const dt = 1 / 30;
    while (t < cap && !ac.crashed) {
      // Hold the line: straight at where it is now.
      const dx = body.pos.x - ac.pos.x;
      const dz = body.pos.z - ac.pos.z;
      const want = ((Math.atan2(dx, -dz) * 180) / Math.PI + 360) % 360;
      const err = ((want - ac.heading + 540) % 360) - 180;
      sim.override = { pitch: Math.max(-0.3, Math.min(0.3, (body.pos.y - ac.pos.y) * 0.01)), roll: Math.max(-0.5, Math.min(0.5, err * 0.05)), yaw: 0 };
      sim.step(dt, dt);
      noDebrief();
      t += dt;
    }
    sim.override = null;
    return ac.crashed ? t : -1;
  };

  /** Painted things over the minimap that are not the minimap: should be nothing, ever (minimap-ghosts' rule). */
  const overMap = () => {
    const mm = sim.minimap;
    const m = mm.el.getBoundingClientRect();
    if (!(m.width > 0)) return [];
    const hits = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const fmt = (b) => `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`;
    const out = [];
    for (const e of document.querySelectorAll('#ext-layer *, #ui *, .hud *')) {
      if (e === mm.el || mm.el.contains(e) || e.contains(mm.el)) continue;
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) continue;
      let hidden = false;
      for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
        if (p.hidden || p.style.display === 'none') {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      const b = e.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || !hits(b, m)) continue;
      if (b.width >= innerWidth * 0.9 && b.height >= innerHeight * 0.9) continue;
      const painted = (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') || cs.backgroundImage !== 'none' || cs.borderTopWidth !== '0px' || (e.textContent || '').trim() || e.tagName === 'CANVAS';
      if (!painted) continue;
      out.push(`${e.tagName.toLowerCase()}.${String(e.className || '').slice(0, 40)} @${fmt(b)}`);
    }
    return out;
  };

  try {
    /* ---- 1. registered, and the traffic's aeroplanes are bodies ---- */
    say('sky: registered');
    const status = ext.extStatus ? ext.extStatus() : [];
    const me = status.find((e) => e.id === 'sky');
    r.ok('sky: the feature is registered and live', !!(me && me.live), JSON.stringify(me));
    await free();
    steps(0.5);
    r.ok('sky: the list is published on the game (sim.aircraftAround.bodies)', !!(sim.aircraftAround && Array.isArray(sim.aircraftAround.bodies)), sim.aircraftAround ? `${sim.aircraftAround.n} bodies` : "no sim.aircraftAround");
    const t0 = bodiesNow().filter((b) => b.kind === 'traffic');
    const pub = Array.isArray(sim.traffic) ? sim.traffic.length : 0;
    r.ok('sky: every published traffic aeroplane is a body, from the first frame of the flight', t0.length === pub && pub > 0, `${t0.length} bodies of kind traffic, ${pub} in sim.traffic`);
    r.ok('sky: a traffic body has a radius, a crew and a name for the banner', t0.every((b) => b.radius > 2 && b.crew >= 1 && SKY.nameOf(b) && SKY.nameOf(b) !== b.name), t0.map((b) => `${b.id}: r ${b.radius.toFixed(1)}, crew ${b.crew}, "${SKY.nameOf(b)}"`).slice(0, 3).join('; '));

    /* ---- 2. Free Flight: into an AI aeroplane on final ---- */
    say('sky: into the traffic');
    const D0 = SKY.skyDebug();
    const before = D0.stats.collisions;
    let arrive = TR.spawnTraffic(sim, 'arrive');
    if (!arrive.ok) arrive = TR.spawnTraffic(sim, 'depart');
    steps(4); // past the spawn-safe seconds, and the arrival is well into its approach
    const target = bodiesNow().find((b) => b.kind === 'traffic' && !b.onGround);
    r.ok('sky: an AI aeroplane is in the air to be hit', !!target, target ? `${SKY.nameOf(target)} at ${Math.round(target.pos.y)} m` : `spawn said ${JSON.stringify(arrive)}`);
    let took = -1;
    if (target) took = flyInto(target, { back: 160, faster: 45, cap: 12 });
    const ac = sim.aircraft;
    const D1 = SKY.skyDebug();
    r.ok('sky: flying into it is a crash, within a few seconds', took >= 0 && ac.crashed, took >= 0 ? `after ${took.toFixed(1)} s: "${ac.crashReason}"` : `no crash in 12 s; last ${JSON.stringify(D1.last)}; stats ${JSON.stringify(D1.stats)}`);
    r.ok('sky: the reason says who you flew into', /^You flew into /.test(ac.crashReason || '') && !!target && (ac.crashReason || '').includes(SKY.nameOf(target)), ac.crashReason);
    const crash = CR.crashDebug().C.crash;
    r.ok('sky: the crash system calls it a mid-air bump, with a kid-safe caption', !!crash && crash.kind === 'midair' && /Mid-air bump/.test(crash.title) && !/die|dead|hurt|blood/i.test(crash.caption), crash ? `${crash.kind}: ${crash.title} — ${crash.caption}` : 'no crash record');
    r.ok('sky: the collision is counted, against the traffic', D1.stats.collisions === before + 1 && D1.last && D1.last.kind === 'traffic', JSON.stringify(D1.last));
    const knocked = Array.isArray(sim.traffic) ? sim.traffic.find((e) => e.phase === 'knocked') : null;
    r.ok('sky: the AI aeroplane is no ghost — it is knocked down (phase "knocked", "coming down")', !!knocked && knocked.activity === 'coming down', knocked ? `${knocked.callsign}: ${knocked.phase} / ${knocked.activity}` : (sim.traffic || []).map((e) => `${e.callsign}:${e.phase}`).join(', '));
    r.ok('sky: its crew came out under parachutes', D1.chutes >= 1 && D1.stats.chutes >= 1, `${D1.chutes} in the air, ${D1.stats.chutes} dropped`);
    const chuteInScene = !!sim.scene.getObjectByName('eject:chute');
    r.ok('sky: the parachutes are in the world', chuteInScene);
    // Let it come down (the crash debrief is held off; the frame hooks keep running on the wreck).
    const y0 = knocked ? knocked.pos.y : 0;
    steps(3);
    r.ok('sky: the knocked aeroplane is falling', !!knocked && knocked.pos.y < y0 - 10, knocked ? `${Math.round(y0)} → ${Math.round(knocked.pos.y)} m` : '');
    steps(45);
    const still = Array.isArray(sim.traffic) ? sim.traffic.find((e) => e === knocked) : null;
    const D2 = SKY.skyDebug();
    r.ok('sky: when it reaches the ground it is retired — out of sim.traffic and out of the sky', !still && !D2.bodies.some((b) => knocked && b.id === knocked.id), still ? `${still.callsign} still ${still.phase} at ${Math.round(still.pos.y)} m` : 'gone');
    r.ok('sky: the parachutes land and are tidied away', D2.chutes === 0, `${D2.chutes} left`);

    /* ---- 3. the minimap, with the sky full, and nothing on top of it ---- */
    say('sky: the minimap');
    await free();
    const mm = sim.minimap;
    const mapWasOn = mm.visible;
    if (!mapWasOn && typeof mm.toggle === 'function') mm.toggle(true);
    for (let i = 0; i < 4; i++) TR.spawnTraffic(sim, i % 2 ? 'arrive' : 'depart');
    // A friend and an enemy beside the traffic: an escort jet and a chase jet, where the story would put them.
    const esc = new EscortMod.Escort(sim.scene, -1);
    esc.placeBehind(sim.aircraft, 400);
    steps(1);
    // Fly to where the traffic is, so the map has something near the middle to show.
    const near = bodiesNow().find((b) => b.kind === 'traffic' && !b.onGround);
    if (near) sim.aircraft.reset({ pos: new THREE.Vector3(near.pos.x - 900, near.pos.y + 150, near.pos.z + 600), headingDeg: 90, speed: 60, altAGL: Math.max(60, near.pos.y + 150 - ground(near.pos.x - 900, near.pos.z + 600)), engineOn: true, gearDown: false });
    steps(1);
    const nb = bodiesNow();
    const kinds = new Set(nb.map((b) => b.kind));
    r.ok('sky: many aircraft are in the list at once — traffic and a friend', nb.length >= 4 && kinds.has('traffic') && kinds.has('friend'), `${nb.length}: ${[...kinds].join(', ')}`);
    mm.frame(sim);
    r.ok('sky: the minimap draws the bodies', (mm._drawnBodies || 0) >= 2, `${mm._drawnBodies} drawn of ${nb.length} (${mm.span} m across)`);
    html.classList.remove('is-touch-device');
    steps(0.6);
    let stray = overMap();
    r.ok('sky: nothing of the interface sits on top of the minimap (desk layout)', stray.length === 0, stray.join(' ; ') || `clear at ${innerWidth}x${innerHeight}`);
    html.classList.add('is-touch-device');
    steps(0.7);
    stray = overMap();
    r.ok('sky: nothing of the interface sits on top of the minimap (touch layout, top-left)', stray.length === 0, stray.join(' ; ') || `clear at ${innerWidth}x${innerHeight}`);
    html.classList.remove('is-touch-device');
    steps(0.3);

    /* ---- the escort takes a hit ---- */
    say('sky: into an escort');
    const escBody = nb.find((b) => b.kind === 'friend');
    const b4 = SKY.skyDebug().stats.collisions;
    let tookE = -1;
    if (escBody) tookE = flyInto(escBody, { back: 140, faster: 40, cap: 10 });
    r.ok('sky: a fighter escort is solid — flying into it is a crash, and the jet is knocked down', tookE >= 0 && esc.mode === 'knocked' && SKY.skyDebug().stats.collisions === b4 + 1, `took ${tookE.toFixed(1)} s; escort mode ${esc.mode}; "${sim.aircraft.crashReason}"`);
    steps(40);
    r.ok('sky: the knocked escort has come down and is gone', esc.gone, `gone ${esc.gone}, mode ${esc.mode}`);
    esc.dispose();
    TR.clearTraffic(sim);

    /* ---- 4. a mission's NPC: the airliner you intercept ---- */
    say('sky: a mission NPC');
    await sim.startMode('mission', { id: 'event-hijack', role: 'lead' });
    steps(4);
    const air = Cast.castActor('airliner');
    const airBody = air ? bodiesNow().find((b) => b.pos === air.pos) : null;
    r.ok('sky: the lead seat’s airliner is a body of kind npc, named for the banner', !!airBody && airBody.kind === 'npc' && SKY.nameOf(airBody) === 'the airliner', airBody ? `${airBody.id} ${airBody.kind} r ${airBody.radius.toFixed(1)}` : `actor ${!!air}, ${bodiesNow().map((b) => b.id).join(',')}`);
    let tookA = -1;
    if (airBody) tookA = flyInto(airBody, { back: 220, faster: 60, cap: 12 });
    const stA = sim.runner.status;
    r.ok('sky: flying into the airliner is a crash that ends the mission', tookA >= 0 && sim.aircraft.crashed && stA === 'failed', `took ${tookA.toFixed(1)} s, mission ${stA}, "${sim.aircraft.crashReason}"`);
    r.ok('sky: the airliner is knocked down (no longer flying its story)', !!air && air.knocked === true && air.mode === 'knocked', air ? `knocked ${air.knocked}, mode ${air.mode}` : '');
    steps(30);
    r.ok('sky: the knocked airliner comes to rest on the ground as a wreck, in one piece', !!air && air.wrecked === true && air.onGround && !air.gone, air ? `wrecked ${air.wrecked}, onGround ${air.onGround}, y ${Math.round(air.pos.y)}` : '');
    quit();

    /* ---- 5. a pursuer, and a drone ---- */
    say('sky: a pursuer');
    await sim.startMode('mission', { id: 'tail' });
    steps(4);
    const leader = sim.pursuer;
    const purBody = leader ? bodiesNow().find((b) => b.pos === leader.pos) : null;
    r.ok('sky: the chase’s jets are bodies of kind enemy', !!purBody && purBody.kind === 'enemy' && bodiesNow().filter((b) => b.kind === 'enemy').length === 3, bodiesNow().map((b) => `${b.id}:${b.kind}`).join(', '));
    let tookP = -1;
    if (purBody) tookP = flyInto(purBody, { back: 180, faster: 50, cap: 12 });
    r.ok('sky: flying into Ironhead One is a crash, and he is knocked out of the chase', tookP >= 0 && !!leader && leader.knocked && !leader.contact, `took ${tookP.toFixed(1)} s; knocked ${leader && leader.knocked}; "${sim.aircraft.crashReason}"`);
    steps(40);
    r.ok('sky: the knocked pursuer has come down and is gone', !!leader && leader.alive === false, leader ? `alive ${leader.alive}` : '');
    quit();

    say('sky: a drone');
    await sim.startMode('mission', { id: 'afo-attack', role: 'captain' });
    steps(5);
    // The drones come when the story says: skip to the warning, and give them a moment.
    for (let i = 0; i < 6 && sim.runner.step && sim.runner.step.id !== 'evade' && sim.runner.status === 'running'; i++) sim.runner.skipStep();
    for (let i = 0; i < 60 && !bodiesNow().some((b) => b.small); i++) steps(0.5);
    const drone = bodiesNow().find((b) => b.small);
    r.ok('sky: the drones are small enemy bodies (a diamond on the map)', !!drone && drone.kind === 'enemy' && drone.crew === 0, drone ? drone.id : bodiesNow().map((b) => b.id).join(','));
    let tookD = -1;
    const dronesBefore = bodiesNow().filter((b) => b.small).length;
    if (drone) tookD = flyInto(drone, { back: 140, faster: 50, cap: 10 });
    steps(0.2);
    const dronesAfter = bodiesNow().filter((b) => b.small).length;
    r.ok('sky: ramming a drone is a crash for you and the end of the drone (it pops, no crew, no parachute)', tookD >= 0 && dronesAfter === dronesBefore - 1, `took ${tookD.toFixed(1)} s; drones ${dronesBefore} → ${dronesAfter}; chutes ${SKY.skyDebug().chutes}`);
    quit();

    /* ---- 6. the yellow button ---- */
    say('sky: the races bar');
    await free();
    steps(1);
    const bar = document.querySelector('.race-solobar');
    const barText = bar ? bar.textContent.replace(/\s+/g, ' ').trim() : '';
    const yellow = bar ? [...bar.querySelectorAll('button')].filter((b) => !b.hidden).map((b) => getComputedStyle(b).backgroundColor).filter((c) => /^rgba?\(25[0-5], (2[0-9][0-9]|1[89][0-9]), ([0-9]|[1-9][0-9]|1[01][0-9])/.test(c)) : [];
    r.ok('sky: the yellow "Races" button is gone from the flight screen — one quiet "🏁 Races" remains', !!bar && !bar.querySelector('.race-solo-main') && !bar.querySelector('[data-race-solo]') && /Races/.test(barText) && yellow.length === 0, `bar "${barText}", yellow buttons: ${yellow.join(' ') || 'none'}`);

    /* ---- 7. cost ---- */
    for (let i = 0; i < 4; i++) TR.spawnTraffic(sim, i % 2 ? 'arrive' : 'depart');
    steps(5);
    const st = SKY.skyDebug().stats;
    r.ok('sky: the collision check costs under a tenth of a millisecond a frame with the sky full (average)', st.ms < 0.1, `avg ${st.ms.toFixed(3)} ms, worst ${st.msMax.toFixed(2)} ms over ${st.frames} frames, ${bodiesNow().length} bodies`);
    TR.clearTraffic(sim);
    if (!mapWasOn && typeof mm.toggle === 'function') mm.toggle(false);
  } finally {
    sim.override = null;
    if (wasTouch) html.classList.add('is-touch-device');
    else html.classList.remove('is-touch-device');
    noDebrief();
    quit();
    sim.autoPauseOnHide = origAuto;
  }
}

export default check;

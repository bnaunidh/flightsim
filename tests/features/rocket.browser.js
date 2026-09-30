/**
 * Browser checks for the rocket game — "add rocket sim".
 *
 * tests/features/rocket.mjs has already flown every mission with a robot in
 * node and found a launch site on every map. This is the part node cannot
 * see: that the fifth game is in the bar and has a front page, that its
 * missions are on the board only in the rocket game, that SPACE on the real
 * keyboard counts down and launches, that the flat world is put away for
 * the planet up high and put back exactly as it was, that the aeroplane is
 * neither drawn nor heard while you fly a rocket, that pausing, restarting
 * and quitting all come back to the right place — and what it costs a frame.
 * And that a child can land the booster: whole key presses, chosen only from
 * the words on the landing card, after "Try the landing again" from a miss.
 *
 * Every import is dynamic and every name read off the namespace (the rule
 * in selftest-three-games.js): a missing module is a failed check with a
 * name, not a suite that will not load.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'rocket';

export async function check(sim, r, say) {
  let mod;
  let ext;
  let T;
  let flights;
  try {
    mod = await import('../../src/features/rocket.js');
    ext = await import('../../src/game/extensions.js');
    T = await import('../../src/world/terrain.js');
    flights = await import('../../src/features/rocket/flights.js');
  } catch (err) {
    r.ok('rocket: the rocket modules load', false, String(err && err.message));
    return;
  }
  const D = mod.rocketDebug;
  const menus = sim.menus;
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const errors = [];
  const onErr = (e) => errors.push(String(e && (e.message || e.reason)));
  window.addEventListener('error', onErr);
  const key = (code, down = true) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code === 'Space' ? ' ' : code, bubbles: true }));
  // Whole seconds of game at a time (thirty frames, one draw), and the
  // time warp asked for again each second — the game drops it back to ×1
  // at every event a child should see, which a test has already seen.
  let warpWant = 1;
  const runUntil = (cond, maxSimS, dt = 1 / 30, chunk = 1) => {
    let n = 0;
    while (!cond() && n * chunk < maxSimS) {
      if (warpWant > 1) D.setWarp(warpWant);
      sim.step(chunk, dt);
      n++;
    }
    return cond();
  };

  try {
    say && say('rocket: the switcher and the front page');
    const st = ext.extStatus().find((e) => e.id === 'rocket');
    r.ok('rocket: the feature is registered and live', !!st && st.live, JSON.stringify(st));
    const bar = [...menus.bar.querySelectorAll('.switcher [data-game]')].map((b) => b.dataset.game);
    r.ok('rocket: a fifth game in the bar, after the four', bar.length === 5 && bar[4] === 'rocket' && ['flight', 'heli', 'boat', 'car'].every((g) => bar.includes(g)), bar.join(' '));

    // Before anything: what the scene and the camera look like.
    const before = {
      children: sim.scene.children.length,
      visible: sim.scene.children.map((o) => o.visible),
      near: sim.camera.near,
      far: sim.camera.far,
      model: sim.model.visible,
    };

    menus.bar.querySelector('[data-game="rocket"]').click();
    const main = menus.screens.main;
    r.ok('rocket: pressing Rocket goes to its own front page, not into a launch', sim.state === 'menu' && menus.currentGame === 'rocket' && menus.current === 'main' && menus.root.dataset.game === 'rocket', `state ${sim.state}, game ${menus.currentGame}, screen ${menus.current}`);
    const hero = main.querySelector('.brand h1').textContent;
    const acts = [...main.querySelectorAll('.main-nav [data-act]')].map((b) => b.dataset.act);
    r.ok('rocket: the front page is the rocket’s — its name, its cards, an icon on each', hero === 'Island Rockets' && acts.includes('rocket-launch') && acts.includes('missions') && acts.includes('rocket-learn') && [...main.querySelectorAll('.main-nav .card-icon')].every((i) => i.innerHTML.includes('<svg')), `${hero}: ${acts.join(', ')}`);

    // The picker.
    main.querySelector('[data-act="rocket-launch"]').click();
    const pick = menus.screens.rocket;
    const goals = pick ? [...pick.querySelectorAll('[data-rk-goal]')].map((b) => `${b.dataset.rkRocket}:${b.dataset.rkGoal}`) : [];
    r.ok('rocket: Launch opens the picker — three rockets and what each can do', menus.current === 'rocket' && pick && pick.querySelectorAll('[data-rk-card]').length === 3 && goals.length === 4, goals.join(' '));
    r.ok('rocket: the picker says which island it launches from', /Launching from/.test(pick.querySelector('[data-rk-site]').textContent), pick.querySelector('[data-rk-site]').textContent);
    r.ok('rocket: nothing on the picker scrolls sideways', pick.scrollWidth <= pick.clientWidth + 1, `${pick.scrollWidth} > ${pick.clientWidth}`);
    menus.show('main');

    // The board: the four rocket missions, and only in the rocket game.
    menus.show('missions');
    const board = menus.screens.missions;
    const shown = [...board.querySelectorAll('[data-mission]')].filter((c) => !c.hidden && c.offsetParent !== null).map((c) => c.dataset.mission);
    const rocketIds = flights.ROCKET_MISSIONS.map((m) => m.id);
    r.ok('rocket: the board shows the four rocket missions and nothing else', shown.length === 4 && rocketIds.every((x) => shown.includes(x)), shown.join(', '));
    const heading = board.querySelector('[data-cat-group="space"]');
    r.ok('rocket: under a heading of their own, Space', !!heading && !heading.hidden && /Space/.test(heading.textContent), heading ? heading.querySelector('.cat-title').textContent : 'no heading');
    menus.setGame('flight');
    const inFlight = rocketIds.filter((x) => { const c = board.querySelector(`[data-mission="${x}"]`); return c && !c.hidden; });
    r.ok('rocket: none of them on the aeroplane’s board', inFlight.length === 0, inFlight.join(', '));
    menus.setGame('rocket');

    // A launch through the real button on the real card.
    say && say('rocket: First Launch, by the button and the keyboard');
    const startBtn = board.querySelector('[data-mission="rocket-space"] [data-start]');
    r.ok('rocket: the mission button says Launch', startBtn && startBtn.textContent === 'Launch', startBtn && startBtn.textContent);
    startBtn.click();
    let S = D.session;
    r.ok('rocket: the card starts a rocket on its pad', !!S && sim.state === 'flying' && sim.mode === 'rocket' && S.flight.phase === 'pad' && S.def.id === 'starling', `state ${sim.state}, mode ${sim.mode}`);
    const site = D.lastSite;
    const padH = T.heightAt(site.pad.x, site.pad.z);
    r.ok('rocket: the pad is on Kestrel’s land, off the runways', site.found && padH > 1 && !T.isOnAnyRunway(site.pad.x, site.pad.z, 60), `pad at ${Math.round(site.pad.x)}, ${Math.round(site.pad.z)}, ${padH.toFixed(1)} m up`);
    r.ok('rocket: the ship is on open water', T.heightAt(site.barge.x, site.barge.z) < -5, `${T.heightAt(site.barge.x, site.barge.z).toFixed(1)} m`);
    r.ok('rocket: the aeroplane is put away and its HUD hidden; the rocket’s is up', sim.model.visible === false && sim.hud.wrap.style.display === 'none' && !S.hud.root.hidden, `model ${sim.model.visible}, hud ${sim.hud.wrap.style.display}`);
    const obj0 = S.flight.objective();
    r.ok('rocket: on the pad the goal says what to press', /SPACE/.test(obj0.text) && S.hud.objText.textContent.length > 10, `${obj0.title}: ${obj0.text}`);
    r.ok('rocket: the LAUNCH button is there for a finger', !S.hud.action.hidden && /LAUNCH/.test(S.hud.action.textContent));

    key('Space');
    sim.step(0.2);
    key('Space', false);
    r.ok('rocket: SPACE on the keyboard starts the countdown', S.flight.phase === 'countdown' && !S.hud.count.hidden, `phase ${S.flight.phase}, count "${S.hud.count.textContent}"`);
    const altBefore = S.flight.focus.alt;
    sim.step(6.5, 1 / 30);
    const f = S.flight.focus;
    // Five seconds of countdown, then a second and a half at about 1.9 g.
    r.ok('rocket: after the countdown it has lifted off', S.flight.phase === 'ascent' && f.alt > altBefore + 12, `phase ${S.flight.phase}, ${Math.round(f.alt - altBefore)} m up`);
    const smoke = Array.from(S.smoke.alpha).filter((a) => a > 0).length;
    const plume = [...S.views.values()].some((v) => v.plume && v.plume.visible);
    r.ok('rocket: flame and smoke at lift-off', plume && smoke > 30, `plume ${plume}, ${smoke} puffs`);
    r.ok('rocket: the engine is heard at lift-off (as data)', S.audio.level > 0.3, `roar ${S.audio.level.toFixed(2)}`);
    key('ArrowRight');
    sim.step(1, 1 / 30);
    const leaned = f.tilt;
    key('ArrowRight', false);
    r.ok('rocket: ▶ leans it right', leaned > 0.15, `${(leaned * 57.3).toFixed(0)}°`);
    const dial = S.hud.dial;
    r.ok('rocket: the tilt dial is up while climbing', !dial.hidden && S.hud.dialWord.textContent.length > 3, S.hud.dialWord.textContent);

    // Frame cost, low down.
    const cost = (frames) => {
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) sim.update(1 / 60);
      const js = (performance.now() - t0) / frames;
      const t1 = performance.now();
      for (let i = 0; i < 6; i++) sim.renderer.render(sim.scene, sim.camera);
      return { js, draw: (performance.now() - t1) / 6 };
    };
    const low = cost(60);

    // To space, with the robot.
    say && say('rocket: to space');
    D.robot(true);
    warpWant = 4;
    runUntil(() => S.spaceMode, 200);
    const hiddenNow = S.space.hidden.size;
    r.ok('rocket: up high the flat world is put away for the planet', S.spaceMode && hiddenNow > 3 && S.space.planet.visible && sim.camera.far > 1e6, `${hiddenNow} hidden, far ${sim.camera.far}`);
    runUntil(() => S.flight.flags.space, 300);
    sim.step(0.5, 1 / 30);
    const top = sim.sky.uniforms.uTop.value;
    r.ok('rocket: in space the sky is black and the stars are out', top.r + top.g + top.b < 0.08 && sim.sky.uniforms.uStars.value > 0.8, `top ${top.getHexString()}, stars ${sim.sky.uniforms.uStars.value.toFixed(2)}`);
    r.ok('rocket: the island is painted on the planet', S.painter.done && S.space.planetMat.uniforms.uIslandOn.value === 1);
    r.ok('rocket: it is silent in space (as data)', S.audio.level < 0.05, `roar ${S.audio.level.toFixed(3)}`);
    const high = cost(60);
    r.ok('rocket: a frame costs little, low and high', low.js < 10 && high.js < 10, `JS ${low.js.toFixed(2)} / ${high.js.toFixed(2)} ms, draw ${low.draw.toFixed(1)} / ${high.draw.toFixed(1)} ms`);

    runUntil(() => S.resultShown, 200);
    const credits = sim.prog && sim.prog.credits;
    r.ok('rocket: reaching space is a success with a score and a card', S.flight.result && S.flight.result.success && sim.state === 'debrief' && !menus.screens.debrief.hidden, S.flight.result && `${S.flight.result.title} ${S.flight.result.score}/100`);
    r.ok('rocket: the mission is recorded as flown', sim.progress.missions['rocket-space'] && sim.progress.missions['rocket-space'].complete, JSON.stringify(sim.progress.missions['rocket-space']));
    const debriefBtns = [...menus.screens.debrief.querySelectorAll('[data-actions] button')].map((b) => b.textContent);
    r.ok('rocket: the card offers again, next, rockets and the menu', debriefBtns.some((t) => /again/i.test(t)) && debriefBtns.some((t) => /Next/.test(t)) && debriefBtns.includes('Main menu'), debriefBtns.join(' · '));

    // Fly it again, then pause, restart and quit.
    say && say('rocket: pause, restart, quit');
    [...menus.screens.debrief.querySelectorAll('[data-actions] button')].find((b) => /again/i.test(b.textContent)).click();
    S = D.session;
    r.ok('rocket: Fly it again puts a fresh rocket on the pad', !!S && S.flight.phase === 'pad' && sim.state === 'flying', `phase ${S && S.flight.phase}`);
    D.press();
    sim.step(6.5, 1 / 30);
    sim.pause();
    const pauseScreen = menus.screens.pause;
    const airportBtn = pauseScreen.querySelector('[data-act="airport"]');
    r.ok('rocket: pausing shows the rocket, not the aeroplane', sim.state === 'paused' && pauseScreen.classList.contains('is-rocket') && getComputedStyle(airportBtn).display === 'none' && /Starling/.test(pauseScreen.querySelector('[data-pause-info]').textContent) && S.hud.root.hidden, pauseScreen.querySelector('[data-pause-info]').textContent.replace(/\s+/g, ' ').trim());
    const altPaused = S.flight.focus.alt;
    sim.step(1, 1 / 30);
    r.ok('rocket: paused means paused', Math.abs(S.flight.focus.alt - altPaused) < 0.01);
    sim.resume();
    r.ok('rocket: resuming brings the rocket’s HUD back, not the aeroplane’s', sim.state === 'flying' && !S.hud.root.hidden && sim.hud.wrap.style.display === 'none');
    sim.pause();
    sim.pauseAction('restart');
    const S2 = D.session;
    r.ok('rocket: Restart from the pause card puts it back on the pad', !!S2 && S2 !== S && S2.flight.phase === 'pad' && sim.state === 'flying', `phase ${S2 && S2.flight.phase}`);

    // Go high again, then quit from up there.
    D.robot(true);
    warpWant = 4;
    D.press();
    runUntil(() => D.session.spaceMode, 200);
    sim.pause();
    sim.pauseAction('quit');
    const after = {
      children: sim.scene.children.length,
      visible: sim.scene.children.map((o) => o.visible),
    };
    const flipped = before.visible.map((v, i) => (after.visible[i] !== v ? (sim.scene.children[i].name || sim.scene.children[i].type) : null)).filter(Boolean);
    r.ok('rocket: quitting from space puts the world back exactly as it was', !D.session && after.children === before.children && flipped.length === 0, `children ${before.children} → ${after.children}; changed: ${flipped.join(', ') || 'none'}`);
    r.ok('rocket: …and the camera’s lens, and the aeroplane', sim.camera.far === before.far && sim.camera.near === before.near && sim.model.visible === before.model, `near ${sim.camera.near}/${before.near}, far ${sim.camera.far}/${before.far}, model ${sim.model.visible}`);
    r.ok('rocket: quit goes to the rocket’s own front page', sim.state === 'menu' && menus.current === 'main' && menus.currentGame === 'rocket', `${menus.current}, ${menus.currentGame}`);

    // Come Home with a CHILD'S hands: whole key presses on the real
    // keyboard, reading only the landing card on the screen, a third of a
    // second late. The robot flies the climb (that is checked above); the
    // landing is the part a child could not do before.
    say && say('rocket: a child lands the booster with the keys');
    D.start({ mission: 'rocket-home' });
    D.robot(true);
    warpWant = 8;
    runUntil(() => D.session.flight.phase === 'landing', 400);
    D.robot(false);
    warpWant = 1;
    let H = D.session;
    // First: hands off ◀ ▶ (SPACE held). The helper stops the slide, so it
    // comes straight down — where it was, not on the pad.
    key('Space');
    runUntil(() => H.resultShown, 120, 1 / 30, 0.5);
    key('Space', false);
    const miss = H.flight.result;
    r.ok('rocket: never steering, the booster comes down off the pad — and the card says what to do', miss && !miss.success && /Right over it/.test(miss.reason), miss && `${miss.title}: ${miss.reason}`);
    const missBtns = [...menus.screens.debrief.querySelectorAll('[data-actions] button')];
    const retry = missBtns.find((b) => b.textContent === 'Try the landing again');
    r.ok('rocket: a missed landing offers "Try the landing again" first', !!retry && retry === missBtns[0] && retry.classList.contains('primary') && missBtns.some((b) => /Start from the pad/.test(b.textContent)), missBtns.map((b) => b.textContent).join(' · '));
    retry.click();
    H = D.session;
    sim.step(0.1, 1 / 30);
    r.ok('rocket: …which starts at 6 km, the booster yours, not back on the pad', !!H && sim.state === 'flying' && H.flight.phase === 'landing' && H.flight.focus === H.flight.booster && H.flight.focus.alt > 5000 && !H.hud.land.hidden && H.hud.root.querySelector('.rk-toast') && /6 km/.test(H.hud.root.querySelector('.rk-toast').textContent), H && `${H.flight.phase}, ${Math.round(H.flight.focus.alt)} m, toast "${H.hud.root.querySelector('.rk-toast') && H.hud.root.querySelector('.rk-toast').textContent}"`);
    // Now the child steers: hold the way the card points, let go at "Right
    // over it", hold SPACE when the card says to.
    const card = (sel) => (H.hud.land.querySelector(sel) || {}).textContent || '';
    const slides = new Set();
    const queue = [];
    let held = { l: false, r: false, s: false };
    const press = (code, on, was) => { if (on !== was) key(code, on); return on; };
    let t = 0;
    let clear = null;
    while (!H.flight.result && t < 90) {
      if (clear === null && t >= 3) {
        // The booster and the pad are what is being steered: the card must
        // not sit on top of either of them.
        const box = H.hud.land.getBoundingClientRect();
        const at = (v) => { const p = v.clone().project(sim.camera); return [(p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight]; };
        const bv = H.views.get(H.flight.focus).group.position.clone();
        bv.y += 12;
        const [bx, by] = at(bv);
        const tb = H.hud.target.getBoundingClientRect();
        const inBox = (x, y) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
        clear = { booster: !inBox(bx, by) && by > 0 && by < innerHeight, target: H.hud.target.hidden || tb.left > box.right || tb.top > box.bottom, detail: `booster at ${bx.toFixed(0)},${by.toFixed(0)}; card ${box.left.toFixed(0)}–${box.right.toFixed(0)} × ${box.top.toFixed(0)}–${box.bottom.toFixed(0)}` };
      }
      const dist = card('[data-dist]');
      const burn = card('[data-burn]');
      slides.add(card('[data-slide]'));
      const want = { l: !/Right over/.test(dist) && /◀/.test(dist), r: !/Right over/.test(dist) && /▶/.test(dist), s: held.s || /HOLD SPACE/.test(burn) };
      queue.push({ at: t + 0.35, want });
      while (queue.length && queue[0].at <= t) {
        const w = queue.shift().want;
        held = { l: press('ArrowLeft', w.l, held.l), r: press('ArrowRight', w.r, held.r), s: press('Space', w.s, held.s) };
      }
      sim.step(0.25, 1 / 60);
      t += 0.25;
    }
    for (const [code, on] of [['ArrowLeft', held.l], ['ArrowRight', held.r], ['Space', held.s]]) if (on) key(code, false);
    const kr = H.flight.result;
    r.ok('rocket: a child pressing whole keys, reading only the card, lands it on the pad', kr && kr.success && H.flight.booster.landed && H.flight.site.surface(H.flight.booster.downrange).kind === 'lz', kr && `${kr.title}: ${kr.reason} (${t.toFixed(0)} s)`);
    r.ok('rocket: the landing card keeps off the booster and the pad’s marker', !!clear && clear.booster && clear.target, clear && clear.detail);
    r.ok('rocket: the landing card showed which way it slid, and when it stopped', [...slides].some((s) => /^[◀▶] \d+ m\/s/.test(s)) && [...slides].some((s) => /Not sliding/.test(s)), [...slides].slice(0, 6).join(' | '));
    runUntil(() => H.resultShown, 10, 1 / 30, 0.5);
    r.ok('rocket: landing it after a retry still counts for the mission', sim.progress.missions['rocket-home'] && sim.progress.missions['rocket-home'].complete, JSON.stringify(sim.progress.missions['rocket-home']));

    // A booster landing on the ship, flown by the robot in the real game.
    say && say('rocket: a booster onto the ship');
    D.start({ mission: 'rocket-barge' });
    D.robot(true);
    warpWant = 8;
    runUntil(() => D.session.flight.phase === 'landing', 400);
    const L = D.session;
    r.ok('rocket: the booster comes home for the child to land', L.flight.phase === 'landing' && L.flight.focus === L.flight.booster && !L.hud.land.hidden, `phase ${L.flight.phase}`);
    sim.step(0.3, 1 / 30);
    r.ok('rocket: the ship is marked on the screen while landing', !L.hud.target.hidden && /SHIP/.test(L.hud.target.textContent), L.hud.target.textContent);
    r.ok('rocket: the action button becomes HOLD: BURN', /BURN/.test(L.hud.action.textContent) && L.hud.action.dataset.mode === 'burn', L.hud.action.textContent);
    runUntil(() => !!L.flight.result, 120);
    const lr = L.flight.result;
    r.ok('rocket: it lands on the ship, upright and gently', lr && lr.success && L.flight.booster.landed && L.flight.site.surface(L.flight.booster.downrange).kind === 'barge', lr && `${lr.title}: ${lr.reason}`);

    // And a satellite into orbit.
    say && say('rocket: a satellite into orbit');
    D.start({ mission: 'rocket-satellite' });
    D.robot(true);
    warpWant = 8;
    runUntil(() => !!D.session.flight.result, 500);
    const O = D.session;
    const orr = O.flight.result;
    r.ok('rocket: the satellite goes into orbit and is let go', orr && orr.success && !!O.flight.satellite, orr && `${orr.title}: ${orr.reason}`);
    sim.quitToMenu('main');

    // The other four games still work afterwards.
    say && say('rocket: the other games afterwards');
    sim.switchGame('flight');
    await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 90, airborne: false });
    sim.step(0.5);
    r.ok('rocket: afterwards an aeroplane flight is an aeroplane flight', sim.mode === 'free' && sim.model.visible && !D.session && sim.hud.wrap.style.display !== 'none', `mode ${sim.mode}, model ${sim.model.visible}`);
    sim.quitToMenu('main');

    // Offline: every rocket module is in the service worker's list.
    try {
      const sw = await (await fetch('../../sw.js', { cache: 'no-store' })).text();
      const need = ['features/rocket.js', 'rocket/physics.js', 'rocket/flights.js', 'rocket/site.js', 'rocket/models.js', 'rocket/space.js', 'rocket/camera.js', 'rocket/hud.js', 'rocket/audio.js', 'rocket/menu.js'];
      const missing = need.filter((p) => !sw.includes(p));
      r.ok('rocket: every rocket module is cached for offline', missing.length === 0, missing.join(', ') || `${need.length} modules`);
    } catch (e) {
      r.ok('rocket: the service worker list can be read', false, String(e && e.message));
    }
    r.ok('rocket: nothing threw', errors.length === 0 && !D.broken, errors.slice(0, 3).join(' | '));
  } catch (err) {
    r.ok('rocket: the checks ran to the end', false, String(err && err.stack || err).slice(0, 400));
  } finally {
    try { if (D.session) sim.quitToMenu('main'); } catch (e) { /* already out */ }
    try { sim.switchGame('flight'); } catch (e) { /* already there */ }
    window.removeEventListener('error', onErr);
    sim.autoPauseOnHide = origAuto;
  }
}

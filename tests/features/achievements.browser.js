/**
 * Browser checks for Achievements, in the real game.
 * tests/features/achievements.mjs checks the catalogue, the store, the
 * rules and the ceiling physics in node; this is what node cannot see:
 *
 *   - the Achievements button on the start screen, and the page behind it —
 *     progress, filters, the hidden ones staying hidden until unlocked;
 *   - a real take-off unlocking "Wheels Up", with the toast it shows and the
 *     page updating to match, the way the brief asked for: "a browser check
 *     that unlocks one achievement by playing (e.g. a take-off)";
 *   - the owner's own addition: an aeroplane at 69,900 ft, climbing,
 *     unlocks "The Sky's the Limit" once, never climbs past about
 *     70,000 ft, and shows the toast — and the calm HUD line.
 *
 * It puts back the player's own achievements save (and progression) afterwards.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let ext;
  let Store;
  let Phys;
  try {
    ext = await import('../../src/game/extensions.js');
    Store = await import('../../src/features/achievements/store.js');
    Phys = await import('../../src/aircraft/physics.js');
  } catch (err) {
    r.ok('achievements: the modules load', false, String(err && err.message));
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  let saved = null;
  try {
    saved = localStorage.getItem(Store.KEY);
  } catch (e) {
    saved = null;
  }
  const credits0 = sim.prog ? { c: sim.prog.credits, e: sim.prog.earned } : null;

  try {
    /* ---- registered ---------------------------------------------------- */
    const live = ext.extStatus().find((e) => e.id === 'achievements');
    r.ok('achievements: the plug-in is registered and live', !!(live && live.live), JSON.stringify(live));

    // A clean slate for the run, so every assertion below means something.
    const A = (await import('../../src/features/achievements/index.js')).__test.A;
    A.store = Store.blank();

    /* ---- the start screen and the page ---------------------------------- */
    say('achievements: the page');
    sim.menus.show('main');
    const btn = sim.menus.screens.main.querySelector('[data-ach-open]');
    r.ok('achievements: an Achievements button on the start screen', !!btn && btn.getBoundingClientRect().height > 30, btn ? btn.textContent.replace(/\s+/g, ' ').trim() : 'none');
    btn && btn.click();
    const scr = sim.menus.screens.achievements;
    r.ok('achievements: it opens the page', !!scr && !scr.hidden && sim.menus.current === 'achievements');
    const progressLine = scr.querySelector('[data-ach-progress]').textContent;
    r.ok('achievements: it shows x / y unlocked', /^0 \/ \d{2,3} unlocked$/.test(progressLine), progressLine);
    const cards0 = scr.querySelectorAll('.ach-card');
    r.ok('achievements: every achievement has a card', cards0.length >= 30, cards0.length);
    const hiddenCard = [...cards0].find((c) => c.querySelector('h4').textContent === '???');
    r.ok('achievements: a hidden one shows as ??? until unlocked', !!hiddenCard);
    r.ok('achievements: the page does not scroll sideways', scr.scrollWidth <= scr.clientWidth + 1, `${scr.scrollWidth} in ${scr.clientWidth}`);
    // Filters.
    scr.querySelector('[data-filter="unlocked"]').click();
    r.ok('achievements: "Unlocked" shows none yet', scr.querySelectorAll('.ach-card').length === 0);
    scr.querySelector('[data-filter="locked"]').click();
    r.ok('achievements: "Locked" shows everything', scr.querySelectorAll('.ach-card').length === cards0.length);
    scr.querySelector('[data-filter="all"]').click();
    scr.querySelector('[data-back]').click();
    r.ok('achievements: Back goes to the start screen', sim.menus.current === 'main');

    /* ---- a real take-off: "Wheels Up" ------------------------------------ */
    say('achievements: a real take-off');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100, airborne: false });
    r.ok('achievements: spawns on the ground', sim.aircraft.onGround === true);
    sim.key('ShiftLeft', true);
    let t = 0;
    while (sim.aircraft.ias * Phys.UNITS.KTS < 58 && t < 40) {
      sim.step(0.5);
      t += 0.5;
    }
    for (let i = 0; i < 12 && sim.aircraft.onGround; i++) {
      sim.override = { pitch: 0.5 };
      sim.step(0.5);
    }
    sim.override = null;
    sim.key('ShiftLeft', false);
    r.ok('achievements: it actually lifted off', !sim.aircraft.onGround, `${t.toFixed(0)} s on the roll, agl ${(sim.aircraft.agl * Phys.UNITS.FT).toFixed(0)} ft`);
    sim.step(0.2);
    const toastsAfterTakeoff = (sim.hud.toasts || []).map((x) => x.node);
    const unlockToast = toastsAfterTakeoff.find((n) => /Wheels Up/.test(n.textContent));
    r.ok('achievements: take-off shows the unlock toast', !!unlockToast, toastsAfterTakeoff.map((n) => n.textContent).join(' | '));
    r.ok('achievements: …icon + name, not a wall of text', !!(unlockToast && unlockToast.querySelector('svg') && unlockToast.querySelector('b')));
    r.ok('achievements: …and it is on top (top-centre), not over the minimap', !!unlockToast && unlockToast.closest('.hud-toasts'));
    r.ok('achievements: the store actually has it', !!A.store.unlocked['first-takeoff']);
    sim.menus.show('main');
    sim.menus.screens.main.querySelector('[data-ach-open]').click();
    const wheelsCard = [...sim.menus.screens.achievements.querySelectorAll('.ach-card')].find((c) => c.dataset.ach === 'first-takeoff');
    r.ok('achievements: …and the page shows it unlocked', !!wheelsCard && !wheelsCard.classList.contains('is-locked'));
    sim.menus.show('main');

    /* ---- the owner's addition: The Sky's the Limit ----------------------- */
    say("achievements: The Sky's the Limit");
    const FT = Phys.UNITS.FT;
    r.ok('physics: the ceiling is 70,000 ft', Phys.SKY_CEILING_FT === 70000);
    sim.aircraft.pos.y = 69900 / FT;
    sim.aircraft.vel.y = 6;
    sim.aircraft.crashed = false;
    let maxFt = 0;
    for (let i = 0; i < 20 * 30; i++) {
      sim.aircraft.update(1 / 30, sim.weather);
      maxFt = Math.max(maxFt, sim.aircraft.pos.y * FT);
    }
    r.ok('achievements: it climbs towards the top of the sky', maxFt > 69900);
    r.ok('achievements: …and never climbs past about 70,000 ft', maxFt < 70010, `reached ${maxFt.toFixed(1)} ft`);
    r.ok("achievements: The Sky's the Limit unlocks", !!A.store.unlocked['sky-limit']);
    r.ok('achievements: …exactly once', Object.keys(A.store.unlocked).filter((id) => id === 'sky-limit').length === 1);
    const toastsAtTop = (sim.hud.toasts || []).map((x) => x.node.textContent).join(' | ');
    r.ok("achievements: …and shows the toast", /Sky's the Limit/.test(toastsAtTop), toastsAtTop.slice(0, 200));

    /*
     * ---- a mission-complete toast must not be swallowed by the debrief ----
     * onMissionComplete() unlocks achievements and THEN, in the same call,
     * sets state to 'debrief' and calls hud.setVisible(false) to show the
     * debrief dialog. The toast used to live inside the HUD's own wrap, so
     * wrap's display:none took it down the instant it was created — never
     * painted. This is the exact repro that found it.
     */
    say('achievements: a mission-complete toast is not swallowed by the debrief');
    A.store = Store.blank();
    sim.runner.def = { id: 'first-run', category: 'training', steps: [] };
    sim.onMissionComplete({ id: 'first-run', score: 95, crashed: false });
    sim.step(0.05);
    r.ok('achievements: …it really did unlock (a category and a gold medal)', !!A.store.unlocked['cat-training'] && !!A.store.unlocked['gold-medal']);
    r.ok(
      'achievements: …the debrief dialog is up, same as the bug report',
      sim.state === 'debrief' && sim.hud.wrap.style.display === 'none' && !sim.menus.layer.hidden
    );
    const missionToasts = (sim.hud.toasts || []).map((x) => x.node);
    const missionToast = missionToasts.find((n) => /Achievement unlocked/.test(n.textContent));
    r.ok('achievements: …and its toast is there anyway', !!missionToast, missionToasts.map((n) => n.textContent).join(' | '));
    r.ok('achievements: …genuinely visible, not display:none with the rest of the HUD', !!missionToast && missionToast.offsetParent !== null);
    sim.quitToMenu('main');

    /*
     * ---- the rocket's own toast: a loop that never calls hud.update() at all ----
     * rocket.js hides the HUD for the whole flight and drives its own frame()
     * loop, which never calls sim.hud.update() — so a toast posted at launch
     * used to have no way to ever become visible, for as long as the flight
     * lasted. The real production path (no robot flag), so noteRocketStart()
     * fires, same as the bug report.
     */
    say('achievements: the rocket toast survives a flight that never ticks the HUD');
    A.store = Store.blank();
    await sim.startAnyMission('rocket-satellite');
    sim.step(0.1);
    r.ok('achievements: rocket-first unlocks', !!A.store.unlocked['rocket-first']);
    r.ok('achievements: …the HUD is hidden for the rocket, same as before the fix', sim.hud.wrap.style.display === 'none');
    const rocketToasts = (sim.hud.toasts || []).map((x) => x.node);
    const rocketToast = rocketToasts.find((n) => /Three, Two, One/.test(n.textContent));
    r.ok('achievements: …and its toast is there anyway', !!rocketToast, rocketToasts.map((n) => n.textContent).join(' | '));
    r.ok('achievements: …genuinely visible, not hidden with hud.wrap', !!rocketToast && rocketToast.offsetParent !== null);

    sim.quitToMenu('main');
  } finally {
    sim.override = null;
    try {
      if (saved === null) localStorage.removeItem(Store.KEY);
      else localStorage.setItem(Store.KEY, saved);
    } catch (e) {
      /* nothing to put back */
    }
    try {
      const A = (await import('../../src/features/achievements/index.js')).__test.A;
      A.store = Store.load();
    } catch (e) {
      /* the suite's own settings will be put back by the suite */
    }
    if (credits0 && sim.prog) {
      sim.prog.credits = credits0.c;
      sim.prog.earned = credits0.e;
      try {
        (await import('../../src/game/progression.js')).save(sim.prog);
      } catch (e) {
        /* ignore */
      }
    }
    sim.autoPauseOnHide = origAuto;
  }
}

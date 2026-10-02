/**
 * "Brace for impact" on missions.
 *
 * The owner (a kid) lost a mission to it: on an ordinary mission, flown low
 * and coming down — which is most of mission flying — ONE press of the tray
 * button (or L) declared a mayday, the autopilot took the plane and the
 * mission was over. Now main.js braceAvailable() decides whether it is on
 * offer at all:
 *
 *   - Free Flight: always, exactly as before (one press when low/descending).
 *   - A mission whose def says `allowBrace: true` (Dead Stick): yes, with the
 *     two-press confirm unless something is really wrong.
 *   - Any other mission: only during a REAL emergency (engine dead in the
 *     air, a failure, heavy damage) — never just for being low or descending.
 *
 * When it is not on offer the tray button is hidden (not greyed), the key
 * does nothing (no banner, no "press again") and the H card leaves it out.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  const hud = sim.hud;
  const btn = hud.btnBrace;
  if (!btn || typeof sim.braceAvailable !== 'function') {
    r.ok('brace: the tray button and braceAvailable() exist', false, `btn ${!!btn}, braceAvailable ${typeof sim.braceAvailable}`);
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const code = (sim.input.bindings.brace || [])[0] || 'KeyL';
  /** A real key press, through the real input layer, then one frame. */
  const pressKey = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
    sim.step(1 / 30, 1 / 30);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
  };
  /** The same as tapping the tray button (mkBtn's click handler). */
  const tap = () => {
    sim.hudAction('brace');
    sim.step(1 / 30, 1 / 30);
  };
  const clearBanner = () => {
    hud.banner.style.display = 'none';
    hud.banner.innerHTML = '';
  };
  const bannerSays = () => (hud.banner.style.display === 'none' ? '' : hud.banner.textContent.trim());
  const shown = (b) => !b.hidden && getComputedStyle(b).display !== 'none';
  const trayHasBrace = () => {
    hud.setTrayOpen(true);
    const vis = [...hud.tray.querySelectorAll('button')].some((b) => /brace/i.test(b.textContent) && shown(b));
    hud.setTrayOpen(false);
    return vis;
  };
  const helpSaysBrace = () => {
    sim.hudAction('help');
    const t = hud.controlsCard.textContent;
    hud.hideControls();
    return /Declare an emergency/i.test(t);
  };
  /** Put the aeroplane low and coming down hard, the state the old rule called "in trouble". */
  const lowAndDescending = () => {
    const ac = sim.aircraft;
    const ground = ac.pos.y - ac.agl;
    ac.pos.y = ground + 230;
    ac.vel.y = -13;
    sim.step(1 / 30, 1 / 30);
    ac.vel.y = Math.min(ac.vel.y, -13);
    return { agl: Math.round(ac.agl), vs: +(-ac.vel.y).toFixed(1) };
  };

  try {
    /* ---- an ordinary mission, flown low and descending ------------------- */
    say('brace: an ordinary mission');
    await sim.startMode('mission', { id: 'storm' });
    sim.step(0.3, 1 / 30);
    const lad = lowAndDescending();
    const oldRuleWouldFire = lad.agl < 400 || lad.vs > 12;
    r.ok('brace: Storm Approach does not declare it needs brace', !sim.runner.def.allowBrace);
    r.ok('brace: ordinary mission, low and descending — brace is not on offer', !sim.braceAvailable() && oldRuleWouldFire,
      `agl ${lad.agl} m, sink ${lad.vs} m/s (the old rule fired on agl < 400 or sink > 12)`);
    r.ok('brace: ordinary mission — the tray button is hidden, not just disabled', btn.hidden && !trayHasBrace());
    clearBanner();
    pressKey();
    pressKey();
    r.ok('brace: ordinary mission — the brace key twice does nothing: no mayday, no banner',
      !sim.bracing && !bannerSays() && !sim.autopilot.engaged, `bracing ${sim.bracing}, banner "${bannerSays()}"`);
    tap();
    tap();
    r.ok('brace: ordinary mission — tapping where the button was does nothing either', !sim.bracing && !bannerSays());
    r.ok('brace: ordinary mission — the mission is still running', sim.runner.status === 'running' && sim.runner.def && sim.runner.def.id === 'storm',
      `${sim.runner.status} ${sim.runner.def && sim.runner.def.id}`);
    r.ok('brace: ordinary mission — the H card does not list "Declare an emergency"', !helpSaysBrace());

    /* ---- the same mission, with a real emergency ------------------------- */
    say('brace: a real emergency on an ordinary mission');
    sim.toggleFailure('engine');
    sim.step(0.2, 1 / 30);
    r.ok('brace: engine failure on an ordinary mission — brace appears', sim.braceAvailable() && !btn.hidden && trayHasBrace());
    r.ok('brace: engine failure — the H card lists it again', helpSaysBrace());
    pressKey();
    r.ok('brace: engine failure — one press declares the mayday, as before', sim.bracing === true && sim.runner.status !== 'running',
      `bracing ${sim.bracing}, runner ${sim.runner.status}`);

    /* ---- a mission that needs it ------------------------------------------ */
    say('brace: Dead Stick');
    await sim.startMode('mission', { id: 'deadstick' });
    sim.step(0.1, 1 / 30);
    r.ok('brace: Dead Stick declares allowBrace', sim.runner.def.allowBrace === true);
    r.ok('brace: Dead Stick before the engine goes — on offer, button shown', sim.braceAvailable() && !btn.hidden && !sim.aircraft.failures.engine);
    clearBanner();
    pressKey();
    const firstPress = { bracing: sim.bracing, banner: bannerSays() };
    pressKey();
    r.ok('brace: Dead Stick, engine still running — the two-press confirm, as before',
      !firstPress.bracing && /Declare an emergency/i.test(firstPress.banner) && sim.bracing,
      `first press: bracing ${firstPress.bracing}, banner "${firstPress.banner}"; second: bracing ${sim.bracing}`);
    await sim.startMode('mission', { id: 'deadstick' });
    sim.step(3.5, 1 / 30);
    const failed = !!sim.aircraft.failures.engine;
    pressKey();
    r.ok('brace: Dead Stick after the engine fails — one press commits', failed && sim.bracing, `engine failed ${failed}, bracing ${sim.bracing}`);

    /* ---- Free Flight, unchanged ------------------------------------------- */
    say('brace: Free Flight');
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0 });
    sim.step(0.3, 1 / 30);
    r.ok('brace: Free Flight — on offer, button shown, on the H card', sim.braceAvailable() && !btn.hidden && trayHasBrace() && helpSaysBrace());
    const ff = lowAndDescending();
    pressKey();
    r.ok('brace: Free Flight, low and descending — one press declares, as before', sim.bracing === true, `agl ${ff.agl}, sink ${ff.vs}`);
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0 });
    sim.step(0.3, 1 / 30);
    {
      const ac = sim.aircraft;
      ac.pos.y = ac.pos.y - ac.agl + 900;
      ac.vel.y = 0;
      sim.step(1 / 30, 1 / 30);
    }
    clearBanner();
    pressKey();
    r.ok('brace: Free Flight, high and healthy — first press asks, as before', !sim.bracing && /Declare an emergency/i.test(bannerSays()), bannerSays());

    /* ---- the menu puts it back --------------------------------------------- */
    await sim.startMode('mission', { id: 'storm' });
    sim.step(0.2, 1 / 30);
    const hiddenOnMission = btn.hidden;
    sim.quitToMenu('main');
    r.ok('brace: leaving a mission for the menu un-hides the button (the van check reads it there)', hiddenOnMission && !btn.hidden);
  } finally {
    sim.autoPauseOnHide = origAuto;
    if (sim.state !== 'menu') sim.quitToMenu('main');
  }
}

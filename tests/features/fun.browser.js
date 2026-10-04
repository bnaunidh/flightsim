/**
 * Browser checks for Fun Stuff and the Wildfire disaster, in the real game.
 * tests/features/fun.mjs checks the colours and the save in node; this is
 * what node cannot see:
 *
 *   - the gold Fun Stuff button on the start screen, and the smoke-colour
 *     screen behind it;
 *   - the Wildfire disaster on the Free Flight panel and the pause menu,
 *     lighting a fire with the water armed, staying lit in the pause menu,
 *     and doing nothing at all in the car; and its pause-menu button pressed
 *     the way a kid presses it, with the game paused, in the plane and the
 *     helicopter;
 *   - T leaving smoke behind the aeroplane, and not being taken in the car;
 *   - the chip, where it sits, and that it goes when the game pauses.
 *
 * It puts back the player's own Fun Stuff save and credits afterwards.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 *
 * Fun Stuff used to also carry a Star Hunt and Stunts (pop-up scoring) — see
 * git history for their browser checks (gold stars on the minimap, catching
 * one, a barrel roll on the real stick).
 */

export async function check(sim, r, say) {
  let fun;
  let ext;
  let wf;
  try {
    fun = await import('../../src/features/fun.js');
    ext = await import('../../src/game/extensions.js');
    wf = await import('../../src/features/wildfire.js');
  } catch (err) {
    r.ok('fun: the Fun Stuff modules load', false, String(err && err.message));
    return;
  }
  const F = fun.__test.F;
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const FUN_KEY = 'islandsim.fun.v1';
  let savedFun = null;
  try {
    savedFun = localStorage.getItem(FUN_KEY);
  } catch (e) {
    savedFun = null;
  }
  const credits0 = sim.prog ? { c: sim.prog.credits, e: sim.prog.earned } : null;
  const keyAt = (code, down) =>
    document.body.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
  const pressT = () => {
    keyAt('KeyT', true);
    keyAt('KeyT', false);
  };

  try {
    /* ---- registered, and on the start screen ------------------------------ */
    const live = ext.extStatus().find((e) => e.id === 'fun');
    r.ok('fun: the Fun Stuff feature is registered and live', !!(live && live.live), JSON.stringify(live));
    // A clean save for the run, so the screen below means something.
    F.data = (await import('../../src/features/fun/save.js')).blankFun();
    sim.menus.show('main');
    const btn = sim.menus.screens.main.querySelector('[data-fun-open]');
    r.ok('fun: a Fun Stuff button on the start screen', !!btn && btn.getBoundingClientRect().height > 30, btn ? btn.textContent.replace(/\s+/g, ' ').trim() : 'none');
    for (const g of ['heli', 'boat', 'car', 'flight']) sim.menus.setGame && sim.menus.setGame(g);
    r.ok('fun: …still there after switching games', !!sim.menus.screens.main.querySelector('[data-fun-open]'));
    btn && btn.click();
    const scr = sim.menus.screens.fun;
    r.ok('fun: it opens the Fun Stuff screen', !!scr && !scr.hidden && sim.menus.current === 'fun');
    const cards = scr ? [...scr.querySelectorAll('.fun-card')] : [];
    const titles = cards.map((c) => c.querySelector('h3').textContent);
    r.ok('fun: the smoke-trail card is on it', titles.some((t) => t.includes('Smoke')), titles.join(' | '));
    r.ok('fun: every smoke colour is unlocked (no stickers to gate them any more)', scr && scr.querySelectorAll('.fun-swatch').length >= 6 && scr.querySelectorAll('.fun-swatch[disabled]').length === 0, scr && scr.querySelectorAll('.fun-swatch').length);
    r.ok('fun: the screen does not scroll sideways', scr && scr.scrollWidth <= scr.clientWidth + 1, `${scr && scr.scrollWidth} in ${scr && scr.clientWidth}`);
    // Picking a colour saves it and re-renders with it selected.
    const swatch = scr.querySelector('.fun-swatch[data-colour="blue"]');
    swatch && swatch.click();
    r.ok('fun: picking a colour marks it on', scr.querySelector('.fun-swatch[data-colour="blue"]').classList.contains('is-on'));
    r.ok('fun: …and saves it', F.data.smoke.color === 'blue');
    scr && scr.querySelector('[data-back]').click();
    r.ok('fun: Back goes to the start screen', sim.menus.current === 'main');

    /* ---- the Wildfire disaster ------------------------------------------- */
    say('fun: the Wildfire disaster');
    r.ok('fun: Wildfire is on the Free Flight disasters panel', !!sim.menus.screens.free.querySelector('[data-event="wildfire"]'));
    r.ok('fun: …and a button in the pause menu', !!sim.menus.screens.pause.querySelector('[data-natural="wildfire"]'));
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', airborne: true });
    sim.step(0.3);
    sim.triggerNatural('wildfire');
    sim.step(0.5);
    const st = wf.fireStatus(sim);
    r.ok('fun: Wildfire lights a fire ahead, with the water armed', st.live && st.burning > 0 && !!st.kind && st.capacity > 0, `${st.burning} burning, ${st.kind} ${st.capacity} L`);
    const said = (sim.hud.toasts || []).map((t) => t.node.textContent).join(' | ');
    r.ok('fun: …and says what to do', /WILDFIRE/.test(said) && /water/i.test(said), said.slice(0, 200));
    sim.step(5);
    r.ok('fun: it stays lit in the pause menu while it burns', sim.activeEvents && sim.activeEvents.wildfire > 0);
    const W = wf.wildfireDebug();
    W.hits = Math.max(1, W.hits);
    W.grid.extinguishAll(true);
    sim.step(0.5);
    r.ok('fun: put out, it is over', !(sim.activeEvents && sim.activeEvents.wildfire), sim.hud.banner && sim.hud.banner.textContent);
    sim.startDrive('car');
    sim.step(0.3);
    const before = (sim.hud.toasts || []).length;
    sim.triggerNatural('wildfire');
    sim.step(0.2);
    r.ok('fun: in the car a Wildfire does nothing and says nothing', !wf.fireStatus(sim).live && !(sim.activeEvents && sim.activeEvents.wildfire) && !(sim.hud.toasts || []).slice(before).some((t) => /WILDFIRE/.test(t.node.textContent)));

    /*
     * The way a kid actually starts one: Esc, open Disasters, press Wildfire,
     * Resume. The game is PAUSED when the button is pressed, which is the
     * case the calls above never tried — and it used to do nothing at all
     * there, right beside a Typhoon and a Tornado that worked. The plane and
     * the helicopter (the Harrier is what Rotors flies).
     */
    for (const craft of ['skylark', 'harrier']) {
      await sim.startMode('free', { aircraft: craft, time: 'day', condition: 'clear', airborne: true });
      sim.step(0.3);
      sim.pause();
      const pause = sim.menus.screens.pause;
      const fold = pause.querySelector('[data-natural-fold]');
      r.ok(`fun: ${craft}: the pause menu shows the Disasters fold`, sim.state === 'paused' && sim.menus.current === 'pause' && fold && !fold.hidden);
      fold.open = true;
      const b = fold.querySelector('[data-natural="wildfire"]');
      b.scrollIntoView({ block: 'center' });
      const bb = b.getBoundingClientRect();
      const px = bb.left + bb.width / 2;
      const py = bb.top + bb.height / 2;
      const hit = document.elementFromPoint(px, py);
      r.ok(`fun: ${craft}: the Wildfire button is on top where a finger lands`, !!hit && b.contains(hit), hit ? hit.className || hit.tagName : 'nothing');
      const toasts0 = (sim.hud.toasts || []).length;
      (hit && b.contains(hit) ? hit : b).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: px, clientY: py }));
      const Wd = wf.wildfireDebug();
      const st0 = wf.fireStatus(sim);
      r.ok(`fun: ${craft}: pressed while paused, a fire is lit`, st0.live && st0.burning > 0, `${st0.burning} burning, state ${sim.state}`);
      const tag = b.querySelector('.trigger-state');
      r.ok(
        `fun: ${craft}: …the button lights up in the menu, ON (not a countdown)`,
        b.classList.contains('is-on') && b.getAttribute('aria-pressed') === 'true' && sim.activeEvents && sim.activeEvents.wildfire > 0 && !!tag && tag.textContent === 'ON',
        tag ? tag.textContent : 'no tag'
      );
      const saidP = (sim.hud.toasts || []).slice(toasts0).map((t) => t.node.textContent).join(' | ');
      r.ok(`fun: ${craft}: …it says so`, /WILDFIRE/.test(saidP) && /ahead/.test(saidP), saidP.slice(0, 200));
      r.ok(`fun: ${craft}: …the game stays paused, with the fire panel waiting behind the menu`, sim.state === 'paused' && !(Wd.hud && Wd.hud.visible));
      sim.resume();
      sim.step(0.5);
      const st1 = wf.fireStatus(sim);
      r.ok(
        `fun: ${craft}: after Resume it is burning, with the water armed and its panel up`,
        sim.state === 'flying' && st1.live && st1.burning > 0 && !!st1.kind && st1.capacity > 0 && !!(Wd.hud && Wd.hud.visible) && sim.activeEvents.wildfire > 0,
        `${st1.burning} burning, ${st1.kind} ${st1.capacity} L`
      );
      Wd.hits = Math.max(1, Wd.hits);
      Wd.grid.extinguishAll(true);
      sim.step(0.5);
      r.ok(`fun: ${craft}: …and out again when it is put out`, !(sim.activeEvents && sim.activeEvents.wildfire));
    }

    /* ---- smoke ------------------------------------------------------------ */
    say('fun: smoke');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', airborne: true });
    const chip = document.querySelector('.fun-chip');
    pressT();
    sim.step(1.5);
    r.ok('fun: T turns the smoke on', F.smokeOn && F.smoke.liveCount(F.time) > 30, `${F.smoke.liveCount(F.time)} puffs`);
    const tail = F.smoke.aPos;
    const lastI = (F.smoke.next + F.smoke.max - 1) % F.smoke.max;
    const d = Math.hypot(tail.getX(lastI) - sim.aircraft.pos.x, tail.getY(lastI) - sim.aircraft.pos.y, tail.getZ(lastI) - sim.aircraft.pos.z);
    r.ok('fun: …from the tail of the aeroplane', d < 12, `${d.toFixed(1)} m from the middle`);
    r.ok('fun: …and the chip shows it on', chip && !chip.hidden && chip.querySelector('[data-fun-smoke]').getAttribute('aria-pressed') === 'true');
    pressT();
    sim.step(0.2);
    r.ok('fun: T again turns it off', !F.smokeOn);
    sim.startDrive('car');
    sim.step(0.3);
    const down = new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true, cancelable: true });
    document.body.dispatchEvent(down);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyT', bubbles: true, cancelable: true }));
    r.ok('fun: in the car T is left alone', !F.smokeOn && !down.defaultPrevented);

    /* ---- pause ------------------------------------------------------------ */
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', airborne: true });
    sim.step(0.2);
    if (typeof sim.pause === 'function') {
      sim.pause();
      await new Promise((res) => setTimeout(res, 320));
      r.ok('fun: the chip goes when the game pauses', chip.hidden, sim.state);
      if (typeof sim.resume === 'function') sim.resume();
    }

    /* ---- the cost of it --------------------------------------------------- */
    const N = 120;
    const t0 = performance.now();
    const upd = ext.extensions().find((e) => e.id === 'fun').update;
    F.smokeOn = true;
    for (let k = 0; k < N; k++) upd(sim, 1 / 30);
    const ms = (performance.now() - t0) / N;
    F.smokeOn = false;
    r.ok('fun: smoke costs the frame little', ms < 0.6, `${ms.toFixed(3)} ms a frame`);
    sim.quitToMenu('main');
  } finally {
    sim.override = null;
    // Put the player's own things back.
    try {
      if (savedFun === null) localStorage.removeItem(FUN_KEY);
      else localStorage.setItem(FUN_KEY, savedFun);
    } catch (e) {
      /* nothing to put back */
    }
    F.data = (await import('../../src/features/fun/save.js')).loadFun();
    if (credits0 && sim.prog) {
      sim.prog.credits = credits0.c;
      sim.prog.earned = credits0.e;
      try {
        (await import('../../src/game/progression.js')).save(sim.prog);
      } catch (e) {
        /* the suite's own settings will be put back by the suite */
      }
    }
    sim.autoPauseOnHide = origAuto;
  }
}

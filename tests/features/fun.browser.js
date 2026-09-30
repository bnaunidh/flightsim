/**
 * Browser checks for Fun Stuff and the Wildfire disaster, in the real game.
 * tests/features/fun.mjs has placed every star and flown every stunt in
 * node; this is what node cannot see:
 *
 *   - the gold Fun Stuff button on the start screen, the screen behind it
 *     with its four one-line explanations, the sticker book and colours;
 *   - the Wildfire disaster on the Free Flight panel and the pause menu,
 *     lighting a fire with the water armed, staying lit in the pause menu,
 *     and doing nothing at all in the car; and its pause-menu button pressed
 *     the way a kid presses it, with the game paused, in the plane and the
 *     helicopter;
 *   - stars in the sky, drawn, on the minimap, caught by flying through,
 *     paid for, saved, and none in a mission;
 *   - a barrel roll with the real flight model and the real stick;
 *   - T leaving smoke behind the aeroplane, and not being taken in the car;
 *   - the chip, where it sits, and that it goes when the game pauses.
 *
 * It puts back the player's own Fun Stuff save and credits afterwards.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let fun;
  let ext;
  let wf;
  let T;
  try {
    fun = await import('../../src/features/fun.js');
    ext = await import('../../src/game/extensions.js');
    wf = await import('../../src/features/wildfire.js');
    T = await import('../../src/world/terrain.js');
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
  const pops = [];
  const realPop = F.hud.pop.bind(F.hud);
  F.hud.pop = (t, s, o) => {
    pops.push(String(t));
    return realPop(t, s, o);
  };
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
    // A clean save for the run, so the numbers below mean something.
    F.data = (await import('../../src/features/fun/save.js')).blankFun();
    F.fresh.clear();
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
    r.ok(
      'fun: four things on it — stars, stunts, smoke, the Wildfire disaster',
      ['Star Hunt', 'Stunts', 'Smoke', 'Wildfire'].every((w) => titles.some((t) => t.includes(w))),
      titles.join(' | ')
    );
    r.ok('fun: …each explained in a line or two', cards.every((c) => {
      const p = c.querySelector('p');
      return p && p.textContent.trim().length > 20 && p.textContent.length < 260;
    }));
    const stickers = scr ? scr.querySelectorAll('.fun-sticker') : [];
    r.ok('fun: a sticker book with every sticker and how to get it', stickers.length >= 20 && [...stickers].every((s) => s.querySelector('em').textContent.length > 5), `${stickers.length} stickers`);
    r.ok('fun: smoke colours: white to start with, the rest locked', scr && scr.querySelectorAll('.fun-swatch:not([disabled])').length === 1 && scr.querySelectorAll('.fun-swatch[disabled]').length >= 5);
    r.ok('fun: the screen does not scroll sideways', scr && scr.scrollWidth <= scr.clientWidth + 1, `${scr && scr.scrollWidth} in ${scr && scr.clientWidth}`);
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
    r.ok('fun: …and putting one out earns Firefighter', !!F.data.stickers.firefighter);
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

    /* ---- stars in the sky ------------------------------------------------- */
    say('fun: Star Hunt');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', airborne: true });
    sim.step(0.3);
    r.ok('fun: ten stars in Free Flight', F.stars.length === 10 && F.field.mesh.count === 10, `${F.stars.length} (${F.setKey})`);
    const inScene = !!F.field.mesh.parent && !!sim.scene.getObjectById(F.field.mesh.id);
    r.ok('fun: …in the scene', inScene);
    const tipped = [...document.querySelectorAll('.fun-note')].some((t) => /golden star/.test(t.textContent));
    r.ok('fun: the flight says the stars are there (in its own line, not the game\'s toasts)', (tipped || F.tips.size > 0) && !(sim.hud.toasts || []).some((t) => /golden star/.test(t.node.textContent)));
    const chip = document.querySelector('.fun-chip');
    r.ok('fun: the chip shows 0 of 10', chip && !chip.hidden && /0\s*\/\s*10/.test(chip.textContent), chip && chip.textContent.replace(/\s+/g, ' '));
    const cr = chip.getBoundingClientRect();
    const blocked = ['.hud-left', '.minimap', '.touch-stick'].map((q) => document.querySelector(q)).filter((e) => {
      if (!e) return false;
      const b = e.getBoundingClientRect();
      return b.width && !(cr.right <= b.left || b.right <= cr.left || cr.bottom <= b.top || b.bottom <= cr.top);
    });
    r.ok('fun: …clear of the instruments, the map and the stick', blocked.length === 0, blocked.map((e) => e.className).join(', '));
    // Stars on the minimap: gold pixels in the round map.
    const mm = sim.minimap;
    let gold = 0;
    if (mm && mm.ctx && mm.visible) {
      sim.step(0.1);
      const cv = mm.ctx.canvas;
      const px = mm.ctx.getImageData(0, 0, cv.width, cv.height).data;
      for (let i = 0; i < px.length; i += 4) if (px[i] > 225 && px[i + 1] > 180 && px[i + 1] < 235 && px[i + 2] < 110) gold++;
    }
    r.ok('fun: stars are drawn on the minimap', gold > 10, `${gold} gold pixels`);
    const star = F.stars.find((s) => s.what === 'way up high') || F.stars[0];
    const c0 = sim.prog.credits;
    const ac = sim.aircraft;
    ac.pos.set(star.x - 150, star.y, star.z);
    ac.quat.setFromAxisAngle({ x: 0, y: 1, z: 0, isVector3: true }, -Math.PI / 2);
    ac.vel.set(55, 0, 0);
    for (let i = 0; i < 30 && !F.found.has(star.id); i++) sim.step(0.1);
    r.ok('fun: flying through a star catches it', F.found.has(star.id), `${Math.round(Math.hypot(ac.pos.x - star.x, ac.pos.z - star.z))} m from it`);
    r.ok('fun: …25 credits', sim.prog.credits - c0 === 25, `${sim.prog.credits - c0}`);
    r.ok('fun: …a pop-up and the count goes up', pops.some((p) => /STAR/.test(p)) && /1\s*\/\s*10/.test(chip.textContent));
    r.ok('fun: …the First Star sticker', !!F.data.stickers['first-star']);
    sim.step(1);
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem(FUN_KEY));
    } catch (e) {
      saved = null;
    }
    const key = `flight:${T.MAP.id}`;
    r.ok('fun: …and it is saved on this device', !!(saved && saved.stars && (saved.stars[key] || []).includes(star.id)), JSON.stringify(saved && saved.stars));
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', airborne: true });
    sim.step(0.2);
    r.ok('fun: next flight it is still found', F.found.has(star.id) && /1\s*\/\s*10/.test(chip.textContent));
    await Promise.resolve(sim.startAnyMission('circuit')).catch(() => null);
    sim.step(0.2);
    if (sim.mode === 'mission') r.ok('fun: no stars in a mission', F.stars.length === 0 && F.field.mesh.count === 0, `${F.stars.length}`);

    /* ---- a barrel roll with the real stick ------------------------------ */
    say('fun: stunts');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', airborne: true });
    sim.aircraft.pos.y += 500;
    sim.override = { throttle: 1, brakes: 0, pitch: 0, roll: 0, yaw: 0 };
    sim.step(1.5);
    pops.length = 0;
    const c1 = sim.prog.credits;
    sim.override = { throttle: 1, brakes: 0, pitch: 0, roll: 1, yaw: 0 };
    for (let i = 0; i < 55 && !pops.length; i++) sim.step(0.1);
    sim.override = null;
    r.ok('fun: full aileron in the Skylark is a BARREL ROLL', pops.includes('BARREL ROLL!'), pops.join(', '));
    r.ok('fun: …20 credits and the Barrel Roller sticker', sim.prog.credits - c1 === 20 && !!F.data.stickers.roll, `${sim.prog.credits - c1}`);
    r.ok('fun: …and the points on the chip', /200/.test(chip.textContent), chip.textContent.replace(/\s+/g, ' '));

    /* ---- smoke ------------------------------------------------------------ */
    say('fun: smoke');
    pressT();
    sim.step(1.5);
    r.ok('fun: T turns the smoke on', F.smokeOn && F.smoke.liveCount(F.time) > 30, `${F.smoke.liveCount(F.time)} puffs`);
    const tail = F.smoke.aPos;
    const lastI = (F.smoke.next + F.smoke.max - 1) % F.smoke.max;
    const d = Math.hypot(tail.getX(lastI) - sim.aircraft.pos.x, tail.getY(lastI) - sim.aircraft.pos.y, tail.getZ(lastI) - sim.aircraft.pos.z);
    r.ok('fun: …from the tail of the aeroplane', d < 12, `${d.toFixed(1)} m from the middle`);
    r.ok('fun: …and gets the Smoke Show sticker', !!F.data.stickers.smoke);
    pressT();
    sim.step(0.2);
    r.ok('fun: T again turns it off', !F.smokeOn);
    sim.startDrive('car');
    sim.step(0.3);
    const down = new KeyboardEvent('keydown', { code: 'KeyT', bubbles: true, cancelable: true });
    document.body.dispatchEvent(down);
    document.body.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyT', bubbles: true, cancelable: true }));
    r.ok('fun: in the car T is left alone', !F.smokeOn && !down.defaultPrevented);
    r.ok('fun: the car hunts stars on the roads when there are roads', F.kind === 'road' && (F.stars.length === 10 || !(sim.roads && sim.roads.list && sim.roads.list.length)), `${F.stars.length} on ${T.MAP.id}`);

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
    r.ok('fun: stars, stunts and smoke cost the frame little', ms < 0.6, `${ms.toFixed(3)} ms a frame`);
    sim.quitToMenu('main');
  } finally {
    F.hud.pop = realPop;
    sim.override = null;
    // Put the player's own things back.
    try {
      if (savedFun === null) localStorage.removeItem(FUN_KEY);
      else localStorage.setItem(FUN_KEY, savedFun);
    } catch (e) {
      /* nothing to put back */
    }
    F.data = (await import('../../src/features/fun/save.js')).loadFun();
    F.fresh.clear();
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

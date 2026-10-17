/**
 * Browser checks for the HUD's right-hand stack (src/ui/hud-stack.js), the
 * centre lane, the Clean HUD and chapter 1's ring — the owner's 2026-10-16
 * "ui errors like this", "so the map isn't clogged" and "the giant circle in
 * chapter 1, once you go through it it should disappear".
 *
 *   1. The owner's screenshot: the Meteor Photo run, stormy and at night, low
 *      enough for PULL UP. The warnings are the top card of the stack, no two
 *      cards in the stack overlap, and none of them lands on the objective,
 *      the instruments, the minimap or the dock.
 *   2. Everything at once (warnings, an event card with answers, the
 *      patient's pulse, damage, notices, the wind): still no overlap, the
 *      column stays above the minimap, the warnings and the answers are open.
 *   3. Notices: two on screen, the rest wait their turn.
 *   4. The Clean HUD folds the wind to a chip after a few seconds; Full
 *      keeps it open.
 *   5. The banner waits while PULL UP has the middle of the screen.
 *   6. The ring in chapter 1 fades and shrinks out once flown through, and is
 *      gone from the scene.
 *
 * Every import is dynamic, as in the other feature checks.
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`hud stack: ${m}`); };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const frames = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) sim.update(dt); };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const shown = (n) => !!n && n.getClientRects().length > 0;
  const box = (n) => n.getBoundingClientRect();
  const hits = (a, b) => a.width > 2 && b.width > 2 && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const name = (n) => (n.id ? `#${n.id}` : `.${String(n.className).split(' ')[0]}`);
  const fmt = (b) => `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`;
  const low = (n = 16, alt = 55, vy = -14) => {
    const ac = sim.aircraft;
    for (let i = 0; i < n; i++) {
      ac.pos.y = alt;
      ac.vel.y = vy;
      sim.update(0.1);
    }
  };
  const stackEl = () => document.querySelector('#ui .hud-rstack');
  const cards = () => [...(stackEl() ? stackEl().children : [])].filter(shown);
  /** Every pair of overlapping cards in the stack, and every card on the HUD's other corners. */
  const clashes = () => {
    const out = [];
    const list = cards();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) if (hits(box(list[i]), box(list[j]))) out.push(`${name(list[i])} x ${name(list[j])}`);
    }
    const corners = ['#ui .minimap', '#ui .hud-top > .hud-objective', '#ui .hud-left', '#ui .hud-buttons', '#ui .hud-center > *'];
    for (const sel of corners) {
      for (const o of document.querySelectorAll(sel)) {
        if (!shown(o)) continue;
        for (const c of list) if (hits(box(c), box(o))) out.push(`${name(c)} x ${sel}`);
      }
    }
    return out;
  };
  const quit = () => {
    try { sim.quitToMenu('main'); } catch (e) { /* already */ }
  };

  if (!sim.hud || !sim.hud.stack || !stackEl()) {
    r.ok('hud stack: the HUD has its right-hand stack', false, 'no sim.hud.stack');
    return;
  }

  try {
    /* ---- 1. the owner's screenshot ---- */
    log('the owner\'s screenshot');
    await sim.startMode('mission', { id: 'meteor-photo' });
    frames(60);
    sim.weather.load({ time: 'night', condition: 'stormy', windSpeedKts: 18, windDirDeg: 250 });
    low(16);
    frames(2);
    await wait(50);
    const first = cards()[0];
    const c1 = clashes();
    const mt = document.querySelector('.mt-panel');
    const wx = document.querySelector('.wx-panel');
    r.ok(
      'hud stack: the owner\'s Photo run at night with PULL UP — the warnings are the top card, nothing overlaps',
      !!wx && shown(wx) && first === wx && shown(mt) && c1.length === 0,
      `${c1.join(', ') || 'clear'}; cards ${cards().map((n) => `${name(n)} ${fmt(box(n))}`).join(' | ')}; lit ${JSON.stringify(sim.warnings && sim.warnings.active())}`
    );

    /* ---- 2. everything at once ---- */
    log('everything at once');
    const E = await import('../../src/features/events/ui.js');
    sim.hud.setDamage({ leftWing: 0.5, rightWing: 0.2, nose: 0.1 });
    sim.hud.setVital(118, 'warn');
    sim.hud.notify('Gear is down', 'good', 30);
    sim.hud.notify('Minimap range 4 km', 'info', 30);
    E.showCard(sim, { who: 'Radio call', text: 'A pilot needs an escort to the field. Will you help?', choices: [{ key: '8', label: 'Escort them' }, { key: '9', label: 'Not now' }], onChoice() {} });
    if (sim.warnings && sim.warnings.startFire) sim.warnings.startFire();
    low(10);
    frames(3);
    await wait(350); // the events card's own quarter-second watcher shows it
    frames(2);
    const c2 = clashes();
    const st = stackEl().getBoundingClientRect();
    const mm = sim.minimap && sim.minimap.visible && sim.minimap.el ? box(sim.minimap.el) : null;
    const ev = document.getElementById('fx-ev');
    const evOpen = shown(ev) && !ev.classList.contains('rs-chip') && [...ev.querySelectorAll('.fx-choice')].some(shown);
    r.ok(
      'hud stack: warnings, an event card with answers, the pulse, damage and notices at once — no overlap, above the minimap, the answers open',
      c2.length === 0 && evOpen && first === cards()[0] && (!mm || st.bottom <= mm.top),
      `${c2.join(', ') || 'clear'}; stack ${fmt(st)}; minimap ${mm ? fmt(mm) : 'off'}; answers open ${evOpen}`
    );
    E.hideAll();
    sim.hud.setDamage(null);
    sim.hud.setVital(null);
    quit();

    /* ---- 3, 4, 5 in a calm free flight ---- */
    log('notices, the Clean HUD, the banner');
    const before = sim.settings.hudDensity;
    sim.hud.setDensity('clean');
    await sim.startMode('free', { aircraft: 'skylark', airborne: true, taxi: false });
    frames(10);
    for (const t of ['one', 'two', 'three', 'four']) sim.hud.notify(`Notice ${t}`, 'info', 3);
    frames(1);
    const visible = () => [...document.querySelectorAll('#ui .hud-rstack .hud-toast')].filter(shown).map((n) => n.textContent);
    const v1 = visible();
    frames(100); // 3.3 s: the first two have gone, the next two are up
    await wait(450);
    frames(1);
    const v2 = visible();
    r.ok('hud stack: notices — two on screen, the rest wait their turn', v1.join() === 'Notice one,Notice two' && v2.join() === 'Notice three,Notice four', `${v1.join(', ')} then ${v2.join(', ')}`);

    const wind = sim.hud.weatherCard;
    const windShown = shown(wind);
    frames(240); // 8 s
    const folded = wind.classList.contains('rs-chip');
    sim.hud.setDensity('full');
    frames(10);
    const openFull = !wind.classList.contains('rs-chip');
    sim.hud.setDensity(before === 'full' ? 'full' : 'clean');
    r.ok('hud stack: the Clean HUD folds the wind to a chip after a few seconds; Full keeps it open', !windShown || (folded && openFull), `shown ${windShown}, folded ${folded}, open in Full ${openFull}`);

    sim.hud.showBanner('Checkpoint 2 of 5', 'Keep going', 'good', 30);
    frames(1);
    const bannerBefore = shown(sim.hud.banner);
    low(16);
    const cmd = sim.hud.commandUp();
    const bannerDuring = shown(sim.hud.banner);
    r.ok('hud stack: the banner waits while PULL UP has the middle of the screen', bannerBefore && (!cmd || !bannerDuring), `banner ${bannerBefore}, command ${cmd}, banner during ${bannerDuring}`);
    sim.hud.clearTransient();
    quit();

    /* ---- 6. chapter 1's ring ---- */
    log('chapter 1\'s ring');
    // The story's save is the player's: kept and put back (as story.browser.js does).
    const KEY = 'islandsim.story.v1';
    let storySave = null;
    try { storySave = localStorage.getItem(KEY); } catch (e) { storySave = null; }
    let D = null;
    try {
      D = await import('../../src/story/director.js');
      const C = await import('../../src/story/chapters.js');
      await D.startChapter(C.chapterById('ch01-the-glint'), { fresh: true, skipBriefing: true });
      frames(30);
      const ring = () => {
        let g = null;
        sim.scene.traverse((o) => {
          if (!g && o.geometry && o.geometry.type === 'TorusGeometry' && o.geometry.parameters && o.geometry.parameters.radius === 150) g = o.parent;
        });
        return g;
      };
      const gate = ring();
      if (!gate) {
        r.ok('hud stack: chapter 1 has its giant ring', false, 'no 150 m ring in the scene');
      } else {
        sim.aircraft.pos.copy(gate.position);
        frames(1);
        frames(12); // 0.4 s
        const mid = gate.scale.x;
        frames(36); // 1.2 s more
        const gone = !ring() && !gate.parent;
        r.ok('hud stack: chapter 1\'s ring fades and shrinks out once flown through, then is gone', mid < 0.99 && gone, `scale at 0.4 s ${mid.toFixed(2)}, gone ${gone}`);
      }
    } catch (err) {
      r.ok('hud stack: chapter 1 starts for the ring check', false, String(err && err.message));
    }
    quit();
    try {
      if (storySave == null) localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, storySave);
      if (D && D.reloadSave) D.reloadSave();
    } catch (e) {
      /* storage blocked: nothing to put back */
    }
  } catch (err) {
    r.ok('hud stack: the checks ran to the end', false, String(err && err.stack || err).slice(0, 400));
    quit();
  } finally {
    sim.autoPauseOnHide = origAuto;
  }
}

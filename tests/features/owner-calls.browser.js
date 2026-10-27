/**
 * The owner's four calls of 2026-10-26 (w17) in the real game. The node side
 * is tests/features/owner-calls.mjs.
 *
 *   1. The radio: Z opens the radio card like F8; the card names "F8 or Z"
 *      ("fn F8 or Z" on a Mac); a key typed into a text field or an editable
 *      box never opens it; in a Meteor zap mode Z is the zapper's; the touch
 *      RADIO button still opens it; the H card lists the radio with F8 and Z.
 *   2. Gateway in the A380 (then the BelugaXL and the 747), Start at: Gate: a
 *      real gate, nose on the stand, the jet bridge docks, nothing parked
 *      within its wingspan, and in the A380 the ground crew and the pushback
 *      run to the end.
 *   3. Warnings (PULL UP, ENGINE FIRE) and an event card with answers at
 *      once, at whatever size this page is: every answer button and the
 *      warnings are on screen and are what a tap there hits; nothing in the
 *      column sits on a visible minimap; when the minimap steps aside it does
 *      so only while they are up, and comes back when they clear. At a big
 *      desktop size (1280x800 and up) it never steps aside.
 *
 * Run it at several sizes with a viewport-emulating runner; at the default
 * size with one-check:
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/owner-calls.browser.js check "" 1
 */

export const id = 'owner-calls';

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`owner-calls: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const mapWas = sim.settings.map;
  const frames = (n, dt = 1 / 30) => { for (let i = 0; i < n; i++) sim.update(dt); };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const key = (code, down = true, target = window) => target.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
  const tap = (code, target) => { key(code, true, target); key(code, false, target); };
  const visible = (n) => {
    if (!n || !n.getClientRects().length) return false;
    for (let e = n; e && e.nodeType === 1; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) return false;
    }
    return true;
  };
  const B = (n) => n.getBoundingClientRect();
  const hits = (a, b) => a.width > 2 && b.width > 2 && a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const fmt = (n) => { const b = B(n); return `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`; };
  const I = await import('../../src/flight/input.js');
  const PS = await import('../../src/features/pilot-systems.js');
  const closeRadio = () => { const x = document.querySelector('.ps-radio .ps-close'); if (x) x.click(); };
  try {
    /* ---------------- 1. the radio key ---------------- */
    say('owner-calls: the radio key');
    await sim.startMode('free', { aircraft: 'skylark', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0 });
    frames(10);
    closeRadio();
    tap('KeyZ');
    frames(2);
    const card = document.querySelector('.ps-radio');
    ok('Z opens the radio card, like F8', PS.systemsState().radioOpen && visible(card), `open ${PS.systemsState().radioOpen}`);
    I.setMacKeyboard(true);
    I.useInput(sim.input);
    frames(2);
    const macNote = (card && card.querySelector('.ps-rkey') || {}).textContent || '';
    I.setMacKeyboard(false);
    I.useInput(sim.input);
    frames(2);
    const pcNote = (card && card.querySelector('.ps-rkey') || {}).textContent || '';
    I.setMacKeyboard(null);
    I.useInput(sim.input);
    frames(2);
    const touchCard = /on the sheet/.test(pcNote);
    ok('the card names "fn F8 or Z" on a Mac and "F8 or Z" elsewhere (a touch screen names its RADIO button)', touchCard || (macNote === 'fn F8 or Z' && pcNote === 'F8 or Z'), `Mac "${macNote}", PC "${pcNote}"`);
    closeRadio();
    frames(1);

    // Typing.
    const field = document.createElement('input');
    field.type = 'text';
    const box = document.createElement('div');
    box.contentEditable = 'true';
    document.body.append(field, box);
    field.focus();
    tap('KeyZ', field);
    frames(2);
    const typedField = PS.systemsState().radioOpen;
    box.focus();
    tap('KeyZ', box);
    frames(2);
    const typedBox = PS.systemsState().radioOpen;
    field.remove();
    box.remove();
    ok('Z typed into a text field or an editable box does not open the radio', !typedField && !typedBox, `field ${typedField}, box ${typedBox}`);
    closeRadio();

    // The H card.
    tap('KeyH');
    frames(1);
    const help = sim.hud.controlsCard ? sim.hud.controlsCard.textContent : '';
    tap('KeyH');
    frames(1);
    ok('the H card lists the radio with F8 and Z', /Radio: request[^]*?F8[^]*?Z/.test(help), (help.match(/Radio: request.{0,80}/) || [''])[0]);

    // The touch button (the sheet's RADIO presses the same action).
    sim.hudAction('atcRequest');
    frames(2);
    const viaTouch = PS.systemsState().radioOpen;
    closeRadio();
    let sheetTap = 'no sheet (not a touch screen)';
    const sheetBtn = document.querySelector('.touch-sheet-btn[data-act="atcRequest"]');
    if (sheetBtn) {
      sheetBtn.click();
      frames(2);
      sheetTap = PS.systemsState().radioOpen ? 'the sheet button opened it' : 'the sheet button did NOT open it';
      closeRadio();
    }
    ok('the touch RADIO button still opens the radio', viaTouch && !/NOT/.test(sheetTap), sheetTap);

    // A Meteor zap mode: Z zaps, the radio stays shut, F8 still opens it.
    if (sim.meteors && sim.meteors.begin) {
      sim.meteors.begin({ mode: 'shower' });
      frames(2);
      const zapping = sim.meteors.zapping;
      tap('KeyZ');
      frames(2);
      const zOpened = PS.systemsState().radioOpen;
      tap('F8');
      frames(2);
      const f8Opened = PS.systemsState().radioOpen;
      closeRadio();
      sim.meteors.end();
      frames(2);
      ok('in a Meteor zap mode Z is the zapper\'s (the radio stays shut) and F8 still opens the radio', zapping && !zOpened && f8Opened, `zapping ${zapping}, Z opened ${zOpened}, F8 opened ${f8Opened}`);
    }

    /* ---------------- 3. small screens ---------------- */
    say('owner-calls: warnings and answers on a small screen');
    const E = await import('../../src/features/events/ui.js');
    const low = (n = 10) => { const ac = sim.aircraft; for (let i = 0; i < n; i++) { ac.pos.y = 55; ac.vel.y = -14; sim.update(0.1); } };
    E.showCard(sim, { who: 'Radio call', text: 'A pilot needs an escort to the field. Will you help?', choices: [{ key: '8', label: 'Escort them' }, { key: '9', label: 'Not now' }], onChoice() {} });
    if (sim.warnings && sim.warnings.startFire) sim.warnings.startFire();
    low(10);
    frames(3);
    await wait(350);
    frames(3);
    await wait(300);
    frames(2);
    const W = innerWidth;
    const H = innerHeight;
    const mm = document.querySelector('#ui > .minimap');
    const yielded = document.documentElement.classList.contains('hud-map-yield');
    const mmShown = visible(mm);
    const wx = document.querySelector('.wx-panel');
    const choices = [...document.querySelectorAll('#fx-ev .fx-choice')].filter(visible);
    const urgent = [wx, ...choices].filter(visible);
    const controls = [...document.querySelectorAll('#ui .touch-stick, #ui .touch-throttle, #ui .touch-pads, #ui .touch-rudder, #ui .hud-buttons, #ui .hud-left, .ej-col .ej-btn.is-on')].filter(visible);
    // The controls themselves stay clear of each other (the bail-out handle moves beside the stick on a landscape phone).
    const ctrlClash = [];
    for (let i = 0; i < controls.length; i++) for (let j = i + 1; j < controls.length; j++) {
      const a = controls[i];
      const b = controls[j];
      if (/ej-btn/.test(a.className) || /ej-btn/.test(b.className)) if (hits(B(a), B(b))) ctrlClash.push(`${String(a.className).split(' ')[0]} x ${String(b.className).split(' ')[0]}`);
    }
    const probs = [];
    for (const n of urgent) {
      const b = B(n);
      const name = n === wx ? 'warnings' : `answer "${n.textContent.trim()}"`;
      if (b.left < -1 || b.top < -1 || b.right > W + 1 || b.bottom > H + 1) probs.push(`${name} off screen ${fmt(n)}`);
      if (mmShown && hits(b, B(mm))) probs.push(`${name} on the minimap`);
      for (const c of controls) if (hits(b, B(c))) probs.push(`${name} on ${String(c.className).split(' ')[0]}`);
      // What a finger on it hits: the answer itself, and each of the warnings' lamps (the card's own buttons).
      for (const t of n === wx ? [...wx.querySelectorAll('button')].filter(visible) : [n]) {
        const tb = B(t);
        const cx = Math.min(W - 1, Math.max(0, (tb.left + tb.right) / 2));
        const cy = Math.min(H - 1, Math.max(0, (tb.top + tb.bottom) / 2));
        const top = document.elementFromPoint(cx, cy);
        if (!(top && (t === top || t.contains(top)))) probs.push(`${name}: a tap there hits ${top ? (top.id ? `#${top.id}` : `.${String(top.className).split(' ')[0]}`) : 'nothing'}`);
      }
    }
    ok(`at ${W}x${H}: the warnings and both answers are on screen, clear of the controls and the minimap, and a tap hits them`, choices.length === 2 && visible(wx) && probs.length === 0,
      `${probs.join('; ') || 'clear'}; minimap ${mmShown ? fmt(mm) : 'hidden'}${yielded ? ' (stepped aside)' : ''}; warnings ${visible(wx) ? fmt(wx) : 'hidden'}; answers ${choices.map(fmt).join(' / ')}`);
    ok(`at ${W}x${H}: the bail-out / eject handle is clear of the stick, the rudder and the pads`, ctrlClash.length === 0, ctrlClash.join(', ') || 'clear');
    const stack = [...document.querySelectorAll('#ui .hud-rstack > *')].filter(visible);
    const onMap = mmShown ? stack.filter((c) => hits(B(c), B(mm))) : [];
    ok(`at ${W}x${H}: no card in the column sits on a visible minimap`, onMap.length === 0, onMap.map((c) => c.id || String(c.className).split(' ')[0]).join(', ') || 'none');
    if (W >= 1280 && H >= 800) ok(`at ${W}x${H} (a big screen): the minimap stays`, !yielded && mmShown, `stepped aside ${yielded}`);
    else ok(`at ${W}x${H}: the minimap is hidden only while it has stepped aside`, yielded ? !mmShown : true, `stepped aside ${yielded}, shown ${mmShown}`);
    // (checker, w17) While stepped aside the column was laid out every frame (the off-and-on test left it dirty).
    {
      const st = sim.hud.stack;
      const real = st.refresh;
      let n = 0;
      st.refresh = function (...a) { n++; return real.apply(this, a); };
      try { frames(30); } finally { st.refresh = real; }
      ok(`at ${W}x${H}: with the warnings and the answers up, the column is decided about four times a second, not every frame`, n <= 6, `${n} in 30 frames (1 s), stepped aside ${document.documentElement.classList.contains('hud-map-yield')}`);
    }
    // (checker, w17) And the radio opened on top of them: on a phone the radio card (a `keep` card too) ran
    // past the column, its buttons under the stick or off the bottom of the screen. It waits now, or fits.
    const tapHits = (t) => {
      const b = B(t);
      if (b.left < 0 || b.top < 0 || b.right > W || b.bottom > H) return `${t.textContent.trim().slice(0, 14)} off screen ${fmt(t)}`;
      const top = document.elementFromPoint((b.left + b.right) / 2, (b.top + b.bottom) / 2);
      return top && (t === top || t.contains(top)) ? '' : `${t.textContent.trim().slice(0, 14)}: a tap hits ${top ? `.${String(top.className).split(' ')[0]}` : 'nothing'}`;
    };
    PS.pressRadio(sim);
    frames(3);
    await wait(300);
    frames(3);
    {
      const rc = document.querySelector('.ps-radio');
      const held = !visible(rc);
      const bad = [...(held ? [] : [...rc.querySelectorAll('button')].filter(visible)), ...[...document.querySelectorAll('#fx-ev .fx-choice')].filter(visible)].map(tapHits).filter(Boolean);
      const answers = [...document.querySelectorAll('#fx-ev .fx-choice')].filter(visible).length;
      ok(`at ${W}x${H}: the radio opened on top of the warnings and an event card waits or fits; the answers stay, every button showing is on screen and is what a tap hits`, answers === 2 && bad.length === 0, `radio ${held ? 'held back' : fmt(rc)}; ${bad.join('; ') || 'clear'}`);
    }
    closeRadio();
    frames(2);
    E.hideAll();
    if (sim.warnings && sim.warnings.reset) sim.warnings.reset();
    sim.aircraft.pos.y = 900;
    sim.aircraft.vel.y = 0;
    frames(20);
    await wait(400);
    frames(4);
    const after = document.documentElement.classList.contains('hud-map-yield');
    ok(`at ${W}x${H}: when they clear, the minimap comes back`, !after && (!sim.minimap || !sim.minimap.visible || visible(mm) || Number(getComputedStyle(mm).opacity) > 0), `stepped aside ${after}, warnings ${JSON.stringify(sim.warnings && sim.warnings.active())}`);
    // (checker, w17) The warnings alone (no card of answers): on a landscape phone the column stood aside,
    // measured the band in the map's corner as 0 px, came back to the right ON the instrument band
    // (warnings at y 12 over .hud-left / .hud-buttons) and stood aside and back every refresh.
    if (sim.warnings && sim.warnings.startFire) sim.warnings.startFire();
    low(10);
    frames(3);
    await wait(350);
    frames(3);
    {
      const st = sim.hud.stack;
      const real = st.refresh;
      let n = 0;
      const states = [];
      st.refresh = function (...a) { n++; const v = real.apply(this, a); states.push(this.yielding); return v; };
      try { frames(30); } finally { st.refresh = real; }
      const cardsUp = [...document.querySelectorAll('#ui .hud-rstack > *')].filter(visible);
      const band = [...document.querySelectorAll('#ui .hud-left, #ui .hud-buttons, #ui .hud-top > .hud-objective')].filter(visible);
      const over = [];
      for (const c of cardsUp) for (const b of band) if (hits(B(c), B(b))) over.push(`${c.id || String(c.className).split(' ')[0]} x ${String(b.className).split(' ')[0]}`);
      if (visible(mm)) for (const c of cardsUp) if (hits(B(c), B(mm))) over.push(`${c.id || String(c.className).split(' ')[0]} x minimap`);
      ok(`at ${W}x${H}: the warnings alone sit clear of the instrument band and the minimap, and the column settles (decided about four times a second, one place)`,
        visible(wx) && over.length === 0 && n <= 6 && new Set(states).size <= 1,
        `${over.join(', ') || 'clear'}; warnings ${visible(wx) ? fmt(wx) : 'hidden'}; ${n} refreshes, stood aside ${JSON.stringify([...new Set(states)])}`);
    }
    if (sim.warnings && sim.warnings.reset) sim.warnings.reset();
    sim.aircraft.pos.y = 900;
    sim.aircraft.vel.y = 0;
    frames(20);
    await wait(400);
    frames(4);
    // (checker, w17) The radio on its own: shown, and on an upright phone its four requests no longer run
    // 12 px past the card and off the edge of a 375 px screen.
    PS.pressRadio(sim);
    frames(3);
    await wait(300);
    frames(3);
    {
      const rc = document.querySelector('.ps-radio');
      const btns = visible(rc) ? [...rc.querySelectorAll('button')].filter(visible) : [];
      const bad = btns.map(tapHits).filter(Boolean);
      ok(`at ${W}x${H}: the radio on its own shows, every button on screen and what a tap hits`, btns.length >= 5 && bad.length === 0, `${visible(rc) ? fmt(rc) : 'hidden'}; ${bad.join('; ') || 'clear'}`);
    }
    closeRadio();
    frames(2);

    /* ---------------- 2. heavy jets at a Gateway gate ---------------- */
    say('owner-calls: Gateway, the A380 at a gate');
    if (sim.settings.map !== 'gateway') {
      sim.setMap('gateway');
      for (let i = 0; i < 100 && (sim._worldBuilding || sim.settings.map !== 'gateway'); i++) await wait(100);
      await wait(1500);
    }
    const SV = (await import('../../src/features/airport-services.js')).__airportServices.S;
    for (const type of ['a380', 'belugaxl', 'b747']) {
      await sim.startMode('free', { aircraft: type, startAt: 'gate', time: 'day', condition: 'clear', windSpeedKts: 0 });
      const st = sim.spawns.state();
      const d = st.decided || {};
      const ac = sim.aircraft;
      frames(30);
      await wait(600); // the visitor scan runs twice a second
      frames(30);
      const standId = st.last && st.last.standId;
      const bridge = sim.apron && sim.apron.bridges ? sim.apron.bridges.find((b) => b.st && b.st.id === standId) : null;
      const span = (sim.aircraftType && sim.aircraftType.plan && sim.aircraftType.plan.span) || 60;
      const crowd = (sim.traffic || []).filter((t) => t && t.pos && Math.hypot(t.pos.x - ac.pos.x, t.pos.z - ac.pos.z) < span / 2 + (t.span || 12) / 2 + 3).map((t) => t.callsign || t.id);
      ok(`the ${type} asked for a Gateway gate is on one (not the runway), its jet bridge docked, nothing parked within its span`,
        sim.aircraftType && sim.aircraftType.id === type && d.placed && d.kind === 'stand' && bridge && bridge.visitor && crowd.length === 0,
        `${sim.aircraftType && sim.aircraftType.id}: ${JSON.stringify({ kind: d.kind, stand: standId, label: d.label })}; bridge ${bridge ? `visitor ${bridge.visitor}` : 'none'}; nearby ${crowd.join(', ') || 'none'}; at ${ac.pos.x.toFixed(1)}, ${ac.pos.z.toFixed(1)}`);
      if (type !== 'a380') continue;
      // The crew and the push, as Tom does it.
      if (!ac.engineOn) sim.tap('KeyI');
      for (let t = 0; t < 30 && !ac.engineOn; t++) sim.step(1);
      sim.tap('KeyP');
      for (let t = 0; t < 150 && SV.state !== 'serviced'; t++) sim.step(1);
      const serviced = SV.state;
      sim.tap('KeyP');
      for (let t = 0; t < 240 && SV.state === 'pushback'; t++) sim.step(1);
      const moved = Math.hypot(ac.pos.x - st.last.x, ac.pos.z - st.last.z);
      ok('the A380: the ground crew come, the push runs to the end and it is off the stand', serviced === 'serviced' && SV.state === 'pushed' && moved > 30, `crew ${serviced}, then ${SV.state}, moved ${moved.toFixed(0)} m`);
    }
  } catch (e) {
    ok('the check itself ran', false, String(e && (e.stack || e.message)).slice(0, 400));
  } finally {
    I.setMacKeyboard(null);
    sim.autoPauseOnHide = autoPause;
    try {
      const E = await import('../../src/features/events/ui.js');
      E.hideAll();
    } catch (e) { /* gone */ }
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    if (mapWas && mapWas !== sim.settings.map && sim.setMap) sim.setMap(mapWas);
  }
}

/**
 * Browser check for "make it so in settings u can change keybinds".
 *
 * Everything through the real screens and real key events, the way a child
 * does it: Esc to pause, Settings, the Controls tab, click a key cap, press
 * the new key — and then fly with it:
 *
 *   - the Controls tab lists every group, the game you are in first and open;
 *   - Esc while a cap is waiting cancels (and does not unpause the game);
 *   - Eject onto Backspace asks "This key already does Self-destruct — swap
 *     them?"; Swap moves Self-destruct to Enter;
 *   - Get out onto ' (a free key) just takes it; Start engine onto ;
 *   - Smoke onto G asks about Landing gear; Cancel leaves both alone;
 *   - in the F-22, the key line names Backspace for eject, Enter now opens
 *     the self-destruct cover (not the seat), and Backspace twice ejects —
 *     every message naming the new key;
 *   - parked, O no longer gets you out and ' does, and the prompts say ';
 *   - the coach says "Press ; to start the engine", and the H card lists the
 *     moved keys;
 *   - walking, Settings opens on the On foot group;
 *   - Reset Flying keys, then Reset all keys, put everything back.
 *
 * The player's own bindings are put back at the end, whatever happens.
 */

export const id = 'keybinds';

export async function check(sim, r, say) {
  say && say('keybinds: rebinding through Settings, then flying with it');
  let I;
  let E;
  let OF;
  try {
    I = await import('../../src/flight/input.js');
    E = (await import('../../src/features/eject.js')).eject;
    OF = (await import('../../src/features/onfoot.js')).onFoot;
  } catch (err) {
    r.ok('keybinds: modules load', false, String(err && err.message));
    return;
  }
  const inp = sim.input;
  const menus = sim.menus;
  const saved = JSON.stringify(inp.bindings);
  const wasAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;

  const run = (s) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) sim.step(1 / 60);
  };
  const key = (code, down = true) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
  const tap = (code) => {
    key(code, true);
    key(code, false);
  };
  const S = () => menus.screens.settings;
  const cap = (action) => S().querySelector(`[data-bind="${action}"]`);
  const ask = () => S().querySelector('[data-keymap-ask]');
  const lastToast = () => {
    const t = [...document.querySelectorAll('.hud-toast')];
    return t.length ? t[t.length - 1].textContent : '';
  };
  const openGroup = (g) => {
    const d = S().querySelector(`details[data-keygroup="${g}"]`);
    if (d && !d.open) d.querySelector('summary').click();
    return d;
  };
  /** Pause, Settings, Controls: the way a player gets there. */
  const toControls = () => {
    if (sim.state === 'flying') {
      tap('Escape');
      run(1 / 60);
    }
    const p = menus.screens.pause.querySelector('[data-act="settings"]');
    if (p) p.click();
    const tab = S().querySelector('[data-tab="controls"]');
    if (tab) tab.click();
    return !S().hidden && !S().querySelector('[data-panel="controls"]').hidden;
  };
  /** Back out of Settings and resume. */
  const backToFlying = () => {
    const back = S().querySelector('[data-back]');
    if (back) back.click();
    const res = menus.screens.pause.querySelector('[data-act="resume"]');
    if (res) res.click();
    run(0.1);
  };
  /** Click a key cap and press a key, as a child does. */
  const rebind = (action, code) => {
    openGroup(I.ACTIONS[action].group);
    const b = cap(action);
    if (!b) return false;
    b.click();
    const waiting = b.classList.contains('is-listening') && /press a key/i.test(b.textContent);
    tap(code);
    return waiting;
  };

  try {
    inp.resetBindings();

    /* ---------------- Settings → Controls, from a flight ---------------- */
    await sim.startMode('free', { aircraft: 'f22', airborne: true, taxi: false });
    run(0.5);
    const there = toControls();
    r.ok('keybinds: Esc → Settings → Controls opens the key map', there && sim.state === 'paused', `state ${sim.state}`);
    const groups = [...S().querySelectorAll('details[data-keygroup]')].map((d) => d.dataset.keygroup);
    const caps = S().querySelectorAll('[data-bind]').length;
    r.ok('keybinds: every group is there, flying first and open (the game you are in)', groups[0] === 'Flying' && S().querySelector('details[data-keygroup="Flying"]').open
      && ['Helicopter', 'Boat', 'Car', 'Rocket', 'On foot', 'Multiplayer & PvP', 'Fun Stuff', 'Missions & events', 'View', 'Game'].every((g) => groups.includes(g))
      && !S().querySelector('details[data-keygroup="Car"]').open, groups.join(' · '));
    r.ok('keybinds: a key cap for every action in the registry', caps === Object.keys(I.ACTIONS).length, `${caps} caps, ${Object.keys(I.ACTIONS).length} actions`);

    // Esc cancels.
    const waited = rebind('eject', 'Escape');
    run(1 / 60);
    r.ok('keybinds: Esc while a key cap waits cancels — eject keeps Enter, and the game stays paused', waited && inp.bindings.eject[0] === 'Enter' && sim.state === 'paused' && !S().hidden && /Enter/.test(cap('eject').textContent), `eject ${inp.bindings.eject} · ${sim.state}`);

    // A clash: Eject onto Backspace (Self-destruct's).
    rebind('eject', 'Backspace');
    const q = ask();
    const qText = q && !q.hidden ? q.textContent : '';
    r.ok('keybinds: Backspace for eject asks "This key already does Self-destruct — swap them?"', /already does Self-destruct/.test(qText) && /swap them\?/i.test(qText) && /will get Enter/.test(qText) && inp.bindings.eject[0] === 'Enter', qText);
    const swapBtn = q && [...q.querySelectorAll('button')].find((b) => /swap/i.test(b.textContent));
    if (swapBtn) swapBtn.click();
    r.ok('keybinds: Swap them — eject is on Backspace, self-destruct on Enter, no clash marked', inp.bindings.eject.join() === 'Backspace' && inp.bindings.selfDestruct.join() === 'Enter'
      && /Backspace/.test(cap('eject').textContent) && /Enter/.test(cap('selfDestruct').textContent) && !S().querySelector('.keymap-row.is-clash'), `eject ${inp.bindings.eject} · self-destruct ${inp.bindings.selfDestruct}`);

    // A free key: Get out onto ', Start engine onto ;.
    rebind('getOut', 'Minus');
    rebind('starter', 'Equal');
    r.ok('keybinds: a free key is simply taken (Get out → -, Start engine → =)', inp.bindings.getOut.join() === 'Minus' && inp.bindings.starter.join() === 'Equal' && /is now/.test(ask().textContent), `${inp.bindings.getOut} ${inp.bindings.starter}: ${ask().textContent}`);

    // A clash, cancelled: Smoke onto G.
    rebind('smoke', 'KeyG');
    const q2 = ask().textContent;
    const cancel = [...ask().querySelectorAll('button')].find((b) => /cancel/i.test(b.textContent));
    if (cancel) cancel.click();
    r.ok('keybinds: Smoke onto G asks about Landing gear; Cancel leaves both alone', /already does Landing gear/.test(q2) && inp.bindings.smoke.join() === 'KeyT' && inp.bindings.gear.join() === 'KeyG', `${q2} → smoke ${inp.bindings.smoke}`);
    r.ok('keybinds: the keys are saved with the settings', (() => {
      try { return JSON.parse(localStorage.getItem('islandsim.bindings.v1')).eject.join() === 'Backspace'; } catch (e) { return false; }
    })(), '');

    /* ---------------- flying with them ---------------- */
    backToFlying();
    run(0.6);
    r.ok('keybinds: back in the air', sim.state === 'flying', sim.state);
    const line = (document.querySelector('.hud-keyhint') || {}).textContent || '';
    r.ok('keybinds: the key line says Backspace ejects and Enter self-destructs', /Backspace eject/.test(line) && /Enter self-destruct/.test(line), line);
    tap('Enter');
    run(0.1);
    const t1 = lastToast();
    r.ok('keybinds: the old eject key does not eject — Enter is self-destruct now (its cover opens, naming Enter)', E.phase === 'idle' && /Safety cover open/.test(t1) && /press Enter again/.test(t1), `${E.phase}: ${t1}`);
    run(4.5); // the cover closes by itself
    tap('Backspace');
    run(0.1);
    const t2 = lastToast();
    r.ok('keybinds: the new key arms the seat — "Press Backspace again to EJECT!"', E.phase === 'idle' && /Press Backspace again to EJECT/.test(t2), t2);
    tap('Backspace');
    run(0.2);
    r.ok('keybinds: and Backspace again ejects', E.phase === 'out', `phase ${E.phase}`);

    /* ---------------- on the ground: get out, the prompts, the coach, H ---------------- */
    await sim.startMode('free', { aircraft: 'skylark', taxi: false });
    run(2.2);
    const pr = () => (document.querySelector('.of-prompt') || {}).innerHTML || '';
    const prompt = pr();
    r.ok('keybinds: parked, the prompt says "Press - to get out"', /Press <kbd>-<\/kbd> to get out/.test(prompt), prompt);
    tap('KeyO');
    run(0.3);
    const outOnO = OF.active;
    tap('Minus');
    run(0.5);
    r.ok('keybinds: O no longer gets you out; - does', !outOnO && OF.active, `O → ${outOnO}, - → ${OF.active}`);
    // Walking: Settings opens on the On foot group.
    toControls();
    const firstOnFoot = (S().querySelector('details[data-keygroup]') || {}).dataset;
    r.ok('keybinds: paused while walking, Settings opens on the On foot keys', firstOnFoot && firstOnFoot.keygroup === 'On foot' && S().querySelector('details[data-keygroup="On foot"]').open, firstOnFoot && firstOnFoot.keygroup);
    backToFlying();
    tap('Minus');
    run(0.5);
    r.ok('keybinds: - gets you back in', !OF.active, `walking ${OF.active}`);

    // The coach names the moved starter.
    const ac = sim.aircraft;
    ac.engineOn = false;
    ac.rpm = 0;
    run(0.3);
    const coach = sim.hud.coach ? sim.hud.coach.innerHTML : '';
    r.ok('keybinds: the coach says "Press = to start the engine"', /Press <kbd>=<\/kbd> to start the engine/.test(coach), coach);
    tap('KeyI');
    run(0.2);
    const noStart = !ac.engineOn;
    tap('Equal');
    run(0.4);
    r.ok('keybinds: I no longer starts the engine; = does', noStart && (ac.engineOn || ac.starting || ac.rpm > 0), `I → ${!noStart}, = → ${ac.engineOn}`);

    // H: the card names the player's keys.
    tap('KeyH');
    run(0.1);
    const card = sim.hud.controlsCard ? sim.hud.controlsCard.textContent : '';
    tap('KeyH');
    run(0.1);
    r.ok('keybinds: the H card lists Eject on Backspace, Start engine on =, and Get out on -', /Eject[^]*?Backspace/.test(card) && /Start \/ stop engine\s*=/.test(card) && /Get out \/ get in\s*-/.test(card), card.slice(0, 200));

    /* ---------------- reset ---------------- */
    toControls();
    openGroup('Flying');
    const rf = S().querySelector('[data-reset-group="Flying"]');
    if (rf) rf.click();
    r.ok('keybinds: Reset Flying keys — eject, self-destruct and the starter are back; Get out is not (it is On foot)', inp.bindings.eject.join() === 'Enter,NumpadEnter' && inp.bindings.selfDestruct.join() === 'Backspace' && inp.bindings.starter.join() === 'KeyI' && inp.bindings.getOut.join() === 'Minus', `eject ${inp.bindings.eject} · getOut ${inp.bindings.getOut}`);
    const ra = S().querySelector('[data-reset-keys]');
    if (ra) ra.click();
    const all = Object.keys(I.ACTIONS).every((id) => JSON.stringify(inp.bindings[id]) === JSON.stringify(I.ACTIONS[id].default));
    r.ok('keybinds: Reset all keys — every key back to how it started, and the caps say so', all && /O/.test(cap('getOut').textContent) && /Enter/.test(cap('eject').textContent), `getOut ${inp.bindings.getOut}`);
    backToFlying();
  } catch (err) {
    r.ok('keybinds: the check ran to the end', false, String(err && err.stack || err).slice(0, 300));
  } finally {
    try {
      inp.cancelCapture();
      const b = JSON.parse(saved);
      for (const id in inp.bindings) if (Array.isArray(b[id])) inp.bindings[id] = b[id];
      inp.save();
      if (menus.screens.settings && !menus.screens.settings.hidden) {
        const back = menus.screens.settings.querySelector('[data-back]');
        if (back) back.click();
      }
      if (sim.state === 'paused' && typeof sim.resume === 'function') sim.resume();
    } catch (e) {
      /* the next check starts its own flight */
    }
    sim.autoPauseOnHide = wasAutoPause;
  }
  return r;
}

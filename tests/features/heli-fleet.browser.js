/**
 * THE HELICOPTER WAVE IN THE BROWSER — the seven new rotorcraft
 * (aircraft/extra/helis.js) started in Free Flight in headless Chrome, the
 * way the hangar starts them, each one: on the pad with its own airframe and
 * its rotor turning, the Heli game's keys and card up, lifted off on Shift
 * and holding a hover hands off; the Bell 407 then loses its engine at
 * height and the assist autorotates it down while the card says so.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/heli-fleet.browser.js check "" 1
 *
 * or from the console:
 *   const s = window.__sim; s.renderer.render = () => {};
 *   const r = { checks: [], ok(n, p, d = '') { this.checks.push({ n, p: !!p, d: String(d) }); return !!p; } };
 *   await (await import('/tests/features/heli-fleet.browser.js')).check(s, r, console.log);
 *
 * tests/features/heli-fleet.mjs is the same wave in node, in detail.
 */
const WAVE = ['bell407', 'h145', 'r44', 'aw139', 'uh60', 'ch47', 'ah64', 'vh3d'];
const KEYS = { Shift: ['ShiftLeft', 'Shift'], Ctrl: ['ControlLeft', 'Control'], W: ['KeyW', 'w'] };

export async function check(sim, r, say = () => {}) {
  const press = (k) => window.dispatchEvent(new KeyboardEvent('keydown', { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const release = (k) => window.dispatchEvent(new KeyboardEvent('keyup', { code: KEYS[k][0], key: KEYS[k][1], bubbles: true }));
  const allUp = () => {
    for (const k in KEYS) release(k);
  };
  const ac = () => sim.aircraft;
  const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const hud = () => sim.hud || {};
  const skidH = () => {
    const R = ac().rotor;
    if (R && Number.isFinite(R.heightAbove)) return R.heightAbove;
    return ac().agl;
  };
  const f1 = (v) => (Number.isFinite(v) ? v.toFixed(1) : String(v));
  const f2 = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
  const DT = 1 / 15;
  const run = (secs, each) => {
    const n = Math.max(1, Math.round(secs / DT));
    for (let i = 0; i < n; i++) {
      if (sim.state === 'paused' && typeof sim.resume === 'function') sim.resume();
      sim.step(DT);
      if (each && each() === true) return true;
    }
    return false;
  };
  const hold = (keys, secs, each) => {
    for (const k of keys) press(k);
    const out = run(secs, each);
    for (const k of keys) release(k);
    return out;
  };

  const origRender = sim.renderer.render;
  sim.renderer.render = () => {};
  const origAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const origDiff = (sim.settings && sim.settings.difficulty) || 'normal';
  const origAssist = sim.settings ? sim.settings.heliAssist : undefined;
  const origUnlocking = sim._unlocking;
  if (sim.audio && !sim.audio.started) sim._unlocking = true;
  const prog = sim.prog || (sim.menus && sim.menus.prog) || null;

  const start = async (id) => {
    allUp();
    if (typeof sim.applyDifficulty === 'function') sim.applyDifficulty('normal');
    if (sim.settings) sim.settings.heliAssist = true;
    await sim.startMode('free', { aircraft: id, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
    allUp();
    run(1);
  };

  try {
    /* ---------------------------------------------------- the hangar */
    say('heli fleet: the hangar');
    const cards = WAVE.map((id) => document.querySelector(`[data-aircraft="${id}"]`));
    r.ok('every helicopter of the wave has a card in the hangar', cards.every((c) => !!c), WAVE.filter((id, i) => !cards[i]).join(', ') || 'all seven');
    const heads = cards.map((c) => c && c.closest('[data-cat]') && c.closest('[data-cat]').dataset.cat);
    r.ok('...under the Helicopters heading, the military three included', cards.every((c) => c && c.dataset.cat === 'helicopter'), cards.map((c) => c && c.dataset.cat).join(', ') || heads.join(','));

    /* ------------------------------------------------- each one flies */
    for (const id of WAVE) {
      say(`heli fleet: ${id}`);
      await start(id);
      const type = sim.aircraftType;
      // (The switcher's Heli tab lights for any rotorcraft; `sim.game` is which home screen you came from.)
      r.ok(`${id}: Free Flight starts in it, with the Heli tab lit`, sim.state === 'flying' && type && type.id === id && sim.menus && sim.menus.currentGame === 'heli', `${sim.state} ${type && type.id} tab ${sim.menus && sim.menus.currentGame}`);
      r.ok(`${id}: the helicopter's keys and card are up (ASSIST chip, no gear or flap chips)`, sim.input && sim.input.context === 'heli' && hud().heliCard && !hud().heliCard.hidden && text(hud().assistChip) === 'ASSIST ON' && hud().gearChip && hud().gearChip.hidden, `${sim.input && sim.input.context} / ${text(hud().assistChip)}`);
      const model = sim.model;
      const parts = model && model.userData && model.userData.parts;
      r.ok(`${id}: drawn by its own airframe, with ${id === 'ch47' ? 'two rotors' : 'a rotor and a tail rotor'}`, model && model.userData.civil === id && parts && parts.rotors && parts.rotors.length === (id === 'ch47' ? 2 : 1) && (id === 'ch47' || !!parts.rotors[0].tail), model && model.userData.civil);
      const a0 = parts ? parts.rotors[0].spin.rotation.y : 0;
      run(0.5);
      const a1 = parts ? parts.rotors[0].spin.rotation.y : 0;
      r.ok(`${id}: the rotor is turning on the pad with the engine running`, ac().engineOn && parts && a1 !== a0 && parts.rotors[0].disc.visible, `${f2(a0)} → ${f2(a1)}`);
      r.ok(`${id}: on the ground, still, in ground effect`, ac().onGround && !ac().crashed && ac().groundSpeed < 0.3 && (ac().rotor.groundEffect || 0) > 0.05, `GE ${f2(ac().rotor.groundEffect)}`);
      // Lift off: Shift until the skids are 12 m up (or 12 s), then hands off.
      const h0 = skidH();
      hold(['Shift'], 12, () => skidH() > 12 || ac().crashed);
      run(5);
      const h = skidH();
      r.ok(`${id}: Shift lifts it off and hands off it holds a hover (${f1(h)} m, vs ${f2(ac().vs)} m/s, drift ${f2(ac().rotor.drift)})`, !ac().crashed && !ac().onGround && h > h0 + 5 && Math.abs(ac().vs) < 1.2 && (ac().rotor.drift || 0) < 1.5);
      const card = text(hud().heliState);
      r.ok(`${id}: the card says what it is doing (${card})`, /HOVERING|HEIGHT HOLD|CLIMBING|ON THE LEVER/.test(card));
      // W: it flies forward and the card follows.
      hold(['W'], 4);
      run(2);
      r.ok(`${id}: W flies it forward (${f1(ac().groundSpeed * 1.94384)} kt) without crashing`, !ac().crashed && ac().groundSpeed > 5);
      // Ctrl to the ground: a landing.
      hold(['Ctrl'], 40, () => ac().onGround || ac().crashed);
      run(2);
      r.ok(`${id}: Ctrl held brings it down to a landing (${ac().lastTouchdown ? ac().lastTouchdown.vsFpm + ' fpm' : 'no touchdown'})`, ac().onGround && !ac().crashed);
      if (id === 'ah64') {
        const G = await import('../../src/features/gunsight/rules.js');
        r.ok('ah64: the Apache has its gun by the sight\'s own rule, in the Heli game', G.hasGuns(sim.aircraftType, sim.game) === true);
      }
    }

    /* --------------------------------------------- autorotation, assisted */
    say('heli fleet: autorotation');
    await start('bell407');
    hold(['Shift'], 20, () => skidH() > 110 || ac().crashed);
    run(4);
    hold(['W'], 6);
    run(2);
    const hFail = skidH();
    const gsFail = ac().groundSpeed;
    ac().failures.engine = true;
    let sawCard = false;
    let nrGlide = 0;
    const trace = [];
    let tt = 0;
    run(90, () => {
      tt += DT;
      if (!ac().engineOn && skidH() > 50) {
        nrGlide = ac().rotor.nr;
        if (/AUTOROTATION/.test(text(hud().heliState))) sawCard = true;
      }
      if (trace.length < 40 && (skidH() < 30 ? tt * 15 % 3 < 1 : tt % 2 < DT)) trace.push(`${f1(tt)}s h${f1(skidH())} vs${f1(ac().vs)} gs${f1(ac().groundSpeed)} nr${f2(ac().rotor.nr)} c${f2(ac().rotor.collective)} p${f1(ac().readouts().pitch)}`);
      return ac().onGround || ac().crashed;
    });
    run(2);
    r.ok(`bell407: engine out at ${f1(hFail)} m and ${f1(gsFail)} m/s, the card says AUTOROTATION, NR holds in the glide (${f2(nrGlide)}) and the assist lands it (${ac().lastTouchdown ? ac().lastTouchdown.vsFpm + ' fpm' : '?'})`,
      sawCard && nrGlide > 0.85 && ac().onGround && !ac().crashed, `crashed ${ac().crashed} ${ac().crashReason || ''} card ${sawCard}; ${trace.join(' / ')}`);
  } finally {
    allUp();
    sim.renderer.render = origRender;
    sim.autoPauseOnHide = origAutoPause;
    sim._unlocking = origUnlocking;
    if (sim.settings) {
      sim.settings.heliAssist = origAssist;
      if (typeof sim.applyDifficulty === 'function') sim.applyDifficulty(origDiff);
    }
    if (sim.state !== 'menu' && typeof sim.quitToMenu === 'function') sim.quitToMenu();
  }
}

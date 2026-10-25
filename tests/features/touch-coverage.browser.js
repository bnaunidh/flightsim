/**
 * Browser checks for the touch sheets (src/ui/touch.js buildSheets), in a real
 * page: the owner's "update mobile controls so u can do pushback etc".
 *
 *   - on a desktop load (the self-test) the touch layer is built for the
 *     check and taken down after; on a touch load (the playtest's emulated
 *     phone and tablet) the game's own layer is used;
 *   - every registered action has a touch control or a desktop-only reason
 *     (the live registry, every feature loaded);
 *   - parked on a stand: the GROUND pad shows, its sheet opens, the crew
 *     button reads CALL THE GROUND CREW and calls them; once they are parked
 *     up it reads PUSH BACK; ◀ LEFT asks for the nose to the left and PUSH
 *     BACK starts a push that swings that way; STOP THE PUSH stops it;
 *   - the parking brake button sets and releases the parking brake;
 *   - with each sheet open, no sheet, pad or sheet button lands on the
 *     stick, the throttle, the rudder, the pads, the dock or the minimap,
 *     every one is inside the screen, and every target is 44 px or more;
 *   - SYSTEMS: trim NOSE UP held winds the trim and letting go stops it;
 *     MAP toggles the minimap; the sheet closes when the aeroplane leaves the
 *     ground (GROUND) and when the layer is hidden.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'touch-coverage';

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return null;
  }
}

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`touch: ${m}`); };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const steps = (s, dt = 0.1) => { for (let t = 0; t < s - 1e-9; t += dt) sim.step(dt); };
  const box = (n) => n.getBoundingClientRect();
  const shown = (n) => !!n && !n.hidden && n.getClientRects().length > 0 && box(n).width > 1;
  const hits = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
  const fmt = (b) => `${Math.round(b.left)},${Math.round(b.top)} ${Math.round(b.width)}x${Math.round(b.height)}`;
  const click = (n) => { n.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); };

  const INP = await load('../../src/flight/input.js');
  const COV = await load('../../src/ui/touch-coverage.js');
  const TC = await load('../../src/ui/touch.js');
  const EXT = await load('../../src/game/extensions.js');
  const SVC = await load('../../src/features/airport-services.js');
  if (!INP || !COV || !TC || !EXT || !SVC) {
    r.ok('touch: the modules load', false, 'input / touch-coverage / touch / extensions / airport-services');
    return;
  }

  /* ---- every action has a thumb, in the live registry ---- */
  const gaps = COV.coverageGaps(INP.ACTIONS);
  r.ok('touch: every registered action has a touch control or a desktop-only reason (live registry)', gaps.missing.length === 0 && gaps.bad.length === 0, [...gaps.missing, ...gaps.bad].join(', ') || `${Object.keys(INP.ACTIONS).length} actions`);
  r.ok('touch: no coverage row is stale', gaps.stale.length === 0, gaps.stale.join(', ') || 'none');

  /* ---- a touch layer to tap ---- */
  const built = !sim.touch;
  const wrap = sim.hud && sim.hud.wrap;
  if (!wrap) {
    r.ok('touch: the HUD exists', false, 'no sim.hud.wrap');
    return;
  }
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  let tc = sim.touch;
  if (built) {
    tc = new TC.TouchControls(wrap, {
      input: sim.input,
      onAction: (a) => sim.hudAction(a),
      onHold: (a, down) => sim.holdAction(a, down),
      state: () => sim.touchState(),
    });
    sim.touch = tc;
    wrap.classList.add('is-touch');
    document.documentElement.classList.add('is-touch-device');
  }
  const S = SVC.__airportServices.S;
  const pad = (name) => tc.sheetPads[name];
  const sheet = (name) => tc.sheets[name];
  const btn = (name, act) => sheet(name).querySelector(`.touch-sheet-btn[data-act="${act}"]`);
  const teardown = () => {
    try { tc.closeSheets(); } catch (e) { /* fine */ }
    if (built) {
      try { tc.layer.remove(); } catch (e) { /* fine */ }
      sim.touch = null;
      if (sim.input) sim.input.touch = null;
      wrap.classList.remove('is-touch');
      document.documentElement.classList.remove('is-touch-device');
    }
    SVC.__airportServices.setPushPref('auto');
    sim.autoPauseOnHide = origAuto;
  };

  try {
    /* ---- on a stand ---- */
    log('parking on a stand');
    if (sim.state !== 'flying' || sim.input.context !== 'plane') {
      await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    } else if (sim.quitToMenu) {
      sim.quitToMenu();
      await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    }
    steps(1);
    const park = EXT.extDevActions().find((a) => a.ext === 'airport' && /free stand/i.test(a.label));
    r.ok('touch: the "park at a free stand" dev action is offered', !!park);
    if (park) {
      park.run(sim);
      steps(1.5);
    }
    const onStand = S.state === 'onStand';
    r.ok('touch: parked on a stand, the crew is offered', onStand, `state ${S.state}`);

    r.ok('touch: on the ground in an aeroplane the GROUND pad shows, and SYSTEMS beside it', shown(pad('ground')) && shown(pad('systems')), `ground ${shown(pad('ground'))}, systems ${shown(pad('systems'))}`);
    click(pad('ground'));
    const G = sheet('ground');
    r.ok('touch: tapping GROUND opens the ground sheet and lights the pad', tc.openSheet === 'ground' && shown(G) && pad('ground').classList.contains('is-on'), `open ${tc.openSheet}`);

    const crew = btn('ground', 'services');
    r.ok('touch: the crew button reads CALL THE GROUND CREW on a stand', !!crew && /CALL THE GROUND CREW/.test(crew.textContent) && crew.getAttribute('aria-disabled') !== 'true', crew ? crew.textContent : 'no button');
    if (crew && onStand) {
      click(crew);
      steps(0.3);
      r.ok('touch: tapping it calls the crew', S.state === 'calling', `state ${S.state}`);
      let waited = 0;
      while (S.state === 'calling' && waited < 90) { steps(1); waited++; }
      tc.syncSheets(sim.touchState());
      r.ok('touch: the crew parks up and the button now reads PUSH BACK', S.state === 'serviced' && /PUSH BACK/.test(crew.textContent), `state ${S.state} after ${waited} s, "${crew.textContent}"`);
    }

    /* ---- the push's way round ---- */
    const left = btn('ground', 'pushNoseLeft');
    const auto = btn('ground', 'pushAuto');
    const right = btn('ground', 'pushNoseRight');
    r.ok('touch: the sheet offers ◀ LEFT, RUNWAY (AUTO) and RIGHT ▶ for the push, AUTO lit', !!left && !!auto && !!right && auto.classList.contains('is-on') && !left.classList.contains('is-on'), `pref ${S.pushPref}`);
    click(left);
    tc.syncSheets(sim.touchState());
    r.ok('touch: tapping ◀ LEFT asks for the nose to the left and lights it', S.pushPref === 'noseLeft' && left.classList.contains('is-on') && !auto.classList.contains('is-on'), `pref ${S.pushPref}`);

    if (S.state === 'serviced') {
      const h0 = sim.aircraft.heading;
      click(crew);
      steps(0.3);
      const P = S.push;
      r.ok('touch: PUSH BACK starts the push, swinging the way that was asked (tail right, nose to the left) when it is clear', S.state === 'pushback' && !!P && (P.turn === 1 || !P.clear || P.flipped), `state ${S.state}, turn ${P && P.turn}, pref ${P && P.pref}, clear ${P && P.clear}`);
      tc.syncSheets(sim.touchState());
      r.ok('touch: during the push the button reads STOP THE PUSH', /STOP THE PUSH/.test(crew.textContent) && crew.classList.contains('is-on'), crew.textContent);
      steps(3);
      const moved = Math.hypot(sim.aircraft.pos.x - P.p0.x, sim.aircraft.pos.z - P.p0.z);
      click(crew);
      steps(0.3);
      r.ok('touch: STOP THE PUSH stops it where it is', S.state === 'pushed' && moved > 2, `state ${S.state}, moved ${moved.toFixed(1)} m`);
      tc.syncSheets(sim.touchState());
      r.ok('touch: with the tug clear the button says so and is greyed', /TUG IS CLEAR/.test(crew.textContent) && crew.getAttribute('aria-disabled') === 'true', crew.textContent);
      // The push ran at h0; a swing began (a few degrees in three seconds of straight-then-turn is fine either way).
      void h0;
    }

    /* ---- the parking brake ---- */
    const parkBtn = btn('ground', 'parkingBrake');
    const ac = sim.aircraft;
    ac.vel.set(0, 0, 0);
    const was = !!ac.parkingBrake;
    click(parkBtn);
    steps(0.2);
    const flipped = !!ac.parkingBrake !== was;
    tc.syncSheets(sim.touchState());
    const says = ac.parkingBrake ? /ON/.test(parkBtn.textContent) && parkBtn.classList.contains('is-on') : /OFF/.test(parkBtn.textContent) && !parkBtn.classList.contains('is-on');
    click(parkBtn);
    steps(0.2);
    r.ok('touch: PARKING BRAKE toggles it, and the button says which it is', flipped && says && !!ac.parkingBrake === was, `was ${was}, after one tap ${!was}, after two ${!!ac.parkingBrake}; "${parkBtn.textContent}"`);

    /* ---- nothing on anything, everything on screen, 44 px ---- */
    const measure = (name) => {
      const problems = [];
      const W = window.innerWidth;
      const Hh = window.innerHeight;
      const controls = [
        ['stick', tc.stick], ['throttle', tc.throttleEl], ['lever', tc.leverEl], ['rudder', tc.layer.querySelector('.touch-rudder')],
        ['pads', tc.pads], ['dock', wrap.querySelector(':scope > .hud-buttons')], ['minimap', document.querySelector('#ui .minimap, .minimap')],
        // The eject column (features/eject/ui.js) is a fixed layer above the HUD: a sheet under it had MAP under EJECT.
        ['eject', document.querySelector('.ej-col')],
      ].filter(([, n]) => shown(n)).map(([k, n]) => [k, box(n)]);
      const s = sheet(name);
      const sb = box(s);
      for (const [k, b] of controls) if (hits(sb, b)) problems.push(`${name} sheet on the ${k} (${fmt(sb)} vs ${fmt(b)})`);
      if (sb.left < -1 || sb.top < -1 || sb.right > W + 1 || sb.bottom > Hh + 1) problems.push(`${name} sheet off the screen (${fmt(sb)} in ${W}x${Hh})`);
      const targets = [...s.querySelectorAll('.touch-sheet-btn, .touch-sheet-close')].filter(shown);
      for (const t of targets) {
        const b = box(t);
        if (b.width < 44 || b.height < 44) problems.push(`"${t.textContent.trim().slice(0, 18)}" is ${Math.round(b.width)}x${Math.round(b.height)}`);
        if (b.bottom > sb.bottom + 1 && s.scrollHeight <= s.clientHeight + 1) problems.push(`"${t.textContent.trim().slice(0, 18)}" sticks out of the sheet`);
        // Nothing on top of it (another feature's prompt or button): a finger on its middle reaches it.
        if (b.top >= sb.top - 1 && b.bottom <= sb.bottom + 1) {
          const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          if (hit && hit !== t && !t.contains(hit)) problems.push(`"${t.textContent.trim().slice(0, 18)}" is under ${String(hit.className || hit.tagName).slice(0, 40)}`);
        }
      }
      for (const p of [pad('ground'), pad('systems')]) {
        if (!shown(p)) continue;
        const b = box(p);
        if (b.width < 44 || b.height < 44) problems.push(`${p.textContent} pad is ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
      // The pads grid itself against the other controls (the sheet pads made it taller).
      const pb = tc.pads && shown(tc.pads) ? box(tc.pads) : null;
      if (pb) for (const [k, b] of controls) if (k !== 'pads' && hits(pb, b)) problems.push(`the pads on the ${k} (${fmt(pb)} vs ${fmt(b)})`);
      return problems;
    };
    const vp = `${window.innerWidth}x${window.innerHeight}`;
    tc.placeSheet(G);
    const g = measure('ground');
    r.ok(`touch (${vp}): the open GROUND sheet is on screen, clear of the stick, throttle, rudder, pads, dock and map, with 44 px targets`, g.length === 0, g.join('; ') || fmt(box(G)));

    /* ---- SYSTEMS ---- */
    log('systems sheet');
    click(pad('systems'));
    const Y = sheet('systems');
    r.ok('touch: tapping SYSTEMS closes GROUND and opens the systems sheet', tc.openSheet === 'systems' && shown(Y) && !shown(G) && !pad('ground').classList.contains('is-on'), `open ${tc.openSheet}`);
    const y = measure('systems');
    r.ok(`touch (${vp}): the open SYSTEMS sheet is on screen, clear of the controls, with 44 px targets`, y.length === 0, y.join('; ') || fmt(box(Y)));
    const have = ['autopilot', 'trimDown', 'trimReset', 'trimUp', 'lookBehind', 'minimap', 'minimapRange', 'help'].filter((a) => shown(btn('systems', a)));
    r.ok('touch: SYSTEMS carries autopilot, trim (down / neutral / up), look behind, map, map range and controls', have.length === 8, have.join(', '));
    r.ok('touch: the helicopter\'s assist button is hidden in an aeroplane', !shown(btn('systems', 'heliAssist')));

    // Trim, held.
    const up = btn('systems', 'trimUp');
    const trim0 = sim.input.trimInput || 0;
    up.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true }));
    steps(1);
    const trimHeld = sim.input.trimInput || 0;
    up.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true }));
    steps(1);
    const trimAfter = sim.input.trimInput || 0;
    r.ok('touch: NOSE UP held winds the trim, and letting go stops it', trimHeld > trim0 + 0.2 && Math.abs(trimAfter - trimHeld) < 0.02 && !tc._holds.size, `${trim0.toFixed(2)} -> ${trimHeld.toFixed(2)} -> ${trimAfter.toFixed(2)}, holds ${tc._holds.size}`);
    click(btn('systems', 'trimReset'));
    steps(0.2);
    r.ok('touch: NEUTRAL puts the trim back', Math.abs(sim.input.trimInput || 0) < 1e-6, String(sim.input.trimInput));

    // The map.
    const mapOn = () => !!(sim.minimap && sim.minimap._want);
    const mapWas = mapOn();
    click(btn('systems', 'minimap'));
    steps(0.2);
    const mapNow = mapOn();
    click(btn('systems', 'minimap'));
    steps(0.2);
    r.ok('touch: MAP toggles the minimap (and back)', mapNow !== mapWas && mapOn() === mapWas, `${mapWas} -> ${mapNow} -> ${mapOn()}`);

    // A hold left down when the layer hides is let go.
    up.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 8, pointerType: 'touch', isPrimary: true }));
    const heldNow = tc._holds.has('trimUp');
    tc.setVisible(false);
    const released = !tc._holds.size && !tc.openSheet;
    tc.setVisible(true);
    r.ok('touch: hiding the layer (walking off, ejecting) closes the sheet and lets go of a held trim', heldNow && released, `held ${heldNow}, released ${released}`);
    click(btn('systems', 'trimReset'));

    // In the air, GROUND goes (and its sheet with it).
    click(pad('ground'));
    const openOnGround = tc.openSheet === 'ground';
    const a2 = sim.aircraft;
    a2.pos.y = 300;
    a2.vel.set(40, 0, 0);
    a2.onGround = false;
    tc.update(a2.readouts(), sim);
    r.ok('touch: once airborne the GROUND pad hides and its sheet closes; SYSTEMS stays', openOnGround && pad('ground').hidden && !tc.openSheet && !pad('systems').hidden, `open before ${openOnGround}, ground hidden ${pad('ground').hidden}, open now ${tc.openSheet}`);

    /* ---- the mayday: declared from SYSTEMS, answered by a tap ---- */
    log('mayday card');
    if (sim.braceAvailable && sim.braceAvailable()) {
      await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0 });
      steps(0.3, 1 / 30);
      tc.update(sim.aircraft.readouts(), sim);
      if (tc.openSheet !== 'systems') click(pad('systems'));
      tc.syncSheets(sim.touchState());
      const may = btn('systems', 'brace');
      const offered = shown(may);
      click(may);
      steps(0.1, 1 / 30);
      if (!sim.bracing) click(may);
      steps(0.1, 1 / 30);
      const card = sim.hud.emergencyChoice;
      r.ok('touch: MAYDAY on the SYSTEMS sheet declares it, and the sheet steps away for the question', offered && !!sim.bracing && !tc.openSheet && shown(card), `offered ${offered}, bracing ${!!sim.bracing}, open ${tc.openSheet}`);
      const cb = box(card);
      const W = window.innerWidth;
      const Hh = window.innerHeight;
      const on = [
        ['stick', tc.stick], ['throttle', tc.throttleEl], ['lever', tc.leverEl], ['rudder', tc.layer.querySelector('.touch-rudder')],
        ['pads', tc.pads], ['eject', document.querySelector('.ej-col')],
      ].filter(([, n]) => shown(n)).filter(([, n]) => hits(cb, box(n))).map(([k, n]) => `${k} ${fmt(box(n))}`);
      const rows = [...card.querySelectorAll('button[data-choice]')];
      const reach = rows.filter((b) => {
        const q = box(b);
        const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
        return q.height >= 44 && hit && (hit === b || b.contains(hit));
      });
      const inside = cb.left >= -1 && cb.top >= -1 && cb.right <= W + 1 && cb.bottom <= Hh + 1;
      r.ok(`touch (${vp}): the mayday card is on screen, on no control, and both answers are 44 px targets a finger reaches`, on.length === 0 && reach.length === 2 && inside, `card ${fmt(cb)}; on ${on.join(', ') || 'nothing'}; reachable ${reach.length}/${rows.length}`);
      if (rows[1]) click(rows[1]);
      steps(0.1, 1 / 30);
      r.ok('touch: tapping "Circle the airport" answers it', sim.braceChoice === 'circle' && card.hidden, `choice ${sim.braceChoice}`);
    } else {
      r.ok('touch: the mayday is on offer in Free Flight', false, 'braceAvailable() false');
    }

    /* ---- what the pills already did still works beside the sheets ---- */
    r.ok('touch: the pills lane is still there for the stop-push and brake undo', !!wrap.querySelector('.hud-pills'));
  } catch (e) {
    r.ok('touch: the check ran to the end', false, String(e && e.stack || e).slice(0, 400));
  } finally {
    teardown();
    try { if (sim.quitToMenu) sim.quitToMenu('main'); } catch (e) { /* already */ }
  }
}

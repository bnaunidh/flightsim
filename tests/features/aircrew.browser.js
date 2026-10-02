/**
 * Browser checks for the air team's list, in the real game, through the real
 * keys (sim.key / sim.tap dispatch the same KeyboardEvents a keyboard does):
 *
 *   EJECT          Enter twice in an F-22 at 600 m: the seat fires, the
 *                  parachute opens, the empty jet crashes on its own and the
 *                  flight does NOT end with a "Crashed" screen; you land, and
 *                  are on foot in a fighter pilot's flight suit; Enter flies
 *                  again. Not while parked; airliners and the helicopter say
 *                  kindly that they have no seats. The touch EJECT button
 *                  does the same as Enter.
 *   CREW FIRST     the Nightjar B-2: the first Enter sends the crew, the second
 *                  sends you.
 *   SELF-DESTRUCT  Air Massimo: cover, countdown, cancel; again, and the
 *                  seat fires by itself before the boom. (Not T-Pose
 *                  Harrison: a person has no self-destruct — tpose.browser.js.)
 *   DRAG CHUTE     only when you pull it, only on the goofy planes: Massimo and
 *                  Harrison rolling at 80 kt on the brakes alone never get it;
 *                  ; pulls it and they stop in far less runway; the F-22,
 *                  Vanguard and Nightjar have none (the key says so); not in
 *                  the air or too slow; the touch CHUTE button shows on the
 *                  goofy planes' roll only and pulls it; the H card lists it
 *                  and a key moved in Settings works.
 *   T-POSE         Harrison is in the shop at 3,601 credits and has his own
 *                  card; floating, flapping, spinning, boosting, getting out
 *                  and his parachute: tpose.browser.js, run from here.
 *   UNIFORMS       out of an A320 with O: the airline captain.
 *   F-35B          in the hover: W slides forward and the hover stays on, A
 *                  slides left, Q turns — through the real keys.
 *   RUNAWAY        a Skylark left with the power on: the first O warns, the
 *                  second leaves her running; she takes off, comes down on the
 *                  map, no Crashed screen; she can run you over (knocked down,
 *                  a ragdoll, WASTED) and you get up; idle, or a fast jet, is
 *                  parked as ever. Since the pilot brief, ANYTHING can knock
 *                  you down (not only your own plane: tests/features/
 *                  pilot.browser.js has the rest) and the pause switch hides
 *                  only the WASTED screen, never the knock.
 *
 *   const { check } = await import('./tests/features/aircrew.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d }); } };
 *   await check(window.__sim, r, console.log); console.table(r.checks);
 */

import { checkHarrison } from './tpose.browser.js';

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

export async function check(sim, r, say = () => {}) {
  say('aircrew: loading');
  const EJ = await load('../../src/features/eject.js');
  const OF = await load('../../src/features/onfoot.js');
  const ST = await load('../../src/features/stovl.js');
  const EXT = await load('../../src/game/extensions.js');
  const PROG = await load('../../src/game/progression.js');
  const okLoad = !!(EJ && EJ.eject && OF && OF.onFoot && ST && ST.stovlState && EXT && EXT.extStatus && PROG && PROG.UNLOCKS);
  r.ok('aircrew: its modules load', okLoad, okLoad ? '' : [EJ, OF, ST, EXT, PROG].map((m) => m && m.__error).filter(Boolean).join(' | '));
  if (!okLoad) return r;
  const live = EXT.extStatus();
  r.ok('aircrew: eject and tpose are registered and live', ['eject', 'tpose', 'onfoot', 'stovl'].every((id) => live.some((e) => e.id === id && e.live)), JSON.stringify(live.filter((e) => !e.live)));
  const E = EJ.eject;
  const foot = OF.onFoot;
  const dt = 1 / 60;
  const run = (secs, each) => {
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) {
      sim.update(dt);
      if (each && each(i * dt) === true) return true;
    }
    return false;
  };
  const lastToast = () => {
    const t = [...document.querySelectorAll('.hud-toast')];
    return t.length ? t[t.length - 1].textContent : '';
  };
  const debriefUp = () => sim.state === 'debrief' || !!document.querySelector('.debrief:not([hidden]), [data-screen="debrief"]:not([hidden])');
  sim.autoPauseOnHide = false;

  /* ================================================================ */
  say('aircrew: not while parked, and no seats in an airliner or the helicopter');
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  run(0.5);
  sim.tap('Enter');
  run(0.1);
  sim.tap('Enter');
  run(0.1);
  r.ok('eject: not while parked — it says to stop and press O', E.phase === 'idle' && /press O/i.test(lastToast()), lastToast());
  await sim.startMode('free', { aircraft: 'a320', airborne: true, taxi: false });
  run(0.5);
  sim.tap('Enter');
  run(0.1);
  sim.tap('Enter');
  run(0.1);
  r.ok('eject: an airliner has no ejection seats, and says so kindly', E.phase === 'idle' && /ejection seats/i.test(lastToast()) && /landing/i.test(lastToast()), lastToast());
  await sim.startMode('free', { aircraft: 'harrier', airborne: true, taxi: false });
  run(0.3);
  sim.tap('Enter');
  run(0.1);
  // No seat (the rotor is in the way) — but in Free Flight the owner wanted a
  // way out, so the first Enter arms a jump from the side door (eject-ff).
  r.ok('eject: the helicopter has no seat, but in Free Flight the first Enter arms a jump from the door', E.phase === 'idle' && /bail out|jump/i.test(lastToast()), lastToast());

  /* ================================================================ */
  say('aircrew: eject from an F-22');
  await sim.startMode('free', { aircraft: 'f22', airborne: true, taxi: false });
  run(1);
  const ac = sim.aircraft;
  const line = (document.querySelector('.hud-keyhint') || {}).textContent || '';
  r.ok('eject: the controls line says Enter ejects (and Backspace self-destructs) in the F-22', /Enter eject/.test(line) && /Backspace self-destruct/.test(line), line);
  sim.tap('Enter');
  run(0.1);
  const armed = E.phase === 'idle' && /again/i.test(lastToast());
  sim.tap('Enter');
  run(0.1);
  r.ok('eject: the first Enter asks again, the second fires the seat', armed && E.phase === 'out', `phase ${E.phase}`);
  const seatUp = E.me ? E.me.flight.pos.y - ac.pos.y : 0;
  run(1.2);
  r.ok('eject: the seat rockets you up and away from the jet', E.me && E.me.flight.seatOff && E.me.flight.pos.y > ac.pos.y + 10, `${(E.me ? E.me.flight.pos.y - ac.pos.y : 0).toFixed(1)} m above it after 1.3 s (${seatUp.toFixed(1)} m at the start)`);
  run(1.2);
  r.ok('eject: the parachute opens', E.me && E.me.flight.open >= 1 && E.me.model.canopy.visible, `open ${E.me ? E.me.flight.open.toFixed(2) : '—'}`);
  r.ok('eject: nobody is flying the jet now — the controls are the empty aeroplane’s', sim.override === E.ghost && !!E.ghost);
  if (sim.atc && typeof sim.atc.say === 'function') {
    const cool = sim.atc.cool;
    sim.atc.cool = 0;
    const said = sim.atc.say('Raptor zero one, cleared to land runway zero nine.');
    sim.atc.cool = cool;
    r.ok('eject: the tower does not talk to an empty jet (no "cleared to land" at a parachute)', said === false, `say() returned ${said}`);
  }
  let crashAt = null;
  let landed = false;
  sim.key('KeyS', true); // sink faster: a check should not take a minute
  run(80, (t) => {
    if (crashAt === null && ac.crashed) crashAt = t;
    if (E.phase === 'walking') {
      landed = true;
      return true;
    }
    return false;
  });
  sim.key('KeyS', false);
  run(0.3); // the walker's first frame puts its prompt up
  r.ok('eject: the empty jet carries on and crashes by itself', crashAt !== null, `crashed ${crashAt === null ? 'never' : crashAt.toFixed(1) + ' s after the chute opened'}: ${ac.crashReason}`);
  r.ok('eject: a crash with nobody aboard does not end the flight (no Crashed screen)', sim.state === 'flying' && !debriefUp(), `state ${sim.state}`);
  const snap = foot.snapshot();
  r.ok('eject: you land and are on foot', landed && snap.active && snap.from === 'none', JSON.stringify({ landed, active: snap.active, from: snap.from }));
  r.ok('uniforms: out of the F-22 you are in a fighter pilot’s flight suit and helmet', snap.outfit === 'fighter' && foot.model && foot.model.userData.uniform === 'fighter', snap.outfit);
  r.ok('eject: on the ground it says Enter flies again', /fly again/i.test(snap.prompt), snap.prompt);
  const w0 = foot.walker.walked;
  sim.key('KeyW', true);
  run(1.5);
  sim.key('KeyW', false);
  run(0.3);
  r.ok('eject: you can walk about after landing', foot.walker.walked - w0 > 1.5, `${(foot.walker.walked - w0).toFixed(1)} m`);
  sim.tap('Enter');
  // restart() is startMode(), which is async (it waits for the audio first).
  for (let i = 0; i < 40 && (foot.active || E.phase !== 'idle'); i++) await new Promise((res) => setTimeout(res, 50));
  run(0.5);
  r.ok('eject: Enter flies again — back in the seat, the jet whole', E.phase === 'idle' && !foot.active && !sim.aircraft.crashed && sim.model.visible && !E.ghost && !(sim.walking && sim.walking.ejected),
    `phase ${E.phase}, walking ${foot.active}, crashed ${sim.aircraft.crashed}`);
  if (sim.atc && typeof sim.atc.say === 'function') {
    const cool = sim.atc.cool;
    sim.atc.cool = 0;
    const said = sim.atc.say('Raptor zero one, Kestrel Tower, wind calm.');
    sim.atc.cool = cool;
    r.ok('eject: back in the seat, the tower talks to you again', said === true, `say() returned ${said}`);
  }

  /* ================================================================ */
  say('aircrew: the touch EJECT button');
  run(1);
  E.ui.press('eject');
  run(0.1);
  const tapArmed = E.phase === 'idle';
  E.ui.press('eject');
  run(0.1);
  r.ok('eject: the EJECT button does what Enter does (tap, tap)', tapArmed && E.phase === 'out', `phase ${E.phase}`);

  /* ================================================================ */
  say('aircrew: crew first in the B-2');
  await sim.startMode('free', { aircraft: 'nightjar', airborne: true, taxi: false });
  run(1);
  sim.tap('Enter');
  run(0.2);
  r.ok('crew first: in the Nightjar B-2 the first Enter sends the crew, not you', E.crewOut && E.crew.length >= 1 && E.phase === 'idle' && /crew out first/i.test(lastToast()), lastToast());
  sim.tap('Enter');
  run(3);
  r.ok('crew first: the second Enter sends you, and both parachutes are open', E.phase === 'out' && E.crew.every((c) => c.flight.open >= 1) && E.me && E.me.flight.open >= 1,
    `phase ${E.phase}, crew open ${E.crew.map((c) => c.flight.open.toFixed(1)).join(',')}`);

  /* ================================================================ */
  say('aircrew: self-destruct in Air Massimo');
  await sim.startMode('free', { aircraft: 'massimo', airborne: true, taxi: false });
  run(1);
  const sd = E.selfDestruct;
  sim.tap('Backspace');
  run(0.1);
  const cover = sd.state;
  sim.tap('Backspace');
  run(1.2);
  const counting = sd.state === 'count' && /SELF-DESTRUCT IN/.test(E.ui.snapshot().count);
  sim.tap('Backspace');
  run(0.2);
  r.ok('self-destruct: guarded — the cover opens, then it counts down, and a press cancels it', cover === 'open' && counting && sd.state === 'off' && !sim.aircraft.crashed,
    `cover ${cover}, counting ${counting}, now ${sd.state}`);
  sim.tap('Backspace');
  run(0.1);
  sim.tap('Backspace');
  let autoOut = false;
  run(6.5, () => {
    if (E.phase === 'out' && !autoOut) autoOut = !!(E.lastEject && E.lastEject.auto);
    return sd.state === 'boom';
  });
  run(0.3);
  r.ok('self-destruct: nobody goes up with it — the seat fires by itself before the end', autoOut && E.lastEject.kind === 'seat', JSON.stringify(E.lastEject));
  r.ok('self-destruct: a big boom, the plane is gone, and no Crashed screen', sd.state === 'boom' && sim.aircraft.crashed && !sim.model.visible && sim.state === 'flying' && !debriefUp(),
    `${sim.aircraft.crashReason}, model visible ${sim.model.visible}`);
  sim.key('KeyS', true);
  run(70, () => E.phase === 'walking');
  sim.key('KeyS', false);
  const hs = foot.snapshot();
  r.ok('self-destruct: down safely, on foot in a racing suit', hs.active && hs.outfit === 'racer', hs.outfit);

  /* ================================================================ */
  await checkHarrison(sim, r, say);

  /* ================================================================ */
  say('aircrew: Harrison in the shop and on his card');
  const row = (PROG.UNLOCKS || []).find((u) => u.aircraft === 'tpose');
  const card = document.querySelector('[data-fleet-art="tpose"] canvas[data-tpose]');
  const buy = document.querySelector('[data-buy="tpose"]');
  r.ok('T-Pose Harrison: in the shop at 3,601 credits (one more than Massimo), with his own card portrait', !!row && row.cost === 3601 && !!card && !!buy,
    `row ${row ? row.cost : '—'}, card ${!!card}, hangar button ${!!buy}`);

  /* ================================================================ */
  say('aircrew: uniforms, out of an A320 with O');
  await sim.startMode('free', { aircraft: 'a320', taxi: false });
  run(1.5);
  sim.tap('KeyO');
  run(0.6);
  const cap = foot.snapshot();
  r.ok('uniforms: out of an airliner you are the airline captain', cap.active && cap.outfit === 'captain', cap.outfit);
  sim.tap('KeyO');
  run(0.4);

  /* ================================================================ */
  /*
   * "Only do chute if you deploy it, and only on goofy planes." Each goofy
   * plane rolls out twice from 80 kt with Space (the brakes) held all the
   * way: once never touching the chute key — it must NOT come out — and once
   * pressing it half a second in. Then the real jets, the touch button, the
   * H card and a moved key.
   */
  say('aircrew: drag chute — only when you pull it, only Massimo and Harrison');
  const INP = await load('../../src/flight/input.js');
  const RUNWAY_X = -500;
  const chuteKey = () => (sim.input.bindings.dragChute || [])[0];
  const onRoll = async (id, kt = 80) => {
    await sim.startMode('free', { aircraft: id, taxi: false, traffic: false, windSpeedKts: 0 });
    run(0.3);
    const a = sim.aircraft;
    a.reset({ pos: a.pos.clone().set(RUNWAY_X, 0, 0), headingDeg: 90, speed: kt / 1.94384, engineOn: true, gearDown: true });
    sim.input.throttleTarget = 0;
    E.drag.armed = true; // just landed
    return a;
  };
  const rollStop = async (id, pullAt) => {
    const a = await onRoll(id);
    const x0 = a.pos.x;
    sim.key('Space', true);
    let popped = false;
    let pulled = false;
    let hint = '';
    run(40, (t) => {
      if (!hint && /Drag chute ready|Tap CHUTE/.test(lastToast())) hint = lastToast();
      if (pullAt !== null && !pulled && t >= pullAt) {
        pulled = true;
        sim.tap(chuteKey());
      }
      if (E.drag.state === 'out') popped = true;
      return a.groundSpeed < 2.5;
    });
    sim.key('Space', false);
    return { roll: a.pos.x - x0, popped, hint, crashed: a.crashed, line: UIline() };
  };
  const UIline = () => ((document.querySelector('.hud-keyhint') || {}).textContent || '');
  r.ok('drag chute: a named action on ; by default (free), in the bindings', chuteKey() === 'Semicolon' && !!(INP.ACTIONS && INP.ACTIONS.dragChute), chuteKey());
  const ROLL = {};
  for (const id of ['massimo', 'tpose']) {
    const plain = await rollStop(id, null);
    const chute = await rollStop(id, 0.5);
    ROLL[id] = { plain: Math.round(plain.roll), chute: Math.round(chute.roll) };
    r.ok(`drag chute (${id}): braking alone the whole roll, it never comes out by itself`, !plain.popped && !plain.crashed && plain.roll > 0,
      `${Math.round(plain.roll)} m from 80 kt on the brakes alone`);
    r.ok(`drag chute (${id}): the hint says which key pulls it`, /press ; to pull it/.test(plain.hint), plain.hint);
    r.ok(`drag chute (${id}): the controls line names the key`, /; drag chute/.test(plain.line), plain.line);
    r.ok(`drag chute (${id}): pressing ; pulls it, and it shortens the roll by a third or more`, chute.popped && !chute.crashed && chute.roll > 0 && chute.roll < plain.roll * 0.67,
      `${Math.round(plain.roll)} m braking alone from 80 kt, ${Math.round(chute.roll)} m with the chute (${Math.round((1 - chute.roll / plain.roll) * 100)}% shorter)`);
  }
  for (const id of ['f22', 'vanguard', 'nightjar']) {
    await onRoll(id);
    sim.key('Space', true);
    run(0.4);
    sim.tap(chuteKey());
    run(0.4);
    sim.key('Space', false);
    const said = lastToast();
    r.ok(`drag chute: none on the ${id} — the key does nothing but say so`, E.drag.state === 'stowed' && !E.profile.dragChute && /No drag chute on this plane/.test(said)
      && !/drag chute/.test(UIline()), said);
  }
  // In the air, too slow, under power: not out, and it says why.
  await sim.startMode('free', { aircraft: 'massimo', airborne: true, taxi: false });
  run(0.5);
  sim.tap(chuteKey());
  run(0.2);
  r.ok('drag chute: in the air it stays packed — "touch down first, then press ;"', E.drag.state === 'stowed' && /touch down first, then press ;/.test(lastToast()), lastToast());
  {
    const a = await onRoll('massimo', 30);
    run(0.2);
    sim.tap(chuteKey());
    run(0.2);
    r.ok('drag chute: at 30 kt it is too slow to bother (and says so)', E.drag.state === 'stowed' && /Too slow/.test(lastToast()) && !a.crashed, lastToast());
  }
  // The touch screen: the CHUTE button shows on the landing roll of a goofy
  // plane only, and pulls it. (A stand-in for the touch layer: this desktop
  // Chrome has no touch screen, and only "is there one" is asked here.)
  {
    const real = sim.touch;
    const stub = { stickHeld: false, rudderHeld: false, throttle: null, brakes: false, dragging: false,
      setVisible() {}, setMode() {}, setBoatMode() {}, update() {}, updateBoat() {} };
    let seenF22 = null;
    let seenMassimo = null;
    let pulled = null;
    let after = null;
    let hint = '';
    try {
      await onRoll('f22');
      sim.touch = stub;
      run(0.3);
      seenF22 = E.ui.snapshot().chute;
      sim.touch = real;
      await onRoll('massimo');
      sim.touch = stub;
      run(0.3);
      hint = lastToast();
      seenMassimo = E.ui.snapshot().chute;
      E.ui.press('chute');
      run(0.3);
      pulled = E.drag.state;
      after = E.ui.snapshot().chute;
    } finally {
      sim.touch = real;
    }
    r.ok('drag chute (touch): the CHUTE button shows on Massimo\'s landing roll, not on the F-22\'s', seenMassimo === true && seenF22 === false, `massimo ${seenMassimo}, f22 ${seenF22}`);
    r.ok('drag chute (touch): the hint says tap CHUTE; tapping it pulls the chute and the button goes', /Tap CHUTE/.test(hint) && pulled === 'out' && after === false, `${hint} → ${pulled}, button ${after}`);
  }
  // The H card lists it (from the one table of keys), and Settings can move it.
  {
    sim.hud.showControls(sim.input.bindings, INP.keyLabel, INP.ACTIONS);
    const card = sim.hud.controlsCard.textContent;
    sim.hud.hideControls();
    r.ok('drag chute: the H card lists "Drag chute" on ;', /Drag chute \(Air Massimo, T-Pose Harrison: on the landing roll\);/.test(card), (card.match(/Drag chute[^;]*;/) || [''])[0]);
    const was = sim.input.bindings.dragChute;
    sim.input.bindings.dragChute = ['Quote'];
    await onRoll('tpose');
    run(0.3);
    sim.tap('Semicolon');
    run(0.2);
    const oldKey = E.drag.state;
    sim.tap('Quote');
    run(0.2);
    const newKey = E.drag.state;
    sim.input.bindings.dragChute = was;
    r.ok('drag chute: moved to \' in Settings, \' pulls it and ; no longer does', oldKey === 'stowed' && newKey === 'out', `; → ${oldKey}, ' → ${newKey}`);
  }
  window.__chuteRolls = ROLL;

  /* ================================================================ */
  say('aircrew: F-35B moves while hovering');
  await sim.startMode('free', { aircraft: 'f35b', taxi: false });
  run(0.5);
  const dev = EXT.extDevActions().find((a) => /F-35B: start in a hover/.test(a.label));
  if (!dev) {
    r.ok('F-35B: the hover can be started', false, 'no dev action');
  } else {
    dev.run(sim);
    run(4);
    const f = sim.aircraft;
    const st = ST.stovlState();
    const along = (x0, z0, h) => {
      const k = (h * Math.PI) / 180;
      const dx = f.pos.x - x0;
      const dz = f.pos.z - z0;
      return { fwd: dx * Math.sin(k) - dz * Math.cos(k), right: dx * Math.cos(k) + dz * Math.sin(k) };
    };
    const move = (code, secs) => {
      const x0 = f.pos.x;
      const z0 = f.pos.z;
      const h0 = f.heading;
      sim.key(code, true);
      run(secs);
      sim.key(code, false);
      run(1.5);
      return { ...along(x0, z0, h0), turn: ((f.heading - h0 + 540) % 360) - 180, mode: st.mode };
    };
    const W = move('KeyW', 12);
    r.ok('F-35B: holding W in the hover slides it forward and the hover STAYS on', W.fwd > 80 && W.mode === 'hover' && !f.crashed, `${W.fwd.toFixed(0)} m forward in 12 s, still ${W.mode}`);
    const A = move('KeyA', 3);
    r.ok('F-35B: A slides it left in the hover', A.right < -8 && A.mode === 'hover', `${A.right.toFixed(1)} m sideways`);
    const Q = move('KeyQ', 3);
    r.ok('F-35B: Q turns it on the spot in the hover', Q.turn < -45 && Q.mode === 'hover', `${Q.turn.toFixed(0)}° in 3 s`);
    const panel = document.querySelector('.stovl-move');
    r.ok('F-35B: the HOVER panel says how to move', !!panel && panel.classList.contains('is-on') && /slide/i.test(panel.textContent), panel ? panel.textContent : '');
  }

  /* ================================================================ */
  say('aircrew: the runaway plane');
  const RWm = await load('../../src/features/runaway.js');
  const WSm = await load('../../src/features/wasted.js');
  const KDm = await load('../../src/features/knockdown.js');
  if (!(RWm && RWm.runaway && WSm && WSm.wasted && WSm.showWasted && KDm && KDm.knockdown)) {
    r.ok('runaway: its modules load', false, [RWm, WSm, KDm].map((m) => m && m.__error).filter(Boolean).join(' | '));
    return r;
  }
  const RW = RWm.runaway;
  const WS = WSm.wasted;
  const KD = KDm.knockdown;
  const hopOut = async (thr) => {
    // Calm air and no AI traffic: an empty plane at full power should take off, not be blown or bumped off the runway.
    await sim.startMode('free', { aircraft: 'skylark', taxi: false, time: 'day', condition: 'clear', windSpeedKts: 0, traffic: false });
    run(0.5);
    sim.key('Space', true);
    sim.input.throttleTarget = thr;
    run(2.5);
    const prompt = foot.snapshot().prompt;
    sim.tap('KeyO');
    run(0.1);
    const warned = !foot.active && /Power’s still on/.test(lastToast());
    sim.key('Space', false);
    sim.tap('KeyO');
    run(0.3);
    return { prompt, warned };
  };
  // Idle and brakes: parked, exactly as before.
  await sim.startMode('free', { aircraft: 'skylark', taxi: false });
  run(1.5);
  sim.tap('KeyO');
  run(0.5);
  r.ok('runaway: engine at idle, O gets you out and she is parked as ever', foot.active && !RW.active && !sim.aircraft.engineOn && sim.override && sim.override.brakes === 1);
  sim.tap('KeyO');
  run(0.3);
  // A fast jet with the power on: parked too (only the small planes run away).
  await sim.startMode('free', { aircraft: 'f22', taxi: false });
  run(0.5);
  sim.key('Space', true);
  sim.input.throttleTarget = 0.4;
  run(2);
  sim.tap('KeyO');
  run(0.3);
  r.ok('runaway: a fast jet with the power on is parked, not left running', !RW.active && (!foot.active || (sim.override && sim.override.brakes === 1)),
    `walking ${foot.active}, runaway ${RW.active}`);
  sim.key('Space', false);
  if (foot.active) sim.tap('KeyO');
  run(0.3);
  // Full power in the Skylark.
  const full = await hopOut(1);
  r.ok('runaway: the first O with the power on only warns — "Power’s still on — she’ll go without you!"', full.warned, lastToast());
  const acR = sim.aircraft;
  const p0 = acR.pos.clone();
  r.ok('runaway: the second O hops you out and she keeps going (engine on, no brakes)', foot.active && RW.active && acR.engineOn && sim.override === RW.ghost && sim.override.brakes === 0,
    `walking ${foot.active}, runaway ${RW.active}, engine ${acR.engineOn}`);
  r.ok('runaway: the minimap shows you as a YOU pin (she is the middle of it)', Array.isArray(sim.mapPins) && sim.mapPins.some((p) => p.label === 'YOU'));
  if (sim.atc && typeof sim.atc.say === 'function') {
    const cool = sim.atc.cool;
    sim.atc.cool = 0;
    const said = sim.atc.say('Skylark one seven two, cleared for take-off.');
    sim.atc.cool = cool;
    r.ok('runaway: the tower does not talk to the empty plane', said === false, `say() returned ${said}`);
  }
  let tookOff = false;
  let crashT = null;
  let stopT = null;
  run(110, (t) => {
    if (RW.phase === 'air') tookOff = true;
    if (crashT === null && acR.crashed) crashT = t;
    if (stopT === null && RW.phase === 'stopped') stopT = t;
    return crashT !== null || stopT !== null;
  });
  r.ok('runaway: at full power she takes off and flies herself', tookOff, `phase ${RW.phase}, ${Math.round(RW.airT)} s in the air, ${Math.round(RW.maxDist)} m from where you left her at most`);
  r.ok('runaway: she comes down (crashes or stops) where the map can find her, within 3 km',
    (crashT !== null || stopT !== null) && acR.pos.distanceTo(p0) < 3000, `${crashT !== null ? 'crashed (' + acR.crashReason + ')' : 'stopped'} ${Math.round(acR.pos.distanceTo(p0))} m away after ${Math.round((crashT ?? stopT) || 0)} s`);
  run(3);
  r.ok('runaway: her crash does not end your flight (no Crashed screen), and Enter flies again is offered',
    sim.state === 'flying' && !debriefUp() && foot.active && /fly again|start again/i.test(foot.snapshot().prompt), foot.snapshot().prompt);
  // Run over: out with a little power, then stand in her path.
  await hopOut(0.35);
  run(2);
  const hh = (sim.aircraft.heading * Math.PI) / 180;
  foot.place(sim.aircraft.pos.x + Math.sin(hh) * 25, sim.aircraft.pos.z - Math.cos(hh) * 25, sim.aircraft.heading + 180);
  const c0 = WS.count;
  const k0 = KD.count;
  run(10, () => WS.count > c0);
  const hit = WS.count > c0 && WS.cause === 'plane' && KD.count === k0 + 1 && KD.down;
  let word = false;
  let grey = false;
  let slow = 1;
  let lay = 9;
  run(10, () => {
    word = word || WS.wordShown;
    grey = grey || WS.grey;
    slow = Math.min(slow, WS.scale);
    if (KD.down) lay = Math.min(lay, KD.ragdoll.height());
    return !WS.active && !KD.down;
  });
  r.ok('runaway: she can run you over — knocked down (a ragdoll on the ground), WASTED, grey, slow motion', hit && word && grey && slow < 0.5 && lay < 0.5,
    `hit ${hit}, word ${word}, grey ${grey}, slowest ${slow}, lowest the body lay ${lay.toFixed(2)} m, "${KD.words}"`);
  r.ok('WASTED: you get back up and can walk again', !WS.active && KD.gotUp && foot.active && !(foot.control && foot.control.locked));
  // The generic hook, for other teams: callable on its own — and no longer only for your own plane (the pilot brief).
  const c1 = WS.count;
  const started = WSm.showWasted(sim, 'test', { words: 'Hit by a test.' });
  run(0.2);
  r.ok('WASTED: anything can be the cause now — showWasted(sim, cause) starts it without v48’s own-plane rule', started && WS.count === c1 + 1 && WS.cause === 'test' && WS.active && WS.words === 'Hit by a test.');
  run(5, () => !WS.active);
  sim.tap('Enter');
  for (let i = 0; i < 40 && (foot.active || RW.active); i++) await new Promise((res) => setTimeout(res, 50));
  run(0.3);
  r.ok('runaway: Enter flies again — back in the seat, nothing left running', !foot.active && !RW.active && sim.override !== RW.ghost && !sim.mapPins, `walking ${foot.active}, runaway ${RW.active}`);
  /* ================================================================ */
  say('aircrew: the runaway switch in the pause menu');
  {
    const sw = sim.menus.screens.pause.querySelector('[data-runaway-toggle]');
    r.ok('runaway switch: "Getting out" in the pause menu says Runaway plane & WASTED', !!sw && /Runaway plane & WASTED: (on|off)/.test(sw.textContent), sw ? sw.textContent : 'missing');
    const was = sim.settings.runawayPlane;
    if (sw && /: on/.test(sw.textContent)) sw.click();
    r.ok('runaway switch: off is saved in the settings', sim.settings.runawayPlane === false);
    // One O: with the switch off it gets you straight out, as it always did (hopOut's second O would put you back in).
    await sim.startMode('free', { aircraft: 'skylark', taxi: false, time: 'day', condition: 'clear', windSpeedKts: 0, traffic: false });
    run(0.5);
    sim.key('Space', true);
    sim.input.throttleTarget = 1;
    run(2.5);
    sim.tap('KeyO');
    run(0.3);
    sim.key('Space', false);
    r.ok('runaway switch: off, getting out with the power on parks her as before', foot.active && !RW.active && !sim.aircraft.engineOn, `walking ${foot.active}, runaway ${RW.active}, engine ${sim.aircraft.engineOn}`);
    r.ok('runaway switch: off, no WASTED screen for anything', WSm.showWasted(sim, 'plane') === false);
    // ...but you are still knocked over: the switch hides the screen, not the knock (the pilot brief).
    if (foot.active) {
      const kc = KD.count;
      const wc = WS.count;
      const h = (foot.walker.heading * Math.PI) / 180;
      const fell = KDm.knockDown(sim, { cause: 'test', vel: { x: Math.sin(h) * 7, y: 0, z: -Math.cos(h) * 7 }, hitY: 0.7, words: 'Hit by a test.', force: true });
      run(0.5);
      r.ok('runaway switch: off, a knock still knocks you down — just no WASTED screen', fell && KD.down && KD.count === kc + 1 && WS.count === wc && !WS.active && !WS.grey);
      run(9, () => !KD.down);
    }
    if (foot.active) { sim.tap('KeyO'); run(0.3); }
    if (sw && /: off/.test(sw.textContent)) sw.click();
    r.ok('runaway switch: back on', sim.settings.runawayPlane !== false && /: on/.test(sw.textContent));
    if (was === false && sw) sw.click();
  }

  return r;
}

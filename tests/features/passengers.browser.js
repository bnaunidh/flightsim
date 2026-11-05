/**
 * Browser checks for passengers, in the real game, through the real keys:
 *
 *   EVACUATION    Enter twice in an A320 at 2,000 ft: the passengers stream
 *                 out of the doors under parachutes FIRST — every one of them
 *                 before any crew member — then the cabin crew, then you,
 *                 last, out of the front door. She is held straight and level
 *                 while they go; then, empty, she noses over slowly and goes
 *                 down, broken up by the crash physics, with no Crashed
 *                 screen; everybody floats down and lands gently. The same
 *                 after an Air Force One flight, and after a passenger
 *                 mission, in the same session (the
 *                 "exit rule stolen" kind of bug: AF1 tears down what it
 *                 borrowed) — and on Air Force One itself it is not offered.
 *                 Too low (under 500 ft) it says to climb.
 *   TURNAROUND    Free Flight at a gate: the ground crew is sent for by
 *                 itself and a line of passengers sets off from the terminal;
 *                 the jet bridge docks (still the airport's), the front door
 *                 opens and the counter climbs ("Boarding 87/162"); in the
 *                 Cabin view the next few walk down the aisle; the stair truck
 *                 comes and the line climbs it; boarding complete, the doors
 *                 shut, the bridge pulls back — 30-60 s watched — and Y is the
 *                 pushback. SKIP: Y at any moment (everybody aboard, the crew
 *                 there, the bridge back, nobody on the apron), then Y pushes;
 *                 the panel's button; the setting. Skip to the runway lines
 *                 you up. Getting off: the bridge, the crew, down the stairs.
 *   COMFORT       a hard bank in the A320: the meter drops and says "Easy on
 *                 the bank"; level again, it stops.
 *   CABIN VIEW    the C cycle gains Cabin after Wing in an airliner, with the
 *                 camera inside the fuselage over rows of seated people; never
 *                 in the Skylark.
 *   WINDOWS       faces in the A320's windows from outside, near it only.
 *   MISSION       Island Hopper starts at a gate, boarding, under its board
 *                 step; skipping gets it going.
 *
 *   const { check } = await import('./tests/features/passengers.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d }); } };
 *   await check(window.__sim, r, console.log); console.table(r.checks);
 */

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

export async function check(sim, r, say = () => {}) {
  // The turnaround's timings on a quiet apron, as the self-test has it (the crew gives way to taxiing traffic).
  const trafficWas = sim.settings.traffic;
  sim.settings.traffic = false;
  try {
    await run_(sim, r, say);
  } finally {
    if (trafficWas === undefined) delete sim.settings.traffic;
    else sim.settings.traffic = trafficWas;
  }
}

async function run_(sim, r, say) {
  say('passengers: loading');
  const PX = await load('../../src/features/passengers.js');
  const EJ = await load('../../src/features/eject.js');
  const ST = await load('../../src/features/passengers/state.js');
  const AS = await load('../../src/features/airport-services.js');
  const EXT = await load('../../src/game/extensions.js');
  const okLoad = !!(PX && PX.passengers && EJ && EJ.eject && ST && ST.PAX && AS && AS.servicesState && EXT && EXT.extStatus);
  r.ok('passengers: its modules load', okLoad, okLoad ? '' : [PX, EJ, ST, AS, EXT].map((m) => m && m.__error).filter(Boolean).join(' | '));
  if (!okLoad) return r;
  const live = EXT.extStatus();
  r.ok('passengers: the feature is registered and live', live.some((e) => e.id === 'passengers' && e.live) && live.some((e) => e.id === 'eject' && e.live), JSON.stringify(live.filter((e) => !e.live)));
  const P = PX.passengers;
  const PAX = ST.PAX;
  const E = EJ.eject;
  const dt = 1 / 30;
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
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const noDebrief = () => clearTimeout(sim._crashDebriefT);

  /**
   * One evacuation, flown to the end. Returns what happened, in order.
   */
  async function evacuate(label, aircraft = 'a320', height = 610) {
    await sim.startMode('free', { aircraft, airborne: true, taxi: false });
    run(0.6);
    const ac = sim.aircraft;
    if (height !== 610) {
      ac.pos.y += height - ac.agl;
      run(0.3);
    }
    const booked = PAX.booked;
    const crew = PAX.crew;
    sim.tap('Enter');
    run(0.1);
    const armed = E.phase === 'idle' && /evacuate/i.test(lastToast());
    sim.tap('Enter');
    run(0.05);
    const started = E.phase === 'evac';
    const t = { firstPax: null, lastPax: null, firstCrew: null, lastCrew: null, pilot: null };
    let maxBank = 0;
    let minAgl = Infinity;
    let pressedDuring = '';
    let wasHeldBy = sim.override === null ? 'none' : 'hold';
    let clock = 0;
    let doorsOpen = 0;
    // Long enough for a full A380 at Reduce flashing's pace (evac.js DOOR_RATE_SAFE); it stops a second after you are out.
    run(75, (s) => {
      clock = s;
      const o = PAX.out;
      if (t.firstPax === null && o.pax > 0) t.firstPax = s;
      if (t.lastPax === null && booked > 0 && o.pax >= booked) t.lastPax = s;
      if (t.firstCrew === null && o.crew > 0) t.firstCrew = s;
      if (t.lastCrew === null && crew > 0 && o.crew >= crew) t.lastCrew = s;
      if (t.pilot === null && E.phase === 'out') t.pilot = s;
      if (E.phase === 'evac') {
        maxBank = Math.max(maxBank, Math.abs(ac.bankAngleDeg()));
        minAgl = Math.min(minAgl, ac.agl);
        if (!pressedDuring && s > 2) {
          sim.tap('Enter');
          pressedDuring = lastToast();
        }
        const md = sim.model && sim.model.userData && sim.model.userData.doors;
        if (md && md.amount) doorsOpen = Math.max(doorsOpen, E.evacDoors.filter((d) => md.amount(d.id) > 0.5).length);
      }
      return t.pilot !== null && s > t.pilot + 1;
    });
    return { label, armed, started, booked, crew, t, maxBank, minAgl, pressedDuring, wasHeldBy, clock, doorsOpen, ac };
  }

  /* ================================================================ */
  say('passengers: the evacuation, in the A320');
  {
    const ev = await evacuate('a320');
    const { t } = ev;
    r.ok('evac: the first Enter arms it — "EVACUATE — passengers first"', ev.armed, lastToast());
    r.ok('evac: the second Enter starts it', ev.started, `phase ${E.phase}`);
    r.ok('evac: the passengers go first — a stream out of the doors, under parachutes', t.firstPax !== null && t.firstPax < 1.5 && t.lastPax !== null,
      `${PAX.out.pax}/${ev.booked} out; first at ${t.firstPax && t.firstPax.toFixed(2)} s, last at ${t.lastPax && t.lastPax.toFixed(1)} s`);
    r.ok('evac: every passenger is out before the first of the cabin crew', t.lastPax !== null && t.firstCrew !== null && t.lastPax <= t.firstCrew,
      `last passenger ${t.lastPax && t.lastPax.toFixed(2)} s, first crew ${t.firstCrew && t.firstCrew.toFixed(2)} s`);
    r.ok('evac: then the cabin crew — all of them — and you last', t.lastCrew !== null && t.pilot !== null && t.lastCrew < t.pilot && PAX.out.crew === ev.crew,
      `crew ${PAX.out.crew}/${ev.crew} by ${t.lastCrew && t.lastCrew.toFixed(1)} s, you at ${t.pilot && t.pilot.toFixed(1)} s`);
    const order = (E.lastEvac && E.lastEvac.order) || [];
    const who = order.map((o) => o.who);
    r.ok('evac: the timetable agrees: passengers, crew, you — in that order, nobody twice', who.length === ev.booked + ev.crew + 1 && who.lastIndexOf('pax') < who.indexOf('crew') && who[who.length - 1] === 'pilot',
      `${who.length} releases`);
    r.ok('evac: out of the doors on both sides, and the doors open', E.lastEvac && E.lastEvac.doors.some((d) => /^L/.test(d)) && E.lastEvac.doors.some((d) => /^R/.test(d)) && ev.doorsOpen >= 2,
      `${E.lastEvac && E.lastEvac.doors.join(' ')}; ${ev.doorsOpen} open`);
    r.ok('evac: Enter while they go says passengers first (you cannot jump the queue)', /passengers first|you are next/i.test(ev.pressedDuring), ev.pressedDuring);
    r.ok('evac: the captain says it on the PA, as words (eject.js reaches it through passengers/state.js)', P.said.includes('evac') || P.pa.said.has('evac'), P.said.join(', '));
    r.ok('evac: she is held straight and level while they jump', ev.maxBank < 12 && ev.minAgl > 450, `bank ≤ ${ev.maxBank.toFixed(1)}°, lowest ${ev.minAgl.toFixed(0)} m`);
    const J = PAX.jumpers;
    r.ok('evac: one crowd of parachutes, three draws however many', J && J.count === ev.booked + ev.crew && J.root.children.length === 3, `${J ? J.count : 0} jumpers`);
    const open = J ? J.list.filter((j) => j.open >= 1).length : 0;
    r.ok('evac: their canopies are open', J && open > J.count * 0.8, `${open}/${J ? J.count : 0}`);
    const below = J ? J.list.filter((j) => j.pos.y < ev.ac.pos.y - 3 || j.landed).length : 0;
    r.ok('evac: they drop clear below the aeroplane, not through it', J && below > J.count * 0.95, `${below}/${J ? J.count : 0} below`);
    r.ok('evac: you are out of the front door, under your own canopy, in the captain’s uniform', E.phase === 'out' && E.me && E.me.uniform === 'captain' && E.lastEject && E.lastEject.kind === 'bail',
      JSON.stringify(E.lastEject));
    // Now she flies on, empty, noses over and goes down.
    const ac = ev.ac;
    const p0 = ac.pitchAngleDeg();
    let pitchMin = p0;
    let crashAt = null;
    let landedAll = null;
    let maxSink = 0;
    sim.key('KeyS', true);
    run(170, (s) => {
      pitchMin = Math.min(pitchMin, ac.pitchAngleDeg());
      if (crashAt === null && ac.crashed) crashAt = s;
      noDebrief();
      if (J) for (const j of J.list) if (!j.landed && j.pos.y - j.groundY < 3) maxSink = Math.max(maxSink, -j.vel.y);
      if (landedAll === null && J && J.airborne() === 0) landedAll = s;
      return crashAt !== null && landedAll !== null && E.phase === 'walking' && s > crashAt + 2;
    });
    sim.key('KeyS', false);
    r.ok('evac: empty, she noses over — slowly — and goes down', crashAt !== null && pitchMin < p0 - 8, `pitch ${p0.toFixed(0)}° → ${pitchMin.toFixed(0)}°, crashed ${crashAt === null ? 'never' : crashAt.toFixed(0) + ' s later'}: ${ac.crashReason}`);
    const gc = sim.model && sim.model.userData && sim.model.userData.gameCrash;
    r.ok('evac: the crash physics breaks her up, as for any crash', !!gc || ac.crashed, gc ? 'fleet crash running' : `crashed ${ac.crashed}`);
    r.ok('evac: no Crashed screen — nobody was aboard', sim.state === 'flying' && !debriefUp(), `state ${sim.state}`);
    r.ok('evac: everybody floats down and lands gently', landedAll !== null && maxSink < 7, `all down at ${landedAll === null ? 'never' : landedAll.toFixed(0) + ' s'}, landing at ≤ ${maxSink.toFixed(1)} m/s`);
    r.ok('evac: you land and walk', E.phase === 'walking', E.phase);
    let downSafely = '';
    run(3, () => {
      downSafely = [...document.querySelectorAll('.hud-toast')].map((x) => x.textContent).find((x) => /down safely/i.test(x)) || '';
      return !!downSafely;
    });
    r.ok('evac: once you are down too, the HUD says everybody is down safely, with the numbers', /\d+ passengers and \d+ crew/.test(downSafely), downSafely || lastToast());
  }

  /* ================================================================ */
  say('passengers: too low, and the other airliners');
  {
    await sim.startMode('free', { aircraft: 'a320', airborne: true, taxi: false });
    run(0.4);
    sim.aircraft.pos.y -= sim.aircraft.agl - 90;
    run(0.1);
    sim.tap('Enter');
    run(0.1);
    r.ok('evac: under 500 ft it says to climb (nobody jumps)', E.phase === 'idle' && /too low/i.test(lastToast()), lastToast());
    // Every airliner, its own cabin (it was the A320 three times over once: evacuate()'s second argument is the type).
    for (const id of ['meridian', 'b747', 'a380']) {
      const ev = await evacuate(id, id);
      const type = sim.aircraftType && sim.aircraftType.id;
      const who = ((E.lastEvac && E.lastEvac.order) || []).map((o) => o.who);
      r.ok(`evac: the ${id} — passengers, then crew, then you`, type === id && ev.started && who.length === ev.booked + ev.crew + 1 && who.lastIndexOf('pax') < who.indexOf('crew') && who[who.length - 1] === 'pilot' && E.phase === 'out',
        `${type}: ${ev.booked} pax, ${ev.crew} crew; phase ${E.phase}`);
      // And she flies on, noses over and goes down, and everybody floats down.
      const ac = ev.ac;
      const J = PAX.jumpers;
      const p0 = ac.pitchAngleDeg();
      let pitchMin = p0;
      let crashAt = null;
      let landedAll = null;
      let maxSink = 0;
      run(170, (s) => {
        pitchMin = Math.min(pitchMin, ac.pitchAngleDeg());
        if (crashAt === null && ac.crashed) crashAt = s;
        noDebrief();
        if (J) for (const j of J.list) if (!j.landed && j.pos.y - j.groundY < 3) maxSink = Math.max(maxSink, -j.vel.y);
        if (landedAll === null && J && J.airborne() === 0) landedAll = s;
        return crashAt !== null && landedAll !== null && s > crashAt + 2;
      });
      r.ok(`evac: the ${id}, empty, noses over and goes down; no Crashed screen; everybody down gently`,
        crashAt !== null && pitchMin < p0 - 8 && sim.state === 'flying' && !debriefUp() && landedAll !== null && maxSink < 7 && J && J.count === ev.booked + ev.crew,
        `pitch ${p0.toFixed(0)}° → ${pitchMin.toFixed(0)}°, crashed ${crashAt === null ? 'never' : crashAt.toFixed(0) + ' s later'}; ${J ? J.count : 0} under canopies, all down ${landedAll === null ? 'never' : 'at ' + landedAll.toFixed(0) + ' s'}, ≤ ${maxSink.toFixed(1)} m/s`);
    }
  }

  /* ================================================================ */
  // Seizure safety (the house rule: the flicker probe stays clean for anything visual). Everybody once
  // followed the person before them down exactly the same line, four or five a second out of every door,
  // so each stream ran figures over the same pixels several times a second — 11% of a 10-degree field
  // flashing by WCAG's measure in the A320. Now each jumps a little differently (jumpers.js JUMP.spread)
  // and, with Reduce flashing on, they go at a pace the probe allows (evac.js DOOR_RATE_SAFE and
  // TOTAL_RATE_SAFE). Measured on the real renderer from the evacuation's own camera: the A320 3 s in
  // (the first of the stream) and 8 s in (the canopies opening behind her), the 747 and the A380 with
  // their ten doors.
  say('passengers: the evacuation under the flicker probe');
  {
    const isStub = /^\(\)=>\{\}$/.test(String(sim.renderer.render).replace(/\s/g, ''));
    const real = (typeof window !== 'undefined' && window.__realRender) || (isStub ? null : sim.renderer.render);
    const stub = sim.renderer.render;
    const reduceWas = sim.settings.reduceFlashing;
    const pct = (x) => `${(x * 100).toFixed(2)}%`;
    try {
      const FP = await import('../flicker-probe.js');
      const FB = await import('./flicker.browser.js');
      if (real) sim.renderer.render = real;
      sim.applySetting('reduceFlashing', true);
      for (const [type, at] of [['a320', 3], ['a320', 8], ['b747', 5], ['a380', 10]]) {
        await FP.setupScenario(sim, { map: sim.settings.map, aircraft: type, altFt: 3000, view: 'chase', look: 'level', time: 'day', condition: 'clear' });
        let m = null;
        try {
          sim.tap('Enter');
          sim.step(0.1);
          sim.tap('Enter');
          sim.step(at);
          const going = E.phase === 'evac' && PAX.out.pax > 10 && sim.aircraftType.id === type;
          m = await FP.measure(sim, { frames: 60, fps: 30, warm: 0, raycast: false });
          const drawn = !!real && m.meanLum.max > 0.01;
          r.ok(`evac flicker: the ${type} ${at} s in — the probe sees the stream (a real renderer, people out)`, drawn && going, `luminance up to ${m.meanLum.max}; ${PAX.out.pax} out, phase ${E.phase}`);
          r.ok(`evac flicker: the ${type} ${at} s in — under ${pct(FB.FLICKER_MAX)} of the screen flickers`, m.percArea <= FB.FLICKER_MAX, `${pct(m.percArea)}, worst window ${pct(m.percWindow)}`);
          r.ok(`evac flicker: the ${type} ${at} s in — WCAG flashing under ${pct(FB.WCAG_WINDOW_MAX)} of any 10-degree field`, m.wcagWindow <= FB.WCAG_WINDOW_MAX, `${pct(m.wcagWindow)} (area ${pct(m.wcagArea)})`);
        } finally {
          sim.override = null;
          if (sim._flickerRestore) sim._flickerRestore();
        }
      }
    } catch (e) {
      r.ok('evac flicker: the probe ran', false, String((e && e.stack) || e).slice(0, 300));
    } finally {
      sim.renderer.render = stub;
      if (sim.settings.reduceFlashing !== reduceWas) sim.applySetting('reduceFlashing', reduceWas !== false);
    }
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
  }

  /* ================================================================ */
  say('passengers: after Air Force One');
  {
    let afo = false;
    try {
      await sim.startMode('mission', { id: 'afo-normal', role: 'president' });
      run(3);
      afo = true;
      await sim.startMode('mission', { id: 'afo-normal', role: 'captain' });
      run(1);
      r.ok('afo: no passengers' + "'" + ' panel on Air Force One', !P.state.active && !(P.panel() || {}).shown, `active ${P.state.active}`);
      const ac = sim.aircraft;
      if (ac.onGround) {
        ac.reset({ pos: ac.pos.clone().setY(0), headingDeg: ac.heading, speed: 80, altAGL: 700, engineOn: true });
        run(0.3);
      }
      sim.tap('Enter');
      run(0.1);
      r.ok('afo: on Air Force One itself there is no evacuation — the kind words instead', E.phase === 'idle' && /Air Force One/i.test(lastToast()), lastToast());
    } catch (e) {
      r.ok('afo: the Air Force One flights start', false, String(e && e.message));
    }
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    const ev = await evacuate('a320 after AF1');
    r.ok('evac: after Air Force One in the same session it still works, in order', afo && ev.armed && ev.started && ev.t.lastPax !== null && ev.t.lastPax <= ev.t.firstCrew && ev.t.pilot > ev.t.lastCrew && E.phase === 'out',
      JSON.stringify(ev.t));
  }

  /* ================================================================ */
  say('passengers: the turnaround at the gate');
  {
    const TA = P.turnaround;
    const svc = AS.__airportServices;
    const said = () => ((svc.S && svc.S.said) || '').replace(/<[^>]+>/g, '');
    const ourBridge = () => (sim.apron.bridges || []).find((q) => q.visitor === 'player' || q.visitor === 'spare');
    await sim.startMode('free', { aircraft: 'a320', startAt: 'gate', taxi: false });
    run(0.5);
    const dec = sim.spawns && sim.spawns.state && sim.spawns.state().decided;
    const atGate = PAX.stage === 'gate' || PAX.stage === 'boarding';
    r.ok('boarding: Free Flight at a gate starts with nobody aboard, waiting for the bridge', atGate && PAX.aboard === 0 && PAX.booked > 100, `${PAX.stage}, ${PAX.aboard}/${PAX.booked}; ${dec ? dec.label : '?'}`);
    run(1.5);
    r.ok('turnaround: the ground crew is sent for by itself, and a line of passengers sets off from the terminal for the back stairs',
      AS.servicesState().state === 'calling' && !!TA.stairs && !!TA.walkers && TA.walkers.shown > 10 && TA.walkers.root.visible,
      `crew ${AS.servicesState().state}, ${TA.walkers ? TA.walkers.shown : 0} walking`);
    r.ok('turnaround: the prompt says what is happening, and that Y skips it', /jet bridge/i.test(said()) && /skip/i.test(said()), said());
    let docked = null;
    run(20, (s) => {
      if (PAX.stage === 'boarding') {
        docked = s + 2;
        return true;
      }
      return false;
    });
    const md = sim.model && sim.model.userData && sim.model.userData.doors;
    const door = md && md.list.filter((d) => d.side === 'left' && d.deck !== 'upper' && d.kind === 'passenger').sort((a, b) => a.z - b.z)[0];
    // A door takes about two seconds to swing open.
    run(2.5);
    r.ok('boarding: the jet bridge docks, the front door opens and boarding begins', docked !== null && (!md || md.amount(door.id) > 0.5), `after ${docked === null ? 'never' : docked.toFixed(1) + ' s'}; door ${md ? md.amount(door.id).toFixed(2) : '-'}`);
    r.ok('turnaround: the bridge on your door is still the airport\'s (the crew hands it back)', ourBridge() && ourBridge().visitor === 'player', ourBridge() ? ourBridge().visitor : 'none');
    const a = P.panel();
    run(3);
    const b = P.panel();
    const n = (s) => Number(((s && s.board) || '').match(/(\d+)\/\d+/)?.[1] || -1);
    r.ok('boarding: the counter climbs — "Boarding 87/162"', /Boarding \d+\/\d+/.test(b.board) && n(b) > n(a) && n(a) >= 0 && /Boarding \d+\/\d+/.test(said()), `${a.board} → ${b.board}; "${said()}"`);
    r.ok('boarding: the PA welcomes them aboard (words only)', P.said.includes('welcome') || P.pa.said.has('welcome'), P.said.join(', '));
    r.ok('boarding: Skip boarding (Y) and Skip to the runway are on the panel', b.buttons.includes('skipBoarding') && b.buttons.includes('skipRunway'), b.buttons.join(', '));
    // The Cabin view while they board: the next few walking down the aisle to their rows.
    sim.rig.setMode('wing');
    const cm = sim.rig.cycle();
    run(0.5);
    const I = P.interior;
    r.ok('turnaround: in the Cabin view the next few walk down the aisle to their rows', cm === 'cabin' && I && I.standing && I.standing.count > 0 && I.bodies.count > 0 && I.bodies.count < I.taken.length,
      `${cm}; ${I && I.standing ? I.standing.count : 0} in the aisle, ${I ? I.bodies.count : 0}/${I ? I.taken.length : 0} seated`);
    sim.rig.setMode('chase');
    // The stairs: the crew is there, and up they go.
    let climbed = 0;
    let doneAt = null;
    run(70, () => {
      const W = TA.walkers;
      const L = TA.stairs;
      if (W && L && W.shown) {
        const g = L.stream.path.p[0].y;
        for (const w of L.stream.list) climbed = Math.max(climbed, L.stream.path.sample(w.s).y - g);
      }
      if (PAX.stage === 'ready') {
        // The turnaround's own clock: from the start of the flight to the doors shutting.
        doneAt = TA.t;
        return true;
      }
      return false;
    });
    const viaStairs = TA.stairs ? TA.stairs.stream.delivered : 0;
    r.ok('turnaround: the stair truck comes to the back door and the line climbs it — a quarter of them aboard that way', climbed > 2 && viaStairs > PAX.booked * 0.2 && AS.servicesState().state === 'serviced',
      `up to ${climbed.toFixed(1)} m; ${viaStairs.toFixed(0)} of ${PAX.booked} by the stairs; crew ${AS.servicesState().state}`);
    r.ok('turnaround: boarding complete — everybody aboard, nobody left on the apron, the doors shutting', PAX.aboard === PAX.booked && (!TA.walkers || TA.walkers.shown === 0) && (P.said.includes('doors') || P.pa.said.has('doors')),
      `${PAX.aboard}/${PAX.booked} after ${doneAt === null ? 'never' : doneAt.toFixed(0) + ' s'}`);
    run(1.6);
    const away = TA.awayBridge;
    r.ok('turnaround: then the jet bridge pulls back off the door, and the prompt says so', !!away && away.target === 0 && away.ext < 1 && /pulling back/i.test(said()) && (!md || md.amount(door.id) < 0.5),
      `${away ? away.ext.toFixed(2) : 'no bridge'}; "${said()}"`);
    let clear = null;
    run(12, (s) => {
      if (away && away.ext < 0.3) {
        clear = s;
        return true;
      }
      return false;
    });
    const watched = doneAt !== null && clear !== null ? doneAt + 1.6 + clear : null;
    r.ok('turnaround: watched from the start to the bridge clear of the door in 30-60 s', watched !== null && watched >= 30 && watched <= 62, `${watched === null ? 'never' : watched.toFixed(0) + ' s'}`);
    sim.tap('KeyP');
    run(0.3);
    r.ok('turnaround: and Y is the pushback', AS.servicesState().state === 'pushback', AS.servicesState().state);
    if (AS.servicesState().state === 'pushback') svc.stopPush(sim);

    // Skip at any moment: Y while the bridge is still coming.
    await sim.startMode('free', { aircraft: 'a320', startAt: 'gate', taxi: false });
    run(3);
    const before = TA.walkers ? TA.walkers.shown : 0;
    sim.tap('KeyP');
    run(0.2);
    const bb = TA.awayBridge;
    r.ok('skip: Y at any moment — everybody aboard, doors shut, the crew in place, the bridge back, nobody on the apron',
      PAX.stage === 'ready' && PAX.aboard === PAX.booked && AS.servicesState().state === 'serviced' && bb && bb.ext === 0 && before > 0 && (!TA.walkers || TA.walkers.shown === 0) && P.ready(),
      `${PAX.stage} ${PAX.aboard}/${PAX.booked}, crew ${AS.servicesState().state}, bridge ${bb ? bb.ext : '-'}, ${before} walking before`);
    sim.tap('KeyP');
    run(0.3);
    r.ok('skip: then Y is the pushback', AS.servicesState().state === 'pushback', AS.servicesState().state);
    if (AS.servicesState().state === 'pushback') svc.stopPush(sim);
    // The panel's button, the same.
    await sim.startMode('free', { aircraft: 'a320', startAt: 'gate', taxi: false });
    run(12);
    P.press('skipBoarding');
    run(0.2);
    r.ok('boarding: Skip boarding on the panel — everybody aboard, doors shut, at once', PAX.stage === 'ready' && PAX.aboard === PAX.booked && (!TA.walkers || TA.walkers.shown === 0), `${PAX.stage} ${PAX.aboard}/${PAX.booked}`);
    P.press('skipRunway');
    run(1);
    const ac = sim.aircraft;
    r.ok('boarding: Skip to the runway lines you up, engines on', ac.onGround && Math.abs(((ac.heading - 90 + 540) % 360) - 180) < 5 && ac.engineOn && !ac.crashed, `heading ${ac.heading.toFixed(0)}, engine ${ac.engineOn}`);
    // The setting does it for you.
    const was = sim.settings.autoSkipBoarding;
    sim.settings.autoSkipBoarding = true;
    await sim.startMode('free', { aircraft: 'a320', startAt: 'gate', taxi: false });
    run(0.5);
    r.ok('skip: Settings "Skip the boarding at the gate" — aboard, doors shut and ready to push from the start', PAX.stage === 'ready' && PAX.aboard === PAX.booked && AS.servicesState().state === 'serviced',
      `${PAX.stage} ${PAX.aboard}/${PAX.booked}, crew ${AS.servicesState().state}`);
    sim.settings.autoSkipBoarding = was;

    // Getting off: a flight, then parked on a gate (the airport's own dev action does the taxiing).
    await sim.startMode('free', { aircraft: 'a320', airborne: true, taxi: false });
    run(4);
    const park = EXT.extDevActions().find((x) => /park at a free stand/i.test(x.label));
    if (park) {
      park.run(sim);
      let off = null;
      let seen = '';
      let down = 0;
      run(60, (s) => {
        const p = P.panel();
        if (p && /Getting off/.test(p.board) && !seen) seen = p.board;
        down = Math.max(down, TA.walkers ? TA.walkers.shown : 0);
        if (PAX.stage === 'off' && off === null) off = s;
        return off !== null && s > off + 1;
      });
      r.ok('deplaning: parked at a gate after a flight, the bridge docks, the crew comes, and they get off — some down the stairs to the terminal',
        seen && off !== null && PAX.aboard === 0 && off < 50 && down > 5,
        `${seen || 'no counter'}; everyone off ${off === null ? 'never' : 'after ' + off.toFixed(0) + ' s'} (${PAX.stage}); ${down} walking at most`);
    } else r.ok('deplaning: the airport can park you on a gate', false, 'no dev action');
  }

  /* ================================================================ */
  say('passengers: the comfort meter and a hard bank');
  {
    // A light aeroplane and then the helicopter first: the helicopter's HUD keeps a copy of the
    // controls line and puts it back, and an airliner after it once read "Enter bail out · Enter
    // bail out · Enter evacuate" (eject/ui.js setKeyLine keeps only its own now).
    for (const id of ['skylark', 'harrier']) {
      await sim.startMode('free', { aircraft: id, airborne: true, taxi: false });
      run(0.5);
    }
    await sim.startMode('free', { aircraft: 'a320', airborne: true, taxi: false });
    run(4);
    const keyLine = ((document.querySelector('.hud-keyhint') || {}).textContent || '').replace(/\s+/g, ' ');
    r.ok('evac: the controls line says Enter evacuate, once, and nothing about bailing out (after a light aeroplane and the helicopter)',
      (keyLine.match(/evacuate/g) || []).length === 1 && !/bail out|parachute|eject\b/i.test(keyLine), keyLine);
    const ac = sim.aircraft;
    const calm = P.panel();
    const mood0 = P.comfort ? P.comfort.mood : 0;
    const o = { throttle: 0.75, pitch: 0, roll: 0, yaw: 0, brakes: 0 };
    sim.override = o;
    let bankMax = 0;
    let saw = '';
    run(12, () => {
      const bank = ac.bankAngleDeg();
      bankMax = Math.max(bankMax, Math.abs(bank));
      o.roll = Math.max(-1, Math.min(1, (62 - bank) / 15));
      o.pitch = Math.max(-1, Math.min(1, (6 - ac.pitchAngleDeg()) * 0.06 - ac.omega.x * 0.6));
      const p = P.panel();
      if (!saw && /bank/i.test(p.now)) saw = p.now;
      return false;
    });
    const hard = P.panel();
    const mood1 = P.comfort ? P.comfort.mood : 0;
    r.ok('comfort: the meter is on screen in an airliner, calm to start', calm.shown && Number(calm.score) >= 4.8 && !calm.now, JSON.stringify({ score: calm.score, mood: calm.mood, now: calm.now }));
    r.ok('comfort: a hard bank (60°) brings the meter down', bankMax > 50 && mood1 < mood0 - 0.5 && Number(hard.score) < Number(calm.score), `bank ${bankMax.toFixed(0)}°, mood ${mood0.toFixed(2)} → ${mood1.toFixed(2)}, ${calm.score} → ${hard.score}`);
    r.ok('comfort: …and says what is wrong: "Easy on the bank"', /easy on the bank/i.test(saw), saw);
    run(10, () => {
      const bank = ac.bankAngleDeg();
      o.roll = Math.max(-1, Math.min(1, (0 - bank) / 20));
      o.pitch = Math.max(-1, Math.min(1, (3 - ac.pitchAngleDeg()) * 0.06 - ac.omega.x * 0.6));
      return false;
    });
    sim.override = null;
    run(0.5);
    r.ok('comfort: wings level again, the complaint goes', !/bank/i.test(P.panel().now), P.panel().now);
    const pr = P.panel().rect;
    const left = document.querySelector('.hud-left');
    const lr = left ? left.getBoundingClientRect() : null;
    r.ok('comfort: the panel sits under the instruments, not over them', lr && pr.y >= lr.bottom - 1 && pr.h > 20, `${JSON.stringify(pr)} vs instruments to ${lr && lr.bottom.toFixed(0)}`);
    // Nor under anything else that lives just under the instruments: the smoke chip (T) sat on its stars.
    // The chip measures its place once a second, so give it that.
    run(1.2);
    const pe = document.querySelector('.px-panel');
    const pb = pe && pe.getBoundingClientRect();
    const over = [];
    for (const e of document.querySelectorAll('.fun-chip, .minimap, .hud-top, .hud-left')) {
      const b = e.getBoundingClientRect();
      if (!pb || !b.width || !b.height) continue;
      const w = Math.min(b.right, pb.right) - Math.max(b.left, pb.left);
      const h = Math.min(b.bottom, pb.bottom) - Math.max(b.top, pb.top);
      if (w > 2 && h > 2) over.push(`${e.className.split(' ')[0]} ${Math.round(w)}x${Math.round(h)}`);
    }
    const chip = document.querySelector('.fun-chip');
    r.ok('comfort: the panel shares its corner — the smoke chip sits under it, nothing on top of it', pb && pb.height > 20 && !over.length && chip && !chip.hidden,
      over.length ? over.join(', ') : `chip ${chip ? (chip.hidden ? 'hidden' : 'shown') : 'missing'}`);

    /* ---- the cabin view and the windows, same flight ---- */
    run(0.5);
    sim.rig.setMode('wing');
    const mode = sim.rig.cycle();
    run(0.5);
    const I = P.interior;
    const cam = sim.camera.position;
    const local = cam.clone().sub(sim.model.position).applyQuaternion(sim.model.quaternion.clone().invert());
    r.ok('cabin view: after Wing, C gives Cabin in an airliner', mode === 'cabin' && P.cabinOn, `${mode}`);
    r.ok('cabin view: the camera is inside the cabin, over rows of seated people', I && Math.abs(local.x) < PAX.cabin.halfW && local.y > PAX.cabin.floorY && local.y < PAX.cabin.ceilingY && I.seats.count > 100 && I.bodies.count > 100,
      `camera at ${local.toArray().map((v) => v.toFixed(1)).join(', ')}; ${I ? I.bodies.count : 0} seated`);
    const next = sim.rig.cycle();
    run(0.2);
    r.ok('cabin view: C again goes on to Tower', next === 'tower' && !P.cabinOn && I && !I.root.visible, next);
    sim.rig.setMode('chase');
    run(0.5);
    const F = P.faces;
    r.ok('windows: faces in the windows from outside, near it', F && F.count > 50 && F.shown > 20 && F.root.visible, `${F ? F.shown : 0}/${F ? F.count : 0}`);
    await sim.startMode('free', { aircraft: 'skylark', airborne: true, taxi: false });
    run(0.5);
    sim.rig.setMode('wing');
    const m2 = sim.rig.cycle();
    r.ok('cabin view: not in the Skylark (no passengers), and no meter', m2 === 'tower' && !P.state.active && !(P.panel() || {}).shown, m2);
    sim.rig.setMode('chase');
  }

  /* ================================================================ */
  say('passengers: the Island Hopper mission');
  try {
    await sim.startMode('mission', { id: 'pax-island-hopper' });
    run(0.6);
    const step = sim.runner && sim.runner.step;
    r.ok('mission: Island Hopper starts at a gate in the Meridian, boarding, on its board step', sim.aircraftType.id === 'meridian' && (PAX.stage === 'gate' || PAX.stage === 'boarding') && step && step.id === 'board',
      `${sim.aircraftType.id}, ${PAX.stage}, step ${step && step.id}`);
    P.press('skipBoarding');
    run(1.6);
    r.ok('mission: once the doors shut, it moves on to the take-off', sim.runner.step && sim.runner.step.id === 'depart', sim.runner.step && sim.runner.step.id);
    // The ditching keeps its ending: the rafts, not the parachutes.
    await sim.startMode('mission', { id: 'both-engines-out' });
    run(0.5);
    const E = await load('../../src/features/eject.js');
    const why = E.cannotEject ? E.cannotEject(sim) : 'no module';
    r.ok('ditching: Both Engines Out offers no evacuation', !!why && !/parachute needs/.test(why), String(why));
    sim.quitToMenu('main');
  } catch (e) {
    r.ok('mission: Island Hopper starts', false, String(e && e.message));
  }
  if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();

  /* ================================================================ */
  // The brief: "it must also work after an Air Force One flight or missions in the same session".
  // A mission that borrowed the passengers (or the exit rule) and did not give them back shows here.
  say('passengers: the evacuation after a passenger mission');
  {
    const ev = await evacuate('a320 after Island Hopper');
    const who = ((E.lastEvac && E.lastEvac.order) || []).map((o) => o.who);
    r.ok('evac: after a passenger mission in the same session it still works — passengers, then crew, then you',
      ev.armed && ev.started && ev.t.lastPax !== null && ev.t.lastPax <= ev.t.firstCrew && ev.t.pilot > ev.t.lastCrew && E.phase === 'out' &&
        who.length === ev.booked + ev.crew + 1 && who[who.length - 1] === 'pilot' && sim.mode === 'free',
      `${ev.booked} pax, ${ev.crew} crew, ${JSON.stringify(ev.t)}, mode ${sim.mode}`);
  }
  if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
  sim.autoPauseOnHide = origAuto;
  return r;
}

/**
 * Browser checks for the events team: the flight events (the pizza car and
 * both hijacks) and the goofy and events missions, run on the real game.
 *
 *   const { check } = await import('./tests/features/events.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d: String(d || '') }); return !!p; } };
 *   await check(window.__sim, r, console.log);
 *
 * What it proves, in order:
 *   - both extensions are registered and still live after everything below;
 *   - the pizza car runs from the fence to "runway clear" with the aeroplane
 *     held, the tower's own clearances suppressed and then given back;
 *   - the film hijack runs from the man in the cockpit to the happy ending:
 *     7 squawks in secret, two fighters tuck in LOW BEHIND the tail, peel
 *     off on final, the police rush the aeroplane, the stairs drive up to
 *     the door, the camera shows it, he is walked out, the car leaves, and
 *     nothing is left behind;
 *   - the by-the-book hijack, answered on the card with the keys a player
 *     would press: the door kept locked (8), 7500 (7), silence when ATC
 *     verifies (8), two mic clicks (8), his heading, the lead fighter in the
 *     ICAO intercept position (ahead, LEFT, above) rocking its wings, our
 *     wings rocked back on the real flight model, three rounds on the
 *     interphone, the break-away, the remote runway, engines off (I), the
 *     tactical team in vans, and a by-the-book ending;
 *   - 7, 8, 9 and 0 are only taken while a story (or a question) wants them;
 *   - every goofy and events mission starts, walks through every step without
 *     throwing, and takes its props away with it;
 *   - and each goofy mission's own checks can actually be satisfied — by
 *     putting the aeroplane where the check says and letting the real
 *     update loop decide, not by calling the check.
 *
 * It flies with sim.step(), so it is quick with the renderer stubbed (see the
 * note at the top of tests/selftest.js).
 */

export async function check(sim, r, say = () => {}) {
  const FE0 = await import('../../src/features/flight-events.js');
  // The dice stay out of it: every event below is started on purpose, and a
  // random one arming itself halfway through would make the run depend on luck.
  const odds = { ...FE0.ODDS };
  FE0.ODDS.hijack = 0;
  FE0.ODDS.breakin = 0;
  try {
    await checks(sim, r, say);
  } finally {
    FE0.ODDS.hijack = odds.hijack;
    FE0.ODDS.breakin = odds.breakin;
    sim.override = null;
    for (const k of ['Space', 'Digit7', 'Digit8']) sim.key(k, false);
  }
}

async function checks(sim, r, say) {
  const THREE = await import('../../src/vendor/three.module.js');
  const FE = await import('../../src/features/flight-events.js');
  const UI = await import('../../src/features/events/ui.js');
  const { extStatus } = await import('../../src/game/extensions.js');
  const { MISSIONS } = await import('../../src/game/missions.js');
  const { RUNWAY } = await import('../../src/world/airport.js');
  const { DELIVERY_PAD } = await import('../../src/world/scenery.js');
  const { heightAt } = await import('../../src/world/terrain.js');

  const live = () => ['flightevents', 'goofyprops'].every((id) => {
    const e = extStatus().find((x) => x.id === id);
    return e && e.live;
  });
  const ac = sim.aircraft;
  const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  /** Step in half-second chunks until `until()` or the time runs out. */
  const run = (secs, until) => {
    for (let t = 0; t < secs; t += 0.5) {
      sim.step(0.5, 1 / 30);
      if (until && until()) return true;
    }
    return !!(until && until());
  };
  const stopHere = (x, z, heading = 90) => {
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 0, engineOn: true });
    sim.input.throttleTarget = 0;
    if (sim.input.out) sim.input.out.throttle = 0;
    ac.controls.throttle = 0;
  };
  const flyAt = (x, y, z, heading = 90, speed = 60, gearDown = true) => {
    ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed, altAGL: y - heightAt(x, z), engineOn: true, gearDown });
    ac.controls.throttle = 0.7;
    sim.input.throttleTarget = 0.7;
  };
  const free = (aircraft, airborne) => sim.startMode('free', { ...sim.weather.serialize(), aircraft, airborne });
  const propsLeft = () => sim.scene.children.filter((o) => o.name && o.name.startsWith('goofy:')).length;
  const status = () => sim.runner.status;
  // What the objective panel says, title and text together.
  const objective = () => `${sim.hud.objectiveTitle.textContent} — ${sim.hud.objectiveText.textContent}`;

  r.ok('events: flight-events and goofy-props extensions are registered and live', live(), JSON.stringify(extStatus()));

  /* ------------------------------------------------------------ data -- */
  const goofy = MISSIONS.filter((m) => m.category === 'goofy');
  const events = MISSIONS.filter((m) => m.category === 'events');
  r.ok('events: 10 to 12 goofy missions are in the mission list', goofy.length >= 10 && goofy.length <= 12, goofy.length);
  r.ok('events: both event missions are in the mission list', events.some((m) => m.id === 'event-hijack') && events.some((m) => m.id === 'event-breakin'), events.map((m) => m.id).join());

  /* ------------------------------------- the realistic one's card -- */
  {
    // "The more realistic one is behind a code": without the Dev passcode the
    // card is on the board LOCKED — greyed, its button off, a line saying
    // where the code goes — and with it, open, live, without a reload. It
    // was hidden once; the menus' own heading check counts it as a card the
    // board must show, and the game switcher un-hid it after flight -> car ->
    // flight, so hidden was neither honest nor reliable.
    const menus = sim.menus;
    const screen = menus && menus.screens && menus.screens.missions;
    const card = screen && screen.querySelector('[data-mission="event-hijack-real"]');
    const prog = sim.prog;
    if (card && prog && typeof menus.syncMissionLocks === 'function') {
      const was = !!prog.devUnlocked;
      const btn = card.querySelector('[data-start]');
      const why = () => card.querySelector('[data-dev-why]');
      const locked = () => !card.hidden && card.classList.contains('is-unavailable') && !!btn && btn.disabled
        && !!why() && !why().hidden && /Dev passcode/.test(why().textContent);
      try {
        prog.devUnlocked = false;
        menus.syncMissionLocks();
        const lockedAtFirst = locked();
        // Through the game switcher and back: still there, still locked.
        let switched = 'no game switcher';
        if (typeof menus.setGame === 'function') {
          const g0 = menus.currentGame || 'flight';
          menus.setGame('car');
          menus.setGame('flight');
          switched = locked() ? 'locked' : `hidden ${card.hidden}, disabled ${btn && btn.disabled}`;
          menus.setGame(g0);
        }
        // A tap with the button forced back on still starts nothing.
        const mode0 = sim.mode;
        const state0 = sim.state;
        btn.disabled = false;
        btn.click();
        await new Promise((res) => setTimeout(res, 300));
        const started = sim.mode !== mode0 || sim.state !== state0;
        const relocked = locked();
        prog.devUnlocked = true;
        menus.syncMissionLocks();
        const open = !card.classList.contains('is-unavailable') && !btn.disabled && (!why() || why().hidden);
        r.ok('events: without the Dev passcode the by-the-book card shows LOCKED, with where the code goes',
          lockedAtFirst, `hidden ${card.hidden}, class ${card.className}, why "${why() ? why().textContent : ''}"`);
        r.ok('events: ...still on the board and locked after switching to the car and back', switched === 'locked' || switched === 'no game switcher', switched);
        r.ok('events: ...and a tap on it, even with the button forced on, starts nothing', !started && relocked, `started ${started}, relocked ${relocked}`);
        r.ok('events: ...and it opens as soon as the passcode is in, no reload', open, `class ${card.className}, disabled ${btn.disabled}`);
      } finally {
        prog.devUnlocked = was;
        menus.syncMissionLocks();
      }
    } else {
      r.ok('events: the by-the-book mission has a card on the Missions screen', false, `screen ${!!screen} card ${!!card} prog ${!!prog}`);
    }
  }

  /* ------------------------------------------------------- dev panel -- */
  const { extDevActions } = await import('../../src/game/extensions.js');
  const labels = extDevActions().map((a) => a.label);
  r.ok('events: Dev panel offers "Trigger hijack event" and "Trigger airport break-in"',
    labels.includes('Trigger hijack event') && labels.includes('Trigger airport break-in'), labels.join(' | '));

  /* ----------------------------------------------- pizza car, ground -- */
  say('events: pizza car, on the ground');
  await free('skylark', false);
  const held = ac.pos.clone();
  FE.forceBreakIn(sim, { owner: 'test' });
  sim.step(1, 1 / 30);
  let b = FE.breakInInfo();
  r.ok('break-in: the car and two police cars appear', b.phase === 'run' && b.car && b.police === 2, JSON.stringify({ phase: b.phase, car: b.car, police: b.police }));
  r.ok('break-in: the tower holds you, on screen', /hold position/i.test(objective()) && UI.uiState().card, objective());
  run(20);
  r.ok('break-in: the tower’s own take-off clearance is held back while the car is out', !!(sim.atc.said && sim.atc.said.clearance));
  const doneIn = (() => {
    let t = 20;
    while (t < 140) {
      sim.step(1, 1 / 30);
      t++;
      if (FE.breakInInfo().done) return t;
    }
    return null;
  })();
  b = FE.breakInInfo();
  r.ok('break-in: runs to "runway clear" in a little over a minute', doneIn != null && doneIn < 100, `done after ${doneIn} s`);
  r.ok('break-in: the aeroplane was held where it stopped', flat(ac.pos, held) < 30, `${flat(ac.pos, held).toFixed(1)} m`);
  r.ok('break-in: the tower’s clearances are given back afterwards', !sim.atc.said.clearance && !sim.atc.said.final);
  r.ok('break-in: the objective goes back to free flight', /free flight/i.test(objective()), objective());
  r.ok('break-in: the feature is still live', live());

  /* --------------------------------------------- pizza car, approach -- */
  say('events: pizza car, on the way in');
  await free('skylark', true);
  flyAt(-4000, 300, 0, 90, 60);
  FE.forceBreakIn(sim, { owner: 'test' });
  sim.step(1, 1 / 30);
  r.ok('break-in: airborne, the tower sends you round instead', /runway closed/i.test(objective()) && /climb away/i.test(objective()), objective());

  /* ------------------------------ pizza car, in somebody's mission -- */
  /*
   * The window a reviewer caught: the car at the start of Island Circuit
   * wrote "Hold position" over step 1 and never gave it back — 76 s after the
   * all-clear the panel still said keep still, and "press Shift" was gone.
   * Armed here the way the dice arm it, in the real mission on the real HUD.
   */
  say('events: pizza car, at the start of a mission');
  {
    await sim.startMode('mission', { id: 'circuit' });
    sim.step(0.3, 1 / 30);
    const before = objective();
    const step0 = sim.runner.stepIndex;
    const armed = FE.armBreakIn(sim, 'mission');
    const came = run(12, () => FE.breakInInfo().phase === 'run');
    const held = objective();
    const t0 = sim.runner.elapsed;
    const cleared = run(150, () => FE.breakInInfo().done);
    const after = objective();
    const t1 = sim.runner.elapsed;
    r.ok('break-in in a mission: at the start of Island Circuit the car comes, and the panel says hold',
      armed && came && /^Hold position/.test(held), `armed ${armed}, came ${came}: ${held}`);
    r.ok('break-in in a mission: after the all-clear the mission\'s step is back on the panel, word for word',
      cleared && after === before, `before "${before}" / after "${after}"`);
    r.ok('break-in in a mission: the hold costs no mission time (the time bonus)', cleared && t1 - t0 < 2, `${(t1 - t0).toFixed(1)} s counted`);
    r.ok('break-in in a mission: the mission is still running, on its first step', status() === 'running' && sim.runner.stepIndex === step0,
      `${status()} step ${sim.runner.stepIndex}`);
    sim.quitToMenu('missions');
  }

  /* --------------------------------------------------- the 7 key -- */
  const pressKey = (code) => {
    const ev = new KeyboardEvent('keydown', { code, cancelable: true, bubbles: true });
    window.dispatchEvent(ev);
    window.dispatchEvent(new KeyboardEvent('keyup', { code, cancelable: true, bubbles: true }));
    return ev.defaultPrevented;
  };
  const press7 = () => pressKey('Digit7');
  await free('skylark', true);
  r.ok('hijack: 7 is left alone when there is no story on', press7() === false);
  r.ok('hijack: so are 8, 9 and 0 when there is no question', pressKey('Digit8') === false && pressKey('Digit0') === false);

  const { VOICES } = await import('../../src/audio/atc.js');
  r.ok('hijack: the fighters and the captain have voices of their own on the radio',
    !!(VOICES['Guardian flight'] && VOICES['Captain (you)']), Object.keys(VOICES).join(','));

  const escortsInScene = () => sim.scene.children.filter((o) => o.name && o.name.startsWith('escort-'));
  const fwdOf = () => ac.forward(new THREE.Vector3()).setY(0).normalize();
  const leftOf = () => {
    const f = fwdOf();
    return new THREE.Vector3(f.z, 0, -f.x);
  };
  const h = () => FE.hijackInfo();
  const lh = FE.longHaulId();

  /* ------------------------------------------- the hijack, film version -- */
  say('events: hijack, the film version');
  await free(lh, true);
  flyAt(-16000, 1500, 5000, 90, 90);
  FE.forceHijack(sim, { owner: 'test', version: 'film' });
  sim.step(2, 1 / 30);
  r.ok('film: he bursts in — a red card with a secret squawk button', h().phase === 'burst' && UI.uiState().tone === 'is-bad' && /squawk/i.test(UI.uiState().button || ''), JSON.stringify(UI.uiState()));
  r.ok('film: the tower is kept from clearing you anywhere else', !!sim.atc.said.final);
  r.ok('film: 7 is taken while the story is on, and squawks 7500', press7() === true && h().squawked);
  r.ok('film: the transponder on the card reads 7500', UI.uiState().code === '7500', UI.uiState().code);
  run(20);
  r.ok('film: he orders you to the island, and an arrow says which way', /Do what he says/.test(objective()) && UI.uiState().guide, `${objective()} | guide ${UI.uiState().guideLabel}`);
  const shadowed = run(90, () => h().escortFormed);
  r.ok('film: two fighters tuck in behind', shadowed && h().escorts === 2, JSON.stringify({ escorts: h().escorts }));
  {
    const f = fwdOf();
    const rel = escortsInScene().map((e) => {
      const d = new THREE.Vector3().subVectors(e.position, ac.pos);
      return { behind: d.dot(f), below: d.y, dist: d.length() };
    });
    r.ok('film: ...low behind the tail, where nobody on the flight deck can see them',
      rel.length === 2 && rel.every((x) => x.behind < -150 && x.behind > -600 && x.below < 5),
      rel.map((x) => `${x.behind.toFixed(0)}/${x.below.toFixed(0)}`).join(' '));
  }
  {
    // Which way is DOWN: 10 km from the approach gate at 1,500 m is 500 m
    // above a three-degree slope to it, and the story has to say so.
    const high = h().wantAlt != null ? ac.pos.y - h().wantAlt : null;
    run(1);
    r.ok('film: too high for the runway, the arrow says how far down', high > 200 && /down [\d,]+ ft/.test(UI.uiState().guideSub),
      `${high && high.toFixed(0)} m high | ${UI.uiState().guideSub}`);
  }
  // Five and a half kilometres out and low: inside where the jets leave you.
  flyAt(RUNWAY.touchdown.x - 5500, RUNWAY.elev + 300, RUNWAY.touchdown.z, 90, 70);
  run(2);
  r.ok('film: close in, it is "land it", and the jets peel away', h().phase === 'approach' && h().escortBroke, `${h().phase} broke ${h().escortBroke}`);
  // Down on the runway and still rolling at 25 m/s, brakes on.
  ac.reset({ pos: new THREE.Vector3(RUNWAY.touchdown.x + 150, 0, RUNWAY.touchdown.z), headingDeg: RUNWAY.headingDeg ?? 90, speed: 25, engineOn: true });
  sim.input.throttleTarget = 0;
  ac.controls.throttle = 0;
  sim.runner.data.lastTouchdown = { crashed: false, onRunway: true, score: 80 };
  // What a real landing leaves behind; the story waits for one.
  ac.lastTouchdown = sim.runner.data.lastTouchdown;
  sim.key('Space', true);
  const toTaxi = run(4, () => h().phase === 'taxi');
  const rolling = ac.groundSpeed;
  r.ok('film: down, he wants the terminal — but no stand is picked while you are still rolling fast', toTaxi && rolling >= 10 && !h().stand,
    `${h().phase} at ${rolling.toFixed(1)} m/s, stand ${!!h().stand}`);
  const picked = run(30, () => !!h().stand);
  {
    // Picked at walking pace, beside or ahead of where it stops — not behind
    // it (at 30 m/s a jumbo rolls on 300 m, and it used to be picked then).
    const s = h().stand;
    const ahead = s ? new THREE.Vector3().subVectors(s, ac.pos).dot(fwdOf()) : null;
    r.ok('film: slowed down, a column of light marks the stand — beside you or ahead, not behind',
      picked && ac.groundSpeed < 10 && ahead > -60 && !!sim.scene.getObjectByName('taxi-pillar') && sim.scene.getObjectByName('taxi-pillar').visible,
      `${ac.groundSpeed.toFixed(1)} m/s, ${ahead && ahead.toFixed(0)} m ahead`);
  }
  const rush = run(25, () => h().phase === 'rush');
  r.ok('film: stop anywhere and the police rush the aeroplane', rush && h().police === 4 && h().stairs && h().comeToYou, JSON.stringify({ phase: h().phase, police: h().police }));
  const board = run(45, () => h().phase === 'board');
  r.ok('film: the stairs drive up to the door and the police go up', board, h().phase);
  {
    // The police get the camera for this: a picture of the door and the stairs.
    sim.step(0.5, 1 / 30);
    const st = sim.scene.getObjectByName('police-stairs');
    const camNear = st && sim.camera.position.distanceTo(st.position) < 120;
    const people = sim.scene.children.filter((o) => o.name && o.name.startsWith('person-')).length;
    r.ok('film: the camera shows the stairs, with the officers on them', camNear && people >= 7, `camera ${st ? sim.camera.position.distanceTo(st.position).toFixed(0) : '-'} m, ${people} people`);
  }
  const filmDone = run(90, () => h().done);
  sim.key('Space', false);
  r.ok('film: he is walked out in handcuffs and it ends happily', filmDone && h().score >= 50 && /Hero/i.test(UI.uiState().who), JSON.stringify({ phase: h().phase, score: h().score, who: UI.uiState().who }));
  r.ok('film: the ending says what you did — the hidden jets, and stopping for the police', /two fighters hiding/.test(UI.uiState().text) && /let the police come to you/.test(UI.uiState().text), UI.uiState().text.slice(0, 200));
  r.ok('film: the tower is given its clearances back', !sim.atc.said.final);
  r.ok('film: a test run pays nothing', h().paid === 0);
  const home = run(90, () => h().police === 0 && !h().stairs);
  r.ok('film: afterwards the police cars and the stairs drive off and are gone', home && h().leaving
    && !sim.scene.getObjectByName('police-car') && !sim.scene.getObjectByName('police-stairs'), JSON.stringify({ police: h().police, stairs: h().stairs }));
  // The on-screen button does the same as the key.
  flyAt(-16000, 1500, 0, 90, 90);
  FE.forceHijack(sim, { owner: 'test', version: 'film' });
  sim.step(0.5, 1 / 30);
  UI.pressButton();
  r.ok('film: the on-screen Squawk button works too', h().squawked);
  // Put back on the runway by something else (no touchdown): not "landed".
  stopHere(RUNWAY.touchdown.x - 150, RUNWAY.touchdown.z);
  run(3);
  r.ok('film: an aeroplane put on the ground without landing has not landed — the story waits', !h().landed && h().phase === 'orders', h().phase);
  r.ok('film: the feature is still live', live());
  sim.quitToMenu('main');
  const leftovers = () => sim.scene.children.filter((o) => o.name && (o.name === 'police-car' || o.name === 'police-van' || o.name === 'police-stairs'
    || o.name === 'pizza-car' || o.name.startsWith('escort-') || o.name.startsWith('person-'))).length;
  r.ok('film: going back to the menu clears it all away', h().phase === 'idle' && FE.breakInInfo().phase === 'idle' && leftovers() === 0, leftovers());

  /* -------------------------------------- the hijack, by the book -- */
  say('events: hijack, by the book');
  await free(lh, true);
  flyAt(-9000, 1500, -12000, 100, 90);
  FE.forceHijack(sim, { owner: 'test', version: 'real' });
  sim.step(2, 1 / 30);
  r.ok('real: somebody at the door — two answers on the card', h().phase === 'door' && UI.uiState().choices.length === 2 && /LOCKED/.test(UI.uiState().choices[0]), JSON.stringify(UI.uiState().choices));
  r.ok('real: 8 answers it — keep the door locked', pressKey('Digit8') === true && /LOCKED/.test(UI.uiState().who), UI.uiState().who);
  run(7);
  r.ok('real: then the squawk', h().phase === 'squawk' && /squawk/i.test(UI.uiState().button || ''), h().phase);
  press7();
  r.ok('real: 7 squawks, and ATC checks it', h().squawked && h().phase === 'verify', h().phase);
  const verifyQ = run(8, () => UI.uiState().choices.length === 3);
  r.ok('real: "verify squawking 7500" — say nothing, say affirmative, or set it back', verifyQ, JSON.stringify(UI.uiState().choices));
  r.ok('real: 8 says nothing', pressKey('Digit8') === true && /Silence/.test(UI.uiState().who), UI.uiState().who);
  const clickQ = run(15, () => UI.uiState().choices.length === 2);
  r.ok('real: "click your microphone twice"', clickQ && /Click twice/.test(UI.uiState().choices[0]), JSON.stringify(UI.uiState().choices));
  pressKey('Digit8');
  const orders = run(10, () => h().phase === 'orders');
  r.ok('real: his orders come over the interphone, with a heading', orders && /heading \d{3}/.test(objective()), objective());
  r.ok('real: two fighters are on their way', h().escorts === 2, h().escorts);
  const hdg = Number((objective().match(/heading (\d{3})/) || [])[1]);
  flyAt(ac.pos.x, ac.pos.y, ac.pos.z, hdg, 90, false);
  const radioQ = run(12, () => UI.uiState().choices.length === 3);
  r.ok('real: "tell them everything is normal" — the secret phrase is on the card', radioQ && /coffee is cold/.test(UI.uiState().text), UI.uiState().text.slice(0, 90));
  r.ok('real: 8 says it in code', pressKey('Digit8') === true && h().radioDone && h().radio === 0);
  const icpt = run(16, () => h().phase === 'intercept');
  r.ok('real: flying his heading, with the call made, the fighters intercept', icpt, h().phase);
  const inPos = run(80, () => h().lead && h().escortFormed);
  run(2);
  {
    const lead = h().lead;
    const d = lead ? new THREE.Vector3().subVectors(lead, ac.pos) : null;
    r.ok('real: the lead is ahead, to the LEFT and above — the ICAO intercept position',
      inPos && d && d.dot(fwdOf()) > 50 && d.dot(leftOf()) > 20 && d.y > 0,
      d ? `ahead ${d.dot(fwdOf()).toFixed(0)}, left ${d.dot(leftOf()).toFixed(0)}, up ${d.y.toFixed(0)}` : 'no lead');
  }
  r.ok('real: it rocks its wings — the card says what that means', /FOLLOW ME/.test(UI.uiState().text), UI.uiState().text.slice(0, 80));
  // Rock ours: stick left, then right, on the real flight model.
  sim.override = { roll: -1, pitch: 0.15 };
  run(2.5, () => ac.bankAngleDeg() < -14);
  sim.override = { roll: 1, pitch: 0.15 };
  run(4, () => h().acked);
  sim.override = null;
  r.ok('real: rocking our wings answers it, and we follow', h().acked && h().phase === 'follow', `${h().phase} bank ${ac.bankAngleDeg().toFixed(0)}`);
  flyAt(ac.pos.x, ac.pos.y, ac.pos.z, ac.heading, 90, false);
  {
    // The leader leads the way DOWN as well as round: above the slope to
    // the runway, it flies below you (never more than 60 m), not level.
    run(8);
    const want = h().wantAlt;
    const lead = h().lead;
    const below = lead ? ac.pos.y - lead.y : null;
    r.ok('real: high on the way in, the lead jet flies the slope below you — follow it down',
      want != null && ac.pos.y - want > 100 && below > 40 && below < 75,
      `slope ${want && want.toFixed(0)} m, you ${ac.pos.y.toFixed(0)} m, lead ${below && below.toFixed(0)} m below`);
  }
  for (let i = 0; i < 3; i++) {
    const asked = run(16, () => UI.uiState().choices.length === 3);
    r.ok(`real: he talks on the interphone — round ${i + 1}, three answers`, asked && UI.uiState().meter && UI.uiState().meterLabel === 'His mood', JSON.stringify(UI.uiState().choices).slice(0, 120));
    pressKey('Digit8');
  }
  run(13);
  r.ok('real: calm, true answers talk him down', h().talked && h().tension < 0.2, h().tension.toFixed(2));
  {
    const T0 = h().remote.clone();
    const L = h().landHdg;
    const back = new THREE.Vector3(Math.sin((L * Math.PI) / 180), 0, -Math.cos((L * Math.PI) / 180));
    flyAt(T0.x - back.x * 5200, T0.y + 300, T0.z - back.z * 5200, L, 70, false);
    run(1);
    r.ok('real: lined up, the lead puts its wheels down — "land at this aerodrome"',
      h().landSignal && h().leadGear && !h().released && /LAND AT THIS AERODROME/.test(UI.uiState().text), UI.uiState().text.slice(0, 90));
    sim.tap('KeyG');
    const rel = run(6, () => h().released);
    r.ok('real: G answers it — "understood, will comply"', h().gearAck && ac.gearDown);
    r.ok('real: then the jets break away — "you may proceed"', rel && h().phase === 'final' && /MAY PROCEED/.test(UI.uiState().text), h().phase);
    // The aeroplane was moved here; the jets were not. So judge the jets by
    // themselves: three seconds on, each is climbing hard and has turned.
    const e0 = escortsInScene().map((e) => ({ p: e.position.clone(), f: new THREE.Vector3(0, 0, -1).applyQuaternion(e.quaternion) }));
    run(3);
    const e1 = escortsInScene().map((e) => ({ p: e.position.clone(), f: new THREE.Vector3(0, 0, -1).applyQuaternion(e.quaternion) }));
    const climb = e1.map((x, i) => x.p.y - e0[i].p.y);
    const turn = e1.map((x, i) => (Math.acos(Math.max(-1, Math.min(1, x.f.clone().setY(0).normalize().dot(e0[i].f.clone().setY(0).normalize())))) * 180) / Math.PI);
    r.ok('real: ...climbing and turning hard away', e1.length === 2 && climb.every((c) => c > 60) && turn.every((t) => t > 30),
      `climb ${climb.map((c) => c.toFixed(0))} m, turned ${turn.map((t) => t.toFixed(0))} deg`);
    stopHere(T0.x + back.x * 450, T0.z + back.z * 450, L);
    sim.runner.data.lastTouchdown = { crashed: false, onRunway: true, score: 80 };
    // What a real landing leaves behind; the story waits for one.
    ac.lastTouchdown = sim.runner.data.lastTouchdown;
    sim.key('Space', true);
    run(2.5);
    r.ok('real: down — stop and shut down', ['stop', 'rush'].includes(h().phase), h().phase);
    sim.tap('KeyI');
    const tac = run(10, () => h().phase === 'rush');
    r.ok('real: stopped on the remote runway, the tactical team comes', tac && h().onRemote && h().police === 4, JSON.stringify({ phase: h().phase, onRemote: h().onRemote }));
    r.ok('real: two of them in vans', sim.scene.children.filter((o) => o.name === 'police-van').length === 2);
  }
  const realDone = run(140, () => h().done);
  sim.key('Space', false);
  r.ok('real: they board, and it ends happily — by the book', realDone && h().score >= 80 && /By the book/i.test(UI.uiState().who), JSON.stringify({ phase: h().phase, score: h().score, stars: h().stars }));
  r.ok('real: the ending lists what you did right', h().stars >= 8 && /✓/.test(UI.uiState().text), h().stars);
  r.ok('real: ...and says it: the door, the silent 7500, the fighters', /door locked/.test(UI.uiState().text) && /without saying a word/.test(UI.uiState().text) && /followed the fighters/.test(UI.uiState().text), UI.uiState().text.slice(0, 200));
  r.ok('real: the feature is still live', live());
  sim.quitToMenu('main');
  r.ok('real: going back to the menu clears it all away', h().phase === 'idle' && leftovers() === 0 && !UI.uiState().card, leftovers());
  /* ------------------------------------ every mission, every step -- */
  for (const m of [...goofy, ...events]) {
    say(`events: mission ${m.id}`);
    let threw = null;
    // The realistic one gates itself on the Dev passcode; walk it with the code in.
    const devWas = !!(sim.prog && sim.prog.devUnlocked);
    if (m.devOnly && sim.prog) sim.prog.devUnlocked = true;
    try {
      await sim.startMode('mission', { id: m.id });
      sim.step(0.5, 1 / 30);
      const started = status() === 'running' && sim.runner.def.id === m.id && (m.category !== 'goofy' || propsLeft() >= 1 || m.id === 'goofy-icecream');
      for (let i = 0; i < m.steps.length && status() === 'running'; i++) {
        sim.runner.skipStep();
        sim.step(0.4, 1 / 30);
      }
      r.ok(`mission ${m.id}: starts and runs every step without throwing`, started && live(), `status ${status()}`);
    } catch (e) {
      threw = e;
    }
    if (threw) r.ok(`mission ${m.id}: starts and runs every step without throwing`, false, String(threw && threw.message));
    if (sim.prog) sim.prog.devUnlocked = devWas;
    sim.quitToMenu('missions');
    r.ok(`mission ${m.id}: takes its props away afterwards`, propsLeft() === 0, propsLeft());
  }

  /* ------------------------------------- can each one be finished? -- */
  const begin = async (id) => {
    await sim.startMode('mission', { id });
    sim.step(0.3, 1 / 30);
    return sim.runner.data;
  };
  const stepId = () => (sim.runner.step ? sim.runner.step.id : null);
  const toStep = (id) => {
    for (let i = 0; i < 10 && stepId() !== id && status() === 'running'; i++) {
      sim.runner.skipStep();
      sim.step(0.1, 1 / 30);
    }
    return stepId() === id;
  };
  const finished = (secs, before) => run(secs, () => {
    if (before) before();
    return status() === 'complete';
  });
  const land = (x, z, heading = 90) => {
    stopHere(x, z, heading);
    // A real touchdown sets this; a teleport does not.
    sim.runner.data.lastTouchdown = { crashed: false, onRunway: true, score: 80, vsFpm: -200, quality: 'good' };
    // What a real landing leaves behind; the story waits for one.
    ac.lastTouchdown = sim.runner.data.lastTouchdown;
    sim.key('Space', true);
  };

  // Rubber Duck: drop it on the lighthouse.
  {
    say('events: can the duck be delivered');
    await begin('goofy-duck');
    toStep('drop');
    const x = -3100 - 60;
    flyAt(x, heightAt(-3100, -3600) + 90, -3600, 90, 40);
    sim.dropCargo();
    const ok = run(40, () => stepId() === 'home');
    r.ok('goofy-duck: a drop on the lighthouse counts', ok, `step ${stepId()}`);
    land(-300, 0);
    r.ok('goofy-duck: and landing finishes it', finished(6));
    sim.key('Space', false);
    sim.step(0.5, 1 / 30);
    sim.quitToMenu('missions');
  }

  // Balloon: catch it, then take it to the party.
  {
    await begin('goofy-balloon');
    toStep('catch');
    const bal = sim.runner.data.balloon.position;
    flyAt(bal.x - 20, bal.y, bal.z, 90, 45);
    sim.step(0.3, 1 / 30);
    r.ok('goofy-balloon: flying up to it hooks it', stepId() === 'tow' && sim.runner.data.caught, stepId());
    const p = sim.runner.data.party;
    flyAt(p.x - 150, p.y + 150, p.z, 90, 50);
    sim.step(1, 1 / 30);
    r.ok('goofy-balloon: it has to actually be towed, not just caught over the cake', stepId() === 'tow', stepId());
    run(8);
    flyAt(p.x - 150, p.y + 150, p.z, 90, 50);
    r.ok('goofy-balloon: a low pass over the party finishes it', finished(3));
    sim.quitToMenu('missions');
  }

  // Hello, Tower: upside down past it.
  {
    await begin('goofy-tower');
    toStep('flip');
    flyAt(-300, 14 + 220, -206, 90, 140);
    // Roll it over, then let the real update decide.
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
    ac.quat.multiply(q);
    sim.step(0.1, 1 / 30);
    r.ok('goofy-tower: upside down within 650 m of the tower counts', stepId() === 'marks', stepId());
    flyAt(-400, 14 + 200, -206, 90, 140);
    r.ok('goofy-tower: then a pass the right way up finishes it', finished(10));
    sim.quitToMenu('missions');
  }

  // Seagulls: fly the course faster than they do; and lose if you do not.
  {
    await begin('goofy-gulls');
    const cps = [[-600, -2400], [2400, -3200], [5900, -5000]];
    for (const [x, z] of cps) {
      flyAt(x - 100, 300, z, 90, 60);
      sim.step(0.3, 1 / 30);
    }
    r.ok('goofy-gulls: reaching the finish first wins', status() === 'complete', status());
    sim.quitToMenu('missions');
    await begin('goofy-gulls');
    sim.runner.data.gs = 1e9;
    sim.step(0.2, 1 / 30);
    r.ok('goofy-gulls: and the gulls getting there first loses', status() === 'failed', status());
    sim.quitToMenu('missions');
  }

  // Moo-ving Day: onto the deck.
  {
    await begin('goofy-cow');
    toStep('land');
    const c = sim.carrier;
    r.ok('goofy-cow: there is a carrier to land on', !!c);
    if (c) {
      stopHere(c.pos.x, c.pos.z - c.halfDepth * 0.3, 180);
      sim.key('Space', true);
      r.ok('goofy-cow: stopping on the deck finishes it', finished(6));
      sim.key('Space', false);
    sim.step(0.5, 1 / 30);
    }
    sim.quitToMenu('missions');
  }

  // UFO: three sightings, then the beach.
  {
    await begin('goofy-ufo');
    toStep('spot1');
    for (const id of ['spot1', 'spot2', 'spot3']) {
      run(4, () => !sim.runner.data.zip);
      const u = sim.runner.data.ufo.position;
      flyAt(u.x - 200, u.y, u.z, 90, 55);
      sim.step(0.3, 1 / 30);
      r.ok(`goofy-ufo: getting close at ${id} moves it on`, stepId() !== id, stepId());
    }
    run(4);
    flyAt(-200, heightAt(0, 2200) + 150, 2200, 90, 55);
    r.ok('goofy-ufo: leading it over the beach finishes it', finished(3));
    sim.quitToMenu('missions');
  }

  // S'mores: the warm band toasts, too close burns, the other way round does side two.
  {
    await begin('goofy-smores');
    toStep('toastA');
    const C = { x: 2500, z: -2400 };
    flyAt(C.x + 1500, 750, C.z, 0, 60); // heading north, tangent to the ring
    run(6);
    const a1 = sim.runner.data.a;
    r.ok('goofy-smores: flying round in the warm band toasts the marshmallow', a1 > 0.1, a1.toFixed(2));
    flyAt(C.x + 1000, 700, C.z, 0, 60);
    run(2.5);
    r.ok('goofy-smores: too close and it catches fire (and you get a fresh one)', sim.runner.data.burns >= 1, sim.runner.data.burns);
    sim.runner.data.a = 0.999;
    flyAt(C.x + 1500, 750, C.z, 0, 60);
    run(2, () => stepId() === 'toastB');
    r.ok('goofy-smores: a golden side 1 moves on to side 2', stepId() === 'toastB', stepId());
    flyAt(C.x + 1500, 750, C.z, 0, 60); // same way round: must not count
    run(3);
    const bSame = sim.runner.data.b;
    flyAt(C.x + 1500, 750, C.z, 180, 60); // the other way round
    run(6);
    r.ok('goofy-smores: side 2 only toasts going the other way round', bSame < 0.02 && sim.runner.data.b > 0.1, `${bSame.toFixed(2)} then ${sim.runner.data.b.toFixed(2)}`);
    /*
     * The mission holds Ember's eruption clock at zero by writing main.js's
     * private sim._eruptT (goofy.js, holdEruption). If main.js ever renames
     * it, the hold would go quiet and the volcano would erupt mid-s'more; this
     * turns that red instead: main.js's updateVolcano must still count on the
     * field, and the mission must still be holding it.
     */
    {
      const hasIt = typeof sim.updateVolcano === 'function';
      sim._eruptT = 5;
      if (hasIt) sim.updateVolcano(0.5);
      const counted = sim._eruptT;
      run(0.5);
      r.ok('goofy-smores: main.js still keeps the eruption clock in sim._eruptT, and the mission holds it at zero',
        hasIt && Math.abs(counted - 5.5) < 1e-6 && sim._eruptT < 0.1, `updateVolcano ${hasIt}, 5 -> ${counted}, held at ${Number(sim._eruptT).toFixed(3)}`);
    }
    sim.quitToMenu('missions');
  }

  // Loop-the-loop: a real loop, on the real flight model.
  {
    say('events: loop-the-loop, flown');
    await begin('goofy-loops');
    toStep('loop1');
    flyAt(700, 900, 620, 90, 150);
    ac.controls.throttle = 1;
    sim.input.throttleTarget = 1;
    sim.override = { pitch: 1, roll: 0, yaw: 0 };
    const looped = run(40, () => sim.runner.data.loops >= 1);
    sim.override = null;
    r.ok('goofy-loops: holding S in the fighter flies a loop that counts', looped, `loops ${sim.runner.data.loops}, crashed ${ac.crashed}`);
    // And a steep level turn does not.
    await begin('goofy-loops');
    toStep('loop1');
    flyAt(700, 900, 620, 90, 150);
    // Hold 60 degrees of bank and pull, for twenty seconds.
    for (let t = 0; t < 20; t += 0.1) {
      const bank = ac.bankAngleDeg();
      sim.override = { pitch: 0.6, roll: Math.max(-1, Math.min(1, (60 - bank) / 30)), yaw: 0 };
      sim.step(0.1, 1 / 30);
    }
    sim.override = null;
    r.ok('goofy-loops: a tight turn is not a loop', sim.runner.data.loops === 0, sim.runner.data.loops);
    sim.quitToMenu('missions');
  }

  // Ice cream: a drop on the pad from height.
  {
    await begin('goofy-icecream');
    toStep('drop');
    flyAt(DELIVERY_PAD.x - 50, DELIVERY_PAD.y + 90, DELIVERY_PAD.z, 90, 40);
    sim.dropCargo();
    r.ok('goofy-icecream: a drop on the target finishes it before it melts', finished(40) && sim.runner.data.melt < 1, (sim.runner.data.melt || 0).toFixed(2));
    sim.quitToMenu('missions');
  }

  // Bubbles: twelve pops.
  {
    await begin('goofy-bubbles');
    toStep('pop');
    const list = sim.runner.data.bubbles.slice(0, 12);
    for (const s of list) {
      flyAt(s.position.x - 20, s.position.y, s.position.z, 90, 50);
      sim.step(0.1, 1 / 30);
    }
    r.ok('goofy-bubbles: flying through twelve finishes it', status() === 'complete', `${sim.runner.data.popped} popped`);
    sim.quitToMenu('missions');
  }

  // Bee: stay close for forty seconds.
  {
    await begin('goofy-bee');
    toStep('follow');
    const ok = finished(60, () => {
      const p = sim.runner.data.bee.position;
      flyAt(p.x - 80, p.y, p.z, 90, 40);
    });
    r.ok('goofy-bee: forty seconds close to the bee finishes it', ok, sim.runner.data.follow);
    sim.quitToMenu('missions');
  }

  // The events missions, start to finish.
  {
    say('events: Hijacked!, the mission');
    await begin('event-hijack');
    run(12, () => stepId() === 'burst');
    r.ok('event-hijack: the story starts on its own after the cruise', stepId() === 'burst' && FE.hijackInfo().phase === 'burst', stepId());
    r.ok('event-hijack: the mission\'s own words, not the story\'s, are on the objective', /HIJACK/.test(objective()), objective());
    sim.tap('Digit7');
    sim.step(0.3, 1 / 30);
    r.ok('event-hijack: 7 moves it on', stepId() === 'orders', stepId());
    run(18);
    r.ok('event-hijack: the HUD arrow points where he wants to go', !!sim.runner.activeTarget(), JSON.stringify(sim.runner.activeTarget() && sim.runner.activeTarget().label));
    flyAt(RUNWAY.touchdown.x - 8000, RUNWAY.elev + 500, RUNWAY.touchdown.z, 90, 70);
    run(2, () => stepId() === 'land');
    r.ok('event-hijack: close in, on to landing', stepId() === 'land', stepId());
    land(-150, 0);
    run(4, () => stepId() === 'stand');
    r.ok('event-hijack: down, on to the stand', stepId() === 'stand', stepId());
    r.ok('event-hijack: and it finishes when the police have him', finished(160));
    r.ok('event-hijack: with the story\'s own score', sim.runner.data.score === FE.hijackInfo().score && sim.runner.data.score > 0, sim.runner.data.score);
    sim.key('Space', false);
    sim.step(0.5, 1 / 30);
    sim.quitToMenu('missions');

    /*
     * The by-the-book mission is in the list for everybody, and gates
     * itself: without the Dev passcode it ends at once, saying where the code
     * goes. With it (put in for this run, and taken out again) it flies.
     */
    say('events: Hijack: By the Book, the mission');
    const { REAL_HIJACK } = await import('../../src/game/extra/events.js');
    const had = MISSIONS.includes(REAL_HIJACK);
    if (!had) MISSIONS.push(REAL_HIJACK);
    const devWas = !!(sim.prog && sim.prog.devUnlocked);
    try {
      if (sim.prog) sim.prog.devUnlocked = false;
      let why = null;
      const onFail = sim.runner.onFail;
      sim.runner.onFail = (e) => {
        why = e && e.reason;
        if (onFail) onFail(e);
      };
      try {
        await begin('event-hijack-real');
        sim.step(0.5, 1 / 30);
      } finally {
        sim.runner.onFail = onFail;
      }
      r.ok('event-hijack-real: without the Dev passcode it ends at once, saying where the code goes',
        status() === 'failed' && /Dev passcode/.test(why || '') && FE.hijackInfo().phase === 'idle', `${status()}: ${why}`);
      sim.quitToMenu('missions');
      if (sim.prog) sim.prog.devUnlocked = true;
      await begin('event-hijack-real');
      run(12, () => stepId() === 'door');
      r.ok('event-hijack-real: the door, after the cruise', stepId() === 'door' && FE.hijackInfo().choosing, stepId());
      FE.answerChoice(0);
      run(8, () => stepId() === 'squawk');
      sim.tap('Digit7');
      run(8, () => FE.hijackInfo().choosing);
      FE.answerChoice(0);
      run(15, () => FE.hijackInfo().choosing);
      FE.answerChoice(0);
      run(10, () => stepId() === 'orders');
      r.ok('event-hijack-real: door, squawk and ATC answered, on to his orders', stepId() === 'orders', stepId());
      const hdg = Number((UI.uiState().text.match(/heading (\d{3})/) || [])[1]);
      r.ok('event-hijack-real: his heading gets the little arrow, even in a mission', UI.uiState().guide && /Heading \d{3}/.test(UI.uiState().guideLabel), UI.uiState().guideLabel);
      flyAt(ac.pos.x, ac.pos.y, ac.pos.z, hdg, 90, false);
      run(12, () => FE.hijackInfo().choosing);
      FE.answerChoice(0);
      run(16, () => stepId() === 'intercept');
      run(80, () => FE.hijackInfo().lead && FE.hijackInfo().escortFormed);
      r.ok('event-hijack-real: the HUD arrow is on the lead jet', stepId() === 'intercept' && sim.runner.activeTarget() && sim.runner.activeTarget().label === 'Lead jet', stepId());
      run(2);
      sim.override = { roll: -1, pitch: 0.15 };
      run(2.5, () => ac.bankAngleDeg() < -14);
      sim.override = { roll: 1, pitch: 0.15 };
      run(4, () => FE.hijackInfo().acked);
      sim.override = null;
      flyAt(ac.pos.x, ac.pos.y, ac.pos.z, ac.heading, 90, false);
      run(2, () => stepId() === 'follow');
      r.ok('event-hijack-real: rocked wings, on to following', stepId() === 'follow', stepId());
      for (let i = 0; i < 3; i++) {
        run(16, () => FE.hijackInfo().choosing);
        FE.answerChoice(0);
      }
      run(13);
      const T0 = FE.hijackInfo().remote.clone();
      const L = FE.hijackInfo().landHdg;
      const back = new THREE.Vector3(Math.sin((L * Math.PI) / 180), 0, -Math.cos((L * Math.PI) / 180));
      flyAt(T0.x - back.x * 5200, T0.y + 300, T0.z - back.z * 5200, L, 70, false);
      run(1);
      sim.tap('KeyG');
      run(6, () => stepId() === 'land');
      r.ok('event-hijack-real: wheels answered, released, on to landing where the jets said', stepId() === 'land' && FE.hijackInfo().gearAck, stepId());
      land(T0.x + back.x * 450, T0.z + back.z * 450, L);
      run(4, () => stepId() === 'stop');
      sim.tap('KeyI');
      r.ok('event-hijack-real: and it finishes when the team has him', finished(160), `${stepId()} ${FE.hijackInfo().phase}`);
      r.ok('event-hijack-real: with the story\'s own score', sim.runner.data.score === FE.hijackInfo().score && sim.runner.data.score >= 80, sim.runner.data.score);
      sim.key('Space', false);
      sim.step(0.5, 1 / 30);
      sim.quitToMenu('missions');
    } finally {
      if (!had) {
        const i = MISSIONS.indexOf(REAL_HIJACK);
        if (i >= 0) MISSIONS.splice(i, 1);
      }
      if (sim.prog) sim.prog.devUnlocked = devWas;
      sim.override = null;
    }

    say('events: Pizza on the Runway, the mission');
    await begin('event-breakin');
    run(6, () => stepId() === 'hold');
    r.ok('event-breakin: the car arrives while you are lined up', stepId() === 'hold' && FE.breakInInfo().phase === 'run', stepId());
    run(110, () => stepId() === 'go');
    r.ok('event-breakin: holding still gets you cleared', stepId() === 'go', `${stepId()} ${status()} ${FE.breakInInfo().phase} at ${Math.round(ac.pos.x)},${Math.round(ac.pos.z)} ground ${ac.onGround}`);
    // Off and climbing — high, so the low pass does not count on the way.
    flyAt(0, 700, 0, 90, 60);
    run(5, () => stepId() === 'thanks');
    // A take-off and a lap take a minute; the police must still be there to wave to.
    run(40);
    const br = FE.breakInInfo().breach;
    {
      const cars = sim.scene.children.filter((o) => o.name === 'police-car' && flat(o.position, br) < 80).length;
      r.ok('event-breakin: a minute later the police are still by the fence to wave to', stepId() === 'thanks' && cars === 2, `${stepId()} ${cars} cars`);
    }
    flyAt(br.x - 100, heightAt(br.x, br.z) + 100, br.z, 90, 55);
    run(2, () => stepId() === 'land');
    r.ok('event-breakin: a low pass by the police moves on', stepId() === 'land', stepId());
    land(-300, 0);
    r.ok('event-breakin: and landing finishes it', finished(6));
    sim.key('Space', false);
    sim.step(0.5, 1 / 30);
    sim.quitToMenu('missions');

    await begin('event-breakin');
    run(6, () => stepId() === 'hold');
    flyAt(-300, 100, 0, 90, 60);
    sim.step(0.5, 1 / 30);
    r.ok('event-breakin: not holding is a (friendly) fail', status() === 'failed', status());
    sim.quitToMenu('main');
  }

  /* ------------------------------------------------------ the dice -- */
  /*
   * startMode keeps the dice out of the self-test (it drives the game with
   * auto-pause off), so they are rolled here by hand with the odds at one:
   * what each kind of flight arms, and that what is armed then happens.
   */
  say('events: the dice');
  {
    const { AIRCRAFT } = await import('../../src/aircraft/types.js');
    // Only a roster entry marked longHaul (the airliners team's 747 and
    // A380) gets the hijack. A roster without one has nothing to arm.
    const lh = AIRCRAFT.find((a) => a.longHaul);
    FE.ODDS.hijack = 1;
    FE.ODDS.breakin = 1;
    try {
      if (lh) {
        await free(lh.id, true);
        flyAt(-16000, 2400, -9000, 0, 120, false);
        const rolledLH = FE.rollDice(sim, 'free');
        const armedLH = FE.hijackInfo().phase === 'armed' && FE.hijackInfo().owner === 'free';
        // It waits until you are properly on your way (one to three minutes airborne, far from the field).
        const began = run(200, () => FE.hijackInfo().phase !== 'armed');
        const beganAs = `${FE.hijackInfo().phase} ${FE.hijackInfo().version}`;
        r.ok(`dice: a long-haul Free Flight (${lh.id}) arms the hijack`, rolledLH && rolledLH.startsWith('hijack') && armedLH, `${rolledLH} ${FE.hijackInfo().phase}`);
        r.ok('dice: ...and it begins on its own, later in the flight', began && /^(burst|door) /.test(beganAs), beganAs);
        sim.quitToMenu('main');
      } else {
        r.ok('dice: no roster entry is marked longHaul here, so no flight can arm the hijack', true, AIRCRAFT.map((a) => a.id).join(','));
      }
      await free('skylark', false);
      const rolledSky = FE.rollDice(sim, 'free');
      const came = run(40, () => FE.breakInInfo().phase === 'run');
      r.ok('dice: a Skylark never gets a hijack; it gets the pizza car, which comes while you sit on the runway',
        rolledSky === 'breakin' && FE.hijackInfo().phase === 'idle' && came, `${rolledSky} ${FE.breakInInfo().phase}`);
      sim.quitToMenu('main');
    } finally {
      FE.ODDS.hijack = 0;
      FE.ODDS.breakin = 0;
    }
  }

  /* ------------------------------------------------ the Dev buttons -- */
  say('events: the Dev buttons');
  {
    const acts = extDevActions();
    const act = (label) => acts.find((a) => a.label === label);
    const until = async (fn, ms = 20000) => {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        if (fn()) return true;
        await new Promise((res) => setTimeout(res, 100));
      }
      return !!fn();
    };
    const chosen = sim.settings.aircraft;
    const heavy = () => !!sim.aircraftType && (!!sim.aircraftType.longHaul || sim.aircraftType.id === FE.longHaulId());
    sim.quitToMenu('main');
    const hj = act('Trigger hijack event');
    if (hj) hj.run(sim);
    const film = await until(() => sim.state === 'flying' && FE.hijackInfo().phase !== 'idle');
    r.ok('dev: "Trigger hijack event" from the menu starts a long-haul flight in the air, and the film hijack',
      film && heavy() && !ac.onGround && FE.hijackInfo().version === 'film' && FE.hijackInfo().owner === 'dev',
      `${sim.aircraftType && sim.aircraftType.id} ${FE.hijackInfo().phase} ${FE.hijackInfo().version}`);
    r.ok('dev: ...without changing the aeroplane you picked', sim.settings.aircraft === chosen, `${sim.settings.aircraft} (was ${chosen})`);
    sim.quitToMenu('main');
    const rh = act('Realistic hijack');
    if (rh) rh.run(sim);
    const real = await until(() => sim.state === 'flying' && FE.hijackInfo().phase !== 'idle');
    r.ok('dev: "Realistic hijack" starts the by-the-book one', real && heavy() && FE.hijackInfo().version === 'real' && FE.hijackInfo().phase === 'door',
      `${FE.hijackInfo().phase} ${FE.hijackInfo().version}`);
    sim.quitToMenu('main');
    const bi = act('Trigger airport break-in');
    if (bi) bi.run(sim);
    const car = await until(() => sim.state === 'flying' && FE.breakInInfo().phase === 'run');
    r.ok('dev: "Trigger airport break-in" from the menu starts a flight on the runway, and the car', car && ac.onGround, FE.breakInInfo().phase);
    sim.quitToMenu('main');
    r.ok('dev: back at the menu, nothing is left running', FE.hijackInfo().phase === 'idle' && FE.breakInInfo().phase === 'idle');
  }

  r.ok('events: both features still live at the end', live(), JSON.stringify(extStatus()));
  r.ok('events: nothing left over in the scene',
    propsLeft() === 0 && sim.scene.children.filter((o) => o.name && (o.name === 'police-car' || o.name === 'police-van' || o.name === 'police-stairs'
      || o.name === 'pizza-car' || o.name.startsWith('person-') || o.name.startsWith('escort-'))).length === 0);
}

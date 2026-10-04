/**
 * Browser checks for the events team: the flight events (both hijacks) and
 * the events missions, run on the real game.
 *
 *   const { check } = await import('./tests/features/events.browser.js');
 *   const r = { checks: [], ok(n, p, d) { this.checks.push({ n, p: !!p, d: String(d || '') }); return !!p; } };
 *   await check(window.__sim, r, console.log);
 *
 * What it proves, in order:
 *   - both extensions are registered and still live after everything below;
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
 *   - every events mission starts, walks through every step without
 *     throwing, and takes its props away with it;
 *   - Free Flight never starts one on its own — there is no dice any more.
 *
 * It flies with sim.step(), so it is quick with the renderer stubbed (see the
 * note at the top of tests/selftest.js).
 */

export async function check(sim, r, say = () => {}) {
  try {
    await checks(sim, r, say);
  } finally {
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
  const { heightAt } = await import('../../src/world/terrain.js');

  const live = () => ['flightevents', 'eventcards'].every((id) => {
    const e = extStatus().find((x) => x.id === id);
    return e && e.live;
  });
  const ac = sim.aircraft;
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
  const status = () => sim.runner.status;
  // What the objective panel says, title and text together.
  const objective = () => `${sim.hud.objectiveTitle.textContent} — ${sim.hud.objectiveText.textContent}`;

  r.ok('events: flight-events and event-cards extensions are registered and live', live(), JSON.stringify(extStatus()));

  /* ------------------------------------------------------------ data -- */
  const events = MISSIONS.filter((m) => m.category === 'events');
  r.ok('events: the hijack mission is in the mission list', events.some((m) => m.id === 'event-hijack'), events.map((m) => m.id).join());

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
  r.ok('events: Dev panel offers "Trigger hijack event"',
    labels.includes('Trigger hijack event'), labels.join(' | '));
  r.ok('events: no leftover break-in Dev button', !labels.includes('Trigger airport break-in'), labels.join(' | '));

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
    || o.name.startsWith('escort-') || o.name.startsWith('person-'))).length;
  r.ok('film: going back to the menu clears it all away', h().phase === 'idle' && leftovers() === 0, leftovers());

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
  for (const m of events) {
    say(`events: mission ${m.id}`);
    let threw = null;
    // The realistic one gates itself on the Dev passcode; walk it with the code in.
    const devWas = !!(sim.prog && sim.prog.devUnlocked);
    if (m.devOnly && sim.prog) sim.prog.devUnlocked = true;
    try {
      await sim.startMode('mission', { id: m.id });
      sim.step(0.5, 1 / 30);
      const started = status() === 'running' && sim.runner.def.id === m.id;
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
  }

  /* ------------------------------------------------------ no dice -- */
  /*
   * NO RANDOM EVENTS IN FREE FLIGHT. The owner asked for it more than once,
   * and a hijack (or, before it was removed, the pizza car) that ambushed a
   * flight nobody chose was exactly the "random stuff" they meant. Free
   * Flight no longer rolls any dice at all, for any kind of aeroplane — this
   * stubs Math.random() to whatever old code would have read as "arm it" and
   * proves nothing starts anyway. forceHijack() still works on purpose
   * (a mission or the Dev panel), proven right after.
   */
  say('events: no dice in Free Flight');
  {
    const { AIRCRAFT } = await import('../../src/aircraft/types.js');
    const lh = AIRCRAFT.find((a) => a.longHaul) || { id: FE.longHaulId() };
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      await free(lh.id, true);
      flyAt(-16000, 2400, -9000, 0, 120, false);
      r.ok(`no dice: a long-haul Free Flight (${lh.id}) does not arm the hijack on its own`, FE.hijackInfo().phase === 'idle', FE.hijackInfo().phase);
      const armedLater = run(200, () => FE.hijackInfo().phase !== 'idle');
      r.ok('no dice: ...and nothing starts later in the flight either', !armedLater && FE.hijackInfo().phase === 'idle', FE.hijackInfo().phase);
      sim.quitToMenu('main');
      await free('skylark', false);
      const armedOnGround = run(60, () => FE.hijackInfo().phase !== 'idle');
      r.ok('no dice: a Skylark sitting on the runway in Free Flight starts nothing either', !armedOnGround && FE.hijackInfo().phase === 'idle', FE.hijackInfo().phase);
      sim.quitToMenu('main');
    } finally {
      Math.random = origRandom;
    }
    const started = FE.forceHijack(sim, { owner: 'test', version: 'film' });
    r.ok('no dice: forceHijack still starts one on purpose', started !== false && FE.hijackInfo().phase !== 'idle', FE.hijackInfo().phase);
    sim.quitToMenu('main');
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
    r.ok('dev: no leftover "Trigger airport break-in" button', !act('Trigger airport break-in'), acts.map((a) => a.label).join(' | '));
    r.ok('dev: back at the menu, nothing is left running', FE.hijackInfo().phase === 'idle');
  }

  r.ok('events: both features still live at the end', live(), JSON.stringify(extStatus()));
  r.ok('events: nothing left over in the scene',
    sim.scene.children.filter((o) => o.name && (o.name === 'police-car' || o.name === 'police-van' || o.name === 'police-stairs'
      || o.name.startsWith('person-') || o.name.startsWith('escort-'))).length === 0);
}

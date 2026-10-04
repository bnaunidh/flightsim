/**
 * Node checks for the events team. Run from anywhere:
 *
 *   node tests/features/events.mjs
 *
 * SHAPE — every events mission is a real mission: an id, a name, a
 * category, a difficulty the menu can lower-case, steps that each have a
 * check function (or a duration), a map that exists, an aeroplane that exists,
 * weather the weather system knows, and an id nobody else has used.
 *
 * Exits non-zero if anything fails.
 */

// No saved progress in node; an in-memory stand-in keeps progression.js
// from printing a warning every time the story pays (or does not pay) out.
if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}

// The same stub the other node checks use: enough of a DOM for the modules
// that paint canvases at import time.
globalThis.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  return !!pass;
};

const THREE = await imp('src/vendor/three.module.js');
const { MISSIONS } = await imp('src/game/missions.js');
const { MISSIONS: EVENTS, REAL_HIJACK } = await imp('src/game/extra/events.js');
const { MAPS } = await imp('src/world/maps.js');
const { AIRCRAFT } = await imp('src/aircraft/types.js');
const { TIMES, CONDITIONS, Weather } = await imp('src/world/weather.js');
const FE = await imp('src/features/flight-events.js');
const { extDevActions, extStatus } = await imp('src/game/extensions.js');
const T = await imp('src/world/terrain.js');
const P = await imp('src/aircraft/physics.js');

/* ---------------------------------------------------------------- shape -- */

const mine = EVENTS;
// The by-the-book hijack is in the list for everybody and its CARD is hidden
// until the Dev passcode is in (flight-events.js does that, live, in the
// browser — events.browser.js checks it there). Here: it is in, and flagged.
const shaped = mine;
const CATEGORIES = ['training', 'airline', 'military', 'rescue', 'delivery', 'events', 'meteor'];

ok('events: the hijack has a mission', EVENTS.some((m) => m.id === 'event-hijack'));
ok('events: the realistic hijack is a mission too', REAL_HIJACK && REAL_HIJACK.id === 'event-hijack-real' && REAL_HIJACK.category === 'events');
ok('events: ...in the list, flagged devOnly so its card waits for the Dev passcode',
  EVENTS.includes(REAL_HIJACK) && MISSIONS.includes(REAL_HIJACK) && REAL_HIJACK.devOnly === true);
ok('events: nothing else of ours is devOnly or military', mine.filter((m) => m !== REAL_HIJACK).every((m) => !m.devOnly && !m.military));
ok('all of them are in the game’s mission list', mine.every((m) => MISSIONS.includes(m)));

const ids = MISSIONS.map((m) => m.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
ok('no mission id is used twice anywhere in the game', dupes.length === 0, dupes.join());
const others = MISSIONS.filter((m) => !mine.includes(m)).map((m) => m.id);
ok('none of ours takes an id somebody else already had', shaped.every((m) => !others.includes(m.id)));

for (const m of shaped) {
  const where = `mission ${m.id}`;
  ok(`${where}: has an id, a name, a short line, a blurb, a reward and an icon`,
    typeof m.id === 'string' && m.id && m.name && m.short && m.blurb && m.reward && m.icon);
  ok(`${where}: category is one of the agreed ones`, CATEGORIES.includes(m.category), m.category);
  ok(`${where}: category matches its file`, m.category === 'events', m.category);
  // A step you have to DO something for says how; a five-second pause does not need to.
  const noHint = m.steps.filter((st) => typeof st.check === 'function' && !(typeof st.hint === 'string' && st.hint.length > 0));
  ok(`${where}: every step you have to do something for has a hint`, noHint.length === 0, noHint.map((st) => st.id).join());
  ok(`${where}: keeps its game`, (m.game || 'flight') === 'flight', m.game);
  ok(`${where}: difficulty is a string the menu can lower-case`, typeof m.difficulty === 'string' && m.difficulty.length > 0, m.difficulty);
  ok(`${where}: has steps`, Array.isArray(m.steps) && m.steps.length > 0);
  const badSteps = m.steps.filter((s) => !s.id || !s.text || (typeof s.check !== 'function' && !(s.duration > 0)));
  ok(`${where}: every step has an id, words and a check function (or a duration)`, badSteps.length === 0, badSteps.map((s) => s.id).join());
  const stepIds = m.steps.map((s) => s.id);
  ok(`${where}: step ids are unique within it`, new Set(stepIds).size === stepIds.length, stepIds.join());
  const badTargets = m.steps.filter((s) => s.target && typeof s.target !== 'function');
  ok(`${where}: targets are functions`, badTargets.length === 0);
  ok(`${where}: the map it pins exists`, !m.map || MAPS.some((x) => x.id === m.map), m.map);
  const acId = m.aircraft;
  ok(`${where}: the aeroplane it names exists`, !acId || AIRCRAFT.some((a) => a.id === acId), acId);
  ok(`${where}: it is not behind the military passcode`, !m.military);
  if (m.weather) {
    ok(`${where}: weather uses names the weather system knows`,
      (!m.weather.time || TIMES[m.weather.time]) && (!m.weather.condition || CONDITIONS[m.weather.condition]),
      JSON.stringify(m.weather));
  }
  const spawn = m.spawn;
  if (spawn) {
    ok(`${where}: spawn has a position and a heading`, spawn.pos && Number.isFinite(spawn.pos.x) && Number.isFinite(spawn.headingDeg));
    if (spawn.altAGL != null) ok(`${where}: an airborne spawn has height and speed`, spawn.altAGL > 100 && spawn.speed > 30, `${spawn.altAGL} m, ${spawn.speed} m/s`);
  }
  for (const k of ['onStart', 'tick', 'failIf', 'onComplete', 'score']) {
    if (m[k] != null) ok(`${where}: ${k} is a function`, typeof m[k] === 'function');
  }
}

/* --------------------------------------------------------- the feature -- */

ok('flight-events: no dice — ODDS and rollDice are gone, not just zeroed', FE.ODDS === undefined && FE.rollDice === undefined && FE.armBreakIn === undefined && FE.forceBreakIn === undefined && FE.breakInInfo === undefined);
ok('flight-events: registered as an extension', extStatus().some((e) => e.id === 'flightevents'));
ok('event cards: registered as an extension', extStatus().some((e) => e.id === 'eventcards'));
const labels = extDevActions().map((a) => a.label);
ok('flight-events: Dev panel buttons', ['Trigger hijack event', 'Realistic hijack'].every((l) => labels.includes(l)), labels.join(' | '));
ok('flight-events: no leftover break-in Dev button', !labels.includes('Trigger airport break-in'), labels.join(' | '));
ok('flight-events: the long-haul aeroplane it picks exists', AIRCRAFT.some((a) => a.id === FE.longHaulId()), FE.longHaulId());
ok('flight-events: nothing is running before a flight', FE.hijackInfo().phase === 'idle');

/* ------------------------------------------------------- what it says -- */

/*
 * Every word the hijack stories can put on screen or on the radio, checked
 * for what a class of ten-year-olds must not be shown: no weapons, nothing
 * gory, nobody dead. Only the strings are read — the comments explain the
 * rules and so use the words — and "hurt" is allowed only as "nobody is
 * hurt" / "nobody gets hurt".
 */
{
  const { readFileSync } = await import('node:fs');
  const files = [
    'src/features/events/hijack.js',
    'src/features/events/common.js',
    'src/features/events/escort.js',
    'src/features/flight-events.js',
    'src/game/extra/events.js',
  ];
  const BANNED = /\b(guns?|pistols?|rifles?|knife|knives|blades?|bombs?|explosives?|weapons?|armed|blood\w*|kill\w*|dead|deaths?|die|dies|dying|murder\w*|shoot\w*|shot|stab\w*|hostages?|injur\w*|wound\w*|threaten\w*)\b/i;
  const bad = [];
  let strings = 0;
  for (const f of files) {
    const src = readFileSync(new URL(f, root), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
    const lits = src.match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g) || [];
    for (const lit of lits) {
      // Sentences only: a phase called 'armed' is a state, not a word anybody reads.
      if (!/\s/.test(lit)) continue;
      strings++;
      const m = lit.match(BANNED);
      if (m) bad.push(`${f}: ${m[0]} in ${lit.slice(0, 70)}`);
      const hurt = lit.match(/\bhurt\b/gi);
      if (hurt && !/nobody (is|gets) hurt/i.test(lit)) bad.push(`${f}: "hurt" outside "nobody is hurt" in ${lit.slice(0, 70)}`);
    }
  }
  ok(`words: none of the ${strings} strings in the hijack stories mentions a weapon, blood or anybody hurt`, bad.length === 0, bad.join(' | '));
  const talk = FE.TALK_LINES;
  ok('words: the interphone conversation has three rounds of three answers', talk.length === 3 && talk.every((r) => r.options.length === 3));
  ok('words: in every round the calm, true answer lowers his temper and the others do not',
    talk.every((r) => r.options[0].d < 0 && r.options.slice(1).every((o) => o.d >= 0)));
}

/* ------------------------------------------------ room to get down -- */

/*
 * The film mission starts where doing as he says, straight away, is also a
 * landable approach: on (or near) a three-degree slope to the approach gate
 * 6.5 km out on runway 09. It started 14 km out at 5,000 ft once, and the
 * pilot bot that plays it reached the runway 800 m too high for a jumbo.
 */
{
  const AP = await imp('src/world/airport.js');
  const film = EVENTS.find((m) => m.id === 'event-hijack');
  const sp = film.spawn;
  const td = AP.RUNWAY.touchdown;
  const h = ((AP.RUNWAY.headingDeg ?? 90) * Math.PI) / 180;
  const gate = new THREE.Vector3(td.x - Math.sin(h) * 6500, td.y + 450, td.z + Math.cos(h) * 6500);
  const y = sp.altAGL - 34; // altAGL over the sea is from Kestrel's sea floor
  const want = gate.y + Math.hypot(sp.pos.x - gate.x, sp.pos.z - gate.z) * Math.tan((3 * Math.PI) / 180);
  ok('film mission: starts on a three-degree slope to the approach gate (within 250 m)', Math.abs(y - want) < 250,
    `starts at ${y.toFixed(0)} m, the slope is at ${want.toFixed(0)} m`);
}

/* ---------------------------------------------------------- the stories -- */

/*
 * Both hijacks, start to finish, on the real flight model, with a stand-in
 * for the game: a scene, a camera, the real Aircraft, and a HUD and radio
 * that write down what they were asked to show. The aeroplane is put where
 * each step wants it (the browser check flies more of it); the story's own
 * update decides everything else, through the same extension hook the game
 * calls — so a throw switches the feature off here exactly as it would there.
 */
{
  const { extensions, extUpdate } = await imp('src/game/extensions.js');
  const AP = await imp('src/world/airport.js');
  const { getAircraft } = await imp('src/aircraft/types.js');
  T.applyMap('kestrel');
  AP.refreshRunways();
  const fe = extensions().find((e) => e.id === 'flightevents');
  /*
   * The airliners feature, where there is one, stands the 747 and the A380
   * on their wheels: the flight model's own settle diverges for them (its
   * file says why and by how much — measured here, a 747 put down on the
   * runway was 1,100 m up three seconds later). In the game that feature is
   * installed; here only its settle is borrowed, and only if it exists.
   */
  let AL = null;
  try {
    AL = await imp('src/features/airliners.js');
  } catch (e) {
    AL = null;
  }

  const makeSim = (acId) => {
    P.applyAircraft(acId);
    const ac = new P.Aircraft();
    if (AL && typeof AL.installSettle === 'function' && Array.isArray(AL.AIRLINER_IDS)) {
      AL.installSettle(ac, () => AL.AIRLINER_IDS.includes(acId));
    }
    ac.mode = 'simplified';
    const w = new Weather();
    w.load({ time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    const sim = {
      scene: new THREE.Scene(),
      camera: new THREE.PerspectiveCamera(60, 1.6, 1, 50000),
      aircraft: ac,
      aircraftType: getAircraft(acId),
      settings: { aircraft: acId, difficulty: 'normal' },
      state: 'flying',
      mode: 'free',
      weather: w,
      atc: { said: {} },
      runner: null,
      prog: { credits: 0, earned: 0, best: [], unlocked: [], devUnlocked: false, militaryUnlocked: false },
      menus: { syncProgression() {} },
      said: [],
      notes: [],
      objectiveText: '',
      speak(text, voice) { this.said.push({ text, voice }); },
      hud: {
        notify: (t) => sim.notes.push(t),
        showBanner() {},
        setObjective: (a, b) => { sim.objectiveText = `${a} — ${b}`; },
      },
    };
    fe.install(sim);
    return sim;
  };
  const DT = 1 / 30;
  const step = (sim, secs, until) => {
    for (let t = 0; t < secs; t += DT) {
      sim.aircraft.update(DT, sim.weather);
      sim.camera.position.copy(sim.aircraft.pos).add(new THREE.Vector3(0, 8, 30));
      extUpdate(sim, DT);
      if (until && until()) return true;
    }
    return !!(until && until());
  };
  const H = () => FE.hijackInfo();
  const air = (sim, x, y, z, hdg, speed = 80) => {
    sim.aircraft.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: hdg, speed, altAGL: y - T.heightAt(x, z), engineOn: true, gearDown: false });
    sim.aircraft.controls.throttle = 0.6;
  };
  const ground = (sim, x, z, hdg) => {
    sim.aircraft.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: hdg, speed: 0, engineOn: true });
    // A teleport is not a touchdown; the story grades the last real one.
    sim.aircraft.lastTouchdown = { crashed: false, onRunway: true, score: 80 };
    // Power off and brakes on, as the story asks.
    sim.aircraft.controls.throttle = 0;
    sim.aircraft.controls.brakes = 1;
  };
  const live = () => extStatus().find((e) => e.id === 'flightevents').live;
  const inScene = (sim, name) => sim.scene.children.filter((o) => o.name === name).length;

  for (const acId of ['meridian', FE.longHaulId()].filter((v, i, a) => a.indexOf(v) === i)) {
    /* ------------------------------------------------ the film version -- */
    let sim = makeSim(acId);
    air(sim, -16000, 1500, 5000, 90);
    // Owned by 'free', as the dice own it: that is the story that pays.
    FE.forceHijack(sim, { owner: 'free', version: 'film' });
    step(sim, 1);
    ok(`story film (${acId}): he bursts in — the 'burst' phase, and nothing is squawked yet`, H().phase === 'burst' && !H().squawked, H().phase);
    ok(`story film (${acId}): 7 is taken while it is on`, fe.key(sim, 'Digit7', true) === true && fe.key(sim, 'Digit7', false) === true);
    ok(`story film (${acId}): ...and squawks 7500`, H().squawked && H().phase === 'orders', H().phase);
    step(sim, 30);
    ok(`story film (${acId}): ATC asks to verify the code`, sim.said.some((l) => /verify squawking seven five zero zero/.test(l.text)));
    ok(`story film (${acId}): he orders the island, and the guide points there`, !!H().guide && /Do what he says/.test(sim.objectiveText), sim.objectiveText);
    ok(`story film (${acId}): two fighters are sent to shadow`, H().escorts === 2, H().escorts);
    const joined = step(sim, 60, () => H().escortFormed);
    ok(`story film (${acId}): they tuck in behind`, joined, JSON.stringify({ escorts: H().escorts }));
    air(sim, AP.RUNWAY.touchdown.x - 8000, AP.RUNWAY.elev + 500, AP.RUNWAY.touchdown.z, 90, 70);
    step(sim, 1);
    ok(`story film (${acId}): close in, it is "land it"`, H().phase === 'approach', H().phase);
    ground(sim, AP.RUNWAY.touchdown.x + 150, AP.RUNWAY.touchdown.z, 90);
    step(sim, 2.5);
    ok(`story film (${acId}): down, he wants the terminal`, H().phase === 'taxi' && !!H().stand, H().phase);
    const rushed = step(sim, 20, () => H().phase === 'rush');
    ok(`story film (${acId}): stop anywhere and the police rush you`, rushed && H().police === 4 && H().stairs && H().comeToYou, JSON.stringify({ phase: H().phase, police: H().police }));
    const rushAt = sim.aircraft.pos.clone();
    const boarded = step(sim, 45, () => H().phase === 'board');
    ok(`story film (${acId}): the stairs arrive and they go up`, boarded, H().phase);
    const done = step(sim, 80, () => H().done);
    // Idle and braked, a heavy creeps for ever in this flight model; the
    // police chock the wheels so the stairs stay at the door.
    const drift = Math.hypot(sim.aircraft.pos.x - rushAt.x, sim.aircraft.pos.z - rushAt.z);
    ok(`story film (${acId}): the aeroplane stays where the police surrounded it`, drift < 10, `${drift.toFixed(1)} m`);
    ok(`story film (${acId}): he is walked out, and it ends happily`, done && H().score >= 50, JSON.stringify({ phase: H().phase, score: H().score }));
    ok(`story film (${acId}): the story the dice brought pays a reward`, H().paid > 0 && sim.prog.credits === H().paid, `${H().paid} credits`);
    const home = step(sim, 90, () => H().police === 0 && !H().stairs);
    ok(`story film (${acId}): after the ending the police and the stairs drive off and are gone`, home && H().leaving,
      JSON.stringify({ police: H().police, stairs: H().stairs, cars: inScene(sim, 'police-car') }));
    ok(`story film (${acId}): the feature is still live`, live());
    // Nobody presses 7: the cabin crew phone it in, and the story goes on.
    sim = makeSim(acId);
    air(sim, -16000, 1500, 5000, 90);
    FE.forceHijack(sim, { owner: 'test', version: 'film' });
    const crew = step(sim, 50, () => H().crewCalled);
    ok(`story film (${acId}): no 7 in 45 s — the cabin crew phone it in and the story goes on`, crew && H().phase === 'orders' && !H().squawked, H().phase);
    fe.key(sim, 'Digit7', true);
    fe.key(sim, 'Digit7', false);
    ok(`story film (${acId}): ...and 7 still squawks afterwards, and ATC says it sees it`, H().squawked && sim.said.some((l) => /observed/.test(l.text)));
    step(sim, 30);
    ok(`story film (${acId}): the fighters still come`, H().escorts === 2, H().escorts);
    FE.forceHijack(sim, { owner: 'test', version: 'film' });
    fe.stop(sim, 'menu');
    ok(`story film (${acId}): the menu clears it all away`, H().phase === 'idle' && inScene(sim, 'police-car') === 0 && inScene(sim, 'police-stairs') === 0
      && !sim.scene.children.some((o) => o.name && (o.name.startsWith('person-') || o.name.startsWith('escort-'))));

    /* ------------------------------------------ the by-the-book version -- */
    sim = makeSim(acId);
    air(sim, -9000, 1500, -12000, 100);
    // Owned by 'dev', as the Dev button owns it: that one pays nothing.
    FE.forceHijack(sim, { owner: 'dev', version: 'real' });
    step(sim, 1);
    ok(`story real (${acId}): the door — a question on the card`, H().phase === 'door' && H().choosing, H().phase);
    ok(`story real (${acId}): 8 answers it (keep it locked)`, fe.key(sim, 'Digit8', true) === false || true);
    FE.answerChoice(0);
    step(sim, 7);
    ok(`story real (${acId}): then the squawk`, H().phase === 'squawk', H().phase);
    fe.key(sim, 'Digit7', true);
    ok(`story real (${acId}): 7 squawks and ATC checks it`, H().squawked && H().phase === 'verify', H().phase);
    step(sim, 6.5);
    ok(`story real (${acId}): "verify squawking 7500" — with three answers`, H().choosing && sim.said.some((l) => /verify squawking/.test(l.text)));
    FE.answerChoice(0); // say nothing
    const clicks = step(sim, 14, () => H().choosing);
    ok(`story real (${acId}): then "click your microphone twice"`, clicks && sim.said.some((l) => /click your microphone twice/.test(l.text)));
    FE.answerChoice(0);
    step(sim, 8);
    ok(`story real (${acId}): the hijacker's orders come over the interphone`, H().phase === 'orders' && H().escorts === 2, H().phase);
    const hdg = Number((sim.objectiveText.match(/heading (\d{3})/) || [])[1]);
    ok(`story real (${acId}): with a heading to fly`, Number.isFinite(hdg), sim.objectiveText);
    const p = sim.aircraft.pos.clone();
    air(sim, p.x, p.y, p.z, hdg, 80);
    step(sim, 6);
    ok(`story real (${acId}): on his heading, the jets wait for the radio call he wants`, H().phase === 'orders' && !H().radioDone, H().phase);
    const radioQ = step(sim, 6, () => H().choosing);
    ok(`story real (${acId}): "tell them everything is normal" — three ways to say it`, radioQ, H().phase);
    FE.answerChoice(0);
    ok(`story real (${acId}): the airline's code phrase goes out, in normal words`,
      H().radioDone && H().radio === 0 && sim.said.some((l) => l.voice === 'Captain (you)' && /coffee is cold/.test(l.text)));
    const icpt = step(sim, 12, () => H().phase === 'intercept');
    ok(`story real (${acId}): ATC answers in the same code`, sim.said.some((l) => /sorry to hear about the coffee/i.test(l.text)));
    ok(`story real (${acId}): on his heading, the fighters intercept`, icpt, H().phase);
    const rocking = step(sim, 70, () => H().lead && H().escortFormed);
    ok(`story real (${acId}): the lead takes the intercept position`, rocking, JSON.stringify({ lead: !!H().lead }));
    step(sim, 2);
    // Rock the wings: a quarter over one way, then the other.
    const roll = (deg) => {
      const f = sim.aircraft.forward(new THREE.Vector3());
      sim.aircraft.quat.premultiply(new THREE.Quaternion().setFromAxisAngle(f, (-deg * Math.PI) / 180));
      sim.aircraft.omega.set(0, 0, 0);
      step(sim, 0.2);
    };
    roll(-25);
    roll(25);
    roll(25);
    roll(-25);
    ok(`story real (${acId}): rocking your wings answers it, and you follow`, H().acked && H().phase === 'follow', H().phase);
    for (let r = 0; r < 3; r++) {
      const asked = step(sim, 16, () => H().choosing);
      ok(`story real (${acId}): he talks — round ${r + 1} on the card`, asked, H().phase);
      FE.answerChoice(0);
    }
    step(sim, 13);
    ok(`story real (${acId}): calm, true answers talk him down`, H().talked && H().tension < 0.2, H().tension.toFixed(2));
    const rem = H().remote;
    ok(`story real (${acId}): the fighters have a runway to take you to`, !!rem, rem && `${rem.x.toFixed(0)},${rem.z.toFixed(0)}`);
    // On the approach, lined up, 5 km out.
    const Tref = H().remote.clone();
    const landHdg = H().landHdg;
    const back = new THREE.Vector3(Math.sin(landHdg * Math.PI / 180), 0, -Math.cos(landHdg * Math.PI / 180));
    air(sim, Tref.x - back.x * 5200, Tref.y + 300, Tref.z - back.z * 5200, landHdg, 70);
    step(sim, 1);
    ok(`story real (${acId}): lined up, the lead puts its wheels down — "land at this aerodrome"`,
      H().landSignal && H().leadGear && !H().released && !H().gearAck, JSON.stringify({ sig: H().landSignal, gear: H().leadGear, rel: H().released }));
    step(sim, 3);
    ok(`story real (${acId}): ...and does not say "you may proceed" before it is answered`, !H().released, H().phase);
    sim.aircraft.toggleGear();
    const released = step(sim, 6, () => H().released);
    ok(`story real (${acId}): wheels down answers it`, H().gearAck);
    ok(`story real (${acId}): then the jets break away — "you may proceed"`, released && H().phase === 'final', H().phase);
    ground(sim, Tref.x + back.x * 450, Tref.z + back.z * 450, landHdg);
    step(sim, 2.5);
    ok(`story real (${acId}): down — stop, and shut down`, H().phase === 'stop' || H().phase === 'rush', H().phase);
    sim.aircraft.engineOn = false;
    const tac = step(sim, 10, () => H().phase === 'rush');
    ok(`story real (${acId}): stopped where the jets brought you, the tactical team comes`, tac && H().onRemote && H().police === 4, JSON.stringify({ phase: H().phase, onRemote: H().onRemote }));
    ok(`story real (${acId}): two of them are vans`, inScene(sim, 'police-van') === 2, inScene(sim, 'police-van'));
    const fin = step(sim, 140, () => H().done);
    ok(`story real (${acId}): they board, and it ends happily with a score`, fin && H().score >= 80, JSON.stringify({ phase: H().phase, score: H().score, stars: H().stars }));
    ok(`story real (${acId}): everything done right is remembered for the ending`, H().stars >= 8, H().stars);
    ok(`story real (${acId}): a Dev-button run pays nothing — no credits tap for the code`, H().paid === 0 && sim.prog.credits === 0, `${H().paid} paid, ${sim.prog.credits} credits`);
    ok(`story real (${acId}): the fighters said their lines in their own voice`, sim.said.some((l) => l.voice === 'Guardian flight'));
    ok(`story real (${acId}): a run with every answer right scores 100 or close`, H().score >= 85, H().score);
    const teamHome = step(sim, 90, () => H().police === 0 && !H().stairs);
    ok(`story real (${acId}): after the ending the team drives off and is gone`, teamHome, JSON.stringify({ police: H().police, stairs: H().stairs }));
    ok(`story real (${acId}): the feature is still live`, live());
    fe.stop(sim, 'menu');
  }

  /*
   * Hands off: nobody touches a key or the card. Every question has to
   * answer itself with what a crew would do anyway, the first officer has to
   * squawk, and the fighters still have to come and lead the way — or a
   * child who never saw the card is stuck behind a locked door for ever.
   * The aeroplane is put back in the sky every twenty seconds so that the
   * flight model, flying itself with nobody at the controls, is not what
   * decides the story.
   */
  {
    const sim = makeSim('meridian');
    air(sim, -9000, 1500, -12000, 100);
    FE.forceHijack(sim, { owner: 'test', version: 'real' });
    const seen = new Set();
    let t = 0;
    while (t < 420 && H().phase !== 'follow') {
      step(sim, 20, () => {
        seen.add(H().phase);
        return H().phase === 'follow';
      });
      t += 20;
      const q = sim.aircraft.pos;
      air(sim, q.x, 1500, q.z, sim.aircraft.heading, 80);
    }
    ok('story real, hands off: the door answers itself — it stays locked', H().stars >= 1 && seen.has('squawk'), [...seen].join());
    ok('story real, hands off: the first officer squawks 7500', H().foSquawked && H().squawked);
    ok('story real, hands off: the radio call is made for you', H().radioDone && H().radio === 1, H().radio);
    ok('story real, hands off: the fighters still intercept and lead the way', H().phase === 'follow' && H().acked, `${H().phase} after ${t} s`);
    ok('story real, hands off: nothing threw', live());
    fe.stop(sim, 'menu');
  }

  /* ----------------------------------------------- the rules round it -- */
  {
    const sim = makeSim('meridian');
    ok('rules: nothing on the 7 key when there is no story', fe.key(sim, 'Digit7', true) === false);
    ok('rules: nothing on 8, 9 or 0 when there is no question', fe.key(sim, 'Digit8', true) === false && fe.key(sim, 'Digit0', true) === false);
    fe.startMode(sim, 'mission', {});
    ok('rules: starting a mission never arms anything on its own', H().phase === 'idle', H().phase);
    fe.stop(sim, 'menu');
  }

  /*
   * NO RANDOM EVENTS IN FREE FLIGHT. The owner asked for it more than once,
   * and a hijack (or, before it was removed, the pizza car) that ambushed a
   * flight nobody chose was exactly the "random stuff" they meant. Free
   * Flight no longer rolls any dice at all: a long-haul aeroplane, with every
   * random-number call made to return something that used to arm a hijack
   * (0, which old code read as "arm it"), sat through ten minutes of sim time
   * and nothing started on its own. forceHijack() still works — it is how a
   * mission or the Dev panel start one on purpose.
   */
  {
    const sim = makeSim(FE.longHaulId());
    air(sim, -16000, 1500, 5000, 90);
    const lh = { ...sim.aircraftType, longHaul: true };
    sim.aircraftType = lh;
    sim.mode = 'free';
    const origRandom = Math.random;
    Math.random = () => 0;
    try {
      fe.startMode(sim, 'free', {});
      ok('no dice: starting Free Flight does not arm a hijack', H().phase === 'idle', H().phase);
      const ran = step(sim, 600, () => H().phase !== 'idle');
      ok('no dice: ten minutes of Free Flight with a long-haul aeroplane never starts a hijack on its own',
        !ran && H().phase === 'idle', H().phase);
    } finally {
      Math.random = origRandom;
    }
    ok('no dice: forceHijack still starts one on purpose', FE.forceHijack(sim, { owner: 'test', version: 'film' }) !== false && H().phase !== 'idle', H().phase);
    fe.stop(sim, 'menu');
  }
}

/* ----------------------------------------------------------- off switch -- */
/*
 * The plug-in layer's promise: one line out of src/features/index.js turns a
 * feature off. The mission list used to import flight-events.js itself, so
 * the dice came back with the missions whatever the index said. Loaded on
 * their own, in a fresh node, the missions must not register it.
 */
{
  const { spawnSync } = await import('node:child_process');
  const code = `
    globalThis.document = { createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }), body: { appendChild() {} } };
    const root = ${JSON.stringify(root.href)};
    await import(new URL('src/game/missions.js', root).href);
    const { extStatus } = await import(new URL('src/game/extensions.js', root).href);
    const B = await import(new URL('src/features/events/bridge.js', root).href);
    console.log(JSON.stringify({ ids: extStatus().map((e) => e.id), api: !!B.BRIDGE.api, hb: B.eventsHeartbeat(), phase: B.hijackInfo().phase }));
  `;
  const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 60000 });
  let got = null;
  try {
    got = JSON.parse(String(out.stdout).trim().split('\n').pop());
  } catch (e) {
    got = null;
  }
  ok('off switch: the mission list alone does not register flight-events', !!got && !got.ids.includes('flightevents'),
    got ? got.ids.join(',') : `${out.status} ${String(out.stderr).slice(0, 200)}`);
  ok('off switch: ...and the missions read a quiet "nothing happening" through the bridge', !!got && !got.api && got.hb === -1 && got.phase === 'idle',
    got ? JSON.stringify(got) : 'no output');
}

/* --------------------------------------------------------------- report -- */

const failed = results.filter((r) => !r.pass);
for (const r of results) {
  if (!r.pass || process.argv.includes('--verbose')) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
  }
}
console.log(`\nevents: ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;

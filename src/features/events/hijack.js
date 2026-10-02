/**
 * The hijack, in two versions.
 *
 * The kid who owns the game read the first plan — a grumpy passenger who
 * could not get through the cockpit door — and wrote back: "let hijacking be
 * bad, but the more realistic one is behind a code". So:
 *
 * THE FILM VERSION (everybody; one long-haul Free Flight in ten, the mission
 * "Hijacked!", and the Dev button "Trigger hijack event"). A man forces his
 * way into the cockpit and orders the aeroplane to the island. You keep
 * flying and do as he says, and while he watches the windows you quietly
 * squawk 7500. ATC checks the code; you say nothing, which is the answer.
 * Two fighters tuck in low behind the tail where he cannot see them — and
 * once, he nearly does. He makes you land and taxi to the terminal, and the
 * police rush the aeroplane at the stand, go up the stairs and walk him off
 * in handcuffs.
 *
 * THE BY-THE-BOOK VERSION (only with the Dev passcode: the Dev button
 * "Realistic hijack", the mission of the same name, and the dice once the
 * code is in). Closer to what a real crew is trained to do:
 *   - somebody tries the flight deck door; it stays LOCKED, whatever is said;
 *   - you cannot talk freely, so the transponder says it: 7500;
 *   - ATC asks you to verify the code, and no reply is a reply;
 *   - a yes/no question answered with two clicks of the microphone;
 *   - the hijacker gives orders over the cabin interphone, and makes you
 *     tell the radio everything is normal — which you do, with the airline's
 *     code phrase for trouble slipped in (a made-up one: "the coffee is
 *     cold"), and ATC answers in the same code;
 *   - two fighters intercept and use the real ICAO signals (Annex 2,
 *     Appendix 2): rocking the wings from ahead and to the left is "you have
 *     been intercepted, follow me", and you rock yours back to say so, then
 *     follow it round and down the slope to the runway; the
 *     leader's wheels going down over the runway is "land at this
 *     aerodrome", answered by putting yours down; an abrupt climbing turn
 *     away is "you may proceed";
 *   - a forced diversion to the remote runway, the one away from the
 *     terminal, and a short conversation over the interphone where the words
 *     you pick make him calmer or angrier;
 *   - stop on the runway, engines off, and a police tactical team boards.
 *
 * WHAT IT IS NOT. It is played by a class of ten-year-olds on school
 * laptops. Nobody has a weapon — none is mentioned, described or shown.
 * Nobody is hurt and nobody is shown hurt. The tension is words, sounds and
 * two fighter jets. Everything is seen from the crew's seat and follows the
 * crew's side of real emergency procedure; nothing in it is, or could be
 * read as, a way to do this to an aeroplane. The bad guy loses, and the
 * ending is a happy one with a reward.
 *
 * Sound is procedural and quiet (./sfx.js). What the hijacker says is on the
 * card, under a muffled angry tone — no words, no speech synthesis. The radio
 * calls go through sim.speak(), which honours the player's voice setting.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt, isOnRunway2, obstacleAt } from '../../world/terrain.js';
import * as AP from '../../world/airport.js';
import * as Prog from '../../game/progression.js';
import { Escort, escortType } from './escort.js';
import { createPoliceCar, createVan, createStairs, createPerson, createPillar, pulsePillar, posePersonAt, disposeEventPerson } from './vehicles.js';
import * as SFX from './sfx.js';
import * as UI from './ui.js';
import {
  RUNWAY, FT, typeOf, callsign, field, runwayWords, runwayWordsFor, runwayNumberFor, headingNumber, headingWords,
  span, speak, notify, banner, flat, bearing, angleDiff, runwayFrame, rw, RW, secondRunway, after, runBeats,
  objective, restoreObjective, addPolice, removePolice, VOICE_FIGHTER, VOICE_CAPTAIN, stoppedNow,
} from './common.js';

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const S = { sim: null };

function fresh() {
  return {
    version: 'film', // 'film' | 'real'
    /*
     * film: idle | armed | burst | orders | approach | taxi | rush | board | done
     * real: idle | armed | door | squawk | verify | orders | intercept | follow | final | stop | rush | board | done
     */
    phase: 'idle',
    owner: null, // 'free' | 'mission' | 'dev' | 'test'
    t: 0,
    phaseT: 0,
    beats: [],
    triggerAt: 0,
    squawked: false,
    squawkAt: -1,
    hintT: 0,
    flew: false,
    touchAtStart: null,
    touch: null,
    answers: {},
    answeredN: 0,
    // The conversation.
    tension: 0.6,
    round: -1,
    talked: false,
    // The intercept.
    acked: false,
    rockL: false,
    rockR: false,
    rockWin: 0,
    rockT: 0,
    followT: 0,
    followAll: 0,
    released: false,
    onApproach: false,
    // Points, and the things done right, for the ending.
    pts: {},
    stars: [],
    // The fighters.
    escorts: [],
    lead: null,
    wing: null,
    // Real: a point 1.5 km down the leader's track — where to point to follow it.
    leadAim: new THREE.Vector3(),
    // Real: the point off to one side, further out than the gate, that the
    // leader goes to before turning in; and whether it has been passed.
    entry: new THREE.Vector3(),
    entryDone: false,
    shadowSaid: false,
    // Film: he looked out of the side window once.
    peeked: false,
    // "You are high": when it may next be said, and how often it has been.
    coachT: 12,
    coached: 0,
    escortBroke: false,
    // Where to go.
    guide: new THREE.Vector3(),
    guideOn: false,
    guideLabel: '',
    orderHdg: 270,
    rem: secondRunway(),
    landHdg: 180,
    landDir: new THREE.Vector3(),
    thr: new THREE.Vector3(),
    td: new THREE.Vector3(),
    gate: new THREE.Vector3(),
    onRemote: false,
    // The ground.
    police: [],
    stairs: null,
    stairsSpot: new THREE.Vector3(),
    stairsApproach: new THREE.Vector3(),
    stairsHdg: 0,
    stairsStage: 0,
    spots: [],
    door: new THREE.Vector3(),
    fwd: new THREE.Vector3(0, 0, -1),
    left: new THREE.Vector3(-1, 0, 0),
    walkers: [],
    perp: null,
    perpCar: null,
    perpAway: false,
    carAway: null,
    camT: 0,
    uiT: 0,
    remoteReady: false,
    remoteName: '',
    /** The answer handler for the question on the card, if there is one. */
    pending: null,
    // How long the question has been up, when it answers itself, and with
    // what — see ask(). `timedOut` is true only while that answer runs.
    askT: 0,
    askAfter: 0,
    askPick: 0,
    timedOut: false,
    // Film: nobody squawked, so the cabin crew phoned it in instead.
    crewCalled: false,
    // Real: nobody pressed 7, so the first officer did.
    foSquawked: false,
    // Real: the radio call he makes you give, in normal-sounding words.
    radioAsked: false,
    radioDone: false,
    radioAt: 0,
    // Real: the leader's "land at this aerodrome" (wheels down), and yours back.
    landSignal: false,
    landSigT: 0,
    gearAck: false,
    // After the ending: the police drive off again.
    leaveT: 0,
    leaving: false,
    backT: 0,
    // Crashed: the story has gone quiet.
    quiet: false,
    stand: new THREE.Vector3(),
    // Film: whether the stand has been picked (it waits until you have slowed).
    standChosen: false,
    pillar: null,
    stillT: 0,
    comeToYou: false,
    atStand: false,
    engineOffPaid: false,
    siren: null,
    drone: null,
    jet: null,
    cine: 0,
    camPos: new THREE.Vector3(),
    camLook: new THREE.Vector3(),
    paid: 0,
    score: 0,
  };
}

let H = fresh();

function setPhase(p) {
  H.phase = p;
  H.phaseT = 0;
  H.hintT = 0;
}

/**
 * Put a question on the card and remember who is waiting for the answer, so
 * the answer can come from a finger on the card, a key (8, 9, 0) or a test,
 * and the story does not depend on the page being there to ask it.
 *
 * Every question answers itself if it is left long enough (`after` seconds,
 * with answer `pick`; the handler sees `H.timedOut` and says so). The first
 * version waited for ever: a child who did not see the card, or did not know
 * the keys, sat behind a locked door with the buzzer going every eighteen
 * seconds and no way on. What the crew would do anyway is what happens —
 * the door stays locked, silence is taken as silence.
 */
function ask(sim, card, after = 30, pick = 0) {
  H.pending = card.onChoice;
  H.askT = 0;
  H.askAfter = after;
  H.askPick = pick;
  UI.showCard(sim, card);
}

/** Answer the question on the card by itself, if it has been up long enough. */
function askTimer(dt) {
  if (!H.pending || !(H.askAfter > 0)) return;
  H.askT += dt;
  if (H.askT < H.askAfter) return;
  const fn = H.pending;
  H.timedOut = true;
  try {
    fn(H.askPick);
  } finally {
    H.timedOut = false;
    // A handler that bailed out must not leave the same question to fire again.
    if (H.pending === fn) H.pending = null;
  }
}

/** Answer the question on the card: 0 is the first answer. For the tests and the console. */
export function answerChoice(i) {
  const fn = H.pending;
  if (!fn) return false;
  fn(i);
  return true;
}

export function hijackActive() {
  return H.phase !== 'idle' && H.phase !== 'armed' && H.phase !== 'done';
}

const AIRBORNE = {
  film: new Set(['burst', 'orders', 'approach']),
  real: new Set(['door', 'squawk', 'verify', 'orders', 'intercept', 'follow', 'final']),
};

/** Is the Dev passcode in? The by-the-book version lives behind it. */
export function devOpen(sim) {
  if (sim && sim.prog) return Prog.isDev(sim.prog);
  if (typeof window === 'undefined') return false;
  try {
    return Prog.isDev(Prog.load());
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Starting and stopping
 * ------------------------------------------------------------------ */

/** A long-haul Free Flight: maybe, later. Which version depends on the code. */
export function armHijack(sim, version = 'film') {
  resetHijack(sim);
  S.sim = sim;
  H.phase = 'armed';
  H.owner = 'free';
  H.version = version === 'real' ? 'real' : 'film';
  H.triggerAt = 60 + Math.random() * 120;
}

/** Begin the story now. `owner` is who asked: the dice, a mission, the Dev panel or a test. */
export function forceHijack(sim, { owner = 'dev', version = 'film' } = {}) {
  sim = sim || S.sim;
  if (!sim) return false;
  S.sim = sim;
  resetHijack(sim);
  H.owner = owner;
  H.version = version === 'real' ? 'real' : 'film';
  begin(sim);
  return true;
}

function begin(sim) {
  H.touchAtStart = sim.aircraft ? sim.aircraft.lastTouchdown || null : null;
  H.flew = !!(sim.aircraft && !sim.aircraft.onGround);
  if (H.drone) H.drone.stop();
  H.drone = new SFX.Loop(sim, 'drone', 0.035);
  H.drone.set(1, 1);
  if (H.jet) H.jet.stop();
  H.jet = new SFX.Loop(sim, 'jet', 0.05);
  quietTower(sim, true);
  if (H.version === 'real') startDoor(sim);
  else startBurst(sim);
}

/*
 * The ambient tower would otherwise clear you to land on runway 09 while the
 * story is sending you somewhere else. Its "said" flags are how it remembers
 * a call is done, so setting them keeps it quiet; the pizza car does the same.
 */
function quietTower(sim, quiet) {
  const said = sim && sim.atc && sim.atc.said;
  if (!said) return;
  said.final = quiet;
  said.shortfinal = quiet;
}

export function resetHijack(sim) {
  sim = sim || S.sim;
  for (const e of H.escorts) e.dispose();
  if (sim) removePolice(sim, H.police);
  if (H.stairs && H.stairs.obj && H.stairs.obj.parent) H.stairs.obj.parent.remove(H.stairs.obj);
  for (const w of H.walkers) if (w.obj) disposeEventPerson(w.obj);
  if (H.pillar && H.pillar.parent) H.pillar.parent.remove(H.pillar);
  for (const l of [H.siren, H.drone, H.jet]) if (l) l.stop();
  const wasShowing = H.phase !== 'idle' && H.phase !== 'armed';
  if (wasShowing) {
    if (sim) restoreObjective(sim, H);
    quietTower(sim, false);
    UI.hideCard();
    UI.hideMeter();
    UI.hideGuide();
  }
  if (sim && sim.extTarget && sim.extTarget.owner === 'hijack') sim.extTarget = null;
  H = fresh();
}

/* ------------------------------------------------------------------ *
 * The squawk — shared by both versions
 * ------------------------------------------------------------------ */

/** Set the transponder to 7500. Press 7, or tap the button on the card. */
export function squawk(sim) {
  sim = sim || S.sim;
  if (!sim || !hijackActive()) return false;
  if (H.squawked) {
    notify(sim, 'Already squawking 7500 — ATC can see it.', 'info', 2.5);
    return false;
  }
  if (!AIRBORNE[H.version].has(H.phase)) return false;
  H.squawked = true;
  H.squawkAt = H.t;
  SFX.blip(sim);
  notify(sim, 'Transponder 7500 — quietly', 'good', 3);
  const quick = H.t < 25;
  H.pts.squawk = H.crewCalled ? 5 : quick ? 15 : 10;
  H.stars.push(quick ? `Squawked 7500 in ${Math.max(1, Math.round(H.t))} seconds` : 'Squawked 7500');
  if (H.version === 'film') {
    /*
     * Only the first time moves the story on. Once the cabin crew have
     * phoned it in, the orders are already given; squawking afterwards is
     * still right, and ATC says it can see it — but starting the orders a
     * second time would have put him back at the beginning of his speech.
     */
    if (H.phase === 'burst') {
      startOrders(sim, 'squawk');
    } else {
      speak(sim, `${callsign(sim)}, ${field()} Approach, seven five zero zero observed. We are with you.`, 'approach');
      UI.showCard(sim, {
        who: 'Transponder',
        tone: 'good',
        icon: 'xpdr',
        code: '7500',
        alert: true,
        text: '7500 is in, and he did not notice. Every radar screen that can see you shows it now.',
        ttl: 8,
      });
    }
  } else if (H.phase === 'squawk') startVerify(sim);
  // In the door phase, the squawk waits for the door answer, then skips
  // straight to ATC checking it.
  return true;
}

/* ================================================================== *
 * THE FILM VERSION
 * ================================================================== */

function startBurst(sim) {
  setPhase('burst');
  after(H, 0.1, (s) => SFX.doorBang(s, 2));
  after(H, 0.9, (s) => SFX.grumble(s, 9));
  banner(sim, 'HIJACK!', 'Someone has forced his way into the cockpit', 'bad', 5);
  UI.showCard(sim, {
    who: 'In the cockpit',
    tone: 'bad',
    icon: 'door',
    text:
      'The cockpit door bangs open. A man in a grey hoodie pushes in behind your seat and shouts: '
      + '"Nobody touches the radio! This plane goes where I say now!" Stay calm. Keep flying. He is watching the windows, not the panel.',
    code: '2000',
    button: { label: 'Squawk 7500 secretly', key: '7', onPress: () => squawk(S.sim) },
  });
  objective(sim, H, 'Hijack!', 'Stay calm and keep flying. Secretly squawk 7500 — press 7 — so ATC knows without him hearing a word.');
}

/** What the transponder reads right now, for a card. */
function xpdr() {
  return H.squawked ? '7500' : '2000';
}

/**
 * Film: the ground knows now — from your 7500, or, if nobody pressed 7 in
 * fifty seconds, from the cabin crew's phone call. Either way the story goes
 * on; the squawk is still there to press, and still worth the most points.
 */
function startOrders(sim, how = 'squawk') {
  setPhase('orders');
  const cs = callsign(sim);
  const f = field();
  if (how === 'crew') {
    H.crewCalled = true;
    UI.showCard(sim, {
      who: 'Cabin crew',
      tone: 'info',
      icon: 'phone',
      code: '2000',
      button: { label: 'Squawk 7500 now', key: '7', onPress: () => squawk(S.sim) },
      text: 'Good news: the cabin crew have phoned the airline from the back, so the ground knows. You can still squawk 7500 — press 7 — and every radar screen will see it too.',
    });
    after(H, 5, (s) => speak(s, `${cs}, ${f} Approach. Your company has called us. We are with you.`, 'approach'));
  } else {
    UI.showCard(sim, {
      who: 'Transponder',
      tone: 'info',
      icon: 'xpdr',
      code: xpdr(),
      alert: H.squawked,
      text: '7500 is in. He did not notice a thing. On a radar screen on the ground, your aeroplane has just turned a different colour.',
    });
    after(H, 3.5, (s) => speak(s, `${cs}, ${f} Approach, verify squawking seven five zero zero.`, 'approach'));
    after(H, 6, (s) => {
      if (H.phase !== 'orders') return;
      UI.showCard(s, {
        who: 'Say nothing',
        tone: 'warn',
        code: xpdr(),
        alert: H.squawked,
        text: 'ATC is checking your code. Real pilots in your seat say nothing at all — when nobody answers, ATC knows the trouble is real. And he never hears a thing.',
      });
    });
    after(H, 13, (s) => {
      if (!hijackActive()) return;
      speak(s, `${cs}, roger. We are with you.`, 'approach');
    });
  }
  after(H, 16, (s) => {
    if (H.phase !== 'orders' && H.phase !== 'approach') return;
    SFX.grumble(s, 10);
    UI.showCard(s, {
      who: 'The hijacker',
      tone: 'bad',
      text: `"You! Turn around. Take it down to that island — ${f}. Land on the runway. And no tricks!"`,
      code: xpdr(),
      alert: H.squawked,
      // Still not squawked: the button stays on the card while he talks.
      button: H.squawked ? null : { label: 'Squawk 7500 secretly', key: '7', onPress: () => squawk(S.sim) },
    });
    objective(s, H, 'Do what he says', `Turn towards ${f} and start down to 3,000 feet. Follow the arrow to the runway.`);
    H.guideOn = true;
  });
  after(H, 26, (s) => {
    if ((H.phase === 'orders' || H.phase === 'approach') && s.aircraft && !s.aircraft.onGround) spawnEscorts(s, 'shadow');
  });
}

function updateFilmAir(sim, dt) {
  const ac = sim.aircraft;
  if (H.phase === 'burst') {
    H.hintT += dt;
    if (H.hintT > 20) {
      H.hintT = 0;
      SFX.grumble(sim, 6);
      notify(sim, 'He is not looking — press 7 (or tap the button) to squawk 7500', 'info', 5);
    }
    /*
     * Nobody pressed 7. The story used to wait here for ever — the man
     * shouting, the card up, the hint every twenty seconds and nothing else
     * — which on a touch screen with the card missed is simply the end of the
     * game. The cabin crew phone the airline from the back instead, which is
     * also real, and the story goes on; the squawk is still there to press
     * and still worth points.
     */
    if (H.phaseT > 45) startOrders(sim, 'crew');
  }
  // Guidance: the approach gate for the main runway, then the runway.
  filmGuide(sim);
  heightCoach(sim, dt);
  if (H.phase === 'orders' && flat(ac.pos, RUNWAY.touchdown) < 9500 && H.guideOn) {
    setPhase('approach');
    SFX.grumble(sim, 5);
    UI.showCard(sim, {
      who: 'The hijacker',
      tone: 'bad',
      text: '"Down! Put it on the runway. Now!"',
      code: xpdr(),
      alert: H.squawked,
    });
    speak(sim, `${callsign(sim)}, runway ${runwayWords()}, cleared to land. Everything is ready for you.`, 'tower');
    objective(sim, H, 'Land', `Line up with runway ${runwayNumberFor(RUNWAY.headingDeg ?? 90)} and land. Gear down, flaps down, follow the PAPI lights.`);
  }
  // The shadowing jets.
  if (H.escorts.length) {
    const w = span(sim);
    let formed = true;
    for (const e of H.escorts) {
      e.update(dt, ac, w, sim.weather);
      if (!e.formed) formed = false;
    }
    if (!H.shadowSaid && formed) {
      H.shadowSaid = true;
      speak(sim, `${callsign(sim)}, two friends are right behind you. We will stay out of sight.`, VOICE_FIGHTER);
      UI.showCard(sim, {
        who: 'Look behind you',
        tone: 'good',
        text: 'Hold B to look behind. Two fighter jets are tucked in low under your tail — the one place he cannot see from the cockpit. They will stay with you all the way down.',
        code: xpdr(),
        alert: H.squawked,
      });
      /*
       * The one moment the film version holds its breath. Once the jets are
       * in, the flight to the island was three quiet minutes of following an
       * arrow: nothing in it used the thing the whole scene is built on —
       * that he must not see them. So, twenty seconds later, he nearly does.
       * Words and a sound, nothing more; and the jets sink out of sight.
       */
      after(H, 20, (s) => peek(s));
    }
    if (!H.escortBroke) {
      const d = flat(ac.pos, RUNWAY.touchdown);
      if ((d < 6000 && ac.agl < 450) || ac.onGround) {
        H.escortBroke = true;
        for (const e of H.escorts) e.setMode('break');
        notify(sim, 'The fighter jets peel away — the police will take it from here', 'good', 4);
      }
    }
    dropGone(H.escorts);
  }
}

/** Film: he leans over to the side window. The jets duck; he decides it was birds. */
function peek(sim) {
  if (H.peeked || (H.phase !== 'orders' && H.phase !== 'approach') || H.escortBroke) return;
  if (!sim.aircraft || sim.aircraft.onGround) return;
  H.peeked = true;
  SFX.grumble(sim, 6);
  for (const e of H.escorts) if (!e.gone) e.duck = 1;
  UI.showCard(sim, {
    who: 'The hijacker',
    tone: 'bad',
    code: xpdr(),
    alert: H.squawked,
    text: 'He presses his face to the side window. "What was that? Something flashed out there!" Keep the wings level and look straight ahead. Behind you, the two jets sink lower under your tail.',
  });
  after(H, 7, (s) => {
    for (const e of H.escorts) if (!e.gone) e.duck = 0;
    if (!hijackActive() || H.escortBroke) return;
    SFX.grumble(s, 3);
    UI.showCard(s, {
      who: 'Phew',
      tone: 'warn',
      code: xpdr(),
      alert: H.squawked,
      text: '"...Birds," he mutters, and turns back to the front. He did not see them. Keep going — the island is ahead.',
      ttl: 10,
    });
  });
}

const GATE = new THREE.Vector3();

function filmGuide(sim) {
  if (!H.guideOn) return;
  const ac = sim.aircraft;
  runwayFrame();
  const td = RUNWAY.touchdown;
  GATE.copy(td).addScaledVector(RW.f, -6500);
  GATE.y = Math.max(td.y + 450, heightAt(GATE.x, GATE.z) + 300);
  // The gate first, unless you are already lined up and close.
  const along = (ac.pos.x - td.x) * RW.f.x + (ac.pos.z - td.z) * RW.f.z;
  const cross = Math.abs((ac.pos.x - td.x) * RW.r.x + (ac.pos.z - td.z) * RW.r.z);
  const lined = along < -300 && along > -9000 && cross < Math.max(400, -along * 0.25);
  // Once through the gate (or lined up), the runway — and it stays the
  // runway, or the arrow would swing back to the gate behind you.
  if (lined || flat(ac.pos, GATE) < 1500) H.onApproach = true;
  if (H.onApproach) {
    setGuide(sim, td, `${field()} runway ${runwayNumberFor(RUNWAY.headingDeg ?? 90)}`);
  } else {
    setGuide(sim, GATE, `Line up for runway ${runwayNumberFor(RUNWAY.headingDeg ?? 90)}`);
  }
}

/* ================================================================== *
 * THE BY-THE-BOOK VERSION
 * ================================================================== */

function startDoor(sim) {
  setPhase('door');
  SFX.chime3(sim);
  after(H, 1.9, (s) => SFX.buzzer(s));
  after(H, 3.2, (s) => SFX.doorBang(s, 4));
  after(H, 4.6, (s) => SFX.grumble(s, 7));
  banner(sim, 'Flight deck door', 'Somebody is trying to get in', 'bad', 5);
  ask(sim, {
    who: 'Cabin crew — interphone',
    tone: 'bad',
    icon: 'phone',
    text:
      '(whispering) "Flight deck, it is Sam at the back. A passenger has pushed into the rear galley and taken our interphone. '
      + 'He is demanding you open the flight deck door. He is not crew." Now the door buzzer is going.',
    choices: [
      { key: '8', label: 'Keep the door LOCKED' },
      { key: '9', label: 'Open the door' },
    ],
    onChoice: (i) => answerDoor(S.sim, i),
  }, 25, 0);
  objective(sim, H, 'Someone at the door', 'Choose on the card: 8 keeps the flight deck door locked, 9 opens it.');
}

function answerDoor(sim, i) {
  H.pending = null;
  if (H.phase !== 'door' || H.answers.door != null) return;
  H.answers.door = i;
  H.answeredN++;
  if (i === 0) {
    // Left to answer itself, the door did what it is built to do: nothing.
    H.pts.door = H.timedOut ? 6 : 10;
    H.stars.push('Kept the flight deck door locked');
    UI.showCard(sim, {
      who: 'Door: LOCKED',
      tone: 'good',
      icon: 'door',
      text: (H.timedOut ? 'You did not open it — and that is the rule: whatever anybody says on the other side, this door stays shut. ' : '')
        + 'The banging goes on, but this door is built for exactly this, and it is staying shut. He may be listening on the interphone — so whatever you tell ATC, you cannot say it out loud.',
      code: H.squawked ? '7500' : '2000',
      alert: H.squawked,
    });
  } else {
    H.pts.door = 0;
    UI.showCard(sim, {
      who: 'No!',
      tone: 'warn',
      icon: 'door',
      text: 'The first rule: the flight deck door stays locked, whatever anybody says on the other side of it. Your first officer stops your hand. The door is still LOCKED.',
      code: H.squawked ? '7500' : '2000',
      alert: H.squawked,
    });
  }
  after(H, 6, (s) => {
    if (H.phase !== 'door') return;
    if (H.squawked) startVerify(s);
    else startSquawk(s);
  });
}

function startSquawk(sim) {
  setPhase('squawk');
  UI.showCard(sim, {
    who: 'Say it without talking',
    tone: 'warn',
    icon: 'xpdr',
    text: 'You cannot talk freely: he might hear. So let the transponder say it. 7500 means "unlawful interference" — every radar screen that can see you will show it.',
    code: '2000',
    button: { label: 'Squawk 7500', key: '7', onPress: () => squawk(S.sim) },
  });
  objective(sim, H, 'Squawk 7500', 'Press 7 (or tap the button). The transponder tells ATC without a word being said.');
}

/** Real: forty seconds and no 7 — the first officer sets it. Fewer points, same story. */
function firstOfficerSquawk(sim) {
  if (H.squawked) return;
  H.squawked = true;
  H.foSquawked = true;
  H.squawkAt = H.t;
  H.pts.squawk = 3;
  SFX.blip(sim);
  UI.showCard(sim, {
    who: 'First officer',
    tone: 'info',
    icon: 'xpdr',
    code: '7500',
    alert: true,
    text: 'Your first officer reaches across and quietly dials in 7500. There are two pilots on a flight deck so that one can do this while the other flies.',
  });
  after(H, 5, (s) => {
    if (H.phase === 'squawk') startVerify(s);
  });
}

function startVerify(sim) {
  setPhase('verify');
  const cs = callsign(sim);
  const f = field();
  UI.showCard(sim, {
    who: 'Transponder',
    tone: 'info',
    icon: 'xpdr',
    code: '7500',
    alert: true,
    text: '7500 is set. Now listen to the radio.',
  });
  objective(sim, H, 'Listen to ATC', 'ATC has seen your code. Keep flying, and answer on the card.');
  after(H, 2.5, (s) => speak(s, `${cs}, ${f} Approach, verify squawking seven five zero zero.`, 'approach'));
  after(H, 5.5, (s) => {
    if (H.phase !== 'verify') return;
    ask(s, {
      who: `${f} Approach`,
      tone: 'warn',
      icon: 'xpdr',
      code: '7500',
      alert: true,
      text: '"Verify squawking seven five zero zero." ATC wants to know the code is not a mistake. What do you do?',
      choices: [
        { key: '8', label: 'Say nothing' },
        { key: '9', label: 'Say "Affirmative, seven five zero zero"' },
        { key: '0', label: 'Set the transponder back to 2000' },
      ],
      onChoice: (i) => answerVerify(S.sim, i),
    }, 25, 0);
  });
}

function answerVerify(sim, i) {
  H.pending = null;
  if (H.phase !== 'verify' || H.answers.verify != null) return;
  H.answers.verify = i;
  H.answeredN++;
  const cs = callsign(sim);
  if (i === 0) {
    H.pts.verify = 10;
    H.stars.push('Said nothing when ATC checked');
    UI.showCard(sim, {
      who: 'Silence is an answer',
      tone: 'good',
      code: '7500',
      alert: true,
      text: (H.timedOut ? 'You said nothing — which is exactly right. ' : '')
        + 'When a pilot squawking 7500 does not answer, ATC treats it as real — and does not ask again. Nothing for him to overhear.',
    });
    after(H, 3, (s) => speak(s, `${cs}, roger. No reply needed. We are with you.`, 'approach'));
  } else if (i === 1) {
    H.pts.verify = 8;
    H.stars.push('Confirmed 7500 in three words');
    speak(sim, 'Affirmative, seven five zero zero.', VOICE_CAPTAIN);
    UI.showCard(sim, {
      who: 'That works too',
      tone: 'good',
      code: '7500',
      alert: true,
      text: '"Affirmative" tells ATC it is real. Quick and quiet — and ATC will not ask any more questions out loud.',
    });
    after(H, 4, (s) => speak(s, `${cs}, roger. No further questions. We are with you.`, 'approach'));
  } else {
    H.pts.verify = 0;
    UI.showCard(sim, {
      who: 'Careful!',
      tone: 'warn',
      code: '7500',
      alert: true,
      text: 'Setting it back would tell ATC the 7500 was a slip of the finger — and nobody would come. Your first officer puts 7500 straight back in.',
    });
    after(H, 4, (s) => speak(s, `${cs}, we see seven five zero zero again. Understood. We are with you.`, 'approach'));
  }
  after(H, 9.5, (s) => {
    if (H.phase !== 'verify') return;
    speak(s, `${cs}, if you can hear me, click your microphone twice.`, 'approach');
  });
  after(H, 12, (s) => {
    if (H.phase !== 'verify') return;
    ask(s, {
      who: 'Answer in code',
      tone: 'info',
      code: '7500',
      alert: true,
      text: 'You can press the radio button without saying anything. ATC hears a click. Two clicks means YES.',
      choices: [
        { key: '8', label: 'Click twice (yes)' },
        { key: '9', label: 'Click once' },
      ],
      onChoice: (k) => answerClick(S.sim, k),
    }, 20, 0);
  });
}

function answerClick(sim, i) {
  H.pending = null;
  if (H.phase !== 'verify' || H.answers.click != null) return;
  H.answers.click = i;
  H.answeredN++;
  const cs = callsign(sim);
  // Left alone, nobody pressed anything: no clicks at all.
  const none = H.timedOut;
  if (!none) SFX.micClick(sim, i === 0 ? 2 : 1);
  if (none) {
    H.pts.click = 1;
    after(H, 1.6, (s) => speak(s, `${cs}, no reply. We understand you cannot talk. Two fighters are on their way up to you. Do as you are told for now.`, 'approach'));
  } else if (i === 0) {
    H.pts.click = 5;
    H.stars.push('Answered ATC with two clicks');
    after(H, 1.6, (s) => speak(s, `Two clicks. Understood, ${cs}. Two fighters are on their way up to you. Do as you are told for now.`, 'approach'));
  } else {
    H.pts.click = 2;
    after(H, 1.6, (s) => speak(s, `One click. We will take that as a yes, ${cs}. Two fighters are on their way up to you. Do as you are told for now.`, 'approach'));
  }
  UI.showCard(sim, {
    who: 'Radio',
    tone: 'info',
    code: '7500',
    alert: true,
    text: none
      ? 'No clicks — but ATC already has your 7500, and silence tells them the rest.'
      : i === 0 ? 'Click. Click. ATC heard you.' : 'Click. One is not quite the code — but ATC works it out.',
    ttl: 6,
  });
  after(H, 4, (s) => {
    if (s.aircraft && !s.aircraft.onGround) spawnEscorts(s, 'trail');
  });
  after(H, 7, (s) => {
    if (H.phase === 'verify') startOrdersReal(s);
  });
}

function startOrdersReal(sim) {
  setPhase('orders');
  const ac = sim.aircraft;
  // Away from the island: the direction from the field to you, onwards.
  runwayFrame();
  let away = bearing(RW.c, ac.pos);
  if (flat(ac.pos, RW.c) < 2500) away = (ac.heading + 180) % 360;
  H.orderHdg = Math.round(away / 10) * 10 % 360 || 360;
  const hdg = headingNumber(H.orderHdg);
  SFX.chime(sim);
  after(H, 0.8, (s) => SFX.grumble(s, 11, true));
  UI.showCard(sim, {
    who: 'Interphone — the hijacker',
    tone: 'bad',
    icon: 'phone',
    code: '7500',
    alert: true,
    /*
     * Not "we are going to the mainland": that is where the flight was going
     * anyway (the mission says so), and the first version had him order the
     * aeroplane round to the place it was already flying to. He wants it
     * somewhere else, and he wants the radio to think nothing has changed —
     * which is what askRadio() is about.
     */
    text: `"Pilot. I know you can hear me. Turn this plane around — heading ${hdg}. We are not going to the mainland any more. Nobody says anything on that radio unless I say so. No tricks."`,
  });
  objective(sim, H, 'Do as he says — for now', `Turn onto heading ${hdg}, away from the island. Keep calm and keep flying: help is coming.`);
  H.guideOn = true;
  after(H, 8, (s) => askRadio(s));
}

/*
 * The radio call he makes you give.
 *
 * You cannot talk freely, but you can talk: he wants the radio told that
 * everything is normal, and a crew in this spot says exactly that — in
 * words that sound normal to him and are not normal to the ground. Real
 * airlines agree phrases like this privately with the people on the ground
 * and never publish them, so the one here is made up for the game: "the
 * coffee is cold". It is on the card before the question, so a child who
 * has never heard of such a thing has it in front of them when it counts.
 */
const CODE_PHRASE = 'the coffee is cold';

function askRadio(sim) {
  if (H.phase !== 'orders' || H.radioAsked) return;
  H.radioAsked = true;
  SFX.chime(sim);
  after(H, 0.7, (s) => SFX.grumble(s, 7, true));
  ask(sim, {
    who: 'Interphone — the hijacker',
    tone: 'bad',
    icon: 'phone',
    code: '7500',
    alert: true,
    text: `"Now tell them on the radio that everything is normal. Tell them we are still going to the mainland. Nothing else!" `
      + `(Your airline's secret phrase for "we are in trouble" is "${CODE_PHRASE}". ATC knows it. He does not. Keep flying heading ${headingNumber(H.orderHdg)}.)`,
    choices: [
      { key: '8', label: `"All normal, still going to the mainland — and ${CODE_PHRASE} today."` },
      { key: '9', label: '"All normal, still going to the mainland." Exactly what he said.' },
      { key: '0', label: '"Help! We have been hijacked!"' },
    ],
    onChoice: (i) => answerRadio(S.sim, i),
  }, 25, 1);
}

function answerRadio(sim, i) {
  H.pending = null;
  if (H.radioDone) return;
  H.radioDone = true;
  // ATC's answer comes five seconds later; the jets wait until it has.
  H.radioAt = H.t;
  H.answers.radio = i;
  H.answeredN++;
  const cs = callsign(sim);
  const f = field();
  if (i === 0 && !H.timedOut) {
    H.pts.radio = 10;
    H.stars.push(`Told ATC in code: "${CODE_PHRASE}"`);
    speak(sim, `${f} Approach, ${cs}. All normal, still going to the mainland. And ${CODE_PHRASE} today.`, VOICE_CAPTAIN);
    after(H, 5, (s) => speak(s, `${cs}, roger, the mainland. Sorry to hear about the coffee. We will get you a fresh one.`, 'approach'));
    UI.showCard(sim, {
      who: 'Said in code',
      tone: 'good',
      icon: 'phone',
      code: '7500',
      alert: true,
      text: 'To him it sounded like nothing. To ATC it said everything. "Sorry to hear about the coffee" means: understood, help is coming.',
    });
  } else if (i === 2 && !H.timedOut) {
    H.pts.radio = 2;
    H.tension = Math.min(1, H.tension + 0.2);
    speak(sim, `${f} Approach, ${cs}, help, we have been hijacked!`, VOICE_CAPTAIN, 1);
    after(H, 4, (s) => speak(s, `${cs}, we know. Stay calm. Help is already on the way.`, 'approach'));
    after(H, 0.4, (s) => SFX.doorBang(s, 4));
    after(H, 0.3, (s) => SFX.grumble(s, 9, true));
    UI.showCard(sim, {
      who: 'He heard that',
      tone: 'warn',
      icon: 'phone',
      code: '7500',
      alert: true,
      text: 'ATC already knew from your 7500 — and now he is banging on the door and shouting. Saying it out loud told the ground nothing new and made him angrier.',
    });
  } else {
    H.pts.radio = 5;
    speak(sim, `${f} Approach, ${cs}. All normal, still going to the mainland.`, VOICE_CAPTAIN);
    after(H, 5, (s) => speak(s, `${cs}, roger, the mainland.`, 'approach'));
    UI.showCard(sim, {
      who: 'Radio',
      tone: 'info',
      icon: 'phone',
      code: '7500',
      alert: true,
      text: (H.timedOut ? 'Your first officer makes the call for you, word for word. ' : '')
        + 'Exactly what he wanted. That is fine — ATC already has your 7500. (The secret phrase would have told them more without him noticing.)',
    });
  }
}

function startIntercept(sim) {
  setPhase('intercept');
  if (!H.escorts.length) spawnEscorts(sim, 'trail');
  H.lead = H.escorts.find((e) => e.side < 0) || H.escorts[0] || null;
  H.wing = H.escorts.find((e) => e !== H.lead) || null;
  if (H.lead) {
    H.lead.leadHeading = sim.aircraft.heading;
    H.lead.setMode('lead');
  }
  if (H.wing) H.wing.setMode('trail');
  const name = (escortType() && escortType().name) || 'fighter';
  speak(sim, `${callsign(sim)}, Guardian lead. Two ${name}s. Joining you on your left.`, VOICE_FIGHTER);
  notify(sim, 'Fighter jets are joining you — look out to the left', 'info', 5);
}

function updateIntercept(sim, dt) {
  const ac = sim.aircraft;
  const lead = H.lead;
  if (!lead || lead.gone) {
    // No jet to follow (the model would not build, or it was switched off):
    // the story still has to go on.
    if (H.phaseT > 6) ack(sim, false);
    return;
  }
  lead.leadHeading = ac.heading;
  if (!lead.rock && lead.formed) {
    lead.rock = true;
    H.rockT = 0;
    UI.showCard(sim, {
      who: 'Intercept signal',
      tone: 'warn',
      icon: 'rock',
      code: '7500',
      alert: true,
      text: 'The jet ahead and to your LEFT is rocking its wings. Every pilot in the world knows this one: "You have been intercepted. FOLLOW ME." Answer the same way — rock your wings: roll left, then right.',
    });
    objective(sim, H, 'Rock your wings', 'Answer the fighter: roll left, then right (A, then D) — about a quarter of the way over each way.');
  }
  if (!lead.rock) {
    // Still catching up. Measured, the join from two kilometres back takes
    // about forty seconds; well past that, carry on without the signal.
    if (H.phaseT > 75) ack(sim, false);
    return;
  }
  H.rockT += dt;
  // Rocking: both ways, within eight seconds of each other.
  const bank = ac.bankAngleDeg();
  if (bank < -12) {
    if (!H.rockL) H.rockWin = 0;
    H.rockL = true;
  }
  if (bank > 12) {
    if (!H.rockR) H.rockWin = 0;
    H.rockR = true;
  }
  if (H.rockL || H.rockR) H.rockWin += dt;
  if (H.rockWin > 8 && !(H.rockL && H.rockR)) {
    H.rockL = H.rockR = false;
    H.rockWin = 0;
  }
  if (H.rockL && H.rockR) {
    ack(sim, true);
    return;
  }
  H.hintT += dt;
  if (H.hintT > 14) {
    H.hintT = 0;
    notify(sim, 'Rock your wings to answer: roll left (A), then right (D)', 'info', 5);
  }
  // Never strand anybody on a signal they cannot manage (a touch screen,
  // a very heavy aeroplane): after half a minute the leader takes a steady
  // pair of wings as a yes.
  if (H.rockT > 30) ack(sim, false);
}

function ack(sim, rocked) {
  if (H.acked) return;
  H.acked = true;
  if (H.lead) H.lead.rock = false;
  if (rocked) {
    H.pts.intercept = 10;
    H.stars.push('Answered the intercept by rocking your wings');
  } else {
    H.pts.intercept = 3;
  }
  speak(sim, `${callsign(sim)}, Guardian lead. ${rocked ? 'We see you.' : 'We will take that as a yes.'} Follow me.`, VOICE_FIGHTER);
  UI.showCard(sim, {
    who: rocked ? 'Understood!' : 'Follow the jet',
    tone: 'good',
    icon: 'rock',
    code: '7500',
    alert: true,
    text: 'Now it makes a slow turn onto the way it wants you to go, and then starts down. Follow it: stay behind it and a little to its right, and go down when it does. It is taking you to a runway away from the terminal.',
  });
  startFollow(sim);
}

/**
 * Which runway the fighters take you to.
 *
 * The crosswind runway is the remote one — away from the terminal, which is
 * exactly where the police want an aeroplane like this. But it is short on
 * most maps (900 m at Kestrel, with rising ground a hundred metres past
 * either end; 300 m at the Stacks) and missing on some, and a forced
 * diversion that ends with a jumbo off the end of a strip it could never
 * have stopped on is not the lesson. So it is used when it is long enough
 * for the aeroplane: 1,100 m for anything the size of the Meridian (the
 * main runway's own length), 1,500 m for the big jets (more than 45 m of
 * wing). Otherwise the fighters bring you to the main runway, and the
 * remote stand is its far end.
 *
 * It was 850 m for the Meridian, which let it at Kestrel's 900 m strip.
 * Measured, full brakes and idle from touchdown, the Meridian rolls 546 m
 * from 52 m/s and 651 m from 58; the aiming point is 180 m in, so a landing
 * that floats 200 m — the pilot bot's did, and so will a child's — has no
 * runway left. The bot ran it off the end into the rising ground and
 * crashed on the last step of a ten-minute story. So at Kestrel the story
 * now uses the far end of the main runway; Ironhead, Gateway and Northwatch
 * have crosswind runways of 1,700 to 2,600 m, and those are still used.
 */
function remoteRunwayFits(sim, R) {
  if (!R.real) return false;
  return R.L >= (span(sim) > 45 ? 1500 : 1100);
}

function chooseRemote(sim) {
  const ac = sim.aircraft;
  const R = secondRunway(H.rem);
  if (!remoteRunwayFits(sim, R)) {
    const h = RUNWAY.headingDeg ?? 90;
    R.headingDeg = h;
    R.L = RUNWAY.length || 1100;
    R.c.set(RUNWAY.cx ?? 0, RUNWAY.elev ?? 14, RUNWAY.cz ?? 0);
    R.f.set(Math.sin(h * Math.PI / 180), 0, -Math.cos(h * Math.PI / 180));
    R.real = false;
    // Always the runway's own direction here: the aiming point, the PAPI and
    // the approach everybody has practised all assume it.
    H.landDir.copy(R.f);
    H.landHdg = h;
    H.thr.copy(RUNWAY.thresholdWest);
    H.td.copy(RUNWAY.touchdown);
    H.gate.copy(H.thr).addScaledVector(H.landDir, -7000);
    H.gate.y = Math.max(H.thr.y + 400, heightAt(H.gate.x, H.gate.z) + 300);
    H.remoteName = `runway ${runwayNumberFor(h)} — right to its far end`;
    H.remoteReady = true;
    return;
  }
  // Land towards the far side: come in from whichever end you are nearer.
  const side = (ac.pos.x - R.c.x) * R.f.x + (ac.pos.z - R.c.z) * R.f.z;
  const dir = side > 0 ? -1 : 1;
  H.landDir.copy(R.f).multiplyScalar(dir);
  H.landHdg = (R.headingDeg + (dir < 0 ? 180 : 0)) % 360;
  H.thr.copy(R.c).addScaledVector(H.landDir, -R.L / 2);
  H.thr.y = heightAt(H.thr.x, H.thr.z);
  H.td.copy(H.thr).addScaledVector(H.landDir, Math.min(200, R.L * 0.2));
  H.td.y = heightAt(H.td.x, H.td.z);
  H.gate.copy(H.thr).addScaledVector(H.landDir, -7000);
  H.gate.y = Math.max(H.thr.y + 400, heightAt(H.gate.x, H.gate.z) + 300);
  H.remoteName = `runway ${runwayNumberFor(H.landHdg)}, the remote runway`;
  H.remoteReady = true;
}

function startFollow(sim) {
  setPhase('follow');
  chooseRemote(sim);
  H.round = -1;
  after(H, 6, (s) => nextRound(s));
}

/* The conversation over the interphone. Three things he says; three ways to answer each. */
const TALK = [
  {
    him: '"Why are we turning? I told you where to go! What are those jets doing?"',
    options: [
      { key: '8', label: '"Those are fighter jets. They are telling us where to go, and we have to follow them."', d: -0.15, reply: 'He goes quiet. He can see them out of the window too.' },
      { key: '9', label: '"We are not going anywhere with you!"', d: 0.2, reply: 'He shouts and bangs on the door again. The door holds — but shouting back never calms anybody down.' },
      { key: '0', label: '"Jets? What jets?"', d: 0.1, reply: '"Don\'t lie to me! I can see them!" Now he trusts you less.' },
    ],
  },
  {
    him: '"Tell them to go away! Turn around, NOW!"',
    options: [
      { key: '8', label: '"We do not have the fuel to go where you want. We have to land soon, on the island."', d: -0.25, reply: 'A long silence. Then, quietly: "...Not enough fuel?" He is thinking about it.' },
      { key: '9', label: '"I can\'t do that."', d: 0.1, reply: '"Can\'t, or won\'t?!" He is getting angrier.' },
      { key: '0', label: '"Okay, okay." (and keep following the jet)', d: 0, reply: 'That calms him for a moment — until he notices the plane is not turning round.' },
    ],
  },
  {
    him: '"...So what happens when we land?"',
    options: [
      { key: '8', label: '"We land, we stop, and you talk to the people on the ground. Nobody gets hurt."', d: -0.3, reply: '"...Okay. Land it. But no tricks." He hangs up the interphone.' },
      { key: '9', label: '"You are going to be arrested!"', d: 0.15, reply: 'True — but not the thing to say right now. He starts shouting again.' },
      { key: '0', label: 'Say nothing.', d: 0.05, reply: 'He waits. Nothing. He slams the handset down.' },
    ],
  },
];

const SILENCE = { key: '', label: '(You say nothing.)', d: 0.05, reply: 'He waits for an answer, gets none, and carries on shouting.' };

function moodTone() {
  return H.tension < 0.35 ? 'good' : H.tension < 0.65 ? 'warn' : 'bad';
}

function moodWord() {
  return H.tension < 0.2 ? 'Calm' : H.tension < 0.45 ? 'Calmer' : H.tension < 0.7 ? 'Tense' : 'Angry';
}

function showMood(sim) {
  UI.showMeter(sim, { label: 'His mood', value: H.tension, text: moodWord(), tone: moodTone() });
}

function nextRound(sim) {
  if (!AIRBORNE.real.has(H.phase) || H.talked) return;
  // Give the "land here" card time to be read before he talks over it.
  if (H.landSignal && !H.gearAck && H.landSigT < 10) {
    after(H, 10.5 - H.landSigT, (s) => nextRound(s));
    return;
  }
  H.round++;
  const r = TALK[H.round];
  if (!r) {
    finishTalk(sim);
    return;
  }
  SFX.chime(sim);
  after(H, 0.7, (s) => SFX.grumble(s, 8, true));
  showMood(sim);
  ask(sim, {
    who: 'Interphone — the hijacker',
    tone: 'bad',
    icon: 'phone',
    code: '7500',
    alert: true,
    text: r.him,
    choices: r.options.map((o) => ({ key: o.key, label: o.label })),
    onChoice: (i) => answerRound(S.sim, H.round, i),
  }, 20, 2);
  if (H.phase === 'follow') objective(sim, H, 'Follow the jet — and talk', 'Keep following the lead fighter, and go down when it does. Pick your words on the card: calm and true works best.');
}

function answerRound(sim, round, i) {
  H.pending = null;
  if (round !== H.round || H.answers[`talk${round}`] != null) return;
  const r = TALK[round];
  // Left unanswered, it is silence — not whichever answer happens to be
  // third on the card, which in the first round is a lie.
  const o = H.timedOut ? SILENCE : r && r.options[i];
  if (!o) return;
  H.answers[`talk${round}`] = i;
  H.answeredN++;
  H.tension = Math.max(0, Math.min(1, H.tension + o.d));
  showMood(sim);
  UI.showCard(sim, {
    who: 'Interphone',
    tone: o.d < 0 ? 'good' : o.d > 0.05 ? 'warn' : 'info',
    icon: 'phone',
    code: '7500',
    alert: true,
    text: `You: ${o.label} — ${o.reply}`,
  });
  if (o.d > 0.05) {
    after(H, 0.3, (s) => SFX.doorBang(s, 3));
    after(H, 0.2, (s) => SFX.grumble(s, 6, true));
  }
  after(H, 11, (s) => nextRound(s));
}

function finishTalk(sim) {
  if (H.talked) return;
  H.talked = true;
  H.pts.talk = Math.round((1 - H.tension) * 15);
  if (H.tension < 0.35) H.stars.push('Talked him down — calm and true');
  UI.showCard(sim, {
    who: 'Interphone',
    tone: H.tension < 0.35 ? 'good' : 'warn',
    icon: 'phone',
    code: '7500',
    alert: true,
    text: H.tension < 0.35
      ? 'He has stopped shouting. Calm words and true ones — that is what the people who do this for real are taught.'
      : 'He is still angry. But the door is locked, the jets are with you, and the aeroplane is yours to fly.',
    ttl: 12,
  });
  after(H, 12, () => UI.hideMeter());
}

function updateFollow(sim, dt) {
  const ac = sim.aircraft;
  // Where the leader wants to go: the gate, then down the centreline.
  const along = (ac.pos.x - H.thr.x) * H.landDir.x + (ac.pos.z - H.thr.z) * H.landDir.z;
  const cross = (ac.pos.x - H.thr.x) * -H.landDir.z + (ac.pos.z - H.thr.z) * H.landDir.x;
  const hdgOff = Math.abs(angleDiff(ac.heading, H.landHdg));
  /*
   * On the approach: in the box in front of the runway AND pointing roughly
   * down it. It used to be "within 2.5 km of the gate", whatever the
   * heading, and the release had no heading test either — the pilot bot
   * was waved off to land 4.7 km out, 1.2 km off the centre line, heading
   * 204 for runway 09. And an aeroplane that leaves the box (overshoots the
   * centre line, turns away) is led round to the gate again instead of
   * being left to it.
   */
  const inBox = along > -9500 && along < -1200 && Math.abs(cross) < 1500 && hdgOff < 70;
  const outOfBox = along > -800 || Math.abs(cross) > 2200 || hdgOff > 110;
  if (!H.onApproach && inBox) {
    H.onApproach = true;
    speak(sim, `${callsign(sim)}, Guardian lead. Runway ${runwayWordsFor(H.landHdg)} ahead. That is the one.`, VOICE_FIGHTER);
  } else if (H.onApproach && (outOfBox || (flat(ac.pos, H.thr) < 2200 && (hdgOff > 30 || Math.abs(cross) > 400)))) {
    // Too close to line up from here, or wandered off: round again.
    H.onApproach = false;
    H.entryDone = false;
    speak(sim, `${callsign(sim)}, Guardian lead. Going round. Follow me.`, VOICE_FIGHTER);
  }
  /*
   * Off the approach, the leader goes first to an entry point 9.5 km out
   * and 1.5 km to whichever side you are on, and only then to the gate —
   * so you arrive at the gate turning in at thirty degrees or so, not
   * crossing it at ninety. Straight to the gate, the pilot bot arrived
   * heading 183 for runway 09, overshot, and circled the gate for eighty
   * seconds before it happened to point the right way.
   */
  if (!H.onApproach) {
    const side = cross >= 0 ? 1 : -1;
    H.entry.set(
      H.thr.x - H.landDir.x * 9500 - H.landDir.z * side * 1500,
      0,
      H.thr.z - H.landDir.z * 9500 + H.landDir.x * side * 1500,
    );
    if (!H.entryDone && flat(ac.pos, H.entry) < 1500) H.entryDone = true;
  }
  // The signal waits for a question on the card to be answered: its own card
  // would replace the question, and the question would then answer itself.
  if (H.onApproach && !H.landSignal && !H.pending) landSignal(sim);
  if (H.landSignal) {
    H.landSigT += dt;
    if (!H.gearAck && ac.gearDown) gearAnswered(sim, false);
  }
  let want;
  if (H.onApproach) {
    // A localiser in miniature: the runway heading, turned towards the
    // centreline in proportion to how far off it you are.
    const corr = Math.max(-30, Math.min(30, cross * 0.03));
    want = (H.landHdg - corr + 360) % 360;
  } else {
    want = bearing(ac.pos, H.entryDone ? H.gate : H.entry);
  }
  const lead = H.lead && !H.lead.gone ? H.lead : null;
  if (lead) {
    // A slow level turn — about standard rate, three degrees a second.
    const d = angleDiff(lead.leadHeading, want);
    lead.leadHeading = (lead.leadHeading + Math.max(-3 * dt, Math.min(3 * dt, d)) + 360) % 360;
    // And down: the leader flies the slope to the runway, so following it
    // is also how you lose the height (escort.js keeps it in sight).
    lead.leadAlt = wantHeight(sim);
    const off = Math.abs(angleDiff(ac.heading, lead.leadHeading));
    H.followAll += dt;
    if (off < 30) H.followT += dt;
    /*
     * Point where the leader is GOING, not at the leader. It sits ahead and
     * to the left, so steering straight at it (the arrow used to) settles
     * on a heading about 27 degrees left of its own for a 747 — a pursuit
     * curve that took the pilot bot round the gate instead of to it. A point
     * 1.5 km on down the leader's track is within a few degrees of its
     * heading; the distance shown is still to the jet itself.
     */
    const h = (lead.leadHeading * Math.PI) / 180;
    H.leadAim.set(lead.pos.x + Math.sin(h) * 1500, lead.pos.y, lead.pos.z - Math.cos(h) * 1500);
    setGuide(sim, H.leadAim, 'Follow the lead jet', null, lead.pos);
  } else {
    setGuide(sim, H.onApproach ? H.td : H.entryDone ? H.gate : H.entry, `Runway ${runwayNumberFor(H.landHdg)}`);
  }
  /*
   * Release: lined up, the "land here" signal answered (or given long
   * enough ago), the talking done — or simply close. The wheels come first
   * because the break-away is the last thing the jets do, and "you may
   * proceed" before "land here" has been answered would say the opposite of
   * what they are there for.
   */
  const dThr = flat(ac.pos, H.thr);
  const answered = H.gearAck || H.landSigT > 20;
  const lined = hdgOff < 25 && Math.abs(cross) < 500;
  if (H.onApproach && lined && ((answered && H.talked && dThr < 6500) || dThr < 3800)) startRelease(sim);
}

/**
 * ICAO Annex 2, Appendix 2, Series 3: the interceptor lowers its wheels and
 * flies the runway in the direction of landing — "land at this aerodrome".
 * The intercepted aeroplane answers by lowering its own: "understood, will
 * comply". Nobody ten years old knows that, so the card says it.
 */
function landSignal(sim) {
  if (H.landSignal) return;
  H.landSignal = true;
  H.landSigT = 0;
  const lead = H.lead && !H.lead.gone ? H.lead : null;
  if (lead) lead.setGear(true);
  if (sim.aircraft.gearDown) {
    // Already down — which answers it. Say so rather than ask for a key
    // that would put them up.
    gearAnswered(sim, true);
    return;
  }
  UI.showCard(sim, {
    who: 'Intercept signal',
    tone: 'warn',
    icon: 'gear',
    code: '7500',
    alert: true,
    text: `The lead jet has put its WHEELS DOWN over runway ${runwayNumberFor(H.landHdg)}. That signal means "LAND AT THIS AERODROME". Answer the same way: put your wheels down (G).`,
  });
  objective(sim, H, 'Wheels down', 'The lead jet lowered its wheels: "land here". Answer it — press G to put yours down, and keep following.');
}

function gearAnswered(sim, already) {
  if (H.gearAck) return;
  H.gearAck = true;
  H.pts.gear = 5;
  H.stars.push(already ? 'Wheels already down for "land here"' : 'Answered "land here" with your wheels');
  speak(sim, `${callsign(sim)}, Guardian lead. Wheels seen. Runway ${runwayWordsFor(H.landHdg)} is yours.`, VOICE_FIGHTER);
  if (H.pending) {
    // A question is up; do not take it off the screen.
    notify(sim, 'Wheels down: "understood, will comply"', 'good', 4);
    return;
  }
  UI.showCard(sim, {
    who: 'Understood, will comply',
    tone: 'good',
    icon: 'gear',
    code: '7500',
    alert: true,
    text: already
      ? `The lead jet has put its wheels down: "LAND AT THIS AERODROME". Yours are already down — that is the answer. Keep following it to runway ${runwayNumberFor(H.landHdg)}.`
      : `Wheels down — that is "understood, will comply" in the language of the sky. Keep following the jet to runway ${runwayNumberFor(H.landHdg)}.`,
  });
  if (H.phase === 'follow') objective(sim, H, 'Follow the jet in', `Keep behind the lead jet. It is taking you to runway ${runwayNumberFor(H.landHdg)}.`);
}

function startRelease(sim) {
  if (H.released) return;
  H.pending = null;
  H.released = true;
  setPhase('final');
  if (!H.talked) {
    // Landing comes first; the rest of the talking can wait.
    H.talked = true;
    H.pts.talk = Math.round((1 - H.tension) * 15);
    UI.hideMeter();
  }
  if (H.followAll > 0) {
    const share = H.followT / H.followAll;
    H.pts.follow = Math.round(Math.min(1, share / 0.8) * 10);
    if (share > 0.6) H.stars.push('Followed the fighters all the way in');
  }
  for (const e of H.escorts) {
    if (e.gone) continue;
    e.setMode('breakaway');
    // Wheels up as they go: the "land here" is done with.
    e.setGear(false);
  }
  const num = runwayNumberFor(H.landHdg);
  UI.showCard(sim, {
    who: 'Intercept signal',
    tone: 'good',
    icon: 'breakaway',
    code: '7500',
    alert: true,
    text: H.rem.real
      ? `Both jets pull up and turn hard away from you. That is the signal for "YOU MAY PROCEED". They have brought you to runway ${num}, the remote runway, away from the terminal. Land on it.`
      : `Both jets pull up and turn hard away from you. That is the signal for "YOU MAY PROCEED". They have brought you to runway ${num}. Land, and roll right to its far end, away from the terminal: that is your remote stand.`,
  });
  speak(sim, `${callsign(sim)}, Guardian lead. You may proceed. Good luck, Captain.`, VOICE_FIGHTER);
  after(H, 6, (s) => {
    if (H.phase !== 'final') return;
    speak(s, H.rem.real
      ? `${callsign(s)}, ${field()} Tower, runway ${runwayWordsFor(H.landHdg)}, cleared to land. After landing, stop on the runway and shut down your engines. That runway is your remote stand.`
      : `${callsign(s)}, ${field()} Tower, runway ${runwayWordsFor(H.landHdg)}, cleared to land. Roll to the far end, stop, and shut down your engines. The far end is your remote stand.`, 'tower');
  });
  objective(sim, H, H.rem.real ? 'Land on the remote runway' : 'Land, and roll to the far end', H.rem.real
    ? `Runway ${num}, away from the terminal. Gear down, and follow the arrow.`
    : `Runway ${num}. Gear down, follow the arrow, and roll right to the far end.`);
}

function updateRealAir(sim, dt) {
  const ac = sim.aircraft;
  if (H.phase === 'door') {
    H.hintT += dt;
    if (H.hintT > 18) {
      H.hintT = 0;
      SFX.buzzer(sim);
      SFX.doorBang(sim, 3);
    }
  } else if (H.phase === 'squawk') {
    H.hintT += dt;
    if (H.hintT > 20) {
      H.hintT = 0;
      notify(sim, 'Press 7 (or tap the button) to squawk 7500', 'info', 5);
    }
    // Nobody pressed it: two pilots on a flight deck, and the other one does.
    if (H.phaseT > 40 && !H.squawked) firstOfficerSquawk(sim);
  } else if (H.phase === 'orders') {
    const off = angleDiff(ac.heading, H.orderHdg);
    setGuide(sim, null, `Heading ${headingNumber(H.orderHdg)} — as he says`, off);
    H.hintT = Math.abs(off) < 25 ? H.hintT + dt : 0;
    /*
     * The jets come once you are on his heading AND the radio call he wanted
     * is made — or after a minute and a bit whatever, so a child who cannot
     * find the heading is not left flying out to sea on their own.
     */
    const radioOver = H.radioDone && H.t - H.radioAt > 8;
    if (((H.hintT > 4 || H.phaseT > 45) && radioOver) || H.phaseT > 75) startIntercept(sim);
  } else if (H.phase === 'intercept') {
    updateIntercept(sim, dt);
    if (H.lead && !H.lead.gone) setGuide(sim, H.lead.pos, 'The fighter on your left');
  } else if (H.phase === 'follow') {
    updateFollow(sim, dt);
    heightCoach(sim, dt);
  } else if (H.phase === 'final') {
    setGuide(sim, H.td, `Runway ${runwayNumberFor(H.landHdg)}`);
    heightCoach(sim, dt);
  }
  if (H.escorts.length) {
    const w = span(sim);
    for (const e of H.escorts) e.update(dt, ac, w, sim.weather);
    dropGone(H.escorts);
    if (H.lead && H.lead.gone) H.lead = null;
    if (H.wing && H.wing.gone) H.wing = null;
  }
}

/* ================================================================== *
 * Fighters
 * ================================================================== */

function spawnEscorts(sim, mode) {
  if (!hijackActive() || H.escorts.length) return;
  const type = escortType();
  for (const side of [-1, 1]) {
    const e = new Escort(sim.scene, side, type);
    e.placeBehind(sim.aircraft, 2200 + (side > 0 ? 200 : 0));
    e.setMode(mode);
    H.escorts.push(e);
  }
}

/** Take out the jets that have flown off, in place — no new array every frame. */
function dropGone(list) {
  let j = 0;
  for (let i = 0; i < list.length; i++) if (!list[i].gone) list[j++] = list[i];
  list.length = j;
}

/* ================================================================== *
 * Guidance, when there is no mission to put an arrow on the HUD
 * ================================================================== */

const EXT_TARGET = { owner: 'hijack', pos: new THREE.Vector3(), label: '' };

/**
 * Point somewhere: the chip under the card (only when this story owns the
 * flight — a mission has the HUD's own arrow), and `sim.extTarget` for the
 * game's arrow, rails and beacon. main.js does not read it today (it would
 * be one line after `this.activeTarget = this.runner.activeTarget();`:
 * fall back to `this.extTarget` when no mission has a target), so in Free
 * Flight the chip is the guidance, and it is enough on its own.
 * Pass `pos` null and `rel` to point along a heading instead.
 */
function setGuide(sim, pos, label, rel = null, distTo = null) {
  const ac = sim.aircraft;
  if (pos) {
    H.guide.copy(pos);
    H.guideOn = true;
    EXT_TARGET.pos.copy(pos);
    EXT_TARGET.label = label;
    sim.extTarget = EXT_TARGET;
  } else if (sim.extTarget === EXT_TARGET) {
    sim.extTarget = null;
  }
  H.guideLabel = label;
  // A mission has the HUD's own arrow for a place. A heading it cannot show,
  // so "fly 270, as he says" gets the chip whoever owns the flight.
  if (H.owner === 'mission' && pos) {
    UI.hideGuide();
    return;
  }
  // Four times a second is plenty for words on a card, and it keeps the
  // strings below from being built sixty times a second.
  if (H.uiT > 0) return;
  H.uiT = 0.25;
  let r = rel;
  let sub = '';
  if (pos) {
    r = angleDiff(ac.heading, bearing(ac.pos, pos));
    const km = flat(ac.pos, distTo || pos) / 1000;
    sub = km >= 1 ? `${km.toFixed(km < 10 ? 1 : 0)} km` : `${Math.round(km * 1000)} m`;
    // Which way is down, too: the arrow only ever said left or right, and a
    // jumbo that arrives at the runway 3,000 ft up has to go round.
    const want = wantHeight(sim);
    if (want != null) {
      const high = ac.pos.y - want;
      if (high > 60) sub += ` · down ${Math.round((high * FT) / 100) * 100} ft`;
      else if (high < -90) sub += ' · a little higher';
    }
  }
  const turn = Math.abs(r) < 8 ? 'straight ahead' : `turn ${r < 0 ? 'left' : 'right'} ${Math.round(Math.abs(r) / 5) * 5}°`;
  UI.showGuide(sim, label, sub ? `${turn} · ${sub}` : turn, r);
}

/*
 * How high the aeroplane should be for the runway the story is sending it
 * to: a three-degree slope down to the approach gate, then down the
 * centreline to the touchdown point. Null when the height is nobody's
 * business (his heading, over the sea; or on the ground).
 *
 * Measured, not guessed: the pilot bot that plays both missions end to end
 * (tests/features/events.playthrough.js) followed the arrow in the 747 and
 * arrived at the film version's "Down! Put it on the runway" 9.5 km out and
 * 1,290 m up — 800 m above any slope a jumbo can come down — because nothing in either
 * story ever said which way was DOWN. The arrow said left and right, the
 * lead fighter flew twelve metres above you whatever you did, and in the
 * by-the-book one nothing mentioned height at all.
 */
const TAN3 = Math.tan((3 * Math.PI) / 180);

function wantHeight(sim) {
  const ac = sim.aircraft;
  if (!ac || ac.onGround) return null;
  if (H.version === 'film') {
    if (!H.guideOn || !AIRBORNE.film.has(H.phase) || H.phase === 'burst') return null;
    const td = RUNWAY.touchdown;
    if (H.onApproach) return td.y + flat(ac.pos, td) * TAN3;
    return GATE.y + flat(ac.pos, GATE) * TAN3;
  }
  if ((H.phase !== 'follow' && H.phase !== 'final') || !H.remoteReady) return null;
  if (H.onApproach || H.phase === 'final') return H.td.y + flat(ac.pos, H.td) * TAN3;
  return H.gate.y + flat(ac.pos, H.gate) * TAN3;
}

/**
 * Too high for the runway ahead: say so, now and then. The approach
 * controller in the film version (who is "with you"); the lead fighter in the
 * by-the-book one, whose own height is showing you the way down (escort.js,
 * `leadAlt`). Twice out loud, then on screen only, so it helps without nagging.
 */
function heightCoach(sim, dt) {
  const want = wantHeight(sim);
  H.coachT -= dt;
  if (want == null || H.coachT > 0) return;
  const high = sim.aircraft.pos.y - want;
  if (high < 220) return;
  H.coachT = 25;
  H.coached++;
  const ft = Math.round((high * FT) / 100) * 100;
  const cs = callsign(sim);
  if (H.coached <= 2) {
    if (H.version === 'real' && H.lead && !H.lead.gone) {
      speak(sim, `${cs}, Guardian lead. Descending. Follow me down.`, VOICE_FIGHTER);
    } else {
      speak(sim, `${cs}, ${field()} Approach. You are high. Descend now.`, 'approach');
    }
  }
  notify(sim, `Too high for the runway — about ${ft.toLocaleString()} ft to lose. Power back, nose a little down.`, 'warn', 5);
}

function clearGuide(sim) {
  H.guideOn = false;
  if (sim && sim.extTarget === EXT_TARGET) sim.extTarget = null;
  UI.hideGuide();
}

/* ================================================================== *
 * On the ground — both versions
 * ================================================================== */

/*
 * Where to taxi in the film version: a stand from the airport's list, or a
 * patch of apron. Chosen once the aeroplane has slowed to TAXI_PICK, not the
 * moment the story says "taxi" (under 30 m/s on the ground).
 *
 * It used to be chosen at 30 m/s, "at least v*v/2.4 m ahead" — and at 31 m/s
 * two-thirds of the way down Kestrel's runway nothing on the apron is that
 * far ahead, so it fell back to the patch nearest the aeroplane AT THAT
 * MOMENT: 68 m to the side, measured on the integrated tree in the 747.
 * The jumbo then rolled another 320 m before it stopped, the column of light
 * was behind it, and the pilot bot, turning round for it, went off the end
 * of the runway into the ridge beyond (wingtip, at 1158,21). Picked at
 * walking pace, the place is beside where you actually stop.
 */
const TAXI_PICK = 10;

function chooseStand(sim) {
  runwayFrame();
  const ac = sim.aircraft;
  let slots = null;
  try {
    slots = typeof AP.parkingSlots === 'function' ? AP.parkingSlots() : null;
  } catch (e) {
    slots = null;
  }
  const want = span(sim);
  if (Array.isArray(slots) && slots.length) {
    /*
     * Only a stand the aeroplane fits. It used to fall back to ANY stand
     * when none fitted — and on the integrated Kestrel none does for a
     * jumbo: every stand is 38 m or less against the 747's 64, so the
     * column of light went up on a stand for a regional jet with the
     * terminal forty metres behind it. The nearest one that fits, from
     * where the aeroplane has slowed down.
     */
    const pool = slots.filter((s) => s && s.kind === 'stand' && Number.isFinite(s.x) && Number.isFinite(s.z)
      && (!s.maxSpan || s.maxSpan >= want * 0.9));
    if (pool.length) {
      const p = ac.pos;
      pool.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
      const s = pool[0];
      H.stand.set(s.x, Number.isFinite(s.y) ? s.y : heightAt(s.x, s.z), s.z);
      return;
    }
  }
  /*
   * Otherwise the apron beside the taxiway, on the terminal side, at a
   * place with nothing built within 0.6 of a span (the airport team's
   * hangars, fire station and tower are registered obstacles, so asking is
   * exact) and flat ground: the one nearest where the aeroplane will stop,
   * and not behind it — a jumbo that has to turn round on a runway with a
   * ridge past each end is a jumbo in the ridge.
   */
  const f = ac.forward(TMP2).setY(0);
  if (f.lengthSq() < 1e-6) f.copy(RW.f);
  f.normalize();
  // Where it stops: about 1.2 m/s/s of braking, measured on the 747.
  const stopIn = (ac.groundSpeed * ac.groundSpeed) / 2.4;
  const sx = ac.pos.x + f.x * stopIn;
  const sz = ac.pos.z + f.z * stopIn;
  let best = Infinity;
  let found = false;
  for (let k = -0.38; k <= 0.56; k += 0.06) {
    rw(RW.L * k, -95, TMP);
    if (Math.abs(TMP.y - RW.c.y) > 3 || !clearOfBuildings(TMP.x, TMP.z, want * 0.6)) continue;
    const ahead = (TMP.x - sx) * f.x + (TMP.z - sz) * f.z;
    const cost = Math.hypot(TMP.x - sx, TMP.z - sz) + (ahead < -30 ? 400 : 0);
    if (cost < best) {
      best = cost;
      H.stand.copy(TMP);
      found = true;
    }
  }
  if (!found) rw(RW.L * 0.38, -95, H.stand);
}

/** Nothing built within `r` metres of (x, z), at a height a parked airliner reaches. */
function clearOfBuildings(x, z, r) {
  const g = heightAt(x, z);
  for (let a = 0; a < 8; a++) {
    const px = x + Math.sin((a / 8) * Math.PI * 2) * r;
    const pz = z - Math.cos((a / 8) * Math.PI * 2) * r;
    if (obstacleAt(px, g + 4, pz) || obstacleAt(px, g + 12, pz)) return false;
  }
  return !obstacleAt(x, g + 4, z);
}

/** Film: down. He wants the terminal. */
function startTaxi(sim) {
  H.pending = null;
  setPhase('taxi');
  for (const e of H.escorts) if (!e.gone && e.mode !== 'break') e.setMode('break');
  clearGuide(sim);
  H.standChosen = false;
  H.stillT = 0;
  H.comeToYou = false;
  SFX.grumble(sim, 8);
  UI.showCard(sim, {
    who: 'The hijacker',
    tone: 'bad',
    code: H.squawked ? '7500' : '2000',
    alert: H.squawked,
    text: H.squawked
      ? '"Don\'t stop here! Take it to the terminal. Park it!" He has no idea what is waiting there. Slow right down, then taxi to the column of light — or stop anywhere, and help will come to you.'
      : '"Don\'t stop here! Take it to the terminal. Park it!" The cabin crew phoned the airline from the back — the ground knows. Slow right down, then taxi to the column of light, or stop anywhere.',
  });
  objective(sim, H, 'Slow down', 'Brakes on (hold Space) and slow to walking pace. A column of light will show you where he wants to park — or stop anywhere, and help will come to you.');
  if (!H.pillar) {
    H.pillar = createPillar();
    sim.scene.add(H.pillar);
  }
  H.pillar.visible = false;
}

/** Slow enough now: put the column of light up where he wants to park. */
function showStand(sim) {
  H.standChosen = true;
  chooseStand(sim);
  H.pillar.visible = true;
  H.pillar.position.set(H.stand.x, H.stand.y + 55, H.stand.z);
  notify(sim, 'He points at the terminal: taxi to the column of light', 'info', 4);
  objective(sim, H, 'Taxi to the stand', 'Do as he says: taxi slowly to the column of light by the terminal. Or stop anywhere — help will come to you.');
}

function updateTaxi(sim, dt) {
  const ac = sim.aircraft;
  if (!H.standChosen) {
    // Still rolling out. (Stopped is under 4.5 m/s, so a stopped aeroplane
    // always has its stand, and "stop anywhere" still counts from there.)
    if (ac.groundSpeed >= TAXI_PICK) return;
    showStand(sim);
  }
  if (H.pillar) pulsePillar(H.t);
  if (H.owner !== 'mission' && H.uiT <= 0) {
    H.uiT = 0.25;
    const r = angleDiff(ac.heading, bearing(ac.pos, H.stand));
    const d = flat(ac.pos, H.stand);
    UI.showGuide(sim, 'The stand', `${Math.abs(r) < 10 ? 'straight ahead' : `turn ${r < 0 ? 'left' : 'right'}`} · ${Math.round(d)} m`, r);
  }
  EXT_TARGET.pos.copy(H.stand);
  EXT_TARGET.label = 'Stand';
  sim.extTarget = EXT_TARGET;
  H.stillT = stoppedNow(ac) ? H.stillT + dt : 0;
  H.atStand = flat(ac.pos, H.stand) < 70;
  if (H.atStand && H.stillT > 1.5) {
    H.pts.stand = 10;
    H.stars.push('Taxied to the stand as he said — right into the trap');
    startRush(sim);
  } else if (!H.atStand && H.stillT > 15) {
    H.comeToYou = true;
    H.pts.stand = 5;
    speak(sim, `${callsign(sim)}, stay exactly where you are.`, 'ground');
    startRush(sim);
  }
}

/** Real: down on the runway. Stop, engines off. */
function startStop(sim) {
  H.pending = null;
  setPhase('stop');
  for (const e of H.escorts) if (!e.gone && e.mode !== 'breakaway' && e.mode !== 'break') e.setMode('breakaway');
  clearGuide(sim);
  UI.hideMeter();
  if (!H.talked) {
    H.talked = true;
    H.pts.talk = Math.round((1 - H.tension) * 15);
  }
  const far = H.remoteReady && !H.rem.real;
  UI.showCard(sim, {
    who: `${field()} Tower`,
    tone: 'info',
    code: H.squawked ? '7500' : '2000',
    alert: H.squawked,
    text: far
      ? 'Down! Roll on to the far end of the runway, stop, and shut down the engines (press I). Stay on the flight deck with the door locked. The police are coming to you.'
      : 'Down! Stop on the runway and shut down the engines (press I). Stay on the flight deck with the door locked. The police are coming to you.',
  });
  objective(sim, H, 'Stop and shut down', far
    ? 'Roll to the far end, brakes on (hold Space) until you stop, then press I to shut down the engines.'
    : 'Brakes on (hold Space) until you stop, then press I to shut down the engines.');
}

/**
 * Where you stopped, judged when you have stopped: on the remote runway, or
 * in the far half of the main one when that was where the jets sent you.
 */
function judgeStop(sim) {
  const ac = sim.aircraft;
  if (!H.remoteReady) {
    H.onRemote = false;
    return;
  }
  if (H.rem.real) {
    H.onRemote = isOnRunway2(ac.pos.x, ac.pos.z, 40);
  } else {
    const along = (ac.pos.x - H.thr.x) * H.landDir.x + (ac.pos.z - H.thr.z) * H.landDir.z;
    const cross = (ac.pos.x - H.thr.x) * -H.landDir.z + (ac.pos.z - H.thr.z) * H.landDir.x;
    H.onRemote = along > H.rem.L * 0.5 && along < H.rem.L + 400 && Math.abs(cross) < 120;
  }
  if (H.onRemote) {
    H.pts.remote = 10;
    H.stars.push(H.rem.real ? 'Landed on the remote runway' : 'Rolled to the remote end of the runway');
  }
}

function updateStop(sim, dt) {
  const ac = sim.aircraft;
  H.stillT = stoppedNow(ac) ? H.stillT + dt : 0;
  if (H.stillT > 1.5) {
    judgeStop(sim);
    startRush(sim);
  }
}

/*
 * Chocks.
 *
 * A heavy jet at idle does not stop in this flight model: with the brakes
 * full on, the 747 creeps at 2.7 m/s and the A380 at 3.0, measured. Over the
 * minute and a half the police take, that is two hundred metres — the
 * aeroplane rolled out of the ring of police cars, away from the stairs,
 * and the officers climbed stairs to a door that had left. So once the
 * police are there, while the power is at idle, the wheels are chocked:
 * what creep there is in a frame is taken back out. Real power still moves
 * it — the chocks are a story, not a trap — and they come away when the
 * police leave.
 */
function chock(sim) {
  const ac = sim.aircraft;
  if (!ac.onGround || ac.controls.throttle >= 0.12 || ac.groundSpeed > 5) return;
  ac.vel.x = 0;
  ac.vel.z = 0;
}

/* ---------------------------------------------------------- the rush -- */

const DRIVE_RUSH = { maxSpeed: 24, accel: 9, stopAt: 2.5, turnRate: 110 };
const DRIVE_STAIRS = { maxSpeed: 14, accel: 5, stopAt: 1.5, turnRate: 70 };
const DRIVE_SLOW = { maxSpeed: 3, accel: 2, stopAt: 0.4, turnRate: 60 };
const DRIVE_AWAY = { maxSpeed: 16, accel: 5, stopAt: 5 };

/** The aeroplane's frame as it stands: forward, left, and where its front left door is. */
function planeFrame(sim) {
  const ac = sim.aircraft;
  const f = H.fwd;
  const l = H.left;
  ac.forward(f).setY(0);
  if (f.lengthSq() < 1e-6) f.set(0, 0, -1);
  f.normalize();
  l.set(f.z, 0, -f.x);
  const w = span(sim);
  const len = w * 1.02;
  const fus = Math.max(1.6, w * 0.052);
  const ground = heightAt(ac.pos.x, ac.pos.z);
  H.door.copy(ac.pos).addScaledVector(f, len * 0.3).addScaledVector(l, fus);
  H.door.y = ground + Math.max(2.2, Math.min(6.5, (ac.pos.y - ground) * 0.95));
  return { w, len, fus };
}

/** Move `p` towards `to` in 30 m steps until it is on land (or 60 m from `to`). In place. */
function landward(p, to) {
  for (let i = 0; i < 20 && heightAt(p.x, p.z) < 1; i++) {
    const d = flat(p, to);
    if (d < 60) break;
    const k = Math.min(1, 30 / d);
    p.x += (to.x - p.x) * k;
    p.z += (to.z - p.z) * k;
  }
  return p;
}

function startRush(sim) {
  setPhase('rush');
  const ac = sim.aircraft;
  const { w, len, fus } = planeFrame(sim);
  const f = H.fwd;
  const l = H.left;
  if (H.pillar) H.pillar.visible = false;
  clearGuide(sim);
  // Places round the aeroplane: the nose, the right wingtip, the tail, and
  // behind the stairs on the left.
  const P = (a, b) => new THREE.Vector3().copy(ac.pos).addScaledVector(f, a).addScaledVector(l, b);
  H.spots = [
    P(len * 0.5 + 16, 3),
    P(len * 0.05, -(w * 0.5 + 9)),
    P(-(len * 0.5 + 14), 0),
    P(-len * 0.08, fus + 13),
  ];
  /*
   * Where they come from: along the runway and the taxiway, from both
   * ends, whenever the aeroplane is anywhere near them — which is nearly
   * always (a stand, the apron, the far end of the runway). They used to
   * come from the terminal side, 380 m out in a straight line, and on the
   * integrated Kestrel the tower, a hangar and the terminal stand on that
   * side: a straight line across it can run through them, and the cars are
   * pictures, not colliders. Only an aeroplane that
   * stopped well away from the runway (more than 250 m off its centre line)
   * gets them straight across the grass from the terminal side.
   */
  runwayFrame();
  const from = TMP.copy(RW.c).addScaledVector(RW.r, -170);
  const dir = TMP2.subVectors(from, ac.pos).setY(0);
  const offAxis = Math.abs((ac.pos.x - RW.c.x) * RW.r.x + (ac.pos.z - RW.c.z) * RW.r.z);
  const alongTaxi = dir.length() < 150 || offAxis < 250;
  if (!alongTaxi) dir.normalize();
  removePolice(sim, H.police);
  const real = H.version === 'real';
  for (let i = 0; i < H.spots.length; i++) {
    let x;
    let z;
    if (alongTaxi) {
      const sgn = i % 2 ? 1 : -1;
      x = ac.pos.x + RW.f.x * sgn * (340 + i * 20);
      z = ac.pos.z + RW.f.z * sgn * (340 + i * 20);
    } else {
      const d0 = 380 + i * 22;
      x = ac.pos.x + dir.x * d0 + dir.z * (i - 1.5) * 12;
      z = ac.pos.z + dir.z * d0 - dir.x * (i - 1.5) * 12;
    }
    // Never out of the sea: walk a start point in towards the aeroplane
    // until it is on dry land (the end of a runway can be near the shore).
    landward(TMP.set(x, 0, z), ac.pos);
    x = TMP.x;
    z = TMP.z;
    const hdg = bearing(TMP.set(x, 0, z), ac.pos);
    const make = real && (i === 1 || i === 3) ? createVan : createPoliceCar;
    addPolice(sim, H.police, x, z, hdg, make);
  }
  // The stairs: platform to the door, square on to the fuselage, driven in
  // from thirty metres out on the left.
  const stairs = createStairs(H.door.y - heightAt(H.door.x, H.door.z));
  H.stairsSpot.copy(H.door).addScaledVector(l, 1.25);
  H.stairsSpot.y = heightAt(H.stairsSpot.x, H.stairsSpot.z);
  H.stairsApproach.copy(H.stairsSpot).addScaledVector(l, 30);
  H.stairsHdg = bearing(H.stairsApproach, H.stairsSpot);
  landward(TMP.set(alongTaxi ? H.stairsApproach.x + RW.f.x * 300 : ac.pos.x + dir.x * 430, 0,
    alongTaxi ? H.stairsApproach.z + RW.f.z * 300 : ac.pos.z + dir.z * 430), ac.pos);
  const sx = TMP.x;
  const sz = TMP.z;
  H.stairs = addPolice(sim, [], sx, sz, bearing(TMP.set(sx, 0, sz), H.stairsApproach), () => stairs);
  H.stairsStage = 0;
  if (H.siren) H.siren.stop();
  H.siren = new SFX.Loop(sim, real ? 'hilo' : 'wail', 0.06);
  if (H.drone) H.drone.set(0.5, 1);
  banner(sim, 'POLICE!', real ? 'The tactical team is on its way' : 'Here they come', 'warn', 4);
  if (real) {
    UI.showCard(sim, {
      who: 'Police tactical team',
      tone: 'info',
      code: H.squawked ? '7500' : '2000',
      alert: H.squawked,
      text: '"Captain, this is the police. Stay on the flight deck and keep that door locked. We are coming aboard. Leave the rest to us."',
    });
  } else {
    UI.showCard(sim, {
      who: 'The hijacker',
      tone: 'bad',
      code: H.squawked ? '7500' : '2000',
      alert: H.squawked,
      text: '"What\'s that? ... Police?! No, no, no!" Police cars are racing towards the aeroplane from every side, lights flashing.',
    });
    after(H, 5, (s) => {
      if (H.phase !== 'rush') return;
      UI.showCard(s, {
        who: 'Police — loudspeaker',
        tone: 'warn',
        text: '"POLICE! Everybody stay in your seats!" Keep your brakes on, Captain. You have done your part.',
      });
    });
  }
  objective(sim, H, 'Police!', 'Keep the brakes on and stay in your seat. Watch the police go in.');
}

function updateRush(sim, dt) {
  let arrived = 0;
  for (let i = 0; i < H.police.length; i++) {
    const s = H.spots[i] || H.spots[0];
    const left = H.police[i].driveTo(s.x, s.z, dt, DRIVE_RUSH);
    if (left < 6) arrived++;
  }
  const st = H.stairs;
  if (st) {
    if (H.stairsStage === 0) {
      if (st.driveTo(H.stairsApproach.x, H.stairsApproach.z, dt, DRIVE_STAIRS) < 3) H.stairsStage = 1;
    } else if (H.stairsStage === 1) {
      // Nose in, slowly, square to the fuselage; the last metre is eased
      // rather than steered, the way a driver lines it up by eye.
      const left = st.driveTo(H.stairsSpot.x, H.stairsSpot.z, dt, DRIVE_SLOW);
      st.heading = (st.heading + angleDiff(st.heading, H.stairsHdg) * Math.min(1, dt * 1.5) + 360) % 360;
      if (left < 1.2) {
        st.pos.lerp(H.stairsSpot, Math.min(1, dt * 2));
        st.heading = H.stairsHdg;
        st.speed = 0;
        if (flat(st.pos, H.stairsSpot) < 0.3) H.stairsStage = 2;
      }
      st.sync();
    }
  }
  if ((arrived === H.police.length && H.stairsStage === 2) || H.phaseT > 40) {
    // Anything still on its way is simply there now.
    if (st && H.stairsStage < 2) {
      st.place(H.stairsSpot.x, H.stairsSpot.z, H.stairsHdg);
      H.stairsStage = 2;
    }
    startBoard(sim);
  }
}

/* ---------------------------------------------------------- the board -- */

/**
 * People walking a path of points at walking pace. Built when they appear
 * (a handful of times a story), then moved each frame with nothing new made.
 */
function addWalker(sim, kind, points, delay, speed = 1.7) {
  const obj = createPerson(kind);
  obj.visible = false;
  sim.scene.add(obj);
  const w = { obj, pts: points, i: 0, k: 0, delay, speed, done: false };
  obj.position.copy(points[0]);
  H.walkers.push(w);
  return w;
}

function updateWalkers(dt) {
  for (const w of H.walkers) {
    if (w.done) continue;
    if (w.delay > 0) {
      w.delay -= dt;
      continue;
    }
    w.obj.visible = true;
    const a = w.pts[w.i];
    const b = w.pts[w.i + 1];
    if (!b) {
      // In through the door, or into the car: out of sight either way.
      w.done = true;
      w.obj.visible = false;
      continue;
    }
    const len = Math.max(0.01, a.distanceTo(b));
    w.k += (w.speed * dt) / len;
    if (w.k >= 1) {
      w.k = 0;
      w.i++;
      continue;
    }
    w.obj.position.lerpVectors(a, b, w.k);
    w.obj.rotation.y = Math.atan2(-(b.x - a.x), -(b.z - a.z));
    // The legs walk now (the rig bobs itself); they used to hop along.
    posePersonAt(w.obj, dt, w.speed);
  }
}

function nearestCar(p) {
  let best = null;
  let bd = Infinity;
  for (const d of H.police) {
    if (!d.obj) continue;
    // A van if there is one near enough: that is what the team came in.
    const k = flat(d.pos, p) - (d.obj.name === 'police-van' ? 15 : 0);
    if (k < bd) {
      bd = k;
      best = d;
    }
  }
  return best;
}

function startBoard(sim) {
  setPhase('board');
  after(H, 3, () => {
    if (H.siren) {
      H.siren.stop();
      H.siren = null;
    }
  });
  const real = H.version === 'real';
  const st = H.stairs && H.stairs.obj;
  if (!st) {
    after(H, 8, (s) => finishStory(s));
    return;
  }
  const f = H.fwd;
  const l = H.left;
  st.updateMatrixWorld(true);
  const top = st.localToWorld(st.userData.top.clone());
  const bottom = st.localToWorld(st.userData.bottom.clone());
  bottom.y = heightAt(bottom.x, bottom.z);
  const doorIn = top.clone().addScaledVector(l, -1.4);
  // In they go: from beside the stairs, up, and through the door.
  const n = real ? 6 : 4;
  for (let i = 0; i < n; i++) {
    const start = bottom.clone().addScaledVector(l, 5 + i * 1.3).addScaledVector(f, (i % 2 ? 1 : -1) * 1.4);
    start.y = heightAt(start.x, start.z);
    addWalker(sim, real ? 'tactical' : 'police', [start, bottom.clone(), top.clone(), doorIn.clone()], i * 0.9, real ? 2.2 : 1.9);
  }
  const inside = n * 0.9 + 9;
  if (real) {
    after(H, 1.5, (s) => {
      SFX.chime(s);
      UI.showCard(s, {
        who: 'Interphone',
        tone: H.tension < 0.35 ? 'good' : 'bad',
        icon: 'phone',
        text: H.tension < 0.35
          ? '"...Okay. Okay. I am sitting down. I am done." What you said to him worked.'
          : 'The interphone goes quiet. The team is going in.',
      });
    });
  }
  after(H, inside - 2, (s) => SFX.thud(s));
  after(H, inside, (s) => {
    SFX.cheer(s, 1.2, 0.4);
    UI.showCard(s, {
      who: real ? 'Police tactical team' : 'Police',
      tone: 'good',
      text: real
        ? '"Flight deck, police. We have him. Nobody is hurt. You can stand down, Captain."'
        : '"We\'ve got him! Nobody is hurt. Everybody stay in your seats — you are all safe."',
    });
  });
  // Out they come: two officers with him between them, hands cuffed behind
  // his back, down the stairs and into the nearest car.
  const car = nearestCar(bottom);
  H.perpCar = car;
  const carSide = car ? car.pos.clone().addScaledVector(l, 2.5) : bottom.clone().addScaledVector(l, 12);
  carSide.y = heightAt(carSide.x, carSide.z);
  const out = [doorIn, top, bottom, carSide];
  for (let i = 0; i < 3; i++) {
    const pts = out.map((p) => p.clone().addScaledVector(f, (i - 1) * 0.7));
    const wk = addWalker(sim, i === 1 ? 'hijacker' : real ? 'tactical' : 'police', pts, inside + 2 + i * 0.35, 1.5);
    if (i === 1) H.perp = wk;
  }
  // The camera is the story's until the car has gone; C hands it back.
  H.cine = 90;
  H.camT = 0;
}

/** Every frame of the boarding: the car leaves once he is in it. */
function updateBoard(sim, dt) {
  updateWalkers(dt);
  if (H.perp && H.perp.done && !H.perpAway) {
    H.perpAway = true;
    H.carAway = H.perpCar;
    after(H, 4, (s) => finishStory(s));
  }
  // However the walk went, the story ends.
  if (H.phaseT > 75 && H.phase === 'board') finishStory(sim);
}

/* --------------------------------------------------------- the ending -- */

/*
 * The most each thing done right is worth. Film: base 30, squawk 15,
 * shadow 20, obeyed 10, landing 15, stand 10. Real: door 10, squawk 15,
 * verify 10, click 5, radio 10, intercept 10, gear 5, follow 10, talk 15,
 * remote 10, engines 5, landing 15.
 */
const FILM_MAX = 100;
const REAL_MAX = 120;

function landingPoints() {
  const g = H.touch;
  if (!g || g.crashed) return 5;
  return Math.round(Math.max(0, Math.min(1, (g.score || 50) / 100)) * 15);
}

/*
 * The ending says what happened, not what the story hoped would. It was one
 * fixed sentence — "followed the fighters and landed on the remote runway",
 * "flew where he said with two fighters hiding behind you" — and a child who
 * landed before the jets arrived (the story lets you: down is down) was told
 * they had done both.
 */
function joinList(parts) {
  if (parts.length < 2) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

function realEnding() {
  // The door never opens in this story, whatever was answered.
  const did = ['kept the flight deck door locked'];
  if (H.squawked && !H.foSquawked) did.push('told ATC without saying a word');
  if (H.acked) did.push('followed the fighters');
  did.push(H.onRemote ? (H.rem.real ? 'landed on the remote runway' : 'stopped at the far end, away from the terminal') : 'landed');
  return `You ${joinList(did)}. The police did the rest. That is how real crews are trained to do it.`;
}

function filmEnding() {
  const did = ['stayed calm'];
  if (H.squawked) did.push(H.crewCalled ? 'squawked 7500 as well' : 'squawked 7500 right under his nose');
  if (H.shadowSaid) did.push('flew where he said with two fighters hiding behind you');
  else did.push('flew where he said');
  did.push(H.comeToYou ? 'let the police come to you' : 'parked him right in front of the police');
  return `You ${joinList(did)}. The passengers are cheering!`;
}

function finishStory(sim) {
  if (H.phase === 'done') return;
  setPhase('done');
  const real = H.version === 'real';
  H.pts.landing = landingPoints();
  if (!real) {
    // The film version has less to choose, so what there is counts for more:
    // the squawk is what brought the fighters and the police, and flying
    // where he said is what put him in front of them.
    H.pts.base = 30;
    H.pts.shadow = H.squawked && !H.crewCalled ? 20 : H.squawked ? 10 : 0;
    H.pts.obeyed = H.onApproach ? 10 : 0;
  }
  // The camera comes back a few seconds after the ending card.
  if (H.cine > 6) H.cine = 6;
  let score = 0;
  for (const k in H.pts) score += H.pts[k] || 0;
  /*
   * Out of the most there was to get, so a perfect run is exactly 100 and
   * not more — the by-the-book version adds up to 120 over twelve things
   * done right, and simply clipping at 100 let a run that missed the radio
   * code and the wheels still score full marks.
   */
  const most = real ? REAL_MAX : FILM_MAX;
  H.score = Math.max(10, Math.min(100, Math.round((score / most) * 100)));
  SFX.fanfare(sim);
  SFX.cheer(sim, 3, 1);
  if (H.drone) {
    H.drone.stop();
    H.drone = null;
  }
  banner(sim, 'Everyone is safe!', real ? 'The door stayed locked, and the police have him.' : 'You stayed calm, and the police have him.', 'good', 6);
  // What you did right, as a list — the part worth remembering.
  const list = H.stars.length ? H.stars.slice(0, 6).map((s) => `✓ ${s}`).join('   ') : '';
  let text = real ? realEnding() : filmEnding();
  if (list) text += `   ${list}`;
  /*
   * A reward, when the dice brought the story and no mission is paying for
   * the flight. Not for a Dev button: that paid the full hero bonus on every
   * press, a credits tap for anybody with the code.
   */
  if (H.owner === 'dev') after(H, 2.5, (s) => notify(s, 'Dev run — no credits for this one.', 'info', 4));
  if (H.owner === 'free') {
    try {
      const p = sim.prog || Prog.load();
      // Priced as the two hijack missions are (game/extra/events.js): the
      // by-the-book one Hard, the film one Medium, both Emergencies.
      const paid = Prog.award(p, {
        kind: 'mission',
        score: H.score,
        crashed: false,
        difficulty: (sim.settings && sim.settings.difficulty) || 'normal',
        label: real ? 'Hijack, by the book' : 'Hijacked! Everyone safe',
        mission: { difficulty: real ? 'Hard' : 'Medium', category: 'events' },
      });
      H.paid = paid.credits;
      if (sim.menus && sim.menus.syncProgression) sim.menus.syncProgression(p);
      after(H, 2.5, (s) => notify(s, `Hero bonus: +${paid.credits} credits · ${paid.total} total`, 'good', 6));
    } catch (e) {
      console.warn('[events] could not pay the hijack reward', e);
    }
  }
  UI.showCard(sim, {
    who: real ? 'By the book, Captain' : 'Hero of the skies',
    tone: 'good',
    code: '2000',
    text: `${text}   Score ${H.score}/100.`,
    ttl: 20,
  });
  after(H, 9, (s) => restoreObjective(s, H));
  quietTower(sim, false);
}

/*
 * After the ending, everybody goes home.
 *
 * They used to stay: four police cars, a van and a stairs truck parked round
 * the aeroplane for the rest of the flight, with the stairs against the door
 * — so taking off again meant rolling through a stairs truck, and a Free
 * Flight after a hijack had a car park on the runway until you quit. Twenty
 * seconds after the ending card (the camera is back by then) the stairs back
 * away from the door and every vehicle drives off to the far end of the
 * taxiway, and each is taken away when it gets there.
 */
const LEAVE_AFTER = 20;
const DRIVE_LEAVE = { maxSpeed: 15, accel: 4, stopAt: 5 };
const LEAVE_POS = new THREE.Vector3();

function updateLeave(sim, dt) {
  H.leaveT += dt;
  if (H.leaveT < LEAVE_AFTER) return;
  if (!H.leaving) {
    H.leaving = true;
    H.stairsStage = 3;
    H.backT = 0;
  }
  runwayFrame();
  rw(-RW.L * 0.45, -95, LEAVE_POS);
  // The stairs first reverse straight out, square to the fuselage, then go.
  const st = H.stairs;
  if (st && st.obj) {
    if (H.stairsStage === 3) {
      H.backT += dt;
      const r = (st.heading * Math.PI) / 180;
      st.pos.x -= Math.sin(r) * 2.5 * dt;
      st.pos.z += Math.cos(r) * 2.5 * dt;
      st.pos.y = heightAt(st.pos.x, st.pos.z);
      st.sync();
      if (H.backT > 5) H.stairsStage = 4;
    } else if (st.driveTo(LEAVE_POS.x, LEAVE_POS.z, dt, DRIVE_LEAVE) < 8) {
      if (st.obj.parent) st.obj.parent.remove(st.obj);
      st.obj = null;
    }
  }
  // Staggered, so they do not all pull away as one block.
  let kept = 0;
  for (let i = 0; i < H.police.length; i++) {
    const d = H.police[i];
    // The car he is in has its own way to go (see updateHijack).
    if (d.obj && d !== H.carAway && H.leaveT > LEAVE_AFTER + i * 1.5) {
      if (d.driveTo(LEAVE_POS.x + i * 6, LEAVE_POS.z, dt, DRIVE_LEAVE) < 8) {
        if (d.obj.parent) d.obj.parent.remove(d.obj);
        d.obj = null;
      }
    }
    if (d.obj) H.police[kept++] = d;
  }
  H.police.length = kept;
  if (H.siren) {
    H.siren.stop();
    H.siren = null;
  }
}

/* ================================================================== *
 * Every frame
 * ================================================================== */

const DRIVE_HOME_POS = new THREE.Vector3();

export function updateHijack(sim, dt) {
  if (H.phase === 'idle') return;
  S.sim = sim;
  const ac = sim.aircraft;
  H.t += dt;
  H.phaseT += dt;

  if (H.phase === 'armed') {
    // A long-haul flight: wait until you are properly on your way.
    if (!ac.onGround && ac.airborneTime > H.triggerAt && ac.agl > 300 && flat(ac.pos, RUNWAY.touchdown) > 4000) {
      H.phase = 'idle';
      H.owner = H.owner || 'free';
      begin(sim);
    }
    return;
  }
  if (ac.crashed) {
    // The game's own crash story takes over; this one goes quiet, and takes
    // its card off the screen rather than leave "HIJACK!" over the wreck.
    if (H.siren) H.siren.set(0, dt);
    if (H.drone) H.drone.set(0, dt);
    if (H.jet) H.jet.set(0, dt);
    if (!H.quiet) {
      H.quiet = true;
      H.pending = null;
      UI.hideAll();
    }
    return;
  }
  runBeats(H, sim);
  askTimer(dt);

  if (ac.lastTouchdown && ac.lastTouchdown !== H.touchAtStart) H.touch = ac.lastTouchdown;
  if (!ac.onGround) H.flew = true;

  if (AIRBORNE[H.version].has(H.phase)) {
    if (H.version === 'real') updateRealAir(sim, dt);
    else updateFilmAir(sim, dt);
    // Down and slowing, anywhere — the story moves on to the ground. Only
    // once the aeroplane has actually flown during it: started on the
    // ground, this decided "landed" on frame one and skipped everything.
    // And only after a real touchdown during it (H.touch): an aeroplane put
    // back on the runway by something else — a map change finishing a
    // moment late did it, measured — was "landed", and the story ran to
    // "you followed the fighters to the remote runway" with the jumbo
    // parked at the start of the runway and nobody having flown anywhere.
    if (H.flew && H.touch && ac.onGround && ac.groundTime > 1 && ac.groundSpeed < 30) {
      if (H.version === 'real') startStop(sim);
      else startTaxi(sim);
    }
    if (hijackActive() && ac.onGround === false) quietTower(sim, true);
  } else {
    // Jets finishing their goodbye after touchdown.
    if (H.escorts.length) {
      for (const e of H.escorts) e.update(dt, ac, span(sim), sim.weather);
      dropGone(H.escorts);
    }
    if (H.phase === 'taxi') updateTaxi(sim, dt);
    else if (H.phase === 'stop') updateStop(sim, dt);
    else if (H.phase === 'rush') updateRush(sim, dt);
    else if (H.phase === 'board') updateBoard(sim, dt);
    else if (H.phase === 'done') {
      updateWalkers(dt);
      updateLeave(sim, dt);
    }
    if (H.phase === 'rush' || H.phase === 'board' || (H.phase === 'done' && !H.leaving)) chock(sim);
    if ((H.phase === 'stop' || H.phase === 'rush' || H.phase === 'board') && !ac.engineOn && !H.engineOffPaid && H.version === 'real') {
      H.engineOffPaid = true;
      H.pts.engines = 5;
      H.stars.push('Shut down the engines at the remote stand');
    }
    // The car with him in it drives off, and is gone when it gets there.
    if (H.carAway && H.carAway.obj) {
      runwayFrame();
      rw(-RW.L * 0.3, -95, DRIVE_HOME_POS);
      const left = H.carAway.driveTo(DRIVE_HOME_POS.x, DRIVE_HOME_POS.z, dt, DRIVE_AWAY);
      if (left < 8) {
        if (H.carAway.obj.parent) H.carAway.obj.parent.remove(H.carAway.obj);
        H.carAway.obj = null;
        const i = H.police.indexOf(H.carAway);
        if (i >= 0) H.police.splice(i, 1);
        H.carAway = null;
      }
    }
  }

  // Sound: the siren follows the nearest police car; the jets are loud close to.
  if (H.siren && H.police.length && sim.camera) {
    let near = Infinity;
    for (const d of H.police) near = Math.min(near, sim.camera.position.distanceTo(d.pos));
    H.siren.set(SFX.falloff(near, 50, 1200), dt);
  }
  if (H.jet) {
    let near = Infinity;
    if (sim.camera) for (const e of H.escorts) near = Math.min(near, sim.camera.position.distanceTo(e.pos));
    H.jet.set(SFX.falloff(near, 40, 1500), dt);
  }
  if (H.cine > 0) H.cine -= dt;
  if (H.uiT > 0) H.uiT -= dt;
}

/** True if the story has the camera this frame (the police going in). */
export function hijackCamera(sim, dt, camera) {
  if (lookBackAtShadow(sim, dt, camera)) return true;
  if (H.cine <= 0 || (H.phase !== 'board' && H.phase !== 'done')) return false;
  const ac = sim.aircraft;
  if (!ac || ac.crashed || ac.groundSpeed > 5 || !H.stairs || !H.stairs.obj) return false;
  // Off the left side, a little ahead of the door and above it: the stairs,
  // the door and the car all in one picture.
  H.camT = (H.camT || 0) + dt;
  const w = span(sim);
  const back = 26 + w * 0.35;
  H.camLook.copy(H.door);
  H.camLook.y -= 1.5;
  H.camPos.copy(H.door).addScaledVector(H.left, back).addScaledVector(H.fwd, 10 + Math.sin(H.camT * 0.15) * 6);
  H.camPos.y = Math.max(heightAt(H.camPos.x, H.camPos.z) + 2, H.door.y + 4);
  camera.position.lerp(H.camPos, H.camT < 0.1 ? 1 : Math.min(1, dt * 2));
  camera.lookAt(H.camLook);
  return true;
}

/*
 * "Hold B to look behind", while the jets are shadowing you.
 *
 * The game's own look-behind keeps the chase camera where it is and aims it
 * sixty metres behind the aeroplane. For a trainer, whose camera is 26 m
 * back, that looks backwards. For the 747 and the A380 the airliners
 * feature stands the camera about 140 m back, so the same aim point is IN
 * FRONT of the camera: holding B in a jumbo looked forwards, measured
 * (camera direction against the nose, 0.94) — and the one thing the story
 * asks you to look at, two fighters under your tail, could not be seen. So
 * while they are there and B is held, the camera sits over the fin and
 * looks back down at them. Everywhere else B is left to the game.
 */
const SHADOW_MID = new THREE.Vector3();
function lookBackAtShadow(sim, dt, camera) {
  if (H.version !== 'film' || H.escortBroke || !AIRBORNE.film.has(H.phase)) return false;
  const input = sim.input;
  if (!input || typeof input.held !== 'function' || !input.held('lookBehind')) return false;
  const ac = sim.aircraft;
  if (!ac || ac.crashed || ac.onGround) return false;
  let n = 0;
  SHADOW_MID.set(0, 0, 0);
  for (const e of H.escorts) {
    if (e.gone || e.mode !== 'shadow') continue;
    SHADOW_MID.add(e.pos);
    n++;
  }
  if (!n) return false;
  SHADOW_MID.multiplyScalar(1 / n);
  const w = span(sim);
  // Over the fin: half a length back and a fin's height up, in the
  // aeroplane's own frame, then a little further so the tail is in shot.
  H.camPos.set(0, 4 + w * 0.2, w * 0.62).applyQuaternion(ac.quat).add(ac.pos);
  camera.position.copy(H.camPos);
  camera.lookAt(SHADOW_MID);
  // A longer lens, so two jets a quarter of a kilometre back are jets and
  // not specks. The rig eases the field of view back when B is let go.
  camera.fov += (38 - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  return true;
}

/** Hand the camera back: the C key while the police are going in. */
export function skipCinematic() {
  if (H.cine <= 0) return false;
  H.cine = 0;
  return true;
}

export function cinematicOn() {
  return H.cine > 0 && (H.phase === 'board' || H.phase === 'done');
}

/*
 * What the missions and the tests read, every frame. One object, rewritten
 * in place, so a step check that asks sixty times a second allocates
 * nothing. The vectors in it are the live ones — read them, do not keep or
 * change them.
 */
const HINFO = {
  phase: 'idle', version: 'film', owner: null, squawked: false, answered: 0, choosing: false,
  escorts: 0, escortFormed: false, escortBroke: false, acked: false, talked: false, tension: 0.6,
  released: false, onRemote: false, landed: false, police: 0, stairs: false, stand: null,
  guide: null, lead: null, remote: null, landHdg: null, comeToYou: false, done: false, score: 0, stars: 0, paid: 0,
  crewCalled: false, foSquawked: false, radioDone: false, radio: null, landSignal: false, leadGear: false, gearAck: false,
  leaving: false, onApproach: false, wantAlt: null, leadAim: null,
};

const LANDED = new Set(['taxi', 'stop', 'rush', 'board', 'done']);

export function hijackInfo() {
  HINFO.phase = H.phase;
  HINFO.version = H.version;
  HINFO.owner = H.owner;
  HINFO.squawked = H.squawked;
  HINFO.answered = H.answeredN;
  HINFO.choosing = !!H.pending;
  HINFO.escorts = H.escorts.length;
  let formed = H.escorts.length > 0;
  for (const e of H.escorts) if (!e.formed) formed = false;
  HINFO.escortFormed = formed;
  HINFO.escortBroke = H.escortBroke || H.released;
  HINFO.acked = H.acked;
  HINFO.talked = H.talked;
  HINFO.tension = H.tension;
  HINFO.released = H.released;
  HINFO.onRemote = H.onRemote;
  HINFO.landed = LANDED.has(H.phase);
  HINFO.police = H.police.length;
  HINFO.stairs = !!(H.stairs && H.stairs.obj);
  HINFO.stand = H.phase === 'taxi' && H.standChosen ? H.stand : null;
  HINFO.guide = H.guideOn ? H.guide : null;
  HINFO.lead = H.lead && !H.lead.gone ? H.lead.pos : null;
  HINFO.remote = H.remoteReady ? H.td : null;
  HINFO.landHdg = H.remoteReady ? H.landHdg : null;
  HINFO.comeToYou = H.comeToYou;
  HINFO.done = H.phase === 'done';
  HINFO.score = H.score;
  HINFO.stars = H.stars.length;
  HINFO.paid = H.paid;
  HINFO.crewCalled = H.crewCalled;
  HINFO.foSquawked = H.foSquawked;
  HINFO.radioDone = H.radioDone;
  HINFO.radio = H.answers.radio == null ? null : H.answers.radio;
  HINFO.landSignal = H.landSignal;
  HINFO.leadGear = !!(H.lead && !H.lead.gone && H.lead.gearDown);
  HINFO.gearAck = H.gearAck;
  HINFO.leaving = H.leaving;
  HINFO.onApproach = H.onApproach;
  HINFO.wantAlt = S.sim && hijackActive() ? wantHeight(S.sim) : null;
  HINFO.leadAim = H.phase === 'follow' && HINFO.lead ? H.leadAim : null;
  return HINFO;
}

/** For the tests: the conversation, so they can check every line of it. */
export const TALK_LINES = TALK;

export function flashingNow() {
  return H.police.length > 0;
}

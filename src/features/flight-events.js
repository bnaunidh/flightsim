/**
 * Flight events: things that can happen to a flight that nobody planned.
 *
 * THE HIJACK (long-haul airliners). Two versions, because the kid who owns
 * the game asked for two: "let hijacking be bad, but the more realistic one
 * is behind a code". The film version is for everybody; the by-the-book one
 * needs the Dev passcode. Both live in ./events/hijack.js, which says what is
 * in them and what is not.
 *
 * It never arms itself. There is no dice roll in Free Flight any more — the
 * owner asked for no random stuff, more than once, and a flight the game
 * ambushes without being asked is exactly that. A hijack only ever starts
 * because something asked for it on purpose: a mission
 * (src/game/extra/events.js, through forceHijack / hijackInfo and
 * ./events/bridge.js, which this file fills in, so that leaving this file out
 * of src/features/index.js really does turn all of it off) or the Dev panel.
 *
 * It never runs during a mission's critical step: the hijack only happens in
 * Free Flight or its own mission (a mission already has a story of its own).
 *
 * Keys, and only while the story that wants them is on: 7 squawks 7500; 8, 9
 * and 0 answer the question on the card when there is one; C hands the
 * camera back while the police are going in.
 *
 * Sound is procedural and quiet (./events/sfx.js). Radio calls go through
 * sim.speak(), which honours the player's own voice setting — the default is
 * the game's formant radio chatter with subtitles, never text-to-speech.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extStatus } from '../game/extensions.js';
import { registerActions, isKey } from '../flight/input.js';

/*
 * The events' keys, in the one registry: Settings → Controls → Missions &
 * events. The answers on a question card, the hijack's secret squawk, and
 * skipping a cut-scene (C, the camera key, which it shares by design: the
 * camera is not yours while a cut-scene is playing).
 */
registerActions({
  eventSquawk: { label: 'Hijack: squawk 7500 secretly', group: 'Missions & events', ctx: ['plane', 'heli'], default: ['Digit7', 'Numpad7'] },
  eventChoice1: { label: 'Question card: first answer', group: 'Missions & events', ctx: ['plane', 'heli'], default: ['Digit8', 'Numpad8'] },
  eventChoice2: { label: 'Question card: second answer', group: 'Missions & events', ctx: ['plane', 'heli'], default: ['Digit9', 'Numpad9'] },
  eventChoice3: { label: 'Question card: third answer', group: 'Missions & events', ctx: ['plane', 'heli'], default: ['Digit0', 'Numpad0'] },
  eventSkip: { label: 'Skip the cut-scene', group: 'Missions & events', ctx: ['plane'], default: ['KeyC'] },
});
import { heightAt } from '../world/terrain.js';
import { flashPolice } from './events/vehicles.js';
import * as UI from './events/ui.js';
import { RUNWAY, typeOf, longHaulId, cruiseSpeed, RW, runwayFrame, registerVoices } from './events/common.js';
import * as HJ from './events/hijack.js';
import { BRIDGE } from './events/bridge.js';

export { longHaulId };
export { squawk, hijackInfo, devOpen, answerChoice, TALK_LINES } from './events/hijack.js';

const TMP = new THREE.Vector3();

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const S = {
  sim: null,
  t: 0,
  frames: 0,
};

/* ================================================================== *
 * THE HIJACK — see ./events/hijack.js
 * ================================================================== */

/**
 * Begin a hijack now. `version` is 'film' (everybody) or 'real' (the
 * by-the-book one, behind the Dev passcode — the caller checks the code,
 * because a mission or a test may start it on purpose).
 */
export function forceHijack(sim, { owner = 'dev', version = 'film' } = {}) {
  sim = sim || S.sim;
  if (!sim) return false;
  S.sim = sim;
  return HJ.forceHijack(sim, { owner, version });
}

/** True while this feature has not been switched off for throwing. */
export function eventsLive() {
  const me = extStatus().find((e) => e.id === 'flightevents');
  return !!(me && me.live);
}

/**
 * Counts up every frame this feature's update runs. A mission step waiting on
 * an event reads it instead of eventsLive(), which builds two arrays a call:
 * if the count stops moving while the mission is running, the feature has
 * been switched off and the step should stop waiting.
 */
export function eventsHeartbeat() {
  return S.frames;
}

/* ================================================================== *
 * The hooks
 * ================================================================== */

/**
 * Put the aeroplane twenty-two kilometres out along the runway's extended
 * centre line (five to the side) at 1,500 m, pointing at it. Free Flight's
 * own airborne start is three kilometres out at 600 m, which is already
 * inside the point where the escort says goodbye — so a Dev-button story
 * started there had the jets leave before they arrived. It was sixteen: that
 * put a jumbo 500 m above a three-degree slope to the approach gate before
 * the story had said a word, and "you are high" was the first thing it heard.
 */
function farOut(sim) {
  const ac = sim.aircraft;
  if (!ac || typeof ac.reset !== 'function') return;
  runwayFrame();
  const t = typeOf(sim);
  const p = TMP.copy(RW.c).addScaledVector(RW.f, -22000).addScaledVector(RW.r, 5000);
  ac.reset({ pos: p.clone(), headingDeg: RUNWAY.headingDeg ?? 90, speed: cruiseSpeed(t && t.id), altAGL: Math.max(300, 1500 - heightAt(p.x, p.z)), engineOn: true, gearDown: false });
  ac.controls.throttle = 0.65;
  if (sim.input) sim.input.throttleTarget = 0.65;
}

/** Start a Free Flight for a Dev button when there is no flight to put the event in. */
function devFlight(sim, aircraftId, airborne) {
  if (!sim || typeof sim.startMode !== 'function') return Promise.resolve(false);
  const weather = sim.weather && sim.weather.serialize ? sim.weather.serialize() : {};
  return Promise.resolve(sim.startMode('free', { ...weather, aircraft: aircraftId, airborne })).then(() => true);
}

/** Both Dev hijack buttons: now, in this flight if it is airborne, or a fresh long-haul one if not. */
function devHijack(sim, version) {
  const flying = sim.state === 'flying' || sim.state === 'paused';
  const t = typeOf(sim);
  // A story about a cabin full of passengers, a flight deck door and an
  // airliner's approach: in the Skylark it made no sense, and the button
  // used to start it in whatever you happened to be flying.
  const airliner = !!t && (t.longHaul || t.id === longHaulId());
  if (flying && airliner && sim.mode !== 'drive' && sim.mode !== 'mission' && sim.aircraft && !sim.aircraft.onGround && !sim.aircraft.crashed) {
    forceHijack(sim, { owner: 'dev', version });
    return;
  }
  // Not flying, not in a long-haul airliner, in a mission, driving, or sat
  // on the ground: the story needs sky and a jumbo, so start a long-haul
  // Free Flight out over the sea and begin it there.
  devFlight(sim, longHaulId(), true).then((ok) => {
    if (!ok) return;
    farOut(sim);
    forceHijack(sim, { owner: 'dev', version });
  }).catch((e) => console.error('[events] could not start the hijack flight', e));
}

const CHOICE_ACTIONS = ['eventChoice1', 'eventChoice2', 'eventChoice3'];

/*
 * "The more realistic one is behind a code."
 *
 * The by-the-book mission is in the mission list for everybody, flagged
 * `devOnly`. Without the Dev passcode its card is shown LOCKED: greyed, its
 * button switched off, and a line under it saying where the code goes — the
 * way the car's board shows a job the island cannot offer (is-unavailable
 * and mission-why, styles/main.css), which says a card you can see and are
 * told about beats one you cannot find.
 *
 * It used to be hidden instead, and that broke two things. The menus' own
 * check counts every card that is not behind the military passcode as one
 * the board must show, so with this branch merged it went red ("flight:
 * missing event-hijack-real"). And the game switcher (game-ui.js) un-hides a
 * card it hid for another game without asking why else it was hidden, so
 * after flight -> car -> flight the "hidden" card was back anyway. A locked
 * card needs nobody else to know what devOnly means.
 *
 * The menus call syncMissionLocks every time the Missions screen opens; this
 * wraps it, after whatever it already does, so entering the code unlocks the
 * card the next time the screen opens, with no reload. The click is guarded
 * as well, in the capture phase, in case anything switches the button back on.
 */
const DEV_WHY = 'Behind the Dev passcode — enter it under Dev mode, at the bottom of the Hangar.';

function lockDevCard(card, locked) {
  card.classList.toggle('is-unavailable', locked);
  card.classList.toggle('ev-dev-locked', locked);
  const btn = card.querySelector('[data-start]');
  if (btn) btn.disabled = locked;
  let why = card.querySelector('[data-dev-why]');
  if (!why && locked) {
    why = document.createElement('p');
    why.className = 'mission-why';
    why.setAttribute('data-dev-why', '');
    why.textContent = DEV_WHY;
    card.appendChild(why);
  }
  if (why) why.hidden = !locked;
}

function guardDevMissions(sim, MISSIONS) {
  const menus = sim && sim.menus;
  if (!menus || menus._eventsDevGuard || !Array.isArray(MISSIONS)) return;
  const devIds = new Set(MISSIONS.filter((m) => m && m.devOnly).map((m) => m.id));
  if (!devIds.size) return;
  menus._eventsDevGuard = true;
  const syncLocks = () => {
    const screen = menus.screens && menus.screens.missions;
    if (!screen) return;
    const open = HJ.devOpen(sim);
    for (const id of devIds) {
      const card = screen.querySelector(`[data-mission="${id}"]`);
      if (card) lockDevCard(card, !open);
    }
  };
  const inner = menus.syncMissionLocks;
  menus.syncMissionLocks = function (...args) {
    const out = typeof inner === 'function' ? inner.apply(this, args) : undefined;
    syncLocks();
    return out;
  };
  syncLocks();
  const screen = menus.screens && menus.screens.missions;
  if (screen) {
    screen.addEventListener('click', (e) => {
      const start = e.target && e.target.closest ? e.target.closest('[data-start]') : null;
      if (!start || !devIds.has(start.dataset.start) || HJ.devOpen(sim)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      syncLocks();
      if (menus.hooks && typeof menus.hooks.onLocked === 'function') menus.hooks.onLocked(DEV_WHY);
    }, true);
  }
}

/*
 * The missions reach this feature through ./events/bridge.js, filled in here
 * and only here, so taking this file's line out of src/features/index.js
 * really does switch the Dev buttons and the stories off.
 */
BRIDGE.api = {
  forceHijack: (sim, o) => forceHijack(sim, o),
  hijackInfo: HJ.hijackInfo,
  heartbeat: eventsHeartbeat,
};

registerExtension({
  id: 'flightevents',

  install(sim) {
    S.sim = sim;
    registerVoices();
    /*
     * The mission list, asked for here and not imported at the top: the
     * missions import this file (src/game/extra/events.js drives the stories
     * through it), so a static import back would be a cycle. By install time
     * every module has loaded and this resolves at once.
     */
    import('../game/missions.js')
      .then((m) => guardDevMissions(sim, m.MISSIONS))
      .catch((e) => console.warn('[events] could not guard the Dev-only mission card', e));
    // For the console and the tests: window.__sim.flightEvents.forceHijack().
    sim.flightEvents = {
      forceHijack: (o) => forceHijack(sim, o),
      squawk: () => HJ.squawk(sim),
      hijackInfo: HJ.hijackInfo,
    };
  },

  startMode(sim) {
    S.sim = sim;
    HJ.resetHijack(sim);
    // No dice, ever: a hijack only ever starts because a mission or the Dev
    // panel asked for it on purpose (see the file's own header).
  },

  stop(sim) {
    HJ.resetHijack(sim);
  },

  update(sim, dt) {
    S.frames++;
    if (sim.mode === 'drive') return;
    S.t += dt;
    HJ.updateHijack(sim, dt);
    if (HJ.flashingNow()) flashPolice(S.t);
  },

  camera(sim, dt, camera) {
    return HJ.hijackCamera(sim, dt, camera);
  },

  key(sim, code, down) {
    if (isKey(sim, 'eventSquawk', code)) {
      if (!HJ.hijackActive()) return false;
      if (down) HJ.squawk(sim);
      return true;
    }
    if (CHOICE_ACTIONS.some((a) => isKey(sim, a, code))) {
      if (down) return UI.chooseByCode(code);
      return UI.isChoiceCode(code);
    }
    if (isKey(sim, 'eventSkip', code) && HJ.cinematicOn()) {
      if (down) HJ.skipCinematic();
      return true;
    }
    return false;
  },

  devActions: [
    {
      label: 'Trigger hijack event',
      hint: 'The hijack, now — the version everybody gets. Starts a long-haul Free Flight unless you are already flying one.',
      run(sim) {
        devHijack(sim, 'film');
      },
    },
    {
      label: 'Realistic hijack',
      hint: 'The by-the-book version: the locked door, 7500, the intercept signals, the remote runway. Starts a long-haul Free Flight unless you are already flying one.',
      run(sim) {
        devHijack(sim, 'real');
      },
    },
  ],
});

/**
 * Passengers, on every airliner flight: the owner's old ask (the evacuation,
 * in eject.js) and "the stuff related to that".
 *
 *   PEOPLE YOU CAN SEE   heads in the windows from outside, and the Cabin
 *                        view — the C key's cycle gains "Cabin" after "Wing"
 *                        in an airliner: standing at the back of the cabin,
 *                        looking up the aisle over everybody's heads, the
 *                        wing out of the windows. passengers/cabin.js.
 *   BOARDING             parked at a gate: the turnaround, as you would watch
 *                        it (passengers/turnaround.js). The jet bridge docks
 *                        at the front door (a stair truck on a remote stand),
 *                        the ground crew drives out by itself — stairs to the
 *                        back door, belt loader and baggage train, catering,
 *                        fuel — and they come aboard through the bridge and
 *                        in a line across the apron and up the stairs,
 *                        suitcases and all: "Boarding 142/180", the cabin
 *                        filling seat by seat. "Boarding complete", the doors
 *                        shut, the bridge pulls back, then the pushback is
 *                        yours (Y). 30-60 s watched. SKIPPABLE at any moment:
 *                        Y or a tap on the prompt, or "Skip boarding" on the
 *                        panel — everybody aboard, the crew in place, the
 *                        bridge back, at once; Settings → Flying "Skip the
 *                        boarding" does it for you. "Skip to the runway"
 *                        lines you up.
 *   DEPLANING            land, taxi to a gate, stop: the bridge docks, the
 *                        crew comes out, and they file off — the bridge, and
 *                        down the stairs and across to the terminal. Skippable
 *                        the same way ("Everyone off").
 *   COMFORT              passengers/comfort.js: smooth flying keeps them
 *                        happy; hard banks, high g, rough air, fast descents
 *                        and rough landings upset them. A calm meter (the
 *                        panel, passengers/ui.js) and a line at the end:
 *                        "Passengers: 4.6/5 — smooth landing!". The
 *                        achievement "Smooth Operator" for 4.8 or better.
 *   PA                   passengers/pa.js: welcome aboard, doors, take-off,
 *                        the seatbelt sign, top of descent, landing — as
 *                        subtitles only. No voice: nothing here makes a sound.
 *
 * NOT ON: Air Force One (its own missions, its own cabin and people), a
 * passenger seat (sim.riding — the President's), anything that is not an
 * airliner. Cargo types are not airliners (layout.js isAirlinerType).
 *
 * Performance: nothing is built for a flight with no passengers; the window
 * heads are one draw a fuselage piece and drawn only near the aeroplane; the
 * cabin is built only when you look at it; the panel is written four times a
 * second.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { EVENTS } from '../aircraft/physics.js';
import { VIEW_LABELS } from '../flight/camera.js';
import { doorsFor } from '../aircraft/extra/airliners.js';
import { standAt } from '../world/airport-layout.js';
import { RUNWAY } from '../world/airport.js';
import { keyName } from '../flight/input.js';
import { onBeforePushback, onServicesPrompt, servicesState, __airportServices } from './airport-services.js';
import { cabinFor, bookedFor, isAirlinerType } from './passengers/layout.js';
import { createComfort, stepComfort, touchdownComfort, rating, summary, moodWord, NOW_WORDS } from './passengers/comfort.js';
import { PA } from './passengers/pa.js';
import { PassengerPanel } from './passengers/ui.js';
import { WindowFaces, CabinInterior, SIL_NEAR } from './passengers/cabin.js';
import { PAX, clearJumpers } from './passengers/state.js';
import { boardSeconds, deplaneSeconds } from './passengers/boarding.js';
import {
  TA,
  beginTurnaround,
  resetTurnaround,
  stepBoarding,
  stepDeplaning,
  doorsReady,
  pullBridgeAway,
  keepBridgeAway,
  bridgeClear,
  skipTurnaround,
  closeStairsDoor,
  drawWalkers,
} from './passengers/turnaround.js';

/** Seconds, watched, to board a cabin of `n` and to empty it at the gate (boarding.js). */
export { boardSeconds, deplaneSeconds };
/** The rating that earns "Smooth Operator". */
export const SMOOTH_OPERATOR = 4.8;
const FPM = 196.850394;
const KT = 1.94384;

const S = {
  sim: null,
  seed: 0,
  comfort: null,
  pa: new PA(),
  panel: null,
  faces: null,
  facesModel: null,
  interior: null,
  cabinOn: false,
  cabinCam: { started: false },
  boundAc: null,
  fresh: false,
  airborneEver: false,
  airborneT: 0,
  stillT: 0,
  summaryShown: false,
  summary: null,
  pushPending: false,
  doorsOpen: false,
  doorT: 0,
  panelT: 0,
  layoutT: 0,
  last: null,
  /** For the tests: every PA line shown this flight. */
  said: [],
};

/* ------------------------------------------------------------------ */
/* Whose flight is this                                                 */
/* ------------------------------------------------------------------ */

function isAfo(sim) {
  const d = sim && sim.runner && sim.runner.def;
  if (!d || sim.mode !== 'mission') return false;
  return /^afo/i.test(String(d.id || '')) || /air force one/i.test(String(d.name || ''));
}

/** Should this flight carry passengers? */
export function carriesPassengers(sim) {
  if (!sim || !sim.aircraft || !sim.aircraftType) return false;
  if (sim.mode === 'drive' || sim.riding) return false;
  if (isAfo(sim)) return false;
  return isAirlinerType(sim.aircraftType);
}

function modelDoors(sim) {
  const d = sim.model && sim.model.userData && sim.model.userData.doors;
  return d && Array.isArray(d.list) && d.list.length ? d : null;
}

function groundSpeed(ac) {
  return Math.hypot(ac.vel.x, ac.vel.z);
}

/* ------------------------------------------------------------------ */
/* The flight's people                                                  */
/* ------------------------------------------------------------------ */

function teardown(sim) {
  if (S.faces) S.faces.dispose();
  S.faces = null;
  S.facesModel = null;
  if (S.interior) S.interior.dispose();
  S.interior = null;
  S.cabinOn = false;
  clearJumpers();
  PAX.active = false;
  PAX.cabin = null;
  PAX.booked = 0;
  PAX.aboard = 0;
  PAX.crew = 0;
  PAX.stage = 'flying';
  PAX.pilot = '';
  PAX.comfort = null;
  S.comfort = null;
  S.evacNoted = false;
  S.evacT = 0;
  S.doorT = 0;
  S.pa.reset();
  S.fresh = false;
  S.airborneEver = false;
  S.airborneT = 0;
  S.stillT = 0;
  S.summaryShown = false;
  S.summary = null;
  S.pushPending = false;
  S.doorsOpen = false;
  S.said = [];
  resetTurnaround(sim);
  if (S.panel) S.panel.render(null);
}

function setup(sim, mode, opts = {}) {
  teardown(sim);
  if (!carriesPassengers(sim)) return;
  const t = sim.aircraftType;
  const md = modelDoors(sim);
  const doors = md ? md.list : doorsFor(t.id) || [];
  PAX.cabin = cabinFor(t, doors);
  S.seed = (S.seed + 1) % 100000;
  PAX.booked = bookedFor(PAX.cabin, S.seed + (opts.seed || 0));
  PAX.crew = PAX.cabin.crew;
  PAX.active = true;
  // Aboard already unless this flight starts at a gate: decided on the first
  // frame (spawns.js moves the aeroplane to its stand after this hook).
  PAX.aboard = PAX.booked;
  PAX.stage = 'flying';
  S.comfort = createComfort();
  PAX.comfort = S.comfort;
  S.airborneEver = !!opts.airborne;
  // A mission has put the aeroplane where it starts already; Free Flight's
  // "Start at" (spawns.js) moves it after this hook — so decide now, and
  // again on the first frame.
  decideStart(sim);
  S.fresh = true;
  bindAircraft(sim);
}

/** On a stand, stopped (a gate start: nobody aboard yet), or not. */
function decideStart(sim) {
  const ac = sim.aircraft;
  const still = Math.hypot(ac.vel.x, ac.vel.y, ac.vel.z) < 0.6;
  if (!S.airborneEver && still && standAt(ac.pos.x, ac.pos.z, 2)) {
    PAX.aboard = 0;
    PAX.stage = 'gate';
  } else {
    PAX.aboard = PAX.booked;
    PAX.stage = still ? 'ready' : 'flying';
  }
}

/** First frame of a flight: decided again, now that everything has moved it. */
function firstFrame(sim) {
  S.fresh = false;
  decideStart(sim);
  if (!sim.aircraft.onGround && PAX.stage === 'flying') S.airborneEver = true;
}

function bindAircraft(sim) {
  const ac = sim.aircraft;
  if (!ac || S.boundAc === ac || typeof ac.on !== 'function') return;
  S.boundAc = ac;
  ac.on(EVENTS.TOUCHDOWN, (g) => {
    try {
      if (!PAX.active || !S.comfort || PAX.stage === 'evac' || PAX.aboard <= 0) return;
      if (!S.airborneEver) return;
      touchdownComfort(S.comfort, g);
    } catch (e) {
      console.warn('[passengers] touchdown', e);
    }
  });
  ac.on(EVENTS.CRASH, () => {
    if (S.faces) S.faces.setVisible(false);
  });
}

/* ------------------------------------------------------------------ */
/* Doors and the bridge                                                 */
/* ------------------------------------------------------------------ */

/** The front left main-deck door: the one the bridge goes to. */
function bridgeDoorId(sim) {
  const md = modelDoors(sim);
  const list = md ? md.list : (PAX.cabin && PAX.cabin.exits) || [];
  const L = list.filter((d) => d.side === 'left' && d.deck !== 'upper' && d.kind === 'passenger').sort((a, b) => a.z - b.z);
  return L.length ? L[0].id : null;
}

function setDoor(sim, open) {
  const md = modelDoors(sim);
  const id = bridgeDoorId(sim);
  S.doorsOpen = !!open;
  if (!md || !id) return;
  try {
    if (open) md.open(id);
    else md.close(id);
  } catch (e) {
    /* a door is a nicety */
  }
}

/** Stopped on a stand (any stand: a gate or a remote one). */
function onAStand(sim) {
  const ac = sim.aircraft;
  return !!(ac && standAt(ac.pos.x, ac.pos.z, 3));
}

/** The setting: skip the boarding (and the getting off) altogether. */
function autoSkip(sim) {
  return !!(sim && sim.settings && sim.settings.autoSkipBoarding);
}

/** Everyone on, now: the doors shut. `why` for the words. */
function finishBoarding(sim, why = '') {
  if (PAX.stage !== 'gate' && PAX.stage !== 'boarding') return false;
  PAX.aboard = PAX.booked;
  PAX.stage = 'ready';
  // Anybody still on the apron is aboard too.
  if (TA.stairs) TA.stairs.stream.clear();
  setDoor(sim, false);
  closeStairsDoor(sim);
  S.doorT = 1.2;
  say(sim, 'doors');
  if (why && sim.hud && sim.hud.notify) sim.hud.notify(why, 'good', 3);
  return true;
}

/**
 * Skip the boarding, whatever stage it is at: everybody aboard, the doors
 * shut, the ground crew parked round the aeroplane (sent for, if nobody had)
 * and the jet bridge back against the terminal — all at once. Then the
 * pushback is Y, as ever.
 */
function skipBoarding(sim, why = 'Everybody is aboard — doors closed. Ready for pushback.') {
  if (PAX.stage !== 'gate' && PAX.stage !== 'boarding') return false;
  if (TA.kind !== 'board') beginTurnaround(sim, 'board');
  finishBoarding(sim, why);
  S.doorT = 0;
  if (!S.airborneEver) skipTurnaround(sim);
  return true;
}

/**
 * airport-services asks before the tug pushes: if the doors are not shut yet,
 * the last passengers hurry aboard and the doors close first; and the bridge
 * pulls back off the door. The push starts when both have.
 */
function beforePush(sim) {
  if (!PAX.active) return undefined;
  // The push never waits for the boarding: asking for it is skipping it, so no flight starts later for having people on it.
  if (PAX.stage === 'gate' || PAX.stage === 'boarding') skipBoarding(sim, 'Everybody is aboard — doors closed. Pushing back.');
  if (S.doorT > 0 || (!S.airborneEver && !bridgeClear())) {
    S.pushPending = true;
    return 'wait';
  }
  return undefined;
}

/** Line up on the runway, ready to go (the panel's Skip to the runway). */
function skipToRunway(sim) {
  const ac = sim.aircraft;
  if (!ac || !ac.onGround || S.airborneEver) return false;
  if (PAX.stage === 'gate' || PAX.stage === 'boarding') finishBoarding(sim);
  S.doorT = 0;
  resetTurnaround(sim);
  // Eighty metres in from the threshold, on whichever runway this map has
  // (missions.js RUNWAY_START's sum; not imported, to keep the missions out of here).
  const h = (RUNWAY.headingDeg ?? 90) * (Math.PI / 180);
  const pos = new THREE.Vector3(RUNWAY.thresholdWest.x + Math.sin(h) * 80, RUNWAY.elev, RUNWAY.thresholdWest.z - Math.cos(h) * 80);
  ac.reset({ pos, headingDeg: RUNWAY.headingDeg ?? 90, engineOn: true });
  if (typeof sim.restoreTakeoffConfig === 'function') sim.restoreTakeoffConfig();
  if (sim.taxi && sim.taxi.active && sim.taxi.stop) sim.taxi.stop();
  try {
    if (__airportServices && __airportServices.S && sim.apron && sim.apron.dismissCrew) sim.apron.dismissCrew();
  } catch (e) {
    /* the crew is a nicety */
  }
  if (sim.hud && sim.hud.notify) sim.hud.notify('Lined up on the runway — full power when you are ready.', 'good', 3.5);
  S.pushPending = false;
  PAX.stage = 'ready';
  return true;
}

function onButton(act) {
  const sim = S.sim;
  if (!sim || sim.state !== 'flying') return;
  if (act === 'skipBoarding') skipBoarding(sim);
  else if (act === 'skipRunway') skipToRunway(sim);
  else if (act === 'skipDeplane') skipDeplaning(sim);
}

function finishDeplaning(sim) {
  if (PAX.stage !== 'deplaning') return false;
  PAX.aboard = 0;
  PAX.stage = 'off';
  say(sim, 'thanks');
  setDoor(sim, true);
  closeStairsDoor(sim);
  return true;
}

/** Everyone off, now (waiting for the bridge, or part-way through). */
function skipDeplaning(sim) {
  if (PAX.stage === 'arrived' && TA.kind === 'deplane') PAX.stage = 'deplaning';
  if (PAX.stage !== 'deplaning') return false;
  skipTurnaround(sim);
  return finishDeplaning(sim);
}

/*
 * The ground crew's prompt while the turnaround is on: what it is doing, and
 * that Y or a tap skips it. One object, rewritten only when its words change.
 */
const PROMPT = { html: '', action: null };
const ACT = {
  board: () => S.sim && skipBoarding(S.sim),
  deplane: () => S.sim && skipDeplaning(S.sim),
  push: () => {
    const sim = S.sim;
    if (!sim) return;
    // Skip the wait for the bridge too: it is back now, and the tug comes.
    S.doorT = 0;
    pullBridgeAway(sim, true);
    S.pushPending = true;
  },
};
function prompt(html, action) {
  if (PROMPT.html !== html) PROMPT.html = html;
  PROMPT.action = action;
  return PROMPT;
}
function servicesPrompt(sim) {
  if (!PAX.active || !sim || sim.state !== 'flying' || !sim.aircraft || !sim.aircraft.onGround) return null;
  const k = keyName('services', sim);
  const st = PAX.stage;
  if (st === 'gate') {
    const what = TA.bridged ? 'The jet bridge is coming out to the door' : 'The stairs are on their way';
    return prompt(`${what} — <kbd>${k}</kbd> or tap here to skip the boarding`, ACT.board);
  }
  if (st === 'boarding') return prompt(`Boarding <b>${Math.floor(PAX.aboard)}/${PAX.booked}</b> — <kbd>${k}</kbd> or tap here to skip`, ACT.board);
  if (st === 'ready' && !S.airborneEver && (S.doorT > 0 || !bridgeClear())) {
    if (S.pushPending) return prompt('Pushback as soon as the jet bridge is clear of the door…', null);
    return prompt(`Boarding complete — doors shut, the jet bridge is pulling back. <kbd>${k}</kbd> or tap here to push back`, ACT.push);
  }
  if (TA.kind === 'deplane' && st === 'arrived') {
    const what = TA.bridged ? 'The jet bridge is coming out to the door' : 'The stairs are on their way';
    return prompt(`${what} — <kbd>${k}</kbd> or tap here to let everyone off now`, ACT.deplane);
  }
  if (st === 'deplaning') return prompt(`Getting off <b>${Math.ceil(PAX.aboard)}/${PAX.booked}</b> — <kbd>${k}</kbd> or tap here to skip`, ACT.deplane);
  return null;
}

/* ------------------------------------------------------------------ */
/* The PA                                                               */
/* ------------------------------------------------------------------ */

function say(sim, id) {
  S.pa.say(id, { field: sim && sim.atc && sim.atc.field });
}

function subtitleFree(hud) {
  if (!hud) return false;
  if (hud.subtitlesEnabled === false) return false;
  return !(hud.subtitleTimer > 0) && !(hud.subtitleFade > 0);
}

function flushPA(sim) {
  const hud = sim.hud;
  const line = S.pa.next(subtitleFree(hud));
  if (!line) return;
  S.said.push(line.id);
  try {
    if (hud && hud.setSubtitle) hud.setSubtitle(line.text, line.id === 'evac' ? 'Captain' : 'Cabin PA', 5);
  } catch (e) {
    /* the PA is a nicety */
  }
}

/* ------------------------------------------------------------------ */
/* Every frame                                                          */
/* ------------------------------------------------------------------ */

function stepGate(sim, dt) {
  const ac = sim.aircraft;
  const gs = groundSpeed(ac);
  // The doors shutting; then the bridge pulls back off them; then, if it was
  // asked for, the push.
  if (S.doorT > 0) {
    S.doorT -= dt;
    if (S.doorT <= 0 && !S.airborneEver && ac.onGround) pullBridgeAway(sim);
  }
  // Rolling again (taxiing off after the push): the next stand's bridge is free to dock.
  if (TA.held && gs > 2) TA.held = false;
  if (PAX.stage === 'ready' && !S.airborneEver) keepBridgeAway(sim);
  if (S.pushPending && !(S.doorT > 0) && bridgeClear()) {
    S.pushPending = false;
    try {
      if (__airportServices && typeof __airportServices.startPush === 'function') __airportServices.startPush(sim);
    } catch (e) {
      console.warn('[passengers] pushback', e);
    }
  }
  if (PAX.stage === 'gate' || PAX.stage === 'boarding') {
    // Off the stand before they were all on: they were all on.
    if (!ac.onGround || gs > 1.2) {
      finishBoarding(sim);
      return;
    }
    if (TA.kind !== 'board') beginTurnaround(sim, 'board');
    if (autoSkip(sim)) {
      skipBoarding(sim, 'Boarding skipped (Settings) — everybody is aboard, doors closed.');
      return;
    }
    // The doors open once the bridge is on them (or the stairs, on a remote stand).
    if (PAX.stage === 'gate' && doorsReady(sim)) {
      PAX.stage = 'boarding';
      setDoor(sim, true);
      say(sim, 'welcome');
    }
    const got = stepBoarding(sim, dt, PAX.stage === 'boarding');
    if (got > 0 && PAX.stage === 'gate') {
      PAX.stage = 'boarding';
      setDoor(sim, true);
      say(sim, 'welcome');
    }
    if (PAX.stage === 'boarding') {
      PAX.aboard = Math.min(PAX.booked, PAX.aboard + got);
      const walking = TA.stairs && TA.stairs.stream.list.length;
      if (PAX.aboard >= PAX.booked - 1e-6 && !walking) finishBoarding(sim, 'Boarding complete — closing the doors.');
    }
    return;
  }
  // Getting off: back on a stand after a flight, stopped.
  if (S.airborneEver && PAX.stage === 'arrived' && PAX.aboard > 0) {
    if (ac.onGround && gs < 0.6 && onAStand(sim)) {
      if (TA.kind !== 'deplane') beginTurnaround(sim, 'deplane');
      if (autoSkip(sim)) {
        skipDeplaning(sim);
        return;
      }
      stepDeplaning(sim, dt, false);
      if (doorsReady(sim)) {
        PAX.stage = 'deplaning';
        setDoor(sim, true);
      }
    } else if (TA.kind === 'deplane' && gs > 1.2) {
      resetTurnaround(sim);
    }
  }
  if (PAX.stage === 'deplaning') {
    if (gs > 1.2) {
      PAX.stage = 'arrived';
      setDoor(sim, false);
      closeStairsDoor(sim);
      resetTurnaround(sim);
      return;
    }
    const off = stepDeplaning(sim, dt, true);
    PAX.aboard = Math.max(0, PAX.aboard - off);
    if (PAX.aboard <= 1e-6) finishDeplaning(sim);
  } else if (PAX.stage === 'off' && TA.kind === 'deplane' && TA.stairs) {
    // The last of them walking over to the terminal.
    stepDeplaning(sim, dt, false);
  }
}

function stepFlight(sim, dt) {
  const ac = sim.aircraft;
  if (!ac.onGround) {
    S.airborneT += dt;
    if (S.airborneT > 2) {
      S.airborneEver = true;
      if (PAX.stage !== 'evac') PAX.stage = 'flying';
      S.summaryShown = false;
    }
    S.stillT = 0;
  } else {
    S.airborneT = 0;
    if (S.airborneEver && PAX.stage === 'flying') PAX.stage = 'arrived';
  }
  const people = PAX.aboard > 0 && PAX.stage !== 'evac';
  if (S.comfort && people && !ac.crashed) {
    const gs = groundSpeed(ac);
    stepComfort(S.comfort, dt, {
      bankDeg: ac.bankAngleDeg(),
      g: ac.gLoad,
      vsFpm: ac.vs * FPM,
      turb: sim.weather && typeof sim.weather.turbulenceLevel === 'function' ? sim.weather.turbulenceLevel() : 0,
      airborne: !ac.onGround,
      stopped: ac.onGround && gs < 1,
    });
  }
  // The end of a flight: down, and slowed to a walk for two seconds.
  if (S.airborneEver && ac.onGround && !ac.crashed && groundSpeed(ac) < 3 && S.comfort && S.comfort.landings > 0 && PAX.stage !== 'evac') {
    S.stillT += dt;
    if (S.stillT > 2 && !S.summaryShown) showSummary(sim);
  }
  // The PA.
  const gearDown = ac.gearDown !== false;
  S.pa.update(dt, {
    stage: PAX.stage,
    onGround: ac.onGround,
    ias: (ac.ias || 0) * KT,
    aglM: ac.agl || 0,
    vsFpm: ac.vs * FPM,
    throttle: (ac.controls && ac.controls.throttle) || 0,
    gearDown,
    turb: sim.weather && typeof sim.weather.turbulenceLevel === 'function' ? sim.weather.turbulenceLevel() : 0,
    airborneEver: S.airborneEver,
    airborneT: S.airborneT,
    field: sim.atc && sim.atc.field,
  });
}

/**
 * The evacuation's end: once a second, are they all down? Then say so, and
 * note it for "Last One Out" — passengers and crew all landed, nobody aboard.
 */
function watchEvacuation(sim, dt) {
  S.evacT = (S.evacT || 0) - dt;
  if (S.evacT > 0 || S.evacNoted) return;
  S.evacT = 1;
  const J = PAX.jumpers;
  if (!J || !J.count || PAX.aboard > 0.5 || PAX.crew > 0) return;
  // You too (and the words wait until you can read them: under your own canopy the HUD is quiet).
  if (PAX.pilot !== 'down') return;
  if (J.airborne() > 0) return;
  S.evacNoted = true;
  const people = PAX.out.pax + PAX.out.crew;
  if (sim.hud && sim.hud.notify) {
    const wet = J.inWater > 0 ? ' The rescue boats are picking up everyone who came down in the sea.' : '';
    sim.hud.notify(`Everybody is down safely — ${PAX.out.pax} passengers and ${PAX.out.crew} crew.${wet}`, 'good', 6);
  }
  import('./achievements/index.js')
    .then((m) => {
      if (m && typeof m.notePassengers === 'function') m.notePassengers(sim, { evacuated: true, people });
    })
    .catch(() => {});
}

function showSummary(sim) {
  S.summaryShown = true;
  const s = summary(S.comfort);
  S.summary = s;
  // A mission has its own debrief, which reads this; Free Flight gets a banner.
  if (sim.mode !== 'mission' && sim.hud && sim.hud.showBanner) {
    sim.hud.showBanner(`Passengers: ${s.rating.toFixed(1)}/5`, s.text.charAt(0).toUpperCase() + s.text.slice(1), s.rating >= 3.5 ? 'good' : 'info', 5);
  }
  import('./achievements/index.js')
    .then((m) => {
      if (m && typeof m.notePassengers === 'function') m.notePassengers(sim, { rating: s.rating, landed: true, crashed: !!S.comfort.crashed, aircraft: sim.aircraftType && sim.aircraftType.id });
    })
    .catch(() => {});
}

/* ------------------------------------------------------------------ */
/* What you see                                                         */
/* ------------------------------------------------------------------ */

function syncFaces(sim) {
  if (!PAX.active || !sim.model) {
    if (S.faces) S.faces.setVisible(false);
    return;
  }
  if (S.facesModel !== sim.model) {
    if (S.faces) S.faces.dispose();
    S.faces = new WindowFaces(sim.scene, sim.model, S.seed);
    S.facesModel = sim.model;
    if (!S.faces.count) {
      S.faces.dispose();
      S.faces = null;
    }
  }
  if (!S.faces) return;
  const ac = sim.aircraft;
  S.faces.setFull(PAX.booked ? PAX.aboard / PAX.booked : 0);
  const near = sim.camera && sim.camera.position.distanceTo(ac.pos) < SIL_NEAR;
  S.faces.setVisible(near && !S.cabinOn && !ac.crashed && PAX.aboard > 0.5);
}

function cabinAvailable(sim) {
  return PAX.active && !!PAX.cabin && sim.state === 'flying' && !(sim.walking && sim.walking.active) && PAX.stage !== 'evac' && !(sim.aircraft && sim.aircraft.crashed);
}

function installCabinView(sim) {
  const rig = sim.rig;
  if (!rig || rig._paxCabin || typeof rig.cycle !== 'function') return;
  VIEW_LABELS.cabin = 'Cabin';
  const inner = rig.cycle;
  Object.defineProperty(rig, '_paxCabin', { value: true, enumerable: false });
  rig.cycle = function cycleWithCabin(...args) {
    try {
      if (S.cabinOn) {
        S.cabinOn = false;
        return inner.apply(this, args);
      }
      if (this.mode === 'wing' && cabinAvailable(S.sim || sim)) {
        S.cabinOn = true;
        S.cabinCam.started = false;
        return 'cabin';
      }
    } catch (e) {
      S.cabinOn = false;
    }
    return inner.apply(this, args);
  };
}

const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3();

function cabinCamera(sim, dt, cam) {
  const ac = sim.aircraft;
  const model = sim.model;
  if (!S.interior) {
    S.interior = new CabinInterior(PAX.cabin, PAX.booked, S.seed);
    sim.scene.add(S.interior.root);
  }
  const I = S.interior;
  I.setAboard(PAX.aboard, PAX.stage === 'boarding' ? 'in' : PAX.stage === 'deplaning' ? 'out' : null);
  // The model's own place (fleet models sit a little above the physics origin).
  const pos = model ? model.position : ac.pos;
  const q = model ? model.quaternion : ac.quat;
  I.root.position.copy(pos);
  I.root.quaternion.copy(q);
  I.root.visible = true;
  // A little sway with the air, never a shake: the camera is part of the aeroplane.
  _v.copy(I.eye).applyQuaternion(q).add(pos);
  _w.copy(I.look).applyQuaternion(q).add(pos);
  _up.set(0, 1, 0).applyQuaternion(q);
  cam.position.copy(_v);
  cam.up.copy(_up);
  cam.lookAt(_w);
  cam.up.set(0, 1, 0);
  if (Math.abs(cam.fov - 66) > 0.01) {
    cam.fov = 66;
    cam.updateProjectionMatrix();
  }
  return true;
}

function renderPanel(sim) {
  if (!S.panel) return;
  const ac = sim.aircraft;
  if (!PAX.active || !S.comfort || sim.state !== 'flying' || PAX.stage === 'evac' || (sim.walking && sim.walking.active)) {
    S.panel.render(null);
    return;
  }
  const c = S.comfort;
  let board = null;
  const buttons = [];
  const yk = keyName('services', sim);
  const waitingOff = TA.kind === 'deplane' && PAX.stage === 'arrived' && PAX.aboard > 0;
  if (PAX.stage === 'gate') board = { text: TA.bridged || !TA.kind ? 'Jet bridge coming' : 'Stairs coming', n: Math.round(PAX.aboard), of: PAX.booked };
  else if (PAX.stage === 'boarding') board = { text: 'Boarding', n: Math.floor(PAX.aboard), of: PAX.booked };
  else if (PAX.stage === 'deplaning' || waitingOff) board = { text: 'Getting off', n: Math.ceil(PAX.aboard), of: PAX.booked };
  if (PAX.stage === 'gate' || PAX.stage === 'boarding') buttons.push({ act: 'skipBoarding', label: 'Skip boarding', key: yk });
  if (PAX.stage === 'deplaning' || waitingOff) buttons.push({ act: 'skipDeplane', label: 'Everyone off', key: yk });
  if (ac.onGround && !S.airborneEver && (PAX.stage === 'ready' || PAX.stage === 'gate' || PAX.stage === 'boarding')) {
    const st = servicesState();
    if (st.state !== 'pushback') buttons.push({ act: 'skipRunway', label: 'Skip to the runway' });
  }
  let now = c.now ? NOW_WORDS[c.now] : '';
  if (!now && PAX.stage === 'ready' && ac.onGround && !S.airborneEver) {
    const st = servicesState();
    if (S.doorT > 0) now = 'Boarding complete — doors closing';
    else if (!bridgeClear()) now = 'Doors shut — the jet bridge is pulling back';
    else now = st.state === 'serviced' || st.state === 'onStand' ? `Doors closed — ${yk} for pushback` : st.state === 'pushback' ? 'Pushing back' : '';
  }
  // The same count as the counter beside it (it read "71 aboard" over "Boarding 70/157").
  const shownAboard = board ? board.n : Math.round(PAX.aboard);
  S.panel.render({
    show: true,
    rating: rating(c),
    mood: moodWord(c.mood),
    aboard: shownAboard,
    now,
    board,
    final: S.summary && S.summaryShown ? S.summary.line : '',
    buttons,
  });
}

/* ------------------------------------------------------------------ */
/* The extension                                                        */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'passengers',

  install(sim) {
    S.sim = sim;
    // The passenger missions (game/more/passengers.js) read the flight from here.
    sim.passengers = passengers;
    PAX.sayEvacuation = paEvacuation;
    S.panel = new PassengerPanel(sim, { onButton });
    installCabinView(sim);
    onBeforePushback((s) => beforePush(s || sim));
    // The ground crew's prompt says what the turnaround is doing, and that Y skips it.
    onServicesPrompt((s) => servicesPrompt(s || sim));
    // The debrief of an airliner flight says what the passengers thought: one
    // more line on the list main.js writes ("Passengers 4.6/5 — smooth landing!").
    const menus = sim.menus;
    if (menus && typeof menus.showDebrief === 'function' && !menus._paxDebrief) {
      const inner = menus.showDebrief;
      Object.defineProperty(menus, '_paxDebrief', { value: true, enumerable: false });
      menus.showDebrief = function debriefWithPassengers(opts, ...rest) {
        try {
          if (opts && opts.kind === 'good' && typeof opts.body === 'string' && PAX.active && S.comfort && S.comfort.landings > 0 && PAX.stage !== 'evac') {
            const s = summary(S.comfort);
            const li = `<li>Passengers <b>${s.rating.toFixed(1)}/5</b> — ${s.text}</li>`;
            if (opts.body.includes('<ul class="debrief-list">')) opts = { ...opts, body: opts.body.replace('<ul class="debrief-list">', `<ul class="debrief-list">${li}`) };
          }
        } catch (e) {
          /* the line is a nicety */
        }
        return inner.call(this, opts, ...rest);
      };
    }
  },

  startMode(sim, mode, opts) {
    S.sim = sim;
    setup(sim, mode, opts || {});
  },

  stop(sim, why) {
    // "Back to the runway" carries on flying: a fresh flight's people, aboard.
    if (why === 'airport') setup(sim, sim.mode, {});
    else teardown(sim);
  },

  update(sim, dt) {
    S.sim = sim;
    if (!(dt > 0)) return;
    dt = Math.min(dt, 0.1);
    // The aeroplane changed under us (the hangar, a mission's own): start again.
    const t = sim.aircraftType;
    if (PAX.active && t && PAX.cabin && PAX.cabin.id !== t.id) setup(sim, sim.mode, {});
    if (PAX.active && !carriesPassengers(sim)) teardown(sim);
    if (PAX.jumpers) PAX.jumpers.update(dt, sim.weather && sim.weather.windVector ? sim.weather.windVector(_v) : null);
    if (!PAX.active || sim.state !== 'flying' || !sim.aircraft) {
      if (S.interior) S.interior.root.visible = false;
      return;
    }
    bindAircraft(sim);
    if (S.fresh) firstFrame(sim);
    if (PAX.stage === 'evac') watchEvacuation(sim, dt);
    if (S.cabinOn && (!sim.rig || sim.rig.mode !== 'wing' || !cabinAvailable(sim))) S.cabinOn = false;
    if (!S.cabinOn && S.interior) S.interior.root.visible = false;
    stepGate(sim, dt);
    stepFlight(sim, dt);
    flushPA(sim);
    drawWalkers(sim);
    S.panelT -= dt;
    if (S.panelT <= 0) {
      S.panelT = 0.25;
      renderPanel(sim);
    }
    S.layoutT -= dt;
    if (S.layoutT <= 0 && S.panel) {
      S.layoutT = 0.5;
      S.panel.layout();
    }
  },

  camera(sim, dt, cam) {
    syncFaces(sim);
    if (!S.cabinOn || !cabinAvailable(sim) || !cam) return false;
    return cabinCamera(sim, dt, cam);
  },

  devActions: [
    {
      label: 'Passengers: start an A320 at a gate',
      hint: 'Free Flight at a gate with a jet bridge: boarding, the comfort meter, the PA',
      run(sim) {
        if (typeof sim.startMode === 'function') sim.startMode('free', { aircraft: 'a320', startAt: 'gate', taxi: false });
      },
    },
    {
      label: 'Passengers: an A320 at 6,000 ft (try Enter twice)',
      hint: 'Airborne in the A320: the evacuation — passengers first, then the crew, then you',
      run(sim) {
        if (typeof sim.startMode === 'function') sim.startMode('free', { aircraft: 'a320', airborne: true, taxi: false });
      },
    },
  ],
});

/** Say the evacuation line (eject.js, as it starts). */
export function paEvacuation(sim) {
  S.pa.say('evac', {}, true);
  if (sim) flushPA(sim);
}

/** For the tests, the console and the passenger missions. */
export const passengers = {
  get state() {
    return PAX;
  },
  get comfort() {
    return S.comfort;
  },
  get rating() {
    return S.comfort ? rating(S.comfort) : 0;
  },
  summary() {
    return S.comfort ? summary(S.comfort) : null;
  },
  get summaryShown() {
    return S.summaryShown;
  },
  get cabinOn() {
    return S.cabinOn;
  },
  get interior() {
    return S.interior;
  },
  get faces() {
    return S.faces;
  },
  get said() {
    return S.said.slice();
  },
  get pa() {
    return S.pa;
  },
  get airborneEver() {
    return S.airborneEver;
  },
  panel() {
    return S.panel ? S.panel.snapshot() : null;
  },
  press: onButton,
  finishBoarding: (sim) => finishBoarding(sim || S.sim),
  skipBoarding: (sim) => skipBoarding(sim || S.sim),
  skipDeplaning: (sim) => skipDeplaning(sim || S.sim),
  /** The turnaround at the stand (passengers/turnaround.js): the bridge, the crew, the line to the stairs. */
  get turnaround() {
    return TA;
  },
  get pushPending() {
    return S.pushPending;
  },
  skipToRunway: (sim) => skipToRunway(sim || S.sim),
  carriesPassengers,
  /** Is the flight's boarding done (doors shut)? */
  ready() {
    // No passengers on this flight (or the feature switched off): nobody to wait for.
    if (!PAX.active) return true;
    return PAX.stage !== 'gate' && PAX.stage !== 'boarding' && !(S.doorT > 0);
  },
};

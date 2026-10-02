/**
 * Getting out in the air: the EJECT button, passengers first, self-destruct
 * on the special planes, and drag parachutes on the landing roll.
 *
 * From the owner's handwritten list: "eject button", "on some planes you
 * cannot eject until other passengers get ejected", "self destruct on
 * special planes" — and, from the same page, "uniforms based on planes".
 *
 * EJECT — Enter (press twice), or the striped EJECT button: on a tablet, and in
 *   Free Flight on a laptop too, once you are high enough (showEject). The
 *   seat rockets you out, the parachute opens, and you float down (A / D to
 *   steer, S to sink faster). Land and you are on foot (onfoot.js walks you)
 *   in the uniform for what you flew; the empty aeroplane carries on without
 *   you, noses over, and crashes — a cartoon crash, with a bang, and no
 *   "Crashed" screen, because you are fine. Enter again flies again.
 *   Not while parked: on the ground it says to stop and press O.
 *   Light aeroplanes have no seat: you bail out of the door (needs 60 m).
 *   The helicopter, in Free Flight: out of the side door (needs 100 m).
 *   Airliners (and the helicopter in a mission) have no way out, and say so
 *   kindly.
 *
 * PASSENGERS FIRST — on the Nightjar B-2 and the Osprey (two crew with seats
 *   of their own) and the Tempest (a scientist aboard), the first press sends
 *   the crew: "Crew out first — press Enter again". Their parachutes float
 *   down beside yours and they wave when they land.
 *
 * SELF-DESTRUCT — Backspace, on the special planes (the B-2, the F-22, the
 *   F-35B, Air Massimo — not T-Pose Harrison: he is a person, and a person
 *   has no self-destruct). Guarded: the first press lifts the
 *   safety cover, the second starts a 5-second countdown, and any press
 *   during it cancels. EJECT during the countdown; if you have not by the
 *   last second, the seat fires you out anyway — it is a game for ten-year-
 *   olds, nobody goes up with the plane. Then a big cartoon boom.
 *
 * DRAG CHUTE — see eject/dragchute.js. Only Air Massimo and T-Pose Harrison
 *   carry one, and it comes out only when you pull it: the Drag chute key
 *   (; by default — input.js ACTIONS.dragChute, so Settings can move it) or
 *   the CHUTE button a touch screen shows on the landing roll. The brakes
 *   are just the brakes. Asked for at the wrong moment, it says why.
 *
 * T-POSE HARRISON is the whole aeroplane (profiles.js `ends`): out in the air
 * he opens his own parachute where he is, and that is the end of the flight
 * — nothing flies on without him, so there is no empty aeroplane to crash.
 * The aeroplane's state stops (its physics gated off, endGate below) and
 * follows him down, so the map and the multiplayer snapshot stay on him.
 *
 * WHAT IT TOUCHES IN THE GAME, since main.js is not ours: the empty
 * aeroplane is flown through `sim.override` (the input main.js applies over
 * the keyboard every frame), `sim.showCrashDebrief` is wrapped so the crash
 * of an aeroplane you are not in does not end the flight, and `sim.walking`
 * tells stovl.js the pilot has gone (its hover switches off, so an empty
 * F-35B falls rather than hovering for ever). Everything is put back on the
 * next flight.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { registerActions, isKey, heldKey, keyName, kbd, live } from '../flight/input.js';
import { EVENTS, SPEC } from '../aircraft/physics.js';
import { heightAt } from '../world/terrain.js';
import { groundAt, solidAt, WALK } from './staff/walk.js';
import { posePerson } from './staff/person.js';
import * as FootUI from './staff/ui.js';
import { onFoot } from './onfoot.js';
import { explode } from './explosions.js';
import { profileFor, profileIn, listed } from './eject/profiles.js';
import { uniformFor, createUniformPerson, poseHanging, UNIFORMS } from './uniforms.js';
import { ChuteFlight, ChuteModel } from './eject/chute.js';
import { DRAG_CHUTE, CHUTE_DEFAULT_KEY, applyChute, chuteBlocker, chuteWords, DragChuteModel } from './eject/dragchute.js';
import { keyLabel } from '../flight/input.js';
import * as UI from './eject/ui.js';

const KT = 1.94384;
const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Seconds a first press of Enter waits for the second. */
const ARM_SECONDS = 3;
/** Seconds the self-destruct safety cover stays open, and the countdown. */
const COVER_SECONDS = 4;
const COUNT_SECONDS = 5;
/** Light aeroplanes: the least height to bail out from, metres. */
const BAIL_MIN_AGL = 60;
/** An empty aeroplane that has somehow not come down by now is brought down. */
const EMPTY_MAX_SECONDS = 40;

/*
 * The keys, in the one registry (Settings → Controls): eject and
 * self-destruct with the aeroplane's, the parachute's own, and "fly again"
 * once you are down (runaway.js's "start again" is the same action).
 */
registerActions({
  eject: { label: 'Eject (press twice; crew go first)', group: 'Flying', ctx: ['plane', 'heli'], default: ['Enter', 'NumpadEnter'] },
  selfDestruct: { label: 'Self-destruct (special planes: press twice, again to cancel)', group: 'Flying', ctx: ['plane'], default: ['Backspace'] },
  chuteLeft: { label: 'Parachute: steer left', group: 'Flying', ctx: ['chute'], default: ['KeyA', 'ArrowLeft'] },
  chuteRight: { label: 'Parachute: steer right', group: 'Flying', ctx: ['chute'], default: ['KeyD', 'ArrowRight'] },
  chuteSink: { label: 'Parachute: sink faster', group: 'Flying', ctx: ['chute'], default: ['KeyS', 'ArrowDown', 'Space'] },
  chuteLookLeft: { label: 'Parachute: look left', group: 'Flying', ctx: ['chute'], default: ['KeyQ'] },
  chuteLookRight: { label: 'Parachute: look right', group: 'Flying', ctx: ['chute'], default: ['KeyE'] },
  flyAgain: { label: 'Fly again (after ejecting, or a runaway)', group: 'On foot', ctx: ['foot'], default: ['Enter', 'NumpadEnter'] },
});

/** Keys that are not anybody's action: never taken while you hang under a canopy. */
const PASS = new Set(['Escape', 'Tab', 'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight']);
/** ...and the game's own keys, wherever the player has put them. */
const GAME_ACTIONS = ['pause', 'help', 'hideUi', 'guide', 'mute', 'minimap', 'minimapRange'];

const S = {
  sim: null,
  prof: null,
  typeId: '',
  /** 'idle' (in the seat) | 'out' (under a canopy) | 'walking' (landed) */
  phase: 'idle',
  armedT: 0,
  crewOut: false,
  me: null,
  crew: [],
  ghost: null,
  /** Out of an aeroplane that is its own pilot (Harrison): the flight has simply ended. */
  ended: false,
  prevOverride: null,
  emptyT: 0,
  planeDown: false,
  sd: { state: 'off', t: 0, shown: -1 },
  drag: { state: 'stowed', fill: 0, model: null, airT: 0, armed: false, hinted: false, via: '', t: 0 },
  keys: Object.create(null),
  cam: { pos: new THREE.Vector3(), started: false, yaw: 0 },
  touchHidden: false,
  hudHidden: false,
  audioFaded: false,
  boundAc: null,
  control: null,
  gateT: 0,
  walked: null,
  landedAt: null,
  lastEject: null,
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _up = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _look = new THREE.Vector3();

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function notify(sim, text, kind = 'info', secs = 3.5) {
  try {
    const n = S.notifyOrig || (sim.hud && sim.hud.notify && sim.hud.notify.bind(sim.hud));
    if (n) n(text, kind, secs);
  } catch (e) {
    /* a HUD that is not there is not worth a thrown frame */
  }
}

function banner(sim, title, sub, kind = 'good', secs = 4) {
  try {
    if (sim.hud && sim.hud.showBanner) sim.hud.showBanner(title, sub, kind, secs);
  } catch (e) {
    /* same */
  }
}

function isTouch(sim) {
  return !!(sim && sim.touch);
}

/** How the press being handled came: 'key' (Enter), 'tap' or 'click' (the EJECT button), '' (a direct call). */
let via = '';

/** The word for pressing the button again — 'Tap', 'Click' — or '' when Enter is the way to say it. */
function byButton(sim) {
  if (via === 'click') return 'Click';
  return via === 'tap' || (via !== 'key' && isTouch(sim)) ? 'Tap' : '';
}

/** Enter, or the EJECT button, saying which, for the words that come back. */
function pressFrom(sim, how) {
  via = how;
  try {
    return pressEject(sim);
  } finally {
    via = '';
  }
}

function mixer(sim) {
  const a = sim && sim.audio;
  return a && a.available && a.mixer ? a.mixer : null;
}

/** A short procedural sound: never a file, never loud. */
function sound(sim, what) {
  const mx = mixer(sim);
  if (!mx) return;
  try {
    if (what === 'eject') {
      mx.noiseBurst({ bus: 'environment', duration: 0.5, gain: 0.22, type: 'bandpass', freq: 700, q: 0.6 });
      mx.tone({ bus: 'alerts', freq: 220, sweepTo: 660, duration: 0.35, gain: 0.08, type: 'sawtooth' });
    } else if (what === 'open') {
      mx.noiseBurst({ bus: 'environment', duration: 0.25, gain: 0.16, type: 'lowpass', freq: 500, q: 0.7 });
    } else if (what === 'beep') {
      mx.tone({ bus: 'alerts', freq: 988, duration: 0.14, gain: 0.12, type: 'square' });
    } else if (what === 'cover') {
      mx.tone({ bus: 'alerts', freq: 440, duration: 0.08, gain: 0.07, type: 'triangle' });
    } else if (what === 'cancel') {
      mx.tone({ bus: 'alerts', freq: 660, sweepTo: 330, duration: 0.3, gain: 0.08, type: 'sine' });
    } else if (what === 'chute') {
      mx.noiseBurst({ bus: 'environment', duration: 0.35, gain: 0.18, type: 'bandpass', freq: 380, q: 0.8 });
    }
  } catch (e) {
    /* sound is a nicety */
  }
}

/** The aeroplane is the thing being flown right now (not the boat, not walking, not a menu). */
function inAircraft(sim) {
  return !!(sim && sim.state === 'flying' && sim.mode !== 'drive' && sim.aircraft && sim.aircraftType && !onFoot.active);
}

/** This aeroplane's way out in this mode: the helicopter's door is Free Flight's (profiles.js). */
function profileOf(sim) {
  return profileIn(sim.aircraftType, sim.mode);
}

/** Where the pilot sits, in the world. */
function seatWorld(sim, out) {
  const ac = sim.aircraft;
  const rig = sim.rig;
  if (rig && rig.eye && rig.eye.isVector3) out.copy(rig.eye);
  else {
    const sh = sim.aircraftType.shape || {};
    const k = sh.scale || 1;
    const e = sh.eye || [0, 0.5, -1];
    out.set(e[0] * k, e[1] * k, e[2] * k);
  }
  return out.applyQuaternion(ac.quat).add(ac.pos);
}

/** The ground (or the sea) under a point. */
function floorAt(x, z) {
  const g = groundAt(x, z);
  return Number.isFinite(g) ? Math.max(g, 0) : 0;
}

function windOf(sim, out) {
  const w = sim.weather;
  if (w && typeof w.windVector === 'function') return w.windVector(out);
  return out.set(0, 0, 0);
}

function passes(sim, code) {
  if (PASS.has(code) || /^F\d+$/.test(code)) return true;
  for (const a of GAME_ACTIONS) if (isKey(sim, a, code)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* The controls line and the H card                                    */
/* ------------------------------------------------------------------ */

/**
 * The keys the drag chute is on right now. It is a named action
 * (input.js ACTIONS.dragChute), so Settings can move it — or take it away,
 * when another action is given its key.
 */
function chuteKeys(sim) {
  const b = sim && sim.input && sim.input.bindings;
  return b && Array.isArray(b.dragChute) ? b.dragChute : [CHUTE_DEFAULT_KEY];
}

/** The drag chute's key as a <kbd>, or '' if the player has left it on no key. */
function chuteKbd(sim) {
  const k = chuteKeys(sim)[0];
  return k ? `<kbd>${keyLabel(k)}</kbd>` : '';
}

function keyLineFor(prof, sim) {
  const parts = [];
  if (prof.escape !== 'none') parts.push(`${kbd('eject')} ${prof.escape === 'bail' ? 'bail out' : prof.escape === 'jump' ? 'parachute' : 'eject'}`);
  if (prof.selfDestruct) parts.push(`${kbd('selfDestruct')} self-destruct`);
  if (prof.dragChute && chuteKbd(sim)) parts.push(`${chuteKbd(sim)} drag chute`);
  return parts.length ? ` · ${parts.join(' · ')}` : '';
}

function syncKeyLine(sim) {
  UI.setKeyLine(sim.hud, inAircraft(sim) || S.phase !== 'idle' ? keyLineFor(S.prof || profileOf(sim), sim) : '');
}

/*
 * The H card used to get a "Getting out" block wrapped onto it here, with
 * Enter and Backspace written in. Eject, self-destruct and the parachute are
 * actions in the one registry now, so the card lists them — on the player's
 * keys — under Flying, with everything else.
 */

/* ------------------------------------------------------------------ */
/* Eject                                                               */
/* ------------------------------------------------------------------ */

/** Why you cannot eject right now, or null. For the tests too. */
export function cannotEject(sim) {
  if (!inAircraft(sim)) return 'Not now';
  const prof = profileOf(sim);
  const ac = sim.aircraft;
  if (S.phase !== 'idle') return 'You are already out';
  if (ac.crashed) return live(`Too late for that — press ${keyName('pause', sim)} and choose Restart`);
  if (prof.escape === 'none') return live(String(prof.noneWhy).replace(/\bpress O\b/, `press ${keyName('getOut', sim)}`).replace(/\bthen O\b/, `then ${keyName('getOut', sim)}`));
  if (ac.onGround) return live(`You’re on the ground — stop, then press ${keyName('getOut', sim)} to climb out`);
  if (prof.escape === 'bail' && ac.agl < (prof.bailFrom || BAIL_MIN_AGL)) {
    return prof.uniform === 'heli'
      ? live(`Too low to jump — the parachute needs ${Math.round((prof.bailFrom * 3.281) / 10) * 10} ft above the ground to open. Climb higher, or land and press ${keyName('getOut', sim)} to hop out.`)
      : 'Too low to bail out — climb higher, or land it!';
  }
  return null;
}

/** Enter, or the EJECT button. Returns true if the press was ours. */
function pressEject(sim) {
  if (!inAircraft(sim) || S.phase !== 'idle') return S.phase === 'out';
  const why = cannotEject(sim);
  if (why) {
    notify(sim, why, 'info', 4.5);
    return true;
  }
  const prof = S.prof;
  if (prof.crew > 0 && !S.crewOut) {
    crewOut(sim, prof);
    notify(sim, live(`Crew out first! ${byButton(sim) ? `${byButton(sim)} EJECT` : `Press ${kbd('eject', sim)}`} again to ${prof.escape === 'bail' ? 'jump' : 'eject'} yourself.`), 'warn', 5);
    S.armedT = 0;
    return true;
  }
  if (!S.crewOut && S.armedT <= 0) {
    S.armedT = ARM_SECONDS;
    notify(sim, byButton(sim)
      ? `${byButton(sim)} EJECT again to ${prof.escape === 'bail' ? 'bail out' : prof.escape === 'jump' ? 'open your parachute' : 'eject'}!`
      : live(`Press ${kbd('eject', sim)} again to ${prof.escape === 'bail' ? 'BAIL OUT' : prof.escape === 'jump' ? 'OPEN YOUR PARACHUTE' : 'EJECT'}!`), 'warn', ARM_SECONDS);
    sound(sim, 'cover');
    return true;
  }
  ejectNow(sim, false);
  return true;
}

/** Send the other crew out. */
function crewOut(sim, prof) {
  const ac = sim.aircraft;
  const uniform = uniformFor(sim.aircraftType);
  seatWorld(sim, _v);
  _up.set(0, 1, 0).applyQuaternion(ac.quat);
  const sh = sim.aircraftType.shape || {};
  const eyeX = sh.eye ? sh.eye[0] : 0;
  for (let i = 0; i < prof.crew; i++) {
    const person = createUniformPerson(uniform, { seed: 11 + i * 7 }) || createUniformPerson('fighter', { seed: 11 });
    const model = new ChuteModel(person, { uniform, seat: prof.escape === 'seat' });
    const flight = new ChuteFlight();
    // Side by side (the Nightjar's seat is left of centre): the other seat.
    // In tandem (seat on the centreline): the one behind.
    _w.set(Math.abs(eyeX) > 0.1 ? 1.2 * Math.sign(-eyeX) : 0.6 * (i ? -1 : 1), 0, Math.abs(eyeX) > 0.1 ? 0 : 1.4 + i).applyQuaternion(ac.quat);
    const pos = _v.clone().add(_w);
    flight.launch(pos, ac.vel, _up, (ac.heading + (i ? -25 : 25) + 360) % 360, prof.escape === 'seat' ? 'crew' : 'bail');
    model.addTo(sim.scene);
    S.crew.push({ flight, model, person, landedT: 0, turn: i ? -0.15 : 0.15 });
  }
  S.crewOut = true;
  sound(sim, 'eject');
}

/** Out you go. `auto`: the self-destruct's seat, fired for you. */
function ejectNow(sim, auto) {
  const ac = sim.aircraft;
  const type = sim.aircraftType;
  const prof = S.prof || profileFor(type);
  if (prof.crew > 0 && !S.crewOut) crewOut(sim, prof);
  const uniform = uniformFor(type);
  const person = createUniformPerson(uniform, { seed: 5 });
  const kind = prof.escape === 'jump' ? 'jump' : prof.escape === 'bail' ? 'bail' : 'seat';
  const model = new ChuteModel(person, { uniform, seat: kind === 'seat' });
  const flight = new ChuteFlight();
  _up.set(0, 1, 0).applyQuaternion(ac.quat);
  if (kind === 'jump') {
    // Harrison: the parachute comes out of his own back, where he is.
    _v.set(0, 0.2, 0).applyQuaternion(ac.quat).add(ac.pos);
  } else {
    seatWorld(sim, _v);
    _v.addScaledVector(_up, -0.9);
    if (kind === 'bail') {
      // Out of the door: a couple of metres to the side.
      _w.set(2.2, 0, 0).applyQuaternion(ac.quat);
      _v.add(_w);
    }
  }
  flight.launch(_v, ac.vel, _up, ac.heading, kind);
  model.addTo(sim.scene);
  S.me = { flight, model, person, uniform, opened: false };
  S.lastEject = { type: type.id, kind, auto: !!auto, at: flight.pos.clone(), speedKt: Math.round(ac.airspeed * KT), agl: Math.round(ac.agl) };
  if (sim.model && sim.model.userData && typeof sim.model.userData.setRider === 'function') sim.model.userData.setRider(false);

  // The empty aeroplane: flown through sim.override from here on.
  if (sim.autopilot && sim.autopilot.engaged && typeof sim.toggleAutopilot === 'function') sim.toggleAutopilot(false);
  S.prevOverride = sim.override;
  S.emptyT = 0;
  S.planeDown = !!ac.crashed;
  if (prof.ends) {
    // Nothing left flying: the flight ends here (endGate holds the aeroplane still).
    S.ended = true;
    S.ghost = null;
    endGate(ac);
    if (ac.engineOn && typeof ac.stopEngine === 'function') ac.stopEngine('shutdown');
  } else {
    S.ghost = { throttle: clamp(Math.max(0.55, ac.controls.throttle || 0), 0, 1), pitch: 0, roll: 0, yaw: 0, brakes: 0 };
    sim.override = S.ghost;
  }
  // stovl.js reads this: the hover lets go and an empty F-35B falls.
  sim.walking = { active: true, ejected: true };

  S.phase = 'out';
  S.armedT = 0;
  S.keys = Object.create(null);
  S.cam.started = false;
  S.cam.yaw = 0;
  if (sim.input && sim.input.keys && sim.input.keys.clear) sim.input.keys.clear();
  if (sim.touch && sim.touch.setVisible) {
    sim.touch.setVisible(false);
    S.touchHidden = true;
  }
  FootUI.setHudWalking(sim.hud, true);
  S.hudHidden = true;
  const how = kind === 'jump' ? 'Harrison opens his parachute!' : kind === 'bail' ? 'Out of the door!' : 'EJECT! EJECT!';
  banner(sim, how, isTouch(sim)
    ? 'Your parachute opens in a moment. Hold ◀ ▶ to steer, SINK to go down faster.'
    : `Your parachute opens in a moment. ${kbd('chuteLeft', sim)} ${kbd('chuteRight', sim)} steer · ${kbd('chuteSink', sim)} sink faster.`, 'good', 5);
  if (auto) {
    notify(sim, 'The seat fired you out automatically — nobody goes up with the plane!', 'good', 5);
  }
  sound(sim, 'eject');
}

/**
 * For an aeroplane that is its own pilot (profiles.js `ends`): its own step,
 * gated off once he is out, so nothing flies on without him and nothing
 * crashes. Its position follows his parachute down — the map and the other
 * players' screens stay on him — and stays where he lands. Installed once per
 * aeroplane and left in the chain (stovl.js and multiplayer.js wrap the same
 * step the same way); when nobody is out it is the step it always was.
 */
function endGate(ac) {
  if (!ac || ac._ejectEndGate || typeof ac.update !== 'function') return;
  const inner = ac.update;
  Object.defineProperty(ac, '_ejectEndGate', { value: true, enumerable: false });
  ac.update = function ejectEndGate(...args) {
    if (!S.ended) return inner.apply(this, args);
    const f = S.me && S.me.flight;
    if (f) {
      this.pos.copy(f.pos);
      this.vel.copy(f.vel);
    } else {
      this.vel.set(0, 0, 0);
    }
    if (this.omega) this.omega.set(0, 0, 0);
    this.rpm = 0;
    if (this.controls) this.controls.throttle = 0;
    return undefined;
  };
}

/* ------------------------------------------------------------------ */
/* Under the canopy                                                     */
/* ------------------------------------------------------------------ */

const IN = { turn: 0, sink: false };

function chuteInput(sim) {
  const K = S.keys;
  const h = UI.held;
  IN.turn = (heldKey(sim, 'chuteRight', K) || h.right ? 1 : 0) - (heldKey(sim, 'chuteLeft', K) || h.left ? 1 : 0);
  IN.sink = !!(heldKey(sim, 'chuteSink', K) || h.sink);
  return IN;
}

function updateOut(sim, dt) {
  const me = S.me;
  if (!me) return;
  const f = me.flight;
  const wind = windOf(sim, _w);
  const inp = chuteInput(sim);
  const ground = floorAt(f.pos.x, f.pos.z);
  const landed = f.step(dt, inp, wind, ground);
  me.model.sync(f, dt, inp.turn, ground);
  poseHanging(me.person, f.t);
  if (!me.opened && f.open > 0) {
    me.opened = true;
    sound(sim, 'open');
  }
  if (sim.hud && sim.hud.setCoach) sim.hud.setCoach(null);
  const agl = Math.max(0, f.pos.y - ground);
  const touch = isTouch(sim);
  UI.setChuteHud(f.open > 0
    ? `Height <b>${Math.round(agl)} m</b> · falling ${Math.max(0, f.sinkRate).toFixed(1)} m/s<br>${touch ? 'Hold ◀ ▶ to steer · SINK to go down faster' : `${kbd('chuteLeft', sim)} ${kbd('chuteRight', sim)} steer · ${kbd('chuteSink', sim)} sink faster`}`
    : '<b>Seat fired!</b> The parachute is opening…');
  UI.setSteer(touch && f.open > 0.5);
  if (landed) land(sim);
}

/** Feet on the ground: hand over to the walker. */
function land(sim) {
  const me = S.me;
  const f = me.flight;
  let x = f.pos.x;
  let z = f.pos.z;
  let rescued = false;
  // In the sea: the rescue boat takes you to the nearest beach.
  if (heightAt(x, z) < WALK.deep + 0.05) {
    const spot = dryLandNear(x, z);
    if (spot) {
      x = spot.x;
      z = spot.z;
      rescued = true;
    }
  } else if (solidAt(x, z, groundAt(x, z), WALK.radius + 0.08, null)) {
    // On a roof: step down beside the building.
    const spot = dryLandNear(x, z, 4);
    if (spot) {
      x = spot.x;
      z = spot.z;
    }
  }
  S.landedAt = { x, z, rescued, water: heightAt(f.pos.x, f.pos.z) < 0 };
  // The canopy stays and sags where you came down; you stand beside it.
  me.model.person.visible = false;
  me.model.root.position.set(f.pos.x, floorAt(f.pos.x, f.pos.z), f.pos.z);
  S.walked = me;
  S.me = null;
  UI.setSteer(false);
  UI.setChuteHud('');
  // Walking now: onfoot.js's walker, dressed for the aeroplane.
  if (S.touchHidden && sim.touch && sim.touch.setVisible) sim.touch.setVisible(true);
  S.touchHidden = false;
  FootUI.setHudWalking(sim.hud, false);
  S.hudHidden = false;
  const ok = onFoot.start(sim, { x, z, headingDeg: f.heading, outfit: me.uniform, moorVehicle: false });
  if (!ok) {
    S.phase = 'idle';
    return;
  }
  onFoot.setCamera(f.heading, -12);
  S.control = walkControl(sim);
  onFoot.setControl(S.control);
  S.phase = 'walking';
  const dressed = me.uniform === 'harrison'
    ? 'Still T-posing. Of course.'
    : `You floated all the way down — dressed as a${/^[aeiou]/i.test(UNIFORMS[me.uniform] ? UNIFORMS[me.uniform].name : 'p') ? 'n' : ''} ${UNIFORMS[me.uniform] ? UNIFORMS[me.uniform].name.toLowerCase() : 'pilot'}.`;
  if (rescued) banner(sim, 'Splash!', 'A rescue boat fished you out and dropped you at the beach.', 'good', 5);
  else banner(sim, 'Safe landing!', dressed, 'good', 4.5);
}

/** The nearest dry, open spot to (x, z), searched in rings. */
function dryLandNear(x, z, start = 20) {
  for (let r = start; r < 6000; r *= 1.35) {
    const n = Math.max(12, Math.round((r * Math.PI * 2) / 25));
    let best = null;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const px = x + Math.sin(a) * r;
      const pz = z - Math.cos(a) * r;
      const h = heightAt(px, pz);
      if (!(h > 0.4) || h > 60) continue;
      if (solidAt(px, pz, groundAt(px, pz), WALK.radius + 0.1, null)) continue;
      best = { x: px, z: pz };
      break;
    }
    if (best) return best;
  }
  return null;
}

const WALK_BUTTONS = [
  { id: 'run', label: 'Run' },
  { id: 'jump', label: 'Jump' },
  { id: 'view', label: 'View' },
  { id: 'wave', label: 'Wave' },
  { id: 'again', label: 'Fly again' },
];

/** What the walker does with Enter after an ejection: fly again. */
function walkControl(sim) {
  const again = () => flyAgain(sim);
  return {
    ejected: true,
    prompt: isTouch(sim)
      ? 'Safe on the ground! Tap here to fly again'
      : `Safe! ${kbd('walkForward', sim)}${kbd('walkLeft', sim)}${kbd('walkBack', sim)}${kbd('walkRight', sim)} walk · ${kbd('flyAgain', sim)} fly again`,
    promptAction: again,
    buttons: WALK_BUTTONS,
    onButton: (id) => {
      if (id === 'again') again();
    },
    key: (s, code, down) => {
      if (!isKey(s, 'flyAgain', code)) return false;
      if (down) again();
      return true;
    },
  };
}

function flyAgain(sim) {
  try {
    if (typeof sim.restart === 'function') sim.restart();
  } catch (e) {
    console.warn('[eject] could not restart', e);
  }
}

/** The crew's parachutes, and the crew waving where they came down. */
function updateCrew(sim, dt) {
  for (const c of S.crew) {
    if (!c.flight.landed) {
      const ground = floorAt(c.flight.pos.x, c.flight.pos.z);
      IN.turn = c.flight.open > 0 ? c.turn : 0;
      IN.sink = false;
      c.flight.step(dt, IN, windOf(sim, _w), ground);
      c.model.sync(c.flight, dt, IN.turn, ground);
      poseHanging(c.person, c.flight.t);
    } else {
      c.landedT += dt;
      c.model.collapseStep(dt);
      c.model.root.rotation.z = 0;
      posePerson(c.person, dt, { speed: 0, air: false, wave: 'hello' });
    }
  }
  if (S.walked) {
    S.walked.model.collapseStep(dt);
  }
}

/* ------------------------------------------------------------------ */
/* The empty aeroplane                                                  */
/* ------------------------------------------------------------------ */

function updateGhost(sim, dt) {
  const ac = sim.aircraft;
  if (!S.ghost || !ac) return;
  if (sim.override !== S.ghost) sim.override = S.ghost;
  if (ac.crashed) {
    S.ghost.throttle = 0;
    return;
  }
  S.emptyT += dt;
  // Nobody at the controls: the nose drops and it spirals down.
  const pitch = ac.pitchAngleDeg();
  const bank = ac.bankAngleDeg();
  S.ghost.pitch = clamp((-30 - pitch) * 0.05 - ac.omega.x * 0.8, -1, 1);
  S.ghost.roll = clamp((38 - bank) / 22, -0.8, 0.8);
  S.ghost.yaw = 0;
  S.ghost.brakes = 0;
  if (S.emptyT > EMPTY_MAX_SECONDS) ac.crash('The empty aeroplane came down');
  // Its engine fades as it goes away from you.
  const mx = mixer(sim);
  const who = S.me ? S.me.flight.pos : onFoot.active ? _look.set(onFoot.walker.x, onFoot.walker.y, onFoot.walker.z) : null;
  if (mx && who && mx.buses && mx.buses.engine) {
    const d = who.distanceTo(ac.pos);
    const v = mx.volumes && mx.volumes.engine != null ? mx.volumes.engine : 1;
    try {
      mx.buses.engine.gain.setTargetAtTime(mx.busEnabled('engine') ? v * clamp(1 - d / 900, 0.05, 1) : 0, mx.time, 0.3);
      if (mx.buses.alerts) mx.buses.alerts.gain.setTargetAtTime(0, mx.time, 0.1);
      S.audioFaded = true;
    } catch (e) {
      /* sound is a nicety */
    }
  }
}

function restoreAudio(sim) {
  if (!S.audioFaded) return;
  S.audioFaded = false;
  const mx = mixer(sim);
  if (!mx) return;
  try {
    for (const b of ['engine', 'alerts']) mx.setVolume(b, mx.volumes && mx.volumes[b] != null ? mx.volumes[b] : 1);
  } catch (e) {
    /* sound is a nicety */
  }
}

/** The CRASH event, for an aeroplane that may or may not have anyone in it. */
function onCrash(sim) {
  if (S.phase === 'idle') return;
  S.planeDown = true;
  const ac = sim.aircraft;
  if (S.sd.state !== 'boom') {
    // A cartoon bang where it hit, on top of the game's own wreck.
    try {
      explode(sim, ac.pos.clone(), { size: 0.7 });
    } catch (e) {
      /* the bang is a nicety */
    }
    banner(sim, 'Your empty plane crashed!', 'Nobody was in it — you got out in time.', 'good', 4.5);
  }
}

/* ------------------------------------------------------------------ */
/* Self-destruct                                                        */
/* ------------------------------------------------------------------ */

export function cannotSelfDestruct(sim) {
  if (!inAircraft(sim)) return 'Not now';
  const prof = profileFor(sim.aircraftType);
  if (!prof.selfDestruct && prof.ends) return 'Harrison is a person, not a plane — people don’t have a self-destruct!';
  if (!prof.selfDestruct) {
    return 'This plane has no self-destruct — only the special ones do: the B-2, F-22, F-35B and Air Massimo.';
  }
  const ac = sim.aircraft;
  if (ac.crashed) return 'Too late for that';
  if (S.phase !== 'idle') return 'You are already out';
  if (ac.onGround) return 'Self-destruct only works in the air — take off first!';
  return null;
}

/** Backspace, or the guarded button. */
function pressSelfDestruct(sim) {
  if (!inAircraft(sim)) return S.phase === 'out';
  const sd = S.sd;
  if (sd.state === 'count') {
    sd.state = 'off';
    sd.t = 0;
    UI.setCountdown(null);
    notify(sim, 'Self-destruct cancelled. Phew!', 'good', 3.5);
    sound(sim, 'cancel');
    return true;
  }
  const why = cannotSelfDestruct(sim);
  if (why) {
    notify(sim, why, 'info', 4.5);
    return true;
  }
  if (sd.state !== 'open') {
    sd.state = 'open';
    sd.t = COVER_SECONDS;
    notify(sim, isTouch(sim)
      ? 'Safety cover open — tap SELF-DESTRUCT again to start the countdown.'
      : live(`Safety cover open — press ${kbd('selfDestruct', sim)} again to start the countdown.`), 'warn', COVER_SECONDS);
    sound(sim, 'cover');
    return true;
  }
  sd.state = 'count';
  sd.t = COUNT_SECONDS;
  sd.shown = -1;
  return true;
}

function updateSelfDestruct(sim, dt) {
  const sd = S.sd;
  const ac = sim.aircraft;
  if (sd.state === 'open') {
    sd.t -= dt;
    if (sd.t <= 0 || !inAircraft(sim)) {
      sd.state = 'off';
      if (inAircraft(sim)) notify(sim, 'Safety cover closed.', 'info', 2);
    }
    return;
  }
  if (sd.state !== 'count') return;
  if (!ac || ac.crashed) {
    sd.state = ac && ac.crashed ? 'boom' : 'off';
    UI.setCountdown(null);
    return;
  }
  sd.t -= dt;
  const n = Math.max(0, Math.ceil(sd.t));
  if (n !== sd.shown && n > 0) {
    sd.shown = n;
    sound(sim, 'beep');
  }
  const out = S.phase !== 'idle';
  const touch = isTouch(sim);
  UI.setCountdown(Math.max(1, n), out
    ? 'You’re out — watch this!'
    : touch ? 'Tap EJECT now · CANCEL to stop it' : `${kbd('eject', sim)} eject now · ${kbd('selfDestruct', sim)} cancel`);
  // Nobody goes up with the plane: the seat fires by itself at the end.
  if (sd.t <= 1.2 && S.phase === 'idle') ejectNow(sim, true);
  if (sd.t <= 0) boom(sim);
}

function boom(sim) {
  const ac = sim.aircraft;
  const sd = S.sd;
  sd.state = 'boom';
  UI.setCountdown(null);
  const p = ac.pos.clone();
  try {
    explode(sim, p, { size: 1.6 });
    explode(sim, p, { size: 0.8, kind: 'sparkle', silent: true });
  } catch (e) {
    console.warn('[eject] the bang failed', e);
  }
  ac.crash('Self-destruct — KABOOM!');
  if (sim.model) {
    sim.model.visible = false;
    S.hidModel = sim.model;
  }
  banner(sim, 'KABOOM!', 'The plane is gone. You are safe under your parachute.', 'good', 5);
}

/* ------------------------------------------------------------------ */
/* Drag chute                                                           */
/* ------------------------------------------------------------------ */

/** Why the chute cannot come out right now (dragchute.js chuteBlocker), or null. */
function chuteWhyNot(sim) {
  const ac = sim.aircraft;
  if (!ac || !inAircraft(sim) || S.phase !== 'idle') return 'crashed';
  return chuteBlocker({
    has: !!(S.prof && S.prof.dragChute),
    onGround: !!ac.onGround,
    crashed: !!ac.crashed,
    groundSpeed: ac.groundSpeed || 0,
    throttle: (ac.controls && ac.controls.throttle) || 0,
    state: S.drag.state,
  });
}

function canPopChute(sim) {
  return chuteWhyNot(sim) === null;
}

/**
 * The Drag chute key, or the CHUTE button: the ONLY ways it comes out. At the
 * wrong moment it says why, kindly, and does nothing. Returns what happened:
 * 'out', or the reason it did not.
 */
function pressChute(sim, via = 'key') {
  const why = chuteWhyNot(sim);
  if (why) {
    const words = chuteWords(why, via === 'touch' || isTouch(sim) ? '' : chuteKbd(sim));
    if (words) notify(sim, words, 'info', 3.5);
    return why;
  }
  const d = S.drag;
  const ac = sim.aircraft;
  d.state = 'out';
  d.fill = 0;
  d.t = 0;
  d.via = via;
  if (d.model) d.model.dispose();
  d.model = new DragChuteModel((SPEC.mass || 1000) + (ac.extraMass || 0));
  sim.scene.add(d.model.root);
  notify(sim, 'Drag chute out! It pulls you to a stop much faster.', 'good', 3.5);
  sound(sim, 'chute');
  return 'out';
}

function tailWorld(sim, out) {
  const t = sim.aircraftType;
  const sh = t.shape || {};
  const tail = t.plan ? t.plan.tail : 3.95 * (sh.bodyLength || 1) * (sh.scale || 1);
  return out.set(0, 0.2, tail).applyQuaternion(sim.aircraft.quat).add(sim.aircraft.pos);
}

function updateDrag(sim, dt) {
  const d = S.drag;
  const ac = sim.aircraft;
  if (!ac) return;
  if (!ac.onGround) {
    d.airT += dt;
    if (d.airT > 2 && d.state === 'used') d.state = 'stowed';
  } else {
    if (d.airT > 2) {
      d.armed = true;
      d.hinted = false;
    }
    d.airT = 0;
    if (ac.groundSpeed < 3 && d.state !== 'out') d.armed = false;
  }
  const mass = (SPEC.mass || 1000) + (ac.extraMass || 0);
  /*
   * It never comes out by itself — not on the brakes, not on touchdown. Once
   * per landing, on the roll, a hint says how to pull it; then it is yours.
   */
  if (d.armed && !d.hinted && canPopChute(sim)) {
    d.hinted = true;
    const key = chuteKbd(sim);
    if (isTouch(sim)) notify(sim, 'Tap CHUTE to pull your drag chute!', 'info', 3);
    else if (key) notify(sim, `Drag chute ready — press ${key} to pull it!`, 'info', 3);
  }
  if (d.state === 'out') {
    d.t += dt;
    d.fill = Math.min(1, d.fill + dt / DRAG_CHUTE.FILL);
    const gs = ac.groundSpeed;
    const goAround = (ac.controls.throttle || 0) > DRAG_CHUTE.CUT_THROTTLE;
    if (gs < DRAG_CHUTE.CUT_BELOW || goAround || ac.crashed || !inAircraft(sim) || S.phase !== 'idle' || (!ac.onGround && ac.agl > 3)) {
      d.state = 'cut';
      d.t = 0;
      if (goAround) notify(sim, 'Chute cut — go around!', 'warn', 3);
    } else {
      if (ac.onGround) applyChute(ac, mass, d.fill, dt);
      _dir.set(ac.vel.x, 0, ac.vel.z);
      if (_dir.lengthSq() < 1e-4) _dir.set(Math.sin(ac.heading * D2R), 0, -Math.cos(ac.heading * D2R));
      _dir.normalize();
      tailWorld(sim, _v);
      d.model.sync(_v, _dir, d.fill, dt, floorAt(_v.x, _v.z), sim.camera);
    }
  } else if (d.state === 'cut') {
    if (!d.model || d.model.drop(dt, floorAt(d.model.root.position.x, d.model.root.position.z))) {
      if (d.model) d.model.dispose();
      d.model = null;
      d.state = 'used';
    }
  }
}

/* ------------------------------------------------------------------ */
/* Every frame, and putting it all back                                 */
/* ------------------------------------------------------------------ */

/**
 * The EJECT button. A mission keeps what it had: a touch screen's button,
 * anywhere in the air. In Free Flight it is on every screen — a laptop's too,
 * where Enter on one small line of the HUD was the only way anyone could find
 * out — and only once you are high enough for this aeroplane's way out to
 * work (a door needs its `bailFrom`; a seat could go lower, but a button
 * flashing up on every lift-off is not a calm HUD). It comes on a few metres
 * above that and goes below it, so it does not blink at the edge.
 */
const SHOW_FROM = 15;
let ejectShown = false;
function showEject(sim, flying, prof) {
  const ac = sim.aircraft;
  if (!flying || !prof || prof.escape === 'none' || ac.onGround || ac.crashed) return (ejectShown = false);
  if (sim.mode !== 'free') return (ejectShown = isTouch(sim));
  const from = prof.escape === 'bail' ? prof.bailFrom || BAIL_MIN_AGL : SHOW_FROM;
  ejectShown = ac.agl >= from + (ejectShown ? 0 : 6);
  return ejectShown;
}

function syncUi(sim) {
  const flying = inAircraft(sim) && S.phase === 'idle';
  const ac = sim.aircraft;
  const touch = isTouch(sim);
  const prof = S.prof;
  UI.setButtons({
    eject: showEject(sim, flying, prof),
    desk: !touch,
    armed: S.armedT > 0 || (S.crewOut && S.phase === 'idle'),
    sd: touch && flying && prof && prof.selfDestruct && !ac.crashed && (!ac.onGround || S.sd.state === 'count'),
    sdState: S.sd.state,
    chute: touch && canPopChute(sim),
  });
  if (S.sd.state !== 'count') UI.setCountdown(null);
}

function resetAll(sim) {
  for (const c of S.crew) c.model.dispose();
  S.crew.length = 0;
  if (S.me) S.me.model.dispose();
  S.me = null;
  if (S.walked) S.walked.model.dispose();
  S.walked = null;
  if (S.drag.model) S.drag.model.dispose();
  S.drag = { state: 'stowed', fill: 0, model: null, airT: 0, armed: false, hinted: false, via: '', t: 0 };
  if (sim) {
    if (S.ghost && sim.override === S.ghost) sim.override = S.prevOverride === S.ghost ? null : S.prevOverride || null;
    if (sim.walking && sim.walking.ejected) sim.walking = null;
    // Only what this feature hid: main.js hides the aeroplane itself while
    // you drive, and showing it again at every start put it on screen in the van.
    if (S.hidModel) S.hidModel.visible = true;
    S.hidModel = null;
    if (sim.model && sim.model.userData && typeof sim.model.userData.setRider === 'function') sim.model.userData.setRider(true);
    if (S.touchHidden && sim.touch && sim.touch.setVisible) sim.touch.setVisible(true);
    if (S.hudHidden) FootUI.setHudWalking(sim.hud, false);
    if (S.control && onFoot.control === S.control) onFoot.setControl(null);
    restoreAudio(sim);
  }
  S.ghost = null;
  S.ended = false;
  S.prevOverride = null;
  S.touchHidden = false;
  S.hudHidden = false;
  S.control = null;
  S.phase = 'idle';
  S.armedT = 0;
  S.crewOut = false;
  S.emptyT = 0;
  S.planeDown = false;
  S.sd.state = 'off';
  S.sd.t = 0;
  S.keys = Object.create(null);
  S.landedAt = null;
  UI.setCountdown(null);
  UI.setSteer(false);
  UI.setChuteHud('');
}

function bindAircraft(sim) {
  const ac = sim.aircraft;
  if (!ac || S.boundAc === ac || typeof ac.on !== 'function') return;
  S.boundAc = ac;
  ac.on(EVENTS.CRASH, () => {
    try {
      onCrash(sim);
    } catch (e) {
      console.warn('[eject] crash handler failed', e);
    }
  });
}

/** Harrison: his own head is in the way in the cockpit view, so it goes. */
function tposeView(sim) {
  const m = sim.model;
  const p = m && m.userData && m.userData.person;
  if (!p || !p.userData.rig) return;
  const inside = !!(sim.rig && sim.rig.mode === 'cockpit');
  p.userData.rig.head.visible = !inside;
  if (inside && sim.cockpit) sim.cockpit.visible = false;
}

registerExtension({
  id: 'eject',

  install(sim) {
    S.sim = sim;
    UI.build((id, pointer) => {
      const s = S.sim;
      if (!s || s.state !== 'flying') return;
      if (id === 'eject') pressFrom(s, pointer === 'mouse' || pointer === 'pen' ? 'click' : 'tap');
      else if (id === 'sd') pressSelfDestruct(s);
      else if (id === 'chute') pressChute(s, 'touch');
    });
    bindAircraft(sim);
    // The crash of an aeroplane nobody is in does not end the flight.
    if (typeof sim.showCrashDebrief === 'function' && !sim._ejectDebrief) {
      const inner = sim.showCrashDebrief;
      sim._ejectDebrief = true;
      sim.showCrashDebrief = function crashDebriefUnlessEjected(...args) {
        if (S.phase !== 'idle') return undefined;
        return inner.apply(this, args);
      };
    }
    // While you hang under a canopy, the empty aeroplane's own warnings
    // ("Stall!", "Overspeed") are not yours to hear about.
    if (sim.hud && typeof sim.hud.notify === 'function' && !S.notifyOrig) {
      const inner = sim.hud.notify;
      S.notifyOrig = inner.bind(sim.hud);
      sim.hud.notify = function notifyUnlessOut(...args) {
        if (S.phase === 'out') return undefined;
        return inner.apply(this, args);
      };
    }
    // The tower talks to the aeroplane, and nobody is in it: no "cleared to
    // land" at a pilot under a parachute, or at an empty runaway plane
    // (runaway.js sets sim.walking.ejected too). Quiet, not queued.
    if (sim.atc && typeof sim.atc.say === 'function' && !sim.atc._ejectQuiet) {
      const inner = sim.atc.say;
      sim.atc._ejectQuiet = true;
      sim.atc.say = function sayUnlessEjected(...args) {
        const w = S.sim && S.sim.walking;
        if (S.phase !== 'idle' || (w && w.ejected)) return false;
        return inner.apply(this, args);
      };
    }
    // The map follows the aeroplane; the empty one's TERRAIN warning is not
    // yours while you hang under a canopy.
    if (sim.minimap && typeof sim.minimap.warningFor === 'function' && !sim.minimap._ejectWarn) {
      const inner = sim.minimap.warningFor;
      sim.minimap._ejectWarn = true;
      sim.minimap.warningFor = function warningUnlessEjected(...args) {
        if (S.phase !== 'idle') return null;
        return inner.apply(this, args);
      };
    }
    // Off with the pause screen and the menus, on with the game.
    if (typeof setInterval === 'function') {
      setInterval(() => {
        try {
          FootUI.syncGate();
          UI.setGate(FootUI.gated() || !S.sim || S.sim.state !== 'flying');
        } catch (e) {
          /* the gate is a nicety */
        }
      }, 250);
    }
  },

  startMode(sim) {
    resetAll(sim);
    bindAircraft(sim);
    S.prof = sim.aircraftType ? profileOf(sim) : null;
    S.typeId = sim.aircraftType ? sim.aircraftType.id : '';
    syncKeyLine(sim);
  },

  stop(sim) {
    resetAll(sim);
    UI.setButtons({});
  },

  update(sim, dt) {
    S.sim = sim;
    if (!sim.aircraft || !sim.aircraftType) return;
    if (S.typeId !== sim.aircraftType.id) {
      S.typeId = sim.aircraftType.id;
      S.prof = profileOf(sim);
    }
    if (!S.prof) S.prof = profileOf(sim);
    bindAircraft(sim);
    if (S.armedT > 0) S.armedT = Math.max(0, S.armedT - dt);
    // Walking again after an ejection and then off in something else (a tug):
    // this flight's ejection is over.
    if (S.phase === 'walking' && !onFoot.active) {
      S.phase = 'idle';
      S.control = null;
    }
    if (S.phase === 'idle' || S.phase === 'out') updateSelfDestruct(sim, dt);
    updateDrag(sim, dt);
    updateCrew(sim, dt);
    if (S.phase === 'out') updateOut(sim, dt);
    updateGhost(sim, dt);
    if (sim.aircraftType.id === 'tpose') tposeView(sim);
    syncKeyLine(sim);
    syncUi(sim);
    UI.setGate(FootUI.gated());
  },

  camera(sim, dt, cam) {
    if (S.phase !== 'out' || !S.me || !cam) return false;
    const f = S.me.flight;
    const yaw = (f.heading + S.cam.yaw) * D2R;
    // Behind and a little below the canopy: you, the lines and the dome.
    const back = 15;
    const up = 3.5;
    _look.set(f.pos.x, f.pos.y + 4.2, f.pos.z);
    _v.set(f.pos.x - Math.sin(yaw) * back, f.pos.y + up, f.pos.z + Math.cos(yaw) * back);
    const floor = floorAt(_v.x, _v.z) + 1.2;
    if (_v.y < floor) _v.y = floor;
    if (!S.cam.started) {
      S.cam.pos.copy(cam.position);
      S.cam.started = true;
    }
    // Eases from where the chase camera was: you see yourself shoot out.
    S.cam.pos.lerp(_v, Math.min(1, dt * (f.t < 1.5 ? 1.6 : 3)));
    cam.position.copy(S.cam.pos);
    cam.lookAt(_look);
    return true;
  },

  /** Hanging under the canopy, the keys are the parachute's. */
  keyContext() {
    return S.phase === 'out' ? 'chute' : null;
  },

  key(sim, code, down, e) {
    const rep = !!(e && e.repeat);
    if (S.phase === 'out') {
      if (passes(sim, code)) return false;
      S.keys[code] = down;
      if (down && isKey(sim, 'chuteLookLeft', code)) S.cam.yaw -= 25;
      else if (down && isKey(sim, 'chuteLookRight', code)) S.cam.yaw += 25;
      return down;
    }
    if (isKey(sim, 'eject', code)) {
      if (!inAircraft(sim)) return false;
      if (down && !rep) return pressFrom(sim, 'key');
      return true;
    }
    if (isKey(sim, 'selfDestruct', code)) {
      if (!inAircraft(sim)) return false;
      if (down && !rep) return pressSelfDestruct(sim);
      return true;
    }
    // The Drag chute key: in any aeroplane, so one without a chute can say so.
    if (chuteKeys(sim).includes(code)) {
      if (!inAircraft(sim)) return false;
      if (down && !rep) pressChute(sim, 'key');
      return true;
    }
    return false;
  },

  devActions: [
    {
      label: 'Eject: start high in a two-seat B-2',
      hint: 'Nightjar at 600 m — Enter sends the crew, Enter again sends you',
      run(sim) {
        if (typeof sim.startMode === 'function') sim.startMode('free', { aircraft: 'nightjar', airborne: true, taxi: false });
      },
    },
  ],
});

/** For the browser check and the console. */
export const eject = {
  get phase() {
    return S.phase;
  },
  get profile() {
    return S.prof;
  },
  get crewOut() {
    return S.crewOut;
  },
  get crew() {
    return S.crew;
  },
  get me() {
    return S.me;
  },
  get ghost() {
    return S.ghost;
  },
  /** Out of T-Pose Harrison: nothing is left flying. */
  get ended() {
    return S.ended;
  },
  get selfDestruct() {
    return S.sd;
  },
  get drag() {
    return S.drag;
  },
  get landedAt() {
    return S.landedAt;
  },
  get lastEject() {
    return S.lastEject;
  },
  get planeDown() {
    return S.planeDown;
  },
  pressEject(sim) {
    return pressEject(sim || S.sim);
  },
  pressSelfDestruct(sim) {
    return pressSelfDestruct(sim || S.sim);
  },
  cannotEject(sim) {
    return cannotEject(sim || S.sim);
  },
  /** Pull the drag chute as the key or the button would: 'out', or why not. */
  pressChute(sim, via = 'key') {
    return pressChute(sim || S.sim, via);
  },
  /** Why the drag chute cannot come out right now, or null. */
  chuteWhyNot(sim) {
    return chuteWhyNot(sim || S.sim);
  },
  /** The keys the drag chute is on (Settings can move them). */
  chuteKeys(sim) {
    return chuteKeys(sim || S.sim).slice();
  },
  listed,
  ui: UI,
};

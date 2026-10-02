/**
 * Carrier ops: landing a fighter on the ship the way it is really done, and
 * starting military flights on the ship instead of the runway.
 *
 * The owner: "make the landing process for fighter jets on carriers
 * realistic", and "if you have military stuff you spawn on a carrier
 * instead".
 *
 * LANDING
 *   A TAIL HOOK (the `hook` action, a HOOK touch button, a HOOK lamp among
 *   the HUD's GEAR and FLAPS chips). FOUR WIRES across the angled deck at
 *   their real 12.2 m spacing (./carrier/deck.js); the hook catches the wire
 *   it actually touches — the first one it crosses while it is on the deck —
 *   and the 3-wire is the target. The wire pays out and stops the jet hard:
 *   about 2.9 s and 50-110 m whatever the speed (./carrier/gear.js), then
 *   pulls it back a metre and a half. Miss them all — long, or the hook
 *   skips — and it is a BOLTER: you were meant to be at full power on
 *   touchdown, and you fly off the angled deck and go round.
 *   The MEATBALL — a Fresnel lens on the port deck edge, the ball against
 *   the green datum lights, red wave-off lights — and its repeater on screen.
 *   PADDLES, the LSO, on the radio: "Roger ball", "You're low", "Power",
 *   "Right for lineup", "Wave off, wave off" (./carrier/lso.js). A grade
 *   after every pass — OK, Fair, No grade, Bolter, Wave-off, and the wire.
 *   The pattern — the initial, the break, downwind, the 180, the groove —
 *   with a hint line for kids and a guide ring to the next mark.
 *
 * TAKE-OFF
 *   The bow CATAPULTS: start on one (or taxi onto one and stop), the hold-
 *   back holds you, full power, then SALUTE (the `salute` action, a LAUNCH
 *   button) — a second later the shot: zero to flying speed in about two
 *   seconds, and the jet rotates itself off the bow, hands-off, the way a
 *   Hornet does. The F-35B has no launch bar and no hook: it starts on the
 *   deck for a rolling take-off (or T, to lift straight up) and lands by
 *   hovering (src/features/stovl.js).
 *
 * WHERE YOU START
 *   Free Flight in a military aeroplane starts on catapult 1 — or, "Already
 *   flying", at the initial behind the ship — unless the Free Flight
 *   screen's new "Start at: Carrier / Airbase" says Airbase. Every map has
 *   the ship: a map's own berth, or one picked in deep water clear of the
 *   approach lanes (src/world/carrier-berth.js). In multiplayer the military
 *   players start on the carrier too, one to a catapult and the rest queued
 *   behind them, and everybody sees the same ship in the same place.
 *
 * HOW IT TOUCHES THE GAME. A plug-in (../game/extensions.js); the flight
 * model is not edited. The deck stopped publishing its old "generous band"
 * of wire (src/world/carrier.js), so the flight model no longer stops jets
 * by itself; this file does, by steering the jet's horizontal position and
 * speed along the planned run-out each frame — after the physics has
 * stepped, so the stop is the stop whatever the engine is doing. The same
 * for the hold-back and the shot. Throws are fenced by the extension layer,
 * and if this feature is ever switched off the deck is still a 1.5 km
 * runway that wheel brakes can stop on.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { SPEC, EVENTS } from '../aircraft/physics.js';
import { performanceFor } from '../aircraft/types.js';
import { ACTIONS, keyLabel } from '../flight/input.js';
import { VOICES } from '../audio/atc.js';
import { heightAt, platformAt } from '../world/terrain.js';
import { SCALE } from '../world/carrier.js';
import { multiplayer } from './multiplayer.js';
import * as DK from './carrier/deck.js';
import { isMilitary, hasHookFor } from './carrier/who.js';
import { createLso, createPass, recordSample, lsoTick, gradePass, zoneOf } from './carrier/lso.js';
import { planArrest, arrestAt, planShot, hookGeometry, ARREST } from './carrier/gear.js';
import * as VIS from './carrier/visuals.js';
import * as UI from './carrier/ui.js';

const KT = 1.94384;
const FT = 3.28084;
const D2R = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* Named actions and voices                                            */
/* ------------------------------------------------------------------ */

/*
 * Two new named actions, so the keybinds screen can move them and the H card
 * lists them. Every letter is taken (T is STOVL and smoke, Y the ground crew,
 * Z the zapper, O getting out, R the warnings' reset, Enter the ejection
 * seat), so they sit on the two keys beside L: ";" for the hook, "'" to
 * salute the catapult officer. Both have touch buttons and the HOOK lamp
 * clicks.
 */
if (!ACTIONS.hook) ACTIONS.hook = { label: 'Tail hook up / down (carrier)', group: 'Flying', ctx: ['plane'], default: ['BracketLeft'] };
if (!ACTIONS.salute) ACTIONS.salute = { label: 'Salute — fire the catapult (carrier)', group: 'Flying', ctx: ['plane'], default: ['BracketRight'] };

/*
 * Paddles, and you. The radio puts the speaker above every subtitle; the
 * LSO's call sign is Paddles, and the ball call is the pilot's own.
 */
if (!VOICES.lso) VOICES.lso = { f0: 112, spread: 8, radio: 0.85, rate: 0.98, label: 'Paddles', tts: { pitch: 0.85, rate: 0.98 } };
if (!VOICES.self) VOICES.self = { f0: 128, spread: 10, radio: 1.0, rate: 1.06, label: 'You', tts: { pitch: 1.05, rate: 1.05 } };
if (!VOICES.boss) VOICES.boss = { f0: 92, spread: 8, radio: 1.05, rate: 0.95, label: 'Resolute Tower', tts: { pitch: 0.7, rate: 0.95 } };

/* ------------------------------------------------------------------ */
/* State                                                                */
/* ------------------------------------------------------------------ */

const STORE = 'islandsim.carrierStart.v1';

const S = {
  sim: null,
  f: null,
  gear: null,
  hookViz: null,
  scene: null,
  // The aeroplane.
  typeId: null,
  hasHook: false,
  military: false,
  stovl: false,
  geo: null,
  modelHook: false,
  hookDown: false,
  hookPos: 0,
  hookNow: new THREE.Vector3(),
  hookPrev: new THREE.Vector3(),
  hookPrevOk: false,
  // Where we are in the deck's life.
  mode: 'idle', // idle | cat | shot | launch | fly | arrest | held | deck
  carrierFlight: false,
  cat: null,
  arrest: null,
  launchT: 0,
  // The approach.
  lso: createLso(),
  pass: null,
  passes: [],
  lsoT: 0,
  callText: '',
  callUntil: 0,
  waveoffUntil: 0,
  cutUntil: 0,
  touched: null,
  bolterAt: null,
  lastResult: null,
  stage: null,
  zone: 'away',
  zoneT: 0,
  t: 0,
  rng: Math.random,
  stats: { shots: [], traps: [] },
  uiT: 0,
};

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ------------------------------------------------------------------ */
/* Who is what                                                          */
/* ------------------------------------------------------------------ */

function loadChoice() {
  try {
    const v = localStorage.getItem(STORE);
    return v === 'airbase' ? 'airbase' : 'carrier';
  } catch (e) {
    return 'carrier';
  }
}
function saveChoice(v) {
  try {
    localStorage.setItem(STORE, v === 'airbase' ? 'airbase' : 'carrier');
  } catch (e) {
    /* storage blocked: the choice lasts for this session */
  }
  S.choice = v;
}
function choice() {
  return S.choice || loadChoice();
}

function keyName(action) {
  const sim = S.sim;
  const codes = sim && sim.input && sim.input.bindings && sim.input.bindings[action];
  const c = codes && codes[0];
  // [ and ]: side by side, and free — ; is the goofy planes' drag chute.
  if (!c) return action === 'hook' ? '[' : ']';
  return keyLabel(c);
}
const kbd = (k) => `<kbd>${k}</kbd>`;
const isTouch = () => !!(S.sim && S.sim.touch);

/* ------------------------------------------------------------------ */
/* Radio                                                                */
/* ------------------------------------------------------------------ */

function radio(sim, text, voice = 'lso', urgency = 0) {
  try {
    if (sim.speak) sim.speak(text, voice, urgency);
  } catch (e) {
    /* a radio that cannot speak still shows the call on the ball panel */
  }
  if (voice === 'lso' || voice === 'self') {
    S.callText = voice === 'self' ? `“${text}”` : text;
    S.callUntil = S.t + 3.2;
  }
}

function note(sim, text, kind = 'info', secs = 3.5) {
  if (sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
}

/* ------------------------------------------------------------------ */
/* The deck                                                             */
/* ------------------------------------------------------------------ */

function frame(sim) {
  if (!sim.carrier) return null;
  return DK.frameFor(sim.carrier, SCALE);
}

/** Is this world point over the ship's deck? */
function overDeck(x, z) {
  const p = platformAt(x, z);
  return !!(p && S.sim && S.sim.carrier && p.name === S.sim.carrier.name);
}

/** Hook point in the world, for the aeroplane as it is now. */
function hookWorld(ac, out) {
  const g = S.geo;
  if (!g) return out.copy(ac.pos);
  // Stowed it lies along the fuselage; down it hangs to the point.
  const k = S.hookPos;
  const px = g.pivot.x;
  const py = g.pivot.y + (g.point.y - g.pivot.y) * k + 0.25 * (1 - k);
  const pz = g.pivot.z + (g.point.z - g.pivot.z) * (0.55 + 0.45 * k) + g.length * 0.3 * (1 - k);
  out.set(px, py, pz).applyQuaternion(ac.quat).add(ac.pos);
  return out;
}

function pivotWorld(ac, out) {
  const g = S.geo;
  return out.set(g.pivot.x, g.pivot.y, g.pivot.z).applyQuaternion(ac.quat).add(ac.pos);
}

/** Hold the aeroplane's heading exactly, by turning it about the vertical. */
function holdHeading(ac, hdg) {
  const now = ac.heading;
  const d = DK.angleDiff(hdg, now);
  if (Math.abs(d) < 0.05) return;
  const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -d * D2R);
  ac.quat.premultiply(q).normalize();
  ac.heading = hdg;
}

function snapCamera(sim) {
  const rig = sim.rig;
  if (!rig || typeof rig !== 'object') return;
  rig.initialised = false;
  if (rig.chaseVel && rig.chaseVel.set) rig.chaseVel.set(0, 0, 0);
}

function silenceRunwayCalls(sim) {
  const atc = sim.atc;
  if (!atc || !atc.said) return;
  for (const k of ['start', 'clearance', 'final', 'shortfinal', 'lowalt']) atc.said[k] = true;
}

/* ------------------------------------------------------------------ */
/* Starting on the ship                                                 */
/* ------------------------------------------------------------------ */

/** Which start slot this player has: 0 alone or hosting, the player number when joining. */
function mySlot() {
  try {
    if (multiplayer && multiplayer.role === 'client' && Number.isFinite(multiplayer.meId)) return Math.max(0, multiplayer.meId);
  } catch (e) {
    /* no multiplayer */
  }
  return 0;
}

function mpJoining() {
  try {
    return !!(multiplayer && multiplayer.role && multiplayer.transition);
  } catch (e) {
    return false;
  }
}

/**
 * Put the aeroplane on the ship. `where` is 'deck' (a catapult, or the
 * F-35B's take-off spot) or 'initial' (airborne behind the ship).
 */
export function placeOnCarrier(sim, where = 'deck', slot = 0) {
  const f = S.f || frame(sim);
  if (!f || !sim.aircraft) return false;
  S.f = f;
  const ac = sim.aircraft;
  const fuel = typeof ac.fuelFraction === 'function' ? clamp(ac.fuelFraction(), 0.05, 1) : 1;
  S.arrest = null;
  S.cat = null;
  if (where === 'initial') {
    const p = DK.patternPoints(f).initial;
    let speed = 110;
    try {
      const perf = performanceFor(sim.aircraftType.id);
      speed = clamp((perf.stallClean / KT) * 2.6, 90, 150);
    } catch (e) {
      /* a trainer's cruise */
    }
    ac.reset({ pos: V(p.x, 0, p.z), headingDeg: p.headingDeg, speed, altAGL: p.y - heightAt(p.x, p.z), engineOn: true, gearDown: false, fuel });
    ac.controls.throttle = 0.7;
    if (sim.input) {
      sim.input.throttleTarget = 0.7;
      if (sim.input.out) sim.input.out.throttle = 0.7;
    }
    S.mode = 'fly';
  } else if (S.stovl) {
    const spot = DK.stoSpot(f);
    ac.reset({ pos: V(spot.x, 0, spot.z), headingDeg: spot.headingDeg, speed: 0, altAGL: null, engineOn: true, fuel });
    if (sim.input) sim.input.throttleTarget = 0;
    S.mode = 'deck';
  } else {
    const s = DK.startSlot(f, slot);
    ac.reset({ pos: V(s.x, 0, s.z), headingDeg: s.headingDeg, speed: 0, altAGL: null, engineOn: true, fuel });
    if (sim.input) sim.input.throttleTarget = 0;
    if (s.kind === 'cat') enterCat(sim, s.cat);
    else S.mode = 'deck';
  }
  if (sim.taxi && sim.taxi.active && sim.taxi.stop) sim.taxi.stop();
  silenceRunwayCalls(sim);
  snapCamera(sim);
  S.carrierFlight = true;
  return true;
}

function enterCat(sim, c) {
  const ac = sim.aircraft;
  let stall = 40;
  try {
    stall = performanceFor(sim.aircraftType.id).stallClean / KT;
  } catch (e) {
    /* a fighter's */
  }
  S.cat = { c, plan: planShot(stall, DK.TUNE.catEndOverStall, DK.TUNE.catSeconds), t: 0, fireAt: null, saluted: false, start: { x: c.start.x, z: c.start.z } };
  S.mode = 'cat';
  ac.pos.x = c.start.x;
  ac.pos.z = c.start.z;
  ac.vel.set(0, 0, 0);
  holdHeading(ac, c.headingDeg);
  ac.parkingBrake = false;
}

/* ------------------------------------------------------------------ */
/* Hook, salute                                                         */
/* ------------------------------------------------------------------ */

export function setHook(sim, down) {
  if (!S.hasHook) {
    if (S.stovl) note(sim, 'The F-35B has no tail hook — it lands by hovering. Press <kbd>T</kbd> to swing the nozzle down.', 'info', 4.5);
    else note(sim, 'This aeroplane has no tail hook.', 'info', 2.5);
    return false;
  }
  S.hookDown = !!down;
  note(sim, S.hookDown ? 'Hook down' : 'Hook up', 'info', 1.6);
  if (!S.hookDown && S.mode === 'held') releaseWire(sim);
  return true;
}

function toggleHook(sim) {
  return setHook(sim, !S.hookDown);
}

export function salute(sim) {
  const ac = sim.aircraft;
  if (S.mode !== 'cat' || !S.cat) {
    if (S.stovl && S.mode === 'deck') note(sim, 'No catapult for the F-35B: full power for a rolling take-off, or <kbd>T</kbd> to lift straight up.', 'info', 4);
    return false;
  }
  if (S.cat.fireAt != null) return false;
  if ((ac.controls.throttle || 0) < 0.9) {
    note(sim, `Full power first — hold ${isTouch() ? 'the throttle up' : kbd('Shift')} — then salute.`, 'warn', 3);
    return false;
  }
  S.cat.saluted = true;
  S.cat.fireAt = S.t + 1.1;
  note(sim, 'Salute! The shooter touches the deck…', 'info', 1.6);
  return true;
}

/* ------------------------------------------------------------------ */
/* Catapult                                                             */
/* ------------------------------------------------------------------ */

function holdOnCat(sim, dt) {
  const ac = sim.aircraft;
  const c = S.cat;
  ac.pos.x = c.start.x;
  ac.pos.z = c.start.z;
  ac.vel.x = 0;
  ac.vel.z = 0;
  holdHeading(ac, c.c.headingDeg);
  if (c.fireAt != null) {
    if ((ac.controls.throttle || 0) < 0.85) {
      // The pilot came off the power after saluting: the launch is stopped.
      c.fireAt = null;
      c.saluted = false;
      note(sim, 'Suspend, suspend — power came off. Full power and salute again.', 'warn', 3.5);
    } else if (S.t >= c.fireAt) {
      fire(sim);
    }
  }
}

function fire(sim) {
  const c = S.cat;
  S.mode = 'shot';
  c.t = 0;
  VIS.puffSteam(S.gear, S.f, c.c);
  if (sim.rig && sim.rig.kick) sim.rig.kick(0.7);
}

function runShot(sim, dt) {
  const ac = sim.aircraft;
  const c = S.cat;
  const p = c.plan;
  c.t += dt;
  const t = Math.min(c.t, p.seconds);
  const v = p.a * t;
  const s = 0.5 * p.a * t * t;
  const d = c.c.dir;
  ac.pos.x = c.start.x + d.x * s;
  ac.pos.z = c.start.z + d.z * s;
  ac.vel.x = d.x * v;
  ac.vel.z = d.z * v;
  holdHeading(ac, c.c.headingDeg);
  if (c.t >= p.seconds) {
    S.mode = 'launch';
    S.launchT = 0;
    const shot = { vEndKts: Math.round(p.vEnd * KT), seconds: +p.seconds.toFixed(2), strokeM: Math.round(p.stroke), peakG: +p.peakG.toFixed(1), cat: c.c.n };
    S.stats.shots.push(shot);
    S.lastShot = shot;
    S.cat = null;
    note(sim, `Cat shot — ${shot.vEndKts} kt in ${shot.seconds} s`, 'good', 2.6);
  }
}

/** Hands-off launch: the jet rotates itself to about nine degrees, then the pilot has it. */
function launchAssist(sim, dt) {
  const ac = sim.aircraft;
  S.launchT += dt;
  const stick = Math.abs((sim.input && sim.input.out && sim.input.out.pitch) || 0);
  if (S.launchT > 1.8 || stick > 0.45 || ac.crashed) {
    S.mode = 'fly';
    return;
  }
  const err = 9 - ac.pitchAngleDeg();
  ac.omega.x = clamp(err * 0.02, -0.08, 0.14);
}

/* ------------------------------------------------------------------ */
/* Wires                                                                */
/* ------------------------------------------------------------------ */

function catchTolerance(ac) {
  const d = ac.difficulty || 'normal';
  return d === 'easy' ? 0.8 : d === 'realistic' ? 0.35 : 0.5;
}

/** Look for the wire the hook crossed this frame. */
function checkWires(sim) {
  const ac = sim.aircraft;
  const f = S.f;
  const now = S.hookNow;
  const prev = S.hookPrev;
  if (!S.hookPrevOk) return;
  if (!overDeck(now.x, now.z) && !overDeck(prev.x, prev.z)) return;
  const a = DK.station(f, prev.x, prev.z);
  const b = DK.station(f, now.x, now.z);
  const ha = prev.y - f.deckY;
  const hb = now.y - f.deckY;
  // First touch of the deck, for the record.
  if (hb <= 0.06 && S.pass && !S.pass.hookTouchS) S.pass.hookTouchS = b.s;
  if (b.s <= a.s) return; // only moving forward up the deck
  const speed = Math.hypot(ac.vel.x, ac.vel.z);
  if (speed < 12) return;
  if (!(S.hookPos > 0.9 && S.hookDown)) return;
  const tol = catchTolerance(ac);
  for (const w of DK.wires(f)) {
    if (a.s < w.s && b.s >= w.s) {
      const k = (w.s - a.s) / (b.s - a.s);
      const h = ha + (hb - ha) * k;
      const lat = a.lat + (b.lat - a.lat) * k;
      if (Math.abs(lat) > w.halfSpan) continue;
      if (h > tol) continue;
      // A hook bouncing off a hard arrival can skip a wire: rare, and never on easy.
      const hard = S.touched && S.touched.sinkFpm > 650;
      const skipP = ac.difficulty === 'realistic' ? (hard ? 0.12 : 0.05) : ac.difficulty === 'easy' ? 0 : hard ? 0.05 : 0;
      if (skipP > 0 && S.rng() < skipP) {
        if (S.pass) S.pass.skip = true;
        continue;
      }
      engage(sim, w);
      return;
    }
  }
}

function engage(sim, w) {
  const ac = sim.aircraft;
  const v0 = Math.hypot(ac.vel.x, ac.vel.z);
  const plan = planArrest(v0);
  S.arrest = {
    wire: w.n,
    plan,
    t: 0,
    start: { x: ac.pos.x, z: ac.pos.z },
    dir: { x: ac.vel.x / v0, z: ac.vel.z / v0 },
    rollT: 0,
    stopped: false,
    powerAtCatch: ac.controls.throttle || 0,
  };
  S.mode = 'arrest';
  if (S.pass) {
    S.pass.result = 'trap';
    S.pass.wire = w.n;
    if (S.pass.powerTd == null) S.pass.powerTd = (ac.controls.throttle || 0) >= 0.85;
  }
  try {
    ac.emit(EVENTS.ARRESTED, { speedKts: v0 * KT, wire: w.n });
  } catch (e) {
    /* the banner is a nicety */
  }
}

function runArrest(sim, dt) {
  const ac = sim.aircraft;
  const A = S.arrest;
  A.t += dt;
  const d = A.dir;
  let s;
  let v;
  if (!A.stopped) {
    const r = arrestAt(A.plan.v0, A.plan.A, A.t);
    s = r.s;
    v = r.v;
    if (r.stopped) {
      A.stopped = true;
      A.tStop = r.tStop;
      A.stopS = r.s;
    }
  } else {
    // The roll-back: the wire pulls the jet back a metre and a half.
    A.rollT += dt;
    const k = clamp(A.rollT / ARREST.rollbackTime, 0, 1);
    const e = k * k * (3 - 2 * k);
    s = A.stopS - ARREST.rollback * e;
    v = 0;
    if (k >= 1) toHeld(sim);
  }
  ac.pos.x = A.start.x + d.x * s;
  ac.pos.z = A.start.z + d.z * s;
  ac.vel.x = d.x * v;
  ac.vel.z = d.z * v;
  A.s = s;
}

function toHeld(sim) {
  const A = S.arrest;
  S.mode = 'held';
  const trap = {
    wire: A.wire,
    v0Kts: Math.round(A.plan.v0 * KT),
    stopM: +A.stopS.toFixed(1),
    stopS: +A.tStop.toFixed(2),
    peakG: +A.plan.peakG.toFixed(1),
  };
  S.stats.traps.push(trap);
  S.lastTrap = trap;
  finishPass(sim, `Stopped in ${Math.round(trap.stopM)} m, ${trap.stopS.toFixed(1)} s from ${trap.v0Kts} kt.`);
}

function holdInWire(sim) {
  const ac = sim.aircraft;
  const A = S.arrest;
  if (!A) return;
  ac.pos.x = A.start.x + A.dir.x * A.s;
  ac.pos.z = A.start.z + A.dir.z * A.s;
  ac.vel.x = 0;
  ac.vel.z = 0;
  if ((ac.controls.throttle || 0) <= 0.3) {
    S.heldIdleT = (S.heldIdleT || 0) + (S.lastDt || 0.016);
    // Throttled back and the hook still down: the director signals "hook up" and the wire drops.
    if (S.hookDown && S.heldIdleT > 4) {
      S.hookDown = false;
      note(sim, 'Hook up — the wire drops. Taxi clear.', 'info', 3);
    }
    if (!S.hookDown) releaseWire(sim);
  } else {
    S.heldIdleT = 0;
  }
}

function releaseWire(sim) {
  S.arrest = null;
  S.mode = 'deck';
  VIS.setEngaged(S.gear, null);
}

/* ------------------------------------------------------------------ */
/* The pass: groove, LSO, bolter, wave-off, grade                       */
/* ------------------------------------------------------------------ */

function typeShort(type) {
  if (!type) return 'Hornet';
  const id = type.id;
  return { fa18: 'Hornet', f22: 'Raptor', vanguard: 'Vanguard', nightjar: 'Nightjar', osprey: 'Osprey' }[id] || String(type.name || 'Hornet').split(' ').pop();
}

function callsignOf(sim) {
  const cs = (sim.aircraftType && sim.aircraftType.callsign) || 'Navy three hundred';
  return cs.replace(/^./, (c) => c.toUpperCase());
}

function fuelK(sim) {
  const kg = sim.aircraft.fuel || 0;
  return ((kg * 2.20462) / 1000).toFixed(1);
}

function reading(sim) {
  const ac = sim.aircraft;
  const f = S.f;
  const hk = S.hasHook ? S.hookNow : ac.pos;
  const g = DK.glide(f, hk.x, hk.y, hk.z);
  return {
    range: g.range,
    devDeg: g.devDeg,
    lat: g.lat,
    h: g.h,
    gearDown: ac.gearPos > 0.95,
    hookDown: S.hookDown && S.hookPos > 0.9,
    hasHook: S.hasHook,
    bankDeg: ac.bankAngleDeg(),
    airborne: !ac.onGround,
    foul: foulDeck(sim),
    callsign: callsignOf(sim),
    typeName: typeShort(sim.aircraftType),
    fuelK: fuelK(sim),
  };
}

/** Another player on the landing area, stopped or taxiing: the deck is foul. */
function foulDeck(sim) {
  try {
    const players = multiplayer && multiplayer.role && multiplayer.remotes && multiplayer.remotes.players;
    if (!players || !players.size) return false;
    for (const p of players.values()) {
      const at = p.drawn || (p.sample && p.sample.pos);
      if (!at || !p.visible) continue;
      if (Math.abs(at.y - S.f.deckY) > 6) continue;
      const st = DK.station(S.f, at.x, at.z);
      if (Math.abs(st.lat) < S.f.areaHalfWidth && st.s > DK.rampS(S.f) && st.s < S.f.touchdownS + 260) return true;
    }
  } catch (e) {
    /* no multiplayer */
  }
  return false;
}

function startPass(sim) {
  S.pass = createPass();
  S.pass.t0 = S.t;
  S.lso = createLso();
  S.touched = null;
  S.bolterAt = null;
}

function finishPass(sim, stop = '') {
  const p = S.pass;
  if (!p) return null;
  if (!p.result) p.result = 'waveoff';
  const g = gradePass(p);
  g.stop = stop;
  g.at = S.t;
  g.result = p.result;
  S.passes.push(g);
  if (S.passes.length > 12) S.passes.shift();
  S.lastResult = g;
  S.pass = null;
  UI.showBoard(g, S.passes, S.t);
  const title = g.key === 'OK*' ? 'OK — perfect pass' : g.grade;
  if (sim.hud && sim.hud.showBanner) {
    sim.hud.showBanner(
      g.wire ? `${title} · ${g.wire}-wire` : title,
      g.comment,
      g.grade === 'OK' ? 'good' : g.grade === 'Fair' ? 'info' : 'warn',
      4.5
    );
  }
  return g;
}

function updatePass(sim, dt) {
  const ac = sim.aircraft;
  const f = S.f;
  if (!S.hasHook || ac.crashed) return;
  const r = reading(sim);
  const zone = DK.patternZone(f, ac.pos.x, ac.pos.y, ac.pos.z, ac.heading);
  // A new pass begins in the groove.
  if (!S.pass && zone === 'groove' && r.airborne && r.range < 1900 && r.range > 120 && S.mode === 'fly') startPass(sim);
  const p = S.pass;
  if (!p) return;

  if (r.airborne && r.range > -60) recordSample(p, r);

  // Touchdown on the deck.
  if (!r.airborne && !S.touched && overDeck(ac.pos.x, ac.pos.z)) {
    const st = DK.station(f, ac.pos.x, ac.pos.z);
    S.touched = { s: st.s, t: S.t, throttle: ac.controls.throttle || 0, sinkFpm: Math.abs(ac.lastTouchdown ? ac.lastTouchdown.vsFpm : 0) };
    p.powerTd = (ac.controls.throttle || 0) >= 0.85;
    p.hookUp = !(S.hookDown && S.hookPos > 0.9);
    if (S.lso.waveoff) p.touchedAfterWaveoff = true;
  }
  // Power is judged over the half second after the wheels touch, the way a pilot slams it on.
  if (S.touched && !p.result && S.t - S.touched.t < 0.6 && (ac.controls.throttle || 0) >= 0.85) p.powerTd = true;

  // The LSO, five times a second.
  S.lsoT -= dt;
  if (S.lsoT <= 0 && S.mode === 'fly') {
    const step = 0.2 - S.lsoT;
    S.lsoT = 0.2;
    const calls = lsoTick(S.lso, r, step);
    for (const c of calls) {
      radio(sim, c.text, c.who === 'pilot' ? 'self' : 'lso', c.kind === 'urgent' || c.kind === 'waveoff' ? 0.6 : 0);
      if (c.kind === 'waveoff') {
        p.waveoff = true;
        p.waveoffReason = S.lso.waveoffReason;
        S.waveoffUntil = S.t + 5;
      }
      if (c.id === 'power' || c.id === 'powerpower') S.cutUntil = S.t + 1.6;
      if (c.id === 'ball') p.ballCalled = true;
    }
  }

  // The bolter: the hook has gone past the last wire on the deck without a catch.
  if (S.mode === 'fly' && S.touched && !p.result) {
    const wires = DK.wires(f);
    const last = wires[wires.length - 1];
    const hs = DK.station(f, S.hookNow.x, S.hookNow.z).s;
    if (hs > last.s + 3) {
      p.result = 'bolter';
      S.bolterAt = S.t;
      radio(sim, 'Bolter, bolter, bolter.', 'lso', 0.6);
      finishPass(sim, (ac.controls.throttle || 0) >= 0.85 ? 'Full power — fly off the angled deck and go round.' : 'POWER! Full power now and fly off the deck.');
      return;
    }
  }

  // A pass that ends without touching: a wave-off flown away, or the pilot's own go-around.
  if (r.airborne && !S.touched) {
    if (zone !== 'groove') S.zoneT += dt;
    else S.zoneT = 0;
    const gone = r.range < -80 || r.h > 220 || S.zoneT > 3;
    if (gone) {
      if (p.waveoff) {
        p.result = 'waveoff';
        finishPass(sim);
      } else if (r.range < 700 && p.ballCalled) {
        p.result = 'waveoff';
        p.waveoffReason = 'own';
        finishPass(sim);
      } else {
        S.pass = null; // drifted out of the groove early: no pass to grade
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Coaching: the hint line and the guide ring                           */
/* ------------------------------------------------------------------ */

function carrierContext(sim) {
  if (!S.f || !sim.aircraft) return false;
  if (S.carrierFlight) return true;
  const ac = sim.aircraft;
  const l = DK.toLocal(S.f, ac.pos.x, ac.pos.z);
  const near = Math.hypot(l.x, l.z) < 9000;
  return near && (S.hookDown || overDeck(ac.pos.x, ac.pos.z));
}

/** The hint line for the carrier, or null to leave the game's own. */
function coach(sim) {
  const ac = sim.aircraft;
  if (!ac || ac.crashed || !S.f) return null;
  const H = kbd(keyName('hook'));
  const SAL = isTouch() ? '<b>LAUNCH</b>' : kbd(keyName('salute'));
  const HK = isTouch() ? '<b>HOOK</b>' : H;
  const PWR = isTouch() ? 'the throttle all the way up' : kbd('Shift');
  switch (S.mode) {
    case 'cat': {
      if (S.cat && S.cat.fireAt != null) return 'Saluted — hands off, here comes the shot…';
      if ((ac.controls.throttle || 0) < 0.9) return `On catapult ${S.cat ? S.cat.c.n : 1}. Full power (${PWR}), then ${SAL} to salute — the catapult fires.`;
      return `Full power — now ${SAL} to salute and launch`;
    }
    case 'shot':
      return 'Cat shot!';
    case 'launch':
      return 'Hands off — it rotates itself. Then climb away and raise the wheels.';
    case 'arrest':
      return 'Trapped! Keep the power on until you stop.';
    case 'held':
      return `Stopped on the ${S.arrest ? `${S.arrest.wire}-wire` : 'wire'}. Throttle back, raise the hook (${HK}) and taxi clear.`;
    default:
      break;
  }
  if (!carrierContext(sim)) return null;
  if (ac.onGround && overDeck(ac.pos.x, ac.pos.z)) {
    if (S.stovl) return `F-35B: full power for a rolling take-off up the deck — or ${isTouch() ? '<b>HOVER</b>' : kbd('T')} to lift straight up.`;
    if (S.bolterAt != null && S.t - S.bolterAt < 20 && ac.groundSpeed > 3) return `BOLTER — full power (${PWR}) and fly off the angled deck!`;
    return 'Taxi forward onto catapult 1 (the track by the bow, right side) and stop on it to launch again.';
  }
  if (S.waveoffUntil > S.t) return `WAVE OFF — full power (${PWR}), climb straight ahead, then go round.`;
  const f = S.f;
  const zone = S.zone;
  const gearOk = ac.gearPos > 0.95;
  const hookOk = !S.hasHook || (S.hookDown && S.hookPos > 0.9);
  if (zone === 'groove') {
    if (!gearOk) return 'Wheels down! Press <kbd>G</kbd>.';
    if (!hookOk) return `HOOK DOWN — ${HK}.`;
    if (S.stovl) return 'F-35B: slow to a hover beside the deck with <kbd>T</kbd>, slide across and set down.';
    return `Fly the BALL: keep the orange ball level with the green lights. FULL POWER (${PWR}) as the wheels touch.`;
  }
  const l = DK.toLocal(f, ac.pos.x, ac.pos.z);
  if (zone === 'astern') return 'The initial: up the right side of the ship, 800 ft over the deck. Past the bow, BREAK — a hard turn left.';
  if (zone === 'upwind') {
    if (l.z < -f.halfDepth + 200) return 'BREAK! Hard turn left, round onto the downwind — back down the left side of the ship.';
    return 'Up the right side, 800 ft over the deck. Break left just past the bow.';
  }
  if (zone === 'downwind') {
    if (!gearOk || ac.flapStep() < 1 || !hookOk) return `Downwind: wheels (<kbd>G</kbd>), flaps (<kbd>F</kbd>) and HOOK (${HK}) down. Slow down; 600 ft over the deck.`;
    if (l.z > DK.TUNE.abeamAft - 250) return 'The 180: start a gentle turn left, coming down, towards the back of the ship.';
    return 'Downwind, 600 ft over the deck. Start your turn abeam the back of the ship.';
  }
  if (zone === 'base') return 'Keep turning left and coming down. Roll out lined up with the angled deck — the painted lane.';
  const d = Math.hypot(l.x, l.z);
  if (d < 14000 && S.carrierFlight && !ac.onGround && (S.hookDown || ac.airborneTime > 20)) {
    return 'To land: fly to the ring 5 km behind the ship — the INITIAL — 800 ft over the deck, pointing the way the ship points.';
  }
  return null;
}

/** The next mark of the pattern, for the guide ring. */
function nextMark(sim) {
  const ac = sim.aircraft;
  if (!S.f || !carrierContext(sim) || ac.onGround || S.mode !== 'fly') return null;
  if (sim.navGuide && sim.navGuide.enabled === false) return null;
  const pts = DK.patternPoints(S.f);
  const zone = S.zone;
  if (zone === 'groove') return null;
  if (zone === 'upwind') return { ...pts.abeam, radius: 110 };
  if (zone === 'downwind') {
    const l = DK.toLocal(S.f, ac.pos.x, ac.pos.z);
    return l.z > DK.TUNE.abeamAft - 150 ? { ...pts.groove, radius: 70 } : { ...pts.abeam, radius: 110 };
  }
  if (zone === 'base') return { ...pts.groove, radius: 70 };
  return { ...pts.initial, radius: 130 };
}

/* ------------------------------------------------------------------ */
/* The frame                                                            */
/* ------------------------------------------------------------------ */

function update(sim, dt) {
  S.t += dt;
  S.lastDt = dt;
  const ac = sim.aircraft;
  if (sim.mode === 'drive' || !ac || !S.f) {
    UI.setGate(true);
    return;
  }
  UI.setGate(!!(sim.hud && sim.hud.hidden));
  const input = sim.input;
  if (input && input.pressed) {
    if (input.pressed('hook')) toggleHook(sim);
    if (input.pressed('salute')) salute(sim);
  }

  // The hook travels in about a second and a half.
  const hookWant = S.hookDown ? 1 : 0;
  S.hookPos += clamp(hookWant - S.hookPos, -dt / 1.4, dt / 1.4);
  ac.hookDown = S.hasHook ? S.hookDown : undefined;

  S.hookPrev.copy(S.hookNow);
  hookWorld(ac, S.hookNow);

  if (ac.crashed) {
    S.mode = 'idle';
    S.arrest = null;
    S.cat = null;
    VIS.setEngaged(S.gear, null);
  } else {
    switch (S.mode) {
      case 'cat':
        holdOnCat(sim, dt);
        break;
      case 'shot':
        runShot(sim, dt);
        break;
      case 'launch':
        launchAssist(sim, dt);
        break;
      case 'arrest':
        runArrest(sim, dt);
        break;
      case 'held':
        holdInWire(sim);
        break;
      default:
        if (S.mode === 'idle') S.mode = 'fly';
        break;
    }
    // A jet taxiing onto a catapult is hooked up to it.
    if ((S.mode === 'deck' || S.mode === 'fly') && ac.onGround && !S.stovl && ac.groundSpeed < 3) {
      for (const c of DK.catapults(S.f)) {
        const dx = ac.pos.x - c.start.x;
        const dz = ac.pos.z - c.start.z;
        const along = dx * c.dir.x + dz * c.dir.z;
        const across = Math.abs(dx * c.dir.z - dz * c.dir.x);
        if (across < 7 && Math.abs(along) < 14 && Math.abs(DK.angleDiff(ac.heading, c.headingDeg)) < 25) {
          enterCat(sim, c);
          note(sim, `Hooked up to catapult ${c.n}. Full power, then salute.`, 'good', 3);
          break;
        }
      }
    }
    if (S.mode === 'fly' || S.mode === 'deck') {
      if (S.hasHook) checkWires(sim);
      if (S.mode === 'fly' || S.mode === 'deck') {
        if (!ac.onGround && S.mode === 'deck') S.mode = 'fly';
      }
    }
    if (S.mode === 'fly' || S.mode === 'arrest' || S.mode === 'deck' || S.mode === 'held') updatePass(sim, dt);
  }
  S.hookPrevOk = true;

  // Where in the pattern.
  const z = DK.patternZone(S.f, ac.pos.x, ac.pos.y, ac.pos.z, ac.heading);
  if (z !== S.zone) {
    S.zone = z;
  }

  draw(sim, dt);
}

function draw(sim, dt) {
  const ac = sim.aircraft;
  const f = S.f;
  const gear = S.gear;
  // The wire paying out.
  if (S.arrest && (S.mode === 'arrest' || S.mode === 'held')) VIS.setEngaged(gear, S.arrest.wire, S.hookNow);
  else VIS.setEngaged(gear, null);
  // The lens, for whoever is flying at it.
  let ballState = null;
  {
    const g = DK.glide(f, S.hookNow.x, S.hookNow.y, S.hookNow.z);
    const inBeam = g.range > 0 && g.range < 3500 && Math.abs(g.lat) < 120 + g.range * 0.3;
    const b = DK.ballCells(g.devDeg);
    VIS.updateLens(gear && gear.lens, dt, {
      cells: inBeam ? b.cells : 0,
      off: inBeam ? b.off : 'high',
      red: inBeam && b.red,
      waveoff: S.waveoffUntil > S.t,
      cut: S.cutUntil > S.t,
    });
    const showBall = S.hasHook && !ac.onGround && (S.zone === 'groove' || S.pass) && g.range < 3200 && g.range > -40;
    if (showBall) {
      ballState = {
        cells: b.cells,
        off: b.off,
        red: b.red,
        lat: g.lat,
        range: g.range,
        hFt: g.h * FT,
        kts: ac.ias * KT,
        waveoff: S.waveoffUntil > S.t,
        cut: S.cutUntil > S.t,
        call: S.callUntil > S.t ? S.callText : '',
      };
    }
  }
  UI.showBall(UI.boardShown() ? null : ballState);
  UI.tickBoard(S.t, false);
  // Blast deflector up behind a jet on the catapult with the power up.
  VIS.updateJbd(gear, dt, S.mode === 'cat' && S.cat ? S.cat.c.n : null);
  VIS.updateSteam(gear, dt);
  // The guide ring.
  const mark = nextMark(sim);
  VIS.setGate(gear, sim.scene, mark);
  if (sim.camera) VIS.updateGate(gear, dt, sim.camera.position);
  // A hook for jets whose model has none.
  if (S.hookViz && S.geo) {
    const show = S.hasHook && !S.modelHook && S.hookPos > 0.02;
    const pv = pivotWorld(ac, new THREE.Vector3());
    VIS.placeHook(S.hookViz, pv, S.hookNow, show);
  }
  // The lamp and the buttons.
  S.uiT -= dt;
  if (S.uiT <= 0) {
    S.uiT = 0.1;
    let chip = null;
    if (S.hasHook) {
      const groovingUp = S.zone === 'groove' && !S.hookDown;
      if (S.hookPos >= 0.98) chip = { text: 'HOOK DOWN', cls: 'good' };
      else if (S.hookPos <= 0.02) chip = { text: 'HOOK UP', cls: groovingUp ? 'warn' : 'dim', blink: groovingUp };
      else chip = { text: 'HOOK', cls: 'warn' };
    }
    UI.hookChip(sim.hud, chip);
    UI.buttons({
      hook: isTouch() && S.hasHook,
      hookDown: S.hookDown,
      launch: isTouch() && S.mode === 'cat',
      hot: S.mode === 'cat' && (ac.controls.throttle || 0) >= 0.9,
    });
  }
}

/* ------------------------------------------------------------------ */
/* Free Flight's start choice                                          */
/* ------------------------------------------------------------------ */

function installStartChoice(sim) {
  const menus = sim.menus;
  if (!menus) return;
  // The Free Flight screen's Take off carries the choice into startMode.
  if (menus.hooks && typeof menus.hooks.startFree === 'function' && !menus.hooks.startFree._carrier) {
    const orig = menus.hooks.startFree;
    const wrapped = (cfg) => orig({ ...(cfg || {}), startAt: (cfg && cfg.startAt) || choice() });
    wrapped._carrier = true;
    menus.hooks.startFree = wrapped;
  }
  const paint = () => {
    try {
      const root = menus.root;
      UI.startChoice(root, {
        get: choice,
        set: saveChoice,
        visible: () => {
          const id = menus.chosenAircraft;
          let t = null;
          try {
            t = sim.findAircraft ? sim.findAircraft(id) : null;
          } catch (e) {
            t = null;
          }
          return isMilitary(t || typeById(id));
        },
      });
    } catch (e) {
      /* no Free Flight screen in this build */
    }
  };
  paint();
  if (menus.root && menus.root.addEventListener) menus.root.addEventListener('click', () => setTimeout(paint, 0));
}

let AIRCRAFT_LIST = null;
function typeById(id) {
  if (!AIRCRAFT_LIST) return null;
  return AIRCRAFT_LIST.find((a) => a.id === id) || null;
}

/* ------------------------------------------------------------------ */
/* Registration                                                         */
/* ------------------------------------------------------------------ */

function resetFlight() {
  S.mode = 'idle';
  S.cat = null;
  S.arrest = null;
  S.pass = null;
  S.touched = null;
  S.bolterAt = null;
  S.hookDown = false;
  S.hookPos = 0;
  S.hookPrevOk = false;
  S.carrierFlight = false;
  S.waveoffUntil = 0;
  S.cutUntil = 0;
  S.callUntil = 0;
  S.zoneT = 0;
  S.lso = createLso();
  VIS.setEngaged(S.gear, null);
}

registerExtension({
  id: 'carrier-ops',

  install(sim) {
    S.sim = sim;
    sim.carrierOps = API;
    UI.build((id) => {
      if (id === 'hook') toggleHook(sim);
      else if (id === 'launch') salute(sim);
    });
    import('../aircraft/types.js').then((m) => { AIRCRAFT_LIST = m.AIRCRAFT; }).catch(() => {});
    installStartChoice(sim);
    // The hint line: the carrier's words when it has some, the game's otherwise.
    if (typeof sim.coachHint === 'function' && !sim.coachHint._carrier) {
      const own = sim.coachHint.bind(sim);
      const wrapped = (ac) => {
        try {
          const c = sim.state === 'flying' ? coach(sim) : null;
          if (c) return c;
        } catch (e) {
          /* fall back to the game's own line */
        }
        return own(ac);
      };
      wrapped._carrier = true;
      sim.coachHint = wrapped;
    }
    // "Back to runway" in a flight that started on the ship goes back to the ship.
    if (typeof sim.returnToAirport === 'function' && !sim.returnToAirport._carrier) {
      const own = sim.returnToAirport.bind(sim);
      const wrapped = () => {
        const wasCarrier = S.carrierFlight;
        own();
        if (wasCarrier && sim.aircraft) {
          resetFlight();
          placeOnCarrier(sim, 'deck', mySlot());
          note(sim, 'Back on the catapult, ready to go again.', 'info', 3);
        }
      };
      wrapped._carrier = true;
      sim.returnToAirport = wrapped;
    }
    // The tower does not talk over Paddles about a deck landing.
    const atc = sim.atc;
    if (atc && typeof atc.onTouchdown === 'function' && !atc._carrierTd) {
      const own = atc.onTouchdown.bind(atc);
      atc._carrierTd = true;
      atc.onTouchdown = (g) => {
        const ac = sim.aircraft;
        if (ac && overDeck(ac.pos.x, ac.pos.z) && S.hasHook) return undefined;
        return own(g);
      };
    }
  },

  buildWorld(sim, group) {
    S.scene = sim.scene;
    S.f = frame(sim);
    S.gear = null;
    S.hookViz = null;
    if (!S.f) return;
    S.gear = VIS.buildCarrierGear(group, S.f, sim.carrier);
    S.hookViz = VIS.buildHook(group);
  },

  startMode(sim, mode, opts) {
    resetFlight();
    if (!S.f) S.f = frame(sim);
    const type = sim.aircraftType;
    S.typeId = type ? type.id : null;
    S.military = isMilitary(type);
    S.stovl = !!(type && type.stovl);
    S.hasHook = hasHookFor(type);
    S.geo = hookGeometry(SPEC);
    // The pack draws an 'arrestorHook' that follows ac.hookDown; the built-in model draws one for `shape.hook`.
    S.modelHook = !!(type && type.shape && type.shape.hook);
    if (sim.model) sim.model.traverse((o) => { if (o.name === 'arrestorHook') S.modelHook = true; });
    if (!sim.aircraft || !S.f) return;
    let where = null;
    if (mode === 'free' && S.military) {
      let pick = opts && opts.startAt;
      const mp = mpJoining();
      if (!pick && mp) pick = choice();
      // A joiner the lobby has already put in the air beside its host stays there.
      if (mp && !sim.aircraft.onGround) pick = null;
      if (pick === 'carrier') where = opts && opts.airborne ? 'initial' : 'deck';
    } else if (mode === 'mission') {
      const def = sim.runner && sim.runner.def;
      if (def && def.carrierStart) where = def.carrierStart;
      if (def && (def.carrierStart || def.carrierOps)) S.carrierFlight = true;
    }
    if (where) {
      placeOnCarrier(sim, where, mySlot());
      if (mode === 'free' && sim.hud && sim.hud.setObjective) {
        sim.hud.setObjective(
          'Free Flight — CV-11 Resolute',
          where === 'initial'
            ? 'You are at the initial behind the carrier. Fly up its right side, break left past the bow, and come round to land on the wires.'
            : S.stovl
              ? 'You are on the carrier deck. Full power for a rolling take-off, or T to lift straight up. Come back and land by hovering.'
              : 'You are on catapult 1. Full power, then salute to launch. Come back and catch a wire — the 3-wire is the one to aim for.'
        );
      }
    }
  },

  stop(sim) {
    resetFlight();
    UI.showBall(null);
    UI.tickBoard(S.t, true);
    UI.buttons({});
  },

  update,

  devActions: [
    {
      label: 'Carrier: start on catapult 1',
      hint: 'Free Flight in the F/A-18 on the bow catapult',
      run(sim) {
        return Promise.resolve(sim.startMode('free', { aircraft: 'fa18', startAt: 'carrier', airborne: false }));
      },
    },
    {
      label: 'Carrier: start at the initial',
      hint: 'Airborne 5 km behind the ship, 800 ft over the deck',
      run(sim) {
        return Promise.resolve(sim.startMode('free', { aircraft: 'fa18', startAt: 'carrier', airborne: true }));
      },
    },
  ],
});

/* ------------------------------------------------------------------ */
/* The door for missions, tests and the console                        */
/* ------------------------------------------------------------------ */

const API = {
  get state() {
    return S;
  },
  get mode() {
    return S.mode;
  },
  get hookDown() {
    return S.hookDown;
  },
  get hasHook() {
    return S.hasHook;
  },
  get frame() {
    return S.f;
  },
  get passes() {
    return S.passes.slice();
  },
  get lastResult() {
    return S.lastResult;
  },
  get lastTrap() {
    return S.lastTrap || null;
  },
  get lastShot() {
    return S.lastShot || null;
  },
  get zone() {
    return S.zone;
  },
  setHook: (down) => setHook(S.sim, down),
  salute: () => salute(S.sim),
  placeOnCarrier: (where = 'deck', slot = 0) => placeOnCarrier(S.sim, where, slot),
  setRandom(fn) {
    S.rng = typeof fn === 'function' ? fn : Math.random;
  },
  /** Hook down and travelled, right now (for tests that drop a jet onto the wires). */
  hookNow() {
    S.hookDown = true;
    S.hookPos = 1;
  },
  reading: () => (S.sim && S.f ? reading(S.sim) : null),
  coach: () => (S.sim ? coach(S.sim) : null),
  isMilitary,
  hasHookFor,
  choice,
  setChoice: saveChoice,
  deck: DK,
};

export { API as carrierOps, isMilitary, hasHookFor };

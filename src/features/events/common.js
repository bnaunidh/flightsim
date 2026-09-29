/**
 * The small things both flight events need: who you are on the radio, which
 * field you are at, the runway's own frame, talking and showing things, story
 * beats counted in game time, and the police cars.
 *
 * These lived in flight-events.js while there was one story in it. There are
 * three now — the pizza car and two hijacks — and the hijacks live in their
 * own file, so the shared half moved here rather than being copied.
 */

import * as THREE from '../../vendor/three.module.js';
import * as AP from '../../world/airport.js';
import { heightAt, MAP, AIRPORT } from '../../world/terrain.js';
import { AIRCRAFT, getAircraft, performanceFor } from '../../aircraft/types.js';
import { VOICES } from '../../audio/atc.js';
import { createPoliceCar, Driver } from './vehicles.js';

export const RUNWAY = AP.RUNWAY;
export const FT = 3.28084;

export function typeOf(sim) {
  return (sim && sim.aircraftType) || getAircraft(sim && sim.settings ? sim.settings.aircraft : null);
}

export function callsign(sim) {
  const t = typeOf(sim);
  return (t && t.callsign) || 'Skylark one seven two';
}

export function field() {
  return MAP && MAP.name ? String(MAP.name).split(' ')[0] : 'Kestrel';
}

const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** A runway number the way the radio says it: 90 degrees is "zero nine". */
export function runwayWordsFor(deg) {
  const n = Math.round((((deg % 360) + 360) % 360) / 10) || 36;
  return String(n).padStart(2, '0').split('').map((d) => WORDS[Number(d)]).join(' ');
}

/** The same number as it is painted: 90 degrees is "09". */
export function runwayNumberFor(deg) {
  const n = Math.round((((deg % 360) + 360) % 360) / 10) || 36;
  return String(n).padStart(2, '0');
}

export function runwayWords() {
  return runwayWordsFor(RUNWAY.headingDeg ?? 90);
}

/** A heading as a pilot reads it out: 270 is "two seven zero". */
export function headingWords(deg) {
  const n = Math.round((((deg % 360) + 360) % 360) / 10) * 10 || 360;
  return String(n).padStart(3, '0').split('').map((d) => WORDS[Number(d)]).join(' ');
}

export function headingNumber(deg) {
  const n = Math.round((((deg % 360) + 360) % 360) / 10) * 10 || 360;
  return String(n).padStart(3, '0');
}

/** The long-haul airliner to fly, best first: the 747, the A380, anything marked long-haul, then the Meridian. */
export function longHaulId() {
  for (const id of ['b747', 'a380']) {
    if (AIRCRAFT.some((a) => a.id === id)) return id;
  }
  const any = AIRCRAFT.find((a) => a.longHaul);
  return any ? any.id : 'meridian';
}

/**
 * A speed to start a story at, in m/s, for this aeroplane.
 *
 * Both hijack spawns used a flat 75 m/s, which is right for the Meridian
 * (clean stall 91 kt, so 75 m/s is 1.6 times it) and was only ever checked
 * against it. The 747 and the A380 come from another roster file with their
 * own wings, and a story that opens with a stall warning is a worse story.
 * So it is half as fast again as this type's own clean stall, from its own
 * lift numbers, never under 75 and never near its never-exceed speed.
 */
export function cruiseSpeed(id) {
  let stall = 47;
  let vne = 168;
  try {
    const p = performanceFor(id);
    if (Number.isFinite(p.stallClean) && p.stallClean > 0) stall = p.stallClean / 1.94384;
    if (Number.isFinite(p.vne) && p.vne > 0) vne = p.vne / 1.94384;
  } catch (e) {
    /* an aeroplane with no numbers flies at the default */
  }
  return Math.min(Math.max(75, stall * 1.5), vne * 0.7);
}

/**
 * Power at idle and a foot on the brakes (or the parking brake set).
 */
export function idleHeld(ac) {
  return !!ac && ac.controls.throttle < 0.12 && (ac.controls.brakes > 0.5 || !!ac.parkingBrake);
}

/**
 * Stopped, as far as a story is concerned.
 *
 * "Under 2.5 m/s" was right for the Meridian, which creeps at 1.75 m/s with
 * the power off and the brakes full on. The big jets do not stop at all:
 * measured on Kestrel's runway with idle power and full brakes, the 747
 * settles at 2.70 m/s and the A380 at 3.03, for ever — idle thrust against
 * the flight model's brakes. So anything at idle and under 4.5 m/s has done
 * everything a pilot can, and counts. (Not "and the brakes on": the brakes
 * make no difference to that number, and a child who has pulled the power
 * off and is watching the police come has done the right thing.)
 */
export function stoppedNow(ac) {
  if (!ac || !ac.onGround) return false;
  return ac.groundSpeed < 2.5 || (ac.groundSpeed < 4.5 && ac.controls.throttle < 0.12);
}

export function span(sim) {
  const t = typeOf(sim);
  return (t && t.aero && t.aero.wingSpan) || 30;
}

export function speak(sim, text, voice = 'tower', urgency = 0) {
  if (sim && typeof sim.speak === 'function') sim.speak(text, voice, urgency);
}

export function notify(sim, text, kind = 'info', secs = 4) {
  if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
}

export function banner(sim, title, sub, kind = 'good', secs = 4) {
  if (sim && sim.hud && sim.hud.showBanner) sim.hud.showBanner(title, sub, kind, secs);
}

/** Horizontal distance. */
export function flat(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Compass bearing from a to b, degrees. */
export function bearing(a, b) {
  const d = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
  return (d + 360) % 360;
}

/** Signed difference b - a in degrees, -180..180. */
export function angleDiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

/* ------------------------------------------------------------------ *
 * The runway's own frame, so anything laid out round the runway follows
 * whichever runway is loaded rather than Kestrel's coordinates.
 * u runs along the runway (towards its heading), v to its right.
 * ------------------------------------------------------------------ */

export const RW = { c: new THREE.Vector3(), f: new THREE.Vector3(), r: new THREE.Vector3(), L: 1100 };

export function runwayFrame() {
  const h = THREE.MathUtils.degToRad(RUNWAY.headingDeg ?? 90);
  RW.f.set(Math.sin(h), 0, -Math.cos(h));
  RW.r.set(Math.cos(h), 0, Math.sin(h));
  RW.c.set(RUNWAY.cx ?? 0, RUNWAY.elev ?? 14, RUNWAY.cz ?? 0);
  RW.L = RUNWAY.length || 1100;
  return RW;
}

export function rw(u, v, out = new THREE.Vector3()) {
  out.copy(RW.c).addScaledVector(RW.f, u).addScaledVector(RW.r, v);
  out.y = heightAt(out.x, out.z);
  return out;
}

/**
 * The second runway — the crosswind one, away from the terminal — as a
 * centre, a unit vector along its heading and a length. Every map has one
 * ("every code path in the game expects a second runway to exist", maps.js);
 * if one ever does not, the main runway flown the other way stands in.
 */
export function secondRunway(out = { c: new THREE.Vector3(), f: new THREE.Vector3(), L: 900, headingDeg: 180, halfWidth: 15, real: true }) {
  const r2 = AIRPORT && AIRPORT.runway2;
  if (r2 && Number.isFinite(r2.cx) && Number.isFinite(r2.cz) && r2.length > 0) {
    const h = r2.headingDeg ?? 180;
    out.headingDeg = h;
    out.L = r2.length;
    out.halfWidth = r2.halfWidth || 15;
    out.c.set(r2.cx, AIRPORT.elev ?? RUNWAY.elev ?? 14, r2.cz);
    out.real = true;
  } else {
    out.headingDeg = ((RUNWAY.headingDeg ?? 90) + 180) % 360;
    out.L = RUNWAY.length || 1100;
    out.halfWidth = RUNWAY.halfWidth || 17;
    out.c.set(RUNWAY.cx ?? 0, RUNWAY.elev ?? 14, RUNWAY.cz ?? 0);
    out.real = false;
  }
  const rad = THREE.MathUtils.degToRad(out.headingDeg);
  out.f.set(Math.sin(rad), 0, -Math.cos(rad));
  return out;
}

/* ------------------------------------------------------------------ *
 * Story beats: things to do a few seconds from now. Counted in game
 * time, not with setTimeout, so pausing pauses the story too.
 * ------------------------------------------------------------------ */

export function after(ev, seconds, fn) {
  ev.beats.push({ at: ev.t + seconds, fn });
}

export function runBeats(ev, sim) {
  if (!ev.beats.length) return;
  for (let i = 0; i < ev.beats.length; i++) {
    const b = ev.beats[i];
    if (ev.t >= b.at) {
      ev.beats.splice(i, 1);
      i--;
      b.fn(sim);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Objective text.
 *
 * The mission versions of the stories drive them from their own steps
 * (owner 'mission'), and there the story writes nothing on the objective
 * panel: the mission's words are the ones on screen.
 *
 * Anywhere else a story writes its own lines, and the first line it writes
 * saves what the panel said before. restoreObjective() puts that back — but
 * only while the panel still shows the story's last line; if anything else
 * has written there since (a mission moving on a step), that is newer, and
 * stays.
 *
 * It did not use to save anything. The pizza car can turn up at the start of
 * somebody else's mission, and its "Hold position" went over the mission's
 * first step; the restore then did nothing at all while a mission was
 * running. Measured on Island Circuit: 76 s after the all-clear the panel
 * still said "Hold position ... keep still", while the card and the tower
 * said "cleared for take-off", and the step that tells a new player to press
 * Shift was gone for good.
 * ------------------------------------------------------------------ */

function shownTitle(hud) {
  if (hud.objectiveTitle && typeof hud.objectiveTitle.textContent === 'string') return hud.objectiveTitle.textContent;
  return hud.lastValues ? hud.lastValues.objTitle : undefined;
}

function shownText(hud) {
  if (hud.objectiveText && typeof hud.objectiveText.textContent === 'string') return hud.objectiveText.textContent;
  return hud.lastValues ? hud.lastValues.objText : undefined;
}

export function objective(sim, ev, title, text) {
  if (ev.owner === 'mission') return;
  const hud = sim && sim.hud;
  if (!hud || !hud.setObjective) return;
  if (!ev.objSaved) {
    ev.objSaved = true;
    ev.objWasTitle = shownTitle(hud);
    ev.objWasText = shownText(hud);
  }
  hud.setObjective(title, text);
  ev.objTitle = title;
  ev.objText = text;
}

/** True while the objective panel still says what this story last put there. */
export function objectiveIsOurs(sim, ev) {
  const hud = sim && sim.hud;
  if (!hud || !ev.objSaved) return false;
  return shownTitle(hud) === ev.objTitle && shownText(hud) === ev.objText;
}

export function restoreObjective(sim, ev) {
  if (ev.owner === 'mission' || !ev.objSaved) return;
  const hud = sim && sim.hud;
  const ours = objectiveIsOurs(sim, ev);
  const wasTitle = ev.objWasTitle;
  const wasText = ev.objWasText;
  ev.objSaved = false;
  if (!ours || !hud || !hud.setObjective) return;
  if (sim.runner && sim.runner.status === 'running') {
    // Somebody else's mission: its own step, exactly as it was.
    if (typeof wasTitle === 'string' && typeof wasText === 'string') hud.setObjective(wasTitle, wasText);
    return;
  }
  // Free Flight. Not the saved line: that was written at the start of the
  // flight ("You are already flying...", "Take off from runway 09...") and a
  // hijack ends with you parked at a stand.
  hud.setObjective('Free Flight', 'Explore the islands, and land back on the runway whenever you like.');
}

/* ------------------------------------------------------------------ *
 * Police cars, shared by every story
 * ------------------------------------------------------------------ */

export function addPolice(sim, list, x, z, heading, make = createPoliceCar) {
  const obj = make();
  sim.scene.add(obj);
  const d = new Driver(obj);
  d.place(x, z, heading);
  list.push(d);
  return d;
}

export function removePolice(sim, list) {
  for (const d of list) {
    if (d.obj && d.obj.parent) d.obj.parent.remove(d.obj);
    d.obj = null;
  }
  list.length = 0;
}

/* ------------------------------------------------------------------ *
 * Two voices the radio did not have.
 *
 * sim.speak(text, voice) looks the voice up in the radio's VOICES table and
 * falls back to the tower for anything it does not know — so the first
 * version of these stories had the fighter pilots and the captain speaking
 * in the tower's voice, with "KESTREL TOWER" over their subtitles. Adding
 * two entries to the table, once, gives them their own pitch and their own
 * name, in every voicing mode (the default radio chatter, the opt-in speech,
 * recordings), without touching the radio itself. The key is the label, so
 * the no-audio subtitle fallback (which prints the key) reads right too.
 * ------------------------------------------------------------------ */

export const VOICE_FIGHTER = 'Guardian flight';
export const VOICE_CAPTAIN = 'Captain (you)';

export function registerVoices() {
  try {
    if (!VOICES || typeof VOICES !== 'object') return;
    if (!VOICES[VOICE_FIGHTER]) {
      VOICES[VOICE_FIGHTER] = { f0: 136, spread: 8, radio: 1.3, rate: 1.24, label: VOICE_FIGHTER, tts: { pitch: 0.9, rate: 1.2 } };
    }
    if (!VOICES[VOICE_CAPTAIN]) {
      VOICES[VOICE_CAPTAIN] = { f0: 112, spread: 11, radio: 0.85, rate: 1.0, label: VOICE_CAPTAIN, tts: { pitch: 0.85, rate: 1.0 } };
    }
  } catch (e) {
    /* a frozen table just means the tower's voice, as before */
  }
}

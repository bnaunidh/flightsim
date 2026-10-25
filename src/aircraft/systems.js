/**
 * The pilot's own switches: exterior lights, the speedbrake / spoiler
 * lever, the thrust reversers, and what a radio request should get for an
 * answer. Pure rules — the physics (aircraft/physics.js) carries the state
 * and the effect, features/pilot-systems.js the keys, the buttons and the
 * words, and tests/features/pilot-systems.mjs checks these in node.
 *
 * LIGHTS. Every lamp has a switch: 'auto' (the lamp logic the game has
 * always had: nav and beacon with the engine, strobes once on the runway or
 * airborne, the landing light with the gear, dimmer as a taxi light rolling
 * slowly), 'on' or 'off'. The key cycles a PRESET for all five at once
 * (LIGHT_PRESETS); the lights card lets you set each lamp.
 *
 * SPOILERS. One lever: 0 in, ½ (flight detent) and FULL. In the air it is
 * the speedbrake: more drag, a little less lift. On the ground, stopped or
 * slow, a press ARMS or disarms the ground spoilers (armed, they come up
 * by themselves on the landing roll with the power at idle — how every
 * real auto-spoiler works, and how the game has always drawn them); rolling
 * fast on the ground a press puts them up or down by hand. Advancing the
 * power on the ground stows them: a take-off with spoilers out is not a
 * take-off.
 *
 * REVERSERS. On the ground only: stowed → idle reverse → MAX reverse → stowed.
 * Reverse thrust is real thrust the wrong way (about 45% of forward at the
 * same power, as the real cascades give), and the engines spool with it.
 * Pushing the power lever forward or leaving the ground stows them; so does
 * the end of the roll — the reverse fades out below about 15 kt and the
 * cascades close at a stop, so it can never drive the aeroplane backwards.
 *
 * WHO HAS THEM (hasReversers, hasSpoilers): airliners and the heavies both,
 * fighters a speedbrake only, the light aeroplanes and the helicopters
 * neither. types.js specFor copies the answer onto the flight spec, so the
 * physics, the keys and the touch sheets all ask the same question.
 */

export const LAMP_KINDS = Object.freeze(['nav', 'beacon', 'strobe', 'landing', 'taxi']);
export const LAMP_WORDS = Object.freeze({ nav: 'Nav lights', beacon: 'Beacon', strobe: 'Strobes', landing: 'Landing lights', taxi: 'Taxi light' });
export const SWITCHES = Object.freeze(['auto', 'on', 'off']);

/** The presets the key cycles, in order. `set` is each lamp's switch. */
export const LIGHT_PRESETS = Object.freeze([
  { id: 'auto', label: 'AUTO', words: 'Lights: automatic', set: { nav: 'auto', beacon: 'auto', strobe: 'auto', landing: 'auto', taxi: 'auto' } },
  { id: 'apron', label: 'NAV + BEACON', words: 'Lights: nav and beacon (on the apron)', set: { nav: 'on', beacon: 'on', strobe: 'off', landing: 'off', taxi: 'off' } },
  { id: 'taxi', label: 'TAXI', words: 'Lights: nav, beacon and taxi light', set: { nav: 'on', beacon: 'on', strobe: 'off', landing: 'off', taxi: 'on' } },
  { id: 'all', label: 'ALL ON', words: 'Lights: everything on', set: { nav: 'on', beacon: 'on', strobe: 'on', landing: 'on', taxi: 'on' } },
  { id: 'off', label: 'ALL OFF', words: 'Lights: everything off', set: { nav: 'off', beacon: 'off', strobe: 'off', landing: 'off', taxi: 'off' } },
]);

/** A fresh set of switches: everything automatic. */
export function defaultLights() {
  return { nav: 'auto', beacon: 'auto', strobe: 'auto', landing: 'auto', taxi: 'auto' };
}

/** Which preset these switches are, or null when the lamps were set one by one. */
export function lightPresetOf(lights) {
  if (!lights) return LIGHT_PRESETS[0];
  return LIGHT_PRESETS.find((p) => LAMP_KINDS.every((k) => (lights[k] || 'auto') === p.set[k])) || null;
}

/** The preset after this one (a mixed hand-set state goes back to AUTO). */
export function nextLightPreset(lights) {
  const cur = lightPresetOf(lights);
  if (!cur) return LIGHT_PRESETS[0];
  return LIGHT_PRESETS[(LIGHT_PRESETS.indexOf(cur) + 1) % LIGHT_PRESETS.length];
}

/** One lamp's switch, cycled: auto → on → off → auto. */
export function nextSwitch(s) {
  return SWITCHES[(SWITCHES.indexOf(s || 'auto') + 1) % SWITCHES.length];
}

/**
 * The lamps as they should burn, 0..1 each, from the switches and what the
 * automatic logic wants (`auto`, the same five names). A crashed aeroplane
 * has no lights whatever the switches say; a switch set 'on' lights the lamp
 * without the engine (the battery does), 'off' puts it out. The strobes'
 * flash and the beacon's blink are the caller's to multiply in.
 */
export function resolveLamps(lights, auto, { crashed = false } = {}) {
  const out = {};
  for (const k of LAMP_KINDS) {
    const s = (lights && lights[k]) || 'auto';
    const a = auto && Number.isFinite(auto[k]) ? auto[k] : 0;
    out[k] = crashed ? 0 : s === 'on' ? 1 : s === 'off' ? 0 : a;
  }
  // The landing light and the taxi light are the same lamp: landing is the
  // full beam, taxi the dimmer one. Never both at once.
  if (out.landing > 0) out.taxi = 0;
  return out;
}

/** The speedbrake lever's detents. */
export const SPOILER_DETENTS = Object.freeze([0, 0.5, 1]);
/** Rolling faster than this on the ground, the spoilers are a landing-roll thing, not an arming one (m/s). */
export const SPOILER_ROLL_MS = 18;
/** Ground spoilers come up with the power at idle: below this throttle. */
export const SPOILER_IDLE = 0.3;
/** Power past this on the ground stows the lever (a take-off). */
export const SPOILER_STOW_THROTTLE = 0.6;

/**
 * What a press of the spoiler lever does.
 *   in the air          the lever goes to the next detent: in → ½ → FULL → in
 *   on the ground, slow arm / disarm the ground spoilers (the lever stays in)
 *   on the ground, fast up by hand, or down
 * Returns the new { lever, armed } and a note for the HUD.
 */
export function spoilerPress({ onGround, groundSpeed = 0, lever = 0, armed = true }) {
  if (!onGround) {
    const i = SPOILER_DETENTS.indexOf(lever);
    const next = SPOILER_DETENTS[(i < 0 ? 0 : i + 1) % SPOILER_DETENTS.length];
    const words = next === 0 ? 'Speedbrake in' : next === 1 ? 'Speedbrake FULL — slowing down' : 'Speedbrake ½ — a little drag';
    return { lever: next, armed, note: words, kind: 'info' };
  }
  if (groundSpeed < SPOILER_ROLL_MS) {
    const on = !armed;
    return { lever: 0, armed: on, note: on ? 'Ground spoilers ARMED — they come up on the landing roll' : 'Ground spoilers disarmed', kind: on ? 'info' : 'warn' };
  }
  const up = lever < 0.5;
  return { lever: up ? 1 : 0, armed, note: up ? 'Ground spoilers up' : 'Ground spoilers down', kind: 'info' };
}

/**
 * How far the spoilers should be out this frame, 0..1: the lever, or the
 * armed ground spoilers on a landing roll with the power at idle. The
 * caller animates towards it. Also says whether the lever should stow
 * itself (power advanced on the ground).
 */
export function spoilerTarget({ onGround, groundSpeed = 0, throttle = 0, lever = 0, armed = true }) {
  if (onGround && throttle > SPOILER_STOW_THROTTLE) return { target: 0, stow: lever > 0 };
  let target = lever;
  if (onGround && armed && groundSpeed > SPOILER_ROLL_MS && throttle < SPOILER_IDLE) target = 1;
  return { target, stow: false };
}

/** The reverser lever's detents: stowed, idle reverse, MAX. */
export const REVERSE_DETENTS = Object.freeze([0, 0.5, 1]);
/** Reverse thrust, as a share of forward thrust at the same power. */
export const REVERSE_EFFICIENCY = 0.45;
/** The power lever past this with the reversers out stows them. */
export const REVERSE_STOW_THROTTLE = 0.3;

/** Below this forward speed on the ground the reversers fade to nothing (m/s, about 15 kt). */
export const REVERSE_FADE_MS = 8;
/** Below this the roll is over: the reversers stow themselves, or refuse to come out (m/s). */
export const REVERSE_STOPPED_MS = 1;

/**
 * What a press of the reverser lever does: on the ground, the next detent;
 * in the air, nothing but a word (the real ones are locked out airborne);
 * stopped, nothing either — reverse is for the landing roll, and pulled at a
 * standstill it would only blow the aeroplane backwards down the runway.
 * Returns { reverse, note, kind, refused }.
 */
export function reversePress({ onGround, reverse = 0, hasReversers = true, groundSpeed = Infinity }) {
  if (!hasReversers) return { reverse: 0, note: 'This aeroplane has no thrust reversers', kind: 'info', refused: true };
  if (!onGround) return { reverse: 0, note: 'Reversers are locked out in the air — land first', kind: 'warn', refused: true };
  if (!(reverse > 0) && groundSpeed < REVERSE_STOPPED_MS) return { reverse: 0, note: 'Reverse is for the landing roll — you are stopped', kind: 'info', refused: true };
  const i = REVERSE_DETENTS.indexOf(reverse);
  const next = REVERSE_DETENTS[(i < 0 ? 0 : i + 1) % REVERSE_DETENTS.length];
  const note = next === 0 ? 'Reversers stowed' : next === 1 ? 'MAX reverse' : 'Idle reverse';
  return { reverse: next, note, kind: 'info', refused: false };
}

/**
 * The engine's demand with the reverser lever: the share of full power the
 * cascades want (idle reverse is a touch above idle, MAX about 70% — a real
 * reverser never takes full power), and whether the lever must stow itself
 * (airborne, the power lever pushed forward, or the roll over: forward
 * speed below REVERSE_STOPPED_MS — a pilot has them stowed by taxi speed).
 * `forwardSpeed` is the ground speed along the nose (negative going backwards).
 */
export function reverseDemand({ onGround, throttle = 0, reverse = 0, forwardSpeed = Infinity }) {
  if (reverse <= 0) return { power: 0, stow: false };
  if (!onGround || throttle > REVERSE_STOW_THROTTLE || forwardSpeed < REVERSE_STOPPED_MS) return { power: 0, stow: true };
  return { power: reverse >= 1 ? 0.7 : 0.18, stow: false };
}

/**
 * How much of the reversed thrust acts, 0..1, from the forward ground speed:
 * all of it on the roll, fading out below REVERSE_FADE_MS, none at a stop —
 * so reverse slows the aeroplane and can never drive it backwards.
 */
export function reverseShare(forwardSpeed) {
  if (!Number.isFinite(forwardSpeed)) return 1;
  return Math.max(0, Math.min(1, forwardSpeed / REVERSE_FADE_MS));
}

/** Is this type a rotorcraft? Reads a types.js entry (shape.power.rotor, the class) or a flight spec (rotor). */
export function isRotorType(t) {
  if (!t) return false;
  if (t.rotor) return true;
  if (t.shape && t.shape.power && t.shape.power.rotor) return true;
  return /heli|rotor/i.test(String(t.class || ''));
}

/*
 * Who has what, by class (types.js `class`), with a type's own `reversers` /
 * `spoilers` true|false winning. Every airliner and heavy transport in the
 * roster has reversers (the Q400 its props' reverse pitch) and spoilers —
 * except Concorde, which had no spoilers at all. The fighters and bombers
 * have speedbrakes but no reversers. The light aeroplanes (Trainer, Tourer,
 * Racer: the 172, the tourers, the racers) have neither — a Skylark with
 * "MAX reverse" is not an aeroplane anyone has flown.
 */
const REVERSER_CLASSES = new Set(['airliner']);
const SPOILER_CLASSES = new Set(['airliner', 'fighter', 'carrier']);
const NO_SPOILERS = new Set(['concorde']);
const cls = (t) => String((t && t.class) || '').toLowerCase();

/** Does this type have reversers to pull? A types.js entry, or a flight spec carrying `reversers`. */
export function hasReversers(t) {
  if (!t || isRotorType(t)) return false;
  if (typeof t.reversers === 'boolean') return t.reversers;
  return REVERSER_CLASSES.has(cls(t));
}

/** Does this type have spoilers / a speedbrake? A types.js entry, or a flight spec carrying `spoilers`. */
export function hasSpoilers(t) {
  if (!t || isRotorType(t)) return false;
  if (typeof t.spoilers === 'boolean') return t.spoilers;
  if (NO_SPOILERS.has(t.id)) return false;
  return SPOILER_CLASSES.has(cls(t));
}

/* ------------------------------------------------------------------ *
 * The radio
 * ------------------------------------------------------------------ */

/** The requests the radio menu offers, in order. */
export const ATC_REQUESTS = Object.freeze([
  { id: 'pushback', label: 'Pushback', words: 'request pushback' },
  { id: 'taxi', label: 'Taxi', words: 'request taxi' },
  { id: 'takeoff', label: 'Take-off', words: 'ready for departure' },
  { id: 'landing', label: 'Landing', words: 'request landing' },
]);

/**
 * Which request fits the moment: on a stand → pushback; on the ground off
 * the runway → taxi; lined up on the runway → take-off; in the air → landing.
 */
export function suggestedRequest({ onGround, onStand = false, onRunway = false, airborne = false }) {
  if (airborne || !onGround) return 'landing';
  if (onStand) return 'pushback';
  if (onRunway) return 'takeoff';
  return 'taxi';
}

/**
 * The controller's answer to a request, from where the aeroplane is. Every
 * line is one the game's ATC already says (game/atc-director.js) or its
 * plain refusal; `mark` is the director's once() key the answer stands in
 * for, so the automatic call does not repeat it a moment later. `voice` is
 * who answers.
 *   ctx: { callsign, field, runway (spoken), wind (spoken), onGround,
 *          onStand, onRunway, lined, airborne, side ('left'|'right'|null) }
 */
export function atcAnswer(request, ctx) {
  const c = ctx || {};
  const who = c.callsign || 'Skylark one seven two';
  const field = c.field || 'Kestrel';
  const rw = c.runway || 'zero nine';
  const wind = c.wind ? `, ${c.wind}` : '';
  switch (request) {
    case 'pushback':
      if (!c.onGround) return { text: `${who}, ${field} Ground, you are airborne. Say again?`, voice: 'ground', mark: null, ok: false };
      if (!c.onStand) return { text: `${who}, ${field} Ground, negative, you are not on a stand. Taxi to a stand for a push.`, voice: 'ground', mark: null, ok: false };
      return {
        text: `${who}, ${field} Ground, push back approved${c.side ? `, face ${c.side}` : ''}, expect runway ${rw}${wind}. Call for taxi when ready.`,
        voice: 'ground', mark: 'pushback', ok: true,
      };
    case 'taxi':
      if (!c.onGround) return { text: `${who}, ${field} Ground, you are airborne. Contact Tower for landing.`, voice: 'ground', mark: null, ok: false };
      if (c.onRunway) return { text: `${who}, ${field} Tower, you are on the runway. Say ready for departure, or vacate.`, voice: 'tower', mark: null, ok: false };
      return { text: `${who}, ${field} Ground, runway ${rw}${wind}. Taxi to the holding point and hold short.`, voice: 'ground', mark: 'start', ok: true };
    case 'takeoff':
      if (!c.onGround) return { text: `${who}, ${field} Tower, you are already airborne. Climb at your discretion.`, voice: 'tower', mark: null, ok: false };
      if (!c.onRunway) return { text: `${who}, ${field} Tower, hold short of runway ${rw}. Taxi to the holding point and report ready.`, voice: 'tower', mark: null, ok: false };
      if (!c.lined) return { text: `${who}, ${field} Tower, line up runway ${rw} and wait.`, voice: 'tower', mark: null, ok: false };
      return { text: `${who}, ${field} Tower${wind}, runway ${rw}, cleared for take-off.`, voice: 'tower', mark: 'clearance', ok: true };
    case 'landing':
      if (c.onGround) return { text: `${who}, ${field} Tower, you are on the ground. Taxi to the apron.`, voice: 'tower', mark: null, ok: false };
      return { text: `${who}, cleared to land runway ${rw}${wind}.`, voice: 'tower', mark: 'final', ok: true };
    default:
      return { text: `${who}, ${field} Tower, say again?`, voice: 'tower', mark: null, ok: false };
  }
}

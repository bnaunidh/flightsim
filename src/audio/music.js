/**
 * Generative music: one instrument, many weathers.
 *
 * The old file here was a fixed four-chord pad that only ever played on the
 * menu, so the twenty minutes a child actually spends flying had no music at
 * all. The answer is not fourteen tunes for fourteen missions. It is one small
 * instrument — five voices, built once and never rebuilt — and a table of
 * numbers that says how each scene shapes it.
 *
 * The audience is a class of ten-year-olds on school Chromebooks, twenty
 * minutes at a time, thirty machines in one room, term after term. That single
 * fact decides nearly every design choice below:
 *
 *  - There is no melody anywhere, ever. Nothing in this system can be hummed.
 *    The only recognisable material is timbre and harmonic colour, and both of
 *    them drift. A tune you can hum is unbearable by the third lesson.
 *  - There are no cadences. A cadence is what makes music memorable, and here
 *    memorable is the enemy. The chord walk is a weighted random step that is
 *    forbidden from resolving, except three times in the whole game.
 *  - Every cyclic thing runs on a period that shares no small multiple with any
 *    other (13.7 s, 41 s, 23.3 s, 7.3 s, 97 s), so the combination does not
 *    return to its starting alignment inside a lesson, or inside a term.
 *  - Silence is a parameter. Every scene declares how much of any two minutes
 *    the bell voice must keep quiet. Those long stretches of pad, engine and
 *    wind with nothing else in them are the music, not a gap in it.
 *  - Only six of the twenty scenes have a pulse: the ones that genuinely have a
 *    clock or a pursuer. A metronome in a mission with nothing to time is a
 *    lie, and it is the fastest route to fatigue.
 *  - The two scenes heard most often, the menu and Free Flight, are the two
 *    sparsest in the game. That inverts the usual mistake of putting the
 *    catchiest thing on the title screen.
 *
 * And it must cost almost nothing. Thirty-three nodes live permanently; at most
 * twelve more exist at a peak; nothing is allocated when a scene changes,
 * because a scene change moves parameters rather than building a graph. For
 * comparison, the single static pad this replaces already peaked around forty
 * nodes, because it created nine oscillators and nine gains per chord and let
 * them overlap. So the whole system costs roughly what one pad used to.
 *
 * The music never competes with the two sounds that teach — the ATC radio and
 * the stall horn. Both of them reach into a single duck gain and a single tilt
 * filter, and the tilt matters more than the gain: what masks speech is not
 * loudness, it is energy in the 500 Hz to 4 kHz band. Dropping the music's
 * brightness moves it out from under the words, so it can stay audible and
 * still be completely intelligible underneath.
 */

import { clamp } from '../core/noise.js';
import { VEHICLE_SCENES, CAR_PHASES } from './vehicles.js';

/* ------------------------------------------------------------------ *
 * Musical tables
 * ------------------------------------------------------------------ */

/*
 * Modes, darkest to brightest. Several scenes climb this ladder on the way
 * home: Island Patrol lights up one step per contact identified, and Shake the
 * Tail turns from a chase into an escort by brightening twice. "Brighten one
 * step" is then a single call rather than a new key signature.
 */
const LADDER = ['phrygian', 'aeolian', 'dorian', 'mixolydian', 'ionian', 'lydian'];
const MODES = {
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};
const ROOTS = { C: 0, 'C#': 1, D: 2, Eb: 3, E: 4, F: 5, 'F#': 6, G: 7, Ab: 8, A: 9, Bb: 10, B: 11 };

/*
 * How likely the walk is to step to each scale degree, indexed 0..6 as
 * i, ii, III, IV, v, VI, VII. The tonic is common enough to feel like home and
 * the sixth is the most likely move, which is what gives the whole game its
 * open, unresolved colour. The current chord is always excluded, so nothing
 * ever repeats, and the step v to i — an authentic cadence, the most memorable
 * gesture in tonal music — is forbidden unless a resolve has been armed.
 */
const WALK = [0.3, 0.07, 0.12, 0.24, 0.05, 0.34, 0.18];

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const lerp = (a, b, t) => a + (b - a) * t;

/** Small seeded generator, so a session's salt is reproducible within itself. */
function mulberry(seed) {
  let a = (seed * 4294967296) >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Scenes
 *
 * A scene is not a piece of music. It is two parameter sets — CALM and PEAK —
 * and a driver that moves one number, intensity, between them. Everything
 * below is lerped: register, brightness, tension, space, the five voice gains,
 * how often a bell may ring and how often the harmony moves. Twenty scenes of
 * about a dozen numbers each is a page of data, not fourteen compositions.
 * ------------------------------------------------------------------ */

/** Defaults, so a scene only has to state what makes it itself. */
const BASE = {
  reg: 0.5, // register: 0 is low and heavy, 1 is high and thin
  bright: 0.5, // drives the tilt filter, 600 Hz to 2600 Hz
  tension: 0.2, // how wide the pad detunes and how likely a colour tone is
  space: 0.45, // delay time and feedback
  pad: 0.85,
  bass: 0.5,
  bell: 0.45,
  pulse: 0,
  air: 0.3,
  bellEvery: 9, // seconds; the real interval is randomised around this
  chordEvery: 15,
  tempo: 0, // zero means this scene has no tempo at all
  sub: 4, // 4 is on the beat, 8 subdivides
};

const SCENES = {
  /* The island before you go. The most-heard music in the game, so deliberately
   * the sparsest thing in it: a class stares at this while thirty machines
   * load, and it has to survive ten minutes of that without being noticed. */
  menu: {
    key: 'D', mode: 'dorian', rest: 0.6, base: 0.2, drift: 0.05,
    calm: { reg: 0.8, bright: 0.42, tension: 0.1, space: 0.5, pad: 0.9, bass: 0.3, bell: 0.34, air: 0.22, bellEvery: 9, chordEvery: 16 },
    peak: { reg: 0.85, bright: 0.55, tension: 0.2, space: 0.55, pad: 0.95, bass: 0.35, bell: 0.42, air: 0.28, bellEvery: 7.5, chordEvery: 12 },
  },

  /* A patient teacher. The instructor talks almost continuously here, so the
   * radio duck is near-permanent — that is correct, not a bug. The raised
   * fourth appears in the pad as colour and is never struck by a bell, so it
   * stays a warmth rather than a wrong note. */
  tutorial: {
    key: 'F', mode: 'ionian', rest: 0.55, base: 0.15, thinLow: true, colour: [6], padOnlyColour: true,
    phases: { rotate: 0.22, climb: 0.2, land: 0.3, final: 0.3, touch: 0.3 },
    calm: { reg: 0.6, bright: 0.45, tension: 0.12, pad: 0.9, bass: 0.4, bell: 0.3, air: 0.18, bellEvery: 10, chordEvery: 17 },
    peak: { reg: 0.6, bright: 0.55, tension: 0.18, pad: 0.95, bass: 0.45, bell: 0.4, air: 0.24, bellEvery: 8, chordEvery: 14 },
  },

  /* The long afternoon. Somewhere to be, nowhere to get to. Driven entirely by
   * how the aeroplane is being flown and hard-capped so it never becomes
   * dramatic; the widest delay in the game, and the lowest bell density
   * outside Dead Stick and Recon. */
  free: {
    key: 'D', mode: 'dorian', rest: 0.6, base: 0.1, auto: 'flight', cap: 0.45,
    calm: { reg: 0.75, bright: 0.4, tension: 0.1, space: 1, pad: 0.9, bass: 0.28, bell: 0.3, air: 0.24, bellEvery: 11, chordEvery: 18 },
    peak: { reg: 0.7, bright: 0.62, tension: 0.3, space: 0.9, pad: 0.95, bass: 0.4, bell: 0.4, air: 0.4, bellEvery: 8, chordEvery: 13 },
  },

  /* First proper flight, and it is going well. The only scene in the game that
   * is straightforwardly happy — and still with no clock, because a first
   * circuit does not have one and should not be given one. */
  circuit: {
    key: 'G', mode: 'mixolydian', rest: 0.35, base: 0.25, thinLow: true,
    phases: { brief: 0.15, rotate: 0.35, climb: 0.3, lap: 0.25, lap2: 0.25, lap3: 0.25, downwind: 0.3, land: 0.2 },
    calm: { reg: 0.6, bright: 0.5, tension: 0.1, pad: 0.85, bass: 0.45, bell: 0.4, air: 0.22, bellEvery: 8.5, chordEvery: 15 },
    peak: { reg: 0.7, bright: 0.68, tension: 0.16, pad: 0.9, bass: 0.5, bell: 0.55, air: 0.3, bellEvery: 6.5, chordEvery: 12 },
  },

  /* An errand worth doing. The first mission with a job to time, so the first
   * with a clock you can hear — a soft thud every other beat, nothing more. */
  delivery: {
    key: 'C', mode: 'mixolydian', rest: 0.3, base: 0.3, pulseOn: true, thinLow: true,
    phases: { load: 0.2, cruise: 0.3, descend: 0.4, drop: 0.5, home: 0.25, land: 0.15 },
    pulseOff: ['land'],
    calm: { reg: 0.55, bright: 0.5, tension: 0.12, pad: 0.85, bass: 0.5, bell: 0.42, pulse: 0.3, air: 0.25, tempo: 66, bellEvery: 8, chordEvery: 14 },
    peak: { reg: 0.6, bright: 0.66, tension: 0.22, pad: 0.9, bass: 0.58, bell: 0.5, pulse: 0.45, air: 0.34, tempo: 66, bellEvery: 6, chordEvery: 11 },
  },

  /* Weather has opinions. Unstable and heavy, never frightening: this is a
   * child learning a crosswind landing. Intensity here raises TENSION, not
   * density — the chords do not come faster, they get less comfortable — and
   * the wind is the lead instrument, so there is no pulse. A metronome in a
   * storm is fake drama. */
  storm: {
    key: 'D', mode: 'aeolian', rest: 0.4, base: 0.5, colour: [1], thinLow: true,
    phases: { brief: 0.5, final: 0.6, land: 0.35 },
    calm: { reg: 0.4, bright: 0.4, tension: 0.5, space: 0.7, pad: 0.8, bass: 0.55, bell: 0.25, air: 0.6, bellEvery: 12, chordEvery: 16 },
    peak: { reg: 0.35, bright: 0.5, tension: 1, space: 0.8, pad: 0.85, bass: 0.65, bell: 0.28, air: 0.85, bellEvery: 11, chordEvery: 15 },
  },

  /* The sky goes quiet. This scene proves the system can do drama by removing
   * things rather than adding them: at the cut everything but one low note
   * leaves, then twelve seconds of near-silence, then the pad creeps back at a
   * third of its level with chords twenty-five seconds apart. If a child says
   * the music stopped when the engine did, it has worked. */
  deadstick: {
    key: 'A', mode: 'aeolian', rest: 0.75, base: 0.15, immediate: true,
    phases: { quit: 0.55, glide: 0.15, touch: 0.4 },
    calm: { reg: 0.35, bright: 0.3, tension: 0.25, space: 0.6, pad: 0.45, bass: 0.6, bell: 0.2, air: 0.3, bellEvery: 18, chordEvery: 25 },
    peak: { reg: 0.4, bright: 0.42, tension: 0.4, space: 0.65, pad: 0.7, bass: 0.7, bell: 0.3, air: 0.4, bellEvery: 9, chordEvery: 20 },
  },

  /* Moving fast past something dangerous. The bass holds a pedal root that
   * never moves, which sustains tension for four minutes without repeating
   * anything, and the harmony above it changes only every sixteen beats. */
  emberrun: {
    key: 'E', mode: 'phrygian', rest: 0.3, base: 0.45, pulseOn: true, pedal: true, colour: [1],
    phases: { brief: 0.45, lap: 0.45, lap2: 0.55, lap3: 0.65, lap4: 0.75, land: 0.3 },
    pulseOff: ['land'],
    calm: { reg: 0.45, bright: 0.45, tension: 0.4, space: 0.4, pad: 0.7, bass: 0.6, bell: 0.22, pulse: 0.5, air: 0.4, tempo: 132, bellEvery: 11, chordEvery: 7.3 },
    peak: { reg: 0.45, bright: 0.62, tension: 0.75, space: 0.45, pad: 0.75, bass: 0.7, bell: 0.28, pulse: 0.7, air: 0.55, tempo: 132, bellEvery: 9, chordEvery: 7.3 },
  },

  /* Careful, in the dark, with a life aboard. Outbound there is almost nothing
   * — night instrument flying needs concentration and silence. Homebound the
   * pulse appears with the patient, and its grid is the patient's own heart
   * rate, halved above 140 so it never becomes a machine gun. Land it calm and
   * the only warm cadence in the game fires. That is the reward, and it is
   * worth more than a fanfare. */
  medevac: {
    key: 'Bb', mode: 'aeolian', rest: 0.5, base: 0.2, colour: [1], thinLow: true,
    phases: { go: 0.2, out: 0.2, pickup: 0.35, back: 0.3, land: 0.25 },
    pulseOnPhases: ['back', 'land'],
    calm: { reg: 0.3, bright: 0.34, tension: 0.25, space: 0.6, pad: 0.85, bass: 0.5, bell: 0.25, pulse: 0.3, air: 0.3, tempo: 96, bellEvery: 13, chordEvery: 19 },
    peak: { reg: 0.3, bright: 0.46, tension: 0.6, space: 0.6, pad: 0.85, bass: 0.6, bell: 0.3, pulse: 0.5, air: 0.38, tempo: 96, bellEvery: 10, chordEvery: 15 },
  },

  /* Chasing something that is chasing you back. The air is not going where you
   * point it and neither is the music: the pulse is deliberately jittered so it
   * can never lock to a grid, and the tritone never leaves. */
  chaser: {
    key: 'D', mode: 'aeolian', rest: 0.3, base: 0.35, pulseOn: true, jitter: 0.25, colour: [6], pinTension: 1,
    phases: { find: 0.35, passes: 0.5, home: 0.3 },
    pulseOff: ['home'],
    calm: { reg: 0.45, bright: 0.42, tension: 1, space: 0.6, pad: 0.8, bass: 0.55, bell: 0.22, pulse: 0.4, air: 0.7, tempo: 96, bellEvery: 12, chordEvery: 14 },
    peak: { reg: 0.4, bright: 0.6, tension: 1, space: 0.7, pad: 0.85, bass: 0.65, bell: 0.26, pulse: 0.6, air: 1, tempo: 96, bellEvery: 10, chordEvery: 11 },
  },

  /* No margin at all. Composed and exact; a ship's bell, not a drum. The pulse
   * here is dead steady, the exact opposite of Storm Chaser's jitter, and
   * inside a kilometre of the deck everything but the bass and one pad pair
   * stops. The trap itself is silent, because silence is how the music says
   * this matters. */
  carrierqual: {
    key: 'A', mode: 'dorian', rest: 0.35, base: 0.3, pulseOn: true, thinLow: true,
    phases: { depart: 0.3, pattern: 0.45, trap: 0.5 },
    calm: { reg: 0.6, bright: 0.45, tension: 0.15, space: 0.5, pad: 0.85, bass: 0.5, bell: 0.35, pulse: 0.22, air: 0.3, tempo: 72, bellEvery: 9, chordEvery: 15 },
    peak: { reg: 0.7, bright: 0.58, tension: 0.28, space: 0.55, pad: 0.85, bass: 0.55, bell: 0.42, pulse: 0.3, air: 0.36, tempo: 72, bellEvery: 7.5, chordEvery: 12 },
  },

  /* Professional and purposeful, with a long way to go. Military without being
   * martial: no snare, no fanfare, no brass. This is a school game. Finding a
   * contact literally lights the music up, which is the clearest piece of audio
   * feedback in the whole system. */
  patrol: {
    key: 'E', mode: 'dorian', rest: 0.3, base: 0.35, pulseOn: true, walkingBass: true,
    phases: { brief: 0.35, intercept: 0.35, rtb: 0.25 },
    pulseOff: ['rtb'],
    calm: { reg: 0.5, bright: 0.46, tension: 0.18, space: 0.45, pad: 0.85, bass: 0.55, bell: 0.4, pulse: 0.3, air: 0.28, tempo: 84, bellEvery: 8, chordEvery: 14 },
    peak: { reg: 0.55, bright: 0.62, tension: 0.32, space: 0.5, pad: 0.85, bass: 0.6, bell: 0.5, pulse: 0.45, air: 0.36, tempo: 84, bellEvery: 6, chordEvery: 11 },
  },

  /* Hold it steady, and do not be seen. Intensity is INVERTED here: it rises as
   * you climb, so below five hundred feet the music is nearly gone and that is
   * the sound of doing it right. Go high and one sustained dissonant pad tone
   * fades in over three seconds. It is capped low and it is a pad tone, never a
   * beep, so it can never be mistaken for a real alert — but the music is
   * teaching the mission's constraint, which no other scene does. */
  recon: {
    key: 'F#', mode: 'aeolian', rest: 0.75, base: 0.1, auto: 'recon', cap: 0.3, colour: [1, 6], breath: true,
    phases: { brief: 0.1, shoot: 0.1, home: 0.18 },
    calm: { reg: 0.2, bright: 0.28, tension: 0.2, space: 0.55, pad: 0.7, bass: 0.5, bell: 0.08, air: 0.4, bellEvery: 20, chordEvery: 22 },
    peak: { reg: 0.25, bright: 0.34, tension: 0.75, space: 0.55, pad: 0.9, bass: 0.55, bell: 0.1, air: 0.5, bellEvery: 18, chordEvery: 20 },
  },

  /* Measure twice. Dry, practical and precise — a workshop, not a battlefield.
   * The bell is the scoring instrument: after the store falls the music stops
   * dead for three seconds and then a single bell tells you how you did, high
   * for close and a flat seventh for a miss. Children learn what the pitch
   * means in two attempts and stop reading the number. */
  range: {
    key: 'C', mode: 'mixolydian', rest: 0.4, base: 0.25, pulseOn: true,
    phases: { go: 0.2, run: 0.45, release: 0.3, rtb: 0.2 },
    pulseOnPhases: ['run'],
    calm: { reg: 0.55, bright: 0.48, tension: 0.12, space: 0.4, pad: 0.85, bass: 0.5, bell: 0.4, pulse: 0.35, air: 0.16, tempo: 90, bellEvery: 10, chordEvery: 15 },
    peak: { reg: 0.6, bright: 0.6, tension: 0.2, space: 0.45, pad: 0.85, bass: 0.55, bell: 0.45, pulse: 0.5, air: 0.22, tempo: 90, bellEvery: 8, chordEvery: 12 },
  },

  /* Hunted, then hidden, then escorted home — the biggest arc in the game, and
   * it must not end where it started. While a pursuer is locking, the music is
   * harsh and must release within a second and a half of the lock breaking, so
   * it tells you that you have spoiled his aim: precisely the lesson the
   * mission is built around. Hiding in cloud takes the whole thing underwater,
   * which doubles as a readout of the mechanic. */
  tail: {
    key: 'B', mode: 'aeolian', rest: 0.3, base: 0.5, pulseOn: true, colour: [6],
    phases: { spotted: 0.5, climb: 0.55, lose: 0.35, home: 0.3 },
    pulseOff: ['home'],
    calm: { reg: 0.5, bright: 0.5, tension: 0.3, space: 0.5, pad: 0.85, bass: 0.55, bell: 0.35, pulse: 0.4, air: 0.35, tempo: 112, bellEvery: 8, chordEvery: 13 },
    peak: { reg: 0.45, bright: 0.85, tension: 1, space: 0.6, pad: 0.9, bass: 0.68, bell: 0.4, pulse: 0.62, air: 0.5, tempo: 112, bellEvery: 6, chordEvery: 9, sub: 8 },
  },

  /* An afternoon on the water. Pottering. Nothing is going to happen, and that
   * is the appeal. The raised fourth is the wonder sound and it suits a boat
   * going nowhere; the lowest bell density of any scene, and no bass at all. */
  boat: {
    key: 'G', mode: 'lydian', rest: 0.65, base: 0.15, drift: 0.08, auto: 'swell', cap: 0.3,
    calm: { reg: 0.9, bright: 0.4, tension: 0.08, space: 0.6, pad: 0.85, bass: 0, bell: 0.3, air: 0.45, bellEvery: 13, chordEvery: 18 },
    peak: { reg: 0.95, bright: 0.5, tension: 0.14, space: 0.65, pad: 0.9, bass: 0, bell: 0.36, air: 0.6, bellEvery: 11, chordEvery: 15 },
  },

  /* Messing about on the apron. Slightly more motion than the boat, still going
   * nowhere. The pulse is gated on ground speed, so parking the car stops the
   * music's clock — which is a nicer joke than it sounds when a child finds it. */
  car: {
    key: 'A', mode: 'mixolydian', rest: 0.45, base: 0.2, auto: 'ground', cap: 0.35, pulseOn: true,
    calm: { reg: 0.6, bright: 0.45, tension: 0.12, space: 0.4, pad: 0.8, bass: 0.35, bell: 0.28, pulse: 0, air: 0.3, tempo: 70, bellEvery: 11, chordEvery: 16 },
    peak: { reg: 0.6, bright: 0.55, tension: 0.18, space: 0.45, pad: 0.85, bass: 0.42, bell: 0.34, pulse: 0.3, air: 0.4, tempo: 70, bellEvery: 9, chordEvery: 13 },
  },

  /* An overlay, not a mission: sixty seconds of scripted radio that owns its
   * own ending. The music's entire job is to be almost absent so the words
   * land. It does not change key — a modulation here would make it a cutscene —
   * it plays two chords in a minute, and it holds a duck floor for the whole
   * sequence regardless of anything else. This is the most emotionally loaded
   * minute in the game and the correct amount of music for it is nearly none. */
  mayday: {
    key: 'A', mode: 'aeolian', rest: 0.9, base: 0.1, immediate: true, keepKey: true, duckFloor: 0.5, cap: 0.12,
    calm: { reg: 0.3, bright: 0.3, tension: 0.2, space: 0.7, pad: 0.4, bass: 0.6, bell: 0.15, air: 0.3, bellEvery: 40, chordEvery: 30 },
    peak: { reg: 0.3, bright: 0.34, tension: 0.25, space: 0.7, pad: 0.45, bass: 0.6, bell: 0.18, air: 0.35, bellEvery: 40, chordEvery: 30 },
  },

  /* Six seconds of being pleased, then out of the way. The success chime is
   * already playing over the top and the music must not fight it, so the bells
   * are muted for two and a half seconds and the whole thing fades out. */
  'debrief-win': {
    key: 'C', mode: 'ionian', rest: 0.4, base: 0.25, keepRoot: true, immediate: true,
    calm: { reg: 0.7, bright: 0.55, tension: 0.05, space: 0.5, pad: 0.8, bass: 0.45, bell: 0.45, air: 0.2, bellEvery: 5, chordEvery: 6 },
    peak: { reg: 0.75, bright: 0.65, tension: 0.08, space: 0.5, pad: 0.85, bass: 0.5, bell: 0.5, air: 0.24, bellEvery: 4.5, chordEvery: 6 },
  },

  /* Nothing. Music that consoles you after a crash is worse than no music:
   * let the failure sound have the room, and come back at the menu. */
  'debrief-fail': {
    key: 'A', mode: 'aeolian', rest: 1, base: 0, silent: true, immediate: true,
    calm: { pad: 0, bass: 0, bell: 0, pulse: 0, air: 0 },
    peak: { pad: 0, bass: 0, bell: 0, pulse: 0, air: 0 },
  },
};

// The boat, car and helicopter games. Their ids are mission ids, because
// main.js names the scene with `def.id`; without these every one of them falls
// through to SCENES.free, which is an aeroplane scene driven off an `ac` a boat
// does not have.
Object.assign(SCENES, VEHICLE_SCENES);
// Six car jobs, one scene, and until now no phases for it to look up.
SCENES.car.phases = CAR_PHASES;

/* ------------------------------------------------------------------ *
 * Ducking
 *
 * Every reason the music has to get out of the way lands on ONE gain node and
 * ONE filter. Each frame we collect the active reasons, take the minimum gain
 * and the minimum tilt, and apply both. Taking the minimum means the awkward
 * cases need no special handling at all: if the radio is talking and the wing
 * is stalling at the same time, the stall value simply wins because it is
 * lower. Scene crossfades happen upstream of the duck node, so a scene change
 * can never defeat a duck.
 * ------------------------------------------------------------------ */
const DUCK = {
  // The radio is band-limited speech around 300 Hz to 3 kHz. Gain is the
  // smaller half of this: dropping the tilt to 700 Hz is what actually makes
  // the words intelligible, and gating new one-shots matters more still,
  // because a new transient in the speech band is what destroys legibility.
  radio: { gain: 0.3, tilt: 700, atk: 0.08, hold: 0.25, rel: 0.5, gate: true },
  // Absolute, and a safety rule rather than a mix rule: the horn teaches. Its
  // fundamental is 812 Hz rising to about 900, so the music is pushed below it
  // entirely. The one-second hold matters — the wing is still near the stall
  // when the warner stops, and music swelling back the instant the horn quits
  // reads as "all clear", which is a lie.
  stall: { gain: 0.1, tilt: 380, atk: 0.05, hold: 1, rel: 0.6, gate: true },
  alert: { gain: 0.45, tilt: 900, atk: 0.06, hold: 1.2, rel: 0.4, gate: true },
  gear: { gain: 0.6, tilt: 1200, atk: 0.1, hold: 0.4, rel: 0.5, gate: false },
  // The success and checkpoint chimes are in C major and E minor and will
  // collide with whatever key the scene is in. Rather than retune them — they
  // are good, and being the same in every mission is right — the music gets out
  // of the way, so there is never any doubt which sound is the game talking.
  chime: { gain: 0.4, tilt: 1000, atk: 0.06, hold: 0.6, rel: 0.5, gate: true },
  mayday: { gain: 0.5, tilt: 800, atk: 0.3, hold: 0, rel: 0.8, gate: true },
  stun: { gain: 0.3, tilt: 500, atk: 0.02, hold: 0, rel: 0.9, gate: false },
};

const LOOKAHEAD = 0.35;
const MAX_BELL = 4;
const MAX_PULSE = 2;
const EVENTS_PER_SEC = 6;
/** Peak node count: 33 persistent plus 4 bells and 2 pulses of two nodes each. */
export const MAX_NODES = 56;

export class Music {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.playing = false;
    this.lowPower = false;
    this.setSeed(Math.random());

    this._id = 'menu';
    this.def = SCENES.menu;
    this.calm = { ...BASE, ...SCENES.menu.calm };
    this.hot = { ...BASE, ...SCENES.menu.peak };
    this.p = { ...BASE };

    this.intensity = 0.2;
    this.target = 0.2;
    this.glide = 4;
    this.sceneTime = 0;
    this.tapered = false;
    this.taperDensity = 1;
    this.restBonus = 0;
    this.tau = 0.8;

    this.degree = 0;
    this.prevDegree = -1;
    this.resolveArmed = false;
    this.modeShift = 0;
    this.bonus = 0; // scene-local intensity added by nudges (contacts, passes)

    this.cursor = 0;
    this.chordAt = 0;
    this.bellAt = 0;
    this.beatAt = 0;
    this.beatIndex = 0;
    this.budget = EVENTS_PER_SEC;
    this.busy = 0; // seconds of bell sounding inside a rolling two-minute window
    // The concurrency caps are held as the scheduled end time of each slot
    // rather than as a counter that an onended callback decrements. A counter
    // that misses one callback drifts upwards and silences the voice for the
    // rest of the session; a slot whose end time is in the past is free, and
    // that cannot drift. It also lets a note scheduled into the lookahead
    // window take a slot for the time it will actually occupy it.
    this.bellEnds = new Float64Array(MAX_BELL);
    this.pulseEnds = new Float64Array(MAX_PULSE);

    this.bellMuteUntil = 0;
    this.silentUntil = 0;
    this.duckUntil = { radio: 0, stall: 0, alert: 0, gear: 0, chime: 0, stun: 0 };
    this.lastDuck = 1;
    this._cache = {};
    this.tempoOverride = 0;
    this.padBase = [0, 0, 0];
  }

  /**
   * Session salt.
   *
   * Nothing is persisted, so Tuesday's lesson is in a different key from
   * Monday's. It also stops thirty machines in one room playing the same chord
   * at the same moment, which would otherwise turn the class into one very
   * large and very obvious chorus.
   */
  setSeed(n) {
    this.seed = n;
    this.rnd = mulberry(n);
    this.transpose = [0, 2, 3, 5, -4][Math.floor(this.rnd() * 5) % 5];
    // Shuffle the walk weights by up to fifteen per cent, so even the harmonic
    // habits of the instrument differ from one session to the next.
    this.walk = WALK.map((w) => w * (0.85 + this.rnd() * 0.3));
    if (this.def) this._applyKey(true);
  }

  get scene() {
    return this._id;
  }

  /* ---------------------------------------------------------------- *
   * Build: thirty-three nodes, once, for the life of the page.
   * ---------------------------------------------------------------- */

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;

    /* Chain. The out gain is both the voice sum and the master fade, and it
     * never exceeds 0.5 — with the music bus at 0.35 against the engine's 0.80
     * that puts the music about eighteen decibels under the propeller, which is
     * where it belongs. If a teacher can hear it from the back of the room, it
     * is too loud. */
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.tilt = ctx.createBiquadFilter();
    this.tilt.type = 'lowpass';
    this.tilt.Q.value = 0.5;
    this.tilt.frequency.value = 1400;
    this.duck = ctx.createGain();
    this.duck.gain.value = 1;
    this.send = ctx.createGain();
    this.send.gain.value = 0.28;
    this.out.connect(this.tilt);
    this.tilt.connect(this.duck);
    this.duck.connect(m.bus('music'));

    /* Space. A feedback delay rather than a convolver: a two-second impulse
     * response on a shared audio thread is the single most expensive thing the
     * Web Audio API offers, and this gives most of the same sense of room for
     * three nodes. It is never tempo-synced, because a synced delay becomes
     * rhythm and rhythm becomes memorable. */
    this.delay = ctx.createDelay(1.2);
    this.delay.delayTime.value = 0.42;
    this.fb = ctx.createGain();
    this.fb.gain.value = 0.28;
    this.damp = ctx.createBiquadFilter();
    this.damp.type = 'lowpass';
    this.damp.frequency.value = 2000;
    this.out.connect(this.send);
    this.send.connect(this.delay);
    this.delay.connect(this.damp);
    this.damp.connect(this.fb);
    this.fb.connect(this.delay);
    this.damp.connect(this.tilt);

    /* Pad: six triangles, three chord tones times two detuned copies. They are
     * started here and never stopped. A chord change glides their frequency
     * rather than creating and destroying notes, which is both the cheap way
     * and the reason the harmony moves without any note ever sounding struck. */
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 1100;
    this.padFilter.Q.value = 0.7;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.out);
    this.padOsc = [];
    this.padVoice = [];
    for (let i = 0; i < 6; i++) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 220;
      const g = ctx.createGain();
      g.gain.value = 0.15;
      o.connect(g);
      g.connect(this.padFilter);
      o.start();
      this.padOsc.push(o);
      this.padVoice.push(g);
    }
    /* The slow filter sweep is the best thing in the file this replaces, so it
     * is kept. Its period is forty-one seconds, which shares no small multiple
     * with the chord timer or the air sweep, so the three of them never line
     * back up inside a lesson. Note that it modulates a FREQUENCY, not a gate:
     * an AudioParam is its intrinsic value plus everything connected to it, so
     * an LFO wired into a gain that is also used as an on/off switch can never
     * reach silence. That exact mistake has bitten this codebase twice. */
    this.padLfo = ctx.createOscillator();
    this.padLfo.frequency.value = 1 / 41;
    this.padLfoGain = ctx.createGain();
    this.padLfoGain.gain.value = 260;
    this.padLfo.connect(this.padLfoGain);
    this.padLfoGain.connect(this.padFilter.frequency);
    this.padLfo.start();

    /* Air: one looping pink-noise source through a slowly swept bandpass. This
     * does the work an orchestra's strings would do, for five nodes, and its
     * level reads the weather, so the same scene sounds different in rain for
     * free. The buffer is the mixer's cached one — no new buffers anywhere. */
    this.airSrc = m.noiseSource(true);
    this.airBp = ctx.createBiquadFilter();
    this.airBp.type = 'bandpass';
    this.airBp.frequency.value = 700;
    this.airBp.Q.value = 0.8;
    this.airGain = ctx.createGain();
    this.airGain.gain.value = 0;
    this.airSrc.connect(this.airBp);
    this.airBp.connect(this.airGain);
    this.airGain.connect(this.out);
    this.airLfo = ctx.createOscillator();
    this.airLfo.frequency.value = 1 / 23.3;
    this.airLfoGain = ctx.createGain();
    this.airLfoGain.gain.value = 550;
    this.airLfo.connect(this.airLfoGain);
    this.airLfoGain.connect(this.airBp.frequency);
    this.airLfo.start();

    /* Bass: one note per chord with a four-second attack. Weight without a
     * tune. */
    this.bassOsc = ctx.createOscillator();
    this.bassOsc.type = 'triangle';
    this.bassOsc.frequency.value = 82;
    this.bassLp = ctx.createBiquadFilter();
    this.bassLp.type = 'lowpass';
    this.bassLp.frequency.value = 220;
    this.bassGain = ctx.createGain();
    this.bassGain.gain.value = 0;
    this.bassOsc.connect(this.bassLp);
    this.bassLp.connect(this.bassGain);
    this.bassGain.connect(this.out);
    this.bassOsc.start();

    /* Two shared filters for the one-shot voices, so a bell or a thud costs an
     * oscillator and a gain and nothing else. */
    this.bellBp = ctx.createBiquadFilter();
    this.bellBp.type = 'bandpass';
    this.bellBp.frequency.value = 1400;
    this.bellBp.Q.value = 0.7;
    this.bellBp.connect(this.out);
    this.pulseLp = ctx.createBiquadFilter();
    this.pulseLp.type = 'lowpass';
    this.pulseLp.frequency.value = 320;
    this.pulseLp.Q.value = 0.9;
    this.pulseLp.connect(this.out);

    this.built = true;
    this._applyKey(true);
    this.resync();
  }

  /* ---------------------------------------------------------------- *
   * Transport
   * ---------------------------------------------------------------- */

  start() {
    if (!this.built) this.build();
    if (!this.built || this.playing) return;
    this.playing = true;
    this.resync();
    this.out.gain.setTargetAtTime(0.5, this.ctx.currentTime, 2 / 3);
    this._chordChange(this.ctx.currentTime + 0.05);
  }

  stop({ fade = 1.2 } = {}) {
    if (!this.built || !this.playing) return;
    this.playing = false;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, Math.max(0.05, fade / 3));
  }

  /** Snap the lookahead cursor to now, after a pause or a frame hitch. */
  resync() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    this.cursor = t;
    if (this.chordAt < t) this.chordAt = t + 0.2;
    if (this.bellAt < t) this.bellAt = t + 2 + this.rnd() * 4;
    this.beatAt = t + 0.1;
  }

  /* ---------------------------------------------------------------- *
   * Scenes, phases, intensity
   * ---------------------------------------------------------------- */

  /**
   * Move rooms.
   *
   * The chord walk is deliberately NOT reset. That continuity is what makes the
   * whole game sound like one instrument moving between rooms rather than
   * fourteen tracks switching over, and it costs nothing to keep.
   */
  setScene(id, opts = {}) {
    // An unknown id falls back to Free Flight rather than throwing: a new
    // mission must never be able to break the audio thread.
    const def = SCENES[id] || SCENES.free;
    this._id = SCENES[id] ? id : 'free';
    this.def = def;
    this.calm = { ...BASE, ...def.calm };
    this.hot = { ...BASE, ...def.peak };
    this.sceneTime = 0;
    this.tapered = false;
    this.taperDensity = 1;
    this.restBonus = 0;
    this.bonus = 0;
    this.modeShift = 0;
    this.tempoOverride = 0;
    this.silentUntil = 0;
    this.jitter = def.jitter || 0;
    this.cruiseIas = opts.cruiseIas || 95;
    this.weather = opts.weather || this.weather || null;
    this.target = def.base != null ? def.base : 0.25;
    this.glide = def.immediate || opts.immediate ? 0.8 : 2.5;
    // The crossfade is nothing more than a long parameter glide. Because every
    // scene difference is a number and every number is applied with
    // setTargetAtTime, there is no graph to fade between.
    this.tau = (def.immediate || opts.immediate ? 0.8 : 2.5) / 2.5;
    this._applyKey(false);
    // The only scene that decides for itself whether to play: after a crash,
    // silence is the right answer, so it takes itself off the air.
    if (def.silent) this.stop({ fade: 1.2 });
    if (opts.phase) this.setPhase(opts.phase, { atc: false });
    if (id === 'debrief-win') this.nudge('resolve');
    return this._id;
  }

  /**
   * A mission step began.
   *
   * This is wired to the runner's existing onStep hook, so every mission gets a
   * per-step intensity curve without a line of new mission code. Step ids
   * repeat across missions — half a dozen missions have a step called 'land' —
   * but the lookup is inside the current scene, so they never collide.
   */
  setPhase(id, opts = {}) {
    const ph = this.def.phases;
    if (ph && ph[id] != null) this.setIntensity(ph[id], this.def.immediate ? 1 : 4);
    else if (id === 'paused') this.setIntensity(0.1, 2);
    // A step's radio call fires on the same tick as this, so start the duck a
    // little early and the first word never clips through at full level. If no
    // radio follows, a half-second dip nobody notices is the whole cost.
    if (opts.atc !== false && this.built) {
      this.duckUntil.radio = Math.max(this.duckUntil.radio, this.ctx.currentTime + 0.55);
    }
    if (this.def.pulseOff && this.def.pulseOff.indexOf(id) >= 0) this.pulseGate = false;
    else if (this.def.pulseOnPhases) this.pulseGate = this.def.pulseOnPhases.indexOf(id) >= 0;
    else this.pulseGate = true;
    this.phase = id;
  }

  setIntensity(v, glide = 4) {
    this.target = clamp(v, 0, 1);
    this.glide = Math.max(0.05, glide);
  }

  /**
   * One-shot gestures, two to six seconds long. Unknown names are ignored in
   * silence, because a mission should never be able to crash the audio by
   * asking for a gesture that has not been written yet.
   */
  nudge(name) {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'cut':
        // The engine has just failed. Everything but one low note leaves over
        // four seconds and nothing rings for twelve. The drama is the removal.
        this.setIntensity(0.55, 0.5);
        this.silentUntil = t + 12;
        this.bellMuteUntil = t + 12;
        break;
      case 'drop':
        if (this._id === 'range') {
          // The store is falling. Stop completely and let it fall.
          this.silentUntil = t + 3;
          this.bellMuteUntil = t + 3;
        } else {
          // A crate released on a beach: three bells, unevenly spaced, so it
          // reads as a flourish rather than as a phrase.
          for (let i = 0; i < 3; i++) this._bell(t + 0.05 + i * (0.18 + this.rnd() * 0.14), this.p, 0.9);
        }
        break;
      case 'score:near':
        this._scoreBell(t + 0.05, 12);
        break;
      case 'score:mid':
        this._scoreBell(t + 0.05, 7);
        break;
      case 'score:far':
        this._scoreBell(t + 0.05, 10, true);
        break;
      case 'contact':
        // Finding a contact lights the music up and brightens the mode one
        // step. Three contacts walk dorian to mixolydian to ionian.
        this.bonus = Math.min(0.3, this.bonus + 0.1);
        this._shiftMode(1);
        break;
      case 'pass':
        // Relief for six seconds, then a higher floor than before.
        this.setIntensity(Math.max(0, this.target - 0.25), 1);
        this.bonus = Math.min(0.2, this.bonus + 0.1);
        this.reliefUntil = t + 6;
        break;
      case 'lock':
        this.setIntensity(0.8, 0.6);
        break;
      case 'unlock':
        // Must fall away within a second and a half: that release is how the
        // music tells you that you have spoiled his aim.
        this.setIntensity(this.def.base != null ? this.def.base : 0.35, 1.2);
        break;
      case 'hit':
        // Stunned. Everything stops for three hundred milliseconds and comes
        // back muffled.
        this.silentUntil = t + 0.3;
        this.duckUntil.stun = t + 4;
        break;
      case 'win':
      case 'fail':
        this.duckUntil.chime = t + 2.5;
        this.bellMuteUntil = t + 2.5;
        break;
      case 'resolve':
        // The only warm cadence the game has, and it happens three times: a
        // medevac landed with a calm patient, a carrier trap, and the escort
        // home at the end of Shake the Tail.
        this.resolveArmed = true;
        this.chordAt = Math.min(this.chordAt, t + 0.4);
        break;
      default:
        break;
    }
  }

  /**
   * The honest degradation path for a thirty-machine room.
   *
   * Dropping the bell, the pulse and the delay send leaves twenty-eight
   * persistent nodes, no transients and no scheduling work at all — and it
   * still sounds like the same game, which is a great deal better than muting.
   * The delay nodes stay connected with a silent send rather than being torn
   * out: a graph that rebuilds itself every few seconds is worse than either
   * state, which is also why the caller should use wide hysteresis.
   */
  setLowPower(on) {
    this.lowPower = !!on;
    if (this.built) this.send.gain.setTargetAtTime(on ? 0 : 0.28, this.ctx.currentTime, 0.4);
  }

  /* ---------------------------------------------------------------- *
   * Frame
   * ---------------------------------------------------------------- */

  update(dt, cue) {
    if (!this.built) return;
    const c = cue || EMPTY_CUE;
    const now = this.ctx.currentTime;

    // A frame hitch, a tab coming back, or a resumed context. Snapping the
    // cursor instead of catching up is the whole point: catching up would dump
    // a fistful of notes in one tick, which is exactly what a Chromebook
    // dropping to nine frames a second would otherwise produce.
    if (!(dt > 0) || dt > 0.25) {
      this.resync();
      this.budget = EVENTS_PER_SEC;
      return;
    }

    this.sceneTime += dt;
    this.budget = Math.min(EVENTS_PER_SEC, this.budget + dt * EVENTS_PER_SEC);
    // Rolling estimate of how much of the last two minutes had a bell in it.
    this.busy = Math.max(0, this.busy - dt * (this.busy / 120 + 0.004));

    /*
     * The twelve-minute taper.
     *
     * A lesson is twenty minutes. After twelve continuous minutes in one scene
     * — a long Free Flight, or a menu left open through a changeover — density
     * drops a quarter and the required silence rises, once, for this scene
     * instance. By minute twelve everyone has had enough, and the music should
     * notice.
     */
    if (!this.tapered && this.sceneTime > 720) {
      this.tapered = true;
      this.taperDensity = 1.25;
      this.restBonus = 0.1;
    }

    this._drive(dt, c, now);
    this._params();
    this._applyParams(now);
    this._ducking(c, now);
    if (this.playing) this._schedule(now);
    this.tau = Math.max(0.6, this.tau - dt * 0.4);
  }

  /** Where intensity comes from, in priority order: script, then flight. */
  _drive(dt, c, now) {
    const d = this.def;
    let want = this.target + this.bonus;
    if (c.weather) this.weather = c.weather;

    const ac = c.ac;
    /*
     * The flare is the exam.
     *
     * Below two hundred feet on an approach the scenes that have a landing in
     * them shed everything except the floor, so the last thing a child hears
     * before the wheels touch is the engine, the wind and one pad. Free Flight
     * and Recon are deliberately not in that list: low down is where their
     * music lives.
     */
    this.lowFinal = !!(d.thinLow && ac && !ac.onGround && (ac.agl || 0) < 61);
    if (d.auto === 'flight' && ac) {
      // Free Flight breathes without any mission at all, purely from how the
      // aeroplane is being flown. Hard-capped so it never becomes dramatic.
      const bank = Math.abs(ac.bank != null ? ac.bank : ac.bankAngleRad ? ac.bankAngleRad() : 0);
      const agl = ac.agl || 0;
      const ias = (ac.ias || 0) * 1.94384;
      const fast = clamp((ias - this.cruiseIas) / 60, 0, 1);
      const low = ac.onGround ? 0 : clamp(1 - agl / 200, 0, 1);
      const sink = clamp(-(ac.vs || 0) / 12, 0, 1);
      want = 0.1 + clamp(bank / 1.1, 0, 1) * 0.22 + low * 0.2 + fast * 0.12 + sink * 0.1;
    } else if (d.auto === 'recon' && ac) {
      // Inverted: the music appears when you climb out of cover, so hearing
      // nothing is the sound of doing it right.
      want = 0.05 + clamp(((ac.agl || 0) - 150) / 260, 0, 1) * 0.3;
    } else if (d.auto === 'ground') {
      // The car and the boat have no aeroplane, so the speed arrives on its
      // own field when the vehicle path is wired up.
      const kts = c.speedKts != null ? c.speedKts : c.ac ? (c.ac.ias || 0) * 1.94384 : 0;
      want = 0.15 + clamp(kts / 40, 0, 1) * 0.2;
      this.pulseGate = kts > 15;
    } else if (d.auto === 'swell') {
      want = (d.base || 0.15) + Math.sin(now / 11.3) * (d.drift || 0.05);
    }
    if (d.drift && d.auto !== 'swell') want += Math.sin(now / 97) * d.drift;

    // Cloud is a hiding place in Shake the Tail, so the whole instrument goes
    // underwater while you are inside one. It doubles as a readout of the
    // mechanic: hiding sounds like hiding.
    this.immersion = c.cloudImmersion || 0;

    // Missions with a clock lean on it, when the sim tells us what is left.
    const data = c.data;
    if (data) {
      if (this._id === 'medevac' && data.bpm) {
        const bpm = clamp(data.bpm, 40, 220);
        // Halved above 140, or the pulse becomes a machine gun rather than a
        // heartbeat — and a frightened child's heart is exactly when it would.
        this.tempoOverride = bpm > 140 ? bpm / 2 : bpm;
        if (bpm > 118) want += 0.06;
        if (bpm > 142) want += 0.1;
      }
      if (this._id === 'patrol' && data.seen && data.seen.length) {
        want = Math.max(want, 0.35 + data.seen.length * 0.1);
        if (data.seen.length !== this._seen) {
          this._seen = data.seen.length;
          this._shiftMode(1);
        }
      }
      const left = data.timeLeft != null ? data.timeLeft : null;
      if (left != null && this.def.pulseOn) {
        const tight = this._id === 'patrol' ? 90 : 45;
        if (left < tight) {
          want += 0.2;
          this.subBoost = true;
        } else this.subBoost = false;
      }
    }

    if (d.cap) want = Math.min(want, d.cap);
    this.intensity += (clamp(want, 0, 1) - this.intensity) * Math.min(1, dt / this.glide);
  }

  /** Lerp the whole parameter set. One reused object; no per-frame allocation. */
  _params() {
    const t = this.intensity;
    const p = this.p;
    for (const k in BASE) p[k] = lerp(this.calm[k], this.hot[k], t);
    if (this.def.pinTension != null) p.tension = this.def.pinTension;
    if (this.tempoOverride) p.tempo = this.tempoOverride;
    if (this.subBoost) p.sub = 8;
    if (!this.def.pulseOn || this.pulseGate === false) p.pulse = 0;
    // Weather pushes the air voice: rain and storm raise it, clear air lowers
    // it, so the same scene sounds different in different weather for nothing.
    const cond = this.weather && this.weather.condition;
    if (cond === 'rainy') p.air *= 1.35;
    else if (cond === 'stormy') p.air *= 1.7;
    else if (cond === 'clear') p.air *= 0.85;
    // Below two hundred feet on a landing, the flare is the exam. Shed
    // everything that is not holding the floor up.
    if (this.lowFinal) {
      p.bell *= 0.15;
      p.pulse *= 0.2;
      p.pad *= 0.6;
    }
    if (this.ctx && this.ctx.currentTime < this.silentUntil) {
      p.pad *= 0.15;
      p.bell = 0;
      p.pulse = 0;
      p.air *= 0.4;
    }
    return p;
  }

  _applyParams(now) {
    const p = this.p;
    const tau = this.tau;
    this._set(this.padGain.gain, p.pad * 0.3, tau);
    this._set(this.bassGain.gain, p.bass * 0.22, Math.max(tau, 1.3));
    this._set(this.airGain.gain, p.air * 0.16, Math.max(tau, 1.2));
    this._set(this.bellBp.frequency, mtof(58 + p.reg * 16), tau);
    this._set(this.delay.delayTime, lerp(0.25, 0.6, p.space), 2.5);
    this._set(this.fb.gain, this.lowPower ? 0 : Math.min(0.35, 0.14 + p.space * 0.21), 2);
    // Detune spreads with tension: four cents when everything is settled, up to
    // fourteen when the weather has opinions.
    const spread = 4 + p.tension * 10;
    for (let i = 0; i < 6; i++) this._set(this.padOsc[i].detune, i % 2 ? spread : -spread, 1.5);
  }

  /**
   * All ducking, in one place, once a frame.
   *
   * Take the minimum gain and the minimum tilt across every active reason. The
   * engine and the wind are never ducked against and never duck the music:
   * they are the bed it sits on, and the child is learning to fly by their
   * pitch.
   */
  _ducking(c, now) {
    const d = this.duckUntil;
    if (c.radioBusyUntil > now) d.radio = c.radioBusyUntil + DUCK.radio.hold;
    if (c.stall) d.stall = now + DUCK.stall.hold;
    if (c.alertLevel > 0.05) d.alert = now + DUCK.alert.hold;
    if (c.gear) d.gear = now + DUCK.gear.hold;
    if (this._id === 'mayday') d.mayday = now + 1;

    let gain = 1;
    let tilt = lerp(600, 2600, this.p.bright);
    let gate = false;
    let atk = 0.08;
    let rel = 0.5;
    for (const k in DUCK) {
      if (!(d[k] > now)) continue;
      const r = DUCK[k];
      if (r.gain < gain) {
        gain = r.gain;
        atk = r.atk;
      }
      if (r.tilt < tilt) tilt = r.tilt;
      rel = Math.max(rel, r.rel);
      if (r.gate) gate = true;
    }
    if (this.def.duckFloor) gain = Math.min(gain, this.def.duckFloor);
    // Hiding inside a cloud takes the whole instrument underwater. It is not a
    // duck reason as such, but it lands on the same two controls.
    if (this.immersion > 0.38) tilt = Math.min(tilt, lerp(1100, 500, this.immersion));

    this._gated = gate;
    const tauNow = gain < this.lastDuck ? atk : rel;
    this.lastDuck = gain;
    this.duck.gain.setTargetAtTime(gain, now, tauNow);
    this._set(this.tilt.frequency, tilt, tauNow);
  }

  /* ---------------------------------------------------------------- *
   * Scheduling: lookahead, never frame-timing
   * ---------------------------------------------------------------- */

  _schedule(now) {
    const horizon = now + LOOKAHEAD;
    const p = this.p;

    /*
     * Every interval below has a floor under it.
     *
     * These are while loops walking a cursor forward, so an interval of zero or
     * a negative one does not merely sound wrong, it hangs the audio thread and
     * takes the whole game with it. The numbers come from a hand-written table
     * and, for the medevac, from a mission's own live data — both of which are
     * exactly the things that get edited later by someone who has not read this
     * file. A floor costs one comparison and removes the failure mode.
     */
    const chordEvery = Math.max(3, p.chordEvery);
    const bellEvery = Math.max(1.5, p.bellEvery);

    while (this.chordAt < horizon) {
      const at = Math.max(this.chordAt, now);
      this._chordChange(at);
      // 13.7 seconds is the base period, scaled by the scene's harmonic rhythm
      // and randomised, so it shares no multiple with the bell timer, the pad
      // sweep, the air sweep or the drift cycle.
      this.chordAt = at + (chordEvery / 15) * 13.7 * (0.85 + this.rnd() * 0.3);
    }

    while (this.bellAt < horizon) {
      const at = this.bellAt;
      // Poisson-ish, never a pattern. Two pitched events in a row on a constant
      // grid is the definition of a motif, and a motif is a bug here.
      this.bellAt = at + bellEvery * this.taperDensity * (0.55 + this.rnd() * 0.9);
      if (at < now || !this._canRing(at, p)) continue;
      this._bell(at, p);
    }

    if (!(p.tempo > 20) || p.pulse < 0.02 || this.lowPower) {
      this.beatAt = Math.max(this.beatAt, now);
      return;
    }
    const step = (60 / Math.min(220, p.tempo)) * (4 / (p.sub >= 8 ? 8 : 4));
    while (this.beatAt < horizon) {
      const at = this.beatAt;
      this.beatIndex++;
      this.beatAt = at + step;
      if (at < now || this._gated || this.lowPower) continue;
      if (this.ctx.currentTime > this.silentUntil && this.budget >= 1) {
        // Storm Chaser jitters so it can never lock to a grid; the carrier is
        // dead steady. Same code, one number.
        const j = this.jitter ? (this.rnd() - 0.5) * 2 * this.jitter * step : 0;
        this._pulse(Math.max(now, at + j), p, this.beatIndex % 2 === 0);
      }
    }
  }

  /** Every reason a bell may not ring. Rest is a parameter, so it is checked. */
  _canRing(at, p) {
    if (this.lowPower || this._gated) return false;
    if (p.bell < 0.02) return false;
    if (at < this.bellMuteUntil || at < this.silentUntil) return false;
    if (this._slot(this.bellEnds, at) < 0) return false;
    // The minimum proportion of any rolling two minutes that must stay silent.
    // Free Flight at 0.60 means stretches of up to forty-five seconds with
    // nothing but the pad, the engine and the wind. Those silences are the
    // music; most game music fails the classroom test because it is afraid of
    // them.
    const rest = Math.min(0.95, (this.def.rest || 0.3) + this.restBonus);
    if (this.busy / 120 > 1 - rest) return false;
    if (this.budget < 1) return false;
    return true;
  }

  /* ---------------------------------------------------------------- *
   * The voices
   * ---------------------------------------------------------------- */

  _applyKey(immediate) {
    const d = this.def;
    if (d.keepKey && this.rootMidi != null) return;
    const root = d.keepRoot && this.rootMidi != null ? this.rootMidi : 48 + ROOTS[d.key] + this.transpose;
    this.pendingRoot = root;
    this.pendingMode = d.mode;
    if (immediate || this.rootMidi == null) {
      this.rootMidi = root;
      this.mode = d.mode;
    }
  }

  /** Brighten or darken one step of the mode ladder, at the next chord. */
  _shiftMode(step) {
    const i = LADDER.indexOf(this.pendingMode || this.mode);
    if (i < 0) return;
    this.pendingMode = LADDER[clamp(i + step, 0, LADDER.length - 1)];
  }

  /** Scale degree to a midi note, wrapping octaves. */
  _note(deg) {
    const scale = MODES[this.mode] || MODES.aeolian;
    return this.rootMidi + scale[((deg % 7) + 7) % 7] + 12 * Math.floor(deg / 7);
  }

  /**
   * Walk to the next chord.
   *
   * A weighted random step over the mode's diatonic triads, never repeating the
   * chord it is on, and never allowed to play v then i — an authentic cadence,
   * the most memorable gesture in tonal music, and therefore the one thing this
   * instrument must not do. Arming a resolve is the only way past it.
   */
  _nextDegree() {
    const w = this.walk;
    let total = 0;
    const ok = [];
    for (let i = 0; i < 7; i++) {
      if (i === this.degree) continue;
      if (i === 0 && this.degree === 4 && !this.resolveArmed) continue;
      ok.push(i);
      total += w[i];
    }
    if (this.resolveArmed) {
      /*
       * A cadence is two steps, not one: go to the fifth, and only then home.
       *
       * Clearing the flag on the first step left the walk sitting on v with
       * the move home still forbidden by the rule above, so it wandered off
       * and the only three warm moments in the game never arrived — the
       * medevac landed with a calm patient, the carrier trap, the escort home.
       * Hold the flag until the tonic has actually been reached.
       */
      if (this.degree !== 4) return 4;
      this.resolveArmed = false;
      return 0;
    }
    let r = this.rnd() * total;
    for (const i of ok) {
      r -= w[i];
      if (r <= 0) return i;
    }
    return ok[ok.length - 1];
  }

  _chordChange(t) {
    // A key change waits for a chord boundary and then glides, so a modulation
    // sounds intentional rather than like a cut.
    if (this.pendingRoot != null) {
      this.rootMidi = this.pendingRoot;
      this.pendingRoot = null;
    }
    if (this.pendingMode) {
      this.mode = this.pendingMode;
      this.pendingMode = null;
    }
    this.prevDegree = this.degree;
    this.degree = this._nextDegree();
    const p = this.p;
    const oct = Math.round(p.reg) * 12;
    const tones = [this._note(this.degree), this._note(this.degree + 2), this._note(this.degree + 4)];
    // A colour tone drifts in and out with tension. In the tutorial it is only
    // ever a pad shimmer, never a note a bell can strike.
    if (this.def.colour && this.rnd() < p.tension * 0.5) {
      const c = this.def.colour[Math.floor(this.rnd() * this.def.colour.length)];
      tones[2] = this.rootMidi + c + 12;
    }
    this.padBase = tones;
    for (let i = 0; i < 6; i++) {
      const f = mtof(tones[i % 3] + oct + (i >= 3 ? 12 : 0));
      // Glide, never restart. Nothing in the pad is ever stopped or started, so
      // no chord ever sounds struck.
      this.padOsc[i].frequency.setTargetAtTime(f, t, 0.4 + this.rnd() * 0.25);
      // Each copy breathes on its own slow ramp, so the six of them never move
      // together and the pad never sits still.
      this.padVoice[i].gain.setTargetAtTime(0.11 + this.rnd() * 0.09, t, 2.5 + this.rnd() * 2);
    }
    // Ember Run holds a pedal root that never moves: a pedal point sustains
    // tension for four minutes without repeating anything. Island Patrol is the
    // only place the bass moves at all, alternating root and fifth — two notes,
    // and the single quasi-melodic gesture anywhere in the game.
    let bassNote = this.def.pedal ? this.rootMidi : tones[0];
    if (this.def.walkingBass && this.prevDegree % 2 === 0) bassNote = this._note(this.degree + 4);
    this.bassOsc.frequency.setTargetAtTime(mtof(bassNote - 12), t, 1.2);
    this.bassGain.gain.setTargetAtTime(this.p.bass * 0.22, t, 4);
  }

  /** A struck bell: two nodes, eight-millisecond attack, long release. */
  _bell(t, p, vel = 1) {
    if (!this.built || this.budget < 1) return;
    const slot = this._slot(this.bellEnds, t);
    if (slot < 0) return;
    this.budget -= 1;
    const ctx = this.ctx;
    const oct = 24 + Math.round(p.reg) * 12;
    const pick = this.padBase[Math.floor(this.rnd() * 3)];
    let note = pick + oct;
    if (!this.def.padOnlyColour && this.def.colour && this.rnd() < p.tension * 0.4) {
      note = this.rootMidi + this.def.colour[Math.floor(this.rnd() * this.def.colour.length)] + oct;
    }
    const rel = 2.5 + this.rnd() * 3.5;
    const o = ctx.createOscillator();
    o.type = p.reg > 0.6 ? 'triangle' : 'sine';
    o.frequency.value = mtof(note);
    const g = ctx.createGain();
    const amp = 0.075 * p.bell * vel * (0.7 + this.rnd() * 0.6);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + rel);
    o.connect(g);
    g.connect(this.bellBp);
    o.start(t);
    o.stop(t + rel + 0.05);
    this.bellEnds[slot] = t + rel;
    this.busy += rel * 0.6;
    o.onended = () => {
      try {
        g.disconnect();
      } catch (e) {
        /* already gone */
      }
    };
  }

  /** The scoring bell: pitch is the answer, and a miss sounds flat. */
  _scoreBell(t, semis, flat) {
    const p = this.p;
    const note = this.rootMidi + semis + 24 + Math.round(p.reg) * 12;
    const saved = this.bellMuteUntil;
    this.bellMuteUntil = 0;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = mtof(note);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (flat ? 5 : 3.5));
    o.connect(g);
    g.connect(this.bellBp);
    o.start(t);
    o.stop(t + 5.2);
    o.onended = () => {
      try {
        g.disconnect();
      } catch (e) {
        /* already gone */
      }
    };
    this.bellMuteUntil = saved;
  }

  /** A soft filtered thud on the beat, or a quieter tick off it. */
  _pulse(t, p, off) {
    if (!this.built || this.budget < 1) return;
    const slot = this._slot(this.pulseEnds, t);
    if (slot < 0) return;
    this.budget -= 1;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.mixer.pinkBuffer();
    src.loop = true;
    const g = ctx.createGain();
    const dur = off ? 0.045 : 0.075;
    const amp = p.pulse * (off ? 0.05 : 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, amp), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(g);
    g.connect(this.pulseLp);
    // A random start offset, the same trick the mixer uses everywhere else:
    // without it every thud is the identical slice of the cached buffer and a
    // run of them sounds like one sample being retriggered.
    src.start(t, this.rnd() * src.buffer.duration);
    src.stop(t + dur + 0.03);
    this.pulseEnds[slot] = t + dur;
    src.onended = () => {
      try {
        g.disconnect();
      } catch (e) {
        /* already gone */
      }
    };
  }

  /**
   * The first voice slot free at time t, or -1 if the voice is full.
   *
   * A scheduler that wants a voice past the cap drops the note. It does not
   * queue it — a queued note arrives late and out of character — and it does
   * not steal one, because cutting a four-second bell release off at the knees
   * is more audible than the note that never sounded.
   */
  _slot(ends, t) {
    for (let i = 0; i < ends.length; i++) if (ends[i] <= t) return i;
    return -1;
  }

  /** Write a param only when it has actually moved; saves a few hundred a second. */
  _set(param, value, tau) {
    const key = param._mkey || (param._mkey = ++SET_ID);
    const last = this._cache[key];
    if (last != null && Math.abs(last - value) < Math.abs(value) * 0.004 + 0.0001) return;
    this._cache[key] = value;
    param.setTargetAtTime(value, this.ctx.currentTime, Math.max(0.01, tau));
  }

  /** How many one-shot voices are sounding right now. */
  voices() {
    if (!this.built) return 0;
    const t = this.ctx.currentTime;
    let n = 0;
    for (const e of this.bellEnds) if (e > t) n++;
    for (const e of this.pulseEnds) if (e > t) n++;
    return n;
  }

  /** Node and event counts, for the self-test and for the low-power heuristic. */
  stats() {
    return {
      persistent: this.built ? 33 : 0,
      transient: this.voices() * 2,
      total: (this.built ? 33 : 0) + this.voices() * 2,
      budget: this.budget,
      intensity: this.intensity,
      duck: this.lastDuck,
      gated: !!this._gated,
      scene: this._id,
      rootMidi: this.rootMidi,
      transpose: this.transpose,
      lowPower: this.lowPower,
    };
  }
}

let SET_ID = 0;

/**
 * Everything optional, every default safe.
 *
 * GameAudio currently calls update(dt) with no cue at all, and the boat and car
 * have no aeroplane, so both of those have to work rather than throw.
 */
const EMPTY_CUE = {
  radioBusyUntil: 0,
  stall: false,
  alertLevel: 0,
  gear: false,
  ac: null,
  weather: null,
  cloudImmersion: 0,
  data: null,
};

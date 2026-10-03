/**
 * Other aeroplanes.
 *
 * The wishlist: "Add planes that fly around everywhere and can land/takeoff
 * and at the end park in their hangars." So two to four AI aeroplanes live at
 * the airfield. Each one starts its engine, leaves its slot, taxis out, holds
 * short, lines up, takes off, flies a circuit or a tour of the islands, comes
 * back down a glideslope, lands, rolls out, turns off, taxis back and parks —
 * nose in on a stand, or pushed back into a hangar tail first, the way the
 * airport work builds its hangars — and a while later does it all again.
 *
 * HOW THEY FLY. Not with the physics: that would be three or four more copies
 * of the most expensive thing the game does each frame, for something a child
 * mostly sees as a shape in the distance. Each one is moved along a
 * precomputed path (see ./traffic/planner.js) at a speed the path allows, and
 * everything that makes it look flown is read off the path: it banks by the
 * turn rate at its speed, pitches by its climb angle plus the angle of attack
 * its speed needs, flares because the path flattens, and sits on its wheels
 * because its gear points are the flight model's own.
 *
 * WHAT IT COSTS, measured in the browser on the development Mac over 18,000
 * frames of Free Flight on Kestrel with three of them about: median under
 * 0.01 ms a frame, 99th percentile 0.1 ms, 99.9th 0.5 ms. Building a model is
 * the expensive thing, 5 to 20 ms, so it is done while the flight starts
 * (a Dev-panel aeroplane is built on the click). The taxi clearances and the
 * wing checks, measured in node as main-thread CPU over 36,000 frames each
 * at Kestrel, SFO and the air base: mean 0.005-0.010 ms a frame, 99.9th
 * percentile 0.12-0.25 ms, worst 0.9-2.5 ms; the flight start 86-236 ms
 * including building the models. Draw calls are what cost
 * on a Chromebook: over the apron with three in view they added 177 to 817,
 * and ./traffic/lod.js brings that to 118 by baking together the parts that
 * never move, then hides the small parts at 400 m, anything under 2.5 m at
 * 1.2 km, casts no shadow past 350 m, and past 3.6 km draws one dot.
 *
 * MANNERS. On the ground they keep the four rules real airports keep
 * (./traffic/rules.js has them in full):
 *   R1  nobody stops on a runway — only lined up for its own take-off, with
 *       the runway its own and you nowhere on it, and in the roll-out after
 *       landing. Every holding point is off the runway: on the connector,
 *       30 m back from 09/27, and for Kestrel's connector at x 250, which IS
 *       the crosswind runway 18/36, on the taxiway short of it.
 *   R2  on to a runway, or across one, is one clearance: only with you not on
 *       it, not lined up on it, not on final to it, and not able to get to
 *       where it will be before it is off again (from where you are, which
 *       way you point and how fast you go). Given, it goes through without
 *       stopping; lost before it gets there, it stops short, off it.
 *   R3  you turn up on a runway one is on: it takes the way off that keeps it
 *       furthest out of your path — its own plan, an exit ahead well short
 *       of you, or a slow turn round to an exit behind — judged by one test,
 *       whether it is ever in the strip your wings will sweep before you
 *       could get there; then it holds short, off the runway, and goes home.
 *       It never rolls its take-off at you, and with you behind it, it goes.
 *   R4  the tower says "Hold position — an aeroplane is on the runway ahead"
 *       when one is on your runway in front of you, and "Runway clear" when
 *       it has gone.
 * In the air: departures hold short while you are on the runway or on final
 * (and while you climb away off the far end), and an arrival holds at its
 * gate or goes around. Parked on the crosswind runway for half a minute,
 * clear of 09/27, you are in nobody's way there: they take off and land on
 * 09/27 past you — but 18/36 itself stays yours (R2), because you may roll.
 * Measured in node with the independent check's runway scenarios (six seeds,
 * traffic on 09 and on 27, you parked 3 s to 4 min then rolling at a gentle
 * metre a second a second, ignoring the tower): turning up on 18/36 as one
 * is on its way over it, 208 runs — never through you, never stopped on
 * 18/36 (the four rounds before: 168 of 224 through you); in the middle of
 * 09/27, 384 fair runs — never through you (before: 20 of 378); parked at
 * the ends of 09/27 and of 18/36, in the middle of 18/36 and landing on it,
 * 912 runs — never through you. The tower's "hold position" came 537 times,
 * never with nobody there, and before every roll that met one on the runway
 * ahead. Short of that: with no way off at all (the one exit ahead with
 * someone waiting at it, the rest past you) one waits at the far end, and
 * a player who ignores the tower and climbs away slowly passes 7 m over it.
 * In the air they keep out of your way — each one works out where you will be
 * over the next twenty seconds — along its own path, so a holding circle
 * turning towards you is seen as one — and steps aside, and up, to keep
 * 300 m and more between you; on final, where stepping aside is wrong, the
 * same prediction sends it round, turning away from you. Five ways of meeting
 * one (head-on, in its hold, on final, from the side, from behind) measured
 * 694 to 822 m; the closest found by hand, one already over the runway
 * threshold when you appeared ahead of it, 583 m.
 * They take turns on the runway among themselves, and a queue for it holds at
 * the gate in a 360. In the air they step aside for each other the same way,
 * 350 m wanted: whoever is not on final for the one that is, otherwise the
 * higher number. Measured over half an hour on every runway map with six
 * about (node soak, busy field): never nearer than 218 m, and never below
 * the ground, even stepping aside just after lift-off. On the ground nobody sets off until its way is clear —
 * of anyone taxiing the other way or across it, of anyone standing on it,
 * of you stopped on it — and then
 * it stops for anything that still gets in front of it, for as long as it
 * takes: nobody is ever let through anybody for having waited (see "Sharing
 * the taxiways"). One whose slot you have parked in goes to another, and one
 * whose way home you block for half a minute finds another it can reach.
 * The chase is the exception to the 300 m: a child flying straight at one
 * from behind, faster than it can step aside, will catch it, and there is
 * no collision between you and the traffic. Chased or not, nothing jumps: a
 * step aside carries on over a go-around and fades out there, and an
 * approach still stepped aside too far to be back on the centreline by the
 * runway goes round (node soak, every map chased for half an hour: no
 * frame moves anybody further than it can fly; unchased, that go-around
 * never happens), and the nose comes back round to the path as a step aside
 * ends rather than in one frame (every map chased for 20 min at 30 fps: at
 * most 11 degrees in a frame, where it was 51).
 *
 * WINGS. A type only parks where its wings clear every building on the way
 * out and back in, and only leaves by, and turns off at, the connectors that
 * allow (PL.slotRoutes). At the big fields the taxiway runs 25 m in front of
 * the hangars, so a 747 or an A380 there uses the stands and the middle
 * connector; a type with nowhere it can go is not flown at that field.
 *
 * HEARD. The nearest one within a kilometre of the camera makes its engine
 * noise, quietly, on the environment bus (./traffic/sound.js).
 *
 * WHEN. On in Free Flight, off in the tutorial, the missions and the other
 * vehicles — unless a mission's definition says `traffic: true` (or a
 * number, for how many). Dev mode has buttons to add one now, land one now,
 * clear them all, follow one with the camera and hide their name tags.
 *
 * CONTRACT. `sim.traffic` is published every frame as
 *   [{ id, typeId, pos: THREE.Vector3, heading, speed, alt, onGround, phase, ... }]
 * with `phase` one of the stable keys in PHASE_TEXT below and `activity` the
 * words for it. It is the same array object every frame, updated in place.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import * as Prog from '../game/progression.js';
import { createAircraftModel, groundOffsetFor } from '../aircraft/model-adapter.js';
import { specFor, performanceFor } from '../aircraft/types.js';
import { LIVERIES, schemeFor } from '../aircraft/liveries.js';
import { heightAt, isOnRunway, isOnRunway2, AIRPORT, MAP } from '../world/terrain.js';
import { buildField, runwayFor, groundY, alongR2, holdPoint } from './traffic/field.js';
import * as PL from './traffic/planner.js';
import { blankPlayer, reachTime, pathSlack, choose, towardPlayer, onRunwayK, reachOf, timeAlong } from './traffic/rules.js';
import { rng, DEG, wrapPi, Path, Draft } from './traffic/path.js';
import * as LOD from './traffic/lod.js';
import { TrafficSound } from './traffic/sound.js';
import { registerBody, unregisterBody } from './sky.js';

/* ------------------------------------------------------------------ */
/* Tuning                                                              */
/* ------------------------------------------------------------------ */

const MAX_AIRCRAFT = 6;
/** Beyond this the model is hidden and a single dot stands in for it. */
const LOD_FAR = 3600;
/**
 * Nearer than this it casts a shadow. Was 700 m; a shadow is what puts an
 * aeroplane on the ground beside you, and past a few hundred metres it is a
 * few pixels that cost a second draw of every part.
 */
const SHADOW_NEAR = 350;
/**
 * Detail by distance. Beyond DETAIL_NEAR the parts under 0.9 m (aerials,
 * lamps, the pitot, most wheels) are not drawn; beyond DETAIL_FAR, where a
 * light aeroplane is a dozen pixels, nothing under 2.5 m (control surfaces,
 * gear, the propeller). Only parts the model never hides by itself.
 */
const DETAIL_NEAR = 400;
const DETAIL_FAR = 1200;
/** Name tags between these distances from the camera. */
const TAG_NEAR = 60;
const TAG_FAR = 2000;
/** Separation from the player in the air, metres: aimed for, and never below. */
const SEP_WANT = 700;
const SEP_MIN = 300;
/** How far ahead, seconds, a traffic aeroplane looks for someone to avoid. */
const EVADE_HORIZON = 20;
/** m/s/s: how hard a step aside is turned into the drift back to the path (see evade). */
const DRIFT_ACCEL = 5;
const G = 9.81;

/** Stable phase keys, and the words for them. */
export const PHASE_TEXT = {
  parked: 'parked',
  startup: 'starting up',
  pushback: 'pushing back',
  'taxi-out': 'taxiing out',
  'taxi-wait': 'waiting to taxi in',
  holding: 'holding short',
  lineup: 'lining up',
  takeoff: 'taking off',
  climb: 'climbing out',
  route: 'flying',
  orbit: 'holding for the runway',
  approach: 'on approach',
  landing: 'landing',
  rollout: 'rolling out',
  'go-around': 'going around',
  vacate: 'leaving the runway',
  'taxi-in': 'taxiing in',
  'push-in': 'pushed in',
  shutdown: 'shutting down',
  // Hit by the player (sky.js): falling, crew out under their parachutes, then gone.
  knocked: 'coming down',
};

const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

const T = {
  sim: null,
  group: null,
  field: null,
  fieldKey: '',
  on: false,
  why: 'not started',
  dir: 1,
  list: [],
  /** The published array. The same object for the whole session. */
  pub: [],
  dots: null,
  runwayOwner: null,
  rand: rng(1),
  nextId: 1,
  watch: -1,
  tags: true,
  pending: null,
  builtThisFrame: false,
  /** Seconds of flying, this session: the traffic's own clock. */
  time: 0,
  notes: { goAround: 0, hold: 0, depart: 0, land: 0 },
  stats: { ms: 0, msMax: 0, frames: 0, minSepAir: Infinity, planMs: 0, planMsMax: 0, slowest: '', meshesSaved: 0, deadlocks: 0, goArounds: 0, unstable: 0, escapes: 0, towerHold: 0, towerClear: 0 },
  /** The tower's "hold position" (R4): whether it has been said, and since when the runway has been clear or not. */
  tower: { on: false, who: null, seenSince: null, clearSince: null, saidAt: -Infinity, rollSaid: false },
};

// Reused every frame — nothing in the per-frame path allocates.
const S = { x: 0, y: 0, z: 0, hdg: 0, kappa: 0, grad: 0, ground: 0, vmax: 0 };
const V1 = new THREE.Vector3();
const V3 = new THREE.Vector3();
const EUL = new THREE.Euler(0, 0, 0, 'YXZ');
const CAM_POS = new THREE.Vector3();
const LOOK = new THREE.Vector3();

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ */
/* Field and fleet                                                     */
/* ------------------------------------------------------------------ */

function fieldKeyNow() {
  return `${MAP && MAP.id}`;
}

function refreshField() {
  const t0 = performance.now();
  T.field = buildField();
  T.fieldKey = fieldKeyNow();
  if (!T.field.ok) T.why = T.field.why;
  noteTime(performance.now() - t0, true, 'field');
}

/**
 * Which way the runway is being used. 09 — the way the tutorial, the ATC and
 * every spawn point face — unless the wind would put more than 8 knots on the
 * tail, or this map's terrain rules 09 out for everything that flies here.
 */
function chooseDir(sim, field, types) {
  const w = sim.weather;
  let dir = 1;
  if (w && Number.isFinite(w.windDirDeg)) {
    const tail09 = -Math.cos((w.windDirDeg - 90) * DEG) * (w.windSpeedKts || 0);
    if (tail09 > 8) dir = -1;
  }
  const usable = (d) => types.filter((t) => PL.runwayUsable(field, PL.perfFor(t), d).ok).length;
  if (!usable(dir) && usable(-dir)) dir = -dir;
  return dir;
}

function shortName(type) {
  const words = String(type.name || type.id).split(/\s+/);
  // "Kestrel Courier" is a Courier; "Skylark 172" is a Skylark.
  const w = words.find((x) => /^[A-Za-z]{3,}$/.test(x) && x.toLowerCase() !== 'kestrel') || words[0];
  return w;
}

function makeCraft(type, idx, home) {
  const perf = PL.perfFor(type);
  // Airliners in airline colours, everything else in its own.
  let scheme = null;
  let brand = shortName(type);
  if (perf.cat === 'airliner') {
    const painted = LIVERIES.filter((l) => !l.house);
    if (painted.length) {
      const l = painted[Math.floor(T.rand() * painted.length)];
      scheme = l;
      brand = String(l.name).replace(/\s+(Air|States)$/i, '');
    }
  }
  if (!scheme) scheme = schemeFor(type, 'house');
  const n = 10 + Math.floor(T.rand() * 89);
  const digits = String(n).split('').map((d) => DIGITS[+d]).join(' ');
  const c = {
    id: `traffic-${T.nextId++}`,
    idx,
    type,
    perf,
    scheme,
    home,
    callsign: `${brand} ${n}`,
    spoken: `${brand} ${digits}`,
    state: 'parked',
    timer: 30,
    legs: [],
    leg: null,
    s: 0,
    v: 0,
    cur: { i: 0 },
    geo: null,
    layer: perf.layerAGL + perf.layerStep * idx,
    side: idx % 2 ? -1 : 1,
    // Pose.
    x: home ? home.x : 0,
    y: home ? home.y : 0,
    z: home ? home.z : 0,
    hdg: home ? home.headingDeg * DEG : 0,
    pitch: perf.groundPitch,
    bank: 0,
    onGround: true,
    vy: 0,
    // Evasion offset (world metres) and how fast it is changing.
    off: new THREE.Vector3(),
    offV: new THREE.Vector3(),
    threatT: 0,
    // Engine, gear, flaps.
    rpm: 0,
    gear: 1,
    flaps: 0,
    engineOn: false,
    blockedT: 0,
    // Who it last stopped for on the ground (a craft, 'player', or null), and
    // one it has been let through after a real nose-to-nose deadlock.
    blockCraft: null,
    lastBlocker: null,
    passing: null,
    // The connector it is leaving by, and the exit it has been given.
    depConn: null,
    exitX: null,
    // Seconds until it next asks to taxi, while it waits for the way to clear.
    askT: 0,
    goArounds: 0,
    phase: 'parked',
    activity: 'parked',
    // Model.
    model: null,
    modelFailed: false,
    meshes: [],
    shadows: null,
    rideOffset: 0,
    tag: null,
    tagText: '',
    ac: null,
    pub: null,
    lastX: 0,
    lastY: 0,
    lastZ: 0,
  };
  if (home) home.owner = c.id;
  // Its arrival worked out now, while the flight starts (or the Dev button is
  // pressed), and not in the frame it takes off: a few candidates are tried,
  // each a circuit, an orbit and a go-around.
  try {
    if (T.field && T.field.ok) PL.arrivalFor(T.field, perf, T.dir, perf.layerAGL + perf.layerStep * idx, idx % 2 ? -1 : 1);
  } catch (e) {
    /* planned again when it is needed */
  }
  c.pub = {
    id: c.id,
    typeId: type.id,
    name: type.name,
    callsign: c.callsign,
    pos: new THREE.Vector3(c.x, c.y, c.z),
    vel: new THREE.Vector3(),
    heading: 0,
    speed: 0,
    alt: 0,
    agl: 0,
    vs: 0,
    onGround: true,
    gearDown: true,
    phase: 'parked',
    activity: 'parked',
    span: perf.span,
    /*
     * The same record is this aeroplane's BODY in the sky (./sky.js): what
     * the player can collide with and what the minimap draws. `name` above
     * is the type's (the warnings' contract); the body's name for the crash
     * reason is the callsign, so the banner says "You flew into Island 47".
     */
    kind: 'traffic',
    bodyName: c.callsign,
    radius: Math.max(perf.span, perf.length || 0) / 2,
    crew: perf.cat === 'light' ? 1 : 2,
    uniform: perf.cat === 'airliner' ? 'captain' : perf.cat === 'light' ? 'casual' : 'fighter',
    hit: () => knockCraft(c),
  };
  c.ac = {
    controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 },
    rpm: 0,
    flaps: 0,
    gearPos: 1,
    gearDown: true,
    onGround: true,
    groundSpeed: 0,
    agl: 0,
    alt: 0,
    engineOn: false,
    crashed: false,
    pos: null,
    quat: null,
    vel: new THREE.Vector3(),
  };
  return c;
}

/**
 * Is the player's aeroplane (or car) sitting on this slot? A slot is the
 * traffic's only while nobody else has parked in it: the airport work opens
 * the hangar doors for anything on the ground, so a child can taxi into one.
 */
function playerOnSlot(slot) {
  const sim = T.sim;
  const p = sim && (sim.mode === 'drive' ? sim.vehicle && sim.vehicle.pos : sim.aircraft && sim.aircraft.pos);
  if (!p || !slot) return false;
  const r = (slot.maxSpan || 20) / 2 + 6;
  return Math.abs(p.x - slot.x) < r && Math.abs(p.z - slot.z) < r && p.y < slot.y + 12;
}

/**
 * A free slot that fits, hangars first for the light aeroplanes — and one it
 * can actually get to and from with its wings clear of the buildings (see
 * PL.slotUsable). `fromExit`, for one that has just landed: a slot it can
 * taxi to from that exit.
 */
function freeSlot(perf, prefer = 'hangar', fromExit = null) {
  const field = T.field;
  if (!field || !field.ok) return null;
  const fits = field.slots.filter((s) => !s.owner && PL.fits(s, perf) && !playerOnSlot(s));
  if (!fits.length) return null;
  fits.sort((a, b) => {
    const pa = a.kind === prefer ? 0 : 1;
    const pb = b.kind === prefer ? 0 : 1;
    // Among equals, the tightest fit, so the big stand stays free for big aeroplanes.
    return pa - pb || a.maxSpan - b.maxSpan;
  });
  const t0 = performance.now();
  const out = fits.find(
    (s) => PL.slotUsable(field, perf, s, T.dir) && (fromExit == null || PL.slotRoutes(field, perf, s).in.get(fromExit) === null)
  );
  noteTime(performance.now() - t0, true, 'slot routes');
  return out || null;
}

function poolTypes() {
  const field = T.field;
  if (!field || !field.ok) return [];
  return PL.typesFor(field).filter((t) => PL.runwayUsable(field, PL.perfFor(t), T.dir).ok);
}

/**
 * Fill the airfield at the start of a flight: some parked and about to go,
 * some already out flying, so the sky is not empty for the first ten minutes
 * and the apron is not empty either.
 */
function populate(sim) {
  const field = T.field;
  if (!field || !field.ok) return 0;
  const all = PL.typesFor(field);
  T.dir = chooseDir(sim, field, all);
  const pool = poolTypes();
  if (!pool.length) {
    T.why = 'no aeroplane can use this runway';
    return 0;
  }
  const quality = sim.settings && sim.settings.quality;
  // A mission that asks for traffic may say how much: `traffic: 2`.
  const def = sim.mode === 'mission' && sim.runner && sim.runner.def;
  const asked = def && Number.isFinite(def.traffic) ? Math.max(1, Math.min(MAX_AIRCRAFT, Math.round(def.traffic))) : null;
  const want = asked || (quality === 'low' ? 2 : field.length >= 2400 ? 4 : 3);
  // Shuffle the pool so each flight has a different mix.
  const order = [...pool].sort(() => T.rand() - 0.5);
  let made = 0;
  for (let i = 0; i < want; i++) {
    // The next type in the shuffled order that still has somewhere to park —
    // the first cut took them strictly in turn, and a second Tempest with
    // the hangar and the big stand taken left the field one aeroplane short.
    let type = null;
    let perf = null;
    let home = null;
    for (let k = 0; k < order.length && !home; k++) {
      type = order[(i + k) % order.length];
      perf = PL.perfFor(type);
      home = freeSlot(perf, perf.cat === 'light' ? 'hangar' : 'stand');
    }
    if (!home) break;
    const c = makeCraft(type, made, home);
    T.list.push(c);
    // Staggered: one leaves soon, one is already out and coming back, one
    // later, one on a long tour.
    const role = made % 4;
    if (role === 0) parkAt(c, 12 + T.rand() * 10);
    else if (role === 2) parkAt(c, 80 + T.rand() * 60);
    else if (!launchAirborne(sim, c, role === 1 ? 'circuit' : 'tour', role === 1 ? 0.45 : 0.2)) parkAt(c, 40 + T.rand() * 40);
    made++;
  }
  rebuildPub();
  return made;
}

/** Put a craft on its slot, engine off, leaving in `wait` seconds. */
function parkAt(c, wait) {
  const h = c.home;
  c.state = 'parked';
  c.timer = wait;
  c.leg = null;
  c.legs.length = 0;
  c.v = 0;
  c.engineOn = false;
  c.rpm = 0;
  c.gear = 1;
  c.flaps = 0;
  c.off.set(0, 0, 0);
  c.depConn = null;
  c.exitX = null;
  c.passing = null;
  c.waitT = 0;
  if (h) {
    c.x = h.x;
    c.z = h.z;
    c.y = h.y;
    c.hdg = h.headingDeg * DEG;
  }
  c.pitch = c.perf.groundPitch;
  c.bank = 0;
  c.onGround = true;
  setPhase(c, 'parked', h && h.kind === 'hangar' ? 'parked in the hangar' : 'parked');
}

/**
 * Start a craft already airborne, part-way round a route, well away from the
 * player. Returns false if no such start could be found.
 */
function launchAirborne(sim, c, kind, frac) {
  const field = T.field;
  const t0 = performance.now();
  const dep = PL.planDeparture(field, c.perf, T.dir);
  if (!dep.ok) return false;
  c.geo = PL.arrivalFor(field, c.perf, T.dir, c.layer, c.side);
  const r = PL.planRoute(field, c.perf, dep.end, c.geo, kind, T.rand);
  noteTime(performance.now() - t0, true, 'airborne start');
  if (!r || !r.legs.length) return false;
  const leg = r.legs[0];
  const p = leg.path;
  // Somewhere along it at least 1.5 km from the player.
  const pl = sim.aircraft && sim.aircraft.pos;
  let s = p.length * frac;
  for (let k = 0; k < 12 && pl; k++) {
    const i = p.indexAt(s);
    if (Math.hypot(p.x[i] - pl.x, p.y[i] - pl.y, p.z[i] - pl.z) > 1500) break;
    s = (s + p.length * 0.13) % (p.length * 0.9);
  }
  startLeg(c, leg, s);
  c.v = p.vmax[p.indexAt(s)];
  c.engineOn = true;
  c.rpm = 0.7;
  c.gear = c.type.shape && c.type.shape.retractable ? 0 : 1;
  c.onGround = false;
  c.state = 'moving';
  // Where it is on that route now, not on the slot it was given.
  pose(sim, c, 0);
  return true;
}

/* ------------------------------------------------------------------ */
/* Legs                                                                */
/* ------------------------------------------------------------------ */

function startLeg(c, leg, s = 0) {
  c.leg = leg;
  c.s = s;
  c.cur.i = 0;
  c.blockedT = 0;
  // Lined up: a moment's pause, engines up, then go. A tug hooks on before a
  // push, too.
  c.holdT = leg.pauseBefore != null ? leg.pauseBefore : leg.kind === 'takeoff' ? 3 : 0;
  if (leg.kind === 'approach') c.onApproach = true;
  // Rolling: the holding point it left is free for the next one.
  if (leg.kind === 'takeoff') c.depConn = null;
  // Off the connector and on to the taxiway: the exit is free again.
  if (leg.kind === 'taxi-in') c.exitX = null;
  // Off the approach — turning off, round again, or another way off: the
  // exit it kept free in case (planArrival) is free again too.
  if (leg.kind !== 'approach') c.exitAlt = null;
  c.passing = null;
  c.r2Hold = false;
  c.rulesAt = 0;
  c.hurry = 0;
  const name = leg.kind === 'route' ? 'route' : leg.kind;
  setPhase(c, PHASE_TEXT[name] ? name : 'route', leg.phase || PHASE_TEXT[name]);
}

function setPhase(c, key, text) {
  c.phase = key;
  c.activity = text || PHASE_TEXT[key] || key;
}

/** Plan whatever comes after `done`. Returns an array of legs (maybe empty). */
function planAfter(sim, c, done) {
  const field = T.field;
  const perf = c.perf;
  const t0 = performance.now();
  let out = [];
  try {
    switch (done.kind) {
      case 'taxi-out': {
        const dep = PL.planDeparture(field, perf, T.dir, c.depConn);
        c.depEnd = dep.end;
        out = dep.legs;
        break;
      }
      case 'takeoff': {
        c.geo = PL.arrivalFor(field, perf, T.dir, c.layer, c.side);
        // Light aeroplanes mostly fly circuits, which keeps the airfield busy;
        // everything else tours.
        const kind = perf.cat === 'light' && T.rand() < 0.55 ? 'circuit' : 'tour';
        // Where its path is, not where it is drawn: any step aside it has
        // taken since lift-off carries on over the new path (see goAround).
        const from = { x: c.x - c.off.x, y: c.y - c.off.y, z: c.z - c.off.z, hdg: c.leg ? c.hdg - (c.slip || 0) : runwayFor(field, T.dir).heading, v: c.v };
        let r = PL.planRoute(field, perf, c.depEnd || from, c.geo, kind, T.rand);
        /*
         * A plan that does not clear the ground is not flown. planRoute()
         * already falls back from a tour to a circuit; if even that fails
         * from here, the circuit that goodArrival() checked from the normal
         * climb-out is the one flown.
         */
        if (!r.ok) {
          const c2 = PL.planRoute(field, perf, c.depEnd || from, c.geo, 'circuit', T.rand);
          if (c2.ok || c2.margin > r.margin) r = c2;
          if (!r.ok) console.warn(`[traffic] ${c.callsign}: best route is ${r.why}`);
        }
        out = r.legs;
        break;
      }
      case 'route':
      case 'orbit':
      case 'go-around':
        out = [{ kind: 'gate' }];
        break;
      case 'approach':
      case 'vacate': {
        const slot = homeFrom(c, done.exit);
        if (slot && done.exit != null) out = PL.routeLegs(field, perf, slot, 'in', done.exit);
        break;
      }
      default:
        out = [];
    }
  } catch (e) {
    console.warn(`[traffic] ${c.callsign}: could not plan after ${done.kind}`, e);
    out = [];
  }
  noteTime(performance.now() - t0, true, `after ${done.kind}`);
  return out;
}

/**
 * The slot it goes home to from exit x: its own — unless you have parked in
 * it while it was away, or its wings cannot get there from x, in which case
 * another free one it can reach, rather than queueing at your tail.
 */
function homeFrom(c, x) {
  const field = T.field;
  const perf = c.perf;
  let slot = c.home;
  const reach = slot && x != null && PL.slotRoutes(field, perf, slot).in.get(x) === null;
  if (!slot || playerOnSlot(slot) || !reach) {
    const other = freeSlot(perf, slot ? slot.kind : perf.cat === 'light' ? 'hangar' : 'stand', x);
    if (other) {
      if (slot && slot.owner === c.id) slot.owner = null;
      slot = other;
    }
  }
  if (slot && c.home !== slot) {
    c.home = slot;
    slot.owner = c.id;
  }
  return slot;
}

/** The current leg is done: what next? */
function nextLeg(sim, c) {
  const done = c.leg;
  if (done && done.releaseRunway && T.runwayOwner === c) T.runwayOwner = null;
  if (done && done.kind === 'approach') c.onApproach = false;
  // Where it came off the runway, for a way home from there (rehome).
  if (done && done.exit != null) c.exitFrom = done.exit;
  let next = c.legs.shift();
  if (!next && done) {
    const planned = planAfter(sim, c, done);
    next = planned.shift();
    c.legs.push(...planned);
  }
  if (!next) {
    // The end of the day's flying: shut down on the slot.
    if (done && (done.kind === 'taxi-in' || done.holdAtEnd)) {
      c.state = 'shutdown';
      c.timer = 5;
      c.leg = null;
      c.v = 0;
      setPhase(c, 'shutdown');
      return;
    }
    // Nothing planned and nowhere to be: park it where it stands and try
    // again later rather than freezing mid-air.
    if (!c.onGround) {
      atGate(sim, c);
      return;
    }
    parkAt(c, 60);
    return;
  }
  if (next.kind === 'gate') {
    atGate(sim, c);
    return;
  }
  if (next.needs === 'departure') {
    c.pending = next;
    c.state = 'waiting';
    c.leg = null;
    c.v = 0;
    setPhase(c, 'holding');
    return;
  }
  /*
   * Off the runway at the exit's holding point, about to taxi back: that
   * needs the way to be clear, the same as leaving the slot does. It waits
   * here — off the runway, off the taxiway — rather than setting off and
   * meeting somebody nose to nose.
   */
  if (next.kind === 'taxi-in') {
    c.legs.unshift(next);
    c.state = 'taxi-wait';
    c.leg = null;
    c.v = 0;
    c.askT = 0;
    c.waitT = 0;
    setPhase(c, 'taxi-wait');
    return;
  }
  startLeg(c, next);
}

/** Arrived at the gate: cleared to approach, or a 360 and ask again. */
function atGate(sim, c) {
  const field = T.field;
  if (!c.geo) c.geo = PL.arrivalFor(field, c.perf, T.dir, c.layer, c.side);
  const ctx = T.ctx;
  const someoneOnFinal = T.list.some((o) => o !== c && o.onApproach);
  if (!ctx.playerUsingRunway && !someoneOnFinal) {
    const t0 = performance.now();
    // An exit it can taxi home from, and that nobody is waiting at or heading for.
    const app = planArrival(c);
    noteTime(performance.now() - t0, true, 'approach');
    if (app.ok) {
      startLeg(c, app.legs[0]);
      c.exitX = app.exit;
      c.state = 'moving';
      announceLanding(sim, c);
      return;
    }
  }
  startLeg(c, PL.planOrbit(field, c.perf, c.geo));
  c.state = 'moving';
}

/* ------------------------------------------------------------------ */
/* Clearances                                                          */
/* ------------------------------------------------------------------ */

/**
 * What the player is doing with the runway, worked out once a frame.
 *   onRunway  on it, or a few metres over it
 *   onFinal   low, lined up with it and heading for it, within 4 km
 */
function playerContext(sim) {
  const ctx = T.ctx;
  const ac = sim.aircraft;
  const f = T.field;
  ctx.pos = ac ? ac.pos : null;
  ctx.vel = ac ? ac.vel : null;
  ctx.air = !!(ac && !ac.onGround && !ac.crashed);
  ctx.onRunway = false;
  ctx.onFinal = false;
  ctx.climbOut = 0;
  ctx.pmG.on = false;
  ctx.pm1.on = false;
  ctx.pm2.on = false;
  if (!ac || !f || !f.ok || sim.mode === 'drive') {
    ctx.playerUsingRunway = false;
    ctx.runway2 = false;
    ctx.r2Parked = false;
    ctx.r2Active = false;
    return ctx;
  }
  const p = ac.pos;
  const agl = ac.agl != null ? ac.agl : p.y - f.elev;
  ctx.onRunway = isOnRunway(p.x, p.z, 25) && (ac.onGround || agl < 15 || ac.crashed);
  if (ctx.air && agl < 320 && Math.abs(p.z - f.cz) < 500) {
    const beyondWest = f.west - p.x;
    const beyondEast = p.x - f.east;
    const h = ((ac.heading ?? 90) + 360) % 360;
    const east = Math.abs(((h - 90 + 540) % 360) - 180) < 40;
    const west = Math.abs(((h - 270 + 540) % 360) - 180) < 40;
    if (beyondWest > -200 && beyondWest < 4200 && east) ctx.onFinal = true;
    if (beyondEast > -200 && beyondEast < 4200 && west) ctx.onFinal = true;
    // Just off the runway and climbing away along it: +1 eastbound, -1 west.
    if (agl < 300 && beyondEast > -600 && beyondEast < 3000 && east) ctx.climbOut = 1;
    if (agl < 300 && beyondWest > -600 && beyondWest < 3000 && west) ctx.climbOut = -1;
  }
  /*
   * The crosswind runway. On it, or low on final to it or climbing away from
   * it: nobody taxis across it (blockRunway2), and where it crosses 09/27 —
   * Kestrel's 18/36 does, in the middle — nobody takes off or lands either.
   */
  ctx.runway2 = runway2Use(ac, p, agl);
  // Your size, and whether you are stopped on the ground (so a taxi route
  // through where you sit is not started at all).
  const sh = sim.aircraftType && sim.aircraftType.shape;
  ctx.halfSpan = sh ? ((sh.wingRootX || 0.62) + (sh.halfSpan || 5.5)) * (sh.scale || 1) : 6;
  const speed = ac.groundSpeed != null ? Math.abs(ac.groundSpeed) : ac.ias || 0;
  ctx.groundStill = !!(ac.onGround && !ac.crashed && speed < 0.7);
  // (Not worked out on frames with no traffic about: after a gap, the clock
  // starts again rather than trusting a stop it did not see.)
  if (!ctx.groundStill || T.time - ctx.seenAt > 1) ctx.stillSince = T.time;
  ctx.seenAt = T.time;
  /*
   * Parked on the crosswind runway — stopped there for half a minute, which
   * is a parking and not a hold, with a wing's length and more between you
   * and 09/27 — is in nobody's way on 09/27: take-offs and landings there go
   * on past you. The first cut counted it as using 09/27: on Kestrel, parked
   * where the parallel taxiway crosses 18/36, every departure held and every
   * arrival circled for as long as you sat there (the review: no take-offs
   * and no landings in 10 min, 8 runs of 8). Move, and it is yours again at
   * once.
   *
   * 18/36 itself stays yours while you sit on it, because you may roll at
   * any moment: `runway2` — on it at all — refuses every clearance on to it
   * (r2Clear), and only `r2Active` holds 09/27.
   */
  ctx.r2Parked = !!(ctx.runway2 && ctx.groundStill && T.time - ctx.stillSince > 30 && !isOnRunway(p.x, p.z, 35 + ctx.halfSpan));
  ctx.r2Active = ctx.runway2 && !ctx.r2Parked;
  ctx.playerUsingRunway = ctx.onRunway || ctx.onFinal || (ctx.r2Active && f.r2Crosses);
  /*
   * Taxiing out: on the ground at the airfield, off the runway, and moving —
   * or stopped for less than half a minute, which is a hold, not a parking.
   * The taxi-out lesson in Free Flight sends you to the holding point on the
   * same connector a runway 09 departure uses, so nobody else leaves their
   * slot while you are on your way out.
   */
  const atField = Math.abs(p.x - f.cx) < f.length / 2 + 250 && f.W(p.z) > f.halfWidth && f.W(p.z) < f.twW + 200;
  if (ac.onGround && !ctx.onRunway && atField && speed > 1) ctx.movedAt = T.time;
  ctx.taxiing = !!(ac.onGround && !ctx.onRunway && atField && ac.engineOn && T.time - ctx.movedAt < 30);
  playerModels(sim, ac, p, agl);
  return ctx;
}

/** The player's size and lift-off speed, by type, for the runway rules. */
const PLAYER_DIMS = new Map();
function playerDims(sim) {
  const t = sim.aircraftType;
  const id = t ? t.id : '?';
  let d = PLAYER_DIMS.get(id);
  if (d) return d;
  const sh = (t && t.shape) || {};
  const sc = sh.scale || 1;
  const halfSpan = ((sh.wingRootX || 0.62) + (sh.halfSpan || 5.5)) * sc;
  const half = ((2.6 + 3.95) * (sh.bodyLength || 1) * sc) / 2;
  const pl = t && t.plan && Number.isFinite(t.plan.nose) && Number.isFinite(t.plan.tail) ? t.plan : null;
  let vLift = 30;
  try {
    const perf = performanceFor(id);
    if (perf && Number.isFinite(perf.stallClean) && perf.stallClean > 0) vLift = perf.stallClean * 0.514444 * 1.15;
  } catch (e) {
    /* a trainer's */
  }
  d = {
    halfSpan: pl && Number.isFinite(pl.span) ? Math.max(halfSpan, pl.span / 2) : halfSpan,
    nose: pl ? Math.max(1, -pl.nose) : half,
    tail: pl ? Math.max(1, pl.tail) : half,
    vLift,
  };
  PLAYER_DIMS.set(id, d);
  return d;
}

/**
 * The player as the runway rules see them (./traffic/rules.js), worked out
 * once a frame:
 *   pmG  on the ground (or just over it): where they are, which way their
 *        nose points, how fast - for "could they get there first?" (R2)
 *   pm1  the same, while they are on 09/27 (R3 there)
 *   pm2  on 18/36 the same; on final to it, a player at the threshold they
 *        are coming to, arriving when their speed gets them there
 * Past where they would be off the ground (dLift, at a gentle metre a second
 * a second from where they are) they fly over whatever is there.
 */
function playerModels(sim, ac, p, agl) {
  const ctx = T.ctx;
  const dims = playerDims(sim);
  const low = ac.onGround || agl < 15;
  const h = ((ac.heading ?? 90) * Math.PI) / 180;
  const ux = Math.sin(h);
  const uz = -Math.cos(h);
  const vel = ac.vel;
  const vAlong = vel ? Math.max(0, vel.x * ux + vel.z * uz) : Math.max(0, ac.groundSpeed || 0);
  const fill = (pm, on, x, z, dx, dz, v, delay, accel) => {
    pm.on = on;
    pm.x = x;
    pm.z = z;
    pm.ux = dx;
    pm.uz = dz;
    pm.v = v;
    pm.delay = delay;
    pm.accel = accel;
    pm.halfSpan = Math.max(dims.halfSpan, ctx.halfSpan);
    pm.nose = dims.nose;
    pm.tail = dims.tail;
    pm.dLift = Math.max(60, (dims.vLift * dims.vLift - v * v) / 2) + 60;
  };
  if (!ac.crashed && low) {
    fill(ctx.pmG, true, p.x, p.z, ux, uz, vAlong, 0, 1.5);
    if (ctx.onRunway) fill(ctx.pm1, true, p.x, p.z, ux, uz, vAlong, 0, 1.5);
    if (isOnRunway2(p.x, p.z, 25)) fill(ctx.pm2, true, p.x, p.z, ux, uz, vAlong, 0, 1.5);
  }
  if (!ctx.pm2.on && ctx.runway2 && !low) {
    // On final to 18/36: at its threshold when their speed gets them there.
    const r = AIRPORT.runway2;
    const hd = (r.headingDeg ?? 180) * DEG;
    const rx = Math.sin(hd);
    const rz = -Math.cos(hd);
    const a = (p.x - r.cx) * rx + (p.z - r.cz) * rz;
    const half = r.length / 2;
    const along = Math.cos(h - hd);
    const v = Math.max(20, Math.hypot(vel ? vel.x : 0, vel ? vel.z : 0));
    if (along > 0.77 && a < -half + 600) {
      fill(ctx.pm2, true, r.cx - rx * half, r.cz - rz * half, rx, rz, v, Math.max(0, -half - a) / v, 0);
    } else if (along < -0.77 && a > half - 600) {
      fill(ctx.pm2, true, r.cx + rx * half, r.cz + rz * half, -rx, -rz, v, Math.max(0, a - half) / v, 0);
    }
  }
}

/**
 * Is the player using the crosswind runway: on it (or a few metres over it),
 * or low and lined up with it within 4 km of either end, or just off an end
 * climbing away along it?
 */
function runway2Use(ac, p, agl) {
  const r = AIRPORT && AIRPORT.runway2;
  if (!r) return false;
  if (isOnRunway2(p.x, p.z, 25) && (ac.onGround || agl < 15)) return true;
  if (ac.onGround || ac.crashed || agl > 320) return false;
  const hd = (r.headingDeg ?? 180) * DEG;
  const ux = Math.sin(hd);
  const uz = -Math.cos(hd);
  const a = (p.x - r.cx) * ux + (p.z - r.cz) * uz;
  const b = Math.abs(-(p.x - r.cx) * uz + (p.z - r.cz) * ux);
  if (b > 500) return false;
  const half = r.length / 2;
  const h = ((ac.heading ?? 0) * DEG) % (Math.PI * 2);
  const along = Math.cos(h - hd);
  // Heading along +u from before the start, or along -u from beyond the end.
  if (along > 0.77 && a < -half + 600 && a > -half - 4200) return true;
  if (along < -0.77 && a > half - 600 && a < half + 4200) return true;
  // Climbing away past either end.
  if (along > 0.77 && a > half - 600 && a < half + 3000 && agl < 300) return true;
  if (along < -0.77 && a < -half + 600 && a > -half - 3000 && agl < 300) return true;
  return false;
}

/** Seconds until an arrival reaches the runway, the soonest of them. */
function soonestArrival(except) {
  let best = Infinity;
  for (const o of T.list) {
    if (o === except || !o.onApproach || !o.leg || o.leg.kind !== 'approach') continue;
    const left = o.leg.sTD - o.s;
    if (left <= 0) return 0;
    best = Math.min(best, left / Math.max(o.v, 20));
  }
  return best;
}

/**
 * May c line up now (R2)? The runway its own or nobody's; you not on it, not
 * on final to it, not climbing away over the far end in front of it; no
 * arrival due within two minutes (two and a half for the way on over the
 * crosswind runway, which takes longer); and, if its way on crosses 18/36,
 * the clearance for that too (r2Clear) - one clearance for the whole way on,
 * which it then drives without stopping on either runway.
 */
function departureClear(c, L) {
  const mine = T.runwayOwner === c;
  if (T.runwayOwner && !mine) return false;
  const ctx = T.ctx;
  if (ctx.playerUsingRunway) return false;
  /*
   * You have just taken off the same way and are still low over the far end:
   * wait for you to get clear rather than rolling a minute behind you and
   * catching you up on the climb. Only for as long as you are there - fly the
   * circuit round the field all day and nobody waits for ever, because the
   * downwind leg is not in front of the runway.
   */
  if (ctx.climbOut === T.dir) return false;
  const viaR2 = !!(L && L.path && T.field.r2 && r2Span(L.path, c.perf).sUse < Infinity);
  // Lining up, rolling and climbing away takes a light aeroplane about forty
  // seconds and an arrival wants the runway a kilometre and a half out.
  if (!mine && soonestArrival(c) < (viaR2 ? 150 : 120)) return false;
  if (viaR2 && !r2Clear(c, L.path, c.leg === L ? c.s : 0, c.leg === L ? c.v : 0)) return false;
  return true;
}

/*
 * THE CROSSWIND RUNWAY. Kestrel's 18/36 crosses 09/27 in the middle and the
 * parallel taxiway at x 250, and the connector at x 250 IS 18/36. A leg that
 * goes on to it - up it, down it or across it, not just 09/27's own traffic
 * through the crossing - is using a runway, and gets a clearance for it
 * before it starts (R2): you not on it, not on final to it, not climbing away
 * from it, and not able to get to the part it will be on before it is off
 * it again, and nobody else using it. Then it drives on and off it without
 * stopping. If the clearance goes before it gets there (you turned up), it
 * stops short of it, off it (blockedAhead), and gives 09/27 back.
 */

/** Where this path is on the crosswind runway, for an aeroplane this big - cached on the path. */
function r2Span(p, perf) {
  const m = r2Margin(perf);
  const c0 = p._r2;
  if (c0 && c0.m === m) return c0;
  let sAny = Infinity;
  let sUse = Infinity;
  let sOut = -Infinity;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  const e = reachOf(perf);
  for (let i = 0; i < p.n; i++) {
    const x = p.x[i];
    const z = p.z[i];
    if (!isOnRunway2(x, z, m)) continue;
    const s = p.s[i];
    if (s < sAny) sAny = s;
    // On 18/36 and not in its crossing with 09/27: using it, not crossing it along 09/27.
    if (!isOnRunway(x, z, 0)) {
      if (s < sUse) sUse = s;
      // Where it is, wings and all, clear of 09/27 — the part of 18/36 only
      // this clearance answers for (on 09/27, 09/27's rules do).
      if (!isOnRunway(x, z, e)) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
      }
    }
    sOut = s;
  }
  const out = { m, sAny, sUse, sOut, box: { x0: x0 - e, x1: x1 + e, z0: z0 - e, z1: z1 + e } };
  p._r2 = out;
  return out;
}

/** Is anyone else using the crosswind runway - on a leg up, down or across it, not yet off it? */
function r2InUse(c) {
  for (const o of T.list) {
    if (o === c || !o.onGround || o.state !== 'moving' || !o.leg) continue;
    const e = r2Span(o.leg.path, o.perf);
    if (e.sUse < Infinity && o.s <= e.sOut + 2 && o.s >= e.sUse - o.perf.noseLen - 40) return o;
  }
  return null;
}

/**
 * The clearance on to (or across) the crosswind runway for path p, from s
 * at speed v (R2): see above. The time it needs is the rest of its way over
 * 18/36 at the speeds the path allows, and eight seconds more.
 */
function r2Clear(c, p, s = 0, v = 0) {
  const f = T.field;
  if (!f.r2) return true;
  const e = r2Span(p, c.perf);
  if (e.sUse === Infinity || s > e.sOut) return true;
  const ctx = T.ctx;
  if (ctx.runway2) return false;
  const need = timeAlong(p, s, e.sOut, v) + 8;
  if (reachTime(ctx.pmG, e.box) < need) return false;
  if (r2InUse(c)) return false;
  // Nobody standing on it where it is going, or just beyond, to stop it there.
  for (const o of T.list) {
    if (o === c || !o.onGround) continue;
    const R = (c.perf.span + o.perf.span) / 2 + 4;
    if (o.x > e.box.x0 - R && o.x < e.box.x1 + R && o.z > e.box.z0 - R && o.z < e.box.z1 + R && pathNear(p, e.sUse - 10, e.sOut + 40, o.x, o.z, R)) return false;
  }
  return true;
}

/** Does path p pass within R of (x, z) between distances s0 and s1? */
function pathNear(p, s0, s1, x, z, R) {
  const R2 = R * R;
  for (let i = p.indexAt(Math.max(0, s0)); i < p.n && p.s[i] <= s1; i++) {
    const dx = p.x[i] - x;
    const dz = p.z[i] - z;
    if (dx * dx + dz * dz < R2) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* Moving                                                              */
/* ------------------------------------------------------------------ */

function stepCraft(sim, c, dt) {
  switch (c.state) {
    case 'parked':
      c.timer -= dt;
      if (c.timer <= 0) {
        c.state = 'startup';
        c.timer = 6;
        c.engineOn = true;
        setPhase(c, 'startup');
      }
      break;
    case 'startup':
      c.timer -= dt;
      c.waitT = (c.waitT || 0) + dt;
      if (c.timer <= 0) {
        // You are taxiing out: it waits on its slot, engine running, till you are gone.
        if (T.ctx.taxiing) {
          c.timer = 3;
          note(sim, 'hold', `${c.callsign} is waiting for you to taxi out first`, 90);
        } else if (c.waitT > 180) {
          // Three minutes with the engine running and nowhere to go: shut
          // down and try again later.
          parkAt(c, 60 + T.rand() * 60);
        } else beginDeparture(sim, c);
      }
      break;
    case 'taxi-wait':
      c.v = 0;
      c.askT -= dt;
      c.waitT = (c.waitT || 0) + dt;
      if (c.askT <= 0) {
        c.askT = 0.5;
        let why = groundConflict(c, c.legs);
        // On to, or across, the crosswind runway: its clearance too (R2).
        if (!why && c.legs.length && !r2Clear(c, c.legs[0].path)) why = 'waiting to cross the crosswind runway';
        // Half a minute of the way home being blocked — by you parked on the
        // taxiway, say — and it looks for another slot it can reach now.
        if (why && c.waitT > 30 && c.legs.length) why = rehome(c, why);
        c.waitWhy = why;
        if (!why) {
          startLeg(c, c.legs.shift());
          c.state = 'moving';
        }
      }
      break;
    case 'shutdown':
      c.timer -= dt;
      if (c.timer <= 0) {
        parkAt(c, 45 + T.rand() * 100);
        c.goArounds = 0;
      }
      break;
    case 'waiting':
      c.v = 0;
      if (c.pending && departureClear(c, c.pending)) {
        // (Announced once: as it crosses on to 18/36 for the runway, if it does.)
        if (T.runwayOwner !== c) announceDeparture(sim, c);
        T.runwayOwner = c;
        const leg = c.pending;
        c.pending = null;
        startLeg(c, leg);
        c.state = 'moving';
      } else if (T.ctx.playerUsingRunway && T.ctx.onRunway) {
        note(sim, 'hold', `${c.callsign} is holding short while you are on the runway`, 60);
      }
      break;
    case 'moving':
      follow(sim, c, dt);
      break;
    case 'knocked':
      knockedStep(sim, c, dt);
      return;
    default:
      break;
  }
  engineAndGear(c, dt);
}

/* ------------------------------------------------------------------ */
/* Hit by the player (./sky.js)                                        */
/* ------------------------------------------------------------------ */

/**
 * The player has flown into this one. It stops flying its path and comes
 * down — a slow tumble, engine off, nose dropping, rolling as it falls —
 * and when it reaches the ground it is retired for good (its slot freed,
 * its model disposed). The crew have already left under their parachutes
 * (sky.js drops them). Nothing here is a wreck or a fire: it is simply an
 * aeroplane that is no longer in the sky.
 */
function knockCraft(c) {
  if (!c || c.state === 'knocked') return;
  const h = c.hdg;
  c.knock = { t: 0, vx: Math.sin(h) * c.v, vy: Math.min(0, c.vy), vz: -Math.cos(h) * c.v, spin: (c.idx % 2 ? -1 : 1) * 2.4 };
  c.state = 'knocked';
  c.engineOn = false;
  c.onApproach = false;
  c.onGround = false;
  c.holdT = 0;
  if (T.runwayOwner === c) T.runwayOwner = null;
  setPhase(c, 'knocked');
  T.notes.knocked = (T.notes.knocked || 0) + 1;
}

function knockedStep(sim, c, dt) {
  const k = c.knock;
  k.t += dt;
  // A gentle gravity — a tumble, not a plummet — and the speed washing off.
  k.vy -= 6 * dt;
  const damp = Math.max(0, 1 - 0.35 * dt);
  k.vx *= damp;
  k.vz *= damp;
  c.x += k.vx * dt;
  c.y += k.vy * dt;
  c.z += k.vz * dt;
  c.v = Math.hypot(k.vx, k.vz);
  c.vy = k.vy;
  c.pitch = Math.max(-1.1, c.pitch - 0.9 * dt);
  c.bank += k.spin * dt;
  c.hdg += 0.5 * dt * Math.sign(k.spin);
  c.rpm = Math.max(0, c.rpm - dt * 0.4);
  c.ac.rpm = c.rpm;
  c.ac.engineOn = false;
  const ground = groundY(c.x, c.z);
  if (c.y <= ground + 1 || k.t > 45) retireCraft(sim, c);
}

/** Out of the list, out of the scene, out of the sky: for one that has come down. */
function retireCraft(sim, c) {
  const i = T.list.indexOf(c);
  if (i < 0) return;
  if (c.model && c.model.parent) c.model.parent.remove(c.model);
  if (c.tag && c.tag.parent) c.tag.parent.remove(c.tag);
  const keep = sceneResources(sim);
  disposeCraft(c, keep);
  T.list.splice(i, 1);
  if (T.watch === i) T.watch = -1;
  else if (T.watch > i) T.watch--;
  unregisterBody(c.pub);
  rebuildPub();
  T.notes.retired = (T.notes.retired || 0) + 1;
}

/**
 * Waiting at an exit with its way home blocked: switch to another free slot
 * it can taxi to from here, with a clear way, if there is one. Returns null
 * if it switched (and c.legs is the new way), or `why` unchanged.
 */
function rehome(c, why) {
  const f = T.field;
  const L0 = c.legs[0];
  // The exit it came off at (its taxi home starts at that exit's holding point).
  const ex = L0.exit != null ? L0.exit : c.exitFrom != null ? c.exitFrom : L0.path.x[0];
  c.waitT = 0;
  for (const s of f.slots) {
    if (s === c.home || s.owner || !PL.fits(s, c.perf) || playerOnSlot(s)) continue;
    if (!PL.slotUsable(f, c.perf, s, T.dir) || PL.slotRoutes(f, c.perf, s).in.get(ex) !== null) continue;
    const legs = PL.routeLegs(f, c.perf, s, 'in', ex);
    // (A way from where it is waiting, and nobody in it.)
    if (Math.hypot(legs[0].path.x[0] - c.x, legs[0].path.z[0] - c.z) > 1.5 || groundConflict(c, legs)) continue;
    if (c.home && c.home.owner === c.id) c.home.owner = null;
    c.home = s;
    s.owner = c.id;
    c.legs = legs;
    return null;
  }
  return why;
}

function beginDeparture(sim, c) {
  if (!c.home) {
    parkAt(c, 60);
    return;
  }
  const t0 = performance.now();
  const field = T.field;
  let legs = [];
  let cx = null;
  let why = null;
  try {
    /*
     * The connector it leaves by: the one with the most runway ahead that its
     * wings can reach without touching a building — for a jumbo at the big
     * fields, the middle one — and that nobody else is holding at or turning
     * off at. Taken, it waits on its slot, engine running, and asks again.
     */
    const conns = PL.departureConnectors(field, c.perf, c.home, T.dir);
    why = conns.length ? 'the holding point is taken' : 'no way out to this runway';
    // The best one whose way is clear now; with you parked on the way to
    // the far end, a nearer connector rather than waiting for ever.
    for (const x of conns) {
      if (holdBusy(x, c)) continue;
      // Not out to wait at the crosswind runway's holding point while you
      // are on it: another connector, or the slot until you are off it.
      if (alongR2(field, x) && T.ctx.runway2) {
        why = 'you are using the crosswind runway';
        continue;
      }
      const l = PL.routeLegs(field, c.perf, c.home, 'out', x);
      const w = groundConflict(c, l);
      if (!w) {
        cx = x;
        legs = l;
        why = null;
        break;
      }
      why = w;
    }
  } catch (e) {
    console.warn(`[traffic] ${c.callsign}: no taxi route`, e);
    why = 'no taxi route';
    legs = [];
  }
  noteTime(performance.now() - t0, true, 'taxi-out');
  if (why || !legs.length) {
    c.state = 'startup';
    c.timer = 1.5;
    c.waitWhy = why;
    setPhase(c, 'startup', 'waiting to taxi');
    return;
  }
  // The slot stays reserved while it is away: it is coming back to it.
  c.depConn = cx;
  c.waitT = 0;
  c.waitWhy = null;
  c.legs = legs;
  const first = c.legs.shift();
  startLeg(c, first);
  c.state = 'moving';
}

/* ------------------------------------------------------------------ */
/* Sharing the taxiways                                                */
/* ------------------------------------------------------------------ */

/*
 * The first cut let everybody set off whenever they were ready and sorted it
 * out on the way: each one stopped for whatever was on its path, and after
 * half a minute of that, one blocked by another aeroplane drove on. That
 * fired in every ordinary queue. Measured by the review with the player sat
 * at the start of runway 09: in 4 of 6 runs two aeroplanes ended up inside
 * each other at the holding point, and one queued behind the player on the
 * taxiway drove straight through the player's aeroplane after 30 s.
 *
 * Now nobody sets off until their way is clear, the way a tower gives taxi
 * clearances. Leaving a slot and leaving the runway both ask groundConflict():
 * is anybody on the move whose remaining route meets mine coming the other
 * way or across it, or standing where I am going? Following one going the
 * same way is fine — the blocking keeps them apart — and nobody is ever let
 * through anybody for having waited. Each holding point takes one departure
 * at a time, and an exit is not given to an arrival while anyone is waiting
 * at it or heading for it.
 */

/** Is (x, z) on connector `cx`, between the runway edge and the taxiway, within `half` of its line? */
function onConnector(x, z, cx, half) {
  const f = T.field;
  const w = f.W(z);
  return Math.abs(x - cx) < half + 12 && w > f.halfWidth - 8 && w < f.twW - f.twHalf + 4;
}

/** Someone else is heading for, holding at, turning off at or standing on connector `x`. */
function holdBusy(x, c) {
  const half = c ? c.perf.span / 2 : 10;
  for (const o of T.list) {
    if (o === c) continue;
    if (o.depConn === x || o.exitX === x) return true;
    // Kept free as the way off for one that is to turn off along 18/36 (planArrival).
    if (o.exitAlt === x && alongRunway2(o.exitX)) return true;
    if (o.onGround && onConnector(o.x, o.z, x, half + o.perf.span / 2)) return true;
  }
  const ctx = T.ctx;
  if (ctx.pos && ctx.groundStill && onConnector(ctx.pos.x, ctx.pos.z, x, half + ctx.halfSpan)) return true;
  // The crosswind runway's holding point is on the taxiway, not the connector.
  if (alongRunway2(x)) {
    const h = holdPoint(T.field, x, c ? c.perf : null);
    for (const o of T.list) {
      if (o !== c && o.onGround && Math.hypot(o.x - h.x, o.z - h.z) < half + o.perf.span / 2 + 12) return true;
    }
    if (ctx.pos && ctx.groundStill && Math.hypot(ctx.pos.x - h.x, ctx.pos.z - h.z) < half + ctx.halfSpan + 12) return true;
  }
  return false;
}

/**
 * What an arrival's approach may turn off at: its way home, and not somewhere
 * taken — nor up the crosswind runway while you are on it (it would hold at
 * the end of the exit, on 18/36, until its way home was clear).
 */
function exitRules(c) {
  const f = T.field;
  const exits = c.home ? PL.arrivalExits(f, c.perf, c.home) : f.connectors;
  return {
    allow: (x) => exits.includes(x) && !holdBusy(x, c) && !(T.ctx.runway2 && alongRunway2(x)),
    avoid: runwayFor(f, T.dir).depConnector,
  };
}

/**
 * The approach, from the gate. An exit along the crosswind runway comes with
 * another it could turn round short of the crossing and get back to — or,
 * one that cannot stop short of it, turn round beyond it — kept
 * free for it (holdBusy) until it has turned off: if you get on to 18/36
 * before then, that is its way off (rerouteOffR2). Without one it was
 * stuck: the review's seed 1 on 09 — exits 0 and -430 each with a
 * departure waiting at it for the runway, the Tempest given 250 — sat short
 * of the crossing owning 09/27, and nothing took off or landed for as long
 * as you were parked on 18/36. With no such exit free it is not cleared,
 * and holds at the gate while the departures go.
 */
function planArrival(c) {
  const rules = exitRules(c);
  const app = PL.planApproach(T.field, c.perf, c.geo, rules);
  c.exitAlt = null;
  if (app.ok && alongRunway2(app.exit)) {
    const rw = c.geo.rw;
    const r2 = AIRPORT.runway2;
    // Round short of the crossing and back, or (a Meridian on 09 at Kestrel
    // cannot stop short of it) on through it and round beyond.
    const near = r2.cx - rw.dir * (r2.halfWidth + r2Margin(c.perf) + c.perf.noseLen);
    const far = r2.cx + rw.dir * (r2.halfWidth + r2Margin(c.perf) + c.perf.tailLen + 5);
    const o = { allow: (x) => rules.allow(x) && !alongRunway2(x), avoid: rw.depConnector };
    let alt = (near - c.geo.TD) * rw.dir > 0 ? PL.exitPlan(T.field, rw, c.perf, c.geo.TD, { ...o, limitX: near }) : null;
    if (!alt || !alt.ok) alt = PL.exitPlan(T.field, rw, c.perf, c.geo.TD, { ...o, turnFrom: far });
    if (!alt.ok) return { ok: false, why: 'no way off but along 18/36', legs: [] };
    c.exitAlt = alt.x;
  }
  return app;
}

/** The first index of a leg's ground part at or after distance s0, or -1 if it has none (or is on the runway, which is the tower's). */
function groundFrom(L, s0) {
  const k = L.kind;
  if (k === 'lineup' || k === 'takeoff' || k === 'route' || k === 'orbit' || k === 'go-around') return -1;
  const p = L.path;
  let i = s0 > 0 ? p.indexAt(s0) : 0;
  while (i < p.n && !p.ground[i]) i++;
  return i < p.n ? i : -1;
}

/** [x0, x1, z0, z1] of a path, kept on it. */
function pathBox(p) {
  if (p.box) return p.box;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < p.n; i++) {
    if (p.x[i] < x0) x0 = p.x[i];
    if (p.x[i] > x1) x1 = p.x[i];
    if (p.z[i] < z0) z0 = p.z[i];
    if (p.z[i] > z1) z1 = p.z[i];
  }
  p.box = [x0, x1, z0, z1];
  return p.box;
}

/**
 * Do my legs come within R metres of path L (from index i0 on), anywhere the
 * two are not going the same way? A box test first, then every other point.
 */
function legsMeet(legs, L, i0, R) {
  const q = L.path;
  const qb = pathBox(q);
  const R2 = R * R;
  for (const M of legs) {
    const p = M.path;
    const b = pathBox(p);
    if (b[1] < qb[0] - R || b[0] > qb[1] + R || b[3] < qb[2] - R || b[2] > qb[3] + R) continue;
    for (let i = 0; i < p.n; i += 2) {
      const x = p.x[i];
      const z = p.z[i];
      if (x < qb[0] - R || x > qb[1] + R || z < qb[2] - R || z > qb[3] + R) continue;
      for (let j = i0; j < q.n; j += 2) {
        const dx = q.x[j] - x;
        const dz = q.z[j] - z;
        if (dx * dx + dz * dz >= R2 || !q.ground[j]) continue;
        // Going the same way: a queue, which the blocking keeps apart.
        if (Math.cos(p.hdg[i] - q.hdg[j]) > 0.7) continue;
        return true;
      }
    }
  }
  return false;
}

/** Do my legs pass within R of the point (x, z)? */
function legsNear(legs, x, z, R) {
  const R2 = R * R;
  for (const M of legs) {
    const p = M.path;
    const b = pathBox(p);
    if (b[1] < x - R || b[0] > x + R || b[3] < z - R || b[2] > z + R) continue;
    for (let i = 0; i < p.n; i++) {
      const dx = p.x[i] - x;
      const dz = p.z[i] - z;
      if (dx * dx + dz * dz < R2) return true;
    }
  }
  return false;
}

/**
 * May c set off on these ground legs now? null if so, or who is in the way.
 * Asked when a craft wants to taxi, and twice a second while it waits.
 */
function groundConflict(c, legs) {
  if (!legs || !legs.length) return null;
  const mine = c.perf.span;
  for (const o of T.list) {
    if (o === c) continue;
    // Wing tips apart, with three metres between them.
    const R = (mine + o.perf.span) / 2 + 3;
    if (o.state === 'moving' && o.leg) {
      // Where it is going on the ground: the rest of this leg, and the ones
      // queued after it.
      const i0 = groundFrom(o.leg, o.s);
      if (i0 >= 0 && legsMeet(legs, o.leg, i0, R)) return `${o.callsign} is taxiing that way`;
      for (const l of o.legs) {
        const j0 = groundFrom(l, 0);
        if (j0 >= 0 && legsMeet(legs, l, j0, R)) return `${o.callsign} is taxiing that way`;
      }
      if (o.onGround && o.v < 0.5 && legsNear(legs, o.x, o.z, R)) return `${o.callsign} is in the way`;
    } else {
      // Held short of the crosswind runway: where it goes when it crosses.
      // Holding short of the crosswind runway, on the taxiway: where it goes when it is cleared.
      if (o.state === 'waiting' && o.pending && T.field.r2 && r2Span(o.pending.path, o.perf).sUse < Infinity && legsMeet(legs, o.pending, 0, R)) {
        return `${o.callsign} is taxiing that way`;
      }
      if (o.onGround && legsNear(legs, o.x, o.z, R)) return `${o.callsign} is in the way`;
    }
  }
  // You, stopped on the ground where it wants to go.
  const ctx = T.ctx;
  if (ctx.pos && ctx.groundStill && legsNear(legs, ctx.pos.x, ctx.pos.z, mine / 2 + ctx.halfSpan + 3)) return 'you are in the way';
  // You on the crosswind runway — using it, or parked on it and free to roll
  // at any moment — and its way goes on to it: not now, rather than setting
  // off and stopping at the edge of it in everyone's way, or holding on it
  // in front of you (Kestrel's third connector IS 18/36; see playerContext).
  if (ctx.runway2 && legsOnRunway2(legs, mine / 2 + 5)) return ctx.r2Parked ? 'you are parked on the crosswind runway' : 'you are using the crosswind runway';
  return null;
}

/** Does connector x run along the crosswind runway (is it 18/36 itself)? */
function alongRunway2(x) {
  return alongR2(T.field, x);
}

/** Within this of the crosswind runway's edge, an aeroplane's middle counts as on it (blockRunway2's margin). */
function r2Margin(perf) {
  return perf.span / 2 + 5;
}

/* ------------------------------------------------------------------ */
/* You on a runway it is on: off it, out of your way (R3)               */
/* ------------------------------------------------------------------ */

/*
 * The four repair rounds before this one each fixed the case in front of
 * them — a back-taxi turned round here, a take-off told to wait there, an
 * exit swapped for another — and each left the next case standing: one
 * waiting nose to nose with you because nothing said where else to go, one
 * sent 250 m along the runway ahead of you to an exit beyond it, one held
 * at a holding point that was itself on 18/36. So now there is one rule and
 * one way of applying it.
 *
 * You are on a runway it is on. It works out every way off it has from
 * where it is — its own plan, if that already takes it off; each exit
 * ahead that it can slow down for and that is short of you; each exit
 * behind, by a slow turn round (never a stop) as gentle as there is room
 * for before you — and for each asks one question: at the speeds that way
 * allows, is it ever in the strip your wings will sweep, ahead of your nose,
 * before you could get there if you opened the throttle now
 * (rules.js pathSlack)? The way with the most time in hand wins; any with
 * eight seconds or more counts as safe, and among those it keeps its plan,
 * or takes the one off the runway soonest. It then holds short, off the
 * runway, and goes home from there. So an exit just behind it beats one
 * far ahead of you, and an exit towards you is taken only while it is well
 * short of you and there is time. Nothing is special-cased by what the
 * aeroplane was doing.
 *
 * What it will not do is roll its take-off at you, or line up with you on
 * the runway: a take-off already rolling goes on only if it is off the
 * ground long before it gets to you, and one lined up with you ahead of it
 * leaves (R1: lined up is only for when the runway is its own). With you
 * behind it, it goes — away from you — without its usual pause.
 */

/** Scratch for pathSlack (judge). */
const SL1 = {};

/**
 * The runway rules, for c on its leg L on the ground; from follow(), four
 * times a second. Returns true if c was given a new leg.
 */
function runwayRules(sim, c, L) {
  if (T.time < (c.rulesAt || 0)) return false;
  c.rulesAt = T.time + 0.25;
  const ctx = T.ctx;
  const f = T.field;
  const m = c.perf.span / 2 + 2;
  if (f.r2 && r2Gate(sim, c, L)) return true;
  if (ctx.pm1.on && isOnRunway(c.x, c.z, m) && escape09(sim, c, L)) return true;
  if (ctx.pm2.on && isOnRunway2(c.x, c.z, m) && escape18(sim, c, L)) return true;
  return false;
}

/**
 * A leg that goes on to the crosswind runway, and c not on it yet: does it
 * still have the clearance (r2Clear, R2)? If not — you have turned up on
 * 18/36 since, or could be there before it is off — a departure gives 09/27
 * back and stops short of 18/36, off it (c.r2Hold: blockedAhead), until it
 * has both again; one that was to turn off along it after landing finds
 * another way off (rerouteOffR2). Returns true if c got new legs.
 */
function r2Gate(sim, c, L) {
  c.r2Hold = false;
  const e = r2Span(L.path, c.perf);
  if (e.sUse === Infinity || c.s >= e.sUse || isOnRunway2(c.x, c.z, r2Margin(c.perf))) return false;
  let ok = r2Clear(c, L.path, c.s, c.v);
  if (L.kind === 'lineup') {
    // One clearance for the whole way on: 18/36, then 09/27.
    if (ok && T.ctx.onRunway) ok = false;
    if (ok && T.runwayOwner !== c) {
      if (!T.runwayOwner && departureClear(c, L)) T.runwayOwner = c;
      else ok = false;
    }
    if (!ok && T.runwayOwner === c) T.runwayOwner = null;
  } else if (!ok && (L.kind === 'approach' || L.kind === 'vacate')) {
    if (rerouteOffR2(sim, c, L)) return true;
  }
  c.r2Hold = !ok;
  return false;
}

/** On the centreline of 09/27, along it: +1 nose east, -1 west, 0 if not (turning on or off it). */
function along09(c) {
  const f = T.field;
  if (Math.abs(c.z - f.cz) > 2 || Math.abs(Math.sin(c.hdg)) < 0.985) return 0;
  return Math.sin(c.hdg) > 0 ? 1 : -1;
}

/**
 * How safe path p (from s, at speed v) is from you wherever you are: on
 * 09/27, on 18/36 or on final to it — the worst of them (pathSlack each).
 */
function judge(c, p, s, v, out) {
  const ctx = T.ctx;
  out.slack = Infinity;
  out.touch = false;
  out.offT = 0;
  out.keep = false;
  out.toward = false;
  let first = true;
  for (const [pm, k] of [[ctx.pm1, 1], [ctx.pm2, 2]]) {
    if (!pm.on) continue;
    const r = pathSlack(p, s, v, c.perf, pm, k, SL1);
    out.slack = Math.min(out.slack, r.slack);
    out.touch = out.touch || r.touch;
    if (first || k === 1) out.offT = r.offT;
    first = false;
  }
  if (first) out.offT = pathSlack(p, s, v, c.perf, ctx.pm1, 1, SL1).offT;
  return out;
}

/** Every way off 09/27 from where c is, each with how safe it is from you (judge). */
function waysOff(c, pm, k, allow, limitX) {
  const f = T.field;
  const d = along09(c);
  const out = [];
  if (!d || !c.home) return out;
  for (const X of f.connectors) {
    if (!allow(X) || holdBusy(X, c)) continue;
    const p = PL.escapePath(f, c.perf, c.x, c.z, d, c.v, X, limitX);
    if (!p) continue;
    // Off along 18/36: only with its clearance, like anyone else.
    if (alongRunway2(X) && !r2Clear(c, p, 0, c.v)) continue;
    // Somewhere to go home to from there.
    if (!PL.arrivalExits(f, c.perf, c.home).includes(X) && !freeSlot(c.perf, c.home.kind, X)) continue;
    const r = judge(c, p, 0, c.v, {});
    r.path = p;
    r.exit = X;
    r.toward = towardPlayer(pm, c.x, c.z, X, f.cz);
    out.push(r);
  }
  return out;
}

/** You on 09/27 with c on it: R3. Returns true if c got new legs. */
function escape09(sim, c, L) {
  const ctx = T.ctx;
  const f = T.field;
  const pm = ctx.pm1;
  const rw = runwayFor(f, T.dir);
  const takeoff = L.kind === 'takeoff';
  if (takeoff) {
    if (c.s >= L.sLift) return false;
    const ahead = (pm.x - c.x) * rw.dir;
    if (ahead < -pm.tail) {
      // You are behind it: it goes now, away from you, rather than sit lined up.
      if (c.holdT > 0.3) c.holdT = 0.3;
      return false;
    }
    // Rolling, and off the ground long before it gets to you — or past stopping.
    if (c.v > 1 && (ahead > L.sLift - c.s + 250 || c.v > c.perf.vr * 0.92)) return false;
  } else if (L.kind === 'approach' && c.s < L.sTD) return false;
  const E = c.escapeFor;
  if (E && E.leg === L && Math.hypot(E.x - pm.x, E.z - pm.z) < 30) return false;
  const t0 = performance.now();
  const cands = [];
  /*
   * The plan it has: a roll-out or a way off already going to its exit — or
   * a back-taxi on to the far end, away from you, which ends lined up there:
   * past where you would be off the ground, that end is the one place on the
   * runway you cannot meet it (pathSlack ignores it there).
   */
  if (L.kind === 'approach' || L.kind === 'vacate' || L.kind === 'lineup') {
    const r = judge(c, L.path, c.s, c.v, {});
    r.keep = true;
    cands.push(r);
  }
  /*
   * Lined up, with you ahead: staying put is a choice only when it is where
   * you cannot meet it — beyond where you are off the ground, or not in
   * your way at all — and then only if every way off is less safe (R3: it
   * stops as far from you as it can when there is no way off that is not
   * towards you).
   */
  if (takeoff && c.v < 1) {
    const rx = c.x - pm.x;
    const rz = c.z - pm.z;
    const along = rx * pm.ux + rz * pm.uz;
    const lat = Math.abs(-rx * pm.uz + rz * pm.ux);
    const e = reachOf(c.perf);
    const inWay = lat < pm.halfSpan + e + 3 && along > -(pm.tail + e) && along - pm.nose - e <= pm.dLift;
    cands.push({ slack: inWay ? -Infinity : Infinity, touch: false, offT: Infinity, stay: true });
  }
  // How far along the runway it may reach: the near side of you, if you are ahead of it on it.
  const d = along09(c);
  const pr = Math.max(pm.nose, pm.tail, pm.halfSpan) + 4;
  const limitX = d && (pm.x - c.x) * d > 0 && Math.abs(pm.z - f.cz) < f.halfWidth + 30 ? pm.x - d * pr : null;
  cands.push(...waysOff(c, pm, 1, () => true, limitX));
  noteTime(performance.now() - t0, true, 'off the runway for you');
  const best = choose(cands);
  if (!best) {
    // Nothing yet (it is turning on to the runway, say). Lined up, it never rolls at you.
    if (takeoff && c.v < 1) c.holdT = Math.max(c.holdT, 0.5);
    /*
     * No way off at all — the one exit ahead has someone waiting at it, and
     * the rest are past you — and it is going away from you, back-taxiing
     * to the end: it gets there briskly, as far from you as the runway
     * goes (R3's last resort), and the tower tells you it is there (R4).
     */
    else if (L.kind === 'lineup' && d && (pm.x - c.x) * d < 0) c.hurry = 10;
    // Coming towards you with no way off: it stops, as far from you as it can.
    else if (L.kind === 'lineup' && d) c.holdT = Math.max(c.holdT, 0.5);
    return false;
  }
  if (best.stay) {
    c.holdT = Math.max(c.holdT, 0.5);
    return false;
  }
  if (best.keep) {
    // Going away from you to the far end: briskly (hurryCap).
    if (L.kind === 'lineup' && d && (pm.x - c.x) * d < 0) c.hurry = 10;
    c.escapeFor = { x: pm.x, z: pm.z, leg: L };
    return false;
  }
  applyEscape(sim, c, best.path, best.exit, 'leaving the runway: you are on it', pm, `${c.callsign} is leaving the runway — you are on it`);
  return true;
}

/**
 * You on 18/36 (or on final to it) with c on it. 09/27's own traffic in the
 * crossing carries on out of it along 09/27, and one that has turned off
 * along it carries on off it: for those, on is the way off. A departure on
 * its way down 18/36 to 09/27 has two: on, lining up on 09/27 clear of the
 * crossing (09/27 is its own); or, still on the taxiway at the edge of 18/36,
 * straight across it to the far side (PL.acrossR2Path) — at right angles to
 * you, and off 18/36 in a few seconds. The one with more time in hand
 * (pathSlack) wins. Returns true if c got new legs.
 */
function escape18(sim, c, L) {
  const ctx = T.ctx;
  const f = T.field;
  const pm = ctx.pm2;
  if (L.kind !== 'lineup' || r2Span(L.path, c.perf).sUse === Infinity) return false;
  const E = c.escapeFor;
  if (E && E.leg === L && Math.hypot(E.x - pm.x, E.z - pm.z) < 30) return false;
  const cands = [];
  if (T.runwayOwner === c && !ctx.onRunway) {
    const r = judge(c, L.path, c.s, c.v, {});
    r.keep = true;
    cands.push(r);
  }
  if (c.home && Math.abs(c.z - f.twZ) < 1.5 && Math.abs(Math.cos(c.hdg)) < 0.1) {
    const dirX = Math.sin(c.hdg) > 0 ? 1 : -1;
    const p = PL.acrossR2Path(f, c.perf, c.x, c.v, dirX);
    if (p) {
      const r = judge(c, p, 0, c.v, {});
      r.path = p;
      cands.push(r);
    }
  }
  const best = choose(cands);
  if (!best || best.keep) {
    if (best) c.escapeFor = { x: pm.x, z: pm.z, leg: L };
    return false;
  }
  // Across: it will not be taking off now. 09/27 is given back; it goes home
  // from the far side, crossing 18/36 again when it has the clearance.
  if (T.runwayOwner === c) T.runwayOwner = null;
  const p = best.path;
  const leg = { kind: 'vacate', path: p, reverse: false, needs: null, phase: 'clearing the runway: you are on it' };
  c.legs = PL.planTaxiHome(f, c.perf, p.x[p.n - 1], c.home);
  c.depConn = null;
  c.pending = null;
  c.state = 'moving';
  startLeg(c, leg);
  c.escapeFor = { x: pm.x, z: pm.z, leg };
  T.stats.escapes++;
  note(sim, 'hold', `${c.callsign} is clearing the runway — you are on it`, 30);
  return true;
}

/**
 * Rolling out for an exit along 18/36, and it may not go on to 18/36 now
 * (r2Gate): another way off 09/27, short of the crossing while you are
 * using 18/36 — through it, past you parked there, is 09/27's own traffic.
 */
function rerouteOffR2(sim, c, L) {
  const f = T.field;
  const ctx = T.ctx;
  const d = along09(c);
  if (!d || !c.home) return false;
  // Already turning off: it goes on (r2Hold stops it short if it must).
  if (Math.abs(L.exit - c.x) < Math.min(f.halfWidth + 6, 20) + 5) return false;
  const r2 = f.r2;
  const limitX = ctx.r2Active && f.r2Crosses && (r2.cx - c.x) * d > 0 ? r2.cx - d * (r2.hw + 2) : null;
  const best = choose(waysOff(c, ctx.pm2, 2, (x) => !alongRunway2(x), limitX));
  if (!best) return false;
  applyEscape(sim, c, best.path, best.exit, 'leaving the runway', ctx.pm2, null);
  return true;
}

/** Put c on a way off the runway to exit X, and home from there. */
function applyEscape(sim, c, p, X, phase, pm, say) {
  const t0 = performance.now();
  const L = c.leg;
  if (L && L.kind === 'approach') c.onApproach = false;
  const leg = { kind: 'vacate', path: p, reverse: false, needs: null, phase, releaseRunway: true, sRelease: p.length - 1, exit: X };
  const slot = homeFrom(c, X);
  c.legs = slot ? PL.routeLegs(T.field, c.perf, slot, 'in', X) : [];
  // 09/27 is its own until it is off it (the way off gives it back).
  if (!T.runwayOwner) T.runwayOwner = c;
  c.depConn = null;
  c.pending = null;
  c.state = 'moving';
  startLeg(c, leg);
  c.exitX = X;
  c.escapeFor = { x: pm.x, z: pm.z, leg };
  T.stats.escapes++;
  noteTime(performance.now() - t0, true, 'way off the runway');
  if (say) note(sim, 'hold', say, 30);
}

/** Do these legs go on to the crosswind runway (other than where they start)? */
function legsOnRunway2(legs, margin) {
  let first = true;
  for (const M of legs) {
    const p = M.path;
    for (let i = 0; i < p.n; i++) {
      const on = isOnRunway2(p.x[i], p.z[i], margin);
      // Already on it where it starts: that part is leaving it.
      if (first) {
        if (on) continue;
        first = false;
      }
      if (on) return true;
    }
  }
  return false;
}

/** Follow the current leg for dt seconds. */
function follow(sim, c, dt) {
  const L = c.leg;
  if (!L) {
    nextLeg(sim, c);
    return;
  }
  const p = L.path;
  const remain = p.length - c.s;
  // What the path allows a little ahead, so a standing start can start —
  // but never all the way to a stop at the end, or it creeps up on the stop
  // line for ever and never quite arrives.
  const look = Math.min(Math.max(2, c.v * 0.6), remain * 0.5);
  p.sample(Math.min(p.length, c.s + look), c.cur, S);
  let vCmd = S.vmax;
  const onGroundLeg = S.ground === 1;
  // Getting to the end of the runway, away from you, with no way off it (escape09).
  if (c.hurry && onGroundLeg) vCmd = Math.max(vCmd, hurryCap(c, p));
  if (c.holdT > 0) {
    c.holdT -= dt;
    vCmd = 0;
  }

  // Runway use by the player, on the legs that care.
  if (L.kind === 'approach') approachChecks(sim, c, L);
  if (c.leg !== L) return; // went around
  if (L.kind === 'approach' && L.sLock != null && c.s >= L.sLock && T.runwayOwner !== c) {
    if (!T.runwayOwner) T.runwayOwner = c;
    else if (c.s < L.sTD - 20) {
      goAround(sim, c, 'traffic');
      return;
    }
  }
  if (L.kind === 'takeoff' && L.sRelease != null && c.s >= L.sRelease && T.runwayOwner === c) T.runwayOwner = null;

  // The runway rules (R2, R3): on to a runway only when cleared, and off one
  // you are on by the way that keeps it out of your path.
  if (onGroundLeg && c.onGround && runwayRules(sim, c, L) && c.leg !== L) {
    follow(sim, c, dt);
    return;
  }

  // Something in the way on the ground: stop short of it, and wait for as
  // long as it takes.
  if (onGroundLeg || L.kind === 'pushback') {
    const d = blockedAhead(sim, c, L);
    if (d < Infinity) {
      vCmd = Math.min(vCmd, Math.sqrt(2 * 3.5 * Math.max(0, d)));
      // Counted per blocker: a queue that shuffles is not a deadlock.
      if (c.blockCraft !== c.lastBlocker) {
        c.lastBlocker = c.blockCraft;
        c.blockedT = 0;
      }
      c.blockedT += dt;
      /*
       * The one case nobody's patience ends: two aeroplanes each stopped for
       * the other — nose to nose, or each across the other's way. The taxi
       * clearances are there so that never happens; if it does, after twenty
       * seconds the one listed first is let past, and it is counted
       * (trafficState().stats.deadlocks) so a test can see it did. Never
       * past the player, never past one that is holding or queued behind
       * someone else — only a blocker that is blocked by this one.
       */
      const o = c.blockCraft;
      if (o && o !== 'player' && o.state === 'moving' && o.blockCraft === c && c.blockedT > 20 && o.blockedT > 20 && T.list.indexOf(c) < T.list.indexOf(o)) {
        c.passing = o;
        c.blockedT = 0;
        T.stats.deadlocks++;
        console.warn(`[traffic] ${c.callsign} and ${o.callsign} were nose to nose; ${c.callsign} goes first`);
      }
    } else {
      c.blockedT = 0;
      c.lastBlocker = null;
    }
  }

  // Speed: follow the profile, braking hard on the ground if something
  // appeared, gently in the air.
  const accel = L.kind === 'takeoff' && onGroundLeg ? c.perf.accel : onGroundLeg ? 1.2 : 1.0;
  const decel = onGroundLeg ? 4 : 1.5;
  if (vCmd > c.v) c.v = Math.min(vCmd, c.v + accel * dt);
  else c.v = Math.max(vCmd, c.v - decel * dt);
  if (c.v < 0.02 && vCmd < 0.05) c.v = 0;
  c.s += c.v * dt;

  if (c.s >= p.length - 0.05 || (remain < 0.6 && c.v < 0.35 && vCmd < 0.4)) {
    c.s = p.length;
    pose(sim, c, dt);
    nextLeg(sim, c);
    return;
  }
  pose(sim, c, dt);
  subPhase(c, L);
}

/**
 * As fast as c.hurry, but slow enough to brake (2 m/s/s) for every turn in
 * the next 150 m (at the path's own sideways limit, 1.4 m/s/s) and to stop
 * at its end.
 */
function hurryCap(c, p) {
  let v = Math.min(c.hurry, Math.sqrt(2 * 2 * Math.max(0, p.length - c.s)));
  for (let i = p.indexAt(c.s); i < p.n && p.s[i] < c.s + 150; i++) {
    const k = Math.abs(p.kappa[i]);
    if (k < 1e-4) continue;
    v = Math.min(v, Math.sqrt(1.4 / k + 2 * 2 * Math.max(0, p.s[i] - c.s)));
  }
  return v;
}

/** The finer-grained phase inside a leg, for sim.traffic and the tag. */
function subPhase(c, L) {
  if (L.kind === 'takeoff') {
    if (c.s < L.sLift) setPhase(c, 'takeoff');
    else setPhase(c, 'climb');
  } else if (L.kind === 'approach') {
    if (c.s >= L.sTD) setPhase(c, c.s > L.path.length - 60 ? 'vacate' : 'rollout');
    else if (L.sTD - c.s < 1200) setPhase(c, 'landing');
    else setPhase(c, 'approach');
  }
}

/** Place the craft on its path at c.s, and derive its attitude. */
function pose(sim, c, dt) {
  const L = c.leg;
  const p = L.path;
  p.sample(c.s, c.cur, S);
  const reverse = !!L.reverse;
  const ground = S.ground === 1;
  const perf = c.perf;

  // Evasion offset: only in the air, and faded out on short final.
  if (!ground) evade(sim, c, dt, L);
  else if (c.off.lengthSq() > 0) {
    c.off.set(0, 0, 0);
    c.offV.set(0, 0, 0);
  }

  const px = c.x;
  const py = c.y;
  const pz = c.z;
  c.x = S.x + c.off.x;
  c.z = S.z + c.off.z;
  c.y = S.y + c.off.y;
  /*
   * Never let an offset take it into the ground. Up high, not below 40 m over
   * whatever is under it. Low on its own path — just off the runway, or on
   * short final — not below the path, nor below the ground beside it. The
   * first cut only guarded the high case: with six about, a Tempest a few
   * seconds after lift-off stepped aside and DOWN for an arrival above it and
   * flew 1.4 m under the runway (node harness, busy field, Atoll and Drovers).
   */
  if (!ground && (c.off.y < 0 || c.off.x !== 0 || c.off.z !== 0)) {
    const g = Math.max(heightAt(c.x, c.z), 0);
    const floor = g + 40;
    /*
     * Up high, the ground it is heading over in the next four seconds is
     * climbed to before it gets there, at up to 40% of its speed — rather than
     * being popped over in the one frame it arrives. Stepped a kilometre
     * aside over the Fjord's cliffs, a chased Courier hopped 15 m up in a
     * tenth of a second (the soak's jump check).
     */
    if (dt > 0 && S.y >= floor) {
      const vx = (c.x - px) / dt;
      const vz = (c.z - pz) / dt;
      let ga = g;
      for (let k = 1; k <= 4; k++) ga = Math.max(ga, heightAt(c.x + vx * k, c.z + vz * k));
      if (c.y < ga + 40) {
        const up = Math.min(ga + 40 - c.y, Math.max(20, 0.4 * c.v) * dt);
        c.off.y += up;
        c.y += up;
      }
    }
    // (Raised over the ground beside the path by no more than it has stepped
    // aside, so the last few centimetres of a fading offset in the flare do
    // not lift it off its glideslope.)
    const need = S.y >= floor ? floor : Math.max(S.y, Math.min(g + 1, S.y + Math.hypot(c.off.x, c.off.z)));
    if (c.y < need) {
      c.off.y += need - c.y;
      c.y = need;
    }
  }
  c.onGround = ground;

  /*
   * Heading: along the path (nose backwards on a pushback) — and in the air,
   * along the way it is actually going, path plus any step aside. The first
   * cut turned the nose at most 23 degrees into a step aside of up to
   * 60 m/s, so a Courier (46 m/s) being chased slid sideways faster than it
   * flew, 33 degrees out of line, for 17 s. The step is now held under 60%
   * of its airspeed (evade), and the nose points where it goes.
   */
  let hdg = S.hdg + (reverse ? Math.PI : 0);
  let turn = S.kappa * c.v;
  if (!ground && c.v > 5 && (c.offV.x !== 0 || c.offV.z !== 0)) {
    const cs = Math.cos(S.hdg);
    const sn = Math.sin(S.hdg);
    const side = c.offV.x * cs + c.offV.z * sn;
    const along = c.offV.x * sn - c.offV.z * cs;
    const slip = Math.atan2(side, Math.max(1, c.v + along));
    hdg += slip;
    // The turn that makes: how fast the slip angle is changing, plus the path's own.
    if (dt > 0) turn += wrapPi(slip - (c.slip || 0)) / dt;
    c.slip = slip;
  } else c.slip = 0;
  c.hdg = hdg;

  // Bank from the rate of turn at this speed: the path's and the step aside's.
  const k = dt > 0 ? Math.min(1, dt * 2.2) : 1;
  const bankT = ground ? 0 : clamp(Math.atan((c.v * turn) / G), -perf.bankMax * 1.25, perf.bankMax * 1.25);
  c.bank += (bankT - c.bank) * k;

  // Pitch: on the ground, its sitting attitude — rotated at Vr on the take-off
  // run; in the air, the climb angle plus the angle of attack its speed needs.
  let pitchT;
  if (ground) {
    pitchT = perf.groundPitch;
    if (L.kind === 'takeoff' && c.s >= L.sRot) pitchT = Math.max(pitchT, 8 * DEG);
    else if (L.kind === 'approach' && c.s >= L.sTD && c.s < L.sTD + c.v * 2.5) pitchT = c.pitch; // hold the flare attitude as the mains touch
  } else {
    const alpha = clamp(perf.alphaApp * (perf.vapp / Math.max(c.v, 1)) ** 2, 0.5 * DEG, 13 * DEG);
    pitchT = Math.atan(S.grad) + alpha;
  }
  const kp = dt > 0 ? Math.min(1, dt * (ground ? 1.6 : 1.4)) : 1;
  c.pitch += (pitchT - c.pitch) * kp;

  // Vertical speed, for the published entry.
  if (dt > 0) c.vy = (c.y - py) / dt;
  c.lastX = px;
  c.lastZ = pz;
  // Kept for the drawing pass, which runs after every craft has moved and so
  // cannot read the shared sample.
  c.kappa = S.kappa;
  c.grad = S.grad;
}

/**
 * Step aside for the player (and for each other) in the air.
 *
 * Each frame: where will the two of us be closest over the next twenty
 * seconds, and how close? If that is inside SEP_WANT, push this aeroplane's
 * offset away along the miss vector — sideways and a little vertically —
 * harder the closer and sooner it is. With nothing near, the offset drifts
 * back to zero and it rejoins its path. On final, stepping aside is the wrong
 * answer: approachChecks() goes around instead.
 */
/** Scratch for evade(): the push being summed, and this craft's heading. */
const EV = { x: 0, y: 0, z: 0, threat: false, hdg: 0 };

/** Scratch for closestOnPath(): when, how close, and the miss vector (from them to us). */
const CL = { t: 0, m: 0, now: 0, mx: 0, my: 0, mz: 0 };

/** Scratch for closestOnPath(): a sample of the path and its own cursor. */
const S2 = { x: 0, y: 0, z: 0, hdg: 0, kappa: 0, grad: 0, ground: 0, vmax: 0 };
const CUR2 = { i: 0 };

/**
 * Where will this craft, following its own path, and another at (ox, oy, oz)
 * flying straight on at (ovx, ovy, ovz) be closest over the next
 * EVADE_HORIZON seconds, a second at a time? Written into CL. Returns false,
 * and writes nothing useful, beyond 4 km.
 *
 * Straight-line prediction is wrong exactly when it matters most. A craft
 * holding at its gate flies a circle, and a circle turning towards you looks
 * like a miss until it is not — the head-on check measured 357 m against an
 * orbiting arrival, where against one flying straight it measured 694 m and
 * more. The path is known; this reads it. Writes CL. No allocation.
 */
function closestOnPath(c, L, ox, oy, oz, ovx, ovy, ovz) {
  const now = Math.hypot(c.x - ox, c.y - oy, c.z - oz);
  if (now > 4000) return false;
  const p = L.path;
  CUR2.i = c.cur.i;
  CL.now = now;
  CL.m = Infinity;
  for (let t = 0; t <= EVADE_HORIZON; t++) {
    p.sample(c.s + c.v * t, CUR2, S2);
    const mx = S2.x + c.off.x - (ox + ovx * t);
    const my = S2.y + c.off.y - (oy + ovy * t);
    const mz = S2.z + c.off.z - (oz + ovz * t);
    const m = Math.hypot(mx, my, mz);
    if (m < CL.m) {
      CL.m = m;
      CL.t = t;
      CL.mx = mx;
      CL.my = my;
      CL.mz = mz;
    }
  }
  return true;
}

/**
 * Add the push from whatever closestOnPath() found, to EV:
 * along the miss vector, harder the closer and sooner, and always with some
 * climb in it — up is the direction every pilot is taught to go, and it is
 * the one a step aside cannot run into a hill with. Down only when the other
 * aeroplane is well above.
 */
function pushFromCL(c, want, weight) {
  const t = CL.t;
  let mx = CL.mx;
  let my = CL.my;
  let mz = CL.mz;
  let m = CL.m;
  const now = CL.now;
  if (m >= want && now >= want) return;
  if (m < 25) {
    // Head on and near enough dead centre that the miss vector is noise:
    // pick a side and keep it — right of our own track.
    mx = Math.cos(EV.hdg);
    mz = Math.sin(EV.hdg);
    my = 0;
    m = 1;
  }
  const up = my < -50 ? -0.45 : 0.45;
  mx /= m;
  my = my / m + up;
  mz /= m;
  const n = Math.hypot(mx, my, mz) || 1;
  // How far inside the wanted distance, sooner mattering more, but never
  // fading to nothing at the far end of the horizon.
  const inside = clamp((want - Math.min(m, now)) / want, 0, 1);
  const soon = clamp(1.6 - t / EVADE_HORIZON, 0.6, 1.6);
  const urgency = inside * soon * weight + (now < SEP_MIN * 1.5 ? 1 : 0);
  EV.x += (mx / n) * urgency;
  EV.y += (my / n) * urgency;
  EV.z += (mz / n) * urgency;
  EV.threat = true;
}

function evade(sim, c, dt, L) {
  const onFinal = L.kind === 'approach' && L.sTD - c.s < 3500;
  EV.x = 0;
  EV.y = 0;
  EV.z = 0;
  EV.threat = false;
  EV.hdg = S.hdg;
  const ctx = T.ctx;
  if (ctx.air && ctx.pos) {
    const pv = ctx.vel || V3.set(0, 0, 0);
    if (closestOnPath(c, L, ctx.pos.x, ctx.pos.y, ctx.pos.z, pv.x, pv.y, pv.z)) pushFromCL(c, SEP_WANT, 1);
    const d = Math.hypot(c.x - ctx.pos.x, c.y - ctx.pos.y, c.z - ctx.pos.z);
    if (d < T.stats.minSepAir) T.stats.minSepAir = d;
  }
  for (const o of T.list) {
    if (o === c || o.onGround || !o.model) continue;
    /*
     * Only one of two steps aside, so they do not both swerve the same way:
     * the one with the higher number — unless the other is on final, which
     * does not step aside at all. The first cut went by the number alone, so
     * an arrival on final with the higher number flew straight through a
     * Tempest holding at its gate beside the final approach course, the
     * Tempest waiting for it to move: 34 m apart at the same height (node
     * harness, six aeroplanes on Kestrel).
     */
    const oFinal = o.leg && o.leg.kind === 'approach' && o.leg.sTD - o.s < 3500;
    if (oFinal !== onFinal) {
      if (onFinal) continue;
    } else if (o.idx > c.idx) continue;
    const ovx = dt > 0 ? (o.x - o.lastX) / dt : 0;
    const ovz = dt > 0 ? (o.z - o.lastZ) / dt : 0;
    // Along its own path, as for the player: an orbiting one is a circle, and
    // a straight-line guess (the first cut's) calls a circle closing on an
    // arrival a miss.
    if (closestOnPath(c, L, o.x, o.y, o.z, ovx, o.vy, ovz)) pushFromCL(c, 350, 0.9);
  }
  // On final, stepping aside is the wrong answer; approachChecks() goes
  // round instead, and any offset left fades out before the runway.
  const threat = EV.threat && !onFinal;
  if (threat) {
    c.threatT = 4;
    // Full speed aside as soon as it matters, in the direction the threats
    // push: as fast sideways as a turn of 35 degrees off its track gives it
    // (70% of its airspeed; it was a flat 60 m/s, faster than a Courier
    // flies), and up or down at up to 30% of it.
    const len = Math.hypot(EV.x, EV.y, EV.z);
    const mag = len > 1e-6 ? clamp(len * 2.5, 0, 1) / len : 0;
    const k = Math.min(1, dt * 4);
    const vSide = Math.min(60, 0.7 * c.v);
    const vUp = Math.min(15, 0.3 * c.v);
    c.offV.x += (EV.x * mag * vSide - c.offV.x) * k;
    c.offV.z += (EV.z * mag * vSide - c.offV.z) * k;
    c.offV.y += (clamp(EV.y * mag * vSide, -vUp, vUp) - c.offV.y) * k;
  } else {
    c.threatT -= dt;
    const back = onFinal ? 12 : c.threatT > 0 ? 0 : 7;
    const len = c.off.length();
    if (len > 0.01 && back > 0) {
      /*
       * Back towards its path at `back` m/s, braking so as to arrive on it
       * rather than stop dead there, and turned on to that from whatever it
       * was doing at no more than DRIFT_ACCEL — about what a 27 degree bank
       * gives. The drift used to be SET: one that turned on to final in the
       * middle of a step aside swung its nose from 35 degrees one side of its
       * track to 18 the other in one frame, and reaching the path stopped
       * the drift, and the nose, dead (the review: snaps of 30-51 degrees
       * as a step aside ended; node check snap, every map chased 20 min at
       * 30 fps: 12 frames over 20 degrees, the worst 51).
       */
      const want = Math.min(back, Math.sqrt(2 * DRIFT_ACCEL * len), len / Math.max(dt, 1e-3)) / len;
      const dx = -c.off.x * want - c.offV.x;
      const dy = -c.off.y * want - c.offV.y;
      const dz = -c.off.z * want - c.offV.z;
      const dv = Math.hypot(dx, dy, dz);
      const g = dv > DRIFT_ACCEL * dt ? (DRIFT_ACCEL * dt) / dv : 1;
      c.offV.x += dx * g;
      c.offV.y += dy * g;
      c.offV.z += dz * g;
    } else if (len <= 0.01) {
      c.off.set(0, 0, 0);
      c.offV.set(0, 0, 0);
    } else {
      c.offV.multiplyScalar(Math.max(0, 1 - dt * 2));
    }
  }
  c.off.x += c.offV.x * dt;
  c.off.z += c.offV.z * dt;
  // Up to a kilometre and a half off its path (it was 900 m on each axis,
  // which a chaser used up in a quarter of a minute), then no further.
  const h = Math.hypot(c.off.x, c.off.z);
  if (h > 1500) {
    c.off.x *= 1500 / h;
    c.off.z *= 1500 / h;
  }
  c.off.y = clamp(c.off.y + c.offV.y * dt, -200, 350);
}

/** On the approach: go around if the player is on the runway or on final ahead. */
function approachChecks(sim, c, L) {
  if (c.s >= L.sGoAroundBy) return;
  const ctx = T.ctx;
  const toTD = L.sTD - c.s;
  /*
   * You on the runway: go round — once it is close enough to matter. The
   * first cut went round from anywhere on the approach, eight kilometres out
   * on the base leg, so a child sitting on the runway for the thirty seconds
   * it takes to find the throttle sent every arrival round the circuit again.
   */
  if ((ctx.onRunway || (ctx.r2Active && T.field.r2Crosses)) && toTD < 2500) {
    goAround(sim, c, 'player');
    return;
  }
  if (ctx.onFinal && ctx.pos) {
    // Only if the player is ahead of us on the same final, or close.
    const d = Math.hypot(ctx.pos.x - c.x, ctx.pos.z - c.z);
    const toRwyPlayer = Math.min(Math.abs(ctx.pos.x - T.field.west), Math.abs(ctx.pos.x - T.field.east));
    if (d < 1500 || toRwyPlayer < toTD) {
      goAround(sim, c, 'player');
      return;
    }
  }
  /*
   * On final it does not step aside (see evade), so anything that will bring
   * you within the separation it wants is a go-around — worked out AHEAD, the
   * same twenty seconds evade() looks. The first cut went round when you were
   * already within 630 m, which head-on at 80 m/s closing is under eight
   * seconds: not enough to climb and turn away and still keep 300 m.
   */
  if (ctx.air && ctx.pos && toTD < 3500) {
    const pv = ctx.vel || V3.set(0, 0, 0);
    if (closestOnPath(c, L, ctx.pos.x, ctx.pos.y, ctx.pos.z, pv.x, pv.y, pv.z) && (CL.m < SEP_WANT || CL.now < SEP_WANT)) {
      goAround(sim, c, 'player-air');
      return;
    }
  }
  /*
   * Not back on the centreline in time: go round. Anything left of a step
   * aside fades out on final at 12 m/s (evade), and whatever is left at
   * touchdown vanishes in one frame when the wheels meet the runway (pose).
   * The first cut never checked it: one chased on to final 450 m off to the
   * side touched down with a 475 m jump (the soak's 'chased' way, OAK; LAX
   * 707 m). So an approach that cannot fade what it has by the go-around
   * point, at four fifths of that rate, is not a stable one, and it goes
   * round the way a pilot would — the offset carrying on over the go-around
   * path and fading there.
   */
  const off = c.off.length();
  if (off > 1 && off > 12 * 0.8 * Math.max(0, L.sGoAroundBy - c.s) / Math.max(c.v, 1)) goAround(sim, c, 'unstable');
}

function goAround(sim, c, why) {
  if (T.runwayOwner === c) T.runwayOwner = null;
  c.onApproach = false;
  c.exitX = null;
  c.goArounds++;
  // Counted for the tests (session totals): all of them, and the ones for
  // still being stepped aside too far to land.
  T.stats.goArounds++;
  if (why === 'unstable') T.stats.unstable++;
  const t0 = performance.now();
  const geo = c.geo || PL.arrivalFor(T.field, c.perf, T.dir, c.layer, c.side);
  // Going round for you in the air: turn away from where you are.
  let away = 0;
  const ctx = T.ctx;
  if (why === 'player-air' && ctx.pos) {
    const right = (ctx.pos.x - c.x) * Math.cos(c.hdg) + (ctx.pos.z - c.z) * Math.sin(c.hdg);
    away = right > 0 ? -1 : 1;
  }
  /*
   * Planned from where its PATH is, and any step aside it has taken carries
   * on over the new path and fades out as it would have. The first cut
   * planned from where it was drawn — path plus step aside — and pose() then
   * added the step aside on top a second time: one that had stepped aside
   * for a child chasing it jumped by the whole offset, up to 1.3 km, in the
   * frame it went around (the review: 40 times in 10 chased runs of 20 min;
   * the soak's 'chased' way: 23 on three maps). Planning from the drawn
   * position and zeroing the offset instead was tried and is worse: one
   * stepped 350 m UP starts the go-around too high to get down to its gate
   * height, and the climb profile drops it 180 m in the next frame.
   */
  const from = { x: c.x - c.off.x, y: c.y - c.off.y, z: c.z - c.off.z, hdg: c.hdg - (c.slip || 0), v: Math.max(c.v, c.perf.vapp) };
  const ga = PL.planGoAround(T.field, c.perf, geo, from, away);
  noteTime(performance.now() - t0, true, 'go-around');
  c.legs.length = 0;
  startLeg(c, ga);
  if (why === 'player' || why === 'player-air') {
    const pl = sim.aircraft && sim.aircraft.pos;
    const near = pl && Math.hypot(pl.x - c.x, pl.z - c.z) < 9000;
    if (near && note(sim, 'goAround', `${c.callsign} is going around — the runway was not clear`, 45)) {
      speak(sim, `${c.spoken}, go around, runway not clear.`);
    }
  }
}

/**
 * Distance along the path to the first thing in the way on the ground, or
 * Infinity. The player on the ground and every other AI aeroplane on the
 * ground are the things; a box test first, then a walk of the path ahead.
 */
function blockedAhead(sim, c, L) {
  const look = Math.max(35, (c.v * c.v) / 7 + c.perf.noseLen + 25);
  c.blockDist = Infinity;
  c.blockedBy = null;
  c.blockCraft = null;
  const ctx = T.ctx;
  const ac = sim.aircraft;
  if (ac && ctx.pos && (ac.onGround || (ac.agl != null && ac.agl < 4)) && sim.mode !== 'drive') {
    blockTest(c, L.path, look, ctx.pos.x, ctx.pos.z, ctx.halfSpan + 0.6, 'player');
  }
  /*
   * The runways. On to 18/36 only with its clearance (r2Gate sets r2Hold
   * when it has not got it): it stops short, off it, and waits there. 09/27's
   * own traffic does not go through the crossing while you use 18/36 —
   * parked on it for half a minute, clear of 09/27, you are not using it
   * (playerContext), and they go past. And nobody lining up goes on to 09/27
   * with you on it.
   */
  if (c.r2Hold) blockRunway2(c, L.path, look, ctx.runway2 ? 'player' : 'runway');
  else if (ctx.r2Active) blockRunway2(c, L.path, look, 'player');
  if (L.kind === 'lineup' && ctx.onRunway) blockRunway1(c, L.path, look);
  for (const o of T.list) {
    if (o === c || !o.onGround) continue;
    const r = o.perf.span * 0.4;
    // Let past a deadlocked neighbour: that one is ignored until it is no
    // longer anywhere on the path ahead.
    if (o === c.passing) {
      if (blockTest(c, L.path, look, o.x, o.z, r, null) === Infinity) c.passing = null;
      continue;
    }
    blockTest(c, L.path, look, o.x, o.z, r, o);
  }
  return c.blockDist;
}

/**
 * Is (ox, oz), radius r, on the next `look` metres of c's path? Returns
 * where to stop short of it (Infinity if it is not in the way) and, if `who`
 * is given, keeps the nearest in c.blockDist / c.blockCraft.
 */
function blockTest(c, p, look, ox, oz, radius, who) {
  if (Math.abs(ox - c.x) > look + radius + 60 || Math.abs(oz - c.z) > look + radius + 60) return Infinity;
  const clear = c.perf.span * 0.4 + radius;
  const s0 = c.s;
  let i = c.cur.i;
  while (i < p.n - 1 && p.s[i] < s0) i++;
  for (; i < p.n; i++) {
    const ds = p.s[i] - s0;
    if (ds > look) break;
    const dx = p.x[i] - ox;
    const dz = p.z[i] - oz;
    if (dx * dx + dz * dz < clear * clear) {
      // Its nose as drawn (perf.noseLen: 31 m on a 747, not the shape's 22).
      const stopAt = ds - c.perf.noseLen - radius * 0.5 - 4;
      if (who && stopAt < c.blockDist) {
        c.blockDist = stopAt;
        c.blockedBy = who === 'player' ? 'player' : who.callsign || 'traffic';
        c.blockCraft = who;
      }
      return stopAt;
    }
  }
  return Infinity;
}

/**
 * Stop short of the crosswind runway: while the player is using it — or for
 * `who` 'runway', while it is not cleared on to it.
 */
function blockRunway2(c, p, look, who) {
  // Already on it: carry on off it.
  const m = r2Margin(c.perf);
  if (isOnRunway2(c.x, c.z, m)) return;
  const s0 = c.s;
  let i = c.cur.i;
  while (i < p.n - 1 && p.s[i] < s0) i++;
  for (; i < p.n; i++) {
    const ds = p.s[i] - s0;
    if (ds > look) break;
    if (isOnRunway2(p.x[i], p.z[i], m)) {
      const stopAt = ds - c.perf.noseLen - 4;
      if (stopAt < c.blockDist) {
        c.blockDist = stopAt;
        c.blockedBy = who === 'player' ? 'player' : 'the crosswind runway';
        c.blockCraft = who;
      }
      return;
    }
  }
}

/** Stop short of the main runway, the player being on it (see blockedAhead). */
function blockRunway1(c, p, look) {
  const m = c.perf.span / 2 + 5;
  if (isOnRunway(c.x, c.z, m)) return;
  const s0 = c.s;
  let i = c.cur.i;
  while (i < p.n - 1 && p.s[i] < s0) i++;
  for (; i < p.n; i++) {
    const ds = p.s[i] - s0;
    if (ds > look) break;
    if (isOnRunway(p.x[i], p.z[i], m)) {
      const stopAt = ds - c.perf.noseLen - 4;
      if (stopAt < c.blockDist) {
        c.blockDist = stopAt;
        c.blockedBy = 'player';
        c.blockCraft = 'player';
      }
      return;
    }
  }
}

/** Engine note, gear and flaps: what the model animates from. */
function engineAndGear(c, dt) {
  const L = c.leg;
  const kind = L ? L.kind : c.state;
  let rpmT = 0;
  if (c.state === 'parked') rpmT = 0;
  else if (c.state === 'startup') rpmT = 0.28;
  else if (c.state === 'shutdown') rpmT = 0;
  else if (c.state === 'waiting') rpmT = 0.3;
  else if (kind === 'takeoff') rpmT = c.holdT > 0 ? 0.55 : c.y > T.field.elev + 150 ? 0.85 : 1;
  else if (kind === 'go-around') rpmT = 0.95;
  else if (kind === 'approach') rpmT = c.onGround ? 0.22 : c.phase === 'landing' ? 0.38 : 0.5;
  else if (kind === 'route' || kind === 'orbit') rpmT = (c.grad || 0) < -0.02 ? 0.45 : 0.7;
  // Shut down before the tug pushes it in: nobody runs engines in a hangar.
  else if (kind === 'push-in') rpmT = 0;
  else rpmT = 0.3 + Math.min(0.15, c.v * 0.02);
  const kr = Math.min(1, dt * (c.state === 'startup' ? 0.6 : 0.9));
  c.rpm += (rpmT - c.rpm) * kr;
  if (c.state === 'shutdown' && c.rpm < 0.03) c.engineOn = false;

  // Gear: up once climbing away, down on the base leg and for anything below
  // 300 m that is heading for the runway. Six seconds to cycle.
  const retract = !!(c.type.shape && c.type.shape.retractable);
  let gearT = 1;
  if (retract && !c.onGround) {
    if (kind === 'takeoff') gearT = c.phase === 'climb' && c.s > (L.sLift || 0) + 250 ? 0 : 1;
    else if (kind === 'route') gearT = L.path.length - c.s < 2500 ? 1 : 0;
    else if (kind === 'orbit') gearT = 0;
    else if (kind === 'go-around') gearT = c.s > 400 ? 0 : 1;
  }
  c.gear += clamp(gearT - c.gear, -dt / 6, dt / 6);

  let flapT = 0;
  if (kind === 'takeoff') flapT = c.phase === 'climb' && c.s > (L.sLift || 0) + 500 ? 0 : 0.3;
  else if (kind === 'approach') flapT = c.phase === 'approach' ? 0.5 : 1;
  else if (kind === 'go-around') flapT = c.s < 600 ? 0.5 : 0;
  else if (kind === 'lineup') flapT = 0.3;
  c.flaps += clamp(flapT - c.flaps, -dt / 4, dt / 4);
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

/**
 * The group our meshes go in. Normally the one buildWorld() handed us, which
 * the world teardown disposes. If this module was registered after the world
 * was built — imported late, from the console or a test — there is none yet,
 * and nothing would ever be drawn; so make one on the scene, and hand it
 * over to the teardown's group at the next world build.
 */
function worldGroup() {
  if (T.group) return T.group;
  const sim = T.sim;
  if (!sim || !sim.scene) return null;
  const g = new THREE.Group();
  g.name = 'ext:traffic (late)';
  sim.scene.add(g);
  T.group = g;
  T.lateGroup = g;
  return g;
}

function ensureModel(c) {
  if (c.model || c.modelFailed || T.builtThisFrame || !worldGroup()) return;
  T.builtThisFrame = true;
  const t0 = performance.now();
  try {
    const m = createAircraftModel({ type: c.type, livery: c.scheme });
    /*
     * Take the landing light out. Each model carries a real SpotLight, and
     * every extra light in the scene is another loop in every lit shader on
     * screen — four of them roughly doubled the terrain's fragment cost on
     * the class's Chromebooks. The glow sprites that make the lights visible
     * stay; only the light that would illuminate the runway goes.
     */
    const lights = [];
    m.traverse((o) => {
      if (o.isLight) lights.push(o);
    });
    for (const l of lights) if (l.parent) l.parent.remove(l);
    c.rideOffset = m.userData.fleetBridge ? groundOffsetFor(m, specFor(c.type.id)) : 0;
    /*
     * Fewer draw calls: the parts that never move baked into one mesh per
     * material, and the small ones hidden at range — see ./traffic/lod.js.
     * Not the fleet pack's aeroplanes: their crash code breaks them up by
     * the part, and a baked part cannot come off. Measured on Kestrel with
     * a Meridian, a Courier and a Skylark: 140 meshes to 85.
     */
    const probe = LOD.probeMotion(m, THREE);
    if (!m.userData.fleetBridge) {
      const merged = LOD.mergeStatic(m, THREE, probe);
      T.stats.meshesSaved += merged.before - merged.after;
    }
    c.small = LOD.smallParts(m, THREE, probe.shownBySelf);
    c.detail = 0;
    c.meshes = [];
    m.traverse((o) => {
      if (o.isMesh) c.meshes.push(o);
    });
    c.shadows = null;
    m.name = `traffic:${c.id}`;
    T.group.add(m);
    c.model = m;
    c.ac.pos = m.position;
    c.ac.quat = m.quaternion;
  } catch (e) {
    c.modelFailed = true;
    console.warn(`[traffic] could not build a ${c.type.id}; that one flies unseen.`, e);
  }
  noteTime(performance.now() - t0, true, 'model');
}

/**
 * Build every model now, while the flight is starting.
 *
 * Measured, building one is the most expensive thing the traffic does — 4 to
 * 12 ms on the development Mac, so three or four times that on a Chromebook —
 * and built lazily, one a frame, that was a hitch a few seconds into every
 * flight. The start of a flight already stops for the world; nobody sees it
 * there. Aeroplanes added later from the Dev panel still build lazily.
 */
function prebuildModels(sim) {
  const cam = sim.camera ? sim.camera.position : V1.set(0, 0, 0);
  for (const c of T.list) {
    T.builtThisFrame = false;
    ensureModel(c);
    // Where it is, before anything is drawn.
    if (c.model) drawCraft(sim, c, 0, cam);
  }
  T.builtThisFrame = false;
}

function setShadows(c, on) {
  if (c.shadows === on) return;
  c.shadows = on;
  for (const m of c.meshes) m.castShadow = on;
}

/** Write the craft's pose into its model, and animate it. */
function drawCraft(sim, c, dt, camPos) {
  const m = c.model;
  const dx = c.x - camPos.x;
  const dy = c.y - camPos.y;
  const dz = c.z - camPos.z;
  const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
  c.dist = dist;
  if (!m) return;
  const near = dist < LOD_FAR;
  m.visible = near;
  if (!near) return;
  setShadows(c, dist < SHADOW_NEAR);
  const tier = dist < DETAIL_NEAR ? 0 : dist < DETAIL_FAR ? 1 : 2;
  if (c.detail !== tier && c.small) {
    c.detail = tier;
    LOD.showParts(c.small, tier === 0 ? 0 : tier === 1 ? 0.9 : 2.5);
  }
  // Wheels on the ground: the origin sits above the lowest wheel by however
  // far that wheel is below it at this pitch.
  const g = c.perf.gear;
  const cp = Math.cos(c.pitch);
  const sp = Math.sin(c.pitch);
  const low = Math.min(g.noseY * cp - g.noseZ * sp, g.mainY * cp - g.mainZ * sp);
  m.position.set(c.x, c.y - low + c.rideOffset, c.z);
  EUL.set(c.pitch, -c.hdg, -c.bank, 'YXZ');
  m.quaternion.setFromEuler(EUL);

  const a = c.ac;
  const ctl = a.controls;
  const L = c.leg;
  const reverse = L && L.reverse;
  ctl.pitch = 0;
  ctl.roll = clamp((c.bank - (c._bankPrev || 0)) * 8, -1, 1);
  c._bankPrev = c.bank;
  ctl.yaw = c.onGround ? clamp((c.kappa || 0) * 10 * (reverse ? -1 : 1), -1, 1) : 0;
  ctl.throttle = c.rpm;
  ctl.brakes = c.onGround && c.v < 0.5 ? 1 : 0;
  a.rpm = c.engineOn ? c.rpm : Math.min(c.rpm, 0.04);
  a.flaps = c.flaps;
  a.gearPos = c.gear;
  a.gearDown = c.gear > 0.5;
  a.onGround = c.onGround;
  a.groundSpeed = reverse ? -c.v : c.v;
  a.alt = c.y;
  a.agl = c.onGround ? 0 : Math.max(0, c.y - T.field.elev);
  a.engineOn = c.engineOn;
  a.vel.set(Math.sin(c.hdg) * c.v, c.vy, -Math.cos(c.hdg) * c.v);
  if (m.userData.update) m.userData.update(dt, a, sim.weather);
}

/** The per-craft name tag: a sprite, so it sits in the 3D view under the menus. */
function tagFor(c) {
  if (c.tag) return c.tag;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, sizeAttenuation: false, fog: false });
  const sp = new THREE.Sprite(mat);
  // Screen-sized (sizeAttenuation off): about 5% of the view's height.
  sp.scale.set(0.22, 0.055, 1);
  sp.center.set(0.5, 0);
  sp.renderOrder = 10;
  sp.userData.canvas = canvas;
  c.tag = sp;
  const g = worldGroup();
  if (g) g.add(sp);
  return sp;
}

function paintTag(c) {
  const text = `${c.callsign}|${c.activity}`;
  if (c.tagText === text) return;
  c.tagText = text;
  const sp = tagFor(c);
  const cv = sp.userData.canvas;
  const g = cv.getContext('2d');
  if (!g || !g.clearRect) return;
  g.clearRect(0, 0, 256, 64);
  g.textAlign = 'center';
  g.lineJoin = 'round';
  g.font = '700 26px "Helvetica Neue", Arial, sans-serif';
  g.lineWidth = 5;
  g.strokeStyle = 'rgba(8, 14, 24, 0.75)';
  g.fillStyle = '#ffe89a';
  g.strokeText(c.callsign, 128, 27);
  g.fillText(c.callsign, 128, 27);
  g.font = '500 20px "Helvetica Neue", Arial, sans-serif';
  g.fillStyle = '#eef3f8';
  g.strokeText(c.activity, 128, 54);
  g.fillText(c.activity, 128, 54);
  sp.material.map.needsUpdate = true;
}

function drawTag(c) {
  const show = T.tags && c.model && c.model.visible && c.dist > TAG_NEAR && c.dist < TAG_FAR && T.watch < 0;
  if (!show) {
    if (c.tag) c.tag.visible = false;
    return;
  }
  paintTag(c);
  const sp = c.tag;
  sp.visible = true;
  sp.position.set(c.x, c.y + c.perf.span * 0.15 + 2.5, c.z);
  // Fade out towards the far end so it does not pop.
  sp.material.opacity = clamp((TAG_FAR - c.dist) / 600, 0, 1);
}

function ensureDots() {
  if (T.dots) return;
  const g = worldGroup();
  if (!g) return;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_AIRCRAFT * 3), 3));
  geo.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({ color: 0xf4f6fa, size: 3, sizeAttenuation: false, fog: true, depthWrite: false });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.name = 'traffic:dots';
  g.add(pts);
  T.dots = pts;
  T.dotsNight = null;
}

function drawDots(sim) {
  if (!T.dots) return;
  /*
   * By day a far-off aeroplane is a glint that fades into the haze like
   * everything else; by night it is its lights, and lights carry through
   * the murk that swallows the land. So the fog is switched off after dark.
   */
  const night = !!(sim.weather && sim.weather.isNight);
  if (T.dotsNight !== night) {
    T.dotsNight = night;
    const m = T.dots.material;
    m.fog = !night;
    m.color.setHex(night ? 0xffe2a8 : 0xf4f6fa);
    m.size = night ? 3.5 : 3;
    m.needsUpdate = true;
  }
  const arr = T.dots.geometry.attributes.position.array;
  let n = 0;
  for (const c of T.list) {
    if (n >= MAX_AIRCRAFT) break;
    if (c.model && c.model.visible) continue;
    if (c.onGround) continue;
    arr[n * 3] = c.x;
    arr[n * 3 + 1] = c.y;
    arr[n * 3 + 2] = c.z;
    n++;
  }
  T.dots.geometry.setDrawRange(0, n);
  T.dots.geometry.attributes.position.needsUpdate = n > 0;
  T.dots.visible = n > 0;
}

/* ------------------------------------------------------------------ */
/* Publishing                                                          */
/* ------------------------------------------------------------------ */

function rebuildPub() {
  T.pub.length = 0;
  for (const c of T.list) T.pub.push(c.pub);
}

function publish(sim) {
  for (const c of T.list) {
    const u = c.pub;
    u.pos.set(c.x, c.y, c.z);
    u.heading = ((c.hdg / DEG) % 360 + 360) % 360;
    u.speed = c.v;
    u.vel.set(Math.sin(c.hdg) * c.v, c.vy, -Math.cos(c.hdg) * c.v);
    // In the sky's list from its first published frame (sky.js reads bodyName, so `name` stays the type's).
    if (!u.__sky) registerBody(u);
    u.alt = c.y;
    u.agl = c.onGround ? 0 : Math.max(0, c.y - (T.field ? T.field.elev : 0));
    u.vs = c.vy;
    u.onGround = c.onGround;
    u.gearDown = c.gear > 0.5;
    u.phase = c.phase;
    u.activity = c.activity;
  }
  /*
   * main.js also writes sim.traffic — the pursuers in the chase mission and
   * the two aeroplanes that come up to sit with you in a brace. Theirs wins
   * while it has anything in it; ours is put back when they empty it.
   */
  const cur = sim.traffic;
  if (!cur || cur === T.pub || cur.length === 0) sim.traffic = T.pub;
}

/* ------------------------------------------------------------------ */
/* Talking                                                             */
/* ------------------------------------------------------------------ */

function note(sim, key, text, cooldown) {
  const now = performance.now() / 1000;
  if (now < (T.notes[key] || 0)) return false;
  T.notes[key] = now + cooldown;
  if (sim.hud && sim.hud.notify) sim.hud.notify(text, 'info', 4);
  return true;
}

/** The one voice for the nearest traffic engine (./traffic/sound.js), and its reused argument. */
const SOUND = new TrafficSound();
const HEAR = { dist: 0, rpm: 0, jet: false };

/** Let the nearest aeroplane with its engine running, within a kilometre of the camera, be heard. */
function hear(sim) {
  const audio = sim.audio;
  if (!audio || !audio.available) return;
  let best = null;
  for (const c of T.list) {
    if (!c.engineOn || !(c.dist < 1000)) continue;
    if (!best || c.dist < best.dist) best = c;
  }
  try {
    if (best) {
      HEAR.dist = best.dist;
      HEAR.rpm = best.rpm;
      const pw = best.type.shape && best.type.shape.power;
      HEAR.jet = !!(pw && pw.kind === 'jet');
    }
    SOUND.update(audio.mixer, best ? HEAR : null, T.time);
  } catch (e) {
    /* the sound is decoration: never the reason the traffic stops */
  }
}

function speak(sim, text) {
  // The game's own radio: formant chatter and a subtitle unless the player
  // chose speech. Never the browser's voice by default.
  try {
    if (typeof sim.speak === 'function') sim.speak(text, 'tower', 0);
  } catch (e) {
    /* the radio is decoration here */
  }
}

/**
 * R4, the tower: you on a runway, on the ground, and an aeroplane on that
 * runway ahead of your nose — "Hold position — an aeroplane is on the
 * runway ahead", on the screen and on the radio (the game's own voice and
 * subtitle, sim.speak 'tower'). Said once it has been there for half a
 * second, again once if you start rolling anyway, and "Runway clear" when
 * it has been gone for a second and a half. The rules keep the traffic out
 * of your way; this is so a child who does what the tower says never has
 * to find out whether they did.
 */
function towerWatch(sim) {
  const ctx = T.ctx;
  const W = T.tower;
  const f = T.field;
  let pm = null;
  let k = 0;
  const ac = sim.aircraft;
  if (ac && ac.onGround && !ac.crashed && ctx.pmG.on) {
    if (ctx.pm1.on) {
      pm = ctx.pm1;
      k = 1;
    } else if (ctx.pm2.on && ctx.pm2.delay === 0) {
      pm = ctx.pm2;
      k = 2;
    }
  }
  let who = null;
  if (pm) {
    const hw = k === 1 ? f.halfWidth : AIRPORT.runway2 ? AIRPORT.runway2.halfWidth : 15;
    let best = Infinity;
    for (const o of T.list) {
      if (!o.onGround || !onRunwayK(k, o.x, o.z, o.perf.span / 2)) continue;
      const rx = o.x - pm.x;
      const rz = o.z - pm.z;
      const along = rx * pm.ux + rz * pm.uz;
      const lat = Math.abs(-rx * pm.uz + rz * pm.ux);
      if (along > 0 && lat < hw + o.perf.span / 2 + pm.halfSpan && along < best) {
        best = along;
        who = o;
      }
    }
  }
  const now = T.time;
  if (who) {
    W.clearSince = null;
    if (W.seenSince == null) W.seenSince = now;
    const rolling = pm.v > 4;
    if (!W.on && now - W.seenSince >= 0.5) {
      W.on = true;
      W.who = who.id;
      W.rollSaid = rolling;
      towerSay(sim, 'hold');
    } else if (W.on && rolling && !W.rollSaid && now - W.saidAt > 5) {
      W.rollSaid = true;
      towerSay(sim, 'hold');
    }
  } else if (!pm) {
    // Off the runway, or off the ground: nothing to say.
    W.seenSince = null;
    W.clearSince = null;
    W.on = false;
    W.who = null;
  } else {
    W.seenSince = null;
    if (W.on) {
      if (W.clearSince == null) W.clearSince = now;
      if (now - W.clearSince >= 1.5) {
        W.on = false;
        W.who = null;
        towerSay(sim, 'clear');
      }
    }
  }
}

/** The tower's two sentences (R4). */
function towerSay(sim, what) {
  const W = T.tower;
  W.saidAt = T.time;
  if (what === 'hold') {
    T.stats.towerHold++;
    if (sim.hud && sim.hud.notify) sim.hud.notify('Hold position — an aeroplane is on the runway ahead', 'warn', 5);
    speak(sim, 'Hold position. There is an aeroplane on the runway ahead of you.');
  } else {
    T.stats.towerClear++;
    if (sim.hud && sim.hud.notify) sim.hud.notify('Runway clear', 'info', 3);
    speak(sim, 'Runway clear.');
  }
}

function playerNearField(sim, within) {
  const pl = sim.aircraft && sim.aircraft.pos;
  if (!pl || !T.field) return false;
  const dx = Math.max(0, Math.abs(pl.x - T.field.cx) - T.field.length / 2);
  return Math.hypot(dx, pl.z - T.field.cz) < within;
}

function announceDeparture(sim, c) {
  if (!playerNearField(sim, 2500)) return;
  const rw = runwayFor(T.field, T.dir);
  note(sim, 'depart', `${c.callsign} is lining up on runway ${rw.name}`, 90);
}

function announceLanding(sim, c) {
  const ac = sim.aircraft;
  if (!ac || !ac.onGround || !playerNearField(sim, 2000)) return;
  const rw = runwayFor(T.field, T.dir);
  const words = rw.name.split('').map((d) => DIGITS[+d]).join(' ');
  if (note(sim, 'land', `${c.callsign} is coming in to land on runway ${rw.name}`, 100)) {
    speak(sim, `${c.spoken}, runway ${words}, cleared to land.`);
  }
}

/* ------------------------------------------------------------------ */
/* Lifecycle                                                           */
/* ------------------------------------------------------------------ */

/**
 * Take an object out of the scene and free what it holds on the GPU —
 * except anything in `keep`, which is everything still in use elsewhere.
 *
 * The model factories share textures (and some materials) through caches —
 * src/fleet/common.js paintTexture(), src/render/textures.js — so the parked
 * aeroplanes on the apron and the player's own can be using the very texture
 * a traffic model was. The first cut kept only the player's aeroplane's, so
 * clearing the traffic freed the apron's textures and they were uploaded to
 * the GPU again on the next frame. Now `keep` is everything the rest of the
 * scene uses (see sceneResources), taken after our models are out of it.
 */
function disposeObject(obj, keep) {
  if (!obj) return;
  if (obj.parent) obj.parent.remove(obj);
  if (obj.userData && typeof obj.userData.dispose === 'function') {
    try {
      obj.userData.dispose();
    } catch (e) {
      /* the pack's own clean-up; ours below still runs */
    }
  }
  obj.traverse((o) => {
    if (o.geometry && !keep.has(o.geometry)) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const mat of mats) {
      if (keep.has(mat)) continue;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap']) {
        const t = mat[k];
        if (t && t.isTexture && !keep.has(t)) t.dispose();
      }
      mat.dispose();
    }
  });
}

function disposeCraft(c, keep) {
  if (c.home && c.home.owner === c.id) c.home.owner = null;
  if (T.runwayOwner === c) T.runwayOwner = null;
  disposeObject(c.model, keep);
  disposeObject(c.tag, keep);
  c.model = null;
  c.tag = null;
}

/**
 * Every geometry, material and texture the rest of the scene is using — the
 * player's aeroplane, the apron's parked ones, the world — which must survive
 * our clean-up. Call it with our own models already taken out of the scene.
 * A walk of the scene graph: only ever on the way back to the menu, on a
 * Dev "clear", or at a world build.
 */
function sceneResources(sim) {
  const keep = new Set();
  const add = (root) => {
    if (!root || !root.traverse) return;
    root.traverse((o) => {
      if (o.geometry) keep.add(o.geometry);
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mat of mats) {
        keep.add(mat);
        for (const k in mat) {
          const t = mat[k];
          if (t && t.isTexture) keep.add(t);
        }
      }
    });
  };
  if (sim) {
    add(sim.scene);
    // The player's aeroplane, in case it is not in the scene just now.
    if (sim.model && !keep.has(sim.model)) add(sim.model);
  }
  return keep;
}

function clearAll(sim, dispose = true) {
  if (dispose) {
    // Out of the scene first, so what is left is what must be kept.
    for (const c of T.list) {
      if (c.model && c.model.parent) c.model.parent.remove(c.model);
      if (c.tag && c.tag.parent) c.tag.parent.remove(c.tag);
    }
  }
  const keep = dispose ? sceneResources(sim) : null;
  for (const c of T.list) {
    if (dispose) disposeCraft(c, keep);
    else if (c.home && c.home.owner === c.id) c.home.owner = null;
    unregisterBody(c.pub);
  }
  T.list.length = 0;
  T.runwayOwner = null;
  T.watch = -1;
  Object.assign(T.tower, { on: false, who: null, seenSince: null, clearSince: null, rollSaid: false });
  rebuildPub();
  if (T.dots) {
    T.dots.geometry.setDrawRange(0, 0);
    T.dots.visible = false;
  }
  if (sim && sim.traffic === T.pub) sim.traffic = T.pub;
}

/** Time spent planning or building, and the single slowest — named, so a spike can be traced. */
function noteTime(ms, planning = false, what = '') {
  if (!planning) return;
  const st = T.stats;
  st.planMs += ms;
  if (ms > st.planMsMax) {
    st.planMsMax = ms;
    st.slowest = what;
  }
}

/** Should traffic run in this mode? */
/**
 * NOT FINISHED, so Dev mode only for now (the owner's call for the release:
 * "anything not finished goes to dev mode"). Its last runway check still found
 * AI aeroplanes rolling out or lining up on a runway the player is using. Outside
 * Dev mode nothing starts unless a caller asks for it outright (the tests do).
 */
function devOn(sim) {
  try { return Prog.isDev((sim.menus && sim.menus.prog) || Prog.load()); } catch (e) { return false; }
}

function wantedFor(sim, mode, opts) {
  if (opts && opts.traffic === true) return true;
  if (!devOn(sim)) return false;
  if (mode === 'free') {
    if (opts && opts.traffic === false) return false;
    if (sim.settings && sim.settings.traffic === false) return false;
    return true;
  }
  if (mode === 'mission') {
    const def = sim.runner && sim.runner.def;
    return !!(def && def.traffic);
  }
  return false;
}

function start(sim, opts) {
  // A test may ask for the same mix and the same timings every run.
  const seed = opts && Number.isFinite(opts.trafficSeed) ? opts.trafficSeed : Date.now() ^ 0x5bd1e995;
  T.rand = rng(seed >>> 0);
  if (!T.field || T.fieldKey !== fieldKeyNow()) refreshField();
  if (!T.field.ok) {
    T.on = false;
    return 0;
  }
  T.on = true;
  T.why = 'running';
  const n = populate(sim);
  if (!n) T.on = false;
  return n;
}

/* ------------------------------------------------------------------ */
/* Dev-mode actions and the API the browser check uses                 */
/* ------------------------------------------------------------------ */

/**
 * Add one aeroplane. `how` is 'depart' (on a slot, leaving at once) or
 * 'arrive' (a couple of kilometres out, coming in to land).
 */
export function spawnTraffic(sim, how = 'depart', typeId = null) {
  if (!sim || sim.state === 'menu') {
    T.pending = how;
    return { ok: false, why: 'will appear when you next fly' };
  }
  if (!T.field || T.fieldKey !== fieldKeyNow()) refreshField();
  if (!T.field.ok) return { ok: false, why: T.field.why };
  if (T.list.length >= MAX_AIRCRAFT) return { ok: false, why: `already ${MAX_AIRCRAFT} aeroplanes` };
  // Where you are NOW: with no traffic about, the frame skips working it out,
  // and an arrival added on to final while you sat on the runway was cleared
  // to land on you and went round a moment later.
  T.sim = sim;
  playerContext(sim);
  if (!T.on) {
    T.on = true;
    T.dir = chooseDir(sim, T.field, PL.typesFor(T.field));
  }
  const pool = poolTypes();
  if (!pool.length) return { ok: false, why: 'no aeroplane can use this runway' };
  /*
   * Something that has somewhere to park, and something not already flying
   * if there is a choice. The first cut picked the type first and the slot
   * after, so on Kestrel with a Skylark, a Courier and a Tempest out the
   * fourth press chose a Meridian, found nowhere 29 m wide free, and added
   * nothing — while the 20 m stand it could have given a Courier sat empty.
   */
  const flying = new Set(T.list.map((c) => c.type.id));
  // A check may ask for one type: the jumbo at a big field, say.
  const parkable = pool.filter((t) => {
    if (typeId && t.id !== typeId) return false;
    const p = PL.perfFor(t);
    return !!freeSlot(p, p.cat === 'light' ? 'hangar' : 'stand');
  });
  if (!parkable.length) {
    return { ok: false, why: typeId ? `no ${typeId} can fly from here or park here` : 'nowhere free to park — clear the traffic first' };
  }
  const fresh = parkable.filter((t) => !flying.has(t.id));
  const choose = fresh.length ? fresh : parkable;
  const type = choose[Math.floor(T.rand() * choose.length)];
  const perf = PL.perfFor(type);
  const home = freeSlot(perf, perf.cat === 'light' ? 'hangar' : 'stand');
  const idx = [0, 1, 2, 3, 4, 5].find((i) => !T.list.some((c) => c.idx === i)) ?? T.list.length;
  const c = makeCraft(type, idx, home);
  T.list.push(c);
  rebuildPub();
  if (how === 'arrive') {
    const field = T.field;
    c.geo = PL.arrivalFor(field, perf, T.dir, c.layer, c.side);
    c.engineOn = true;
    c.rpm = 0.6;
    c.gear = 1;
    c.onGround = false;
    c.state = 'moving';
    /*
     * Straight on to the final approach, about two and a half kilometres out,
     * so the button shows a landing within a minute or two — the first cut
     * put it on the downwind leg and it took 2 min 40 s to touch down. If the
     * runway is not free it holds at the gate like anyone else.
     */
    const someoneOnFinal = T.list.some((o) => o !== c && o.onApproach);
    const app = !T.ctx.playerUsingRunway && !someoneOnFinal ? planArrival(c) : null;
    if (app && app.ok) {
      const leg = app.legs[0];
      const s0 = Math.max(0, leg.sTD - 2500);
      startLeg(c, leg, s0);
      c.exitX = app.exit;
      c.v = leg.path.vmax[leg.path.indexAt(s0)];
    } else {
      startLeg(c, PL.planOrbit(field, perf, c.geo));
      c.v = perf.vGate;
    }
    // Place it now, so it is somewhere sensible before its first frame.
    pose(sim, c, 0);
  } else {
    parkAt(c, 2);
  }
  /*
   * Its model built now, in the frame the button was pressed, rather than
   * lazily in some flying frame after it: measured 10-28 ms on the
   * development Mac, a visible hitch wherever it lands, and here it lands
   * on a click.
   */
  T.builtThisFrame = false;
  ensureModel(c);
  if (c.model && sim.camera) drawCraft(sim, c, 0, sim.camera.position);
  T.builtThisFrame = true;
  return { ok: true, id: c.id, type: type.id, callsign: c.callsign };
}

/**
 * The Dev button's fallback when there is nowhere free to park another: the
 * parked one due out soonest starts up now. On Kestrel at the default 'high'
 * graphics the airport's six parked aeroplanes and the three traffic fill
 * every stand, and the first cut's button said "nowhere free to park" on
 * every press and did nothing (the review). Returns the craft, or null if
 * none is parked.
 */
export function startNextParked(sim) {
  let best = null;
  for (const c of T.list) if (c.state === 'parked' && (!best || c.timer < best.timer)) best = c;
  if (!best) return null;
  best.timer = 0;
  return { id: best.id, type: best.type.id, callsign: best.callsign };
}

export function clearTraffic(sim) {
  clearAll(sim, true);
  T.on = false;
  T.pending = null;
  T.why = 'cleared';
}

/** For the browser check and the console: a snapshot of everything. */
export function trafficState() {
  return {
    on: T.on,
    why: T.why,
    dir: T.dir,
    field: T.field
      ? {
          ok: T.field.ok,
          why: T.field.why || null,
          layout: T.field.layout || null,
          slots: (T.field.slots || []).map((s) => ({ id: s.id, kind: s.kind, nose: s.nose, x: s.x, z: s.z, headingDeg: s.headingDeg, owner: s.owner })),
          rejectedSlots: T.field.rejectedSlots || [],
          slotSource: T.field.slotSource,
        }
      : null,
    runwayOwner: T.runwayOwner ? T.runwayOwner.id : null,
    // What the traffic thinks you are doing, for the checks and the console.
    player: {
      onRunway: T.ctx.onRunway,
      onFinal: T.ctx.onFinal,
      climbOut: T.ctx.climbOut,
      taxiing: T.ctx.taxiing,
      runway2: T.ctx.runway2,
      runway2Parked: T.ctx.r2Parked,
      usingRunway: T.ctx.playerUsingRunway,
    },
    stats: { ...T.stats },
    // R4: the tower's "hold position" is being said now, and for whom.
    tower: { on: T.tower.on, who: T.tower.who },
    craft: T.list.map((c) => ({
      id: c.id,
      type: c.type.id,
      callsign: c.callsign,
      state: c.state,
      phase: c.phase,
      activity: c.activity,
      leg: c.leg ? c.leg.kind : null,
      s: c.s,
      legLength: c.leg ? c.leg.path.length : 0,
      v: c.v,
      pos: [c.x, c.y, c.z],
      onGround: c.onGround,
      home: c.home ? c.home.id : null,
      goArounds: c.goArounds,
      hasModel: !!c.model,
      // How far it has stepped aside off its path, metres.
      off: [c.off.x, c.off.y, c.off.z],
      // For the node soak: its size, which way it points, and what stopped it.
      span: c.perf.span,
      length: c.perf.length,
      // Nose ahead of and tail behind its middle, as drawn where the roster says.
      noseLen: c.perf.noseLen,
      tailLen: c.perf.tailLen,
      wingY: -c.perf.gear.mainY + 0.6,
      hdgDeg: c.hdg / DEG,
      blockedBy: c.blockedBy || null,
      // Why it is waiting to taxi, the connector it is leaving by, the exit it was given.
      waitWhy: c.state === 'startup' || c.state === 'taxi-wait' ? c.waitWhy || null : null,
      depConn: c.depConn,
      exitX: c.exitX,
    })),
  };
}

/** Test hook: jump a craft's timers so a check does not wait two minutes. */
export function _nudge(id, { timer } = {}) {
  const c = T.list.find((x) => x.id === id);
  if (c && timer != null) c.timer = timer;
  return !!c;
}

function watchNext(sim) {
  if (!T.list.length) {
    T.watch = -1;
    sim.hud && sim.hud.notify('No traffic to watch', 'info', 2.5);
    return;
  }
  T.watch = T.watch + 1 >= T.list.length ? -1 : T.watch + 1;
  if (T.watch >= 0) {
    const c = T.list[T.watch];
    sim.hud && sim.hud.notify(`Watching ${c.callsign} — press the button again for the next one`, 'info', 3);
    T.camInit = false;
  } else {
    sim.hud && sim.hud.notify('Back to your own aeroplane', 'info', 2);
  }
}

/* ------------------------------------------------------------------ */
/* The extension                                                       */
/* ------------------------------------------------------------------ */

T.ctx = {
  pos: null,
  vel: null,
  air: false,
  onRunway: false,
  onFinal: false,
  climbOut: 0,
  playerUsingRunway: false,
  taxiing: false,
  movedAt: -Infinity,
  runway2: false,
  r2Parked: false,
  r2Active: false,
  stillSince: 0,
  seenAt: 0,
  groundStill: false,
  halfSpan: 6,
  // The player as the runway rules see them (playerModels).
  pmG: blankPlayer(),
  pm1: blankPlayer(),
  pm2: blankPlayer(),
};

registerExtension({
  id: 'traffic',

  install(sim) {
    T.sim = sim;
    if (!Array.isArray(sim.traffic)) sim.traffic = T.pub;
  },

  buildWorld(sim, group) {
    // The old group — and every model in it — has just been disposed by the
    // world teardown. Drop our references and rebuild what we need.
    T.sim = sim;
    const mapChanged = T.fieldKey !== fieldKeyNow();
    if (T.lateGroup) {
      // Made by worldGroup() before we had one of our own; the teardown did
      // not know about it, so it is ours to take down.
      const g = T.lateGroup;
      T.lateGroup = null;
      if (g.parent) g.parent.remove(g);
      const keep = sceneResources(sim);
      for (const o of [...g.children]) disposeObject(o, keep);
    }
    T.group = group;
    T.dots = null;
    for (const c of T.list) {
      c.model = null;
      c.tag = null;
      c.tagText = '';
      c.modelFailed = false;
      c.small = null;
      c.meshes = [];
    }
    refreshField();
    if (mapChanged || !T.field.ok) {
      clearAll(sim, false);
      T.on = false;
    } else {
      // Same map, rebuilt (a quality change): the slots are new objects, so
      // hand each craft its slot again by id.
      for (const c of T.list) {
        if (!c.home) continue;
        const s = T.field.slots.find((x) => x.id === c.home.id);
        c.home = s || null;
        if (s) s.owner = c.id;
      }
    }
    ensureDots();
  },

  startMode(sim, mode, opts) {
    T.sim = sim;
    clearAll(sim, true);
    T.on = false;
    // A Dev button pressed on the menu adds that one aeroplane when the
    // flight starts. It used to switch the whole traffic on as well, in the
    // tutorial and the missions too; now it is only the one that was asked for.
    const want = T.pending;
    T.pending = null;
    if (wantedFor(sim, mode, opts)) start(sim, opts);
    else T.why = `off in ${mode}`;
    if (want && mode !== 'drive') {
      const r = spawnTraffic(sim, want);
      if (!r.ok) console.info(`[traffic] the aeroplane asked for from the menu was not added: ${r.why}`);
    }
    prebuildModels(sim);
    // Published now, not on the first frame: startMode() has just emptied
    // sim.traffic, and anything that looks before a frame has run should
    // still find the aeroplanes on the apron.
    publish(sim);
  },

  stop(sim, why) {
    if (why === 'airport') return; // the same flight carries on
    try {
      if (sim.audio && sim.audio.available) SOUND.silence(sim.audio.mixer);
    } catch (e) {
      /* the sound is decoration */
    }
    clearAll(sim, true);
    T.on = false;
    T.why = 'stopped';
  },

  update(sim, dt) {
    const t0 = performance.now();
    T.sim = sim;
    T.time += dt;
    T.builtThisFrame = false;
    if (!T.list.length) {
      hear(sim);
      publish(sim);
      return;
    }
    if (dt > 0.25) dt = 0.25;
    if (!T.dots) ensureDots();
    playerContext(sim);
    for (const c of T.list) {
      stepCraft(sim, c, dt);
      if (!c.model) ensureModel(c);
    }
    towerWatch(sim);
    const cam = sim.camera ? sim.camera.position : V1.set(0, 0, 0);
    for (const c of T.list) {
      drawCraft(sim, c, dt, cam);
      drawTag(c);
    }
    drawDots(sim);
    hear(sim);
    publish(sim);
    const ms = performance.now() - t0;
    const st = T.stats;
    st.frames++;
    st.ms = st.ms * 0.95 + ms * 0.05;
    if (st.frames > 30) st.msMax = Math.max(st.msMax, ms);
  },

  camera(sim, dt, camera) {
    if (T.watch < 0) return false;
    const c = T.list[T.watch];
    if (!c || sim.state === 'menu') {
      T.watch = -1;
      return false;
    }
    // A chase view behind and above, looking at it.
    const back = c.perf.length * 1.6 + 18;
    const up = c.perf.length * 0.35 + 5;
    CAM_POS.set(c.x - Math.sin(c.hdg) * back, c.y + up, c.z + Math.cos(c.hdg) * back);
    const floor = Math.max(heightAt(CAM_POS.x, CAM_POS.z), 0) + 2;
    if (CAM_POS.y < floor) CAM_POS.y = floor;
    if (!T.camInit) {
      camera.position.copy(CAM_POS);
      T.camInit = true;
    } else {
      camera.position.lerp(CAM_POS, Math.min(1, (dt || 0.016) * 3));
    }
    LOOK.set(c.x, c.y + 1.5, c.z);
    camera.lookAt(LOOK);
    return true;
  },

  devActions: [
    {
      label: 'Traffic: one more (departing)',
      hint: 'Adds an AI aeroplane on a free slot that starts up and leaves straight away',
      run(sim) {
        const r = spawnTraffic(sim, 'depart');
        if (r.ok) {
          sim.hud && sim.hud.notify(`${r.callsign} is starting up`, 'info', 3);
          return;
        }
        // Nowhere to put another: send out one that is here already.
        const n = r.why && /park/.test(r.why) && T.on ? startNextParked(sim) : null;
        sim.hud && sim.hud.notify(n ? `Every stand is taken, so ${n.callsign} is starting up now instead` : `No traffic added: ${r.why}`, 'info', 3.5);
      },
    },
    {
      label: 'Traffic: one coming in to land',
      hint: 'Adds an AI aeroplane on the circuit, about to join final',
      run(sim) {
        const r = spawnTraffic(sim, 'arrive');
        sim.hud && sim.hud.notify(r.ok ? `${r.callsign} is joining the circuit` : `No traffic added: ${r.why}`, 'info', 3);
      },
    },
    {
      label: 'Traffic: clear all',
      hint: 'Removes every AI aeroplane for the rest of this flight',
      run(sim) {
        clearTraffic(sim);
        sim.hud && sim.hud.notify('Traffic cleared', 'info', 2.5);
      },
    },
    {
      label: 'Traffic: watch one',
      hint: 'Follows an AI aeroplane with the camera; press again for the next, and after the last you are back',
      run(sim) {
        watchNext(sim);
      },
    },
    {
      label: 'Traffic: name tags on/off',
      hint: 'The callsign and what it is doing, floating over each AI aeroplane',
      run(sim) {
        T.tags = !T.tags;
        for (const c of T.list) if (c.tag) c.tag.visible = false;
        sim.hud && sim.hud.notify(T.tags ? 'Traffic name tags on' : 'Traffic name tags off', 'info', 2);
      },
    },
  ],
});

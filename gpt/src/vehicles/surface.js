/**
 * Surface vehicles: the boat and the car.
 *
 * These share almost everything. Both sit on a surface, both steer from the
 * front and both have one number for "how hard am I pushing" — the differences
 * are which surface they are allowed on, how quickly they turn, and what
 * happens when they leave it. So they are one class with a spec rather than
 * two files that drift apart.
 *
 * Three degrees of freedom, not six. A boat that can pitch and roll
 * independently of its heading is a physics exercise; a boat that leans in its
 * turns and bobs on the swell is what it feels like from the helm, and the
 * second is both cheaper and more convincing. Pitch and roll here are *display*
 * angles driven by what the vehicle is doing, not state the integrator solves.
 *
 * WHAT WAS WRONG WITH THE BOAT, measured rather than guessed. Five things, and
 * every one of them is a number in the old spec block:
 *
 * 1. SHE COULD NOT REACH HER OWN TOP SPEED. topSpeed was 22 m/s, but thrust
 *    was accel = 3.4 and drag was dragK = 0.055 v², so she settled where those
 *    balance: sqrt(3.4 / 0.055) = 7.9 m/s, which is 15 knots. The 22 was a
 *    clamp that never once bound. The HUD has a word for over 25 knots, "on
 *    the plane", and it was unreachable text in a file nobody had run a sum
 *    on.
 * 2. SHE DID NOT CARRY HER WAY. Pure square drag from 7.9 m/s runs on 37 m —
 *    five boat lengths — but takes sixteen seconds to do it. That is the
 *    worst pairing available: it reads as mushy keys rather than as momentum,
 *    because momentum is a DISTANCE you can see and this was a DELAY you can
 *    only feel.
 * 3. THERE WAS NO ASTERN. The integrator clamps to -35% of top speed and
 *    nothing could ever ask for it: main.js feeds `ctrl.throttle * 2` and
 *    input.js clamps its throttle to 0..1, so the demand could not go below
 *    zero from the keyboard, the gamepad or the touch slider. Reverse was
 *    written, commented and unreachable. The one manoeuvre that actually
 *    stops a boat was missing from the boat.
 * 4. HALF THE THROTTLE TRAVEL WAS DEAD. That same `* 2` means the keyboard
 *    throttle is at full boat power by the time it reads 50%, so the top half
 *    of the on-screen lever changed nothing at all.
 * 5. THE SEA DID NOTHING. bobAmp was a fixed 0.22 m sine, identical in a flat
 *    calm and in a storm, so weather was paint.
 *
 * This file fixes all five. The car is deliberately untouched: every new
 * branch is behind `isBoat`, and the car's spec numbers are the ones that
 * shipped.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, isPaved, obstacleAt } from '../world/terrain.js';
import { clamp, lerp } from '../core/noise.js';

/** Sea level. The ocean is a flat plane at y=0 with a decorative swell. */
export const SEA = 0;

const DEG = Math.PI / 180;

/**
 * The four surfaces, and the two numbers that make each of them feel like
 * itself.
 *
 * `grip` scales cornering, braking and how much of the engine reaches the
 * ground. `roll` is rolling resistance in m/s², which is what actually stops
 * you when you lift off — the old car had only a v² drag term, so below about
 * 10 km/h nothing slowed it at all and it coasted like a puck.
 *
 * Top speed on each surface falls out of those two numbers rather than being
 * declared anywhere: drive force is `accel * grip`, resistance is
 * `roll + dragK * v²`, and where they meet is the top speed. For the van that
 * is about 100 km/h on tarmac, 74 on gravel, 40 on grass and 28 on sand. The
 * spread is the reason to have surfaces at all, and it is emergent, so tuning
 * one number moves the whole island consistently.
 */
export const SURFACES = {
  tarmac: { kind: 'tarmac', grip: 1.0, roll: 0.45, rough: 0.0 },
  gravel: { kind: 'gravel', grip: 0.72, roll: 1.1, rough: 0.55 },
  grass: { kind: 'grass', grip: 0.55, roll: 2.0, rough: 0.85 },
  sand: { kind: 'sand', grip: 0.45, roll: 1.9, rough: 0.7 },
};

/**
 * Where the world tells us about itself.
 *
 * The road network and the mesh-accurate ground sampler are being built by
 * other people in other files, and they do not exist yet. Importing them by
 * name today would be a link error — the module would fail to load and take
 * the whole game with it, which is exactly the failure this project has
 * already had once.
 *
 * So they are injected. Driving works right now with nothing but the two
 * functions terrain.js has always exported, and it gets better the moment
 * roads.js calls this once at map load. No import cycle, no flag day, and no
 * half of the game waiting on the other half to land.
 *
 *   setTerrainProbes({
 *     surfaceAt:     (x, z) => ({ kind, grip }) | null,
 *     meshHeightAt:  (x, z) => number,   // the ground as DRAWN, not as defined
 *   });
 */
const PROBES = { surfaceAt: null, meshHeightAt: null };

export function setTerrainProbes(probes = {}) {
  PROBES.surfaceAt = probes.surfaceAt || null;
  PROBES.meshHeightAt = probes.meshHeightAt || null;
}

/** Ground height for anything that sits ON the ground. */
function groundAt(x, z) {
  const h = PROBES.meshHeightAt ? PROBES.meshHeightAt(x, z) : heightAt(x, z);
  return h;
}

/**
 * Which surface is under this point.
 *
 * Until roads exist this is the old `isPaved` answer plus a sand/grass split
 * by elevation, so a beach already drives like a beach. When roads.js injects
 * its own `surfaceAt` this defers to it and gravel tracks start existing.
 */
function surfaceUnder(x, z, h) {
  if (PROBES.surfaceAt) {
    const s = PROBES.surfaceAt(x, z);
    if (s) return SURFACES[s.kind] ? { ...SURFACES[s.kind], ...s } : s;
  }
  if (isPaved(x, z)) return SURFACES.tarmac;
  // Anything within a couple of metres of the water is beach.
  if (h < 2.2) return SURFACES.sand;
  return SURFACES.grass;
}


/**
 * The engine lever.
 *
 * A boat is not driven with a percentage. It is driven with a handle that has
 * positions, and the positions have names a ten-year-old already half knows
 * from every boat in every film. Naming them does real work: "come alongside
 * at Slow" is an instruction a child can carry out exactly, where "come
 * alongside at about fifteen percent" is one they can only approximate — and
 * the whole back half of every rescue is about going slowly on purpose.
 *
 * `thrust` is a fraction of the full-ahead push, not a fraction of top speed.
 * Speed comes out of the thrust/drag balance, which is why the numbers look
 * uneven: speed goes as roughly the square root of thrust, so a twelfth of
 * the push is still a third of the speed. These are MEASURED, by running the
 * integrator at 60 Hz for three minutes on a Blue Bird Day, not derived on
 * paper — the paper version was wrong twice:
 *
 *   ASTERN  -0.50   -2.40 m/s   4.7 kt astern (held there by the clamp)
 *   STOP     0       0.00        stopped, and actually stopped
 *   SLOW     0.08    4.29 m/s    8.3 kt   harbour speed, and alongside speed
 *   HALF     0.51   10.20 m/s   19.8 kt   the passage-making detent
 *   FULL     1.00   13.73 m/s   26.7 kt   and 20.1 kt into a gale
 *
 * THE ONE NUMBER THE MAP PEOPLE NEED: three minutes at HALF is 1.80 km. That
 * is the longest leg any boat mission may have, measured rather than felt.
 * Three minutes at FULL is 2.43 km, but nobody steams the whole way at FULL
 * and in a gale FULL only makes 1.87 km in three minutes.
 */
export const DETENTS = [
  { id: 'astern', label: 'ASTERN', short: 'Ast', thrust: -0.5 },
  { id: 'stop', label: 'STOP', short: 'Stop', thrust: 0 },
  { id: 'slow', label: 'SLOW', short: 'Slow', thrust: 0.08 },
  { id: 'half', label: 'HALF', short: 'Half', thrust: 0.51 },
  { id: 'full', label: 'FULL', short: 'Full', thrust: 1 },
];
export const LEVER_STOP = 1;
export const LEVER_SLOW = 2;

/** Which sea state a number belongs to. Four words, because four is enough. */
const SEA_WORDS = [
  [0.22, 'calm'],
  [0.5, 'choppy'],
  [0.82, 'rough'],
  [99, 'gale'],
];

export const VEHICLES = {
  boat: {
    id: 'boat',
    name: 'Kestrel Launch',
    kind: 'boat',
    blurb: 'A fast rescue boat. Twenty-seven knots flat out, and about a hundred and twenty metres to run off when you stop her.',
    /*
     * topSpeed is now honest. It is the clamp AND, near enough, where thrust
     * and drag actually balance at FULL: the propeller gives accel * (1 -
     * propFalloff) = 4.8 * 0.75 = 3.6 m/s2 of push up there, drag takes
     * 0.0176 v2, and those meet at 13.8 m/s. Measured on a Blue Bird Day
     * (which has a little sea in it): 13.73 m/s, 26.7 knots, which is what
     * the blurb claims. The old file said 22 and delivered 7.9.
     */
    topSpeed: 14,
    accel: 4.8,
    dragK: 0.0176,
    /*
     * A propeller makes most thrust standing still and least at speed — which
     * is why a boat leaps off the berth and then takes an age over the last
     * two knots. Without this the SLOW detent had only 0.19 m/s2 to play
     * with, so leaving the berth took fifty seconds of a child holding one
     * key wondering whether the key was broken. With it, SLOW pushes 0.43 at
     * rest and the whole low end of the lever becomes usable.
     */
    propFalloff: 0.25,
    /*
     * See the long note at the point of use. Short version: below
     * `stopperFrom`, and only with the lever at STOP or ASTERN, this brings
     * her to an actual rest instead of letting her creep for minutes.
     */
    stopper: 0.35,
    stopperFrom: 2,
    asternSpeed: 2.4,
    /*
     * Turning. The old 0.85 rad/s is 49 degrees a second, which at 10 m/s is
     * a turning circle of 11.8 m — less than two of her own lengths. That is
     * a jetski. 0.52 rad/s gives 19 m at Half and 27 m at Full, which is a
     * boat: tight enough for a child to place her alongside a quay, wide
     * enough that you have to think one manoeuvre ahead.
     */
    turnRate: 0.52,
    turnAtRest: 0.06,
    bankInTurn: 0.42,
    /*
     * How far the stern slides out in a turn. A boat's head comes round
     * faster than her track does, and that gap is most of what makes steering
     * one feel different from steering a car. Steady-state drift angle in a
     * hard turn at Half works out at about 7 degrees, which is what a real
     * planing hull does.
     */
    slipGain: 0.5,
    slipDamp: 2,
    draught: 1,
    /** Calm-water heave, in metres. The sea adds to this; it no longer IS it. */
    bobAmp: 0.1,
    eye: [0, 1.6, 0.4],
    offElement: 'You ran aground',
  },
  car: {
    id: 'car',
    /*
     * It is not an airside van any more. It is the island's delivery van, and
     * the name and the blurb are the first thing a ten-year-old reads about
     * the game they are about to play, so they say what the game is.
     */
    name: 'Island Courier Van',
    kind: 'car',
    blurb: 'The island’s delivery van. Quick on the tarmac, careful on the gravel, hopeless in the sand.',
    /** Top speed on tarmac, m/s. 29 ≈ 105 km/h; the drag curve settles at ~100. */
    topSpeed: 29,
    /** Engine, m/s² at the wheels before grip. 0–50 km/h in about three seconds. */
    accel: 5.0,
    /**
     * Aerodynamic drag, chosen as accel/topSpeed² so the top speed is the
     * number above rather than a surprise. Change one and change both.
     */
    dragK: 0.00595,
    /** Braking, m/s², before grip and wet. 7.0 stops 100 km/h in about 55 m. */
    brakeDecel: 7.0,
    /** Reverse tops out at a third of forward, which is plenty to get out. */
    reverseFrac: 0.3,
    /** Metres between the axles. Sets the turning circle with the steer angle. */
    wheelbase: 2.7,
    /** Metres across the wheels. Sets how much it rolls on a camber. */
    track: 1.9,
    /** Ride height of the body origin above the average of the four wheels. */
    rideHeight: 0.06,
    /**
     * The most important number in the file: how much sideways the tyres can
     * do, m/s², on perfect grip. 8.6 is 0.88 g — generous for a van, because
     * this is a game, and low enough that a hairpin at 80 km/h will not hold.
     */
    latGrip: 8.6,
    /** Mechanical steering lock, degrees. Gives a 4 m turning circle. */
    steerLockMax: 34,
    /**
     * How far past the grip limit full lock is allowed to ask, on perfect
     * tarmac. 1.12 means holding the key flat out on a dry road sits the van
     * just over the edge — enough to feel alive, not enough to squeal — while
     * the same input on gravel asks for half again what is there, and slides.
     */
    rackMargin: 1.12,
    /** How far the body leans, radians at the grip limit. */
    bodyRoll: 0.16,
    bobAmp: 0,
    eye: [0, 1.45, -1.15],
    offElement: 'You went into the water',
  },
};

/**
 * How big the sea is, from the weather that is already in the world.
 *
 * Two things make a sea: how hard it is blowing, and how unsettled the air is.
 * The Weather object already has both — `cond.turb` runs 0.12 clear to 1.0
 * stormy, and `effectiveWindKts` includes any gust blowing through — so this
 * invents no new state and no new setting. The constants are picked so the six
 * shipped presets land where their own names say they should:
 *
 *   Blue Bird Day   clear,  4 kt -> 0.14  calm
 *   Golden Sunset   clear,  7 kt -> 0.19  calm
 *   Breezy Afternoon cloudy 12 kt -> 0.39 choppy
 *   Rainy Coast     rainy, 16 kt -> 0.56  rough
 *   Storm Front     stormy 26 kt -> 1.01  gale
 */
export function seaStateFrom(weather) {
  if (!weather) return 0;
  let turb = 0.12;
  let kts = 4;
  try {
    turb = (weather.cond && weather.cond.turb) || 0.12;
    kts = weather.effectiveWindKts != null ? weather.effectiveWindKts : weather.windSpeedKts || 4;
  } catch (e) {
    // A weather object that is half built is not worth a thrown frame.
  }
  return clamp(turb * 0.55 + (kts / 34) * 0.6, 0, 1.25);
}

export function seaWordFor(sea) {
  for (const [edge, word] of SEA_WORDS) if (sea < edge) return word;
  return 'gale';
}

export class SurfaceVehicle {
  constructor(specId = 'boat') {
    this.spec = VEHICLES[specId] || VEHICLES.boat;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.heading = 90;
    this.speed = 0;
    this.throttle = 0;
    this.steer = 0;
    this.bank = 0;
    this.pitch = 0;
    this.t = 0;
    this.crashed = false;
    this.crashReason = '';
    this.distance = 0;

    /* ---- the boat's own state ---- */
    /** Index into DETENTS. Starts at STOP, because a boat starts stopped. */
    this.lever = LEVER_STOP;
    /** What the lever asks for, and what the engine has actually got to. */
    this.demand = 0;
    this.thrust = 0;
    /** Metres of water under the keel at the current position. */
    this.depth = 9;
    this.sea = 0;
    this.seaWord = 'calm';
    /** Sideways speed through the water, body frame. This is the skid. */
    this.slip = 0;
    /** Vertical offset from the swell, and its rate — the rate finds slams. */
    this.heave = 0;
    this.heaveRate = 0;
    /** On the putty. Ahead does nothing; astern pulls her off. */
    this.aground = false;
    /** 0 to 1. Every touch of the bottom costs a little top speed for good. */
    this.dents = 0;
    /** Decaying 0..1 for the camera to shake on, and 0..1 spray for the sky. */
    this.jolt = 0;
    this.spray = 0;
    /** One-shot noises for whoever owns the speakers. Drained by takeEvents. */
    this.events = [];
    this._leverRepeat = 0;
    this._leverHeld = 0;
    this._lastDemand = 0;
    this._slamCool = 0;
    /** Where she touched, so that coming off means actually backing away. */
    this._groundAt = null;
    this.agroundMessage = '';
    this.seaPitch = 0;
    this.seaRoll = 0;
    /** How hard the lever was moved this second. Mission 6 grades on this. */
    this.snatch = 0;

    /* ---- car only, but always defined so nothing has to null-check ---- */
    /** The surface under the wheels this frame. */
    this.surface = SURFACES.tarmac;
    /** 0 = gripping, 1 = asking for twice what the tyres have. */
    /** The part of the slip that is actually sliding: what squeals and shakes. */
    this.slide = 0;
    /** Radians between where the nose points and where the van is going. */
    this.drift = 0;
    /** 'D', 'R' or 'N'. Shown on the HUD so reverse is never a mystery. */
    this.gear = 'N';
    /** True while all four wheels are off the ground. */
    this.air = false;
    /** Vertical speed, only meaningful in the air and on the frame it lands. */
    this.vy = 0;
    /** Lateral acceleration, signed, m/s². Drives the lean and the squeal. */
    this.latAccel = 0;
    /** In the water and waiting for the truck. */
    this.swamped = false;
    this.recoverT = 0;
    /** Times the van has been bumped off something solid. */
    this.bumps = 0;
    /** Multiplies grip. The weather sets it; 1 is dry. */
    this.wet = 1;
    /** Knocks the load has taken, drained by whoever is carrying it. */
    this._shocks = [];
    /** Last place it was sensibly parked, for fishing it out of the sea. */
    this.lastGood = null;
    this._goodT = 0;
    this._lockT = 0;
  }

  get isBoat() {
    return this.spec.kind === 'boat';
  }

  reset({ pos, headingDeg = 90 }) {
    this.pos.copy(pos);
    this.heading = headingDeg;
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.throttle = 0;
    this.steer = 0;
    this.bank = 0;
    this.crashed = false;
    this.crashReason = '';
    this.distance = 0;
    this.t = 0;
    this.lever = LEVER_STOP;
    this.demand = 0;
    this.thrust = 0;
    this.slip = 0;
    this.heave = 0;
    this.heaveRate = 0;
    this.aground = false;
    this.dents = 0;
    this.jolt = 0;
    this.spray = 0;
    this.snatch = 0;
    this._groundAt = null;
    this.agroundMessage = '';
    this._slamCool = 0;
    this._leverHeld = 0;
    this.events.length = 0;
    this.pos.y = this.surfaceY(this.pos.x, this.pos.z);
    this.depth = this.depthAt(this.pos.x, this.pos.z);
    /* ---- and the car's ---- */
    this.brakes = 0;
    this.pitch = 0;
    this.slide = 0;
    this.drift = 0;
    this.gear = 'N';
    this.air = false;
    this.vy = 0;
    this.latAccel = 0;
    this.swamped = false;
    this.recoverT = 0;
    this.bumps = 0;
    this._shocks.length = 0;
    this._goodT = 0;
    this._lockT = 0;
    this.lastGood = { x: this.pos.x, z: this.pos.z, heading: this.heading };
  }

  /**
   * The surface the vehicle rides on.
   *
   * A boat rides the sea. A car rides the ground AS DRAWN — groundAt goes
   * through the mesh probe when one is injected, so the wheels touch the
   * triangle the child can see rather than the analytic height behind it.
   */
  surfaceY(x, z) {
    return this.isBoat ? SEA : Math.max(SEA, groundAt(x, z));
  }

  /**
   * Water under the keel: the one number a small boat is steered by.
   *
   * heightAt is negative at sea, so -h is the depth of water, and taking the
   * draught off it gives what actually matters — the gap between the bottom
   * of the boat and the bottom of the sea. Negative means you are on it.
   *
   * This is deliberately computed here from heightAt rather than imported
   * from terrain.js as depthUnderKeel(). That helper is proposed but not yet
   * in the tree, and a named import of a function that does not exist throws
   * at module link time and takes the whole game down with it. When it lands,
   * swap the body of this method for a call to it and nothing else changes.
   */
  depthAt(x, z) {
    return -heightAt(x, z) - (this.spec.draught || 1);
  }

  /** Move the engine lever one detent. Returns the detent it ended on. */
  nudgeLever(dir) {
    const was = this.lever;
    this.lever = clamp(this.lever + Math.sign(dir), 0, DETENTS.length - 1);
    if (this.lever !== was) this.events.push({ kind: 'lever', at: this.lever });
    return DETENTS[this.lever];
  }

  setLever(i) {
    this.lever = clamp(Math.round(i), 0, DETENTS.length - 1);
    return DETENTS[this.lever];
  }

  /**
   * Lever keys, with a hold-to-repeat.
   *
   * One press is one detent, which is what makes the lever feel like a handle
   * rather than a slider. But a child who wants to go from FULL to ASTERN in
   * a hurry should not have to find four separate presses, so holding the key
   * steps again after 0.45 s and then four times a second.
   */
  leverKeys(dt, up, down) {
    const dir = up ? 1 : down ? -1 : 0;
    if (!dir) {
      this._leverRepeat = 0;
      this._leverHeld = 0;
      return;
    }
    if (!this._leverHeld) {
      this._leverHeld = dir;
      this._leverRepeat = 0.45;
      this.nudgeLever(dir);
      return;
    }
    this._leverRepeat -= dt;
    if (this._leverRepeat <= 0) {
      this._leverRepeat = 0.25;
      this.nudgeLever(dir);
    }
  }

  /** Drain the one-shot events. The caller plays them and forgets them. */
  takeEvents() {
    if (!this.events.length) return null;
    const out = this.events.slice();
    this.events.length = 0;
    return out;
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.speed *= 0.15;
  }

  /**
   * Is this vehicle where it is supposed to be?
   *
   * A boat wants water, a car wants land. Each is the other's failure, which
   * is why one function answers both. For the boat the test is now the
   * draught rather than a magic -0.6, so the hull and the grounding agree.
   */
  onItsElement(x, z) {
    if (this.isBoat) return this.depthAt(x, z) > 0;
    return heightAt(x, z) > 0.2;
  }

  /**
   * Touching the bottom.
   *
   * The old rule was: over 4 m/s off your element, you are dead, and the only
   * thing left to do is press Esc. A game whose entire subject is threading
   * past shallow water cannot also make touching it terminal — the child just
   * stops going near the shallow parts, and the shallow parts are the only
   * interesting parts of the map. So grounding is now a STOP: a bang, a jolt,
   * a dent, and the lever slammed to ASTERN because astern is the way out and
   * a ten-year-old who has just hit something should find the answer already
   * in their hand.
   *
   * It is still possible to end a run — but only by driving a hard bottom at
   * over 9 m/s, which is Full ahead onto rock, and is a thing you have to
   * work at. Everything else is a dent and a story.
   */
  takeTheGround(groundY) {
    const v = Math.abs(this.speed);
    const hard = groundY > -0.3;
    if (hard && v > 9) {
      this.events.push({ kind: 'wreck', strength: 1 });
      this.jolt = 1;
      this.crash('You put her on the rocks at full ahead');
      this.aground = true;
      this._groundAt = { x: this.pos.x, z: this.pos.z };
      this.speed = 0;
      return;
    }
    this.aground = true;
    this._groundAt = { x: this.pos.x, z: this.pos.z };
    this.speed = 0;
    this.slip = 0;
    this.dents = clamp(this.dents + 0.12 + v / 40, 0, 1);
    this.jolt = clamp(this.jolt + 0.35 + v / 14, 0, 1);
    this.events.push({ kind: 'bang', strength: clamp(0.35 + v / 14, 0, 1) });
    this.setLever(0);
    this.agroundMessage = "You're on the putty — astern, gently";
  }

  /**
   * Something happened to the load.
   *
   * `strength` is 0..1 of a full knock. The cargo layer decides whether that
   * is a pip; a mission with nothing in the back can ignore the lot.
   */
  shock(reason, strength) {
    const s = clamp(strength, 0, 1);
    if (s < 0.06) return;
    this._shocks.push({ reason, strength: s, at: this.t });
    this.lastShock = reason;
    this.shockFlash = 1;
  }

  /** Read and clear. Whoever asks first gets them. */
  takeShocks() {
    if (!this._shocks.length) return null;
    const out = this._shocks.slice();
    this._shocks.length = 0;
    return out;
  }

  /**
   * One step.
   *
   * Two vehicles that share a shell and share nothing else. The boat is a
   * hull in water with a lever; the car is four contact patches with a
   * steering rack. They were one function once and every line of it had a
   * branch in it.
   */
  update(dt, controls = {}) {
    this.t += dt;
    if (this.shockFlash) this.shockFlash = Math.max(0, this.shockFlash - dt * 2.4);
    if (this.isBoat) return this.updateBoat(dt, controls);
    return this.updateCar(dt, controls);
  }

  /* ------------------------------------------------------------- boat -- */

  updateBoat(dt, controls) {
    const S = this.spec;
    const boat = this.isBoat;
    const weather = controls.weather || null;

    if (boat) {
      this.sea = seaStateFrom(weather);
      this.seaWord = seaWordFor(this.sea);
    }

    if (this.crashed) {
      this.speed = lerp(this.speed, 0, clamp(dt * 1.5, 0, 1));
    } else if (boat) {
      this.steer = clamp(controls.steer ?? 0, -1, 1);

      /* ---- the lever ------------------------------------------------- */
      // Space is a crash stop: one key, straight to astern, for the moment a
      // child realises the quay is not going to move.
      if (controls.crashStop) this.setLever(0);
      else if (controls.lever) this.leverKeys(dt, controls.lever.up, controls.lever.down);
      else if (controls.leverIndex != null) this.setLever(controls.leverIndex);

      const want = DETENTS[this.lever].thrust;
      this.demand = want;
      // How violently the lever is being worked, decaying over a second. The
      // long-tow mission parts the line on this; nothing else reads it.
      this.snatch = clamp(Math.max(this.snatch - dt, Math.abs(want - this._lastDemand) / Math.max(dt, 1e-3) / 8), 0, 1);
      this._lastDemand = want;
      // The engine is not the handle. A diesel takes about a second and a
      // quarter to come up or down, which is why snatching the lever does not
      // snatch the boat and why you plan a stop rather than press one.
      this.thrust = lerp(this.thrust, want, clamp(dt * 1.6, 0, 1));
      this.throttle = this.thrust;

      /* ---- how much push is actually left ---------------------------- */
      /*
       * A gale takes speed off you three ways and all three are real: the
       * hull works harder in a big sea, the wind is on the superstructure,
       * and you physically cannot hold full into a head sea. Head-on in a
       * gale this comes out at 10.4 m/s instead of 13.7 — 20.1 knots instead
       * of 26.7 — and with it behind you, 12.5. That is enough that the gale
       * mission is a different job rather than the same job under grey cloud.
       */
      const head = this.headSeaFactor(weather);
      const thrustScale = (1 - this.sea * 0.3 * head) * (1 - this.dents * 0.35);
      const dragScale = 1 + this.sea * 0.35;

      const prop = 1 - (S.propFalloff || 0) * clamp(Math.abs(this.speed) / S.topSpeed, 0, 1);
      const push = this.thrust * S.accel * prop * (this.thrust > 0 ? thrustScale : 1);
      const v = Math.abs(this.speed);
      let retard = S.dragK * dragScale * this.speed * v;
      /*
       * The stopper, and why it is gated on the lever.
       *
       * Square drag alone never brings her to rest: below a knot the
       * retardation is so small she creeps for minutes on end, and "come
       * alongside" would never finish. So with the lever at STOP or ASTERN a
       * small constant retardation stands in for wind, wave and eddy, fading
       * in as she slows so there is no step in the feel at two metres a
       * second. Above that the square law is untouched, which is where the
       * hundred and twenty metres of run-on lives.
       *
       * It is gated on the lever because the first version was not, and 0.35
       * of retardation is larger than the 0.20 of push at SLOW — so the boat
       * sat at the quay with her engine running and would not move at all.
       * Measured, not guessed: SLOW settled at 0.01 m/s.
       */
      if (v < S.stopperFrom && this.demand <= 0.001) {
        retard += S.stopper * Math.sign(this.speed) * (1 - v / S.stopperFrom);
      }
      this.speed += (push - retard) * dt;

      if (this.aground) {
        // On the bottom: ahead does nothing at all, astern has extra bite
        // because she is being pulled off rather than driven forward.
        if (this.speed > 0) this.speed = 0;
        else this.speed -= S.accel * 0.4 * dt * (this.thrust < 0 ? 1 : 0);
      }
      this.speed = clamp(this.speed, -S.asternSpeed, S.topSpeed);
      if (Math.abs(this.speed) < 0.06 && Math.abs(this.demand) < 0.02) this.speed = 0;

      /* ---- steering -------------------------------------------------- */
      // A rudder does nothing without water flowing over it.
      const auth = S.turnAtRest + (1 - S.turnAtRest) * clamp(Math.abs(this.speed) / (S.topSpeed * 0.45), 0, 1);
      const rate = this.steer * S.turnRate * auth * Math.sign(this.speed || 1) * (this.aground ? 0.15 : 1);
      this.heading = (this.heading + rate * dt * 57.2958 + 360) % 360;
      // The skid. Her head comes round before her track does.
      const slipTarget = rate * this.speed * S.slipGain;
      this.slip += (slipTarget - this.slip * S.slipDamp) * dt;
      this.slip = clamp(this.slip, -4, 4);
    }

    /* ---- move her -------------------------------------------------- */
    const rad = (this.heading * Math.PI) / 180;
    const sinH = Math.sin(rad);
    const cosH = Math.cos(rad);
    let dx = sinH * this.speed * dt;
    let dz = -cosH * this.speed * dt;
    if (boat) {
      // The skid pushes her sideways, to port for a starboard turn.
      dx += cosH * this.slip * dt;
      dz += sinH * this.slip * dt;
      // And the wind pushes the whole boat bodily downwind. About 3.5% of the
      // wind speed, rising in a big sea: nothing at all on a calm day, and
      // 0.7 m/s in a gale, which is 126 m of set over a three-minute leg —
      // enough to see on the chart, not enough to be unfair.
      const lee = this.leeway(weather);
      dx += lee.x * dt;
      dz += lee.z * dt;
    }

    if (boat && !this.crashed) {
      /*
       * Look ahead by a boat length plus a second of travel, because a hull
       * that only checks the water it is already in has grounded before it
       * knew. Two heightAt calls a frame: one here, one for the sounder.
       */
      const look = 3 + Math.abs(this.speed) * 0.35;
      const tip = this.step(this.pos.x + dx, this.pos.z + dz, look * Math.sign(this.speed || 1));
      if (!this.aground && this.depthAt(tip.x, tip.z) <= 0) {
        this.takeTheGround(heightAt(tip.x, tip.z));
        dx = 0;
        dz = 0;
      }
    }

    this.pos.x += dx;
    this.pos.z += dz;
    this.distance += Math.abs(this.speed) * dt;
    this.vel.set(dx / Math.max(dt, 1e-4), 0, dz / Math.max(dt, 1e-4));

    const hit = obstacleAt(this.pos.x, this.pos.y + 1, this.pos.z);
    if (hit && !this.crashed) this.crash(hit.what);

    if (boat) {
      this.depth = this.depthAt(this.pos.x, this.pos.z);
      /*
       * You are off when you have actually backed off.
       *
       * The first rule was "clear when the water under her is deep again",
       * and it let go the same frame it caught: she stops a boat's length
       * SHORT of the bank, so the water under her own keel is still deep and
       * she was declared afloat, drove forward, hit it again, and racked up a
       * dent every second. Measured: a full set of dents in eleven seconds
       * from one shoal. Coming off has to mean putting distance between her
       * and the place she touched.
       */
      if (this.aground && this._groundAt) {
        const dx0 = this.pos.x - this._groundAt.x;
        const dz0 = this.pos.z - this._groundAt.z;
        if (dx0 * dx0 + dz0 * dz0 > 36 && this.depth > 0.15) {
          this.aground = false;
          this.agroundMessage = '';
          this._groundAt = null;
          this.events.push({ kind: 'afloat' });
        }
      }
      this.seaMotion(dt);
    }

    const base = this.surfaceY(this.pos.x, this.pos.z);
    if (boat) {
      // Follow the sea rather than damping it away. The old lerp of dt*6 was
      // slower than the swell itself in anything but a calm, so a gale looked
      // like a mild ripple from on board.
      this.pos.y = lerp(this.pos.y, base + this.heave, clamp(dt * 12, 0, 1));
    } else {
      this.pos.y = lerp(this.pos.y, base, clamp(dt * 6, 0, 1));
    }

    const leanTarget = -this.steer * S.bankInTurn * clamp(Math.abs(this.speed) / 8, 0, 1) + (boat ? this.seaRoll : 0);
    this.bank = lerp(this.bank, leanTarget, clamp(dt * 3, 0, 1));
    const pitchTarget = boat
      ? clamp(this.speed / S.topSpeed, 0, 1) * 0.14 + this.seaPitch
      : 0;
    this.pitch = lerp(this.pitch, pitchTarget, clamp(dt * (boat ? 5 : 2), 0, 1));
    this.jolt = Math.max(0, this.jolt - dt * 1.8);
    this.quat.setFromEuler(new THREE.Euler(this.pitch, -rad, this.bank, 'YXZ'));
  }

  /* -------------------------------------------------------------- car -- */

  updateCar(dt, controls) {
    const S = this.spec;
    const rad = this.heading * DEG;
    const c = Math.cos(rad);
    const s = Math.sin(rad);

    /*
     * Four wheels, four questions to the ground.
     *
     * This is the suspension, the lean and the wheel contact all at once, and
     * it costs four heightAt calls a frame — the same as normalAt, which is
     * what the old code would have needed anyway to do half as much. The
     * probes sit at the real axle and track positions, so a van straddling a
     * ditch tips the way a van straddling a ditch tips.
     */
    const hb = S.wheelbase * 0.5;
    const ht = S.track * 0.5;
    const fx = s * hb;
    const fz = -c * hb;
    const rx = c * ht;
    const rz = s * ht;
    const hFL = groundAt(this.pos.x + fx - rx, this.pos.z + fz - rz);
    const hFR = groundAt(this.pos.x + fx + rx, this.pos.z + fz + rz);
    const hRL = groundAt(this.pos.x - fx - rx, this.pos.z - fz - rz);
    const hRR = groundAt(this.pos.x - fx + rx, this.pos.z - fz + rz);
    const front = (hFL + hFR) * 0.5;
    const rear = (hRL + hRR) * 0.5;
    const left = (hFL + hRL) * 0.5;
    const right = (hFR + hRR) * 0.5;
    const groundY = (front + rear) * 0.5;

    // Nose up going uphill; right side up when the ground rises to the right.
    const groundPitch = Math.atan2(front - rear, S.wheelbase);
    const groundRoll = Math.atan2(right - left, S.track);

    const centreH = heightAt(this.pos.x, this.pos.z);
    this.surface = surfaceUnder(this.pos.x, this.pos.z, centreH);
    /*
     * Wet costs you cornering and braking, not acceleration. A van at these
     * power levels pulls away on a wet road almost as well as on a dry one —
     * and more to the point, a version where rain also halved the acceleration
     * made Night Call-out into eleven seconds of waiting to reach 50 km/h.
     */
    const gripDrive = clamp(this.surface.grip, 0.1, 1.4);
    const grip = clamp(this.surface.grip * this.wet, 0.1, 1.4);

    /*
     * In the water. Not a crash — a delay.
     *
     * The old car ended the session here, which for a delivery game means a
     * child who clips a beach at speed is sent back to a menu. Now a truck
     * pulls you out: 2.5 seconds, one hell of a knock to whatever is in the
     * back, and you are put down facing the right way at the last sensible
     * place you were. The only thing that has actually happened is that you
     * lost the time, which is what the clock is for.
     */
    if (this.swamped) {
      this.speed *= 1 - clamp(dt * 3, 0, 1);
      this.recoverT -= dt;
      this.slip = 0;
      this.slide = 0;
      this.drift = 0;
      if (this.recoverT <= 0) {
        const g = this.lastGood;
        if (g) {
          this.pos.x = g.x;
          this.pos.z = g.z;
          this.heading = g.heading;
        }
        /*
         * And pointing away from the water.
         *
         * Being set down facing the sea you have just been pulled out of is an
         * invitation to drive into it again, and the heading was copied
         * unchanged from the moment before the dunking — which is by
         * definition the way you were going when you went in.
         */
        const r0 = this.heading * DEG;
        if (groundAt(this.pos.x + Math.sin(r0) * 18, this.pos.z - Math.cos(r0) * 18) < 1) {
          this.heading = (this.heading + 180) % 360;
        }
        this.pos.y = Math.max(SEA, groundAt(this.pos.x, this.pos.z)) + S.rideHeight;
        this.speed = 0;
        this.swamped = false;
        this.air = false;
        this.vy = 0;
      }
      this.applyAttitude(dt, this.heading * DEG, 0, 0);
      this.vel.set(0, 0, 0);
      return;
    }

    const throttleIn = clamp(controls.throttle ?? 0, -1, 1);
    const brakeIn = clamp(controls.brake ?? 0, 0, 1);
    const hand = !!controls.handbrake;
    this.steer = clamp(controls.steer ?? 0, -1, 1);
    this.throttle = throttleIn;
    this.brakes = Math.max(brakeIn, hand ? 1 : 0);

    const v = Math.abs(this.speed);
    const dir = Math.sign(this.speed);

    /* ---- longitudinal -------------------------------------------------- */

    if (this.air) {
      // No wheels on the ground, no engine and no brakes. Everyone knows this
      // and everyone tries it, so it had better be true.
      const dragA = S.dragK * this.speed * v;
      this.speed -= dragA * dt;
    } else {
      // Drive force is limited by what the tyres can put down, which is why a
      // van on grass is slow rather than just draggy.
      const drive = throttleIn * S.accel * (throttleIn > 0 ? gripDrive : gripDrive * 0.8);
      const dragF = S.dragK * this.speed * v;
      const rollF = v > 0.05 ? this.surface.roll * dir : 0;
      const brakeF = brakeIn * S.brakeDecel * grip * (hand ? 1.35 : 1) * dir;
      // Gravity along the slope. Free, one line, and it is the entire reason
      // the descent off the summit is the dangerous half of that job.
      const gAlong = -9.81 * Math.sin(groundPitch);
      this.speed += (drive + gAlong - dragF - rollF - brakeF) * dt;

      // Parked is parked. Without this the van creeps down every gradient
      // steeper than about five per cent for the rest of the session.
      if (v < 0.4 && Math.abs(throttleIn) < 0.02 && Math.abs(gAlong) < 1.2) this.speed = 0;
      if (brakeIn > 0.5 && v < 0.5) this.speed = 0;
    }

    const maxFwd = S.topSpeed * 1.25; // downhill can beat the flat top speed
    this.speed = clamp(this.speed, -S.topSpeed * S.reverseFrac, maxFwd);
    this.gear = this.speed < -0.3 ? 'R' : this.speed > 0.3 ? 'D' : 'N';

    /* ---- cornering ----------------------------------------------------- */

    /*
     * A bicycle model with a lateral-force ceiling, and that ceiling is the
     * whole feel of the game.
     *
     * You ask the front wheels for a steer angle. That demands a yaw rate, and
     * a yaw rate at a speed demands a sideways force. If the tyres do not have
     * that force, the yaw rate is clamped — the van turns less than you asked
     * and runs wide — and the excess becomes `slip`, which is what squeals,
     * shakes the camera, rattles the load and slides the back end.
     *
     * Nothing here can fail. You cannot crash by cornering, you can only go
     * where you did not mean to, which is the lesson: too fast into the bend
     * costs you the bend, not the run.
     */
    /*
     * The steering rack is shaped by the grip limit, not by the speed.
     *
     * The first version of this fell linearly from 34 degrees of lock to 7.5,
     * and it was wrong in a way that only a simulation shows: at 60 km/h full
     * lock demanded three times the grip the tyres had, and at 100 km/h four
     * times. So the van was permanently at the limit, permanently sliding, and
     * permanently squealing the moment you touched a steering key. Understeer
     * that happens all the time is not understeer, it is the handling.
     *
     * Instead, full lock asks for `rackMargin` times what the tyres can give
     * ON DRY TARMAC. The consequences fall out of that one line:
     *
     *   - On tarmac, holding the key gives you the tightest corner the van can
     *     actually take, at any speed: 8 m radius at 30 km/h, 22 m at 50, 44 m
     *     at 70, 90 m at 100. You cannot flick it into a spin at speed and you
     *     do not need to feather it — which matters enormously when the only
     *     steering input a keyboard has is "all of it".
     *   - Arriving at a junction too fast still misses the junction, because
     *     the radius grows with the square of the speed and the road does not.
     *     That is the understeer, and it needs no slip and no failure state.
     *   - On gravel, in the rain, or with the handbrake up, the same input is
     *     asking for far more than is there, so THOSE are the surfaces that
     *     slide. Which is what a child should learn about gravel.
     */
    const lock = Math.min(
      S.steerLockMax * DEG,
      Math.atan((S.latGrip * S.rackMargin * S.wheelbase) / Math.max(this.speed * this.speed, 1e-3))
    );
    let omega = (this.speed / S.wheelbase) * Math.tan(this.steer * lock);
    const latMax = S.latGrip * grip * (hand ? 0.55 : 1);
    const latWant = Math.abs(omega * this.speed);
    let slipNow = 0;
    if (v > 1.5 && latWant > latMax) {
      slipNow = clamp(latWant / latMax - 1, 0, 1.4);
      omega *= latMax / latWant;
    }
    if (this.air) omega *= 0.15;
    this.slip = lerp(this.slip, Math.min(slipNow, 1), clamp(dt * 7, 0, 1));
    this.latAccel = omega * this.speed;
    this.heading = (this.heading + omega * dt * 57.2958 + 360) % 360;
    /*
     * The heading AFTER this frame's turn. `rad` at the top of the function is
     * where the van was when the wheels were sampled, which is right for the
     * suspension probes and wrong for everything downstream — using it to
     * move and to orient the model leaves the body a frame behind the physics,
     * which at 80 degrees a second is a visible shimmy in a tight turn.
     */
    const radNow = this.heading * DEG;

    /*
     * The slide you can see. The nose keeps pointing where you steered; the
     * van travels up to fourteen degrees wide of it. Without this, exceeding
     * the grip limit only makes the corner lazier and nobody can tell why.
     *
     * It starts above a slip of 0.2 because dry tarmac at full lock sits at a
     * steady 0.12 by design. Without that threshold the van would go down
     * every corner on the best road on the island very slightly sideways, with
     * the tyres squealing, and the one surface that is meant to feel planted
     * would feel exactly like the gravel.
     */
    const slide = clamp((slipNow - 0.2) / 0.8, 0, 1);
    this.slide = slide;
    const driftWant = -Math.sign(this.steer || 0) * slide * 14 * DEG;
    this.drift = lerp(this.drift, driftWant, clamp(dt * 5, 0, 1));

    /* ---- move ---------------------------------------------------------- */

    const travel = radNow - this.drift;
    const stepX = Math.sin(travel) * this.speed * dt;
    const stepZ = -Math.cos(travel) * this.speed * dt;
    const prevX = this.pos.x;
    const prevZ = this.pos.z;
    this.pos.x += stepX;
    this.pos.z += stepZ;
    this.distance += v * dt;
    this.vel.set(stepX / Math.max(dt, 1e-4), 0, stepZ / Math.max(dt, 1e-4));

    /*
     * Buildings stop being instant death.
     *
     * A courier who clips the corner of the harbour office should lose the
     * paint and four seconds, not the job. So the van is put back where it
     * was, bounced, and the load takes the hit — which is a consequence a
     * ten-year-old can read without any text at all.
     */
    const hit = obstacleAt(this.pos.x, this.pos.y + 1, this.pos.z);
    if (hit) {
      this.pos.x = prevX;
      this.pos.z = prevZ;
      this.shock(hit.what || 'a bump', clamp(v / 16, 0.25, 1));
      this.speed = -this.speed * 0.22;
      this.bumps++;
      this.lastBump = hit.what || 'a bump';
    }

    /* ---- the vertical -------------------------------------------------- */

    const restY = Math.max(SEA, groundY) + S.rideHeight;
    if (this.air) {
      this.vy -= 9.81 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= restY) {
        const impact = -this.vy;
        this.pos.y = restY;
        this.air = false;
        this.vy = 0;
        // Landing on the wheels is fine. Landing on the springs is not, and
        // four metres a second is roughly a kerb taken at seventy.
        if (impact > 4) {
          this.shock('a hard landing', clamp((impact - 4) / 7, 0, 1));
          this.speed *= 1 - clamp((impact - 4) * 0.02, 0, 0.35);
        }
      }
    } else if (restY < this.pos.y - 0.3 && v > 6) {
      // The ground fell away faster than the body could follow: that is a jump.
      this.air = true;
      this.vy = 0;
    } else {
      // Suspension. Fast enough that the wheels stay on the road over a crest,
      // soft enough that the 39 m terrain grid does not read as stairs.
      const before = this.pos.y;
      this.pos.y = lerp(this.pos.y, restY, clamp(dt * 12, 0, 1));
      this.vy = (this.pos.y - before) / Math.max(dt, 1e-4);
    }

    /*
     * Kerb strike: leaving the tarmac at speed.
     *
     * This is the rule that makes "floor it everywhere" a bad strategy without
     * a single line of explanatory text. Seventy is the threshold because it
     * is fast enough that you meant it.
     */
    const paved = this.surface.grip >= 0.9;
    if (this._wasPaved && !paved && v > 19.4) {
      this.shock('a kerb at speed', clamp((v - 19.4) / 10, 0.2, 1));
    }
    this._wasPaved = paved;

    // Locked wheels: a long hard stop on a loose surface rattles the load.
    if (brakeIn > 0.85 && v > 8 && grip < 0.8) {
      this._lockT += dt;
      if (this._lockT > 0.35) {
        this.shock('heavy braking', clamp(grip < 0.6 ? 0.5 : 0.3, 0, 1));
        this._lockT = 0;
      }
    } else {
      this._lockT = 0;
    }

    /*
     * In the water. heightAt, not groundAt, because the question is where the
     * island is, not where the mesh drew it.
     */
    if (heightAt(this.pos.x, this.pos.z) <= 0.2) {
      this.swamped = true;
      this.recoverT = 2.5;
      this.air = false;
      this.shock('a soaking', 1);
    }

    /*
     * Remember somewhere sensible to be put back down. Sampled rather than
     * kept every frame so that reversing into the sea does not record the sea.
     */
    this._goodT += dt;
    /*
     * And it has to be FLAT, not merely dry.
     *
     * The test was grip and height only, so the last good place could be a
     * thirty-per-cent beach slope four metres from the water, with the van
     * still facing the sea. The recovery truck put you back exactly there and
     * gravity — which beats the "parked is parked" clamp on that grade — rolled
     * you straight back in. Measured: nought to 3.66 m/s and in the water again
     * 4.9 seconds after being rescued, with the engine off and nobody touching
     * anything. Hold the accelerator and it is an endless loop.
     */
    if (this._goodT > 0.5 && !this.air && v > 1 && this.surface.grip >= 0.55 && centreH > 3) {
      const ahead = groundAt(this.pos.x + Math.sin(radNow) * 12, this.pos.z - Math.cos(radNow) * 12);
      const side = groundAt(this.pos.x + Math.cos(radNow) * 12, this.pos.z + Math.sin(radNow) * 12);
      const level = Math.max(Math.abs(ahead - centreH), Math.abs(side - centreH)) < 1.4;
      if (level && ahead > 2) {
        this._goodT = 0;
        this.lastGood = { x: this.pos.x, z: this.pos.z, heading: this.heading };
      }
    }

    this.applyAttitude(dt, radNow, groundPitch, groundRoll);
  }

  /**
   * The body, on top of the chassis.
   *
   * Ground attitude is where the wheels are; the rest is weight transfer — it
   * dives under the brakes, squats on the power and leans on the lateral load.
   * All three are display angles, smoothed, and none of them feed back into
   * the physics. That is deliberate: a car that leans is worth a lot and a car
   * that solves six degrees of freedom is worth nothing extra at this size.
   */
  applyAttitude(dt, rad, groundPitch, groundRoll) {
    const S = this.spec;
    const along = (this.throttle * S.accel - this.brakes * S.brakeDecel) * 0.006;
    const lean = (this.latAccel / S.latGrip) * S.bodyRoll;
    const k = clamp(dt * 6, 0, 1);
    this.pitch = lerp(this.pitch, groundPitch + along, k);
    this.bank = lerp(this.bank, groundRoll + clamp(lean, -0.3, 0.3), k);
    this.quat.setFromEuler(new THREE.Euler(this.pitch, -rad, this.bank, 'YXZ'));
  }

  /* ------------------------------------------------------ the sea -- */

  /**
   * Is the sea on the bow?
   *
   * 1 means straight into it and 0 means running with it. The wind is stored
   * the way aviation reports it — the direction it is coming FROM — so a wind
   * from 090 is a head sea for a boat heading 090.
   */
  headSeaFactor(weather) {
    if (!weather) return 0.5;
    const from = weather.windDirDeg ?? 90;
    const rel = (((from - this.heading) % 360) + 360) % 360;
    return 0.5 + 0.5 * Math.cos((rel * Math.PI) / 180);
  }

  /** Bodily drift downwind, in metres per second, as a world vector. */
  leeway(weather) {
    if (!weather || this.aground) return { x: 0, z: 0 };
    const kts = weather.effectiveWindKts != null ? weather.effectiveWindKts : weather.windSpeedKts || 0;
    const mps = kts * 0.514444;
    const drift = mps * 0.035 * (1 + this.sea * 0.5);
    // Blowing FROM windDirDeg means going TOWARDS windDirDeg + 180.
    const to = (((weather.windDirDeg ?? 90) + 180) * Math.PI) / 180;
    return { x: Math.sin(to) * drift, z: -Math.cos(to) * drift };
  }

  /**
   * What the sea does to her: heave, pitch, roll, spray and the slam.
   *
   * The wave field is sampled at the boat's own position, not only in time,
   * so waves march past as you steam through them instead of the whole ocean
   * breathing in unison under a boat that is standing still.
   */
  seaMotion(dt) {
    const S = this.spec;
    const sea = this.sea;
    // Bigger seas are longer seas: three seconds in a calm, five and a half
    // in a gale, which is why a gale feels heavy rather than merely fast.
    const T = 3 + sea * 2.5;
    const w = (Math.PI * 2) / T;
    const amp = (S.bobAmp || 0.1) + sea * 0.75;
    const phase = this.t * w + this.pos.x * 0.017 + this.pos.z * 0.011;
    const h = Math.sin(phase) * amp + Math.sin(phase * 1.7 + 1.1) * amp * 0.45;
    const rate = (h - this.heave) / Math.max(dt, 1e-3);

    /*
     * The slam. Falling into a trough at speed in a real sea puts the whole
     * boat through a bang you feel in your feet — and it is the one moment
     * that tells a child, without a word of UI, that Full ahead is not free
     * in this weather. Cheap to detect: she is dropping fast, she is going
     * fast, and the sea is big enough to have troughs worth falling into.
     */
    if (rate < -0.9 && Math.abs(this.speed) > 6 && sea > 0.45) {
      if (!this._slamCool || this._slamCool <= 0) {
        this._slamCool = T * 0.45;
        this.jolt = clamp(this.jolt + 0.25 + sea * 0.3, 0, 1);
        this.speed *= 0.97;
        this.events.push({ kind: 'slam', strength: clamp(sea, 0, 1) });
      }
    }
    this._slamCool = (this._slamCool || 0) - dt;

    this.heave = h;
    this.heaveRate = rate;
    // Pitch follows the slope of the wave, roll follows it a beat later.
    this.seaPitch = -Math.cos(phase) * (0.02 + sea * 0.12);
    this.seaRoll = Math.sin(phase * 0.8 + 2.1) * (0.01 + sea * 0.2);
    // Spray for whoever draws it: how fast you are going, times how rough it
    // is. Reuses the precipitation layer; this file only publishes a number.
    const f = clamp(Math.abs(this.speed) / S.topSpeed, 0, 1);
    this.spray = clamp(f * 0.45 + sea * f * 0.9, 0, 1);
  }

  step(x, z, d) {
    const rad = (this.heading * Math.PI) / 180;
    return { x: x + Math.sin(rad) * d, z: z - Math.cos(rad) * d };
  }

  /**
   * What the instruments, the sound and the missions read.
   *
   * Both shapes keep speedKts / speedKph / heading / throttle / crashed /
   * distanceM, because that is the set hud.setVehicle and audio.updateVehicle
   * have always read and neither of them should have to know which vehicle
   * this is.
   */
  readouts() {
    return this.isBoat ? this.boatReadouts() : this.carReadouts();
  }

  boatReadouts() {
    const d = DETENTS[this.lever];
    return {
      // Which of the two this is. The audio used to sniff it from the
      // presence of `lever`, which works until a car gets one.
      kind: this.isBoat ? 'boat' : 'car',
      // The one-shot list, as the same array and not a copy. Whoever reads it
      // must not mutate it; takeEvents() is the draining read.
      events: this.events,
      // Everything the shipped HUD and the audio already read, unchanged, so
      // this file can land before the HUD work does and nothing breaks.
      speedKts: Math.abs(this.speed) * 1.94384,
      speedKph: Math.abs(this.speed) * 3.6,
      heading: this.heading,
      throttle: Math.abs(this.throttle),
      crashed: this.crashed,
      distanceM: this.distance,
      // And what a boat HUD needs.
      lever: this.lever,
      leverLabel: d.label,
      leverId: d.id,
      astern: this.speed < -0.05,
      depth: this.depth,
      depthWord: this.depth < 1 ? 'SHALLOW' : this.depth < 3 ? 'shoaling' : 'deep water',
      sea: this.sea,
      seaWord: this.seaWord,
      aground: this.aground,
      dents: this.dents,
      spray: this.spray,
      jolt: this.jolt,
      heave: this.heave,
      snatch: this.snatch,
      // True when the engine is off the job and she is still going: this is
      // the thing to put on the HUD in words, so a child reads momentum
      // rather than concluding the controls have stopped responding.
      carryingWay: !this.aground && Math.abs(this.speed) > 0.6 && this.demand <= 0,
    };
  }

  carReadouts() {
    return {
      // Which of the two this is. The audio used to sniff it from the
      // presence of `lever`, which works until a car gets one.
      kind: this.isBoat ? 'boat' : 'car',
      // The one-shot list, as the same array and not a copy. Whoever reads it
      // must not mutate it; takeEvents() is the draining read.
      events: this.events,
      speedKts: Math.abs(this.speed) * 1.94384,
      speedKph: Math.abs(this.speed) * 3.6,
      heading: this.heading,
      throttle: Math.abs(this.throttle),
      crashed: this.crashed,
      distanceM: this.distance,
      /* ---- what the driving HUD asks for ---- */
      surface: this.surface ? this.surface.kind : 'tarmac',
      grip: this.surface ? this.surface.grip : 1,
      slip: this.slip,
      slide: this.slide,
      gear: this.gear,
      airborne: this.air,
      swamped: this.swamped,
      recoverT: Math.max(0, this.recoverT),
      latG: this.latAccel / 9.81,
      shockFlash: this.shockFlash || 0,
    };
  }
}

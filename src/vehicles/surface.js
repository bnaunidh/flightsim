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
import { heightAt, isPaved, obstacleAt, MAP, OBSTACLES, PLATFORMS, platformAt } from '../world/terrain.js';
import { clamp, lerp } from '../core/noise.js';

/** Sea level. The ocean is a flat plane at y=0 with a decorative swell. */
export const SEA = 0;

const _carEuler = new THREE.Euler();
/** Vertical ground speed, m/s, past which the ground under the van is a seam
 *  in the height field rather than a slope: 30 m/s up a 20% grade is 6. */
const SEAM_V = 7;
/** The fastest the road can carry the body upward, m/s: 2 is a 7% climb at
 *  top speed. Past it the wheels climb and the springs take the difference. */
const RISE_MAX = 2;
/** How hard the springs pull the body down after a falling road while the
 *  wheels are still on it, m/s². Gravity alone is 9.81; see the vertical in
 *  updateCar for why it is two and a half times that. In the air it is g. */
const STICK = 9.81 * 2.5;
/** The handbrake on its own, as a fraction of the footbrake: the back wheels
 *  locked, which is most of a stop but not all of one. See updateCar. */
const HANDBRAKE = 0.6;
/*
 * Stability control, the thing every van since 2014 has: when the wheel asks
 * for more corner than the tyres can give, it takes the engine off and brakes
 * a little, so the van slows into the bend instead of running wide at full
 * power. Fades in between these two speeds (30 and 60 km/h, m/s): below the
 * first, full lock is the steering lock and not the grip. See updateCar.
 */
const ESC_FROM = 8.3;
const ESC_FULL = 16.7;
/** Its brake, m/s² before grip, and how much of the engine it takes. */
const ESC_BRAKE = 3.5;
const ESC_CUT = 0.7;
/*
 * The van's footprint for bumping into things: the corners and the middle of
 * its nose (or tail, backing up), metres from its centre. The collision was
 * one point at the centre, so the front half of the van was inside a wall
 * before anything stopped it — the reviewer's chase camera looked at a wall
 * with no van in front of it.
 */
const NOSE = 2.3;
const HALF_W = 0.85;
/** Turning on the spot against a wall, with the go key and a steering key, deg/s. */
const PIVOT = 45;

/**
 * How many 1.5 cm shuffles back a pinned van may take to make room for a
 * turn: four against something under 3 m square (a tree's trunk), one
 * against anything bigger (a wall). See the pivot in updateCar.
 */
function shuffles(o) {
  return o && o.x1 - o.x0 < 3 && o.z1 - o.z0 < 3 ? 4 : 1;
}

/** obstacleAt's own test, over a shorter list (SurfaceVehicle.nearObstacles). */
function boxAt(list, x, y, z) {
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1 && y >= o.y0 && y <= o.y1) return o;
  }
  return null;
}

/**
 * What the van hit, in words a van would use. The collision boxes were all
 * registered for the aeroplane, so their messages say "You flew into a tree".
 */
export function carWords(what) {
  if (!what) return 'a bump';
  const w = String(what).replace(/^you\s+(flew|crashed|ran|drove)\s+into\s+/i, '').replace(/^you\s+hit\s+/i, '');
  return w || 'a bump';
}

const DEG = Math.PI / 180;

/*
 * Scratch objects for the boat's per-frame maths. The boat ran three `new`s a
 * frame — an Euler for the attitude, and an object each from step() and
 * leeway() — which on a school Chromebook is garbage the collector has to
 * come back for in the middle of a turn.
 */
const _euler = new THREE.Euler();
const _tip = { x: 0, z: 0 };
const _lee = { x: 0, z: 0 };
/** Where lookAhead() sounds ahead of the bow, in metres. */
const LOOK_AHEAD = [12, 25, 40];
/**
 * The deck edge, as fractions of her half-beam and half-length (+z is aft):
 * the transom corners, amidships, and the shoulders of the bow. See
 * freeboardLift.
 */
const DECK_EDGE = [-1, 1, 1, 1, -1, 0, 1, 0, -0.75, -0.8, 0.75, -0.8, -0.3, -1, 0.3, -1];
/** hullLow()'s answer, reused: the lowest deck point and the lowest point of her bottom. */
const _low = { deck: 0, keel: -Infinity };
const smoothstep01 = (t) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * How much of the open sea reaches this spot: 1 outside, a fifth inside the
 * harbour basin, and a smooth rise over the 150 m beyond the walls.
 *
 * A harbour is the one place a gale does not get in — that is what the
 * breakwater is for. Without this the Gale's 28 kt pushed the launch
 * bodily across the basin at 0.7 m/s while she was being asked to creep up
 * to the quay at under two knots, and she could not get within the 22 m the
 * shout wants: measured, she hung 26 to 33 m off the berth for the last
 * two and a half minutes of the run and the clock ran out.
 */
function harbourShelter(x, z) {
  const H = MAP && MAP.waters && MAP.waters.harbour;
  if (!H || H._du === undefined) return 1;
  const dx = x - H.cx;
  const dz = z - H.cz;
  const u = dx * H._du + dz * H._dv;
  const v = -dx * H._dv + dz * H._du;
  const out = Math.max(Math.abs(u) - H.length / 2, Math.abs(v) - H.width / 2);
  const t = clamp((out + 20) / 170, 0, 1);
  return 0.2 + 0.8 * t * t * (3 - 2 * t);
}

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
 * `roll + dragK * v²`, and where they meet is the top speed. The spread is the
 * reason to have surfaces at all, and it is emergent, so tuning one number
 * moves the whole island consistently.
 *
 * GRASS WAS A TRAP, not a surface. The comment here promised 40 km/h on it;
 * what a child actually got, holding Shift for ten seconds on flat grass on
 * Drover's Flat, was 20 km/h — because 5.0 x 0.55 of drive against 2.0 of
 * rolling resistance leaves 0.75 m/s² to accelerate with, so the van took
 * most of a minute to get anywhere near its own top speed. Leave the road by
 * a metre and the game went into slow motion. Now, with the engine below and
 * grass at 0.6 grip and 1.5 rolling: 57 km/h after ten seconds on the flat,
 * 69 flat out — plainly slower than the road, and still a van. Worked through
 * the same equations at 60 Hz:
 *
 *   tarmac 104 km/h   gravel 83   grass 69   sand 45
 */
/*
 * `drawnLift` is how far above the ground the surface is DRAWN, metres. Made
 * ground is a mesh laid over the terrain and lifted clear of it so the two do
 * not z-fight: the road ribbon by six centimetres (roadRibbon's `lift`), the
 * runway, taxiways and apron by five to six (airport.js, ELEV + 0.05). Grass,
 * sand and the gravel verge (which slopes down into the grass) are drawn on
 * the ground itself. The van's MODEL rides this, so its tyres are on the
 * tarmac on the road and on the grass off it — see SurfaceVehicle.drawnLift.
 */
export const SURFACES = {
  tarmac: { kind: 'tarmac', grip: 1.0, roll: 0.45, rough: 0.0, drawnLift: 0.06 },
  gravel: { kind: 'gravel', grip: 0.72, roll: 1.1, rough: 0.55 },
  grass: { kind: 'grass', grip: 0.6, roll: 1.5, rough: 0.85 },
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

/*
 * Things standing in the water that are not in the height field: the
 * lifeboat's pontoon, drawn by world/water.js. The launch went straight
 * through it — measured: from the berth, lever to Half and hard to port for
 * the pontoon seven metres off, and she passed under its deck and out of the
 * far side without a touch, because nothing she tests knew it was there.
 * water.js hands its footprint in here when it builds it (injected, like the
 * probes above, so this file imports nothing new), and a hull that reaches it
 * gets the same bump and back-off as a quay wall.
 *
 * Each entry: { x, z, ax, az, halfL, halfW, what }, the centre, a unit vector
 * along its length, its half-length and half-width, and its name for the
 * "You hit ..." line.
 */
const FURNITURE = [];

export function setSeaFurniture(list = []) {
  FURNITURE.length = 0;
  for (const f of list) if (f) FURNITURE.push(f);
}

/** The name of whatever solid thing is within `pad` metres of (x, z), or null. */
function furnitureAt(x, z, pad) {
  for (let i = 0; i < FURNITURE.length; i++) {
    const f = FURNITURE[i];
    const dx = x - f.x;
    const dz = z - f.z;
    const along = dx * f.ax + dz * f.az;
    const across = -dx * f.az + dz * f.ax;
    if (Math.abs(along) < f.halfL + pad && Math.abs(across) < f.halfW + pad) return f.what;
  }
  return null;
}


/**
 * The ground as drawn, on its own, leaving the surface probe alone.
 *
 * `meshHeightAt` was written for and never given. The van rode heightAt —
 * the analytic ground — while the eye sees the terrain MESH, which is that
 * ground sampled every 24 to 39 m and joined with flat triangles. Where the
 * mesh is the higher of the two the van sank into grass the child could
 * see. The van's startDrive branch (IslandRoads.van in jobs.js) hands the
 * built mesh over when the van goes on the island and its stopDrive branch
 * lets go; only the car's code reads it (the boat rides SEA), so a boat
 * after a van is not affected either way. The next map load
 * (setTerrainProbes from layRoads) takes it away again, so it can never
 * point at a terrain that has been rebuilt.
 *
 * `fn(x, z)` is the ground as drawn — roads.js's drawnGroundSampler, which
 * knows where the tarmac is — and returns -Infinity off the mesh, where
 * heightAt takes over.
 */
export function setGroundMesh(fn) {
  PROBES.meshHeightAt = fn || null;
}

/**
 * Ground height for anything that sits ON the ground: the ground as drawn,
 * which roads.js's drawnGroundSampler works out and main.js hands over.
 *
 * ON THE TARMAC that is the higher of the drawn mesh and heightAt, as it has
 * been. The mesh on its own was not the ground a van can ride: it is
 * heightAt sampled every 25 m, and a corridor is 36 m across, so wherever
 * heightAt steps — the edge of a corridor, two corridors meeting — the mesh
 * draws the step as a bank that can run under the tarmac. Measured on Cape
 * Vessel at (-1150, 180), on the Kerrow road: the mesh 108.2 at the
 * centreline and 104.0 five metres to the right, a 40% cross-fall under one
 * wheel, where heightAt is 108.2 right across. Over every job on all eight
 * car islands, same driver, mesh alone against the higher of the two:
 * "Hard landing" 18 against 13, and 68 against 47 of 3,917 sampled points
 * where the drawn tarmac falls more than 8% side to side.
 *
 * OFF IT, the higher of the two was wrong: where heightAt rises between two
 * terrain vertices the mesh draws the chord under it, and the van hovered
 * over the grass — on Drover's Flat 2.0% of off-road points within 1.5 km
 * of the depot by more than 50 cm, the worst by 5 m. There the van rides
 * the mesh, because the mesh is the grass. The sampler draws the verge
 * between the two the way the ribbon does.
 *
 * With no sampler (a boat's world, a map not yet built, off the edge of
 * every chunk) it is heightAt, as it always was. A deck — the carrier —
 * is not drawn by the terrain at all, so on one it is heightAt too.
 */
function groundAt(x, z) {
  if (PROBES.meshHeightAt && !(PLATFORMS.length && platformAt(x, z))) {
    const g = PROBES.meshHeightAt(x, z);
    if (g > -Infinity) return g;
  }
  return heightAt(x, z);
}

/** The same ground, for the van's camera and the job marker. */
export function groundHeight(x, z) {
  return groundAt(x, z);
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
    // The shared table entry itself when the probe only names a kind: this
    // runs every frame, and a fresh spread object per frame is garbage.
    if (s && SURFACES[s.kind] && s.grip == null) return SURFACES[s.kind];
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
    /*
     * Prop wash. A rudder sits in the propeller's stream, so opening the
     * lever turns her head before she has much way on — which is how a boat
     * is kicked round in a tight spot. Measured from rest with the wheel hard
     * over: 8.2 degrees in the first second of Full with this, 5.7 without,
     * and 30 a second once she is going. At Slow it adds little (2.8 degrees
     * a second over the first two), which is right: it is the burst of power
     * that turns her, not the idle.
     */
    propWash: 0.45,
    /*
     * The lean into a turn, in radians at full rudder and speed. It was 0.42
     * — 24 degrees, measured 26 with the swell on top — which is a jet ski
     * falling over, not a launch. 0.2 is 11 degrees: you can see it from the
     * chase camera and she still looks like she is in the water.
     */
    bankInTurn: 0.2,
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
    /*
     * How much of that heave the hull is DRAWN doing.
     *
     * The ocean is a flat plane at y = 0 with its waves painted on in normal
     * maps, so a hull that rises and falls the full 0.3 m of a calm-day heave
     * against it is not riding a wave — she is being lifted clear of a flat
     * floor and dropped through it, and every trough put the deck under.
     * The existing float test measures ±0.29 m of it at STOP. Forty per cent
     * of it reads as a swell under her (and all of it still drives the slam
     * and the camera, which is where it is felt).
     */
    heaveShown: 0.4,
    /*
     * And never more than this much of it, either way. Forty per cent of a
     * gale's heave is ±0.49 m, which against a flat sea is the whole hull
     * rising clear and then the deck going under. The rest of a gale is in
     * the pitch, the roll, the slam, the camera and the sound.
     */
    heaveShownMax: 0.15,
    /*
     * Her deck edge, for freeboardLift: 0.35 m above the waterline at its
     * lowest (the pack launch's deck, measured with the model at the
     * origin), 3.5 m forward and aft of the middle, 1.15 m either side.
     * A replacement model with a different hull changes these three — or,
     * as the Blender launch does, hands its own deck points to fitHull().
     */
    freeboard: 0.35,
    halfLength: 3.5,
    halfBeam: 1.15,
    freeboardClear: 0.08,
    /*
     * And the other way: her bottom is never drawn clear of the sea. The sea
     * is a flat plane, so a hull lifted right out of it is not riding a
     * crest, it is flying. A hull that says where its bottom is (fitHull)
     * is kept at least this deep; the pack launch does not say, and its
     * 0.22 m of lift never needed it. The Blender launch climbs 0.45 m onto
     * the plane, and in the Gale's 0.15 m of drawn heave at 21 kt, bow a
     * touch down, that took her flat keel 0.05 m clear of the water.
     */
    keelImmersion: 0.15,
    /*
     * A boat on the end of a tow line, as square drag. Both tows tell the
     * child "Half ahead at most" and "under twelve knots" — and with nothing
     * on the line slowing her, Half was 19.8 kt, so doing exactly what the
     * words said parted the line. Measured with this, a minute at each detent
     * in First Shout's 7 kt: Half settles at 11.0 kt with a boat astern
     * (under the 12.6 kt the line takes), Slow at 4.5, and Full at 15.0 —
     * over it, and the tow's strain, which builds at 0.55 a second while she
     * is over, parts the line inside two seconds. missions-boat.js sets
     * `towLoad` to 1 while the line is fast and 0 when it is not; nothing
     * else touches it.
     */
    towDragK: 0.0476,
    /*
     * On the plane she lifts and trims. The old display trim was 0.14 rad —
     * eight degrees bow-up about the middle of a 7.4 m hull, which works out
     * at the transom 0.5 m DOWN at Full, below her 0.39 m of freeboard. A planing
     * hull rises as she comes up to speed; 0.22 m of lift and five degrees of
     * trim keeps the transom out of the water all the way to Full.
     */
    planeLift: 0.22,
    planeTrim: 0.09,
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
    /** Top speed on tarmac, m/s. 29 ≈ 105 km/h; the drag curve settles at 104. */
    topSpeed: 29,
    /**
     * Engine, m/s² at the wheels before grip, standing still.
     *
     * It said "0–50 km/h in about three seconds" over a flat 5.0, and a flat
     * 5.0 is 3.7 s measured on the road out of the depot — and it pulled
     * exactly as hard at 90 as at 10, which is not an engine, it is a rocket.
     * A real engine's push falls away as the speed builds (`powerFall`), so
     * this can be brisker off the line without being faster at the top: 7.0
     * falling by half at top speed, worked through on the flat, is 50 km/h in
     * 2.7 s and 99 km/h after ten (against 3.4 s and 96), and the same 104 at
     * the end. Measured on the depot road with a child's Shift and steering:
     * 50 km/h in 2.9 s, where it was 3.7.
     */
    accel: 7.0,
    /** How much of the push is gone at top speed. See `accel`. */
    powerFall: 0.5,
    /**
     * Aerodynamic drag, chosen so drag plus rolling resistance equals the
     * engine's push at topSpeed: (accel x (1 - powerFall) - 0.45) / 29².
     * Change one and change the others.
     */
    dragK: 0.00363,
    /**
     * Lift off and the engine holds you back, m/s².
     *
     * Without it, letting go of everything at 92 km/h coasted for 18 seconds
     * and 201 m, which a ten-year-old reads as the keys not working. With 0.9,
     * measured the same way on the same road: 9.5 s and 102 m — still
     * momentum you can see, and it stops. It fades out below 2 m/s, where
     * "parked is parked" takes over.
     */
    engineBrake: 0.9,
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
    /**
     * How far the body leans, radians at the grip limit.
     *
     * 0.16 was 9 degrees, measured at 10.3 in a full-lock circle on grass
     * once the ground's own camber was added: a van that heels over like a
     * boat. 0.09 measures 5.2 degrees in the same circle on the runway, which
     * reads as lean and not as about to tip.
     */
    bodyRoll: 0.09,
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
    /*
     * What the echo sounder actually reads: water under the keel with the
     * keel where it is NOW, which rides up and down on the swell. `depth` is
     * the chart's number for this spot and does not move while the bottom
     * does not; the sounder's does, which is what makes it an instrument.
     */
    this.sounding = 9;
    /** Metres ahead to the first water too shallow for her, or 0 if none. */
    this.shoalAhead = 0;
    this._aheadT = 0;
    /** Bumps this outing, for whoever keeps score. */
    this.groundings = 0;
    /** +1 ahead or -1 astern: which way off the bottom is. 0 when afloat. */
    this._escape = 0;
    /** Last frame's lever keys, so a press is seen on the frame it happens. */
    this._upWas = false;
    this._downWas = false;
    this._shownHeave = 0;
    /** 1 while a boat is on the tow line behind her, 0 otherwise. */
    this.towLoad = 0;
    /** 1 in open water, 0.2 in a harbour: see harbourShelter. */
    this.shelter = 1;
    /** True from a tap of Space until she has stopped: see the crash stop. */
    this._crashStop = false;
    /**
     * The drawn hull's own numbers, from the model that draws her (see
     * fitHull), or null for the spec's: the pack launch's deck edge and lift.
     */
    this.hull = null;
    /** How much freeboardLift raised her this frame, for the tests. */
    this.dryLift = 0;

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
    /** Times it has come down after leaving the ground, and how hard the
     *  last one was (closing speed with the ground, m/s). The load reads it. */
    this.landings = 0;
    this.lastLanding = 0;
    /**
     * How far above the ground under the van its tyres should be DRAWN: the
     * lift of the made surface it is on (see SURFACES), eased. The physics
     * rides `rideHeight` over the ground whatever the surface; the model
     * rides this. Null until the first frame has seen a surface.
     */
    this.drawnLift = null;
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
    this._upWas = false;
    this._downWas = false;
    this._escape = 0;
    this._aheadT = 0;
    this._shownHeave = 0;
    this.towLoad = 0;
    this.shelter = this.isBoat ? harbourShelter(this.pos.x, this.pos.z) : 1;
    this._crashStop = false;
    this.shoalAhead = 0;
    this.groundings = 0;
    this.seaPitch = 0;
    this.seaRoll = 0;
    this.events.length = 0;
    this.pos.y = this.surfaceY(this.pos.x, this.pos.z);
    this.depth = this.depthAt(this.pos.x, this.pos.z);
    this.sounding = this.depth;
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
    this.landings = 0;
    this.lastLanding = 0;
    this.drawnLift = null;
    this._restY = null;
    this._gap = 0;
    this._carryVy = 0;
    this._shocks.length = 0;
    this._goodT = 0;
    this._lockT = 0;
    this.esc = 0;
    this._drive = 0;
    /** Seconds pinned head-on against something with the go key held. */
    this.blockedT = 0;
    this._pinT = 0;
    /** While pinned, which way it can turn out (see the bumps): -1, 1, 2 or 0. */
    this.pinWay = 2;
    this.lastGood = { x: this.pos.x, z: this.pos.z, heading: this.heading };
  }

  /**
   * The surface the vehicle rides on.
   *
   * A boat rides the sea. A car rides groundAt: the ground as drawn — the
   * tarmac on the road, the terrain's triangles off it (see groundAt).
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
   *
   * THE NEWEST PRESS WINS. The first version read "up if Shift is down, else
   * down if Ctrl is down", so a child who had been holding Shift to get her
   * going and then pressed Ctrl to slow down got nothing at all: Shift was
   * still down, so the lever stayed at FULL for as long as Ctrl was held.
   * Measured (tests/features/boat-playtest, P16): lever 4 after holding
   * Ctrl for 1.5 s with Shift never released — and that is exactly how a
   * ten-year-old's hands are on a keyboard. Now a key acts on the frame it goes down and repeats while it
   * stays the key in charge; a key that was already down before the other
   * one was pressed does not take the lever back until it is pressed again,
   * so tapping Ctrl with Shift still held steps her down one detent a tap
   * instead of down and straight back up.
   */
  leverKeys(dt, up, down) {
    const upEdge = !!up && !this._upWas;
    const downEdge = !!down && !this._downWas;
    this._upWas = !!up;
    this._downWas = !!down;
    // Both on one frame: slowing down is the safe guess.
    const fresh = downEdge ? -1 : upEdge ? 1 : 0;
    if (fresh) {
      this._leverHeld = fresh;
      this._leverRepeat = 0.45;
      this.nudgeLever(fresh);
      return;
    }
    const dir = this._leverHeld;
    if (!dir || !(dir > 0 ? up : down)) {
      this._leverRepeat = 0;
      this._leverHeld = 0;
      return;
    }
    this._leverRepeat -= dt;
    if (this._leverRepeat <= 0) {
      this._leverRepeat = 0.25;
      this.nudgeLever(dir);
    }
  }

  /**
   * Watch the lever keys without acting on them.
   *
   * While something else owns the lever — the crash stop, or the bottom —
   * the keys still have to be watched, or the frame they are handed back a
   * key that has been held all along looks like a brand new press and the
   * lever jumps. Whatever was held stops being in charge.
   */
  ignoreLeverKeys(up, down) {
    this._upWas = !!up;
    this._downWas = !!down;
    this._leverHeld = 0;
    this._leverRepeat = 0;
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
   * It WAS still possible to end a run by driving a hard bottom at over
   * 9 m/s, "which is a thing you have to work at". It is not: it is holding
   * Shift. Measured on Sennen, First Shout: hold Shift for twenty seconds
   * from the berth — which is what every child does first — and she is in
   * the harbour mouth at 13.9 m/s; hold D to take the first turn and three
   * seconds later she is on the west breakwater arm, crashed, "press Esc".
   * The other way (A) she stuck on the east arm with the lever walking back
   * up to FULL under the held key, ahead doing nothing, for ever.
   *
   * So there is no ending here any more, at any speed. Every touch is a BUMP:
   * a bang, a shake, a small dent, and she bounces back off it and backs
   * herself off — the lever is put where the way off is (astern if she was
   * going ahead, ahead if she backed into it) and held there until she is
   * clear, whatever keys are down, because a child who has just hit
   * something is usually still holding the key that did it. When she is a
   * boat's length clear the lever goes to STOP and the helm is theirs again.
   */
  takeTheGround(groundY, what) {
    const v = Math.abs(this.speed);
    const travel = this.speed < -0.05 ? -1 : 1;
    this.aground = true;
    this.groundings++;
    this._groundAt = { x: this.pos.x, z: this.pos.z };
    this._escape = -travel;
    // The bounce. A fifth of the way she had on, back the way she came: a
    // metre a second off a Half-ahead touch, two off a Full-ahead one.
    this.speed = -travel * clamp(v * 0.18, 0.5, 2.2);
    this.slip = 0;
    // A dent per touch, and a small one. It was 0.12 + v/40 — 0.47 for a
    // single Full-ahead bump, so two bumps took a third of her thrust for
    // the rest of the trip, which a child reads as the boat getting broken.
    this.dents = clamp(this.dents + 0.04 + v / 140, 0, 1);
    const hard = groundY > -0.3 || !!what;
    const strength = clamp(0.3 + v / 14 + (hard ? 0.15 : 0), 0, 1);
    this.jolt = clamp(this.jolt + strength, 0, 1);
    this.events.push({ kind: 'bang', strength });
    this.setLever(travel > 0 ? 0 : LEVER_SLOW);
    this.agroundMessage = what
      ? `Bump! You hit ${what} — backing her off`
      : travel > 0
        ? "Bump! Too shallow — you're on the putty. Backing her off…"
        : "Bump! Shallow behind you — you're on the putty. Easing her ahead…";
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
      this.sea = seaStateFrom(weather) * this.shelter;
      this.seaWord = seaWordFor(this.sea);
    }

    if (this.crashed) {
      this.speed = lerp(this.speed, 0, clamp(dt * 1.5, 0, 1));
    } else if (boat) {
      this.steer = clamp(controls.steer ?? 0, -1, 1);

      /* ---- the lever ------------------------------------------------- */
      const keys = controls.lever || null;
      const keyUp = !!(keys && keys.up);
      const keyDown = !!(keys && keys.down);
      if (this.aground) {
        // The bottom has the lever until she is clear of it: see
        // takeTheGround. The keys are watched, not obeyed.
        this.setLever(this._escape < 0 ? 0 : LEVER_SLOW);
        this.ignoreLeverKeys(keyUp, keyDown);
        this._crashStop = false;
      } else if (controls.crashStop || this._crashStop) {
        /*
         * Space is a crash stop: one key, straight to astern, for the moment
         * a child realises the quay is not going to move.
         *
         * And it STOPS her. It used to put the lever on ASTERN and leave it
         * there, so the stop was followed by the boat going backwards: tap
         * Space at Full and she took the way off in 36 m, stood still for a
         * frame and then ran astern at 4.7 kt until somebody found Shift —
         * measured, 60 m astern of where she stopped twenty seconds later,
         * which is the quay the child was trying not to hit. The key hint
         * says "Space stop". Now one tap is the whole manoeuvre: the lever
         * goes to ASTERN while she has way on, and to STOP the moment she
         * has none; a lever key during it hands the lever straight back.
         */
        if (controls.crashStop && !this._crashStop) this._crashStop = true;
        if ((keyUp && !this._upWas) || (keyDown && !this._downWas)) {
          this._crashStop = false;
          this.leverKeys(dt, keyUp, keyDown);
        } else if (this.speed > 0.3) {
          this.setLever(0);
          this.ignoreLeverKeys(keyUp, keyDown);
        } else {
          this.setLever(LEVER_STOP);
          this.ignoreLeverKeys(keyUp, keyDown);
          if (!controls.crashStop) this._crashStop = false;
        }
      } else if (controls.leverIndex != null && controls.leverIndex !== this.lever && !keyUp && !keyDown) {
        /*
         * The on-screen lever, on an iPad. It used to be the last branch of
         * three, after `controls.lever` — which main.js always passes, as an
         * object, so the branch could never run: a thumb on FULL set the touch
         * state, the next frame ignored it, and touch.updateBoat copied the
         * boat's STOP back over it. The touch lever had never moved the boat.
         * It is read now only when it DIFFERS from the boat's own lever, which
         * is how a new touch looks, because touch.updateBoat syncs the two at
         * the end of every frame.
         */
        this.setLever(controls.leverIndex);
        this.ignoreLeverKeys(keyUp, keyDown);
      } else if (keys) {
        this.leverKeys(dt, keyUp, keyDown);
      }

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
      let retard = (S.dragK * dragScale + (this.towLoad || 0) * (S.towDragK || 0)) * this.speed * v;
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
        // On the bottom: nothing drives her further onto it, and the way off
        // has extra bite because she is being pulled off rather than driven.
        const e = this._escape || -1;
        if (this.speed * e < 0) this.speed = 0;
        else if (this.thrust * e > 0) this.speed += e * S.accel * 0.4 * dt;
      }
      this.speed = clamp(this.speed, -S.asternSpeed, S.topSpeed);
      if (Math.abs(this.speed) < 0.06 && Math.abs(this.demand) < 0.02) this.speed = 0;

      /* ---- steering -------------------------------------------------- */
      // A rudder does nothing without water flowing over it — hers, or the
      // propeller's (see propWash in the spec).
      const byWay = clamp(Math.abs(this.speed) / (S.topSpeed * 0.45), 0, 1);
      const byWash = this.thrust > 0 ? this.thrust * (S.propWash || 0) : 0;
      const auth = S.turnAtRest + (1 - S.turnAtRest) * Math.max(byWay, byWash);
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
        this.takeTheGround(heightAt(tip.x, tip.z), this.wallAt(tip.x, tip.z));
        dx = 0;
        dz = 0;
      }
    }

    this.pos.x += dx;
    this.pos.z += dz;
    this.distance += Math.abs(this.speed) * dt;
    this.vel.set(dx / Math.max(dt, 1e-4), 0, dz / Math.max(dt, 1e-4));

    const hit = obstacleAt(this.pos.x, this.pos.y + 1, this.pos.z);
    if (hit && !this.crashed) {
      /*
       * Something solid — a shed on the quay, a moored hull. This called
       * crash(), which for the boat is the end of the run, and the whole point
       * of the grounding rules above is that nothing a child steers into ends
       * the run. It is a bump like any other: put her back where she was a
       * frame ago and bounce her off it.
       */
      if (!this.aground) {
        this.pos.x -= dx;
        this.pos.z -= dz;
        this.takeTheGround(0, hit.what || 'something solid');
      }
    }
    if (boat && FURNITURE.length && !this.aground && !this.crashed) {
      // Her bow (or her transom, going astern) and her middle, each with her
      // half-beam round it: the pontoon is a hull's width, so testing only
      // her centre point let her bow run a metre and a half into it.
      const end = this.step(this.pos.x, this.pos.z, (S.halfLength || 3.5) * (this.speed < -0.05 ? -1 : 1));
      const pad = S.halfBeam || 1.1;
      const what = furnitureAt(end.x, end.z, pad) || furnitureAt(this.pos.x, this.pos.z, pad);
      if (what) {
        this.pos.x -= dx;
        this.pos.z -= dz;
        this.takeTheGround(0, what);
      }
    }

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
          this._escape = 0;
          // Clear of it, engine stopped, helm handed back. A key still held
          // from before the bump does not count until it is pressed again.
          this.setLever(LEVER_STOP);
          this.events.push({ kind: 'afloat' });
        }
      }
      this.seaMotion(dt);
      this.lookAhead(dt);
    }

    // The attitude first, because where she is drawn depends on it: see
    // freeboardLift.
    const leanTarget = -this.steer * S.bankInTurn * clamp(Math.abs(this.speed) / 8, 0, 1) + (boat ? this.seaRoll : 0);
    this.bank = lerp(this.bank, leanTarget, clamp(dt * 3, 0, 1));
    const pitchTarget = boat
      ? clamp(this.speed / S.topSpeed, 0, 1) * (S.planeTrim ?? 0.14) + this.seaPitch
      : 0;
    this.pitch = lerp(this.pitch, pitchTarget, clamp(dt * (boat ? 5 : 2), 0, 1));

    const base = this.surfaceY(this.pos.x, this.pos.z);
    if (boat) {
      // Follow the sea rather than damping it away. The old lerp of dt*6 was
      // slower than the swell itself in anything but a calm, so a gale looked
      // like a mild ripple from on board. What is drawn is drawnRise's: see
      // there.
      const shown = this.drawnRise(this.heave);
      this.pos.y = lerp(this.pos.y, base + shown, clamp(dt * 12, 0, 1));
      this._shownHeave = this.pos.y - base;
      // The sounder's transducer is on the hull, so it rides with her.
      this.sounding = this.depth + this._shownHeave;
    } else {
      this.pos.y = lerp(this.pos.y, base, clamp(dt * 6, 0, 1));
    }
    this.jolt = Math.max(0, this.jolt - dt * 1.8);
    // A scratch Euler: this runs sixty times a second and a `new` here was one
    // garbage object a frame for the whole of every boat trip.
    this.quat.setFromEuler(_euler.set(this.pitch, -rad, this.bank, 'YXZ'));
  }

  /**
   * Tell her which hull she is drawn with.
   *
   * THE HULL'S POSE HAS ONE OWNER, and it is this file: `pos.y` and `quat`
   * are where the model is drawn (main.js copies them on, less the model's
   * own `userData.waterline`), and nothing after that moves it. What differs
   * from one hull to the next is only where its deck edge and its bottom
   * are and how far it climbs onto the plane, and the model that draws her
   * knows those, so it hands them over here (main.js, straight after
   * building the model). `fit` is the model's `userData.hullFit`:
   *
   *   deck      [x, y, z, ...] in the model's frame (waterline at y = 0, bow
   *             to -Z): the lowest places the sea would come aboard. Kept
   *             `clear` m above the sea by freeboardLift.
   *   clear     m. Default: the spec's freeboardClear.
   *   keel      [x, y, z, ...], her bottom: kept keelImmersion m under the
   *             sea by drawnRise, so she is never drawn flying.
   *   planeLift, liftFrom, liftFullAt
   *             m she rises onto the plane, from `liftFrom` to `liftFullAt`
   *             of top speed (smoothstep). Default: the spec's planeLift x
   *             (speed / top speed) squared.
   *
   * Null puts her back on the spec's numbers, which are the pack launch's.
   * The heave she shows, her trim and her lean into a turn stay the spec's
   * whatever the hull: they are how the boat moves, not how a hull is shaped.
   */
  fitHull(fit) {
    if (!fit || !fit.deck || fit.deck.length < 3) {
      this.hull = null;
      return this;
    }
    const S = this.spec;
    this.hull = {
      deck: Float32Array.from(fit.deck),
      keel: fit.keel && fit.keel.length >= 3 ? Float32Array.from(fit.keel) : null,
      clear: Number.isFinite(fit.clear) ? fit.clear : S.freeboardClear ?? 0.08,
      planeLift: Number.isFinite(fit.planeLift) ? fit.planeLift : null,
      liftFrom: fit.liftFrom ?? 0.2,
      liftFullAt: fit.liftFullAt ?? 0.7,
    };
    return this;
  }

  /**
   * How high her drawn hull rides above the sea's level, for a sea `heave`
   * metres up, at the attitude she is drawn at this frame. The one place
   * this is decided (see fitHull).
   *
   * `heaveShown` of the heave (see the spec), plus the lift of a hull coming
   * up onto the plane; then up by freeboardLift if that would put her deck
   * under, and last down again if it would lift her bottom out of the water
   * — but never so far down that the deck goes under: of the two, a flooded
   * cockpit is the worse picture.
   */
  drawnRise(heave) {
    const S = this.spec;
    const H = this.hull;
    const f = clamp(Math.abs(this.speed) / S.topSpeed, 0, 1);
    const lift =
      H && H.planeLift !== null
        ? H.planeLift * smoothstep01((f - H.liftFrom) / Math.max(1e-3, H.liftFullAt - H.liftFrom))
        : (S.planeLift || 0) * f * f;
    let y = clamp(heave * (S.heaveShown ?? 1), -(S.heaveShownMax ?? 9), S.heaveShownMax ?? 9) + lift;
    const low = this.hullLow();
    const clear = H ? H.clear : S.freeboardClear ?? 0.08;
    this.dryLift = Number.isFinite(low.deck) ? Math.max(0, clear - (low.deck + y)) : 0;
    y += this.dryLift;
    if (Number.isFinite(low.keel)) {
      const fly = low.keel + y + (S.keelImmersion ?? 0.15);
      if (fly > 0) y -= Math.max(0, Math.min(fly, Number.isFinite(low.deck) ? low.deck + y - clear : fly));
    }
    return y;
  }

  /**
   * The lowest point of her deck edge and of her bottom, relative to her
   * origin, at this frame's pitch and bank. Fills and returns `_low`; the
   * bottom is -Infinity for a hull that did not say where it is.
   */
  hullLow() {
    const S = this.spec;
    const H = this.hull;
    const sp = Math.sin(this.pitch);
    const cp = Math.cos(this.pitch);
    const sb = Math.sin(this.bank);
    const cb = Math.cos(this.bank);
    // Euler(pitch, yaw, bank, 'YXZ'): the yaw does not move anything up or
    // down, the roll is applied first and the pitch on top of it.
    let low = Infinity;
    if (H) {
      const d = H.deck;
      for (let i = 0; i + 2 < d.length; i += 3) {
        const y = (d[i] * sb + d[i + 1] * cb) * cp - d[i + 2] * sp;
        if (y < low) low = y;
      }
    } else if (S.freeboard) {
      for (let i = 0; i < DECK_EDGE.length; i += 2) {
        const x = DECK_EDGE[i] * S.halfBeam;
        const z = DECK_EDGE[i + 1] * S.halfLength;
        const y = (x * sb + S.freeboard * cb) * cp - z * sp;
        if (y < low) low = y;
      }
    }
    _low.deck = low;
    _low.keel = -Infinity;
    if (H && H.keel) {
      const k = H.keel;
      let kl = Infinity;
      for (let i = 0; i + 2 < k.length; i += 3) {
        const y = (k[i] * sb + k[i + 1] * cb) * cp - k[i + 2] * sp;
        if (y < kl) kl = y;
      }
      _low.keel = kl;
    }
    return _low;
  }

  /**
   * How far to lift her so that no part of her deck edge is under the sea.
   *
   * The sea is a flat plane with its waves painted on, so a hull drawn
   * pitching and rolling about her waterline puts one end or one side of her
   * deck through a floor that is not moving with her — and that reads as
   * sinking, not as a sea. Measured in the Gale, at Full outside Longbank's
   * harbour, over ten seconds: the lowest point of the deck edge went to 0.80 m
   * UNDER the water and was under it in 51% of frames; the keel ranged from
   * -1.71 to -0.14 m. A real hull cannot put its deck under without the sea
   * coming up with it, so the drawn hull rides up instead: the points round
   * the deck edge (eight off the spec, or the hull's own — the Blender
   * launch's cockpit sole corners and motor-well lip) are put through her
   * pitch and roll, and if the lowest would be less than the clearance above
   * the water she is lifted by the difference. In a calm it does nothing; in
   * a gale she climbs and heels rather than burying her bow. Display only —
   * the physics and the chart `depth` are not lifted with her; the sounder's
   * `sounding` is, because its transducer is on the hull.
   */
  freeboardLift(heave) {
    const S = this.spec;
    const low = this.hullLow().deck;
    if (!Number.isFinite(low)) return 0;
    const clear = this.hull ? this.hull.clear : S.freeboardClear ?? 0.08;
    return Math.max(0, clear - (low + heave));
  }

  /**
   * Is what the bow just found a wall rather than a shoal?
   *
   * Every touch used to say "Too shallow — you're on the putty", including
   * running into the harbour's stone breakwater at Full, which a child can
   * see is not mud. Measured on Sennen (boat-playtest P17): twenty seconds of
   * Full and a turn into either arm, and the caption said putty both times.
   * Four metres on from where the bow touched: if the ground there stands
   * two metres out of the water it is a wall or a rock face, and it is named
   * for what it is. A shoal that dries — Cormorant Rock stands 0.9 m — is
   * still the putty. One heightAt call, only on the frame she touches.
   */
  wallAt(x, z) {
    const rad = (this.heading * Math.PI) / 180;
    const dir = this.speed < -0.05 ? -1 : 1;
    if (heightAt(x + Math.sin(rad) * 4 * dir, z - Math.cos(rad) * 4 * dir) < 2) return null;
    return harbourShelter(x, z) < 0.99 ? 'the harbour wall' : 'the rocks';
  }

  /**
   * Shallow water ahead, before the bump.
   *
   * The sounder only knows what is under her, and at Full she covers the
   * distance between "shoaling" and "aground" in under a second. A child
   * needs to be told while there is still time to turn, so five times a
   * second — three heightAt calls, never per frame — this looks 12, 25 and
   * 40 m down her track and publishes the first one too shallow to float in.
   * The HUD turns that into words; nothing in the physics acts on it.
   */
  lookAhead(dt) {
    this._aheadT -= dt;
    if (this._aheadT > 0) return;
    this._aheadT = 0.2;
    this.shelter = harbourShelter(this.pos.x, this.pos.z);
    this.shoalAhead = 0;
    const v = this.speed;
    if (this.aground || Math.abs(v) < 2) return;
    const dir = Math.sign(v);
    const rad = (this.heading * Math.PI) / 180;
    const sx = Math.sin(rad) * dir;
    const sz = -Math.cos(rad) * dir;
    for (const d of LOOK_AHEAD) {
      if (this.depthAt(this.pos.x + sx * d, this.pos.z + sz * d) < 0.4) {
        this.shoalAhead = d;
        return;
      }
    }
  }

  /* -------------------------------------------------------------- car -- */

  updateCar(dt, controls) {
    const S = this.spec;
    // Where it was pointing when the frame began (see the end of the bumps).
    const heading0 = this.heading;
    const rad = heading0 * DEG;
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
    // What the tyres should be drawn on: eased, so the model steps up onto
    // the tarmac over a few frames rather than in one.
    const liftWant = this.surface.drawnLift || 0;
    this.drawnLift = this.drawnLift == null ? liftWant : lerp(this.drawnLift, liftWant, clamp(dt * 8, 0, 1));
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
        // Picked up and put down somewhere else: no ground speed to carry.
        this._restY = null;
        this._gap = 0;
        this._carryVy = 0;
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
      this._drive = 0;
      // No wheels on the ground, no engine and no brakes. Everyone knows this
      // and everyone tries it, so it had better be true.
      const dragA = S.dragK * this.speed * v;
      this.speed -= dragA * dt;
    } else {
      // Drive force is limited by what the tyres can put down, which is why a
      // van on grass is slow rather than just draggy. And it fades with speed,
      // the way an engine's does — see `accel` and `powerFall` in the spec.
      const pull = 1 - (S.powerFall || 0) * Math.min(1, v / S.topSpeed);
      const drive = throttleIn * S.accel * pull * (throttleIn > 0 ? gripDrive : gripDrive * 0.8);
      this._drive = drive;
      const dragF = S.dragK * this.speed * v;
      // Engine braking: foot off, in gear, rolling.
      const lift = Math.abs(throttleIn) < 0.05 && brakeIn < 0.05 && v > 0.3 ? (S.engineBrake || 0) * Math.min(1, v / 2) * dir : 0;
      const rollF = (v > 0.05 ? this.surface.roll * dir : 0) + lift;
      /*
       * The handbrake is a brake. It was only ever a multiplier on the
       * footbrake — `brakeIn * ... * (hand ? 1.35 : 1)` — so Space on its own,
       * which the key hint, the touch pad and two of the job hints all call the
       * brake, did nothing at all to the speed: holding it, the van only
       * rolled down as it would with no key held. Measured at base on the
       * depot road, from 50 km/h with Space held: 30 km/h five seconds later,
       * 55 m on, never stopped. Now it locks the back wheels, which is a bit
       * over half a footbrake on its own and adds to it when both are on.
       */
      const handF = hand && v > 0.05 ? S.brakeDecel * HANDBRAKE * grip * dir : 0;
      const brakeF = brakeIn * S.brakeDecel * grip * dir + handF;
      /*
       * Pressing Shift while still rolling backwards (or reverse while still
       * rolling forwards) brakes first, the way an automatic does when you
       * change direction. Without it the engine alone had to cancel 31 km/h
       * of reverse: 2.0 s of Shift before the van went forwards, which from
       * the driver's seat is two seconds of the key not working. Now 1.2 s.
       */
      const against = throttleIn * this.speed < 0 && v > 0.3 ? Math.abs(throttleIn) * S.brakeDecel * grip * dir : 0;
      // Gravity along the slope. Free, one line, and it is the entire reason
      // the descent off the summit is the dangerous half of that job.
      const gAlong = -9.81 * Math.sin(groundPitch);
      this.speed += (drive + gAlong - dragF - rollF - brakeF - against) * dt;

      // Parked is parked. Without this the van creeps down every gradient
      // steeper than about five per cent for the rest of the session.
      if (v < 0.4 && Math.abs(throttleIn) < 0.02 && Math.abs(gAlong) < 1.2) this.speed = 0;
      if ((brakeIn > 0.5 || (hand && Math.abs(throttleIn) < 0.05)) && v < 0.5) this.speed = 0;
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
    /*
     * Stability control (ESC_* above). The reviewer drove every job holding
     * W and steering by the arrow, as a ten-year-old does, and at 105 km/h
     * the tightest the van turns is a 98 m circle: every junction and hairpin
     * ran out onto the grass at 90-110 km/h, and Coast Road and the Summit
     * Relay scored 0/100 on five "Off the road at speed" knocks each. And
     * holding W and D together went round a 43 m circle in 24.6 s.
     *
     * So, as a real van's does: while the steering asks for more than the
     * tyres have (full lock asks 1.12 times dry tarmac's grip, and more than
     * that on anything else), the engine is cut back and the brakes nibble,
     * in proportion to how far over it is, faded in from 30 to 60 km/h. It
     * never turns the van harder than the tyres can; it slows it to where
     * they can. It does nothing to a van that is not asking for more corner
     * than there is, which is every van driven along a road at a sensible
     * speed.
     */
    this.esc = 0;
    if (!this.air && v > ESC_FROM && latWant > latMax) {
      const fade = clamp((v - ESC_FROM) / (ESC_FULL - ESC_FROM), 0, 1);
      const over = clamp((latWant / latMax - 1) / 0.12, 0, 1);
      this.esc = fade * over;
      const dec = (ESC_BRAKE * grip + ESC_CUT * Math.max(0, this._drive)) * this.esc;
      this.speed -= Math.sign(this.speed) * Math.min(v, dec * dt);
    }
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
     * paint and four seconds, not the job. So the van is stopped at it,
     * bounced, and the load takes the hit — which is a consequence a
     * ten-year-old can read without any text at all.
     *
     * By the nose, not the middle (NOSE, HALF_W): the collision was one point
     * at the van's centre, so the front half of the van went into a wall
     * before anything stopped it. And not a trap: the reviewer ran the van
     * head-on into a Drover's Flat building and a tree, and holding W and
     * steering moved it 0 m in 90 s — the bounce took the speed away every
     * frame, so the wheel had nothing to turn the van with. Now:
     *
     *   - a glancing hit slides along the wall (the boxes are square to the
     *     world, so the part of the step along the wall is kept), with the
     *     nose turned towards the wall's line and the speed that went into
     *     it rubbed off;
     *   - head-on, it stops and bounces back as before, and the van counts
     *     how long it has been pinned (blockedT, which the HUD turns into
     *     BLOCKED — back up, or steer round it);
     *   - pinned, a steering key turns it on the spot (PIVOT), as far as the
     *     wall lets it, so W and a steering key get you out as well as S does.
     *
     * A van already overlapping something (put down beside it) is asked the
     * old question, the middle only, so it can always drive clear.
     */
    const dirMove = this.speed >= 0 ? 1 : -1;
    const hit = Math.abs(this.speed) > 1e-4 ? this.bodyHit(this.pos.x, this.pos.z, radNow, dirMove) : null;
    if (hit && !this.bodyHit(prevX, prevZ, rad, dirMove) && this.heading !== heading0 && !this.bodyHit(this.pos.x, this.pos.z, rad, dirMove)) {
      /*
       * Only this frame's steering put the bonnet into it: the same move at
       * the heading the frame began with is clear. That is a van running
       * along a wall with the wheel turned into it, and it scrapes along with
       * its nose held off by the wall — measured, holding the arrow's RIGHT
       * along the north face of a Drover's Flat building (1226-1251,
       * 1040-1063), treating it as head-on stopped and bounced the van every
       * few frames: 5.5 m in 8 s, and six "clipped" knocks.
       */
      this.heading = heading0;
      this.speed *= 1 - clamp(2 * dt, 0, 1);
      this.drift = 0;
    } else if (hit && !this.bodyHit(prevX, prevZ, rad, dirMove)) {
      const what = carWords(hit.what);
      const step = Math.hypot(stepX, stepZ) || 1e-6;
      const clearX = !this.bodyHit(this.pos.x, prevZ, radNow, dirMove);
      const clearZ = !this.bodyHit(prevX, this.pos.z, radNow, dirMove);
      const fx = Math.abs(stepX) / step;
      const fz = Math.abs(stepZ) / step;
      // Slide along whichever face lets it, if enough of the step goes that way.
      let along = 0;
      let tx = 0;
      let tz = 0;
      if (clearX && fx >= 0.35 && (fx >= fz || !clearZ)) {
        this.pos.z = prevZ;
        along = fx;
        tx = Math.sign(stepX);
      } else if (clearZ && fz >= 0.35) {
        this.pos.x = prevX;
        along = fz;
        tz = Math.sign(stepZ);
      }
      const into = along ? Math.sqrt(Math.max(0, 1 - along * along)) : 1;
      if (this.t - (this._bumpAt || -9) > 0.5 && v * into > 1.5) {
        this.shock(what, clamp((v * into) / 16, 0.25, 1));
        this.bumps++;
        /*
         * main.js says "You clipped …" whenever this is set. Set at most once
         * every 2.5 s: a van nosing at a tree it is pinned against raised a
         * fresh toast on every bounce. (The first pass throttled the toast
         * in updateDrive's shared code, which is the boat's as well.)
         */
        if (!(this.t - (this._bumpSaidT ?? -9) < 2.5)) {
          this._bumpSaidT = this.t;
          this.lastBump = what;
        }
      }
      this._bumpAt = this.t;
      if (along) {
        // Scrape along it: the nose comes round to the wall's line at up to
        // 120 degrees a second, and the part of the speed going into the wall
        // is rubbed off over a few frames rather than all at once.
        let want = (Math.atan2(tx, -tz) * 180) / Math.PI;
        if (dirMove < 0) want += 180;
        const dh = ((want - this.heading + 540) % 360) - 180;
        const was = this.heading;
        this.heading = (this.heading + clamp(dh, -120 * dt, 120 * dt) + 360) % 360;
        // Not if turning puts a corner of the nose into the wall: a van that
        // starts a frame overlapping is only asked about its middle (below).
        if (this.bodyHit(this.pos.x, this.pos.z, this.heading * DEG, dirMove)) this.heading = was;
        this.speed *= 1 - clamp(into * 6 * dt, 0, 1);
        this.drift = 0;
      } else {
        this.pos.x = prevX;
        this.pos.z = prevZ;
        this.speed = -this.speed * 0.22;
        this._pinT = 0.4;
        this._pinX = this.pos.x;
        this._pinZ = this.pos.z;
      }
    } else if (hit) {
      // Already overlapping it: only the middle counts, as it always did.
      if (obstacleAt(this.pos.x, this.pos.y + 1, this.pos.z)) {
        this.pos.x = prevX;
        this.pos.z = prevZ;
        this.speed = -this.speed * 0.22;
      }
    }
    /*
     * Pinned: turn on the spot with the steering key, as far as the wall
     * allows, and keep count of how long the go key has been pushing at it.
     */
    if (this._pinT > 0) {
      this._pinT -= dt;
      if ((throttleIn > 0.05 || brakeIn > 0.05) && Math.abs(this.steer) > 0.2) {
        /*
         * Which way round is the way a van turns: forwards with the go key,
         * the other way backing up. The end that is against the wall is the
         * end being driven at it. Where the turn would put a corner into the
         * wall, the van eases back 1.5 cm to make room (about 0.9 m/s, a
         * shuffle), and if even that is blocked it stays as it is.
         */
        const sense = throttleIn > 0.05 ? 1 : -1;
        const h1 = (this.heading + Math.sign(this.steer) * PIVOT * dt * sense + 360) % 360;
        const r1 = h1 * DEG;
        const inWay = this.bodyHit(this.pos.x, this.pos.z, r1, sense);
        if (!inWay) {
          this.heading = h1;
        } else {
          /*
           * Against a tree (a box under 3 m square), up to four times the
           * shuffle: a trunk is narrower than the van, so turning swings a
           * front corner onto it, and 1.5 cm back did not clear it. The
           * reviewer, head-on into six Drover's Flat trees at 44-66 km/h:
           * in three, 4 s of W and a steering key did nothing, and the
           * arrow-following kid held W and A against one for 30 s and
           * moved 0 m. (A wall keeps the one shuffle: glancing and pinned
           * against buildings was measured with it.)
           */
          const tries = shuffles(inWay);
          for (let k = 1; k <= tries; k++) {
            const bx = this.pos.x - Math.sin(r1) * 0.015 * k * sense;
            const bz = this.pos.z + Math.cos(r1) * 0.015 * k * sense;
            if (!this.bodyHit(bx, bz, r1, sense) && !this.bodyHit(bx, bz, r1, -sense)) {
              this.pos.x = bx;
              this.pos.z = bz;
              this.heading = h1;
              break;
            }
          }
        }
      }
      if (throttleIn > 0.05 && Math.abs(this.speed) < 2) {
        this.blockedT += dt;
        this.pinWay = this.wayOut();
      }
    } else if (
      (throttleIn > 0.05 && Math.abs(this.speed) > 2)
      || (Math.abs(throttleIn) <= 0.05 && brakeIn <= 0.05)
      || Math.hypot(this.pos.x - (this._pinX ?? this.pos.x), this.pos.z - (this._pinZ ?? this.pos.z)) > 3
    ) {
      /*
       * Unpinned: driving away, both feet off, or 3 m from where it was
       * stuck. Not the moment the go key comes up: BLOCKED's "back up with S"
       * went off the screen as soon as S was pressed, a child backed up
       * 30 cm, took the arrow's TURN AROUND and drove straight back onto the
       * corner it had been wedged on — measured, twenty times over in 45 s
       * beside a Drover's Flat building (1361-1386, 684-705).
       */
      this.blockedT = 0;
    }
    /*
     * And never finish a frame with either end of the van in something it
     * was clear of when the frame began.
     *
     * The tests above ask about the end that is moving, at the heading after
     * this frame's steering, and put back the position — never the heading.
     * So a van nosed up to a wall with a steering key held turned a corner of
     * its bonnet into the wall; the next frame began overlapping, which is
     * the "put down beside it" case that only asks about the middle; and the
     * go key then drove it in until the middle reached the wall. Measured on
     * Drover's Flat: a kid holding W and steering by the arrow from the grass
     * behind a building (1226-1251, 1040-1063) bumped it at 29 km/h, and 2.5 s
     * later sat with its middle on the wall, 2.3 m of van inside, going
     * nowhere for the rest of a 90 s run with W held. It was the same on all
     * six Drover's Flat buildings tried. The reviewer's chase camera saw a wall
     * and no van.
     *
     * So: the heading the frame began with, if that clears it; failing that,
     * the move along one axis only (a slide, as above); failing that, the
     * pose it began with, which was clear, stopped at it as a head-on bump
     * is. The slide matters: a van parked along a wall with a front corner
     * on it, backing away at a degree and a half, moved that corner 0.02 mm
     * into the wall per frame, and without it went back to where it was
     * every frame — measured, S held for 15 s beside a Drover's Flat
     * building (1230-1254, 730-751) and it never moved. Only with something
     * within 40 m (nearObstacles), and a dozen lookups against that short
     * list.
     */
    if ((prevX !== this.pos.x || prevZ !== this.pos.z || this.heading !== heading0) && this.nearObstacles().length) {
      if (this._endsIn(this.pos.x, this.pos.z, this.heading * DEG) && !this._endsIn(prevX, prevZ, rad)) {
        this.heading = heading0;
        if (this._endsIn(this.pos.x, this.pos.z, rad)) {
          // A slide only if it keeps a fair part of the move (as the one
          // above does): wedged with its tail on a building's corner, a van
          // heading along the wall kept only the sideways crumb of each
          // step, stood still at 18 km/h on the dial and never said BLOCKED.
          const mx = Math.abs(this.pos.x - prevX);
          const mz = Math.abs(this.pos.z - prevZ);
          const keep = 0.35 * Math.hypot(mx, mz);
          if (mx >= keep && !this._endsIn(this.pos.x, prevZ, rad)) {
            this.pos.z = prevZ;
          } else if (mz >= keep && !this._endsIn(prevX, this.pos.z, rad)) {
            this.pos.x = prevX;
          } else {
            this.pos.x = prevX;
            this.pos.z = prevZ;
            this.speed = -this.speed * 0.22;
            this._pinT = 0.4;
            this._pinX = this.pos.x;
            this._pinZ = this.pos.z;
          }
        }
      }
    }

    /* ---- the vertical -------------------------------------------------- */

    const restY = Math.max(SEA, groundY) + S.rideHeight;
    // How fast the ground under the four wheels is rising or falling, m/s.
    const groundVy = this._restY == null || dt <= 0 ? 0 : (restY - this._restY) / dt;
    this._restY = restY;
    if (this.air) {
      this.vy -= 9.81 * dt;
      this.pos.y += this.vy * dt;
      if (this.pos.y <= restY) {
        // The closing speed with the ground, not the fall speed: coming down
        // onto a slope that is falling away nearly as fast is no bump at all.
        // (A seam in the ground is not a slope coming up to meet you.)
        const gv = clamp(groundVy, -SEAM_V, SEAM_V);
        const impact = Math.max(0, gv - this.vy);
        this.pos.y = restY;
        this.air = false;
        this.vy = gv;
        this._carryVy = gv;
        this._gap = 0;
        this.landings++;
        this.lastLanding = impact;
        // Landing on the wheels is fine. Landing on the springs is not, and
        // four metres a second is roughly a kerb taken at seventy.
        if (impact > 4) {
          this.shock('a hard landing', clamp((impact - 4) / 7, 0, 1));
          this.speed *= 1 - clamp((impact - 4) * 0.02, 0, 0.35);
        }
      }
    } else {
      /*
       * The body is held UP by the road and pulled DOWN only by gravity.
       *
       * The old test for leaving the ground was "the ground is 30 cm below
       * the body", and the body trails the ground by the suspension lerp —
       * which works out at 0.2 m on a steady 10% descent at 90 km/h, more on
       * anything steeper — so a van going downhill could leave the ground,
       * fall, and land hard. And the road itself is not glass: roadHeight
       * blends every segment within 200 m, which leaves a ripple along it
       * every sixteen metres. Driven headless down the depot–airfield road at
       * 80 km/h with a one-frame "the ground fell faster than gravity" test,
       * the van left the ground 45 times in 60 s and landed at 2 m/s each
       * time: a washboard, and a knock to the load on every one.
       *
       * So the body keeps its own vertical speed. Where the road drops away
       * faster than gravity can follow, a gap opens; the springs take up a
       * gap of up to 20 cm (that is the ripple, and a crest taken briskly),
       * and past that the wheels are off the ground — leaving with at most a
       * hint of upward speed, so it is a hop you feel, never a launch.
       *
       * And the springs push the wheels down after a falling road harder than
       * gravity alone pulls: STICK, below. Measured with gravity alone,
       * following the arrow at a child's pace through every job on all eight
       * car islands: "Hard landing" knocked the load 27 times in 41 jobs,
       * never off a jump, always off a crease the road's own profile does not
       * have (two corridors meeting, a 25 m terrain triangle folding under the
       * tarmac), at 50-88 km/h. At 2.5 g, 13; and with the creases levelled
       * out of the roads themselves (levelOverlaps in roads.js), 1. A van on a
       * road should need a real drop to leave it.
       */
      let bodyVy = this.vy - STICK * dt;
      let gap = this._gap || 0;
      if (groundVy < -SEAM_V || groundVy > SEAM_V) {
        /*
         * A seam, not a slope: faster than any road the van can drive rises
         * or falls. The ground has these where two roads' corridors meet and
         * at the airfield's edge (a metre or more in one metre on Drover's
         * Flat — see shareTrunks in roads.js), and the ribbon draws each as a
         * short ramp. Ride over it like the ramp it looks like; flying off it
         * was a "hard landing" twenty metres out of the depot on every job
         * that went that way. No vertical speed comes from a seam at all:
         * given any, the van hopped off every one it drove up.
         *
         * Nor is any taken away going down one: already going downhill, the
         * body keeps the speed it had. Zeroing it there left the body
         * falling behind a steep road for the next few frames, the gap went
         * past 20 cm and the van was airborne off a ripple. Measured on Cape
         * Vessel's 17% descent from Kerrow to the airfield at 87 km/h, where
         * a ripple in the ground reads as a seam for one frame: 0.42 s in the
         * air, 0.37 m up.
         */
        bodyVy = groundVy < 0 ? Math.min(this.vy, 0) : 0;
      } else {
        gap += (bodyVy - groundVy) * dt;
        if (gap <= 0) {
          gap = 0;
          // Carried up by the road, but only so fast: a kerb or a steep
          // lip lifts the wheels, the springs soak up the rest, and the
          // body does not come off the top of it like a ramp. Measured
          // before this cap: a 38 cm lip at 22 km/h put the van 0.85 m in
          // the air a second after leaving the depot.
          bodyVy = Math.min(groundVy, RISE_MAX);
        }
      }
      if (v > 6 && gap > 0.2) {
        this.air = true;
        this.vy = Math.min(bodyVy, 0.3);
        this.pos.y = restY + gap;
        this._gap = 0;
      } else {
        this._gap = gap;
        this.vy = bodyVy;
        /*
         * Suspension. Fast enough that the wheels stay on the road over a
         * crest, soft enough that the terrain grid does not read as stairs.
         *
         * And carried at the body's own vertical speed first, smoothed over
         * a tenth of a second, with the lerp left to take up the rest. The
         * lerp alone trails anything moving at a steady speed by that speed
         * over twelve: going downhill the body rode (fall speed) / 12 above
         * the road the whole way down. Measured holding 90 km/h down
         * Airfield Perimeter's 15% ramp off the airfield: 0.31 m clear of
         * the tarmac for 40 m, wheels visibly in the air, never airborne;
         * 0.2 m on any 10% road at that speed. The target (restY + gap)
         * moves at exactly bodyVy, so carrying the body at it leaves nothing
         * to trail on a steady slope; smoothing it keeps the corners of the
         * terrain's triangles soft. The step in a seam is not carried (see
         * above for what bodyVy is on one): the lerp takes it as the short
         * ramp the ribbon draws.
         */
        this._carryVy = lerp(this._carryVy || 0, bodyVy, clamp(dt * 10, 0, 1));
        this.pos.y += this._carryVy * dt;
        this.pos.y = lerp(this.pos.y, restY + gap, clamp(dt * 12, 0, 1));
        // Never down in the road: the lerp lags a steep rise by up to 0.6 m
        // at speed, which is the wheels sunk into the tarmac.
        if (this.pos.y < restY - 0.08) this.pos.y = restY - 0.08;
      }
    }

    /*
     * Kerb strike: leaving the tarmac at speed.
     *
     * This is the rule that makes "floor it everywhere" a bad strategy without
     * a single line of explanatory text. Seventy is the threshold because it
     * is fast enough that you meant it.
     */
    // The gravel verge is part of the road: a van with two wheels on it at
    // seventy has not left the road, and the verge is two metres wide.
    const paved = this.surface.grip >= 0.7;
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

    // (The heading as it is now: scraping along a wall or turning against one
    // can have moved it since radNow was taken.)
    this.applyAttitude(dt, this.heading * DEG, groundPitch, groundRoll);
  }

  /** Either end of the van in something at this pose. */
  _endsIn(x, z, r) {
    return this.bodyHit(x, z, r, 1) || this.bodyHit(x, z, r, -1);
  }

  /**
   * Which way to turn to get off the wall the nose is pinned against, for
   * the HUD to point at: -1 left, 1 right, 2 either, 0 back up.
   *
   * The first version of BLOCKED said "back up with S, or steer round it"
   * and left the child to guess which way round. The second asked which
   * way the nose could turn three degrees without touching, and that is
   * the wrong question: into a wall 15 degrees off square, the corner that
   * touches can swing away only by turning TOWARDS square, so it said
   * "steer left", the van pivoted until it was square to the wall, and sat
   * there — measured, both of two Drover's Flat buildings, 15 degrees either
   * side, 27 s of W and the key it said. Away from square is out: turn so
   * the nose comes round to lie along the wall (the pivot shuffles back the
   * centimetre that costs at first). Which wall is read from the box the
   * nose is at: the face it is outside of. Square on (within 4 degrees):
   * either. Nothing found in front of the nose: back up.
   */
  wayOut() {
    const r = this.heading * DEG;
    const s = Math.sin(r);
    const c = Math.cos(r);
    const nx = this.pos.x + s * (NOSE + 0.15);
    const nz = this.pos.z - c * (NOSE + 0.15);
    const o = this.bodyHit(this.pos.x + s * 0.15, this.pos.z - c * 0.15, r, 1);
    if (!o) return 0;
    // How far outside each face the nose's middle is (negative: inside it).
    const gaps = [
      [o.x0 - nx, 90],
      [nx - o.x1, 270],
      [o.z0 - nz, 180],
      [nz - o.z1, 0],
    ];
    // The face it is against: the nearest one it is outside of (at a
    // corner, the one it is about to cross), or if the middle of the nose
    // is already past the line, the nearest face.
    let face = null;
    for (const g of gaps) if (g[0] >= 0 && (!face || g[0] < face[0])) face = g;
    if (!face) for (const g of gaps) if (!face || g[0] > face[0]) face = g;
    const d = ((this.heading - face[1] + 540) % 360) - 180;
    if (Math.abs(d) > 100) return 0;
    /*
     * And only a way the pivot can actually take (the same steps it takes,
     * shuffling back where it must): on a tree's corner the face is a guess,
     * and the right-front corner of a van on the north-west corner of a
     * Drover's Flat tree (1229-1231, 1079-1081) could only come off it
     * turning right while the face said left — BLOCKED "steer left" for 35 s.
     */
    const can = (dir) => {
      let h = this.heading;
      let x = this.pos.x;
      let z = this.pos.z;
      // PIVOT's own step at 60 updates a second, with the pivot's own
      // shuffles (more of them against a tree), over fifteen degrees: over
      // six, 3 of 60 head-on tree hits on Drover's Flat were told "steer
      // right" where only left came off (W and D for 4 s moved 0 m) — the
      // way right was clear for six degrees and not for ten.
      for (let i = 0; i < 20; i++) {
        h += dir * PIVOT / 60;
        const rr = h * DEG;
        const inWay = this.bodyHit(x, z, rr, 1);
        if (inWay) {
          const tries = shuffles(inWay);
          let ok = false;
          for (let k = 1; k <= tries && !ok; k++) {
            const bx = x - Math.sin(rr) * 0.015 * k;
            const bz = z + Math.cos(rr) * 0.015 * k;
            if (!this.bodyHit(bx, bz, rr, 1) && !this.bodyHit(bx, bz, rr, -1)) {
              x = bx;
              z = bz;
              ok = true;
            }
          }
          if (!ok) return false;
        }
      }
      return true;
    };
    const want = Math.abs(d) < 4 ? 0 : d > 0 ? 1 : -1;
    const l = can(-1);
    const rt = can(1);
    if (!l && !rt) return 0;
    if (want && (want < 0 ? l : rt)) return want;
    if (l && rt) return want || 2;
    return l ? -1 : 1;
  }

  /**
   * Whatever the van's nose (dir 1) or tail (dir -1) is in at this pose: its
   * two corners and its middle, a metre off the ground. Three lookups, and
   * only asked while the van is moving.
   */
  bodyHit(x, z, rad, dir) {
    const s = Math.sin(rad);
    const c = Math.cos(rad);
    const ax = x + s * NOSE * dir;
    const az = z - c * NOSE * dir;
    const y = this.pos.y + 1;
    const near = this.nearObstacles();
    return boxAt(near, ax, y, az)
      || boxAt(near, ax + c * HALF_W, y, az + s * HALF_W)
      || boxAt(near, ax - c * HALF_W, y, az - s * HALF_W);
  }

  /**
   * The collision boxes within 40 m of the van, gathered again every 12 m it
   * moves (or when the island's list changes). bodyHit asks three points a
   * frame, and asking obstacleAt, which walks every box on the island, was
   * measured at 70 microseconds a call on Drover's Flat (1,357 boxes) — the
   * biggest single thing in a van's frame. The list is reused, not rebuilt.
   */
  nearObstacles() {
    const x = this.pos.x;
    const z = this.pos.z;
    const near = this._near || (this._near = []);
    if (this._nearN === OBSTACLES.length && Math.abs(x - this._nearX) < 12 && Math.abs(z - this._nearZ) < 12) return near;
    this._nearX = x;
    this._nearZ = z;
    this._nearN = OBSTACLES.length;
    near.length = 0;
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      if (o.x1 < x - 40 || o.x0 > x + 40 || o.z1 < z - 40 || o.z0 > z + 40) continue;
      near.push(o);
    }
    return near;
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
    // One Euler for every van, reused: this runs every frame.
    this.quat.setFromEuler(_carEuler.set(this.pitch, -rad, this.bank, 'YXZ'));
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
    _lee.x = 0;
    _lee.z = 0;
    if (!weather || this.aground) return _lee;
    const kts = weather.effectiveWindKts != null ? weather.effectiveWindKts : weather.windSpeedKts || 0;
    const mps = kts * 0.514444;
    const drift = mps * 0.035 * (1 + this.sea * 0.5) * this.shelter;
    // Blowing FROM windDirDeg means going TOWARDS windDirDeg + 180.
    const to = (((weather.windDirDeg ?? 90) + 180) * Math.PI) / 180;
    _lee.x = Math.sin(to) * drift;
    _lee.z = -Math.cos(to) * drift;
    return _lee;
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
    // Display angles. They were 0.02 + 0.12 sea and 0.01 + 0.2 sea — in a
    // gale ±8 degrees of pitch and ±12 of roll, on top of the trim and the
    // lean into a turn, against a sea that does not tilt with her. Two
    // thirds of that reads as a big sea from the chase camera without
    // standing her on her transom.
    this.seaPitch = -Math.cos(phase) * (0.02 + sea * 0.08);
    this.seaRoll = Math.sin(phase * 0.8 + 2.1) * (0.01 + sea * 0.14);
    // Spray for whoever draws it: how fast you are going, times how rough it
    // is. Reuses the precipitation layer; this file only publishes a number.
    const f = clamp(Math.abs(this.speed) / S.topSpeed, 0, 1);
    this.spray = clamp(f * 0.45 + sea * f * 0.9, 0, 1);
  }

  /** A point `d` metres along her heading from (x, z). Shared scratch: copy it to keep it. */
  step(x, z, d) {
    const rad = (this.heading * Math.PI) / 180;
    _tip.x = x + Math.sin(rad) * d;
    _tip.z = z - Math.cos(rad) * d;
    return _tip;
  }

  /**
   * What the instruments, the sound and the missions read.
   *
   * Both shapes keep speedKts / speedKph / heading / throttle / crashed /
   * distanceM, because that is the set hud.setVehicle and audio.updateVehicle
   * have always read and neither of them should have to know which vehicle
   * this is.
   */
  readouts(out) {
    return this.isBoat ? this.boatReadouts() : this.carReadouts(out);
  }

  /**
   * The boat's readouts, written into ONE object that is kept for the life
   * of the vehicle.
   *
   * This is asked for three times a frame in the boat — the drive loop, the
   * audio and the model's dressing — and it built a new thirty-field object
   * each time: 180 objects a second for the collector to come back for on a
   * school Chromebook. Every reader uses the fields on the frame it asked
   * (checked: main.js, audio/vehicles.js, hud-boat.js, models.js and the
   * three-games suite), so the same object is refilled. Copy what you keep.
   * The car's readouts are untouched.
   */
  boatReadouts() {
    const d = DETENTS[this.lever];
    const o = this._boatR || (this._boatR = {});
    // Which of the two this is. The audio used to sniff it from the
    // presence of `lever`, which works until a car gets one.
    o.kind = this.isBoat ? 'boat' : 'car';
    // The one-shot list, as the same array and not a copy. Whoever reads it
    // must not mutate it; takeEvents() is the draining read.
    o.events = this.events;
    // Everything the shipped HUD and the audio already read, unchanged, so
    // this file can land before the HUD work does and nothing breaks.
    o.speedKts = Math.abs(this.speed) * 1.94384;
    o.speedKph = Math.abs(this.speed) * 3.6;
    o.heading = this.heading;
    o.throttle = Math.abs(this.throttle);
    o.crashed = this.crashed;
    o.distanceM = this.distance;
    // And what a boat HUD needs.
    o.lever = this.lever;
    o.leverLabel = d.label;
    o.leverId = d.id;
    o.astern = this.speed < -0.05;
    o.depth = this.depth;
    o.depthWord = this.depth < 1 ? 'SHALLOW' : this.depth < 3 ? 'shoaling' : 'deep water';
    // The echo sounder: the same water, with the keel where the swell has
    // it this instant. This is the number to print.
    o.sounding = this.sounding;
    o.shoalAhead = this.shoalAhead;
    o.groundings = this.groundings;
    o.sea = this.sea;
    o.seaWord = this.seaWord;
    o.aground = this.aground;
    o.dents = this.dents;
    o.spray = this.spray;
    o.jolt = this.jolt;
    o.heave = this.heave;
    o.snatch = this.snatch;
    // True when the engine is off the job and she is still going: this is
    // the thing to put on the HUD in words, so a child reads momentum
    // rather than concluding the controls have stopped responding.
    o.carryingWay = !this.aground && Math.abs(this.speed) > 0.6 && this.demand <= 0;
    return o;
  }

  /**
   * The van's instruments: a fresh object, as they always were, unless the
   * caller hands in one of its own to fill.
   *
   * The first pass made this one object per van, refilled on every call, to
   * save the garbage; and anything that kept last frame's readouts to
   * compare with this frame's (a plug-in, say) then saw them change under it,
   * which the reviewer flagged. So a caller that asks every frame and lets go
   * — the van's HUD, in updateDrive — passes its own, and nobody else is
   * surprised.
   */
  carReadouts(out) {
    const o = out || {};
    // Which of the two this is. The audio used to sniff it from the
    // presence of `lever`, which works until a car gets one.
    o.kind = this.isBoat ? 'boat' : 'car';
    // The one-shot list, as the same array and not a copy. Whoever reads it
    // must not mutate it; takeEvents() is the draining read.
    o.events = this.events;
    o.speedKts = Math.abs(this.speed) * 1.94384;
    o.speedKph = Math.abs(this.speed) * 3.6;
    o.heading = this.heading;
    o.throttle = Math.abs(this.throttle);
    o.crashed = this.crashed;
    o.distanceM = this.distance;
    /* ---- what the driving HUD asks for ---- */
    o.surface = this.surface ? this.surface.kind : 'tarmac';
    o.grip = this.surface ? this.surface.grip : 1;
    o.slip = this.slip;
    o.slide = this.slide;
    o.gear = this.gear;
    o.airborne = this.air;
    o.swamped = this.swamped;
    o.recoverT = Math.max(0, this.recoverT);
    o.latG = this.latAccel / 9.81;
    o.shockFlash = this.shockFlash || 0;
    o.esc = this.esc || 0;
    o.blocked = this.blockedT || 0;
    o.blockedWay = this.pinWay ?? 2;
    return o;
  }
}

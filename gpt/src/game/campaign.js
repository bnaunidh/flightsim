/**
 * The campaign — part A: missions one to eight.
 *
 * Each mission teaches exactly one new thing and then never stops asking for
 * it: hold a height, fly a circuit, navigate out of sight of home, keep a
 * passenger comfortable, fly at night, land away from an airfield, land in a
 * crosswind. The numbers in every instruction are real numbers the player can
 * read off the panel, and every instruction says which key to press.
 *
 * Everything here is written against the mission contract in runner.js. Two
 * house rules are worth restating, because both have already shipped bugs:
 *
 *   - `ac.alt` and `ac.agl` are METRES. Feet only ever appear after `ft()`.
 *   - Over the sea `heightAt()` returns the sea floor at -34 m, so `agl` reads
 *     about 112 ft too high out there. Anything over water uses `alt`, which is
 *     height above sea level because sea level is y = 0.
 */

import * as THREE from '../vendor/three.module.js';
import { RUNWAY } from '../world/airport.js';
import * as scenery from '../world/scenery.js';
import { heightAt } from '../world/terrain.js';
import { UNITS } from '../aircraft/physics.js';

const ELEV = RUNWAY.elev; // 14 m — the airfield pad
const VALLEY = 24; // m — the flat floor of the approach corridor either side of the pad
const ft = (m) => m * UNITS.FT;
const fpm = (v) => v * UNITS.FPM;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Parked at the western end of runway 09, engine running. */
const RUNWAY_START = { pos: new THREE.Vector3(-470, ELEV, 0), headingDeg: 90 };

/** Landmarks. Heights are the real terrain samples, not guesses. */
const NEEDLE_ROCK = new THREE.Vector3(-3100, 156, -3600);
const VILLAGE = new THREE.Vector3(756, VALLEY, 385); // the 26 houses along the south lip of the valley
const { DELIVERY_PAD } = scenery;

/**
 * The Mango Cay airstrip (world addition W1). The strip is a plain data record,
 * so it is read from scenery.js when that module has been extended and falls
 * back to the surveyed figures otherwise — that way this file keeps working
 * whichever order the two changes land in.
 */
const CAY = scenery.CAY_STRIP || {
  centre: new THREE.Vector3(6000, 111, -5300),
  headingDeg: 165,
  threshold16: new THREE.Vector3(5935, 111, -5541),
  threshold34: new THREE.Vector3(6065, 111, -5059),
  touchdown16: new THREE.Vector3(5955, 111, -5470),
  elev: 111,
  length: 420,
  halfWidth: 22,
};

// Unit vector pointing down the Mango strip in the landing-16 direction.
// Heading 0 is north, which is -Z, so a heading maps to (sin h, -cos h).
const CAY_DIR = {
  x: Math.sin(THREE.MathUtils.degToRad(CAY.headingDeg)),
  z: -Math.cos(THREE.MathUtils.degToRad(CAY.headingDeg)),
};

/** Horizontal distance only — altitude must never leak into a navigation check. */
function horiz(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Smallest angle between two compass headings, in degrees. */
function headingError(heading, wanted) {
  return Math.abs(((((heading - wanted) % 360) + 540) % 360) - 180);
}

/** How far the aeroplane is to one side of the Mango strip centreline, in metres. */
function cayCrossTrack(x, z) {
  const dx = x - CAY.centre.x;
  const dz = z - CAY.centre.z;
  return Math.abs(dx * CAY_DIR.z - dz * CAY_DIR.x);
}

/** Distance along the Mango strip: negative toward the north end, positive south. */
function cayAlongTrack(x, z) {
  const dx = x - CAY.centre.x;
  const dz = z - CAY.centre.z;
  return dx * CAY_DIR.x + dz * CAY_DIR.z;
}

function overWater(pos) {
  return heightAt(pos.x, pos.z) < 0;
}

function landedAndStopped(ctx) {
  const ac = ctx.ac;
  return (
    !!ctx.data.lastTouchdown &&
    !ctx.data.lastTouchdown.crashed &&
    ac.onGround &&
    ac.groundSpeed < 2.5 &&
    ac.groundTime > 1.2
  );
}

/** Lined up somewhere west of the field, pointing east at runway 09. */
function onWesterlyApproach(ctx, near = -700, far = -4200) {
  const p = ctx.ac.pos;
  return (
    p.x < near && p.x > far && Math.abs(p.z) < 700 && headingError(ctx.ac.heading, 90) < 55
  );
}

/**
 * The grade object the runner stores on a touchdown, but only the first time we
 * see it. Object identity is the signal: every touchdown produces a fresh grade.
 *
 * A bounce puts the wheels back on the ground a second or two later and emits a
 * second touchdown, so anything that arrives within `minGap` seconds of the last
 * one is part of the same arrival and is ignored. Nothing in this campaign asks
 * for two real landings less than eight seconds apart.
 */
function newTouchdown(ctx, minGap = 8) {
  const t = ctx.data.lastTouchdown;
  if (!t || t === ctx.data.seenTouchdown) return null;
  ctx.data.seenTouchdown = t;
  const prev = ctx.data.seenTouchAt;
  ctx.data.seenTouchAt = ctx.elapsed;
  if (prev != null && ctx.elapsed - prev < minGap) return null;
  return t;
}

/**
 * Where the wheels met the ground. Engine addition A2 puts x/z on the grade;
 * until that lands, the aeroplane is still within a metre of the spot on the
 * frame the touchdown is noticed, so its own position is a safe stand-in.
 */
function touchdownPoint(ctx, t) {
  return {
    x: t.x != null ? t.x : ctx.ac.pos.x,
    z: t.z != null ? t.z : ctx.ac.pos.z,
  };
}

/**
 * Per-frame bookkeeping for a mission.
 *
 * The runner calls `onUpdate` every frame (engine addition A1) and it calls
 * `failIf` every frame whatever step is running. Both are wired to the same
 * function, because `failIf` is the hook that already exists: the comfort
 * meter, the lap counter and the low-pass tracker therefore keep running even
 * in a build that has not picked up A1 yet. The guard on `ctx.elapsed` makes
 * sure the work happens exactly once per frame however many hooks fire.
 */
function meter(fn) {
  const run = (ctx, dt) => {
    const d = ctx.data;
    if (d.tickAt !== ctx.elapsed) {
      // `failIf` is handed no dt, so it is recovered from the mission clock.
      const frameDt = dt != null ? dt : Math.max(0, ctx.elapsed - (d.tickPrev != null ? d.tickPrev : ctx.elapsed));
      d.tickAt = ctx.elapsed;
      d.tickPrev = ctx.elapsed;
      d.failReason = fn(ctx, frameDt) || null;
    }
    return d.failReason;
  };
  return {
    onUpdate: (ctx, dt) => {
      run(ctx, dt);
    },
    failIf: (ctx) => run(ctx, null),
  };
}

/** Passenger comfort, shared by the charter and (later) the captain's test. */
function comfortTick(ctx, dt) {
  const ac = ctx.ac;
  if (ac.onGround) return;
  const bank = Math.abs(ac.bankAngleDeg());
  const gErr = Math.abs(ac.gLoad - 1);
  const sink = Math.abs(fpm(ac.vs));
  let p = 0;
  if (bank > 25) p += (bank - 25) * 0.06;
  if (gErr > 0.35) p += (gErr - 0.35) * 9;
  if (sink > 900) p += (sink - 900) * 0.004;
  if (ac.stalled) p += 12;
  ctx.data.comfort = Math.max(0, (ctx.data.comfort != null ? ctx.data.comfort : 100) - p * dt);
  const said = ctx.data.comfortSaid || 0;
  const c = ctx.data.comfort;
  if (c < 75 && said < 1) {
    ctx.data.comfortSaid = 1;
    ctx.sim.notify('Your passenger has gone a bit quiet.', 'info');
  } else if (c < 55 && said < 2) {
    ctx.data.comfortSaid = 2;
    ctx.sim.notify('She is holding on to the seat — gentler, please.', 'warn');
  } else if (c < 40 && said < 3) {
    ctx.data.comfortSaid = 3;
    ctx.sim.notify('She has asked you to take it easy.', 'bad');
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. First Flight
// ---------------------------------------------------------------------------

function firstFlightTick(ctx) {
  // "Stay level" only counts until the rings are behind you: the descent and
  // the landing are supposed to move the altimeter.
  if (!ctx.data.ringsDone && !ctx.ac.onGround) {
    if (Math.abs(ft(ctx.ac.alt) - 2000) > 300) ctx.data.levelBust = true;
  }
  return null;
}

const FIRST_FLIGHT = {
  id: 'first-flight',
  name: 'First Flight',
  short: 'Your first time in the air',
  difficulty: 'Training',
  icon: '☁',
  blurb:
    'You are already flying, 2,000 feet above the sea, with the island straight ahead. Steer through three enormous rings down the valley, then land on runway 09.',
  reward: 'Teaches holding a height, steering, and your first landing.',
  briefing: [
    { speaker: 'Chief Pilot', text: 'Morning. I have taken her off the ground for you and pointed her at the island — all you have to do today is steer.' },
    { speaker: 'Chief Pilot', text: 'A and D lean the wings left and right. W and S push the nose down and pull it up. Shift is more power, Ctrl is less.' },
    { speaker: 'Kestrel Tower', text: 'Skylark one seven two, three training rings are laid out down the valley. Fly through the middle of each one.' },
    { speaker: 'Chief Pilot', text: 'Then bring her round and land on runway zero nine. I will talk you through every part of it. Nothing here can go badly wrong.' },
  ],
  pay: 200,
  xp: 60,
  requires: [],
  unlocks: 'The mission board and the Hangar',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 },
  // Over water heightAt() is -34, so altAGL 640 puts her at 606 m — just under 2,000 ft.
  spawn: { pos: new THREE.Vector3(-3600, 0, 0), headingDeg: 90, speed: 58, altAGL: 640, engineOn: true },
  parTime: 420,
  optional: [
    {
      id: 'smooth-arrival',
      text: 'Touch down softer than 300 feet per minute',
      check: (ctx) => !!ctx.data.lastTouchdown && Math.abs(ctx.data.lastTouchdown.vsFpm) < 300,
    },
    {
      id: 'stay-level',
      text: 'Stay within 300 feet of 2,000 feet until the last ring',
      check: (ctx) => !ctx.data.levelBust,
    },
  ],
  ...meter(firstFlightTick),
  steps: [
    {
      id: 'settle',
      text: 'You are flying! Hold the controls still and look at the island ahead. Press C if you want to see the aeroplane from outside.',
      hint: 'You do not need to do anything yet. Just let her fly and watch the numbers on the left.',
      atc: {
        text: 'Hello. I have the aeroplane trimmed and pointing at the island. Take a moment, look around, and get used to the view.',
        voice: 'instructor',
      },
      duration: 10,
    },
    {
      id: 'hold',
      text: 'Keep her level: the climb needle should sit near zero. Hold it there for five seconds.',
      hint: 'Nose on the horizon. A small pull on S if you are sinking, a small push on W if you are climbing.',
      atc: {
        text: 'Now hold your height. Put the nose on the horizon and leave it there. Small movements only.',
        voice: 'instructor',
      },
      enter: (ctx) => {
        ctx.data.levelTimer = 0;
      },
      check: (ctx, dt) => {
        const steady = Math.abs(fpm(ctx.ac.vs)) < 500;
        ctx.data.levelTimer = steady ? (ctx.data.levelTimer || 0) + dt : 0;
        return ctx.data.levelTimer > 5;
      },
      onDone: (ctx) => ctx.sim.notify('That is level flight. Well held.', 'good'),
    },
    {
      id: 'rings',
      text: 'Fly through the three big rings. They are in a straight line down the valley — steer with A and D.',
      hint: 'Aim at the middle of the ring. The arrow at the top of the screen always points at the next one.',
      atc: {
        text: 'Skylark one seven two, the training rings are ahead of you, straight down the valley. Cleared through.',
        voice: 'approach',
      },
      targetLabel: 'Next ring',
      // Radius 70 m on a dead straight line: practically impossible to miss.
      gates: [
        { pos: new THREE.Vector3(-1200, 430, 0), heading: 90, radius: 70 },
        { pos: new THREE.Vector3(400, 430, 0), heading: 90, radius: 70 },
        { pos: new THREE.Vector3(1900, 400, 0), heading: 90, radius: 70 },
      ],
      onDone: (ctx) => {
        ctx.data.ringsDone = true;
        ctx.sim.notify('All three rings. Now we go home.', 'good');
      },
    },
    {
      id: 'turn-back',
      text: 'Now turn round. Hold A to lean left until the heading reads 270, then centre the controls and fly west past the airfield.',
      hint: 'The heading number is at the top of the screen. Keep turning until it says 270, then let go of A.',
      atc: {
        text: 'Skylark one seven two, turn left and take up a westerly heading. Report ready for the approach.',
        voice: 'approach',
      },
      targetLabel: 'Turning point',
      target: () => new THREE.Vector3(-2600, 300, 0),
      check: (ctx) => ctx.ac.pos.x < -1600 && Math.abs(ctx.ac.pos.z) < 1400,
    },
    {
      id: 'line-up',
      text: 'Turn round once more to the east — heading 090 — and point at the runway. Take some power off with Ctrl and let her sink towards 1,000 feet.',
      hint: 'Runway 09 means you land heading east. Look for the green lights at the near end.',
      atc: { text: 'Skylark one seven two, cleared to land runway zero nine. Wind zero nine zero at four.', voice: 'tower' },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1400, 160, 0)),
      check: (ctx) => onWesterlyApproach(ctx, -900, -4600) && ft(ctx.ac.alt) < 1500,
    },
    {
      id: 'land',
      text: 'Keep two white and two red on the four PAPI lights beside the runway, and let the wheels touch on the tarmac.',
      hint: 'All red means too low, so add power. All white means too high, so take power off. Space is the brakes once you are down.',
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak('Skylark one seven two, welcome to Kestrel Island. That was your first landing and it was a good one.', 'tower');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const land = l ? l.score : 40;
    const timeBonus = Math.max(0, 1 - ctx.elapsed / 900);
    return Math.round(land * 0.6 + timeBonus * 25 + (ctx.data.levelBust ? 0 : 15));
  },
};

// ---------------------------------------------------------------------------
// 2. Circuits and Bumps
// ---------------------------------------------------------------------------

function circuitsTick(ctx) {
  const t = newTouchdown(ctx);
  if (!t) return null;
  ctx.data.touches = (ctx.data.touches || 0) + 1;
  ctx.data.touchScore = (ctx.data.touchScore || 0) + t.score;
  if (!t.onRunway) ctx.data.allOnTarmac = false;
  // The flaps drill is judged at the moment the wheels touch, which is the only
  // moment that tells you whether the approach was flown with them out.
  if (ctx.ac.flapStep() < 2) ctx.data.flapDrill = false;
  const n = ctx.data.touches;
  if (n < 4) {
    ctx.sim.notify(
      `Touchdown ${n} of 4 — power up with Shift and go again.`,
      t.onRunway ? 'good' : 'warn'
    );
  }
  return null;
}

const CIRCUITS = {
  id: 'circuits',
  name: 'Circuits and Bumps',
  short: 'Take off and land, four times',
  difficulty: 'Training',
  icon: '⟳',
  blurb:
    'The only way to learn landings is to do lots of them. Fly three touch-and-goes — land, then power up and take off again without stopping — and finish with a full stop.',
  reward: 'Teaches the take-off, the landing pattern and using flaps.',
  briefing: [
    { speaker: 'Chief Pilot', text: 'Today you do the whole thing yourself: the take-off, the circuit, and the landing. Four times.' },
    { speaker: 'Chief Pilot', text: 'The first three are touch-and-goes. The wheels touch, then you push the power straight back up with Shift and off you go again.' },
    { speaker: 'Chief Pilot', text: 'Use the flaps on every approach. F puts them down a step, V brings them back up. Twenty degrees lets you fly slower without falling out of the sky.' },
    { speaker: 'Kestrel Tower', text: 'Skylark one seven two, you are cleared for the circuit, runway zero nine. Take your time — the sky is yours this morning.' },
  ],
  pay: 180,
  xp: 80,
  requires: ['first-flight'],
  unlocks: 'The airborne start for free flight',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 100 },
  spawn: RUNWAY_START,
  parTime: 480,
  optional: [
    {
      id: 'flaps-drill',
      text: 'Land with at least 20 degrees of flap every time',
      check: (ctx) => ctx.data.flapDrill !== false && (ctx.data.touches || 0) >= 4,
    },
    {
      id: 'all-on-tarmac',
      text: 'Put all four touchdowns on the runway',
      check: (ctx) => ctx.data.allOnTarmac !== false && (ctx.data.touches || 0) >= 4,
    },
  ],
  onStart: (ctx) => {
    ctx.data.touches = 0;
    ctx.data.touchScore = 0;
    ctx.data.flapDrill = true;
    ctx.data.allOnTarmac = true;
  },
  ...meter(circuitsTick),
  steps: [
    {
      id: 'depart',
      text: 'Hold Shift for full power, keep straight with Q and E, and at 55 knots pull back gently on S.',
      hint: 'Watch the speed on the left. Fifty five knots, then a small steady pull on S.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, runway zero nine, cleared for take-off. Left hand circuit, one thousand feet.',
        voice: 'tower',
      },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdEast,
      check: (ctx) => ctx.ac.agl > 25 && ctx.ac.airborneTime > 2,
    },
    {
      id: 'lap1',
      text: 'Climb to 1,000 feet, turn left, and follow the two rings round to the runway. Land, then go straight round again.',
      hint: 'Flaps down a step with F on the way in. Aim for 65 knots on final approach.',
      atc: { text: 'Skylark one seven two, cleared touch and go, runway zero nine.', voice: 'tower' },
      targetLabel: 'Next ring',
      gates: [
        { pos: new THREE.Vector3(-2900, 300, -900), heading: 270, radius: 55 },
        { pos: new THREE.Vector3(-2400, 190, 0), heading: 90, radius: 55 },
      ],
      // Gates first, then the touchdown: the runner needs every gate passed
      // before it even looks at this check.
      check: (ctx) => (ctx.data.touches || 0) >= 1 && ctx.ac.airborneTime > 2,
    },
    {
      id: 'lap2',
      text: 'Round again. Left turn after take-off, level at 1,000 feet, then back for another touch-and-go.',
      hint: 'The circuit is a rectangle: climb straight ahead, turn left, fly back past the field, turn left again onto final.',
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      check: (ctx) => (ctx.data.touches || 0) >= 2 && ctx.ac.airborneTime > 2,
    },
    {
      id: 'lap3',
      text: 'One more touch-and-go. Try to put the wheels down in the same place each time.',
      hint: 'Power controls how fast you sink; the nose controls your speed. Small changes only.',
      atc: { text: 'Skylark one seven two, cleared touch and go. That is looking much tidier.', voice: 'tower' },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      check: (ctx) => (ctx.data.touches || 0) >= 3 && ctx.ac.airborneTime > 2,
    },
    {
      id: 'full-stop',
      text: 'Last one — this time stay down. Land, hold Space on the brakes and come to a complete stop.',
      hint: 'Close the throttle fully with Ctrl once the wheels are rolling, then squeeze the brakes with Space.',
      atc: { text: 'Skylark one seven two, cleared to land, runway zero nine. Full stop.', voice: 'tower' },
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: (ctx) => (ctx.data.touches || 0) >= 4 && landedAndStopped(ctx),
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak('Skylark one seven two, four landings and not a bounce out of you. Taxi in.', 'tower');
  },
  score: (ctx) => {
    const n = Math.max(1, ctx.data.touches || 0);
    const avg = (ctx.data.touchScore || 0) / n;
    const tidy = ctx.data.allOnTarmac === false ? 0 : 1;
    return Math.round(clamp(avg, 0, 100) * 0.78 + tidy * 22);
  },
};

// ---------------------------------------------------------------------------
// 3. Island Circuit
// ---------------------------------------------------------------------------

function islandCircuitTick(ctx) {
  const ac = ctx.ac;
  // Only start watching the height once the take-off climb is finished, and
  // stop again on final approach, where being low is the whole point.
  if (!ctx.data.climbDone && ac.agl > 150) ctx.data.climbDone = true;
  if (ctx.data.climbDone && !ctx.data.finalPhase && !ac.onGround && ac.agl < 60) {
    ctx.data.scraped = true;
  }
  return null;
}

const ISLAND_CIRCUIT = {
  id: 'circuit',
  name: 'Island Circuit',
  short: 'Six rings around Kestrel',
  difficulty: 'Easy',
  icon: '◎',
  blurb:
    'Six rings, all at different heights, right the way round the island and then down into the valley. You will have to climb and descend while you are turning.',
  reward: 'Teaches climbing and descending turns, and flying close to the ground on purpose.',
  briefing: [
    { speaker: 'Chief Pilot', text: 'You can take off and land. Now let us see you fly the aeroplane properly.' },
    { speaker: 'Chief Pilot', text: 'Six rings this time, and they are at six different heights. Turning and climbing at once costs you speed, so lead with the power.' },
    { speaker: 'Chief Pilot', text: 'The last one is the interesting one: it sits low down inside the valley, three hundred feet above the floor, lined up with the runway.' },
    { speaker: 'Kestrel Tower', text: 'Skylark one seven two, the valley walls are eight hundred metres apart down there. Plenty of room, but keep your eyes outside.' },
  ],
  pay: 260,
  xp: 100,
  requires: ['circuits'],
  unlocks: 'The Mango Cay delivery contract',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 110 },
  spawn: RUNWAY_START,
  parTime: 330,
  timeLimit: 600,
  optional: [
    {
      id: 'quick-lap',
      text: 'Pass all six rings within four minutes',
      check: (ctx) => ctx.data.ringsAt != null && ctx.data.ringsAt < 240,
    },
    {
      id: 'no-scrape',
      text: 'Stay above 200 feet of ground until the final approach',
      check: (ctx) => !ctx.data.scraped,
    },
  ],
  ...meter(islandCircuitTick),
  steps: [
    {
      id: 'depart',
      text: 'Full power with Shift, pull back at 55 knots, and climb straight ahead to 1,500 feet.',
      hint: 'Hold the nose just above the horizon and let the altimeter wind up.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, runway zero nine cleared for take-off, wind one one zero at six.',
        voice: 'tower',
      },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdEast,
      check: (ctx) => ft(ctx.ac.alt) > 1400,
    },
    {
      id: 'rings',
      text: 'Round the island through all six rings. Watch the height of each one as you go.',
      hint: 'Lean into the turn with A or D, add a little power in the climb, and take power off before you descend.',
      atc: {
        text: 'Skylark one seven two, radar contact, cleared through the ring course. Call turning for the valley.',
        voice: 'approach',
      },
      targetLabel: 'Next ring',
      gates: [
        { pos: new THREE.Vector3(1500, 484, -260), heading: 90, radius: 40 },
        { pos: new THREE.Vector3(2400, 534, 1500), heading: 160, radius: 40 },
        { pos: new THREE.Vector3(500, 634, 2500), heading: 250, radius: 40 },
        { pos: new THREE.Vector3(-1800, 574, 1400), heading: 320, radius: 40 },
        { pos: new THREE.Vector3(-2200, 444, -700), heading: 30, radius: 40 },
        // The valley ring: 120 m above sea level over a 24 m floor, so 96 m
        // (315 ft) of clear air underneath, sitting on the runway centreline.
        { pos: new THREE.Vector3(-1300, 120, 0), heading: 90, radius: 45 },
      ],
      onDone: (ctx) => {
        ctx.data.ringsAt = ctx.elapsed;
        ctx.sim.notify('Six for six. Now land her.', 'good');
      },
    },
    {
      id: 'land',
      text: 'You are already lined up with runway 09. Ease the power back and land.',
      hint: 'Two white and two red on the PAPI lights is the perfect glide path.',
      atc: { text: 'Skylark one seven two, cleared to land runway zero nine.', voice: 'tower' },
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      enter: (ctx) => {
        ctx.data.finalPhase = true;
      },
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak('Skylark one seven two, nicely flown. Taxi to the apron at your convenience.', 'tower');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const timeScore = Math.max(0, 1 - ctx.elapsed / 600);
    return Math.round((l ? l.score : 40) * 0.7 + timeScore * 30);
  },
};

// ---------------------------------------------------------------------------
// 4. Mango Cay Delivery
// ---------------------------------------------------------------------------

function deliveryTick(ctx) {
  // The height rule only covers the outbound crossing; coming home you have to
  // descend over the water to land. `alt` because `agl` is nonsense over sea.
  if (!ctx.data.dropped && !ctx.ac.onGround && overWater(ctx.ac.pos) && ctx.ac.alt < 91) {
    ctx.data.wentLow = true;
  }
  return null;
}

const DELIVERY = {
  id: 'delivery',
  name: 'Mango Cay Delivery',
  short: 'Supplies across the water',
  difficulty: 'Easy',
  icon: '▣',
  blurb:
    'Mango Cay needs medical supplies. Fly the crate eight kilometres south-east across open water, drop it on the yellow target, then come home and land.',
  reward: 'Teaches navigation out of sight of home, and the cargo drop.',
  briefing: [
    { speaker: 'Dispatch', text: 'The clinic on Mango Cay is out of dressings and the ferry is not running until Thursday. That makes it your problem.' },
    { speaker: 'Dispatch', text: 'The crate is strapped in behind you. It has a parachute, so fly low and slow over the target and press X to let it go.' },
    { speaker: 'Chief Pilot', text: 'Kestrel disappears behind you about halfway. That is normal. Follow the arrow at the top of the screen and there is a ring on the way to prove you are on track.' },
    { speaker: 'Chief Pilot', text: 'Stay at two thousand feet over the water. Height is time to think if anything goes quiet.' },
  ],
  pay: 420,
  xp: 120,
  requires: ['circuit'],
  unlocks: 'Passenger charter work',
  weather: { time: 'day', condition: 'cloudy', windSpeedKts: 11, windDirDeg: 140 },
  spawn: RUNWAY_START,
  parTime: 480,
  timeLimit: 780,
  optional: [
    { id: 'bullseye', text: 'Drop the crate within 25 metres of the middle', check: (ctx) => ctx.data.dropDistance != null && ctx.data.dropDistance < 25 },
    { id: 'high-and-dry', text: 'Stay above 300 feet over the sea on the way out', check: (ctx) => !ctx.data.wentLow },
  ],
  onStart: (ctx) => {
    ctx.sim.hasCargo = true;
    ctx.data.dropped = false;
  },
  ...meter(deliveryTick),
  steps: [
    {
      id: 'depart',
      text: 'The crate is loaded. Take off from runway 09, then turn right with D and head south-east.',
      hint: 'Full power with Shift, pull back at 55 knots, then a gentle right turn once you are above 300 feet.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, cleared for take-off runway zero nine. Mango Cay is waiting on you.',
        voice: 'tower',
      },
      targetLabel: 'Mango Cay',
      target: () => DELIVERY_PAD,
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'cruise',
      text: 'Climb to about 2,000 feet and fly to Mango Cay. Pass through the ring on the way.',
      hint: 'The arrow at the top of the screen always points at the island, even when you cannot see it.',
      atc: {
        text: 'Skylark one seven two, radar contact, cleared direct Mango Cay, maintain two thousand feet.',
        voice: 'approach',
      },
      targetLabel: 'Mango Cay',
      target: () => DELIVERY_PAD,
      // A confidence marker in the middle of the crossing: (3600, -2900) is open sea.
      gates: [{ pos: new THREE.Vector3(3600, 520, -2900), heading: 130, radius: 70 }],
      check: (ctx) => horiz(ctx.ac.pos, DELIVERY_PAD) < 1500,
    },
    {
      id: 'descend',
      text: 'Come down low over the island — below 500 feet above the ground — and slow down.',
      hint: 'Ease the power back with Ctrl and let the nose drop a little. Around 70 knots is ideal for the drop.',
      atc: {
        text: 'Sea Bird, this is Mango Cay village. We can hear you. Drop when you are ready, over.',
        voice: 'village',
      },
      targetLabel: 'Drop target',
      target: () => DELIVERY_PAD,
      check: (ctx) => ft(ctx.ac.agl) < 520 && horiz(ctx.ac.pos, DELIVERY_PAD) < 420,
    },
    {
      id: 'drop',
      text: 'Press X to release the crate right over the yellow target!',
      hint: 'Fly straight across the middle of the ring and press X. The slower you are, the more accurate it is.',
      targetLabel: 'Drop target',
      target: () => DELIVERY_PAD,
      check: (ctx) => {
        const crate = ctx.sim.crate;
        if (!crate || !crate.landed) return false;
        const d = horiz(crate.group.position, DELIVERY_PAD);
        ctx.data.dropDistance = d;
        if (d > 90) {
          // Missed: hand them another crate rather than ending the mission.
          ctx.sim.notify('The crate missed the target — here is another one. Try again!', 'warn');
          ctx.sim.removeCrate();
          ctx.sim.hasCargo = true;
          return false;
        }
        ctx.data.dropped = true;
        ctx.sim.notify(`Crate delivered — ${Math.round(d)} m from the middle!`, 'good');
        return true;
      },
    },
    {
      id: 'home',
      text: 'Good drop. Now fly north-west back to Kestrel Island and line up with runway 09 from the west.',
      hint: 'Turn until the arrow points straight ahead, then climb back to 2,000 feet for the crossing.',
      atc: { text: 'Sea Bird, supplies received, thank you! Safe flight home.', voice: 'village' },
      targetLabel: 'Kestrel Island',
      target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1800, 240, 0)),
      check: (ctx) => onWesterlyApproach(ctx, -600, -5000),
    },
    {
      id: 'land',
      text: 'Land on runway 09 and bring her to a stop.',
      hint: 'Flaps down a step or two with F, 65 knots on final, and keep the PAPI at two white and two red.',
      atc: { text: 'Skylark one seven two, cleared to land runway zero nine.', voice: 'tower' },
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak('Skylark one seven two, Mango Cay have been on the telephone to thank you. Welcome home.', 'tower');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const acc = ctx.data.dropDistance != null ? Math.max(0, 1 - ctx.data.dropDistance / 90) : 0.4;
    return Math.round((l ? l.score : 40) * 0.5 + acc * 35 + Math.max(0, 1 - ctx.elapsed / 700) * 15);
  },
};

// ---------------------------------------------------------------------------
// 5. The Photographer
// ---------------------------------------------------------------------------

function charterTick(ctx, dt) {
  comfortTick(ctx, dt);
  if (ctx.data.comfort < 30) return 'Your passenger felt too ill to carry on';
  // The optional postcard pass: below 900 ft above the sea and inside 350 m.
  if (horiz(ctx.ac.pos, NEEDLE_ROCK) < 350 && ft(ctx.ac.alt) < 900) ctx.data.postcard = true;
  return null;
}

const CHARTER = {
  id: 'sunset-charter',
  name: 'The Photographer',
  short: 'A passenger, and a golden evening',
  difficulty: 'Easy',
  icon: '◔',
  blurb:
    'A photographer has hired you for the last hour of light. Show her the lighthouse, the north coast and the village — and fly gently enough that she can hold a camera steady.',
  reward: 'Teaches smooth flying: gentle turns, steady hands, no sudden pull.',
  briefing: [
    { speaker: 'Dispatch', text: 'Charter job. One passenger, a camera the size of a kettle, and one hour of sunset to work with.' },
    { speaker: 'Sofia Marchetti', text: 'I get airsick, so please, no throwing me around. Wide gentle turns and I will love you forever.' },
    { speaker: 'Chief Pilot', text: 'Keep the bank under twenty five degrees, do not shove the nose up or down, and she will be fine. Yank it about and she will not be.' },
    { speaker: 'Chief Pilot', text: 'The lighthouse first, then out over the north coast, then a slow pass over the village. Land before the light goes.' },
  ],
  pay: 480,
  xp: 140,
  requires: ['delivery'],
  unlocks: 'Night operations',
  weather: { time: 'sunset', condition: 'clear', windSpeedKts: 7, windDirDeg: 70 },
  spawn: RUNWAY_START,
  parTime: 540,
  timeLimit: 720,
  optional: [
    { id: 'silk-smooth', text: 'Land with your passenger still at 85 or better', check: (ctx) => (ctx.data.comfort || 0) >= 85 },
    { id: 'postcard', text: 'Pass the lighthouse below 900 feet and inside 350 metres', check: (ctx) => !!ctx.data.postcard },
  ],
  onStart: (ctx) => {
    ctx.data.comfort = 100;
    ctx.data.comfortSaid = 0;
    ctx.data.orbit = 0;
  },
  ...meter(charterTick),
  steps: [
    {
      id: 'depart',
      text: 'Take off from runway 09 and turn gently to the south-west, towards the lighthouse.',
      hint: 'Everything on this flight is slow and smooth. Roll into the turn, hold it, roll out again.',
      atc: {
        text: 'Skylark one seven two, cleared for take-off runway zero nine. Enjoy the evening, the light is beautiful up there.',
        voice: 'tower',
      },
      targetLabel: 'Needle Rock',
      target: () => NEEDLE_ROCK,
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'lighthouse',
      text: 'Fly one full circle around the lighthouse on Needle Rock, staying inside 750 metres and below 1,500 feet.',
      hint: 'Hold about twenty degrees of bank all the way round. Stay above 700 feet — the rock itself is 500 feet tall.',
      atc: {
        text: 'This is exactly what I came for. One slow lap around the lighthouse, please, and keep the wing down so I can shoot over it.',
        voice: 'instructor',
      },
      targetLabel: 'Needle Rock',
      target: () => NEEDLE_ROCK,
      enter: (ctx) => {
        ctx.data.orbit = 0;
        ctx.data.orbitBearing = null;
      },
      check: (ctx) => {
        const p = ctx.ac.pos;
        const d = horiz(p, NEEDLE_ROCK);
        const bearing = Math.atan2(p.z - NEEDLE_ROCK.z, p.x - NEEDLE_ROCK.x);
        // Only count turning that happens inside the ring and below the height
        // limit; drifting outside pauses the count rather than resetting it.
        if (d < 750 && ft(p.y) < 1500) {
          if (ctx.data.orbitBearing != null) {
            let delta = bearing - ctx.data.orbitBearing;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            ctx.data.orbit = (ctx.data.orbit || 0) + delta;
          }
          ctx.data.orbitBearing = bearing;
        } else {
          ctx.data.orbitBearing = null;
        }
        return Math.abs(ctx.data.orbit || 0) > 5.24; // 300 degrees — near enough a full lap
      },
      onDone: (ctx) => ctx.sim.notify('She got the shot. Head north-east along the coast.', 'good'),
    },
    {
      id: 'coast',
      text: 'Now out to the ring off the north coast, about 2,000 feet up.',
      hint: 'The ring is over the water north of the island. Climb gently — no more than 700 feet a minute.',
      atc: { text: 'The cliffs from out there, if you can. Slowly.', voice: 'instructor' },
      targetLabel: 'Coast ring',
      gates: [{ pos: new THREE.Vector3(900, 250, -2900), heading: 90, radius: 50 }],
    },
    {
      id: 'village',
      text: 'Last one: a slow pass over Kestrel Village, below 1,200 feet.',
      hint: 'The village is the line of houses on the south side of the valley, east of the airfield.',
      atc: { text: 'The houses now, while the roofs are still orange. Then home.', voice: 'instructor' },
      targetLabel: 'Kestrel Village',
      target: () => VILLAGE,
      check: (ctx) => horiz(ctx.ac.pos, VILLAGE) < 400 && ft(ctx.ac.alt) < 1200,
      onDone: (ctx) => ctx.sim.notify('That is the whole shot list. Take us home.', 'good'),
    },
    {
      id: 'home',
      text: 'Fly west past the airfield, then turn back and line up with runway 09.',
      hint: 'Wide, gentle turns. She is still holding the camera.',
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1600, 200, 0)),
      check: (ctx) => onWesterlyApproach(ctx, -700, -5000),
    },
    {
      id: 'land',
      text: 'Land on runway 09 as softly as you can, and stop.',
      hint: 'Close the throttle over the threshold and hold the nose up a touch. Let her settle on.',
      atc: { text: 'Skylark one seven two, cleared to land runway zero nine. Wind zero seven zero at seven.', voice: 'tower' },
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak(
      'Skylark one seven two, your passenger says that was the smoothest flight she has had in years. Nicely done.',
      'tower'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const comfort = clamp(ctx.data.comfort != null ? ctx.data.comfort : 100, 0, 100);
    return Math.round((l ? l.score : 40) * 0.45 + comfort * 0.45 + (ctx.data.postcard ? 10 : 0));
  },
};

// ---------------------------------------------------------------------------
// 6. The Late Freight
// ---------------------------------------------------------------------------

function nightTick(ctx, dt) {
  const sim = ctx.sim;
  if (sim.navGuide && sim.navGuide.enabled) ctx.data.usedGuide = true;
  // The PAPI hint is recomputed by the sim every frame; 'good' is two white and
  // two red, which is the only reading that means a correct glide path.
  const hint = sim.papiHint;
  if (hint && hint.state === 'good') {
    ctx.data.papiRun = (ctx.data.papiRun || 0) + dt;
    ctx.data.papiBest = Math.max(ctx.data.papiBest || 0, ctx.data.papiRun);
  } else {
    ctx.data.papiRun = 0;
  }
  return null;
}

const NIGHT_RUN = {
  id: 'night-run',
  name: 'The Late Freight',
  short: 'Mango Cay, after dark',
  difficulty: 'Medium',
  icon: '☾',
  blurb:
    'The same crossing you know, in the dark. There is no horizon over the water, so the altimeter, the lighthouse and the runway lights are all you have.',
  reward: 'Teaches trusting the instruments and using lights to navigate.',
  briefing: [
    { speaker: 'Dispatch', text: 'Freight run to Mango Cay, and it has to go tonight. The lights on runway zero nine come on automatically after dark.' },
    { speaker: 'Chief Pilot', text: 'Over the sea at night there is no horizon at all. Do not go hunting for one — believe the altimeter and keep the wings level.' },
    { speaker: 'Chief Pilot', text: 'There is a checkpoint out by Needle Rock. The lighthouse sweeps every four seconds; use it to check you are where you think you are.' },
    { speaker: 'Kestrel Tower', text: 'Skylark one seven two, we will keep the field lit for you. Call ten miles out and the PAPI will bring you in.' },
  ],
  pay: 560,
  xp: 160,
  requires: ['sunset-charter'],
  unlocks: 'The medevac contract and the crosswind checkride',
  weather: { time: 'night', condition: 'clear', windSpeedKts: 5, windDirDeg: 100 },
  spawn: RUNWAY_START,
  parTime: 600,
  timeLimit: 840,
  optional: [
    { id: 'papi-perfect', text: 'Hold two white and two red for 20 seconds on final', check: (ctx) => (ctx.data.papiBest || 0) >= 20 },
    { id: 'no-torch', text: 'Fly the whole run with the guidance line switched off', check: (ctx) => !ctx.data.usedGuide },
  ],
  onStart: (ctx) => {
    ctx.sim.hasCargo = true;
    ctx.data.papiBest = 0;
  },
  ...meter(nightTick),
  steps: [
    {
      id: 'depart',
      text: 'Take off from runway 09 — the white lights show you the edges — then turn right towards the lighthouse.',
      hint: 'Keep between the two rows of lights. Pull back at 55 knots exactly as you do in daylight.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, runway zero nine cleared for take-off. Runway and approach lights are on.',
        voice: 'tower',
      },
      targetLabel: 'Needle Rock',
      target: () => NEEDLE_ROCK,
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'lighthouse',
      text: 'Climb to about 1,200 feet and fly out to the ring beside Needle Rock.',
      hint: 'The flashing light on the water is the lighthouse. The ring sits just north-east of it.',
      atc: { text: 'Skylark one seven two, report abeam Needle Rock.', voice: 'approach' },
      targetLabel: 'Needle Rock checkpoint',
      // Open water abeam the lighthouse, well clear of the 156 m rock.
      gates: [{ pos: new THREE.Vector3(-2600, 380, -3200), heading: 130, radius: 60 }],
    },
    {
      id: 'cross',
      text: 'Now turn south-east and cross to Mango Cay. Hold about 2,000 feet.',
      hint: 'It is a long dark leg. Check the heading and the altimeter every few seconds and leave everything else alone.',
      atc: { text: 'Sea Bird, Mango Cay. We have lit a fire by the pad so you can find us. Standing by.', voice: 'village' },
      targetLabel: 'Mango Cay',
      target: () => DELIVERY_PAD,
      check: (ctx) => horiz(ctx.ac.pos, DELIVERY_PAD) < 1500,
    },
    {
      id: 'descend',
      text: 'Come down below 600 feet above the ground and slow to about 70 knots for the drop.',
      hint: 'Take the power off early. Descending at night is done in small steps, not one big dive.',
      targetLabel: 'Drop target',
      target: () => DELIVERY_PAD,
      check: (ctx) => ft(ctx.ac.agl) < 620 && horiz(ctx.ac.pos, DELIVERY_PAD) < 450,
    },
    {
      id: 'drop',
      text: 'Press X over the target to release the crate.',
      hint: 'In the dark, aim for the middle of the lit ring and press X as it passes under the nose.',
      targetLabel: 'Drop target',
      target: () => DELIVERY_PAD,
      check: (ctx) => {
        const crate = ctx.sim.crate;
        if (!crate || !crate.landed) return false;
        const d = horiz(crate.group.position, DELIVERY_PAD);
        ctx.data.dropDistance = d;
        // 110 m instead of the daylight 90: you cannot see the target properly.
        if (d > 110) {
          ctx.sim.notify('Missed in the dark — here is another crate. Go round and try again.', 'warn');
          ctx.sim.removeCrate();
          ctx.sim.hasCargo = true;
          return false;
        }
        ctx.sim.notify(`Delivered — ${Math.round(d)} m from the middle, at night!`, 'good');
        return true;
      },
    },
    {
      id: 'home',
      text: 'Head north-west for home. Kestrel is the cluster of lights on the horizon.',
      hint: 'Climb back to 2,000 feet for the crossing, then come down once you can see the runway lights.',
      atc: { text: 'Skylark one seven two, cleared direct Kestrel, descend at your discretion.', voice: 'approach' },
      targetLabel: 'Kestrel Island',
      target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1800, 240, 0)),
      check: (ctx) => onWesterlyApproach(ctx, -600, -5200),
    },
    {
      id: 'land',
      text: 'Fly the PAPI down: two white and two red, all the way to the runway.',
      hint: 'At night the lights are better than your eyes. If it goes all red, add power immediately.',
      atc: { text: 'Skylark one seven two, cleared to land runway zero nine. Welcome back.', voice: 'tower' },
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak('Skylark one seven two, night freight complete. Not many people can do that. Taxi in.', 'tower');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const acc = ctx.data.dropDistance != null ? Math.max(0, 1 - ctx.data.dropDistance / 110) : 0.4;
    const papi = clamp((ctx.data.papiBest || 0) / 20, 0, 1);
    return Math.round((l ? l.score : 40) * 0.55 + acc * 30 + papi * 15);
  },
};

// ---------------------------------------------------------------------------
// 7. Medical Evacuation
// ---------------------------------------------------------------------------

function medevacTick(ctx) {
  const t = newTouchdown(ctx);
  if (t) {
    const p = touchdownPoint(ctx, t);
    // Only touchdowns near Mango Cay are the arrival being graded: a bounce on
    // the take-off run at Kestrel must not be mistaken for a landing attempt.
    const nearCay = Math.hypot(p.x - CAY.centre.x, p.z - CAY.centre.z) < 3000;
    if (!ctx.data.cayLanded && nearCay) {
      // The strip is not the Kestrel runway, so the engine's own grade means
      // nothing here — it scores every off-airport landing at half marks.
      // Measure the miss against the strip's own centre line instead.
      const cross = cayCrossTrack(p.x, p.z);
      ctx.data.cayCross = cross;
      ctx.data.cayVs = Math.abs(t.vsFpm);
      if (cross > 60 || Math.abs(cayAlongTrack(p.x, p.z)) > 280) {
        return 'You landed off the strip — the patient could not be reached';
      }
      ctx.data.cayLanded = true;
      ctx.sim.notify(`Down on the strip, ${Math.round(cross)} m off the centre line.`, 'good');
    } else if (ctx.data.cayLanded) {
      ctx.data.homeVs = Math.abs(t.vsFpm);
    }
  }
  if (!ctx.data.cayLanded && ctx.elapsed > 420) {
    return 'The doctor did not reach Mango Cay in time';
  }
  return null;
}

const MEDEVAC = {
  id: 'medevac',
  name: 'Medical Evacuation',
  short: 'A grass strip and a clock',
  difficulty: 'Medium',
  icon: '✚',
  blurb:
    'A child on Mango Cay needs a hospital. Land on the grass strip there — no tower, no PAPI, just a mown strip and a windsock — then fly the patient back to Kestrel.',
  reward: 'Teaches landing away from an airfield, judged by eye alone.',
  briefing: [
    { speaker: 'Doctor Reyes', text: 'Broken leg and a temperature. I need to be on that island in seven minutes, not seventeen.' },
    { speaker: 'Chief Pilot', text: 'The strip on Mango Cay runs north to south. You land heading one six five, coming in from the north over the water, and roll out south.' },
    { speaker: 'Chief Pilot', text: 'There are no approach lights and no PAPI. Pick your glide path by eye: threshold bars a third of the way up the windscreen, and hold it there.' },
    { speaker: 'Kestrel Tower', text: 'Wind one five zero at nine, so it is a mild headwind on the strip. Kind conditions. Go.' },
    { speaker: 'Doctor Reyes', text: 'And on the way back — she is nine years old and frightened. Fly it like it is made of glass.' },
  ],
  pay: 780,
  xp: 180,
  requires: ['night-run'],
  unlocks: 'Mango Cay strip as a free-flight start',
  weather: { time: 'day', condition: 'cloudy', windSpeedKts: 9, windDirDeg: 150 },
  spawn: RUNWAY_START,
  parTime: 660,
  timeLimit: 900,
  optional: [
    {
      id: 'gentle-for-the-patient',
      text: 'Both landings softer than 350 feet per minute',
      check: (ctx) => (ctx.data.cayVs || 999) < 350 && (ctx.data.homeVs || 999) < 350,
    },
    { id: 'golden-hour', text: 'Have the patient at Kestrel inside eleven minutes', check: (ctx) => ctx.elapsed < 660 },
  ],
  ...meter(medevacTick),
  steps: [
    {
      id: 'depart',
      text: 'Take off from runway 09 and turn south-east for Mango Cay. Do not waste time.',
      hint: 'Full power, 55 knots, pull back, then straight into the turn once you are above 300 feet.',
      atc: {
        text: 'Skylark one seven two, cleared for immediate take-off runway zero nine. Medical flight, you have priority.',
        voice: 'tower',
      },
      targetLabel: 'Mango Cay strip',
      target: () => CAY.threshold16,
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'cross',
      text: 'Cross to Mango Cay at about 2,000 feet, then set up to the north of the strip.',
      hint: 'The strip is on the west side of the island, running north to south. Aim to arrive north of it.',
      atc: { text: 'Sea Bird, Mango Cay. Strip is clear, windsock is showing a light headwind on one six five.', voice: 'village' },
      targetLabel: 'Mango Cay strip',
      target: () => CAY.threshold16,
      check: (ctx) => horiz(ctx.ac.pos, CAY.threshold16) < 2200,
    },
    {
      id: 'approach',
      text: 'Line up on the strip from the north, heading 165, and come down below 1,000 feet.',
      hint: 'Get on the extended line of the strip first, then start down. The last 800 metres are over open water, so nothing is in your way.',
      targetLabel: 'Mango Cay strip',
      target: () => CAY.touchdown16,
      check: (ctx) => {
        const p = ctx.ac.pos;
        return (
          cayAlongTrack(p.x, p.z) < -180 && // still north of the threshold
          cayAlongTrack(p.x, p.z) > -1600 &&
          cayCrossTrack(p.x, p.z) < 260 &&
          headingError(ctx.ac.heading, CAY.headingDeg) < 35 &&
          p.y - CAY.elev < 305 // 1,000 ft above the strip
        );
      },
    },
    {
      id: 'cay-land',
      text: 'Land on the grass and stop. Aim for the white bars at the near end.',
      hint: 'Flaps down with F, 60 knots over the threshold, then close the throttle and hold the nose up.',
      atc: { text: 'Sea Bird, you are cleared to land. We can see you. Good luck.', voice: 'village' },
      targetLabel: 'Touchdown zone',
      target: () => CAY.touchdown16,
      check: (ctx) => !!ctx.data.cayLanded && landedAndStopped(ctx),
      onDone: (ctx) => ctx.sim.notify('Doctor Reyes is out and running. Turn the aeroplane round.', 'good'),
    },
    {
      id: 'load',
      text: 'Wait while they carry the patient aboard.',
      hint: 'Keep the engine running and the brakes on with Space.',
      atc: {
        text: 'Sea Bird, she is aboard and strapped in. The doctor is with her. Thank you — now get her home.',
        voice: 'village',
      },
      duration: 12,
    },
    {
      id: 'cay-depart',
      text: 'Turn the aeroplane round with Q and E, line up down the strip the other way, and take off heading 345.',
      hint: 'Taxi with a little power, steer with Q and E, then full power once the nose is pointing north.',
      targetLabel: 'North end of the strip',
      target: () => CAY.threshold16,
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'home',
      text: 'Fly north-west to Kestrel and line up with runway 09 from the west.',
      hint: 'Smooth and level. She is in the back and every bump hurts.',
      atc: { text: 'Skylark one seven two, Kestrel Tower, the ambulance is on the apron. Cleared straight in.', voice: 'tower' },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1800, 240, 0)),
      check: (ctx) => onWesterlyApproach(ctx, -600, -5200),
    },
    {
      id: 'land',
      text: 'Land on runway 09 as gently as you know how, and stop.',
      hint: 'Slow, stable, and let the wheels kiss it. There is no hurry now.',
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak(
      'Skylark one seven two, the ambulance has her. Doctor Reyes says she is going to be absolutely fine. Thank you.',
      'tower'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const cross = ctx.data.cayCross != null ? ctx.data.cayCross : 60;
    const strip = clamp(1 - cross / 60, 0, 1);
    const speed = clamp(1 - ctx.elapsed / 900, 0, 1);
    return Math.round((l ? l.score : 40) * 0.4 + strip * 35 + speed * 25);
  },
};

// ---------------------------------------------------------------------------
// 8. Crosswind Checkride
// ---------------------------------------------------------------------------

function crosswindTick(ctx) {
  const ac = ctx.ac;
  // The low pass has to be flown in one piece: below 200 ft over the runway,
  // wheels never touching. Any wheel on the ground cancels it, and it arms
  // again the moment she is flying low over the tarmac — so a player who
  // touches by accident can simply climb a foot and finish the pass rather
  // than being sent all the way round.
  if (ac.onGround) {
    ctx.data.lowEnough = false;
  } else if (
    !ctx.data.passDone &&
    Math.abs(ac.pos.z) < 60 &&
    Math.abs(ac.pos.x) < 550 &&
    ac.pos.y - ELEV < 61
  ) {
    ctx.data.lowEnough = true;
  }
  const t = newTouchdown(ctx);
  if (t) {
    if (!t.onRunway) return 'You touched down off the runway';
    if (!ctx.data.passDone) {
      ctx.sim.notify('Wheels down — that was a landing, not a low pass. Fly the length of it again.', 'warn');
    } else {
      ctx.data.finalTouch = t;
    }
  }
  return null;
}

const CROSSWIND = {
  id: 'crosswind',
  name: 'Crosswind Checkride',
  short: 'Runway 27, wind from the side',
  difficulty: 'Medium',
  icon: '⇢',
  blurb:
    'Sixteen knots of wind straight across the runway, and you are landing the other way — on 27, from the east, with no PAPI to help. A low pass first, then the real thing.',
  reward: 'Teaches the crab angle: point into the wind, then straighten at the last moment.',
  briefing: [
    { speaker: 'Chief Pilot', text: 'Checkride. You are already airborne east of the island and today you land on runway two seven, westbound.' },
    { speaker: 'Chief Pilot', text: 'There is no PAPI from this side — those four lights only work on a westerly approach. You judge the glide path yourself.' },
    { speaker: 'Kestrel Tower', text: 'Wind one nine zero at sixteen, so it is pushing you from the left the whole way down.' },
    { speaker: 'Chief Pilot', text: 'Point the nose slightly into the wind — to the left — and let the aeroplane track straight down the middle. That angle is called a crab.' },
    { speaker: 'Chief Pilot', text: 'One low pass first, at or below two hundred feet, without touching. Then go round and land it.' },
  ],
  pay: 700,
  xp: 200,
  requires: ['night-run'],
  unlocks: 'The Kestrel Ridge contract, once the medevac is done too',
  weather: { time: 'day', condition: 'cloudy', windSpeedKts: 16, windDirDeg: 190 },
  // Over water heightAt() is -34, so altAGL 519 puts her at 485 m — about 1,590 ft.
  spawn: { pos: new THREE.Vector3(4200, 0, 0), headingDeg: 270, speed: 56, altAGL: 519, engineOn: true },
  parTime: 420,
  timeLimit: 600,
  optional: [
    {
      id: 'wings-level',
      text: 'Touch down with the wings within 5 degrees of level',
      check: (ctx) => !!ctx.data.finalTouch && Math.abs(ctx.data.finalTouch.bank) < 5,
    },
    {
      id: 'on-the-line',
      text: 'Touch down within 6 metres of the centre line',
      check: (ctx) => !!ctx.data.finalTouch && ctx.data.finalTouch.centreline < 6,
    },
  ],
  ...meter(crosswindTick),
  steps: [
    {
      id: 'setup',
      text: 'You are west-bound at 1,600 feet. Come down towards the runway and line up on the numbers 27.',
      hint: 'The wind is from your left. Point the nose a little to the left of the runway to stop yourself drifting.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, wind one nine zero at one six. Runway two seven, cleared for the low approach.',
        voice: 'tower',
        urgency: 1,
      },
      targetLabel: 'Runway 27',
      target: () => RUNWAY.thresholdEast,
      // 400 m above the field with 2.8 km still to run: a gentle glide from the
      // 485 m start, leaving the rest of the descent for the pass itself.
      check: (ctx) =>
        ctx.ac.pos.x < 2800 &&
        ctx.ac.pos.x > 500 &&
        Math.abs(ctx.ac.pos.z) < 500 &&
        headingError(ctx.ac.heading, 270) < 45 &&
        ctx.ac.pos.y - ELEV < 400,
    },
    {
      id: 'lowpass',
      text: 'Fly the whole length of the runway at or below 200 feet — without letting the wheels touch.',
      hint: 'Keep a little power on and hold the height. Watch how much the nose has to point left to stay over the centre line.',
      atc: { text: 'Skylark one seven two, low approach approved, runway two seven.', voice: 'tower' },
      targetLabel: 'Far end of the runway',
      target: () => RUNWAY.thresholdWest,
      check: (ctx) => !!ctx.data.lowEnough && !ctx.ac.onGround && ctx.ac.pos.x < RUNWAY.thresholdWest.x - 40,
      onDone: (ctx) => {
        ctx.data.passDone = true;
        ctx.sim.notify('Good pass. Now climb away and come back round for the landing.', 'good');
      },
    },
    {
      id: 'circuit',
      text: 'Climb away, turn right, and come back round to the east for the real landing on 27.',
      hint: 'Climb to about 1,000 feet, fly a rectangle to the north, and roll out heading west with the runway ahead.',
      atc: { text: 'Skylark one seven two, right hand circuit, report on final for two seven.', voice: 'tower' },
      targetLabel: 'East of the field',
      target: () => new THREE.Vector3(2600, ELEV + 260, 0),
      check: (ctx) =>
        ctx.ac.pos.x > 1600 &&
        !ctx.ac.onGround &&
        Math.abs(ctx.ac.pos.z) < 900 &&
        headingError(ctx.ac.heading, 270) < 50,
    },
    {
      id: 'land',
      text: 'Land on runway 27. Straighten the nose with Q just before the wheels touch.',
      hint: 'Crab all the way down, then a kick of rudder to point straight, and let it settle. Keep the wings level.',
      atc: { text: 'Skylark one seven two, runway two seven, cleared to land. Wind one nine zero at one six.', voice: 'tower' },
      targetLabel: 'Touchdown zone',
      target: () => new THREE.Vector3(350, ELEV, 0),
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak(
      'Skylark one seven two, that is your crosswind checkride signed off. Sixteen knots across and you held the centre line. Well flown.',
      'tower'
    );
  },
  score: (ctx) => {
    const t = ctx.data.finalTouch || ctx.data.lastTouchdown;
    if (!t) return 40;
    const centred = clamp(1 - t.centreline / 14, 0, 1);
    const level = clamp(1 - Math.abs(t.bank) / 14, 0, 1);
    const smooth = clamp(1 - Math.abs(t.vsFpm) / 700, 0, 1);
    return Math.round(centred * 34 + level * 28 + smooth * 38);
  },
};

export const CAMPAIGN_PART_A = [
  FIRST_FLIGHT,
  CIRCUITS,
  ISLAND_CIRCUIT,
  DELIVERY,
  CHARTER,
  NIGHT_RUN,
  MEDEVAC,
  CROSSWIND,
];

/**
 * Wildfire missions, for the aeroplane and the helicopter.
 *
 * "add forest fires you need to put out in missions for plane/helicopter sim"
 *
 * Nine of them, the same four lessons in both machines and one more that only
 * the helicopter can fly:
 *
 *   Spot Fire / Bucket Brigade     a small grass fire, one drop puts it out.
 *                                  Teaches filling up and letting go.
 *   Save Kestrel Town / Hold the Town   a grass fire running at the town on a
 *                                  strong wind. Knock the head of it down
 *                                  before it gets there — or hold it off until
 *                                  the fire crews arrive.
 *   The Big Burn / Ridge Fire      a big forest fire that takes several
 *                                  fills. No clock: it is about working the
 *                                  edge, one drop at a time.
 *   Night Fire / Night Watch       a forest fire in the dark, where the fire
 *                                  is the brightest thing on the island.
 *   Line One                       Firewatch Ridge's prepared fire block: hold
 *                                  the crews' line and put out every spot fire
 *                                  that jumps it.
 *
 * All the fire itself — spreading, water, drawing, the HUD — is in
 * features/wildfire.js. A mission here is a scenario (`fire`: where it
 * starts, how fast it goes, what it must not reach, which woods burn) plus
 * steps written the way the other missions are.
 *
 * EVERY SCENARIO IS FLOWN BEFORE IT SHIPS. tests/features/fire.mjs lights
 * each one on its real map in node and flies it with a robot pilot — the same
 * ignition, preburn, crews and water parcels the game runs, at a child's
 * pace (a minute of turning round and lining up on every trip) and with a
 * sloppy aim. The robot has to win each one inside its time, and a pilot who
 * never drops any water has to lose the ones with a town or a base in the way
 * and never be handed a win. The first version of this file was written
 * without that: four of its nine fires burnt themselves out with nobody
 * touching them, which completed the mission, and the Big Burn could not be
 * won at all.
 *
 * Aeroplane missions fly the Tempest WR-4, the heavy twin; it carries 2,700 L
 * in a scooping tank. Helicopter missions fly the Skyhook with a 320 L bucket.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt, MAP } from '../../world/terrain.js';
import { setupFire, fireStatus, fireGuide, fireGuideLabel, fillPoint } from '../../features/wildfire.js';
import { findWater } from '../../features/wildfire/scenario.js';

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * An airborne start at a real height over whatever is below — sea or land.
 * reset() measures altAGL from heightAt, which over the sea is the sea BED,
 * so 200 m "above the ground" off Kestrel is 166 m above the water. A getter,
 * because the map is only loaded when the mission starts.
 */
function airSpawn(x, z, headingDeg, height = 200, speed = 60) {
  return {
    pos: new THREE.Vector3(x, 0, z),
    headingDeg,
    speed,
    get altAGL() {
      return height - Math.min(0, heightAt(x, z));
    },
  };
}

function padSpawn(x, z, headingDeg) {
  return { pos: new THREE.Vector3(x, 0, z), headingDeg };
}

/**
 * A scooping lane on the sea: its middle, and the way to fly along it
 * (towards the fire). The drawn lane is 760 m long.
 */
function lane(x, z, headingDeg) {
  return { x, z, headingDeg, heading: (headingDeg * Math.PI) / 180 };
}
const LANE_HALF = 380;

/**
 * An aeroplane's start: on the lane's own line, `back` metres short of where
 * it begins, pointing along it at 180 m over the sea.
 *
 * The first versions started the Tempest 1.1 to 1.4 km from the lane at
 * 220 m, and at the speed it starts at that is twenty seconds to lose 190 m
 * — 1,800 ft a minute, in the first mission, from a child who has never
 * scooped before. Most would overshoot and have to come round. From 2.7 km
 * out at 180 m it is 630 ft a minute, straight ahead, with the lane in the
 * windscreen from the first frame.
 */
function laneSpawn(ln, back = 2700, height = 180) {
  const ux = Math.sin(ln.heading);
  const uz = -Math.cos(ln.heading);
  const d = LANE_HALF + back;
  return airSpawn(Math.round(ln.x - ux * d), Math.round(ln.z - uz * d), ln.headingDeg, height, 60);
}

const heli = (ctx) => fireStatus(ctx.sim).kind === 'bucket';

/** Read every frame by the runner's arrow; one vector, not one a frame. */
const _fillTarget = new THREE.Vector3();

function fillStep(extra = {}) {
  return {
    id: 'fill',
    text: extra.text || 'Fill up with water first.',
    textFor: (ctx) => (heli(ctx)
      // No height here: over the sea the helicopter's RAD ALT reads to the
      // sea BED (physics.js agl), 130 ft more than the water off Kestrel,
      // so "under 60 ft" on this line and 190 on the dial disagreed. The
      // fire panel's tip gives the height above the water itself.
      ? 'Fly to the blue ring on the sea and hover low over it, until the bucket dips into the water and fills. The fire panel tells you how high you are above the water.'
      : 'Fly to the blue lane on the sea. Flaps out (F), get down under 100 ft and skim along it to fill the tank.'),
    hint: 'The arrow points at the water. The panel on the right says what to change.',
    atc: extra.atc,
    targetLabel: 'Water',
    target: () => fillPoint(_fillTarget),
    check: (ctx) => {
      const s = fireStatus(ctx.sim);
      return s.filledOnce || s.fraction > 0.85 || s.drops > 0;
    },
  };
}

function dropStep(extra = {}) {
  return {
    id: 'drop',
    text: extra.text || 'Full! Now fly over the flames and let the water go with X (or DROP WATER). The ring on the ground shows where it will land — go when it turns green.',
    hint: 'Come in low and slow. Let go just before the flames — the water keeps moving forward as it falls.',
    atc: extra.atc,
    // The fire while there is water aboard, the sea once there is not: a drop
    // that misses empties the tank too, and an arrow still pointing at the
    // flames would send you round again with nothing to drop.
    get targetLabel() {
      return fireGuideLabel();
    },
    target: (ctx) => fireGuide(ctx.sim),
    check: (ctx) => {
      const s = fireStatus(ctx.sim);
      return s.hits > 0 || s.out;
    },
  };
}

function fightStep({ id = 'fight', text, hint, atc }) {
  return {
    id,
    text,
    hint: hint || 'Empty? Back to the water. Full? Hit the edge the arrow points at.',
    atc,
    get targetLabel() {
      return fireGuideLabel();
    },
    target: (ctx) => fireGuide(ctx.sim),
    // Out, and out because of you: failIf below catches a fire that burnt
    // itself out before any water reached it.
    check: (ctx) => {
      const s = fireStatus(ctx.sim);
      return s.out && s.hits > 0;
    },
  };
}

function score(ctx) {
  const s = fireStatus(ctx.sim);
  const acc = s.drops ? s.hits / s.drops : 0;
  const par = (ctx.runner && ctx.runner.def && ctx.runner.def.parTime) || 400;
  const quick = Math.max(0, 1 - ctx.elapsed / (par * 2));
  return Math.round(40 + acc * 40 + quick * 20);
}

function start(scenario) {
  return (ctx) => {
    // Whatever the last flight left hanging off this airframe is not ours.
    ctx.ac.extraMass = 0;
    setupFire(ctx, typeof scenario === 'function' ? scenario(ctx) : scenario);
  };
}

/**
 * The step text that depends on which machine you are in — the runner shows
 * `text`, so the heli and plane versions of a lesson set theirs in enter().
 */
function withMachineText(step) {
  if (!step.textFor) return step;
  const enter = step.enter;
  return {
    ...step,
    // `this` is the step the runner holds, which is the one it shows.
    enter(ctx) {
      this.text = step.textFor(ctx);
      if (enter) enter.call(this, ctx);
    },
  };
}

/**
 * How a fire mission is lost: the fire got to what it must not reach, or it
 * burnt itself out before a drop ever hit it. The second is not really the
 * player's fault, but the alternative — a mission that completes itself if
 * you wait long enough — is worse, and the scenarios are tuned so that it
 * does not happen to anybody who is trying.
 */
function lostIf(reachedText, { giveUp = 0 } = {}) {
  return (ctx) => {
    const s = fireStatus(ctx.sim);
    if (s.reached && reachedText) return reachedText;
    if (s.live && s.out && !s.hits) {
      return 'The fire burnt itself out before any water reached it. Try again — straight to the water, then straight to the fire!';
    }
    // Out on its own, long after the last drop: the crews finish a fire
    // somebody is fighting (see wildfire/scenario.js), and this one burnt
    // down while nobody was.
    if (s.live && s.out && !s.mopping && !s.recent) {
      return 'The fire burnt itself out while nobody was dropping water on it. Try again — keep the drops coming until the crews take over!';
    }
    // A line that is still burning on the wrong side long after the crews
    // arrived is a line that has been lost, even if the base is a long way
    // off yet: without this, a player who stopped trying had a mission that
    // never ended.
    if (giveUp && ctx.elapsed > giveUp && s.across > 0) {
      return 'The fire got too big on the base side and the crews had to pull back from Line One. Try again — hit each spot fire while it is small!';
    }
    return null;
  };
}

const TOWN_LOST = 'The fire got into the town. The fire engines saved the houses — but that was too close. Try again!';

/* ------------------------------------------------------------------ *
 * Scenarios. Map coordinates, measured with the fire model's own ground
 * classifier (features/wildfire/ground.js) — every ignition point is on
 * grass or forest, and every water point is open sea. The numbers after
 * each one are the robot pilot's, from tests/features/fire.mjs.
 * ------------------------------------------------------------------ */

/*
 * Kestrel, east coast, grass. Slow on purpose (spread 0.35, cells burn 1.6x
 * as long) so the fire you were shown is still the fire you find. One drop,
 * and the crews finish it.
 */
const SPOT_KESTREL = {
  centre: { x: 1900, z: -300 },
  lane: lane(2924, -298, 270),
  ignite: [{ x: 1900, z: -300, r: 30 }],
  preburn: 20,
  spread: 0.35,
  burn: 1.6,
  spot: 0,
  mopUp: 0.6,
  smallLeft: 10,
  mopText: 'Fire crew: "That knocked it flat — we will finish it. Great first drop!"',
};

/*
 * Egg Rock, off Condor: the same first lesson on a low grassy island 4 km
 * west of the clifftop strip, with the sea a few hundred metres away on
 * every side (the owner, 2026-10-02: "use different maps for different
 * missions"). Measured in node on Condor's height field: 365 of the 441
 * cells within 500 m are grass at 38-42 m, and findWater's own scooping
 * lane for it is 1,230 m due north, pointing south at the fire.
 */
const SPOT_CONDOR = {
  ...SPOT_KESTREL,
  centre: { x: -3700, z: 2600 },
  lane: lane(-3700, 1370, 180),
  ignite: [{ x: -3700, z: 2600, r: 30 }],
};

/*
 * Kestrel, from the south coast up to the town, grass. Spread 0.55 with cells
 * burning 40 s keeps the flanks just below the rate that sustains them, so it
 * runs as a narrow finger up the wind instead of a wall — a thing a child
 * can stop. Left alone it reaches the edge of town in about eight and a half
 * minutes; the robot's first drop lands at two and a half. The crews come at
 * nine minutes and take over at 60 % in both machines. With eleven minutes
 * and 70 %, the Tempest's robot lost the town in two runs of twenty-four with
 * every drop a hit, the nearer thirty seconds before the crews came; now it
 * wins all twenty-four, and the Skyhook's twenty-three. The crews need a hit
 * in the last four minutes, so the shorter clock is not a shorter wait for
 * a pilot who dropped once and went home: that pilot loses the town in ten
 * runs of twelve and wins the other two with a first drop that put nearly
 * all of it out.
 */
const TOWN_KESTREL = {
  centre: { x: 600, z: 1200 },
  lane: lane(835, 2755, 338),
  ignite: [{ x: 450, z: 1800, r: 60 }],
  preburn: 20,
  spread: 0.55,
  burn: 0.5,
  spot: 0,
  protect: 'town',
  protectName: 'the town',
  holdSeconds: 540,
  mopUp: 0.6,
  smallLeft: 5,
  mopText: 'Fire chief: "The engines are here and it is going nowhere. You saved the town!"',
};

/*
 * Harrier Flats, north-east: a planted wood half a kilometre across, burning
 * in two places for two minutes before you arrive. Forest burns long, so the
 * fire is big and deep, but it spreads slowly, so it is worth working.
 */
const BIGBURN_FLATS = {
  centre: { x: 2000, z: -1800 },
  lane: lane(3621, -2653, 240),
  woods: [{ x: 2000, z: -1800, r: 520 }],
  ignite: [
    { x: 1900, z: -1900, r: 50 },
    { x: 2150, z: -1650, r: 40 },
  ],
  preburn: 120,
  spread: 0.55,
  burn: 0.8,
  spot: 0.4,
  mopUp: 0.6,
  smallLeft: 8,
  mopText: 'Fire crew: "That is a line we can hold. Brilliant work up there!"',
};

/*
 * The West Kestrel Hills, wooded, at night. The helicopter's is one fire;
 * the Tempest's is the same wood alight in two places and burning a minute
 * longer, because one tank of 2,700 L put the single one out and a night
 * mission that is over in one pass is not much of a night.
 */
const NIGHT_KESTREL = {
  centre: { x: -1300, z: 1400 },
  woods: [{ x: -1350, z: 1400, r: 400 }],
  ignite: [{ x: -1200, z: 1350, r: 50 }],
  preburn: 90,
  spread: 0.5,
  burn: 0.9,
  spot: 0.3,
  mopUp: 0.65,
  smallLeft: 6,
};
const NIGHT_KESTREL_BIG = {
  ...NIGHT_KESTREL,
  lane: lane(-2051, 2413, 33),
  ignite: [{ x: -1200, z: 1350, r: 50 }, { x: -1450, z: 1250, r: 40 }],
  preburn: 150,
};

/*
 * The Aurora shelf, a kilometre north of the town, at night: a boreal wood
 * the same size as Kestrel's, alight in two places (the owner, 2026-10-02:
 * "fire on forested maps"). Measured in node on the Fjords' height field:
 * the wood sits on 107-141 m of ground with 172 forest cells and 242 grass
 * within 500 m once the woods are planted, and findWater's scooping lane
 * for it is the sound to the west, 1,330 m out, pointing north-east at the
 * glow. The helicopter's Night Watch stays on Kestrel.
 */
const NIGHT_FJORD_BIG = {
  ...NIGHT_KESTREL,
  centre: { x: -900, z: -400 },
  woods: [{ x: -900, z: -400, r: 380 }],
  lane: lane(-2052, 265, 60),
  ignite: [{ x: -820, z: -440, r: 50 }, { x: -1000, z: -320, r: 40 }],
  preburn: 150,
};

/*
 * Firewatch Ridge: the wooded north-west slopes of the Long Scarp, with the
 * sea half a kilometre west of the trees — bucket country.
 */
const RIDGE_FIREWATCH = {
  centre: { x: 550, z: -3550 },
  woods: [{ x: 550, z: -3600, r: 480 }],
  ignite: [
    { x: 600, z: -3550, r: 40 },
    { x: 350, z: -3700, r: 30 },
  ],
  preburn: 90,
  spread: 0.5,
  burn: 0.8,
  spot: 0.3,
  mopUp: 0.6,
  smallLeft: 6,
  mopText: 'Firewatch: "That is held. Bring her home — brilliant flying."',
};

/*
 * LINE ONE. Firewatch Ridge's prepared fire block (maps.js, `fire`): the
 * crews have cut a break along `line.path`, from the ridge down to the strip,
 * and the water is `waterSource.dip` in the Bay. An east wind — from 105,
 * square across the break; the map's north-easterly ran along it and never
 * put an ember over — pushes the fire in the wood east of the line on to it,
 * and embers come over every minute and a quarter (scenario.js, throwEmber).
 * Your job is every one of those. The crews need seven minutes to finish the break; they cannot
 * take over while anything is burning on the base side. It fails if the fire
 * gets to within 400 m of the base.
 */
function lineOne() {
  const f = (MAP && MAP.fire) || {};
  const path = (f.line && f.line.path) || [
    { x: 1357, z: -2486 },
    { x: 1086, z: -2029 },
    { x: 679, z: -1343 },
    { x: 407, z: -886 },
    { x: 0, z: -200 },
  ];
  const base = f.base || { x: -1050, z: -100 };
  const dip = (f.waterSource && f.waterSource.dip) || { x: -1650, z: 0 };
  /*
   * The map's water is the Bay, 2 km from the stretch of line the fire comes
   * down on: a four-minute round trip with a bucket. The robot pilot could
   * not keep up with one ember in three at that range. The channel between
   * the shelf and the Long Scarp is 850 m away, so that is where the ring
   * goes when it is that much nearer — the Bay is still the Bay, and the
   * bucket fills in any open sea.
   */
  const mid = { x: 250, z: -700 };
  const near = findWater(mid.x, mid.z, 'bucket');
  const useNear = near && Math.hypot(near.x - mid.x, near.z - mid.z) < 0.6 * Math.hypot(dip.x - mid.x, dip.z - mid.z);
  return {
    centre: { x: 300, z: -800 },
    woods: [{ x: 350, z: -750, r: 650 }],
    ignite: [{ x: 700, z: -950, r: 50 }, { x: 780, z: -1120, r: 40 }],
    preburn: 60,
    spread: 0.6,
    burn: 0.7,
    // The break is two cells wide and the spread is neighbour to neighbour,
    // so only an ember gets over. The model's own spotting is off: with it
    // on, the fire lit a few hundred metres back had put nineteen cells over
    // the line before the first bucket could arrive. The timed ones below are
    // the mission.
    spot: 0,
    embers: { first: 90, every: 120, min: 60, max: 140, reach: 450, r: 20 },
    line: { path, width: 40 },
    protect: { x: base.x, z: base.z, r: 400, name: 'Firewatch Base' },
    holdSeconds: 420,
    holdNeedsLine: true,
    crewHelp: 6,
    helpText: 'Crew boss: "Line One is dug! We are coming over to help with the spot fires — keep the buckets coming!"',
    water: useNear ? { x: near.x, z: near.z } : { x: dip.x, z: dip.z },
    waterName: useNear ? 'the channel' : (f.waterSource && f.waterSource.name) || 'the Bay',
    mopUp: 2, // never by containment — the crews finish it
    smallLeft: 0,
    mopText: 'Crew boss: "Line One is finished and holding. You kept every ember off it — superb!"',
  };
}

const DEFS = [
  /* ============================ AEROPLANE ============================ */
  {
    id: 'fire-spot',
    category: 'rescue',
    name: 'Spot Fire',
    short: 'Your first water drop',
    difficulty: 'Easy',
    icon: '🔥',
    map: 'condor',
    aircraft: 'tempest',
    blurb:
      'A little grass fire on Egg Rock, off Condor. Skim the sea to fill the Tempest’s tank, fly over the fire and let the water go. One good drop puts it out.',
    reward: 'Teaches scooping — low, slow, flaps out — and judging a drop.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 7, windDirDeg: 80 },
    spawn: laneSpawn(SPOT_CONDOR.lane),
    parTime: 240,
    fire: SPOT_CONDOR,
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Tempest one, Condor Fire. Small grass fire on Egg Rock. Fill up on the lane and go get it.', voice: 'tower' },
        })
      ),
      dropStep(),
      fightStep({
        text: 'Nearly there — if anything is still burning, fill up again and finish it off.',
      }),
    ],
    failIf: lostIf(null),
    onComplete: (ctx) => ctx.sim.speak('Tempest one, fire is out. Textbook.', 'tower'),
    score,
  },

  {
    id: 'fire-town',
    category: 'rescue',
    name: 'Save Kestrel Town',
    short: 'Stop it before it gets there',
    difficulty: 'Medium',
    icon: '🔥',
    map: 'kestrel',
    aircraft: 'tempest',
    blurb:
      'A grass fire has started on the south coast and a strong south wind is pushing it straight at the town. Hit the front of it — the edge nearest the houses — and keep hitting it until it stops.',
    reward: 'Teaches working the head of a fire, and fast turnarounds.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 18, windDirDeg: 190 },
    spawn: laneSpawn(TOWN_KESTREL.lane),
    parTime: 480,
    fire: TOWN_KESTREL,
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Tempest one, Kestrel Fire. Grass fire south of town, wind one nine zero at eighteen. It is heading for the houses. Scoop and drop, fast as you can.', voice: 'tower' },
        })
      ),
      dropStep({ text: 'Tank full. Hit the FRONT of the fire — the part nearest the town. X to drop when the ring goes green.' }),
      fightStep({
        text: 'Keep it out of town! Fill, drop on the front, repeat. The fire crews are on their way — the panel shows how long.',
      }),
    ],
    failIf: lostIf(TOWN_LOST),
    onComplete: (ctx) => ctx.sim.speak('Tempest one, the town is safe. Thank you.', 'tower'),
    score,
  },

  {
    id: 'fire-bigburn',
    category: 'rescue',
    name: 'The Big Burn',
    short: 'A forest fire, several fills',
    difficulty: 'Hard',
    icon: '🔥',
    map: 'meadow',
    aircraft: 'tempest',
    blurb:
      'The woods north-east of Harrier Flats have been burning for a while. It is far too big for one drop — work round the edge, one tank at a time, until the crews can hold it.',
    reward: 'Teaches working a big fire’s edge and flying the same circuit well, again and again.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 10, windDirDeg: 300 },
    spawn: laneSpawn(BIGBURN_FLATS.lane),
    parTime: 720,
    fire: BIGBURN_FLATS,
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Tempest one, Flats Fire Control. Forest fire north-east of the airfield. Scoop off the east coast and start on the edge.', voice: 'tower' },
        })
      ),
      dropStep({ text: 'Full. Pick the edge that is spreading — the arrow shows it — and drop across it.' }),
      fightStep({
        text: 'Keep working the edge. Every drop soaks the ground so it cannot burn. Watch the CONTAINED number climb.',
      }),
    ],
    failIf: lostIf(null),
    onComplete: (ctx) => ctx.sim.speak('Tempest one, crews have it. Head home, and well done.', 'tower'),
    score,
  },

  {
    id: 'fire-night',
    category: 'rescue',
    name: 'Night Fire',
    short: 'A forest fire, in the dark',
    difficulty: 'Medium',
    icon: '🔥',
    map: 'fjord',
    aircraft: 'tempest',
    blurb:
      'The woods on the Aurora shelf, north of the town, are alight after dark. You will see the fire from miles away — the trouble is seeing the sea. Trust the blue lane and your altimeter when you scoop.',
    reward: 'Teaches flying by instruments low over dark water.',
    weather: { time: 'night', condition: 'clear', windSpeedKts: 10, windDirDeg: 220 },
    spawn: laneSpawn(NIGHT_FJORD_BIG.lane),
    parTime: 600,
    fire: { ...NIGHT_FJORD_BIG, mopText: 'Fire crew: "Got it. Nice flying in the dark!"' },
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Tempest one, Aurora Fire. Forest fire on the shelf north of town — you cannot miss the glow. Fill up in the sound to the west.', voice: 'tower' },
        })
      ),
      dropStep({ text: 'Full. The glow is the fire. Come in low over it and drop when the ring goes green.' }),
      fightStep({ text: 'Keep going until the crews can hold it. Watch your height over the dark water.' }),
    ],
    failIf: lostIf(null),
    onComplete: (ctx) => ctx.sim.speak('Tempest one, that is out. Good night’s work.', 'tower'),
    score,
  },

  /* ============================ HELICOPTER ============================ */
  {
    id: 'fire-bucket',
    game: 'heli',
    category: 'rescue',
    name: 'Bucket Brigade',
    short: 'Your first bucket drop',
    difficulty: 'Easy',
    icon: '🔥',
    map: 'kestrel-port',
    aircraft: 'harrier',
    blurb:
      'A small grass fire on the hill above the harbour. Hover low over the bay until the bucket dips in and fills, carry it up the hill, and let it go over the flames.',
    reward: 'Teaches the long-line bucket: a low, steady hover and a swinging load.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 250 },
    spawn: padSpawn(-1672, -1620, 110),
    parTime: 240,
    fire: {
      centre: { x: -1350, z: -1150 },
      ignite: [{ x: -1350, z: -1150, r: 30 }],
      preburn: 20,
      spread: 0.35,
      burn: 1.6,
      spot: 0,
      mopUp: 0.6,
      smallLeft: 10,
      mopText: 'Fire crew: "Right on it — we will mop up the rest. Great first bucket!"',
    },
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Skyhook three, Kestrel Fire. Small grass fire on the hill behind you. Dip the bucket in the bay and bring it up.', voice: 'tower' },
        })
      ),
      dropStep({ text: 'Bucket full! Fly up the hill to the smoke. Slow down over the flames and press X (or DROP WATER).' }),
      fightStep({ text: 'Anything still burning? Another bucket will finish it.' }),
    ],
    failIf: lostIf(null),
    onComplete: (ctx) => ctx.sim.speak('Skyhook three, fire out. That is how it is done.', 'tower'),
    score,
  },

  {
    id: 'fire-heli-town',
    game: 'heli',
    category: 'rescue',
    name: 'Hold the Town',
    short: 'Fire on the wind, houses in the way',
    difficulty: 'Medium',
    icon: '🔥',
    map: 'kestrel-port',
    aircraft: 'harrier',
    blurb:
      'A grass fire is running up from the south coast towards the town — and the hospital. Bucket after bucket on the front of it, until it stops or the crews get there.',
    reward: 'Teaches short, quick bucket runs and where a drop matters most.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 16, windDirDeg: 190 },
    spawn: padSpawn(760, 560, 180),
    parTime: 480,
    fire: TOWN_KESTREL,
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Skyhook three, Kestrel Fire. Grass fire south of town running north on the wind. Water is off the south beach. Go.', voice: 'tower' },
        })
      ),
      dropStep({ text: 'Bucket full. Hit the front of the fire — the edge nearest the town.' }),
      fightStep({
        text: 'Keep it out of town! Short hops: dip, drop on the front, back again. The crews are coming — the panel shows how long.',
      }),
    ],
    failIf: lostIf(TOWN_LOST),
    onComplete: (ctx) => ctx.sim.speak('Skyhook three, the town is safe. Outstanding.', 'tower'),
    score,
  },

  {
    id: 'fire-ridge',
    game: 'heli',
    category: 'rescue',
    name: 'Ridge Fire',
    short: 'A forest fire on the Long Scarp',
    difficulty: 'Hard',
    icon: '🔥',
    map: 'firewatch',
    aircraft: 'harrier',
    blurb:
      'The woods on the Long Scarp are burning, north of the base. It will take bucket after bucket. Work the edges, watch the CONTAINED number, and keep the sea close.',
    reward: 'Teaches a long job done well: steady hovers, quick fills, drops on the edge.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 9, windDirDeg: 20 },
    spawn: padSpawn(-1050, -100, 0),
    parTime: 720,
    fire: RIDGE_FIREWATCH,
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Skyhook three, Firewatch. Forest fire on the Long Scarp, north of you. Nearest water is marked. Work the edges.', voice: 'tower' },
        })
      ),
      dropStep({ text: 'Bucket full. Drop on the edge the arrow shows — that is where it is spreading.' }),
      fightStep({ text: 'Keep going until the crews can hold it. Every bucket on the edge counts.' }),
    ],
    failIf: lostIf(null),
    onComplete: (ctx) => ctx.sim.speak('Skyhook three, Firewatch. Scarp fire is held. Well done.', 'tower'),
    score,
  },

  {
    id: 'fire-heli-night',
    game: 'heli',
    category: 'rescue',
    name: 'Night Watch',
    short: 'Bucket work in the dark',
    difficulty: 'Medium',
    icon: '🔥',
    map: 'kestrel-port',
    aircraft: 'harrier',
    blurb:
      'The woods in the western hills are burning, at night. The glow shows you the fire; the blue ring shows you the water. Hover carefully — the sea is black.',
    reward: 'Teaches holding a hover by the instruments when you cannot see the water.',
    weather: { time: 'night', condition: 'clear', windSpeedKts: 8, windDirDeg: 220 },
    spawn: padSpawn(-520, -150, 270),
    parTime: 600,
    fire: { ...NIGHT_KESTREL, mopText: 'Fire crew: "We have it. Lovely flying, Skyhook."' },
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Skyhook three, Kestrel Fire. Forest fire in the western hills. Water is west of it. Watch your height over the sea.', voice: 'tower' },
        })
      ),
      dropStep({ text: 'Bucket full. Follow the glow, slow down over it and let it go.' }),
      fightStep({ text: 'Keep the buckets coming until the crews can hold it.' }),
    ],
    failIf: lostIf(null),
    onComplete: (ctx) => ctx.sim.speak('Skyhook three, fire held. Come on home.', 'tower'),
    score,
  },

  {
    id: 'fire-lineone',
    game: 'heli',
    category: 'rescue',
    name: 'Line One',
    short: 'Hold the crews’ fire line',
    difficulty: 'Hard',
    icon: '🔥',
    map: 'firewatch',
    aircraft: 'harrier',
    blurb:
      'The crews have dug a fire break down Firewatch Ridge — Line One — and an east wind is pushing the fire onto it. Embers will jump it. Put out every spot fire on the base side until the crews finish the line.',
    reward: 'Teaches picking the right target, fast.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 13, windDirDeg: 105 },
    spawn: padSpawn(-1050, -100, 90),
    parTime: 480,
    fire: lineOne,
    steps: [
      withMachineText(
        fillStep({
          atc: { text: 'Skyhook three, Firewatch. Fire is coming down on Line One on an east wind. Fill up at the blue ring and stand by for spot fires.', voice: 'tower' },
        })
      ),
      dropStep({
        text: 'Bucket full. The arrow shows the fire nearest the line. Knock it down — the less it burns against the line, the fewer embers jump it.',
      }),
      fightStep({
        id: 'hold',
        text: 'Hold Line One! Any fire on the base side of the line goes first. The crews need the time on the panel.',
      }),
    ],
    failIf: lostIf('The fire crossed Line One and reached the base. The crews are safe — but the line was lost. Try again!', { giveUp: 1200 }),
    onComplete: (ctx) => ctx.sim.speak('Skyhook three, Firewatch. Line One holds. Superb.', 'tower'),
    score,
  },
];

/**
 * Each mission's fire is data (`fire`, an object or a function of the loaded
 * map) and the onStart that lights it is made from that, so the node tests
 * can fly exactly the scenario the game will.
 */
export const MISSIONS = DEFS.map((m) => ({ ...m, onStart: start(m.fire) }));

/** The spec a mission will light, on whichever map is loaded now. */
export function fireSpecOf(m) {
  return typeof m.fire === 'function' ? m.fire() : m.fire;
}

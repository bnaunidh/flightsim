/**
 * The missions.
 *
 *   1. Island Circuit  — take off, fly a lap of the coast, land.
 *   2. Mango Cay Delivery — carry supplies to the neighbouring island, drop
 *      them on the target, come home.
 *   3. Storm Approach — a crosswind landing in a thunderstorm.
 *   4. Dead Stick — the engine quits at 3,000 ft and you land it anyway.
 *   5. Ember Run — a timed lap of an erupting volcano, in the fighter.
 *   6. Night Medevac — a pickup on Mango Cay, at night, in rain.
 *   7. Storm Chaser — three passes through a tornado's outer bands.
 *
 * Four more sit behind the military passcode: a carrier qualification, an
 * interception patrol, a night recon run and a scored practice range. Three of
 * those four are flying problems rather than shooting ones, because that is
 * genuinely the harder thing a fast jet does; the fourth is a marked range
 * with an inert store and a score in metres, which is how air forces actually
 * train and makes it a precision exercise with a number at the end.
 *
 * The first three teach. The last four are the ones with teeth: each has a way
 * to lose that is not simply crashing — running out of height, running out of
 * time, landing short, or being pulled into the core — because a challenge you
 * can only fail by flying into the ground is not really a challenge.
 *
 * Nothing here uses floating checkpoint rings any more. Rings teach you to
 * chase rings: you stare at a glowing hoop and the island underneath becomes
 * wallpaper. Every navigation objective is now a real place — a headland, a
 * flank of the mountain, a leg of the circuit — with the HUD arrow pointing
 * the way, which is the same exercise with the world put back into it.
 *
 * Every instruction is written the way an instructor would say it to a child:
 * one action, plainly stated, with the number that matters.
 */

import * as THREE from '../vendor/three.module.js';
import { RUNWAY } from '../world/airport.js';
import { DELIVERY_PAD } from '../world/scenery.js';
import { heightAt, isOnRunway2 } from '../world/terrain.js';
import { UNITS } from '../aircraft/physics.js';
import { Pursuer } from './pursuer.js';

const ELEV = RUNWAY.elev;
const ft = (m) => m * UNITS.FT;

/** Start-of-runway spawn, ready to go. */
export const RUNWAY_START = {
  pos: new THREE.Vector3(-470, ELEV, 0),
  headingDeg: 90,
};

const airborneOverRunway = (dist = 6500, alt = 460) => ({
  pos: new THREE.Vector3(-dist, ELEV + alt, 40),
  headingDeg: 90,
  speed: 58,
  altAGL: alt,
});

/* ------------------------------------------------------------------ *
 * Military mission fixtures.
 * ------------------------------------------------------------------ */

/** The three patrol contacts, at three bearings and three ranges. */
const CONTACTS = [
  new THREE.Vector3(7200, ELEV + 900, -2400),
  new THREE.Vector3(-1800, ELEV + 700, 8200),
  new THREE.Vector3(-8600, ELEV + 800, -3000),
];

/** Four points to photograph, spread so the route has to be planned. */
const PHOTO_POINTS = [
  new THREE.Vector3(2400, 0, -1500),
  new THREE.Vector3(3100, 0, 2600),
  new THREE.Vector3(-2200, 0, 2100),
  new THREE.Vector3(-3100, 0, -3600),
];

/** The practice range bullseye, well clear of the town and the airfield. */
/*
 * Where the practice range is, read off the range that is actually drawn.
 *
 * This was a hard-coded (-6400, 0, -4200), which on the air base map is fifty
 * metres beyond the edge of the plain: the bullseye was open sea, and nothing
 * was drawn there in any case. The range is scenery now — see
 * addWeaponsRange() — and it publishes its middle, so the two cannot disagree.
 */
const RANGE_FALLBACK = new THREE.Vector3(-3800, 300, -3400);
function rangeTarget(ctx) {
  const drawn = ctx && ctx.sim && ctx.sim.scenery && ctx.sim.scenery.range;
  return (drawn ? drawn.pos : RANGE_FALLBACK).clone();
}

/**
 * Where the carrier is, read live rather than hard-coded.
 *
 * The ship registers itself as a landing platform when the world is built, so
 * asking the platform list is the one way to be sure the mission and the
 * actual steel agree. Hard-coding the position would silently drift the day
 * anyone moves the ship.
 */
function carrierTarget(ctx) {
  const c = ctx.sim.carrier;
  if (!c) return null;
  return new THREE.Vector3(c.pos.x, c.deckY || 24, c.pos.z);
}

/** True only when the wheels are on the deck, not on the sea or the island. */
function onCarrierDeck(ctx) {
  const c = ctx.sim.carrier;
  if (!c) return false;
  const p = ctx.ac.pos;
  return (
    Math.abs(p.x - c.pos.x) <= c.halfWidth &&
    Math.abs(p.z - c.pos.z) <= c.halfDepth &&
    Math.abs(p.y - (c.deckY || 24)) < 8
  );
}

function nearestOf(ctx, list, done) {
  let best = null;
  let bestD = Infinity;
  for (let i = 0; i < list.length; i++) {
    if (done.includes(i)) continue;
    const d = ctx.ac.pos.distanceTo(list[i]);
    if (d < bestD) {
      bestD = d;
      best = list[i];
    }
  }
  return best;
}

function nearestContact(ctx) {
  return nearestOf(ctx, CONTACTS, ctx.data.seen || []);
}

function nearestPhoto(ctx) {
  const p = nearestOf(ctx, PHOTO_POINTS, ctx.data.shot || []);
  // The photo points sit on the ground, so lift the arrow to a flyable height.
  return p ? new THREE.Vector3(p.x, heightAt(p.x, p.z) + 200, p.z) : null;
}

/**
 * Down, stopped, and on the runway you were sent to.
 *
 * The last term is new and it is the whole point of the function. This asked
 * only whether you had touched down without crashing and come to a stop, with
 * no position term at all — so eight missions that say "land on runway zero
 * nine", clear you to land and put an arrow on the touchdown zone completed
 * identically if you bellied it onto a beach a kilometre away. Dead Stick's
 * own comment says that is not the intention, and only guarded the case of
 * landing short.
 *
 * `onRunway` was there for the taking the whole time: gradeTouchdown works it
 * out on every touchdown and returns it, and the score already halves without
 * it. The check simply never looked.
 *
 * Landing somewhere else is still a perfectly good outcome — you saved the
 * aeroplane — so it is not a failure, it just is not this step. The message
 * says which, once, because a child who has stopped safely and seen nothing
 * happen has no way of knowing what the game is waiting for.
 */
function landedAndStopped(ctx) {
  const ac = ctx.ac;
  const t = ctx.data.lastTouchdown;
  const stopped = !!t && !t.crashed && ac.onGround && ac.groundSpeed < 2.5 && ac.groundTime > 1.2;
  if (!stopped) return false;
  /*
   * Either runway counts.
   *
   * `onRunway` on the grade is computed from the main strip alone, and the
   * crosswind runway is a real runway that these maps all have — landing on
   * it is the correct answer in a strong crosswind, which is precisely what
   * the Storm Approach mission is about. Refusing it would have replaced one
   * wrong answer with another.
   */
  if (t.onRunway || isOnRunway2(ac.pos.x, ac.pos.z, 8)) return true;
  if (!ctx.data.saidOffRunway) {
    ctx.data.saidOffRunway = true;
    ctx.sim.hud.notify('Safely down — but not on the runway. Take off and come round again.', 'warn', 6);
  }
  return false;
}

export const MISSIONS = [
  {
    id: 'circuit',
    name: 'Island Circuit',
    short: 'Island lap',
    difficulty: 'Easy',
    icon: '◎',
    blurb:
      'Take off from Kestrel Island, fly a full lap of the coast, then come back and land.',
    reward: 'Teaches turning, altitude control and the landing pattern.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 110 },
    spawn: RUNWAY_START,
    parTime: 300,
    steps: [
      {
        id: 'brief',
        text: 'Welcome aboard! Push the throttle up with Shift and roll down the runway.',
        hint: 'Hold Shift for full power. Space is the brakes if you need to stop.',
        atc: {
          text: 'Skylark one seven two, Kestrel Tower, runway zero nine, cleared for take-off, wind one one zero at six.',
          voice: 'tower',
        },
        targetLabel: 'Runway 09',
        target: () => RUNWAY.thresholdEast,
        check: (ctx) => ctx.ac.ias * UNITS.KTS > 35,
      },
      {
        id: 'rotate',
        text: 'At 55 knots, pull back gently with S to lift off.',
        hint: 'Watch the airspeed. When it passes 55, ease back on S.',
        // agl is in metres.
        check: (ctx) => ctx.ac.agl > 10 && ctx.ac.airborneTime > 1.5,
      },
      {
        id: 'climb',
        text: 'Climb to 1,500 feet and gently level off.',
        hint: 'Nose slightly up, full power, and let the altimeter wind up to 1,500.',
        atc: {
          text: 'Skylark one seven two, radar contact, climb and maintain one thousand five hundred feet.',
          voice: 'approach',
        },
        check: (ctx) => ft(ctx.ac.alt) > 1400,
      },
      {
        /*
         * A lap of the island, flown by looking at the island.
         *
         * This was five glowing rings. Rings teach you to chase rings: you
         * stare at a floating hoop and the world underneath becomes wallpaper.
         * Rounding a headland you can actually see, at a height you have to
         * hold, is the same navigation exercise with the scenery put back in.
         */
        id: 'lap',
        text: 'Now fly a lap of the island, keeping the coast on your right. Stay between 1,200 and 2,200 feet.',
        hint: 'Turn with A and D. Follow the shoreline round — the arrow shows you the next headland.',
        targetLabel: 'North point',
        target: () => new THREE.Vector3(2400, ELEV + 500, -1400),
        check: (ctx) => ctx.ac.pos.x > 1800 && ctx.ac.pos.z < -700,
      },
      {
        id: 'lap2',
        text: 'Round the north point. Carry on round the east side of the island.',
        hint: 'Keep turning right as the coast curves away. Hold your height.',
        targetLabel: 'East bay',
        target: () => new THREE.Vector3(2200, ELEV + 500, 1900),
        check: (ctx) => ctx.ac.pos.z > 1300 && ctx.ac.pos.x > 900,
      },
      {
        id: 'lap3',
        text: 'Round the south side now, back towards the airfield.',
        hint: 'The airfield is on the west of the island. Keep the coast on your right.',
        targetLabel: 'South shore',
        target: () => new THREE.Vector3(-1600, ELEV + 460, 1800),
        check: (ctx) => ctx.ac.pos.x < -1100 && ctx.ac.pos.z > 1100,
      },
      {
        id: 'downwind',
        text: 'Nicely flown! Now head back to the airfield and line up with runway 09 from the west.',
        hint: 'The runway numbers 09 mean you land heading east. Aim for the green threshold lights.',
        atc: {
          text: 'Skylark one seven two, cleared to land runway zero nine. Report on final.',
          voice: 'tower',
        },
        targetLabel: 'Runway 09 threshold',
        target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1600, 200, 0)),
        check: (ctx) =>
          ctx.ac.pos.x < RUNWAY.thresholdWest.x - 400 &&
          ctx.ac.pos.x > RUNWAY.thresholdWest.x - 3800 &&
          Math.abs(ctx.ac.pos.z) < 700 &&
          Math.abs(((ctx.ac.heading - 90 + 540) % 360) - 180) < 55,
      },
      {
        id: 'land',
        text: 'Reduce power, keep the two white and two red PAPI lights, and land on the runway.',
        hint: 'Pull the power back with Ctrl. Aim just past the white bars, then flare gently.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx, result) => {
      ctx.sim.speak('Skylark one seven two, nicely done. Taxi to the apron at your convenience.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const timeScore = Math.max(0, 1 - ctx.elapsed / 600);
      return Math.round((l ? l.score : 40) * 0.7 + timeScore * 30);
    },
  },

  {
    id: 'delivery',
    name: 'Mango Cay Delivery',
    short: 'Island delivery',
    difficulty: 'Medium',
    icon: '▣',
    blurb:
      'The village on Mango Cay needs medical supplies. Fly the crate 8 km north-east, drop it on the yellow target, then fly home and land.',
    reward: 'Teaches navigation, descending and flying accurately.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 11, windDirDeg: 140 },
    spawn: RUNWAY_START,
    parTime: 420,
    onStart: (ctx) => {
      ctx.sim.hasCargo = true;
      ctx.data.dropped = false;
    },
    steps: [
      {
        id: 'load',
        text: 'The supply crate is loaded. Take off from runway 09 and turn north-east toward Mango Cay.',
        hint: 'Full power with Shift, pull back at 55 knots, then turn left with A.',
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
        text: 'Fly to Mango Cay. Climb to about 2,000 feet on the way.',
        hint: 'Follow the arrow at the top of the screen. It always points to the island.',
        targetLabel: 'Mango Cay',
        target: () => DELIVERY_PAD,
        check: (ctx) => ctx.ac.pos.distanceTo(DELIVERY_PAD) < 1500,
      },
      {
        id: 'descend',
        text: 'Now come down low over the target — below 500 feet above the ground.',
        hint: 'Ease the power back with Ctrl and let the nose drop slightly.',
        atc: {
          text: 'Sea Bird, this is Mango Cay village. We can hear you. Drop when you are ready, over.',
          voice: 'village',
        },
        targetLabel: 'Drop target',
        target: () => DELIVERY_PAD,
        check: (ctx) =>
          ft(ctx.ac.agl) < 520 && ctx.ac.pos.distanceTo(DELIVERY_PAD) < 420,
      },
      {
        id: 'drop',
        text: 'Press X to release the crate right over the yellow target!',
        hint: 'Fly across the middle of the ring and press X. Slower is more accurate.',
        targetLabel: 'Drop target',
        target: () => DELIVERY_PAD,
        check: (ctx) => {
          const crate = ctx.sim.crate;
          if (!crate || !crate.landed) return false;
          const d = crate.group.position.distanceTo(DELIVERY_PAD);
          ctx.data.dropDistance = d;
          if (d > 90) {
            // Missed: give them another crate and another go.
            ctx.sim.notify('The crate missed the target — here is another one. Try again!', 'warn');
            ctx.sim.removeCrate();
            ctx.sim.hasCargo = true;
            return false;
          }
          ctx.sim.notify(`Crate delivered — ${Math.round(d)} m from the middle!`, 'good');
          return true;
        },
      },
      {
        id: 'home',
        text: 'Great drop! Now fly home to Kestrel Island and land on runway 09.',
        hint: 'Turn back to the south-west and follow the arrow home.',
        atc: {
          text: 'Sea Bird, supplies received, thank you! Safe flight home.',
          voice: 'village',
        },
        targetLabel: 'Kestrel Island',
        target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1800, 240, 0)),
        check: (ctx) =>
          ctx.ac.pos.x < RUNWAY.thresholdWest.x - 300 &&
          ctx.ac.pos.distanceTo(RUNWAY.touchdown) < 4200 &&
          Math.abs(((ctx.ac.heading - 90 + 540) % 360) - 180) < 60,
      },
      {
        id: 'land',
        text: 'Land on runway 09 and bring the aeroplane to a stop.',
        hint: 'Two white and two red on the PAPI means a perfect glide path.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        atc: { text: 'Skylark one seven two, cleared to land runway zero nine.', voice: 'tower' },
        check: landedAndStopped,
      },
    ],
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const acc = ctx.data.dropDistance != null ? Math.max(0, 1 - ctx.data.dropDistance / 90) : 0.4;
      return Math.round((l ? l.score : 40) * 0.5 + acc * 35 + Math.max(0, 1 - ctx.elapsed / 700) * 15);
    },
  },

  {
    id: 'storm',
    name: 'Storm Approach',
    short: 'Safe landing in bad weather',
    difficulty: 'Hard',
    icon: '⚡',
    blurb:
      'You are already airborne west of the island and a thunderstorm has rolled in. Strong wind is pushing you sideways. Fly a careful approach and land safely.',
    reward: 'Teaches crosswind landings and staying calm in rough air.',
    weather: { time: 'sunset', condition: 'stormy', windSpeedKts: 24, windDirDeg: 352 },
    spawn: airborneOverRunway(6800, 470),
    parTime: 260,
    steps: [
      {
        id: 'brief',
        text: 'The wind is pushing you from the left. Point the nose slightly left of the runway to stay lined up.',
        hint: 'Small, gentle inputs. Let the aeroplane settle between corrections.',
        atc: {
          text: 'Skylark one seven two, Kestrel Tower, wind three five zero at two four, gusting. Runway zero nine, cleared to land. Caution, wind shear reported on final.',
          voice: 'tower',
          urgency: 1,
        },
        targetLabel: 'Runway 09',
        target: () => RUNWAY.touchdown,
        check: (ctx) => ctx.ac.pos.distanceTo(RUNWAY.touchdown) < 4200,
      },
      {
        id: 'final',
        text: 'Follow the PAPI lights: two white and two red. Keep the wings level.',
        hint: 'All red means too low — add power. All white means too high — reduce power.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        check: (ctx) => ft(ctx.ac.agl) < 220 && ctx.ac.pos.x > RUNWAY.thresholdWest.x - 1400,
      },
      {
        id: 'land',
        text: 'Straighten the nose just before the wheels touch, and land!',
        hint: 'A firm landing is fine in this weather — just keep it on the runway.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak(
        'Skylark one seven two, that was a fine job in this weather. Welcome back to Kestrel.',
        'tower'
      );
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const base = l ? l.score : 30;
      return Math.round(base * 0.85 + 15);
    },
  },
  /* ------------------------------------------------------------------ *
   * 4. Dead Stick — the engine quits and you land it anyway.
   *
   * The purest challenge in flying and the one the game was missing: no
   * power, one attempt, and a runway you have exactly enough height to
   * reach if you do not waste any of it. There is no time limit because
   * gravity is the time limit.
   * ------------------------------------------------------------------ */
  {
    id: 'deadstick',
    name: 'Dead Stick',
    short: 'Engine-out landing',
    difficulty: 'Hard',
    icon: '⚠',
    blurb:
      'Your engine quits at 3,000 feet over the sea. You have one glide and one attempt at the runway. ' +
      'No power, no going around.',
    reward: 'Teaches gliding, energy management and committing to a decision.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 7, windDirDeg: 90 },
    /*
     * Where this starts is the whole difficulty, and it was wrong.
     *
     * Measured, the Skylark glides 7.9:1 with the propeller stopped. From 915 m
     * that is about 6,950 m of still-air range; the first spawn was 6,650 m
     * from the threshold, which left a 4% margin — any turn, any second held
     * at the wrong speed, and it was unwinnable. Nobody wants a puzzle whose
     * only solution is "fly perfectly from the first frame".
     *
     * 5,450 m out leaves about a quarter of the glide in hand: enough to lose
     * some of it and still make the runway, not enough to be casual about.
     */
    spawn: { pos: new THREE.Vector3(-6000, ELEV + 915, 500), headingDeg: 90, speed: 62, altAGL: 915 },
    parTime: 260,
    steps: [
      {
        id: 'quit',
        text: 'Your engine has just failed. Lower the nose and hold 65 knots — that is your best glide.',
        hint: 'Too slow and you fall out of the sky; too fast and you arrive low. 65 knots gets you furthest.',
        atc: { text: 'Mayday, mayday — Skylark one seven two, engine failure, gliding to runway zero nine.', voice: 'pilot' },
        targetLabel: 'Best glide, 65 kt',
        enter: (ctx) => {
          /*
           * The failure is the mission — but only in the air.
           *
           * "Back to the airfield" re-parks you on the runway and then
           * restarts the mission from step one, which ran this and killed the
           * engine while stationary. The step then wants 52 to 78 knots, the
           * starter refuses to turn while the failure is armed, the mission
           * has no time limit and its failIf cannot fire at that end of the
           * runway — so it sat there forever on "hold 65 knots" with no way
           * out but Restart. Arm it only when there is a flight to fail.
           */
          if (ctx.ac.onGround || ctx.ac.airborneTime < 1) return;
          if (!ctx.ac.failures.engine) ctx.sim.toggleFailure('engine');
        },
        /*
         * The check arms it, because the check is the only thing here that
         * runs every frame — the runner calls a mission-level tick, not a
         * per-step one. If the step began on the ground (which is exactly
         * what "Back to the airfield" does, since it re-parks you and
         * restarts the mission from the top) the failure waits until there is
         * air under the wheels. Otherwise the player would be handed a
         * dead-stick mission with a perfectly good engine.
         */
        check: (ctx) => {
          if (!ctx.ac.failures.engine && !ctx.ac.onGround && ctx.ac.airborneTime > 2) {
            ctx.sim.toggleFailure('engine');
          }
          return (
            ctx.ac.failures.engine
            && ctx.ac.ias * UNITS.KTS < 78
            && ctx.ac.ias * UNITS.KTS > 52
            && ctx.elapsed > 6
          );
        },
      },
      {
        id: 'glide',
        text: 'Now stretch it. Aim for the runway and do not turn any more than you have to.',
        hint: 'Every turn costs height. Straight is cheap — pick the runway and go.',
        targetLabel: 'Runway 09 threshold',
        target: () => RUNWAY.thresholdWest.clone(),
        check: (ctx) => ctx.ac.pos.x > RUNWAY.thresholdWest.x - 2600 && ft(ctx.ac.agl) < 900,
      },
      {
        id: 'touch',
        text: 'Land it. Flaps when the runway is made, and flare — you only get one of these.',
        hint: 'Do not put the flaps down early: they add drag and you may not reach.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    failIf: (ctx) => {
      // Landing anywhere but the airfield is a crash you walked away from —
      // but it is not the mission.
      if (ctx.ac.onGround && ctx.ac.pos.x < RUNWAY.thresholdWest.x - 60 && ctx.ac.groundSpeed < 6) {
        return 'You came down short of the runway';
      }
      return null;
    },
    onComplete: (ctx) => {
      ctx.sim.speak('Skylark one seven two, that was very nicely flown. Emergency services standing down.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      // Weighted almost entirely on the touchdown: with no engine, arriving
      // gently is the whole skill.
      return Math.round((l ? l.score : 20) * 0.9 + 10);
    },
  },

  /* ------------------------------------------------------------------ *
   * 5. Ember Run — the volcano, in the fast jet, against the clock.
   * ------------------------------------------------------------------ */
  {
    id: 'emberrun',
    name: 'Ember Run',
    short: 'Volcano time trial',
    difficulty: 'Hard',
    icon: '🌋',
    blurb:
      'A timed lap of Mount Ember in the fighter — four minutes. The mountain is erupting, the air ' +
      'over the cone is filthy, and the fighter does not turn tightly.',
    reward: 'Teaches precise, fast flying and how to read terrain.',
    map: 'ember',
    aircraft: 'vanguard',
    weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 18, windDirDeg: 200 },
    spawn: { pos: new THREE.Vector3(-5200, ELEV + 700, 300), headingDeg: 90, speed: 120, altAGL: 700 },
    timeLimit: 240,
    parTime: 190,
    steps: [
      {
        id: 'brief',
        text: 'One lap of the mountain. Four minutes. Go.',
        hint: 'The fighter is fast — you will need to think a long way ahead of it.',
        atc: { text: 'Vanguard zero one, the mountain is active. Clock is running.', voice: 'tower' },
        check: (ctx) => ctx.elapsed > 3,
      },
      {
        /*
         * A lap of the mountain, not a slalom through hoops. Four points you
         * fly round, each a real place on the terrain, against the clock.
         */
        id: 'lap',
        // North, east, south, west — which, with north up, is clockwise, and
        // puts the mountain on your right. The brief used to say the opposite
        // of the route it then made you fly.
        text: 'One lap of Mount Ember, clockwise, and land. Watch the ash over the summit.',
        hint: 'Stay wide of the crater — the ash will choke the engine. The arrow shows the next point.',
        targetLabel: 'North flank',
        target: () => new THREE.Vector3(2500, ELEV + 900, -4600),
        check: (ctx) => ctx.ac.pos.z < -3900 && ctx.ac.pos.x > 1200,
      },
      {
        id: 'lap2',
        text: 'Round the far side.',
        hint: 'Keep the mountain on your right and do not cut across the top of it.',
        targetLabel: 'East flank',
        target: () => new THREE.Vector3(4700, ELEV + 1000, -2300),
        check: (ctx) => ctx.ac.pos.x > 4000 && ctx.ac.pos.z > -3400,
      },
      {
        id: 'lap3',
        text: 'South side. Keep it moving.',
        hint: 'The clock is still running.',
        targetLabel: 'South flank',
        target: () => new THREE.Vector3(3000, ELEV + 800, 400),
        check: (ctx) => ctx.ac.pos.z > -300 && ctx.ac.pos.x > 1800,
      },
      {
        id: 'lap4',
        text: 'Round the west and back towards the field.',
        hint: 'Almost there — start losing height for the landing.',
        targetLabel: 'West flank',
        target: () => new THREE.Vector3(-600, ELEV + 620, -800),
        check: (ctx) => ctx.ac.pos.x < 200,
      },
      {
        id: 'land',
        text: 'Lap complete. Now bring it home and land it — the clock is still running.',
        hint: 'The fighter lands fast and flat. Get the speed off early.',
        targetLabel: 'Runway 09',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak('Vanguard zero one, lap complete, time stopped. Good run.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const speed = Math.max(0, 1 - ctx.elapsed / 240);
      return Math.round(speed * 62 + (l ? l.score : 30) * 0.38);
    },
  },

  /* ------------------------------------------------------------------ *
   * 6. Night Medevac — the hardest kind of ordinary flying.
   * ------------------------------------------------------------------ */
  {
    id: 'medevac',
    name: 'Night Medevac',
    short: 'Night pickup in fog',
    difficulty: 'Hard',
    icon: '✚',
    blurb:
      'Someone is hurt on Mango Cay and the fog has come in after dark. Fly out, get down on the pad, ' +
      'and bring them back to the airfield.',
    reward: 'Teaches instrument flying, night approaches and staying calm in bad visibility.',
    weather: { time: 'night', condition: 'rainy', windSpeedKts: 11, windDirDeg: 130 },
    spawn: RUNWAY_START,
    timeLimit: 720,
    parTime: 480,
    steps: [
      {
        id: 'go',
        text: 'Take off and head for Mango Cay. It is dark, so fly the instruments, not the window.',
        hint: 'The attitude indicator is your horizon now. Keep the wings level on it.',
        atc: { text: 'Skylark one seven two, medical flight, cleared for immediate departure runway zero nine.', voice: 'tower' },
        check: (ctx) => ctx.ac.airborneTime > 4 && ft(ctx.ac.agl) > 250,
      },
      {
        id: 'out',
        text: 'Fly out to the cay. Keep at least 800 feet — there is high ground you cannot see.',
        hint: 'Trust the altimeter. If it says 800 you are at 800, whatever the dark looks like.',
        targetLabel: 'Mango Cay',
        target: () => DELIVERY_PAD.clone(),
        check: (ctx) => ctx.ac.pos.distanceTo(DELIVERY_PAD) < 900,
      },
      {
        id: 'pickup',
        text: 'Get down on the pad. Slowly — you cannot see much and there is nowhere else to go.',
        hint: 'Full flaps, low power, and let it settle. Below 300 feet per minute.',
        targetLabel: 'Landing pad',
        target: () => DELIVERY_PAD.clone(),
        check: (ctx) =>
          ctx.ac.onGround &&
          ctx.ac.groundSpeed < 3 &&
          ctx.ac.pos.distanceTo(DELIVERY_PAD) < 260 &&
          !!ctx.data.lastTouchdown &&
          !ctx.data.lastTouchdown.crashed,
      },
      {
        id: 'back',
        text: 'They are aboard. Take them home — smoothly, their pulse is on your panel.',
        hint: 'Gentle turns. Nothing steeper than 20 degrees of bank, and no sharp pull-ups.',
        enter: (ctx) => {
          ctx.data.aboard = true;
          ctx.sim.hud.notify('Patient aboard — watch their heart rate', 'info', 5);
        },
        atc: { text: 'Skylark one seven two, patient aboard, returning to the field.', voice: 'pilot' },
        /*
         * Line up over the island, not out at sea.
         *
         * This used to aim 1,500 m past the western threshold and accept you
         * anywhere from 850 m to 4,200 m west of it, with no requirement to be
         * pointing at the runway at all. The seabed starts at 2,550 m west — so
         * the arrow led you across the field and out towards the coast, and
         * the box you had to reach extended two kilometres over open water. In
         * daylight you would see that. This is the mission that happens at
         * night, in rain, with the sea black and the horizon gone, which is
         * exactly when you would follow an arrow down into it.
         *
         * Now the fix sits over land, and you have to arrive pointing at the
         * runway — which is what "line up" means.
         */
        targetLabel: 'Final approach',
        target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1200, 200, 0)),
        check: (ctx) =>
          ctx.ac.pos.x < RUNWAY.thresholdWest.x - 250 &&
          ctx.ac.pos.distanceTo(RUNWAY.touchdown) < 3600 &&
          Math.abs(ctx.ac.pos.z) < 900 &&
          Math.abs(((ctx.ac.heading - 90 + 540) % 360) - 180) < 55,
      },
      {
        id: 'land',
        text: 'Land. Gently — this is the bit that matters.',
        hint: 'Aim for less than 200 feet per minute at touchdown.',
        targetLabel: 'Touchdown zone',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    /*
     * The patient's heart rate — the reason to fly smoothly.
     *
     * "Gentle turns, they are hurt" is just a sentence until something is
     * actually listening. Once they are aboard, a monitor watches how you fly:
     * every g you pull away from level, every degree of bank past a comfortable
     * one, and every hard landing pushes the pulse up. Fly it smoothly and it
     * settles back down towards a resting rate.
     *
     * It is not a fail state at ordinary levels, because a mission you lose to
     * a slider you did not know about is just unfair. It costs you the score,
     * and only sustained, genuinely violent handling loses the patient.
     */
    tick: (ctx, dt) => {
      const d = ctx.data;
      if (!d.aboard) return;
      const ac = ctx.ac;
      const r = ac.readouts();
      if (d.bpm === undefined) {
        d.bpm = 96; // hurt, frightened, but stable
        d.peakBpm = 96;
        d.criticalFor = 0;
      }
      /*
       * What the patient feels: g away from 1, bank, and being thrown about.
       *
       * The first numbers here were far too timid — violently throwing the
       * aeroplane around for twenty seconds moved the pulse from 92 to 98,
       * which is not a mechanic, it is a decoration. These are scaled so that
       * ordinary gentle handling sits near a resting 92, a brisk but sensible
       * arrival reaches the 120s, and genuinely rough flying climbs past 165
       * where the alarm starts.
       */
      const gStress = Math.abs((r.gLoad || 1) - 1) * 55;
      const bankStress = Math.max(0, Math.abs(r.bank) - 15) * 0.9;
      const rateStress = Math.abs(ac.omega.x) * 14 + Math.abs(ac.omega.z) * 10;
      const stress = gStress + bankStress + rateStress;
      // Rises with what you are doing, falls back when you stop doing it.
      d.bpm += (stress - (d.bpm - 92) * 0.42) * dt;
      d.bpm = Math.max(88, Math.min(210, d.bpm));
      d.peakBpm = Math.max(d.peakBpm, d.bpm);
      /*
       * Thresholds pitched at what is actually reachable.
       *
       * These began at 165 and 185, which measurement showed you cannot get
       * near in simplified mode: the assist will not let you fly roughly
       * enough, so violent handling peaked at 121 and the warning colours
       * could never appear at all. Measured on the trainer — resting 92, a
       * brisk 30-degree turn 109, deliberately rough flying 121 — so amber at
       * 118 and red at 142 are states you can actually provoke and then fix.
       */
      d.criticalFor = d.bpm > 155 ? d.criticalFor + dt : Math.max(0, d.criticalFor - dt * 0.5);
      ctx.sim.hud.setVital(Math.round(d.bpm), d.bpm > 142 ? 'bad' : d.bpm > 118 ? 'warn' : 'ok');
    },
    failIf: (ctx) => {
      if (ctx.data.criticalFor > 22) return 'The patient did not survive the flight';
      return null;
    },
    onComplete: (ctx) => {
      ctx.sim.hud.setVital(null);
      const bpm = Math.round(ctx.data.bpm || 96);
      ctx.sim.speak(
        bpm < 130
          ? 'Skylark one seven two, ambulance is on the apron. Thank you — that was good flying.'
          : 'Skylark one seven two, ambulance is on the apron. They are stable. You gave them a rough ride.',
        'tower'
      );
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      // A smooth arrival matters more here than a fast one, and how the
      // patient arrived matters most of all.
      const gentle = l ? Math.max(0, 1 - Math.abs(l.vsFpm) / 600) : 0.3;
      const calm = Math.max(0, 1 - ((ctx.data.peakBpm || 96) - 96) / 55);
      return Math.round((l ? l.score : 30) * 0.4 + gentle * 25 + calm * 35);
    },
  },

  /* ------------------------------------------------------------------ *
   * 7. Storm Chaser — get close to a tornado without being eaten by it.
   * ------------------------------------------------------------------ */
  {
    id: 'chaser',
    name: 'Storm Chaser',
    short: 'Tornado research',
    difficulty: 'Very hard',
    icon: '🌪',
    blurb:
      'A tornado is on the ground and the science people want readings from close to it. Fly three passes ' +
      'through the outer bands — close enough to matter, far enough to live.',
    reward: 'Teaches flying an aeroplane that is not going where you point it.',
    weather: { time: 'day', condition: 'stormy', windSpeedKts: 26, windDirDeg: 240 },
    spawn: { pos: new THREE.Vector3(-4200, ELEV + 520, 600), headingDeg: 90, speed: 70, altAGL: 520 },
    timeLimit: 420,
    parTime: 320,
    steps: [
      {
        id: 'find',
        text: 'There is a tornado on the ground ahead. Find it — the marker on the HUD points the way.',
        hint: 'It is rated on the Enhanced Fujita scale. Whatever it says, treat it with respect.',
        atc: { text: 'Skylark one seven two, tornado is on the ground, confirmed. Readings when able.', voice: 'tower' },
        enter: (ctx) => {
          // A middling one: dangerous, survivable, and it will not sit still.
          ctx.sim.tornadoEF = 2;
          ctx.sim.triggerNatural('tornado');
        },
        check: (ctx) => ctx.sim.tornado.active && ctx.sim.tornado.proximity(ctx.ac.pos) > 0.25,
      },
      {
        id: 'passes',
        text: 'Three passes through the outer band. Get close — but stay out of the core.',
        hint: 'The wind will try to turn you into it. Lead your turns and never let it get behind you.',
        targetLabel: 'Tornado',
        target: (ctx) => (ctx.sim.tornado.active ? ctx.sim.tornado.pos.clone().setY(ELEV + 400) : null),
        enter: (ctx) => {
          ctx.data.passes = 0;
          ctx.data.inBand = false;
        },
        check: (ctx) => {
          const t = ctx.sim.tornado;
          /*
           * A tornado lives 150 seconds and this mission runs for 420, so it
           * used to dissipate with a pass or two still to go and leave you
           * orbiting empty sky until the clock ran out — no tornado, no
           * marker, no explanation, and nothing you could do about it.
           *
           * Real ones do die, and another drops out of the same storm. So
           * when this one goes, a new one forms.
           */
          if (!t.active) {
            if (!ctx.data.reformAt) {
              ctx.data.reformAt = ctx.elapsed + 12;
              ctx.sim.hud.notify('That one has lifted — the storm is still there. Stand by.', 'warn', 5);
            } else if (ctx.elapsed >= ctx.data.reformAt) {
              ctx.data.reformAt = 0;
              ctx.sim.tornadoEF = 2;
              ctx.sim.triggerNatural('tornado');
              ctx.sim.hud.notify('Another one is on the ground. Go again.', 'warn', 5);
            }
            return false;
          }
          ctx.data.reformAt = 0;
          const near = t.proximity(ctx.ac.pos);
          // A pass is entering the band and coming out the other side alive.
          if (!ctx.data.inBand && near > 0.55) ctx.data.inBand = true;
          else if (ctx.data.inBand && near < 0.3) {
            ctx.data.inBand = false;
            ctx.data.passes = (ctx.data.passes || 0) + 1;
            ctx.sim.hud.notify(`Reading ${ctx.data.passes} of 3 recorded`, 'good', 3);
          }
          return (ctx.data.passes || 0) >= 3;
        },
      },
      {
        id: 'home',
        text: 'That is all three. Get away from it and land — the weather is not improving.',
        hint: 'Put it behind you and do not look back.',
        targetLabel: 'Runway 09',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    failIf: (ctx) => {
      // Going into the core is not bravery, it is the end of the aeroplane —
      // unless you brought the one built for it, in which case it is the
      // entire point of having brought it.
      if (ctx.sim.aircraftType && ctx.sim.aircraftType.stormProof) return null;
      if (ctx.sim.tornado.active && ctx.sim.tornado.bite(ctx.ac.pos) > 0.75) {
        return 'You flew into the core';
      }
      return null;
    },
    onComplete: (ctx) => {
      ctx.sim.speak('Skylark one seven two, readings received. Nobody expected you to get all three.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      return Math.round(50 + (l ? l.score : 20) * 0.5);
    },
  },

  /* ==================================================================== *
   * Military missions. Hidden until the passcode is entered.
   *
   * Three of these are flying problems rather than shooting ones — a carrier
   * qualification, an interception patrol and a low-level night recon — because
   * they are genuinely the harder and more interesting things a fast jet does,
   * and because the game already owns the carrier, the hook and the Nightjar.
   *
   * The fourth is a weapons range. It is a practice range with scored targets,
   * which is how air forces actually train: inert stores, a marked bullseye,
   * and a score in metres. That makes it a precision flying exercise with a
   * number at the end rather than an abstract act of violence, and it reuses
   * the cargo-release mechanic the delivery mission already has.
   * ==================================================================== */
  {
    id: 'carrierqual',
    name: 'Carrier Qualification',
    short: 'Deck landing',
    difficulty: 'Very hard',
    icon: '⚓',
    military: true,
    // Pinned, so it cannot inherit whichever map the last mission left behind.
    map: 'kestrel',
    blurb:
      'Fly out to the Resolute and put it down on a kilometre and a half of moving steel — inside a '
      + 'band of deck 360 m long, where the wires are. The reason the Osprey has a hook.',
    reward: 'Teaches precision approaches with no margin at all.',
    aircraft: 'osprey',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 90 },
    spawn: RUNWAY_START,
    parTime: 420,
    steps: [
      {
        id: 'depart',
        text: 'Take off and head out to the carrier. Follow the marker.',
        hint: 'The Osprey lands slowly on purpose — that is what makes the deck possible.',
        atc: { text: 'Osprey two one, Resolute has you on radar, deck is green.', voice: 'tower' },
        targetLabel: 'CV-11 Resolute',
        target: (ctx) => carrierTarget(ctx),
        check: (ctx) => {
          const c = carrierTarget(ctx);
          return !!c && ctx.ac.pos.distanceTo(c) < 2200 && ctx.ac.airborneTime > 6;
        },
      },
      {
        id: 'pattern',
        text: 'Fly down the port side, then turn back onto the deck. Gear and full flap.',
        hint: 'Come in slow and low. Aim a third of the way up the deck, where the wires are.',
        targetLabel: 'The deck',
        target: (ctx) => carrierTarget(ctx),
        check: (ctx) => {
          const c = carrierTarget(ctx);
          return !!c && ctx.ac.pos.distanceTo(c) < 900 && ft(ctx.ac.agl) < 900;
        },
      },
      {
        id: 'trap',
        text: 'Put it on the deck.',
        hint: 'No flare. A carrier landing is a controlled arrival, not a gentle one.',
        targetLabel: 'The deck',
        target: (ctx) => carrierTarget(ctx),
        check: (ctx) => onCarrierDeck(ctx) && ctx.ac.onGround && ctx.ac.groundSpeed < 4,
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak('Osprey two one, that is a trap. Welcome aboard.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      return Math.round(55 + (l ? l.score : 20) * 0.45);
    },
  },

  {
    id: 'patrol',
    name: 'Island Patrol',
    short: 'Protect the island',
    difficulty: 'Hard',
    icon: '🛡',
    military: true,
    // Military missions fly from the military field, not the tropical one.
    map: 'airbase',
    blurb:
      'Three unidentified contacts are approaching Ironhead from three directions. Get to each of them '
      + 'inside ten minutes. The Nightjar has the legs for it — you have to plan the order.',
    reward: 'Teaches route planning and flying a fast jet with your head up.',
    aircraft: 'nightjar',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 240 },
    spawn: { pos: new THREE.Vector3(-3000, ELEV + 600, 0), headingDeg: 90, speed: 150, altAGL: 600 },
    /*
     * Ten minutes, not six.
     *
     * Three contacts spread right across the map with long legs between them:
     * six meant flying it perfectly, in the right order, first time, with no
     * room to look at anything. It is a route-planning exercise, and you
     * cannot plan a route you have not been given time to fly.
     */
    timeLimit: 600,
    parTime: 280,
    onStart: (ctx) => {
      ctx.data.seen = [];
    },
    steps: [
      {
        id: 'brief',
        text: 'Three contacts, three bearings, ten minutes. Reach all three.',
        hint: 'They are not all the same distance away. Think about the order before you turn.',
        atc: { text: 'Nightjar zero two, three contacts inbound, intercept and identify.', voice: 'tower' },
        check: (ctx) => ctx.elapsed > 3,
      },
      {
        id: 'intercept',
        text: 'Reach all three contacts. The arrow points at the nearest one you have not identified.',
        hint: 'Flying past at speed counts — you do not have to slow down.',
        targetLabel: 'Nearest contact',
        target: (ctx) => nearestContact(ctx),
        check: (ctx) => {
          const seen = ctx.data.seen || [];
          for (let i = 0; i < CONTACTS.length; i++) {
            if (seen.includes(i)) continue;
            if (ctx.ac.pos.distanceTo(CONTACTS[i]) < 700) {
              seen.push(i);
              ctx.data.seen = seen;
              ctx.sim.hud.notify(`Contact ${seen.length} of 3 identified`, 'good', 3);
            }
          }
          return seen.length >= 3;
        },
      },
      {
        id: 'rtb',
        text: 'All three identified. Return to the field and land.',
        hint: 'The Nightjar lands fast and flat. Start slowing down early.',
        targetLabel: 'Runway 09',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak('Nightjar zero two, all three identified. Nicely planned.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      const speed = Math.max(0, 1 - ctx.elapsed / 360);
      return Math.round(speed * 55 + (l ? l.score : 25) * 0.45);
    },
  },

  {
    id: 'recon',
    name: 'Low-Level Recon',
    short: 'Night photo run',
    difficulty: 'Very hard',
    icon: '📷',
    military: true,
    // Military missions fly from the military field, not the tropical one.
    map: 'airbase',
    blurb:
      'Four points to overfly below 500 feet, at night, in the flying wing. The aeroplane with no tail, '
      + 'in the dark, close to the ground. Hold it steady.',
    reward: 'Teaches low-level flying and trusting the instruments.',
    aircraft: 'nightjar',
    weather: { time: 'night', condition: 'clear', windSpeedKts: 9, windDirDeg: 120 },
    spawn: { pos: new THREE.Vector3(-4200, ELEV + 400, 600), headingDeg: 90, speed: 140, altAGL: 400 },
    timeLimit: 480,
    parTime: 360,
    onStart: (ctx) => {
      ctx.data.shot = [];
    },
    steps: [
      {
        id: 'brief',
        text: 'Four photo points. Below 500 feet over each one, or it does not count.',
        hint: 'It is dark. Fly the altimeter, not the window.',
        atc: { text: 'Nightjar zero two, you are cleared low level. Nothing below you is lit.', voice: 'tower' },
        check: (ctx) => ctx.elapsed > 3,
      },
      {
        id: 'shoot',
        text: 'Overfly each point below 500 feet.',
        hint: 'Get low BEFORE you arrive. Diving at the point in the dark is how this goes wrong.',
        targetLabel: 'Next photo point',
        target: (ctx) => nearestPhoto(ctx),
        check: (ctx) => {
          const shot = ctx.data.shot || [];
          for (let i = 0; i < PHOTO_POINTS.length; i++) {
            if (shot.includes(i)) continue;
            const p = PHOTO_POINTS[i];
            const flat = Math.hypot(ctx.ac.pos.x - p.x, ctx.ac.pos.z - p.z);
            if (flat < 420 && ft(ctx.ac.agl) < 500) {
              shot.push(i);
              ctx.data.shot = shot;
              ctx.sim.hud.notify(`Point ${shot.length} of 4 photographed`, 'good', 3);
            }
          }
          return shot.length >= 4;
        },
      },
      {
        id: 'home',
        text: 'That is all four. Bring it home.',
        hint: 'Climb away from the ground first, then worry about the runway.',
        targetLabel: 'Runway 09',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak('Nightjar zero two, all four points. That was flown properly.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      return Math.round(50 + (l ? l.score : 20) * 0.5);
    },
  },

  {
    id: 'range',
    name: 'Weapons Range',
    short: 'Scored practice drop',
    difficulty: 'Hard',
    icon: '◎',
    military: true,
    // Military missions fly from the military field, not the tropical one.
    map: 'airbase',
    blurb:
      'A marked practice range with a bullseye. Carry an inert practice store out to it, release on the '
      + 'target, and you are scored in metres from the middle. Accuracy, not force.',
    reward: 'Teaches release timing, wind allowance and flying an exact line.',
    aircraft: 'nightjar',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 12, windDirDeg: 200 },
    spawn: RUNWAY_START,
    parTime: 400,
    onStart: (ctx) => {
      ctx.sim.hasCargo = true;
      ctx.data.dropped = false;
    },
    steps: [
      {
        id: 'go',
        text: 'One inert practice store aboard. Take off and head for the range.',
        hint: 'It is an inert practice store — it marks where it lands and nothing else.',
        atc: { text: 'Nightjar zero two, range is cold and clear, you are cleared in.', voice: 'tower' },
        targetLabel: 'The range',
        target: (ctx) => rangeTarget(ctx),
        check: (ctx) => ctx.ac.airborneTime > 4 && ft(ctx.ac.agl) > 200,
      },
      {
        id: 'run',
        text: 'Run in on the target below 1,500 feet and line it up.',
        hint: 'Steady wings well before you get there. A last-second correction throws the release off.',
        targetLabel: 'Bullseye',
        target: (ctx) => rangeTarget(ctx),
        check: (ctx) =>
          ctx.ac.pos.distanceTo(rangeTarget(ctx)) < 900 && ft(ctx.ac.agl) < 1500,
      },
      {
        id: 'release',
        text: 'Press X to release. It keeps your speed, so let go BEFORE the bullseye.',
        hint: 'It falls forward as well as down — release before you are on top of it.',
        targetLabel: 'Bullseye',
        target: (ctx) => rangeTarget(ctx),
        check: (ctx) => {
          const crate = ctx.sim.crate;
          if (!crate || !crate.landed) return false;
          if (ctx.data.miss === undefined) {
            const bull = rangeTarget(ctx);
            ctx.data.miss = Math.hypot(
              crate.mesh.position.x - bull.x,
              crate.mesh.position.z - bull.z
            );
            ctx.sim.hud.notify(
              ctx.data.miss < 40
                ? `Direct hit — ${Math.round(ctx.data.miss)} m`
                : `${Math.round(ctx.data.miss)} m from the middle`,
              ctx.data.miss < 120 ? 'good' : 'warn',
              5
            );
          }
          return true;
        },
      },
      {
        id: 'rtb',
        text: 'Scored. Head home and land.',
        hint: 'Nothing left to carry — it will feel lighter.',
        targetLabel: 'Runway 09',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx) => {
      const m = Math.round(ctx.data.miss ?? 999);
      ctx.sim.speak(
        m < 40 ? 'Nightjar zero two, shack. That is a direct hit.' : `Nightjar zero two, scored at ${m} metres.`,
        'tower'
      );
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      // Accuracy is most of it: dead centre is worth far more than a tidy landing.
      const acc = Math.max(0, 1 - (ctx.data.miss ?? 400) / 300);
      return Math.round(acc * 62 + (l ? l.score : 20) * 0.38);
    },
  },

  /*
   * Shake the Tail.
   *
   * The first mission in the game with another aeroplane in it. Somebody is
   * on your tail and will not go away, and the answer is not to outrun him —
   * measured, he is 8.5% faster than you and out-turns you at every bank you
   * can hold. The answer is the weather. Get into the cloud and stay ahead of
   * him and he loses you.
   *
   * Deliberately NOT military and NOT behind the passcode: it is the most fun
   * thing in the game to a ten-year-old and gating it behind a code most of
   * them do not have would be perverse.
   *
   * If he does catch you he formates on your wing and escorts you home.
   * Nobody is shot down. That is the tone the whole thing is written in.
   */
  {
    id: 'tail',
    name: 'Shake the Tail',
    short: 'Lose the jet behind you',
    difficulty: 'Medium',
    icon: '\u{1F6A8}',
    map: 'kestrel',
    aircraft: 'vanguard',
    blurb:
      'A bomber and two fighters are on your tail and all three are faster than you are. You will '
      + 'not outrun them and you cannot out-turn them. What you can do is climb into the cloud and disappear.',
    reward: 'Teaches you that the weather is a place you can hide, and how to fly on instruments once you are in it.',
    /*
     * Cloudy, not rainy, and lower.
     *
     * Rain was chosen because it gives the thickest cloud to hide in — and it
     * also meant you could not see the three aeroplanes chasing you from a
     * kilometre away, which is most of the mission. Photographed: grey murk
     * and nothing in it. Cloudy has a higher, thinner deck with less than half
     * the fog, so you start in clear air with them plainly behind you and the
     * cloud is something you climb up into.
     */
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 10, windDirDeg: 250 },
    spawn: { pos: new THREE.Vector3(-3400, ELEV + 430, 2600), headingDeg: 300, speed: 150, altAGL: 430 },
    // No time limit on purpose. A clock AND a pursuer means losing to
    // whichever one you were not watching.
    parTime: 200,
    onStart: (ctx) => {
      ctx.data.escaped = false;
      ctx.data.caught = false;
      ctx.data.warned = false;
      ctx.data.bankHeld = 0;
      ctx.data.escortT = 0;
      ctx.data.locked = false;
      // Being shot has to be visible even with the Dev-mode damage switch off —
      // the panel only appears once something is wrong, so this costs nothing
      // to anyone who never gets hit.
      ctx.sim.hud.setDamage(ctx.ac.damage);
      ctx.sim.spawnPursuer();
      /*
       * A cloudy deck tops out at about 0.51 immersion against rain's 0.88, so
       * the threshold for losing them comes down to match. Without this the
       * cloud simply never counts as cloud and the mission cannot be won.
       */
      for (const j of ctx.sim.pursuers || []) j.cloudHides = 0.38;
    },
    /*
     * Everything that moves lives here. `tick` runs every frame while the
     * mission is running, before the fail checks, so what is written here is
     * visible to failIf and to the step checks on the same frame.
     */
    tick: (ctx, dt) => {
      const flight = ctx.sim.pursuers || [];
      if (!flight.length) return;
      for (const j of flight) j.update(dt, ctx.ac, ctx.sim);
      // The nearest one is the one that matters for being seen and caught.
      const p = flight.reduce((a, b) => (b.rangeTo < a.rangeTo ? b : a), flight[0]);
      if (!p || !p.alive) return;

      /*
       * He shoots.
       *
       * Warning bursts, from behind and close in, and most of them miss. What
       * lands damages the part that was actually facing him — from dead astern
       * that is the tail, from off to one side it is that wing — and you feel
       * it immediately, because a hurt wing rolls you towards it.
       *
       * The aeroplane is never destroyed by this. The worst it does is make
       * flying hard enough that he catches you, and being caught is an escort
       * home.
       */
      // Any of the three can be the one that gets a shot off.
      let shot = null;
      let anyLocking = false;
      for (const j of flight) {
        const s = j.tryShot(ctx.ac, dt);
        if (j.locking) anyLocking = true;
        if (s && !shot) shot = s;
      }
      if (shot) {
        ctx.ac.takeHit(shot.part, shot.severity, 'Hit by Ironhead One');
        ctx.sim.rig.kick(1.1);
      }
      /*
       * Tell them it is coming.
       *
       * One of them holding you in his sights for a second and a half is the
       * only thing that produces a burst, and that second and a half exists
       * so you can do something about it. It is no use as a warning nobody
       * can see, so it is said out loud — and it clears itself the moment
       * somebody pulls hard enough to spoil his aim, which teaches the answer
       * better than any hint would.
       */
      if (anyLocking && !ctx.data.locked) {
        ctx.data.locked = true;
        ctx.sim.hud.showBanner('One of them is lining up', 'Break — pull hard, either way.', 'bad', 2.2);
        ctx.sim.audio.available && ctx.sim.audio.alerts.caution && ctx.sim.audio.alerts.caution();
      } else if (!anyLocking && ctx.data.locked) {
        ctx.data.locked = false;
      }

      // Break hard inside knife range and he goes past. He out-turns you, so
      // without this there is no answer to him at all except the cloud.
      const banked = Math.abs(ctx.ac.bankAngleDeg()) > 45;
      ctx.data.bankHeld = banked ? ctx.data.bankHeld + dt : 0;
      if (ctx.data.bankHeld > 1 && p.rangeTo < 1500 && p.tryOvershoot()) {
        for (const j of flight) if (j !== p) j.tryOvershoot();
        ctx.sim.hud.notify('He has overshot — go the other way, now', 'good', 3.5);
        ctx.sim.audio.available && ctx.sim.audio.alerts.checkpoint && ctx.sim.audio.alerts.checkpoint();
      }

      // Two graces before he takes you, because being caught with no warning
      // is the thing that makes a ten-year-old put the iPad down.
      if (p.closeT > 5 && !ctx.data.warned) {
        ctx.data.warned = true;
        ctx.sim.hud.showBanner('He is about to take you', 'Climb. Break. Anything.', 'bad', 4);
      }
      if (p.closeT <= 0 && ctx.data.warned) ctx.data.warned = false;
      /*
       * Twelve seconds inside knife range, not seven.
       *
       * They arrive at 240 m and close to under 140 in a few seconds, so the
       * old seven was very nearly a fixed timer from the start of the mission:
       * caught in twenty seconds whatever you flew. He overshoots at five now,
       * so twelve is roughly two full passes — enough that getting caught is
       * something you did rather than something that happened.
       */
      if (p.closeT > 12) ctx.data.caught = true;

      if (p.breakT >= 15) ctx.data.escaped = true;
    },
    failIf: (ctx) => {
      if (!ctx.data.caught) return null;
      const p = ctx.sim.pursuer;
      if (p && !p.escorting) {
        p.beginEscort();
        ctx.sim.speak('Ironhead One has you. Formate on my left wing and follow me home.', 'tower');
      }
      return 'Ironhead One formed up on your wing and escorted you home. Nobody is in trouble — go again.';
    },
    steps: [
      {
        id: 'spotted',
        text: 'Three of them, right behind you. Look back.',
        hint: 'Press C to change view. They are already inside a kilometre.',
        atc: {
          text: 'Vanguard zero one, three contacts astern and closing. They are faster than you. Use the weather.',
          voice: 'tower',
        },
        check: (ctx) => ctx.elapsed > 5,
      },
      {
        id: 'climb',
        text: 'Climb into the cloud — about 4,200 feet.',
        hint: 'The deck starts around 3,400 feet. Get into it, then EASE OFF — a hard climb throws you straight out of the top.',
        targetLabel: 'The cloud',
        target: (ctx) => {
          const a = ctx.ac.pos;
          return new THREE.Vector3(a.x, 1280, a.z);
        },
        check: (ctx) => (ctx.sim.cloudImmersion || 0) > 0.38,
      },
      {
        id: 'lose',
        text: 'You are in it. Now stay in it, and keep him more than 900 metres behind you.',
        hint: 'Fly the attitude, not the window. Wings level, nose on the horizon, and keep the power up.',
        targetLabel: 'Keep going',
        target: (ctx) => {
          const a = ctx.ac.pos;
          const f = new THREE.Vector3(0, 0, -1).applyQuaternion(ctx.ac.quat).setY(0).normalize();
          return a.clone().addScaledVector(f, 3000);
        },
        check: (ctx) => ctx.data.escaped,
      },
      {
        id: 'home',
        text: 'He has lost you. Get back on the ground at Kestrel.',
        hint: 'Come down out of the cloud before you look for the runway.',
        atc: { text: 'Vanguard zero one, contact lost on him. Cleared straight in.', voice: 'tower' },
        targetLabel: 'Runway 09',
        target: () => RUNWAY.touchdown,
        check: landedAndStopped,
      },
    ],
    onComplete: (ctx) => {
      ctx.sim.speak('Vanguard zero one, nicely flown. He never saw where you went.', 'tower');
    },
    score: (ctx) => {
      const l = ctx.data.lastTouchdown;
      // Most of it is getting away at all; the landing still counts.
      const quick = Math.max(0, 1 - Math.max(0, ctx.runner.elapsed - 140) / 220);
      return Math.round(quick * 58 + (l ? l.score : 20) * 0.42);
    },
  },
];

export function findMission(id) {
  return MISSIONS.find((m) => m.id === id) || null;
}

/** Free flight is a mission with no steps — just the sky and the island. */
export const FREE_FLIGHT = {
  id: 'free',
  name: 'Free Flight',
  steps: [],
  failOnCrash: false,
};

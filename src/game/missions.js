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
import { heightAt } from '../world/terrain.js';
import { UNITS } from '../aircraft/physics.js';

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
      'The village on Mango Cay needs medical supplies. Fly the crate 8 km south-east, drop it on the yellow target, then fly home and land.',
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
        text: 'The supply crate is loaded. Take off from runway 09 and turn south-east toward Mango Cay.',
        hint: 'Full power with Shift, pull back at 55 knots, then turn right with D.',
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
        hint: 'Turn back to the north-west and follow the arrow home.',
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
          // The failure is the mission. Arm it the moment the step begins.
          if (!ctx.ac.failures.engine) ctx.sim.toggleFailure('engine');
        },
        check: (ctx) => ctx.ac.ias * UNITS.KTS < 78 && ctx.ac.ias * UNITS.KTS > 52 && ctx.elapsed > 6,
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
        text: 'One lap of Mount Ember, anticlockwise, and land. Watch the ash over the summit.',
        hint: 'Stay wide of the crater — the ash will choke the engine. The arrow shows the next point.',
        targetLabel: 'North flank',
        target: () => new THREE.Vector3(2500, ELEV + 900, -4600),
        check: (ctx) => ctx.ac.pos.z < -3900 && ctx.ac.pos.x > 1200,
      },
      {
        id: 'lap2',
        text: 'Round the far side.',
        hint: 'Keep the mountain on your left and do not cut across the top of it.',
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
          if (!t.active) return false;
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

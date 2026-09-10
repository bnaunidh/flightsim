/**
 * The flight school lesson.
 *
 * Nine short steps that take a complete beginner from "which key starts the
 * engine" to a landing back on runway 09. The instructor talks over the
 * intercom (much less radio distortion than the tower) and every step has a
 * hint that repeats if you get stuck.
 */

import * as THREE from '../vendor/three.module.js';
import { RUNWAY } from '../world/airport.js';
import { UNITS } from '../aircraft/physics.js';
import { RUNWAY_START } from './missions.js';

const ELEV = RUNWAY.elev;
const ft = (m) => m * UNITS.FT;
const kt = (v) => v * UNITS.KTS;

export const TUTORIAL = {
  id: 'tutorial',
  name: 'Flight School',
  failOnCrash: false,
  weather: { time: 'day', condition: 'clear', windSpeedKts: 3, windDirDeg: 95 },
  spawn: { ...RUNWAY_START, engineOn: false },
  steps: [
    {
      id: 'welcome',
      text: 'Welcome to flight school! Look around with C to change the camera, then we will start the engine.',
      hint: 'Press C to switch between the cockpit and the outside views.',
      atc: {
        text: 'Hello, and welcome aboard. I am your instructor. Have a look around the cockpit, then we will get the engine going.',
        voice: 'instructor',
      },
      duration: 9,
      check: (ctx) => ctx.data.cameraChanged || ctx.runner.stepElapsed > 12,
    },
    {
      id: 'engine',
      text: 'Press I to start the engine.',
      hint: 'The I key is the starter. Listen for the propeller catching.',
      atc: {
        text: 'Clear prop! Press the I key to turn the starter, and give it a moment to catch.',
        voice: 'instructor',
      },
      check: (ctx) => ctx.ac.engineOn && ctx.ac.rpm > 0.15,
    },
    {
      id: 'power',
      text: 'Hold Shift for full power and let the aeroplane roll down the runway.',
      hint: 'Hold Shift until the green power bar is all the way up. Ctrl takes power off.',
      atc: {
        text: 'Good. Now smoothly all the way up with the power, and let her run down the centre line.',
        voice: 'instructor',
      },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdEast,
      check: (ctx) => ctx.ac.controls.throttle > 0.9 && kt(ctx.ac.ias) > 20,
    },
    {
      id: 'steer',
      text: 'Keep straight with the rudder: Q nudges the nose left, E nudges it right.',
      hint: 'Little taps of Q and E. On the ground the rudder steers the nose wheel.',
      atc: {
        text: 'Keep her straight with your feet. Small nudges only, do not chase it.',
        voice: 'instructor',
      },
      check: (ctx) => kt(ctx.ac.ias) > 45,
    },
    {
      id: 'rotate',
      text: 'You are at flying speed — pull back gently with S and fly!',
      hint: 'Ease back on S. Do not yank it: a small, steady pull is all you need.',
      atc: { text: 'Fifty five knots. Rotate! Ease back, and up we go.', voice: 'instructor' },
      // agl is in metres: 10 m is a clear, unambiguous lift-off.
      check: (ctx) => ctx.ac.agl > 10 && ctx.ac.airborneTime > 1.2,
      onDone: (ctx) => ctx.sim.notify('You are flying! Beautiful take-off.', 'good'),
    },
    {
      id: 'climb',
      text: 'Climb to 1,000 feet. Keep the nose just above the horizon.',
      hint: 'Watch the altimeter — the big needle counts hundreds of feet.',
      atc: {
        text: 'Lovely. Hold that attitude and climb up to one thousand feet.',
        voice: 'instructor',
      },
      check: (ctx) => ft(ctx.ac.alt) > 980,
    },
    {
      id: 'level',
      text: 'Level off: push gently forward and take a little power off with Ctrl. Hold your height for five seconds.',
      hint: 'Aim for a climb needle reading of zero. Nose on the horizon, power about three quarters.',
      atc: {
        text: 'Now level off. Lower the nose to the horizon and ease the power back a touch.',
        voice: 'instructor',
      },
      enter: (ctx) => {
        ctx.data.levelTimer = 0;
        ctx.data.levelTarget = ft(ctx.ac.alt);
      },
      check: (ctx, dt) => {
        const stable = Math.abs(ctx.ac.vs * UNITS.FPM) < 260;
        ctx.data.levelTimer = stable ? (ctx.data.levelTimer || 0) + dt : 0;
        return ctx.data.levelTimer > 5;
      },
      onDone: (ctx) => ctx.sim.notify('Nicely levelled off.', 'good'),
    },
    {
      id: 'turn',
      text: 'Now a turn. Roll left with A until you are heading north — 360 degrees — then centre the controls.',
      hint: 'Hold A to bank left, watch the heading numbers, then release to level the wings.',
      atc: {
        text: 'Let us try a turn. Gentle bank to the left, and roll out heading north.',
        voice: 'instructor',
      },
      check: (ctx) => {
        const diff = Math.abs(((ctx.ac.heading - 360 + 540) % 360) - 180);
        return diff > 168 && Math.abs(ctx.ac.bankAngleDeg()) < 12;
      },
    },
    {
      /*
       * The circuit, flown as a circuit rather than as a slalom.
       *
       * This used to be four glowing rings you chased. That teaches you to
       * chase rings — a real pattern is a shape you fly by looking out of the
       * window at the runway, and it is the one thing every pilot learns
       * first. Each leg is now a place to be and a heading to be on, with the
       * arrow pointing the way, so what you practise is the actual skill.
       */
      id: 'downwind',
      text: 'Turn left onto the downwind leg — fly back parallel to the runway, with it out of your left window.',
      hint: 'Turn left with A until you are heading roughly west (270°), holding 1,000 feet.',
      atc: {
        text: 'Turn left downwind for runway zero nine. Keep the runway just off your left wingtip.',
        voice: 'instructor',
      },
      targetLabel: 'Downwind leg',
      target: () => new THREE.Vector3(-1800, ELEV + 300, -1100),
      check: (ctx) =>
        ctx.ac.pos.z < -600 &&
        ctx.ac.pos.x < 200 &&
        Math.abs(((ctx.ac.heading - 270 + 540) % 360) - 180) < 45,
    },
    {
      id: 'base',
      text: 'Good. Now turn left again onto base leg, and start coming down.',
      hint: 'Turn left to about south (180°) and ease the power back to begin the descent.',
      atc: {
        text: 'Turn left base. Start your descent now — aim to be at five hundred feet rolling onto final.',
        voice: 'instructor',
      },
      targetLabel: 'Base leg',
      target: () => new THREE.Vector3(-2900, ELEV + 200, -500),
      check: (ctx) =>
        ctx.ac.pos.x < -2100 &&
        ctx.ac.pos.z > -1000 &&
        Math.abs(((ctx.ac.heading - 180 + 540) % 360) - 180) < 60,
    },
    {
      id: 'final',
      text: 'Last turn — roll out pointing straight at the runway.',
      hint: 'Turn left onto east (090°) and line the runway up in the middle of your windscreen.',
      atc: {
        text: 'Turn final, runway zero nine. Cleared to land.',
        voice: 'instructor',
      },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      check: (ctx) =>
        ctx.ac.pos.x > -3400 &&
        ctx.ac.pos.x < RUNWAY.thresholdWest.x - 300 &&
        Math.abs(ctx.ac.pos.z) < 500 &&
        Math.abs(((ctx.ac.heading - 90 + 540) % 360) - 180) < 40,
    },
    {
      id: 'land',
      text: 'Power back with Ctrl, keep two white and two red on the PAPI lights, and land on the runway.',
      hint: 'All red means too low, all white means too high. Flare gently just before touchdown.',
      atc: {
        text: 'You are on final. Power back, watch those PAPI lights, and hold the centre line. I have every confidence.',
        voice: 'instructor',
      },
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: (ctx) =>
        !!ctx.data.lastTouchdown &&
        !ctx.data.lastTouchdown.crashed &&
        ctx.ac.onGround &&
        ctx.ac.groundSpeed < 3 &&
        ctx.ac.groundTime > 1,
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak(
      'That was a real landing, and you flew it yourself. You are cleared for solo flight. Well done.',
      'instructor'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    return l ? Math.max(60, l.score) : 60;
  },
};

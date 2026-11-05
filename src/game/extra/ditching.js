/**
 * Both Engines Out: the Emergencies heading's ditching. A Sandline Air
 * Meridian loses both engines off the Kestrel coast with no runway in reach.
 * Features/ditching.js does the sea, the rafts and the rescue, and this only
 * says what to do next and reads it back. A mission a ditching belongs to says
 * `allowDitch`; a hard arrival is still the crash, and fails it.
 */

import * as THREE from '../../vendor/three.module.js';
import { UNITS } from '../../aircraft/physics.js';

const CALL = 'Sandline four one two';
/** Calm water off Kestrel's north shore: 12.7 km from the failure, a 15.8 km glide, the island 17 km and the runway 19. */
const LEE = new THREE.Vector3(1000, 0, -6500);

const ditchState = (ctx) => (ctx.sim.ditching ? ctx.sim.ditching.state() : {});

export const MISSIONS = [
  {
    id: 'both-engines-out',
    category: 'events',
    game: 'flight',
    name: 'Both Engines Out',
    short: 'Ditch an airliner',
    difficulty: 'Hard',
    icon: '⚠',
    map: 'kestrel',
    allowDitch: true,
    // Worn for this flight only (main.js flightPaint): the player's own paint is not touched.
    paint: 'sandline',
    radio: { callsign: CALL, quiet: ['start', 'clearance', 'airborne', 'final', 'shortfinal', 'lowalt', 'airspace'] },
    blurb:
      `${CALL}, 58 people aboard, 3,500 feet over the sea north of Kestrel, and both engines have just stopped. ` +
      'The runway is out of reach. Put her down on the water, slow and level, and get everybody out.',
    reward: 'Teaches a glide, a plan, and how a ditching is flown: wheels up, flaps down, wings level, nose up.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 200 },
    spawn: { pos: new THREE.Vector3(-1500, 0, -19000), headingDeg: 170, speed: 82, altAGL: 1100 },
    parTime: 200,
    onStart(ctx) {
      const ac = ctx.ac;
      if (ac.gearDown && !ac.onGround) {
        ac.gearDown = false;
        ac.gearPos = 0;
      }
      if (ctx.sim.ditching) ctx.sim.ditching.load();
    },
    steps: [
      {
        id: 'quit',
        text: 'Both engines have failed and the runway is out of reach. Lower the nose and hold 160 knots: that is your glide.',
        hint: 'Your goal is the calm water marked ahead. No power, one try. Keep the wings level.',
        atc: { text: `Mayday, mayday, mayday. ${CALL}, both engines failed, unable to reach Kestrel. We are going in the water.`, voice: 'pilot' },
        targetLabel: 'Calm water',
        target: () => LEE,
        enter: (ctx) => {
          if (ctx.ac.onGround || ctx.ac.airborneTime < 0.2) return;
          if (!ctx.ac.failures.engine) ctx.sim.toggleFailure('engine');
        },
        check: (ctx) => {
          // The check arms it too: a step that began on the ground waits for the air.
          if (!ctx.ac.failures.engine && !ctx.ac.onGround) ctx.sim.toggleFailure('engine');
          return ctx.ac.failures.engine && ctx.elapsed > 8;
        },
      },
      {
        id: 'prepare',
        text: 'Keep the gear UP. Flaps down in stages as you slow. Follow the arrow to the calm water.',
        hint: 'Wheels catch the water and pull the nose in. Full flaps give you the slowest touchdown.',
        atc: { text: `${CALL}, Kestrel Approach. We see you. Boats are launching. The sea is calm in the lee of the island.`, voice: 'approach' },
        targetLabel: 'Calm water',
        target: () => LEE,
        check: (ctx) => ctx.ac.pos.y * UNITS.FT < 900,
      },
      {
        id: 'ditch',
        text: 'Wings level. Hold the nose up a little and let her settle: slow, flat, and gently onto the water.',
        hint: 'Aim for under 500 feet a minute. It is the sink rate that counts, then the speed. Keep the wings level.',
        targetLabel: 'Calm water',
        target: () => LEE,
        check: (ctx) => {
          const st = ditchState(ctx);
          return st.phase === 'afloat' || !!st.done;
        },
      },
      {
        id: 'evacuate',
        text: 'She is afloat. Doors open, rafts out. Hold on until the rescue boat is alongside.',
        hint: 'Nothing left to fly. Everybody out, and count heads.',
        atc: { text: `Kestrel Approach, ${CALL}. Down on the water, all doors open, everybody going into the rafts.`, voice: 'pilot' },
        check: (ctx) => !!ditchState(ctx).done,
      },
    ],
    // Land is out of reach by design; a pilot who stretched it there has flown a different mission.
    failIf: (ctx) => (ctx.ac.onGround && !ctx.ac.ditched && ctx.ac.groundSpeed < 6 ? 'You reached land. The mission was the water.' : null),
    onComplete(ctx) {
      ctx.sim.speak(`${CALL}, Rescue One. Fifty-eight aboard, fifty-eight accounted for. That was very well flown.`, 'tower');
    },
    score: (ctx) => {
      const d = ctx.data.ditching;
      return d ? d.score : 0;
    },
  },
];

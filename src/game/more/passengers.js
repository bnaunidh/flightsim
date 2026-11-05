/**
 * Passenger missions: four airline jobs, easiest first — the shuttle, the
 * sightseeing charter, the city run and the red-eye. Under "Passengers &
 * cargo" in the picker (menus.js MISSION_CATEGORIES 'airline'), which had
 * nothing under it until now.
 *
 * Each one starts at a gate, nose-in to the jet bridge, with the passengers
 * boarding (features/passengers.js): wait for the doors, or Skip boarding;
 * call the ground crew and push back with Y, or Skip to the runway. Then fly
 * the route and land. They are scored on what the passengers thought of it —
 * the comfort rating — and on time:
 *
 *   55%  comfort       the rating out of 5 (passengers/comfort.js)
 *   25%  on time       full marks inside the scheduled time, falling away after
 *   20%  the landing   the flight model's own touchdown score
 *
 * The debrief says what the passengers thought ("Passengers: 4.6/5 — smooth
 * landing!"; passengers.js adds the line).
 *
 * Every map here has one airport, so every job goes out and comes back: to
 * the next island, up the fjord, over the city across the strait. When the
 * San Francisco Bay map lands with SFO and OAK, an SFO-to-OAK hop is one more
 * entry in this list with a `to` airport — the steps below already read the
 * runway they land on from the map, not from numbers typed in here.
 */

import * as THREE from '../../vendor/three.module.js';
import { RUNWAY } from '../../world/airport.js';
import { MAP, isOnRunway2 } from '../../world/terrain.js';
import { airportLayout } from '../../world/airport-layout.js';
import { resolveSpawn, spawnClassOf } from '../../world/spawns.js';
import { getAircraft } from '../../aircraft/types.js';

const FT = 3.28084;
const ft = (m) => m * FT;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/**
 * A gate on the mission's own airport, for this aircraft: resolved when the
 * mission starts (main.js reads `pos` and `headingDeg` after loading the map
 * and the aeroplane). Nowhere free fits it: the runway, ready to go — and
 * then the passengers are already aboard.
 */
export function gateSpawn(typeId) {
  const resolve = () => {
    try {
      const type = getAircraft(typeId);
      return resolveSpawn(MAP && MAP.id, spawnClassOf(type), { type, choice: 'gate', ctx: { layout: airportLayout() } });
    } catch (e) {
      return null;
    }
  };
  const runway = () => {
    const h = ((RUNWAY.headingDeg ?? 90) * Math.PI) / 180;
    return { x: RUNWAY.thresholdWest.x + Math.sin(h) * 80, z: RUNWAY.thresholdWest.z - Math.cos(h) * 80, headingDeg: RUNWAY.headingDeg ?? 90 };
  };
  return {
    get pos() {
      const r = resolve() || runway();
      return new THREE.Vector3(r.x, RUNWAY.elev, r.z);
    },
    get headingDeg() {
      const r = resolve() || runway();
      return r.headingDeg;
    },
    // Parked at the gate with the engines off; the runway fallback starts them.
    get engineOn() {
      const r = resolve();
      return !r || r.kind === 'runway';
    },
  };
}

/** The passengers' feature, or a stand-in that never holds anybody up. */
function P(ctx) {
  return (ctx.sim && ctx.sim.passengers) || null;
}

/** Down on either runway and stopped (missions.js landedAndStopped, for heavier aeroplanes). */
function landedAndStopped(ctx) {
  const ac = ctx.ac;
  const t = ctx.data.lastTouchdown;
  const stopped = !!t && !t.crashed && ac.onGround && ac.groundSpeed < 3 && ac.groundTime > 1.5;
  if (!stopped) return false;
  if (t.onRunway || isOnRunway2(ac.pos.x, ac.pos.z, 8)) return true;
  if (!ctx.data.saidOffRunway) {
    ctx.data.saidOffRunway = true;
    ctx.sim.hud.notify('Safely down — but not on the runway. Take off and come round again.', 'warn', 6);
  }
  return false;
}

/** Lined up for runway 09 from the west (the approach box every flight mission uses). */
function onFinal(ctx, maxDist = 4200) {
  const ac = ctx.ac;
  const thr = RUNWAY.thresholdWest;
  return (
    ac.pos.x < thr.x - 250 &&
    ac.pos.distanceTo(RUNWAY.touchdown) < maxDist &&
    Math.abs(ac.pos.z - thr.z) < 900 &&
    Math.abs(((ac.heading - (RUNWAY.headingDeg ?? 90) + 540) % 360) - 180) < 55
  );
}

const _final = new THREE.Vector3();
function finalFix(back = 1800, up = 230) {
  return _final.copy(RUNWAY.thresholdWest).add(new THREE.Vector3(-back, up, 0));
}

/** The first two steps of every job: the doors, then the take-off. */
function boardStep(words) {
  return {
    id: 'board',
    text: words || 'Your passengers are boarding at the gate. When the doors close, press Y for the ground crew and push back — or tap Skip to the runway.',
    hint: 'The panel on the left counts them aboard. Skip boarding if you are in a hurry.',
    check: (ctx) => {
      const p = P(ctx);
      return !p || p.ready();
    },
  };
}

function departStep(text, atc) {
  return {
    id: 'depart',
    text,
    hint: 'Full power, rotate gently, and climb away straight ahead. Smooth hands — your passengers notice everything.',
    atc,
    targetLabel: 'Runway 09',
    target: () => RUNWAY.thresholdEast,
    check: (ctx) => ctx.ac.airborneTime > 4 && ctx.ac.agl > 60,
  };
}

function landStep(text) {
  return {
    id: 'land',
    text: text || 'Land on runway 09 — as softly as you can. The passengers are counting on a smooth one.',
    hint: 'Gear down, flaps out, and aim for under 300 ft/min at touchdown. Then brake to a stop on the runway.',
    targetLabel: 'Touchdown zone',
    target: () => RUNWAY.touchdown,
    check: landedAndStopped,
  };
}

/** 55% comfort, 25% on time, 20% the landing. */
function passengerScore(par) {
  return (ctx) => {
    const p = P(ctx);
    const comfort = p ? clamp(p.rating / 5, 0, 1) : 0.7;
    const late = Math.max(0, ctx.elapsed - par);
    const onTime = clamp(1 - late / par, 0, 1);
    const l = ctx.data.lastTouchdown;
    const landing = l ? clamp(l.score / 100, 0, 1) : 0.4;
    return Math.round(100 * (0.55 * comfort + 0.25 * onTime + 0.2 * landing));
  };
}

function thanks(ctx, words) {
  const p = P(ctx);
  const s = p && p.summary();
  if (s && ctx.sim.hud && ctx.sim.hud.notify) ctx.sim.hud.notify(s.line, s.rating >= 3.5 ? 'good' : 'info', 6);
  if (words) ctx.sim.speak(words, 'tower');
}

/* ------------------------------------------------------------------ *
 * The jobs, easiest first
 * ------------------------------------------------------------------ */

const MANGO = new THREE.Vector3(6350, 0, -5200);
const SKERRY_LIGHT = new THREE.Vector3(-4470, 0, -1000);
const FJORD_EAST = new THREE.Vector3(4800, 0, 200);
const HARBOUR_CITY = new THREE.Vector3(1200, 0, -6700);
const PILOT_CAY = new THREE.Vector3(6300, 0, 3500);

export const MISSIONS = [
  {
    id: 'pax-island-hopper',
    category: 'airline',
    game: 'flight',
    name: 'Island Hopper',
    short: 'A shuttle out to Mango Cay',
    difficulty: 'Easy',
    icon: '🧳',
    map: 'kestrel',
    aircraft: 'meridian',
    blurb:
      'Forty passengers want a look at Mango Cay. Board them at the gate, fly out over the village and bring them home — gently. Scheduled: 7 minutes.',
    reward: 'Teaches flying for the people in the back: smooth turns, gentle climbs and a soft landing.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 100 },
    spawn: gateSpawn('meridian'),
    parTime: 420,
    steps: [
      boardStep(),
      departStep('Take off from runway 09. Smooth and steady — the passengers are watching!', {
        text: 'Meridian four two zero, Kestrel Tower, runway zero nine, cleared for take-off. Have a good trip.',
        voice: 'tower',
      }),
      {
        id: 'climb',
        text: 'Climb to 3,000 feet. Keep your turns gentle: no more than 25 degrees of bank.',
        hint: 'Watch the PASSENGERS panel — if it says "Easy on the bank", ease off.',
        check: (ctx) => ft(ctx.ac.alt) > 2800,
      },
      {
        id: 'cay',
        text: 'Fly out over Mango Cay so everybody gets a look at the village.',
        hint: 'The arrow points at the cay. Level off at 3,000 feet on the way.',
        targetLabel: 'Mango Cay',
        target: () => new THREE.Vector3(MANGO.x, 900, MANGO.z),
        check: (ctx) => Math.hypot(ctx.ac.pos.x - MANGO.x, ctx.ac.pos.z - MANGO.z) < 1300,
      },
      {
        id: 'home',
        text: 'Lovely view! Now head home and line up with runway 09 from the west.',
        hint: 'Descend gently — under 1,500 feet a minute keeps their ears happy.',
        targetLabel: 'Final approach',
        target: () => finalFix(),
        check: (ctx) => onFinal(ctx),
      },
      landStep(),
    ],
    onComplete: (ctx) => thanks(ctx, 'Meridian four two zero, welcome back. Smooth work.'),
    score: passengerScore(420),
  },

  {
    id: 'pax-fjord-charter',
    category: 'airline',
    game: 'flight',
    name: 'Fjord Sightseeing Charter',
    short: 'A charter up the fjord and out to the light',
    difficulty: 'Medium',
    icon: '🏔',
    map: 'fjord',
    aircraft: 'a320',
    blurb:
      'A charter of sightseers in the A320: east up the fjord between the snowy walls, round, and out west to Skerry Light. Ridges, wind and a full cabin — keep it smooth. Scheduled: 9 minutes.',
    reward: 'Teaches flying a heavy jet gently in a tight place, and planning a descent.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 12, windDirDeg: 300 },
    spawn: gateSpawn('a320'),
    parTime: 540,
    steps: [
      boardStep(),
      departStep('Take off from runway 09 and climb straight ahead up the valley.', {
        text: 'Charter three two zero, Aurora Tower, runway zero nine, cleared for take-off. Climb to three thousand five hundred feet.',
        voice: 'tower',
      }),
      {
        id: 'climb',
        text: 'Climb to 3,500 feet — that is clear of every ridge here. Gently!',
        hint: 'A steady climb and wings level. The walls either side are lower than 2,200 feet.',
        check: (ctx) => ft(ctx.ac.alt) > 3300,
      },
      {
        id: 'east',
        text: 'Follow the fjord east so everybody sees the waterfalls.',
        hint: 'Shallow turns only — 25 degrees of bank at most.',
        targetLabel: 'East fjord',
        target: () => new THREE.Vector3(FJORD_EAST.x, 1100, FJORD_EAST.z),
        check: (ctx) => ctx.ac.pos.x > FJORD_EAST.x - 900,
      },
      {
        id: 'light',
        text: 'Turn round — a long, gentle turn — and fly west out to Skerry Light.',
        hint: 'Take your time in the turn. A steep one spills everyone’s coffee.',
        targetLabel: 'Skerry Light',
        target: () => new THREE.Vector3(SKERRY_LIGHT.x, 900, SKERRY_LIGHT.z),
        check: (ctx) => Math.hypot(ctx.ac.pos.x - SKERRY_LIGHT.x, ctx.ac.pos.z - SKERRY_LIGHT.z) < 1400,
      },
      {
        id: 'home',
        text: 'Back to Aurora. Line up with runway 09 from the west and start a gentle descent.',
        hint: 'You are already west of the field: descend at 1,000 to 1,500 feet a minute and slow down early.',
        targetLabel: 'Final approach',
        target: () => finalFix(2200, 260),
        check: (ctx) => onFinal(ctx, 4800),
      },
      landStep(),
    ],
    onComplete: (ctx) => thanks(ctx, 'Charter three two zero, welcome back to Aurora. They loved it.'),
    score: passengerScore(540),
  },

  {
    id: 'pax-city-run',
    category: 'airline',
    game: 'flight',
    name: 'Harbour City Run',
    short: 'The morning flight, on the timetable',
    difficulty: 'Medium',
    icon: '🏙',
    map: 'gateway',
    aircraft: 'a320',
    blurb:
      'The morning airline run in the A320: up to 5,000 feet, a turn over Harbour City across the strait, and back to Gateway on the timetable. The schedule is tight — and so is the passengers’ patience. Scheduled: 8 minutes.',
    reward: 'Teaches flying to a timetable without rushing the people in the back.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 9, windDirDeg: 80 },
    spawn: gateSpawn('a320'),
    parTime: 480,
    steps: [
      boardStep('Boarding at Gateway for the morning run. The clock is running — skip boarding if you are late, but board them all.'),
      departStep('Take off from runway 09, then turn left towards Harbour City.', {
        text: 'Gateway three two zero, cleared for take-off runway zero nine. After departure turn left, climb five thousand.',
        voice: 'tower',
      }),
      {
        id: 'climb',
        text: 'Climb to 5,000 feet on your way north to the city.',
        hint: 'A steady climb. If the passengers panel says "Smoother on the stick", you are pulling too hard.',
        targetLabel: 'Harbour City',
        target: () => new THREE.Vector3(HARBOUR_CITY.x, 1550, HARBOUR_CITY.z),
        check: (ctx) => ft(ctx.ac.alt) > 4700,
      },
      {
        id: 'city',
        text: 'Fly over Harbour City — the passengers on both sides want a look.',
        hint: 'Gentle turns. Keep the speed steady.',
        targetLabel: 'Harbour City',
        target: () => new THREE.Vector3(HARBOUR_CITY.x, 1550, HARBOUR_CITY.z),
        check: (ctx) => Math.hypot(ctx.ac.pos.x - HARBOUR_CITY.x, ctx.ac.pos.z - HARBOUR_CITY.z) < 1600,
      },
      {
        id: 'home',
        text: 'Back to Gateway: line up with runway 09 from the west. Plan your descent — not too steep!',
        hint: 'Start down early. Faster than 2,000 feet a minute and ears start popping.',
        targetLabel: 'Final approach',
        target: () => finalFix(2600, 300),
        check: (ctx) => onFinal(ctx, 5200),
      },
      landStep(),
    ],
    onComplete: (ctx) => thanks(ctx, 'Gateway three two zero, on time and on the centreline. Nice.'),
    score: passengerScore(480),
  },

  {
    id: 'pax-red-eye',
    category: 'airline',
    game: 'flight',
    name: 'The Red-Eye',
    short: 'A full jumbo, at night, in the rain',
    difficulty: 'Hard',
    icon: '🌙',
    map: 'gateway',
    aircraft: 'b747',
    blurb:
      'Four hundred sleepy passengers in the 747, at night, in rain and bumpy air. Climb above the worst of it, fly out past Pilot Cay and bring them home without waking anybody. Scheduled: 10 minutes.',
    reward: 'Teaches flying smoothly in rough air, at night, in the heaviest aeroplane there is.',
    weather: { time: 'night', condition: 'rainy', windSpeedKts: 15, windDirDeg: 110 },
    spawn: gateSpawn('b747'),
    parTime: 600,
    steps: [
      boardStep('Night boarding for the red-eye. Four hundred of them — let them settle, or skip if you must.'),
      departStep('Take off from runway 09 into the rain. Fly the instruments.', {
        text: 'Speedbird seven four seven, Gateway Tower, runway zero nine, cleared for take-off. Moderate turbulence reported below six thousand.',
        voice: 'tower',
      }),
      {
        id: 'climb',
        text: 'Climb to 7,000 feet, above the worst of the bumps. Wings level and steady.',
        hint: 'You cannot stop the turbulence — but you can stop making it worse. Small, slow inputs.',
        check: (ctx) => ft(ctx.ac.alt) > 6700,
      },
      {
        id: 'cay',
        text: 'Cruise out to Pilot Cay. Let them sleep.',
        hint: 'Trim it out and keep your hands light on the controls.',
        targetLabel: 'Pilot Cay',
        target: () => new THREE.Vector3(PILOT_CAY.x, 2100, PILOT_CAY.z),
        check: (ctx) => Math.hypot(ctx.ac.pos.x - PILOT_CAY.x, ctx.ac.pos.z - PILOT_CAY.z) < 2000,
      },
      {
        id: 'home',
        text: 'Time to bring them home. A long, gentle descent and line up with runway 09 from the west.',
        hint: 'Plan it: 7,000 feet takes seven miles at 1,000 feet a minute. Slow down before you go down.',
        targetLabel: 'Final approach',
        target: () => finalFix(3200, 340),
        check: (ctx) => onFinal(ctx, 6200),
      },
      landStep('Land her softly. In the rain, at night, with four hundred people asleep. You can do it.'),
    ],
    onComplete: (ctx) => thanks(ctx, 'Speedbird seven four seven, welcome home. Not a single coffee spilled.'),
    score: passengerScore(600),
  },
];

/**
 * The flight events, as missions you can pick — so nobody has to fly ten
 * long-haul trips hoping the dice come up.
 *
 *   Hijacked!            the film version of the hijack, for everybody, in a
 *                        long-haul airliner (the 747 if the airliners team's
 *                        roster has it, then the A380, then the Meridian)
 *   Hijack: By the Book  the realistic version — the locked door, 7500 and
 *                        silence, two clicks, the ICAO intercept signals, the
 *                        conversation on the interphone and the remote
 *                        runway. Its card is shown locked until the Dev
 *                        passcode is in: "the more realistic one is behind
 *                        a code".
 *   Pizza on the Runway  the lost pizza car, from the seat of an aeroplane
 *                        lined up and waiting to go
 *
 * All three are driven by src/features/flight-events.js: the mission starts
 * the event and reads its progress back, and the extension draws the jets,
 * the police, the car and the story cards. If that feature has been switched
 * off for throwing, the steps that wait on it give up politely after a few
 * seconds rather than leaving a child waiting for jets that are never coming.
 */

import * as THREE from '../../vendor/three.module.js';
import { RUNWAY } from '../../world/airport.js';
import { heightAt, isOnRunway2 } from '../../world/terrain.js';
/*
 * Through the bridge, not from flight-events.js: importing that file from
 * here registered the whole feature from the mission list, so leaving it out
 * of src/features/index.js switched nothing off. See src/features/events/bridge.js.
 */
import { forceHijack, hijackInfo, forceBreakIn, breakInInfo, eventsHeartbeat } from '../../features/events/bridge.js';
import { cruiseSpeed, longHaulId } from '../../features/events/common.js';
import * as Prog from '../../game/progression.js';
// The other seat in each hijack: fly the lead fighter (src/game/roles/hijack-lead.js).
import { HIJACK_FILM_ROLES, HIJACK_REAL_ROLES } from '../roles/hijack-lead.js';

const FT = 3.28084;
const T1 = new THREE.Vector3();

function flat(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/**
 * If the events feature is off, give the step up after a moment, with a word.
 * "Off" is its heartbeat not moving for four seconds of a running mission —
 * the extension layer switches a feature off for throwing, and nothing else
 * would ever tell this step the police are not coming.
 */
function orSkip(ctx, dt, why) {
  const hb = eventsHeartbeat();
  if (hb !== ctx.data.hb) {
    ctx.data.hb = hb;
    ctx.data.stale = 0;
    return false;
  }
  ctx.data.stale = (ctx.data.stale || 0) + (dt || 1 / 60);
  if (ctx.data.stale > 4) {
    ctx.data.stale = 0;
    ctx.sim.hud.notify(why, 'info', 4);
    return true;
  }
  return false;
}

function landedOnRunway(ctx) {
  const ac = ctx.ac;
  const t = ctx.data.lastTouchdown;
  const stopped = !!t && !t.crashed && ac.onGround && ac.groundSpeed < 2.5 && ac.groundTime > 1.2;
  if (!stopped) return false;
  if (t.onRunway || isOnRunway2(ac.pos.x, ac.pos.z, 8)) return true;
  if (!ctx.data.saidOffRunway) {
    ctx.data.saidOffRunway = true;
    ctx.sim.hud.notify('Safely down — but not on the runway. Take off and come round again.', 'warn', 6);
  }
  return false;
}

/** How far through its story the hijack is, as a number, so a step can ask "at least this far". */
const ORDER = {
  film: ['idle', 'armed', 'burst', 'orders', 'approach', 'taxi', 'rush', 'board', 'done'],
  real: ['idle', 'armed', 'door', 'squawk', 'verify', 'orders', 'intercept', 'follow', 'final', 'stop', 'rush', 'board', 'done'],
};

function reached(phase) {
  const h = hijackInfo();
  const list = ORDER[h.version] || ORDER.film;
  return list.indexOf(h.phase) >= list.indexOf(phase);
}

/** A long-haul airliner, well out, fast enough to fly and slow enough to think. */
function cruiseSpawn(x, z, headingDeg) {
  /*
   * `altAGL` over water is measured from the sea floor (34 m down at
   * Kestrel), so 1,534 puts you at 1,500 m — about 5,000 ft. Both spawn
   * points below are open sea, measured.
   */
  /*
   * 75 m/s for anything that stalls under 100 kt clean — not the 100 the
   * first version used: the game's coach calls anything over 150 knots "far
   * too fast" in every aeroplane, and a story that opens with a nag to
   * throttle back is a worse story. cruiseSpeed() goes faster only for a
   * type whose own lift numbers need it (half as fast again as its clean
   * stall), so a heavier roster entry does not open the story stalling.
   */
  return { pos: new THREE.Vector3(x, 0, z), headingDeg, speed: cruiseSpeed(longHaulId()), altAGL: 1534 };
}

/**
 * Wheels up for the cruise. main.js puts every airborne mission spawn down
 * with its gear down (reset() defaults to it and the spawn has no way to say
 * otherwise), which on a long-haul airliner in the cruise is wrong — and in
 * the by-the-book story the leader's "land here" is answered by lowering
 * them, which means nothing if they were never up.
 */
function gearUp(ctx) {
  const ac = ctx.ac;
  if (ac && ac.gearDown && !ac.onGround) {
    ac.gearDown = false;
    ac.gearPos = 0;
  }
}

/* ================================================================== *
 * Hijacked! — the film version
 * ================================================================== */

const hijack = {
  id: 'event-hijack',
  category: 'events',
  game: 'flight',
  name: 'Hijacked!',
  short: 'Somebody is in the cockpit',
  difficulty: 'Medium',
  icon: '🚨',
  map: 'kestrel',
  roles: HIJACK_FILM_ROLES,
  /*
   * A getter, because which airliners exist is only known once every
   * roster file has loaded — and startMode reads this at the moment you
   * press the button, which is late enough.
   */
  get aircraft() {
    return longHaulId();
  },
  blurb:
    'You are the captain of a long-haul jet passing Kestrel on the way to the mainland, when a man forces his way into '
    + 'the cockpit and orders you down onto the island. Stay calm, squawk 7500 without him noticing, do as he says — '
    + 'and fly him straight into a welcome party.',
  reward: 'Teaches the real hijack code: 7500 tells every radar screen there is trouble on board, without a word said out loud.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 7, windDirDeg: 90 },
  /*
   * Out over the sea to the west-south-west, on a course that passes the
   * island a mile and a half to the south. It was 14 km out, and the pilot
   * bot that plays this mission (tests/features/events.playthrough.js)
   * followed the arrow in the 747 and reached "Down! Put it on the runway"
   * 9.5 km out and 1,290 m up: from there a jumbo cannot get down to the
   * runway without going round. 24 km out at 5,000 ft is on a three-degree
   * slope to the approach gate, so doing as he says, straight away, is also
   * a landable approach.
   */
  get spawn() {
    return cruiseSpawn(-24000, 8000, 75);
  },
  parTime: 540,
  onStart: gearUp,
  steps: [
    {
      id: 'cruise',
      text: 'You are the captain of a long-haul flight to the mainland, passing Kestrel island on the way. Everything is calm.',
      hint: 'Keep the wings level and enjoy the view.',
      atc: { text: 'Good afternoon, Kestrel Approach. Radar contact. Continue on course for the mainland.', voice: 'approach' },
      check: (ctx) => ctx.elapsed > 10,
    },
    {
      id: 'burst',
      text: 'HIJACK! A man has forced his way into the cockpit. Stay calm and keep flying — and secretly squawk 7500: press 7.',
      hint: '7500 is the hijack code. Every radar that can see you shows it, and he will never hear a word. Press 7, or tap the button on the card.',
      enter: (ctx) => forceHijack(ctx.sim, { owner: 'mission', version: 'film' }),
      check: (ctx, dt) => {
        const h = hijackInfo();
        // Squawked — or already down, because some people land first and
        // think about transponders afterwards, and that must not strand them.
        // Or nobody pressed 7 and the cabin crew phoned it in: the story has
        // moved on to his orders, so the words on screen must too.
        if (h.squawked || h.landed || h.crewCalled) return true;
        return orSkip(ctx, dt, 'The event system is off — carry on to the runway.');
      },
    },
    {
      id: 'orders',
      text: 'He wants you to land on the island. Do what he says: turn towards Kestrel and start going down to 3,000 feet.',
      hint: 'Ease the power back and let the nose drop a little — about 1,000 feet a minute down. Follow the arrow.',
      targetLabel: 'Line up',
      target: () => hijackInfo().guide || T1.set(RUNWAY.thresholdWest.x - 6000, RUNWAY.elev + 600, RUNWAY.thresholdWest.z),
      check: (ctx, dt) => reached('approach') || orSkip(ctx, dt, 'The event system is off — carry on to the runway.'),
    },
    {
      id: 'land',
      text: 'Two fighter jets are hiding low behind your tail, where he cannot see them — hold B to look. Land on runway 09.',
      hint: 'Gear down (G), flaps down (F), and follow the PAPI lights in: two white, two red.',
      targetLabel: 'Touchdown',
      target: () => RUNWAY.touchdown,
      check: (ctx, dt) => hijackInfo().landed || orSkip(ctx, dt, 'The event system is off — land and stop to finish.'),
    },
    {
      id: 'stand',
      text: 'He is shouting: "Take it to the terminal!" Slow right down, then taxi to the column of light — or stop anywhere, and help will come to you.',
      hint: 'Brakes on (hold Space) first. Gentle on the power — airliners are heavy to steer. Or just stop: the police will come to you.',
      targetLabel: 'Stand',
      // Nothing to point at until the stand is picked, once you have slowed
      // down (hijack.js): the touchdown point, behind you, would be wrong.
      target: () => hijackInfo().stand,
      check: (ctx, dt) => reached('rush') || orSkip(ctx, dt, 'The event system is off — well done anyway!'),
    },
    {
      id: 'arrest',
      text: 'POLICE! They are rushing the aeroplane. Keep your brakes on and watch them go in. (C gives you your view back.)',
      hint: 'Nothing to do now but hold the brakes. You have done your part, Captain.',
      check: (ctx, dt) => hijackInfo().done || orSkip(ctx, dt, 'The event system is off — well done anyway!'),
    },
  ],
  onComplete(ctx) {
    ctx.sim.speak('Well done, Captain. Everyone on board is safe, and he is on his way to the police station.', 'tower');
  },
  score: (ctx) => {
    const h = hijackInfo();
    if (h.done && h.score) return h.score;
    const l = ctx.data.lastTouchdown;
    return Math.round(40 + (l ? l.score : 40) * 0.45);
  },
};

/* ================================================================== *
 * Hijack: By the Book — the realistic version, behind the Dev passcode
 * ================================================================== */

const hijackReal = {
  id: 'event-hijack-real',
  category: 'events',
  game: 'flight',
  name: 'Hijack: By the Book',
  short: 'The realistic one — Dev passcode',
  difficulty: 'Hard',
  icon: '🛡️',
  map: 'kestrel',
  devOnly: true,
  roles: HIJACK_REAL_ROLES,
  get aircraft() {
    return longHaulId();
  },
  /*
   * The card is locked without the code, but a card is not a gate: this is.
   * Asked once, at the first frame, from main.js's own progression object —
   * the one the passcode box writes to.
   */
  failIf: (ctx) => {
    if (ctx.data.devOk === undefined) {
      let p = ctx.sim && ctx.sim.prog;
      if (!p) {
        try { p = Prog.load(); } catch (e) { p = null; }
      }
      ctx.data.devOk = Prog.isDev(p);
    }
    return ctx.data.devOk ? null : 'This one is behind the Dev passcode — enter it under Dev mode, at the bottom of the Hangar.';
  },
  blurb:
    'Somebody is trying the flight deck door, and then he is on the interphone giving orders. Do what real crews are '
    + 'trained to do: keep the door locked, tell ATC without saying a word, answer the fighters\' signals, talk him '
    + 'down, and put the aeroplane where the police want it.',
  reward: 'Teaches the crew\'s side of the real procedure: the locked door, 7500, the ICAO intercept signals and a remote stand.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 0 },
  // North-west of the island, heading east for the mainland.
  get spawn() {
    return cruiseSpawn(-9000, -12000, 100);
  },
  parTime: 720,
  onStart: gearUp,
  steps: [
    {
      id: 'cruise',
      text: 'You are the captain of a long-haul flight to the mainland, north of Kestrel island. Everything is calm.',
      hint: 'Keep the wings level. Enjoy it while it lasts.',
      atc: { text: 'Good afternoon, Kestrel Approach. Radar contact. Continue on course for the mainland.', voice: 'approach' },
      check: (ctx) => ctx.elapsed > 10,
    },
    {
      id: 'door',
      text: 'Somebody is trying to get into the flight deck! Answer on the card: 8 keeps the door locked, 9 opens it.',
      hint: 'On every airliner the flight deck door is locked and built strong. Whatever is said on the other side, it stays shut.',
      enter: (ctx) => forceHijack(ctx.sim, { owner: 'mission', version: 'real' }),
      check: (ctx, dt) => reached('squawk') || orSkip(ctx, dt, 'The event system is off — carry on to the runway.'),
    },
    {
      id: 'squawk',
      text: 'You cannot talk freely — he may be listening. Let the transponder say it: squawk 7500 (press 7).',
      hint: '7500 means "unlawful interference". Press 7, or tap the button on the card.',
      check: (ctx, dt) => hijackInfo().squawked || hijackInfo().landed || orSkip(ctx, dt, 'The event system is off — carry on to the runway.'),
    },
    {
      id: 'verify',
      text: 'ATC has seen your code and is checking it. Answer on the card.',
      hint: 'When a pilot squawking 7500 does not answer, ATC knows it is real. Two clicks of the microphone means yes.',
      check: (ctx, dt) => reached('orders') || orSkip(ctx, dt, 'The event system is off — carry on to the runway.'),
    },
    {
      id: 'orders',
      text: 'He is giving orders on the interphone. Do as he says for now: turn onto his heading, and make the radio call he wants — in code.',
      hint: 'The heading is on the card and the little arrow. For the radio call, the airline\'s secret phrase is "the coffee is cold": he will not know what it means, ATC will.',
      check: (ctx, dt) => reached('intercept') || orSkip(ctx, dt, 'The event system is off — carry on to the runway.'),
    },
    {
      id: 'intercept',
      text: 'Fighters! The jet ahead and to your left is rocking its wings: "You have been intercepted — follow me." Rock yours to answer.',
      hint: 'Roll left, then right (A, then D) — a quarter of the way over each way, then level again.',
      targetLabel: 'Lead jet',
      target: () => hijackInfo().lead,
      check: (ctx, dt) => hijackInfo().acked || hijackInfo().landed || orSkip(ctx, dt, 'The event system is off — carry on to the runway.'),
    },
    {
      id: 'follow',
      text: 'Follow the lead jet — turn when it turns, go down when it goes down — and talk to him on the interphone: pick your words on the card. When the jet puts its wheels down, put yours down too (G).',
      hint: 'Stay behind the lead jet and a little to its right. It is flying the slope down to the runway: power back and nose a little down to stay with it. Calm, true words work best.',
      // Where the leader is going, not the leader: it sits ahead and to the
      // left, and an arrow straight at it is a pursuit curve (see hijack.js).
      targetLabel: 'The way the lead jet is going',
      target: () => hijackInfo().leadAim || hijackInfo().lead || hijackInfo().guide,
      check: (ctx, dt) => reached('final') || orSkip(ctx, dt, 'The event system is off — carry on to the runway.'),
    },
    {
      id: 'land',
      text: 'Both jets broke away — "You may proceed". Land where they brought you, then roll to the far end.',
      hint: 'Gear down (G), flaps down (F). Any landing at the airfield counts; the far end, away from the terminal, is best.',
      targetLabel: 'Touchdown',
      target: () => hijackInfo().remote || RUNWAY.touchdown,
      check: (ctx, dt) => hijackInfo().landed || orSkip(ctx, dt, 'The event system is off — land and stop to finish.'),
    },
    {
      id: 'stop',
      text: 'Stop on the runway and shut down the engines (press I). Stay on the flight deck with the door locked.',
      hint: 'Hold Space until you stop, then press I. The police come to you.',
      check: (ctx, dt) => reached('rush') || orSkip(ctx, dt, 'The event system is off — well done anyway!'),
    },
    {
      id: 'board',
      text: 'The police tactical team is going in. Keep the door locked and the brakes on. (C gives you your view back.)',
      hint: 'You have done your part, Captain.',
      check: (ctx, dt) => hijackInfo().done || orSkip(ctx, dt, 'The event system is off — well done anyway!'),
    },
  ],
  onComplete(ctx) {
    ctx.sim.speak('By the book, Captain. Everyone on board is safe. Thank you.', 'tower');
  },
  score: (ctx) => {
    const h = hijackInfo();
    if (h.done && h.score) return h.score;
    const l = ctx.data.lastTouchdown;
    return Math.round(30 + (l ? l.score : 40) * 0.4);
  },
};

/* ================================================================== *
 * Pizza on the Runway
 * ================================================================== */

const T_BREACH = new THREE.Vector3();

const breakin = {
  id: 'event-breakin',
  category: 'events',
  game: 'flight',
  name: 'Pizza on the Runway',
  short: 'Hold position!',
  difficulty: 'Easy',
  icon: '🍕',
  map: 'kestrel',
  aircraft: 'skylark',
  blurb:
    'You are lined up and ready to go when a lost pizza delivery car drives straight through the airport fence and starts '
    + 'doing donuts on the runway. The airport police are on it. Your job is the hardest one in aviation: wait.',
  reward: 'Teaches holding position — air traffic control’s instructions are there to keep everybody safe.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 90 },
  parTime: 300,
  failIf: (ctx) => {
    const b = breakInInfo();
    const step = ctx.runner.step;
    if (!step || step.id !== 'hold' || !b.holdPos || b.clear) return null;
    /*
     * Rolling is a warning (the tower shouts); taking off, or trundling off
     * down the runway towards the car, is the end.
     *
     * Not a tight radius. Measured: touching Space once lets the parking
     * brake off, and the Skylark then creeps forward at idle, gathering
     * 0.37 m/s every second — 90 m in about twenty seconds. A child who
     * tapped the brakes because the screen said "brakes" has done nothing
     * wrong, so the line is 300 m and the tower says "hold Space" first.
     */
    if (flat(ctx.ac.pos, b.holdPos) > 300 || !ctx.ac.onGround) {
      return 'You did not hold position — the police had to chase you as well! Hold means stay still. Have another go.';
    }
    return null;
  },
  steps: [
    {
      id: 'ready',
      text: 'You are lined up on runway 09. Wait for the tower to clear you for take-off.',
      hint: 'Do not push the power up yet — wait for the tower.',
      check: (ctx) => ctx.elapsed > 4 || ctx.ac.groundSpeed > 3,
    },
    {
      id: 'hold',
      text: 'HOLD POSITION! A car is on the runway. Keep the power off and stay still until the tower says it is clear.',
      hint: 'If you start rolling, hold Space to stop. Otherwise just wait — press C to watch the police chase it.',
      enter: (ctx) => forceBreakIn(ctx.sim, { owner: 'mission' }),
      check: (ctx, dt) => breakInInfo().done || orSkip(ctx, dt, 'The event system is off — you are cleared for take-off.'),
    },
    {
      id: 'go',
      text: 'The runway is clear! Cleared for take-off, runway 09.',
      hint: 'Full power with Shift, and ease back on S at 55 knots.',
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'thanks',
      text: 'Fly low past the police cars by the broken fence to say thank you. Wave your wings!',
      hint: 'They are just south of the runway, at the western end. Stay above 300 feet.',
      targetLabel: 'The police',
      target: () => {
        const b = breakInInfo().breach;
        if (!b) return null;
        return T_BREACH.set(b.x, heightAt(b.x, b.z) + 120, b.z);
      },
      check: (ctx) => {
        const b = breakInInfo().breach;
        if (!b) return true;
        const ok = flat(ctx.ac.pos, b) < 600 && ctx.ac.agl * FT < 1000 && ctx.ac.agl > 60;
        if (ok) ctx.sim.hud.notify('The police are waving back! One of them is holding up a slice of pizza.', 'good', 5);
        return ok;
      },
    },
    {
      id: 'land',
      text: 'Now come round and land on runway 09.',
      hint: 'Fly a lap of the field and line up from the west. Two white, two red on the PAPI.',
      atc: { text: 'Skylark one seven two, cleared to land runway zero nine. The pizza was for us, by the way.', voice: 'tower' },
      targetLabel: 'Touchdown',
      target: () => RUNWAY.touchdown,
      check: landedOnRunway,
    },
  ],
  onComplete(ctx) {
    ctx.sim.speak('Skylark one seven two, nicely done. We saved you a slice. It is a bit squashed.', 'tower');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const held = breakInInfo().warned ? 0 : 25;
    return Math.round(held + (l ? l.score : 40) * 0.55 + Math.max(0, 1 - ctx.elapsed / 600) * 20);
  },
};

/*
 * "The more realistic one is behind a code." It is in the list for everybody,
 * flagged `devOnly`. Its card is shown locked until the Dev passcode is in —
 * see guardDevMissions() in src/features/flight-events.js, which does it live,
 * so entering the code unlocks the card the next time the Missions screen
 * opens. The mission's own failIf is the gate on the engine: a start without
 * the code, from anywhere, ends at once with a word about where the code
 * goes. The Dev panel's "Realistic hijack" button is only drawn in Dev mode.
 */
export const REAL_HIJACK = hijackReal;

export const MISSIONS = [hijack, hijackReal, breakin];

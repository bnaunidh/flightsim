/**
 * Air Force One: two missions, two seats each.
 *
 *   1. "Air Force One"              CAPTAIN: a proper departure, a cruise
 *      (normal)                     with the escort on your wing, an
 *                                    approach and a smooth landing, then
 *                                    taxi to the stand. Graded on smoothness
 *                                    and the schedule.
 *                                    ESCORT: scramble, join his wing, hold
 *                                    station through the cruise and the
 *                                    turn, peel off as he lands, land
 *                                    yourself.
 *   2. "Air Force One —              LOCKED behind the military passcode,
 *      Under Attack"                 exactly like the military aircraft
 *                                    (progression.js needsPasscode /
 *                                    militaryUnlocked — see `military: true`
 *                                    below, read the same way carrierqual
 *                                    and the other three do): its card is
 *                                    shown locked until the code is in, and
 *                                    unlocks live, no reload, the moment it
 *                                    is — menus.js re-reads the flag on
 *                                    every render.
 *                                    CAPTAIN: the warning, evasive flying and
 *                                    flares/chaff against drones and their
 *                                    missiles, over the sea; reach the field
 *                                    and land.
 *                                    ESCORT: shoot the drones down with the
 *                                    fighter's gun, stay between them and
 *                                    the jet, then escort him home.
 *
 * Both captain seats are driven by src/features/events/afo.js, which starts
 * the escort NPC (src/game/roles/npc-flyer.js) and, in the attack mission,
 * the shared drones/missiles/flares engine (src/features/events/afo-combat.js)
 * — the mission steps below only read its live progress back through
 * afoInfo(), the same way src/game/extra/events.js reads hijackInfo(). The
 * other seat — the lead fighter, in either mission — is
 * src/game/roles/afo-lead.js, the model for both being hijack-lead.js.
 *
 * Kid-safe throughout, as afo-combat.js's own header says: unmanned drones,
 * nobody aboard one, a missile that gets through is a fail with a kind word,
 * never a wreck.
 */

import * as THREE from '../../vendor/three.module.js';
import { RUNWAY, parkingSlots } from '../../world/airport.js';
import { heightAt } from '../../world/terrain.js';
import {
  field, cruiseSpeed, runwayFrame, RW, rw, flat, FT,
} from '../../features/events/common.js';
import { afoInfo } from '../../features/events/afo.js';
// The other seat: the lead fighter (src/game/roles/afo-lead.js).
import { AFO_NORMAL_ROLES, AFO_ATTACK_ROLES, ATTACK_AIR_START } from '../roles/afo-lead.js';

const ID_NORMAL = 'afo-normal';
const ID_ATTACK = 'afo-attack';
const LEAD = 'Guardian lead';

/** 0 under par, decaying to 0 by twice par — the same shape every mission here scores a clock on. */
function scoreFor(elapsed, par) {
  if (elapsed <= par) return 1;
  return Math.max(0, 1 - (elapsed - par) / par);
}

/* ================================================================== *
 * "Air Force One" — the normal flight, seat 'captain'
 * ================================================================== */

/** A point out over the sea, well clear of the island, on the departure heading. */
function seaWaypoint(uMul, vOff, altAdd) {
  runwayFrame();
  const p = rw(RW.L * uMul, vOff);
  p.y += altAdd;
  return p;
}

/**
 * main.js's reset() defaults every spawn to gear down; right for a ground
 * start, wrong for an airborne one (see events.js's own gearUp, which this
 * mirrors — the attack mission's captain starts already in the cruise).
 */
function gearUp(ctx) {
  const ac = ctx.ac;
  if (ac && ac.gearDown && !ac.onGround) {
    ac.gearDown = false;
    ac.gearPos = 0;
  }
}

/**
 * The biggest free stand this field has — Air Force One gets the VIP ramp,
 * not whichever patch of apron is nearest. Chosen once, the first time the
 * taxi step asks, and kept for the rest of the flight (parkingSlots() is
 * live, so asking again as the jet rolls could hand back a different stand).
 */
function bigStandFor(ctx) {
  if (ctx.data.standPicked) return ctx.data.stand || null;
  ctx.data.standPicked = true;
  let slots = null;
  try {
    slots = typeof parkingSlots === 'function' ? parkingSlots() : null;
  } catch (e) {
    slots = null;
  }
  const pool = Array.isArray(slots)
    ? slots.filter((s) => s && s.kind === 'stand' && Number.isFinite(s.x) && Number.isFinite(s.z) && (!s.maxSpan || s.maxSpan >= 60))
    : [];
  if (pool.length) {
    // The biggest box available; ties broken by nearest, so a tie does not
    // flip-flop between two equal stands on consecutive frames.
    const p = ctx.ac.pos;
    pool.sort((a, b) => (b.maxSpan || 0) - (a.maxSpan || 0) || Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
    const s = pool[0];
    ctx.data.stand = new THREE.Vector3(s.x, Number.isFinite(s.y) ? s.y : heightAt(s.x, s.z), s.z);
  } else {
    // No stand fits (a small field): a patch of apron ahead of where it stopped.
    runwayFrame();
    ctx.data.stand = RUNWAY.touchdown.clone().addScaledVector(RW.f, RW.L * 0.65);
  }
  return ctx.data.stand;
}

/** Tracks the worst bank this flight has seen, for the smoothness score — read inside every step's check. */
function trackSmooth(ctx) {
  const ac = ctx.ac;
  if (!ac || typeof ac.bankAngleDeg !== 'function') return;
  const b = Math.abs(ac.bankAngleDeg());
  if (b > (ctx.data.maxBank || 0)) ctx.data.maxBank = b;
}

const afoNormal = {
  id: ID_NORMAL,
  category: 'events',
  game: 'flight',
  name: 'Air Force One',
  short: 'Escort the president',
  difficulty: 'Medium',
  icon: '🦅',
  // Gateway International: a jumbo's airport, with a stand to taxi to (the owner: "use different maps for different missions").
  map: 'gateway',
  roles: AFO_NORMAL_ROLES,
  aircraft: 'b747',
  blurb:
    'You are the captain of Air Force One: a proper departure, a cruise out over the sea with your fighter escort '
    + 'tucked on your wing, an approach and a smooth landing, then taxi in to the stand. Or fly the escort instead — '
    + 'scramble, join up, and bring him home.',
  reward: 'Teaches a calm, by-the-numbers flight: smooth control inputs and keeping to a schedule.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 7, windDirDeg: 90 },
  parTime: 480,
  steps: [
    {
      id: 'depart',
      text: 'You are the captain of Air Force One. Full power, take off, and climb out over the sea. Guardian lead is joining on your wing.',
      hint: 'Full power (Shift), ease back around 160 knots, then wheels up (G).',
      atc: { text: `Air Force One, ${field()} Tower, winds light, cleared for take-off.`, voice: 'tower' },
      check: (ctx) => {
        trackSmooth(ctx);
        return ctx.ac.airborneTime > 3 && ctx.ac.agl > 100;
      },
    },
    {
      id: 'cruise',
      text: 'Climb out to sea and hold your heading. Guardian is settled on your wing — fly smoothly for him.',
      hint: 'Gentle control inputs. A big jet does not like to be hurried.',
      targetLabel: 'Cruise point',
      target: () => seaWaypoint(4.5, 1200, 550),
      check: (ctx) => {
        trackSmooth(ctx);
        const p = seaWaypoint(4.5, 1200, 550);
        return flat(ctx.ac.pos, p) < 1100 && ctx.ac.agl * FT > 1200;
      },
    },
    {
      id: 'approach',
      text: `Turn back towards ${field()} and begin your descent. Guardian will peel off as you line up.`,
      hint: 'Ease the power back and let the nose drop a little. Follow the arrow in.',
      targetLabel: 'Runway threshold',
      target: () => RUNWAY.touchdown,
      check: (ctx) => {
        trackSmooth(ctx);
        // RUNWAY.touchdown/.length, not the RW frame cache: that is only
        // refreshed when something calls runwayFrame(), and this check must
        // not depend on another module having done so earlier the same frame.
        return flat(ctx.ac.pos, RUNWAY.touchdown) < (RUNWAY.length || 1100) * 3 && ctx.ac.agl * FT < 2000;
      },
    },
    {
      id: 'land',
      text: 'Land.',
      hint: 'Gear down (G), flaps down (F). Smooth is the whole point.',
      targetLabel: 'Touchdown',
      target: () => RUNWAY.touchdown,
      check: (ctx) => ctx.ac.onGround && ctx.ac.groundSpeed < 2.5 && ctx.ac.groundTime > 1.2,
    },
    {
      id: 'taxi',
      text: 'Taxi in to the stand.',
      hint: 'Gentle on the power — a heavy jet is slow to answer. Follow the arrow.',
      targetLabel: 'The stand',
      target: (ctx) => bigStandFor(ctx),
      check: (ctx) => {
        const st = bigStandFor(ctx);
        if (!ctx.ac.onGround || ctx.ac.groundSpeed > 2.5 || ctx.ac.groundTime < 1) return false;
        return !st || flat(ctx.ac.pos, st) < 60;
      },
    },
  ],
  onComplete(ctx) {
    ctx.sim.speak(`${LEAD}, ${field()} Approach. Nicely flown, Captain. Welcome home.`, 'approach');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const smooth = Math.max(0, 20 - (ctx.data.maxBank || 0) * 0.35);
    const pts = {
      flight: 35,
      smooth: Math.round(smooth),
      landing: Math.round((l ? l.score : 40) * 0.3),
      time: Math.round(15 * scoreFor(ctx.elapsed, 480)),
    };
    return Math.max(0, Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0)));
  },
};

/* ================================================================== *
 * "Air Force One — Under Attack" — seat 'captain', behind the military code
 * ================================================================== */

const afoAttack = {
  id: ID_ATTACK,
  category: 'events',
  game: 'flight',
  name: 'Air Force One — Under Attack',
  short: 'Evade, decoy, get him down',
  difficulty: 'Very hard',
  icon: '🚨',
  // Ironhead Air Base: the military field, 3,200 m of concrete for the jumbo and the fighters' own
  // base to scramble from. The air start is open sea to the west (measured in node).
  map: 'airbase',
  // The military passcode, exactly like the military aircraft — see
  // progression.js's needsPasscode(p, type), which reads this flag on a
  // mission exactly as it does on an aeroplane. Not a devOnly gate: the
  // owner asked for the real one, "behind the military code".
  military: true,
  roles: AFO_ATTACK_ROLES,
  aircraft: 'b747',
  blurb:
    'Unidentified drones come out of the sea for Air Force One. Fly evasive, decoy their missiles with flares, and '
    + 'trust your escort to clear the drones — or fly the escort yourself and shoot them down with the gun.',
  reward: 'Teaches evasive flying and decoys under pressure, calm and clear, never gory.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 9, windDirDeg: 100 },
  // The exact point the escort's own seat joins him at (afo-lead.js) — both
  // seats of this mission must agree on where Air Force One is.
  get spawn() {
    return {
      pos: new THREE.Vector3(ATTACK_AIR_START.x, 0, ATTACK_AIR_START.z),
      headingDeg: ATTACK_AIR_START.hdg,
      speed: cruiseSpeed('b747'),
      // altAGL over water is measured from the sea floor (34 m down here) —
      // see afo-lead.js's own spawn, which this matches exactly.
      altAGL: ATTACK_AIR_START.y + 34,
    };
  },
  parTime: 420,
  onStart: gearUp,
  steps: [
    {
      id: 'cruise',
      text: 'You are the captain of Air Force One, over open water. Everything is calm — for now.',
      hint: 'Keep the wings level.',
      atc: { text: `Air Force One, ${field()} Approach. Radar contact.`, voice: 'approach' },
      check: (ctx) => ctx.elapsed > 6,
    },
    {
      id: 'warning',
      text: 'Unidentified drones, no transponder, no response. Evasive action is authorised. Guardian is engaging.',
      hint: 'Stand by — watch for anything that gets past him.',
      check: (ctx) => afoInfo().waveSent || ctx.elapsed > 20,
    },
    {
      id: 'evade',
      text: 'Fly evasive — turns, a dive — and keep going. If a missile gets close, drop flares (press 4, or tap FLARE).',
      hint: 'A missile chases the newest flare for a few seconds. Do not drop them all at once.',
      check: (ctx) => {
        const i = afoInfo();
        return (i.dronesAlive === 0 && i.missilesInbound === 0) || ctx.runner.stepElapsed > 180;
      },
    },
    {
      id: 'home',
      text: `Guardian has it clear. Head for ${field()} and get down safe.`,
      hint: 'Follow the arrow home.',
      targetLabel: field(),
      target: () => RUNWAY.touchdown,
      // afoInfo().home is runCaptainAttack's own flat(ac.pos, RW.c) < 1500,
      // computed there (where it already calls runwayFrame() first) — read
      // back rather than recomputed here, where RW might not be fresh yet.
      check: (ctx) => afoInfo().home || flat(ctx.ac.pos, RUNWAY.touchdown) < 1500,
    },
    {
      id: 'land',
      text: `Land at ${field()}.`,
      hint: 'Gear down (G), flaps down (F).',
      targetLabel: 'Touchdown',
      target: () => RUNWAY.touchdown,
      check: (ctx) => ctx.ac.onGround && ctx.ac.groundSpeed < 2.5 && ctx.ac.groundTime > 1.2,
    },
  ],
  failIf: () => afoInfo().failWhy,
  onComplete(ctx) {
    ctx.sim.speak(`${LEAD}, ${field()} Approach. He is down safe. Well flown, Captain.`, 'approach');
  },
  score: (ctx) => {
    const i = afoInfo();
    const st = i.stats || { hits: 0 };
    const l = ctx.data.lastTouchdown;
    const pts = {
      survived: Math.max(0, 40 - st.hits * 20),
      home: i.home ? 20 : 8,
      landing: Math.round((l ? l.score : 40) * 0.25),
      time: Math.round(15 * scoreFor(ctx.elapsed, 420)),
    };
    return Math.max(0, Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0)));
  },
};

/*
 * Order matters a little: the normal flight first, the attack — harder, and
 * the one behind the passcode — last, the same rule the military four already
 * follow ("Military is last so the passcode gate never leaves a hole in the
 * middle of the list", menus.js).
 */
export const MISSIONS = [afoNormal, afoAttack];

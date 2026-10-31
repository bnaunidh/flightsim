/**
 * "Last Flight Out" — the SCP Foundation containment-breach evacuation, on
 * Nunatak Reach.
 *
 * SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0,
 * scpwiki.com (LICENSE, "SCP FOUNDATION CONTENT"). The Foundation, the Site,
 * the Class-D, the MTF and the on-site Alpha Warhead are theirs; the flight
 * is ours. No numbered SCP is named or shown.
 *
 * The owner, 2026-10-30: "another mission about the scp foundation where the
 * scp are breaching but u have the last escape plane, people will board and
 * get items, you need to choose when to fly, especially before one of the
 * scps or nukes get u".
 *
 * You are the last aircraft on the Site's ice strip, the C-17, engines
 * running, ramp down. Survivors and supplies are coming to your ramp in
 * waves; the warhead counts down from four minutes; the compound's sectors
 * go dark one by one, and when the one beside the strip goes you have about
 * twenty seconds. Close the ramp when you choose — the ramp key, or the big
 * CLOSE RAMP button — and go: whoever is not on the ramp turns back (nobody
 * is shown being hurt). Take off from the ice, put five kilometres between
 * you and the Site before the warhead goes, and land at Caribou Forward
 * Operating Base. Scored on the people, the cargo, the margin and the
 * landing. Leaving empty still counts as "made it", low; the last wave and
 * out is the three-star run.
 *
 * Everything that moves and counts is features/scp-escape.js; this is the
 * mission's shape (the same as every mission in ../missions.js) and its
 * steps. `category: 'events'`, `map: 'nunatak'` (borrowed and given back),
 * `checkpoint: false` (a clock cannot be resumed from "the start of the
 * step": a reload starts the mission over, cleanly — game/checkpoint.js).
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt, MAP } from '../../world/terrain.js';
import { RUNWAY } from '../../world/airport.js';
import { landedOnRunway } from '../landing-zone.js';
import * as Esc from '../../features/scp-escape.js';

export const ID = Esc.ID;

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const _target = new THREE.Vector3();
function at(x, z, lift = 2) {
  return _target.set(x, heightAt(x, z) + lift, z);
}

/** The Site block of the loaded map (null off the snow map, the picker's briefing). */
function scp() {
  return MAP && MAP.scp ? MAP.scp : null;
}

/**
 * The start: lined up on the ice strip facing west (Caribou is that way),
 * 660 m of ice ahead, ramp down, engines running. A getter: the map exists
 * only once it is built.
 */
const stripStart = {
  get pos() {
    const p = Esc.startPose();
    return p ? new THREE.Vector3(p.x, 0, p.z) : new THREE.Vector3(4660, 0, -2800);
  },
  get headingDeg() {
    const p = Esc.startPose();
    return p ? p.headingDeg : 270;
  },
  engineOn: true,
};

function siteCentre() {
  const c = scp();
  return c ? { x: c.cx, z: c.cz } : { x: 4550, z: -3140 };
}

/** The C-17's cargo ramp (fleet/extra/c17.js userData.cargo), or null. */
function cargoOf(sim) {
  const m = sim && sim.model;
  return (m && m.userData && m.userData.cargo) || null;
}

/** How far down the ramp is, 0 shut to 1 on the ground. */
function rampAmount(sim) {
  const c = cargoOf(sim);
  if (!c) return 0;
  return typeof c.amount === 'function' ? c.amount() : c.isOpen ? 1 : 0;
}

const lastFlight = {
  id: ID,
  category: 'events',
  game: 'flight',
  name: 'Last Flight Out',
  short: 'Containment breach at the Site — load who you can, and leave before the warhead',
  difficulty: 'Hard',
  icon: '❄',
  map: 'nunatak',
  aircraft: 'c17',
  // Not resumable: the warhead and the breach are a clock (game/checkpoint.js whyNot).
  checkpoint: false,
  blurb:
    'Containment breach at Site-91 North. You are the last aircraft out: the C-17 on the ice strip, ramp down, engines '
    + 'running. Survivors and supplies are coming to your ramp in waves. The Alpha Warhead is armed — four minutes — and '
    + 'the compound\'s sectors are going dark one by one. Leave when you choose, but leave before the breach reaches the '
    + 'strip or the warhead goes. Then put five kilometres behind you and land at Caribou.',
  reward: 'A push-your-luck flight: every second on the ground saves more people, and costs you the margin you fly out on.',
  briefingFrom: 'Site-91 Control',
  briefing: [
    'Reach two one, Site Control. Containment is lost in the north sectors and the Alpha Warhead is armed: four minutes.',
    'You are the last aircraft out. Everyone we can reach is coming to your ramp — staff, Class-D, the task force — with what they can carry.',
    'Leave when you judge it right. If the sector by the strip goes dark, you have about twenty seconds. Be five kilometres out when it goes.',
  ],
  objectives: [
    'Hold on the strip with the ramp down while people and cargo board',
    'Close the ramp when you choose — before the breach reaches the strip or the warhead goes',
    'Take off from the ice and put five kilometres between you and the Site',
    'Land at Caribou Forward Operating Base',
  ],
  // Night, snow, a little wind down the strip (the ice is the lesson, not a crosswind).
  weather: { time: 'night', condition: 'cloudy', windSpeedKts: 8, windDirDeg: 270 },
  spawn: stripStart,
  parTime: 420,
  onStart: (ctx) => {
    const seed = ctx.sim && ctx.sim.modeOpts && Number.isFinite(ctx.sim.modeOpts.seed) ? ctx.sim.modeOpts.seed : null;
    Esc.begin(ctx.sim, seed);
    // Ramp DOWN from the first frame (the C-17's own API: set puts it there without the eight-second swing).
    const c = cargoOf(ctx.sim);
    if (c) {
      if (typeof c.set === 'function') c.set(1);
      else c.open();
    }
    // Parked: the brake on (power releases it). A C-17 at idle creeps on ice.
    if (ctx.ac) ctx.ac.parkingBrake = true;
    ctx.data.liftoffAt = null;
    if (ctx.sim && ctx.sim.hud && ctx.sim.hud.showBanner) {
      ctx.sim.hud.showBanner('LAST FLIGHT OUT', 'Containment breach. Load who you can — leave before the breach reaches the strip or the warhead goes.', 'warn', 7);
    }
  },
  tick: (ctx) => {
    if (ctx.data.liftoffAt == null && ctx.ac && !ctx.ac.onGround && ctx.ac.airborneTime > 2) ctx.data.liftoffAt = ctx.elapsed;
  },
  failIf: () => Esc.failReason(),
  steps: [
    {
      id: 'board',
      text: 'Hold on the strip, ramp down. Survivors and supplies are running to your ramp in waves. Close the ramp — press 6, or tap CLOSE RAMP — when you choose to go.',
      hint: 'Watch the card: the warhead, which sector has gone, how many are aboard. The sector by the strip is the last one; when it goes, you have about twenty seconds. Rolling with the ramp down closes it too.',
      atc: { text: 'Reach two one, Site Control. Hold position, ramp down. They are coming to you now. The warhead is armed — four minutes. Your call when to go.', voice: 'ground', urgency: 1 },
      targetLabel: 'Your ramp',
      target: (ctx) => ctx.ac.pos,
      check: (ctx) => {
        const R = Esc.run();
        return !!R && R.phase !== 'boarding' && rampAmount(ctx.sim) < 0.05;
      },
    },
    {
      id: 'takeoff',
      text: 'Ramp up. Full power and take off along the ice to the west. Braking is poor, so do not stop now.',
      hint: 'Full power (Shift). Keep it straight with the rudder (A and D), ease back at about 120 knots, gear up (G) once you are climbing.',
      atc: { text: 'Reach two one, you are cleared to go. Wind two seven zero at eight. Climb straight ahead and turn south-west for Caribou.', voice: 'ground', urgency: 1 },
      targetLabel: 'West end of the strip',
      target: () => {
        const c = scp();
        return c ? at(c.strip.cx - c.strip.halfLen + 40, c.strip.cz, 3) : RUNWAY.thresholdWest;
      },
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 25,
    },
    {
      id: 'escape',
      text: 'Climb away and turn south-west for Caribou. Put five kilometres between you and the Site before the warhead goes.',
      hint: 'Follow the arrow. Speed is distance: keep the power up and the nose down once you are clear of the ground. When it goes, hold the wings level for the pressure wave.',
      targetLabel: 'Caribou FOB',
      target: () => RUNWAY.touchdown,
      check: (ctx) => flat(ctx.ac.pos, siteCentre()) > Esc.BLAST_SAFE_M || flat(ctx.ac.pos, RUNWAY.touchdown) < 3500,
    },
    {
      id: 'land',
      text: 'Land at Caribou Forward Operating Base, runway 09 or 27, and stop.',
      hint: 'Gear down early, full flap, and plenty of room: it is a heavy aeroplane and the runway is snow.',
      atc: { text: 'Reach two one, Caribou Tower. You are cleared to land, either runway. Fire crews standing by. Welcome back.', voice: 'tower' },
      targetLabel: 'Caribou runway',
      target: () => RUNWAY.touchdown,
      check: (ctx) => landedOnRunway(ctx),
    },
  ],
  onComplete: (ctx) => {
    const res = Esc.finish(ctx);
    if (res && ctx.sim && ctx.sim.speak) {
      ctx.sim.speak(`Reach two one, Caribou. ${res.saved} of ${res.total} off the Site${res.cargo ? `, ${res.cargo} ${res.cargo === 1 ? 'cart' : 'carts'} of supplies` : ''}. You are down. Well done.`, 'tower');
    }
  },
  score: (ctx) => Esc.scoreNow(ctx),
};

export const MISSIONS = [lastFlight];

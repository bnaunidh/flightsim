/**
 * "Class-D Transfer" — the SCP Foundation mission, on Nunatak Reach.
 *
 * SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0,
 * scpwiki.com (LICENSE, "SCP FOUNDATION CONTENT"). The Foundation, the Site
 * and the Class-D are theirs; this flight between two airfields is ours.
 *
 * The flight: you are on a stand at Caribou Forward Operating Base with the
 * engine running. An escort walks four Class-D personnel out of a van to
 * your door and they board. You take off, cross the sound to Sentinel
 * Island, and land on the Site's airstrip — which is ICE: a third of the
 * grip, "braking action poor" on the HUD, and 1,100 m that feels like 500.
 * Taxi to the T by the gate and stop; the escort walks them to the blast
 * door, which stays shut. That is the whole of it: a transport flight with
 * a hard landing surface at the end, scored on the landing, on stopping
 * where you were told, and on the clock.
 *
 * Nothing is shown but people walking. No creatures, no gore, nobody is
 * hurt; the doors never open and you cannot go in (features/scp-site.js
 * makes every building solid). The spookiness is the place.
 *
 * Shape as every mission in ../missions.js. `category: 'events'`, so it
 * sits with the other one-off happenings in the picker; `map: 'nunatak'`,
 * the snow map, which the runner borrows and gives back.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt, MAP, AIRPORT } from '../../world/terrain.js';
import { RUNWAY } from '../../world/airport.js';
import { airportLayout } from '../../world/airport-layout.js';
import { landedInZone } from '../landing-zone.js';
import * as Site from '../../features/scp-site.js';

const D2R = Math.PI / 180;
export const ID = 'classd-transfer';

/** How close to the T, and how slow, counts as parked at the gate. */
const GATE_R = 26;
const GATE_SPEED = 1.5;

const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** The Site block of the loaded map, or Nunatak's if asked off the map (the picker's briefing). */
function scp() {
  return MAP && MAP.scp ? MAP.scp : null;
}

/**
 * The start: on the first stand of the base, nose out, engine running — the
 * same stand the de-icing truck and the van are parked by (scp-site.js reads
 * the same layout). A getter, because the layout exists only once the map
 * is built. Falls back to a spot on the apron if a field has no stands.
 */
const standStart = {
  get pos() {
    try {
      const st = airportLayout().stands[0];
      if (st) return new THREE.Vector3(st.x, 0, st.z);
    } catch (e) {
      /* no layout yet */
    }
    return new THREE.Vector3(-300, 0, -260);
  },
  get headingDeg() {
    try {
      const st = airportLayout().stands[0];
      if (st) return st.headingDeg;
    } catch (e) {
      /* no layout yet */
    }
    return 90;
  },
};

/**
 * The ice strip as a landing box (game/landing-zone.js's shape): the strip
 * plus the usual shoulders, the same rule as a runway — down inside it, in
 * one piece, after a real touchdown.
 */
export function stripZone(cfg = scp()) {
  if (!cfg || !cfg.strip) return null;
  const s = cfg.strip;
  const h = (s.headingDeg || 90) * D2R;
  return {
    id: 'ice-strip',
    name: 'Site airstrip',
    kind: 'runway',
    shape: 'box',
    cx: s.cx,
    cz: s.cz,
    elev: heightAt(s.cx, s.cz),
    ux: Math.sin(h),
    uz: -Math.cos(h),
    headingDeg: s.headingDeg || 90,
    halfLength: s.halfLen + 60,
    halfWidth: s.halfWidth + 15,
    below: 5,
    above: 12,
    runway: { length: s.halfLen * 2, halfWidth: s.halfWidth },
  };
}

const _target = new THREE.Vector3();
function at(x, z, lift = 2) {
  return _target.set(x, heightAt(x, z) + lift, z);
}

function stripCentre() {
  const c = scp();
  return c ? at(c.strip.cx, c.strip.cz, 3) : RUNWAY.touchdown;
}

function gatePoint() {
  const c = scp();
  return c ? at(c.gate.x, c.gate.z, 1.5) : RUNWAY.touchdown;
}

/** On the ground, slow, and on the T. */
function parkedAtGate(ctx) {
  const c = scp();
  const ac = ctx.ac;
  if (!c || !ac.onGround || ac.groundSpeed > GATE_SPEED || ac.groundTime < 1) return false;
  return flat(ac.pos, c.gate) < GATE_R;
}

/** Time share of the score: all of it under par, nothing at twice par. */
function scoreFor(elapsed, par) {
  return Math.max(0, Math.min(1, 1 - Math.max(0, elapsed - par) / par));
}

const transfer = {
  id: ID,
  category: 'events',
  game: 'flight',
  name: 'Class-D Transfer',
  short: 'Fly four Class-D to the Site — and land on ice',
  difficulty: 'Hard',
  icon: '❄',
  map: 'nunatak',
  aircraft: 'courier',
  blurb:
    'The Foundation needs four Class-D personnel moved from Caribou Base to Site-91 North, across the sound. '
    + 'Wait on the stand while the escort walks them aboard, fly them over, and land on the Site\'s airstrip — '
    + 'it is ice, and braking action is poor. Taxi to the T by the gate and stop. They walk to the blast door; '
    + 'you do not.',
  reward: 'Teaches landing on a slippery surface: touch down on the numbers, slow, and let the roll run out.',
  // A light wind nearly down both runways (09 at the base, the strip's 09): the ice
  // is the lesson here, not a crosswind on top of it.
  weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 6, windDirDeg: 90 },
  spawn: standStart,
  parTime: 420,
  onStart: (ctx) => {
    ctx.data.boarded = false;
    ctx.data.unloading = false;
    ctx.data.iceStop = null;
    Site.beginBoarding(ctx.sim);
  },
  tick: (ctx) => {
    // Where the landing roll ran out, for the score: the first time the
    // aeroplane is slow on the ground AFTER the landing step has passed (the
    // taxi step). Measured here and not off any touchdown, because a touchdown
    // anywhere else (a bounce on the take-off roll at the base) must not count.
    const ac = ctx.ac;
    const cur = ctx.runner ? transfer.steps[ctx.runner.stepIndex] : null;
    if (ctx.data.iceStop == null && cur && cur.id === 'taxi' && ac.onGround && ac.groundSpeed < 2) {
      ctx.data.iceStop = { x: ac.pos.x, z: ac.pos.z };
    }
  },
  steps: [
    {
      id: 'board',
      text: 'Hold on the stand with the engine running. The escort is walking four Class-D personnel out to your door.',
      hint: 'Parking brake on. They will not walk up to an aeroplane that is moving.',
      atc: { text: 'Courier two one, Caribou Ground. Hold position on the stand, your passengers are walking out now.', voice: 'ground' },
      targetLabel: 'Your stand',
      target: (ctx) => ctx.ac.pos,
      check: (ctx) => {
        const s = Site.transferState();
        if (s && s.phase === 'done' && s.label === 'boarding') {
          ctx.data.boarded = true;
          Site.clearTransfer();
          ctx.sim.notify('Four aboard. Door closed.', 'good');
          return true;
        }
        return false;
      },
    },
    {
      id: 'depart',
      text: 'All four are aboard. Take off from runway 09 and turn north-east for Sentinel Island.',
      hint: 'Full power (Shift), ease back at 60 knots, gear up (G) once you are climbing.',
      atc: { text: 'Courier two one, Caribou Tower, cleared for take-off runway zero nine. Site-91 is expecting you.', voice: 'tower' },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdWest,
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'cross',
      text: 'Cross the sound to Sentinel Island. The Site\'s airstrip is the pale line south of the fence. Climb to about 1,500 feet.',
      hint: 'Follow the arrow. The strip is ice: plan to arrive slow, with full flap.',
      targetLabel: 'Site airstrip',
      target: () => stripCentre(),
      // Distance only. It also asked for 400 ft, and a pilot who crossed low
      // and landed was stuck on this step for good: the landing step (the
      // next one) never started, so the touchdown on the ice never counted.
      check: (ctx) => flat(ctx.ac.pos, stripCentre()) < 2600,
    },
    {
      id: 'land',
      text: 'Land on the Site\'s airstrip. It is ICE: braking action poor. Touch down on the numbers, slow, and let it roll.',
      hint: 'Full flap, approach as slow as the aeroplane allows, and brake gently once the wheels are down.',
      atc: { text: 'Courier two one, Site-91 Ground. Cleared to land, the strip. Braking action reported POOR. Wind zero nine zero at six.', voice: 'ground' },
      targetLabel: 'Ice strip',
      target: () => stripCentre(),
      check: (ctx) => landedInZone(ctx, [stripZone()], { key: 'ice' }),
    },
    {
      id: 'taxi',
      text: 'Taxi to the yellow T by the gate and stop. Gently — the apron is as icy as the strip.',
      hint: 'A touch of power, then let it roll. Brake early; it stops slowly.',
      atc: { text: 'Courier two one, taxi to the gate stand, the T. Stop on the bar, the escort will meet you.', voice: 'ground' },
      targetLabel: 'Gate stand',
      target: () => gatePoint(),
      check: parkedAtGate,
    },
    {
      id: 'handover',
      text: 'Hold position. The escort is walking the Class-D to the blast door.',
      hint: 'Parking brake on, and wait. The doors stay shut; nobody goes in but them.',
      targetLabel: 'Blast door',
      target: () => {
        const c = scp();
        return c ? at(c.door.x, c.door.z, 4) : gatePoint();
      },
      check: (ctx) => {
        if (!ctx.data.unloading) {
          ctx.data.unloading = true;
          Site.beginHandover(ctx.sim);
          return false;
        }
        const s = Site.transferState();
        return !!(s && s.phase === 'done' && s.label === 'handover');
      },
    },
  ],
  onComplete: (ctx) => {
    ctx.sim.speak('Courier two one, Site-91. Transfer received, four of four. Thank you. You are released; depart when ready.', 'ground');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const c = scp();
    // Stopping on the ice: all of it for a stop inside the strip, less the
    // further past either end (or off either side) it ran out, whichever
    // way the strip was landed on.
    const z = c ? stripZone(c) : null;
    const at = ctx.data.iceStop;
    let over = 0;
    if (z && at) {
      const dx = at.x - z.cx;
      const dz = at.z - z.cz;
      const along = Math.abs(dx * z.ux + dz * z.uz);
      const side = Math.abs(-dx * z.uz + dz * z.ux);
      over = Math.max(0, along - z.runway.length / 2) + Math.max(0, side - z.runway.halfWidth);
    }
    const stopped = Math.max(0, Math.min(1, 1 - over / 300));
    const pts = {
      landing: Math.round((l ? l.score : 35) * 0.4),
      ice: Math.round(25 * stopped),
      gate: 15,
      time: Math.round(20 * scoreFor(ctx.elapsed, 420)),
    };
    return Math.max(0, Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0)));
  },
};

export const MISSIONS = [transfer];

/** For the tests: the airfield the mission starts from must be the loaded map's. */
export function startField() {
  return { elev: AIRPORT.elev, runway: AIRPORT.runway };
}

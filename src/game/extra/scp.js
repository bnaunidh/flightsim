/**
 * "Class-D Transfer" — the SCP Foundation mission, on Nunatak Reach.
 *
 * SCP Foundation content by the SCP Wiki community, CC BY-SA 3.0,
 * scpwiki.com (LICENSE, "SCP FOUNDATION CONTENT"). The Foundation, the Site
 * and the Class-D are theirs; this flight between two airfields is ours.
 *
 * The flight, in the C-17 (the owner, 2026-10-25: "Class-D transfer -> C-17,
 * Class-D + guards walk up the REAR RAMP"; game/mission-aircraft.js): you
 * are on a stand at Caribou Forward Operating Base, nose to the buildings,
 * engines running. Lower the cargo ramp and an escort walks four Class-D
 * personnel out of a van, across to the ramp and up it into the hold; the
 * loadmaster raises it behind them. Then the order of a real departure from
 * a stand: the ground crew and their tug push you back (P, or the prompt, or
 * the GROUND sheet on a touch screen), you taxi to runway 09, and take off.
 * Cross the sound to Sentinel Island and land on the Site's airstrip — which
 * is ICE: a third of the grip, "braking action poor" on the HUD. Taxi to the
 * T by the gate, stop, lower the ramp; the escort walks them down it and to
 * the blast door, which stays shut. Scored on the landing, on stopping where
 * you were told, and on the clock.
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
import { heightAt, MAP, AIRPORT, isOnAnyRunway } from '../../world/terrain.js';
import { RUNWAY } from '../../world/airport.js';
import { airportLayout } from '../../world/airport-layout.js';
import { landedInZone } from '../landing-zone.js';
import * as Site from '../../features/scp-site.js';
import { servicesState, setServicesHold } from '../../features/airport-services.js';

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
 * The start: on the stand with room for the C-17 (scp-site.js
 * transferStand: the van and the de-icing truck are parked round the same
 * one), nose in to the buildings the way every stand faces, engines
 * running. A getter, because the layout exists only once the map is built.
 * Falls back to a spot on the apron if a field has no stands.
 */
const standStart = {
  get pos() {
    const st = Site.transferStand();
    return st ? new THREE.Vector3(st.x, 0, st.z) : new THREE.Vector3(-300, 0, -260);
  },
  get headingDeg() {
    const st = Site.transferStand();
    return st ? st.headingDeg : 90;
  },
};

/** The C-17's cargo ramp (fleet/extra/c17.js userData.cargo), or null. */
function cargoOf(sim) {
  const m = sim && sim.model;
  return (m && m.userData && m.userData.cargo) || null;
}

/** How far down the ramp is, 0 shut to 1 on the ground. */
function rampDown(sim) {
  const c = cargoOf(sim);
  if (!c) return 1;
  return typeof c.amount === 'function' ? c.amount() : c.isOpen ? 1 : 0;
}

/** Seconds of waiting with the ramp up before the loadmaster lowers it for you. */
const RAMP_PATIENCE = 30;

/**
 * Lower the ramp for the pilot if they have not, after RAMP_PATIENCE seconds
 * of the step: the step says how (6, or OPEN RAMP), and a child who has not found
 * it is not kept on the stand for ever. Returns whether it is down.
 */
function rampOrLoadmaster(ctx, key) {
  const sim = ctx.sim;
  if (rampDown(sim) > 0.97) return true;
  const c = cargoOf(sim);
  const t = (ctx.runner && ctx.runner.stepElapsed) || 0;
  if (c && t > RAMP_PATIENCE && !ctx.data[key] && ctx.ac.onGround && (ctx.ac.groundSpeed || 0) < 0.8) {
    ctx.data[key] = true;
    c.open();
    sim.notify('The loadmaster is lowering the ramp.', 'info');
  }
  return false;
}

/**
 * Where the taxi goes: onto runway 09 by the taxiway nearest the stand. Not
 * the long way west along taxiway A to its end: the base's hangar stands two
 * metres off a 52 m wing there (measured: a C-17 on the taxiway's centre line
 * clears it by 2 m, and one taxied a little off it flew into the hangar). The
 * first turn left off the apron, A2 at Caribou, is a straight run south onto
 * the runway, with 1,950 m of it ahead for the take-off.
 */
function taxiEntry() {
  try {
    const lay = airportLayout();
    const st = Site.transferStand();
    const F = lay.frame;
    const list = lay.connectors || [];
    if (st && list.length) {
      const c = list.slice().sort((a, b) => Math.abs(F.x(a.u) - st.x) - Math.abs(F.x(b.u) - st.x))[0];
      return { x: F.x(c.u), z: F.z(0), id: c.id };
    }
  } catch (e) {
    /* no layout */
  }
  return { x: RUNWAY.thresholdWest.x, z: RUNWAY.thresholdWest.z, id: null };
}

/** On runway 09 and lined up on it, facing east (the way it is flown). */
function linedUp(ctx) {
  const ac = ctx.ac;
  if (!ac.onGround || !isOnAnyRunway(ac.pos.x, ac.pos.z, 0)) return false;
  const want = (AIRPORT && AIRPORT.headingDeg) || 90;
  return Math.abs(((((ac.heading || 0) - want) % 360) + 540) % 360 - 180) < 30;
}

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
  short: 'Fly four Class-D to the Site in the C-17 — and land on ice',
  difficulty: 'Hard',
  icon: '❄',
  map: 'nunatak',
  aircraft: 'c17',
  blurb:
    'The Foundation needs four Class-D personnel moved from Caribou Base to Site-91 North, across the sound, in the C-17. '
    + 'Lower the ramp and the escort walks them up it; then push back, taxi out and fly them over. The Site\'s airstrip '
    + 'is ice and braking action is poor. Taxi to the T by the gate, stop and lower the ramp: they walk to the blast door. '
    + 'You do not.',
  reward: 'Teaches a real departure from a stand — ramp, pushback, taxi — and landing a heavy aeroplane on a slippery surface.',
  // A light wind nearly down both runways (09 at the base, the strip's 09): the ice
  // is the lesson here, not a crosswind on top of it.
  weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 6, windDirDeg: 90 },
  spawn: standStart,
  parTime: 600,
  onStart: (ctx) => {
    ctx.data.boarded = false;
    ctx.data.unloading = false;
    ctx.data.iceStop = null;
    ctx.data.pushes0 = servicesState().pushes;
    // Parked: the parking brake on, as on any stand (power releases it). A C-17 at idle creeps on snow, and
    // crept the 22 m from the stand into the building ahead while its passengers waited to board.
    ctx.ac.parkingBrake = true;
    Site.beginBoarding(ctx.sim);
  },
  tick: (ctx) => {
    // Where the landing roll ran out, for the score: the first time the
    // aeroplane is slow on the ground AFTER the landing step has passed (the
    // taxi step). Measured here and not off any touchdown, because a touchdown
    // anywhere else (a bounce on the take-off roll at the base) must not count.
    const ac = ctx.ac;
    const cur = ctx.runner ? transfer.steps[ctx.runner.stepIndex] : null;
    if (ctx.data.iceStop == null && cur && cur.id === 'gate' && ac.onGround && ac.groundSpeed < 2) {
      ctx.data.iceStop = { x: ac.pos.x, z: ac.pos.z };
    }
  },
  steps: [
    {
      id: 'board',
      text: 'Lower the cargo ramp — press 6, or tap OPEN RAMP — and hold on the stand. The escort is walking four Class-D personnel out to it.',
      hint: 'Parking brake on. They wait at the foot of the ramp until it is right down, and walk up it one at a time.',
      atc: { text: 'Reach two one, Caribou Ground. Hold position on the stand, ramp down when ready, your passengers are walking out now.', voice: 'ground' },
      targetLabel: 'Your stand',
      target: (ctx) => ctx.ac.pos,
      check: (ctx) => {
        rampOrLoadmaster(ctx, 'loweredForBoarding');
        // Every frame of the step (a new flight's start clears it, and the features start after the mission does).
        setServicesHold('The tug waits until your passengers are aboard.');
        const s = Site.transferState();
        if (s && s.phase === 'done' && s.label === 'boarding') {
          ctx.data.boarded = true;
          Site.clearTransfer();
          setServicesHold(null);
          // The loadmaster raises the ramp behind them: the tug will not push an aeroplane with it down.
          const c = cargoOf(ctx.sim);
          if (c) c.close();
          ctx.sim.notify('Four aboard. Ramp coming up.', 'good');
          return true;
        }
        return false;
      },
    },
    {
      id: 'pushback',
      text: 'Push back off the stand. Press P (or tap the prompt) for the ground crew, then P again when they are ready, and the tug pushes you back.',
      hint: 'On a touch screen the GROUND button does the same. Engines running, and keep your hands off the throttle while the tug pushes.',
      atc: { text: 'Reach two one, Caribou Ground, push back approved, call ready to taxi.', voice: 'ground' },
      targetLabel: 'Your stand',
      target: (ctx) => ctx.ac.pos,
      // However the boarding ended (the Dev panel's skip, too): no walk left going and no hold on the tug,
      // which otherwise refused every push for the rest of the flight. A no-op after a real boarding.
      enter: () => {
        Site.clearTransfer();
        setServicesHold(null);
      },
      // A push that has finished. Or, however it got there, the aeroplane well clear of its stand on the ground.
      check: (ctx) => {
        if (servicesState().pushes > (ctx.data.pushes0 || 0)) return true;
        const st = Site.transferStand();
        return !!st && ctx.ac.onGround && flat(ctx.ac.pos, st) > 45;
      },
    },
    {
      id: 'taxi-out',
      text: 'Taxi to runway 09: west along the apron, left at the first taxiway, onto the runway, and line up facing east.',
      hint: 'A little power to get rolling, then let it idle. Steer with A and D, and brake gently — the apron is snow. Swing wide: the wings are 52 m across.',
      get atc() {
        const e = taxiEntry();
        return { text: `Reach two one, taxi to runway zero nine${e.id ? ` via ${e.id.split('').join(' ')}` : ''}, line up and wait.`, voice: 'ground' };
      },
      targetLabel: 'Runway 09',
      target: () => {
        const e = taxiEntry();
        return at(e.x, e.z, 2);
      },
      check: linedUp,
    },
    {
      id: 'depart',
      text: 'All four are aboard. Take off from runway 09 and turn north-east for Sentinel Island.',
      hint: 'Full power (Shift), ease back at about 120 knots, gear up (G) once you are climbing.',
      atc: { text: 'Reach two one, Caribou Tower, cleared for take-off runway zero nine. Site-91 is expecting you.', voice: 'tower' },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdEast,
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'cross',
      text: 'Cross the sound to Sentinel Island. The Site\'s airstrip is the pale line south of the fence. Climb to about 1,500 feet.',
      hint: 'Follow the arrow. The strip is ice: plan to arrive slow, with full flap and the gear down early.',
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
      hint: 'Full flap, as slow as it will fly. On the ground: the reversers (End, twice for full) and the brakes — on ice the reversers do most of the stopping.',
      atc: { text: 'Reach two one, Site-91 Ground. Cleared to land, the strip. Braking action reported POOR. Wind zero nine zero at six.', voice: 'ground' },
      targetLabel: 'Ice strip',
      target: () => stripCentre(),
      check: (ctx) => landedInZone(ctx, [stripZone()], { key: 'ice' }),
    },
    {
      id: 'gate',
      text: 'Taxi to the yellow T by the gate and stop. Gently — the apron is as icy as the strip.',
      hint: 'A touch of power, then let it roll. Brake early; it stops slowly.',
      atc: { text: 'Reach two one, taxi to the gate stand, the T. Stop on the bar, the escort will meet you.', voice: 'ground' },
      targetLabel: 'Gate stand',
      target: () => gatePoint(),
      check: parkedAtGate,
    },
    {
      id: 'handover',
      text: 'Hold position and lower the ramp (6, or OPEN RAMP). The escort walks the Class-D down it to the blast door.',
      hint: 'Parking brake on, and wait. The doors stay shut; nobody goes in but them.',
      targetLabel: 'Blast door',
      target: () => {
        const c = scp();
        return c ? at(c.door.x, c.door.z, 4) : gatePoint();
      },
      check: (ctx) => {
        if (!ctx.data.unloading) {
          if (!rampOrLoadmaster(ctx, 'loweredForHandover')) return false;
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
    ctx.sim.speak('Reach two one, Site-91. Transfer received, four of four. Thank you. You are released; depart when ready.', 'ground');
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
      time: Math.round(20 * scoreFor(ctx.elapsed, transfer.parTime)),
    };
    return Math.max(0, Math.min(100, Object.values(pts).reduce((a, b) => a + b, 0)));
  },
};

export const MISSIONS = [transfer];

/** For the tests: the airfield the mission starts from must be the loaded map's. */
export function startField() {
  return { elev: AIRPORT.elev, runway: AIRPORT.runway };
}

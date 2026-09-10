/**
 * Taxi out.
 *
 * Real flying starts on the apron, not lined up on the runway. This walks you
 * from the parking stand to the holding point and onto runway 09, using the
 * taxiway network that was already painted on the airfield — the parallel
 * taxiway south of the runway and the connector at its western end.
 *
 * Two things stop it being a chore:
 *
 *   The skip button.  One press and you are at the threshold, lined up, engine
 *                     running. Nobody should be forced to taxi to have fun, and
 *                     the button is on screen the whole time you are on the
 *                     ground rather than buried in a menu.
 *   It never fails.   Wander off the paint and you get a nudge, not a failure.
 *                     Taxiing is scene-setting; the flying is the game.
 */

import * as THREE from '../vendor/three.module.js';
import { AIRPORT } from '../world/terrain.js';

const ELEV = AIRPORT.elev;

/**
 * The route, in order. Every point sits on pavement — see `isPaved()` in
 * terrain.js, which defines the same network these follow.
 */
export const TAXI_ROUTE = [
  {
    id: 'stand',
    pos: new THREE.Vector3(-80, ELEV, -150),
    radius: 24,
    text: 'Welcome aboard. Release the brakes with Space and taxi forward.',
    hint: 'A little power — about a quarter — is all you need to get rolling.',
    // You spawn standing on this one, so it completes when you start rolling
    // rather than the instant the run begins.
    requiresRolling: true,
    atc: {
      text: 'Skylark one seven two, Kestrel Ground, taxi to holding point alpha, runway zero nine.',
      voice: 'ground',
    },
  },
  {
    id: 'apron-exit',
    pos: new THREE.Vector3(-140, ELEV, -112),
    radius: 20,
    text: 'Follow the yellow line off the apron and turn onto the taxiway.',
    hint: 'Steer with the rudder pedals — Q and E — not the ailerons.',
  },
  {
    id: 'taxiway',
    pos: new THREE.Vector3(-280, ELEV, -95),
    radius: 22,
    text: 'Taxi west along the taxiway.',
    hint: 'Walking pace on the turns — above about 20 knots you will not make the corner.',
  },
  {
    // The taxiway/connector junction. Without this the route cut the corner
    // diagonally and ran straight across the grass.
    id: 'corner',
    pos: new THREE.Vector3(-430, ELEV, -95),
    radius: 18,
    text: 'Turn right at the end and follow the connector towards the runway.',
    hint: 'Slow down before the turn, then power up again once you are round.',
  },
  {
    id: 'hold-short',
    pos: new THREE.Vector3(-430, ELEV, -44),
    radius: 18,
    text: 'Hold short of runway 09. Stop and check the approach is clear.',
    hint: 'Ease onto the brakes with Space and come to a complete stop.',
    atc: {
      text: 'Skylark one seven two, hold short runway zero nine, traffic on short final.',
      voice: 'ground',
    },
    requiresStop: true,
  },
  {
    id: 'enter',
    pos: new THREE.Vector3(-430, ELEV, -4),
    radius: 16,
    text: 'Cleared to line up. Taxi onto the runway.',
    hint: 'Straight ahead onto the tarmac, then you will turn left down the runway.',
    atc: {
      text: 'Skylark one seven two, runway zero nine, line up and wait.',
      voice: 'tower',
    },
  },
  {
    id: 'line-up',
    pos: new THREE.Vector3(-470, ELEV, 0),
    radius: 22,
    text: 'Turn onto the centreline and straighten up. Full power when you are ready.',
    hint: 'Point the nose down the runway before you open the throttle.',
    atc: {
      text: 'Skylark one seven two, runway zero nine, cleared for take-off. Wind is light and variable.',
      voice: 'tower',
    },
  },
];

/** Where the skip button drops you: the threshold, lined up, ready to go. */
export const RUNWAY_LINEUP = {
  pos: new THREE.Vector3(-470, ELEV, 0),
  headingDeg: 90,
};

export class TaxiRun {
  constructor(sim) {
    this.sim = sim;
    this.active = false;
    this.index = 0;
    this.stoppedFor = 0;
    this.nagTimer = 0;
  }

  /** Park the aeroplane on the stand and begin. */
  start() {
    this.active = true;
    this.index = 0;
    this.stoppedFor = 0;
    this.nagTimer = 0;
    const first = TAXI_ROUTE[0];
    this.sim.aircraft.reset({
      pos: first.pos.clone(),
      headingDeg: 238, // parked facing out, already pointing at the apron exit
      engineOn: true,
    });
    this.sim.aircraft.controls.brakes = 1;
    this.announce(first);
    return this;
  }

  stop() {
    this.active = false;
    this.sim.hud.setTaxi(null);
  }

  get step() {
    return this.active ? TAXI_ROUTE[this.index] : null;
  }

  /** The point the guidance rails should aim at while taxiing. */
  target() {
    const s = this.step;
    return s ? s.pos : null;
  }

  announce(step) {
    if (!step) return;
    this.sim.hud.setTaxi(step.text, step.hint);
    if (step.atc && this.sim.audio && this.sim.audio.available) {
      this.sim.audio.radio.transmit(step.atc.text, { voice: step.atc.voice });
    }
  }

  /** Jump to the runway, lined up. Always available while taxiing. */
  skip() {
    if (!this.active) return false;
    this.sim.aircraft.reset({
      pos: RUNWAY_LINEUP.pos.clone(),
      headingDeg: RUNWAY_LINEUP.headingDeg,
      engineOn: true,
    });
    this.finish(true);
    return true;
  }

  finish(skipped) {
    this.active = false;
    this.sim.hud.setTaxi(null);
    this.sim.hud.notify(
      skipped ? 'Lined up on runway 09 — full power when you are ready' : 'Nicely taxied. Cleared for take-off.',
      'good',
      3.5
    );
  }

  update(dt) {
    if (!this.active) return;
    const ac = this.sim.aircraft;
    const step = this.step;
    if (!step) return;

    // Airborne somehow? Then taxiing is over, however you managed it.
    if (!ac.onGround && ac.agl > 8) {
      this.finish(false);
      return;
    }

    const flat = Math.hypot(ac.pos.x - step.pos.x, ac.pos.z - step.pos.z);
    const stopped = ac.groundSpeed < 1.2;
    this.stoppedFor = stopped ? this.stoppedFor + dt : 0;

    const reached =
      flat < step.radius &&
      (!step.requiresStop || this.stoppedFor > 1.0) &&
      (!step.requiresRolling || ac.groundSpeed > 2.5);
    if (reached) {
      this.index++;
      if (this.index >= TAXI_ROUTE.length) {
        this.finish(false);
        return;
      }
      this.announce(this.step);
      this.nagTimer = 0;
      return;
    }

    // A nudge if you have been sitting still with the brakes on, or have
    // wandered a long way off. Never a failure — this is scene-setting.
    this.nagTimer += dt;
    if (this.nagTimer > 14 && stopped) {
      this.nagTimer = 0;
      this.sim.hud.notify(
        flat > 200
          ? 'Lost? Press "Skip to runway" on the right to jump straight there.'
          : 'Release the brakes with Space and add a little power.',
        'info',
        4
      );
    }
  }
}

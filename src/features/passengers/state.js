/**
 * The people on this flight, shared between the two features that care:
 * passengers.js (boarding, the comfort meter, the cabin) and eject.js (the
 * evacuation: passengers first, then the crew, then you).
 *
 * Neither imports the other — this is the one place both read and write, so
 * the order they load in never matters and a test can look at it directly.
 */

import { Jumpers } from './jumpers.js';
import { groundAt } from '../staff/walk.js';
import { heightAt } from '../../world/terrain.js';

export const PAX = {
  /** This flight carries passengers (an airliner, not Air Force One, not a passenger seat). */
  active: false,
  /** layout.js cabinFor() for the aeroplane being flown. */
  cabin: null,
  /** Booked today, in their seats now, cabin crew aboard. */
  booked: 0,
  aboard: 0,
  crew: 0,
  /** 'gate' (not boarded yet) | 'boarding' | 'ready' (doors shut) | 'flying' | 'arrived' | 'deplaning' | 'off' | 'evac' */
  stage: 'flying',
  /** Out under a canopy this flight, by who. */
  out: { pax: 0, crew: 0 },
  /** You, in an evacuation: '' (aboard) | 'out' (under your canopy) | 'down' (landed). eject.js sets it. */
  pilot: '',
  /** The crowd under parachutes (jumpers.js), made on the first jump. */
  jumpers: null,
  /** The comfort state (comfort.js), for the tests and the summary. */
  comfort: null,
  /**
   * The captain's evacuation line on the PA: passengers.js sets it, eject.js
   * calls it. Here rather than an import of passengers.js from eject.js:
   * that import evaluated the whole of passengers.js (the airport, the
   * apron, the camera, the missions behind them) before eject.js itself, so
   * eject and tpose registered after fun.js — and fun's smoke took T from
   * T-Pose Harrison's spin climb.
   */
  sayEvacuation: null,
};

/** The ground for a parachutist: drawn terrain, sea level at least. */
function groundFor(x, z) {
  const g = groundAt(x, z);
  return Number.isFinite(g) ? Math.max(g, 0) : 0;
}

function waterAt(x, z) {
  return heightAt(x, z) < 0.05;
}

/**
 * One more person out of a door, under a canopy (eject.js's evacuation).
 * `who` 'pax' | 'crew'. Counts them off the aircraft.
 */
export function launchJumper(sim, pos, vel, out, who = 'pax') {
  if (!sim || !sim.scene) return null;
  if (!PAX.jumpers) {
    const max = Math.max(8, (PAX.booked || 0) + (PAX.crew || 0) + 4);
    PAX.jumpers = new Jumpers(sim.scene, max, { ground: groundFor, water: waterAt });
  }
  const j = PAX.jumpers.launch(pos, vel, out, who);
  if (who === 'crew') {
    PAX.crew = Math.max(0, PAX.crew - 1);
    PAX.out.crew++;
  } else {
    PAX.aboard = Math.max(0, PAX.aboard - 1);
    PAX.out.pax++;
  }
  return j;
}

/** Clear the crowd away (a new flight). */
export function clearJumpers() {
  if (PAX.jumpers) PAX.jumpers.dispose();
  PAX.jumpers = null;
  PAX.out.pax = 0;
  PAX.out.crew = 0;
}

/**
 * The airliner evacuation, as a timetable: who goes out of which door when.
 *
 * The owner, 2026-10-01: "in airliners, if you eject, the passengers first
 * fall in parachutes, then cabin crew plus you do". So, in that order and
 * never any other:
 *
 *   'pax'    every passenger, a stream out of the doors — both sides, every
 *            main-deck passenger door and the over-wing exits — at a rate
 *            that empties the cabin in PAX_SECONDS whatever its size (a 40-seat
 *            Meridian and a 555-seat A380 both take about ten seconds; a real
 *            one would take much longer, and nobody wants to watch it) — or,
 *            with Reduce flashing on, no faster than DOOR_RATE_SAFE a door
 *            and TOTAL_RATE_SAFE in all.
 *   'crew'   the cabin crew, once the last passenger is out: one at each of
 *            the front doors, a beat apart.
 *   'pilot'  you, last, out of the front left door — the captain leaves last.
 *   'done'
 *
 * Pure: no THREE, no DOM. `step(dt)` hands back what to release this frame;
 * eject.js turns each release into a person under a canopy. The node test
 * runs whole evacuations through it and checks the order.
 */

/** Seconds for the whole cabin to empty. */
export const PAX_SECONDS = 10;
/** The least and most people out of all the doors together each second. */
const MIN_RATE = 4;
const MAX_RATE = 60;
/**
 * With Reduce flashing on (the default): no door lets out more than this many
 * a second. Four or five a second down the same stretch of sky was a strobe
 * by WCAG's measure (each figure passing a pixel is a there-and-back; more
 * than three a second over a big enough patch is a flash) — the flicker probe
 * put the A320's stream at 11% of a 10-degree field. Under two a second a door
 * is a person every half second or more, about as fast as a real slide takes
 * them, and the A320 empties in about twenty seconds instead of ten.
 */
export const DOOR_RATE_SAFE = 1.8;
/**
 * ...and no more than this many out of all the doors together: every door's
 * stream ends up in the same band of sky behind her, so a 747's ten doors at
 * 1.8 each were still a strobe there. A 747 takes about 45 s, an A380 about a
 * minute — about as long as a real one, which is certified at 90.
 */
export const TOTAL_RATE_SAFE = 8;
/** Between the last passenger and the first crew member, and between crew. */
const CREW_GAP = 0.8;
const CREW_EACH = 0.35;
/** After the last crew member, before you. */
const PILOT_GAP = 1.0;

/** The doors people leave by: passenger doors and over-wing exits, both sides, main deck first. */
export function evacDoors(exits) {
  const list = (exits || []).filter((d) => d && (d.kind === 'passenger' || d.kind === 'overwing'));
  // The main deck first; the upper deck too, where there is one.
  return list.slice().sort((a, b) => (a.deck === 'upper') - (b.deck === 'upper') || a.z - b.z || (a.side === 'left' ? -1 : 1));
}

export class Evacuation {
  /**
   * `pax` passengers, `crew` cabin crew, out of `doors` (evacDoors()).
   * `doorRate`, `maxRate`: the most out of any one door, and out of all of
   * them, a second (DOOR_RATE_SAFE and TOTAL_RATE_SAFE with Reduce flashing
   * on); without them the cabin empties in PAX_SECONDS.
   */
  constructor({ pax = 0, crew = 0, doors = [], doorRate = 0, maxRate = 0 } = {}) {
    this.pax = Math.max(0, Math.round(pax));
    this.crew = Math.max(0, Math.round(crew));
    this.doors = doors.length ? doors : [{ id: 'L1', side: 'left', kind: 'passenger', x: -2, y: 0.3, z: -10, sill: -0.6 }];
    this.paxOut = 0;
    this.crewOut = 0;
    this.pilotOut = false;
    this.phase = this.pax > 0 ? 'pax' : this.crew > 0 ? 'crew' : 'pilot';
    this.t = 0;
    this.phaseT = 0;
    this.rate = Math.max(MIN_RATE, Math.min(MAX_RATE, this.pax / PAX_SECONDS));
    if (doorRate > 0) this.rate = Math.min(this.rate, doorRate * this.doors.length);
    if (maxRate > 0) this.rate = Math.min(this.rate, maxRate);
    this._owed = 0;
    this._door = 0;
    /** Every release in order, for the tests: { who, at, door }. */
    this.log = [];
    // The crew go from the front doors (the ones they sit by).
    const front = this.doors.filter((d) => d.kind === 'passenger' && d.deck !== 'upper').sort((a, b) => a.z - b.z);
    this.crewDoors = front.length ? front.slice(0, 2) : this.doors.slice(0, 1);
    const l1 = this.doors.filter((d) => d.kind === 'passenger' && d.side === 'left' && d.deck !== 'upper').sort((a, b) => a.z - b.z)[0];
    this.pilotDoor = l1 || this.crewDoors[0];
  }

  get done() {
    return this.phase === 'done';
  }

  /** People still aboard, you included until you go. */
  get aboard() {
    return this.pax - this.paxOut + (this.crew - this.crewOut) + (this.pilotOut ? 0 : 1);
  }

  /**
   * Advance by dt. Returns the releases this step: [{ who: 'pax'|'crew'|'pilot', door, index }].
   * Never more than one phase's people in one step, so the order holds at any dt.
   */
  step(dt) {
    const out = [];
    if (this.done || !(dt > 0)) return out;
    this.t += dt;
    this.phaseT += dt;
    if (this.phase === 'pax') {
      this._owed += this.rate * dt;
      while (this._owed >= 1 && this.paxOut < this.pax) {
        this._owed -= 1;
        // Round the doors in turn, so every door has its own stream.
        const door = this.doors[this._door % this.doors.length];
        this._door++;
        out.push(this._release('pax', door, this.paxOut));
        this.paxOut++;
      }
      if (this.paxOut >= this.pax) this._next(this.crew > 0 ? 'crew' : 'pilot');
      return out;
    }
    if (this.phase === 'crew') {
      while (this.crewOut < this.crew && this.phaseT >= CREW_GAP + this.crewOut * CREW_EACH) {
        const door = this.crewDoors[this.crewOut % this.crewDoors.length];
        out.push(this._release('crew', door, this.crewOut));
        this.crewOut++;
      }
      if (this.crewOut >= this.crew) this._next('pilot');
      return out;
    }
    if (this.phase === 'pilot') {
      if (this.phaseT >= (this.crew > 0 ? PILOT_GAP : CREW_GAP)) {
        out.push(this._release('pilot', this.pilotDoor, 0));
        this.pilotOut = true;
        this._next('done');
      }
    }
    return out;
  }

  /** Everybody else out at once (the plane is coming apart): passengers, then crew; you are left for the caller. */
  hurry() {
    const out = [];
    while (this.paxOut < this.pax) {
      const door = this.doors[this._door++ % this.doors.length];
      out.push(this._release('pax', door, this.paxOut++));
    }
    while (this.crewOut < this.crew) out.push(this._release('crew', this.crewDoors[this.crewOut % this.crewDoors.length], this.crewOut++));
    if (this.phase === 'pax' || this.phase === 'crew') this._next('pilot');
    return out;
  }

  _release(who, door, index) {
    const r = { who, door, index, at: this.t };
    this.log.push({ who, at: this.t, door: door && door.id });
    return r;
  }

  _next(phase) {
    this.phase = phase;
    this.phaseT = 0;
  }
}

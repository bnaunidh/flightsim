/**
 * The cabin PA: what the captain and the crew say to the passengers, as
 * subtitles only. No voice — the game's rule is no text-to-speech, and the
 * PA has no recorded voice of its own, so it never makes a sound (the brief:
 * "voice is OFF by default").
 *
 * When to say what is a small state machine over the flight, pure enough for
 * the node test: `pa.update(dt, f)` with f = { stage, onGround, ias (kt),
 * aglM, vsFpm, throttle, gearDown, turb, airborneT, field } returns the line
 * to show now, or null. Each line is said once a flight (the bumps one may
 * come back after the sign has been off again for a while).
 *
 *   welcome    boarding begins
 *   doors      boarding complete, doors shut
 *   takeoff    rolling for take-off
 *   cruise     settled above 3,000 ft: the seatbelt sign goes off
 *   bumps      rough air with the sign off: back to your seats
 *   descent    top of descent: the sign comes back on
 *   landing    gear down and low on the approach
 *   arrived    down and slowing
 *   thanks     getting off at the gate
 *   evac       the captain, as everybody gets out
 */

export const LINES = {
  welcome: 'Good morning and welcome aboard! Please find your seat and pop your bags in the lockers above you.',
  doors: 'Boarding is complete. Cabin crew, doors to automatic and cross-check.',
  takeoff: 'Cabin crew, seats for take-off.',
  cruise: 'This is your captain speaking. We have reached our cruising height, so I have switched the seatbelt sign off. Sit back and enjoy the view!',
  bumps: 'We are expecting a few bumps. Please return to your seats and fasten your seatbelts.',
  descent: 'We have started our descent. Seat backs upright, tables away, and seatbelts on, please.',
  landing: 'Cabin crew, seats for landing.',
  arrived: (f) => `Welcome to ${f.field || 'the island'}! Please stay in your seat with your belt on until we reach the gate.`,
  thanks: 'Thank you for flying with us today. Mind your step, and have a lovely day!',
  evac: 'This is your captain. Everybody out — parachutes on, follow the crew to the doors, one at a time. See you on the ground!',
};

const FT = 3.281;

export class PA {
  constructor() {
    this.reset();
  }

  reset() {
    this.said = new Set();
    this.queue = [];
    this.belt = true;
    this.cruiseT = 0;
    this.descentT = 0;
    this.maxAgl = 0;
    this.offT = 0;
  }

  /** Queue a line by id (once a flight unless `again`). */
  say(id, f = {}, again = false) {
    if (!again && this.said.has(id)) return;
    this.said.add(id);
    const L = LINES[id];
    const text = typeof L === 'function' ? L(f) : L;
    if (text) this.queue.push({ id, text, age: 0 });
    if (id === 'cruise') this.belt = false;
    if (id === 'bumps' || id === 'descent' || id === 'landing' || id === 'takeoff') this.belt = true;
  }

  /** Watch the flight and queue what is due. Returns nothing; read next(). */
  update(dt, f) {
    for (const q of this.queue) q.age += dt;
    // Old lines are dropped rather than said late ("seats for take-off" at 8,000 ft).
    this.queue = this.queue.filter((q) => q.age < 25);
    if (!f || f.stage === 'evac') return;
    const agl = Number(f.aglM) || 0;
    this.maxAgl = Math.max(this.maxAgl, agl);
    if (f.onGround) {
      if (!f.airborneEver && (f.ias || 0) > 30 && (f.throttle || 0) > 0.55) this.say('takeoff', f);
      if (f.airborneEver && (f.ias || 0) < 45 && (f.ias || 0) > 3) this.say('arrived', f);
      return;
    }
    // Settled in the cruise: high enough, and level for a while.
    if (agl * FT > 3000 && Math.abs(f.vsFpm || 0) < 700) this.cruiseT += dt;
    else this.cruiseT = Math.max(0, this.cruiseT - dt * 2);
    if (this.cruiseT > 12 && !this.said.has('descent')) this.say('cruise', f);
    if (!this.belt) this.offT += dt;
    // Rough air with the sign off.
    if (!this.belt && (f.turb || 0) > 0.42 && this.offT > 20) {
      this.offT = 0;
      this.say('bumps', f, true);
    }
    // Top of descent: coming down steadily, after a cruise, or low again after being high.
    if (this.said.has('cruise') || this.maxAgl * FT > 4000) {
      if ((f.vsFpm || 0) < -700) this.descentT += dt;
      else this.descentT = Math.max(0, this.descentT - dt);
      if (this.descentT > 8 || (this.maxAgl * FT > 4000 && agl * FT < 2500)) this.say('descent', f);
    }
    if (f.gearDown && agl * FT < 1500 && (f.vsFpm || 0) < -150 && (this.said.has('descent') || f.airborneT > 40)) this.say('landing', f);
  }

  /** The next line to show, or null. `free`: whether the subtitle line is free. */
  next(free = true) {
    if (!free || !this.queue.length) return null;
    return this.queue.shift();
  }
}

/**
 * Stunts: tricks that score points, for each of the four games.
 *
 *   plane   BARREL ROLL (all the way round), LOOP (over the top and back),
 *           UPSIDE DOWN (3 s), SIDEWAYS (on a wing tip, 2 s), LOW PASS
 *   heli    SPIN (a full turn in a hover), LOW PASS
 *   boat    DONUT (a full circle)
 *   car     DONUT, BIG AIR (a jump)
 *
 * Pure numbers — no THREE, no page — so tests/features/fun.mjs can fly it
 * with made-up attitudes. The game hands it one snapshot a frame (see
 * readSnapshot in ../fun.js) and gets back the stunts that just happened.
 *
 * Two things keep it honest. Every stunt needs air under it (a roll on the
 * runway is a crash, not a trick), and every held stunt has to be let go of
 * before it can score again, so hanging upside down for a minute is one
 * UPSIDE DOWN, not twenty. And a LOOP must go over the top — nose up past
 * 35 degrees and the wings upside down on the way — because a steep turn
 * pulls the nose round just as far and is not a loop.
 *
 * Stunts less than six seconds apart are a COMBO: the second pays double,
 * the third triple, up to five times.
 */

const TAU = Math.PI * 2;

export const STUNTS = {
  roll: { name: 'BARREL ROLL!', points: 200 },
  loop: { name: 'LOOP THE LOOP!', points: 400 },
  upside: { name: 'UPSIDE DOWN!', points: 150 },
  sideways: { name: 'SIDEWAYS!', points: 150 },
  low: { name: 'LOW PASS!', points: 100 },
  spin: { name: 'SPIN!', points: 150 },
  donut: { name: 'DONUT!', points: 150 },
  air: { name: 'BIG AIR!', points: 200 },
};

export const COMBO_WINDOW = 6;
export const MAX_COMBO = 5;

function wrapPi(a) {
  while (a > Math.PI) a -= TAU;
  while (a < -Math.PI) a += TAU;
  return a;
}

export class StuntMeter {
  constructor() {
    this.reset();
  }

  reset() {
    this.t = 0;
    this.total = 0;
    this.combo = 0;
    this.lastAt = -1e9;
    this.roll = 0;
    this.rollQuiet = 0;
    this.pitch = 0;
    this.pitchQuiet = 0;
    this.noseUp = false;
    this.inverted = false;
    this.upsideT = 0;
    this.upsideArmed = true;
    this.sideT = 0;
    this.sideArmed = true;
    this.lowT = 0;
    this.yaw = 0;
    this.yawQuiet = 0;
    this.lastHeading = null;
    this.airT = 0;
    this.events = [];
  }

  /**
   * One frame.
   *
   * s = {
   *   craft: 'plane' | 'heli' | 'boat' | 'car',
   *   airborne,        // off the ground (aircraft) / off the road (car)
   *   height,          // metres above whatever is below: ground or sea
   *   speed,           // m/s
   *   rollRate, pitchRate,   // rad/s, body frame (plane)
   *   upY, noseY,      // world-up of the wings' up / of the nose, -1..1
   *   heading,         // degrees
   *   crashed,
   * }
   * Returns the stunts scored this frame (usually none).
   */
  update(dt, s) {
    this.t += dt;
    const out = this.events;
    out.length = 0;
    if (!s || s.crashed) {
      // A crash ends the combo and anything half done; the score stays.
      this.combo = 0;
      this.roll = this.pitch = this.yaw = 0;
      this.airT = 0;
      return out;
    }
    if (s.craft === 'plane') this.plane(dt, s);
    else if (s.craft === 'heli') this.heli(dt, s);
    else this.ground(dt, s);
    return out;
  }

  score(id) {
    const def = STUNTS[id];
    if (!def) return;
    this.combo = this.t - this.lastAt <= COMBO_WINDOW ? Math.min(MAX_COMBO, this.combo + 1) : 1;
    this.lastAt = this.t;
    const points = def.points * this.combo;
    this.total += points;
    this.events.push({ id, name: def.name, points, combo: this.combo, total: this.total });
  }

  plane(dt, s) {
    const up = s.airborne && s.height > 15;
    // BARREL ROLL: 342 degrees of roll one way, without stopping for long.
    if (up) {
      const r = s.rollRate || 0;
      if (Math.abs(r) < 0.35 || (this.roll && Math.sign(r) !== Math.sign(this.roll))) this.rollQuiet += dt;
      else this.rollQuiet = 0;
      if (this.rollQuiet > 1.2) this.roll = 0;
      this.roll += r * dt;
      if (Math.abs(this.roll) >= TAU * 0.95) {
        this.roll = 0;
        this.score('roll');
      }
    } else {
      this.roll = 0;
    }
    // LOOP: 300 degrees of pitch, over the top.
    if (up) {
      const q = s.pitchRate || 0;
      if (Math.abs(q) < 0.08 || (this.pitch && Math.sign(q) !== Math.sign(this.pitch))) this.pitchQuiet += dt;
      else this.pitchQuiet = 0;
      if (this.pitchQuiet > 2) {
        this.pitch = 0;
        this.noseUp = false;
        this.inverted = false;
      }
      this.pitch += q * dt;
      if (Math.abs(this.pitch) > 0.5) {
        if (s.noseY > 0.57 || s.noseY < -0.57) this.noseUp = true;
        if (s.upY < -0.2) this.inverted = true;
      }
      if (Math.abs(this.pitch) >= (300 / 360) * TAU) {
        const real = this.noseUp && this.inverted;
        this.pitch = 0;
        this.noseUp = false;
        this.inverted = false;
        if (real) this.score('loop');
      }
    } else {
      this.pitch = 0;
      this.noseUp = this.inverted = false;
    }
    // UPSIDE DOWN for three seconds, then right way up again before the next.
    if (up && s.upY < -0.7) {
      this.upsideT += dt;
      if (this.upsideT >= 3 && this.upsideArmed) {
        this.upsideArmed = false;
        this.score('upside');
      }
    } else {
      this.upsideT = 0;
      if (s.upY > 0.3) this.upsideArmed = true;
    }
    // SIDEWAYS: wings vertical, moving, two seconds.
    if (up && Math.abs(s.upY) < 0.26 && s.speed > 25) {
      this.sideT += dt;
      if (this.sideT >= 2 && this.sideArmed) {
        this.sideArmed = false;
        this.score('sideways');
      }
    } else {
      this.sideT = 0;
      if (Math.abs(s.upY) > 0.7) this.sideArmed = true;
    }
    this.lowPass(dt, s, 40);
  }

  heli(dt, s) {
    // SPIN: a full turn on the spot, in the air.
    const hover = s.airborne && s.height > 2 && s.speed < 8;
    this.turn(dt, s, hover, 0.3, 'spin');
    this.lowPass(dt, s, 18);
  }

  ground(dt, s) {
    this.turn(dt, s, Math.abs(s.speed) > 3, 0.2, 'donut');
    if (s.craft === 'car') {
      if (s.airborne) this.airT += dt;
      else {
        if (this.airT >= 0.6) this.score('air');
        this.airT = 0;
      }
    }
  }

  /** A full circle of heading while `ok` holds, turning at least `minRate` rad/s. */
  turn(dt, s, ok, minRate, id) {
    const h = ((s.heading || 0) * Math.PI) / 180;
    const d = this.lastHeading === null ? 0 : wrapPi(h - this.lastHeading);
    this.lastHeading = h;
    if (!ok) {
      this.yaw = 0;
      this.yawQuiet = 0;
      return;
    }
    const rate = dt > 0 ? d / dt : 0;
    if (Math.abs(rate) < minRate || (this.yaw && Math.sign(d) !== Math.sign(this.yaw))) this.yawQuiet += dt;
    else this.yawQuiet = 0;
    if (this.yawQuiet > 1.2) this.yaw = 0;
    this.yaw += d;
    if (Math.abs(this.yaw) >= TAU * 0.97) {
      this.yaw = 0;
      this.score(id);
    }
  }

  /**
   * LOW PASS: under 10 m and fast for a second and a half, and it only
   * counts when you climb away again. That is what keeps every landing from
   * being one — a landing touches down, a low pass pulls up.
   */
  lowPass(dt, s, minSpeed) {
    if (!s.airborne) {
      this.lowT = 0;
      return;
    }
    if (s.height < 10 && s.speed > minSpeed) {
      this.lowT += dt;
    } else if (s.height > 20) {
      if (this.lowT >= 1.5) this.score('low');
      this.lowT = 0;
    }
  }
}

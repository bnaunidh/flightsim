/**
 * A fire as a mission sees it: where it was lit, what it must not reach, the
 * crews' dug line and which side of it matters, the clock until the fire
 * crews arrive, and the moment they take over and finish it.
 *
 * Pure numbers, like grid.js, and for the same reason: this is the part that
 * decides whether a mission can be won, so it has to run in plain node.
 * tests/features/fire.mjs flies every mission's scenario with a scripted
 * pilot through exactly this code — the same ignition, the same preburn, the
 * same mop-up — and the game runs it unchanged every frame.
 *
 * THE CREWS. A fire is never put out cell by cell from the air, and a child
 * should not have to hunt down the last smouldering square. Once the air
 * work has done its job the ground crews take over and the remaining cells
 * go out over a few seconds. "Done its job" is one of:
 *   - progress() >= spec.mopUp (0.85 by default) for 2.5 s, or
 *   - no more than spec.smallLeft cells still burning (4 by default), or
 *   - the crews' clock (spec.holdSeconds) has run out AND nothing is burning
 *     on the protected side of the line (spec.holdNeedsLine).
 * Every one of those also needs a drop that hit the fire in the last four
 * minutes (spec.helpWindow, 240 s): the crews finish a fire somebody is
 * fighting. The clock used to be enough on its own, so on a slow seed a
 * player who never touched the water could win Save Kestrel Town by
 * waiting; and "a hit, ever" let one who dropped a single tank and then
 * circled be handed Night Fire, Night Watch and Ridge Fire in eleven or
 * twelve robot runs of twelve, eight to twenty minutes later, as the fire
 * burnt itself down past the crews' mark. A fire that goes out on its own
 * with nobody on it is lost (game/extra/fire.js), not won.
 *
 * AND THEN THEY HELP. On a line mission the crews will not take over while
 * anything burns on the protected side — but once their clock has run out,
 * and for as long as your water keeps landing on the fire (a hit inside the
 * same four-minute window), they put out one cell of it
 * every few seconds (spec.crewHelp, seconds apiece), the one nearest what
 * they are protecting. They stop when you stop: helping whoever had hit it
 * once at any time let a pilot who dropped one bucket and went home win
 * Line One in all twelve robot runs. Without that, Line One could go on for
 * ever: in one robot run of twelve a spot fire that got going downwind held
 * at twelve to twenty-six cells for thirteen minutes of good drops, every
 * bucket knocking down what had regrown since the last, and the mission
 * ran out at twenty minutes with the player still hitting it.
 */

import { heightAt, MAP } from '../../world/terrain.js';
import { FUEL } from './grid.js';

/** The crews' own splash: small, full strength, and no wet ring. */
const MOP_RADIUS = 5;

const _q = { x: 0, z: 0, k: 0 };
const _n = { x: 0, z: 0 };

/**
 * The nearest good water to the fire at (x, z).
 *
 * For the bucket: the nearest sea at least 60 m from any shore, so the
 * bucket is not dragging in the surf.
 *
 * For a scooping tank: a 1.3 km lane of open water POINTING AT THE FIRE. The
 * lane's far end is the nearest water to the fire; you skim it flying towards
 * the flames, pull up at the shore, and the fire is dead ahead. Real crews
 * scoop into the wind; a ten-year-old needs the fire in front of them when
 * the tank is full, and the lane is only a suggestion — scooping works on any
 * open water, in any direction.
 *
 * Returns { x, z, heading } (heading in radians, compass: +sin, -cos), the
 * middle of the lane or the bucket spot, or null if there is no sea within
 * nine kilometres.
 */
export function findWater(x, z, kind) {
  const deep = (px, pz) => heightAt(px, pz) < -3;
  for (let r = 150; r <= 9000; r += r < 2000 ? 100 : 400) {
    const n = Math.max(16, Math.round((2 * Math.PI * r) / 150));
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      const px = x + Math.sin(ang) * r;
      const pz = z - Math.cos(ang) * r;
      if (!deep(px, pz)) continue;
      if (kind === 'bucket') {
        if (!deep(px + 60, pz) || !deep(px - 60, pz) || !deep(px, pz + 60) || !deep(px, pz - 60)) continue;
        return { x: px, z: pz, heading: Math.atan2(x - px, -(z - pz)) };
      }
      // Towards the fire from here.
      const ux = (x - px) / r;
      const uz = (z - pz) / r;
      let ok = true;
      for (let s = 60; s <= 1300 && ok; s += 80) {
        const qx = px - ux * s;
        const qz = pz - uz * s;
        if (!deep(qx, qz) || !deep(qx - uz * 60, qz + ux * 60) || !deep(qx + uz * 60, qz - ux * 60)) ok = false;
      }
      if (!ok) continue;
      return { x: px - ux * 680, z: pz - uz * 680, heading: Math.atan2(ux, -uz) };
    }
  }
  return null;
}

/** The nearest cell that will burn, within maxR of (x, z), or null. */
export function nearestFuel(grid, x, z, maxR = 400) {
  for (let r = 0; r <= maxR; r += 20) {
    const n = r ? Math.max(8, Math.round(r / 10)) : 1;
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      const px = x + Math.sin(ang) * r;
      const pz = z - Math.cos(ang) * r;
      if (grid.canBurn(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/** Cells along a polyline become a dug fire break — the crews' line. */
export function cutLine(grid, path, halfWidth) {
  if (!path || path.length < 2) return 0;
  let n = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(len / (grid.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const z = a.z + (b.z - a.z) * t;
      for (let dz = -halfWidth; dz <= halfWidth; dz += grid.cell * 0.5) {
        for (let dx = -halfWidth; dx <= halfWidth; dx += grid.cell * 0.5) {
          if (dx * dx + dz * dz > halfWidth * halfWidth) continue;
          const i = grid.indexAt(x + dx, z + dz);
          if (i >= 0 && grid.fuel[i] !== FUEL.NONE) {
            grid.fuel[i] = FUEL.NONE;
            n++;
          }
        }
      }
    }
  }
  return n;
}

/**
 * Which side of a polyline a point is on: +1 or -1, by the nearest segment.
 * Line One's question is "is this fire on the base's side of the break".
 */
export function sideOfLine(path, x, z) {
  let best = Infinity;
  let sgn = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez || 1;
    let t = ((x - a.x) * ex + (z - a.z) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + ex * t - x;
    const qz = a.z + ez * t - z;
    const d = qx * qx + qz * qz;
    if (d < best) {
      best = d;
      sgn = ex * (z - a.z) - ez * (x - a.x) >= 0 ? 1 : -1;
    }
  }
  return sgn;
}

export class FireScenario {
  /** @param {import('./grid.js').FireGrid} grid */
  constructor(grid) {
    this.grid = grid;
    /** Where the crews' splashes went this tick, for the steam. */
    this.mopXs = new Float32Array(8);
    this.mopZs = new Float32Array(8);
    // Made once: fire on the protected side of the line counts five times.
    this._acrossBias = (i) => (sideOfLine(this.line, this.grid.cellX(i), this.grid.cellZ(i)) === this.lineSide ? 5 : 1);
    this.reset();
  }

  /** Where the next drop should go — see FireGrid.dropTarget. */
  dropTarget(out) {
    // A town is saved at the head of the fire. A line is held wherever the
    // fire is against it, which is not only the end nearest the base.
    const front = this.protect && !this.line ? 150 : 0;
    return this.grid.dropTarget(out, this.protect, this.lineSide && this.across > 0 ? this._acrossBias : null, front);
  }

  reset() {
    this.spec = {};
    this.protect = null;
    this.line = null;
    this.lineSide = 0;
    this.across = 0;
    this.reached = false;
    this.mopping = false;
    this.mopT = 0;
    this.holdLeft = 0;
    this.lit = 0;
    this.mopCount = 0;
    this.helping = false;
    /** True on the tick the crews start helping; read and cleared by the caller. */
    this.helpNew = false;
    this.helpT = 0;
    this.hits = 0;
    this.lastHit = -Infinity;
    this.emberT = 0;
    this.embers = 0;
    /** Where the last ember across the line came down, while `emberNew`. */
    this.emberAt = { x: 0, z: 0 };
    this.emberNew = false;
    /** 'crews' on the tick the crews take over; read and cleared by the caller. */
    this.event = null;
  }

  /**
   * Light it, as `spec` says (see setupFire in ../wildfire.js for the fields).
   * `wind` is the air's velocity in m/s; `damp` scales spread in the rain.
   */
  start(spec, { wind = { x: 0, z: 0 }, damp = 1 } = {}) {
    const g = this.grid;
    this.reset();
    this.spec = spec || {};
    const s = this.spec;
    const c = s.centre || (s.ignite && s.ignite[0]) || { x: 0, z: 0 };
    g.setWindow(c.x, c.z);
    g.spreadMul = s.spread ?? 1;
    g.burnMul = s.burn ?? 1;
    g.spotMul = s.spot ?? 1;
    g.damp = damp;
    if (s.line && s.line.path) {
      this.line = s.line.path;
      cutLine(g, s.line.path, (s.line.width || 24) / 2);
    }

    // What must not burn.
    const sc = (MAP && MAP.scenery) || {};
    if (s.protect === 'town' && sc.town) {
      this.protect = { x: sc.town.cx, z: sc.town.cz, r: sc.town.radius * 0.85, name: s.protectName || 'the town' };
    } else if (s.protect && typeof s.protect === 'object') {
      this.protect = { ...s.protect, name: s.protect.name || s.protectName || 'the base' };
    }
    this.lineSide = this.line && this.protect ? sideOfLine(this.line, this.protect.x, this.protect.z) : 0;

    let lit = 0;
    for (const p0 of s.ignite || [c]) {
      let p = p0;
      if (!g.canBurn(p.x, p.z)) p = nearestFuel(g, p.x, p.z) || p;
      lit += g.ignite(p.x, p.z, p0.r || 40);
    }
    // Let it grow before you arrive. Nothing it does here can lose the
    // mission: the protect and line checks only start with the flight.
    const pre = s.preburn || 0;
    for (let t = 0; t < pre; t += 0.5) g.update(0.5, wind);
    this.holdLeft = s.holdSeconds || 0;
    this.emberT = s.embers ? s.embers.first ?? 60 : 0;
    this.lit = lit;
    return lit;
  }

  /**
   * EMBERS ACROSS THE LINE. A line is only a mission if something gets
   * across it, and left to the spread model's own spotting that happened
   * either in the first minute (the fire lit near the line) or after the
   * crews had already arrived (lit further off) — a mission that was hopeless
   * or empty depending on a few hundred metres. So Line One throws them on a
   * timetable (`spec.embers`: first, every, and how far past the line), from
   * the burning cell nearest the break, while the fire is close enough to
   * throw them. They land on the protected side as a small new fire. Ground
   * that a drop has soaked will not take one, which is a thing worth
   * discovering: water on the base side before an ember lands is water well
   * spent.
   */
  throwEmber() {
    const g = this.grid;
    const e = this.spec.embers;
    if (!e || !this.line || !this.lineSide || !g.burning) return false;
    // The burning cell on the far side nearest the break.
    let best = Infinity;
    let bx = 0;
    let bz = 0;
    let bk = 0;
    for (let s = 0; s < g.burning; s++) {
      const i = g.slotCell[s];
      const x = g.cellX(i);
      const z = g.cellZ(i);
      if (sideOfLine(this.line, x, z) === this.lineSide) continue;
      const d = this.distToLine(x, z, _q);
      if (d < best) {
        best = d;
        bx = _q.x;
        bz = _q.z;
        bk = _q.k;
      }
    }
    if (best > (e.reach || 350)) return false;
    // Straight across from there, a random distance, give or take along it.
    const n = this.lineNormal(bk, bx, bz, _n);
    const d = (e.min || 50) + g.rng() * ((e.max || 140) - (e.min || 50));
    const along = (g.rng() - 0.5) * 120;
    const x = bx + n.x * d - n.z * along;
    const z = bz + n.z * d + n.x * along;
    if (sideOfLine(this.line, x, z) !== this.lineSide) return false;
    // Not forced: wet ground turns an ember away.
    const lit = g.ignite(x, z, e.r || 25, false);
    if (!lit) return false;
    this.embers++;
    this.emberAt.x = x;
    this.emberAt.z = z;
    this.emberNew = true;
    return true;
  }

  /**
   * Distance from (x, z) to the line; writes the nearest point on it into
   * `out` (x, z) and which segment that is (k).
   */
  distToLine(x, z, out) {
    const p = this.line;
    let best = Infinity;
    for (let k = 1; k < p.length; k++) {
      const a = p[k - 1];
      const b = p[k];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const l2 = ex * ex + ez * ez || 1;
      let t = ((x - a.x) * ex + (z - a.z) * ez) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = a.x + ex * t;
      const qz = a.z + ez * t;
      const d = (qx - x) * (qx - x) + (qz - z) * (qz - z);
      if (d < best) {
        best = d;
        out.x = qx;
        out.z = qz;
        out.k = k;
      }
    }
    return Math.sqrt(best);
  }

  /** Unit vector across segment k of the line at (x, z), pointing to the protected side. */
  lineNormal(k, x, z, out) {
    const a = this.line[k - 1];
    const b = this.line[k];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l = Math.hypot(ex, ez) || 1;
    out.x = -ez / l;
    out.z = ex / l;
    // Point it at the protected side.
    const probe = sideOfLine(this.line, x + out.x * 30, z + out.z * 30);
    if (probe !== this.lineSide) {
      out.x = -out.x;
      out.z = -out.z;
    }
    return out;
  }

  /**
   * Advance by dt. `hits` is how many drops have hit the fire so far (true
   * and false still work, as one and none). Returns true when the fire
   * ticked (the painter redraws on that).
   */
  update(dt, wind, hits) {
    const g = this.grid;
    this.noteHits(hits === true ? 1 : hits | 0);
    const helped = this.recent;
    if (this.holdLeft > 0) this.holdLeft = Math.max(0, this.holdLeft - dt);
    if (!g.update(dt, wind)) return false;
    const s = this.spec;
    this.mopCount = 0;
    if (this.protect && !this.reached && g.burning) {
      const d = g.nearestBurning(this.protect.x, this.protect.z);
      if (d < this.protect.r + 30) this.reached = true;
    }
    if (s.embers && !this.mopping && this.holdLeft > 0) {
      this.emberT -= 0.5;
      if (this.emberT <= 0) this.emberT = this.throwEmber() ? s.embers.every || 80 : 5;
    }
    if (this.lineSide) this.across = this.countAcross();
    if (!this.mopping && helped && s.crewHelp && s.holdSeconds && this.holdLeft <= 0 && this.across > 0) {
      if (!this.helping) {
        this.helping = true;
        this.helpNew = true;
        this.helpT = 0;
      }
      this.helpT -= 0.5;
      if (this.helpT <= 0) {
        this.helpT = s.crewHelp;
        this.crewHelp();
      }
    }
    if (!this.mopping && g.burning && helped) {
      const clock = s.holdSeconds && this.holdLeft <= 0 && !(s.holdNeedsLine && this.across > 0);
      const thr = s.mopUp ?? 0.85;
      const small = s.smallLeft ?? 4;
      if (clock) {
        this.mopping = true;
        this.event = 'crews';
      } else if (this.progress() >= thr || g.burning <= small) {
        this.mopT += 0.5;
        if (this.mopT >= 2.5) {
          this.mopping = true;
          this.event = 'crews';
        }
      } else {
        this.mopT = 0;
      }
    } else if (!this.mopping) {
      this.mopT = 0;
    }
    if (this.mopping && g.burning) {
      // A tenth of what is left each tick, at least two: a big fire is gone
      // in a few seconds and the last few cells do not linger.
      const n = Math.max(2, Math.ceil(g.burning / 10));
      for (let k = 0; k < n && g.burning; k++) {
        const slot = (g.rng() * g.burning) | 0;
        const i = g.slotCell[slot];
        const x = g.cellX(i);
        const z = g.cellZ(i);
        g.douse(x, z, MOP_RADIUS, 1, 0);
        if (this.mopCount < this.mopXs.length) {
          this.mopXs[this.mopCount] = x;
          this.mopZs[this.mopCount] = z;
          this.mopCount++;
        }
      }
    }
    return true;
  }

  /**
   * The crews put out the burning cell on the protected side nearest what
   * they protect, and soak the cells beside it so it stays out.
   */
  crewHelp() {
    const g = this.grid;
    const p = this.protect;
    let best = Infinity;
    let bi = -1;
    for (let s = 0; s < g.burning; s++) {
      const i = g.slotCell[s];
      const x = g.cellX(i);
      const z = g.cellZ(i);
      if (sideOfLine(this.line, x, z) !== this.lineSide) continue;
      const d = p ? (x - p.x) * (x - p.x) + (z - p.z) * (z - p.z) : 0;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (bi < 0) return false;
    const x = g.cellX(bi);
    const z = g.cellZ(bi);
    g.douse(x, z, MOP_RADIUS, 1, 20);
    if (this.mopCount < this.mopXs.length) {
      this.mopXs[this.mopCount] = x;
      this.mopZs[this.mopCount] = z;
      this.mopCount++;
    }
    this.across = this.countAcross();
    return true;
  }

  /**
   * `n` drops have hit the fire so far. The game says so the moment the water
   * lands, not at its next update: the runner reads the verdict before the
   * plug-ins update, and a drop that put the last flame out must already be
   * a recent hit when it does.
   */
  noteHits(n) {
    if (n > this.hits) {
      this.hits = n;
      this.lastHit = this.grid.time;
    }
  }

  /** A drop has hit the fire in the last spec.helpWindow seconds (240). */
  get recent() {
    return this.hits > 0 && this.grid.time - this.lastHit <= (this.spec.helpWindow || 240);
  }

  countAcross() {
    const g = this.grid;
    let n = 0;
    for (let s = 0; s < g.burning; s++) {
      const i = g.slotCell[s];
      if (sideOfLine(this.line, g.cellX(i), g.cellZ(i)) === this.lineSide) n++;
    }
    return n;
  }

  /**
   * 0..1, how beaten the fire is: the CONTAINED number on the panel, and what
   * the crews wait for (spec.mopUp).
   *
   * It is the better of two things. The firefighters' containment — the
   * share of the burning edge that faces wet or unburnable ground, see
   * grid.js — and how much of the fire YOUR WATER has put out: cells doused
   * by a drop, over those and the ones still burning. Containment alone was
   * the first version, and the robot pilot showed what it looked like from
   * the cockpit: a big fire read 3 %, 0 %, 4 %, 1 % through seven good drops,
   * because each drop holds a short stretch of a long edge, and then the
   * crews took over out of nowhere.
   *
   * The second half was "how far it has come down from the most that was
   * ever alight", and that counted the fire burning itself out as your work.
   * A pilot who hit it once and then circled won Night Fire, Night Watch and
   * Ridge Fire in every one of twelve runs, eight to eighteen minutes later,
   * with the bar climbing the whole time they did nothing. Now it moves when
   * the water lands, and only then.
   */
  progress() {
    const g = this.grid;
    if (!g.burning) return 1;
    const water = g.stats.waterOut;
    const knocked = water > 0 ? water / (water + g.burning) : 0;
    return Math.max(g.contained(), knocked);
  }

  /** Metres from the edge of the protected place to the nearest flame. */
  protectDistance() {
    const g = this.grid;
    if (!this.protect || !g.burning) return Infinity;
    return Math.max(0, g.nearestBurning(this.protect.x, this.protect.z) - this.protect.r);
  }
}

/**
 * AN ADVANCING FIRE FRONT — a wildfire tuned as a chase.
 *
 * The spread model in grid.js is a fire left to itself: it creeps, it runs
 * with the wind and up the hill, and how fast it gets anywhere is a matter of
 * dice. That is right for a fire you fight and wrong for a fire you RACE,
 * where "the smoke closes the pad in two and a half minutes" has to be true
 * on every run and on every machine, and a meter on the screen has to mean
 * something. So a front is a line of fire that walks across the ground at a
 * speed it is given:
 *
 *   - it starts as a line (`from`: two points) and moves along `dir` (or
 *     `toward` a point) at `speed` metres a second;
 *   - the line is a row of COLUMNS, a cell apart, each advancing on its own
 *     with a little scatter so the edge comes out ragged, lighting the cell it
 *     walks into through the grid's own igniteCell() — so the flames, the
 *     smoke, the glow, the scar, the trees charring, the cap on burning cells
 *     and the HUD's numbers are all the ordinary fire's;
 *   - WATER HOLDS IT. A column whose next cell is wet (a drop soaked it — the
 *     grid's six-minute wet ring) stops there until it dries. A drop on the
 *     head of a front holds that stretch of it, which is the whole of
 *     firefighting in one rule;
 *   - rock, sea and road stop a column for good, unless the gap is narrower
 *     than `jump` metres (a running fire throws itself over a track);
 *   - it never lights a cell past the cap's share (`capShare` of maxBurning):
 *     at the cap a front waits rather than breaking the Chromebook's promise.
 *
 * seek(d) lays the ground as if the front had already come `d` metres: spent
 * (black) behind, a band of `band` metres burning at the head. That is how a
 * fire that has burnt all night is there on the first frame of the morning,
 * and how a checkpoint puts the same fire back: save() is a dozen numbers,
 * restore() seeks every column to where it was.
 *
 * Pure numbers, like grid.js and scenario.js: it runs in plain node, and
 * tests/features/fire-front.mjs drives it there.
 */

import { STATE, FUEL } from './grid.js';

/** Same cell, same scatter, always: the ragged edge replays identically. */
function hash01(i, seed) {
  let h = (i * 374761393 + seed * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export class FireFront {
  /**
   * @param {import('./grid.js').FireGrid} grid
   * @param {object} spec
   *   id         a name for the mission to find it by
   *   from       [{x, z}, {x, z}]  the line it starts on
   *   dir        {x, z}            the way it runs (unit or not), or
   *   toward     {x, z}            …towards this point from the line's middle
   *   speed      m/s               (setSpeed() changes it)
   *   scatter    0..1              per-column speed spread (0.15)
   *   band       metres            how deep the burning band is in seek() (60)
 *   life       seconds           how long each cell it lights burns (the grid's own
 *                                fuel life, by default); a slow front needs a long
 *                                one, or its edge burns out between steps and
 *                                there is nothing at the head to put water on
   *   jump       metres            the widest gap of rock or road it throws itself over (30)
   *   maxTravel  metres            it stops this far from the line
   *   capShare   0..1              of the grid's cap it may fill (0.85)
   *   running    false             to build it stopped (start() runs it)
   *   seed       for the scatter
   */
  constructor(grid, spec = {}) {
    this.grid = grid;
    this.spec = spec;
    this.id = spec.id || 'front';
    const a = spec.from && spec.from[0] ? spec.from[0] : { x: 0, z: 0 };
    const b = spec.from && spec.from[1] ? spec.from[1] : { x: a.x + 100, z: a.z };
    let dx;
    let dz;
    if (spec.dir) {
      dx = spec.dir.x;
      dz = spec.dir.z;
    } else if (spec.toward) {
      dx = spec.toward.x - (a.x + b.x) / 2;
      dz = spec.toward.z - (a.z + b.z) / 2;
    } else {
      // Square across the line, to its left.
      dx = -(b.z - a.z);
      dz = b.x - a.x;
    }
    const L = Math.hypot(dx, dz) || 1;
    this.dir = { x: dx / L, z: dz / L };
    this.origin = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    this.speed = Number.isFinite(spec.speed) ? spec.speed : 1;
    this.scatter = spec.scatter ?? 0.15;
    this.band = spec.band ?? 60;
    this.jump = spec.jump ?? 30;
    this.maxTravel = spec.maxTravel ?? Infinity;
    this.capShare = spec.capShare ?? 0.85;
    this.life = Number.isFinite(spec.life) && spec.life > 0 ? spec.life : 0;
    this.running = spec.running !== false;
    this.seed = spec.seed || 11;
    this.t = 0;
    this.litTotal = 0;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    const spacing = spec.spacing || grid.cell * 0.7;
    const n = Math.max(2, Math.ceil(len / spacing) + 1);
    this.cols = [];
    for (let k = 0; k < n; k++) {
      const t = n > 1 ? k / (n - 1) : 0.5;
      this.cols.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        d: 0,
        k: 1 + (hash01(k, this.seed) * 2 - 1) * this.scatter,
        held: false,
        stopped: false,
        why: '',
      });
    }
  }

  start() {
    this.running = true;
    return this;
  }

  stop() {
    this.running = false;
    return this;
  }

  setSpeed(v) {
    if (Number.isFinite(v) && v >= 0) this.speed = v;
    return this;
  }

  /** Where column `c` has got to. */
  pointOf(c, out = { x: 0, z: 0 }) {
    out.x = c.x + this.dir.x * c.d;
    out.z = c.z + this.dir.z * c.d;
    return out;
  }

  /** Columns still able to move (not stopped by rock or the edge of the window). */
  get live() {
    let n = 0;
    for (const c of this.cols) if (!c.stopped) n++;
    return n;
  }

  /** Columns a drop is holding right now. */
  get held() {
    let n = 0;
    for (const c of this.cols) if (c.held && !c.stopped) n++;
    return n;
  }

  /** The furthest any column has come, metres from the line. */
  get travel() {
    let m = 0;
    for (const c of this.cols) if (c.d > m) m = c.d;
    return m;
  }

  /**
   * The head: the column that has come furthest towards `p` (or simply the
   * furthest, without one), as a point. Every live column counts; a stopped
   * one counts where it stopped, because that is still fire.
   */
  lead(p = null, out = { x: 0, z: 0, d: 0, k: -1 }) {
    let best = -Infinity;
    let bk = -1;
    const q = { x: 0, z: 0 };
    for (let k = 0; k < this.cols.length; k++) {
      const c = this.cols[k];
      this.pointOf(c, q);
      const score = p ? -Math.hypot(p.x - q.x, p.z - q.z) : c.d;
      if (score > best) {
        best = score;
        bk = k;
      }
    }
    if (bk < 0) return null;
    this.pointOf(this.cols[bk], out);
    out.d = this.cols[bk].d;
    out.k = bk;
    return out;
  }

  /** Metres from the nearest part of the front to `p`. */
  distanceTo(p) {
    let best = Infinity;
    const q = { x: 0, z: 0 };
    for (const c of this.cols) {
      this.pointOf(c, q);
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < best) best = d;
    }
    return best;
  }

  /**
   * Metres the front still has to run before its head is level with `p`,
   * measured along the way it runs (negative once it is past). The meter a
   * chase is drawn from: a lookout 400 m up the slope from the head reads 400
   * whichever column happens to be nearest it.
   */
  aheadOf(p) {
    const along = (p.x - this.origin.x) * this.dir.x + (p.z - this.origin.z) * this.dir.z;
    return along - this.travel;
  }

  /** Advance. Returns how many cells it lit (the painter redraws on that). */
  update(dt) {
    if (!this.running || !(dt > 0)) return 0;
    const g = this.grid;
    this.t += Math.min(dt, 1);
    let lit = 0;
    for (const c of this.cols) {
      if (c.stopped) continue;
      if (g.burning >= g.maxBurning * this.capShare) break; // wait, never break the cap
      const want = Math.min(this.maxTravel, c.d + this.speed * c.k * Math.min(dt, 1));
      if (want <= c.d) continue;
      lit += this._walk(c, want, true);
    }
    this.litTotal += lit;
    return lit;
  }

  /**
   * Walk column `c` on to `want` metres. `live`: light what it walks into (an
   * update), or lay the ground (a seek: spent behind the band, burning in it).
   */
  _walk(c, want, live, bandFrom = Infinity) {
    const g = this.grid;
    const step = g.cell * 0.5;
    let d = c.d;
    let lit = 0;
    c.held = false;
    while (d < want - 1e-6) {
      const nd = Math.min(want, d + step);
      const x = c.x + this.dir.x * nd;
      const z = c.z + this.dir.z * nd;
      const i = g.indexAt(x, z);
      if (i < 0) {
        c.stopped = true;
        c.why = 'edge';
        break;
      }
      const st = g.state[i];
      if (st === STATE.BURNING || st === STATE.BURNT) {
        d = nd;
        continue;
      }
      if (g.fuelOf(i) === FUEL.NONE) {
        // A gap it can throw itself over, or the end of the road for this column.
        const over = this._across(c, nd);
        if (over < 0) {
          c.stopped = true;
          c.why = 'barrier';
          break;
        }
        d = over - step * 0.999;
        continue;
      }
      if (live) {
        if (g.wet[i] > g.time) {
          c.held = true;
          break;
        }
        if (!g.igniteCell(i, false)) {
          // Refused for the cap (or wet ground the cell had already): try again next frame.
          c.held = g.wet[i] > g.time;
          break;
        }
        this._setLife(i);
        lit++;
      } else if (nd < bandFrom) {
        g.scorchCell(i);
      } else if (g.igniteCell(i, true)) {
        // An established fire, not one just lit: aged by how far behind the head it is.
        this._setLife(i);
        const s = g.slotOf[i];
        if (s >= 0) {
          const behind = Math.max(0, want - nd);
          const frac = this.band > 0 ? Math.min(1, behind / this.band) : 0;
          g.slotAge[s] = g.slotLife[s] * (0.2 + 0.5 * frac);
          g.slotHeat[s] = 1;
        }
        lit++;
      }
      d = nd;
    }
    c.d = Math.max(c.d, d);
    return lit;
  }

  /** A cell this front lit burns for its own `life`, with the grid's ±20 % scatter. */
  _setLife(i) {
    if (!this.life) return;
    const g = this.grid;
    const s = g.slotOf[i];
    if (s >= 0) g.slotLife[s] = this.life * (0.8 + 0.4 * hash01(i, this.seed + 3));
  }

  /** The first burnable distance past a gap starting at `d`, within `jump`, or -1. */
  _across(c, d) {
    const g = this.grid;
    const step = g.cell * 0.5;
    for (let s = d + step; s <= d + this.jump + 1e-6; s += step) {
      const i = g.indexAt(c.x + this.dir.x * s, c.z + this.dir.z * s);
      if (i < 0) return -1;
      if (g.fuelOf(i) !== FUEL.NONE && g.state[i] !== STATE.BURNT) return s;
    }
    return -1;
  }

  /**
   * Lay the ground as if the front had come `d` metres (a number, or one per
   * column): black behind, burning in the last `band` metres. Only ever
   * forwards — a column already past `d` stays where it is.
   */
  seek(d) {
    let lit = 0;
    for (let k = 0; k < this.cols.length; k++) {
      const c = this.cols[k];
      const want = Array.isArray(d) ? d[k] ?? 0 : d * c.k;
      if (!(want > c.d)) continue;
      const stopped = c.stopped;
      c.stopped = false;
      lit += this._walk(c, want, false, want - this.band);
      c.stopped = c.stopped || stopped;
    }
    this.litTotal += lit;
    return lit;
  }

  /** Small plain data for a checkpoint. */
  save() {
    return {
      id: this.id,
      t: Math.round(this.t * 10) / 10,
      speed: this.speed,
      running: this.running,
      d: this.cols.map((c) => Math.round(c.d * 10) / 10),
      stopped: this.cols.map((c) => (c.stopped ? 1 : 0)),
    };
  }

  /** Put a saved front back: every column seeked to where it was. */
  restore(state) {
    if (!state || !Array.isArray(state.d)) return 0;
    this.t = Number.isFinite(state.t) ? state.t : this.t;
    if (Number.isFinite(state.speed)) this.speed = state.speed;
    if (typeof state.running === 'boolean') this.running = state.running;
    const lit = this.seek(state.d);
    // Exactly where each column was (a seek walks in half-cell steps and can stop a few metres short of a barrier).
    this.cols.forEach((c, k) => {
      if (Number.isFinite(state.d[k])) c.d = Math.max(c.d, state.d[k]);
      if (Array.isArray(state.stopped) && state.stopped[k]) c.stopped = true;
    });
    return lit;
  }
}

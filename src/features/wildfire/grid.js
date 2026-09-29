/**
 * The fire itself, as numbers: a square window of ground cut into 20 m cells,
 * each of which is fresh fuel, burning, burnt out or doused.
 *
 * Nothing in here draws anything or touches the DOM, which is the point of it
 * being its own file. The spread, the water and the containment arithmetic
 * are the parts that have to be right, and they can be run in plain node —
 * tests/features/fire.mjs does exactly that — without a page, a canvas or a
 * graphics card. wildfire.js reads this every frame and paints it.
 *
 * WHY A WINDOW AND NOT THE WHOLE MAP. A fire is local. A 320 x 320 window of
 * 20 m cells is 6.4 km on a side, which holds every fire the missions light
 * with room to spare, and it keeps every per-cell array at 100 k entries — a
 * few hundred kilobytes — however big the map is. The largest map is 18 km
 * across; a whole-map grid at this resolution would be 800 k cells for a fire
 * that touches two thousand of them.
 *
 * WHY THE GROUND IS CLASSIFIED LAZILY. Deciding whether a cell will burn costs
 * five height samples (the cell and its slope). Doing that for all 100 k cells
 * when a fire starts is half a second on a school Chromebook — a visible
 * hitch — for cells the fire never reaches. So a cell is classified the first
 * time the fire asks about it and remembered. A big fire asks about a few
 * thousand.
 *
 * THE SPREAD MODEL. Each burning cell, every half second, may light each of
 * its eight neighbours, with a probability that goes up with:
 *   - how hard it is burning (it builds up, holds, and dies back),
 *   - the fuel next door (grass catches faster than standing forest),
 *   - wind blowing from it towards the neighbour: exp(0.22 x the along-wind
 *     component in m/s), so ten metres a second downwind is nine times faster
 *     and upwind a ninth,
 *   - the ground rising towards the neighbour: exp(2.5 x the grade), because
 *     flames lean into the slope above them and pre-heat it,
 *   - a per-cell fuel load from a hash, so the edge comes out ragged instead
 *     of as a perfect diamond.
 * Numbers were fitted in node against the front speeds in fire.mjs, not
 * guessed: calm flat grass creeps at about 0.3 m/s and a 10 m/s wind drives
 * the head along at 2 to 3 m/s. Those are slower than real grass fires on
 * purpose. A real one outruns a lorry; this one has to be catchable by a
 * ten-year-old in a helicopter that takes a minute to fill its bucket.
 *
 * CONTAINMENT is the real firefighters' idea, not "how much is out": every
 * side of a burning cell that faces fresh, dry fuel is an OPEN edge, and every
 * side that faces water-soaked ground, doused ground, rock, road or sea is a
 * HELD edge. Contained is held / (held + open). A fire with water all round
 * its edge is 100 % contained while it is still burning inside, because it
 * cannot go anywhere — which is exactly what the word means on the news.
 */

export const CELL = 20;

export const STATE = { FRESH: 0, BURNING: 1, BURNT: 2, DOUSED: 3 };
export const FUEL = { NONE: 0, GRASS: 1, FOREST: 2, UNKNOWN: 255 };

/** One step of the spread, in seconds of game time. */
export const TICK = 0.5;

/**
 * Per-neighbour ignition rates at full intensity on flat ground in calm air,
 * per second. Fitted — see the header.
 */
const BASE_RATE = [0, 0.009, 0.0065];
/** Seconds a cell burns before it is spent, before the +-30 % scatter. */
const BURN_LIFE = [0, 80, 150];
/**
 * How long water keeps ground from lighting, seconds, at full strength.
 *
 * Six minutes, which is longer than a puddle and about what a line of
 * retardant buys a real crew. It was two and a half, and the robot pilot in
 * tests/features/fire.mjs showed what that meant: a tanker's round trip is
 * about two minutes, so each drop's wet ring dried out just as the next one
 * landed, containment never built past a few percent, and the Big Burn could
 * not be won with nine hits out of nine.
 */
export const WET_SECONDS = 360;

const WIND_K = 0.22;
const SLOPE_K = 2.5;

// The eight neighbours: dx, dz, and 1/distance in cells.
const NX = [1, -1, 0, 0, 1, 1, -1, -1];
const NZ = [0, 0, 1, -1, 1, -1, 1, -1];
const ND = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/** Small, fast, seedable. The fire must replay identically in a test. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer hash to 0..1, for per-cell fuel load. Same cell, same load, always. */
function hash01(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/**
 * @param {object} opts
 *   size        cells on a side (default 320)
 *   cell        metres per cell (default 20)
 *   maxBurning  the cap on cells burning at once
 *   sampler     { classify(x, z) -> FUEL code, height(x, z) -> metres }
 *   seed        for the ignition dice and the fuel-load hash
 */
export class FireGrid {
  constructor({ size = 320, cell = CELL, maxBurning = 900, sampler = null, seed = 1 } = {}) {
    this.size = size;
    this.cell = cell;
    this.n = size * size;
    this.maxBurning = maxBurning;
    this.sampler = sampler;
    this.seed = seed;
    this.state = new Uint8Array(this.n);
    this.fuel = new Uint8Array(this.n).fill(FUEL.UNKNOWN);
    this.height = new Float32Array(this.n).fill(NaN);
    this.wet = new Float32Array(this.n);
    /** Which drop last rolled for this cell — see douse(). */
    this.lastDrop = new Uint16Array(this.n);
    this.lastKnock = new Uint16Array(this.n);
    this.slotOf = new Int32Array(this.n).fill(-1);
    // Burning cells live in slots so a tick walks the fire, not the window.
    const m = maxBurning;
    this.slotCell = new Int32Array(m);
    this.slotAge = new Float32Array(m);
    this.slotLife = new Float32Array(m);
    this.slotHeat = new Float32Array(m);
    this.slotOpen = new Uint8Array(m);
    this.burning = 0;
    this.x0 = 0;
    this.z0 = 0;
    this.cx = 0;
    this.cz = 0;
    this.time = 0;
    this._acc = 0;
    this.spreadMul = 1;
    this.burnMul = 1;
    this.spotMul = 1;
    this.damp = 1;
    this.wind = { x: 0, z: 0 };
    this.stats = { everLit: 0, burntOut: 0, doused: 0, waterOut: 0, wetted: 0, spots: 0, ticks: 0 };
    this.open = 0;
    this.held = 0;
    this.peak = 0;
    /** Cells whose look changed since the painter last asked. */
    this.dirty = true;
    this.dirtyMin = { x: size, z: size };
    this.dirtyMax = { x: -1, z: -1 };
    /** Called with (cellIndex, newState) — trees listen to this. */
    this.onChange = null;
    this.rng = mulberry32(seed);
    this.setWindow(0, 0);
  }

  /** Centre the window here and forget everything. */
  setWindow(cx, cz) {
    const half = (this.size * this.cell) / 2;
    this.cx = cx;
    this.cz = cz;
    this.x0 = cx - half;
    this.z0 = cz - half;
    this.reset();
  }

  reset() {
    this.state.fill(0);
    this.fuel.fill(FUEL.UNKNOWN);
    this.height.fill(NaN);
    this.wet.fill(0);
    this.lastDrop.fill(0);
    this.lastKnock.fill(0);
    this.slotOf.fill(-1);
    this.burning = 0;
    this.time = 0;
    this._acc = 0;
    this.open = 0;
    this.held = 0;
    this.peak = 0;
    this.stats = { everLit: 0, burntOut: 0, doused: 0, waterOut: 0, wetted: 0, spots: 0, ticks: 0 };
    this.rng = mulberry32(this.seed);
    this.markAll();
  }

  markAll() {
    this.dirty = true;
    this.dirtyMin.x = 0;
    this.dirtyMin.z = 0;
    this.dirtyMax.x = this.size - 1;
    this.dirtyMax.z = this.size - 1;
  }

  _mark(ix, iz) {
    this.dirty = true;
    if (ix < this.dirtyMin.x) this.dirtyMin.x = ix;
    if (iz < this.dirtyMin.z) this.dirtyMin.z = iz;
    if (ix > this.dirtyMax.x) this.dirtyMax.x = ix;
    if (iz > this.dirtyMax.z) this.dirtyMax.z = iz;
  }

  clearDirty() {
    this.dirty = false;
    this.dirtyMin.x = this.size;
    this.dirtyMin.z = this.size;
    this.dirtyMax.x = -1;
    this.dirtyMax.z = -1;
  }

  /* ---- coordinates ------------------------------------------------ */

  /** Cell index under a world point, or -1 outside the window. */
  indexAt(x, z) {
    const ix = Math.floor((x - this.x0) / this.cell);
    const iz = Math.floor((z - this.z0) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.size || iz >= this.size) return -1;
    return iz * this.size + ix;
  }

  cellX(i) {
    return this.x0 + ((i % this.size) + 0.5) * this.cell;
  }

  cellZ(i) {
    return this.z0 + (Math.floor(i / this.size) + 0.5) * this.cell;
  }

  inside(x, z) {
    return this.indexAt(x, z) >= 0;
  }

  /* ---- the ground, asked about lazily ------------------------------ */

  fuelOf(i) {
    let f = this.fuel[i];
    if (f === FUEL.UNKNOWN) {
      f = this.sampler ? this.sampler.classify(this.cellX(i), this.cellZ(i)) | 0 : FUEL.GRASS;
      if (f !== FUEL.GRASS && f !== FUEL.FOREST) f = FUEL.NONE;
      this.fuel[i] = f;
    }
    return f;
  }

  heightOf(i) {
    let h = this.height[i];
    if (h !== h) {
      h = this.sampler && this.sampler.height ? this.sampler.height(this.cellX(i), this.cellZ(i)) : 0;
      this.height[i] = h;
    }
    return h;
  }

  /** Fuel load 0.6..1.3, fixed per cell, so the edge comes out ragged. */
  loadOf(i) {
    const ix = i % this.size;
    const iz = (i - ix) / this.size;
    // Two octaves: patches the size of a field and speckle inside them.
    const a = hash01(ix >> 2, iz >> 2, this.seed);
    const b = hash01(ix, iz, this.seed + 7);
    return 0.6 + a * 0.45 + b * 0.25;
  }

  /** Burnable at all — the question the tests ask about water and tarmac. */
  canBurn(x, z) {
    const i = this.indexAt(x, z);
    return i >= 0 && this.fuelOf(i) !== FUEL.NONE;
  }

  /* ---- lighting it --------------------------------------------------- */

  /**
   * Light one cell. Returns true if it caught.
   *
   * Refused for anything that is not fuel, is already burning or spent, is
   * wet, or when the cap is reached. The cap is the promise to the Chromebook:
   * however big the fire gets, the painter never has more than this many
   * burning cells to draw.
   */
  igniteCell(i, force = false) {
    if (i < 0 || i >= this.n) return false;
    const st = this.state[i];
    if (st === STATE.BURNING || st === STATE.BURNT) return false;
    if (!force && this.wet[i] > this.time) return false;
    const f = this.fuelOf(i);
    if (f === FUEL.NONE) return false;
    if (this.burning >= this.maxBurning) return false;
    const s = this.burning++;
    this.slotCell[s] = i;
    this.slotAge[s] = 0;
    const scatter = 0.7 + this.rng() * 0.6;
    // Doused ground that dries and relights has half its fuel left.
    const left = st === STATE.DOUSED ? 0.5 : 1;
    this.slotLife[s] = BURN_LIFE[f] * this.burnMul * scatter * left;
    this.slotHeat[s] = 0.05;
    this.slotOpen[s] = 0;
    this.slotOf[i] = s;
    this.state[i] = STATE.BURNING;
    this.stats.everLit++;
    if (this.burning > this.peak) this.peak = this.burning;
    this._mark(i % this.size, (i / this.size) | 0);
    if (this.onChange) this.onChange(i, STATE.BURNING);
    return true;
  }

  /**
   * The cells whose CENTRES lie within r of (x, z), walked by index. Always
   * includes the cell under the point itself, however small r is — a 5 m
   * mop-up splash on a 20 m cell must still hit that cell.
   */
  _disc(x, z, r, fn) {
    const c = this.cell;
    const size = this.size;
    const ix0 = Math.max(0, Math.floor((x - r - this.x0) / c));
    const ix1 = Math.min(size - 1, Math.floor((x + r - this.x0) / c));
    const iz0 = Math.max(0, Math.floor((z - r - this.z0) / c));
    const iz1 = Math.min(size - 1, Math.floor((z + r - this.z0) / c));
    const own = this.indexAt(x, z);
    const r2 = r * r;
    for (let iz = iz0; iz <= iz1; iz++) {
      const cz = this.z0 + (iz + 0.5) * c - z;
      for (let ix = ix0; ix <= ix1; ix++) {
        const cx = this.x0 + (ix + 0.5) * c - x;
        const i = iz * size + ix;
        const d2 = cx * cx + cz * cz;
        if (d2 > r2 && i !== own) continue;
        fn(i, i === own ? 0 : d2);
      }
    }
  }

  /** Light a disc of ground. Returns how many cells caught. */
  ignite(x, z, radius = 30, force = true) {
    let lit = 0;
    this._disc(x, z, radius, (i) => {
      if (this.igniteCell(i, force)) lit++;
    });
    return lit;
  }

  _removeSlot(s) {
    const i = this.slotCell[s];
    this.slotOf[i] = -1;
    const last = --this.burning;
    if (s !== last) {
      const j = this.slotCell[last];
      this.slotCell[s] = j;
      this.slotAge[s] = this.slotAge[last];
      this.slotLife[s] = this.slotLife[last];
      this.slotHeat[s] = this.slotHeat[last];
      this.slotOpen[s] = this.slotOpen[last];
      this.slotOf[j] = s;
    }
  }

  /* ---- water --------------------------------------------------------- */

  /**
   * Water on the ground, in a disc.
   *
   * Burning cells inside `radius` go out (with probability `strength`, so a
   * drop from too high only knocks some of them down). Every fuel cell inside
   * `radius + margin` is soaked and will not light for WET_SECONDS x strength.
   * The margin is what makes a drop on the edge of a fire hold that edge:
   * the fire goes out where it lands AND cannot creep into the wet ring round
   * it.
   *
   * Returns { doused, wetted, cells } — `cells` so the painter can steam
   * where it actually went out.
   */
  douse(x, z, radius, strength = 1, margin = 16, out = null, dropId = 0) {
    const res = out || { doused: 0, wetted: 0, count: 0, xs: null, zs: null };
    const wetUntil = this.time + WET_SECONDS * Math.max(0.2, strength);
    const rr = radius * radius;
    this._disc(x, z, radius + margin, (i, d2) => {
      const st = this.state[i];
      if (st === STATE.BURNT) return;
      // Nothing to soak on rock and road, and asking costs a classification.
      if (st === STATE.FRESH && this.fuelOf(i) === FUEL.NONE) return;
      if (this.wet[i] < wetUntil) this.wet[i] = wetUntil;
      const ix = i % this.size;
      const iz = (i - ix) / this.size;
      this._mark(ix, iz);
      if (st !== STATE.BURNING) {
        this.stats.wetted++;
        res.wetted++;
        return;
      }
      if (d2 > rr) {
        // The edge of a drop does not put a fire out, but it knocks it down:
        // half its remaining life gone, which drops it into the dying-back
        // part of its curve where it barely spreads.
        const s = this.slotOf[i];
        if (s >= 0 && (!dropId || this.lastKnock[i] !== dropId)) {
          if (dropId) this.lastKnock[i] = dropId;
          const age = this.slotAge[s];
          this.slotAge[s] = age + (this.slotLife[s] - age) * 0.5 * strength;
        }
        return;
      }
      // One roll per cell per drop: a bucket is fifteen parcels landing in
      // the same place, and fifteen rolls at a third would put out nearly
      // everything a drop from too high was meant to miss.
      if (dropId) {
        if (this.lastDrop[i] === dropId) return;
        this.lastDrop[i] = dropId;
      }
      if (this.rng() >= strength) return;
      const s = this.slotOf[i];
      if (s >= 0) this._removeSlot(s);
      this.state[i] = STATE.DOUSED;
      this.stats.doused++;
      // Put out by a drop, as against by the crews on the ground.
      if (dropId) this.stats.waterOut++;
      res.doused++;
      if (res.xs && res.count < res.xs.length) {
        res.xs[res.count] = this.cellX(i);
        res.zs[res.count] = this.cellZ(i);
        res.count++;
      }
      if (this.onChange) this.onChange(i, STATE.DOUSED);
    });
    return res;
  }

  /** Put every flame out, at once. The ground crews' mop-up, and a dev button. */
  extinguishAll(asDoused = true) {
    while (this.burning > 0) {
      const s = this.burning - 1;
      const i = this.slotCell[s];
      this._removeSlot(s);
      this.state[i] = asDoused ? STATE.DOUSED : STATE.BURNT;
      if (this.wet[i] < this.time + WET_SECONDS) this.wet[i] = this.time + WET_SECONDS;
      this._mark(i % this.size, (i / this.size) | 0);
      if (this.onChange) this.onChange(i, this.state[i]);
    }
  }

  /* ---- time ---------------------------------------------------------- */

  /**
   * Advance by dt seconds. The spread runs in fixed half-second ticks so a
   * 30 fps Chromebook and a 120 Hz iPad burn identically.
   *
   * @param {number} dt
   * @param {{x:number,z:number}} wind  m/s, the way the air is MOVING
   */
  update(dt, wind) {
    if (wind) {
      this.wind.x = wind.x;
      this.wind.z = wind.z;
    }
    this._acc += Math.min(dt, 1);
    let ticked = false;
    while (this._acc >= TICK) {
      this._acc -= TICK;
      this.time += TICK;
      this._tick();
      ticked = true;
    }
    return ticked;
  }

  _tick() {
    const size = this.size;
    const T = TICK;
    const wx = this.wind.x;
    const wz = this.wind.z;
    const wspeed = Math.hypot(wx, wz);
    this.stats.ticks++;
    let open = 0;
    let held = 0;
    // Walk backwards so a burnt-out slot can be swapped out from under us.
    for (let s = this.burning - 1; s >= 0; s--) {
      const i = this.slotCell[s];
      let age = this.slotAge[s] + T;
      this.slotAge[s] = age;
      const life = this.slotLife[s];
      if (age >= life) {
        this._removeSlot(s);
        this.state[i] = STATE.BURNT;
        this.stats.burntOut++;
        const ix = i % size;
        this._mark(ix, (i - ix) / size);
        if (this.onChange) this.onChange(i, STATE.BURNT);
        continue;
      }
      // Builds over the first fifth, holds, dies back over the last third.
      const f = age / life;
      let heat = f < 0.2 ? f / 0.2 : f > 0.66 ? (1 - f) / 0.34 : 1;
      heat = heat < 0.05 ? 0.05 : heat;
      this.slotHeat[s] = heat;
      const ix = i % size;
      const iz = (i - ix) / size;
      const fuelHere = this.fuel[i];
      const hHere = this.heightOf(i);
      let openHere = 0;
      for (let k = 0; k < 8; k++) {
        const jx = ix + NX[k];
        const jz = iz + NZ[k];
        if (jx < 0 || jz < 0 || jx >= size || jz >= size) continue;
        const j = jz * size + jx;
        const st = this.state[j];
        if (st === STATE.BURNING || st === STATE.BURNT) continue;
        const fj = this.fuelOf(j);
        if (fj === FUEL.NONE) {
          held++;
          continue;
        }
        if (this.wet[j] > this.time) {
          held++;
          continue;
        }
        open++;
        openHere++;
        if (heat < 0.2) continue;
        // Wind along the direction of spread, m/s.
        const inv = 1 / ND[k];
        const along = (wx * NX[k] + wz * NZ[k]) * inv;
        let windF = Math.exp(WIND_K * along);
        if (windF > 12) windF = 12;
        const grade = (this.heightOf(j) - hHere) / (this.cell * ND[k]);
        let slopeF = Math.exp(SLOPE_K * grade);
        if (slopeF < 0.3) slopeF = 0.3;
        else if (slopeF > 4) slopeF = 4;
        let rate = BASE_RATE[fj] * this.spreadMul * this.damp * heat * windF * slopeF * this.loadOf(j) * inv;
        if (st === STATE.DOUSED) rate *= 0.5;
        const p = 1 - Math.exp(-rate * T);
        if (this.rng() < p) this.igniteCell(j);
      }
      this.slotOpen[s] = openHere;
      // Embers: a forest fire in a wind throws burning bark ahead of itself.
      if (fuelHere === FUEL.FOREST && wspeed > 5 && heat > 0.7 && this.spotMul > 0) {
        const pSpot = 0.00045 * ((wspeed - 5) / 5) * this.spotMul * T;
        if (this.rng() < pSpot && this.burning < this.maxBurning * 0.8) {
          const dist = 60 + this.rng() * 140;
          const sx = this.cellX(i) + (wx / wspeed) * dist + (this.rng() - 0.5) * 40;
          const sz = this.cellZ(i) + (wz / wspeed) * dist + (this.rng() - 0.5) * 40;
          const j = this.indexAt(sx, sz);
          if (j >= 0 && this.state[j] === STATE.FRESH && this.igniteCell(j)) this.stats.spots++;
        }
      }
    }
    this.open = open;
    this.held = held;
    // Heat changes the glow even when no cell changed state.
    if (this.burning > 0) this.dirty = true;
  }

  /* ---- what the HUD and the missions ask ---------------------------- */

  /** 0..1. See the header: held edges over all edges, and 1 with no fire. */
  contained() {
    if (this.burning === 0) return 1;
    const t = this.open + this.held;
    if (t === 0) return 1;
    return this.held / t;
  }

  /** True when nothing at all is burning. */
  get out() {
    return this.burning === 0;
  }

  /**
   * Distance from a point to the nearest burning cell, metres (Infinity if
   * none). The town check and the "fire is near the base" warning.
   */
  nearestBurning(x, z, out = null) {
    let best = Infinity;
    let bi = -1;
    for (let s = 0; s < this.burning; s++) {
      const i = this.slotCell[s];
      const dx = this.cellX(i) - x;
      const dz = this.cellZ(i) - z;
      const d = dx * dx + dz * dz;
      if (d < best) {
        best = d;
        bi = i;
      }
    }
    if (out && bi >= 0) {
      out.x = this.cellX(bi);
      out.z = this.cellZ(bi);
    }
    return Math.sqrt(best);
  }

  /** Centre of everything burning, or null. */
  centroid(out) {
    if (!this.burning) return null;
    let sx = 0;
    let sz = 0;
    for (let s = 0; s < this.burning; s++) {
      const i = this.slotCell[s];
      sx += this.cellX(i);
      sz += this.cellZ(i);
    }
    out.x = sx / this.burning;
    out.z = sz / this.burning;
    return out;
  }

  /**
   * Where the next drop should go: the stretch of open edge that matters
   * most. With something to protect it is the edge nearest that; without,
   * it is the head of the fire, the part running downwind. `bias(cell)`, if
   * given, multiplies a cell's claim — Line One uses it for fire that has
   * jumped the break. `front`, in metres, narrows "nearest that" down to the
   * head itself: the town missions pass 150.
   *
   * The best single cell would make the arrow jitter from tick to tick, so
   * the answer is the open-edge-weighted middle of everything within 90 m of
   * the best cell — a place, not a pixel.
   */
  dropTarget(out, protect = null, bias = null, front = 0) {
    if (!this.burning) return null;
    let cx = 0;
    let cz = 0;
    let near = Infinity;
    for (let s = 0; s < this.burning; s++) {
      const i = this.slotCell[s];
      const x = this.cellX(i);
      const z = this.cellZ(i);
      cx += x;
      cz += z;
      if (protect) {
        const d = Math.hypot(x - protect.x, z - protect.z);
        if (d < near) near = d;
      }
    }
    cx /= this.burning;
    cz /= this.burning;
    const w = Math.hypot(this.wind.x, this.wind.z) || 1;
    const ux = this.wind.x / w;
    const uz = this.wind.z / w;
    let best = -1;
    let bestScore = -Infinity;
    for (let s = 0; s < this.burning; s++) {
      const o = this.slotOpen[s];
      const i = this.slotCell[s];
      const x = this.cellX(i);
      const z = this.cellZ(i);
      let score = o + 0.25;
      if (bias) score *= bias(i);
      if (protect && front > 0) {
        /*
         * The front: the burning nearest the town, and what is within
         * `front` metres or so of it. Without this the town missions used
         * the gentle pull below, which with the town 300 to 700 m off gave
         * the nearest cell 3.6 and the far end of the fire 3.2 — nothing,
         * next to a cell's open-edge count — so on Save Kestrel Town the
         * arrow pointed 150 to 340 m behind the head, the robot pilot's
         * drops landed on the flank, and two runs in twelve lost the town
         * with every drop a hit.
         */
        const d = Math.hypot(x - protect.x, z - protect.z);
        score *= Math.exp(-(d - near) / front);
      } else if (protect) {
        const d = Math.hypot(x - protect.x, z - protect.z);
        score *= 1 + 3 * Math.max(0, 1 - d / 2500);
      } else {
        const ax = x - cx;
        const az = z - cz;
        const l = Math.hypot(ax, az) || 1;
        score *= 1.2 + (ax * ux + az * uz) / l;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    }
    const bx = this.cellX(best);
    const bz = this.cellZ(best);
    let sx = 0;
    let sz = 0;
    let sw = 0;
    for (let s = 0; s < this.burning; s++) {
      const i = this.slotCell[s];
      const x = this.cellX(i);
      const z = this.cellZ(i);
      if ((x - bx) * (x - bx) + (z - bz) * (z - bz) > 90 * 90) continue;
      const wgt = this.slotOpen[s] + 0.25;
      sx += x * wgt;
      sz += z * wgt;
      sw += wgt;
    }
    out.x = sx / sw;
    out.z = sz / sw;
    return out;
  }
}

/**
 * The live map's base chart: a pyramid of 256-pixel tiles, rendered once per
 * zoom level and kept, so panning and zooming are drawImage calls and the
 * sim never waits for a height sample.
 *
 *   level 0   one tile for the whole map (the world square, `box`)
 *   level L   2^L × 2^L tiles, each half the size of the level above
 *
 * The level drawn is the first whose pixels are no bigger than the screen's
 * (a little upscale allowed: levelFor), so the chart is always about one
 * chart pixel per screen pixel — sharp at every zoom, and the further you
 * zoom in the more detail there is (contours appear under 25 m a pixel).
 * A tile not ready yet is drawn from the nearest finished level above it,
 * then fades in over a quarter of a second: no blank squares, no pop.
 *
 * WHO DRAWS A TILE. A module worker (chart-worker.js), when the browser has
 * one: the frame loop then pays one putImageData per finished tile and
 * nothing else. Without one (an old browser, file://), the main thread
 * builds them in slices under a time budget per frame, like the minimap's
 * chart (Low: 1.5 ms, otherwise 3 ms), so the sim never stutters for it.
 *
 * Cost on Low: tiles in flight one at a time, a smaller cache, and the
 * sharpest level stops at 12 m a pixel instead of 6.
 */

import { chartStyle, shadeRows, sampleRows, shadeTile } from './shade.js';
import { iceShapes } from '../../ui/chart-palette.js';

export const TILE_PX = 256;
const FADE_S = 0.25;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Per tier: tiles kept, tiles in flight, the finest metres a pixel, main-thread ms a frame. */
export const CHART_TIER = Object.freeze({
  low: { cache: 56, inflight: 1, minStep: 12, budgetMs: 1.5 },
  medium: { cache: 110, inflight: 2, minStep: 6, budgetMs: 3 },
  high: { cache: 160, inflight: 2, minStep: 6, budgetMs: 3 },
  ultra: { cache: 200, inflight: 3, minStep: 4, budgetMs: 3 },
});

/** The level to draw for `s` CSS pixels a metre: the first at least as sharp as the screen (a 1.19x upscale allowed). */
export function levelFor(size, s, dpr, maxLevel) {
  const want = (size * s * (dpr || 1)) / TILE_PX;
  if (!(want > 1)) return 0;
  return clamp(Math.ceil(Math.log2(want) - 0.25), 0, maxLevel);
}

/** The deepest level worth building for a world this size at this finest step. */
export function maxLevelFor(size, minStep) {
  return clamp(Math.floor(Math.log2(size / (TILE_PX * minStep))), 0, 12);
}

let SHARED = null;
let SHARED_DEAD = false;
function sharedWorker() {
  if (SHARED || SHARED_DEAD) return SHARED;
  try {
    if (typeof Worker === 'function' && typeof window !== 'undefined') {
      SHARED = new Worker(new URL('./chart-worker.js', import.meta.url), { type: 'module' });
    }
  } catch (e) {
    SHARED = null;
    SHARED_DEAD = true;
  }
  return SHARED;
}

let SEQ = 0;

function plain(def) {
  return JSON.parse(JSON.stringify(def, (k, v) => (k.startsWith('_') ? undefined : v)));
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export class ChartTiles {
  /**
   * @param {object} o
   *   box       { x0, z0, size } the world square the pyramid covers
   *   heightAt  the game's height function (the main-thread fallback)
   *   def       the map definition (sent to the worker)
   *   palette   the map's palette
   *   flats     the map's level ground (frozen lakes, ice strips)
   *   quality   'low' | 'medium' | 'high' | 'ultra'
   *   worker    false to never use one (tests)
   */
  constructor(o) {
    this.box = o.box;
    this.heightAt = o.heightAt;
    this.tier = CHART_TIER[o.quality] || CHART_TIER.medium;
    this.style = chartStyle(o.palette);
    // The open sea past the pyramid, the colour the chart gives this map's sea floor (no seam at its edge).
    const sea = shadeTile(() => (Number.isFinite(o.seaFloor) ? o.seaFloor : -60), 0, 0, 50, 1, this.style);
    this.openSea = `rgb(${sea[0]},${sea[1]},${sea[2]})`;
    this.ice = iceShapes(o.flats || []);
    this.maxLevel = maxLevelFor(this.box.size, this.tier.minStep);
    this.tiles = new Map();
    this.wanted = [];
    this.inflight = new Map();
    this.jobs = [];
    this.stamp = 0;
    this.clock = 0;
    this.stats = { built: 0, worker: 0, main: 0, evicted: 0, mainMs: 0 };
    this.seq = ++SEQ;
    this.worker = o.worker === false ? null : sharedWorker();
    this.workerReady = false;
    if (this.worker) {
      this._onMsg = (ev) => this.onMessage(ev.data);
      this._onErr = () => {
        SHARED_DEAD = true;
        this.abandonWorker();
      };
      this.worker.addEventListener('message', this._onMsg);
      this.worker.addEventListener('error', this._onErr);
      try {
        this.worker.postMessage({ op: 'init', seq: this.seq, def: plain(o.def), style: this.style });
      } catch (e) {
        this.abandonWorker();
      }
    }
  }

  dispose() {
    if (this.worker) {
      this.worker.removeEventListener('message', this._onMsg);
      this.worker.removeEventListener('error', this._onErr);
    }
    this.worker = null;
    this.tiles.clear();
    this.jobs = [];
    this.inflight.clear();
  }

  abandonWorker() {
    if (this.worker) {
      this.worker.removeEventListener('message', this._onMsg);
      this.worker.removeEventListener('error', this._onErr);
    }
    this.worker = null;
    // What it still owed goes back on the list.
    this.inflight.clear();
  }

  /** The world square of tile (L, i, j). */
  rect(L, i, j) {
    const size = this.box.size / (1 << L);
    return { x0: this.box.x0 + i * size, z0: this.box.z0 + j * size, size };
  }

  key(L, i, j) {
    return `${L}/${i}/${j}`;
  }

  /** The tiles a view wants, at the level it wants, most central first (plus the overview above them). */
  want(view) {
    const L = levelFor(this.box.size, view.s, view.dpr, this.maxLevel);
    const n = 1 << L;
    const size = this.box.size / n;
    const halfW = view.W / 2 / view.s;
    const halfH = view.H / 2 / view.s;
    const i0 = clamp(Math.floor((view.cx - halfW - this.box.x0) / size), 0, n - 1);
    const i1 = clamp(Math.floor((view.cx + halfW - this.box.x0) / size), 0, n - 1);
    const j0 = clamp(Math.floor((view.cz - halfH - this.box.z0) / size), 0, n - 1);
    const j1 = clamp(Math.floor((view.cz + halfH - this.box.z0) / size), 0, n - 1);
    const list = [];
    // The overview first, always: it is what every missing tile falls back to.
    list.push({ L: 0, i: 0, j: 0, d: -2 });
    if (L >= 3) {
      // ...and a middle level under the view, so a deep zoom never shows the 1-tile overview for long.
      const M = Math.max(1, L - 2);
      const m = 1 << M;
      const ms = this.box.size / m;
      const mi = clamp(Math.floor((view.cx - this.box.x0) / ms), 0, m - 1);
      const mj = clamp(Math.floor((view.cz - this.box.z0) / ms), 0, m - 1);
      list.push({ L: M, i: mi, j: mj, d: -1 });
    }
    const ci = (view.cx - this.box.x0) / size - 0.5;
    const cj = (view.cz - this.box.z0) / size - 0.5;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) list.push({ L, i, j, d: Math.hypot(i - ci, j - cj) });
    list.sort((a, b) => a.d - b.d);
    this.wanted = list;
    this.level = L;
    return { L, i0, i1, j0, j1 };
  }

  /**
   * Do some building: post the next tiles to the worker (a few in flight), or
   * without one, build on this thread for at most the tier's budget.
   */
  pump(dt = 0, budgetMs = this.tier.budgetMs) {
    this.clock += dt;
    for (const w of this.wanted) {
      const k = this.key(w.L, w.i, w.j);
      if (this.tiles.has(k) || this.inflight.has(k) || this.jobs.some((j) => j.key === k)) continue;
      if (this.worker) {
        if (this.inflight.size >= this.tier.inflight) break;
        const r = this.rect(w.L, w.i, w.j);
        const step = r.size / TILE_PX;
        this.inflight.set(k, { L: w.L, i: w.i, j: w.j, t: now() });
        try {
          this.worker.postMessage({ op: 'tile', seq: this.seq, key: k, x0: r.x0 + step / 2, z0: r.z0 + step / 2, step, n: TILE_PX });
        } catch (e) {
          this.abandonWorker();
          break;
        }
      } else {
        if (this.jobs.length >= 2) break;
        this.jobs.push(this.makeJob(w.L, w.i, w.j));
      }
    }
    // A worker that has gone silent for 8 s on a tile is not coming back.
    if (this.worker) {
      for (const [k, f] of this.inflight) if (now() - f.t > 8000) this.inflight.delete(k);
    }
    if (this.jobs.length) this.workJobs(budgetMs);
  }

  makeJob(L, i, j) {
    const r = this.rect(L, i, j);
    const n = TILE_PX;
    const step = r.size / n;
    return {
      key: this.key(L, i, j), L, i, j, n, step,
      x0: r.x0 + step / 2, z0: r.z0 + step / 2,
      H: new Float32Array((n + 2) * (n + 2)),
      out: new Uint8ClampedArray(n * n * 4),
      sampled: 0, shaded: 0,
    };
  }

  /** The main thread's share: sample rows, shade the rows whose neighbours are in, under the budget. */
  workJobs(budgetMs) {
    const t0 = now();
    while (this.jobs.length) {
      const job = this.jobs[0];
      const rows = job.n + 2;
      while (job.sampled < rows) {
        sampleRows(this.heightAt, job.x0, job.z0, job.step, job.n, job.H, job.sampled, job.sampled + 1);
        job.sampled++;
        const can = Math.min(job.n, job.sampled - 2);
        if (can > job.shaded) {
          shadeRows(job.H, job.n, job.step, this.style, job.out, job.shaded, can, { ice: this.ice, x0: job.x0, z0: job.z0 });
          job.shaded = can;
        }
        if (now() - t0 > budgetMs) break;
      }
      if (job.shaded >= job.n) {
        this.jobs.shift();
        this.finish(job.key, job.L, job.out, 'main');
      }
      if (now() - t0 > budgetMs) break;
    }
    this.stats.mainMs += now() - t0;
  }

  onMessage(m) {
    if (!m || m.op !== 'tile' || m.seq !== this.seq) return;
    const f = this.inflight.get(m.key);
    this.inflight.delete(m.key);
    if (m.error) {
      this.abandonWorker();
      return;
    }
    if (m.stale || !m.rgba || !f) return;
    this.finish(m.key, f.L, m.rgba, 'worker');
  }

  /** A finished tile onto its canvas, into the cache. */
  finish(key, L, rgba, who) {
    if (typeof document === 'undefined') return;
    const c = document.createElement('canvas');
    c.width = c.height = TILE_PX;
    const g = c.getContext('2d');
    if (!g) return;
    try {
      const im = typeof ImageData === 'function' ? new ImageData(new Uint8ClampedArray(rgba.buffer, rgba.byteOffset, TILE_PX * TILE_PX * 4), TILE_PX, TILE_PX) : null;
      if (im) g.putImageData(im, 0, 0);
    } catch (e) {
      return;
    }
    this.tiles.set(key, { canvas: c, L, born: this.clock, used: ++this.stamp });
    this.stats.built++;
    this.stats[who]++;
    this.evict();
  }

  evict() {
    const cap = this.tier.cache;
    if (this.tiles.size <= cap) return;
    const keep = new Set(this.wanted.map((w) => this.key(w.L, w.i, w.j)));
    const list = [...this.tiles.entries()].filter(([k, t]) => t.L > 1 && !keep.has(k)).sort((a, b) => a[1].used - b[1].used);
    while (this.tiles.size > cap && list.length) {
      this.tiles.delete(list.shift()[0]);
      this.stats.evicted++;
    }
  }

  /** The nearest finished ancestor of (L, i, j) and the part of it that covers the tile. */
  ancestor(L, i, j) {
    for (let up = 1; up <= L; up++) {
      const A = L - up;
      const ai = i >> up;
      const aj = j >> up;
      const t = this.tiles.get(this.key(A, ai, aj));
      if (!t) continue;
      const k = 1 << up;
      const sub = TILE_PX / k;
      return { t, sx: (i - ai * k) * sub, sy: (j - aj * k) * sub, sw: sub };
    }
    return null;
  }

  /** Has the view something sharp under all of it yet? (the tests, the "loading" hint) */
  readyFor(view) {
    const r = this.want(view);
    for (let j = r.j0; j <= r.j1; j++) for (let i = r.i0; i <= r.i1; i++) if (!this.tiles.has(this.key(r.L, i, j))) return false;
    return true;
  }

  /**
   * Draw the chart for a view into a 2D context already scaled to CSS pixels.
   * @returns {number} tiles drawn sharp
   */
  draw(g, view) {
    const r = this.want(view);
    const L = r.L;
    const size = this.box.size / (1 << L);
    const px = size * view.s;
    const X = (x) => view.W / 2 + (x - view.cx) * view.s;
    const Z = (z) => view.H / 2 + (z - view.cz) * view.s;
    // The sea beyond the pyramid: the colour of this map's open sea.
    g.fillStyle = this.openSea;
    g.fillRect(0, 0, view.W, view.H);
    g.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = this.tier === CHART_TIER.low ? 'medium' : 'high';
    let sharp = 0;
    const pad = 0.6; // a hair of overlap, so no seam shows between tiles
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const x = X(this.box.x0 + i * size);
        const y = Z(this.box.z0 + j * size);
        const t = this.tiles.get(this.key(L, i, j));
        const fade = t ? clamp((this.clock - t.born) / FADE_S, 0, 1) : 0;
        if (fade < 1) {
          const a = this.ancestor(L, i, j);
          if (a) {
            a.t.used = ++this.stamp;
            g.drawImage(a.t.canvas, a.sx, a.sy, a.sw, a.sw, x, y, px + pad, px + pad);
          }
        }
        if (t) {
          t.used = ++this.stamp;
          if (fade < 1) g.globalAlpha = fade;
          g.drawImage(t.canvas, x, y, px + pad, px + pad);
          if (fade < 1) g.globalAlpha = 1;
          sharp++;
        }
      }
    }
    return sharp;
  }
}

/**
 * World Map preview: the ground, streamed round the camera.
 *
 * A quadtree of square tiles over the whole sea. The smallest is 2,048 m; each
 * level up doubles it, to 16,384 m. Every tile, whatever its size, is the same
 * number of vertices (the tier's `seg`), so a far tile costs what a near one
 * does and the ground gets coarser exactly as fast as it gets smaller on the
 * screen. Which tiles are wanted is a plain distance rule — split a tile while
 * the camera is nearer than `splitK` times its size — with the camera's height
 * counted in, so climbing coarsens the ground under you.
 *
 * MOST OF THE WORLD IS SEA. A tile whose square misses every island's circle
 * is never built at all — no sampling, no mesh, no draw call — and a tile that
 * is sampled and found to be all sea floor keeps no mesh either.
 *
 * THE BUDGETS (TIERS, per graphics quality):
 *   - the height sampling happens in a module worker (worldmap/terrain-
 *     worker.js), so the frame loop does none of it; `inFlight` tiles at most
 *     are asked for at once, nearest first. With no worker (an old browser, a
 *     test page) the same code runs here, a few rows at a time, inside
 *     `budgetMs` of each frame;
 *   - at most `meshesPerFrame` finished tiles become meshes in one frame;
 *   - at most `maxTiles` tiles are kept: past that, the farthest tile that is
 *     neither wanted nor on screen is disposed. Anything further than 1.3
 *     times the draw range is disposed whatever the count. So memory is
 *     bounded by the tier, not by how far you have flown.
 *
 * NO HOLES. A wanted tile that is not built yet is covered by its nearest
 * built ancestor (which, flying towards it, is the coarser tile that was
 * wanted a moment ago), and a coarse tile that is wanted again is covered by
 * its built children until it is ready. Tiles that are not on screen are
 * hidden, not dropped, until the memory cap needs them.
 *
 * Seams between sizes are hidden by each tile's skirt (worldmap/tiles.js).
 */
import * as THREE from '../../vendor/three.module.js';
import { sampleSteps, assemble, buildTileData, tileIndex } from './tiles.js';

export const LEAF = 2048;
export const LEVELS = 4;
export const ROOT = LEAF * 2 ** (LEVELS - 1);

/** Per graphics quality. `seg` gives 64 / 51 / 43 / 32 m between vertices on a leaf (Kestrel's own chunk: 71 / 50 / 39 / 28). */
export const TIERS = Object.freeze({
  low: Object.freeze({ seg: 32, splitK: 1.15, range: 30000, budgetMs: 2, inFlight: 2, meshesPerFrame: 1, maxTiles: 120, primeMs: 900 }),
  medium: Object.freeze({ seg: 40, splitK: 1.3, range: 40000, budgetMs: 3, inFlight: 3, meshesPerFrame: 2, maxTiles: 170, primeMs: 1200 }),
  high: Object.freeze({ seg: 48, splitK: 1.45, range: 50000, budgetMs: 4, inFlight: 4, meshesPerFrame: 2, maxTiles: 230, primeMs: 1500 }),
  ultra: Object.freeze({ seg: 64, splitK: 1.6, range: 55000, budgetMs: 5, inFlight: 4, meshesPerFrame: 3, maxTiles: 300, primeMs: 1800 }),
});

export function tierFor(quality) {
  return TIERS[quality] || TIERS.medium;
}

const sizeOf = (level) => LEAF * 2 ** level;
const keyOf = (level, ix, iz) => `${level}:${ix}:${iz}`;

function boxDist2D(px, pz, cx, cz, half) {
  const dx = Math.max(0, Math.abs(px - cx) - half);
  const dz = Math.max(0, Math.abs(pz - cz) - half);
  return Math.hypot(dx, dz);
}

/** The module worker, shared by every world build of the session (null where there is none). */
let SHARED_WORKER;
/** Set once the worker has failed to load or thrown: later builds go straight to the main-thread fallback. */
let WORKER_DEAD = false;
/** A tile the worker has not answered in this long is taken back and built here. */
const WORKER_TIMEOUT_MS = 4000;
function sharedWorker() {
  if (WORKER_DEAD) return null;
  if (SHARED_WORKER !== undefined) return SHARED_WORKER;
  SHARED_WORKER = null;
  try {
    if (typeof Worker === 'function' && typeof window !== 'undefined') {
      SHARED_WORKER = new Worker(new URL('./terrain-worker.js', import.meta.url), { type: 'module' });
    }
  } catch (e) {
    SHARED_WORKER = null;
  }
  return SHARED_WORKER;
}

let GEN = 0;

export class TerrainStream {
  /**
   * @param {object} o
   * @param {object} o.T          terrain.js (heightAt, ISLANDS, flatSurfaceAt, seaCut)
   * @param {THREE.Material} o.material  the terrain material (terrain.js makeTerrainMaterial)
   * @param {THREE.Group} o.group  where the tile meshes go
   * @param {string} o.quality
   * @param {object} [o.def]      the map definition, for the worker
   * @param {boolean} [o.useWorker=true]
   * @param {Function} [o.now]
   */
  constructor({ T, material, group, quality = 'medium', def = null, useWorker = true, now = () => performance.now() }) {
    this.T = T;
    this.material = material;
    this.group = group;
    this.quality = quality;
    this.tier = tierFor(quality);
    this.now = now;
    this.gen = ++GEN;
    this.tiles = new Map();
    this.wanted = [];
    this.wantedSet = new Set();
    this.shown = new Set();
    this.inFlight = new Map();
    this.arrived = [];
    this.cpuJob = null;
    this.lastAt = null;
    this.sinceWant = 0;
    this.index = tileIndex(this.tier.seg);
    this.counts = { built: 0, voids: 0, evicted: 0, workerTiles: 0, cpuTiles: 0, maxMeshMs: 0, maxCpuSliceMs: 0, primed: 0, primeMs: 0, cracks: 0 };
    this.lands = (T.ISLANDS || []).map((i) => ({ x: i.cx, z: i.cz, r: i.radius * 1.45 + 150 }));
    this.worker = useWorker ? sharedWorker() : null;
    this.workerReady = false;
    this.workerFailed = false;
    if (this.worker) {
      this._onMsg = (ev) => this.onMessage(ev.data);
      // A worker that cannot load (a browser without module workers, a
      // missing file) reports it here, once, for the whole session: the tiles
      // it was asked for are taken back, and this build and every later one
      // build here instead.
      this._onErr = () => {
        WORKER_DEAD = true;
        this.abandonWorker();
      };
      this.worker.addEventListener('message', this._onMsg);
      this.worker.addEventListener('error', this._onErr);
      try {
        this.worker.postMessage({ op: 'init', gen: this.gen, def: plainDef(def || T.MAP) });
      } catch (e) {
        this.workerFailed = true;
      }
    }
  }

  /* ---- which tiles ---------------------------------------------- */

  /** Does this square touch any island at all? */
  hasLand(cx, cz, size) {
    const h = size / 2;
    for (const l of this.lands) {
      const dx = Math.max(0, Math.abs(l.x - cx) - h);
      const dz = Math.max(0, Math.abs(l.z - cz) - h);
      if (dx * dx + dz * dz < l.r * l.r) return true;
    }
    return false;
  }

  /** The wanted leaves for a camera at (x, y, z), nearest first. */
  want(x, y, z) {
    const out = [];
    const t = this.tier;
    const R = t.range;
    const top = LEVELS - 1;
    const S = sizeOf(top);
    const i0 = Math.floor((x - R) / S);
    const i1 = Math.floor((x + R) / S);
    const k0 = Math.floor((z - R) / S);
    const k1 = Math.floor((z + R) / S);
    const alt = Math.max(0, y);
    const visit = (level, ix, iz) => {
      const size = sizeOf(level);
      const cx = (ix + 0.5) * size;
      const cz = (iz + 0.5) * size;
      const d2 = boxDist2D(x, z, cx, cz, size / 2);
      if (d2 > R) return;
      if (!this.hasLand(cx, cz, size)) return;
      const d = Math.hypot(d2, alt);
      if (level > 0 && d < t.splitK * size) {
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) visit(level - 1, ix * 2 + a, iz * 2 + b);
        return;
      }
      out.push({ key: keyOf(level, ix, iz), level, ix, iz, cx, cz, size, d });
    };
    for (let ix = i0; ix <= i1; ix++) for (let iz = k0; iz <= k1; iz++) visit(top, ix, iz);
    out.sort((a, b) => a.d - b.d);
    return out;
  }

  tile(w) {
    let t = this.tiles.get(w.key);
    if (!t) {
      t = { key: w.key, level: w.level, ix: w.ix, iz: w.iz, cx: w.cx, cz: w.cz, size: w.size, state: 'new', mesh: null, bytes: 0, used: 0 };
      this.tiles.set(w.key, t);
    }
    return t;
  }

  static parentKey(t) {
    if (t.level >= LEVELS - 1) return null;
    return keyOf(t.level + 1, Math.floor(t.ix / 2), Math.floor(t.iz / 2));
  }

  /* ---- building ---------------------------------------------------- */

  /** The worker's answer. */
  onMessage(m) {
    if (!m || m.gen !== this.gen) return;
    if (m.op === 'init') {
      this.workerReady = !!m.ok;
      return;
    }
    if (m.op !== 'tile') return;
    // Given up on (abandonWorker): the tile is the main thread's now.
    if (this.workerFailed) return;
    this.inFlight.delete(m.key);
    const t = this.tiles.get(m.key);
    if (!t || t.state !== 'building') return;
    if (m.error) {
      // Fall back to building it, and everything else still owed, here.
      t.state = 'new';
      this.abandonWorker();
      return;
    }
    this.counts.workerTiles++;
    this.arrived.push({ t, data: m.data });
  }

  /** Stop using the worker: the tiles it still owes go back to be built on the main thread. */
  abandonWorker() {
    this.workerFailed = true;
    for (const key of this.inFlight.keys()) {
      const t = this.tiles.get(key);
      if (t && t.state === 'building') t.state = 'new';
    }
    this.inFlight.clear();
  }

  /** Make the mesh for a tile from its arrays (null data: all sea, nothing to draw). */
  finish(t, data) {
    const t0 = this.now();
    if (!data) {
      t.state = 'void';
      t.bytes = 0;
      this.counts.voids++;
    } else {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(data.nrm, 3));
      g.setAttribute('aBlend', new THREE.BufferAttribute(data.blend, 3));
      g.setAttribute('uv', new THREE.BufferAttribute(data.uv, 2));
      g.setIndex(new THREE.BufferAttribute(this.index.slice(), 1));
      const half = t.size / 2;
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, data.maxH / 2, 0), Math.hypot(half, half, Math.max(250, Math.abs(data.maxH))));
      const m = new THREE.Mesh(g, this.material);
      m.name = `world-tile ${t.key}`;
      m.position.set(t.cx, 0, t.cz);
      m.updateMatrix();
      m.matrixAutoUpdate = false;
      m.receiveShadow = true;
      m.castShadow = false;
      if (this.T.seaCut) m.onBeforeRender = this.T.seaCut;
      m.visible = false;
      m.userData.worldTile = t.key;
      this.group.add(m);
      t.mesh = m;
      t.state = 'ready';
      t.bytes = data.count * 44 + this.index.length * this.index.BYTES_PER_ELEMENT;
      this.counts.built++;
    }
    this.counts.maxMeshMs = Math.max(this.counts.maxMeshMs, this.now() - t0);
  }

  /** Free a tile's mesh. */
  drop(t) {
    if (t.mesh) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
      t.mesh = null;
    }
    this.inFlight.delete(t.key);
    if (this.cpuJob && this.cpuJob.t === t) this.cpuJob = null;
    this.tiles.delete(t.key);
    this.shown.delete(t.key);
    this.counts.evicted++;
  }

  /** Start the next builds, nearest first. */
  request() {
    const useWorker = this.worker && !this.workerFailed;
    for (const w of this.wanted) {
      const t = this.tile(w);
      if (t.state !== 'new') continue;
      if (useWorker) {
        if (this.inFlight.size >= this.tier.inFlight) break;
        t.state = 'building';
        this.inFlight.set(t.key, this.now());
        this.worker.postMessage({ op: 'tile', gen: this.gen, key: t.key, cx: t.cx, cz: t.cz, size: t.size, seg: this.tier.seg });
      } else {
        if (this.cpuJob) break;
        t.state = 'building';
        this.cpuJob = { t, gen: sampleSteps(this.T, t.cx, t.cz, t.size, this.tier.seg, 2) };
        break;
      }
    }
  }

  /** The main-thread fallback: sample the current tile inside the frame budget. */
  pumpCpu(budgetMs) {
    const t0 = this.now();
    while (this.cpuJob && this.now() - t0 < budgetMs) {
      const s0 = this.now();
      const r = this.cpuJob.gen.next();
      this.counts.maxCpuSliceMs = Math.max(this.counts.maxCpuSliceMs, this.now() - s0);
      if (r.done) {
        const t = this.cpuJob.t;
        this.cpuJob = null;
        const flat = this.T.flatSurfaceAt ? (x, z) => !!this.T.flatSurfaceAt(x, z) : null;
        this.arrived.push({ t, data: assemble(r.value, t.cx, t.cz, t.size, this.tier.seg, flat) });
        this.counts.cpuTiles++;
        this.request();
      }
    }
  }

  /**
   * Build what the camera can see now, here, with no budget: the world is
   * being built behind the loading screen and the first frame must have
   * ground in it. Stops after `primeMs`; the rest streams.
   */
  prime(x, y, z, maxMs = this.tier.primeMs) {
    const t0 = this.now();
    this.wanted = this.want(x, y, z);
    this.wantedSet = new Set(this.wanted.map((w) => w.key));
    for (const w of this.wanted) {
      if (this.now() - t0 > maxMs) break;
      const t = this.tile(w);
      if (t.state !== 'new') continue;
      this.finish(t, buildTileData(this.T, t.cx, t.cz, t.size, this.tier.seg));
      this.counts.primed++;
    }
    this.counts.primeMs = this.now() - t0;
    this.lastAt = { x, y, z };
    this.sinceWant = 0;
    this.resolve();
  }

  /* ---- what is on screen -------------------------------------------- */

  isReady(t) {
    return !!t && (t.state === 'ready' || t.state === 'void');
  }

  /** Pick the tiles to draw: the wanted ones, or the nearest built cover for each. */
  resolve() {
    const show = new Set();
    for (const w of this.wanted) {
      const t = this.tiles.get(w.key);
      if (this.isReady(t)) {
        show.add(w.key);
        continue;
      }
      // An ancestor that is built.
      let p = TerrainStream.parentKey(w);
      let covered = false;
      while (p) {
        const pt = this.tiles.get(p);
        if (this.isReady(pt)) {
          show.add(p);
          covered = true;
          break;
        }
        const [lv, ix, iz] = p.split(':').map(Number);
        p = TerrainStream.parentKey({ level: lv, ix, iz });
      }
      if (covered) continue;
      // Or its children, if they are built (coming back out to a coarser tile).
      if (w.level > 0) {
        for (let a = 0; a < 2; a++) {
          for (let b = 0; b < 2; b++) {
            const ck = keyOf(w.level - 1, w.ix * 2 + a, w.iz * 2 + b);
            if (this.isReady(this.tiles.get(ck))) show.add(ck);
          }
        }
      }
    }
    // Nothing drawn under something else that is drawn.
    for (const k of [...show]) {
      const [lv, ix, iz] = k.split(':').map(Number);
      let p = TerrainStream.parentKey({ level: lv, ix, iz });
      while (p) {
        if (show.has(p)) {
          show.delete(k);
          break;
        }
        const [l2, x2, z2] = p.split(':').map(Number);
        p = TerrainStream.parentKey({ level: l2, ix: x2, iz: z2 });
      }
    }
    const stamp = this.now();
    for (const [k, t] of this.tiles) {
      const on = show.has(k);
      if (t.mesh && t.mesh.visible !== on) t.mesh.visible = on;
      if (on || this.wantedSet.has(k)) t.used = stamp;
    }
    this.shown = show;
  }

  /** Keep memory inside the tier: dispose far, unwanted, hidden tiles. */
  evict(x, z) {
    const far = this.tier.range * 1.3;
    for (const t of [...this.tiles.values()]) {
      if (t.state === 'building' || this.shown.has(t.key) || this.wantedSet.has(t.key)) continue;
      if (boxDist2D(x, z, t.cx, t.cz, t.size / 2) > far) this.drop(t);
    }
    // The cap is on meshes — what costs memory. A sea tile is a record with
    // nothing in it, and gets a looser cap of its own.
    const spare = (want) => [...this.tiles.values()]
      .filter((t) => want(t) && t.state !== 'building' && !this.shown.has(t.key) && !this.wantedSet.has(t.key))
      .sort((a, b) => boxDist2D(x, z, b.cx, b.cz, b.size / 2) - boxDist2D(x, z, a.cx, a.cz, a.size / 2));
    let meshes = 0;
    let voids = 0;
    for (const t of this.tiles.values()) {
      if (t.mesh) meshes++;
      else if (t.state === 'void') voids++;
    }
    if (meshes > this.tier.maxTiles) {
      const list = spare((t) => !!t.mesh);
      while (meshes > this.tier.maxTiles && list.length) {
        this.drop(list.shift());
        meshes--;
      }
    }
    if (voids > this.tier.maxTiles * 3) {
      const list = spare((t) => t.state === 'void');
      while (voids > this.tier.maxTiles * 3 && list.length) {
        this.drop(list.shift());
        voids--;
      }
    }
  }

  /** Every frame. */
  update(dt, x, y, z) {
    this.sinceWant += dt;
    const moved = !this.lastAt || Math.hypot(x - this.lastAt.x, z - this.lastAt.z) > 120 || Math.abs(y - this.lastAt.y) > 150;
    if (moved || this.sinceWant > 0.5) {
      this.wanted = this.want(x, y, z);
      this.wantedSet = new Set(this.wanted.map((w) => w.key));
      this.lastAt = { x, y, z };
      this.sinceWant = 0;
      this.request();
      this.evict(x, z);
    }
    if (!this.worker || this.workerFailed) {
      if (!this.cpuJob) this.request();
      this.pumpCpu(this.tier.budgetMs);
    } else {
      // A worker that has gone quiet (it never answered) is given up on.
      const now = this.now();
      for (const at of this.inFlight.values()) {
        if (now - at > WORKER_TIMEOUT_MS) {
          this.abandonWorker();
          break;
        }
      }
      if (this.workerFailed) this.request();
      else if (this.inFlight.size < this.tier.inFlight) this.request();
    }
    let made = 0;
    let changed = false;
    while (this.arrived.length && made < this.tier.meshesPerFrame) {
      const { t, data } = this.arrived.shift();
      if (this.tiles.get(t.key) !== t) continue;
      this.finish(t, data);
      made++;
      changed = true;
    }
    if (changed || moved) this.resolve();
  }

  /** Numbers for the tests and the dev overlay. */
  stats() {
    let ready = 0;
    let voids = 0;
    let bytes = 0;
    let building = 0;
    let visible = 0;
    for (const t of this.tiles.values()) {
      if (t.state === 'ready') ready++;
      else if (t.state === 'void') voids++;
      else if (t.state === 'building') building++;
      bytes += t.bytes;
      if (t.mesh && t.mesh.visible) visible++;
    }
    let missing = 0;
    for (const w of this.wanted) if (!this.isReady(this.tiles.get(w.key))) missing++;
    return {
      meshes: ready,
      quality: this.quality,
      worker: !!(this.worker && !this.workerFailed),
      workerReady: this.workerReady,
      tiles: this.tiles.size,
      ready,
      voids,
      building,
      visible,
      wanted: this.wanted.length,
      missing,
      bytes,
      maxTiles: this.tier.maxTiles,
      ...this.counts,
    };
  }

  /** The world is being torn down: free every tile and stop listening. */
  dispose() {
    for (const t of [...this.tiles.values()]) {
      if (t.mesh) {
        this.group.remove(t.mesh);
        t.mesh.geometry.dispose();
        t.mesh = null;
      }
    }
    this.tiles.clear();
    this.arrived.length = 0;
    this.inFlight.clear();
    this.cpuJob = null;
    if (this.worker) {
      this.worker.removeEventListener('message', this._onMsg);
      this.worker.removeEventListener('error', this._onErr);
    }
    this.gen = -1;
  }
}

/** The definition as plain data, for postMessage (no functions, no cached boxes). */
export function plainDef(def) {
  return JSON.parse(JSON.stringify(def, (k, v) => (k.startsWith('_') ? undefined : v)));
}

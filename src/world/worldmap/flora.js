/**
 * World Map preview: trees on every island, streamed round the camera.
 *
 * The hub's island has Scenery's own groves (world/scenery.js); the other
 * eighty islands had none, so every far field stood on a lawn. This plants
 * them the same way the ground is streamed: the sea is cut into 2,048 m
 * cells (one leaf tile each), a cell's trees are placed by the tile worker
 * (placeCell, below — heightAt, so it runs off the main thread) the first
 * time the camera comes within the tier's range of it, and dropped again
 * when it leaves. What is drawn is one InstancedMesh per species — five or
 * six draw calls for the whole forest, whatever the count — refilled from the
 * cells in range by copying each cell's ready-made matrices into place, so a
 * new cell costs a memcpy, not a rebuild.
 *
 * The species are the region's (Scenery's FLORA mixes: palms in the south
 * and the Sunstring, broadleaf and conifer on the mainland, conifer and
 * birch in the north), the shapes are Scenery's own trees, and where they
 * stand follows its rules: not on the beach, not on cliffs, not on a field,
 * a town or a road, thinning out up a mountain and none on the high rock.
 * Nothing is planted in a runway's approach lanes.
 *
 * TIERS (per graphics quality): how far out, and how many a cell. Low is
 * very sparse and close in; the counts are capped so the pool never grows.
 *
 * The trees the aeroplane could actually hit — the cells round it, while it
 * is low — are made solid (terrain.js obstacles) and taken away again when
 * it climbs or moves on, so the obstacle list stays short.
 *
 * Precision: every cell's matrices are relative to the pool's origin, a
 * 16 km grid point near the camera, so no instance is ever more than a few
 * kilometres from its mesh's own origin (see render/render-origin.js).
 */
import * as THREE from '../../vendor/three.module.js';

export const CELL = 2048;
export const ORIGIN_SNAP = 16384;

export const TIERS = Object.freeze({
  low: Object.freeze({ radius: 2200, perCell: 36, shadows: false }),
  medium: Object.freeze({ radius: 3300, perCell: 80, shadows: false }),
  high: Object.freeze({ radius: 4600, perCell: 120, shadows: true }),
  ultra: Object.freeze({ radius: 6000, perCell: 160, shadows: true }),
});

export function tierFor(q) {
  return TIERS[q] || TIERS.medium;
}

/** Scenery's species mixes (palm, broadleaf, conifer, scrub, birch, thorn), by region. */
export const MIXES = Object.freeze({
  tropical: { coast: [0.72, 0.1, 0.02, 0.16, 0, 0], hill: [0.12, 0.56, 0.1, 0.22, 0, 0] },
  temperate: { coast: [0, 0.42, 0.14, 0.3, 0.14, 0], hill: [0, 0.5, 0.3, 0.08, 0.12, 0] },
  boreal: { coast: [0, 0.04, 0.58, 0.24, 0.14, 0], hill: [0, 0.02, 0.8, 0.06, 0.12, 0] },
});
export const REGION_FLORA = Object.freeze({ sound: 'tropical', westreach: 'temperate', sunstring: 'tropical', sands: 'tropical', skerries: 'boreal', outposts: 'boreal' });
/** Species proportions, as Scenery's addTrees: width and height factor. */
const SHAPE = [{ w: 0.8, h: 1.0 }, { w: 0.95, h: 0.9 }, { w: 0.72, h: 1.15 }, { w: 1.05, h: 0.42 }, { w: 0.5, h: 1.1 }, { w: 1.2, h: 0.62 }];
export const SPECIES = ['palm', 'broadleaf', 'conifer', 'scrub', 'birch', 'thorn'];

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the trees of cell (ix, iz) stand. Pure: `T` is a terrain module
 * (heightAt, flatAt, ISLANDS, MAP), `ctx` the preview's data (islands with
 * regions, airports, roads) and `perCell` the most to plant. Returns a
 * Float32Array of [x, y, z, height, rot, species] (world metres), or null
 * when the cell has no land at all.
 */
export function placeCell(T, ctx, ix, iz, perCell) {
  const x0 = ix * CELL;
  const z0 = iz * CELL;
  const isl = (ctx.islands || []).filter((i) => {
    const r = i.radius * 1.45;
    return i.cx + r > x0 && i.cx - r < x0 + CELL && i.cz + r > z0 && i.cz - r < z0 + CELL;
  });
  if (!isl.length) return null;
  // The hub's island and its hill have Scenery's own groves.
  const skip = new Set(ctx.skipIslands || []);
  const roads = (ctx.roads || []).filter((r) => r.box && r.box[1] > x0 - 40 && r.box[0] < x0 + CELL + 40 && r.box[3] > z0 - 40 && r.box[2] < z0 + CELL + 40);
  const lanes = (ctx.airports || []).filter((a) => Math.abs(a.z - (z0 + CELL / 2)) < CELL / 2 + 500 && Math.abs(a.x - (x0 + CELL / 2)) < CELL / 2 + a.length / 2 + 3500);
  const R = rng(((ix * 73856093) ^ (iz * 19349663) ^ 0x5bd1e995) >>> 0);
  const out = [];
  const tries = perCell * 3;
  for (let k = 0; k < tries && out.length / 6 < perCell; k++) {
    const x = x0 + R() * CELL;
    const z = z0 + R() * CELL;
    const r1 = R();
    const r2 = R();
    const r3 = R();
    // Which island is this, and is it one with groves of its own?
    let home = null;
    let best = Infinity;
    for (const i of isl) {
      const d = Math.hypot(x - i.cx, z - i.cz) / i.radius;
      if (d < best) { best = d; home = i; }
    }
    if (!home || best > 1.45 || skip.has(home.name)) continue;
    let lane = false;
    for (const a of lanes) if (Math.abs(z - a.z) < 420 && Math.abs(x - a.x) < a.length / 2 + 3200) lane = true;
    if (lane) continue;
    const h = T.heightAt(x, z);
    if (h < 2.5 || h > 620) continue;
    // Groves: a slow noise of where woods are, from the cell's own numbers.
    const wood = 0.5 + 0.5 * Math.sin(x * 0.0021 + home.seed) * Math.cos(z * 0.0017 - home.seed * 0.7);
    const altK = h < 12 ? 0.75 : h < 260 ? 1 : 1 - (h - 260) / 360;
    const profileK = home.profile === 'flat' ? 0.8 : home.profile === 'cone' ? 0.35 : home.profile === 'ridge' ? 0.7 : 1;
    if (r1 > wood * altK * profileK) continue;
    const gx = T.heightAt(x + 6, z) - T.heightAt(x - 6, z);
    const gz = T.heightAt(x, z + 6) - T.heightAt(x, z - 6);
    const slope = Math.hypot(gx, gz) / 12;
    if (slope > 0.5) continue;
    if (T.flatAt && T.flatAt(x, z)) continue;
    let onRoad = false;
    for (const rd of roads) {
      const p = rd.path;
      for (let i = 1; i < p.length && !onRoad; i++) {
        const ax = p[i - 1][0];
        const az = p[i - 1][1];
        const bx = p[i][0] - ax;
        const bz = p[i][1] - az;
        const l2 = bx * bx + bz * bz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2));
        if (Math.hypot(x - ax - bx * t, z - az - bz * t) < rd.halfWidth + 14) onRoad = true;
      }
      if (onRoad) break;
    }
    if (onRoad) continue;
    const band = MIXES[REGION_FLORA[home.region] || 'tropical'];
    const mix = h < 25 ? band.coast : band.hill;
    const total = mix.reduce((a, b) => a + b, 0);
    let q = r2 * total;
    let kind = 0;
    for (let s = 0; s < mix.length; s++) {
      if (mix[s] > 0 && q < mix[s]) { kind = s; break; }
      q -= mix[s];
      kind = s;
    }
    const nominal = h > 200 ? 11 : 9.5;
    const height = nominal * (0.7 + r3 * 0.6) * SHAPE[kind].h;
    out.push(x, h, z, height, r1 * 6.2832 + r3 * 3.1, kind);
  }
  return new Float32Array(out);
}

/** The preview's data, cut down to what placeCell reads (for the worker message). */
export function floraContext(D) {
  return {
    islands: D.islands.map((i) => ({ name: i.name, cx: i.cx, cz: i.cz, radius: i.radius, profile: i.profile, seed: i.seed, region: i.region })),
    airports: D.airports.map((a) => ({ x: a.x, z: a.z, length: a.length })),
    roads: D.roads.map((r) => {
      let b = [Infinity, -Infinity, Infinity, -Infinity];
      for (const p of r.path) b = [Math.min(b[0], p[0]), Math.max(b[1], p[0]), Math.min(b[2], p[1]), Math.max(b[3], p[1])];
      return { halfWidth: r.halfWidth, path: r.path.map((p) => [p[0], p[1]]), box: b };
    }),
    skipIslands: D.islands.slice(0, 2).map((i) => i.name),
  };
}

const _d = new THREE.Object3D();
const _c = new THREE.Color();

export class Flora {
  /**
   * @param {object} o
   * @param {Function} o.treeGeometry  scenery.js treeGeometry(kind)
   * @param {object} o.ctx             floraContext(data)
   * @param {object} [o.T]             terrain.js, for the main-thread fallback
   * @param {Worker} [o.worker]        the tile worker, shared with the ground
   * @param {number} [o.gen]
   * @param {string} [o.quality]
   * @param {Function} [o.addObstacle] terrain.js addObstacle (solid trees round the aeroplane)
   * @param {object[]} [o.obstacles]   terrain.js OBSTACLES
   */
  constructor({ treeGeometry, ctx, T = null, worker = null, gen = 0, quality = 'medium', addObstacle = null, obstacles = null, now = () => performance.now() }) {
    this.tier = tierFor(quality);
    this.ctx = ctx;
    this.T = T;
    this.worker = worker;
    this.gen = gen;
    this.now = now;
    this.addObstacle = addObstacle;
    this.obstacles = obstacles;
    this.cells = new Map();
    this.pending = new Set();
    this.group = new THREE.Group();
    this.group.name = 'world-flora';
    this.origin = { x: NaN, z: NaN };
    this.span = Math.ceil(this.tier.radius / CELL) * 2 + 2;
    const maxCells = this.span * this.span;
    this.meshes = SPECIES.map((name, kind) => {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: kind === 0 ? THREE.DoubleSide : THREE.FrontSide });
      const cap = Math.ceil(maxCells * this.tier.perCell * (kind === 0 || kind === 1 || kind === 2 ? 0.8 : 0.45));
      const m = new THREE.InstancedMesh(treeGeometry(kind), mat, cap);
      m.name = `world-trees:${name}`;
      m.count = 0;
      m.castShadow = this.tier.shadows;
      m.receiveShadow = false;
      m.frustumCulled = false;
      m.matrixAutoUpdate = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, _c.setRGB(1, 1, 1));
      this.group.add(m);
      return m;
    });
    this.dirty = false;
    this.solid = [];
    this.solidKey = '';
    this.counts = { cells: 0, trees: 0, workerCells: 0, cpuCells: 0, refills: 0, maxRefillMs: 0, dropped: 0 };
    if (this.worker) {
      this._onMsg = (ev) => this.onMessage(ev.data);
      this.worker.addEventListener('message', this._onMsg);
    }
  }

  onMessage(m) {
    if (!m || m.op !== 'flora' || m.gen !== this.gen) return;
    this.pending.delete(m.key);
    if (m.error) {
      this.worker = null;
      return;
    }
    this.counts.workerCells++;
    this.arrive(m.key, m.ix, m.iz, m.trees);
  }

  arrive(key, ix, iz, trees) {
    const c = { key, ix, iz, trees: trees || new Float32Array(0), blocks: null, ox: NaN, oz: NaN };
    this.cells.set(key, c);
    this.dirty = true;
  }

  /** Each species' matrices and colours for a cell, relative to the pool's origin. */
  blocksFor(c) {
    if (c.blocks && c.ox === this.origin.x && c.oz === this.origin.z) return c.blocks;
    const per = SPECIES.map(() => []);
    const t = c.trees;
    for (let i = 0; i < t.length; i += 6) per[t[i + 5]].push(i);
    c.blocks = per.map((list) => {
      const m = new Float32Array(list.length * 16);
      const col = new Float32Array(list.length * 3);
      list.forEach((i, n) => {
        const h = t[i + 3];
        _d.position.set(t[i] - this.origin.x, t[i + 1] - 0.4, t[i + 2] - this.origin.z);
        _d.rotation.set(0, t[i + 4], 0);
        _d.scale.set(h, h, h);
        _d.updateMatrix();
        _d.matrix.toArray(m, n * 16);
        const q = ((Math.sin(t[i] * 3.17 + t[i + 2] * 7.61) * 9631.7) % 1 + 1) % 1;
        const l = 0.88 + q * 0.24;
        col[n * 3] = l * (0.97 + q * 0.06);
        col[n * 3 + 1] = l;
        col[n * 3 + 2] = l * (1.03 - q * 0.08);
      });
      return { m, col, n: list.length };
    });
    c.ox = this.origin.x;
    c.oz = this.origin.z;
    return c.blocks;
  }

  /** The cells in range of a camera here. */
  wanted(x, z) {
    const R = this.tier.radius;
    const out = [];
    for (let ix = Math.floor((x - R) / CELL); ix <= Math.floor((x + R) / CELL); ix++) {
      for (let iz = Math.floor((z - R) / CELL); iz <= Math.floor((z + R) / CELL); iz++) {
        const dx = Math.max(0, Math.abs(x - (ix + 0.5) * CELL) - CELL / 2);
        const dz = Math.max(0, Math.abs(z - (iz + 0.5) * CELL) - CELL / 2);
        if (Math.hypot(dx, dz) <= R) out.push({ ix, iz, key: `${ix}:${iz}`, d: Math.hypot(dx, dz) });
      }
    }
    return out.sort((a, b) => a.d - b.d);
  }

  /** Every frame: ask for the cells coming into range, drop the ones gone, refill the pool if anything changed. */
  update(cam, ac = null, budgetMs = 1) {
    const ox = Math.round(cam.x / ORIGIN_SNAP) * ORIGIN_SNAP;
    const oz = Math.round(cam.z / ORIGIN_SNAP) * ORIGIN_SNAP;
    if (ox !== this.origin.x || oz !== this.origin.z) {
      this.origin.x = ox;
      this.origin.z = oz;
      for (const m of this.meshes) {
        m.position.set(ox, 0, oz);
        m.updateMatrix();
      }
      this.dirty = true;
    }
    const want = this.wanted(cam.x, cam.z);
    const keep = new Set(want.map((w) => w.key));
    for (const k of [...this.cells.keys()]) {
      if (!keep.has(k)) {
        this.cells.delete(k);
        this.counts.dropped++;
        this.dirty = true;
      }
    }
    const t0 = this.now();
    for (const w of want) {
      if (this.cells.has(w.key) || this.pending.has(w.key)) continue;
      if (this.worker) {
        if (this.pending.size >= 3) break;
        this.pending.add(w.key);
        this.worker.postMessage({ op: 'flora', gen: this.gen, key: w.key, ix: w.ix, iz: w.iz, perCell: this.tier.perCell });
      } else if (this.T) {
        if (this.now() - t0 > budgetMs) break;
        this.arrive(w.key, w.ix, w.iz, placeCell(this.T, this.ctx, w.ix, w.iz, this.tier.perCell));
        this.counts.cpuCells++;
      }
    }
    if (this.dirty) this.refill();
    if (ac) this.makeSolid(ac);
  }

  refill() {
    const t0 = this.now();
    const fill = this.meshes.map(() => 0);
    let trees = 0;
    for (const c of this.cells.values()) {
      const blocks = this.blocksFor(c);
      blocks.forEach((b, kind) => {
        const mesh = this.meshes[kind];
        const room = mesh.instanceMatrix.count - fill[kind];
        const n = Math.min(b.n, room);
        if (n <= 0) return;
        mesh.instanceMatrix.array.set(n === b.n ? b.m : b.m.subarray(0, n * 16), fill[kind] * 16);
        mesh.instanceColor.array.set(n === b.n ? b.col : b.col.subarray(0, n * 3), fill[kind] * 3);
        fill[kind] += n;
        trees += n;
      });
    }
    this.meshes.forEach((m, kind) => {
      m.count = fill[kind];
      m.visible = fill[kind] > 0;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor.needsUpdate = true;
    });
    this.dirty = false;
    this.counts.cells = this.cells.size;
    this.counts.trees = trees;
    this.counts.refills++;
    this.counts.maxRefillMs = Math.max(this.counts.maxRefillMs, this.now() - t0);
  }

  /** Solid trunks in the cells round a low aeroplane (scenery.js's rule: over 4 m, a trunk box a quarter of the canopy). */
  makeSolid(ac) {
    const low = ac.agl != null ? ac.agl < 220 : true;
    const ix = Math.floor(ac.pos.x / CELL);
    const iz = Math.floor(ac.pos.z / CELL);
    const key = low ? `${ix}:${iz}` : '';
    if (key === this.solidKey) return;
    this.clearSolid();
    this.solidKey = key;
    if (!low || !this.addObstacle) return;
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const c = this.cells.get(`${ix + a}:${iz + b}`);
        if (!c) continue;
        const t = c.trees;
        for (let i = 0; i < t.length; i += 6) {
          const kind = t[i + 5];
          const h = t[i + 3];
          if (kind === 3 || h <= 4) continue;
          const w = Math.max(1.2, h * SHAPE[kind].w * 0.22);
          this.solid.push(this.addObstacle({ x0: t[i] - w / 2, x1: t[i] + w / 2, z0: t[i + 2] - w / 2, z1: t[i + 2] + w / 2, y0: t[i + 1] - 0.4, y1: t[i + 1] - 0.4 + h * 0.86, what: 'You flew into a tree' }));
        }
      }
    }
    // The cell it asked for may not be in yet: try again next frame.
    if (!this.cells.has(key)) this.solidKey = 'retry';
  }

  clearSolid() {
    if (this.solid.length && this.obstacles) {
      const gone = new Set(this.solid);
      let w = 0;
      for (let i = 0; i < this.obstacles.length; i++) if (!gone.has(this.obstacles[i])) this.obstacles[w++] = this.obstacles[i];
      this.obstacles.length = w;
    }
    this.solid.length = 0;
    this.solidKey = '';
  }

  stats() {
    return { ...this.counts, pending: this.pending.size, drawn: this.meshes.reduce((s, m) => s + m.count, 0), capacity: this.meshes.reduce((s, m) => s + m.instanceMatrix.count, 0), solid: this.solid.length };
  }

  dispose() {
    this.clearSolid();
    if (this.worker && this._onMsg) this.worker.removeEventListener('message', this._onMsg);
    for (const m of this.meshes) {
      m.geometry.dispose();
      m.material.dispose();
      m.dispose();
    }
    this.cells.clear();
    this.gen = -1;
  }
}

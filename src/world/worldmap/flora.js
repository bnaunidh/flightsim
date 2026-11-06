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
 * The species are the biome's (worldmap/biomes.js BIOME_MIX below), else the
 * region's (Scenery's FLORA mixes: palms in the south, broadleaf and conifer
 * on the mainland), the shapes Scenery's own trees and the biomes' (worldmap/
 * biome-trees.js). A species with nothing in range is no draw call, and no
 * biome grows more than four or five, so twelve species cost what six did. Where they
 * stand follows its rules: not on the beach, not on cliffs, not on a field,
 * a town or a road, thinning out up a mountain and none on the high rock.
 * Nothing is planted in a runway's approach lanes.
 *
 * TIERS (per graphics quality): how far out, and how many a cell. Low is
 * very sparse and close in; the counts are capped so the pool never grows.
 * On Low the trees themselves are cards in one draw (features/world-preview.js).
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
import { coverAt, forestNoise, climateAt } from './landcover.js';
import { mangroveAt, alpineAt } from './biomes.js';

export const CELL = 2048;
export const ORIGIN_SNAP = 16384;

/*
 * Wave 18 (owner: "sparse single trees"): the trees stand where the land
 * cover says forest (worldmap/landcover.js), densely, and a few along the
 * hedges and in the heath; from far off the forest floor's own colour
 * carries the woods, so the instanced trees are only needed close in. Low
 * stays light for the school Chromebooks: a tight radius and the counts
 * the frame-time runs allow.
 */
export const TIERS = Object.freeze({
  low: Object.freeze({ radius: 1300, perCell: 70, shadows: false }),
  medium: Object.freeze({ radius: 2400, perCell: 220, shadows: false }),
  high: Object.freeze({ radius: 3600, perCell: 400, shadows: true }),
  ultra: Object.freeze({ radius: 5000, perCell: 600, shadows: true }),
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
/**
 * Species proportions, as Scenery's addTrees: width and height factor. The first six are Scenery's, the rest the
 * biomes' own (worldmap/biome-trees.js): those carry a real height (`m`), the same near and far.
 */
const SHAPE = [
  { w: 0.8, h: 1.0 }, { w: 0.95, h: 0.9 }, { w: 0.72, h: 1.15 }, { w: 1.05, h: 0.42 }, { w: 0.5, h: 1.1 }, { w: 1.2, h: 0.62 },
  { w: 0.8, m: 27 }, { w: 1.3, m: 9.5 }, { w: 0.3, m: 7.5 }, { w: 0.62, m: 15 }, { w: 1, m: 9 }, { w: 0.95, m: 13 },
];
export const SPECIES = ['palm', 'broadleaf', 'conifer', 'scrub', 'birch', 'thorn', 'hardwood', 'acacia', 'cactus', 'snowpine', 'mangrove', 'autumn'];
const KIND = Object.fromEntries(SPECIES.map((s, i) => [s, i]));

/** The biomes' species, as { name: share }; `mix` turns one into a list MIXES-style (coast, then inland). */
const mix = (o) => SPECIES.map((s) => o[s] || 0);
const BIOME_MIX = Object.freeze({
  desert: { coast: mix({ palm: 0.55, cactus: 0.3, scrub: 0.15 }), hill: mix({ cactus: 0.72, scrub: 0.2, palm: 0.08 }) },
  savanna: { coast: mix({ acacia: 0.62, scrub: 0.26, palm: 0.12 }), hill: mix({ acacia: 0.76, scrub: 0.24 }) },
  jungle: { coast: mix({ hardwood: 0.5, palm: 0.26, broadleaf: 0.24 }), hill: mix({ hardwood: 0.72, broadleaf: 0.22, palm: 0.06 }) },
  mangrove: { coast: mix({ mangrove: 0.92, palm: 0.08 }), hill: mix({ mangrove: 0.92, palm: 0.08 }) },
  autumn: { coast: mix({ autumn: 0.62, conifer: 0.12, birch: 0.14, scrub: 0.12 }), hill: mix({ autumn: 0.68, conifer: 0.2, birch: 0.12 }) },
  snowy: { coast: mix({ snowpine: 0.8, conifer: 0.14, scrub: 0.06 }), hill: mix({ snowpine: 0.84, conifer: 0.16 }) },
  alpine: { coast: mix({ conifer: 0.7, snowpine: 0.3 }), hill: mix({ conifer: 0.7, snowpine: 0.3 }) },
});

/** Pick a list by weight: the first biome whose share of `q` covers it, else the region's own. */
function chooseMix(q, weights, fallback) {
  let at = 0;
  for (let i = 0; i < weights.length; i += 2) {
    at += weights[i + 1];
    if (q < at) return weights[i];
  }
  return fallback;
}

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
export function placeCell(T, ctx, ix, iz, perCell, mode = 'trees') {
  const cards = mode === 'cards';
  const x0 = ix * CELL;
  const z0 = iz * CELL;
  const isl = (ctx.islands || []).filter((i) => {
    const r = i.radius * 1.45;
    return i.cx + r > x0 && i.cx - r < x0 + CELL && i.cz + r > z0 && i.cz - r < z0 + CELL;
  });
  if (!isl.length) return null;
  // Islands that bring their own trees (none since the land cover: the hub's too follows its forests).
  const skip = new Set(ctx.skipIslands || []);
  const cov = new Float32Array(15);
  const roads = (ctx.roads || []).filter((r) => r.box && r.box[1] > x0 - 40 && r.box[0] < x0 + CELL + 40 && r.box[3] > z0 - 40 && r.box[2] < z0 + CELL + 40);
  const lanes = (ctx.airports || []).filter((a) => Math.abs(a.z - (z0 + CELL / 2)) < CELL / 2 + 500 && Math.abs(a.x - (x0 + CELL / 2)) < CELL / 2 + a.length / 2 + 3500);
  const R = rng(((ix * 73856093) ^ (iz * 19349663) ^ 0x5bd1e995) >>> 0);
  // The ground, not a deck standing on it (no trees on the carrier).
  const gh = T.groundHeightAt || T.heightAt;
  const out = [];
  const tries = cards ? Math.round(perCell * 1.8) : perCell * 3;
  for (let k = 0; k < tries && out.length / 6 < perCell; k++) {
    const x = x0 + R() * CELL;
    const z = z0 + R() * CELL;
    const r1 = R();
    const r2 = R();
    const r3 = R();
    const r4 = R();
    // Which island is this, and is it one with groves of its own?
    let home = null;
    let best = Infinity;
    for (const i of isl) {
      const d = Math.hypot(x - i.cx, z - i.cz) / i.radius;
      if (d < best) { best = d; home = i; }
    }
    if (!home || best > 1.45 || skip.has(home.name)) continue;
    // Cards stand only in forest: most of the sea of tries is thrown out here, before any height is asked.
    // (The Sunstring's jungle and mangroves close over ground that noise leaves open.)
    if (cards && forestNoise(x, z) < 0.31 && home.region !== 'sunstring') continue;
    let lane = false;
    for (const a of lanes) if (Math.abs(z - a.z) < 420 && Math.abs(x - a.x) < a.length / 2 + 3200) lane = true;
    if (lane) continue;
    const h = gh(x, z);
    if (h < 2.5 || h > 620) continue;
    const gx = gh(x + 6, z) - gh(x - 6, z);
    const gz = gh(x, z + 6) - gh(x, z - 6);
    const slope = Math.hypot(gx, gz) / 12;
    if (slope > 0.5) continue;
    if (T.flatAt && T.flatAt(x, z)) continue;
    // Where the land cover has woods: densely in a forest, a few in the heath and along the farmland, odd ones elsewhere.
    const c = coverAt(x, z, h, slope, false, cov);
    // The cards fill the forests only (worldmap/tree-cards.js), as densely as the tier allows.
    // The biomes (worldmap/biomes.js): mangroves stand thick in the mud, flat-tops dot the grass, a cactus here and there.
    const desert = c[11];
    const savanna = c[12];
    const jungle = c[13];
    const autumn = c[14];
    const { cold } = climateAt(z);
    const mangrove = mangroveAt(x, z, h, slope, jungle);
    const alpine = alpineAt(h, cold);
    let want = cards ? c[4] * 0.99 + c[5] * 0.04 + mangrove * 0.9 + savanna * 0.05 : c[4] * 0.97 + c[5] * 0.07 + c[3] * 0.025 + c[6] * (1 - desert) * 0.05 + c[1] * 0.015 + mangrove * 0.8 + savanna * 0.16 + desert * 0.022;
    // Thin up towards the tree line.
    want *= 1 - alpine * 0.7;
    if (r1 > want) continue;
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
    const list = chooseMix(r4, [
      BIOME_MIX.mangrove, Math.min(1, mangrove * 1.6),
      BIOME_MIX.alpine, alpine > 0.02 ? 0.3 + alpine * 0.7 : 0,
      BIOME_MIX.desert, desert,
      BIOME_MIX.savanna, savanna,
      BIOME_MIX.jungle, jungle,
      BIOME_MIX.autumn, autumn * 0.92,
      BIOME_MIX.snowy, cold,
    ], band);
    const spread = h < 25 ? list.coast : list.hill;
    const total = spread.reduce((a, b) => a + b, 0);
    let q = r2 * total;
    let kind = 0;
    for (let s = 0; s < spread.length; s++) {
      if (spread[s] > 0 && q < spread[s]) { kind = s; break; }
      q -= spread[s];
      kind = spread[s] > 0 ? s : kind;
    }
    const nominal = cards ? (h > 200 ? 15 : 17) : h > 200 ? 11 : 9.5;
    // Smaller and fewer towards the tree line.
    const height = (SHAPE[kind].m || nominal * SHAPE[kind].h) * (0.7 + r3 * 0.6) * (1 - alpine * 0.4);
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
    skipIslands: [],
  };
}

/** A cell the worker has not answered in this long: the worker is given up on (stream.js uses the same). */
export const WORKER_TIMEOUT_MS = 4000;

const _c = new THREE.Color();
const NEUTRAL = [1, 1, 1];
/** Gold, amber, orange, scarlet, russet, and the odd tree still green (multiplied over the pale gold). */
const AUTUMN = [[1, 1, 0.92], [1, 0.84, 0.66], [1, 0.66, 0.46], [0.96, 0.42, 0.3], [0.72, 0.42, 0.3], [0.42, 0.62, 0.3]];

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
  constructor({ treeGeometry, ctx, T = null, worker = null, gen = 0, quality = 'medium', addObstacle = null, obstacles = null, now = () => performance.now(), workerOk = null, layer = null }) {
    /*
     * `layer` makes this pool something other than the real trees: the tree
     * cards (worldmap/tree-cards.js) are { id: 'cards', mode: 'cards', tiers,
     * geometry(kind), material(kind), solid: false }. Its requests to the
     * shared worker carry the id, so two pools never take each other's cells.
     */
    this.layer = layer;
    this.tier = layer && layer.tiers ? layer.tiers[quality] || layer.tiers.medium : tierFor(quality);
    this.ctx = ctx;
    this.T = T;
    this.worker = worker;
    this.gen = gen;
    this.now = now;
    this.addObstacle = addObstacle;
    this.obstacles = obstacles;
    this.cells = new Map();
    /** Cells asked of the worker: key → when. */
    this.pending = new Map();
    /** The ground's own verdict on the shared worker (stream.js abandonWorker): false = it has given up on it. */
    this.workerOk = workerOk;
    this.group = new THREE.Group();
    this.group.name = layer ? `world-flora-${layer.id}` : 'world-flora';
    this.origin = { x: NaN, z: NaN };
    this.span = Math.ceil(this.tier.radius / CELL) * 2 + 2;
    // The most cells a circle of the tier's radius can touch (not the whole square round it): the pool's memory.
    const maxCells = Math.min(this.span * this.span, Math.ceil(Math.PI * (this.tier.radius / CELL + 1.5) ** 2));
    /*
     * `layer.merged`: every species in ONE InstancedMesh of one geometry, its
     * picture chosen per instance (tree-cards.js mergedCardMaterial reads aKind):
     * one draw call however many species are in sight. Filled in cell order, not
     * by species, so it needs no more than one cell's plan times the cells.
     */
    this.merged = !!(layer && layer.merged);
    const names = this.merged ? ['all'] : SPECIES;
    this.meshes = names.map((name, kind) => {
      const mat = layer ? layer.material(kind) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, side: kind === 0 || kind === KIND.acacia ? THREE.DoubleSide : THREE.FrontSide });
      const cap = Math.ceil(maxCells * this.tier.perCell * (this.merged ? 1 : kind === 0 || kind === 1 || kind === 2 ? 0.8 : 0.45));
      const geo = layer ? layer.geometry(kind) : treeGeometry(kind);
      if (this.merged) geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(new Float32Array(cap), 1).setUsage(THREE.DynamicDrawUsage));
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.name = `world-${layer ? layer.id : 'trees'}:${name}`;
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
    if ((m.layer || null) !== (this.layer ? this.layer.id : null)) return;
    this.pending.delete(m.key);
    if (m.error) {
      this.abandonWorker();
      return;
    }
    this.counts.workerCells++;
    this.arrive(m.key, m.ix, m.iz, m.trees);
  }

  /*
   * The worker is gone (it threw, stopped answering, or the ground gave up on
   * it): what it still owes is planted here instead, inside the frame budget,
   * the same as the ground's own fallback (stream.js). Before this, a worker
   * that failed mid-session left its three cells pending for ever and no tree
   * was ever planted again (checker, wave 17b).
   */
  abandonWorker() {
    if (this.worker && this._onMsg) this.worker.removeEventListener('message', this._onMsg);
    this.worker = null;
    this.pending.clear();
    this.counts.abandoned = (this.counts.abandoned || 0) + 1;
  }

  arrive(key, ix, iz, trees) {
    const c = { key, ix, iz, trees: trees || new Float32Array(0), blocks: null, ox: NaN, oz: NaN };
    this.cells.set(key, c);
    this.dirty = true;
  }

  /**
   * Each species' matrices and colours for a cell, relative to the cell's own
   * corner, made once (straight from the numbers: a turn about Y and a
   * uniform scale, no Object3D). The pool's origin is added when they are
   * copied in (refill), so the origin moving on (every 16 km) costs two adds
   * a tree, not a rebuild of every matrix: that rebuild was a 170-330 ms
   * frame at Mach 2 with the tree cards' thousands a cell.
   */
  blocksFor(c) {
    if (c.blocks) return c.blocks;
    // One draw for all of them, or one a species.
    const per = this.merged ? [[]] : SPECIES.map(() => []);
    const t = c.trees;
    for (let i = 0; i < t.length; i += 6) per[this.merged ? 0 : t[i + 5]].push(i);
    const bx = c.ix * CELL;
    const bz = c.iz * CELL;
    c.blocks = per.map((list) => {
      const m = new Float32Array(list.length * 16);
      const col = new Float32Array(list.length * 3);
      const kinds = this.merged ? new Float32Array(list.length) : null;
      for (let n = 0; n < list.length; n++) {
        const i = list[n];
        const h = t[i + 3];
        const cs = Math.cos(t[i + 4]) * h;
        const sn = Math.sin(t[i + 4]) * h;
        const o = n * 16;
        m[o] = cs; m[o + 2] = -sn;
        m[o + 5] = h;
        m[o + 8] = sn; m[o + 10] = cs;
        m[o + 12] = t[i] - bx; m[o + 13] = t[i + 1] - 0.4; m[o + 14] = t[i + 2] - bz; m[o + 15] = 1;
        const q = ((Math.sin(t[i] * 3.17 + t[i + 2] * 7.61) * 9631.7) % 1 + 1) % 1;
        const l = 0.88 + q * 0.24;
        const kind = t[i + 5];
        if (kinds) kinds[n] = kind;
        // Autumn's leaves are one pale gold in the geometry and the picture: each tree its own turn of it.
        const a = kind === KIND.autumn ? AUTUMN[Math.floor(q * AUTUMN.length * 0.9999)] : NEUTRAL;
        col[n * 3] = l * (0.97 + q * 0.06) * a[0];
        col[n * 3 + 1] = l * a[1];
        col[n * 3 + 2] = l * (1.03 - q * 0.08) * a[2];
      }
      return { m, col, kinds, n: list.length };
    });
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
    if (this.worker) {
      let stale = this.workerOk && !this.workerOk();
      for (const at of this.pending.values()) if (t0 - at > WORKER_TIMEOUT_MS) stale = true;
      if (stale) this.abandonWorker();
    }
    for (const w of want) {
      if (this.cells.has(w.key) || this.pending.has(w.key)) continue;
      if (this.worker) {
        if (this.pending.size >= 3) break;
        this.pending.set(w.key, t0);
        this.worker.postMessage({ op: 'flora', gen: this.gen, key: w.key, ix: w.ix, iz: w.iz, perCell: this.tier.perCell, layer: this.layer ? this.layer.id : null, mode: this.layer ? this.layer.mode : 'trees' });
      } else if (this.T && !(this.layer && this.layer.mode === 'cards')) {
        // (No cards without the worker: thousands a cell is too much for the frame. The forest floor carries the woods.)
        if (this.now() - t0 > budgetMs) break;
        this.arrive(w.key, w.ix, w.iz, placeCell(this.T, this.ctx, w.ix, w.iz, this.tier.perCell, this.layer ? this.layer.mode : 'trees'));
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
        const arr = mesh.instanceMatrix.array;
        const at = fill[kind] * 16;
        arr.set(n === b.n ? b.m : b.m.subarray(0, n * 16), at);
        // From the cell's corner to the pool's origin.
        const dx = c.ix * CELL - this.origin.x;
        const dz = c.iz * CELL - this.origin.z;
        for (let k = 0; k < n; k++) {
          arr[at + k * 16 + 12] += dx;
          arr[at + k * 16 + 14] += dz;
        }
        mesh.instanceColor.array.set(n === b.n ? b.col : b.col.subarray(0, n * 3), fill[kind] * 3);
        if (b.kinds) mesh.geometry.attributes.aKind.array.set(n === b.n ? b.kinds : b.kinds.subarray(0, n), fill[kind]);
        fill[kind] += n;
        trees += n;
      });
    }
    this.meshes.forEach((m, kind) => {
      m.count = fill[kind];
      m.visible = fill[kind] > 0;
      // Upload only what is used: the pool is sized for the most cells there could be, and sending
      // all of it every refill was megabytes a second at Mach 2 (the tree cards especially).
      if (fill[kind] > 0) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, fill[kind] * 16);
        m.instanceColor.clearUpdateRanges();
        m.instanceColor.addUpdateRange(0, fill[kind] * 3);
        m.instanceMatrix.needsUpdate = true;
        m.instanceColor.needsUpdate = true;
        const k = m.geometry.attributes.aKind;
        if (k) {
          k.clearUpdateRanges();
          k.addUpdateRange(0, fill[kind]);
          k.needsUpdate = true;
        }
      }
    });
    this.dirty = false;
    this.counts.cells = this.cells.size;
    this.counts.trees = trees;
    this.counts.refills++;
    this.counts.maxRefillMs = Math.max(this.counts.maxRefillMs, this.now() - t0);
  }

  /** Solid trunks in the cells round a low aeroplane (scenery.js's rule: over 4 m, a trunk box a quarter of the canopy). */
  makeSolid(ac) {
    if (this.layer && this.layer.solid === false) return;
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

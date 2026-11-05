/**
 * World Map: the plan of a town, the same for the paint and the buildings.
 *
 * Owner, 2026-11-04, over a 747 low across Gateway: "SIR ARE THESE HOUSES??".
 * They were not: the town was a picture of a town painted on the ground
 * (worldmap/world-terrain.js) with a little real town stood in the middle of it,
 * on streets of its own that the picture knew nothing about.
 *
 * A town is now ONE plan, and it is arithmetic. Every town has a street grid: its
 * own heading (along the road that runs through it), bent a little so no street
 * is ruler-straight. Streets every PU by PV metres, every third or fourth one a
 * main street. Each block is cut into lots, two rows back to back, each lot
 * facing its street. Which lot has what follows from a hash of the lot's numbers
 * and nothing else, so:
 *
 *   - worldmap/world-terrain.js evaluates the plan per fragment (GLSL below): the
 *     streets, the kerbs and every far roof, drawn on the ground;
 *   - worldmap/town-stream.js evaluates the same plan per cell, in the worker, and
 *     stands a real building on the very rectangle the paint had a roof on, the
 *     roof the same colour. A house coming up out of the ground 3 km off therefore
 *     comes up exactly out of its own picture: nothing pops, and nothing doubles;
 *   - any cell can be answered alone, in any order, with no state, on any thread.
 *
 * The GLSL is written from the constants here, and its hash is the same 32-bit
 * integer arithmetic as tuh() below, so the two can not drift apart.
 *
 * Pure: no meshes, no DOM. Runs in the worker, on the main thread and in node.
 */
import { vnoise } from './landcover.js';

/** The grid, in metres. */
export const GRID = Object.freeze({
  /** Street spacing: PU along the long side of a block, PV across it. */
  PU: 128,
  PV: 86,
  /** Half the road reserve (kerb to kerb and a pavement each side): an ordinary street, and a main one. */
  ROW: 6.8,
  ROW_MAIN: 10.6,
  /** The pavement. */
  WALK: 2.3,
  WALK_MAIN: 3.2,
  /** Every EVERY_U-th street across the blocks, and every EVERY_V-th along them, is a main street. */
  EVERY_U: 4,
  EVERY_V: 3,
  /** The bend: `A` metres at wavelengths 2 pi L1 and 2 pi L2. */
  A: 34,
  L1: 300,
  L2: 380,
});

const SHIFT = 1200000; // Divisible by both EVERY_s: keeps the modulo positive, here and in the shader.
export const mainU = (i) => (i + SHIFT) % GRID.EVERY_U === 0;
export const mainV = (j) => (j + SHIFT) % GRID.EVERY_V === 0;
const halfU = (i) => (mainU(i) ? GRID.ROW_MAIN : GRID.ROW);
const halfV = (j) => (mainV(j) ? GRID.ROW_MAIN : GRID.ROW);

/** The hash: 32-bit integers, the same bits in JS and in GLSL ES 3.00. */
export function tuh(a, b, c) {
  let h = (Math.imul(a, 0x9e3779b1) ^ Math.imul(b, 0x85ebca77) ^ Math.imul(c, 0xc2b2ae3d)) >>> 0;
  h = (h ^ (h >>> 15)) >>> 0;
  h = Math.imul(h, 0x2c1b3c6d) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h;
}
const tub = (h, sh) => ((h >>> sh) & 255) / 255;

/*
 * Palettes, by climate (0 temperate, 1 warm, 2 cold), in sRGB. Roofs are shared
 * with the shader (GLSL_TOWN), which is what lets the paint's roof be the house's.
 */
export const ROOFS = Object.freeze([
  // Slate, red-brown tile, grey concrete tile, warm brown, charcoal, weathered red.
  [[0.40, 0.42, 0.45], [0.58, 0.33, 0.25], [0.52, 0.51, 0.49], [0.44, 0.34, 0.27], [0.27, 0.27, 0.29], [0.63, 0.40, 0.30]],
  // Terracotta, mostly; pale render and a little tin.
  [[0.72, 0.39, 0.25], [0.66, 0.34, 0.22], [0.78, 0.47, 0.30], [0.61, 0.60, 0.56], [0.74, 0.43, 0.28], [0.52, 0.53, 0.52]],
  // Black, dark green and oxide red metal: a northern harbour.
  [[0.20, 0.21, 0.23], [0.48, 0.20, 0.17], [0.24, 0.32, 0.28], [0.30, 0.31, 0.33], [0.55, 0.25, 0.19], [0.17, 0.18, 0.20]],
]);
const WALLS = Object.freeze([
  [[0.86, 0.83, 0.76], [0.78, 0.73, 0.65], [0.82, 0.80, 0.77], [0.62, 0.38, 0.30], [0.90, 0.88, 0.84], [0.70, 0.66, 0.60], [0.56, 0.60, 0.62], [0.74, 0.62, 0.48]],
  [[0.94, 0.92, 0.86], [0.96, 0.90, 0.78], [0.92, 0.84, 0.74], [0.86, 0.90, 0.88], [0.97, 0.95, 0.92], [0.90, 0.78, 0.66], [0.80, 0.88, 0.86], [0.95, 0.86, 0.70]],
  [[0.62, 0.20, 0.16], [0.86, 0.70, 0.34], [0.90, 0.90, 0.88], [0.26, 0.34, 0.40], [0.72, 0.28, 0.20], [0.82, 0.82, 0.78], [0.34, 0.42, 0.36], [0.80, 0.62, 0.30]],
]);
const GARDEN = Object.freeze([[0.37, 0.44, 0.27], [0.45, 0.47, 0.27], [0.43, 0.44, 0.31]]);
const CARS = Object.freeze([[0.72, 0.74, 0.76], [0.14, 0.16, 0.19], [0.46, 0.09, 0.10], [0.88, 0.88, 0.86], [0.17, 0.27, 0.40], [0.34, 0.36, 0.38]]);
const REGION_CLIMATE = Object.freeze({ westreach: 0, sound: 1, sunstring: 1, sands: 1, skerries: 2, outposts: 2 });

const lin = (c) => Math.pow(c, 2.2);
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/* ------------------------------------------------------------------ */
/* A town's frame                                                       */
/* ------------------------------------------------------------------ */

/**
 * The town's own grid: its centre, how far it runs, its heading and its climate.
 *
 * `f` is the town's level ground, with { town } as preview.js makeDef puts it.
 * The heading is the way the town's roads mostly run, so the high street is one
 * of its streets rather than a thing cutting across them; quantised to the byte
 * the ground's tiles hand the shader.
 */
export function townFrame(f, roads = []) {
  const t = f.town || {};
  const cx = (f.x0 + f.x1) / 2;
  const cz = (f.z0 + f.z1) / 2;
  const hx = (f.x1 - f.x0) / 2;
  const hz = (f.z1 - f.z0) / 2;
  const H = Math.PI / 2;
  let sx = 0;
  let sy = 0;
  const near = [];
  for (const r of roads) {
    const p = r.path;
    for (let i = 1; i < p.length; i++) {
      const mx = (p[i][0] + p[i - 1][0]) / 2;
      const mz = (p[i][1] + p[i - 1][1]) / 2;
      const d = Math.hypot(mx - cx, mz - cz);
      if (d > hx * 1.6 + 60) continue;
      near.push([p[i - 1][0], p[i - 1][1], p[i][0], p[i][1], r.halfWidth || 8]);
      if (d > hx) continue;
      const dx = p[i][0] - p[i - 1][0];
      const dz = p[i][1] - p[i - 1][1];
      const L = Math.hypot(dx, dz);
      const a = Math.atan2(-dz, dx);
      sx += L * Math.cos(4 * a);
      sy += L * Math.sin(4 * a);
    }
  }
  let a = sx || sy ? Math.atan2(sy, sx) / 4 : (tuh(Math.round(cx), Math.round(cz), 7) / 4294967296) * H;
  a = ((a % H) + H) % H;
  const byte = Math.min(255, Math.round((a / H) * 255));
  const ang = (byte / 255) * H;
  const towers = t.towers | 0;
  return {
    id: f.id,
    name: t.name || f.name,
    cx,
    cz,
    hx,
    hz,
    elev: f.y ?? f.elev ?? t.elev ?? 0,
    byte,
    ang,
    c: Math.cos(ang),
    s: Math.sin(ang),
    // Downtown's reach, as a share of the town. A village's is its few shops.
    core: Math.max(towers ? Math.min(0.4, 0.2 + towers * 0.008) : t.village ? 0.1 : 0.17, 100 / Math.max(hx, hz)),
    towers,
    towerMaxH: t.towerMaxH || 0,
    village: !!t.village,
    count: t.count || 0,
    airport: t.airport ?? null,
    climate: REGION_CLIMATE[t.region] ?? 0,
    roads: near,
  };
}

/** World metres to the town's street coordinates (the shader's Q). */
export function toGrid(F, x, z) {
  const u = F.c * x - F.s * z;
  const v = F.s * x + F.c * z;
  return [u + GRID.A * Math.sin(v / GRID.L1), v + GRID.A * Math.sin(u / GRID.L2 + 1.3)];
}

/** And back: the bend is gentle, so a few rounds of fixed point are exact to a millimetre. */
export function fromGrid(F, U, V) {
  let u = U;
  let v = V;
  for (let i = 0; i < 6; i++) {
    const nu = U - GRID.A * Math.sin(v / GRID.L1);
    const nv = V - GRID.A * Math.sin(u / GRID.L2 + 1.3);
    u = nu;
    v = nv;
  }
  return [F.c * u + F.s * v, -F.s * u + F.c * v];
}

/** The town's heading here, where the bend has turned it a little. */
export function headingAt(F, U, V) {
  const [ax, az] = fromGrid(F, U - 6, V);
  const [bx, bz] = fromGrid(F, U + 6, V);
  return Math.atan2(-(bz - az), bx - ax);
}

/** How built-up the ground is here (0..1): the same sum as landcover.js coverFor. */
export function urbanAt(F, x, z) {
  const d = Math.hypot((x - F.cx) / F.hx, (z - F.cz) / F.hz);
  return urbanOf(d, x, z);
}
export function urbanOf(d, x, z) {
  return 1 - smooth(0.55, 1.0, d + (vnoise(x / 160, z / 160, 21) - 0.5) * 0.25);
}

/** 0 at the very middle, 0.25 at downtown's edge, 0.5 at the end of the inner ring (the shader's zone). */
export function zoneAt(F, x, z) {
  const d = Math.hypot((x - F.cx) / F.hx, (z - F.cz) / F.hz);
  return Math.min(1, (d / F.core) * 0.25);
}

/* ------------------------------------------------------------------ */
/* Lots                                                                 */
/* ------------------------------------------------------------------ */

/** How far the end shops of a terrace stand in. */
export const SHOP_END = 2.6;

/** The block's interior: street coordinates, kerb line to kerb line. */
export function blockBox(i, j) {
  return { uA: i * GRID.PU + halfU(i), uB: (i + 1) * GRID.PU - halfU(i + 1), vA: j * GRID.PV + halfV(j), vB: (j + 1) * GRID.PV - halfV(j + 1) };
}

export const lotsInRow = (i, j) => 5 + ((tuh(i, j, 1) >>> 8) & 3);
export const isPark = (i, j) => (tuh(i, j, 1) & 255) < 16;

/**
 * Lot k of row r (0 fronts street j, 1 street j + 1) of block (i, j): the
 * building's rectangle in street coordinates, as the shader works it out.
 */
export function lotRect(i, j, r, k, zone) {
  const b = blockBox(i, j);
  const n = lotsInRow(i, j);
  const lotW = (b.uB - b.uA) / n;
  const lh = tuh(i * 8 + k, j * 2 + r, 2);
  const onMain = r === 0 ? mainV(j) : mainV(j + 1);
  const shop = onMain && zone < 0.5;
  let w;
  let d;
  let t0;
  let off;
  if (shop) {
    // A terrace of shops, shoulder to shoulder; the two at the corners stand in a little from the side street.
    w = lotW - 0.7;
    d = 11 + 5 * tub(lh, 8);
    t0 = 1.2;
    off = 0;
    if (k === 0 || k === n - 1) {
      w -= SHOP_END;
      off = (k === 0 ? 0.5 : -0.5) * SHOP_END;
    }
  } else {
    w = Math.min(lotW - 3.2, 8 + 5 * tub(lh, 0));
    d = 8 + 4.5 * tub(lh, 8);
    t0 = 4.5 + 4 * tub(lh, 16);
    off = (lotW - 3.2 - w) * (tub(lh, 24) - 0.5);
  }
  const cu = b.uA + (k + 0.5) * lotW + off;
  const cv = r === 0 ? b.vA + t0 + d / 2 : b.vB - t0 - d / 2;
  return { cu, cv, w, d, t0, off, lotW, lh, h2: tuh(i * 8 + k, j * 2 + r, 3), shop, onMain, ...b };
}

/* What stands on a lot: the kinds of thing the stream draws, one InstancedMesh each. */
export const KIND = Object.freeze({
  GABLE: 0, HIP: 1, ELL: 2, PORCH: 3, SHOP: 4, FLATS: 5, GARAGE: 6, FENCE: 7, CAR: 8, TREE_BROAD: 9, TREE_PALM: 10, TREE_CONIFER: 11,
});
export const KIND_COUNT = 12;

/*
 * Per graphics quality: how far out the buildings stand, and what else is on the lot.
 *
 * Not further than a house is three or four pixels wide: smaller than that, real
 * geometry with no anti-aliasing to speak of crawls from one pixel to the next as the
 * aeroplane moves (tests/flicker-probe.js measured 4% of the screen at 3 km), and the
 * paint's own roof, which is filtered, is the better picture.
 */
export const TOWN_TIERS = Object.freeze({
  low: Object.freeze({ radius: 1250, rich: false, garages: false, fences: false, cars: 0, trees: 0.45, shadows: false }),
  medium: Object.freeze({ radius: 1700, rich: false, garages: true, fences: false, cars: 0.3, trees: 0.9, shadows: false }),
  high: Object.freeze({ radius: 2000, rich: true, garages: true, fences: true, cars: 0.55, trees: 1.3, shadows: true }),
  ultra: Object.freeze({ radius: 2600, rich: true, garages: true, fences: true, cars: 0.7, trees: 1.7, shadows: true }),
});

/** Which house, on what share of the lots, by climate: gable, hipped, L with a garage, porch. */
const MIX = Object.freeze([
  [0.40, 0.18, 0.27, 0.15],
  [0.10, 0.46, 0.14, 0.30],
  [0.70, 0.04, 0.20, 0.06],
]);

function houseKind(climate, q) {
  const m = MIX[climate];
  let a = 0;
  for (let k = 0; k < 4; k++) {
    a += m[k];
    if (q < a) return k;
  }
  return 0;
}

/** Is a point in the way of something the town must leave alone: a road, a helipad, a runway's lanes? */
function blockedAt(ctx, F, x, z, r) {
  for (const seg of F.roads) {
    const ax = seg[0];
    const az = seg[1];
    const bx = seg[2] - ax;
    const bz = seg[3] - az;
    const l2 = bx * bx + bz * bz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * bx + (z - az) * bz) / l2));
    const need = roadClear(seg[4]) + r;
    const qx = x - ax - bx * t;
    const qz = z - az - bz * t;
    if (qx * qx + qz * qz < need * need) return true;
  }
  for (const p of ctx.keepOut || []) if ((x - p[0]) ** 2 + (z - p[1]) ** 2 < (p[2] + r) ** 2) return true;
  for (const a of ctx.lanes || ctx.airports || []) {
    if (Math.abs(z - a.z) < 420 + r && Math.abs(x - a.x) < a.length / 2 + 3200) return true;
  }
  return false;
}
/** A road's tarmac and verge in town: the network's `halfWidth` is its level strip, 18 m for a field's road. */
export const roadClear = (hw) => Math.min(hw, 9) + 2.5;

/* ------------------------------------------------------------------ */
/* A cell                                                               */
/* ------------------------------------------------------------------ */

export const TOWN_CELL = 1024;

/** Which towns reach this cell. */
function townsIn(ctx, ix, iz) {
  const x0 = ix * TOWN_CELL;
  const z0 = iz * TOWN_CELL;
  return (ctx.towns || []).filter((F) => F.cx + F.hx * 1.08 > x0 && F.cx - F.hx * 1.08 < x0 + TOWN_CELL && F.cz + F.hz * 1.08 > z0 && F.cz - F.hz * 1.08 < z0 + TOWN_CELL);
}

/** The cells any town touches, as keys (the stream asks only for these). */
export function townCells(ctx) {
  const out = new Set();
  for (const F of ctx.towns || []) {
    for (let ix = Math.floor((F.cx - F.hx * 1.08) / TOWN_CELL); ix <= Math.floor((F.cx + F.hx * 1.08) / TOWN_CELL); ix++) {
      for (let iz = Math.floor((F.cz - F.hz * 1.08) / TOWN_CELL); iz <= Math.floor((F.cz + F.hz * 1.08) / TOWN_CELL); iz++) out.add(`${ix}:${iz}`);
    }
  }
  return out;
}

/** The world's growing arrays for one cell, by kind. */
class Out {
  constructor(bx, bz) {
    this.bx = bx;
    this.bz = bz;
    this.m = Array.from({ length: KIND_COUNT }, () => []);
    this.col = Array.from({ length: KIND_COUNT }, () => []);
    this.roof = Array.from({ length: KIND_COUNT }, () => []);
    this.solid = [];
  }

  /** An instance: turned `rot` about Y, scaled (sx, sy, sz), standing at (x, y, z). */
  put(kind, x, y, z, rot, sx, sy, sz, col, roof, roofK, seed) {
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    this.m[kind].push(c * sx, 0, -s * sx, 0, 0, sy, 0, 0, s * sz, 0, c * sz, 0, x - this.bx, y, z - this.bz, 1);
    this.col[kind].push(lin(col[0]), lin(col[1]), lin(col[2]));
    // w: the seed's eighth (which windows are lit) in the whole part, the roof's stretch in the fraction.
    this.roof[kind].push(lin(roof[0]), lin(roof[1]), lin(roof[2]), Math.floor(seed * 7.999) + roofK / 2);
  }

  box(x, z, rot, w, d, y0, y1) {
    const hx = (Math.abs(Math.cos(rot)) * w + Math.abs(Math.sin(rot)) * d) / 2;
    const hz = (Math.abs(Math.sin(rot)) * w + Math.abs(Math.cos(rot)) * d) / 2;
    this.solid.push(x - hx, x + hx, z - hz, z + hz, y0, y1);
  }

  /** Transferable arrays. */
  finish(stats) {
    const kinds = this.m.map((m, k) => ({ m: new Float32Array(m), col: new Float32Array(this.col[k]), roof: new Float32Array(this.roof[k]), n: m.length / 16 }));
    return { kinds, solid: new Float32Array(this.solid), stats };
  }
}

/** The arrays a finished cell hands across (the worker's transfer list). */
export function cellBuffers(cell) {
  if (!cell) return [];
  const list = [cell.solid.buffer];
  for (const k of cell.kinds) list.push(k.m.buffer, k.col.buffer, k.roof.buffer);
  return list;
}

/**
 * Everything standing in cell (ix, iz). Pure: `T` is a terrain module, `ctx`
 * from townContext, `tier` a TOWN_TIERS entry. The lot belongs to the cell its
 * building's middle is in, so nothing is planted twice. Null when no town
 * reaches the cell.
 */
export function placeTownCell(T, ctx, ix, iz, tier) {
  const list = townsIn(ctx, ix, iz);
  if (!list.length) return null;
  const x0 = ix * TOWN_CELL;
  const z0 = iz * TOWN_CELL;
  const out = new Out(x0, z0);
  const gh = T.groundHeightAt || T.heightAt;
  const stats = { lots: 0, houses: 0 };
  for (const F of list) {
    // The grid's blocks that can reach the cell: its four corners, a block's bend either way.
    let u0 = Infinity;
    let u1 = -Infinity;
    let v0 = Infinity;
    let v1 = -Infinity;
    for (const [x, z] of [[x0, z0], [x0 + TOWN_CELL, z0], [x0, z0 + TOWN_CELL], [x0 + TOWN_CELL, z0 + TOWN_CELL]]) {
      const [u, v] = toGrid(F, x, z);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u);
      v0 = Math.min(v0, v); v1 = Math.max(v1, v);
    }
    for (let i = Math.floor(u0 / GRID.PU) - 1; i <= Math.floor(u1 / GRID.PU) + 1; i++) {
      for (let j = Math.floor(v0 / GRID.PV) - 1; j <= Math.floor(v1 / GRID.PV) + 1; j++) block(T, gh, ctx, F, i, j, ix, iz, tier, out, stats);
    }
  }
  return out.finish(stats);
}

/** Can a building stand on this ground, as the street plan and the land agree? */
function ground(T, gh, F, x, z) {
  const f = T.flatAt(x, z);
  if (!f || f.kind !== 'town') return null;
  const h = gh(x, z);
  return Math.abs(h - F.elev) < 1.2 && h > 1 ? h : null;
}

function block(T, gh, ctx, F, i, j, ix, iz, tier, out, stats) {
  const inCell = (x, z) => Math.floor(x / TOWN_CELL) === ix && Math.floor(z / TOWN_CELL) === iz;
  const bc = fromGrid(F, (i + 0.5) * GRID.PU, (j + 0.5) * GRID.PV);
  const zoneB = zoneAt(F, bc[0], bc[1]);
  if (zoneB < 0.25) return; // Downtown: worldmap/outstation.js builds it, whole, at load (planDowntown).
  const park = isPark(i, j);
  const clim = F.climate;
  const n = lotsInRow(i, j);
  for (let r = 0; r < 2; r++) {
    for (let k = 0; k < n; k++) {
      const L = lotRect(i, j, r, k, zoneB);
      const [x, z] = fromGrid(F, L.cu, L.cv);
      if (!inCell(x, z)) continue;
      const u = urbanAt(F, x, z);
      if (u < 0.38) continue;
      stats.lots++;
      const q0 = tub(L.h2, 0);
      // Street trees along the main streets, in the pavement.
      if (L.onMain && tier.trees >= 0.9 && k % 2 === 0) {
        const [tx, tz] = fromGrid(F, L.cu, r === 0 ? L.vA - GRID.WALK_MAIN * 0.5 : L.vB + GRID.WALK_MAIN * 0.5);
        if (!blockedAt(ctx, F, tx, tz, 2)) tree(T, gh, F, tx, tz, L.lh, out, 0.8);
      }
      if (park) {
        // A park: a few big trees round the grass.
        if (tier.trees > 0 && q0 < 0.5) tree(T, gh, F, x, z, L.h2, out, 1.25);
        continue;
      }
      if (emptyLot(L, F, u)) continue;
      const rad = Math.hypot(L.w, L.d) / 2;
      if (blockedAt(ctx, F, x, z, rad)) continue;
      const y = ground(T, gh, F, x, z);
      if (y == null) continue;
      const hd = headingAt(F, L.cu, L.cv);
      const rot = r === 0 ? hd + Math.PI : hd;
      const front = r === 0 ? -1 : 1;
      const roof = ROOFS[clim][Math.floor(tub(L.h2, 8) * 5.999)];
      const wall = WALLS[clim][Math.floor(tub(L.h2, 16) * 7.999)];
      const seed = tub(L.h2, 24);
      if (L.shop) {
        const flats = zoneB >= 0.25 && q0 > 0.72;
        const storeys = flats ? 3 + Math.floor(tub(L.lh, 24) * 2.999) : 1 + Math.floor(tub(L.lh, 24) * 1.999);
        const h = flats ? storeys * 3 + 0.8 : 3.9 + (storeys - 1) * 3;
        out.put(flats ? KIND.FLATS : KIND.SHOP, x, y - 0.05, z, rot, L.w, h, L.d, wall, [0.5, 0.5, 0.49], 1, seed);
        out.box(x, z, rot, L.w, L.d, y - 0.3, y + h + 1);
        stats.houses++;
        continue;
      }
      const kind = houseKind(clim, q0);
      const bung = kind === KIND.HIP ? tub(L.lh, 24) < 0.75 : tub(L.lh, 24) < 0.14;
      const eaves = bung ? 3.1 + 0.5 * tub(L.h2, 3) : 5.0 + 0.9 * tub(L.h2, 3);
      const span = Math.min(L.w, L.d);
      // The geometry's roof rises 0.6 of the eaves; roofK brings it to this climate's pitch.
      const rise = span * (clim === 2 ? 0.46 : clim === 1 ? 0.24 : 0.34) * (0.88 + 0.24 * tub(L.h2, 5));
      const roofK = Math.min(1.98, rise / (eaves * 0.6));
      out.put(kind, x, y - 0.05, z, rot, L.w, eaves, L.d, wall, roof, roofK, seed);
      out.box(x, z, rot, L.w, L.d, y - 0.3, y + eaves + rise + 0.5);
      stats.houses++;
      // Round the house, on the lot. Its own axes in the world: +x along the street, +z to the street.
      const lx = Math.cos(rot);
      const lz = -Math.sin(rot);
      const fx = Math.sin(rot);
      const fz = Math.cos(rot);
      const at = (a, b) => [x + lx * a + fx * b, z + lz * a + fz * b];
      const backLen = (L.vB - L.vA) / 2 - L.t0 - L.d;
      if (tier.trees > 0) {
        const nt = Math.min(3, Math.floor(tub(L.lh, 20) * tier.trees * 2.6 + 0.4));
        for (let t = 0; t < nt; t++) {
          const h3 = tuh(i * 8 + k, j * 2 + r, 10 + t);
          const [tx, tz] = at((tub(h3, 0) - 0.5) * (L.lotW - 2), -L.d / 2 - 2.5 - tub(h3, 8) * Math.max(1, backLen - 4));
          tree(T, gh, F, tx, tz, h3, out, 1);
        }
      }
      if (tier.garages && kind !== KIND.ELL && tub(L.lh, 12) < 0.4 && L.lotW > 15) {
        const [gx, gz] = at(L.w / 2 + 3.2, -L.d / 2 + 3);
        const gy = gh(gx, gz);
        out.put(KIND.GARAGE, gx, gy - 0.05, gz, rot, 3.8, 2.5, 5.8, wall, roof, 0.7, seed);
        out.box(gx, gz, rot, 3.8, 5.8, gy - 0.3, gy + 3.6);
      }
      if (tier.cars > 0 && tub(L.h2, 4) < tier.cars) {
        // On the drive (world-terrain.js's strip, the lot's +x side), nose to the house.
        const [cx, cz] = at(L.w / 2 - 1.5, L.d / 2 + Math.max(2.6, L.t0 * 0.55));
        out.put(KIND.CAR, cx, gh(cx, cz) + 0.02, cz, rot, 1.85, 1.5, 4.5, CARS[Math.floor(tub(L.h2, 12) * 5.999)], [0, 0, 0], 1, seed);
      }
      if (tier.fences) {
        // The line between this lot and the next, the house's flank to the back of the plot.
        const edge = (r === 1 ? 1 : -1) * (L.lotW / 2 - L.off);
        const len = backLen + L.d;
        const [ex, ez] = at(edge, L.d / 2 - len / 2);
        out.put(KIND.FENCE, ex, gh(ex, ez), ez, rot, 0.3, 1.25, len, fenceColour(clim, L.lh), [0, 0, 0], 1, seed);
      }
    }
    if (tier.fences && !park) {
      // The hedge down the middle of the block.
      const vm = (blockBox(i, j).vA + blockBox(i, j).vB) / 2;
      const B = blockBox(i, j);
      const a = fromGrid(F, B.uA + 1, vm);
      const b = fromGrid(F, B.uB - 1, vm);
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      if (r === 0 && inCell(mx, mz) && urbanAt(F, mx, mz) > 0.5) {
        const y = ground(T, gh, F, mx, mz);
        if (y != null && !blockedAt(ctx, F, mx, mz, 40)) out.put(KIND.FENCE, mx, y, mz, Math.atan2(-(b[1] - a[1]), b[0] - a[0]) + Math.PI / 2, 1.1, 1.9, Math.hypot(b[0] - a[0], b[1] - a[1]), [0.2, 0.3, 0.13], [0, 0, 0], 1, 0.5);
      }
    }
  }
}

/** The lots left as gardens: one in twelve in a town, more out in a village and at the town's edge. */
export function emptyLot(L, F, u) {
  const q = tub(L.lh, 4);
  return q < (F.village ? 0.22 : 0.08) + 0.3 * (1 - smooth(0.4, 0.8, u));
}

function fenceColour(clim, h) {
  const q = tub(h, 2);
  if (q < 0.6) return clim === 2 ? [0.42, 0.33, 0.25] : [0.27, 0.35, 0.18];
  return q < 0.8 ? [0.66, 0.64, 0.58] : [0.42, 0.34, 0.26];
}

function tree(T, gh, F, x, z, h, out, big) {
  const y = ground(T, gh, F, x, z);
  if (y == null) return;
  const clim = F.climate;
  const q = tub(h, 16);
  const kind = clim === 1 ? (q < 0.55 ? KIND.TREE_PALM : KIND.TREE_BROAD) : clim === 2 ? (q < 0.8 ? KIND.TREE_CONIFER : KIND.TREE_BROAD) : q < 0.2 ? KIND.TREE_CONIFER : KIND.TREE_BROAD;
  const height = (6.5 + 5.5 * tub(h, 24)) * big;
  const l = 1.25 + 0.5 * tub(h, 20);
  out.put(kind, x, y - 0.2, z, tub(h, 4) * 6.28, height, height, height, [Math.pow(l, 0.45), Math.pow(l, 0.45), Math.pow(l, 0.45)], [0, 0, 0], 1, 0.5);
  out.box(x, z, 0, 1, 1, y, y + height * 0.8);
}

/* ------------------------------------------------------------------ */
/* Downtown                                                             */
/* ------------------------------------------------------------------ */

/**
 * Downtown, for scenery.js addTown (built whole at load, seen from a long way
 * off): the towers, tallest in the middle, on their own blocks; offices and
 * shops round the rest of each block, facing its streets. Spots in addTown's
 * own form, so the lit windows, roof plant, doors and solidity are its.
 *
 * `want` is how many buildings this tier builds at most, `towers` how many
 * towers among them. In a town with no towers this is its few shops and flats
 * round the square.
 */
export function planDowntown(T, ctx, F, { want = 200, towers = 0, towerMaxH = 150 } = {}) {
  const gh = T.groundHeightAt || T.heightAt;
  const spots = [];
  const R = Math.max(F.hx, F.hz) * F.core * 1.15;
  const [cu, cv] = toGrid(F, F.cx, F.cz);
  const blocks = [];
  const reach = Math.ceil(R / GRID.PV) + 1;
  const i0 = Math.floor(cu / GRID.PU);
  const j0 = Math.floor(cv / GRID.PV);
  for (let i = i0 - reach; i <= i0 + reach; i++) {
    for (let j = j0 - reach; j <= j0 + reach; j++) {
      const [x, z] = fromGrid(F, (i + 0.5) * GRID.PU, (j + 0.5) * GRID.PV);
      if (zoneAt(F, x, z) >= 0.25) continue;
      blocks.push({ i, j, x, z, d: Math.hypot(x - F.cx, z - F.cz) });
    }
  }
  blocks.sort((a, b) => a.d - b.d);
  let rank = 0;
  const Rnd = (a, b, c) => tuh(a, b, c) / 4294967296;
  // A tier that builds fewer leaves gaps all through the downtown (a square, a car park), not a hole at its edge.
  const fill = Math.min(1, Math.max(0.2, (want - towers) / Math.max(1, (blocks.length - Math.ceil(towers / 2)) * 7.5)));
  const stand = (x, z, rot, kind, w, d, h, front) => {
    const y = ground(T, gh, F, x, z);
    if (y == null) return false;
    if (blockedAt(ctx, F, x, z, Math.hypot(w, d) / 2)) return false;
    spots.push({ x, z, y, lo: y, rot, kind, w, d, h, scale: 1, front });
    return true;
  };
  for (const B of blocks) {
    const box = blockBox(B.i, B.j);
    const rot = headingAt(F, (box.uA + box.uB) / 2, (box.vA + box.vB) / 2);
    const lenU = box.uB - box.uA;
    const lenV = box.vB - box.vA;
    const vm = (box.vA + box.vB) / 2;
    if (rank < towers) {
      // Two towers to a block, side by side, the street front left to the podium.
      for (const e of [0.27, 0.73]) {
        if (rank >= towers) break;
        const t = 1 - rank / Math.max(1, towers);
        const q = Rnd(B.i, B.j, 21 + (e > 0.5 ? 1 : 0));
        const h = 60 + (Math.max(60, towerMaxH) - 60) * Math.pow(t, 1.25) * (0.72 + 0.28 * q);
        const w = Math.min(lenU * 0.42, 26 + 12 * Rnd(B.i, B.j, 31));
        const d = Math.min(lenV * 0.8, 24 + 12 * Rnd(B.i, B.j, 32));
        const [x, z] = fromGrid(F, box.uA + lenU * e, vm);
        if (stand(x, z, rot, 'tower', w, d, h, 1)) rank++;
      }
      continue;
    }
    // A square: the shader draws its grass and paths.
    if (isPark(B.i, B.j)) continue;
    // Offices and shops round the block, shoulder to shoulder: both long sides.
    for (let r = 0; r < 2; r++) {
      let u = box.uA + 3;
      let k = 0;
      while (u < box.uB - 14) {
        const w = Math.min(box.uB - u - 3, 16 + 10 * Rnd(B.i * 8 + k, B.j * 2 + r, 41));
        const d = Math.min(lenV / 2 - 3, 13 + 6 * Rnd(B.i * 8 + k, B.j * 2 + r, 42));
        const dc = B.d / (Math.max(F.hx, F.hz) * F.core);
        const tall = F.towers ? 14 + 20 * Rnd(B.i * 8 + k, B.j * 2 + r, 43) + (1 - dc) * 12 : 7 + 6 * Rnd(B.i * 8 + k, B.j * 2 + r, 43);
        const v = r === 0 ? box.vA + 1.2 + d / 2 : box.vB - 1.2 - d / 2;
        const [x, z] = fromGrid(F, u + w / 2, v);
        if (Rnd(B.i * 8 + k, B.j * 2 + r, 45) < fill) {
          // Among a city's offices, some glass of their own: lower than the towers, the same curtain wall.
          const glass = F.towers && w > 19 && d > 15 && Rnd(B.i * 8 + k, B.j * 2 + r, 46) < 0.3;
          stand(x, z, r === 0 ? rot + Math.PI : rot, glass ? 'tower' : 'block', w, d, glass ? 30 + tall * 0.7 : tall, 1);
        }
        u += w + 1.5 + 2.5 * Rnd(B.i * 8 + k, B.j * 2 + r, 44);
        k++;
      }
    }
  }
  return spots;
}

/** The town's main streets, as polylines (what the cars drive: features/ambient/lanes.js). */
export function townStreets(F) {
  const [cu, cv] = toGrid(F, F.cx, F.cz);
  const R = Math.max(F.hx, F.hz);
  const streets = [];
  const trace = (at, horizontal, hw) => {
    const pts = [];
    let run = [];
    const flush = () => {
      if (run.length > 2) streets.push({ pts: run, hw, drawn: true, painted: true, used: [0, run.length - 1] });
      run = [];
    };
    for (let s = -R * 1.1; s <= R * 1.1; s += 30) {
      const [x, z] = horizontal ? fromGrid(F, cu + s, at) : fromGrid(F, at, cv + s);
      if (urbanAt(F, x, z) > 0.42) run.push([x, z]);
      else flush();
    }
    flush();
    return pts;
  };
  const i0 = Math.floor((cu - R) / GRID.PU);
  const i1 = Math.floor((cu + R) / GRID.PU);
  const j0 = Math.floor((cv - R) / GRID.PV);
  const j1 = Math.floor((cv + R) / GRID.PV);
  for (let i = i0; i <= i1; i++) if (mainU(i)) trace(i * GRID.PU, false, GRID.ROW_MAIN - GRID.WALK_MAIN);
  for (let j = j0; j <= j1; j++) if (mainV(j)) trace(j * GRID.PV, true, GRID.ROW_MAIN - GRID.WALK_MAIN);
  return streets;
}

/* ------------------------------------------------------------------ */
/* The context                                                          */
/* ------------------------------------------------------------------ */

/** Everything placeTownCell reads, as plain data (it goes to the worker). `flats`, with `town` on the town's. */
export function townContext(D, flats, roads) {
  const towns = flats.filter((f) => f.kind === 'town' && f.town).map((f) => townFrame(f, roads));
  const keepOut = [];
  for (const p of (D.scenery && D.scenery.pads) || []) keepOut.push([p.x, p.z, (p.r || 11) + 16]);
  for (const p of D.heliports || []) keepOut.push([p.x, p.z, p.kind === 'roof' ? 42 : (p.r || 11) + 16]);
  const lh = D.scenery && D.scenery.lighthouse;
  if (lh) keepOut.push([lh[0], lh[1], 34]);
  const dp = D.scenery && D.scenery.deliveryPad;
  if (dp) keepOut.push([dp[0], dp[1], 150]);
  return { towns, keepOut, lanes: (D.airports || []).map((a) => ({ x: a.x, z: a.z, length: a.length })) };
}

/* ------------------------------------------------------------------ */
/* The same plan in the shader                                          */
/* ------------------------------------------------------------------ */

const f = (v) => (Number.isInteger(v) ? `${v}.0` : `${v}`);
const v3 = (c) => `vec3(${f(c[0])},${f(c[1])},${f(c[2])})`;

/**
 * Functions and constants for the terrain's fragment shader: `townQ` is toGrid,
 * `tuh` the hash, TROOF the roofs. (GLSL ES 3.00: three's WebGL2 programs.)
 */
export const GLSL_TOWN = `
const float TPU = ${f(GRID.PU)};
const float TPV = ${f(GRID.PV)};
const vec3 TROOF[18] = vec3[18](${ROOFS.flat().map(v3).join(',')});
const vec3 TGARDEN[3] = vec3[3](${GARDEN.map(v3).join(',')});
uint tuh(int a, int b, int c) {
  uint h = (uint(a) * 0x9E3779B1u) ^ (uint(b) * 0x85EBCA77u) ^ (uint(c) * 0xC2B2AE3Du);
  h ^= h >> 15u;
  h *= 0x2C1B3C6Du;
  h ^= h >> 13u;
  return h;
}
float tub(uint h, uint sh) { return float((h >> sh) & 255u) / 255.0; }
bool tMainU(int i) { return (i + ${SHIFT}) % ${GRID.EVERY_U} == 0; }
bool tMainV(int j) { return (j + ${SHIFT}) % ${GRID.EVERY_V} == 0; }
vec2 townQ(vec2 wp, vec2 cs) {
  vec2 q = vec2(cs.x * wp.x - cs.y * wp.y, cs.y * wp.x + cs.x * wp.y);
  return q + ${f(GRID.A)} * vec2(sin(q.y / ${f(GRID.L1)}), sin(q.x / ${f(GRID.L2)} + 1.3));
}`;

/** Hand the shader's constants on, for world-terrain.js. */
export const TOWN_ROW = Object.freeze({ ROW: GRID.ROW, ROW_MAIN: GRID.ROW_MAIN, WALK: GRID.WALK, WALK_MAIN: GRID.WALK_MAIN, SHOP_END });

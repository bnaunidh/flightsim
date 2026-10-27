/**
 * World Map preview: one terrain tile's numbers, from the height field.
 *
 * Pure: no meshes. Takes the terrain module to read (`T`), so the same code
 * runs in the tile worker (its own terrain.js instance, worldmap/
 * terrain-worker.js), on the main thread a few rows a frame when there is no
 * worker, and in node for the tests.
 *
 * A tile is (seg + 1)² vertices on a square `size` metres across centred on
 * (cx, cz), plus a skirt: one more ring of vertices under the edge, dropped,
 * so a coarse tile beside a fine one never shows a crack of sky between them.
 * Heights are sampled on a grid one ring WIDER than the tile, so the normals
 * at its edge are the same numbers the neighbouring tile computes for the
 * same vertex, and adjacent tiles of one size light as one surface.
 *
 * The ground's look — sand, grass, rock weights in `aBlend` — is the same
 * rule terrain.js buildChunk uses: low ground is beach, steep or high ground
 * rock, the rest grass, and made ground (a flat: an airfield, a town) grass.
 * UVs are world metres / 10,000, so the terrain material's 150 repeats are
 * 67 m a tile everywhere (Kestrel's 10 km chunk is the same 67 m) and every
 * tile's texture joins its neighbour's.
 */

import { coverFor } from './landcover.js';

export const UV_METRES = 10000;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * The heights over a tile's bordered grid, rows r0..r1 (of seg + 3), into
 * `out` ((seg + 3)² floats). Generator-friendly: the caller slices by rows.
 */
export function sampleRows(T, cx, cz, size, seg, out, r0, r1) {
  const W = seg + 3;
  const step = size / seg;
  const x0 = cx - size / 2 - step;
  const z0 = cz - size / 2 - step;
  // The ground, never a deck on it (terrain.js groundHeightAt: the carrier's deck is not terrain).
  const h = T.groundHeightAt || T.heightAt;
  for (let j = r0; j < r1; j++) {
    const z = z0 + j * step;
    for (let i = 0; i < W; i++) out[j * W + i] = h(x0 + i * step, z);
  }
}

/** Whole-tile sampling as a generator: yields after every `rows` rows. */
export function* sampleSteps(T, cx, cz, size, seg, rows = 4) {
  const W = seg + 3;
  const heights = new Float32Array(W * W);
  for (let r = 0; r < W; r += rows) {
    sampleRows(T, cx, cz, size, seg, heights, r, Math.min(W, r + rows));
    yield;
  }
  return heights;
}

/**
 * The tile's vertex arrays from its bordered heights. `flatAt(x, z)` (truthy
 * on made ground) is optional. Returns null when every vertex is under the
 * sea by more than half a metre: nothing to draw (the sea is drawn over the
 * sea floor and the terrain shader discards what is under it anyway).
 */
export function assemble(heights, cx, cz, size, seg, flatAt = null, cover = null) {
  const W = seg + 3;
  const N = seg + 1;
  const step = size / seg;
  let maxH = -Infinity;
  for (let j = 1; j <= N; j++) for (let i = 1; i <= N; i++) maxH = Math.max(maxH, heights[j * W + i]);
  if (maxH < -0.5) return null;
  const skirt = Math.min(240, Math.max(12, step * 1.2));
  const ring = 4 * seg;
  const count = N * N + ring;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const blend = new Float32Array(count * 3);
  // What covers the ground (worldmap/landcover.js): farmland, forest, scrub, marsh. Only where the map asks for it.
  // Bytes, 0..255 for 0..1 (normalised attributes): a fifth of the floats' upload, for a cover nobody can tell to 0.4%.
  const cov = cover ? new Uint8Array(count * 4) : null;
  const urb = cover ? new Uint8Array(count) : null;
  const B = (v) => (v <= 0 ? 0 : v >= 1 ? 255 : Math.round(v * 255));
  const uv = new Float32Array(count * 2);
  const H = (i, j) => heights[(j + 1) * W + (i + 1)];
  let k = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++, k++) {
      const lx = -size / 2 + i * step;
      const lz = -size / 2 + j * step;
      const h = H(i, j);
      pos[k * 3] = lx;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = lz;
      // Central differences over the bordered grid.
      const dx = (H(i + 1, j) - H(i - 1, j)) / (2 * step);
      const dz = (H(i, j + 1) - H(i, j - 1)) / (2 * step);
      const inv = 1 / Math.hypot(dx, 1, dz);
      nrm[k * 3] = -dx * inv;
      nrm[k * 3 + 1] = inv;
      nrm[k * 3 + 2] = -dz * inv;
      const slope = Math.hypot(dx, dz);
      if (cov) {
        const c = cover(cx + lx, cz + lz, h, slope);
        blend[k * 3] = c[0];
        blend[k * 3 + 1] = c[1];
        blend[k * 3 + 2] = c[2];
        cov[k * 4] = B(c[3]);
        cov[k * 4 + 1] = B(c[4]);
        cov[k * 4 + 2] = B(c[5]);
        cov[k * 4 + 3] = B(c[6]);
        urb[k] = B(c[7]);
        uv[k * 2] = (cx + lx) / UV_METRES;
        uv[k * 2 + 1] = -(cz + lz) / UV_METRES;
        continue;
      }
      let sand = 1 - smoothstep(2, 30, h);
      let rock = Math.min(1, Math.max(0, smoothstep(0.3, 0.95, slope) * 0.9 + smoothstep(150, 300, h) * 0.5));
      let grass = Math.min(1, Math.max(0, 1 - sand - rock));
      if (flatAt && h > 1 && flatAt(cx + lx, cz + lz)) {
        sand = 0;
        rock = 0;
        grass = 1;
      }
      const sum = sand + grass + rock || 1;
      blend[k * 3] = sand / sum;
      blend[k * 3 + 1] = grass / sum;
      blend[k * 3 + 2] = rock / sum;
      uv[k * 2] = (cx + lx) / UV_METRES;
      uv[k * 2 + 1] = -(cz + lz) / UV_METRES;
    }
  }
  // The skirt: the edge ring again, `skirt` metres lower, same normal and look.
  const edge = edgeRing(seg);
  for (let e = 0; e < ring; e++, k++) {
    const src = edge[e];
    pos[k * 3] = pos[src * 3];
    pos[k * 3 + 1] = pos[src * 3 + 1] - skirt;
    pos[k * 3 + 2] = pos[src * 3 + 2];
    for (let c = 0; c < 3; c++) {
      nrm[k * 3 + c] = nrm[src * 3 + c];
      blend[k * 3 + c] = blend[src * 3 + c];
    }
    if (cov) {
      for (let c = 0; c < 4; c++) cov[k * 4 + c] = cov[src * 4 + c];
      urb[k] = urb[src];
    }
    uv[k * 2] = uv[src * 2];
    uv[k * 2 + 1] = uv[src * 2 + 1];
  }
  return cov ? { pos, nrm, blend, uv, cover: cov, urban: urb, maxH, count } : { pos, nrm, blend, uv, maxH, count };
}

/** The grid indices round the edge, anticlockwise, `4 * seg` of them. */
export function edgeRing(seg) {
  const N = seg + 1;
  const out = [];
  for (let i = 0; i < seg; i++) out.push(i); // top row, left to right
  for (let j = 0; j < seg; j++) out.push(j * N + seg); // right column, down
  for (let i = seg; i > 0; i--) out.push(seg * N + i); // bottom row, right to left
  for (let j = seg; j > 0; j--) out.push(j * N); // left column, up
  return out;
}

/** Triangle indices for a tile of `seg` (grid + skirt), the same for every tile of that size. */
export function tileIndex(seg) {
  const N = seg + 1;
  const grid = seg * seg * 6;
  const ring = 4 * seg;
  const idx = new Uint32Array(grid + ring * 12);
  let k = 0;
  for (let j = 0; j < seg; j++) {
    for (let i = 0; i < seg; i++) {
      const a = j * N + i;
      const b = a + 1;
      const c = a + N;
      const d = c + 1;
      // Counter-clockwise seen from above (+Y up, +Z towards the viewer).
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const edge = edgeRing(seg);
  const base = N * N;
  for (let e = 0; e < ring; e++) {
    const t0 = edge[e];
    const t1 = edge[(e + 1) % ring];
    const s0 = base + e;
    const s1 = base + ((e + 1) % ring);
    // Both windings: a skirt is seen from whichever side the gap is on.
    idx[k++] = t0; idx[k++] = s0; idx[k++] = t1;
    idx[k++] = t1; idx[k++] = s0; idx[k++] = s1;
    idx[k++] = t0; idx[k++] = t1; idx[k++] = s0;
    idx[k++] = t1; idx[k++] = s1; idx[k++] = s0;
  }
  return idx.length && N * N + ring < 65536 ? Uint16Array.from(idx) : idx;
}

/** Sample and assemble in one go (the worker, node, priming at load). */
export function buildTileData(T, cx, cz, size, seg) {
  const gen = sampleSteps(T, cx, cz, size, seg, 1 << 20);
  let r = gen.next();
  while (!r.done) r = gen.next();
  const flat = T.flatSurfaceAt ? (x, z) => !!T.flatSurfaceAt(x, z) : null;
  return assemble(r.value, cx, cz, size, seg, flat, coverFor(T));
}

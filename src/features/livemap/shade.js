/**
 * The live map's chart, one tile at a time: heights in, RGBA out.
 *
 * Pure (no DOM): the chart worker runs it, and the main thread runs the same
 * code in slices when there is no worker. The look is a modern aviation
 * chart / satellite-hybrid, not a game's debug raster:
 *
 *   SEA     shaded by depth on a log scale — turquoise over the shallows,
 *           through the map's own swell blue, to deep water — with a soft
 *           surf glow on the last two metres before the beach.
 *   COAST   anti-aliased: the zero crossing is found inside the pixel from
 *           the height and its gradient, so a coastline is a smooth curve at
 *           every zoom (never stair steps), with a thin dark stroke a pixel
 *           and a half wide whatever the scale.
 *   LAND    hypsometric tints (beach sand → lowland green → upland olive →
 *           brown → grey rock → snow), from the map's own palette so a desert
 *           map is a desert chart and a snow map a white one; hillshade from
 *           the north-west (central differences, exaggerated when zoomed out
 *           so ridges still read); 100 m contours once a pixel is under 25 m.
 *
 * `H` is (n + 2)² heights: the tile's n × n pixel centres and a one-sample
 * border round them, so every pixel has all four neighbours.
 */

import { chartColours, landColour, onIce, ICE_RGB } from '../../ui/chart-palette.js';

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;

function hexRgb(h, fallback) {
  if (!Number.isFinite(h)) return fallback;
  return [(h >> 16) & 255, (h >> 8) & 255, h & 255];
}

/** The colours for this map, worked out once (plain arrays: cloneable to a worker). */
export function chartStyle(palette) {
  const p = palette || {};
  const C = chartColours(p);
  const deep = hexRgb(p.deepWater, [18, 58, 94]);
  const swell = hexRgb(p.swell, [42, 112, 160]);
  const sh = Array.isArray(p.shallow) ? p.shallow.map((v) => Math.round(v * 255)) : [86, 200, 196];
  return {
    C,
    // Deep water a touch darker and bluer than the 3D sea's, so land pops.
    deep: [deep[0] * 0.78, deep[1] * 0.84, Math.min(255, deep[2] * 0.95 + 8)],
    mid: [swell[0] * 0.92, swell[1] * 0.98, Math.min(255, swell[2] * 1.02)],
    shallow: [Math.min(255, sh[0] * 0.92 + 24), Math.min(255, sh[1] * 0.92 + 26), Math.min(255, sh[2] * 0.9 + 30)],
    surf: [236, 248, 246],
    coast: [26, 44, 52],
    snowMap: !!p.snow,
  };
}

/**
 * Shade rows [j0, j1) of a tile into `out` (n × n × 4 bytes).
 * @param {Float32Array} H (n+2)² heights, row-major, border included
 * @param {number} n pixels a side
 * @param {number} step metres a pixel
 * @param {object} S chartStyle()
 * @param {Uint8ClampedArray} out
 * @param {object} [opt] { x0, z0 (world position of pixel 0's centre), ice: iceShapes() }
 */
export function shadeRows(H, n, step, S, out, j0 = 0, j1 = n, opt = null) {
  const W = n + 2;
  const C = S.C;
  const px = [0, 0, 0];
  // Zoomed out, a 500 m pixel averages every ridge away: exaggerate the relief
  // with the scale so the mountains still read (1x at 25 m a pixel, 4x at 400).
  const ex = Math.max(1, Math.min(4, Math.sqrt(step / 25)));
  const contours = step < 25;
  const ice = opt && opt.ice && opt.ice.length ? opt.ice : null;
  const LN60 = Math.log(61);
  for (let j = j0; j < j1; j++) {
    const row = (j + 1) * W;
    for (let i = 0; i < n; i++) {
      const k = row + i + 1;
      const h = H[k];
      const hl = H[k - 1];
      const hr = H[k + 1];
      const hu = H[k - W];
      const hd = H[k + W];
      const gx = (hr - hl) / (2 * step);
      const gz = (hd - hu) / (2 * step);
      const grad = Math.sqrt(gx * gx + gz * gz) * step; // metres of height across one pixel
      let r;
      let g;
      let b;
      // ---- water colour (also the colour under a coast pixel's sea half) ----
      const d = Math.max(0, -h);
      const t = clamp01(Math.log(1 + d) / LN60);
      let wr;
      let wg;
      let wb;
      if (t < 0.35) {
        const u = t / 0.35;
        wr = lerp(S.shallow[0], S.mid[0], u);
        wg = lerp(S.shallow[1], S.mid[1], u);
        wb = lerp(S.shallow[2], S.mid[2], u);
      } else {
        const u = (t - 0.35) / 0.65;
        wr = lerp(S.mid[0], S.deep[0], u);
        wg = lerp(S.mid[1], S.deep[1], u);
        wb = lerp(S.mid[2], S.deep[2], u);
      }
      // Surf: the last two metres of water before the beach glow.
      if (d < 2.2) {
        const s = (1 - d / 2.2) * 0.42;
        wr = lerp(wr, S.surf[0], s);
        wg = lerp(wg, S.surf[1], s);
        wb = lerp(wb, S.surf[2], s);
      }
      // ---- land colour ----
      let lr = 0;
      let lg = 0;
      let lb = 0;
      const landish = h > -grad - 0.5;
      if (landish) {
        const hh = Math.max(0, h);
        if (ice && opt && onIce(ice, opt.x0 + i * step, opt.z0 + j * step)) {
          lr = ICE_RGB[0];
          lg = ICE_RGB[1];
          lb = ICE_RGB[2];
        } else {
          landColour(hh, (gx + gz) * 0.5 * ex, C, px, 0.5);
          // landColour has its own (mild) shade; take it back out and use the
          // chart's proper hillshade below instead.
          const own = 1 + Math.max(-0.42, Math.min(0.42, (gx + gz) * 0.5 * ex * 2));
          lr = px[0] / own;
          lg = px[1] / own;
          lb = px[2] / own;
          // Hypsometric tints: fresh lowland green by the shore, deeper green
          // inland, olive-brown uplands — so a plain 60 m high is not one flat carpet.
          if (!S.snowMap) {
            const low = clamp01((hh - 6) / 140);
            lr *= lerp(1.1, 0.86, low);
            lg *= lerp(1.12, 0.92, low);
            lb *= lerp(1.0, 0.84, low);
            const up = clamp01((hh - 40) / 260) * (1 - clamp01((hh - 520) / 400));
            lr = lerp(lr, lr * 1.18 + 14, up * 0.55);
            lg = lerp(lg, lg * 1.04 + 6, up * 0.55);
            lb = lerp(lb, lb * 0.9, up * 0.55);
          }
          // A soft mottle, a few kilometres across (fields, woods, scrub read
          // as patches from height): plus or minus 5%, never a pattern.
          if (opt) {
            const wx = opt.x0 + i * step;
            const wz = opt.z0 + j * step;
            const m = 1 + 0.05 * Math.sin(wx * 0.0011 + Math.sin(wz * 0.0007) * 2.3) * Math.cos(wz * 0.0013 - wx * 0.0004 + 0.8);
            lr *= m;
            lg *= m;
            lb *= m;
          }
        }
        // Hillshade: sun from the north-west, 45 degrees up.
        const nx = -gx * ex;
        const nz = -gz * ex;
        const inv = 1 / Math.sqrt(nx * nx + nz * nz + 1);
        // Light vector (-0.5, 0.707, -0.5) normalised, x east and z south: from the NW.
        const lit = (nx * -0.5 + 0.7071 + nz * -0.5) * inv;
        const shade = 0.62 + 0.56 * clamp01(lit);
        lr *= shade;
        lg *= shade;
        lb *= shade;
        if (contours && hh > 20) {
          const c0 = Math.floor(h / 100);
          if (Math.floor(hr / 100) !== c0 || Math.floor(hd / 100) !== c0) {
            lr *= 0.86;
            lg *= 0.86;
            lb *= 0.86;
          }
        }
      }
      // ---- the coast: blend by how much of the pixel is land ----
      if (h > grad + 0.5) {
        r = lr;
        g = lg;
        b = lb;
      } else if (!landish) {
        r = wr;
        g = wg;
        b = wb;
      } else {
        const cov = clamp01(0.5 + h / Math.max(0.05, grad));
        r = lerp(wr, lr, cov);
        g = lerp(wg, lg, cov);
        b = lerp(wb, lb, cov);
      }
      // A thin, dark coastline over the crossing (about a pixel and a half).
      if (grad > 0.0001) {
        const line = 1 - Math.abs(h) / (grad * 0.8);
        if (line > 0) {
          const a = Math.min(1, line) * 0.5;
          r = lerp(r, S.coast[0], a);
          g = lerp(g, S.coast[1], a);
          b = lerp(b, S.coast[2], a);
        }
      }
      const o = (j * n + i) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  return out;
}

/** Heights for rows [j0, j1) of the (n+2)² grid, border included, into H. */
export function sampleRows(heightAt, x0, z0, step, n, H, j0, j1) {
  const W = n + 2;
  for (let j = j0; j < j1; j++) {
    const z = z0 + (j - 1) * step;
    const row = j * W;
    for (let i = 0; i < W; i++) H[row + i] = heightAt(x0 + (i - 1) * step, z);
  }
}

/** A whole tile at once (the worker's way): x0, z0 the world position of pixel 0's centre. */
export function shadeTile(heightAt, x0, z0, step, n, S, opt = null) {
  const H = new Float32Array((n + 2) * (n + 2));
  sampleRows(heightAt, x0, z0, step, n, H, 0, n + 2);
  const out = new Uint8ClampedArray(n * n * 4);
  shadeRows(H, n, step, S, out, 0, n, { ...(opt || {}), x0, z0 });
  return out;
}

/**
 * A tsunami's plan: where it comes ashore, how big, and when.
 *
 * Pure (no three, no DOM): the feature (features/tsunami.js) asks for a plan
 * at the aeroplane's position, hands the field to the sea (sea-state.js
 * setTsunami) and then only moves two numbers a frame (stateAt). The wave
 * itself — its shape, and the one formula the shader and the CPU share — is
 * sea-state.js tsunamiAt.
 *
 * The ground here is always the ground (terrain.js groundHeightAt): a carrier's
 * deck is not a hill in the sea.
 *
 * WHAT HAPPENS, in order (seconds are for a middling map; see planTsunami):
 *   0      the warning
 *   6-26   the sea draws back from every shallow shore in the field (D metres)
 *   8      the first front sets off from the far edge of the field, offshore
 *   ~80    it reaches the shore: a long bulge, 45% of its height in deep water
 *          and all of it in the shallows, steep in front and long behind
 *   then   it runs up over low ground — no further than `runup` metres from
 *          the sea and no higher than H — and drains as the crest goes by;
 *          one or two smaller crests follow, a `gap` apart
 *   end    the last crest has left the far side of the field
 *
 * THE FIELD is what keeps it off high ground and off the whole island: the
 * water's height falls to nothing by `runup` metres from the nearest sea, so
 * however flat the land is the flood is a strip along the coast; and the lee
 * of the island gets a wave less than half the size.
 */

import { groundHeightAt as heightAt } from './terrain.js';
import { TSU_LAND_MAX } from './sea-state.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v, a, b) => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** How far from the aeroplane a coast is looked for. */
export const COAST_REACH = 7000;
/** A crest's height in the lee of the land, as a share. */
export const LEE = 0.4;
/** Shallow water (the sea draws back, and a crest stands up): full at SHALLOW[0] metres deep, none past SHALLOW[1]. */
export const SHALLOW = [6, 22];

/** The map's size, from its chunks (a streamed map has none: a middling size). */
export function mapSpan(map) {
  const chunks = (map && map.chunks) || [];
  if (!chunks.length) return 10000;
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of chunks) {
    x0 = Math.min(x0, c.cx - c.size / 2);
    x1 = Math.max(x1, c.cx + c.size / 2);
    z0 = Math.min(z0, c.cz - c.size / 2);
    z1 = Math.max(z1, c.cz + c.size / 2);
  }
  return Math.max(x1 - x0, z1 - z0);
}

/** The nearest coast to (x, z): the point, and the unit vector from the sea to the land there. Null: none in reach. */
export function nearestCoast(x, z, height = heightAt, reach = COAST_REACH) {
  const here = height(x, z) >= 0;
  let best = null;
  for (let a = 0; a < 32; a++) {
    const dx = Math.cos((a / 32) * Math.PI * 2);
    const dz = Math.sin((a / 32) * Math.PI * 2);
    const far = best ? best.r : reach;
    for (let r = 40; r <= far; r += 40) {
      if (height(x + dx * r, z + dz * r) >= 0 === here) continue;
      // Bisect to the waterline.
      let lo = r - 40;
      let hi = r;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        if (height(x + dx * mid, z + dz * mid) >= 0 === here) lo = mid;
        else hi = mid;
      }
      best = { r: hi, x: x + dx * hi, z: z + dz * hi };
      break;
    }
  }
  if (!best) return null;
  // Which way is inland: toward the land round about, at two scales.
  let ix = 0;
  let iz = 0;
  for (const R of [250, 700, 1400]) {
    for (let a = 0; a < 24; a++) {
      const dx = Math.cos((a / 24) * Math.PI * 2);
      const dz = Math.sin((a / 24) * Math.PI * 2);
      const land = height(best.x + dx * R, best.z + dz * R) >= 0 ? 1 : -1;
      ix += dx * land;
      iz += dz * land;
    }
  }
  let len = Math.hypot(ix, iz);
  if (len < 1e-3) {
    // No telling from the shape of the coast: from the sea toward wherever the aeroplane is, if that is the land.
    ix = (x - best.x) * (here ? 1 : -1);
    iz = (z - best.z) * (here ? 1 : -1);
    len = Math.hypot(ix, iz) || 1;
  }
  return { x: best.x, z: best.z, dx: ix / len, dz: iz / len, dist: best.r };
}

/**
 * The plan for a tsunami met at (x, z) on a map `span` metres across.
 * Null where there is no sea to bring one: an aeroplane on land with no
 * coast in reach. Out at sea with no land in reach it is a long swell
 * going by, which is what a tsunami is in deep water.
 */
export function planTsunami({ x, z, span = 10000, quality = 'high', height = heightAt, bearing = 0 } = {}) {
  const k = clamp((span - 6000) / 8000, 0, 1);
  const coast = nearestCoast(x, z, height);
  let cx = x;
  let cz = z;
  let dx = Math.sin(bearing);
  let dz = -Math.cos(bearing);
  const half = 1900 + 1300 * k;
  let shore = !!coast;
  if (coast) {
    dx = coast.dx;
    dz = coast.dz;
    // The field holds the shore and the aeroplane both; a ship too far out for that gets the wave going by on its way in.
    const reach = half * 0.55;
    if (coast.dist <= reach) {
      cx = coast.x;
      cz = coast.z;
    } else if (coast.dist <= half * 1.25) {
      cx = coast.x + (x - coast.x) * (1 - reach / coast.dist);
      cz = coast.z + (z - coast.z) * (1 - reach / coast.dist);
    } else shore = false;
  } else if (height(x, z) >= 0) return null;
  const low = quality === 'low';
  // Where the shore is along the wave's travel, from the field's middle.
  const shoreU = shore ? (coast.x - cx) * dx + (coast.z - cz) * dz : 0;
  const n = low ? 64 : quality === 'medium' ? 96 : 128;
  const count = k > 0.4 ? 3 : 2;
  const c = 32;
  const tGo = 8;
  const gap = 950 + 250 * k;
  const U0 = -0.92 * half;
  const plan = {
    cx,
    cz,
    dx,
    dz,
    half,
    size: half * 2,
    n,
    coast: shore,
    // The shore it is making for (the field's middle, out at sea).
    fx: shore ? coast.x : cx,
    fz: shore ? coast.z : cz,
    // A crest at the shore, and how far the sea draws back first.
    H: 13.5 + 0.8 * k,
    Dmax: 6 + 1.5 * k,
    Lf: 160,
    Lb: 460,
    gap,
    off: 0.45,
    amps: [1, 0.62, count > 2 ? 0.42 : 0],
    // No water further than this from the sea, however flat the land.
    runup: 600 + 250 * k,
    c,
    U0,
    tGo,
    count,
    // The sea's grid stays even this far from the eye.
    wide: low ? 2400 : 2800,
    tDraw: [6, 26],
    tArrive: tGo + (shoreU - U0) / c,
    tEnd: tGo + (-U0 + 0.95 * half + (count - 1) * gap) / c + 4,
  };
  return plan;
}

/** Where the plan is at `t` seconds: the first front `U` (m along its travel from the field's middle) and the drawdown `D` (m). */
export function stateAt(plan, t) {
  const U = plan.U0 + plan.c * Math.max(0, t - plan.tGo);
  // Drawn back until the front has crossed the field (where it has passed, the wave's own shape has already filled it in).
  const D = plan.Dmax * smooth(t, plan.tDraw[0], plan.tDraw[1]) * (1 - smooth(U, plan.half * 0.6, plan.half * 0.95));
  return { U, D, over: t >= plan.tEnd };
}

/**
 * The field for a plan: { n, size, cx, cz, data } with n x n RGBA bytes
 * (sea-state.js setTsunami says what each channel is). About n² ground
 * soundings, once.
 */
export function buildField(plan, height = heightAt) {
  const { n, size, cx, cz } = plan;
  const texel = size / n;
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    const z = cz - size / 2 + (j + 0.5) * texel;
    for (let i = 0; i < n; i++) h[j * n + i] = height(cx - size / 2 + (i + 0.5) * texel, z);
  }
  // Metres to the nearest sea, for the land: a two-pass chamfer.
  const d = new Float32Array(n * n);
  const INF = 1e9;
  for (let i = 0; i < n * n; i++) d[i] = h[i] < 0 ? 0 : INF;
  const a = texel;
  const b = texel * 1.4142;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = j * n + i;
      let v = d[p];
      if (i > 0) v = Math.min(v, d[p - 1] + a);
      if (j > 0) {
        v = Math.min(v, d[p - n] + a);
        if (i > 0) v = Math.min(v, d[p - n - 1] + b);
        if (i < n - 1) v = Math.min(v, d[p - n + 1] + b);
      }
      d[p] = v;
    }
  }
  for (let j = n - 1; j >= 0; j--) {
    for (let i = n - 1; i >= 0; i--) {
      const p = j * n + i;
      let v = d[p];
      if (i < n - 1) v = Math.min(v, d[p + 1] + a);
      if (j < n - 1) {
        v = Math.min(v, d[p + n] + a);
        if (i < n - 1) v = Math.min(v, d[p + n + 1] + b);
        if (i > 0) v = Math.min(v, d[p + n - 1] + b);
      }
      d[p] = v;
    }
  }
  // How much land the wave has had to cross to get here: the lee of an island gets less of it.
  const ex = new Float32Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      let land = 0;
      for (let s = 1; s < n; s++) {
        const ii = Math.round(i - plan.dx * s);
        const jj = Math.round(j - plan.dz * s);
        if (ii < 0 || jj < 0 || ii >= n || jj >= n) break;
        if (h[jj * n + ii] > 2) land++;
      }
      ex[j * n + i] = 1 - (1 - LEE) * smooth(land * texel, plan.runup * 1.2, plan.runup * 2.5);
    }
  }
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const p = j * n + i;
      const sea = h[p] < 0;
      // The exposure, softened over its neighbours so the lee has no hard edge.
      let e = 0;
      let cnt = 0;
      for (let q = -1; q <= 1; q++) {
        for (let r = -1; r <= 1; r++) {
          const ii = i + r;
          const jj = j + q;
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          e += ex[jj * n + ii];
          cnt++;
        }
      }
      const k4 = p * 4;
      data[k4] = Math.round(255 * (sea ? 1 : 1 - smooth(d[p], plan.runup * 0.45, plan.runup)));
      data[k4 + 1] = Math.round(255 * (sea ? 1 - smooth(-h[p], SHALLOW[0], SHALLOW[1]) : 1));
      data[k4 + 2] = Math.round(255 * clamp(h[p] / TSU_LAND_MAX, 0, 1));
      data[k4 + 3] = Math.round(255 * (e / cnt));
    }
  }
  return { n, size, cx, cz, data, texel };
}

/** The wave for the sea (sea-state.js setTsunami), from a plan and its field. */
export function waveFor(plan, field) {
  return {
    field,
    dx: plan.dx,
    dz: plan.dz,
    U: plan.U0,
    H: plan.H,
    D: 0,
    Lf: plan.Lf,
    Lb: plan.Lb,
    gap: plan.gap,
    off: plan.off,
    amps: plan.amps,
    wide: plan.wide,
  };
}

/**
 * The sea state: real moving swell.
 *
 * The sea was a flat plate with moving normal maps on it. This gives it a
 * surface that actually goes up and down — a sum of a few long sine swells in
 * world metres — drawn by displacing the sea plane in its vertex shader and
 * answered on the CPU by `waveAt(x, z)`, the SAME formula with the same
 * numbers, so a hull, a deck, a float or a camera asks the sea that is drawn.
 *
 *   h(x, z, t) = shore(x, z) · Σ aᵢ · sin(kᵢ·(x, z) − ωᵢ·t + φᵢ)
 *
 * WEATHER. One number, the sea state 0..1, from the wind and the turbulence
 * (weather.js windSpeedKts, cond.turb). It sets the significant wave height
 * (0.25 m on a calm clear day to about 2.6 m in a storm) and moves the energy
 * from the short swells to the long ones, so a storm's sea is both higher and
 * longer. It eases over about ten seconds: the sea never jumps. Wavelengths
 * and directions are fixed for a map (a swell comes from far away, and
 * turning a wave train scrambles every phase on the map); the wind-driven
 * chop on top is the normal-map octaves the shader always had.
 *
 * SHORE. Waves shoal to nothing at the beach and are a tenth in a harbour: the
 * factor is read from the sea's own depth field (render/ocean-material.js),
 * the same texture in the shader and here, so the waterline, the surf band
 * and the berth stay where they were. A map with no depth field of its own
 * (the World Map: its ground is streamed) gets a small one that follows the
 * eye — 64 x 64 soundings, re-taken a few rows a frame as the eye moves on,
 * on a fixed lattice so nothing shifts when the new one is swapped in.
 *
 * TIERS (per-vertex work; the plane is a tensor grid, fine near the eye):
 *   low     2 swells, 20 m grid,   ~6 k vertices, slopes passed as a varying
 *   medium  4 swells, 12.5 m grid, ~17 k
 *   high    6 swells, 10 m grid,   ~37 k, swell normals per pixel
 *   ultra   6 swells, 6.25 m grid, ~74 k
 * The displacement fades out with distance from the eye, each swell where the
 * grid gets too coarse for its wavelength, so nothing far away facets or pops;
 * `waveAt` is the undamped sea (it is exact inside that radius, which is
 * where anything that floats is looked at from).
 *
 * Loaded on demand (world/water.js) so none of this is in the first load.
 */

import * as THREE from '../vendor/three.module.js';
import { SWELL, groundHeightAt } from './terrain.js';
import { depthTexelFor } from '../render/ocean-material.js';

const G = 9.81;
const TAU = Math.PI * 2;
const SEA_SIZE = 56000;

/** Every swell the High sea has: wavelength (m), bearing off the map's swell direction (deg), share calm → rough. */
export const SWELLS = [
  { len: 82, off: 9, calm: 0.9, rough: 0.75, tiers: 'lmh' },
  { len: 170, off: -14, calm: 0.4, rough: 1.0, tiers: 'lmh' },
  { len: 55, off: -21, calm: 1.0, rough: 0.5, tiers: 'mh' },
  { len: 120, off: 24, calm: 0.55, rough: 0.9, tiers: 'mh' },
  { len: 34, off: 31, calm: 0.8, rough: 0.3, tiers: 'h' },
  { len: 240, off: -5, calm: 0.15, rough: 0.6, tiers: 'h' },
];

/**
 * The grid, per tier: fine spacing (m), half-size of the fine square (m), cells in the coarse skirt.
 * `wd`: the spacing of the even band a tsunami adds outside the fine square (see axis), a divisor of FOLLOW.
 */
export const GRID = {
  low: { d: 20, inner: 400, skirt: 18, wd: 100 },
  medium: { d: 12.5, inner: 450, skirt: 28, wd: 50 },
  high: { d: 10, inner: 600, skirt: 36, wd: 50 },
  ultra: { d: 6.25, inner: 600, skirt: 40, wd: 50 },
};

/** The plane follows the eye in steps of this (a whole number of fine cells on every tier). */
export const FOLLOW = 100;

/** Shoaling: no swell in under SHORE[0] metres of water, all of it past SHORE[1]; HARBOUR is what a basin keeps. */
export const SHORE = [1.5, 16];
export const HARBOUR = 0.1;

/** How much the swell's slope is exaggerated in the shading (the height is never exaggerated). */
const SHADE_GAIN = 2.0;
/*
 * How far the swell is SHADED, which is not how far it is drawn. Seen from
 * low down, waves far away are thinner than a pixel, and stripes thinner than
 * a pixel flicker as they move: measured with the flicker probe on a water
 * crash watched from 20 m up, the far sea flashed over 25% of a 10-degree
 * field with the stripes shaded all the way out, and 7% (what the flat sea
 * reads) with them faded. A wave of length L seen from height h covers a
 * pixel's footprint out to about sqrt(L · h / pixel); so each swell's shading
 * fades out by distance² = L · h · SHADE_REACH, in the shader, from the eye's
 * own height.
 */
const SHADE_REACH = 90;
/** How much lighter a crest's water is than a trough's (thinner water), as a fraction either way. */
const CREST_TINT = 0.1;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (v, a, b) => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** The sea state 0..1 the weather asks for. */
export function seaStateFor(weather) {
  if (!weather) return 0.15;
  const kts = Number.isFinite(weather.windSpeedKts) ? weather.windSpeedKts : 4;
  const turb = weather.cond && Number.isFinite(weather.cond.turb) ? weather.cond.turb : 0.1;
  return clamp(0.04 + (kts / 40) * 0.72 + turb * 0.3, 0, 1);
}

/** Significant wave height (m) at a sea state. */
export function significantHeight(s) {
  return 0.22 + 2.4 * Math.pow(clamp(s, 0, 1), 1.4);
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

function tierKey(quality) {
  return quality === 'low' ? 'l' : quality === 'medium' ? 'm' : 'h';
}

/**
 * A sea: its swells for a tier and a map, and the state they are in.
 * `mapId` picks the direction the swell runs (the same for everyone on a map).
 */
export function createSea(quality = 'high', mapId = 'kestrel', field = null) {
  const key = tierKey(quality);
  const grid = GRID[quality] || GRID.high;
  const bearing = hash(`swell:${mapId}`) * 360;
  const comps = SWELLS.filter((c) => c.tiers.includes(key)).map((c, i) => {
    const a = ((bearing + c.off) * Math.PI) / 180;
    const k = TAU / c.len;
    return {
      len: c.len,
      // Travelling toward this bearing (0 = north = −z, 90 = east = +x).
      kx: Math.sin(a) * k,
      kz: -Math.cos(a) * k,
      omega: Math.sqrt(G * k),
      phase: hash(`phase:${mapId}:${i}`) * TAU,
      calm: c.calm,
      rough: c.rough,
      amp: 0,
      geoR: geoRadius(grid, c.len),
      // For the shading's own fade (see SHADE_REACH).
      aaR: c.len * SHADE_REACH,
    };
  });
  // `gain`: all of the swell's height, scaled (1 as designed; 0 is the old flat sea, drawn and answered alike).
  const sea = { quality, mapId, grid, comps, field, t: 0, s: null, target: 0.15, hs: 0, peak: 0, gain: 1, uniforms: null };
  setSeaState(sea, 0.15);
  return sea;
}

/** How far from the eye a swell of this length is still drawn as geometry: where the grid has over three points to a wave. */
function geoRadius(grid, len) {
  const xs = axis(grid);
  const mid = (xs.length - 1) / 2;
  let r = 0;
  for (let i = mid; i < xs.length - 1; i++) {
    if (xs[i + 1] - xs[i] > len / 3.3) break;
    r = xs[i + 1];
  }
  // Less the follow step's slack: the eye can be that far off the grid's middle.
  return Math.max(grid.d * 4, r - FOLLOW * 0.71);
}

/** Put the sea in state `s` at once (0 calm .. 1 storm). */
export function setSeaState(sea, s) {
  sea.s = clamp(s, 0, 1);
  let sum2 = 0;
  for (const c of sea.comps) {
    c.w = c.calm + (c.rough - c.calm) * sea.s;
    sum2 += c.w * c.w;
  }
  // Hs = 4·sqrt(Σ a²/2)  →  a scale that gives the height asked for.
  sea.hs = significantHeight(sea.s) * sea.gain;
  const A = sea.hs / (4 * Math.sqrt(sum2 / 2));
  sea.peak = 0;
  for (const c of sea.comps) {
    c.amp = A * c.w;
    sea.peak += c.amp;
  }
  syncUniforms(sea);
  return sea;
}

/** One frame: time on, and the state eased toward what the weather wants. */
export function tickSea(sea, dt, weather) {
  sea.t += dt;
  sea.target = seaStateFor(weather);
  const next = sea.s + (sea.target - sea.s) * Math.min(1, dt / 10);
  if (Math.abs(next - sea.s) > 1e-5) setSeaState(sea, next);
  if (sea.uniforms) sea.uniforms.uTime.value = sea.t;
  if (sea.tsu) syncTsunami(sea);
}

/** The depth field read the way the shader's bilinear tap reads it: [metres of water, surf weight 0..1]. */
export function fieldAt(field, x, z, out = [34, 1]) {
  if (!field || !field.data) {
    out[0] = 34;
    out[1] = 1;
    return out;
  }
  const n = field.n;
  const u01 = (x - field.cx) * field.xform.z + 0.5;
  const v01 = (z - field.cz) * field.xform.z + 0.5;
  // Off the field's edge is open sea (the shader's `inside`).
  if (u01 < 0 || u01 > 1 || v01 < 0 || v01 > 1) {
    out[0] = 34;
    out[1] = 1;
    return out;
  }
  const u = u01 * n - 0.5;
  const v = v01 * n - 0.5;
  const i0 = clamp(Math.floor(u), 0, n - 1);
  const j0 = clamp(Math.floor(v), 0, n - 1);
  const i1 = Math.min(n - 1, i0 + 1);
  const j1 = Math.min(n - 1, j0 + 1);
  const fu = clamp(u - i0, 0, 1);
  const fv = clamp(v - j0, 0, 1);
  const d = field.data;
  const k00 = (j0 * n + i0) * 2;
  const k01 = (j0 * n + i1) * 2;
  const k10 = (j1 * n + i0) * 2;
  const k11 = (j1 * n + i1) * 2;
  for (let c = 0; c < 2; c++) {
    const a = d[k00 + c] + (d[k01 + c] - d[k00 + c]) * fu;
    const b = d[k10 + c] + (d[k11 + c] - d[k10 + c]) * fu;
    out[c] = ((a + (b - a) * fv) / 255) * (c === 0 ? 40 : 1);
  }
  return out;
}

/** A neighbour tap: clamped to the field's edge, as the sampler clamps it. */
function tapClamped(f, x, z, out) {
  const half = f.size / 2 - 1e-6;
  return fieldAt(f, clamp(x, f.cx - half, f.cx + half), clamp(z, f.cz - half, f.cz + half), out);
}

/* ------------------------------------------------------------------ */
/* A depth field that follows the eye (maps with none of their own)     */
/* ------------------------------------------------------------------ */

const LOCAL_N = 64;
/** Rows of soundings taken a frame while a new field is being made. */
const LOCAL_ROWS = 2;
/** The swell is drawn at most this far from the eye; the field always covers that much. */
const LOCAL_REACH = 1100;

function soundRows(f, j0, j1, height) {
  const n = f.n;
  const step = f.size / n;
  for (let j = j0; j < j1; j++) {
    const z = f.cz - f.size / 2 + (j + 0.5) * step;
    for (let i = 0; i < n; i++) {
      const x = f.cx - f.size / 2 + (i + 0.5) * step;
      const k = (j * n + i) * 2;
      f.data[k] = Math.round(clamp(Math.max(0, -height(x, z)) / 40, 0, 1) * 255);
      f.data[k + 1] = 255;
    }
  }
}

/** A field of soundings centred near (x, z), on a lattice of whole texels. `rows`: how many to take now. */
export function localField(quality, x, z, height = groundHeightAt, rows = LOCAL_N) {
  const texel = depthTexelFor(quality);
  const size = texel * LOCAL_N;
  const cx = Math.round(x / texel) * texel;
  const cz = Math.round(z / texel) * texel;
  const f = { n: LOCAL_N, texel, size, cx, cz, data: new Uint8Array(LOCAL_N * LOCAL_N * 2), xform: { x: cx, y: cz, z: 1 / size, w: 1 }, row: 0, local: true };
  soundRows(f, 0, Math.min(rows, LOCAL_N), height);
  f.row = Math.min(rows, LOCAL_N);
  return f;
}

/**
 * Keep the eye inside its field: start a new one when it has gone a third of
 * the way to the edge, take a few rows of it a frame, and swap it in whole.
 * A jump (a new flight somewhere else) is re-sounded at once.
 */
export function followLocal(sea, x, z, height = groundHeightAt) {
  const f = sea.field;
  if (!f || !f.local) return false;
  const slack = f.size / 2 - LOCAL_REACH;
  const off = Math.max(Math.abs(x - f.cx), Math.abs(z - f.cz));
  if (off > slack) {
    sea.next = null;
    setField(sea, localField(sea.quality, x, z, height));
    return true;
  }
  if (!sea.next && off > slack * 0.45) sea.next = localField(sea.quality, x, z, height, 0);
  const nx = sea.next;
  if (!nx) return false;
  const to = Math.min(nx.n, nx.row + LOCAL_ROWS);
  soundRows(nx, nx.row, to, height);
  nx.row = to;
  if (to < nx.n) return false;
  sea.next = null;
  setField(sea, nx);
  return true;
}

function setField(sea, f) {
  sea.field = f;
  const u = sea.uniforms;
  if (!u || !f.local) return;
  const tex = u.uSwellDepth.value;
  tex.image.data.set(f.data);
  tex.needsUpdate = true;
  u.uSwellXform.value.set(f.cx, f.cz, 1 / f.size, 1);
  u.uSwellTexel.value = 1 / f.n;
}

const _f = [34, 1];
/** How much of the open sea's swell reaches (x, z): 0 at the beach, HARBOUR in a basin, 1 offshore. */
export function shoreFactor(sea, x, z) {
  if (!sea || !sea.field) return 1;
  const f = sea.field;
  fieldAt(f, x, z, _f);
  let depth = _f[0];
  let surf = _f[1];
  // The shallowest of here and a texel away each way, exactly as the shader takes it.
  const e = f.size / f.n;
  const u01 = (x - f.cx) * f.xform.z + 0.5;
  const v01 = (z - f.cz) * f.xform.z + 0.5;
  if (u01 < 0 || u01 > 1 || v01 < 0 || v01 > 1) return 1;
  for (let i = 0; i < 4; i++) {
    tapClamped(f, x + (i === 0 ? e : i === 1 ? -e : 0), z + (i === 2 ? e : i === 3 ? -e : 0), _f);
    if (_f[0] < depth) depth = _f[0];
    if (_f[1] < surf) surf = _f[1];
  }
  return smooth(depth, SHORE[0], SHORE[1]) * (HARBOUR + (1 - HARBOUR) * surf);
}

/**
 * The sea at (x, z): height `h` (m above the mean sea level, y = 0) and its
 * slopes `sx` = ∂h/∂x, `sz` = ∂h/∂z. The shader's formula, term for term.
 */
export function waveAt(sea, x, z, out = {}, t = sea ? sea.t : 0) {
  let h = 0;
  let sx = 0;
  let sz = 0;
  if (sea) {
    for (let i = 0; i < sea.comps.length; i++) {
      const c = sea.comps[i];
      const th = c.kx * x + c.kz * z - c.omega * t + c.phase;
      const co = c.amp * Math.cos(th);
      h += c.amp * Math.sin(th);
      sx += co * c.kx;
      sz += co * c.kz;
    }
    const k = shoreFactor(sea, x, z);
    h *= k;
    sx *= k;
    sz *= k;
    // The tsunami is not shoaled away at the beach: it is the one wave that comes ashore.
    const w = sea.tsu;
    if (w) {
      tsunamiAt(sea, x, z, _ts);
      h += _ts.h;
      sx += _ts.s * w.dx;
      sz += _ts.s * w.dz;
    }
  }
  out.h = h;
  out.sx = sx;
  out.sz = sz;
  return out;
}

const _w = {};
const _ts = {};
const _q = [0, 0, 0, 0];

/* ------------------------------------------------------------------ */
/* The tsunami                                                          */
/* ------------------------------------------------------------------ */

/** The land's height in the tsunami's field: bytes over 0..TSU_LAND_MAX metres. */
export const TSU_LAND_MAX = 32;
/** The field's edge: the wave fades in and out between these, as a share of the field (0.5 = the edge itself). */
export const TSU_EDGE = [0.38, 0.5];

/**
 * A tsunami on this sea, or none (null). `w`, all in world metres:
 *
 *   field  { n, size, cx, cz, data }  n x n texels of RGBA bytes over a square
 *          of the map: R how much of the wave gets this far (1 at sea and on
 *          the shore, 0 past the run-up limit inland), G how shallow it is
 *          (0 deep water, 1 the shore and the land), B the land's height,
 *          A how exposed to the wave (less in the lee of the island)
 *   dx,dz  the way it travels (unit)        U    where the first front is, along that, from the field's middle
 *   H      a crest's height at the shore    D    how far the sea has drawn back at the shore, now
 *   Lf,Lb  a crest's width ahead and behind gap  metres between crests
 *   amps   each crest's share of H (three)  off  the share of H a crest has in deep water
 *   wide   how far from the eye the sea's grid stays even enough to draw it
 *
 *   h = edge . R . ( H . mix(off, 1, G) . A . sum(amp_i . exp(-(xi_i / L)^2))  -  D . G . ahead(xi_0) )
 *
 * with xi_i the distance ahead of crest i. The feature (features/tsunami.js)
 * moves U and D each frame; this is drawn (tsuAt in the shader) and answered
 * (tsunamiAt, and so waveAt) from the same numbers.
 */
export function setTsunami(sea, w) {
  if (!sea) return;
  sea.tsu = w || null;
  const u = sea.uniforms;
  if (u && u.uTsuXform) {
    if (w) {
      const f = w.field;
      const tex = new THREE.DataTexture(f.data, f.n, f.n, THREE.RGBAFormat, THREE.UnsignedByteType);
      tex.minFilter = tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.needsUpdate = true;
      if (sea.tsuTex) sea.tsuTex.dispose();
      sea.tsuTex = tex;
      u.uTsuMap.value = tex;
      u.uTsuXform.value.set(f.cx, f.cz, 1 / f.size, 1);
    } else {
      u.uTsuXform.value.w = 0;
      // The field goes with the wave.
      if (sea.tsuTex) {
        u.uTsuMap.value = sea.tsuNone;
        sea.tsuTex.dispose();
        sea.tsuTex = null;
      }
    }
  }
  // A grid that is even far enough out to carry a wave a few hundred metres long, for as long as there is one.
  const wide = (w && w.wide) || 0;
  if (sea.mesh && (sea.wide || 0) !== wide) {
    const old = sea.mesh.geometry;
    sea.mesh.geometry = seaGeometry(sea.quality, wide);
    if (old) old.dispose();
  }
  sea.wide = wide;
  syncTsunami(sea);
}

function syncTsunami(sea) {
  const w = sea.tsu;
  const u = sea.uniforms;
  if (!w || !u || !u.uTsuWave) return;
  u.uTsuWave.value.set(w.dx, w.dz, w.U, w.H);
  u.uTsuShape.value.set(w.D, w.Lf, w.Lb, w.gap);
  u.uTsuAmp.value.set(w.amps[0] || 0, w.amps[1] || 0, w.amps[2] || 0, w.off);
}

/**
 * The tsunami alone at (x, z): `h` its height (m, negative where the sea has
 * drawn back), `s` its slope along the way it travels, `land` the field's
 * height of the ground there, `foam` 0..1 on a breaking face. The shader's
 * tsuAt, term for term.
 */
export function tsunamiAt(sea, x, z, out = {}) {
  out.h = 0;
  out.s = 0;
  out.land = 0;
  out.foam = 0;
  const w = sea && sea.tsu;
  if (!w) return out;
  const f = w.field;
  const u01 = (x - f.cx) / f.size + 0.5;
  const v01 = (z - f.cz) / f.size + 0.5;
  const m = Math.max(Math.abs(u01 - 0.5), Math.abs(v01 - 0.5));
  if (m >= 0.5) return out;
  const n = f.n;
  const uu = u01 * n - 0.5;
  const vv = v01 * n - 0.5;
  const i0 = clamp(Math.floor(uu), 0, n - 1);
  const j0 = clamp(Math.floor(vv), 0, n - 1);
  const i1 = Math.min(n - 1, i0 + 1);
  const j1 = Math.min(n - 1, j0 + 1);
  const fu = clamp(uu - i0, 0, 1);
  const fv = clamp(vv - j0, 0, 1);
  const d = f.data;
  const k00 = (j0 * n + i0) * 4;
  const k01 = (j0 * n + i1) * 4;
  const k10 = (j1 * n + i0) * 4;
  const k11 = (j1 * n + i1) * 4;
  for (let c = 0; c < 4; c++) {
    const a = d[k00 + c] + (d[k01 + c] - d[k00 + c]) * fu;
    const b = d[k10 + c] + (d[k11 + c] - d[k10 + c]) * fu;
    _q[c] = (a + (b - a) * fv) / 255;
  }
  const along = (x - f.cx) * w.dx + (z - f.cz) * w.dz;
  let c = 0;
  let dc = 0;
  for (let i = 0; i < 3; i++) {
    const a = w.amps[i];
    if (!a) continue;
    const xi = along - (w.U - i * w.gap);
    const L = xi > 0 ? w.Lf : w.Lb;
    const e = a * Math.exp(-(xi * xi) / (L * L));
    c += e;
    dc += e * ((-2 * xi) / (L * L));
  }
  const gain = (1 - smooth(m, TSU_EDGE[0], TSU_EDGE[1])) * _q[0];
  const amp = w.H * (w.off + (1 - w.off) * _q[1]) * _q[3];
  out.h = gain * (amp * c - w.D * _q[1] * smooth(along - w.U, -w.Lb * 0.5, w.Lf * 2));
  // The slope of both: the crests', and the ramp from the drawn-back sea up to the first of them.
  const span = w.Lf * 2 + w.Lb * 0.5;
  const k0 = clamp((along - w.U + w.Lb * 0.5) / span, 0, 1);
  out.s = gain * (amp * dc - (w.D * _q[1] * 6 * k0 * (1 - k0)) / span);
  out.land = _q[2] * TSU_LAND_MAX;
  out.foam = clamp(-gain * amp * dc * 14, 0, 1) * _q[1];
  return out;
}

export function waveHeightAt(sea, x, z, t) {
  return waveAt(sea, x, z, _w, t).h;
}

/* ------------------------------------------------------------------ */
/* The plane                                                            */
/* ------------------------------------------------------------------ */

/** The grid lines along one axis: fine and even in the middle, growing to the edge of the sea. */
export function axis(grid, wide = 0) {
  const half = SEA_SIZE / 2;
  const n = Math.round(grid.inner / grid.d);
  const xs = [];
  for (let i = 0; i <= n; i++) xs.push(i * grid.d);
  let from = grid.inner;
  let d0 = grid.d;
  // A tsunami's grid: an even band out to `wide`, on lines the follow step keeps on the same world points.
  if (wide > from && grid.wd) {
    d0 = grid.wd;
    while (from + d0 <= wide) xs.push((from += d0));
  }
  // Geometric growth over `skirt` cells from there to the edge.
  const span = half - from;
  let lo = 1.0001;
  let hi = 4;
  for (let k = 0; k < 60; k++) {
    const g = (lo + hi) / 2;
    const sum = (d0 * g * (Math.pow(g, grid.skirt) - 1)) / (g - 1);
    if (sum < span) lo = g;
    else hi = g;
  }
  const g = (lo + hi) / 2;
  let x = from;
  let step = d0;
  for (let i = 0; i < grid.skirt; i++) {
    step *= g;
    x += step;
    xs.push(i === grid.skirt - 1 ? half : x);
  }
  const out = [];
  for (let i = xs.length - 1; i > 0; i--) out.push(-xs[i]);
  for (let i = 0; i < xs.length; i++) out.push(xs[i]);
  return out;
}

/** The sea plane: in XY like THREE.PlaneGeometry (the mesh is laid flat by its own rotation). */
export function seaGeometry(quality = 'high', wide = 0) {
  const xs = axis(GRID[quality] || GRID.high, wide);
  const n = xs.length;
  const pos = new Float32Array(n * n * 3);
  let p = 0;
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      pos[p++] = xs[i];
      pos[p++] = -xs[j];
      pos[p++] = 0;
    }
  }
  const idx = new Uint32Array((n - 1) * (n - 1) * 6);
  let q = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i;
      const b = a + 1;
      const c = a + n;
      const d = c + 1;
      idx[q++] = a;
      idx[q++] = c;
      idx[q++] = b;
      idx[q++] = b;
      idx[q++] = c;
      idx[q++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SEA_SIZE * 0.71);
  geo.userData.side = n;
  return geo;
}

/* ------------------------------------------------------------------ */
/* The shader                                                           */
/* ------------------------------------------------------------------ */

/** The swells, for either stage. `SWELL_N` is a define. */
const SWELL_UNIFORMS = /* glsl */ `
  uniform vec4 uSw[SWELL_N];  // kx, kz, omega, phase
  uniform vec3 uSa[SWELL_N];  // amplitude, geometry fade radius, shading reach (× the eye's height = distance²)
  uniform float uSwellT;
`;
const SWELL_GLSL = /* glsl */ `
  ${SWELL_UNIFORMS}
  varying vec4 vSwell;        // slope x, slope z, height, shore factor
  varying vec4 vTsu;          // the tsunami: height, slope along its travel, the land's height under it, foam
`;

/** The swell at a world point: slope x, slope z, height (all shoaled), and the shore factor. */
const SWELL_AT = /* glsl */ `
  uniform sampler2D uSwellDepth;  // the depth field the swell shoals by: the sea's own, or the one that follows the eye
  uniform vec4 uSwellXform;       // origin x, origin z, 1/size, has field
  uniform vec2 uRenderOrigin;
  uniform float uSwellTexel;      // one texel of that field, in its own uv
  vec4 swellAt(vec2 p, float dist) {
    // The shallowest of here and a texel away each way: the field is too coarse to find a steep shore by itself.
    vec2 uv = (p - uSwellXform.xy) * uSwellXform.z + 0.5;
    vec2 e = vec2(uSwellTexel, 0.0);
    vec2 f = texture2D(uSwellDepth, uv).rg;
    f = min(f, min(min(texture2D(uSwellDepth, uv + e.xy).rg, texture2D(uSwellDepth, uv - e.xy).rg),
                   min(texture2D(uSwellDepth, uv + e.yx).rg, texture2D(uSwellDepth, uv - e.yx).rg)));
    // Off the field's edge is open sea.
    float inside = uSwellXform.w * step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    float depth = mix(34.0, f.r * 40.0, inside);
    float shore = smoothstep(${SHORE[0].toFixed(1)}, ${SHORE[1].toFixed(1)}, depth) * mix(${HARBOUR.toFixed(2)}, 1.0, mix(1.0, f.g, inside));
    vec3 o = vec3(0.0);
    for (int i = 0; i < SWELL_N; i++) {
      float th = dot(uSw[i].xy, p) - uSw[i].z * uSwellT + uSw[i].w;
      float a = uSa[i].x * (1.0 - smoothstep(uSa[i].y * 0.6, uSa[i].y, dist));
      o.z += a * sin(th);
      o.xy += a * cos(th) * uSw[i].xy;
    }
    return vec4(o * shore, shore);
  }
  uniform sampler2D uTsuMap;  // the tsunami's field: reach, shallowness, land height, exposure
  uniform vec4 uTsuXform;     // middle x, middle z, 1/size, on
  uniform vec4 uTsuWave;      // travelling x, z; where the first front is; a crest's height at the shore
  uniform vec4 uTsuShape;     // drawn back by (m); a crest's width ahead, behind; the gap between crests
  uniform vec4 uTsuAmp;       // each crest's share; the share of the height in deep water
  // The tsunami at a world point: height, slope along its travel, the land's height, foam (setTsunami; tsunamiAt on the CPU).
  vec4 tsuAt(vec2 p) {
    if (uTsuXform.w < 0.5) return vec4(0.0);
    vec2 uv = (p - uTsuXform.xy) * uTsuXform.z + 0.5;
    float m = max(abs(uv.x - 0.5), abs(uv.y - 0.5));
    if (m >= 0.5) return vec4(0.0);
    vec4 f = texture2D(uTsuMap, uv);
    float along = dot(p - uTsuXform.xy, uTsuWave.xy);
    float c = 0.0;
    float dc = 0.0;
    for (int i = 0; i < 3; i++) {
      float xi = along - (uTsuWave.z - float(i) * uTsuShape.w);
      float L = xi > 0.0 ? uTsuShape.y : uTsuShape.z;
      float e = uTsuAmp[i] * exp(-xi * xi / (L * L));
      c += e;
      dc += e * (-2.0 * xi / (L * L));
    }
    float gain = (1.0 - smoothstep(${TSU_EDGE[0].toFixed(2)}, ${TSU_EDGE[1].toFixed(2)}, m)) * f.r;
    float amp = uTsuWave.w * mix(uTsuAmp.w, 1.0, f.g) * f.a;
    float h = gain * (amp * c - uTsuShape.x * f.g * smoothstep(-uTsuShape.z * 0.5, uTsuShape.y * 2.0, along - uTsuWave.z));
    float span = uTsuShape.y * 2.0 + uTsuShape.z * 0.5;
    float k0 = clamp((along - uTsuWave.z + uTsuShape.z * 0.5) / span, 0.0, 1.0);
    float s = gain * (amp * dc - uTsuShape.x * f.g * 6.0 * k0 * (1.0 - k0) / span);
    return vec4(h, s, f.b * ${TSU_LAND_MAX.toFixed(1)}, clamp(-gain * amp * dc * 14.0, 0.0, 1.0) * f.g);
  }
`;

const VERT_PARS = /* glsl */ `
  ${SWELL_GLSL}
  ${SWELL_AT}
`;

const VERT_MAIN = /* glsl */ `
    vec4 sw = swellAt(wp.xz + uRenderOrigin, distance(wp.xyz, cameraPosition));
    vTsu = tsuAt(wp.xz + uRenderOrigin);
    wp.y += sw.z + vTsu.x;
    vSwell = sw;
`;

const FRAG_PARS = /* glsl */ `
  ${SWELL_GLSL}
  uniform float uSwellShade;
  uniform float uSwellTint;
  uniform float uSwellInv;
  uniform vec4 uTsuWave;
  uniform vec4 uWake;       // stern x, stern z, heading x, heading z
  uniform vec3 uWakeShape;  // strength, hull length, half beam
  vec2 swellSlope(vec2 p, float dist) {
    // Shaded only as far as a wave is still wider than a pixel from this height (SHADE_REACH).
    float eye = max(abs(cameraPosition.y), 3.0);
    float d2 = dist * dist;
    #if WATER_DETAIL > 0
      vec2 s = vec2(0.0);
      for (int i = 0; i < SWELL_N; i++) {
        float th = dot(uSw[i].xy, p) - uSw[i].z * uSwellT + uSw[i].w;
        float r2 = uSa[i].z * eye;
        s += uSa[i].x * (1.0 - smoothstep(r2 * 0.15, r2, d2)) * cos(th) * uSw[i].xy;
      }
      return s * vSwell.w;
    #else
      // Low: the slope the vertices worked out, faded as its shortest swell would be.
      float r2 = uSa[0].z * eye;
      return vSwell.xy * (1.0 - smoothstep(r2 * 0.15, r2, d2));
    #endif
  }
  // A ship under way: the churned water astern and the two arms off the bow.
  float wakeFoam(vec2 p, float fa, float fb) {
    if (uWakeShape.x <= 0.0) return 0.0;
    vec2 d = p - uWake.xy;
    float aft = -dot(d, uWake.zw);
    float side = abs(d.x * uWake.w - d.y * uWake.z);
    float len = uWakeShape.y;
    float hb = uWakeShape.z;
    // Nearly every pixel of the sea is nowhere near the ship: two dot products and out.
    if (aft < -len - 40.0 || aft > len * 3.5 || side > hb + (aft + len) * 0.36 + 60.0) return 0.0;
    float w = hb * 0.5 + aft * 0.03;
    // Churned water astern: thick at the stern, in streaks, thinning out over a couple of ship's lengths.
    float streak = 0.55 + 0.45 * sin(side * 0.11 + sin(aft * 0.013) * 2.0);
    float core = step(0.0, aft) * (1.0 - smoothstep(w * 0.35, w, side)) * exp(-aft / (len * 0.7)) * streak;
    float fromBow = aft + len;
    float arm = step(0.0, fromBow) * exp(-fromBow / (len * 1.1));
    float off = side - (hb * 0.5 + fromBow * 0.33);
    float aw = 9.0 + fromBow * 0.012;
    arm *= exp(-off * off / (aw * aw)) * step(hb * 0.35, side);
    return uWakeShape.x * (core * (0.4 + 1.1 * fa) + arm * (0.2 + 0.6 * fb));
  }
`;

/** [what to find in the stock shader, what to put there]. Every one must be found or the sea stays as it was. */
const EDITS = {
  vert: [
    ['varying vec3 vWorld;', `varying vec3 vWorld;\n${VERT_PARS}`],
    ['vWorld = wp.xyz;', `${VERT_MAIN}\n    vWorld = wp.xyz;`],
  ],
  frag: [
    ['varying vec3 vWorld;', `varying vec3 vWorld;\n${FRAG_PARS}`],
    [
      'vec3 N = normalize(vec3(n.x, 1.0, n.y));',
      'vec2 swN = (swellSlope(p, dist) + vTsu.y * uTsuWave.xy) * uSwellShade;\n    vec3 N = normalize(vec3(n.x - swN.x, 1.0, n.y - swN.y));',
    ],
    // The water is as deep as the tsunami has made it: shallower where the sea has drawn back, and water over the land it floods.
    ['float depth = mix(34.0, field.r * 40.0, uDepthXform.w);', 'float depth = max(mix(34.0, field.r * 40.0, uDepthXform.w) + vTsu.x - vTsu.z, 0.0);'],
    [
      'body *= uBodyLight * (0.7 + 0.3 * NdL);',
      // Crests a little lighter than troughs: the water is thinner there.
      'body *= uBodyLight * (0.7 + 0.3 * NdL) * (1.0 + uSwellTint * clamp(vSwell.z * uSwellInv, -1.0, 1.0));',
    ],
    [
      'foam = clamp(foam + cap, 0.0, 1.0);',
      '#if WATER_DETAIL > 0\n      cap += uCaps * foamB * smoothstep(0.45, 0.95, vSwell.z * uSwellInv) * 0.6 * fine;\n    #endif\n'
        // …and the breaking face of a tsunami. What has run over the land is brown with what it picked up, and no mirror.
        // (The beach's surf is for a beach: over flooded ground most of it is left out, or the whole flood is white.)
        + '    foam = clamp(foam * (1.0 - 0.85 * min(vTsu.z, 1.0)) + cap + wakeFoam(p, foamA, foamB) + (vTsu.w * 0.6 + min(vTsu.z, 1.0) * max(vTsu.x, 0.0) * 0.006) * (0.45 + foamA), 0.0, 1.0);\n'
        + '    col = mix(col, vec3(0.33, 0.3, 0.24) * uBodyLight * (0.75 + 0.25 * NdL), min(vTsu.z * 0.5, 0.62));',
    ],
  ],
};

/** The stock sea shaders with the swell in them, or null if they have changed shape. */
export function patchShaders(vert, frag) {
  let v = vert;
  let f = frag;
  for (const [find, put] of EDITS.vert) {
    if (!v.includes(find)) return null;
    v = v.replace(find, put);
  }
  for (const [find, put] of EDITS.frag) {
    if (!f.includes(find)) return null;
    f = f.replace(find, put);
  }
  return { vert: v, frag: f };
}

function syncUniforms(sea) {
  const u = sea.uniforms;
  if (!u) return;
  for (let i = 0; i < sea.comps.length; i++) {
    const c = sea.comps[i];
    u.uSw.value[i].set(c.kx, c.kz, c.omega, c.phase);
    u.uSa.value[i].set(c.amp, c.geoR, c.aaR);
  }
  u.uSwellInv.value = sea.peak > 1e-4 ? 1 / sea.peak : 0;
}

/** The sea in play (the last ocean built), for anything that floats. */
let CURRENT = null;
export function currentSea() {
  return CURRENT;
}

/**
 * Give an Ocean (world/water.js) its swell: the grid, the shader, the
 * uniforms, a follow step that keeps the fine grid on the same world points,
 * and `ocean.sea` / `ocean.waveAt(x, z, out)` for everything else.
 */
export function attach(ocean, mapId = 'kestrel') {
  const mat = ocean.deepMat;
  const mesh = ocean.deep;
  if (!mat || !mesh || !mat.vertexShader) return null;
  const src = patchShaders(mat.vertexShader, mat.fragmentShader);
  if (!src) {
    console.warn('The sea shader has changed shape; the swell is off.');
    return null;
  }
  const sea = createSea(ocean.quality, mapId, ocean.depthField);
  mat.vertexShader = src.vert;
  mat.fragmentShader = src.frag;
  mat.defines = { ...(mat.defines || {}), SWELL_N: sea.comps.length };
  const u = mat.uniforms;
  u.uSw = { value: sea.comps.map(() => new THREE.Vector4()) };
  u.uSa = { value: sea.comps.map(() => new THREE.Vector3()) };
  u.uSwellT = u.uTime;
  u.uSwellShade = { value: SHADE_GAIN };
  u.uSwellTint = { value: CREST_TINT };
  u.uSwellInv = { value: 0 };
  if (sea.field) {
    // The sea's own depth field: the same texture the water's colour is read from.
    u.uSwellDepth = u.uDepthMap;
    u.uSwellXform = u.uDepthXform;
    u.uSwellTexel = { value: 1 / sea.field.n };
  } else {
    // None (a streamed map): one that follows the eye, sounded on the first frame.
    const tex = new THREE.DataTexture(new Uint8Array(LOCAL_N * LOCAL_N * 2).fill(255), LOCAL_N, LOCAL_N, THREE.RGFormat, THREE.UnsignedByteType);
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    u.uSwellDepth = { value: tex };
    u.uSwellXform = { value: new THREE.Vector4(0, 0, 1, 0) };
    u.uSwellTexel = { value: 1 / LOCAL_N };
    if (mat.userData.textures) mat.userData.textures.push(tex);
    sea.wantsLocal = true;
  }
  const none = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  none.needsUpdate = true;
  u.uTsuMap = { value: none };
  u.uTsuXform = { value: new THREE.Vector4(0, 0, 1, 0) };
  u.uTsuWave = { value: new THREE.Vector4(1, 0, 0, 0) };
  u.uTsuShape = { value: new THREE.Vector4(0, 100, 100, 1000) };
  u.uTsuAmp = { value: new THREE.Vector4(0, 0, 0, 0) };
  if (mat.userData.textures) mat.userData.textures.push(none);
  sea.tsuNone = none;
  u.uWake = { value: new THREE.Vector4(0, 0, 0, -1) };
  u.uWakeShape = { value: new THREE.Vector3(0, 1500, 180) };
  sea.uniforms = u;
  syncUniforms(sea);
  mat.needsUpdate = true;

  const old = mesh.geometry;
  mesh.geometry = seaGeometry(ocean.quality);
  if (old) old.dispose();
  mesh.frustumCulled = false;
  sea.mesh = mesh;

  rideRipples(ocean, sea);

  ocean.sea = sea;
  ocean.waveAt = (x, z, out) => waveAt(sea, x, z, out);
  ocean.waveHeightAt = (x, z) => waveHeightAt(sea, x, z);
  ocean.tsunamiAt = (x, z, out) => tsunamiAt(sea, x, z, out);
  ocean.follow = function follow(pos) {
    this.deep.position.x = Math.round(pos.x / FOLLOW) * FOLLOW;
    this.deep.position.z = Math.round(pos.z / FOLLOW) * FOLLOW;
  };
  const update = ocean.update;
  ocean.update = function tick(dt, weather) {
    update.call(this, dt, weather);
    // The stock update has just written its own clock to uTime; the swell runs on the same one.
    sea.t = this.t - dt;
    tickSea(sea, dt, weather);
    if (sea.wantsLocal) {
      const at = this.deep.position;
      if (!sea.field) setField(sea, localField(sea.quality, at.x, at.z));
      else followLocal(sea, at.x, at.z);
    }
  };
  CURRENT = sea;
  // The one question everything that floats asks (terrain.js swellAt).
  SWELL.at = (x, z) => waveHeightAt(sea, x, z);
  return sea;
}

/**
 * The boat's near patch of ripples (water.js buildRipples) lies 10 cm over
 * the sea. Over a sea that moves it has to move with it, or the swell would
 * rise through it: a finer grid, and the same displacement in its own shader.
 */
function rideRipples(ocean, sea) {
  const mesh = ocean.ripples;
  const mat = ocean.rippleMat;
  if (!mesh || !mat || !mesh.geometry) return;
  const size = mesh.geometry.parameters ? mesh.geometry.parameters.width : 360;
  const seg = 48;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const cols = new Float32Array(pos.count * 4);
  const R = size / 2;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getZ(i));
    cols[i * 4] = cols[i * 4 + 1] = cols[i * 4 + 2] = 1;
    // The same soft round edge the patch always had.
    cols[i * 4 + 3] = 1 - smooth(r, R * 0.35, R * 0.95);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 4));
  mesh.geometry.dispose();
  mesh.geometry = geo;
  mat.defines = { ...(mat.defines || {}), SWELL_N: sea.comps.length };
  const u = sea.uniforms;
  mat.onBeforeCompile = (shader) => {
    for (const k of ['uSw', 'uSa', 'uSwellT', 'uSwellDepth', 'uSwellXform', 'uSwellTexel', 'uRenderOrigin', 'uTsuMap', 'uTsuXform', 'uTsuWave', 'uTsuShape', 'uTsuAmp']) shader.uniforms[k] = u[k];
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SWELL_UNIFORMS}\n${SWELL_AT}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec3 swWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
        transformed.y += swellAt(swWorld.xz + uRenderOrigin, distance(swWorld, cameraPosition)).z + tsuAt(swWorld.xz + uRenderOrigin).x;`);
  };
  mat.customProgramCacheKey = () => `ripples-swell-${sea.comps.length}`;
  mat.needsUpdate = true;
}

/** A ship's wake on the sea: stern point, unit heading, strength 0..1, hull length and half beam. Null: none. */
export function setWake(sea, w) {
  const u = sea && sea.uniforms;
  if (!u) return;
  if (!w) {
    u.uWakeShape.value.x = 0;
    return;
  }
  u.uWake.value.set(w.x, w.z, w.dx, w.dz);
  u.uWakeShape.value.set(w.strength, w.length, w.halfBeam);
}

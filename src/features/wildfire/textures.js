/**
 * The two pictures the fire needs, painted in code once and kept.
 *
 *   noise  a tiling value-noise field the flames scroll upwards through, so
 *          every tongue of flame licks differently without a sprite sheet.
 *   puff   one soft, lumpy ball of smoke. Every smoke column and every cloud
 *          of steam is this, scaled and tinted.
 *
 * Both live in shader uniforms rather than in `material.map`, because the
 * world's disposal walks `map` and frees it — and these outlive every world
 * rebuild, so they are made exactly once per session.
 */

import * as THREE from '../../vendor/three.module.js';

let NOISE = null;
let PUFF = null;

function canvas(n) {
  const c = document.createElement('canvas');
  c.width = n;
  c.height = n;
  return { c, g: c.getContext('2d') };
}

/** Tileable value noise, three octaves, 128 x 128, in the red channel. */
export function noiseTexture() {
  if (NOISE) return NOISE;
  const N = 128;
  const { c, g } = canvas(N);
  const img = g.createImageData(N, N);
  const d = img.data;
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const grids = [8, 16, 32].map((s) => {
    const a = new Float32Array(s * s);
    for (let i = 0; i < a.length; i++) a[i] = rnd();
    return { s, a };
  });
  const sample = ({ s, a }, u, v) => {
    const x = u * s;
    const y = v * s;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (i, j) => a[((j % s) + s) % s * s + (((i % s) + s) % s)];
    const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const bot = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return top + (bot - top) * sy;
  };
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const v = y / N;
      const n = sample(grids[0], u, v) * 0.5 + sample(grids[1], u, v) * 0.3 + sample(grids[2], u, v) * 0.2;
      const k = (y * N + x) * 4;
      const b = Math.round(n * 255);
      d[k] = b;
      d[k + 1] = b;
      d[k + 2] = b;
      d[k + 3] = 255;
    }
  }
  if (g.putImageData) g.putImageData(img, 0, 0);
  NOISE = new THREE.CanvasTexture(c);
  NOISE.wrapS = NOISE.wrapT = THREE.RepeatWrapping;
  NOISE.colorSpace = THREE.NoColorSpace;
  return NOISE;
}

/** A soft ball of smoke with a lumpy edge, white, alpha in the alpha channel. */
export function puffTexture() {
  if (PUFF) return PUFF;
  const N = 64;
  const { c, g } = canvas(N);
  const img = g.createImageData(N, N);
  const d = img.data;
  let seed = 99991;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  // A few overlapping lobes make the outline lumpy rather than a clean disc.
  const lobes = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rnd() * 0.5;
    const r = 0.18 + rnd() * 0.12;
    lobes.push({ x: 0.5 + Math.cos(a) * r, y: 0.5 + Math.sin(a) * r, s: 0.2 + rnd() * 0.1 });
  }
  lobes.push({ x: 0.5, y: 0.5, s: 0.34 });
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N;
      const v = (y + 0.5) / N;
      let m = 0;
      for (const l of lobes) {
        const dx = (u - l.x) / l.s;
        const dy = (v - l.y) / l.s;
        const q = 1 - (dx * dx + dy * dy);
        if (q > 0) m += q * q;
      }
      // Fade to nothing well inside the square so no edge ever shows.
      const edge = Math.max(0, 1 - Math.hypot(u - 0.5, v - 0.5) / 0.5);
      const a = Math.min(1, m * 0.9) * edge * edge;
      const k = (y * N + x) * 4;
      d[k] = 255;
      d[k + 1] = 255;
      d[k + 2] = 255;
      d[k + 3] = Math.round(a * 255);
    }
  }
  if (g.putImageData) g.putImageData(img, 0, 0);
  PUFF = new THREE.CanvasTexture(c);
  PUFF.colorSpace = THREE.NoColorSpace;
  return PUFF;
}

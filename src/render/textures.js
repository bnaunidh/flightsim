/**
 * Procedural texture library.
 *
 * Every texture in the simulator is drawn here with the Canvas 2D API at load
 * time. Nothing is fetched from the network, which means:
 *   - the whole game works offline the moment it is installed,
 *   - the download stays tiny (a few hundred KB of code instead of MB of JPEGs),
 *   - all art is original to this project and safe to redistribute.
 *
 * Performance note: evaluating fractal noise per pixel at 1024² is far too slow
 * in JavaScript (seconds per texture). Instead we evaluate noise into small
 * seamless tiles — 64–128 px — and let the canvas compositor scale and blend
 * them, which is hardware accelerated. Fine detail then comes from cheap
 * strokes and per-pixel grain. Same look, roughly fifty times faster.
 *
 * Textures are cached by key so repeat calls are free.
 */

import * as THREE from '../vendor/three.module.js';
import { makeRandom, fbmTileable, clamp, lerp } from '../core/noise.js';

const cache = new Map();

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/*
 * How hard the card is allowed to work on textures seen edge-on.
 *
 * Four is a safe number that costs nothing anywhere. On Ultra the renderer
 * raises it to whatever the card will actually give — usually sixteen — which
 * is the single biggest difference you can make to a flight simulator: the
 * runway, the taxiways and the sea all stretch away from you at a very
 * shallow angle, and that is exactly the case low anisotropy turns to mush.
 *
 * Set by main.js once the renderer exists, since only the renderer knows what
 * the card supports. Textures already built keep what they had — everything
 * here is built on the first world load, and the level is set before that.
 */
let anisoCap = 4;
export function setTextureAnisotropy(n) {
  anisoCap = Math.max(1, n | 0);
  /*
   * Including the ones already made.
   *
   * Every texture in the game is built once and cached for the life of the
   * page, so raising the cap on its own only affected textures that did not
   * exist yet — which, by the time anybody opens Settings, is none of them.
   * Turning Ultra on changed nothing at all on screen for that reason.
   */
  for (const tex of cache.values()) {
    if (!tex || typeof tex.anisotropy !== 'number') continue;
    if (tex.anisotropy === anisoCap) continue;
    tex.anisotropy = anisoCap;
    tex.needsUpdate = true;
  }
}

function finish(c, { repeat = [1, 1], srgb = true, aniso = 4 } = {}) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = Math.max(aniso, anisoCap);
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function get(key, factory) {
  if (!cache.has(key)) cache.set(key, factory());
  return cache.get(key);
}

/* ------------------------------------------------------------------ *
 * Noise helpers
 * ------------------------------------------------------------------ */

const tileCache = new Map();

/** Small seamless greyscale noise tile. Cheap, and cached across textures. */
function noiseTile(res, freq, opts = {}) {
  const key = `${res}|${freq}|${opts.octaves || 4}|${opts.seed || 0}|${opts.gain || 0.5}`;
  if (tileCache.has(key)) return tileCache.get(key);
  const c = canvas(res);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(res, res);
  const d = img.data;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const n = fbmTileable((x / res) * freq, (y / res) * freq, freq, opts) * 255;
      const i = (y * res + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = n;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  tileCache.set(key, c);
  return c;
}

/** Float height field (tileable) — used to build normal maps. */
function noiseField(res, freq, opts = {}) {
  const f = new Float32Array(res * res);
  for (let y = 0; y < res; y++)
    for (let x = 0; x < res; x++)
      f[y * res + x] = fbmTileable((x / res) * freq, (y / res) * freq, freq, opts);
  return f;
}

/** Blend a noise tile over the target, repeated to fill it. */
function tileNoise(ctx, W, H, tile, tileSize, { alpha = 0.5, mode = 'overlay' } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = mode;
  for (let y = 0; y < H; y += tileSize) {
    for (let x = 0; x < W; x += tileSize) {
      ctx.drawImage(tile, x, y, tileSize, tileSize);
    }
  }
  ctx.restore();
}

/** Sprinkle fine grain over the canvas — sells "real surface" cheaply. */
function grain(ctx, w, h, amount, seed = 5) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const rnd = makeRandom(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] = clamp(d[i] + n, 0, 255);
    d[i + 1] = clamp(d[i + 1] + n, 0, 255);
    d[i + 2] = clamp(d[i + 2] + n, 0, 255);
  }
  ctx.putImageData(img, 0, 0);
}

/** Turn a tileable height field into a tangent-space normal map. */
function normalMapFromField(res, field, strength = 2) {
  const c = canvas(res);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(res, res);
  const d = img.data;
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const hl = field[y * res + ((x - 1 + res) % res)];
      const hr = field[y * res + ((x + 1) % res)];
      const hu = field[((y - 1 + res) % res) * res + x];
      const hd = field[((y + 1) % res) * res + x];
      let nx = (hl - hr) * strength * res * 0.02;
      let ny = (hu - hd) * strength * res * 0.02;
      const len = Math.hypot(nx, ny, 1);
      const i = (y * res + x) * 4;
      d[i] = ((nx / len) * 0.5 + 0.5) * 255;
      d[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      d[i + 2] = (1 / len) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/* ------------------------------------------------------------------ *
 * Ground / terrain
 * ------------------------------------------------------------------ */

export function grassTexture() {
  return get('grass', () => {
    const S = 512;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    // Base colour, then two bands of noise for patchiness.
    ctx.fillStyle = '#54703a';
    ctx.fillRect(0, 0, S, S);
    // Higher-frequency, lower-contrast variation: big soft blobs are exactly
    // what makes a tiled ground texture look tiled.
    tileNoise(ctx, S, S, noiseTile(96, 14, { octaves: 4, seed: 11 }), S, { alpha: 0.42, mode: 'overlay' });
    tileNoise(ctx, S, S, noiseTile(64, 22, { octaves: 3, seed: 31 }), 256, { alpha: 0.3, mode: 'soft-light' });
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.globalCompositeOperation = 'color-dodge';
    ctx.fillStyle = '#7d9646';
    ctx.fillRect(0, 0, S, S);
    ctx.restore();

    // Blades: thousands of tiny strokes give real close-up detail.
    const rnd = makeRandom(7);
    ctx.lineWidth = 1;
    for (let i = 0; i < 14000; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const len = 2 + rnd() * 5;
      const g = 70 + rnd() * 90;
      ctx.strokeStyle = `rgba(${(g * 0.55) | 0},${g | 0},${(g * 0.42) | 0},0.5)`;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (rnd() - 0.5) * 2, y - len);
      ctx.stroke();
    }
    grain(ctx, S, S, 12, 3);
    return finish(c);
  });
}

export function sandTexture() {
  return get('sand', () => {
    const S = 512;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#d9c49b';
    ctx.fillRect(0, 0, S, S);
    tileNoise(ctx, S, S, noiseTile(96, 18, { octaves: 4, seed: 21 }), S, { alpha: 0.34, mode: 'overlay' });
    // Wind ripples.
    const rnd = makeRandom(9);
    ctx.strokeStyle = 'rgba(255,245,215,0.16)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 90; i++) {
      const y = rnd() * S;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= S; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 4);
      ctx.stroke();
    }
    grain(ctx, S, S, 24, 9);
    return finish(c);
  });
}

export function rockTexture() {
  return get('rock', () => {
    const S = 512;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7d766b';
    ctx.fillRect(0, 0, S, S);
    tileNoise(ctx, S, S, noiseTile(96, 16, { octaves: 5, seed: 41 }), S, { alpha: 0.55, mode: 'overlay' });
    tileNoise(ctx, S, S, noiseTile(64, 26, { octaves: 3, seed: 55 }), 256, { alpha: 0.3, mode: 'multiply' });
    // Fissures.
    const rnd = makeRandom(13);
    ctx.strokeStyle = 'rgba(30,28,26,0.32)';
    for (let i = 0; i < 26; i++) {
      ctx.lineWidth = 1 + rnd() * 2.5;
      ctx.beginPath();
      let x = rnd() * S;
      let y = rnd() * S;
      ctx.moveTo(x, y);
      for (let k = 0; k < 8; k++) {
        x += (rnd() - 0.5) * 90;
        y += (rnd() - 0.5) * 90;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    grain(ctx, S, S, 18, 13);
    return finish(c);
  });
}

/** Blend mask used by the terrain shader to break up tiling. */
export function terrainSplatNoise() {
  return get('splat', () => {
    const S = 256;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.drawImage(noiseTile(128, 4, { octaves: 4, seed: 77 }), 0, 0, S, S);
    return finish(c, { srgb: false });
  });
}

/* ------------------------------------------------------------------ *
 * Runway & apron
 * ------------------------------------------------------------------ */

/**
 * Full runway strip painted in one texture: asphalt, threshold bars,
 * centreline dashes, side lines, aiming markers and runway numbers at both
 * ends. The texture maps 1:1 onto the runway mesh (no tiling) so the markings
 * land exactly where the physics expects them.
 */
export function runwayTexture() {
  return get('runway', () => {
    const W = 512;
    const H = 1536; // long axis
    const c = canvas(W, H);
    const ctx = c.getContext('2d');

    // Asphalt base: dark grey with patchy repairs.
    ctx.fillStyle = '#43464b';
    ctx.fillRect(0, 0, W, H);
    tileNoise(ctx, W, H, noiseTile(96, 6, { octaves: 4, seed: 91 }), 256, { alpha: 0.7, mode: 'overlay' });
    tileNoise(ctx, W, H, noiseTile(64, 3, { octaves: 2, seed: 92 }), 512, { alpha: 0.35, mode: 'soft-light' });

    // Tyre rubber deposits near both touchdown zones.
    const rnd = makeRandom(3);
    for (const zone of [H * 0.14, H * 0.86]) {
      for (let i = 0; i < 520; i++) {
        const x = W * 0.5 + (rnd() - 0.5) * W * 0.5;
        const y = zone + (rnd() - 0.5) * H * 0.07;
        ctx.fillStyle = `rgba(20,20,22,${0.03 + rnd() * 0.07})`;
        ctx.beginPath();
        ctx.ellipse(x, y, 6 + rnd() * 26, 2 + rnd() * 7, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const paint = 'rgba(240,240,234,0.92)';
    ctx.fillStyle = paint;

    // Side lines.
    ctx.fillRect(W * 0.08, H * 0.02, 8, H * 0.96);
    ctx.fillRect(W * 0.92 - 8, H * 0.02, 8, H * 0.96);

    // Centreline dashes.
    const dashLen = 46;
    const gap = 30;
    for (let y = H * 0.1; y < H * 0.9; y += dashLen + gap) {
      ctx.fillRect(W / 2 - 5, y, 10, dashLen);
    }

    // Threshold "piano keys" at each end.
    for (let k = 0; k < 8; k++) {
      const bw = W * 0.055;
      const x = W * 0.14 + k * (bw * 1.55);
      ctx.fillRect(x, H * 0.028, bw, H * 0.035);
      ctx.fillRect(x, H - H * 0.063, bw, H * 0.035);
    }

    // Touchdown aiming point blocks.
    for (const y of [H * 0.115, H - H * 0.15]) {
      ctx.fillRect(W * 0.26, y, 26, H * 0.035);
      ctx.fillRect(W * 0.74 - 26, y, 26, H * 0.035);
    }

    // Runway designators: 09 at the west end, 27 at the east end.
    const number = (text, y, flip) => {
      ctx.save();
      ctx.translate(W / 2, y);
      if (flip) ctx.rotate(Math.PI);
      ctx.fillStyle = paint;
      ctx.font = 'bold 150px "Arial Black", Arial, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 0, 0);
      ctx.restore();
    };
    number('09', H * 0.085, false);
    number('27', H * 0.915, true);

    // Weather the paint so it does not look like a decal.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i++) {
      ctx.globalAlpha = 0.05 + rnd() * 0.2;
      ctx.beginPath();
      ctx.arc(rnd() * W, rnd() * H, 1 + rnd() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    return finish(c, { aniso: 8 });
  });
}

export function asphaltTexture() {
  return get('asphalt', () => {
    const S = 512;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4a4d52';
    ctx.fillRect(0, 0, S, S);
    tileNoise(ctx, S, S, noiseTile(96, 8, { octaves: 4, seed: 61 }), 256, { alpha: 0.7, mode: 'overlay' });
    // Expansion joints.
    ctx.strokeStyle = 'rgba(30,30,32,0.55)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 4; i++) {
      ctx.beginPath();
      ctx.moveTo((i * S) / 4, 0);
      ctx.lineTo((i * S) / 4, S);
      ctx.moveTo(0, (i * S) / 4);
      ctx.lineTo(S, (i * S) / 4);
      ctx.stroke();
    }
    grain(ctx, S, S, 16, 17);
    return finish(c);
  });
}

export function asphaltNormal() {
  return get('asphaltN', () => {
    const res = 128;
    const field = noiseField(res, 12, { octaves: 3, seed: 62 });
    return finish(normalMapFromField(res, field, 1.1), { srgb: false });
  });
}

/** Fine relief for the terrain surface. */
export function groundNormal() {
  return get('groundN', () => {
    const res = 128;
    const field = noiseField(res, 16, { octaves: 4, seed: 137 });
    return finish(normalMapFromField(res, field, 0.6), { srgb: false });
  });
}

/* ------------------------------------------------------------------ *
 * Water
 * ------------------------------------------------------------------ */

export function waterNormal() {
  return get('waterN', () => {
    const res = 128;
    const base = noiseField(res, 7, { octaves: 4, seed: 5 });
    const fine = noiseField(res, 17, { octaves: 3, seed: 23 });
    // Mostly organic noise with only a hint of directional swell — strong
    // sinusoids read as a printed fabric pattern once the texture tiles.
    const field = new Float32Array(res * res);
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const i = y * res + x;
        const a = base[i];
        field[i] =
          a * 0.72 +
          fine[i] * 0.22 +
          Math.sin((x / res) * Math.PI * 4 + a * 6) * 0.06 +
          Math.sin((y / res) * Math.PI * 6 + a * 5) * 0.05;
      }
    }
    return finish(normalMapFromField(res, field, 0.75), { srgb: false });
  });
}

export function foamTexture() {
  return get('foam', () => {
    const S = 256;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const rnd = makeRandom(29);
    for (let i = 0; i < 2200; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.06 + rnd() * 0.35})`;
      ctx.beginPath();
      ctx.arc(rnd() * S, rnd() * S, 0.6 + rnd() * 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

/* ------------------------------------------------------------------ *
 * Aircraft
 * ------------------------------------------------------------------ */

/**
 * Painted aluminium: base coat, livery, panel lines, rivets, dirt streaks.
 *
 * Takes a scheme rather than two colours, so the cheatline and the
 * registration belong to the airline instead of being hard-coded onto every
 * aeroplane in the fleet. The old signature still works — pass two strings and
 * they are read as base and accent.
 *
 * The cache key is explicitly delimited. It used to be `'airframe' + base +
 * accent`, a bare concatenation: ('#eef1f5', '#c8102e') and ('#eef1f5#c8',
 * '102e') collide. Nothing in the fleet ever triggered it because every value
 * was a tidy #rrggbb, but a scheme with five fields would have made it a real
 * possibility rather than a theoretical one.
 */
export function airframeTexture(schemeOrBase = '#eef1f5', accentArg = '#c8102e') {
  const scheme =
    typeof schemeOrBase === 'string'
      ? { base: schemeOrBase, accent: accentArg }
      : schemeOrBase || {};
  const baseColor = scheme.base || '#eef1f5';
  const accent = scheme.accent || '#c8102e';
  const cheatline = scheme.cheatline || 'rgba(30,44,74,0.85)';
  const reg = scheme.reg || 'N172SK';
  const key = ['airframe', baseColor, accent, cheatline, reg].join('|');
  return get(key, () => {
    const S = 1024;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, S, S);
    // Subtle metal mottling (very low contrast).
    tileNoise(ctx, S, S, noiseTile(64, 3, { octaves: 3, seed: 3 }), S, { alpha: 0.12, mode: 'overlay' });

    // Livery: two swooping accent stripes across the middle band.
    ctx.save();
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(0, S * 0.56);
    ctx.bezierCurveTo(S * 0.35, S * 0.5, S * 0.6, S * 0.62, S, S * 0.54);
    ctx.lineTo(S, S * 0.6);
    ctx.bezierCurveTo(S * 0.6, S * 0.68, S * 0.35, S * 0.56, 0, S * 0.62);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = cheatline;
    ctx.beginPath();
    ctx.moveTo(0, S * 0.64);
    ctx.bezierCurveTo(S * 0.35, S * 0.58, S * 0.6, S * 0.7, S, S * 0.62);
    ctx.lineTo(S, S * 0.655);
    ctx.bezierCurveTo(S * 0.6, S * 0.735, S * 0.35, S * 0.615, 0, S * 0.675);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Panel lines.
    ctx.strokeStyle = 'rgba(90,95,105,0.45)';
    ctx.lineWidth = 1.5;
    for (let i = 1; i < 10; i++) {
      ctx.beginPath();
      ctx.moveTo((i * S) / 10, 0);
      ctx.lineTo((i * S) / 10, S);
      ctx.stroke();
    }
    for (let i = 1; i < 8; i++) {
      ctx.beginPath();
      ctx.moveTo(0, (i * S) / 8);
      ctx.lineTo(S, (i * S) / 8);
      ctx.stroke();
    }

    // Rivets along the panel lines.
    ctx.fillStyle = 'rgba(120,126,136,0.5)';
    for (let i = 1; i < 10; i++)
      for (let y = 6; y < S; y += 18) {
        ctx.beginPath();
        ctx.arc((i * S) / 10, y, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }
    for (let i = 1; i < 8; i++)
      for (let x = 6; x < S; x += 18) {
        ctx.beginPath();
        ctx.arc(x, (i * S) / 8, 1.4, 0, Math.PI * 2);
        ctx.fill();
      }

    // Registration marking.
    ctx.fillStyle = 'rgba(40,48,64,0.9)';
    ctx.font = 'bold 44px Arial, sans-serif';
    ctx.fillText(reg, S * 0.06, S * 0.42);

    // Dirt streaks trailing back from panel gaps.
    const rnd = makeRandom(19);
    for (let i = 0; i < 160; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const len = 40 + rnd() * 90;
      const g = ctx.createLinearGradient(x, y, x + len, y);
      g.addColorStop(0, 'rgba(70,70,74,0.16)');
      g.addColorStop(1, 'rgba(70,70,74,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, len, 1 + rnd() * 3);
    }

    return finish(c, { aniso: 8 });
  });
}

export function airframeNormal() {
  return get('airframeN', () => {
    // Panel-line grooves on a faint noise base.
    const res = 256;
    const base = noiseField(res, 6, { octaves: 2, seed: 8 });
    const field = new Float32Array(res * res);
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        const gx = Math.abs((((x / res) * 10) % 1) - 0.5) < 0.02 ? -0.5 : 0;
        const gy = Math.abs((((y / res) * 8) % 1) - 0.5) < 0.02 ? -0.5 : 0;
        field[y * res + x] = base[y * res + x] * 0.3 + gx + gy;
      }
    }
    return finish(normalMapFromField(res, field, 0.55), { srgb: false });
  });
}

export function propTexture() {
  return get('prop', () => {
    const S = 128;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1c1e22';
    ctx.fillRect(0, 0, S, S);
    grain(ctx, S, S, 16, 4);
    // Hi-vis yellow tip band.
    ctx.fillStyle = '#f2c53d';
    ctx.fillRect(0, 0, S, S * 0.08);
    return finish(c);
  });
}

/** Propeller disc used at speed: faint translucent blur ring. */
export function propBlurTexture() {
  return get('propBlur', () => {
    const S = 256;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const cx = S / 2;
    for (let i = 0; i < 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      const r0 = S * 0.08;
      const r1 = S * 0.49;
      const g = ctx.createLinearGradient(
        cx + Math.cos(a) * r0,
        cx + Math.sin(a) * r0,
        cx + Math.cos(a) * r1,
        cx + Math.sin(a) * r1
      );
      g.addColorStop(0, 'rgba(200,205,215,0.06)');
      g.addColorStop(0.85, 'rgba(200,205,215,0.10)');
      g.addColorStop(1, 'rgba(240,225,160,0.02)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * r0, cx + Math.sin(a) * r0);
      ctx.lineTo(cx + Math.cos(a) * r1, cx + Math.sin(a) * r1);
      ctx.stroke();
    }
    return finish(c);
  });
}

/* ------------------------------------------------------------------ *
 * Cockpit
 * ------------------------------------------------------------------ */

/** Dark textured instrument-panel plastic. */
export function panelTexture() {
  return get('panel', () => {
    const S = 512;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#23262b';
    ctx.fillRect(0, 0, S, S);
    tileNoise(ctx, S, S, noiseTile(64, 10, { octaves: 3, seed: 44 }), 128, { alpha: 0.35, mode: 'overlay' });
    // Pebbled vinyl grain.
    const rnd = makeRandom(23);
    for (let i = 0; i < 9000; i++) {
      const v = 30 + rnd() * 30;
      ctx.fillStyle = `rgba(${v},${v + 2},${v + 5},0.45)`;
      ctx.fillRect(rnd() * S, rnd() * S, 1.8, 1.8);
    }
    grain(ctx, S, S, 10, 27);
    return finish(c);
  });
}

export function panelNormal() {
  return get('panelN', () => {
    const res = 128;
    const field = noiseField(res, 22, { octaves: 2, seed: 44 });
    return finish(normalMapFromField(res, field, 0.5), { srgb: false });
  });
}

export function leatherTexture(color = '#2b2119') {
  return get('leather' + color, () => {
    const S = 256;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, S, S);
    const rnd = makeRandom(31);
    for (let i = 0; i < 2600; i++) {
      ctx.strokeStyle = `rgba(255,240,220,${0.02 + rnd() * 0.05})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(rnd() * S, rnd() * S, 1 + rnd() * 4, rnd() * 6.28, rnd() * 6.28 + 2);
      ctx.stroke();
    }
    grain(ctx, S, S, 12, 37);
    return finish(c);
  });
}

/* ------------------------------------------------------------------ *
 * Buildings & scenery
 * ------------------------------------------------------------------ */

export function buildingTexture(variant = 0) {
  return get('bldg' + variant, () => {
    const W = 512;
    const H = 512;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const palettes = [
      ['#c9c3b6', '#8a8377', '#2b3440'],
      ['#b9a38c', '#7d6c58', '#26313d'],
      ['#a8b2bb', '#6f7a85', '#1f2a35'],
      ['#d6cfc2', '#9a9285', '#33404e'],
    ];
    const [wall, trim, glass] = palettes[variant % palettes.length];
    ctx.fillStyle = wall;
    ctx.fillRect(0, 0, W, H);
    tileNoise(ctx, W, H, noiseTile(64, 4, { octaves: 3, seed: 71 + variant }), W, {
      alpha: 0.3,
      mode: 'overlay',
    });

    // Window grid — some lit, some dark, with reflections.
    const cols = 6;
    const rows = 7;
    const rnd = makeRandom(101 + variant);
    const mw = W / cols;
    const mh = H / rows;
    for (let r = 0; r < rows; r++) {
      for (let col = 0; col < cols; col++) {
        const x = col * mw + mw * 0.18;
        const y = r * mh + mh * 0.2;
        const w = mw * 0.64;
        const hh = mh * 0.5;
        const g = ctx.createLinearGradient(x, y, x + w, y + hh);
        if (rnd() < 0.25) {
          g.addColorStop(0, '#ffe6a8');
          g.addColorStop(1, '#d9b46a');
        } else {
          g.addColorStop(0, glass);
          g.addColorStop(0.5, '#5c6a78');
          g.addColorStop(1, glass);
        }
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, hh);
        ctx.strokeStyle = trim;
        ctx.lineWidth = 3;
        ctx.strokeRect(x, y, w, hh);
        ctx.fillStyle = 'rgba(0,0,0,0.18)';
        ctx.fillRect(x, y + hh, w, 3);
      }
      ctx.fillStyle = 'rgba(0,0,0,0.10)';
      ctx.fillRect(0, (r + 1) * mh - 4, W, 4);
    }
    // Streaks under windows.
    for (let i = 0; i < 80; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const g = ctx.createLinearGradient(x, y, x, y + 60);
      g.addColorStop(0, 'rgba(60,60,60,0.16)');
      g.addColorStop(1, 'rgba(60,60,60,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, 2 + rnd() * 4, 60);
    }
    return finish(c);
  });
}

export function hangarTexture() {
  return get('hangar', () => {
    const W = 512;
    const H = 512;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8d959c';
    ctx.fillRect(0, 0, W, H);
    // Corrugated metal ribs.
    for (let x = 0; x < W; x += 16) {
      const g = ctx.createLinearGradient(x, 0, x + 16, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(0.5, 'rgba(0,0,0,0.06)');
      g.addColorStop(1, 'rgba(0,0,0,0.22)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, 16, H);
    }
    // Rust and grime near the base.
    const rnd = makeRandom(53);
    for (let i = 0; i < 420; i++) {
      const x = rnd() * W;
      const y = H - Math.pow(rnd(), 2) * H * 0.5;
      ctx.fillStyle = `rgba(${120 + rnd() * 40},${70 + rnd() * 30},40,${0.03 + rnd() * 0.08})`;
      ctx.beginPath();
      ctx.arc(x, y, 2 + rnd() * 10, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, W, H, 12, 57);
    return finish(c);
  });
}

export function roofTexture() {
  return get('roof', () => {
    const S = 256;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4c4f54';
    ctx.fillRect(0, 0, S, S);
    tileNoise(ctx, S, S, noiseTile(64, 8, { octaves: 3, seed: 67 }), 128, { alpha: 0.4, mode: 'overlay' });
    const rnd = makeRandom(67);
    // Vents / AC units suggestion.
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    for (let i = 0; i < 5; i++) {
      ctx.strokeRect(rnd() * S * 0.8, rnd() * S * 0.8, 20 + rnd() * 40, 20 + rnd() * 30);
    }
    grain(ctx, S, S, 14, 71);
    return finish(c);
  });
}

/* ------------------------------------------------------------------ *
 * Sky-adjacent sprites
 * ------------------------------------------------------------------ */

/** Soft cloud puff with fractal edges — used for billboarded cloud clusters. */
export function cloudTexture(seed = 1) {
  return get('cloud' + seed, () => {
    const S = 192;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(S, S);
    const d = img.data;
    // Per-pixel here because the alpha shape is the whole point of the sprite.
    const field = noiseField(S, 7, { octaves: 4, seed: seed * 17 });
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const dx = (x / S - 0.5) * 2;
        const dy = (y / S - 0.5) * 2;
        const r = Math.hypot(dx, dy * 1.35);
        const n = field[y * S + x];
        let a = clamp((1 - r) * 1.5 + (n - 0.5) * 1.15, 0, 1);
        a *= a;
        // Brighter tops, greyer bases — reads as a lit cumulus.
        const shade = clamp(0.72 + (1 - y / S) * 0.35 + (n - 0.5) * 0.12, 0, 1);
        const i = (y * S + x) * 4;
        d[i] = 255 * shade;
        d[i + 1] = 255 * shade;
        d[i + 2] = 255 * clamp(shade + 0.03, 0, 1);
        d[i + 3] = a * 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return finish(c);
  });
}

export function rainStreakTexture() {
  return get('rainStreak', () => {
    const c = canvas(16, 64);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, 'rgba(200,220,255,0)');
    g.addColorStop(0.4, 'rgba(210,228,255,0.55)');
    g.addColorStop(1, 'rgba(200,220,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(6, 0, 4, 64);
    return finish(c);
  });
}

/** Windshield rain / spray overlay drawn in the cockpit view. */
export function dropletTexture() {
  return get('droplets', () => {
    const S = 512;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const rnd = makeRandom(83);
    for (let i = 0; i < 340; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 2 + rnd() * 7;
      const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.5)');
      g.addColorStop(0.55, 'rgba(190,210,235,0.22)');
      g.addColorStop(1, 'rgba(160,185,215,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (1 + rnd()), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c);
  });
}

/**
 * The tree species.
 *
 * There used to be exactly one palm, repeated across every island on every
 * map, which is what made the coastline read as wallpaper — a thousand copies
 * of one shape is a texture, not a forest. Four now, each drawn differently
 * enough to be told apart from the air, and each with its own trunk colour and
 * canopy so a mixed grove has some depth to it.
 *
 * `kind`: 0 palm · 1 broadleaf · 2 conifer · 3 scrubby bush
 */
export function treeTexture(kind = 0) {
  return get(`tree${kind}`, () => {
    const S = 128;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, S, S);
    const rnd = makeRandom(91 + kind * 37);

    const trunk = (w, top, colour, lean = 0) => {
      ctx.strokeStyle = colour;
      ctx.lineWidth = S * w;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(S * 0.5, S);
      ctx.quadraticCurveTo(S * (0.5 + lean * 0.4), S * (top + 0.2), S * (0.5 + lean), S * top);
      ctx.stroke();
    };

    if (kind === 0) {
      // Palm: a leaning trunk and a crown of drooping fronds.
      trunk(0.055, 0.5, '#5b432c', 0.06);
      for (let i = 0; i < 9; i++) {
        const a = -Math.PI / 2 + (i / 8 - 0.5) * 2.6;
        ctx.strokeStyle = `rgb(${30 + rnd() * 30},${90 + rnd() * 50},${35 + rnd() * 25})`;
        ctx.lineWidth = 5 + rnd() * 4;
        ctx.beginPath();
        ctx.moveTo(S * 0.56, S * 0.5);
        ctx.quadraticCurveTo(
          S * 0.56 + Math.cos(a) * S * 0.3,
          S * 0.5 + Math.sin(a) * S * 0.3,
          S * 0.56 + Math.cos(a) * S * 0.46,
          S * 0.5 + Math.sin(a) * S * 0.42 + S * 0.08
        );
        ctx.stroke();
      }
    } else if (kind === 1) {
      // Broadleaf: a short trunk under a big round canopy of blobs.
      trunk(0.07, 0.62, '#4d3a26');
      for (let i = 0; i < 26; i++) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.pow(rnd(), 0.6) * S * 0.31;
        const x = S * 0.5 + Math.cos(a) * rr;
        const y = S * 0.36 + Math.sin(a) * rr * 0.78;
        ctx.fillStyle = `rgb(${28 + rnd() * 26},${78 + rnd() * 58},${30 + rnd() * 24})`;
        ctx.beginPath();
        ctx.arc(x, y, S * (0.07 + rnd() * 0.06), 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 2) {
      // Conifer: a straight bole and stacked triangular tiers.
      trunk(0.045, 0.86, '#4a3722');
      for (let tier = 0; tier < 4; tier++) {
        const t = tier / 3;
        const half = S * (0.30 - t * 0.155);
        const yTop = S * (0.06 + t * 0.22);
        const yBot = S * (0.40 + t * 0.19);
        ctx.fillStyle = `rgb(${20 + rnd() * 18},${62 + rnd() * 40},${34 + rnd() * 20})`;
        ctx.beginPath();
        ctx.moveTo(S * 0.5, yTop);
        ctx.lineTo(S * 0.5 + half, yBot);
        ctx.lineTo(S * 0.5 - half, yBot);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      // Scrub: no real trunk, just a low tangle. Reads as undergrowth.
      for (let i = 0; i < 22; i++) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.pow(rnd(), 0.5) * S * 0.34;
        const x = S * 0.5 + Math.cos(a) * rr;
        const y = S * 0.72 + Math.sin(a) * rr * 0.45;
        ctx.fillStyle = `rgb(${46 + rnd() * 34},${76 + rnd() * 46},${34 + rnd() * 22})`;
        ctx.beginPath();
        ctx.arc(x, y, S * (0.05 + rnd() * 0.05), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    return finish(c);
  });
}

/** How many species there are, so callers do not have to know. */
export const TREE_KINDS = 4;

/** Build everything up-front so there are no hitches mid-flight. */
export async function warmTextures(onProgress = () => {}) {
  const steps = [
    ['Grass', grassTexture],
    ['Sand', sandTexture],
    ['Rock', rockTexture],
    ['Terrain blend', terrainSplatNoise],
    ['Runway markings', runwayTexture],
    ['Apron asphalt', asphaltTexture],
    ['Asphalt relief', asphaltNormal],
    ['Ground relief', groundNormal],
    ['Ocean surface', waterNormal],
    ['Sea foam', foamTexture],
    ['Airframe paint', () => airframeTexture()],
    ['Airframe relief', airframeNormal],
    ['Propeller', () => { propTexture(); propBlurTexture(); }],
    ['Instrument panel', () => { panelTexture(); panelNormal(); }],
    ['Cabin leather', () => leatherTexture()],
    ['Terminal', () => buildingTexture(0)],
    ['Town buildings', () => { buildingTexture(1); buildingTexture(2); buildingTexture(3); }],
    ['Hangar cladding', hangarTexture],
    ['Rooftops', roofTexture],
    ['Clouds', () => { cloudTexture(1); cloudTexture(2); cloudTexture(3); }],
    ['Rain', () => { rainStreakTexture(); dropletTexture(); treeTexture(); }],
  ];
  for (let i = 0; i < steps.length; i++) {
    const [label, fn] = steps[i];
    fn();
    onProgress((i + 1) / steps.length, label);
    // Yield every few steps so the loading bar paints. Yielding on every step
    // would be slower than the work itself in a throttled background tab.
    if (i % 3 === 2) await new Promise((r) => setTimeout(r, 0));
  }
}

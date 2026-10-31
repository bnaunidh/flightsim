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

/*
 * How big the textures are drawn.
 *
 * The runway, the apron, the facades and the cladding are drawn at twice
 * the pixels on High and Ultra (texScale 2: a 1024 x 3072 runway), where a
 * card with the memory for it gets markings that stay crisp from the flare
 * and rubber you can see the streaks in. Low and Medium keep the sizes they
 * always had. Set by main.js with the quality, before the world is built;
 * the textures of the other size are dropped from the cache so a change of
 * tier rebuilds them (the world is rebuilt at the same time).
 */
let tierScale = 1;
let textureTierName = 'high';
export function setTextureTier(q) {
  textureTierName = q === 'low' || q === 'medium' || q === 'high' || q === 'ultra' ? q : 'high';
  const want = textureTierName === 'high' || textureTierName === 'ultra' ? 2 : 1;
  if (want === tierScale) return;
  tierScale = want;
  for (const [key, tex] of [...cache.entries()]) {
    if (!key.includes('@') || key.endsWith('@' + want)) continue;
    if (tex && typeof tex.dispose === 'function') tex.dispose();
    cache.delete(key);
  }
}
export function texScale() {
  return tierScale;
}
export function textureTier() {
  return textureTierName;
}
/** A cached texture that is drawn differently per tier (its key carries the scale). */
function getTiered(key, factory) {
  return get(key + '@' + tierScale, factory);
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

    // Worn patches where the grass has given up: earth showing through, soft
    // edged, and a few drier, yellower clumps. What breaks the one-green
    // lawn a tiled texture always is.
    const rnd = makeRandom(7);
    for (let i = 0; i < 9; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 14 + rnd() * 34;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(112,96,66,0.42)');
      g.addColorStop(0.7, 'rgba(112,96,66,0.2)');
      g.addColorStop(1, 'rgba(112,96,66,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * (0.5 + rnd() * 0.6), rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 14; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 10 + rnd() * 24;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(150,154,70,0.28)');
      g.addColorStop(1, 'rgba(150,154,70,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Blades: thousands of tiny strokes give real close-up detail.
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
    // Shell and pebble flecks, and the damp darker sand in the troughs.
    for (let i = 0; i < 900; i++) {
      const v = 200 + rnd() * 55;
      ctx.fillStyle = `rgba(${v},${v - 8},${v - 30},${0.25 + rnd() * 0.4})`;
      ctx.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
    }
    tileNoise(ctx, S, S, noiseTile(64, 9, { octaves: 3, seed: 27 }), 256, { alpha: 0.18, mode: 'multiply' });
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
    // Strata: the beds the rock was laid down in, tilted a little, each a
    // shade off the next; what makes a cliff a cliff and not grey noise.
    const rnd = makeRandom(13);
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(-0.12);
    for (let y = -S; y < S; y += 10 + rnd() * 22) {
      const v = (rnd() - 0.5) * 26;
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 245 : 0},${v > 0 ? 230 : 0},${Math.abs(v) / 255})`;
      ctx.fillRect(-S, y, S * 2, 6 + rnd() * 14);
      ctx.fillStyle = 'rgba(28,26,24,0.22)';
      ctx.fillRect(-S, y, S * 2, 1.5);
    }
    ctx.restore();
    // Lichen and the warmer iron stain on some beds.
    for (let i = 0; i < 40; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 6 + rnd() * 18;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const warm = rnd() < 0.5;
      g.addColorStop(0, warm ? 'rgba(150,110,70,0.22)' : 'rgba(120,140,90,0.2)');
      g.addColorStop(1, warm ? 'rgba(150,110,70,0)' : 'rgba(120,140,90,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // Fissures.
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
 * Full runway strip painted in one texture: asphalt laid in lanes, repairs,
 * rubber streaked down both touchdown zones, oil on the centreline, and the
 * markings — threshold bars, aiming blocks, centreline dashes, side lines.
 * The texture maps 1:1 onto the runway mesh (no tiling) so the markings
 * land exactly where the physics expects them. Twice the pixels on High and
 * Ultra (texScale), where the markings' edges stay crisp from the flare.
 */
export function runwayTexture() {
  return getTiered('runway', () => {
    const s = texScale();
    const W = 512 * s;
    const H = 1536 * s; // long axis
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const rnd = makeRandom(3);

    // Asphalt base, with the paver's lanes down its length: a real runway is
    // laid 4-5 m at a pass and every pass is a shade off its neighbour.
    ctx.fillStyle = '#45484c';
    ctx.fillRect(0, 0, W, H);
    const lanes = 9;
    for (let i = 0; i < lanes; i++) {
      const v = (rnd() - 0.5) * 14;
      ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
      ctx.fillRect((i * W) / lanes, 0, W / lanes + 1, H);
      ctx.fillStyle = 'rgba(20,20,22,0.18)';
      ctx.fillRect((i * W) / lanes, 0, Math.max(1, s), H);
    }
    tileNoise(ctx, W, H, noiseTile(96, 6, { octaves: 4, seed: 91 }), 256 * s, { alpha: 0.62, mode: 'overlay' });
    tileNoise(ctx, W, H, noiseTile(64, 3, { octaves: 2, seed: 92 }), 512 * s, { alpha: 0.3, mode: 'soft-light' });

    // Repairs: patches of newer, darker asphalt and crack seal lines.
    for (let i = 0; i < 26; i++) {
      const pw = (20 + rnd() * 70) * s;
      const ph = (30 + rnd() * 140) * s;
      ctx.fillStyle = `rgba(${rnd() < 0.5 ? 30 : 90},${rnd() < 0.5 ? 31 : 92},${rnd() < 0.5 ? 34 : 96},${0.08 + rnd() * 0.14})`;
      ctx.fillRect(rnd() * (W - pw), rnd() * (H - ph), pw, ph);
    }
    ctx.strokeStyle = 'rgba(22,22,24,0.45)';
    ctx.lineWidth = Math.max(1, 1.2 * s);
    for (let i = 0; i < 40; i++) {
      let x = rnd() * W;
      let y = rnd() * H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        x += (rnd() - 0.5) * 40 * s;
        y += (rnd() - 0.2) * 50 * s;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    /*
     * Rubber. Tyres spin up on touchdown and leave their rubber in long
     * streaks down the runway, thickest 150-450 m past each threshold and
     * fading out toward the middle; two bands where the main gear runs, with
     * a thin trace right down the centreline from nosewheels. The old
     * version was round blobs, which read as spilled paint.
     */
    const streak = (x, y, len, wdt, a) => {
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, `rgba(18,18,20,0)`);
      g.addColorStop(0.25, `rgba(18,18,20,${a})`);
      g.addColorStop(0.75, `rgba(18,18,20,${a})`);
      g.addColorStop(1, `rgba(18,18,20,0)`);
      ctx.fillStyle = g;
      ctx.fillRect(x - wdt / 2, y, wdt, len);
    };
    for (const [z0, dir] of [[H * 0.08, 1], [H * 0.92, -1]]) {
      for (let i = 0; i < 900 * s; i++) {
        // Where along the zone, densest at a third of the way in.
        const t = Math.pow(rnd(), 0.7) * 0.36;
        const dens = Math.exp(-Math.pow((t - 0.11) / 0.1, 2));
        if (rnd() > dens + 0.08) continue;
        const band = rnd() < 0.12 ? 0 : rnd() < 0.5 ? -1 : 1;
        const x = W * 0.5 + band * W * (0.16 + rnd() * 0.08) + (rnd() - 0.5) * W * 0.1;
        const len = (20 + rnd() * 140) * s;
        const y = z0 + dir * t * H - (dir < 0 ? len : 0);
        streak(x, y, len, (1 + rnd() * 2.6) * s, (band === 0 ? 0.05 : 0.07) + rnd() * 0.09);
      }
    }
    // Oil and hydraulic drips along the centreline, and brake dust at the ends.
    for (let i = 0; i < 160; i++) {
      const y = rnd() * H;
      ctx.fillStyle = `rgba(16,16,18,${0.04 + rnd() * 0.08})`;
      ctx.beginPath();
      ctx.ellipse(W * 0.5 + (rnd() - 0.5) * 28 * s, y, (2 + rnd() * 5) * s, (6 + rnd() * 30) * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // The markings. Crisp, in a slightly weathered white.
    const paint = 'rgba(236,236,230,0.9)';
    ctx.fillStyle = paint;
    const lw = 8 * s;
    // Side lines.
    ctx.fillRect(W * 0.08, H * 0.02, lw, H * 0.96);
    ctx.fillRect(W * 0.92 - lw, H * 0.02, lw, H * 0.96);
    // Centreline dashes.
    const dashLen = 46 * s;
    const gap = 30 * s;
    for (let y = H * 0.1; y < H * 0.9; y += dashLen + gap) ctx.fillRect(W / 2 - 5 * s, y, 10 * s, dashLen);
    // Threshold "piano keys" at each end.
    for (let k = 0; k < 8; k++) {
      const bw = W * 0.055;
      const x = W * 0.14 + k * (bw * 1.55);
      ctx.fillRect(x, H * 0.028, bw, H * 0.035);
      ctx.fillRect(x, H - H * 0.063, bw, H * 0.035);
    }
    // Touchdown aiming point blocks.
    for (const y of [H * 0.115, H - H * 0.15]) {
      ctx.fillRect(W * 0.26, y, 26 * s, H * 0.035);
      ctx.fillRect(W * 0.74 - 26 * s, y, 26 * s, H * 0.035);
    }
    // Touchdown zone bars: pairs of short stripes either side, at 150 m intervals.
    for (const [y0, dir] of [[H * 0.17, 1], [H * 0.83, -1]]) {
      for (let k = 0; k < 3; k++) {
        const y = y0 + dir * k * H * 0.05;
        for (const side of [-1, 1]) {
          for (let j = 0; j < 2; j++) {
            ctx.fillRect(W / 2 + side * (W * 0.2 + j * 14 * s) - (side < 0 ? 8 * s : 0), y, 8 * s, H * 0.022);
          }
        }
      }
    }

    /*
     * No runway numbers in here: airport.js lays them as their own decals
     * (runwayDesignators()), the right way up for the aeroplane landing over
     * them and the right size.
     */

    // Weather the paint so it does not look like a decal: worn thin where
    // the tyres run, flaked here and there.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900 * s * s; i++) {
      ctx.globalAlpha = 0.05 + rnd() * 0.2;
      ctx.beginPath();
      ctx.arc(rnd() * W, rnd() * H, (1 + rnd() * 5) * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    // Rubber over the paint too, where the gear runs over the aiming blocks.
    for (const [z0, dir] of [[H * 0.1, 1], [H * 0.9, -1]]) {
      for (let i = 0; i < 160 * s; i++) {
        const t = rnd() * 0.12;
        const x = W * 0.5 + (rnd() < 0.5 ? -1 : 1) * W * (0.17 + rnd() * 0.08);
        const len = (20 + rnd() * 80) * s;
        streak(x, z0 + dir * t * H - (dir < 0 ? len : 0), len, (1 + rnd() * 2) * s, 0.05 + rnd() * 0.07);
      }
    }
    grain(ctx, W, H, 10, 3);
    return finish(c, { aniso: 8 });
  });
}

/**
 * Taxiways and apron: concrete slabs with their joints, stained and scuffed.
 * Laid by world position at 20 m a tile (airport.js PAVE_TILE), so a slab is
 * 5 m, which is what an apron is poured in.
 */
export function asphaltTexture() {
  return getTiered('asphalt', () => {
    const s = texScale();
    const S = 512 * s;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const rnd = makeRandom(17);
    ctx.fillStyle = '#4e5155';
    ctx.fillRect(0, 0, S, S);
    // Each slab a shade off its neighbours.
    const n = 4;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = (rnd() - 0.5) * 10;
        ctx.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 255})`;
        ctx.fillRect((i * S) / n, (j * S) / n, S / n, S / n);
      }
    }
    tileNoise(ctx, S, S, noiseTile(96, 8, { octaves: 4, seed: 61 }), 256 * s, { alpha: 0.6, mode: 'overlay' });
    tileNoise(ctx, S, S, noiseTile(64, 3, { octaves: 2, seed: 63 }), S, { alpha: 0.25, mode: 'soft-light' });
    // Tyre scuffs: a few faint arcs where tugs and aeroplanes turn. Faint,
    // because the tile repeats every 20 m and anything bolder reads as a
    // pattern from the circuit.
    for (let i = 0; i < 18 * s; i++) {
      ctx.strokeStyle = `rgba(24,24,26,${0.025 + rnd() * 0.05})`;
      ctx.lineWidth = (1 + rnd() * 2) * s;
      ctx.beginPath();
      ctx.arc(rnd() * S, rnd() * S, (40 + rnd() * 120) * s, rnd() * Math.PI * 2, 0.3 + rnd() * 0.7);
      ctx.stroke();
    }
    // Oil and fuel stains, and the odd lighter patch of fresh concrete.
    for (let i = 0; i < 60; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = (6 + rnd() * 22) * s;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(20,20,22,${0.12 + rnd() * 0.16})`);
      g.addColorStop(1, 'rgba(20,20,22,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(200,200,196,${0.05 + rnd() * 0.07})`;
      ctx.fillRect(rnd() * S, rnd() * S, (20 + rnd() * 60) * s, (20 + rnd() * 60) * s);
    }
    // Expansion joints: a dark groove with a light edge, so they read as cut
    // into the slab rather than drawn on it.
    for (let i = 0; i <= n; i++) {
      const p = Math.min(S - 1, (i * S) / n);
      ctx.fillStyle = 'rgba(190,190,186,0.35)';
      ctx.fillRect(p - 2 * s, 0, 4 * s, S);
      ctx.fillRect(0, p - 2 * s, S, 4 * s);
      ctx.fillStyle = 'rgba(28,28,30,0.7)';
      ctx.fillRect(p - 1 * s, 0, 2 * s, S);
      ctx.fillRect(0, p - 1 * s, S, 2 * s);
    }
    grain(ctx, S, S, 14, 17);
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

/**
 * Where the water lies after rain: a roughness map for the tarmac, white
 * (full roughness) on the crown and darker in the dips. Dry, the tarmac's
 * roughness is ~0.9 so the map barely shows; wet, surfaces.js drops it to
 * ~0.3 and the dips become mirror puddles. Tiled with the pavement.
 */
export function puddleRoughness() {
  return get('puddles', () => {
    const S = 256;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(0, 0, S, S);
    tileNoise(ctx, S, S, noiseTile(64, 5, { octaves: 3, seed: 211 }), S, { alpha: 0.25, mode: 'multiply' });
    const rnd = makeRandom(212);
    for (let i = 0; i < 26; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = 8 + rnd() * 30;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(60,60,60,0.9)');
      g.addColorStop(0.55, 'rgba(60,60,60,0.6)');
      g.addColorStop(1, 'rgba(60,60,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r * (0.7 + rnd() * 0.6), r * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    return finish(c, { srgb: false });
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
  /*
   * No lettering in this texture.
   *
   * It used to paint the registration (`scheme.reg`) and a titling line
   * (`scheme.title`, "UNITED STATES OF AMERICA" on Air Force One) into this one
   * 1024 x 1024 skin, which the civil builders put on EVERY surface: the
   * fuselage lathe (u round the body, v nose to tail), the wings (u round the
   * aerofoil, v spanwise) and the nacelles. A line of text at a constant y
   * came out chopped at the fuselage's section joints and out of order on the
   * left side, upside-down-ish on the right, and again as five tiny copies
   * across the top of each wing and on the nacelles; the numbers on the
   * Skylark, Courier and Tempest were not visible anywhere. Lettering is
   * now a decal laid ON the fuselage, once per side, reading left to right
   * from either (./lettersTexture below, and aircraft/models/civil-details.js
   * fuselageLettering) — the way the fleet pack's aeroplanes and the airliners
   * have always done it. `scheme.reg` and `scheme.title` are read there, not here.
   */
  // Sized to the tier (the older civil models: Skylark, Courier, Meridian,
  // Tempest): half the side on Low, so a Chromebook draws a quarter of the
  // pixels; the key carries the tier, so a change redraws it.
  const S = textureTierName === 'low' ? 512 : 1024;
  /*
   * Two optional words a helicopter's paint uses (aircraft/extra/helis.js
   * `paint`, carried through liveries.js schemeFor):
   *   plain    no swooping stripes: a service machine is one colour all
   *            over (the olive drab of the Black Hawk, Chinook and Apache).
   *   upper    a second colour over the top of the body, down to `upperTo`
   *            of the way from the belly (v, 0..1) with a thin `pinstripe`
   *            where they meet: the white top over dark green of the
   *            presidential Sea King. Implies plain.
   */
  const upper = typeof scheme.upper === 'string' ? scheme.upper : '';
  const upperTo = Number.isFinite(scheme.upperTo) ? scheme.upperTo : 0.7;
  const plain = !!scheme.plain || !!upper;
  const pin = typeof scheme.pinstripe === 'string' ? scheme.pinstripe : '';
  const key = ['airframe', baseColor, accent, cheatline, S, ...(plain ? ['plain', upper, upperTo, pin] : [])].join('|');
  return get(key, () => {
    const c = canvas(S);
    const ctx = c.getContext('2d');
    ctx.fillStyle = baseColor;
    ctx.fillRect(0, 0, S, S);
    if (upper) {
      // Canvas y 0 is v 1 (the roof): the upper colour from the top down.
      const yb = Math.round(S * (1 - upperTo));
      ctx.fillStyle = upper;
      ctx.fillRect(0, 0, S, yb);
      if (pin) {
        ctx.fillStyle = pin;
        ctx.fillRect(0, yb, S, Math.max(2, Math.round(S * 0.006)));
      }
    }
    // Subtle metal mottling (very low contrast).
    tileNoise(ctx, S, S, noiseTile(64, 3, { octaves: 3, seed: 3 }), S, { alpha: 0.12, mode: 'overlay' });

    // Livery: two swooping accent stripes across the middle band.
    ctx.save();
    if (plain) ctx.globalAlpha = 0;
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
    const k = S / 1024;
    // On a plain (service) scheme the lines are recessed shadow, not a
    // lighter grid drawn over dark paint.
    ctx.strokeStyle = plain ? 'rgba(10,14,12,0.32)' : 'rgba(90,95,105,0.45)';
    ctx.lineWidth = 1.5 * k;
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
    ctx.fillStyle = plain ? 'rgba(10,14,12,0.3)' : 'rgba(120,126,136,0.5)';
    for (let i = 1; i < 10; i++)
      for (let y = 6 * k; y < S; y += 18 * k) {
        ctx.beginPath();
        ctx.arc((i * S) / 10, y, 1.4 * k, 0, Math.PI * 2);
        ctx.fill();
      }
    for (let i = 1; i < 8; i++)
      for (let x = 6 * k; x < S; x += 18 * k) {
        ctx.beginPath();
        ctx.arc(x, (i * S) / 8, 1.4 * k, 0, Math.PI * 2);
        ctx.fill();
      }

    // Dirt streaks trailing back from panel gaps.
    const rnd = makeRandom(19);
    for (let i = 0; i < 160 * k; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const len = (40 + rnd() * 90) * k;
      const g = ctx.createLinearGradient(x, y, x + len, y);
      g.addColorStop(0, 'rgba(70,70,74,0.16)');
      g.addColorStop(1, 'rgba(70,70,74,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, len, (1 + rnd() * 3) * k);
    }

    return finish(c, { aniso: 8 });
  });
}

/**
 * A transparent label for a decal laid on the fuselage: `text` in `color`,
 * fitted to the canvas. Cached by text, colour and size, like every texture here.
 * (The fleet pack has its own, aircraft-textures.js aircraftDecalTexture; this
 * is the legacy builders' copy, so they do not import the whole pack.)
 */
export function lettersTexture(text, { color = '#1f272e', width = 512, height = 128, weight = 600, spacing = 0 } = {}) {
  const t = String(text || '').trim();
  if (!t) throw new TypeError('lettersTexture needs some text.');
  const w = Math.max(32, Math.min(2048, Math.round(width)));
  const h = Math.max(16, Math.min(1024, Math.round(height)));
  // `weight` (100-900) and `spacing` (em) as the fleet pack's decal has them
  // (fleet/aircraft-textures.js aircraftDecalTexture): a registration is
  // medium and stencil-spaced, a name heavier. Same key shape, so a default
  // ask is the same texture it always was.
  const wt = Math.max(100, Math.min(900, Math.round(Number(weight) || 600)));
  const sp = Math.max(0, Math.min(0.5, Number(spacing) || 0));
  return get(['letters', t, color, w, h, ...(wt !== 600 || sp > 0 ? [wt, sp] : [])].join('|'), () => {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const size = Math.min(h * 0.68, w / (Math.max(t.length, 1) * (0.66 + sp)));
    ctx.font = `${wt} ${size}px "Helvetica Neue", Helvetica, Arial, sans-serif`;
    let nudge = 0;
    if (sp > 0 && 'letterSpacing' in ctx) {
      try {
        ctx.letterSpacing = `${(sp * size).toFixed(2)}px`;
        nudge = sp * size * 0.5; // the spacing after the last letter, halved, so the word stays centred
      } catch (e) {
        /* an older canvas keeps the plain spacing */
      }
    }
    ctx.fillText(t, w * 0.5 + nudge, h * 0.52, w * 0.93);
    const tex = finish(c, { aniso: 8 });
    tex.userData.text = t; // what it says, for the tests
    // A label, not a tile: its edges must not bleed round to the other side.
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  });
}

/**
 * A star roundel of the game's own: a gold five-pointed star on a navy disc
 * inside a gold ring — the mark on the presidential helicopter's door
 * (aircraft/models/helis.js, the VH-3D). Deliberately no seal, no eagle, no
 * words: an emblem of ours, not anybody's official one.
 */
export function starRoundelTexture(size = 256) {
  const n = Math.max(64, Math.min(512, Math.round(size)));
  return get(['roundel', n].join('|'), () => {
    const c = canvas(n);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, n, n);
    const r = n / 2;
    ctx.fillStyle = '#c9a227';
    ctx.beginPath();
    ctx.arc(r, r, r * 0.98, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1b2a4a';
    ctx.beginPath();
    ctx.arc(r, r, r * 0.84, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e8d58a';
    ctx.lineWidth = Math.max(1, n * 0.012);
    ctx.beginPath();
    ctx.arc(r, r, r * 0.76, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#d9b543';
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i % 2 ? r * 0.27 : r * 0.62;
      if (i) ctx.lineTo(r + Math.cos(a) * rr, r + Math.sin(a) * rr);
      else ctx.moveTo(r + Math.cos(a) * rr, r + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    const tex = finish(c, { aniso: 4 });
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
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

/*
 * The office facade is six bays by seven storeys (airport.js OFFICE_TILE
 * and scenery.js lay it a bay at a time, so the grid must stay). Each
 * variant is a different building: its wall, its spandrels and its glass,
 * and which windows have blinds or curtains. The same seed draws the night
 * map, so the panes lit after dark are panes that exist by day.
 */
const FACADES = [
  // wall, spandrel, frame, glass top, glass bottom
  { wall: '#cfc9bd', spandrel: '#b7b0a3', frame: '#3a3f45', glassA: '#8fa9bd', glassB: '#3a4a58', blinds: 0.3 },
  { wall: '#bca58e', spandrel: '#9c8770', frame: '#2f2a25', glassA: '#9db4c6', glassB: '#41505c', blinds: 0.22 },
  { wall: '#a9b3bc', spandrel: '#7c8791', frame: '#2b3138', glassA: '#a7c0d2', glassB: '#2f3d4a', blinds: 0.18 },
  { wall: '#d9d3c6', spandrel: '#c2bbae', frame: '#4a4f55', glassA: '#92abbe', glassB: '#3c4b59', blinds: 0.36 },
];

function facadeWindows(variant) {
  const cols = 6;
  const rows = 7;
  const rnd = makeRandom(101 + variant);
  const list = [];
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      // One roll per window, shared by day and night.
      const q = rnd();
      const q2 = rnd();
      list.push({ r, col, q, q2 });
    }
  }
  return list;
}

export function buildingTexture(variant = 0) {
  return getTiered('bldg' + variant, () => {
    const s = texScale();
    const W = 512 * s;
    const H = 512 * s;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const F = FACADES[variant % FACADES.length];
    const cols = 6;
    const rows = 7;
    const mw = W / cols;
    const mh = H / rows;
    const rnd = makeRandom(301 + variant);

    // Render, with a little mottle and the odd lighter panel.
    ctx.fillStyle = F.wall;
    ctx.fillRect(0, 0, W, H);
    tileNoise(ctx, W, H, noiseTile(64, 4, { octaves: 3, seed: 71 + variant }), W, { alpha: 0.26, mode: 'overlay' });
    tileNoise(ctx, W, H, noiseTile(96, 14, { octaves: 3, seed: 75 + variant }), W / 2, { alpha: 0.12, mode: 'soft-light' });

    for (const win of facadeWindows(variant)) {
      const { r, col, q, q2 } = win;
      const x0 = col * mw;
      const y0 = r * mh;
      // The spandrel: the band between one storey's window head and the
      // next's sill, a touch darker than the wall, with a slab line.
      ctx.fillStyle = F.spandrel;
      ctx.fillRect(x0, y0 + mh * 0.74, mw, mh * 0.26);
      ctx.fillStyle = 'rgba(0,0,0,0.16)';
      ctx.fillRect(x0, y0 + mh * 0.74, mw, Math.max(1, 2 * s));
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x0, y0 + mh - Math.max(1, 2 * s), mw, Math.max(1, 2 * s));

      const x = x0 + mw * 0.16;
      const y = y0 + mh * 0.16;
      const w = mw * 0.68;
      const hh = mh * 0.54;
      // Reveal: the window sits in the wall, so its top and left are in shade.
      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.fillRect(x - 3 * s, y - 3 * s, w + 6 * s, hh + 6 * s);
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.fillRect(x - 3 * s, y + hh + 1 * s, w + 6 * s, 2 * s);
      // Frame.
      ctx.fillStyle = F.frame;
      ctx.fillRect(x, y, w, hh);
      // Glass: the sky at the top, the room at the bottom.
      const inset = 2.5 * s;
      const g = ctx.createLinearGradient(x, y, x + w * 0.3, y + hh);
      g.addColorStop(0, F.glassA);
      g.addColorStop(0.45, F.glassB);
      g.addColorStop(0.5, F.glassA);
      g.addColorStop(1, F.glassB);
      ctx.fillStyle = g;
      ctx.fillRect(x + inset, y + inset, w - 2 * inset, hh - 2 * inset);
      // Blinds and curtains, on some.
      if (q < F.blinds) {
        const down = 0.3 + q2 * 0.6;
        ctx.fillStyle = 'rgba(226,222,210,0.85)';
        ctx.fillRect(x + inset, y + inset, w - 2 * inset, (hh - 2 * inset) * down);
        ctx.fillStyle = 'rgba(0,0,0,0.12)';
        for (let k = 1; k < 8 * down; k++) ctx.fillRect(x + inset, y + inset + k * 3.2 * s, w - 2 * inset, Math.max(1, s));
      } else if (q > 0.9) {
        ctx.fillStyle = 'rgba(190,170,150,0.7)';
        ctx.fillRect(x + inset, y + inset, (w - 2 * inset) * 0.3, hh - 2 * inset);
      }
      // Glazing bar down the middle and the transom.
      ctx.fillStyle = F.frame;
      ctx.fillRect(x + w / 2 - 1 * s, y, 2 * s, hh);
      ctx.fillRect(x, y + hh * 0.35, w, 2 * s);
      // Sill, lighter, and the drip stain under it.
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(x - 4 * s, y + hh + 3 * s, w + 8 * s, 3 * s);
      const dg = ctx.createLinearGradient(0, y + hh + 6 * s, 0, y + hh + 26 * s);
      dg.addColorStop(0, `rgba(50,48,44,${0.08 + q2 * 0.14})`);
      dg.addColorStop(1, 'rgba(50,48,44,0)');
      ctx.fillStyle = dg;
      ctx.fillRect(x - 2 * s, y + hh + 6 * s, w + 4 * s, 20 * s);
    }
    // Grime streaks down the render, heavier low down.
    for (let i = 0; i < 60; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      const len = (30 + rnd() * 80) * s;
      const g = ctx.createLinearGradient(x, y, x, y + len);
      g.addColorStop(0, 'rgba(60,58,54,0.14)');
      g.addColorStop(1, 'rgba(60,58,54,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, y, (2 + rnd() * 4) * s, len);
    }
    grain(ctx, W, H, 6, 303 + variant);
    return finish(c);
  });
}

/**
 * The same facade after dark: black, with a third of the windows lit — warm
 * lamps in most, a cooler office fluorescent in some, and a few half-drawn
 * blinds glowing at the edge. An emissive map (emissiveIntensity 0 by day).
 */
export function buildingNightTexture(variant = 0) {
  return getTiered('bldgNight' + variant, () => {
    const s = texScale();
    const W = 512 * s;
    const H = 512 * s;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    const F = FACADES[variant % FACADES.length];
    const cols = 6;
    const rows = 7;
    const mw = W / cols;
    const mh = H / rows;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, W, H);
    for (const win of facadeWindows(variant)) {
      const { r, col, q, q2 } = win;
      // Lit: a third of them, never the ones with the curtain drawn.
      const lit = q2 > 0.62 && q <= 0.9;
      if (!lit) continue;
      const x = col * mw + mw * 0.16;
      const y = r * mh + mh * 0.16;
      const w = mw * 0.68;
      const hh = mh * 0.54;
      const inset = 2.5 * s;
      const warm = q > 0.3;
      const k = 0.75 + q2 * 0.35;
      ctx.fillStyle = warm ? `rgba(255,${(205 * k) | 0},${(140 * k) | 0},${0.8 + q * 0.2})` : `rgba(${(200 * k) | 0},${(225 * k) | 0},255,${0.7 + q * 0.2})`;
      ctx.fillRect(x + inset, y + inset, w - 2 * inset, hh - 2 * inset);
      if (q < F.blinds) {
        const down = 0.3 + q2 * 0.6;
        ctx.fillStyle = 'rgba(0,0,0,0.62)';
        ctx.fillRect(x + inset, y + inset, w - 2 * inset, (hh - 2 * inset) * down);
      }
      ctx.fillStyle = '#000000';
      ctx.fillRect(x + w / 2 - 1 * s, y, 2 * s, hh);
      ctx.fillRect(x, y + hh * 0.35, w, 2 * s);
    }
    return finish(c);
  });
}

/**
 * Profiled steel cladding: the sheet's ribs, its panel laps every 1.5 m of
 * height, the fixings along each lap, and the grime and rust that collect
 * at its foot. 16 px a rib = 6 ribs a metre at the hangar's 6 m tile.
 */
export function hangarTexture() {
  return getTiered('hangar', () => {
    const s = texScale();
    const W = 512 * s;
    const H = 512 * s;
    const c = canvas(W, H);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9aa2a8';
    ctx.fillRect(0, 0, W, H);
    tileNoise(ctx, W, H, noiseTile(64, 3, { octaves: 2, seed: 51 }), W, { alpha: 0.12, mode: 'soft-light' });
    // The ribs: a trapezoid profile, lit from the left.
    const rib = 16 * s;
    for (let x = 0; x < W; x += rib) {
      const g = ctx.createLinearGradient(x, 0, x + rib, 0);
      g.addColorStop(0, 'rgba(255,255,255,0.2)');
      g.addColorStop(0.3, 'rgba(255,255,255,0.05)');
      g.addColorStop(0.55, 'rgba(0,0,0,0.05)');
      g.addColorStop(0.8, 'rgba(0,0,0,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0.3)');
      ctx.fillStyle = g;
      ctx.fillRect(x, 0, rib, H);
    }
    // Panel laps, with a row of fixings.
    const rnd = makeRandom(53);
    const lap = H / 4;
    for (let y = lap; y < H; y += lap) {
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.fillRect(0, y - 2 * s, W, 3 * s);
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      ctx.fillRect(0, y + 1 * s, W, 1.5 * s);
      for (let x = rib / 2; x < W; x += rib * 2) {
        ctx.fillStyle = 'rgba(40,42,44,0.6)';
        ctx.beginPath();
        ctx.arc(x, y - 7 * s, 1.6 * s, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Rust streaks under some fixings, grime at the base.
    for (let i = 0; i < 24; i++) {
      const x = rnd() * W;
      const y = Math.floor(rnd() * 4) * lap - 7 * s;
      const len = (10 + rnd() * 50) * s;
      const g = ctx.createLinearGradient(0, y, 0, y + len);
      g.addColorStop(0, `rgba(140,80,40,${0.15 + rnd() * 0.25})`);
      g.addColorStop(1, 'rgba(140,80,40,0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - 1.5 * s, y, 3 * s, len);
    }
    for (let i = 0; i < 420 * s; i++) {
      const x = rnd() * W;
      const y = H - Math.pow(rnd(), 2) * H * 0.4;
      ctx.fillStyle = `rgba(${60 + rnd() * 40},${58 + rnd() * 30},50,${0.03 + rnd() * 0.08})`;
      ctx.beginPath();
      ctx.arc(x, y, (2 + rnd() * 10) * s, 0, Math.PI * 2);
      ctx.fill();
    }
    grain(ctx, W, H, 8, 57);
    return finish(c);
  });
}

/**
 * The cladding's relief, as a normal map: the same trapezoid ribs the
 * colour map shades, so the sheet catches the light along every rib as the
 * sun moves. Applied on Medium and up (surfaces.js metalMaterial).
 */
export function claddingNormal() {
  return get('claddingN', () => {
    const res = 128;
    const field = new Float32Array(res * res);
    const rib = 16; // matches hangarTexture at 512 px: 32 ribs a tile → 128 / 32 = 4 px a rib here, so 4 ribs per 16 px
    for (let y = 0; y < res; y++) {
      for (let x = 0; x < res; x++) {
        // Four ribs per 16 texels: the profile at 512 px is 16 px a rib, and
        // this map is a quarter the size, so one rib is 4 texels.
        const t = (x % 4) / 4;
        const prof = t < 0.3 ? t / 0.3 : t < 0.55 ? 1 : t < 0.8 ? 1 - (t - 0.55) / 0.25 : 0;
        // Laps: a step every quarter of the height.
        const lapT = (y % (res / 4)) / (res / 4);
        const lap = lapT > 0.96 ? 0.5 : 0;
        field[y * res + x] = prof * 0.35 + lap + (rib ? 0 : 0);
      }
    }
    return finish(normalMapFromField(res, field, 1.6), { srgb: false });
  });
}

/**
 * A flat roof: a single-ply membrane with its seams every 1.5 m, ponding
 * stains, gravel ballast in the corners and the odd patch. The plant on it
 * — AC units, tanks, vents — is geometry now (scenery.js rooftopDetail).
 */
export function roofTexture() {
  return getTiered('roof', () => {
    const s = texScale();
    const S = 512 * s;
    const c = canvas(S);
    const ctx = c.getContext('2d');
    const rnd = makeRandom(67);
    ctx.fillStyle = '#5f6266';
    ctx.fillRect(0, 0, S, S);
    tileNoise(ctx, S, S, noiseTile(64, 8, { octaves: 3, seed: 67 }), S / 2, { alpha: 0.35, mode: 'overlay' });
    tileNoise(ctx, S, S, noiseTile(96, 20, { octaves: 3, seed: 68 }), S / 2, { alpha: 0.2, mode: 'soft-light' });
    // Membrane seams, lapped.
    const seam = S / 6;
    for (let i = 0; i < 6; i++) {
      const y = i * seam;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(0, y, S, 3 * s);
      ctx.fillStyle = 'rgba(255,255,255,0.1)';
      ctx.fillRect(0, y + 3 * s, S, 2 * s);
    }
    // Ponding: where the water lies, a darker tide mark.
    for (let i = 0; i < 7; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = (20 + rnd() * 60) * s;
      const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r);
      g.addColorStop(0, 'rgba(30,32,34,0.12)');
      g.addColorStop(0.85, 'rgba(30,32,34,0.26)');
      g.addColorStop(1, 'rgba(30,32,34,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Patches, and a few vent stains.
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(${90 + rnd() * 30},${90 + rnd() * 30},${94 + rnd() * 30},0.5)`;
      ctx.fillRect(rnd() * S, rnd() * S, (14 + rnd() * 40) * s, (14 + rnd() * 40) * s);
    }
    for (let i = 0; i < 1400 * s; i++) {
      ctx.fillStyle = `rgba(${150 + rnd() * 60},${148 + rnd() * 60},${140 + rnd() * 60},0.35)`;
      const x = rnd() * S;
      const y = rnd() * S;
      // Gravel drifts to the edges.
      if (Math.min(x, y, S - x, S - y) > S * 0.12 && rnd() < 0.8) continue;
      ctx.fillRect(x, y, 1.5 * s, 1.5 * s);
    }
    grain(ctx, S, S, 12, 71);
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

/**
 * A snowflake: a soft white dot, slightly brighter in the middle, for the
 * snow that falls on Nunatak Reach (world/precip.js). One texture for every
 * flake; the shader stretches the rain streak and leaves this round.
 */
/**
 * The ice strip's surface: compacted snow over ice, as an Antarctic skiway
 * or an Arctic ice runway is kept — ploughed in lanes, the tyre tracks of
 * every landing down the middle, and MARKED in black the way a snow runway
 * has to be (there is no paint on ice): threshold bars, a dashed centreline,
 * edge lines. The owner's screenshot (2026-10-30, an A-10 lined up) showed
 * a blank pure-white slab with no markings or texture; this is what it
 * draws now. Painted once, 512 x 1536 along the strip.
 */
export function iceRunwayTexture() {
  return get('ice-runway', () => {
  const W = 512;
  const H = 1536;
  const c = canvas(W, H);
  const g = c.getContext('2d');
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  // Compacted snow: pale blue-grey, a shade darker where the wheels run.
  g.fillStyle = '#d3dde6';
  g.fillRect(0, 0, W, H);
  // Plough lanes down the length, each a shade off its neighbour.
  const lanes = 11;
  for (let i = 0; i < lanes; i++) {
    const v = (rnd() - 0.5) * 18;
    g.fillStyle = v > 0 ? `rgba(255,255,255,${v / 255})` : `rgba(90,110,130,${-v / 255})`;
    g.fillRect((i * W) / lanes, 0, W / lanes + 1, H);
    g.fillStyle = 'rgba(120,140,160,0.25)';
    g.fillRect((i * W) / lanes, 0, 2, H);
  }
  // Tyre tracks: grey streaks where the main gear runs, densest near the ends.
  for (let i = 0; i < 700; i++) {
    const band = rnd() < 0.15 ? 0 : rnd() < 0.5 ? -1 : 1;
    const x = W * 0.5 + band * W * 0.18 + (rnd() - 0.5) * W * 0.12;
    const y = rnd() * H;
    const len = 30 + rnd() * 160;
    g.fillStyle = `rgba(110,125,140,${0.05 + rnd() * 0.12})`;
    g.fillRect(x - 1.5, y, 3 + rnd() * 2, len);
  }
  // Ice showing through the snow in patches: a little bluer, a little glossier-looking.
  for (let i = 0; i < 40; i++) {
    g.fillStyle = `rgba(150,185,215,${0.08 + rnd() * 0.12})`;
    g.beginPath();
    g.ellipse(rnd() * W, rnd() * H, 20 + rnd() * 60, 40 + rnd() * 120, 0, 0, Math.PI * 2);
    g.fill();
  }
  // The markings, black: threshold bars at both ends, a dashed centreline, edge lines.
  g.fillStyle = '#16181c';
  for (const end of [0, 1]) {
    const y0 = end ? H - H * 0.065 : H * 0.02;
    for (let k = 0; k < 6; k++) g.fillRect(W * 0.1 + k * W * 0.14, y0, W * 0.09, H * 0.045);
  }
  for (let y = H * 0.1; y < H * 0.9; y += 60) g.fillRect(W * 0.5 - 5, y, 10, 36);
  g.fillRect(W * 0.035, 0, 6, H);
  g.fillRect(W * 0.965 - 6, 0, 6, H);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
  });
}


export function snowflakeTexture() {
  return get('snowflake', () => {
    const c = canvas(32, 32);
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 1, 16, 16, 15);
    g.addColorStop(0, 'rgba(255,255,255,0.95)');
    g.addColorStop(0.45, 'rgba(240,246,255,0.6)');
    g.addColorStop(1, 'rgba(230,240,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
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

/** Build everything up-front so there are no hitches mid-flight. */
export async function warmTextures(onProgress = () => {}) {
  const steps = [
    ['Grass', grassTexture],
    ['Sand', sandTexture],
    ['Rock', rockTexture],
    ['Terrain blend', terrainSplatNoise],
    ['Runway markings', runwayTexture],
    ['Apron concrete', asphaltTexture],
    ['Asphalt relief', asphaltNormal],
    ['Puddles', puddleRoughness],
    ['Ground relief', groundNormal],
    ['Ocean surface', waterNormal],
    ['Sea foam', foamTexture],
    ['Airframe paint', () => airframeTexture()],
    ['Airframe relief', airframeNormal],
    ['Propeller', () => { propTexture(); propBlurTexture(); }],
    ['Instrument panel', () => { panelTexture(); panelNormal(); }],
    ['Cabin leather', () => leatherTexture()],
    ['Terminal', () => { buildingTexture(0); buildingNightTexture(0); }],
    ['Town buildings', () => { buildingTexture(1); buildingTexture(2); buildingTexture(3); }],
    ['Lit windows', () => { buildingNightTexture(1); buildingNightTexture(2); buildingNightTexture(3); }],
    ['Hangar cladding', () => { hangarTexture(); claddingNormal(); }],
    ['Rooftops', roofTexture],
    ['Clouds', () => { cloudTexture(1); cloudTexture(2); cloudTexture(3); }],
    ['Rain', () => { rainStreakTexture(); dropletTexture(); }],
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

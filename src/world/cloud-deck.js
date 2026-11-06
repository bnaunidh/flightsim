/**
 * The cloud layer (the owner, 2026-11-05: "the higher u are in game the
 * cloudier it is, till 10k feet where it breaks through yk yk - but theres
 * always clear patches every so often and some parts").
 *
 * ONE FIELD. Two tiling textures, held here on the CPU as well, say where
 * cloud is: a big one with the open areas and the drifting holes in it, and a
 * small one with the billows. Everything reads them: the sheets drawn (the
 * shader below), the sprites that stand in them, the fog and the whiteout
 * (`immersion`), the sky's clearing, the shadow on the ground (`shadeAt`) and
 * what the ordinary clouds may do (`gapMask`). deckShape() and the shader are
 * the same sum, line for line (tests/features/cloud-deck.mjs compares them).
 *
 * THE SHAPE, k = 0 at the cloud base (the weather's), 1 at 10,000 ft:
 *   - a place has cloud at height k if the field there beats a threshold that
 *     falls as k rises, so more of the sky is cloud the higher you are, and
 *     the threshold never goes under the tops' (1 - deck): a gap at the tops
 *     is a gap at every height, a real hole you can see the ground through;
 *   - the density rises with k, so the white comes on as you climb;
 *   - the tops are flat at DECK_TOP_M, falling away toward the gaps, and
 *     above them there is none: clear sky.
 *
 * THE SHEETS. Horizontal shells, one instanced draw call, drawn far to near
 * (the order is rewritten as the eye passes one), so they are a ray march at
 * fixed heights that the depth buffer cuts where a mountain stands in it.
 * More of them near the tops, where the solid surface is. Low draws one
 * textured sheet and no sprites (no more fill than v77.3's overcast, which
 * was two decks): the same field, the same fog, so the climb still reads.
 * High draws sixteen, lit by the sun across the billows.
 *
 * Multiplayer: the field is a pure function of position and the wall clock
 * (a fixed slow drift, not the wind, which is each player's own sum), so
 * players who share a sky share its holes.
 *
 * This file arrives with the features (features/cloud-layer.js), never in the
 * first load.
 */
import * as THREE from '../vendor/three.module.js';
import { clamp, makeRandom } from '../core/noise.js';
import { cloudTexture } from '../render/textures.js';
import { cloudWhiteout } from '../render/surfaces.js';
import { PuffBatch } from './clouds.js';
import { DECK_TOP_M } from './wx.js';

export { DECK_TOP_M };

/** The big tile's and the billows' width, metres. A whole number of one in the other: the two wrap together. */
export const FIELD_SIZE = 65536;
export const DETAIL_SIZE = 8192;
const MACRO_N = 256;
const DETAIL_N = 256;
/** How far the billows push the field, and the width of a cloud's edge in it. */
const DETAIL_AMP = 0.2;
const EDGE = 0.05;
/** The field's drift, m/s, and the time it takes: see the file's head. */
export const DRIFT = { x: 4.1, z: -2.7 };
/** The sheets' reach, metres: past the sea plane, inside the far plane (60 km). */
const REACH = 52000;
/** Sheets a tier draws, and the optical depth of each. */
const SHEETS = { low: 1, medium: 8, high: 16, ultra: 24 };
const TAU = { low: 2.4, medium: 2, high: 1.25, ultra: 0.85 };
/** Sprites standing in the layer, and how far round the eye they wrap. */
const SPRITES = { low: 0, medium: 120, high: 240, ultra: 360 };
const SPRITE_RANGE = 11000;
/** How fast a change of sky reaches the layer (a share of the tops a second) and the eye's white-out settles (seconds). */
const COVER_RATE = 0.15;
const IMMERSION_S = 0.4;

const sstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/*
 * The field itself: periodic value noise, summed; the big one rank-equalised,
 * so that its value is a share of the map: `deck` of the area is over 1 - deck.
 */
function periodic(n, layers, seed, shape) {
  const out = new Float32Array(n * n);
  const rnd = makeRandom(seed);
  for (const [cells, weight] of layers) {
    // Gradient noise: value noise's edges run square to the grid, and a threshold shows it.
    const gx = new Float32Array(cells * cells);
    const gy = new Float32Array(cells * cells);
    for (let i = 0; i < gx.length; i++) {
      const a = rnd() * Math.PI * 2;
      gx[i] = Math.cos(a);
      gy[i] = Math.sin(a);
    }
    for (let y = 0; y < n; y++) {
      const fy = (y / n) * cells;
      const iy = Math.floor(fy);
      const ty = fy - iy;
      const uy = ty * ty * (3 - 2 * ty);
      const r0 = iy * cells;
      const r1 = ((iy + 1) % cells) * cells;
      for (let x = 0; x < n; x++) {
        const fx = (x / n) * cells;
        const ix = Math.floor(fx);
        const tx = fx - ix;
        const ux = tx * tx * (3 - 2 * tx);
        const ix1 = (ix + 1) % cells;
        const d00 = gx[r0 + ix] * tx + gy[r0 + ix] * ty;
        const d10 = gx[r0 + ix1] * (tx - 1) + gy[r0 + ix1] * ty;
        const d01 = gx[r1 + ix] * tx + gy[r1 + ix] * (ty - 1);
        const d11 = gx[r1 + ix1] * (tx - 1) + gy[r1 + ix1] * (ty - 1);
        const a = d00 + (d10 - d00) * ux;
        const b = d01 + (d11 - d01) * ux;
        const v = 0.5 + 0.75 * (a + (b - a) * uy);
        out[y * n + x] += (shape ? shape(v) : v) * weight;
      }
    }
  }
  return out;
}

/** Values → their rank, 0..255: a flat histogram. */
function ranked(src) {
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < src.length; i++) {
    if (src[i] < lo) lo = src[i];
    if (src[i] > hi) hi = src[i];
  }
  const BINS = 4096;
  const scale = (BINS - 1) / Math.max(1e-6, hi - lo);
  const cdf = new Float32Array(BINS);
  for (let i = 0; i < src.length; i++) cdf[Math.floor((src[i] - lo) * scale)]++;
  let sum = 0;
  for (let i = 0; i < BINS; i++) {
    sum += cdf[i];
    cdf[i] = sum / src.length;
  }
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.round(cdf[Math.floor((src[i] - lo) * scale)] * 255);
  return out;
}

function fieldTexture(data, n, format, name) {
  const t = new THREE.DataTexture(data, n, n, format, THREE.UnsignedByteType);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  // Mipmapped: far off the billows average away instead of shimmering.
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.name = name;
  t.needsUpdate = true;
  return t;
}

/** Both textures, built once a session (a few milliseconds on a Mac, tens on a Chromebook; after the menu). */
let FIELD = null;
export function deckField() {
  if (FIELD) return FIELD;
  // The open areas (about 20 km), the holes (10, 5 and 2 km), their shores.
  const macro = ranked(periodic(MACRO_N, [[3, 0.2], [6, 0.3], [13, 0.27], [27, 0.15], [55, 0.08]], 90211));
  const billow = (v) => 1 - Math.abs(2 * v - 1);
  const detail = ranked(periodic(DETAIL_N, [[3, 0.34], [7, 0.3], [15, 0.19], [31, 0.11], [63, 0.06]], 90233, billow));
  FIELD = {
    macro,
    detail,
    macroTex: fieldTexture(macro, MACRO_N, THREE.RedFormat, 'deck-macro'),
    detailTex: fieldTexture(detail, DETAIL_N, THREE.RedFormat, 'deck-detail'),
  };
  return FIELD;
}

/** A texture as its sampler reads it: bilinear, wrapped, texel centres on the half. 0..1. */
function bilinear(data, n, size, x, y) {
  const u = (x / size) * n - 0.5;
  const v = (y / size) * n - 0.5;
  const ix = Math.floor(u);
  const iy = Math.floor(v);
  const tx = u - ix;
  const ty = v - iy;
  const m = n - 1; // n is a power of two
  const a = data[(iy & m) * n + (ix & m)];
  const b = data[(iy & m) * n + ((ix + 1) & m)];
  const c = data[((iy + 1) & m) * n + (ix & m)];
  const d = data[((iy + 1) & m) * n + ((ix + 1) & m)];
  return (a + (b - a) * tx + (c - a + (d - c - b + a) * tx) * ty) / 255;
}

/**
 * The layer's shape at one spot: the big field `m`, the billows `b`, height
 * `k`. Returns the density, 0..1; `out`, if given, gets the local top and the
 * thickness above. THE SHADER BELOW IS THIS SUM.
 */
export function deckShape(m, b, k, deck, foot, out = null, soft = 0.05) {
  if (k < 0 || k > 1) return 0;
  const v = m + (b - 0.5) * DETAIL_AMP;
  const thr = 1 - deck * (foot + (1 - foot) * sstep(0, 1, k));
  const body = sstep(thr, thr + EDGE, v);
  const inner = 1 - clamp((v - (1 - deck)) / Math.min(0.3, Math.max(0.04, deck)), 0, 1);
  const top = 1 - inner * inner * 0.18 - b * 0.08;
  const cap = 1 - sstep(top - soft, top, k);
  if (out) {
    out.top = top;
    out.body = body;
  }
  return (0.34 + 0.66 * clamp(k, 0, 1)) * body * cap;
}

const sheetVert = /* glsl */ `
  attribute float iK;
  uniform vec4 uSpan;     // base, top, reach, optical depth
  uniform vec2 uCentre;   // the mesh's middle in the field's own metres
  uniform vec2 uShape;    // deck, foot
  uniform float uStep;    // 1 / the sheets' number, over the optical depth
  varying vec2 vF;
  varying vec3 vRay;
  varying float vK;
  varying float vThr;
  varying float vRho;
  varying float vSoft;
  varying float vEdge;
  varying float vGap;
  void main() {
    vK = iK;
    // A sheet melts over about the gap to its neighbours, so no sheet ever shows its own edge.
    float gap = uSpan.w * sqrt(max(0.0, 1.0 - iK)) * uStep;
    vGap = gap;
    vSoft = max(0.02, gap * 1.4);
    vEdge = max(${EDGE.toFixed(3)}, gap * 6.0 * iK * (1.0 - iK) * uShape.x * (1.0 - uShape.y) * 1.8);
    float s = iK * iK * (3.0 - 2.0 * iK);
    vThr = 1.0 - uShape.x * (uShape.y + (1.0 - uShape.y) * s);
    vRho = 0.34 + 0.66 * iK;
    vec3 p = vec3(position.x * uSpan.z, mix(uSpan.x, uSpan.y, iK), position.y * uSpan.z);
    vF = uCentre + p.xz;
    vec4 wp = modelMatrix * vec4(p, 1.0);
    vRay = wp.xyz - cameraPosition;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const sheetFrag = /* glsl */ `
  precision highp float;
  uniform sampler2D uMacro;
  uniform sampler2D uDetail;
  uniform vec4 uSpan;
  uniform vec2 uShape;
  uniform vec3 uLit;
  uniform vec3 uDim;
  uniform vec3 uFogColor;
  uniform float uFogD;
  uniform float uVeil;
  uniform vec2 uNear;
  uniform vec3 uSun;      // the billows' metres toward the sun, and how much it shows
  varying vec2 vF;
  varying vec3 vRay;
  varying float vK;
  varying float vThr;
  varying float vRho;
  varying float vSoft;
  varying float vEdge;
  varying float vGap;
  void main() {
    vec2 F = vF;
    float K = vK;
    float thr = vThr;
    #ifdef DECK_FINE
      /*
       * Each pixel of a sheet samples a little up or down its own ray: a ray
       * march's jitter, which breaks up the rings where the sheets meet a
       * slope. The fine billows do it close to, the screen dither far off,
       * where the mipmaps have averaged the billows away. Neither moves
       * from frame to frame, so it cannot flicker.
       */
      float f = texture2D(uDetail, vF / ${(DETAIL_SIZE / 3.7).toFixed(2)}).r;
      float j = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5;
      j = ((f - 0.5) * 1.0 + j * 0.65) * vGap;
      K = clamp(vK + j, 0.0, 1.0);
      F += vRay.xz * (K - vK) * (uSpan.y - uSpan.x) / max(abs(vRay.y), length(vRay) * 0.1) * sign(vRay.y);
      float js = K * K * (3.0 - 2.0 * K);
      thr = 1.0 - uShape.x * (uShape.y + (1.0 - uShape.y) * js);
    #endif
    float m = texture2D(uMacro, F / ${FIELD_SIZE.toFixed(1)}).r;
    float b = texture2D(uDetail, F / ${DETAIL_SIZE.toFixed(1)}).r;
    float v = m + (b - 0.5) * ${DETAIL_AMP.toFixed(3)};
    #ifdef DECK_FINE
      v += (f - 0.5) * 0.09;
    #endif
    float body = smoothstep(thr, thr + vEdge, v);
    if (body <= 0.0) discard;
    float inner = 1.0 - clamp((v - (1.0 - uShape.x)) / clamp(uShape.x, 0.04, 0.3), 0.0, 1.0);
    float top = 1.0 - inner * inner * 0.18 - b * 0.08;
    float rho = vRho * body * (1.0 - smoothstep(top - vSoft, top, K));
    if (rho < 0.004) discard;
    float len = length(vRay);
    float a = 1.0 - exp(-rho * uSpan.w * len / max(abs(vRay.y), len * 0.35));
    a *= smoothstep(uNear.x, uNear.y, len) * (1.0 - smoothstep(0.74, 0.98, len / uSpan.z)) * (1.0 - uVeil * 0.8);
    // The thickness of cloud over this point: its light has come through that.
    float sub = clamp((top - K) * 3.0, 0.0, 1.0);
    vec3 col = mix(uLit, uDim, sub);
    // Thin edges glow.
    col = mix(col, uLit, (1.0 - body) * 0.35 * (1.0 - sub));
    #ifdef DECK_FINE
      col *= 0.95 + 0.1 * f;
    #else
      col *= 0.86 + 0.26 * (1.0 - b);
    #endif
    #ifdef DECK_RELIEF
      // Lit across the billows: the side of each that faces the sun is bright, the far side is shade.
      float b2 = texture2D(uDetail, (F + uSun.xy) / ${DETAIL_SIZE.toFixed(1)}).r;
      float shade = (b2 - b) * uSun.z;
      col = mix(col * (1.0 + clamp(shade, 0.0, 0.12)), uDim, clamp(-shade, 0.0, 0.62) * (1.0 - sub));
    #endif
    float fd = uFogD * len;
    col = mix(col, uFogColor, 1.0 - exp(-fd * fd));
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

const _white = new THREE.Color(0xffffff);
const _sun = new THREE.Vector3();
const _grey = new THREE.Color(0x8d97a6);
const _nightGrey = new THREE.Color(0x0a0f18);
const _rainGrey = new THREE.Color(0x4c5561);
const _shape = { top: 1, body: 0 };

export class CloudDeck {
  /** `group`: disposed with the world. `quality`: the tier built. */
  constructor(group, quality = 'high') {
    this.quality = quality;
    this.field = deckField();
    /** What the layer is right now (eased from the weather, so a change of sky never pops). */
    this.deck = 0;
    this.foot = 0.3;
    this.base = 1100;
    /** 0..1 how deep in cloud the eye is, steady enough to fly through. */
    this.immersion = 0;
    this.puffFade = 1;
    this._tick = 0;
    this.towerCut = 0;
    this._snap = true;
    /** The wall clock in ms (a test sets its own). */
    this.now = () => Date.now();
    this.ox = 0;
    this.oz = 0;
    this.slantX = 0;
    this.slantZ = 0;

    const n = SHEETS[quality] || SHEETS.high;
    this.count = n;
    // Close together toward the tops, where the solid surface is.
    this.levels = quality === 'low' ? [0.9] : Array.from({ length: n }, (_, i) => 1 - 0.97 * (1 - (i + 0.8) / n) ** 2);
    const base = new THREE.PlaneGeometry(2, 2);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.instanceCount = n;
    this.order = new Float32Array(this.levels);
    this.iK = new THREE.InstancedBufferAttribute(this.order, 1);
    geo.setAttribute('iK', this.iK);
    this.uniforms = {
      uMacro: { value: this.field.macroTex },
      uDetail: { value: this.field.detailTex },
      uSpan: { value: new THREE.Vector4(1100, DECK_TOP_M, REACH, TAU[quality] || TAU.high) },
      uCentre: { value: new THREE.Vector2() },
      uShape: { value: new THREE.Vector2(0.5, 0.3) },
      uStep: { value: quality === 'low' ? 0.09 : 2.4 / n / (TAU[quality] || TAU.high) },
      uLit: { value: new THREE.Color(0xffffff) },
      uDim: { value: new THREE.Color(0x8d97a6) },
      uFogColor: { value: new THREE.Color(0xbcd7f2) },
      uFogD: { value: 0.00004 },
      uVeil: { value: 0 },
      uNear: { value: new THREE.Vector2(80, 500) },
      uSun: { value: new THREE.Vector3(30, 30, 3) },
    };
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      defines: quality === 'low' ? {} : quality === 'medium' ? { DECK_FINE: '' } : { DECK_FINE: '', DECK_RELIEF: '' },
      vertexShader: sheetVert,
      fragmentShader: sheetFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4.5;
    this.mesh.visible = false;
    this.mesh.name = 'cloud-deck';
    group.add(this.mesh);
    this._above = -1;

    // The sprites: soft, always facing you, they are what stands up at your own level, where sheets are edge-on.
    const count = SPRITES[quality] || SPRITES.high;
    const defines = quality === 'low' ? { CLOUD_LITE: '' } : quality === 'medium' ? {} : { CLOUD_IMPOSTOR: '' };
    this.batches = count ? [1, 2].map((seed) => new PuffBatch(cloudTexture(seed), Math.ceil(count / 2), defines)) : [];
    for (const b of this.batches) {
      b.mesh.name = 'cloud-deck-sprites';
      // Under the sheets in the draw: a sprite behind solid cloud is hidden, never a grey disc on top of it.
      b.mesh.renderOrder = 4.4;
      group.add(b.mesh);
    }
    const rnd = makeRandom(5150);
    this.sprites = [];
    for (let i = 0; i < count; i++) {
      this.sprites.push({
        batch: i % 2,
        index: i >> 1,
        x: rnd() * SPRITE_RANGE * 2,
        z: rnd() * SPRITE_RANGE * 2,
        q: Math.pow(rnd(), 0.6),
        size: 800 + rnd() * rnd() * 1500,
        rot: rnd() * Math.PI * 2,
      });
    }
  }

  /** The next update takes the weather as it is, with no easing: a new flight. */
  snap() {
    this._snap = true;
  }

  /** k at a height. */
  kAt(y) {
    return (y - this.base) / (DECK_TOP_M - this.base);
  }

  /** The big field at world (x, z), 0..1. */
  macroAt(x, z) {
    return bilinear(this.field.macro, MACRO_N, FIELD_SIZE, x - this.ox, z - this.oz);
  }

  /** The billows at world (x, z), 0..1. */
  billowAt(x, z) {
    return bilinear(this.field.detail, DETAIL_N, DETAIL_SIZE, x - this.ox, z - this.oz);
  }

  /** The layer's density at a point of the world, 0..1. */
  densityAt(x, z, y, out = null) {
    return deckShape(this.macroAt(x, z), this.billowAt(x, z), this.kAt(y), this.deck, this.foot, out);
  }

  /** 1 where the tops stand over (x, z), 0 in a gap: what the ordinary clouds are allowed. */
  gapMask(x, z) {
    const v = this.macroAt(x, z) + (this.billowAt(x, z) - 0.5) * DETAIL_AMP;
    return sstep(1 - this.deck, 1 - this.deck + 0.06, v);
  }

  /** How much of the sun the layer takes from the ground at (x, z), 0..1: the same field, down the sun's slant. */
  shadeAt(x, z) {
    const y = (this.base + DECK_TOP_M) / 2;
    const v = this.macroAt(x - this.slantX * y, z - this.slantZ * y);
    return sstep(1 - this.deck, 1 - this.deck + 0.1, v) * 0.85;
  }

  /** The white-out's own number at the eye, before it is smoothed. */
  immersionAt(x, z, y) {
    const rho = this.densityAt(x, z, y);
    return rho * sstep(this.base - 20, this.base + 80, y);
  }

  update(dt, weather, cam, clouds, p) {
    const c = weather.cond;
    const wasSnap = this._snap;
    const wantDeck = clamp(c.deck != null ? c.deck : c.cloud, 0, 0.97);
    const wantBase = Math.min(DECK_TOP_M - 500, c.cloudBase || 1100);
    const wantFoot = clamp(0.3 + 0.55 * (c.stratus || 0), 0, 1);
    if (this._snap || dt <= 0) {
      this.deck = wantDeck;
      this.base = wantBase;
      this.foot = wantFoot;
    } else {
      const s = COVER_RATE * dt;
      this.deck += clamp(wantDeck - this.deck, -s, s);
      this.foot += clamp(wantFoot - this.foot, -s, s);
      this.base += clamp(wantBase - this.base, -s * 800, s * 800);
    }

    const secs = this.now() / 1000;
    this.ox = (DRIFT.x * secs) % FIELD_SIZE;
    this.oz = (DRIFT.z * secs) % FIELD_SIZE;
    weather.sunDirection(_sun);
    const slant = 1 / Math.max(0.2, _sun.y);
    this.slantX = -_sun.x * slant;
    this.slantZ = -_sun.z * slant;

    // The eye.
    const target = this.immersionAt(cam.x, cam.z, cam.y);
    if (this._snap || dt <= 0) this.immersion = target;
    else this.immersion += (target - this.immersion) * (1 - Math.exp(-dt / IMMERSION_S));
    this._snap = false;
    if (this.immersion < 1e-4) this.immersion = 0;

    const u = this.uniforms;
    // The light: the sun's colour on the tops, or a moonlit grey by its phase.
    const b0 = clouds.batches[0].material.uniforms;
    const fog = clouds.viewFog;
    const day = p.daylight != null ? p.daylight : weather.isNight ? 0 : 1;
    const dark = weather.isNight ? 1 : 0;
    const moon = 0.1 + 0.16 * (weather.moonPhase != null ? weather.moonPhase : 0.5);
    const lightK = moon + (1 - moon) * sstep(0, 0.35, day);
    u.uLit.value.copy(p.sun).lerp(_white, 0.45 + 0.35 * sstep(5, 30, p.sunElev)).multiplyScalar(0.9 * lightK);
    u.uDim.value.copy(p.horizon).lerp(dark ? _nightGrey : _grey, 0.6).lerp(_rainGrey, dark ? 0 : clamp((c.rain || 0) * 0.5 + (c.storm || 0) * 0.3 + (this.deck - 0.8), 0, 0.8));
    if (weather.time === 'sunset') u.uDim.value.lerp(p.sun, 0.14);
    u.uSpan.value.x = this.base;
    u.uShape.value.set(this.deck, this.foot);
    const toSun = Math.hypot(_sun.x, _sun.z) || 1;
    u.uSun.value.set((_sun.x / toSun) * 70, (_sun.z / toSun) * 70, 1.5 + 3 * (1 - clamp(_sun.y, 0, 1)));
    // What the ordinary clouds do as the eye climbs past them: see clouds.js.
    const over = sstep(DECK_TOP_M - 500, DECK_TOP_M, cam.y);
    this.puffFade = 1 - sstep(this.base + 100, this.base + 900, cam.y);
    this.towerCut = Math.min(DECK_TOP_M, Math.max(this.base, cam.y - 300));
    // Fog: the sky's, thickened by the eye's own white-out; the sheets go to it long before their edge.
    const im = this.immersion;
    const fogCol = fog ? fog.color : p.fogColor;
    const fogD = fog ? fog.density : p.fogDensity;
    u.uFogColor.value.copy(fogCol).lerp(cloudWhiteout(day), im * 0.85);
    u.uFogD.value = Math.max(fogD, 0.00004) + im * 0.0045;
    for (const b of this.batches) {
      const v = b.material.uniforms;
      v.uSunTint.value.copy(b0.uSunTint.value).multiplyScalar(lightK);
      v.uBaseTint.value.copy(b0.uBaseTint.value).lerp(u.uLit.value, over);
      v.uSunDir.value.copy(b0.uSunDir.value);
      v.uSunUp.value = b0.uSunUp.value;
      v.uVeil.value = b0.uVeil.value;
      this._fogPuffs(v, fogD);
    }
    for (const b of clouds.batches) {
      // The moon lights the ordinary clouds no brighter than the tops.
      b.material.uniforms.uSunTint.value.multiplyScalar(lightK);
      this._fogPuffs(b.material.uniforms, fogD);
    }

    u.uVeil.value = b0.uVeil.value;
    const show = this.deck > 0.01;
    this.mesh.visible = show;
    if (show) {
      // The drawn middle follows the eye; the field does not.
      this.mesh.position.set(cam.x, 0, cam.z);
      u.uCentre.value.set(((cam.x - this.ox) % FIELD_SIZE + FIELD_SIZE) % FIELD_SIZE, ((cam.z - this.oz) % FIELD_SIZE + FIELD_SIZE) % FIELD_SIZE);
      this._sort(cam.y);
    }
    // They stand still in the world, so Low can move them a few times a second.
    if (this._tick++ % (this.quality === 'low' ? 6 : 2) === 0 || wasSnap) this._sprites(cam, show);
  }

  _fogPuffs(v, fogD) {
    v.uFogColor.value.copy(this.uniforms.uFogColor.value);
    v.uFogDensity.value = fogD + this.immersion * 0.0045;
  }

  /** Far to near: over the eye from the top down, under it from the bottom up. */
  _sort(eye) {
    const L = this.levels;
    const ek = this.kAt(eye);
    let above = 0;
    for (let i = 0; i < L.length; i++) if (L[i] > ek) above++;
    if (above === this._above) return;
    this._above = above;
    let j = 0;
    for (let i = L.length - 1; i >= L.length - above; i--) this.order[j++] = L[i];
    for (let i = 0; i < L.length - above; i++) this.order[j++] = L[i];
    this.iK.needsUpdate = true;
  }

  _sprites(cam, show) {
    const R = SPRITE_RANGE;
    const span = R * 2;
    const baseY = this.base;
    const H = DECK_TOP_M - baseY;
    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      const b = this.batches[s.batch];
      const j = s.index;
      let alpha = 0;
      let dx = 0;
      let dz = 0;
      if (show) {
        dx = (((s.x + this.ox - cam.x + R) % span) + span) % span - R;
        dz = (((s.z + this.oz - cam.z + R) % span) + span) % span - R;
        const x = cam.x + dx;
        const z = cam.z + dz;
        const m = this.macroAt(x, z);
        const bl = this.billowAt(x, z);
        deckShape(m, bl, 0.9, this.deck, this.foot, _shape);
        const k = 0.15 + (Math.max(0.2, _shape.top) - 0.2) * s.q;
        const rho = deckShape(m, bl, k, this.deck, this.foot, _shape);
        const edge = 1 - sstep(R * 0.78, R * 0.98, Math.max(Math.abs(dx), Math.abs(dz)));
        alpha = clamp(rho * 1.3, 0, 0.8) * edge;
        if (alpha > 0.01) {
          const sy = s.size * 0.55;
          const o = j * 3;
          b.offsets[o] = x;
          b.offsets[o + 1] = Math.min(baseY + H * k, DECK_TOP_M - sy * 0.34);
          b.offsets[o + 2] = z;
          b.scales[j * 2] = s.size;
          b.scales[j * 2 + 1] = sy;
          b.rots[j] = s.rot;
          b.shades[j] = k;
          b.kinds[j * 2] = -1e5;
          b.kinds[j * 2 + 1] = 0;
        }
      }
      if (alpha <= 0.01) {
        alpha = 0;
        b.scales[j * 2] = 0;
        b.scales[j * 2 + 1] = 0;
      }
      b.alphas[j] = alpha;
    }
    for (const b of this.batches) b.markDirty();
  }
}

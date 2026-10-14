/**
 * The fun pack's picture: the smoke trail, which turns into a cloud and
 * wears off. One draw call, one pooled buffer, nothing allocated per frame.
 *
 * Every puff starts tight behind the aeroplane. Over its life (a minute or
 * so) it grows three to six times, softens, spreads a little and drifts with
 * the game's own wind; neighbouring puffs overlap into one lingering ribbon,
 * the way an airshow's smoke does, so a loop you flew stays in the sky as a
 * loop for a while. Then it thins away. It is lit like the clouds (the sun
 * on its top, the sky on its underside, dim at night) and fogs with
 * distance like everything else.
 *
 * It is all drawn with smooth alpha. No dithering, no hashed transparency,
 * and a puff too small to see or too big to draw fades out smoothly instead
 * of popping, so the flicker probe has nothing to find.
 */

import * as THREE from '../../vendor/three.module.js';
import { cloudTexture } from '../../render/textures.js';

const FOG_VERT = /* glsl */ `
  uniform float fogDensity;
  varying float vFog;
`;
const FOG_CALC = /* glsl */ `
  { float fd = -mv.z; vFog = 1.0 - exp(-fogDensity * fogDensity * fd * fd); }
`;
const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

/* ================================================================== *
 * The numbers (the shader below is written from these, so they cannot
 * drift apart from the node checks that read them)
 * ================================================================== */

export const SMOKE = {
  /** Puffs in the pool. A full tank at the highest rate is about 900; this holds a minute and a half of smoking and refilling. */
  pool: 2400,
  /** A puff lasts this long (seconds); each one a little differently, so the end is a thinning and not an edge. */
  lifeMin: 60,
  lifeMax: 84,
  /** Metres across at the tail. */
  size0: 3.0,
  /** How many times bigger than that it ends up. */
  growMin: 3,
  growMax: 6,
  /** Seconds to fade in (the first moments behind the tail). */
  fadeIn: 0.8,
  /** The fraction of its life at which a puff starts to thin away. */
  thinFrom: 0.4,
  /** Puffs a second at most. */
  rate: 45,
  /** Metres between puffs when the aeroplane is moving; slower than that, fewer (a hovering helicopter does not pile up a ball). */
  spacing: 1.4,
  /** The share of the full rate that is always laid, even when hovering. */
  minRate: 0.3,
  /** Most puffs laid in one frame (a very slow frame must not dump a hundred). */
  burst: 12,
  /** How opaque one puff is, before the others stacked on it. */
  alpha: 0.27,
};

/** The longest any puff lasts, in seconds. */
export const SMOKE_LIFE = SMOKE.lifeMax;

const fract = (x) => x - Math.floor(x);
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;

/* The same three small functions as the vertex shader, for the node checks. */
export const puffLife = (seed) => mix(SMOKE.lifeMin, SMOKE.lifeMax, seed);
export const puffGrow = (seed) => mix(SMOKE.growMin, SMOKE.growMax, fract(seed * 13.713));
/** Size at `age` seconds as a multiple of the size at the tail: quick at first, slower as it spreads. */
export function puffScale(age, seed) {
  const k = Math.min(1, Math.max(0, age / puffLife(seed)));
  return 1 + (puffGrow(seed) - 1) * (1 - (1 - k) * (1 - k));
}
/** How much of itself a puff still has at `age`, 0..1: fades in, holds, thins away, gone at the end of its life. */
export function puffFade(age, seed) {
  const life = puffLife(seed);
  if (!(age >= 0) || age >= life) return 0;
  return smoothstep(0, SMOKE.fadeIn, age) * (1 - smoothstep(SMOKE.thinFrom, 1, age / life));
}

const glf = (x) => (Number.isInteger(x) ? x.toFixed(1) : String(x));

/* ================================================================== *
 * The smoke trail
 * ================================================================== */

export class SmokeTrail {
  constructor(max = SMOKE.pool) {
    this.max = max;
    this.next = 0;
    this.acc = 0;
    /** The most slots ever written (draw this many, not the whole pool). */
    this.hi = 0;
    this.last = new THREE.Vector3();
    this.prev = new THREE.Vector3();
    this.hasLast = false;
    /** The wind's push added up over time (metres); puffs are stored minus this, so they travel by it. */
    this.drift = new THREE.Vector3();
    this.t = null;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aBirth = new THREE.BufferAttribute(new Float32Array(max).fill(-1e6), 1).setUsage(THREE.DynamicDrawUsage);
    // rgb, and how thick this puff is laid (more when they are far apart).
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(max), 1);
    for (let i = 0; i < max; i++) this.aSeed.setX(i, Math.random());
    g.setAttribute('position', this.aPos);
    g.setAttribute('aBirth', this.aBirth);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aSeed', this.aSeed);
    g.setDrawRange(0, 0);
    const u = fogUniforms();
    u.uScale = { value: 400 };
    u.uTime = { value: 0 };
    u.uMaxPx = { value: 128 };
    u.uDrift = { value: this.drift };
    u.uSun = { value: new THREE.Vector3(1, 0.975, 0.93) };
    u.uAmb = { value: new THREE.Vector3(0.7, 0.76, 0.86) };
    u.uMap = { value: cloudTexture(2) };
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aBirth;
        attribute vec4 aCol;
        attribute float aSeed;
        uniform float uScale;
        uniform float uTime;
        uniform float uMaxPx;
        uniform vec3 uDrift;
        varying float vA;
        varying float vRot;
        varying float vK;
        varying vec3 vCol;
        ${FOG_VERT}
        void main() {
          float age = uTime - aBirth;
          float life = mix(${glf(SMOKE.lifeMin)}, ${glf(SMOKE.lifeMax)}, aSeed);
          vA = 0.0;
          vRot = 0.0;
          vK = 0.0;
          vCol = aCol.rgb;
          vFog = 0.0;
          if (age < 0.0 || age >= life) {
            // Not in the air: clipped away, not drawn as a speck.
            gl_Position = vec4(3.0, 3.0, 3.0, 1.0);
            gl_PointSize = 0.0;
            return;
          }
          float k = age / life;
          float s2 = fract(aSeed * 13.713);
          float s3 = fract(aSeed * 7.931 + 0.37);
          // Quick to open out, slower as it thins: 3 to 6 times its size at the tail.
          float grow = mix(${glf(SMOKE.growMin)}, ${glf(SMOKE.growMax)}, s2);
          float size = ${glf(SMOKE.size0)} * (1.0 + (grow - 1.0) * (1.0 - (1.0 - k) * (1.0 - k)));
          // It is carried by the wind, spreads sideways a little as it ages and rises a little at first.
          vec3 p = position + uDrift;
          float ang = aSeed * 6.2831;
          float spread = (3.0 + 5.0 * s3) * pow(k, 0.55);
          p.xz += vec2(cos(ang), sin(ang)) * spread;
          p.y += 4.5 * (1.0 - exp(-3.0 * k)) + (s3 - 0.5) * 3.0 * k;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float dist = -mv.z;
          float want = size * uScale / max(1.0, dist);
          float px = clamp(want, 2.0, uMaxPx);
          gl_PointSize = px;
          // Too small to see: fainter, in step with the area, so it fades out and does not sparkle.
          float small = min(1.0, want / px);
          // Too big for the card to draw as one point: fainter, so flying through it is not a white wall.
          float big = min(1.0, uMaxPx / want);
          float fin = smoothstep(0.0, ${glf(SMOKE.fadeIn)}, age);
          float fout = 1.0 - smoothstep(${glf(SMOKE.thinFrom)}, 1.0, k);
          // Thin right next to the lens, so the trail you are chasing never becomes a white wall across the screen.
          float nearFade = smoothstep(6.0, 40.0, dist);
          vA = ${glf(SMOKE.alpha)} * aCol.a * fin * fout * nearFade * small * small * big;
          vRot = aSeed * 37.0 + age * 0.03 * (s3 - 0.5);
          vK = k;
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uSun;
        uniform vec3 uAmb;
        uniform vec3 fogColor;
        varying float vA;
        varying float vRot;
        varying float vK;
        varying vec3 vCol;
        varying float vFog;
        void main() {
          vec2 q = gl_PointCoord - 0.5;
          float c = cos(vRot);
          float s = sin(vRot);
          vec2 r = vec2(c * q.x - s * q.y, s * q.x + c * q.y) + 0.5;
          // The cloud sprite's own soft, lumpy shape, turned a different way for every puff.
          float shape = texture2D(uMap, r).a * (1.0 - smoothstep(0.34, 0.5, length(q)));
          float a = shape * vA;
          if (a < 0.004) discard;
          // gl_PointCoord's y runs down the sprite: the top of the puff takes the sun, the underside the sky.
          float top = 1.0 - smoothstep(-0.3, 0.3, q.y);
          vec3 lit = mix(uAmb, uSun, top);
          // Old smoke thins its colour as well as its body.
          float grey = dot(vCol, vec3(0.3, 0.59, 0.11));
          vec3 base = mix(vCol, vec3(grey), 0.3 * vK);
          vec3 col = mix(base * lit, fogColor, vFog);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 7;
    this.geo = g;
    this.dirty = false;
    /**
     * True until the card has been sent the whole pool (see mark()): at the
     * start, after a clear(), and after any stretch in which nothing drew.
     * Drawing is what ends it, and the renderer tells us when it draws.
     */
    this.full = true;
    this.points.onBeforeRender = () => {
      this.full = false;
    };
  }

  /**
   * Puff from `at` (a Vector3) in colour rgb [r, g, b], time `time`. Puffs
   * are laid along the line from the last emission point, so a fast jet
   * leaves a line, not a string of beads; slower flight lays them closer
   * together, up to the rate limit, and a hover lays few.
   */
  emit(dt, time, at, rgb) {
    if (!this.hasLast) {
      this.last.copy(at);
      this.prev.copy(at);
      this.hasLast = true;
    }
    const step = this.prev.distanceTo(at);
    this.prev.copy(at);
    const byTime = dt * SMOKE.rate;
    this.acc += Math.min(byTime, Math.max(byTime * SMOKE.minRate, step / SMOKE.spacing));
    const n = Math.min(SMOKE.burst, Math.floor(this.acc));
    this.acc = Math.min(this.acc - n, 1.99);
    if (!n) return;
    // Puffs a long way apart are each laid thicker (and a pile of them thinner), so the ribbon is as dense at 250 m/s as at 60.
    const gap = this.last.distanceTo(at) / n;
    const thick = Math.min(3, Math.max(0.4, gap / SMOKE.spacing));
    const start = this.next;
    const dx = this.drift.x;
    const dy = this.drift.y;
    const dz = this.drift.z;
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.aPos.setXYZ(
        i,
        this.last.x + (at.x - this.last.x) * f - dx,
        this.last.y + (at.y - this.last.y) * f - dy,
        this.last.z + (at.z - this.last.z) * f - dz
      );
      this.aBirth.setX(i, time - dt * (1 - f));
      this.aCol.setXYZW(i, rgb[0], rgb[1], rgb[2], thick);
    }
    this.last.copy(at);
    this.mark(start, n);
  }

  /**
   * Remember which slots changed, so only those go to the card. If nothing
   * has been drawing (a paused page, a hidden tab, a stubbed renderer) the
   * ranges would pile up, and sending only the last few of them would leave
   * the card without the rest of the cloud: so past 48 ranges the whole pool
   * is owed instead, and stays owed until a frame really draws it.
   */
  mark(start, n) {
    if (!this.full) {
      const first = Math.min(n, this.max - start);
      this.aPos.addUpdateRange(start * 3, first * 3);
      this.aBirth.addUpdateRange(start, first);
      this.aCol.addUpdateRange(start * 4, first * 4);
      if (n > first) {
        this.aPos.addUpdateRange(0, (n - first) * 3);
        this.aBirth.addUpdateRange(0, n - first);
        this.aCol.addUpdateRange(0, (n - first) * 4);
      }
      if (this.aPos.updateRanges.length > 48) this.full = true;
    }
    this.hi = Math.max(this.hi, start + n > this.max ? this.max : start + n);
    this.dirty = true;
  }

  /** Stop emitting; what is out there fades by itself. */
  cut() {
    this.hasLast = false;
    this.acc = 0;
  }

  clear() {
    this.cut();
    this.aBirth.array.fill(-1e6);
    this.next = 0;
    this.hi = 0;
    this.drift.set(0, 0, 0);
    this.t = null;
    this.geo.setDrawRange(0, 0);
    // The whole birth buffer goes to the card at the next draw, not just
    // the slots written after this (see mark() and update()).
    this.full = true;
    this.dirty = true;
  }

  /**
   * Once a frame. `light` is { sun: [r,g,b], amb: [r,g,b] } (smokeLight()),
   * `wind` anything with x and z in metres a second (the weather's wind
   * vector). The wind's push is added up here, once, so a puff already in
   * the air keeps its course if the wind changes.
   */
  update(time, pixelScale, light, wind) {
    const u = this.mat.uniforms;
    if (this.t !== null && wind) {
      const dt = Math.min(0.25, Math.max(0, time - this.t));
      this.drift.x += (wind.x || 0) * dt;
      this.drift.z += (wind.z || 0) * dt;
    }
    this.t = time;
    u.uTime.value = time;
    u.uScale.value = pixelScale;
    if (light) {
      u.uSun.value.set(light.sun[0], light.sun[1], light.sun[2]);
      u.uAmb.value.set(light.amb[0], light.amb[1], light.amb[2]);
    }
    if (this.full) {
      // Owed the whole pool: no partial ranges, and sent again until it draws.
      this.aPos.clearUpdateRanges();
      this.aBirth.clearUpdateRanges();
      this.aCol.clearUpdateRanges();
      this.dirty = true;
    }
    if (this.dirty) {
      this.aPos.needsUpdate = true;
      this.aBirth.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.geo.setDrawRange(0, this.hi);
      this.dirty = false;
    }
  }

  /** The biggest point the graphics card will draw (it is told once, by the caller). */
  setMaxPointPx(px) {
    if (px > 8) this.mat.uniforms.uMaxPx.value = Math.min(160, px);
  }

  /** How many puffs are still in the air at `time` (for the tests). */
  liveCount(time) {
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const age = time - this.aBirth.getX(i);
      if (age >= 0 && age < puffLife(this.aSeed.getX(i))) n++;
    }
    return n;
  }

  /**
   * How much smoke there is to see at `time` (for the tests): the puffs'
   * fade-ins and thinnings added up, so it is 0 when everything is gone and
   * falls smoothly as the cloud wears off.
   */
  body(time) {
    let sum = 0;
    for (let i = 0; i < this.max; i++) {
      const age = time - this.aBirth.getX(i);
      if (age >= 0) sum += puffFade(age, this.aSeed.getX(i));
    }
    return sum;
  }

  dispose() {
    // The cloud sprite is the clouds' own, shared; only what is ours goes.
    this.geo.dispose();
    this.mat.dispose();
  }
}

const _c = new THREE.Color();

/** Rainbow smoke: a colour that walks round the wheel (linear, for the shader). */
export function rainbowAt(t, out = [1, 1, 1]) {
  _c.setHSL((t * 0.35) % 1, 0.9, 0.58, THREE.SRGBColorSpace);
  out[0] = _c.r;
  out[1] = _c.g;
  out[2] = _c.b;
  return out;
}

/** A colour picked by eye (sRGB, 0..1) as the shader wants it (linear). */
export function linearRGB(rgb, out = [1, 1, 1]) {
  _c.setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
  out[0] = _c.r;
  out[1] = _c.g;
  out[2] = _c.b;
  return out;
}

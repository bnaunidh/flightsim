/**
 * Everything the fire looks like. Five systems, each ONE draw call however
 * big the fire gets:
 *
 *   Flames   instanced vertical quads, one per burning cell, turned to face
 *            the camera about the vertical only (so they stand up however
 *            you look at them) and licked upwards by scrolling noise.
 *   Plumes   instanced camera-facing puffs — smoke columns, steam and spray
 *            are all this one system with a tint per puff.
 *   Sparks   GL points: embers going up, water droplets coming down.
 *   Scar     the burnt ground, drawn on a copy of the terrain's own triangles
 *            so it lies exactly on what is drawn (see surface.js), coloured
 *            from a data texture with one texel per fire cell: how charred,
 *            how hard it is burning (the glow you see at night), how wet.
 *   Marker   a ring or a stretched lane laid on the ground or the sea — where
 *            your water will land, and where to fill up.
 *
 * Nothing here allocates in the frame loop. Every buffer is sized once from
 * the quality setting and the counts are what change.
 */

import * as THREE from '../../vendor/three.module.js';
import { noiseTexture, puffTexture } from './textures.js';
import { WET_SECONDS } from './grid.js';

const FOG_VERT = /* glsl */ `
  uniform float fogDensity;
  varying float vFog;
`;
const FOG_CALC = /* glsl */ `
  { float fd = -mv.z; vFog = 1.0 - exp(-fogDensity * fogDensity * fd * fd); }
`;

function fogUniforms() {
  return THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
}

/* ================================================================== *
 * Flames
 * ================================================================== */

export class Flames {
  constructor(max) {
    this.max = max;
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iSize', this.aSize);
    g.setAttribute('iData', this.aData);
    g.instanceCount = 0;
    const u = fogUniforms();
    u.uTime = { value: 0 };
    u.uNoise = { value: noiseTexture() };
    u.uWind = { value: new THREE.Vector3() };
    u.uBright = { value: 1 };
    u.uOpaque = { value: 0.85 };
    /*
     * Premultiplied alpha, so one material is both kinds of fire. The colour
     * is always added; `uOpaque` says how much of what is behind it the flame
     * hides. By day it hides most of it — a purely additive flame over sunlit
     * grass sums to white, and the first version of this was a field of white
     * candles. At night it hides little and mostly adds: light.
     */
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: /* glsl */ `
        attribute vec3 iPos;
        attribute vec2 iSize;
        attribute vec2 iData;
        uniform float uTime;
        uniform vec3 uWind;
        varying vec2 vUv;
        varying float vHeat;
        varying float vPhase;
        ${FOG_VERT}
        void main() {
          vUv = uv;
          vHeat = iData.y;
          vPhase = iData.x;
          vec3 cr = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 right = normalize(vec3(cr.x, 0.0, cr.z) + vec3(1e-4, 0.0, 0.0));
          float flick = 1.0 + 0.16 * sin(uTime * 7.3 + iData.x * 40.0) + 0.09 * sin(uTime * 12.7 + iData.x * 17.0);
          float h = iSize.y * (0.3 + 0.7 * iData.y) * flick;
          float w = iSize.x * (0.55 + 0.45 * iData.y);
          vec3 wp = iPos + right * (position.x * w);
          wp.y += position.y * h;
          wp.xz += uWind.xz * (position.y * position.y) * h * 0.03;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          ${FOG_CALC}
        }
      `,
      /*
       * The colours are LINEAR and chosen for what they become on screen:
       * (1.0, 0.2, 0.01) is sRGB orange, (1.0, 0.6, 0.12) a hot yellow. The
       * first palette was picked by eye in linear terms and came out cream.
       * No tone mapping — a flame is a light, not a lit surface, and ACES
       * drains exactly the saturation that makes it read as fire.
       */
      fragmentShader: /* glsl */ `
        uniform sampler2D uNoise;
        uniform float uTime;
        uniform float uBright;
        uniform float uOpaque;
        varying vec2 vUv;
        varying float vHeat;
        varying float vPhase;
        varying float vFog;
        void main() {
          float x = (vUv.x - 0.5) * 2.0;
          float y = vUv.y;
          float n1 = texture2D(uNoise, vec2(vUv.x * 1.1 + vPhase, y * 0.75 - uTime * 1.05 + vPhase)).r;
          float n2 = texture2D(uNoise, vec2(vUv.x * 2.6 - vPhase * 1.3, y * 1.5 - uTime * 2.2)).r;
          float n = n1 * 0.6 + n2 * 0.4;
          // A few tongues across the width, licking up at different heights.
          float tongues = 0.72 + 0.28 * cos(x * 7.0 + vPhase * 20.0 + n1 * 4.0);
          float width = mix(1.0, 0.12, pow(y, 0.85));
          float body = 1.0 - abs(x) / width;
          float f = body * (1.12 - y) * tongues + (n - 0.5) * 1.2 * (0.25 + y);
          f = smoothstep(0.04, 0.5, f) * smoothstep(0.0, 0.06, y);
          if (f < 0.02) discard;
          float t = clamp(f * (1.2 - y * 0.8), 0.0, 1.0);
          vec3 col = mix(vec3(0.5, 0.025, 0.0), vec3(1.0, 0.2, 0.01), smoothstep(0.08, 0.45, t));
          col = mix(col, vec3(1.0, 0.6, 0.12), smoothstep(0.5, 0.9, t));
          col = mix(col, vec3(1.0, 0.86, 0.45), smoothstep(0.9, 1.0, t) * 0.6);
          float a = smoothstep(0.02, 0.3, f) * clamp(vHeat * 1.4, 0.0, 1.0) * (1.0 - vFog);
          vec3 c = linearToOutputTexel(vec4(col, 1.0)).rgb;
          gl_FragColor = vec4(c * a * uBright, a * uOpaque);
        }
      `,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.name = 'wildfire-flames';
    this.geo = g;
    this.count = 0;
  }

  begin() {
    this.count = 0;
  }

  push(x, y, z, w, h, phase, heat) {
    if (this.count >= this.max) return;
    const k = this.count++;
    const p = this.aPos.array;
    p[k * 3] = x;
    p[k * 3 + 1] = y;
    p[k * 3 + 2] = z;
    const s = this.aSize.array;
    s[k * 2] = w;
    s[k * 2 + 1] = h;
    const d = this.aData.array;
    d[k * 2] = phase;
    d[k * 2 + 1] = heat;
  }

  end() {
    const n = this.count;
    this.geo.instanceCount = n;
    for (const a of [this.aPos, this.aSize, this.aData]) {
      a.clearUpdateRanges();
      if (n) {
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }
}

/* ================================================================== *
 * Plumes — smoke, steam, spray
 * ================================================================== */

export class Plumes {
  constructor(max) {
    this.max = max;
    // CPU state per puff.
    this.px = new Float32Array(max);
    this.py = new Float32Array(max);
    this.pz = new Float32Array(max);
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.size = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.peak = new Float32Array(max);
    this.tint = new Float32Array(max);
    this.warm = new Float32Array(max);
    this.rot = new Float32Array(max);
    this.spin = new Float32Array(max);
    this.alive = 0;
    // Draw order, back to front, kept between frames so the sort is nearly free.
    this.order = new Int32Array(max);
    this.dist = new Float32Array(max);

    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aA = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this.aAge = new THREE.InstancedBufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos);
    g.setAttribute('iA', this.aA);
    g.setAttribute('iAge', this.aAge);
    g.instanceCount = 0;
    const u = fogUniforms();
    u.uPuff = { value: puffTexture() };
    u.uSmoke = { value: new THREE.Color(0.3, 0.27, 0.245) };
    u.uSteam = { value: new THREE.Color(0.93, 0.95, 0.97) };
    u.uGlow = { value: new THREE.Color(0, 0, 0) };
    /*
     * NEAR FADE. A column puff is up to 250 m across, so flying through the
     * smoke puts dozens of them over the whole screen at once — dozens of
     * full-screen blends, which is the one thing a Chromebook's GPU cannot
     * afford. A puff fades out as the camera gets inside it and, once
     * invisible, its quad is thrown outside the clip volume so the GPU never
     * shades a pixel of it. What you see in there instead is the fog, which
     * wildfire.js thickens by how much smoke you are in: one full-screen
     * effect the scene was paying for anyway.
     */
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute vec4 iPos;
        attribute vec4 iA;
        attribute float iAge;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vTint;
        varying float vWarm;
        varying float vShade;
        varying float vAge;
        ${FOG_VERT}
        void main() {
          vec3 R = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
          vec3 U = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
          float c = cos(iA.y);
          float s = sin(iA.y);
          vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iA.x;
          vec3 wp = iPos.xyz + R * p.x + U * p.y;
          vUv = uv;
          float centre = length((viewMatrix * vec4(iPos.xyz, 1.0)).xyz);
          vAlpha = iA.z * smoothstep(iA.x * 0.18, iA.x * 0.7, centre);
          vTint = iA.w;
          vWarm = iPos.w;
          vShade = position.y + 0.5;
          vAge = iAge;
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          gl_Position = projectionMatrix * mv;
          if (vAlpha < 0.004) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uPuff;
        uniform vec3 uSmoke;
        uniform vec3 uSteam;
        uniform vec3 uGlow;
        uniform vec3 fogColor;
        varying vec2 vUv;
        varying float vAlpha;
        varying float vTint;
        varying float vWarm;
        varying float vShade;
        varying float vAge;
        varying float vFog;
        void main() {
          float a = texture2D(uPuff, vUv).a * vAlpha;
          if (a < 0.004) discard;
          // Dark and brown where it leaves the fire, paler as it spreads out.
          vec3 smoke = uSmoke * mix(0.55, 1.35, smoothstep(0.0, 0.6, vAge));
          vec3 col = mix(smoke, uSteam, vTint);
          col *= mix(0.72, 1.12, vShade);
          col += uGlow * vWarm * (1.2 - vShade);
          col = mix(col, fogColor, vFog * 0.85);
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.name = 'wildfire-plumes';
    this.geo = g;
  }

  /**
   * One puff. tint 0 is smoke, 1 is steam; warm lights its underside at night.
   * Returns false when the budget is spent — the caller simply emits fewer.
   */
  emit(x, y, z, vx, vy, vz, size, grow, life, peak, tint = 0, warm = 0) {
    if (this.alive >= this.max) return false;
    const k = this.alive++;
    this.px[k] = x;
    this.py[k] = y;
    this.pz[k] = z;
    this.vx[k] = vx;
    this.vy[k] = vy;
    this.vz[k] = vz;
    this.size[k] = size;
    this.grow[k] = grow;
    this.age[k] = 0;
    this.life[k] = life;
    this.peak[k] = peak;
    this.tint[k] = tint;
    this.warm[k] = warm;
    this.rot[k] = Math.random() * 6.283;
    this.spin[k] = (Math.random() - 0.5) * 0.25;
    this.order[k] = k;
    return true;
  }

  _kill(k) {
    const last = --this.alive;
    if (k === last) return;
    this.px[k] = this.px[last];
    this.py[k] = this.py[last];
    this.pz[k] = this.pz[last];
    this.vx[k] = this.vx[last];
    this.vy[k] = this.vy[last];
    this.vz[k] = this.vz[last];
    this.size[k] = this.size[last];
    this.grow[k] = this.grow[last];
    this.age[k] = this.age[last];
    this.life[k] = this.life[last];
    this.peak[k] = this.peak[last];
    this.tint[k] = this.tint[last];
    this.warm[k] = this.warm[last];
    this.rot[k] = this.rot[last];
    this.spin[k] = this.spin[last];
  }

  /**
   * Move every puff and write the instance buffers, back to front.
   * wind is the air's velocity in m/s; puffs ride it more the higher they are.
   */
  update(dt, wind, cam) {
    for (let k = this.alive - 1; k >= 0; k--) {
      const age = this.age[k] + dt;
      if (age >= this.life[k]) {
        this._kill(k);
        continue;
      }
      this.age[k] = age;
      // Buoyant at first, then levelling out and riding the wind. The decay
      // sets how tall a column stands: at 5 % a second it topped out near
      // 400 m, a stub from ten kilometres; at 2.5 % it is 600 to 900.
      this.vy[k] *= 1 - dt * 0.025;
      const ride = Math.min(1, 0.45 + this.py[k] * 0.0012);
      this.vx[k] += (wind.x * ride - this.vx[k]) * Math.min(1, dt * 0.5);
      this.vz[k] += (wind.z * ride - this.vz[k]) * Math.min(1, dt * 0.5);
      this.px[k] += this.vx[k] * dt;
      this.py[k] += this.vy[k] * dt;
      this.pz[k] += this.vz[k] * dt;
      this.size[k] += this.grow[k] * dt;
      this.rot[k] += this.spin[k] * dt;
    }
    // Distances, then an insertion sort on last frame's order.
    const n = this.alive;
    const o = this.order;
    // Rebuild the order list if puffs were swapped in from the end.
    for (let i = 0; i < n; i++) o[i] = o[i] < n ? o[i] : i;
    const seen = this._seen || (this._seen = new Uint8Array(this.max));
    seen.fill(0, 0, n);
    let bad = false;
    for (let i = 0; i < n; i++) {
      if (seen[o[i]]) {
        bad = true;
        break;
      }
      seen[o[i]] = 1;
    }
    if (bad) for (let i = 0; i < n; i++) o[i] = i;
    for (let i = 0; i < n; i++) {
      const dx = this.px[i] - cam.x;
      const dy = this.py[i] - cam.y;
      const dz = this.pz[i] - cam.z;
      this.dist[i] = dx * dx + dy * dy + dz * dz;
    }
    for (let i = 1; i < n; i++) {
      const v = o[i];
      const dv = this.dist[v];
      let j = i - 1;
      while (j >= 0 && this.dist[o[j]] < dv) {
        o[j + 1] = o[j];
        j--;
      }
      o[j + 1] = v;
    }
    const P = this.aPos.array;
    const A = this.aA.array;
    const G = this.aAge.array;
    for (let i = 0; i < n; i++) {
      const k = o[i];
      const f = this.age[k] / this.life[k];
      // In fast, so the column starts at the flames rather than floating
      // above them; out slowly, so it thins into haze rather than vanishing.
      const fade = f < 0.04 ? f / 0.04 : f > 0.55 ? (1 - f) / 0.45 : 1;
      P[i * 4] = this.px[k];
      P[i * 4 + 1] = this.py[k];
      P[i * 4 + 2] = this.pz[k];
      // Firelight on the underside of the smoke, and only the low smoke: lit
      // all the way up, a night column was a tower of orange candyfloss.
      const low = f < 0.4 ? 1 - f / 0.4 : 0;
      P[i * 4 + 3] = this.warm[k] * low * low;
      A[i * 4] = this.size[k];
      A[i * 4 + 1] = this.rot[k];
      A[i * 4 + 2] = this.peak[k] * fade;
      A[i * 4 + 3] = this.tint[k];
      G[i] = f;
    }
    this.geo.instanceCount = n;
    for (const a of [this.aPos, this.aA, this.aAge]) {
      a.clearUpdateRanges();
      if (n) {
        a.addUpdateRange(0, n * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  /**
   * How much smoke a point is inside, 0..~1. Only smoke counts — steam and
   * spray are gone in seconds and never hide anything.
   */
  densityAt(x, y, z) {
    let d = 0;
    for (let k = 0; k < this.alive; k++) {
      if (this.tint[k] > 0.5) continue;
      const r = this.size[k] * 0.5;
      const dx = this.px[k] - x;
      const dy = this.py[k] - y;
      const dz = this.pz[k] - z;
      const q = (dx * dx + dy * dy + dz * dz) / (r * r);
      if (q < 1) {
        const f = this.age[k] / this.life[k];
        d += (1 - q) * this.peak[k] * (f > 0.6 ? (1 - f) / 0.4 : 1);
      }
    }
    return d;
  }

  clear() {
    this.alive = 0;
    this.geo.instanceCount = 0;
  }
}

/* ================================================================== *
 * Sparks — embers (additive) and droplets (alpha)
 * ================================================================== */

export class Sparks {
  constructor(max, { additive = true, color = 0xff9a3a, size = 1.6, gravity = -1.5, drag = 0.4 } = {}) {
    this.max = max;
    this.gravity = gravity;
    this.drag = drag;
    this.vx = new Float32Array(max);
    this.vy = new Float32Array(max);
    this.vz = new Float32Array(max);
    this.age = new Float32Array(max);
    this.life = new Float32Array(max);
    this.alive = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aHeat = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aHeat', this.aHeat);
    g.setDrawRange(0, 0);
    const u = fogUniforms();
    u.uColor = { value: new THREE.Color(color) };
    u.uSize = { value: size };
    u.uScale = { value: 400 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */ `
        attribute float aHeat;
        uniform float uSize;
        uniform float uScale;
        varying float vHeat;
        ${FOG_VERT}
        void main() {
          vHeat = aHeat;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = clamp(uSize * uScale / max(1.0, -mv.z), 1.0, 14.0) * (0.45 + 0.55 * aHeat);
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 fogColor;
        varying float vHeat;
        varying float vFog;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float a = smoothstep(0.5, 0.1, d) * vHeat * (1.0 - vFog);
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
    this.geo = g;
  }

  emit(x, y, z, vx, vy, vz, life) {
    if (this.alive >= this.max) return false;
    const k = this.alive++;
    const p = this.aPos.array;
    p[k * 3] = x;
    p[k * 3 + 1] = y;
    p[k * 3 + 2] = z;
    this.vx[k] = vx;
    this.vy[k] = vy;
    this.vz[k] = vz;
    this.age[k] = 0;
    this.life[k] = life;
    return true;
  }

  /**
   * @param {function|null} floor  (x, z) -> ground height; a particle below it
   *   dies (and `onLand` hears about it, for splashes). Null for embers.
   */
  update(dt, wind, floor = null, onLand = null) {
    const p = this.aPos.array;
    const h = this.aHeat.array;
    const g = this.gravity;
    const dr = this.drag;
    for (let k = this.alive - 1; k >= 0; k--) {
      const age = this.age[k] + dt;
      let dead = age >= this.life[k];
      if (!dead) {
        this.age[k] = age;
        this.vx[k] += (wind.x - this.vx[k]) * dr * dt;
        this.vz[k] += (wind.z - this.vz[k]) * dr * dt;
        this.vy[k] += g * dt - this.vy[k] * dr * 0.5 * dt;
        p[k * 3] += this.vx[k] * dt;
        p[k * 3 + 1] += this.vy[k] * dt;
        p[k * 3 + 2] += this.vz[k] * dt;
        if (floor) {
          const fy = floor(p[k * 3], p[k * 3 + 2]);
          if (p[k * 3 + 1] <= fy) {
            dead = true;
            if (onLand) onLand(p[k * 3], fy, p[k * 3 + 2]);
          }
        }
      }
      if (dead) {
        const last = --this.alive;
        if (k !== last) {
          p[k * 3] = p[last * 3];
          p[k * 3 + 1] = p[last * 3 + 1];
          p[k * 3 + 2] = p[last * 3 + 2];
          this.vx[k] = this.vx[last];
          this.vy[k] = this.vy[last];
          this.vz[k] = this.vz[last];
          this.age[k] = this.age[last];
          this.life[k] = this.life[last];
        }
        continue;
      }
    }
    for (let k = 0; k < this.alive; k++) {
      const f = this.age[k] / this.life[k];
      h[k] = f < 0.1 ? f / 0.1 : 1 - f * f;
    }
    this.geo.setDrawRange(0, this.alive);
    for (const a of [this.aPos, this.aHeat]) {
      a.clearUpdateRanges();
      if (this.alive) {
        a.addUpdateRange(0, this.alive * a.itemSize);
        a.needsUpdate = true;
      }
    }
  }

  clear() {
    this.alive = 0;
    this.geo.setDrawRange(0, 0);
  }
}

/* ================================================================== *
 * Scar — the burnt ground
 * ================================================================== */

export class Scar {
  /**
   * @param {FireGrid} grid
   * @param {object} chunk  one entry of Surface.chunks — the terrain drawn here
   */
  constructor(grid, chunk) {
    this.grid = grid;
    const size = grid.size;
    this.data = new Uint8Array(size * size * 4);
    this.tex = new THREE.DataTexture(this.data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.colorSpace = THREE.NoColorSpace;
    this.tex.needsUpdate = true;

    // The terrain vertices that fall inside the window, one ring wider.
    const c = chunk;
    const ext = size * grid.cell;
    const ixA = Math.max(0, Math.floor((grid.x0 - c.x0) / c.step) - 1);
    const izA = Math.max(0, Math.floor((grid.z0 - c.z0) / c.step) - 1);
    const ixB = Math.min(c.seg, Math.ceil((grid.x0 + ext - c.x0) / c.step) + 1);
    const izB = Math.min(c.seg, Math.ceil((grid.z0 + ext - c.z0) / c.step) + 1);
    const W = Math.max(0, ixB - ixA + 1);
    const H = Math.max(0, izB - izA + 1);
    this.qW = Math.max(0, W - 1);
    this.qH = Math.max(0, H - 1);
    this.chunk = c;
    this.ixA = ixA;
    this.izA = izA;
    const pos = new Float32Array(W * H * 3);
    for (let j = 0; j < H; j++) {
      for (let i = 0; i < W; i++) {
        const src = ((izA + j) * c.w + (ixA + i)) * 3;
        const dst = (j * W + i) * 3;
        pos[dst] = c.arr[src] + c.cx;
        pos[dst + 1] = c.arr[src + 1];
        pos[dst + 2] = c.arr[src + 2] + c.cz;
      }
    }
    this.W = W;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.index = new Uint32Array(Math.max(6, this.qW * this.qH * 6));
    this.idxAttr = new THREE.BufferAttribute(this.index, 1).setUsage(THREE.DynamicDrawUsage);
    g.setIndex(this.idxAttr);
    g.setDrawRange(0, 0);
    this.used = new Uint8Array(Math.max(1, this.qW * this.qH));
    this.nIdx = 0;
    this.geo = g;

    const u = fogUniforms();
    u.uMap = { value: this.tex };
    u.uNoise = { value: noiseTexture() };
    u.uWin = { value: new THREE.Vector3(grid.x0, grid.z0, 1 / ext) };
    u.uLight = { value: 1 };
    u.uNight = { value: 0 };
    u.uTime = { value: 0 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -6,
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        ${FOG_VERT}
        void main() {
          vWorld = position;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform sampler2D uNoise;
        uniform vec3 uWin;
        uniform float uLight;
        uniform float uNight;
        uniform float uTime;
        uniform vec3 fogColor;
        varying vec3 vWorld;
        varying float vFog;
        void main() {
          vec2 uv = (vWorld.xz - uWin.xy) * uWin.z;
          if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
          vec4 t = texture2D(uMap, uv);
          float n = texture2D(uNoise, vWorld.xz * 0.011).r;
          float n2 = texture2D(uNoise, vWorld.xz * 0.043).r;
          float c = smoothstep(0.1, 0.62, t.r + (n - 0.5) * 0.32 + (n2 - 0.5) * 0.18);
          vec3 ash = mix(vec3(0.045, 0.04, 0.036), vec3(0.2, 0.185, 0.17), n2 * n2);
          vec3 col = ash * uLight;
          float a = c * 0.94;
          float wet = t.b * (1.0 - c);
          col = mix(col, vec3(0.05, 0.07, 0.08) * uLight, wet);
          a = max(a, wet * 0.32);
          float flick = 0.65 + 0.35 * sin(uTime * 5.0 + n * 40.0 + n2 * 17.0);
          float g = t.g * smoothstep(0.25, 0.75, n2 + t.g * 0.5);
          col += vec3(1.0, 0.3, 0.05) * g * flick * (0.7 + uNight * 2.2);
          a = max(a, g * 0.95);
          col = mix(col, fogColor, vFog);
          if (a < 0.01) discard;
          gl_FragColor = vec4(col, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'wildfire-scar';
  }

  /** Paint the texels the grid says changed, and draw the quads under them. */
  refresh(time) {
    const G = this.grid;
    if (!G.dirty) return false;
    const size = G.size;
    const d = this.data;
    const x0 = Math.max(0, G.dirtyMin.x - 1);
    const z0 = Math.max(0, G.dirtyMin.z - 1);
    const x1 = Math.min(size - 1, G.dirtyMax.x + 1);
    const z1 = Math.min(size - 1, G.dirtyMax.z + 1);
    // Burning cells change heat every tick without being marked, so their
    // texels are rewritten from the slot list as well.
    const writeCell = (i) => {
      const st = G.state[i];
      let r = 0;
      let gl = 0;
      if (st === 2) r = 255;
      else if (st === 3) r = 150;
      else if (st === 1) {
        const s = G.slotOf[i];
        const f = s >= 0 ? G.slotAge[s] / G.slotLife[s] : 0.5;
        r = Math.min(255, 40 + f * 215) | 0;
        gl = s >= 0 ? Math.min(255, G.slotHeat[s] * 255) | 0 : 128;
      }
      const w = G.wet[i] - G.time;
      const b = w > 0 ? Math.min(255, (w / WET_SECONDS) * 255) | 0 : 0;
      const k = i * 4;
      d[k] = r;
      d[k + 1] = gl;
      d[k + 2] = b;
      d[k + 3] = 255;
      if (r || gl || b) this._use(i);
    };
    if (x1 >= x0 && z1 >= z0) {
      for (let iz = z0; iz <= z1; iz++) {
        for (let ix = x0; ix <= x1; ix++) writeCell(iz * size + ix);
      }
    }
    for (let s = 0; s < G.burning; s++) writeCell(G.slotCell[s]);
    G.clearDirty();
    this.tex.needsUpdate = true;
    return true;
  }

  /** Add the terrain quads under cell i (and a margin) to the drawn set. */
  _use(i) {
    const G = this.grid;
    const c = this.chunk;
    const cx = G.cellX(i);
    const cz = G.cellZ(i);
    const m = G.cell;
    const qa = Math.floor((cx - m - c.x0) / c.step) - this.ixA;
    const qb = Math.floor((cx + m - c.x0) / c.step) - this.ixA;
    const ra = Math.floor((cz - m - c.z0) / c.step) - this.izA;
    const rb = Math.floor((cz + m - c.z0) / c.step) - this.izA;
    for (let r = Math.max(0, ra); r <= Math.min(this.qH - 1, rb); r++) {
      for (let q = Math.max(0, qa); q <= Math.min(this.qW - 1, qb); q++) {
        const u = r * this.qW + q;
        if (this.used[u]) continue;
        this.used[u] = 1;
        const W = this.W;
        const a = q + W * r;
        const b = q + W * (r + 1);
        const cc = q + 1 + W * (r + 1);
        const dd = q + 1 + W * r;
        const I = this.index;
        let n = this.nIdx;
        if (n + 6 > I.length) return;
        I[n++] = a;
        I[n++] = b;
        I[n++] = dd;
        I[n++] = b;
        I[n++] = cc;
        I[n++] = dd;
        const was = this.nIdx;
        this.nIdx = n;
        this.idxAttr.clearUpdateRanges();
        this.idxAttr.addUpdateRange(0, n);
        this.idxAttr.needsUpdate = true;
        this.geo.setDrawRange(0, n);
        void was;
      }
    }
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
    this.tex.dispose();
  }
}

/* ================================================================== *
 * Marker — a ring or a lane, laid on whatever is underneath
 * ================================================================== */

export class Marker {
  /**
   * A small grid that is re-draped every time it moves, and a shader that
   * draws a rounded outline on it: a circle when the lane has no length, a
   * stadium when it does.
   */
  constructor(color = 0x7dffb4, segU = 24, segV = 10) {
    this.segU = segU;
    this.segV = segV;
    const g = new THREE.PlaneGeometry(1, 1, segU, segV);
    g.rotateX(-Math.PI / 2);
    this.local = g.attributes.position.array.slice();
    this.geo = g;
    const u = fogUniforms();
    u.uColor = { value: new THREE.Color(color) };
    u.uDim = { value: new THREE.Vector3(10, 10, 0) }; // half length, radius, time
    u.uOpacity = { value: 0.8 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -8,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec2 aLocal;
        varying vec2 vLocal;
        ${FOG_VERT}
        void main() {
          vLocal = aLocal;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform vec3 uDim;
        uniform float uOpacity;
        varying vec2 vLocal;
        varying float vFog;
        void main() {
          // Distance to a segment along x of half-length uDim.x, minus radius.
          float px = max(abs(vLocal.x) - uDim.x, 0.0);
          float d = length(vec2(px, vLocal.y)) - uDim.y;
          float w = max(2.5, uDim.y * 0.12);
          float ring = 1.0 - smoothstep(0.0, w, abs(d));
          float fill = d < 0.0 ? 0.2 : 0.0;
          // Along a lane, chevrons flowing the way to fly it: skimmed low at
          // a grazing angle the outline alone is a hairline.
          if (uDim.x > 0.0 && d < 0.0) {
            float ch = fract((vLocal.x + abs(vLocal.y) * 0.7) / 45.0 - uDim.z * 0.6);
            fill = max(fill, (1.0 - smoothstep(0.0, 0.12, abs(ch - 0.1))) * 0.75);
          }
          float pulse = 0.75 + 0.25 * sin(uDim.z * 4.0 - length(vLocal) * 0.08);
          float a = max(ring * pulse, fill) * uOpacity * (1.0 - vFog * 0.8);
          if (a < 0.01) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }
      `,
    });
    const n = g.attributes.position.count;
    this.aLocal = new THREE.BufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aLocal', this.aLocal);
    g.attributes.position.setUsage(THREE.DynamicDrawUsage);
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
  }

  /**
   * Lay it out: centred on (x, z), `half` metres each way along `headingRad`
   * (compass: +sin, -cos), `radius` across, draped by `floor(x, z)` + lift.
   */
  place(x, z, headingRad, half, radius, floor, lift = 0.8) {
    const ax = Math.sin(headingRad);
    const az = -Math.cos(headingRad);
    const L = half + radius * 1.15;
    const R = radius * 1.15;
    const pos = this.geo.attributes.position.array;
    const loc = this.aLocal.array;
    const src = this.local;
    const n = this.geo.attributes.position.count;
    for (let k = 0; k < n; k++) {
      // Local plane: x in [-.5,.5] along the lane, z in [-.5,.5] across it.
      const u = src[k * 3] * 2 * L;
      const v = src[k * 3 + 2] * 2 * R;
      const wx = x + ax * u - az * v;
      const wz = z + az * u + ax * v;
      pos[k * 3] = wx;
      pos[k * 3 + 1] = floor(wx, wz) + lift;
      pos[k * 3 + 2] = wz;
      loc[k * 2] = u;
      loc[k * 2 + 1] = v;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.aLocal.needsUpdate = true;
    this.mat.uniforms.uDim.value.x = half;
    this.mat.uniforms.uDim.value.y = radius;
    this.mesh.visible = true;
  }

  hide() {
    this.mesh.visible = false;
  }
}

/* ================================================================== *
 * Break — the crews' dug line, drawn on the ground
 * ================================================================== */

/**
 * A strip of bare earth along a polyline, draped on the drawn ground, with a
 * bright edge either side so it reads from a thousand feet up. Line One is a
 * mission about a line; the map's fire block describes one and nothing drew
 * it, so the break the fire was stopping at was invisible grass.
 */
export class Break {
  /**
   * @param path   [{x, z}]
   * @param width  metres
   * @param floor  (x, z) -> drawn ground height
   */
  constructor(path, width, floor) {
    const pos = [];
    const uv = [];
    const idx = [];
    const half = width / 2;
    let along = 0;
    let n = 0;
    for (let k = 1; k < path.length; k++) {
      const a = path[k - 1];
      const b = path[k];
      const ex = b.x - a.x;
      const ez = b.z - a.z;
      const len = Math.hypot(ex, ez) || 1;
      const nx = -ez / len;
      const nz = ex / len;
      const steps = Math.max(1, Math.ceil(len / 12));
      for (let s = k === 1 ? 0 : 1; s <= steps; s++) {
        const t = s / steps;
        const x = a.x + ex * t;
        const z = a.z + ez * t;
        for (let side = -1; side <= 1; side += 2) {
          const px = x + nx * half * side;
          const pz = z + nz * half * side;
          pos.push(px, Math.max(floor(px, pz), floor(x, z)) + 0.35, pz);
          uv.push(side < 0 ? 0 : 1, (along + len * t) / width);
        }
        if (n > 0) {
          const i = n * 2;
          idx.push(i - 2, i - 1, i, i - 1, i + 1, i);
        }
        n++;
      }
      along += len;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    const u = fogUniforms();
    u.uLight = { value: 1 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -5,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        ${FOG_VERT}
        void main() {
          vUv = uv;
          vec4 mv = viewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        uniform vec3 fogColor;
        varying vec2 vUv;
        varying float vFog;
        void main() {
          float e = min(vUv.x, 1.0 - vUv.x);
          // Raked earth, with a hint of furrow along it.
          // Linear values: this is sRGB (0.35, 0.25, 0.16), dark earth. The
          // first pick was sRGB tan and the break read as a road.
          vec3 dirt = mix(vec3(0.09, 0.05, 0.025), vec3(0.14, 0.085, 0.045), 0.5 + 0.5 * sin(vUv.x * 40.0));
          // Crew tape along both edges, in dashes.
          float tape = step(e, 0.05) * step(0.4, fract(vUv.y * 0.5));
          vec3 col = mix(dirt * uLight, vec3(1.0, 0.8, 0.15), tape);
          col = mix(col, fogColor, vFog);
          gl_FragColor = vec4(col, 0.92);
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'wildfire-break';
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

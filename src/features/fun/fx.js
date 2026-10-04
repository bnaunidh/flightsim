/**
 * The fun pack's picture: the smoke trail. One draw call, nothing allocated
 * per frame.
 */

import * as THREE from '../../vendor/three.module.js';

const FOG_VERT = /* glsl */ `
  uniform float fogDensity;
  varying float vFog;
`;
const FOG_CALC = /* glsl */ `
  { float fd = -mv.z; vFog = 1.0 - exp(-fogDensity * fogDensity * fd * fd); }
`;
const fogUniforms = () => THREE.UniformsUtils.clone(THREE.UniformsLib.fog);

/* ================================================================== *
 * The smoke trail
 * ================================================================== */

export const SMOKE_LIFE = 7;
const SMOKE_RATE = 45;

export class SmokeTrail {
  constructor(max = 700) {
    this.max = max;
    this.next = 0;
    this.acc = 0;
    this.last = new THREE.Vector3();
    this.hasLast = false;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aBirth = new THREE.BufferAttribute(new Float32Array(max).fill(-1e6), 1).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aSeed = new THREE.BufferAttribute(new Float32Array(max), 1);
    for (let i = 0; i < max; i++) this.aSeed.setX(i, Math.random());
    g.setAttribute('position', this.aPos);
    g.setAttribute('aBirth', this.aBirth);
    g.setAttribute('aCol', this.aCol);
    g.setAttribute('aSeed', this.aSeed);
    const u = fogUniforms();
    u.uScale = { value: 400 };
    u.uTime = { value: 0 };
    u.uLife = { value: SMOKE_LIFE };
    u.uLight = { value: 1 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        attribute float aBirth;
        attribute vec3 aCol;
        attribute float aSeed;
        uniform float uScale;
        uniform float uTime;
        uniform float uLife;
        varying float vA;
        varying vec3 vCol;
        ${FOG_VERT}
        void main() {
          float age = uTime - aBirth;
          float k = clamp(age / uLife, 0.0, 1.0);
          vec3 p = position;
          // It spreads and drifts up a little as it ages.
          float ang = aSeed * 6.2831;
          p += vec3(cos(ang), 0.0, sin(ang)) * k * 3.0 + vec3(0.0, k * 4.0, 0.0);
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          float size = mix(1.6, 8.0, sqrt(k));
          bool live = age >= 0.0 && age < uLife;
          float dist = -mv.z;
          gl_PointSize = live ? clamp(size * uScale / max(1.0, dist), 1.0, 140.0) : 0.0;
          // Thin right next to the lens, so the trail you are chasing never
          // becomes a white wall across the screen.
          vA = live ? pow(1.0 - k, 1.4) * 0.72 * smoothstep(6.0, 40.0, dist) : 0.0;
          vCol = aCol;
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLight;
        uniform vec3 fogColor;
        varying float vA;
        varying vec3 vCol;
        varying float vFog;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.15, d) * vA;
          if (a < 0.01) discard;
          vec3 col = mix(vCol * uLight, fogColor, vFog);
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
  }

  /**
   * Puff from `at` (a Vector3) in colour rgb [r, g, b], time `time`. Puffs
   * are laid along the line from the last emission point, so a fast jet
   * leaves a line, not a string of beads.
   */
  emit(dt, time, at, rgb) {
    if (!this.hasLast) {
      this.last.copy(at);
      this.hasLast = true;
    }
    this.acc += dt * SMOKE_RATE;
    const n = Math.min(12, Math.floor(this.acc));
    this.acc -= n;
    for (let k = 1; k <= n; k++) {
      const f = k / n;
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.aPos.setXYZ(i, this.last.x + (at.x - this.last.x) * f, this.last.y + (at.y - this.last.y) * f, this.last.z + (at.z - this.last.z) * f);
      this.aBirth.setX(i, time - dt * (1 - f));
      this.aCol.setXYZ(i, rgb[0], rgb[1], rgb[2]);
    }
    if (n) {
      this.last.copy(at);
      this.dirty = true;
    }
  }

  /** Stop emitting; what is out there fades by itself. */
  cut() {
    this.hasLast = false;
    this.acc = 0;
  }

  clear() {
    this.cut();
    for (let i = 0; i < this.max; i++) this.aBirth.setX(i, -1e6);
    this.aBirth.needsUpdate = true;
  }

  update(time, pixelScale, light) {
    const u = this.mat.uniforms;
    u.uTime.value = time;
    u.uScale.value = pixelScale;
    u.uLight.value = light;
    if (this.dirty) {
      this.aPos.needsUpdate = true;
      this.aBirth.needsUpdate = true;
      this.aCol.needsUpdate = true;
      this.dirty = false;
    }
  }

  /** How many puffs are still in the air at `time` (for the tests). */
  liveCount(time) {
    let n = 0;
    for (let i = 0; i < this.max; i++) {
      const age = time - this.aBirth.getX(i);
      if (age >= 0 && age < SMOKE_LIFE) n++;
    }
    return n;
  }

  dispose() {
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

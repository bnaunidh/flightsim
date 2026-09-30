/**
 * The fun pack's pictures: the golden stars, the sparkle when you catch one,
 * and the smoke trail. One draw call each (the stars are one instanced mesh
 * plus one set of glints), nothing allocated per frame.
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

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

function starShape(outer, inner) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i / 10) * Math.PI * 2;
    const x = Math.sin(a) * r;
    const y = Math.cos(a) * r;
    if (i) s.lineTo(x, y);
    else s.moveTo(x, y);
  }
  s.closePath();
  return s;
}

/* ================================================================== *
 * The stars
 * ================================================================== */

export class StarField {
  constructor(max = 12) {
    this.max = max;
    const geo = new THREE.ExtrudeGeometry(starShape(5.5, 2.4), {
      depth: 1.6,
      bevelEnabled: true,
      bevelThickness: 0.5,
      bevelSize: 0.45,
      bevelSegments: 1,
      steps: 1,
    });
    geo.center();
    this.mat = new THREE.MeshStandardMaterial({
      color: 0xffc62e,
      emissive: 0xff9d00,
      emissiveIntensity: 0.75,
      metalness: 0.35,
      roughness: 0.3,
    });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, max);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'fun:stars';

    // A glint at each star, a few pixels wide however far away, so a star
    // two kilometres off is still a gold dot you can steer for.
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aOn = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aOn', this.aOn);
    g.setDrawRange(0, 0);
    const u = fogUniforms();
    u.uScale = { value: 400 };
    u.uTime = { value: 0 };
    this.glowMat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aOn;
        uniform float uScale;
        uniform float uTime;
        varying float vOn;
        ${FOG_VERT}
        void main() {
          vOn = aOn;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          float twinkle = 0.85 + 0.15 * sin(uTime * 5.0 + position.x * 0.01);
          gl_PointSize = aOn > 0.0 ? clamp(26.0 * uScale / max(1.0, -mv.z), 7.0, 120.0) * twinkle : 0.0;
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vOn;
        varying float vFog;
        void main() {
          vec2 c = gl_PointCoord - 0.5;
          float d = length(c);
          float core = smoothstep(0.5, 0.0, d);
          float rays = max(smoothstep(0.06, 0.0, abs(c.x)), smoothstep(0.06, 0.0, abs(c.y))) * smoothstep(0.5, 0.1, d);
          float a = (core * core * 0.9 + rays * 0.6) * vOn * (1.0 - 0.6 * vFog);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0, 0.82, 0.35) * a, a);
        }
      `,
    });
    this.glow = new THREE.Points(g, this.glowMat);
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 8;
    this.glowGeo = g;

    this.stars = [];
    this.found = null;
    this.popT = new Float32Array(max).fill(-1);
  }

  addTo(group) {
    group.add(this.mesh, this.glow);
  }

  /** Show these stars; `found` is a Set of the ids already caught. */
  set(stars, found) {
    this.stars = stars.slice(0, this.max);
    this.found = found;
    this.popT.fill(-1);
    this.mesh.count = this.stars.length;
    this.glowGeo.setDrawRange(0, this.stars.length);
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      this.aPos.setXYZ(i, s.x, s.y, s.z);
    }
    this.aPos.needsUpdate = true;
  }

  clear() {
    this.stars = [];
    this.mesh.count = 0;
    this.glowGeo.setDrawRange(0, 0);
  }

  /** Start the "caught it" pop on star i. */
  pop(i) {
    if (i >= 0 && i < this.popT.length) this.popT[i] = 0;
  }

  update(dt, time, camera, pixelScale) {
    const n = this.stars.length;
    if (!n) return;
    this.glowMat.uniforms.uTime.value = time;
    this.glowMat.uniforms.uScale.value = pixelScale;
    for (let i = 0; i < n; i++) {
      const s = this.stars[i];
      const caught = this.found && this.found.has(s.id);
      let scale = 1;
      let on = caught ? 0 : 1;
      if (this.popT[i] >= 0) {
        this.popT[i] += dt;
        const k = this.popT[i] / 0.45;
        if (k >= 1) this.popT[i] = -1;
        else {
          scale = 1 + k * 1.6;
          on = 1 - k;
        }
      } else if (caught) {
        scale = 0;
      }
      // Spin, and bob a little.
      _q.setFromAxisAngle(_up, time * 1.8 + i);
      _p.set(s.x, s.y + Math.sin(time * 2 + i * 1.7) * 0.8, s.z);
      _s.setScalar(scale * (1 + 0.06 * Math.sin(time * 4 + i)));
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.aOn.setX(i, on);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.aOn.needsUpdate = true;
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mat.dispose();
    this.glowGeo.dispose();
    this.glowMat.dispose();
  }
}

/* ================================================================== *
 * Sparkles: a burst of gold when you catch a star
 * ================================================================== */

export class Burst {
  constructor(max = 160) {
    this.max = max;
    this.vel = new Float32Array(max * 3);
    this.age = new Float32Array(max).fill(99);
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(new Float32Array(max * 3), 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.BufferAttribute(new Float32Array(max), 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aLife', this.aLife);
    const u = fogUniforms();
    u.uScale = { value: 400 };
    this.mat = new THREE.ShaderMaterial({
      uniforms: u,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */ `
        attribute float aLife;
        uniform float uScale;
        varying float vLife;
        ${FOG_VERT}
        void main() {
          vLife = aLife;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = aLife > 0.0 ? clamp(2.4 * uScale / max(1.0, -mv.z), 2.0, 40.0) : 0.0;
          ${FOG_CALC}
        }
      `,
      fragmentShader: /* glsl */ `
        varying float vLife;
        varying float vFog;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.05, d) * vLife * (1.0 - vFog);
          if (a < 0.01) discard;
          gl_FragColor = vec4(vec3(1.0, 0.86, 0.4) * a, a);
        }
      `,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 9;
    this.geo = g;
  }

  emit(x, y, z, count = 60) {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const sp = 8 + Math.random() * 14;
      this.vel[i * 3] = Math.cos(a) * r * sp;
      this.vel[i * 3 + 1] = u * sp + 4;
      this.vel[i * 3 + 2] = Math.sin(a) * r * sp;
      this.aPos.setXYZ(i, x, y, z);
      this.age[i] = 0;
    }
  }

  update(dt, pixelScale) {
    this.mat.uniforms.uScale.value = pixelScale;
    let any = false;
    for (let i = 0; i < this.max; i++) {
      if (this.age[i] > 1.2) {
        if (this.aLife.getX(i) !== 0) {
          this.aLife.setX(i, 0);
          any = true;
        }
        continue;
      }
      this.age[i] += dt;
      const drag = Math.exp(-2.2 * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * drag - 3 * dt;
      this.vel[i * 3 + 2] *= drag;
      this.aPos.setXYZ(
        i,
        this.aPos.getX(i) + this.vel[i * 3] * dt,
        this.aPos.getY(i) + this.vel[i * 3 + 1] * dt,
        this.aPos.getZ(i) + this.vel[i * 3 + 2] * dt
      );
      this.aLife.setX(i, Math.max(0, 1 - this.age[i] / 1.2));
      any = true;
    }
    if (any) {
      this.aPos.needsUpdate = true;
      this.aLife.needsUpdate = true;
    }
  }

  clear() {
    this.age.fill(99);
    for (let i = 0; i < this.max; i++) this.aLife.setX(i, 0);
    this.aLife.needsUpdate = true;
  }

  dispose() {
    this.geo.dispose();
    this.mat.dispose();
  }
}

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

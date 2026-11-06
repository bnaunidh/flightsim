/**
 * The water itself, from inside it: what you look at when you are looking at
 * no thing in particular.
 *
 *   WaterDome    the whole of the view as one sky-sized sphere, in one draw:
 *                the water column darkening downwards and, overhead, the
 *                surface from below, reached by a ray from the lens so it has
 *                real perspective, its ripples moving: Snell's window of bright
 *                sky straight up, and outside that the surface as a dark
 *                mirror. Being a dome, nothing can z-fight with it.
 *   Shafts       the sun coming down through the surface in slanting bars,
 *                round the lens wherever it is.
 *   Motes        what hangs in the water, round the lens wherever it is.
 *   Bubbles      what comes up off the wreck, and the silt it raises.
 *
 * All of it is moved by the shaders or by one small loop, and all of it is
 * small on Low. Seizure-safe: everything here moves slowly, the shafts and the
 * ripples take seconds to change, and nothing blinks.
 */

import * as THREE from '../../vendor/three.module.js';

export const AMOUNT = {
  low: { shafts: 5, motes: 70, bubbles: 46 },
  medium: { shafts: 8, motes: 130, bubbles: 80 },
  high: { shafts: 12, motes: 220, bubbles: 120 },
  ultra: { shafts: 16, motes: 300, bubbles: 160 },
};

const DOME_VERT = `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
  gl_Position = p.xyww;
  gl_Position.z = p.w * 0.99999;
}`;

const DOME_FRAG = `
uniform sampler2D uRipple;
uniform vec3 uTop;
uniform vec3 uFog;
uniform vec3 uDeep;
uniform vec3 uSky;
uniform vec3 uSunDir;
uniform vec2 uCam;
uniform float uDepth;
uniform float uTime;
uniform float uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = mix(uFog, uDeep, smoothstep(0.02, -0.75, d.y));
  c = mix(c, uTop, smoothstep(0.02, 0.8, d.y));
  if (d.y > 0.005) {
    float t = uDepth / d.y;
    vec2 p = uCam + d.xz * t;
    vec2 a = texture2D(uRipple, p * 0.043 + uTime * vec2(0.021, 0.013)).rg - 0.5;
    vec2 b = texture2D(uRipple, p * 0.017 - uTime * vec2(0.012, 0.017)).rg - 0.5;
    vec2 r = a + b * 0.8;
    // The window: everything above the water, squeezed into a cone of 97 degrees.
    float u = d.y + r.x * 0.16;
    float win = smoothstep(0.6, 0.72, u);
    // Outside it the surface mirrors the water under it.
    float wob = (r.x + r.y) * 0.5;
    vec3 mirror = mix(uFog, uTop, 0.7 + wob * 0.9) * (1.1 + wob * 1.1);
    vec3 sky = uSky * (1.0 + r.y * 0.6);
    // The sun in the window: a bright blur that moves with the ripples.
    float s = max(dot(normalize(d + vec3(r.x, 0.0, r.y) * 0.08), uSunDir), 0.0);
    sky += uSky * pow(s, 24.0) * uSun * 1.5;
    vec3 surf = mix(mirror, sky, win);
    c = mix(c, surf, exp(-t * 0.012) * smoothstep(0.005, 0.12, d.y));
  }
  gl_FragColor = vec4(c, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SHAFT_VERT = `
attribute vec3 aRoot; // x, z, and width
attribute float aSeed;
uniform vec3 uEye;
uniform vec3 uSunDir;
uniform float uTime;
varying float vFade;
varying vec2 vUv;
void main() {
  vec2 c = aRoot.xy;
  // Round the lens, wherever it is: each one wraps in a 120 m box and fades at the box's edge.
  vec2 off = mod(c - uEye.xz + 60.0, 120.0) - 60.0;
  float len = 46.0 + aSeed * 30.0;
  vec3 slant = normalize(vec3(uSunDir.x, 1.4, uSunDir.z));
  vec3 top = vec3(uEye.x + off.x, 0.0, uEye.z + off.y);
  float along = (0.5 - position.y) * len;
  vec3 axis = top - slant * along;
  // Faces the lens, turning round its own length.
  vec3 toEye = uEye - axis;
  vec3 side = normalize(cross(slant, toEye));
  vec3 p = axis + side * position.x * aRoot.z * (1.0 + (0.5 - position.y) * 0.6);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  float breath = 0.6 + 0.4 * sin(uTime * (0.2 + aSeed * 0.2) + aSeed * 40.0);
  float edge = 1.0 - smoothstep(38.0, 60.0, length(off));
  float near = smoothstep(4.0, 14.0, length(toEye));
  vFade = breath * edge * near;
  vUv = position.xy + 0.5;
}`;

const SHAFT_FRAG = `
uniform vec3 uColor;
uniform float uK;
varying float vFade;
varying vec2 vUv;
void main() {
  float x = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = x * x * vUv.y * vUv.y * vFade * uK;
  gl_FragColor = vec4(uColor * a, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const MOTE_VERT = `
attribute float aSize;
uniform vec3 uEye;
uniform float uTime;
uniform float uScale;
varying float vA;
void main() {
  vec3 p = position + vec3(sin(uTime * 0.13 + position.y), uTime * 0.04, cos(uTime * 0.11 + position.x)) * 1.2;
  p = uEye + mod(p - uEye + 16.0, 32.0) - 16.0;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = max(0.5, -mv.z);
  gl_PointSize = clamp(aSize * uScale / d, 1.0, 9.0);
  vA = smoothstep(16.0, 8.0, length(p - uEye)) * smoothstep(0.4, 1.6, d);
  gl_Position = projectionMatrix * mv;
}`;

const MOTE_FRAG = `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.25, 0.0, dot(q, q)) * vA * 0.5;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const BUB_VERT = `
attribute float aSize;
attribute float aA;
uniform float uScale;
varying float vA;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = clamp(aSize * uScale / max(0.5, -mv.z), 1.0, 26.0);
  vA = aA;
  gl_Position = projectionMatrix * mv;
}`;

const BUB_FRAG = `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r = dot(q, q);
  if (r > 1.0) discard;
  // A bright rim and a spot of light on it: a bubble, not a dot.
  float rim = smoothstep(0.45, 0.95, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float spot = smoothstep(0.1, 0.0, dot(q + 0.35, q + 0.35));
  gl_FragColor = vec4(uColor, (rim * 0.7 + spot * 0.8 + 0.06) * vA);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SILT_FRAG = `
uniform vec3 uColor;
varying float vA;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.25, 0.02, dot(q, q)) * vA;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class WaterDome {
  constructor(parent, shared, ripple) {
    this.geo = new THREE.SphereGeometry(10, 24, 16);
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uRipple: { value: ripple },
        uTop: shared.top,
        uFog: shared.fog,
        uDeep: shared.deep,
        uSky: shared.sky,
        uSunDir: shared.sunDir,
        uCam: { value: new THREE.Vector2() },
        uDepth: shared.depth,
        uTime: shared.time,
        uSun: shared.sunGlow,
      },
      vertexShader: DOME_VERT,
      fragmentShader: DOME_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geo, this.mat);
    this.mesh.name = 'underwater:dome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    parent.add(this.mesh);
  }

  update(x, z) {
    // Only ever a pattern: kept small, so that it keeps its precision 200 km out.
    this.mat.uniforms.uCam.value.set(((x % 2048) + 2048) % 2048, ((z % 2048) + 2048) % 2048);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

export class Shafts {
  constructor(parent, shared, count) {
    const g = (this.geo = new THREE.InstancedBufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const root = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      root[i * 3] = Math.random() * 120;
      root[i * 3 + 1] = Math.random() * 120;
      root[i * 3 + 2] = 7 + Math.random() * 15;
      seed[i] = Math.random();
    }
    g.setAttribute('aRoot', new THREE.InstancedBufferAttribute(root, 3));
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 1));
    g.instanceCount = count;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uEye: shared.eye, uSunDir: shared.sunDir, uTime: shared.time, uColor: shared.shaftColor, uK: shared.shafts },
      vertexShader: SHAFT_VERT,
      fragmentShader: SHAFT_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'underwater:shafts';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    parent.add(this.mesh);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

export class Motes {
  constructor(parent, shared, count, height) {
    const pos = new Float32Array(count * 3);
    const size = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = Math.random() * 32;
      pos[i * 3 + 1] = Math.random() * 32;
      pos[i * 3 + 2] = Math.random() * 32;
      size[i] = 0.5 + Math.random() * 1.1;
    }
    const g = (this.geo = new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uEye: shared.eye, uTime: shared.time, uScale: { value: height * 0.09 }, uColor: shared.moteColor },
      vertexShader: MOTE_VERT,
      fragmentShader: MOTE_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.name = 'underwater:motes';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 9;
    parent.add(this.mesh);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

/** A small pool of points that rise (bubbles) or spread and settle (silt). */
export class Bubbles {
  constructor(parent, shared, count, height, silt = false) {
    this.n = count;
    this.silt = silt;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.max = new Float32Array(count);
    this.size = new Float32Array(count);
    this.a = new Float32Array(count);
    this.alive = 0;
    this.cursor = 0;
    const g = (this.geo = new THREE.BufferGeometry());
    this.aPos = new THREE.BufferAttribute(this.p, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aA = new THREE.BufferAttribute(this.a, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aA', this.aA);
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: height * (silt ? 0.28 : 0.1) }, uColor: silt ? shared.siltColor : shared.bubbleColor },
      vertexShader: BUB_VERT,
      fragmentShader: silt ? SILT_FRAG : BUB_FRAG,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.Points(g, this.mat);
    this.mesh.name = silt ? 'underwater:silt' : 'underwater:bubbles';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
    this.mesh.visible = false;
    parent.add(this.mesh);
  }

  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.n;
    this.p[i * 3] = x;
    this.p[i * 3 + 1] = y;
    this.p[i * 3 + 2] = z;
    this.v[i * 3] = vx;
    this.v[i * 3 + 1] = vy;
    this.v[i * 3 + 2] = vz;
    if (!(this.life[i] > 0)) this.alive++;
    this.life[i] = life;
    this.max[i] = life;
    this.size[i] = size;
  }

  update(dt, t) {
    if (this.alive <= 0) {
      if (this.mesh.visible) this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    const { p, v, life, max, size, a, n, silt } = this;
    for (let i = 0; i < n; i++) {
      if (!(life[i] > 0)) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        this.alive--;
        a[i] = 0;
        continue;
      }
      const j = i * 3;
      if (silt) {
        const k = Math.exp(-dt * 1.3);
        v[j] *= k;
        v[j + 1] *= k;
        v[j + 2] *= k;
      } else {
        // A bubble goes up wobbling, and faster the bigger it is.
        p[j] += Math.sin(t * 5 + i) * 0.35 * dt;
        p[j + 2] += Math.cos(t * 4 + i * 1.7) * 0.35 * dt;
      }
      p[j] += v[j] * dt;
      p[j + 1] += v[j + 1] * dt;
      p[j + 2] += v[j + 2] * dt;
      if (!silt && p[j + 1] > -0.05) {
        life[i] = 0;
        this.alive--;
        a[i] = 0;
        continue;
      }
      const u = life[i] / max[i];
      a[i] = silt ? Math.min(1, (1 - u) * 6) * u * 0.34 : Math.min(1, u * 4);
      if (silt) size[i] += dt * 1.6;
    }
    this.aPos.needsUpdate = true;
    this.aA.needsUpdate = true;
    if (silt) this.aSize.needsUpdate = true;
    else this.aSize.needsUpdate = this.cursor !== this._lastCursor;
    this._lastCursor = this.cursor;
  }

  dispose() {
    this.mesh.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
  }
}

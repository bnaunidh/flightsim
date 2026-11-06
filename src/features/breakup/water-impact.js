/**
 * THE SEA, HIT HARD: a wall of spray. What an aeroplane throws up going into
 * the water at speed is not a ring of drops, it is a sheet: a thick white wall
 * thrown up and forward along the line it took, that hangs for a second or
 * two and falls back as mist. And a rooster tail behind it while it skips and
 * slews across the surface. Real water, no words, no stars.
 *
 * One InstancedMesh of soft puffs. Everything about a puff's flight is in its
 * instance attributes and worked out in the vertex shader, so a puff costs
 * nothing on the CPU after it is born, and when the last one has gone the mesh
 * is hidden: no draw call. Loaded the first time an aeroplane is low over the
 * sea, never before.
 *
 * Seizure-safe: nothing here is additive, nothing blinks, a puff only ever
 * fades, and the wall takes half a second to rise and two to go.
 */

import * as THREE from '../../vendor/three.module.js';

/** Seconds the foam stays where it went in. */
const VIEW_SLICK = 16;
/** Puffs in the pool, by quality. */
export const SPRAY = { low: 110, medium: 200, high: 320, ultra: 420 };

function puffTexture() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g || !g.createRadialGradient) return null;
  g.clearRect(0, 0, 64, 64);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * 6.28;
    const r = rnd() * 19;
    const x = 32 + Math.cos(a) * r;
    const y = 32 + Math.sin(a) * r;
    const s = 8 + rnd() * 14;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    grd.addColorStop(0, `rgba(255,255,255,${(0.16 + rnd() * 0.2).toFixed(2)})`);
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 64, 64);
  }
  const t = new THREE.CanvasTexture(c);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** The patch of foam: white in the middle, broken up and gone well inside the edge of the square. */
function slickTexture() {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  if (!g || !g.createRadialGradient) return null;
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  let seed = 23;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i++) {
    const a = rnd() * 6.283;
    const r = Math.pow(rnd(), 0.7) * 44;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r * 0.8;
    const s = 3 + rnd() * 11;
    const grd = g.createRadialGradient(x, y, 0, x, y, s);
    const v = Math.round(30 + rnd() * 70);
    grd.addColorStop(0, `rgb(${v},${v},${v})`);
    grd.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - s, y - s, s * 2, s * 2);
  }
  return new THREE.CanvasTexture(c);
}

const VERT = `
attribute vec3 aOrigin;
attribute vec3 aVel;
attribute vec4 aLife; // birth, life, start size, end size
attribute float aSeed;
uniform float uTime;
varying vec2 vUv;
varying float vFade;
varying float vShade;
void main() {
  float t = uTime - aLife.x;
  float u = t / aLife.y;
  if (u < 0.0 || u > 1.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0); vFade = 0.0; vShade = 0.0;
    return;
  }
  // Air takes the way off it (k), and it falls: y = y0 + (vy/k + g/k^2)(1 - e^-kt) - g t / k.
  const float k = 1.25;
  const float g = 9.81;
  float e = (1.0 - exp(-k * t)) / k;
  vec3 p = aOrigin + aVel * e;
  p.y += (g / k) * (e - t);
  p.y = max(p.y, 0.1);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float s = mix(aLife.z, aLife.w, sqrt(u));
  float c = cos(aSeed * 6.283 + t * 0.35);
  float n = sin(aSeed * 6.283 + t * 0.35);
  vec2 q = vec2(c * position.x - n * position.y, n * position.x + c * position.y);
  mv.xy += q * s;
  gl_Position = projectionMatrix * mv;
  vUv = position.xy + 0.5;
  // Up quickly, down slowly: the sheet is thick at first and goes to mist.
  vFade = smoothstep(0.0, 0.05, u) * (1.0 - u) * (1.0 - u * 0.4) * clamp(7.0 / s, 0.28, 1.0);
  vShade = 0.72 + 0.28 * clamp(p.y / 14.0, 0.0, 1.0);
}`;

const FRAG = `
uniform sampler2D uMap;
uniform vec3 uTint;
uniform float uAlpha;
varying vec2 vUv;
varying float vFade;
varying float vShade;
void main() {
  float a = texture2D(uMap, vUv).a * vFade * uAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uTint * vShade, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const _v = new THREE.Vector3();

export class WaterImpact {
  constructor(parent, quality = 'high') {
    this.max = SPRAY[quality] || SPRAY.high;
    this.low = quality === 'low';
    const g = (this.geo = new THREE.InstancedBufferGeometry());
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.origin = new Float32Array(this.max * 3);
    this.vel = new Float32Array(this.max * 3);
    this.life = new Float32Array(this.max * 4);
    this.seed = new Float32Array(this.max);
    for (let i = 0; i < this.max; i++) {
      this.life[i * 4] = -1e6;
      this.life[i * 4 + 1] = 1;
      this.seed[i] = Math.random();
    }
    this.aOrigin = new THREE.InstancedBufferAttribute(this.origin, 3).setUsage(THREE.DynamicDrawUsage);
    this.aVel = new THREE.InstancedBufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.aLife = new THREE.InstancedBufferAttribute(this.life, 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aOrigin', this.aOrigin);
    g.setAttribute('aVel', this.aVel);
    g.setAttribute('aLife', this.aLife);
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(this.seed, 1));
    g.instanceCount = this.max;
    this.map = puffTexture();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uMap: { value: this.map }, uTint: { value: new THREE.Color(0.92, 0.96, 0.98) }, uAlpha: { value: 0.62 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.name = 'water-impact';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.slick = this.makeSlick(parent);
    this.time = 0;
    this.cursor = 0;
    this.until = -1;
    this.slickBorn = -1e6;
    this.slickSize = 30;
    this.dirty = false;
    this.trailT = 0;
    this.stats = { walls: 0, puffs: 0 };
  }

  /** The foam left on the water where it went in: one soft patch, torn at the edges. */
  makeSlick(parent) {
    const geo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0xe8f2f4, alphaMap: slickTexture(), transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    const m = new THREE.Mesh(geo, mat);
    m.name = 'water-slick';
    m.visible = false;
    m.renderOrder = 3;
    parent.add(m);
    return m;
  }

  get busy() {
    return this.time < this.until;
  }

  puff(x, y, z, vx, vy, vz, life, s0, s1) {
    const i = this.cursor;
    this.cursor = (i + 1) % this.max;
    this.origin[i * 3] = x;
    this.origin[i * 3 + 1] = y;
    this.origin[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i * 4] = this.time;
    this.life[i * 4 + 1] = life;
    this.life[i * 4 + 2] = s0;
    this.life[i * 4 + 3] = s1;
    this.until = Math.max(this.until, this.time + life);
    this.dirty = true;
    this.stats.puffs++;
  }

  /**
   * The wall: at (x, z), the aeroplane going (dx, dz) along the water at
   * `speed`, its length/span `size`, and `hard` 0..1 how bad.
   */
  wall(x, z, dx, dz, speed, size, hard) {
    const k = Math.min(1, Math.max(0.15, hard));
    const l = Math.hypot(dx, dz) || 1;
    const fx = dx / l;
    const fz = dz / l;
    const sx = -fz;
    const sz = fx;
    const up = 8 + 26 * k;
    const span = Math.max(4, size * 0.5);
    // Not a cloud: a torn sheet. Fingers of water go up and out across the width of it, each a line of puffs from
    // the slowest near the surface to the fastest at its tip, so that it has gaps and an edge.
    const jets = this.low ? 6 : 11;
    const each = Math.round((this.low ? 8 : 12) * (0.5 + 0.5 * k));
    for (let j = 0; j < jets; j++) {
      const across = (j + 0.5 + (Math.random() - 0.5) * 0.7) / jets * 2 - 1;
      const a = Math.abs(across);
      const tip = up * (1 - 0.6 * a * a) * (0.6 + Math.random() * 0.6);
      const out = (5 + 13 * k) * across;
      const fwd = speed * (0.14 + Math.random() * 0.16);
      const px = x + sx * across * span + fx * Math.random() * span * 0.5;
      const pz = z + sz * across * span + fz * Math.random() * span * 0.5;
      for (let i = 0; i < each; i++) {
        const f = 0.2 + 0.8 * ((i + Math.random() * 0.6) / each);
        const s = (1 + Math.random() * 1.6 + size * 0.03) * (1.5 - f * 0.7);
        this.puff(px, 0.4, pz, (fx * fwd + sx * out) * f, tip * f, (fz * fwd + sz * out) * f, 1.3 + Math.random() * 1 + f * 0.7, s, s * (2 + Math.random()));
      }
    }
    this.slick.position.set(x, 0.12, z);
    this.slick.rotation.y = Math.atan2(fx, fz);
    this.slickBorn = this.time;
    this.slickSize = Math.max(22, size * 2.4) * (0.6 + 0.6 * k);
    this.until = Math.max(this.until, this.time + VIEW_SLICK);
    // What hangs afterwards: mist, big and thin and slow.
    const m = Math.round((this.low ? 7 : 14) * (0.5 + 0.5 * k));
    for (let i = 0; i < m; i++) {
      const a = Math.random() * 6.283;
      const r = Math.random() * span * 1.3;
      const s = 6 + Math.random() * 5 + size * 0.1;
      this.puff(x + Math.cos(a) * r, 1, z + Math.sin(a) * r, fx * speed * 0.08 + Math.cos(a) * 2, 1.2 + Math.random() * up * 0.2, fz * speed * 0.08 + Math.sin(a) * 2, 3 + Math.random() * 2, s, s * 2);
    }
    this.stats.walls++;
  }

  /** Going across the water: what it throws up behind and out to each side. */
  trail(x, z, vx, vz, speed, size) {
    const n = this.low ? 2 : 4;
    const l = Math.max(1, speed);
    const fx = vx / l;
    const fz = vz / l;
    for (let i = 0; i < n; i++) {
      const side = i % 2 ? 1 : -1;
      const w = size * 0.3 * (0.4 + Math.random() * 0.6) * side;
      const s = 1.4 + Math.random() * 1.8 + size * 0.03;
      const up = 2 + speed * (0.1 + Math.random() * 0.18);
      this.puff(x - fz * w, 0.3, z + fx * w, -fz * side * (2 + speed * 0.08) + fx * speed * 0.2, up, fx * side * (2 + speed * 0.08) + fz * speed * 0.2, 1 + Math.random() * 0.9, s, s * 2.4);
    }
  }

  clear() {
    this.until = -1;
    this.time += 1000;
    this.mesh.visible = false;
    this.slick.visible = false;
  }

  /** Spray takes the colour of the light it is in (`sky` a colour, `day` 0..1). */
  setLight(sky, day) {
    const u = this.mat.uniforms;
    u.uTint.value.setRGB(0.26, 0.31, 0.36).lerp(_c.setRGB(0.96, 0.98, 0.99), Math.max(0, Math.min(1, day)));
    if (sky && sky.isColor) u.uTint.value.lerp(sky, 0.12);
    u.uAlpha.value = 0.62;
  }

  update(dt) {
    if (!(this.time < this.until)) {
      if (this.mesh.visible) this.mesh.visible = false;
      if (this.slick.visible) this.slick.visible = false;
      return;
    }
    this.time += dt;
    this.mat.uniforms.uTime.value = this.time;
    this.mesh.visible = true;
    const st = this.time - this.slickBorn;
    if (st >= 0 && st < VIEW_SLICK) {
      const g = 1 - Math.exp(-st * 1.3);
      this.slick.visible = true;
      this.slick.scale.setScalar(this.slickSize * (0.45 + 0.75 * g));
      this.slick.material.opacity = 0.8 * Math.min(1, st * 3) * (1 - st / VIEW_SLICK);
    } else this.slick.visible = false;
    if (this.dirty) {
      this.dirty = false;
      this.aOrigin.needsUpdate = true;
      this.aVel.needsUpdate = true;
      this.aLife.needsUpdate = true;
    }
  }

  /** Compile and upload ahead of the crash (features/breakup.js warmLazy): a program links on its first draw otherwise. */
  warm(renderer, camera, scene) {
    renderer.compile(this.mesh, camera, scene);
    renderer.compile(this.slick, camera, scene);
    if (this.map) renderer.initTexture(this.map);
    if (this.slick.material.alphaMap) renderer.initTexture(this.slick.material.alphaMap);
  }

  dispose() {
    this.mesh.removeFromParent();
    this.slick.removeFromParent();
    this.slick.geometry.dispose();
    if (this.slick.material.alphaMap) this.slick.material.alphaMap.dispose();
    this.slick.material.dispose();
    this.geo.dispose();
    this.mat.dispose();
    if (this.map) this.map.dispose();
  }
}

const _c = new THREE.Color();
void _v;

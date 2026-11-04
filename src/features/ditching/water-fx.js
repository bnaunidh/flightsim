/**
 * Spray and wake on the sea, for a ditching and for the floatplane: one
 * pooled Points cloud of droplets and one InstancedMesh of foam patches. Two
 * draw calls, a fixed pool, nothing allocated per frame, built only when the
 * first one is asked for. Low gets the smaller pool and the same look.
 */

import * as THREE from '../../vendor/three.module.js';

const G = 9.81;
const NONE = new THREE.Matrix4().makeScale(0, 0, 0);
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

function softDot() {
  const c = document.createElement('canvas');
  c.width = c.height = 48;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(24, 24, 1, 24, 24, 24);
  grd.addColorStop(0, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.5, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 48, 48);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A patch of foam: a soft body with fine broken water in it, so a row of them reads as wash and not as a stack of ovals. */
function foamPatch() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, 128, 128);
  const body = g.createRadialGradient(64, 64, 4, 64, 64, 60);
  body.addColorStop(0, 'rgb(84,84,84)');
  body.addColorStop(0.7, 'rgb(66,66,66)');
  body.addColorStop(1, 'rgb(0,0,0)');
  g.fillStyle = body;
  g.fillRect(0, 0, 128, 128);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 520; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.pow(rnd(), 0.7) * 56;
    const x = 64 + Math.cos(a) * r;
    const y = 64 + Math.sin(a) * r;
    const rr = 0.8 + rnd() * 2.2;
    g.fillStyle = `rgba(255,255,255,${(0.1 + rnd() * 0.22) * (1 - r / 62)})`;
    g.beginPath();
    g.ellipse(x, y, rr, rr * (1 + rnd()), a, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class SeaFx {
  constructor(scene, { low = false } = {}) {
    this.scene = scene;
    const N = (this.N = low ? 80 : 220);
    const W = (this.W = low ? 22 : 54);
    this.pos = new Float32Array(N * 3);
    this.size = new Float32Array(N);
    this.alpha = new Float32Array(N);
    this.vel = new Float32Array(N * 3);
    this.life = new Float32Array(N);
    this.max = new Float32Array(N);
    this.grow = new Float32Array(N);
    this.next = 0;
    this.alive = 0;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.tint = new THREE.Color(0xe8eef2);
    this.dotMat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: softDot() }, uTint: { value: this.tint }, uScale: { value: 620 } },
      vertexShader: `
        attribute float aSize; attribute float aAlpha; varying float vA; uniform float uScale;
        void main() {
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          // Spray the camera overtakes thins out rather than swelling across the lens.
          vA = aAlpha * smoothstep(5.0, 28.0, -mv.z);
          gl_PointSize = clamp(aSize * uScale / max(1.0, -mv.z), 1.0, 72.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        uniform sampler2D uMap; uniform vec3 uTint; varying float vA;
        void main() {
          vec4 t = texture2D(uMap, gl_PointCoord);
          gl_FragColor = vec4(uTint, t.a * vA);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, this.dotMat);
    this.points.frustumCulled = false;
    this.points.name = 'sea-spray';
    this.points.renderOrder = 4;
    scene.add(this.points);

    // Foam on the water: brightness is its opacity (additive), so one colour attribute does the fade.
    this.foamMat = new THREE.MeshBasicMaterial({ map: foamPatch(), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
    const plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.foam = new THREE.InstancedMesh(plane, this.foamMat, W);
    this.foam.frustumCulled = false;
    this.foam.name = 'sea-foam';
    this.foam.renderOrder = 3;
    this.foam.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.foam.setColorAt(0, _c.setRGB(0, 0, 0));
    this.foam.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.fx = new Float32Array(W);
    this.fz = new Float32Array(W);
    this.fyaw = new Float32Array(W);
    this.fsize = new Float32Array(W);
    this.flen = new Float32Array(W);
    this.fdim = new Float32Array(W);
    this.fgrow = new Float32Array(W);
    this.flife = new Float32Array(W);
    this.fmax = new Float32Array(W);
    this.fnext = 0;
    for (let i = 0; i < W; i++) this.foam.setMatrixAt(i, NONE);
    scene.add(this.foam);
    this.idle = true;
    this.brightness = 0.46;
  }

  /** How bright white is here and now, from the time of day. */
  setLight(night) {
    this.tint.setRGB(night ? 0.22 : 0.9, night ? 0.25 : 0.93, night ? 0.3 : 0.95);
    this.brightness = night ? 0.2 : 0.46;
  }

  /** One droplet cloud at (x, y, z) going (vx, vy, vz), size metres, life seconds. */
  spray(x, y, z, vx, vy, vz, size, life, grow = 1) {
    const i = this.next;
    this.next = (i + 1) % this.N;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.size[i] = size;
    this.grow[i] = grow;
    this.life[i] = this.max[i] = life;
    this.idle = false;
  }

  /** A patch of foam lying on the sea, lengthwise along `yaw` (radians), that spreads and fades; `dim` of full brightness. */
  wake(x, z, yaw, size, life, grow = 1, length = size * 2.1, dim = 1) {
    const i = this.fnext;
    this.fnext = (i + 1) % this.W;
    this.fx[i] = x;
    this.fz[i] = z;
    this.fyaw[i] = yaw;
    this.fsize[i] = size;
    this.flen[i] = length;
    this.fdim[i] = dim;
    this.fgrow[i] = grow;
    this.flife[i] = this.fmax[i] = life;
    this.idle = false;
  }

  update(dt) {
    if (this.idle) return;
    let live = 0;
    for (let i = 0; i < this.N; i++) {
      if (this.life[i] <= 0) {
        this.alpha[i] = 0;
        continue;
      }
      this.life[i] -= dt;
      const j = i * 3;
      this.vel[j + 1] -= G * dt;
      const drag = 1 - Math.min(1, dt * 1.1);
      this.vel[j] *= drag;
      this.vel[j + 2] *= drag;
      this.pos[j] += this.vel[j] * dt;
      this.pos[j + 1] += this.vel[j + 1] * dt;
      this.pos[j + 2] += this.vel[j + 2] * dt;
      if (this.pos[j + 1] < 0) {
        this.pos[j + 1] = 0;
        this.vel[j + 1] = 0;
      }
      const k = Math.max(0, this.life[i] / this.max[i]);
      this.size[i] += this.grow[i] * dt;
      this.alpha[i] = 0.72 * Math.min(1, k * 1.5);
      live++;
    }
    const g = this.points.geometry.attributes;
    g.position.needsUpdate = true;
    g.aSize.needsUpdate = true;
    g.aAlpha.needsUpdate = true;
    for (let i = 0; i < this.W; i++) {
      if (this.flife[i] <= 0) continue;
      this.flife[i] -= dt;
      if (this.flife[i] <= 0) {
        this.foam.setMatrixAt(i, NONE);
        continue;
      }
      live++;
      const k = this.flife[i] / this.fmax[i];
      this.fsize[i] += this.fgrow[i] * dt;
      _q.setFromAxisAngle(UP, this.fyaw[i]);
      _s.set(this.fsize[i], 1, this.flen[i]);
      _m.compose(_p.set(this.fx[i], 0.06, this.fz[i]), _q, _s);
      this.foam.setMatrixAt(i, _m);
      // In and out, so a patch renewed in place never pops.
      const b = this.brightness * this.fdim[i] * Math.min(1, k * 1.5, (1 - k) * 6 + 0.2);
      this.foam.setColorAt(i, _c.setRGB(b, b, b));
    }
    this.foam.instanceMatrix.needsUpdate = true;
    this.foam.instanceColor.needsUpdate = true;
    this.alive = live;
    if (!live) this.idle = true;
  }

  /** Everything off the water; the pools stay for the next time. */
  clear() {
    this.life.fill(0);
    this.alpha.fill(0);
    this.flife.fill(0);
    for (let i = 0; i < this.W; i++) this.foam.setMatrixAt(i, NONE);
    this.foam.instanceMatrix.needsUpdate = true;
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
    this.idle = true;
    this.alive = 0;
  }

  dispose() {
    this.scene.remove(this.points);
    this.scene.remove(this.foam);
    this.points.geometry.dispose();
    this.dotMat.uniforms.uMap.value.dispose();
    this.dotMat.dispose();
    this.foam.geometry.dispose();
    this.foamMat.map.dispose();
    this.foamMat.dispose();
    this.foam.dispose();
  }
}

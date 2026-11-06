/**
 * The sea bed: a patch of the REAL sea floor (terrain.js heightAt, the same
 * height the flight model and the sink use) round the crash, drawn as sand
 * and rock with the sun's caustics moving over it, and scattered with rocks,
 * weed, shells and what came off the aeroplane. The patch is far bigger than
 * the water lets anybody see, and is moved only when the lens gets near its
 * edge. Everything scattered is hashed from where it lies, so a place looks the
 * same the second time.
 *
 * Its own small shaders, no lights: a few texture reads a pixel on a school
 * laptop, the same whatever the scene's lights happen to be.
 */

import * as THREE from '../../vendor/three.module.js';

/** Grid squares a side, and the patch's half width (metres). */
export const BED = { low: { grid: 64, half: 170 }, medium: { grid: 96, half: 200 }, high: { grid: 128, half: 220 }, ultra: { grid: 160, half: 240 } };
/** Things on the bed, by quality. */
export const LITTER = {
  low: { rocks: 26, weed: 110, shells: 40, debris: 10 },
  medium: { rocks: 44, weed: 240, shells: 80, debris: 16 },
  high: { rocks: 70, weed: 420, shells: 140, debris: 24 },
  ultra: { rocks: 90, weed: 640, shells: 200, debris: 32 },
};

function hash(x, y) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function tiledCanvas(size, paint) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  paint(g, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 2;
  return t;
}

/** The surface's ripples, smooth, in red and green: a few sine waves that tile. */
export function rippleTexture() {
  return tiledCanvas(64, (g, S) => {
    const im = g.createImageData(S, S);
    const wave = (u, v, k) => Math.sin(6.2832 * (u * k[0] + v * k[1]) + k[2]);
    const R = [[1, 2, 0.3], [3, -1, 1.7], [-2, 3, 4.1], [5, 2, 2.2], [-4, -5, 5.1]];
    const G = [[2, 1, 2.9], [-1, 3, 0.8], [4, -2, 3.7], [3, 5, 1.1], [-5, 3, 4.4]];
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        let r = 0;
        let q = 0;
        for (let k = 0; k < 5; k++) {
          r += wave(x / S, y / S, R[k]) / (1 + k * 0.5);
          q += wave(x / S, y / S, G[k]) / (1 + k * 0.5);
        }
        im.data[i] = 128 + r * 42;
        im.data[i + 1] = 128 + q * 42;
        im.data[i + 2] = 128;
        im.data[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
  });
}

/** Caustics: the bright web the surface throws on the bottom. Lines drawn round a jittered grid of cells, tiled. */
export function causticTexture() {
  return tiledCanvas(128, (g, S) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, S, S);
    const N = 7;
    const cell = S / N;
    const pts = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push([(i + 0.2 + hash(i, j) * 0.6) * cell, (j + 0.2 + hash(j + 9, i + 3) * 0.6) * cell]);
    const at = (i, j) => pts[((j + N) % N) * N + ((i + N) % N)];
    g.lineCap = 'round';
    for (let pass = 0; pass < 2; pass++) {
      g.strokeStyle = pass ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.25)';
      g.lineWidth = pass ? 1.3 : 3.6;
      for (let j = -1; j <= N; j++) {
        for (let i = -1; i <= N; i++) {
          const p = at(i, j);
          const ox = i < 0 ? -S : i >= N ? S : 0;
          const oy = j < 0 ? -S : j >= N ? S : 0;
          for (const [a, b] of [[1, 0], [0, 1], [1, 1]]) {
            if (a === 1 && b === 1 && hash(i + 40, j) < 0.5) continue;
            const q = at(i + a, j + b);
            const ox2 = i + a < 0 ? -S : i + a >= N ? S : 0;
            const oy2 = j + b < 0 ? -S : j + b >= N ? S : 0;
            g.beginPath();
            g.moveTo(p[0] + ox, p[1] + oy);
            g.lineTo(q[0] + ox2, q[1] + oy2);
            g.stroke();
          }
        }
      }
    }
  });
}

/** Sand: ripples across a grain. Red holds the fine grain, green the ripples, tiled. */
export function sandTexture() {
  return tiledCanvas(128, (g, S) => {
    const im = g.createImageData(S, S);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = (y * S + x) * 4;
        const fine = hash(x, y);
        const a = (x / S) * Math.PI * 2;
        const b = (y / S) * Math.PI * 2;
        const rip = 0.5 + 0.5 * Math.sin(b * 8 + Math.sin(a * 2) * 1.6 + Math.sin(a + b) * 0.9);
        im.data[i] = 150 + fine * 105;
        im.data[i + 1] = 40 + rip * 215;
        im.data[i + 2] = hash(y + 5, x + 3) * 255;
        im.data[i + 3] = 255;
      }
    }
    g.putImageData(im, 0, 0);
  });
}

const BED_VERT = `
attribute float aRock;
varying vec2 vP;
varying float vRock;
varying float vFogD;
varying float vLit;
varying float vDepth;
uniform vec3 uSunDir;
void main() {
  vP = position.xz;
  vRock = aRock;
  vDepth = -position.y;
  vLit = max(dot(normal, uSunDir), 0.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogD = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const BED_FRAG = `
uniform sampler2D uSand;
uniform sampler2D uCaustic;
uniform vec2 uBase;
uniform vec3 uFog;
uniform float uDensity;
uniform float uTime;
uniform float uCaustics;
uniform vec3 uTintBed;
uniform float uAmbient;
varying vec2 vP;
varying float vRock;
varying float vFogD;
varying float vLit;
varying float vDepth;
void main() {
  vec2 p = vP + uBase;
  vec3 t = texture2D(uSand, p * 0.062).rgb;
  float big = texture2D(uSand, p * 0.0083).b;
  vec3 sand = vec3(0.56, 0.5, 0.36) * (0.72 + 0.28 * t.g) * (0.82 + 0.3 * t.r) * (0.8 + 0.34 * big);
  vec3 rock = vec3(0.17, 0.18, 0.19) * (0.6 + 0.8 * t.r) * (0.7 + 0.6 * big);
  vec3 c = mix(sand, rock, smoothstep(0.35, 0.7, vRock + (t.b - 0.5) * 0.25));
  // Lit from above, through this much water: the red goes first, then the green.
  vec3 through = exp(-max(vDepth, 0.0) * vec3(0.17, 0.042, 0.028));
  vec3 lit = c * uTintBed * through * (uAmbient + vLit);
  float ca = texture2D(uCaustic, p * 0.047 + vec2(uTime * 0.011, uTime * 0.007)).r;
  float cb = texture2D(uCaustic, p.yx * 0.039 - vec2(uTime * 0.009, -uTime * 0.012)).r;
  lit += c * uTintBed * through * (min(ca, cb) * 2.2 + (ca + cb) * 0.14) * uCaustics * exp(-max(vDepth, 0.0) * 0.03);
  float d = uDensity * vFogD;
  float f = 1.0 - exp(-d * d);
  gl_FragColor = vec4(mix(lit, uFog, f), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const LIT_VERT = `
#ifdef USE_INSTANCING_COLOR
varying vec3 vColor;
#else
uniform vec3 uColor;
varying vec3 vColor;
#endif
varying float vFogD;
varying float vLit;
varying float vDepth;
uniform vec3 uSunDir;
uniform float uTime;
uniform float uSway;
void main() {
  vec3 p = position;
  #ifdef USE_INSTANCING_COLOR
  vColor = instanceColor;
  #else
  vColor = uColor;
  #endif
  vec4 w = instanceMatrix * vec4(p, 1.0);
  // Weed moves with the swell: more towards the tip, and never all together.
  if (uSway > 0.0) {
    float tip = p.y;
    float ph = w.x * 0.37 + w.z * 0.29;
    w.x += sin(uTime * 0.9 + ph) * tip * tip * uSway;
    w.z += cos(uTime * 0.7 + ph * 1.3) * tip * tip * uSway * 0.7;
  }
  vec3 n = normalize(mat3(instanceMatrix) * normal);
  vLit = 0.5 + 0.5 * dot(n, uSunDir);
  vDepth = -w.y;
  vec4 mv = modelViewMatrix * w;
  vFogD = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const LIT_FRAG = `
uniform vec3 uFog;
uniform float uDensity;
uniform vec3 uTintBed;
uniform float uAmbient;
varying vec3 vColor;
varying float vFogD;
varying float vLit;
varying float vDepth;
void main() {
  vec3 lit = vColor * uTintBed * exp(-max(vDepth, 0.0) * vec3(0.17, 0.042, 0.028)) * (uAmbient + vLit);
  float d = uDensity * vFogD;
  gl_FragColor = vec4(mix(lit, uFog, 1.0 - exp(-d * d)), 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** A blade of weed, base at 0, tip at y = 1. Narrow triangles, no alpha to overdraw. */
function bladeGeometry() {
  const seg = 4;
  const pos = [];
  const nrm = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const u = i / seg;
    const w = 0.09 * (1 - u * 0.85);
    const lean = 0.18 * u * u;
    pos.push(-w, u, lean, w, u, lean);
    nrm.push(0, 0.3, 1, 0, 0.3, 1);
    if (i < seg) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  // A second blade across the first, so a clump has depth from every side.
  const n = pos.length / 3;
  for (let i = 0; i < n; i++) {
    pos.push(pos[i * 3 + 2], pos[i * 3 + 1], pos[i * 3]);
    nrm.push(1, 0.3, 0);
  }
  const base = idx.length;
  for (let i = 0; i < base; i++) idx.push(idx[i] + n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  return g;
}

function rockGeometry() {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const k = 0.72 + 0.42 * hash(Math.round(p.getX(i) * 7), Math.round(p.getY(i) * 7) + Math.round(p.getZ(i) * 5) * 3);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.72, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A shell: a low ribbed cone. */
function shellGeometry() {
  const g = new THREE.ConeGeometry(1, 0.55, 7, 1);
  g.translate(0, 0.27, 0);
  return g;
}

/** A bent panel torn off an aeroplane. */
function panelGeometry() {
  const g = new THREE.BoxGeometry(1, 0.05, 1, 3, 1, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const z = p.getZ(i);
    p.setY(i, p.getY(i) + Math.sin(x * 2.6 + 0.6) * 0.12 + z * x * 0.2);
  }
  g.computeVertexNormals();
  return g;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();
const _c = new THREE.Color();

export class Seabed {
  /** `heightAt` is the game's own terrain height, handed in so that this file can be read in a test. */
  constructor(parent, quality, heightAt, shared) {
    this.heightAt = heightAt;
    this.cfg = BED[quality] || BED.high;
    this.litter = LITTER[quality] || LITTER.high;
    this.group = new THREE.Group();
    this.group.name = 'underwater:bed';
    parent.add(this.group);
    this.shared = shared;
    this.sand = sandTexture();
    this.caustic = causticTexture();
    this.seed = 0;
    this.buildGrid();
    this.buildLitter();
  }

  buildGrid() {
    const { grid } = this.cfg;
    const W = grid + 1;
    const g = (this.geo = new THREE.BufferGeometry());
    this.pos = new Float32Array(W * W * 3);
    this.rock = new Float32Array(W * W);
    this.nrm = new Float32Array(W * W * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nrm, 3));
    g.setAttribute('aRock', new THREE.BufferAttribute(this.rock, 1));
    const idx = new Uint32Array(grid * grid * 6);
    let o = 0;
    for (let j = 0; j < grid; j++) {
      for (let i = 0; i < grid; i++) {
        const a = j * W + i;
        idx[o++] = a;
        idx[o++] = a + W;
        idx[o++] = a + 1;
        idx[o++] = a + 1;
        idx[o++] = a + W;
        idx[o++] = a + W + 1;
      }
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uSand: { value: this.sand },
        uCaustic: { value: this.caustic },
        uBase: { value: new THREE.Vector2() },
        uFog: this.shared.fog,
        uDensity: this.shared.density,
        uTime: this.shared.time,
        uCaustics: this.shared.caustics,
        uTintBed: this.shared.tint,
        uAmbient: this.shared.ambient,
        uSunDir: this.shared.sunDir,
      },
      vertexShader: BED_VERT,
      fragmentShader: BED_FRAG,
    });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  litMaterial(sway, instanced = true) {
    return new THREE.ShaderMaterial({
      uniforms: {
        uFog: this.shared.fog,
        uDensity: this.shared.density,
        uTime: this.shared.time,
        uTintBed: this.shared.tint,
        uAmbient: this.shared.ambient,
        uSunDir: this.shared.sunDir,
        uSway: { value: sway },
        uColor: { value: new THREE.Color(0.5, 0.5, 0.5) },
      },
      vertexShader: LIT_VERT,
      fragmentShader: LIT_FRAG,
      side: sway ? THREE.DoubleSide : THREE.FrontSide,
      ...(instanced ? {} : {}),
    });
  }

  buildLitter() {
    const L = this.litter;
    const make = (geo, mat, n, name) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name;
      m.frustumCulled = false;
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.count = 0;
      this.group.add(m);
      return m;
    };
    this.rocks = make(rockGeometry(), this.litMaterial(0), L.rocks, 'rocks');
    this.weed = make(bladeGeometry(), this.litMaterial(0.32), L.weed, 'weed');
    this.shells = make(shellGeometry(), this.litMaterial(0), L.shells, 'shells');
    this.debris = make(panelGeometry(), this.litMaterial(0), L.debris, 'debris');
  }

  /** Lay the patch out round (cx, cz). */
  layout(cx, cz) {
    const { grid, half } = this.cfg;
    const W = grid + 1;
    const step = (half * 2) / grid;
    // On a whole multiple of the coarsest pattern, so the bed's pattern does not move when the patch does.
    const snap = 64;
    const ox = Math.round(cx / snap) * snap;
    const oz = Math.round(cz / snap) * snap;
    this.cx = ox;
    this.cz = oz;
    this.group.position.set(ox, 0, oz);
    this.mat.uniforms.uBase.value.set(((ox % 1024) + 1024) % 1024, ((oz % 1024) + 1024) % 1024);
    const hs = new Float32Array(W * W);
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const x = i * step - half;
        const z = j * step - half;
        const h = Math.min(0.2, this.heightAt(ox + x, oz + z));
        hs[j * W + i] = h;
        const a = (j * W + i) * 3;
        this.pos[a] = x;
        this.pos[a + 1] = h;
        this.pos[a + 2] = z;
      }
    }
    for (let j = 0; j < W; j++) {
      for (let i = 0; i < W; i++) {
        const l = hs[j * W + Math.max(0, i - 1)];
        const r = hs[j * W + Math.min(grid, i + 1)];
        const d = hs[Math.max(0, j - 1) * W + i];
        const u = hs[Math.min(grid, j + 1) * W + i];
        const nx = l - r;
        const nz = d - u;
        const ny = 2 * step;
        const n = Math.hypot(nx, ny, nz) || 1;
        const a = (j * W + i) * 3;
        this.nrm[a] = nx / n;
        this.nrm[a + 1] = ny / n;
        this.nrm[a + 2] = nz / n;
        const slope = Math.hypot(nx, nz) / ny;
        const x = i * step - half + ox;
        const z = j * step - half + oz;
        const patch = Math.sin(x * 0.021 + Math.sin(z * 0.013) * 2) * Math.sin(z * 0.019 + Math.sin(x * 0.017) * 2);
        this.rock[j * W + i] = Math.min(1, slope * 2.2 + Math.max(0, patch - 0.28) * 1.1);
      }
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.normal.needsUpdate = true;
    this.geo.attributes.aRock.needsUpdate = true;
    this.scatter();
  }

  /** Rocks, weed and shells, hashed from where they lie. */
  scatter() {
    const { half } = this.cfg;
    const place = (mesh, n, pick) => {
      let c = 0;
      for (let i = 0; i < n * 4 && c < n; i++) {
        const r = pick(i, c);
        if (!r) continue;
        mesh.setMatrixAt(c, r.m);
        mesh.setColorAt(c, r.c);
        c++;
      }
      mesh.count = c;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    };
    const hx = (i, k) => hash(this.cx * 0.01 + i * 1.7, k + this.cz * 0.013);
    const spot = (i, r0) => {
      const a = hx(i, 1) * 6.283;
      const r = Math.sqrt(hx(i, 2)) * Math.min(half * 0.72, r0);
      return [Math.cos(a) * r, Math.sin(a) * r];
    };
    const ground = (x, z) => this.heightAt(this.cx + x, this.cz + z);
    place(this.rocks, this.litter.rocks, (i) => {
      const [x, z] = spot(i, 150);
      const h = ground(x, z);
      if (h > -0.6) return null;
      const s = 0.4 + Math.pow(hx(i, 3), 2.4) * 3.6;
      _e.set(hx(i, 4), hx(i, 5) * 6.28, hx(i, 6));
      _m.compose(_p.set(x, h + s * 0.2, z), _q.setFromEuler(_e), _s.set(s, s * (0.7 + hx(i, 7) * 0.5), s));
      return { m: _m, c: _c.setRGB(0.2 + hx(i, 8) * 0.1, 0.21 + hx(i, 8) * 0.1, 0.22 + hx(i, 9) * 0.09) };
    });
    place(this.weed, this.litter.weed, (i) => {
      // In clumps: most of it near a few centres, as it grows.
      const c = i % 17;
      const [cx, cz] = spot(c + 200, 120);
      const a = hx(i, 11) * 6.283;
      const r = Math.pow(hx(i, 12), 1.5) * 16;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      const h = ground(x, z);
      if (h > -1.4) return null;
      const s = 0.8 + hx(i, 13) * 2.2;
      _e.set(0, hx(i, 14) * 6.28, 0);
      _m.compose(_p.set(x, h - 0.05, z), _q.setFromEuler(_e), _s.set(1 + hx(i, 15), s, 1));
      const g = hx(i, 16);
      return { m: _m, c: _c.setRGB(0.1 + g * 0.1, 0.27 + g * 0.17, 0.14) };
    });
    place(this.shells, this.litter.shells, (i) => {
      const [x, z] = spot(i + 500, 60);
      const h = ground(x, z);
      if (h > -0.3) return null;
      const s = 0.09 + hx(i, 21) * 0.17;
      _e.set(hx(i, 22) * 0.5 - 0.25, hx(i, 23) * 6.28, hx(i, 24) * 0.5 - 0.25);
      _m.compose(_p.set(x, h + 0.02, z), _q.setFromEuler(_e), _s.set(s, s, s * 1.2));
      const w = 0.6 + hx(i, 25) * 0.4;
      return { m: _m, c: _c.setRGB(w, w * 0.9, w * 0.78) };
    });
    this.debris.count = 0;
  }

  /** What came off the aeroplane, lying where it landed: a trail of panels along the way it went (dx, dz). */
  layDebris(x, z, dx, dz, seed = 1) {
    const n = this.litter.debris;
    const l = Math.hypot(dx, dz) || 1;
    const fx = dx / l;
    const fz = dz / l;
    let c = 0;
    for (let i = 0; i < n; i++) {
      const u = hash(i + seed, 31);
      const v = hash(i + seed, 32) - 0.5;
      const along = (u - 0.75) * 60;
      const wx = x + fx * along - fz * v * 26;
      const wz = z + fz * along + fx * v * 26;
      const h = this.heightAt(wx, wz);
      if (h > -0.4 || h < -300) continue;
      const s = 0.7 + hash(i + seed, 33) * 2.6;
      _e.set((hash(i, 34) - 0.5) * 0.7, hash(i, 35) * 6.28, (hash(i, 36) - 0.5) * 0.7);
      _m.compose(_p.set(wx - this.cx, h + 0.12, wz - this.cz), _q.setFromEuler(_e), _s.set(s * (0.6 + hash(i, 37)), s * 1.2, s));
      this.debris.setMatrixAt(c, _m);
      const w = 0.45 + hash(i, 38) * 0.4;
      this.debris.setColorAt(c, _c.setRGB(w, w, w * 1.02));
      c++;
    }
    this.debris.count = c;
    this.debris.instanceMatrix.needsUpdate = true;
    if (this.debris.instanceColor) this.debris.instanceColor.needsUpdate = true;
  }

  /** Near the patch's edge? */
  nearEdge(x, z) {
    return Math.max(Math.abs(x - this.cx), Math.abs(z - this.cz)) > this.cfg.half * 0.55;
  }

  dispose() {
    this.group.removeFromParent();
    this.geo.dispose();
    this.mat.dispose();
    this.sand.dispose();
    this.caustic.dispose();
    for (const m of [this.rocks, this.weed, this.shells, this.debris]) {
      m.geometry.dispose();
      m.material.dispose();
      m.dispose();
    }
  }
}

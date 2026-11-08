/**
 * Nullspire, drawn (the numbers are void-city.js). Built by
 * features/farlands-run.js when the eye is within BUILD_WITHIN of it and
 * let go past DROP_BEYOND, so it costs nothing anywhere else on the World
 * Map and nothing at all on any other.
 *
 * Draw calls, all told: the towers (one instanced mesh, every window lit by
 * the shader), the light bridges (one), the street grid's glow (one), the
 * rim's glow (one), the beacon seen from far off (one sprite, fog-free), and
 * the field as worldmap/outstation.js buildField draws any field (the
 * runway, the buildings, the lights, the PAPI lenses; the glazing and the
 * small things above Low), and its ramp's spaceplanes and rockets with the
 * one that lifts off (void-city-craft.js: four more). Under twenty.
 *
 * Nothing moves and nothing flashes: every light is steady. The windows are
 * a hash of their place, the same every frame, and fade to an even glow with
 * distance so the pattern cannot shimmer. Original design: no real city, no
 * copied game.
 */
import * as THREE from '../../vendor/three.module.js';
import { addObstacleAt } from '../terrain.js';
import { buildField, setPapi } from './outstation.js';
import { buildRampCraft } from './void-city-craft.js';
import { DETAIL_RANGE } from './field-detail.js';
import { CITY, CITY_FIELD, CITY_TIERS, SLAB_Y, SLAB_RX, SLAB_RZ, STREET, slabIn, towerLayout, bridgeLayout } from './void-city.js';

const UNIT = new THREE.BoxGeometry(1, 1, 1);
UNIT.translate(0, 0.5, 0);

/* ------------------------------------------------------------------ */
/* The towers' material: windows in the shader                         */
/* ------------------------------------------------------------------ */

function towerMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aInfo;\nvarying vec3 vCp;\nvarying vec3 vCn;\nvarying vec2 vInfo;\nvarying float vCd;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vCp = (instanceMatrix * vec4(position, 1.0)).xyz;\n  vCn = normal;\n  vInfo = aInfo;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vCd = -mvPosition.z;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCp;\nvarying vec3 vCn;\nvarying vec2 vInfo;\nvarying float vCd;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    vec3 an = abs(vCn);
    // Far off, the windows are one even glow: no pattern finer than a pixel to shimmer.
    float farK = smoothstep(2200.0, 6500.0, vCd);
    float thr = 0.34 + 0.42 * fract(vInfo.x * 7.3);
    if (an.y < 0.5) {
      float u = an.x > 0.5 ? vCp.z : vCp.x;
      float v = vCp.y;
      vec2 cell = vec2(floor(u / 4.2), floor(v / 3.7));
      vec2 f = vec2(fract(u / 4.2), fract(v / 3.7));
      float win = step(0.2, f.x) * step(f.x, 0.8) * step(0.26, f.y) * step(f.y, 0.74);
      float hsh = fract(sin(dot(cell + vInfo.x * 91.0, vec2(12.9898, 78.233))) * 43758.5453);
      float lit = step(thr, hsh) * win;
      lit = mix(lit, 0.2 * (1.0 - thr), farK);
      vec3 warm = vec3(1.0, 0.76, 0.46);
      vec3 cool = vec3(0.6, 0.84, 1.0);
      vec3 wc = mix(warm, cool, step(0.62, fract(vInfo.x * 3.1 + floor(v / 3.7) * 0.013)));
      totalEmissiveRadiance += wc * lit * 1.35;
      // The crown: a band of light under every roof line, and the lobby's at the foot.
      totalEmissiveRadiance += vec3(0.5, 0.92, 1.0) * smoothstep(vInfo.y - 8.0, vInfo.y - 2.5, v) * 0.8;
      totalEmissiveRadiance += vec3(0.95, 0.72, 0.45) * smoothstep(6.0, 1.5, v) * 0.3;
    } else if (vCn.y > 0.5) {
      totalEmissiveRadiance += vec3(0.04, 0.06, 0.08);
    }
  }`);
  };
  mat.customProgramCacheKey = () => 'nullspire-towers';
  return mat;
}

/* ------------------------------------------------------------------ */
/* Glows                                                               */
/* ------------------------------------------------------------------ */

const GLOW_VERT = /* glsl */ `
  attribute float aK;
  varying float vK;
  varying vec2 vXZ;
  varying float vD;
  void main() {
    vK = aK;
    vXZ = position.xz;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vD = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

/** The rim: a ribbon hung over the cliff's top, bright at the lip, gone a hundred metres down. */
const RIM_FRAG = /* glsl */ `
  precision mediump float;
  varying float vK;
  varying float vD;
  void main() {
    float a = vK * vK * (0.9 - 0.45 * smoothstep(20000.0, 60000.0, vD));
    gl_FragColor = vec4(vec3(0.28, 0.86, 0.92) * a, a);
  }
`;

/** The streets: a grid of light between the towers, strongest at the heart, one glow from far off. */
const STREET_FRAG = /* glsl */ `
  precision mediump float;
  varying vec2 vXZ;
  varying float vD;
  uniform vec4 uCore;
  float line(float t) { return smoothstep(0.08, 0.0, abs(t - 0.5) - 0.42); }
  void main() {
    vec2 q = (vXZ - uCore.xy) / uCore.zw;
    float heart = 1.0 - clamp(dot(q, q), 0.0, 1.0);
    float g = max(line(fract(vXZ.x / ${STREET.toFixed(1)})), line(fract(vXZ.y / ${STREET.toFixed(1)})));
    float farK = smoothstep(2500.0, 7000.0, vD);
    float v = mix(g * 0.55, 0.16, farK) * heart;
    gl_FragColor = vec4(vec3(1.0, 0.7, 0.4) * v, v);
  }
`;

function glowMaterial(frag, uniforms = {}) {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader: GLOW_VERT,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
}

/** The rim's line, found where the slab's top breaks: a point every few degrees, city metres. */
function rimPoints(n = 128) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    // Bisect along the radial for slabIn = 0.5.
    let lo = 0.8;
    let hi = 1.25;
    for (let k = 0; k < 14; k++) {
      const m = (lo + hi) / 2;
      if (slabIn(CITY.x + ux * SLAB_RX * m, CITY.z + uz * SLAB_RZ * m) > 0.5) lo = m;
      else hi = m;
    }
    out.push([ux * SLAB_RX * lo, uz * SLAB_RZ * lo]);
  }
  return out;
}

function rimMesh() {
  const pts = rimPoints();
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const k = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    const [x, z] = pts[i];
    pos.set([x, 3, z], i * 6);
    pos.set([x, -110, z], i * 6 + 3);
    k[i * 2] = 1;
    k[i * 2 + 1] = 0;
  }
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aK', new THREE.BufferAttribute(k, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -50, 0), SLAB_RX + 600);
  const m = new THREE.Mesh(g, glowMaterial(RIM_FRAG));
  m.name = 'nullspire-rim';
  return m;
}

function streetMesh() {
  const g = new THREE.PlaneGeometry(SLAB_RX * 2, SLAB_RZ * 2);
  g.rotateX(-Math.PI / 2);
  g.setAttribute('aK', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(1), 1));
  const m = new THREE.Mesh(g, glowMaterial(STREET_FRAG, { uCore: { value: new THREE.Vector4(150, -1150, 3300, 1750) } }));
  m.position.y = 0.35;
  m.name = 'nullspire-streets';
  return m;
}

let beaconTex = null;
function beaconTexture() {
  if (beaconTex) return beaconTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,214,160,1)');
  r.addColorStop(0.3, 'rgba(255,190,120,0.45)');
  r.addColorStop(0.65, 'rgba(120,200,230,0.12)');
  r.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 64, 64);
  beaconTex = new THREE.CanvasTexture(c);
  beaconTex.colorSpace = THREE.SRGBColorSpace;
  return beaconTex;
}

/* ------------------------------------------------------------------ */
/* The city                                                            */
/* ------------------------------------------------------------------ */

export class CityLook {
  /**
   * @param {string} quality
   * @param {object} [o]
   * @param {boolean} [o.obstacles=true]  register the towers and the field's buildings as solid (once a world)
   */
  constructor(quality = 'medium', { obstacles = true } = {}) {
    const tier = CITY_TIERS[quality] || CITY_TIERS.medium;
    const t0 = performance.now();
    this.root = new THREE.Group();
    this.root.name = 'nullspire';
    // The slab's own frame: its centre, its top.
    const g = new THREE.Group();
    g.position.set(CITY.x, SLAB_Y, CITY.z);
    g.matrixAutoUpdate = false;
    g.updateMatrix();
    this.city = g;
    this.root.add(g);

    const towers = towerLayout(tier.towers);
    const bridges = bridgeLayout(towers, tier.bridges);
    this.counts = { towers: towers.length, bridges: bridges.length };

    // The towers: one instanced box, lit by the shader.
    const tm = new THREE.InstancedMesh(UNIT, towerMaterial(), towers.length);
    const info = new Float32Array(towers.length * 2);
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    towers.forEach((t, i) => {
      m4.makeScale(t.w, t.h, t.d).setPosition(t.x, 0, t.z);
      tm.setMatrixAt(i, m4);
      info[i * 2] = t.seed;
      info[i * 2 + 1] = t.h;
      // Slate, graphite, a cold blue-grey: a tower's own by its seed. Spires near-black so their light is the thing.
      const k = t.seed;
      if (t.spire) col.setRGB(0.05, 0.055, 0.065);
      else col.setRGB(0.08 + 0.06 * k, 0.085 + 0.05 * k, 0.11 + 0.04 * (1 - k));
      tm.setColorAt(i, col);
      if (obstacles && (t.spire || t.h >= 150)) addObstacleAt(CITY.x + t.x, CITY.z + t.z, t.w + 1, t.d + 1, SLAB_Y - 1, t.h + 2, `You flew into a tower in ${CITY.name}`);
    });
    UNIT.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 2));
    tm.instanceMatrix.needsUpdate = true;
    tm.frustumCulled = false;
    tm.castShadow = false;
    tm.receiveShadow = false;
    tm.name = 'nullspire-towers';
    g.add(tm);
    this.towers = tm;

    // The light bridges: thin bars of light between the tall ones.
    if (bridges.length) {
      const bm = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.5, 0.92, 1.0), transparent: true, opacity: 0.8, depthWrite: false }), bridges.length);
      const q = new THREE.Quaternion();
      const up = new THREE.Vector3(0, 1, 0);
      bridges.forEach((b, i) => {
        const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
        q.setFromAxisAngle(up, Math.atan2(-(b.bz - b.az), b.bx - b.ax));
        m4.compose(new THREE.Vector3((b.ax + b.bx) / 2, b.y, (b.az + b.bz) / 2), q, new THREE.Vector3(len, 2.6, 4.2));
        bm.setMatrixAt(i, m4);
      });
      bm.instanceMatrix.needsUpdate = true;
      bm.frustumCulled = false;
      bm.castShadow = false;
      bm.name = 'nullspire-bridges';
      g.add(bm);
    }

    g.add(streetMesh());
    g.add(rimMesh());

    // The beacon: what you see from far off, a soft light in the black, no fog on it.
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: beaconTexture(), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, fog: false, opacity: 0 }));
    sp.position.set(150, 700, -1150);
    sp.renderOrder = 4;
    sp.name = 'nullspire-beacon';
    g.add(sp);
    this.beacon = sp;

    // The field comes the next frame (addField): two halves of a hitch are each half the size.
    this.field = null;
    this.quality = quality;
    this.detailAt = DETAIL_RANGE[quality] || 0;
    this.buildMs = performance.now() - t0;
    this.fieldMs = 0;
  }

  /** Nullspire International: the outstations' own builder, so it is a real field. Once. */
  addField() {
    if (this.field) return this.field;
    const t0 = performance.now();
    const f = buildField(CITY_FIELD, this.quality);
    f.visible = true;
    // The void is night whatever the clock says: the field's lights stay on.
    if (f.userData.lights) f.userData.lights.visible = true;
    this.root.add(f);
    this.field = f;
    // The ramp: spaceplanes, rockets, the launch complex (in the field's frame, so on the field's group).
    try {
      this.craft = buildRampCraft(CITY_FIELD, this.quality);
      if (this.craft.mesh) f.add(this.craft.mesh);
      f.add(this.craft.lights);
      f.add(this.craft.launcher.group);
    } catch (e) {
      console.warn('[void-city] the ramp\'s craft could not be built', e);
      this.craft = null;
    }
    this.fieldMs = performance.now() - t0;
    this.last = 0;
    return f;
  }

  /** Every frame: the beacon for the eye, the PAPI for whoever is on the approach, the small things in reach. */
  update(cam) {
    const d = Math.hypot(cam.x - CITY.x, cam.z - CITY.z);
    const sp = this.beacon;
    const near = Math.min(1, Math.max(0, (d - 5000) / 14000));
    const far = 1 - Math.min(1, Math.max(0, (d - 90000) / 70000));
    sp.material.opacity = 0.6 * near * near * far;
    const s = Math.min(16000, Math.max(3500, d * 0.07));
    sp.scale.set(s, s, 1);
    const f = this.field;
    if (!f) return;
    if (f.userData.papi) setPapi(f.userData.papi, CITY_FIELD, cam);
    if (f.userData.detail) f.userData.detail.visible = d < this.detailAt;
    if (this.craft) {
      // Its own clock: a quarter of a second at most a step, so a pause or a hidden tab does not jump the rocket.
      const now = performance.now();
      const dt = this.last ? Math.min(0.25, (now - this.last) / 1000) : 0;
      this.last = now;
      this.craft.launcher.update(dt);
    }
  }

  dispose() {
    if (this.craft) this.craft.dispose();
    this.root.traverse((o) => {
      if (o.geometry && o.geometry !== UNIT) o.geometry.dispose();
      const m = o.material;
      if (m && !m.userData.shared) m.dispose();
    });
    this.root.removeFromParent();
  }
}

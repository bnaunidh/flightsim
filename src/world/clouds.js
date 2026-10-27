/**
 * Clouds.
 *
 * Puffs are screen-aligned billboards drawn with one instanced draw call per
 * texture variant. They drift with the real wind vector and wrap around the
 * aircraft, so you can never fly out of the weather.
 *
 * Since wave 19 the puffs are the cloud TYPES the weather is made of (its
 * cu / tcu / cb / stratus / cirrus / scud — world/wx.js, and the fixed skies
 * in weather.js carry them too); the owner: "better clouds, storm clouds,
 * normal clouds":
 *
 *   cumulus     fair-weather puffs with FLAT BASES (the shader clips each one
 *               at the cloud base, a few metres apart) and sunlit tops,
 *               greyer underneath; a silver lining toward the sun; tinted
 *               orange and pink by a low sun.
 *   towering    the same, stacked three or four high.
 *   storm cells cumulonimbus: a dark-based column to seven or eight
 *               kilometres, an anvil spread downwind at the top, a rain shaft
 *               underneath, and — only with Reduce flashing OFF, at most once
 *               in 20 s, softly (weather.js cellFlash) — lightning glowing
 *               inside the cloud, never across the screen. Far off in the
 *               "storms in the distance" phase, close in a thunderstorm.
 *   scud        small dark rags under the rain, low.
 *   stratus     the two overcast decks at the base: grey from under, sunlit
 *               white from above, so you climb through the grey and break out
 *               on top into sun (the in-cloud white-out is main.js's).
 *   cirrus      the high veil.
 *
 * Nothing pops: each puff fades in and out over a few seconds when the
 * weather changes how many there are, and fades with distance before it
 * wraps round. Tiered: Low has the fewest puffs, no rain shafts and no
 * silver lining (one texture fetch a fragment, as before); Medium the sprite
 * clusters and shafts; High and Ultra light each puff as an impostor (a
 * normal from its own shape, lit by the sun).
 */

import * as THREE from '../vendor/three.module.js';
import { cloudTexture } from '../render/textures.js';
import { makeRandom, clamp } from '../core/noise.js';
import { dim, CAPS } from '../render/flash-safety.js';
import { HEIGHT_FOG, heightFogDepth } from '../render/height-fog.js';

/** Puff kinds (the shader's vKind). */
const CU = 0;
const CB = 1;
const SCUD = 2;
const ANVIL = 3;

const vert = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec2 iScale;
  attribute float iRot;
  attribute float iAlpha;
  attribute float iShade;
  // x: the flat base's height (world metres; far below = none), y: the kind.
  attribute vec2 iKind;

  varying vec2 vUv;
  varying float vAlpha;
  varying float vFog;
  // The corner's height over the flat base (linear across the quad, so one varying).
  varying float vOverBase;
  varying vec3 vTint;
  #ifndef CLOUD_LITE
    varying vec3 vLining;
  #endif
  #ifdef CLOUD_IMPOSTOR
    varying vec3 vSunV;
  #endif

  uniform float uFogDensity;
  uniform vec3 uSunDir;
  uniform float uSunUp;
  uniform vec3 uSunTint;
  uniform vec3 uBaseTint;
  uniform float uFlash;
  uniform float uCellFlash;
  uniform float uVeil;

  void main() {
    vUv = uv;
    // A fog bank between the eye and the clouds thins them (render/height-fog.js).
    vAlpha = iAlpha * (1.0 - uVeil * 0.6);
    // modelViewMatrix, not viewMatrix: the floating origin (render/render-origin.js)
    // moves the scene and the camera together for the draw, and the puffs move with the scene.
    vec4 mv = modelViewMatrix * vec4(iOffset, 1.0);
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c) * iScale;
    mv.xy += p;
    // The corner's height in the world: the view-space offset turned back
    // (column 1 of the view matrix's rotation, as in render/height-fog.js).
    float worldY = iOffset.y + dot(viewMatrix[1].xy, p);
    vOverBase = worldY - iKind.x;
    // 0 at the puff's bottom edge, 1 at its top.
    float h = clamp((worldY - (iOffset.y - iScale.y * 0.5)) / max(1.0, iScale.y), 0.0, 1.0);
    /*
     * Everything that only varies smoothly over a puff is worked out at its
     * four corners, not at every pixel (Low's frame time is the old one's):
     * the light — sunlit tops, greyer and, in a storm cell or scud, dark
     * bases — the lightning (a strike's wash, dimmed by flash-safety, on
     * the ordinary clouds; a storm cell's tower and anvil, which can fill the
     * view, lit only from inside by uCellFlash), and the silver lining's
     * strength toward the sun.
     */
    float cb = step(0.5, iKind.y) * step(iKind.y, 1.5);
    float scud = step(1.5, iKind.y) * step(iKind.y, 2.5);
    float anvil = step(2.5, iKind.y);
    float up = clamp(h * 0.75 + iShade * 0.35, 0.0, 1.0);
    vec3 under = uBaseTint * (1.0 - 0.5 * cb * (1.0 - h) - 0.3 * scud);
    vTint = mix(under, uSunTint, smoothstep(0.1, 0.95, up) * (1.0 - 0.45 * cb * (1.0 - h)))
      + vec3(uFlash * 0.8 * (1.0 - cb - anvil)) + vec3(0.75, 0.78, 0.9) * uCellFlash * cb * (1.0 - h * 0.6);
    vec3 sunV = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
    #ifndef CLOUD_LITE
      float toward = pow(max(dot(normalize(mv.xyz), sunV), 0.0), 6.0);
      vLining = uSunTint * toward * 0.85 * uSunUp;
    #endif
    #ifdef CLOUD_IMPOSTOR
      vSunV = sunV * uSunUp;
    #endif
    float dist = -mv.z;
    vFog = clamp(max(1.0 - exp(-uFogDensity * uFogDensity * dist * dist), uVeil), 0.0, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vFog;
  varying float vOverBase;
  varying vec3 vTint;
  #ifndef CLOUD_LITE
    varying vec3 vLining;
  #endif
  #ifdef CLOUD_IMPOSTOR
    varying vec3 vSunV;
  #endif

  uniform sampler2D uMap;
  uniform vec3 uFogColor;

  void main() {
    vec4 t = texture2D(uMap, vUv);
    // A flat base: cumulus are cut off where the air stops condensing.
    float a = t.a * vAlpha * smoothstep(-4.0, 55.0, vOverBase);
    if (a < 0.01) discard;
    vec3 col = t.rgb * vTint;
    #ifndef CLOUD_LITE
      // The silver lining: the thin edges glow when you look toward the sun.
      col += vLining * (1.0 - t.a);
    #endif
    #ifdef CLOUD_IMPOSTOR
      // An impostor's light: a normal from the puff's own shape (its alpha),
      // turned toward the sun or away from it.
      vec2 g = vec2(dFdx(t.a), dFdy(t.a)) * 6.0;
      float lit = (0.6 * vSunV.z - dot(g, vSunV.xy)) * inversesqrt(dot(g, g) + 0.36);
      col *= 0.86 + 0.24 * clamp(lit, -1.0, 1.0);
    #endif
    col = mix(col, uFogColor, vFog);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

class PuffBatch {
  constructor(texture, count, defines) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;

    this.offsets = new Float32Array(count * 3);
    this.scales = new Float32Array(count * 2);
    this.rots = new Float32Array(count);
    this.alphas = new Float32Array(count);
    this.shades = new Float32Array(count);
    this.kinds = new Float32Array(count * 2);

    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(this.offsets, 3));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(this.scales, 2));
    geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(this.rots, 1));
    geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.alphas, 1));
    geo.setAttribute('iShade', new THREE.InstancedBufferAttribute(this.shades, 1));
    geo.setAttribute('iKind', new THREE.InstancedBufferAttribute(this.kinds, 2));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uSunTint: { value: new THREE.Color(0xffffff) },
        uBaseTint: { value: new THREE.Color(0x9aa8bb) },
        uFogColor: { value: new THREE.Color(0xbcd7f2) },
        uFogDensity: { value: 0.000018 },
        uFlash: { value: 0 },
        uCellFlash: { value: 0 },
        uVeil: { value: 0 },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) },
        uSunUp: { value: 1 },
      },
      defines,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.geo = geo;
    this.count = count;
  }

  markDirty() {
    this.geo.attributes.iOffset.needsUpdate = true;
    this.geo.attributes.iScale.needsUpdate = true;
    this.geo.attributes.iRot.needsUpdate = true;
    this.geo.attributes.iAlpha.needsUpdate = true;
    this.geo.attributes.iShade.needsUpdate = true;
    this.geo.attributes.iKind.needsUpdate = true;
  }
}

/*
 * Rain shafts under the storm cells: a tall quad per cell, turned about the
 * vertical to face the eye, a grey curtain thinning toward its edges and
 * the ground, streaked, fogged with the distance like the clouds.
 */
const shaftVert = /* glsl */ `
  attribute vec4 iShaft;  // x, z, base height, width
  attribute float iShaftA;
  varying vec2 vUv;
  varying float vA;
  varying float vFog;
  uniform float uFogDensity;
  void main() {
    vUv = uv;
    vA = iShaftA;
    vec3 c = (modelMatrix * vec4(iShaft.x, 0.0, iShaft.y, 1.0)).xyz;
    vec3 toCam = cameraPosition - c;
    vec3 right = normalize(vec3(toCam.z, 0.0, -toCam.x) + vec3(1e-4, 0.0, 0.0));
    vec3 wp = c + right * position.x * iShaft.w + vec3(0.0, (position.y + 0.5) * iShaft.z, 0.0);
    vec4 mv = viewMatrix * vec4(wp, 1.0);
    float dist = -mv.z;
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    gl_Position = projectionMatrix * mv;
  }
`;
const shaftFrag = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  varying float vA;
  varying float vFog;
  uniform vec3 uColor;
  uniform vec3 uFogColor;
  uniform float uTime;
  void main() {
    float edge = 1.0 - pow(abs(vUv.x * 2.0 - 1.0), 1.6);
    float streak = 0.75 + 0.25 * sin(vUv.x * 63.0 + uTime * 0.7) * sin(vUv.x * 23.0 - uTime * 0.31);
    float a = vA * edge * streak * smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.9, 1.0, vUv.y) * 0.5);
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(uColor, uFogColor, clamp(vFog, 0.0, 1.0)), a * (1.0 - vFog * 0.7));
    #include <colorspace_fragment>
  }
`;

class Shafts {
  constructor(count) {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;
    this.data = new Float32Array(count * 4);
    this.alpha = new Float32Array(count);
    geo.setAttribute('iShaft', new THREE.InstancedBufferAttribute(this.data, 4));
    geo.setAttribute('iShaftA', new THREE.InstancedBufferAttribute(this.alpha, 1));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(0x5d6673) },
        uFogColor: { value: new THREE.Color(0xbcd7f2) },
        uFogDensity: { value: 0.00002 },
        uTime: { value: 0 },
      },
      vertexShader: shaftVert,
      fragmentShader: shaftFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    this.geo = geo;
  }
}

const RANGE = 9000;

/*
 * Cloud shadows on the ground (Graphics Medium and up).
 *
 * Each puff's footprint, projected down along the sun onto sea level, is
 * splatted into a small single-channel texture centred on the aeroplane,
 * twice a second; the overcast decks add a drifting noise layer that moves
 * with the decks themselves. terrain.js samples it in its existing shader
 * patch and takes it off the SUN's light only — the sky still lights a
 * shadowed hillside, as it does outdoors.
 *
 * Shared, not per field: the terrain material is built before the clouds
 * in buildWorld, so both hold this one object. `xform` is
 * (origin x, origin z, 1 / size, strength); strength 0 switches it off.
 */
const SHADOW_N = 128;
const SHADOW_SIZE = 16000; // metres across
const SHADOW_TEXEL = SHADOW_SIZE / SHADOW_N;
export const cloudShadow = (() => {
  const data = new Uint8Array(SHADOW_N * SHADOW_N);
  const texture = new THREE.DataTexture(data, SHADOW_N, SHADOW_N, THREE.RedFormat, THREE.UnsignedByteType);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = false;
  texture.name = 'cloud-shadow';
  texture.needsUpdate = true;
  return { data, texture, xform: new THREE.Vector4(0, 0, 1 / SHADOW_SIZE, 0), size: SHADOW_SIZE, n: SHADOW_N };
})();
const _acc = new Float32Array(SHADOW_N * SHADOW_N);
const _sun = new THREE.Vector3();

/** Smooth value noise, 0..1, for the overcast decks' shadow. */
function hash2(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}

/** Storm cells: how many, how many puffs each, and how far round the eye they wrap. */
const CELL_RANGE = 26000;
// Low: one cell of seven puffs — the storm still towers on a Chromebook, at the old storm's cost.
const CELLS = { low: [1, 7], medium: [3, 14], high: [4, 18], ultra: [5, 22] };
/** How quickly a puff fades in or out when the weather changes how many there are: all the way in 8 s. */
const FADE_RATE = 0.125;

function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

const _sunDir = new THREE.Vector3();
const _white = new THREE.Color(0xffffff);
const _greyDay = new THREE.Color(0x8792a3);
const _greyNight = new THREE.Color(0x0d1420);
const _deckDay = new THREE.Color(0xa8b2bf);
const _deckNight = new THREE.Color(0x11161f);
const _deckTop = new THREE.Color();
const _shaftCol = new THREE.Color();

export class CloudField {
  constructor(scene, quality = 'high') {
    this.quality = quality;
    // Cloud shadows: Medium and up. Low never touches the texture.
    this.shadows = quality !== 'low';
    this._shadowT = Infinity;
    cloudShadow.xform.w = 0;
    /*
     * The fog these clouds fade into. main.js points it at the sky's own
     * (sky.js update(): the colour follows the view toward a low sun), so a
     * distant cloud and the sky behind it agree. Null: the preset's fog.
     */
    this.viewFog = null;
    const maxPerBatch = quality === 'low' ? 90 : quality === 'medium' ? 170 : quality === 'ultra' ? 460 : 280;
    const defines = quality === 'low' ? { CLOUD_LITE: '' } : quality === 'high' || quality === 'ultra' ? { CLOUD_IMPOSTOR: '' } : {};
    this.batches = [1, 2, 3].map((seed) => new PuffBatch(cloudTexture(seed), maxPerBatch, defines));
    this.group = new THREE.Group();
    this.group.name = 'clouds';
    for (const b of this.batches) this.group.add(b.mesh);

    // Overcast decks.
    this.decks = [];
    const deckTex = cloudTexture(2).clone();
    deckTex.needsUpdate = true;
    deckTex.wrapS = deckTex.wrapT = THREE.RepeatWrapping;
    deckTex.repeat.set(9, 9);
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: deckTex,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true,
      });
      const geo = new THREE.PlaneGeometry(26000, 26000);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, mat);
      m.renderOrder = 4;
      m.visible = false;
      this.decks.push(m);
      this.group.add(m);
    }

    // High cirrus: a thin, almost-still veil far above the cumulus. Cheap (two
    // big quads) and it gives the sky real depth.
    this.cirrus = [];
    const cirrusTex = cloudTexture(3).clone();
    cirrusTex.needsUpdate = true;
    cirrusTex.wrapS = cirrusTex.wrapT = THREE.RepeatWrapping;
    cirrusTex.repeat.set(4, 4);
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.PlaneGeometry(34000, 34000);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          map: cirrusTex,
          transparent: true,
          opacity: 0.16,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        })
      );
      m.renderOrder = 3;
      this.cirrus.push(m);
      this.group.add(m);
    }

    // Rain shafts under the storm cells (Medium and up).
    const [cellCount, cellPuffs] = CELLS[quality] || CELLS.high;
    this.cellCount = cellCount;
    this.cellPuffs = cellPuffs;
    this.shafts = quality === 'low' ? null : new Shafts(cellCount);
    if (this.shafts) this.group.add(this.shafts.mesh);

    scene.add(this.group);

    this.rnd = makeRandom(4242);
    this.puffs = [];
    this.cells = [];
    this.maxPerBatch = maxPerBatch;
    this.activeCount = 0;
    this.t = 0;
    this._first = true;
    this.seed();
  }

  /**
   * Lay out every slot once: which kind of cloud it is for the whole flight
   * (so a change of weather fades puffs in and out, never turns one into
   * another), where it starts, and its size and shape.
   */
  seed() {
    const total = this.maxPerBatch * this.batches.length;
    const cellSlots = this.cellCount * this.cellPuffs;
    const towerGroups = Math.floor((total * 0.16) / 4);
    const scudSlots = Math.floor(total * (this.quality === 'low' ? 0.05 : 0.09));
    const cuSlots = total - cellSlots - towerGroups * 4 - scudSlots;
    this.slots = { cu: cuSlots, towerGroups, scud: scudSlots, cells: this.cellCount };
    this.puffs = [];
    this.cells = [];
    for (let k = 0; k < this.cellCount; k++) {
      this.cells.push({ x: (this.rnd() - 0.5) * CELL_RANGE * 2, z: (this.rnd() - 0.5) * CELL_RANGE * 2, size: 0.85 + this.rnd() * 0.35, vis: 0 });
    }
    const add = (o) => {
      const i = this.puffs.length;
      // Round-robin over the three textures, so every kind gets all three shapes.
      this.puffs.push({
        batch: i % this.batches.length,
        index: Math.floor(i / this.batches.length),
        x: (this.rnd() - 0.5) * RANGE * 2,
        y: 0,
        z: (this.rnd() - 0.5) * RANGE * 2,
        size: 420 + this.rnd() * 900,
        rot: this.rnd() * Math.PI * 2,
        shade: this.rnd(),
        alt: this.rnd(),
        jitter: this.rnd(),
        vis: 0,
        ...o,
      });
    };
    for (let i = 0; i < cuSlots; i++) add({ kind: CU, rank: i / cuSlots });
    for (let g = 0; g < towerGroups; g++) for (let l = 0; l < 4; l++) add({ kind: CU, tower: g, level: l, rank: g / towerGroups });
    for (let i = 0; i < scudSlots; i++) add({ kind: SCUD, rank: i / scudSlots, size: 160 + this.rnd() * 300 });
    for (let k = 0; k < this.cellCount; k++) {
      const anvils = Math.max(3, Math.round(this.cellPuffs * 0.3));
      const levels = this.cellPuffs - anvils;
      for (let l = 0; l < levels; l++) add({ kind: CB, cell: k, level: l, levels, size: 1500 + this.rnd() * 700 });
      for (let a = 0; a < anvils; a++) add({ kind: ANVIL, cell: k, level: a, levels: anvils, size: 1700 + this.rnd() * 900 });
    }
    // The towers' feet: the first puff of each group stands where the group stands.
    this._towerXZ = [];
    for (let g = 0; g < towerGroups; g++) this._towerXZ.push({ x: (this.rnd() - 0.5) * RANGE * 2, z: (this.rnd() - 0.5) * RANGE * 2 });
  }

  update(dt, weather, camPos) {
    this.t += dt;
    const c = weather.cond;
    const cover = c.cloud;
    const base = c.cloudBase;
    const wind = weather.windVector();
    const p = weather.palette();
    // What the sky is made of. A sky with no types (an older caller) is all cumulus.
    const fCu = c.cu != null ? c.cu : cover;
    const fTcu = c.tcu || 0;
    const fCb = c.cb || 0;
    const fScud = c.scud || 0;
    const S = this.slots;
    // Low draws a few less of the many (a Chromebook's fill rate; Low's frame time is the old one's).
    const trim = this.quality === 'low' ? 0.8 : 1;
    const wantCu = Math.round(clamp(fCu, 0, 1) * S.cu * trim);
    const wantTowers = Math.round(clamp(fTcu, 0, 1) * S.towerGroups * trim);
    const wantCells = Math.round(clamp(fCb, 0, 1) * S.cells + (fCb > 0.15 ? 0.49 : 0));
    const wantScud = Math.round(clamp(fScud, 0, 1) * S.scud);
    // Linear, so a cloud forms over seconds rather than jumping in its first frame.
    const step = this._first ? 1 : dt * FADE_RATE;
    const ease = (v, target) => (target > v ? Math.min(target, v + step) : Math.max(target, v - step));
    this._first = false;
    const wx = wind.x * dt;
    const wz = wind.z * dt;

    // The cells drift and wrap on their own, wider ring.
    const cellTop = base + 6500;
    for (let k = 0; k < this.cells.length; k++) {
      const cell = this.cells[k];
      cell.x += wx;
      cell.z += wz;
      const dx = cell.x - camPos.x;
      const dz = cell.z - camPos.z;
      if (dx > CELL_RANGE) cell.x -= CELL_RANGE * 2;
      else if (dx < -CELL_RANGE) cell.x += CELL_RANGE * 2;
      if (dz > CELL_RANGE) cell.z -= CELL_RANGE * 2;
      else if (dz < -CELL_RANGE) cell.z += CELL_RANGE * 2;
      const edge = Math.max(Math.abs(cell.x - camPos.x), Math.abs(cell.z - camPos.z));
      cell.range = 1 - smoothstep(CELL_RANGE * 0.75, CELL_RANGE * 0.97, edge);
      cell.vis = ease(cell.vis, k < wantCells ? 1 : 0);
    }
    for (let g = 0; g < this._towerXZ.length; g++) {
      const tw = this._towerXZ[g];
      tw.x += wx;
      tw.z += wz;
      const dx = tw.x - camPos.x;
      const dz = tw.z - camPos.z;
      if (dx > RANGE) tw.x -= RANGE * 2;
      else if (dx < -RANGE) tw.x += RANGE * 2;
      if (dz > RANGE) tw.z -= RANGE * 2;
      else if (dz < -RANGE) tw.z += RANGE * 2;
    }
    // Downwind, for the anvils: they spread the way the wind at the top blows.
    const wl = Math.hypot(wind.x, wind.z) || 1;
    const ux = wind.x / wl;
    const uz = wind.z / wl;

    let active = 0;
    let inPuff = 0;
    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i];
      const b = this.batches[puff.batch];
      const j = puff.index;
      let target;
      if (puff.kind === CB || puff.kind === ANVIL) target = this.cells[puff.cell].vis;
      else if (puff.tower != null) target = puff.tower < wantTowers ? 1 : 0;
      else if (puff.kind === SCUD) target = puff.rank * S.scud < wantScud ? 1 : 0;
      else target = puff.rank * S.cu < wantCu ? 1 : 0;
      if (puff.kind !== CB && puff.kind !== ANVIL) puff.vis = ease(puff.vis, target);
      else puff.vis = target;
      if (puff.vis < 0.004 && target === 0) {
        /*
         * Parked. geo.instanceCount is the batch's full size and never moves,
         * so every parked instance is still drawn: a zero scale collapses the
         * quad to nothing, which is the one thing the rasteriser can skip
         * cheaply (alpha zero would still be filled, on a school Chromebook a
         * great many wasted screenfuls a frame).
         */
        puff.vis = 0;
        b.alphas[j] = 0;
        b.scales[j * 2] = 0;
        b.scales[j * 2 + 1] = 0;
        continue;
      }
      active++;
      const o = j * 3;
      let x;
      let y;
      let z;
      let sx;
      let sy;
      let alpha;
      let flatBase = base + puff.jitter * 35;
      let shade = puff.shade * (1 - cover * 0.55);
      let range = 1;
      if (puff.kind === CB || puff.kind === ANVIL) {
        const cell = this.cells[puff.cell];
        const s = puff.size * cell.size;
        if (puff.kind === CB) {
          // A column: wide at the foot, narrowing a little as it climbs to the anvil.
          const k = puff.level / Math.max(1, puff.levels - 1);
          sx = s * (1 - k * 0.25);
          sy = sx * 0.62;
          x = cell.x + Math.sin(puff.jitter * 40 + puff.level) * s * 0.18;
          z = cell.z + Math.cos(puff.jitter * 31 + puff.level) * s * 0.18;
          y = base + sy * 0.32 + k * (cellTop - base - sy * 0.5);
          shade = 0.2 + k * 0.8;
          alpha = 0.95;
        } else {
          const k = (puff.level + 0.5) / puff.levels;
          sx = s * 2.4;
          sy = s * 0.42;
          const along = 400 + k * 3600;
          const across = (puff.jitter - 0.5) * s * 1.2;
          x = cell.x + ux * along - uz * across;
          z = cell.z + uz * along + ux * across;
          y = cellTop + 200 + puff.jitter * 260;
          flatBase = cellTop + 60;
          shade = 0.85;
          alpha = 0.85;
        }
        range = cell.range;
      } else {
        let px;
        let pz;
        if (puff.tower != null) {
          const tw = this._towerXZ[puff.tower];
          px = tw.x + Math.sin(puff.jitter * 50) * 120;
          pz = tw.z + Math.cos(puff.jitter * 50) * 120;
        } else {
          // Drift with the wind, wrapping round the aircraft.
          puff.x += wx;
          puff.z += wz;
          const dx = puff.x - camPos.x;
          const dz = puff.z - camPos.z;
          if (dx > RANGE) puff.x -= RANGE * 2;
          else if (dx < -RANGE) puff.x += RANGE * 2;
          if (dz > RANGE) puff.z -= RANGE * 2;
          else if (dz < -RANGE) puff.z += RANGE * 2;
          px = puff.x;
          pz = puff.z;
        }
        x = px;
        z = pz;
        if (puff.kind === SCUD) {
          sx = puff.size * (1 + fScud * 0.6);
          sy = sx * 0.45;
          y = base * 0.5 + puff.alt * 90 + Math.sin(this.t * 0.2 + puff.jitter * 9) * 10;
          flatBase = -1e5;
          shade = 0.15 + puff.shade * 0.2;
          alpha = 0.7;
        } else {
          const s = puff.size * (0.7 + cover * 0.75) * (puff.tower != null ? 1.05 - puff.level * 0.12 : 1);
          sx = s;
          sy = s * 0.62;
          // Flat at the base: the puff's lowest part is below it and cut off there, so a
          // field of cumulus shares one base and differs in its tops (a tower's upper puffs climb).
          const lift = puff.tower != null ? puff.level * sy * 0.55 : puff.alt * sy * 0.12;
          y = flatBase + sy * 0.32 + lift + Math.sin(this.t * 0.12 + puff.jitter * 9) * 6;
          alpha = clamp(0.55 + cover * 0.45, 0, 1) * (0.75 + puff.jitter * 0.25);
          if (puff.tower != null) shade = 0.35 + puff.level * 0.2;
        }
        // Fade out before the wrap, so nothing appears or vanishes at the edge.
        const edge = Math.max(Math.abs(x - camPos.x), Math.abs(z - camPos.z));
        range = 1 - smoothstep(RANGE * 0.78, RANGE * 0.98, edge);
      }
      // Is the eye inside this puff (the middle two-thirds of its quad, as an ellipsoid)?
      if (puff.vis > 0.3 && range > 0.5 && puff.kind !== SCUD) {
        const rx = sx * 0.33;
        const ry = sy * 0.3;
        const qx = (camPos.x - x) / rx;
        const qy = (camPos.y - y) / ry;
        const qz = (camPos.z - z) / rx;
        const q = qx * qx + qy * qy + qz * qz;
        if (q < 1 && camPos.y > flatBase) inPuff = Math.max(inPuff, (1 - q) * puff.vis);
      }
      b.offsets[o] = x;
      b.offsets[o + 1] = y;
      b.offsets[o + 2] = z;
      b.scales[j * 2] = sx;
      b.scales[j * 2 + 1] = sy;
      b.rots[j] = puff.rot + Math.sin(this.t * 0.05 + puff.jitter * 5) * 0.05;
      if (puff.kind === ANVIL) b.rots[j] = Math.sin(puff.jitter * 7) * 0.08;
      b.alphas[j] = alpha * puff.vis * range;
      b.shades[j] = shade;
      b.kinds[j * 2] = flatBase;
      b.kinds[j * 2 + 1] = puff.kind;
    }
    this.activeCount = active;
    this.puffImmersion = clamp(inPuff * 1.6, 0, 1);

    weather.sunDirection(_sunDir);
    const sunUp = weather.isNight ? 0 : clamp(_sunDir.y * 4, 0, 1);
    const fog = this.viewFog;
    const veil = HEIGHT_FOG.x > 0 ? 1 - Math.exp(-heightFogDepth(HEIGHT_FOG.x, HEIGHT_FOG.y, camPos.y, 0.35, 20000)) : 0;
    this.veil = veil;
    const cellFlash = weather.cellFlash || 0;
    for (const b of this.batches) {
      const u = b.material.uniforms;
      u.uVeil.value = veil;
      b.markDirty();
      u.uSunTint.value.copy(p.sun).lerp(_white, 0.45);
      u.uBaseTint.value.copy(p.horizon).lerp(weather.isNight ? _greyNight : _greyDay, 0.55 + cover * 0.25);
      // Golden hour: a low sun lights the clouds' undersides warm (less so under a heavy sky).
      if (weather.time === 'sunset') u.uBaseTint.value.lerp(p.sun, 0.3 * (1 - cover * 0.6));
      u.uFogColor.value.copy(fog ? fog.color : p.fogColor);
      u.uFogDensity.value = fog ? fog.density : p.fogDensity;
      u.uFlash.value = dim(weather.lightningFlash, CAPS.lightning) * 0.7;
      u.uCellFlash.value = cellFlash;
      u.uSunDir.value.copy(_sunDir);
      u.uSunUp.value = sunUp;
    }

    // Rain shafts under the cells that are raining.
    if (this.shafts) {
      const sh = this.shafts;
      let any = false;
      const wet = clamp(Math.max(c.rain || 0, c.snow || 0, fCb * 0.6), 0, 1);
      for (let k = 0; k < this.cells.length; k++) {
        const cell = this.cells[k];
        const a = 0.42 * wet * cell.vis * cell.range;
        sh.alpha[k] = a;
        sh.data[k * 4] = cell.x;
        sh.data[k * 4 + 1] = cell.z;
        sh.data[k * 4 + 2] = a > 0.003 ? base + 40 : 0;
        sh.data[k * 4 + 3] = a > 0.003 ? 2600 * cell.size : 0;
        if (a > 0.003) any = true;
      }
      sh.mesh.visible = any;
      if (any) {
        sh.geo.attributes.iShaft.needsUpdate = true;
        sh.geo.attributes.iShaftA.needsUpdate = true;
        _shaftCol.copy(p.horizon).lerp(weather.isNight ? _greyNight : new THREE.Color(0x4e5764), 0.75);
        sh.material.uniforms.uColor.value.copy(_shaftCol);
        sh.material.uniforms.uFogColor.value.copy(fog ? fog.color : p.fogColor);
        sh.material.uniforms.uFogDensity.value = fog ? fog.density : p.fogDensity;
        sh.material.uniforms.uTime.value = this.t;
      }
    }

    // Cirrus veil, high and slow — as much as the weather has.
    const fCi = c.cirrus != null ? c.cirrus : 0.25;
    this.cirrus.forEach((ci, i) => {
      const op = (0.06 + fCi * 0.32) * (1 - cover * 0.5) * (weather.time === 'sunset' ? 1.5 : 1) * (1 - veil);
      const vis = cover < 0.85 && !weather.isNight && op > 0.01;
      ci.visible = vis;
      if (!vis) return;
      ci.material.opacity = op;
      ci.material.color.copy(p.sun).lerp(_white, 0.5);
      ci.position.set(
        camPos.x + ((wind.x * this.t * 0.12) % 3000),
        4200 + i * 900,
        camPos.z + ((wind.z * this.t * 0.12) % 3000)
      );
    });

    // Overcast decks: with heavy cover or a stratus sky. Grey from under,
    // sunlit from above — climb through and break out on top into sun.
    const deckOpacity = Math.max(clamp((cover - 0.5) * 1.5, 0, 0.82), clamp((c.stratus || 0) * 0.8 - 0.05, 0, 0.82));
    _deckTop.copy(p.sun).lerp(_white, 0.6).multiplyScalar(weather.isNight ? 0.12 : 1);
    this.decks.forEach((d, i) => {
      d.visible = deckOpacity > 0.01;
      d.material.opacity = deckOpacity * (i === 0 ? 1 : 0.55);
      const dy = base + i * 190;
      const above = smoothstep(dy - 30, dy + 90, camPos.y);
      d.material.color.copy(p.horizon).lerp(weather.isNight ? _deckNight : _deckDay, 0.6).lerp(_deckTop, above * 0.85);
      d.position.set(
        camPos.x + ((wind.x * this.t * 0.6) % 2000),
        dy,
        camPos.z + ((wind.z * this.t * 0.6) % 2000)
      );
    });

    if (this.shadows) {
      this._shadowT += dt;
      if (this._shadowT >= 0.5) {
        this._shadowT = 0;
        this.paintShadows(weather, camPos, this.puffs.length, deckOpacity);
      }
    }
  }

  /**
   * Repaint the cloud-shadow texture (see cloudShadow). Twice a second is
   * plenty: the texture is anchored in the world, not to the screen, so only
   * the clouds' own drift — a few metres a second — waits for the next one.
   */
  paintShadows(weather, camPos, wanted, deckOpacity) {
    const cs = cloudShadow;
    weather.sunDirection(_sun);
    // Only a sun well up casts a useful cloud shadow: at sunset they are
    // kilometres long and the light is all sky; at night there is no sun.
    const el = Math.asin(clamp(_sun.y, -1, 1)) * 57.2958;
    const sunK = clamp((el - 6) / 18, 0, 1);
    const strength = weather.isNight ? 0 : sunK * clamp(0.62 + weather.cond.cloud * 0.2, 0, 0.82);
    cs.xform.w = strength;
    if (strength <= 0) return;
    // Anchor to whole texels so the pattern does not crawl as the aeroplane moves.
    const ox = Math.round(camPos.x / SHADOW_TEXEL) * SHADOW_TEXEL;
    const oz = Math.round(camPos.z / SHADOW_TEXEL) * SHADOW_TEXEL;
    cs.xform.x = ox;
    cs.xform.y = oz;
    const N = SHADOW_N;
    const half = SHADOW_SIZE / 2;
    const acc = _acc;
    acc.fill(0);
    // Shadow on sea level, cast along the sun: a cloud at height y lands
    // y / tan(elevation) down-sun of where it floats.
    const k = 1 / Math.max(0.2, _sun.y);
    const sx = -_sun.x * k;
    const sz = -_sun.z * k;
    for (let i = 0; i < wanted && i < this.puffs.length; i++) {
      const puff = this.puffs[i];
      const b = this.batches[puff.batch];
      const a = b.alphas[puff.index];
      const sc = b.scales[puff.index * 2];
      if (a <= 0 || sc <= 0) continue;
      const y = b.offsets[puff.index * 3 + 1];
      const gx = b.offsets[puff.index * 3] + sx * y;
      const gz = b.offsets[puff.index * 3 + 2] + sz * y;
      // The puff texture fills roughly the middle two-thirds of its quad.
      const r = sc * 0.34;
      const cx = (gx - ox + half) / SHADOW_TEXEL;
      const cz = (gz - oz + half) / SHADOW_TEXEL;
      const rt = r / SHADOW_TEXEL;
      const x0 = Math.max(0, Math.floor(cx - rt));
      const x1 = Math.min(N - 1, Math.ceil(cx + rt));
      const z0 = Math.max(0, Math.floor(cz - rt));
      const z1 = Math.min(N - 1, Math.ceil(cz + rt));
      if (x0 > x1 || z0 > z1) continue;
      const inv = 1 / (rt * rt);
      for (let tz = z0; tz <= z1; tz++) {
        const dz = tz + 0.5 - cz;
        for (let tx = x0; tx <= x1; tx++) {
          const dx = tx + 0.5 - cx;
          const q = 1 - (dx * dx + dz * dz) * inv;
          if (q > 0) acc[tz * N + tx] += q * q * a * 1.4;
        }
      }
    }
    // The overcast decks: a soft drifting mottle, moving with the decks.
    const deck = deckOpacity > 0.01 ? deckOpacity : 0;
    const wind = weather.windVector();
    const dwx = wind.x * this.t * 0.6;
    const dwz = wind.z * this.t * 0.6;
    const data = cs.data;
    for (let tz = 0; tz < N; tz++) {
      const wz = oz - half + (tz + 0.5) * SHADOW_TEXEL;
      for (let tx = 0; tx < N; tx++) {
        const j = tz * N + tx;
        let v = 1 - Math.exp(-acc[j]);
        if (deck) {
          const wx = ox - half + (tx + 0.5) * SHADOW_TEXEL;
          const n = vnoise((wx - dwx) / 1400, (wz - dwz) / 1400) * 0.65 + vnoise((wx - dwx) / 520, (wz - dwz) / 520) * 0.35;
          v = Math.max(v, clamp((n - 0.42) * 2.2, 0, 1) * deck);
        }
        data[j] = Math.round(clamp(v, 0, 1) * 255);
      }
    }
    cs.texture.needsUpdate = true;
  }

  /** 0..1 how deep inside cloud the given altitude is — drives the whiteout. */
  cloudImmersion(alt, weather) {
    const cover = weather.cond.cloud;
    // Inside one of the puffs themselves (update() measures it): fly through a cumulus.
    const puff = this.puffImmersion || 0;
    if (cover < 0.35) return puff;
    const base = weather.cond.cloudBase;
    const thickness = 200 + cover * 420;
    const d = 1 - Math.abs(alt - (base + thickness * 0.35)) / thickness;
    /*
     * The layer: the fixed skies as they always were. The random sky's layer
     * is its stratus deck (and a sky nearly covered) — a field of separate
     * cumulus is not a white-out at its own height, only inside a puff.
     */
    const c = weather.cond;
    const layer = weather.wx && !weather._tempCond
      ? clamp(Math.max((c.stratus || 0) * 0.95, (cover - 0.6) * 2.2), 0, 1)
      : clamp((cover - 0.3) * 1.6, 0, 1);
    return Math.max(puff, clamp(d, 0, 1) * layer);
  }
}

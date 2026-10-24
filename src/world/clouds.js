/**
 * Clouds.
 *
 * Cumulus puffs are screen-aligned billboards drawn with one instanced draw
 * call per texture variant. They drift with the real wind vector and wrap
 * around the aircraft, so you can never fly out of the weather.
 *
 * When the cloud cover is high, two slowly scrolling overcast decks are added
 * at the cloud base — flying up through them genuinely goes white.
 */

import * as THREE from '../vendor/three.module.js';
import { cloudTexture } from '../render/textures.js';
import { makeRandom, clamp } from '../core/noise.js';
import { dim, CAPS } from '../render/flash-safety.js';

const vert = /* glsl */ `
  attribute vec3 iOffset;
  attribute vec2 iScale;
  attribute float iRot;
  attribute float iAlpha;
  attribute float iShade;

  varying vec2 vUv;
  varying float vAlpha;
  varying float vShade;
  varying float vFog;

  uniform float uFogDensity;

  void main() {
    vUv = uv;
    vAlpha = iAlpha;
    vShade = iShade;
    vec4 mv = viewMatrix * vec4(iOffset, 1.0);
    float c = cos(iRot);
    float s = sin(iRot);
    vec2 p = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
    mv.xy += p * iScale;
    float dist = -mv.z;
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */ `
  precision mediump float;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vShade;
  varying float vFog;

  uniform sampler2D uMap;
  uniform vec3 uSunTint;
  uniform vec3 uBaseTint;
  uniform vec3 uFogColor;
  uniform float uFlash;

  void main() {
    vec4 t = texture2D(uMap, vUv);
    if (t.a < 0.01) discard;
    vec3 col = t.rgb * mix(uBaseTint, uSunTint, vShade);
    col += uFlash * 0.8;
    col = mix(col, uFogColor, clamp(vFog, 0.0, 1.0));
    gl_FragColor = vec4(col, t.a * vAlpha);
    #include <colorspace_fragment>
  }
`;

class PuffBatch {
  constructor(texture, count) {
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

    geo.setAttribute('iOffset', new THREE.InstancedBufferAttribute(this.offsets, 3));
    geo.setAttribute('iScale', new THREE.InstancedBufferAttribute(this.scales, 2));
    geo.setAttribute('iRot', new THREE.InstancedBufferAttribute(this.rots, 1));
    geo.setAttribute('iAlpha', new THREE.InstancedBufferAttribute(this.alphas, 1));
    geo.setAttribute('iShade', new THREE.InstancedBufferAttribute(this.shades, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uSunTint: { value: new THREE.Color(0xffffff) },
        uBaseTint: { value: new THREE.Color(0x9aa8bb) },
        uFogColor: { value: new THREE.Color(0xbcd7f2) },
        uFogDensity: { value: 0.000018 },
        uFlash: { value: 0 },
      },
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

export class CloudField {
  constructor(scene, quality = 'high') {
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
    this.batches = [1, 2, 3].map((seed) => new PuffBatch(cloudTexture(seed), maxPerBatch));
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

    scene.add(this.group);

    this.rnd = makeRandom(4242);
    this.puffs = [];
    this.maxPerBatch = maxPerBatch;
    this.activeCount = 0;
    this.t = 0;
    this.seed();
  }

  seed() {
    this.puffs = [];
    for (let b = 0; b < this.batches.length; b++) {
      for (let i = 0; i < this.maxPerBatch; i++) {
        this.puffs.push({
          batch: b,
          index: i,
          x: (this.rnd() - 0.5) * RANGE * 2,
          y: 0,
          z: (this.rnd() - 0.5) * RANGE * 2,
          size: 420 + this.rnd() * 900,
          rot: this.rnd() * Math.PI * 2,
          shade: this.rnd(),
          alt: this.rnd(),
          jitter: this.rnd(),
        });
      }
    }
  }

  update(dt, weather, camPos) {
    this.t += dt;
    const cover = weather.cond.cloud;
    const base = weather.cond.cloudBase;
    const wind = weather.windVector();
    const p = weather.palette();

    // How many puffs are visible scales with the cloud cover.
    const wanted = Math.round(clamp(cover, 0.05, 1) * this.maxPerBatch * this.batches.length);
    this.activeCount = wanted;

    const perBatchActive = new Array(this.batches.length).fill(0);

    for (let i = 0; i < this.puffs.length; i++) {
      const puff = this.puffs[i];
      const active = i < wanted;
      const b = this.batches[puff.batch];
      const slot = perBatchActive[puff.batch];

      if (!active) {
        /*
         * Park unused instances (cheaper than resizing buffers), but park them
         * by collapsing the quad, not only by zeroing the alpha.
         *
         * geo.instanceCount is set once in the PuffBatch constructor, at the
         * full size of the batch, and never moves — so every parked instance is
         * still drawn. Alpha zero does not save the fill: the quad keeps
         * whatever scale it was last given, up to a couple of kilometres
         * across, and goes on being rasterised, sampled and blended every frame
         * for a result of nothing. Once the weather clears, most of the field
         * is in that state, and on a school Chromebook that is a great many
         * wasted screenfuls a frame. A zero scale collapses the quad to no area
         * at all, which is the one thing the rasteriser can skip cheaply.
         */
        b.alphas[puff.index] = 0;
        b.scales[puff.index * 2] = 0;
        b.scales[puff.index * 2 + 1] = 0;
        continue;
      }
      perBatchActive[puff.batch] = slot + 1;

      // Drift with the wind.
      puff.x += wind.x * dt * 1.0;
      puff.z += wind.z * dt * 1.0;

      // Wrap around the aircraft.
      const dx = puff.x - camPos.x;
      const dz = puff.z - camPos.z;
      if (dx > RANGE) puff.x -= RANGE * 2;
      else if (dx < -RANGE) puff.x += RANGE * 2;
      if (dz > RANGE) puff.z -= RANGE * 2;
      else if (dz < -RANGE) puff.z += RANGE * 2;

      const layerSpread = 260 + cover * 420;
      const y = base + (puff.alt - 0.35) * layerSpread + Math.sin(this.t * 0.12 + puff.jitter * 9) * 14;

      const o = puff.index * 3;
      b.offsets[o] = puff.x;
      b.offsets[o + 1] = y;
      b.offsets[o + 2] = puff.z;
      const s = puff.size * (0.7 + cover * 0.75);
      b.scales[puff.index * 2] = s;
      b.scales[puff.index * 2 + 1] = s * 0.62;
      b.rots[puff.index] = puff.rot + Math.sin(this.t * 0.05 + puff.jitter * 5) * 0.05;
      b.alphas[puff.index] = clamp(0.55 + cover * 0.45, 0, 1) * (0.75 + puff.jitter * 0.25);
      b.shades[puff.index] = puff.shade * (1 - cover * 0.55);
    }

    const fog = this.viewFog;
    for (const b of this.batches) {
      b.markDirty();
      b.material.uniforms.uSunTint.value.copy(p.sun).lerp(new THREE.Color(0xffffff), 0.45);
      b.material.uniforms.uBaseTint.value
        .copy(p.horizon)
        .lerp(new THREE.Color(weather.isNight ? 0x0d1420 : 0x8792a3), 0.55 + cover * 0.25);
      b.material.uniforms.uFogColor.value.copy(fog ? fog.color : p.fogColor);
      b.material.uniforms.uFogDensity.value = fog ? fog.density : p.fogDensity;
      b.material.uniforms.uFlash.value = dim(weather.lightningFlash, CAPS.lightning) * 0.7;
    }

    // Cirrus veil, high and slow.
    this.cirrus.forEach((c, i) => {
      const vis = cover < 0.72 && !weather.isNight;
      c.visible = vis;
      if (!vis) return;
      c.material.opacity = (0.2 - cover * 0.14) * (weather.time === 'sunset' ? 1.5 : 1);
      c.material.color.copy(p.sun).lerp(new THREE.Color(0xffffff), 0.5);
      c.position.set(
        camPos.x + ((wind.x * this.t * 0.12) % 3000),
        4200 + i * 900,
        camPos.z + ((wind.z * this.t * 0.12) % 3000)
      );
    });

    // Overcast decks appear with heavy cover.
    const deckOpacity = clamp((cover - 0.5) * 1.5, 0, 0.82);
    this.decks.forEach((d, i) => {
      d.visible = deckOpacity > 0.01;
      d.material.opacity = deckOpacity * (i === 0 ? 1 : 0.55);
      d.material.color.copy(p.horizon).lerp(new THREE.Color(weather.isNight ? 0x11161f : 0xa8b2bf), 0.6);
      d.position.set(
        camPos.x + ((wind.x * this.t * 0.6) % 2000),
        base + i * 190,
        camPos.z + ((wind.z * this.t * 0.6) % 2000)
      );
    });

    if (this.shadows) {
      this._shadowT += dt;
      if (this._shadowT >= 0.5) {
        this._shadowT = 0;
        this.paintShadows(weather, camPos, wanted, deckOpacity);
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
    if (cover < 0.35) return 0;
    const base = weather.cond.cloudBase;
    const thickness = 200 + cover * 420;
    const d = 1 - Math.abs(alt - (base + thickness * 0.35)) / thickness;
    return clamp(d, 0, 1) * clamp((cover - 0.3) * 1.6, 0, 1);
  }
}

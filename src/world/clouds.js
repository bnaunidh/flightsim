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

export class CloudField {
  constructor(scene, quality = 'high') {
    const maxPerBatch = quality === 'low' ? 90 : quality === 'medium' ? 170 : 280;
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
        // Park unused instances with zero alpha (cheaper than resizing buffers).
        b.alphas[puff.index] = 0;
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

    for (const b of this.batches) {
      b.markDirty();
      b.material.uniforms.uSunTint.value.copy(p.sun).lerp(new THREE.Color(0xffffff), 0.45);
      b.material.uniforms.uBaseTint.value
        .copy(p.horizon)
        .lerp(new THREE.Color(weather.isNight ? 0x0d1420 : 0x8792a3), 0.55 + cover * 0.25);
      b.material.uniforms.uFogColor.value.copy(p.fogColor);
      b.material.uniforms.uFogDensity.value = p.fogDensity;
      b.material.uniforms.uFlash.value = weather.lightningFlash * 0.7;
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

/**
 * Space: the planet you are leaving, drawn as a planet.
 *
 * The island world is flat, 56 km of sea round a few islands, and the
 * camera cannot see past 60 km. That is right for an aeroplane and useless
 * for a rocket: from 100 km up the whole world is a small square with an
 * edge. So above SWITCH_ALT the flat world is put away and this is shown
 * instead — a sphere the size of the planet in physics.js (600 km), lit by
 * the same sun, with the island painted onto it where it really is, a blue
 * rim of air round its edge, and the sky above gone black with the stars
 * out. The island shrinking to a speck below you, the curve of the horizon
 * and the black sky are all just what the camera sees from where the
 * physics says you are; nothing is faked except the painting.
 *
 * THE HAND-OVER
 * Below the switch the rocket is drawn in the flat world; above it, on the
 * round planet. The two disagree by s²/2R — at 5 km downrange and 15 km up
 * that is 21 m, which nobody can see from there — and the rocket's drawn
 * position is blended between them across the band either side, so it
 * never jumps. `blendFor(alt)` is that blend, and rocket.js uses it for
 * every body so they all agree with whichever world is showing.
 */

import * as THREE from '../../vendor/three.module.js';
import { PLANET } from './physics.js';

/** Above this the flat world is put away. */
export const SWITCH_ALT = 15000;
const HYST = 1200;
const BLEND_LO = 9000;
const BLEND_HI = 20000;

export function blendFor(alt) {
  const k = Math.max(0, Math.min(1, (alt - BLEND_LO) / (BLEND_HI - BLEND_LO)));
  return k * k * (3 - 2 * k);
}

const planetVert = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const planetFrag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uOcean;
  uniform vec3 uShallow;
  uniform sampler2D uIsland;
  uniform float uIslandOn;
  uniform vec2 uPad;
  uniform vec2 uCentre;
  uniform float uSize;
  uniform float uR;
  varying vec3 vLocal;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    vec3 col = uOcean;
    // A faint pattern in the sea so it reads as water and not as paint.
    float swirl = sin(vLocal.x * 0.00004 + sin(vLocal.z * 0.00003) * 3.0) * sin(vLocal.z * 0.000035 + vLocal.y * 0.00002);
    col *= 0.94 + 0.06 * swirl;
    if (uIslandOn > 0.5 && vLocal.y > 0.0) {
      // The tangent plane at the pad: near it, sphere and flat world agree.
      vec2 plane = vec2(vLocal.x, vLocal.z) * (uR / vLocal.y);
      vec2 world = uPad + plane;
      // The painting's rows run down the canvas as z grows, and a canvas
      // texture is flipped on upload, hence the minus on v.
      vec2 uv = vec2((world.x - uCentre.x) / uSize + 0.5, 0.5 - (world.y - uCentre.y) / uSize);
      if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
        vec4 land = texture2D(uIsland, uv);
        col = mix(col, land.rgb, land.a);
      }
    }
    // Clouds, scattered, so the planet is not a flat blue ball — and never
    // over the island itself, which is the thing a child is looking for.
    float c1 = sin(vLocal.x * 0.00011 + 1.3) * sin(vLocal.z * 0.00009 + vLocal.y * 0.00007);
    float c2 = sin(vLocal.x * 0.00029 - vLocal.y * 0.00021 + 2.0) * sin(vLocal.z * 0.00033 + 0.7);
    float c3 = sin(vLocal.z * 0.00071 + vLocal.x * 0.0004) * sin(vLocal.y * 0.00063 - 1.1);
    float cloud = smoothstep(0.42, 0.9, c1 * 0.55 + c2 * 0.35 + c3 * 0.2) * 0.6;
    float fromPad = vLocal.y > 0.0 ? length(vLocal.xz) : 1e9;
    cloud *= smoothstep(22000.0, 60000.0, fromPad);
    col = mix(col, vec3(0.95), cloud);
    float ndl = dot(n, uSunDir);
    float lit = 0.16 + 0.95 * clamp(ndl * 1.15 + 0.1, 0.0, 1.0);
    col *= lit;
    // Air at the edge of the planet: the thin blue line.
    float fres = pow(1.0 - clamp(dot(n, v), 0.0, 1.0), 3.0);
    col = mix(col, vec3(0.42, 0.62, 0.95) * (0.2 + 0.8 * clamp(ndl + 0.3, 0.0, 1.0)), fres * 0.55);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const airVert = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const airFrag = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uFade;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 n = normalize(vNormalW);
    vec3 v = normalize(cameraPosition - vWorld);
    float d = clamp(dot(n, v), 0.0, 1.0);
    float glow = pow(1.0 - d, 5.0) * 2.2;
    float sun = 0.2 + 0.8 * clamp(dot(n, uSunDir) + 0.35, 0.0, 1.0);
    float a = glow * sun * uFade;
    gl_FragColor = vec4(vec3(0.38, 0.62, 1.0) * a, a);
  }
`;

/**
 * Paint the islands from the height field, a few rows a frame. From 15 km
 * up a pixel of this is about one pixel of screen; it only has to be the
 * right shape and the right colours.
 */
export class IslandPainter {
  constructor(kit, { heightAt, islands, palette, size = 640 }) {
    this.heightAt = heightAt;
    this.size = size;
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const I of islands || []) {
      x0 = Math.min(x0, I.cx - I.radius * 1.5);
      x1 = Math.max(x1, I.cx + I.radius * 1.5);
      z0 = Math.min(z0, I.cz - I.radius * 1.5);
      z1 = Math.max(z1, I.cz + I.radius * 1.5);
    }
    if (!isFinite(x0)) { x0 = z0 = -10000; x1 = z1 = 10000; }
    this.span = Math.max(x1 - x0, z1 - z0) + 2000;
    this.cx = (x0 + x1) / 2;
    this.cz = (z0 + z1) / 2;
    const pal = palette || {};
    const tint = (base, t) => (t ? [base[0] * t[0], base[1] * t[1], base[2] * t[2]] : base);
    this.grass = tint([0.36, 0.55, 0.27], pal.grass);
    this.sand = tint([0.85, 0.78, 0.58], pal.sand);
    this.rock = tint([0.55, 0.52, 0.47], pal.rock);
    this.shallow = pal.shallow || [0.31, 0.84, 0.78];
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = size;
    this.ctx = this.canvas.getContext('2d');
    this.img = this.ctx.createImageData(size, size);
    this.row = 0;
    this.texture = kit.tex(new THREE.CanvasTexture(this.canvas));
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.done = false;
  }

  /** Paint up to `rows` more rows. True once the picture is finished. */
  step(rows = 24) {
    if (this.done) return true;
    const N = this.size;
    const d = this.img.data;
    const cell = this.span / N;
    const end = Math.min(N, this.row + rows);
    for (let j = this.row; j < end; j++) {
      const z = this.cz - this.span / 2 + (j + 0.5) * cell;
      for (let i = 0; i < N; i++) {
        const x = this.cx - this.span / 2 + (i + 0.5) * cell;
        const h = this.heightAt(x, z);
        const o = (j * N + i) * 4;
        let r;
        let g;
        let b;
        let a;
        if (h <= 0) {
          // Shallow water shows turquoise over sand; deep water is the sea.
          const k = Math.max(0, 1 + h / 18);
          r = this.shallow[0];
          g = this.shallow[1];
          b = this.shallow[2];
          a = k * 0.8;
        } else {
          const hx = this.heightAt(x + cell, z) - h;
          const shade = Math.max(0.62, Math.min(1.15, 1 - hx / (cell * 0.9)));
          let c = h < 3.5 ? this.sand : h > 260 ? this.rock : this.grass;
          if (h > 120 && h <= 260) {
            const t = (h - 120) / 140;
            c = [c[0] + (this.rock[0] - c[0]) * t, c[1] + (this.rock[1] - c[1]) * t, c[2] + (this.rock[2] - c[2]) * t];
          }
          if (h > 520) c = [0.93, 0.95, 0.97];
          r = c[0] * shade;
          g = c[1] * shade;
          b = c[2] * shade;
          a = 1;
        }
        d[o] = Math.min(255, r * 255);
        d[o + 1] = Math.min(255, g * 255);
        d[o + 2] = Math.min(255, b * 255);
        d[o + 3] = a * 255;
      }
    }
    this.row = end;
    if (this.row >= N) {
      this.ctx.putImageData(this.img, 0, 0);
      this.texture.needsUpdate = true;
      this.done = true;
    }
    return this.done;
  }
}

/**
 * The planet, its air, and the switch between it and the flat world.
 */
export class SpaceView {
  constructor(kit, { pad, painter, oceanColor }) {
    this.pad = pad;
    this.painter = painter;
    this.group = new THREE.Group();
    this.group.name = 'rocket:space';
    const R = PLANET.R;
    const pgeo = kit.geo(new THREE.SphereGeometry(R, 128, 80));
    this.planetMat = new THREE.ShaderMaterial({
      uniforms: {
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
        uOcean: { value: new THREE.Color(oceanColor || 0x1b4f7c) },
        uShallow: { value: new THREE.Color(0x4fd6c7) },
        uIsland: { value: painter.texture },
        uIslandOn: { value: 0 },
        uPad: { value: new THREE.Vector2(pad.x, pad.z) },
        uCentre: { value: new THREE.Vector2(painter.cx, painter.cz) },
        uSize: { value: painter.span },
        uR: { value: R },
      },
      vertexShader: planetVert,
      fragmentShader: planetFrag,
    });
    kit.mats.push(this.planetMat);
    this.planet = new THREE.Mesh(pgeo, this.planetMat);
    this.planet.frustumCulled = false;
    this.planet.renderOrder = -500;
    this.group.add(this.planet);

    const ageo = kit.geo(new THREE.SphereGeometry(R + 60000, 96, 64));
    this.airMat = new THREE.ShaderMaterial({
      uniforms: { uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) }, uFade: { value: 0 } },
      vertexShader: airVert,
      fragmentShader: airFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    kit.mats.push(this.airMat);
    this.air = new THREE.Mesh(ageo, this.airMat);
    this.air.frustumCulled = false;
    this.air.renderOrder = -400;
    this.group.add(this.air);

    this.active = false;
    this.hidden = new Map();
  }

  /**
   * Show or hide the planet. In the flat world it still stands in below
   * the sea as a backdrop past the sea's edge, 150 m down so the two never
   * fight over the same pixels.
   */
  place(spaceMode, camAlt, sunDir) {
    const R = PLANET.R;
    this.planet.position.set(this.pad.x, -R - (spaceMode ? 0 : 150), this.pad.z);
    this.air.position.copy(this.planet.position);
    this.planet.visible = spaceMode || camAlt > 3000;
    this.air.visible = spaceMode;
    this.planetMat.uniforms.uIslandOn.value = spaceMode && this.painter.done ? 1 : 0;
    this.planetMat.uniforms.uSunDir.value.copy(sunDir);
    this.airMat.uniforms.uSunDir.value.copy(sunDir);
    this.airMat.uniforms.uFade.value = Math.max(0, Math.min(1, (camAlt - 25000) / 40000));
  }

  /**
   * Put the flat world away (or back). Everything the scene holds that is
   * not ours, not a light and not the sky dome is hidden, and exactly what
   * was visible before is shown again afterwards — a hidden thing is
   * remembered as hidden and stays so.
   */
  setWorldHidden(sim, keep, hide) {
    if (hide === this.active) return;
    this.active = hide;
    if (hide) {
      this.hidden.clear();
      for (const o of sim.scene.children) {
        if (keep.has(o) || o.isLight || (sim.sky && o === sim.sky.mesh)) continue;
        if (!o.visible) continue;
        this.hidden.set(o, true);
        o.visible = false;
      }
    } else {
      for (const o of this.hidden.keys()) o.visible = true;
      this.hidden.clear();
    }
  }

  /** Should the world be hidden at this height? With a little hysteresis. */
  wantSpace(camAlt) {
    return this.active ? camAlt > SWITCH_ALT - HYST : camAlt > SWITCH_ALT + HYST;
  }
}

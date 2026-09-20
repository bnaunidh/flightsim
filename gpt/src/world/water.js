/**
 * Ocean.
 *
 * Two stacked planes with scrolling procedural normal maps give convincing
 * wave motion for almost no cost, and a foam band traced along each island's
 * real coastline (found by searching the terrain height function for the
 * zero-elevation contour) sells the shoreline.
 */

import * as THREE from '../vendor/three.module.js';
import { waterNormal, foamTexture } from '../render/textures.js';
import { heightAt, ISLANDS, PALETTE } from './terrain.js';

/**
 * Sea plane size. Deliberately inside the camera's 60 km far plane even at the
 * corners (39.6 km), so the ocean is never sliced by the far clip.
 */
const SEA_SIZE = 56000;
/**
 * The sea follows the aeroplane in whole steps. Both wave layers tile an exact
 * whole number of times per step, so the pattern is continuous across a jump
 * and the surface does not visibly snap as you fly.
 */
const FOLLOW_STEP = 2000;
const TILE_A = 250; // metres per wave tile, coarse layer
const TILE_B = 500; // metres per wave tile, fine layer

export class Ocean {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'ocean';

    const nrm1 = waterNormal().clone();
    nrm1.needsUpdate = true;
    nrm1.wrapS = nrm1.wrapT = THREE.RepeatWrapping;
    // Big tiles and a different scale per layer: the ocean fills most of the
    // screen, so any visible repeat is glaring. Both repeats divide the follow
    // step exactly (see FOLLOW_STEP).
    nrm1.repeat.set(SEA_SIZE / TILE_A, SEA_SIZE / TILE_A);
    const nrm2 = waterNormal().clone();
    nrm2.needsUpdate = true;
    nrm2.wrapS = nrm2.wrapT = THREE.RepeatWrapping;
    // Mirrored rather than rotated. A rotation would look good but would break
    // the whole-tile follow step, and a lurching sea is far worse than a
    // slightly less varied one.
    nrm2.repeat.set(-SEA_SIZE / TILE_B, SEA_SIZE / TILE_B);
    nrm2.offset.set(0.31, 0.57);

    // Water is a dielectric: metalness stays at zero. Treating it as
    // half-metal turns the surface into a tinted mirror that ignores its own
    // colour, blows out to white wherever the sky is bright, and leaves
    // nothing on screen at all if the environment map ever hiccups.
    // Colours come from the map: turquoise round the atoll, near-black off the
    // fjords, slate grey under the volcano.
    this.pal = PALETTE;
    this.deepMat = new THREE.MeshStandardMaterial({
      color: this.pal.deepWater,
      roughness: 0.14,
      metalness: 0,
      normalMap: nrm1,
      normalScale: new THREE.Vector2(0.5, 0.5),
      envMapIntensity: 1.0,
    });
    // A few segments rather than a single quad. Two triangles spanning tens of
    // kilometres give the rasteriser absurd screen-space derivatives near the
    // horizon, which is where the shading used to fall apart.
    const deep = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 24, 24), this.deepMat);
    deep.rotation.x = -Math.PI / 2;
    deep.receiveShadow = false;
    this.group.add(deep);
    this.deep = deep;

    this.swellMat = new THREE.MeshStandardMaterial({
      color: this.pal.swell,
      roughness: 0.1,
      metalness: 0,
      envMapIntensity: 1.1,
      normalMap: nrm2,
      normalScale: new THREE.Vector2(0.85, 0.85),
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    // Same size as the deep layer. When it was smaller there was a hard ring
    // 20 km out where the sea abruptly changed colour.
    const swell = new THREE.Mesh(new THREE.PlaneGeometry(SEA_SIZE, SEA_SIZE, 24, 24), this.swellMat);
    swell.rotation.x = -Math.PI / 2;
    swell.position.y = 0.08;
    this.group.add(swell);
    this.swell = swell;

    this.nrm1 = nrm1;
    this.nrm2 = nrm2;
    this.t = 0;

    this.foamMats = [];
    this.shallowMats = [];
    for (const isl of ISLANDS) {
      // Shallows first (wider, underneath), then the foam line on top.
      this.group.add(this.buildShallows(isl));
      this.group.add(this.buildFoam(isl));
    }

    scene.add(this.group);
  }

  /**
   * Trace the coastline once and return inner/outer rings offset from it.
   * Used for both the foam line and the shallow lagoon band.
   */
  traceCoast(isl, innerOffset, outerOffset, innerY = 0.5, outerY = 0.35, SEG = 128) {
    const inner = [];
    const outer = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      let lo = isl.radius * 0.2;
      let hi = isl.radius * 1.9;
      for (let k = 0; k < 22; k++) {
        const mid = (lo + hi) / 2;
        if (heightAt(isl.cx + dx * mid, isl.cz + dz * mid) > 0) lo = mid;
        else hi = mid;
      }
      const r = (lo + hi) / 2;
      inner.push([isl.cx + dx * (r + innerOffset), isl.cz + dz * (r + innerOffset)]);
      outer.push([isl.cx + dx * (r + outerOffset), isl.cz + dz * (r + outerOffset)]);
    }
    const verts = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      verts.push(inner[i][0], innerY, inner[i][1]);
      verts.push(outer[i][0], outerY, outer[i][1]);
      const u = (i / SEG) * 26;
      uvs.push(u, 0, u, 1);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    return geo;
  }

  /**
   * Shallow water: a wide turquoise band hugging each coast, fading out to deep
   * blue. Real islands have this reef shelf and it is the single biggest thing
   * that makes tropical water look tropical.
   */
  buildShallows(isl) {
    const geo = this.traceCoast(isl, -30, 260, 0.24, 0.2, 96);
    // Fade to transparent on the seaward edge using vertex alpha via UV.v.
    const mat = new THREE.MeshBasicMaterial({
      color: 0x4fd6c8,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    mat.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <alphatest_fragment>',
        `#include <alphatest_fragment>
         // vUv.y runs 0 at the shore to 1 out to sea.
         float shelf = 1.0 - smoothstep(0.0, 0.85, vMapUv.y);
         diffuseColor.a *= shelf;
         diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.45, 0.62), vMapUv.y * 0.8);`
      );
    };
    // The replacement above needs a map for vMapUv to exist.
    mat.map = foamTexture();
    mat.map.needsUpdate = true;
    this.shallowMats.push(mat);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    return mesh;
  }

  /** Trace the coastline and build a translucent foam band along it. */
  buildFoam(isl) {
    const SEG = 128;
    const inner = [];
    const outer = [];
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const dx = Math.cos(a);
      const dz = Math.sin(a);
      // Bisect for the radius where terrain crosses sea level.
      let lo = isl.radius * 0.2;
      let hi = isl.radius * 1.9;
      for (let k = 0; k < 22; k++) {
        const mid = (lo + hi) / 2;
        const h = heightAt(isl.cx + dx * mid, isl.cz + dz * mid);
        if (h > 0) lo = mid;
        else hi = mid;
      }
      const r = (lo + hi) / 2;
      inner.push([isl.cx + dx * (r - 26), isl.cz + dz * (r - 26)]);
      outer.push([isl.cx + dx * (r + 34), isl.cz + dz * (r + 34)]);
    }

    const verts = [];
    const uvs = [];
    const idx = [];
    for (let i = 0; i <= SEG; i++) {
      verts.push(inner[i][0], 0.5, inner[i][1]);
      verts.push(outer[i][0], 0.35, outer[i][1]);
      const u = (i / SEG) * 26;
      uvs.push(u, 0, u, 1);
    }
    for (let i = 0; i < SEG; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();

    const tex = foamTexture().clone();
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.foamMats.push({ mat, tex });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    return mesh;
  }

  /** Keep the ocean centred under the aircraft so it never runs out. */
  follow(pos) {
    this.deep.position.x = Math.round(pos.x / FOLLOW_STEP) * FOLLOW_STEP;
    this.deep.position.z = Math.round(pos.z / FOLLOW_STEP) * FOLLOW_STEP;
    this.swell.position.x = this.deep.position.x;
    this.swell.position.z = this.deep.position.z;
  }

  /** Release every GPU resource this ocean owns. */
  dispose() {
    this.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        for (const key of ['map', 'normalMap']) {
          if (o.material[key]) o.material[key].dispose();
        }
        o.material.dispose();
      }
    });
    if (this.group.parent) this.group.parent.remove(this.group);
  }

  update(dt, weather) {
    this.t += dt;
    const windScale = 0.4 + weather.windSpeedKts / 26;
    this.nrm1.offset.x = (this.t * 0.0035 * windScale) % 1;
    this.nrm1.offset.y = (this.t * 0.0021 * windScale) % 1;
    this.nrm2.offset.x = (-this.t * 0.008 * windScale) % 1;
    this.nrm2.offset.y = (this.t * 0.0052 * windScale) % 1;

    const chop = 0.42 + weather.cond.turb * 0.75;
    this.deepMat.normalScale.set(chop, chop);
    this.swellMat.normalScale.set(chop * 1.5, chop * 1.5);

    // Water colour follows the sky.
    const p = weather.palette();
    const base = new THREE.Color(this.pal.deepWater);
    const deepBase = weather.isNight
      ? base.clone().multiplyScalar(0.22)
      : weather.time === 'sunset'
        ? base.clone().lerp(new THREE.Color(0x3a3550), 0.35)
        : base;
    this.deepMat.color.copy(deepBase).lerp(p.horizon, 0.18 + weather.cond.cloud * 0.22);
    this.swellMat.color.copy(p.horizon).lerp(new THREE.Color(this.pal.swell), 0.45);
    this.swellMat.opacity = 0.3 + weather.cond.cloud * 0.2;

    const sh = this.pal.shallow;
    for (const m of this.shallowMats) {
      const night = weather.isNight ? 0.35 : 1;
      m.color.setRGB(sh[0] * night, sh[1] * night, sh[2] * night);
      m.opacity = (0.46 - weather.cond.cloud * 0.16) * night;
    }
    for (const f of this.foamMats) {
      f.tex.offset.y = (this.t * 0.06) % 1;
      f.mat.opacity = 0.45 + 0.25 * Math.sin(this.t * 1.3) + weather.cond.turb * 0.25;
    }
  }
}

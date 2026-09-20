/**
 * Broken water.
 *
 * The one thing the boat maps need that nothing else in the world draws.
 *
 * The ocean is an opaque plane at sea level, so a rock with a metre of water
 * over it is completely invisible from the helm — the first a ten-year-old
 * knows about it is the bang, and a hazard you cannot see and were not warned
 * about is not a challenge, it is an ambush. The chart answers for the deep
 * ones; the shallow ones get the white water that a real shoal makes, and that
 * split is the difficulty gradient: what you can see, and what you have to
 * have read before you left.
 *
 * One merged geometry, one material, one draw call, no new textures — the foam
 * texture is the one the surf line already uses and it is already in the
 * cache. A ring of foam rather than a filled disc, because water breaks where
 * the bottom comes up, not over the middle of the patch.
 */

import * as THREE from '../vendor/three.module.js';
import { MAP, dryingShoals } from './terrain.js';
import { foamTexture } from '../render/textures.js';

export class SeaMarks {
  constructor(scene, quality = 'high') {
    this.group = new THREE.Group();
    this.group.name = 'seamarks';
    this.t = 0;
    this.mat = null;

    const shoals = MAP.waters ? dryingShoals() : [];
    if (!shoals.length) {
      scene.add(this.group);
      return;
    }

    // How many segments round each ring. Low quality still has to be legible —
    // this is a safety marking, not decoration, so it degrades in smoothness
    // and never in presence.
    const seg = quality === 'low' ? 16 : quality === 'medium' ? 24 : 32;

    const pos = [];
    const uv = [];
    const col = [];
    const idx = [];
    let base = 0;

    for (const s of shoals) {
      /*
       * Where the break is. Water trips over the edge of the shoal rather
       * than the top of it, so the band sits between about half and nine
       * tenths of the radius. A rock that stands well clear gets its ring
       * pushed out and brightened — a stack with the sea piling against it is
       * the most visible thing on the map and it should be.
       */
      const dry = s.top > 0;
      const rIn = s.r * (dry ? 0.5 : 0.42);
      const rMid = s.r * (dry ? 0.78 : 0.66);
      const rOut = s.r * (dry ? 1.04 : 0.92);
      // Brightest over the shallowest water, fading out as the cover deepens.
      const strength = Math.max(0.15, Math.min(1, 1 - (-s.top) / 1.8)) * (dry ? 1 : 0.8);

      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // A little wobble so the rings are not three perfect circles, taken
        // off the shoal's own coordinates so it is the same every session.
        const wob = 1 + Math.sin(a * 3 + s.cx * 0.01) * 0.07 + Math.sin(a * 5 + s.cz * 0.013) * 0.05;
        for (const [r, v, bright] of [
          [rIn * wob, 0, 0],
          [rMid * wob, 0.5, strength],
          [rOut * wob, 1, 0],
        ]) {
          pos.push(s.cx + ca * r, 0.32, s.cz + sa * r);
          uv.push((i / seg) * 6, v);
          col.push(bright, bright, bright);
        }
      }
      for (let i = 0; i < seg; i++) {
        const a0 = base + i * 3;
        const a1 = base + (i + 1) * 3;
        // inner → mid, then mid → outer: two quads a segment.
        idx.push(a0, a1, a0 + 1, a1, a1 + 1, a0 + 1);
        idx.push(a0 + 1, a1 + 1, a0 + 2, a1 + 1, a1 + 2, a0 + 2);
      }
      base += (seg + 1) * 3;
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);

    const tex = foamTexture();
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.mat = new THREE.MeshBasicMaterial({
      map: tex,
      vertexColors: true,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: true,
    });

    const mesh = new THREE.Mesh(geo, this.mat);
    mesh.name = 'brokenWater';
    // After the sea and its surf, which are renderOrder 1 and 2.
    mesh.renderOrder = 4;
    this.group.add(mesh);
    scene.add(this.group);
  }

  /**
   * The sea breaks harder in a sea.
   *
   * Two scrolls at different rates, which is the same trick the ocean uses and
   * for the same reason — one scrolling texture reads as a sliding picture and
   * two read as moving water. Every shoal on the map pulses together, which
   * would be obvious from three thousand feet and is invisible from a boat,
   * because from a boat you can see one of them at a time.
   */
  update(dt, weather) {
    if (!this.mat) return;
    this.t += dt;
    const sea = weather && weather.cond ? weather.cond.turb || 0 : 0;
    const tex = this.mat.map;
    tex.offset.x = (tex.offset.x + dt * 0.035) % 1;
    tex.offset.y = (tex.offset.y + dt * 0.012) % 1;
    this.mat.opacity =
      0.46 + sea * 0.3 + Math.sin(this.t * 0.9) * 0.09 + Math.sin(this.t * 1.63) * 0.05;
  }
}

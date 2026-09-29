/**
 * The height of the ground AS DRAWN, which is not heightAt().
 *
 * heightAt() is the true analytic surface. The terrain mesh samples it every
 * 39 m on Kestrel (every 71 m at Low quality) and draws flat triangles in
 * between, so on a hillside the picture can sit several metres above or
 * below the function. Anything laid ON the ground has to follow the picture:
 * a flame planted at heightAt() on a convex slope is buried to the waist, and
 * a scorch mark is simply invisible under the triangle above it.
 *
 * So this reads the vertex heights straight out of the terrain chunk that is
 * on screen and interpolates the same triangle the GPU does. PlaneGeometry
 * splits each quad a-b-d / b-c-d (three.js PlaneGeometry.js), so for the
 * fractional position (fx, fz) inside a quad the lower-left triangle is
 * fx + fz <= 1. No height function is evaluated at all, which is also why it
 * is cheap enough to call a few hundred times a frame.
 *
 * Falls back to heightAt() anywhere no chunk covers (and in node, where there
 * is no mesh).
 */

import { heightAt } from '../../world/terrain.js';

export class Surface {
  constructor() {
    this.chunks = [];
  }

  /** Re-read the chunks from the terrain group the game built. */
  bind(terrainGroup) {
    this.chunks.length = 0;
    if (!terrainGroup || !terrainGroup.children) return this;
    for (const m of terrainGroup.children) {
      const g = m && m.geometry;
      const p = g && g.parameters;
      const pos = g && g.attributes && g.attributes.position;
      if (!p || !pos || !p.widthSegments) continue;
      const seg = p.widthSegments;
      this.chunks.push({
        mesh: m,
        cx: m.position.x,
        cz: m.position.z,
        size: p.width,
        seg,
        step: p.width / seg,
        w: seg + 1,
        arr: pos.array,
        x0: m.position.x - p.width / 2,
        z0: m.position.z - p.height / 2,
      });
    }
    // Finest first, so where two chunks overlap the detailed one answers.
    this.chunks.sort((a, b) => a.step - b.step);
    return this;
  }

  chunkAt(x, z) {
    for (const c of this.chunks) {
      const fx = (x - c.x0) / c.step;
      const fz = (z - c.z0) / c.step;
      if (fx >= 0 && fz >= 0 && fx < c.seg && fz < c.seg) return c;
    }
    return null;
  }

  /** Rendered ground height at (x, z), metres. */
  y(x, z) {
    const c = this.chunkAt(x, z);
    if (!c) return heightAt(x, z);
    const gx = (x - c.x0) / c.step;
    const gz = (z - c.z0) / c.step;
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const w = c.w;
    const a = c.arr;
    // Vertex (ix, iz) is at index iz * w + ix; y is component 1.
    const ha = a[(iz * w + ix) * 3 + 1];
    const hb = a[((iz + 1) * w + ix) * 3 + 1];
    const hc = a[((iz + 1) * w + ix + 1) * 3 + 1];
    const hd = a[(iz * w + ix + 1) * 3 + 1];
    if (fx + fz <= 1) return ha + (hd - ha) * fx + (hb - ha) * fz;
    return hc + (hb - hc) * (1 - fx) + (hd - hc) * (1 - fz);
  }

  /** Water surface or drawn ground, whichever is higher — where water lands. */
  top(x, z) {
    const g = this.y(x, z);
    return g > 0 ? g : 0;
  }
}

/**
 * World Map — Preview: the road network's structures — the bridges' decks,
 * parapets and piers, and the roundabouts' central islands. The tarmac
 * itself is roads.js's (roadRibbon draws every road in MAP.waters.roads,
 * the highway's carriageways and the rings among them); this is what stands
 * under and beside it.
 *
 * One Batch (one draw call), in a group at the middle of what it draws so no
 * vertex is far from its own origin (render/render-origin.js).
 */
import * as THREE from '../../vendor/three.module.js';
import { Batch, vcMaterial } from '../airport-kit.js';

const CONCRETE = 0xb3b0a8;
const DARK = 0x6d6b66;
const GRASS = 0x5b7d3a;

/**
 * @param {object[]} bridges  MAP.bridges ({ ax, az, bx, bz, y, halfWidth })
 * @param {object[]} rings    the ring roads' { x, z, r } (road.ring)
 * @param {Function} ground   terrain.js groundHeightAt (the river bed, not the deck)
 */
export function buildNetworkLook(bridges = [], rings = [], ground = () => 0) {
  if (!bridges.length && !rings.length) return null;
  const all = [...bridges.map((b) => [(b.ax + b.bx) / 2, (b.az + b.bz) / 2]), ...rings.map((g) => [g.x, g.z])];
  const ox = all.reduce((s, p) => s + p[0], 0) / all.length;
  const oz = all.reduce((s, p) => s + p[1], 0) / all.length;
  const b = new Batch();
  for (const br of bridges) {
    const dx = br.bx - br.ax;
    const dz = br.bz - br.az;
    const L = Math.hypot(dx, dz);
    if (L < 1) continue;
    const ry = Math.atan2(-dz, dx);
    const cx = (br.ax + br.bx) / 2 - ox;
    const cz = (br.az + br.bz) / 2 - oz;
    const W = br.halfWidth * 2;
    // The deck: a slab under the road, its edge beams, and the parapets.
    b.box(L, 1.4, W, cx, br.y - 0.85, cz, CONCRETE, ry);
    b.box(L, 0.9, W + 0.6, cx, br.y - 2, cz, DARK, ry);
    const nx = -dz / L;
    const nz = dx / L;
    for (const side of [-1, 1]) b.box(L, 1.0, 0.35, cx + nx * side * (br.halfWidth + 0.1), br.y + 0.45, cz + nz * side * (br.halfWidth + 0.1), CONCRETE, ry);
    // Piers every 35-45 m between the ends, down to the bed; and the abutments.
    const n = Math.max(1, Math.round(L / 40));
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const px = br.ax + dx * t;
      const pz = br.az + dz * t;
      const g = Math.min(br.y - 2.5, ground(px, pz));
      const h = br.y - 2.4 - g;
      if (h > 0.5) b.box(2.2, h, W * 0.7, px - ox, g + h / 2, pz - oz, CONCRETE, ry);
    }
    for (const t of [0, 1]) {
      const px = br.ax + dx * t;
      const pz = br.az + dz * t;
      const g = ground(px, pz);
      const h = br.y - 1.2 - g;
      if (h > 0.3) b.box(4, h, W + 2, px - ox, g + h / 2, pz - oz, DARK, ry);
    }
  }
  for (const g of rings) {
    // The island in the middle: a kerbed grass circle with a low planted mound.
    const y = ground(g.x, g.z);
    const r = Math.max(6, g.r - 9);
    b.cyl(r, r, 0.45, g.x - ox, y, g.z - oz, 0xcfccc4, 28);
    b.cyl(r - 0.6, r - 0.6, 0.55, g.x - ox, y, g.z - oz, GRASS, 28);
    b.cyl(r * 0.35, r * 0.6, 1.4, g.x - ox, y + 0.5, g.z - oz, 0x4f6f33, 16);
  }
  const mesh = b.mesh(vcMaterial({ roughness: 0.9 }), { cast: true, receive: true, name: 'world-network' });
  if (!mesh) return null;
  const grp = new THREE.Group();
  grp.name = 'world-network';
  grp.position.set(ox, 0, oz);
  grp.add(mesh);
  grp.userData.bridges = bridges.length;
  grp.userData.rings = rings.length;
  return grp;
}

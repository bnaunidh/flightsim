/**
 * A town's blocks at street level (Medium and up; loaded on demand by scenery.js addTown).
 *
 * addTown's blocks are walls of windows from the pavement to the roof: right
 * from the air, bare from the street. This puts on their street fronts what a
 * street has:
 *
 *   shopfronts  on most blocks' ground floors: a painted surround to each bay,
 *               plate glass with a stall riser under it, a fascia board over it
 *               (no lettering: nothing here is a real shop), and over many an
 *               awning, plain or striped; two in three windows lit after dark
 *   a string course round the building over the ground floor
 *   balconies   (High and Ultra) up some blocks' fronts: a slab and a rail
 *               at alternate bays, storey over storey
 *
 * TWO DRAW CALLS A TOWN (everything painted, and the lit glass), in a LOD that
 * drops both once the town is too far for any of it to be a pixel. Nothing
 * here is solid, nothing moves, nothing is done per frame.
 */
import * as THREE from '../vendor/three.module.js';
import { Batch } from './airport-kit.js';
import { heightAt } from './terrain.js';

const SHOP = [0x2f4a3a, 0x6e2a2e, 0x1f2f4a, 0x2a2c30, 0xe6dfcf, 0x7a5a3a, 0x3a5a6a, 0x8a8f96];
const AWNING = [0xb5372c, 0x2f5f4a, 0x1f3f6a, 0xd9a02e, 0xe8e2d0, 0x7a2f4a, 0x3a3f46, 0xc86a2a];
const RAIL = [0x2a2c30, 0xf0eee8, 0x5a6068, 0x86979e];
const CREAM = 0xf1ecdf;
const GLASS = 0x26333f;

/** Metres past a town's own edge that its street dressing is still drawn. */
export const DRESS_FAR = 650;

/** How many balconies one block may have, by tier (1 Medium, 2 High, 3 Ultra). */
export const BALCONY_CAP = Object.freeze([0, 0, 10, 18]);

/**
 * Dress `plan`'s blocks (addTown's own list: { s: { x, y, z, rot, front }, kind, w, d }) into `group`.
 * `top(b)`: the head of b's walls. `nightMats`: the town's list of materials that light after dark.
 * `ground`: (x, z) => y. Returns what was built ({ blocks, shops, awnings, balconies, triangles, lod }).
 */
export function dressBlocks(group, plan, { quality = 'high', name = 'town', top, nightMats = null, ground = heightAt } = {}) {
  const tier = quality === 'ultra' ? 3 : quality === 'high' ? 2 : quality === 'medium' ? 1 : 0;
  const facts = { blocks: 0, shops: 0, awnings: 0, balconies: 0, triangles: 0, lod: null };
  if (!tier || !plan || !top) return facts;
  const trim = new Batch();
  const lit = new Batch();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  const _a = new THREE.Vector3();
  const _b = new THREE.Vector3();
  /** A quad that faces `want`, whichever way its corners were given. */
  const quad = (batch, a, b, c, d, colour, want) => {
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(c[0] - a[0], c[1] - a[1], c[2] - a[2]);
    _a.cross(_b);
    if (_a.x * want[0] + _a.y * want[1] + _a.z * want[2] >= 0) batch.quad(a, b, c, d, [0, 0, 1, 1], colour);
    else batch.quad(b, a, d, c, [0, 0, 1, 1], colour);
  };
  plan.forEach((b, bi) => {
    if (b.kind !== 'block') return;
    const { s } = b;
    const cr = Math.cos(s.rot);
    const sr = Math.sin(s.rot);
    const sgn = (s.front || 1) > 0 ? 1 : -1;
    const hw = b.w / 2;
    const hd = b.d / 2;
    const P = (lx, lz, y) => [s.x + cr * lx + sr * lz, y, s.z - sr * lx + cr * lz];
    /** The front wall: t from its left end to its right as seen from the street, `out` metres off it. */
    const F = (t, y, out = 0) => P((-hw + b.w * t) * sgn, sgn * (hd + out), y);
    const nW = [sr * sgn, 0, cr * sgn];
    const ry = Math.atan2(nW[0], nW[2]);
    const h = (k) => {
      const v = Math.sin(bi * 12.9898 + k * 78.233 + s.x * 0.0137 + s.z * 0.0071) * 43758.5453;
      return v - Math.floor(v);
    };
    const T = top(b);
    const mid = F(0.5, 0, 0.8);
    const floor0 = Math.max(s.y, ground(mid[0], mid[2])) + 0.12;
    const nSt = Math.max(1, Math.round((T - floor0) / 3.3));
    const sh = (T - floor0) / nSt;
    if (nSt < 2 || sh < 2.9) return;
    const nb = Math.max(1, Math.round(b.w / 3.5));
    const bw = b.w / nb;
    const doorBay = Math.floor(nb / 2);
    facts.blocks++;
    x0 = Math.min(x0, s.x); x1 = Math.max(x1, s.x); z0 = Math.min(z0, s.z); z1 = Math.max(z1, s.z);
    // The string course over the ground floor, right round.
    trim.box(b.w + 0.26, 0.22, b.d + 0.26, s.x, floor0 + sh + 0.04, s.z, 0xd9d5ca, s.rot);

    // Shops, where the pavement is level with the floor along the front.
    const e0 = F(0.08, 0, 0.8);
    const e1 = F(0.92, 0, 0.8);
    const level = Math.abs(ground(e0[0], e0[2]) + 0.12 - floor0) < 0.5 && Math.abs(ground(e1[0], e1[2]) + 0.12 - floor0) < 0.5;
    const shops = level && nb >= 2 && h(1) < 0.66;
    if (shops) {
      const m = 0.2 / b.w;
      for (let j = 0; j < nb; j++) {
        if (j === doorBay) continue;
        const unit = Math.floor(j / 2);
        const col = SHOP[Math.floor(h(10 + unit) * SHOP.length) % SHOP.length];
        const t0 = j / nb;
        const t1 = (j + 1) / nb;
        const tc = (t0 + t1) / 2;
        const yG = floor0 + 2.5;
        quad(trim, F(t0 + m * 0.4, floor0 - 0.1, 0.05), F(t1 - m * 0.4, floor0 - 0.1, 0.05), F(t1 - m * 0.4, floor0 + 2.78, 0.05), F(t0 + m * 0.4, floor0 + 2.78, 0.05), col, nW);
        const glass = h(30 + j) < 0.66 ? lit : trim;
        quad(glass, F(t0 + m * 1.5, floor0 + 0.48, 0.08), F(t1 - m * 1.5, floor0 + 0.48, 0.08), F(t1 - m * 1.5, yG, 0.08), F(t0 + m * 1.5, yG, 0.08), GLASS, nW);
        // A mullion, and the fascia board over the window.
        quad(trim, F(tc - m * 0.2, floor0 + 0.48, 0.1), F(tc + m * 0.2, floor0 + 0.48, 0.1), F(tc + m * 0.2, yG, 0.1), F(tc - m * 0.2, yG, 0.1), col, nW);
        const fc = F(tc, floor0 + 3.02, 0.08);
        const fas = h(50 + unit) < 0.5 ? col : AWNING[Math.floor(h(51 + unit) * AWNING.length) % AWNING.length];
        trim.box(bw - 0.12, 0.5, 0.16, fc[0], fc[1], fc[2], fas, ry);
        facts.shops++;
        if (h(70 + unit) < 0.58) {
          // An awning: down and out over the pavement, a valance along its edge.
          const ac = AWNING[Math.floor(h(71 + unit) * AWNING.length) % AWNING.length];
          const striped = h(72 + unit) < 0.4;
          const strips = striped ? 6 : 1;
          const up = [nW[0] * 0.35, 0.94, nW[2] * 0.35];
          for (let q = 0; q < strips; q++) {
            const u0 = t0 + m * 0.3 + ((t1 - t0 - m * 0.6) * q) / strips;
            const u1 = t0 + m * 0.3 + ((t1 - t0 - m * 0.6) * (q + 1)) / strips;
            const c2 = striped && q % 2 ? CREAM : ac;
            quad(trim, F(u0, floor0 + 2.3, 1.3), F(u1, floor0 + 2.3, 1.3), F(u1, floor0 + 2.76, 0.12), F(u0, floor0 + 2.76, 0.12), c2, up);
            quad(trim, F(u0, floor0 + 2.1, 1.3), F(u1, floor0 + 2.1, 1.3), F(u1, floor0 + 2.3, 1.3), F(u0, floor0 + 2.3, 1.3), c2, nW);
          }
          // Its underside, seen from the pavement.
          quad(trim, F(t0 + m * 0.3, floor0 + 2.3, 1.3), F(t1 - m * 0.3, floor0 + 2.3, 1.3), F(t1 - m * 0.3, floor0 + 2.76, 0.12), F(t0 + m * 0.3, floor0 + 2.76, 0.12), 0x8a857c, [-nW[0] * 0.35, -0.94, -nW[2] * 0.35]);
          facts.awnings++;
        }
      }
    }

    // Balconies up the front, at alternate bays.
    const cap = BALCONY_CAP[tier];
    if (cap && nSt >= 3 && h(2) < (shops ? 0.4 : 0.55)) {
      const rail = RAIL[Math.floor(h(3) * RAIL.length) % RAIL.length];
      const par = h(4) < 0.5 ? 0 : 1;
      let made = 0;
      for (let k = shops || !level ? 2 : 1; k < Math.min(nSt, 12) && made < cap; k++) {
        const y = floor0 + k * sh;
        for (let j = par; j < nb && made < cap; j += 2) {
          const tc = (j + 0.5) / nb;
          const w = bw * 0.82;
          let p = F(tc, y - 0.02, 0.55);
          trim.box(w, 0.14, 1.1, p[0], p[1], p[2], 0xcfcbc0, ry);
          p = F(tc, y + 0.52, 1.07);
          trim.box(w, 0.94, 0.05, p[0], p[1], p[2], rail, ry);
          for (const e of [-1, 1]) {
            p = F(tc + (e * (w / 2 - 0.025)) / b.w, y + 0.52, 0.55);
            trim.box(0.05, 0.94, 1.05, p[0], p[1], p[2], rail, ry);
          }
          made++;
        }
      }
      facts.balconies += made;
    }
  });
  if (!facts.blocks || !trim.vertexCount) return facts;

  // Both meshes in a LOD round the blocks' middle: past the town's edge and DRESS_FAR, neither is drawn.
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const inner = new THREE.Group();
  inner.position.set(-cx, 0, -cz);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, envMapIntensity: 0.6 });
  const tm = trim.mesh(mat, { cast: false, receive: true, name: `${name}-street-dress` });
  inner.add(tm);
  facts.triangles += tm.geometry.attributes.position.count / 3;
  if (lit.vertexCount) {
    const glow = (nightMats && nightMats[0] && nightMats[0].emissiveIntensity) || 0;
    const gm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1, emissive: new THREE.Color(0xffc98a), emissiveIntensity: glow });
    const lm = lit.mesh(gm, { cast: false, receive: false, name: `${name}-shop-glass` });
    inner.add(lm);
    facts.triangles += lm.geometry.attributes.position.count / 3;
    if (nightMats) nightMats.push(gm);
  }
  const lod = new THREE.LOD();
  lod.name = `${name}-street-dress-lod`;
  lod.position.set(cx, 0, cz);
  lod.addLevel(inner, 0);
  lod.addLevel(new THREE.Group(), Math.hypot(x1 - x0, z1 - z0) / 2 + DRESS_FAR);
  lod.userData.streetDress = facts;
  facts.lod = lod;
  if (group) group.add(lod);
  return facts;
}

/**
 * World Map — Preview: real scenery models.
 *
 * Owner, Oct 26: "we need more models". Five CC0 models from Poly Haven
 * (assets/models/scenery/, credited in assets/models/LICENSES.md and the
 * Credits screen), cut down for a flight sim by tools/scenery-models/
 * (Blender: joined, decimated to 500-1,800 triangles, the photo texture
 * baked into vertex colours, one plain material):
 *
 *   rock-face     coastal rock faces under the cliff coasts, scree at the
 *                 foot of the ranges
 *   boulder       boulders on the heath and the fells
 *   quiver-tree   quiver trees in the dry Southern Sands
 *   pier-section  timber piers off the harbour towns
 *   utility-pole  wooden poles carrying the lines along the country roads
 *
 * Where they stand is worked out once a world build from the ground and the
 * data (placeProps, pure); what is drawn is one InstancedMesh a model, filled
 * every half second with only the ones within the tier's reach of the
 * camera (a few dozen to a few hundred), so 2,000 placed props cost what
 * the nearest few do. World Map only: the regular maps load none of this.
 */
import * as THREE from '../../vendor/three.module.js';
import { coverAt } from './landcover.js';

export const PROP_MODELS = Object.freeze(['rock-face', 'boulder', 'quiver-tree', 'pier-section', 'utility-pole']);

/** How far out each model is drawn, by tier (metres), and how many at most. */
export const PROP_TIERS = Object.freeze({
  low: Object.freeze({ reach: 0.55, max: 120 }),
  medium: Object.freeze({ reach: 0.8, max: 260 }),
  high: Object.freeze({ reach: 1, max: 420 }),
  ultra: Object.freeze({ reach: 1.25, max: 600 }),
});
const REACH = { 'rock-face': 4500, boulder: 2200, 'quiver-tree': 2600, 'pier-section': 4000, 'utility-pole': 1800 };

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where every prop stands: { model: [[x, y, z, rot, scale], ...] }. `T` is
 * terrain.js (groundHeightAt, flatAt, calmAt), `D` the preview's data.
 * Deterministic. Kept off every runway's lanes, every flat (fields, towns)
 * and every road.
 */
export function placeProps(T, D) {
  const out = Object.fromEntries(PROP_MODELS.map((m) => [m, []]));
  const H = (x, z) => T.groundHeightAt(x, z);
  const R = rng(9137);
  const lanes = (x, z) => D.airports.some((a) => Math.abs(z - a.z) < 900 && Math.abs(x - a.x) < a.length / 2 + 7000);
  // The roads' segments binned in 512 m squares (thousands of them; every candidate asks).
  const CELLR = 512;
  const grid = new Map();
  for (const r of D.roads || []) {
    for (let i = 1; i < r.path.length; i++) {
      const sg = [r.path[i - 1][0], r.path[i - 1][1], r.path[i][0], r.path[i][1]];
      for (let gx = Math.floor((Math.min(sg[0], sg[2]) - 60) / CELLR); gx <= Math.floor((Math.max(sg[0], sg[2]) + 60) / CELLR); gx++) {
        for (let gz = Math.floor((Math.min(sg[1], sg[3]) - 60) / CELLR); gz <= Math.floor((Math.max(sg[1], sg[3]) + 60) / CELLR); gz++) {
          const k = gx * 100003 + gz;
          let c = grid.get(k);
          if (!c) grid.set(k, (c = []));
          c.push(sg);
        }
      }
    }
  }
  const nearRoad = (x, z, m) => (grid.get(Math.floor(x / CELLR) * 100003 + Math.floor(z / CELLR)) || []).some(([ax, az, bx, bz]) => {
    if (x < Math.min(ax, bx) - m || x > Math.max(ax, bx) + m || z < Math.min(az, bz) - m || z > Math.max(az, bz) + m) return false;
    const dx = bx - ax;
    const dz = bz - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    return Math.hypot(x - ax - dx * t, z - az - dz * t) < m;
  });
  const free = (x, z) => !lanes(x, z) && !(T.flatAt && T.flatAt(x, z)) && !nearRoad(x, z, 25);
  const slope = (x, z) => Math.hypot(H(x + 6, z) - H(x - 6, z), H(x, z + 6) - H(x, z - 6)) / 12;
  const cov = new Float32Array(8);

  // Rock faces round the cliff coasts and at the foot of the ranges.
  for (const isl of D.islands) {
    if (!isl.cliff && isl.profile !== 'ridge') continue;
    const n = Math.round(Math.min(60, isl.radius / 60));
    for (let k = 0; k < n * 4 && out['rock-face'].length < 900; k++) {
      const a = R() * Math.PI * 2;
      const r = isl.radius * (0.55 + R() * 0.9);
      const x = isl.cx + Math.cos(a) * r;
      const z = isl.cz + Math.sin(a) * r;
      const h = H(x, z);
      if (h < 0.5 || h > (isl.cliff ? 60 : 900) || !free(x, z)) continue;
      if (!isl.cliff && slope(x, z) < 0.35) continue;
      out['rock-face'].push([x, h - 1.2, z, R() * 6.283, 3 + R() * 5]);
    }
  }
  // Boulders on heath and fell; quiver trees in the dry south.
  for (const isl of D.islands) {
    if (isl.radius < 1500) continue;
    const tries = Math.round(isl.radius / 25);
    for (let k = 0; k < tries; k++) {
      const a = R() * Math.PI * 2;
      const r = Math.sqrt(R()) * isl.radius * 1.1;
      const x = isl.cx + Math.cos(a) * r;
      const z = isl.cz + Math.sin(a) * r;
      const h = H(x, z);
      if (h < 3 || !free(x, z)) continue;
      const s = slope(x, z);
      if (s > 0.45) continue;
      coverAt(x, z, h, s, false, cov);
      if (cov[5] > 0.5 && R() < 0.5 && out.boulder.length < 900) out.boulder.push([x, h - 0.3, z, R() * 6.283, 1.8 + R() * 3.2]);
      else if (z > 110000 && cov[4] < 0.3 && cov[3] < 0.3 && R() < 0.35 && out['quiver-tree'].length < 500) out['quiver-tree'].push([x, h - 0.1, z, R() * 6.283, 2.4 + R() * 1.4]);
    }
  }
  // Piers off the harbour towns: from the shore nearest the town, out to sea.
  for (const t of D.towns) {
    if ((t.count || 0) < 20) continue;
    let best = null;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      for (let d = t.radius * 0.8; d < t.radius * 4 && !best; d += 40) {
        const x = t.cx + Math.cos(a) * d;
        const z = t.cz + Math.sin(a) * d;
        if (H(x, z) < 0.3 && H(x - Math.cos(a) * 30, z - Math.sin(a) * 30) > 0.8 && !lanes(x, z)) best = { x, z, a, d };
      }
      if (best) break;
    }
    if (!best) continue;
    // Eight sections, 6.8 m each (the model's 3.4 m, doubled), out from the shore.
    const sections = 8;
    for (let k = 0; k < sections; k++) {
      const s = k * 6.6 - 6;
      const x = best.x + Math.cos(best.a) * s;
      const z = best.z + Math.sin(best.a) * s;
      if (H(x, z) < -12) break;
      // The section's length runs along its local z (the Blender y): turned to point out to sea.
      out['pier-section'].push([x, -2.4, z, -best.a + Math.PI / 2, 2]);
    }
  }
  // Poles along the country roads, one every 65 m, 11 m off the verge.
  for (const r of D.roads || []) {
    if (r.kind !== 'road') continue;
    let acc = 0;
    for (let i = 1; i < r.path.length; i++) {
      const [ax, az] = r.path[i - 1];
      const [bx, bz] = r.path[i];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1) continue;
      const nx = -(bz - az) / L;
      const nz = (bx - ax) / L;
      for (let s = 65 - acc; s < L; s += 65) {
        const x = ax + ((bx - ax) * s) / L + nx * 13;
        const z = az + ((bz - az) * s) / L + nz * 13;
        const h = H(x, z);
        if (h > 1 && !lanes(x, z) && !(T.flatAt && T.flatAt(x, z)) && out['utility-pole'].length < 1400) out['utility-pole'].push([x, h - 0.2, z, Math.atan2(-(bz - az), bx - ax), 1.6]);
      }
      acc = (acc + L) % 65;
    }
  }
  return out;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export class Props {
  /**
   * @param {object} o
   * @param {object} o.placed     placeProps()
   * @param {string} [o.quality]
   */
  constructor({ placed, quality = 'medium' }) {
    this.placed = placed;
    this.tier = PROP_TIERS[quality] || PROP_TIERS.medium;
    this.group = new THREE.Group();
    this.group.name = 'world-props';
    this.meshes = {};
    this.t = 1e9;
    this.origin = { x: 0, z: 0 };
    this.counts = { placed: Object.fromEntries(Object.entries(placed).map(([k, v]) => [k, v.length])), drawn: {} };
  }

  /** A model's geometry has loaded (glb.js parse of assets/models/scenery/<name>.glb). */
  setModel(name, geometry) {
    if (this.meshes[name] || !geometry) return;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: !!geometry.attributes.color, roughness: 0.92, metalness: 0 });
    const cap = Math.max(1, Math.min(this.tier.max, (this.placed[name] || []).length));
    const m = new THREE.InstancedMesh(geometry, mat, cap);
    m.name = `world-prop:${name}`;
    m.count = 0;
    m.frustumCulled = false;
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    this.meshes[name] = m;
    this.group.add(m);
    this.t = 1e9;
  }

  /** Every frame: twice a second, the ones within reach of the camera. */
  update(cam, dt = 0.016) {
    this.t += dt;
    if (this.t < 0.5) return;
    this.t = 0;
    // The pool's origin near the camera (precision, render/render-origin.js), on a 4 km grid.
    const ox = Math.round(cam.x / 4096) * 4096;
    const oz = Math.round(cam.z / 4096) * 4096;
    this.origin.x = ox;
    this.origin.z = oz;
    for (const [name, m] of Object.entries(this.meshes)) {
      const list = this.placed[name] || [];
      const reach = REACH[name] * this.tier.reach;
      const r2 = reach * reach;
      let n = 0;
      const cap = m.instanceMatrix.count;
      for (let i = 0; i < list.length && n < cap; i++) {
        const p = list[i];
        const dx = p[0] - cam.x;
        const dz = p[2] - cam.z;
        if (dx * dx + dz * dz > r2) continue;
        _q.setFromAxisAngle(UP, p[3]);
        _p.set(p[0] - ox, p[1], p[2] - oz);
        _s.setScalar(p[4]);
        m.setMatrixAt(n++, _m.compose(_p, _q, _s));
      }
      m.count = n;
      m.visible = n > 0;
      m.position.set(ox, 0, oz);
      m.updateMatrix();
      if (n) {
        m.instanceMatrix.clearUpdateRanges();
        m.instanceMatrix.addUpdateRange(0, n * 16);
        m.instanceMatrix.needsUpdate = true;
      }
      this.counts.drawn[name] = n;
    }
  }

  stats() {
    return { placed: { ...this.counts.placed }, drawn: { ...this.counts.drawn }, models: Object.keys(this.meshes).length };
  }

  dispose() {
    for (const m of Object.values(this.meshes)) {
      m.material.dispose();
      m.dispose();
    }
    this.meshes = {};
  }
}

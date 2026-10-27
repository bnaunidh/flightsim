/**
 * World Map — Preview: the rivers and lakes' water.
 *
 * terrain.js cuts each river's channel and each lake's bowl into the ground
 * (carveWaters); this lays the water in them: a ribbon down every river at
 * its own level (which falls towards the sea, so it runs downhill) and as
 * wide as the river is at each point (wider towards the mouth), and a flat
 * disc on every lake. One mesh, one draw call, one material for the lot.
 *
 * The data comes from tools/worldmap/preview-layout.mjs (makeWaters).
 */
import * as THREE from '../../vendor/three.module.js';

/** The geometry: river ribbons and lake discs, world coordinates. */
export function waterGeometry(rivers = [], lakes = []) {
  const pos = [];
  const nrm = [];
  const idx = [];
  const lift = 0.15;
  for (const r of rivers) {
    const p = r.path;
    const base = pos.length / 3;
    for (let i = 0; i < p.length; i++) {
      const a = p[Math.max(0, i - 1)];
      const b = p[Math.min(p.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      const hw = p[i][3] || r.halfWidth;
      const nx = (-dz / l) * hw;
      const nz = (dx / l) * hw;
      const y = p[i][2] + lift;
      pos.push(p[i][0] + nx, y, p[i][1] + nz, p[i][0] - nx, y, p[i][1] - nz);
      nrm.push(0, 1, 0, 0, 1, 0);
      if (i) {
        const k = base + i * 2;
        // Both windings: facing up whichever way the river runs (the one facing down is culled).
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
        idx.push(k - 2, k, k - 1, k - 1, k, k + 1);
      }
    }
  }
  for (const l of lakes) {
    const seg = 48;
    const base = pos.length / 3;
    pos.push(l.x, l.level + lift, l.z);
    nrm.push(0, 1, 0);
    for (let i = 0; i < seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      // A lake is not a circle: a slow wobble on the shore.
      const rr = l.r * (0.93 + 0.07 * Math.sin(a * 3 + l.x * 0.001) + 0.04 * Math.sin(a * 7 + l.z * 0.001));
      pos.push(l.x + Math.cos(a) * rr, l.level + lift, l.z + Math.sin(a) * rr);
      nrm.push(0, 1, 0);
    }
    for (let i = 0; i < seg; i++) {
      const j = (i + 1) % seg;
      idx.push(base, base + 1 + j, base + 1 + i);
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

/** The mesh, or null where there is no fresh water. */
export function buildWaters(rivers, lakes) {
  const g = waterGeometry(rivers, lakes);
  if (!g) return null;
  const mat = new THREE.MeshStandardMaterial({ color: 0x2c5568, roughness: 0.12, metalness: 0.05, envMapIntensity: 1.1 });
  const m = new THREE.Mesh(g, mat);
  m.name = 'world-waters';
  m.receiveShadow = true;
  m.matrixAutoUpdate = false;
  m.userData.rivers = rivers.length;
  m.userData.lakes = lakes.length;
  return m;
}

/**
 * Round instruments with depth: the painted dials (gauges.js, which records
 * where each one is) get a real bezel standing proud of the panel, its four
 * case screws, and a cover glass in front of the needles that takes the
 * sky's reflection and the sun's glint as you move your head — from the
 * scene's own environment map, so it costs no texture and no repaint.
 *
 * Two draws for every dial on the panel (one instanced bezel, one instanced
 * glass); the glass is left off on Low.
 */
import * as THREE from '../../vendor/three.module.js';
import { mergeGeometries } from '../../aircraft/models/airliner-parts.js';

const COCKPIT_FIRST = -100;

function strip(g) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** A unit bezel (dial radius 1), its axis +z out of the panel: a lipped ring and four screw heads. */
export function bezelGeometry(seg = 32, screws = true) {
  const prof = [
    [0.985, 0.0],
    [0.985, 0.1],
    [1.02, 0.15],
    [1.1, 0.16],
    [1.16, 0.12],
    [1.19, 0.04],
    [1.2, 0.0],
  ].map(([r, z]) => new THREE.Vector2(r, z));
  const ring = new THREE.LatheGeometry(prof, seg);
  ring.rotateX(Math.PI / 2);
  const parts = [strip(ring)];
  for (let i = 0; i < (screws ? 4 : 0); i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const s = new THREE.CylinderGeometry(0.075, 0.08, 0.035, 8);
    s.rotateX(Math.PI / 2);
    s.translate(Math.cos(a) * 1.33, Math.sin(a) * 1.33, 0.018);
    parts.push(strip(s));
  }
  return mergeGeometries(parts);
}

/** Bezels (and, unless `low`, glass) on every dial `panel` recorded. Returns the meshes added. */
export function fitBezels(panel, { low = false } = {}) {
  const dials = panel && panel.dials;
  if (!dials || !dials.length || !panel.group) return [];
  // Two dials painted at one spot (a twin needle over a round face) get one bezel.
  const seen = new Set();
  const list = dials.filter(([u, v]) => {
    const k = `${u.toFixed(3)},${v.toFixed(3)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const out = [];
  const mx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  const pos = new THREE.Vector3();
  const place = (inst, zOf) => {
    list.forEach(([u, v, R], i) => inst.setMatrixAt(i, mx.compose(pos.set(u, v, zOf(R)), q, sc.setScalar(R))));
    inst.instanceMatrix.needsUpdate = true;
    inst.frustumCulled = false;
    panel.group.add(inst);
    out.push(inst);
  };
  const bezelMat = new THREE.MeshStandardMaterial({ color: 0x17191c, roughness: 0.42, metalness: 0.35 });
  bezelMat.name = 'bezel';
  const bez = new THREE.InstancedMesh(bezelGeometry(low ? 14 : 36, !low), bezelMat, list.length);
  bez.name = 'instrument bezels';
  bez.renderOrder = COCKPIT_FIRST;
  bez.castShadow = !low;
  bez.receiveShadow = true;
  place(bez, () => 0);
  if (!low) {
    // Black glass, added: only what it reflects shows (about 4 % head on, more at a slant).
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x000000,
      roughness: 0.07,
      metalness: 0,
      envMapIntensity: 1.6,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    glassMat.name = 'instrument glass';
    glassMat.userData.night = false;
    const glass = new THREE.InstancedMesh(new THREE.CircleGeometry(1.0, 28), glassMat, list.length);
    glass.name = 'instrument glass';
    place(glass, (R) => R * 0.1);
  }
  return out;
}

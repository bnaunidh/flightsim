/**
 * Which doors an airliner's evacuation uses, and where they are in the world.
 *
 * Every main-deck passenger door — except one with the aeroplane under it.
 * Out of a door over the wing (the 747's and the A380's second doors sit
 * right over the wing root) a parachutist drops onto the wing, which is
 * neither safe-looking nor what anyone asked for. So, once, as the
 * evacuation starts, a ray is dropped from just outside each door, and a
 * door whose ray hits the aeroplane itself within 18 m is left shut. If that
 * left none (an aeroplane drawn some way nobody expected), the rearmost and
 * the front left are used anyway.
 *
 * The over-wing exits are never used: they open onto the wing.
 */

import * as THREE from '../../vendor/three.module.js';
import { evacDoors } from './evac.js';

const _ray = new THREE.Raycaster();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();

/** A door's outward normal, [x, y, z] in the aeroplane's frame. */
export function doorNormal(d) {
  if (Array.isArray(d.normal)) return d.normal;
  return [d.side === 'right' || d.x > 0 ? 1 : -1, 0, 0];
}

/**
 * The doors to leave by: `list` is the cabin's exits (layout.js cabinFor
 * .exits), `model` the drawn aeroplane (or null: then nothing is dropped).
 */
export function pickEvacDoors(list, model) {
  const doors = evacDoors(list).filter((d) => d.kind === 'passenger' && d.deck !== 'upper');
  if (!model || !doors.length) return doors;
  let keep = doors;
  try {
    model.updateMatrixWorld(true);
    const s = model.scale && model.scale.x ? model.scale.x : 1;
    const down = _d.set(0, -1, 0);
    // Its solid parts only: a sprite (a light's glow) wants a camera to be hit
    // at all, and three.js says so in red on the console for every one.
    const solid = [];
    model.traverse((o) => {
      if (o.isMesh) solid.push(o);
    });
    keep = doors.filter((d) => {
      const n = doorNormal(d);
      _p.set((d.x + n[0] * 1.3) / s, d.y / s, d.z / s).applyMatrix4(model.matrixWorld);
      _ray.set(_p, down);
      _ray.far = 18;
      const hits = _ray.intersectObjects(solid, false);
      return !hits.some((h) => h.object && h.object.visible !== false && !/window|silhouette/i.test(h.object.name || ''));
    });
  } catch (e) {
    keep = doors;
  }
  if (keep.length) return keep;
  const L = doors.filter((d) => d.side === 'left');
  const out = [];
  if (L.length) out.push(L[0]);
  const rear = doors[doors.length - 1];
  if (rear && !out.includes(rear)) out.push(rear);
  return out;
}

/** A door's middle in the world, a little outside the skin, from the physics frame. */
export function doorWorld(ac, d, out = new THREE.Vector3(), lift = 0.6) {
  const n = doorNormal(d);
  return out.set(d.x + n[0] * lift, (d.sill != null ? d.sill + 0.9 : d.y), d.z).applyQuaternion(ac.quat).add(ac.pos);
}

/** A door's outward direction in the world, flattened. */
export function doorOutWorld(ac, d, out = new THREE.Vector3()) {
  const n = doorNormal(d);
  out.set(n[0], 0, n[2] || 0).applyQuaternion(ac.quat);
  out.y = 0;
  if (out.lengthSq() < 1e-6) out.set(1, 0, 0);
  return out.normalize();
}

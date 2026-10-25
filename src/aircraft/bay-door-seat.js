/**
 * Seat a wheel-well door on the skin above it.
 *
 * The doors are placed from the airframe's numbers (a body profile, a wing
 * section, a leg's attach point), and those numbers do not know what the
 * drawn skin does at the door's exact spot: a wing-mounted main gear's door
 * placed at the belly's height hung a metre and more under an A380's wing
 * root with the gear up, a detached plate in plain view all flight. So,
 * once the airframe is drawn, each shut door looks straight up from below
 * its hinge edge and its free edge, finds the first outer skin there, and
 * is moved up (or down) to lie just under it, tilted to follow it across.
 *
 * `doors` are groups hinged at their own origin with one mesh each, the
 * panel running across local X from the hinge (either way) and along local
 * Z; their rest rotation is identity. `skip(o)` says which meshes are not
 * skin (the legs, wheels, the doors themselves, effects). Runs at build
 * only: a few rays a door.
 */
import * as THREE from '../vendor/three.module.js';

const UP = new THREE.Vector3();
const ray = new THREE.Raycaster();

/**
 * @param root   the model (any transform; the rays are cast in world space)
 * @param doors  [{ obj: THREE.Group }]
 * @param skip   (mesh) => true for a mesh that is not airframe skin
 * @param o.gap  how far under the skin the door's centre sits, model units
 * @param o.reach how far above its drawn place a door may be lifted, model units
 */
export function seatDoorsOnSkin(root, doors, skip, { gap = 0.025, reach = 2.5, drop = 0.4 } = {}) {
  if (!doors.length) return 0;
  root.updateMatrixWorld(true);
  const targets = [];
  root.traverse((o) => {
    if (o.isMesh && !o.isSkinnedMesh && o.visible !== false && !skip(o)) targets.push(o);
  });
  if (!targets.length) return 0;
  const scale = new THREE.Vector3().setFromMatrixScale(root.matrixWorld).y || 1;
  UP.set(0, 1, 0).transformDirection(root.matrixWorld);
  const down = UP.clone().negate();
  let moved = 0;
  for (const d of doors) {
    const g = d.obj;
    const mesh = g.children.find((c) => c.isMesh);
    if (!mesh) continue;
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    // Hinge edge at local x = 0; the free edge is whichever end of the box is not.
    const free = Math.abs(bb.min.x) > Math.abs(bb.max.x) ? bb.min.x : bb.max.x;
    const zc = (bb.min.z + bb.max.z) / 2;
    const skinAt = (x) => {
      // From below the door's place, straight up, the first outer skin within reach.
      const p = new THREE.Vector3(x, 0, zc).applyMatrix4(mesh.matrixWorld);
      ray.set(p.clone().addScaledVector(down, drop * scale), UP);
      ray.near = 0;
      ray.far = (reach + drop) * scale;
      const hit = ray.intersectObjects(targets, false)[0];
      return hit ? g.parent.worldToLocal(hit.point.clone()) : null;
    };
    // Six looks across the door, hinge to free edge; the ones that find skin.
    const hits = [];
    for (const f of [0, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      const p = skinAt(free * f);
      if (p) hits.push({ x: free * f, y: p.y - g.position.y });
    }
    if (!hits.length) continue;
    // A step (a wing glove over the belly) is not a curve to follow: the door
    // belongs to the lower surface, and only the looks that land on it count.
    const minY = Math.min(...hits.map((q) => q.y));
    const low = hits.filter((q) => q.y < minY + Math.abs(free) * 0.3);
    // A straight fit across them, its slope held to a believable tilt...
    let slope = 0;
    if (low.length > 1) {
      const mx = low.reduce((a, q) => a + q.x, 0) / low.length;
      const my = low.reduce((a, q) => a + q.y, 0) / low.length;
      let sxy = 0;
      let sxx = 0;
      for (const q of low) {
        sxy += (q.x - mx) * (q.y - my);
        sxx += (q.x - mx) ** 2;
      }
      slope = sxx > 1e-9 ? THREE.MathUtils.clamp(sxy / sxx, -0.8, 0.8) : 0;
    }
    // ...then lowered until no look's skin is under it: the panel lies just beneath the skin everywhere, never inside a curve's chord.
    const y0 = Math.min(...low.map((q) => q.y - slope * q.x));
    geo.rotateZ(Math.atan(slope));
    geo.computeBoundingBox();
    geo.computeBoundingSphere();
    g.position.y += y0 - gap;
    moved++;
  }
  return moved;
}

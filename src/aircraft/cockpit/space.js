/**
 * Where the cockpit is, in the aeroplane it sits in.
 *
 * main.js hangs the cockpit group on the aeroplane's model, counter-scaled to
 * life size and moved so the cockpit's own eye point (TRAINER_EYE) lands on
 * the pilot's eye in THIS aeroplane:
 *
 *   k        = 1 for a fleet-pack model (built in metres), else shape.scale
 *   eye      = the model's own measured eye, else shape.eye x shape.scale (m)
 *   position = eye / k - TRAINER_EYE / k,  scale = 1 / k
 *
 * (features/airliners.js does the same sum for the fleet airliners.) A family
 * builder that wants its room to meet the outside of the aeroplane — window
 * frames on the window lines, a glareshield on the windscreen's sill — needs
 * the same sum the other way round. It is written once, here.
 */

import * as THREE from '../../vendor/three.module.js';
import { TRAINER_EYE } from './common.js';

/**
 * `{ k, eye, fleet, toLocal(v), exteriorGroup() }` for this type and model.
 *
 * toLocal: a point in the MODEL's own units and frame (shape units for the
 * civil models, metres for the pack) -> cockpit-local metres.
 * exteriorGroup(): a Group to add to the cockpit whose children are authored
 * in the model's own units — geometry lofted from the exterior's hull goes in
 * here untouched and lands exactly on the exterior.
 */
export function cockpitSpace(type, model) {
  const S = (type && type.shape) || { scale: 1, eye: TRAINER_EYE };
  const fleet = !!(model && model.userData && model.userData.fleetBridge);
  const k = fleet ? 1 : S.scale || 1;
  const fg = model && model.userData && model.userData.flightGeometry;
  // The same choice as model-adapter.js eyeFor(): the model's own
  // measurement if it has one, else the type's, scaled to metres.
  const eye = fg && Array.isArray(fg.eye) ? [...fg.eye] : [S.eye[0] * S.scale, S.eye[1] * S.scale, S.eye[2] * S.scale];
  const off = [TRAINER_EYE[0] - eye[0], TRAINER_EYE[1] - eye[1], TRAINER_EYE[2] - eye[2]];
  return {
    k,
    eye,
    fleet,
    /** Model units -> cockpit-local metres. */
    toLocal(v, out = new THREE.Vector3()) {
      const x = Array.isArray(v) ? v[0] : v.x;
      const y = Array.isArray(v) ? v[1] : v.y;
      const z = Array.isArray(v) ? v[2] : v.z;
      return out.set(off[0] + x * k, off[1] + y * k, off[2] + z * k);
    },
    /** Cockpit-local metres -> model units. */
    toModel(v, out = new THREE.Vector3()) {
      const x = Array.isArray(v) ? v[0] : v.x;
      const y = Array.isArray(v) ? v[1] : v.y;
      const z = Array.isArray(v) ? v[2] : v.z;
      return out.set((x - off[0]) / k, (y - off[1]) / k, (z - off[2]) / k);
    },
    exteriorGroup(name = 'cabin (exterior units)') {
      const g = new THREE.Group();
      g.name = name;
      g.position.set(off[0], off[1], off[2]);
      g.scale.setScalar(k);
      return g;
    },
  };
}

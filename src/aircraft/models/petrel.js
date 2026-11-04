/**
 * Petrel 185: the Skylark's airframe, no wheels, on two floats with proper
 * struts and spreader bars. The floats are drawn from the same `floatGear`
 * numbers the flight model's keels come from.
 */
import { hull, roundNose, tubePath } from './civil-kit.js';
import { buildSkylark } from './skylark.js';

export function buildPetrel(b) {
  const out = buildSkylark(b);
  const { S, m } = b;
  const F = S.floatGear;
  const top = F.y + F.depth;
  const keel = F.y;
  const float = () => hull({
    stations: [
      ...roundNose(F.bow, 0.5, { w: F.width * 0.9, top: top - 0.04, bot: keel + 0.1, yc: top - 0.2 }, { y: top - 0.1 }, 3),
      { z: -1.2, w: F.width, top, bot: keel + 0.02, yc: top - 0.24 },
      { z: 0.2, w: F.width, top, bot: keel, yc: top - 0.24 },
      // The step: the keel steps up here, which is what lets a float unstick.
      { z: 0.24, w: F.width * 0.96, top, bot: keel + 0.13, yc: top - 0.2 },
      { z: 1.4, w: F.width * 0.7, top: top - 0.06, bot: keel + 0.26, yc: top - 0.16 },
      { z: F.stern, w: 0.05, top: top - 0.12, bot: top - 0.17, yc: top - 0.14 },
    ],
    radial: 8,
    uvBand: 0.2,
    maxStep: 0.3,
  }).geometry;
  for (const side of [-1, 1]) {
    b.put(float(), m.body, { p: [side * F.x, 0, 0] });
    // Two struts up to the fuselage, each pair braced; the water rudder on the heel.
    for (const z of [-1.1, 0.75]) b.put(tubePath([[side * 0.5, -0.72, z * 0.92], [side * F.x, top, z]], 0.035, 8), m.metal);
    b.put(tubePath([[side * 0.5, -0.72, -1.0], [side * F.x, top, 0.7]], 0.02, 6), m.metal);
    b.put(tubePath([[side * F.x, top - 0.1, F.stern - 0.06], [side * F.x, keel + 0.1, F.stern + 0.06]], 0.05, 6), m.metal);
  }
  // Spreader bars between the floats.
  for (const z of [-1.1, 0.75]) b.put(tubePath([[-F.x, top - 0.02, z], [F.x, top - 0.02, z]], 0.03, 8), m.metal);
  return out;
}

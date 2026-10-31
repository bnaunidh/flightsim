/**
 * The cockpit: one per aeroplane, built by its family.
 *
 * This used to be a single 1,700-line file that built the same box room with
 * the same canvas panel for every aeroplane in the game, dressed per class
 * with a different stick. It is now the entry point to a small framework in
 * ./cockpit/ (see cockpit/README.md for the whole plan):
 *
 *   families.js     which family each type belongs to, and its builder
 *   space.js        where the pilot's eye is, and the model-to-cockpit sum
 *   canopy.js       an interior cut on the exterior's own window lines
 *   paint.js        shared instrument painting (bezels, dial faces, labels)
 *   gauges.js       steam gauges as painted faces + turning meshes
 *   panel-canvas.js the old canvas panel (generic builder only)
 *   common.js       warning lamps, rain, controls, blackout, panel lights
 *   generic.js      the old cockpit, for families without a builder yet
 *   light.js        light aircraft: Skylark, Courier, Tempest
 *   kit.js          finishes and furniture for the cockpits below
 *   displays.js     the glass screens and the HUD, painted from the sim
 *   jet.js          fast jets, the racer and the Nightjar's flight deck
 *   deck-skin.js    an airliner's nose from inside, its panes cut out
 *   flightdeck.js   airliners: A320, 747, A380, Meridian
 *   heli.js         the helicopter: chin bubbles, cyclic and collective
 *   harrison.js     T-Pose Harrison: a visor HUD and his own arms, no room
 *
 * The contract with the rest of the game is unchanged: createCockpit()
 * returns a Group whose userData.update(dt, ac, weather, sim) runs while the
 * cockpit view is up, and main.js places it so the cockpit's own eye point
 * lands on the pilot's eye.
 */

import * as THREE from '../vendor/three.module.js';
import { cockpitFamily, builderFor, registerCockpitBuilder } from './cockpit/families.js';
import { cockpitSpace } from './cockpit/space.js';
import { buildGenericCockpit } from './cockpit/generic.js';
import { buildLightCockpit } from './cockpit/light.js';
import { buildJetCockpit } from './cockpit/jet.js';
import { buildFlightDeck } from './cockpit/flightdeck.js';
import { buildHeliCockpit } from './cockpit/heli.js';
import { buildHarrisonView } from './cockpit/harrison.js';
import { batchMovers } from './cockpit/kit.js';

export { InstrumentPanel } from './cockpit/panel-canvas.js';
export { COCKPIT_STYLES } from './cockpit/generic.js';
export { cockpitFamily, registerCockpitBuilder, builderFor, FAMILY, registeredFamilies } from './cockpit/families.js';

registerCockpitBuilder('light', buildLightCockpit, { name: 'light' });
registerCockpitBuilder('jet', buildJetCockpit, { name: 'jet' });
registerCockpitBuilder('racer', buildJetCockpit, { name: 'racer' });
registerCockpitBuilder('airliner', buildFlightDeck, { name: 'airliner' });
registerCockpitBuilder('heli', buildHeliCockpit, { name: 'heli' });
// T-Pose Harrison ('none'): no room, his visor's readout and his own arms (cockpit/harrison.js).
registerCockpitBuilder('none', buildHarrisonView, { name: 'harrison' });

/**
 * The sun lights the cockpit and its parts shade each other: every opaque
 * part casts and takes shadows (main.js pulls the sun's shadow map in round
 * the eye while the cockpit view is up). Glass, screens and the HUD neither
 * cast nor block anything.
 */
function shadowed(group) {
  group.updateMatrixWorld(true);
  const scale = new THREE.Vector3();
  group.traverse((o) => {
    if (!o.isMesh) return;
    const m = Array.isArray(o.material) ? o.material[0] : o.material;
    const clear = !m || m.transparent || o.userData.display || m.blending === THREE.AdditiveBlending;
    // Only what is big enough for its shadow to be seen casts one (the
    // room, the glareshield, frames, seats, consoles): a needle, a lamp or a
    // knob would cost a draw in the shadow pass for a speck. Every frame the
    // cockpit view must cost no more than the follow view.
    const g = o.geometry;
    if (g && !g.boundingSphere) g.computeBoundingSphere();
    o.getWorldScale(scale);
    const r = g && g.boundingSphere ? g.boundingSphere.radius * Math.max(scale.x, scale.y, scale.z) : 0;
    o.castShadow = !clear && r > 0.12 && !o.userData.noCast;
    o.receiveShadow = !clear || !!o.userData.display;
    // Drawn first of everything solid (after the sky): the panel, the walls
    // and the frames fill the depth buffer before the island is drawn, so a
    // graphics chip that shades in draw order skips the terrain, the sea and
    // the town behind them instead of shading them and painting over them.
    if (m && !m.transparent && o.renderOrder === 0) o.renderOrder = COCKPIT_FIRST;
  });
  // Then the moving parts as one draw per material (kit.js): each batch
  // casts if any of its pieces did, and draws first like the rest.
  batchMovers(group);
  group.traverse((o) => {
    if (!o.isSkinnedMesh || !o.userData.parts) return;
    o.castShadow = o.userData.parts.some((p) => p.mesh.castShadow);
    o.receiveShadow = true;
    o.renderOrder = COCKPIT_FIRST;
  });
  return group;
}

/** The render order of the cockpit's solid parts: after the sky dome (-1000), before the world (0). */
export const COCKPIT_FIRST = -100;

/** One warning per builder that has thrown, not one per aeroplane change. */
const failed = new Set();

/**
 * @param {object} o
 * @param {boolean} [o.highContrast]
 * @param {object}  [o.type]   the roster entry (types.js)
 * @param {THREE.Object3D} [o.model]  the exterior it will hang on; the
 *        family builders cut the interior to it. Without one they fall back
 *        to the type's own shape, and the generic builder ignores it.
 */
export function createCockpit({ highContrast = false, type = null, model = null } = {}) {
  const b = builderFor(type);
  if (b) {
    try {
      const space = cockpitSpace(type, model);
      const group = b.build({ type, model, highContrast, family: cockpitFamily(type), space });
      if (group && group.userData && typeof group.userData.update === 'function') return shadowed(group);
      throw new Error('builder returned no cockpit');
    } catch (e) {
      // A family builder must never be able to take the cockpit view away:
      // log it once and build the cockpit every aeroplane had before.
      const key = `${b.name}:${type && type.id}`;
      if (!failed.has(key)) {
        failed.add(key);
        console.warn(`[cockpit] the ${b.name} cockpit for ${type && type.id} failed; using the generic one.`, e);
      }
    }
  }
  return buildGenericCockpit({ highContrast, type });
}

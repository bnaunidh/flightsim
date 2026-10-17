/**
 * The secret runway boxes, made visible — for a developer, never a player.
 *
 * game/landing-zone.js builds a hidden box round every runway of the loaded
 * map (the runway, 60 m past each end, 15 m of shoulder each side) and every
 * "land on the runway" step counts three seconds down inside one. The owner
 * asked for it to be SECRET, so nothing here draws unless somebody asks:
 *
 *   - `?lzdebug` in the address, from the first world built; or
 *   - the Dev panel's "Landing hitboxes" button, which toggles it.
 *
 * Magenta wire frames, redrawn with every world so they follow the map. No
 * flashing, no animation, nothing on the HUD.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { runwayZones, landingZoneLines } from '../game/landing-zone.js';

const D = { on: false, group: null };

function flagged() {
  try {
    return typeof location !== 'undefined' && /[?&]lzdebug\b/.test(location.search || '');
  } catch (e) {
    return false;
  }
}

function clear() {
  const g = D.group;
  D.group = null;
  if (!g) return;
  if (g.parent) g.parent.remove(g);
  const mats = new Set();
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) mats.add(o.material);
  });
  for (const m of mats) m.dispose();
}

function draw(sim) {
  clear();
  if (!D.on || !sim || !sim.scene) return;
  D.group = landingZoneLines(THREE, runwayZones());
  sim.scene.add(D.group);
}

/** For the tests: is anything drawn? */
export function landingZonesDrawn() {
  return !!(D.group && D.group.parent);
}

registerExtension({
  id: 'landing-zones',
  install() {
    D.on = flagged();
  },
  buildWorld(sim) {
    draw(sim);
  },
  devActions: [
    {
      label: 'Landing hitboxes',
      hint: 'Show or hide the secret runway boxes a landing counts in (debug only)',
      run(sim) {
        D.on = !D.on;
        draw(sim);
      },
    },
  ],
});

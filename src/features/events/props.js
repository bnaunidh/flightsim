/**
 * Who owns the rubber duck.
 *
 * A goofy mission builds things when it starts — a duck, a balloon, a flock
 * of seagulls, a UFO — and main.js has no idea they exist, so it cannot take
 * them away again. Left alone, a UFO from one mission would still be hovering
 * over the island in the next, and every retry would add another duck.
 *
 * So every mission's props hang off one group owned by that mission, and this
 * module takes the group down whenever the flight it belongs to is over:
 * back to the menu, back to the runway, or the start of any flight that is not
 * a fresh go at the same mission. It registers its own small extension for
 * exactly that, so the goofy missions tidy up after themselves even if the
 * flight-events feature is switched off.
 *
 * The order it has to cope with is not obvious. main.js starts a mission's
 * runner — which runs the mission's onStart, which builds the props — and
 * only THEN tells the extensions a flight has started. So "a flight started"
 * must not clear props belonging to the mission that just started, or every
 * goofy mission would build its props and lose them in the same frame.
 */

import * as THREE from '../../vendor/three.module.js';
import { registerExtension } from '../../game/extensions.js';
import { hideAll, ageCard } from './ui.js';

let current = null;

/**
 * A fresh group for this mission's props, replacing any that were there.
 * @returns {{ owner: string, group: THREE.Group, loops: object[], adopted: THREE.Object3D[], usedUi: boolean }}
 */
export function missionProps(sim, owner) {
  clearMissionProps();
  const group = new THREE.Group();
  group.name = `goofy:${owner}`;
  if (sim && sim.scene) sim.scene.add(group);
  current = { owner, group, loops: [], adopted: [], usedUi: false, sim };
  return current;
}

export function currentProps(owner) {
  if (!current) return null;
  if (owner && current.owner !== owner) return null;
  return current;
}

/** Something built for this mission that lives outside its group (on a crate, say). */
export function adopt(obj) {
  if (current && obj) current.adopted.push(obj);
  return obj;
}

/** A looping sound to stop when the mission's props go. */
export function addLoop(loop) {
  if (current && loop) current.loops.push(loop);
  return loop;
}

export function markUi() {
  if (current) current.usedUi = true;
}

function disposeTree(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.userData && o.userData.shared) return;
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (m.map && !seen.has(m.map)) {
        seen.add(m.map);
        m.map.dispose();
      }
      m.dispose();
    }
  });
}

export function clearMissionProps() {
  if (!current) return;
  const c = current;
  current = null;
  for (const l of c.loops) {
    try { l.stop(); } catch (e) { /* already quiet */ }
  }
  for (const o of c.adopted) {
    if (o.parent) o.parent.remove(o);
    disposeTree(o);
  }
  if (c.group.parent) c.group.parent.remove(c.group);
  disposeTree(c.group);
  if (c.usedUi) hideAll();
}

registerExtension({
  id: 'goofyprops',
  startMode(sim, mode, opts) {
    if (!current) return;
    if (mode === 'mission' && opts && opts.id === current.owner) return;
    clearMissionProps();
  },
  stop() {
    clearMissionProps();
  },
  // The story cards time out in game seconds (see ageCard in ./ui.js). Here
  // because this extension is always loaded, with or without flight-events.
  update(sim, dt) {
    ageCard(dt);
  },
});

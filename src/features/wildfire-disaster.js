/**
 * WILDFIRE AS A NATURAL DISASTER — "wildfires should be new disaster".
 *
 * The forest fire already existed (./wildfire.js): missions light one, and
 * the Dev panel could light one in Free Flight. This puts it in the
 * natural-disaster list beside the tornado and the typhoon, so a kid can
 * summon it the same way as the rest:
 *
 *   - Free Flight setup → Disasters: tick "Wildfire", pick when.
 *   - Pause menu → Disasters → "Wildfire": a fire starts ahead of you now.
 *   - Randomised disasters can roll it too.
 *
 * It is the wildfire feature's own fire and water, not a copy: the same
 * spread, smoke and glow, the same tank or bucket armed, X to drop, the same
 * arrow to the sea and back. The button shows ON for as long as it burns.
 *
 * Free Flight only, like the rest of the Disasters panel — a fire mission's
 * fire must never be replaced by a summoned one.
 *
 * Another player's wildfire (src/game/happenings.js) is lit where THEIRS is,
 * if that spot is on this map, so a lobby fights the same fire.
 */

import { registerExtension } from '../game/extensions.js';
import { registerNaturalEvent } from '../game/disasters.js';
import { takeSummonPoint } from '../game/happenings.js';
import { startDevFire, setupFire, fireStatus, wildfireDebug } from './wildfire.js';

/** A fire at a given spot — how a fire someone else lit arrives here. */
export function startWildfireAt(sim, p) {
  const W = wildfireDebug();
  const g = W && W.grid;
  if (W && W.live && g && g.burning && g.inside(p.x, p.z) && Math.hypot(p.x - g.cx, p.z - g.cz) < 2600) {
    g.ignite(p.x, p.z, 45);
    W.flameDirty = true;
    return true;
  }
  // The same fire the Dev button and the pause-menu button light.
  return setupFire(sim, {
    centre: p,
    ignite: [{ x: p.x, z: p.z, r: 45 }],
    preburn: 15,
    protect: 'town',
    mopUp: 0.85,
    dev: true,
  });
}

export const WILDFIRE_EVENT = {
  id: 'wildfire',
  name: 'Wildfire',
  hint: 'A forest fire starts ahead of you — scoop water from the sea and drop it on the flames (X)',
  // Read by triggerNatural just after apply(): the usual warning if the fire
  // caught, and no contradiction of the "nothing to burn" line if it did not.
  get warn() {
    // The fire's own line has just said where it is and what to do; this one says why it matters.
    if (this.lit) return 'WILDFIRE! Scoop water at the sea and put it out before it spreads.';
    return this.why === 'mode'
      ? 'Wildfires can only be summoned in Free Flight.'
      : 'No wildfire this time — there was nothing to burn nearby.';
  },
  lit: false,
  why: null,
  kind: 'bad',
  // Seconds the pause-menu button stays lit. The update hook below holds it
  // at 3 (which the button shows as ON) for as long as anything is burning.
  duration: 3,
  /*
   * triggerNatural's contract (main.js): apply() returning false means
   * "nothing happened here" — no warning and nothing lit in the pause menu.
   * In the car or the boat that is all (a kid there did not ask for fire);
   * in a mission, and where there is nothing to burn, this says why itself.
   */
  apply(sim) {
    const at = takeSummonPoint();
    this.lit = false;
    this.why = null;
    if (!sim || sim.mode !== 'free') {
      this.why = 'mode';
      if (sim && sim.mode === 'mission' && sim.hud && sim.hud.notify) sim.hud.notify(this.warn, 'info', 4);
      return false;
    }
    try {
      this.lit = !!(at ? startWildfireAt(sim, at) : startDevFire(sim));
    } catch (err) {
      console.warn('[wildfire-disaster] could not light the fire:', err);
    }
    if (!this.lit) {
      if (sim.hud && sim.hud.notify) sim.hud.notify(this.warn, 'info', 4);
      return false;
    }
    return true;
  },
  /** Where it is, for happenings.js: the middle of what is burning. */
  where(sim) {
    const W = wildfireDebug();
    const g = W && W.grid;
    const c = g && g.burning ? g.centroid({ x: 0, z: 0 }) : null;
    return c || null;
  },
};

registerNaturalEvent(WILDFIRE_EVENT);

/*
 * Every Disasters button wears the same cloud, which is right for weather and
 * wrong for a fire: a kid scanning the panel for "the fire one" should see a
 * flame. Same stroke, size and colour rules as the icons in ui/icons.js, put on
 * this feature's own button only, so the menus need not know about it.
 */
const FLAME =
  '<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
  'stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-wildfire-icon>' +
  '<path d="M12 21.2c-3.7 0-6.3-2.6-6.3-6 0-3.3 2.3-5 3.6-7.6.5 1.5 1.3 2.5 2.4 3-.3-3 1-5.4 3.1-7.5.2 3.1 1.5 5 2.7 6.9.8 1.2 1.3 2.5 1.3 4.1 0 4.3-3 7.1-6.8 7.1Z"/>' +
  '<path d="M12 21.2c-1.5 0-2.7-1.1-2.7-2.7 0-1.6 1.2-2.5 2.1-3.9.9 1.2 3.3 2.1 3.3 4 0 1.5-1.2 2.6-2.7 2.6Z"/>' +
  '</svg>';

export function paintWildfireIcon(sim) {
  const host = sim && sim.menus && sim.menus.screens && sim.menus.screens.pause;
  if (!host || typeof host.querySelectorAll !== 'function') return 0;
  let n = 0;
  host.querySelectorAll('[data-natural="wildfire"]').forEach((b) => {
    if (b.querySelector('[data-wildfire-icon]')) return;
    const old = b.querySelector('svg.icon');
    if (old) old.outerHTML = FLAME;
    else b.insertAdjacentHTML('afterbegin', FLAME);
    n++;
  });
  return n;
}

registerExtension({
  id: 'wildfire-disaster',
  install(sim) {
    paintWildfireIcon(sim);
  },
  startMode(sim) {
    // In case the pause menu was built after install — cheap, and does nothing twice.
    paintWildfireIcon(sim);
  },
  update(sim) {
    const ev = sim.activeEvents;
    if (!ev || !('wildfire' in ev)) return;
    const s = fireStatus(sim);
    if (s.live && s.burning > 0) ev.wildfire = 3;
    else {
      // Out is over: the pause menu stops saying ON straight away.
      delete ev.wildfire;
      if (sim.menus && sim.menus.syncNatural) sim.menus.syncNatural(ev);
    }
  },
});

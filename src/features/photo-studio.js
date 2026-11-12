/**
 * The Dev photo studio's door (owner, 2026-11-11: "a mode in dev mode where I
 * can spawn a plane and get any camera angle I want, I can pause and unpause
 * stuff for cool shots"; and "you could make ads with that feature").
 *
 * Only the door is here: a Dev tab in the pause menu's More options, a button
 * in the hangar's Dev mode panel, and Alt + the hide-interface key (U) in a
 * flight. All three are shut unless Dev mode is on (progression.js isDev),
 * and the studio itself (./studio/studio.js: spawned planes, the free camera,
 * freezing the world, slow motion, screenshots, the trailer path) is fetched
 * the first time one of them is used. Nothing of it is in the first load.
 */

import { registerExtension } from '../game/extensions.js';
import * as Prog from '../game/progression.js';
import { isKey } from '../flight/input.js';

const S = { sim: null, item: null, shown: null, mod: null, opening: null };

const isDev = (sim) => Prog.isDev((sim && sim.prog) || Prog.load());

/** The studio module, fetched once. */
export function studioModule() {
  if (!S.mod) S.mod = import('./studio/studio.js');
  return S.mod;
}

/** Open the studio in the flight that is on (from the pause menu, the key, or the hangar after a Free Flight starts). */
export function openStudio(sim) {
  if (!sim || !isDev(sim)) return Promise.resolve(false);
  if (S.opening) return S.opening;
  S.opening = studioModule()
    .then((m) => m.open(sim))
    .catch((err) => {
      console.error('[studio] could not open', err);
      sim.hud && sim.hud.notify('The photo studio could not open — see the console', 'warn', 4);
      return false;
    })
    .finally(() => { S.opening = null; });
  return S.opening;
}

function syncItem(sim) {
  if (!S.item) return;
  const on = isDev(sim);
  if (on === S.shown) return;
  S.shown = on;
  S.item.hidden = !on;
  if (sim.menus && sim.menus.syncPauseSheet) sim.menus.syncPauseSheet();
}

registerExtension({
  id: 'photo-studio',
  install(sim) {
    S.sim = sim;
    if (!sim.menus || !sim.menus.addPauseItem) return;
    S.item = sim.menus.addPauseItem('photo-studio', { group: 'dev', title: 'Photo studio', html: `
      <p class="trigger-note">Spawn aeroplanes as props, fly the camera anywhere, freeze or slow the world, save a picture, play a camera path for a trailer.</p>
      <button data-studio-open>Open the photo studio <small>(Alt+U)</small></button>` });
    S.item.hidden = true;
    S.item.addEventListener('click', (e) => {
      if (!e.target.closest('[data-studio-open]')) return;
      if (sim.state === 'paused') sim.resume();
      openStudio(sim);
    });
    syncItem(sim);
  },
  startMode(sim) {
    syncItem(sim);
  },
  stop(sim) {
    if (S.mod) S.mod.then((m) => m.isOpen() && m.close(sim)).catch(() => {});
  },
  update(sim) {
    syncItem(sim);
  },
  key(sim, code, down, e) {
    if (!down || !e || !e.altKey || !isKey(sim, 'hideUi', code) || !isDev(sim)) return false;
    studioModule().then((m) => (m.isOpen() ? m.close(sim) : openStudio(sim))).catch(() => openStudio(sim));
    return true;
  },
  devActions: [
    {
      label: 'Photo studio',
      hint: 'Spawn planes as props, a free camera, freeze and slow-mo, screenshots, trailer paths',
      run(sim) {
        if (sim.state === 'flying' || sim.state === 'paused') {
          if (sim.state === 'paused') sim.resume();
          return openStudio(sim);
        }
        // From the hangar: a Free Flight in the last aeroplane flown, then the studio in it.
        const h = sim.menus && sim.menus.hooks;
        const go = h && h.startFree
          ? h.startFree({ ...(sim.settings.freeSetup || {}), aircraft: sim.settings.aircraft || 'skylark' })
          : sim.startMode('free', { aircraft: sim.settings.aircraft || 'skylark' });
        return Promise.resolve(go).then(() => openStudio(sim));
      },
    },
  ],
});

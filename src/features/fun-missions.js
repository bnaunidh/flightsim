/**
 * The missions' fun pass on the board: lays the patches and the new missions
 * on (game/more/index.js), gives the new ones their cards, puts the patched
 * words on the cards that were built before this arrived, and shows the medal
 * each best score earned. The kit itself is game/fun-kit.js.
 */

import { registerExtension } from '../game/extensions.js';
import { MISSIONS } from '../game/missions.js';
import { layMissions } from '../game/more/index.js';
import { medalLineHtml } from '../game/fun-kit.js';

function syncMedals(menus, progress) {
  const board = menus.screens && menus.screens.missions;
  if (!board || !progress || !progress.missions) return;
  for (const m of MISSIONS) {
    const rec = progress.missions[m.id];
    if (!rec || !rec.complete) continue;
    const node = board.querySelector(`[data-best="${m.id}"]`);
    if (node) node.innerHTML = medalLineHtml(m, rec);
  }
}

registerExtension({
  id: 'fun-missions',
  install(sim) {
    // Here and not at import: the second bundle may land mid-flight, and this only runs off the flight.
    const laid = layMissions();
    const menus = sim.menus;
    if (!menus) return;
    if (menus.registerMissions) {
      menus.registerMissions('flight', laid.flight);
      menus.registerMissions('heli', laid.heli);
    }
    const board = menus.screens && menus.screens.missions;
    for (const id of laid.patched) {
      const def = MISSIONS.find((m) => m.id === id);
      const words = board && def && board.querySelector(`[data-mission="${id}"] > p`);
      if (words && def.blurb && words.textContent !== def.blurb) words.textContent = def.blurb;
    }
    const sync = menus.syncProgress;
    if (typeof sync === 'function') {
      menus.syncProgress = function (progress) {
        const out = sync.call(this, progress);
        syncMedals(this, progress);
        return out;
      };
      if (sim.progress) menus.syncProgress(sim.progress);
    }
  },
});

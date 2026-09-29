/**
 * A saved map that no longer exists.
 *
 * Five maps were taken out (see RETIRED_MAPS in ../world/maps.js). The id of
 * the last one a child played lives on in their browser as `settings.map`,
 * and main.js reads it straight into applyMap() at boot. getMap() now
 * resolves a retired id to its replacement, so the right island is built —
 * but the setting itself still says 'lax', and everything that compares it
 * or looks it up by name was left disagreeing with the island on screen:
 * the menu's "Now flying" line, the map card marked as current, and the
 * map a mission puts back afterwards.
 *
 * So, once, at start-up: if the saved id is not a map any more, rewrite it
 * to the one getMap() actually built, save it, and tell the menu. Nothing
 * else here, and nothing every frame.
 *
 * main.js is not touched: the plug-in layer's install() runs after boot has
 * built the world and synced the menu, which is exactly when this has to
 * happen (checked against main.js: applyMap at boot, syncMap, then
 * extInstall).
 */
import { registerExtension } from '../game/extensions.js';
import { MAPS, resolveMapId } from '../world/maps.js';
import { saveSettings } from '../core/storage.js';

/**
 * Put a retired or unknown saved map right. Returns what it did, for the
 * tests: { from, to } when it changed something, null when there was nothing
 * to do.
 */
export function settleSavedMap(sim) {
  if (!sim || !sim.settings) return null;
  const from = sim.settings.map;
  if (from && MAPS.some((m) => m.id === from)) return null;
  const to = resolveMapId(from);
  sim.settings.map = to;
  try {
    saveSettings(sim.settings);
  } catch (e) {
    /* a browser that will not store anything still gets the right map this session */
  }
  // The per-game memory can carry a retired id too, if anything ever put one
  // there; mapForGame() already ignores it, but it is cheaper to be right.
  if (sim.gameMap) {
    for (const k of Object.keys(sim.gameMap)) {
      const id = sim.gameMap[k];
      if (id && !MAPS.some((m) => m.id === id)) sim.gameMap[k] = resolveMapId(id);
    }
  }
  if (sim.mapBeforeMission && !MAPS.some((m) => m.id === sim.mapBeforeMission)) {
    sim.mapBeforeMission = resolveMapId(sim.mapBeforeMission);
  }
  if (sim.menus && sim.menus.syncMap) sim.menus.syncMap(to);
  return { from: from ?? null, to };
}

registerExtension({
  id: 'maps-retired',
  install(sim) {
    const did = settleSavedMap(sim);
    if (did) console.info(`[maps] saved map "${did.from}" is retired; now "${did.to}"`);
  },
});

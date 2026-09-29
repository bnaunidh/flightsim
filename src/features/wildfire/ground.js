/**
 * What will burn, read off the same numbers the ground is painted with.
 *
 * The terrain shader decides sand, grass and rock per vertex from height and
 * slope (terrain.js buildChunk, pass 2). If this file decided anything else,
 * a child would watch fire run across what is plainly a beach, or stop dead
 * at a line on green grass that is only there in a table. So the weights
 * here are that shader's weights, sample for sample:
 *
 *   sand  = 1 - smoothstep(2, 30, h)
 *   rock  = smoothstep(0.30, 0.95, slope) * 0.9 + smoothstep(150, 300, h) * 0.5
 *   grass = 1 - sand - rock
 *
 * and a cell burns when grass is at least 0.45 of it. On top of that, never:
 * the sea (h < 0.5), anything paved (runways, taxiways, aprons, decks), the
 * roads, the town, and snow. The town is left out on purpose — a house on
 * fire is not a thing this game shows. The fire stops at the gardens, and
 * the mission that is about the town fails when it gets there.
 *
 * FOREST is any cell with a tree standing in it: one of the map's own
 * (extra.treeAt), or one of the wood a forest-fire mission plants
 * (extra.woods — see woods.js). It used to be the map's whole upland band
 * as well, which is where scenery.js scatters its hill trees; but it
 * scatters them one to every forty cells, so the band was mostly open
 * fields, and a "forest fire" stood forest-sized flames on bare grass.
 * Forest burns about twice as long, stands three times as tall, catches a
 * little slower and throws embers in a wind.
 */

import { heightAt, isPaved, MAP, PALETTE, AIRPORT } from '../../world/terrain.js';
import { onRoad } from '../../world/roads.js';
import { FUEL } from './grid.js';

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * @param {object} sim   the game, for its road list (may be null in node)
 * @param {object} extra { treeAt(x, z) -> bool, woods: [{x, z, r}],
 *                         town: {x, z, r} override }
 */
export function makeSampler(sim, extra = {}) {
  const map = MAP || {};
  const sc = map.scenery || {};
  const roads = sim && sim.roads && sim.roads.list && sim.roads.list.length ? sim.roads.list : null;
  const town = extra.town !== undefined ? extra.town
    : sc.town ? { x: sc.town.cx, z: sc.town.cz, r: sc.town.radius } : null;
  const snow = PALETTE && PALETTE.snow ? PALETTE.snow[0] : Infinity;
  const treeAt = extra.treeAt || null;
  const woods = extra.woods && extra.woods.length ? extra.woods : null;
  const inWoods = (x, z) => {
    for (const w of woods) if ((x - w.x) * (x - w.x) + (z - w.z) * (z - w.z) <= w.r * w.r) return true;
    return false;
  };
  const elev = (AIRPORT && AIRPORT.elev) || 14;

  return {
    height: (x, z) => heightAt(x, z),

    classify(x, z) {
      const h = heightAt(x, z);
      if (h < 0.5) return FUEL.NONE;
      if (h > snow) return FUEL.NONE;
      if (isPaved(x, z)) return FUEL.NONE;
      if (roads && onRoad(roads, x, z, 2)) return FUEL.NONE;
      if (town && (x - town.x) * (x - town.x) + (z - town.z) * (z - town.z) < town.r * town.r * 0.72) {
        return FUEL.NONE;
      }
      const e = 10;
      const slope =
        Math.hypot(heightAt(x + e, z) - heightAt(x - e, z), heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
      let sand = 1 - smoothstep(2, 30, h);
      let rock = Math.min(1, Math.max(0, smoothstep(0.3, 0.95, slope) * 0.9 + smoothstep(150, 300, h) * 0.5));
      // The shader's airfield override: the plateau is mown grass.
      if (Math.abs(x) < 900 && z > -420 && z < 360 && Math.abs(h - elev) < 3) {
        sand = 0;
        rock = 0;
      }
      const grass = Math.max(0, 1 - sand - rock);
      if (grass < 0.45) return FUEL.NONE;
      if (woods && inWoods(x, z)) return FUEL.FOREST;
      if (treeAt && treeAt(x, z)) return FUEL.FOREST;
      return FUEL.GRASS;
    },
  };
}

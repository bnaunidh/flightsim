/**
 * The world, as ./sites.js asks about it — read off the live modules. The
 * game and the node test build it the same way: the test hands in a
 * stand-in `sim` with only `onRoad` and `carrier` on it.
 */

import { heightAt, OBSTACLES, isPaved, isOnAnyRunway, padWeight, flatAt, MAP, AIRPORT, CORRIDOR, CORRIDOR2 } from '../../world/terrain.js';
import { PADS } from '../../world/pads.js';

/** Inside either runway's approach lane (the scenery's own rule: nothing tall there). */
export function inCorridor(x, z) {
  const rw = AIRPORT && AIRPORT.runway;
  if (rw && Math.abs(x - rw.cx) < CORRIDOR.length && Math.abs(z - rw.cz) < CORRIDOR.halfWidth) return true;
  const R2 = AIRPORT && AIRPORT.runway2;
  if (R2) {
    const alongX = Math.abs((((R2.headingDeg ?? 180) % 180) - 90)) < 45;
    const al = alongX ? Math.abs(x - R2.cx) : Math.abs(z - R2.cz);
    const ac = alongX ? Math.abs(z - R2.cz) : Math.abs(x - R2.cx);
    if (al < CORRIDOR2.length && ac < CORRIDOR2.halfWidth) return true;
  }
  return false;
}

export function worldEnv(sim) {
  const c = sim && sim.carrier;
  return {
    map: MAP,
    heightAt,
    obstacles: OBSTACLES,
    paved: (x, z) => isPaved(x, z),
    onRunway: (x, z, m) => isOnAnyRunway(x, z, m),
    corridor: inCorridor,
    padWeight,
    flat: (x, z) => !!flatAt(x, z),
    onRoad: (x, z, m) => !!(sim && typeof sim.onRoad === 'function' && sim.onRoad(x, z, m)),
    pads: PADS.map((p) => ({ x: p.pos.x, z: p.pos.z, r: p.r })),
    carrier: c && c.pos ? { x: c.pos.x, z: c.pos.z, deckY: c.deckY, headingDeg: c.headingDeg || 0 } : null,
    airport: AIRPORT,
  };
}

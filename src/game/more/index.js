/**
 * MORE MISSIONS — the door the fun pass comes in by, after the menu.
 *
 * Importing this records every patch (flight-fun.js, heli-fun.js) and brings
 * the new missions; layMissions() puts them on: the patches onto the defs the
 * first load already holds, the new ones on the game's own list, so
 * findMission() and the pay table find them like any other. It runs before
 * anything can start a flight, because startMode waits for the features.
 */
import { MISSIONS } from '../missions.js';
import { addHeliMissions } from '../missions-heli.js';
import { applyPatches } from './patch.js';
import './flight-fun.js';
import './heli-fun.js';
import { MISSIONS as FLIGHT_CORE } from './flight-core.js';
import { NEW_HELI_MISSIONS } from './heli.js';
import { MISSIONS as PASSENGER_MISSIONS } from './passengers.js';

export function layMissions() {
  const patched = applyPatches(MISSIONS);
  for (const m of [...FLIGHT_CORE, ...PASSENGER_MISSIONS, ...NEW_HELI_MISSIONS]) if (!MISSIONS.includes(m)) MISSIONS.push(m);
  addHeliMissions(NEW_HELI_MISSIONS);
  return { patched, flight: [...FLIGHT_CORE, ...PASSENGER_MISSIONS], heli: NEW_HELI_MISSIONS };
}

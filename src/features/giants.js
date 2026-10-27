/**
 * The giants (aircraft/extra/giants.js) on a map that is too short for them.
 *
 * A giant needs about 2 km of runway (`minRunway`) and most maps have about
 * one. The spawner already starts it in the air offshore on those maps
 * (world/spawns.js candidatesFor) when the Free Flight screen picks the
 * start; this says so in words, once per flight, and says where the long
 * runways are — so "it will not take off" is never the first thing a player
 * finds out about the biggest aeroplanes in the game. It also covers the
 * starts the spawner does not touch (a mission, a programmatic runway start,
 * the "Runway 09" choice), where the giant really is sitting on a strip it
 * cannot leave.
 *
 * Nothing about the flight changes. Words only, fenced, and silent for every
 * type without a `minRunway`.
 */

import { registerExtension } from '../game/extensions.js';
import { needsLongerRunway, runwayLength, runwayNeedM } from '../world/spawns.js';
import { MAPS } from '../world/maps.js';
import { MAP } from '../world/terrain.js';
import { AIRPORTS as WORLD_FIELDS, departure as worldDeparture } from '../world/worldmap/preview.js';

/**
 * "Gateway International (3,800 m)": the maps anyone can pick whose main
 * runway is long enough, longest first, at most two — read off the map list,
 * so a long-runway map added later (the real-world ones) is named without
 * this file being touched. The military maps are left out: they are behind
 * the passcode.
 */
export function longRunwayWords(need = 2000) {
  const len = (m) => (m && m.airport && m.airport.runway && m.airport.runway.length) || 0;
  const names = MAPS.filter((m) => !m.military && len(m) >= need)
    .sort((a, b) => len(b) - len(a))
    .slice(0, 2)
    .map((m) => `${m.name} (${len(m).toLocaleString('en-GB')} m)`);
  return names.length ? names.join(' or ') : 'a map with a long runway';
}

/** The line a giant gets on a short map: where it is, what it needs, where to go. */
export function shortRunwayLine(type, { airborne }) {
  const needM = runwayNeedM(type) || type.minRunway;
  const need = Math.round(needM / 100) * 100;
  const have = Math.round(runwayLength() / 10) * 10;
  const where = MAP && MAP.worldPreview ? worldFieldWords(needM) : longRunwayWords(needM);
  return airborne
    ? `The ${type.name} needs about ${need.toLocaleString('en-GB')} m of runway and this one is ${have.toLocaleString('en-GB')} m, so you start in the air. To take off in it, fly from ${where}.`
    : `The ${type.name} needs about ${need.toLocaleString('en-GB')} m of runway — this one is only ${have.toLocaleString('en-GB')} m, so it will not get airborne here. Try ${where}.`;
}

/**
 * On the World Map: the fields long enough, nearest first, at most two —
 * "Haven International (2,800 m, 30 km)".
 */
export function worldFieldWords(need) {
  const here = worldDeparture();
  const ok = WORLD_FIELDS.filter((a) => a.length >= need && (!here || a.id !== here.id))
    .map((a) => ({ a, d: here ? Math.hypot(a.x - here.x, a.z - here.z) : 0 }))
    .sort((p, q) => p.d - q.d)
    .slice(0, 2)
    .map(({ a, d }) => `${a.name} (${a.length.toLocaleString('en-GB')} m, ${Math.round(d / 1000)} km)`);
  return ok.length ? ok.join(' or ') : 'a longer runway';
}

const S = { said: null, last: null };

registerExtension({
  id: 'giants',

  startMode(sim, mode) {
    S.said = null;
    if (mode === 'drive') return;
    const type = sim && sim.aircraftType;
    if (!type || !runwayNeedM(type) || !needsLongerRunway(type)) return;
    const ac = sim.aircraft;
    const airborne = !!(ac && !ac.onGround);
    S.said = { type: type.id, airborne };
    S.last = shortRunwayLine(type, { airborne });
  },

  update(sim) {
    // Said on the first frame of the flight rather than in startMode, so the
    // spawner (which moves the aeroplane in its own startMode) has run, and
    // the line says "you start in the air" only when that is true.
    if (!S.said || S.said.done) return;
    const ac = sim.aircraft;
    const type = sim.aircraftType;
    if (!ac || !type || type.id !== S.said.type) return;
    S.said.done = true;
    S.last = shortRunwayLine(type, { airborne: !ac.onGround });
    if (sim.hud && typeof sim.hud.notify === 'function') sim.hud.notify(S.last, 'info', 9);
  },

  stop() {
    S.said = null;
  },
});

/** For the tests and the console. */
export function giantsState() {
  return { said: S.said ? { ...S.said } : null, last: S.last };
}

/**
 * The seam between the game and the fleet pack in `src/fleet/`.
 *
 * The pack is a set of procedurally-built aeroplanes generated from the model
 * brief — seven airframes with their own fuselage lofts, panel textures,
 * moving surfaces and breakaway sections. It is a genuinely better set of
 * models than the ones in `model.js`, and it was written against this game's
 * own vendored Three (byte-identical copy) and this game's own axis
 * convention, so it drops in rather than being ported.
 *
 * It does NOT replace `model.js`. That factory still builds anything the pack
 * does not cover, and it is still the fallback if the pack fails to load — a
 * new aeroplane arriving in types.js must not be able to break the game before
 * anyone has drawn it.
 *
 * What this file does is make the two look the same from the outside:
 *
 *   createAircraftModel({ type, livery }) -> Group with userData.update(dt, ac, weather)
 *
 * which is the whole contract the rest of the game relies on (main.js for the
 * aeroplane you fly, apron.js for the ones parked at the stands).
 */

import { createAircraftModel as createLegacyModel } from './model.js';
import { getAircraft, DEFAULT_AIRCRAFT_ID } from './types.js';

/**
 * The pack is loaded eagerly at module scope so there is no first-frame stall
 * the moment someone changes aeroplane. If it throws — a syntax error, a
 * missing file, an incompatible Three — we say so once and quietly carry on
 * with the models the game has always had.
 */
let fleet = null;
let fleetIds = new Set();
let fleetError = null;
try {
  fleet = await import('../fleet/aircraft-game-bridge.js');
  const list = await import('../fleet/aircraft-fleet.js');
  fleetIds = new Set(list.aircraftIds);
} catch (e) {
  fleet = null;
  fleetError = e;
  console.warn('The fleet models could not be loaded; using the built-in ones.', e);
}

/** Which ids the pack can actually build. Everything else goes to model.js. */
export function fleetCovers(id) {
  return !!fleet && fleetIds.has(id);
}

/** For the tests and the console: what the pack brought, and what is missing. */
export const fleetIdList = () => [...fleetIds];

export const fleetStatus = () => ({
  loaded: !!fleet,
  error: fleetError ? String(fleetError) : null,
});

/**
 * Paint, translated.
 *
 * The game thinks in livery *schemes* — a base, an accent, a cheatline and a
 * separate tail colour, because a painted cheatline unwraps into a ring unless
 * the fin is its own material. The pack thinks in two colours. So the scheme is
 * flattened on the way in, and the parts of it the pack has nowhere to put
 * (cheatline, registration) are dropped rather than passed through as an object
 * the pack would try to read as a colour.
 */
function paintFor(livery, type) {
  if (livery && typeof livery === 'object') {
    return {
      livery: livery.base || (type && type.livery) || '#eef1f5',
      accent: livery.accent || (type && type.accent) || '#c8102e',
    };
  }
  return {
    livery: livery || (type && type.livery) || '#eef1f5',
    accent: (type && type.accent) || '#c8102e',
  };
}

/**
 * Build an aeroplane. Same signature as the original factory, on purpose.
 */
export function createAircraftModel(opts = {}) {
  // The same default the original factory applies. main.js builds a placeholder
  // aeroplane before it knows which one you picked, and passes no type at all.
  const type = opts.type || getAircraft(DEFAULT_AIRCRAFT_ID);
  if (!fleetCovers(type.id)) return createLegacyModel(opts);

  try {
    return fleet.createGameAircraft(
      { ...opts, type, ...paintFor(opts.livery, type) },
      createLegacyModel
    );
  } catch (e) {
    // One aeroplane failing to build must not take the game with it.
    console.warn(`The fleet model for ${type.id} failed to build; using the built-in one.`, e);
    return createLegacyModel(opts);
  }
}

/**
 * Put the model where the aeroplane is.
 *
 * Normally that is a copy of position and attitude. After a crash it is not:
 * the fleet models hand the wreck to their own rigid body, which is what makes
 * a wing come off and cartwheel rather than the whole aeroplane sliding along
 * still in one piece. So the bridge owns the transform while a crash is
 * running, and gives it back when you restart.
 */
export function syncAircraftModel(model, ac) {
  if (fleet && model.userData.fleetBridge) {
    fleet.synchronizeGameAircraft(model, ac);
    return;
  }
  model.position.copy(ac.pos);
  model.quaternion.copy(ac.quat);
}

/**
 * Break the aeroplane up, if it is one of the models that can.
 *
 * Returns false for the built-in models, which have no breakaway sections —
 * the fireball, the splash and the floating debris come from wreck.js either
 * way, and that is deliberately left alone: it is additive, it owns its own
 * meshes, and it is what draws the water crash the class asked for.
 */
export function crashAircraftModel(model, ac, event = {}, opts = {}) {
  if (!fleet || !model.userData.fleetBridge) return false;
  try {
    return fleet.beginGameAircraftCrash(model, ac, event, opts);
  } catch (e) {
    console.warn('The fleet crash could not start; the wreck effect still runs.', e);
    return false;
  }
}

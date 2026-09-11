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

import * as THREE from '../vendor/three.module.js';
import { createAircraftModel as createLegacyModel, glowSprite } from './model.js';
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
    const model = fleet.createGameAircraft(
      { ...opts, type, ...paintFor(opts.livery, type) },
      createLegacyModel
    );
    // Hang the game's own lamps on it, and drive them alongside the pack's
    // own animation rather than instead of it.
    const rig = addLights(model);
    if (rig) {
      const inner = model.userData.update;
      model.userData.update = (dt, ac = {}, weather = {}) => {
        inner(dt, ac, weather);
        updateLights(rig, dt, ac, weather);
      };
    }
    return model;
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
    // The bridge owns the transform once a crash is running; leave it alone.
    if (!model.userData.gameCrash) {
      model.position.y += model.userData.groundOffsetY || 0;
    }
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

/**
 * Where the pilot actually sits in THIS model.
 *
 * The game keeps an eye point per aeroplane in types.js, measured against the
 * old models. The fleet aeroplanes are longer — the Meridian's flight deck is
 * eight metres forward of where the old one's was — so reusing the old figure
 * seats you in the middle of the cabin looking at the back of the cockpit
 * wall. Measured: skylark 0.86 m out, vanguard 2.3, tempest 5.0, meridian 8.0.
 *
 * `flightGeometry.eye` is the pack's own measurement of its own aeroplane, in
 * metres, already at final scale. Prefer it, and fall back to the game's own
 * figure for the models the game still builds itself.
 */
export function eyeFor(model, fallback) {
  const fg = model && model.userData && model.userData.flightGeometry;
  if (fg && Array.isArray(fg.eye)) return [...fg.eye];
  return fallback;
}

/**
 * How far to drop the model so its wheels meet the ground.
 *
 * Measured off the tyre meshes, not off the declared gear points: the pack
 * publishes AXLE positions, and a tyre hangs a wheel radius below its axle.
 * Trusting the declared figure pushed every aeroplane further into the tarmac
 * than it already was — the Meridian by half a metre.
 *
 * So the visible tyre bottom is measured and lined up with the contact height
 * the flight model actually lands on. That is the same place the old models
 * put theirs, so the fleet now sits exactly as the game has always sat.
 *
 * This moves the picture, not the aeroplane: the physics keeps its own gear
 * points, so contact, bounce and wing strikes are unchanged. Reconciling the
 * two properly means rewriting SPEC.gearPoints from the model, and SPEC is a
 * live module binding that the flight model, the taxi system and the crash
 * detection all read — not something a model pack should reach into.
 */
export function groundOffsetFor(model, spec) {
  if (!model || !spec || !spec.gearPoints || !spec.gearPoints.length) return 0;
  const gameLow = Math.min(...spec.gearPoints.map((p) => p.pos.y));
  if (!Number.isFinite(gameLow)) return 0;

  model.updateMatrixWorld(true);
  const box = new THREE.Box3();
  const tyres = new THREE.Box3().makeEmpty();
  let found = false;
  model.traverse((o) => {
    if (!o.isMesh || !/wheel|tyre|tire/i.test(o.name)) return;
    tyres.union(box.setFromObject(o));
    found = true;
  });
  if (!found) return 0;

  // Into the model's own frame, since that is where the offset is applied.
  const local = model.worldToLocal(new THREE.Vector3(0, tyres.min.y, 0));
  return gameLow - local.y;
}

/**
 * Navigation lights, strobes and a landing light for the fleet models.
 *
 * The fleet aeroplanes carry two always-on navigation lamps and nothing else:
 * no strobes, no beacon, no landing light, and no day/night response. Flying
 * the circuit at night, the aeroplane is simply a dark shape — which is the
 * one condition where an aeroplane is mostly its lights.
 *
 * So the game's own lamps are hung on the fleet model afterwards, positioned
 * from the wing span and length the model reports rather than guessed, and
 * driven by the same rule the built-in models use: barely visible in daylight,
 * the whole show at night.
 */
function addLights(model) {
  const fg = model.userData.flightGeometry;
  if (!fg) return null;
  const halfSpan = (fg.wingSpan || 10) / 2;
  const nose = fg.bounds ? fg.bounds.min[2] : -3;
  const tail = fg.bounds ? fg.bounds.max[2] : 4;
  const y = fg.eye ? fg.eye[1] - 0.35 : 0.2;

  const lights = {
    navLeft: [glowSprite(0xff2020, 0.42), [-halfSpan, y, tail * 0.1]],
    navRight: [glowSprite(0x20ff40, 0.42), [halfSpan, y, tail * 0.1]],
    tail: [glowSprite(0xffffff, 0.3), [0, y + 0.5, tail * 0.96]],
    strobeL: [glowSprite(0xffffff, 0.8), [-halfSpan, y, tail * 0.1 + 0.1]],
    strobeR: [glowSprite(0xffffff, 0.8), [halfSpan, y, tail * 0.1 + 0.1]],
    beacon: [glowSprite(0xff3010, 0.5), [0, y - 0.9, 0]],
    landing: [glowSprite(0xfff0c0, 0.75), [-halfSpan * 0.3, y - 0.2, nose * 0.35]],
  };
  for (const k in lights) {
    const [sprite, pos] = lights[k];
    sprite.position.set(pos[0], pos[1], pos[2]);
    sprite.userData.baseScale = sprite.scale.x;
    model.add(sprite);
    lights[k] = sprite;
  }

  // A real spot, so the landing light actually puts something on the runway.
  const spot = new THREE.SpotLight(0xfff0c8, 0, 260, 0.34, 0.45, 1.2);
  spot.position.set(0, y, nose * 0.5);
  const target = new THREE.Object3D();
  target.position.set(0, -0.3, nose - 60);
  model.add(target);
  spot.target = target;
  model.add(spot);

  return { lights, spot, t: 0 };
}

/**
 * Drive them. Strobes flash twice a second; the beacon turns; the landing
 * light comes on with the gear, which is what a real one does and is also the
 * version that teaches you something.
 */
function updateLights(rig, dt, ac, weather) {
  if (!rig) return;
  rig.t += dt;
  const dark = weather
    ? weather.isNight
      ? 1
      : weather.cond && weather.cond.cloud > 0.75
        ? 0.55
        : 0.18
    : 0.5;
  const on = ac.engineOn !== false || (ac.rpm || 0) > 0.05;
  const L = rig.lights;
  // Double flash: two quick pulses, then a gap. It reads as an aeroplane from
  // a long way off in a way that a steady blink does not.
  const cycle = rig.t % 1.4;
  const flash = cycle < 0.06 || (cycle > 0.16 && cycle < 0.22) ? 1 : 0;
  const set = (sprite, lit) => {
    sprite.material.opacity = lit * dark * 0.95;
    sprite.scale.setScalar(sprite.userData.baseScale * (0.55 + dark * 0.45) * (0.85 + lit * 0.3));
    sprite.visible = lit > 0.02;
  };
  set(L.navLeft, on ? 1 : 0);
  set(L.navRight, on ? 1 : 0);
  set(L.tail, on ? 0.8 : 0);
  set(L.strobeL, on ? flash : 0);
  set(L.strobeR, on ? flash : 0);
  set(L.beacon, on ? 0.4 + 0.6 * Math.abs(Math.sin(rig.t * 2.2)) : 0);
  const gearDown = (ac.gearPos ?? 1) > 0.5;
  const landing = on && gearDown ? 1 : 0;
  set(L.landing, landing);
  rig.spot.intensity = landing * (0.4 + dark * 2.6) * 90;
}

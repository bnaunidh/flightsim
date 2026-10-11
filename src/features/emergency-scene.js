/**
 * The emergency scene: a cordon of police cars, fire engines, ambulances
 * and helicopters raised round an incident, for any mission or feature.
 *
 *   import { raiseScene, clearScene, sceneState } from './emergency-scene.js';
 *
 *   const h = raiseScene(sim, {
 *     at: { x, z } | (sim) => ({ x, z }) | null,   // the incident; a function may return
 *                                                  //   null until it knows, and the scene waits
 *     kind: 'fire' | 'police' | 'crash',           // which crews come, when `crews` is not given
 *     radius: 200,                                 // the cordon ring, metres
 *     roads: true,                                 // police cars, cones, barriers and tape where
 *                                                  //   roads and streets enter the ring
 *     cordon: 'town',                              // and on that place's nearest street ends
 *     crews: { fire: 2, ambulance: 2, police: 4 }, // staged OUTSIDE the ring, facing it
 *     helis: { police: 1, news: 1, medevac: 1, fire: 0 }, // 'fire' carries a bucket (decorative)
 *     heliMinAgl: 150,                             // orbits at 150, 220, 300 m AGL, never under this
 *     keepClear: [{ x, z, r }],                    // the player's heli spot, the scoop lane…
 *     avoidRunway: true,                           // nothing on any runway strip
 *     label: 'Fire scene',                         // a minimap pin, APPENDED to sim.mapPins
 *   });
 *   h.update(dt); h.dispose();                     // or clearScene(sim, h); sceneState() for tests
 *
 * DECLARATIVE: a mission adds `scenes: [{ step: '<id>' | 'start', ...opts }]`
 * and this extension raises each one when that step begins and clears them
 * all when the flight ends. The Big Burn (game/extra/fire.js) and both
 * hijacks (game/extra/events.js) use it.
 *
 * PLACEMENT. Crews are staged outside the ring on dry, level ground: never
 * on a runway (with `avoidRunway`), never inside `keepClear`, never in the
 * water, never inside a building, never on top of each other. Helicopters
 * orbit at 150, 220 and 300 m AGL on radii of 600, 800 and 1000 m (so 500 m
 * or more off), 300 m from the player's predicted path (ambient/flyers.js's
 * HeliFlyer, with every rule it keeps). They are solid sky bodies in single
 * player and absent in a multiplayer lobby.
 *
 * LIGHT BARS go through Reduce flashing (emergency-scene/models.js
 * beaconLevels): a soft pulse at 1 Hz with the switch on, alternating sides
 * at 1.25 flashes a second each with it off — never more than three a
 * second. The police cars flash through events/vehicles.js's own
 * flashPolice, which already does the same.
 *
 * SCHOOL-SAFE: nobody is hurt; the crews stand by. An emergency scene thins
 * the ambient population within three times its radius (features/ambient.js
 * thinAround), so no ambient car drives through the cordon and no ambient
 * helicopter flies over it.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { heightAt, isOnAnyRunway, OBSTACLES, MAP } from '../world/terrain.js';
import { planTown } from '../world/scenery.js';
import { createPoliceCar, flashPolice } from './events/vehicles.js';
import { hijackInfo } from './events/bridge.js';
import { HeliFlyer } from './ambient/flyers.js';
import { createTender, createAmbulance, createCone, createBarrier, createTape, flashBeacons, beaconLevels } from './emergency-scene/models.js';
import { multiplayer } from './multiplayer.js';

export { beaconLevels };

/** Default crews by kind. */
export const CREWS = Object.freeze({
  fire: { fire: 3, ambulance: 2, police: 3 },
  police: { fire: 2, ambulance: 2, police: 4 },
  crash: { fire: 3, ambulance: 3, police: 3 },
});
/** Helicopter orbits: radius and height by order of arrival. */
export const HELI_RINGS = Object.freeze([{ r: 600, agl: 150 }, { r: 800, agl: 220 }, { r: 1000, agl: 300 }, { r: 1200, agl: 300 }]);
/** A vehicle's footprint radius for spacing, by kind. */
const SIZE = { fire: 5.5, ambulance: 3.8, police: 3 };
/** The runway margin a staged vehicle keeps, metres. */
export const RUNWAY_MARGIN = 30;

const E = {
  sim: null,
  scenes: [],
  nextId: 1,
  /** The declarative watch: which (def, step) scenes have been raised this flight. */
  raised: new Set(),
  watching: null,
};

const D2R = Math.PI / 180;

function bearing(ax, az, bx, bz) {
  return ((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI + 360) % 360;
}

/* ------------------------------------------------------------------ */
/* Ground tests                                                        */
/* ------------------------------------------------------------------ */

function dry(x, z) {
  return heightAt(x, z) > 1.5;
}

/** Dry and level across a footprint of radius r, off runways, clear of keepClear, buildings and others. */
export function spotOk(sc, x, z, r) {
  if (!dry(x, z)) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
    const h = heightAt(x + ox, z + oz);
    if (!(h > 1.5)) return false;
    if (h < lo) lo = h;
    if (h > hi) hi = h;
  }
  if (hi - lo > 1.4) return false;
  if (sc.avoidRunway && isOnAnyRunway(x, z, RUNWAY_MARGIN)) return false;
  for (const k of sc.keepClear) if (Math.hypot(k.x - x, k.z - z) < (k.r || 50) + r) return false;
  const y = heightAt(x, z);
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    if (o.y1 <= y + 0.5) continue;
    if (x >= o.x0 - r - 2 && x <= o.x1 + r + 2 && z >= o.z0 - r - 2 && z <= o.z1 + r + 2) return false;
  }
  for (const v of sc.occupied) if (Math.hypot(v.x - x, v.z - z) < v.r + r + 1.5) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Building a scene                                                    */
/* ------------------------------------------------------------------ */

function makeVehicle(kind) {
  if (kind === 'fire') return createTender();
  if (kind === 'ambulance') return createAmbulance();
  return createPoliceCar();
}

function put(sc, obj, x, z, headingDeg, kind, r) {
  obj.position.set(x, heightAt(x, z), z);
  obj.rotation.set(0, -headingDeg * D2R, 0);
  sc.group.add(obj);
  sc.occupied.push({ x, z, r, kind, heading: headingDeg, obj });
  return obj;
}

/** Stage `count` vehicles of `kind` outside the ring, facing the incident. */
function stage(sc, kind, count) {
  const r = SIZE[kind] || 3;
  const R = sc.radius;
  let placed = 0;
  for (let i = 0; i < count && placed < count; i++) {
    let done = false;
    for (let k = 0; k < 48 && !done; k++) {
      // Alternate sides of the base bearing, widening each time round.
      const side = k % 2 ? 1 : -1;
      const a = sc.baseAngle + side * ((i * 2 + Math.floor(k / 2)) * 11);
      for (const ring of [R + 25, R + 42, R + 62, R + 85]) {
        const x = sc.at.x + Math.sin(a * D2R) * ring;
        const z = sc.at.z - Math.cos(a * D2R) * ring;
        if (!spotOk(sc, x, z, r)) continue;
        put(sc, makeVehicle(kind), x, z, bearing(x, z, sc.at.x, sc.at.z), kind, r);
        placed++;
        done = true;
        break;
      }
    }
  }
  return placed;
}

/** The roads and streets to cordon: polylines of [x, z]. */
function polylines(sim) {
  const out = [];
  try {
    if (sim.ambient && typeof sim.ambient.polylines === 'function') {
      for (const p of sim.ambient.polylines() || []) if (p.pts && p.pts.length > 1) out.push({ pts: p.pts, kind: p.kind });
    }
  } catch (e) {
    /* no ambient layer */
  }
  if (!out.length) {
    for (const r of (sim.roads && sim.roads.list) || []) if (r.path && r.path.length > 1) out.push({ pts: r.path, kind: 'road' });
    try {
      const plan = planTown(MAP && MAP.scenery && MAP.scenery.town, 1);
      for (const st of (plan && plan.streets) || []) if (st.drawn && st.pts && st.pts.length > 1) out.push({ pts: st.pts, kind: 'street' });
    } catch (e) {
      /* no town */
    }
  }
  return out;
}

/** Where segment a-b crosses the circle (c, R), if it does: the point and the road's heading there. */
function ringCrossing(a, b, cx, cz, R) {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const fx = a[0] - cx;
  const fz = a[1] - cz;
  const A = dx * dx + dz * dz;
  const B = 2 * (fx * dx + fz * dz);
  const C = fx * fx + fz * fz - R * R;
  const disc = B * B - 4 * A * C;
  if (disc < 0 || A < 1e-9) return null;
  const s = Math.sqrt(disc);
  for (const t of [(-B - s) / (2 * A), (-B + s) / (2 * A)]) {
    if (t >= 0 && t <= 1) return { x: a[0] + dx * t, z: a[1] + dz * t, heading: bearing(a[0], a[1], b[0], b[1]) };
  }
  return null;
}

/** A police car across the road, cones and a barrier across it, tape between the cones. */
function cordonAt(sc, x, z, roadHeading) {
  const across = roadHeading + 90;
  const ax = Math.sin(across * D2R);
  const az = -Math.cos(across * D2R);
  // On the far side of the ring from the incident: 8 m out along the road, away from it.
  const out = bearing(sc.at.x, sc.at.z, x, z);
  const ox = Math.sin(out * D2R) * 8;
  const oz = -Math.cos(out * D2R) * 8;
  const cx = x + ox;
  const cz = z + oz;
  if (!spotOk(sc, cx, cz, 3)) return false;
  put(sc, createPoliceCar(), cx, cz, across, 'police', 3);
  const y = heightAt(cx, cz);
  const cones = [];
  for (const k of [-3, -1.5, 0, 1.5, 3]) {
    const cone = createCone();
    cone.position.set(cx + ax * k + ox * 0.6, heightAt(cx + ax * k, cz + az * k), cz + az * k + oz * 0.6);
    sc.group.add(cone);
    cones.push(cone);
  }
  const bar = createBarrier();
  bar.position.set(cx + ox * 1.2, heightAt(cx + ox * 1.2, cz + oz * 1.2), cz + oz * 1.2);
  bar.rotation.y = -across * D2R;
  sc.group.add(bar);
  const tape = createTape(cones[0].position.x, cones[0].position.z, cones[4].position.x, cones[4].position.z, y + 0.9);
  sc.group.add(tape);
  sc.tapes.push(tape);
  sc.cordons++;
  return true;
}

function cordonRoads(sc, sim) {
  const polys = polylines(sim);
  let n = 0;
  for (const p of polys) {
    for (let i = 1; i < p.pts.length && n < 6; i++) {
      const c = ringCrossing(p.pts[i - 1], p.pts[i], sc.at.x, sc.at.z, sc.radius + 12);
      if (!c) continue;
      if (cordonAt(sc, c.x, c.z, c.heading)) n++;
    }
  }
  return n;
}

/** Police cars on the street ends of a place nearest the incident, facing it. */
function cordonPlace(sc, sim, place) {
  let centre = null;
  const sc2 = MAP && MAP.scenery;
  if (place === 'town' && sc2 && sc2.town) centre = { x: sc2.town.cx, z: sc2.town.cz };
  else if (place && typeof place === 'object') centre = place;
  if (!centre) return 0;
  const polys = polylines(sim).filter((p) => p.kind === 'street' || p.kind === 'road');
  const ends = [];
  for (const p of polys) {
    for (const pt of [p.pts[0], p.pts[p.pts.length - 1]]) {
      if (Math.hypot(pt[0] - centre.x, pt[1] - centre.z) > 1500) continue;
      ends.push({ x: pt[0], z: pt[1], d: Math.hypot(pt[0] - sc.at.x, pt[1] - sc.at.z) });
    }
  }
  ends.sort((a, b) => a.d - b.d);
  let n = 0;
  for (const e of ends) {
    if (n >= 2) break;
    if (!spotOk(sc, e.x, e.z, 3)) continue;
    put(sc, createPoliceCar(), e.x, e.z, bearing(e.x, e.z, sc.at.x, sc.at.z), 'police', 3);
    n++;
  }
  return n;
}

function inLobby() {
  try {
    return !!(multiplayer && multiplayer.role);
  } catch (e) {
    return false;
  }
}

function raiseHelis(sc, sim) {
  if (inLobby()) return;
  const want = [];
  const H = sc.opts.helis || {};
  for (const role of ['police', 'news', 'medevac', 'fire']) for (let i = 0; i < (H[role] | 0); i++) want.push(role);
  const player = sim.aircraft && sim.aircraft.pos;
  want.forEach((role, i) => {
    const ring = HELI_RINGS[Math.min(i, HELI_RINGS.length - 1)];
    const agl = Math.max(ring.agl, sc.heliMinAgl);
    const f = new HeliFlyer(sim.scene, { id: `scene-${sc.id}-heli-${role}-${i}`, role: role === 'fire' ? 'bucket' : role, orbit: { x: sc.at.x, z: sc.at.z, r: ring.r }, agl });
    // On the far side of the ring from the player.
    let best = -Infinity;
    let bx = sc.at.x + ring.r;
    let bz = sc.at.z;
    let bh = 180;
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = sc.at.x + Math.sin(a) * ring.r;
      const z = sc.at.z - Math.cos(a) * ring.r;
      const d = player ? Math.hypot(x - player.x, z - player.z) : k;
      if (d > best) {
        best = d;
        bx = x;
        bz = z;
        bh = ((a * 180) / Math.PI + 90) % 360;
      }
    }
    f.place(bx, bz, null, bh);
    sc.helis.push(f);
  });
}

function build(sc, sim) {
  sc.group = new THREE.Group();
  sc.group.name = `emergency-scene:${sc.id}`;
  sim.scene.add(sc.group);
  const town = MAP && MAP.scenery && MAP.scenery.town;
  sc.baseAngle = town ? bearing(sc.at.x, sc.at.z, town.cx, town.cz) : 0;
  const crews = sc.opts.crews || CREWS[sc.kind] || CREWS.police;
  sc.staged = { fire: stage(sc, 'fire', crews.fire | 0), ambulance: stage(sc, 'ambulance', crews.ambulance | 0), police: stage(sc, 'police', crews.police | 0) };
  if (sc.opts.roads) cordonRoads(sc, sim);
  if (sc.opts.cordon) sc.cordonCars = cordonPlace(sc, sim, sc.opts.cordon);
  sc.hasPolice = sc.occupied.some((v) => v.kind === 'police');
  raiseHelis(sc, sim);
  // The pin: appended, never replacing anybody else's.
  if (sc.label) {
    sc.pin = { x: sc.at.x, z: sc.at.z, label: sc.label, colour: sc.kind === 'fire' ? '#ff6a3a' : '#5a8cff' };
    if (Array.isArray(sim.mapPins)) sim.mapPins.push(sc.pin);
    else {
      sim.mapPins = [sc.pin];
      sc.ownsPins = true;
    }
  }
  // The ambient population thins out round the scene.
  try {
    if (sim.ambient && typeof sim.ambient.thinAround === 'function') sc.thin = sim.ambient.thinAround(sc.at.x, sc.at.z, sc.radius * 3);
  } catch (e) {
    sc.thin = null;
  }
  sc.built = true;
}

/* ------------------------------------------------------------------ */
/* The API                                                             */
/* ------------------------------------------------------------------ */

function resolveAt(sc, sim) {
  const a = sc.opts.at;
  let p = typeof a === 'function' ? a(sim) : a;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.z)) return null;
  return { x: p.x, z: p.z };
}

export function raiseScene(sim, opts = {}) {
  const sc = {
    id: E.nextId++,
    opts,
    kind: opts.kind || 'police',
    radius: Math.max(40, opts.radius || 200),
    label: opts.label || null,
    keepClear: (opts.keepClear || []).filter((k) => k && Number.isFinite(k.x) && Number.isFinite(k.z)),
    avoidRunway: opts.avoidRunway !== false,
    heliMinAgl: Math.max(150, opts.heliMinAgl || 0),
    at: null,
    built: false,
    group: null,
    occupied: [],
    tapes: [],
    helis: [],
    cordons: 0,
    cordonCars: 0,
    staged: null,
    pin: null,
    ownsPins: false,
    thin: null,
    t: 0,
    gone: false,
    /** Raised from a mission's `scenes` (the extension's update), not by a feature's own call. */
    declared: false,
  };
  sc.at = resolveAt(sc, sim);
  if (sc.at) build(sc, sim);
  const ctx = { player: { pos: null, vel: null }, noFly: [], weather: null, missionPads: new Set() };
  const h = {
    id: sc.id,
    get pending() {
      return !sc.built && !sc.gone;
    },
    get at() {
      return sc.at;
    },
    update(dt) {
      if (sc.gone || !(dt > 0)) return;
      if (!sc.built) {
        sc.at = resolveAt(sc, sim);
        if (sc.at) build(sc, sim);
        return;
      }
      sc.t += dt;
      flashBeacons(sc.t);
      // The hijack flashes its own cars on its own clock; one clock at a time.
      if (sc.hasPolice && !(hijackInfo().police > 0)) flashPolice(sc.t);
      if (sc.helis.length) {
        const ac = sim.aircraft;
        ctx.player.pos = ac && ac.pos ? ac.pos : null;
        ctx.player.vel = ac && ac.vel ? ac.vel : null;
        ctx.weather = sim.weather || null;
        ctx.cam = sim.camera ? sim.camera.position : null;
        for (const f of sc.helis) if (!f.gone) f.update(dt, ctx);
      }
    },
    dispose() {
      disposeScene(sc, sim);
    },
    state() {
      return stateOf(sc);
    },
    _sc: sc,
  };
  E.scenes.push(h);
  return h;
}

function disposeScene(sc, sim) {
  if (sc.gone) return;
  sc.gone = true;
  for (const f of sc.helis) f.dispose();
  sc.helis.length = 0;
  if (sc.group) {
    sim.scene.remove(sc.group);
    for (const t of sc.tapes) if (t.userData.own) t.userData.own.dispose();
  }
  if (sc.pin && Array.isArray(sim.mapPins)) {
    const i = sim.mapPins.indexOf(sc.pin);
    if (i >= 0) sim.mapPins.splice(i, 1);
    if (sc.ownsPins && sim.mapPins.length === 0) sim.mapPins = null;
  }
  if (sc.thin && sim.ambient && typeof sim.ambient.unthin === 'function') {
    try {
      sim.ambient.unthin(sc.thin);
    } catch (e) {
      /* the ambient layer may be gone */
    }
  }
  const k = E.scenes.findIndex((h) => h._sc === sc);
  if (k >= 0) E.scenes.splice(k, 1);
}

export function clearScene(sim, h) {
  if (h && h._sc) disposeScene(h._sc, sim);
}

export function clearScenes(sim) {
  for (const h of E.scenes.slice()) disposeScene(h._sc, sim || E.sim);
}

function stateOf(sc) {
  return {
    id: sc.id,
    kind: sc.kind,
    at: sc.at,
    radius: sc.radius,
    built: sc.built,
    gone: sc.gone,
    vehicles: sc.occupied.map((v) => ({ kind: v.kind, x: v.x, z: v.z, heading: v.heading })),
    staged: sc.staged,
    cordons: sc.cordons,
    cordonCars: sc.cordonCars,
    helis: sc.helis.filter((f) => !f.gone).map((f) => ({ id: f.id, role: f.role, x: f.pos.x, y: f.pos.y, z: f.pos.z, r: f.orbit && f.orbit.r, agl: f.agl })),
    pin: sc.pin,
    thin: !!sc.thin,
    t: sc.t,
    declared: sc.declared,
  };
}

/** For the tests and the console. */
export function sceneState() {
  return { scenes: E.scenes.map((h) => stateOf(h._sc)), raised: Array.from(E.raised) };
}

/* ------------------------------------------------------------------ */
/* The extension: the declarative scenes                              */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'emergency-scene',

  install(sim) {
    E.sim = sim;
    sim.emergencyScene = { raise: (opts) => raiseScene(sim, opts), clear: (h) => clearScene(sim, h), clearAll: () => clearScenes(sim), state: sceneState };
  },

  startMode(sim, mode) {
    clearScenes(sim);
    E.raised.clear();
    E.watching = mode === 'mission' && sim.runner ? sim.runner.def : null;
  },

  /*
   * 'airport' is "Return to the airfield": the same flight carries on from
   * the runway (traffic.js, sky.js and ambient.js keep their state), so a
   * scene a feature raised itself stays up. The mission's own declared
   * scenes go, and are raised again as the mission — restarted from the top
   * by returnToAirport — reaches their steps: a hijack's cordon stood round
   * where the aeroplane stopped LAST time, and the Big Burn's fire scene
   * comes back on the first step either way. Anything else is the end of
   * the flight: everything goes.
   */
  stop(sim, why) {
    if (why === 'airport') {
      for (const h of E.scenes.slice()) if (h._sc.declared) disposeScene(h._sc, sim);
      E.raised.clear();
      return;
    }
    clearScenes(sim);
    E.raised.clear();
    E.watching = null;
  },

  update(sim, dt) {
    if (!(dt > 0)) return;
    const def = sim.mode === 'mission' && sim.runner ? sim.runner.def : null;
    if (def && Array.isArray(def.scenes) && sim.runner.status === 'running') {
      if (E.watching !== def) {
        E.watching = def;
        E.raised.clear();
      }
      const idx = sim.runner.stepIndex;
      const step = sim.runner.step;
      def.scenes.forEach((entry, i) => {
        if (!entry) return;
        const key = `${i}:${entry.step || 'start'}`;
        if (E.raised.has(key)) return;
        const want = entry.step === 'start' || entry.step == null ? idx >= 0 : !!(step && step.id === entry.step);
        if (!want) return;
        E.raised.add(key);
        try {
          // Marked as the mission's: it goes with "Return to the airfield" and comes back with the step.
          raiseScene(sim, entry)._sc.declared = true;
        } catch (e) {
          console.warn('[emergency-scene] could not raise a scene', e);
        }
      });
    }
    for (let i = E.scenes.length - 1; i >= 0; i--) E.scenes[i].update(dt);
  },
});

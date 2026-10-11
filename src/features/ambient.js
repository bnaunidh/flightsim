/**
 * Ambient NPCs: cars on the streets, boats on the water, helicopters and
 * aeroplanes in the sky, and aeroplanes through the airport — a population
 * for each of the 30 maps, from the data in src/world/ambient.js.
 *
 * LAYERS
 *   ground   ./ambient/cars.js on the lanes ./ambient/lanes.js reads off the
 *            town's streets (planTown) and the map's roads (sim.roads):
 *            instanced, LOD'd, with timed signals and headlights, yielding
 *            to the player's car. Never solid, and never on a runway: the
 *            lanes are cut 15 m short of either strip (lanes.js carveRunways),
 *            so nothing of this layer ever blocks the player's runway.
 *   water    ./ambient/boats.js on routes in deep water, off the channel,
 *            stopping for the player's boat. Never solid.
 *   air      ./ambient/flyers.js: helicopters on orbits and transits, and
 *            en-route aeroplanes on NpcFlyer. Never below 150 m AGL, never
 *            below 600 m inside the player's runway corridors, 300 m from
 *            the player's predicted path, starting 20 s into the flight and
 *            2.5 km away. In single player every one is a solid sky body
 *            (kind 'npc'; rotor:true for a helicopter), so the minimap
 *            draws it with no change of its own and flying into it is a
 *            mid-air bump that knocks it down. None of them uses a runway.
 *   airport  traffic.spawnTraffic(sim, 'depart', type), up to AIRPORT_CAP,
 *            only if settings.traffic !== false: parked aeroplanes that start
 *            up, fly their circuits and come back, under traffic's own runway
 *            rules, playerOnSlot and "your runway", unchanged. Nothing is
 *            dropped straight onto the final a player may be flying.
 *
 * TIERS  settings.quality: DENSITY scales the ground and water counts,
 * AIR_CAP and AIRPORT_CAP cap the flyers and the airport.
 *
 * MISSIONS  def.ambient is honoured: false | 'thin' | 'full' | { ground,
 * water, air, airport }. A mission that says nothing gets thin ground and
 * water and NO ambient aircraft, so no scripted story meets a solid stranger.
 * setAmbient(sim, level) and thinAround(x, z, r) are for any feature; an
 * emergency scene thins everything within three times its radius.
 *
 * MULTIPLAYER  local and decorative only: ground and water layers, no
 * ambient aircraft. Nothing is synced; the host's Dev-mode traffic and its
 * mirroring (mpworld.js) stay exactly as they were.
 *
 * COST  no per-frame allocation; matrices only for drawn instances, at half
 * rate beyond 600 m. ambientState() reports the update's running median.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { MAP, AIRPORT, heightAt, harbourMouth, harbourBerth } from '../world/terrain.js';
import { planTown, lighthouseSpot } from '../world/scenery.js';
import { PADS } from '../world/pads.js';
import { AMBIENT, ambientFor, countsFor, DENSITY, AIR_CAP, AIRPORT_CAP, MISSION_DEFAULT } from '../world/ambient.js';
import { buildLanes, routeAround, routeBetween, routeArrays, seaKeepOuts, nearestSea } from './ambient/lanes.js';
import { CarLayer } from './ambient/cars.js';
import { BoatLayer } from './ambient/boats.js';
import { HeliFlyer, PlaneFlyer } from './ambient/flyers.js';
import { spawnTraffic, trafficState } from './traffic.js';
import { multiplayer } from './multiplayer.js';
import { makeRandom } from '../core/noise.js';

export { DENSITY, AIR_CAP, AIRPORT_CAP };

/** Seconds into a flight before the air layer appears. */
export const AIR_START_S = 20;
/** Metres from the player a flyer first appears. */
export const AIR_START_FAR = 2500;

const A = {
  sim: null,
  group: null,
  world: null, // { mapId, quality, net, keep, places }
  cars: null,
  boats: null,
  flyers: [],
  pendingAir: [],
  airT: 0,
  on: false,
  mode: null,
  level: 'full',
  counts: null,
  traffic: { asked: 0, spawned: 0, refused: [] },
  thin: [], // { x, z, r }
  ctx: { player: { pos: null, vel: null }, noFly: [], weather: null, missionPads: new Set() },
  rnd: makeRandom(17),
  /** The update's cost: a ring of the last 600 frames, made once, never grown. */
  stats: { ms: new Float32Array(600), n: 0, msMax: 0, frames: 0, msSum: 0 },
  night: false,
  carsPlayer: { x: 0, z: 0, heading: 0 },
  boatsPlayer: { x: 0, z: 0 },
};

/* ------------------------------------------------------------------ */
/* Places                                                              */
/* ------------------------------------------------------------------ */

/** Resolve a semantic place reference to { x, z, y? } on the loaded map, or null. */
export function placeOf(ref, sim = A.sim) {
  if (!ref) return null;
  if (typeof ref === 'object' && Number.isFinite(ref.x) && Number.isFinite(ref.z)) return ref;
  if (typeof ref !== 'string') return null;
  const sc = (MAP && MAP.scenery) || {};
  if (ref.startsWith('pad:')) {
    const id = ref.slice(4);
    const p = PADS.find((q) => q.id === id);
    if (p && p.pos) return { x: p.pos.x, z: p.pos.z, y: p.pos.y, id, r: p.r };
    const d = ((MAP && (MAP.pads || sc.pads)) || []).find((q) => q.id === id);
    return d ? { x: d.x, z: d.z, y: heightAt(d.x, d.z), id, r: d.r } : null;
  }
  switch (ref) {
    case 'town':
      return sc.town ? { x: sc.town.cx, z: sc.town.cz } : null;
    case 'harbour': {
      const H = MAP && MAP.waters && MAP.waters.harbour;
      if (H && Number.isFinite(H.cx)) return { x: H.cx, z: H.cz };
      const m = harbourMouth();
      if (m) return { x: m.x, z: m.z };
      return placeOf('coast', sim);
    }
    case 'coast': {
      const t = sc.town ? { x: sc.town.cx, z: sc.town.cz } : { x: 0, z: 0 };
      const s = nearestSea({ channel: null, decks: [] }, t.x, t.z, 4000);
      return s ? { x: s[0], z: s[1] } : null;
    }
    case 'base':
      return sc.base ? { x: sc.base.cx || 0, z: sc.base.cz || 0 } : null;
    case 'field': {
      const r = AIRPORT && AIRPORT.runway;
      return r ? { x: r.cx, z: r.cz } : { x: 0, z: 0 };
    }
    case 'outpost':
      return MAP && MAP.outpost ? { x: MAP.outpost.cx, z: MAP.outpost.cz } : null;
    case 'bridge': {
      const b = MAP && MAP.features && MAP.features.bridge;
      return b ? { x: b.x, z: (b.from + b.to) / 2 } : null;
    }
    case 'volcano': {
      const v = (MAP && MAP.islands || []).find((i) => i.profile === 'cone');
      return v ? { x: v.cx, z: v.cz } : null;
    }
    case 'carrier': {
      const c = sim && sim.carrier && sim.carrier.pos;
      if (c) return { x: c.x, z: c.z };
      return MAP && MAP.carrier ? { x: MAP.carrier.x, z: MAP.carrier.z } : null;
    }
    case 'estate':
      return sc.estate ? { x: sc.estate.cx, z: sc.estate.cz } : null;
    case 'lighthouse': {
      // The map's own, or where scenery.js puts one when the map says nothing.
      try {
        const l = lighthouseSpot(MAP);
        return l ? { x: l.x, z: l.z } : null;
      } catch (e) {
        return sc.lighthouse ? { x: sc.lighthouse[0], z: sc.lighthouse[1] } : null;
      }
    }
    case 'berth': {
      const b = harbourBerth();
      return b ? { x: b.x, z: b.z } : null;
    }
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* The world: lanes and routes, once per map and detail level          */
/* ------------------------------------------------------------------ */

const QUALITY_DENSITY = { low: 0.35, medium: 0.65, high: 1, ultra: 1.8 };

/**
 * Lanes and boat routes for the loaded map. Pure enough for node: the town
 * is planned the way Scenery plans it (same density), the roads come from
 * `roads` (sim.roads.list), and the sea from the terrain.
 */
export function buildAmbientWorld({ mapId = MAP && MAP.id, quality = 'high', roads = [], sim = null } = {}) {
  const def = ambientFor(mapId);
  const sc = (MAP && MAP.scenery) || {};
  let streets = [];
  try {
    const plan = planTown(sc.town, QUALITY_DENSITY[quality] || 1);
    streets = (plan && plan.streets) || [];
  } catch (e) {
    streets = [];
  }
  const loops = [];
  const parks = [];
  for (const g of def.ground || []) {
    if (g.on && typeof g.on === 'object') {
      const p = placeOf(g.on.loop || g.on.park, sim);
      if (!p) continue;
      if (g.on.loop) loops.push({ cx: p.x, cz: p.z, r: g.on.r || 200, kind: `loop:${g.on.loop}` });
      else parks.push({ kind: g.kind, x: p.x, z: p.z, y: p.y != null ? p.y : heightAt(p.x, p.z), r: g.on.r || 30 });
    }
  }
  const town = sc.town ? { cx: sc.town.cx, cz: sc.town.cz, r: (sc.town.radius || 600) * 1.1 } : null;
  const net = buildLanes({ streets, roads, loops, town });
  const keep = seaKeepOuts(MAP);
  const routes = [];
  const rnd = makeRandom(97);
  for (const w of def.water || []) {
    let route = null;
    const R = w.route || {};
    if (R.between) {
      const a = placeOf(R.between[0], sim);
      const b = placeOf(R.between[1], sim);
      if (a && b) route = routeBetween(keep, [a.x, a.z], [b.x, b.z]);
      if (!route && a) route = routeAround(keep, a.x, a.z, 700, rnd);
    } else if (R.around) {
      const c = placeOf(R.around, sim);
      if (c) route = routeAround(keep, c.x, c.z, R.r || 700, rnd);
    }
    routes.push(route ? { entry: w, route, arrays: routeArrays(route) } : { entry: w, route: null, arrays: null });
  }
  return { mapId, quality, net, keep, routes, parks, streets: streets.length, roads: roads.length };
}

/* ------------------------------------------------------------------ */
/* Populating                                                          */
/* ------------------------------------------------------------------ */

function tierOf(sim) {
  const q = sim && sim.settings && sim.settings.quality;
  return DENSITY[q] != null ? q : 'high';
}

/** The ambient vehicles cast shadows at High and Ultra only (the shadow pass draws each mesh again). */
function shadowsFor(sim) {
  const t = tierOf(sim);
  return t === 'high' || t === 'ultra';
}

function mpLobby() {
  try {
    return !!(multiplayer && multiplayer.role);
  } catch (e) {
    return false;
  }
}

function levelFor(sim, mode) {
  if (mode === 'mission' || mode === 'tutorial') {
    const def = sim.runner && sim.runner.def;
    const want = def && def.ambient;
    if (want === undefined || want === null) return MISSION_DEFAULT;
    return want;
  }
  return 'full';
}

/**
 * The counts for this flight: the map, the tier (settings.quality, the one
 * being built — main.js sets qualityBuilt only after the world is up) and the
 * level, with no aircraft of any kind in a multiplayer lobby.
 */
function countsNow(sim, level) {
  if (level === false) return countsFor(MAP.id, tierOf(sim), false);
  if (!mpLobby()) return countsFor(MAP.id, tierOf(sim), level);
  const base = typeof level === 'object' ? level : level === 'thin' ? MISSION_DEFAULT : {};
  return countsFor(MAP.id, tierOf(sim), { ...base, air: 0, airport: 0 });
}

/**
 * Populate the ground, the water and the air queue from A.counts. The
 * airport layer is not here: it is traffic's, asked once per flight in
 * startMode, and traffic keeps its aeroplanes through a world rebuild.
 */
function populate(sim) {
  populateGround(sim, A.counts);
  populateWater(sim, A.counts);
  queueAir(sim, A.counts);
}

function laneKindsFor(on) {
  if (on === 'streets') return ['street'];
  if (on === 'roads') return ['road'];
  if (on === 'streets+roads') return ['street', 'road'];
  if (on && typeof on === 'object' && on.loop) return [`loop:${on.loop}`];
  return ['street', 'road'];
}

function populateGround(sim, counts) {
  const W = A.world;
  if (!W || !A.group) return;
  if (A.cars) {
    A.cars.dispose();
    A.cars = null;
  }
  const layer = new CarLayer(A.group, W.net, { shadows: shadowsFor(sim) });
  for (const g of counts.ground) {
    if (!g.count) continue;
    if (g.on && typeof g.on === 'object' && g.on.park) {
      const pk = W.parks.find((p) => p.kind === g.kind);
      if (pk) layer.populate(g.kind, g.count, { park: pk });
    } else {
      layer.populate(g.kind, g.count, { laneKinds: laneKindsFor(g.on) });
    }
  }
  layer.build();
  for (const t of A.thin) layer.thinAround(t.x, t.z, t.r);
  A.cars = layer;
}

function populateWater(sim, counts) {
  const W = A.world;
  if (!W || !A.group) return;
  if (A.boats) {
    A.boats.dispose();
    A.boats = null;
  }
  const layer = new BoatLayer(A.group, { shadows: shadowsFor(sim) });
  counts.water.forEach((w, i) => {
    const r = W.routes[i];
    if (!w.count || !r || !r.arrays) return;
    layer.populate(w.kind, w.count, r.arrays);
  });
  layer.build();
  for (const t of A.thin) layer.thinAround(t.x, t.z, t.r);
  A.boats = layer;
}

/** Queue the flyers; they appear at AIR_START_S, far from the player. */
function queueAir(sim, counts) {
  A.pendingAir = [];
  for (const e of counts.air) A.pendingAir.push(e);
}

/** Build one queued flyer, placed at least AIR_START_FAR from the player. */
function startFlyer(sim, e) {
  const player = sim.aircraft && sim.aircraft.pos ? sim.aircraft.pos : null;
  let orbit = null;
  let transit = null;
  if (e.transit) {
    const a = placeOf(e.transit[0], sim);
    const b = placeOf(e.transit[1], sim);
    if (!a || !b) return null;
    transit = [a, b];
  } else if (e.orbit) {
    const c = placeOf(e.orbit, sim);
    if (!c) return null;
    orbit = { x: c.x, z: c.z, r: e.r || 1000 };
  } else return null;
  const land = e.land ? placeOf(e.land, sim) : null;
  const opts = { id: `ambient-${e.kind}-${e.role}-${A.flyers.length}`, role: e.role, orbit, transit, agl: e.agl, alt: e.alt || null, land: land && land.id ? land : null, shy: e.shy, sep: e.sep, type: e.type };
  // Where to appear: on the pattern, as far from the player as the pattern allows.
  let x;
  let z;
  let hdg = 0;
  if (orbit) {
    let best = -Infinity;
    for (let k = 0; k < 12; k++) {
      const ang = (k / 12) * Math.PI * 2;
      const px = orbit.x + Math.sin(ang) * orbit.r;
      const pz = orbit.z - Math.cos(ang) * orbit.r;
      const d = player ? Math.hypot(px - player.x, pz - player.z) : Infinity;
      if (d > best) {
        best = d;
        x = px;
        z = pz;
        hdg = ((ang * 180) / Math.PI + 90) % 360;
      }
    }
    if (best < AIR_START_FAR) return false; // not yet: the player is on top of the pattern
  } else {
    const a = transit[0];
    const b = transit[1];
    const da = player ? Math.hypot(a.x - player.x, a.z - player.z) : Infinity;
    const db = player ? Math.hypot(b.x - player.x, b.z - player.z) : Infinity;
    const start = da >= db ? a : b;
    if (Math.max(da, db) < AIR_START_FAR) return false;
    x = start.x;
    z = start.z;
    const other = start === a ? b : a;
    hdg = Math.atan2(other.x - x, -(other.z - z)) * (180 / Math.PI);
  }
  let f = null;
  try {
    f = e.kind === 'heli' ? new HeliFlyer(sim.scene, opts) : new PlaneFlyer(sim.scene, opts);
    f.place(x, z, null, hdg);
    if (f.transit && transit) f.leg = 1;
  } catch (err) {
    console.warn('[ambient] a flyer could not be built', err);
    return null;
  }
  A.flyers.push(f);
  return f;
}

/** Parking slots the airport layer always leaves free for the traffic's other callers. */
export const SPARE_SLOTS = 2;

/** How many of the traffic's parking slots are free right now, or null before its field is built. */
function freeSlots() {
  try {
    const st = trafficState();
    const f = st && st.field;
    if (!f || !f.ok || !Array.isArray(f.slots)) return null;
    let n = 0;
    for (const s of f.slots) if (!s.owner) n++;
    return n;
  } catch (e) {
    return null;
  }
}

function spawnAirport(sim, counts) {
  A.traffic = { asked: 0, spawned: 0, refused: [] };
  const ap = counts.airport;
  if (!ap || !ap.n) return;
  if (sim.settings && sim.settings.traffic === false) {
    A.traffic.refused.push('settings.traffic is off');
    return;
  }
  const types = ap.types || [];
  for (let i = 0; i < ap.n; i++) {
    const type = types.length ? types[i % types.length] : null;
    /*
     * Leave the apron room for everybody else who asks the traffic for an
     * aeroplane — the Dev panel, a mission's `traffic`, the tests: at least
     * SPARE_SLOTS free parking slots after this one. On Kestrel at High the
     * airport's own six parked aeroplanes leave four slots; three departures
     * took three, and the sky check's arrival had "nowhere free to park".
     */
    const freeNow = freeSlots();
    if (freeNow != null && freeNow <= SPARE_SLOTS) {
      A.traffic.refused.push(`${type || 'any'}: leaving ${freeNow} parking slot${freeNow === 1 ? '' : 's'} free for others`);
      break;
    }
    /*
     * Parked and about to go, never dropped straight onto final: an arrival
     * spawned 2.5 km out is on the approach a player starting in the air may
     * be flying (the instruments check's PAPI approach met one and got a
     * TRAFFIC advisory). A departure waits on its stand, and traffic's own
     * R1-R4 hold it short while you are on final or on the runway; it comes
     * back to land later, in the circuit, under the same rules.
     */
    const how = 'depart';
    A.traffic.asked++;
    let r = spawnTraffic(sim, how, type);
    if (!r.ok && type) r = spawnTraffic(sim, how, null);
    if (r.ok) A.traffic.spawned++;
    else A.traffic.refused.push(`${type || 'any'}: ${r.why}`);
  }
}

/* ------------------------------------------------------------------ */
/* The API                                                             */
/* ------------------------------------------------------------------ */

/**
 * Set the population level for this flight: 'full' | 'thin' | false |
 * { ground, water, air, airport } (ground/water as multipliers, air/airport
 * as caps). Rebuilds the ground and water layers; flyers beyond the cap
 * are removed, and new ones queue for the next air start.
 */
export function setAmbient(sim, level = 'full') {
  if (!A.on || !sim) return false;
  A.level = level;
  A.counts = countsNow(sim, level);
  populateGround(sim, A.counts);
  populateWater(sim, A.counts);
  const cap = A.counts.air.length;
  while (A.flyers.length > cap) A.flyers.pop().dispose();
  if (A.flyers.length < cap) {
    A.pendingAir = A.counts.air.slice(A.flyers.length);
  } else A.pendingAir = [];
  return true;
}

/** Keep the ground and water layers out of a circle, and the flyers out of the air over it. */
export function thinAround(x, z, r) {
  const t = { x, z, r };
  A.thin.push(t);
  A.ctx.noFly.push(t);
  if (A.cars) A.cars.thinAround(x, z, r);
  if (A.boats) A.boats.thinAround(x, z, r);
  return t;
}

/** Undo one thinAround (its returned handle). */
export function unthin(handle) {
  const i = A.thin.indexOf(handle);
  if (i >= 0) A.thin.splice(i, 1);
  const j = A.ctx.noFly.indexOf(handle);
  if (j >= 0) A.ctx.noFly.splice(j, 1);
  if (A.cars) {
    A.cars.clearThin();
    for (const t of A.thin) A.cars.thinAround(t.x, t.z, t.r);
  }
  if (A.boats) {
    A.boats.clearThin();
    for (const t of A.thin) A.boats.thinAround(t.x, t.z, t.r);
  }
}

function median(ring, n) {
  if (!n) return 0;
  const s = Array.from(ring.subarray(0, Math.min(n, ring.length))).sort((a, b) => a - b);
  return s[s.length >> 1];
}

/** For the tests and the console. */
export function ambientState() {
  return {
    on: A.on,
    mode: A.mode,
    level: A.level,
    tier: A.counts ? A.counts.tier : null,
    /** The detail level the lanes were planned at (the town's street density follows it). */
    quality: A.world ? A.world.quality : null,
    mapId: A.world ? A.world.mapId : null,
    lanes: A.world ? A.world.net.lanes.length : 0,
    signals: A.world ? A.world.net.signals.filter((s) => s.lanes.length).length : 0,
    routes: A.world ? A.world.routes.filter((r) => r.arrays).length : 0,
    cars: A.cars ? A.cars.cars.length : 0,
    carsDrawn: A.cars ? A.cars.stats.drawn : 0,
    boats: A.boats ? A.boats.boats.length : 0,
    flyers: A.flyers.filter((f) => !f.gone).map((f) => ({ id: f.id, role: f.role, kind: f instanceof HeliFlyer ? 'heli' : 'plane', x: Math.round(f.pos.x), y: Math.round(f.pos.y), z: Math.round(f.pos.z), minClear: Math.round(f.minClear), evades: f.stats.evades, knocked: !!f.knocked })),
    pendingAir: A.pendingAir.length,
    airT: A.airT,
    traffic: A.traffic,
    thin: A.thin.slice(),
    update: { median: median(A.stats.ms, A.stats.n), max: A.stats.msMax, mean: A.stats.frames ? A.stats.msSum / A.stats.frames : 0, frames: A.stats.frames },
    counts: A.counts ? { ground: A.counts.ground.map((g) => `${g.kind}:${g.count}`), water: A.counts.water.map((w) => `${w.kind}:${w.count}`), air: A.counts.air.length, airport: A.counts.airport } : null,
  };
}

/** The flyers, for a test that wants to walk them. */
export function ambientFlyers() {
  return A.flyers;
}

function missionPads(sim) {
  const set = A.ctx.missionPads;
  set.clear();
  const def = sim.mode === 'mission' && sim.runner && sim.runner.def;
  if (!def || !def.steps) return set;
  for (const st of def.steps) {
    if (st && typeof st.pad === 'string') set.add(st.pad);
    if (st && st.target && typeof st.target === 'object' && typeof st.target.pad === 'string') set.add(st.target.pad);
  }
  return set;
}

function clearFlight() {
  for (const f of A.flyers) f.dispose();
  A.flyers.length = 0;
  A.pendingAir = [];
  if (A.cars) A.cars.setVisible(false);
  if (A.boats) A.boats.setVisible(false);
  A.on = false;
  A.mode = null;
  A.airT = 0;
  A.thin.length = 0;
  A.ctx.noFly.length = 0;
  A.stats.n = 0;
  A.stats.msMax = 0;
  A.stats.frames = 0;
  A.stats.msSum = 0;
  A.traffic = { asked: 0, spawned: 0, refused: [] };
}

/* ------------------------------------------------------------------ */
/* The extension                                                       */
/* ------------------------------------------------------------------ */

const PV = new THREE.Vector3();

registerExtension({
  id: 'ambient',

  install(sim) {
    A.sim = sim;
    sim.ambient = API;
  },

  /*
   * Every world (re)build: at boot, on a map change, and when the player
   * picks another Graphics quality mid-flight (main.js rebuildQuality →
   * buildWorld). The lanes are planned again at the new detail level, since
   * the town's street density follows it; and if a flight is on, the layers
   * go up again at once from the new tier — the old ones went with the old
   * world, and nothing else would put them back before the next flight.
   * settings.quality is the tier being built: main.js sets qualityBuilt
   * only after this hook has run, so reading it here gave the tier before.
   */
  buildWorld(sim, group) {
    A.group = group;
    group.name = 'ext:ambient';
    if (A.cars) {
      A.cars.dispose();
      A.cars = null;
    }
    if (A.boats) {
      A.boats.dispose();
      A.boats = null;
    }
    for (const f of A.flyers) f.dispose();
    A.flyers.length = 0;
    A.pendingAir = [];
    const t0 = performance.now();
    try {
      A.world = buildAmbientWorld({ mapId: MAP.id, quality: tierOf(sim), roads: (sim.roads && sim.roads.list) || [], sim });
      A.world.buildMs = performance.now() - t0;
    } catch (e) {
      console.warn('[ambient] could not plan the lanes for this map', e);
      A.world = null;
    }
    if (A.on && A.world && A.level !== false) {
      // The flight carries on: the same level, the new tier. The flyers queue
      // again and, past AIR_START_S, appear at once, 2.5 km from the player.
      A.counts = countsNow(sim, A.level);
      populate(sim);
    }
  },

  startMode(sim, mode, opts) {
    clearFlight();
    if (!A.world || A.world.mapId !== MAP.id) {
      try {
        A.world = buildAmbientWorld({ mapId: MAP.id, quality: tierOf(sim), roads: (sim.roads && sim.roads.list) || [], sim });
      } catch (e) {
        A.world = null;
      }
    }
    if (!A.world) return;
    A.on = true;
    A.mode = mode;
    A.level = levelFor(sim, mode);
    A.counts = countsNow(sim, A.level);
    if (A.level === false) return;
    populate(sim);
    missionPads(sim);
    // The airport layer only in a flight, never in a lobby or a drive.
    if ((mode === 'free' || mode === 'mission') && !mpLobby()) spawnAirport(sim, A.counts);
  },

  /*
   * 'airport' is "Return to the airfield" (the HUD's tower button, the pause
   * menu): the same flight carries on from the runway, as traffic.js and
   * sky.js treat it, so the cars, the boats and the helicopters stay. A
   * mission restarting from the top keeps them too: its level has not
   * changed. 'menu' and everything else is the end of the flight.
   */
  stop(sim, why) {
    if (why === 'airport') return;
    clearFlight();
  },

  update(sim, dt) {
    if (!A.on || !(dt > 0)) return;
    const t0 = performance.now();
    const cam = sim.camera ? sim.camera.position : PV;
    const w = sim.weather;
    A.night = !!(w && w.isNight);
    const driving = sim.mode === 'drive' && sim.vehicle && sim.vehicle.pos;
    let carPlayer = null;
    let boatPlayer = null;
    if (driving) {
      if (sim.vehicle.isBoat) {
        A.boatsPlayer.x = sim.vehicle.pos.x;
        A.boatsPlayer.z = sim.vehicle.pos.z;
        boatPlayer = A.boatsPlayer;
      } else {
        A.carsPlayer.x = sim.vehicle.pos.x;
        A.carsPlayer.z = sim.vehicle.pos.z;
        A.carsPlayer.heading = sim.vehicle.heading || 0;
        carPlayer = A.carsPlayer;
      }
    }
    if (A.cars) A.cars.update(dt, cam, A.night, carPlayer);
    if (A.boats) A.boats.update(dt, cam, boatPlayer, w && w.cond ? w.cond.turb || 0 : 0);
    // The air layer, from T+20 s.
    if (A.pendingAir.length || A.flyers.length) {
      A.airT += dt;
      const ac = sim.aircraft;
      A.ctx.player.pos = ac && ac.pos ? ac.pos : null;
      A.ctx.player.vel = ac && ac.vel ? ac.vel : null;
      A.ctx.weather = w;
      A.ctx.cam = cam;
      if (A.pendingAir.length && A.airT >= AIR_START_S) {
        const e = A.pendingAir[0];
        const f = startFlyer(sim, e);
        // null: it cannot be placed on this map, drop it; false: the player is too close, try later.
        if (f !== false) A.pendingAir.shift();
        else if (A.airT > AIR_START_S + 120) A.pendingAir.shift();
      }
      for (let i = 0; i < A.flyers.length; i++) {
        const f = A.flyers[i];
        if (f.gone) continue;
        f.update(dt, A.ctx);
      }
      // Tidy the ones that have come down.
      for (let i = A.flyers.length - 1; i >= 0; i--) if (A.flyers[i].gone) A.flyers.splice(i, 1);
    }
    const ms = performance.now() - t0;
    A.stats.frames++;
    A.stats.msSum += ms;
    if (ms > A.stats.msMax) A.stats.msMax = ms;
    A.stats.ms[A.stats.n % 600] = ms;
    A.stats.n++;
  },

  devActions: [
    {
      label: 'Ambient: thin it out here',
      hint: 'Clears the ambient cars and boats within 600 m, and keeps the flyers off',
      run(sim) {
        const p = sim.aircraft && sim.aircraft.pos;
        if (p) thinAround(p.x, p.z, 600);
      },
    },
    {
      label: 'Ambient: full population now',
      hint: 'setAmbient(full): every layer this map has, at this detail level',
      run(sim) {
        setAmbient(sim, 'full');
      },
    },
  ],
});

const API = {
  state: ambientState,
  setAmbient: (level) => setAmbient(A.sim, level),
  thinAround,
  unthin,
  placeOf: (ref) => placeOf(ref, A.sim),
  flyers: ambientFlyers,
  data: AMBIENT,
  /** Force the air layer to start now (the tests). */
  startAirNow: () => {
    A.airT = Math.max(A.airT, AIR_START_S);
  },
  /** The streets and roads the lanes were read off, for a cordon (emergency-scene.js). */
  polylines: () => (A.world ? A.world.net.polylines : []),
  /** The ground vehicles' live records ({ kind, px, pz, … }), for a test that watches where they drive. */
  vehicles: () => (A.cars ? A.cars.cars : []),
};

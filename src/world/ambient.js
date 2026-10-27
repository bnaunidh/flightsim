/**
 * Who else is about on each map: the ambient population, as data.
 *
 * Every one of the 30 map ids has an entry. Each names what moves on the
 * ground, on the water, in the air and through the airport, with HIGH-tier
 * counts; the runtime (src/features/ambient.js) scales them by DENSITY and
 * caps the flyers and the airport traffic by tier. Nothing here is drawn or
 * moved: this file is read by the runtime and by tests/features/ambient.mjs.
 *
 * POSITIONS ARE SEMANTIC. A place is named, never typed as a coordinate,
 * wherever the map names it — so the phase-2 re-layouts that move a town, a
 * harbour or a pad move the population with them:
 *
 *   'town'          the map's town centre (scenery.town)
 *   'harbour'       the harbour basin (waters.harbour), or the town's coast
 *   'coast'         the sea nearest the town
 *   'base'          the air base (scenery.base)
 *   'field'         the main runway's middle
 *   'outpost'       the outlying strip
 *   'bridge'        the middle of the map's bridge (features.bridge)
 *   'volcano'       the first 'cone' island's summit
 *   'carrier'       the carrier's berth
 *   'estate'        the airport estate (scenery.estate)
 *   'lighthouse'    scenery.lighthouse
 *   'pad:<id>'      a helipad by id
 *   { x, z }        only where nothing names the place
 *
 * GROUND entries: { kind, n, on }, where `on` is
 *   'streets'            the town's streets (planTown, the ones that are drawn)
 *   'roads'              the map's road network (sim.roads)
 *   'streets+roads'      both
 *   { loop: place, r }   a circuit round a place, carved to dry level ground
 *   { park: place, r }   parked, standing still, round a place
 * and `kind` is one of car, taxi, bus, van, truck, jeep, fourx4, tractor,
 * firetruck.
 *
 * WATER entries: { kind, n, route }, where `route` is
 *   { around: place, r }       a ring in deep water round a place
 *   { between: [a, b] }        back and forth between two places
 * and `kind` is one of ferry, trawler, yacht, barge, lifeboat, rhib, supply,
 * patrol, dive. Boats keep 3 m of water under them, 60 m off any channel
 * centreline and 60 m from any deck pad.
 *
 * AIR entries: { kind: 'heli' | 'plane', role, type?, orbit | transit, r, agl
 * | alt, land?, shy?, sep? }:
 *   orbit: place, r         circle a place at radius r
 *   transit: [a, b]         fly between two places and back
 *   agl                     metres above the ground (never under 150)
 *   alt                     metres above the sea instead (a tanker)
 *   land: 'pad:<id>'        a medevac may set down there while the player is
 *                           1.5 km away and lifts off if they come within 800 m
 *   shy: metres             holds off while the player is nearer than this
 *   sep: metres             a bigger separation than the 300 m rule
 *   roles                   police, news, medevac, tour, sar, coastguard,
 *                           rescue, crew, guard, patrol, ga, bush, spotter,
 *                           tanker, transport
 * None of them ever uses a runway.
 *
 * AIRPORT: { types, n } — aeroplanes through the traffic feature
 * (spawnTraffic), which uses the runway under its own rules.
 */

/** Ground and water counts, as a fraction of each map's High count. */
export const DENSITY = Object.freeze({ low: 0.2, medium: 0.5, high: 1.0, ultra: 1.5 });
/** Flyers (helicopters and en-route aeroplanes) at most, per tier. */
export const AIR_CAP = Object.freeze({ low: 1, medium: 2, high: 3, ultra: 4 });
/**
 * Airport traffic through traffic.js at most, per tier (its own MAX_AIRCRAFT
 * is 6). The plan's table had Medium at 1 and High at 3, but one traffic
 * aeroplane is traffic.js's own model: measured +27 draw calls on Kestrel at
 * Medium (over the +10 the population is allowed there) and three parked
 * airliners +111 on Gateway's apron at High (+1.3 ms, over the +1.2
 * budget). So Medium gets none, as Low does, High two, and Ultra the four.
 */
export const AIRPORT_CAP = Object.freeze({ low: 0, medium: 0, high: 2, ultra: 4 });

/** A mission that says nothing gets this: thin ground and water, no aircraft. */
export const MISSION_DEFAULT = Object.freeze({ ground: 0.3, water: 0.5, air: 0, airport: 0 });
/** 'thin' and 'full', as a mission or setAmbient() may ask. */
export const LEVELS = Object.freeze({
  thin: Object.freeze({ ground: 0.3, water: 0.5, air: 0, airport: 0 }),
  // ground/water are multipliers; air/airport are caps (the tier's own, here).
  full: Object.freeze({ ground: 1, water: 1, air: Infinity, airport: Infinity }),
});

export const GROUND_KINDS = Object.freeze(['car', 'taxi', 'bus', 'van', 'truck', 'jeep', 'fourx4', 'tractor', 'firetruck']);
export const BOAT_KINDS = Object.freeze(['ferry', 'trawler', 'yacht', 'barge', 'lifeboat', 'rhib', 'supply', 'patrol', 'dive']);
export const HELI_ROLES = Object.freeze(['police', 'news', 'medevac', 'tour', 'sar', 'coastguard', 'rescue', 'crew', 'guard']);
export const PLANE_ROLES = Object.freeze(['ga', 'bush', 'spotter', 'tanker', 'transport', 'patrol', 'guard']);

const car = (n, on = 'streets') => ({ kind: 'car', n, on });
const vans = (n, on = 'streets') => ({ kind: 'van', n, on });
const heli = (role, orbit, r, agl, extra = {}) => ({ kind: 'heli', role, orbit, r, agl, ...extra });
const plane = (role, type, orbit, r, agl, extra = {}) => ({ kind: 'plane', role, type, orbit, r, agl, ...extra });
const transit = (role, type, from, to, agl, extra = {}) => ({ kind: 'plane', role, type, transit: [from, to], agl, ...extra });
const boats = (kind, n, around, r) => ({ kind, n, route: { around, r } });

/** Cars and a couple of boats: what a small island gets. */
const smallIsland = (cars, boatN = 2, extraWater = [], air = []) => ({
  ground: [car(cars, 'streets')],
  water: [boats('trawler', boatN, 'harbour', 700), ...extraWater],
  air,
  airport: null,
});

export const AMBIENT = Object.freeze({
  /* ---- flight maps ---- */
  kestrel: {
    ground: [car(12, 'streets+roads'), vans(3, 'streets+roads')],
    water: [{ kind: 'ferry', n: 1, route: { between: ['harbour', 'pad:mango'] } }, boats('trawler', 3, 'harbour', 800), boats('yacht', 2, 'coast', 900)],
    air: [heli('tour', 'town', 1200, 300), plane('ga', 'courier', 'town', 2600, 450)],
    airport: { types: ['skylark', 'courier', 'meridian'], n: 3 },
  },
  meadow: {
    ground: [car(18, 'streets'), { kind: 'tractor', n: 4, on: 'streets' }, vans(3, 'streets')],
    water: [boats('trawler', 1, 'harbour', 700)],
    // A crop-duster's circuit over the farmland, away from the runway.
    air: [plane('ga', 'skylark', 'town', 2200, 350)],
    airport: { types: ['skylark', 'courier'], n: 2 },
  },
  atoll: {
    ground: [car(4, 'streets')],
    water: [boats('dive', 2, 'harbour', 700), boats('trawler', 2, 'coast', 900), { kind: 'ferry', n: 1, route: { between: ['harbour', 'pad:turtle'] } }],
    air: [heli('tour', 'town', 1500, 300), transit('ga', 'courier', 'town', 'pad:turtle', 400)],
    airport: { types: ['skylark', 'courier'], n: 2 },
  },
  fjord: {
    ground: [car(8, 'streets')],
    water: [{ kind: 'ferry', n: 1, route: { around: 'harbour', r: 900 } }, boats('trawler', 2, 'harbour', 700)],
    // The bush plane is the courier; the rescue helicopter stays high and clear of the walls.
    air: [transit('bush', 'courier', 'outpost', 'town', 500), heli('rescue', 'town', 1600, 350)],
    airport: { types: ['skylark', 'courier'], n: 2 },
  },
  ember: {
    ground: [car(8, 'streets')],
    water: [boats('trawler', 2, 'harbour', 700)],
    // Round the volcano, well outside its crater (radius 240 m + 800).
    air: [heli('tour', 'volcano', 1300, 400)],
    airport: { types: ['skylark', 'courier'], n: 2 },
  },
  airbase: {
    ground: [{ kind: 'truck', n: 8, on: { loop: 'base', r: 760 } }, { kind: 'jeep', n: 4, on: { loop: 'base', r: 900 } }],
    water: [],
    // A tanker's racetrack at 6 km, and a transport passing over.
    air: [plane('tanker', 'b747', 'base', 6000, 0, { alt: 6000, livery: 'grey' }), transit('transport', 'tempest', 'outpost', 'base', 1200)],
    airport: { types: ['vanguard', 'f22', 'fa18'], n: 3 },
  },
  gateway: {
    ground: [car(70, 'streets'), { kind: 'taxi', n: 12, on: 'streets' }, { kind: 'bus', n: 6, on: 'streets' }, vans(10, 'streets')],
    water: [{ kind: 'ferry', n: 2, route: { between: ['harbour', 'bridge'] } }, boats('yacht', 3, 'harbour', 1100)],
    air: [heli('police', 'town', 900, 300), heli('news', 'town', 1300, 400), heli('medevac', 'town', 700, 250, { land: 'pad:hospital' }), heli('tour', 'bridge', 700, 220)],
    airport: { types: ['a320', 'b747', 'a380', 'meridian'], n: 4 },
  },
  northwatch: {
    ground: [{ kind: 'truck', n: 6, on: { loop: 'base', r: 760 } }, car(8, 'streets')],
    water: [boats('trawler', 2, 'harbour', 700), boats('patrol', 1, 'carrier', 900)],
    air: [plane('patrol', 'tempest', 'field', 5000, 900), heli('sar', 'harbour', 1500, 300)],
    airport: { types: ['f22', 'fa18'], n: 3 },
  },
  nunatak: {
    // Caribou Base's trucks on their loop; the plain is otherwise empty, which is the point of it.
    ground: [{ kind: 'truck', n: 4, on: { loop: 'base', r: 700 } }, car(4, 'streets')],
    water: [boats('patrol', 1, 'harbour', 800)],
    // A transport shuttling between the base and the Site's strip, and the rescue helicopter.
    air: [transit('transport', 'tempest', 'outpost', 'base', 1100), heli('sar', 'town', 1400, 300)],
    airport: { types: ['courier', 'tempest'], n: 2 },
  },
  condor: {
    ground: [car(8, 'streets')],
    water: [boats('trawler', 3, 'harbour', 800)],
    // Round the stacks south of the town: clear of the Beak (north) and the corridor.
    air: [heli('tour', 'town', 1200, 300)],
    airport: { types: ['skylark', 'courier'], n: 2 },
  },

  /* ---- boat maps: the harbour and the channel are the game; boats stay 60 m off the channel ---- */
  sennen: {
    ground: [car(6, 'streets')],
    water: [boats('trawler', 2, 'harbour', 900), { kind: 'lifeboat', n: 1, route: { around: 'harbour', r: 1200 } }],
    air: [heli('coastguard', 'harbour', 1500, 300), plane('ga', 'skylark', 'outpost', 2500, 500)],
    airport: null,
  },
  skerries: {
    ground: [car(4, 'streets')],
    water: [boats('trawler', 3, 'harbour', 900), { kind: 'ferry', n: 1, route: { around: 'harbour', r: 1400 } }],
    air: [heli('sar', 'harbour', 1500, 300)],
    airport: null,
  },
  longbank: {
    ground: [car(8, 'streets')],
    water: [boats('trawler', 2, 'harbour', 900), { kind: 'barge', n: 1, route: { around: 'harbour', r: 1300 } }, { kind: 'lifeboat', n: 1, route: { around: 'harbour', r: 1100 } }],
    air: [heli('coastguard', 'harbour', 1600, 300), plane('ga', 'courier', 'outpost', 2400, 450)],
    airport: null,
  },
  archipelago: {
    ground: [car(2, 'streets')],
    water: [boats('dive', 2, 'harbour', 900), { kind: 'ferry', n: 1, route: { between: ['harbour', 'outpost'] } }, boats('yacht', 1, 'coast', 1200)],
    air: [heli('tour', 'town', 1500, 300), transit('ga', 'courier', 'outpost', 'town', 450)],
    airport: null,
  },
  delta: {
    ground: [car(5, 'streets')],
    water: [{ kind: 'barge', n: 2, route: { around: 'harbour', r: 1200 } }, boats('trawler', 2, 'harbour', 900)],
    air: [heli('coastguard', 'harbour', 1600, 300)],
    airport: null,
  },
  harbour: {
    ground: [car(7, 'streets')],
    water: [boats('trawler', 3, 'harbour', 900), { kind: 'lifeboat', n: 1, route: { around: 'harbour', r: 1200 } }, boats('yacht', 1, 'coast', 1000)],
    air: [heli('coastguard', 'harbour', 1500, 300), plane('ga', 'skylark', 'outpost', 2300, 450)],
    airport: null,
  },
  lagoon: {
    ground: [car(3, 'streets')],
    water: [boats('dive', 2, 'harbour', 800), { kind: 'ferry', n: 1, route: { between: ['harbour', 'coast'] } }, boats('yacht', 1, 'harbour', 1200)],
    air: [heli('tour', 'town', 1500, 300), plane('ga', 'courier', 'outpost', 2200, 450)],
    airport: null,
  },
  stormcoast: {
    ground: [car(5, 'streets')],
    water: [boats('trawler', 2, 'harbour', 900), { kind: 'lifeboat', n: 1, route: { around: 'harbour', r: 1200 } }],
    air: [heli('sar', 'harbour', 1600, 320)],
    airport: null,
  },

  /* ---- car maps: the courier roads are the game; cars yield to the player ---- */
  drovers: {
    ground: [car(10, 'roads'), { kind: 'tractor', n: 3, on: 'roads' }, vans(2, 'roads')],
    water: [boats('trawler', 2, 'coast', 900)],
    air: [plane('ga', 'skylark', 'town', 2500, 450)],
    airport: { types: ['skylark', 'courier'], n: 2 },
  },
  cape: {
    ground: [car(8, 'roads'), vans(3, 'roads')],
    water: [boats('trawler', 2, 'coast', 900)],
    air: [plane('ga', 'courier', 'town', 2600, 500)],
    airport: null,
  },
  cullen: {
    ground: [car(10, 'roads'), vans(2, 'roads'), { kind: 'tractor', n: 2, on: 'roads' }],
    water: [boats('trawler', 2, 'coast', 900)],
    air: [plane('ga', 'skylark', 'town', 2500, 450)],
    airport: null,
  },
  town: {
    ground: [car(40, 'streets+roads'), { kind: 'bus', n: 4, on: 'streets+roads' }, vans(6, 'streets+roads')],
    water: [],
    air: [heli('police', 'town', 900, 300)],
    airport: null,
  },
  coastroad: {
    ground: [car(12, 'roads'), vans(4, 'roads')],
    water: [boats('trawler', 2, 'coast', 900)],
    air: [plane('ga', 'courier', 'town', 2500, 450)],
    airport: null,
  },
  mountainpass: {
    ground: [{ kind: 'fourx4', n: 6, on: 'roads' }, car(4, 'roads')],
    water: [],
    // No outpost here: the bush plane runs from the lighthouse end of the island to the town.
    air: [transit('bush', 'courier', 'lighthouse', 'town', 700), heli('rescue', 'town', 1500, 400)],
    airport: null,
  },

  /* ---- helicopter maps: the pads are the game ---- */
  'kestrel-port': {
    ground: [car(16, 'streets+roads'), vans(2, 'streets+roads')],
    water: [{ kind: 'ferry', n: 1, route: { around: 'pad:harbour', r: 900 } }, boats('trawler', 2, 'pad:harbour', 700), boats('yacht', 2, 'coast', 900)],
    air: [plane('ga', 'courier', 'town', 2600, 450)],
    airport: { types: ['skylark', 'courier', 'meridian'], n: 3 },
  },
  stacks: {
    ground: [],
    water: [{ kind: 'lifeboat', n: 1, route: { around: 'town', r: 700 } }, boats('trawler', 2, 'town', 900)],
    // None: the player IS the helicopter here.
    air: [],
    airport: null,
  },
  rigs: {
    ground: [car(3, 'streets')],
    water: [{ kind: 'supply', n: 3, route: { around: 'town', r: 1500 } }, { kind: 'patrol', n: 1, route: { around: 'pad:flotel', r: 700 } }],
    // Crew change, Flotel to shore and back, only while the player is 1.5 km off.
    air: [heli('crew', null, 0, 200, { transit: ['pad:flotel', 'pad:field'], shy: 1500 })],
    airport: null,
  },
  carriergroup: {
    ground: [car(2, 'streets')],
    water: [{ kind: 'rhib', n: 2, route: { around: 'carrier', r: 700 } }],
    air: [heli('guard', 'carrier', 600, 150), plane('guard', 'f22', 'carrier', 3000, 0, { alt: 600 })],
    airport: null,
  },
  firewatch: {
    ground: [{ kind: 'fourx4', n: 3, on: { loop: 'pad:base', r: 140 } }, { kind: 'firetruck', n: 2, on: { park: 'pad:base', r: 40 } }],
    water: [],
    // The spotter and the rescue helicopter: off in a fire mission (the scene replaces them).
    air: [plane('spotter', 'skylark', 'pad:lookout', 2000, 500), heli('rescue', 'pad:base', 1200, 300)],
    airport: null,
  },
  ravencrag: {
    ground: [{ kind: 'fourx4', n: 2, on: { park: 'pad:hospital', r: 40 } }],
    water: [],
    air: [heli('rescue', 'pad:hospital', 1500, 400, { sep: 600 }), transit('bush', 'courier', 'town', 'pad:field', 700)],
    airport: null,
  },
  meridian: {
    ground: [car(50, 'streets'), { kind: 'taxi', n: 10, on: 'streets' }, { kind: 'bus', n: 5, on: 'streets' }, vans(8, 'streets')],
    water: [boats('yacht', 2, 'coast', 900)],
    air: [heli('police', 'town', 900, 300), heli('news', 'town', 1300, 400), heli('medevac', 'town', 700, 300, { land: 'pad:hospital' }), heli('tour', 'pad:tower', 600, 350)],
    airport: null,
  },
});

/** The 30 ids the data cover, for the tests. */
export const AMBIENT_IDS = Object.freeze(Object.keys(AMBIENT));

/*
 * The World Map — Preview (worldmap/preview.js, id 'world-preview') is not one
 * of the 30 maps above — it is not on the roster — so it had no entry and
 * nothing at all drove its 150 km of highways, country roads and high
 * streets (checker, wave 18; the owner asked for "cars on them"). Its own
 * population: the road network's lanes (sim.roads, MAP.waters.roads) and
 * the start town's streets. Cars are spread over the whole network and only
 * the ones within CAR_FAR of the camera are drawn, so the count is what the
 * frame pays for whatever the network's length.
 */
const WORLD_PREVIEW_AMBIENT = Object.freeze({
  ground: [car(80, 'streets+roads'), vans(10, 'streets+roads'), { kind: 'truck', n: 10, on: 'roads' }, { kind: 'bus', n: 4, on: 'streets+roads' }],
  water: [],
  air: [],
  airport: null,
});

/** The entry for a map, or an empty one. */
export function ambientFor(mapId) {
  if (mapId === 'world-preview') return WORLD_PREVIEW_AMBIENT;
  return AMBIENT[mapId] || { ground: [], water: [], air: [], airport: null };
}

/**
 * The counts a tier gives: ground and water scaled by DENSITY, flyers and
 * airport traffic capped. `level` is 'full' (the default), 'thin', false, or
 * { ground, water, air, airport } with ground/water as multipliers and
 * air/airport as caps.
 */
export function countsFor(mapId, tier = 'high', level = 'full') {
  const def = ambientFor(mapId);
  const d = DENSITY[tier] ?? DENSITY.high;
  let L;
  if (level === false) L = { ground: 0, water: 0, air: 0, airport: 0 };
  else if (level === 'thin') L = LEVELS.thin;
  else if (level === 'full' || level == null || level === true) L = LEVELS.full;
  else L = { ground: level.ground ?? 1, water: level.water ?? 1, air: level.air ?? Infinity, airport: level.airport ?? Infinity };
  const scale = (list, mul) => list.map((e) => ({ ...e, count: Math.round(e.n * d * mul) }));
  // Flyers and airport traffic: the tier's cap, or the level's if it is lower.
  const airCap = Math.max(0, Math.min(AIR_CAP[tier] ?? AIR_CAP.high, L.air));
  const airportCap = Math.max(0, Math.min(6, AIRPORT_CAP[tier] ?? AIRPORT_CAP.high, L.airport));
  return {
    ground: scale(def.ground || [], L.ground),
    water: scale(def.water || [], L.water),
    air: (def.air || []).slice(0, Math.max(0, airCap)),
    airport: def.airport && airportCap > 0 ? { types: def.airport.types, n: Math.min(def.airport.n, airportCap) } : null,
    tier,
    level: L,
  };
}

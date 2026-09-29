/**
 * ISLAND COURIER — the car game's jobs, its cargo, and its free mode.
 *
 * Every job is the same sentence: pick it up, get it there, on time, in one
 * piece. Three numbers pull against each other and that tension is the whole
 * game — your speed, the clock, and the condition of what you are carrying.
 * Go faster and you make the clock; go faster and the load takes knocks; a
 * load handed over at full condition pays double a battered one. So flooring
 * it everywhere is a legal strategy that earns badly, which is a thing a
 * ten-year-old works out for themselves in about four minutes. No text
 * explains it. The cargo pips do.
 *
 * The rule that separates this from the aeroplane: FAILURE IS NEVER A DEBRIEF
 * SCREEN. Go in the water and you are pulled out and put back on the road.
 * Miss the clock and the job pays less. The only way to properly lose is to
 * arrive with a wrecked load, and even that just means driving back. A car
 * game where you restart every ninety seconds is not a car game, so nothing in
 * this file ever calls runner.fail() and nothing sets `timeLimit` — which is
 * the runner's own hard failure and would do exactly the thing we are trying
 * not to do.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE DEPENDS ON THAT SOMEBODY ELSE IS BUILDING, AND WHAT IT DOES
 * WHEN THEY ARE NOT THERE YET
 *
 * This is deliberately droppable into the tree TODAY, before the road
 * generator, the new driving model or the new HUD exist. Nothing here is a
 * named import of something that has not been written, because a named import
 * of a missing export is not a graceful degradation — it is a blank screen and
 * a console error, and that has already cost this project a broken build once.
 *
 *   sim.roads        The road graph from src/world/roads.js. If present we ask
 *                    it for named places and for routes. If absent every job
 *                    still runs: places fall back to MAP.scenery and to points
 *                    measured off the terrain, and the HUD arrow points
 *                    straight at the destination instead of along the road.
 *                    Same jobs, same clock, no road network.
 *   Terrain.surfaceAt Read off a namespace import, never a named one, so the
 *                    module loads whether or not it exists yet. Falls back to
 *                    isPaved(), which is what ships today.
 *   sim.vehicleRecovery  A flag the driving specialist sets when surface.js
 *                    owns being pulled out of the water. Until it does, this
 *                    file does the recovery itself — see recoverIfDrowned().
 *                    Exactly one of the two runs; they must not both.
 *   hud.setCargo / hud.setJobClock / hud.setNextTurn
 *                    The new drive HUD. All optional. Without them the job
 *                    writes the clock and the pips into the objective title
 *                    once a second, so the three numbers are on screen from
 *                    day one even with today's HUD.
 * ---------------------------------------------------------------------------
 *
 * The jobs themselves are ordinary MISSIONS objects — same id/name/short/
 * difficulty/icon/blurb/reward/weather/parTime/steps/score shape that
 * missions.js has used all along, so MissionRunner runs them with no special
 * case. Three fields are new: `vehicle: 'car'` (which is how the runner knows
 * not to fail this job when a parked aeroplane falls over somewhere), `cargo`
 * (what you are carrying and how badly it dislikes being dropped) and `spawn`
 * given as a named place rather than a coordinate, because a coordinate is one
 * map's geometry and these jobs run on all of them.
 *
 * That last point is the answer to "more maps": six jobs written against named
 * places rather than numbers means six jobs on every qualifying island, which
 * is forty-odd distinct runs out of one set of definitions.
 */

import * as THREE from '../vendor/three.module.js';
import * as Terrain from '../world/terrain.js';
import * as Prog from './progression.js';
import { heightAt, MAP, ISLANDS } from '../world/terrain.js';
import { RUNWAY } from '../world/airport.js';
import { routeOnRoads, routeLengthM, distanceToRoads, nearestRoadPoint, roadDistancesFrom, roadGraph, PAVED_HALF } from '../world/roads.js';
// The island made ready for a van (IslandRoads.van, at the end of this file).
import { clearRoadsOfScenery, clearRoadsOfFields, drawnGroundSampler, terrainBlendSampler, fieldPatchSampler } from '../world/roads.js';
// The ground the van rides, for putting the drop-off marker on the tarmac.
import { groundHeight, setGroundMesh } from '../vehicles/surface.js';
// For giving a job's sky back when the menu is reached without stopDrive.
import { registerExtension } from './extensions.js';

/* ------------------------------------------------------------------ *
 * Small shared numbers, all in metres and metres per second.
 * ------------------------------------------------------------------ */

/** How close, and how slow, counts as "you have arrived". */
const ARRIVE_R = 34;
const ARRIVE_SPEED = 4.2;

/** 70 km/h, the speed above which leaving the tarmac hurts the load. */
const KERB_SPEED = 19.4;

/**
 * The vehicle, whoever is holding it.
 *
 * `ctx.veh` arrives once the three-line runner patch lands. Until then the
 * vehicle is only on the sim. Reading both costs nothing and means these jobs
 * do not have to wait for that patch to be testable.
 */
const V = (ctx) => (ctx && (ctx.veh || (ctx.sim && ctx.sim.vehicle))) || null;

/** Metres between two things that both have x and z. Ignores height, which is
 *  what you want on a road: being 40 m below the summit is not being 40 m from
 *  it in any sense a driver cares about. */
function flatDist(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Put a point on the ground with a little lift, so the HUD arrow and any
 *  marker sit above the tarmac rather than inside it. */
function onGround(x, z, lift = 2.5) {
  return new THREE.Vector3(x, heightAt(x, z) + lift, z);
}

/**
 * Which surface is under a point, asked in the one way that works today and
 * will keep working after surfaceAt() replaces isPaved().
 *
 * isPaved() is a hand-written Kestrel taxiway and is wrong on eight of the
 * nine maps, so this is not accurate now — but it is not load-bearing now
 * either: it only decides whether a kerb strike knocks the load. When
 * surfaceAt lands, this starts telling the truth on every map with no change
 * here.
 */
function surfaceKind(x, z) {
  if (typeof Terrain.surfaceAt === 'function') {
    const s = Terrain.surfaceAt(x, z);
    return (s && s.kind) || 'grass';
  }
  if (typeof Terrain.isPaved === 'function' && Terrain.isPaved(x, z)) return 'tarmac';
  return heightAt(x, z) < 3.5 ? 'sand' : 'grass';
}

/* ------------------------------------------------------------------ *
 * PLACES.
 *
 * A job says "the harbour", never "(-3100, 0, -3600)". On a map with a road
 * network the graph knows where its own named junctions are and we ask it. On
 * a map without one — and on every map today — we work the place out from
 * MAP.scenery and from the terrain itself, so the job is playable anyway.
 *
 * Working one out marches across the map sampling the terrain — a few hundred
 * heightAt calls — so it is cached twice over: once per map in PLACE_CACHE for
 * the menu, and once per run on the job's own data, so a step's target() is a
 * lookup rather than a survey thirty times a second.
 * ------------------------------------------------------------------ */

export const PLACE_NAMES = ['depot', 'town', 'harbour', 'lighthouse', 'outpost', 'summit'];

/** Friendly names, for the job strip and the discovery bounties. */
export const PLACE_LABELS = {
  depot: 'the depot',
  town: 'the town',
  harbour: 'the harbour',
  lighthouse: 'the lighthouse',
  outpost: 'the outpost',
  summit: 'the summit relay',
};

/**
 * Walk outwards from a point on a bearing until the ground drops to the sea,
 * then step back to somewhere a van can stand.
 *
 * This is how the harbour and the coast-road headlands are found on a map that
 * has never heard of either. It is the cheap version of what the road
 * generator does properly with 96 bearings; six here is plenty, because all we
 * want is one believable point on the shore.
 */
function marchToCoast(cx, cz, bearingDeg, maxOut = 6000) {
  const r = (bearingDeg * Math.PI) / 180;
  const sx = Math.sin(r);
  const sz = -Math.cos(r);
  let last = { x: cx, z: cz };
  for (let d = 120; d < maxOut; d += 40) {
    const x = cx + sx * d;
    const z = cz + sz * d;
    const h = heightAt(x, z);
    if (h < 4) return last;
    if (h < 26) last = { x, z };
  }
  return last;
}

/**
 * Can a van get from here to there without a ferry?
 *
 * This is the bug that the nine-map test found and that no amount of reading
 * the code would have: on Kestrel the map's `deliveryPad` — which is the
 * obvious candidate for "the outpost" — is Mango Cay, eight kilometres away
 * ACROSS OPEN WATER. Two of the six jobs sent the van there, and on four of
 * the nine maps the job was simply impossible. The aeroplane never noticed
 * because the aeroplane flies.
 *
 * Sampling the straight line between the two points and looking for sea is
 * crude — it says no to two places joined by a road that loops round a bay —
 * but it never says yes to a place you would have to swim to, and that is the
 * error that matters. Twenty-four heightAt calls, once per job.
 */
function sameLandmass(a, b) {
  const n = 24;
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (heightAt(x, z) < 1) return false;
  }
  return true;
}

/**
 * The farthest bit of the main island's coast from the town.
 *
 * The stand-in outpost on a map whose delivery pad is offshore. It is a real
 * remote corner of a real island you can really drive to, which is all the
 * fiction needs, and it is the last place on the island a child will have
 * been.
 */
function remoteCorner(sim) {
  const main = (ISLANDS && ISLANDS[0]) || { cx: 0, cz: 0, radius: 2000 };
  const town = placeOf(sim, 'town');
  let best = null;
  let bestD = -1;
  for (let i = 0; i < 16; i++) {
    const c = marchToCoast(main.cx, main.cz, (i / 16) * 360);
    const d = Math.hypot(c.x - town.x, c.z - town.z);
    if (d > bestD && heightAt(c.x, c.z) > 2) {
      bestD = d;
      best = c;
    }
  }
  return best || { x: main.cx, z: main.cz };
}

/** The highest ground within a given radius of a point. A coarse spiral:
 *  200-odd samples, once, and it lands on the actual top rather than on the
 *  middle of the hill, which on the volcano maps is the crater. */
function highestNear(cx, cz, radius = 1400) {
  let best = { x: cx, z: cz, h: heightAt(cx, cz) };
  for (let ring = 1; ring <= 6; ring++) {
    const rr = (radius * ring) / 6;
    const n = 8 * ring;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = cx + Math.cos(a) * rr;
      const z = cz + Math.sin(a) * rr;
      const h = heightAt(x, z);
      if (h > best.h) best = { x, z, h };
    }
  }
  return best;
}

/**
 * The mountain, on whichever map this is.
 *
 * The obvious answer is MAP.scenery.hillCentre and it is wrong, which the
 * nine-map test caught: on Ember Isle — the volcano map, the one island in the
 * game most obviously built for a mountain run — `hillCentre` points at the
 * low wooded shelf behind the town, twenty-nine metres above it, and the
 * actual 880 m cone is a SECOND ISLAND in the list called Mount Ember. A
 * summit job aimed at hillCentre was a two-hundred-metre drive up a bump, on
 * the best mountain in the game.
 *
 * So every island is a candidate, plus the scenery's hill centre, and the
 * winner is the highest one you can actually drive to from the town. That last
 * clause matters as much as the height: an 880 m peak across four kilometres
 * of sea is not a summit job either.
 */
function findSummit(sim) {
  const cfg = (MAP && MAP.scenery) || {};
  const main = (ISLANDS && ISLANDS[0]) || { cx: 0, cz: 0, radius: 2000 };
  const town = { x: (cfg.town || main).cx, z: (cfg.town || main).cz };
  const cands = [];
  for (const isl of ISLANDS || []) {
    cands.push(highestNear(isl.cx, isl.cz, Math.min(isl.radius * 0.55, 1400)));
  }
  if (cfg.hillCentre) cands.push(highestNear(cfg.hillCentre[0], cfg.hillCentre[1], cfg.hillRadius || 1400));
  let best = null;
  for (const c of cands) {
    if (!sameLandmass(town, c)) continue;
    if (!best || c.h > best.h) best = c;
  }
  return best || highestNear(main.cx, main.cz, main.radius * 0.55);
}

/**
 * Worked-out places, kept until the map changes.
 *
 * Finding the summit walks a spiral round every island and then tests each
 * candidate for a land route; finding the harbour marches to the coastline.
 * That is a few thousand heightAt calls, and the menu asks for all six places
 * of all six jobs every time it renders a card. Once per map is plenty — the
 * island does not move — and the key is the map id so that changing islands
 * throws the lot away rather than quietly answering with the last island's
 * geography, which is the failure this cache would otherwise introduce.
 */
const PLACE_CACHE = { mapId: null, byName: new Map() };

export function placeOf(sim, name) {
  const mapId = (MAP && MAP.id) || 'unknown';
  if (PLACE_CACHE.mapId !== mapId) {
    PLACE_CACHE.mapId = mapId;
    PLACE_CACHE.byName.clear();
  }
  // Cached only when there is no road graph to ask. With one, the graph is the
  // authority and it may still be generating when the first card is drawn.
  const cacheable = !(sim && sim.roads);
  if (cacheable && PLACE_CACHE.byName.has(name)) return PLACE_CACHE.byName.get(name).clone();
  const found = computePlace(sim, name);
  if (cacheable) PLACE_CACHE.byName.set(name, found.clone());
  return found;
}

/**
 * Where a named place is on the map we are on now.
 *
 * Asks the road graph first, because once roads exist the graph's own junction
 * is the place — putting the delivery point 80 m off the end of the road is
 * how you get a child driving in circles round a field. Everything below it is
 * the answer for a map that has no road network yet, which is every map today.
 */
function computePlace(sim, name) {
  const roads = sim && sim.roads;
  const net = networkOf(sim);
  if (net) {
    const p = networkPlace(sim, name);
    if (p) return onGround(p.x, p.z);
  } else if (roads && typeof roads.place === 'function') {
    const p = roads.place(name);
    if (p) return onGround(p.x, p.z);
  }
  // The foot of the summit climb is the town wherever nothing better is known.
  if (name === 'foot') return computePlace(sim, 'town');
  const found = terrainPlace(sim, name);
  if (!net) return found;
  /*
   * And on the road. A map with a network but no place of this kind — no
   * lighthouse, no summit — gets the terrain's answer, which is a point in a
   * field; the job then ends eighty metres off the tarmac with a child
   * driving circles round a meadow looking for it. Park it on the road
   * outside instead, the way a courier would.
   */
  /*
   * ...unless that is the depot. On Cormorant Coast the scenery's town and
   * the airfield are beside each other, both park on the same bit of the one
   * road, and First Run — "from the depot to the town" — measured 5 m long:
   * it opened on ARRIVING with the van already there, and waited for a
   * child to drive away from the place it was telling them to stop at.
   */
  const depotAt = name === 'depot' || name === 'apron' ? null : computePlace(sim, 'depot');
  const clear = (p) => !depotAt || Math.hypot(p.x - depotAt.x, p.z - depotAt.z) > 400;
  const near = nearestRoadPoint(net, found.x, found.z);
  if (near && near.dist < 600 && clear(near)) return onGround(near.x, near.z);
  /*
   * And on a map whose road is the whole map — a single authored pass or
   * coast road, no addresses — the scenery's idea of "the town" can be
   * kilometres from it. Measured headless on Saddleback Pass and Cormorant
   * Coast: every one of the six jobs had a stop more than 600 m from the only
   * road, so every job was either impossible (before) or off the board
   * (once the board learned to check). There the places are laid out along
   * the road itself instead — see alongTheRoad().
   */
  const along = alongTheRoad(net, name);
  if (along && clear(along)) return onGround(along.x, along.z);
  // Still on top of the depot: the first of a few points along the longest
  // road that is a proper drive from it.
  if (depotAt) {
    const longest = net.reduce((a, b) => (roadLen(b) > roadLen(a) ? b : a));
    const L = roadLen(longest);
    for (const f of [0.55, 0.3, 0.8, 0.15, 0.95]) {
      const p = pointAlongPath(longest.path, L * f);
      if (clear(p)) return onGround(p.x, p.z);
    }
  }
  return along ? onGround(along.x, along.z) : found;
}

/**
 * Places for a network that names none: points along its longest road, and
 * its highest and lowest ground, so each job still has somewhere distinct to
 * go and a road all the way there. Cached per network.
 */
const ALONG_CACHE = new WeakMap();
function alongTheRoad(net, name) {
  let spots = ALONG_CACHE.get(net);
  if (!spots) {
    const longest = net.reduce((a, b) => (roadLen(b) > roadLen(a) ? b : a));
    const L = roadLen(longest);
    const at = (f) => pointAlongPath(longest.path, L * f);
    let hi = null;
    let lo = null;
    for (const rd of net) {
      for (const q of rd.path) {
        const h = q[2] != null ? q[2] : heightAt(q[0], q[1]);
        if (!hi || h > hi.h) hi = { x: q[0], z: q[1], h };
        if (h > 2 && (!lo || h < lo.h)) lo = { x: q[0], z: q[1], h };
      }
    }
    spots = {
      depot: at(0.06),
      apron: at(0.3),
      town: at(0.55),
      outpost: at(0.94),
      lighthouse: at(0.97),
      summit: hi,
      harbour: lo,
    };
    ALONG_CACHE.set(net, spots);
  }
  return spots[name] || null;
}

function roadLen(rd) {
  let m = 0;
  for (let k = 1; k < rd.path.length; k++) m += Math.hypot(rd.path[k][0] - rd.path[k - 1][0], rd.path[k][1] - rd.path[k - 1][1]);
  return m;
}

function pointAlongPath(p, m) {
  let left = m;
  for (let k = 1; k < p.length; k++) {
    const len = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
    if (len >= left || k === p.length - 1) {
      const f = len > 0 ? Math.min(1, left / len) : 0;
      return { x: p[k - 1][0] + (p[k][0] - p[k - 1][0]) * f, z: p[k - 1][1] + (p[k][1] - p[k - 1][1]) * f };
    }
    left -= len;
  }
  return { x: p[0][0], z: p[0][1] };
}

/**
 * The words a map uses for a place, in the order a job would accept them.
 *
 * `sim.roads.place(name)` matched a courier place by id or kind, and nothing
 * else — so on Drover's Flat "summit" found nothing (the hill-top there is
 * called the relay), fell through to the terrain survey, and picked a grassy
 * knoll 261 m from the depot. Free drive paid "Found the summit relay" for it
 * within twelve seconds of pulling away, in a field. It also matched places
 * marked `boatOnly`, so "lighthouse" on Drover's Flat was Cobb Light, on a
 * rock four kilometres out to sea.
 */
const PLACE_KINDS = {
  depot: ['depot'],
  apron: ['apron'],
  town: ['town', 'village'],
  harbour: ['harbour'],
  lighthouse: ['lighthouse'],
  outpost: ['outpost', 'relay', 'quarry', 'layby'],
};

/** The road network the van can actually drive, or null. */
function networkOf(sim) {
  const list = sim && sim.roads && (sim.roads.list || sim.roads.roads);
  return list && list.length ? list : null;
}

/** A courier place of this kind that a van can reach, or null. */
function networkPlace(sim, name) {
  const net = networkOf(sim);
  if (!net) return null;
  if (name === 'summit') return networkSummit(sim, net);
  if (name === 'foot') {
    const c = networkClimb(sim, net);
    return c ? c.foot : networkPlace(sim, 'town');
  }
  const places = (sim.roads && sim.roads.places && sim.roads.places.length ? sim.roads.places : null)
    || (MAP && MAP.courier && MAP.courier.places) || [];
  for (const want of PLACE_KINDS[name] || [name]) {
    for (const p of places) {
      if (p.boatOnly) continue;
      if (p.id !== want && p.kind !== want) continue;
      if (distanceToRoads(net, p.x, p.z, 200) > 150) continue;
      const near = nearestRoadPoint(net, p.x, p.z);
      return near ? { x: near.x, z: near.z, name: p.name || name } : { x: p.x, z: p.z, name: p.name || name };
    }
  }
  return null;
}

/** The top of the Summit Relay's climb on an island with roads, or null. */
function networkSummit(sim, net) {
  const c = networkClimb(sim, net);
  return c ? c.top : null;
}

/**
 * The Summit Relay's climb, on an island with roads: a foot and a top.
 *
 * The job was written as "from the TOWN up to the relay and back", and
 * asked for a relay 60 m above the town. Measured across all eight car maps
 * after the relay learned to look along the roads: offered on none of them.
 * Drover's Flat is flat; on Cape Vessel the relay is 43 m above Kerrow; and
 * on Saddleback Pass — the map whose own card says "Climb a real mountain",
 * a road from 18 m up to 225 m and back down — the stand-in town is laid out
 * 55% of the way along the only road, which is 211 m up on the shoulder, so
 * the relay 14 m above it was "not got the ground for it". The one job about
 * a mountain was never offered on the one map that is a mountain.
 *
 * So the climb starts wherever the climb is. The town when the town
 * qualifies, which is the job as written; failing that, whichever named
 * place (or, on a road with no names, whichever end of it) has the most
 * road above it within a job's length — a relay the road reaches if there is
 * one high enough, else the highest tarmac. The foot is where the van starts
 * and where the empties go back to. Worked out once per network.
 */
const CLIMB_BY_NET = new WeakMap();
function networkClimb(sim, net) {
  if (CLIMB_BY_NET.has(net)) return CLIMB_BY_NET.get(net);
  CLIMB_BY_NET.set(net, null);
  const job = CAR_JOBS.find((j) => j.id === 'summit');
  // Up and back inside the job's cap, at the pace the menu quotes.
  const reach = job && job.plan ? ((job.maxSeconds - job.plan.allow) * job.plan.speed * PACE) / 2 : 4000;
  const places = ((sim.roads && sim.roads.places && sim.roads.places.length ? sim.roads.places : null)
    || (MAP && MAP.courier && MAP.courier.places) || [])
    .filter((p) => !p.boatOnly && distanceToRoads(net, p.x, p.z, 200) <= 150)
    .map((p) => {
      const near = nearestRoadPoint(net, p.x, p.z);
      return { x: near.x, z: near.z, name: p.name || p.id, kind: p.kind, id: p.id };
    });
  const feet = [];
  const town = networkPlace(sim, 'town');
  if (town) feet.push({ x: town.x, z: town.z, name: 'the town', town: true });
  for (const p of places) if (p.kind !== 'relay' && p.kind !== 'summit') feet.push(p);
  if (!places.length) {
    for (const rd of net) {
      const a = rd.path[0];
      const b = rd.path[rd.path.length - 1];
      feet.push({ x: a[0], z: a[1], name: null }, { x: b[0], z: b[1], name: null });
    }
  }
  const relay = places.find((p) => p.kind === 'relay' || p.id === 'relay' || p.kind === 'summit');
  let best = null;
  for (const f of feet) {
    const fy = heightAt(f.x, f.z);
    const nodes = roadDistancesFrom(net, f) || [];
    let top = null;
    if (relay && heightAt(relay.x, relay.z) - fy > 60) {
      const leg = routeOnRoads(net, f, relay);
      if (leg && routeLengthM(leg) <= reach) top = { x: relay.x, z: relay.z, y: heightAt(relay.x, relay.z), name: relay.name };
    }
    if (!top) {
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!(n.d <= reach)) continue;
        const y = heightAt(n.x, n.z);
        if (!top || y > top.y) top = { x: n.x, z: n.z, y, name: 'the summit relay' };
      }
    }
    if (!top || top.y - fy <= 60) continue;
    const score = (f.town ? 1e4 : 0) + (top.y - fy);
    if (!best || score > best.score) {
      best = {
        score,
        top: { x: top.x, z: top.z, name: top.name || 'the summit relay' },
        foot: { x: f.x, z: f.z, name: f.name || 'the bottom of the lane' },
      };
    }
  }
  CLIMB_BY_NET.set(net, best);
  return best;
}

/** The terrain's answer, for a map that names no such place. */
function terrainPlace(sim, name) {
  const cfg = (MAP && MAP.scenery) || {};
  const main = (ISLANDS && ISLANDS[0]) || { cx: 0, cz: 0, radius: 2000 };

  switch (name) {
    // Where the aeroplane parks, which on a map without a depot is the depot.
    case 'apron':
    case 'depot': {
      /*
       * The apron is the depot in version one.
       *
       * There is no depot in MAP.scenery and inventing one as a coordinate
       * would be Kestrel's geometry applied to nine maps, which is the exact
       * bug the terrain scatter comment already complains about. The apron is
       * the one paved place every single map has, the van already spawns on
       * it, and "the airfield yard" is a perfectly good depot for an island
       * courier. When the road network exists it names a depot node and this
       * branch stops being used.
       */
      return onGround(RUNWAY.thresholdWest.x + 140, RUNWAY.thresholdWest.z - 95);
    }
    case 'town': {
      const t = cfg.town || { cx: main.cx + 600, cz: main.cz + 600 };
      return onGround(t.cx, t.cz);
    }
    case 'harbour': {
      // A harbour is where the town meets the water. Walk from the town out
      // towards the nearest sea and stop at the shoreline.
      const t = cfg.town || { cx: main.cx, cz: main.cz };
      const away = Math.atan2(t.cx - main.cx, -(t.cz - main.cz)) * (180 / Math.PI);
      const c = marchToCoast(t.cx, t.cz, away);
      return onGround(c.x, c.z);
    }
    case 'lighthouse': {
      const l = cfg.lighthouse || [main.cx - main.radius * 0.8, main.cz];
      return onGround(l[0], l[1]);
    }
    case 'outpost': {
      /*
       * The map's outlying strip, but only if you can drive to it.
       *
       * See sameLandmass(). On Kestrel, Fjord Approach and others the delivery
       * pad is on a different island; a courier job that ends in the sea is
       * not a hard job, it is a broken one. Where it is offshore the outpost
       * becomes the far corner of the island we are actually on.
       */
      const d = cfg.deliveryPad || [main.cx + main.radius * 1.6, main.cz];
      const pad = { x: d[0], z: d[1] };
      const town = { x: (cfg.town || main).cx, z: (cfg.town || main).cz };
      if (heightAt(pad.x, pad.z) > 2 && sameLandmass(town, pad)) return onGround(pad.x, pad.z);
      const c = remoteCorner(sim);
      return onGround(c.x, c.z);
    }
    case 'summit': {
      const s = findSummit(sim);
      return onGround(s.x, s.z, 3);
    }
    default:
      return onGround(main.cx, main.cz);
  }
}

/** Resolve a place once and keep it, so a step's target() is a lookup rather
 *  than a survey. */
function place(ctx, name) {
  const cache = (ctx.data._places = ctx.data._places || {});
  if (!cache[name]) cache[name] = placeOf(ctx.sim, name);
  return cache[name];
}

/**
 * Where the van starts a given job, and which way it is pointing.
 *
 * Jobs name a place; main.js turns that into a position. This exists so the
 * one line in startDrive() that puts the van down is the same line for every
 * job on every map:
 *
 *     const s = resolveSpawn(this, job);
 *     this.vehicle.reset({ pos: s.pos, headingDeg: s.headingDeg });
 */
export function resolveSpawn(sim, job) {
  const name = (job && job.spawn && job.spawn.place) || 'depot';
  const pos = placeOf(sim, name).clone();
  pos.y = Math.max(0, heightAt(pos.x, pos.z));
  let headingDeg = (job && job.spawn && job.spawn.headingDeg);
  const net = networkOf(sim);
  if (net && headingDeg == null) {
    /*
     * On the road, pointing ALONG it, towards where the job goes first.
     *
     * The van used to face the first place in a straight line. On Drover's
     * Flat that is heading 155 from the depot, which is between two of the
     * three roads that meet there: holding Shift for twelve seconds drove it
     * 190 m, off the road after the first four, and the first thing a child
     * did in the game was leave the road. Now it faces the way the ROUTE leaves, and it is put
     * down fourteen metres along it — clear of the junction, in the right-hand
     * lane — so the first frame is a van on a road with the road ahead of it.
     *
     * A map that authored its own roads and named no places has no depot, and
     * the terrain's guess (the airfield apron) can be kilometres from any
     * tarmac — nearly four on Saddleback Pass. There the road IS the map, so
     * the van starts in the middle of the longest one.
     */
    let near = nearestRoadPoint(net, pos.x, pos.z);
    if (!near || near.dist > 600) {
      const longest = net.reduce((a, b) => (b.path.length > a.path.length ? b : a));
      const mid = longest.path[Math.floor(longest.path.length / 2)];
      near = nearestRoadPoint(net, mid[0], mid[1]);
    }
    const from = { x: near.x, z: near.z };
    const goal = firstGoal(sim, job, from);
    const route = goal ? routeOnRoads(net, from, goal) : null;
    const at = route ? alongRoute(route, 14) : null;
    if (at) {
      const r = at.headingDeg * DEG;
      pos.set(at.x + Math.cos(r) * LANE, 0, at.z + Math.sin(r) * LANE);
      headingDeg = at.headingDeg;
    } else {
      pos.set(near.x, 0, near.z);
      headingDeg = near.headingDeg;
    }
    pos.y = Math.max(0, heightAt(pos.x, pos.z));
  }
  if (headingDeg == null) {
    // Face the first place the job sends you to, so nobody's first action is a
    // three-point turn.
    const first = (job && job.faceTowards) || 'town';
    const t = placeOf(sim, first);
    headingDeg = (Math.atan2(t.x - pos.x, -(t.z - pos.z)) * 180) / Math.PI;
  }
  return { pos, headingDeg: (headingDeg + 360) % 360 };
}

const DEG = Math.PI / 180;
/** The van keeps to the right: half a lane off the centre line. */
const LANE = PAVED_HALF * 0.45;
/** Free drive's next place: one behind the van counts as this much further
 *  away by road than it is — see IslandRoads.pickNext. */
const TURN_ROUND_M = 1500;

/**
 * Where a job goes first: the first step that names a target somewhere
 * other than where the van already is, else the place it says to face.
 *
 * "Somewhere other": on a map with no airfield place the Shuttle's crate
 * is at the depot, the van is loaded where it stands, and the real first
 * leg is the run into town. Faced along the route to the crate — a route
 * of no length — the van was parked along whichever road was nearest, and
 * on Fenwick that was backwards: the first thing the arrow said was TURN
 * AROUND.
 */
function firstGoal(sim, job, from = null) {
  if (job && Array.isArray(job.steps)) {
    const ctx = { sim, veh: null, data: { _places: {} }, elapsed: 0, runner: { def: job } };
    for (const step of job.steps) {
      if (typeof step.target !== 'function') continue;
      try {
        const t = step.target(ctx);
        if (t && !(from && flatDist(from, t) < 60)) return t;
      } catch (e) {
        // A target that needs onStart's data (the coast road's headlands) is
        // not available yet; the place the job faces will do.
        break;
      }
    }
  }
  return placeOf(sim, (job && job.faceTowards) || 'town');
}

/** The point `m` metres along a route, and the way the route runs there. */
function alongRoute(route, m) {
  let left = m;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 0.5) continue;
    const hdg = (Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI;
    if (len >= left || i === route.length - 1) {
      const f = Math.min(1, left / len);
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, headingDeg: (hdg + 360) % 360 };
    }
    left -= len;
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * THE CLOCK.
 *
 * Par times are COMPUTED, not written down, and this is not a nicety — it is
 * the difference between the jobs working on nine maps and working on one.
 *
 * Measured off the real maps, depot-to-town is 850 m on Fjord Approach and
 * 4,675 m on Los Angeles; the coast lap is 9.3 km on one island and 40.6 km on
 * another. A single hard-coded number is therefore either a stroll or an
 * impossibility depending on which island you picked, and a child who beats
 * the clock by four minutes on one map and misses it by six on the next learns
 * nothing except that the clock is random.
 *
 * So par is the length of the actual route divided by a speed the job thinks
 * is fair, plus a fixed allowance for loading, stopping and getting lost once.
 * The `parTime` still written on each job is the typical-case number for the
 * menu card, and the real clock replaces it the moment the job starts.
 * ------------------------------------------------------------------ */

/**
 * How long the route is, in metres.
 *
 * With a road graph this is the routed polyline, which is the true answer.
 * Without one it is the straight lines between the places with a third added,
 * because no road between two points on an island is a straight line and a par
 * computed from the crow's distance is a par nobody can make.
 */
function routeLength(sim, pts) {
  const roads = sim && sim.roads;
  const net = networkOf(sim);
  if (net) {
    // Along the tarmac, leg by leg: the same route the arrow will follow.
    let total = 0;
    let ok = true;
    for (let i = 1; i < pts.length; i++) {
      const leg = routeOnRoads(net, pts[i - 1], pts[i]);
      if (!leg) {
        ok = false;
        break;
      }
      total += routeLengthM(leg);
    }
    if (ok && total > 0) return total;
  }
  if (roads && typeof roads.route === 'function') {
    let total = 0;
    let ok = true;
    for (let i = 1; i < pts.length; i++) {
      const leg = roads.route(pts[i - 1], pts[i]);
      if (!leg || !leg.length) {
        ok = false;
        break;
      }
      for (let j = 1; j < leg.length; j++) total += flatDist(leg[j - 1], leg[j]);
    }
    if (ok && total > 0) return total;
  }
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += flatDist(pts[i - 1], pts[i]);
  return d * 1.3;
}

/**
 * Every job carries a `plan`: the places it visits, the speed it thinks is
 * fair, and a fixed allowance for loading, stopping and getting lost once.
 *
 * One description, read by two callers — the clock when the job starts, and
 * the menu when it wants to tell you how long this job is on THIS island
 * before you commit to it. Written twice, those two would have drifted apart
 * within a week and the card would have been advertising a different job from
 * the one that actually runs.
 *
 * `speed` is metres per second and is the honest bit of judgement in the whole
 * file. The van tops out at 31 m/s and a ten-year-old on a road with corners
 * in it averages nothing like that. Flat link road 19, coast road 17, gravel
 * 13.5, wet and dark 13, mountain hairpins with glass in the back 12.5. A
 * straight-line robot driving at 20 m/s finishes these at roughly 0.55 of par,
 * which is about the gap you would expect between a perfect racing line and a
 * child who brakes for the corners and takes one wrong turn — but these five
 * numbers are the entire difficulty curve of the car game and they want a
 * playtest with actual children before anybody calls them settled.
 */
function planPoints(sim, def, ctx) {
  const legs = typeof def.plan.legs === 'function' ? def.plan.legs(sim) : def.plan.legs;
  return legs.map((n) => (typeof n === 'string' ? (ctx ? place(ctx, n) : placeOf(sim, n)) : n));
}

/** Set this run's clock from this map's geometry. */
function setPar(ctx) {
  const def = ctx.runner.def;
  if (!def.plan) return 0;
  const metres = routeLength(ctx.sim, planPoints(ctx.sim, def, ctx));
  ctx.data.routeM = metres;
  ctx.data.par = Math.round(metres / def.plan.speed + def.plan.allow);
  return ctx.data.par;
}

/**
 * How long this job will actually take, as opposed to how long you have.
 *
 * Par is a DEADLINE — it is set slower than a good run so that beating it is
 * an achievement rather than a formality. Quoting par on the menu card
 * therefore overstates every job by about a third, and it was doing exactly
 * that: the nine-map test had the coast road on Ember Isle advertised at
 * sixteen minutes and driven in under ten.
 *
 * PACE is the gap between the two, and it is one number in one place so that
 * the card and the clock can never disagree about which is which.
 */
const PACE = 1.35;

/** What the menu card should say this job costs on this island, in seconds. */
export function estimateSeconds(sim, def) {
  if (!def || !def.plan) return 0;
  return Math.round(routeLength(sim, planPoints(sim, def)) / (def.plan.speed * PACE) + def.plan.allow);
}

/** ...and in words, because "about twelve minutes" is something a child can
 *  weigh against how much of the lesson is left. */
export function lengthNote(sim, def) {
  const secs = estimateSeconds(sim, def);
  if (!secs) return 'No clock';
  const mins = Math.max(1, Math.round(secs / 60));
  return `about ${mins} minute${mins === 1 ? '' : 's'}`;
}

/** The clock this run is actually being judged against. */
const parOf = (ctx) => ctx.data.par || (ctx.runner.def && ctx.runner.def.parTime) || 0;

/* ------------------------------------------------------------------ *
 * THE LOAD.
 *
 * Five pips. One goes out per knock. This is the only new instrument in the
 * car game and it is the one that teaches the whole thing, because it is the
 * only part of the game that argues with going fast.
 * ------------------------------------------------------------------ */

export class CargoLoad {
  /**
   * @param {object} spec      { name, fragility } from the job.
   * @param {number} spec.fragility 0 = a crate of spanners, nothing can hurt
   *   it (the tutorial uses this so a first-timer literally cannot lose);
   *   1 = ordinary freight; 1.6 = glass, vaccine, a person.
   */
  constructor(spec = {}) {
    this.name = spec.name || 'FREIGHT';
    this.fragility = spec.fragility == null ? 1 : spec.fragility;
    /*
     * The thresholds, scaled by how delicate this load is.
     *
     * Worked out once here rather than divided through on every frame, and
     * more to the point worked out AT ALL: the first version stored fragility
     * and then only ever tested it for being above zero, so a tray of vaccine
     * and a pallet of building sand broke at exactly the same bump and the
     * field was a label with no effect. A job that says its load is fragile
     * has to be harder, or the word is decoration.
     *
     * Square roots on the two speed thresholds because they are speeds and the
     * energy in a knock goes as the square of one: dividing a speed limit
     * straight through by 1.6 takes the vaccine's kerb limit down to 43 km/h,
     * which is slower than a child will ever drive and so reads as the game
     * being broken rather than as the load being delicate.
     */
    const f = Math.max(0.0001, this.fragility);
    this.joltLimit = 58 / f;
    /** Closing speed with the ground on a landing that knocks the load, m/s:
     *  4 for ordinary freight — the same line surface.js calls a hard landing
     *  — and 3.2 for the vaccine and the doctor. */
    this.landLimit = 4 / Math.sqrt(f);
    this._landings = null;
    this.brakeLimit = 7.5 / Math.sqrt(f);
    this.kerbSpeed = KERB_SPEED / Math.sqrt(f);
    this.max = 5;
    this.pips = 5;
    this.knocks = [];
    this.cooldown = 0;
    this._y = null;
    this._vy = 0;
    this._surface = 'tarmac';
    this._brakeT = 0;
    this._brakeFrom = 0;
  }

  get condition() {
    return this.pips / this.max;
  }

  /**
   * Lose a pip, once, with a reason.
   *
   * The cooldown is the important part and it is not a nicety: one bad moment
   * — a crest taken at 90, landing, bouncing, sliding off onto the verge — is
   * three separate detectors firing inside half a second, and a child who
   * loses three pips for one mistake correctly concludes the game is unfair
   * and stops caring about the pips. One moment, one pip.
   */
  knock(reason, sim) {
    if (this.cooldown > 0 || this.pips <= 0) return false;
    if (this.fragility <= 0) return false;
    this.pips--;
    this.cooldown = 1.6;
    this.knocks.push(reason);
    if (sim && sim.hud) {
      const left = this.pips;
      sim.hud.notify(
        left === 0
          ? `The ${this.name.toLowerCase()} is wrecked — get it there anyway, it still counts.`
          : left <= 2
            ? `${reason} — handle with care, ${left} left`
            : reason,
        left <= 2 ? 'bad' : 'warn',
        left <= 2 ? 4 : 2.4
      );
    }
    if (sim && sim.audio && sim.audio.available && sim.audio.alerts && sim.audio.alerts.failure && this.pips === 0) {
      sim.audio.alerts.failure();
    }
    return true;
  }

  /**
   * Watch how the van is being driven and take the load's side.
   *
   * Three detectors, all worked out from frame-to-frame differences of things
   * the vehicle already publishes — position, speed, brake input — so this
   * needs nothing at all from the new driving model and will keep working
   * after it lands.
   *
   * The three thresholds are the tuning knobs for the entire game balance and
   * they want a playtest with actual children before anyone calls them final.
   * They are set deliberately generous, and then scaled by the load's
   * fragility in the constructor: a child driving briskly and sensibly should
   * finish an ordinary job on five pips, and only obvious recklessness —
   * flying off a crest, cutting a corner onto the grass at speed, standing on
   * the brakes — should cost anything. The vaccine and the doctor are a third
   * less forgiving than that, which is the whole of what makes those two jobs
   * hard.
   */
  update(dt, veh, sim) {
    if (!veh || dt <= 0) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    const speed = Math.abs(veh.speed || 0);

    // 1. Landings, measured as a fall that stops suddenly.
    //
    // Two conditions, and the first one is what makes this mean what its
    // message says. Vertical acceleration ALONE fires on any rough ground: a
    // washboard track at 60 km/h is a continuous stream of small spikes, and
    // a detector that counts those is a detector that punishes you for the
    // road surface rather than for your driving. So it only counts if the van
    // was genuinely dropping first — a crest taken too fast, the far lip of a
    // gully — and then stopped dropping in a hurry. That is a landing. A bumpy
    // road is not.
    //
    // Acceleration rather than a height change, because a height change per
    // frame is a different number at 30 fps and at 60, and half this audience
    // is on an iPad.
    //
    // A van that reports its own landings is asked directly. The frame-to-
    // frame detector below cannot tell falling from driving downhill: a
    // steady 10% descent at 90 km/h is a vertical speed of -2.5 m/s, which
    // is "falling", and the bottom of the hill stops it in a few frames,
    // which is a "landing". Measured on Drover's Flat, following the arrow
    // at a child's pace on the roads: "Hard landing" knocked the load on
    // three of the five jobs, for driving down a hill.
    if (typeof veh.landings === 'number') {
      if (this._landings != null && veh.landings !== this._landings && veh.lastLanding > this.landLimit && speed > 6) {
        this.knock('Hard landing', sim);
      }
      this._landings = veh.landings;
    } else if (this._y != null) {
      const vy = (veh.pos.y - this._y) / dt;
      const wasFalling = this._vy < -2.2;
      const accel = Math.abs(vy - this._vy) / dt;
      if (wasFalling && accel > this.joltLimit && speed > 6) {
        this.knock('Hard landing', sim);
      }
      this._vy = vy;
    }
    this._y = veh.pos.y;

    /*
     * 2. Leaving the tarmac at speed. Slowing down first and easing onto the
     *    gravel is free; carrying 70 km/h straight off the road is not.
     *
     * Gated on there BEING a road network, and that gate is not paranoia — the
     * nine-map test found this one too. Until roads.js lands, the only paved
     * thing on the map is the airfield, so driving from the apron towards the
     * town crosses the edge of the tarmac once and takes a knock for it. The
     * child has done nothing wrong; there is simply nowhere else to be. With
     * no road to leave, there is no such thing as leaving the road.
     */
    if (sim && sim.roads) {
      // What the van's own tyres say first. surfaceKind() asks
      // Terrain.surfaceAt, which was never written, and falls back to the
      // airfield's isPaved — so on every made road the load thought it was on
      // grass and "off the road at speed" could never happen.
      const surf = (veh.surface && veh.surface.kind) || surfaceKind(veh.pos.x, veh.pos.z);
      if (surf !== this._surface) {
        // Off the made road — tarmac or its gravel verge — onto the land.
        const hard = (k) => k === 'tarmac' || k === 'gravel';
        const leftTheHard = hard(this._surface) && !hard(surf);
        if (leftTheHard && speed > this.kerbSpeed) this.knock('Off the road at speed', sim);
        this._surface = surf;
      }
    }

    // 3. Standing on the brakes. A big speed drop with the brake pedal buried
    //    throws everything in the back against the bulkhead.
    const brake = veh.brakes || 0;
    if (brake > 0.75) {
      if (this._brakeT <= 0) this._brakeFrom = speed;
      this._brakeT += dt;
      if (this._brakeT > 0.55) {
        if (this._brakeFrom - speed > this.brakeLimit) this.knock('Heavy braking', sim);
        this._brakeT = 0;
      }
    } else {
      this._brakeT = 0;
    }
  }

  /** The pips as text, for the fallback HUD line. Five characters, always. */
  pipString() {
    return '●'.repeat(this.pips) + '○'.repeat(this.max - this.pips);
  }
}

/* ------------------------------------------------------------------ *
 * The shared per-frame work every job does.
 * ------------------------------------------------------------------ */

/**
 * Pulled out of the water, rather than ended by it.
 *
 * Today SurfaceVehicle.crash() sets a flag, drops the speed and puts a line on
 * the HUD saying press Esc — which for a delivery game is a full stop in the
 * middle of a job. A passing truck pulls you out instead: two and a half
 * seconds, one pip for the soaking, and you are back on the last piece of
 * ground you were actually driving on, facing the way you were going.
 *
 * This is written to STAND DOWN the moment the driving model owns it. If
 * sim.vehicleRecovery is true, surface.js is doing the recovery and this does
 * nothing at all, because two systems both teleporting the van is worse than
 * neither.
 */
function recoverIfDrowned(ctx, dt) {
  const sim = ctx.sim;
  const veh = V(ctx);
  if (!veh || sim.vehicleRecovery) return;
  const d = ctx.data;

  if (!veh.crashed) {
    // Remember the last place that was genuinely dry land, so there is
    // somewhere sensible to be put back to.
    if (heightAt(veh.pos.x, veh.pos.z) > 1.5) {
      d._safe = d._safe || { pos: new THREE.Vector3(), heading: 90 };
      d._safe.pos.copy(veh.pos);
      d._safe.heading = veh.heading;
    }
    d._dunkT = 0;
    return;
  }

  if (d._dunkT === 0 || d._dunkT == null) {
    d._dunkT = 0.0001;
    if (ctx.data.cargo) ctx.data.cargo.knock('In the water — that got wet', sim);
    sim.hud.notify('Hang on — someone is pulling you out…', 'info', 2.6);
  }
  d._dunkT += dt;
  if (d._dunkT < 2.5) return;

  const back = d._safe || { pos: placeOf(sim, 'depot'), heading: 90 };
  veh.crashed = false;
  veh.crashReason = '';
  veh.reset({ pos: back.pos.clone(), headingDeg: back.heading });
  d._dunkT = 0;
  sim._droveInto = false;
  sim.hud.notify('Back on the road. Off you go.', 'good', 2.4);
}

/**
 * Put the three numbers on the screen.
 *
 * If the new drive HUD is there, hand it the numbers and let it draw them
 * properly. If it is not — which is the case the day this file lands — write
 * them into the objective title once a second, because a game built entirely
 * around a clock and a condition meter with neither of them visible is not a
 * game, it is a driving demo.
 */
function pushHud(ctx, dt) {
  const sim = ctx.sim;
  const hud = sim.hud;
  const cargo = ctx.data.cargo;
  const def = ctx.runner && ctx.runner.def;
  if (!hud || !cargo || !def) return;

  const par = parOf(ctx);
  const left = par ? Math.max(0, par - ctx.elapsed) : null;

  if (typeof hud.setCargo === 'function') hud.setCargo(cargo.pips, cargo.max, cargo.name);
  if (typeof hud.setJobClock === 'function') hud.setJobClock(left, par);

  /*
   * The drive HUD is up: it draws the pips and the clock itself, from the
   * state main.js hands it every frame. The fallback below went on writing
   * "BOX OF SPANNERS ●●●●●" over the objective title once a second anyway,
   * so the van showed its load twice — once as the drive HUD's pips, once
   * as text in the title — and the job's name and step number, which
   * onMissionStep had just put there, never stayed on screen.
   */
  if (sim.driveHud && sim.driveHud.active) return;

  // The fallback line. Throttled, because setObjective touches the DOM.
  if (typeof hud.setCargo === 'function' && typeof hud.setJobClock === 'function') return;
  ctx.data._hudT = (ctx.data._hudT || 0) + dt;
  if (ctx.data._hudT < 1) return;
  ctx.data._hudT = 0;
  const step = ctx.runner.step;
  if (!step) return;
  const clock = left == null ? '' : ` · ${Math.floor(left / 60)}:${String(Math.floor(left % 60)).padStart(2, '0')}`;
  hud.setObjective(`${cargo.name} ${cargo.pipString()}${clock}`, step.text);
}

/** Every job's tick is this. Load, water, HUD — in that order, because the
 *  soaking has to be counted before the pips are drawn. */
function driveTick(ctx, dt) {
  const veh = V(ctx);
  if (ctx.data.cargo && veh) ctx.data.cargo.update(dt, veh, ctx.sim);
  recoverIfDrowned(ctx, dt);
  pushHud(ctx, dt);
}

/** Start a job: make the load, and tell the player what they are carrying. */
function loadUp(ctx) {
  const def = ctx.runner.def;
  ctx.data.cargo = new CargoLoad(def.cargo || {});
  ctx.data._places = {};
  ctx.data._dunkT = 0;
  if (ctx.sim.audio && ctx.sim.audio.available && ctx.sim.settings && ctx.sim.settings.music) {
    // There is already a car scene in music.js and it gates its pulse on
    // ground speed, so parking the van stops the music's clock.
    ctx.sim.audio.music.setScene('car');
  }
}

/**
 * Have you got there, and have you stopped?
 *
 * Stopping matters. A drop-off you can complete at 90 km/h is a checkpoint,
 * and the brief for this whole game says rings teach you to chase rings.
 * Pulling up outside the house is what a courier does, it takes one extra
 * second, and it is the moment where the clock and the load finally settle.
 */
function arrived(ctx, target, r = ARRIVE_R) {
  const veh = V(ctx);
  if (!veh || !target) return false;
  if (flatDist(veh.pos, target) > r) return false;
  return Math.abs(veh.speed) < ARRIVE_SPEED;
}

/** Got there, at any speed — for split times and waypoints you drive through
 *  rather than stop at. */
function passed(ctx, target, r = 90) {
  const veh = V(ctx);
  return !!veh && !!target && flatDist(veh.pos, target) < r;
}

/**
 * The pay.
 *
 * base x timeFactor x conditionFactor, expressed as the 0-100 score the
 * debrief and progression.js already understand, so a delivery lands on the
 * same leaderboard as a landing and a child can compare the two. That
 * comparison is a feature.
 *
 * timeFactor never reaches zero: missing the clock pays a bit, it does not pay
 * nothing, because a child who is thirty seconds over and now earns nothing
 * has no reason to finish the drive.
 *
 * conditionFactor is simply pips/5, which makes a perfect load worth double a
 * half-wrecked one and a wrecked one worth nothing at all. That is the lesson
 * and it wants to be blunt.
 *
 * A clean run on the clock is 100 on every job, so `base` is at least 100.
 * First Run was 70, the Shuttle 86 and the Coast Road 96, and none of them
 * has a bonus: a flawless First Run (no clock, a load that cannot break)
 * scored 70/100 under "Try it again for a better score", on a job where
 * there is no better score to be had. A ten-year-old reads 70 as a fail.
 * The harder jobs are still the harder 100s, because their clocks are
 * tighter and their loads break.
 */
function payFor(ctx, base = 100) {
  const cargo = ctx.data.cargo;
  const cond = cargo ? cargo.condition : 1;
  const par = parOf(ctx);
  let timeFactor = 1;
  if (par) {
    const over = ctx.elapsed / par;
    timeFactor = over <= 1 ? 1 : Math.max(0.5, 1 - (over - 1) * 0.45);
  }
  const extra = ctx.data.bonus || 0;
  /*
   * Clamped to 100, because the debrief screen renders the number as
   * "<score>/100" in big type and a 116 out of 100 is the kind of detail a
   * ten-year-old notices immediately and never lets go of.
   *
   * `ctx.data.bonus` is set by three jobs' onComplete, and the runner calls
   * onComplete AFTER it has worked out the score (runner.complete), so a
   * bonus has never reached one: it is 0 here on every job. It no longer
   * has to: with `base` at 100 or more a clean run on the clock is 100
   * without it, which is what "they are what lets a clean run reach 100 at
   * all" was hoping for.
   */
  return Math.max(0, Math.min(100, Math.round(base * timeFactor * cond + extra)));
}

/** The handover line, so every job ends with somebody saying thank you. */
function handedOver(ctx, who, what) {
  const cargo = ctx.data.cargo;
  const cond = cargo ? cargo.pips : 5;
  const sim = ctx.sim;
  sim.notify(
    cond === 5
      ? `${what} delivered to ${who}, not a mark on it. Full rate.`
      : cond === 0
        ? `${what} delivered to ${who} — in pieces. That one is on the house.`
        : `${what} delivered to ${who}. A bit knocked about — ${cond} of 5.`,
    cond >= 4 ? 'good' : 'warn'
  );
}

/* ------------------------------------------------------------------ *
 * THE SIX JOBS.
 *
 * Easiest first, one new idea each:
 *   1 First Run       the controls, and that the arrow is your friend
 *   2 Airport Shuttle the clock, and a two-leg job
 *   3 Coast Road      sustained pace against a par, with splits
 *   4 Summit Relay    the load, and that the descent is where you lose it
 *   5 Low Tide        loose surface, and a window that costs you if you miss
 *   6 Night Call-out  night, rain, and reading the map
 * ------------------------------------------------------------------ */

/*
 * `route(sim)` returns the places this job visits, in order, as world points.
 *
 * It is the next-turn chevron's input: the UI walks the road polyline between
 * consecutive points and looks ahead for the next heading change worth an
 * arrow. It takes the sim rather than a graph object so that it answers
 * correctly with or without a road network — with one, placeOf() returns the
 * graph's own junctions; without one it returns the terrain-measured place and
 * the chevron simply points straight at the next one.
 */
export const CAR_JOBS = [
  {
    id: 'firstrun',
    name: 'First Run',
    short: 'First run',
    difficulty: 'Easy',
    icon: '▸',
    vehicle: 'car',
    music: 'car',
    blurb:
      'Your first delivery. A box of spanners from the depot to the town, no clock, nothing to break. ' +
      'Learn where the pedals are.',
    reward: 'Teaches throttle, brakes, steering and following the arrow.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 250 },
    /*
     * No parTime on purpose.
     *
     * Every other job has a clock and the clock is the point. This one does
     * not, because the first ninety seconds a child spends in a new vehicle
     * are spent finding out which key goes forwards, and a countdown running
     * while they do that teaches them the game is already cross with them.
     */
    parTime: 0,
    // Fragility zero: the pips are drawn and they cannot go out. The load is a
    // box of spanners and the game says so. You cannot lose this job.
    cargo: { name: 'BOX OF SPANNERS', fragility: 0 },
    spawn: { place: 'depot' },
    faceTowards: 'town',
    route: (sim) => [placeOf(sim, 'depot'), placeOf(sim, 'town')],
    onStart: loadUp,
    tick: driveTick,
    steps: [
      {
        id: 'pickup',
        text: 'The spanners are in the back. Hold W (or Shift) to pull away, and steer with A and D.',
        hint: 'Shift goes. Ctrl is the brake — keep holding it once you stop and you back up. Take your time.',
        targetLabel: 'the town',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => {
          const veh = V(ctx);
          return !!veh && Math.abs(veh.speed) > 5;
        },
      },
      {
        id: 'road',
        text: 'Follow the arrow to the town. Stay on the tarmac — the grass is slow.',
        hint: 'The big arrow at the bottom of the screen is the next turn. Just follow it.',
        targetLabel: 'the town',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => flatDist(V(ctx) ? V(ctx).pos : { x: 1e9, z: 1e9 }, place(ctx, 'town')) < 260,
      },
      {
        id: 'drop',
        text: 'Nearly there. Pull up next to the yard and stop.',
        hint: 'Brake with Ctrl, or pull the handbrake with Space. You have to be stopped for it to count.',
        targetLabel: 'the town yard',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => arrived(ctx, place(ctx, 'town')),
      },
    ],
    onComplete: (ctx) => {
      handedOver(ctx, 'the town yard', 'The spanners');
      ctx.sim.notify('That is the job. Every one after this has a clock on it.', 'info');
    },
    score: (ctx) => payFor(ctx, 100),
  },

  {
    id: 'shuttle',
    name: 'The Airport Shuttle',
    short: 'Airport shuttle',
    difficulty: 'Easy',
    icon: '▣',
    vehicle: 'car',
    music: 'car',
    blurb:
      'The aeroplane has just landed with a crate on board. Collect it from the apron and run it into town ' +
      'before the shop shuts.',
    reward: 'Teaches the clock, and a job with two legs instead of one.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 8, windDirDeg: 230 },
    /*
     * Generous, and only the card's number.
     *
     * The link road is flat and fast, and this is where a child first learns
     * the clock is beatable — which is the thing that makes them try to beat
     * the next one. The clock they are actually judged against is set from
     * this island's own depot-to-town distance the moment the job starts: 850
     * m on Fjord Approach, 4.7 km on Los Angeles, and one constant cannot be
     * right for both.
     */
    parTime: 210,
    cargo: { name: 'AIR FREIGHT', fragility: 1 },
    spawn: { place: 'depot' },
    faceTowards: 'town',
    /*
     * Depot, apron, town — the job its own blurb describes.
     *
     * The crate step used to target the DEPOT, which is where the van starts,
     * so "drive over to the aeroplane and stop beside the crate" completed on
     * the first frame without anybody touching a key, and the apron the text
     * talks about was never visited. On a map with an airfield place the crate
     * is now on the apron; on one without, the apron IS the depot and it
     * behaves exactly as it did.
     */
    route: (sim) => [placeOf(sim, 'depot'), placeOf(sim, 'apron'), placeOf(sim, 'town')],
    // Flat link road, all tarmac: the fastest average in the game.
    plan: { legs: ['depot', 'apron', 'town'], speed: 19, allow: 40 },
    maxSeconds: 480,
    onStart: (ctx) => {
      loadUp(ctx);
      setPar(ctx);
    },
    tick: driveTick,
    steps: [
      {
        id: 'collect',
        text: 'The crate is on the apron by the aeroplane. Drive over and stop beside it.',
        hint: 'It is the yellow crate on the tarmac. Stop next to it to load up.',
        targetLabel: 'the crate',
        marker: 'crate',
        target: (ctx) => place(ctx, 'apron'),
        check: (ctx) => arrived(ctx, place(ctx, 'apron'), 46),
        onDone: (ctx) => {
          ctx.sim.notify('Loaded. The town shop is expecting it — clock is running.', 'info');
        },
      },
      {
        id: 'run',
        text: 'Take it into town. The clock is running now, so keep it moving.',
        hint: 'Follow the arrow. The tarmac is much faster than cutting the corner.',
        targetLabel: 'the town',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => flatDist(V(ctx) ? V(ctx).pos : { x: 1e9, z: 1e9 }, place(ctx, 'town')) < 240,
      },
      {
        id: 'deliver',
        text: 'Pull up at the shop and stop.',
        hint: 'Stopped, within a few metres. Ctrl is the brake.',
        targetLabel: 'the shop',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => arrived(ctx, place(ctx, 'town')),
      },
    ],
    onComplete: (ctx) => handedOver(ctx, 'the shop', 'The air freight'),
    score: (ctx) => payFor(ctx, 100),
  },

  {
    id: 'coastroad',
    name: 'Coast Road',
    short: 'Coast road',
    difficulty: 'Medium',
    icon: '◌',
    vehicle: 'car',
    music: 'car',
    blurb:
      'Relief crew and a hot meal out to the lighthouse, the long way round the island. ' +
      'Three headlands, three split times, one par.',
    reward: 'Teaches pace: carrying speed through corners instead of braking for all of them.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 280 },
    parTime: 420,
    cargo: { name: 'CREW AND SUPPER', fragility: 1.15 },
    spawn: { place: 'town' },
    faceTowards: 'harbour',
    // The route the next-turn chevron follows: the same chain the clock was
    // set from, so the arrow and the par can never be about different roads.
    route: (sim) => coastChain(sim).points,
    plan: { legs: (sim) => coastChain(sim).points, speed: 17, allow: 45 },
    /*
     * The longest job in the game, on purpose, and allowed to be.
     *
     * Thirteen minutes rather than the usual cap of fifteen minus a bit: a
     * coast run is meant to be the long one, and the three split times give it
     * the shape a long drive needs. Past thirteen it is not a drive any more,
     * it is a commute — which is what it would be on San Francisco, where the
     * arc is thirty-three kilometres.
     */
    maxSeconds: 780,
    onStart: (ctx) => {
      loadUp(ctx);
      const chain = coastChain(ctx.sim);
      ctx.data.splits = [];
      ctx.data.headlands = chain.headlands;
      ctx.data.coastEnd = chain.lighthouse;
      COAST_WORDS.end = chain.endLabel || 'the lighthouse';
      COAST_WORDS.End = COAST_WORDS.end.charAt(0).toUpperCase() + COAST_WORDS.end.slice(1);
      COAST_WORDS.lighthouse = !chain.endLabel;
      setPar(ctx);
    },
    tick: driveTick,
    steps: [
      {
        id: 'away',
        text: 'Crew and supper aboard. Out of town and onto the coast road.',
        hint: 'Follow the arrow — the coast road runs right round the island.',
        targetLabel: 'first headland',
        target: (ctx) => headland(ctx, 0),
        check: (ctx) => passed(ctx, headland(ctx, 0), 140),
        onDone: (ctx) => {
          ctx.data.splits.push(ctx.elapsed);
          ctx.sim.notify(`First headland · ${Math.round(ctx.elapsed)}s`, 'good');
        },
      },
      {
        id: 'mid',
        text: 'Good. Keep the sea on one side and carry your speed through the bends.',
        hint: 'Braking for every corner loses more time than one slide costs you.',
        targetLabel: 'second headland',
        target: (ctx) => headland(ctx, 1),
        check: (ctx) => passed(ctx, headland(ctx, 1), 140),
        onDone: (ctx) => {
          ctx.data.splits.push(ctx.elapsed);
          ctx.sim.notify(`Second headland · ${Math.round(ctx.elapsed)}s`, 'good');
        },
      },
      {
        id: 'far',
        get text() {
          return `Two down. Round the far side and on towards ${COAST_WORDS.end}.`;
        },
        get hint() {
          return COAST_WORDS.lighthouse
            ? 'The lighthouse is the white tower on the point. The arrow knows.'
            : `${COAST_WORDS.End} is at the far end of the road. The arrow knows.`;
        },
        targetLabel: 'third headland',
        target: (ctx) => headland(ctx, 2),
        check: (ctx) => passed(ctx, headland(ctx, 2), 140),
        onDone: (ctx) => {
          ctx.data.splits.push(ctx.elapsed);
          ctx.sim.notify(`Third headland · ${Math.round(ctx.elapsed)}s`, 'good');
        },
      },
      {
        id: 'light',
        get text() {
          return `Last leg — up to ${COAST_WORDS.end} and stop at the door.`;
        },
        hint: 'Slow down early. The last hundred metres are usually gravel.',
        get targetLabel() {
          return COAST_WORDS.end;
        },
        target: (ctx) => coastEnd(ctx),
        check: (ctx) => arrived(ctx, coastEnd(ctx), 44),
      },
    ],
    onComplete: (ctx) => {
      handedOver(ctx, COAST_WORDS.lighthouse ? 'the lighthouse crew' : `the crew at ${COAST_WORDS.end}`, 'Supper');
      const s = ctx.data.splits || [];
      if (s.length === 3) {
        ctx.sim.notify(
          `Splits: ${s.map((t) => `${Math.round(t)}s`).join(' · ')}`,
          'info'
        );
      }
    },
    score: (ctx) => payFor(ctx, 100),
  },

  {
    id: 'summit',
    name: 'Summit Relay',
    short: 'Summit relay',
    difficulty: 'Hard',
    icon: '▲',
    vehicle: 'car',
    music: 'car',
    blurb:
      'A tray of chilled vaccine up the mountain lane to the relay station. It is the way down afterwards ' +
      'that breaks things, not the way up.',
    reward: 'Teaches that the descent is where you lose the load.',
    weather: { time: 'day', condition: 'clear', windSpeedKts: 10, windDirDeg: 200 },
    parTime: 420,
    // The fragile one. This is the job the hairpins were generated for.
    cargo: { name: 'CHILLED VACCINE', fragility: 1.6 },
    // 'foot' is the town wherever the town is at the bottom of a climb, and
    // the bottom of the climb wherever it is not — see networkClimb().
    spawn: { place: 'foot' },
    faceTowards: 'summit',
    route: (sim) => [placeOf(sim, 'foot'), placeOf(sim, 'summit'), placeOf(sim, 'foot')],
    // Up and back down, at hairpin speed with glass in the back.
    plan: { legs: ['foot', 'summit', 'foot'], speed: 12.5, allow: 50 },
    maxSeconds: 660,
    /*
     * There has to be a mountain.
     *
     * Only the climb is tested, not the distance — the distance is the length
     * cap's job, and testing it here as well is how Ember Isle, which is a
     * volcano and is the single best island in the game for this run, got
     * thrown off the list for having its peak too close to the town. Short and
     * steep is a wonderful version of this job. Long and flat is not a version
     * of it at all.
     */
    availableOn: (sim) => placeOf(sim, 'summit').y - placeOf(sim, 'foot').y > 60,
    onStart: (ctx) => {
      loadUp(ctx);
      const net = networkOf(ctx.sim);
      const c = net ? networkClimb(ctx.sim, net) : null;
      SUMMIT_WORDS.foot = c && c.foot.name ? c.foot.name : 'the town';
      ctx.data.climbed = false;
      setPar(ctx);
      ctx.sim.notify('Glass vials. Five pips, and they are not coming back.', 'warn');
    },
    tick: (ctx, dt) => {
      driveTick(ctx, dt);
      /*
       * A word, once, at the top.
       *
       * The lesson of this job is that going down is harder than going up, and
       * a child who has just climbed it cleanly has every reason to believe
       * the hard part is over. Saying so once, at the exact moment they turn
       * round, is the difference between a lesson and an ambush.
       */
      const veh = V(ctx);
      if (!veh || ctx.data.warnedDescent) return;
      if (ctx.data.climbed && heightAt(veh.pos.x, veh.pos.z) < place(ctx, 'summit').y - 60) {
        ctx.data.warnedDescent = true;
        ctx.sim.notify('Going down: low gear, gentle brakes. This is where the vials break.', 'warn');
      }
    },
    steps: [
      {
        id: 'climb',
        text: 'Chilled vaccine for the relay station. Up the mountain lane — take the hairpins slowly.',
        hint: 'The load hates being dropped. Slow into the bends, power out of them.',
        targetLabel: 'the summit relay',
        target: (ctx) => place(ctx, 'summit'),
        check: (ctx) => arrived(ctx, place(ctx, 'summit'), 48),
        onDone: (ctx) => {
          ctx.data.climbed = true;
          const c = ctx.data.cargo;
          ctx.sim.notify(
            c && c.pips === 5 ? 'Vaccine handed over intact. Now bring the empties back down.' : 'Vaccine handed over. Empties back down, please.',
            c && c.pips === 5 ? 'good' : 'warn'
          );
        },
      },
      {
        id: 'descend',
        get text() {
          return `Empty crates back down to ${SUMMIT_WORDS.foot}. Careful — the road is steeper than it looked.`;
        },
        hint: 'Let the engine hold you back. Braking hard on a slope is what loses pips.',
        get targetLabel() {
          return SUMMIT_WORDS.foot;
        },
        target: (ctx) => place(ctx, 'foot'),
        check: (ctx) => arrived(ctx, place(ctx, 'foot')),
      },
    ],
    onComplete: (ctx) => {
      // Where the empties actually went: the foot of the climb, which the
      // text has called the town (or the bottom of the lane) all the way down.
      // "Delivered to the depot" was a place this job never goes.
      handedOver(ctx, SUMMIT_WORDS.foot, 'The empties');
      const c = ctx.data.cargo;
      if (c && c.pips === 5) {
        ctx.data.bonus = 12;
        ctx.sim.notify('Not one broken vial. The clinic asked for you by name.', 'good');
      }
    },
    score: (ctx) => payFor(ctx, 104),
  },

  {
    id: 'lowtide',
    name: 'Low Tide',
    short: 'Low tide',
    difficulty: 'Hard',
    icon: '▭',
    vehicle: 'car',
    music: 'car',
    blurb:
      'Building sand and a water pump out to the outpost, along the gravel track. The low road floods when ' +
      'the tide turns, and the tide is already on its way.',
    reward: 'Teaches loose surfaces, and a deadline with a price rather than a restart.',
    weather: { time: 'day', condition: 'cloudy', windSpeedKts: 17, windDirDeg: 300 },
    parTime: 240,
    cargo: { name: 'PUMP AND SAND', fragility: 0.9 },
    // Loose surface all the way, so the slowest tarmac-free average.
    plan: { legs: ['depot', 'outpost'], speed: 13.5, allow: 35 },
    maxSeconds: 660,
    spawn: { place: 'depot' },
    faceTowards: 'outpost',
    route: (sim) => [placeOf(sim, 'depot'), placeOf(sim, 'outpost')],
    onStart: (ctx) => {
      loadUp(ctx);
      /*
       * The tide and the clock are the same number, on purpose.
       *
       * Two deadlines is one too many to hold in your head at ten years old,
       * and a tide written as a constant four minutes is either trivial on a
       * small island or impossible on a big one. Beat the par and you beat the
       * tide: one thing to do, and it scales with the island.
       */
      ctx.data.tide = setPar(ctx);
      ctx.data.soaked = false;
      const mins = Math.max(1, Math.round(ctx.data.tide / 60));
      ctx.sim.notify(`Tide turns in about ${mins} minutes. After that the low road is under water.`, 'warn');
    },
    tick: (ctx, dt) => {
      driveTick(ctx, dt);
      /*
       * The window costs you; it does not end you.
       *
       * A four-minute timer that fails the mission is a restart every time a
       * child takes a wrong turn, which is precisely the thing this game is
       * built not to do. So the tide comes in, the load gets soaked, two pips
       * go, and the job carries on — you are wading the last mile and you are
       * going to be paid badly for it, which is a real consequence that costs
       * nobody ninety seconds of their afternoon.
       */
      if (ctx.data.soaked || ctx.elapsed < ctx.data.tide) return;
      ctx.data.soaked = true;
      const c = ctx.data.cargo;
      if (c) {
        c.cooldown = 0;
        c.knock('The tide is in — the sand is soaked', ctx.sim);
        c.cooldown = 0;
        c.knock('Water through the pump housing', ctx.sim);
      }
      ctx.sim.notify('You are through it, but wet. Get it there anyway.', 'warn');
    },
    steps: [
      {
        id: 'track',
        text: 'Pump and sand for the outpost. Take the gravel track — and go before the tide turns.',
        hint: 'Gravel does not grip like tarmac. Turn earlier and brake earlier than you want to.',
        targetLabel: 'the outpost',
        target: (ctx) => place(ctx, 'outpost'),
        check: (ctx) => flatDist(V(ctx) ? V(ctx).pos : { x: 1e9, z: 1e9 }, place(ctx, 'outpost')) < 300,
      },
      {
        id: 'unload',
        text: 'Outpost ahead. Pull up on the hard standing and stop.',
        hint: 'Stopped, next to the buildings. Nearly there.',
        targetLabel: 'the outpost',
        target: (ctx) => place(ctx, 'outpost'),
        check: (ctx) => arrived(ctx, place(ctx, 'outpost'), 44),
      },
    ],
    onComplete: (ctx) => {
      handedOver(ctx, 'the outpost', 'The pump');
      if (!ctx.data.soaked) {
        ctx.data.bonus = 10;
        ctx.sim.notify('Beat the tide with dry feet. They noticed.', 'good');
      }
    },
    score: (ctx) => payFor(ctx, 100),
  },

  {
    id: 'nightcall',
    name: 'Night Call-out',
    short: 'Night call-out',
    difficulty: 'Hard',
    icon: '◑',
    vehicle: 'car',
    music: 'car',
    blurb:
      'Two in the morning, raining, and the outpost needs the doctor. Headlights, a wet road and a map — ' +
      'and a passenger who would rather you did not throw her about.',
    reward: 'Teaches night driving, wet grip, and reading the minimap.',
    weather: { time: 'night', condition: 'rainy', windSpeedKts: 16, windDirDeg: 210 },
    parTime: 360,
    // A person. The most fragile load in the game, and the only one that
    // complains.
    cargo: { name: 'THE DOCTOR', fragility: 1.6 },
    // Out and back, wet and dark. The slowest average of any job.
    plan: { legs: ['town', 'outpost', 'town'], speed: 13, allow: 50 },
    maxSeconds: 720,
    spawn: { place: 'town' },
    faceTowards: 'outpost',
    route: (sim) => [placeOf(sim, 'town'), placeOf(sim, 'outpost'), placeOf(sim, 'town')],
    onStart: (ctx) => {
      loadUp(ctx);
      ctx.data.grumbles = 0;
      setPar(ctx);
      ctx.sim.notify('Wet road, dark, and someone in the passenger seat. Steady.', 'warn');
    },
    tick: (ctx, dt) => {
      driveTick(ctx, dt);
      /*
       * She says something when you frighten her.
       *
       * The pips are on the HUD and the HUD at night has a lot going on. A
       * passenger is the one cargo that can speak for itself, and one line of
       * complaint teaches what five silent pips do not: that particular corner
       * was too fast.
       */
      const c = ctx.data.cargo;
      if (!c) return;
      const lost = c.max - c.pips;
      if (lost > ctx.data.grumbles) {
        ctx.data.grumbles = lost;
        const lines = [
          '"Steady on. I would like to arrive as well."',
          '"Slower through the corners, please."',
          '"I am going to be no use to anybody if we end up in a ditch."',
          '"Please. Slowly."',
          '"Just get us there. In one piece."',
        ];
        ctx.sim.notify(lines[Math.min(lost - 1, lines.length - 1)], 'warn');
      }
    },
    steps: [
      {
        id: 'out',
        text: 'The doctor is aboard. Out to the outpost — headlights on, and mind the wet.',
        hint: 'The minimap in the corner shows the road ahead. Use it before the corner, not in it.',
        targetLabel: 'the outpost',
        target: (ctx) => place(ctx, 'outpost'),
        check: (ctx) => arrived(ctx, place(ctx, 'outpost'), 46),
        onDone: (ctx) => ctx.sim.notify('"Thank you. Wait here — I will not be long."', 'good'),
      },
      {
        id: 'back',
        text: 'She is done. Take her home to the town.',
        hint: 'Same road, other way. You know it now.',
        targetLabel: 'the town',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => arrived(ctx, place(ctx, 'town')),
      },
    ],
    onComplete: (ctx) => {
      const c = ctx.data.cargo;
      ctx.sim.notify(
        c && c.pips >= 4
          ? '"That was a good drive. Ask for me next time there is a call-out."'
          : '"We got there. Let us not do it quite like that again."',
        c && c.pips >= 4 ? 'good' : 'warn'
      );
      if (c && c.pips === 5) ctx.data.bonus = 14;
    },
    score: (ctx) => payFor(ctx, 110),
  },
];

/*
 * The drop-off marker goes when the job does.
 *
 * It is drawn and moved by updateDrive, and updateDrive stops running the
 * moment the runner completes (the game goes to the debrief) — so the green
 * beam stood behind "Job done!" on every job, pointing at a delivery that
 * had been made. Car jobs never fail (see the top of this file), so the
 * completion is the only way one ends; every job's own handover runs after
 * the marker is put away.
 */
for (const job of CAR_JOBS) {
  const handover = job.onComplete;
  job.onComplete = (ctx, result) => {
    const m = ctx && ctx.sim && ctx.sim.courierMarker;
    if (m) m.hide();
    if (handover) handover(ctx, result);
    /*
     * What the debrief needs to be the van's (see vanDebrief): which job this
     * was, so "Drive again" can start it again, and what happened to the load.
     * The game's onComplete runs straight after this and builds the debrief
     * through menus.showDebrief, which the courier plug-in (below) reads this
     * from. Left for it rather than pushed at the screen afterwards.
     */
    const sim = ctx && ctx.sim;
    if (!sim) return;
    const cargo = ctx.data && ctx.data.cargo;
    const par = parOf(ctx);
    sim._vanDone = {
      id: job.id,
      name: job.name,
      score: result && result.score,
      time: result && result.time != null ? result.time : ctx.elapsed,
      pips: cargo ? cargo.pips : null,
      max: cargo ? cargo.max : 5,
      knocks: cargo ? cargo.knocks.slice() : [],
      over: par ? Math.max(0, ctx.elapsed - par) : 0,
    };
  };
}

/*
 * THE DEBRIEF, IN THE VAN'S WORDS, WITH THE VAN'S BUTTONS.
 *
 * There is one debrief for every mission, the aeroplane's (onMissionComplete
 * in main.js): "Mission complete!", "Try it again for a better score" under a
 * 100/100, and a "Fly again" button. The first pass changed those words on
 * the screen a microtask after it was built, and only the words — so "Drive
 * again" was still the aeroplane's button: restart() -> startMode('drive'),
 * and startMode has no drive branch. The reviewer measured it: Car, Jobs,
 * First Run to 100/100, "Drive again" -> a Skylark on Drover's Flat runway
 * 09, "Free Flight · Hold Shift for full power", no van, no job. Low Tide the
 * same.
 *
 * So the debrief a car job gets is built here, whole, from what the job
 * recorded (sim._vanDone above), and handed to menus.showDebrief in place of
 * the aeroplane's: the title, the score and time, what happened to the load
 * and why, and three buttons that do van things — "Drive again" starts THIS
 * job again through startDrive, "Jobs" is the board, "Main menu" the front
 * page. It depends on nothing in the aeroplane's markup or wording, and if
 * the game ever stops calling showDebrief this simply never runs.
 */
const KNOCK_TIPS = [
  [/off the road/i, 'Lift off W when the arrow says SLOW DOWN, and the van stays on the road.'],
  [/landing/i, 'Take the crests gently — the load does not like leaving the ground.'],
  [/braking/i, 'Brake earlier and softer, and the load stays put.'],
  // Before /water/: Low Tide's two knocks are the tide and "Water through
  // the pump housing", and the sea was never the van's fault — the clock was.
  [/tide/i, 'Beat the clock and you beat the tide.'],
  [/water/i, 'Keep it out of the sea!'],
];

export function vanDebrief(sim, done, shown) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const score = Math.round(done.score || 0);
  // Whole seconds first: rounding the remainder read 119.6 s as "1m 60s".
  const t = Math.round(Math.max(0, done.time || 0));
  const mins = Math.floor(t / 60);
  const secs = t % 60;
  const rows = [`<li>Time <b>${mins}m ${String(secs).padStart(2, '0')}s</b></li>`];
  if (done.pips != null) {
    rows.push(`<li>Load <b>${done.pips} of ${done.max || 5}</b>${done.pips === 0 ? ' (wrecked)' : ''}</li>`);
  }
  // What knocked it, counted, most often first: "Off the road at speed ×3".
  const count = new Map();
  for (const k of done.knocks || []) count.set(k, (count.get(k) || 0) + 1);
  const knocks = [...count].sort((a, b) => b[1] - a[1]);
  if (knocks.length) {
    rows.push(`<li>Knocks <b>${knocks.map(([k, n]) => esc(k) + (n > 1 ? ` ×${n}` : '')).join(', ')}</b></li>`);
  }
  if (done.over > 1) rows.push(`<li>Over the clock by <b>${Math.round(done.over)} s</b></li>`);
  // One thing to do better, the one that cost the most.
  let tip = '';
  for (const [k] of knocks) {
    const hit = KNOCK_TIPS.find(([re]) => re.test(k));
    if (hit) { tip = hit[1]; break; }
  }
  if (!tip && done.over > 1) tip = 'Beat the clock and it pays full rate.';
  const words = score >= 100
    ? 'Full marks. Take another job from the board, or drive this one again.'
    : `${tip ? tip + ' ' : ''}Drive it again for a better score, or take another job from the board.`;
  const id = done.id;
  return {
    title: score >= 100 ? 'Delivered!' : done.pips === 0 ? 'Delivered — but the load is wrecked' : 'Delivered!',
    kind: (shown && shown.kind) || 'good',
    body: `
      <div class="debrief-score">${score}<span>/100</span></div>
      <ul class="debrief-list">${rows.join('')}</ul>
      <p>${esc(words)}</p>
    `,
    actions: [
      // The job itself, again: the van, at the start, with a fresh load.
      { label: 'Drive again', onClick: () => sim.startDrive('car', { job: id }), primary: true },
      { label: 'Jobs', onClick: () => sim.quitToMenu('missions') },
      { label: 'Main menu', onClick: () => sim.quitToMenu('main') },
    ],
  };
}

/** Find a job by id, the same way findMission() works for the aeroplane. */
export function findJob(id) {
  return CAR_JOBS.find((j) => j.id === id) || null;
}

/*
 * THE JOB'S SKY, BORROWED AND GIVEN BACK.
 *
 * Night Call-out's card says two in the morning and raining; startDrive loads
 * that, and has to put the sky it found back afterwards. stopDrive did. But
 * the pause menu's "Main menu" and the debrief's "Jobs" go through
 * quitToMenu, which never calls stopDrive — measured: quit Night Call-out
 * half way and the front page stayed night and rain until the next drive
 * happened to start. quitToMenu does call every plug-in's stop hook, so the
 * sky is given back from there as well as from stopDrive and startDrive; it
 * is given back once, whichever gets there first.
 */
export function borrowJobSky(sim, def) {
  if (!sim || !sim.weather || !def || !def.weather) return;
  if (sim._weatherBeforeJob == null) sim._weatherBeforeJob = sim.weather.serialize();
  sim.weather.load(def.weather);
}

export function giveBackJobSky(sim) {
  if (!sim || sim._weatherBeforeJob == null || !sim.weather) return;
  sim.weather.load(sim._weatherBeforeJob);
  sim._weatherBeforeJob = null;
}

// No `return` from the hook: a stop hook that returns true stops the others.
registerExtension({
  id: 'courier-sky',
  /*
   * The boat started straight from the van, without stopDrive (startDrive
   * calls straight through): the van's marker, arrow and sky go, as
   * stopDrive's car branch would have done. main.js used to do this at the
   * top of every startDrive, boat included.
   */
  startMode(sim, mode) {
    if (mode === 'drive' && sim.vehicle && sim.vehicle.isBoat && sim.courierGuide) IslandRoads.van.stop(sim);
  },
  // The menu (quitToMenu) is reached without stopDrive: the beam behind the
  // front page, and the night sky on it.
  stop(sim) {
    giveBackJobSky(sim);
    if (sim.courierMarker) sim.courierMarker.hide();
  },
});

/*
 * EVERY WAY OF STARTING THE VAN AGAIN STARTS THE VAN.
 *
 * Three buttons a child presses in the van went to the aeroplane:
 *
 *   - the debrief's "Drive again" (fixed at the source: vanDebrief above);
 *   - the pause menu's Restart, which is main.js restart() ->
 *     startMode(this.mode, this.modeOpts) = startMode('drive', { kind: 'car',
 *     job }). startMode has no drive branch, so it set up a Free Flight in
 *     the Skylark on the runway — measured by the reviewer mid-job, and
 *     measured again here before this: mode 'drive', no vehicle, runner
 *     idle, "Free Flight" on the HUD;
 *   - the pause menu's "Return to the airfield", which is returnToAirport():
 *     the aeroplane put back on runway 09, "Back on runway 09, ready to go
 *     again." on the HUD, and the job started again from its first step with
 *     the van left wherever it was parked.
 *
 * restart(), startMode() and returnToAirport() are not the car's to edit, so
 * the fix is here. The pause card's two buttons are caught before main.js
 * sees them (install, below). Any other way to them lands in the two hooks
 * they already call: startMode ends by
 * calling every plug-in's startMode, and returnToAirport starts by calling
 * every plug-in's stop('airport'). Either one, while the courier van is what
 * is being driven, puts the van back where the job (or free drive) starts,
 * through startDrive — which hides the menu, clears the HUD's toasts and
 * starts the job afresh. It runs on a microtask, after the hook that asked
 * for it and before the next frame, so nothing of the aeroplane is ever drawn
 * and the other plug-ins' hooks are not called twice over in the middle of
 * one another. Only the courier van: a tug the airport plug-in started from
 * on foot has its own idea of what Restart means.
 *
 * And the debrief itself is swapped for the van's (see vanDebrief), by
 * wrapping menus.showDebrief once at install. A debrief that is not for a
 * car job that has just been delivered is passed through untouched. The
 * pause card's numbers the same way (vanPauseInfo), and its two aeroplane
 * button labels from the van's HUD (DriveHud.pauseWords).
 *
 * Measured with this in place, pressed the way a child presses them: "Drive
 * again" after First Run, Restart mid-job and "Back to the start" mid-job
 * each put the van back at the depot (947, -196), heading 182, First Run
 * running from its first step, the aeroplane never drawn. The proper home
 * for all three is restart() and returnToAirport() knowing about the van;
 * until main.js's owner does that, this is what makes them right.
 */
/** The pause card in the van: what a driver would want to know, in km/h. */
function vanPauseInfo(sim, v) {
  const h = Math.round(((v.heading % 360) + 360) % 360);
  const running = sim.runner && sim.runner.status === 'running' ? sim.runner : null;
  const cargo = running && running.data && running.data.cargo;
  const t = running ? Math.max(0, running.elapsed || 0) : 0;
  const time = `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  return `
      <div class="pause-grid">
        <span>Speed<b>${Math.round(Math.abs(v.speed) * 3.6)} km/h</b></span>
        <span>Heading<b>${String(h).padStart(3, '0')}°</b></span>
        <span>Job<b>${running && running.def ? running.def.name : 'Free drive'}</b></span>
        ${cargo ? `<span>Load<b>${cargo.pips} of ${cargo.max || 5}</b></span>` : ''}
        ${running ? `<span>Time<b>${time}</b></span>` : `<span>Trip<b>${((v.distance || 0) / 1000).toFixed(1)} km</b></span>`}
      </div>
    `;
}

/** The courier van (not the boat, not the airport's tug) is what is being driven. */
function courierVanOut(sim) {
  return sim.mode === 'drive' && !!sim.vehicle && !sim.vehicle.isBoat && !!sim.modeOpts && sim.modeOpts.kind === 'car';
}

function driveAgainOpts(opts) {
  const o = { ...(opts || {}) };
  delete o.kind;
  return o;
}

registerExtension({
  id: 'courier-van',
  install(sim) {
    const menus = sim && sim.menus;
    if (!menus || typeof menus.showDebrief !== 'function' || menus._vanDebrief) return;
    const shown = menus.showDebrief;
    menus._vanDebrief = true;
    menus.showDebrief = function (d) {
      const done = sim._vanDone;
      sim._vanDone = null;
      const ours = done && sim.mode === 'drive' && sim.runner && sim.runner.def && sim.runner.def.id === done.id
        && sim.runner.status === 'complete';
      return shown.call(this, ours ? vanDebrief(sim, done, d) : d);
    };
    /*
     * And the pause card's numbers. main.js pause() writes the aeroplane's
     * whatever is being driven: measured in the van mid-job, "Speed 0 kt,
     * Height 51 ft, Heading 090°, Fuel 100%" — the parked Skylark's, while
     * the van stood at 54 km/h heading 182. In a van (anything driven that
     * is not the boat) the card says the van's instead.
     */
    /*
     * The pause card's Restart and "Back to the start", pressed in the courier
     * van, go straight to startDrive: caught on the way down to the button
     * (the capture phase on the pause screen), before menus.js hands them to
     * main.js. Otherwise Restart first set up a whole Free Flight
     * (restart() -> startMode, which also counts it as a flight) and the
     * other one first put the aeroplane on runway 09 and said "Back on runway
     * 09, ready to go again." — the van only came back a microtask later,
     * through the hooks below, which stay for any other way those two are
     * reached (the HUD's own buttons).
     */
    const pause = menus.screens && menus.screens.pause;
    if (pause && !pause._vanClicks) {
      pause._vanClicks = true;
      pause.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('[data-act="restart"], [data-act="airport"]') : null;
        if (!b || !courierVanOut(sim)) return;
        e.stopPropagation();
        e.preventDefault();
        sim.startDrive('car', driveAgainOpts(sim.modeOpts));
      }, true);
    }
    /*
     * The same two in the HUD's ⋯ tray (Restart, and the airfield button the
     * van's HUD calls "Back to the start"): caught on the tray, before the
     * button's own handler, so they too go straight to the van rather than
     * through a Free Flight or runway 09 and back.
     */
    const hud = sim.hud;
    const tray = hud && hud.tray;
    if (tray && !tray._vanClicks) {
      tray._vanClicks = true;
      tray.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('button') : null;
        if (!b || (b !== hud.btnRestart && b !== hud.btnAirport) || !courierVanOut(sim)) return;
        e.stopPropagation();
        e.preventDefault();
        b.blur();
        if (typeof hud.setTrayOpen === 'function') hud.setTrayOpen(false);
        sim.startDrive('car', driveAgainOpts(sim.modeOpts));
      }, true);
    }
    if (typeof menus.setPauseInfo === 'function' && !menus._vanPause) {
      const info = menus.setPauseInfo;
      menus._vanPause = true;
      menus.setPauseInfo = function (html) {
        const v = sim.mode === 'drive' ? sim.vehicle : null;
        return info.call(this, v && !v.isBoat ? vanPauseInfo(sim, v) : html);
      };
    }
  },
  startMode(sim, mode, opts) {
    // Only startMode's own call arrives with no vehicle: startDrive builds the
    // van before it calls the hooks.
    if (mode !== 'drive' || sim.vehicle || !opts || opts.kind !== 'car') return;
    const again = driveAgainOpts(opts);
    queueMicrotask(() => {
      if (sim.mode === 'drive' && !sim.vehicle) sim.startDrive('car', again);
    });
  },
  stop(sim, why) {
    if (why !== 'airport' || sim.mode !== 'drive' || !sim.vehicle) return;
    const opts = sim.modeOpts || {};
    if (opts.kind !== 'car') return;
    const again = driveAgainOpts(opts);
    queueMicrotask(() => {
      if (sim.mode === 'drive') sim.startDrive('car', again);
    });
  },
});

/**
 * Town, three headlands and the light — the coast run, as a list of points.
 *
 * Shared between the job's plan (so the menu can price it) and its onStart (so
 * the split times land on the same three headlands the clock was set from).
 * Two copies of this would be two different coast roads.
 */
function coastChain(sim) {
  const net = networkOf(sim);
  if (net) {
    let hit = COAST_BY_NET.get(net);
    if (hit === undefined) {
      hit = coastChainOnRoads(sim, net);
      COAST_BY_NET.set(net, hit);
    }
    if (hit) return hit;
  }
  return coastChainOverLand(sim);
}

/** The coast road's words for where it ends, for the step text. One job runs
 *  at a time, so one set of words is enough; onStart writes them. */
const COAST_WORDS = { end: 'the lighthouse', End: 'The lighthouse', lighthouse: true };
/** The same for the Summit Relay: where the empties go back down to. */
const SUMMIT_WORDS = { foot: 'the town' };
const COAST_BY_NET = new WeakMap();

/** A headland's point, from this run's data, or worked out if the run has
 *  not started yet (the spawn asks the first step where it is going). */
function headland(ctx, i) {
  const h = ctx.data.headlands || coastChain(ctx.sim).headlands;
  return h[i];
}
function coastEnd(ctx) {
  return ctx.data.coastEnd || coastChain(ctx.sim).lighthouse;
}

/**
 * The coast run on an island with roads: from the town to the far end of the
 * network, by road, with the three split points a quarter, a half and three
 * quarters of the way along it.
 *
 * The version below this marches to the coastline from the island's middle,
 * which puts the three headlands wherever the shore happens to be — in a
 * field, across a bay, on a beach no road goes near — and the lighthouse on
 * Drover's Flat is Cobb Light, on its own rock four kilometres out to sea.
 * The job was offered, the arrow pointed across the water, and it could not
 * be finished. Here the end is a lighthouse the van can reach if there is
 * one, and otherwise the place farthest from the town by road; the splits are
 * on the tarmac by construction.
 */
function coastChainOnRoads(sim, net) {
  const town = placeOf(sim, 'town');
  let end = networkPlace(sim, 'lighthouse');
  let label = null;
  if (!end) {
    const places = (sim.roads && sim.roads.places && sim.roads.places.length ? sim.roads.places : null)
      || (MAP && MAP.courier && MAP.courier.places) || [];
    let best = null;
    for (const p of places) {
      if (p.boatOnly) continue;
      if (distanceToRoads(net, p.x, p.z, 200) > 150) continue;
      const r = routeOnRoads(net, town, p);
      if (!r) continue;
      const L = routeLengthM(r);
      if (!best || L > best.L) best = { p, L };
    }
    if (best) {
      const near = nearestRoadPoint(net, best.p.x, best.p.z);
      end = { x: near.x, z: near.z, name: best.p.name };
      label = best.p.name || null;
    } else {
      // A network with no addresses: the far end of its own road, which on a
      // coast road is exactly where a lighthouse would be.
      const lh = placeOf(sim, 'lighthouse');
      if (distanceToRoads(net, lh.x, lh.z, 200) > 150) return null;
      end = { x: lh.x, z: lh.z, name: null };
    }
  }
  const route = routeOnRoads(net, town, end);
  if (!route) return null;
  const L = routeLengthM(route);
  if (L < 1200) return null;
  const headlands = [0.25, 0.5, 0.75].map((f) => {
    const a = alongRoute(route, L * f);
    return onGround(a.x, a.z);
  });
  const lh = onGround(end.x, end.z);
  return { town, headlands, lighthouse: lh, endLabel: label, points: [town, ...headlands, lh] };
}

/** The coast run on an island without roads: the original, over the land. */
function coastChainOverLand(sim) {
  const main = (ISLANDS && ISLANDS[0]) || { cx: 0, cz: 0 };
  const town = placeOf(sim, 'town');
  const lh = placeOf(sim, 'lighthouse');
  const bear = (p) => (Math.atan2(p.x - main.cx, -(p.z - main.cz)) * 180) / Math.PI;
  const from = bear(town);
  /*
   * Go the LONG way round, and put the headlands on that arc.
   *
   * The first version used three fixed bearings, which is a full lap of the
   * island regardless of where the town and the light actually are — on
   * Kestrel that is thirteen kilometres and on the air base map it is forty.
   * Splitting the long arc between the two places into three gives three
   * headlands that are genuinely on the way, on any island, and a job whose
   * length is set by the island rather than by me.
   */
  let sweep = (bear(lh) - from + 360) % 360;
  if (sweep < 180) sweep -= 360;
  const headlands = [0.25, 0.5, 0.75].map((f) => {
    const c = marchToCoast(main.cx, main.cz, from + sweep * f);
    return onGround(c.x, c.z);
  });
  return { town, headlands, lighthouse: lh, points: [town, ...headlands, lh] };
}

/**
 * The jobs worth offering on the island we are on now.
 *
 * Returns every job with an `available` flag rather than a filtered list, on
 * purpose, and for the same reason menus.js builds every card and then hides
 * the locked ones (see the comment at menus.js:560): a card filtered out at
 * build time can never come back, and a child who saw six jobs on Kestrel and
 * five on the fjords with no explanation assumes something is broken. Grey it
 * out and say why.
 *
 * GRADED ON THE ISLAND THE VAN WILL DRIVE, NOT THE ONE THAT IS LOADED.
 *
 * The board is opened from the menu, and the menu's island is the
 * aeroplane's: Kestrel, unless you picked one. "Take this job" drives on
 * sim.mapForGame('car') — Drover's Flat unless you picked one — and only
 * loads it when you press it. Grading against whatever was loaded, the
 * default Car board said Summit Relay was "Not on this island — it has not
 * got the ground for it", because Kestrel has not; on Drover's Flat it is
 * a 311 s job the arrow bot delivers with 5 pips. And the lengths were
 * Kestrel's: Shuttle "about 1 minute" (164-190 s on Drover's Flat), Low
 * Tide "about 3 minutes" (26-33 s). After a drive, quitToMenu puts Kestrel
 * back, so it was wrong again every time the board was reopened.
 *
 * So a board is only graded while the van's own island is the one loaded —
 * which is every time a drive starts (startDrive asks for one) — and
 * remembered per island. Opened from the menu with some other island
 * loaded, it shows what was last measured on the van's island; before
 * anything has been, every job is open and the only note is the one that
 * does not depend on an island ("No clock"), which is what the base game
 * offered and is the truth on Drover's Flat.
 */
const BOARDS = new Map();
export function jobsFor(sim) {
  const here = (MAP && MAP.id) || null;
  const vans = sim && typeof sim.mapForGame === 'function' ? sim.mapForGame('car') : here;
  if (vans && here && vans !== here) {
    const known = BOARDS.get(vans);
    if (known) return known;
    return CAR_JOBS.map((job) => ({ job, available: true, note: job.plan ? '' : 'No clock', why: '' }));
  }
  const board = gradeBoard(sim);
  if (here) BOARDS.set(here, board);
  return board;
}

function gradeBoard(sim) {
  return CAR_JOBS.map((job) => {
    const secs = estimateSeconds(sim, job);
    /*
     * Two separate reasons a job can be off the board, and they are not the
     * same reason.
     *
     * `availableOn` is "this island has not got the thing this job is about" —
     * no mountain worth climbing. The length cap is "it has, twenty-two
     * kilometres away". The second is why there is a cap at all: the audience
     * is a class, the lesson is forty minutes, and a job that cannot be
     * finished inside one is not a hard job, it is an unfinished one. Anything
     * under the cap is offered with its length written on the card, because a
     * long drive is a perfectly good thing to choose on purpose.
     */
    const suits = job.availableOn ? !!job.availableOn(sim) : true;
    const cap = job.maxSeconds || 900;
    const short = !secs || secs <= cap;
    const road = suits ? byRoad(sim, job) : true;
    return {
      job,
      available: suits && short && road,
      note: lengthNote(sim, job),
      why: !suits
        ? 'Not on this island — it has not got the ground for it'
        : !road
          ? 'Not on this island — no road goes there'
          : !short
            ? `Too far on this island — ${Math.round(secs / 60)} minutes of driving`
            : '',
    };
  });
}

/**
 * Can every stop on this job be reached by road?
 *
 * The third reason a job is off the board, and the one the board did not
 * know about: on Drover's Flat the coast road's lighthouse is on a rock out
 * at sea, so the job was offered, priced by the straight line to it, and
 * impossible. Only asked on a map with a network; without one there is
 * nothing to be off.
 */
function byRoad(sim, job) {
  const net = networkOf(sim);
  if (!net) return true;
  let pts = null;
  try {
    pts = job.plan ? planPoints(sim, job) : typeof job.route === 'function' ? job.route(sim) : null;
  } catch (e) {
    return false;
  }
  if (!pts || pts.length < 2) return true;
  for (const p of pts) if (distanceToRoads(net, p.x, p.z, 200) > 150) return false;
  for (let i = 1; i < pts.length; i++) if (!routeOnRoads(net, pts[i - 1], pts[i])) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * FREE MODE — ISLAND ROADS.
 *
 * No clock, no load, no instruction. The exploring fantasy done as a reward
 * rather than as an absence of one: the standing instruction on this project
 * is that "idk what to do" is the failure mode, so free mode is not a mood, it
 * is a board of jobs you may take and a set of places you have not been.
 *
 * Reaching a named place for the first time pays a small credit bounty and
 * writes its name on the minimap. That is the whole loop and it is enough,
 * because it means there is always a next thing and the next thing is
 * somewhere.
 * ------------------------------------------------------------------ */

/**
 * The Free Drive definition itself.
 *
 * Zero steps, on purpose: MissionRunner treats a def with no steps as nothing
 * to run, exactly as FREE_FLIGHT does for the aeroplane, so the clock never
 * starts and there is nothing to fail.
 */
export const ISLAND_ROADS = {
  id: 'islandroads',
  name: 'Island Roads',
  short: 'Island roads',
  difficulty: 'Free',
  icon: '○',
  vehicle: 'car',
  music: 'car',
  blurb: 'No clock. Take a job from the board or just drive and see where the roads go.',
  reward: 'Finding somewhere new pays a small bounty and puts it on your map.',
  spawn: { place: 'depot' },
  faceTowards: 'town',
  steps: [],
};

/**
 * Pay a few credits without touching the leaderboard.
 *
 * progression.award() is the right call for finishing a job — it scores you,
 * ranks you and puts you on the board. It is the wrong call for finding a
 * lighthouse: the board is five slots deep and total, and forty discovery
 * entries would push every real flight off it. So the bounty is credits and
 * nothing else.
 */
function payCredits(sim, n, why) {
  try {
    const p = sim.prog;
    if (!p) return;
    p.credits = (p.credits || 0) + n;
    p.earned = (p.earned || 0) + n;
    Prog.save(p);
    if (sim.menus && sim.menus.syncProgression) sim.menus.syncProgression(p);
    if (sim.hud) sim.hud.notify(`${why} · +${n} credits`, 'good', 4);
  } catch (e) {
    console.warn('Could not pay the discovery bounty.', e);
  }
}

export class IslandRoads {
  /**
   * @param {object} sim  the game, for the HUD, the minimap and the wallet.
   */
  constructor(sim) {
    this.sim = sim;
    const net = networkOf(sim);
    const depot = placeOf(sim, 'depot');
    /*
     * Only places a van can get to, and each spot only once.
     *
     * All six names used to go on the list whatever they resolved to, so on
     * Drover's Flat the list had a lighthouse on a rock out at sea (never
     * findable) and a "summit" that was a knoll 261 m from the depot — found
     * by accident twelve seconds into the first drive, before the child had
     * found the road. A place is on the list now if the road reaches it (or,
     * on a map without roads, if it is on the same island as the depot), and
     * two names that land on the same spot count once.
     */
    /*
     * And only places that are really there.
     *
     * The list above still went through placeOf(), which never says no: a
     * name the map does not have is worked out from the terrain and parked on
     * the nearest road. On Drover's Flat "summit" came out as a bit of the
     * depot road 260 m south of the van and eight metres higher, and "Found
     * the summit relay · +30 credits" popped up nine seconds into the first
     * drive, holding Shift, on the road out of the yard. So on a map that
     * names its places, the list is those places — every one the road
     * reaches, by the map's own name for it (Drover's Flat: the Airfield,
     * Drover, Holt, Ferry Hard, Drover Relay, the Weather Station) — and
     * nothing is on it that is less than a street away from where you start.
     */
    this.places = [];
    const named = net
      ? ((sim.roads && sim.roads.places && sim.roads.places.length ? sim.roads.places : null)
        || (MAP && MAP.courier && MAP.courier.places) || []).filter((p) => !p.boatOnly)
      : [];
    const add = (name, label, pos) => {
      if (this.places.some((p) => flatDist(p.pos, pos) < 150)) return;
      this.places.push({ name, label, pos, found: false });
    };
    if (named.length) {
      const home = named.find((p) => p.id === 'depot' || p.kind === 'depot');
      add('depot', PLACE_LABELS.depot, depot);
      for (const p of named) {
        if (p === home || distanceToRoads(net, p.x, p.z, 200) > 150) continue;
        const near = nearestRoadPoint(net, p.x, p.z);
        const pos = near ? onGround(near.x, near.z) : onGround(p.x, p.z);
        if (flatDist(pos, depot) < 400) continue;
        add(p.id || p.kind, p.name || PLACE_LABELS[p.kind] || p.id, pos);
      }
    } else {
      for (const name of PLACE_NAMES) {
        // No "summit relay" on a road with no climb on it: the Summit job
        // is off this island's board for exactly that reason.
        if (net && name === 'summit' && !networkSummit(sim, net)) continue;
        const pos = placeOf(sim, name);
        if (net ? distanceToRoads(net, pos.x, pos.z, 200) > 150 : !(heightAt(pos.x, pos.z) > 1 && sameLandmass(depot, pos))) continue;
        if (name !== 'depot' && flatDist(pos, depot) < 400) continue;
        add(name, PLACE_LABELS[name], pos);
      }
    }
    /** Jobs on the board, in the order they are offered. The first two are the
     *  easy ones, because the board is also where a child who skipped the jobs
     *  screen meets the game. */
    this.board = jobsFor(sim).filter((e) => e.available).map((e) => e.job.id);
    this.foundCount = 0;
    // The depot is where you are standing; it does not count as a discovery.
    const home = this.places.find((p) => p.name === 'depot');
    if (home) {
      home.found = true;
      this.foundCount = 1;
    }
    this._next = null;
    /** The one object target() hands back, refilled rather than re-made. */
    this._target = { pos: null, label: '' };
  }

  /** Everything the minimap needs to write names on itself. Handed over rather
   *  than drawn here, because the minimap owns its own canvas. */
  labels() {
    return this.places.filter((p) => p.found).map((p) => ({ x: p.pos.x, z: p.pos.z, text: p.label }));
  }

  /** The job board, for the pause menu or a depot prompt. */
  offers() {
    return this.board.map((id) => {
      const j = findJob(id);
      return { id, name: j.name, difficulty: j.difficulty, blurb: j.blurb };
    });
  }

  /**
   * Where free drive points you next: the nearest place you have not found.
   *
   * "idk what to do" is the failure mode this whole mode exists to avoid, and
   * a board of places with no arrow to any of them is that failure with a
   * list attached. So free drive has an arrow too, to somewhere new.
   */
  target() {
    const veh = this.sim.vehicle;
    if (!veh) return null;
    if (!this._next || this._next.found) {
      this._next = this.pickNext(veh);
      // Say where the arrow now goes, once, in the objective panel.
      if (this.sim.hud && this.sim.hud.setObjective) this.sim.hud.setObjective('Island Roads', this.objective());
    }
    if (!this._next) return null;
    this._target.pos = this._next.pos;
    this._target.label = this._next.label;
    return this._target;
  }

  /**
   * The next place to send the van: the nearest BY ROAD, and one the road
   * ahead leads to before one behind it.
   *
   * It was the nearest in a straight line. The van is parked facing along
   * the road to the town (resolveSpawn), and on Drover's Flat and Cullen
   * Sands the nearest place as the crow flies was back the other way, so the
   * very first thing free drive ever said was TURN AROUND, 0 m — measured on
   * both, on frame one. A place whose road leaves behind the van now counts
   * as TURN_ROUND_M further away, so the arrow points up the road the van is
   * already on unless nothing at all lies that way. Worked out only when the
   * last place is found: a handful of routes, not one a frame.
   */
  pickNext(veh) {
    const net = networkOf(this.sim);
    let best = null;
    let bestCost = Infinity;
    for (const p of this.places) {
      if (p.found) continue;
      let cost = flatDist(veh.pos, p.pos);
      const route = net ? routeOnRoads(net, veh.pos, p.pos) : null;
      if (route) {
        cost = routeLengthM(route);
        const lead = alongRoute(route, Math.min(25, cost * 0.5));
        if (lead) {
          const off = Math.abs(((lead.headingDeg - veh.heading + 540) % 360) - 180);
          if (off > 100) cost += TURN_ROUND_M;
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = p;
      }
    }
    return best;
  }

  /**
   * Per frame. Cheap: six distance checks, and nothing else at all unless you
   * have just arrived somewhere new.
   */
  update() {
    const veh = this.sim.vehicle;
    if (!veh) return;
    for (const p of this.places) {
      if (p.found) continue;
      if (flatDist(veh.pos, p.pos) > 120) continue;
      p.found = true;
      this.foundCount++;
      this._next = null;
      const bounty = 20 + this.foundCount * 5;
      payCredits(this.sim, bounty, `Found ${p.label}`);
      if (this.sim.minimap && this.sim.minimap.setLabels) this.sim.minimap.setLabels(this.labels());
      if (this.sim.audio && this.sim.audio.available && this.sim.audio.alerts && this.sim.audio.alerts.checkpoint) {
        this.sim.audio.alerts.checkpoint();
      }
      if (this.foundCount === this.places.length) {
        this.sim.hud.notify('Every road on the island, driven. Nicely done.', 'good', 6);
      }
    }
  }

  /** The line the HUD shows when there is no job on. */
  objective() {
    const left = this.places.length - this.foundCount;
    const t = this._next && !this._next.found ? this._next : null;
    // Asked every frame by the HUD; worked out only when it changes.
    if (this._objFor === t && this._objLeft === left && this._obj) return this._obj;
    this._objFor = t;
    this._objLeft = left;
    this._obj = left > 0 && t
      ? `No job on. Follow the arrow to ${t.label} — ${left} place${left === 1 ? '' : 's'} on this island you have not been yet.`
      : 'No job on. You have been everywhere on this island — take a job from the depot, or just drive.';
    return this._obj;
  }
}

/* ------------------------------------------------------------------ *
 * THE ARROW AND THE MARKER.
 * ------------------------------------------------------------------ */

/**
 * Keeps the turn arrow on a road route to wherever the job wants you now.
 *
 * The arrow's route used to be set once, when the job started, from
 * `def.route(sim)` — two or three places joined by straight lines. So the
 * arrow said STRAIGHT ON across the fields, never changed when the step did,
 * and never noticed the van had gone a different way. This asks the road
 * network for a route from where the van IS to where the current step
 * wants it, and asks again when the step changes or when the van has been
 * off that route for a second and a half.
 */
export class CourierGuide {
  constructor(sim) {
    this.sim = sim;
    this.route = null;
    this._gx = NaN;
    this._gz = NaN;
    this._off = 0;
  }

  /**
   * @param {number} dt
   * @param {object} veh     the van
   * @param {{x:number,z:number}|null} goal
   * @param {object} tracker the HUD's RouteTracker
   */
  update(dt, veh, goal, tracker) {
    if (!veh || !tracker) return null;
    if (!goal) {
      if (this.route) {
        this.route = null;
        this._gx = NaN;
        tracker.setRoute([]);
      }
      return null;
    }
    // A number compare, not a string key: this runs every frame.
    let again = Math.abs(goal.x - this._gx) > 1 || Math.abs(goal.z - this._gz) > 1 || this._gx !== this._gx;
    // And afresh from wherever the van is once it is no longer pinned against
    // something: the route it had led into the thing (see aroundObstacles).
    if ((veh.blockedT || 0) > 1) this._pinned = true;
    else if (this._pinned) {
      this._pinned = false;
      again = true;
    }
    if (!again && tracker.offM != null && tracker.offM > PAVED_HALF + 22) {
      this._off += dt;
      if (this._off > 1.5) again = true;
    } else {
      this._off = 0;
    }
    if (again) {
      this._gx = goal.x;
      this._gz = goal.z;
      this._off = 0;
      const net = networkOf(this.sim);
      const route = net ? routeOnRoads(net, veh.pos, goal) : null;
      this.route = route || [{ x: veh.pos.x, z: veh.pos.z }, { x: goal.x, z: goal.z }];
      // Off the road, the way back to it round whatever is in the way: on
      // the grid first (wayBackToRoad), the corners of one box if that finds
      // nothing.
      if (!wayBackToRoad(this.route, veh.pos, goal, net)) aroundObstacles(this.route, veh.pos);
      tracker.setRoute(this.route);
    }
    // Where the stop is and how big the zone around it is, for ARRIVING
    // (RouteTracker.nearTheDrop): the job's own target and its smallest
    // zone, not the end of the route, which past the drop-off is behind.
    tracker.goalX = goal.x;
    tracker.goalZ = goal.z;
    tracker.arriveR = ARRIVE_R;
    return this.route;
  }
}

/*
 * OFF THE ROAD, THE ARROW GOES ROUND THINGS.
 *
 * A route from a van on the grass starts with a straight line from the van
 * to the nearest bit of road (routeOnRoads), and a straight line goes
 * through whatever is in the way. The reviewer's arrow-following kid
 * overshot a junction on Drover's Flat, crossed the grass into a building
 * and sat against it for 140 s under "STRAIGHT ON 1.6 km"; measured again
 * here from the grass behind six Drover's Flat buildings, the arrow pointed
 * through the wall every time (LEFT, RIGHT or STRAIGHT ON, into it).
 *
 * So that first leg is checked against the collision boxes (grown by LEG_CLEAR, the van's half
 * width and some room to wander), and where it crosses one the route goes round the
 * box's nearer side: by one corner of it grown by ROUND_M, or two if one
 * will not do. The legs that makes are checked again, a few times over, for
 * a building behind a building. Only when the route is worked out — when
 * the step changes, or the van has been off it for a second and a half — and
 * only against the boxes near that leg.
 */
const LEG_CLEAR = 2;
const ROUND_M = 5;

/** Where along a→b (0..1) it enters the box grown by g, or -1. */
function legEnters(ax, az, bx, bz, o, g) {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  const x0 = o.x0 - g;
  const x1 = o.x1 + g;
  const z0 = o.z0 - g;
  const z1 = o.z1 + g;
  if (Math.abs(dx) < 1e-9) {
    if (ax < x0 || ax > x1) return -1;
  } else {
    let u0 = (x0 - ax) / dx;
    let u1 = (x1 - ax) / dx;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return -1;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < z0 || az > z1) return -1;
  } else {
    let u0 = (z0 - az) / dz;
    let u1 = (z1 - az) / dz;
    if (u0 > u1) [u0, u1] = [u1, u0];
    t0 = Math.max(t0, u0);
    t1 = Math.min(t1, u1);
    if (t0 > t1) return -1;
  }
  return t0;
}

/** How far (x, z) is from box o, 0 inside it. */
function boxDist(x, z, o) {
  return Math.hypot(Math.max(o.x0 - x, 0, x - o.x1), Math.max(o.z0 - z, 0, z - o.z1));
}

/**
 * The room a leg from (x, z) is given past box o: LEG_CLEAR, or less when
 * the van is already nearer than that (backed off a wall it was pinned
 * against, say) — so the way round it still counts as clear, and the way
 * through it still does not. Measured: planned from 0.75 m off a Drover's
 * Flat wall with the full 2 m, the van was "inside" the box and the arrow
 * went through it.
 */
function roomFrom(x, z, o) {
  return Math.min(LEG_CLEAR, Math.max(0, boxDist(x, z, o) - 0.05));
}

/** The first box a van driving a→b would hit, or null. Not one it starts in. */
function firstInTheWay(ax, az, bx, bz) {
  const list = Terrain.OBSTACLES || [];
  const lx0 = Math.min(ax, bx) - 8;
  const lx1 = Math.max(ax, bx) + 8;
  const lz0 = Math.min(az, bz) - 8;
  const lz1 = Math.max(az, bz) + 8;
  let best = null;
  let bestT = Infinity;
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o.x1 < lx0 || o.x0 > lx1 || o.z1 < lz0 || o.z0 > lz1) continue;
    // At a van's bonnet height where it stands: not a bridge overhead.
    const h = heightAt((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2);
    if (o.y0 > h + 1.5 || o.y1 < h + 0.6) continue;
    // Starting inside it, there is no going round it from here.
    if (boxDist(ax, az, o) <= 0) continue;
    const t = legEnters(ax, az, bx, bz, o, roomFrom(ax, az, o));
    if (t >= 0 && t < bestT) {
      bestT = t;
      best = o;
    }
  }
  return best;
}

/** Corners, a→(corners)→b, that go round box o; the shortest, or null. */
function roundBox(ax, az, bx, bz, o) {
  // `round`: the HUD's tracker aims AT these rather than cutting past them
  // (see RouteTracker.next), or the arrow points across the building's corner.
  const cs = [
    { x: o.x0 - ROUND_M, z: o.z0 - ROUND_M, round: true, grass: true },
    { x: o.x1 + ROUND_M, z: o.z0 - ROUND_M, round: true, grass: true },
    { x: o.x1 + ROUND_M, z: o.z1 + ROUND_M, round: true, grass: true },
    { x: o.x0 - ROUND_M, z: o.z1 + ROUND_M, round: true, grass: true },
  ];
  const clear = (px, pz, qx, qz) => legEnters(px, pz, qx, qz, o, roomFrom(px, pz, o)) < 0;
  const len = (px, pz, qx, qz) => Math.hypot(qx - px, qz - pz);
  let best = null;
  let bestL = Infinity;
  for (let i = 0; i < 4; i++) {
    const c = cs[i];
    if (clear(ax, az, c.x, c.z) && clear(c.x, c.z, bx, bz)) {
      const L = len(ax, az, c.x, c.z) + len(c.x, c.z, bx, bz);
      if (L < bestL) {
        bestL = L;
        best = [c];
      }
    }
  }
  if (best) return best;
  // Round two corners: the far side of the box from where the van is.
  for (let i = 0; i < 4; i++) {
    for (const j of [(i + 1) % 4, (i + 3) % 4]) {
      const c = cs[i];
      const d = cs[j];
      if (clear(ax, az, c.x, c.z) && clear(d.x, d.z, bx, bz)) {
        const L = len(ax, az, c.x, c.z) + len(c.x, c.z, d.x, d.z) + len(d.x, d.z, bx, bz);
        if (L < bestL) {
          bestL = L;
          best = [c, d];
        }
      }
    }
  }
  return best;
}

/** Points to put between a and b so that a van driving them misses things. */
function detour(ax, az, bx, bz, depth) {
  if (depth > 3) return [];
  const o = firstInTheWay(ax, az, bx, bz);
  if (!o) return [];
  const via = roundBox(ax, az, bx, bz, o);
  if (!via) return [];
  const out = [];
  let px = ax;
  let pz = az;
  for (const c of via) {
    out.push(...detour(px, pz, c.x, c.z, depth + 1), c);
    px = c.x;
    pz = c.z;
  }
  out.push(...detour(px, pz, bx, bz, depth + 1));
  return out;
}

/**
 * The route's first leg, when it starts on the grass (from the van, not
 * from the road), round what is in the way. In place. The legs along the
 * roads are left alone: the tarmac is cleared of scenery
 * (clearRoadsOfScenery), and a detour there would take the arrow off a road
 * that was fine. Every goal is on the road (the markers, and free drive's
 * places, are put on it), so the last leg is never on the grass.
 */
export function aroundObstacles(route, from) {
  if (!route || route.length < 2 || !from) return route;
  if (route[0].x !== from.x || route[0].z !== from.z) return route;
  // The leg across the grass (the HUD's arrow leans on it rather than
  // saying TURN AROUND): not a van on the tarmac a few metres off the middle.
  if (Math.hypot(route[1].x - from.x, route[1].z - from.z) > PAVED_HALF) route[0].grass = true;
  const via = detour(route[0].x, route[0].z, route[1].x, route[1].z, 0);
  if (via.length) route.splice(1, 0, ...via);
  return route;
}

/*
 * OFF THE ROAD IN A TOWN: THE WAY BACK, ON A GRID.
 *
 * roundBox goes round ONE box, by a corner five metres out from it, and
 * checks that corner against that box alone. That was enough for the
 * scattered houses the town used to be. The town is now laid along its
 * streets (scenery.js layTown): houses shoulder to shoulder down both sides,
 * 1.5 to 6 m apart, each turned square to the street and each registering
 * the axis-aligned box round it, so on a street that is not north-south the
 * boxes of neighbours all but touch. Behind a row of them on Drover's Flat
 * the corner picked round one house was INSIDE the next one (measured
 * behind the house at 1414,853: the arrow led to 1403,864, in the house at
 * 1397-1411 x 861-874), the van was pinned, and the re-plan from there said
 * TURN AROUND with the arrow straight up; the kid who drives by the arrow
 * drove off across the island. Five of six such starts never got back to
 * the road in a minute, and 7 of 36 stops round First Run's yard never
 * delivered.
 *
 * So when the straight line to the road is blocked, the way back is
 * searched on a 1.5 m grid round the van and the road it is making for:
 * every box at bonnet height, grown by the van's half-width and some, is
 * solid (a gap under 3.2 m between two houses is shut: a child cannot
 * thread one); nearer than 3.2 m to one it costs three times as much, so
 * the way keeps off walls where it can. The search ends on whichever bit of
 * road is cheapest counting the drive ALONG the road to the goal afterwards,
 * so it does not come out on a street that then has to be driven back the
 * other way. The path is pulled straight between the corners it really has
 * to turn at, and each of those is a `round` corner (the HUD aims at it
 * rather than cutting it). Only when the route is worked out, as before.
 */
const GRID_M = 1.5;
const GRID_PAD = 60;
const GRID_MAX = 300;
/** Nearer a box than this and the cell is solid: the van's half-width and some. */
const HARD_M = 1.6;
/** Nearer than this and it costs SOFT_COST times as much. */
const SOFT_M = 3.2;
const SOFT_COST = 3;

/** A binary heap of (key, value) pairs in two growable typed arrays. */
class GridHeap {
  constructor(cap = 4096) {
    this.k = new Float64Array(cap);
    this.v = new Int32Array(cap);
    this.size = 0;
    this.top = 0;
  }
  push(key, val) {
    if (this.size === this.k.length) {
      const k = new Float64Array(this.size * 2);
      const v = new Int32Array(this.size * 2);
      k.set(this.k);
      v.set(this.v);
      this.k = k;
      this.v = v;
    }
    const K = this.k;
    const V = this.v;
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (K[p] <= key) break;
      K[i] = K[p];
      V[i] = V[p];
      i = p;
    }
    K[i] = key;
    V[i] = val;
  }
  /** Pops the smallest value; its key is left in `this.top`. */
  pop() {
    const K = this.k;
    const V = this.v;
    const out = V[0];
    this.top = K[0];
    const n = --this.size;
    if (n > 0) {
      const key = K[n];
      const val = V[n];
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && K[r] < K[l] ? r : l;
        if (K[m] >= key) break;
        K[i] = K[m];
        V[i] = V[m];
        i = m;
      }
      K[i] = key;
      V[i] = val;
    }
    return out;
  }
}

/** Road distance to the goal from every node of the network, remembered per goal. */
let _toGoal = null;
function roadToGoal(net, goal) {
  const c = _toGoal;
  if (c && c.net === net && c.x === goal.x && c.z === goal.z) return c.nodes;
  const nodes = roadDistancesFrom(net, goal);
  _toGoal = { net, x: goal.x, z: goal.z, nodes };
  return nodes;
}

/**
 * The way from `from` (off the road) back onto it, round everything in the
 * way, for a van making for `goal`: { via, end } — the corners to drive
 * through, and the point on the tarmac it comes out on — or null if the
 * grid finds none. `entry` is the road point nearest the van, which the
 * grid is laid round.
 */
function gridWayToRoad(net, from, goal, entry) {
  const g = roadGraph(net);
  const toGoal = g && roadToGoal(net, goal);
  if (!g || !toGoal || toGoal.length !== g.nodes.length) return null;
  const span = Math.min(GRID_MAX, Math.max(Math.abs(entry.x - from.x), Math.abs(entry.z - from.z)) + 2 * GRID_PAD);
  const n = Math.ceil(span / GRID_M);
  const half = (n * GRID_M) / 2;
  const clampTo = (v, a, b) => (v < a ? a : v > b ? b : v);
  const cx = clampTo((from.x + entry.x) / 2, from.x - half + 20, from.x + half - 20);
  const cz = clampTo((from.z + entry.z) / 2, from.z - half + 20, from.z + half - 20);
  const x0 = cx - half;
  const z0 = cz - half;
  const X1 = x0 + n * GRID_M;
  const Z1 = z0 + n * GRID_M;
  const N = n * n;

  // 0 open, 1 near a wall, 2 solid.
  const block = new Uint8Array(N);
  const list = Terrain.OBSTACLES || [];
  for (let q = 0; q < list.length; q++) {
    const o = list[q];
    if (o.x1 < x0 - SOFT_M || o.x0 > X1 + SOFT_M || o.z1 < z0 - SOFT_M || o.z0 > Z1 + SOFT_M) continue;
    // At a van's bonnet height where it stands, as firstInTheWay asks.
    const h = heightAt((o.x0 + o.x1) / 2, (o.z0 + o.z1) / 2);
    if (o.y0 > h + 1.5 || o.y1 < h + 0.6) continue;
    for (let pass = 0; pass < 2; pass++) {
      const grow = pass ? HARD_M : SOFT_M;
      const val = pass ? 2 : 1;
      const i0 = Math.max(0, Math.ceil((o.x0 - grow - x0) / GRID_M - 0.5));
      const i1 = Math.min(n - 1, Math.floor((o.x1 + grow - x0) / GRID_M - 0.5));
      const j0 = Math.max(0, Math.ceil((o.z0 - grow - z0) / GRID_M - 0.5));
      const j1 = Math.min(n - 1, Math.floor((o.z1 + grow - z0) / GRID_M - 0.5));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const k = j * n + i;
          if (block[k] < val) block[k] = val;
        }
      }
    }
  }

  // Where the road is, and how far along it the goal is from there.
  const goalCost = new Float64Array(N).fill(Infinity);
  let roadCells = 0;
  const R = PAVED_HALF - 1.5;
  const rc = Math.ceil(R / GRID_M);
  for (let e = 0; e < g.edges.length; e++) {
    const E = g.edges[e];
    const A = g.nodes[E.a];
    const B = g.nodes[E.b];
    if (Math.max(A.x, B.x) < x0 - R || Math.min(A.x, B.x) > X1 + R || Math.max(A.z, B.z) < z0 - R || Math.min(A.z, B.z) > Z1 + R) continue;
    const dA = toGoal[E.a].d;
    const dB = toGoal[E.b].d;
    if (!(dA < Infinity) && !(dB < Infinity)) continue;
    const steps = Math.max(1, Math.ceil(E.len / GRID_M));
    for (let st = 0; st <= steps; st++) {
      const t = st / steps;
      const px = A.x + (B.x - A.x) * t;
      const pz = A.z + (B.z - A.z) * t;
      const dv = Math.min(dA + t * E.len, dB + (1 - t) * E.len);
      const ci = Math.floor((px - x0) / GRID_M);
      const cj = Math.floor((pz - z0) / GRID_M);
      for (let j = cj - rc; j <= cj + rc; j++) {
        if (j < 0 || j >= n) continue;
        for (let i = ci - rc; i <= ci + rc; i++) {
          if (i < 0 || i >= n) continue;
          const qx = x0 + (i + 0.5) * GRID_M - px;
          const qz = z0 + (j + 0.5) * GRID_M - pz;
          if (qx * qx + qz * qz > R * R) continue;
          const k = j * n + i;
          if (block[k] >= 2) continue;
          if (goalCost[k] === Infinity) roadCells++;
          if (dv < goalCost[k]) goalCost[k] = dv;
        }
      }
    }
  }
  if (!roadCells) return null;

  const si = Math.floor((from.x - x0) / GRID_M);
  const sj = Math.floor((from.z - z0) / GRID_M);
  if (si < 0 || sj < 0 || si >= n || sj >= n) return null;
  const start = sj * n + si;
  const dist = new Float64Array(N).fill(Infinity);
  const prev = new Int32Array(N).fill(-1);
  const heap = new GridHeap();
  dist[start] = 0;
  heap.push(0, start);
  const DI = [1, -1, 0, 0, 1, 1, -1, -1];
  const DJ = [0, 0, 1, -1, 1, -1, 1, -1];
  let end = -1;
  while (heap.size) {
    const v = heap.pop();
    const d = heap.top;
    // A finish: the road reached, with the rest of the way along it added.
    if (v < 0) {
      end = -v - 1;
      break;
    }
    if (d > dist[v]) continue;
    if (goalCost[v] < Infinity) heap.push(d + goalCost[v], -v - 1);
    const i = v % n;
    const j = (v - i) / n;
    const here = block[v];
    for (let m = 0; m < 8; m++) {
      const ii = i + DI[m];
      const jj = j + DJ[m];
      if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
      const w = jj * n + ii;
      const b = block[w];
      // Never INTO a wall; out of one (a van pinned against it) at a price.
      if (b >= 2 && here < 2) continue;
      // No squeezing diagonally between two walls' corners.
      if (m >= 4 && here < 2 && (block[j * n + ii] >= 2 || block[jj * n + i] >= 2)) continue;
      const step = (m >= 4 ? Math.SQRT2 : 1) * GRID_M * (b >= 2 ? 8 : b ? SOFT_COST : 1);
      const nd = d + step;
      if (nd < dist[w]) {
        dist[w] = nd;
        prev[w] = v;
        heap.push(nd, w);
      }
    }
  }
  if (end < 0) return null;

  // The cells, van to road...
  const path = [];
  for (let c = end; c !== -1; c = prev[c]) path.push(c);
  path.reverse();
  const at = (c) => ({ x: x0 + ((c % n) + 0.5) * GRID_M, z: z0 + (Math.floor(c / n) + 0.5) * GRID_M });
  // ...pulled straight: from each corner, as far along as can be seen
  // without crossing anything worse than the path itself crossed there.
  const worst = (a, b) => {
    let w = 0;
    for (let q = a; q <= b; q++) if (block[path[q]] > w) w = block[path[q]];
    return w;
  };
  const seen = (p, qc, allow) => {
    const L = Math.hypot(qc.x - p.x, qc.z - p.z);
    const steps = Math.max(1, Math.ceil(L / (GRID_M * 0.5)));
    for (let s2 = 1; s2 < steps; s2++) {
      const x = p.x + ((qc.x - p.x) * s2) / steps;
      const z = p.z + ((qc.z - p.z) * s2) / steps;
      const ci = Math.floor((x - x0) / GRID_M);
      const cj = Math.floor((z - z0) / GRID_M);
      if (ci < 0 || cj < 0 || ci >= n || cj >= n) return false;
      if (block[cj * n + ci] > allow) return false;
    }
    return true;
  };
  const via = [];
  let a = 0;
  let pa = { x: from.x, z: from.z };
  while (a < path.length - 1) {
    let b = a + 1;
    while (b + 1 < path.length && seen(pa, at(path[b + 1]), worst(a, b + 1))) b++;
    const pt = at(path[b]);
    if (b < path.length - 1) via.push({ x: pt.x, z: pt.z, round: true, grass: true });
    pa = pt;
    a = b;
  }
  return { via, end: at(path[path.length - 1]) };
}

/**
 * The route's first leg, when it starts off the road and something stands
 * between the van and the road, replaced by the way round it on the grid
 * (gridWayToRoad) and the road from where that comes out. In place; true
 * when the route needs nothing more (the way is clear, or it was re-planned),
 * false to fall back to aroundObstacles.
 */
function wayBackToRoad(route, from, goal, net) {
  if (!net || !route || route.length < 2 || !from || !goal) return false;
  if (route[0].x !== from.x || route[0].z !== from.z) return false;
  if (Math.hypot(route[1].x - from.x, route[1].z - from.z) > PAVED_HALF) route[0].grass = true;
  if (!firstInTheWay(route[0].x, route[0].z, route[1].x, route[1].z)) return true;
  const way = gridWayToRoad(net, from, goal, route[1]);
  if (!way) return false;
  const rest = routeOnRoads(net, way.end, goal) || [way.end, { x: goal.x, z: goal.z }];
  const out = [{ x: from.x, z: from.z, grass: true }, ...way.via, ...rest];
  route.length = 0;
  for (const p of out) {
    const last = route[route.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.z - last.z) > 0.5) route.push(p);
  }
  if (route.length < 2) route.push({ x: goal.x, z: goal.z });
  return true;
}

/**
 * The place you are driving to, drawn where it is: a ring on the road, a
 * short column of light and a bobbing arrow over it. Yellow to pick up,
 * green to drop off, blue for a split you drive through.
 *
 * The aeroplane's beacon is 1,400 m tall, stands at sea level whatever the
 * ground height, and is not updated while driving at all — so the car had
 * either nothing, or the aeroplane's guidance rails frozen wherever the last
 * flight left them. This one is the size of a delivery bay and is put on the
 * ground at the target every frame it moves.
 */
export class DropMarker {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'courier-drop';
    this.group.visible = false;
    this.t = 0;
    this.kind = '';
    this.at = { x: NaN, z: NaN };

    this.colour = new THREE.Color(0x5be38a);
    const ringGeo = new THREE.RingGeometry(5.2, 6.4, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.ringMat = new THREE.MeshBasicMaterial({ color: this.colour, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 });
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.position.y = 0.2;
    this.group.add(this.ring);

    const beamGeo = new THREE.CylinderGeometry(1.1, 1.6, 16, 14, 1, true);
    beamGeo.translate(0, 8, 0);
    this.beamMat = new THREE.MeshBasicMaterial({ color: this.colour, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.group.add(new THREE.Mesh(beamGeo, this.beamMat));

    const arrowGeo = new THREE.ConeGeometry(1.6, 3, 4);
    arrowGeo.rotateX(Math.PI);
    this.arrowMat = new THREE.MeshStandardMaterial({ color: this.colour, emissive: this.colour, emissiveIntensity: 0.6, roughness: 0.5 });
    this.arrow = new THREE.Mesh(arrowGeo, this.arrowMat);
    this.arrow.position.y = 10;
    this.group.add(this.arrow);

    // The crate the shuttle's text talks about.
    this.crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 1.1, 1.3),
      new THREE.MeshStandardMaterial({ color: 0xe0a82e, roughness: 0.8 })
    );
    this.crate.position.y = 0.55;
    this.crate.castShadow = true;
    this.crate.visible = false;
    this.group.add(this.crate);

    scene.add(this.group);
  }

  /** @param {{x:number,z:number}|null} pos   @param {string} kind 'pickup'|'drop'|'pass'|'crate' */
  set(pos, kind = 'drop') {
    if (!pos) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    if (pos.x !== this.at.x || pos.z !== this.at.z) {
      this.at.x = pos.x;
      this.at.z = pos.z;
      this.group.position.set(pos.x, Math.max(0, groundHeight(pos.x, pos.z)), pos.z);
    }
    if (kind !== this.kind) {
      this.kind = kind;
      const hex = kind === 'pass' ? 0x62c8ff : kind === 'drop' ? 0x5be38a : 0xffc53d;
      this.colour.setHex(hex);
      this.ringMat.color.setHex(hex);
      this.beamMat.color.setHex(hex);
      this.arrowMat.color.setHex(hex);
      this.arrowMat.emissive.setHex(hex);
      this.crate.visible = kind === 'crate';
    }
  }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    this.arrow.position.y = 10 + Math.sin(this.t * 2.2) * 0.8;
    this.arrow.rotation.y += dt * 1.4;
    this.ringMat.opacity = 0.62 + Math.sin(this.t * 3) * 0.18;
  }

  hide() {
    this.group.visible = false;
  }
}

/** What kind of marker a step wants: split points are driven through. */
export function markerKind(step) {
  if (!step) return 'drop';
  if (step.marker) return step.marker;
  return PASS_WORDS.test(step.targetLabel || '') ? 'pass' : 'drop';
}
// Hoisted: a regex literal inside markerKind is a new RegExp every frame.
const PASS_WORDS = /headland|split/i;

/* ------------------------------------------------------------------ *
 * THE VAN'S SHARE OF startDrive, updateDrive AND stopDrive.
 * ------------------------------------------------------------------ */

/*
 * main.js's car branches, kept here and reached as IslandRoads.van.
 *
 * The first pass wrote all of this into main.js and widened three import
 * lines there to reach it (roads.js, surface.js and this file's), and put
 * some of it in startDrive, updateDrive and stopDrive where it ran for the
 * boat as well. The reviewer blocked those as edits outside the car
 * branches: the import lines are shared with every other team (the boat's
 * owns half of surface.js), and a line the boat runs is the boat's too.
 * IslandRoads is what main.js has always imported from here, so the car
 * branches call through it and main.js's imports are as they were. Each
 * function says which branch calls it.
 */
const VAN_M = { lift: 0, model: null };
const _vanBox = new THREE.Box3();

/**
 * The island made ready for a van, once per world: trees and the odd house
 * that the scatter planted on the tarmac taken off it, the crop patches
 * drawn over it taken off, and the road ribbon moved onto the terrain
 * triangles actually built at this quality setting. Both no-ops the second
 * time round. Then the wheels ride the ground that is drawn, not the one
 * behind it: the tarmac where the tarmac is, the grass everywhere else.
 *
 * Again whenever the world is rebuilt under a van that is still driving —
 * Graphics quality from the pause menu does exactly that, and then the new
 * trees are back on the road, the ribbon is laid for the old mesh and the
 * wheels are riding a terrain that is no longer drawn (see world()).
 */
function readyVanWorld(sim) {
  sim._vanWorld = sim.terrain;
  const list = sim.roads && sim.roads.list;
  if (list && list.length) {
    clearRoadsOfScenery(THREE, sim.scenery && sim.scenery.group, list);
    clearRoadsOfFields(sim.features && sim.features.group, list);
    if (sim.roadMesh && sim.roadMesh.userData.conform) sim.roadMesh.userData.conform(sim.terrain);
  }
  // (With the ribbon, so the wheels ride the tarmac as it is drawn: ribbonSampler.)
  setGroundMesh(drawnGroundSampler(sim.terrain, list, sim.roadMesh));
  // And what is drawn where, for the word under the speed (drawnLooks).
  sim._vanFields = fieldPatchSampler(sim.features && sim.features.group);
  sim._vanPaint = terrainBlendSampler(sim.terrain);
}

/**
 * What the ground under the van LOOKS like, for the word on its panel, when
 * the physics calls it grass (the grip stays grass's): 'field' on a crop
 * patch that is not green, 'sand' or 'dirt' where the terrain shader paints
 * more sand or more rock than grass, and null (grass) where it is green.
 *
 * The reviewer: "the surface word says 'grass' on the pale sand-coloured
 * town ground". The first try at this called ground under 16 m sand (the
 * shader's sand weight, 1 - smoothstep(2, 30, h), passes a half there), and
 * missed the place the reviewer was looking at: First Run's town yard on
 * Drover's Flat is 62.6 m up, and the panel still said "grass" over pale
 * beige ground 51 m past it, (202, 189, 164) on screen against (112, 155,
 * 65) for the grass by the depot. Measured there: the terrain is painted
 * grass (all 558 off-road spots 50-150 m from the yard); what is drawn over
 * it is a crop patch, stubble, (0.84, 0.79, 0.46), 35 cm up (features.js).
 *
 * So the word reads what is drawn: the patch first (fieldPatchSampler,
 * roads.js), redder than it is green is a field; then the terrain shader's
 * own weights (terrainBlendSampler), whichever it paints most of — sand, or
 * rock, which in daylight looks like bare earth, so dirt.
 */
const _paint = new Float64Array(3);
function drawnLooks(sim, x, z) {
  const crop = sim._vanFields ? sim._vanFields(x, z) : null;
  if (crop) return crop[0] > crop[1] ? 'field' : null;
  const f = sim._vanPaint;
  if (!f || !f(x, z, _paint)) return null;
  const sand = _paint[0];
  const grass = _paint[1];
  const rock = _paint[2];
  if (grass >= sand && grass >= rock) return null;
  return sand >= rock ? 'sand' : 'dirt';
}

/** The state object the van's panel is filled from, one per sim, refilled. */
function vanHudState(sim) {
  return sim._vanHud || (sim._vanHud = {
    readouts: null, surface: null, isBoat: false, handbrake: false, clock: null, turn: null, blocked: false, looks: null,
    job: { title: '', text: '', toGoM: null, name: '' },
    cargo: null,
    load: { pips: 0, max: 5, label: 'LOAD' },
    forStep: undefined,
  });
}

/**
 * Where the job wants the van now — the current step's target, or in free
 * drive the nearest place not yet found — with a road route to it for the
 * arrow (CourierGuide) and the marker standing on it.
 */
function vanGoal(sim) {
  const running = sim.runner && sim.runner.status === 'running';
  return running ? sim.runner.activeTarget() : sim.islandRoads ? sim.islandRoads.target() : null;
}

IslandRoads.van = {
  /**
   * startDrive, car branch, after the vehicle is built and reset: the
   * island made ready, the van put down on the ground as drawn, the
   * aeroplane's guidance taken down and the van's marker and arrow put up,
   * and the job's own sky.
   */
  start(sim, { kind, def, start, headingDeg }) {
    readyVanWorld(sim);
    sim.vehicle.reset({ pos: start, headingDeg });
    // The aeroplane's guidance is not updated while driving, so whatever it
    // last showed stays drawn: the menu flight's rails were hanging over the
    // depot on every drive.
    if (sim.navGuide) sim.navGuide.group.visible = false;
    if (sim.beacon) sim.beacon.setTarget(null);
    sim.courierMarker = sim.courierMarker || new DropMarker(sim.scene);
    sim.courierMarker.hide();
    sim.courierGuide = new CourierGuide(sim);
    /*
     * The job's own weather, which startMode has always loaded for a flight
     * and startDrive never did: Night Call-out's card says two in the
     * morning and raining, and it was driven at whatever time the menu sky
     * happened to be, dry. Borrowed like the map; anything the last van job
     * borrowed goes back first ("Drive again" goes van to van), and it is
     * given back in stop() or by the menu (the courier-sky plug-in).
     */
    giveBackJobSky(sim);
    borrowJobSky(sim, def);
    /*
     * And the job board measured here, on the van's own island, while it is
     * the one loaded: the menu is back on the aeroplane's island by the time
     * the board is next opened, and it shows what was measured now (see
     * jobsFor). 2.4 ms on Drover's Flat, once per drive.
     */
    if (kind === 'car') {
      try {
        jobsFor(sim);
      } catch (err) {
        /* a board that cannot be graded is graded next time */
      }
    }
    // Facing the right way on the very first frame, model and all.
    sim.vehicle.applyAttitude(0, (headingDeg * Math.PI) / 180, 0, 0);
    if (sim.vehicleModel) {
      sim.vehicleModel.position.copy(sim.vehicle.pos);
      sim.vehicleModel.quaternion.copy(sim.vehicle.quat);
    }
  },

  /**
   * startDrive, car branch, last thing before the plug-ins: the camera
   * behind the van, the arrow on its road route and the panel and the map
   * drawn, before the first frame. Until the first update they showed what
   * was there before: the reviewer read HEADING 090 over a van facing 182,
   * the aeroplane's arrow on the minimap, and the menu's view over the sea.
   */
  firstFrame(sim) {
    const v = sim.vehicle;
    if (!v) return;
    if (sim.driveCam) sim.driveCam.snap(sim.camera, v);
    const goal = vanGoal(sim);
    if (sim.courierGuide && sim.driveHud) sim.courierGuide.update(0, v, goal ? goal.pos : null, sim.driveHud.tracker);
    if (sim.driveHud) this.panel(sim, 0, v, v.readouts());
    if (sim.minimap) sim.minimap.update(0, sim);
  },

  /** updateDrive, car branch, before the van moves: a world rebuilt under it. */
  world(sim) {
    if (sim._vanWorld !== sim.terrain) readyVanWorld(sim);
  },

  /** updateDrive, car branch, after the van has moved: the arrow and the marker. */
  frame(sim, dt, v) {
    const goal = vanGoal(sim);
    if (sim.courierGuide && sim.driveHud) sim.courierGuide.update(dt, v, goal ? goal.pos : null, sim.driveHud.tracker);
    if (sim.courierMarker) {
      const running = sim.runner && sim.runner.status === 'running';
      sim.courierMarker.set(goal ? goal.pos : null, running ? markerKind(sim.runner.step) : 'drop');
      sim.courierMarker.update(dt);
    }
  },

  /**
   * updateDrive, the car's HUD branch: the model set down on its tyres,
   * then the van's panel.
   *
   * THE MODEL. The physics carries the body `rideHeight` (6 cm) over the
   * ground, and the model was put exactly there whatever it was driving on.
   * Six centimetres is how far the made surfaces are DRAWN above the ground
   * — the road ribbon's lift, and the apron's ELEV + 0.05 — so on tarmac
   * the tyres touched it; on grass, which is drawn on the ground, they hung
   * 6 cm clear of it. And it assumed the model's tyres reach down to its
   * origin, which is true of the pack's van (its axles are at the tyre
   * radius: a fresh one measures y 0 to 0.68 across the wheels) and of the
   * fallback createCar(), and is only a convention the Blender replacement
   * may or may not keep. So: the model's own lowest point, measured once
   * whenever the model changes (the airport vehicles swap theirs in after
   * startDrive), set down on the ground, plus the lift of whatever surface
   * it is on (SurfaceVehicle.drawnLift, eased as it crosses the kerb).
   * updateDrive has copied the van's position onto the model by the time
   * this runs; this adds to it (not on the first frame, which is not one).
   */
  panel(sim, dt, v, r) {
    const m = sim.vehicleModel;
    if (m && !v.isBoat) {
      if (VAN_M.model !== m) {
        VAN_M.model = m;
        const px = m.position.x, py = m.position.y, pz = m.position.z;
        const q = m.quaternion;
        const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
        m.position.set(0, 0, 0);
        q.identity();
        m.updateMatrixWorld(true);
        const low = _vanBox.setFromObject(m).min.y;
        m.position.set(px, py, pz);
        q.set(qx, qy, qz, qw);
        VAN_M.lift = Number.isFinite(low) ? -low - (v.spec.rideHeight || 0) : 0;
      }
      if (dt > 0) m.position.y += VAN_M.lift + (v.drawnLift || 0);
    }
    const hud = sim.driveHud;
    if (!hud) return;
    /*
     * THE PANEL. One state object for the van, refilled every frame rather
     * than four new ones (the state, the job, the load and the turn) sixty
     * times a second.
     *
     * The clock is the one the job is judged by. It read the card's
     * `parTime` — 210 s for the Shuttle on every island — while the pay was
     * worked out against the par the job sets from THIS island's roads
     * (ctx.data.par): on Drover's Flat the clock ran out with the Shuttle
     * still paying full rate. And "To go" is the distance left to the
     * drop-off along the arrow's route, which the HUD had a row for and was
     * never given.
     */
    const runner = sim.runner;
    const step = runner && runner.status === 'running' ? runner.step : null;
    const def = runner && runner.def;
    const data = (runner && runner.data) || {};
    const st = vanHudState(sim);
    const tracker = hud.tracker;
    // With the speed and today's grip, for SLOW DOWN (RouteTracker.slowFor),
    // and whether the end of the route is a stop: a split you drive through
    // (the blue marker) and free drive's places are not.
    if (tracker) tracker.stopAtEnd = step != null && markerKind(step) !== 'pass';
    const turn = tracker ? tracker.next(v.pos, v.heading, 30, 1600, v.speed, v.wet) : null;
    st.readouts = r;
    st.surface = v.surface;
    st.looks = v.surface && v.surface.kind === 'grass' ? drawnLooks(sim, v.pos.x, v.pos.z) : null;
    st.handbrake = !!(sim.driveInput && sim.driveInput.handbrake);
    // Pinned against something for a second with the go key down: BLOCKED.
    st.blocked = (v.blockedT || 0) > 1;
    st.turn = turn;
    if (step) {
      st.job.title = (def && def.name) || 'Island Roads';
      st.job.text = step.text || '';
    } else if (sim.islandRoads) {
      st.job.title = 'Island Roads';
      st.job.text = sim.islandRoads.objective();
    } else {
      st.job.title = v.spec.name;
      st.job.text = 'No clock. Drive where you like.';
    }
    st.job.toGoM = step && turn ? turn.remainingM : null;
    if (st.forStep !== step) {
      st.forStep = step;
      st.job.name = step && step.targetLabel ? 'to ' + step.targetLabel : '';
    }
    const par = data.par || (def && def.parTime) || 0;
    st.clock = par && step ? Math.max(0, par - runner.elapsed) : null;
    // Only while a job is on: the runner keeps the last job's data after it
    // ends, and free drive after First Run showed BOX OF SPANNERS.
    if (step && data.cargo) {
      st.load.pips = data.cargo.pips;
      st.load.max = data.cargo.max || 5;
      st.load.label = data.cargo.name || 'LOAD';
      st.cargo = st.load;
    } else {
      st.cargo = null;
    }
    hud.update(dt, st);
  },

  /**
   * stopDrive, car branch (only after a van drive), and the boat started
   * straight from the van: the drop-off marker and the arrow belong to the
   * van, the sky a courier job borrowed goes back, and the drawn-ground
   * sampler is let go.
   */
  stop(sim) {
    if (sim.courierMarker) sim.courierMarker.hide();
    sim.courierGuide = null;
    giveBackJobSky(sim);
    setGroundMesh(null);
    // (They hold the world's arrays; the next van start reads them afresh.)
    sim._vanPaint = null;
    sim._vanFields = null;
  },
};

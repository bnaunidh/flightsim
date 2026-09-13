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
  if (roads && typeof roads.place === 'function') {
    const p = roads.place(name);
    if (p) return onGround(p.x, p.z);
  }

  const cfg = (MAP && MAP.scenery) || {};
  const main = (ISLANDS && ISLANDS[0]) || { cx: 0, cz: 0, radius: 2000 };

  switch (name) {
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
  if (headingDeg == null) {
    // Face the first place the job sends you to, so nobody's first action is a
    // three-point turn.
    const first = (job && job.faceTowards) || 'town';
    const t = placeOf(sim, first);
    headingDeg = (Math.atan2(t.x - pos.x, -(t.z - pos.z)) * 180) / Math.PI;
  }
  return { pos, headingDeg: (headingDeg + 360) % 360 };
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
    if (this._y != null) {
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
      const surf = surfaceKind(veh.pos.x, veh.pos.z);
      if (surf !== this._surface) {
        const leftTheHard = this._surface === 'tarmac' && surf !== 'tarmac';
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
 */
function payFor(ctx, base = 88) {
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
   * ten-year-old notices immediately and never lets go of. The bonuses are
   * still worth having: they are what lets a clean run reach 100 at all.
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
        text: 'The spanners are in the back. Hold Shift to pull away, and steer with A and D.',
        hint: 'Shift goes, Ctrl slows down, Space is the brake. Take your time.',
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
        hint: 'Ease off with Ctrl and use Space to stop. You have to be stopped for it to count.',
        targetLabel: 'the town yard',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => arrived(ctx, place(ctx, 'town')),
      },
    ],
    onComplete: (ctx) => {
      handedOver(ctx, 'the town yard', 'The spanners');
      ctx.sim.notify('That is the job. Every one after this has a clock on it.', 'info');
    },
    score: (ctx) => payFor(ctx, 70),
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
    route: (sim) => [placeOf(sim, 'depot'), placeOf(sim, 'town')],
    // Flat link road, all tarmac: the fastest average in the game.
    plan: { legs: ['depot', 'town'], speed: 19, allow: 40 },
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
        target: (ctx) => place(ctx, 'depot'),
        check: (ctx) => arrived(ctx, place(ctx, 'depot'), 46),
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
        hint: 'Stopped, within a few metres. Space is the brake.',
        targetLabel: 'the shop',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => arrived(ctx, place(ctx, 'town')),
      },
    ],
    onComplete: (ctx) => handedOver(ctx, 'the shop', 'The air freight'),
    score: (ctx) => payFor(ctx, 86),
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
      setPar(ctx);
    },
    tick: driveTick,
    steps: [
      {
        id: 'away',
        text: 'Crew and supper aboard. Out of town and onto the coast road.',
        hint: 'Follow the arrow — the coast road runs right round the island.',
        targetLabel: 'first headland',
        target: (ctx) => ctx.data.headlands[0],
        check: (ctx) => passed(ctx, ctx.data.headlands[0], 140),
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
        target: (ctx) => ctx.data.headlands[1],
        check: (ctx) => passed(ctx, ctx.data.headlands[1], 140),
        onDone: (ctx) => {
          ctx.data.splits.push(ctx.elapsed);
          ctx.sim.notify(`Second headland · ${Math.round(ctx.elapsed)}s`, 'good');
        },
      },
      {
        id: 'far',
        text: 'Two down. Round the far side and on towards the light.',
        hint: 'The lighthouse is the white tower on the point. The arrow knows.',
        targetLabel: 'third headland',
        target: (ctx) => ctx.data.headlands[2],
        check: (ctx) => passed(ctx, ctx.data.headlands[2], 140),
        onDone: (ctx) => {
          ctx.data.splits.push(ctx.elapsed);
          ctx.sim.notify(`Third headland · ${Math.round(ctx.elapsed)}s`, 'good');
        },
      },
      {
        id: 'light',
        text: 'Last leg — up to the lighthouse and stop at the door.',
        hint: 'Slow down early. The last hundred metres are usually gravel.',
        targetLabel: 'the lighthouse',
        target: (ctx) => place(ctx, 'lighthouse'),
        check: (ctx) => arrived(ctx, place(ctx, 'lighthouse'), 44),
      },
    ],
    onComplete: (ctx) => {
      handedOver(ctx, 'the lighthouse crew', 'Supper');
      const s = ctx.data.splits || [];
      if (s.length === 3) {
        ctx.sim.notify(
          `Splits: ${s.map((t) => `${Math.round(t)}s`).join(' · ')}`,
          'info'
        );
      }
    },
    score: (ctx) => payFor(ctx, 96),
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
    spawn: { place: 'town' },
    faceTowards: 'summit',
    route: (sim) => [placeOf(sim, 'town'), placeOf(sim, 'summit'), placeOf(sim, 'town')],
    // Up and back down, at hairpin speed with glass in the back.
    plan: { legs: ['town', 'summit', 'town'], speed: 12.5, allow: 50 },
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
    availableOn: (sim) => placeOf(sim, 'summit').y - placeOf(sim, 'town').y > 60,
    onStart: (ctx) => {
      loadUp(ctx);
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
        text: 'Empty crates back down to the town. Careful — the road is steeper than it looked.',
        hint: 'Let the engine hold you back. Braking hard on a slope is what loses pips.',
        targetLabel: 'the town',
        target: (ctx) => place(ctx, 'town'),
        check: (ctx) => arrived(ctx, place(ctx, 'town')),
      },
    ],
    onComplete: (ctx) => {
      handedOver(ctx, 'the depot', 'The empties');
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

/** Find a job by id, the same way findMission() works for the aeroplane. */
export function findJob(id) {
  return CAR_JOBS.find((j) => j.id === id) || null;
}

/**
 * Town, three headlands and the light — the coast run, as a list of points.
 *
 * Shared between the job's plan (so the menu can price it) and its onStart (so
 * the split times land on the same three headlands the clock was set from).
 * Two copies of this would be two different coast roads.
 */
function coastChain(sim) {
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
 */
export function jobsFor(sim) {
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
    return {
      job,
      available: suits && short,
      note: lengthNote(sim, job),
      why: !suits
        ? 'Not on this island — it has not got the ground for it'
        : !short
          ? `Too far on this island — ${Math.round(secs / 60)} minutes of driving`
          : '',
    };
  });
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
    this.places = PLACE_NAMES.map((name) => ({
      name,
      label: PLACE_LABELS[name],
      pos: placeOf(sim, name),
      found: false,
    }));
    /** Jobs on the board, in the order they are offered. The first two are the
     *  easy ones, because the board is also where a child who skipped the jobs
     *  screen meets the game. */
    this.board = jobsFor(sim).filter((e) => e.available).map((e) => e.job.id);
    this.foundCount = 0;
    // The depot is where you are standing; it does not count as a discovery.
    const depot = this.places.find((p) => p.name === 'depot');
    if (depot) {
      depot.found = true;
      this.foundCount = 1;
    }
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
    return left > 0
      ? `No job on. ${left} place${left === 1 ? '' : 's'} on this island you have not been yet — go and find one.`
      : 'No job on. You have been everywhere on this island — take a job from the depot, or just drive.';
  }
}

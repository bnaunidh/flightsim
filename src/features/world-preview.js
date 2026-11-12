/**
 * World Map — Preview: the card in the map picker, the streamed ground, the
 * other airports, the world map, and a destination you can fly to.
 *
 * Nothing here runs unless the player picks the preview's card. It is not in
 * MAPS (world/maps.js registerExtraMap): the flight game still offers its own
 * maps and the lobbies still index the roster. A remembered World Map still
 * boots the default map (core/storage.js settleGameMaps): the card and the menu
 * say it is chosen, and it is built when you press Fly (flyChosen). See
 * world/worldmap/preview.js for how the sea fits in one frame and why the
 * ground is the same whichever field you start from.
 *
 *   The card    top of "Choose your map", marked PREVIEW: the five fields as a
 *               start picker (the field you start from is the full airport —
 *               terminal, stands, tower, ATC — and the others are drawn by
 *               worldmap/outstation.js), a pin dropped anywhere on the sea
 *               (features/wm-pin.js, worldmap/pin.js), and Fly here.
 *   The ground  worldmap/stream.js, built round the camera in a worker, inside
 *               the tier's budget, far tiles unloaded.
 *   The map     the full-screen live map (features/livemap/: 5, the MAP
 *               button on the HUD, the minimap, or the pause screen) — the
 *               sea, every field, where you are, DIRECT TO and a destination.
 *               It never pauses the flight.
 *   The trip    a destination puts the guidance (the HUD arrow, the minimap's
 *               mark, the autopilot's heading) on that field's approach, then
 *               its runway; a full stop there is an arrival. Long legs are
 *               an autopilot job: engage it at height and it holds the course.
 */
import * as THREE from '../vendor/three.module.js';
import { fetchRetry } from '../core/load-retry.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey } from '../flight/input.js';
import * as Terrain from '../world/terrain.js';
import { MAP, makeTerrainMaterial, setPavedExtra } from '../world/terrain.js';
import { registerExtraMap } from '../world/maps.js';
import { airportLayout } from '../world/airport.js';
import { pavedIn } from '../world/airport-layout.js';
import { RUNWAY } from '../world/airport.js';
import {
  WORLD_PREVIEW_ID, WORLD_PREVIEW_TITLE, PREVIEW, AIRPORTS, airportById, previewDef, setDeparture, departure,
  nearestAirport, headingTo, legM, HUB_ID, seaBox,
} from '../world/worldmap/preview.js';
import { PIN, clampPin, fieldAt, goalFor, pinStart, pinWords } from '../world/worldmap/pin.js';
import { TerrainStream, tierFor as streamTier, cardWorker, initWorker } from '../world/worldmap/stream.js';
import { outstationSteps, pavedTest, towerLens, buildDressing } from '../world/worldmap/outstation.js';
import { carrierProxyGeometry } from '../world/worldmap/field-look.js';
import { Horizon } from '../world/worldmap/horizon.js';
import { Flora, floraContext, SPECIES as FLORA_SPECIES } from '../world/worldmap/flora.js';
import { TownStream } from '../world/worldmap/town-stream.js';
import { townContext, planDowntown, townStreets } from '../world/worldmap/town-grid.js';
import { makeWorldTerrainMaterial } from '../world/worldmap/world-terrain.js';
import { buildWaters } from '../world/worldmap/waters.js';
import { buildNetworkLook } from '../world/worldmap/network-look.js';
import { Props, placeProps, PROP_MODELS } from '../world/worldmap/props.js';
import { parseGLB } from '../vehicles/glb.js';
import { SPEC } from '../aircraft/physics.js';
import { getAircraft, performanceFor } from '../aircraft/types.js';
import { saveSettings } from '../core/storage.js';
import { takeoffNeedM } from '../aircraft/takeoff-runs.js';
import { isBigJet } from '../world/spawns.js';

/**
 * The World Map's traffic (features/world-traffic.js): fetched the first time
 * the preview is built, so no other map ever loads it.
 */
let TRAFFIC_MOD = null;
function trafficModule() {
  if (!TRAFFIC_MOD) {
    TRAFFIC_MOD = import('./world-traffic.js').catch((e) => {
      console.warn('[world-preview] the traffic did not load; the sky stays empty', e);
      TRAFFIC_MOD = null;
      return null;
    });
  }
  return TRAFFIC_MOD;
}
/**
 * The ring past the sea (features/farlands-run.js, world/worldmap/farlands.js):
 * fetched the first time the World Map is chosen, before it is built, so no
 * other map ever loads it and the world it is built into has it from the first
 * tile. If it will not load, the World Map is the open sea it always was.
 */
let RING = null;
function loadRing() {
  if (!RING) {
    RING = import('./farlands-run.js').then((m) => {
      const d = previewDef();
      d.farlands = true;
      d._outer = m.FARLANDS;
      S.ring = m;
      return m;
    }).catch((e) => {
      console.warn('[world-preview] the ring past the sea did not load; the sea goes on for ever', e);
      return null;
    });
    // The instruments giving out deep in the ring (features/far-glitch.js): with the ring, never before it,
    // and the ring does not wait for it.
    RING.then((m) => (m ? import('./far-glitch.js') : null)).catch((e) => {
      console.warn('[world-preview] the far instrument failures did not load; the panels stay honest out there', e);
    });
  }
  return RING;
}

function startTraffic(sim, q) {
  const gen = (S.trafficGen = (S.trafficGen || 0) + 1);
  trafficModule().then((m) => {
    if (!m || S.trafficGen !== gen || !active()) return;
    S.traffic = m.createTraffic(sim, { quality: q });
    // The flight may have started while it was on its way; otherwise the fleet's models are built
    // now, one a task while the menu is up, so none is built mid-flight.
    if (sim.state === 'flying' || sim.state === 'paused') S.traffic.start({ late: true });
    else S.traffic.prewarm();
  });
}

/** The CC0 scenery models (worldmap/props.js), fetched once a session: name -> geometry (null if it would not load). */
let PROP_GEOS = null;
function propModels() {
  if (PROP_GEOS) return PROP_GEOS;
  PROP_GEOS = Promise.all(PROP_MODELS.map((n) => fetchRetry(new URL(`../../assets/models/scenery/${n}.glb`, import.meta.url).href)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
    .then((b) => {
      let g = null;
      parseGLB(b).scene.traverse((o) => {
        if (!g && o.geometry) g = o.geometry;
      });
      return [n, g];
    })
    .catch((e) => {
      console.warn(`[world-preview] scenery model ${n} did not load`, e);
      return [n, null];
    })));
  return PROP_GEOS;
}
import { cardAtlas, cardGeometry, cardMaterial, mergedCardGeometry, mergedCardMaterial } from '../world/worldmap/tree-cards.js';
import { biomeTreeGeometry } from '../world/worldmap/biome-trees.js';

/** A species' geometry: Scenery's six, then the biomes' (worldmap/flora.js SPECIES). */
const floraGeometry = (kind) => (kind < 6 ? treeGeometry(kind) : biomeTreeGeometry(kind));

/** The tree cards' reach and density per tier. */
export const CARD_TIERS = Object.freeze({
  // Low: none of its own — the Chromebooks' frame time. Low's trees ARE cards (buildWorldSteps): the same count, a tenth of the vertices, one draw.
  low: Object.freeze({ radius: 0, perCell: 0, shadows: false }),
  medium: Object.freeze({ radius: 1200, perCell: 1600, shadows: false }),
  high: Object.freeze({ radius: 1800, perCell: 2400, shadows: false }),
  ultra: Object.freeze({ radius: 2600, perCell: 3200, shadows: false }),
});
import { treeGeometry, addTreeSourceLater, setTownPlanner } from '../world/scenery.js';
import { setRenderOrigin } from '../render/render-origin.js';
import { setNavField, navField, landingDir, papiFor } from '../world/navfield.js';
import { icon } from '../ui/icons.js';
import { setExtraRunways } from '../ui/minimap.js';

// The map key (`worldMap`, 5) is the live map's now, on every map (features/livemap/livemap.js).
registerActions({
  // Shares 6 with the airlifters' cargo ramp, which wins in an airlifter (key() below).
  timeWarp: { label: 'Sim rate 1x / 2x / 4x in cruise (World Map preview)', group: 'Game', ctx: ['plane', 'heli'], default: ['Digit6'] },
});

/** The camera's far plane on the preview: the horizon's islands are out to here. The game's own is 60 km. */
const FAR_M = 110000;
const GAME_FAR_M = 60000;
/** Sim rates offered, and the most ground the sim may cover a real second at any of them. */
const WARP_STEPS = [1, 2, 4];
const WARP_MAX_MS = 1000;

const KT = 1.94384;
const STORE_KEY = 'islandsim.worldpreview.v1';

/** The live state while the preview is the loaded map (null otherwise). */
const S = {
  sim: null,
  stream: null,
  out: null,
  dest: null,
  arrivedT: 0,
  ui: null,
  pick: HUB_ID,
  /** The pin on the card: { x, z, h }, or null. It replaces the field picked until it is taken up. */
  pin: null,
  pinDest: null,
  pinGoing: false,
  horizon: null,
  flora: null,
  nav: null,
  warp: { want: 1, k: 1, why: '' },
  perf: { frames: 0, total: 0, max: 0, over4: 0, over8: 0 },
  builtFor: null,
  onBuilt: [],
};

/* ------------------------------------------------------------------ */
/* Memory: the fields you have landed at                               */
/* ------------------------------------------------------------------ */

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') return { visited: Array.isArray(v.visited) ? v.visited.filter((id) => airportById(id)) : [], start: airportById(v.start) ? v.start : HUB_ID };
  } catch (e) {
    /* private window, blocked storage: start fresh */
  }
  return { visited: [], start: HUB_ID };
}

function writeStore(v) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch (e) {
    /* nothing to do: the preview works without it */
  }
}

let STORE = null;
function store() {
  if (!STORE) STORE = readStore();
  return STORE;
}

/* ------------------------------------------------------------------ */
/* Is the preview the map?                                             */
/* ------------------------------------------------------------------ */

export function active() {
  return !!(MAP && MAP.id === WORLD_PREVIEW_ID);
}

/** Load the preview, built round this field. The same path as any map card. */
export function choosePreview(sim, airportId = S.pick) {
  registerExtraMap(previewDef());
  const a = airportById(airportId) || AIRPORTS[0];
  setDeparture(a.id);
  S.pick = a.id;
  const st = store();
  st.start = a.id;
  writeStore(st);
  const go = () => (sim.menus && sim.menus.hooks && typeof sim.menus.hooks.chooseMap === 'function' ? sim.menus.hooks.chooseMap(WORLD_PREVIEW_ID) : sim.setMap(WORLD_PREVIEW_ID));
  return S.ring ? go() : loadRing().then(go);
}

/** Resolves once the preview's world has been built (for "Fly now" and the tests). */
export function whenBuilt() {
  return new Promise((res) => S.onBuilt.push(res));
}

/* ------------------------------------------------------------------ */
/* The world                                                           */
/* ------------------------------------------------------------------ */

function teardown(sim) {
  S.trafficGen = (S.trafficGen || 0) + 1;
  if (S.traffic) S.traffic.dispose();
  S.traffic = null;
  if (S.stream) S.stream.dispose();
  if (S.horizon) S.horizon.dispose();
  if (S.flora) S.flora.dispose();
  if (S.cards) S.cards.dispose();
  if (S.towns) S.towns.dispose();
  S.towns = null;
  if (S.props) S.props.dispose();
  if (S.far) S.far.dispose();
  S.far = null;
  S.props = null;
  S.cards = null;
  S.stream = null;
  S.horizon = null;
  S.flora = null;
  S.out = null;
  S.dressing = null;
  if (S.waters) {
    S.waters.geometry.dispose();
    S.waters.material.dispose();
    S.waters = null;
  }
  if (S.network) {
    S.network.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    S.network = null;
  }
  S.builtFor = null;
  S.nav = null;
  setExtraRunways([]);
  Terrain.setOtherRunways([]);
  setNavField(null);
  setRenderOrigin(null);
  setWarp(sim, 1, '');
  if (sim) {
    farCarrier(sim, null, true);
    S.carrierLayer = null;
    sim.navPapi = null;
    if (sim.camera && sim.camera.far !== GAME_FAR_M) {
      sim.camera.far = GAME_FAR_M;
      sim.camera.updateProjectionMatrix();
    }
  }
  if (S.ui && S.ui.card) S.ui.card.hidden = true;
}

/**
 * The coach line says nothing on the World Map. The wrapper has to be the
 * OUTERMOST: carrier-ops wraps sim.coachHint too, with the carrier's own
 * lines ("WAVE OFF — full power...") ahead of the game's, and when it wrapped
 * after this the carrier's coaching came straight through (checker, wave 18).
 * So: wrapped at install and again at every flight's start if anything has
 * wrapped it since. `_carrier` is carried over so carrier-ops never wraps a
 * second copy of itself over this.
 */
function muteCoach(sim) {
  if (typeof sim.coachHint !== 'function' || sim.coachHint._worldPreview) return;
  const own = sim.coachHint;
  const wrapped = function coachHint(ac) {
    return active() ? null : own.call(sim, ac);
  };
  wrapped._worldPreview = true;
  if (own._carrier) wrapped._carrier = true;
  sim.coachHint = wrapped;
}

/**
 * The Tower view: every field's tower here (camera.js towerLens), the start field's balcony anywhere else.
 * Nullspire's too (on no list, so its Tower view was a spotter's point, which at the ramp came out inside the terminal).
 */
function setTowers(sim) {
  const city = S.ring && S.ring.CITY_FIELD;
  if (sim && sim.rig) sim.rig.towers = active() ? [...PREVIEW.airports, ...(city ? [city] : [])].map(towerLens).filter(Boolean) : null;
}

/** The towns' street plans for this world build (one per set of flats: the ground, the buildings and the hub's Scenery share it). */
let TOWN_CTX = null;
function worldTownContext() {
  if (!TOWN_CTX || TOWN_CTX.flats !== Terrain.FLATS) {
    TOWN_CTX = { flats: Terrain.FLATS, ctx: townContext(PREVIEW, Terrain.FLATS, (MAP.waters && MAP.waters.roads) || []) };
  }
  return TOWN_CTX.ctx;
}

/**
 * The town Scenery builds itself (the hub's): the same street plan as every other town, so
 * its buildings stand on the streets the ground has. (scenery.js planTown asks this.)
 */
function planWorldTown(cfg, density) {
  const ctx = worldTownContext();
  const F = ctx.towns.find((t) => Math.hypot(t.cx - cfg.cx, t.cz - cfg.cz) < 30);
  if (!F) return null;
  const share = density >= 1 ? 0.85 : density >= 0.6 ? 0.7 : 0.45;
  const spots = planDowntown(Terrain, ctx, F, { want: Math.max(12, Math.round((cfg.count || 40) * share)), towers: Math.round((cfg.towers || 0) * share), towerMaxH: cfg.towerMaxH });
  return { cfg, spots, streets: townStreets(F) };
}

/** The garden trees: the woods' own cards, tinted per tree (worldmap/tree-cards.js). */
let GARDEN_TREES = null;
function gardenTreeMaterial() {
  if (!GARDEN_TREES) GARDEN_TREES = cardMaterial();
  // (The atlas is remade for a new tier: the gardens follow it.)
  GARDEN_TREES.map = cardAtlas();
  return GARDEN_TREES;
}

function buildWorld(sim, group) {
  const pieces = buildWorldSteps(sim, group);
  while (!pieces.next().done);
}

/** The build, stopping between its pieces when main.js is building in stages (setMap): seconds of it on a Chromebook. */
function* buildWorldSteps(sim, group) {
  teardown(sim);
  setTowers(sim);
  if (!active()) return;
  const q = sim.settings.quality || 'medium';
  const t0 = performance.now();
  // terrain.js's ground with the land cover painted on (worldmap/world-terrain.js).
  const mat = makeWorldTerrainMaterial(q, S.ring ? S.ring.RING_LOOK : undefined);
  const fctx = floraContext(PREVIEW);
  fctx.town = worldTownContext();
  S.stream = new TerrainStream({ T: Terrain, material: mat, group, quality: q, def: MAP, flora: fctx });
  // A 400 km sea: the floating origin for drawing (render/render-origin.js), and a far plane out to the horizon's islands.
  setRenderOrigin({});
  if (sim.camera) {
    sim.camera.far = FAR_M;
    sim.camera.updateProjectionMatrix();
  }
  // The rivers and lakes (terrain.js carves their beds; worldmap/waters.js lays the water).
  S.waters = buildWaters(PREVIEW.rivers || [], PREVIEW.lakes || []);
  if (S.waters) group.add(S.waters);
  // The network's bridges and roundabout islands (the tarmac is main.js's road ribbon).
  const rings = ((MAP.waters && MAP.waters.roads) || []).filter((r) => r.ring).map((r) => r.ring);
  S.network = buildNetworkLook(Terrain.shapeBridges(), rings, Terrain.groundHeightAt);
  if (S.network) group.add(S.network);
  yield;
  // The real scenery models: rocks, boulders, quiver trees, piers, poles (worldmap/props.js).
  S.props = new Props({ placed: placeProps(Terrain, PREVIEW), quality: q });
  group.add(S.props.group);
  const props = S.props;
  propModels().then((list) => {
    if (S.props !== props) return;
    for (const [n, g] of list) props.setModel(n, g);
    // Arrived after the world's own warm: compiled now, in the background, not on the first one in reach.
    if (typeof sim.warmShaders === 'function') props.warmed = sim.warmShaders(props.group, { chunked: true });
  });
  yield;
  S.horizon = new Horizon({ heightAt: Terrain.groundHeightAt, islands: PREVIEW.islands, hideWithin: streamTier(q).range });
  group.add(S.horizon.mesh);
  yield;
  if (S.ring) S.far = S.ring.createFarlands(sim, group, q);
  yield;
  // Low's trees are the woods' own cards, half-size atlas, one draw call for every species; solid as ever.
  const lowCards = q === 'low' ? { id: 'low', mode: 'trees', merged: true, geometry: mergedCardGeometry, material: () => mergedCardMaterial(0.5) } : null;
  S.flora = new Flora({
    treeGeometry: floraGeometry, ctx: fctx, T: Terrain, worker: S.stream.worker && !S.stream.workerFailed ? S.stream.worker : null, gen: S.stream.gen,
    quality: q, addObstacle: Terrain.addObstacle, obstacles: Terrain.OBSTACLES, layer: lowCards,
    // When the ground gives up on the shared worker, so do the trees (and plant here instead).
    workerOk: () => !!(S.stream && S.stream.worker && !S.stream.workerFailed),
  });
  group.add(S.flora.group);
  // The real trees close up take the nearest of these (world/real-trees.js; Medium and up).
  if (!lowCards) S.flora.meshes.forEach((m, kind) => addTreeSourceLater(m, FLORA_SPECIES[kind]));
  // And the woods between them: tree cards, dense, close in, only in the forests (worldmap/tree-cards.js).
  // On a worker of their own, so a forest's thousands never queue in front of the ground's tiles.
  if (CARD_TIERS[q] && CARD_TIERS[q].radius > 0) {
    const cw = S.stream.worker && !S.stream.workerFailed ? cardWorker() : null;
    const cardsOn = initWorker(cw, S.stream.gen, MAP, fctx);
    S.cards = new Flora({
      treeGeometry, ctx: fctx, T: Terrain, worker: cardsOn ? cw : null, gen: S.stream.gen,
      quality: q, workerOk: () => !!(S.stream && S.stream.worker && !S.stream.workerFailed),
      layer: { id: 'cards', mode: 'cards', merged: true, tiers: CARD_TIERS, geometry: mergedCardGeometry, material: () => mergedCardMaterial(), solid: false },
    });
    group.add(S.cards.group);
  } else S.cards = null;
  // Every town's buildings, right out to the suburbs (worldmap/town-stream.js).
  S.towns = new TownStream({
    ctx: fctx.town, T: Terrain, worker: S.stream.worker && !S.stream.workerFailed ? S.stream.worker : null, gen: S.stream.gen, quality: q,
    addObstacle: Terrain.addObstacle, obstacles: Terrain.OBSTACLES, workerOk: () => !!(S.stream && S.stream.worker && !S.stream.workerFailed),
    treeShape: cardGeometry, treeMaterial: gardenTreeMaterial(),
  });
  group.add(S.towns.group);
  yield;
  // The ground the first frame needs, now, behind the loading screen.
  const r = RUNWAY;
  S.stream.prime(r.thresholdWest.x + 80, r.elev + 60, r.thresholdWest.z);
  yield;
  const t1 = performance.now();
  const dep = departure();
  S.out = yield* outstationSteps(PREVIEW, dep.id, q, { T: Terrain, ctx: fctx.town });
  yield;
  // The field you start from is airport.js's; its own landmarks (the persona's
  // shelters, radomes, silos, lighthouse...: worldmap/personas.js) are these.
  S.dressing = buildDressing(dep, q);
  if (S.dressing) S.out.group.add(S.dressing);
  console.debug(`[wp] ground ${Math.round(t1 - t0)} ms (${S.stream.counts.primed} tiles), other fields and towns ${Math.round(performance.now() - t1)} ms`, S.out.timing || '');
  group.add(S.out.group);
  // The tyres: the main field's layout (airport.js set it) and the other fields' made ground.
  const others = PREVIEW.airports.filter((a) => a.id !== dep.id);
  // Nullspire's field too (farlands-run.js CITY_FIELD): its tarmac rolls and its runway counts, but the minimap
  // is never told of it (it is a secret: setExtraRunways is the minimap's list, setOtherRunways the wheels' and the scoring's).
  const cityPaved = S.ring ? pavedTest([S.ring.CITY_FIELD]) : () => false;
  const outPaved = pavedTest(others);
  setPavedExtra((x, z) => pavedIn(airportLayout(), x, z) || outPaved(x, z) || cityPaved(x, z));
  // The terrain warning and the minimap know the other fields' runways too,
  // and a landing on one is a landing on a runway (terrain.js isOnAnyRunway).
  setExtraRunways(others.map((a) => ({ cx: a.x, cz: a.z, length: a.length, halfWidth: a.halfWidth })));
  Terrain.setOtherRunways([...others.map((a) => ({ cx: a.x, cz: a.z, length: a.length, halfWidth: a.halfWidth })), ...(S.ring ? [S.ring.cityRunway()] : [])]);
  // The landing aids at whichever field you are at (updateNav, every frame).
  sim.navPapi = (pos, mainHint) => navPapi(pos, mainHint);
  yield;
  prewarm(sim, [S.out.group, S.flora.group, S.cards && S.cards.group, S.towns && S.towns.group, S.horizon.mesh, S.waters, S.network, S.props && S.props.group, ...(S.far ? S.far.roots() : [])]);
  yield;
  S.builtFor = { id: dep.id, quality: q, ms: performance.now() - t0 };
  startTraffic(sim, q);
  // Built in stages, the other features and the map's weather are still to come: Fly must wait for those too.
  if (sim._worldBuilding && sim.afterWorldBuilt) sim.afterWorldBuilt(tellBuilt);
  else tellBuilt();
}

function tellBuilt() {
  const waiting = S.onBuilt.splice(0);
  for (const f of waiting) {
    try {
      f(S.builtFor);
    } catch (e) {
      /* a waiter that throws is its own problem */
    }
  }
}

/**
 * Upload every texture and compile every shader the other fields, their
 * towns, the trees and the horizon will need, now, behind the loading screen.
 * They are hidden until you are near them, and three compiles a program and
 * uploads a texture the first frame something using it is drawn: measured at
 * Low flying across the mainland, that was a run of 130 ms frames each time a
 * new town came into range, which is a stutter you see.
 */
function prewarm(sim, roots) {
  const R = sim.renderer;
  if (!R || !sim.camera) return;
  const t0 = performance.now();
  const flipped = [];
  const tex = new Set();
  for (const root of roots) {
    if (!root) continue;
    root.traverse((o) => {
      if (!o.visible) {
        flipped.push(o);
        o.visible = true;
      }
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) for (const k in m) if (m[k] && m[k].isTexture) tex.add(m[k]);
    });
  }
  try {
    for (const t of tex) R.initTexture(t);
    for (const root of roots) if (root) R.compile(root, sim.camera, sim.scene);
  } catch (e) {
    /* a renderer that will not: they compile on first sight, as before */
  } finally {
    for (const o of flipped) o.visible = false;
  }
  S.prewarm = { ms: performance.now() - t0, textures: tex.size, shown: flipped.length };
}

/** The sea in one square: every island and a margin (the card's sketch). */
export const chartBox = () => seaBox();

/* ------------------------------------------------------------------ */
/* The trip                                                            */
/* ------------------------------------------------------------------ */

/** Where the guidance points for a destination: its approach gate, then its runway. */
export function routeTarget(a, x, z, windDirDeg = 80) {
  // Land into the wind: 09 when the wind has any east in it, 27 otherwise.
  const land09 = Math.cos(((windDirDeg - 90) * Math.PI) / 180) >= 0;
  const end = land09 ? -1 : 1;
  const thr = { x: a.x + end * (a.length / 2), z: a.z };
  const gate = { x: thr.x + end * 7000, z: a.z };
  const toField = Math.hypot(x - a.x, z - a.z);
  const toGate = Math.hypot(x - gate.x, z - gate.z);
  // On the approach side and lined up, or already close: the runway itself.
  const inbound = Math.sign(x - thr.x) === end && Math.abs(z - a.z) < 1800;
  if (toGate < 2500 || (inbound && toField < 12000) || toField < 3500) {
    return { stage: 'final', x: thr.x - end * 200, z: a.z, y: a.elev, runway: land09 ? '09' : '27' };
  }
  return { stage: 'gate', x: gate.x, z: gate.z, y: a.elev + 450, runway: land09 ? '09' : '27' };
}

const _tgt = new THREE.Vector3();
function worldTarget(sim) {
  if (!active() || !S.dest || sim.mode !== 'free') return null;
  const ac = sim.aircraft;
  if (!ac) return null;
  const w = (sim.weather && sim.weather.windDirDeg) ?? 80;
  const r = routeTarget(S.dest, ac.pos.x, ac.pos.z, w);
  _tgt.set(r.x, r.y, r.z);
  const km = Math.hypot(ac.pos.x - S.dest.x, ac.pos.z - S.dest.z) / 1000;
  const label = r.stage === 'final' ? `${S.dest.code} runway ${r.runway}` : `${S.dest.code} ${S.dest.name} · ${km.toFixed(0)} km`;
  // `wp`: the trip's guidance, which a DIRECT TO on the live map flies over (livemap.js wireGuidance).
  return { pos: _tgt, label, wp: true };
}

export function setDestination(sim, id) {
  const a = id ? airportById(id) : null;
  S.dest = a;
  S.arrivedT = 0;
  if (sim.hud && a) {
    const km = legM({ x: sim.aircraft.pos.x, z: sim.aircraft.pos.z }, a) / 1000;
    sim.hud.notify(`Destination ${a.code} ${a.name} — ${km.toFixed(0)} km, heading ${String(Math.round(headingTo(sim.aircraft.pos.x, sim.aircraft.pos.z, a.x, a.z))).padStart(3, '0')}°`, 'info', 5);
  }
  syncCard(sim);
  return S.dest;
}

/* ------------------------------------------------------------------ */
/* The pin: a start anywhere on the sea (worldmap/pin.js)              */
/* ------------------------------------------------------------------ */

/** The nearest field this aircraft can use: an aeroplane needs the runway. */
function pinGoal(pin, type) {
  if (type && type.shape && type.shape.power && type.shape.power.rotor) return goalFor(pin.x, pin.z);
  // The take-off run is what the game measures; a big jet has to land there too.
  const need = (a) => Math.max(Number(type && type.minRunway) || 0, takeoffNeedM(type, a.surface), isBigJet(type) ? PIN.bigJetM : 0);
  return goalFor(pin.x, pin.z, (a) => a.length >= need(a));
}

/** A pin, within what the map allows: the sea's square if the ring never loaded. */
function clampTo(x, z) {
  return S.ring ? S.ring.clampFar(x, z) : clampPin(x, z);
}

function saneStall(sim) {
  try {
    return performanceFor(sim.aircraftType.id).stallClean / KT;
  } catch (e) {
    return 40;
  }
}

/**
 * Build the World Map round this field and wait for it, false if it did not
 * come. Choosing a map hands the screen that map's weather: `cfg` is what the
 * player asked for, so it goes back on.
 */
async function buildFor(sim, id, cfg) {
  const built = whenBuilt();
  choosePreview(sim, id);
  // A build that threw never says so: Fly here must not stay dead after it.
  const done = await Promise.race([built, new Promise((res) => setTimeout(res, PIN.buildCapMs))]);
  if (!done) sim.hud && sim.hud.notify('The World Map did not load. Please try again.', 'warn', 4);
  if (!done || !active()) return false;
  if (sim.menus.applyFree) sim.menus.applyFree(cfg);
  return true;
}

/**
 * Take off, with the World Map remembered from last time and not built yet:
 * this is when it is. To the pin left on the card, or the field picked. A pin
 * comes here with the map already built too (takesOffToPin, main.js startFree).
 */
async function flyChosen(sim, cfg) {
  if (S.pin) return flyToPin(sim, cfg);
  if (S.pinGoing) return undefined;
  S.pinGoing = true;
  try {
    if (await buildFor(sim, S.pick, cfg)) await sim.menus.hooks.startFree(cfg);
  } finally {
    S.pinGoing = false;
  }
  return undefined;
}

/**
 * Fly here, with a pin. A field's start goes the way that field's always does
 * (the Free Flight screen's own hook); anywhere else is an airborne start that
 * names the pin, so that Restart comes back to it (main.js keeps the options)
 * and no other flight ever sees it. The world is built round the field you are
 * heading for, as if you had picked it.
 */
async function flyToPin(sim, setup = null) {
  if (S.pinGoing || !S.pin) return;
  S.pinGoing = true;
  try {
    const menus = sim.menus;
    const pin = { x: S.pin.x, z: S.pin.z };
    const cfg = setup || (menus.readFree ? menus.readFree() : { aircraft: menus.chosenAircraft });
    const at = fieldAt(pin.x, pin.z);
    const field = at || pinGoal(pin, getAircraft(cfg.aircraft));
    if (!(active() && S.builtFor && S.builtFor.id === field.id && S.builtFor.quality === sim.settings.quality) && !(await buildFor(sim, field.id, cfg))) return;
    if (menus.rememberFree) menus.rememberFree();
    if (at) {
      // The field's own start, through the hook that would otherwise bring it back here (takesOffToPin).
      S.fieldStart = true;
      try {
        await menus.hooks.startFree(cfg);
      } finally {
        S.fieldStart = false;
      }
    } else {
      // A pin is its own start: the Free Flight screen's "Start at" (a gate, a carrier's deck) has no say.
      const { startAt, ...plain } = cfg;
      await sim.startMode('free', { ...plain, airborne: true, taxi: false, pin });
    }
  } finally {
    S.pinGoing = false;
  }
}

/** Does Take off go to the pin? Whenever one is on the card with the World Map up; `waitingMap` is flyChosen's own case. */
function takesOffToPin() {
  return active() && !!S.pin && !S.fieldStart;
}

/** Is this flight one that started from a pin? (A checkpoint resumed on the ground kept the pin but did not.) */
function pinFlight(sim) {
  const o = sim.modeOpts;
  return active() && sim.mode === 'free' && !!(o && o.pin && o.airborne);
}

/**
 * The tower has nothing to say while a pin's flight is being set up: main.js
 * tells a helicopter "lift when you are ready" before it has been moved, and
 * from a pin it is already flying. Both clocks at zero is a flight that has
 * not had a frame yet (as aircraft/rotor-assist.js reads it).
 */
function quietPinStart(sim) {
  const atc = sim.atc;
  if (!atc || atc._pinQuiet) return;
  const say = atc.say.bind(atc);
  atc._pinQuiet = true;
  atc.say = (...a) => {
    const ac = sim.aircraft;
    return pinFlight(sim) && ac && ac.airborneTime === 0 && ac.groundTime === 0 ? false : say(...a);
  };
}

/** Is the ground at (x, z) drawn? Open sea has no tiles to wait for. */
function groundDrawn(x, z) {
  const st = S.stream;
  if (!st) return false;
  if (!st.hasLand(x, z, 1)) return true;
  for (const k of st.shown) {
    const t = st.tiles.get(k);
    if (t && Math.abs(x - t.cx) <= t.size / 2 && Math.abs(z - t.cz) <= t.size / 2) return true;
  }
  return false;
}

/** Put the flight at its pin, with the ground under it loaded and a field to fly to. */
function startAtPin(sim, opts) {
  const ac = sim.aircraft;
  const pin = clampTo(opts.pin.x, opts.pin.z);
  const rotor = !!SPEC.rotor;
  const goal = pinGoal(pin, sim.aircraftType);
  const how = { rotor, stallMs: saneStall(sim), ceilingM: ceilingOf(sim) };
  const p = S.ring ? S.ring.farStart(Terrain.heightAt, pin, goal, how) : pinStart(Terrain.heightAt, pin, goal, how);
  S.lastStart = p;
  const fuel = opts.fuel != null ? Math.max(0.05, Math.min(1, opts.fuel)) : 1;
  const place = (y) => {
    // altAGL is from the ground, which at sea is the sea bed.
    ac.reset({ pos: new THREE.Vector3(p.x, 0, p.z), headingDeg: p.headingDeg, speed: p.speed, altAGL: y - Terrain.heightAt(p.x, p.z), engineOn: true, gearDown: false, fuel });
    ac.controls.throttle = p.throttle;
    if (sim.input) {
      sim.input.throttleTarget = p.throttle;
      if (sim.input.out) sim.input.out.throttle = p.throttle;
    }
  };
  place(p.y);
  // Nearest first and capped, as a world build's own: what is left streams in behind the first frame.
  if (S.stream) S.stream.prime(p.x, p.y, p.z, S.stream.tier.primeMs);
  if (!groundDrawn(p.x, p.z)) place(Math.min(p.y + PIN.fallbackM, Math.max(p.y, p.limitM || Infinity)));
  // The chase camera starts afresh here (as carrier-ops does).
  if (sim.rig) sim.rig.initialised = false;
  S.dest = goal;
  S.pinDest = goal;
  S.arrivedT = 0;
  if (sim.hud && sim.hud.setObjective) {
    const km = legM(p, goal) / 1000;
    const way = sim.navGuide && sim.navGuide.enabled ? 'Follow the arrow and land there' : `Land there`;
    const next = p.where ? `${p.where === 'low ground' ? 'Mind the walls' : 'Stay in it: it leads back to the sea'}. ${goal.name} is ${km.toFixed(0)} km away` : `${goal.name} is ${km.toFixed(km < 10 ? 1 : 0)} km away, heading ${String(Math.round(p.headingDeg) % 360).padStart(3, '0')}. ${way}, or fly anywhere you like`;
    sim.hud.setObjective(`DIRECT TO ${goal.code}`, `${next}.`);
  }
  // Past what the type can hold: said once, so nobody thinks the pin was lost.
  if (p.where && sim.hud) {
    const spot = p.where === 'low ground' ? 'on lower ground' : `in the nearest ${p.where}`;
    sim.hud.notify(`Too high for the ${sim.aircraftType.name} at your pin. You start ${(p.movedM / 1000).toFixed(p.movedM < 10000 ? 1 : 0)} km away, ${spot}.`, 'warn', 7);
  }
}

/**
 * Nullspire, from the dev workbench: the aircraft on a long final for the
 * city's 09, the ground under it loaded, the field's own objective. Restart
 * (main.js keeps the options) comes back to the same final.
 */
function startAtCity(sim, opts) {
  const ac = sim.aircraft;
  const R = S.ring;
  const rotor = !!SPEC.rotor;
  const p = R.approachStart(rotor ? 3000 : 11000, rotor ? 300 : 620);
  const stall = saneStall(sim);
  const speed = rotor ? 25 : Math.max(stall * 1.5, 70);
  const fuel = opts.fuel != null ? Math.max(0.05, Math.min(1, opts.fuel)) : 1;
  ac.reset({ pos: new THREE.Vector3(p.x, 0, p.z), headingDeg: p.headingDeg, speed, altAGL: p.y - Terrain.heightAt(p.x, p.z), engineOn: true, gearDown: false, fuel });
  ac.controls.throttle = 0.6;
  if (sim.input) {
    sim.input.throttleTarget = 0.6;
    if (sim.input.out) sim.input.out.throttle = 0.6;
  }
  if (S.stream) S.stream.prime(R.CITY_FIELD.x, p.y, R.CITY_FIELD.z, S.stream.tier.primeMs);
  if (S.far) S.far.settle();
  if (sim.rig) sim.rig.initialised = false;
  S.dest = null;
  S.pinDest = null;
  S.lastStart = { ...p, where: 'city' };
  if (sim.hud && sim.hud.setObjective) sim.hud.setObjective(`DIRECT TO ${R.CITY_FIELD.code}`, `${R.CITY.name} is ahead, heading 090: a long final for runway 09. Land there.`);
}

/**
 * The dev workbench's "Teleport to Nullspire": builds the World Map first
 * if another map is up (round the field last picked), then a Free Flight on
 * a long final for the city's runway, in the aircraft the Hangar has chosen.
 * Dev mode only: the button is in the Dev mode panel, which nobody else sees.
 */
async function teleportToCity(sim) {
  if (S.pinGoing) return false;
  S.pinGoing = true;
  try {
    const menus = sim.menus;
    const cfg = menus.readFree ? menus.readFree() : { aircraft: menus.chosenAircraft };
    if (!(active() && S.builtFor && S.builtFor.quality === sim.settings.quality) && !(await buildFor(sim, S.pick, cfg))) return false;
    if (!S.ring) {
      sim.hud && sim.hud.notify('The ring past the sea did not load: there is no city to go to.', 'warn', 5);
      return false;
    }
    const { startAt, ...plain } = cfg;
    await sim.startMode('free', { ...plain, airborne: true, taxi: false, city: true });
    return true;
  } finally {
    S.pinGoing = false;
  }
}

/**
 * The Dev console's /tp (features/dev-console.js; the owner, 2026-11-08): a
 * World Map field, started the way that field always starts (the Free Flight
 * screen's "Start at"), with the world built round it as if it had been
 * picked; a pin's spot is flyToPin's own airborne start.
 */
async function tpField(sim, id) {
  const a = airportById(id);
  if (!a || S.pinGoing) return false;
  S.pinGoing = true;
  try {
    const menus = sim.menus;
    const cfg = menus.readFree ? menus.readFree() : { aircraft: menus.chosenAircraft };
    setPin(null);
    const same = active() && S.builtFor && S.builtFor.id === a.id && S.builtFor.quality === sim.settings.quality;
    if (!same && !(await buildFor(sim, a.id, cfg))) return false;
    if (same && menus.applyFree) menus.applyFree(cfg);
    await sim.startMode('free', cfg);
    return true;
  } finally {
    S.pinGoing = false;
  }
}

async function tpSpot(sim, x, z) {
  if (S.pinGoing) return false;
  const c = clampTo(x, z);
  setPin({ ...c, h: null, zone: S.ring ? S.ring.zoneOf(c.x, c.z) : null });
  await flyToPin(sim);
  return true;
}

/** The type's published ceiling, metres, or 0. */
function ceilingOf(sim) {
  try {
    return (performanceFor(sim.aircraftType.id).ceilingFt || 0) * 0.3048;
  } catch (e) {
    return 0;
  }
}

function etaMin(sim, distM) {
  const r = sim.aircraft && sim.aircraft.readouts ? sim.aircraft.readouts() : null;
  const kts = r && r.groundKts > 40 ? r.groundKts : 120;
  return distM / (kts / KT) / 60;
}

/** A full stop on a field's runway or apron: that field is visited. */
function checkArrival(sim, dt) {
  const ac = sim.aircraft;
  if (!ac || ac.crashed) return;
  const r = ac.readouts();
  if (!ac.onGround || r.groundKts > 5) {
    S.arrivedT = 0;
    return;
  }
  const { airport: a, distM } = nearestAirport(ac.pos.x, ac.pos.z);
  if (!a || distM > a.length / 2 + 900) return;
  S.arrivedT += dt;
  if (S.arrivedT < 3) return;
  const st = store();
  const first = !st.visited.includes(a.id);
  if (first) {
    st.visited.push(a.id);
    writeStore(st);
  }
  if (S.dest && S.dest.id === a.id) {
    sim.hud && sim.hud.showBanner(`Arrived — ${a.name}`, `${a.code} · ${a.place}${first ? ' · first visit' : ''}`, 'good', 5);
    S.dest = null;
  } else if (first && a.id !== departure().id) {
    sim.hud && sim.hud.notify(`First landing at ${a.name} (${a.code})`, 'good', 4);
  }
  S.arrivedT = -1e9; // once per stop
  syncCard(sim);
}

/*
 * The carrier, out of sight.
 *
 * The ship and the jets on its deck are three hundred draw calls, and on the
 * nine maps it is never far away. On a 400 km sea it is a dot 30 km off that
 * still cost all three hundred: measured at Low over the mainland, it was more
 * than half of every frame's draw calls. Past the tier's range it is hidden
 * (it is a speck by then); close in it is exactly as it was.
 */
const CARRIER_RANGE = Object.freeze({ low: 9000, medium: 14000, high: 20000, ultra: 26000 });
/*
 * Past that range the ship is not gone: a grey hull, deck and island, one
 * mesh and one draw call, the same size and in the same place, out to
 * CARRIER_FAR (owner, Oct 26: the carrier must show from a sensible distance,
 * not pop in at 9 km). Under the range it is hidden and the real ship drawn.
 */
const CARRIER_FAR = 60000;
function carrierProxy(sim) {
  const c = sim.carrier;
  if (!c || !c.group || !sim.scene) return null;
  if (S.carrierProxy && S.carrierProxy.userData.for === c) return S.carrierProxy;
  if (S.carrierProxy) disposeCarrierProxy();
  const deck = { length: c.halfDepth * 2, width: c.halfWidth * 2, y: c.deckY };
  const m = new THREE.Mesh(carrierProxyGeometry(deck), new THREE.MeshLambertMaterial({ color: 0x5d646c }));
  m.name = 'wp:carrier-far';
  m.userData.for = c;
  m.position.copy(c.group.position);
  m.rotation.copy(c.group.rotation);
  m.visible = false;
  m.matrixAutoUpdate = false;
  m.updateMatrix();
  sim.scene.add(m);
  S.carrierProxy = m;
  return m;
}
function disposeCarrierProxy() {
  const m = S.carrierProxy;
  if (!m) return;
  if (m.parent) m.parent.remove(m);
  m.geometry.dispose();
  m.material.dispose();
  S.carrierProxy = null;
}
function farCarrier(sim, cam, force = null) {
  const c = sim.carrier && sim.carrier.group;
  if (!c) return;
  const layer = S.carrierLayer || (S.carrierLayer = sim.scene && sim.scene.getObjectByName('ext:carrier-ops'));
  const range = CARRIER_RANGE[(S.builtFor && S.builtFor.quality) || 'medium'] || CARRIER_RANGE.medium;
  const d = cam ? Math.hypot(cam.x - c.position.x, cam.z - c.position.z) : 0;
  const on = force != null ? force : d < range;
  if (c.visible !== on) c.visible = on;
  if (layer && layer.visible !== on) layer.visible = on;
  // The far ship: only on the preview, only between the range and CARRIER_FAR.
  if (force != null) {
    disposeCarrierProxy();
    return;
  }
  const px = carrierProxy(sim);
  const far = !on && d < CARRIER_FAR;
  if (px && px.visible !== far) px.visible = far;
}

/* ------------------------------------------------------------------ */
/* The field you are at: radio, approach, landing aids                 */
/* ------------------------------------------------------------------ */

/** The navfield record for an airport, landing into this wind. */
export function navFor(a, windDirDeg = 80) {
  return {
    id: a.id, code: a.code, name: a.name, radio: a.name.split(' ')[0],
    cx: a.x, cz: a.z, elev: a.elev, length: a.length, halfWidth: a.halfWidth, dir: landingDir(windDirDeg),
  };
}

/** How far past a field's runway ends it is still "the field you are at", ahead of a destination. */
const AT_FIELD_M = 1500;

/**
 * Which field the radio, the approach autopilot and the PAPI are working
 * (world/navfield.js): the destination once you are within 60 km of it
 * (unless you are at another field: AT_FIELD_M), otherwise the nearest field, changing only when another is clearly nearer
 * (10% and 2 km), so the frequency does not flick back and forth half way.
 */
export function pickNav(x, z, current, dest) {
  const { airport: near, distM } = nearestAirport(x, z);
  // On a field, or just off its runway ends, that field's tower has you
  // whatever the destination: a destination 30 km away set before take-off
  // must not take the departure's radio, its take-off clearance and its
  // approach away while you are still sitting on its runway.
  const atOther = dest && near.id !== dest.id && distM < near.length / 2 + AT_FIELD_M;
  if (dest && !atOther && Math.hypot(x - dest.x, z - dest.z) < 60000) return dest;
  if (!current) return near;
  if (near.id === current.id) return current;
  const dc = Math.hypot(x - current.x, z - current.z);
  return distM < dc * 0.9 - 2000 ? near : current;
}

function updateNav(sim) {
  const ac = sim.aircraft;
  if (!ac) return;
  const w = (sim.weather && sim.weather.windDirDeg) ?? 80;
  // Near Nullspire (a hundred kilometres out in the void, on no list) its own tower, PAPI and approach have you.
  const cf = S.ring && S.ring.CITY_FIELD;
  const a = cf && Math.hypot(ac.pos.x - cf.x, ac.pos.z - cf.z) < 45000 ? cf : pickNav(ac.pos.x, ac.pos.z, S.nav && airportById(S.nav.id), S.dest);
  const dir = landingDir(w);
  if (!S.nav || S.nav.id !== a.id || S.nav.dir !== dir) {
    S.nav = navFor(a, w);
    setNavField(S.nav);
  }
}

/** The HUD's glide-path pill: the main field's own lights there, the field's own sums anywhere else. */
function navPapi(pos, mainHint) {
  const nf = navField();
  if (!nf || !active()) return mainHint;
  if (nf.id === departure().id && nf.dir > 0) return mainHint;
  return papiFor(nf, pos).hint;
}

/* ------------------------------------------------------------------ */
/* Sim rate: 1x, 2x, 4x in a steady cruise                             */
/* ------------------------------------------------------------------ */

/**
 * Why the sim rate cannot be raised now ('' when it can). The rule is
 * "only when nothing is happening": the autopilot flying a cruise, well
 * clear of the ground, nothing lit on the warning panel, not on the way in
 * to land, solo. Any of those changing drops it straight back to 1x.
 */
export function warpBlocked(sim) {
  const ac = sim.aircraft;
  if (!active() || !ac) return 'Only on the World Map';
  if (sim.mode !== 'free') return 'Free Flight only';
  if (sim.state !== 'flying') return 'Only while flying';
  if (sim.multiplayer && sim.multiplayer.active) return 'Not in a game with friends';
  if (ac.crashed || ac.onGround) return 'Only in the air';
  if (!sim.autopilot || !sim.autopilot.engaged) return 'Engage the autopilot first';
  if (sim.autopilot.mode === 'approach') return 'Not on an approach';
  if (sim.instrumentBlackout > 0 || sim.bracing) return 'Not in an emergency';
  const r = ac.readouts();
  if (r.aglFt < 3000) return 'Climb above 3,000 ft over the ground';
  if (S.far && S.far.noWarp(ac)) return 'Not this far out';
  if (Math.abs(r.vsFpm) > 1500) return 'Level off or settle the climb first';
  if (sim.warnings && typeof sim.warnings.active === 'function' && sim.warnings.active().length) return 'A warning is showing';
  if (typeof ac.fuelFraction === 'function' && ac.fuelFraction() < 0.1) return 'Fuel is low';
  if (S.dest && Math.hypot(ac.pos.x - S.dest.x, ac.pos.z - S.dest.z) < 25000) return 'Nearly there: on the way in';
  return '';
}

/** The rate the cruise can take: no more than WARP_MAX_MS of ground a real second. */
function warpCap(sim) {
  const ac = sim.aircraft;
  const gs = ac && ac.groundSpeed ? ac.groundSpeed : 0;
  let k = WARP_STEPS[WARP_STEPS.length - 1];
  while (k > 1 && gs * k > WARP_MAX_MS) k /= 2;
  return k;
}

function setWarp(sim, k, why) {
  const was = S.warp.k;
  S.warp.k = k;
  if (k === 1) S.warp.want = 1;
  S.warp.why = why || '';
  if (sim) sim.timeScale = k > 1 ? k : 1;
  if (sim && was > 1 && k === 1 && why && sim.hud) sim.hud.notify(`Sim rate back to 1x — ${why.charAt(0).toLowerCase()}${why.slice(1)}`, 'info', 3);
  syncWarpButton(sim);
}

/** The key and the button: the next rate up, round to 1x. */
export function cycleWarp(sim) {
  const why = warpBlocked(sim);
  if (why && S.warp.k === 1) {
    sim.hud && sim.hud.notify(`Sim rate stays at 1x — ${why.charAt(0).toLowerCase()}${why.slice(1)}`, 'info', 3);
    syncWarpButton(sim);
    return 1;
  }
  const i = WARP_STEPS.indexOf(S.warp.want);
  const next = WARP_STEPS[(i + 1) % WARP_STEPS.length];
  S.warp.want = next;
  const k = Math.min(next, warpCap(sim));
  setWarp(sim, k, '');
  if (sim.hud) sim.hud.notify(k > 1 ? `Sim rate ${k}x — any warning, the approach or the ground puts it back to 1x` : 'Sim rate 1x', 'info', 3);
  return k;
}

function updateWarp(sim) {
  if (S.warp.k === 1 && S.warp.want === 1) return;
  const why = warpBlocked(sim);
  if (why) return setWarp(sim, 1, why);
  const k = Math.min(S.warp.want, warpCap(sim));
  if (k !== S.warp.k) setWarp(sim, k, '');
}

function syncWarpButton(sim) {
  const b = S.ui && S.ui.card && S.ui.card.querySelector('[data-wp-warp]');
  if (!b) return;
  const txt = `${S.warp.k}x`;
  const lab = b.querySelector('.wp-rate');
  if (lab && lab.textContent !== txt) lab.textContent = txt;
  b.setAttribute('aria-pressed', String(S.warp.k > 1));
  const blocked = sim ? warpBlocked(sim) : '';
  b.title = S.warp.k > 1 ? `Sim rate ${S.warp.k}x (tap for the next)` : blocked ? `Sim rate 1x — ${blocked}` : 'Sim rate: tap for 2x';
  b.classList.toggle('is-off', !!blocked && S.warp.k === 1);
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const CSS = `
.wp-card { position: relative; border: 1px solid var(--accent, #4aa3ff); }
.wp-card .wp-badge { position: absolute; top: 10px; left: 10px; font: 700 11px/1 var(--font, system-ui), sans-serif; letter-spacing: 0.08em;
  padding: 5px 8px; border-radius: 6px; background: #ffd166; color: #23180a; }
.wp-card .wp-art canvas { width: 100%; height: 100%; display: block; border-radius: inherit; }
.wp-picks { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 2px; }
.wp-picks button { display: flex; justify-content: space-between; gap: 10px; align-items: center; min-height: 44px; padding: 8px 12px;
  border-radius: 10px; border: 1px solid var(--panel-line, rgba(255,255,255,0.18)); background: rgba(255,255,255,0.05); color: inherit;
  font: 600 13px var(--font, system-ui), sans-serif; text-align: left; cursor: pointer; }
.wp-picks button em { font-style: normal; opacity: 0.7; font-weight: 500; white-space: nowrap; }
.wp-picks button[aria-checked="true"] { border-color: var(--accent, #4aa3ff); background: rgba(74,163,255,0.16); }
.wp-picks button:focus-visible { outline: 2px solid var(--accent, #4aa3ff); outline-offset: 2px; }
.wp-hudcard { display: flex; align-items: center; gap: 8px; align-self: flex-end; pointer-events: auto; font: 600 13px var(--font, system-ui), sans-serif; color: #fff; }
.wp-hudcard button { min-height: 36px; min-width: 44px; padding: 6px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22);
  background: rgba(12,20,32,0.72); color: #fff; font: inherit; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
html.is-touch-device .wp-hudcard button { min-height: 44px; }
.wp-hudcard .wp-destline { padding: 6px 10px; border-radius: 10px; background: rgba(12,20,32,0.62); font-variant-numeric: tabular-nums; }
.wp-hudcard.is-chip .wp-destline, .wp-hudcard.is-chip .wp-word { display: none; }
.wp-hudcard[hidden], .wp-hudcard .wp-destline[hidden] { display: none !important; }
.wp-hudcard .wp-warp[aria-pressed="true"] { border-color: #ffd166; color: #ffd166; }
.wp-hudcard .wp-warp.is-off { opacity: 0.6; }
.wp-hudcard .wp-rate { font-variant-numeric: tabular-nums; min-width: 2ch; }
.wp-pin { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; margin: 10px 0 0; }
.wp-pin button { min-height: 44px; min-width: 44px; padding: 8px 12px; border-radius: 10px; border: 1px solid var(--panel-line, rgba(255,255,255,0.18));
  background: rgba(255,255,255,0.05); color: inherit; font: 600 13px var(--font, system-ui), sans-serif; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.wp-pin button[data-wp-pinopen] { flex: 1; }
.wp-pin button[hidden], .wp-pin .wp-pinline[hidden] { display: none; }
.wp-pin button:focus-visible { outline: 2px solid var(--accent, #4aa3ff); outline-offset: 2px; }
.wp-pin.is-on button[data-wp-pinopen] { border-color: var(--accent, #4aa3ff); background: rgba(74,163,255,0.16); }
.wp-pin .wp-pinline { flex-basis: 100%; margin: 0; font-size: 13px; }
.wp-picks h4 { margin: 8px 0 0; font: 700 11px/1.2 var(--font, system-ui), sans-serif; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.7; }
.wp-picks { max-height: 320px; overflow: auto; }
  font: 500 14px var(--font, system-ui), sans-serif; pointer-events: auto; }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('wp-style')) return;
  const st = document.createElement('style');
  st.id = 'wp-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* The card in the map picker                                          */
/* ------------------------------------------------------------------ */

function fmtM(m) {
  return `${Math.round(m).toLocaleString('en-GB')} m`;
}

/** A painted sketch of the sea for the card: islands, fields, the long haul. */
function drawSketch(cv) {
  const g = cv.getContext && cv.getContext('2d');
  if (!g || !g.fillRect) return;
  const W = cv.width;
  const H = cv.height;
  const box = chartBox();
  const sx = W / (box.x1 - box.x0);
  const sz = H / (box.z1 - box.z0);
  const s = Math.min(sx, sz);
  const ox = (W - (box.x1 - box.x0) * s) / 2;
  const oz = (H - (box.z1 - box.z0) * s) / 2;
  const X = (x) => ox + (x - box.x0) * s;
  const Z = (z) => oz + (z - box.z0) * s;
  const sea = g.createLinearGradient ? g.createLinearGradient(0, 0, 0, H) : null;
  if (sea && sea.addColorStop) {
    sea.addColorStop(0, '#2f78a6');
    sea.addColorStop(1, '#174a72');
    g.fillStyle = sea;
  } else g.fillStyle = '#245f8a';
  g.fillRect(0, 0, W, H);
  for (const i of PREVIEW.islands) {
    g.fillStyle = i.profile === 'flat' ? '#d9cf9c' : i.profile === 'cone' ? '#8a7a6a' : '#6f9a54';
    g.beginPath();
    g.arc(X(i.cx), Z(i.cz), Math.max(1.5, i.radius * s * 0.9), 0, Math.PI * 2);
    g.fill();
  }
  const A = PREVIEW.airports;
  g.font = '600 10px "Jost", Arial, sans-serif';
  for (const a of A) {
    g.fillStyle = '#1b1f24';
    g.fillRect(X(a.x) - 3, Z(a.z) - 1.5, 6, 3);
  }
  g.fillStyle = 'rgba(255,255,255,0.85)';
  for (const r of PREVIEW.regions || []) g.fillText(r.name.replace(/^The /, ''), X(r.cx) - 24, Z(r.cz) - 8);
}

function buildCard(sim) {
  const menus = sim.menus;
  const screen = menus && menus.screens && menus.screens.maps;
  if (!screen || screen.querySelector('[data-world-preview-card]')) return null;
  const grid = screen.querySelector('.map-grid');
  if (!grid) return null;
  injectStyle();
  const st = store();
  S.pick = st.start || HUB_ID;
  const card = document.createElement('article');
  card.className = 'map-card wp-card';
  card.setAttribute('data-world-preview-card', '');
  const picks = byRegion().map(({ region, airports }) => `<h4>${region.name}</h4>` + airports.map((a) => `<button type="button" role="radio" data-wp-pick="${a.id}" data-wp-region="${region.id}" aria-checked="${a.id === S.pick}">
      <span>${a.code} · ${a.name}</span><em>${kindWord(a)} · ${fmtM(a.length)}${st.visited.includes(a.id) ? ' · visited' : ''}</em></button>`).join('')).join('');
  card.innerHTML = `
    <div class="map-art wp-art" aria-hidden="true"><canvas width="360" height="200"></canvas><span class="wp-badge">PREVIEW</span></div>
    <div class="map-text">
      <h3>${WORLD_PREVIEW_TITLE}</h3>
      <span class="map-sub">One 200 km sea · ${(PREVIEW.regions || []).length} regions · ${AIRPORTS.length} airports · ${PREVIEW.islands.length} islands</span>
      <span class="map-diff diff-2">●●○○○ Open sea</span>
      <p>${previewDef().blurb} The longest leg, ${longestLeg()}, is a proper long haul.</p>
      <div class="wp-pin">
        <button type="button" data-wp-pinopen>${icon('map', 16)}<span>Pick any spot on the map</span></button>
        <button type="button" data-wp-pinclear hidden>Remove pin</button>
        <p class="wp-pinline" data-wp-pinline role="status" hidden></p>
      </div>
      <div class="wp-picks" role="radiogroup" aria-label="Start at">${picks}</div>
    </div>
    <div class="map-foot">
      <span class="map-current" data-wp-current hidden>Currently flying here</span>
      <button class="primary" type="button" data-wp-fly>Fly here</button>
    </div>`;
  grid.insertBefore(card, grid.firstChild);
  drawSketch(card.querySelector('canvas'));
  card.addEventListener('click', (e) => {
    const p = e.target.closest('[data-wp-pick]');
    if (p) {
      S.pick = p.dataset.wpPick;
      store().start = S.pick;
      writeStore(store());
      setPin(null);
      return;
    }
    if (e.target.closest('[data-wp-pinopen]')) {
      openPinMap(sim, e.target.closest('[data-wp-pinopen]'));
      return;
    }
    if (e.target.closest('[data-wp-pinclear]')) {
      setPin(null);
      return;
    }
    if (e.target.closest('[data-wp-fly]')) {
      menus.hooks && menus.hooks.onClick && menus.hooks.onClick('map');
      if (S.pin) flyToPin(sim);
      else choosePreview(sim, S.pick);
    }
  });
  card.addEventListener('keydown', (e) => {
    const p = e.target.closest && e.target.closest('[data-wp-pick]');
    if (!p || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const all = [...card.querySelectorAll('[data-wp-pick]')];
    const i = all.indexOf(p) + (e.key === 'ArrowDown' ? 1 : -1);
    const next = all[(i + all.length) % all.length];
    next.focus();
    next.click();
    e.preventDefault();
  });
  return card;
}

/** The pin on the card: the line that says where it is, and no field picked while it is down. */
function setPin(pin) {
  const moved = (pin && pin.x) !== (S.pin && S.pin.x) || (pin && pin.z) !== (S.pin && S.pin.z);
  S.pin = pin;
  // Kept with the settings, so that Reset all takes it too. Only a pin that moved: the ground's answer comes after.
  if (moved && S.sim && S.sim.settings) {
    S.sim.settings.worldPin = pin ? { x: pin.x, z: pin.z, zone: pin.zone || null } : null;
    saveSettings(S.sim.settings);
  }
  const card = S.ui && S.ui.mapCard;
  if (!card) return;
  for (const b of card.querySelectorAll('[data-wp-pick]')) b.setAttribute('aria-checked', String(!pin && b.dataset.wpPick === S.pick));
  const line = card.querySelector('[data-wp-pinline]');
  line.hidden = !pin;
  line.textContent = pin ? `Your pin: ${pinWords(pin.x, pin.z, pin.h, pin.zone).short}` : '';
  card.querySelector('.wp-pin').classList.toggle('is-on', !!pin);
  card.querySelector('[data-wp-pinclear]').hidden = !pin;
  card.querySelector('[data-wp-pinopen] span').textContent = pin ? 'Move the pin' : 'Pick any spot on the map';
}

/** The pin's map: fetched the first time it is opened (features/wm-pin.js). */
let PIN_MOD = null;
function openPinMap(sim, opener) {
  if (!PIN_MOD) PIN_MOD = import('./wm-pin.js');
  PIN_MOD.then((m) => {
    if (S.ui.pinMap) return;
    S.ui.pinMap = m.openPinMap({
      quality: sim.settings.quality,
      pin: S.pin,
      onPin: setPin,
      onFly: () => flyToPin(sim),
      onClose: () => {
        S.ui.pinMap = null;
        if (opener && opener.isConnected) opener.focus();
      },
    });
  }).catch((e) => {
    console.warn('[world-preview] the pin map did not load', e);
    PIN_MOD = null;
    sim.hud && sim.hud.notify('The map did not load. Please try again.', 'warn', 4);
  });
}

/** The fields in the picker's order, under their regions. */
export function byRegion() {
  const regions = PREVIEW.regions || [{ id: 'all', name: 'Airports' }];
  return regions.map((region) => ({ region, airports: AIRPORTS.filter((a) => (a.region || 'all') === region.id) })).filter((g) => g.airports.length);
}

function kindWord(a) {
  if (a.kind === 'hub') return 'International';
  if (a.kind === 'regional') return 'Regional';
  if (a.kind === 'remote') return 'Long-haul outpost';
  return a.surface === 'grass' ? 'Grass strip' : a.surface === 'gravel' ? 'Gravel strip' : 'Strip';
}

function longestLeg() {
  let best = null;
  for (let i = 0; i < AIRPORTS.length; i++) {
    for (let j = i + 1; j < AIRPORTS.length; j++) {
      const d = legM(AIRPORTS[i], AIRPORTS[j]);
      if (!best || d > best.d) best = { d, a: AIRPORTS[i], b: AIRPORTS[j] };
    }
  }
  return best ? `${best.a.code}–${best.b.code} at ${Math.round(best.d / 1000)} km` : '';
}

/** Show the card only to games that fly. */
function syncCardForGame(sim) {
  const card = S.ui && S.ui.mapCard;
  if (!card) return;
  const g = sim.game || 'flight';
  card.hidden = !(g === 'flight' || g === 'heli');
  const on = active() || waits(sim);
  const cur = card.querySelector('[data-wp-current]');
  if (cur) {
    cur.hidden = !on;
    cur.textContent = active() ? 'Currently flying here' : 'Your map: it loads when you fly';
  }
  card.classList.toggle('is-current', on);
}

/** Is the World Map the choice on the menu, remembered and not built yet? */
function waits(sim) {
  return sim.waitingMap === WORLD_PREVIEW_ID && (sim.game === 'flight' || sim.game === 'heli');
}

/** A pin kept from last time, if it is still a pair of numbers. */
function savedPin(sim) {
  const p = sim.settings && sim.settings.worldPin;
  return p && Number.isFinite(p.x) && Number.isFinite(p.z) ? { x: p.x, z: p.z, h: null, zone: typeof p.zone === 'string' ? p.zone : null } : null;
}

/* ------------------------------------------------------------------ */
/* The HUD card and the pause-screen button                            */
/* ------------------------------------------------------------------ */

function hudCard(sim) {
  if (S.ui && S.ui.card) return S.ui.card;
  injectStyle();
  const el = document.createElement('div');
  el.className = 'wp-hudcard';
  el.hidden = true;
  el.innerHTML = `<button type="button" class="wp-mapchip" data-wp-map aria-label="World map">${icon('map', 16)}<span class="wp-word">Map</span></button>`
    + `<button type="button" class="wp-warp" data-wp-warp aria-label="Sim rate" aria-pressed="false"><span class="wp-word">Rate</span><span class="wp-rate">1x</span></button>`
    + '<span class="wp-destline" hidden></span>';
  el.querySelector('[data-wp-map]').addEventListener('click', () => openMap(sim));
  el.querySelector('[data-wp-warp]').addEventListener('click', () => cycleWarp(sim));
  const stack = sim.hud && sim.hud.stack;
  if (stack && typeof stack.add === 'function') stack.add(el, { prio: 3.2, id: 'world-preview', info: true });
  else extLayer().appendChild(el);
  S.ui = S.ui || {};
  S.ui.card = el;
  return el;
}

let lastCardText = '';
function syncCard(sim) {
  const el = hudCard(sim);
  const on = active() && sim.state === 'flying';
  if (el.hidden === on) el.hidden = !on;
  const line = el.querySelector('.wp-destline');
  let text = '';
  if (on && S.dest && sim.aircraft) {
    const d = Math.hypot(sim.aircraft.pos.x - S.dest.x, sim.aircraft.pos.z - S.dest.z);
    text = `→ ${S.dest.code} ${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km · ${Math.max(1, Math.round(etaMin(sim, d)))} min`;
  }
  if (text !== lastCardText) {
    lastCardText = text;
    line.textContent = text;
    line.hidden = !text;
    if (text && sim.hud && sim.hud.stack && sim.hud.stack.poke && !syncCard._poked) {
      sim.hud.stack.poke(el, 4);
      syncCard._poked = true;
    }
    if (!text) syncCard._poked = false;
  }
}

function pauseButton(sim) {
  const pause = sim.menus && sim.menus.screens && sim.menus.screens.pause;
  if (!pause) return null;
  let b = pause.querySelector('[data-wp-open]');
  if (b) return b;
  if (!sim.menus.addPauseItem) return null;
  const item = sim.menus.addPauseItem('world-map', { group: 'flight',
    html: `<button type="button" data-wp-open>${icon('map', 18)}<span>World map</span></button>` });
  item.hidden = true;
  b = item.querySelector('[data-wp-open]');
  b.addEventListener('click', () => openMap(sim));
  return b;
}

/* ------------------------------------------------------------------ */
/* The world map: the live map's (features/livemap/livemap.js)          */
/* ------------------------------------------------------------------ */

/** Open the full-screen live map. It never pauses: the flight carries on behind it. */
export function openMap(sim) {
  if (!active() || !sim.liveMap) return false;
  return sim.liveMap.open();
}

export function closeMap(sim) {
  if (sim && sim.liveMap) sim.liveMap.close();
}

/* ------------------------------------------------------------------ */
/* The menus' "Now flying" line                                        */
/* ------------------------------------------------------------------ */

function wrapSyncMap(sim) {
  const menus = sim.menus;
  if (!menus || menus._wpSync || typeof menus.syncMap !== 'function') return;
  const orig = menus.syncMap.bind(menus);
  menus._wpSync = true;
  menus.syncMap = function (asked) {
    const waiting = waits(sim);
    const id = waiting ? WORLD_PREVIEW_ID : asked;
    const out = orig(id);
    if (id === WORLD_PREVIEW_ID) {
      const dep = (waiting && airportById(S.pick)) || departure();
      for (const el of menus.root.querySelectorAll('[data-map-name]')) el.textContent = WORLD_PREVIEW_TITLE;
      for (const el of menus.root.querySelectorAll('[data-map-blurb]')) el.textContent = `Now flying ${WORLD_PREVIEW_TITLE} — from ${dep.code} ${dep.name}`;
    }
    syncCardForGame(sim);
    return out;
  };
  // Restart comes back to the pin, and the debrief's button should say so.
  const debrief = menus.showDebrief.bind(menus);
  menus.showDebrief = (o) => debrief(pinFlight(sim) ? { ...o, actions: o.actions.map((a) => (a.label === 'Reset on the runway' ? { ...a, label: 'Back to your pin' } : a)) } : o);
  const show = menus.show && menus.show.bind(menus);
  if (show) {
    menus.show = function (name, ...rest) {
      const out = show(name, ...rest);
      if (name === 'maps') {
        if (!S.ui || !S.ui.mapCard || !S.ui.mapCard.isConnected) {
          S.ui = S.ui || {};
          S.ui.mapCard = buildCard(sim) || (menus.screens.maps && menus.screens.maps.querySelector('[data-world-preview-card]'));
        }
        syncCardForGame(sim);
      }
      if (name === 'pause') {
        const b = pauseButton(sim);
        if (b) b.parentNode.hidden = !active();
      }
      return out;
    };
  }
}

/* ------------------------------------------------------------------ */
/* The extension                                                        */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'world-preview',
  install(sim) {
    S.sim = sim;
    wrapSyncMap(sim);
    quietPinStart(sim);
    S.ui = S.ui || {};
    S.ui.mapCard = buildCard(sim);
    setPin(savedPin(sim));
    // The menu says the map you chose, not the one standing in for it.
    if (waits(sim)) sim.menus.syncMap(WORLD_PREVIEW_ID);
    syncCardForGame(sim);
    /*
     * No instructor on the World Map (owner, Oct 26: "remove instructor from
     * worldmap"). The coach line ("Hold Shift for full power", "Follow the
     * PAPI lights", the carrier's own hints) is the tutorial voice; the
     * preview is for flying where you like. The warnings (features/
     * warnings.js), the tower and the approach calls are not the coach and
     * stay. The regular maps keep it exactly as it was.
     */
    muteCoach(sim);
    // The guidance: the runner's target when a mission names one, otherwise the trip's.
    const R = sim.runner;
    if (R && typeof R.activeTarget === 'function' && !R._wpWrapped) {
      const orig = R.activeTarget.bind(R);
      R._wpWrapped = true;
      R.activeTarget = () => orig() || worldTarget(sim);
    }
    setTownPlanner(planWorldTown);
    sim.worldPreview = {
      id: WORLD_PREVIEW_ID,
      active,
      stats: () => (S.stream ? S.stream.stats() : null),
      built: () => S.builtFor,
      choose: (id) => choosePreview(sim, id),
      whenBuilt,
      openMap: () => openMap(sim),
      closeMap: () => closeMap(sim),
      setDestination: (id) => setDestination(sim, id),
      destination: () => S.dest,
      airports: () => AIRPORTS,
      outstations: () => S.out,
      dressing: () => S.dressing,
      waters: () => S.waters,
      network: () => S.network,
      props: () => S.props,
      /** How many carrier symbols the open world map drew. */
      mapShips: () => (S.overlay ? S.overlay.ships || 0 : 0),
      stream: () => S.stream,
      visited: () => store().visited.slice(),
      pin: () => S.pin,
      setPin: (p) => {
        const c = p ? clampTo(p.x, p.z) : null;
        setPin(c ? { ...c, h: p.h ?? null, zone: S.ring ? S.ring.zoneOf(c.x, c.z) : null } : null);
      },
      flyToPin: () => flyToPin(sim),
      flyChosen: (cfg) => flyChosen(sim, cfg),
      /** The Dev console's /tp: a field by id, a spot (x, z metres), Nullspire. */
      tpField: (id) => tpField(sim, id),
      tpSpot: (x, z) => tpSpot(sim, x, z),
      tpCity: () => teleportToCity(sim),
      takesOffToPin,
      /** The start the last pin gave (the tests). */
      lastStart: () => S.lastStart || null,
      groundDrawn,
      /** The pin's map, once it is open (the tests). */
      pinMap: () => (S.ui && S.ui.pinMap) || null,
      horizon: () => S.horizon,
      flora: () => S.flora,
      cards: () => S.cards,
      towns3d: () => S.towns,
      navField: () => navField(),
      warp: () => ({ ...S.warp, blocked: warpBlocked(sim), scale: sim.timeScale || 1 }),
      cycleWarp: () => cycleWarp(sim),
      regions: () => PREVIEW.regions,
      prewarmed: () => S.prewarm || null,
      /** The carrier as seen from a camera at `pos` (the tests): which of the ship and the far ship is drawn. */
      carrierFrom: (pos) => {
        farCarrier(sim, pos);
        const far = S.carrierProxy;
        return { ship: !!(sim.carrier && sim.carrier.group.visible), far: !!(far && far.visible), far3d: far || null };
      },
      /** The ring past the sea (features/farlands-run.js), or null if it has not loaded. */
      farlands: () => S.far,
      /** Nullspire: where it is (null until the ring has loaded), and the dev teleport to its runway. */
      city: () => (S.ring ? { ...S.ring.CITY, field: S.ring.CITY_FIELD, look: S.far ? S.far.city : null } : null),
      teleportToCity: () => teleportToCity(sim),
      /** The traffic between the fields (features/world-traffic.js), or null before it has loaded. */
      traffic: () => S.traffic || null,
      whenTraffic: () => (TRAFFIC_MOD || Promise.resolve(null)).then(() => S.traffic || null),
      perf: (reset = false) => {
        const p = { ...S.perf, mean: S.perf.frames ? S.perf.total / S.perf.frames : 0 };
        if (reset) S.perf = { frames: 0, total: 0, max: 0, over4: 0, over8: 0 };
        return p;
      },
    };
  },
  buildWorld(sim, group) {
    buildWorld(sim, group);
  },
  buildWorldSteps,
  startMode(sim, mode, opts) {
    // Outermost again, in case another feature (carrier-ops) wrapped the coach after us.
    muteCoach(sim);
    setTowers(sim);
    if (!active()) {
      S.dest = null;
      S.pinDest = null;
      return;
    }
    const pinned = !!sim.aircraft && pinFlight(sim);
    // The field a pin gave the last flight is not this flight's (a destination you set yourself stays).
    if (!pinned && S.dest && S.dest === S.pinDest) S.dest = null;
    S.pinDest = null;
    if (pinned) startAtPin(sim, opts);
    // The dev workbench's teleport: on a long final for Nullspire's 09 (startAtCity).
    else if (mode === 'free' && opts && opts.city && sim.aircraft && S.ring) startAtCity(sim, opts);
    // Free Flight's airborne start is written 3.4 km west of Kestrel's runway;
    // here it is 3.4 km west of the runway you chose to start from.
    else if (mode === 'free' && opts && opts.airborne && sim.aircraft) {
      const ac = sim.aircraft;
      const want = new THREE.Vector3(RUNWAY.cx - RUNWAY.length / 2 - 2850, 0, RUNWAY.cz + 300);
      if (Math.hypot(ac.pos.x - want.x, ac.pos.z - want.z) > 500) {
        ac.reset({ pos: want, headingDeg: 90, speed: 60, altAGL: 610, engineOn: true, fuel: opts.fuel != null ? Math.max(0.05, Math.min(1, opts.fuel)) : 1 });
        ac.controls.throttle = 0.7;
        if (sim.input) sim.input.throttleTarget = 0.7;
      }
    }
    if (!pinned && S.stream && sim.aircraft) S.stream.prime(sim.aircraft.pos.x, sim.aircraft.pos.y, sim.aircraft.pos.z, 500);
    if (S.far) S.far.start();
    // The field you start at is the radio's from the first call.
    S.nav = null;
    updateNav(sim);
    setWarp(sim, 1, '');
    syncCard(sim);
    // The sky, filled again round where this flight starts.
    if (S.traffic) S.traffic.start();
  },
  stop(sim, why) {
    closeMap(sim);
    setWarp(sim, 1, '');
    syncCard(sim);
    // "Return to the airfield" carries the same flight on: the traffic too.
    if (S.traffic && why !== 'airport') S.traffic.stop();
  },
  update(sim, dt) {
    if (!active()) {
      if (S.ui && S.ui.card && !S.ui.card.hidden) S.ui.card.hidden = true;
      return;
    }
    const cam = sim.camera && sim.camera.position;
    const w0 = performance.now();
    if (S.stream && cam) S.stream.update(dt, cam.x, cam.y, cam.z);
    if (S.horizon && cam) S.horizon.update(cam, 1.2);
    if (S.far) S.far.update();
    if (S.flora && cam) S.flora.update(cam, sim.state === 'flying' ? sim.aircraft : null, 1.2);
    if (S.cards && cam) S.cards.update(cam, null, 0.8);
    if (S.towns && cam) S.towns.update(cam, sim.state === 'flying' ? sim.aircraft : null, 0.8);
    if (S.props && cam) S.props.update(cam, dt);
    if (S.out) S.out.update(dt, sim.weather, cam);
    if (S.towns && S.out) S.towns.setGlow(Math.max(0, S.out.glow));
    if (S.dressing && S.dressing.userData.lights) {
      const w = sim.weather;
      S.dressing.userData.lights.visible = !!(w && (w.isNight || w.time === 'sunset' || w.time === 'dusk'));
    }
    if (cam) farCarrier(sim, cam);
    // What the world's own streaming cost this frame (the tests and the dev overlay).
    const w = performance.now() - w0;
    S.perf.frames++;
    S.perf.total += w;
    if (w > S.perf.max) S.perf.max = w;
    if (w > 4) S.perf.over4++;
    if (w > 8) S.perf.over8++;
    updateNav(sim);
    updateWarp(sim);
    if (sim.mode === 'free') checkArrival(sim, dt);
    syncCard(sim);
    if (S.traffic) S.traffic.update(dt);
  },
  key(sim, code, down) {
    if (down && active() && isKey(sim, 'timeWarp', code)) {
      // 6 is the airlifters' cargo ramp too; in an airlifter the ramp has it (the button still works).
      if (sim.aircraftType && sim.aircraftType.cargoRamp) return false;
      cycleWarp(sim);
      return true;
    }
    return false;
  },
  devActions: [
    { label: 'World preview: tile stats', hint: 'Streamed terrain numbers in the console', run: () => console.info('[world-preview]', S.stream && S.stream.stats()) },
    { label: 'Teleport to Nullspire', hint: 'A long final for the hidden city\'s runway, 100 km out in the void (World Map; builds it first if need be)', run: (sim) => { teleportToCity(sim); } },
  ],
});

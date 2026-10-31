/**
 * World Map — Preview: the card in the map picker, the streamed ground, the
 * other airports, the world map, and a destination you can fly to.
 *
 * Nothing here runs unless the player picks the preview's card. It is not in
 * MAPS (world/maps.js registerExtraMap): the flight game still offers its own
 * maps, the lobbies still index the roster, and a saved id naming the preview
 * boots the default map like any unknown id (maps-retired.js). See
 * world/worldmap/preview.js for how the sea fits in one frame and why the
 * ground is the same whichever field you start from.
 *
 *   The card    top of "Choose your map", marked PREVIEW: the five fields as a
 *               start picker (the field you start from is the full airport —
 *               terminal, stands, tower, ATC — and the others are drawn by
 *               worldmap/outstation.js), and Fly here.
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
  nearestAirport, headingTo, legM, HUB_ID,
} from '../world/worldmap/preview.js';
import { TerrainStream, tierFor as streamTier, cardWorker, initWorker } from '../world/worldmap/stream.js';
import { buildOutstations, pavedTest, towerLens, buildDressing } from '../world/worldmap/outstation.js';
import { carrierProxyGeometry } from '../world/worldmap/field-look.js';
import { Horizon } from '../world/worldmap/horizon.js';
import { Flora, floraContext } from '../world/worldmap/flora.js';
import { makeWorldTerrainMaterial } from '../world/worldmap/world-terrain.js';
import { buildWaters } from '../world/worldmap/waters.js';
import { buildNetworkLook } from '../world/worldmap/network-look.js';
import { Props, placeProps, PROP_MODELS } from '../world/worldmap/props.js';
import { parseGLB } from '../vehicles/glb.js';

/** The CC0 scenery models (worldmap/props.js), fetched once a session: name -> geometry (null if it would not load). */
let PROP_GEOS = null;
function propModels() {
  if (PROP_GEOS) return PROP_GEOS;
  PROP_GEOS = Promise.all(PROP_MODELS.map((n) => fetch(new URL(`../../assets/models/scenery/${n}.glb`, import.meta.url).href)
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
import { cardGeometry, cardMaterial } from '../world/worldmap/tree-cards.js';

/** The tree cards' reach and density per tier: Low keeps a small, light patch round the camera. */
export const CARD_TIERS = Object.freeze({
  // Low: none — the Chromebooks' frame time (the forest floor's own colour and the real trees carry the woods there).
  low: Object.freeze({ radius: 0, perCell: 0, shadows: false }),
  medium: Object.freeze({ radius: 1200, perCell: 1600, shadows: false }),
  high: Object.freeze({ radius: 1800, perCell: 2400, shadows: false }),
  ultra: Object.freeze({ radius: 2600, perCell: 3200, shadows: false }),
});
import { treeGeometry } from '../world/scenery.js';
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
  if (sim.menus && sim.menus.hooks && typeof sim.menus.hooks.chooseMap === 'function') return sim.menus.hooks.chooseMap(WORLD_PREVIEW_ID);
  return sim.setMap(WORLD_PREVIEW_ID);
}

/** Resolves once the preview's world has been built (for "Fly now" and the tests). */
export function whenBuilt() {
  return new Promise((res) => S.onBuilt.push(res));
}

/* ------------------------------------------------------------------ */
/* The world                                                           */
/* ------------------------------------------------------------------ */

function teardown(sim) {
  if (S.stream) S.stream.dispose();
  if (S.horizon) S.horizon.dispose();
  if (S.flora) S.flora.dispose();
  if (S.cards) S.cards.dispose();
  if (S.props) S.props.dispose();
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

/** The Tower view: every field's tower here (camera.js towerLens), the start field's balcony anywhere else. */
function setTowers(sim) {
  if (sim && sim.rig) sim.rig.towers = active() ? PREVIEW.airports.map(towerLens).filter(Boolean) : null;
}

function buildWorld(sim, group) {
  teardown(sim);
  setTowers(sim);
  if (!active()) return;
  const q = sim.settings.quality || 'medium';
  const t0 = performance.now();
  // terrain.js's ground with the land cover painted on (worldmap/world-terrain.js).
  const mat = makeWorldTerrainMaterial(q);
  const fctx = floraContext(PREVIEW);
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
  // The real scenery models: rocks, boulders, quiver trees, piers, poles (worldmap/props.js).
  S.props = new Props({ placed: placeProps(Terrain, PREVIEW), quality: q });
  group.add(S.props.group);
  const props = S.props;
  propModels().then((list) => {
    if (S.props !== props) return;
    for (const [n, g] of list) props.setModel(n, g);
  });
  S.horizon = new Horizon({ heightAt: Terrain.groundHeightAt, islands: PREVIEW.islands, hideWithin: streamTier(q).range });
  group.add(S.horizon.mesh);
  S.flora = new Flora({
    treeGeometry, ctx: fctx, T: Terrain, worker: S.stream.worker && !S.stream.workerFailed ? S.stream.worker : null, gen: S.stream.gen,
    quality: q, addObstacle: Terrain.addObstacle, obstacles: Terrain.OBSTACLES,
    // When the ground gives up on the shared worker, so do the trees (and plant here instead).
    workerOk: () => !!(S.stream && S.stream.worker && !S.stream.workerFailed),
  });
  group.add(S.flora.group);
  // And the woods between them: tree cards, dense, close in, only in the forests (worldmap/tree-cards.js).
  // On a worker of their own, so a forest's thousands never queue in front of the ground's tiles.
  if (CARD_TIERS[q] && CARD_TIERS[q].radius > 0) {
    const cardMat = cardMaterial();
    const cw = S.stream.worker && !S.stream.workerFailed ? cardWorker() : null;
    const cardsOn = initWorker(cw, S.stream.gen, MAP, fctx);
    S.cards = new Flora({
      treeGeometry, ctx: fctx, T: Terrain, worker: cardsOn ? cw : null, gen: S.stream.gen,
      quality: q, workerOk: () => !!(S.stream && S.stream.worker && !S.stream.workerFailed),
      layer: { id: 'cards', mode: 'cards', tiers: CARD_TIERS, geometry: cardGeometry, material: () => cardMat, solid: false },
    });
    group.add(S.cards.group);
  } else S.cards = null;
  // The ground the first frame needs, now, behind the loading screen.
  const r = RUNWAY;
  S.stream.prime(r.thresholdWest.x + 80, r.elev + 60, r.thresholdWest.z);
  const t1 = performance.now();
  const dep = departure();
  S.out = buildOutstations(PREVIEW, dep.id, q);
  // The field you start from is airport.js's; its own landmarks (the persona's
  // shelters, radomes, silos, lighthouse...: worldmap/personas.js) are these.
  S.dressing = buildDressing(dep, q);
  if (S.dressing) S.out.group.add(S.dressing);
  console.debug(`[wp] ground ${Math.round(t1 - t0)} ms (${S.stream.counts.primed} tiles), other fields and towns ${Math.round(performance.now() - t1)} ms`, S.out.timing || '');
  group.add(S.out.group);
  // The tyres: the main field's layout (airport.js set it) and the other fields' made ground.
  const others = PREVIEW.airports.filter((a) => a.id !== dep.id);
  const outPaved = pavedTest(others);
  setPavedExtra((x, z) => pavedIn(airportLayout(), x, z) || outPaved(x, z));
  // The terrain warning and the minimap know the other fields' runways too,
  // and a landing on one is a landing on a runway (terrain.js isOnAnyRunway).
  setExtraRunways(others.map((a) => ({ cx: a.x, cz: a.z, length: a.length, halfWidth: a.halfWidth })));
  Terrain.setOtherRunways(others.map((a) => ({ cx: a.x, cz: a.z, length: a.length, halfWidth: a.halfWidth })));
  // The landing aids at whichever field you are at (updateNav, every frame).
  sim.navPapi = (pos, mainHint) => navPapi(pos, mainHint);
  prewarm(sim, [S.out.group, S.flora.group, S.cards && S.cards.group, S.horizon.mesh, S.waters, S.network, S.props && S.props.group]);
  S.builtFor = { id: dep.id, quality: q, ms: performance.now() - t0 };
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
export function chartBox() {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const i of PREVIEW.islands) {
    x0 = Math.min(x0, i.cx - i.radius * 1.5); x1 = Math.max(x1, i.cx + i.radius * 1.5);
    z0 = Math.min(z0, i.cz - i.radius * 1.5); z1 = Math.max(z1, i.cz + i.radius * 1.5);
  }
  const pad = 6000;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const half = Math.max(x1 - x0, z1 - z0) / 2 + pad;
  return { x0: cx - half, x1: cx + half, z0: cz - half, z1: cz + half };
}

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
  const a = pickNav(ac.pos.x, ac.pos.z, S.nav && airportById(S.nav.id), S.dest);
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
.wp-hudcard .wp-destline { padding: 6px 10px; border-radius: 10px; background: rgba(12,20,32,0.62); font-variant-numeric: tabular-nums; }
.wp-hudcard.is-chip .wp-destline, .wp-hudcard.is-chip .wp-word { display: none; }
.wp-hudcard[hidden], .wp-hudcard .wp-destline[hidden] { display: none !important; }
.wp-hudcard .wp-warp[aria-pressed="true"] { border-color: #ffd166; color: #ffd166; }
.wp-hudcard .wp-warp.is-off { opacity: 0.6; }
.wp-hudcard .wp-rate { font-variant-numeric: tabular-nums; min-width: 2ch; }
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
  g.font = '600 10px system-ui, sans-serif';
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
      <span class="map-sub">One 400 km sea · ${(PREVIEW.regions || []).length} regions · ${AIRPORTS.length} airports · ${PREVIEW.islands.length} islands</span>
      <span class="map-diff diff-2">●●○○○ Open sea</span>
      <p>${previewDef().blurb} The longest leg, ${longestLeg()}, is a proper long haul.</p>
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
      for (const b of card.querySelectorAll('[data-wp-pick]')) b.setAttribute('aria-checked', String(b.dataset.wpPick === S.pick));
      return;
    }
    if (e.target.closest('[data-wp-fly]')) {
      menus.hooks && menus.hooks.onClick && menus.hooks.onClick('map');
      choosePreview(sim, S.pick);
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
  const cur = card.querySelector('[data-wp-current]');
  if (cur) cur.hidden = !active();
  card.classList.toggle('is-current', active());
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
  const row = pause.querySelector('.pause-actions');
  if (!row) return null;
  b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('data-wp-open', '');
  b.innerHTML = `${icon('map', 18)}<span>World map</span>`;
  b.hidden = true;
  b.addEventListener('click', () => openMap(sim));
  row.insertBefore(b, row.children[1] || null);
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
  menus.syncMap = function (id) {
    const out = orig(id);
    if (id === WORLD_PREVIEW_ID) {
      const dep = departure();
      for (const el of menus.root.querySelectorAll('[data-map-name]')) el.textContent = WORLD_PREVIEW_TITLE;
      for (const el of menus.root.querySelectorAll('[data-map-blurb]')) el.textContent = `Now flying ${WORLD_PREVIEW_TITLE} — from ${dep.code} ${dep.name}`;
    }
    syncCardForGame(sim);
    return out;
  };
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
        if (b) b.hidden = !active();
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
    S.ui = S.ui || {};
    S.ui.mapCard = buildCard(sim);
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
      horizon: () => S.horizon,
      flora: () => S.flora,
      cards: () => S.cards,
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
  startMode(sim, mode, opts) {
    // Outermost again, in case another feature (carrier-ops) wrapped the coach after us.
    muteCoach(sim);
    setTowers(sim);
    if (!active()) {
      S.dest = null;
      return;
    }
    // Free Flight's airborne start is written 3.4 km west of Kestrel's runway;
    // here it is 3.4 km west of the runway you chose to start from.
    if (mode === 'free' && opts && opts.airborne && sim.aircraft) {
      const ac = sim.aircraft;
      const want = new THREE.Vector3(RUNWAY.cx - RUNWAY.length / 2 - 2850, 0, RUNWAY.cz + 300);
      if (Math.hypot(ac.pos.x - want.x, ac.pos.z - want.z) > 500) {
        ac.reset({ pos: want, headingDeg: 90, speed: 60, altAGL: 610, engineOn: true, fuel: opts.fuel != null ? Math.max(0.05, Math.min(1, opts.fuel)) : 1 });
        ac.controls.throttle = 0.7;
        if (sim.input) sim.input.throttleTarget = 0.7;
      }
    }
    if (S.stream && sim.aircraft) S.stream.prime(sim.aircraft.pos.x, sim.aircraft.pos.y, sim.aircraft.pos.z, 500);
    // The field you start at is the radio's from the first call.
    S.nav = null;
    updateNav(sim);
    setWarp(sim, 1, '');
    syncCard(sim);
  },
  stop(sim) {
    closeMap(sim);
    setWarp(sim, 1, '');
    syncCard(sim);
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
    if (S.flora && cam) S.flora.update(cam, sim.state === 'flying' ? sim.aircraft : null, 1.2);
    if (S.cards && cam) S.cards.update(cam, null, 0.8);
    if (S.props && cam) S.props.update(cam, dt);
    if (S.out) S.out.update(dt, sim.weather, cam);
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
  ],
});

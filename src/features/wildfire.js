/**
 * WILDFIRE — forest fires you put out from the air.
 *
 * "add forest fires you need to put out in missions for plane/helicopter sim"
 *
 * The fire burns on the ground as a grid of 20 m cells (wildfire/grid.js),
 * grass and forest only, spreading faster downwind and uphill. It is drawn as
 * instanced flames, smoke columns that lean with the wind and thicken the air
 * when you fly through them, embers, blackened ground where it has been, and
 * a glow on the ground that you can see from miles off at night
 * (wildfire/fx.js). What a mission wants from it — the town it must not
 * reach, the crews' line, the clock until the crews arrive — is
 * wildfire/scenario.js, which the node tests fly with a scripted pilot.
 *
 * You fight it with water (wildfire/tank.js). The Skyhook swings a bucket on
 * a long line and fills it in a low hover over the sea; an aeroplane skims
 * the sea with its flaps out to scoop a tank full. X lets it go — but only
 * while a tank or bucket is armed; the rest of the time X is the game's own
 * cargo release and this file never sees it.
 *
 * HOW IT PLUGS IN. Nothing here edits main.js. The missions in
 * game/extra/fire.js call setupFire() from their onStart, which lights the
 * fire and arms the water; this extension's hooks do the rest every frame.
 * Free flight gets a fire from the Dev panel ("Start a wildfire here").
 *
 * WHAT A MISSION CAN READ: fireStatus(sim) — contained, burning, water aboard,
 * drops and hits, whether it reached the town — and fireGuide(sim), a point
 * for the game's own arrow, rails and beacon: the fill point while you are
 * empty and the edge that matters most while you are full.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { MAP } from '../world/terrain.js';
import { FireGrid, FUEL, STATE, CELL } from './wildfire/grid.js';
import { FireScenario, findWater } from './wildfire/scenario.js';
import { makeSampler } from './wildfire/ground.js';
import { Surface } from './wildfire/surface.js';
import { Flames, Plumes, Sparks, Scar, Marker, Break } from './wildfire/fx.js';
import { WaterTank, BucketRig, predictLanding } from './wildfire/tank.js';
import { plantWoods, removeWoods } from './wildfire/woods.js';
import { FireHud, drawOnMinimap } from './wildfire/hud.js';
import { FireAudio } from './wildfire/audio.js';

const FT = 3.28084;
const GRID_SIZE = 320;

/**
 * How much of everything each quality setting can afford. `burning` is the
 * cap on cells alight at once — the promise to the Chromebook, since every
 * other count here follows from it. No mission's fire comes near even the
 * Low cap — the worst, the Big Burn left alone, peaks at 156 cells, and
 * fire.mjs checks every one stays under 520 — so a Low machine plays the
 * same fire as an Ultra one.
 *
 * Measured at the cap, on this development Mac: in the browser, 0.12 ms of
 * frame for 900 burning cells and 900 flames; in node, a median 0.012 ms a
 * frame and 0.2 ms on the one frame in fifteen that runs a spread tick, at
 * the Low cap of 520. A 2019 Chromebook is five to eight times slower. Every
 * system is one draw call: flames, smoke, embers, droplets, scorch, the two
 * markers, the break, and one per tree shape in a planted wood.
 */
const BUDGET = {
  low: { flames: 420, puffs: 110, embers: 90, drops: 360, burning: 520, trees: 900 },
  medium: { flames: 700, puffs: 150, embers: 150, drops: 520, burning: 760, trees: 1500 },
  high: { flames: 900, puffs: 200, embers: 200, drops: 700, burning: 900, trees: 2400 },
  ultra: { flames: 1400, puffs: 300, embers: 320, drops: 900, burning: 1300, trees: 3400 },
};

/* ------------------------------------------------------------------ *
 * The one fire. Module state, because there is one game and one sky.
 * ------------------------------------------------------------------ */
const W = {
  sim: null,
  group: null,
  grid: null,
  sc: null,
  surface: new Surface(),
  flames: null,
  plumes: null,
  embers: null,
  drops: null,
  scar: null,
  aim: null,
  fillMark: null,
  bucket: null,
  tank: null,
  hud: null,
  audio: new FireAudio(),
  budget: BUDGET.high,
  live: false,
  spec: null,
  data: null,
  mapId: null,
  fill: null,
  target: new THREE.Vector3(),
  hasTarget: false,
  guide: new THREE.Vector3(),
  wind: new THREE.Vector3(),
  time: 0,
  filledOnce: false,
  hits: 0,
  pendingDev: false,
  trees: null,
  treeMeshes: null,
  woods: null,
  breakLine: null,
  sources: [],
  srcPool: [],
  emberAcc: 0,
  smokeAt: 0,
  aimT: 0,
  aimGreen: false,
  scarT: 0,
  watch: null,
  flameDirty: true,
  menuNote: null,
  /** This fire is the Wildfire disaster (game/disasters.js), not a mission's. */
  disaster: false,
};

const STATUS = {
  live: false,
  burning: 0,
  contained: 1,
  out: true,
  peak: 0,
  everLit: 0,
  drops: 0,
  hits: 0,
  litres: 0,
  capacity: 0,
  fraction: 0,
  kind: null,
  filledOnce: false,
  reached: false,
  protectDist: Infinity,
  mopping: false,
  recent: false,
  releasing: false,
  holdLeft: 0,
  across: 0,
};

// Scratch, so the frame loop allocates nothing.
const _v = new THREE.Vector3();
const _p = { x: 0, z: 0 };
const _land = new THREE.Vector3();
const _land2 = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _douse = { doused: 0, wetted: 0, count: 0, xs: new Float32Array(24), zs: new Float32Array(24) };
const _col = new THREE.Color();
const _smokeDay = new THREE.Color(0.3, 0.27, 0.245);
const _smokeDusk = new THREE.Color(0.24, 0.19, 0.17);
const _smokeNight = new THREE.Color(0.045, 0.042, 0.04);
const floorY = (x, z) => W.surface.top(x, z);
const landHandler = (p, onLand) => landParcel(W.sim, p, onLand);

function hash01(i) {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function notify(sim, text, kind = 'info', sec = 4) {
  if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, sec);
}

function qualityOf(sim) {
  const q = (sim && sim.settings && sim.settings.quality) || 'high';
  return BUDGET[q] ? q : 'high';
}

function isNight(sim) {
  return !!(sim && sim.weather && sim.weather.isNight);
}

/** Height of the aircraft above whatever is under it — the sea surface over the sea. */
function heightOver(ac) {
  return ac.pos.y - W.surface.top(ac.pos.x, ac.pos.z);
}

/* ------------------------------------------------------------------ *
 * Building and tearing down the pictures.
 * ------------------------------------------------------------------ */

function buildFx(sim, group) {
  W.group = group;
  W.budget = BUDGET[qualityOf(sim)];
  W.flames = new Flames(W.budget.flames);
  W.plumes = new Plumes(W.budget.puffs + 60);
  W.embers = new Sparks(W.budget.embers, { additive: true, color: 0xff8a2a, size: 0.9, gravity: -1.2, drag: 0.35 });
  W.drops = new Sparks(W.budget.drops, { additive: false, color: 0xdcecff, size: 1.5, gravity: -9.81, drag: 0.7 });
  W.aim = new Marker(0x7dffb4);
  W.fillMark = new Marker(0x58c6ff);
  W.bucket = new BucketRig();
  W.bucket.group.visible = false;
  group.add(W.flames.mesh, W.plumes.mesh, W.embers.points, W.drops.points, W.aim.mesh, W.fillMark.mesh, W.bucket.group);
  W.surface.bind(sim.terrain);
  W.scar = null;
  W.flameDirty = true;
}

function buildScar(sim) {
  if (!W.grid || !W.group) return;
  if (W.scar) {
    W.group.remove(W.scar.mesh);
    W.scar.dispose();
    W.scar = null;
  }
  W.surface.bind(sim.terrain);
  const chunk = W.surface.chunkAt(W.grid.cx, W.grid.cz);
  if (!chunk) return;
  W.scar = new Scar(W.grid, chunk);
  W.group.add(W.scar.mesh);
  W.grid.markAll();
}

/* ------------------------------------------------------------------ *
 * Trees: which ones stand in the window, so they can be charred.
 * ------------------------------------------------------------------ */

function indexTrees(sim, grid) {
  W.trees = new Map();
  W.treeMeshes = [];
  const g = sim && sim.scenery && sim.scenery.group;
  if (!g) return;
  const m4 = new THREE.Matrix4();
  for (const o of g.children) {
    if (!o || !o.isInstancedMesh || !o.material || o.material.vertexColors !== true) continue;
    let any = false;
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, m4);
      const e = m4.elements;
      const i = grid.indexAt(e[12], e[14]);
      if (i < 0) continue;
      any = true;
      let list = W.trees.get(i);
      if (!list) W.trees.set(i, (list = []));
      list.push(o, k);
    }
    if (any) W.treeMeshes.push(o);
  }
  /*
   * Give each of those meshes a per-instance colour now, all white. A mesh
   * that gains instanceColor needs a different shader program, and three
   * compiles it on the next frame it is drawn — so this is the hitch, taken
   * here at the start of the flight rather than the moment the first tree
   * burns with the fire filling the screen.
   */
  _col.setRGB(1, 1, 1);
  for (const o of W.treeMeshes) {
    if (!o.instanceColor) {
      for (let k = 0; k < o.count; k++) o.setColorAt(k, _col);
      o.instanceColor.needsUpdate = true;
    }
  }
}

function charTrees(i, st) {
  const list = W.trees && W.trees.get(i);
  if (!list) return;
  if (st === STATE.BURNT) _col.setRGB(0.12, 0.105, 0.095);
  else if (st === STATE.DOUSED) _col.setRGB(0.42, 0.37, 0.32);
  else return;
  for (let k = 0; k < list.length; k += 2) {
    const mesh = list[k];
    if (!mesh.instanceColor) continue;
    mesh.setColorAt(list[k + 1], _col);
    mesh.instanceColor.needsUpdate = true;
  }
}

function retintTrees() {
  if (!W.trees || !W.grid) return;
  for (const i of W.trees.keys()) charTrees(i, W.grid.state[i]);
}

/* ------------------------------------------------------------------ *
 * Lighting a fire.
 * ------------------------------------------------------------------ */

function ensureGrid(sim) {
  const cap = W.budget ? W.budget.burning : BUDGET.high.burning;
  if (!W.grid || W.grid.maxBurning !== cap) {
    W.grid = new FireGrid({ size: GRID_SIZE, cell: CELL, maxBurning: cap, seed: 7 });
    W.sc = new FireScenario(W.grid);
  }
  W.grid.onChange = charTrees;
  return W.grid;
}

function clearAll(sim) {
  if (W.tank && sim && sim.aircraft) W.tank.removeMass(sim.aircraft);
  W.tank = null;
  W.live = false;
  W.disaster = false;
  W.spec = null;
  W.data = null;
  W.fill = null;
  W.hasTarget = false;
  W.filledOnce = false;
  W.hits = 0;
  W.sources.length = 0;
  if (W.sc) W.sc.reset();
  if (W.grid) {
    W.grid.onChange = null;
    W.grid.reset();
    W.grid.onChange = charTrees;
  }
  // Put the trees back the colour they were.
  if (W.treeMeshes) {
    _col.setRGB(1, 1, 1);
    for (const o of W.treeMeshes) {
      if (!o.instanceColor) continue;
      for (let k = 0; k < o.count; k++) o.setColorAt(k, _col);
      o.instanceColor.needsUpdate = true;
    }
  }
  W.trees = null;
  W.treeMeshes = null;
  removeWoods(W.woods, W.group);
  W.woods = null;
  removeBreak();
  if (W.flames) {
    W.flames.begin();
    W.flames.end();
  }
  if (W.plumes) W.plumes.clear();
  if (W.embers) W.embers.clear();
  if (W.drops) W.drops.clear();
  if (W.aim) W.aim.hide();
  if (W.fillMark) W.fillMark.hide();
  if (W.bucket) {
    W.bucket.group.visible = false;
    W.bucket.ready = false;
  }
  if (W.scar && W.group) {
    W.group.remove(W.scar.mesh);
    W.scar.dispose();
  }
  W.scar = null;
  if (W.hud) W.hud.setVisible(false);
  W.audio.stop(sim);
}

/**
 * Light a fire and arm the water. The missions call this from onStart (with
 * their ctx), the Dev button calls it with a spec of its own.
 *
 * spec:
 *   centre      {x, z}           middle of the 6.4 km window
 *   ignite      [{x, z, r}]      where it starts; moved onto fuel if needed
 *   preburn     seconds          let it grow before you arrive
 *   spread      multiplier       on the spread rate
 *   burn        multiplier       on how long each cell burns
 *   spot        multiplier       on embers jumping ahead (0 = none)
 *   protect     'town' | {x, z, r, name}   reaching it is the failure
 *   water       {x, z}           the bucket's fill point, else the nearest sea
 *   waterName   string           what the panel calls it ('the Bay')
 *   line        {path:[{x,z}], width}      a dug fire break
 *   holdSeconds seconds          until the fire crews arrive and take over
 *   holdNeedsLine bool           …and only once the protected side is clear
 *   crewHelp    seconds          …but after the clock they put out one cell
 *                                on the protected side this often
 *   mopUp       0..1             contained fraction at which crews finish it
 *   smallLeft   cells            or when this few are left burning
 *   startFull   bool             the tank starts full
 */
export function setupFire(ctxOrSim, spec = {}) {
  const sim = ctxOrSim && ctxOrSim.sim ? ctxOrSim.sim : ctxOrSim;
  if (!sim) return false;
  W.sim = sim;
  clearAll(sim);
  const grid = ensureGrid(sim);
  const c = spec.centre || (spec.ignite && spec.ignite[0]) || { x: 0, z: 0 };
  // The window has to be in place before the trees can be looked up in it,
  // and the trees before the ground is classified (a cell with a tree in it
  // is forest).
  grid.setWindow(c.x, c.z);
  indexTrees(sim, grid);
  const trees = W.trees;
  grid.sampler = makeSampler(sim, {
    treeAt: trees && trees.size ? (x, z) => trees.has(grid.indexAt(x, z)) : null,
    woods: spec.woods,
  });
  plantMissionWoods(sim, spec);
  drawBreak(spec);
  if (sim.weather && sim.weather.windVector) {
    const w = sim.weather.windVector();
    W.wind.set(w.x, 0, w.z);
  }
  const cond = sim.weather && sim.weather.cond;
  const lit = W.sc.start(spec, { wind: W.wind, damp: cond && cond.rain ? 1 - cond.rain * 0.45 : 1 });
  W.spec = spec;
  W.data = ctxOrSim && ctxOrSim.data ? ctxOrSim.data : null;
  W.mapId = MAP && MAP.id;

  // Arm the water.
  armTank(sim);
  const kind = W.tank ? W.tank.kind : 'bucket';
  const fc = grid.centroid(_p) || c;
  const water = kind === 'bucket' ? spec.water : spec.lane || null;
  if (water) {
    W.fill = {
      x: water.x,
      z: water.z,
      heading: water.heading ?? Math.atan2(fc.x - water.x, -(fc.z - water.z)),
    };
  } else {
    W.fill = findWater(fc.x, fc.z, kind);
  }
  W.live = true;
  W.time = 0;
  W.flameDirty = true;
  buildScar(sim);
  retintTrees();
  retarget();
  warmSmoke(sim);
  // Lit from the pause menu, the panel waits for Resume (update() shows it)
  // rather than popping up over the menu.
  if (W.hud) W.hud.setVisible(sim.state !== 'paused');
  return lit > 0;
}

/** The wood a forest-fire mission asked for, planted and made charrable. */
function plantMissionWoods(sim, spec) {
  removeWoods(W.woods, W.group);
  W.woods = null;
  if (!spec || !spec.woods || !W.group || !W.grid) return;
  W.surface.bind(sim.terrain);
  const q = qualityOf(sim);
  W.woods = plantWoods(W.grid, spec.woods, (x, z) => W.surface.y(x, z), W.budget.trees, q === 'high' || q === 'ultra');
  if (!W.woods) return;
  for (const m of W.woods.meshes) W.group.add(m);
  if (!W.trees) W.trees = new Map();
  for (const [i, list] of W.woods.cells) {
    const had = W.trees.get(i);
    if (had) had.push(...list);
    else W.trees.set(i, list.slice());
  }
}

/** The crews' line, when there is one, drawn on the ground. */
function drawBreak(spec) {
  removeBreak();
  const line = spec && spec.line;
  if (!line || !line.path || line.path.length < 2 || !W.group) return;
  W.breakLine = new Break(line.path, line.width || 24, (x, z) => W.surface.y(x, z));
  W.group.add(W.breakLine.mesh);
}

function removeBreak() {
  if (!W.breakLine) return;
  if (W.group) W.group.remove(W.breakLine.mesh);
  W.breakLine.dispose();
  W.breakLine = null;
}

function armTank(sim) {
  if (W.tank && sim.aircraft) W.tank.removeMass(sim.aircraft);
  W.tank = sim.aircraftType ? new WaterTank(sim.aircraftType) : null;
  if (W.tank && W.spec && W.spec.startFull) {
    W.tank.litres = W.tank.capacity;
    W.filledOnce = true;
  }
  if (W.bucket) {
    W.bucket.ready = false;
    W.bucket.group.visible = !!(W.tank && W.tank.kind === 'bucket');
  }
}

/**
 * A fire that has been burning for minutes has a smoke column already. Run
 * the plume on its own for forty seconds so the first thing you see on the
 * horizon is the column, not a column starting to grow.
 */
function warmSmoke(sim) {
  if (!W.plumes || !W.grid || !W.grid.burning) return;
  const cam = (sim && sim.camera && sim.camera.position) || _v.set(0, 0, 0);
  const night = isNight(sim);
  rebuildSources();
  for (let t = 0; t < 40; t += 0.5) {
    emitSmoke(0.5, night);
    W.plumes.update(0.5, W.wind, cam);
  }
}

/* ------------------------------------------------------------------ *
 * What the missions and the HUD read.
 * ------------------------------------------------------------------ */

export function fireStatus(sim) {
  const g = W.grid;
  const t = W.tank;
  const sc = W.sc;
  STATUS.live = W.live;
  STATUS.burning = W.live && g ? g.burning : 0;
  STATUS.contained = W.live && g && sc ? sc.progress() : 1;
  STATUS.out = !W.live || !g || g.burning === 0;
  STATUS.peak = g ? g.peak : 0;
  STATUS.everLit = g ? g.stats.everLit : 0;
  STATUS.drops = t ? t.drops : 0;
  STATUS.hits = W.hits;
  STATUS.litres = t ? t.litres : 0;
  STATUS.capacity = t ? t.capacity : 0;
  STATUS.fraction = t ? t.fraction : 0;
  STATUS.kind = t ? t.kind : null;
  STATUS.filledOnce = W.filledOnce;
  STATUS.reached = !!(sc && sc.reached);
  STATUS.protectDist = sc && W.live ? sc.protectDistance() : Infinity;
  STATUS.mopping = !!(sc && sc.mopping);
  STATUS.recent = !!(sc && W.live && sc.recent);
  STATUS.releasing = !!(t && (t.releasing || t.inFlight));
  STATUS.holdLeft = sc ? sc.holdLeft : 0;
  STATUS.across = sc ? sc.across : 0;
  return STATUS;
}

/** Where the water is, as a point a little above the sea (null if none). */
export function fillPoint(out = new THREE.Vector3()) {
  if (!W.fill) return null;
  return out.set(W.fill.x, 25, W.fill.z);
}

/** The edge to hit next, a little above the ground (null if nothing burns). */
export function dropPoint(out = new THREE.Vector3()) {
  if (!W.hasTarget || !W.grid || !W.grid.burning) return null;
  return out.copy(W.target);
}

/** True while the next thing to do is fetch water rather than drop it. */
function needsWater() {
  const t = W.tank;
  return !!(t && !t.releasing && t.litres < t.capacity * 0.25);
}

/**
 * The one point the game's arrow should chase: water while you are nearly
 * empty, the fire while you have some. Returned vector is shared — the runner
 * clones what it keeps.
 */
export function fireGuide(sim) {
  const t = W.tank;
  if (needsWater() && W.fill) return fillPoint(W.guide);
  if (W.hasTarget && W.grid && W.grid.burning) return W.guide.copy(W.target);
  if (W.fill && t && t.litres < t.capacity * 0.9) return fillPoint(W.guide);
  return null;
}

/** 'Water' or 'Fire' — what fireGuide is pointing at, for the arrow's label. */
export function fireGuideLabel() {
  return needsWater() ? 'Water' : 'Fire';
}

/** For tests and the Dev panel. */
export function wildfireDebug() {
  return W;
}

/* ------------------------------------------------------------------ *
 * The water leaving, and landing.
 * ------------------------------------------------------------------ */

function dropWater(sim) {
  const t = W.tank;
  if (!t) return false;
  const r = t.release();
  if (r === 'empty') {
    W.audio.empty(sim);
    notify(
      sim,
      t.kind === 'bucket'
        ? 'The bucket is empty — hover low over the sea to fill it'
        : 'The tank is empty — skim the sea with your flaps out to fill it',
      'warn',
      3
    );
    return false;
  }
  if (r === 'dropped') W.audio.whoosh(sim, t.kind === 'bucket' ? 0.7 : 1);
  return r === 'dropped';
}

/**
 * Hits, as the crews count them. A Dev fire has no mission to win, so it
 * starts with one on the books — the crews will finish it for the first four
 * minutes without a drop — and every real hit still counts on top.
 */
function hitCount() {
  return W.hits + (W.spec && W.spec.dev ? 1 : 0);
}

function landParcel(sim, p, onLand) {
  const g = W.grid;
  let tally = null;
  if (W.tank) {
    for (const d of W.tank.pending) {
      if (d.id === p.id) {
        tally = d;
        break;
      }
    }
  }
  if (tally) tally.landed++;
  // A burst of spray where it hits.
  W.plumes.emit(p.x, p.y + 3, p.z, 0, 2.5, 0, p.r * 0.55, 6, 2.6 + Math.random(), 0.38, 1, 0);
  if (!onLand || !g) {
    if (tally) tally.sea++;
    return;
  }
  _douse.doused = 0;
  _douse.wetted = 0;
  _douse.count = 0;
  g.douse(p.x, p.z, p.r, p.strength, 16, _douse, p.id);
  if (tally) {
    tally.onLand++;
    tally.doused += _douse.doused;
    tally.wetted += _douse.wetted;
  }
  /*
   * The hit counts the moment it lands, not when the last parcel is down.
   * It used to be counted in reportDrops, a second or two later — and a
   * drop that put out the last flame of a small fire left a fire that was
   * out with no hits on the books, which is exactly what the missions fail
   * as "burnt itself out". A perfect first drop on Spot Fire lost it.
   */
  if (_douse.doused && (!tally || !tally.hit)) {
    if (tally) tally.hit = true;
    W.hits++;
    if (W.sc) W.sc.noteHits(hitCount());
  }
  for (let k = 0; k < _douse.count; k += 2) {
    const x = _douse.xs[k];
    const z = _douse.zs[k];
    const y = W.surface.y(x, z);
    W.plumes.emit(x, y + 4, z, 0, 5 + Math.random() * 3, 0, 14 + Math.random() * 8, 7, 5 + Math.random() * 3, 0.5, 1, 0);
  }
  if (_douse.doused) W.flameDirty = true;
}

/** When a whole drop has come down, say how it went. Once. */
function reportDrops(sim) {
  const t = W.tank;
  if (!t || !t.pending.length) return;
  const d = t.pending[0];
  if (t.releasing || d.landed < d.parcels || t.inFlight) return;
  t.pending.shift();
  if (d.doused > 0) {
    const hot = d.doused >= 12 ? 'Direct hit!' : 'Good drop!';
    notify(sim, `${hot} ${d.doused} burning ${d.doused === 1 ? 'patch' : 'patches'} out`, 'good', 3.4);
    W.audio.hiss(sim, Math.min(4, d.doused / 6));
  } else if (d.onLand > 0) {
    notify(sim, 'Missed the flames — but that ground is soaked now and will not burn', 'info', 3.6);
  } else {
    notify(sim, 'That one landed in the sea — let go over the fire', 'warn', 3);
  }
  if (d.agl * FT > 500 && d.doused > 0) notify(sim, 'Drop lower for a full hit — under 200 ft', 'info', 3);
}

/* ------------------------------------------------------------------ *
 * The frame.
 * ------------------------------------------------------------------ */

function retarget() {
  const g = W.grid;
  if (!g || !g.burning) {
    W.hasTarget = false;
    return;
  }
  const t = W.sc ? W.sc.dropTarget(_p) : g.dropTarget(_p);
  if (!t) {
    W.hasTarget = false;
    return;
  }
  const y = W.surface.y(t.x, t.z) + 40;
  if (W.hasTarget) {
    const d = Math.hypot(t.x - W.target.x, t.z - W.target.z);
    // Glide rather than jump when it is the same stretch of edge.
    const k = d < 200 ? 0.35 : 1;
    W.target.x += (t.x - W.target.x) * k;
    W.target.z += (t.z - W.target.z) * k;
    W.target.y = y;
  } else {
    W.target.set(t.x, y, t.z);
  }
  W.hasTarget = true;
}

/** Rebuild the flame instances from the burning cells. On a tick, not per frame. */
function rebuildFlames() {
  const g = W.grid;
  const F = W.flames;
  F.begin();
  if (!g) {
    F.end();
    return;
  }
  const n = g.burning;
  // More burning than billboards: draw every other one, bigger.
  const stride = n > F.max ? Math.ceil(n / F.max) : 1;
  const grow = stride > 1 ? Math.sqrt(stride) : 1;
  for (let s = 0; s < n; s += stride) {
    const i = g.slotCell[s];
    const h1 = hash01(i);
    const h2 = hash01(i + 7919);
    const x = g.cellX(i) + (h1 - 0.5) * 10;
    const z = g.cellZ(i) + (h2 - 0.5) * 10;
    const y = W.surface.y(x, z) - 0.6;
    const forest = g.fuel[i] === FUEL.FOREST;
    const load = 0.8 + h2 * 0.45;
    const w = (forest ? 19 : 17) * grow;
    // Taller than a real grass fire on purpose: 2 m flames are a pixel from
    // a kilometre up, and the fire is the thing a child is looking for.
    const h = (forest ? 18 + h1 * 12 : 7 + h1 * 5) * load * (grow > 1 ? 1.2 : 1);
    F.push(x, y, z, w, h, h1, g.slotHeat[s]);
  }
  F.end();
}

/**
 * Where the smoke comes from: the fire, lumped into 240 m blocks. Bigger
 * blocks are fewer, thicker columns; at 160 m a big fire made nine thin
 * wisps that each got a ninth of the budget and read as haze.
 */
const BLOCK = 12;
const _blk = { sum: null, x: null, z: null, list: null, n: 0 };
function rebuildSources() {
  const g = W.grid;
  W.sources.length = 0;
  if (!g || !g.burning) return;
  const nb = Math.ceil(g.size / BLOCK);
  if (!_blk.sum || _blk.sum.length !== nb * nb) {
    _blk.sum = new Float32Array(nb * nb);
    _blk.x = new Float32Array(nb * nb);
    _blk.z = new Float32Array(nb * nb);
    _blk.list = new Int32Array(nb * nb);
  }
  _blk.n = 0;
  for (let s = 0; s < g.burning; s++) {
    const i = g.slotCell[s];
    const ix = i % g.size;
    const iz = (i - ix) / g.size;
    const b = ((iz / BLOCK) | 0) * nb + ((ix / BLOCK) | 0);
    if (_blk.sum[b] === 0) _blk.list[_blk.n++] = b;
    const heat = g.slotHeat[s] * (g.fuel[i] === FUEL.FOREST ? 1.6 : 1);
    _blk.sum[b] += heat;
    _blk.x[b] += g.cellX(i) * heat;
    _blk.z[b] += g.cellZ(i) * heat;
  }
  const pool = W.srcPool;
  for (let k = 0; k < _blk.n; k++) {
    const b = _blk.list[k];
    const h = _blk.sum[b];
    if (h > 0.2) {
      const n = W.sources.length;
      let src = pool[n];
      if (!src) pool[n] = src = { x: 0, z: 0, heat: 0, acc: Math.random() };
      src.x = _blk.x[b] / h;
      src.z = _blk.z[b] / h;
      src.heat = h;
      W.sources.push(src);
    }
    _blk.sum[b] = 0;
    _blk.x[b] = 0;
    _blk.z[b] = 0;
  }
}

/** Puffs a second one block of fire asks for: a small fire still smokes. */
function smokeRate(heat) {
  return Math.min(2.6, 0.4 + Math.sqrt(heat) * 0.35);
}

/**
 * Smoke. A column is a stream of big soft puffs leaving the fire fast and
 * slowing, growing as they go and riding the wind more the higher they get,
 * so it stands up over the fire and leans over at the top — four to six
 * hundred metres of it over a big fire, which is what you find a fire by
 * from ten kilometres away. A fixed budget of puffs a second is shared
 * among the blocks; the square root gives a small fire a fair share.
 */
function emitSmoke(dt, night) {
  const P = W.plumes;
  const src = W.sources;
  if (!src.length) return;
  let want = 0;
  for (const s of src) want += smokeRate(s.heat);
  // Puffs live 36 to 50 s, so this many a second fills the budget.
  const cap = W.budget.puffs / 44;
  const scale = want > cap ? cap / want : 1;
  const w = W.wind;
  for (const s of src) {
    s.acc += smokeRate(s.heat) * scale * dt;
    while (s.acc >= 1) {
      s.acc -= 1;
      const big = Math.min(1, s.heat / 12);
      const spread = Math.min(90, 25 + s.heat * 3);
      const x = s.x + (Math.random() - 0.5) * spread;
      const z = s.z + (Math.random() - 0.5) * spread;
      const y = W.surface.y(x, z) + 4 + Math.random() * 8;
      P.emit(
        x, y, z,
        w.x * 0.2, 16 + Math.random() * 8 + big * 10, w.z * 0.2,
        34 + Math.random() * 16 + big * 26,
        6 + Math.random() * 3 + big * 5,
        36 + Math.random() * 14,
        (0.5 + Math.random() * 0.15) * (0.75 + big * 0.25),
        0,
        night ? 1 : 0.2
      );
    }
  }
}

function emitEmbers(dt) {
  const g = W.grid;
  if (!g || !g.burning) return;
  W.emberAcc += Math.min(45, g.burning * 0.3) * dt;
  while (W.emberAcc >= 1) {
    W.emberAcc -= 1;
    const s = (Math.random() * g.burning) | 0;
    const i = g.slotCell[s];
    if (g.slotHeat[s] < 0.3) continue;
    const x = g.cellX(i) + (Math.random() - 0.5) * 16;
    const z = g.cellZ(i) + (Math.random() - 0.5) * 16;
    const y = W.surface.y(x, z) + 2 + Math.random() * (g.fuel[i] === FUEL.FOREST ? 14 : 5);
    W.embers.emit(x, y, z, (Math.random() - 0.5) * 3, 4 + Math.random() * 6, (Math.random() - 0.5) * 3, 1.6 + Math.random() * 2.2);
  }
}

function spray(p) {
  // Twelve droplets per parcel, fanned out, and a puff of mist behind them.
  for (let k = 0; k < 12; k++) {
    W.drops.emit(
      p.x + (Math.random() - 0.5) * 2,
      p.y - Math.random() * 1.5,
      p.z + (Math.random() - 0.5) * 2,
      p.vx + (Math.random() - 0.5) * 5,
      p.vy - Math.random() * 3,
      p.vz + (Math.random() - 0.5) * 5,
      6
    );
  }
  if (Math.random() < 0.6) {
    W.plumes.emit(p.x, p.y - 3, p.z, p.vx * 0.5, p.vy * 0.4 - 2, p.vz * 0.5, 7 + Math.random() * 5, 7, 2.4, 0.4, 1, 0);
  }
}

function onDropLand(x, y, z) {
  if (Math.random() < 0.04) W.plumes.emit(x, y + 1, z, 0, 1.5, 0, 5, 4, 1.4, 0.25, 1, 0);
}

function mmss(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The gauge, the arrow, the one-line tip. */
function hudModel(sim) {
  const ac = sim.aircraft;
  const t = W.tank;
  const g = W.grid;
  const sc = W.sc;
  const m = hudModel.m || (hudModel.m = { next: { kind: 'fill', dist: 0, rel: 0, label: '' } });
  m.contained = sc && W.live ? sc.progress() : 1;
  const spec0 = W.spec || {};
  // Where the crews take over, marked on the bar — when it is the bar that
  // decides (Line One's crews go by the clock).
  m.goal = spec0.mopUp && spec0.mopUp <= 1 ? spec0.mopUp : null;
  m.burning = g ? g.burning : 0;
  m.litres = t ? t.litres : 0;
  m.capacity = t ? t.capacity : 0;
  m.kind = t ? t.kind : 'tank';
  m.filling = !!(t && t.filling);
  m.armed = !!t;
  m.touch = typeof document !== 'undefined' && document.documentElement.classList.contains('is-touch-device');
  m.force = false;
  const empty = !t || t.litres < t.capacity * 0.12;
  let goal = null;
  if (t && !t.releasing && empty && W.fill) {
    m.next.kind = 'fill';
    m.next.label = W.spec && W.spec.waterName ? `at ${W.spec.waterName}` : 'at the sea';
    goal = W.fill;
  } else if (W.hasTarget && m.burning) {
    m.next.kind = 'drop';
    m.next.label = 'on the fire';
    goal = W.target;
  }
  if (goal) {
    const dx = goal.x - ac.pos.x;
    const dz = goal.z - ac.pos.z;
    m.next.dist = Math.hypot(dx, dz);
    const brg = (Math.atan2(dx, -dz) * 180) / Math.PI;
    m.next.rel = ((brg - ac.heading + 540) % 360) - 180;
  }
  const next = goal ? m.next : null;
  // The one thing to do.
  let tip = '';
  let good = false;
  const hFt = Math.round(heightOver(ac) * FT);
  const key = m.touch ? 'tap DROP WATER' : 'press X';
  if (!m.burning) {
    tip = 'The fire is out!';
    good = true;
  } else if (t && t.releasing) {
    tip = 'Water away!';
    good = true;
  } else if (t && t.filling) {
    tip = `Filling… ${Math.round(t.fraction * 100)}% — hold it there`;
    good = true;
  } else if (t && t.fillWhy) {
    tip = t.fillWhy;
  } else if (t && !empty && next && next.dist < 2600) {
    if (W.aimGreen) {
      tip = `Over the fire — ${key}!`;
      good = true;
    } else if (hFt > 400) {
      tip = `Come down — drop from under 200 ft (you are at ${hFt} ft)`;
    } else {
      tip = 'Fly over the flames — the ring shows where the water will land';
    }
  } else if (t && empty) {
    tip = t.kind === 'bucket'
      ? 'Hover low over the sea to fill the bucket'
      : `Skim the sea to fill: under 100 ft, flaps out, ${t.vmin}–${t.vmax} kt`;
  }
  m.tip = tip;
  m.tipGood = good;
  let warn = '';
  if (sc && sc.protect && m.burning) {
    const d = sc.protectDistance();
    if (d < 700) warn = `Fire ${Math.round(d / 10) * 10} m from ${sc.protect.name}!`;
  }
  if (sc && sc.lineSide && sc.across > 0) warn = `Fire across the line: ${sc.across} burning — put it out!`;
  if (!warn && W.smokeAt > 0.45) warn = 'Thick smoke — you cannot see much in here';
  m.warn = warn;
  const spec = W.spec || {};
  m.clock = '';
  if (sc && m.burning && !sc.mopping) {
    // The crews finish a fire somebody is fighting: a hit in the last four
    // minutes (wildfire/scenario.js). Say so, or a child who stopped to
    // circle watches a bar past the white mark and nothing happening.
    const needYou = W.hits
      ? 'Crews are ready — one more good drop and they take over'
      : 'Crews are ready — they need one good drop from you first';
    if (spec.holdSeconds) {
      if (sc.holdLeft > 0) m.clock = `Fire crews here in ${mmss(sc.holdLeft)}`;
      else if (spec.holdNeedsLine && sc.across > 0) {
        m.clock = sc.helping && sc.recent
          ? `Crews are helping — ${sc.across} still burning on the base side`
          : sc.helping
            ? 'Crews need your water on the base side too — keep dropping!'
            : 'Crews are waiting — clear the base side of the line';
      } else if (!sc.recent) m.clock = needYou;
      else m.clock = 'Fire crews are here!';
    } else if (!sc.recent && m.contained >= (spec.mopUp ?? 0.85)) {
      m.clock = needYou;
    }
  }
  return m;
}

function update(sim, dt) {
  W.sim = sim;
  if (sim.mode === 'drive' || !W.group) {
    if (W.hud) W.hud.setVisible(false);
    return;
  }
  const ac = sim.aircraft;
  const cam = sim.camera;
  const weather = sim.weather;
  W.time += dt;
  const night = weather && weather.isNight ? 1 : 0;
  const dusk = weather && weather.time === 'sunset' ? 1 : 0;

  if (weather && weather.windVector) {
    const w = weather.windVector();
    W.wind.set(w.x, 0, w.z);
  }

  const g = W.grid;
  const sc = W.sc;
  if (W.live && g && sc) {
    if (sc.update(dt, W.wind, hitCount())) {
      W.flameDirty = true;
      rebuildSources();
      retarget();
      for (let k = 0; k < sc.mopCount && k < 2; k++) {
        const x = sc.mopXs[k];
        const z = sc.mopZs[k];
        W.plumes.emit(x, W.surface.y(x, z) + 3, z, 0, 4, 0, 12, 5, 4, 0.4, 1, 0);
      }
      if (sc.event === 'crews') {
        sc.event = null;
        const spec = W.spec || {};
        notify(sim, spec.mopText || 'Ground crews: "We have it from here — nice flying!"', 'good', 4.5);
        W.audio.full(sim);
      }
      if (sc.helpNew) {
        sc.helpNew = false;
        notify(sim, W.spec.helpText || 'Crews: "The line is finished — we are coming over to help with the spot fires. Keep the water coming!"', 'good', 5);
        W.audio.full(sim);
      }
      if (sc.emberNew) {
        sc.emberNew = false;
        notify(sim, 'Spot fire! An ember has jumped the line — get it before it grows', 'warn', 4.5);
        W.audio.alert(sim);
      }
    }
  }

  updateDisaster(sim);

  // The water.
  const t = W.tank;
  if (W.live && t && ac && !ac.crashed) {
    let bucketPos = null;
    if (t.kind === 'bucket' && W.bucket) {
      W.bucket.group.visible = true;
      W.bucket.update(dt, ac, W.wind, floorY, t.fraction);
      bucketPos = W.bucket.pos;
    }
    const wasFull = t.litres >= t.capacity - 0.5;
    t.checkFill(ac, bucketPos);
    const got = t.fill(dt);
    if (got > 0) {
      W.filledOnce = W.filledOnce || t.fraction > 0.5;
      // Spray off the water while it comes aboard.
      const src = bucketPos || _origin.set(0, -1.5, 3).applyQuaternion(ac.quat).add(ac.pos);
      if (Math.random() < 0.6) {
        W.drops.emit(src.x, Math.max(0.4, src.y), src.z, (Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6, 2);
      }
      if (t.kind === 'scooper' && Math.random() < 0.35) {
        W.plumes.emit(src.x, 1.5, src.z, ac.vel.x * 0.3, 1.5, ac.vel.z * 0.3, 7, 6, 2, 0.35, 1, 0);
      }
    }
    if (!wasFull && t.litres >= t.capacity - 0.5) {
      W.audio.full(sim);
      notify(sim, t.kind === 'bucket' ? 'Bucket full — go and drop it on the fire!' : 'Tank full — go and drop it on the fire!', 'good', 3);
    }
    // Water leaving: from the bucket, or from the belly.
    if (t.releasing) {
      if (bucketPos) {
        _origin.copy(bucketPos);
        _vel.copy(W.bucket.vel);
      } else {
        _origin.set(0, -2.2, 0.5).applyQuaternion(ac.quat).add(ac.pos);
        _vel.copy(ac.vel);
      }
      const agl = _origin.y - W.surface.top(_origin.x, _origin.z);
      t.emitParcels(dt, _origin, _vel, agl, spray);
    }
    t.applyMass(ac);
  } else if (W.bucket && t && t.kind === 'bucket' && ac && ac.crashed) {
    W.bucket.group.visible = false;
  }
  if (t) {
    t.updateParcels(dt, W.wind, floorY, landHandler);
    reportDrops(sim);
  }

  // Pictures.
  if (W.flameDirty) {
    rebuildFlames();
    W.flameDirty = false;
  }
  if (W.flames) {
    const u = W.flames.mat.uniforms;
    u.uTime.value = W.time;
    u.uWind.value.copy(W.wind);
    u.uBright.value = night ? 1.25 : dusk ? 1.1 : 1;
    // By day a flame has to hide the grass behind it to look orange at all;
    // at night it is light, and adds.
    u.uOpaque.value = night ? 0.35 : dusk ? 0.6 : 0.85;
  }
  if (W.plumes) {
    const u = W.plumes.mat.uniforms;
    u.uSmoke.value.copy(night ? _smokeNight : dusk ? _smokeDusk : _smokeDay);
    u.uGlow.value.setRGB(0.9, 0.32, 0.08).multiplyScalar(night ? 0.5 : dusk ? 0.12 : 0.04);
    u.uSteam.value.setScalar(night ? 0.34 : dusk ? 0.8 : 0.95);
    if (W.live) emitSmoke(dt, night);
    W.plumes.update(dt, W.wind, cam.position);
  }
  if (W.embers) {
    if (W.live) emitEmbers(dt);
    W.embers.update(dt, W.wind, null, null);
    W.drops.update(dt, W.wind, floorY, onDropLand);
    // Point sizes in pixels depend on the screen and the lens.
    const r = sim.renderer;
    const pr = r && r.getPixelRatio ? r.getPixelRatio() : 1;
    const hgt = (typeof window !== 'undefined' ? window.innerHeight : 800) * pr;
    const scale = hgt / (2 * Math.tan(((cam.fov || 68) * Math.PI) / 360));
    W.embers.mat.uniforms.uScale.value = scale;
    W.drops.mat.uniforms.uScale.value = scale;
  }
  if (W.scar) {
    W.scarT += dt;
    if (W.scarT >= 0.5) {
      W.scarT = 0;
      W.scar.refresh(W.time);
    }
    const u = W.scar.mat.uniforms;
    u.uTime.value = W.time;
    u.uNight.value = night;
    u.uLight.value = night ? 0.28 : dusk ? 0.7 : 1;
  }
  if (W.breakLine) W.breakLine.mat.uniforms.uLight.value = night ? 0.35 : dusk ? 0.75 : 1;

  // Where the water will land, and where to fill.
  if (W.live && t && ac && !ac.crashed) {
    W.aimT -= dt;
    if (W.aimT <= 0) {
      W.aimT = 0.1;
      updateAim(sim, t);
    }
    W.aim.mat.uniforms.uDim.value.z = W.time;
    if (W.fill && t.litres < t.capacity - 1) {
      const lane = t.kind === 'scooper';
      if (!W.fillMark.mesh.visible) {
        W.fillMark.place(W.fill.x, W.fill.z, W.fill.heading || 0, lane ? 380 : 0, lane ? 55 : 32, () => 0, 1.1);
      }
      W.fillMark.mat.uniforms.uDim.value.z = W.time;
    } else {
      W.fillMark.hide();
    }
  } else if (W.aim) {
    W.aim.hide();
    W.fillMark.hide();
  }

  // Smoke in the air you are flying through.
  W.smokeAt = W.plumes ? W.plumes.densityAt(cam.position.x, cam.position.y, cam.position.z) : 0;
  if (W.smokeAt > 0.02 && sim.scene && sim.scene.fog && sim.scene.fog.isFogExp2) {
    const f = sim.scene.fog;
    const k = Math.min(1, W.smokeAt);
    f.density += k * 0.0038;
    f.color.lerp(W.plumes.mat.uniforms.uSmoke.value, Math.min(0.75, k * 0.9));
  }

  // HUD, map, sound, gamepad.
  const showHud = W.live && sim.state === 'flying';
  if (W.hud) {
    W.hud.setVisible(showHud);
    if (showHud && ac) W.hud.update(dt, hudModel(sim));
  }
  if (W.live) {
    drawOnMinimap(sim, g, W.fill && t && t.litres < t.capacity * 0.9 ? W.fill : null, W.hasTarget ? W.target : null, sc && sc.line);
  }
  let near = 0;
  if (W.live && g && g.burning) {
    const d = g.nearestBurning(cam.position.x, cam.position.z);
    const hgt = Math.max(0, cam.position.y - W.surface.top(cam.position.x, cam.position.z));
    near = Math.min(1, g.burning / 60) * Math.max(0, 1 - Math.hypot(d, hgt * 0.8) / 1500);
  }
  W.audio.update(sim, dt, near, !!(t && t.filling));
  const pad = sim.input && sim.input.padEdges;
  if (W.live && t && pad && pad.drop) {
    dropWater(sim);
    // main.js has already said "Nothing to drop right now" to this press.
    const toasts = sim.hud && sim.hud.toasts;
    if (toasts && toasts.length) {
      const last = toasts[toasts.length - 1];
      if (last && last.node && /Nothing to drop/.test(last.node.textContent)) {
        last.node.remove();
        toasts.pop();
      }
    }
  }
}

/** Predict the footprint and lay the ring on the ground. */
function updateAim(sim, t) {
  const ac = sim.aircraft;
  const g = W.grid;
  const aimOk = g && g.burning && t.litres > t.capacity * 0.1 && !t.releasing;
  if (!aimOk) {
    W.aim.hide();
    W.aimGreen = false;
    return;
  }
  const bucket = t.kind === 'bucket' && W.bucket && W.bucket.ready;
  if (bucket) {
    _origin.copy(W.bucket.pos);
    _vel.copy(W.bucket.vel);
  } else {
    _origin.set(0, -2.2, 0.5).applyQuaternion(ac.quat).add(ac.pos);
    _vel.copy(ac.vel);
  }
  const agl = _origin.y - W.surface.top(_origin.x, _origin.z);
  if (agl > 500) {
    W.aim.hide();
    W.aimGreen = false;
    return;
  }
  predictLanding(_origin, _vel, W.wind, floorY, _land);
  const near = g.nearestBurning(_land.x, _land.z);
  if (near > 2500) {
    W.aim.hide();
    W.aimGreen = false;
    return;
  }
  let cx = _land.x;
  let cz = _land.z;
  let half = 0;
  let heading = 0;
  if (!bucket) {
    // The last parcel leaves releaseTime later, further along the track.
    const rt = t.releaseTime * Math.max(0.35, t.fraction);
    _v.copy(_origin).addScaledVector(_vel, rt);
    predictLanding(_v, _vel, W.wind, floorY, _land2);
    cx = (_land.x + _land2.x) / 2;
    cz = (_land.z + _land2.z) / 2;
    half = Math.hypot(_land2.x - _land.x, _land2.z - _land.z) / 2;
    heading = Math.atan2(_land2.x - _land.x, -(_land2.z - _land.z));
  }
  const r = t.radius;
  W.aim.place(cx, cz, heading, half, r, floorY, 0.9);
  // Green when there are flames inside it.
  let hit = false;
  const ax = Math.sin(heading);
  const az = -Math.cos(heading);
  for (let u = -half; u <= half && !hit; u += 20) {
    const px = cx + ax * u;
    const pz = cz + az * u;
    if (g.nearestBurning(px, pz) < r) hit = true;
  }
  W.aimGreen = hit;
  W.aim.mat.uniforms.uColor.value.setHex(hit ? 0x6dff8e : 0xfff1c9);
}

/* ------------------------------------------------------------------ *
 * Dev mode: a fire wherever you are.
 * ------------------------------------------------------------------ */

function findBurnableAhead(sim) {
  const ac = sim.aircraft;
  const s = makeSampler(sim);
  const h = ((ac.heading || 0) * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const ok = (x, z) => s.classify(x, z) !== FUEL.NONE;
  for (let d = 700; d <= 3200; d += 150) {
    for (const lat of [0, 200, -200, 400, -400]) {
      const x = ac.pos.x + fx * d - fz * lat;
      const z = ac.pos.z + fz * d + fx * lat;
      if (ok(x, z)) return { x, z };
    }
  }
  for (let r = 400; r <= 7000; r += 250) {
    const n = Math.max(12, Math.round(r / 120));
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      const x = ac.pos.x + Math.sin(ang) * r;
      const z = ac.pos.z - Math.cos(ang) * r;
      if (ok(x, z)) return { x, z };
    }
  }
  return null;
}

/**
 * A line of text over the menu. The Dev panel lives on the Hangar screen,
 * where the game's own HUD — and so its toasts — are hidden, so a button
 * that only queued something for later looked like a button that did
 * nothing at all.
 */
function menuNote(text) {
  if (typeof document === 'undefined') return;
  const layer = extLayer();
  let el = W.menuNote;
  if (!el) {
    el = W.menuNote = document.createElement('div');
    Object.assign(el.style, {
      position: 'absolute', left: '50%', bottom: '28px', transform: 'translateX(-50%)',
      maxWidth: 'min(92vw, 520px)', padding: '10px 16px', borderRadius: '12px',
      background: 'rgba(12,20,34,0.9)', color: '#ffe0a8', border: '1px solid rgba(255,140,70,0.5)',
      font: '600 14px/1.35 -apple-system, "Segoe UI", Roboto, Arial, sans-serif', textAlign: 'center',
      pointerEvents: 'none', transition: 'opacity 0.4s ease', zIndex: '40',
    });
    layer.appendChild(el);
  }
  el.textContent = text;
  el.style.display = '';
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => {
    el.style.opacity = '0';
  }, 4200);
}

export function startDevFire(sim) {
  if (!sim || !sim.aircraft || sim.state === 'menu' || sim.mode === 'drive') {
    W.pendingDev = true;
    const text = 'A wildfire will start ahead of you as soon as you take off in Free Flight. Water: X, or DROP WATER.';
    if (sim && sim.state === 'menu') menuNote(text);
    else notify(sim, text, 'info', 4);
    return false;
  }
  const p = findBurnableAhead(sim);
  if (!p) {
    notify(sim, 'Nothing to burn near here — fly over grass or forest and try again.', 'warn', 4);
    return false;
  }
  const g = W.grid;
  if (W.live && g && g.burning && g.inside(p.x, p.z) && Math.hypot(p.x - g.cx, p.z - g.cz) < 2600) {
    g.ignite(p.x, p.z, 45);
    W.flameDirty = true;
  } else {
    setupFire(sim, {
      centre: p,
      ignite: [{ x: p.x, z: p.z, r: 45 }],
      preburn: 15,
      protect: 'town',
      mopUp: 0.85,
      dev: true,
    });
  }
  const d = Math.hypot(p.x - sim.aircraft.pos.x, p.z - sim.aircraft.pos.z);
  notify(
    sim,
    `Wildfire ${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`} ahead! Fill up at the sea and drop it with X.`,
    'warn',
    5
  );
  return true;
}

/* ------------------------------------------------------------------ *
 * The Wildfire disaster: "wildfires should be new disaster".
 *
 * game/disasters.js lists it beside the tornado and the typhoon, so it can
 * be armed on the Free Flight screen, set off from the pause menu, or come
 * round on its own with Randomised disasters. What it calls is this. Unlike
 * the Dev button it never waits for a later flight — a disaster is now or
 * not at all — and it is a little bigger, with embers, so there is
 * something to fight. Returns false when there is nothing to fight it with
 * (not in a flight, in the boat or the car) or nothing to burn in reach, and
 * disasters.js then says nothing at all.
 * ------------------------------------------------------------------ */

export function startWildfireDisaster(sim) {
  // 'paused' too: the pause menu's Wildfire button is pressed with the game
  // paused (pause() only ever comes from 'flying', so it is still a flight).
  // The fire is lit now and starts spreading when you press Resume.
  const inFlight = sim && (sim.state === 'flying' || sim.state === 'paused');
  if (!inFlight || !sim.aircraft || sim.mode === 'drive' || !W.group) return false;
  const p = findBurnableAhead(sim);
  if (!p) {
    notify(sim, 'No wildfire here after all — nothing near you can burn.', 'info', 3);
    return false;
  }
  const g = W.grid;
  if (W.live && g && g.burning && g.inside(p.x, p.z) && Math.hypot(p.x - g.cx, p.z - g.cz) < 2600) {
    // One is already burning in this window: a second start joins it.
    g.ignite(p.x, p.z, 60);
    W.flameDirty = true;
  } else if (
    // Not `dev`: the crews finish a fire somebody is fighting, so the water
    // has to land on it at least once (scenario.js, THE CREWS).
    !setupFire(sim, {
      centre: p,
      ignite: [{ x: p.x, z: p.z, r: 60 }],
      preburn: 30,
      spot: 0.6,
      protect: 'town',
      mopUp: 0.85,
      mopText: 'The ground crews have it from here — you saved the island, firefighter!',
    })
  ) {
    clearAll(sim);
    return false;
  }
  W.disaster = true;
  const d = Math.hypot(p.x - sim.aircraft.pos.x, p.z - sim.aircraft.pos.z);
  notify(
    sim,
    `Wildfire ${d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`} ahead — the orange on your map. Blue drop = where to fill up.`,
    'warn',
    6
  );
  return true;
}

/**
 * While the disaster fire burns, keep it lit in the pause menu (2 s or less
 * reads "ON" there, not a countdown), and say so when it is out.
 */
function updateDisaster(sim) {
  if (!W.disaster) return;
  const g = W.grid;
  const burning = W.live && g ? g.burning : 0;
  if (burning > 0) {
    if (sim.activeEvents) sim.activeEvents.wildfire = 2;
    return;
  }
  W.disaster = false;
  if (sim.activeEvents) delete sim.activeEvents.wildfire;
  if (sim.hud && sim.hud.showBanner) {
    if (W.hits > 0) sim.hud.showBanner('WILDFIRE OUT!', 'Great firefighting — the island is safe', 'good', 4);
    else sim.hud.showBanner('The wildfire burned out', 'Next time: fill up at the sea and drop water on it with X', 'warn', 4);
  }
}

/* ------------------------------------------------------------------ *
 * The plug-in.
 * ------------------------------------------------------------------ */

registerExtension({
  id: 'wildfire',

  install(sim) {
    W.sim = sim;
    W.hud = new FireHud(sim, { onDrop: () => dropWater(sim) });
    // The Wildfire disaster (game/disasters.js) starts its fire through this.
    sim.startWildfire = () => startWildfireDisaster(sim);
    /*
     * Hide the panel whenever the game is not flying. The update hook is
     * only called while flying, so it cannot do this itself when a menu
     * comes up; four times a second is plenty for something nobody is
     * looking at.
     */
    if (typeof setInterval === 'function') {
      W.watch = setInterval(() => {
        if (W.hud && W.hud.visible && W.sim && W.sim.state !== 'flying') W.hud.setVisible(false);
      }, 250);
    }
  },

  buildWorld(sim, group) {
    const sameMap = W.mapId && MAP && MAP.id === W.mapId;
    const keep = W.live && sameMap;
    buildFx(sim, group);
    if (!keep) {
      if (W.live) clearAll(sim);
      return;
    }
    // Same map, new pictures (the quality setting changed): keep the fire.
    W.woods = null;
    W.breakLine = null;
    indexTrees(sim, W.grid);
    plantMissionWoods(sim, W.spec);
    drawBreak(W.spec);
    buildScar(sim);
    retintTrees();
    armTankVisuals();
  },

  startMode(sim, mode) {
    // Gone at once, not faded: the flight it announced has started, and a
    // fade that begins on the first frame is still half there on the second.
    if (W.menuNote) W.menuNote.style.display = 'none';
    // A fire mission set itself up in onStart, a moment ago, on this runner.
    const r = sim.runner;
    const mine = W.data && r && r.data === W.data && r.status === 'running';
    if (!mine) clearAll(sim);
    // Free Flight only, as the Dev button promises. It checked only
    // `mode !== 'drive'`, so the next mission or tutorial of any kind got the
    // fire and a tank: X dropped water instead of cargo, and a fire mission's
    // own fire could be replaced by the Dev one (reviewer's finding).
    if (W.pendingDev && mode === 'free') {
      W.pendingDev = false;
      startDevFire(sim);
    }
  },

  stop(sim) {
    clearAll(sim);
  },

  update,

  key(sim, code, down, e) {
    if (!W.live || !W.tank || sim.mode === 'drive') return false;
    const codes = (sim.input && sim.input.bindings && sim.input.bindings.drop) || ['KeyX'];
    if (codes.indexOf(code) < 0) return false;
    if (down && !(e && e.repeat)) dropWater(sim);
    return true;
  },

  devActions: [
    {
      label: 'Start a wildfire here',
      hint: 'Lights a fire on the nearest grass or forest ahead of you and gives you a water tank or bucket (X drops it).',
      run(sim) {
        startDevFire(sim);
      },
    },
    {
      label: 'Put the wildfire out',
      hint: 'Every flame out at once.',
      run(sim) {
        if (W.grid) {
          W.grid.extinguishAll(true);
          W.flameDirty = true;
        }
        notify(sim, 'Fire out.', 'good', 2);
      },
    },
    {
      label: 'Fill the water tank',
      hint: 'Tops up the bucket or tank without going to the sea.',
      run(sim) {
        if (!W.tank) {
          notify(sim, 'No tank aboard — start a wildfire first.', 'info', 3);
          return;
        }
        W.tank.litres = W.tank.capacity;
        W.filledOnce = true;
        notify(sim, 'Full of water.', 'good', 2);
      },
    },
  ],
});

function armTankVisuals() {
  if (W.bucket) {
    W.bucket.ready = false;
    W.bucket.group.visible = !!(W.tank && W.tank.kind === 'bucket');
  }
}

/* For tests: node can drive the logic without a page. */
export const __test = { W, setupFire, fireStatus, dropWater, clearAll, update, BUDGET, startWildfireDisaster };

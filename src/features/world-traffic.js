/**
 * World Map traffic, drawn: the aircraft world/worldmap/traffic-plan.js flies
 * on rails, in the sky round you, on the live map and on the minimap.
 *
 * Fetched only the first time the World Map — Preview is built
 * (features/world-preview.js imports it then); on every other map nothing
 * here loads, and the Dev-mode airport traffic (features/traffic.js) is
 * exactly as it was.
 *
 *   IN THE SKY   the nearest few within the tier's range get the real model
 *                of their type in their airline's paint (the fleet models:
 *                one of every type and paint the fleet flies is built while
 *                the menu is up, one a task, and whatever is left when the
 *                flight starts behind its loading screen — a build is
 *                16-27 ms here, ~100 ms on a Chromebook, so never mid-flight
 *                at Low; above Low a second copy of one already built may
 *                come mid-flight, never more than one every couple of
 *                seconds); everything else out to the tier's far
 *                range is ONE instanced draw call of a plain low-poly shape
 *                in the paint's base colour (fog takes it at range); nothing
 *                at all beyond that.
 *   SOLID        each is a sky body (features/sky.js): the minimap draws the
 *                near ones, and flying into one is a mid-air bump that knocks
 *                it down, crew out under parachutes, as for any NPC. They
 *                keep out of your way (the plan's TCAS-like step aside), so
 *                that can only happen by chasing one.
 *   LIVE MAP     an aircraft symbol for each, pointing where it is going;
 *                its callsign when zoomed in; hover (mouse) or tap (touch)
 *                for the card: callsign, type, from and to, height, speed.
 *
 * Local only: in a game with friends nobody else sees yours (nothing synced).
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, platformAt, MAP } from '../world/terrain.js';
import { PREVIEW } from '../world/worldmap/preview.js';
import { TrafficSim, TIERS, CATS, endpoints, makeRand } from '../world/worldmap/traffic-plan.js';
import { createAircraftModel, groundOffsetFor } from '../aircraft/model-adapter.js';
import { getAircraft, specFor } from '../aircraft/types.js';
import { airlinesFor, schemeFor, radioBrand } from '../aircraft/liveries.js';
import { registerBody, unregisterBody, radiusOfType } from './sky.js';
import * as LOD from './traffic/lod.js';
import { addMapLayer, addPickSource } from './livemap/livemap.js';
import { blinkLevel } from '../render/flash-safety.js';
import { warmShadersAsync, warmShadersChunked } from '../render/shader-warm.js';

const DEG = Math.PI / 180;
const KT = 1.94384;
const FT = 3.28084;
/** Parts under this size are on the list the range may hide. */
const SMALL_PART = 10;
/** A model nearer than this casts a shadow. */
const SHADOW_NEAR = 350;
/** Seconds between choosing who gets a model. */
const ASSIGN_EVERY = 0.25;
/**
 * The lights each one shows at night, as points: red on the left wingtip,
 * green on the right, white on the tail, and the red beacon on top — slow
 * (one a BEACON_S, well under 1 Hz) and, with Reduce flashing on, a smooth
 * swell rather than an on/off. No strobes: a white flash is the one to keep
 * off a classroom screen. Offsets are fractions of the far shape's span and
 * length (nose to -Z, right wing +X).
 */
export const BEACON_S = 1.5;
const LIGHTS = [
  // [x of span, y of length, z of length, r, g, b]
  [-0.5, -0.02, 0.02, 1, 0.14, 0.1],
  [0.5, -0.02, 0.02, 0.1, 1, 0.35],
  [0, 0.04, 0.5, 0.85, 0.85, 0.8],
  [0, 0.07, -0.05, 1, 0.08, 0.04],
];
const LIGHT_PX = 3.2;

/** The live traffic (one at a time: the World Map's). */
let CUR = null;

/* ------------------------------------------------------------------ */
/* Who they are: type, paint, callsign                                 */
/* ------------------------------------------------------------------ */

const HELI_BRAND = { bell407: 'Island Heli', h145: 'Medevac', aw139: 'Coastguard', r44: 'Skyhopper' };

function shortName(type) {
  const words = String(type.name || type.id).split(/\s+/);
  return words.find((x) => /^[A-Za-z]{3,}$/.test(x) && x.toLowerCase() !== 'kestrel') || words[0];
}

/** The fleet a flight draws from: a few types and paints per kind, so a model built once is used again. */
function makeFleet(rand, size) {
  const fleet = {};
  for (const catId of Object.keys(CATS)) {
    const C = CATS[catId];
    const n = Math.max(1, Math.round(size * C.share * 1.4));
    const list = [];
    for (let i = 0; i < n; i++) {
      const typeId = C.types[Math.floor(rand() * C.types.length)];
      const type = getAircraft(typeId);
      let scheme = null;
      let brand = shortName(type);
      if (catId === 'jet' || catId === 'wide' || catId === 'prop') {
        const al = airlinesFor(type);
        const l = al.length ? al[Math.floor(rand() * al.length)] : null;
        if (l) {
          scheme = l;
          brand = radioBrand(l) || brand;
        }
      }
      if (catId === 'heli') brand = HELI_BRAND[typeId] || 'Helicopter';
      if (catId === 'mil') brand = 'Ironhead';
      if (!scheme) scheme = schemeFor(type, 'house');
      list.push({ key: `${typeId}|${scheme && scheme.id ? scheme.id : 'house'}`, typeId, type, scheme, brand });
    }
    fleet[catId] = list;
  }
  return fleet;
}

/** At most this many types and paints are built ahead of a flight (Low's whole fleet is 8-10). */
const PREWARM_MAX = 12;

/** One of each type and paint in the fleet, the commonest kinds first, at most `max`. */
export function fleetCombos(fleet, max = PREWARM_MAX) {
  const out = [];
  const seen = new Set();
  const cats = Object.keys(fleet).sort((a, b) => (CATS[b] ? CATS[b].share : 0) - (CATS[a] ? CATS[a].share : 0));
  for (let round = 0; out.length < max; round++) {
    let any = false;
    for (const catId of cats) {
      const f = fleet[catId][round];
      if (!f) continue;
      any = true;
      if (seen.has(f.key) || out.length >= max) continue;
      seen.add(f.key);
      out.push(f);
    }
    if (!any) break;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The far shape: one instanced mesh                                   */
/* ------------------------------------------------------------------ */

/** A soft round dot (a few pixels, drawn once in code), so a light is a light and not a square. */
let DOT = null;
function dotTexture() {
  if (DOT) return DOT;
  try {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const g = cv.getContext('2d');
    const gr = g.createRadialGradient(8, 8, 0, 8, 8, 8);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.45, 'rgba(255,255,255,0.75)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 16, 16);
    DOT = new THREE.CanvasTexture(cv);
  } catch (e) {
    DOT = null;
  }
  return DOT;
}

/** The night lights: `n` points, coloured per vertex, a few pixels whatever the range, added on (glow). */
function makeLights(n) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const mat = new THREE.PointsMaterial({
    size: LIGHT_PX, sizeAttenuation: false, vertexColors: true, map: dotTexture(), transparent: true,
    depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  });
  const p = new THREE.Points(g, mat);
  p.name = 'wm-traffic:lights';
  p.frustumCulled = false;
  p.visible = false;
  p.renderOrder = 2;
  return p;
}

/** A plain aeroplane a unit long and a unit across the wings, nose to -Z. */
function proxyGeometry() {
  const parts = [
    // [sx, sy, sz, x, y, z]: the fuselage, the wings, the tailplane, the fin.
    [0.11, 0.11, 1.0, 0, 0, 0],
    [1.0, 0.018, 0.15, 0, -0.02, 0.02],
    [0.36, 0.014, 0.08, 0, 0.01, 0.43],
    [0.014, 0.17, 0.11, 0, 0.12, 0.43],
  ];
  const pos = [];
  const nor = [];
  for (const [sx, sy, sz, x, y, z] of parts) {
    const b = new THREE.BoxGeometry(sx, sy, sz).toNonIndexed();
    b.translate(x, y, z);
    pos.push(...b.attributes.position.array);
    nor.push(...b.attributes.normal.array);
    b.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.computeBoundingSphere();
  return g;
}

/* ------------------------------------------------------------------ */
/* The traffic                                                         */
/* ------------------------------------------------------------------ */

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const DAY = { isNight: false, cond: { cloud: 0 } };

function padY(p) {
  const h = (PREVIEW.heliports || []).find((q) => q.id === p.id);
  if (h && h.elev != null) return h.elev;
  let y = Math.max(0, heightAt(p.x, p.z));
  try {
    const d = platformAt(p.x, p.z);
    if (d && d.y > y) y = d.y;
  } catch (e) {
    /* no decks here */
  }
  return y + ((h && h.above) || 0);
}

export class WorldTraffic {
  constructor(sim, { quality = 'medium', seed = null } = {}) {
    this.sim = sim;
    this.quality = TIERS[quality] ? quality : 'medium';
    this.T = TIERS[this.quality];
    this.rand = makeRand(seed != null ? seed : (Date.now() & 0xffff) + 1);
    this.fleet = makeFleet(this.rand, this.T.fleet);
    this.E = endpoints({ padY });
    this._combo = null;
    this.callsigns = new Set();
    this.plan = new TrafficSim({
      tier: this.quality,
      ground: (x, z) => Math.max(0, heightAt(x, z)),
      rand: this.rand,
      endpoints: this.E,
      windDirDeg: (sim.weather && sim.weather.windDirDeg) ?? 80,
      pickType: (catId, rand) => {
        const list = this.fleet[catId] || [];
        const combo = list.length ? list[Math.floor(rand() * list.length)] : null;
        this._combo = combo;
        return combo ? combo.typeId : CATS[catId].types[0];
      },
    });
    this.plan.onEvent = (e, c) => this._onEvent(e, c);
    this.group = new THREE.Group();
    this.group.name = 'wm-traffic';
    if (sim.scene) sim.scene.add(this.group);
    // The far shapes.
    // A little light of its own, so the shaded side reads as a far aeroplane and not a black speck.
    this.proxyMat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x2a3036 });
    this.proxy = new THREE.InstancedMesh(proxyGeometry(), this.proxyMat, Math.max(1, this.plan.n + 8));
    this.proxy.name = 'wm-traffic:far';
    this.proxy.frustumCulled = false;
    this.proxy.castShadow = false;
    this.proxy.receiveShadow = false;
    this.proxy.count = 0;
    this.proxy.setColorAt(0, _c.set(0xffffff));
    this.group.add(this.proxy);
    // The lights at night: one points draw for everybody in range.
    this.lights = makeLights(Math.max(1, this.plan.n + 8) * LIGHTS.length);
    this.group.add(this.lights);
    this.lightsShown = 0;
    /** Built models: { key, model, rideOffset, small, meshes, owner, used, shadows, tier }. */
    this.models = [];
    this.assignT = 0;
    this.lastBuild = -1e9;
    this.clock = 0;
    this.on = false;
    this.stats = { builds: 0, buildMs: 0, buildMax: 0, drawnModels: 0, drawnFar: 0, ms: 0, msMax: 0, frames: 0, msSum: 0, reused: 0, bodies: 0, flightBuilds: 0 };
    /** One of each type and paint the fleet flies (the models built ahead of the flight), and how many models may be kept. */
    this.combos = fleetCombos(this.fleet, PREWARM_MAX);
    this.keep = Math.max(this.T.models + 2, this.combos.length + 2);
    this._prewarm = null;
    this._late = false;
    this.disposed = false;
    this.player = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    this.cam = { x: 0, y: 0, z: 0 };
    this.ctx = { player: this.player, cam: this.cam, windDirDeg: 80 };
    CUR = this;
  }

  /* ---- who they are ---- */

  _onEvent(e, c) {
    if (e.type === 'spawn') this._dress(c);
    else if (e.type === 'despawn') this._retire(c);
  }

  _dress(c) {
    const combo = this._combo && this._combo.typeId === c.typeId ? this._combo : (this.fleet[c.catId] || []).find((f) => f.typeId === c.typeId);
    this._combo = null;
    const type = (combo && combo.type) || getAircraft(c.typeId);
    c.data.type = type;
    c.data.combo = combo;
    c.data.key = combo ? combo.key : `${c.typeId}|house`;
    c.data.scheme = combo ? combo.scheme : schemeFor(type, 'house');
    // A callsign nobody else flying has.
    const brand = combo ? combo.brand : shortName(type);
    let n = 10 + Math.floor(this.rand() * 89);
    for (let k = 0; k < 90 && this.callsigns.has(`${brand} ${n}`); k++) n = n >= 98 ? 10 : n + 1;
    c.callsign = `${brand} ${n}`;
    this.callsigns.add(c.callsign);
    const base = c.data.scheme && c.data.scheme.base ? c.data.scheme.base : (type.livery && type.livery.base) || '#eef1f4';
    try {
      c.data.color = new THREE.Color(base);
    } catch (err) {
      c.data.color = new THREE.Color(0xeef1f4);
    }
    const self = this;
    const pos = new THREE.Vector3(c.x, c.y, c.z);
    const vel = new THREE.Vector3(c.vx, c.vy, c.vz);
    const C = c.cat;
    c.data.pos = pos;
    c.data.vel = vel;
    c.data.body = registerBody({
      id: c.id,
      kind: 'npc',
      name: c.callsign,
      bodyName: c.callsign,
      pos,
      vel,
      radius: Math.max(C.pads ? 5.5 : 3, radiusOfType(type)),
      rotor: !!C.pads,
      crew: C.pads || c.catId === 'light' ? 1 : 2,
      uniform: c.catId === 'jet' || c.catId === 'wide' || c.catId === 'prop' ? 'captain' : c.catId === 'mil' ? 'fighter' : 'casual',
      typeId: c.typeId,
      worldTraffic: true,
      hit: () => self.plan.knock(c),
      // The owner's Take over (features/owner/teleport.js): you fly it now, so it is gone from the traffic
      // (no copy of it flying on beside you).
      take: () => self.plan._despawn(c, 'taken'),
      get heading() {
        return c.hdg;
      },
      get onGround() {
        return !!c.onGround;
      },
      get model() {
        return c.data.slot ? c.data.slot.model : null;
      },
    });
    this.stats.bodies++;
  }

  _retire(c) {
    this.callsigns.delete(c.callsign);
    if (c.data.body) unregisterBody(c.data.body);
    c.data.body = null;
    const slot = c.data.slot;
    if (slot) {
      c.data.slot = null;
      slot.owner = null;
      // A knocked one's model is in pieces (features/breakup.js): it is not used again.
      if (c.knocked) this._disposeSlot(slot);
      else slot.model.visible = false;
    }
    if (this.sim.liveMap && typeof this.sim.liveMap.selected === 'function') {
      const sel = this.sim.liveMap.selected();
      if (sel && sel.kind === 'traffic' && sel.ref === c.id) this.sim.liveMap.select(null);
    }
  }

  /* ---- the models ---- */

  _build(c) {
    return this._buildModel(c.data.type, c.data.scheme, c.data.key);
  }

  _buildModel(type, scheme, key) {
    const t0 = performance.now();
    let m;
    try {
      m = createAircraftModel({ type, livery: scheme });
    } catch (e) {
      console.warn('[world-traffic] a model could not be built; it stays a far shape', e);
      return null;
    }
    // No real lights: each extra light is another loop in every lit shader on screen (traffic.js).
    const lights = [];
    m.traverse((o) => {
      if (o.isLight) lights.push(o);
    });
    for (const l of lights) if (l.parent) l.parent.remove(l);
    let rideOffset = 0;
    try {
      rideOffset = m.userData.fleetBridge ? groundOffsetFor(m, specFor(type.id)) : 0;
    } catch (e) {
      rideOffset = 0;
    }
    let small = null;
    try {
      const probe = LOD.probeMotion(m, THREE);
      if (!m.userData.fleetBridge) LOD.mergeStatic(m, THREE, probe);
      small = LOD.smallParts(m, THREE, probe.shownBySelf, SMALL_PART);
    } catch (e) {
      small = null;
    }
    const meshes = [];
    m.traverse((o) => {
      if (o.isMesh) {
        meshes.push(o);
        o.castShadow = false;
      }
    });
    m.name = `wm-traffic:${type.id}`;
    m.visible = false;
    this.group.add(m);
    const slot = { key, model: m, rideOffset, small, meshes, owner: null, used: this.clock, shadows: false, tier: -1, animOk: true, state: null };
    this.models.push(slot);
    const ms = performance.now() - t0;
    this.stats.builds++;
    this.stats.buildMs += ms;
    if (ms > this.stats.buildMax) this.stats.buildMax = ms;
    this.lastBuild = this.clock;
    if (this.on) this.stats.flightBuilds++;
    return slot;
  }

  /** The background compile of everything this draws (see start()). */
  _warmAll() {
    const sim = this.sim;
    if (!sim.renderer || !sim.camera) return null;
    const show = [...this.models.map((m) => m.model), this.lights, this.proxy];
    this._warmP = warmShadersChunked(sim.renderer, this.group, sim.camera, sim.scene, { budgetMs: 6, show }).then((ok) => {
      this.stats.warmed = ok ? (this.stats.warmed || 0) + 1 : this.stats.warmed || 0;
      return ok;
    });
    return this._warmP;
  }

  /** The fleet's models not built yet. */
  _missing() {
    return this.combos.filter((f) => !this.models.some((m) => m.key === f.key));
  }

  /**
   * One model of every type and paint the fleet flies, built one a task while
   * the menu is up (the World Map is chosen there), so no aircraft that comes
   * near in the flight waits on a build. Resolves true when they all are.
   */
  prewarm() {
    if (this._prewarm) return this._prewarm;
    this._prewarm = new Promise((resolve) => {
      const next = () => {
        if (this.disposed) return resolve(false);
        // In a flight, start() has built what was left, behind its loading screen.
        if (this.on) return resolve(this._missing().length === 0);
        const f = this._missing()[0];
        if (!f) return resolve(true);
        const slot = this._buildModel(f.type, f.scheme, f.key);
        // Its shaders too, in the background (a first sight in the flight was a whole-program link on the main
        // thread: seconds on a Chromebook). Shown for the compile only, hidden again on the next line.
        const R = this.sim.renderer;
        if (slot && R && this.sim.camera) warmShadersAsync(R, slot.model, this.sim.camera, this.sim.scene, { show: [slot.model] });
        setTimeout(next, 40);
      };
      setTimeout(next, 0);
    });
    return this._prewarm;
  }

  /** The prewarm's progress (the tests). */
  prewarmState() {
    return { combos: this.combos.length, built: this.combos.length - this._missing().length, keep: this.keep };
  }

  _disposeSlot(slot) {
    const i = this.models.indexOf(slot);
    if (i >= 0) this.models.splice(i, 1);
    const m = slot.model;
    if (m.parent) m.parent.remove(m);
    const seen = new Set();
    m.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mt of mats) {
        if (seen.has(mt)) continue;
        seen.add(mt);
        mt.dispose();
      }
    });
  }

  /** Who gets a model: the nearest few inside the tier's range; a free one of theirs, or a new one now and then. */
  _assign(force = false) {
    const T = this.T;
    const cam = this.cam;
    const list = this.plan.list;
    const want = [];
    for (const c of list) {
      if (c.gone) continue;
      const d = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z);
      c.data.dCam = d;
      if (d < T.near) want.push(c);
    }
    want.sort((a, b) => a.data.dCam - b.data.dCam);
    const keep = new Set(want.slice(0, T.models));
    // Let go of the ones that are no longer near (knocked ones keep theirs until they are gone).
    for (const c of list) {
      const slot = c.data.slot;
      if (slot && !keep.has(c) && !c.knocked) {
        c.data.slot = null;
        slot.owner = null;
        slot.model.visible = false;
        slot.used = this.clock;
      }
    }
    for (const c of keep) {
      if (c.data.slot) continue;
      let slot = this.models.find((s) => !s.owner && s.key === c.data.key);
      if (slot) this.stats.reused++;
      // At Low only a model already built (the fleet's, ahead of the flight): a build there is a ~100 ms
      // hitch on a Chromebook, so a second one of a type and paint already flying near stays a far shape.
      if (!slot && (force || ((this.quality !== 'low' || this._late) && this.clock - this.lastBuild >= T.buildGap))) {
        // Room for one more: drop the longest-unused free one of another paint first.
        if (this.models.length >= this.keep) {
          let lru = null;
          for (const s of this.models) if (!s.owner && (!lru || s.used < lru.used)) lru = s;
          if (lru) this._disposeSlot(lru);
        }
        if (this.models.length < this.keep) slot = this._build(c);
      }
      if (!slot) continue;
      slot.owner = c;
      slot.used = this.clock;
      slot.tier = -1;
      c.data.slot = slot;
    }
  }

  /* ---- the flight ---- */

  _readPlayer() {
    const sim = this.sim;
    const P = this.player;
    const drive = sim.mode === 'drive' && sim.vehicle && sim.vehicle.pos;
    const b = drive ? sim.vehicle : sim.aircraft;
    if (b && b.pos) {
      P.x = b.pos.x;
      P.y = b.pos.y;
      P.z = b.pos.z;
      const v = b.vel;
      P.vx = v ? v.x || 0 : 0;
      P.vy = v ? v.y || 0 : 0;
      P.vz = v ? v.z || 0 : 0;
      this.ctx.player = P;
    } else this.ctx.player = null;
    const cp = sim.camera && sim.camera.position;
    if (cp) {
      this.cam.x = cp.x;
      this.cam.y = cp.y;
      this.cam.z = cp.z;
      this.ctx.cam = this.cam;
    } else this.ctx.cam = this.ctx.player;
    this.ctx.windDirDeg = (sim.weather && sim.weather.windDirDeg) ?? 80;
  }

  /**
   * A flight starts on the World Map: the sky filled at once, away from you, the nearest models built now.
   * `late`: the traffic arrived after the flight was under way. With no loading screen left to hide it, the
   * whole fleet at once was ~1 s frozen on a Chromebook: the nearest few only, and the rest as they come
   * near, as before the prewarm.
   */
  start({ late = false } = {}) {
    this.clear();
    this.on = true;
    this._readPlayer();
    this.plan.windDirDeg = this.ctx.windDirDeg;
    this.plan.populate(this.ctx);
    this.plan.spawnT = 3;
    // Behind the loading screen: whatever of the fleet the menu's prewarm has not built yet, so the
    // first to come close finds its model built (a build is 16-27 ms here, ~100 ms on a Chromebook).
    const covered = !late || (typeof document !== 'undefined' && !!document.querySelector('.map-load:not(.is-out):not([hidden])'));
    this._late = !covered;
    this.on = false;
    if (covered) for (const f of this._missing()) this._buildModel(f.type, f.scheme, f.key);
    this.on = true;
    this._sync(0);
    this._assign(true);
    if (!covered) {
      const byDist = this.plan.list.slice().sort((p, q) => Math.hypot(p.x - this.cam.x, p.z - this.cam.z) - Math.hypot(q.x - this.cam.x, q.z - this.cam.z));
      for (const c of byDist) {
        if (this.models.length >= this.T.models) break;
        if (!this.models.some((m) => m.key === c.data.key)) this._build(c);
      }
    }
    // What the flight itself builds from here on (none at Low).
    this.stats.flightBuilds = 0;
    // Every model's programs, the far shapes' and the night lights', warmed a couple of seconds in (once
    // the flight's lights have settled: a program is keyed on the light count), a few meshes a step. The
    // first far shape, model or light to come into sight was a whole-program link on the main thread:
    // 7.7 s mid-flight on the Chromebook harness.
    this._warmAt = this.clock + 2;
    this._warmP = null;
    const R = this.sim.renderer;
    if (R && this.sim.camera && this.models.length) {
      try {
        for (const s of this.models) {
          const v = s.model.visible;
          s.model.visible = true;
          R.compile(s.model, this.sim.camera, this.sim.scene);
          s.model.visible = v;
        }
      } catch (e) {
        /* they compile on first sight instead */
      }
    }
  }

  stop() {
    this.on = false;
    this.clear();
  }

  clear() {
    for (const c of this.plan.list) this._retire(c);
    this.plan.clear();
    this.proxy.count = 0;
  }

  update(dt) {
    if (!this.on || !(dt > 0)) return;
    const t0 = performance.now();
    this.clock += dt;
    this._readPlayer();
    this.plan.step(dt, this.ctx);
    if (!this._warmP && this._warmAt != null && this.clock >= this._warmAt) this._warmAll();
    this.assignT -= dt;
    if (this.assignT <= 0) {
      this.assignT = ASSIGN_EVERY;
      this._assign(false);
    }
    this._sync(dt);
    const ms = performance.now() - t0;
    const st = this.stats;
    st.frames++;
    st.msSum += ms;
    st.ms = st.ms * 0.95 + ms * 0.05;
    if (st.frames > 30 && ms > st.msMax) st.msMax = ms;
  }

  /** Bodies, models and far shapes where the rails have put them. */
  _sync(dt) {
    const T = this.T;
    const cam = this.cam;
    const weather = this.sim.weather || DAY;
    const night = !!(weather.isNight || weather.time === 'dusk' || weather.time === 'sunset');
    const LP = this.lights.geometry.attributes.position;
    const LC = this.lights.geometry.attributes.color;
    const beacon = blinkLevel(this.clock, BEACON_S, 0.12, 0);
    let nl = 0;
    const lightsAt = (c, span, len) => {
      if (!night || nl + LIGHTS.length > LP.count) return;
      for (let i = 0; i < LIGHTS.length; i++) {
        const L = LIGHTS[i];
        _p.set(L[0] * span, L[1] * len, L[2] * len).applyQuaternion(_q);
        LP.setXYZ(nl, c.x + _p.x, c.y + _p.y, c.z + _p.z);
        const b = i === 3 ? beacon : 1;
        LC.setXYZ(nl, L[3] * b, L[4] * b, L[5] * b);
        nl++;
      }
    };
    let k = 0;
    let models = 0;
    const far2 = T.far * T.far;
    for (const c of this.plan.list) {
      if (c.gone) continue;
      const D = c.data;
      if (D.pos) {
        D.pos.set(c.x, c.y, c.z);
        D.vel.set(c.vx, c.vy, c.vz);
      }
      _e.set(c.pitch * DEG, -c.hdg * DEG, -c.bank * DEG, 'YXZ');
      _q.setFromEuler(_e);
      const slot = D.slot;
      if (slot) {
        const m = slot.model;
        m.position.set(c.x, c.y + slot.rideOffset, c.z);
        m.quaternion.copy(_q);
        if (!m.visible) m.visible = true;
        const d = Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z);
        const sh = d < SHADOW_NEAR && (this.quality === 'high' || this.quality === 'ultra');
        if (slot.shadows !== sh) {
          slot.shadows = sh;
          for (const o of slot.meshes) o.castShadow = sh;
        }
        const tier = d < 400 ? 0 : d < 1200 ? 1 : d < 2000 ? 2 : 3;
        if (slot.small && slot.tier !== tier) {
          slot.tier = tier;
          LOD.showParts(slot.small, tier === 0 ? 0 : tier === 1 ? 0.9 : tier === 2 ? 4 : 8);
        }
        if (slot.animOk && m.userData.update && dt > 0) {
          const s = slot.state || (slot.state = {
            controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brakes: 0 }, rpm: 0.85, flaps: 0, gearPos: 0, gearDown: false,
            onGround: false, groundSpeed: 0, engineOn: true, agl: 500, alt: 0, airspeed: 0, ias: 0, propBlur: 1,
            vel: new THREE.Vector3(), pos: new THREE.Vector3(), quat: new THREE.Quaternion(), winchLength: 0,
          });
          s.gearPos = c.gear;
          s.gearDown = c.gear > 0.5;
          s.flaps = c.flaps;
          s.onGround = !!c.onGround;
          s.groundSpeed = Math.hypot(c.vx, c.vz);
          s.airspeed = s.ias = c.v;
          s.engineOn = !c.knocked;
          s.rpm = c.knocked ? 0.3 : c.onGround && c.v < 10 ? 0.55 : 0.85;
          s.alt = c.y;
          s.agl = c.y - Math.max(0, heightAt(c.x, c.z));
          s.controls.roll = Math.max(-1, Math.min(1, c.bank / 25));
          s.vel.set(c.vx, c.vy, c.vz);
          s.pos.set(c.x, c.y, c.z);
          s.quat.copy(_q);
          try {
            m.userData.update(dt, s, weather);
          } catch (e) {
            slot.animOk = false;
          }
        }
        models++;
        {
          const span = (D.type && D.type.aero && D.type.aero.wingSpan) || (c.cat.pads ? 11 : 30);
          lightsAt(c, span, c.cat.pads ? span * 1.1 : span * (c.catId === 'light' ? 0.75 : 1.05));
        }
        continue;
      }
      // Far: the plain shape, out to the tier's range.
      const dx = c.x - cam.x;
      const dy = c.y - cam.y;
      const dz = c.z - cam.z;
      if (dx * dx + dy * dy + dz * dz > far2 || k >= this.proxy.instanceMatrix.count) continue;
      const type = D.type;
      const span = (type && type.aero && type.aero.wingSpan) || (c.cat.pads ? 11 : 30);
      const len = c.cat.pads ? span * 1.1 : span * (c.catId === 'light' ? 0.75 : 1.05);
      _p.set(c.x, c.y, c.z);
      _s.set(span, len, len);
      _m.compose(_p, _q, _s);
      this.proxy.setMatrixAt(k, _m);
      this.proxy.setColorAt(k, D.color || _c.set(0xeef1f4));
      k++;
      lightsAt(c, span, len);
    }
    this.proxy.count = k;
    this.proxy.instanceMatrix.needsUpdate = true;
    if (this.proxy.instanceColor) this.proxy.instanceColor.needsUpdate = true;
    this.stats.drawnModels = models;
    this.stats.drawnFar = k;
    this.lights.visible = nl > 0;
    this.lights.geometry.setDrawRange(0, nl);
    if (nl) {
      LP.needsUpdate = true;
      LC.needsUpdate = true;
    }
    this.lightsShown = nl;
    this.beacon = beacon;
  }

  /** For the tests and the console. */
  state() {
    return {
      on: this.on,
      quality: this.quality,
      n: this.plan.list.length,
      want: this.plan.n,
      models: this.models.length,
      modelsDrawn: this.stats.drawnModels,
      lights: this.lightsShown,
      beacon: this.beacon,
      farDrawn: this.stats.drawnFar,
      stats: { ...this.stats, mean: this.stats.frames ? this.stats.msSum / this.stats.frames : 0 },
      plan: { ...this.plan.stats },
      list: this.plan.list.map((c) => ({
        id: c.id, callsign: c.callsign, cat: c.catId, type: c.typeId, from: c.plan.from ? c.plan.from.code : null, to: c.plan.to.code,
        phase: c.phase, x: Math.round(c.x), y: Math.round(c.y), z: Math.round(c.z), hdg: Math.round(c.hdg), kts: Math.round(c.v * KT), model: !!c.data.slot,
      })),
    };
  }

  dispose() {
    this.disposed = true;
    this.stop();
    for (const s of this.models.slice()) this._disposeSlot(s);
    this.models.length = 0;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.proxy.geometry.dispose();
    this.proxyMat.dispose();
    this.lights.geometry.dispose();
    this.lights.material.dispose();
    this.proxy.dispose && this.proxy.dispose();
    if (CUR === this) CUR = null;
  }
}

export function createTraffic(sim, opts) {
  if (CUR) CUR.dispose();
  return new WorldTraffic(sim, opts);
}

/* ------------------------------------------------------------------ */
/* The live map                                                        */
/* ------------------------------------------------------------------ */

function fmtAlt(c) {
  const ft = c.y * FT;
  if (c.onGround) return 'on the ground';
  return ft >= 6000 ? `FL${String(Math.round(ft / 100)).padStart(3, '0')}` : `${(Math.round(ft / 100) * 100).toLocaleString('en-GB')} ft`;
}

const PHASE_WORDS = {
  climb: 'climbing', cruise: 'cruising', descent: 'descending', approach: 'on approach', final: 'on final', landing: 'landing', landed: 'landed',
  holding: 'holding', parked: 'parked', avoiding: 'keeping clear of you', falling: 'coming down',
};

function typeName(c) {
  return (c.data.type && c.data.type.name) || c.typeId;
}

/** The waypoint a tap selects: the same object for the same aircraft, its position live. */
function waypointOf(c) {
  if (c.data.wp) return c.data.wp;
  const wp = {
    id: `trf:${c.id}`,
    kind: 'traffic',
    ref: c.id,
    get name() {
      return c.callsign;
    },
    get long() {
      return `${typeName(c)} · ${c.plan.from ? c.plan.from.code : '—'} → ${c.plan.to.code}`;
    },
    get x() {
      return c.x;
    },
    get z() {
      return c.z;
    },
    more: () => `${typeName(c)} · ${c.plan.from ? `${c.plan.from.code} ${c.plan.from.name}` : 'diverted'} → ${c.plan.to.code} ${c.plan.to.name}`,
    facts: () => (c.gone ? 'Gone from the map' : `${fmtAlt(c)} · ${Math.round(c.v * KT)} kt · heading ${String(Math.round(c.hdg)).padStart(3, '0')}° · ${PHASE_WORDS[c.phase] || c.phase}`),
  };
  c.data.wp = wp;
  return wp;
}

/** The hovered aircraft (mouse only), by the canvas position last seen. */
const HOVER = { x: -1, y: -1, on: false, cv: null };
function wireHover(sim) {
  const ui = sim.liveMap && typeof sim.liveMap.ui === 'function' ? sim.liveMap.ui() : null;
  const cv = ui && ui.cv;
  if (!cv || HOVER.cv === cv) return;
  HOVER.cv = cv;
  cv.addEventListener('pointermove', (e) => {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    const r = cv.getBoundingClientRect();
    HOVER.x = e.clientX - r.left;
    HOVER.y = e.clientY - r.top;
    HOVER.on = true;
  });
  cv.addEventListener('pointerleave', () => {
    HOVER.on = false;
  });
}

const LAYER = { drawn: 0, labels: 0, hovered: null };

function drawSymbol(g, x, y, hdg, heli, fill, scale) {
  g.save();
  g.translate(x, y);
  g.rotate(hdg * DEG);
  g.scale(scale, scale);
  g.fillStyle = fill;
  g.strokeStyle = 'rgba(6, 12, 20, 0.85)';
  g.lineWidth = 1;
  g.beginPath();
  if (heli) {
    g.moveTo(0, -4.5);
    g.lineTo(1.7, -0.8);
    g.lineTo(1.1, 3);
    g.lineTo(0.9, 6.3);
    g.lineTo(-0.9, 6.3);
    g.lineTo(-1.1, 3);
    g.lineTo(-1.7, -0.8);
    g.closePath();
    g.moveTo(4.8, 0);
    g.arc(0, 0, 4.8, 0, Math.PI * 2);
    g.fill('evenodd');
  } else {
    g.moveTo(0, -6);
    g.lineTo(1.2, -1.4);
    g.lineTo(6, 1.4);
    g.lineTo(6, 2.7);
    g.lineTo(1.1, 1.7);
    g.lineTo(0.9, 4.3);
    g.lineTo(2.6, 5.4);
    g.lineTo(2.6, 6.3);
    g.lineTo(-2.6, 6.3);
    g.lineTo(-2.6, 5.4);
    g.lineTo(-0.9, 4.3);
    g.lineTo(-1.1, 1.7);
    g.lineTo(-6, 2.7);
    g.lineTo(-6, 1.4);
    g.lineTo(-1.2, -1.4);
    g.closePath();
    g.fill();
  }
  g.stroke();
  g.restore();
}

function tag(g, text, x, y, strong, boxes) {
  g.font = `${strong ? 700 : 600} 11px "Jost", Arial, sans-serif`;
  const w = g.measureText(text).width + 8;
  const h = 16;
  const bx = x + 9;
  const by = y - h / 2;
  for (let i = 0; i < boxes.length; i += 4) {
    if (bx < boxes[i + 2] && bx + w > boxes[i] && by < boxes[i + 3] && by + h > boxes[i + 1]) return false;
  }
  boxes.push(bx, by, bx + w, by + h);
  g.fillStyle = strong ? 'rgba(10, 18, 28, 0.9)' : 'rgba(10, 18, 28, 0.62)';
  g.beginPath();
  if (g.roundRect) g.roundRect(bx, by, w, h, 4);
  else g.rect(bx, by, w, h);
  g.fill();
  g.fillStyle = strong ? '#ffffff' : 'rgba(214, 238, 255, 0.95)';
  g.textBaseline = 'middle';
  g.fillText(text, bx + 4, by + h / 2 + 0.5);
  return true;
}

const BOXES = [];

/** Drawn over the live map: every traffic aircraft, its tag when zoomed in, the hovered or selected one's card line. */
function mapLayer(g, v, sim) {
  LAYER.drawn = 0;
  LAYER.labels = 0;
  LAYER.hovered = null;
  const T = CUR;
  if (!T || !T.on || !sim.worldPreview || !sim.worldPreview.active()) return;
  wireHover(sim);
  const s = v.s;
  const mpp = 1 / s;
  const W = v.W;
  const H = v.H;
  const sel = sim.liveMap && sim.liveMap.selected ? sim.liveMap.selected() : null;
  const selId = sel && sel.kind === 'traffic' ? sel.ref : null;
  const scale = mpp > 400 ? 0.8 : mpp > 120 ? 0.95 : 1.1;
  BOXES.length = 0;
  let hov = null;
  let hd = 16;
  const pts = [];
  for (const c of T.plan.list) {
    if (c.gone) continue;
    const x = W / 2 + (c.x - v.cx) * s;
    const y = H / 2 + (c.z - v.cz) * s;
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    pts.push([c, x, y]);
    if (HOVER.on) {
      const d = Math.hypot(x - HOVER.x, y - HOVER.y);
      if (d < hd) {
        hd = d;
        hov = c;
      }
    }
  }
  // Selected or hovered: a line to where it is going.
  for (const [c, x, y] of pts) {
    if (c.id !== selId && c !== hov) continue;
    const to = c.plan.to;
    g.strokeStyle = 'rgba(127, 211, 255, 0.55)';
    g.lineWidth = 1.4;
    g.setLineDash([4, 5]);
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(W / 2 + (to.x - v.cx) * s, H / 2 + (to.z - v.cz) * s);
    g.stroke();
    g.setLineDash([]);
  }
  for (const [c, x, y] of pts) {
    const strong = c.id === selId || c === hov;
    const fill = strong ? '#ffffff' : c.onGround ? 'rgba(170, 186, 200, 0.85)' : '#7fd3ff';
    drawSymbol(g, x, y, c.hdg, !!c.cat.pads, fill, scale);
    LAYER.drawn++;
  }
  // Tags: the strong ones first (with their destination), then callsigns where there is room, zoomed in.
  for (const [c, x, y] of pts) {
    if (c.id !== selId && c !== hov) continue;
    if (tag(g, `${c.callsign} · ${c.typeId.toUpperCase()} → ${c.plan.to.code} · ${fmtAlt(c)}`, x, y, true, BOXES)) LAYER.labels++;
  }
  if (mpp < 160) {
    for (const [c, x, y] of pts) {
      if (c.id === selId || c === hov) continue;
      if (tag(g, c.callsign, x, y, false, BOXES)) LAYER.labels++;
    }
  }
  LAYER.hovered = hov ? hov.id : null;
}

/** What a tap can pick: every traffic aircraft on the map. */
function pickSource(sim) {
  const T = CUR;
  if (!T || !T.on || !sim.worldPreview || !sim.worldPreview.active()) return [];
  return T.plan.list.filter((c) => !c.gone).map(waypointOf);
}

addMapLayer(mapLayer);
addPickSource(pickSource);

/** The live map layer's last draw (the tests). */
export function mapLayerStats() {
  return { ...LAYER };
}

export function current() {
  return CUR;
}

/** For the tests: the map id this is for. */
export const FOR_MAP = 'world-preview';
export function forThisMap() {
  return !!(MAP && MAP.id === FOR_MAP);
}

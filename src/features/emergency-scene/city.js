/**
 * Emergency services for an aeroplane that comes down in or near a TOWN.
 *
 * An airfield has its own crash tenders; anywhere else nobody used to come.
 * Now a crash, a ditching or a forced landing (stopped off the airfield with
 * a dead engine, dry tanks or real damage) is answered by the nearest town:
 *
 *   in the streets, a park, a field at the edge of town
 *       police first, then fire engines and an ambulance, by road from the
 *       town's fire and police stations (built here, the first time they are
 *       needed, beside a street end); they park round the aeroplane, cone it
 *       off, close the roads beside it, damp a burning wreck down with foam,
 *       and the ambulance takes the (unseen, unhurt) occupants to be checked
 *   on the water by a town
 *       the harbour patrol boat, and an ambulance to the quay
 *   in the hills or the forest, or with no road to it
 *       a rescue helicopter from the nearest town, which holds overhead
 *
 * WHO GOES AND WHICH WAY is ./dispatch.js (pure, checked in node). This file
 * finds the incident, asks the ground the questions dispatch needs answered,
 * and draws the answer.
 *
 * LOADED ON DEMAND: ../emergency-scene.js imports this the first time an
 * aeroplane is in trouble, and it registers itself as a feature then. On or
 * beside a runway it does nothing at all — the airfield is as it was.
 *
 * SCHOOL-SAFE: nobody is hurt and nobody is shown hurt; the words say so. The
 * light bars are the emergency scene's (models.js beaconLevels: under three
 * flashes a second, a soft swell with Reduce flashing) and the police cars
 * here always use the soft swell. Nothing is a collider.
 *
 * CHEAP: nothing exists until a response starts. Low sends three vehicles,
 * nobody on foot, no tape and no foam jet.
 */

import * as THREE from '../../vendor/three.module.js';
import { registerExtension, extLayer, extKeyContext } from '../../game/extensions.js';
import { isKey } from '../../flight/input.js';
import { heightAt, isOnAnyRunway, platformAt, OBSTACLES, MAP, FLATS, harbourMouth } from '../../world/terrain.js';
import { planTown } from '../../world/scenery.js';
import { collectPlaces } from '../livemap/places.js';
import { townContext, townStreets } from '../../world/worldmap/town-grid.js';
import { PREVIEW } from '../../world/worldmap/preview.js';
import { createPoliceCar, flashPolice } from '../events/vehicles.js';
import { hijackInfo } from '../events/bridge.js';
import { createTender, createAmbulance, createCone, createBarrier, createTape, flashBeacons } from './models.js';
import { createPerson, posePerson, disposePerson } from '../staff/person.js';
import { Batch } from '../../world/airport-kit.js';
import { seaKeepOuts, nearestSea, routeBetween, legOk } from '../ambient/lanes.js';
import { createBoat } from '../../vehicles/models.js';
import { disposeRescue } from '../ditching/scene.js';
import { createAircraftModel } from '../../aircraft/model-adapter.js';
import { getAircraft } from '../../aircraft/types.js';
import { FLASH } from '../../render/flash-safety.js';
import { multiplayer } from '../multiplayer.js';
import { sceneState } from '../emergency-scene.js';
import { planResponse, cumulative, alongPath, progress, bearing, nearRunway, crewShare, CREWS } from './dispatch.js';

const D2R = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
/** Stopped this long, off the airfield and in trouble: a forced landing. */
export const FORCED_STILL_S = 2.5;
/** A crash is answered once the wreck has stopped sliding, or after this long. */
export const CRASH_SETTLE_S = 1.6;
/** The foam is on a burning wreck this long before the fire is out. */
export const FOAM_S = 10;
/** The ambulance stays this long before it leaves with the occupants. */
export const AMBULANCE_STAY_S = 20;
/** Within a fifth of a runway's length of it, and never under or over these, is the airfield's ground: not ours. */
export const AIRFIELD_MIN_M = 250;
export const AIRFIELD_MAX_M = 500;
/** The scene is cleared when the aeroplane is this far from it (it flew on, or was reset). */
export const LEAVE_M = 1500;

const C = {
  sim: null,
  started: false,
  /** The response on now, or null. */
  R: null,
  /** One response a flight; cleared by a new flight. */
  spent: false,
  still: 0,
  crashT: 0,
  /** Where the last "airport" or "none" answer was given, so it is not asked every frame. */
  no: null,
  places: null,
  placesKey: null,
  townCtx: null,
  mats: null,
  count: 0,
  planMs: 0,
  buildMs: 0,
  watchBtn: null,
  onKey: null,
};
const POSE = { speed: 0, air: false, wave: null };
const _p = { x: 0, z: 0, heading: 0, i: 0 };

/* ------------------------------------------------------------------ */
/* What the ground says                                                */
/* ------------------------------------------------------------------ */

function tierOf(sim) {
  const q = (sim && (sim.qualityBuilt || (sim.settings && sim.settings.quality))) || 'high';
  return CREWS[q] ? q : 'high';
}

function places(sim) {
  const key = `${MAP && MAP.id}:${FLATS && FLATS.length}`;
  if (!C.places || C.placesKey !== key) {
    C.places = collectPlaces(sim);
    C.placesKey = key;
    C.townCtx = null;
  }
  return C.places;
}

/** The streets and roads a town's crews drive: [{ pts, kind }]. */
function polylinesFor(sim, town) {
  const out = [];
  if (MAP && MAP.worldPreview) {
    for (const r of (sim.roads && sim.roads.list) || []) if (r.path && r.path.length > 1) out.push({ pts: r.path, kind: 'road' });
    try {
      if (!C.townCtx) C.townCtx = townContext(PREVIEW, FLATS, (MAP.waters && MAP.waters.roads) || []);
      const F = C.townCtx.towns.find((t) => Math.hypot(t.cx - town.x, t.cz - town.z) < 60);
      if (F) for (const st of townStreets(F)) if (st.pts && st.pts.length > 1) out.push({ pts: st.pts, kind: 'street' });
    } catch (e) {
      /* the roads alone, then */
    }
    return out;
  }
  // The classic maps: what the ambient cars drive (the streets as drawn at this detail), else the plan.
  try {
    const live = sim.ambient && typeof sim.ambient.polylines === 'function' ? sim.ambient.polylines() : null;
    if (live && live.length) {
      for (const p of live) if (p.pts && p.pts.length > 1) out.push({ pts: p.pts, kind: p.kind || 'street' });
      return out;
    }
  } catch (e) {
    /* the plan, then */
  }
  for (const r of (sim.roads && sim.roads.list) || []) if (r.path && r.path.length > 1) out.push({ pts: r.path, kind: 'road' });
  try {
    const plan = planTown(MAP && MAP.scenery && MAP.scenery.town, 1);
    for (const st of (plan && plan.streets) || []) if (st.pts && st.pts.length > 1) out.push({ pts: st.pts, kind: 'street' });
  } catch (e) {
    /* no town */
  }
  return out;
}

/** The questions dispatch asks, answered for the ground within `reach` of (x, z) and in the towns near it. */
function groundFor(x, z, reach, towns = []) {
  // The buildings that matter: round the aeroplane, and in any town near enough to answer
  // (its stations are sited there, wherever the aeroplane is).
  const zones = [{ x, z, r: reach }];
  for (const t of towns) if (Math.hypot(t.x - x, t.z - z) < (t.r || 400) + 4500) zones.push({ x: t.x, z: t.z, r: (t.r || 400) * 1.2 + 40 });
  const boxes = [];
  for (let i = 0; i < OBSTACLES.length; i++) {
    const o = OBSTACLES[i];
    for (const q of zones) {
      if (o.x1 < q.x - q.r || o.x0 > q.x + q.r || o.z1 < q.z - q.r || o.z0 > q.z + q.r) continue;
      boxes.push(o);
      break;
    }
  }
  const inBox = (px, pz, r, y) => {
    for (let i = 0; i < boxes.length; i++) {
      const o = boxes[i];
      if (o.y1 <= y + 0.5) continue;
      if (px >= o.x0 - r && px <= o.x1 + r && pz >= o.z0 - r && pz <= o.z1 + r) return true;
    }
    return false;
  };
  const ok = (px, pz, r) => {
    const y = heightAt(px, pz);
    if (!(y > 1.2)) return false;
    let lo = y;
    let hi = y;
    for (const [ox, oz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) {
      const h = heightAt(px + ox, pz + oz);
      if (!(h > 1.2)) return false;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
    if (hi - lo > Math.max(1.4, r * 0.3)) return false;
    if (isOnAnyRunway(px, pz, 30)) return false;
    return !inBox(px, pz, r + 1.5, y);
  };
  const clear = (ax, az, bx, bz) => {
    const L = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(L / 6));
    let last = heightAt(ax, az);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const px = ax + (bx - ax) * t;
      const pz = az + (bz - az) * t;
      const h = heightAt(px, pz);
      // Dry, no steeper than one in four, and not through a wall.
      if (!(h > 0.8) || Math.abs(h - last) > (L / n) * 0.25 + 0.2) return false;
      if (inBox(px, pz, 2.2, h)) return false;
      last = h;
    }
    return true;
  };
  return { ok, clear, walled: inBox };
}

function seaHelpers() {
  const keep = seaKeepOuts(MAP);
  return {
    harbour(town, inc) {
      // The map's own harbour mouth when the aeroplane is off it; else the water nearest the
      // side of town the aeroplane is on.
      const r = town.r || 400;
      try {
        const m = harbourMouth();
        if (m && Math.hypot(m.x - town.x, m.z - town.z) < r + 2400 && Math.hypot(m.x - inc.x, m.z - inc.z) < 1500) {
          const s = nearestSea(keep, m.x, m.z, 600);
          if (s) return s;
        }
      } catch (e) {
        /* the nearest water, then */
      }
      const d = Math.hypot(inc.x - town.x, inc.z - town.z) || 1;
      const k = Math.min(1, r / d);
      return nearestSea(keep, town.x + (inc.x - town.x) * k, town.z + (inc.z - town.z) * k, r + 2400);
    },
    seaRoute(a, b) {
      const B = nearestSea(keep, b[0], b[1], 400) || b;
      if (legOk(keep, a, B)) return [a, B];
      const r = routeBetween(keep, a, B);
      return r && r.pts && r.pts.length > 1 ? r.pts : null;
    },
  };
}

/**
 * The airfield's own ground: the strips themselves, and within a fifth of a runway's length of
 * it (250 to 500 m: the aprons, the terminal, the fire station of a field that size). Measured
 * from the runway's line, not a box round it, so a town off the end of a short runway is a town.
 */
export function onAirfield(P, x, z) {
  if (isOnAnyRunway(x, z, 40)) return true;
  for (const r of runwaysOf(P)) if (nearRunway([r], x, z, Math.max(AIRFIELD_MIN_M, Math.min(AIRFIELD_MAX_M, (r.length || 0) * 0.2)))) return true;
  return false;
}

function runwaysOf(P) {
  const out = [];
  for (const a of P.airports || []) for (const r of a.runways || []) out.push(r);
  return out;
}

/* ------------------------------------------------------------------ */
/* Is this one of ours?                                                */
/* ------------------------------------------------------------------ */

function eligible(sim) {
  if (!sim || !sim.mode || sim.vehicle || sim.riding) return false;
  try {
    if (multiplayer && multiplayer.role) return false;
    if (extKeyContext(sim) === 'rocket') return false;
    // A mission's own cordon (the hijacks, the Big Burn) is the emergency already.
    if (sceneState().scenes.length) return false;
  } catch (e) {
    return false;
  }
  return true;
}

function inTrouble(ac) {
  return !!(ac.failures && ac.failures.engine) || ac.fuel <= 0 || ac.worstDamage > 0.3;
}

/** Called every frame (flying, and behind the debrief): has something happened that wants an answer? */
function watch(sim, dt) {
  const ac = sim.aircraft;
  if (!ac || C.R || C.spent || !eligible(sim)) return;
  let kind = null;
  if (ac.crashed) {
    C.crashT += dt;
    if (C.crashT >= CRASH_SETTLE_S || ac.vel.length() < 1.5) kind = 'crash';
  } else if (ac.ditched) {
    if (ac.vel.length() < 4) kind = 'ditch';
  } else if (ac.onGround && ac.groundSpeed < 1.2 && inTrouble(ac)) {
    C.still += dt;
    if (C.still >= FORCED_STILL_S) kind = 'forced';
  } else {
    C.still = 0;
    C.crashT = 0;
  }
  if (!kind) return;
  // Asked here already, and the answer was no.
  if (C.no && C.no.kind === kind && Math.hypot(C.no.x - ac.pos.x, C.no.z - ac.pos.z) < 250) return;
  respond(sim, kind);
}

/* ------------------------------------------------------------------ */
/* The response                                                        */
/* ------------------------------------------------------------------ */

function incidentOf(sim, kind) {
  const ac = sim.aircraft;
  const h = heightAt(ac.pos.x, ac.pos.z);
  return { x: ac.pos.x, z: ac.pos.z, y: h, kind, water: kind === 'ditch' || (h < -0.3 && ac.pos.y < 4) };
}

/** Plan and raise the answer to an incident of `kind` where the aeroplane is now. Returns the plan's case. */
export function respond(sim, kind, at = null) {
  if (C.R) clear(sim);
  const t0 = performance.now();
  const inc = at ? { x: at.x, z: at.z, y: heightAt(at.x, at.z), kind, water: kind === 'ditch' || heightAt(at.x, at.z) < -0.3 } : incidentOf(sim, kind);
  // On a deck (the carrier, a rig): the ship's own business.
  if (platformAt(inc.x, inc.z)) {
    C.no = { x: inc.x, z: inc.z, kind, case: 'deck' };
    return 'deck';
  }
  const P = places(sim);
  const G = groundFor(inc.x, inc.z, 900, P.towns);
  const sea = inc.water ? seaHelpers() : {};
  const tier = tierOf(sim);
  const span = (sim.aircraftType && sim.aircraftType.plan && sim.aircraftType.plan.span) || 12;
  let plan = null;
  try {
    plan = planResponse({
      incident: inc, towns: P.towns, polylines: (town) => polylinesFor(sim, town), tier, span,
      onAirfield: (x, z) => onAirfield(P, x, z),
      ok: G.ok, clear: G.clear, harbour: sea.harbour, seaRoute: sea.seaRoute,
      ditchOwn: kind === 'ditch',
    });
  } catch (e) {
    console.warn('[city-emergency] no plan', e);
    plan = { case: 'none' };
  }
  C.planMs = performance.now() - t0;
  if (plan.case === 'airport' || plan.case === 'none') {
    C.no = { x: inc.x, z: inc.z, kind, case: plan.case };
    return plan.case;
  }
  const t1 = performance.now();
  C.R = raise(sim, inc, plan, tier);
  // Asked for somewhere the aeroplane is not (the console, the tests): it stays until cleared.
  C.R.placed = !!at;
  C.R.walled = G.walled;
  C.buildMs = performance.now() - t1;
  C.spent = true;
  C.count++;
  const from = plan.town && plan.town.name ? ` from ${plan.town.name}` : '';
  const words = plan.case === 'town' ? `Emergency services on the way${from}` : plan.case === 'water' ? `Harbour patrol boat on the way${from}` : `Rescue helicopter on the way${from}`;
  say(sim, words, 'info', 6);
  addWatchButton(sim);
  return plan.case;
}

function say(sim, text, kind = 'info', secs = 5) {
  try {
    if (sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
  } catch (e) {
    /* words only */
  }
  if (C.R) C.R.said.push(text);
}

function materials() {
  if (C.mats) return C.mats;
  const sign = (text, bg, fg) => {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 48;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, 256, 48);
    g.fillStyle = fg;
    g.font = 'bold 30px "Jost", Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 26);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return new THREE.MeshBasicMaterial({ map: t });
  };
  C.mats = {
    vc: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.02 }),
    fireSign: sign('FIRE STATION', '#f4f1ea', '#b3271f'),
    policeSign: sign('POLICE', '#1f3d7a', '#ffffff'),
    foam: new THREE.MeshBasicMaterial({ color: 0xe9eeea, transparent: true, opacity: 0.82, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
    jet: new THREE.PointsMaterial({ color: 0xf4f7f8, size: 0.55, transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true }),
    hose: new THREE.MeshBasicMaterial({ color: 0xc9a227 }),
    plane: new THREE.PlaneGeometry(1, 1),
    disc: new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2),
    box: new THREE.BoxGeometry(1, 1, 1),
  };
  return C.mats;
}

/** A small station, doors along -Z, origin mid-floor: one merged mesh and a sign. */
function buildStation(kind) {
  const M = materials();
  const b = new Batch();
  const g = new THREE.Group();
  g.name = `city-${kind}-station`;
  if (kind === 'fire') {
    // Brick, three appliance bays, a flat roof and the drying tower.
    b.box(16, 8, 11, 0, 2, 0, 0xa5493a);
    b.box(16.6, 0.4, 11.6, 0, 6.2, 0, 0x55595e);
    for (const x of [-5, 0, 5]) b.box(3.8, 4.2, 0.2, x, 2.1, -5.55, x === 0 ? 0xc8322a : 0xd9dcdf);
    b.box(16, 0.5, 0.25, 0, 4.9, -5.56, 0xf2efe6);
    b.box(3, 12, 3, 6.2, 6, 3.6, 0x9a4335);
    b.box(3.4, 0.4, 3.4, 6.2, 12.2, 3.6, 0x55595e);
  } else {
    // Blue-grey stone, a door, four windows and the lamp.
    b.box(12, 7, 9, 0, 1.5, 0, 0x7d8898);
    b.box(12.6, 0.4, 9.6, 0, 5.2, 0, 0x4a4f57);
    b.box(1.6, 2.6, 0.2, 0, 1.3, -4.55, 0x1f2d4a);
    for (const x of [-4.2, -2.3, 2.3, 4.2]) b.box(1.3, 1.5, 0.15, x, 2.6, -4.55, 0x2a3644);
    b.box(0.5, 0.6, 0.5, 1.4, 3.2, -4.8, 0x3a7bff);
  }
  const mesh = b.mesh(M.vc, { name: `${g.name}-body` });
  g.add(mesh);
  g.userData.own = [mesh.geometry];
  const sign = new THREE.Mesh(M.plane, kind === 'fire' ? M.fireSign : M.policeSign);
  sign.scale.set(kind === 'fire' ? 7 : 4.2, kind === 'fire' ? 1.1 : 0.8, 1);
  sign.position.set(0, kind === 'fire' ? 5.5 : 4.3, kind === 'fire' ? -5.72 : -4.62);
  sign.rotation.y = Math.PI;
  g.add(sign);
  return g;
}

function makeVehicle(kind) {
  if (kind === 'fire') return createTender();
  if (kind === 'ambulance') return createAmbulance();
  return createPoliceCar();
}

const PIN = { fire: '#ff5a3c', ambulance: '#3ecf7a', police: '#5a8cff', boat: '#5ad1ff', heli: '#ffd23f' };

function addPin(R, sim, x, z, label, colour) {
  const pin = { x, z, label, colour };
  if (!Array.isArray(sim.mapPins)) {
    sim.mapPins = [];
    R.ownsPins = true;
  }
  sim.mapPins.push(pin);
  R.pins.push(pin);
  return pin;
}

function place(obj, x, z, headingDeg) {
  obj.position.set(x, heightAt(x, z) + 0.04, z);
  obj.rotation.set(0, -headingDeg * D2R, 0);
}

function raise(sim, inc, plan, tier) {
  const R = {
    inc, plan, tier, kind: inc.kind, case: plan.case, t: 0,
    group: new THREE.Group(), units: [], people: [], cones: [], tapes: [], own: [], pins: [], said: [],
    ownsPins: false, thin: null, boat: null, heli: null, foam: null, jet: null, hose: null,
    burning: null, fireOut: false, foamT: -1, coned: false, onScene: 0, ambulanceGone: false, done: false, doneT: 0, watching: false,
  };
  R.group.name = 'city-emergency';
  sim.scene.add(R.group);
  const st = plan.stations;
  if (st) {
    for (const s of st.police && !st.police.shared ? [st.fire, st.police] : [st.fire]) {
      if (!s.built) continue;
      const b = buildStation(s.kind);
      place(b, s.x, s.z, s.heading);
      // Sunk a little, so a slope under it shows no gap.
      b.position.y -= 0.9;
      R.group.add(b);
      R.own.push(...b.userData.own);
      s.obj = b;
    }
    addPin(R, sim, st.fire.x, st.fire.z, 'Fire station', PIN.fire);
  }
  for (const u of plan.units) {
    const obj = makeVehicle(u.kind);
    const unit = { ...u, obj, cum: cumulative(u.pts), hint: 0, state: 'drive', h: 0, hereT: 0, x: 0, z: 0, pin: null, leaving: null };
    alongPath(unit.pts, unit.cum, unit.startS, _p);
    unit.x = _p.x;
    unit.z = _p.z;
    unit.h = _p.heading;
    place(obj, unit.x, unit.z, unit.h);
    R.group.add(obj);
    unit.pin = addPin(R, sim, unit.x, unit.z, '', PIN[u.kind]);
    R.units.push(unit);
  }
  if (plan.boat) {
    const m = createBoat();
    m.name = 'city-harbour-boat';
    R.group.add(m);
    R.boat = { ...plan.boat, obj: m, cum: cumulative(plan.boat.pts), hint: 0, here: false, pin: addPin(R, sim, plan.boat.pts[0][0], plan.boat.pts[0][1], 'Harbour patrol', PIN.boat) };
  }
  if (plan.heli) {
    let m = null;
    try {
      m = createAircraftModel({ type: getAircraft('aw139'), landingLight: false });
    } catch (e) {
      m = null;
    }
    if (m) {
      m.name = 'city-rescue-heli';
      R.group.add(m);
    }
    R.heli = { ...plan.heli, obj: m, here: false, leave: -1, gone: false, pin: addPin(R, sim, plan.heli.from.x, plan.heli.from.z, 'Rescue helicopter', PIN.heli) };
  }
  // Where they start, before the first frame.
  if (R.boat) stepBoat(R, sim, 0);
  if (R.heli) stepHeli(R, sim, 0);
  // The ambient traffic keeps out: the police have the roads.
  try {
    if (plan.case === 'town' && sim.ambient && typeof sim.ambient.thinAround === 'function') R.thin = sim.ambient.thinAround(inc.x, inc.z, (plan.clearR || 20) + 75);
  } catch (e) {
    R.thin = null;
  }
  return R;
}

/* ---- the cordon ---- */

function coneOff(R) {
  if (R.coned || R.case !== 'town') return;
  R.coned = true;
  const { inc, plan, tier } = R;
  const n = tier === 'low' ? 6 : 10;
  const rad = plan.clearR + 3;
  const pts = [];
  for (let i = 0; i < n; i++) {
    // A gap on the side the engines come in.
    const a = plan.base + 36 + (i / (n - 1)) * 288;
    const x = inc.x + Math.sin(a * D2R) * rad;
    const z = inc.z - Math.cos(a * D2R) * rad;
    const y = heightAt(x, z);
    // Not in the water, and not inside a house.
    if (!(y > 0.6) || (R.walled && R.walled(x, z, 0.4, y))) {
      pts.push(null);
      continue;
    }
    const c = createCone();
    c.position.set(x, y, z);
    R.group.add(c);
    R.cones.push(c);
    pts.push([x, y, z]);
  }
  if (tier === 'low') return;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    if (!a || !b || Math.abs(a[1] - b[1]) > 1.2) continue;
    const t = createTape(a[0], a[2], b[0], b[2], (a[1] + b[1]) / 2 + 0.55);
    R.group.add(t);
    R.tapes.push(t);
  }
}

/** Cones and a barrier across a closed road, beyond the police car. */
function closeRoad(R, u) {
  const b = u.block;
  const across = b.heading + 90;
  const ax = Math.sin(across * D2R);
  const az = -Math.cos(across * D2R);
  const ox = Math.sin(b.heading * D2R) * 7;
  const oz = -Math.cos(b.heading * D2R) * 7;
  for (const k of [-3.2, -1.6, 0, 1.6, 3.2]) {
    const c = createCone();
    const x = b.x + ox + ax * k;
    const z = b.z + oz + az * k;
    c.position.set(x, heightAt(x, z), z);
    R.group.add(c);
    R.cones.push(c);
  }
  const bar = createBarrier();
  place(bar, b.x + ox * 1.5, b.z + oz * 1.5, across);
  bar.rotation.y = -across * D2R;
  R.group.add(bar);
}

/* ---- people ---- */

function person(R, outfit, x, z, h, tasks, opts = {}) {
  const obj = createPerson({ outfit, lite: true, seed: 31 + R.people.length * 13, ...opts });
  obj.name = `city-${opts.role || outfit}`;
  R.group.add(obj);
  const p = { obj, x, z, h, tasks, role: opts.role || outfit, gone: false };
  R.people.push(p);
  return p;
}

function stepPerson(p, dt) {
  if (p.gone) return;
  let speed = 0;
  let wave = null;
  const task = p.tasks[0];
  if (task) {
    if (task.to) {
      const dx = task.to[0] - p.x;
      const dz = task.to[1] - p.z;
      const d = Math.hypot(dx, dz);
      const v = task.v || 1.5;
      if (d < 0.25) p.tasks.shift();
      else {
        const m = Math.min(d, v * dt);
        p.x += (dx / d) * m;
        p.z += (dz / d) * m;
        p.h = bearing(0, 0, dx, dz);
        speed = v;
      }
    } else if (task.wait != null) {
      task.wait -= dt;
      wave = task.wave || null;
      if (task.face != null) p.h = task.face;
      if (task.wait <= 0) {
        p.tasks.shift();
        if (task.again) p.tasks.push(...task.again());
      }
    } else if (task.gone) {
      p.gone = true;
      p.obj.visible = false;
      return;
    }
  }
  p.obj.position.set(p.x, heightAt(p.x, p.z), p.z);
  p.obj.rotation.y = -p.h * D2R;
  POSE.speed = speed;
  POSE.wave = wave;
  posePerson(p.obj, dt, POSE);
}

/** How many more of this role may walk about (dispatch.js crewShare). */
function budget(R, role) {
  if (!R.share) R.share = crewShare(R.plan.people);
  return (R.share[role] || 0) - R.people.filter((p) => p.role === role).length;
}

/** A walk round the aeroplane, outside the cones' radius by `off`, starting nearest (x, z). */
function circuit(R, x, z, off) {
  const { inc, plan } = R;
  const rad = Math.max(8, plan.clearR + off);
  const a0 = bearing(inc.x, inc.z, x, z);
  const out = [];
  for (let i = 0; i <= 8; i++) {
    const a = a0 + i * 45;
    const px = inc.x + Math.sin(a * D2R) * rad;
    const pz = inc.z - Math.cos(a * D2R) * rad;
    const y = heightAt(px, pz);
    if (y > 0.8 && !(R.walled && R.walled(px, pz, 0.6, y))) out.push({ to: [px, pz], v: 1.3 });
    if (i % 2 === 1) out.push({ wait: 3, face: (a + 180) % 360 });
  }
  return out;
}

function arrived(R, sim, u) {
  const { inc, plan } = R;
  R.onScene++;
  coneOff(R);
  const sideX = Math.sin((u.heading + 90) * D2R);
  const sideZ = -Math.cos((u.heading + 90) * D2R);
  const out = [u.park.x + sideX * 2.4, u.park.z + sideZ * 2.4];
  const face = bearing(u.park.x, u.park.z, inc.x, inc.z);
  if (u.kind === 'police') {
    if (!R.policeSaid) say(sim, 'Police on scene. The roads round you are closed.', 'info', 5);
    R.policeSaid = true;
    if (u.block) {
      closeRoad(R, u);
      // Holding the traffic.
      if (budget(R, 'police') > 0) person(R, 'police', u.block.x + Math.sin(u.block.heading * D2R) * 10, u.block.z - Math.cos(u.block.heading * D2R) * 10, u.block.heading, [{ wait: 1e9, wave: 'stop', face: u.block.heading }], { role: 'police' });
    } else if (budget(R, 'police') > 0) {
      const loop = () => circuit(R, out[0], out[1], 6).concat([{ wait: 4, again: loop }]);
      person(R, 'police', out[0], out[1], face, loop(), { role: 'police' });
    }
  } else if (u.kind === 'fire') {
    const first = !R.units.some((o) => o !== u && o.kind === 'fire' && o.state !== 'drive');
    if (first) {
      R.burning = inc.kind === 'crash' && !inc.water && !!(sim.wreck && sim.wreck.active && !sim.wreck.hushed);
      if (R.burning && !u.onStreet) startFoam(R, sim, u);
      else if (R.burning) R.foamT = 0;
      say(sim, R.burning ? 'Fire crews on scene: foam on the wreck.' : 'Fire crews on scene, standing by.', 'info', 5);
    }
    if (budget(R, 'firefighter') > 0) {
      // One on the branch (the hose), between the engine and the aeroplane.
      const hx = u.park.x + (inc.x - u.park.x) * 0.45;
      const hz = u.park.z + (inc.z - u.park.z) * 0.45;
      const tasks = first && R.burning ? [{ to: [hx, hz], v: 2.2 }, { wait: FOAM_S + 2, face }, { wait: 1e9, face }] : circuit(R, out[0], out[1], -3).concat([{ wait: 1e9, face }]);
      person(R, 'firecrew', out[0], out[1], face, tasks, { role: 'firefighter' });
    }
    if (budget(R, 'firefighter') > 0) person(R, 'firecrew', out[0] + sideX, out[1] + sideZ, face, [{ wait: 2 }, ...circuit(R, out[0], out[1], -2), { wait: 1e9, face }], { role: 'firefighter' });
  } else if (u.kind === 'ambulance') {
    u.hereT = R.t;
    if (u.quay) say(sim, 'An ambulance is waiting at the quay.', 'info', 5);
    else {
      say(sim, 'Ambulance on scene. Everyone is out and unhurt.', 'good', 5);
      // Two of the crew to the aeroplane and back.
      const d = Math.hypot(inc.x - u.park.x, inc.z - u.park.z) || 1;
      const stop = Math.max(0, d - Math.max(5, plan.clearR * 0.35));
      const tx = u.park.x + ((inc.x - u.park.x) / d) * stop;
      const tz = u.park.z + ((inc.z - u.park.z) / d) * stop;
      for (let i = 0; i < 2 && budget(R, 'paramedic') > 0; i++) {
        const o = i ? 1.2 : -1.2;
        person(R, 'passenger', out[0] + sideX * o, out[1] + sideZ * o, face, [{ wait: 1 + i }, { to: [tx + sideX * o, tz + sideZ * o], v: 2.4 }, { wait: 7, face }, { to: [out[0] + sideX * o, out[1] + sideZ * o], v: 2 }, { gone: true }], { role: 'paramedic', shirt: 0x2e7d4f, trousers: 0x1f4a33 });
      }
    }
  }
}

/* ---- foam ---- */

function startFoam(R, sim, u) {
  const M = materials();
  const { inc, tier } = R;
  R.foamT = 0;
  const from = new THREE.Vector3(u.park.x, heightAt(u.park.x, u.park.z) + 3.4, u.park.z);
  const to = new THREE.Vector3(inc.x, Math.max(0, inc.y) + 1.2, inc.z);
  const foam = new THREE.Mesh(M.disc, M.foam);
  foam.name = 'city-foam';
  foam.position.set(inc.x, Math.max(0, inc.y) + 0.14, inc.z);
  foam.scale.setScalar(0.01);
  foam.renderOrder = 2;
  R.group.add(foam);
  R.foam = foam;
  if (tier === 'low') return;
  const N = 48;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const jet = new THREE.Points(geo, M.jet);
  jet.name = 'city-foam-jet';
  jet.frustumCulled = false;
  jet.userData = { from, to, N, arc: Math.max(3, from.distanceTo(to) * 0.22) };
  R.group.add(jet);
  R.jet = jet;
  R.own.push(geo);
  // The hose on the ground, engine to branch.
  const L = Math.hypot(inc.x - u.park.x, inc.z - u.park.z) * 0.45;
  const hose = new THREE.Mesh(M.box, M.hose);
  hose.name = 'city-hose';
  hose.scale.set(0.14, 0.1, L);
  const mx = u.park.x + (inc.x - u.park.x) * 0.225;
  const mz = u.park.z + (inc.z - u.park.z) * 0.225;
  hose.position.set(mx, heightAt(mx, mz) + 0.07, mz);
  hose.rotation.y = -bearing(u.park.x, u.park.z, inc.x, inc.z) * D2R;
  R.group.add(hose);
  R.hose = hose;
}

function stepFoam(R, sim, dt) {
  if (R.foamT < 0 || R.fireOut) return;
  R.foamT += dt;
  const k = Math.min(1, R.foamT / FOAM_S);
  if (R.foam) R.foam.scale.setScalar(Math.max(0.01, k * Math.max(5, R.plan.clearR * 0.5)));
  if (R.jet) {
    const { from, to, N, arc } = R.jet.userData;
    const pos = R.jet.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      const u = (R.foamT * 0.9 + i / N) % 1;
      // A little spread, the same for a particle every time round: no flicker.
      const s = ((i * 7919) % 13) / 13 - 0.5;
      pos[i * 3] = from.x + (to.x - from.x) * u + s * u * 1.6;
      pos[i * 3 + 1] = from.y + (to.y - from.y) * u + arc * 4 * u * (1 - u);
      pos[i * 3 + 2] = from.z + (to.z - from.z) * u - s * u * 1.6;
    }
    R.jet.geometry.attributes.position.needsUpdate = true;
  }
  if (k >= 1) {
    R.fireOut = true;
    if (R.jet) R.jet.visible = false;
    // No more smoke to come; what is in the air drifts off.
    try {
      const w = sim.wreck;
      if (w && w.smoke) for (const s of w.smoke.state) if (s.age < 0) s.age = 1e3;
      if (w && w.light) w.light.intensity = 0;
    } catch (e) {
      /* the smoke runs its own course */
    }
    say(sim, 'The fire is out.', 'good', 5);
  }
}

/* ---- every frame ---- */

function stepUnit(R, sim, u, dt) {
  if (u.state === 'gone') return;
  if (u.state === 'drive' || u.state === 'leave') {
    const L = u.state === 'leave' ? u.leaving : u;
    const k = (R.t - L.depart) / Math.max(0.01, L.eta - L.depart);
    const s = L.startS + (L.len - L.startS) * progress(k);
    alongPath(L.pts, L.cum, s, _p, L.hint);
    L.hint = _p.i;
    u.x = _p.x;
    u.z = _p.z;
    // Turn with the road, not in one frame.
    let dh = ((_p.heading - u.h + 540) % 360) - 180;
    u.h = (u.h + dh * Math.min(1, dt * 5) + 360) % 360;
    if (k >= 1) {
      if (u.state === 'leave') {
        u.state = 'gone';
        u.obj.visible = false;
        if (u.pin) u.pin.x = NaN;
        return;
      }
      u.state = 'parked';
      u.x = u.park.x;
      u.z = u.park.z;
      arrived(R, sim, u);
    }
  } else if (u.state === 'parked') {
    const dh = ((u.heading - u.h + 540) % 360) - 180;
    if (Math.abs(dh) > 0.2) u.h = (u.h + dh * Math.min(1, dt * 2.5) + 360) % 360;
    // The ambulance goes, with whoever was aboard the aeroplane, once its crew are back.
    if (u.kind === 'ambulance' && !u.quay && R.t - u.hereT >= AMBULANCE_STAY_S && !R.people.some((p) => p.role === 'paramedic' && !p.gone)) {
      const pts = u.pts.slice().reverse();
      const cum = cumulative(pts);
      const len = cum[cum.length - 1];
      // Out of sight by 700 m, or home if home is nearer.
      const run = Math.min(len, 700);
      u.leaving = { pts, cum, hint: 0, depart: R.t + 1, eta: R.t + 1 + run / u.speed, startS: 0, len: run };
      u.state = 'leave';
      R.ambulanceGone = true;
      say(sim, R.kind === 'forced' ? 'The ambulance crew have checked everyone over: all well.' : 'Everyone is safe. The ambulance is taking them to be checked over.', 'good', 6);
    }
    if (u.state === 'parked' && Math.abs(dh) <= 0.2 && u.settled) return;
    u.settled = Math.abs(dh) <= 0.2;
  }
  place(u.obj, u.x, u.z, u.h);
  if (u.pin) {
    u.pin.x = u.x;
    u.pin.z = u.z;
  }
}

function stepBoat(R, sim, dt) {
  const b = R.boat;
  const k = (R.t - b.depart) / Math.max(0.01, b.eta - b.depart);
  const s = b.startS + (b.len - b.startS) * progress(k);
  alongPath(b.pts, b.cum, s, _p, b.hint);
  b.hint = _p.i;
  b.obj.position.set(_p.x, Math.sin(R.t * 1.2) * 0.12, _p.z);
  b.obj.quaternion.setFromAxisAngle(UP, -_p.heading * D2R);
  b.obj.rotateX((k < 1 && k > 0 ? 0.05 : 0) + Math.sin(R.t * 0.9) * 0.02);
  b.pin.x = _p.x;
  b.pin.z = _p.z;
  if (k >= 1 && !b.here) {
    b.here = true;
    R.onScene++;
    say(sim, 'Harbour patrol alongside. Everyone is safe.', 'good', 6);
  }
}

function stepHeli(R, sim, dt) {
  const h = R.heli;
  if (h.gone) return;
  const { inc } = R;
  let k = (R.t - h.depart) / Math.max(0.01, h.eta - h.depart);
  let from = h.from;
  let to = h.to;
  let leaving = false;
  if (h.leave >= 0) {
    // Home again.
    leaving = true;
    k = (R.t - h.leave) / 30;
    from = h.to;
    to = h.from;
    if (k >= 1 || Math.hypot(h.x - inc.x, h.z - inc.z) > 1600) {
      h.gone = true;
      if (h.obj) h.obj.visible = false;
      h.pin.x = NaN;
      return;
    }
  }
  const e = leaving ? k * k : progress(Math.max(0, k));
  // Off to one side of the aeroplane, never over it.
  const hdg = bearing(h.from.x, h.from.z, h.to.x, h.to.z);
  const ox = Math.sin((hdg + 90) * D2R) * 26;
  const oz = -Math.cos((hdg + 90) * D2R) * 26;
  const x = from.x + (to.x - from.x) * e + ox;
  const z = from.z + (to.z - from.z) * e + oz;
  // Seventy metres over the ground on the way, down to a hover 24 m over the aeroplane.
  const hover = Math.max(0, inc.y) + 24;
  const high = leaving ? Math.min(1, e * 3) : 1 - e;
  const y = Math.max(hover, Math.max(0, heightAt(x, z)) + 24 + high * 46) + Math.sin(R.t * 0.8) * 0.4;
  h.x = x;
  h.z = z;
  h.y = y;
  h.pin.x = x;
  h.pin.z = z;
  if (h.obj) {
    h.obj.position.set(x, y, z);
    h.obj.quaternion.setFromAxisAngle(UP, -(leaving ? hdg + 180 : hdg) * D2R);
    if (h.obj.userData.update) {
      try {
        h.obj.userData.update(dt, {
          controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brakes: 0 },
          rpm: 0.8, flaps: 0, gearPos: 1, gearDown: true, onGround: false, propBlur: 1, rotorNr: 1,
          groundSpeed: 12, engineOn: true, agl: y, alt: y, vel: UP, pos: h.obj.position, quat: h.obj.quaternion,
        }, sim.weather);
      } catch (err) {
        h.obj.userData.update = null;
      }
    }
  }
  if (k >= 1 && !h.here) {
    h.here = true;
    h.hereT = R.t;
    R.onScene++;
    say(sim, 'Rescue helicopter overhead. Everyone is safe.', 'good', 6);
  }
  if (h.here && h.leave < 0 && R.t - h.hereT > 28) {
    h.leave = R.t;
    say(sim, 'The helicopter has everyone aboard and is heading back.', 'good', 6);
  }
}

function tick(sim, dt) {
  const R = C.R;
  if (!R || !(dt > 0)) return;
  R.t += dt;
  for (const u of R.units) stepUnit(R, sim, u, dt);
  if (R.boat) stepBoat(R, sim, dt);
  if (R.heli) stepHeli(R, sim, dt);
  for (const p of R.people) stepPerson(p, dt);
  stepFoam(R, sim, dt);
  if (R.units.length) {
    flashBeacons(R.t);
    // The police bars: always the soft swell here (the hard pattern is five flashes in its worst second).
    let hij = 0;
    try {
      hij = hijackInfo().police;
    } catch (e) {
      hij = 0;
    }
    if (!(hij > 0)) {
      const was = FLASH.reduce;
      FLASH.reduce = true;
      try {
        flashPolice(R.t);
      } finally {
        FLASH.reduce = was;
      }
    }
  }
  // Finished: everyone who is coming has come, the fire is out and the ambulance has gone.
  if (!R.done) {
    const allHere = R.units.every((u) => u.state !== 'drive') && (!R.boat || R.boat.here) && (!R.heli || R.heli.here);
    const amb = R.units.some((u) => u.kind === 'ambulance' && !u.quay);
    if (allHere && (!R.burning || R.fireOut) && (!amb || R.ambulanceGone) && (!R.heli || R.heli.leave >= 0)) {
      R.done = true;
      R.doneT = R.t;
    }
  } else if (R.watching && R.t - R.doneT > 6) backToResults(sim);
  // The aeroplane has gone (flown on, or put back on the runway).
  const ac = sim.aircraft;
  if (ac && !R.placed && Math.hypot(ac.pos.x - R.inc.x, ac.pos.z - R.inc.z) > LEAVE_M) clear(sim);
}

/* ------------------------------------------------------------------ */
/* Watching it from the debrief                                        */
/* ------------------------------------------------------------------ */

function debriefActions() {
  return document.querySelector('[data-screen="debrief"] [data-actions]');
}

/** "Watch the rescue" on the crash card, while there is a rescue to watch. */
function addWatchButton(sim) {
  try {
    const R = C.R;
    if (!R || R.done || !sim.menus || sim.menus.current !== 'debrief' || sim.state !== 'debrief') return;
    const host = debriefActions();
    if (!host || host.querySelector('[data-city-watch]')) return;
    const b = document.createElement('button');
    b.textContent = 'Watch the rescue';
    b.dataset.cityWatch = '1';
    b.addEventListener('click', () => watchRescue(sim));
    host.appendChild(b);
  } catch (e) {
    /* the card as it was */
  }
}

function watchRescue(sim) {
  const R = C.R;
  if (!R || sim.state !== 'debrief') return;
  R.watching = true;
  sim.menus.hide();
  if (!C.watchBtn) {
    const b = document.createElement('button');
    b.textContent = 'Back to results';
    b.dataset.cityBack = '1';
    Object.assign(b.style, {
      position: 'absolute', left: '50%', bottom: 'max(22px, env(safe-area-inset-bottom))', transform: 'translateX(-50%)', pointerEvents: 'auto',
      minHeight: '48px', padding: '12px 22px', font: '600 16px var(--font, "Jost", Arial, sans-serif)', color: '#fff', background: 'rgba(20,28,40,0.82)',
      border: '1px solid rgba(255,255,255,0.35)', borderRadius: '12px', touchAction: 'manipulation',
    });
    b.addEventListener('click', () => backToResults(sim));
    C.watchBtn = b;
  }
  extLayer().appendChild(C.watchBtn);
  // The pause key (Esc, or wherever the player has put it) is the same button.
  if (!C.onKey) {
    C.onKey = (e) => {
      if (!isKey(sim, 'pause', e.code)) return;
      // Ours alone: the game's own Esc (pause) must not hear it too.
      e.stopImmediatePropagation();
      e.preventDefault();
      backToResults(sim);
    };
  }
  window.addEventListener('keydown', C.onKey, true);
}

function unwatch() {
  if (C.watchBtn && C.watchBtn.parentNode) C.watchBtn.parentNode.removeChild(C.watchBtn);
  if (C.onKey) window.removeEventListener('keydown', C.onKey, true);
}

function backToResults(sim) {
  unwatch();
  const R = C.R;
  if (R) R.watching = false;
  if (sim.state !== 'debrief' || !sim.menus || sim.menus.current) return;
  const w = debriefActions() && debriefActions().querySelector('[data-city-watch]');
  if (w && R && R.done) w.remove();
  sim.menus.show('debrief');
}

function wrapDebrief(sim) {
  const menus = sim && sim.menus;
  if (!menus || typeof menus.showDebrief !== 'function' || menus.showDebrief.__city) return;
  const orig = menus.showDebrief;
  const wrapped = function (opts) {
    const r = orig.call(this, opts);
    addWatchButton(sim);
    return r;
  };
  wrapped.__city = true;
  if (orig.__crashes) wrapped.__crashes = true;
  menus.showDebrief = wrapped;
}

/* ------------------------------------------------------------------ */
/* Clearing up                                                         */
/* ------------------------------------------------------------------ */

export function clear(sim = C.sim) {
  const R = C.R;
  C.R = null;
  unwatch();
  if (!R) return;
  for (const p of R.people) disposePerson(p.obj);
  for (const t of R.tapes) if (t.userData.own) t.userData.own.dispose();
  for (const g of R.own) g.dispose();
  // The boat and the helicopter were built for this one call (ditching/scene.js frees its own the same way).
  for (const m of [R.heli && R.heli.obj, R.boat && R.boat.obj]) {
    try {
      if (m) disposeRescue(m);
    } catch (e) {
      /* out of the scene with the group */
    }
  }
  if (sim && sim.scene) sim.scene.remove(R.group);
  if (sim && Array.isArray(sim.mapPins)) {
    for (const pin of R.pins) {
      const i = sim.mapPins.indexOf(pin);
      if (i >= 0) sim.mapPins.splice(i, 1);
    }
    if (R.ownsPins && sim.mapPins.length === 0) sim.mapPins = null;
  }
  if (R.thin && sim && sim.ambient && typeof sim.ambient.unthin === 'function') {
    try {
      sim.ambient.unthin(R.thin);
    } catch (e) {
      /* the ambient layer may be gone */
    }
  }
}

function reset(sim) {
  clear(sim);
  C.spent = false;
  C.still = 0;
  C.crashT = 0;
  C.no = null;
}

/** For the tests and the console. */
export function cityState() {
  const R = C.R;
  return {
    started: C.started, active: !!R, spent: C.spent, count: C.count, no: C.no, planMs: C.planMs, buildMs: C.buildMs,
    case: R ? R.case : null,
    kind: R ? R.kind : null,
    tier: R ? R.tier : null,
    t: R ? R.t : 0,
    town: R && R.plan.town ? R.plan.town.name : null,
    incident: R ? { x: R.inc.x, z: R.inc.z, water: R.inc.water } : null,
    stations: R && R.plan.stations ? ['fire', 'police'].map((k) => ({ kind: k, x: R.plan.stations[k].x, z: R.plan.stations[k].z, heading: R.plan.stations[k].heading, built: !!R.plan.stations[k].obj, shared: !!R.plan.stations[k].shared })) : [],
    units: R ? R.units.map((u) => ({ kind: u.kind, state: u.state, x: u.x, z: u.z, y: u.obj.position.y, heading: u.h, eta: u.eta, depart: u.depart, len: u.len, startS: u.startS, park: u.park, onStreet: !!u.onStreet, block: !!u.block, quay: !!u.quay, visible: u.obj.visible })) : [],
    boat: R && R.boat ? { x: R.boat.obj.position.x, z: R.boat.obj.position.z, here: R.boat.here, eta: R.boat.eta, len: R.boat.len } : null,
    heli: R && R.heli ? { x: R.heli.x, y: R.heli.y, z: R.heli.z, here: R.heli.here, gone: R.heli.gone, eta: R.heli.eta, model: !!R.heli.obj } : null,
    people: R ? R.people.map((p) => ({ role: p.role, x: p.x, z: p.z, gone: p.gone })) : [],
    cones: R ? R.cones.length : 0,
    tapes: R ? R.tapes.length : 0,
    foam: R ? { on: R.foamT >= 0, t: R.foamT, scale: R.foam ? R.foam.scale.x : 0, jet: !!R.jet } : null,
    burning: R ? R.burning : null,
    fireOut: R ? R.fireOut : false,
    ambulanceGone: R ? R.ambulanceGone : false,
    onScene: R ? R.onScene : 0,
    done: R ? R.done : false,
    watching: R ? R.watching : false,
    pins: R ? R.pins.length : 0,
    thin: R ? !!R.thin : false,
    said: R ? R.said.slice() : [],
    objects: R ? R.group.children.length : 0,
  };
}

/* ------------------------------------------------------------------ */
/* The feature                                                         */
/* ------------------------------------------------------------------ */

/** Called once by ../emergency-scene.js, the first time an aeroplane is in trouble. */
export function start(sim) {
  if (C.started || !sim) return;
  C.started = true;
  C.sim = sim;
  sim.cityEmergency = { state: cityState, respond: (kind = 'crash', at = null) => respond(sim, kind, at), clear: () => reset(sim), tick: (dt) => tick(sim, dt) };
  wrapDebrief(sim);
  // Behind the debrief the scene goes on (main.js frame): after whoever had the hook first.
  const prev = sim.afterFlight;
  sim.afterFlight = (dt) => {
    if (prev) prev(dt);
    try {
      watch(sim, dt);
      tick(sim, dt);
    } catch (e) {
      console.warn('[city-emergency] stopped', e);
      clear(sim);
      C.spent = true;
    }
  };
  registerExtension({
    id: 'city-emergency',
    startMode(s) {
      reset(s);
    },
    stop(s) {
      reset(s);
    },
    update(s, dt) {
      if (!(dt > 0)) return;
      watch(s, dt);
      tick(s, dt);
    },
    // "Watch the rescue": a slow walk round the scene, a little above it.
    camera(s, dt, cam) {
      const R = C.R;
      if (!R || !R.watching || s.state !== 'debrief') return false;
      R.orbit = (R.orbit == null ? R.plan.base || 0 : R.orbit) + dt * 5;
      const rad = Math.max(38, (R.plan.clearR || 16) + 26);
      const x = R.inc.x + Math.sin(R.orbit * D2R) * rad;
      const z = R.inc.z - Math.cos(R.orbit * D2R) * rad;
      const gy = Math.max(0, R.inc.y);
      // Over the roofs when a house is in the way: the lowest of these heights with a clear line to the aeroplane.
      let want = 55;
      for (const h of [10, 18, 28, 40]) {
        let blocked = false;
        for (let k = 0.08; k < 0.95 && !blocked; k += 0.08) {
          const y = gy + 2 + (h - 2) * (1 - k);
          blocked = !!(R.walled && R.walled(x + (R.inc.x - x) * k, z + (R.inc.z - z) * k, 1, y - 1.5));
        }
        if (!blocked) {
          want = h;
          break;
        }
      }
      R.camH = R.camH == null ? want : R.camH + (want - R.camH) * Math.min(1, dt * 1.5);
      cam.position.set(x, Math.max(gy + R.camH, heightAt(x, z) + 5), z);
      cam.lookAt(R.inc.x, gy + 2, R.inc.z);
      return true;
    },
  });
}

/**
 * Ramp crew (Dev mode): "Add you can roleplay as airport staff".
 *
 * A Dev-mode button, "Work at the airport", puts you on the apron on foot in
 * a hi-vis vest beside a parked airliner and four vehicles you can get into
 * and drive: a pushback tug, a baggage tractor with its carts, a stair truck
 * and a catering truck. Then it gives you a shift, one job at a time, with a
 * marker on where to go and a card of what is done:
 *
 *   1. STAIRS  Drive the stair truck nose-first to the front door. The steps
 *              rise to the sill and the passengers come down them and walk
 *              off to the terminal.
 *   2. PUSH    Move the stairs away, get in the tug, drive up to the nose
 *              wheel head-on and it pins on. Push the aeroplane back; steer
 *              to swing the tail. Stopped clear of the stand and turned is
 *              one star, stopped in the painted box two or three. Then drive
 *              the tug out of the way and it starts up and taxis away.
 *   3. MARSHAL The next one is coming. Walk to the spot in front of the
 *              stand and the wands come out: hold W to wave it on, A and D
 *              to steer it, Space to stop it on the line. O puts the wands
 *              away if you need to go and move something out of its path.
 *
 * The stand's air bridge is hidden for the shift (it stood exactly where
 * the marshaller and the pushback camera needed to be), along with small
 * apron clutter on the stand, and all of it comes back afterwards.
 *
 * and round again, with a new round each time. Catering and the bags are
 * bonus stars.
 *
 * HOW IT PLUGS IN WITHOUT TOUCHING MAIN.JS OR src/vehicles/. The vehicles
 * are specs added to the VEHICLES table (staff/vehicles.js), so
 * `sim.startDrive('tug')` builds a real SurfaceVehicle with the van's physics.
 * startDrive then puts the van's model up and gives only the van pedals and a
 * camera, so the startMode hook below takes the van away, puts the tug's own
 * model in as `sim.vehicleModel`, and hands the tug a DriveInput and a
 * DriveCamera of its own. Every assumption about those is guarded: that code
 * is being rewritten as this is written.
 *
 * Only one vehicle is ever `sim.vehicle`. The other three are parked models
 * in this feature's world group; getting into one stores where the current
 * one is, and calls startDrive again.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import * as TERR from '../world/terrain.js';
import * as AP from '../world/airport.js';
import * as APRON from '../world/apron.js';
import * as DRV from '../vehicles/driving.js';
import * as TYPES from '../aircraft/types.js';
import * as MA from '../aircraft/model-adapter.js';
import * as LIV from '../aircraft/liveries.js';
import * as MB from '../game/missions-boat.js';
import * as MAPS from '../world/maps.js';
import { onFoot } from './onfoot.js';
import { STAFF_IDS } from './staff/vehicles.js';
import { BUILDERS, createCart, setLift, beaconMaterial } from './staff/models.js';
import { createPerson, posePerson, disposePerson, part, mergeParts } from './staff/person.js';
import { groundAt, floorAt, solidAt, propAt, forgetObstacles, tickProps } from './staff/walk.js';
import * as J from './staff/jobs.js';
import * as UI from './staff/ui.js';

const D2R = Math.PI / 180;

/** The jobs in a round, in order, as the card lists them. */
const ROWS = [
  { id: 'stairs', label: 'Stairs to the front door' },
  { id: 'push', label: 'Push the aeroplane back' },
  { id: 'marshal', label: 'Marshal the next one in' },
];
/** Which card row each step of the state machine belongs to. */
const ROW_OF = {
  stairs: 'stairs', passengers: 'stairs', clear: 'push', push: 'push', depart: 'push', next: 'marshal', marshal: 'marshal',
};

const ST = {
  active: false,
  sim: null,
  group: null,
  built: false,
  request: null,
  stand: null,
  prof: null,
  spots: null,
  fleet: {},
  driving: null,
  plane: null,
  job: 'stairs',
  round: 1,
  stars: { stairs: 0, push: 0, marshal: 0 },
  bonus: { catering: false, bags: false },
  total: 0,
  pendingWalk: null,
  dock: null,
  hooked: false,
  pushBox: null,
  arrival: null,
  sig: { come: false, left: false, right: false, stop: false },
  marshalling: false,
  passengers: [],
  hidden: [],
  marker: null,
  boxMesh: null,
  lead: null,
  t: 0,
  jobT: 0,
  warnT: 0,
  objective: '',
  prev: { x: 0, z: 0, heading: 0, ok: false },
  planePrev: { x: 0, z: 0, heading: 0 },
  savedGame: null,
  placeholder: null,
  /** Seconds the pinned tug has been stopped, and whether the push is clear of the stand. */
  stillT: 0,
  pushClear: false,
  /** The high camera over the tug while it pushes. */
  camPush: false,
  camPos: null,
  /** The wands were put away on the spot: walk off it before they come out again. */
  marshalAway: false,
  settleT: 0,
  restarting: false,
  /** Seconds the departing aeroplane has actually been taxiing, and what (if anything) is in its way. */
  departT: 0,
  pathBlock: null,
  /** The tug backing off the nose after a push, while it happens. */
  tugClear: null,
};

const _o = { x: 0, z: 0 };
const _me = { x: 0, z: 0, heading: 0 };
const _o2 = { x: 0, z: 0 };
const _l = { along: 0, side: 0 };

/* ------------------------------------------------------------------ */
/* Little helpers                                                      */
/* ------------------------------------------------------------------ */

function notify(sim, text, kind = 'info', secs = 3.5) {
  try {
    if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
  } catch (e) {
    /* ignore */
  }
}

function tone(sim, freq, dur = 0.14, gain = 0.05, type = 'sine') {
  try {
    const a = sim && sim.audio;
    if (a && a.available && a.mixer && a.mixer.tone) a.mixer.tone({ bus: 'alerts', freq, duration: dur, gain, type });
  } catch (e) {
    /* sound is a nicety */
  }
}

/** A happy little three-note rise for a job done. Quiet. */
function fanfare(sim) {
  tone(sim, 523, 0.14);
  setTimeout(() => tone(sim, 659, 0.14), 130);
  setTimeout(() => tone(sim, 784, 0.24), 260);
}

function starsText(n) {
  return n > 0 ? '★'.repeat(n) + '☆'.repeat(Math.max(0, 3 - n)) : '';
}

function isOurs(model) {
  if (!model) return false;
  for (const id of STAFF_IDS) if (ST.fleet[id] && ST.fleet[id].model === model) return true;
  return false;
}

function staffDriving(sim) {
  const v = sim && sim.vehicle;
  return !!(sim && sim.mode === 'drive' && v && v.spec && v.spec.staff);
}

/** Dry, flat and clear of buildings for `r` metres round (x, z)? */
function clearSpot(x, z, r = 3) {
  const y = TERR.heightAt(x, z);
  if (y < 0.4) return false;
  for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
    if (TERR.heightAt(x + dx, z + dz) < 0.4) return false;
    if (Math.abs(TERR.heightAt(x + dx, z + dz) - y) > 1.2) return false;
    if (TERR.obstacleAt && TERR.obstacleAt(x + dx, y + 1, z + dz)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Where                                                               */
/* ------------------------------------------------------------------ */

/** The airliners a shift can work on, biggest first. */
function airlinerTypes() {
  const list = TYPES.AIRCRAFT || [];
  const out = [];
  for (const id of ['a320', 'meridian']) {
    const t = list.find((a) => a && a.id === id);
    if (t) out.push(t);
  }
  if (!out.length && TYPES.getAircraft) {
    const m = TYPES.getAircraft('meridian');
    if (m) out.push(m);
  }
  return out;
}

function airlinerType() {
  return airlinerTypes()[0] || null;
}

/**
 * A free stand. The airport team's parkingSlots() when it is there (it lists
 * only free stands, and says which way an aeroplane parks on each); else the
 * stand on the apron with no aeroplane on it; else nothing, and the button
 * says this map has no apron.
 */
function findStand(sim, prof) {
  try {
    if (typeof AP.parkingSlots === 'function') {
      const all = AP.parkingSlots() || [];
      const stands = all.filter((s) => s && s.kind === 'stand' && Number.isFinite(s.x) && Number.isFinite(s.z));
      /*
       * Only a stand the aeroplane fits. It fell back to any free stand, and
       * on Stacks the free stands are 16 m ones for light aircraft: an A320
       * went nose to the terminal wall with half a metre to spare, the tug
       * could not get in front of it, and the push never started.
       */
      const fits = stands.filter((s) => !(s.maxSpan < prof.halfSpan * 2) && !(s.maxLength < prof.len));
      // A stand with no air bridge first: the steps and the marshaller need its space.
      const order = fits.filter((s) => !s.bridge).concat(fits.filter((s) => s.bridge));
      for (const pick of order) {
        // Said by the tower and shown in the subtitle: "stand 3", not "stand-3".
        const name = String(pick.id || 'stand').replace(/[-_]+/g, ' ');
        const st = { x: pick.x, z: pick.z, heading: Number.isFinite(pick.headingDeg) ? pick.headingDeg : 0, id: name, src: 'slots' };
        if (clearSpot(st.x, st.z, 2)) return st;
      }
    }
  } catch (e) {
    console.warn('[staff] parkingSlots() failed; using the apron instead', e);
  }
  const ap = sim && sim.apron;
  const list = ap && Array.isArray(ap.stands) ? ap.stands : null;
  if (list && list.length) {
    const st = list.find((s) => !s.ac) || list[list.length - 1];
    /*
     * The apron's stands are nose-in toward the terminal, which is north of
     * them, with the red stop bar ten metres south of the stand point. The
     * aeroplane's centre goes one nose-length behind that bar.
     */
    const s = { x: st.x, z: st.z + 10 + prof.nose, heading: 0, id: `stand ${list.indexOf(st) + 1}`, src: 'apron' };
    if (clearSpot(s.x, s.z, 2)) return s;
  }
  return null;
}

/**
 * Where everything goes, in the stand's own frame, each spot checked for
 * buildings and water and mirrored to the other side if the first choice is
 * blocked.
 */
function layout(stand, prof) {
  const H = stand.heading;
  const at = (along, side, heading, r = 3.2) => {
    for (const s of [side, -side]) {
      for (const da of [0, -6, 6, -12]) {
        const p = J.offset(stand.x, stand.z, H, along + da, s);
        if (clearSpot(p.x, p.z, r)) return { x: p.x, z: p.z, heading: ((s === side ? heading : 360 - heading + 2 * H) % 360 + 360) % 360 };
      }
    }
    const p = J.offset(stand.x, stand.z, H, along, side);
    return { x: p.x, z: p.z, heading };
  };
  const stairs = at(prof.doorFront + 3, -(prof.halfWidth + 18), (H + 90 - 10 + 360) % 360, 4);
  // Outside the wingtip: parked 11 m off the fuselage, the tug was under the
  // wing of every aeroplane that came in to the stand.
  const tug = at(prof.nose - 1, prof.halfSpan + 4, (H - 90 + 360) % 360);
  /*
   * The baggage train and the catering truck wait up by the terminal, ahead
   * of the nose and outside the span. They were parked abeam the tail, which
   * is the line a pushed-back aeroplane taxis out along — and a taxiing
   * aeroplane now waits for whatever is in its way. In the browser check
   * the departing Meridian was still waiting a minute later and the next
   * one never came.
   */
  const baggage = at(prof.nose + 4, prof.halfSpan + 6, (H + 180) % 360);
  const catering = at(prof.nose + 4, prof.halfSpan + 12, (H + 180) % 360, 4);
  const w = J.offset(stairs.x, stairs.z, stairs.heading, -1.5, -3.2);
  return {
    stairs,
    tug,
    baggage,
    catering,
    walker: { x: w.x, z: w.z, heading: stairs.heading },
    marshal: marshalSpot(stand, prof),
    // The hold door: behind the wing on the right, not (as it was) three
    // metres behind the swept wingtip — which on the Meridian is behind the
    // tail.
    hold: J.offset(stand.x, stand.z, H, Math.max(prof.tail + 1.5, prof.wingBack - 1.5), prof.halfWidth + 3.2),
  };
}

/**
 * Where the marshaller stands: on the centreline ahead of the stop line, with
 * nothing solid there and a clear view down the line to the aeroplane.
 *
 * It was a fixed eleven metres ahead of the nose, which on every one of
 * Kestrel's stands is the air bridge's lifting column: the marshaller stood
 * behind it and the camera behind them looked at the incoming aeroplane
 * through a steel pillar and a pair of bogie wheels. Now the nearest spot
 * from six metres out that is clear and can see the stop line wins.
 */
function marshalSpot(stand, prof) {
  const H = stand.heading;
  for (const d of [6, 7, 5, 8, 9, 10, 11, 12, 4.5]) {
    const p = J.offset(stand.x, stand.z, H, prof.nose + d, 0);
    const g = groundAt(p.x, p.z);
    if (TERR.heightAt(p.x, p.z) < 0.4 || solidAt(p.x, p.z, g, 1.0, null)) continue;
    let seen = true;
    for (let k = 1; k < d && seen; k += 1) {
      const q = J.offset(stand.x, stand.z, H, prof.nose + d - k, 0, _o2);
      if (solidAt(q.x, q.z, g, 0.5, null)) seen = false;
    }
    if (seen) return { x: p.x, z: p.z };
  }
  return J.offset(stand.x, stand.z, H, prof.nose + 6, 0);
}

/* ------------------------------------------------------------------ */
/* Building it                                                         */
/* ------------------------------------------------------------------ */

const PARKED = {
  controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 },
  rpm: 0, flaps: 0, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 0, agl: 0, engineOn: false,
};
const MOVING = {
  controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.25, brakes: 0 },
  rpm: 0.35, flaps: 0, gearPos: 1, gearDown: true, onGround: true, groundSpeed: 2, agl: 0, engineOn: true,
};
const WEATHER0 = { isNight: false, cond: { cloud: 0 } };

function buildPlane(sim, type = airlinerType()) {
  if (!type) return null;
  const painted = (LIV.LIVERIES || []).filter((l) => !l.house);
  const scheme = painted.length ? painted[2 % painted.length] : LIV.schemeFor ? LIV.schemeFor(type, 'house') : null;
  const model = MA.createAircraftModel({ type, livery: scheme });
  model.name = 'staff:airliner';
  try {
    if (model.userData.update) model.userData.update(0.016, PARKED, sim.weather || WEATHER0);
  } catch (e) {
    /* a model that cannot be posed still stands */
  }
  const prof = J.planeProfile(type, model);
  let lift = 0;
  try {
    if (MA.groundOffsetFor && TYPES.specFor) lift = MA.groundOffsetFor(model, TYPES.specFor(type.id)) || 0;
  } catch (e) {
    lift = 0;
  }
  return { type, model, prof, lift, x: 0, z: 0, y: 0, heading: 0, state: 'parked', speed: 0, travelled: 0 };
}

function placePlane(plane) {
  const g = groundAt(plane.x, plane.z);
  plane.y = g;
  plane.model.position.set(plane.x, g + plane.prof.cgH + plane.lift, plane.z);
  plane.model.rotation.set(0, -plane.heading * D2R, 0);
}

function beamMarker() {
  const g = new THREE.Group();
  g.name = 'staff:marker';
  const beamMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.32, depthWrite: false });
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 9, 12, 1, true), beamMat);
  beam.position.y = 4.5;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const ring = new THREE.Mesh(new THREE.RingGeometry(1.2, 1.6, 32), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  g.add(beam, ring);
  g.userData.beam = beam;
  g.userData.ring = ring;
  g.renderOrder = 3;
  return g;
}

/** The painted box to push the aeroplane into, with an arrow for the nose. */
function pushBoxMesh(prof) {
  const P = new THREE.BoxGeometry(1, 1, 1);
  const L = prof.len + 4;
  const W = prof.halfSpan * 2 + 4;
  const t = 0.35;
  const parts = [
    part(P, 0xffffff, 0, 0, -L / 2, 0, 0, 0, W, 0.04, t),
    part(P, 0xffffff, 0, 0, L / 2, 0, 0, 0, W, 0.04, t),
    part(P, 0xffffff, -W / 2, 0, 0, 0, 0, 0, t, 0.04, L),
    part(P, 0xffffff, W / 2, 0, 0, 0, 0, 0, t, 0.04, L),
    // Arrow: a shaft and two barbs pointing -Z, the way the nose goes.
    part(P, 0xffffff, 0, 0, -L * 0.1, 0, 0, 0, 0.6, 0.04, L * 0.45),
    part(P, 0xffffff, -1.3, 0, -L * 0.27, 0, -0.7, 0, 0.6, 0.04, 4),
    part(P, 0xffffff, 1.3, 0, -L * 0.27, 0, 0.7, 0, 0.6, 0.04, 4),
  ];
  P.dispose();
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false });
  const m = new THREE.Mesh(mergeParts(parts), mat);
  m.name = 'staff:pushbox';
  m.renderOrder = 2;
  return m;
}

/** A yellow lead-in line and a red stop bar, for marshalling onto. */
function leadInMesh(prof) {
  const P = new THREE.BoxGeometry(1, 1, 1);
  const parts = [
    part(P, 0xf2c53d, 0, 0, 36, 0, 0, 0, 0.45, 0.03, 72),
    part(P, 0xe24d3a, 0, 0, 0, 0, 0, 0, 7, 0.03, 0.6),
  ];
  P.dispose();
  const m = new THREE.Mesh(mergeParts(parts), new THREE.MeshBasicMaterial({ vertexColors: true, depthWrite: false, transparent: true, opacity: 0.95 }));
  m.name = 'staff:lead-in';
  m.renderOrder = 2;
  return m;
}

function park(model, x, z, heading) {
  model.position.set(x, groundAt(x, z) + 0.02, z);
  model.rotation.set(0, -heading * D2R, 0);
}

/**
 * Build the fleet, the aeroplane and the markers into this world's group.
 * The vehicle being driven keeps its model (it is in the scene, not in the
 * group, and survived the rebuild).
 */
function buildScene(sim) {
  const g = ST.group;
  if (!g) return false;
  // The biggest airliner that has a stand here (the A320, else the Meridian).
  let plane = null;
  let stand = null;
  for (const type of airlinerTypes()) {
    const p = buildPlane(sim, type);
    if (!p) continue;
    stand = ST.stand || findStand(sim, p.prof);
    if (stand) {
      plane = p;
      break;
    }
  }
  if (!plane || !stand) return false;
  ST.stand = stand;
  ST.prof = plane.prof;
  ST.spots = layout(stand, plane.prof);
  plane.x = stand.x;
  plane.z = stand.z;
  plane.heading = stand.heading;
  placePlane(plane);
  g.add(plane.model);
  ST.plane = plane;

  for (const id of STAFF_IDS) {
    const old = ST.fleet[id];
    // The one being driven is in the scene, not the old group, and survived.
    const keepDriven = !!(old && sim.vehicleModel === old.model && old.model.parent === sim.scene);
    const spot = ST.spots[id];
    const e = keepDriven ? old : {
      id,
      model: BUILDERS[id](),
      info: null,
      x: spot.x,
      z: spot.z,
      heading: spot.heading,
      carts: null,
      enter: (s) => drive(s, id),
    };
    e.info = e.model.userData.staff;
    if (!keepDriven) {
      park(e.model, e.x, e.z, e.heading);
      g.add(e.model);
    }
    if (id === 'baggage') {
      e.carts = [];
      for (let i = 0; i < 2; i++) {
        const c = createCart(i + 1);
        e.carts.push({ model: c, info: c.userData.staff, x: 0, z: 0, heading: e.heading });
        g.add(c);
      }
      placeCarts(e);
    }
    ST.fleet[id] = e;
  }

  ST.marker = beamMarker();
  g.add(ST.marker);
  ST.boxMesh = pushBoxMesh(plane.prof);
  ST.boxMesh.visible = false;
  g.add(ST.boxMesh);
  ST.lead = leadInMesh(plane.prof);
  const nose = J.offset(stand.x, stand.z, stand.heading, plane.prof.nose, 0);
  ST.lead.position.set(nose.x, groundAt(nose.x, nose.z) + 0.07, nose.z);
  ST.lead.rotation.y = -stand.heading * D2R;
  ST.lead.visible = false;
  g.add(ST.lead);
  ST.pushBox = choosePushBox(stand, plane.prof);
  const pb = ST.pushBox;
  ST.boxMesh.position.set(pb.x, groundAt(pb.x, pb.z) + 0.06, pb.z);
  ST.boxMesh.rotation.y = -pb.heading * D2R;
  ST.built = true;
  return true;
}

/** Carts in a straight line behind the tractor. */
function placeCarts(e) {
  if (!e.carts) return;
  let back = e.info.rearHitch;
  for (const c of e.carts) {
    const p = J.offset(e.x, e.z, e.heading, -(back + c.info.drawbar), 0);
    c.x = p.x;
    c.z = p.z;
    c.heading = e.heading;
    park(c.model, c.x, c.z, c.heading);
    back += c.info.drawbar + c.info.rearHitch;
  }
}

/** Every vehicle back on its own spot, steps and box down. */
function resetFleetPoses(sim) {
  for (const id of STAFF_IDS) {
    const e = ST.fleet[id];
    const sp = ST.spots && ST.spots[id];
    if (!e || !sp) continue;
    e.x = sp.x;
    e.z = sp.z;
    e.heading = sp.heading;
    if (e.model.parent === ST.group) park(e.model, e.x, e.z, e.heading);
    if (e.info && e.info.lift) setLift(e.model, e.info.kind === 'stairs' ? 2.2 : e.info.liftMin);
    placeCarts(e);
  }
}

/** Push back to whichever side has nothing built on it. */
function choosePushBox(stand, prof) {
  let best = null;
  for (const side of [1, -1]) {
    const b = J.pushBoxFor(stand, prof, side);
    let hits = 0;
    const pts = [[0, 0], [prof.nose, 0], [prof.tail, 0], [(prof.wingFront + prof.wingBack) / 2, prof.halfSpan], [(prof.wingFront + prof.wingBack) / 2, -prof.halfSpan]];
    for (const [a, s] of pts) {
      const p = J.offset(b.x, b.z, b.heading, a, s);
      const y = TERR.heightAt(p.x, p.z);
      if (y < 0.4 || (TERR.obstacleAt && TERR.obstacleAt(p.x, y + 2, p.z))) hits++;
    }
    if (!best || hits < best.hits) best = { ...b, hits };
  }
  return best;
}

/**
 * Things the apron put where the ramp crew is working — a parked catering
 * truck on the very stand, a set of steps where the tug goes. Hidden for the
 * session and put back after it. Only small, separate objects: anything
 * instanced, or bigger than a vehicle, is left alone.
 */
function hideClutter(sim) {
  restoreClutter();
  const ap = sim.apron && sim.apron.group;
  if (!ap || !ST.plane) return;
  const box = new THREE.Box3();
  const c = new THREE.Vector3();
  const sz = new THREE.Vector3();
  for (const o of ap.children) {
    if (!o.visible || o.isInstancedMesh || o.isPoints) continue;
    let inst = false;
    o.traverse((q) => {
      if (q.isInstancedMesh) inst = true;
    });
    if (inst) continue;
    box.setFromObject(o);
    if (box.isEmpty()) continue;
    box.getSize(sz);
    if (Math.hypot(sz.x, sz.z) > 16) continue;
    box.getCenter(c);
    let hit = J.inFootprint(ST.plane, ST.prof, c.x, c.z, 5);
    for (const id of STAFF_IDS) {
      const s = ST.spots[id];
      if (Math.hypot(c.x - s.x, c.z - s.z) < 7) hit = true;
    }
    if (ST.pushBox && Math.hypot(c.x - ST.pushBox.x, c.z - ST.pushBox.z) < ST.prof.len * 0.6 + 4) hit = true;
    if (hit) {
      o.visible = false;
      ST.hidden.push(o);
    }
  }
  /*
   * And the air bridge on this stand. A crew bringing steps is working a
   * stand whose bridge is not in use — and drawn, the bridge was in the way
   * of both new jobs: its lifting column stands on the centreline where the
   * marshaller must, and its cab hung between the pushback camera and the
   * aeroplane, so the whole screen was the side of a white box. The bridge
   * whose aeroplane end comes within 12 m of the parked nose goes for the
   * shift, and comes back after it.
   */
  const st = ST.stand;
  const nose = J.offset(st.x, st.z, st.heading, ST.prof.nose, 0, _o);
  for (const g of (sim.apron && sim.apron.bridges) || []) {
    if (!g || !g.visible) continue;
    box.setFromObject(g);
    if (box.isEmpty()) continue;
    const nx = Math.max(box.min.x, Math.min(nose.x, box.max.x));
    const nz = Math.max(box.min.z, Math.min(nose.z, box.max.z));
    if (Math.hypot(nx - nose.x, nz - nose.z) < 12) {
      g.visible = false;
      ST.hidden.push(g);
    }
  }
  // What was hidden is no longer in the walker's way.
  if (ST.hidden.length) forgetObstacles();
}

function restoreClutter() {
  const had = ST.hidden.length;
  for (const o of ST.hidden) o.visible = true;
  ST.hidden.length = 0;
  if (had) forgetObstacles();
}

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

function beginSession(sim) {
  ST.sim = sim;
  if (!ST.built && !buildScene(sim)) return false;
  if (ST.group) ST.group.visible = true;
  ST.active = true;
  ST.job = 'stairs';
  ST.round = 1;
  ST.stars = { stairs: 0, push: 0, marshal: 0 };
  ST.bonus = { catering: false, bags: false };
  ST.total = 0;
  ST.dock = null;
  ST.hooked = false;
  ST.tugClear = null;
  ST.arrival = null;
  if (ST.marshalling) stopMarshalling();
  ST.marshalAway = false;
  ST.objective = '';
  CARD.round = -1;
  ST.cateringLift = null;
  for (const p of ST.passengers) disposePerson(p.model);
  ST.passengers.length = 0;
  if (ST.boxMesh) ST.boxMesh.visible = false;
  if (ST.lead) ST.lead.visible = false;
  onFoot.setOutfit('staff');
  resetFleetPoses(sim);
  resetPlaneParked();
  hideClutter(sim);
  return true;
}

/** The driven model back into the group; a harmless stand-in for main.js. */
function releaseDriven(sim) {
  const m = sim.vehicleModel;
  if (m && isOurs(m)) {
    if (m.parent) m.parent.remove(m);
    if (!ST.placeholder) ST.placeholder = new THREE.Group();
    sim.vehicleModel = ST.placeholder;
  }
  reparentFleet();
}

/** Every fleet model that is not in the scene as sim.vehicleModel, parked in the group. */
function reparentFleet() {
  const sim = ST.sim;
  for (const id of STAFF_IDS) {
    const e = ST.fleet[id];
    if (!e || !e.model) continue;
    if (sim && sim.vehicleModel === e.model && e.model.parent === sim.scene) continue;
    if (ST.group && e.model.parent !== ST.group) {
      if (e.model.parent) e.model.parent.remove(e.model);
      park(e.model, e.x, e.z, e.heading);
      ST.group.add(e.model);
    }
  }
}

function endSession(sim, why) {
  if (!ST.active) return;
  ST.active = false;
  if (ST.marshalling) onFoot.setControl(null);
  ST.marshalling = false;
  if (why === 'menu') releaseDriven(sim);
  else reparentFleet();
  ST.driving = null;
  for (const p of ST.passengers) disposePerson(p.model);
  ST.passengers.length = 0;
  restoreClutter();
  if (ST.group) ST.group.visible = false;
  onFoot.setOutfit(null);
  onFoot.setHint('');
  UI.setCard(null);
  CARD.round = -1;
  if (why === 'menu' && ST.savedGame) {
    sim.game = ST.savedGame;
    try {
      if (sim.menus && sim.menus.setGame) sim.menus.setGame(ST.savedGame);
    } catch (e) {
      /* the menu will repaint itself */
    }
  }
  ST.savedGame = null;
}

function resetPlaneParked() {
  const p = ST.plane;
  if (!p) return;
  p.x = ST.stand.x;
  p.z = ST.stand.z;
  p.heading = ST.stand.heading;
  p.state = 'parked';
  p.speed = 0;
  p.model.visible = true;
  placePlane(p);
}

/**
 * sim.startDrive(id) has just run: swap its van for our model, and give the
 * vehicle the pedals and camera startDrive only gives the van.
 */
function adopt(sim, id) {
  const e = ST.fleet[id];
  if (!e) return;
  const van = sim.vehicleModel;
  if (van && van !== e.model && !isOurs(van) && van.parent) van.parent.remove(van);
  ST.driving = id;
  reparentFleet();
  if (e.model.parent !== sim.scene) {
    if (e.model.parent) e.model.parent.remove(e.model);
    sim.scene.add(e.model);
  }
  sim.vehicleModel = e.model;
  const v = sim.vehicle;
  if (v && v.reset) {
    v.reset({ pos: new THREE.Vector3(e.x, 0, e.z), headingDeg: e.heading });
    if (v.applyAttitude) {
      try {
        v.applyAttitude(0, e.heading * D2R, 0, 0);
      } catch (err) {
        /* next frame's update sets it */
      }
    }
    e.model.position.copy(v.pos);
    if (v.quat) e.model.quaternion.copy(v.quat);
  }
  try {
    if (!sim.driveInput && DRV.DriveInput) sim.driveInput = new DRV.DriveInput(sim.input);
    if (!sim.driveCam && DRV.DriveCamera) sim.driveCam = new DRV.DriveCamera();
    if (sim.driveCam) sim.driveCam.started = false;
  } catch (err) {
    console.warn('[staff] the drive pedals or camera could not be made', err);
  }
  if (sim.touch && sim.touch.setMode) sim.touch.setMode('drive');
  sim.islandRoads = null;
  if (sim.courierGuide) sim.courierGuide = null;
  if (sim.courierMarker && sim.courierMarker.hide) sim.courierMarker.hide();
  standDownPatrol(sim);
  ST.prev.ok = false;
  ST.objective = '';
}

/**
 * startDrive() knows two kinds of trip, and anything that is not the van is
 * the boat: for a kind it does not know it starts the BOAT PATROL on the
 * mission runner and puts up the boat's lever instructions. On the apron that
 * meant, measured on the first frame of a shift, four toasts at once — "Out
 * you go. Keep the radio on", the van's pedals, and "You're on the putty —
 * astern, gently", because the patrol's depth sounder read a tug on tarmac as
 * a boat hard aground — and the patrol's own timer would have sent a rescue
 * shout to the tug a minute or two later.
 * The ramp has no patrol. Stand it down, clear what it put on screen, and say
 * what these pedals do.
 */
function standDownPatrol(sim) {
  const r = sim.runner;
  try {
    if (r && r.status === 'running' && r.def && (r.def.vehicle === 'boat' || r.def.id === 'boat-patrol')) {
      if (typeof r.standDown === 'function') r.standDown();
      else {
        r.status = 'idle';
        if (r.clearGates) r.clearGates();
      }
      if (typeof MB.clearBoatProps === 'function') MB.clearBoatProps(sim.scene);
    }
  } catch (err) {
    console.warn('[staff] could not stand the boat patrol down', err);
  }
  try {
    if (sim.hud && sim.hud.clearTransient) sim.hud.clearTransient();
  } catch (err) {
    /* the toasts time out by themselves */
  }
}

/** Get into one of the ramp vehicles. */
function drive(sim, id) {
  if (!ST.active || !ST.fleet[id]) return false;
  if (ST.marshalling) return false;
  if (ST.driving === id && sim.vehicle && sim.vehicle.spec && sim.vehicle.spec.id === id) {
    onFoot.end(sim);
    return true;
  }
  syncDriven(sim);
  onFoot.end(sim);
  if (sim.gameMap && sim.settings) sim.gameMap[id] = sim.settings.map;
  /*
   * This runs from onfoot.js's key hook. If startDrive — which is somebody
   * else's code, mid-rewrite — throws, it must not be the on-foot feature that
   * gets switched off for it: catch it here and say so.
   */
  try {
    sim.startDrive(id);
  } catch (err) {
    console.error('[staff] startDrive failed for', id, err);
    notify(sim, 'That vehicle will not start — try another', 'warn', 3);
    return false;
  }
  return true;
}

/** Remember where the vehicle being driven is, for when it is parked. */
function syncDriven(sim) {
  const e = ST.fleet[ST.driving];
  const v = sim.vehicle;
  if (!e || !v || !v.spec || v.spec.id !== ST.driving) return;
  e.x = v.pos.x;
  e.z = v.pos.z;
  e.heading = v.heading;
}

/* ------------------------------------------------------------------ */
/* The Dev button                                                      */
/* ------------------------------------------------------------------ */

function workAtTheAirport(sim) {
  const type = airlinerType();
  if (!type) {
    notify(sim, 'There is no airliner to work on', 'warn');
    return false;
  }
  if (!ST.group) {
    notify(sim, 'The world is not built yet', 'warn');
    return false;
  }
  /*
   * Stay on this map if it has an apron; if it does not (the boat's harbour,
   * the mountain road), the shift is at the home airfield — borrowed, the way
   * a mission borrows a map, and put back at the menu. It used to say "this
   * map has no apron" and stop: on those maps a Dev button that did nothing
   * but tell you to go and find a different one.
   */
  let map = sim.settings && sim.settings.map;
  if (!ST.built && !buildScene(sim)) {
    const home = MAPS.DEFAULT_MAP_ID || 'kestrel';
    if (!sim.gameMap || !sim.settings || map === home || !borrowMap(sim, home)) {
      notify(sim, 'This map has no apron to work on — pick one with an airport', 'warn', 5);
      return false;
    }
    map = home;
  }
  if (!ST.savedGame) ST.savedGame = sim.game || 'flight';
  ST.request = true;
  // startDrive would otherwise go to the "tug's own map".
  if (sim.gameMap && map) sim.gameMap.tug = map;
  try {
    sim.startDrive('tug');
  } catch (err) {
    ST.request = null;
    console.error('[staff] startDrive failed for the tug', err);
    notify(sim, 'The ramp could not open just now — try again from the menu', 'warn', 4);
    return false;
  }
  if (!ST.active) {
    // startDrive ran but the startMode hook never took the vehicle over (it
    // changed shape, or the stand could not be laid out). Back to the menu
    // rather than leave a child driving a tug with a van's body.
    ST.request = null;
    try {
      if (sim.quitToMenu) sim.quitToMenu('main');
    } catch (err) {
      /* the menu is the player's own way back */
    }
    notify(sim, 'The ramp could not open on this map', 'warn', 4);
    return false;
  }
  return true;
}

/**
 * Load the home airfield for a shift, borrowed the way a mission borrows a
 * map: the menu puts back the one you chose (main.js's restoreChosenMap, from
 * `mapBeforeMission`).
 *
 * It used to be left to startDrive, which switched to the "tug's own map"
 * that this set in sim.gameMap. The car team's rewrite switches maps only for
 * the four games' own kinds, so there the button on the boat's map said "The
 * ramp could not open on this map" — measured with their branch under this
 * one. The same steps as restoreChosenMap, every one of them guarded.
 */
function borrowMap(sim, id) {
  if (typeof TERR.applyMap !== 'function' || typeof sim.buildWorld !== 'function' || !sim.settings) return false;
  const from = sim.settings.map;
  if (from === id) return true;
  try {
    TERR.applyMap(id);
    if (typeof sim.layRoads === 'function') sim.layRoads();
    if (typeof AP.refreshRunways === 'function') AP.refreshRunways();
    if (typeof APRON.refreshApronElevation === 'function') APRON.refreshApronElevation();
    if (!sim.mapBeforeMission) sim.mapBeforeMission = from;
    sim.settings.map = id;
    if (sim.menus && sim.menus.syncMap) sim.menus.syncMap(id);
    sim.buildWorld(sim.settings.quality);
  } catch (err) {
    console.error('[staff] could not load the home airfield', err);
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* One frame of the shift                                              */
/* ------------------------------------------------------------------ */

function followCarts(e, v) {
  if (!e.carts) return;
  let hx;
  let hz;
  const back = J.offset(v.pos.x, v.pos.z, v.heading, -e.info.rearHitch, 0, _o);
  hx = back.x;
  hz = back.z;
  for (const c of e.carts) {
    let dx = hx - c.x;
    let dz = hz - c.z;
    const d = Math.hypot(dx, dz) || 1;
    dx /= d;
    dz /= d;
    c.x = hx - dx * c.info.drawbar;
    c.z = hz - dz * c.info.drawbar;
    c.heading = (Math.atan2(dx, -dz) / D2R + 360) % 360;
    park(c.model, c.x, c.z, c.heading);
    hx = c.x - dx * c.info.rearHitch;
    hz = c.z - dz * c.info.rearHitch;
  }
}

const _bp = { x: 0, z: 0 };

/**
 * What the vehicle being driven has just run into, or null: its leading edge
 * (the front going forwards, the back reversing), middle and both corners,
 * against the aeroplane, the parked ramp vehicles and the apron's props.
 *
 * SurfaceVehicle stops at OBSTACLES — the buildings. Nothing stopped a ramp
 * vehicle at anything else: the stair truck drove through the parked tug,
 * the catering truck through a fuel bowser, and the tug straight through the
 * middle of the aeroplane it was meant to be pushing.
 */
const _dk = { x: 0, z: 0, heading: 0 };
const _dp = { x: 0, z: 0, heading: 0, sill: 0, along: 0, side: 0 };

/**
 * Is this vehicle nosing up to the door it serves? Then touching the
 * fuselage is the docking, not a bump: at a slight angle the leading corner
 * met the aeroplane a few centimetres before the platform met the sill, and
 * a clean approach was greeted with "Bump! Careful with the aeroplane." and
 * graded from where the bump threw it back to.
 */
function dockingIn(v, e) {
  const info = e.info;
  let which = null;
  if (ST.driving === 'stairs' && ST.job === 'stairs') which = 'front';
  else if (ST.driving === 'catering' && !ST.bonus.catering) which = 'rear';
  if (!which || !info.reach || !ST.plane || ST.plane.state !== 'parked') return false;
  J.doorPose(ST.plane, ST.prof, which, _dp);
  _dk.x = v.pos.x;
  _dk.z = v.pos.z;
  _dk.heading = v.heading;
  const err = J.dockError(_dk, info.reach, _dp);
  return err.dist < 2.2 && err.head < 25;
}

function blockedBy(v, e, docking = false) {
  const info = e.info;
  const dir = v.speed < -0.05 ? -1 : 1;
  const g = groundAt(v.pos.x, v.pos.z);
  const plane = ST.plane;
  const prof = ST.prof;
  for (let i = -1; i <= 1; i++) {
    const p = J.offset(v.pos.x, v.pos.z, v.heading, info.halfLength * dir, i * info.halfWidth * 0.85, _bp);
    if (!docking && plane && plane.state !== 'gone' && plane.model.visible && J.inFootprint(plane, prof, p.x, p.z, 0, info.height)) {
      // The tug goes under the nose to reach the nose leg — there and only there.
      if (ST.driving !== 'tug') return 'the aeroplane';
      const l = J.local(plane.x, plane.z, plane.heading, p.x, p.z, _l);
      if (l.along < prof.noseGear - 1 || Math.abs(l.side) > prof.halfWidth) return 'the aeroplane';
    }
    for (const id of STAFF_IDS) {
      const o = ST.fleet[id];
      if (!o || !o.info || id === ST.driving) continue;
      if (inBox(o, o.info, p.x, p.z)) return `the ${o.info.name.toLowerCase()}`;
      if (o.carts) for (const c of o.carts) if (inBox(c, c.info, p.x, p.z)) return 'the baggage carts';
    }
    if (propAt(p.x, p.z, g + 0.3, g + info.height, 0.15)) return 'that';
    if (trafficAt(ST.sim, p.x, p.z, info.height)) return 'that aeroplane';
  }
  return null;
}

/*
 * Aeroplanes the traffic feature moves about the field (sim.traffic, when it
 * is there): a tug does not drive through one taxiing past the stand any
 * more than through the one it serves. Each type is measured once, from its
 * shape numbers; anything more than 90 m away is rejected on two subtractions.
 */
const TRAFFIC_PROF = new Map();
const _tp = { x: 0, z: 0, heading: 0 };
function trafficAt(sim, x, z, height) {
  const list = sim && sim.traffic;
  if (!Array.isArray(list) || !list.length) return false;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || !t.pos || !t.onGround) continue;
    const dx = t.pos.x - x;
    const dz = t.pos.z - z;
    if (dx * dx + dz * dz > 90 * 90) continue;
    let p = TRAFFIC_PROF.get(t.typeId);
    if (p === undefined) {
      const type = (TYPES.AIRCRAFT || []).find((a) => a && a.id === t.typeId) || null;
      p = type ? J.planeProfile(type, null) : null;
      TRAFFIC_PROF.set(t.typeId, p);
    }
    if (!p) continue;
    _tp.x = t.pos.x;
    _tp.z = t.pos.z;
    _tp.heading = Number.isFinite(t.heading) ? t.heading : 0;
    if (J.inFootprint(_tp, p, x, z, 0.3, height)) return true;
  }
  return false;
}

/** Is the front of this vehicle (middle or either corner) within `margin` of the aeroplane? */
function frontTouches(v, info, margin) {
  const plane = ST.plane;
  if (!plane) return false;
  for (let i = -1; i <= 1; i++) {
    const p = J.offset(v.pos.x, v.pos.z, v.heading, info.halfLength, i * info.halfWidth * 0.85, _bp);
    if (J.inFootprint(plane, ST.prof, p.x, p.z, margin, info.height)) return true;
  }
  return false;
}

function inBox(o, info, x, z, pad = 0.15) {
  const l = J.local(o.x, o.z, o.heading, x, z, _l);
  return Math.abs(l.along) < info.halfLength + pad && Math.abs(l.side) < info.halfWidth + pad;
}

/** Anything the pushed or departing aeroplane is about to hit, or null. */
function planeHit(plane) {
  const p = plane.prof;
  const y = plane.y + 2;
  const wa = (p.wingFront + p.wingBack) / 2;
  const PTS = planeHit.pts || (planeHit.pts = [[0, 0], [0, 0], [0, 0], [0, 0]]);
  PTS[0][0] = p.nose;
  PTS[1][0] = p.tail;
  PTS[2][0] = wa;
  PTS[2][1] = p.halfSpan;
  PTS[3][0] = wa;
  PTS[3][1] = -p.halfSpan;
  for (let i = 0; i < PTS.length; i++) {
    const q = J.offset(plane.x, plane.z, plane.heading, PTS[i][0], PTS[i][1], _o2);
    const o = TERR.obstacleAt ? TERR.obstacleAt(q.x, y, q.z) : null;
    if (o) return o;
  }
  return null;
}

function setJob(sim, job) {
  ST.job = job;
  ST.jobT = 0;
  ST.objective = '';
  ST.stillT = 0;
  ST.pushClear = false;
  ST.departT = 0;
  ST.pathBlock = null;
}

const GUIDE = { text: '', at: null };
const DRIFT_D = 'It is drifting off the yellow line — steer it back with D.';
const DRIFT_A = 'It is drifting off the yellow line — steer it back with A.';
const _door = { x: 0, z: 0, heading: 0, sill: 0, along: 0, side: 0 };

function markVehicle(id) {
  return ST.fleet[id] || null;
}

/** The words for right now, and where the marker goes. The object is reused. */
function guide(sim) {
  const on = onFoot.active;
  const drv = on ? null : ST.driving;
  const sp = ST.spots;
  let text = '';
  let at = null;
  /*
   * In the catering truck or the baggage tractor, the bonus is what you are
   * doing — so that is what the words and the marker are about. The card has
   * always listed the two bonuses; nothing said where either of them was.
   */
  const parked = ST.plane && ST.plane.state === 'parked' && !ST.dock;
  if (parked && drv === 'catering' && !ST.bonus.catering) {
    GUIDE.text = maybeTouch(sim, 'Bonus: drive the catering truck nose-first to the back door, on the aeroplane’s right side.');
    GUIDE.at = J.doorPose(ST.plane, ST.prof, 'rear', _door);
    return GUIDE;
  }
  if (parked && drv === 'baggage' && !ST.bonus.bags) {
    GUIDE.text = maybeTouch(sim, 'Bonus: tow the bags round to the marker by the hold, behind the right wing, and stop there.');
    GUIDE.at = sp.hold;
    return GUIDE;
  }
  switch (ST.job) {
    case 'stairs':
      if (drv !== 'stairs') {
        text = on ? 'Walk to the white stair truck and press O to get in.' : 'Get out (O) and walk to the white stair truck.';
        at = markVehicle('stairs');
      } else {
        text = 'Drive the stairs to the aeroplane’s front door — the yellow marker. Nose first, square on.';
        at = J.doorPose(ST.plane, ST.prof, 'front', _door);
      }
      break;
    case 'passengers':
      // E waves only on foot; in the cab it is a key that does nothing.
      text = on
        ? 'Stairs are on! The passengers are coming down. Give them a wave (E).'
        : 'Stairs are on! Here come the passengers. Hop out (O) and give them a wave.';
      break;
    case 'clear':
      text = 'The aeroplane is leaving. Drive the stair truck well back from it first.';
      at = markVehicle(clearBlocker() || 'stairs');
      break;
    case 'push':
      if (ST.hooked) {
        text = drv !== 'tug'
          ? 'Get back in the tug (O) to finish the push.'
          : ST.pushClear
            ? 'It is clear of the stand! Stop here — or finish in the yellow box for more stars.'
            : 'Drive forwards to push it back. Steer to swing the tail round toward the yellow box.';
        at = ST.pushBox;
      } else if (drv !== 'tug') {
        text = on ? 'Walk to the yellow pushback tug and press O to get in.' : 'Get out (O) and walk to the yellow tug.';
        at = markVehicle('tug');
      } else {
        text = 'Drive the tug up to the aeroplane’s nose wheel, facing it head on. It hooks on by itself.';
        at = J.noseGearPoint(ST.plane, ST.prof, _o2);
      }
      break;
    case 'depart':
      if (ST.tugClear) {
        text = 'Unhooked! The tug is pulling clear so the aeroplane can taxi.';
      } else if (ST.pathBlock === 'you') {
        text = 'The pilot has stopped for you — step out of the way so it can taxi!';
      } else if (ST.pathBlock && ST.fleet[ST.pathBlock]) {
        const b = ST.fleet[ST.pathBlock];
        text = drv === ST.pathBlock
          ? `Drive the ${b.info.name.toLowerCase()} out of the way so the aeroplane can taxi.`
          : `The aeroplane can’t get past the ${b.info.name.toLowerCase()} — move it out of the way!`;
        at = b;
      } else {
        text = 'Nice push! It is starting up and taxiing away.';
      }
      break;
    case 'next':
      text = 'Here comes the next one…';
      at = sp.marshal;
      break;
    case 'marshal':
      if (ST.pathBlock && ST.fleet[ST.pathBlock]) {
        const b = ST.fleet[ST.pathBlock];
        text = ST.marshalling
          ? `The ${b.info.name.toLowerCase()} is in the aeroplane’s way! Put the wands away (O) and go and move it.`
          : `Move the ${b.info.name.toLowerCase()} out of the aeroplane’s way, then back to the marker.`;
        at = b;
      } else if (ST.marshalling) {
        const a = ST.arrival;
        const e = a ? a.errors() : null;
        text = e && a.speed < 0.05 && e.along < -3
          ? 'It is waiting short of the red line — hold W to bring it on.'
          : e && Math.abs(e.side) > 3.5
            // Off to the stand's right is off to the screen's LEFT from
            // behind the marshaller, so it is D that brings it back.
            ? (e.side > 0 ? DRIFT_D : DRIFT_A)
            : 'Hold W to wave it on · A / D to steer it · Space to STOP it on the red line.';
      } else {
        text = on
          ? 'An aeroplane is arriving! Walk to the marker in front of the stand to marshal it in.'
          : 'An aeroplane is arriving! Get out (O) and walk to the marker in front of the stand.';
        at = sp.marshal;
      }
      break;
    default:
      break;
  }
  GUIDE.text = maybeTouch(sim, text);
  GUIDE.at = at;
  return GUIDE;
}

/*
 * The same words for an iPad, which has no O, E, W or Space. Worked out once
 * per sentence and remembered, not rebuilt every frame.
 */
const TOUCH_WORDS = new Map();
function maybeTouch(sim, text) {
  return sim && sim.touch ? touchWords(text) : text;
}
function touchWords(text) {
  let t = TOUCH_WORDS.get(text);
  if (t === undefined) {
    t = text
      .replace(/ and press O to get in/g, ' and tap “get in”')
      .replace(/ \(O\)/g, '')
      .replace(/ \(E\)/g, ' (the Wave button)')
      .replace(/Hold W to wave it on · A \/ D to steer it · Space to STOP it on the red line\./,
        'Hold Come on to wave it in, Left and Right to turn it, and STOP on the red line.')
      .replace(/hold W to bring it on/, 'hold Come on to bring it on')
      .replace(/ with A\.$/, ' with Left.')
      .replace(/ with D\.$/, ' with Right.');
    TOUCH_WORDS.set(text, t);
  }
  return t;
}

/** A ramp vehicle (not the tug) still parked where the aeroplane will swing, or null. */
function clearBlocker() {
  const p = ST.plane;
  for (const id of ['stairs', 'catering', 'baggage']) {
    const e = ST.fleet[id];
    if (e && J.inFootprint(p, ST.prof, e.x, e.z, 5, 99)) return id;
  }
  return null;
}

function stepJobs(sim, dt) {
  const v = sim.vehicle;
  const plane = ST.plane;
  const prof = ST.prof;
  const drv = onFoot.active ? null : ST.driving;
  ST.jobT += dt;

  const me = _me;
  me.x = v.pos.x;
  me.z = v.pos.z;
  me.heading = v.heading;
  if (ST.job === 'stairs' && drv === 'stairs') {
    const pose = J.doorPose(plane, prof, 'front', _door);
    const info = ST.fleet.stairs.info;
    const err = J.dockError(me, info.reach, pose);
    /*
     * Judged where you STOP, not where you arrive. It used to dock, and hand
     * out the stars, on the first frame the platform came within 1.8 m of
     * the door — so every truck driven in at any speed scored off that
     * outer edge: one star, measured, for an approach 0.4 m off the line and
     * four degrees out. Now it docks when you have (nearly) stopped in the
     * zone, when the platform is right on the sill whatever the speed, or
     * when the truck's nose meets the fuselage — which near the door is the
     * docking, not a bump (see dockingIn), and must end it rather than let
     * the truck drive on into the cabin.
     */
    const settled = Math.abs(v.speed) < 0.4 || err.dist < 0.6 || frontTouches(v, ST.fleet.stairs.info, 0.12);
    if (err.dist < 1.8 && err.head < 22 && settled) {
      const stars = err.dist < 0.9 && err.head < 7 ? 3 : err.dist < 1.4 && err.head < 14 ? 2 : 1;
      const place = J.dockedPlace(info.reach, pose);
      ST.dock = { id: 'stairs', t: 0, from: info.liftH || info.liftMin, to: pose.sill, place, spawned: 0, doneT: 0, lowering: false, lowT: 0 };
      ST.stars.stairs = stars;
      ST.total += stars;
      setJob(sim, 'passengers');
      notify(sim, `Stairs on! ${starsText(stars)}`, 'good', 3);
      tone(sim, 440, 0.12, 0.06, 'triangle');
    }
  }

  if (ST.dock) stepDock(sim, dt);

  if (ST.job === 'clear') {
    if (!clearBlocker() && !(drv === 'stairs' && J.inFootprint(plane, prof, v.pos.x, v.pos.z, 5))) {
      setJob(sim, 'push');
      ST.boxMesh.visible = true;
    }
  }

  if (ST.job === 'push') stepPush(sim, dt, drv);
  if (ST.job === 'depart') stepDepart(sim, dt);
  if (ST.job === 'next' && ST.jobT > 2.5) {
    ST.arrival = new J.Arrival({ x: ST.stand.x, z: ST.stand.z, heading: ST.stand.heading }, prof);
    const side = ST.round % 2 ? 3 : -3;
    ST.arrival.begin(Math.max(45, prof.len * 2.5), side, side > 0 ? -5 : 5);
    plane.state = 'arriving';
    plane.model.visible = true;
    plane.x = ST.arrival.x;
    plane.z = ST.arrival.z;
    plane.heading = ST.arrival.heading;
    placePlane(plane);
    ST.lead.visible = true;
    setJob(sim, 'marshal');
    radio(sim, `Ramp, one inbound to ${ST.stand.id}. Marshaller out, please.`);
  }
  if (ST.job === 'marshal') stepMarshal(sim, dt);

  // Bonus stars: the catering truck at the galley door, the bags by the hold.
  if (drv === 'catering' && !ST.bonus.catering && plane.state === 'parked') {
    const pose = J.doorPose(plane, prof, 'rear', _door);
    const info = ST.fleet.catering.info;
    if (J.docked(me, info.reach, pose)) {
      const place = J.dockedPlace(info.reach, pose);
      v.pos.x = place.x;
      v.pos.z = place.z;
      v.heading = place.heading;
      v.speed = 0;
      ST.bonus.catering = true;
      ST.total += 1;
      ST.cateringLift = { t: 0, from: info.liftH || info.liftMin, to: pose.sill };
      notify(sim, 'Catering loaded! Bonus ★', 'good', 3);
      fanfare(sim);
    }
  }
  if (ST.cateringLift) {
    const c = ST.cateringLift;
    c.t += dt;
    const k = Math.min(1, c.t / 2.2);
    const up = c.t < 6;
    setLift(ST.fleet.catering.model, up ? c.from + (c.to - c.from) * k : c.to + (c.from - c.to) * Math.min(1, (c.t - 6) / 2.2));
    if (c.t > 8.3) ST.cateringLift = null;
  }
  if (drv === 'baggage' && !ST.bonus.bags && plane.state === 'parked' && Math.abs(v.speed) < 0.3) {
    const h = ST.spots.hold;
    if (Math.hypot(v.pos.x - h.x, v.pos.z - h.z) < 5) {
      ST.bonus.bags = true;
      ST.total += 1;
      notify(sim, 'Bags at the hold! Bonus ★', 'good', 3);
      fanfare(sim);
    }
  }
}

function stepDock(sim, dt) {
  const d = ST.dock;
  const e = ST.fleet[d.id];
  d.t += dt;
  // Held on the door while it works, whoever is or is not in the cab.
  if (ST.driving === d.id && sim.vehicle && d.phase !== 'free') {
    const v = sim.vehicle;
    v.pos.x = d.place.x;
    v.pos.z = d.place.z;
    v.heading = d.place.heading;
    v.speed = 0;
  }
  e.x = d.place.x;
  e.z = d.place.z;
  e.heading = d.place.heading;
  const rise = Math.min(1, d.t / 2);
  if (!d.lowering) setLift(e.model, d.from + (d.to - d.from) * rise);
  if (d.t > 2 && d.spawned < 5 && d.t > 2 + d.spawned * 1.3) {
    spawnPassenger(d, d.spawned);
    d.spawned++;
  }
  let allOff = d.spawned >= 5;
  for (let i = 0; i < ST.passengers.length && allOff; i++) if (ST.passengers[i].seg < 3) allOff = false;
  if (allOff && !d.lowering) {
    d.doneT += dt;
    if (d.doneT > 1.2) {
      d.lowering = true;
      d.lowT = 0;
    }
  }
  if (d.lowering) {
    d.lowT += dt;
    setLift(e.model, d.to + (d.from - d.to) * Math.min(1, d.lowT / 2));
    if (d.lowT > 2) {
      ST.dock = null;
      notify(sim, 'Everyone is off. Now it needs pushing back.', 'info', 3.5);
      fanfare(sim);
      setJob(sim, 'clear');
    }
  }
}

/** A passenger down the stairs and off to the terminal. */
function spawnPassenger(d, i) {
  const pose = d.place;
  const sill = d.to;
  const info = ST.fleet[d.id].info;
  const pts = [];
  const add = (along, side, y, speed) => {
    const p = J.offset(pose.x, pose.z, pose.heading, along, side);
    pts.push({ x: p.x, y, z: p.z, speed });
  };
  const g0 = groundAt(pose.x, pose.z);
  // In the frame of the docked stair truck: its nose is at the door.
  add(info.reach - 0.2, 0, g0 + sill, 1.0);
  add(2.2, 0, g0 + sill, 0.9);
  add(-3.0, 0, g0 + info.deck + 0.05, 1.3);
  // Down on the apron: on its tarmac, not in it (floorAt: 5 cm over the ground).
  add(-4.4, (i % 2 ? 0.6 : -0.6), floorAt(pose.x, pose.z), 1.3);
  // Then off toward the terminal, ahead of the aeroplane's nose.
  const st = ST.stand;
  const end = J.offset(st.x, st.z, st.heading, ST.prof.nose + 26, -6 + i * 2.4);
  pts.push({ x: end.x, y: floorAt(end.x, end.z), z: end.z, speed: 1.3 });
  const m = createPerson({ outfit: 'passenger', lite: true, suitcase: i % 2 === 0, seed: ST.round * 17 + i * 5 + 3 });
  if (ST.group) ST.group.add(m);
  ST.passengers.push({ model: m, pts, seg: 0, t: 0, x: pts[0].x, y: pts[0].y, z: pts[0].z, heading: 0, done: false, waveT: 0 });
}

const PAX_POSE = { speed: 0, air: false, wave: null };

/**
 * Walk the passengers down and away. Wave at one (E, on foot) and they stop
 * and wave back, turned to face you — once each, so nobody is stuck on the
 * apron waving for as long as you hold the key.
 *
 * A passenger used to wave at the foot of the steps while still walking, so
 * they slid along the ground with their legs still and one arm up.
 */
function stepPassengers(dt) {
  const w = onFoot.active ? onFoot.walker : null;
  const hello = !!(w && onFoot.waving);
  for (let i = ST.passengers.length - 1; i >= 0; i--) {
    const p = ST.passengers[i];
    const a = p.pts[p.seg];
    const b = p.pts[p.seg + 1];
    if (!b) {
      disposePerson(p.model);
      ST.passengers.splice(i, 1);
      continue;
    }
    if (hello && !p.wavedBack && p.seg >= 1 && Math.hypot(w.x - p.x, w.z - p.z) < 18) {
      p.wavedBack = true;
      p.waveT = 1.8;
      p.face = (Math.atan2(w.x - p.x, -(w.z - p.z)) / D2R + 360) % 360;
    }
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    if (p.waveT > 0) {
      // Stood still to wave.
      p.waveT -= dt;
      if (p.face != null) p.heading = p.face;
    } else {
      p.face = null;
      const len = Math.hypot(dx, dz) || 0.001;
      p.t += (b.speed * dt) / len;
      if (p.t >= 1) {
        p.t = 0;
        p.seg++;
        if (p.seg === 3) p.waveT = 1.6;
        continue;
      }
      p.x = a.x + dx * p.t;
      p.y = a.y + dy * p.t;
      p.z = a.z + dz * p.t;
      p.heading = Math.atan2(dx, -dz) / D2R;
    }
    p.model.position.set(p.x, p.y, p.z);
    p.model.rotation.set(0, -p.heading * D2R, 0);
    PAX_POSE.speed = p.waveT > 0 ? 0 : b.speed;
    PAX_POSE.wave = p.waveT > 0 ? 'hello' : null;
    posePerson(p.model, dt, PAX_POSE);
  }
}

function stepPush(sim, dt, drv) {
  const v = sim.vehicle;
  const plane = ST.plane;
  const prof = ST.prof;
  const tug = ST.fleet.tug;
  const hitch = tug.info.hitch;
  if (!ST.hooked) {
    if (drv !== 'tug') return;
    const h = J.hookable(_me, plane, prof, hitch);
    if (h.ok && Math.abs(v.speed) < 2.5) {
      const ng = J.noseGearPoint(plane, prof, _o2);
      const th = (plane.heading + 180) % 360;
      const back = J.offset(ng.x, ng.z, th, -hitch, 0, _o);
      v.pos.x = back.x;
      v.pos.z = back.z;
      v.heading = th;
      v.speed = 0;
      ST.hooked = true;
      ST.pushStart = { x: plane.x, z: plane.z };
      notify(sim, 'Hooked on! Drive forwards to push it back.', 'good', 3);
      tone(sim, 220, 0.1, 0.07, 'square');
    }
    return;
  }
  // Pinned — but only the tug pushes. Hop out mid-push and take the stairs,
  // and sim.vehicle is the stair truck: towing with it would have pinned the
  // stairs to the nose leg.
  if (!v.spec || v.spec.id !== 'tug') return;
  // The tug is slow with forty tonnes on the bar.
  if (Math.abs(v.speed) > 2.2) v.speed = Math.sign(v.speed) * 2.2;
  ST.planePrev.x = plane.x;
  ST.planePrev.z = plane.z;
  ST.planePrev.heading = plane.heading;
  const tip = J.hitchPoint(v.pos.x, v.pos.z, v.heading, hitch, _o);
  // The aeroplane rolls as far as the bar pushed it; the tug is put back on
  // the nose leg wherever that leaves it.
  J.towStep(plane, prof, tip.x, tip.z, v.heading, Math.max(6, prof.wheelbase * 1.6), tip);
  // The towbar has a stop: the tug cannot fold round beside the aeroplane.
  const bend = J.towAngle(v.heading, plane.heading);
  if (Math.abs(bend) > 60) v.heading = J.tugHeadingFor(plane.heading, Math.sign(bend) * 60);
  J.tugAtTip(tip.x, tip.z, v.heading, hitch, _o2);
  v.pos.x = _o2.x;
  v.pos.z = _o2.z;
  const hit = planeHit(plane);
  if (hit) {
    plane.x = ST.planePrev.x;
    plane.z = ST.planePrev.z;
    plane.heading = ST.planePrev.heading;
    const ng = J.noseGearPoint(plane, prof, _o);
    J.tugAtTip(ng.x, ng.z, v.heading, hitch, _o2);
    v.pos.x = _o2.x;
    v.pos.z = _o2.z;
    v.speed = 0;
    if (ST.warnT <= 0) {
      ST.warnT = 3;
      notify(sim, `Stop! The aeroplane is about to hit ${whatName(hit)}. Back up and steer the other way.`, 'warn', 3.5);
    }
  }
  placePlane(plane);

  /*
   * Done when it is off the stand, turned, and you have stopped.
   *
   * It used to be done only inside the box. A child who pushed it back,
   * swung it round and stopped a few metres short got nothing: no message,
   * no stars, and a tug that would push on for ever. Now the box is for the
   * stars — three for stopping in it lined up, two for anywhere in it — and
   * clear of the stand and turned is one star and the job. Push on well past
   * everything and the pilot puts the brakes on for you, and that counts too.
   */
  const box = J.inPushBox(plane, ST.pushBox, 12, 35);
  const off = J.offStand(plane, ST.stand, prof);
  ST.boxMesh.material.color.setHex(box.ok ? 0x5be38a : 0xffd23f);
  ST.pushClear = off.clear;
  ST.stillT = Math.abs(v.speed) < 0.15 ? ST.stillT + dt : 0;
  let stars = 0;
  if (box.ok && ST.stillT > 0.3) stars = box.dist < 5 && box.head < 12 ? 3 : 2;
  else if (off.clear && ST.stillT > 1.0) stars = 1;
  else if (off.away > Math.max(60, prof.len * 3.5)) {
    stars = 1;
    notify(sim, 'Whoa — that is far enough! The pilot has put the brakes on.', 'info', 3);
  }
  if (stars) {
    ST.stars.push = stars;
    ST.total += stars;
    ST.hooked = false;
    ST.pushClear = false;
    ST.stillT = 0;
    ST.boxMesh.visible = false;
    v.speed = 0;
    plane.state = 'leaving';
    plane.speed = 0;
    plane.travelled = 0;
    notify(sim, stars === 3
      ? `Perfect pushback! ${starsText(stars)}`
      : stars === 2 ? `Pushback done! ${starsText(stars)}`
        : `Pushback done! ${starsText(stars)} Stop inside the yellow box for more stars.`, 'good', 3.5);
    fanfare(sim);
    setJob(sim, 'depart');
    radio(sim, 'Thanks, ramp. Pushback complete — it is taxiing out now.');
    startTugClear(v);
  }
}

/*
 * The tug unhooks and pulls clear by itself.
 *
 * The push ends with the tug on the nose leg, square in front of an
 * aeroplane about to taxi, and the aeroplane waits for things in its way.
 * Left to the player, getting a tug out from under a nose is reversing and
 * steering at once: a scripted "reverse and turn, then drive on and turn"
 * left it in the way, and the round stalled at "depart". So, as a real tug
 * driver would, it backs straight off the nose and goes home to its own
 * spot — which is outside the span and off both the taxi-out line and the
 * lead-in. (Swinging it out "beyond the wingtip" of the pushed aeroplane put
 * it, on Kestrel's stand 3, on the centreline the next arrival comes in
 * along, and the marshalled aeroplane stopped for it and never parked.)
 * Four seconds, then the wheel is yours.
 */
function startTugClear(v) {
  const e = ST.fleet.tug;
  const home = ST.spots && ST.spots.tug;
  if (!e || !home) return;
  // Leg one: six metres straight back, away from the nose.
  const back = J.offset(v.pos.x, v.pos.z, v.heading, -6, 0);
  ST.tugClear = {
    t: 0,
    fx: v.pos.x, fz: v.pos.z, fh: v.heading,
    bx: back.x, bz: back.z,
    tx: home.x, tz: home.z, th: home.heading,
  };
}

function stepTugClear(sim, dt) {
  const c = ST.tugClear;
  const e = ST.fleet.tug;
  if (!c || !e) return;
  c.t += dt;
  const LEG1 = 1.2;
  const TOTAL = 4;
  let x;
  let z;
  let h;
  if (c.t < LEG1) {
    const s = c.t / LEG1;
    x = c.fx + (c.bx - c.fx) * s;
    z = c.fz + (c.bz - c.fz) * s;
    h = c.fh;
  } else {
    const k = Math.min(1, (c.t - LEG1) / (TOTAL - LEG1));
    const s = k * k * (3 - 2 * k);
    x = c.bx + (c.tx - c.bx) * s;
    z = c.bz + (c.tz - c.bz) * s;
    h = (c.fh + J.angleDiff(c.th, c.fh) * s + 360) % 360;
  }
  const k = Math.min(1, c.t / TOTAL);
  e.x = x;
  e.z = z;
  e.heading = h;
  const v = sim.vehicle;
  if (v && v.spec && v.spec.id === 'tug') {
    v.pos.x = x;
    v.pos.z = z;
    v.heading = h;
    v.speed = 0;
    // Walking about while it moves: it is moored where it is going.
    const f = onFoot.active && onFoot.from;
    if (f && f.moor) {
      f.moor.x = x;
      f.moor.z = z;
      f.moor.heading = h;
    }
  } else if (e.model && e.model.parent === ST.group) {
    park(e.model, x, z, h);
  }
  if (k >= 1) ST.tugClear = null;
}

/**
 * A word from the tower, through the game's own radio: it speaks or it
 * subtitles as the player's voice setting says, and a tone-and-text player
 * loses nothing because the same news is always in a toast as well.
 */
function radio(sim, text) {
  try {
    if (sim && typeof sim.speak === 'function') sim.speak(text, 'tower', 0);
  } catch (err) {
    /* the toast has already said it */
  }
}

/** "You flew into the terminal" → "the terminal", for a ramp-crew warning. */
function whatName(o) {
  return String((o && o.what) || 'something').replace(/^You (flew into|hit|crashed into|ran into|drove into) /, '');
}

/*
 * What is in the way of a taxiing aeroplane: a ramp vehicle or cart just
 * ahead of the nose or under a wingtip's leading edge, or (if `walker`) you.
 *
 * The departing aeroplane used to drive straight through whatever was there,
 * and the first thing there is the tug that has just pushed it back — still
 * sitting at the nose leg, because the push ends with the bar on. Now the
 * pilot waits, and the objective says what to move, which is what a real
 * ramp does between "pushback complete" and "taxi".
 */
const PATH_PTS = [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0]];
const _pt = { x: 0, z: 0 };
function pathBlocker(plane, walker) {
  const p = ST.prof;
  const tip = J.wingEdges(p, p.halfSpan - 0.6);
  const le = tip ? tip.le : p.wingFront;
  PATH_PTS[0][0] = p.nose + 2.5;
  PATH_PTS[0][1] = 0;
  PATH_PTS[1][0] = p.nose + 2;
  PATH_PTS[1][1] = p.halfWidth + 1.5;
  PATH_PTS[2][0] = p.nose + 2;
  PATH_PTS[2][1] = -(p.halfWidth + 1.5);
  PATH_PTS[3][0] = le + 1.5;
  PATH_PTS[3][1] = p.halfSpan - 0.6;
  PATH_PTS[4][0] = le + 1.5;
  PATH_PTS[4][1] = -(p.halfSpan - 0.6);
  for (let i = 0; i < PATH_PTS.length; i++) {
    const q = J.offset(plane.x, plane.z, plane.heading, PATH_PTS[i][0], PATH_PTS[i][1], _pt);
    for (const id of STAFF_IDS) {
      const o = ST.fleet[id];
      if (!o || !o.info) continue;
      if (inBox(o, o.info, q.x, q.z, 1.0)) return id;
      if (o.carts) for (const c of o.carts) if (inBox(c, c.info, q.x, q.z, 1.0)) return id;
    }
    if (walker && onFoot.active) {
      const w = onFoot.walker;
      if (Math.hypot(w.x - q.x, w.z - q.z) < 2.4) return 'you';
    }
  }
  return null;
}

function stepDepart(sim, dt) {
  const plane = ST.plane;
  if (plane.state !== 'leaving') return;
  if (ST.jobT < 3) return; // engines spooling up
  const block = pathBlocker(plane, true);
  if (block !== ST.pathBlock) {
    ST.pathBlock = block;
    if (block) {
      notify(sim, block === 'you' ? 'The pilot has stopped for you — step out of the way!' : 'The aeroplane can’t get past — move it out of the way!', 'warn', 3);
      tone(sim, 392, 0.2, 0.05, 'triangle');
    }
  }
  if (block) {
    // Brakes, and wait.
    plane.speed = Math.max(0, plane.speed - dt * 3);
  } else {
    plane.speed = Math.min(5, plane.speed + dt * 0.8);
    ST.departT += dt;
  }
  /*
   * Taxi out AWAY from the stand, the way an aeroplane leaves an apron for
   * the taxiway, not straight along the line it was pushed onto. Straight
   * on, a push that finished four degrees short of square carried the near
   * wingtip over the tug's own parking spot thirty metres later: measured,
   * the Meridian stopped for the tug and waited there for good. After the
   * first few metres it turns, gently, until it points away from the stand.
   */
  if (plane.travelled > 4 && plane.speed > 0.2) {
    const away = (ST.stand.heading + 180) % 360;
    const d = J.angleDiff(away, plane.heading);
    const rate = 9 * Math.min(1, plane.speed / 3) * dt;
    plane.heading = (plane.heading + Math.max(-rate, Math.min(rate, d)) + 360) % 360;
  }
  const h = plane.heading * D2R;
  plane.x += Math.sin(h) * plane.speed * dt;
  plane.z -= Math.cos(h) * plane.speed * dt;
  plane.travelled += plane.speed * dt;
  const hit = planeHit(plane);
  // Gone once it has taxied well away (or reached a building, or taxied for
  // half a minute); a wait for the tug to move does not count.
  if (hit || plane.travelled > 120 || ST.departT > 30) {
    ST.pathBlock = null;
    plane.state = 'gone';
    plane.model.visible = false;
    setJob(sim, 'next');
    return;
  }
  placePlane(plane);
}

const MARSHAL_BUTTONS = [
  { id: 'come', label: 'Come on', hold: true },
  { id: 'left', label: '◀ Left', hold: true },
  { id: 'right', label: 'Right ▶', hold: true },
  { id: 'stop', label: 'STOP', hold: true },
  // O, for a screen with no O key.
  { id: 'away', label: 'Wands away' },
];

const MARSHAL = {
  locked: true,
  face: 0,
  wave: null,
  wands: true,
  camYaw: 0,
  prompt: '',
  buttons: MARSHAL_BUTTONS,
  key(sim, code, down) {
    const s = ST.sig;
    if (code === 'KeyW' || code === 'ArrowUp') s.come = down;
    else if (code === 'KeyA' || code === 'ArrowLeft') s.left = down;
    else if (code === 'KeyD' || code === 'ArrowRight') s.right = down;
    else if (code === 'Space' || code === 'KeyS' || code === 'ArrowDown') s.stop = down;
    else return false;
    return true;
  },
  /*
   * O puts the wands away. Without it the spot was a trap: once the wands
   * were out the walker was locked there, and the only way off was to bring
   * the aeroplane all the way in. The aeroplane waits where it is; walk off
   * the spot and back on to take it up again.
   */
  onO(sim) {
    stopMarshalling();
    ST.marshalAway = true;
    notify(sim, 'Wands away. The aeroplane will wait — step back onto the marker to carry on.', 'info', 3.5);
  },
  onButton(id) {
    if (id === 'away' && ST.sim) MARSHAL.onO(ST.sim);
  },
};

function stopMarshalling() {
  ST.marshalling = false;
  ST.sig.come = ST.sig.left = ST.sig.right = ST.sig.stop = false;
  onFoot.setControl(null);
}

function signal() {
  const s = ST.sig;
  const h = UI.touch.held;
  if (s.stop || h.stop) return 'stop';
  if (s.left || h.left) return 'left';
  if (s.right || h.right) return 'right';
  if (s.come || h.come) return 'come';
  return null;
}

function stepMarshal(sim, dt) {
  const plane = ST.plane;
  const arr = ST.arrival;
  if (!arr) return;
  const spot = ST.spots.marshal;
  if (!ST.marshalling) {
    // The aeroplane rolls to a stop by itself while nobody is signalling.
    const rolled = arr.step(dt, null);
    plane.x = arr.x;
    plane.z = arr.z;
    plane.heading = arr.heading;
    placePlane(plane);
    if (rolled) {
      marshalDone(sim, rolled);
      return;
    }
    const w = onFoot.walker;
    const dSpot = Math.hypot(w.x - spot.x, w.z - spot.z);
    if (ST.marshalAway && (!onFoot.active || dSpot > 3)) ST.marshalAway = false;
    if (onFoot.active && !ST.marshalAway && dSpot < 2) {
      ST.marshalling = true;
      // A key still held from walking onto the spot counts from the start.
      const held = onFoot.keysHeld();
      ST.sig.come = !!(held.KeyW || held.ArrowUp);
      ST.sig.left = !!held.KeyA;
      ST.sig.right = !!held.KeyD;
      ST.sig.stop = false;
      const face = (ST.stand.heading + 180) % 360;
      onFoot.place(spot.x, spot.z, face);
      MARSHAL.face = face;
      // Over the shoulder rather than square behind: square behind is the
      // one line the stand's own furniture is on (the air bridge's column
      // stands on the centreline), and from a little to the side the wands
      // and the aeroplane are both in the picture.
      MARSHAL.camYaw = (face + 16) % 360;
      // Said on the prompt, where the walking keys were, for as long as the
      // wands are out — not once in a toast that has gone by the time the
      // aeroplane is close enough to matter.
      MARSHAL.prompt = sim.touch
        ? 'Hold <b>Come on</b> to wave it in · <b>Left</b> / <b>Right</b> to turn it · <b>STOP</b> on the red line'
        : 'Hold <kbd>W</kbd> to wave it in · <kbd>A</kbd> <kbd>D</kbd> to turn it · <kbd>Space</kbd> STOP on the red line';
      onFoot.setCamera(MARSHAL.camYaw, -9);
      onFoot.setView('chase');
      onFoot.setControl(MARSHAL);
      notify(sim, sim.touch ? 'Wands out! Hold Come on to wave it in.' : 'Wands out! Hold W to wave it in. (O puts them away.)', 'good', 3.5);
    }
    return;
  }
  const sig = signal();
  MARSHAL.wave = sig;
  // Nobody taxis into a parked vehicle, however hard the wands say come on.
  const block = pathBlocker(plane, false);
  if (block !== ST.pathBlock) {
    ST.pathBlock = block;
    if (block) notify(sim, 'The pilot has stopped — something is in the way!', 'warn', 3);
  }
  if (block && (sig === 'come' || sig === 'left' || sig === 'right')) {
    arr.speed = 0;
    return;
  }
  const res = arr.step(dt, sig);
  plane.x = arr.x;
  plane.z = arr.z;
  plane.heading = arr.heading;
  placePlane(plane);
  if (res) marshalDone(sim, res);
}

function marshalDone(sim, res) {
  const arr = ST.arrival;
  if (ST.marshalling) stopMarshalling();
  ST.marshalAway = false;
  const r = arr.result;
  ST.stars.marshal = r.stars;
  ST.total += r.stars;
  if (res === 'parked') {
    notify(sim, `Parked on the line! ${starsText(r.stars)}`, 'good', 3.5);
    fanfare(sim);
  } else {
    notify(sim, res === 'overshot'
      ? 'Too far — the pilot stopped by themselves. Stop it sooner next time!'
      : 'Too far off the line — the pilot stopped. Steer it back sooner next time!', 'warn', 4.5);
  }
  ST.settleT = res === 'parked' ? 0 : 2.5;
  ST.lead.visible = false;
  ST.arrival = null;
  nextRound(sim);
}

function nextRound(sim) {
  ST.round++;
  ST.stars = { stairs: 0, push: 0, marshal: 0 };
  ST.bonus = { catering: false, bags: false };
  const p = ST.plane;
  p.state = 'parked';
  p.speed = 0;
  // A pilot who stopped short or wide shuffles it onto the spot.
  if (ST.settleT > 0) resetPlaneParked();
  setJob(sim, 'stairs');
}

/* ------------------------------------------------------------------ */
/* On screen                                                           */
/* ------------------------------------------------------------------ */

const CARD = { round: -1, job: '', a: -1, b: -1, c: -1, total: -1, cat: null, bags: null };

function drawCard() {
  const now = ROW_OF[ST.job];
  const K = CARD;
  if (K.round === ST.round && K.job === ST.job && K.a === ST.stars.stairs && K.b === ST.stars.push
    && K.c === ST.stars.marshal && K.total === ST.total && K.cat === ST.bonus.catering && K.bags === ST.bonus.bags) return;
  K.round = ST.round;
  K.job = ST.job;
  K.a = ST.stars.stairs;
  K.b = ST.stars.push;
  K.c = ST.stars.marshal;
  K.total = ST.total;
  K.cat = ST.bonus.catering;
  K.bags = ST.bonus.bags;
  const order = ROWS.map((r) => r.id);
  const nowIdx = order.indexOf(now);
  const rows = ROWS.map((r, i) => {
    const done = i < nowIdx || ST.stars[r.id] > 0;
    const cls = r.id === now && !(ST.stars[r.id] > 0) ? 'now' : done ? 'done' : '';
    return `<div class="row ${cls}"><span class="tick">${done ? '✓' : r.id === now ? '▶' : '·'}</span>${r.label}<span class="stars">${starsText(ST.stars[r.id])}</span></div>`;
  }).join('');
  const bonus = `<div class="row ${ST.bonus.catering ? 'done' : ''}"><span class="tick">${ST.bonus.catering ? '✓' : '+'}</span>Bonus: catering to the back door</div>`
    + `<div class="row ${ST.bonus.bags ? 'done' : ''}"><span class="tick">${ST.bonus.bags ? '✓' : '+'}</span>Bonus: bags to the hold</div>`;
  UI.setCard(`<h4>Ramp crew · round ${ST.round}</h4>${rows}${bonus}<div class="total">★ ${ST.total} today</div>`);
}

function drawMarker(at, t) {
  const m = ST.marker;
  if (!m) return;
  if (!at) {
    m.visible = false;
    return;
  }
  m.visible = true;
  m.position.set(at.x, groundAt(at.x, at.z), at.z);
  const pulse = 1 + Math.sin(t * 4) * 0.12;
  m.userData.ring.scale.set(pulse, pulse, 1);
  m.userData.beam.material.opacity = 0.24 + Math.sin(t * 3) * 0.08;
}

/* ------------------------------------------------------------------ */
/* Cameras                                                             */
/* ------------------------------------------------------------------ */

const _cam = new THREE.Vector3();
const _camLook = new THREE.Vector3();
const _eye = new THREE.Vector3();

/**
 * Bring the camera in along its line to the vehicle until it is out of any
 * building or prop. Eight samples against the walker's short list of nearby
 * boxes, not the whole island's.
 */
function unblock(camera, v, look) {
  _eye.set(v.pos.x, v.pos.y + 2.2, v.pos.z);
  const c = camera.position;
  let best = 1;
  for (let k = 1; k <= 8; k++) {
    const t = k / 8;
    const x = _eye.x + (c.x - _eye.x) * t;
    const y = _eye.y + (c.y - _eye.y) * t;
    const z = _eye.z + (c.z - _eye.z) * t;
    if (solidAt(x, z, y - 0.4, 0.3, null, 0.8)) {
      best = Math.max(0.12, (k - 1) / 8);
      break;
    }
  }
  if (best < 1) {
    c.set(_eye.x + (c.x - _eye.x) * best, _eye.y + (c.y - _eye.y) * best, _eye.z + (c.z - _eye.z) * best);
    if (look) camera.lookAt(look);
  }
}

/**
 * Pushing: up and behind the tug, looking at the aeroplane, so the tail, the
 * wings and the yellow box are all in the picture while you steer.
 */
function pushCamera(sim, dt, camera, v) {
  const plane = ST.plane;
  const h = v.heading * D2R;
  const want = _cam.set(v.pos.x - Math.sin(h) * 10, v.pos.y + 7.5, v.pos.z + Math.cos(h) * 10);
  const mid = J.offset(plane.x, plane.z, plane.heading, ST.prof.noseGear * 0.5, 0, _o2);
  _camLook.set(mid.x, plane.y + 1.5, mid.z);
  if (!ST.camPush) {
    ST.camPush = true;
    ST.camPos = ST.camPos || new THREE.Vector3();
    ST.camPos.copy(want);
  } else {
    ST.camPos.lerp(want, Math.min(1, dt * 3));
  }
  camera.position.copy(ST.camPos);
  camera.lookAt(_camLook);
  // The drive camera puts the field of view back when the drive ends, from
  // what it saw first; make sure it has seen it before this changes it.
  if (sim.driveCam && sim.driveCam.savedFov == null) sim.driveCam.savedFov = camera.fov;
  if (Math.abs(camera.fov - 60) > 0.05) {
    camera.fov += (60 - camera.fov) * Math.min(1, dt * 3);
    camera.updateProjectionMatrix();
  }
  unblock(camera, v, _camLook);
}

/* ------------------------------------------------------------------ */
/* Talking to onfoot.js                                                */
/* ------------------------------------------------------------------ */

onFoot.addProvider({
  enterables(sim, w, add) {
    if (!ST.active || ST.marshalling || sim.mode !== 'drive') return;
    for (const id of STAFF_IDS) {
      const e = ST.fleet[id];
      if (!e || !e.info) continue;
      const l = J.local(e.x, e.z, e.heading, w.x, w.z, _l);
      const da = Math.max(0, Math.abs(l.along) - e.info.halfLength);
      const ds = Math.max(0, Math.abs(l.side) - e.info.halfWidth);
      const d = Math.hypot(da, ds);
      if (d < 1.8) add(`the ${e.info.name.toLowerCase()}`, d, e.enter);
    }
  },
  solids(sim, add) {
    if (!ST.active) return;
    for (const id of STAFF_IDS) {
      const e = ST.fleet[id];
      if (!e || !e.info) continue;
      const y = groundAt(e.x, e.z);
      add(e.x, e.z, e.heading, e.info.halfLength, e.info.halfWidth, y - 0.5, y + e.info.height, `the ${e.info.name.toLowerCase()}`);
      if (e.carts) {
        for (const c of e.carts) add(c.x, c.z, c.heading, c.info.halfLength, c.info.halfWidth, y - 0.5, y + c.info.height, 'a baggage cart');
      }
    }
    const p = ST.plane;
    if (p && p.state !== 'gone' && p.model.visible) {
      const prof = ST.prof;
      const mid = J.offset(p.x, p.z, p.heading, (prof.nose + prof.tail) / 2, 0, _o);
      add(mid.x, mid.z, p.heading, (prof.nose - prof.tail) / 2, prof.halfWidth, p.y - 0.5, p.y + prof.top, 'the aeroplane');
      const wm = J.offset(p.x, p.z, p.heading, (prof.wingFront + prof.wingBack) / 2, 0, _o2);
      add(wm.x, wm.z, p.heading, (prof.wingFront - prof.wingBack) / 2, prof.wingSpan || prof.halfSpan, p.y + prof.wingH - 0.3, p.y + prof.wingH + 0.3, 'the wing');
    }
  },
});

/* ------------------------------------------------------------------ */
/* The plug-in                                                         */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'staff',

  buildWorld(sim, group) {
    const was = ST.active;
    ST.group = group;
    ST.built = false;
    ST.stand = null;
    ST.hidden.length = 0;
    for (const p of ST.passengers) disposePerson(p.model);
    ST.passengers.length = 0;
    // Parked models went with the old group; the driven one is in the scene.
    for (const id of STAFF_IDS) {
      const e = ST.fleet[id];
      if (e && !(was && ST.driving === id && sim.vehicleModel === e.model)) delete ST.fleet[id];
    }
    group.visible = was;
    if (was) {
      ST.sim = sim;
      if (buildScene(sim)) {
        ST.dock = null;
        ST.hooked = false;
        ST.tugClear = null;
        ST.arrival = null;
        if (ST.marshalling) onFoot.setControl(null);
        ST.marshalling = false;
        resetPlaneParked();
        setJob(sim, 'stairs');
        // A rebuilt apron has its air bridge and clutter back.
        hideClutter(sim);
      } else {
        endSession(sim, 'world');
      }
    }
  },

  startMode(sim, mode, opts) {
    const kind = opts && opts.kind;
    if (mode === 'drive' && STAFF_IDS.includes(kind) && !(sim.vehicle && sim.vehicle.spec && sim.vehicle.spec.id === kind)) {
      /*
       * Restart, from the pause menu. main.js restarts by calling startMode
       * again with the drive's own mode and options, and startMode is the
       * aeroplane's door: it takes the vehicle away (stopDrive) and starts
       * a flight called 'drive' with nothing to drive, then tells us a drive
       * of the tug has begun. Restart on the ramp means the shift starts
       * over, so do that, properly, through startDrive.
       */
      if (ST.restarting) return;
      ST.restarting = true;
      try {
        ST.request = true;
        if (sim.gameMap && sim.settings) sim.gameMap.tug = sim.settings.map;
        sim.startDrive('tug');
      } catch (err) {
        console.error('[staff] could not start the shift over', err);
        endSession(sim, 'menu');
      } finally {
        ST.restarting = false;
      }
      return;
    }
    if (mode === 'drive' && STAFF_IDS.includes(kind)) {
      // From the Dev button (a fresh shift, or the button again mid-shift,
      // which starts the shift over), or from getting into another vehicle.
      const req = ST.request;
      ST.request = null;
      if ((!ST.active || req) && !beginSession(sim)) {
        notify(sim, 'There is no apron to work on here', 'warn');
        return;
      }
      adopt(sim, kind);
      if (req) {
        const w = ST.spots.walker;
        ST.pendingWalk = { x: w.x, z: w.z, heading: w.heading };
      } else {
        const e = ST.fleet[kind];
        const name = e && e.info ? e.info.name : 'The vehicle';
        notify(sim, sim.touch
          ? `${name}: the pedals go and stop, the wheel steers. Tap “get out” when you have stopped.`
          : `${name}: Shift to go, Ctrl to brake (hold it to reverse), A and D to steer. Stop, then O to get out.`, 'info', 6);
      }
    } else if (ST.active) {
      endSession(sim, 'mode');
    }
  },

  stop(sim, why) {
    if (!ST.active) return;
    if (why === 'menu') endSession(sim, 'menu');
  },

  /*
   * The ramp vehicles' camera: the van's own chase camera, kept out of the
   * buildings, and a high camera over the tug while it is pushing.
   *
   * The van's camera sits eight metres behind and three up and knows nothing
   * about what is behind it. On the apron what is behind a vehicle facing an
   * aeroplane nose-in to a stand is the terminal: the moment the tug hooked
   * on, the whole screen went flat grey — the camera was inside the air
   * bridge — for the one job where you most need to see.
   */
  camera(sim, dt, camera) {
    if (!ST.active || onFoot.active || !staffDriving(sim) || !sim.driveCam) return false;
    const v = sim.vehicle;
    if (ST.hooked && ST.driving === 'tug' && sim.driveCam.mode !== 'bonnet') {
      pushCamera(sim, dt, camera, v);
      return true;
    }
    if (ST.camPush) {
      ST.camPush = false;
      sim.driveCam.started = false;
    }
    // The drive camera is the car team's, mid-rewrite: if it throws, let
    // main.js place the camera this frame rather than lose the whole shift.
    try {
      sim.driveCam.update(camera, v, dt);
    } catch (err) {
      if (!ST.camWarned) {
        ST.camWarned = true;
        console.warn('[staff] the drive camera failed; leaving the camera to the game', err);
      }
      return false;
    }
    unblock(camera, v, sim.driveCam.look);
    return true;
  },

  update(sim, dt) {
    if (!ST.active) return;
    if (!staffDriving(sim)) {
      endSession(sim, 'mode');
      return;
    }
    ST.t += dt;
    ST.warnT -= dt;
    const v = sim.vehicle;
    if (v.spec.id !== ST.driving) adopt(sim, v.spec.id);
    if (ST.pendingWalk) {
      const w = ST.pendingWalk;
      ST.pendingWalk = null;
      onFoot.start(sim, { x: w.x, z: w.z, headingDeg: w.heading, outfit: 'staff' });
      notify(sim, 'Welcome to the ramp crew! Your first job is on the card.', 'good', 4);
      radio(sim, `Ramp, good morning. The airliner on ${ST.stand.id} is ready for its steps.`);
    }

    // Ramp vehicles do not drive through the aeroplane, each other, or the
    // apron's own furniture — some of which drives about.
    tickProps();
    const e = ST.fleet[ST.driving];
    const bump = e && !ST.hooked && !ST.tugClear && !(ST.dock && ST.dock.id === ST.driving) ? blockedBy(v, e, dockingIn(v, e)) : null;
    if (bump) {
      if (ST.prev.ok) {
        v.pos.x = ST.prev.x;
        v.pos.z = ST.prev.z;
        v.heading = ST.prev.heading;
      }
      v.speed = 0;
      if (ST.warnT <= 0) {
        ST.warnT = 3;
        notify(sim, `Bump! Careful with ${bump}.`, 'warn', 2.5);
      }
    }

    stepJobs(sim, dt);
    if (ST.tugClear) stepTugClear(sim, dt);
    syncDriven(sim);
    if (e && e.carts) followCarts(e, v);
    if (sim.vehicleModel === (e && e.model)) {
      sim.vehicleModel.position.copy(v.pos);
      if (v.quat) sim.vehicleModel.quaternion.copy(v.quat);
      // A vehicle held in place this frame is drawn where it is held.
      if (ST.dock || ST.hooked || ST.tugClear) sim.vehicleModel.rotation.set(0, -v.heading * D2R, 0);
    }
    ST.prev.x = v.pos.x;
    ST.prev.z = v.pos.z;
    ST.prev.heading = v.heading;
    ST.prev.ok = true;

    // The aeroplane's engines turn while it moves.
    const p = ST.plane;
    if (p && p.model.visible && (p.state === 'leaving' || p.state === 'arriving') && p.model.userData.update) {
      MOVING.groundSpeed = p.state === 'arriving' && ST.arrival ? ST.arrival.speed : p.speed;
      try {
        p.model.userData.update(dt, MOVING, sim.weather || WEATHER0);
      } catch (err) {
        /* a model that cannot animate still moves */
      }
    }
    stepPassengers(dt);
    const bm = beaconMaterial();
    bm.emissiveIntensity = 0.3 + Math.max(0, Math.sin(ST.t * 6)) * 1.4;

    const gd = guide(sim);
    drawMarker(gd.at, ST.t);
    if (gd.text !== ST.objective) {
      ST.objective = gd.text;
      try {
        if (sim.hud && sim.hud.setObjective) sim.hud.setObjective(`Ramp crew · round ${ST.round}`, gd.text);
      } catch (err) {
        /* ignore */
      }
    }
    drawCard();
  },

  devActions: [
    {
      label: 'Work at the airport',
      hint: 'Be the ramp crew: on foot in a hi-vis vest, with a pushback tug, a baggage train, a stair truck and a catering truck to drive, and jobs to do.',
      run(sim) {
        workAtTheAirport(sim);
      },
    },
  ],
});

/* ------------------------------------------------------------------ */
/* For the tests and the console                                       */
/* ------------------------------------------------------------------ */

export const staff = {
  get active() {
    return ST.active;
  },
  get job() {
    return ST.job;
  },
  get driving() {
    return ST.driving;
  },
  get hooked() {
    return ST.hooked;
  },
  get plane() {
    return ST.plane;
  },
  get stand() {
    return ST.stand;
  },
  get spots() {
    return ST.spots;
  },
  get pushBox() {
    return ST.pushBox;
  },
  get fleet() {
    return ST.fleet;
  },
  get passengers() {
    return ST.passengers.length;
  },
  /** What is in the way of the taxiing aeroplane: a vehicle id, 'you', or null. */
  get pathBlock() {
    return ST.pathBlock;
  },
  /** How many passengers have waved back at the walker. */
  get wavedBack() {
    let n = 0;
    for (const p of ST.passengers) if (p.wavedBack) n++;
    return n;
  },
  get arrival() {
    return ST.arrival;
  },
  get marshalling() {
    return ST.marshalling;
  },
  get stars() {
    return { ...ST.stars, total: ST.total, round: ST.round };
  },
  start(sim) {
    return workAtTheAirport(sim);
  },
  drive(sim, id) {
    return drive(sim, id);
  },
  /** Set the job directly (tests): 'stairs' | 'push' | 'marshal' ... */
  setJob(sim, job) {
    if (job === 'push') ST.boxMesh.visible = true;
    if (job === 'next') {
      ST.plane.state = 'gone';
      ST.plane.model.visible = false;
    }
    setJob(sim, job);
  },
  /** Put the vehicle being driven somewhere, facing somewhere. */
  placeVehicle(sim, x, z, heading) {
    const v = sim.vehicle;
    if (!v) return;
    v.pos.x = x;
    v.pos.z = z;
    v.heading = heading;
    v.speed = 0;
    ST.prev.ok = false;
  },
  J,
};

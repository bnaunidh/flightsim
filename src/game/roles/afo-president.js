/**
 * Air Force One, from the President's own seat.
 *
 * The owner's own line: "also one where you ARE the president" — in BOTH
 * Air Force One missions. Nobody flies anything in this seat: the jet and
 * the escort are flown by the game (src/game/roles/npc-flyer.js, the same
 * engine the escort seat already trusts the airliner to — see
 * src/game/roles/afo-lead.js), and you walk a small, cheap VIP interior
 * built from merged boxes (the same part()/mergeParts() trick
 * src/features/staff/person.js uses for a person, so the whole cabin is
 * ONE draw call): a nose office, a conference room, a press/staff section
 * and, in the attack mission, a secure room in the middle — with real
 * windows (gaps left in the wall, nothing drawn over them) that show the
 * real sky, the island and the escort fighters outside, because the real
 * aeroplane model is hidden while you are the one walking it from the
 * inside (`air.model.visible = false`, this story's own NpcFlyer only).
 *
 * A short schedule gives it a point (the mission's own objective banner —
 * sim.hud.setObjective, wired generically off sim.runner.onStep — shows
 * each line; nothing extra is built for that): take the call in the
 * office, the briefing in the conference room, visit the cockpit for the
 * approach, sit down for landing. In "Under Attack" the Secret Service
 * wants you in the secure room; you watch the escort clear the drones
 * through the window and give the order to press on or divert (flavour
 * only — the mission's own field is the one it lands at either way) before
 * taking your seat for the landing.
 *
 * THE WALKING ITSELF is its own small thing, not onfoot.js's: that file's
 * Walker (src/features/staff/walk.js) stands on the island's own terrain,
 * sampling the real ground and the real OBSTACLES list, which has nothing
 * to do with the inside of a cabin that is itself flying. What IS reused
 * from the on-foot work is everything that is not tied to the ground: the
 * walking/look controls and the touch stick (src/features/staff/ui.js, the
 * same singleton onfoot.js and staff.js already share), the same action
 * ids (Settings → Controls → On foot), and src/features/events/ui.js's own
 * card for the two moments something is actually asked of you. The camera
 * is first person — the cabin is a few metres across, far too tight for a
 * chase camera to ever clear a wall — which also means there is no third
 * person model to pose and no collision to run against the camera itself.
 *
 * Kid-safe throughout, like every AFO file: nobody is ever hurt, nothing
 * here can fail on anything but time and "did you walk where you were
 * asked" — see afo-combat.js's own header for the rest of the rule.
 */

import * as THREE from '../../vendor/three.module.js';
import { registerExtension } from '../extensions.js';
import { isKey } from '../../flight/input.js';
import { RUNWAY } from '../../world/airport.js';
import { heightAt } from '../../world/terrain.js';
import {
  field, speak, notify, registerVoices, runwayFrame, RW, flat, cruiseSpeed,
} from '../../features/events/common.js';
import { AttackField } from '../../features/events/afo-combat.js';
import { showCard } from '../../features/events/ui.js';
import * as FUI from '../../features/staff/ui.js';
import { WALK } from '../../features/staff/walk.js';
import { part, mergeParts, personMaterial } from '../../features/staff/person.js';
import { NpcFlyer } from './npc-flyer.js';
import { onFoot } from '../../features/onfoot.js';
import { registerStory, castStory } from './cast.js';
import { schemeFor } from '../../aircraft/liveries.js';
import { AIRCRAFT, getAircraft } from '../../aircraft/types.js';

const LEAD = 'Guardian lead';
const D2R = Math.PI / 180;
const AIM = new THREE.Vector3();

function typeById(id) {
  return AIRCRAFT.find((a) => a.id === id) || getAircraft(id);
}
const AFO_SCHEME = () => schemeFor(typeById('b747'), 'potus');

function scoreFor(elapsed, par) {
  if (elapsed <= par) return 1;
  return Math.max(0, 1 - (elapsed - par) / par);
}

/* ================================================================== *
 * The cabin: one merged mesh, a cheap AABB floor plan, a short list of
 * obstacle boxes (furniture and the secure room's own walls) and the
 * named spots the schedule asks you to walk to. Local coordinates:
 * +x right, +y up, +z towards the tail — nose is at the most negative z.
 * ================================================================== */

const CAB = {
  halfW: 2.3,
  z0: -22.6, // the cockpit bulkhead
  z1: 20, // the tail end
  floorY: 0,
  ceilY: 2.15,
  eyeY: 1.58,
};

/*
 * Named spots the schedule reads, local to the cabin — each one clear floor
 * in front of its own furniture (the desk, the table), not standing inside
 * it: the OBSTACLES list below would only ever push a teleported-to spot
 * back out again, and a walked-to one would simply never get there.
 */
export const SPOTS = {
  office: { x: 0, z: -17.3 },
  conference: { x: 0, z: -5.7 },
  cockpitDoor: { x: 0, z: -20.4 },
  window: { x: -1.95, z: 3.5 },
  seat: { x: 1.1, z: 6 },
  secureDoor: { x: 0, z: -2 },
  secureInside: { x: 0, z: -4.5 },
};

/** Furniture and walls the walker cannot step through (local AABBs). */
const OBSTACLES = [
  { x0: -0.95, x1: 0.95, z0: -19.1, z1: -17.8, tag: 'desk' },
  { x0: -1.0, x1: 1.0, z0: -8.6, z1: -6.2, tag: 'table' },
  { x0: 1.0, x1: 1.9, z0: 13.5, z1: 18, tag: 'galley' },
  // Secure room: a ring of four short walls round x:[-1.6,1.6] z:[-7,-1],
  // with a 1.3 m gap in the +z (press-facing) wall for the door.
  { x0: -1.82, x1: -1.6, z0: -7, z1: -1, tag: 'secure-wall' },
  { x0: 1.6, x1: 1.82, z0: -7, z1: -1, tag: 'secure-wall' },
  { x0: -1.82, x1: 1.82, z0: -7.22, z1: -7, tag: 'secure-wall' },
  { x0: -1.82, x1: -0.65, z0: -1.22, z1: -1, tag: 'secure-wall' },
  { x0: 0.65, x1: 1.82, z0: -1.22, z1: -1, tag: 'secure-wall' },
  // The flight-deck bulkhead, with a 1.6 m gap for the door.
  { x0: -1.9, x1: -0.8, z0: -20.62, z1: -20.4, tag: 'fd-wall' },
  { x0: 0.8, x1: 1.9, z0: -20.62, z1: -20.4, tag: 'fd-wall' },
];

/** Inside the secure room's own four walls (not just near the door). */
export function inSecureRoom(x, z) {
  return x > -1.6 && x < 1.6 && z > -7 && z < -1;
}

let INTERIOR = null; // built once; a flying cabin never changes shape.

function addBox(parts, color, cx, cy, cz, sx, sy, sz) {
  parts.push(part(BOX(), color, cx, cy, cz, 0, 0, 0, sx, sy, sz));
}
let _box = null;
function BOX() {
  if (!_box) _box = new THREE.BoxGeometry(1, 1, 1);
  return _box;
}

/** Build the whole interior as one merged, vertex-coloured mesh. */
function buildInterior() {
  const parts = [];
  const FLOOR = 0x5a4a3a;
  const WALLLO = 0xdfe3ea;
  const WALLHI = 0xc9cfda;
  const CEIL = 0xf4f2ec;
  const WOOD = 0x3c2a1c;
  const SEAT_C = 0x1d3a63;
  const SECURE_C = 0x7d8794;
  const FD_C = 0x8893a1;
  const t = 0.12; // wall thickness
  const w = CAB.halfW;
  const z0 = CAB.z0;
  const z1 = CAB.z1;

  // Floor and ceiling.
  addBox(parts, FLOOR, 0, -0.05, (z0 + z1) / 2, w * 2, 0.1, z1 - z0);
  addBox(parts, CEIL, 0, CAB.ceilY + 0.05, (z0 + z1) / 2, w * 2, 0.1, z1 - z0);

  // Side walls: a continuous kick panel and a continuous ceiling trim, with
  // window-height pillars every three metres (the gaps between them are the
  // windows — nothing is drawn there, so the real sky shows through).
  for (const side of [-1, 1]) {
    const x = side * (w - t / 2);
    addBox(parts, WALLLO, x, 0.4, (z0 + z1) / 2, t, 0.8, z1 - z0);
    addBox(parts, WALLHI, x, CAB.ceilY - 0.12, (z0 + z1) / 2, t, 0.3, z1 - z0);
    for (let z = z0 + 1.6; z < z1 - 0.8; z += 3) {
      addBox(parts, WALLLO, x, 1.37, z + 0.2, t, 1.15, 0.4);
    }
  }
  // The nose and tail bulkheads (no need for anybody to walk past either end).
  addBox(parts, WALLLO, 0, CAB.ceilY / 2, z0 - t / 2, w * 2, CAB.ceilY, t);
  addBox(parts, WALLLO, 0, CAB.ceilY / 2, z1 + t / 2, w * 2, CAB.ceilY, t);

  // The office: a desk and a chair, right at the nose.
  addBox(parts, WOOD, 0, 0.38, -18.45, 1.9, 0.76, 1.3);
  addBox(parts, SEAT_C, 0, 0.42, -17.5, 0.5, 0.84, 0.5);

  // The conference table and a few chairs either side.
  addBox(parts, WOOD, 0, 0.36, -7.4, 2, 0.72, 2.6);
  for (const s of [-1, 1]) for (const z of [-8.6, -6.2]) addBox(parts, SEAT_C, s * 1.15, 0.4, z, 0.5, 0.8, 0.5);

  // The press/staff section: two rows of simple seats.
  for (let z = -1; z < 6.5; z += 1.5) for (const s of [-1, 1]) addBox(parts, SEAT_C, s * 1.1, 0.42, z, 0.55, 0.84, 0.6);

  // The President's own seat for landing.
  addBox(parts, SEAT_C, SPOTS.seat.x, 0.44, SPOTS.seat.z, 0.6, 0.92, 0.6);

  // The galley counter, aft.
  addBox(parts, WOOD, 1.45, 0.5, 15.5, 0.8, 1.0, 4);

  // The secure room's walls, its doorway simply left out — and, in each
  // long side wall, its own window (y 0.75..1.95, a 1.6 m gap centred on
  // z = -4), so the escort's own fight is still visible from inside it:
  // "watch the escorts drive off the drones through the window".
  for (const sx of [-1.71, 1.71]) {
    addBox(parts, SECURE_C, sx, 0.38, -4, 0.22, 0.76, 6); // kick panel, full length
    addBox(parts, SECURE_C, sx, 2.02, -4, 0.22, 0.26, 6); // ceiling trim, full length
    addBox(parts, SECURE_C, sx, 1.35, -5.9, 0.22, 1.2, 2.2); // window-band, nose side
    addBox(parts, SECURE_C, sx, 1.35, -2.1, 0.22, 1.2, 1.8); // window-band, tail side
  }
  addBox(parts, SECURE_C, 0, 1.1, -7.11, 3.64, 2.2, 0.22);
  addBox(parts, SECURE_C, -1.23, 1.1, -1.11, 1.17, 2.2, 0.22);
  addBox(parts, SECURE_C, 1.23, 1.1, -1.11, 1.17, 2.2, 0.22);
  // A plain bench inside it.
  addBox(parts, SEAT_C, 0, 0.3, -5.6, 1.6, 0.6, 0.5);

  // The flight-deck bulkhead and door frame (the little the owner asked the
  // president be able to reach — "the stairs/cockpit where you can talk to
  // the crew" — without building a second flyable cockpit).
  addBox(parts, FD_C, -1.35, CAB.ceilY / 2, -20.5, 1.1, CAB.ceilY, 0.22);
  addBox(parts, FD_C, 1.35, CAB.ceilY / 2, -20.5, 1.1, CAB.ceilY, 0.22);
  addBox(parts, 0x161a20, 0, 0.9, -21.6, 1.5, 1.6, 0.1); // a dark instrument panel, seen through the door

  const geo = mergeParts(parts);
  const mesh = new THREE.Mesh(geo, personMaterial());
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.name = 'afo-president-interior';
  const group = new THREE.Group();
  group.name = 'afo-president-cabin';
  group.add(mesh);
  const light = new THREE.PointLight(0xfff2d8, 1.4, 26, 2);
  light.position.set(0, CAB.ceilY - 0.3, -2);
  group.add(light);
  const amb = new THREE.AmbientLight(0xaab4c8, 0.55);
  group.add(amb);
  return group;
}

function ensureInterior(scene) {
  if (!INTERIOR) INTERIOR = buildInterior();
  if (INTERIOR.parent !== scene) scene.add(INTERIOR);
  INTERIOR.visible = true;
  return INTERIOR;
}

/* ================================================================== *
 * The stories: the flight itself (and, in the attack mission, the drones),
 * identical in spirit to afo-lead.js's own escort stories — the President
 * merely rides along and never touches a control.
 * ================================================================== */

function homeRunway() {
  runwayFrame();
  const out = { thr: new THREE.Vector3(), dir: new THREE.Vector3(), hdg: RUNWAY.headingDeg ?? 90, td: new THREE.Vector3(), stop: new THREE.Vector3() };
  out.dir.copy(RW.f);
  out.thr.copy(RW.c).addScaledVector(RW.f, -RW.L / 2);
  out.thr.y = heightAt(out.thr.x, out.thr.z);
  out.td.copy(out.thr).addScaledVector(out.dir, Math.min(200, RW.L * 0.2));
  out.td.y = heightAt(out.td.x, out.td.z);
  out.stop.copy(out.thr).addScaledVector(out.dir, RW.L * 0.55);
  out.stop.y = heightAt(out.stop.x, out.stop.z);
  return out;
}

export const STORY_NORMAL = 'afo-president-normal';
export const STORY_ATTACK = 'afo-president-attack';

function buildEscort(sim, air) {
  let escort = null;
  try {
    escort = new NpcFlyer(sim.scene, 'vanguard', { name: 'afo-president-escort' });
  } catch (e) {
    console.warn('[afo-president] the escort could not be built; the flight carries on without one.', e);
    return null;
  }
  escort.place({ pos: air.pos.clone(), headingDeg: air.heading, speed: Math.max(60, air.speed), onGround: false });
  escort.follow(air, { back: 20, right: 70, down: -6, lookahead: 320 });
  return escort;
}

function createPresidentNormal(sim) {
  registerVoices();
  const air = new NpcFlyer(sim.scene, 'b747', { name: 'afo-president-air', livery: AFO_SCHEME() });
  air.model.visible = false; // you are inside it; see this file's header.
  const h = ((RUNWAY.headingDeg ?? 90) * Math.PI) / 180;
  const start = { x: RUNWAY.thresholdWest.x + Math.sin(h) * 1600, z: RUNWAY.thresholdWest.z - Math.cos(h) * 1600 };
  air.place({ pos: new THREE.Vector3(start.x, (RUNWAY.elev || 0) + 230, start.z), headingDeg: RUNWAY.headingDeg ?? 90, speed: 82, gearDown: false });
  air.direct(RUNWAY.headingDeg ?? 90, 1250, cruiseSpeed('b747'));
  const escort = buildEscort(sim, air);

  const st = {
    id: STORY_NORMAL, air, escort, t: 0, turned: false, squared: false, home: false,
  };
  air.onEvent = (what) => {
    if (what === 'touchdown') notify(sim, `${field()}'s own field — down safe.`, 'good', 4);
  };
  /*
   * Out over the sea on the departure heading, then turn 180 and come
   * straight back on the reciprocal — never off the runway's own extended
   * centreline (heading and its reciprocal share the same line) — so that
   * by the time land() is called the jet is already on a stable final
   * approach and NpcFlyer's 'vector' phase can go straight to it, rather
   * than needing the 9.5 km loop it is built to recover from a BAD
   * position with. (Measured: the old profile — depart, one 55° turn,
   * land(), which the escort seat flew too until afo-lead.js took this
   * one — took 451 s just to reach 'final'; the President's own schedule
   * needs him down and STOPPED, so that loop is not something this seat
   * can afford to risk.)
   */
  st.update = (simArg, dt) => {
    st.t += dt;
    if (!st.turned && st.t > 40) {
      st.turned = true;
      air.direct(((RUNWAY.headingDeg ?? 90) + 180) % 360, 1250, cruiseSpeed('b747'));
      speak(simArg, `${LEAD}, ${field()} Approach, turning back towards the field.`, 'approach');
    }
    if (st.turned && !st.squared && st.t > 220) {
      st.squared = true;
      air.direct(RUNWAY.headingDeg ?? 90, 1250, cruiseSpeed('b747'));
      speak(simArg, `${LEAD}, steady now, lined up for the approach.`, 'approach');
    }
    if (st.squared && air.mode !== 'land' && st.t > 225) {
      air.rw = homeRunway();
      air.vecAlt = air.pos.y;
      air.land(air.rw);
      speak(simArg, `${LEAD}, bringing him home for ${field()}. Peel off when you are clear.`, 'approach');
    }
    air.update(dt, simArg.weather);
    if (escort) {
      runwayFrame();
      const closeIn = air.onGround || (flat(air.pos, RW.c) < 4000 && air.agl * 3.28084 < 2200);
      if (closeIn && escort.mode !== 'land') {
        escort.rw = homeRunway();
        escort.vecAlt = escort.pos.y;
        escort.land(escort.rw);
      }
      escort.update(dt, simArg.weather);
    }
    runwayFrame();
    st.home = flat(air.pos, RW.c) < 1500;
  };
  st.info = (out) => {
    out.home = st.home;
    out.landPhase = air.landPhase;
    out.onGround = air.onGround;
    out.stopped = air.stopped;
  };
  st.dispose = () => {
    air.model.visible = true;
    air.dispose();
    if (escort) escort.dispose();
  };
  return st;
}
registerStory(STORY_NORMAL, createPresidentNormal);

function droneWaveAhead(air) {
  const h = air.heading * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const ahead = 3400;
  const spread = 900;
  const out = [];
  for (const side of [-1, 1]) {
    out.push(new THREE.Vector3(air.pos.x + fx * ahead + rx * spread * side, Math.max(20, air.pos.y - 300), air.pos.z + fz * ahead + rz * spread * side));
  }
  return out;
}

function createPresidentAttack(sim) {
  registerVoices();
  const air = new NpcFlyer(sim.scene, 'b747', { name: 'afo-president-air-attack', livery: AFO_SCHEME() });
  air.model.visible = false;
  // The same fixed air start the captain and the escort seats agree on
  // (afo-lead.js's ATTACK_AIR_START) — duplicated here as a plain constant
  // rather than imported, so this file never has to import afo-lead.js
  // (which imports this file, for the roles list — see its own footer).
  const START = { x: -9800, z: -2300, y: 1450, hdg: 100 };
  air.place({ pos: new THREE.Vector3(START.x, START.y, START.z), headingDeg: START.hdg, speed: cruiseSpeed('b747'), gearDown: false });
  air.direct(START.hdg, START.y, cruiseSpeed('b747'));
  const escort = buildEscort(sim, air);
  const attack = new AttackField(sim);

  const st = {
    id: STORY_ATTACK, air, escort, attack, t: 0, warned: false, waveSent: false, home: false,
    failWhy: null, inSecure: false, secureSinceWarn: null, headingHome: false,
  };
  air.onEvent = (what) => {
    if (what === 'touchdown') notify(sim, `${field()} — down safe.`, 'good', 4);
  };
  st.escortGunCd = 0;
  st.flareCd = 2;
  st.flaresUsed = 0;
  st.update = (simArg, dt) => {
    st.t += dt;
    air.update(dt, simArg.weather);
    if (escort) escort.update(dt, simArg.weather);
    if (!st.warned && st.t > 8) {
      st.warned = true;
      speak(simArg, `${LEAD}, ${field()} Approach. Unidentified drones, low, off his nose. No transponder, no response. Evasive action is authorised.`, 'approach', 1);
    }
    if (!st.waveSent && st.t > 11) {
      st.waveSent = true;
      attack.spawnWave(droneWaveAhead(air));
    }
    if (st.waveSent) {
      attack.update(dt, air.pos, air.vel);
      // The escort's own gun: a fair, steady aim — a missile already in
      // the air first (the President never touches a flare, so the gun is
      // the only thing standing between a launch and a hit), then the
      // nearest drone, led for the pellet's flight (AttackField.aimFrom()).
      if (escort) {
        st.escortGunCd -= dt;
        if (st.escortGunCd <= 0) {
          const dir = attack.aimFrom(escort.pos, escort.vel, AIM);
          if (dir) attack.fireGun(escort.pos.clone().addScaledVector(dir, 6), dir, escort.vel);
          st.escortGunCd = 0.3;
        }
      }
      // The NPC captain's own four flares, used when a missile is genuinely
      // close — the same limited resource a human captain has.
      if (st.flaresUsed < 4) {
        st.flareCd -= dt;
        if (st.flareCd <= 0) {
          const danger = attack.missiles.some((m) => m.alive && !m.flare && m.pos.distanceTo(air.pos) < 1900);
          if (danger) {
            attack.deployDecoy(air.pos, air.vel);
            st.flaresUsed++;
            st.flareCd = 3;
            notify(simArg, 'Air Force One is dropping flares!', 'warn', 4);
          }
        }
      }
      /*
       * No failIf on a missile getting through, on purpose: the President
       * never touches a flare or a gun — every other seat's own fail path
       * is tied to something the player there could have done differently,
       * and here that would just be the escort's own dice. The one thing
       * actually asked of the player (reaching the secure room) is the one
       * thing that can fail it, below.
       */
      // Drones cleared, or the escort has had a fair, generous crack at it
      // (2:30 since the wave arrived, well past the captain/escort seats'
      // own 180 s patience for the same fight): turn for home either way.
      // NpcFlyer's own 'vector' phase (see its own header) finds the
      // approach from wherever this leaves it, the same way the normal
      // flight's own t > 125 turn does.
      const clear = attack.dronesAlive === 0 && attack.missilesInbound === 0;
      if (!st.headingHome && (clear || st.t > 11 + 150)) {
        st.headingHome = true;
        air.rw = homeRunway();
        air.vecAlt = air.pos.y;
        air.land(air.rw);
        speak(simArg, `${LEAD}, ${field()} Approach. ${clear ? 'Clear of the drones.' : 'Pressing on.'} Bringing him home.`, 'approach');
      }
    }
    // The Secret Service's own patience: once the warning is given, you have
    // a generous window to reach the secure room before the mission gives up
    // on you — never a wreck, never anybody hurt, just "not this time". W is
    // this file's own walker state (below); read directly, the same way a
    // step's own check() does.
    if (!st.inSecure && inSecureRoom(W.x, W.z)) st.inSecure = true;
    if (st.warned && !st.inSecure) {
      st.secureSinceWarn = (st.secureSinceWarn ?? 0) + dt;
      if (st.secureSinceWarn > 42 && !st.failWhy) {
        st.failWhy = 'The Secret Service could not get you clear in time. Follow them to the secure room next time.';
      }
    }
    runwayFrame();
    st.home = flat(air.pos, RW.c) < 1500;
  };
  st.info = (out) => {
    out.dronesAlive = attack.dronesAlive;
    out.missilesInbound = attack.missilesInbound;
    out.stats = { ...attack.stats };
    out.home = st.home;
    out.failWhy = st.failWhy;
    out.warned = st.warned;
    out.landPhase = air.landPhase;
    out.onGround = air.onGround;
    out.stopped = air.stopped;
  };
  st.dispose = () => {
    air.model.visible = true;
    air.dispose();
    if (escort) escort.dispose();
    attack.dispose();
  };
  return st;
}
registerStory(STORY_ATTACK, createPresidentAttack);

function storyFor(seatStoryId) {
  return castStory(seatStoryId);
}

/* ================================================================== *
 * The walker: local to the cabin, flat-floor, first person.
 * ================================================================== */

const W = { x: SPOTS.seat.x, z: 10, yaw: 180, pitch: -4 };
const KEYS = Object.create(null);
const VK = ['walkForward', 'walkBack', 'walkLeft', 'walkRight', 'run', 'footLookLeft', 'footLookRight', 'footLookUp', 'footLookDown'];

function held(sim, action) {
  for (const code of Object.keys(KEYS)) if (KEYS[code] && isKey(sim, action, code)) return true;
  return false;
}

function resolveObstacles(p, radius) {
  for (const o of OBSTACLES) {
    const x0 = o.x0 - radius;
    const x1 = o.x1 + radius;
    const z0 = o.z0 - radius;
    const z1 = o.z1 + radius;
    if (p.x <= x0 || p.x >= x1 || p.z <= z0 || p.z >= z1) continue;
    const dL = p.x - x0;
    const dR = x1 - p.x;
    const dB = p.z - z0;
    const dF = z1 - p.z;
    const m = Math.min(dL, dR, dB, dF);
    if (m === dL) p.x = x0;
    else if (m === dR) p.x = x1;
    else if (m === dB) p.z = z0;
    else p.z = z1;
  }
}

function nearSpot(spot, radius = 1.6) {
  return Math.hypot(W.x - spot.x, W.z - spot.z) < radius;
}

/* ================================================================== *
 * The extension: walking, the camera, and the one-off flavour choices.
 * The schedule itself (the steps) lives on the two seat definitions below —
 * this only drives the walker and answers nearSpot()/inSecureRoom() back
 * to them, the same split every other AFO file uses (a feature that runs
 * the live thing, a mission that reads it back).
 * ================================================================== */

const S = {
  sim: null,
  active: false,
  missionId: null,
  storyId: null,
  camStarted: false,
  wavedAt: false,
  choseAt: false,
  talkedAt: false,
  touchHidden: false,
};

function isTouch(sim) {
  return !!(sim && sim.touch);
}

function teardown(sim) {
  if (!S.active) return;
  S.active = false;
  if (INTERIOR) INTERIOR.visible = false;
  if (sim) {
    sim.override = S.prevOverride ?? null;
    if (sim.model) sim.model.visible = true;
    if (sim.touch && sim.touch.setVisible && S.touchHidden) sim.touch.setVisible(true);
  }
  S.touchHidden = false;
  FUI.setTouch(false);
  FUI.setPrompt('');
  if (sim) FUI.setHudWalking(sim.hud, false);
  onFoot.setExitRule(null);
  for (const k of Object.keys(KEYS)) delete KEYS[k];
}

const PARK = { throttle: 0, brakes: 1, pitch: 0, roll: 0, yaw: 0 };

function setup(sim, missionId) {
  teardown(sim);
  S.sim = sim;
  S.active = true;
  S.missionId = missionId;
  S.storyId = missionId === 'afo-attack' ? STORY_ATTACK : STORY_NORMAL;
  S.camStarted = false;
  S.wavedAt = false;
  S.choseAt = false;
  S.talkedAt = false;
  W.x = SPOTS.seat.x;
  W.z = 10;
  W.yaw = 180;
  W.pitch = -4;
  ensureInterior(sim.scene);
  S.prevOverride = sim.override;
  sim.override = PARK;
  if (sim.model) sim.model.visible = false;
  FUI.setHudWalking(sim.hud, true);
  /*
   * The real aeroplane is parked on the ground the whole time (it has to
   * be, to stay put while you are not flying it) — exactly the condition
   * onfoot.js's own "Press O to get out" prompt looks for, which would let
   * a press of O spawn ITS OWN walker on top of this seat's. The exit
   * rule is the mechanism runaway.js already uses for the same kind of
   * "not through the normal door, thanks" case.
   */
  onFoot.setExitRule({
    decide: () => ({ why: 'You are the President — walk to where you are asked, not out of the aeroplane.' }),
  });
  if (isTouch(sim) && sim.touch && sim.touch.setVisible) {
    sim.touch.setVisible(false);
    S.touchHidden = true;
  }
}

function currentSeat(sim) {
  const r = sim && sim.runner;
  const def = r && r.status === 'running' ? r.def : null;
  const id = def && (def.baseId || def.id);
  if (!def || def.roleId !== 'president' || (id !== 'afo-normal' && id !== 'afo-attack')) return null;
  return id;
}

const _look = { x: 0, y: 0 };
function stepWalker(sim, dt) {
  const turn = (held(sim, 'footLookRight') ? 1 : 0) - (held(sim, 'footLookLeft') ? 1 : 0);
  const tilt = (held(sim, 'footLookUp') ? 1 : 0) - (held(sim, 'footLookDown') ? 1 : 0);
  if (turn) W.yaw += turn * 110 * dt;
  if (tilt) W.pitch += tilt * 60 * dt;
  FUI.takeLook(_look);
  W.yaw += _look.x * 0.3;
  W.pitch -= _look.y * 0.22;
  W.pitch = Math.max(-60, Math.min(42, W.pitch));

  const T = FUI.touch;
  const kf = held(sim, 'walkForward');
  const kb = held(sim, 'walkBack');
  const kl = held(sim, 'walkLeft');
  const kr = held(sim, 'walkRight');
  let ix = (kr ? 1 : 0) - (kl ? 1 : 0) + T.x;
  let iy = (kf ? 1 : 0) - (kb ? 1 : 0) + T.y;
  const len = Math.hypot(ix, iy);
  if (len > 1) {
    ix /= len;
    iy /= len;
  }
  const run = held(sim, 'run') || T.run;
  const speed = run ? WALK.run : WALK.walk;
  const yaw = W.yaw * D2R;
  const fx = Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const nx = W.x + (fx * iy + Math.cos(yaw) * ix) * speed * dt;
  const nz = W.z + (fz * iy + Math.sin(yaw) * ix) * speed * dt;
  const r = WALK.radius;
  W.x = Math.max(-CAB.halfW + r, Math.min(CAB.halfW - r, nx));
  W.z = Math.max(CAB.z0 + r, Math.min(CAB.z1 - r, nz));
  resolveObstacles(W, r);
}

const _camPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();
function placeCamera(sim, air) {
  const cam = sim.camera;
  if (!cam || !air) return;
  const yaw = W.yaw * D2R;
  const pitch = W.pitch * D2R;
  _camPos.set(W.x, CAB.eyeY, W.z).applyQuaternion(air.quat).add(air.pos);
  _camLook.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch))
    .applyQuaternion(air.quat).add(_camPos);
  cam.position.copy(_camPos);
  S.camStarted = true;
  cam.lookAt(_camLook);
  if (Math.abs(cam.fov - 68) > 0.05 || cam.near !== 0.05) {
    cam.fov = 68;
    cam.near = 0.05;
    cam.updateProjectionMatrix();
  }
}

function maybeFlavour(sim, missionId, story) {
  if (!S.wavedAt && nearSpot(SPOTS.window, 1.5)) {
    S.wavedAt = true;
    notify(sim, `You wave; ${LEAD} dips a wing in reply.`, 'good', 3.5);
  }
  if (!S.talkedAt && nearSpot(SPOTS.cockpitDoor, 1.8)) {
    S.talkedAt = true;
    speak(sim, "Captain: 'Right on schedule, Mr. President.'", 'approach');
  }
  if (!S.choseAt) {
    const trigger = missionId === 'afo-attack' ? story && inSecureRoom(W.x, W.z) : nearSpot(SPOTS.conference, 1.6);
    if (trigger) {
      S.choseAt = true;
      const choices = missionId === 'afo-attack'
        ? [{ key: 'eventChoice1', label: 'Divert to the nearest base' }, { key: 'eventChoice2', label: `Press on to ${field()}` }]
        : [{ key: 'eventChoice1', label: 'Ask about diverting' }, { key: 'eventChoice2', label: 'Continue as planned' }];
      showCard(sim, {
        who: 'CAPTAIN',
        text: missionId === 'afo-attack' ? 'Mr. President, your orders?' : `Happy to continue to ${field()}, Mr. President, or divert if you would rather.`,
        tone: 'warn',
        choices,
        onChoice: () => {
          speak(sim, 'Understood, Mr. President. Continuing as briefed.', 'approach');
        },
      });
    }
  }
}

registerExtension({
  id: 'afo-president',

  install(sim) {
    S.sim = sim;
    const canvas = sim.renderer && sim.renderer.domElement;
    if (canvas && canvas.addEventListener && typeof window !== 'undefined') {
      let drag = null;
      canvas.addEventListener('pointerdown', (ev) => {
        if (!S.active || ev.pointerType === 'touch') return;
        drag = { id: ev.pointerId };
      });
      window.addEventListener('pointermove', (ev) => {
        if (!S.active || !drag || ev.pointerId !== drag.id) return;
        W.yaw += (ev.movementX || 0) * 0.17;
        W.pitch -= (ev.movementY || 0) * 0.13;
        W.pitch = Math.max(-60, Math.min(42, W.pitch));
      });
      const up = (ev) => {
        if (drag && (!ev || ev.pointerId === drag.id)) drag = null;
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
  },

  startMode(sim) {
    const id = currentSeat(sim);
    if (id) setup(sim, id);
    else teardown(sim);
  },

  stop(sim) {
    teardown(sim);
  },

  update(sim, dt) {
    const id = currentSeat(sim);
    if (!id) {
      if (S.active) teardown(sim);
      return;
    }
    if (!S.active || S.missionId !== id) setup(sim, id);
    const story = storyFor(S.storyId);
    stepWalker(sim, dt);
    if (isTouch(sim)) FUI.setTouch(true, [], null);
    if (story) {
      placeCamera(sim, story.air);
      maybeFlavour(sim, id, story);
    }
  },

  camera() {
    return S.active;
  },

  keyContext() {
    return S.active ? 'foot' : null;
  },

  key(sim, code, down) {
    if (!S.active) return false;
    if (VK.some((a) => isKey(sim, a, code))) {
      KEYS[code] = down;
      return true;
    }
    return false;
  },
});

/** For afo-movie.js's missile-in-the-air beat, and for the tests. */
export function presidentInfo() {
  const story = S.active ? storyFor(S.storyId) : null;
  if (!story) return { active: false, missilesInbound: 0, dronesAlive: 0, failWhy: null, home: false };
  const out = { active: true, missionId: S.missionId, missilesInbound: 0, dronesAlive: 0, failWhy: null, home: !!story.home };
  if (typeof story.info === 'function') story.info(out);
  return out;
}

/** The walker's own local position, for the schedule's checks and the tests. */
export function walkerPos() {
  return { x: W.x, z: W.z, yaw: W.yaw };
}

/** Teleport the walker (tests only). */
export function placeWalker(x, z) {
  W.x = x;
  W.z = z;
}

/* ================================================================== *
 * The two seats (`roles:` on src/game/extra/afo.js's missions).
 * ================================================================== */

function storyInfo(storyId) {
  const s = castStory(storyId);
  const out = { home: false };
  if (s && typeof s.info === 'function') s.info(out);
  return out;
}

export const PRESIDENT_NORMAL = {
  id: 'president',
  label: 'The President',
  line: 'Ride along, on foot in the cabin: a call, a briefing, the cockpit for the approach, and your seat for landing.',
  icon: '🎗️',
  actor: 'president',
  aircraft: 'b747',
  get spawn() {
    const h = ((RUNWAY.headingDeg ?? 90) * Math.PI) / 180;
    return {
      pos: new THREE.Vector3(RUNWAY.thresholdWest.x + Math.sin(h) * 260 - Math.cos(h) * 140, RUNWAY.elev, RUNWAY.thresholdWest.z - Math.cos(h) * 260 - Math.sin(h) * 140),
      headingDeg: RUNWAY.headingDeg ?? 90,
      speed: 0,
      engineOn: false,
    };
  },
  // Measured (tests/features/afo-president.mjs): the full flight — climb,
  // out and back, approach, touchdown, roll-out — lands around 470s on its
  // own clock, before any time the President spends walking is added.
  parTime: 520,
  cast: { story: STORY_NORMAL, actors: { airliner: { type: 'b747', brain: 'captain' } } },
  steps: [
    {
      id: 'call',
      text: 'You are aboard Air Force One, in your private office at the nose. Walk over and take the call.',
      hint: 'W A S D to walk, the mouse or the arrows to look round.',
      check: () => nearSpot(SPOTS.office),
    },
    {
      id: 'brief',
      text: 'Head aft to the conference room for a short briefing.',
      hint: 'Follow the corridor back.',
      check: () => nearSpot(SPOTS.conference),
    },
    {
      id: 'cockpit',
      text: `Guardian is on your wing. Visit the cockpit for the approach into ${field()}.`,
      hint: 'Forward, through the flight-deck door.',
      check: (ctx) => {
        const s = storyInfo(STORY_NORMAL);
        return nearSpot(SPOTS.cockpitDoor, 1.8) && (s.landPhase === 'vector' || s.landPhase === 'final' || ctx.runner.stepElapsed > 70);
      },
    },
    {
      id: 'seatbelt',
      text: 'The seatbelt sign is on. Take your seat for landing.',
      hint: 'Back to your own chair, aft of the press section.',
      check: () => {
        const s = storyInfo(STORY_NORMAL);
        return nearSpot(SPOTS.seat) && (s.landPhase === 'final' || s.landPhase === 'flare' || s.onGround);
      },
    },
    {
      id: 'down',
      text: `Air Force One is down safe at ${field()}. Welcome home, Mr. President.`,
      hint: 'Almost there.',
      check: () => storyInfo(STORY_NORMAL).stopped,
    },
  ],
  score: (ctx) => {
    const base = 70;
    const time = Math.round(20 * scoreFor(ctx.elapsed, PRESIDENT_NORMAL.parTime));
    const flair = (S.wavedAt ? 5 : 0) + (S.choseAt ? 5 : 0);
    return Math.max(0, Math.min(100, base + time + flair));
  },
  onComplete(ctx) {
    ctx.sim.speak(`${LEAD}, ${field()} Approach. Air Force One is down safe. Welcome home, Mr. President.`, 'approach');
  },
};

export const PRESIDENT_ATTACK = {
  id: 'president',
  label: 'The President',
  line: 'The Secret Service moves you to the secure room while the escort clears the drones.',
  icon: '🎗️',
  actor: 'president',
  aircraft: 'b747',
  get spawn() {
    const h = ((RUNWAY.headingDeg ?? 90) * Math.PI) / 180;
    return {
      pos: new THREE.Vector3(RUNWAY.thresholdWest.x + Math.sin(h) * 260 - Math.cos(h) * 140, RUNWAY.elev, RUNWAY.thresholdWest.z - Math.cos(h) * 260 - Math.sin(h) * 140),
      headingDeg: RUNWAY.headingDeg ?? 90,
      speed: 0,
      engineOn: false,
    };
  },
  // Measured: usually stops around t ≈ 345s (the escort has both drones
  // down by ≈ 45s); 565s when it gives up on them at 150s past the wave
  // instead — the par allows for that.
  parTime: 560,
  cast: { story: STORY_ATTACK, actors: { airliner: { type: 'b747', brain: 'captain' } } },
  steps: [
    {
      id: 'cruise',
      text: 'Air Force One is over open water. All calm — for now.',
      hint: 'Explore the cabin if you like; nothing is asked of you yet.',
      check: (ctx) => ctx.elapsed > 6,
    },
    {
      id: 'secure',
      text: '"Mr. President, we have to move. Now." Get to the secure room, in the middle of the plane.',
      hint: 'Follow the corridor aft to the secure room\'s door.',
      check: () => storyInfo(STORY_ATTACK).warned && inSecureRoom(W.x, W.z),
    },
    {
      id: 'defend',
      text: 'Guardian is clearing the drones. Watch for them through the window — give your orders when you are asked.',
      hint: 'Stay inside the secure room.',
      check: (ctx) => {
        const s = storyInfo(STORY_ATTACK);
        return (s.dronesAlive === 0 && s.missilesInbound === 0) || ctx.runner.stepElapsed > 180;
      },
    },
    {
      id: 'home',
      text: `Guardian has it clear. Air Force One is heading for ${field()}.`,
      hint: 'Stay put until the seatbelt sign comes on.',
      check: () => storyInfo(STORY_ATTACK).home,
    },
    {
      id: 'land',
      text: 'The seatbelt sign is on. Take your seat for landing.',
      hint: 'Back to your own chair.',
      check: () => {
        const s = storyInfo(STORY_ATTACK);
        return nearSpot(SPOTS.seat) && (s.landPhase === 'final' || s.landPhase === 'flare' || s.onGround);
      },
    },
    {
      id: 'down',
      text: `Air Force One is down safe at ${field()}.`,
      hint: 'Almost there.',
      check: () => storyInfo(STORY_ATTACK).stopped,
    },
  ],
  failIf: () => storyInfo(STORY_ATTACK).failWhy,
  score: (ctx) => {
    const s = storyInfo(STORY_ATTACK);
    // The President never touches a flare or a gun — Guardian's own fixed
    // response time is what it is (its own first launch or two usually gets
    // through before a fighter can reach it; measured in afo-president.mjs
    // over 15 runs: 0 hits once, 1-2 hits on most runs, 3 a few times, and
    // one outlier run where the drones never both went down inside the
    // normal window). -20/hit (the captain's own weight, afo.js, where
    // flying evasively is the player's OWN skill) zeroed this out at just 2
    // hits, leaving even a flawless, fully on-schedule run short of the 80
    // item 7 asks for — a scoring bug, not a flying one. -5/hit keeps the
    // gradient (more hits still scores lower) while the common 0-2-hit
    // outcome clears 80 on its own, without needing the dialogue-choice
    // bonus this headless story can't exercise.
    const protected_ = s.stats ? Math.max(0, 30 - s.stats.hits * 5) : 20;
    const home = s.home ? 25 : 10;
    const time = Math.round(20 * scoreFor(ctx.elapsed, PRESIDENT_ATTACK.parTime));
    const flair = S.choseAt ? 10 : 0;
    return Math.max(0, Math.min(100, 15 + protected_ + home + time + flair));
  },
  onComplete(ctx) {
    ctx.sim.speak(`${LEAD}, ${field()} Approach. He is down safe. Welcome home, Mr. President.`, 'approach');
  },
};

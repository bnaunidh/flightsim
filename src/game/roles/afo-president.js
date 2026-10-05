/**
 * Air Force One, from the President's own seat.
 *
 * The owner's own line: "also one where you ARE the president" — in BOTH
 * Air Force One missions. Nobody flies anything in this seat: the jet and
 * its escort are flown by the game (src/game/roles/npc-flyer.js), and you
 * walk a small VIP cabin inside the jet, first person.
 *
 * THE CABIN is one merged, vertex-coloured mesh (the same part()/mergeParts()
 * trick src/features/staff/person.js uses for a person) with its light baked
 * into the colours, so it is one draw call, adds no lights to the scene and
 * never lights the world outside. It is a child of nothing: every frame it is
 * put exactly where the jet is (position and attitude), and the camera is put
 * inside it from the same pose, so the two can never drift apart. From the
 * nose: the flight deck (pilots, a windscreen you can see the runway through),
 * the President's office, the conference room, the secure room (mid-cabin, on
 * the right, its door off the corridor), the lounge with your own seat, and
 * the galley. Real windows down both sides — gaps in the wall, nothing drawn
 * over them — show the real sky, the island and the escort outside, because
 * the jet's own exterior model is hidden while you are inside it.
 *
 * THE WALKING is the same as the game's other on-foot mode (onfoot.js), seen
 * through your own eyes: W A S D to walk relative to where you look, Shift to
 * run, drag the mouse or use the arrows to look round, a thumb-stick and a
 * look pad on a touch screen. And, as there, a player with no mouse can steer
 * with W and A alone: walking forwards while stepping sideways eases the view
 * round towards where you are going. The furniture and the walls are solid.
 *
 * THE SCHEDULE is the mission's own steps (the two seats at the bottom of
 * this file). Each place you are asked to go has a marker on the floor and a
 * pointer on screen (events/ui.js's guide: which way, how far). The flight
 * waits for you: the jet holds over the sea, on a racetrack lined up with the
 * runway, until you go forward and tell the Captain to take you in — so there
 * is never a stretch of standing about for a timer — and then flies its own
 * approach (NpcFlyer's 'land'), with the seatbelt sign for the last few miles.
 *
 * "Under Attack" (behind the military code): the Secret Service moves you to
 * the secure room — the one thing that can fail this seat, with a countdown on
 * screen and a plain reason — you give the Captain your orders, and you watch
 * the escort clear the drones through the secure room's window; flares go,
 * a missile that gets through shakes the cabin and the jet flies on. Then the
 * cockpit, "Get us home, Captain.", your seat, the landing.
 *
 * THE REAL AEROPLANE (sim.aircraft, the b747 the seat lists) is parked out of
 * the way on the ground, engine off, hidden, held there through sim.override
 * the way onfoot.js parks one. While you ride, `sim.riding` names the jet you
 * are in, and the few things that would otherwise follow the parked one read
 * that instead: the world's sky and sea (main.js), the minimap's "you"
 * (minimap.js), mid-air collisions (sky.js — a passenger flies into nothing)
 * and the "get out" prompt (onfoot.js — there is no door of your own).
 *
 * Kid-safe throughout, like every AFO file: unmanned drones, nobody is ever
 * hurt, nothing here can fail on anything but "did you get to the secure room
 * when the Secret Service asked".
 */

import * as THREE from '../../vendor/three.module.js';
import { registerExtension } from '../extensions.js';
import { isKey, heldKey, keyName } from '../../flight/input.js';
import { RUNWAY } from '../../world/airport.js';
import { heightAt } from '../../world/terrain.js';
import {
  field, speak, notify, registerVoices, runwayFrame, RW, flat, cruiseSpeed, VOICE_FIGHTER, runwayWords,
} from '../../features/events/common.js';
import { VOICES } from '../../audio/atc.js';
import { AttackField } from '../../features/events/afo-combat.js';
import { showCard, hideCard, showGuide, hideGuide } from '../../features/events/ui.js';
import * as FUI from '../../features/staff/ui.js';
import { WALK } from '../../features/staff/walk.js';
import { part, mergeParts } from '../../features/staff/person.js';
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

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/* ------------------------------------------------------------------ *
 * Who talks in the cabin. sim.speak() looks a voice up by its label in the
 * radio's own table and falls back to the tower — so, as common.js does for
 * the fighters, each one is added once, under the name it should show.
 * ------------------------------------------------------------------ */

export const V_CAPTAIN = 'The Captain';
export const V_AGENT = 'Secret Service';
export const V_STAFF = 'Chief of Staff';
export const V_YOU = 'You';

/** The tower of the field the mission flies to, as a voice label: "Gateway Tower". */
export function towerVoice() {
  return `${field()} Tower`;
}

function registerCabinVoices() {
  registerVoices();
  try {
    if (!VOICES || typeof VOICES !== 'object') return;
    const add = (label, v) => {
      if (!VOICES[label]) VOICES[label] = { ...v, label };
    };
    add(V_CAPTAIN, { f0: 106, spread: 10, radio: 0.7, rate: 1.0, tts: { pitch: 0.85, rate: 1.0 } });
    add(V_AGENT, { f0: 116, spread: 9, radio: 0.15, rate: 1.12, tts: { pitch: 0.8, rate: 1.1 } });
    add(V_STAFF, { f0: 168, spread: 14, radio: 1.15, rate: 1.06, tts: { pitch: 1.2, rate: 1.05 } });
    add(V_YOU, { f0: 102, spread: 8, radio: 0.05, rate: 0.95, tts: { pitch: 0.8, rate: 0.95 } });
    // This field's own tower: the radio's 'tower' is always labelled Kestrel's.
    if (VOICES.tower) add(towerVoice(), { ...VOICES.tower });
  } catch (e) {
    /* a frozen table only means the tower's voice */
  }
}

/* ================================================================== *
 * The cabin. Local coordinates: +x right, +y up, +z towards the tail;
 * the nose is at the most negative z. 4.6 m wide inside, 2.15 m tall.
 * ================================================================== */

const CAB = {
  halfW: 2.3,
  z0: -22.6, // the nose bulkhead, with the windscreen in it
  z1: 20, // the tail end
  ceilY: 2.15,
  eyeY: 1.62,
  seatEyeY: 1.16,
};

/** Bulkheads across the cabin, each with a 1.1 m door in the middle. */
const BULKHEADS = [-20.5, -14.3, -8.1];
const DOOR_HALF = 0.55;

/**
 * Named places the schedule sends you to, local to the cabin — each one clear
 * floor in front of its own furniture, never inside it.
 */
export const SPOTS = {
  start: { x: -1.0, z: 1.4 },
  seat: { x: -1.55, z: 1.95 },
  office: { x: -1.3, z: -17.45 },
  conference: { x: -0.85, z: -11.3 },
  window: { x: 1.9, z: 5.85 },
  cockpit: { x: 0, z: -20.9 },
  secureDoor: { x: 0.15, z: -4.7 },
  // In front of one of the secure room's windows, so facing right you look straight out.
  secureInside: { x: 1.55, z: -4.0 },
  secureWindow: { x: 1.92, z: -4.0 },
};
/** Old name, kept for anything that still reads it. */
SPOTS.cockpitDoor = SPOTS.cockpit;

/** Your own seat (the armchair you sit in for landing), local. */
const SEAT = { x: -1.55, z: 3.05 };

/** The secure room: x 0.6..2.3, z -7.9..-1.6, its door in the corridor wall. */
const SECURE = { x0: 0.6, x1: 2.3, z0: -7.9, z1: -1.6, doorZ0: -5.35, doorZ1: -4.05, wall: 0.2 };

/** Inside the secure room's own four walls (not just near the door). */
export function inSecureRoom(x, z) {
  return x > SECURE.x0 + SECURE.wall && z > SECURE.z0 + SECURE.wall && z < SECURE.z1 - SECURE.wall;
}

/** Window centres down both sides, local z. */
const WINDOWS = [];
for (let z = -19.4; z < 18.6; z += 1.1) WINDOWS.push(+z.toFixed(2));
const WIN = { half: 0.28, y0: 1.0, y1: 1.7 };

/** Furniture and walls the walker cannot step through (local AABBs). */
const OBSTACLES = [];
function solid(x0, x1, z0, z1, tag) {
  OBSTACLES.push({ x0, x1, z0, z1, tag });
}
// Flight deck: the panel and the two pilots in their seats.
solid(-1.5, 1.5, -22.6, -22.05, 'panel');
solid(-1.15, -0.38, -22.05, -21.35, 'pilot');
solid(0.38, 1.15, -22.05, -21.35, 'pilot');
// The bulkheads, each with its door.
for (const bz of BULKHEADS) {
  solid(-CAB.halfW, -DOOR_HALF, bz - 0.12, bz, 'bulkhead');
  solid(DOOR_HALF, CAB.halfW, bz - 0.12, bz, 'bulkhead');
}
// The office: the desk (and the chair behind it) on the left, a sofa on the right.
solid(-2.1, -0.75, -19.25, -18.15, 'desk');
solid(-1.75, -1.15, -20.35, -19.25, 'desk-chair');
solid(1.62, CAB.halfW, -17.6, -15.4, 'sofa');
// The conference room: the table on the right, its chairs against the windows.
solid(0.05, CAB.halfW, -12.9, -9.7, 'table');
solid(0.45, 1.0, -9.55, -9.05, 'aide');
// The secure room's walls (the door left out of the corridor wall) and its bench.
solid(SECURE.x0, SECURE.x0 + SECURE.wall, SECURE.z0, SECURE.doorZ0, 'secure-wall');
solid(SECURE.x0, SECURE.x0 + SECURE.wall, SECURE.doorZ1, SECURE.z1, 'secure-wall');
solid(SECURE.x0, SECURE.x1, SECURE.z0, SECURE.z0 + SECURE.wall, 'secure-wall');
solid(SECURE.x0, SECURE.x1, SECURE.z1 - SECURE.wall, SECURE.z1, 'secure-wall');
solid(0.85, 2.2, -7.7, -7.15, 'bench');
solid(-2.05, -1.55, -6.45, -5.95, 'agent');
// The lounge: your own armchair on the left, two rows of staff seats on the right.
solid(-1.98, -1.12, 2.55, 3.55, 'your-seat');
solid(1.12, CAB.halfW, 0.3, 2.75, 'staff-seats');
// The galley.
solid(1.0, CAB.halfW, 13.5, 18, 'galley');

let INTERIOR = null; // built once; a flying cabin never changes shape.
let MARKER = null;

let _box = null;
function BOX() {
  if (!_box) _box = new THREE.BoxGeometry(1, 1, 1);
  return _box;
}
let _disc = null;
function DISC() {
  if (!_disc) _disc = new THREE.CylinderGeometry(1, 1, 1, 20);
  return _disc;
}

/** A box from its min/max corners. */
function box(parts, color, x0, x1, y0, y1, z0, z1) {
  parts.push(part(BOX(), color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, 0, x1 - x0, y1 - y0, z1 - z0));
}

/**
 * A plain figure, static, made of boxes: the pilots, the Secret Service, the
 * staff. `facing` is the way they look, in degrees (0 = towards the nose).
 */
function figure(parts, x, z, facing, { seated = false, suit = 0x1d2230, shirt = 0xf2f4f6, skin = 0xe8b894, hair = 0x2a1b12, cap = null } = {}) {
  const yaw = -facing * D2R;
  const cs = Math.cos(yaw);
  const sn = Math.sin(yaw);
  // Local offsets (lx right, lz towards the back of the person) rotated into the cabin.
  const at = (lx, lz) => [x + lx * cs + lz * sn, z - lx * sn + lz * cs];
  const put = (color, lx, y, lz, sx, sy, sz) => {
    const [px, pz] = at(lx, lz);
    parts.push(part(BOX(), color, px, y, pz, 0, yaw, 0, sx, sy, sz));
  };
  const hip = seated ? 0.5 : 0.92;
  if (seated) {
    put(suit, -0.1, 0.5, -0.22, 0.15, 0.15, 0.48); // thighs, forward
    put(suit, 0.1, 0.5, -0.22, 0.15, 0.15, 0.48);
    put(suit, -0.1, 0.25, -0.44, 0.13, 0.45, 0.14); // shins
    put(suit, 0.1, 0.25, -0.44, 0.13, 0.45, 0.14);
  } else {
    put(suit, -0.1, 0.46, 0, 0.15, 0.92, 0.17);
    put(suit, 0.1, 0.46, 0, 0.15, 0.92, 0.17);
  }
  put(suit, 0, hip + 0.3, 0.02, 0.44, 0.62, 0.25); // jacket
  put(shirt, 0, hip + 0.52, -0.1, 0.16, 0.2, 0.04); // shirt front
  put(suit, -0.27, hip + 0.3, 0.02, 0.11, 0.58, 0.13); // arms
  put(suit, 0.27, hip + 0.3, 0.02, 0.11, 0.58, 0.13);
  put(skin, 0, hip + 0.75, 0, 0.19, 0.23, 0.21); // head
  put(cap ?? hair, 0, hip + 0.89, 0.02, 0.2, 0.07, 0.22);
}

/** Bake a simple light into the vertex colours: tops bright, undersides dim, the two kinds of side apart. */
function bakeLight(geo) {
  const n = geo.attributes.normal.array;
  const c = geo.attributes.color.array;
  for (let i = 0; i < c.length; i += 3) {
    const nx = n[i];
    const ny = n[i + 1];
    const nz = n[i + 2];
    const k = ny > 0.5 ? 1.0 : ny < -0.5 ? 0.66 : Math.abs(nx) > Math.abs(nz) ? 0.84 : 0.9;
    c[i] *= k;
    c[i + 1] *= k;
    c[i + 2] *= k;
  }
  geo.attributes.color.needsUpdate = true;
}

/** Build the whole interior as one merged, vertex-coloured mesh. */
function buildInterior() {
  const parts = [];
  const CARPET = 0x2c3a5c;
  const RUNNER = 0x3b4a70;
  const WALL = 0xe6dfcf;
  const WALL_LO = 0xcfc5b0;
  const CEIL = 0xe9e5db;
  const LIGHT = 0xfffaf0;
  const WOOD = 0x5b3a22;
  const LEATHER = 0xa98458;
  const SEAT_C = 0x2a3f6c;
  const SECURE_C = 0x6d7886;
  const PANEL = 0x1a1f27;
  const t = 0.12;
  const w = CAB.halfW;
  const { z0, z1, ceilY } = CAB;

  // Floor (carpet and a runner down the middle) and ceiling, with two light strips.
  box(parts, CARPET, -w, w, -0.1, 0, z0, z1);
  box(parts, RUNNER, -0.7, 0.7, 0, 0.005, z0 + 2.2, z1 - 0.5);
  box(parts, CEIL, -w, w, ceilY, ceilY + 0.1, z0, z1);
  for (const s of [-1, 1]) box(parts, LIGHT, s * 1.25 - 0.05, s * 1.25 + 0.05, ceilY - 0.015, ceilY, z0 + 0.4, z1 - 0.4);

  // Side walls: the panel under the windows and the one over them run the
  // whole length; between the windows, a pillar. The gaps ARE the windows.
  for (const side of [-1, 1]) {
    const xa = side * w - (side > 0 ? t : 0);
    const xb = xa + t;
    box(parts, WALL_LO, xa, xb, 0, WIN.y0, z0, z1);
    box(parts, WALL, xa, xb, WIN.y1, ceilY, z0, z1);
    let zPrev = z0;
    for (const zc of WINDOWS) {
      box(parts, WALL, xa, xb, WIN.y0, WIN.y1, zPrev, zc - WIN.half);
      zPrev = zc + WIN.half;
    }
    box(parts, WALL, xa, xb, WIN.y0, WIN.y1, zPrev, z1);
    // A sill and a frame under each window, so it reads as a window.
    for (const zc of WINDOWS) box(parts, WALL_LO, xa - side * 0.04, xb - side * 0.04, WIN.y0 - 0.04, WIN.y0, zc - WIN.half - 0.04, zc + WIN.half + 0.04);
  }

  // The nose: a panel, the glareshield and the windscreen (two panes, a post).
  box(parts, WALL, -w, w, 0, 1.05, z0 - t, z0);
  box(parts, WALL, -w, w, 1.72, ceilY, z0 - t, z0);
  box(parts, WALL, -w, -1.45, 1.05, 1.72, z0 - t, z0);
  box(parts, WALL, 1.45, w, 1.05, 1.72, z0 - t, z0);
  box(parts, PANEL, -0.07, 0.07, 1.05, 1.72, z0 - t, z0);
  box(parts, PANEL, -1.5, 1.5, 0, 0.98, z0, -22.05); // the instrument panel
  box(parts, 0x26364f, -1.3, 1.3, 0.62, 0.92, -22.06, -22.04); // its screens
  box(parts, PANEL, -1.5, 1.5, 0.98, 1.04, z0, -21.9); // glareshield
  // The two pilots, seated, their backs to you.
  for (const s of [-1, 1]) {
    box(parts, 0x3a3f48, s * 0.77 - 0.36, s * 0.77 + 0.36, 0, 0.5, -22.0, -21.4); // seat
    box(parts, 0x3a3f48, s * 0.77 - 0.34, s * 0.77 + 0.34, 0.5, 1.2, -21.5, -21.36); // seat back
    figure(parts, s * 0.77, -21.75, 0, { seated: true, suit: 0xf2f4f6, shirt: 0xf2f4f6, cap: 0x1f2a3a, skin: s < 0 ? 0xd09a6e : 0xf6d3b8 });
    for (const e of [-0.17, 0.17]) box(parts, 0xe0b53a, s * 0.77 + e - 0.05, s * 0.77 + e + 0.05, 1.1, 1.13, -21.8, -21.68); // epaulettes
  }

  // The bulkheads, each with a door; a lintel over the door.
  for (const bz of BULKHEADS) {
    box(parts, WALL, -w, -DOOR_HALF, 0, ceilY, bz - t, bz);
    box(parts, WALL, DOOR_HALF, w, 0, ceilY, bz - t, bz);
    box(parts, WALL, -DOOR_HALF, DOOR_HALF, 2.0, ceilY, bz - t, bz);
    box(parts, WOOD, -DOOR_HALF - 0.05, -DOOR_HALF, 0, 2.02, bz - t - 0.01, bz + 0.01); // door frame
    box(parts, WOOD, DOOR_HALF, DOOR_HALF + 0.05, 0, 2.02, bz - t - 0.01, bz + 0.01);
  }

  // The office: a big desk with a phone on it, the chair behind it, a sofa,
  // and the seal on the wall by the flight-deck door.
  box(parts, WOOD, -2.1, -0.75, 0, 0.74, -19.25, -18.15);
  box(parts, 0x6e4a2e, -2.12, -0.73, 0.74, 0.78, -19.27, -18.13);
  box(parts, 0x15181d, -1.0, -0.85, 0.78, 0.86, -18.6, -18.4); // the phone
  box(parts, LEATHER, -1.75, -1.15, 0, 0.5, -20.3, -19.45);
  box(parts, LEATHER, -1.75, -1.15, 0.5, 1.25, -20.35, -20.15);
  box(parts, LEATHER, 1.62, w, 0, 0.45, -17.6, -15.4);
  box(parts, LEATHER, 2.0, w - t, 0.45, 0.9, -17.6, -15.4);
  parts.push(part(DISC(), 0x1d2f6a, -1.4, 1.35, -20.37, Math.PI / 2, 0, 0, 0.36, 0.02, 0.36));
  parts.push(part(DISC(), 0xd9b44a, -1.4, 1.35, -20.36, Math.PI / 2, 0, 0, 0.26, 0.02, 0.26));
  parts.push(part(DISC(), 0x1d2f6a, -1.4, 1.35, -20.35, Math.PI / 2, 0, 0, 0.2, 0.02, 0.2));

  // The conference room: the table, chairs on the window side, a screen on
  // the forward wall and an aide waiting at the far end.
  box(parts, WOOD, 0.05, 1.45, 0, 0.72, -12.9, -9.7);
  box(parts, 0x6e4a2e, 0.03, 1.47, 0.72, 0.76, -12.92, -9.68);
  for (const z of [-12.3, -11.3, -10.3]) {
    box(parts, LEATHER, 1.6, 2.1, 0, 0.48, z - 0.25, z + 0.25);
    box(parts, LEATHER, 2.02, 2.12, 0.48, 1.05, z - 0.25, z + 0.25);
  }
  box(parts, PANEL, 0.4, 1.8, 0.95, 1.75, -14.2, -14.17);
  box(parts, 0x2f5f8f, 0.47, 1.73, 1.0, 1.7, -14.17, -14.16);
  figure(parts, 0.72, -9.3, 0, { suit: 0x4a5160, hair: 0x7a4a24, skin: 0xf6d3b8 });

  // The secure room: its walls (door to the corridor), a bench, and the
  // Secret Service agent outside it.
  const sx0 = SECURE.x0;
  const sw = SECURE.wall;
  box(parts, SECURE_C, sx0, sx0 + sw, 0, ceilY, SECURE.z0, SECURE.doorZ0);
  box(parts, SECURE_C, sx0, sx0 + sw, 0, ceilY, SECURE.doorZ1, SECURE.z1);
  box(parts, SECURE_C, sx0, sx0 + sw, 2.0, ceilY, SECURE.doorZ0, SECURE.doorZ1);
  box(parts, SECURE_C, sx0, SECURE.x1 - t, 0, ceilY, SECURE.z0, SECURE.z0 + sw);
  box(parts, SECURE_C, sx0, SECURE.x1 - t, 0, ceilY, SECURE.z1 - sw, SECURE.z1);
  box(parts, 0xc23b3b, sx0 - 0.01, sx0 + sw + 0.01, 2.0, 2.06, SECURE.doorZ0, SECURE.doorZ1); // a red band over its door
  box(parts, SEAT_C, 0.85, 2.18, 0, 0.45, -7.7, -7.15);
  box(parts, SEAT_C, 0.85, 2.18, 0.45, 1.0, -7.7, -7.55);
  figure(parts, -1.8, -6.2, 90, { suit: 0x16181d });

  // The lounge: your armchair on the left, two rows of staff seats on the right
  // with two of the staff in them.
  box(parts, LEATHER, -1.98, -1.12, 0, 0.5, 2.55, 3.4);
  box(parts, LEATHER, -1.98, -1.12, 0.5, 1.25, 3.3, 3.55);
  box(parts, LEATHER, -2.0, -1.9, 0.5, 0.75, 2.55, 3.4);
  box(parts, LEATHER, -1.2, -1.1, 0.5, 0.75, 2.55, 3.4);
  for (const z of [0.6, 2.05]) {
    for (const x of [1.4, 1.95]) {
      box(parts, SEAT_C, x - 0.26, x + 0.26, 0, 0.46, z - 0.25, z + 0.3);
      box(parts, SEAT_C, x - 0.26, x + 0.26, 0.46, 1.12, z + 0.3, z + 0.42);
    }
  }
  figure(parts, 1.4, 0.65, 0, { seated: true, suit: 0x3b4252, hair: 0x151515, skin: 0x8a5a36 });
  figure(parts, 1.95, 2.1, 0, { seated: true, suit: 0x5a3b4a, hair: 0xc89a4a });

  // The galley.
  box(parts, 0xd8d8d2, 1.0, w - t, 0, 0.95, 13.5, 18);
  box(parts, 0xa9aeb5, 1.0, w - t, 0.95, 0.99, 13.5, 18);
  box(parts, 0xd8d8d2, 1.7, w - t, 1.3, 2.1, 13.5, 18);

  // The tail bulkhead.
  box(parts, WALL, -w, w, 0, ceilY, z1, z1 + t);

  const geo = mergeParts(parts);
  bakeLight(geo);
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = false; // the camera is always inside it
  mesh.name = 'afo-president-interior';
  const group = new THREE.Group();
  group.name = 'afo-president-cabin';
  group.add(mesh);
  group.add(buildMarker());
  return group;
}

/** The marker on the floor where you are asked to go: a ring and a diamond over it. */
function buildMarker() {
  const g = new THREE.Group();
  g.name = 'afo-president-marker';
  const mat = new THREE.MeshBasicMaterial({ color: 0xffc247, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 32), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  g.add(ring);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11, 0), mat);
  gem.scale.y = 1.6;
  gem.position.y = 1.25;
  g.add(gem);
  g.userData.gem = gem;
  g.visible = false;
  MARKER = g;
  return g;
}

function ensureInterior(scene) {
  if (!INTERIOR) INTERIOR = buildInterior();
  if (INTERIOR.parent !== scene) scene.add(INTERIOR);
  INTERIOR.visible = true;
  return INTERIOR;
}

/* ================================================================== *
 * The flights. The President never touches a control: the jet holds on a
 * racetrack over the sea, lined up with the runway, until you send it in
 * (goHome()), and then flies its own approach. Shared by both stories.
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

/** Metres along the runway from its landing threshold (negative short of it) and across it (+ to the right). */
function runwayRel(p, out) {
  runwayFrame();
  const tx = RW.c.x - RW.f.x * (RW.L / 2);
  const tz = RW.c.z - RW.f.z * (RW.L / 2);
  out.along = (p.x - tx) * RW.f.x + (p.z - tz) * RW.f.z;
  out.cross = (p.x - tx) * RW.r.x + (p.z - tz) * RW.r.z;
  return out;
}

/** A point on the runway's extended centre line, `along` metres from its threshold. */
function onCentreLine(along, cross, y) {
  runwayFrame();
  const tx = RW.c.x - RW.f.x * (RW.L / 2);
  const tz = RW.c.z - RW.f.z * (RW.L / 2);
  return new THREE.Vector3(tx + RW.f.x * along + RW.r.x * cross, y, tz + RW.f.z * along + RW.r.z * cross);
}

/*
 * The flight in: one straight run along the runway's extended centre line,
 * from 12 km out, on the three-degree slope (held level at 480 m above the
 * field further out, where the slope is higher than that). Sent home
 * anywhere on it — "Take us in, Captain." — NpcFlyer's own approach finds it
 * already stable and goes straight to final: never a loop round to an entry
 * point. Nobody to send it home by 5.5 km out, the Captain starts the
 * approach himself, so a slow walk never leaves the jet circling.
 *
 * Measured (tests/features/afo-president.mjs, the playthrough bot): sent
 * home at 15-90 s, it touches down at ~175 s, the seatbelt sign ~45 s before
 * that (enough to walk back from the flight deck and sit), and the mission
 * ends 10 s into the roll-out: about 3 minutes, start to finish.
 */
const INBOUND = { startAlong: -12000, autoHomeAlong: -5500, levelAbove: 480 };
const TAN3 = Math.tan(3 * D2R);

/** The height to fly at `along` metres from the threshold: on the slope, never above `levelAbove`. */
function slopeAltitude(along) {
  const onSlope = Math.max(0, -along - 200) * TAN3 + 30;
  return (RUNWAY.elev || 0) + Math.min(INBOUND.levelAbove, Math.max(250, onSlope));
}

function flyInbound(st) {
  const air = st.air;
  const rel = runwayRel(air.pos, st._rel);
  const H = RUNWAY.headingDeg ?? 90;
  // A localiser in miniature: back onto the centre line, gently.
  air.direct(H - clamp(rel.cross * 0.03, -30, 30), slopeAltitude(rel.along), cruiseSpeed('b747'));
  return rel;
}

function startFlight(sim, name, alongStart, alt) {
  const air = new NpcFlyer(sim.scene, 'b747', { name, livery: AFO_SCHEME() });
  air.model.visible = false; // you are inside it; see this file's header.
  const H = RUNWAY.headingDeg ?? 90;
  air.place({ pos: onCentreLine(alongStart, 0, alt), headingDeg: H, speed: cruiseSpeed('b747'), gearDown: false });
  air.direct(H, alt, cruiseSpeed('b747'));
  return air;
}

/** Guardian's station on the wing (where the right-hand windows look), and out on the right to fight. */
const WING = Object.freeze({ back: 25, right: 75, down: 0, lookahead: 320 });
const ENGAGE = Object.freeze({ back: -120, right: 360, down: 15, lookahead: 320 });

function buildEscort(sim, air) {
  let escort = null;
  try {
    escort = new NpcFlyer(sim.scene, 'vanguard', { name: 'afo-president-escort' });
  } catch (e) {
    console.warn('[afo-president] the escort could not be built; the flight carries on without one.', e);
    return null;
  }
  // Off the right wing, a little behind and level with the cabin: where the
  // right-hand windows look. Placed ON its station, not on the jet — it used
  // to start inside the cabin and fly out through the wall.
  const station = { ...WING };
  const h = air.heading * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const pos = new THREE.Vector3(air.pos.x - fx * station.back - fz * station.right, air.pos.y - station.down, air.pos.z - fz * station.back + fx * station.right);
  escort.place({ pos, headingDeg: air.heading, speed: Math.max(60, air.speed), onGround: false });
  escort.follow(air, station);
  return escort;
}

/** The common half of both stories: the hold, the approach, the escort, the seatbelt sign. */
function flightBase(sim, id, air, escort) {
  const st = {
    id,
    air,
    escort,
    actors: { airliner: air, escort },
    t: 0,
    autoHome: false,
    _rel: { along: 0, cross: 0 },
    homeAt: null,
    seatbelt: false,
    peeled: false,
    onGroundSince: null,
  };
  st.goHome = (simArg) => {
    if (st.homeAt != null) return false;
    st.homeAt = st.t;
    air.rw = homeRunway();
    air.vecAlt = air.pos.y;
    air.land(air.rw);
    return true;
  };
  air.onEvent = (what) => {
    if (what === 'goaround') {
      speak(sim, 'Going around — we will come round again, Mr. President.', V_CAPTAIN);
    }
  };
  st.flyCommon = (simArg, dt) => {
    st.t += dt;
    if (st.homeAt == null) {
      const rel = flyInbound(st);
      if (rel.along > INBOUND.autoHomeAlong && st.goHome(simArg)) {
        st.autoHome = true;
        speak(simArg, `Mr. President, we are starting our approach into ${field()}. The flight deck is open if you would like to watch.`, V_CAPTAIN);
      }
    }
    air.update(dt, simArg.weather);
    if (escort) {
      runwayFrame();
      const closeIn = air.onGround || (air.mode === 'land' && air.landPhase === 'final' && flat(air.pos, RW.c) < 6500);
      if (closeIn && escort.mode !== 'land') {
        escort.rw = homeRunway();
        escort.vecAlt = escort.pos.y;
        escort.land(escort.rw);
        if (!st.peeled) {
          st.peeled = true;
          speak(simArg, `Air Force One, ${LEAD}. Breaking off — see you on the ground.`, VOICE_FIGHTER);
        }
      }
      escort.update(dt, simArg.weather);
    }
    // The approach, called the way a crew calls it — so the minutes on final
    // from the flight deck are not silent ones.
    if (air.mode === 'land' && !air.onGround) {
      const rel = runwayRel(air.pos, st._rel);
      const calls = st.calls || (st.calls = {});
      if (air.landPhase === 'final' && !calls.final) {
        calls.final = true;
        speak(simArg, 'Established on final. Gear down.', V_CAPTAIN);
      }
      if (air.landPhase === 'final' && rel.along > -9500 && rel.along < -7500 && !calls.field && escort && !st.peeled) {
        calls.field = true;
        speak(simArg, `Air Force One, ${LEAD}. ${field()} in sight, twelve o'clock. We'll see you in.`, VOICE_FIGHTER);
      }
      if (air.landPhase === 'final' && rel.along > -7000 && !calls.cleared) {
        calls.cleared = true;
        speak(simArg, `Air Force One, ${field()} Tower. Wind calm, runway ${runwayWords()}, cleared to land.`, towerVoice());
      }
      if (air.landPhase === 'final' && rel.along > -5200 && !calls.flaps) {
        calls.flaps = true;
        speak(simArg, 'Flaps thirty. Landing checklist complete.', V_CAPTAIN);
      }
    }
    // The seatbelt sign: on final, the last few miles (or already down).
    if (!st.seatbelt && air.mode === 'land') {
      const rel = runwayRel(air.pos, st._rel);
      if (air.onGround || ((air.landPhase === 'final' || air.landPhase === 'flare') && rel.along > -3200)) {
        st.seatbelt = true;
      }
    }
    if (air.onGround) {
      if (st.onGroundSince == null) st.onGroundSince = st.t;
    }
    runwayFrame();
    st.home = flat(air.pos, RW.c) < 1500;
  };
  st.infoCommon = (out) => {
    out.home = st.home;
    out.landPhase = air.landPhase;
    out.landing = air.mode === 'land';
    out.onGround = air.onGround;
    out.stopped = air.stopped;
    out.seatbelt = st.seatbelt;
    out.homeOrdered = st.homeAt != null;
    out.autoHome = st.autoHome;
    const rel = runwayRel(air.pos, st._rel);
    out.along = rel.along;
    out.cross = rel.cross;
    out.alt = air.pos.y;
  };
  st.dispose = () => {
    air.model.visible = true;
    air.dispose();
    if (escort) escort.dispose();
  };
  return st;
}

export const STORY_NORMAL = 'afo-president-normal';
export const STORY_ATTACK = 'afo-president-attack';

function createPresidentNormal(sim) {
  registerCabinVoices();
  const air = startFlight(sim, 'afo-president-air', INBOUND.startAlong, slopeAltitude(INBOUND.startAlong));
  const escort = buildEscort(sim, air);
  const st = flightBase(sim, STORY_NORMAL, air, escort);
  st.update = (simArg, dt) => st.flyCommon(simArg, dt);
  st.info = (out) => st.infoCommon(out);
  return st;
}
registerStory(STORY_NORMAL, createPresidentNormal);

/*
 * Two drones, up out of the sea off the RIGHT side, a little ahead: where the
 * secure room's windows look (and Guardian flies). Drones are slower than the
 * jet, so they drift aft as they close — across those windows, not out of a
 * nose nobody in the cabin can see out of (the other seats' head-on wave).
 */
function droneWaveRight(air) {
  const h = air.heading * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const rx = Math.cos(h);
  const rz = Math.sin(h);
  const out = [];
  for (const [ahead, side] of [[900, 1900], [350, 1350]]) {
    out.push(new THREE.Vector3(air.pos.x + fx * ahead + rx * side, Math.max(20, air.pos.y - 140), air.pos.z + fz * ahead + rz * side));
  }
  return out;
}

/*
 * Where Guardian flies while it fights: towards the nearest drone, stopping
 * ~250 m short of it (its gun reaches ~400 m), but never on the jet's left —
 * it would have to cross the jet to get there — and never closer to the jet
 * than 150 m. A drone round on the left comes back to the right on its own
 * orbit; Guardian waits for it out there, abreast of it on the right.
 */
function steerEngage(st, air, escort) {
  let best = null;
  let bd = Infinity;
  for (const d of st.attack.drones) {
    if (!d.alive) continue;
    const dd = d.pos.distanceToSquared(escort.pos);
    if (dd < bd) {
      bd = dd;
      best = d;
    }
  }
  const E = st.engage;
  if (!best) return;
  const h = air.heading * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const dx = best.pos.x - air.pos.x;
  const dz = best.pos.z - air.pos.z;
  let ahead = dx * fx + dz * fz;
  let right = dx * -fz + dz * fx;
  const dist = Math.hypot(ahead, right) || 1;
  const k = Math.max(0, (dist - 250) / dist);
  ahead *= k;
  right *= k;
  // On the right of the jet always: alongside a drone that is behind it or
  // round on its left, 150 m out, rather than across it.
  if (right < 150) right = 150;
  E.back = clamp(-ahead, -700, 400);
  E.right = clamp(right, 150, 700);
  E.down = 15;
}

const WARN_AT = 8;
const WAVE_AT = 11;
/** Seconds the Secret Service gives you from the warning to the secure room. */
export const SECURE_LIMIT = 40;

function createPresidentAttack(sim) {
  registerCabinVoices();
  const air = startFlight(sim, 'afo-president-air-attack', INBOUND.startAlong, slopeAltitude(INBOUND.startAlong));
  const escort = buildEscort(sim, air);
  const attack = new AttackField(sim);
  const st = flightBase(sim, STORY_ATTACK, air, escort);
  Object.assign(st, {
    engage: { ...ENGAGE },
    attack, warned: false, waveSent: false, failWhy: null, inSecure: false, secureAt: null,
    clearAt: null, escortGunCd: 0, flareCd: 2, flaresUsed: 0, hitShake: 0, hitsSeen: 0, toldBack: 0,
  });
  st.update = (simArg, dt) => {
    st.flyCommon(simArg, dt);
    if (!st.warned && st.t > WARN_AT) {
      st.warned = true;
      speak(simArg, 'Mr. President, we have to move. Now.', V_AGENT, 1);
      speak(simArg, 'Unidentified drones, closing from the right. Guardian is engaging.', V_CAPTAIN, 1);
    }
    if (!st.waveSent && st.t > WAVE_AT) {
      st.waveSent = true;
      // Quick enough to keep up with the jet (the other seats' 55 m/s drones
      // only ever meet it head-on) — so they stay out there, off the right
      // side, in the windows.
      attack.spawnWave(droneWaveRight(air), { speed: 84 });
      // Guardian moves out to the right to meet them: between the jet and
      // the drones, inside its gun's ~400 m, still in your windows.
      if (escort) {
        escort.follow(air, st.engage);
        speak(simArg, `${LEAD}, engaging. Moving out to your right.`, VOICE_FIGHTER);
      }
    }
    if (st.waveSent && st.clearAt == null && escort) steerEngage(st, air, escort);
    if (st.waveSent) {
      const res = attack.update(dt, air.pos, air.vel);
      if (res && res.hit) {
        st.hitShake = 1.2;
        st.hitsSeen++;
        if (st.hitsSeen === 1) speak(simArg, "We're hit — number four engine. She's still flying, Mr. President.", V_CAPTAIN, 1);
        else if (st.hitsSeen === 2) speak(simArg, 'Another one — we are fine. Hold on.', V_CAPTAIN, 1);
      }
      // Guardian's kills (AttackField.guardKills): a drone it has held in its
      // sights for a few seconds is down, and the fight has an end — anything
      // still up 40 s into it is Guardian's too. The President can only watch.
      if (st.clearAt == null && escort) attack.guardKills(escort.pos, dt, { capAt: 40 });
      // The escort's own gun: a missile about to reach the jet first, then
      // the drones themselves, then any other missile — led for the shot's
      // flight. (AttackField.aimFrom()'s "any missile first" never got round
      // to the drones here: off the side, they keep one in the air at all
      // times, and the wave never ended.)
      if (escort) {
        st.escortGunCd -= dt;
        if (st.escortGunCd <= 0) {
          const dir = attack.aimGuard(escort.pos, escort.vel, air.pos, AIM);
          if (dir) attack.fireGun(escort.pos.clone().addScaledVector(dir, 6), dir, escort.vel);
          st.escortGunCd = 0.3;
        }
      }
      // The Captain's flares, whenever a missile is coming that is not
      // already chasing one (the President's own jet carries a full load:
      // the flares going is the thing to watch from the cabin).
      if (st.flaresUsed < 8) {
        st.flareCd -= dt;
        if (st.flareCd <= 0) {
          const danger = attack.missiles.some((m) => m.alive && !m.flare && m.t > 0.5 && m.pos.distanceTo(air.pos) < 2500);
          if (danger) {
            attack.deployDecoy(air.pos, air.vel);
            st.flaresUsed++;
            st.flareCd = 2;
            speak(simArg, st.flaresUsed === 1 ? 'Missile launch! Flares — now!' : 'Flares!', V_CAPTAIN, 1);
          }
        }
      }
      const clear = attack.dronesAlive === 0 && attack.missilesInbound === 0;
      if (clear && st.clearAt == null) {
        st.clearAt = st.t;
        if (escort) escort.follow(air, WING);
        speak(simArg, `Air Force One, ${LEAD}. Splash two — your sky is clear. Back on your wing.`, VOICE_FIGHTER);
      }
    }
    st.hitShake = Math.max(0, st.hitShake - dt);
    // The Secret Service's patience: from the warning, SECURE_LIMIT seconds to
    // reach the secure room — never a wreck, never anybody hurt.
    if (!st.inSecure && inSecureRoom(W.x, W.z)) {
      st.inSecure = true;
      st.secureAt = st.t;
    }
    if (st.warned && !st.inSecure && st.t - WARN_AT > SECURE_LIMIT && !st.failWhy) {
      st.failWhy = 'The Secret Service could not get you to the secure room in time. When they say move, follow the marker to the secure room.';
    }
  };
  st.info = (out) => {
    st.infoCommon(out);
    out.dronesAlive = attack.dronesAlive;
    out.missilesInbound = attack.missilesInbound;
    // Live object, not a copy — see afo.js afoInfo() for why.
    out.stats = attack.stats;
    out.failWhy = st.failWhy;
    out.warned = st.warned;
    out.clear = st.clearAt != null;
    out.secureLeft = st.warned && !st.inSecure ? Math.max(0, SECURE_LIMIT - (st.t - WARN_AT)) : null;
    out.secureTime = st.secureAt != null ? Math.max(0, st.secureAt - WARN_AT) : null;
  };
  const baseDispose = st.dispose;
  st.dispose = () => {
    baseDispose();
    attack.dispose();
  };
  return st;
}
registerStory(STORY_ATTACK, createPresidentAttack);

function storyFor(seatStoryId) {
  return castStory(seatStoryId);
}

/* ================================================================== *
 * The walker: local to the cabin, flat floor, first person.
 * ================================================================== */

const W = { x: SPOTS.start.x, z: SPOTS.start.z, yaw: 0, pitch: -4, vx: 0, vz: 0, seated: false, sitK: 0, lookIdle: 9 };
const KEYS = Object.create(null);
const VK = ['walkForward', 'walkBack', 'walkLeft', 'walkRight', 'run', 'wave', 'footLookLeft', 'footLookRight', 'footLookUp', 'footLookDown'];

function resolveObstacles(p, radius) {
  for (let pass = 0; pass < 2; pass++) {
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
    p.x = clamp(p.x, -CAB.halfW + radius, CAB.halfW - radius);
    p.z = clamp(p.z, CAB.z0 + radius, CAB.z1 - radius);
  }
}

function nearSpot(spot, radius = 1.0) {
  return Math.hypot(W.x - spot.x, W.z - spot.z) < radius;
}

/* ================================================================== *
 * The extension: walking, the camera, the marker and the moments.
 * ================================================================== */

const S = {
  sim: null,
  active: false,
  missionId: null,
  storyId: null,
  stepId: null,
  stepT: 0,
  waved: false,
  choice: null, // the briefing's / the orders' answer: 0 or 1
  asked: false,
  cockpitDone: false,
  missed: new Set(),
  seatedBeforeTouchdown: false,
  touchHidden: false,
  drag: null,
  shakeT: 0,
  fov: 70,
  camDt: 0,
  agentNag: 0,
  waveHintT: 0,
};

const NO_BUTTONS = [];
const WAVE_BUTTONS = [{ id: 'wave', label: 'Wave' }];

function isTouch(sim) {
  return !!(sim && sim.touch);
}

function resetRun() {
  S.stepId = null;
  S.stepT = 0;
  S.waved = false;
  S.choice = null;
  S.asked = false;
  S.cockpitDone = false;
  S.missed.clear();
  S.seatedBeforeTouchdown = false;
  S.shakeT = 0;
  S.agentNag = 0;
  S.waveHintT = 0;
  S.seatNagT = 0;
  S.fov = 70;
  W.x = SPOTS.start.x;
  W.z = SPOTS.start.z;
  W.yaw = 0;
  W.pitch = -4;
  W.vx = 0;
  W.vz = 0;
  W.seated = false;
  W.sitK = 0;
  W.lookIdle = 9;
}

function teardown(sim) {
  if (!S.active) return;
  S.active = false;
  if (INTERIOR) INTERIOR.visible = false;
  if (MARKER) MARKER.visible = false;
  if (sim) {
    sim.override = S.prevOverride ?? null;
    if (sim.model) sim.model.visible = true;
    if (sim.riding) sim.riding = null;
    if (sim.touch && sim.touch.setVisible && S.touchHidden) sim.touch.setVisible(true);
    FUI.setHudWalking(sim.hud, false);
    FUI.setHudRiding(sim.hud, false);
  }
  S.touchHidden = false;
  S.drag = null;
  FUI.setTouch(false);
  hideGuide();
  freePanel();
  if (S.asked) hideCard();
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
  resetRun();
  registerCabinVoices();
  ensureInterior(sim.scene);
  S.prevOverride = sim.override;
  sim.override = PARK;
  if (sim.model) sim.model.visible = false;
  FUI.setHudWalking(sim.hud, true);
  // Pilot-only HUD the owner called out by name: "Wind on the nose" and the
  // smoke-trail chip (fun.js reads sim.riding itself) have no pilot behind
  // them in this seat; the FLARE/FIRE button is already gated on the
  // captain's and escort's own seats (afo.js's currentSeat()).
  FUI.setHudRiding(sim.hud, true);
  /*
   * The real aeroplane is parked (it has to be, to stay put while you are not
   * flying it) — exactly what onfoot.js's own "get out" looks for. While
   * sim.riding is set it offers no door at all; this rule answers the key.
   */
  onFoot.setExitRule({
    decide: () => ({ why: 'You are a passenger on Air Force One — the crew will open the door when you are down.' }),
  });
  if (isTouch(sim) && sim.touch && sim.touch.setVisible) {
    sim.touch.setVisible(false);
    S.touchHidden = true;
  }
}

/** The President's seat of an AFO mission, while it is running or just decided. */
function currentSeat(sim) {
  const r = sim && sim.runner;
  const def = r && (r.status === 'running' || r.status === 'complete' || r.status === 'failed') ? r.def : null;
  const id = def && (def.baseId || def.id);
  if (!def || def.roleId !== 'president' || (id !== 'afo-normal' && id !== 'afo-attack')) return null;
  return id;
}

const _look = { x: 0, y: 0 };
function stepWalker(sim, dt) {
  // Look: the arrows, the mouse (dragged, in the pointer handlers) and the touch pad.
  let looked = false;
  const turn = (heldKey(sim, 'footLookRight', KEYS) ? 1 : 0) - (heldKey(sim, 'footLookLeft', KEYS) ? 1 : 0);
  const tilt = (heldKey(sim, 'footLookUp', KEYS) ? 1 : 0) - (heldKey(sim, 'footLookDown', KEYS) ? 1 : 0);
  if (turn) {
    W.yaw += turn * 110 * dt;
    looked = true;
  }
  if (tilt) {
    W.pitch += tilt * 60 * dt;
    looked = true;
  }
  FUI.takeLook(_look);
  if (_look.x || _look.y) {
    W.yaw += _look.x * 0.3;
    W.pitch -= _look.y * 0.22;
    looked = true;
  }
  if (S.drag && (S.drag.dx || S.drag.dy)) {
    W.yaw += S.drag.dx * 0.25;
    W.pitch -= S.drag.dy * 0.2;
    S.drag.dx = 0;
    S.drag.dy = 0;
    looked = true;
  }
  W.pitch = clamp(W.pitch, -60, 40);
  W.lookIdle = looked ? 0 : W.lookIdle + dt;

  const T = FUI.touch;
  const kf = heldKey(sim, 'walkForward', KEYS);
  const kb = heldKey(sim, 'walkBack', KEYS);
  const kl = heldKey(sim, 'walkLeft', KEYS);
  const kr = heldKey(sim, 'walkRight', KEYS);
  let ix = (kr ? 1 : 0) - (kl ? 1 : 0) + T.x;
  let iy = (kf ? 1 : 0) - (kb ? 1 : 0) + T.y;

  // Seated for landing: the belt is on. Look round, but stay put.
  if (W.seated) {
    W.sitK = Math.min(1, W.sitK + dt * 1.6);
    W.vx = 0;
    W.vz = 0;
    if ((Math.abs(ix) > 0.3 || Math.abs(iy) > 0.3) && S.seatNagT <= 0) {
      notify(sim, 'Seatbelt sign is on — stay in your seat until we stop.', 'info', 3);
      S.seatNagT = 6;
    }
    S.seatNagT = (S.seatNagT || 0) - dt;
    return;
  }
  W.sitK = Math.max(0, W.sitK - dt * 2);

  const len = Math.hypot(ix, iy);
  if (len > 1) {
    ix /= len;
    iy /= len;
  }
  // Keyboard: walk, or run on Shift. A thumb-stick is a throttle, as in onfoot.js.
  let speed = heldKey(sim, 'run', KEYS) || T.run ? WALK.run : WALK.walk;
  const keysMove = kf || kb || kl || kr;
  const tm = Math.hypot(T.x, T.y);
  if (!keysMove && tm > 0.02) speed = tm <= 0.6 ? (tm / 0.6) * WALK.walk / Math.max(tm, 0.001) : (WALK.walk + Math.min(1, (tm - 0.6) / 0.35) * (WALK.run - WALK.walk)) / Math.max(tm, 0.001);
  const yaw = W.yaw * D2R;
  const fx = Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const wantVx = (fx * iy + Math.cos(yaw) * ix) * speed;
  const wantVz = (fz * iy + Math.sin(yaw) * ix) * speed;
  // Legs take a moment to get going and to stop, as the walker's own do.
  const k = Math.min(1, dt * WALK.accel);
  W.vx += (wantVx - W.vx) * k;
  W.vz += (wantVz - W.vz) * k;
  W.x += W.vx * dt;
  W.z += W.vz * dt;
  resolveObstacles(W, WALK.radius);

  // No mouse? Walking forwards while stepping sideways eases the view round
  // towards where you are going — onfoot.js's camera does the same.
  if (iy > 0.2 && Math.abs(ix) > 0.2 && W.lookIdle > 0.8) {
    const want = Math.atan2(ix, iy) / D2R;
    W.yaw += want * Math.min(1, dt * 1.3 * iy);
  }
  W.yaw = ((W.yaw % 360) + 360) % 360;
}

const _camPos = new THREE.Vector3();
const _camLook = new THREE.Vector3();
/*
 * Where the jet will be when this frame is drawn. main.js asks for the camera
 * BEFORE the features' update(), and the story (roles.js) moves the jet in
 * that update — so the pose read here is a frame old, and at 75 m/s the
 * world outside the windows (the escort, the drones) would sit a metre or two
 * ahead of the cabin, wobbling with every change in frame time. One frame of
 * its own velocity puts the cabin and your eye where the jet is drawn.
 */
const _airPos = new THREE.Vector3();
function airPose(air, dt) {
  _airPos.copy(air.pos);
  if (air.vel && dt > 0 && dt < 0.25) _airPos.addScaledVector(air.vel, dt);
  return _airPos;
}

function placeCabin(air, at) {
  if (!INTERIOR || !air) return;
  INTERIOR.position.copy(at);
  INTERIOR.quaternion.copy(air.quat);
  INTERIOR.updateMatrixWorld(true);
}

function placeCamera(sim, air, cam, at) {
  if (!cam || !air) return;
  // Seated, the eye drops into the chair and the view settles forwards-left, out of the window.
  const s = W.sitK;
  const ex = W.x + (SEAT.x - W.x) * s;
  const ez = W.z + (SEAT.z - 0.15 - W.z) * s;
  const ey = CAB.eyeY + (CAB.seatEyeY - CAB.eyeY) * s;
  let yaw = W.yaw * D2R;
  let pitch = W.pitch * D2R;
  // A missile that got through: a short, hard shake (the jet flies on).
  if (S.shakeT > 0) {
    const a = S.shakeT * 0.018;
    yaw += (Math.random() - 0.5) * a;
    pitch += (Math.random() - 0.5) * a;
  }
  _camPos.set(ex, ey, ez).applyQuaternion(air.quat).add(at);
  _camLook.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch)).applyQuaternion(air.quat).add(_camPos);
  cam.position.copy(_camPos);
  // The cabin's own up, so a banked turn tilts the horizon in the windows the way it does in a real one.
  cam.up.set(0, 1, 0).applyQuaternion(air.quat);
  cam.lookAt(_camLook);
  cam.up.set(0, 1, 0);
  // Face pressed to a window: the view narrows onto what is out there (the
  // escort, the drones' beacons, the flares) the way your eye does.
  S.fov += ((atWindow() ? 42 : 70) - S.fov) * Math.min(1, (S.camDt || 0) * 3);
  if (Math.abs(cam.fov - S.fov) > 0.05 || cam.near !== 0.1) {
    cam.fov = S.fov;
    cam.near = 0.1;
    cam.updateProjectionMatrix();
  }
}

/** Standing at a window and looking out of it (not along the wall). */
function atWindow() {
  if (W.seated || Math.abs(W.x) < 1.6) return false;
  const out = W.x > 0 ? 90 : 270;
  if (Math.abs(((W.yaw - out + 540) % 360) - 180) > 50) return false;
  return WINDOWS.some((z) => Math.abs(z - W.z) < 0.45);
}

/* ------------------------------------------------------------------ *
 * Where the current step wants you, and the moments when you get there.
 * ------------------------------------------------------------------ */

const PLACE = {
  call: { spot: SPOTS.office, label: 'Your office', r: 0.9 },
  brief: { spot: SPOTS.conference, label: 'The conference room', r: 0.9 },
  wave: { spot: SPOTS.window, label: 'A right-hand window', r: 0.95 },
  cockpit: { spot: SPOTS.cockpit, label: 'The flight deck', r: 0.8 },
  secure: { spot: SPOTS.secureInside, label: 'The secure room', r: 0.8 },
  seat: { spot: SPOTS.seat, label: 'Your seat', r: 0.75 },
  approach: { spot: SPOTS.cockpit, label: 'The flight deck — best view', r: 0.8 },
  watch: { spot: SPOTS.secureWindow, label: 'The window — watch Guardian', r: 0.4 },
};

function wantedPlace(stepId) {
  // In the secure room for the fight: its window is the place to be.
  if (stepId === 'defend' && inSecureRoom(W.x, W.z)) return PLACE.watch;
  // Told to stay in the secure room and out of it: back in.
  const key = (stepId === 'orders' || stepId === 'defend') ? 'secure' : stepId;
  const p = PLACE[key];
  if (!p) return null;
  if (key === 'secure') {
    if (inSecureRoom(W.x, W.z)) return null;
    // Through the secure room's door first, from the corridor.
    if (W.x < SECURE.x0) return { ...p, spot: SPOTS.secureDoor };
  }
  return p;
}

/*
 * On a phone held upright the events panel (the pointer, the Captain's card)
 * sits at 128 px — on top of the objective banner while it is open (two or
 * three lines there). Keep it just under the banner instead, whatever its
 * height; a quarter-second check, and the page is written only on a change.
 */
function keepPanelClear(sim, dt) {
  S.panelT = (S.panelT || 0) - dt;
  if (S.panelT > 0 || typeof document === 'undefined') return;
  S.panelT = 0.25;
  const panel = document.getElementById('fx-ev');
  const ob = sim.hud && sim.hud.objective;
  if (!panel || !ob || typeof window === 'undefined') return;
  let top = '';
  if (window.innerWidth <= 620) {
    const r = ob.getBoundingClientRect();
    if (r.height > 0) top = `${Math.round(Math.max(128, r.bottom + 8))}px`;
  }
  if (panel.style.top !== top) panel.style.top = top;
}

function freePanel() {
  const panel = typeof document !== 'undefined' && document.getElementById('fx-ev');
  if (panel && panel.style.top) panel.style.top = '';
}

function updateGuide(sim, stepId, info) {
  const p = wantedPlace(stepId);
  if (!p || W.seated) {
    if (MARKER) MARKER.visible = false;
    hideGuide();
    return;
  }
  const dx = p.spot.x - W.x;
  const dz = p.spot.z - W.z;
  const d = Math.hypot(dx, dz);
  if (MARKER) {
    // On the spot already: the ring stays, the diamond would be in your face.
    MARKER.visible = true;
    if (MARKER.userData.gem) MARKER.userData.gem.visible = d > 1.6;
    MARKER.position.set(p.spot.x, 0, p.spot.z);
    const g = MARKER.userData.gem;
    if (g) {
      g.rotation.y += 0.03;
      g.position.y = 1.2 + Math.sin(S.stepT * 3) * 0.06;
    }
  }
  const brg = Math.atan2(dx, -dz) / D2R;
  const rel = ((brg - W.yaw + 540) % 360) - 180;
  let sub = d < 1.2 ? 'here' : `${Math.round(d)} m${Math.abs(rel) > 120 ? ' — behind you' : ''}`;
  if (stepId === 'secure' && info && info.secureLeft != null) sub += ` · ${Math.ceil(info.secureLeft)} s`;
  if (stepId === 'wave' && d < 1.4) sub = isTouch(sim) ? 'tap Wave' : `press ${keyName('wave', sim)} to wave`;
  showGuide(sim, p.label, sub, rel);
}

function askBriefing(sim) {
  S.asked = true;
  showCard(sim, {
    who: 'THE CAPTAIN',
    text: `Mr. President — straight on to ${field()}, or would you rather we divert?`,
    tone: 'info',
    choices: [{ key: '8', label: `On to ${field()}` }, { key: '9', label: 'Ask about diverting' }],
    onChoice: (i) => {
      S.choice = i;
      hideCard();
      if (i === 0) speak(sim, `On to ${field()}, sir. We will have you down in a few minutes.`, V_CAPTAIN);
      else speak(sim, `We could, sir — but ${field()} has the best runway for a jumbo inside two hundred miles. I would press on.`, V_CAPTAIN);
    },
  });
}

function askOrders(sim, story) {
  S.asked = true;
  showCard(sim, {
    who: 'THE CAPTAIN',
    text: 'Mr. President, your orders?',
    tone: 'warn',
    choices: [{ key: '8', label: 'Get us on the ground — now' }, { key: '9', label: 'Stay up until Guardian has them' }],
    onChoice: (i) => {
      S.choice = i;
      hideCard();
      if (i === 0) {
        speak(sim, `Yes, sir. Taking us straight in to ${field()}.`, V_CAPTAIN);
        if (story && story.goHome) story.goHome(sim);
      } else {
        speak(sim, 'Holding over the water, sir. Guardian, they are all yours.', V_CAPTAIN);
      }
    },
  });
}

function sayAtCockpit(sim, story, attack) {
  speak(sim, attack ? 'Get us home, Captain.' : 'Take us in, Captain.', V_YOU);
  const sent = story && story.goHome ? story.goHome(sim) : false;
  if (!sent) speak(sim, `Already on our way, sir — ${field()}, dead ahead.`, V_CAPTAIN);
  else if (attack) speak(sim, `Yes, Mr. President. ${field()}, straight in.`, V_CAPTAIN);
  else speak(sim, `Yes, Mr. President. Starting our approach into ${field()} — the seatbelt sign will be on for the last few miles.`, V_CAPTAIN);
}

/** Things that happen as a step begins, once. */
function enterStep(sim, stepId, story) {
  if (stepId === 'brief') {
    speak(sim, `Sir, the summit is set — everyone is waiting for you at ${field()}.`, V_STAFF);
  } else if (stepId === 'seat') {
    // A question still up when the sign came on is moot now.
    if (S.asked && S.choice == null) hideCard();
    notify(sim, 'Ding — the seatbelt sign is on.', 'info', 3);
    speak(sim, 'Cabin crew, seats for landing.', V_CAPTAIN);
  } else if (stepId === 'cockpit' && S.missionId === 'afo-attack') {
    speak(sim, 'You can come out now, Mr. President. Guardian got them.', V_AGENT);
  }
}

function stepMoments(sim, stepId, story, info, dt) {
  const attack = S.missionId === 'afo-attack';
  if (stepId === 'brief' && !S.asked && S.choice == null && nearSpot(SPOTS.conference, PLACE.brief.r)) askBriefing(sim);
  if (stepId === 'orders' && !S.asked && S.choice == null) askOrders(sim, story);
  if (stepId === 'cockpit' && !S.cockpitDone && nearSpot(SPOTS.cockpit, PLACE.cockpit.r)) {
    S.cockpitDone = true;
    sayAtCockpit(sim, story, attack);
  }
  if (stepId === 'seat' && !W.seated && nearSpot(SPOTS.seat, PLACE.seat.r)) {
    W.seated = true;
    W.yaw = 330;
    W.pitch = -6;
    S.seatedBeforeTouchdown = !(info && info.onGround);
    notify(sim, 'Seatbelt fastened.', 'good', 2.5);
  }
  if (stepId === 'defend' && info) {
    S.agentNag -= dt;
    if (!inSecureRoom(W.x, W.z) && S.agentNag <= 0) {
      S.agentNag = 9;
      speak(sim, 'Sir — back inside, please. Not until we are clear.', V_AGENT);
    }
  }
}

function pressWave(sim) {
  const step = sim.runner && sim.runner.step;
  if (!step || step.id !== 'wave' || S.waved) return;
  if (!nearSpot(SPOTS.window, 1.4)) {
    if (S.waveHintT <= 0) {
      notify(sim, 'Get to a window on the right-hand side first — Guardian is off the right wing.', 'info', 3);
      S.waveHintT = 3;
    }
    return;
  }
  S.waved = true;
  const story = storyFor(S.storyId);
  if (story && story.escort) story.escort.rock(4);
  notify(sim, `You wave. ${LEAD} rocks his wings back.`, 'good', 3.5);
  speak(sim, `Air Force One, ${LEAD}. Tell the boss good morning from all of us.`, VOICE_FIGHTER);
}

registerExtension({
  id: 'afo-president',

  install(sim) {
    S.sim = sim;
    const canvas = sim.renderer && sim.renderer.domElement;
    if (canvas && canvas.addEventListener && typeof window !== 'undefined') {
      // Drag with the mouse to look round, exactly as onfoot.js does.
      canvas.addEventListener('pointerdown', (ev) => {
        if (!S.active || ev.pointerType === 'touch') return;
        S.drag = { id: ev.pointerId, dx: 0, dy: 0 };
      });
      window.addEventListener('pointermove', (ev) => {
        if (!S.active || !S.drag || ev.pointerId !== S.drag.id) return;
        S.drag.dx += ev.movementX || 0;
        S.drag.dy += ev.movementY || 0;
      });
      const up = (ev) => {
        if (S.drag && (!ev || ev.pointerId === S.drag.id)) S.drag = null;
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('blur', () => {
        for (const k of Object.keys(KEYS)) KEYS[k] = false;
        S.drag = null;
      });
      // A key let go while paused must still be let go (onfoot.js has the same).
      window.addEventListener('keyup', (ev) => {
        if (KEYS[ev.code]) KEYS[ev.code] = false;
      }, true);
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
    if (story && sim.riding !== story.air) sim.riding = story.air;
    const r = sim.runner;
    const stepId = r && r.status === 'running' && r.step ? r.step.id : null;
    if (stepId !== S.stepId) {
      S.stepId = stepId;
      S.stepT = 0;
      if (stepId) enterStep(sim, stepId, story);
    }
    S.stepT += dt;
    S.waveHintT -= dt;
    stepWalker(sim, dt);
    const info = story && story.info ? (story.info((S._info = S._info || {})), S._info) : null;
    if (story && story.hitShake > 0) S.shakeT = Math.max(S.shakeT, story.hitShake);
    S.shakeT = Math.max(0, S.shakeT - dt);
    if (stepId) stepMoments(sim, stepId, story, info, dt);
    updateGuide(sim, stepId, info);
    keepPanelClear(sim, dt);
    if (isTouch(sim)) FUI.setTouch(true, stepId === 'wave' && nearSpot(SPOTS.window, 1.4) && !S.waved ? WAVE_BUTTONS : NO_BUTTONS, (b) => {
      if (b === 'wave') pressWave(sim);
    });
  },

  camera(sim, dt, cam) {
    if (!S.active) return false;
    S.camDt = dt;
    const story = storyFor(S.storyId);
    if (!story) return false;
    const at = airPose(story.air, dt);
    placeCabin(story.air, at);
    placeCamera(sim, story.air, cam, at);
    return true;
  },

  keyContext() {
    return S.active ? 'foot' : null;
  },

  key(sim, code, down, e) {
    if (!S.active) return false;
    if (VK.some((a) => isKey(sim, a, code))) {
      KEYS[code] = down;
      if (down && !(e && e.repeat) && isKey(sim, 'wave', code)) pressWave(sim);
      return true;
    }
    return false;
  },
});

/** For afo-movie.js's beats, and for the tests. */
export function presidentInfo() {
  const story = S.active ? storyFor(S.storyId) : null;
  if (!story) return { active: false, missilesInbound: 0, dronesAlive: 0, failWhy: null, home: false };
  const out = { active: true, missionId: S.missionId, missilesInbound: 0, dronesAlive: 0, failWhy: null, home: !!story.home };
  if (typeof story.info === 'function') story.info(out);
  out.seated = W.seated;
  out.waved = S.waved;
  out.choice = S.choice;
  return out;
}

/** The walker's own local position, for the schedule's checks and the tests. */
export function walkerPos() {
  return { x: W.x, z: W.z, yaw: W.yaw, seated: W.seated };
}

/** Teleport the walker (tests only). */
export function placeWalker(x, z, yaw = null) {
  W.x = x;
  W.z = z;
  W.vx = 0;
  W.vz = 0;
  if (yaw != null) W.yaw = yaw;
}

/** The cabin's solid furniture and walls (tests and the bot's route planner). */
export function cabinObstacles() {
  return OBSTACLES.map((o) => ({ ...o }));
}

/** The cabin's size (tests). */
export const CABIN = Object.freeze({ ...CAB, bulkheads: BULKHEADS.slice(), doorHalf: DOOR_HALF, secure: { ...SECURE }, windows: WINDOWS.slice() });

/* ================================================================== *
 * The two seats (`roles:` on src/game/extra/afo.js's missions).
 * ================================================================== */

function storyInfo(storyId) {
  const s = castStory(storyId);
  const out = { home: false };
  if (s && typeof s.info === 'function') s.info(out);
  return out;
}

/** The real aeroplane: parked out of the way on the grass by the threshold, hidden. */
function parkedSpawn() {
  const h = ((RUNWAY.headingDeg ?? 90) * Math.PI) / 180;
  return {
    pos: new THREE.Vector3(RUNWAY.thresholdWest.x + Math.sin(h) * 260 - Math.cos(h) * 140, RUNWAY.elev, RUNWAY.thresholdWest.z - Math.cos(h) * 260 - Math.sin(h) * 140),
    headingDeg: RUNWAY.headingDeg ?? 90,
    speed: 0,
    engineOn: false,
  };
}

/*
 * The seatbelt sign ends the walking part of the schedule, whatever was left
 * of it: a step not done by then is passed over (and scores nothing) rather
 * than left blocking the landing.
 */
const orSeatbelt = (storyId, id, fn) => (ctx) => {
  if (fn(ctx)) return true;
  if (storyInfo(storyId).seatbelt) {
    S.missed.add(id);
    return true;
  }
  return false;
};

const HINT_WALK = 'W A S D to walk (Shift runs), drag the mouse or use the arrows to look. Follow the marker.';

const atSeat = (storyId) => () => {
  const s = storyInfo(storyId);
  return W.seated || !!s.onGround;
};
/** Down, and ten seconds into the roll-out: the mission is won there, not after the whole of it. */
const downAndStopped = (storyId) => () => {
  const s = castStory(storyId);
  return !!(s && s.air && s.air.onGround && s.onGroundSince != null && s.t - s.onGroundSince > 10);
};

export const PRESIDENT_NORMAL = {
  id: 'president',
  label: 'The President',
  line: 'Ride along, on foot in the cabin: a call, a briefing, a wave to your escort, the cockpit for the approach, and your seat for landing.',
  icon: '🎗️',
  actor: 'president',
  aircraft: 'b747',
  /** Nobody in this seat flies anything (airliners.js reads it: no take-off flap hint). */
  passenger: true,
  get spawn() {
    return parkedSpawn();
  },
  // Measured (the playthrough bot, at a walk): done in about 3 min.
  parTime: 230,
  cast: { story: STORY_NORMAL, actors: { airliner: { type: 'b747', brain: 'captain' } } },
  steps: [
    {
      id: 'call',
      text: 'You are aboard Air Force One. The phone is ringing in your office, up at the nose — go and take the call.',
      hint: HINT_WALK,
      check: orSeatbelt(STORY_NORMAL, 'call', () => nearSpot(SPOTS.office, PLACE.call.r)),
    },
    {
      id: 'brief',
      text: 'Head back to the conference room: the Captain needs your decision.',
      hint: 'Through the door behind you, then follow the marker.',
      check: orSeatbelt(STORY_NORMAL, 'brief', () => S.choice != null),
    },
    {
      id: 'wave',
      text: 'Guardian lead is flying off your right wing. Go to a right-hand window and wave to him.',
      hint: 'Any window on the right side of the lounge. Press E (or tap Wave) there.',
      check: orSeatbelt(STORY_NORMAL, 'wave', () => S.waved),
    },
    {
      id: 'cockpit',
      get text() {
        return `Go forward to the flight deck and tell the Captain to take you in to ${field()}.`;
      },
      hint: 'All the way forward, through the office, to the pilots.',
      check: orSeatbelt(STORY_NORMAL, 'cockpit', () => S.cockpitDone),
    },
    {
      id: 'approach',
      get text() {
        return `Air Force One is on the approach to ${field()}. Watch it come in from the flight deck — the seatbelt sign comes on for the last few miles.`;
      },
      hint: 'The runway is dead ahead, through the windscreen.',
      hintEvery: 75,
      check: () => storyInfo(STORY_NORMAL).seatbelt,
    },
    {
      id: 'seat',
      text: 'The seatbelt sign is on. Take your seat in the lounge for landing.',
      hint: 'Your armchair, on the left of the lounge. Follow the marker.',
      check: atSeat(STORY_NORMAL),
    },
    {
      id: 'down',
      get text() {
        return `Landing at ${field()}. Welcome home, Mr. President.`;
      },
      hint: 'Sit back and watch out of the window.',
      hintEvery: 75,
      check: downAndStopped(STORY_NORMAL),
    },
  ],
  score: (ctx) => {
    const time = Math.round(20 * scoreFor(ctx.elapsed, PRESIDENT_NORMAL.parTime));
    // Everything asked of you, done before the seatbelt sign: 20 more.
    const flair = (S.waved ? 8 : 0) + (S.choice != null ? 4 : 0) + (S.seatedBeforeTouchdown ? 4 : 0) + (S.missed.has('cockpit') ? 0 : 4);
    return Math.max(0, Math.min(100, 60 + time + flair - (S.missed.has('call') ? 6 : 0)));
  },
  onComplete(ctx) {
    ctx.sim.speak('Welcome home, Mr. President.', V_CAPTAIN);
  },
};

export const PRESIDENT_ATTACK = {
  id: 'president',
  label: 'The President',
  line: 'The Secret Service moves you to the secure room while the escort clears the drones — then you send the Captain home.',
  icon: '🎗️',
  actor: 'president',
  aircraft: 'b747',
  passenger: true,
  get spawn() {
    return parkedSpawn();
  },
  // Measured (the playthrough bot): done in about 3 min.
  parTime: 230,
  cast: { story: STORY_ATTACK, actors: { airliner: { type: 'b747', brain: 'captain' } } },
  steps: [
    {
      id: 'cruise',
      text: 'Air Force One, over open water. All calm — for now.',
      hint: HINT_WALK,
      check: () => storyInfo(STORY_ATTACK).warned,
    },
    {
      id: 'secure',
      text: '"Mr. President, we have to move. Now." Get to the secure room — mid-cabin, on the right.',
      hint: 'Forward along the corridor; its door is on your right. Follow the marker — quickly.',
      check: () => inSecureRoom(W.x, W.z),
    },
    {
      id: 'orders',
      text: 'You are safe in the secure room. The Captain wants your orders.',
      hint: 'Pick one on the card (or press 8 / 9).',
      check: orSeatbelt(STORY_ATTACK, 'orders', () => S.choice != null),
    },
    {
      id: 'defend',
      text: 'Guardian is engaging the drones. Watch through the window — and stay in the secure room until it is clear.',
      hint: 'Look out of the right-hand window.',
      hintEvery: 45,
      check: (ctx) => {
        const s = storyInfo(STORY_ATTACK);
        return s.clear || ctx.runner.stepElapsed > 150;
      },
    },
    {
      id: 'cockpit',
      text: 'The sky is clear. Go forward to the flight deck and tell the Captain to take you home.',
      hint: 'All the way forward, through the office, to the pilots.',
      check: orSeatbelt(STORY_ATTACK, 'cockpit', () => S.cockpitDone),
    },
    {
      id: 'approach',
      get text() {
        return `Air Force One is on the approach to ${field()}. Watch it come in from the flight deck — the seatbelt sign comes on for the last few miles.`;
      },
      hint: 'The runway is dead ahead, through the windscreen.',
      hintEvery: 75,
      check: () => storyInfo(STORY_ATTACK).seatbelt,
    },
    {
      id: 'seat',
      text: 'The seatbelt sign is on. Take your seat in the lounge for landing.',
      hint: 'Your armchair, on the left of the lounge. Follow the marker.',
      check: atSeat(STORY_ATTACK),
    },
    {
      id: 'down',
      get text() {
        return `Landing at ${field()}. Everybody is safe.`;
      },
      hint: 'Sit back and watch out of the window.',
      hintEvery: 75,
      check: downAndStopped(STORY_ATTACK),
    },
  ],
  failIf: () => storyInfo(STORY_ATTACK).failWhy,
  score: (ctx) => {
    const s = storyInfo(STORY_ATTACK);
    // Getting to the secure room quickly is the President's own skill; the
    // escort's dice (a missile getting through) only shaves a little off.
    const secure = s.secureTime == null ? 0 : Math.round(15 * clamp((SECURE_LIMIT - s.secureTime) / (SECURE_LIMIT - 12), 0.3, 1));
    const hits = s.stats ? s.stats.hits : 0;
    const protected_ = Math.max(0, 12 - hits * 3);
    const time = Math.round(15 * scoreFor(ctx.elapsed, PRESIDENT_ATTACK.parTime));
    const flair = (S.choice != null ? 4 : 0) + (S.seatedBeforeTouchdown ? 4 : 0) + (S.missed.has('cockpit') ? 0 : 4);
    return Math.max(0, Math.min(100, 46 + secure + protected_ + time + flair));
  },
  onComplete(ctx) {
    ctx.sim.speak('Welcome home, Mr. President. Everybody is safe.', V_CAPTAIN);
  },
};

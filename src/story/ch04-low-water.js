/**
 * SIGNAL ZERO — CHAPTER 4: LOW WATER
 * Longbank Sands · 05:40, dawn, the lowest tide of the year · Harbourlight's launch → on foot → the launch · about 8 min
 *
 * Mara knows where Gannet Two lies. "Lowest tide of the year is 0612. Don't
 * be brave. Be early." Cole has heard there is Kittiwake salvage money and
 * is racing for the same mark in his RIB. Thread the channel across the
 * bank (or cut across it), nose the launch in to the sand bar, run across
 * the exposed sand to a forty-year-old wreck with GANNET TWO under the
 * barnacles, free the sealed flight case from the cockpit, and get back out
 * before the tide covers the bank. Cole cuts a corner and runs aground;
 * Chief Esi Dumas's lifeboat tows him off ("Noted. Time and position."). In
 * the case: the Kittiwake range book, a flight-recorder transcript whose
 * last line is "Contact, left wing — it's not lightning—", and a crew list.
 * Co-pilot: M. VOSS.
 *
 * BUILT ON (story-bible.md §6, "Reuses"):
 *   - the boat game (vehicles/surface.js: the lever, the channel, running
 *     aground and backing off) and its shouts' shape (missions-boat.js):
 *     this beat IS a boat shout, started by startDrive through the story
 *     director;
 *   - the Longbank Sands map: its harbour, its one channel and its drying
 *     patches, as they are;
 *   - features/onfoot.js (get out with O, walk, get back in) and
 *     features/interact.js (hold E) — the same interaction as the hangar
 *     doors, so the finale's on-foot part is already familiar;
 *   - a terrain platform (world/terrain.js addPlatform, the lookout pad's
 *     mechanism) for the sand bar the tide has uncovered;
 *   - the letterbox, cards, dialogue and cutscene: story/cinema.js.
 *
 * NEW HERE:
 *   - the TIDE: a clock from the chapter start; in its last part the bar
 *     sinks back under the water (the platform and its sand lower together);
 *   - the Gannet Two wreck (a hand-posed broken twin), its flight case and
 *     its tail plate (File 04);
 *   - Cole's RIB as a racing prop that cuts the corner and grounds; Esi's
 *     lifeboat that comes out for him;
 *   - the crew-list reveal in the finale.
 *
 * One beat, in the boat: slip · the channel (or the short cut) · the bar ·
 * on foot to the wreck · the case · back aboard · out. Every step is a
 * checkpoint: start · out of the harbour · past the halfway buoy · at the
 * bar · at the wreck · case in hand · back aboard · home.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, harbourBerth, harbourMouth, addPlatform, PLATFORMS } from '../world/terrain.js';
import { createBoat } from '../vehicles/models.js';
import { createPerson, posePerson, disposePerson } from '../features/staff/person.js';
import { onFoot } from '../features/onfoot.js';
import { addInteractSource, removeInteractSource } from '../features/interact.js';
import { extLayer } from '../game/extensions.js';
import { LINES } from './script.js';

/* ====================================================================== */
/* the place                                                               */
/* ====================================================================== */

/*
 * Measured on Longbank's height field (2026-11-08): the harbour berth at
 * (-254, -1318) facing south, its mouth at (-274, -1081); the channel runs
 * south-east from there, 9 m deep; the bank around it is 4-6 m deep with
 * nine drying patches on it. The bar is the patch at (240, -140): its top
 * stands 0.3 m out at the lowest tide, so a platform makes the sand the
 * tide has uncovered — 200 m square, 0.6 m out of the water.
 */
export const PLACE = {
  mouth: { x: -274, z: -1081 },
  channel: [
    { x: -280, z: -1100 },
    { x: -230, z: -700 },
    { x: -420, z: -180 },
    { x: -300, z: 420 },
  ],
  /** The halfway buoy: the channel's turn, west of the bar. */
  halfway: { x: -420, z: -180 },
  bar: { cx: 240, cz: -140, w: 200, d: 200, y: 0.6 },
  /**
   * The wet shelf round the bar: 12 m of sand just out of the water. The
   * launch takes the ground on its edge and backs off a boat's length
   * (surface.js); the walker steps down onto it (onfoot.js wants dry ground
   * within 9 m, a quarter of a metre up or more).
   */
  shelf: { cx: 240, cz: -140, w: 224, d: 224, y: 0.3 },
  /** Where to nose in: the bar's west edge, nearest the channel. */
  landing: { x: 140, z: -150 },
  wreck: { x: 205, z: -150, headingDeg: 200 },
  case: { x: 196, z: -162 },
  plate: { x: 262, z: -118 },
  /** Cole's line: from the mouth straight at the bar's south-west corner. He grounds on its edge. */
  coleAim: { x: 150, z: -225 },
};

/** The sand is dry at this many metres out of the water; the tide takes it under in the clock's last part. */
export const BAR_UP = 0.6;
export const BAR_DOWN = -0.3;
export const SHELF_UP = 0.3;
/** A boat's length off the sand: close enough to step off (onfoot.js landingFor looks 9 m). */
export const STEP_OFF_M = 9;
export const CASE_REACH_M = 4;
export const CASE_HOLD_S = 2.5;
export const PLATE_REACH_M = 3;

/** What each difficulty changes (story-bible.md §7): the tide, and Cole's pace. */
export const DIFF = {
  story: { tide: 620, cole: 5.5 },
  pilot: { tide: 480, cole: 6.5 },
  ace: { tide: 400, cole: 7.5 },
};

/* ====================================================================== */
/* the chapter's live state                                                */
/* ====================================================================== */

const K = {
  api: null,
  diff: DIFF.pilot,
  t: 0,
  timeline: [],
  said: {},
  tide: 0,
  tideTotal: 1,
  shortCut: false,
  leftChannel: false,
  passedHalfway: false,
  atBar: null, // chapter seconds when nosed in
  groundings0: 0,
  groundingsAtBar: null,
  caseTaken: false,
  caseAt: null,
  backAboard: false,
  fileFound: false,
  home: false,
  cole: null, // { group, person, pos, dir, speed, state: 'race'|'aground'|'towed', t }
  coleEta: null,
  coleGroundAt: null,
  esi: null, // { group, pos, from, to, t, state }
  props: [], // meshes to dispose
  platform: null,
  shelfPlatform: null,
  sand: null,
  shelfSand: null,
  wreck: null,
  caseProp: null,
  plateProp: null,
  reveal: null,
  trackT: 0,
  v: new THREE.Vector3(),
};

/* ====================================================================== */
/* helpers                                                                 */
/* ====================================================================== */

const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function later(at, what) {
  K.timeline.push({ at, what, done: false });
}

function runTimeline() {
  for (const e of K.timeline) {
    if (e.done || K.t < e.at) continue;
    e.done = true;
    if (typeof e.what === 'function') e.what();
    else K.api.say(e.what);
  }
}

function sayOnce(id) {
  if (K.said[id]) return;
  K.said[id] = true;
  K.api.say(id);
}

const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

function boatOf(sim) {
  return sim && sim.vehicle && sim.vehicle.isBoat ? sim.vehicle : null;
}

/** Where the player is: the walker when out, the boat otherwise. */
function playerPos(sim) {
  if (onFoot.active && onFoot.walker) return { x: onFoot.walker.x, z: onFoot.walker.z };
  const b = boatOf(sim);
  return b ? b.pos : { x: 0, z: 0 };
}

/* ====================================================================== */
/* the pure rules (tested in node)                                         */
/* ====================================================================== */

/** Flat distance from (x, z) to the bar's rectangle: 0 inside. */
export function distToBar(x, z, bar = PLACE.bar) {
  const dx = Math.max(0, Math.abs(x - bar.cx) - bar.w / 2);
  const dz = Math.max(0, Math.abs(z - bar.cz) - bar.d / 2);
  return Math.hypot(dx, dz);
}

/** Flat distance from (x, z) to a polyline. */
export function distToPath(path, x, z) {
  let best = Infinity;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez || 1;
    let t = ((x - a.x) * ex + (z - a.z) * ez) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(a.x + ex * t - x, a.z + ez * t - z);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The bar's height out of the water for a tide clock: up until the last 40 %
 * of the clock, then sinking smoothly to BAR_DOWN by the end.
 */
export function barHeight(tideLeft, tideTotal) {
  const k = Math.max(0, Math.min(1, (0.4 - tideLeft / Math.max(1, tideTotal)) / 0.4));
  const e = k * k * (3 - 2 * k);
  return BAR_UP + (BAR_DOWN - BAR_UP) * e;
}

/** The short cut: off the channel and across the bank before the halfway buoy. */
export function isShortCut(x, z, path = PLACE.channel, halfway = PLACE.halfway) {
  return distToPath(path, x, z) > 150 && z < halfway.z - 60 && x > path[0].x + 120;
}

/**
 * The bible's table: bronze, the case recovered; silver, beat Cole and more
 * than 60 s of tide left; gold, Short Cut, more than 90 s left and no hull
 * scrape.
 */
export function verdict(k) {
  const caseTaken = !!k.caseTaken;
  const beatCole = !!(k.atBar != null && (k.coleEta == null || k.atBar < k.coleEta));
  const spare = k.tideLeft ?? 0;
  const scraped = (k.groundingsAtBar ?? 0) > (k.groundings0 ?? 0);
  const score = Math.round(Math.max(0, Math.min(100, (caseTaken ? 40 : 0) + (beatCole ? 20 : 8) + Math.min(25, spare / 6) + (scraped ? 0 : 10) + (k.shortCut ? 5 : 0))));
  let medal = 'bronze';
  if (caseTaken && beatCole && spare > 60) medal = 'silver';
  if (caseTaken && k.shortCut && spare > 90 && !scraped) medal = 'gold';
  return {
    medal,
    score,
    beatCole,
    breakdown: [
      { label: 'The flight case', value: caseTaken ? 'recovered' : 'left in the wreck' },
      { label: 'Cole Bannerman', value: beatCole ? 'beaten to the mark' : 'he got there first' },
      { label: 'Tide left', value: `${mmss(spare)} (silver over 1:00, gold over 1:30)` },
      { label: 'The hull', value: scraped ? 'touched the bottom' : 'never touched' },
      { label: 'Short Cut', value: k.shortCut ? 'straight across the bank' : '—' },
    ],
    note: medal === 'gold'
      ? 'Across the bank, in and out before the sea, and not a scrape. Mara would have done it that way.'
      : medal === 'silver'
        ? 'The case is yours and Cole is on the putty. Cut across the bank and keep the hull off the sand for gold.'
        : 'Forty years down there, and now it is on the bench. Replay to beat Cole and the tide.',
  };
}

/* ====================================================================== */
/* the props                                                               */
/* ====================================================================== */

function addProps(sim) {
  clearProps(sim);
  const scene = sim.scene;
  const B = PLACE.bar;
  const SH = PLACE.shelf;
  // The sand bar: a platform the tide has uncovered, and the sand on it; the
  // wet shelf round it (the bar's platform is listed first, so it wins inside).
  addPlatform(B.cx, B.cz, B.w, B.d, BAR_UP, 'Gannet bar');
  K.platform = PLATFORMS[PLATFORMS.length - 1];
  addPlatform(SH.cx, SH.cz, SH.w, SH.d, SHELF_UP, 'Gannet shelf');
  K.shelfPlatform = PLATFORMS[PLATFORMS.length - 1];
  const sandMat = new THREE.MeshStandardMaterial({ color: 0xd9caa3, roughness: 1, metalness: 0 });
  const sand = new THREE.Mesh(new THREE.BoxGeometry(B.w, 1.6, B.d), sandMat);
  sand.position.set(B.cx, BAR_UP - 0.8, B.cz);
  sand.receiveShadow = true;
  sand.name = 'story:gannet-bar';
  scene.add(sand);
  K.sand = sand;
  K.props.push(sand);
  const wetMat = new THREE.MeshStandardMaterial({ color: 0xb6a88a, roughness: 0.9, metalness: 0.05 });
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(SH.w, 1.6, SH.d), wetMat);
  shelf.position.set(SH.cx, SHELF_UP - 0.8, SH.cz);
  shelf.receiveShadow = true;
  shelf.name = 'story:gannet-shelf';
  scene.add(shelf);
  K.shelfSand = shelf;
  K.props.push(shelf);
  // Wet ripples: a darker rim just inside the edge.
  const rim = new THREE.Mesh(new THREE.RingGeometry(Math.min(B.w, B.d) * 0.42, Math.min(B.w, B.d) * 0.5, 32), new THREE.MeshStandardMaterial({ color: 0xb9ad8a, roughness: 1, transparent: true, opacity: 0.6, depthWrite: false }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.set(B.cx, BAR_UP + 0.02, B.cz);
  scene.add(rim);
  K.props.push(rim);
  // Gannet Two: a 1980s twin, half in the sand, the nose broken off.
  K.wreck = buildWreck(scene, PLACE.wreck, BAR_UP);
  K.props.push(K.wreck);
  // The sealed flight case, where the cockpit was.
  K.caseProp = buildFlightCase(scene, PLACE.case, BAR_UP);
  K.props.push(K.caseProp);
  // The tail plate, 60 m off (File 04).
  K.plateProp = buildPlate(scene, PLACE.plate, BAR_UP);
  K.props.push(K.plateProp);
}

function buildWreck(scene, at, y) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xb9b3a4, roughness: 0.95, metalness: 0.1 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x4a473f, roughness: 1 });
  const fus = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 0.9, 11, 14, 1, true), skin);
  fus.rotation.x = Math.PI / 2;
  fus.position.set(0, 0.5, 0);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(15, 0.28, 2.2), skin);
  wing.position.set(0.8, 0.3, 0.6);
  wing.rotation.z = -0.1;
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.2, 2.6, 1.8), skin);
  fin.position.set(0, 1.9, 5.2);
  fin.rotation.x = -0.25;
  const eng = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 2.2, 10), dark);
  eng.rotation.x = Math.PI / 2;
  eng.position.set(4.2, 0.35, 0.3);
  const nose = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.6, 2.4, 12, 1, true), dark);
  nose.rotation.set(Math.PI / 2 + 0.5, 0.3, 0);
  nose.position.set(-1.6, -0.1, -7.2);
  // GANNET TWO, under the barnacles: a stencil on the fuselage side.
  const decal = nameDecal('GANNET TWO');
  if (decal) {
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), new THREE.MeshStandardMaterial({ map: decal, transparent: true, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    plane.position.set(1.12, 0.75, -1.5);
    plane.rotation.y = Math.PI / 2;
    g.add(plane);
    g.userData.decal = decal;
  }
  g.add(fus, wing, fin, eng, nose);
  g.position.set(at.x, y - 0.45, at.z);
  g.rotation.set(0.04, -(at.headingDeg * Math.PI) / 180, 0.14);
  g.name = 'story:gannet-two';
  scene.add(g);
  return g;
}

function nameDecal(text) {
  try {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 112;
    const g = c.getContext('2d');
    if (!g) return null;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(60,55,45,0.55)';
    g.font = '700 84px "Barlow Condensed", "Arial Narrow", sans-serif';
    g.textBaseline = 'middle';
    g.fillText(text, 14, 58);
    // Barnacles and rust over it.
    for (let i = 0; i < 70; i++) {
      g.fillStyle = `rgba(${120 + Math.random() * 60 | 0},${90 + Math.random() * 40 | 0},${60 + Math.random() * 30 | 0},${0.35 + Math.random() * 0.4})`;
      g.beginPath();
      g.arc(Math.random() * c.width, Math.random() * c.height, 3 + Math.random() * 9, 0, Math.PI * 2);
      g.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 2;
    return tex;
  } catch (e) {
    return null;
  }
}

function buildFlightCase(scene, at, y) {
  const g = new THREE.Group();
  const olive = new THREE.MeshStandardMaterial({ color: 0x4f5a3a, roughness: 0.8, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xa8adb3, roughness: 0.5, metalness: 0.6 });
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.46), olive);
  box.position.y = 0.21;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.06, 0.48), steel);
  band.position.y = 0.32;
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 12), steel);
  handle.position.set(0, 0.46, 0);
  g.add(box, band, handle);
  g.position.set(at.x, y, at.z);
  g.rotation.y = 0.6;
  g.name = 'story:flight-case';
  scene.add(g);
  return g;
}

function buildPlate(scene, at, y) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.7, metalness: 0.5 });
  const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 1.1, 0.12), steel);
  post.position.y = 0.55;
  const plate = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.9, 0.08), new THREE.MeshStandardMaterial({ color: 0xcfd2d6, roughness: 0.6, metalness: 0.4 }));
  plate.position.set(0, 1.2, 0);
  plate.rotation.y = 0.4;
  g.add(post, plate);
  g.position.set(at.x, y, at.z);
  g.name = 'story:tail-plate';
  scene.add(g);
  return g;
}

function clearProps(sim) {
  for (const p of K.props) {
    try {
      if (p.parent) p.parent.remove(p);
      p.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          if (o.material.map) o.material.map.dispose();
          o.material.dispose();
        }
      });
      if (p.userData && p.userData.decal) p.userData.decal.dispose();
    } catch (e) {
      /* gone */
    }
  }
  K.props = [];
  K.sand = null;
  K.shelfSand = null;
  K.wreck = null;
  K.caseProp = null;
  K.plateProp = null;
  for (const key of ['platform', 'shelfPlatform']) {
    if (K[key]) {
      const i = PLATFORMS.indexOf(K[key]);
      if (i >= 0) PLATFORMS.splice(i, 1);
    }
    K[key] = null;
  }
  disposeCole();
  disposeEsi();
  if (sim) void sim;
}

/** The tide: the bar (and its sand) at the clock's height. */
function tickBar() {
  const h = barHeight(K.tide, K.tideTotal);
  if (K.platform) K.platform.y = h;
  if (K.sand) K.sand.position.y = h - 0.8;
  const hs = h - (BAR_UP - SHELF_UP);
  if (K.shelfPlatform) K.shelfPlatform.y = hs;
  if (K.shelfSand) K.shelfSand.position.y = hs - 0.8;
  for (const p of [K.wreck, K.caseProp, K.plateProp]) if (p && p.userData) p.userData.barY = h;
}

/* ====================================================================== */
/* Cole's RIB, and Esi's lifeboat                                           */
/* ====================================================================== */

function buildRib() {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x6b7076, roughness: 0.7 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xd8521f, roughness: 0.6 });
  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.6, 6.2), grey);
  hull.position.y = 0.05;
  g.add(hull);
  for (const s of [-1, 1]) {
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 6.4, 10), orange);
    tube.rotation.x = Math.PI / 2;
    tube.position.set(s * 1.05, 0.4, 0.1);
    g.add(tube);
  }
  const bow = new THREE.Mesh(new THREE.ConeGeometry(0.9, 1.8, 4), orange);
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, 0.4, -3.9);
  g.add(bow);
  const console_ = new THREE.Mesh(new THREE.BoxGeometry(1, 0.9, 0.7), grey);
  console_.position.set(0, 0.75, 0.6);
  g.add(console_);
  return g;
}

function spawnCole(sim) {
  disposeCole();
  const g = buildRib();
  const start = { x: PLACE.mouth.x + 30, z: PLACE.mouth.z + 20 };
  g.position.set(start.x, 0, start.z);
  g.name = 'story:cole-rib';
  sim.scene.add(g);
  let person = null;
  try {
    person = createPerson({ outfit: 'pilot', seed: 17, jacket: 0x7a2d26, shirt: 0xe6d9b8 });
    person.position.set(0, 0.35, 1.3);
    g.add(person);
  } catch (e) {
    person = null;
  }
  const aim = PLACE.coleAim;
  const d = dist2D(start, aim);
  const dir = { x: (aim.x - start.x) / d, z: (aim.z - start.z) / d };
  K.cole = { group: g, person, pos: { x: start.x, z: start.z }, dir, speed: 0, state: 'wait', t: 0, bob: Math.random() * 6 };
  // His time to the mark at full chat, from a standing start ten seconds in.
  K.coleEta = 10 + d / K.diff.cole + 8;
}

function disposeCole() {
  if (K.cole) {
    try {
      if (K.cole.person) disposePerson(K.cole.person);
      if (K.cole.group.parent) K.cole.group.parent.remove(K.cole.group);
      K.cole.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose) o.material.dispose();
      });
    } catch (e) {
      /* gone */
    }
  }
  K.cole = null;
}

function updateCole(sim, dt) {
  const c = K.cole;
  if (!c) return;
  c.t += dt;
  c.bob += dt;
  if (c.state === 'wait') {
    if (K.t > 10) {
      c.state = 'race';
      sayOnce('c4-cole-2');
    }
  } else if (c.state === 'race') {
    c.speed = Math.min(K.diff.cole, c.speed + dt * 1.2);
    c.pos.x += c.dir.x * c.speed * dt;
    c.pos.z += c.dir.z * c.speed * dt;
    // He cuts the corner straight at the sand: the bank catches him at the bar's edge.
    const depth = -heightAt(c.pos.x, c.pos.z) - 0.6;
    if (depth <= 0 || distToBar(c.pos.x, c.pos.z) < 6) {
      c.state = 'aground';
      c.speed = 0;
      K.coleGroundAt = K.t;
      sayOnce('c4-cole-3');
      later(K.t + 5, 'c4-esi-1');
      later(K.t + 6, () => spawnEsi(sim));
      later(K.t + 40, 'c4-esi-2');
    }
  }
  const g = c.group;
  g.position.set(c.pos.x, Math.sin(c.bob * 1.7) * 0.06 + (c.state === 'aground' ? 0.12 : 0), c.pos.z);
  g.rotation.y = Math.atan2(c.dir.x, -c.dir.z) + Math.PI;
  g.rotation.z = c.state === 'aground' ? 0.12 : Math.sin(c.bob * 2.1) * 0.03;
  if (c.person) {
    try {
      posePerson(c.person, dt, { speed: 0, wave: c.state === 'aground' && Math.sin(c.bob) > 0 ? 'hello' : null });
    } catch (e) {
      /* standing is fine */
    }
  }
}

function spawnEsi(sim) {
  disposeEsi();
  if (!K.cole) return;
  let g;
  try {
    g = createBoat();
  } catch (e) {
    return;
  }
  g.name = 'story:esi-lifeboat';
  const from = { x: PLACE.mouth.x, z: PLACE.mouth.z };
  const c = K.cole.pos;
  // Alongside him, a boat's width off, on the deep side.
  const to = { x: c.x - K.cole.dir.x * 14 - K.cole.dir.z * 6, z: c.z - K.cole.dir.z * 14 + K.cole.dir.x * 6 };
  g.position.set(from.x, 0, from.z);
  sim.scene.add(g);
  K.esi = { group: g, from, to, pos: { ...from }, t: 0, state: 'out' };
}

function disposeEsi() {
  if (K.esi) {
    try {
      if (K.esi.group.parent) K.esi.group.parent.remove(K.esi.group);
      K.esi.group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material && o.material.dispose && !o.material.userData?.shared) o.material.dispose();
      });
    } catch (e) {
      /* gone */
    }
  }
  K.esi = null;
}

function updateEsi(dt) {
  const e = K.esi;
  if (!e) return;
  e.t += dt;
  const d = dist2D(e.pos, e.to);
  if (e.state === 'out' && d > 2) {
    const sp = Math.min(11, d * 0.2 + 2);
    e.pos.x += ((e.to.x - e.pos.x) / d) * sp * dt;
    e.pos.z += ((e.to.z - e.pos.z) / d) * sp * dt;
    e.group.rotation.y = Math.atan2(e.to.x - e.pos.x, -(e.to.z - e.pos.z)) + Math.PI;
  } else if (e.state === 'out') {
    e.state = 'alongside';
  }
  e.group.position.set(e.pos.x, Math.sin(e.t * 1.5) * 0.05, e.pos.z);
}

/* ====================================================================== */
/* the case: hold E                                                        */
/* ====================================================================== */

const CASE_SOURCE = {
  id: 'story-gannet-case',
  list(sim, w, add) {
    if (K.caseTaken || !K.caseProp) return;
    add({
      id: 'gannet-case',
      label: 'Free the flight case',
      x: PLACE.case.x,
      z: PLACE.case.z,
      reach: CASE_REACH_M,
      face: null,
      look: 180, // a case on the sand: from any side, whichever way you are looking

      hold: CASE_HOLD_S,
      run() {
        takeCase();
        return null;
      },
    });
  },
};

function takeCase() {
  if (K.caseTaken) return;
  K.caseTaken = true;
  K.caseAt = K.t;
  if (K.caseProp) K.caseProp.visible = false;
  K.api.lowerThird('FLIGHT CASE · GANNET TWO · SEALED 1986', 4);
  K.api.say('c4-lark-3');
  later(K.t + 3, 'c4-mara-3');
}

/* ====================================================================== */
/* THE BEAT — the bank                                                     */
/* ====================================================================== */

const _tgt = new THREE.Vector3();
function at(p, y = 0) {
  return _tgt.set(p.x, y, p.z);
}

export const BANK = {
  id: 'story-ch04-bank',
  name: 'Low Water',
  short: 'Chapter 4 — the bank',
  game: 'story',
  hidden: true,
  subject: 'boat',
  vehicle: 'boat',
  difficulty: 'Medium',
  icon: '⚓',
  category: 'story',
  map: 'longbank',
  blurb: 'Signal Zero, chapter 4.',
  weather: { time: 'sunset', condition: 'clear', windSpeedKts: 8, windDirDeg: 250 },
  /** The boat game spawns at the harbour berth (missions-boat.js boatSpawnFor); this is for the chapter graph. */
  spawn: {
    get pos() {
      const b = harbourBerth();
      return new THREE.Vector3(b ? b.x : -254, 0, b ? b.z : -1318);
    },
    headingDeg: 170,
  },
  failOnCrash: true,
  startLabel: 'Chapter start',
  onStart(ctx) {
    enterBank(ctx);
  },
  tick(ctx, dt) {
    tickBank(ctx, dt);
  },
  failIf() {
    if (K.tide <= 0 && !K.home) return LINES['c4-fail-tide'].text;
    return null;
  },
  steps: [
    {
      id: 'slip',
      text: 'Off the berth and out of the harbour. Keep the red buoys on your right going out.',
      hint: 'Shift steps the lever up: Slow, Half, Full. A and D steer. She keeps going when you slow down.',
      hintEvery: 30,
      checkpoint: 'Out of the harbour',
      targetLabel: 'Harbour mouth',
      target: () => at(PLACE.mouth),
      check: (ctx) => {
        const b = boatOf(ctx.sim);
        return !!b && dist2D(b.pos, PLACE.mouth) < 70;
      },
    },
    {
      id: 'channel',
      text: 'Down the channel to the halfway buoy, or straight across the bank if you dare. The tide clock is running.',
      hint: 'The chart shows the channel. The bank is deep enough for the launch, but the patches are not.',
      hintEvery: 30,
      rolling: true,
      checkpoint: 'Past the halfway buoy',
      targetLabel: 'Halfway buoy',
      target: () => at(PLACE.halfway),
      check: (ctx) => {
        const b = boatOf(ctx.sim);
        if (!b) return false;
        if (dist2D(b.pos, PLACE.halfway) < 90) K.passedHalfway = true;
        if (!K.passedHalfway && isShortCut(b.pos.x, b.pos.z)) {
          K.shortCut = true;
          K.api.style('short-cut', 'Short Cut');
          sayOnce('c4-mara-2');
          return true;
        }
        return K.passedHalfway;
      },
    },
    {
      id: 'bar',
      text: 'East for the wreck mark. Nose in to the bar at Slow and stop when the sand is a boat’s length off.',
      hint: 'Take the lever off early: she carries her way. Bump the sand and the bottom costs you a dent.',
      hintEvery: 25,
      rolling: true,
      checkpoint: 'At the bar',
      targetLabel: 'The bar',
      target: () => at(PLACE.landing),
      check: (ctx) => {
        const b = boatOf(ctx.sim);
        if (!b) return false;
        const near = distToBar(b.pos.x, b.pos.z, PLACE.shelf) <= STEP_OFF_M;
        if (near && Math.abs(b.speed) < 0.8 && !b.aground) {
          K.atBar = K.atBar ?? K.t;
          K.groundingsAtBar = b.groundings || 0;
          return true;
        }
        return false;
      },
      onDone() {
        if (!K.said['c4-mara-4'] && K.coleGroundAt == null) sayOnce('c4-mara-4');
      },
    },
    {
      id: 'walk',
      text: 'Get out — O, or the button — and run to the wreck. The sea is coming back.',
      hint: 'W A S D to run, the mouse or arrows to look. The case is at the cockpit end.',
      hintEvery: 20,
      checkpoint: 'At the wreck',
      targetLabel: 'Gannet Two',
      target: () => at(PLACE.case, BAR_UP + 1),
      enter() {
        if (!K.api.isResume) K.api.say('c4-lark-2');
      },
      check: () => onFoot.active && !!onFoot.walker && dist2D(onFoot.walker, PLACE.case) < CASE_REACH_M + 1,
    },
    {
      id: 'case',
      text: 'Hold E to free the flight case from the cockpit.',
      hint: 'Stand by the case, look at it, and hold the key until the bar fills.',
      hintEvery: 15,
      checkpoint: 'Case in hand',
      targetLabel: 'The flight case',
      target: () => at(PLACE.case, BAR_UP + 1),
      check: () => K.caseTaken,
    },
    {
      id: 'back',
      text: 'Back to the launch and get in — O, or the button.',
      hint: 'Walk up to her and press O.',
      hintEvery: 20,
      checkpoint: 'Back aboard',
      targetLabel: 'The launch',
      target: (ctx) => {
        const b = boatOf(ctx.sim);
        return b ? at(b.pos, 1) : at(PLACE.landing);
      },
      check: (ctx) => K.caseTaken && !onFoot.active && !!boatOf(ctx.sim),
      onDone() {
        K.backAboard = true;
      },
    },
    {
      id: 'out',
      text: 'Astern off the bar, then west for the harbour mouth before the tide closes the bank.',
      hint: 'Ctrl steps the lever down to Astern. Clear of the sand, round to the west and Full ahead.',
      hintEvery: 30,
      rolling: true,
      checkpoint: 'Home',
      targetLabel: 'Harbour mouth',
      target: () => at(PLACE.mouth),
      enter() {
        if (!K.api.isResume) later(K.t + 2, 'c4-mara-5');
      },
      check: (ctx) => {
        const b = boatOf(ctx.sim);
        if (b && dist2D(b.pos, PLACE.mouth) < 90) {
          K.home = true;
          return true;
        }
        return false;
      },
    },
  ],
  onComplete() {
    K.api.say('c4-esi-3');
  },
  score: () => Math.round(40 + 60 * Math.max(0, Math.min(1, K.tide / Math.max(1, K.tideTotal))) * (K.caseTaken ? 1 : 0.5)),
  save() {
    return {
      t: K.t,
      tide: K.tide,
      shortCut: K.shortCut,
      passedHalfway: K.passedHalfway,
      atBar: K.atBar,
      groundings0: K.groundings0,
      groundingsAtBar: K.groundingsAtBar,
      caseTaken: K.caseTaken,
      caseAt: K.caseAt,
      backAboard: K.backAboard,
      fileFound: K.fileFound,
      coleState: K.cole ? K.cole.state : null,
      colePos: K.cole ? [Math.round(K.cole.pos.x), Math.round(K.cole.pos.z)] : null,
      coleEta: K.coleEta,
      coleGroundAt: K.coleGroundAt,
      said: Object.keys(K.said),
    };
  },
  resume(state, ctx) {
    if (!state) return;
    K.t = state.t || 0;
    K.tide = Number.isFinite(state.tide) ? state.tide : K.tide;
    K.shortCut = !!state.shortCut;
    K.passedHalfway = !!state.passedHalfway;
    K.atBar = state.atBar ?? null;
    K.groundings0 = state.groundings0 || 0;
    K.groundingsAtBar = state.groundingsAtBar ?? null;
    K.caseTaken = !!state.caseTaken;
    K.caseAt = state.caseAt ?? null;
    K.backAboard = !!state.backAboard;
    K.fileFound = !!state.fileFound || K.fileFound;
    K.coleEta = state.coleEta ?? K.coleEta;
    K.coleGroundAt = state.coleGroundAt ?? null;
    for (const id of state.said || []) K.said[id] = true;
    if (K.caseTaken && K.caseProp) K.caseProp.visible = false;
    if (K.cole && state.colePos) {
      K.cole.pos.x = state.colePos[0];
      K.cole.pos.z = state.colePos[1];
      K.cole.state = state.coleState || 'race';
      if (K.cole.state === 'aground') spawnEsi(ctx.sim);
    }
    tickBar();
  },
};

function enterBank(ctx) {
  const sim = ctx.sim;
  K.t = 0;
  K.timeline = [];
  K.said = {};
  K.tideTotal = K.diff.tide;
  K.tide = K.diff.tide;
  K.shortCut = false;
  K.leftChannel = false;
  K.passedHalfway = false;
  K.atBar = null;
  K.groundingsAtBar = null;
  K.caseTaken = false;
  K.caseAt = null;
  K.backAboard = false;
  K.home = false;
  K.coleGroundAt = null;
  const b = boatOf(sim);
  K.groundings0 = b ? b.groundings || 0 : 0;
  addProps(sim);
  spawnCole(sim);
  addInteractSource(CASE_SOURCE);
  tickBar();
  if (!K.api.isResume) {
    later(1.0, 'c4-mara-1');
    later(5.5, 'c4-cole-1');
    later(9.5, 'c4-lark-1');
    later(14, () => {
      K.api.titleCard({ main: 'SIGNAL ZERO', wordmark: true, dur: 2, bars: 'thin' });
      K.api.titleCard({ over: 'Chapter 4', main: 'LOW WATER', sub: 'LONGBANK SANDS · 05:40', dur: 3.5, bars: 'thin' });
    });
  }
}

function tickBank(ctx, dt) {
  const sim = ctx.sim;
  K.t += dt;
  runTimeline();
  if (!K.home) K.tide = Math.max(0, K.tide - dt);
  tickBar();
  updateCole(sim, dt);
  updateEsi(dt);
  checkFile(sim);
  if (K.tide < 90 && !K.said.tide90) {
    K.said.tide90 = true;
    K.api.notify('Ninety seconds of tide. The bank is going under.', 'warn', 3.5);
    sayOnce('c4-esi-4');
  }
  if (K.tide < 30 && !K.said.tide30) {
    K.said.tide30 = true;
    K.api.notify('Thirty seconds. Out of the channel, now.', 'bad', 3);
  }
}

/** File 04: the tail plate, 60 m from the cockpit. On foot only. */
function checkFile(sim) {
  if (K.fileFound || !K.plateProp) return;
  if (!onFoot.active || !onFoot.walker) return;
  if (dist2D(onFoot.walker, PLACE.plate) < PLATE_REACH_M) {
    K.fileFound = true;
    K.api.foundFile('f04');
    K.api.say('c4-file-1');
  }
  void sim;
}

/* ====================================================================== */
/* cutscene (b): the harbour mouth at dawn, the case open                  */
/* ====================================================================== */

function revealPanel() {
  if (K.reveal) return K.reveal;
  const root = document.createElement('div');
  root.className = 'sz-reveal sz-case';
  Object.assign(root.style, {
    position: 'fixed', left: '50%', top: '44%', transform: 'translate(-50%, -50%) rotate(1.5deg)', zIndex: 35, pointerEvents: 'none',
    display: 'none', padding: '18px 22px', background: '#efe6d2', borderRadius: '4px', boxShadow: '0 18px 50px rgba(0,0,0,0.65)',
    opacity: 0, transition: 'opacity 0.6s ease', width: 'min(520px, 76vw)', color: '#2b2a26', font: '500 14px/1.45 var(--mono, ui-monospace, Menlo, monospace)',
  });
  root.innerHTML = `
    <div style="font:800 12px/1 var(--font, sans-serif);letter-spacing:0.18em;color:#6a5a3a;margin-bottom:10px">PROJECT KITTIWAKE · RECOVERY AIRCRAFT GANNET TWO · 1986</div>
    <div data-l="0" style="opacity:0;transition:opacity .5s">CREW: CAPT. R. OKAFOR · ENG. A. BRAND · CO-PILOT M. VOSS</div>
    <div data-l="1" style="opacity:0;transition:opacity .5s;margin-top:8px">RANGE BOOK: KEY TWO OF TWO · HOLDER: VOSS, M.</div>
    <div data-l="2" style="opacity:0;transition:opacity .5s;margin-top:8px">RECORDER, LAST LINE: “Contact, left wing — it’s not lightning—”</div>`;
  extLayer().appendChild(root);
  K.reveal = { root, on: false, shown: 0 };
  return K.reveal;
}

function showReveal() {
  const r = revealPanel();
  r.on = true;
  r.shown = 0;
  r.root.style.display = 'block';
  setTimeout(() => {
    r.root.style.opacity = '1';
  }, 20);
}

function revealLine(n) {
  const r = K.reveal;
  if (!r) return;
  const el = r.root.querySelector(`[data-l="${n}"]`);
  if (el) el.style.opacity = '1';
}

function hideReveal() {
  const r = K.reveal;
  if (!r) return;
  r.on = false;
  r.root.style.opacity = '0';
  setTimeout(() => {
    if (!r.on) r.root.style.display = 'none';
  }, 650);
}

function mouthScene(api) {
  const sim = api.sim;
  const b = boatOf(sim);
  const p0 = b ? b.pos.clone() : new THREE.Vector3(PLACE.mouth.x, 0, PLACE.mouth.z);
  const h = b ? (b.heading * Math.PI) / 180 : 0;
  const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const from = p0.clone().addScaledVector(fwd, 18).addScaledVector(right, 9).add(new THREE.Vector3(0, 3.5, 0));
  const to = p0.clone().addScaledVector(fwd, 6).addScaledVector(right, 13).add(new THREE.Vector3(0, 2.6, 0));
  const look = p0.clone().add(new THREE.Vector3(0, 1.2, 0));
  return api.playCutscene({
    id: 'ch04-mouth',
    dur: 18,
    bars: 'big',
    hideHud: true,
    hold: true,
    caption: 'The case open on the bench: the crew list. Co-pilot M. Voss. "Lightning doesn’t fly formation."',
    camera: (t, cam) => {
      const e = t * t * (3 - 2 * t);
      cam.position.lerpVectors(from, to, e);
      cam.lookAt(look);
    },
    beats: [
      { at: 0.6, line: 'c4-h-mara-1' },
      { at: 3.0, fn: () => showReveal() },
      { at: 3.6, fn: () => revealLine(0) },
      { at: 4.2, line: 'c4-h-lark-1' },
      { at: 7.4, fn: () => revealLine(1) },
      { at: 7.8, line: 'c4-h-mara-2' },
      { at: 11.2, fn: () => revealLine(2) },
      { at: 11.6, line: 'c4-h-lark-2' },
      { at: 14.4, line: 'c4-h-mara-3' },
    ],
  }).then((how) => {
    hideReveal();
    return how;
  });
}

/* ====================================================================== */
/* the chapter                                                             */
/* ====================================================================== */

export const CHAPTER_4 = {
  id: 'ch04-low-water',
  beats: [BANK],
  objectives: [
    'Follow the channel buoys across the bank',
    'Beat Cole to the wreck mark',
    'Nose in to the bar and step off',
    'On foot: reach the wreck (the tide clock runs)',
    'Hold E to free the flight case',
    'Back to the launch, and out before the tide closes the bank',
  ],
  briefing: {
    line: 'Longbank Sands · 05:40, dawn · the lowest tide of the year · Harbourlight’s launch, then on foot · about 8 minutes',
    bullets: [
      'Mara knows where Gannet Two lies. The sand is dry for about eight minutes. Don’t be brave, be early.',
      'Cole is racing for the same mark in his RIB. Follow the channel, or cut across the bank.',
      'Nose in to the bar, get out, free the sealed flight case from the cockpit, and get back out before the tide.',
    ],
    route: [
      [PLACE.mouth.x, PLACE.mouth.z - 200, 'the harbour'],
      [PLACE.halfway.x, PLACE.halfway.z, 'the halfway buoy'],
      [PLACE.bar.cx, PLACE.bar.cz, 'the bar · Gannet Two'],
    ],
  },
  enterChapter(api) {
    K.api = api;
    K.diff = DIFF[api.difficulty] || DIFF.pilot;
    K.t = 0;
    K.timeline = [];
    K.said = {};
    K.tideTotal = K.diff.tide;
    K.tide = K.diff.tide;
    K.shortCut = false;
    K.caseTaken = false;
    K.atBar = null;
    K.home = false;
    K.fileFound = !!(api.data && api.data.flags.files.includes('f04'));
    K.trackT = 0;
    api.tracker(trackerItems(api), 'Chapter 4 · Low Water');
  },
  leaveChapter(api) {
    removeInteractSource(CASE_SOURCE.id);
    clearProps(api.sim);
    hideReveal();
    if (onFoot.active) {
      try {
        onFoot.end(api.sim);
      } catch (e) {
        /* already in */
      }
    }
  },
  onBeatDone() {
    /* one beat */
  },
  finale(api) {
    return mouthScene(api);
  },
  medal() {
    return verdict({ caseTaken: K.caseTaken, atBar: K.atBar, coleEta: K.coleEta, tideLeft: K.tide, groundings0: K.groundings0, groundingsAtBar: K.groundingsAtBar, shortCut: K.shortCut });
  },
  onFail(api, f) {
    if (/hull|rolled|sank|hit|struck|wall|quay/i.test(f.reason || '') && !/tide/i.test(f.reason || '')) api.say('c4-fail-hull');
  },
  update(api, dt) {
    K.trackT += dt;
    if (K.trackT >= 0.25) {
      K.trackT = 0;
      api.tracker(trackerItems(api));
    }
  },
  /** For the tests. */
  _state: K,
};

function trackerItems(api) {
  const sim = api.sim;
  const r = sim.runner;
  const step = r && r.step ? r.step.id : null;
  const order = ['slip', 'channel', 'bar', 'walk', 'case', 'back', 'out'];
  const si = order.indexOf(step);
  const item = (text, state, extra = {}) => ({ text, state, ...extra });
  const tideNote = `tide ${mmss(K.tide)}`;
  const b = boatOf(sim);
  const toBar = b ? Math.round(distToBar(b.pos.x, b.pos.z, PLACE.shelf)) : null;
  const beatCole = K.atBar != null && (K.coleEta == null || K.atBar < K.coleEta);
  const items = [
    item(CHAPTER_4.objectives[0], si >= 2 ? 'done' : si >= 0 ? 'active' : 'todo', si <= 1 && si >= 0 ? { meter: K.tide / Math.max(1, K.tideTotal), note: `${tideNote}${K.shortCut ? ' · short cut' : ''}` } : {}),
    item(CHAPTER_4.objectives[1], K.atBar != null ? (beatCole ? 'done' : 'failed') : si >= 0 && si <= 2 ? 'active' : 'todo', K.cole && K.atBar == null ? { note: K.cole.state === 'aground' ? 'Cole is aground' : `Cole: ${Math.round(distToBar(K.cole.pos.x, K.cole.pos.z))} m from the bar` } : K.atBar != null ? { note: beatCole ? 'you were first' : 'he was first' } : {}),
    item(CHAPTER_4.objectives[2], si >= 3 ? 'done' : si === 2 ? 'active' : 'todo', si === 2 && toBar != null ? { note: `${toBar} m to the sand · ${tideNote}` } : {}),
    item(CHAPTER_4.objectives[3], si >= 4 ? 'done' : si === 3 ? 'active' : 'todo', si === 3 ? { meter: K.tide / Math.max(1, K.tideTotal), note: `${tideNote} · ${Math.round(dist2D(playerPos(sim), PLACE.case))} m to the wreck` } : {}),
    item(CHAPTER_4.objectives[4], K.caseTaken ? 'done' : si === 4 ? 'active' : 'todo', si === 4 ? { note: 'hold E' } : {}),
    item(CHAPTER_4.objectives[5], K.home ? 'done' : si >= 5 ? 'active' : 'todo', si >= 5 && b ? { meter: K.tide / Math.max(1, K.tideTotal), note: `${tideNote} · ${(dist2D(b.pos, PLACE.mouth) / 1000).toFixed(1)} km to the mouth` } : {}),
  ];
  void harbourMouth;
  return items;
}

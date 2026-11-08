/**
 * SIGNAL ZERO — CHAPTER 2: FIRE LINE
 * Firewatch Ridge · 10:20 next morning · hot, gusty · Skyhook H-3 with bucket · about 7 min
 *
 * A second object came down on the Long Scarp overnight and started a fire.
 * Two crew are cut off at the lookout on the top of the bench, and the fire
 * front is running uphill at them. Lark gets them off ahead of the wall,
 * then holds the line with bucket drops before the back of the fire reaches
 * the fire road, where the trucks are. In the burn scar: a scorched, finned
 * machine with no cockpit and no windows, stencilled SENTINEL · RANGE
 * SAFETY UNIT 4 · KITTIWAKE. A grey-and-teal Thornefield helicopter lands
 * — "we'll take it from here" — and up the fire road walks Priya.
 *
 * BUILT ON (story-bible.md §6, "Reuses"):
 *   - the wildfire (features/wildfire.js) — the same grid, flames, smoke,
 *     water, bucket and panel as Ridge Fire and Line One — lit from a spec
 *     here, with Line One's dug break (maps.js firewatch `fire.line`) as the
 *     fire road and the fire missions' own fill and drop steps
 *     (game/extra/fire.js fillStep/dropStep), adapted from 'fire-ridge';
 *   - the Skyhook and its long-line bucket; the cove pickup's land-and-wait
 *     pattern (missions-heli.js 'covepickup');
 *   - the crew and the people in the burn scar: staff/person.js walkers;
 *   - the fire trucks on the road: the emergency scene (declarative);
 *   - the letterbox, title card, dialogue and cutscene: story/cinema.js.
 *
 * NEW HERE (all reusable — none of it is a story-only fork):
 *   - the ADVANCING FIRE FRONT, wildfire/front.js: a front line tuned as a
 *     chase, held by water, saved and restored by checkpoint;
 *   - grid.scorch(): the night's burn scar on the first frame;
 *   - the SENTINEL unit (story/sentinel.js) in its 1986 livery, scorched;
 *   - the Thornefield livery and mark (story/brands.js; the heli livery in
 *     ambient/flyers.js), the fire-crew and Thornefield outfits (person.js);
 *   - the lookout set (story/sets.js): a pad you can land on and its cabin;
 *   - the pad landing on the owner's rule (beats.js makeDwell: "you land
 *     you land" — it counts the moment the skids touch the deck).
 *
 * Two beats, one flight: the LOOKOUT (out · up · land · board · lift) and
 * the LINE (fill · drop, three times · the scar · the photo). Checkpoints:
 * departure · below the Scarp · short of the pad · on the pad · crew aboard
 * · clear of the smoke · every bucket full · after each drop · over the
 * burn scar — never more than about a minute apart.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, MAP } from '../world/terrain.js';
import { MISSIONS as FIRE_MISSIONS, fillStep, dropStep } from '../game/extra/fire.js';
import { setupFire, fireStatus, fireFront, fireWater, restoreWater, setFireHud, fireCrewsTakeOver, fillPoint, nearestFire, wildfireDebug } from '../features/wildfire.js';
import { createPerson, posePerson, disposePerson } from '../features/staff/person.js';
import { isKey, playerClaimed, keyName } from '../flight/input.js';
import { extLayer } from '../game/extensions.js';
import { adapt, makeDwell, LANDING_HOLD } from './beats.js';
import { LINES } from './script.js';
import { buildSentinel } from './sentinel.js';
import { buildLookout, buildSurveyMarker } from './sets.js';

const BASE = FIRE_MISSIONS.find((m) => m.id === 'fire-ridge');

/* ====================================================================== */
/* the place                                                               */
/* ====================================================================== */

/*
 * The Long Scarp's south bench: a grassy shelf 365-445 m up, 850 m long
 * east-west and 250 m across, rock above it and a cliff below (measured on
 * Firewatch's height field, 2026-10-16: it rises gently to the west). The
 * lookout is on its high west end; the fire came down at its east end; the
 * fire road — Line One's dug break — crosses its east end; the inlet below
 * the cliff is the nearest water a bucket can dip in (findWater's own pick,
 * 460 m from the pad and 34 m deep).
 */
export const PLACE = {
  base: { x: -1050, z: -100 },
  pad: { x: 265, z: -1975, r: 9 },
  wreck: { x: 790, z: -1975 },
  marker: { x: 742, z: -2052 },
  inlet: { x: 36, z: -1579 },
  /**
   * The tarn: a pool on the bench's north rim, 170 m from the pad and 500 m
   * from the back of the fire, that a bucket dips in (the fire engine's dip
   * pools). Before it the only water was the inlet 430 m below the cliff,
   * and a full bucket climbing that made one bucket a four-minute round
   * trip (2026-11-08). Its water stands at the local high ground.
   */
  tarn: { x: 380, z: -2100, r: 38, y: 427 },
  woods: { x: 640, z: -1975, r: 470 },
  /** The head starts on this line across the bench (north to south through the wreck) and runs west. */
  line: [{ x: 790, z: -2160 }, { x: 790, z: -1790 }],
  /**
   * The back of the fire starts on this one: through the wreck, parallel to
   * the fire road where it crosses the bench (1128,-2100 → 980,-1850), so the
   * whole of it comes at the road square-on rather than one corner first.
   */
  backLine: [{ x: 887, z: -2139 }, { x: 693, z: -1811 }],
  backDir: { x: 0.8606, z: 0.5095 },
  /** Where the Thornefield helicopter puts down in the scar, and where Priya walks up the road from. */
  tfLand: { x: 860, z: -1925 },
  priyaFrom: { x: 985, z: -1860 },
  priyaTo: { x: 905, z: -1935 },
};

/** The fire road: Line One's break, from the map (the same numbers as the mission). */
export function roadPath() {
  const f = (MAP && MAP.fire) || {};
  return (f.line && f.line.path) || [
    { x: 1357, z: -2486 },
    { x: 1086, z: -2029 },
    { x: 679, z: -1343 },
    { x: 407, z: -886 },
    { x: 0, z: -200 },
  ];
}

/*
 * What each difficulty changes (story-bible.md §7). The head runs the 305 m
 * from where it is at 10:20 to the point where its smoke closes the pad in
 * about 290 / 200 / 145 s; after the lift-out the back of the fire runs
 * east at the road. Tuned with the robot pilot (tests/features/
 * story-ch02.browser.js) so Pilot is passed with room to spare.
 */
/*
 * Re-paced 2026-11-08 for the rotor wave (aircraft/rotor-assist.js, Oct 24):
 * the Skyhook now needs translational lift to get going and settles more
 * slowly onto a pad, so the same flight up the Scarp takes longer. The head
 * runs its 305 m in about 290 / 200 / 145 s: still a race on Pilot (the node
 * check holds it under three and a half minutes), with room for a landing by touch.
 * The water is the tarn on the bench (PLACE.tarn), 500 m from the back of
 * the fire, so a bucket is about a minute's round trip; an on-target hit
 * takes a good part of the run out of the back of the fire (`slow`), and
 * three of them hold the road. A first drop past five minutes loses it.
 */
export const DIFF = {
  story: { head: 1.0, back: 0.24, creep: 0.08, slow: 0.5, photoRange: 70, photoAgl: 90 },
  pilot: { head: 1.45, back: 0.32, creep: 0.1, slow: 0.6, photoRange: 50, photoAgl: 75 },
  ace: { head: 2.0, back: 0.45, creep: 0.12, slow: 0.7, photoRange: 40, photoAgl: 60 },
};
/** The smoke closes the pad when the head is this close (metres, along the bench). */
export const CLOSE_M = 110;
/** The fire reaches the pad itself. */
export const PAD_M = 24;
/** The head's start: metres it had run by 10:20. */
export const HEAD_START = 110;
export const BACK_START = 40;
/** The back of the fire is at the road. */
export const ROAD_M = 22;
export const DROPS_NEEDED = 3;
const CREW_KG = 90;
const CANOPY_M = 17;
const WIND_FROM = 95;
const WIND_SWUNG = 275;
const GOLD_SECONDS = 6 * 60;

/** The fire, as a wildfire spec (setupFire), for this difficulty. */
export function fireSpec(diff = DIFF.pilot) {
  return {
    centre: { x: 520, z: -1900 },
    ignite: [],
    woods: [PLACE.woods],
    line: { path: roadPath(), width: 24 },
    water: PLACE.tarn,
    waterName: 'the tarn',
    pools: [PLACE.tarn],
    preburn: 0,
    spread: 0.22,
    burn: 0.35,
    spot: 0,
    mopUp: 2, // never by containment: the story says when the crews have it
    smallLeft: 0,
    mopText: 'Fire crews: "We have it from the road. Thank you, Skyhook."',
    scars: [{ x: PLACE.wreck.x, z: PLACE.wreck.z, r: 55 }],
    hud: false,
    fronts: [
      // The head: a wall 90 m deep, each cell burning about 45 s, running up the bench at the pad.
      { id: 'head', from: PLACE.line, dir: { x: -1, z: 0 }, speed: diff.head, scatter: 0.08, band: 90, life: 45, jump: 30, startAt: HEAD_START, seed: 21 },
      // The back: slow, so each cell burns long (a backing fire smoulders) and there is always flame at its edge to hit.
      { id: 'back', from: PLACE.backLine, dir: PLACE.backDir, speed: diff.creep, scatter: 0.1, band: 45, life: 160, jump: 0, startAt: BACK_START, seed: 23 },
    ],
  };
}

/* ====================================================================== */
/* the chapter's live state                                                */
/* ====================================================================== */

const K = {
  api: null,
  diff: DIFF.pilot,
  t: 0,
  beat: null, // 'lookout' | 'line'
  timeline: [],
  said: {},
  props: null, // { lookout, wreck, marker }
  crew: [],
  boarded: 0,
  touchedPad: false,
  dwell: null,
  meterAtLift: null,
  head0: 0,
  hitsBase: 0,
  dropsBase: 0,
  hits: 0,
  drops: 0,
  lastDropAgl: null,
  lastReleasing: false,
  treetop: false,
  windSwing: null,
  photo: false,
  photoT: null,
  fileFound: false,
  handoff: false,
  scene: null,
  tapBtn: null,
  trackT: 0,
  v: new THREE.Vector3(),
};

/* ====================================================================== */
/* helpers                                                                 */
/* ====================================================================== */

function ground(x, z) {
  const h = heightAt(x, z);
  return Number.isFinite(h) ? Math.max(0, h) : 0;
}

const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Metres of air under the skids (the heli's own radar reading). */
function skids(ac) {
  const R = ac.rotor;
  if (R && Number.isFinite(R.heightAbove)) return R.heightAbove;
  return ac.pos.y - ground(ac.pos.x, ac.pos.z) - 1.69;
}

function distToPath(path, x, z) {
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

function head() {
  return fireFront('head');
}

function back() {
  return fireFront('back');
}

/**
 * 0..1: how much of the head's run to the "smoke closes the pad" mark is
 * still to go — 1 where it was at 10:20 (`ahead0`, metres from the pad then),
 * 0 at the mark. The fire-front meter on the tracker and in the medals.
 */
export function headMeter(aheadM, ahead0 = K.head0 || PLACE.line[0].x - PLACE.pad.x - HEAD_START) {
  return Math.max(0, Math.min(1, (aheadM - CLOSE_M) / Math.max(1, ahead0 - CLOSE_M)));
}

/**
 * An on-target drop near the back of the fire slows the whole of it: that
 * stretch is held (the water), and the rest has lost its run. Each one takes
 * it to `diff.slow` of its speed. Returns the new speed.
 */
export function slowBack(front, diff = DIFF.pilot) {
  if (!front) return 0;
  front.setSpeed(front.speed * diff.slow);
  return front.speed;
}

/** Metres from the back of the fire to the road (its nearest column). */
function backToRoad() {
  const f = back();
  if (!f) return Infinity;
  const path = roadPath();
  let best = Infinity;
  const q = { x: 0, z: 0 };
  for (const c of f.cols) {
    f.pointOf(c, q);
    const d = distToPath(path, q.x, q.z);
    if (d < best) best = d;
  }
  return best;
}

/** 0..1 of the back's run to the road still to go. */
function roadMeter() {
  const d = backToRoad();
  return Number.isFinite(d) ? Math.max(0, Math.min(1, (d - ROAD_M) / (K.road0 - ROAD_M || 1))) : 1;
}

/**
 * The stretch of the back of the fire to hit next: of the columns still
 * running (not held by water, not stopped at the road), the one nearest the
 * road; when every one is held, simply the nearest. -1 with no front.
 */
export function backLeadIndex(f, road = roadPath()) {
  if (!f) return -1;
  let best = Infinity;
  let bk = -1;
  let bestAny = Infinity;
  let bkAny = -1;
  const q = { x: 0, z: 0 };
  f.cols.forEach((c, k) => {
    f.pointOf(c, q);
    const d = distToPath(road, q.x, q.z);
    if (d < bestAny) {
      bestAny = d;
      bkAny = k;
    }
    if (!c.held && !c.stopped && d < best) {
      best = d;
      bk = k;
    }
  });
  return bk >= 0 ? bk : bkAny;
}

/** Where the arrow goes in the line beat: water when the bucket is low, the end of the fire nearest the road otherwise. */
const _lead = { x: 0, z: 0, d: 0, k: -1 };
const _tgt = new THREE.Vector3();
function lineTarget() {
  const w = fireWater();
  const t = w.tank;
  if (t && !t.releasing && t.litres < t.capacity * 0.25) return fillPoint(_tgt);
  const f = back();
  if (!f) return null;
  const bk = backLeadIndex(f);
  if (bk < 0) return null;
  f.pointOf(f.cols[bk], _lead);
  // A few metres back into the burning band: the head of it, not the fresh ground ahead.
  let x = _lead.x - f.dir.x * 12;
  let z = _lead.z - f.dir.z * 12;
  // Held there already (no flame left at that edge): the fire nearest to it, wherever it still burns.
  const dn = nearestFire(x, z, _near);
  if (dn > 30 && Number.isFinite(dn)) {
    x = _near.x;
    z = _near.z;
  }
  return _tgt.set(x, ground(x, z) + 40, z);
}
const _near = { x: 0, z: 0 };

/**
 * Nothing left to put water on: the fire is out (or as good as — a couple
 * of cells the crews will walk over). The drop steps count as done then,
 * so a line held early never leaves a step that cannot be finished.
 */
function fireAllOut(sim) {
  const s = fireStatus(sim);
  return !s.live || s.burning <= 2;
}

/* ====================================================================== */
/* the spawn                                                               */
/* ====================================================================== */

/** Departure: Firewatch Base's pad, nose towards the Scarp. */
const BASE_SPAWN = {
  get pos() {
    return new THREE.Vector3(PLACE.base.x, 0, PLACE.base.z);
  },
  headingDeg: 35,
};

/* ====================================================================== */
/* the props: the lookout, the wreck, the marker, the crew                 */
/* ====================================================================== */

function addProps(sim) {
  clearProps(sim);
  const scene = sim.scene;
  const lookout = buildLookout(scene, { x: PLACE.pad.x, z: PLACE.pad.z, r: PLACE.pad.r, name: 'Long Scarp Lookout', cabin: { bearing: 345, dist: 22 } });
  let wreck = null;
  try {
    wreck = buildSentinel({ scorched: true, unit: 4 });
    const y = ground(PLACE.wreck.x, PLACE.wreck.z) + wreck.rest;
    wreck.group.position.set(PLACE.wreck.x, y, PLACE.wreck.z);
    wreck.group.rotation.y = 0.9;
    wreck.group.name = 'story:sentinel-4';
    scene.add(wreck.group);
  } catch (e) {
    console.warn('[story] the SENTINEL unit could not be built; the scar stays empty', e);
  }
  const marker = buildSurveyMarker(scene, PLACE.marker);
  const tarn = buildTarn(scene, PLACE.tarn);
  K.props = { lookout, wreck, marker, tarn };
  return K.props;
}

/** The tarn: dark water in a hollow, a pale rim of gravel, at the height the dip pool says. */
function buildTarn(scene, t) {
  const g = new THREE.Group();
  const water = new THREE.Mesh(new THREE.CircleGeometry(t.r, 36), new THREE.MeshStandardMaterial({ color: 0x24506a, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.92 }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = t.y;
  const rim = new THREE.Mesh(new THREE.RingGeometry(t.r, t.r + 7, 36), new THREE.MeshStandardMaterial({ color: 0x9a8f7c, roughness: 1 }));
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = t.y + 0.03;
  // The hollow's wall below the water line, so the pool reads as sunk into the rim, not laid on it.
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(t.r + 7, t.r + 9, 14, 36, 1, true), new THREE.MeshStandardMaterial({ color: 0x6e6a60, roughness: 1, side: THREE.DoubleSide }));
  wall.position.y = t.y - 7;
  g.add(wall, water, rim);
  g.position.set(t.x, 0, t.z);
  g.name = 'story:tarn';
  scene.add(g);
  return {
    group: g,
    dispose() {
      scene.remove(g);
      for (const m of [water, rim, wall]) {
        m.geometry.dispose();
        m.material.dispose();
      }
    },
  };
}

function clearProps() {
  const p = K.props;
  if (p) {
    for (const k of ['lookout', 'wreck', 'marker', 'tarn']) {
      if (p[k]) {
        try {
          p[k].dispose();
        } catch (e) {
          /* gone */
        }
      }
    }
  }
  K.props = null;
  disposeCrew();
}

/** The two crew on the deck's edge, waving: one walker each (staff/person.js). */
function spawnCrew(sim) {
  disposeCrew();
  const L = K.props && K.props.lookout;
  if (!L) return;
  for (let k = 0; k < 2; k++) {
    const p = createPerson({ outfit: 'firecrew', seed: 31 + k * 7 });
    const side = k ? 1 : -1;
    p.position.set(L.door.x + side * 1.6, L.pad.y + 0.05, L.door.z);
    p.rotation.y = Math.PI; // facing south, down the bench, where you come from
    sim.scene.add(p);
    K.crew.push({ p, state: 'wait', speed: 0, t: k * 0.6 });
  }
}

function disposeCrew() {
  for (const c of K.crew) {
    try {
      disposePerson(c.p);
    } catch (e) {
      /* gone */
    }
  }
  K.crew = [];
}

/** The crew: wave while you come in, then run to the cabin door and climb in, one after the other. */
function updateCrew(sim, dt) {
  const ac = sim.aircraft;
  for (const c of K.crew) {
    c.t += dt;
    if (c.state === 'gone') continue;
    let wave = null;
    let speed = 0;
    if (c.state === 'wait') {
      wave = 'hello';
      // Face the helicopter while it comes in.
      c.p.rotation.y = Math.atan2(-(ac.pos.x - c.p.position.x), -(ac.pos.z - c.p.position.z));
    } else if (c.state === 'run') {
      // To the helicopter's side door: two metres to its left of the middle.
      const h = (ac.heading * Math.PI) / 180;
      const tx = ac.pos.x - Math.cos(h) * 2.2;
      const tz = ac.pos.z - Math.sin(h) * 2.2;
      const dx = tx - c.p.position.x;
      const dz = tz - c.p.position.z;
      const d = Math.hypot(dx, dz);
      if (d < 0.6) {
        c.state = 'gone';
        c.p.visible = false;
        K.boarded++;
        if (K.boarded === 2) sayOnce('c2-crew-4');
        continue;
      }
      speed = 3.2;
      c.p.rotation.y = Math.atan2(-dx, -dz);
      const step = Math.min(d, speed * dt);
      c.p.position.x += (dx / d) * step;
      c.p.position.z += (dz / d) * step;
      c.p.position.y = ground(c.p.position.x, c.p.position.z) + 0.05;
    }
    try {
      posePerson(c.p, dt, { speed, wave });
    } catch (e) {
      /* a pose that fails leaves them standing */
    }
  }
}

function crewGo() {
  K.crew.forEach((c, k) => {
    if (c.state === 'wait') {
      c.state = 'queued';
      // One then the other, a beat apart.
      setTimeoutGame(k * 1.2, () => {
        if (c.state === 'queued') c.state = 'run';
      });
    }
  });
}

/** A delay in game seconds, on the chapter's own clock (nothing runs on while paused). */
function setTimeoutGame(sec, fn) {
  later(K.t + sec, fn);
}

/* ====================================================================== */
/* the hand-held camera                                                    */
/* ====================================================================== */

function tapButton() {
  if (K.tapBtn) return K.tapBtn;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'sz-tapphoto';
  b.textContent = 'PHOTO';
  Object.assign(b.style, {
    position: 'fixed', right: '18px', bottom: '34%', zIndex: 31, pointerEvents: 'auto', display: 'none',
    padding: '14px 18px', borderRadius: '999px', border: '2px solid #ffbf47', background: 'rgba(6,10,18,0.8)', color: '#ffd98a',
    font: '800 14px/1 var(--font, sans-serif)', letterSpacing: '0.16em', cursor: 'pointer',
  });
  b.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    snap(K.api.sim);
  });
  extLayer().appendChild(b);
  K.tapBtn = b;
  return b;
}

/** Close enough, low enough and steady enough for the picture. */
function photoReady(sim) {
  const ac = sim.aircraft;
  return dist2D(ac.pos, PLACE.wreck) <= K.diff.photoRange && skids(ac) <= K.diff.photoAgl && ac.groundSpeed < 7;
}

function snap(sim) {
  if (K.beat !== 'line' || K.photo) return false;
  const r = sim.runner;
  if (!r || !r.step || (r.step.id !== 'photo' && r.step.id !== 'scar')) return false;
  if (!photoReady(sim)) {
    const ac = sim.aircraft;
    const d = dist2D(ac.pos, PLACE.wreck);
    if (d > K.diff.photoRange) K.api.notify(`Closer — ${Math.round(d)} m. Get over it, inside ${K.diff.photoRange} m.`, 'warn', 1.8);
    else if (skids(ac) > K.diff.photoAgl) K.api.notify('Lower — come down over it.', 'warn', 1.8);
    else K.api.notify('Steady — stop over it first.', 'warn', 1.8);
    return true;
  }
  K.photo = true;
  K.photoT = K.api.playT;
  K.photoAt = K.t;
  K.api.lowerThird('PHOTO · SENTINEL · RANGE SAFETY UNIT 4 · KITTIWAKE', 4);
  K.api.say('c2-lark-3');
  later(K.t + 2.6, 'c2-lark-4');
  return true;
}

/* ====================================================================== */
/* BEAT A — the lookout                                                    */
/* ====================================================================== */

/**
 * Light this chapter's fire (the pad is already in the world, so its deck
 * classifies as unburnable), with the bucket armed and the panel hidden
 * until the line beat. Whatever the last flight hung off the airframe goes.
 */
function setupChapterFire(ctx) {
  ctx.ac.extraMass = 0;
  return setupFire(ctx, fireSpec(K.diff));
}

export const LOOKOUT = {
  id: 'story-ch02-lookout',
  name: 'Fire Line',
  short: 'Chapter 2 — the lookout',
  game: 'story',
  hidden: true,
  difficulty: 'Medium',
  icon: '🔥',
  category: 'story',
  map: 'firewatch',
  aircraft: 'harrier',
  blurb: 'Signal Zero, chapter 2.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 12, windDirDeg: WIND_FROM },
  spawn: BASE_SPAWN,
  startLabel: 'Departure',
  onStart(ctx) {
    enterLookout(ctx);
  },
  tick(ctx, dt) {
    tickLookout(ctx, dt);
  },
  failIf(ctx) {
    const f = head();
    if (!f) return null;
    const ahead = f.aheadOf(PLACE.pad);
    if (!K.touchedPad && ahead < CLOSE_M) return LINES['c2-fail-smoke'].text;
    if (K.touchedPad && ahead < PAD_M && ctx.ac.onGround && dist2D(ctx.ac.pos, PLACE.pad) < 30) return LINES['c2-fail-pad'].text;
    return null;
  },
  steps: [
    {
      id: 'climb',
      text: 'Lift off and head for the Long Scarp. The lookout is on the bench, 430 m up.',
      get hint() {
        return `Hold ${keyName('heliUp')} to lift, then ${keyName('heliForward')} to fly. The arrow points at the lookout.`;
      },
      hintEvery: 30,
      checkpoint: 'Below the Scarp',
      targetLabel: 'Long Scarp Lookout',
      target: () => padTarget(),
      check: (ctx) => dist2D(ctx.ac.pos, PLACE.pad) < 1250 && !ctx.ac.onGround,
    },
    {
      id: 'approach',
      text: 'Climb up the Scarp to the lookout pad — the fire is running up the bench at it.',
      hint: 'Hold Shift on the way up: arrive above the bench, not below its edge.',
      hintEvery: 25,
      checkpoint: 'Short of the pad',
      targetLabel: 'Long Scarp Lookout',
      target: () => padTarget(),
      enter() {
        if (!K.api.isResume) K.api.say('c2-crew-2');
      },
      check: (ctx) => dist2D(ctx.ac.pos, PLACE.pad) < 320,
    },
    {
      id: 'land',
      text: 'Land on the lookout pad before the smoke closes it.',
      get hint() {
        return `Stop over the H first, then hold ${keyName('heliDown')} to set it down.`;
      },
      hintEvery: 20,
      rolling: true,
      checkpoint: 'On the pad',
      targetLabel: 'Lookout pad',
      target: () => padTarget(0),
      enter() {
        // The owner's rule: you land, you land — it counts the moment the skids are on the deck.
        K.dwell = makeDwell(LANDING_HOLD);
        // Cutscene (a): the title card as you flare — thin bars, and you keep flying.
        if (!K.api.isResume) K.api.titleCard({ over: 'Chapter 2', main: 'FIRE LINE', sub: 'FIREWATCH RIDGE · 10:20', dur: 4, bars: 'thin' });
      },
      check: (ctx, dt) => {
        const ac = ctx.ac;
        const on = ac.onGround && !ac.crashed && dist2D(ac.pos, PLACE.pad) <= PLACE.pad.r + 3;
        if (on) K.touchedPad = true;
        return !!(K.dwell && K.dwell.tick(dt || 1 / 30, on, ac.crashed));
      },
    },
    {
      id: 'board',
      text: 'Hold it on the pad while the crew climb in.',
      hint: 'Hands off — it sits on its skids. They are running to the door.',
      checkpoint: 'Crew aboard',
      targetLabel: 'Lookout pad',
      target: () => padTarget(0),
      enter(ctx) {
        if (!K.api.isResume) K.api.say('c2-crew-3');
        crewGo();
        ctx.data.boardWarn = 0;
      },
      check: (ctx, dt) => {
        if (!ctx.ac.onGround && K.boarded < 2) {
          ctx.data.boardWarn = (ctx.data.boardWarn || 0) - (dt || 0);
          if (ctx.data.boardWarn <= 0) {
            ctx.sim.hud.notify('They are not in yet — set it back down on the pad.', 'warn', 3);
            ctx.data.boardWarn = 4;
          }
          return false;
        }
        return K.boarded >= 2;
      },
      onDone(ctx) {
        ctx.ac.extraMass = (ctx.ac.extraMass || 0) + CREW_KG * 2;
      },
    },
    {
      id: 'lift',
      text: 'Lift them out — climb away from the smoke.',
      get hint() {
        return `${keyName('heliUp')} to climb, then fly clear of the bench.`;
      },
      checkpoint: false, // a few seconds; the next beat's start is the checkpoint
      targetLabel: 'The tarn',
      target: () => fillPoint(_inlet),
      enter() {
        if (!K.api.isResume) K.api.say('c2-lark-2');
      },
      check: (ctx) => !ctx.ac.onGround && skids(ctx.ac) > 30 && dist2D(ctx.ac.pos, PLACE.pad) > 90,
      onDone() {
        const f = head();
        K.meterAtLift = f ? headMeter(f.aheadOf(PLACE.pad)) : 0;
      },
    },
  ],
  onComplete() {
    // Straight into the line beat, in the same flight, with this fire.
    K.handoff = true;
  },
  score: () => Math.round(40 + 60 * (K.meterAtLift || 0)),
  save() {
    const h = head();
    const b = back();
    return {
      t: K.t,
      head: h ? h.save() : null,
      back: b ? b.save() : null,
      touchedPad: K.touchedPad,
      boarded: K.boarded,
      meterAtLift: K.meterAtLift,
      fileFound: K.fileFound,
      said: Object.keys(K.said),
    };
  },
  resume(state, ctx) {
    if (!state) return;
    K.t = state.t || 0;
    K.touchedPad = !!state.touchedPad;
    K.meterAtLift = state.meterAtLift ?? null;
    K.fileFound = !!state.fileFound || K.fileFound;
    for (const id of state.said || []) K.said[id] = true;
    restoreFronts(state);
    K.boarded = state.boarded || 0;
    if (K.boarded >= 2) {
      for (const c of K.crew) {
        c.state = 'gone';
        c.p.visible = false;
      }
      ctx.ac.extraMass = (ctx.ac.extraMass || 0) + CREW_KG * 2;
    }
  },
};

/** The pad, a little above its deck (the arrow, the beacon). */
const _pad = new THREE.Vector3();
const _inlet = new THREE.Vector3();
function padTarget(up = 25) {
  const L = K.props && K.props.lookout;
  const y = L ? L.pad.y : ground(PLACE.pad.x, PLACE.pad.z);
  return _pad.set(PLACE.pad.x, y + up, PLACE.pad.z);
}

function restoreFronts(state) {
  const h = head();
  const b = back();
  if (h && state.head) h.restore(state.head);
  if (b && state.back) b.restore(state.back);
}

function enterLookout(ctx) {
  const sim = ctx.sim;
  K.beat = 'lookout';
  K.t = 0;
  K.timeline = [];
  K.said = {};
  K.boarded = 0;
  K.touchedPad = false;
  K.meterAtLift = null;
  K.dwell = null;
  K.hitsBase = 0;
  K.dropsBase = 0;
  K.handoff = false;
  K.photo = false;
  K.treetop = false;
  K.windSwing = null;
  sim.weather.windDirDeg = WIND_FROM;
  addProps(sim);
  setupChapterFire(ctx);
  spawnCrew(sim);
  K.road0 = Math.max(ROAD_M + 1, backToRoad());
  const h0 = head();
  K.head0 = h0 ? h0.aheadOf(PLACE.pad) : 0;
  if (!K.api.isResume) {
    later(1.0, 'c2-fw-1');
    later(5.5, 'c2-crew-1');
    later(10.5, 'c2-mara-1');
    later(15.5, 'c2-lark-1');
  }
}

function tickLookout(ctx, dt) {
  const sim = ctx.sim;
  K.t += dt;
  runTimeline();
  updateCrew(sim, dt);
  checkFile(sim);
  const f = head();
  if (f && !K.touchedPad) {
    const m = headMeter(f.aheadOf(PLACE.pad));
    if (m < 0.22 && !K.said['c2-mara-2']) sayOnce('c2-mara-2');
  }
}

/* ====================================================================== */
/* BEAT B — the line                                                       */
/* ====================================================================== */

function dropStepN(n) {
  const base = dropStep();
  return {
    ...base,
    id: `drop-${n}`,
    text: n === 1
      ? `Hold the line: hit the end of the fire nearest the road. ${keyName('drop')} drops the bucket when the ring goes green.`
      : `Hold the line: drop ${n} of ${DROPS_NEEDED} before the fire reaches the road.`,
    hint: 'Low and slow over the flames nearest the road. Let go just before them — the water keeps moving forward.',
    hintEvery: 25,
    // A full bucket climbs the 430 m from the inlet at about 5 m/s: a long stretch, saved as it goes.
    rolling: true,
    checkpoint: `After drop ${n}`,
    get targetLabel() {
      return base.targetLabel;
    },
    target: () => lineTarget(),
    check: (ctx) => {
      if (K.hits >= n) return true;
      if (fireAllOut(ctx.sim)) {
        if (!K.said.allOut) {
          K.said.allOut = true;
          K.api.notify('That is the last of it out — nothing left to hit.', 'good', 4);
        }
        return true;
      }
      return false;
    },
  };
}

function fillStepN(n) {
  const base = fillStep({});
  return {
    ...base,
    id: `fill-${n}`,
    text: n === 1
      ? 'Fill the bucket in the tarn on the bench: hover low over it until the bucket dips in and fills.'
      : 'Back to the tarn and fill up again.',
    hint: 'The fire panel on the right tells you how high the bucket is over the water.',
    hintEvery: 25,
    rolling: true,
    checkpoint: n === 1 ? 'Bucket full' : `Bucket full again (${n})`,
    targetLabel: 'The tarn',
    target: () => fillPoint(_inlet),
    enter: undefined,
    check: (ctx) => {
      const s = fireStatus(ctx.sim);
      // A drop already in hand counts as a fill (the next step wants the hit); so does a fire with nothing left.
      return s.fraction > 0.85 || K.hits >= n || fireAllOut(ctx.sim);
    },
  };
}

export const LINE = adapt(BASE, {
  id: 'story-ch02-line',
  name: 'Fire Line',
  short: 'Chapter 2 — the line',
  game: 'story',
  hidden: true,
  category: 'story',
  difficulty: 'Medium',
  map: 'firewatch',
  aircraft: 'harrier',
  blurb: 'Signal Zero, chapter 2.',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 12, windDirDeg: WIND_FROM },
  // A fresh start of this beat (a retry with no pose): over the bench, clear of the smoke.
  spawn: {
    get pos() {
      return new THREE.Vector3(PLACE.pad.x + 60, 0, PLACE.pad.z + 140);
    },
    headingDeg: 210,
    speed: 8,
    get altAGL() {
      return 60;
    },
  },
  continues: true,
  startLabel: 'Clear of the smoke',
  fire: undefined,
  parTime: undefined,
  scenes: [
    {
      step: 'start',
      kind: 'fire',
      at: { x: 1060, z: -1960 },
      radius: 90,
      roads: false,
      crews: { fire: 2, ambulance: 0, police: 0 },
      helis: {},
      keepClear: [
        { x: PLACE.pad.x, z: PLACE.pad.z, r: 120 },
        { x: PLACE.inlet.x, z: PLACE.inlet.z, r: 160 },
        { x: PLACE.wreck.x, z: PLACE.wreck.z, r: 120 },
      ],
      avoidRunway: true,
      label: 'Fire trucks',
    },
  ],
  onStart(ctx) {
    enterLine(ctx);
  },
  tick(ctx, dt) {
    tickLine(ctx, dt);
  },
  failIf() {
    if (K.hits < DROPS_NEEDED && backToRoad() < ROAD_M) return LINES['c2-fail-road'].text;
    return null;
  },
  steps: [
    fillStepN(1),
    dropStepN(1),
    fillStepN(2),
    dropStepN(2),
    fillStepN(3),
    dropStepN(3),
    {
      id: 'scar',
      text: 'There is something in the burn scar. Fly over it, low and slow.',
      hint: 'The arrow points at it — at the east end of the bench, in the black.',
      hintEvery: 25,
      checkpoint: 'Over the burn scar',
      targetLabel: 'The object',
      target: () => wreckTarget(),
      enter() {
        if (!K.api.isResume) {
          K.api.say('c2-crew-5');
          later(K.t + 4, 'c2-mara-4');
        }
      },
      check: (ctx) => dist2D(ctx.ac.pos, PLACE.wreck) < K.diff.photoRange + 40 && skids(ctx.ac) < K.diff.photoAgl + 40,
    },
    {
      id: 'photo',
      get text() {
        return `Hover over it and take the photo — press ${keyName('storyPhoto') || 'SPACE'}.`;
      },
      hint: 'Stop over it, come down low, then take the picture.',
      hintEvery: 20,
      checkpoint: 'Photographed it',
      targetLabel: 'The object',
      target: () => wreckTarget(),
      check: () => K.photo && K.t - (K.photoAt ?? K.t) > 4.5,
    },
  ],
  onComplete() {
    /* the director plays the burn scar and goes to the debrief */
  },
  score: () => Math.min(100, 40 + 12 * K.hits),
  save() {
    const h = head();
    const b = back();
    const w = fireWater();
    return {
      t: K.t,
      head: h ? h.save() : null,
      back: b ? b.save() : null,
      hits: K.hits,
      drops: K.drops,
      litres: w.tank ? Math.round(w.tank.litres) : 0,
      filledOnce: !!w.filledOnce,
      meterAtLift: K.meterAtLift,
      treetop: K.treetop,
      fileFound: K.fileFound,
      photo: K.photo,
      swung: !!(K.windSwing && K.windSwing.done),
      said: Object.keys(K.said),
    };
  },
  resume(state, ctx) {
    if (!state) return;
    K.t = state.t || 0;
    restoreFronts(state);
    K.hitsBase = state.hits || 0;
    K.dropsBase = state.drops || 0;
    K.hits = K.hitsBase;
    K.drops = K.dropsBase;
    K.meterAtLift = state.meterAtLift ?? K.meterAtLift;
    K.treetop = !!state.treetop;
    K.fileFound = !!state.fileFound || K.fileFound;
    K.photo = !!state.photo;
    for (const id of state.said || []) K.said[id] = true;
    restoreWater(state.litres || 0, state.filledOnce);
    if (state.swung) {
      ctx.sim.weather.windDirDeg = WIND_SWUNG;
      K.windSwing = { t: 99, done: true };
    }
    const b = back();
    if (b) {
      if (K.hits >= DROPS_NEEDED) b.stop();
      else if (state.back && Number.isFinite(state.back.speed) && state.back.speed > 0 && state.back.speed <= K.diff.back) b.setSpeed(state.back.speed);
      else b.setSpeed(K.diff.back);
    }
  },
});

const _wreck = new THREE.Vector3();
function wreckTarget() {
  return _wreck.set(PLACE.wreck.x, ground(PLACE.wreck.x, PLACE.wreck.z) + 25, PLACE.wreck.z);
}

function enterLine(ctx) {
  const sim = ctx.sim;
  const seamless = K.handoff && !!head();
  K.handoff = false;
  K.beat = 'line';
  if (!seamless) {
    // A fresh start of this beat (a restart, or a resume — resume() lays the saved fire over this).
    K.timeline = [];
    K.said = {};
    K.t = 0;
    K.hitsBase = 0;
    K.dropsBase = 0;
    K.hits = 0;
    K.drops = 0;
    K.photo = false;
    K.treetop = false;
    addProps(sim);
    setupChapterFire(ctx);
    const h0 = head();
    K.head0 = h0 ? h0.aheadOf(PLACE.pad) : K.head0;
    // The crew are already aboard on any start of this beat.
    for (const c of K.crew) {
      c.state = 'gone';
      c.p.visible = false;
    }
    K.boarded = 2;
    ctx.ac.extraMass = (ctx.ac.extraMass || 0) + CREW_KG * 2;
    if (K.meterAtLift == null) K.meterAtLift = 0.3;
  } else {
    // The same fire: hits and drops so far are this flight's.
    const s = fireStatus(sim);
    K.hitsBase = K.hits - s.hits;
    K.dropsBase = K.drops - s.drops;
  }
  K.road0 = Math.max(ROAD_M + 1, K.road0 || backToRoad());
  setFireHud(true);
  tapButton();
  // The wind swings west over half a minute, and the back of the fire runs at the road.
  K.windSwing = K.windSwing && K.windSwing.done ? K.windSwing : { t: 0, done: false, from: sim.weather.windDirDeg };
  const b = back();
  if (b && K.hits < DROPS_NEEDED) b.setSpeed(K.diff.back);
  if (!K.api.isResume) {
    later(K.t + 1.5, 'c2-fw-2');
    later(K.t + 6.5, 'c2-mara-3');
  }
}

function tickLine(ctx, dt) {
  const sim = ctx.sim;
  K.t += dt;
  runTimeline();
  checkFile(sim);
  // The wind backing round: from the east to the west over 30 s, the short way round through north.
  const ws = K.windSwing;
  if (ws && !ws.done) {
    ws.t += dt;
    const k = Math.min(1, ws.t / 30);
    const e = k * k * (3 - 2 * k);
    const from = ws.from ?? WIND_FROM;
    const span = ((WIND_SWUNG - from + 540) % 360) - 180;
    sim.weather.windDirDeg = (from + span * e + 360) % 360;
    if (k >= 1) ws.done = true;
  }
  // Drops and hits: this flight's water, plus what a checkpoint brought back.
  const s = fireStatus(sim);
  const w = fireWater();
  if (w.tank && w.tank.releasing && !K.lastReleasing) {
    // The moment it lets go: how far above the treetops the bucket was.
    const bp = w.bucket;
    if (bp) {
      // Over the planted wood the canopy is the trees' height; over grass it is the ground.
      const canopy = dist2D(bp, PLACE.woods) < PLACE.woods.r ? CANOPY_M : 0;
      K.lastDropAgl = bp.y - ground(bp.x, bp.z) - canopy;
      K.lastDropAt = { x: bp.x, z: bp.z };
    } else {
      K.lastDropAgl = null;
      K.lastDropAt = { x: sim.aircraft.pos.x, z: sim.aircraft.pos.z };
    }
  }
  K.lastReleasing = !!(w.tank && w.tank.releasing);
  const hitsNow = K.hitsBase + s.hits;
  K.drops = K.dropsBase + s.drops;
  if (hitsNow > K.hits) {
    K.hits = hitsNow;
    if (K.lastDropAgl != null && K.lastDropAgl < 20 && !K.treetop) {
      K.treetop = true;
      K.api.style('treetop', 'Treetop');
      K.api.say('c2-fw-7');
    }
    // On the back of the fire (not the head's embers up the bench): it slows.
    const b = back();
    if (b && K.hits < DROPS_NEEDED && K.lastDropAt && b.distanceTo(K.lastDropAt) < 140) slowBack(b, K.diff);
    if (K.hits === 1) sayOnce('c2-fw-4');
    else if (K.hits === 2) sayOnce('c2-fw-5');
    else if (K.hits === DROPS_NEEDED) {
      sayOnce('c2-fw-6');
      const b = back();
      if (b) b.stop();
    }
  }
  if (s.fraction > 0.85 && !K.said['c2-fw-3'] && K.hits === 0) sayOnce('c2-fw-3');
  // The tap button for touch screens: only while the shot is on.
  if (K.tapBtn) {
    const r = sim.runner;
    const want = !!(sim.touch && !K.photo && r && r.step && (r.step.id === 'photo' || r.step.id === 'scar') && dist2D(sim.aircraft.pos, PLACE.wreck) < K.diff.photoRange + 30);
    K.tapBtn.style.display = want ? 'block' : 'none';
    if (want) K.tapBtn.style.borderColor = photoReady(sim) ? '#7ee8b2' : '#ffbf47';
  }
}

/** File 02: hover low over the survey marker in the scar. */
function checkFile(sim) {
  if (K.fileFound || !K.props || !K.props.marker) return;
  const ac = sim.aircraft;
  if (dist2D(ac.pos, K.props.marker.pos) < 26 && skids(ac) < 45) {
    K.fileFound = true;
    K.api.foundFile('f02');
    K.api.say('c2-lark-5');
  }
}

/* ====================================================================== */
/* cutscene (b): the burn scar                                             */
/* ====================================================================== */

function disposeThornefield() {
  if (K.tf && K.tf.f) {
    try {
      K.tf.f.dispose();
    } catch (e) {
      /* gone */
    }
  }
  K.tf = null;
  for (const m of K.tfMen) {
    try {
      disposePerson(m.p);
    } catch (e) {
      /* gone */
    }
  }
  K.tfMen = [];
  if (K.tfCase) {
    try {
      K.tfCase.dispose();
    } catch (e) {
      /* gone */
    }
  }
  K.tfCase = null;
  if (K.priya) {
    try {
      disposePerson(K.priya.p);
    } catch (e) {
      /* gone */
    }
  }
  K.priya = null;
}

/**
 * Cutscene (b), as its CAPTION AND LINES ONLY — the Skip-cinematics path,
 * for everyone (2026-11-08). The camera rail over the burn scar read 17 %
 * of the screen to the flicker probe (the fire road's tape on the skyline,
 * then a last 4.5 % from a mesh against the sky this pass could not name),
 * and a class demo cannot carry that. So: the crews have the fire; a
 * caption says what happens in the scar; Thornefield and Priya speak over
 * the helicopter's own hover view, which the probe passes (0.4 %). The
 * helicopter landing and the walk up the road wait for a flash-safe scene.
 */
const SCENE_LINES = [
  [0.6, 'c2-s-tf-1'],
  [4.0, 'c2-s-lark-1'],
  [7.2, 'c2-s-tf-2'],
  [10.2, 'c2-s-priya-1'],
  [13.2, 'c2-s-priya-2'],
];
const SCENE_SECONDS = 16.5;

function burnScarScene(api) {
  fireCrewsTakeOver();
  const hidden = hideFireFx(true);
  api.caption('In the burn scar, a Thornefield helicopter lands: "We will take it from here." A reporter walks up the fire road.', 5);
  return new Promise((resolve) => {
    K.scene = { t: 0, said: new Set(), resolve };
  }).then((how) => {
    hideFireFx(false, hidden);
    return how;
  });
}

/** The scene's clock: its lines at their moments, and the end. Skip (the cinema's key) ends it early. */
function tickScene(api, dt) {
  const sc = K.scene;
  if (!sc) return;
  sc.t += dt;
  for (const [at, id] of SCENE_LINES) {
    if (sc.t >= at && !sc.said.has(id)) {
      sc.said.add(id);
      api.say(id);
    }
  }
  if (sc.t >= SCENE_SECONDS || sc.skip) {
    K.scene = null;
    sc.resolve(sc.skip ? 'skipped' : 'ended');
  }
}

/** For the tests and the skip key: end the scene now. */
export function skipScene() {
  if (K.scene) K.scene.skip = true;
}

/** Hide (or put back) the fire's moving layers — flames, smoke, embers, drops — for a cutscene. */
function hideFireFx(hide, prev = null) {
  const wd = wildfireDebug();
  const out = [];
  // The fill mark and the aim ring too, and the fire road's tape (breakLine): with the camera low in
  // the scar the tape runs along the skyline, and its moving dashes were 13 % of the screen to the
  // flicker probe (18 % → 4.5 % with it hidden, measured 2026-11-08).
  for (const k of ['flames', 'plumes', 'embers', 'drops', 'fillMark', 'aim', 'breakLine']) {
    const o = wd[k] && (wd[k].mesh || wd[k].points || wd[k].group);
    if (!o) continue;
    if (hide) {
      out.push({ o, was: o.visible });
      o.visible = false;
    }
  }
  if (!hide && prev) for (const e of prev) e.o.visible = e.was;
  return out;
}

/* ====================================================================== */
/* medals                                                                  */
/* ====================================================================== */

/**
 * The bible's table: bronze, the crew out and three drops; silver, the fire
 * meter still above 30 % at the lift-out and four on-target drops; gold,
 * above 50 %, five on-target drops and under six minutes.
 */
export function verdict(k) {
  const meter = Math.max(0, Math.min(1, k.meterAtLift || 0));
  const hits = k.hits || 0;
  const time = k.time || 0;
  const crewOut = k.crewOut !== false;
  const score = Math.round(Math.max(0, Math.min(100, 45 * meter + 7 * Math.min(5, hits) + (time > 0 && time < GOLD_SECONDS ? 20 : time < GOLD_SECONDS * 1.4 ? 10 : 0))));
  let medal = 'bronze';
  if (crewOut && meter > 0.3 && hits >= 4) medal = 'silver';
  if (crewOut && meter > 0.5 && hits >= 5 && time > 0 && time < GOLD_SECONDS) medal = 'gold';
  const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  return {
    medal,
    score,
    breakdown: [
      { label: 'Fire meter at the lift-out', value: `${Math.round(meter * 100)}% (silver > 30%, gold > 50%)` },
      { label: 'On-target drops', value: `${hits} of ${k.drops || hits} (silver 4, gold 5)` },
      { label: 'Time', value: time ? `${mmss(time)} (gold under ${mmss(GOLD_SECONDS)})` : '—' },
      { label: 'Treetop', value: k.treetop ? 'a drop under 20 m over the canopy' : '—' },
      { label: 'The object', value: k.photo ? 'photographed' : '—' },
    ],
    note: medal === 'gold'
      ? 'Ahead of the wall and on the line. That is a morning’s work.'
      : medal === 'silver'
        ? 'A clean rescue. Land above half on the meter and make it five drops under six minutes for gold.'
        : 'The crew are out and the road held. Replay to land sooner and put more water on it.',
  };
}

/* ====================================================================== */
/* the chapter                                                             */
/* ====================================================================== */

export const CHAPTER_2 = {
  id: 'ch02-fire-line',
  beats: [LOOKOUT, LINE],
  objectives: [
    'Fly to the Long Scarp lookout',
    'Land on the lookout pad before the smoke closes it',
    'Lift the crew out',
    'Fill the bucket in the inlet',
    `Hold the line: ${DROPS_NEEDED} drops before the fire reaches the road`,
    'Hover over the object in the burn scar and photograph it',
  ],
  briefing: {
    line: 'Firewatch Ridge · 10:20 · hot and gusty · Skyhook H-3 with a bucket · about 7 minutes',
    bullets: [
      'Something came down burning on the Long Scarp overnight. Two crew are cut off at the lookout.',
      'The fire is running up the bench at them. Land on the pad before the smoke closes it.',
      'Then fill the bucket in the tarn on the bench and hold the fire off the road — three good drops.',
    ],
    route: [
      [PLACE.base.x, PLACE.base.z, 'Firewatch Base'],
      [PLACE.pad.x, PLACE.pad.z, 'the lookout'],
      [PLACE.tarn.x, PLACE.tarn.z, 'the tarn'],
      [PLACE.wreck.x + 220, PLACE.wreck.z, 'the fire road'],
    ],
  },
  enterChapter(api) {
    K.api = api;
    K.diff = DIFF[api.difficulty] || DIFF.pilot;
    K.beat = null;
    K.t = 0;
    K.timeline = [];
    K.said = {};
    K.hits = 0;
    K.drops = 0;
    K.hitsBase = 0;
    K.dropsBase = 0;
    K.meterAtLift = null;
    K.treetop = false;
    K.photo = false;
    K.photoAt = null;
    K.fileFound = !!(api.data && api.data.flags.files.includes('f02'));
    K.handoff = false;
    K.trackT = 0;
    api.tracker(trackerItems(api), 'Chapter 2 · Fire Line');
  },
  leaveChapter(api) {
    clearProps(api.sim);
    disposeThornefield();
    if (K.tapBtn) K.tapBtn.style.display = 'none';
    const sim = api.sim;
    if (sim && sim.aircraft) sim.aircraft.extraMass = 0;
    K.beat = null;
    if (K.scene) {
      K.scene.resolve('left');
      K.scene = null;
    }
  },
  onBeatDone() {
    /* both beats keep their numbers in K */
  },
  finale(api) {
    return burnScarScene(api);
  },
  medal(api) {
    return verdict({ meterAtLift: K.meterAtLift, hits: K.hits, drops: K.drops, time: api.playT, treetop: K.treetop, photo: K.photo, crewOut: K.boarded >= 2 });
  },
  onFail(api, f) {
    if (/crash|flew into|came down|hit the/i.test(f.reason || '')) api.say('c2-fail-crash');
  },
  update(api, dt) {
    K.trackT += dt;
    if (K.trackT >= 0.25) {
      K.trackT = 0;
      api.tracker(trackerItems(api));
    }
    tickScene(api, dt);
  },
  /** SPACE takes the photo over the wreck; otherwise the key is the game's. */
  key(api, code, down, e) {
    const sim = api.sim;
    if (!down || K.beat !== 'line' || K.photo) return false;
    const r = sim.runner;
    if (!r || !r.step || (r.step.id !== 'photo' && r.step.id !== 'scar')) return false;
    if (!isKey(sim, 'storyPhoto', code) || playerClaimed(sim, code, 'storyPhoto')) return false;
    if (e && e.repeat) return true;
    snap(sim);
    return true;
  },
  /** For the tests. */
  _state: K,
};

function trackerItems(api) {
  const sim = api.sim;
  const r = sim.runner;
  const step = r && r.step ? r.step.id : null;
  const ac = sim.aircraft;
  const order = ['climb', 'approach', 'land', 'board', 'lift'];
  const lineOrder = ['fill-1', 'drop-1', 'fill-2', 'drop-2', 'fill-3', 'drop-3', 'scar', 'photo'];
  const inA = K.beat === 'lookout';
  const ai = inA ? order.indexOf(step) : 9;
  const bi = K.beat === 'line' ? lineOrder.indexOf(step) : -1;
  const item = (text, state, extra = {}) => ({ text, state, ...extra });
  const f = head();
  const ahead = f ? f.aheadOf(PLACE.pad) : null;
  const meter = ahead != null ? headMeter(ahead) : null;
  const s = fireStatus(sim);
  const toPad = ac ? dist2D(ac.pos, PLACE.pad) : 0;
  const items = [
    item(CHAPTER_2.objectives[0], ai >= 2 ? 'done' : inA ? 'active' : 'todo', inA && ai <= 1 ? { note: `${(toPad / 1000).toFixed(1)} km to the pad` } : {}),
    item(CHAPTER_2.objectives[1], ai >= 3 ? 'done' : ai === 2 ? 'active' : 'todo',
      inA && !K.touchedPad && meter != null ? { meter, note: `fire ${Math.max(0, Math.round(ahead - CLOSE_M))} m from closing the pad` } : K.meterAtLift != null ? { note: `meter at the lift-out ${Math.round(K.meterAtLift * 100)}%` } : {}),
    item(CHAPTER_2.objectives[2], K.beat === 'line' ? 'done' : ai >= 3 ? 'active' : 'todo', ai === 3 ? { note: `${K.boarded} of 2 aboard` } : {}),
    item(CHAPTER_2.objectives[3], bi > 0 || K.hits > 0 ? 'done' : K.beat === 'line' ? 'active' : 'todo', K.beat === 'line' && bi <= 0 ? { note: `bucket ${Math.round((s.fraction || 0) * 100)}%` } : {}),
    item(CHAPTER_2.objectives[4], K.hits >= DROPS_NEEDED ? 'done' : K.beat === 'line' ? 'active' : 'todo',
      K.beat === 'line' && K.hits < DROPS_NEEDED ? { meter: roadMeter(), note: `${K.hits} of ${DROPS_NEEDED} · fire ${Math.round(Math.max(0, backToRoad() - ROAD_M))} m from the road` } : K.hits ? { note: `${K.hits} on target` } : {}),
    item(CHAPTER_2.objectives[5], K.photo ? 'done' : bi >= 6 ? 'active' : 'todo', bi >= 6 && !K.photo && ac ? { note: `${Math.round(dist2D(ac.pos, PLACE.wreck))} m · ${Math.round(skids(ac))} m up` } : {}),
  ];
  return items;
}

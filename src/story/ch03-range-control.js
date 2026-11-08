/**
 * SIGNAL ZERO — CHAPTER 3: RANGE CONTROL
 * Aurora Fjords · 17:50, dusk into night · cloud layers, cold · Kestrel Courier · about 7 min
 *
 * A time-critical medical run to Aurora Field: chilled insulin, smooth and on
 * time. Over the old corridor the radio drops onto a frequency nobody uses and
 * a flat voice speaks: ATTENTION AIRCRAFT. YOU ARE INSIDE RANGE KITTIWAKE.
 * A shape slides out of the cloud and sits on your left wing with no lights,
 * rocks its wings — a by-the-book intercept, "follow me", out to sea. You have
 * insulin to deliver. Get below the ridgelines in the fjord and lose it. Then
 * Aurora Approach: "I have no traffic on radar. Say again?"
 *
 * BUILT ON (story-bible.md §6, "Reuses"):
 *   - the Aurora Fjords map and its field (runway 09/27 at the origin, the
 *     North Wall and the South Wall either side of a low shelf);
 *   - the SENTINEL unit (story/sentinel.js) in its 1986 livery, flying: the
 *     same machine that lay scorched in chapter 2's burn scar;
 *   - the terrain line-of-sight test from game/pursuer.js (a dozen samples
 *     of heightAt between the two of you, at 10 Hz);
 *   - the landing rule every mission uses (beats.js landedAndStopped →
 *     landing-zone.js), on runway 27 — the fjord runs you in from the east;
 *   - the letterbox, cards, dialogue and cutscene: story/cinema.js.
 *
 * NEW HERE:
 *   - RANGE CONTROL's voice (the script's `range` cast: capitals, a red
 *     name tag, the dialogue box's monospace "screen" look);
 *   - the SHEPHERD: a formation-keeper, not a chaser. It joins on your left
 *     wing, rocks its wings, then herds — it never touches, never shoots,
 *     and it never descends below the ridge band ("it watches the sky, not
 *     the valleys", the line Teague gives in chapter 9);
 *   - the LOCK meter: fills while it can see you, drains while you are below
 *     the ridgelines inside the fjord or the ground is between you;
 *   - the CARGO: a smoothness meter — hard g, steep bank, the shape's wake
 *     and a firm touchdown each cost a little — and the insulin clock;
 *   - the danger-area overlay: the red-hatched range on the minimap, which
 *     the rest of the story reuses;
 *   - the old range radar head on the north point (File 03).
 *
 * Two beats, one flight: the CORRIDOR (cruise · the voice · the shape ·
 * lose it) and HOME (approach · short final · land). Checkpoints: air start
 * · the corridor · the radio voice · the shape on your wing · lost it · on
 * final · short final · landed — never more than about a minute apart.
 */

import * as THREE from '../vendor/three.module.js';
import { RUNWAY } from '../world/airport.js';
import * as Terrain from '../world/terrain.js';
import { landedAndStopped } from './beats.js';
import { LINES } from './script.js';
import { buildSentinel } from './sentinel.js';

const FT = 0.3048;

/* ====================================================================== */
/* the place                                                               */
/* ====================================================================== */

/*
 * Measured on the fjord's height field (2026-11-08): the shelf at the
 * origin is low (under 80 m) from x −1600 to 1400 between z −900 and 700;
 * the North Wall's foot rises past 250 m by z −1100 and the South Wall's by
 * z 800, both to 500-700 m. The sea east of x 1500 is open. The corridor is
 * the old launch line over that sea.
 */
export const PLACE = {
  /** The air start: 6 km east of the fjord mouth, over the sea, heading for Aurora. */
  start: { x: 7800, z: 700, headingDeg: 262, y: 850, speed: 74 },
  /** "The old corridor": where the voice comes. */
  corridor: { x: 4700, z: 380 },
  /** The fjord mouth, and the waypoints up the valley to the field (the arrow in the lose step). */
  mouth: { x: 1900, z: 40 },
  valley: [
    { x: 1500, z: -40 },
    { x: 1000, z: -120 },
  ],
  /** Inside this box, below CEIL_Y, the ridges hide you. */
  fjord: { x0: -1700, x1: 1700, z0: -950, z1: 950 },
  /** The old range radar head on the north point of the mouth (File 03). */
  radar: { x: 1250, z: -620 },
  /** Runway 27's touchdown: 200 m in from the east threshold. */
  get touchdown() {
    return new THREE.Vector3(RUNWAY.thresholdEast ? RUNWAY.thresholdEast.x - 200 : 350, RUNWAY.touchdown.y, RUNWAY.touchdown.z);
  },
  /** Runway 09's touchdown (the game's own): for a pilot who comes out of the fjord past the field. */
  get touchdown09() {
    return RUNWAY.touchdown.clone();
  },
  /**
   * The way round onto 09: a join point 4.8 km west of the field, over the
   * open sea, 420 m up — a 5° slope, because the shelf's western hump stands
   * 50-80 m under the last 1.5 km of that final (measured 2026-11-08).
   */
  get join09() {
    return new THREE.Vector3(RUNWAY.touchdown.x - 4800, RUNWAY.touchdown.y + 420, 0);
  },
};

/** East of this (metres east of 27's touchdown) a pilot is set up for 27; past it, the way home is round onto 09. */
export const STRAIGHT_IN_27_M = 700;

/**
 * Which runway the way home uses from here: 27 straight in from the fjord
 * when you are still east of the field; 09, round over the sea to the west,
 * once you are past it. Pure, for the tests.
 */
export function runwayFor(x, td27x = PLACE.touchdown.x) {
  return x > td27x + STRAIGHT_IN_27_M ? 27 : 9;
}

/** Below this (metres above the sea) inside the fjord you are under the ridgelines. */
export const CEIL_Y = 270;
/** The shape never comes down below this: it watches the sky, not the valleys. */
export const SHAPE_FLOOR_Y = 430;
/** The Low Road style: never above this many metres over the ground in the lose step. */
export const LOW_ROAD_AGL = 152; // 500 ft
export const FILE_REACH_M = 200;
const SHORT_FINAL_M = 2400;
const SLOT = { left: 120, back: 30, up: 18 };

/** What each difficulty changes, and nothing else (story-bible.md §7). */
export const DIFF = {
  story: { clock: 560, lockFill: 26, lockDrain: 5, hideFor: 10, knock: 0.05 },
  pilot: { clock: 430, lockFill: 20, lockDrain: 7, hideFor: 12, knock: 0.08 },
  ace: { clock: 350, lockFill: 15, lockDrain: 9, hideFor: 15, knock: 0.12 },
};

/* ====================================================================== */
/* the chapter's live state                                                */
/* ====================================================================== */

const K = {
  api: null,
  diff: DIFF.pilot,
  t: 0,
  beat: null, // 'corridor' | 'home'
  timeline: [],
  said: {},
  clock: 0, // seconds left on the insulin
  cargo: 1, // 0..1, the smoothness meter
  knockCool: 0,
  lock: 0.35, // 0..1, how well the shape has you
  hiddenT: 0, // cumulative seconds hidden while it was looking
  lost: false,
  lostAt: null,
  shapeAt: null, // chapter seconds when it joined
  maxAglLose: 0,
  lowRoad: false,
  herds: 0,
  shape: null,
  radar: null,
  fileFound: false,
  landing: null,
  goArounds: 0,
  lowPass: false,
  runway: 27, // 27 straight in, or 9 round over the sea
  valleyIx: 0,
  trackT: 0,
  overlayOn: false,
  v: new THREE.Vector3(),
  v2: new THREE.Vector3(),
};

/* ====================================================================== */
/* helpers                                                                 */
/* ====================================================================== */

function groundAt(x, z) {
  try {
    const h = Terrain.heightAt(x, z);
    return Number.isFinite(h) ? Math.max(0, h) : 0;
  } catch (e) {
    return 0;
  }
}

const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function bearing(ax, az, bx, bz) {
  return ((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI + 360) % 360;
}

function adiff(a, b) {
  return ((b - a + 540) % 360) - 180;
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

const mmss = (s) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/* ====================================================================== */
/* the pure rules (tested in node)                                         */
/* ====================================================================== */

/** Inside the fjord's box and under the ridge band. */
export function underRidges(x, y, z, box = PLACE.fjord, ceil = CEIL_Y) {
  return x >= box.x0 && x <= box.x1 && z >= box.z0 && z <= box.z1 && y < ceil;
}

/**
 * Can a thing at `from` see a thing at `to` over the terrain? A dozen
 * samples of the height field along the line (game/pursuer.js's test).
 */
export function lineOfSight(from, to, heightAt = Terrain.heightAt, steps = 12) {
  for (let i = 1; i < steps; i++) {
    const f = i / steps;
    const x = from.x + (to.x - from.x) * f;
    const z = from.z + (to.z - from.z) * f;
    const y = from.y + (to.y - from.y) * f;
    if (heightAt(x, z) > y) return false;
  }
  return true;
}

/**
 * One frame of the lock meter: it fills while the shape has you and drains
 * while you are hidden. Returns the new value, 0..1.
 */
export function lockStep(lock, hidden, dt, diff = DIFF.pilot) {
  const v = hidden ? lock - dt / diff.lockDrain : lock + dt / diff.lockFill;
  return Math.max(0, Math.min(1, v));
}

/**
 * The cargo: hard g, a steep bank, the shape's wake and a firm touchdown each
 * cost a little. Pure: takes the readings, returns { cargo, knockCool, why }.
 */
export function cargoStep(cargo, { gLoad = 1, bankDeg = 0, dt = 0, knockCool = 0, wake = false, touchdownVs = null }, diff = DIFF.pilot) {
  let c = cargo;
  let cool = Math.max(0, knockCool - dt);
  let why = null;
  if (Math.abs(bankDeg) > 70) c -= dt * 0.03;
  if (cool <= 0 && Math.abs(gLoad - 1) > 1.8) {
    c -= 0.06;
    cool = 2;
    why = 'g';
  }
  if (wake) {
    c -= diff.knock;
    why = 'wake';
  }
  if (touchdownVs != null && Math.abs(touchdownVs) > 3.5) {
    c -= 0.1;
    why = 'touchdown';
  }
  return { cargo: Math.max(0, Math.min(1, c)), knockCool: cool, why };
}

/**
 * The bible's table: bronze, delivered; silver, cargo ≥ 80 % and the shape
 * lost in under 90 s; gold, cargo ≥ 95 %, more than 60 s to spare and the
 * Low Road.
 */
export function verdict(k) {
  const cargo = Math.max(0, Math.min(1, k.cargo ?? 0));
  const loseT = k.lostAt != null && k.shapeAt != null ? k.lostAt - k.shapeAt : null;
  const spare = k.clock ?? 0;
  const landing = k.landing ? k.landing.score || 0 : 0;
  const score = Math.round(Math.max(0, Math.min(100, 45 * cargo + (loseT != null ? Math.max(0, 25 - loseT / 6) : 0) + 0.3 * landing)));
  let medal = 'bronze';
  if (cargo >= 0.8 && loseT != null && loseT < 90) medal = 'silver';
  if (cargo >= 0.95 && spare > 60 && k.lowRoad && loseT != null) medal = 'gold';
  return {
    medal,
    score,
    breakdown: [
      { label: 'Cargo', value: `${Math.round(cargo * 100)}% (silver 80%, gold 95%)` },
      { label: 'The shape', value: loseT != null ? `lost in ${Math.round(loseT)} s (silver under 90 s)` : 'never lost it' },
      { label: 'Insulin clock', value: `${mmss(spare)} to spare (gold over 1:00)` },
      { label: 'Low Road', value: k.lowRoad ? 'under 500 ft through the fjord' : '—' },
      { label: 'Landing', value: k.landing ? `${landing}/100 · ${Math.abs(k.landing.vsFpm || 0)} ft/min` : '—' },
    ],
    note: medal === 'gold'
      ? 'Smooth, early, and under the rim the whole way. That is how you lose a ghost.'
      : medal === 'silver'
        ? 'Delivered, and it lost you. Stay under 500 ft in the fjord and land with a minute in hand for gold.'
        : 'The insulin is in the fridge. Replay to keep it smoother and lose the shape sooner.',
  };
}

/* ====================================================================== */
/* the spawn                                                               */
/* ====================================================================== */

const START_SPAWN = {
  get pos() {
    return new THREE.Vector3(PLACE.start.x, 0, PLACE.start.z);
  },
  headingDeg: PLACE.start.headingDeg,
  speed: PLACE.start.speed,
  get altAGL() {
    return Math.max(150, PLACE.start.y - groundAt(PLACE.start.x, PLACE.start.z));
  },
};

/** A fresh start of the home beat (a retry with no pose): 6 km east of 27, lined up, low. */
const HOME_SPAWN = {
  get pos() {
    return new THREE.Vector3(PLACE.touchdown.x + 6000, 0, 0);
  },
  headingDeg: 270,
  speed: 68,
  get altAGL() {
    return Math.max(150, PLACE.touchdown.y + 420 - groundAt(PLACE.touchdown.x + 6000, 0));
  },
};

/* ====================================================================== */
/* the shepherd: a formation-keeper, not a chaser                           */
/* ====================================================================== */

class Shepherd {
  constructor(scene, ac) {
    this.scene = scene;
    this.s = buildSentinel({ scorched: false, unit: 2, scale: 1.15 });
    this.group = this.s.group;
    this.group.name = 'story:shepherd';
    scene.add(this.group);
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = ac.heading;
    this.state = 'join'; // join | formate | herd | leave | gone
    this.t = 0;
    this.rockT = -1;
    this.herdT = 0;
    this.herdDone = false;
    this.losT = 0;
    this.losClear = true;
    this.gone = false;
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    // Out of the cloud: a kilometre ahead and to the left, 300 m above you.
    const h = (ac.heading * Math.PI) / 180;
    const fwd = new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
    const left = new THREE.Vector3(-Math.cos(h), 0, -Math.sin(h));
    this.pos.copy(ac.pos).addScaledVector(fwd, 900).addScaledVector(left, 700);
    this.pos.y = ac.pos.y + 300;
    this.vel.copy(ac.vel);
    this.sync(0);
  }

  /** Where it wants to be: the left-wing slot, or a herding slot across your nose. */
  slot(ac, out) {
    const h = (ac.heading * Math.PI) / 180;
    const fwd = K.v.set(Math.sin(h), 0, -Math.cos(h));
    const left = K.v2.set(-Math.cos(h), 0, -Math.sin(h));
    let side = SLOT.left;
    let ahead = -SLOT.back;
    if (this.state === 'herd') {
      // Across your nose from left to right and back, over about eight seconds.
      const k = Math.min(1, this.herdT / 8);
      const s = Math.sin(k * Math.PI);
      side = SLOT.left - s * (SLOT.left + 90);
      ahead = -SLOT.back + s * 110;
    }
    out.copy(ac.pos).addScaledVector(fwd, ahead).addScaledVector(left, side);
    // Never below the ridge band, never below you, never into a hill.
    out.y = Math.max(ac.pos.y + SLOT.up, SHAPE_FLOOR_Y, groundAt(out.x, out.z) + 120);
    return out;
  }

  /** Can it see you? Terrain between you, or you under the ridges in the fjord, and it cannot. */
  sees(ac, dt) {
    if (underRidges(ac.pos.x, ac.pos.y, ac.pos.z)) return false;
    this.losT -= dt;
    if (this.losT <= 0) {
      this.losT = 0.1;
      this.losClear = lineOfSight(this.pos, ac.pos);
    }
    return this.losClear;
  }

  update(dt, ac) {
    if (this.gone) return;
    this.t += dt;
    const want = this.slot(ac, K.v.clone());
    if (this.state === 'leave') {
      // Up and away to the north, into the cloud, and gone.
      want.copy(this.pos).add(new THREE.Vector3(0, 60, -220));
    }
    // A first-order chase of the slot, carrying your speed, with a top speed.
    const gain = this.state === 'join' ? 0.55 : this.state === 'leave' ? 0.9 : 0.8;
    const desired = want.sub(this.pos).multiplyScalar(gain);
    if (this.state !== 'leave') desired.add(ac.vel);
    const max = this.state === 'leave' ? 150 : 125;
    if (desired.length() > max) desired.setLength(max);
    this.vel.lerp(desired, Math.min(1, dt * 1.6));
    this.pos.addScaledVector(this.vel, dt);
    // Never through the ground.
    const floor = groundAt(this.pos.x, this.pos.z) + 90;
    if (this.pos.y < floor) this.pos.y = floor;
    if (this.vel.lengthSq() > 4) this.heading = ((Math.atan2(this.vel.x, -this.vel.z) * 180) / Math.PI + 360) % 360;
    // Joined: on the slot, or near enough after a dozen seconds of closing (the lag never quite closes at speed).
    if (this.state === 'join' && (this.pos.distanceTo(this.slot(ac, K.v2)) < 160 || this.t > 12)) {
      this.state = 'formate';
      this.t = 0;
    }
    if (this.state === 'herd') {
      this.herdT += dt;
      if (this.herdT >= 8) {
        this.state = 'formate';
        this.herdDone = true;
      }
    }
    if (this.state === 'leave' && (this.t > 40 || this.pos.distanceTo(ac.pos) > 6000)) this.dispose();
    this.sync(dt);
  }

  /** Start the wing-rock (a by-the-book "follow me"). */
  rock() {
    this.rockT = 0;
  }

  herd() {
    if (this.state !== 'formate') return false;
    this.state = 'herd';
    this.herdT = 0;
    return true;
  }

  leave() {
    if (this.state === 'leave' || this.gone) return;
    this.state = 'leave';
    this.t = 0;
  }

  sync(dt) {
    if (!this.group) return;
    this.group.position.copy(this.pos);
    let roll = 0;
    if (this.rockT >= 0) {
      this.rockT += dt;
      roll = Math.sin(this.rockT * 5.2) * 0.55 * Math.max(0, 1 - this.rockT / 4.5);
      if (this.rockT > 4.5) this.rockT = -1;
    }
    const bank = this.state === 'leave' ? -0.35 : 0;
    this._e.set(0, -(this.heading * Math.PI) / 180, roll + bank, 'YXZ');
    this._q.setFromEuler(this._e);
    this.group.quaternion.slerp(this._q, Math.min(1, dt * 4 + (dt === 0 ? 1 : 0)));
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    try {
      this.s.dispose();
    } catch (e) {
      /* gone */
    }
    this.group = null;
  }
}

/* ====================================================================== */
/* the props: the old radar head (File 03) and the danger overlay           */
/* ====================================================================== */

function addRadar(sim) {
  clearRadar(sim);
  const { x, z } = PLACE.radar;
  const y = groundAt(x, z);
  const g = new THREE.Group();
  const conc = new THREE.MeshStandardMaterial({ color: 0x8e9499, roughness: 0.95 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9bec4, roughness: 0.6, metalness: 0.3 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(4.5, 5, 3, 12), conc);
  base.position.y = 1.5;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.7, 7, 8), steel);
  mast.position.y = 6.5;
  const dish = new THREE.Mesh(new THREE.SphereGeometry(4.2, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.6), steel);
  dish.rotation.x = Math.PI / 2 + 0.35;
  dish.position.y = 10.5;
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff6a4a }));
  lamp.position.y = 13.4;
  g.add(base, mast, dish, lamp);
  g.position.set(x, y, z);
  g.name = 'story:radar-head';
  sim.scene.add(g);
  K.radar = { group: g, dish, lamp, t: 0, mats: [conc, steel, lamp.material], geos: [base.geometry, mast.geometry, dish.geometry, lamp.geometry] };
}

function clearRadar(sim) {
  const r = K.radar;
  if (!r) return;
  try {
    sim.scene.remove(r.group);
    for (const m of r.mats) m.dispose();
    for (const g of r.geos) g.dispose();
  } catch (e) {
    /* gone */
  }
  K.radar = null;
}

function tickRadar(dt) {
  const r = K.radar;
  if (!r) return;
  r.t += dt;
  r.dish.rotation.y = r.t * 0.5;
  // A slow, soft blink — never a flash (Reduce flashing applies to everything).
  r.lamp.material.color.setHex(Math.sin(r.t * 1.5) > 0 ? 0xff6a4a : 0x6a2a20);
}

/** The red-hatched range on the minimap, under the aircraft (the wildfire's underlay slot). */
function setOverlay(sim, on) {
  const mm = sim && sim.minimap;
  if (!mm) return;
  if (on && !K.overlayOn && (!mm.underlay || mm.underlay.storyRange)) {
    const draw = () => drawRange(sim);
    draw.storyRange = true;
    mm.underlay = draw;
    K.overlayOn = true;
  } else if (!on && K.overlayOn) {
    if (mm.underlay && mm.underlay.storyRange) mm.underlay = null;
    K.overlayOn = false;
  }
}

const RANGE_AREA = { x: 4600, z: 300, r: 3600 };

function drawRange(sim) {
  const mm = sim.minimap;
  if (!mm || !mm.visible || !mm.ctx || typeof mm.span !== 'number') return;
  const ac = sim.aircraft;
  if (!ac) return;
  const SIZE = 190;
  const ctx = mm.ctx;
  const k = SIZE / mm.span;
  const c = SIZE / 2;
  const x = c + (RANGE_AREA.x - ac.pos.x) * k;
  const y = c + (RANGE_AREA.z - ac.pos.z) * k;
  const r = RANGE_AREA.r * k;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, SIZE / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(255, 70, 60, 0.12)';
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.strokeStyle = 'rgba(255, 90, 80, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let d = -SIZE * 2; d < SIZE * 2; d += 9) {
    ctx.moveTo(d, 0);
    ctx.lineTo(d + SIZE, SIZE);
  }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, SIZE / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(255, 90, 80, 0.85)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

/* ====================================================================== */
/* BEAT A — the corridor                                                   */
/* ====================================================================== */

const _tgt = new THREE.Vector3();
function valleyTarget(ac) {
  // The next valley waypoint not yet passed, low; then the field.
  while (K.valleyIx < PLACE.valley.length && dist2D(ac.pos, PLACE.valley[K.valleyIx]) < 420) K.valleyIx++;
  const w = PLACE.valley[K.valleyIx] || PLACE.valley[PLACE.valley.length - 1];
  return _tgt.set(w.x, Math.max(groundAt(w.x, w.z) + 90, 110), w.z);
}

function hidden(ac) {
  const s = K.shape;
  if (!s || s.gone) return true;
  return !s.sees(ac, 0);
}

export const CORRIDOR = {
  id: 'story-ch03-corridor',
  name: 'Range Control',
  short: 'Chapter 3 — the corridor',
  game: 'story',
  hidden: true,
  difficulty: 'Medium',
  icon: '📡',
  category: 'story',
  map: 'fjord',
  aircraft: 'courier',
  blurb: 'Signal Zero, chapter 3.',
  weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 300 },
  spawn: START_SPAWN,
  startLabel: 'Air start',
  onStart(ctx) {
    enterCorridor(ctx);
  },
  tick(ctx, dt) {
    tickCorridor(ctx, dt);
  },
  failIf() {
    if (K.clock <= 0) return LINES['c3-fail-clock'].text;
    if (K.cargo <= 0.15) return LINES['c3-fail-cargo'].text;
    return null;
  },
  steps: [
    {
      id: 'cruise',
      text: 'Cruise for Aurora Field. Smooth and on time — the insulin minds how you fly.',
      hint: 'Hold your height and heading. The arrow points at the old corridor.',
      hintEvery: 30,
      rolling: true,
      checkpoint: 'The corridor',
      targetLabel: 'The corridor',
      target: () => _tgt.set(PLACE.corridor.x, PLACE.start.y, PLACE.corridor.z),
      enter() {
        if (!K.api.isResume) {
          later(K.t + 6, () => {
            K.api.titleCard({ main: 'SIGNAL ZERO', wordmark: true, dur: 2, bars: 'thin' });
            K.api.titleCard({ over: 'Chapter 3', main: 'RANGE CONTROL', sub: 'AURORA FJORDS · 17:50', dur: 3.2, bars: 'thin' });
          });
        }
      },
      check: (ctx) => dist2D(ctx.ac.pos, PLACE.corridor) < 700,
    },
    {
      id: 'voice',
      text: 'Unknown frequency. Hold your heading for Aurora.',
      hint: 'Nothing to do but fly. Listen.',
      hintEvery: 30,
      checkpoint: 'The radio voice',
      targetLabel: 'The fjord mouth',
      target: () => _tgt.set(PLACE.mouth.x, PLACE.start.y, PLACE.mouth.z),
      enter() {
        K.voiceAt = K.t;
        if (!K.api.isResume) {
          K.api.say('c3-range-1');
          later(K.t + 4.5, 'c3-range-2');
          later(K.t + 8.5, 'c3-lark-2');
          later(K.t + 11.5, 'c3-mara-2');
        }
      },
      check: () => K.t - (K.voiceAt ?? K.t) > 13,
    },
    {
      id: 'shape',
      text: 'Unknown traffic, left wing. Hold your heading.',
      hint: 'Look left. It has no lights. Do not turn into it.',
      hintEvery: 20,
      checkpoint: 'The shape on your wing',
      targetLabel: 'The fjord mouth',
      target: () => _tgt.set(PLACE.mouth.x, PLACE.start.y, PLACE.mouth.z),
      enter(ctx) {
        spawnShape(ctx.sim);
        K.shapeAt = K.t;
        if (!K.api.isResume) {
          later(K.t + 5, () => {
            K.api.lowerThird('UNKNOWN TRAFFIC · LEFT WING · NO LIGHTS', 4);
            K.api.say('c3-lark-3');
          });
          later(K.t + 9, () => {
            if (K.shape) K.shape.rock();
            K.api.say('c3-range-3');
          });
          later(K.t + 13.5, 'c3-mara-3');
        }
      },
      check: () => K.t - (K.shapeAt ?? K.t) > 17,
    },
    {
      id: 'lose',
      text: 'It wants you to follow it out to sea. Don’t. Get below the ridgelines in the fjord and break its line of sight.',
      hint: 'Dive for the fjord mouth and fly up the valley under 800 ft. The lock drains while it cannot see you.',
      hintEvery: 25,
      checkpoint: 'Lost it',
      targetLabel: 'The fjord',
      target: (ctx) => valleyTarget(ctx.ac),
      enter() {
        K.loseAt = K.t;
        K.maxAglLose = 0;
        if (!K.api.isResume) {
          K.api.say('c3-lark-4');
          later(K.t + 4, 'c3-range-4');
        }
      },
      check: () => K.lost,
      onDone() {
        K.lowRoad = K.maxAglLose <= LOW_ROAD_AGL;
        if (K.lowRoad) K.api.style('low-road', 'Low Road');
      },
    },
  ],
  onComplete() {
    /* straight into the home beat, the same flight */
  },
  score: () => Math.round(50 + 50 * K.cargo),
  save() {
    return {
      t: K.t,
      clock: K.clock,
      cargo: K.cargo,
      lock: K.lock,
      hiddenT: K.hiddenT,
      lost: K.lost,
      lostAt: K.lostAt,
      shapeAt: K.shapeAt,
      maxAglLose: K.maxAglLose,
      herds: K.herds,
      fileFound: K.fileFound,
      shape: K.shape && !K.shape.gone ? K.shape.state : null,
      said: Object.keys(K.said),
    };
  },
  resume(state, ctx) {
    if (!state) return;
    K.t = state.t || 0;
    K.clock = Number.isFinite(state.clock) ? state.clock : K.clock;
    K.cargo = Number.isFinite(state.cargo) ? state.cargo : 1;
    K.lock = Number.isFinite(state.lock) ? state.lock : 0.35;
    K.hiddenT = state.hiddenT || 0;
    K.lost = !!state.lost;
    K.lostAt = state.lostAt ?? null;
    K.shapeAt = state.shapeAt ?? null;
    K.maxAglLose = state.maxAglLose || 0;
    K.herds = state.herds || 0;
    K.fileFound = !!state.fileFound || K.fileFound;
    for (const id of state.said || []) K.said[id] = true;
    const step = ctx.runner.step ? ctx.runner.step.id : null;
    if (state.shape && !K.lost && (step === 'shape' || step === 'lose')) {
      spawnShape(ctx.sim);
      if (K.shape && state.shape !== 'join') K.shape.state = 'formate';
      // Joined already: put it on the slot now rather than a kilometre away.
      if (K.shape && state.shape !== 'join') K.shape.pos.copy(K.shape.slot(ctx.ac, K.v));
    }
  },
};

function spawnShape(sim) {
  disposeShape();
  try {
    K.shape = new Shepherd(sim.scene, sim.aircraft);
  } catch (e) {
    console.warn('[story] the shape could not be built; the voice flies alone', e);
    K.shape = null;
  }
}

function disposeShape() {
  if (K.shape) {
    try {
      K.shape.dispose();
    } catch (e) {
      /* gone */
    }
  }
  K.shape = null;
}

function enterCorridor(ctx) {
  const sim = ctx.sim;
  K.beat = 'corridor';
  K.t = 0;
  K.timeline = [];
  K.said = {};
  K.clock = K.diff.clock;
  K.cargo = 1;
  K.knockCool = 0;
  K.lock = 0.35;
  K.hiddenT = 0;
  K.lost = false;
  K.lostAt = null;
  K.shapeAt = null;
  K.voiceAt = null;
  K.loseAt = null;
  K.maxAglLose = 0;
  K.lowRoad = false;
  K.herds = 0;
  K.valleyIx = 0;
  K.landing = null;
  K.goArounds = 0;
  K.lowPass = false;
  disposeShape();
  addRadar(sim);
  setOverlay(sim, true);
  if (!K.api.isResume) {
    later(1.0, 'c3-nadia-1');
    later(6.0, 'c3-mara-1');
    later(10.5, 'c3-lark-1');
  }
}

function tickCorridor(ctx, dt) {
  const sim = ctx.sim;
  const ac = ctx.ac;
  K.t += dt;
  runTimeline();
  tickRadar(dt);
  tickClockAndCargo(ctx, dt);
  checkFile(sim);
  const step = sim.runner.step ? sim.runner.step.id : null;
  const s = K.shape;
  if (s && !s.gone) {
    s.update(dt, ac);
    if (step === 'lose' && !K.lost) {
      const hid = !s.sees(ac, dt);
      K.lock = lockStep(K.lock, hid, dt, K.diff);
      if (hid) {
        K.hiddenT += dt;
        if (K.hiddenT > 3 && !K.said['c3-range-5']) sayOnce('c3-range-5');
      }
      // The Low Road is "through the fjord": the height over the ground counts once you are inside the box.
      if (ac.pos.x <= PLACE.fjord.x1) K.maxAglLose = Math.max(K.maxAglLose, ac.agl || 0);
      // Lost: hidden long enough, with the meter down.
      if (K.hiddenT >= K.diff.hideFor && K.lock < 0.25) {
        K.lost = true;
        K.lostAt = K.t;
        s.leave();
        K.api.say('c3-range-6');
        later(K.t + 4, 'c3-aurora-1');
        later(K.t + 8, 'c3-lark-5');
      } else if (K.lock >= 1 && s.herd()) {
        // Herded: it crosses your nose and its wake shakes the aeroplane.
        K.herds++;
        K.lock = 0.6;
        K.api.say('c3-range-7');
        later(K.t + 2.2, () => {
          const r = cargoStep(K.cargo, { wake: true, dt: 0, knockCool: K.knockCool }, K.diff);
          K.cargo = r.cargo;
          try {
            if (sim.rig && sim.rig.kick) sim.rig.kick(0.9);
          } catch (e) {
            /* no rig in the tests */
          }
          K.api.notify('Its wake. The cargo felt that.', 'warn', 2.5);
        });
      }
    }
  }
}

/** The insulin clock and the smoothness meter run through both beats. */
function tickClockAndCargo(ctx, dt) {
  const ac = ctx.ac;
  K.clock = Math.max(0, K.clock - dt);
  if (K.clock < 60 && !K.said.clock60) {
    K.said.clock60 = true;
    K.api.notify('One minute on the insulin clock.', 'warn', 3);
  }
  const r = cargoStep(K.cargo, { gLoad: ac.gLoad ?? 1, bankDeg: ac.bankAngleDeg ? ac.bankAngleDeg() : 0, dt, knockCool: K.knockCool }, K.diff);
  if (r.why === 'g') K.api.notify('Easy — the cargo felt that.', 'warn', 1.8);
  K.cargo = r.cargo;
  K.knockCool = r.knockCool;
}

/** File 03: the old range radar head on the north point. */
function checkFile(sim) {
  if (K.fileFound || !K.radar) return;
  const ac = sim.aircraft;
  if (ac.pos.distanceTo(K.radar.group.position) < FILE_REACH_M) {
    K.fileFound = true;
    K.api.foundFile('f03');
    K.api.say('c3-file-1');
  }
}

/* ====================================================================== */
/* BEAT B — home                                                           */
/* ====================================================================== */

export const HOME = {
  id: 'story-ch03-home',
  name: 'Range Control',
  short: 'Chapter 3 — Aurora Field',
  game: 'story',
  hidden: true,
  difficulty: 'Medium',
  icon: '📡',
  category: 'story',
  map: 'fjord',
  aircraft: 'courier',
  blurb: 'Signal Zero, chapter 3.',
  weather: { time: 'sunset', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 300 },
  spawn: HOME_SPAWN,
  continues: true,
  startLabel: 'Clear of it',
  onStart(ctx) {
    enterHome(ctx);
  },
  tick(ctx, dt) {
    tickHome(ctx, dt);
  },
  failIf() {
    if (K.clock <= 0) return LINES['c3-fail-clock'].text;
    if (K.cargo <= 0.15) return LINES['c3-fail-cargo'].text;
    return null;
  },
  steps: [
    {
      id: 'approach',
      get text() {
        return K.runway === 27
          ? 'Aurora Field, straight in on runway 27 from the fjord. The clock is running.'
          : 'You are past the field. Round over the sea to the west, climb to 1,400 ft, and come back onto runway 09 — it is a steep one.';
      },
      hint: 'The arrow is the way in. Gear G, flaps F once you are lined up.',
      hintEvery: 25,
      rolling: true,
      checkpoint: 'On final',
      get targetLabel() {
        return K.runway === 27 ? 'Final, runway 27' : 'Round onto 09';
      },
      target: (ctx) => {
        // Decided as you go: still east of the field, 27 straight in; past it, the join over the sea for 09.
        if (ctx && ctx.ac) K.runway = runwayFor(ctx.ac.pos.x);
        if (K.runway === 27) return _tgt.set(PLACE.touchdown.x + 4800, PLACE.touchdown.y + 330, 0);
        const j = PLACE.join09;
        return _tgt.set(j.x, j.y, j.z);
      },
      check: (ctx) => {
        const ac = ctx.ac;
        if (K.runway === 27) {
          const td = PLACE.touchdown;
          const d = ac.pos.distanceTo(td);
          return d < 5200 && Math.abs(adiff(ac.heading, 270)) < 60 && ac.agl < 800 && ac.pos.x > td.x + 600;
        }
        const td = PLACE.touchdown09;
        const d = ac.pos.distanceTo(td);
        return d < 5200 && Math.abs(adiff(ac.heading, 90)) < 60 && ac.agl < 800 && ac.pos.x < td.x - 600;
      },
      onDone() {
        K.runwayFixed = true;
      },
    },
    {
      id: 'short-final',
      text: 'Short final. Gear down, full flap, stay on the slope.',
      hint: 'Gear G, flaps F. Keep the runway steady in the windscreen.',
      hintEvery: 20,
      checkpoint: 'Short final',
      get targetLabel() {
        return `Runway ${K.runway === 27 ? '27' : '09'}`;
      },
      target: () => (K.runway === 27 ? PLACE.touchdown : PLACE.touchdown09),
      check: (ctx) => ctx.ac.onGround || ctx.ac.pos.distanceTo(K.runway === 27 ? PLACE.touchdown : PLACE.touchdown09) < SHORT_FINAL_M,
    },
    {
      id: 'land',
      get text() {
        return `Land on runway ${K.runway === 27 ? '27' : '09'} and stop. The insulin goes in the fridge.`;
      },
      hint: 'Sixty-five knots over the fence, nose up a touch, then brakes.',
      hintEvery: 25,
      checkpoint: 'Landed',
      get targetLabel() {
        return `Runway ${K.runway === 27 ? '27' : '09'}`;
      },
      target: () => (K.runway === 27 ? PLACE.touchdown : PLACE.touchdown09),
      enter() {
        if (!K.api.isResume) K.api.say(K.runway === 27 ? 'c3-aurora-2' : 'c3-aurora-4');
      },
      check: landedAndStopped,
    },
  ],
  onComplete(ctx) {
    K.landing = ctx.data.lastTouchdown || null;
    if (K.landing && Math.abs(K.landing.vs || 0) > 3.5) {
      K.cargo = cargoStep(K.cargo, { touchdownVs: K.landing.vs }, K.diff).cargo;
    }
    K.api.say('c3-mara-4');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    return l ? l.score : 50;
  },
  save() {
    return { t: K.t, clock: K.clock, cargo: K.cargo, lostAt: K.lostAt, shapeAt: K.shapeAt, lowRoad: K.lowRoad, herds: K.herds, fileFound: K.fileFound, goArounds: K.goArounds, runway: K.runway, said: Object.keys(K.said) };
  },
  resume(state) {
    if (!state) return;
    K.t = state.t || 0;
    K.clock = Number.isFinite(state.clock) ? state.clock : K.clock;
    K.cargo = Number.isFinite(state.cargo) ? state.cargo : K.cargo;
    K.lostAt = state.lostAt ?? K.lostAt;
    K.shapeAt = state.shapeAt ?? K.shapeAt;
    K.lowRoad = !!state.lowRoad || K.lowRoad;
    K.herds = state.herds || K.herds;
    K.fileFound = !!state.fileFound || K.fileFound;
    K.goArounds = state.goArounds || 0;
    K.runway = state.runway === 9 ? 9 : 27;
    for (const id of state.said || []) K.said[id] = true;
  },
};

function enterHome(ctx) {
  const sim = ctx.sim;
  const fresh = K.beat !== 'corridor';
  K.beat = 'home';
  K.timeline = [];
  K.lowPass = false;
  K.runway = runwayFor(ctx.ac.pos.x);
  K.runwayFixed = false;
  if (fresh) {
    // A restart or a resume of this beat: the chase is over, the numbers are the save's (resume lays them over).
    K.said = {};
    K.t = 0;
    K.clock = K.clock > 0 && K.clock < K.diff.clock ? K.clock : Math.round(K.diff.clock * 0.55);
    K.cargo = K.cargo > 0 ? K.cargo : 0.9;
    K.lost = true;
    if (K.lostAt == null) {
      K.shapeAt = 0;
      K.lostAt = 80;
    }
    if (!K.radar) addRadar(sim);
  }
  disposeShapeLater();
  setOverlay(sim, true);
  if (!K.api.isResume) later(K.t + 2.5, 'c3-aurora-3');
}

/** The shape is leaving: let it fly off rather than vanish. */
function disposeShapeLater() {
  if (K.shape && !K.shape.gone) K.shape.leave();
}

function tickHome(ctx, dt) {
  const ac = ctx.ac;
  K.t += dt;
  runTimeline();
  tickRadar(dt);
  tickClockAndCargo(ctx, dt);
  checkFile(ctx.sim);
  if (K.shape && !K.shape.gone) K.shape.update(dt, ac);
  // A go-around: low and close, then climbing away without having landed.
  const d = ac.pos.distanceTo(K.runway === 27 ? PLACE.touchdown : PLACE.touchdown09);
  if (!ac.onGround && d < 2500 && ac.agl < 60) K.lowPass = true;
  if (K.lowPass && !ac.onGround && ac.agl > 160 && !ctx.data.lastTouchdown) {
    K.goArounds++;
    K.lowPass = false;
    K.api.notify('Going round. The clock does not stop.', 'info', 3);
  }
}

/* ====================================================================== */
/* cutscene (c): the apron at Aurora, night coming on                        */
/* ====================================================================== */

function apronScene(api) {
  const sim = api.sim;
  const ac = sim.aircraft;
  const p0 = ac.pos.clone();
  const fwd = ac.forward(new THREE.Vector3()).setY(0).normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const from = p0.clone().addScaledVector(fwd, 26).addScaledVector(right, 10).add(new THREE.Vector3(0, 3.2, 0));
  const to = p0.clone().addScaledVector(fwd, 8).addScaledVector(right, 18).add(new THREE.Vector3(0, 5.5, 0));
  const look0 = p0.clone().add(new THREE.Vector3(0, 1.8, 0));
  const look1 = p0.clone().addScaledVector(fwd, 2).add(new THREE.Vector3(0, 9, 0)); // up, to the sky where it went
  const tmp = new THREE.Vector3();
  return api.playCutscene({
    id: 'ch03-apron',
    dur: 18,
    bars: 'big',
    hideHud: true,
    hold: true,
    caption: 'Aurora, dusk. Mara on the radio: forty years ago something sat on her wing too. They said it was lightning.',
    camera: (t, cam) => {
      const e = t * t * (3 - 2 * t);
      cam.position.lerpVectors(from, to, e);
      tmp.lerpVectors(look0, look1, Math.max(0, (e - 0.55) / 0.45));
      cam.lookAt(tmp);
    },
    beats: [
      { at: 0.8, line: 'c3-h-mara-1' },
      { at: 3.6, line: 'c3-h-lark-1' },
      { at: 6.6, line: 'c3-h-mara-2' },
      { at: 10.4, line: 'c3-h-mara-3' },
      { at: 14.2, line: 'c3-h-mara-4' },
    ],
  });
}

/* ====================================================================== */
/* the chapter                                                             */
/* ====================================================================== */

export const CHAPTER_3 = {
  id: 'ch03-range-control',
  beats: [CORRIDOR, HOME],
  objectives: [
    'Cruise to Aurora, smooth, minding the cargo',
    'Unknown traffic, left wing: hold your heading',
    'Get below the ridgelines and break its line of sight',
    'Land at Aurora Field before the insulin clock runs out',
  ],
  briefing: {
    line: 'Aurora Fjords · 17:50, dusk · cloud layers, cold · Kestrel Courier · about 7 minutes',
    bullets: [
      'Chilled insulin for Aurora Field: smooth and on time. Hard turns and hard landings cost cargo.',
      'The route runs the old corridor over the sea, then the fjord between the walls to runway 27.',
      'If anything strange happens out there, Mara’s rule: don’t be brave, be early.',
    ],
    route: [
      [PLACE.start.x, PLACE.start.z, 'air start'],
      [PLACE.corridor.x, PLACE.corridor.z, 'the corridor'],
      [PLACE.mouth.x, PLACE.mouth.z, 'the fjord'],
      [350, 0, 'runway 27'],
    ],
  },
  enterChapter(api) {
    K.api = api;
    K.diff = DIFF[api.difficulty] || DIFF.pilot;
    K.beat = null;
    K.t = 0;
    K.timeline = [];
    K.said = {};
    K.clock = K.diff.clock;
    K.cargo = 1;
    K.lock = 0.35;
    K.hiddenT = 0;
    K.lost = false;
    K.lostAt = null;
    K.shapeAt = null;
    K.lowRoad = false;
    K.herds = 0;
    K.landing = null;
    K.goArounds = 0;
    K.runway = 27;
    K.fileFound = !!(api.data && api.data.flags.files.includes('f03'));
    K.trackT = 0;
    api.tracker(trackerItems(api), 'Chapter 3 · Range Control');
  },
  leaveChapter(api) {
    disposeShape();
    clearRadar(api.sim);
    setOverlay(api.sim, false);
    K.beat = null;
  },
  onBeatDone(api, i, result) {
    if (i === 1) K.landing = result.landing || K.landing;
  },
  finale(api) {
    return apronScene(api);
  },
  medal() {
    return verdict(K);
  },
  onFail(api, f) {
    if (/crash|struck|hit the|came down|flew into/i.test(f.reason || '')) api.say('c3-fail-crash');
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
  const ac = sim.aircraft;
  const order = ['cruise', 'voice', 'shape', 'lose'];
  const inA = K.beat === 'corridor';
  const ai = inA ? order.indexOf(step) : K.beat === 'home' ? 9 : -1;
  const item = (text, state, extra = {}) => ({ text, state, ...extra });
  const clockNote = `insulin ${mmss(K.clock)} · cargo ${Math.round(K.cargo * 100)}%`;
  const items = [
    item(CHAPTER_3.objectives[0], ai >= 1 ? 'done' : ai === 0 ? 'active' : 'todo', ai === 0 && ac ? { meter: K.cargo, note: `${clockNote} · ${(dist2D(ac.pos, PLACE.corridor) / 1000).toFixed(1)} km` } : {}),
    item(CHAPTER_3.objectives[1], ai >= 3 ? 'done' : ai === 1 || ai === 2 ? 'active' : 'todo', ai === 1 || ai === 2 ? { note: ai === 1 ? 'a voice on an unknown frequency' : 'no lights · it is rocking its wings' } : {}),
    item(CHAPTER_3.objectives[2], K.lost ? 'done' : ai === 3 ? 'active' : 'todo', ai === 3 && !K.lost && ac ? { meter: 1 - K.lock, note: `${hidden(ac) ? 'hidden' : 'it sees you'} · ${Math.round((ac.agl || 0) / FT)} ft over the ground` } : K.lost ? { note: 'RANGE CLEAR' } : {}),
    item(CHAPTER_3.objectives[3], K.landing ? 'done' : K.beat === 'home' ? 'active' : 'todo', K.beat === 'home' && ac ? { meter: K.cargo, note: `${clockNote} · runway ${K.runway === 27 ? '27' : '09'} · ${(ac.pos.distanceTo(K.runway === 27 ? PLACE.touchdown : PLACE.touchdown09) / 1000).toFixed(1)} km${K.goArounds ? ` · ${K.goArounds} go-around` : ''}` } : {}),
  ];
  return items;
}

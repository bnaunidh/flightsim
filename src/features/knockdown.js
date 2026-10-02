/**
 * Knocked down.
 *
 * "if someone hits you with anything, a plane etc, you get pushed to the
 * ground, WASTED showing on your screen (ragdoll physics)" — the owner. This
 * replaces v48's "WASTED only from your own plane": ANYTHING that moves and
 * hits the pilot while they are on foot knocks them down —
 *
 *   - your own runaway plane (./runaway.js lists it while she is loose);
 *   - the AI aeroplanes on the field: taxiing airliners, the circuit traffic
 *     (sim.traffic, ./traffic.js), the chase mission's pursuers;
 *   - the airfield's own ground vehicles: the follow-me van doing laps of the
 *     apron, the baggage trains, the ramp trucks driving in (sim.apron);
 *   - in multiplayer, everybody else's aeroplane, helicopter, car and boat,
 *     and the host's AI aeroplanes (./pilot-mp.js lists those);
 *   - and anything another feature lists with addMoverSource().
 *
 * WHAT HAPPENS. The pilot goes down as a real ragdoll (./ragdoll.js), thrown
 * by the hitter's own speed and from the height it struck; WASTED comes up on
 * THIS player's screen only (./wasted.js — the pause switch "Runaway plane &
 * WASTED" turns that screen off, never the knock). Nobody can move the pilot
 * until the body has settled and the screen has cleared; then they get up,
 * eased out of where they lie, beside it and clear of whatever hit them —
 * as v48 did. In multiplayer everybody else sees the fall (./pilot-mp.js
 * sends it the moment it happens).
 *
 * WHO DECIDES. The player who was hit, with what their own game draws: the
 * remote players where this game sees them (interpolated), at their size.
 * A knock is this player's own business — nobody else's game can say you
 * were hit — and it is then told to everybody.
 *
 * WHAT COUNTS AS A HIT. Something moving faster than a brisk walk, whose box
 * (an aeroplane's fuselage and its wing at the wing's height, measured from
 * its type as the walker's solids are; a vehicle's own length, width and
 * height) reaches the pilot while moving TOWARDS them. Many of these things
 * are solid to the walker (onfoot.js pushes you out of a taxiing jet), so
 * "reaches" is within a hand's breadth of the walker's edge, not inside. A
 * thing that merely brushes past, or that you walk into the side of, does
 * not count. Fast things are tested along their path through the frame, so
 * a fighter at 60 m/s on a 10 fps Chromebook cannot step over you.
 *
 * Kid-safe: a toy figure falls over and lies still, and gets up. No blood,
 * nothing comes off. Realistic words under WASTED: what hit you, plainly.
 *
 *   knockDown(sim, { cause, vel, hitY, words, by })   -> true if it started
 *   addMoverSource((sim, add) => { add(m) ... })      -> a feature's movers
 *   onKnock(fn)                                       -> fn(event) on every knock
 *   knockdown                                         -> state, for tests and pilot-mp.js
 *
 * A mover is a plain object: { x, y, z, heading (compass deg), vx, vy, vz,
 * lift (m off the ground), and EITHER prof (staff/jobs.js planeProfile) OR
 * hl, hw, height (a box) ; kind, label, words, by (player id) }.
 */

import { registerExtension } from '../game/extensions.js';
import { onFoot } from './onfoot.js';
import { floorAt, groundAt, solidAt, WALK } from './staff/walk.js';
import { heightAt } from '../world/terrain.js';
import { planeProfile } from './staff/jobs.js';
import * as TYPES from '../aircraft/types.js';
import { Ragdoll, GetUp, cleanRig, groundWorld } from './ragdoll.js';
import { showWasted, wasted, endWasted, WASTED } from './wasted.js';
import * as FootUI from './staff/ui.js';

const D2R = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const KNOCK = {
  /** m/s: slower than this a thing only nudges (and the walker is pushed out of it as ever). */
  minSpeed: 1.5,
  /** m/s towards the pilot, at the moment of touching. */
  minClosing: 1.0,
  /** How close counts as touching: past the walker's own radius, metres. */
  reach: 0.14,
  /** Down for at least this long (game seconds), and until the body is still. */
  minDown: 1.6,
  /** ...but never longer than this, still or not (a body rocking on a boat deck). */
  maxDown: 6,
  /** After getting up, this long before anything can knock you down again (seconds). */
  immune: 2.2,
  /** Seconds to ease from lying down to standing. */
  getUpSecs: 0.7,
  /** Nothing further away than this is looked at, metres (an A380 is 73 m long). */
  near: 140,
};

const K = {
  sim: null,
  down: false,
  t: 0,
  rd: new Ragdoll(),
  up: new GetUp(),
  count: 0,
  cause: '',
  words: '',
  by: -1,
  immune: 0,
  control: null,
  prevControl: null,
  viewWas: null,
  sources: [],
  listeners: [],
  movers: [],
  pool: [],
  used: 0,
  last: null,
  history: [],
  showedWasted: false,
  gotUp: false,
};

/* ------------------------------------------------------------------ */
/* The movers                                                          */
/* ------------------------------------------------------------------ */

/** A feature's say in what can knock the pilot down. `fn(sim, add)`; add(mover) for each. */
export function addMoverSource(fn) {
  if (typeof fn === 'function' && !K.sources.includes(fn)) K.sources.push(fn);
  return fn;
}

export function removeMoverSource(fn) {
  const i = K.sources.indexOf(fn);
  if (i >= 0) K.sources.splice(i, 1);
}

/** Tell `fn` about every knock: { seq, x, y, z, heading, vel, hitY, cause, by }. */
export function onKnock(fn) {
  if (typeof fn === 'function') K.listeners.push(fn);
  return () => {
    const i = K.listeners.indexOf(fn);
    if (i >= 0) K.listeners.splice(i, 1);
  };
}

/** A pooled mover to fill in (built-in sources); other features may pass their own objects to add(). */
function blank() {
  let m = K.pool[K.used];
  if (!m) {
    m = {};
    K.pool.push(m);
  }
  K.used++;
  m.x = 0; m.y = 0; m.z = 0; m.heading = 0; m.vx = 0; m.vy = 0; m.vz = 0; m.lift = 0;
  m.prof = null; m.hl = 0; m.hw = 0; m.height = 0;
  m.kind = ''; m.label = ''; m.words = ''; m.by = -1;
  return m;
}

const profiles = new Map();
/** An aeroplane type's measured profile, once per type (the walker's own solids use the same). */
export function profileOf(typeId) {
  let p = profiles.get(typeId);
  if (p === undefined) {
    const t = (TYPES.AIRCRAFT || []).find((a) => a && a.id === typeId) || null;
    p = t ? planeProfile(t, null) : null;
    profiles.set(typeId, p);
  }
  return p;
}

function typeName(typeId) {
  const t = (TYPES.AIRCRAFT || []).find((a) => a && a.id === typeId);
  return t ? t.name : 'aeroplane';
}

/** The AI aeroplanes (sim.traffic): traffic.js publishes where each is, its heading and speed. */
function trafficMovers(sim, add, cx, cz) {
  const list = sim.traffic;
  if (!Array.isArray(list)) return;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || !t.pos || typeof t.typeId !== 'string') continue;
    const sp = Number(t.speed) || 0;
    if (sp < KNOCK.minSpeed) continue;
    if (Math.abs(t.pos.x - cx) > KNOCK.near || Math.abs(t.pos.z - cz) > KNOCK.near) continue;
    const prof = profileOf(t.typeId);
    if (!prof) continue;
    const h = Number.isFinite(t.heading) ? t.heading : 0;
    const m = blank();
    m.x = t.pos.x; m.y = t.pos.y; m.z = t.pos.z;
    m.heading = h;
    m.vx = Math.sin(h * D2R) * sp;
    m.vz = -Math.cos(h * D2R) * sp;
    m.vy = Number(t.vs) || 0;
    m.lift = t.onGround ? 0 : Math.max(0, Number(t.agl) || 0);
    m.prof = prof;
    m.kind = 'traffic';
    m.words = t.onGround ? `Hit by a taxiing ${typeName(t.typeId)}.` : `Hit by a low ${typeName(t.typeId)}.`;
    add(m);
  }
}

/*
 * The airfield's own ground vehicles (world/apron.js): the follow-me van
 * lapping the apron at 5.5 m/s, each crew's baggage train (a tractor and
 * three carts) circling its aeroplane, and the ramp trucks driving in to a
 * stand. apron.js moves them along paths and draws them as instances; this
 * reads the same paths at the same distances, and their direction from a
 * second sample a little behind. Wrapped: the apron is not this feature's,
 * and a change there must cost the knock, not the frame.
 */
const _s = { x: 0, z: 0, yaw: 0 };
const _s2 = { x: 0, z: 0, yaw: 0 };
function pathMover(path, d, speed, hl, hw, height, kind, words, cx, cz, add) {
  path.sample(d, _s);
  if (Math.abs(_s.x - cx) > 60 || Math.abs(_s.z - cz) > 60) return;
  path.sample(d - 0.6, _s2);
  const dx = _s.x - _s2.x;
  const dz = _s.z - _s2.z;
  const l = Math.hypot(dx, dz);
  if (l < 0.05) return;
  const m = blank();
  m.x = _s.x;
  m.y = groundAt(_s.x, _s.z);
  m.z = _s.z;
  m.heading = ((Math.atan2(dx, -dz) / D2R) + 360) % 360;
  m.vx = (dx / l) * speed;
  m.vz = (dz / l) * speed;
  m.hl = hl;
  m.hw = hw;
  m.height = height;
  m.kind = kind;
  m.words = words;
  add(m);
}
const CREW_SPEED = 8;
function apronMovers(sim, add, cx, cz) {
  const ap = sim.apron;
  if (!ap) return;
  try {
    const fm = ap.followMe;
    if (fm && fm.path && typeof fm.path.sample === 'function') pathMover(fm.path, fm.d, 5.5, 2.35, 0.95, 2.45, 'van', 'Hit by the follow-me van.', cx, cz, add);
    for (const c of ap.crews || []) {
      const tr = c && c.train;
      if (tr && tr.path && c.state === 'working' && tr.speed > 0) {
        pathMover(tr.path, tr.d, tr.speed, 1.35, 0.85, 2.0, 'cart', 'Hit by a baggage train.', cx, cz, add);
        for (let i = 0; i < 3; i++) pathMover(tr.path, tr.d - 3.1 - i * 2.9, tr.speed, 1.25, 0.85, 1.85, 'cart', 'Hit by a baggage train.', cx, cz, add);
      }
      if (c && c.state === 'arriving' && Array.isArray(c.moves)) {
        for (const mv of c.moves) {
          if (!mv || mv.done || !(mv.d > 0) || !mv.path) continue;
          pathMover(mv.path, mv.d, CREW_SPEED, 3, 1.25, 2.8, 'truck', 'Hit by a ramp truck.', cx, cz, add);
        }
      }
    }
  } catch (e) {
    /* the apron changed shape: no knocks from it, the game goes on */
  }
}

function gather(sim) {
  K.movers.length = 0;
  K.used = 0;
  const w = onFoot.walker;
  const add = (m) => {
    if (m && Number.isFinite(m.x) && Number.isFinite(m.z)) K.movers.push(m);
  };
  trafficMovers(sim, add, w.x, w.z);
  apronMovers(sim, add, w.x, w.z);
  for (const fn of K.sources) {
    try {
      fn(sim, add, w);
    } catch (e) {
      console.warn('[knockdown] a mover source failed', e);
    }
  }
  return K.movers;
}

/* ------------------------------------------------------------------ */
/* Touching                                                            */
/* ------------------------------------------------------------------ */

const HIT = { closing: 0, nx: 0, nz: 0, hitY: 0.9, inside: false };

/**
 * Does an upright box (along: back..front, side: ±hw, in the mover's frame)
 * reach a walker at (px, pz)? Fills HIT with the push direction (box to
 * walker) and how fast the box closes on them.
 */
function boxTouch(m, back, front, hw, px, pz, fx, fz) {
  const dx = px - m.x;
  const dz = pz - m.z;
  // Along the nose, and to the right (staff/jobs.js local()).
  const a = dx * fx + dz * fz;
  const s = dx * -fz + dz * fx;
  const ca = clamp(a, back, front);
  const cs = clamp(s, -hw, hw);
  let na = a - ca;
  let ns = s - cs;
  const d = Math.hypot(na, ns);
  const r = WALK.radius + KNOCK.reach;
  if (d > r) return false;
  if (d > 1e-6) {
    na /= d;
    ns /= d;
    HIT.inside = false;
  } else {
    // Right inside: out through the nearest side.
    const pen = [front - a, a - back, hw - s, s + hw];
    let k = 0;
    for (let i = 1; i < 4; i++) if (pen[i] < pen[k]) k = i;
    na = k === 0 ? 1 : k === 1 ? -1 : 0;
    ns = k === 2 ? 1 : k === 3 ? -1 : 0;
    HIT.inside = true;
  }
  // World direction from the box to the walker.
  HIT.nx = na * fx - ns * fz;
  HIT.nz = na * fz + ns * fx;
  HIT.closing = m.vx * HIT.nx + m.vz * HIT.nz;
  if (HIT.inside) HIT.closing = Math.max(HIT.closing, Math.hypot(m.vx, m.vz));
  return HIT.closing >= KNOCK.minClosing;
}

/** Does mover m (at its position offset by -k of this frame's travel) reach the walker? */
function touches(m, w, back) {
  const h = (m.heading || 0) * D2R;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const sx = m.x;
  const sz = m.z;
  m.x -= m.vx * back;
  m.z -= m.vz * back;
  let hit = false;
  try {
    const lift = Math.max(0, m.lift || 0);
    if (m.prof) {
      const p = m.prof;
      // The fuselage, while it is low enough to meet a standing person.
      if (lift < 1.6 && boxTouch(m, p.tail - 0.2, p.nose + 0.3, p.halfWidth + 0.1, w.x, w.z, fx, fz)) {
        HIT.hitY = clamp((p.belly || 0.5) + lift + 0.3, 0.3, 1.5);
        hit = true;
      } else if (p.wingH + lift < WALK.height + 0.2 && p.wingH + lift > -0.5
        && boxTouch(m, p.wingBack - 0.2, p.wingFront + 0.2, (p.wingSpan || p.halfSpan) + 0.2, w.x, w.z, fx, fz)) {
        // The wing, low enough to meet them.
        HIT.hitY = clamp(p.wingH + lift, 0.3, 1.7);
        hit = true;
      }
    } else if (m.hl > 0 && m.hw > 0) {
      // A vehicle: its own box, if any of it is at a person's height.
      const h0 = lift;
      const h1 = lift + (m.height || 1.8);
      if (h0 < WALK.height && h1 > 0.15 && boxTouch(m, -m.hl, m.hl, m.hw, w.x, w.z, fx, fz)) {
        HIT.hitY = clamp(h0 + Math.min(0.7, (h1 - h0) * 0.45), 0.3, 1.2);
        hit = true;
      }
    }
  } finally {
    m.x = sx;
    m.z = sz;
  }
  return hit;
}

/** The first mover that has hit the walker this frame, or null. */
function findHit(sim, dt) {
  const w = onFoot.walker;
  const list = gather(sim);
  for (let i = 0; i < list.length; i++) {
    const m = list[i];
    const sp = Math.hypot(m.vx || 0, m.vz || 0);
    if (sp < KNOCK.minSpeed) continue;
    if (Math.abs(m.x - w.x) > KNOCK.near || Math.abs(m.z - w.z) > KNOCK.near) continue;
    // Along its path this frame, in steps no longer than half a metre.
    const travel = sp * Math.max(dt, 1 / 60);
    const n = Math.min(6, Math.max(1, Math.ceil(travel / 0.5)));
    for (let k = 0; k < n; k++) {
      if (touches(m, w, (k / n) * Math.max(dt, 1 / 60))) return m;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Going down                                                          */
/* ------------------------------------------------------------------ */

/* The ground, the sea and the walls the body falls among: the walker's own (ragdoll.js groundWorld). */
const WORLD = groundWorld(() => onFoot.solids || null);
export const ragdollWorld = WORLD;

/**
 * Knock the pilot down, now. opts: { cause, vel: {x,y,z}, hitY, words, by }.
 * Returns false if there is nobody on foot, they are already down, or they
 * have only just got up.
 */
export function knockDown(sim, opts = {}) {
  sim = sim || K.sim;
  if (!sim || sim.state !== 'flying' || !onFoot.active || K.down) return false;
  if (K.immune > 0 && !opts.force) return false;
  const m = onFoot.model;
  const w = onFoot.walker;
  K.sim = sim;
  K.down = true;
  K.t = 0;
  K.gotUp = false;
  K.count++;
  K.cause = String(opts.cause || 'hit');
  K.words = String(opts.words || 'Knocked down.');
  K.by = Number.isInteger(opts.by) ? opts.by : -1;
  const vel = opts.vel || { x: 0, y: 0, z: 0 };
  const hitY = Number.isFinite(opts.hitY) ? opts.hitY : 0.9;
  // Exactly the pose the pilot was drawn in this frame, then thrown.
  if (!(m && K.rd.capture(m))) K.rd.standAt(w.x, w.y, w.z, w.heading);
  K.rd.knock(vel, hitY);
  K.up.on = false;
  K.last = {
    seq: K.count, cause: K.cause, words: K.words, by: K.by, x: w.x, y: w.y, z: w.z, heading: w.heading,
    vel: { x: vel.x || 0, y: vel.y || 0, z: vel.z || 0 }, hitY, speedKt: Math.round(Math.hypot(vel.x || 0, vel.z || 0) * 1.94384),
  };
  K.history.push({ cause: K.cause, words: K.words, at: Date.now() });
  if (K.history.length > 10) K.history.shift();
  // Nobody moves you while you are down; O does nothing (no climbing into the thing that hit you).
  K.prevControl = onFoot.control && !onFoot.control.knockdown ? onFoot.control : null;
  K.control = { locked: true, knockdown: true, wasted: true, prompt: '', onO() {} };
  onFoot.setControl(K.control);
  // Your own eyes cannot watch you fall: behind you for the moment.
  K.viewWas = onFoot.view === 'eyes' ? 'eyes' : null;
  if (K.viewWas) onFoot.setView('chase');
  pin(w);
  // WASTED, on this screen (unless the pause switch is off).
  K.showedWasted = showWasted(sim, K.cause, { words: K.words });
  for (const fn of K.listeners) {
    try {
      fn(K.last);
    } catch (e) {
      console.warn('[knockdown] a listener failed', e);
    }
  }
  return true;
}

/** The walker (and so the camera, and what multiplayer sends) follows the body. */
function pin(w) {
  const p = K.rd.pelvis;
  w.x = p.x;
  w.z = p.z;
  w.y = floorAt(p.x, p.z);
  w.vx = 0;
  w.vz = 0;
  w.vy = 0;
  w.air = false;
}

/** A spot to stand, near (x, z): dry, out of anything solid, and out of every mover's way. */
function standSpot(sim, x, z) {
  const movers = gather(sim);
  const clear = (px, pz) => {
    for (const m of movers) {
      const h = (m.heading || 0) * D2R;
      const fx = Math.sin(h);
      const fz = -Math.cos(h);
      const dx = px - m.x;
      const dz = pz - m.z;
      const a = dx * fx + dz * fz;
      const s = dx * -fz + dz * fx;
      const front = m.prof ? m.prof.nose : m.hl;
      const back = m.prof ? m.prof.tail : -m.hl;
      const hw = m.prof ? Math.max(m.prof.halfWidth, m.prof.wingSpan || m.prof.halfSpan) : m.hw;
      // Its box, and two seconds of where it is going.
      const ahead = Math.hypot(m.vx, m.vz) * 2;
      if (a < front + 2 + ahead && a > back - 2 && Math.abs(s) < hw + 2) return false;
    }
    return true;
  };
  const ok = (px, pz) => {
    if (!(heightAt(px, pz) > WALK.deep + 0.1)) return false;
    if (solidAt(px, pz, groundAt(px, pz), WALK.radius + 0.1, onFoot.solids || null)) return false;
    return clear(px, pz);
  };
  if (ok(x, z)) return { x, z };
  for (let r = 1.5; r < 90; r += 1.5) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = x + Math.sin(a) * r;
      const pz = z - Math.cos(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

function getUp(sim) {
  if (!K.down) return;
  K.down = false;
  K.gotUp = true;
  K.immune = KNOCK.immune;
  const m = onFoot.model;
  const p = K.rd.pelvis;
  const heading = K.rd.facing();
  const spot = standSpot(sim, p.x, p.z) || { x: p.x, z: p.z };
  onFoot.place(spot.x, spot.z, heading);
  // Eased up out of where the body lies, not popped upright.
  if (m) K.up.begin(m, KNOCK.getUpSecs);
  release();
}

/** Hand the walker back: the control, the view. */
function release() {
  if (onFoot.control === K.control) onFoot.setControl(K.prevControl || null);
  K.control = null;
  K.prevControl = null;
  if (K.viewWas) onFoot.setView(K.viewWas);
  K.viewWas = null;
}

/** Put it all away at once: the game stopped, or the walk ended under us. */
function abort(sim) {
  const wasDown = K.down;
  K.down = false;
  K.up.on = false;
  if (wasDown) {
    if (onFoot.model) cleanRig(onFoot.model);
    release();
  }
}

function downFrame(sim, dt) {
  K.t += dt;
  K.rd.step(dt, WORLD);
  const m = onFoot.model;
  if (m) K.rd.applyTo(m);
  pin(onFoot.walker);
  // Nothing to press while you are down: onfoot.js put its prompt up this frame.
  FootUI.setPrompt('');
  const screenDone = !wasted.active || wasted.t >= WASTED.clearAt;
  const settled = K.rd.asleep || K.t >= KNOCK.maxDown;
  // Never longer than maxDown and a bit, whatever the screen says.
  if ((K.t >= KNOCK.minDown && settled && screenDone) || K.t >= KNOCK.maxDown + 3) getUp(sim);
}

/* ------------------------------------------------------------------ */
/* The plug-in                                                         */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'knockdown',

  install(sim) {
    K.sim = sim;
  },

  startMode(sim) {
    abort(sim);
    K.immune = 0;
  },

  stop(sim) {
    abort(sim);
    K.immune = 0;
  },

  update(sim, dt) {
    K.sim = sim;
    if (K.immune > 0) K.immune -= dt;
    if (!onFoot.active) {
      if (K.down || K.up.on) abort(sim);
      return;
    }
    if (K.down) {
      downFrame(sim, dt);
      return;
    }
    // Getting up: the walk has posed the pilot this frame; ease from where they lay.
    if (K.up.on && onFoot.model) K.up.apply(onFoot.model, dt);
    if (sim.state !== 'flying' || K.immune > 0 || !(dt > 0)) return;
    const w = onFoot.walker;
    if (w.air && w.y > floorAt(w.x, w.z) + 1.5) return; // jumping clear over it
    const m = findHit(sim, dt);
    if (!m) return;
    const sp = Math.hypot(m.vx, m.vz);
    // The push: the hitter's way, and away from it.
    const along = HIT.inside ? 1 : 0.6;
    const vel = {
      x: m.vx * along + HIT.nx * HIT.closing * (1 - along) + HIT.nx * 0.8,
      y: m.vy || 0,
      z: m.vz * along + HIT.nz * HIT.closing * (1 - along) + HIT.nz * 0.8,
    };
    knockDown(sim, {
      cause: m.kind || 'hit',
      vel,
      hitY: HIT.hitY,
      words: m.words || (m.label ? `Hit by ${m.label}.` : 'Knocked down.'),
      by: Number.isInteger(m.by) ? m.by : -1,
      speed: sp,
    });
  },

  devActions: [
    {
      label: 'Knockdown: fall over here',
      hint: 'On foot: as if a car hit you from behind at 30 km/h',
      run(sim) {
        if (!onFoot.active) return;
        const h = onFoot.walker.heading * D2R;
        knockDown(sim, { cause: 'test', vel: { x: Math.sin(h) * 8, y: 0, z: -Math.cos(h) * 8 }, hitY: 0.6, words: 'Knocked down.', force: true });
      },
    },
  ],
});

/** For the tests, the console and pilot-mp.js. */
export const knockdown = {
  get down() {
    return K.down;
  },
  get t() {
    return K.t;
  },
  get count() {
    return K.count;
  },
  get cause() {
    return K.cause;
  },
  get words() {
    return K.words;
  },
  get by() {
    return K.by;
  },
  get gotUp() {
    return K.gotUp;
  },
  get gettingUp() {
    return K.up.on;
  },
  get immune() {
    return Math.max(0, K.immune);
  },
  get showedWasted() {
    return K.showedWasted;
  },
  get last() {
    return K.last;
  },
  get ragdoll() {
    return K.rd;
  },
  /** The movers this game is looking at right now (gathered afresh). */
  movers(sim) {
    if (!onFoot.active) return [];
    return gather(sim || K.sim).map((m) => ({ kind: m.kind, x: m.x, z: m.z, heading: m.heading, speed: Math.hypot(m.vx, m.vz), words: m.words, by: m.by }));
  },
  history: K.history,
  /** For the tests: end a knock-down now (gets up at once). */
  getUpNow(sim) {
    if (K.down) getUp(sim || K.sim);
  },
  /** For the tests: take the WASTED screen down without waiting. */
  endWasted,
};

/**
 * The cast: everybody in a seat's story who is not you.
 *
 * When you fly the lead fighter in a hijack, the airliner, its captain, the
 * wingman and the police are still there and still doing their parts — the
 * game flies them. This file holds whichever story is running: it is started
 * when a seat's mission starts (the roles feature calls castStart from its
 * startMode hook), stepped every frame, and taken down when the flight ends.
 * It keeps running after the mission's last step is ticked, so the airliner
 * still rolls to a stop and the police still arrive while you fly home.
 *
 * A story is registered by the seat file that writes it:
 *
 *   registerStory('hijack-real-lead', (sim, def) => ({
 *     id, actors: { airliner, wing },        // things with pos/vel/quat/heading
 *     update(sim, dt), dispose(sim),
 *     camera(sim, dt, camera),               // optional: true to own the camera
 *     signal(kind, from),                    // optional: see below
 *     info(out),                             // fill the plain castInfo() object
 *   }));
 *
 * The seat's mission steps read the story back through castStory(id) and
 * castInfo(), and give up politely through castSkip() if the roles feature
 * has been switched off (the same rule as orSkip in src/game/extra/events.js).
 *
 * MULTIPLAYER, LATER (nothing of it is built). The seat data is per seat and
 * keyed by stable ids, so friends could take seats on top of the existing
 * events channel the way race.js and mpworld.js use it:
 *   - a "Mission together" lobby card; the host picks a mission with roles and
 *     keeps ch.setState('role:seats', { captain: playerId|null, lead: … });
 *     empty seats are flown by the game, exactly as in single player;
 *   - the host runs this file — the story and the brains for empty seats —
 *     and publishes castInfo() as host state ('role:story', 2-5 Hz). That is
 *     why castInfo() is plain data with vectors as arrays. NPC poses go out
 *     the way mpworld already relays the host's AI aeroplanes;
 *   - each client runs the mission runner for its own seat only, and its
 *     steps read castInfo() — behind a door like ../../features/events/bridge.js
 *     it would answer from the host's state in a shared game and from here
 *     in a single-player one, so the step code is the same;
 *   - one seat acting on another is a typed event the host checks:
 *     ch.define('role:signal', { from: 'anyone', validate, rate }) carrying
 *     castSignal(kind, from) — rock, gear, breakaway. That is why everything
 *     one seat does to another goes through castSignal() now, never through
 *     a read of sim.aircraft in another seat's code;
 *   - a brain reads the other actors' poses through castActor(id), the same
 *     inputs a person has, so when a human takes a seat the host stops that
 *     brain and reads the player's pose instead.
 * The big cost later is the captain seat: it runs on hijack.js, which is
 * written from the captain's side, and would have to be split into a
 * seat-neutral story (on the host) and a captain's view (cards, keys).
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt } from '../../world/terrain.js';
import * as SFX from '../../features/events/sfx.js';
import * as UI from '../../features/events/ui.js';
import { createPoliceCar, createVan, flashPolice } from '../../features/events/vehicles.js';
import { addPolice, removePolice, runwayFrame, RW, bearing, flat, angleDiff } from '../../features/events/common.js';

const STORIES = new Map();

export function registerStory(id, factory) {
  STORIES.set(id, factory);
}

export function storyIds() {
  return [...STORIES.keys()];
}

const C = { sim: null, def: null, story: null, frames: 0, t: 0, startErr: null };

/** A seat's mission has started: build its story. False if this flight has none. */
export function castStart(sim, mode, def) {
  castStop(sim);
  C.sim = sim;
  C.startErr = null;
  if (mode !== 'mission' || !def || !def.roleId || !def.cast) return false;
  const make = STORIES.get(def.cast.story);
  if (!make) {
    C.startErr = `no story "${def.cast.story}"`;
    console.warn(`[roles] ${C.startErr}`);
    return false;
  }
  C.def = def;
  C.t = 0;
  C.story = make(sim, def);
  return !!C.story;
}

export function castStop(sim) {
  const st = C.story;
  C.story = null;
  C.def = null;
  clearInfo();
  if (st && typeof st.dispose === 'function') {
    try {
      st.dispose(sim || C.sim);
    } catch (e) {
      console.warn('[roles] a story would not tidy up', e);
    }
  }
}

export function castUpdate(sim, dt) {
  C.frames++;
  C.sim = sim;
  if (!C.story) return;
  C.t += dt;
  C.story.update(sim, dt);
}

export function castCamera(sim, dt, camera) {
  return !!(C.story && typeof C.story.camera === 'function' && C.story.camera(sim, dt, camera));
}

/** Counts up every frame the roles feature runs; stands still when it is off. */
export function castHeartbeat() {
  return C.frames;
}

/** The running story, if it is the one asked for. */
export function castStory(id) {
  return C.story && (!id || C.story.id === id) ? C.story : null;
}

export function castSim() {
  return C.sim;
}

/** One of the story's actors (the airliner, the wingman), live. */
export function castActor(id) {
  const a = C.story && C.story.actors;
  return a ? a[id] || null : null;
}

/** Something one seat does to another: 'rock', 'gear', 'breakaway'. */
export function castSignal(kind, from) {
  if (!C.story || typeof C.story.signal !== 'function') return false;
  return !!C.story.signal(kind, from);
}

/*
 * What the steps, the tests and — one day — the other players read. One
 * plain object, rewritten in place; vectors as [x, y, z].
 */
const INFO = { live: false, story: null, seat: null, t: 0 };

/* The story's own keys go when the story does, so a test never reads a stale one. */
function clearInfo() {
  for (const k of Object.keys(INFO)) if (k !== 'live' && k !== 'story' && k !== 'seat' && k !== 't') delete INFO[k];
}

export function castInfo() {
  INFO.live = !!C.story;
  INFO.story = C.story ? C.story.id : null;
  INFO.seat = C.def ? C.def.roleId : null;
  INFO.t = C.t;
  if (C.story && typeof C.story.info === 'function') C.story.info(INFO);
  return INFO;
}

/**
 * For a step waiting on the story: give up after a few seconds, with a word,
 * if the roles feature has stopped running (switched off for throwing) or
 * the story never started. Mirrors orSkip in src/game/extra/events.js.
 */
export function castSkip(ctx, dt, why) {
  const hb = C.frames;
  const alive = !!C.story;
  if (hb !== ctx.data.castHb && alive) {
    ctx.data.castHb = hb;
    ctx.data.castStale = 0;
    return false;
  }
  ctx.data.castStale = (ctx.data.castStale || 0) + (dt || 1 / 60);
  if (ctx.data.castStale > 4) {
    ctx.data.castStale = 0;
    if (ctx.sim && ctx.sim.hud) ctx.sim.hud.notify(why, 'info', 4);
    return true;
  }
  return false;
}

/* ================================================================== *
 * Things more than one story needs
 * ================================================================== */

/**
 * The ring that shows where to hold formation. A thin hoop, no glow and no
 * chevrons — a mission's checkpoint ring is something to fly THROUGH, and
 * this is a place to sit in. Blue outside it, green inside.
 */
export class SlotRing {
  constructor(scene, radius = 16) {
    this.scene = scene;
    this.mat = new THREE.MeshBasicMaterial({ color: 0x58c6ff, transparent: true, opacity: 0.75, depthWrite: false });
    this.mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.9, 6, 40), this.mat);
    this.mesh.name = 'roles-slot-ring';
    this.mesh.visible = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
    this.inside = false;
  }

  show(pos, headingDeg, inside) {
    this.mesh.visible = true;
    this.mesh.position.copy(pos);
    this.mesh.rotation.set(0, (-headingDeg * Math.PI) / 180, 0);
    if (inside !== this.inside) {
      this.inside = inside;
      this.mat.color.setHex(inside ? 0x4fd684 : 0x58c6ff);
    }
  }

  hide() {
    this.mesh.visible = false;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}

/**
 * "Hold B to look at him": the camera just behind you, on the line to him,
 * with a longer lens the further away he is. The rig eases the field of
 * view back when B is let go (as it does after hijack.js's look-back).
 */
const PAD_POS = new THREE.Vector3();
const PAD_DIR = new THREE.Vector3();
export function padlock(sim, dt, camera, target, span = 60) {
  const ac = sim.aircraft;
  if (!ac || !target) return false;
  PAD_DIR.subVectors(target, ac.pos);
  const d = PAD_DIR.length();
  if (d < 1) return false;
  PAD_DIR.multiplyScalar(1 / d);
  PAD_POS.copy(ac.pos).addScaledVector(PAD_DIR, -26);
  PAD_POS.y += 7;
  const floor = heightAt(PAD_POS.x, PAD_POS.z) + 3;
  if (PAD_POS.y < floor) PAD_POS.y = floor;
  camera.position.copy(PAD_POS);
  camera.lookAt(target);
  // Big enough to read: the airliner about a third of the picture across.
  const fov = Math.max(10, Math.min(55, ((2 * Math.atan((span * 1.6) / Math.max(1, d))) * 180) / Math.PI));
  camera.fov += (fov - camera.fov) * Math.min(1, dt * 4);
  camera.updateProjectionMatrix();
  return true;
}

/* ------------------------------------------------------------------ *
 * The police, when the airliner has stopped.
 *
 * Another builder is giving the airports emergency services; when they
 * exist they are asked first — sim.emergencyServices.respond(plane,
 * { kind: 'hijack' }), whose answer is read for `.arrived` and `.boarded` —
 * with `plane` the NPC airliner itself (pos, heading, forward(), span). Until
 * then this small version does it: three police cars and a van race in
 * along the runway from both ends, lights flashing, park round the aeroplane,
 * and the tactical team goes aboard.
 * ------------------------------------------------------------------ */

const DRIVE_RUSH = { maxSpeed: 24, accel: 9, stopAt: 2.5, turnRate: 110 };
const T1 = new THREE.Vector3();

export class PoliceResponse {
  constructor(sim, plane) {
    this.sim = sim;
    this.plane = plane;
    this.cars = [];
    this.spots = [];
    this.t = 0;
    this.arrived = false;
    this.boarded = false;
    this.ext = null;
    this.siren = null;
    const es = sim && sim.emergencyServices;
    if (es && typeof es.respond === 'function') {
      try {
        this.ext = es.respond(plane, { kind: 'hijack' }) || null;
      } catch (e) {
        console.warn('[roles] emergency services would not respond; the police come anyway', e);
        this.ext = null;
      }
    }
    if (!this.ext) this.build();
  }

  build() {
    const sim = this.sim;
    const p = this.plane;
    const f = p.forward(new THREE.Vector3());
    const l = new THREE.Vector3(f.z, 0, -f.x);
    const len = p.length || p.span;
    const w = p.span;
    const P = (a, b) => new THREE.Vector3().copy(p.pos).addScaledVector(f, a).addScaledVector(l, b);
    this.spots = [P(len * 0.5 + 16, 3), P(len * 0.05, -(w * 0.5 + 9)), P(-(len * 0.5 + 14), 0), P(-len * 0.08, w * 0.06 + 13)];
    runwayFrame();
    for (let i = 0; i < this.spots.length; i++) {
      const sgn = i % 2 ? 1 : -1;
      let x = p.pos.x + RW.f.x * sgn * (340 + i * 20);
      let z = p.pos.z + RW.f.z * sgn * (340 + i * 20);
      // Never out of the sea: walk the start in until it is on land.
      for (let k = 0; k < 20 && heightAt(x, z) < 1; k++) {
        x += (p.pos.x - x) * 0.15;
        z += (p.pos.z - z) * 0.15;
      }
      addPolice(sim, this.cars, x, z, bearing(T1.set(x, 0, z), p.pos), i === 1 ? createVan : createPoliceCar);
    }
    this.siren = new SFX.Loop(sim, 'hilo', 0.06);
  }

  update(dt) {
    this.t += dt;
    if (this.ext) {
      this.arrived = !!this.ext.arrived || !!this.ext.boarded;
      this.boarded = !!this.ext.boarded;
      return;
    }
    let n = 0;
    for (let i = 0; i < this.cars.length; i++) {
      const s = this.spots[i] || this.spots[0];
      if (this.cars[i].driveTo(s.x, s.z, dt, DRIVE_RUSH) < 6) n++;
    }
    if (!this.arrived && (n === this.cars.length || this.t > 40)) {
      this.arrived = true;
      this.arrivedAt = this.t;
    }
    if (this.arrived && !this.boarded && this.t - this.arrivedAt > 9) this.boarded = true;
    flashPolice(this.t);
    if (this.siren && this.sim.camera) {
      let near = Infinity;
      for (const d of this.cars) near = Math.min(near, this.sim.camera.position.distanceTo(d.pos));
      this.siren.set(this.boarded ? 0 : SFX.falloff(near, 50, 1500), dt);
    }
  }

  dispose() {
    if (this.siren) this.siren.stop();
    this.siren = null;
    if (this.ext && typeof this.ext.dispose === 'function') {
      try {
        this.ext.dispose();
      } catch (e) {
        /* theirs to tidy */
      }
    }
    removePolice(this.sim, this.cars);
  }
}

/* ------------------------------------------------------------------ *
 * Small geometry for formation flying
 * ------------------------------------------------------------------ */

/**
 * Where `p` is in an aircraft's own frame, ignoring its pitch and bank:
 * x to its right, y up, z BEHIND it (so a slot "160 m back" is z = 160).
 */
export function localOf(plane, p, out) {
  const h = (plane.heading * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  const dx = p.x - plane.pos.x;
  const dz = p.z - plane.pos.z;
  out.x = dx * -fz + dz * fx;
  out.y = p.y - plane.pos.y;
  out.z = -(dx * fx + dz * fz);
  return out;
}

/** The world point at a local (x right, y up, z behind) offset from an aircraft. */
export function worldOf(plane, x, y, z, out) {
  const h = (plane.heading * Math.PI) / 180;
  const fx = Math.sin(h);
  const fz = -Math.cos(h);
  out.set(plane.pos.x + -fz * x - fx * z, plane.pos.y + y, plane.pos.z + fx * x - fz * z);
  return out;
}

/**
 * How near `p` is to hitting the aeroplane: 0 or less is inside its shape
 * (a fuselage and a wing, as a cross of boxes), otherwise metres of room.
 */
const L1 = { x: 0, y: 0, z: 0 };
export function clearanceTo(plane, p) {
  localOf(plane, p, L1);
  const ax = Math.abs(L1.x);
  const ay = Math.abs(L1.y);
  const az = Math.abs(L1.z);
  const len = plane.length || plane.span;
  // The fuselage, nose to tail, and its fin.
  const body = Math.max(ax - 4, ay - (L1.y > 0 ? 12 : 5), az - len * 0.5);
  // The wings: span wide, a chord deep, a few metres thick.
  const wing = Math.max(ax - plane.span * 0.5, ay - 3, az - plane.span * 0.16);
  return Math.min(body, wing);
}

/** Wings rocked: past 12 degrees each way within eight seconds (hijack.js's own rule). */
export class RockWatch {
  constructor() {
    this.reset();
  }

  reset() {
    this.L = false;
    this.R = false;
    this.win = 0;
  }

  /** @returns {boolean} true the frame both ways have been seen */
  update(dt, bankDeg) {
    if (bankDeg < -12) {
      if (!this.L) this.win = 0;
      this.L = true;
    }
    if (bankDeg > 12) {
      if (!this.R) this.win = 0;
      this.R = true;
    }
    if (this.L || this.R) this.win += dt;
    if (this.win > 8 && !(this.L && this.R)) this.reset();
    return this.L && this.R;
  }
}

/**
 * The breakaway, ICAO "you may proceed": an abrupt climbing turn of ninety
 * degrees or more, away. Judged over the last twelve seconds of heading and
 * height, kept four times a second, so it allocates nothing after it is built.
 */
export class BreakWatch {
  constructor() {
    this.n = 52;
    this.t = new Float32Array(this.n);
    this.h = new Float32Array(this.n);
    this.y = new Float32Array(this.n);
    this.reset();
  }

  reset() {
    this.i = 0;
    this.count = 0;
    this.acc = 0;
    this.clock = 0;
    this.unwrapped = 0;
    this.last = null;
    this.y0 = 0;
  }

  update(dt, headingDeg, y) {
    this.clock += dt;
    if (this.last === null) this.last = headingDeg;
    this.unwrapped += angleDiff(this.last, headingDeg);
    this.last = headingDeg;
    this.y0 = y;
    this.acc += dt;
    if (this.acc >= 0.25 || this.count === 0) {
      this.acc = 0;
      this.t[this.i] = this.clock;
      this.h[this.i] = this.unwrapped;
      this.y[this.i] = y;
      this.i = (this.i + 1) % this.n;
      this.count = Math.min(this.n, this.count + 1);
    }
    return this;
  }

  /**
   * Was there, in the last `window` seconds, a turn of at least `turn`
   * degrees (to the left if dir < 0, the right if dir > 0, either if 0)
   * with a climb of at least `climb` metres since it began?
   */
  found(turn, climb, dir = 0, window = 12) {
    for (let k = 0; k < this.count; k++) {
      if (this.clock - this.t[k] > window) continue;
      const dh = this.unwrapped - this.h[k];
      const way = dir < 0 ? -dh : dir > 0 ? dh : Math.abs(dh);
      if (way >= turn && this.y0 - this.y[k] >= climb) return true;
    }
    return false;
  }
}

export { flat, angleDiff, bearing };

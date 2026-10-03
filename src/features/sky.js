/**
 * THE SKY — everybody else who is flying, in one list.
 *
 * The owner, 2026-10-02: "as captain you can hit other planes, including
 * NPCs — this goes to all missions", and "each plane has a new minimap,
 * remember that".
 *
 * Until now the other aircraft were drawn by seven different modules — the
 * traffic, the mayday's two rescue aeroplanes, the chase's pursuers, the
 * hijack's fighter jets, the roles' airliner and wingman, Air Force One's
 * drones, the host's aeroplanes in a shared world — and every one of them
 * was "a picture with a position, not a collider": you flew straight
 * through it. Only the traffic ever reached the minimap, through sim.traffic.
 *
 * This is the one place they all REGISTER (registerBody / unregisterBody),
 * and it does two things with the list:
 *
 *   COLLISIONS. Every frame the aeroplane you fly is tested against every
 *   body: two spheres, 0.7 of what is drawn — the same BODY rule bump.js
 *   uses between players — plus bump.js's own swept test for a head-on at
 *   a hundred metres a second, where the frames can skip the overlap. A hit
 *   is a CRASH through the aircraft's own crash(), so the crash system, the
 *   crash cam, the debrief, the mission's fail and the mark on the minimap
 *   all follow exactly as for any crash — with its own kind, "Mid-air bump!"
 *   (./crashes/kinds.js: surfaceKind 'aircraft'). The other aircraft is told
 *   (body.hit) and its owner knocks it down its own way: the traffic tumbles
 *   and is retired, a jet or the airliner falls out of the sky and comes to
 *   rest, a drone pops in sparkles. Its crew come down under parachutes
 *   (the eject feature's own canopy), because this is a game for ten-year-
 *   olds: no fire, nobody hurt, "everybody got out".
 *
 *   THE MINIMAP reads the same list (sim.aircraftAround.bodies, src/ui/minimap.js
 *   drawTraffic) and draws every body: you white, friends green, NPCs pale
 *   blue (amber or red when the warning system flags them), enemies red; a
 *   drone as a small diamond, a helicopter as a rotor disc. Nothing new is
 *   pushed into sim.traffic, so the warning system, the walking pilot and
 *   the other readers of sim.traffic see exactly what they always did.
 *
 * A BODY is a plain object its owner keeps current, read live every frame:
 *
 *   {
 *     id        string   stable and unique: 'traffic-3', 'escort-left', 'npc-airliner', 'drone-2'
 *     kind      'traffic' | 'npc' | 'friend' | 'enemy'   (how the map colours it)
 *     name      string   for the crash reason: "You flew into Island 47"
 *     bodyName  string   the same, when `name` is already spoken for (the traffic's is its type)
 *     pos       Vector3  a live reference, never a copy
 *     vel       Vector3  live, or null (then worked out from how it moves)
 *     radius    number   metres, half of what is drawn; scaled by BODY here
 *     heading   number   degrees, or absent (the map works it out from motion)
 *     onGround  boolean
 *     rotor     boolean  drawn as a helicopter
 *     small     boolean  drawn as a diamond (a drone), no crew
 *     crew      number   parachutes to drop when hit (default 1; 0 for a drone)
 *     uniform   string   uniforms.js id for the crew ('casual' by default)
 *     hit(sim, info)     what to do when the player flies into it
 *     tick(dt)           optional: stepped here every frame — for a knocked
 *                        aircraft whose owner has stopped flying it (a story
 *                        that ended, a chase whose mission failed), so it
 *                        still comes down
 *     gone      boolean  set by the owner (or unregisterBody) when disposed
 *   }
 *
 * The traffic registers its published sim.traffic entry itself, so a body
 * and a sim.traffic entry can be the same object; the mayday's rescue
 * aeroplanes, which main.js puts in sim.traffic as bare { pos } records,
 * are wrapped here as friends. Nothing is allocated per frame once the
 * bodies exist: scratch vectors live at module scope, the per-body contact
 * record is made once per body, and the published array is the live one.
 *
 * SAFE MOMENTS, as bump.js has them: nothing is hit for the first three
 * seconds of a flight (no spawn-bumps), and two that find themselves inside
 * each other at the first touch without having flown into each other —
 * somebody was placed there — are ghosts to each other until they are
 * properly apart. On the ground, a creep of under 1.5 m/s is never a crash:
 * a slow taxi into a parked wing is the "stuck" rule's business, not a wreck.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { heightAt, platformAt } from '../world/terrain.js';
import { SPEC } from '../aircraft/physics.js';
import { dimsFrom } from './crashes/motion.js';
import { contact, swept, flewInto, BODY, APART, STUCK_START, STUCK_MS } from './bump.js';
import { toon } from './mpplay/shared.js';
import { ChuteModel } from './eject/chute.js';
import { createUniformPerson, poseHanging } from './uniforms.js';

export { BODY };
/** Seconds after a flight starts before anything can be hit. */
export const SPAWN_SAFE_S = 3;
/** On the ground, closing slower than this is a nudge, not a crash. */
export const GROUND_MIN_CLOSING = 1.5;
/** At most this many parachutes in the air at once. */
export const MAX_CHUTES = 8;
/** Seconds a landed parachute lies on the ground before it is tidied away. */
const CHUTE_REST_S = 6;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const K = {
  sim: null,
  /** The live list; also sim.aircraftAround.bodies. */
  bodies: [],
  pub: { bodies: null, n: 0, clock: 0 },
  /** body -> { prev: {x,y,z}|null, prevAt, since, stuck, vx, vy, vz, lx, ly, lz, lt } */
  pairs: new Map(),
  /** Wrappers for bare sim.traffic records (the mayday's rescue aeroplanes). */
  wraps: new WeakMap(),
  wrapSeen: new Set(),
  clock: 0,
  safeUntil: 0,
  me: { r: 4.2, typeId: null, L: 9, semi: 6 },
  chutes: [],
  warned: false,
  stats: { collisions: 0, byKind: {}, byName: {}, chutes: 0, stuck: 0, swept: 0, skippedSafe: 0, skippedCreep: 0, wrapped: 0, registered: 0, ms: 0, msMax: 0, frames: 0 },
  last: null,
};
K.pub.bodies = K.bodies;

const AT = new THREE.Vector3();
const MINE = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 4, flat: false };
const OTHER = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, r: 6, flat: false };
const REL = { x: 0, y: 0, z: 0 };
const RELV = { x: 0, y: 0, z: 0 };
const PREV = { x: 0, y: 0, z: 0 };

/* ------------------------------------------------------------------ *
 * The list
 * ------------------------------------------------------------------ */

/**
 * Add a body (see the header for its shape). Returns it. Registering the
 * same object twice is a no-op; an object without a position is refused.
 */
export function registerBody(b) {
  if (!b || !b.pos || typeof b.pos.x !== 'number') return null;
  if (b.__sky) {
    b.gone = false;
    if (!K.bodies.includes(b)) K.bodies.push(b);
    return b;
  }
  b.__sky = true;
  b.gone = false;
  if (!b.id) b.id = `body-${K.stats.registered + 1}`;
  if (!b.kind) b.kind = 'npc';
  if (!b.name && !b.bodyName) b.name = 'another aeroplane';
  if (!(b.radius > 0)) b.radius = 6;
  if (b.crew == null) b.crew = b.small ? 0 : 1;
  K.bodies.push(b);
  K.stats.registered++;
  return b;
}

/** Take a body out (its owner has disposed it). */
export function unregisterBody(b) {
  if (!b) return;
  b.gone = true;
  const i = K.bodies.indexOf(b);
  if (i >= 0) K.bodies.splice(i, 1);
  K.pairs.delete(b);
}

/** The live list: every other aircraft in the world right now. */
export function bodies() {
  return K.bodies;
}

/**
 * Half of what an aircraft type draws, in metres — from its span or the
 * plan's length, whichever is bigger — for an owner registering a body.
 */
export function radiusOfType(type) {
  const aero = type && type.aero;
  const plan = type && type.plan;
  const span = (aero && aero.wingSpan) || (plan && plan.span) || 12;
  const length = plan && Number.isFinite(plan.tail) && Number.isFinite(plan.nose) ? plan.tail - plan.nose : 0;
  return Math.max(2, Math.max(span, length) / 2);
}

/** What the banner calls a body: "You flew into <this>". */
export function nameOf(b) {
  return (b && (b.bodyName || b.name)) || 'another aeroplane';
}

/** For the tests and the console. */
export function skyDebug() {
  return {
    K,
    stats: { ...K.stats, byKind: { ...K.stats.byKind }, byName: { ...K.stats.byName } },
    bodies: K.bodies.map((b) => ({ id: b.id, kind: b.kind, name: nameOf(b), radius: b.radius, onGround: !!b.onGround, gone: !!b.gone, x: Math.round(b.pos.x), y: Math.round(b.pos.y), z: Math.round(b.pos.z) })),
    chutes: K.chutes.length,
    last: K.last,
    me: { ...K.me },
    safeFor: Math.max(0, K.safeUntil - K.clock),
  };
}

/* ------------------------------------------------------------------ *
 * Bare sim.traffic records: wrapped as bodies
 * ------------------------------------------------------------------ */

function wrapTraffic(sim) {
  const list = sim.traffic;
  const seen = K.wrapSeen;
  seen.clear();
  if (Array.isArray(list)) {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (!e || !e.pos || e.__sky) continue;
      let w = K.wraps.get(e);
      if (!w) {
        // A bare { pos } is one of the mayday's rescue aeroplanes (main.js spawnRescue):
        // a friend. Anything else somebody publishes is treated as traffic.
        const bare = !('typeId' in e) && !('heading' in e);
        w = {
          id: e.id || `rescue-${i + 1}`,
          kind: bare ? 'friend' : 'traffic',
          name: bare ? (i === 0 ? 'Rescue One' : 'Rescue Two') : e.callsign || e.name || 'another aeroplane',
          pos: e.pos,
          vel: null,
          radius: Number.isFinite(e.span) ? e.span / 2 : 6,
          crew: 1,
          wrapped: e,
          get heading() {
            return Number.isFinite(e.heading) ? e.heading : undefined;
          },
          get onGround() {
            return !!e.onGround;
          },
        };
        K.wraps.set(e, w);
        K.stats.wrapped++;
      }
      seen.add(w);
      if (!w.__sky || w.gone) registerBody(w);
    }
  }
  // Wrappers for records that have gone (the mayday ended) go with them.
  for (let i = K.bodies.length - 1; i >= 0; i--) {
    const b = K.bodies[i];
    if (b.wrapped && !seen.has(b)) unregisterBody(b);
  }
}

/* ------------------------------------------------------------------ *
 * Collisions
 * ------------------------------------------------------------------ */

function groundAt(x, z) {
  let h = Math.max(0, heightAt(x, z));
  const deck = platformAt(x, z);
  if (deck && deck.y > h) h = deck.y;
  return h;
}

/** My own size, worked out once per aeroplane type from the flight model's strike points. */
function mySize(sim) {
  const id = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  if (K.me.typeId === id) return K.me;
  let d;
  try {
    d = dimsFrom(SPEC && SPEC.hardPoints, sim.aircraftType && sim.aircraftType.plan);
  } catch (e) {
    d = { semi: 6, L: 9 };
  }
  K.me.typeId = id;
  K.me.semi = d.semi;
  K.me.L = d.L;
  K.me.r = Math.max(2, Math.max(d.semi, d.L / 2)) * BODY;
  return K.me;
}

function canCollide(sim) {
  if (!sim || sim.state !== 'flying' || sim.mode === 'drive') return false;
  const ac = sim.aircraft;
  if (!ac || !ac.pos || ac.crashed) return false;
  if (K.clock < K.safeUntil) {
    K.stats.skippedSafe++;
    return false;
  }
  return true;
}

function pairOf(b) {
  let p = K.pairs.get(b);
  if (!p) {
    p = { prev: null, prevAt: 0, since: 0, stuck: false, vx: 0, vy: 0, vz: 0, lx: b.pos.x, ly: b.pos.y, lz: b.pos.z, lt: K.clock, hasPrev: false, px: 0, py: 0, pz: 0 };
    K.pairs.set(b, p);
  }
  return p;
}

/** The body's velocity: its own, or from how far it moved since last frame. */
function velocityOf(b, p, dt) {
  if (b.vel && typeof b.vel.x === 'number') {
    p.vx = b.vel.x;
    p.vy = b.vel.y;
    p.vz = b.vel.z;
  } else if (dt > 0) {
    const dx = b.pos.x - p.lx;
    const dy = b.pos.y - p.ly;
    const dz = b.pos.z - p.lz;
    // Not a teleport (a respawn, a story placing it): keep the last estimate.
    if (dx * dx + dy * dy + dz * dz < 250000) {
      p.vx = dx / dt;
      p.vy = dy / dt;
      p.vz = dz / dt;
    }
  }
  p.lx = b.pos.x;
  p.ly = b.pos.y;
  p.lz = b.pos.z;
}

function step(sim, dt) {
  const ac = sim.aircraft;
  const me = mySize(sim);
  MINE.x = ac.pos.x;
  MINE.y = ac.pos.y;
  MINE.z = ac.pos.z;
  MINE.vx = ac.vel.x;
  MINE.vy = ac.vel.y;
  MINE.vz = ac.vel.z;
  MINE.r = me.r;
  const tMs = now();
  for (let i = 0; i < K.bodies.length; i++) {
    const b = K.bodies[i];
    if (!b || b.gone || !b.pos || !Number.isFinite(b.pos.x)) continue;
    const p = pairOf(b);
    velocityOf(b, p, dt);
    // Broad phase: anything further than a generous reach is skipped before any maths.
    const reachMax = (me.r + b.radius * BODY) + 60;
    const dx = MINE.x - b.pos.x;
    const dy = MINE.y - b.pos.y;
    const dz = MINE.z - b.pos.z;
    if (dx * dx + dy * dy + dz * dz > reachMax * reachMax) {
      p.since = 0;
      p.hasPrev = false;
      continue;
    }
    OTHER.x = b.pos.x;
    OTHER.y = b.pos.y;
    OTHER.z = b.pos.z;
    OTHER.vx = p.vx;
    OTHER.vy = p.vy;
    OTHER.vz = p.vz;
    OTHER.r = Math.max(1.5, b.radius * BODY);
    const reach = MINE.r + OTHER.r;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (p.stuck) {
      if (d > reach * APART) p.stuck = false;
      else continue;
    }
    REL.x = dx;
    REL.y = dy;
    REL.z = dz;
    const recent = p.hasPrev && tMs - p.prevAt < 400;
    let c = contact(MINE, OTHER);
    if (!c && recent) {
      // Through each other since the last frame: still a hit (bump.js's swept test).
      PREV.x = p.px;
      PREV.y = p.py;
      PREV.z = p.pz;
      c = swept(PREV, REL, MINE, OTHER);
      if (c) K.stats.swept++;
    }
    let flew = false;
    if (recent) {
      PREV.x = p.px;
      PREV.y = p.py;
      PREV.z = p.pz;
      RELV.x = MINE.vx - OTHER.vx;
      RELV.y = MINE.vy - OTHER.vy;
      RELV.z = MINE.vz - OTHER.vz;
      flew = flewInto(PREV, REL, RELV, (tMs - p.prevAt) / 1000, reach, false);
    }
    p.px = dx;
    p.py = dy;
    p.pz = dz;
    p.prevAt = tMs;
    p.hasPrev = true;
    if (!c) {
      p.since = 0;
      continue;
    }
    // Inside each other without having flown there (a spawn, a story placing
    // one on top of you), or touching for a whole second: ghosts until apart.
    if ((!p.since && c.frac > STUCK_START && !flew) || (p.since && tMs - p.since > STUCK_MS)) {
      p.stuck = true;
      p.since = 0;
      K.stats.stuck++;
      continue;
    }
    if (!p.since) p.since = tMs;
    // On the ground a creep is not a crash.
    if (ac.onGround && b.onGround && c.closing < GROUND_MIN_CLOSING) {
      K.stats.skippedCreep++;
      continue;
    }
    collide(sim, b, c);
    return;
  }
}

function collide(sim, b, c) {
  const ac = sim.aircraft;
  AT.set((ac.pos.x + b.pos.x) / 2, (ac.pos.y + b.pos.y) / 2, (ac.pos.z + b.pos.z) / 2);
  const onGround = !!(ac.onGround && b.onGround);
  const name = nameOf(b);
  K.stats.collisions++;
  K.stats.byKind[b.kind] = (K.stats.byKind[b.kind] || 0) + 1;
  K.stats.byName[name] = (K.stats.byName[name] || 0) + 1;
  K.last = { id: b.id, kind: b.kind, name, closing: Math.round(c.closing * 10) / 10, onGround, t: K.clock, x: Math.round(AT.x), y: Math.round(AT.y), z: Math.round(AT.z) };
  // Theirs first, so an owner that reads the player's state sees it still flying.
  try {
    if (typeof b.hit === 'function') b.hit(sim, { closing: c.closing, nx: c.nx, ny: c.ny, nz: c.nz, at: AT, onGround });
  } catch (err) {
    if (!K.warned) console.warn(`[sky] "${b.id}" would not take the hit:`, err);
    K.warned = true;
  }
  dropCrew(sim, b);
  try {
    toon.puff(AT, '#ffffff', { n: 12, size: 5 + Math.min(5, c.closing * 0.1), spread: 9, life: 1.3, up: 2 });
  } catch (e) {
    /* the puff is decoration */
  }
  const reason = onGround ? `You taxied into ${name}` : `You flew into ${name}`;
  ac.crash(reason, { part: 'fuselage', surfaceKind: 'aircraft', worldPoint: AT.clone(), other: b.id, otherKind: b.kind });
}

/* ------------------------------------------------------------------ *
 * The crew, under parachutes
 * ------------------------------------------------------------------ */

function dropCrew(sim, b) {
  const n = Math.max(0, Math.min(3, b.small ? 0 : b.crew == null ? 1 : b.crew));
  if (!n || !sim.scene) return;
  const p = K.pairs.get(b);
  for (let i = 0; i < n; i++) {
    if (K.chutes.length >= MAX_CHUTES) break;
    let person = null;
    try {
      person = createUniformPerson(b.uniform || 'casual', { seed: 3 + i + K.stats.chutes });
    } catch (e) {
      person = null;
    }
    if (!person) person = new THREE.Group();
    let model;
    try {
      model = new ChuteModel(person, { uniform: b.uniform || 'casual', seat: false });
      model.addTo(sim.scene);
    } catch (e) {
      return;
    }
    const f = {
      pos: new THREE.Vector3(b.pos.x + (i - (n - 1) / 2) * 4, b.pos.y + 2, b.pos.z),
      vel: new THREE.Vector3(p ? p.vx * 0.5 : 0, 4 + i, p ? p.vz * 0.5 : 0),
      heading: Number.isFinite(b.heading) ? b.heading : 0,
      open: 0,
      t: 0,
      seatOff: true,
    };
    f.vel.x += (Math.random() - 0.5) * 6;
    f.vel.z += (Math.random() - 0.5) * 6;
    K.chutes.push({ model, person, f, landed: false, rest: 0 });
    K.stats.chutes++;
  }
}

function stepChutes(sim, dt) {
  if (!K.chutes.length) return;
  for (let i = K.chutes.length - 1; i >= 0; i--) {
    const ch = K.chutes[i];
    const f = ch.f;
    const ground = groundAt(f.pos.x, f.pos.z);
    if (!ch.landed) {
      f.t += dt;
      if (f.t > 0.7) f.open = Math.min(1, f.open + dt / 1.1);
      // Free fall, then the canopy takes the fall out and the drift with it.
      f.vel.y -= 9.81 * dt * (1 - f.open);
      if (f.open > 0) {
        const want = f.pos.y - ground < 60 ? -4.5 : -8;
        f.vel.y += (want - f.vel.y) * Math.min(1, dt * 1.6 * f.open);
        const k = Math.max(0, 1 - dt * 0.9 * f.open);
        f.vel.x *= k;
        f.vel.z *= k;
      }
      f.pos.addScaledVector(f.vel, dt);
      if (f.pos.y <= ground) {
        f.pos.y = ground;
        ch.landed = true;
      }
      try {
        ch.model.sync(f, dt, 0, ground);
        poseHanging(ch.person, f.t);
      } catch (e) {
        /* a model that will not pose still floats down */
      }
    } else {
      ch.rest += dt;
      let done = false;
      try {
        done = ch.model.collapseStep(dt);
      } catch (e) {
        done = true;
      }
      if (done && ch.rest > CHUTE_REST_S) {
        disposeChute(ch);
        K.chutes.splice(i, 1);
      }
    }
  }
}

function disposeChute(ch) {
  try {
    if (ch.model.root && ch.model.root.parent) ch.model.root.parent.remove(ch.model.root);
    if (typeof ch.model.dispose === 'function') ch.model.dispose();
  } catch (e) {
    /* already gone */
  }
}

function clearChutes() {
  for (const ch of K.chutes) disposeChute(ch);
  K.chutes.length = 0;
}

/* ------------------------------------------------------------------ *
 * The plug-in
 * ------------------------------------------------------------------ */

function publish(sim) {
  K.pub.n = K.bodies.length;
  K.pub.clock = K.clock;
  if (sim.aircraftAround !== K.pub) sim.aircraftAround = K.pub;
}

registerExtension({
  id: 'sky',

  install(sim) {
    K.sim = sim;
    publish(sim);
  },

  startMode(sim) {
    K.sim = sim;
    K.safeUntil = K.clock + SPAWN_SAFE_S;
    K.pairs.clear();
    clearChutes();
    K.last = null;
    publish(sim);
  },

  stop(sim, why) {
    K.pairs.clear();
    if (why !== 'airport') clearChutes();
    K.safeUntil = K.clock + SPAWN_SAFE_S;
  },

  update(sim, dt) {
    const t0 = now();
    K.sim = sim;
    if (!(dt > 0)) dt = 1 / 60;
    if (dt > 0.25) dt = 0.25;
    K.clock += dt;
    wrapTraffic(sim);
    // Bodies whose owners marked them gone without unregistering; and the knocked ones that ask to be stepped here.
    for (let i = K.bodies.length - 1; i >= 0; i--) {
      const b = K.bodies[i];
      if (b.gone) {
        unregisterBody(b);
        continue;
      }
      if (typeof b.tick === 'function') {
        try {
          b.tick(dt);
        } catch (err) {
          if (!K.warned) console.warn(`[sky] "${b.id}" would not tick:`, err);
          K.warned = true;
        }
      }
    }
    publish(sim);
    stepChutes(sim, dt);
    if (canCollide(sim)) step(sim, dt);
    else K.pairs.clear();
    const ms = now() - t0;
    const st = K.stats;
    st.frames++;
    st.ms = st.ms * 0.95 + ms * 0.05;
    if (st.frames > 30 && ms > st.msMax) st.msMax = ms;
  },
});

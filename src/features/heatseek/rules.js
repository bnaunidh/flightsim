/**
 * HEAT-SEEKING MISSILES — the rules. Plain numbers in, plain numbers out: no
 * three.js, no DOM, so node can fly a missile at a target and count what
 * happens (tests/features/heat-seekers.mjs).
 *
 * "heat seeking missles on miltary pllanes and it as a disaster", and then
 * "only get 3" (the owner, 2026-10-12). So:
 *
 *   - three missiles a flight on every military aeroplane, one lock-on at a
 *     time, rearmed by landing and stopping at an airbase or a carrier;
 *   - a seeker looks about 20 degrees ahead; a valid hot target held in that
 *     cone for a second is LOCKED, and only then will the missile go;
 *   - the missile is a proportional-navigation homer: a short motor burn, then
 *     it coasts, turning its velocity to null the rate at which the line of
 *     sight to the target is turning. That is the whole of how a real one
 *     catches an aeroplane — it flies to where the target WILL be — and it is
 *     also why it can be beaten: it has only so much turn in it, so a hard
 *     break at short range is more than it can follow, and a flare is a
 *     hotter point than the engine for a few seconds.
 *
 * SCHOOL-SAFE, ON PURPOSE. The only things a heat-seeker may ever lock are
 * unmanned: the drones of Air Force One - Under Attack, the practice target
 * drones a pilot can spawn in Free Flight, and — only when the PvP switch is
 * on, for both players — the other player's aeroplane, where a hit is the
 * "tagged out" of PvP (the pilot ejects, the shield comes up, nobody is
 * hurt). Civilian traffic, airliners, Air Force One and the rescue aeroplanes
 * are never targets: `targetVerdict()` says so, and the node test feeds it
 * every kind of body the game has.
 */

export const D2R = Math.PI / 180;
export const G = 9.80665;

/** Missiles a military aeroplane carries on a flight. */
export const LOADOUT = 3;
/** Flares a military aeroplane carries (and everybody else during the Heat-Seeker disaster). */
export const FLARE_CHARGES = 8;

/** The seeker: a cone about 20 degrees across, ahead of the nose. */
export const SEEKER = {
  halfDeg: 10,
  /** Seconds in the cone before the box goes red. */
  lockSeconds: 1.0,
  /** Once locked, the target may drift this far off the nose before the lock is lost. */
  holdDeg: 24,
  /** A target out of the cone for less than this does not reset the count. */
  graceSeconds: 0.3,
  /** Closer than this and the seeker cannot pick one out; further than this it is not hot enough to see. */
  minRange: 120,
  maxRange: 2800,
};

/**
 * What a missile can do. `player` is the military jet's own; `slow` is what
 * the Heat-Seeker disaster fires at a helicopter — slower and not as keen,
 * "easier to dodge". Metres and seconds.
 */
export const FLIGHT = {
  player: { boostS: 1.7, boostAccel: 150, vMax: 430, drag: 7e-5, gMax: 30, nav: 4, gimbalDeg: 55, fuze: 12, lifeS: 12, rangeCap: 3400, spentSpeed: 130 },
  // The disaster's, at an aeroplane: fired from a few kilometres, so it has a little less turn than a jet's own.
  threat: { boostS: 1.6, boostAccel: 130, vMax: 370, drag: 9e-5, gMax: 15, nav: 3.4, gimbalDeg: 50, fuze: 12, lifeS: 14, rangeCap: 4200, spentSpeed: 110 },
  // ...and at a helicopter.
  slow: { boostS: 1.4, boostAccel: 62, vMax: 190, drag: 1.1e-4, gMax: 11, nav: 3, gimbalDeg: 45, fuze: 11, lifeS: 18, rangeCap: 4200, spentSpeed: 70 },
};

/* ------------------------------------------------------------------ *
 * What may travel between players (multiplayer events: numbers and ids only)
 * ------------------------------------------------------------------ */

const ID_MAX = 7;
const okId = (v) => Number.isInteger(v) && v >= 0 && v <= ID_MAX;
/** 'hs:launch' — I fired a heat-seeker at player t (so everybody sees it go, and t is warned). */
export const cleanLaunch = (d) => (d && okId(d.t) ? { t: d.t } : null);
/** 'hs:flare' — I dropped flares (the data is empty: where I am is already known). */
export const cleanFlare = (d) => (d === null || d === undefined || typeof d === 'object' ? {} : null);

/* ------------------------------------------------------------------ *
 * Little vector helpers on plain {x,y,z}
 * ------------------------------------------------------------------ */

export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const len = (a) => Math.hypot(a.x, a.y, a.z);
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** The angle between two vectors, degrees (180 for a zero vector: nothing is "ahead" of nothing). */
export function angleDeg(a, b) {
  const la = len(a);
  const lb = len(b);
  if (!(la > 1e-9) || !(lb > 1e-9)) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (la * lb)))) / D2R;
}

/* ------------------------------------------------------------------ *
 * Which bodies a heat-seeker may ever lock
 * ------------------------------------------------------------------ */

/** Names that are never a target, whatever else a body says about itself. */
const NEVER_NAME = /air\s*force\s*one|\baf1\b|potus|airliner|rescue|ambulance|medevac|passenger|traffic|tower|civil/i;
/** Aeroplane type ids that are airliners (and Air Force One is a 747). */
const NEVER_TYPE = /^(b747|a320|a380|meridian|b7\d\d|a3\d\d)$/i;

/**
 * May a heat-seeker lock this? A body is described by what the sky list
 * (src/features/sky.js) and the multiplayer roster already say about it:
 *
 *   { kind: 'traffic'|'npc'|'friend'|'enemy'|'player', small, crew, practice,
 *     name, typeId, civilian, pvpLive }
 *
 * `ctx.pvp` is true only when the shooter's own PvP switch is on and counted.
 * Returns { ok, why } — `why` is the reason, for the console and the tests.
 *
 *   YES  a drone (kind 'enemy', small, nobody aboard) — Air Force One's;
 *   YES  a practice target drone;
 *   YES  another player, but only with PvP on for the shooter AND that player;
 *   NO   anything civilian, any airliner, Air Force One, the rescue aeroplanes,
 *        the friends and the story's own jets, a manned enemy (the chase's
 *        pursuer), a player when PvP is off.
 */
export function targetVerdict(b, ctx = {}) {
  if (!b) return { ok: false, why: 'nothing there' };
  if (b.civilian || b.protected) return { ok: false, why: 'civilian' };
  const name = `${b.name || ''} ${b.bodyName || ''}`;
  if (NEVER_NAME.test(name)) return { ok: false, why: 'never a target (airliner, Air Force One or rescue)' };
  if (b.typeId && NEVER_TYPE.test(String(b.typeId))) return { ok: false, why: 'an airliner' };
  const kind = b.kind || 'npc';
  if (kind === 'player') {
    if (!ctx.pvp) return { ok: false, why: 'PvP is off' };
    if (!b.pvpLive) return { ok: false, why: 'that player has PvP off, is shielded or is tagged out' };
    return { ok: true, why: 'a PvP player' };
  }
  if (kind === 'traffic' || kind === 'npc' || kind === 'friend') return { ok: false, why: `${kind} is never a target` };
  if (b.practice === true && kind === 'enemy') return { ok: true, why: 'a practice target drone' };
  if (kind === 'enemy' && b.small === true && !(b.crew > 0)) return { ok: true, why: 'an unmanned drone' };
  if (kind === 'enemy') return { ok: false, why: 'manned: not a drone' };
  return { ok: false, why: 'not a drone' };
}

/* ------------------------------------------------------------------ *
 * The lock-on
 * ------------------------------------------------------------------ */

/**
 * Of `cands` ([{ id, pos:{x,y,z} }]), those inside the seeker cone ahead of
 * `origin` along the unit vector `fwd`, nearest the nose first:
 * [{ cand, offDeg, range }].
 */
export function inCone(origin, fwd, cands, { halfDeg = SEEKER.halfDeg, minRange = SEEKER.minRange, maxRange = SEEKER.maxRange } = {}) {
  const out = [];
  for (const c of cands) {
    const rel = sub(c.pos, origin);
    const range = len(rel);
    if (range < minRange || range > maxRange) continue;
    const off = angleDeg(fwd, rel);
    if (off <= halfDeg) out.push({ cand: c, offDeg: off, range });
  }
  out.sort((a, b) => a.offDeg - b.offDeg);
  return out;
}

/**
 * The lock: hold a target in the cone for `lockSeconds` and it is locked.
 * Feed it every frame; it keeps the one it is working on (a second target
 * crossing the cone does not steal it), forgives a flicker out of the cone
 * (`graceSeconds`), and once locked lets the target wander out to `holdDeg`.
 */
export class LockTracker {
  constructor(opts = {}) {
    this.halfDeg = opts.halfDeg ?? SEEKER.halfDeg;
    this.holdDeg = opts.holdDeg ?? SEEKER.holdDeg;
    this.seconds = opts.seconds ?? SEEKER.lockSeconds;
    this.grace = opts.grace ?? SEEKER.graceSeconds;
    this.minRange = opts.minRange ?? SEEKER.minRange;
    this.maxRange = opts.maxRange ?? SEEKER.maxRange;
    this.reset();
  }

  reset() {
    /** The candidate being worked on (the object passed in), or null. */
    this.target = null;
    this.t = 0;
    this.lost = 0;
    this.locked = false;
    this.off = 0;
    this.range = 0;
  }

  /** 0..1, how far the box is from red. */
  get progress() {
    return this.target ? Math.min(1, this.t / this.seconds) : 0;
  }

  /**
   * @param origin {x,y,z} the shooter, `fwd` its unit nose vector
   * @param cands [{ id, pos }] valid targets only (see targetVerdict)
   * @param only an id, or null: the lock key picked this target (../gunsight.js),
   *   so it is the only one the seeker works on — nothing else steals the lock
   *   and, if it is not a missile target (a meteor), the seeker stays idle.
   * @returns this (target, progress, locked, off, range)
   */
  update(dt, origin, fwd, cands, only = null) {
    if (only !== null && only !== undefined) cands = cands.filter((c) => c.id === only);
    if (this.target) {
      // Is the one we have still around? (A candidate list is rebuilt every frame: match by id.)
      const mine = cands.find((c) => c === this.target || (c.id != null && c.id === this.target.id));
      if (mine) {
        const rel = sub(mine.pos, origin);
        const range = len(rel);
        const off = angleDeg(fwd, rel);
        const limit = this.locked ? this.holdDeg : this.halfDeg;
        if (range >= this.minRange && range <= this.maxRange && off <= limit) {
          this.target = mine;
          this.off = off;
          this.range = range;
          this.lost = 0;
          this.t += dt;
          if (this.t >= this.seconds) this.locked = true;
          return this;
        }
      }
      this.lost += dt;
      if (this.lost <= this.grace && mine) {
        // A flicker: the count holds, and the lock (if it was one) is kept for the moment.
        return this;
      }
      this.reset();
    }
    const first = inCone(origin, fwd, cands, { halfDeg: this.halfDeg, minRange: this.minRange, maxRange: this.maxRange })[0];
    if (first) {
      this.target = first.cand;
      this.off = first.offDeg;
      this.range = first.range;
      this.t = Math.min(dt, this.seconds);
      this.lost = 0;
      this.locked = this.t >= this.seconds;
    }
    return this;
  }
}

/* ------------------------------------------------------------------ *
 * Three missiles, and getting them back
 * ------------------------------------------------------------------ */

export class Loadout {
  constructor(max = LOADOUT) {
    this.max = max;
    this.left = max;
    this.fired = 0;
  }

  /** Use one. False (and nothing changes) with none left. */
  fire() {
    if (this.left <= 0) return false;
    this.left--;
    this.fired++;
    return true;
  }

  rearm() {
    const changed = this.left !== this.max;
    this.left = this.max;
    return changed;
  }

  get label() {
    return `MSL ${this.left}/${this.max}`;
  }
}

/**
 * Landing and stopping at an airbase or a carrier puts the missiles back:
 * on the ground, on made ground (a runway, an apron, a deck), and stopped
 * (under `REARM.stopSpeed` m/s) for `HOLD_S` seconds running. Feed it every frame.
 * `update` returns true on the frame the missiles go back on.
 */
// 2.5 m/s is what the landing missions call stopped (a jet's idle thrust can keep it above 2).
export const REARM = { stopSpeed: 2.5, holdS: 2.5 };
export class RearmGate {
  constructor(opts = {}) {
    this.stopSpeed = opts.stopSpeed ?? REARM.stopSpeed;
    this.holdS = opts.holdS ?? REARM.holdS;
    this.t = 0;
  }

  reset() {
    this.t = 0;
  }

  update(dt, { onGround, speed, atBase, needs }) {
    if (!(onGround && atBase && needs && speed < this.stopSpeed)) {
      this.t = 0;
      return false;
    }
    this.t += dt;
    if (this.t >= this.holdS) {
      this.t = 0;
      return true;
    }
    return false;
  }
}

/* ------------------------------------------------------------------ *
 * Flying a missile
 * ------------------------------------------------------------------ */

/** A missile's state: plain numbers, position and velocity in world metres and m/s. */
export function newMissile(pos, vel, params = FLIGHT.player) {
  return {
    x: pos.x, y: pos.y, z: pos.z,
    vx: vel.x, vy: vel.y, vz: vel.z,
    t: 0,
    travelled: 0,
    params,
    lost: false,
    lostWhy: '',
    // What it is chasing besides the target: a flare it has been fooled by.
    decoy: null,
    tried: new Set(),
    // Where the aim point was last step, for the swept closest approach.
    pax: NaN, pay: NaN, paz: NaN,
    // Where the missile was at the start of the step.
    ox: pos.x, oy: pos.y, oz: pos.z,
    result: null,
    speed: Math.hypot(vel.x, vel.y, vel.z),
    maxLateral: 0,
  };
}

/**
 * The closest the missile came to the aim point during the step that has just
 * been taken (a missile moves 7-13 m a frame; a fuze radius of 12 m must not
 * be skipped over). Linear in the step: relative position from `d0` to `d1`.
 */
export function closestApproach(d0, d1) {
  const ex = d1.x - d0.x;
  const ey = d1.y - d0.y;
  const ez = d1.z - d0.z;
  const e2 = ex * ex + ey * ey + ez * ez;
  let s = 0;
  if (e2 > 1e-12) s = Math.max(0, Math.min(1, -(d0.x * ex + d0.y * ey + d0.z * ez) / e2));
  const px = d0.x + ex * s;
  const py = d0.y + ey * s;
  const pz = d0.z + ez * s;
  return { dist: Math.hypot(px, py, pz), s };
}

/**
 * One step of a missile. `aim` is where it is looking — { x, y, z, vx, vy, vz }
 * — the target, or the flare that has fooled it, or null if it sees nothing.
 * `env.groundAt(x, z)` gives the terrain height (the sea is 0).
 *
 * Returns the missile (mutated) with `result` set once it is over:
 *   'hit'     the fuze fired within `params.fuze` of the aim point (aim.isTarget
 *             says whether that was the target or a flare);
 *   'ground'  it flew into the sea or the land;
 *   'spent'   out of range, out of time or out of speed;
 *   'lost'    it could not see the target any more and has gone ballistic
 *             (it carries on until it is `spent`, or hits the ground).
 */
export function stepMissile(m, aim, dt, env = {}) {
  if (m.result) return m;
  const P = m.params;
  m.ox = m.x; m.oy = m.y; m.oz = m.z;
  m.t += dt;
  let speed = Math.hypot(m.vx, m.vy, m.vz);
  if (speed < 1e-6) {
    m.vx = 0; m.vy = 0; m.vz = -1; speed = 1;
  }
  let dx = m.vx / speed;
  let dy = m.vy / speed;
  let dz = m.vz / speed;

  // Guidance: pure proportional navigation, a = N (Omega x V), with Omega the
  // rate the line of sight is turning; limited by what the airframe can pull.
  let ax = 0;
  let ay = 0;
  let az = 0;
  if (aim && !m.lost) {
    const Rx = aim.x - m.x;
    const Ry = aim.y - m.y;
    const Rz = aim.z - m.z;
    const R2 = Rx * Rx + Ry * Ry + Rz * Rz;
    const R = Math.sqrt(R2);
    const cosA = R > 1e-6 ? (dx * Rx + dy * Ry + dz * Rz) / R : 1;
    const ang = Math.acos(Math.max(-1, Math.min(1, cosA))) / D2R;
    if (ang > P.gimbalDeg) {
      m.lost = true;
      m.lostWhy = 'the target left the seeker\'s view';
    } else if (R2 > 1) {
      const Vrx = (aim.vx || 0) - m.vx;
      const Vry = (aim.vy || 0) - m.vy;
      const Vrz = (aim.vz || 0) - m.vz;
      const Ox = (Ry * Vrz - Rz * Vry) / R2;
      const Oy = (Rz * Vrx - Rx * Vrz) / R2;
      const Oz = (Rx * Vry - Ry * Vrx) / R2;
      ax = P.nav * (Oy * m.vz - Oz * m.vy);
      ay = P.nav * (Oz * m.vx - Ox * m.vz);
      az = P.nav * (Ox * m.vy - Oy * m.vx);
      // Turn it can make falls off as the motor dies and the air thins its fins.
      const limit = P.gMax * G * Math.max(0.25, Math.min(1.25, (speed / 300) ** 2));
      const a = Math.hypot(ax, ay, az);
      if (a > limit) {
        const k = limit / a;
        ax *= k; ay *= k; az *= k;
      }
      m.maxLateral = Math.max(m.maxLateral, Math.min(a, limit));
    }
  }

  // Motor, then coasting against the drag.
  let s2 = speed;
  if (m.t <= P.boostS) s2 += P.boostAccel * dt;
  s2 -= P.drag * speed * speed * dt;
  s2 = Math.max(0, Math.min(P.vMax, s2));
  let nx = dx * speed + ax * dt;
  let ny = dy * speed + ay * dt;
  let nz = dz * speed + az * dt;
  if (m.lost) ny -= G * dt * 0.6; // nothing to hold it up: it sags
  const nl = Math.hypot(nx, ny, nz) || 1;
  m.vx = (nx / nl) * s2;
  m.vy = (ny / nl) * s2;
  m.vz = (nz / nl) * s2;
  m.x += m.vx * dt;
  m.y += m.vy * dt;
  m.z += m.vz * dt;
  m.speed = s2;
  m.travelled += s2 * dt;

  // The fuze: the closest the two came during this step.
  if (aim) {
    const prev = Number.isFinite(m.pax) ? { x: m.pax, y: m.pay, z: m.paz } : { x: aim.x, y: aim.y, z: aim.z };
    const d0 = { x: m.ox - prev.x, y: m.oy - prev.y, z: m.oz - prev.z };
    const d1 = { x: m.x - aim.x, y: m.y - aim.y, z: m.z - aim.z };
    const ca = closestApproach(d0, d1);
    if (ca.dist <= P.fuze) {
      m.result = 'hit';
      m.hitDist = ca.dist;
      m.hitS = ca.s;
      m.hitTarget = aim.isTarget !== false;
    }
    m.pax = aim.x; m.pay = aim.y; m.paz = aim.z;
  }
  if (!m.result) {
    const g = env.groundAt ? env.groundAt(m.x, m.z) : -Infinity;
    if (m.y <= Math.max(0, g) + 1) m.result = 'ground';
    else if (m.t > P.lifeS || m.travelled > P.rangeCap || (m.t > P.boostS && s2 < P.spentSpeed)) m.result = 'spent';
  }
  return m;
}

/* ------------------------------------------------------------------ *
 * Flares
 * ------------------------------------------------------------------ */

/** Seconds a flare burns. */
export const FLARE_LIFE = 4.5;
/** A flare this close to the line to the target can be taken for it. */
export const FLARE_CONE_DEG = 9;
/** A missile this close to the target cannot be fooled any more: it is committed. */
export const DECOY_MIN_RANGE = 90;

/**
 * Chance that a salvo of flares fools a missile: better when the target is
 * also turning hard ("a hard break and pop flares"), worse when it is just
 * flying on. `gLateral` is the sideways load the target is pulling, in g.
 */
export function decoyChance(gLateral = 0) {
  return Math.max(0.55, Math.min(0.93, 0.6 + 0.07 * Math.max(0, gLateral)));
}

/**
 * Does any flare pull this missile off? Call it each step with the target
 * and the live flares ([{ id, salvo, x, y, z, age, life }]); each salvo is
 * rolled once per missile with `rng`. Sets and returns `m.decoy` (a flare),
 * or null. A flare that has burned out lets go of it.
 */
export function considerDecoys(m, target, flares, gLateral, rng = Math.random) {
  if (m.decoy && !(m.decoy.age < (m.decoy.life || FLARE_LIFE))) {
    m.decoy = null;
    // The flare is out: if the target is still in front of it, it looks again.
    const R = { x: target.x - m.x, y: target.y - m.y, z: target.z - m.z };
    const v = { x: m.vx, y: m.vy, z: m.vz };
    if (m.lost && angleDeg(v, R) <= Math.min(25, m.params.gimbalDeg)) {
      m.lost = false;
      m.lostWhy = '';
    }
  }
  if (m.decoy || m.lost) return m.decoy;
  const toT = { x: target.x - m.x, y: target.y - m.y, z: target.z - m.z };
  const rT = len(toT);
  if (rT < DECOY_MIN_RANGE) return null;
  for (const f of flares) {
    if (!(f.age < (f.life || FLARE_LIFE))) continue;
    if (m.tried.has(f.salvo)) continue;
    const toF = { x: f.x - m.x, y: f.y - m.y, z: f.z - m.z };
    if (angleDeg(toT, toF) > FLARE_CONE_DEG) continue;
    m.tried.add(f.salvo);
    if (rng() < decoyChance(gLateral)) {
      m.decoy = f;
      return f;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * The Heat-Seeker disaster (src/features/heatseek-disaster.js)
 * ------------------------------------------------------------------ */

/** Which way to turn: put the missile on the beam. `rel` is its bearing off your nose, degrees, + to the right. */
export function breakSide(rel) {
  const r = (((rel % 360) + 540) % 360) - 180;
  if (Math.abs(r) < 90) return r > 0 ? 'left' : 'right'; // ahead of you: turn away from it
  return r > 0 ? 'right' : 'left'; // behind you: turn toward its side, to bring it round to the beam
}

/**
 * When the launchers fire in a window of `total` seconds: salvos of one or
 * two (a pair about one time in three), the first after `first` seconds, then
 * a gap of `gapMin..gapMax` between salvos — "one or two at a time with gaps
 * between them". Returns [{ at, count }]. `rng` is Math.random-shaped.
 */
export function planSalvos(total, rng = Math.random, { first = 5, gapMin = 9, gapMax = 17 } = {}) {
  const out = [];
  let t = first;
  while (t < total - 4) {
    out.push({ at: t, count: rng() < 0.33 ? 2 : 1 });
    t += gapMin + rng() * (gapMax - gapMin);
  }
  if (!out.length) out.push({ at: Math.min(first, Math.max(1, total * 0.3)), count: 1 });
  return out;
}

/**
 * The part of the aeroplane a missile that went off at `local` (metres, the
 * aeroplane's own frame: +x right, -z ahead) is nearest — the names the
 * flight model's damage uses (physics.js takeHit): leftWing, rightWing, nose,
 * tail, fuselage. A helicopter has no wings to speak of: its sides are its
 * fuselage and the aft third is the tail boom.
 */
export function nearestPart(local, dims, heli = false) {
  const semi = Math.max(1.5, dims.semi || 5);
  const L = Math.max(3, dims.L || 10);
  const noseZ = Number.isFinite(dims.noseZ) ? dims.noseZ : -L / 2;
  const tailZ = Number.isFinite(dims.tailZ) ? dims.tailZ : L / 2;
  const mid = (noseZ + tailZ) / 2;
  const along = (local.z - mid) / (L / 2); // -1 at the nose, +1 at the tail
  if (heli) return along > 0.45 ? 'tail' : 'fuselage';
  const side = local.x / semi;
  if (Math.abs(side) > 0.28 && Math.abs(along) < 0.8) return side < 0 ? 'leftWing' : 'rightWing';
  if (along < -0.45) return 'nose';
  if (along > 0.45) return 'tail';
  return 'fuselage';
}

/**
 * How bad a hit is: 0.4..0.95. `closeness` 0..1 (1 = dead centre), `u` a
 * 0..1 roll. The flight model adds a second hit to the part, so two mediums
 * make a big one. BIG_HIT and over is the engine going and the wing or tail
 * coming apart: "eject, or put her down".
 */
export function hitSeverity(closeness = 0.5, u = 0.5) {
  const s = 0.4 + 0.35 * Math.max(0, Math.min(1, closeness)) + 0.2 * Math.max(0, Math.min(1, u));
  return Math.max(0.4, Math.min(0.95, s));
}
export const BIG_HIT = 0.7;

/**
 * THE GUNSIGHT — the rules. Plain numbers in, plain numbers out: no three.js,
 * no DOM, so node can aim a gun at a moving target and count what happens
 * (tests/features/gunsight.mjs).
 *
 * The owner, on the heat-seekers: "make the crosshair better and have a
 * lockon", and "you can only shoot metores if u have a plane with guns or
 * smth". So three small rules live here:
 *
 *   1. WHO HAS GUNS. The military aeroplanes (the same six the heat-seekers
 *      hang on: the Vanguard, Osprey, Nightjar, F-22, F-35B, F/A-18), and any
 *      type a designer marks `guns: true` (a special high-tech meteor hunter,
 *      if one is ever built). Never an airliner, a trainer, a tourer, a
 *      helicopter, Air Massimo or T-Pose Harrison. One list: the meteor
 *      zapper, the heat-seekers and the sight all ask it.
 *   2. WHERE TO AIM. A pellet leaves the muzzle at `speed` PLUS the shooter's
 *      own velocity (pvp.js and the escort's gun add it), so the nose has to
 *      point where a straight line, flown at that speed from the shooter,
 *      meets the target flying straight on: leadAim() solves it exactly (a
 *      quadratic in the time of flight). The pipper sits where the nose must
 *      point; put the centre dot on it and the burst arrives with the target.
 *   3. WHAT IS LOCKED. A key cycles the valid targets in front of you
 *      (Designation). Valid targets are the heat-seekers' own (drones,
 *      practice drones, another player only with PvP on for both: the
 *      one filter in ../heatseek/rules.js targetVerdict) and — for the gun,
 *      not for the missiles — the meteors the zapper can pop. Never civilian
 *      traffic, an airliner, Air Force One, a rescue aeroplane.
 */

import { isMilitary } from '../carrier/who.js';

export const D2R = Math.PI / 180;

/**
 * The guns, as numbers. `speed` is the muzzle speed relative to the shooter
 * (the shooter's own velocity is added to a pellet); `life` the seconds a
 * pellet flies; `range` the metres out to which a hit is on the table.
 *
 *   pellet - the PvP paint pellet: pvp.js PELLET_SPEED / PELLET_LIFE, pvp/rules.js RANGE_M.
 *   afo    - the escort's gun in Air Force One - Under Attack: afo-combat.js PELLET_SPEED 340, life 1.1.
 *   zap    - the meteor zapper (meteor.js): a bolt with the pellet's speed, to the zapper's own 3.5 km.
 */
export const GUNS = {
  pellet: { id: 'pellet', speed: 430, life: 1.3, range: 700 },
  afo: { id: 'afo', speed: 340, life: 1.1, range: 480 },
  zap: { id: 'zap', speed: 430, life: 8.2, range: 3500 },
};

/** Where on the screen "the nose" is drawn: a point this far along the nose from the aircraft (m). The seeker ring uses the same. */
export const AIM_DIST = 2000;

/** The sight's limits: the cone "in front of you" the lock key cycles through, and how far a lock is kept. */
export const SIGHT = {
  /** Half-angle of "in front of you", degrees: the lock key only offers targets inside it. */
  frontDeg: 70,
  /** Closer than this a target is on top of you; further and the key does not offer it. */
  minRange: 40,
  maxRange: 6000,
  /** A designated target is kept out to here, and until it has been gone this long. */
  holdRange: 8000,
  goneSeconds: 0.6,
  /** Range ticks round the ring. */
  ticks: 12,
};

/* ------------------------------------------------------------------ *
 * 1. Who has guns
 * ------------------------------------------------------------------ */

/** Types that are military but carry nothing: the helicopter-class Harrier, Air Massimo, T-Pose Harrison. */
const NEVER_ARMED = /^(harrier|massimo|tpose)$/;

/**
 * Is this one of the military jets — the ones that carry heat-seekers? The
 * same six everywhere: heatseek.js carriesMissiles() is this. `game` is the
 * game being played ('flight' or 'heli'): a helicopter never is.
 */
export function militaryJet(type, game = 'flight') {
  if (!type || game === 'heli') return false;
  // A rotor is never a jet: the military helicopters (UH-60, CH-47, AH-64)
  // carry no heat-seekers whatever the hangar calls them.
  if (type.shape && type.shape.power && type.shape.power.rotor) return false;
  return isMilitary(type) && !NEVER_ARMED.test(String(type.id || ''));
}

/**
 * Does this aeroplane type carry guns? Every military jet; plus any type a
 * designer marks `guns: true` (a special meteor hunter), and none marked
 * `guns: false`. Never a helicopter. This is the one rule the meteor zapper,
 * the sight and the lock key all ask.
 */
export function hasGuns(type, game = 'flight') {
  if (!type) return false;
  if (type.guns === false) return false;
  // A designer's `guns: true` wins, helicopter game or not: the Apache's
  // chain gun is the one gun a rotorcraft here carries, and it follows this
  // sight and the PvP rules like every other.
  if (type.guns === true) return true;
  if (game === 'heli') return false;
  return militaryJet(type, game);
}

/** The gun that fires at a target of this kind (see GUNS). */
export function gunFor(cand) {
  if (!cand) return GUNS.pellet;
  if (cand.kind === 'meteor') return GUNS.zap;
  if (cand.kind === 'player') return GUNS.pellet;
  // A drone from Air Force One - Under Attack is shot by the escort's gun; the orange practice drones by the pellet.
  const ref = cand.ref || cand;
  return ref && ref.practice ? GUNS.pellet : GUNS.afo;
}

/* ------------------------------------------------------------------ *
 * 2. Where to aim
 * ------------------------------------------------------------------ */

/**
 * The smallest positive time t at which a bolt leaving a shooter at relative
 * speed `s` can meet a target that is at `rel` and moving at `w` relative to
 * the shooter: |rel + w t| = s t. Null if it never can (the target is
 * pulling away faster than the bolt flies).
 */
export function interceptTime(rel, w, s) {
  const a = w.x * w.x + w.y * w.y + w.z * w.z - s * s;
  const b = 2 * (rel.x * w.x + rel.y * w.y + rel.z * w.z);
  const c = rel.x * rel.x + rel.y * rel.y + rel.z * rel.z;
  if (!(c > 0)) return 0;
  if (Math.abs(a) < 1e-9) return b < 0 ? -c / b : null;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) / (2 * a);
  const t2 = (-b + sq) / (2 * a);
  let t = null;
  for (const x of [t1, t2]) if (x > 1e-6 && (t === null || x < t)) t = x;
  return t;
}

const v3 = (o) => ({ x: (o && o.x) || 0, y: (o && o.y) || 0, z: (o && o.z) || 0 });

/**
 * The lead: the direction the NOSE must point for a burst fired now to meet
 * the target. `shooter` and `target` are { pos, vel } on plain {x,y,z}.
 *
 * Returns { ok, t, dir, point, range, reach, inRange }:
 *   dir      unit vector, the line to fly the nose along;
 *   point    where the target will be when the burst arrives;
 *   range    the straight-line distance now;
 *   reach    the seconds the burst would need to fly (t), against the gun's `life`;
 *   inRange  the burst gets there inside the gun's life AND range.
 * `ok` is false when there is no solution at all.
 */
export function leadAim(shooter, target, gun = GUNS.pellet) {
  const sp = v3(shooter.pos);
  const sv = v3(shooter.vel);
  const tp = v3(target.pos);
  const tv = v3(target.vel);
  const rel = { x: tp.x - sp.x, y: tp.y - sp.y, z: tp.z - sp.z };
  const w = { x: tv.x - sv.x, y: tv.y - sv.y, z: tv.z - sv.z };
  const range = Math.hypot(rel.x, rel.y, rel.z);
  const t = interceptTime(rel, w, gun.speed);
  if (t === null || !(t > 0)) {
    if (range < 1e-6) return { ok: false, t: 0, dir: { x: 0, y: 0, z: -1 }, point: tp, range, reach: 0, inRange: false };
    return { ok: false, t: 0, dir: { x: rel.x / range, y: rel.y / range, z: rel.z / range }, point: tp, range, reach: 0, inRange: false };
  }
  const d = { x: rel.x + w.x * t, y: rel.y + w.y * t, z: rel.z + w.z * t };
  const dl = Math.hypot(d.x, d.y, d.z) || 1;
  return {
    ok: true,
    t,
    dir: { x: d.x / dl, y: d.y / dl, z: d.z / dl },
    point: { x: tp.x + tv.x * t, y: tp.y + tv.y * t, z: tp.z + tv.z * t },
    range,
    reach: t,
    inRange: t <= gun.life && range <= gun.range,
  };
}

/**
 * The range ticks round the ring. `n` ticks; all of them lit exactly when
 * the target is inside the gun's reach, fewer the further out it is, none at
 * three times the reach. Returns { lit, inRange }.
 */
export function rangeTicks(range, gun = GUNS.pellet, n = SIGHT.ticks) {
  if (!(range >= 0)) return { lit: 0, inRange: false };
  if (range <= gun.range) return { lit: n, inRange: true };
  const frac = 1 - (range - gun.range) / (gun.range * 2);
  const lit = Math.max(0, Math.min(n - 1, Math.floor(n * frac)));
  return { lit, inRange: false };
}

/** A distance for the screen: "420 m", "2.3 km". */
export function rangeText(m) {
  if (!(m >= 0)) return '';
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

/* ------------------------------------------------------------------ *
 * 3. What is locked
 * ------------------------------------------------------------------ */

const sub3 = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const len3 = (a) => Math.hypot(a.x, a.y, a.z);
function angleBetween(a, b) {
  const la = len3(a);
  const lb = len3(b);
  if (!(la > 1e-9) || !(lb > 1e-9)) return 180;
  return Math.acos(Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (la * lb)))) / D2R;
}

/**
 * Of `cands` ([{ id, pos }]), those in front of `origin` along `fwd`
 * (within `frontDeg` of the nose, `minRange`..`maxRange` away), nearest the
 * nose first: [{ cand, off, range }].
 */
export function frontTargets(origin, fwd, cands, { frontDeg = SIGHT.frontDeg, minRange = SIGHT.minRange, maxRange = SIGHT.maxRange } = {}) {
  const out = [];
  for (const c of cands) {
    if (!c || !c.pos) continue;
    const rel = sub3(c.pos, origin);
    const range = len3(rel);
    if (range < minRange || range > maxRange) continue;
    const off = angleBetween(fwd, rel);
    if (off <= frontDeg) out.push({ cand: c, off, range });
  }
  out.sort((a, b) => a.off - b.off || a.range - b.range);
  return out;
}

/**
 * The lock key. It remembers one target (by id) and, each press, moves to the
 * next valid one in front of you: nearest the nose first; past the last it
 * lets go (a press with the sky empty ahead lets go too). Feed update() every
 * frame so a target that was shot, or flew away, is dropped.
 */
export class Designation {
  constructor() {
    this.reset();
  }

  reset() {
    /** The id of the locked target, or null. */
    this.id = null;
    /** The candidate object last seen for it. */
    this.target = null;
    this.gone = 0;
  }

  get active() {
    return this.id !== null;
  }

  /**
   * One press. Returns { action: 'set'|'next'|'cleared'|'none', cand }.
   * 'none' is a press that found nothing and had nothing to let go of.
   */
  cycle(origin, fwd, cands) {
    const list = frontTargets(origin, fwd, cands);
    if (this.id === null) {
      if (!list.length) return { action: 'none', cand: null };
      this._take(list[0].cand);
      return { action: 'set', cand: list[0].cand };
    }
    const at = list.findIndex((e) => e.cand.id === this.id);
    if (at >= 0 && at + 1 < list.length) {
      this._take(list[at + 1].cand);
      return { action: 'next', cand: list[at + 1].cand };
    }
    if (at < 0 && list.length) {
      // The one held is off to the side or behind: the press picks the one nearest the nose.
      this._take(list[0].cand);
      return { action: 'next', cand: list[0].cand };
    }
    this.reset();
    return { action: 'cleared', cand: null };
  }

  /** Keep the lock honest. Returns true if it let go this frame. */
  update(dt, origin, cands) {
    if (this.id === null) return false;
    const mine = cands.find((c) => c === this.target || c.id === this.id);
    if (mine) {
      const r = len3(sub3(mine.pos, origin));
      if (r <= SIGHT.holdRange) {
        this.target = mine;
        this.gone = 0;
        return false;
      }
    }
    this.gone += dt;
    if (this.gone > SIGHT.goneSeconds) {
      this.reset();
      return true;
    }
    return false;
  }

  _take(c) {
    this.id = c.id;
    this.target = c;
    this.gone = 0;
  }
}

/* ------------------------------------------------------------------ *
 * The arrow for a target that is off the screen
 * ------------------------------------------------------------------ */

/**
 * Where on a ring of `radius` px round the middle of the screen the arrow
 * goes, for a target whose direction on the screen is (dx, dy) — right and
 * DOWN, so dy is the screen's own y. Returns { x, y, ang } with x, y relative
 * to the middle and `ang` radians clockwise from straight up. A target dead
 * ahead and behind (dx = dy = 0) points up.
 */
export function ringMark(dx, dy, radius) {
  const l = Math.hypot(dx, dy);
  if (!(l > 1e-6)) return { x: 0, y: -radius, ang: 0 };
  const ux = dx / l;
  const uy = dy / l;
  return { x: ux * radius, y: uy * radius, ang: Math.atan2(ux, -uy) };
}

/**
 * PvP, the rules — what the HOST decides. No DOM, no three.js: the node
 * tests run a host through a whole fight with it.
 *
 * "able to shoot people — pvp off/on" was on the owner's list. So:
 *
 *   - PvP is each player's own switch, OFF until they turn it on. You can
 *     only tag, and be tagged by, players who have it ON too. Switching takes
 *     three seconds either way (ARM_MS), so it cannot be flicked off the
 *     moment somebody lines up behind you — and not at all for five seconds
 *     after you were hit (CALM_MS).
 *   - Everybody has five hearts. A pellet that hits takes one. The last one
 *     is a TAG: a cartoon puff, your score goes up, theirs goes on the
 *     "tagged" side, and three seconds later they are back in the air with a
 *     shield for five (SHIELD_MS) — no spawn-tagging. Firing ends your own
 *     shield early: it is for coming back, not for hiding in.
 *   - A heart comes back every four seconds once you have not been hit for
 *     six.
 *
 * WHO DECIDES. The shooter's own game sees the pellet meet the aeroplane and
 * CLAIMS the hit (toHost 'pvp:hit'); only the host makes it one. It checks
 * both players have PvP on and are in play — not tagged out, not shielded,
 * not arming — that the shooter was really firing in the last second and a
 * half, and that the two are close enough, as the host sees them, for a
 * pellet to have got there. Rates are held by the events channel's own
 * bucket (pvp.js defines them). A modified tab can claim what it likes; the
 * worst it can do is hit somebody it really was near and really was
 * shooting at.
 *
 * Everything here is numbers and player ids. Nothing a player could type is
 * anywhere in it.
 */

export const HEARTS = 5;
export const ARM_MS = 3000;
export const CALM_MS = 5000;
export const DOWN_MS = 3000;
export const SHIELD_MS = 5000;
export const REGEN_AFTER_MS = 6000;
export const REGEN_EVERY_MS = 4000;
/** How recently the shooter must have been firing, as the host heard it. */
export const FIRING_GRACE_MS = 1500;
/** A pellet's reach (pvp.js: 430 m/s for 1.3 s, plus the shooter's own speed). */
export const RANGE_M = 700;
/** What the host allows between the two, as it sees them: the reach plus what a lag of a quarter of a second at 300 m/s can move. */
export const HOST_RANGE_M = 1300;
/** A bump that counts as a crash in PvP: the two within this, as the host sees them. */
export const RAM_RANGE_M = 160;
/** One crash per pair, however many times each side reports it. */
export const RAM_DEDUPE_MS = 2500;

/** Bits of a player's flags in the shared state. */
export const F = { on: 1, arming: 2, down: 4, shield: 8 };

const ID_MAX = 7;
const okId = (v) => Number.isInteger(v) && v >= 0 && v <= ID_MAX;

/* ---- what may travel ---------------------------------------------------- */

/** 'pvp:want' — a player's switch. */
export const cleanWant = (d) => (d && typeof d.on === 'boolean' ? { on: d.on } : null);
/** 'pvp:fire' — started or stopped firing. */
export const cleanFire = (d) => (d && typeof d.on === 'boolean' ? { on: d.on } : null);
/** 'pvp:hit' — a claim: I hit player t. */
export const cleanHit = (d) => (d && okId(d.t) ? { t: d.t } : null);
/** 'pvp:ram' — a claim: I crashed into player t. */
export const cleanRam = (d) => (d && okId(d.t) ? { t: d.t } : null);
/** 'pvp:ouch' — the host: player t lost a heart to player by, and has hp left. */
export const cleanOuch = (d) => (d && okId(d.t) && okId(d.by) && Number.isInteger(d.hp) && d.hp >= 0 && d.hp <= HEARTS ? { t: d.t, by: d.by, hp: d.hp } : null);
/** 'pvp:down' — the host: player t is tagged out; by is who did it (-1 for a crash), how is 0 a pellet, 1 a crash. */
export const cleanDown = (d) => (d && okId(d.t) && Number.isInteger(d.by) && d.by >= -1 && d.by <= ID_MAX && (d.how === 0 || d.how === 1)
  ? { t: d.t, by: d.by, how: d.how } : null);

/**
 * The shared state 'pvp': { p: [[id, flags, hp, tags, outs], ...] }. Clean
 * copy, or null. Held by everybody, so a new host after a lobby re-forms
 * carries on the same scores.
 */
export function cleanState(v) {
  if (!v || !Array.isArray(v.p) || v.p.length > ID_MAX + 1) return null;
  const p = [];
  const seen = new Set();
  for (const r of v.p) {
    if (!Array.isArray(r) || r.length !== 5) return null;
    const [id, f, hp, tags, outs] = r;
    if (!okId(id) || seen.has(id)) return null;
    if (!Number.isInteger(f) || f < 0 || f > 15) return null;
    if (!Number.isInteger(hp) || hp < 0 || hp > HEARTS) return null;
    if (!Number.isInteger(tags) || tags < 0 || tags > 9999 || !Number.isInteger(outs) || outs < 0 || outs > 9999) return null;
    seen.add(id);
    p.push([id, f, hp, tags, outs]);
  }
  return { p };
}

/** A state row as an object. */
export function rowOf(state, id) {
  const r = state && Array.isArray(state.p) ? state.p.find((x) => x[0] === id) : null;
  if (!r) return null;
  const [, f, hp, tags, outs] = r;
  return { id, on: !!(f & F.on), arming: !!(f & F.arming), down: !!(f & F.down), shield: !!(f & F.shield), hp, tags, outs };
}

/* ---- the host ------------------------------------------------------------ */

function blank(id) {
  return { id, on: false, armUntil: 0, armTo: false, hp: HEARTS, tags: 0, outs: 0, downUntil: 0, shieldUntil: 0, lastHit: -Infinity, regenAt: 0, firingAt: -Infinity, firing: false };
}

export class PvpJudge {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.players = new Map();
    this.rams = new Map();
    /** Why the last few claims were turned down — for the console and the tests. */
    this.refused = [];
    this.dirty = true;
  }

  get(id) {
    let p = this.players.get(id);
    if (!p) {
      p = blank(id);
      this.players.set(id, p);
      this.dirty = true;
    }
    return p;
  }

  join(id) {
    this.get(id);
  }

  leave(id) {
    if (this.players.delete(id)) this.dirty = true;
  }

  /** Carry on from the shared state — a new host after the lobby re-formed. */
  load(state, t = this.now()) {
    const s = cleanState(state);
    if (!s) return;
    for (const [id, f, hp, tags, outs] of s.p) {
      const p = this.get(id);
      p.on = !!(f & F.on);
      p.hp = hp;
      p.tags = tags;
      p.outs = outs;
      // Whatever was in the middle of happening finishes now: tagged players come straight back, shielded.
      if (f & (F.down | F.shield)) p.shieldUntil = t + SHIELD_MS;
      if (f & F.arming) {
        p.armUntil = t + ARM_MS;
        p.armTo = !p.on;
      }
    }
    this.dirty = true;
  }

  _refuse(why) {
    this.refused.push(why);
    if (this.refused.length > 20) this.refused.shift();
    return { ok: false, why };
  }

  /** In play: on, not arming, not tagged out, not shielded. */
  live(p, t) {
    return !!(p && p.on && !p.armUntil && !(p.downUntil > t) && !(p.shieldUntil > t));
  }

  /** A player's switch. Takes ARM_MS to count; not while they are still in a fight. */
  want(id, on, t = this.now()) {
    const p = this.get(id);
    if (p.armUntil) {
      // Changed their mind before it counted.
      if (p.armTo === on) return { ok: true, at: p.armUntil };
      p.armUntil = 0;
      this.dirty = true;
      return { ok: true, at: 0 };
    }
    if (p.on === on) return { ok: true, at: 0 };
    const calmAt = p.lastHit + CALM_MS;
    const start = Math.max(t, !on && calmAt > t ? calmAt : t);
    p.armUntil = start + ARM_MS;
    p.armTo = on;
    this.dirty = true;
    return { ok: true, at: p.armUntil };
  }

  fire(id, on, t = this.now()) {
    const p = this.get(id);
    p.firing = !!on;
    p.firingAt = t;
    // Firing gives up your shield: it is for coming back, not for hiding in.
    if (on && p.shieldUntil > t && !(p.downUntil > t)) {
      p.shieldUntil = 0;
      this.dirty = true;
    }
  }

  /**
   * A claim: `shooter` hit `target`. `dist` is how far apart the host sees
   * them (or null if it cannot tell). Returns { ok, why } and, when it
   * counts, { hp, down }.
   */
  hit(shooter, target, dist, t = this.now()) {
    if (shooter === target) return this._refuse('self');
    const s = this.players.get(shooter);
    const v = this.players.get(target);
    if (!s || !s.on || s.armUntil) return this._refuse('shooter has PvP off');
    if (s.downUntil > t) return this._refuse('shooter is tagged out');
    if (!v || !v.on || v.armUntil) return this._refuse('target has PvP off');
    if (v.downUntil > t) return this._refuse('target is tagged out');
    if (v.shieldUntil > t) return this._refuse('target is shielded');
    if (!(s.firing || t - s.firingAt < FIRING_GRACE_MS)) return this._refuse('shooter was not firing');
    if (dist != null && !(dist <= HOST_RANGE_M)) return this._refuse('too far apart');
    v.hp = Math.max(0, v.hp - 1);
    v.lastHit = t;
    v.regenAt = t + REGEN_AFTER_MS;
    v.by = shooter;
    this.dirty = true;
    if (v.hp > 0) return { ok: true, hp: v.hp, down: false };
    this._down(v, t);
    s.tags++;
    return { ok: true, hp: 0, down: true };
  }

  /** A claim: `a` crashed into `b`, both in PvP. Both are tagged out; nobody scores. */
  ram(a, b, dist, t = this.now()) {
    if (a === b) return this._refuse('self');
    const pa = this.players.get(a);
    const pb = this.players.get(b);
    if (!this.live(pa, t) || !this.live(pb, t)) return this._refuse('not both in play');
    if (dist != null && !(dist <= RAM_RANGE_M)) return this._refuse('too far apart to have crashed');
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (t - (this.rams.get(key) || -Infinity) < RAM_DEDUPE_MS) return this._refuse('already counted');
    this.rams.set(key, t);
    for (const p of [pa, pb]) {
      p.hp = 0;
      p.lastHit = t;
      this._down(p, t);
    }
    this.dirty = true;
    return { ok: true, down: true };
  }

  _down(p, t) {
    p.downUntil = t + DOWN_MS;
    p.shieldUntil = t + DOWN_MS + SHIELD_MS;
    p.outs++;
    p.firing = false;
  }

  /** Time passing: switches that now count, players back from a tag, hearts coming back. Returns what changed. */
  tick(t = this.now()) {
    const events = [];
    for (const p of this.players.values()) {
      if (p.armUntil && t >= p.armUntil) {
        p.on = p.armTo;
        p.armUntil = 0;
        p.hp = HEARTS;
        if (p.on) p.shieldUntil = t + 1000;
        events.push({ type: p.on ? 'on' : 'off', id: p.id });
        this.dirty = true;
      }
      if (p.downUntil && t >= p.downUntil) {
        p.downUntil = 0;
        p.hp = HEARTS;
        events.push({ type: 'up', id: p.id });
        this.dirty = true;
      }
      if (p.shieldUntil && t >= p.shieldUntil) {
        p.shieldUntil = 0;
        this.dirty = true;
      }
      if (p.on && !p.downUntil && p.hp < HEARTS && t >= p.regenAt && t - p.lastHit >= REGEN_AFTER_MS) {
        p.hp++;
        p.regenAt = t + REGEN_EVERY_MS;
        this.dirty = true;
      }
    }
    return events;
  }

  flags(p, t = this.now()) {
    let f = 0;
    if (p.on) f |= F.on;
    if (p.armUntil) f |= F.arming;
    if (p.downUntil > t) f |= F.down;
    if (p.shieldUntil > t) f |= F.shield;
    return f;
  }

  /** The shared state, for setState('pvp'). */
  state(t = this.now()) {
    const p = [...this.players.values()].sort((a, b) => a.id - b.id).map((x) => [x.id, this.flags(x, t), x.hp, x.tags, x.outs]);
    return { p };
  }
}

/** The scoreboard's order: most tags, then fewest times tagged, then who joined first. */
export function standings(state, names = () => null) {
  const s = cleanState(state);
  if (!s) return [];
  return s.p
    .map(([id, f, hp, tags, outs]) => ({ id, on: !!(f & F.on), arming: !!(f & F.arming), down: !!(f & F.down), shield: !!(f & F.shield), hp, tags, outs, name: names(id) }))
    .filter((r) => r.on || r.arming || r.tags || r.outs)
    .sort((a, b) => b.tags - a.tags || a.outs - b.outs || a.id - b.id);
}

/**
 * Where a pellet flying from a to b (one frame of it) comes nearest a
 * sphere at c with radius r: true if it passes through. Plain numbers, so the
 * node tests can check it without three.js.
 */
export function segmentHitsSphere(ax, ay, az, bx, by, bz, cx, cy, cz, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len2 = dx * dx + dy * dy + dz * dz;
  let u = 0;
  if (len2 > 1e-9) u = Math.max(0, Math.min(1, ((cx - ax) * dx + (cy - ay) * dy + (cz - az) * dz) / len2));
  const px = ax + dx * u - cx;
  const py = ay + dy * u - cy;
  const pz = az + dz * u - cz;
  return px * px + py * py + pz * pz <= r * r;
}

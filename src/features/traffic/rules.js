/**
 * The runway rules, as geometry: how soon the player could be somewhere, and
 * how safe a ground path is from them.
 *
 * Real airports keep aeroplanes apart on the ground with four rules, and the
 * traffic (../traffic.js) follows the same four:
 *
 *   R1  Nobody stops on a runway — only lined up for its own take-off, with
 *       the runway its own and nobody else on it, and in the roll-out after
 *       landing. Every holding point is painted OFF the runway
 *       (field.js holdPoint).
 *   R2  On to a runway, or across one, is one clearance: given only when the
 *       player is not on it, not lined up on it, not on final to it, and
 *       could not get to where the aeroplane will be before it is off again
 *       (reachTime). Once given, it goes through without stopping on it.
 *   R3  The player turns up on a runway an aeroplane is on: it leaves by the
 *       way off that keeps it furthest out of their path (pathSlack), never
 *       back-taxiing towards them or along the runway ahead of them if there
 *       is another way, and holds short, off the runway.
 *   R4  The tower tells the player when one is on the runway ahead of them.
 *
 * Everything here is pure: a player model in, numbers out. No scene, no
 * state — the node checks call it directly.
 */

import { isOnRunway, isOnRunway2 } from '../../world/terrain.js';

/** On runway k (1: the main one, 09/27; 2: the crosswind one), within margin m. */
export function onRunwayK(k, x, z, m = 0) {
  return k === 2 ? isOnRunway2(x, z, m) : isOnRunway(x, z, m);
}

/** How far an aeroplane reaches from its middle, whichever way it points. */
export function reachOf(perf) {
  return Math.max(perf.span / 2, perf.noseLen, perf.tailLen);
}

/**
 * A player model: `on` false, or where their nose points on the ground and
 * how fast they could get anywhere ahead of it.
 *
 *   x, z      the middle of their aeroplane — or, on final, the runway
 *             threshold they are coming to
 *   ux, uz    unit vector the way the nose points (or the way they will roll)
 *   v         speed along it, m/s (never negative)
 *   accel     the most they could speed up by, m/s/s (0: they keep v)
 *   delay     seconds before they are at (x, z) at all (on final)
 *   halfSpan, nose, tail   their size
 *   dLift     metres ahead where they are off the ground: past that, they
 *             fly over whatever is there
 */
export function blankPlayer() {
  return { on: false, x: 0, z: 0, ux: 1, uz: 0, v: 0, accel: 1.5, delay: 0, halfSpan: 6, nose: 4, tail: 4, dLift: 500 };
}

/** Seconds until the player's nose could have gone D metres ahead of where it is. */
export function playerTime(pm, D) {
  if (D <= 0) return pm.delay;
  const v = Math.max(0, pm.v);
  const a = pm.accel;
  return pm.delay + (a > 1e-6 ? (Math.sqrt(v * v + 2 * a * D) - v) / a : D / Math.max(v, 0.5));
}

/**
 * The soonest the player could be inside the box {x0, x1, z0, z1} (their
 * wings in it), seconds; Infinity if they are going somewhere else.
 *
 * Along their nose: the time to cover the way in at their acceleration. Not
 * pointing at it, but stopped or slow within 60 m of it: they could turn and
 * be there — a few seconds to turn, then the run. Anything else, not soon.
 * Conservative on purpose: a clearance refused for a minute is a short wait;
 * one given wrongly is an aeroplane in front of a child.
 */
export function reachTime(pm, box) {
  if (!pm || !pm.on) return Infinity;
  const g = pm.halfSpan;
  const x0 = box.x0 - g;
  const x1 = box.x1 + g;
  const z0 = box.z0 - g;
  const z1 = box.z1 + g;
  const inside = pm.x >= x0 && pm.x <= x1 && pm.z >= z0 && pm.z <= z1;
  if (inside) return pm.delay;
  // Ray from their nose along (ux, uz): where it first enters the box.
  let t0 = 0;
  let t1 = Infinity;
  const ox = pm.x;
  const oz = pm.z;
  const slab = (o, u, lo, hi) => {
    if (Math.abs(u) < 1e-9) return o >= lo && o <= hi;
    let a = (lo - o) / u;
    let b = (hi - o) / u;
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    return t0 <= t1;
  };
  if (slab(ox, pm.ux, x0, x1) && slab(oz, pm.uz, z0, z1)) return playerTime(pm, Math.max(0, t0 - pm.nose));
  // Not pointing at it. Near and slow enough to turn to it?
  const dx = Math.max(x0 - ox, 0, ox - x1);
  const dz = Math.max(z0 - oz, 0, oz - z1);
  const d = Math.hypot(dx, dz);
  if (pm.delay === 0 && pm.v < 3 && d < 60) return 6 + Math.sqrt((2 * d) / Math.max(pm.accel, 0.5));
  return Infinity;
}

/** Seconds to go from sA to sB along a path at the speeds it allows, starting at v0 (the runtime's 1 m/s/s up). */
export function timeAlong(p, sA, sB, v0) {
  if (!p || p.n < 2 || !(sB > sA)) return 0;
  let i = p.indexAt(Math.max(0, sA));
  let v = Math.max(0, v0);
  let ps = Math.max(0, sA);
  let t = 0;
  for (; i < p.n && p.s[i] <= sB + 1e-6; i++) {
    const ds = Math.max(0, p.s[i] - ps);
    if (ds > 0) {
      const vn = Math.min(p.vmax[i], Math.sqrt(v * v + 2 * ds));
      t += ds / Math.max(0.3, (v + vn) / 2);
      v = vn;
    }
    ps = p.s[i];
  }
  return t;
}

/**
 * How safe a ground path is from the player: walked from s0 at the speeds it
 * allows (starting at v0, speeding up at no more than 1 m/s/s the way the
 * runtime does), every point where the aeroplane is in the strip the
 * player's wings will sweep, ahead of their nose and short of where they
 * lift off, is compared with the soonest they could be there
 * (playerTime). Writes into `out` and returns it:
 *
 *   slack    seconds: the least, over those points, of (when the player could
 *            be there) - (when it is there). Negative: they could meet it
 *            there. -Infinity if the path ends in their way. Infinity if it
 *            is never in their way.
 *   near     the closest it comes to the player's middle, metres
 *   touch    true if that is closer than the two of them are big: it would
 *            clip them even if they sat still
 *   offT     seconds until it is off runway k for good (0 if it never is on it)
 *   endT     seconds until it stops at the end of the path
 */
export function pathSlack(p, s0, v0, perf, pm, k, out = {}) {
  out.slack = Infinity;
  out.near = Infinity;
  out.touch = false;
  out.offT = 0;
  out.endT = 0;
  if (!p || p.n < 2) return out;
  const e = reachOf(perf);
  const eP = Math.max(pm.halfSpan, pm.nose, pm.tail);
  const wide = pm.halfSpan + e + 3;
  const mOn = perf.span / 2;
  let i = p.indexAt(Math.max(0, s0));
  let t = 0;
  let v = Math.max(0, v0);
  let px = p.x[i];
  let pz = p.z[i];
  let ps = Math.max(s0, 0);
  for (; i < p.n; i++) {
    const x = p.x[i];
    const z = p.z[i];
    const ds = Math.max(0, p.s[i] - ps);
    if (ds > 0) {
      // The runtime: up at most 1 m/s/s, down as hard as the path asks.
      const vm = p.vmax[i];
      const vn = Math.min(vm, Math.sqrt(v * v + 2 * 1.0 * ds));
      t += ds / Math.max(0.3, (v + vn) / 2);
      v = vn;
    }
    ps = p.s[i];
    px = x;
    pz = z;
    if (onRunwayK(k, x, z, mOn)) out.offT = t;
    if (!pm.on) continue;
    const rx = x - pm.x;
    const rz = z - pm.z;
    const dist = Math.hypot(rx, rz);
    if (dist < out.near) out.near = dist;
    const along = rx * pm.ux + rz * pm.uz;
    const lat = Math.abs(-rx * pm.uz + rz * pm.ux);
    if (lat > wide || along < -(pm.tail + e)) continue;
    const D = along - pm.nose - e;
    if (D > pm.dLift) continue;
    const m = playerTime(pm, D) - t;
    if (m < out.slack) out.slack = m;
  }
  out.endT = t;
  if (pm.on) {
    out.touch = out.near < e + eP + 3;
    // Stopped at the end, in their way: they will get there some time.
    const rx = px - pm.x;
    const rz = pz - pm.z;
    const along = rx * pm.ux + rz * pm.uz;
    const lat = Math.abs(-rx * pm.uz + rz * pm.ux);
    if (lat <= wide && along >= -(pm.tail + e) && along - pm.nose - e <= pm.dLift) out.slack = -Infinity;
  }
  return out;
}

/**
 * Of candidate ways off — each { slack, offT, touch, keep, toward, stay }
 * — the one to take: nothing that clips the player; then the safest, where
 * "safe enough" (GOOD seconds of slack and more) counts as equal, so among
 * those the plan it already has (`keep`), then one that does not take it
 * along the runway towards the player (`toward`), then the soonest off it —
 * and staying where it is (`stay`: lined up, out of their reach) last.
 */
export const GOOD = 8;
export function choose(cands) {
  let best = null;
  const score = (c) => Math.min(c.slack, GOOD);
  const rank = (c) => (c.keep ? 0 : c.stay ? 3 : c.toward ? 2 : 1);
  for (const c of cands) {
    if (c.touch) continue;
    if (!best) {
      best = c;
      continue;
    }
    const a = score(c);
    const b = score(best);
    if (a > b + 0.25) best = c;
    else if (a >= b - 0.25) {
      if (rank(c) < rank(best)) best = c;
      else if (rank(c) === rank(best) && c.offT < best.offT) best = c;
    }
  }
  return best;
}

/**
 * Does a way off to the turn-off at (x, z) take it along the runway towards
 * the player — is where it turns off nearer their nose, ahead of them, than
 * where it is now?
 */
export function towardPlayer(pm, x0, z0, x, z) {
  if (!pm || !pm.on) return false;
  const a0 = (x0 - pm.x) * pm.ux + (z0 - pm.z) * pm.uz;
  const a1 = (x - pm.x) * pm.ux + (z - pm.z) * pm.uz;
  return a0 > 0 && a1 < a0 - 5;
}

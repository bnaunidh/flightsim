/**
 * Boarding and getting off at the stand, as numbers: how long it takes, how
 * fast each door takes people, and the people walking across the apron to
 * the stairs. Pure — no THREE, no DOM, no game — so the node test can watch a
 * whole turnaround frame by frame.
 *
 * THE SHOW (the owner, 2026-10-16: "a realisitc loading passnegers etc thing
 * (that u can skip)"): the jet bridge docks at the front door — or, on a
 * remote stand, the stair truck comes to it — the ground crew drives out
 * (the stair truck to the back door, the belt loader and the baggage train at
 * the hold, catering, fuel), the passengers come on through the bridge and up
 * the stairs, the cabin fills seat by seat, "boarding complete", the doors
 * shut, the bridge pulls away, then the pushback. About 30-60 s if you watch
 * it all, and skippable at any moment.
 *
 * Two kinds of door:
 *   - the BRIDGE door: nobody outside can see into a jet bridge (its tunnel is
 *     solid), so it is just a rate, people a second, from when it docks;
 *   - a STAIRS door: the people walk there from the terminal, and you can see
 *     them, so it is a Stream — walkers along a path, each standing for one
 *     or two passengers (a real turnaround is twenty minutes; this one is
 *     half a minute, so the line is a little denser than life), spawned at
 *     the terminal end and counted aboard as they reach the door. Getting
 *     off, the same in reverse: they leave the cabin as they step out of the
 *     door, and walk to the terminal.
 */

/*
 * The whole thing, watched: about 10 s for the bridge to drive out, the
 * boarding, 1.2 s for the doors and 7 s for the bridge to pull back — so a
 * boarding of 15-38 s makes the turnaround 30-60 s, as asked.
 */
/** Seconds to board `booked` people once the doors open, if every door does its share. 15-36 s. */
export function boardSeconds(booked) {
  return Math.max(15, Math.min(36, 12 + 0.06 * (booked || 0)));
}

/** Seconds to get `booked` people off once the doors open: quicker. 12-30 s. */
export function deplaneSeconds(booked) {
  return Math.max(12, Math.min(30, 9 + 0.045 * (booked || 0)));
}

/**
 * How fast each door takes people, a second. `bridge`: a jet bridge on the
 * front door; `stairs`: a stair truck at a door (the back one at a gate, the
 * front one on a remote stand). With both, the bridge takes most of them
 * (all but stairsShare) and a little faster than it needs to, since it is
 * on the door first; the stairs take theirs as fast as a line walks. With
 * neither (no ground crew on this field, an aeroplane too small for one),
 * the door takes them at the bridge's rate.
 */
export function doorRates(booked, { bridge = true, stairs = false, seconds } = {}) {
  const T = seconds || boardSeconds(booked);
  const all = (booked || 0) / T;
  if (bridge && stairs) return { T, bridge: all * 0.85, stairs: all * 0.35 };
  if (stairs) return { T, bridge: 0, stairs: all };
  return { T, bridge: all, stairs: 0 };
}

/** The part of the cabin that uses the back stairs when there is a bridge on the front door. */
export const STAIRS_SHARE = 0.25;

/** How many of `booked` go by the stairs: a share at a gate, everybody on a remote stand, nobody without stairs. */
export function stairsShare(booked, { bridge = true, stairs = false } = {}) {
  if (!stairs) return 0;
  if (!bridge) return booked || 0;
  return Math.round((booked || 0) * STAIRS_SHARE);
}

/** Walking pace on the apron, m/s (brisk: they have a flight to catch). */
export const WALK = 1.45;
/** Metres between walkers along the path (two abreast, so 1.1 m in each lane). */
export const GAP = 0.55;

/* ------------------------------------------------------------------ */
/* A path                                                               */
/* ------------------------------------------------------------------ */

/** A polyline through [{x, y, z}], sampled by distance along it. */
export class Path3 {
  constructor(points) {
    this.p = points.map((q) => ({ x: q.x, y: q.y, z: q.z }));
    this.at = [0];
    let d = 0;
    for (let i = 1; i < this.p.length; i++) {
      const a = this.p[i - 1];
      const b = this.p[i];
      d += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
      this.at.push(d);
    }
    this.length = Math.max(1e-3, d);
  }

  /** Writes { x, y, z, yaw } at `d` metres along; yaw faces the way along (three.js, about +Y). */
  sample(d, out = { x: 0, y: 0, z: 0, yaw: 0 }) {
    const n = this.p.length;
    if (n < 2) {
      const q = this.p[0] || { x: 0, y: 0, z: 0 };
      out.x = q.x;
      out.y = q.y;
      out.z = q.z;
      return out;
    }
    const dd = Math.max(0, Math.min(this.length, d));
    let i = 1;
    while (i < n - 1 && this.at[i] < dd) i++;
    const a = this.p[i - 1];
    const b = this.p[i];
    const seg = this.at[i] - this.at[i - 1] || 1e-3;
    const k = Math.max(0, Math.min(1, (dd - this.at[i - 1]) / seg));
    out.x = a.x + (b.x - a.x) * k;
    out.y = a.y + (b.y - a.y) * k;
    out.z = a.z + (b.z - a.z) * k;
    // Facing along the ground part of the segment (a person climbing stairs still faces the door).
    const hx = b.x - a.x;
    const hz = b.z - a.z;
    if (hx * hx + hz * hz > 1e-6) out.yaw = Math.atan2(-hx, -hz);
    return out;
  }
}

/**
 * Keep a walking line clear of round things on the ground (a bridge's
 * rotunda column, its wheeled leg): wherever a leg of the path passes within
 * `r + clear` of one, a waypoint goes in beside it, on the side away from
 * `away` (the aeroplane's centre line), so the line walks round rather than
 * through. [{x, z}] in, the same out, with y carried on the new points.
 */
export function walkAround(points, obstacles, away, clear = 0.7) {
  let pts = points.slice();
  for (const o of obstacles || []) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const L2 = dx * dx + dz * dz || 1e-6;
      const t = Math.max(0, Math.min(1, ((o.x - a.x) * dx + (o.z - a.z) * dz) / L2));
      const cx = a.x + dx * t;
      const cz = a.z + dz * t;
      const dist = Math.hypot(o.x - cx, o.z - cz);
      if (t > 0.02 && t < 0.98 && dist < o.r + clear) {
        // Perpendicular to the leg, on whichever side is further from the aeroplane.
        const L = Math.sqrt(L2);
        let nx = -dz / L;
        let nz = dx / L;
        if (away && (o.x + nx - away.x) ** 2 + (o.z + nz - away.z) ** 2 < (o.x - nx - away.x) ** 2 + (o.z - nz - away.z) ** 2) {
          nx = -nx;
          nz = -nz;
        }
        const k = o.r + clear + 0.4;
        out.push({ x: o.x + nx * k, y: a.y + (b.y - a.y) * t, z: o.z + nz * k });
      }
      out.push(b);
    }
    pts = out;
  }
  return pts;
}

/* ------------------------------------------------------------------ */
/* People walking a path                                                */
/* ------------------------------------------------------------------ */

/**
 * A line of people walking `path` from its start to its end at WALK m/s,
 * GAP m apart (two abreast), spawned at the start while there is anybody left
 * to send. Each walker stands for `rep` passengers (one at least), chosen so
 * the door takes `rate` people a second.
 *
 * move(dt) walks them on and returns how many (passengers, not walkers)
 * reached the end; spawn(dt, take) sends more from the start while there is
 * anybody to send: `take(n)` hands out up to n of the people still to send
 * and returns how many it gave (fractions are fine). Boarding: take() draws
 * on the ones not aboard yet, and what reaches the end is aboard. Getting
 * off: take() draws on the ones still aboard (they have left their seats),
 * and what reaches the end is in the terminal. step() is move() then spawn().
 */
export class Stream {
  constructor(path, { rate = 2, speed = WALK, gap = GAP, max = 160 } = {}) {
    this.path = path;
    this.len = path.length;
    this.speed = speed;
    this.gap = gap;
    this.every = Math.max(gap / speed, 1 / Math.max(0.05, rate));
    this.rep = Math.max(1, rate * this.every);
    this.max = max;
    /** Metres along the path nobody walks past yet (null: on they go). */
    this.hold = null;
    this.list = [];
    this.wait = 0;
    this.spawned = 0;
    this.delivered = 0;
    this.done = false;
  }

  /** People on the path now (not walkers: what they stand for). */
  get inTransit() {
    let n = 0;
    for (const w of this.list) n += w.n;
    return n;
  }

  move(dt) {
    let got = 0;
    if (!(dt > 0)) return 0;
    const ds = this.speed * dt;
    if (this.hold == null) {
      for (const w of this.list) w.s += ds;
    } else {
      // Waiting at `hold` (the foot of stairs that are not there yet): a queue,
      // each a step behind the one in front.
      let limit = this.hold;
      for (const w of this.list) {
        w.s = Math.min(w.s + ds, limit);
        limit = w.s - this.gap;
      }
    }
    while (this.list.length && this.list[0].s >= this.len) got += this.list.shift().n;
    this.delivered += got;
    return got;
  }

  spawn(dt, take) {
    if (!(dt > 0)) return;
    this.wait -= dt;
    // No room at the back of a queue that reaches the start.
    const last = this.list[this.list.length - 1];
    if (last && last.s < this.gap) {
      if (this.wait < 0) this.wait = 0;
      return;
    }
    while (this.wait <= 0 && this.list.length < this.max) {
      const n = take(this.rep);
      if (!(n > 0)) {
        this.wait = 0;
        break;
      }
      // Already a little way along if it was due part-way through this step.
      this.list.push({ s: Math.min(this.len, -this.wait * this.speed), n, k: this.spawned++ });
      this.wait += this.every;
    }
    if (!this.list.length && this.wait === 0 && this.spawned > 0) this.done = true;
  }

  step(dt, take) {
    const got = this.move(dt);
    this.spawn(dt, take);
    return got;
  }

  /**
   * As if the line had been walking for `seconds` already (it set off before
   * you were here to see it): spawned and moved in tenths of a second.
   * Returns how many reached the end meanwhile (none, while it is held).
   */
  prefill(seconds, take) {
    let got = 0;
    for (let t = 0; t < seconds - 1e-9; t += 0.1) got += this.step(Math.min(0.1, seconds - t), take);
    return got;
  }

  /** Everybody off the path at once (a skip): returns what they stood for. */
  clear() {
    const n = this.inTransit;
    this.list.length = 0;
    this.done = true;
    return n;
  }
}

/** Seconds a walker takes from one end of the path to the other. */
export function walkSeconds(path, speed = WALK) {
  return path.length / speed;
}

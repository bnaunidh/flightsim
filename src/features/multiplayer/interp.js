/**
 * Smooth remote players.
 *
 * Snapshots arrive fifteen times a second, late by however long the Wi-Fi
 * takes and not always in order — the state channel is unreliable and
 * unordered on purpose, because a snapshot that arrives after the next one
 * is worth nothing. Drawing each one as it lands makes an aeroplane that
 * stutters forward in 66 ms hops and teleports when a packet goes missing.
 *
 * So every remote player is drawn about 100 ms in the past, between the two
 * snapshots either side of that moment. When the buffer runs dry — a dropped
 * packet, a tab that has gone to the background — it keeps going along the
 * last known velocity for up to half a second and then holds.
 *
 * Timestamps are the SENDER's clock. The offset between the two clocks is the
 * smallest (arrival − sent) seen in the last three seconds: the fastest packet
 * is the one with the least queueing in it, so its offset is the best
 * estimate of the true one. The estimate is then only allowed to move a few
 * milliseconds per packet, so a single fast or slow packet cannot make the
 * aeroplane jump.
 *
 * Plain objects in and out; no three.js here, so node can test it.
 */

const lerp = (a, b, t) => a + (b - a) * t;

export function slerpQuat(a, b, t, out = {}) {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let cos = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  // The short way round.
  if (cos < 0) {
    cos = -cos;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let k0, k1;
  if (cos > 0.9995) {
    k0 = 1 - t;
    k1 = t;
  } else {
    const th = Math.acos(Math.min(1, cos));
    const s = Math.sin(th);
    k0 = Math.sin((1 - t) * th) / s;
    k1 = Math.sin(t * th) / s;
  }
  out.x = a.x * k0 + bx * k1;
  out.y = a.y * k0 + by * k1;
  out.z = a.z * k0 + bz * k1;
  out.w = a.w * k0 + bw * k1;
  const l = Math.hypot(out.x, out.y, out.z, out.w) || 1;
  out.x /= l; out.y /= l; out.z /= l; out.w /= l;
  return out;
}

export class Track {
  constructor({ delayMs = 100, maxDelayMs = 350, maxExtrapMs = 500, keepMs = 3000, staleMs = 5000 } = {}) {
    /*
     * How far in the past to draw. 100 ms covers a good Wi-Fi's jitter; a
     * busy one needs more. Measured in the two-tab playtest on a loaded
     * machine: arrivals spread over 800 ms, and with a fixed 100 ms the remote
     * aeroplane spent 71 % of its frames being extrapolated — guessed, not
     * drawn. So the delay follows the jitter actually seen (the 90th
     * percentile of how late packets are, plus a margin), between 100 and
     * 350 ms, and moves slowly so the picture does not lurch when it changes.
     */
    this.minDelayMs = delayMs;
    this.maxDelayMs = maxDelayMs;
    this.delayMs = delayMs;
    this.maxExtrapMs = maxExtrapMs;
    this.keepMs = keepMs;
    this.staleMs = staleMs;
    /** Snapshots, oldest first, by sender time. */
    this.snaps = [];
    /** Recent (arrival − sent) samples, for the clock offset. */
    this.offs = [];
    this.offset = null;
    this.lastArrival = -Infinity;
    this.latest = null;
    this._t = null;
  }

  /**
   * Add a snapshot. `snap.t` is the sender's clock in ms (a u32 on the wire),
   * `now` is ours.
   */
  push(snap, now) {
    // The sender's clock wraps at 2^32 ms. Unwrap against the newest we hold.
    let t = snap.t;
    if (this._t !== null) {
      while (t < this._t - 2 ** 31) t += 2 ** 32;
    }
    const s = { ...snap, t };
    const off = now - t;
    this.offs.push({ off, at: now });
    while (this.offs.length && this.offs[0].at < now - 3000) this.offs.shift();
    let min = Infinity;
    for (const o of this.offs) if (o.off < min) min = o.off;
    if (this.offset === null) this.offset = min;
    else this.offset += Math.max(-4, Math.min(4, min - this.offset));
    if (this.offs.length >= 8) {
      const late = this.offs.map((o) => o.off - min).sort((a, b) => a - b);
      const p90 = late[Math.floor(late.length * 0.9)];
      const want = Math.max(this.minDelayMs, Math.min(this.maxDelayMs, p90 + 30));
      this.delayMs += (want - this.delayMs) * 0.08;
    }
    // A clock that has jumped by more than a second — a sleeping laptop, a
    // reloaded tab reusing the id — is a new clock, not a slow network.
    if (Math.abs(min - this.offset) > 1000) {
      this.offset = min;
      this.snaps.length = 0;
    }

    const n = this.snaps.length;
    const newest = n ? this.snaps[n - 1].t : -Infinity;
    if (t < newest - this.keepMs) return false;
    if (this.snaps.some((q) => q.t === t)) return false;
    if (t >= newest) this.snaps.push(s);
    else {
      // Out of order: slot it in where it belongs.
      let i = n - 1;
      while (i > 0 && this.snaps[i - 1].t > t) i--;
      this.snaps.splice(i, 0, s);
    }
    const last = this.snaps[this.snaps.length - 1];
    this._t = last.t;
    this.latest = last;
    this.lastArrival = now;
    // Keep a few seconds, and always at least two.
    while (this.snaps.length > 2 && this.snaps[0].t < last.t - this.keepMs) this.snaps.shift();
    return true;
  }

  /** True once nothing has been heard for a while. */
  stale(now) {
    return now - this.lastArrival > this.staleMs;
  }

  /**
   * Where to draw them at our time `now`.
   * Returns null until the first snapshot; otherwise
   * { pos, quat, vel, snap, extrapolated, gapMs }.
   */
  sample(now, out = { pos: {}, quat: {}, vel: {} }) {
    const S = this.snaps;
    if (!S.length) return null;
    const rt = now - this.offset - this.delayMs;
    let a = null;
    let b = null;
    for (let i = S.length - 1; i >= 0; i--) {
      if (S[i].t <= rt) {
        a = S[i];
        b = S[i + 1] || null;
        break;
      }
    }
    if (!a) {
      // Earlier than anything held: the oldest is the best there is.
      copyInto(out, S[0]);
      out.snap = S[0];
      out.extrapolated = false;
      out.gapMs = 0;
      return out;
    }
    /*
     * Two snapshots a long way apart in time or space are a respawn, not a
     * journey. Sliding between them would fly the aeroplane through a
     * mountain on its way back to the runway.
     */
    const jump = b && (b.t - a.t > 1500 || dist(a.pos, b.pos) > 60 + speedOf(a) * ((b.t - a.t) / 1000) * 2);
    if (b && !jump) {
      const k = (rt - a.t) / (b.t - a.t);
      out.pos.x = lerp(a.pos.x, b.pos.x, k);
      out.pos.y = lerp(a.pos.y, b.pos.y, k);
      out.pos.z = lerp(a.pos.z, b.pos.z, k);
      out.vel.x = lerp(a.vel.x, b.vel.x, k);
      out.vel.y = lerp(a.vel.y, b.vel.y, k);
      out.vel.z = lerp(a.vel.z, b.vel.z, k);
      slerpQuat(a.quat, b.quat, k, out.quat);
      out.snap = k < 0.5 ? a : b;
      out.extrapolated = false;
      out.gapMs = 0;
      return out;
    }
    // Past the newest (or across a jump): carry on along the velocity, briefly.
    const gap = rt - a.t;
    const dt = Math.min(Math.max(0, gap), this.maxExtrapMs) / 1000;
    out.pos.x = a.pos.x + a.vel.x * dt;
    out.pos.y = a.pos.y + a.vel.y * dt;
    out.pos.z = a.pos.z + a.vel.z * dt;
    out.vel.x = a.vel.x;
    out.vel.y = a.vel.y;
    out.vel.z = a.vel.z;
    out.quat.x = a.quat.x;
    out.quat.y = a.quat.y;
    out.quat.z = a.quat.z;
    out.quat.w = a.quat.w;
    out.snap = a;
    out.extrapolated = gap > 0;
    out.gapMs = Math.max(0, gap);
    return out;
  }
}

function copyInto(out, s) {
  out.pos.x = s.pos.x; out.pos.y = s.pos.y; out.pos.z = s.pos.z;
  out.vel.x = s.vel.x; out.vel.y = s.vel.y; out.vel.z = s.vel.z;
  out.quat.x = s.quat.x; out.quat.y = s.quat.y; out.quat.z = s.quat.z; out.quat.w = s.quat.w;
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function speedOf(s) {
  return Math.hypot(s.vel.x, s.vel.y, s.vel.z);
}

/**
 * What is drawn, as opposed to what is sampled.
 *
 * Sampling is right on average and discontinuous at the seams: when a late
 * snapshot lands after half a second of extrapolating, or after a stall of
 * the sender's, the sample moves by metres in one frame. Measured in the
 * two-page playtest on a loaded machine: a frame-to-frame step of 4,215 m/s
 * for an aeroplane doing 55 — a friend who teleports. So the drawn position
 * follows the sample, and any jump the sample makes that its own velocity
 * does not explain is taken up as an offset that dies away over a few
 * tenths of a second. A jump of more than `snapM` is a respawn, and is gone
 * to at once.
 */
export class Smoother {
  constructor({ tauMs = 150, snapM = 60, ignoreM = 0.25 } = {}) {
    this.tauMs = tauMs;
    this.snapM = snapM;
    this.ignoreM = ignoreM;
    this.prev = null;
    this.prevVel = { x: 0, y: 0, z: 0 };
    this.corr = { x: 0, y: 0, z: 0 };
    this.out = { x: 0, y: 0, z: 0 };
  }

  reset() {
    this.prev = null;
    this.corr.x = this.corr.y = this.corr.z = 0;
  }

  /** `raw` and `vel` from Track.sample; `dt` in seconds since the last call. Returns the position to draw. */
  step(raw, vel, dt) {
    const c = this.corr;
    if (this.prev && dt > 0 && dt < 1) {
      const dx = raw.x - (this.prev.x + this.prevVel.x * dt);
      const dy = raw.y - (this.prev.y + this.prevVel.y * dt);
      const dz = raw.z - (this.prev.z + this.prevVel.z * dt);
      const d = Math.hypot(dx, dy, dz);
      if (d > this.snapM) {
        c.x = c.y = c.z = 0;
      } else if (d > this.ignoreM) {
        c.x -= dx;
        c.y -= dy;
        c.z -= dz;
      }
      const k = Math.exp((-dt * 1000) / this.tauMs);
      c.x *= k;
      c.y *= k;
      c.z *= k;
    } else {
      c.x = c.y = c.z = 0;
    }
    if (!this.prev) this.prev = { x: 0, y: 0, z: 0 };
    this.prev.x = raw.x;
    this.prev.y = raw.y;
    this.prev.z = raw.z;
    this.prevVel.x = vel ? vel.x || 0 : 0;
    this.prevVel.y = vel ? vel.y || 0 : 0;
    this.prevVel.z = vel ? vel.z || 0 : 0;
    this.out.x = raw.x + c.x;
    this.out.y = raw.y + c.y;
    this.out.z = raw.z + c.z;
    return this.out;
  }
}

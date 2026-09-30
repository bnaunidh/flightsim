/**
 * Smooth remote players.
 *
 * Snapshots arrive fifteen times a second, late by however long the Wi-Fi
 * takes and not always in order — the state channel is unreliable and
 * unordered on purpose, because a snapshot that arrives after the next one
 * is worth nothing. Drawing each one as it lands makes an aeroplane that
 * stutters forward in 66 ms hops and teleports when a packet goes missing.
 *
 * TWO WAYS TO DRAW THEM:
 *
 *   sample(now)   the older way: about 100 ms IN THE PAST, between the two
 *                 snapshots either side of that moment, the buffer growing
 *                 to 350 ms on a jittery network. Right, and behind: at
 *                 55 m/s a friend in formation was drawn 7 to 20 metres
 *                 back from where they really were, and a fighter 25 to 90.
 *                 Kept for the tests that pin its behaviour, and as the
 *                 "before" in tests/features/multiplayer.lag.mjs.
 *
 *   predict(now)  what Remotes draws since list 2 ("less lag"): where they
 *                 are NOW. Dead reckoning from the newest snapshot — its
 *                 velocity, the acceleration and turn rate read off the last
 *                 two, at the rate their game's clock is really running —
 *                 and the seam when the next snapshot lands is slid over by
 *                 Smoother (never backwards) and RotSmoother below. An
 *                 aeroplane has a lot of momentum: a Skylark in a 30° turn
 *                 guessed 100 ms ahead is off by three centimetres. A friend
 *                 who goes quiet while everybody else keeps arriving has
 *                 hitched, and is coasted to a stop rather than flown on.
 *                 Measured in tests/features/multiplayer.lag.mjs (good and
 *                 busy Wi-Fi, healthy, struggling and overloaded games) and
 *                 in the eight-tab lobby playtest.
 *
 * When the stream stops — a dropped packet, a tab gone to the background —
 * sample() keeps going along the last velocity for half a second and holds;
 * predict() for `predictMs` (0.9 s) and holds.
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

/** The rotation that takes quaternion a to b, in the world frame (b ⊗ a⁻¹), as an angular velocity over `secs`. */
function omegaBetween(a, b, secs, out) {
  // d = b * conj(a)
  const ax = -a.x, ay = -a.y, az = -a.z, aw = a.w;
  let dx = b.w * ax + b.x * aw + b.y * az - b.z * ay;
  let dy = b.w * ay - b.x * az + b.y * aw + b.z * ax;
  let dz = b.w * az + b.x * ay - b.y * ax + b.z * aw;
  let dw = b.w * aw - b.x * ax - b.y * ay - b.z * az;
  if (dw < 0) {
    dx = -dx; dy = -dy; dz = -dz; dw = -dw;
  }
  const s = Math.hypot(dx, dy, dz);
  if (s < 1e-9 || secs <= 0) {
    out.x = out.y = out.z = 0;
    return out;
  }
  const angle = 2 * Math.atan2(s, dw);
  const k = angle / secs / s;
  out.x = dx * k;
  out.y = dy * k;
  out.z = dz * k;
  return out;
}

/** q advanced by the world-frame angular velocity w for `secs`: exp(w·secs) ⊗ q. */
function advanceQuat(q, w, secs, out) {
  const wx = w.x * secs, wy = w.y * secs, wz = w.z * secs;
  const angle = Math.hypot(wx, wy, wz);
  if (angle < 1e-9) {
    out.x = q.x; out.y = q.y; out.z = q.z; out.w = q.w;
    return out;
  }
  const s = Math.sin(angle / 2) / angle;
  const rx = wx * s, ry = wy * s, rz = wz * s, rw = Math.cos(angle / 2);
  const x = rw * q.x + rx * q.w + ry * q.z - rz * q.y;
  const y = rw * q.y - rx * q.z + ry * q.w + rz * q.x;
  const z = rw * q.z + rx * q.y - ry * q.x + rz * q.w;
  const ww = rw * q.w - rx * q.x - ry * q.y - rz * q.z;
  const l = Math.hypot(x, y, z, ww) || 1;
  out.x = x / l; out.y = y / l; out.z = z / l; out.w = ww / l;
  return out;
}

/** Angle between two orientations, radians. */
export function quatAngle(a, b) {
  const d = Math.abs(a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w);
  return 2 * Math.acos(Math.min(1, d));
}

export class Track {
  constructor({
    delayMs = 100, maxDelayMs = 350, maxExtrapMs = 500, keepMs = 3000, staleMs = 5000,
    predictMs = 900, accelMs = 350, leadMs = 0, maxAccel = 45, maxTurn = 3, stallMs = 220, coastMs = 160, rateK = 0.25,
  } = {}) {
    /*
     * predict(): how far past the newest snapshot to guess before holding
     * still; for how much of that the acceleration and turn rate are kept up
     * (after it, straight on at the last speed — a guess that has run out
     * of evidence should not keep turning); how far behind now to draw (0:
     * now); and the most acceleration (m/s², about 4.5 g) and turn rate
     * (rad/s) believed from two snapshots, so one bad pair cannot fling it.
     */
    this.predictMs = predictMs;
    this.accelMs = accelMs;
    this.leadMs = leadMs;
    this.maxAccel = maxAccel;
    this.maxTurn = maxTurn;
    /*
     * A stream gone quiet. Snapshots land every 66 ms or so; one that has
     * not come for `stallMs` means the sender's game has hitched — and a
     * hitched game's aeroplane is standing still (main.js runs at most
     * 0.1 s of physics a frame) — or the Wi-Fi has. Guessing on at full
     * speed then flew them on past where they had stopped, and pulled them
     * back when they spoke again: measured in the eight-tab lobby playtest,
     * tabs sharing one busy Chrome, 1.2 m typically but 12.7 m at the 95th
     * percentile, worse than the old way's steady 6. So past `stallMs` the
     * guess slows to a stop over `coastMs` — and Smoother's `noBack` makes
     * the correction, when they speak again, a wait rather than a slide
     * backwards. 220 and 160 ms were picked in tests/features/multiplayer.lag.mjs:
     * shorter found them better at the 95th percentile but made them surge
     * and stall four times as often on a Wi-Fi that is merely busy.
     */
    this.stallMs = stallMs;
    this.coastMs = coastMs;
    /*
     * How fast their game's time runs against the clock. A game that
     * hitches loses the time (main.js runs at most 0.1 s of physics a
     * frame), so its aeroplane covers less ground than its speed says —
     * on a machine struggling badly, a lot less. Read off each pair of
     * snapshots in a row (how far it went, against how far its speed
     * would have taken it), smoothed by `rateK`, and the guess runs at
     * that rate. 1 on any healthy game; 0 for rateK turns it off.
     */
    this.rateK = rateK;
    this.rate = 1;
    this._acc = { x: 0, y: 0, z: 0 };
    this._w = { x: 0, y: 0, z: 0 };
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
    if (t >= newest) {
      const prev = n ? this.snaps[n - 1] : null;
      this.snaps.push(s);
      if (prev && this.rateK > 0) this._rate(prev, s);
    } else {
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

  _rate(a, b) {
    const h = (b.t - a.t) / 1000;
    if (!(h > 0.02 && h < 1.5) || isJump(a, b)) return;
    const sp = Math.hypot(a.vel.x + b.vel.x, a.vel.y + b.vel.y, a.vel.z + b.vel.z) / 2;
    const expect = sp * h;
    // Standing still, or nearly: nothing to read, and a slow thing's guess is short anyway.
    if (expect < 1.5) {
      this.rate += (1 - this.rate) * this.rateK;
      return;
    }
    const r = Math.max(0.2, Math.min(1.1, dist(a.pos, b.pos) / expect));
    this.rate += (r - this.rate) * this.rateK;
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

  /**
   * Where they are NOW (less `leadMs`), at our time `now`. Returns null until
   * the first snapshot; otherwise { pos, quat, vel, omega, snap, extrapolated, gapMs }.
   *
   * Almost always the moment asked for is after the newest snapshot — by the
   * network's delay plus however long ago it was sent — so this is dead
   * reckoning: the newest snapshot, carried on along its velocity, with the
   * acceleration and turn rate the last two snapshots show. If the moment is
   * inside what is held (a packet that beat the others), it is the cubic
   * between the two either side, which uses their velocities as well.
   */
  predict(now, out = { pos: {}, quat: {}, vel: {}, omega: {} }, othersAt = null) {
    const S = this.snaps;
    const n = S.length;
    if (!n) return null;
    if (!out.omega) out.omega = {};
    const rt = now - this.offset - this.leadMs;
    const b = S[n - 1];
    if (rt < b.t && n >= 2) {
      let i = n - 1;
      while (i > 0 && S[i - 1].t > rt) i--;
      if (i === 0) {
        copyInto(out, S[0]);
        out.omega.x = out.omega.y = out.omega.z = 0;
        out.snap = S[0];
        out.extrapolated = false;
        out.gapMs = 0;
        return out;
      }
      const a = S[i - 1];
      const c = S[i];
      if (!isJump(a, c)) {
        const h = (c.t - a.t) / 1000;
        const k = (rt - a.t) / (c.t - a.t);
        hermite(a, c, h, k, out);
        slerpQuat(a.quat, c.quat, k, out.quat);
        omegaBetween(a.quat, c.quat, h, out.omega);
        out.snap = k < 0.5 ? a : c;
        out.extrapolated = false;
        out.gapMs = 0;
        return out;
      }
    }
    // Past the newest: carry it on.
    const acc = this._acc;
    const w = this._w;
    acc.x = acc.y = acc.z = 0;
    w.x = w.y = w.z = 0;
    const a = n >= 2 ? S[n - 2] : null;
    if (a && b.t - a.t >= 20 && b.t - a.t <= 400 && !isJump(a, b)) {
      const h = (b.t - a.t) / 1000;
      acc.x = (b.vel.x - a.vel.x) / h;
      acc.y = (b.vel.y - a.vel.y) / h;
      acc.z = (b.vel.z - a.vel.z) / h;
      const am = Math.hypot(acc.x, acc.y, acc.z);
      if (am > this.maxAccel) {
        const s = this.maxAccel / am;
        acc.x *= s; acc.y *= s; acc.z *= s;
      }
      omegaBetween(a.quat, b.quat, h, w);
      const wm = Math.hypot(w.x, w.y, w.z);
      if (wm > this.maxTurn) {
        const s = this.maxTurn / wm;
        w.x *= s; w.y *= s; w.z *= s;
      }
    }
    const gap = Math.max(0, rt - b.t);
    /*
     * Quiet for longer than a stream should be: coast to a stop rather than
     * fly on — unless `othersAt` (when anything last came from the host, for
     * anybody else) says this whole connection has gone quiet, which is the
     * Wi-Fi and not their game: then everybody is still flying, and the
     * guess carries on. With nobody else to tell by (two players), coast.
     */
    const linkQuiet = othersAt != null && now - othersAt > this.stallMs;
    const quiet = this.stallMs > 0 && !linkQuiet ? now - this.lastArrival - this.stallMs : 0;
    let ext = gap;
    let slow = 1;
    if (quiet > 0) {
      ext = Math.max(0, gap - quiet) + this.coastMs * (1 - Math.exp(-quiet / this.coastMs));
      slow = Math.exp(-quiet / this.coastMs);
    }
    const dt = (Math.min(ext, this.predictMs) / 1000) * (this.rateK > 0 ? Math.min(1, this.rate) : 1);
    const ta = Math.min(dt, this.accelMs / 1000);
    // Accelerating for ta, then straight on at the speed reached.
    const kx = 0.5 * ta * ta + ta * (dt - ta);
    out.pos.x = b.pos.x + b.vel.x * dt + acc.x * kx;
    out.pos.y = b.pos.y + b.vel.y * dt + acc.y * kx;
    out.pos.z = b.pos.z + b.vel.z * dt + acc.z * kx;
    // The velocity it is drawn moving at, which Smoother reads to tell a seam from motion: slowing as it coasts.
    const holding = gap > this.predictMs;
    const k = holding ? 0 : slow;
    const kr = k * (this.rateK > 0 ? Math.min(1, this.rate) : 1);
    out.vel.x = (b.vel.x + acc.x * ta) * kr;
    out.vel.y = (b.vel.y + acc.y * ta) * kr;
    out.vel.z = (b.vel.z + acc.z * ta) * kr;
    advanceQuat(b.quat, w, ta, out.quat);
    const turning = !holding && dt <= ta;
    out.omega.x = turning ? w.x : 0;
    out.omega.y = turning ? w.y : 0;
    out.omega.z = turning ? w.z : 0;
    out.snap = b;
    out.extrapolated = gap > 0;
    out.gapMs = gap;
    return out;
  }
}

/** Two snapshots a long way apart in time or space: a respawn, not a journey. */
function isJump(a, b) {
  return b.t - a.t > 1500 || dist(a.pos, b.pos) > 60 + speedOf(a) * ((b.t - a.t) / 1000) * 2;
}

/** The cubic between two snapshots that leaves each at its own velocity (Hermite), at fraction k of `h` seconds. */
function hermite(a, b, h, k, out) {
  const k2 = k * k;
  const k3 = k2 * k;
  const h00 = 2 * k3 - 3 * k2 + 1;
  const h10 = k3 - 2 * k2 + k;
  const h01 = -2 * k3 + 3 * k2;
  const h11 = k3 - k2;
  for (const c of ['x', 'y', 'z']) {
    out.pos[c] = h00 * a.pos[c] + h10 * h * a.vel[c] + h01 * b.pos[c] + h11 * h * b.vel[c];
    out.vel[c] = lerp(a.vel[c], b.vel[c], k);
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
  /*
   * `snapSecs`: a jump is a respawn when it is more than `snapM`, or more
   * than that many seconds of travel at the speed it is going — a fighter at
   * 220 m/s whose snapshot was 300 ms late is 66 m out, which is a late
   * snapshot and not a respawn, and was being teleported. 0 keeps the older
   * fixed 60 m.
   */
  /*
   * `noBack`: never draw them going backwards along their own path. A
   * guess that ran on past where a hitched friend had stopped is taken back
   * by waiting — the drawn aeroplane slows, stops, and they fly on into it
   * — instead of sliding backwards, which is the rubber band a child sees.
   * Sideways and up-and-down corrections are slid over as before.
   */
  constructor({ tauMs = 150, snapM = 60, ignoreM = 0.25, snapSecs = 0, noBack = false } = {}) {
    this.tauMs = tauMs;
    this.snapM = snapM;
    this.snapSecs = snapSecs;
    this.ignoreM = ignoreM;
    this.noBack = noBack;
    this.prev = null;
    this._drawn = null;
    this.prevVel = { x: 0, y: 0, z: 0 };
    this.corr = { x: 0, y: 0, z: 0 };
    this.out = { x: 0, y: 0, z: 0 };
  }

  reset() {
    this.prev = null;
    this._drawn = null;
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
      const snap = this.snapSecs ? Math.max(this.snapM, Math.hypot(this.prevVel.x, this.prevVel.y, this.prevVel.z) * this.snapSecs) : this.snapM;
      if (d > snap) {
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
    if (this.noBack) {
      const d = this._drawn;
      const sp = Math.hypot(this.prevVel.x, this.prevVel.y, this.prevVel.z);
      if (d && sp > 1 && Math.abs(c.x) + Math.abs(c.y) + Math.abs(c.z) > 0) {
        const ux = this.prevVel.x / sp, uy = this.prevVel.y / sp, uz = this.prevVel.z / sp;
        const along = (this.out.x - d.x) * ux + (this.out.y - d.y) * uy + (this.out.z - d.z) * uz;
        if (along < 0) {
          // Held where it was along the path; the correction keeps what it did not use, for later.
          this.out.x -= ux * along; this.out.y -= uy * along; this.out.z -= uz * along;
          c.x -= ux * along; c.y -= uy * along; c.z -= uz * along;
        }
      }
      if (!this._drawn) this._drawn = { x: 0, y: 0, z: 0 };
      this._drawn.x = this.out.x; this._drawn.y = this.out.y; this._drawn.z = this.out.z;
    }
    return this.out;
  }
}

/**
 * The same for which way they point. predict() turns the newest snapshot on
 * at the turn rate the last two showed, so between snapshots the attitude
 * moves on smoothly; when the next one lands it can disagree by a degree or
 * two (more if the stick was just thrown over), and turning the model by
 * that in one frame is a twitch. The disagreement is taken up as a
 * correction that dies away over `tauMs`; one of more than `snapDeg` is a
 * respawn and is gone to at once.
 *
 *   drawn = corr ⊗ raw        corr → identity with time constant tauMs
 */
export class RotSmoother {
  constructor({ tauMs = 120, snapDeg = 75, ignoreDeg = 0.4 } = {}) {
    this.tauMs = tauMs;
    this.snap = (snapDeg * Math.PI) / 180;
    this.ignore = (ignoreDeg * Math.PI) / 180;
    this.prev = null;
    this.prevW = { x: 0, y: 0, z: 0 };
    this.corr = { x: 0, y: 0, z: 0, w: 1 };
    this._exp = { x: 0, y: 0, z: 0, w: 1 };
    this._inv = { x: 0, y: 0, z: 0, w: 1 };
    this.out = { x: 0, y: 0, z: 0, w: 1 };
  }

  reset() {
    this.prev = null;
    const c = this.corr;
    c.x = c.y = c.z = 0;
    c.w = 1;
  }

  /** `raw` and `omega` from Track.predict; `dt` in seconds. Returns the orientation to draw. */
  step(raw, omega, dt) {
    const c = this.corr;
    if (this.prev && dt > 0 && dt < 1) {
      // Where last frame's attitude was heading, and how far the new one is from that.
      const e = advanceQuat(this.prev, this.prevW, dt, this._exp);
      const ang = quatAngle(raw, e);
      if (ang > this.snap) {
        c.x = c.y = c.z = 0;
        c.w = 1;
      } else if (ang > this.ignore) {
        // corr' = corr ⊗ e ⊗ raw⁻¹, so that corr' ⊗ raw = corr ⊗ e: what is drawn does not move.
        const inv = this._inv;
        inv.x = -raw.x; inv.y = -raw.y; inv.z = -raw.z; inv.w = raw.w;
        mulInto(c, mulInto(e, inv, e), c);
      }
      slerpQuat(c, IDENT, 1 - Math.exp((-dt * 1000) / this.tauMs), c);
    } else {
      c.x = c.y = c.z = 0;
      c.w = 1;
    }
    if (!this.prev) this.prev = { x: 0, y: 0, z: 0, w: 1 };
    this.prev.x = raw.x; this.prev.y = raw.y; this.prev.z = raw.z; this.prev.w = raw.w;
    this.prevW.x = omega ? omega.x || 0 : 0;
    this.prevW.y = omega ? omega.y || 0 : 0;
    this.prevW.z = omega ? omega.z || 0 : 0;
    return mulInto(c, raw, this.out);
  }
}

const IDENT = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

/** out = a ⊗ b, normalised (out may be a or b). */
function mulInto(a, b, out) {
  const x = a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y;
  const y = a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x;
  const z = a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w;
  const w = a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z;
  const l = Math.hypot(x, y, z, w) || 1;
  out.x = x / l; out.y = y / l; out.z = z / l; out.w = w / l;
  return out;
}

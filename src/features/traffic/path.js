/**
 * Paths for the traffic to fly along.
 *
 * The AI aeroplanes are not flown by the physics. They are moved along a
 * precomputed path at a speed, and everything that makes them look flown —
 * the bank into a turn, the nose coming up on the climb and in the flare,
 * the wheels touching the runway at the aiming point — is read off the shape
 * of that path. So the path has to carry more than positions: at every point
 * it knows its height, its compass heading, how hard it is turning, whether
 * that point is on the ground, and how fast the aeroplane may be going there.
 *
 * Nothing in here touches Three or the world. It is plain arithmetic on
 * typed arrays, so the node test can plan every map without a page.
 *
 * AXES, the game's own: X east, Z south (-Z is north), Y up. A compass
 * heading h points along (sin h, 0, -cos h), in radians here.
 */

export const DEG = Math.PI / 180;
const TAU = Math.PI * 2;

/** An angle folded into (-π, π]. */
export function wrapPi(a) {
  a %= TAU;
  if (a > Math.PI) a -= TAU;
  else if (a <= -Math.PI) a += TAU;
  return a;
}

/** Compass heading, radians, of a step (dx, dz). */
export function headingOf(dx, dz) {
  return Math.atan2(dx, -dz);
}

/**
 * A 2D polyline being drawn, before it has heights or speeds.
 *
 * Builders append to it in order — straight runs, arcs, filleted corners,
 * Dubins curves — and `finish()` turns the result into a Path.
 */
export class Draft {
  constructor(x, z) {
    this.xs = [];
    this.zs = [];
    if (x != null) this.push(x, z);
  }

  get n() {
    return this.xs.length;
  }

  get lastX() {
    return this.xs[this.xs.length - 1];
  }

  get lastZ() {
    return this.zs[this.zs.length - 1];
  }

  /** Heading of the last step drawn (radians), or `fallback` if there is none. */
  lastHeading(fallback = 0) {
    const n = this.xs.length;
    if (n < 2) return fallback;
    return headingOf(this.xs[n - 1] - this.xs[n - 2], this.zs[n - 1] - this.zs[n - 2]);
  }

  push(x, z) {
    const n = this.xs.length;
    /*
     * Joins between builders repeat the shared point, and a fillet whose
     * straight is used up by its arc starts the arc a centimetre after the
     * corner before. A step that short makes curvature out of nothing — the
     * node test measured a "1 m radius" at the start of a taxi-out whose real
     * turn was 13 m — and the speed limit that follows it crawls. Every real
     * step here is half a metre or more.
     */
    if (n && Math.abs(x - this.xs[n - 1]) < 0.2 && Math.abs(z - this.zs[n - 1]) < 0.2) {
      // Keep the newer point, so a route still ends exactly where it was
      // asked to — but never move the start.
      if (n > 1) {
        this.xs[n - 1] = x;
        this.zs[n - 1] = z;
      }
      return this;
    }
    this.xs.push(x);
    this.zs.push(z);
    return this;
  }

  /** A straight run to (x, z), with a point every `step` metres. */
  line(x, z, step = 50) {
    const x0 = this.lastX;
    const z0 = this.lastZ;
    const d = Math.hypot(x - x0, z - z0);
    const k = Math.max(1, Math.ceil(d / step));
    for (let i = 1; i <= k; i++) this.push(x0 + ((x - x0) * i) / k, z0 + ((z - z0) * i) / k);
    return this;
  }

  /** Straight ahead on the current heading for `len` metres. */
  ahead(len, step = 50, heading = null) {
    const h = heading == null ? this.lastHeading() : heading;
    return this.line(this.lastX + Math.sin(h) * len, this.lastZ - Math.cos(h) * len, step);
  }

  /**
   * Turn on the spot's circle: from the current point and `heading`, through
   * `delta` radians (positive = right, clockwise from above) at radius r.
   */
  turn(heading, delta, r, stepDeg = 4) {
    const sgn = delta >= 0 ? 1 : -1;
    // Centre of the turn: to the right of the heading for a right turn.
    const cx = this.lastX + Math.cos(heading) * r * sgn;
    const cz = this.lastZ + Math.sin(heading) * r * sgn;
    const k = Math.max(1, Math.ceil(Math.abs(delta) / (stepDeg * DEG)));
    for (let i = 1; i <= k; i++) {
      const h = heading + (delta * i) / k;
      // Point on the circle whose tangent is heading h.
      this.push(cx - Math.cos(h) * r * sgn, cz - Math.sin(h) * r * sgn);
    }
    return this;
  }

  /**
   * Waypoints joined by straight lines with each corner rounded off.
   *
   * `pts` is [{x, z, r}], the first being where the draft already is (or is
   * about to start). Each interior corner is filleted with its own radius,
   * shrunk when the legs either side are too short to hold it — a sharp
   * corner is better than a curve that overshoots into the grass.
   */
  fillet(pts, step = 5, stepDeg = 5) {
    /*
     * Waypoints that repeat the one before are dropped first. A route builder
     * that asks for "along the taxiway to the connector" when it is already
     * level with the connector produces one, and a zero-length leg used to be
     * skipped without being drawn — and the next corner then took its way in
     * from a zero vector, which is heading north whatever the truth was.
     */
    pts = pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1].x, p.z - pts[i - 1].z) > 0.05);
    const n = pts.length;
    if (!n) return this;
    if (!this.xs.length) this.push(pts[0].x, pts[0].z);
    // The tangent length each corner may use, limited by its neighbours.
    const segLen = [];
    for (let i = 0; i < n - 1; i++) segLen.push(Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].z - pts[i].z));
    for (let i = 1; i < n; i++) {
      const p = pts[i];
      if (i === n - 1) {
        this.line(p.x, p.z, step);
        break;
      }
      const q = pts[i + 1];
      const inLen = segLen[i - 1];
      const outLen = segLen[i];
      if (inLen < 1e-6 || outLen < 1e-6) continue;
      const hin = headingOf(p.x - pts[i - 1].x, p.z - pts[i - 1].z);
      const hout = headingOf(q.x - p.x, q.z - p.z);
      const delta = wrapPi(hout - hin);
      const r = p.r || 0;
      if (Math.abs(delta) < 1e-3 || r <= 0) {
        this.line(p.x, p.z, step);
        continue;
      }
      const tanHalf = Math.tan(Math.abs(delta) / 2);
      // Share each leg with the corner at its other end, except at the ends
      // of the whole route where nothing else wants it.
      const inAvail = i - 1 === 0 ? inLen : inLen / 2;
      const outAvail = i + 1 === n - 1 ? outLen : outLen / 2;
      let t = r * tanHalf;
      t = Math.min(t, inAvail * 0.999, outAvail * 0.999);
      const rEff = t / tanHalf;
      // Tangent point on the way in.
      const tx = p.x - Math.sin(hin) * t;
      const tz = p.z + Math.cos(hin) * t;
      this.line(tx, tz, step);
      this.turn(hin, delta, rEff, stepDeg);
    }
    return this;
  }

  /**
   * The shortest turn-straight-turn path from where the draft is, on
   * `heading`, to (x, z) arriving on `endHeading`, with turns of radius r.
   *
   * Dubins curves: of the four CSC words (left-straight-left, right-straight-
   * right and the two crossed ones) the shortest that exists. LSL and RSR
   * always exist, so this never fails. The three-turn words are left out on
   * purpose — they only win when the two ends are closer than a turn
   * diameter, and the planner never asks for that.
   */
  dubins(heading, x, z, endHeading, r, step = 50, stepDeg = 4) {
    const d = dubinsPlan(this.lastX, this.lastZ, heading, x, z, endHeading, r);
    this.turn(heading, d.a0, r, stepDeg);
    const h1 = heading + d.a0;
    if (d.L > 1e-6) this.ahead(d.L, step, h1);
    this.turn(h1, d.a1, r, stepDeg);
    // Arithmetic drift on a long chain is millimetres; pin the end anyway so
    // the next leg starts exactly where this one was asked to finish.
    this.xs[this.xs.length - 1] = x;
    this.zs[this.zs.length - 1] = z;
    return this;
  }

  /** Turn the drawing into a Path with arrays for everything else. */
  finish() {
    return new Path(this.xs, this.zs);
  }
}

/**
 * Plan a Dubins CSC path. Returns turn angles a0, a1 (signed, + = right) and
 * the straight length L between them.
 */
export function dubinsPlan(x0, z0, h0, x1, z1, h1, r) {
  // Work in a right-handed maths frame: E = x, N = -z, angle θ = π/2 - h
  // anticlockwise from east. A left turn is anticlockwise in both.
  const t0 = Math.PI / 2 - h0;
  const t1 = Math.PI / 2 - h1;
  const e0 = x0, n0 = -z0, e1 = x1, n1 = -z1;
  const left = (e, n, t) => [e - r * Math.sin(t), n + r * Math.cos(t)];
  const right = (e, n, t) => [e + r * Math.sin(t), n - r * Math.cos(t)];
  const mod = (a) => ((a % TAU) + TAU) % TAU;
  let best = null;
  const consider = (word, a0, L, a1) => {
    const len = r * (Math.abs(a0) + Math.abs(a1)) + L;
    if (!best || len < best.len) best = { word, a0, L, a1, len };
  };
  // LSL
  {
    const [ax, ay] = left(e0, n0, t0);
    const [bx, by] = left(e1, n1, t1);
    const phi = Math.atan2(by - ay, bx - ax);
    const L = Math.hypot(bx - ax, by - ay);
    // Anticlockwise in θ is a left turn: negative in compass terms.
    consider('LSL', -mod(phi - t0), L, -mod(t1 - phi));
  }
  // RSR
  {
    const [ax, ay] = right(e0, n0, t0);
    const [bx, by] = right(e1, n1, t1);
    const phi = Math.atan2(by - ay, bx - ax);
    const L = Math.hypot(bx - ax, by - ay);
    consider('RSR', mod(t0 - phi), L, mod(phi - t1));
  }
  // LSR
  {
    const [ax, ay] = left(e0, n0, t0);
    const [bx, by] = right(e1, n1, t1);
    const D = Math.hypot(bx - ax, by - ay);
    if (D >= 2 * r) {
      const L = Math.sqrt(D * D - 4 * r * r);
      const phi = Math.atan2(by - ay, bx - ax) + Math.atan2(2 * r, L);
      consider('LSR', -mod(phi - t0), L, mod(phi - t1));
    }
  }
  // RSL
  {
    const [ax, ay] = right(e0, n0, t0);
    const [bx, by] = left(e1, n1, t1);
    const D = Math.hypot(bx - ax, by - ay);
    if (D >= 2 * r) {
      const L = Math.sqrt(D * D - 4 * r * r);
      const phi = Math.atan2(by - ay, bx - ax) - Math.atan2(2 * r, L);
      consider('RSL', mod(t0 - phi), L, -mod(t1 - phi));
    }
  }
  return best;
}

/**
 * A finished path: typed arrays, one entry per point.
 *
 *   x, y, z   position of the wheels' contact point (y is the ground or the
 *             height of the aeroplane's lowest wheel in the air)
 *   s         distance along the path, metres
 *   hdg       compass heading of the tangent, radians
 *   kappa     signed curvature, 1/m (+ = turning right)
 *   ground    1 where the wheels are on the ground
 *   vmax      the fastest the aeroplane may be going here, m/s
 */
export class Path {
  constructor(xs, zs) {
    const n = xs.length;
    this.n = n;
    this.x = Float64Array.from(xs);
    this.z = Float64Array.from(zs);
    this.y = new Float64Array(n);
    this.s = new Float64Array(n);
    this.hdg = new Float64Array(n);
    this.kappa = new Float32Array(n);
    this.ground = new Uint8Array(n);
    this.vmax = new Float32Array(n);
    for (let i = 1; i < n; i++) {
      this.s[i] = this.s[i - 1] + Math.hypot(this.x[i] - this.x[i - 1], this.z[i] - this.z[i - 1]);
    }
    this.length = n ? this.s[n - 1] : 0;
    // Tangent headings: centred differences where there are neighbours.
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      this.hdg[i] = n > 1 ? headingOf(this.x[b] - this.x[a], this.z[b] - this.z[a]) : 0;
    }
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1);
      const b = Math.min(n - 1, i + 1);
      const ds = this.s[b] - this.s[a];
      this.kappa[i] = ds > 1e-6 ? wrapPi(this.hdg[b] - this.hdg[a]) / ds : 0;
    }
    // One pass of smoothing: the joins between straights and arcs are a step
    // in curvature, and a step in curvature is a jerk in the bank angle.
    if (n > 2) {
      const k = Float32Array.from(this.kappa);
      for (let i = 1; i < n - 1; i++) this.kappa[i] = (k[i - 1] + 2 * k[i] + k[i + 1]) / 4;
    }
  }

  /** Index of the last point at or before distance s, starting the search at `hint`. */
  seek(s, hint = 0) {
    const S = this.s;
    let i = Math.min(Math.max(0, hint | 0), this.n - 2);
    if (i < 0) return 0;
    while (i < this.n - 2 && S[i + 1] <= s) i++;
    while (i > 0 && S[i] > s) i--;
    return i;
  }

  /**
   * Everything about the path at distance s, written into `out`. `cur` is a
   * { i } cursor so a monotonic walk costs O(1) per frame. No allocation.
   */
  sample(s, cur, out) {
    const n = this.n;
    if (n < 2) {
      out.x = this.x[0] || 0;
      out.y = this.y[0] || 0;
      out.z = this.z[0] || 0;
      out.hdg = this.hdg[0] || 0;
      out.kappa = 0;
      out.grad = 0;
      out.ground = this.ground[0] || 0;
      out.vmax = this.vmax[0] || 0;
      return out;
    }
    if (s < 0) s = 0;
    else if (s > this.length) s = this.length;
    const i = (cur.i = this.seek(s, cur.i));
    const S = this.s;
    const ds = S[i + 1] - S[i];
    const t = ds > 1e-9 ? (s - S[i]) / ds : 0;
    out.x = this.x[i] + (this.x[i + 1] - this.x[i]) * t;
    out.y = this.y[i] + (this.y[i + 1] - this.y[i]) * t;
    out.z = this.z[i] + (this.z[i + 1] - this.z[i]) * t;
    out.hdg = this.hdg[i] + wrapPi(this.hdg[i + 1] - this.hdg[i]) * t;
    out.kappa = this.kappa[i] + (this.kappa[i + 1] - this.kappa[i]) * t;
    out.grad = ds > 1e-9 ? (this.y[i + 1] - this.y[i]) / ds : 0;
    out.ground = t < 0.5 ? this.ground[i] : this.ground[i + 1];
    out.vmax = this.vmax[i] + (this.vmax[i + 1] - this.vmax[i]) * t;
    return out;
  }

  /** First index whose distance is at or past s. */
  indexAt(s) {
    const i = this.seek(s, 0);
    return this.s[i] >= s ? i : Math.min(this.n - 1, i + 1);
  }

  /**
   * Speed limits along the path.
   *
   * `target(i)` is the speed wanted at point i. On the ground it is further
   * capped by how tight the corner is (`latAccel`), which is what makes a
   * taxiing aeroplane slow for the turn on to the runway without anybody
   * telling it to. Then a forward pass limits acceleration from `v0` and a
   * backward pass limits braking into `vEnd` — so the profile is always one
   * the aeroplane can actually fly, and the runtime only has to follow it.
   */
  setSpeeds(target, { v0 = 0, vEnd = Infinity, accel = 1, decel = 1, latAccel = 1.6, groundOnlyLat = true } = {}) {
    const n = this.n;
    const v = this.vmax;
    // Either may be a number or a function of the point index — the roll-out
    // brakes on the wheels, the approach before it only on the air.
    const acc = typeof accel === 'function' ? accel : () => accel;
    const dec = typeof decel === 'function' ? decel : () => decel;
    for (let i = 0; i < n; i++) {
      let t = target(i);
      const k = Math.abs(this.kappa[i]);
      if (k > 1e-5 && (!groundOnlyLat || this.ground[i])) t = Math.min(t, Math.sqrt(latAccel / k));
      v[i] = t;
    }
    v[0] = Math.min(v[0], v0);
    for (let i = 1; i < n; i++) {
      const ds = this.s[i] - this.s[i - 1];
      v[i] = Math.min(v[i], Math.sqrt(v[i - 1] * v[i - 1] + 2 * acc(i) * ds));
    }
    if (Number.isFinite(vEnd)) v[n - 1] = Math.min(v[n - 1], vEnd);
    for (let i = n - 2; i >= 0; i--) {
      const ds = this.s[i + 1] - this.s[i];
      v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * dec(i) * ds));
    }
    return this;
  }
}

/**
 * Heights for an air leg that must start at ys, finish at ye, never climb
 * steeper than gc or descend steeper than gd (both as gradients, metres per
 * metre), and stay at or above `floor[i]` wherever the ends allow it.
 *
 * The floor is first made flyable on its own — climbing early enough to
 * clear high ground ahead, descending no faster than gd behind it — and then
 * clamped between what can be reached from the start and what can still get
 * down (or up) to the end. Min and max of gradient-limited functions are
 * gradient-limited, so the result is always flyable; whether it clears the
 * ground near the ends is for the caller to check.
 */
export function verticalProfile(path, ys, ye, floor, gc, gd) {
  const n = path.n;
  const S = path.s;
  const total = path.length;
  const T = Float64Array.from(floor);
  for (let i = n - 2; i >= 0; i--) T[i] = Math.max(T[i], T[i + 1] - gc * (S[i + 1] - S[i]));
  for (let i = 1; i < n; i++) T[i] = Math.max(T[i], T[i - 1] - gd * (S[i] - S[i - 1]));
  for (let i = 0; i < n; i++) {
    const s = S[i];
    const hi = Math.min(ys + gc * s, ye + gd * (total - s));
    const lo = Math.max(ys - gd * s, ye - gc * (total - s));
    path.y[i] = Math.min(hi, Math.max(lo, T[i]));
  }
  return path;
}

/** A small seeded random generator (mulberry32), so plans are repeatable. */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

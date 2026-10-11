/**
 * Lanes for the ambient cars and routes for the ambient boats, worked out
 * from what the map already has — no coordinates of their own.
 *
 * CARS drive on LANES: each street planTown() drew and each road the map
 * laid gives two, one each way, offset to the right-hand side of the line
 * (right-hand traffic, as the roads' own markings have it). A lane is flat
 * arrays — x, z, y per point and the running distance — so the cars'
 * per-frame arithmetic allocates nothing. Where a lane ends it names the
 * lanes a car may go on to: any lane that starts, or passes, within JOIN
 * metres of the end, with the lane back the other way as the last resort
 * (a turn round at a dead end). Where another lane starts beside this one
 * mid-way, that is a junction a car may turn off at.
 *
 * SIGNALS stand where two drawn streets cross or meet: a phase clock each,
 * north-south then east-west, and a stop line on every lane through it.
 *
 * RUNWAYS are never crossed. Every polyline is cut where it enters a runway
 * strip (either runway, RUNWAY_OFF metres out from the paved edge) and the
 * pieces on either side become their own roads, each ending at the strip,
 * where a car turns round the way it does at any dead end. An air base's
 * perimeter loop is a road along each side of its runway; a country road
 * that crosses the crosswind strip stops short of it on both sides. The
 * tarmac itself is the map's and is left alone — only the cars keep off.
 *
 * BOATS follow ROUTES in water at least BOAT_DEPTH deep, kept CHANNEL_OFF
 * metres off any marked channel's centreline and DECK_OFF off any deck pad
 * (nobody sails under a rig). A route is asked for round a place or between
 * two; every leg is sampled every 20 m and a leg that touches land, the
 * channel or a deck is dropped or bent round; what survives is a loop if it
 * closes and a run back and forth if it does not.
 *
 * Pure: terrain's heightAt and the map's data in, arrays out. Node runs it
 * for every map in tests/features/ambient.mjs.
 */

import { heightAt, MAP, isOnAnyRunway } from '../../world/terrain.js';
import { PAVED_HALF } from '../../world/roads.js';
import { makeRandom } from '../../core/noise.js';

/** Metres between a lane end and a lane it may join. */
export const JOIN = 22;
/** Metres a car lane's road is cut short of a runway strip's paved edge. */
export const RUNWAY_OFF = 15;
/** Metres between the samples that find where a road meets a strip (the strips are 60 m and more across). */
const RUNWAY_STEP = 4;
/** The least water under a boat's route. */
export const BOAT_DEPTH = 3;
/** Boats keep this far from a channel's centreline on the boat maps. */
export const CHANNEL_OFF = 60;
/** And this far from a helideck's legs. */
export const DECK_OFF = 60;
/** Sampling step along a boat leg, metres. */
const SEA_STEP = 8;
/** Water asked for over BOAT_DEPTH, so a sample between two samples still has it. */
const SEA_MARGIN = 0.4;
/** A car's lane sits this far from the line, on a street; on a road, half the paved strip. */
const STREET_LANE = 0.45;

/* ------------------------------------------------------------------ */
/* Lanes                                                               */
/* ------------------------------------------------------------------ */

/**
 * One lane from a polyline of [x, z] (or [x, z, y]) points, offset `off`
 * metres to the right of the direction of travel. `rev` walks the points
 * backwards. Heights are read once here, never per frame.
 */
function laneFrom(pts, off, rev, meta) {
  const n = pts.length;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  const ys = new Float32Array(n);
  const cum = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const i = rev ? n - 1 - k : k;
    const a = pts[Math.max(0, Math.min(n - 1, rev ? i + 1 : i - 1))];
    const b = pts[Math.max(0, Math.min(n - 1, rev ? i - 1 : i + 1))];
    let tx = b[0] - a[0];
    let tz = b[1] - a[1];
    const L = Math.hypot(tx, tz) || 1;
    tx /= L;
    tz /= L;
    // Right of travel (tx, tz) is (-tz, tx): heading north (0,-1) gives east (1,0).
    const x = pts[i][0] - tz * off;
    const z = pts[i][1] + tx * off;
    xs[k] = x;
    zs[k] = z;
    ys[k] = pts[i].length > 2 && Number.isFinite(pts[i][2]) ? pts[i][2] : heightAt(x, z);
    cum[k] = k ? cum[k - 1] + Math.hypot(x - xs[k - 1], z - zs[k - 1]) : 0;
  }
  return { xs, zs, ys, cum, len: cum[n - 1], n, next: [], junctions: [], stops: [], ...meta };
}

function segDist2(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return { d2: qx * qx + qz * qz, t };
}

/** The distance along `lane` of the point on it nearest (x, z), and how far off. */
export function nearestOnLane(lane, x, z) {
  let best = Infinity;
  let s = 0;
  for (let i = 1; i < lane.n; i++) {
    const r = segDist2(x, z, lane.xs[i - 1], lane.zs[i - 1], lane.xs[i], lane.zs[i]);
    if (r.d2 < best) {
      best = r.d2;
      s = lane.cum[i - 1] + (lane.cum[i] - lane.cum[i - 1]) * r.t;
    }
  }
  return { s, d: Math.sqrt(best) };
}

/**
 * Where a lane is at distance s: writes x, y, z and the heading (degrees)
 * into `out`, allocating nothing. `hint` is the segment index to start from.
 */
export function sampleLane(lane, s, out, hint = 0) {
  const n = lane.n;
  if (s <= 0) {
    out.x = lane.xs[0];
    out.z = lane.zs[0];
    out.y = lane.ys[0];
    out.i = 0;
  } else if (s >= lane.len) {
    out.x = lane.xs[n - 1];
    out.z = lane.zs[n - 1];
    out.y = lane.ys[n - 1];
    out.i = n - 2;
  } else {
    let i = Math.max(1, Math.min(n - 1, hint + 1));
    while (i > 1 && lane.cum[i - 1] > s) i--;
    while (i < n - 1 && lane.cum[i] < s) i++;
    const s0 = lane.cum[i - 1];
    const s1 = lane.cum[i];
    const t = s1 > s0 ? (s - s0) / (s1 - s0) : 0;
    out.x = lane.xs[i - 1] + (lane.xs[i] - lane.xs[i - 1]) * t;
    out.z = lane.zs[i - 1] + (lane.zs[i] - lane.zs[i - 1]) * t;
    out.y = lane.ys[i - 1] + (lane.ys[i] - lane.ys[i - 1]) * t;
    out.i = i - 1;
  }
  const i = Math.max(0, Math.min(n - 2, out.i));
  out.heading = (Math.atan2(lane.xs[i + 1] - lane.xs[i], -(lane.zs[i + 1] - lane.zs[i])) * 180) / Math.PI;
  return out;
}

/**
 * A circuit round a place, carved to dry level ground: 16 points on a ring,
 * each moved in or out until it stands on land over 1.5 m, with the steep
 * and wet ones dropped. Null when fewer than 6 survive.
 */
export function loopAround(cx, cz, r) {
  const pts = [];
  for (let a = 0; a < 16; a++) {
    const ang = (a / 16) * Math.PI * 2;
    const ux = Math.sin(ang);
    const uz = -Math.cos(ang);
    let best = null;
    for (const k of [1, 0.85, 1.15, 0.7, 1.3]) {
      const x = cx + ux * r * k;
      const z = cz + uz * r * k;
      const h = heightAt(x, z);
      if (h > 1.5 && Math.abs(heightAt(x + 8, z) - heightAt(x - 8, z)) < 2.5 && Math.abs(heightAt(x, z + 8) - heightAt(x, z - 8)) < 2.5) {
        best = [x, z];
        break;
      }
    }
    if (best) pts.push(best);
  }
  if (pts.length < 6) return null;
  pts.push([pts[0][0], pts[0][1]]);
  return pts;
}

/** A point `t` of the way from a to b, with a's and b's height carried when both have one. */
function lerpPt(a, b, t) {
  const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  if (a.length > 2 && b.length > 2 && Number.isFinite(a[2]) && Number.isFinite(b[2])) p.push(a[2] + (b[2] - a[2]) * t);
  return p;
}

/**
 * Cut a polyline of [x, z] (or [x, z, y]) points where it crosses a runway
 * strip — either runway, `off` metres out from the paved edge — and return
 * the pieces that lie outside, each ending at the strip's edge. A polyline
 * that never meets a strip comes back as the one piece it was. Pieces of
 * fewer than two points are dropped (buildLanes drops anything under 10 m).
 *
 * Every segment is walked in RUNWAY_STEP metre samples; where the samples
 * change from off the strip to on it (or back) the edge is found by
 * bisection, so a piece ends within centimetres of `off` from the tarmac.
 * Pure: terrain's isOnAnyRunway for the loaded map, no allocation per frame
 * (this runs once per map, at build).
 */
export function carveRunways(pts, off = RUNWAY_OFF) {
  if (!pts || pts.length < 2) return [];
  const on = (x, z) => isOnAnyRunway(x, z, off);
  const pieces = [];
  let cur = [];
  const close = () => {
    if (cur.length >= 2) pieces.push(cur);
    cur = [];
  };
  let inside = on(pts[0][0], pts[0][1]);
  if (!inside) cur.push(pts[0]);
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(L / RUNWAY_STEP));
    let t0 = 0;
    for (let k = 1; k <= n; k++) {
      const t1 = k / n;
      const p = lerpPt(a, b, t1);
      const now = on(p[0], p[1]);
      if (now !== inside) {
        // The edge lies between t0 (state `inside`) and t1 (state `now`): bisect to it.
        let lo = t0;
        let hi = t1;
        for (let j = 0; j < 20; j++) {
          const mid = (lo + hi) / 2;
          const q = lerpPt(a, b, mid);
          if (on(q[0], q[1]) === inside) lo = mid;
          else hi = mid;
        }
        // Going on to the strip, the last point still off it ends this piece (lo); coming
        // off, the first point clear of it starts the next (hi).
        const edge = lerpPt(a, b, inside ? hi : lo);
        if (inside) {
          cur.push(edge);
        } else {
          cur.push(edge);
          close();
        }
        inside = now;
      }
      t0 = t1;
    }
    if (!inside) cur.push(b);
  }
  close();
  return pieces;
}

/**
 * Build the lane network for a map.
 *   streets   planTown()'s streets ([{ pts, hw, drawn }])
 *   roads     sim.roads.list ([{ path: [[x, z, y]], halfWidth }])
 *   loops     [{ cx, cz, r, kind }] extra circuits (an air base's perimeter)
 *   town      { cx, cz, r } — signals go only where streets or roads cross
 *             inside the town; a country crossroads has none
 * Returns { lanes, signals, polylines }.
 */
export function buildLanes({ streets = [], roads = [], loops = [], town = null } = {}) {
  const lanes = [];
  const polylines = [];
  // A street, road or loop goes in as the pieces of it that lie off the runway strips.
  const add = (pts, hw, kind, name) => {
    if (!pts || pts.length < 2) return;
    for (const piece of carveRunways(pts)) addPiece(piece, hw, kind, name);
  };
  const addPiece = (pts, hw, kind, name) => {
    if (!pts || pts.length < 2) return;
    const off = kind === 'road' ? PAVED_HALF * 0.5 : Math.max(1.6, hw * STREET_LANE);
    const p = { pts, hw, kind, name, lanes: [] };
    const fwd = laneFrom(pts, off, false, { kind, name, poly: polylines.length, dir: 1 });
    const back = laneFrom(pts, off, true, { kind, name, poly: polylines.length, dir: -1 });
    if (!(fwd.len > 10)) return;
    fwd.reverse = lanes.length + 1;
    back.reverse = lanes.length;
    p.lanes.push(lanes.length, lanes.length + 1);
    lanes.push(fwd, back);
    polylines.push(p);
  };
  for (const st of streets) {
    if (!st || !st.drawn || !st.pts || st.pts.length < 2) continue;
    add(st.pts, st.hw || 5, 'street', 'street');
  }
  for (const r of roads) {
    if (!r || !r.path || r.path.length < 2) continue;
    add(r.path, PAVED_HALF, 'road', r.name || 'road');
  }
  for (const L of loops) {
    const pts = loopAround(L.cx, L.cz, L.r);
    if (pts) add(pts, 5, L.kind || 'loop', 'loop');
  }

  /* ---- what each lane may go on to ---- */
  for (let a = 0; a < lanes.length; a++) {
    const A = lanes[a];
    const ex = A.xs[A.n - 1];
    const ez = A.zs[A.n - 1];
    for (let b = 0; b < lanes.length; b++) {
      if (b === a || b === A.reverse) continue;
      const B = lanes[b];
      // Starts near the end: straight on.
      if (Math.hypot(B.xs[0] - ex, B.zs[0] - ez) < JOIN) {
        A.next.push({ lane: b, s: 0 });
        continue;
      }
      // Passes near the end: a T-junction, join it there.
      const q = nearestOnLane(B, ex, ez);
      if (q.d < JOIN && q.s > 5 && q.s < B.len - 5) A.next.push({ lane: b, s: q.s });
    }
    // Another lane starting beside this one mid-way is a turning.
    for (let b = 0; b < lanes.length; b++) {
      if (b === a || b === A.reverse || lanes[b].poly === A.poly) continue;
      const B = lanes[b];
      const q = nearestOnLane(A, B.xs[0], B.zs[0]);
      if (q.d < JOIN && q.s > 15 && q.s < A.len - 15) A.junctions.push({ s: q.s, lane: b });
    }
    A.junctions.sort((p, q) => p.s - q.s);
  }

  /* ---- signals where streets (or the town's roads) cross or meet ---- */
  const signals = [];
  const inTown = (x, z) => !town || Math.hypot(x - town.cx, z - town.cz) <= (town.r || 800);
  const streetPolys = polylines.map((p, i) => ({ p, i })).filter((q) => (q.p.kind === 'street' && q.p.hw >= 5) || q.p.kind === 'road');
  const near = (x, z) => signals.find((s) => Math.hypot(s.x - x, s.z - z) < 30);
  for (let i = 0; i < streetPolys.length; i++) {
    for (let j = i + 1; j < streetPolys.length; j++) {
      const P = streetPolys[i].p.pts;
      const Q = streetPolys[j].p.pts;
      // Any point of one within 8 m of a segment of the other, or a crossing.
      for (let k = 1; k < P.length; k++) {
        for (let m = 1; m < Q.length; m++) {
          const c = cross(P[k - 1], P[k], Q[m - 1], Q[m]);
          if (!c) continue;
          if (inTown(c.x, c.z) && !near(c.x, c.z)) signals.push({ x: c.x, z: c.z, y: heightAt(c.x, c.z), lanes: [] });
        }
      }
      const ends = [P[0], P[P.length - 1], Q[0], Q[Q.length - 1]];
      for (let e = 0; e < 4; e++) {
        const other = e < 2 ? Q : P;
        const pt = ends[e];
        for (let m = 1; m < other.length; m++) {
          const r = segDist2(pt[0], pt[1], other[m - 1][0], other[m - 1][1], other[m][0], other[m][1]);
          if (r.d2 < 8 * 8 && r.t > 0.05 && r.t < 0.95 && inTown(pt[0], pt[1]) && !near(pt[0], pt[1])) signals.push({ x: pt[0], z: pt[1], y: heightAt(pt[0], pt[1]), lanes: [] });
        }
      }
    }
  }
  // Stop lines: on every lane through a signal, 9 m before it, grouped by heading.
  const S = { x: 0, y: 0, z: 0, i: 0, heading: 0 };
  signals.forEach((sg, si) => {
    for (let a = 0; a < lanes.length; a++) {
      const A = lanes[a];
      const q = nearestOnLane(A, sg.x, sg.z);
      if (q.d > 14 || q.s < 12 || q.s > A.len - 4) continue;
      sampleLane(A, q.s, S);
      const h = ((S.heading % 180) + 180) % 180;
      const group = h < 45 || h >= 135 ? 0 : 1; // 0 north-south, 1 east-west
      A.stops.push({ s: q.s - 9, signal: si, group });
      sg.lanes.push(a);
    }
    sg.phase = (si * 2.9) % 12;
  });
  for (const A of lanes) A.stops.sort((p, q) => p.s - q.s);
  return { lanes, signals, polylines };
}

/** Segment intersection in the ground plane, or null. */
function cross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
  return { x: a[0] + r[0] * t, z: a[1] + r[1] * t };
}

/**
 * The signal's lights at time t (seconds): which group is green. A 14 s
 * cycle: north-south green 6 s, amber 1, east-west green 6, amber 1. Returns
 * 0 or 1 for the green group, -1 while both are red (the ambers).
 */
export function signalGreen(sg, t) {
  const c = ((t + sg.phase) % 14 + 14) % 14;
  if (c < 6) return 0;
  if (c < 7) return -1;
  if (c < 13) return 1;
  return -1;
}

/* ------------------------------------------------------------------ */
/* Boat routes                                                         */
/* ------------------------------------------------------------------ */

/** Everything a boat must stay off: the channel's centreline and the deck pads. */
export function seaKeepOuts(mapDef = MAP, pads = null) {
  const out = { channel: null, decks: [] };
  const C = mapDef && mapDef.waters && mapDef.waters.channel;
  if (C && C.path && C.path.length > 1) out.channel = C.path;
  const padList = pads || (mapDef && (mapDef.pads || (mapDef.scenery && mapDef.scenery.pads))) || [];
  for (const p of padList) if (p.kind === 'deck') out.decks.push({ x: p.x, z: p.z, r: (p.r || 11) * 2.2 + DECK_OFF });
  return out;
}

/** How far (x, z) is from the channel's centreline, or Infinity without one. */
export function channelDistance(keep, x, z) {
  const C = keep && keep.channel;
  if (!C) return Infinity;
  let best = Infinity;
  for (let i = 1; i < C.length; i++) {
    const r = segDist2(x, z, C[i - 1][0], C[i - 1][1], C[i][0], C[i][1]);
    if (r.d2 < best) best = r.d2;
  }
  return Math.sqrt(best);
}

/** Is this one point good water for a boat? */
export function seaOk(keep, x, z) {
  if (!(heightAt(x, z) <= -(BOAT_DEPTH + SEA_MARGIN))) return false;
  if (channelDistance(keep, x, z) < CHANNEL_OFF) return false;
  for (const d of keep.decks) if (Math.hypot(d.x - x, d.z - z) < d.r) return false;
  return true;
}

/** Every SEA_STEP metres along a leg is good water. */
export function legOk(keep, a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const n = Math.max(1, Math.ceil(L / SEA_STEP));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (!seaOk(keep, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
  }
  return true;
}

/** The nearest good water to (x, z), walking outwards; null within `reach`. */
export function nearestSea(keep, x, z, reach = 3000) {
  if (seaOk(keep, x, z)) return [x, z];
  for (let r = 60; r <= reach; r += 60) {
    for (let a = 0; a < 24; a++) {
      const ang = (a / 24) * Math.PI * 2;
      const px = x + Math.sin(ang) * r;
      const pz = z - Math.cos(ang) * r;
      if (seaOk(keep, px, pz)) return [px, pz];
    }
  }
  return null;
}

/** A leg from a to b, straight or bent round one offset waypoint; null if nothing passes. */
function legVia(keep, a, b) {
  if (legOk(keep, a, b)) return [b];
  const mx = (a[0] + b[0]) / 2;
  const mz = (a[1] + b[1]) / 2;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const L = Math.hypot(dx, dz) || 1;
  const px = -dz / L;
  const pz = dx / L;
  for (const k of [0.35, -0.35, 0.7, -0.7, 1.1, -1.1]) {
    const w = [mx + px * L * k, mz + pz * L * k];
    if (seaOk(keep, w[0], w[1]) && legOk(keep, a, w) && legOk(keep, w, b)) return [w, b];
  }
  return null;
}

/**
 * A route round (cx, cz) at radius r: 12 ring points moved to good water,
 * legs bent where they must be, as a loop if it closes. Grows the ring when
 * too little survives. Returns { pts, loop } or null.
 */
export function routeAround(keep, cx, cz, r, rnd = makeRandom(7)) {
  for (let grow = 0; grow < 4; grow++) {
    const R = r * (1 + grow * 0.45);
    const ring = [];
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2 + rnd() * 0.15;
      let pt = null;
      for (const k of [1, 1.25, 0.8, 1.5, 0.65]) {
        const x = cx + Math.sin(ang) * R * k;
        const z = cz - Math.cos(ang) * R * k;
        if (seaOk(keep, x, z)) {
          pt = [x, z];
          break;
        }
      }
      if (pt) ring.push(pt);
    }
    if (ring.length < 4) continue;
    // Walk the ring, keeping only legs that pass (bent if need be).
    const pts = [ring[0]];
    for (let i = 1; i < ring.length; i++) {
      const leg = legVia(keep, pts[pts.length - 1], ring[i]);
      if (leg) pts.push(...leg);
    }
    if (pts.length < 4) continue;
    const close = legVia(keep, pts[pts.length - 1], pts[0]);
    if (close) {
      pts.push(...close);
      return { pts, loop: true };
    }
    return { pts, loop: false };
  }
  return null;
}

/** A route from a to b and back, bent round the land if it must be; null if none. */
export function routeBetween(keep, a, b) {
  const A = nearestSea(keep, a[0], a[1], 1500);
  const B = nearestSea(keep, b[0], b[1], 1500);
  if (!A || !B) return null;
  let leg = legVia(keep, A, B);
  if (!leg) {
    // Two bends: via a point off to one side of the midpoint, then on.
    const mx = (A[0] + B[0]) / 2;
    const mz = (A[1] + B[1]) / 2;
    const L = Math.hypot(B[0] - A[0], B[1] - A[1]) || 1;
    const px = -(B[1] - A[1]) / L;
    const pz = (B[0] - A[0]) / L;
    for (const k of [0.5, -0.5, 0.9, -0.9, 1.4, -1.4]) {
      const w = nearestSea(keep, mx + px * L * k, mz + pz * L * k, 600);
      if (!w) continue;
      const l1 = legVia(keep, A, w);
      const l2 = l1 && legVia(keep, w, B);
      if (l1 && l2) {
        leg = [...l1, ...l2];
        break;
      }
    }
  }
  if (!leg) return null;
  return { pts: [A, ...leg], loop: false };
}

/** Flat arrays for a boat route, as laneFrom does for cars (y is sea level). */
export function routeArrays(route) {
  const pts = route.pts;
  const n = pts.length;
  const xs = new Float32Array(n);
  const zs = new Float32Array(n);
  const ys = new Float32Array(n);
  const cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = pts[i][0];
    zs[i] = pts[i][1];
    ys[i] = 0;
    cum[i] = i ? cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]) : 0;
  }
  return { xs, zs, ys, cum, len: cum[n - 1], n, loop: !!route.loop, next: [], junctions: [], stops: [] };
}

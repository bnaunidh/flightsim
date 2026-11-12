/**
 * Who comes when an aeroplane comes down in or near a town, and which way.
 *
 * PURE: no three.js, no terrain, no page. The ground is asked through the
 * callbacks in `env`, so node can lay out a town of its own and read the
 * answer (tests/features/city-emergency.mjs). ./city.js is the half that
 * draws it.
 *
 *   planResponse(env) -> { case: 'airport' }            on or beside a runway: the airfield's own
 *                        { case: 'town', … }            engines, ambulances and police by road
 *                        { case: 'water', … }           a harbour boat (and an ambulance to the quay)
 *                        { case: 'remote', … }          a rescue helicopter from the nearest town
 *                        { case: 'none' }               nothing to send (a ditching far out keeps its own)
 *
 * THE RULES
 *   - the NEAREST town answers (measured from its edge, so a city next door
 *     beats a village whose middle is nearer);
 *   - each town has a fire station (the ambulances live there too) and, when
 *     it has room, a police station somewhere else: stationsFor() picks the
 *     same street ends every time for the same town;
 *   - vehicles drive the STREETS AND ROADS (a graph of every polyline, joined
 *     where they meet), leave them at the point that makes the whole trip
 *     shortest, and cross open ground only where `clear` says a lorry could;
 *     with no way across they stop on the street nearest the aeroplane;
 *   - police first, then the fire engines, then the ambulance, each no later
 *     than ETA_MAX: a unit whose drive would take longer is already on the
 *     road when the call comes (it starts part of the way along its route);
 *   - fewer of everything on Low, and nobody on foot.
 */

/** Metres past a town's edge that its road crews still answer. */
export const TOWN_REACH = 800;
/** A harbour boat goes this far from its town's edge. */
export const BOAT_REACH = 3200;
/** Driving speeds on a call, m/s (61, 68 and 79 km/h), the boat's and the helicopter's. */
export const SPEED = Object.freeze({ fire: 17, ambulance: 19, police: 22, boat: 15, heli: 55 });
/** Seconds from the call to the wheels turning. */
export const TURNOUT = Object.freeze({ police: 3, fire: 6, ambulance: 8, boat: 5, heli: 6 });
/** The latest a first unit of each kind arrives, seconds after the call. */
export const ETA_MAX = Object.freeze({ police: 22, fire: 32, ambulance: 38, boat: 42, heli: 40 });
/** How far over open ground a vehicle will go to reach the aeroplane, metres. */
export const OFFROAD_MAX = 520;
/** Open ground is slower and bumpier: a metre of it counts as this many of road. */
export const OFFROAD_COST = 2.5;

/** What is sent, by detail level. `people` are the crews on foot. */
export const CREWS = Object.freeze({
  low: Object.freeze({ fire: 1, ambulance: 1, police: 1, people: 0, blocks: 1 }),
  medium: Object.freeze({ fire: 1, ambulance: 1, police: 2, people: 4, blocks: 1 }),
  high: Object.freeze({ fire: 2, ambulance: 1, police: 2, people: 7, blocks: 2 }),
  ultra: Object.freeze({ fire: 2, ambulance: 2, police: 3, people: 9, blocks: 2 }),
});
/** How the people on foot are shared out: [police, firefighters, paramedics]. */
export function crewShare(people) {
  if (people <= 0) return { police: 0, firefighter: 0, paramedic: 0 };
  if (people <= 4) return { police: 1, firefighter: 1, paramedic: 2 };
  if (people <= 7) return { police: 2, firefighter: 3, paramedic: 2 };
  return { police: 3, firefighter: 4, paramedic: 2 };
}
/** Footprint radius for spacing, by kind. */
export const SIZE = Object.freeze({ fire: 5.5, ambulance: 3.8, police: 3 });

const D2R = Math.PI / 180;

export function bearing(ax, az, bx, bz) {
  return ((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI + 360) % 360;
}

/** Distance from p to segment a-b. */
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz;
  let t = l2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

/** Is (x, z) on or beside one of these runways? `runways`: [{ cx, cz, length, hdg, width }]. */
export function nearRunway(runways, x, z, margin = 320) {
  for (const r of runways || []) {
    const h = (r.hdg || 0) * D2R;
    const L = (r.length || 0) / 2;
    const dx = Math.sin(h) * L;
    const dz = -Math.cos(h) * L;
    if (segDist(x, z, r.cx - dx, r.cz - dz, r.cx + dx, r.cz + dz) <= margin + (r.width || 30) / 2) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* The road graph                                                      */
/* ------------------------------------------------------------------ */

/**
 * A graph of every polyline ({ pts: [[x, z], …], kind }): a node every
 * `step` metres along each, joined to its neighbours and to any other
 * polyline's node within `join` metres (a crossing or a T). `box`
 * ({ x, z, r }) keeps only what is near, so a continent's highways cost
 * nothing.
 */
export function buildGraph(polylines, { step = 18, join = 15, box = null } = {}) {
  const xs = [];
  const zs = [];
  const poly = [];
  const kinds = [];
  const adj = [];
  const link = (a, b) => {
    const w = Math.hypot(xs[a] - xs[b], zs[a] - zs[b]);
    adj[a].push(b, w);
    adj[b].push(a, w);
  };
  const inBox = (x, z) => !box || Math.hypot(x - box.x, z - box.z) <= box.r;
  (polylines || []).forEach((p, pi) => {
    const pts = p && p.pts;
    if (!pts || pts.length < 2) return;
    let last = -1;
    const add = (x, z) => {
      if (!inBox(x, z)) {
        last = -1;
        return;
      }
      const n = xs.length;
      xs.push(x);
      zs.push(z);
      poly.push(pi);
      kinds.push(p.kind || 'road');
      adj.push([]);
      if (last >= 0) link(last, n);
      last = n;
    };
    add(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const ax = pts[i - 1][0];
      const az = pts[i - 1][1];
      const bx = pts[i][0];
      const bz = pts[i][1];
      const L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(L / step));
      for (let k = 1; k <= n; k++) add(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n);
    }
  });
  // Joins: a hash of cells `join` wide, nine looked at per node.
  const cells = new Map();
  const key = (cx, cz) => cx * 73856093 + cz * 19349663;
  for (let i = 0; i < xs.length; i++) {
    const k = key(Math.floor(xs[i] / join), Math.floor(zs[i] / join));
    const c = cells.get(k);
    if (c) c.push(i);
    else cells.set(k, [i]);
  }
  for (let i = 0; i < xs.length; i++) {
    const cx = Math.floor(xs[i] / join);
    const cz = Math.floor(zs[i] / join);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const c = cells.get(key(cx + ox, cz + oz));
        if (!c) continue;
        for (const j of c) {
          if (j <= i || poly[j] === poly[i]) continue;
          if (Math.hypot(xs[i] - xs[j], zs[i] - zs[j]) <= join) link(i, j);
        }
      }
    }
  }
  return { xs, zs, poly, kinds, adj, n: xs.length };
}

export function nearestNode(g, x, z, reach = Infinity) {
  let best = -1;
  let bd = reach;
  for (let i = 0; i < g.n; i++) {
    const d = Math.hypot(g.xs[i] - x, g.zs[i] - z);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** Dijkstra from one node: { dist, prev } over the whole graph, never through a `blocked` node. */
export function distancesFrom(g, from, blocked = null) {
  const dist = new Float64Array(g.n).fill(Infinity);
  const prev = new Int32Array(g.n).fill(-1);
  if (from < 0 || from >= g.n) return { dist, prev };
  const heap = [from];
  const hd = [0];
  dist[from] = 0;
  const push = (n, d) => {
    let i = heap.length;
    heap.push(n);
    hd.push(d);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hd[p] <= d) break;
      heap[i] = heap[p];
      hd[i] = hd[p];
      i = p;
    }
    heap[i] = n;
    hd[i] = d;
  };
  const pop = () => {
    const n = heap[0];
    const d = hd[0];
    const ln = heap.pop();
    const ld = hd.pop();
    const len = heap.length;
    if (len) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 1;
        if (c >= len) break;
        if (c + 1 < len && hd[c + 1] < hd[c]) c++;
        if (hd[c] >= ld) break;
        heap[i] = heap[c];
        hd[i] = hd[c];
        i = c;
      }
      heap[i] = ln;
      hd[i] = ld;
    }
    return [n, d];
  };
  while (heap.length) {
    const [n, d] = pop();
    if (d > dist[n]) continue;
    const a = g.adj[n];
    for (let k = 0; k < a.length; k += 2) {
      if (blocked && blocked[a[k]]) continue;
      const nd = d + a[k + 1];
      if (nd < dist[a[k]]) {
        dist[a[k]] = nd;
        prev[a[k]] = n;
        push(a[k], nd);
      }
    }
  }
  return { dist, prev };
}

/** The nodes from the Dijkstra's start to `to`, as [[x, z], …]. */
export function pathTo(g, D, to) {
  const out = [];
  for (let n = to; n >= 0; n = D.prev[n]) out.push([g.xs[n], g.zs[n]]);
  return out.reverse();
}

export function pathLength(pts) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** How far the path stays from the polylines it was routed on: the worst metre (the tests). */
export function offNetwork(pts, polylines, from = 0, to = pts.length) {
  let worst = 0;
  for (let i = from; i < to; i++) {
    let best = Infinity;
    for (const p of polylines) {
      for (let k = 1; k < p.pts.length && best > 0.5; k++) {
        const d = segDist(pts[i][0], pts[i][1], p.pts[k - 1][0], p.pts[k - 1][1], p.pts[k][0], p.pts[k][1]);
        if (d < best) best = d;
      }
    }
    if (best > worst) worst = best;
  }
  return worst;
}

/* ------------------------------------------------------------------ */
/* Towns and their stations                                            */
/* ------------------------------------------------------------------ */

/** The town that answers: the one whose edge is nearest. `towns`: [{ name, x, z, r }]. */
export function nearestTown(towns, x, z) {
  let best = null;
  let bd = Infinity;
  for (const t of towns || []) {
    if (!t || !Number.isFinite(t.x) || !Number.isFinite(t.z)) continue;
    const d = Math.max(0, Math.hypot(t.x - x, t.z - z) - (t.r || 400));
    const tie = Math.hypot(t.x - x, t.z - z);
    if (d < bd - 1e-6 || (Math.abs(d - bd) <= 1e-6 && best && tie < Math.hypot(best.x - x, best.z - z))) {
      bd = d;
      best = t;
    }
  }
  return best ? { town: best, edge: bd } : null;
}

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * A town's stations: { fire, police }, each { x, z, heading, door: [x, z], node, kind, built }.
 * A station stands beside the end of one of the town's streets — always the
 * same end for the same town — on ground `ok(x, z, r)` passes; `built` false
 * means there was no room for the building and the vehicles simply come from
 * that street end. A small town's police share the fire station.
 */
export function stationsFor(town, g, polylines, ok = () => true) {
  const R = (town.r || 400) * 1.15;
  const ends = [];
  (polylines || []).forEach((p, pi) => {
    if (!p.pts || p.pts.length < 2) return;
    for (const [e, n] of [[0, 1], [p.pts.length - 1, p.pts.length - 2]]) {
      const x = p.pts[e][0];
      const z = p.pts[e][1];
      const d = Math.hypot(x - town.x, z - town.z);
      if (d > R) continue;
      const dx = x - p.pts[n][0];
      const dz = z - p.pts[n][1];
      const L = Math.hypot(dx, dz) || 1;
      ends.push({ x, z, ux: dx / L, uz: dz / L, d, key: hash(`${town.name || ''}:${pi}:${e}`) });
    }
  });
  if (!ends.length) {
    // No street ends inside the town (a village on a through road): the node nearest its middle.
    const n = nearestNode(g, town.x, town.z, R * 1.5);
    if (n < 0) return null;
    ends.push({ x: g.xs[n], z: g.zs[n], ux: 1, uz: 0, d: 0, key: 1 });
  }
  ends.sort((a, b) => a.key - b.key);
  const site = (e, w, kind) => {
    // Beside the street, set back from it: left or right, at the end or a little past it.
    for (const along of [-10, 4, -26, 16]) {
      for (const side of [1, -1]) {
        const x = e.x + e.ux * along + -e.uz * side * (w / 2 + 9);
        const z = e.z + e.uz * along + e.ux * side * (w / 2 + 9);
        if (!ok(x, z, w / 2 + 2)) continue;
        // The doors face the street.
        return { x, z, heading: bearing(x, z, e.x + e.ux * along, e.z + e.uz * along), door: [e.x + e.ux * along, e.z + e.uz * along], kind, built: true };
      }
    }
    return null;
  };
  const place = (kind, w, far) => {
    let fallback = null;
    for (const e of ends) {
      if (far && Math.hypot(e.x - far.x, e.z - far.z) < 120) continue;
      const s = site(e, w, kind);
      if (s) return s;
      if (!fallback) fallback = { x: e.x, z: e.z, heading: 0, door: [e.x, e.z], kind, built: false };
    }
    return fallback;
  };
  const fire = place('fire', 16, null);
  if (!fire) return null;
  let police = (town.r || 400) >= 250 ? place('police', 12, fire) : null;
  if (!police) police = { ...fire, kind: 'fire', shared: true };
  for (const s of [fire, police]) s.node = nearestNode(g, s.door[0], s.door[1]);
  return { fire, police };
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

/** Park `count` vehicles of `kind` round the aeroplane on ground that passes, spaced from each other. */
function parkRing(inc, base, kind, count, rings, spread, occupied, ok) {
  const r = SIZE[kind] || 3;
  const out = [];
  for (let i = 0; i < count; i++) {
    let got = null;
    for (let k = 0; k < 40 && !got; k++) {
      const side = k % 2 ? 1 : -1;
      const a = base + spread.start * (i % 2 ? -1 : 1) + side * Math.floor((k + 1) / 2) * spread.step + i * spread.each;
      for (const ring of rings) {
        const x = inc.x + Math.sin(a * D2R) * ring;
        const z = inc.z - Math.cos(a * D2R) * ring;
        if (!ok(x, z, r)) continue;
        if (occupied.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + r + 2)) continue;
        got = { x, z };
        break;
      }
    }
    if (!got) break;
    occupied.push({ x: got.x, z: got.z, r });
    out.push(got);
  }
  return out;
}

/**
 * Over open ground from (nx, nz) to `target` without driving through the
 * aeroplane: straight if that misses the circle `keep` round it, else to the
 * target's own ring and round it. The points after the start, or null.
 */
function crossGround(nx, nz, target, inc, keep, clear) {
  if (segDist(inc.x, inc.z, nx, nz, target.x, target.z) >= keep) return clear(nx, nz, target.x, target.z) ? [[target.x, target.z]] : null;
  const R = Math.hypot(target.x - inc.x, target.z - inc.z);
  if (Math.hypot(nx - inc.x, nz - inc.z) < R) return null;
  const b0 = bearing(inc.x, inc.z, nx, nz);
  const d = ((bearing(inc.x, inc.z, target.x, target.z) - b0 + 540) % 360) - 180;
  const steps = Math.max(1, Math.ceil(Math.abs(d) / 30));
  const out = [];
  let px = nx;
  let pz = nz;
  for (let i = 0; i <= steps; i++) {
    const a = (b0 + (d * i) / steps) * D2R;
    const x = i === steps ? target.x : inc.x + Math.sin(a) * R;
    const z = i === steps ? target.z : inc.z - Math.cos(a) * R;
    if (!clear(px, pz, x, z)) return null;
    out.push([x, z]);
    px = x;
    pz = z;
  }
  return out;
}

/** The route for one unit: by road from its station, then over open ground to `target` if a way is clear. */
function routeUnit(g, D, station, target, inc, clear, queue, keep) {
  // Leave the road where the whole trip is shortest, open ground counted dear.
  const cands = [];
  if (clear) {
    for (let n = 0; n < g.n; n++) {
      if (D.dist[n] === Infinity) continue;
      const d = Math.hypot(g.xs[n] - target.x, g.zs[n] - target.z);
      if (d <= OFFROAD_MAX) cands.push([D.dist[n] + d * OFFROAD_COST, n, d]);
    }
    cands.sort((a, b) => a[0] - b[0]);
  }
  for (let i = 0; i < cands.length && i < 36; i++) {
    const n = cands[i][1];
    const over = cands[i][2] > 1 ? crossGround(g.xs[n], g.zs[n], target, inc, keep, clear) : [];
    if (!over) continue;
    const road = pathTo(g, D, n);
    const pts = [[station.door[0], station.door[1]], ...road];
    const roadEnd = pts.length;
    pts.push(...over);
    return { pts, roadEnd, park: { x: target.x, z: target.z }, onStreet: false };
  }
  // No way across: the street nearest the aeroplane (and clear of it), queued one behind the other.
  let best = -1;
  let bd = 900;
  for (let n = 0; n < g.n; n++) {
    if (D.dist[n] === Infinity) continue;
    const d = Math.hypot(g.xs[n] - inc.x, g.zs[n] - inc.z);
    if (d < bd && d >= keep + 6) {
      bd = d;
      best = n;
    }
  }
  if (best < 0) return null;
  // One node (a lorry's length and a gap) further back for each unit already queued.
  let n = best;
  for (let k = 0; k < queue && D.prev[n] >= 0; k++) n = D.prev[n];
  const road = pathTo(g, D, n);
  const pts = [[station.door[0], station.door[1]], ...road];
  return { pts, roadEnd: pts.length, park: { x: g.xs[n], z: g.zs[n] }, onStreet: true };
}

/** Where roads cross a ring round the aeroplane: [{ x, z, heading }] (the road's heading there). */
export function roadblocks(g, inc, ring, max, avoid = []) {
  const out = [];
  for (let n = 0; n < g.n && out.length < max; n++) {
    const dn = Math.hypot(g.xs[n] - inc.x, g.zs[n] - inc.z);
    if (dn > ring) continue;
    const a = g.adj[n];
    for (let k = 0; k < a.length && out.length < max; k += 2) {
      const m = a[k];
      if (g.poly[m] !== g.poly[n]) continue;
      const dm = Math.hypot(g.xs[m] - inc.x, g.zs[m] - inc.z);
      if (dm <= ring) continue;
      const x = g.xs[m];
      const z = g.zs[m];
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < 40)) continue;
      // Not across the way the engines come in.
      let onRoute = false;
      for (const pts of avoid) {
        for (let i = 1; i < pts.length && !onRoute; i++) if (segDist(x, z, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) < 20) onRoute = true;
      }
      if (onRoute) continue;
      out.push({ x, z, heading: bearing(g.xs[n], g.zs[n], x, z), node: m });
    }
  }
  return out;
}

function timeUnit(u, kind, idx) {
  const len = pathLength(u.pts);
  const v = SPEED[kind];
  const latest = ETA_MAX[kind] + idx * 3;
  const turnout = TURNOUT[kind] + idx * 2.5;
  // No later than `latest`: a unit that could not make it from the station in time was already
  // on the road when the call came, and joins its route part of the way along.
  const eta = Math.min(turnout + len / v, latest);
  const depart = Math.max(0, Math.min(turnout, eta - len / v));
  const startS = Math.max(0, len - v * (eta - depart));
  return { len, depart, eta, startS, speed: v };
}

/**
 * @param {object} env
 *   incident   { x, z, water, kind: 'crash' | 'forced' | 'ditch', fire }
 *   towns      [{ name, x, z, r }]
 *   polylines  [{ pts, kind }] or (town, incident) => the same
 *   runways    [{ cx, cz, length, hdg, width }]  (or onAirfield(x, z))
 *   tier       'low' | 'medium' | 'high' | 'ultra'
 *   span       the aeroplane's wing span, metres
 *   ok(x, z, r)            dry, level, clear of buildings: a vehicle can stand here
 *   clear(ax, az, bx, bz)  a vehicle can drive straight from a to b over open ground
 *   harbour(town, inc)     [x, z] in the water by the town (on the aeroplane's side of it), or null
 *   seaRoute(a, b)         [[x, z], …] by water from a to b, or null
 *   ditchOwn               the ditching's own rescue is coming (features/ditching.js)
 */
export function planResponse(env) {
  const inc = env.incident;
  const ok = env.ok || (() => true);
  const clear = env.clear || (() => true);
  const tier = CREWS[env.tier] ? env.tier : 'high';
  const want = { ...CREWS[tier] };
  if (env.onAirfield ? env.onAirfield(inc.x, inc.z) : nearRunway(env.runways, inc.x, inc.z)) return { case: 'airport' };
  const near = nearestTown(env.towns, inc.x, inc.z);
  const town = near && near.town;
  const heli = () => {
    // From the town if there is one within reach of a helicopter; else from over the horizon.
    const from = town ? { x: town.x, z: town.z } : { x: inc.x + 2400, z: inc.z + 900 };
    const d = Math.hypot(from.x - inc.x, from.z - inc.z);
    const latest = ETA_MAX.heli;
    const eta = Math.min(latest, TURNOUT.heli + d / SPEED.heli);
    // Flying already, if it would be late.
    const run = (eta - TURNOUT.heli) * SPEED.heli;
    const k = d > 1 ? Math.min(1, run / d) : 1;
    return {
      case: 'remote', town: town || null, units: [], blocks: [], people: 0,
      heli: { from: { x: inc.x + (from.x - inc.x) * k, z: inc.z + (from.z - inc.z) * k }, to: { x: inc.x, z: inc.z }, depart: TURNOUT.heli, eta },
    };
  };

  /* ---- the water ---- */
  if (inc.water) {
    if (!town || near.edge > BOAT_REACH) return inc.kind === 'ditch' || env.ditchOwn ? { case: 'none' } : heli();
    const h = env.harbour ? env.harbour(town, inc) : null;
    let sea = h && env.seaRoute ? env.seaRoute(h, [inc.x, inc.z]) : null;
    if (!h || !sea || sea.length < 2) return inc.kind === 'ditch' || env.ditchOwn ? { case: 'none' } : heli();
    // Alongside, not on top: stop short of the aeroplane.
    // (A ditching's own rescue boat lies off the wing tip: this one stands further off than that.)
    const stand = Math.max(26, (env.span || 12) * 0.5 + 16) + (inc.kind === 'ditch' ? 14 : 0);
    const a = sea[sea.length - 2];
    const b = sea[sea.length - 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    sea = sea.slice();
    sea[sea.length - 1] = [b[0] - ((b[0] - a[0]) / L) * Math.min(stand, L * 0.8), b[1] - ((b[1] - a[1]) / L) * Math.min(stand, L * 0.8)];
    const t = timeUnit({ pts: sea }, 'boat', 0);
    const plan = { case: 'water', town, units: [], blocks: [], people: 0, boat: { pts: sea, from: h, ...t } };
    // And an ambulance to the quay, to meet the boat.
    const polys = typeof env.polylines === 'function' ? env.polylines(town, inc) : env.polylines;
    const g = buildGraph(polys, { box: { x: town.x, z: town.z, r: (town.r || 400) + BOAT_REACH } });
    const st = g.n ? stationsFor(town, g, polys, ok) : null;
    if (st && tier !== 'low') {
      const D = distancesFrom(g, st.fire.node);
      let q = -1;
      let qd = 1200;
      for (let n = 0; n < g.n; n++) {
        if (D.dist[n] === Infinity) continue;
        const d = Math.hypot(g.xs[n] - h[0], g.zs[n] - h[1]);
        if (d < qd) {
          qd = d;
          q = n;
        }
      }
      if (q >= 0) {
        const pts = [[st.fire.door[0], st.fire.door[1]], ...pathTo(g, D, q)];
        const u = { kind: 'ambulance', idx: 0, from: st.fire, pts, roadEnd: pts.length, park: { x: g.xs[q], z: g.zs[q] }, onStreet: true, quay: true };
        Object.assign(u, timeUnit(u, 'ambulance', 0));
        u.heading = pts.length > 1 ? bearing(pts[pts.length - 2][0], pts[pts.length - 2][1], pts[pts.length - 1][0], pts[pts.length - 1][1]) : 0;
        plan.units.push(u);
        plan.stations = st;
      }
    }
    return plan;
  }

  /* ---- the land ---- */
  if (!town || near.edge > TOWN_REACH) return heli();
  const polys = typeof env.polylines === 'function' ? env.polylines(town, inc) : env.polylines;
  const g = buildGraph(polys, { box: { x: town.x, z: town.z, r: (town.r || 400) + TOWN_REACH + 600 } });
  if (!g.n) return heli();
  const st = stationsFor(town, g, polys, ok);
  if (!st) return heli();
  if (inc.kind === 'forced') {
    // Nothing is burning: one engine stands by.
    want.fire = 1;
    want.ambulance = 1;
  }
  const clearR = Math.max(14, (env.span || 12) * 0.6 + 8);
  const nn = nearestNode(g, inc.x, inc.z);
  const base = bearing(inc.x, inc.z, g.xs[nn], g.zs[nn]);
  const occupied = [];
  const spots = {
    fire: parkRing(inc, base, 'fire', want.fire, [clearR + 9, clearR + 16, clearR + 26], { start: 18, step: 13, each: 0 }, occupied, ok),
    ambulance: parkRing(inc, base, 'ambulance', want.ambulance, [clearR + 20, clearR + 28, clearR + 38], { start: 48, step: 13, each: 14 }, occupied, ok),
    police: [],
  };
  // Nobody drives through the aeroplane: the street under it is shut to the route.
  const keep = clearR + 4;
  const shut = new Uint8Array(g.n);
  for (let n = 0; n < g.n; n++) if (Math.hypot(g.xs[n] - inc.x, g.zs[n] - inc.z) < keep) shut[n] = 1;
  const Dfire = distancesFrom(g, st.fire.node, shut);
  const Dpol = st.police.node === st.fire.node ? Dfire : distancesFrom(g, st.police.node, shut);
  const units = [];
  let queue = 0;
  for (const kind of ['fire', 'ambulance']) {
    for (let i = 0; i < want[kind]; i++) {
      // A unit with nowhere to stand by the aeroplane stops on the street.
      const target = spots[kind][i] || { x: inc.x, z: inc.z, none: true };
      const r = routeUnit(g, Dfire, st.fire, target, inc, target.none ? null : clear, queue, keep);
      if (!r) continue;
      if (r.onStreet) queue++;
      const u = { kind, idx: i, from: st.fire, ...r };
      Object.assign(u, timeUnit(u, kind, i));
      // Engines nose in; the ambulance backs up to it.
      const face = bearing(u.park.x, u.park.z, inc.x, inc.z);
      u.heading = r.onStreet && r.pts.length > 1 ? bearing(r.pts[r.pts.length - 2][0], r.pts[r.pts.length - 2][1], u.park.x, u.park.z) : kind === 'ambulance' ? (face + 180) % 360 : face;
      units.push(u);
    }
  }
  if (!units.some((u) => u.kind === 'fire')) return heli();
  // The police close the roads round it, off the engines' way in; the rest stand on the flanks.
  const blocks = roadblocks(g, inc, clearR + 55, want.blocks, units.filter((u) => u.kind === 'fire').map((u) => u.pts));
  const flank = parkRing(inc, base, 'police', Math.max(0, want.police - blocks.length), [clearR + 30, clearR + 40, clearR + 52], { start: 75, step: 13, each: 20 }, occupied, ok);
  let pi = 0;
  for (const b of blocks.slice(0, want.police)) {
    if (Dpol.dist[b.node] === Infinity) continue;
    const pts = [[st.police.door[0], st.police.door[1]], ...pathTo(g, Dpol, b.node)];
    const u = { kind: 'police', idx: pi, from: st.police, pts, roadEnd: pts.length, park: { x: b.x, z: b.z }, onStreet: true, block: b };
    Object.assign(u, timeUnit(u, 'police', pi++));
    // Across the road.
    u.heading = (b.heading + 70) % 360;
    units.push(u);
  }
  for (const f of flank) {
    const r = routeUnit(g, Dpol, st.police, f, inc, clear, queue, keep);
    if (!r) continue;
    if (r.onStreet) queue++;
    const u = { kind: 'police', idx: pi, from: st.police, ...r };
    Object.assign(u, timeUnit(u, 'police', pi++));
    u.heading = r.onStreet && r.pts.length > 1 ? bearing(r.pts[r.pts.length - 2][0], r.pts[r.pts.length - 2][1], u.park.x, u.park.z) : bearing(u.park.x, u.park.z, inc.x, inc.z);
    units.push(u);
  }
  return {
    case: 'town', town, stations: st, units, blocks: units.filter((u) => u.block).map((u) => u.block), people: want.people,
    clearR, keep, base, nodes: g.n,
    first: Math.min(...units.map((u) => u.eta)), last: Math.max(...units.map((u) => u.eta)),
  };
}

/** Where a unit is `s` metres along its path: { x, z, heading } into `out`; `hint` is the last segment. */
export function alongPath(pts, cum, s, out, hint = 0) {
  const n = pts.length;
  let i = Math.max(1, Math.min(n - 1, hint + 1));
  while (i > 1 && cum[i - 1] > s) i--;
  while (i < n - 1 && cum[i] < s) i++;
  const s0 = cum[i - 1];
  const s1 = cum[i];
  const t = s1 > s0 ? Math.max(0, Math.min(1, (s - s0) / (s1 - s0))) : 0;
  out.x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t;
  out.z = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
  out.heading = bearing(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
  out.i = i - 1;
  return out;
}

export function cumulative(pts) {
  const cum = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return cum;
}

/**
 * How far along its drive a unit is, 0..1, at the share `k` of its time: a
 * steady speed (about a seventh over its average) for three quarters of the
 * time, then braking smoothly to a stop exactly on its ETA.
 */
export function progress(k) {
  if (k <= 0) return 0;
  if (k >= 1) return 1;
  const a = 0.75;
  const c = 1 / (1 - a * a);
  return k < a ? k * 2 * c * (1 - a) : 1 - c * (1 - k) * (1 - k);
}

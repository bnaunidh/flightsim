/**
 * The World Map preview's towns and roads beyond the field-to-town lanes:
 * villages on the big islands, and a road network joining every town and
 * field on an island — a dual-carriageway highway on the mainland and the
 * bigger islands, country roads to the villages, a bridge wherever a road
 * crosses a river and a roundabout where the highway reaches a town.
 *
 * Owner, Oct 26: "such a nice town not even a highway"; "roads are odd (a
 * square loop going nowhere / grass track)".
 *
 * Run by tools/worldmap/preview-layout.mjs; everything is measured off the
 * real height field (terrain.js, applied with the preview's definition) and
 * written into preview-data.js as numbers. Deterministic.
 *
 * ROUTING is A* on a 150 m grid over the island: the cost is distance, made
 * dearer by steepness (a road wants to stay under 7%), and a river crossing
 * costs a bridge; the sea, lakes, every runway with its approach lanes and
 * every airfield site are walls. The path is smoothed (Chaikin), resampled
 * every 60 m, and given a profile that follows the ground but never climbs
 * more than 7% from one point to the next (eased both ways, as roads.js
 * does).
 *
 * A HIGHWAY is two carriageways, each its own road (roads.js draws each,
 * the ambient cars drive each, one way each), 9 m either side of the line,
 * with a grass median between. A BRIDGE is a span over the river, its deck
 * level between its ends and at least 8 m over the water; terrain.js keeps
 * the river's channel under it (the road does not fill it) and answers the
 * deck's height to the wheels (MAP.bridges). A ROUNDABOUT is a ring road
 * where the highway meets a town's edge.
 */

const CELL = 150;
const MAX_GRADE = 0.07;
const STEP = 60;

/* Village names: plainly made up, two parts, English-sounding. */
const VILLAGE_NAMES = [
  'Aldercote', 'Wrenmoor', 'Fellsend', 'Larkhollow', 'Thistlebrook', 'Greywater', 'Brackenford', 'Ashcombe',
  'Highmere', 'Millhaven', 'Copperleigh', 'Orchardene', 'Kestrelby', 'Rookhurst', 'Elmswade', 'Foxglove Cross',
];

/** Where the extra towns go: on the big islands, in open country. */
const VILLAGE_PLAN = [
  { island: 'Westreach', n: 6, r: [420, 560], count: [90, 150], gap: 5200 },
  { island: 'Haven Island', n: 1, r: [300, 360], count: [50, 70], gap: 2600 },
  { island: 'Farhold Island', n: 1, r: [300, 360], count: [50, 70], gap: 2600 },
  { island: 'Sandmere', n: 1, r: [280, 340], count: [40, 60], gap: 2600 },
  { island: 'Eider Island', n: 1, r: [240, 300], count: [30, 44], gap: 2200 },
];
/** Islands whose main roads are dual carriageways. */
const HIGHWAY_ISLANDS = new Set(['Westreach', 'Haven Island', 'Farhold Island', 'Sandmere']);

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const l2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
  return { d: Math.hypot(px - ax - dx * t, pz - az - dz * t), t };
}

/** Segment-segment intersection: the parameters along each, or null. */
function cross(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const qp = [c[0] - a[0], c[1] - a[1]];
  const t = (qp[0] * s[1] - qp[1] * s[0]) / den;
  const u = (qp[0] * r[1] - qp[1] * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/**
 * The landmass a point is on, named by its biggest island: the mainland is
 * several islands of the plan (Westreach, Aldermere Plain, Highfold Vale,
 * the ranges) whose circles overlap, and a road may run across all of them.
 */
const LANDMASS = new WeakMap();
function landmassOf(islands, isl) {
  let cache = LANDMASS.get(islands);
  if (!cache) {
    const parent = islands.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < islands.length; i++) {
      for (let j = i + 1; j < islands.length; j++) {
        const a = islands[i];
        const b = islands[j];
        if (Math.hypot(a.cx - b.cx, a.cz - b.cz) < (a.radius + b.radius) * 0.95) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    islands.forEach((s, i) => {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(s);
    });
    cache = new Map();
    for (const g of groups.values()) {
      const big = g.reduce((m, s) => (s.radius > m.radius ? s : m), g[0]);
      for (const s of g) cache.set(s, { name: big.name, isl: big, members: g });
    }
    LANDMASS.set(islands, cache);
  }
  return cache.get(isl);
}

/** The landmass a point belongs to (through the island whose radius-scaled centre is nearest). */
function islandOf(islands, x, z) {
  let best = null;
  let bd = Infinity;
  for (const i of islands) {
    const d = Math.hypot(x - i.cx, z - i.cz) / i.radius;
    if (d < bd) { bd = d; best = i; }
  }
  return best ? landmassOf(islands, best) : null;
}

/* ------------------------------------------------------------------ */
/* Villages                                                            */
/* ------------------------------------------------------------------ */

export function placeVillages({ T, plan, towns, rivers, lakes, airports = [] }) {
  // A runway and its lanes are a wall no road crosses: a village beside one is on its town's side of it.
  const sameSide = (x, z) => airports.every((a) => {
    if (Math.abs(x - a.x) > a.length / 2 + 9000) return true;
    const t = towns.find((q) => q.airport === a.id);
    return !t || Math.sign(z - a.z) === Math.sign(t.cz - a.z);
  });
  const H = (x, z) => T.groundHeightAt(x, z);
  const out = [];
  let nameNo = 0;
  for (const vp of VILLAGE_PLAN) {
    const isl = plan.islands.find((i) => i.name === vp.island);
    if (!isl) continue;
    const R = rng(isl.seed * 131 + 7);
    let made = 0;
    for (let k = 0; k < 3000 && made < vp.n; k++) {
      const a = R() * Math.PI * 2;
      const d = Math.sqrt(R()) * isl.radius * 0.78;
      const x = Math.round(isl.cx + Math.cos(a) * d);
      const z = Math.round(isl.cz + Math.sin(a) * d);
      const r = Math.round(vp.r[0] + R() * (vp.r[1] - vp.r[0]));
      const count = Math.round(vp.count[0] + R() * (vp.count[1] - vp.count[0]));
      if (T.calmAt(x, z) > 0.01 || !sameSide(x, z)) continue;
      // Open, dryish, not too high and not too steep, across the whole village.
      const hs = [];
      let ok = true;
      for (let i = 0; i < 12 && ok; i++) {
        const b = (i / 12) * Math.PI * 2;
        for (const rr of [0, r * 0.6, r * 1.2]) {
          const h = H(x + Math.cos(b) * rr, z + Math.sin(b) * rr);
          if (h < 6 || h > 260) ok = false;
          if (T.calmAt(x + Math.cos(b) * rr * 1.6, z + Math.sin(b) * rr * 1.6) > 0.01) ok = false;
          hs.push(h);
        }
      }
      if (!ok) continue;
      hs.sort((p, q) => p - q);
      if (hs[hs.length - 1] - hs[0] > Math.max(18, r * 0.06)) continue;
      if ([...towns, ...out].some((t) => Math.hypot(t.cx - x, t.cz - z) < vp.gap + (t.radius || 0))) continue;
      if (rivers.some((rv) => rv.path.some((p) => Math.hypot(p[0] - x, p[1] - z) < r + 500))) continue;
      if (lakes.some((l) => Math.hypot(l.x - x, l.z - z) < l.r + r * 1.4 + 1400)) continue;
      const name = VILLAGE_NAMES[nameNo++ % VILLAGE_NAMES.length];
      out.push({ airport: null, name, island: vp.island, cx: x, cz: z, radius: r, count, elev: Math.round(hs[Math.floor(hs.length / 2)]), village: true });
      made++;
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Routing                                                             */
/* ------------------------------------------------------------------ */

/** A binary heap of [cost, index]. */
class Heap {
  constructor() { this.a = []; }
  push(c, i) {
    const a = this.a;
    a.push([c, i]);
    let k = a.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (a[p][0] <= a[k][0]) break;
      [a[p], a[k]] = [a[k], a[p]];
      k = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let k = 0;
      for (;;) {
        const l = k * 2 + 1;
        const r = l + 1;
        let m = k;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === k) break;
        [a[m], a[k]] = [a[k], a[m]];
        k = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

/**
 * A grid over an island for A*: each cell's ground, whether it is open, and
 * what it costs to enter. `walls(x, z)` says a point is off limits.
 */
function makeGrid(T, isl, walls, rivers, members = [isl]) {
  let bx0 = Infinity;
  let bx1 = -Infinity;
  let bz0 = Infinity;
  let bz1 = -Infinity;
  for (const m of members) {
    bx0 = Math.min(bx0, m.cx - m.radius * 1.4); bx1 = Math.max(bx1, m.cx + m.radius * 1.4);
    bz0 = Math.min(bz0, m.cz - m.radius * 1.4); bz1 = Math.max(bz1, m.cz + m.radius * 1.4);
  }
  const reach = Math.max(bx1 - bx0, bz1 - bz0) / 2;
  const x0 = (bx0 + bx1) / 2 - reach;
  const z0 = (bz0 + bz1) / 2 - reach;
  const n = Math.ceil((reach * 2) / CELL) + 1;
  const h = new Float32Array(n * n);
  const open = new Uint8Array(n * n);
  const river = new Uint8Array(n * n);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * CELL;
      const z = z0 + j * CELL;
      const g = T.groundHeightAt(x, z);
      h[j * n + i] = g;
      open[j * n + i] = g > 2 && !walls(x, z) ? 1 : 0;
    }
  }
  // Mark the river cells (a crossing there is a bridge, and dearer).
  for (const r of rivers) {
    for (let k = 1; k < r.path.length; k++) {
      const a = r.path[k - 1];
      const b = r.path[k];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      for (let s = 0; s <= L; s += CELL / 2) {
        const x = a[0] + ((b[0] - a[0]) * s) / L;
        const z = a[1] + ((b[1] - a[1]) * s) / L;
        const i = Math.round((x - x0) / CELL);
        const j = Math.round((z - z0) / CELL);
        if (i >= 0 && j >= 0 && i < n && j < n) {
          river[j * n + i] = 1;
          // A river cell is open ground for a road (a bridge), whatever its height.
          open[j * n + i] = 1;
        }
      }
    }
  }
  return { x0, z0, n, h, open, river };
}

function astar(grid, from, to) {
  const { x0, z0, n, h, open, river } = grid;
  const idx = (x, z) => {
    const i = Math.round((x - x0) / CELL);
    const j = Math.round((z - z0) / CELL);
    if (i < 0 || j < 0 || i >= n || j >= n) return -1;
    return j * n + i;
  };
  const s = idx(from.x, from.z);
  const g = idx(to.x, to.z);
  if (s < 0 || g < 0) return null;
  // The ends may sit in a wall (a town on its flat, an airfield's apron): open them and their neighbours.
  for (const c of [s, g]) {
    const ci = c % n;
    const cj = (c / n) | 0;
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const k = (cj + dj) * n + ci + di;
      if (k >= 0 && k < n * n && h[k] > 1) open[k] = 1;
    }
  }
  const cost = new Float32Array(n * n).fill(Infinity);
  const prev = new Int32Array(n * n).fill(-1);
  const heap = new Heap();
  cost[s] = 0;
  const gi = g % n;
  const gj = (g / n) | 0;
  const hst = (k) => Math.hypot((k % n) - gi, ((k / n) | 0) - gj) * CELL;
  heap.push(hst(s), s);
  const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.size) {
    const [, k] = heap.pop();
    if (k === g) break;
    const ki = k % n;
    const kj = (k / n) | 0;
    for (const [di, dj] of N8) {
      const ni = ki + di;
      const nj = kj + dj;
      if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
      const m = nj * n + ni;
      if (!open[m]) continue;
      const run = di && dj ? CELL * 1.4142 : CELL;
      const grade = river[m] || river[k] ? 0 : Math.abs(h[m] - h[k]) / run;
      // Steepness costs dearly past the road's grade; a river costs a bridge.
      let c = run * (1 + 40 * grade * grade + (grade > MAX_GRADE * 1.6 ? 6 : 0));
      if (river[m] && !river[k]) c += 160;
      const nc = cost[k] + c;
      if (nc < cost[m]) {
        cost[m] = nc;
        prev[m] = k;
        heap.push(nc + hst(m), m);
      }
    }
  }
  if (prev[g] < 0 && g !== s) return null;
  const out = [];
  for (let k = g; k >= 0; k = prev[k]) {
    out.push([x0 + (k % n) * CELL, z0 + ((k / n) | 0) * CELL]);
    if (k === s) break;
  }
  out.reverse();
  out[0] = [from.x, from.z];
  out[out.length - 1] = [to.x, to.z];
  return out;
}

/** Chaikin smoothing, then resampled every STEP metres. */
function smooth(pts, passes = 3) {
  let p = pts;
  for (let k = 0; k < passes; k++) {
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i];
      const b = p[i + 1];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  const out = [p[0]];
  let carry = 0;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = STEP - carry;
    while (s <= L) {
      out.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]);
      s += STEP;
    }
    carry = L - (s - STEP);
  }
  const last = p[p.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > STEP * 0.3) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/**
 * The road's profile: the ground, smoothed, eased under MAX_GRADE; `locked`
 * points keep their height. `runs[i]`, if given, is the length the grade is
 * held over from point i-1 to i (a dual carriageway's shorter, inner side).
 */
export function profile(T, pts, locked = null, lockedY = null, runs = null) {
  let ys = pts.map(([x, z]) => Math.max(1.5, T.groundHeightAt(x, z)));
  for (let k = 0; k < 4; k++) ys = ys.map((y, i) => (i === 0 || i === ys.length - 1 || (locked && locked[i]) ? y : (ys[i - 1] + y * 2 + ys[i + 1]) / 4));
  if (locked) for (let i = 0; i < ys.length; i++) if (locked[i]) ys[i] = lockedY[i];
  const free = (i) => !(locked && locked[i]);
  for (let pass = 0; pass < 80; pass++) {
    let moved = 0;
    for (let i = 1; i < ys.length; i++) {
      const run = runs ? runs[i] : Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      const max = run * MAX_GRADE;
      const d = ys[i] - ys[i - 1];
      if (Math.abs(d) <= max) continue;
      if (free(i)) ys[i] = ys[i - 1] + Math.sign(d) * max;
      else if (free(i - 1)) ys[i - 1] = ys[i] - Math.sign(d) * max;
      moved++;
    }
    for (let i = ys.length - 2; i >= 0; i--) {
      const run = runs ? runs[i + 1] : Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
      const max = run * MAX_GRADE;
      const d = ys[i] - ys[i + 1];
      if (Math.abs(d) <= max) continue;
      if (free(i)) ys[i] = ys[i + 1] + Math.sign(d) * max;
      else if (free(i + 1)) ys[i + 1] = ys[i] - Math.sign(d) * max;
      moved++;
    }
    if (!moved) break;
  }
  return ys;
}

/** A polyline offset `off` metres to its right (looking along it). */
function offsetLine(pts, off) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l = Math.hypot(dx, dz) || 1;
    return [p[0] - (dz / l) * off, p[1] + (dx / l) * off];
  });
}

/* ------------------------------------------------------------------ */
/* The network                                                         */
/* ------------------------------------------------------------------ */

/**
 * The routes: which places on each island are joined, by what. A minimum
 * spanning tree over an island's towns (and, where a field's own road does
 * not already reach its town, the field), its edges between the bigger
 * places highways on the highway islands, the rest country roads.
 */
export function planRoutes({ plan, towns, airports }) {
  const byIsland = new Map();
  for (const t of towns) {
    const lm = islandOf(plan.islands, t.cx, t.cz);
    if (!lm) continue;
    if (!byIsland.has(lm.name)) byIsland.set(lm.name, { isl: lm.isl, members: lm.members, nodes: [] });
    byIsland.get(lm.name).nodes.push({ kind: 'town', t, x: t.cx, z: t.cz, big: (t.count || 0) >= 40 });
  }
  const routes = [];
  for (const { isl, nodes } of byIsland.values()) {
    if (nodes.length < 2) continue;
    // Prim's tree.
    const inTree = [nodes[0]];
    const rest = nodes.slice(1);
    const edges = [];
    while (rest.length) {
      let best = null;
      for (const a of inTree) for (const b of rest) {
        const d = Math.hypot(a.x - b.x, a.z - b.z);
        if (!best || d < best.d) best = { a, b, d };
      }
      inTree.push(best.b);
      rest.splice(rest.indexOf(best.b), 1);
      edges.push({ island: isl.name, a: best.a, b: best.b, d: best.d, highway: false });
    }
    if (HIGHWAY_ISLANDS.has(isl.name)) {
      // The highway: every edge touching a field's town, and every edge on the tree's way between two of them.
      const adj = new Map(nodes.map((n) => [n, []]));
      for (const e of edges) {
        adj.get(e.a).push([e.b, e]);
        adj.get(e.b).push([e.a, e]);
      }
      const fieldTowns = nodes.filter((n) => n.t.airport);
      for (const e of edges) if (e.a.t.airport || e.b.t.airport) e.highway = true;
      for (let i = 0; i < fieldTowns.length; i++) {
        for (let j = i + 1; j < fieldTowns.length; j++) {
          // The tree's one path between them.
          const prev = new Map([[fieldTowns[i], null]]);
          const q = [fieldTowns[i]];
          while (q.length) {
            const n = q.shift();
            for (const [m, e] of adj.get(n)) if (!prev.has(m)) { prev.set(m, [n, e]); q.push(m); }
          }
          for (let n = fieldTowns[j]; prev.get(n); n = prev.get(n)[0]) prev.get(n)[1].highway = true;
        }
      }
    }
    routes.push(...edges);
  }
  return routes;
}

/**
 * Route and build every road: returns { roads, bridges, rings, calm, report }.
 * `walls(x, z)` is off limits (the sea is too, by height).
 */
export function buildNetwork({ T, plan, routes, rivers, walls }) {
  const roads = [];
  const bridges = [];
  const rings = [];
  const report = [];
  const grids = new Map();
  for (const r of routes) {
    const isl = plan.islands.find((i) => i.name === r.island);
    if (!grids.has(r.island)) grids.set(r.island, makeGrid(T, isl, walls, rivers, landmassOf(plan.islands, isl).members));
    const grid = grids.get(r.island);
    // From the edge of each town, not its middle (the town's own streets are its own), towards the other.
    const edge = (n, other) => {
      const d = Math.hypot(other.x - n.x, other.z - n.z) || 1;
      const k = (n.t.radius || 300) * 0.95;
      return { x: n.x + ((other.x - n.x) / d) * k, z: n.z + ((other.z - n.z) / d) * k };
    };
    const from = edge(r.a, r.b);
    const to = edge(r.b, r.a);
    const raw = astar(grid, from, to);
    if (!raw) {
      report.push(`${r.island}: no way from ${r.a.t.name} to ${r.b.t.name}`);
      continue;
    }
    let line = smooth(raw);
    if (r.highway) {
      // A roundabout at each end, where the highway meets the town; the carriageways stop at its ring.
      const RING = 30;
      for (const [n, end] of [[r.a, 0], [r.b, 1]]) {
        const at = end ? line[line.length - 1] : line[0];
        let g = rings.find((q) => Math.hypot(q.x - at[0], q.z - at[1]) < 160);
        if (!g) {
          g = { x: Math.round(at[0]), z: Math.round(at[1]), r: RING, town: n.t.name, townAt: { x: n.t.cx, z: n.t.cz } };
          rings.push(g);
        }
        // Trim the line back to the ring's edge (plus the carriageway's own half-width).
        const keep = (p) => Math.hypot(p[0] - g.x, p[1] - g.z) > g.r + 12;
        if (end) {
          while (line.length > 3 && !keep(line[line.length - 1])) line.pop();
        } else {
          while (line.length > 3 && !keep(line[0])) line.shift();
        }
        // And on to the ring itself, so the carriageways (and the cars on them) meet it.
        const q = end ? line[line.length - 1] : line[0];
        const d = Math.hypot(q[0] - g.x, q[1] - g.z) || 1;
        const onRing = [g.x + ((q[0] - g.x) / d) * (g.r + 1), g.z + ((q[1] - g.z) / d) * (g.r + 1)];
        if (end) line.push(onRing);
        else line.unshift(onRing);
      }
    }
    roads.push({ route: r, line, highway: r.highway, name: `${r.a.t.name} – ${r.b.t.name}${r.highway ? ' highway' : ' road'}` });
  }
  return { roads, bridges, rings, report };
}

/**
 * The finished roads (after the calm zones round them have smoothed the
 * ground): profiles, bridges, the carriageways, the rings. `rivers` as in
 * the data. Returns road records for MAP.waters.roads and the bridges for
 * MAP.bridges.
 */
export function finishNetwork({ T, net, rivers }) {
  const out = [];
  const bridges = [];
  /*
   * A roundabout is level at the height of the ground at its middle, and
   * every road that meets it meets it at that height (checker, wave 18: the
   * hill town of Larkhollow's highway arrived 53 m under its roundabout, and
   * its high street 8 m over the other one).
   */
  for (const g of net.rings) g.y = Math.max(1.5, T.groundHeightAt(g.x, g.z));
  const ringAt = (p) => net.rings.find((g) => Math.hypot(p[0] - g.x, p[1] - g.z) < g.r + 60) || null;
  for (const rd of net.roads) {
    const pts = rd.line;
    // Where it crosses a river: the span, its ends a river's half-width and 45 m of bank beyond each side.
    const locked = new Array(pts.length).fill(false);
    const lockedY = new Array(pts.length).fill(0);
    const spans = [];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    for (let i = 1; i < pts.length; i++) {
      for (const rv of rivers) {
        for (let k = 1; k < rv.path.length; k++) {
          const c = cross(pts[i - 1], pts[i], rv.path[k - 1], rv.path[k]);
          if (!c) continue;
          const at = cum[i - 1] + (cum[i] - cum[i - 1]) * c.t;
          const level = rv.path[k - 1][2] + (rv.path[k][2] - rv.path[k - 1][2]) * c.u;
          const hw = rv.path[k - 1][3] || rv.halfWidth;
          spans.push({ from: at - hw - 55, to: at + hw + 55, level, river: rv.name });
        }
      }
    }
    for (const sp of spans) {
      const i0 = cum.findIndex((c) => c >= sp.from);
      let i1 = cum.findIndex((c) => c > sp.to);
      if (i1 < 0) i1 = pts.length - 1;
      const a = Math.max(0, i0 - 1);
      const b = Math.min(pts.length - 1, i1);
      const ga = Math.max(1.5, T.groundHeightAt(pts[a][0], pts[a][1]));
      const gb = Math.max(1.5, T.groundHeightAt(pts[b][0], pts[b][1]));
      const deck = Math.max(sp.level + 8, (ga + gb) / 2);
      for (let i = a; i <= b; i++) {
        locked[i] = true;
        lockedY[i] = deck;
      }
      sp.a = a;
      sp.b = b;
      sp.deck = deck;
    }
    for (const i of [0, pts.length - 1]) {
      const g = ringAt(pts[i]);
      if (g && !locked[i]) {
        locked[i] = true;
        lockedY[i] = g.y;
      }
    }
    const carriage = rd.highway ? [offsetLine(pts, 9), offsetLine(pts, -9).reverse()] : [pts];
    /*
     * A dual carriageway's two sides share one profile, on the centre line,
     * with the grade held over the shorter side of each step (the inner one
     * on a bend). Two profiles, each eased from its own end, parted by 53 m
     * up Larkhollow's hill: a cliff between the eastbound and the westbound.
     */
    let shared = null;
    if (rd.highway) {
      const [e, w] = carriage;
      const n = pts.length;
      // (A metre short of it, for the data's whole-metre points and tenth-of-a-metre heights.)
      const runs = pts.map((p, i) => (i ? Math.max(0.5, Math.min(
        Math.hypot(e[i][0] - e[i - 1][0], e[i][1] - e[i - 1][1]),
        Math.hypot(w[n - 1 - i][0] - w[n - i][0], w[n - 1 - i][1] - w[n - i][1]),
      ) - 1) : 0));
      shared = profile(T, pts, locked, lockedY, runs);
    }
    carriage.forEach((cpts0, ci) => {
      const n = cpts0.length;
      /*
       * The deck is one straight span from its first point to its last
       * (MAP.bridges, terrain.js bridgeAt); the road over it has to be that
       * straight line too. Where the route bent on the span (Larkhollow's
       * highway at Westreach river 5, by 13 m), the carriageway left the deck
       * and ran across the river bed under the water (checker, wave 18).
       */
      const cpts = cpts0.map((p) => p.slice());
      const onSpan = new Array(n).fill(false);
      for (const sp of spans) {
        const [a, b] = ci === 1 ? [n - 1 - sp.b, n - 1 - sp.a] : [sp.a, sp.b];
        // The deck's ends as the data writes them (rounded), and the road between them on that line.
        const A = [Math.round(cpts[a][0]), Math.round(cpts[a][1])];
        const B = [Math.round(cpts[b][0]), Math.round(cpts[b][1])];
        const dx = B[0] - A[0];
        const dz = B[1] - A[1];
        const l2 = dx * dx + dz * dz;
        if (!(l2 > 1)) continue;
        for (let i = a + 1; i < b; i++) {
          const t = Math.max(0, Math.min(1, ((cpts[i][0] - A[0]) * dx + (cpts[i][1] - A[1]) * dz) / l2));
          cpts[i] = [Math.round((A[0] + dx * t) * 10) / 10, Math.round((A[1] + dz * t) * 10) / 10];
          onSpan[i] = true;
        }
      }
      // Each carriageway's own profile: on a bend the inner one is shorter, and the same rise over less road is steeper.
      const lk = ci === 1 ? locked.slice().reverse() : locked;
      const ly = ci === 1 ? lockedY.slice().reverse() : lockedY;
      const cys = shared ? (ci === 1 ? shared.slice().reverse() : shared) : profile(T, cpts, lk, ly);
      const rec = {
        name: `${rd.name}${rd.highway ? (ci ? ' (westbound)' : ' (eastbound)') : ''}`,
        kind: rd.highway ? 'highway' : 'road',
        halfWidth: rd.highway ? 9 : 8,
        blend: 55,
        path: cpts.map(([x, z], i) => (onSpan[i] ? [x, z] : [Math.round(x), Math.round(z)]).concat(Math.round(cys[i] * 10) / 10)),
        bridges: spans.map((sp) => (ci === 1 ? [n - 1 - sp.b, n - 1 - sp.a] : [sp.a, sp.b])),
      };
      out.push(rec);
      for (const sp of spans) {
        const [a, b] = ci === 1 ? [n - 1 - sp.b, n - 1 - sp.a] : [sp.a, sp.b];
        const A = rec.path[a];
        const B = rec.path[b];
        const len = Math.hypot(B[0] - A[0], B[1] - A[1]);
        bridges.push({
          road: rec.name, river: sp.river,
          ax: A[0], az: A[1], bx: B[0], bz: B[1], y: Math.round(sp.deck * 10) / 10,
          halfWidth: 7.5, len: Math.round(len), level: sp.level,
        });
      }
    });
  }
  // From each roundabout into its town: the high street the town's own streets grow from (scenery.js layTown uses it).
  for (const g of net.rings) {
    if (!g.townAt) continue;
    const dx = g.townAt.x - g.x;
    const dz = g.townAt.z - g.z;
    const L = Math.hypot(dx, dz);
    if (L < g.r + 40) continue;
    const pts = [];
    const ux = dx / L;
    const uz = dz / L;
    for (let s = g.r + 8; s < L; s += STEP / 2) pts.push([g.x + ux * s, g.z + uz * s]);
    pts.push([g.townAt.x, g.townAt.z]);
    const ys = profile(T, pts, pts.map((p, i) => i === 0), pts.map(() => g.y));
    out.push({ name: `${g.town} high street`, kind: 'street', halfWidth: 8, blend: 40, path: pts.map(([x, z], i) => [Math.round(x), Math.round(z), Math.round(ys[i] * 10) / 10]) });
  }
  // The roundabouts: a ring road each (a closed polyline the ambient cars go round).
  for (const g of net.rings) {
    const y = g.y;
    const ring = [];
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      ring.push([Math.round(g.x + Math.cos(a) * g.r), Math.round(g.z + Math.sin(a) * g.r), Math.round(y * 10) / 10]);
    }
    out.push({ name: `${g.town} roundabout`, kind: 'ring', halfWidth: 8, blend: 40, path: ring, ring: { x: g.x, z: g.z, r: g.r } });
  }
  return { roads: out, bridges };
}

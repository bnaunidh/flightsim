/**
 * Roads.
 *
 * WHY A GENERATOR AND NOT HAND-AUTHORED POLYLINES.
 *
 * A road has one hard requirement — a child must be able to drive up it — and
 * that requirement is about GRADE, which is a property of the ground, not of
 * the line drawn on a map. Hand-authoring the line means hand-checking the
 * grade, and then re-checking all of it every time somebody nudges an island's
 * peak by ten metres. The measurement that settled this: on Kestrel, the
 * obvious route from the airfield up to the town is 27% and needs a 104 m
 * embankment; the route round the island's waist is 0.9%. Nothing about either
 * number is visible in the map data. You have to ask the height function.
 *
 * So the map says WHERE the road has to go — depot, town, quay, relay — and
 * this works out the line and the profile, against the real `heightAt`.
 *
 * HOW THE GRADE IS GUARANTEED rather than hoped for. Every road carries its
 * own height at each point, and `roadHeight` in terrain.js cuts the ground to
 * meet it. So the profile is authored, not sampled: we walk the natural ground
 * along the line, then flatten that profile until no two consecutive points
 * differ by more than `maxGrade`. The grade is then true by construction, and
 * the thing left to measure is the PRICE — how deep the cut and how high the
 * embankment had to be. That number is reported rather than hidden, because a
 * 100 m embankment across a valley is a wall the game will draw and a child
 * will drive off.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO. It does not reroute round a mountain.
 * Given two points with a peak between them it will cut straight through and
 * tell you it cost ninety metres; the answer to that is a different pair of
 * points, and that is a decision for whoever wrote the map. Pathfinding over a
 * height field is a real algorithm and this is not it.
 */

import { heightAt, padWeight, isPaved, resolveFlats, AIRPORT, OBSTACLES, MAP } from './terrain.js';
import { MAPS } from './maps.js';
import { smoothstep } from '../core/noise.js';

/** Metres between profile samples. Three of these is about one terrain quad. */
const STEP = 55;
/** Metres between the points the path is WRITTEN at — see roadBetween. */
const DRAW_STEP = 16;
/** The steepest a finished road may be. 8% is a hard but drivable hill. */
/*
 * Ten per cent, not eight.
 *
 * Eight was a motorway's number on maps that are headlands and island chains.
 * What it actually did was refuse roads: the easing cannot take a profile
 * down into a dip and back out at 8%, so it bridges the dip instead and the
 * result is a fifty-metre embankment, which `buildRoads` then — rightly —
 * refuses. Cullen Quay had no road to it for that reason alone: every one of
 * the six candidate links came back "34 to 59 m embankment". At ten per cent
 * the same six links build, and ten per cent is an ordinary island road; the
 * steep lane out of a Cornish cove is nearer twenty.
 */
const MAX_GRADE = 0.10;

/**
 * Flatten a height profile until no step exceeds the maximum grade.
 *
 * Two passes, forwards then backwards, each pulling a point down towards its
 * neighbour if the step up to it is too big. Running it both ways is what
 * makes it symmetric — one pass alone biases the whole road towards whichever
 * end it started from, which shows up as a road that is flat at the depot and
 * steep at the town.
 */
function easeProfile(ys, maxStep, locked) {
  const free = (i) => !(locked && locked[i]);
  for (let pass = 0; pass < 64; pass++) {
    let moved = 0;
    for (let i = 1; i < ys.length; i++) {
      const d = ys[i] - ys[i - 1];
      if (Math.abs(d) <= maxStep) continue;
      const want = ys[i - 1] + Math.sign(d) * maxStep;
      if (free(i)) { ys[i] = want; moved++; }
      else if (free(i - 1)) { ys[i - 1] = ys[i] - Math.sign(d) * maxStep; moved++; }
    }
    for (let i = ys.length - 2; i >= 0; i--) {
      const d = ys[i] - ys[i + 1];
      if (Math.abs(d) <= maxStep) continue;
      const want = ys[i + 1] + Math.sign(d) * maxStep;
      if (free(i)) { ys[i] = want; moved++; }
      else if (free(i + 1)) { ys[i + 1] = ys[i] - Math.sign(d) * maxStep; moved++; }
    }
    if (!moved) break;
  }
  return ys;
}

/**
 * One road between two points.
 *
 * Returns the road and, beside it, what it cost: the deepest cut, the highest
 * embankment and the steepest grade that survived. Nothing here decides
 * whether that price is acceptable — `buildRoads` does, and it says so out
 * loud when it refuses one.
 */
export function roadBetween(a, b, opts = {}) {
  /*
   * Eighteen metres, not thirteen.
   *
   * A real island road is three metres a side. This one is driven by a
   * ten-year-old with two keys, and a key is bang-bang: you are either at full
   * lock or straightening up, with nothing in between. Measured on Drover's
   * Flat at fifty km/h, following the centreline as closely as the keys allow,
   * the van wanders 24 m either side — so on a 26 m road it is off the tarmac
   * about half the time, through no fault of the child's. The road is the
   * thing that should give.
   */
  const halfWidth = opts.halfWidth || 18;
  const blend = opts.blend || 60;
  /*
   * `opts.via` is the routed line — the one that goes round the hill rather
   * than through it. Everything below walks it at a fixed spacing, so the
   * profile easing and the cut/fill accounting do not care whether the line
   * came from the router or is simply the two ends.
   */
  const via = opts.via && opts.via.length > 1 ? opts.via : [a, b];
  const segs = [];
  let len = 0;
  for (let i = 1; i < via.length; i++) {
    const d = Math.hypot(via[i].x - via[i - 1].x, via[i].z - via[i - 1].z);
    segs.push({ a: via[i - 1], b: via[i], d, at: len });
    len += d;
  }
  const along = (u) => {
    const s0 = u * len;
    let k = 0;
    while (k < segs.length - 1 && segs[k].at + segs[k].d < s0) k++;
    const sg = segs[k];
    const t = sg.d > 0 ? (s0 - sg.at) / sg.d : 0;
    return { x: sg.a.x + (sg.b.x - sg.a.x) * t, z: sg.a.z + (sg.b.z - sg.a.z) * t };
  };
  const n = Math.max(2, Math.round(len / STEP));
  const xs = [];
  const zs = [];
  const ys = [];
  /*
   * A road arrives at the airfield at airfield height.
   *
   * `roadHeight` refuses to cut inside the pad — it has to, or the corridor
   * levels the runway to its own height and digs a trench across it. The
   * consequence, if the road ignores that, is a step at the pad boundary
   * where the ground jumps from the pad's elevation to the road's. Measured
   * on Drover's Flat before this: the ground climbed ten metres in forty at
   * the boundary, 32%, on a road whose authored profile was a flat 8%.
   *
   * So the samples inside the pad are locked to field elevation and the
   * easing works round them, which is what a real road does: it comes down
   * to meet the apron rather than ending in a wall above it.
   */
  const locked = [];
  for (let i = 0; i <= n; i++) {
    const { x, z } = along(i / n);
    xs.push(x);
    zs.push(z);
    const onPad = padWeight(x, z) > 0.9;
    locked.push(onPad);
    ys.push(onPad ? AIRPORT.elev : heightAt(x, z));
  }
  const natural = ys.slice();
  easeProfile(ys, (MAX_GRADE * len) / n, locked);

  let cut = 0;
  let fill = 0;
  let worst = 0;
  for (let i = 0; i <= n; i++) {
    const d = ys[i] - natural[i];
    if (d < 0) cut = Math.max(cut, -d);
    else fill = Math.max(fill, d);
    if (i) worst = Math.max(worst, Math.abs(ys[i] - ys[i - 1]) / (len / n));
  }
  /*
   * A path point is [x, z, y] — GROUND PLANE FIRST, ELEVATION LAST.
   *
   * Not three.js order, and the one thing about this data that is worth
   * saying out loud: every reader of it — `roadHeight`, `onRoad`,
   * `roadRibbon`, `nearestRoadPoint`, the chart — takes [0] and [1] as the
   * two map coordinates and [2] as the height, and a path written the other
   * way round is self-consistent enough that nothing throws. It just puts
   * the road somewhere else and cuts a trench along it. The hand-authored
   * networks in maps.js use this same order; tests/selftest-three-games.js
   * measures it.
   */
  /*
   * And written out every DRAW_STEP metres, not every profile step.
   *
   * The profile is worked out at 55 m, and the path used to be written at 55
   * m too — so the smooth line the router drew round a hill was sampled back
   * into straight 55 m chords, and every chord joined the next at a corner.
   * That is the "hard polygon corners" a child sees on the tarmac, and it is
   * the reason the van following the road had to steer in steps. The line
   * between profile samples now follows the routed curve
   * at 16 m, with the height interpolated along the eased profile, so the
   * grade and the cut and fill measured above are unchanged. Measured on
   * Drover's Flat: the worst kink 40 -> 31 degrees from this alone (see
   * smooth() for the rest), and because the corridor under the road now
   * follows the curve instead of cutting across it, one-metre steps steeper
   * than 15% along the driven line went from 75 to 2. Coordinates keep a
   * decimal: rounding a 16 m spacing to the whole metre wobbles the kerb.
   */
  const path = [];
  const seg = len / n;
  const sub = Math.max(1, Math.ceil(seg / DRAW_STEP));
  for (let i = 0; i <= n; i++) {
    const last = i === n;
    for (let j = 0; j < (last ? 1 : sub); j++) {
      const f = j / sub;
      const p = f === 0 ? { x: xs[i], z: zs[i] } : along((i + f) / n);
      const y = f === 0 ? ys[i] : ys[i] + (ys[i + 1] - ys[i]) * f;
      path.push([Math.round(p.x * 10) / 10, Math.round(p.z * 10) / 10, +y.toFixed(2)]);
    }
  }
  return { road: { name: opts.name || '', halfWidth, blend, path }, cut, fill, worst, len };
}

/* ==================================================================== *
 * Finding the line.
 *
 * A straight line between two places is the wrong road, and on a map with
 * any relief it is obviously wrong. Measured on Cape Vessel, which is a
 * headland map: straight lines between its seven places needed cuttings of
 * 73, 122, 126 and 194 metres, so every single link was refused and the map
 * came out with no roads at all. The same places joined by a road that FOLLOWS
 * THE GROUND are a network.
 *
 * So this is a least-cost path over the height field — the same thing a
 * surveyor does with a pair of dividers, and the reason real roads bend.
 * Cost is distance multiplied by a penalty that goes as the square of the
 * grade, so a route twice as long is worth taking to avoid a slope three
 * times as steep, and anything past `hardMax` is not a road at any price.
 *
 * Dijkstra rather than A*: the maps are 24,000 cells, it runs in a few
 * milliseconds at map load, and a bad heuristic on a cost function like this
 * one buys nothing and can lose the pass.
 * ==================================================================== */

/** Metres per cell. Three quads on a Kestrel-sized chunk; fine enough for a pass. */
const CELL = 90;
/**
 * Steeper than this is not a road at any price.
 *
 * This gates which CELLS the router may cross, not the finished grade — the
 * profile easing holds that at 8% whatever line it picks, and the cut and fill
 * limits decide whether the price is worth paying. So it can afford to be
 * generous: at 0.30 Cullen Sands lost two of its places the moment the
 * approach corridors stopped flattening half the island, because the only
 * lines to them cross a short steep shoulder that the easing would have
 * handled perfectly well.
 */
const HARD_MAX = 0.38;
/** How hard the cost punishes a slope, relative to MAX_GRADE. */
const GRADE_PENALTY = 9;

function mapBounds(mapDef) {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const c of mapDef.chunks || []) {
    x0 = Math.min(x0, c.cx - c.size / 2);
    x1 = Math.max(x1, c.cx + c.size / 2);
    z0 = Math.min(z0, c.cz - c.size / 2);
    z1 = Math.max(z1, c.cz + c.size / 2);
  }
  if (!isFinite(x0)) { x0 = -6000; x1 = 6000; z0 = -6000; z1 = 6000; }
  return { x0, x1, z0, z1 };
}

/**
 * A height grid, sampled once and shared by every road on the map.
 *
 * Building it is the expensive part — about twenty-four thousand heightAt
 * calls — and doing it per road would be doing it six times for no reason.
 */
export function roadGrid(mapDef, cell = CELL) {
  const b = mapBounds(mapDef);
  const nx = Math.max(4, Math.ceil((b.x1 - b.x0) / cell));
  const nz = Math.max(4, Math.ceil((b.z1 - b.z0) / cell));
  const h = new Float32Array(nx * nz);
  /*
   * And what is standing on it.
   *
   * The Drover's Flat road from the depot to the airfield went straight
   * through the terminal: driven with the harness's own pure pursuit the van
   * reached waypoint 20 of 23 and stopped dead against the building, which
   * is why the car job could never be finished and why "it gets to the far
   * end" had been failing. The router knew the shape of the ground and
   * nothing at all about what had been built on it.
   *
   * Buildings are already registered as boxes for the aeroplane to fly into,
   * so the road can read the same list. Padded by half a cell plus the road's
   * own half-width, so the tarmac goes round the wall rather than up to it.
   */
  const blocked = new Uint8Array(nx * nz);
  const pad = cell * 0.5 + 20;
  // Only the boxes that are over this map at all, so the per-cell test is a
  // handful of compares rather than the whole list.
  const near = OBSTACLES.filter(
    (o) => o.x1 + pad > b.x0 && o.x0 - pad < b.x1 && o.z1 + pad > b.z0 && o.z0 - pad < b.z1
  );
  for (let j = 0; j < nz; j++) {
    const z = b.z0 + j * cell;
    for (let i = 0; i < nx; i++) {
      const x = b.x0 + i * cell;
      const y = heightAt(x, z);
      h[j * nx + i] = y;
      for (let k = 0; k < near.length; k++) {
        const o = near[k];
        if (x <= o.x0 - pad || x >= o.x1 + pad || z <= o.z0 - pad || z >= o.z1 + pad) continue;
        /*
         * A thing blocks a road when it is standing ON the ground the road
         * would run over. The height test is not fussiness: OBSTACLES is the
         * live world's list, and an audit that walks all thirty-two maps
         * without rebuilding the scenery each time is looking at the boxes of
         * whichever map happens to be built. Those land either buried in the
         * hillside or floating above it, and neither is in the way.
         */
        if (o.y1 < y + 1.5 || o.y0 > y + 4) continue;
        blocked[j * nx + i] = 1;
        break;
      }
    }
  }
  return { ...b, nx, nz, h, blocked, cell };
}

/** A tiny binary heap. Dijkstra with a sorted array is quadratic and it shows. */
class Heap {
  constructor() { this.a = []; }
  push(k, v) {
    const a = this.a;
    a.push([k, v]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
  get size() { return this.a.length; }
}

/**
 * The cheapest line from a to b over the grid, or null if there is not one.
 *
 * Eight-connected, so a road can run diagonally; the diagonal step pays its
 * real length rather than one, which is what stops the result looking like a
 * staircase.
 */
export function routeBetween(g, a, b, hardMax = HARD_MAX) {
  const ix = (p) => Math.min(g.nx - 1, Math.max(0, Math.round((p.x - g.x0) / g.cell)));
  const iz = (p) => Math.min(g.nz - 1, Math.max(0, Math.round((p.z - g.z0) / g.cell)));
  const start = iz(a) * g.nx + ix(a);
  const goal = iz(b) * g.nx + ix(b);
  const n = g.nx * g.nz;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[start] = 0;
  const q = new Heap();
  q.push(0, start);
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (q.size) {
    const [d, u] = q.pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === goal) break;
    const ui = u % g.nx;
    const uj = (u - ui) / g.nx;
    const hu = g.h[u];
    for (const [dx, dz] of NB) {
      const vi = ui + dx;
      const vj = uj + dz;
      if (vi < 0 || vi >= g.nx || vj < 0 || vj >= g.nz) continue;
      const v = vj * g.nx + vi;
      if (done[v]) continue;
      if (g.blocked && g.blocked[v] && v !== goal && v !== start) continue;
      const hv = g.h[v];
      // A road does not go into the sea, and it does not start in it either.
      if (hv < 1 && v !== goal && v !== start) continue;
      const len = g.cell * (dx && dz ? Math.SQRT2 : 1);
      const grade = Math.abs(hv - hu) / len;
      if (grade > hardMax) continue;
      const step = len * (1 + GRADE_PENALTY * (grade / MAX_GRADE) * (grade / MAX_GRADE));
      const nd = d + step;
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; q.push(nd, v); }
    }
  }
  if (!isFinite(dist[goal])) return null;
  const pts = [];
  for (let u = goal; u !== -1; u = prev[u]) {
    const i = u % g.nx;
    const j = (u - i) / g.nx;
    pts.push({ x: g.x0 + i * g.cell, z: g.z0 + j * g.cell });
  }
  pts.reverse();
  pts[0] = { x: a.x, z: a.z };
  pts[pts.length - 1] = { x: b.x, z: b.z };
  return smooth(simplify(pts, g.cell * 0.7));
}

/**
 * Round the corners off, because a road is a curve.
 *
 * The router works on a grid, so its line is a staircase of 90 m steps and
 * every join is a corner. Simplifying removes the redundant points but keeps
 * the kinks, and a kink is a corner with no radius at all — measured, a van
 * following such a line as closely as two keys allow wandered 27 m either side
 * of it, because at fifty km/h there is no steering input that takes a corner
 * of zero radius. The child gets the blame for a line no vehicle could drive.
 *
 * Chaikin's corner cutting, twice: each pass replaces every corner with two
 * points a quarter and three quarters along, which is a quadratic B-spline in
 * the limit and, after two passes, a curve with a radius of roughly a third of
 * the segment length. The ends are pinned, because they are the places the
 * road is actually going.
 *
 * Three passes, not two. Two leaves every grid corner as four kinks of about
 * 22 degrees, which the tarmac draws as a visible polygon and which a van
 * following it has to take in steps. Measured over the router's output
 * (paths written every 16 m, before shareTrunks adds a corner at each
 * branch): kinks sharper than 10 degrees on Drover's Flat
 * 28 -> 11 and the worst 31 -> 18 degrees; Cape Vessel 110 -> 91, Cullen
 * Sands 63 -> 52, where what is left is the switchbacks' own hairpins. No
 * link that built before is refused now, and none that was refused builds.
 */
function smooth(pts, passes = 3) {
  let out = pts;
  for (let p = 0; p < passes && out.length > 2; p++) {
    const next = [out[0]];
    for (let i = 0; i < out.length - 1; i++) {
      const a = out[i];
      const b = out[i + 1];
      next.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
}

/** Drop the points that lie on the line their neighbours already describe. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1];
    const c = pts[i + 1];
    const p = pts[i];
    const ex = c.x - a.x;
    const ez = c.z - a.z;
    const l2 = ex * ex + ez * ez;
    const t = l2 > 0 ? ((p.x - a.x) * ex + (p.z - a.z) * ez) / l2 : 0;
    const qx = a.x + ex * t - p.x;
    const qz = a.z + ez * t - p.z;
    if (Math.hypot(qx, qz) > tol) keep.push(p);
  }
  keep.push(pts[pts.length - 1]);
  return keep;
}

/**
 * The whole network for a map, as a minimum spanning tree over its places.
 *
 * A spanning tree rather than every-pair: seven places is twenty-one roads and
 * a spider's web, and the island reads as a place with roads on it only if the
 * roads go somewhere. The tree is the shortest set of links that still lets
 * you drive from anywhere to anywhere, which is also what a real island has.
 *
 * @returns {{roads: Array, notes: Array<string>}}
 */
export function buildRoads(mapDef, opts = {}) {
  /*
   * From the island itself, never from the last set of roads.
   *
   * The router and the profile both read heightAt, and heightAt includes the
   * roads already laid — the previous generation's, still on the map — and
   * the flats, whose 'auto' heights were measured with those roads cut into
   * them. So every rebuild of the world laid a new network over the cutting
   * of the old one, and the island drifted. Measured on Drover's Flat, three
   * rebuilds in a row (every job start is one, when it changes map): the road
   * at the depot went 71.38, 71.19, 71.01, 70.84 m, the depot yard 75.07,
   * 74.43, 75.02, 74.88, and the airfield–quay road came out with 221, 209,
   * 217 and 213 points. Two children taking the same job got different roads.
   *
   * Only for the live map: a test that builds some other map's network has
   * no business touching this one's flats.
   */
  const w = mapDef === MAP ? mapDef.waters : null;
  const stash = w && w.roads && w.roads.length ? w.roads : null;
  if (stash) {
    w.roads = [];
    resolveFlats();
  }
  try {
    return buildRoadsFrom(mapDef, opts);
  } finally {
    if (stash) {
      w.roads = stash;
      resolveFlats();
    }
  }
}

function buildRoadsFrom(mapDef, { maxFill = 30, maxCut = 45, quiet = true } = {}) {
  const src = mapDef.courier && mapDef.courier.places;
  if (!src || src.length < 2) return { roads: [], notes: ['no places to join'] };
  // Anything only a boat can reach is not on the road network. So is anywhere
  // that is under water — a place the map put on another island.
  const nodes = src.filter((p) => !p.boatOnly && heightAt(p.x, p.z) > 0.5);
  const notes = [];
  const inTree = [0];
  const out = nodes.map((_, i) => i).slice(1);
  const roads = [];

  /*
   * Refusing an edge must not silently strand the place on the other end.
   *
   * The first version marked the node joined whatever happened, so a refused
   * link left a place with no road to it AND no further attempt to reach it.
   * On Cape four of six links were refused and the map came out with two
   * roads and five unreachable places. Now a refusal only rules out THAT
   * pair, and the node waits for a different parent.
   */
  const refused = new Set();
  const grid = roadGrid(mapDef);
  // Built only if a link is about to be refused; most maps never need it.
  let fineGrid = null;
  while (out.length) {
    let best = null;
    for (const i of inTree) {
      for (const j of out) {
        if (refused.has(i + ':' + j)) continue;
        const d = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
        if (!best || d < best.d) best = { i, j, d };
      }
    }
    if (!best) {
      for (const j of out) notes.push(`${nodes[j].name}: no road can reach it`);
      break;
    }
    const a = nodes[best.i];
    const b = nodes[best.j];
    /*
     * "No line exists at all" was usually a sampling accident.
     *
     * The grid is 90 m and its origin is wherever the map's chunks put it, so
     * an isthmus 60 m across falls between two samples and the router is told
     * the island chain is five islands with water between them. Cape Vessel
     * is exactly that: flood-filling the same rules on a grid offset by half
     * a cell reaches the relay the router swore was unreachable. Half the
     * cell and look again before believing it.
     */
    let via = routeBetween(grid, a, b);
    if (!via) {
      if (!fineGrid) fineGrid = roadGrid(mapDef, CELL / 2);
      via = routeBetween(fineGrid, a, b);
    }
    if (!via) {
      notes.push(`${a.name} – ${b.name}: no line exists at all`);
      refused.add(best.i + ':' + best.j);
      continue;
    }
    const r = roadBetween(a, b, { name: `${a.name} – ${b.name}`, via });
    /*
     * A road that needs a thirty-metre embankment is a wall, and the game will
     * draw it as one. Refusing it is better than shipping it: the place stays
     * on the map, reachable by air or by sea, and the note says why. This is
     * the only thing in the file that makes a judgement, and it is the one
     * judgement that has to be made somewhere.
     */
    /*
     * A refusal is worth one more try, on a road that climbs.
     *
     * Cape Vessel stranded three of its seven places for a fortnight and the
     * reason was not that no line exists: it is that the router is allowed to
     * cross a 38% cell, then `roadBetween` eases the finished profile to 8%,
     * and easing a straight 300 m climb into an 8% road needs an embankment a
     * hundred metres high. The line was never wrong — it was too STRAIGHT.
     *
     * A road up a hill switches back, and a switchback is what you get if you
     * forbid the steep cells and give the router cells fine enough to weave
     * between the ones that are left. That is all this is: same Dijkstra,
     * half the cell, a third of the grade gate, and it only runs for the pair
     * that was about to be refused, so the flat maps pay nothing for it.
     */
    let finished = r;
    if (r.fill > maxFill || r.cut > maxCut) {
      if (!fineGrid) fineGrid = roadGrid(mapDef, CELL / 2);
      const zig = routeBetween(fineGrid, a, b, 0.13);
      if (zig) {
        const r2 = roadBetween(a, b, { name: `${a.name} – ${b.name}`, via: zig });
        if (r2.fill <= maxFill && r2.cut <= maxCut) {
          finished = r2;
          notes.push(
            `${a.name} – ${b.name}: switchbacks, ${(r2.len / 1000).toFixed(2)} km ` +
              `instead of ${(r.len / 1000).toFixed(2)} km, cut ${r2.cut.toFixed(0)} m, fill ${r2.fill.toFixed(0)} m`
          );
        }
      }
    }
    if (finished.fill > maxFill || finished.cut > maxCut) {
      notes.push(
        `${a.name} – ${b.name}: refused, ` +
          (finished.fill > maxFill
            ? `${finished.fill.toFixed(0)} m embankment`
            : `${finished.cut.toFixed(0)} m cutting`)
      );
      refused.add(best.i + ':' + best.j);
      continue;
    }
    const rr = finished;
    {
      roads.push(rr.road);
      if (!quiet) {
        notes.push(
          `${a.name} – ${b.name}: ${(rr.len / 1000).toFixed(2)} km, ` +
            `${(rr.worst * 100).toFixed(1)}% max, cut ${rr.cut.toFixed(0)} m, fill ${rr.fill.toFixed(0)} m`
        );
      }
    }
    inTree.push(best.j);
    out.splice(out.indexOf(best.j), 1);
  }
  const trimmed = shareTrunks(roads);
  if (trimmed && !quiet) notes.push(`${trimmed} roads now branch off the road they ran beside`);
  const levelled = levelOverlaps(roads);
  if (levelled && !quiet) notes.push(`${levelled} points levelled to the road beside them`);
  return { roads, notes };
}

/**
 * Two roads leaving the same place along the same line become one road and a
 * branch.
 *
 * The spanning tree joins places pairwise and the router finds each line on
 * its own, so two roads out of the same place down the same valley are laid
 * side by side — measured on Drover's Flat, the airfield–quay road runs within
 * a corridor's width of the depot–airfield road for 440 m. That draws as a
 * double-width strip with two sets of paint, and under it the ground is
 * wrong: roadHeight lets the first road whose core covers a point decide its
 * height, the two roads' own heights there differ, and where one core ends
 * the ground steps between them. Headless on Drover's Flat, driving the
 * roads at 80 km/h: a 4.4 m step on the airfield–quay road at the edge of the
 * airfield, and a 1.2 m one where the airfield road leaves the depot.
 *
 * So the later road is cut back to where it leaves the earlier one's
 * corridor and joined to it there, as a T. The earlier road is untouched; the
 * later one keeps every point from the divergence on. Returns how many were
 * cut.
 */
function shareTrunks(roads) {
  const SHARE = 18;
  let cut = 0;
  for (let bi = 1; bi < roads.length; bi++) {
    const B = roads[bi];
    for (let ai = 0; ai < bi; ai++) {
      const A = roads[ai];
      for (const fromEnd of [false, true]) {
        const P = fromEnd ? B.path.slice().reverse() : B.path;
        if (P.length < 4) continue;
        const n0 = nearestOnPath(A.path, P[0][0], P[0][1]);
        if (!n0 || n0.d > 3) continue;
        let j = 1;
        while (j < P.length && nearestOnPath(A.path, P[j][0], P[j][1]).d < SHARE) j++;
        // Diverges at once: nothing shared. Never leaves it: leave it be.
        if (j < 2 || j >= P.length - 2) continue;
        const q = nearestOnPath(A.path, P[j - 1][0], P[j - 1][1]);
        const a0 = A.path[q.k - 1];
        const a1 = A.path[q.k];
        const yA = (a0[2] ?? 0) + ((a1[2] ?? 0) - (a0[2] ?? 0)) * q.t;
        const np = [[Math.round(q.x * 10) / 10, Math.round(q.z * 10) / 10, +yA.toFixed(2)], ...P.slice(j)];
        B.path = fromEnd ? np.reverse() : np;
        cut++;
      }
    }
  }
  return cut;
}

/**
 * Where two roads' corridors overlap, one height for both.
 *
 * shareTrunks joins a later road to an earlier one only where the two run
 * within 18 m; a corridor is 18 m either side, so two roads 20-35 m apart
 * overlap without being joined, and each has its own profile. roadHeight
 * lets the earlier road's core decide the ground and the later road's core
 * decide it a few metres further on — a step between the two. Measured on
 * Cape Vessel, where the Kerrow–Vessel Field road leaves Kerrow 20 m beside
 * the depot road: heightAt 109.0 then 90.4 one metre apart, the terrain
 * drawing that as a 40-70% bank under the lower road, the tarmac draped over
 * it (up to 256% across the lane), and the van knocked into the air there on
 * every job that went that way. The same shape, smaller, round every
 * junction: 4 m on the router's own networks (see the note in
 * tests/selftest-three-games.js), and a 13% cross-fall at Drover's depot.
 *
 * So every point of a later road that is within the two half-widths of an
 * earlier one takes the earlier road's height at the nearest point, is held
 * there, and the rest of the later road is eased back to the maximum grade
 * from it. Only heights move; no road moves sideways, so every road still
 * goes where it went. Returns how many points changed height.
 *
 * Measured over every job on all eight car islands, same driver: "Hard
 * landing" 13 -> 1, and points where the drawn tarmac falls more than 8%
 * from side to side 47 -> 27 of 3,917, the worst 256% -> 14%. What is left
 * is mostly one road doubling back on itself (Cullen's switchbacks): heightAt
 * across the road there rises 0.6 m in 8 m and sits 2.4 m above the road's
 * own profile, because roadHeight in terrain.js weighs every segment of the
 * same road within 200 m, the leg above included. Not this file's to change.
 */
function levelOverlaps(roads, pad = { weight: padWeight, elev: AIRPORT.elev }) {
  let moved = 0;
  for (let bi = 0; bi < roads.length; bi++) {
    const B = roads[bi];
    const p = B.path;
    if (!p || p.length < 2) continue;
    const bb = boxOf(B);
    const locked = new Array(p.length).fill(false);
    let any = false;
    /*
     * And held at field elevation wherever the airfield has the say.
     *
     * roadBetween locks its 55 m profile samples inside padWeight 0.9, but
     * roadHeight hands the ground to the pad from 0.86, and the 16 m points
     * written between a locked sample and a free one are interpolated, not
     * locked; and the easing below, from a junction, moved them freely.
     * Measured where the pad has a say (padWeight 0.86 and up), against
     * field elevation: Drover's Flat 12 points more than a metre off it,
     * the worst 6.5 m (The Airfield - Holt); Cullen Sands 6, worst 8.4 m;
     * Cape Vessel 12, the worst 34.3 m, where Kerrow - Vessel Field came
     * down to the pad's edge at 50 m and the pad was at 16. The ground
     * there fell 34 m in 28 m, and following the arrow at 95 km/h the van
     * went over it 3.5 m clear of the ground on three of Cape's five jobs.
     * The same rule as meetThePad below, for the network the router built.
     */
    for (let j = 0; pad && j < p.length; j++) {
      const q = p[j];
      if (pad.weight(q[0], q[1]) < PAD_GIVES_WAY) continue;
      if (Math.abs((q[2] ?? 0) - pad.elev) > 0.05) moved++;
      q[2] = pad.elev;
      locked[j] = true;
      any = true;
    }
    for (let ai = 0; ai < bi; ai++) {
      const A = roads[ai];
      const reach = (A.halfWidth || 18) + (B.halfWidth || 18);
      const ab = boxOf(A);
      if (ab.x0 > bb.x1 + reach || ab.x1 < bb.x0 - reach || ab.z0 > bb.z1 + reach || ab.z1 < bb.z0 - reach) continue;
      for (let j = 0; j < p.length; j++) {
        if (locked[j]) continue;
        const q = p[j];
        if (q[0] < ab.x0 - reach || q[0] > ab.x1 + reach || q[1] < ab.z0 - reach || q[1] > ab.z1 + reach) continue;
        const n = nearestOnPath(A.path, q[0], q[1]);
        if (!n || n.d >= reach) continue;
        const a0 = A.path[n.k - 1];
        const a1 = A.path[n.k];
        const yA = (a0[2] ?? 0) + ((a1[2] ?? 0) - (a0[2] ?? 0)) * n.t;
        if (Math.abs((q[2] ?? 0) - yA) > 0.05) moved++;
        q[2] = +yA.toFixed(2);
        locked[j] = true;
        any = true;
      }
    }
    if (any) easeAlong(p, locked, MAX_GRADE);
  }
  return moved;
}

/**
 * easeProfile for a written path: the same two passes, but each step allowed
 * the grade times its own length, because the written points are not
 * evenly spaced (every 16 m or less, and whatever shareTrunks left).
 *
 * Between two held points that are further apart in height than maxGrade
 * can join, the stretch between them is allowed the grade it needs, spread
 * evenly. The two passes cannot meet in the middle of a stretch like that:
 * one pulls down from the top, the other up from the bottom, and they left
 * the whole difference as one step where they met. Measured on Drover's
 * Flat once the airfield end of the depot road was held at field elevation
 * (see levelOverlaps): 66.3 m to come down in 598 m between the depot yard
 * and the pad, 11.1%, and the passes left a 6.5 m step 60 m out of the
 * depot. Spread, it is 11.1% the whole way.
 */
function easeAlong(p, locked, maxGrade) {
  const n = p.length;
  const along = new Float64Array(n);
  for (let i = 1; i < n; i++) along[i] = along[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  const grade = new Float64Array(n).fill(maxGrade);
  let held = -1;
  for (let i = 0; i < n; i++) {
    if (!locked[i]) continue;
    if (held >= 0 && i > held + 1) {
      const need = Math.abs(p[i][2] - p[held][2]) / Math.max(along[i] - along[held], 1e-6);
      if (need > maxGrade) for (let k = held + 1; k <= i; k++) grade[k] = need * 1.0001;
    }
    held = i;
  }
  const step = (i) => (along[i] - along[i - 1]) * grade[i];
  for (let pass = 0; pass < 64; pass++) {
    let changed = 0;
    for (let i = 1; i < p.length; i++) {
      const m = step(i);
      const d = p[i][2] - p[i - 1][2];
      if (Math.abs(d) <= m + 1e-6) continue;
      if (!locked[i]) { p[i][2] = p[i - 1][2] + Math.sign(d) * m; changed++; }
      else if (!locked[i - 1]) { p[i - 1][2] = p[i][2] - Math.sign(d) * m; changed++; }
    }
    for (let i = p.length - 2; i >= 0; i--) {
      const m = step(i + 1);
      const d = p[i][2] - p[i + 1][2];
      if (Math.abs(d) <= m + 1e-6) continue;
      if (!locked[i]) { p[i][2] = p[i + 1][2] + Math.sign(d) * m; changed++; }
      else if (!locked[i + 1]) { p[i + 1][2] = p[i][2] - Math.sign(d) * m; changed++; }
    }
    if (!changed) break;
  }
  for (const q of p) q[2] = +q[2].toFixed(2);
}

/* ==================================================================== *
 * An authored road comes down off the airfield; it does not fall off it.
 *
 * roadBetween locks a generated road to field elevation wherever it is on
 * the pad (see "A road arrives at the airfield at airfield height"), because
 * roadHeight in terrain.js gives the pad the last word: past padWeight 0.98
 * the road has no say, between 0.86 and 0.98 its say fades out. A road a
 * map AUTHORS never went through that. Measured on Airfield Perimeter: the
 * Perimeter Loop is written [-50, 850, 24] -> [-320, 850, 52.6], a steady
 * 10.6%, but the pad's edge is at x -247, where that line is only 44.9 m and
 * the pad is 51. The pad's ground ended at -231 and the road's began at
 * -201, 11 m lower: heightAt fell 51.2 -> 40.0 between x -225 and -200
 * (45% at the steepest 5 m; 68% at the steepest 2 m), and following the
 * arrow at 81-90 km/h the van left the crest and came down 2.0-2.5 m
 * further on, on four of the five jobs there (the car playtest,
 * "following the arrow never throws the van off the road").
 *
 * So the same rule, applied to the authored networks of the car's islands
 * once, when this module loads — before any of them is built, so the
 * island is the same whichever way it is reached. Only the stretches of an
 * authored road that come within the pad's reach change: written out every
 * DRAW_STEP metres, held at field elevation where the road stops having a
 * say (padWeight 0.86 and up), and eased back from there to the road as
 * authored at PAD_RAMP. Every other point of every road keeps the height
 * its author gave it.
 *
 * Fifteen per cent, not the generator's ten: the ramp has to take up the
 * whole mismatch between the pad and the authored line (11 m on the
 * Perimeter Loop), and at ten the embankment would run 270 m out into the
 * plain, 12 m high at its end. At fifteen it is 180 m, and 4.4 m high where
 * it rejoins the authored road. Fifteen at 90 km/h is 3.8 m/s of vertical
 * speed, under SEAM_V in surface.js, so the van rides it as a slope.
 * ==================================================================== */

/** Where roadHeight starts giving way to the pad (its padFade, terrain.js). */
const PAD_GIVES_WAY = 0.86;
/** The steepest an authored road may come down off the airfield. */
const PAD_RAMP = 0.15;

/**
 * padWeight for a map that is not loaded: terrain.js's regionWeight, read
 * from the map's own airport block rather than the live AIRPORT.
 */
function padWeightOf(air, x, z) {
  let w = 0;
  for (const p of [air.pad, air.pad2]) {
    if (!p) continue;
    if (x < p.x0 - p.blend || x > p.x1 + p.blend || z < p.z0 - p.blend || z > p.z1 + p.blend) continue;
    const inX = smoothstep(p.x0 - p.blend, p.x0, x) * (1 - smoothstep(p.x1, p.x1 + p.blend, x));
    const inZ = smoothstep(p.z0 - p.blend, p.z0, z) * (1 - smoothstep(p.z1, p.z1 + p.blend, z));
    if (inX * inZ > w) w = inX * inZ;
  }
  return w;
}

/**
 * Fit a map's authored roads to its airfield (see above). Returns how many
 * written points moved by more than 5 cm; running it again moves none.
 * A map with no airport block of its own, or a network the router built
 * (which is fitted as it is built), is left alone.
 */
export function meetThePad(mapDef) {
  const air = mapDef && mapDef.airport;
  const w = mapDef && mapDef.waters;
  const R = w && w.roads;
  if (!air || !air.pad || !Number.isFinite(air.elev) || !R || !R.length || w._generated) return 0;
  let moved = 0;
  for (const rd of R) {
    const p = rd.path;
    if (!p || p.length < 2 || p.some((q) => !Number.isFinite(q[2]))) continue;
    const out = [p[0].slice()];
    const free = [false];
    let touches = false;
    for (let k = 1; k < p.length; k++) {
      const a = p[k - 1];
      const b = p[k];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      let near = false;
      for (let s = 0; s <= len && !near; s += 8) {
        const t = len > 0 ? s / len : 0;
        if (padWeightOf(air, a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t) > 0) near = true;
      }
      if (!near) {
        out.push(b.slice());
        free.push(false);
        continue;
      }
      touches = true;
      free[out.length - 1] = true;
      const sub = Math.max(1, Math.ceil(len / DRAW_STEP));
      for (let j = 1; j < sub; j++) {
        const t = j / sub;
        out.push([
          Math.round((a[0] + (b[0] - a[0]) * t) * 10) / 10,
          Math.round((a[1] + (b[1] - a[1]) * t) * 10) / 10,
          +(a[2] + (b[2] - a[2]) * t).toFixed(2),
        ]);
        free.push(true);
      }
      out.push(b.slice());
      free.push(true);
    }
    if (!touches) continue;
    const was = out.map((q) => q[2]);
    const locked = out.map((q, i) => {
      if (padWeightOf(air, q[0], q[1]) >= PAD_GIVES_WAY) {
        q[2] = air.elev;
        return true;
      }
      return !free[i];
    });
    easeAlong(out, locked, PAD_RAMP);
    for (let i = 0; i < out.length; i++) if (Math.abs(out[i][2] - was[i]) > 0.05) moved++;
    rd.path = out;
  }
  return moved;
}

/**
 * Is this point on a made road? Used by the car for grip, and by the chart.
 *
 * Deliberately a separate walk from `roadHeight`'s: that one answers "how high
 * is the ground here", which is true well outside the tarmac because of the
 * blend, and this one answers "am I on the road", which is only true on it.
 */
export function onRoad(roads, x, z, margin = 0) {
  if (!roads || !roads.length) return false;
  if (padWeight(x, z) > 0.9) return false;
  for (const rd of roads) {
    if (x < rd._x0 || x > rd._x1 || z < rd._z0 || z > rd._z1) continue;
    const w = (rd.halfWidth || 18) + margin;
    const p = rd.path;
    for (let k = 1; k < p.length; k++) {
      const ax = p[k - 1][0];
      const az = p[k - 1][1];
      const ex = p[k][0] - ax;
      const ez = p[k][1] - az;
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t - x;
      const qz = az + ez * t - z;
      if (qx * qx + qz * qz <= w * w) return true;
    }
  }
  return false;
}

/* ==================================================================== *
 * How wide a road is, as drawn and as driven.
 *
 * `halfWidth` on a road is the CORRIDOR: the 18 m either side of the line
 * that roadHeight levels, so the ground under the road is flat. It was also
 * being used as the width of the tarmac — the ribbon drew 78% of it, 28 m
 * across, and the tyres read "tarmac" out to the full 36. A van is 1.9 m wide.
 * What the child saw at the depot was three of those slabs overlapping into a
 * black field with hard corners, and what the tyres did was drive at tarmac
 * speed across what looked like grass.
 *
 * So the corridor stays as it was — it is what makes the grade true — and the
 * road on top of it is a road: ten metres of tarmac, two lanes and a centre
 * line, with a two-metre gravel verge each side. The tyres read the same
 * thing the eye does: tarmac on the tarmac (plus 0.8 m, because a van with
 * its outside wheels on the white line is still on the road), gravel on the
 * verge, and whatever the ground is beyond that.
 * ==================================================================== */

/** Half the width of the drawn and driven tarmac, metres. */
export const PAVED_HALF = 5;
/** The gravel verge each side of the tarmac, metres. */
export const VERGE = 2;

const TARMAC = Object.freeze({ kind: 'tarmac' });
const GRAVEL = Object.freeze({ kind: 'gravel' });

/** Each road's own bounding box, worked out once. `rd._x0` and friends are
 *  set by resolveWaters on map load, but a road built in a test has none. */
const BOXES = new WeakMap();
function boxOf(rd) {
  let b = BOXES.get(rd);
  if (b && b.path === rd.path) return b;
  b = { path: rd.path, x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity };
  for (const q of rd.path) {
    if (q[0] < b.x0) b.x0 = q[0];
    if (q[0] > b.x1) b.x1 = q[0];
    if (q[1] < b.z0) b.z0 = q[1];
    if (q[1] > b.z1) b.z1 = q[1];
  }
  BOXES.set(rd, b);
  return b;
}

/**
 * Distance from a point to the nearest centreline, if it is within `reach`.
 * Returns a number, not an object, because the tyres ask this every frame.
 */
export function distanceToRoads(roads, x, z, reach = 40) {
  if (!roads || !roads.length) return Infinity;
  let best = reach * reach;
  let found = false;
  for (const rd of roads) {
    const b = boxOf(rd);
    if (x < b.x0 - reach || x > b.x1 + reach || z < b.z0 - reach || z > b.z1 + reach) continue;
    const p = rd.path;
    for (let k = 1; k < p.length; k++) {
      const ax = p[k - 1][0];
      const az = p[k - 1][1];
      const ex = p[k][0] - ax;
      const ez = p[k][1] - az;
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t - x;
      const qz = az + ez * t - z;
      const d2 = qx * qx + qz * qz;
      if (d2 < best) {
        best = d2;
        found = true;
      }
    }
  }
  return found ? Math.sqrt(best) : Infinity;
}

/** 'tarmac', 'gravel' or null: what the made road is at this point. */
export function pavedAt(roads, x, z) {
  const d = distanceToRoads(roads, x, z, PAVED_HALF + VERGE + 2);
  if (d <= PAVED_HALF + 0.8) return 'tarmac';
  if (d <= PAVED_HALF + VERGE + 1.2) return 'gravel';
  return null;
}

/* ==================================================================== *
 * Getting from here to there ON the roads.
 *
 * Every job's arrow used to be given two points — the depot and the town —
 * and the turn tracker walked the straight line between them. On Drover's
 * Flat that line leaves the tarmac eleven metres from the depot and crosses
 * a kilometre of farmland; "STRAIGHT ON 1170 m" was the arrow, the whole way,
 * and a child who followed it drove into the first tree. The par clock was
 * set from the same straight line plus a third.
 *
 * So the network is a graph: every path point is a node, every road touching
 * or crossing another is a junction, and a route is Dijkstra over that. The
 * route comes back as the ROAD's own points, so the arrow turns where the
 * road turns. A few hundred nodes on the biggest network; built once per
 * road list and cached against it.
 * ==================================================================== */

const GRAPHS = new WeakMap();

/** The nearest point on a single path: distance, segment index and t. */
function nearestOnPath(p, x, z) {
  let best = null;
  for (let k = 1; k < p.length; k++) {
    const ax = p[k - 1][0];
    const az = p[k - 1][1];
    const ex = p[k][0] - ax;
    const ez = p[k][1] - az;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + ex * t;
    const qz = az + ez * t;
    const d = Math.hypot(qx - x, qz - z);
    if (!best || d < best.d) best = { d, k, t, x: qx, z: qz };
  }
  return best;
}

/** Where segment a–b crosses segment c–d, as t along a–b, or null. */
function segCross(a, b, c, d) {
  const rx = b[0] - a[0];
  const rz = b[1] - a[1];
  const sx = d[0] - c[0];
  const sz = d[1] - c[1];
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const qx = c[0] - a[0];
  const qz = c[1] - a[1];
  const t = (qx * sz - qz * sx) / den;
  const u = (qx * rz - qz * rx) / den;
  if (t <= 0.001 || t >= 0.999 || u < 0 || u > 1) return null;
  return { t, x: a[0] + rx * t, z: a[1] + rz * t };
}

export function roadGraph(roads) {
  if (!roads || !roads.length) return null;
  const hit = GRAPHS.get(roads);
  if (hit && hit.n === roads.length) return hit;

  const MERGE = 3;
  const JOIN = 14;
  const nodes = [];
  const adj = [];
  const edges = [];
  const cells = new Map();
  const ck = (i, j) => `${i},${j}`;
  const nodeAt = (x, z) => {
    const i = Math.floor(x / MERGE);
    const j = Math.floor(z / MERGE);
    for (let a = -1; a <= 1; a++) {
      for (let b = -1; b <= 1; b++) {
        const list = cells.get(ck(i + a, j + b));
        if (!list) continue;
        for (const id of list) if (Math.hypot(nodes[id].x - x, nodes[id].z - z) < MERGE) return id;
      }
    }
    const id = nodes.length;
    nodes.push({ x, z });
    adj.push([]);
    const key = ck(i, j);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(id);
    return id;
  };
  const link = (a, b) => {
    if (a === b) return;
    const len = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z);
    const e = edges.length;
    edges.push({ a, b, len });
    adj[a].push(e);
    adj[b].push(e);
  };

  // Where each road is touched or crossed by another, as extra stations on it.
  const extra = roads.map(() => []);
  const connectors = [];
  for (let i = 0; i < roads.length; i++) {
    const A = roads[i].path;
    const bA = boxOf(roads[i]);
    for (let j = 0; j < roads.length; j++) {
      if (i === j) continue;
      const B = roads[j].path;
      const bB = boxOf(roads[j]);
      if (bB.x0 > bA.x1 + JOIN || bB.x1 < bA.x0 - JOIN || bB.z0 > bA.z1 + JOIN || bB.z1 < bA.z0 - JOIN) continue;
      // B ending on A's side: a T-junction.
      for (const e of [B[0], B[B.length - 1]]) {
        const n = nearestOnPath(A, e[0], e[1]);
        if (n && n.d < JOIN) {
          extra[i].push({ s: n.k - 1 + n.t, x: n.x, z: n.z });
          connectors.push({ ax: n.x, az: n.z, bx: e[0], bz: e[1] });
        }
      }
      // B crossing A: a crossroads.
      if (j < i) continue;
      for (let a = 1; a < A.length; a++) {
        const ax0 = Math.min(A[a - 1][0], A[a][0]);
        const ax1 = Math.max(A[a - 1][0], A[a][0]);
        const az0 = Math.min(A[a - 1][1], A[a][1]);
        const az1 = Math.max(A[a - 1][1], A[a][1]);
        if (ax1 < bB.x0 || ax0 > bB.x1 || az1 < bB.z0 || az0 > bB.z1) continue;
        for (let b = 1; b < B.length; b++) {
          if (Math.max(B[b - 1][0], B[b][0]) < ax0 || Math.min(B[b - 1][0], B[b][0]) > ax1) continue;
          if (Math.max(B[b - 1][1], B[b][1]) < az0 || Math.min(B[b - 1][1], B[b][1]) > az1) continue;
          const X = segCross(A[a - 1], A[a], B[b - 1], B[b]);
          if (!X) continue;
          extra[i].push({ s: a - 1 + X.t, x: X.x, z: X.z });
          const u = segCross(B[b - 1], B[b], A[a - 1], A[a]);
          extra[j].push({ s: b - 1 + (u ? u.t : 0.5), x: X.x, z: X.z });
        }
      }
    }
  }

  for (let i = 0; i < roads.length; i++) {
    const p = roads[i].path;
    const st = p.map((q, k) => ({ s: k, x: q[0], z: q[1] }));
    for (const e of extra[i]) st.push(e);
    st.sort((a, b) => a.s - b.s);
    let prev = -1;
    for (const q of st) {
      const id = nodeAt(q.x, q.z);
      if (prev >= 0) link(prev, id);
      prev = id;
    }
  }
  for (const c of connectors) link(nodeAt(c.ax, c.az), nodeAt(c.bx, c.bz));

  const g = { nodes, adj, edges, n: roads.length };
  GRAPHS.set(roads, g);
  return g;
}

/** The nearest point on the graph's edges. */
function snapToGraph(g, x, z) {
  let best = null;
  for (let e = 0; e < g.edges.length; e++) {
    const E = g.edges[e];
    const a = g.nodes[E.a];
    const b = g.nodes[E.b];
    const ex = b.x - a.x;
    const ez = b.z - a.z;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((x - a.x) * ex + (z - a.z) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = a.x + ex * t;
    const qz = a.z + ez * t;
    const d = Math.hypot(qx - x, qz - z);
    if (!best || d < best.d) best = { d, e, t, x: qx, z: qz };
  }
  return best;
}

/**
 * The way by road from one point to another, as a list of {x, z}.
 *
 * Starts at the point on the network nearest `from` and ends at the one
 * nearest `to`; either end that is more than a few metres off the road is
 * added as a last leg, so the arrow still finishes at the door. Null when
 * there is no network, or no way through it.
 */
export function routeOnRoads(roads, from, to) {
  const g = roadGraph(roads);
  if (!g || !g.edges.length || !from || !to) return null;
  const s = snapToGraph(g, from.x, from.z);
  const e = snapToGraph(g, to.x, to.z);
  if (!s || !e) return null;
  const out = [];
  if (s.d > 3) out.push({ x: from.x, z: from.z });
  out.push({ x: s.x, z: s.z });
  const Es = g.edges[s.e];
  const Ee = g.edges[e.e];
  if (s.e === e.e) {
    out.push({ x: e.x, z: e.z });
  } else {
    const N = g.nodes.length;
    const dist = new Float64Array(N).fill(Infinity);
    const prev = new Int32Array(N).fill(-1);
    const done = new Uint8Array(N);
    const heap = new Heap();
    dist[Es.a] = s.t * Es.len;
    dist[Es.b] = (1 - s.t) * Es.len;
    heap.push(dist[Es.a], Es.a);
    heap.push(dist[Es.b], Es.b);
    while (heap.size) {
      const [d, u] = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (done[Ee.a] && done[Ee.b]) break;
      for (const ei of g.adj[u]) {
        const E = g.edges[ei];
        const v = E.a === u ? E.b : E.a;
        const nd = d + E.len;
        if (nd < dist[v]) {
          dist[v] = nd;
          prev[v] = u;
          heap.push(nd, v);
        }
      }
    }
    const viaA = dist[Ee.a] + e.t * Ee.len;
    const viaB = dist[Ee.b] + (1 - e.t) * Ee.len;
    const end = viaA <= viaB ? Ee.a : Ee.b;
    if (!isFinite(dist[end])) return null;
    const chain = [];
    for (let u = end; u !== -1; u = prev[u]) chain.push(u);
    chain.reverse();
    for (const u of chain) out.push({ x: g.nodes[u].x, z: g.nodes[u].z });
    out.push({ x: e.x, z: e.z });
  }
  if (e.d > 3) out.push({ x: to.x, z: to.z });
  // Drop zero-length steps; the turn tracker divides by segment lengths.
  const clean = [out[0]];
  for (let i = 1; i < out.length; i++) {
    const a = clean[clean.length - 1];
    if (Math.hypot(out[i].x - a.x, out[i].z - a.z) > 0.5) clean.push(out[i]);
  }
  if (clean.length < 2) clean.push({ x: to.x, z: to.z });
  return clean;
}

/**
 * How far by road every point of the network is from `from`: one Dijkstra,
 * returning the graph's nodes with a `d` in metres (Infinity where no road
 * reaches). For questions like "the highest point you can drive to and back
 * inside ten minutes", which would otherwise be a route per candidate.
 */
export function roadDistancesFrom(roads, from) {
  const g = roadGraph(roads);
  if (!g || !g.edges.length || !from) return null;
  const s = snapToGraph(g, from.x, from.z);
  const N = g.nodes.length;
  const dist = new Float64Array(N).fill(Infinity);
  const E = g.edges[s.e];
  dist[E.a] = s.d + s.t * E.len;
  dist[E.b] = s.d + (1 - s.t) * E.len;
  const heap = new Heap();
  heap.push(dist[E.a], E.a);
  heap.push(dist[E.b], E.b);
  const done = new Uint8Array(N);
  while (heap.size) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    for (const ei of g.adj[u]) {
      const e = g.edges[ei];
      const v = e.a === u ? e.b : e.a;
      if (d + e.len < dist[v]) {
        dist[v] = d + e.len;
        heap.push(dist[v], v);
      }
    }
  }
  return g.nodes.map((n, i) => ({ x: n.x, z: n.z, d: dist[i] }));
}

/** Metres along a route. */
export function routeLengthM(route) {
  let m = 0;
  for (let i = 1; route && i < route.length; i++) m += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  return m;
}

/* ==================================================================== *
 * Drawing it.
 *
 * The corridor makes the ground flat; this is the road on top of it: a
 * gravel verge, the tarmac, white edge lines and a dashed yellow centre line,
 * as ONE mesh with four materials, because thirty draw calls for a road is
 * thirty draw calls a school Chromebook does not have.
 *
 * WHAT WAS WRONG WITH THE OLD RIBBON, measured on Drover's Flat from the
 * chase camera's own raycasts (tests/features/car-playtest.browser.js):
 *
 *   - It was 28 m wide, and it had one vertex pair per path point — one every
 *     55 m — so every corner was a hard mitre and every junction was three
 *     slabs overlapping with square ends.
 *   - It was drawn at the road's AUTHORED profile height, which is not the
 *     height of the ground: roadHeight blends every segment within 200 m by
 *     inverse square distance, so the levelled ground sits off the profile by
 *     metres wherever the grade changes. Of 369 points sampled along the
 *     network, 202 had the tarmac UNDER the grass and 133 had it more than
 *     35 cm above it.
 *   - Its texture was stretched across the whole width (u from 0 to 1 over
 *     28 m) so the asphalt read as streaks.
 *
 * Now: vertices every six metres, sitting on the higher of heightAt and the
 * ground as the terrain mesh DRAWS it — the same triangles, interpolated the
 * same way, from the same vertex heights — plus a lift of six centimetres and
 * a polygon offset, so nothing z-fights and nothing floats. The verge's outer
 * edge is put on the DRAWN ground, 30 cm into it, so there is never a lip to
 * see. The asphalt is mapped in WORLD space, so two roads overlapping at a
 * junction are the same pixels and cannot fight, and every road end gets a
 * round tarmac pad so the joins are joins. Paint stops short of junctions and
 * crossings.
 *
 * Why the higher of the two, and not the mesh alone: the mesh is 25 m
 * between vertices and the corridor is 36 m across, so along an embankment
 * the next column of vertices is down the bank. The tarmac laid on the mesh
 * alone was draped over it — measured on Cape Vessel, 4 m of fall across a
 * 10 m road, and the van's wheels in and out of it. On the corridor's own
 * level the tarmac is flat, and the verge is the shoulder of the bank down to
 * the grass: what a road on an embankment looks like.
 * ==================================================================== */

const RIBBON_STEP = 6;
const TERRAIN_DETAIL = { low: 0.55, medium: 0.78, high: 1, ultra: 1.4 };

/**
 * The ground as the terrain mesh draws it, for a guessed level of detail.
 *
 * buildChunk samples heightAt at every vertex of a PlaneGeometry and the GPU
 * interpolates linearly across two triangles per quad, split along the
 * (ix, iy+1)–(ix+1, iy) diagonal. Between vertices that is NOT heightAt: on
 * a road running through a dip the chord sits above the true curve and a
 * ribbon laid on heightAt is under the grass. This reproduces the triangle.
 *
 * `vertexY(ci, ix, iy)` supplies the vertex heights: heightAt at build time
 * (cached, because neighbouring ribbon points share terrain vertices), or the
 * real chunk geometry once there is one to read — see `conform` below.
 */
function meshSampler(chunks, detail, vertexY) {
  const segsOf = chunks.map((c) => Math.max(1, Math.round(c.segments * detail)));
  return (x, z) => {
    let best = -Infinity;
    for (let ci = 0; ci < chunks.length; ci++) {
      const c = chunks[ci];
      const half = c.size / 2;
      const lx = x - (c.cx - half);
      const lz = z - (c.cz - half);
      if (lx < 0 || lz < 0 || lx > c.size || lz > c.size) continue;
      const segs = segsOf[ci];
      const sp = c.size / segs;
      let ix = Math.floor(lx / sp);
      let iy = Math.floor(lz / sp);
      if (ix >= segs) ix = segs - 1;
      if (iy >= segs) iy = segs - 1;
      const u = lx / sp - ix;
      const v = lz / sp - iy;
      let h;
      if (u + v <= 1) {
        const ha = vertexY(ci, segs, ix, iy);
        h = ha + (vertexY(ci, segs, ix + 1, iy) - ha) * u + (vertexY(ci, segs, ix, iy + 1) - ha) * v;
      } else {
        const hc = vertexY(ci, segs, ix + 1, iy + 1);
        h = hc + (vertexY(ci, segs, ix, iy + 1) - hc) * (1 - u) + (vertexY(ci, segs, ix + 1, iy) - hc) * (1 - v);
      }
      if (h > best) best = h;
    }
    return best;
  };
}

/**
 * The ground exactly as the built terrain mesh draws it, read out of the
 * chunk geometry: (x, z) => height, or -Infinity off every chunk. Null when
 * the group holds no terrain chunks.
 *
 * Used for the ribbon, and for the van through drawnGroundSampler below
 * (see setGroundMesh and groundAt in vehicles/surface.js). Cheaper than
 * heightAt: a chunk lookup and one triangle, no noise.
 */
export function terrainMeshSampler(terrainGroup) {
  if (!terrainGroup) return null;
  const meshes = [];
  terrainGroup.traverse((o) => {
    if (o.isMesh && o.geometry && o.geometry.parameters && o.geometry.parameters.widthSegments) meshes.push(o);
  });
  if (!meshes.length) return null;
  const cs = meshes.map((o) => ({
    cx: o.position.x,
    cz: o.position.z,
    size: o.geometry.parameters.width,
    segments: o.geometry.parameters.widthSegments,
    arr: o.geometry.attributes.position.array,
  }));
  const vy = (ci, segs, ix, iy) => {
    const c = cs[ci];
    const W = segs + 1;
    const i = Math.min(segs, iy) * W + Math.min(segs, ix);
    return c.arr[i * 3 + 1];
  };
  return meshSampler(cs, 1, vy);
}

/**
 * What the terrain shader paints at (x, z): the sand, grass and rock weights
 * (terrain.js buildChunk's per-vertex aBlend) interpolated over the triangle
 * the point is in, the way the GPU interpolates them, from the chunk drawn
 * on top there. (x, z, out) => true with out[0..2] = sand, grass, rock, or
 * false off every chunk; null when the group has no weighted chunks.
 *
 * For the word under the van's speed (IslandRoads.van in jobs.js), which
 * said "grass" wherever the physics said grass. The shader paints sand by
 * height and rock by the slope BETWEEN VERTICES 24-39 m apart, so it can
 * paint rock on ground the height function has made flat: at First Run's
 * yard on Drover's Flat the weights are 0 / 0.36 / 0.64. (A crop patch
 * drawn over the terrain wins over this: see fieldPatchSampler.)
 * No allocation: `out` is the caller's.
 */
export function terrainBlendSampler(terrainGroup) {
  if (!terrainGroup) return null;
  const cs = [];
  terrainGroup.traverse((o) => {
    const g = o.isMesh && o.geometry;
    if (g && g.parameters && g.parameters.widthSegments && g.attributes.aBlend) {
      cs.push({
        cx: o.position.x,
        cz: o.position.z,
        size: g.parameters.width,
        segs: g.parameters.widthSegments,
        y: g.attributes.position.array,
        w: g.attributes.aBlend.array,
      });
    }
  });
  if (!cs.length) return null;
  return (x, z, out) => {
    let top = -Infinity;
    for (let ci = 0; ci < cs.length; ci++) {
      const c = cs[ci];
      const half = c.size / 2;
      const lx = x - (c.cx - half);
      const lz = z - (c.cz - half);
      if (lx < 0 || lz < 0 || lx > c.size || lz > c.size) continue;
      const sp = c.size / c.segs;
      let ix = Math.floor(lx / sp);
      let iy = Math.floor(lz / sp);
      if (ix >= c.segs) ix = c.segs - 1;
      if (iy >= c.segs) iy = c.segs - 1;
      const u = lx / sp - ix;
      const v = lz / sp - iy;
      const W = c.segs + 1;
      // The same two triangles per cell as meshSampler (PlaneGeometry's).
      let i0, i1, i2, w0, w1, w2;
      if (u + v <= 1) {
        i0 = iy * W + ix; i1 = iy * W + ix + 1; i2 = (iy + 1) * W + ix;
        w0 = 1 - u - v; w1 = u; w2 = v;
      } else {
        i0 = (iy + 1) * W + ix + 1; i1 = (iy + 1) * W + ix; i2 = iy * W + ix + 1;
        w0 = u + v - 1; w1 = 1 - u; w2 = 1 - v;
      }
      const h = c.y[i0 * 3 + 1] * w0 + c.y[i1 * 3 + 1] * w1 + c.y[i2 * 3 + 1] * w2;
      if (h <= top) continue;
      top = h;
      for (let k = 0; k < 3; k++) out[k] = c.w[i0 * 3 + k] * w0 + c.w[i1 * 3 + k] * w1 + c.w[i2 * 3 + k] * w2;
    }
    return top > -Infinity;
  };
}

/**
 * The ground a van should ride: what is DRAWN at (x, z), the road included.
 * (x, z) => height, or -Infinity off every terrain chunk. Null without one.
 *
 * On the tarmac that is the higher of heightAt and the mesh — the rule the
 * ribbon is laid by (see the note over RIBBON_STEP). Across the verge it is
 * the shoulder the ribbon draws, from the road's level down to the grass.
 * Beyond the verge it is the grass: the terrain mesh, and only the mesh.
 *
 * The van rode the higher of heightAt and the mesh EVERYWHERE, which is
 * right on the tarmac and wrong off it: wherever heightAt rises between two
 * terrain vertices — the edge of a corridor, the lip of a flat — the mesh
 * draws the chord under it and the van hovered over grass the child could
 * see. Measured on Drover's Flat, every 10 m within 1.5 km of the depot:
 * 1,298 of 65,114 off-road points (2.0%) floated more than 50 cm, 448 more
 * than a metre, the worst 5.0 m; and at (888.75, -284), on the depot yard,
 * heightAt steps 3.5 m in a metre where the mesh is a gentle slope, and at
 * 100 km/h the van dropped 2 m off a step nobody could see.
 */
export function drawnGroundSampler(terrainGroup, roads, roadMesh = null) {
  const mesh = terrainMeshSampler(terrainGroup);
  if (!mesh) return null;
  const list = roads && roads.length ? roads : null;
  const EDGE = PAVED_HALF + VERGE;
  // The tarmac itself, where the ribbon is drawn (ribbonSampler): the rule
  // below is what the ribbon was LAID by, and it is not where it lies.
  const ribbon = list ? ribbonSampler(roadMesh) : null;
  return (x, z) => {
    const m = mesh(x, z);
    if (m === -Infinity || !list) return m;
    const d = distanceToRoads(list, x, z, EDGE);
    if (d >= EDGE) return m;
    const h = heightAt(x, z);
    let road = h > m ? h : m;
    if (ribbon) {
      const t = ribbon(x, z);
      if (t > -Infinity && Math.abs(t - road) < 1.5) road = t;
    }
    if (d <= PAVED_HALF) return road;
    return road + (m - road) * ((d - PAVED_HALF) / VERGE);
  };
}

/** heightAt at a terrain vertex, remembered: a road crosses the same quads. */
function heightVertexY(chunks) {
  const cache = new Map();
  return (ci, segs, ix, iy) => {
    const key = `${ci}|${segs}|${ix}|${iy}`;
    let y = cache.get(key);
    if (y === undefined) {
      const c = chunks[ci];
      const sp = c.size / segs;
      y = heightAt(c.cx - c.size / 2 + ix * sp, c.cz - c.size / 2 + iy * sp);
      cache.set(key, y);
    }
    return y;
  };
}

/** A procedural asphalt with no joints in it: the apron's texture has a
 *  concrete-slab grid that reads as paving slabs on a country road. */
let ASPHALT_CANVAS = null;
let VERGE_CANVAS = null;
function speckle(size, base, dots, seed) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  // Broad, soft patches first, so the surface is not one flat colour.
  for (let i = 0; i < 26; i++) {
    const x = rnd() * size;
    const y = rnd() * size;
    const r = size * (0.08 + rnd() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.05 + rnd() * 0.06;
    grad.addColorStop(0, rnd() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.7})`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      g.beginPath();
      g.arc(x + ox, y + oy, r, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const [col, n, rMax] of dots) {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const r = 0.5 + rnd() * rMax;
      g.fillRect(rnd() * size, rnd() * size, r, r);
    }
  }
  return c;
}

function roadTextures(THREE) {
  if (typeof document === 'undefined') return { asphalt: null, verge: null };
  if (!ASPHALT_CANVAS) {
    ASPHALT_CANVAS = speckle(512, '#5c5f64', [
      ['rgba(38,39,42,0.28)', 9000, 1.2],
      ['rgba(140,142,146,0.22)', 6000, 1.0],
    ], 71);
    VERGE_CANVAS = speckle(128, '#8f8468', [
      ['rgba(70,62,48,0.6)', 900, 2.2],
      ['rgba(190,180,158,0.55)', 700, 1.8],
    ], 29);
  }
  const make = (canvas) => {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  };
  return { asphalt: make(ASPHALT_CANVAS), verge: make(VERGE_CANVAS) };
}

/**
 * Lift the ribbon wherever the ground would show through it.
 *
 * Every vertex is ON the drawn ground, but a ribbon triangle spans six metres
 * and the terrain's own triangles fold along their diagonals in between, so
 * where the ground is convex the grass comes up through the middle of the
 * tarmac. Seen on the depot approaches on Drover's Flat as green bites out of
 * the road. So check the middle of every triangle edge and its centre against
 * the ground, and raise that triangle's corners by whatever it is short. Only
 * where it is short: a flat road is left exactly where it was.
 */
function unhide(pos, idx, sink, groundY) {
  const raise = new Float32Array(sink.length);
  const need = (a, b, fa, fb) => {
    const x = pos[a * 3] * fa + pos[b * 3] * fb;
    const z = pos[a * 3 + 2] * fa + pos[b * 3 + 2] * fb;
    const y = pos[a * 3 + 1] * fa + pos[b * 3 + 1] * fb;
    const s = sink[a] * fa + sink[b] * fb;
    return groundY(x, z) + s - y;
  };
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t];
    const b = idx[t + 1];
    const c = idx[t + 2];
    let short = Math.max(need(a, b, 0.5, 0.5), need(b, c, 0.5, 0.5), need(c, a, 0.5, 0.5));
    // The centre, as the mean of a and the middle of b-c.
    const mx = (pos[a * 3] + pos[b * 3] + pos[c * 3]) / 3;
    const mz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    const my = (pos[a * 3 + 1] + pos[b * 3 + 1] + pos[c * 3 + 1]) / 3;
    short = Math.max(short, groundY(mx, mz) + (sink[a] + sink[b] + sink[c]) / 3 - my);
    if (short <= 0.005) continue;
    short = Math.min(short, 1.5);
    if (short > raise[a]) raise[a] = short;
    if (short > raise[b]) raise[b] = short;
    if (short > raise[c]) raise[c] = short;
  }
  for (let i = 0; i < raise.length; i++) pos[i * 3 + 1] += raise[i];
}

/** Grows one material's worth of triangles. */
class Part {
  constructor() {
    this.pos = [];
    this.uv = [];
    this.idx = [];
    this.sink = [];
    this.outer = [];
    this.n = 0;
  }
  /** `outer` marks a vertex that sits on the DRAWN ground (the verge's outer
   *  edge) rather than on the road's own level. */
  v(x, y, z, u, w, sink, outer = 0) {
    this.pos.push(x, y, z);
    this.uv.push(u, w);
    this.sink.push(sink);
    this.outer.push(outer);
    return this.n++;
  }
  quad(a, b, c, d) {
    // a–b on one station, c–d on the next, both left to right. Wound so the
    // face points UP: (b - a) x (c - a) is right x forward, which is +y.
    this.idx.push(a, b, c, b, d, c);
  }
}

/**
 * @param {Array} roads the network from buildRoads
 * @param {number} lift metres above the drawn ground, to beat z-fighting
 */
export function roadRibbon(THREE, roads, { lift = 0.06, tex = null, nrm = null, quality = null } = {}) {
  if (!roads || !roads.length) return null;
  const chunks = (MAP && MAP.chunks) || [];
  const detail = TERRAIN_DETAIL[quality] || 1;
  const drawn = chunks.length ? meshSampler(chunks, detail, heightVertexY(chunks)) : null;
  // At build time the mesh is not in hand, so sit on whichever is higher: the
  // true ground, or the triangle the high-detail mesh will draw there.
  const groundY = (x, z) => {
    const h = heightAt(x, z);
    const m = drawn ? drawn(x, z) : -Infinity;
    return Math.max(h, m, 0);
  };
  // The grass as the (guessed) mesh draws it, for the verge's outer edge and
  // for checking that no grass comes up through the road.
  const drawnY = (x, z) => {
    const m = drawn ? drawn(x, z) : -Infinity;
    return Math.max(m > -1e6 ? m : heightAt(x, z), 0);
  };

  const P = PAVED_HALF;
  const V = VERGE;
  const verge = new Part();
  const tarmac = new Part();
  const white = new Part();
  const yellow = new Part();
  const TILE = 10; // metres of asphalt per texture repeat, in world space
  const G_TILE = 5;

  /*
   * Junctions: every road end, and every point one road touches or crosses
   * another. The paint stops short of them and each gets a round pad.
   */
  const g = roadGraph(roads);
  const joins = [];
  for (const rd of roads) {
    for (const q of [rd.path[0], rd.path[rd.path.length - 1]]) {
      if (!joins.some((j) => Math.hypot(j.x - q[0], j.z - q[1]) < 3)) joins.push({ x: q[0], z: q[1] });
    }
  }
  if (g) {
    for (let i = 0; i < g.nodes.length; i++) {
      if (g.adj[i].length < 3) continue;
      const q = g.nodes[i];
      if (!joins.some((j) => Math.hypot(j.x - q.x, j.z - q.z) < 3)) joins.push({ x: q.x, z: q.z });
    }
  }
  const nearJoin = (x, z, r) => {
    for (const j of joins) if (Math.abs(j.x - x) < r && Math.abs(j.z - z) < r && Math.hypot(j.x - x, j.z - z) < r) return true;
    return false;
  };
  /** Is this point on the tarmac of a road OTHER than `self`? Where it is,
   *  this road's paint would be drawn across that one's. */
  const onOther = (self, x, z) => {
    for (const rd of roads) {
      if (rd === self) continue;
      const b = boxOf(rd);
      if (x < b.x0 - P - 3 || x > b.x1 + P + 3 || z < b.z0 - P - 3 || z > b.z1 + P + 3) continue;
      const n = nearestOnPath(rd.path, x, z);
      if (n && n.d < P + 1.5) return true;
    }
    return false;
  };
  /** Airfield tarmac is drawn by the airfield; a road on top of it z-fights. */
  const airfield = (x, z) => padWeight(x, z) > 0.9 && isPaved(x, z);

  let edgeM = 0;
  let centreM = 0;

  for (const rd of roads) {
    const p = rd.path;
    if (!p || p.length < 2) continue;

    /* ---- stations every RIBBON_STEP metres, with a mitred direction ---- */
    const st = [];
    for (let k = 1; k < p.length; k++) {
      const ax = p[k - 1][0];
      const az = p[k - 1][1];
      const ex = p[k][0] - ax;
      const ez = p[k][1] - az;
      const len = Math.hypot(ex, ez);
      if (len < 0.01) continue;
      const m = Math.max(1, Math.ceil(len / RIBBON_STEP));
      for (let j = 0; j < m; j++) st.push({ x: ax + (ex * j) / m, z: az + (ez * j) / m, dx: ex / len, dz: ez / len, vtx: j === 0 });
    }
    const lastP = p[p.length - 1];
    if (st.length) {
      const L = st[st.length - 1];
      st.push({ x: lastP[0], z: lastP[1], dx: L.dx, dz: L.dz, vtx: true });
    }
    if (st.length < 2) continue;
    // At a path vertex the direction is the mean of the two segments, and the
    // offset is stretched so the width is constant through the corner.
    for (let i = 1; i < st.length - 1; i++) {
      if (!st[i].vtx) continue;
      const a = st[i - 1];
      const b = st[i];
      let mx = a.dx + b.dx;
      let mz = a.dz + b.dz;
      const ml = Math.hypot(mx, mz);
      if (ml < 1e-3) continue;
      mx /= ml;
      mz /= ml;
      const cos = mx * b.dx + mz * b.dz;
      b.mitre = Math.min(1.8, 1 / Math.max(cos, 0.3));
      b.dx = mx;
      b.dz = mz;
    }
    let s = 0;
    for (let i = 0; i < st.length; i++) {
      const q = st[i];
      if (i) s += Math.hypot(q.x - st[i - 1].x, q.z - st[i - 1].z);
      q.s = s;
      q.rx = -q.dz * (q.mitre || 1);
      q.rz = q.dx * (q.mitre || 1);
      q.skip = airfield(q.x, q.z);
      q.nearJoin = nearJoin(q.x, q.z, P + 4);
      q.other = q.nearJoin ? true : onOther(rd, q.x, q.z);
    }

    /* ---- verge and tarmac ---- */
    let prev = null;
    for (const q of st) {
      if (q.skip) {
        prev = null;
        continue;
      }
      const at = (o, ground = groundY) => {
        const x = q.x + q.rx * o;
        const z = q.z + q.rz * o;
        return [x, ground(x, z), z];
      };
      const L2 = at(-P - V, drawnY);
      const L1 = at(-P);
      const C = at(0);
      const R1 = at(P);
      const R2 = at(P + V, drawnY);
      const cur = {
        vL2: verge.v(L2[0], L2[1] + lift - 0.3, L2[2], L2[0] / G_TILE, L2[2] / G_TILE, lift - 0.3, 1),
        vL1: verge.v(L1[0], L1[1] + lift * 0.5, L1[2], L1[0] / G_TILE, L1[2] / G_TILE, lift * 0.5),
        vR1: verge.v(R1[0], R1[1] + lift * 0.5, R1[2], R1[0] / G_TILE, R1[2] / G_TILE, lift * 0.5),
        vR2: verge.v(R2[0], R2[1] + lift - 0.3, R2[2], R2[0] / G_TILE, R2[2] / G_TILE, lift - 0.3, 1),
        tL: tarmac.v(L1[0], L1[1] + lift, L1[2], L1[0] / TILE, L1[2] / TILE, lift),
        tC: tarmac.v(C[0], C[1] + lift, C[2], C[0] / TILE, C[2] / TILE, lift),
        tR: tarmac.v(R1[0], R1[1] + lift, R1[2], R1[0] / TILE, R1[2] / TILE, lift),
      };
      if (prev) {
        verge.quad(prev.vL2, prev.vL1, cur.vL2, cur.vL1);
        verge.quad(prev.vR1, prev.vR2, cur.vR1, cur.vR2);
        tarmac.quad(prev.tL, prev.tC, cur.tL, cur.tC);
        tarmac.quad(prev.tC, prev.tR, cur.tC, cur.tR);
      }
      prev = cur;
    }

    /* ---- white edge lines, both sides, continuous ---- */
    const lineLift = lift + 0.015;
    for (const side of [-1, 1]) {
      let last = null;
      for (let i = 0; i < st.length; i++) {
        const q = st[i];
        if (q.skip || q.other) {
          last = null;
          continue;
        }
        const o0 = side * (P - 0.55);
        const o1 = side * (P - 0.35);
        const a = [q.x + q.rx * Math.min(o0, o1), q.z + q.rz * Math.min(o0, o1)];
        const b = [q.x + q.rx * Math.max(o0, o1), q.z + q.rz * Math.max(o0, o1)];
        const cur = {
          a: white.v(a[0], groundY(a[0], a[1]) + lineLift, a[1], 0, q.s, lineLift),
          b: white.v(b[0], groundY(b[0], b[1]) + lineLift, b[1], 1, q.s, lineLift),
        };
        if (last) {
          white.quad(last.a, last.b, cur.a, cur.b);
          edgeM += q.s - last.s;
        }
        last = { ...cur, s: q.s };
      }
    }

    /* ---- the dashed yellow centre line: 3 m of paint, 6 m of gap ---- */
    const DASH = 3;
    const GAP = 6;
    const pointAt = (sAlong) => {
      // Stations are in order and close together; a walk from the last hit
      // is linear over the whole road.
      while (pointAt.i < st.length - 2 && st[pointAt.i + 1].s < sAlong) pointAt.i++;
      const a = st[pointAt.i];
      const b = st[Math.min(pointAt.i + 1, st.length - 1)];
      const f = b.s > a.s ? Math.min(1, Math.max(0, (sAlong - a.s) / (b.s - a.s))) : 0;
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, rx: a.rx + (b.rx - a.rx) * f, rz: a.rz + (b.rz - a.rz) * f, bad: a.skip || a.other || b.skip || b.other };
    };
    pointAt.i = 0;
    const total = st[st.length - 1].s;
    for (let s0 = GAP * 0.5; s0 + DASH < total; s0 += DASH + GAP) {
      const a = pointAt(s0);
      const b = pointAt(s0 + DASH);
      if (a.bad || b.bad) continue;
      const w = 0.12;
      const quadOf = (q) => {
        const l = [q.x - q.rx * w, q.z - q.rz * w];
        const r = [q.x + q.rx * w, q.z + q.rz * w];
        return [
          yellow.v(l[0], groundY(l[0], l[1]) + lineLift, l[1], 0, 0, lineLift),
          yellow.v(r[0], groundY(r[0], r[1]) + lineLift, r[1], 1, 0, lineLift),
        ];
      };
      const A = quadOf(a);
      const B = quadOf(b);
      yellow.quad(A[0], A[1], B[0], B[1]);
      centreM += DASH;
    }
  }

  /* ---- round pads at every junction and every road end ---- */
  const SEG = 20;
  for (const j of joins) {
    if (airfield(j.x, j.z)) continue;
    const r = P + 0.6;
    const c = tarmac.v(j.x, groundY(j.x, j.z) + lift + 0.004, j.z, j.x / TILE, j.z / TILE, lift + 0.004);
    const ring = [];
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      const x = j.x + Math.cos(a) * r;
      const z = j.z + Math.sin(a) * r;
      ring.push(tarmac.v(x, groundY(x, z) + lift + 0.004, z, x / TILE, z / TILE, lift + 0.004));
    }
    for (let i = 0; i < SEG; i++) tarmac.idx.push(c, ring[(i + 1) % SEG], ring[i]);
  }

  /* ---- one geometry, four groups ---- */
  const parts = [verge, tarmac, white, yellow];
  const pos = [];
  const uv = [];
  const sink = [];
  const outer = [];
  const idx = [];
  const geo = new THREE.BufferGeometry();
  let base = 0;
  let start = 0;
  parts.forEach((part, mi) => {
    for (const v of part.pos) pos.push(v);
    for (const v of part.uv) uv.push(v);
    for (const v of part.sink) sink.push(v);
    for (const v of part.outer) outer.push(v);
    for (const v of part.idx) idx.push(v + base);
    geo.addGroup(start, part.idx.length, mi);
    start += part.idx.length;
    base += part.n;
  });
  const sinkArr = Float32Array.from(sink);
  const outerArr = Uint8Array.from(outer);
  unhide(pos, idx, sinkArr, drawnY);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();

  const T = roadTextures(THREE);
  const common = { roughness: 0.92, metalness: 0.0, polygonOffset: true };
  const vergeMat = new THREE.MeshStandardMaterial({
    ...common,
    map: T.verge,
    color: T.verge ? 0xffffff : 0x8f8468,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
  vergeMat.userData.verge = true;
  const tarmacMat = new THREE.MeshStandardMaterial({
    ...common,
    map: T.asphalt || tex,
    normalMap: nrm,
    normalScale: nrm ? new THREE.Vector2(0.35, 0.35) : undefined,
    color: T.asphalt || tex ? 0xffffff : 0x55585d,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  const paint = (hex) => {
    const m = new THREE.MeshStandardMaterial({
      color: hex,
      roughness: 0.75,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -8,
    });
    m.userData.paint = true;
    return m;
  };
  const mesh = new THREE.Mesh(geo, [vergeMat, tarmacMat, paint(0xeceae2), paint(0xf2c230)]);
  mesh.name = 'roads';
  mesh.receiveShadow = true;
  mesh.userData.markings = { edge: Math.round(edgeM), centre: Math.round(centreM) };
  // The tarmac's lift over the ground it is laid on, for ribbonSampler.
  mesh.userData.lift = lift;
  mesh.userData.junctions = joins.length;

  /*
   * Put it exactly on the mesh that was actually built.
   *
   * At build time the level of detail is a guess (the high-detail mesh). The
   * car calls this once it is on the island, with the terrain group in hand,
   * and every vertex is moved onto the triangle the GPU is really drawing —
   * read straight out of the chunk geometry — or, for the road itself, onto
   * the corridor's own level where that is higher (see the note above).
   */
  mesh.userData.conform = (terrainGroup) => {
    if (!terrainGroup || mesh.userData.conformedTo === terrainGroup.uuid) return false;
    const exact = terrainMeshSampler(terrainGroup);
    if (!exact) return false;
    const at = geo.attributes.position;
    const a = at.array;
    const drawnHere = (x, z) => {
      const m = exact(x, z);
      return m === -Infinity ? Math.max(heightAt(x, z), 0) : Math.max(m, 0);
    };
    for (let i = 0; i < at.count; i++) {
      const x = a[i * 3];
      const z = a[i * 3 + 2];
      const d = drawnHere(x, z);
      a[i * 3 + 1] = (outerArr[i] ? d : Math.max(d, heightAt(x, z))) + sinkArr[i];
    }
    unhide(a, geo.index.array, sinkArr, drawnHere);
    at.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    mesh.userData.conformedTo = terrainGroup.uuid;
    return true;
  };
  return mesh;
}

/**
 * What the tyres are on. Injected into surface.js via setTerrainProbes, which
 * is how the car learns about roads without vehicles/ importing world/.
 *
 * It answers from the width that is DRAWN (PAVED_HALF), not from the 18 m
 * corridor — see the note over PAVED_HALF. It returns the same two frozen
 * objects every time rather than a new one per call, because it is called
 * every frame.
 */
export function roadSurfaceProbe(roads) {
  return (x, z) => {
    const k = pavedAt(roads, x, z);
    return k === 'tarmac' ? TARMAC : k === 'gravel' ? GRAVEL : null;
  };
}

/**
 * Scenery that was planted on the tarmac, taken off it.
 *
 * The roads are laid before the scenery is scattered — they have to be, the
 * scatter reads the height field the corridor cut — and nothing in the
 * scatter knows where the tarmac is. Measured on Drover's Flat: twenty solid
 * things standing within the drawn road, eighteen of them trees and one a
 * house in the middle of the road into Drover. A child following the arrow
 * drove into the first of them and the van stopped dead, over and over.
 *
 * This takes those out of the collision list and scales their instances to
 * nothing. It leaves the airfield alone (that is the airfield's ground and
 * its buildings are meant to be there), and it runs once per world.
 */
export function clearRoadsOfScenery(THREE, group, roads) {
  if (!group || !roads || !roads.length) return 0;
  if (group.userData._roadsClearedFor === roads) return 0;
  group.userData._roadsClearedFor = roads;
  const reach = PAVED_HALF + VERGE;
  const gone = [];
  for (let i = OBSTACLES.length - 1; i >= 0; i--) {
    const o = OBSTACLES[i];
    const cx = (o.x0 + o.x1) / 2;
    const cz = (o.z0 + o.z1) / 2;
    if (padWeight(cx, cz) > 0.3) continue;
    const r = Math.hypot(o.x1 - o.x0, o.z1 - o.z0) / 2;
    if (distanceToRoads(roads, cx, cz, reach + r + 1) > reach + r * 0.7) continue;
    gone.push({ x: cx, z: cz, r });
    OBSTACLES.splice(i, 1);
  }
  const m = new THREE.Matrix4();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  let hidden = 0;
  group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    let touched = false;
    for (let i = 0; i < o.count; i++) {
      o.getMatrixAt(i, m);
      const x = m.elements[12];
      const z = m.elements[14];
      if (padWeight(x, z) > 0.3) continue;
      let hit = gone.some((q) => Math.abs(q.x - x) < q.r + 1.5 && Math.abs(q.z - z) < q.r + 1.5);
      // Trees planted without a collision box (the pad trees) are still in
      // the road; anything whose trunk is on the tarmac goes.
      if (!hit && distanceToRoads(roads, x, z, reach + 1) <= reach) hit = true;
      if (!hit) continue;
      o.setMatrixAt(i, zero);
      touched = true;
      hidden++;
    }
    if (touched) {
      o.instanceMatrix.needsUpdate = true;
      if (o.computeBoundingSphere) o.computeBoundingSphere();
    }
  });
  return { obstacles: gone.length, instances: hidden };
}

/**
 * The highest drawn triangle over (x, z), out of a mesh's own triangles: a
 * bucket grid built once, then a few point-in-triangle tests a call.
 * (x, z) => the height there, or -Infinity where none of them is; after a
 * hit, `.tri` is the index-buffer offset of the triangle found. A triangle
 * folded to a point (clearRoadsOfFields) is not drawn and is not counted.
 * At equal heights the later triangle wins, as the renderer draws it over
 * the earlier one.
 *
 * It reads the triangles, not a layout: fieldPatchSampler assumed every
 * crop patch was 6 x 6 vertices, and features.js now cuts each field into
 * 4 to 12 quads a side to follow the ground (buildFields), so the sampler
 * was reading corners out of the wrong fields.
 */
function triangleSampler(pos, idx, start = 0, end = idx.length, cell = 8) {
  const cells = new Map();
  const key = (i, j) => (i + 32768) * 65536 + (j + 32768);
  for (let t = start; t + 2 < end; t += 3) {
    const ia = idx[t];
    const ib = idx[t + 1];
    const ic = idx[t + 2];
    if (ia === ib || ib === ic || ia === ic) continue;
    const a = ia * 3;
    const b = ib * 3;
    const c = ic * 3;
    const i0 = Math.floor(Math.min(pos[a], pos[b], pos[c]) / cell);
    const i1 = Math.floor(Math.max(pos[a], pos[b], pos[c]) / cell);
    const j0 = Math.floor(Math.min(pos[a + 2], pos[b + 2], pos[c + 2]) / cell);
    const j1 = Math.floor(Math.max(pos[a + 2], pos[b + 2], pos[c + 2]) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(t);
      }
    }
  }
  const f = (x, z) => {
    f.tri = -1;
    const list = cells.get(key(Math.floor(x / cell), Math.floor(z / cell)));
    if (!list) return -Infinity;
    let top = -Infinity;
    for (let n = 0; n < list.length; n++) {
      const t = list[n];
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      const ax = pos[a];
      const az = pos[a + 2];
      const e1x = pos[b] - ax;
      const e1z = pos[b + 2] - az;
      const e2x = pos[c] - ax;
      const e2z = pos[c + 2] - az;
      const den = e1x * e2z - e2x * e1z;
      if (Math.abs(den) < 1e-12) continue;
      const px = x - ax;
      const pz = z - az;
      const u = (px * e2z - e2x * pz) / den;
      const w = (e1x * pz - px * e1z) / den;
      if (u < -1e-7 || w < -1e-7 || u + w > 1 + 1e-7) continue;
      const y = pos[a + 1] + (pos[b + 1] - pos[a + 1]) * u + (pos[c + 1] - pos[a + 1]) * w;
      if (y >= top) {
        top = y;
        f.tri = t;
      }
    }
    return top;
  };
  f.tri = -1;
  return f;
}

/**
 * The crop patch drawn at (x, z), if any: (x, z) => its colour as
 * [r, g, b] (0-1, features.js's crop list times the patch's shade), or null
 * where no patch is drawn. Null when the group has no patchwork.
 *
 * For the word under the van's speed. The patches lie over the ground, so
 * where there is one it is what the child sees, whatever the terrain under
 * it is painted. Where two overlap, the one SEEN is the highest there (the
 * first one found was the wrong one at 164 of 558 spots round First Run's
 * yard, when fields were dropped at random and overlapped); where one is
 * folded away off a road (clearRoadsOfFields) it is not drawn and is not
 * counted. Read from the patchwork's triangles (triangleSampler), however
 * many each field is cut into. Built once per world.
 */
export function fieldPatchSampler(group) {
  if (!group) return null;
  let mesh = null;
  group.traverse((o) => {
    if (mesh || !o.isMesh || !o.geometry || !o.geometry.index) return;
    const m = o.material;
    // The patchwork, as clearRoadsOfFields knows it.
    if (m && m.vertexColors && m.polygonOffset && o.geometry.attributes.color) mesh = o;
  });
  if (!mesh) return null;
  const pos = mesh.geometry.attributes.position.array;
  const col = mesh.geometry.attributes.color.array;
  const idx = mesh.geometry.index.array;
  if (!idx.length) return null;
  const top = triangleSampler(pos, idx, 0, idx.length, 16);
  const out = [0, 0, 0];
  return (x, z) => {
    if (top(x, z) === -Infinity) return null;
    const found = idx[top.tri] * 3;
    out[0] = col[found];
    out[1] = col[found + 1];
    out[2] = col[found + 2];
    return out;
  };
}

/**
 * The tarmac as DRAWN: (x, z) => the height of the road ribbon's tarmac
 * (junction pads included) there, less the lift it is drawn with, or
 * -Infinity where there is no tarmac. Null without a ribbon.
 *
 * The ribbon is laid every RIBBON_STEP metres on the higher of heightAt and
 * the mesh, and then raised wherever the grass would come up through a
 * triangle of it (unhide). Between its stations, and wherever it was
 * raised, it is not where drawnGroundSampler's rule puts the ground, and the
 * van rode that rule: measured at the van's start on Drover's Flat once the
 * roads were laid over the runway-end safety areas, the drawn tarmac stood
 * 7-10 cm over the ground the wheels were on, the tyres 3.5 cm into it.
 * Read after conform (the ribbon on the mesh actually built).
 */
export function ribbonSampler(roadMesh) {
  const geo = roadMesh && roadMesh.geometry;
  if (!geo || !geo.index || !geo.groups || geo.groups.length < 2) return null;
  const g = geo.groups[1]; // verge, TARMAC, white, yellow (roadRibbon)
  const lift = (roadMesh.userData && roadMesh.userData.lift) || 0;
  const oy = roadMesh.position ? roadMesh.position.y : 0;
  const top = triangleSampler(geo.attributes.position.array, geo.index.array, g.start, g.start + g.count, 8);
  return (x, z) => {
    const y = top(x, z);
    return y === -Infinity ? y : y + oy - lift;
  };
}

/**
 * Farmland taken off the road.
 *
 * The crop patches (features.js) are 180-600 m squares cut into 5 x 5
 * quads, each corner 35 cm over heightAt, laid wherever the ground is
 * gentle — which is where the roads are. The road is 6 cm over the ground,
 * so a patch across it is drawn on top of it. Rendered from the chase camera
 * on First Run on Drover's Flat, 440 m out from Drover and again at the
 * drop: a beige field edge to edge, the van driving across it, and not a
 * pixel of tarmac in the frame.
 *
 * Features are not this file's to rebuild, so the patch triangles that
 * reach the drawn road (tarmac, verge and a metre) are folded away where
 * they are — the field ends at a strip of grass along the road, which is
 * what a field beside a road looks like. Once per world, like the trees.
 * Returns how many triangles went.
 */
export function clearRoadsOfFields(group, roads) {
  if (!group || !roads || !roads.length) return 0;
  if (group.userData._fieldsClearedFor === roads) return 0;
  group.userData._fieldsClearedFor = roads;
  const reach = PAVED_HALF + VERGE + 1;
  let gone = 0;
  group.traverse((o) => {
    if (!o.isMesh || !o.geometry || !o.geometry.index) return;
    const m = o.material;
    const g = o.geometry;
    // The patchwork: vertex-coloured, lying on the ground, offset towards
    // the camera. Nothing else in the features group is all three.
    if (!m || !m.vertexColors || !m.polygonOffset || !g.attributes.color) return;
    const pos = g.attributes.position.array;
    const idx = g.index.array;
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t] * 3;
      const b = idx[t + 1] * 3;
      const c = idx[t + 2] * 3;
      if (a === b && b === c) continue;
      if (triangleNearRoads(roads, pos[a], pos[a + 2], pos[b], pos[b + 2], pos[c], pos[c + 2], reach)) {
        idx[t + 1] = idx[t];
        idx[t + 2] = idx[t];
        gone++;
      }
    }
    if (gone) {
      g.index.needsUpdate = true;
      g.computeBoundingSphere();
    }
  });
  return gone;
}

/** Does a flat triangle come within `reach` of any road's centreline? */
function triangleNearRoads(roads, ax, az, bx, bz, cx, cz, reach) {
  const x0 = Math.min(ax, bx, cx) - reach;
  const x1 = Math.max(ax, bx, cx) + reach;
  const z0 = Math.min(az, bz, cz) - reach;
  const z1 = Math.max(az, bz, cz) + reach;
  const r2 = reach * reach;
  const side = (px, pz, qx, qz, rx, rz) => (qx - px) * (rz - pz) - (qz - pz) * (rx - px);
  const inside = (px, pz) => {
    const d1 = side(ax, az, bx, bz, px, pz);
    const d2 = side(bx, bz, cx, cz, px, pz);
    const d3 = side(cx, cz, ax, az, px, pz);
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  for (const rd of roads) {
    const bb = boxOf(rd);
    if (bb.x1 < x0 || bb.x0 > x1 || bb.z1 < z0 || bb.z0 > z1) continue;
    const p = rd.path;
    for (let k = 1; k < p.length; k++) {
      const px = p[k - 1][0];
      const pz = p[k - 1][1];
      const qx = p[k][0];
      const qz = p[k][1];
      if (Math.max(px, qx) < x0 || Math.min(px, qx) > x1 || Math.max(pz, qz) < z0 || Math.min(pz, qz) > z1) continue;
      // The road through the patch, or ending in it...
      if (inside(px, pz) || inside(qx, qz)) return true;
      // ...or passing within reach of one of its edges (which also catches
      // a road crossing it: a crossing comes within zero of two edges).
      if (segDist2(px, pz, qx, qz, ax, az, bx, bz) < r2) return true;
      if (segDist2(px, pz, qx, qz, bx, bz, cx, cz) < r2) return true;
      if (segDist2(px, pz, qx, qz, cx, cz, ax, az) < r2) return true;
    }
  }
  return false;
}

/** Squared distance between two segments in the ground plane. */
function segDist2(ax, az, bx, bz, cx, cz, dx, dz) {
  const cross = (ux, uz, vx, vz) => ux * vz - uz * vx;
  const rx = bx - ax;
  const rz = bz - az;
  const sx = dx - cx;
  const sz = dz - cz;
  const den = cross(rx, rz, sx, sz);
  if (Math.abs(den) > 1e-9) {
    const t = cross(cx - ax, cz - az, sx, sz) / den;
    const u = cross(cx - ax, cz - az, rx, rz) / den;
    if (t >= 0 && t <= 1 && u >= 0 && u <= 1) return 0;
  }
  const pt = (px, pz, qx, qz, wx, wz) => {
    const ex = wx - qx;
    const ez = wz - qz;
    const l2 = ex * ex + ez * ez;
    let t = l2 > 0 ? ((px - qx) * ex + (pz - qz) * ez) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const hx = qx + ex * t - px;
    const hz = qz + ez * t - pz;
    return hx * hx + hz * hz;
  };
  return Math.min(pt(ax, az, cx, cz, dx, dz), pt(bx, bz, cx, cz, dx, dz), pt(cx, cz, ax, az, bx, bz), pt(dx, dz, ax, az, bx, bz));
}

/**
 * The nearest point on the network, and the way the road runs there.
 *
 * A van put down at an address that is not on a road starts on grass, doing
 * 40 km/h, wondering why. The depot on a map that authored its own network but
 * named no places falls back to the airfield apron, which is exactly such a
 * spot. Snapping is better than moving the address: the address is where the
 * job is, and the van simply parks on the road outside it.
 */
export function nearestRoadPoint(roads, x, z) {
  if (!roads || !roads.length) return null;
  let best = Infinity;
  let out = null;
  for (const rd of roads) {
    const p = rd.path;
    for (let k = 1; k < p.length; k++) {
      const ax = p[k - 1][0];
      const az = p[k - 1][1];
      const ex = p[k][0] - ax;
      const ez = p[k][1] - az;
      const l2 = ex * ex + ez * ez;
      let t = l2 > 0 ? ((x - ax) * ex + (z - az) * ez) / l2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + ex * t;
      const qz = az + ez * t;
      const d2 = (qx - x) * (qx - x) + (qz - z) * (qz - z);
      if (d2 < best) {
        best = d2;
        out = {
          x: qx,
          z: qz,
          y: (p[k - 1][2] ?? 0) + ((p[k][2] ?? 0) - (p[k - 1][2] ?? 0)) * t,
          // Along the road, so the van is parked facing the way it will drive.
          headingDeg: (Math.atan2(ex, -ez) * 180) / Math.PI,
          dist: Math.sqrt(d2),
        };
      }
    }
  }
  return out;
}

/**
 * A car island's authored network, fitted: brought down to its airfield
 * (meetThePad), and levelled where two of its roads meet, the way the
 * router's own networks are (levelOverlaps). An authored junction is two
 * paths written by hand and nothing made them agree: on Redrock Flats the
 * spur starts [0, -900, 30.1] on a main road that is 28.05 m there, so
 * where roadHeight hands over from one corridor to the other the ground
 * stepped 2 m at (0, -874), and the arrow driver took the Shuttle down it
 * at 33 km/h with the body 0.91 m over the road. Returns how many points
 * each held at a new height (as loaded: Airfield Perimeter 57 to its pad,
 * Town 5 and Redrock Flats 1 at a junction, the rest none); a second call
 * holds none.
 */
export function fitCarNetwork(m) {
  const out = { pad: meetThePad(m), level: 0 };
  const w = m && m.waters;
  if (!w || !w.roads || w.roads.length < 2 || w._generated) return out;
  const air = m.airport;
  out.level = levelOverlaps(w.roads, air && air.pad && Number.isFinite(air.elev)
    ? { weight: (x, z) => padWeightOf(air, x, z), elev: air.elev }
    : null);
  return out;
}

/*
 * The car's islands, fitted once as this module loads — before any of them
 * is built, so an island is the same whichever way it is reached. Only the
 * car's: the flight maps' authored roads are left exactly as the aeroplane
 * has always known them.
 */
for (const m of MAPS) {
  if (m.game === 'car') fitCarNetwork(m);
}

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

import { heightAt, padWeight, AIRPORT } from './terrain.js';

/** Metres between profile samples. Three of these is about one terrain quad. */
const STEP = 55;
/** The steepest a finished road may be. 8% is a hard but drivable hill. */
const MAX_GRADE = 0.08;

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
  const halfWidth = opts.halfWidth || 13;
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
  const path = [];
  for (let i = 0; i <= n; i++) path.push([Math.round(xs[i]), Math.round(zs[i]), +ys[i].toFixed(2)]);
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
/** Steeper than this is not a road at any price. */
const HARD_MAX = 0.3;
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
export function roadGrid(mapDef) {
  const b = mapBounds(mapDef);
  const nx = Math.max(4, Math.ceil((b.x1 - b.x0) / CELL));
  const nz = Math.max(4, Math.ceil((b.z1 - b.z0) / CELL));
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      h[j * nx + i] = heightAt(b.x0 + i * CELL, b.z0 + j * CELL);
    }
  }
  return { ...b, nx, nz, h, cell: CELL };
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
export function routeBetween(g, a, b) {
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
      const hv = g.h[v];
      // A road does not go into the sea, and it does not start in it either.
      if (hv < 1 && v !== goal && v !== start) continue;
      const len = g.cell * (dx && dz ? Math.SQRT2 : 1);
      const grade = Math.abs(hv - hu) / len;
      if (grade > HARD_MAX) continue;
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
  return simplify(pts, g.cell * 0.7);
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
export function buildRoads(mapDef, { maxFill = 30, maxCut = 45, quiet = true } = {}) {
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
    const via = routeBetween(grid, a, b);
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
    if (r.fill > maxFill || r.cut > maxCut) {
      notes.push(
        `${a.name} – ${b.name}: refused, ` +
          (r.fill > maxFill ? `${r.fill.toFixed(0)} m embankment` : `${r.cut.toFixed(0)} m cutting`)
      );
      refused.add(best.i + ':' + best.j);
      continue;
    }
    {
      roads.push(r.road);
      if (!quiet) {
        notes.push(
          `${a.name} – ${b.name}: ${(r.len / 1000).toFixed(2)} km, ` +
            `${(r.worst * 100).toFixed(1)}% max, cut ${r.cut.toFixed(0)} m, fill ${r.fill.toFixed(0)} m`
        );
      }
    }
    inTree.push(best.j);
    out.splice(out.indexOf(best.j), 1);
  }
  return { roads, notes };
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
    const w = (rd.halfWidth || 13) + margin;
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
 * Drawing it.
 *
 * The corridor makes the ground flat; this is the tarmac on top of it. They
 * are separate on purpose: the flat ground is what the car drives on and what
 * makes the grade true, and the ribbon is what makes it look like a road. A
 * ribbon without the corridor floats over every rise between two terrain
 * vertices, which is the thing that made the first attempt unusable.
 *
 * One mesh for the whole network, because thirty draw calls for a road is
 * thirty draw calls a school Chromebook does not have. Verges are the same
 * strip widened and pushed down a few centimetres, which reads as a shoulder
 * and costs nothing.
 * ==================================================================== */

/**
 * @param {Array} roads the network from buildRoads
 * @param {number} lift metres above the corridor, to beat z-fighting
 */
export function roadRibbon(THREE, roads, { lift = 0.08, tex = null, nrm = null } = {}) {
  if (!roads || !roads.length) return null;
  const pos = [];
  const uv = [];
  const idx = [];
  let base = 0;
  for (const rd of roads) {
    const p = rd.path;
    const w = (rd.halfWidth || 13) * 0.62; // the tarmac, not the whole corridor
    let run = 0;
    for (let k = 0; k < p.length; k++) {
      // The direction here is the average of the two segments that meet at this
      // point, so the strip mitres round a corner instead of pinching.
      const a = p[Math.max(0, k - 1)];
      const b = p[Math.min(p.length - 1, k + 1)];
      let dx = b[0] - a[0];
      let dz = b[1] - a[1];
      const l = Math.hypot(dx, dz) || 1;
      dx /= l;
      dz /= l;
      const nx = -dz;
      const nz = dx;
      pos.push(p[k][0] - nx * w, p[k][2] + lift, p[k][1] - nz * w);
      pos.push(p[k][0] + nx * w, p[k][2] + lift, p[k][1] + nz * w);
      uv.push(0, run / 14, 1, run / 14);
      if (k) {
        run += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
        const i = base + (k - 1) * 2;
        idx.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
      }
    }
    base += p.length * 2;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    map: tex,
    normalMap: nrm,
    normalScale: nrm ? new THREE.Vector2(0.5, 0.5) : undefined,
    color: tex ? 0xffffff : 0x4a4a4c,
    roughness: 0.93,
    metalness: 0.02,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'roads';
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * What the tyres are on. Injected into surface.js via setTerrainProbes, which
 * is how the car learns about roads without vehicles/ importing world/.
 */
export function roadSurfaceProbe(roads) {
  return (x, z) => (onRoad(roads, x, z) ? { kind: 'tarmac' } : null);
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

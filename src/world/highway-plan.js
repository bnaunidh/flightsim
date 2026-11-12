/**
 * Highways, as a plan: the dual carriageways a map has, what stands on them (the central
 * barrier, the lane lines), and the FLYOVER each one gets.
 *
 * The World Map's highways were two country roads side by side: two 10 m strips 18 m apart
 * with grass between, no lane lines and nothing to say which way either ran (the owner:
 * "please add actual highways, and elevated highways etc"). A link is now read as what it
 * is — a pair of one-way carriageways about one centre line — and given:
 *
 *   LANES     two a carriageway, a dashed white line between them (the look draws it);
 *   A BARRIER a concrete wall down the middle of the median, end to end, broken only
 *             where a river's two bridge decks leave a gap and where the flyover stands;
 *   A FLYOVER one a link, where the road is straightest and clear of towns, bridges and
 *             every runway's approach: the through lane each way leaves the inner lane,
 *             moves into the median, and climbs between retaining walls on to a deck on
 *             single piers, FLY_H metres up, over a local road that crosses underneath;
 *             the carriageways themselves carry on at ground level either side, which is
 *             what a slip road is: off before the ramp, on after it.
 *
 * Nothing here changes the ground (the carriageways' corridors are level 18 m either side
 * of the centre: the median was always flat). Pure: numbers in, numbers out, no meshes
 * and no imports — features/street-life.js gives it the map's roads and heightAt and
 * hands the answer to the look (features/streetlife/highway-look.js), to the cars
 * (features/ambient.js extend) and to the crash boxes; node plans it in
 * tests/features/highway.mjs.
 */

/** Metres: the deck's surface over the ground at the top. */
export const FLY_H = 8.2;
/** The climb, the level top, and the stretch either end where the lane moves across into the median. */
export const FLY_RAMP = 165;
export const FLY_TOP = 120;
export const FLY_SHIFT = 75;
/** Half the deck (one lane each way, a barrier between, a parapet each side). */
export const DECK_HALF = 5;
/** A flyover lane's centre from the centre line, on the deck. */
export const DECK_LANE = 2.4;
/** A carriageway's lanes from its own centre line (roads.js PAVED_HALF / 2). */
export const LANE_OFF = 2.5;
/** Under this much lift the ramp is solid between its walls; over it the deck stands on piers. */
export const WALL_TO = 3.6;
export const PIER_EVERY = 26;
/** The local road under the top: this far out from the centre line either side. */
export const CROSS_OUT = 95;
export const CROSS_HALF = 3.6;
const STEP = 5;
const FLY_LEN = 2 * FLY_SHIFT + 2 * FLY_RAMP + FLY_TOP;

const baseName = (n) => String(n || '').replace(/\s*\((east|west|north|south)bound\)\s*$/i, '');

/** A polyline of [x, z, y] every `step` metres (its own points kept out: an even walk). */
function resample(path, step) {
  const out = [];
  let carry = 0;
  for (let k = 1; k < path.length; k++) {
    const a = path[k - 1];
    const b = path[k];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    let d = carry;
    for (; d <= L; d += step) {
      const t = d / L;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t]);
    }
    carry = d - L;
  }
  return out;
}

/** The point of `path` nearest (x, z): [x, z, y, distance]. `hint` is where to start looking (paths are walked in order). */
function nearestOn(path, x, z, hint) {
  let best = Infinity;
  let bx = 0;
  let bz = 0;
  let by = 0;
  let bk = hint.k;
  const from = Math.max(1, hint.k - 3);
  const to = Math.min(path.length - 1, hint.k + 6);
  for (let k = from; k <= to; k++) {
    const a = path[k - 1];
    const b = path[k];
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const l2 = dx * dx + dz * dz;
    let t = l2 > 0 ? ((x - a[0]) * dx + (z - a[1]) * dz) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const px = a[0] + dx * t;
    const pz = a[1] + dz * t;
    const d = (px - x) ** 2 + (pz - z) ** 2;
    if (d < best) {
      best = d;
      bx = px;
      bz = pz;
      by = (a[2] || 0) + ((b[2] || 0) - (a[2] || 0)) * t;
      bk = k;
    }
  }
  hint.k = bk;
  return [bx, bz, by, Math.sqrt(best)];
}

/**
 * The dual carriageways among `roads`: each pair of 'highway' roads with one name, as one
 * link with stations every STEP metres along its centre line. A station:
 * { x, z, y (the ground there), s, tx, tz (the way the first carriageway runs), nx, nz
 * (across, from the first carriageway to the second), half (centre line to a carriageway's
 * own), gap (true where the ground between the two falls away: a river under two decks) }.
 */
export function highwayLinks(roads, heightAt = null) {
  const by = new Map();
  for (const r of roads || []) {
    if (!r || r.kind !== 'highway' || !r.path || r.path.length < 2) continue;
    const n = baseName(r.name);
    if (!by.has(n)) by.set(n, []);
    by.get(n).push(r);
  }
  const links = [];
  for (const [name, pair] of by) {
    if (pair.length !== 2) continue;
    const A = resample(pair[0].path, STEP);
    const B = pair[1].path.slice().reverse();
    const hint = { k: 1 };
    const st = [];
    let s = 0;
    for (let i = 0; i < A.length; i++) {
      const a = A[i];
      const q = nearestOn(B, a[0], a[1], hint);
      const d = q[3];
      if (!(d > 4 && d < 40)) continue;
      const x = (a[0] + q[0]) / 2;
      const z = (a[1] + q[1]) / 2;
      if (st.length) s += Math.hypot(x - st[st.length - 1].x, z - st[st.length - 1].z);
      const road = (a[2] + q[2]) / 2;
      const g = heightAt ? heightAt(x, z) : road;
      st.push({ x, z, y: g, road, s, tx: 0, tz: 0, nx: (q[0] - a[0]) / d, nz: (q[1] - a[1]) / d, half: d / 2, gap: g < road - 1.5 });
    }
    if (st.length < 20) continue;
    for (let i = 0; i < st.length; i++) {
      const p = st[Math.max(0, i - 1)];
      const n = st[Math.min(st.length - 1, i + 1)];
      const L = Math.hypot(n.x - p.x, n.z - p.z) || 1;
      st[i].tx = (n.x - p.x) / L;
      st[i].tz = (n.z - p.z) / L;
    }
    links.push({ name, roads: pair.map((r) => r.name), stations: st, length: s, flyover: null });
  }
  return links;
}

/** The station of a link at distance s (clamped), blended between its neighbours. */
export function stationAt(link, s, out = {}) {
  const st = link.stations;
  let lo = 0;
  let hi = st.length - 1;
  if (s <= st[0].s) lo = hi = 0;
  else if (s >= st[hi].s) lo = hi;
  else {
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (st[m].s <= s) lo = m;
      else hi = m;
    }
  }
  const a = st[lo];
  const b = st[hi];
  const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  for (const k of ['x', 'z', 'y', 'tx', 'tz', 'nx', 'nz', 'half']) out[k] = a[k] + (b[k] - a[k]) * t;
  out.s = s;
  out.gap = a.gap || b.gap;
  return out;
}

const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u));
const smooth = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

/** How far the flyover's deck stands over the ground, `d` metres from its start (0 before the ramp and after it). */
export function liftAt(d) {
  const up = d - FLY_SHIFT;
  const down = FLY_LEN - FLY_SHIFT - d;
  return FLY_H * Math.min(ease(up / FLY_RAMP), ease(down / FLY_RAMP));
}

/** A flyover lane's distance from the centre line, `d` metres from the flyover's start: from the inner lane to the deck's and back. */
export function laneShiftAt(d, half) {
  const inner = half - LANE_OFF;
  const u = Math.min(smooth(d / FLY_SHIFT), smooth((FLY_LEN - d) / FLY_SHIFT));
  return inner + (DECK_LANE - inner) * u;
}

/**
 * How far the local road under a flyover runs either side of the centre line at station `m`:
 * to CROSS_OUT, or to where the ground leaves the level by more than a road climbs (8%), or the
 * sea. Never short of the carriageway's far verge. [out on the -n side, out on the +n side].
 */
export function crossReach(m, heightAt = null) {
  const least = m.half + 5 + 6;
  if (!heightAt) return [CROSS_OUT, CROSS_OUT];
  const out = [least, least];
  for (let k = 0; k < 2; k++) {
    const sign = k ? 1 : -1;
    let last = heightAt(m.x + m.nx * (least - 5) * sign, m.z + m.nz * (least - 5) * sign);
    for (let o = least; o <= CROSS_OUT + 1e-6; o += 5) {
      const h = heightAt(m.x + m.nx * o * sign, m.z + m.nz * o * sign);
      if (h < 1 || Math.abs(h - last) > 0.45) break;
      last = h;
      out[k] = Math.min(CROSS_OUT, o);
    }
  }
  return out;
}

/**
 * Where on a link its flyover goes: the straightest FLY_LEN metres that are well clear of the
 * link's ends, of every town, of a bridge, and of every runway's approach. Null if nowhere is.
 * `ctx`: { towns: [{ cx, cz, radius }], airports: [{ x, z, length }] (runways lie east-west) }.
 */
export function siteFlyover(link, ctx = {}) {
  const st = link.stations;
  const END = 380;
  const towns = ctx.towns || [];
  const airports = ctx.airports || [];
  const bad = (p) => {
    if (p.gap || p.half < 7.5 || p.half > 11) return true;
    for (const t of towns) if (Math.hypot(p.x - t.cx, p.z - t.cz) < (t.radius || 400) + 160) return true;
    for (const a of airports) {
      const L = (a.length || 1000) / 2;
      if (Math.abs(p.x - a.x) < L + 3000 && Math.abs(p.z - a.z) < 450) return true;
      if (Math.hypot(p.x - a.x, p.z - a.z) < L + 700) return true;
    }
    return false;
  };
  let best = null;
  const n = Math.round(FLY_LEN / STEP);
  for (let i0 = Math.ceil(END / STEP); i0 + n < st.length - Math.ceil(END / STEP); i0 += 8) {
    let ok = true;
    let bend = 0;
    let worst = 0;
    for (let i = i0; ok && i <= i0 + n; i += 2) {
      if (bad(st[i])) ok = false;
      if (i >= i0 + 6) {
        const a = st[i - 6];
        const b = st[i];
        const turn = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
        bend += turn;
        if (turn > worst) worst = turn;
      }
    }
    if (!ok) continue;
    const a = st[i0];
    const b = st[i0 + n];
    const grade = Math.abs(b.y - a.y) / FLY_LEN;
    const whole = Math.abs(Math.atan2(a.tx * b.tz - a.tz * b.tx, a.tx * b.tx + a.tz * b.tz));
    // (Gaps in the ground beside it — a bridge 150 m on — rule a site out as surely as one under it.)
    if (st[Math.max(0, i0 - 30)].gap || st[Math.min(st.length - 1, i0 + n + 30)].gap) continue;
    if (worst > 0.09 || whole > 0.3 || grade > 0.035) continue;
    // The local road's ground, out to its ends: no steeper than a road climbs, and not the sea.
    const m = st[i0 + (n >> 1)];
    // (It stops where the ground would have it climb a bank: a site where it can run its length is the better one.)
    const reach = crossReach(m, ctx.heightAt || null);
    const score = bend + grade * 4 + Math.abs(i0 + n / 2 - st.length / 2) / st.length * 0.4 + (2 * CROSS_OUT - reach[0] - reach[1]) / CROSS_OUT * 0.25;
    if (!best || score < best.score) best = { i0, score, mid: m };
  }
  if (!best) return null;
  return { s0: st[best.i0].s, s1: st[best.i0].s + FLY_LEN, length: FLY_LEN };
}

/**
 * Everything a flyover is, from a link and where on it: its deck's centre line (`deck`:
 * { x, z, tx, tz, nx, nz, ground, y (the surface), lift, d } every STEP metres), its piers
 * ({ x, z, ground, top, ry }), the lane each way (`lanes`: [{ pts: [[x, z, y]], meta }], in the
 * order driven), the local road underneath (`cross`: [[x, z, y]] from one end to the other),
 * and the boxes an aeroplane can hit (`solids`: { x0, x1, z0, z1, y0, y1, what }).
 */
export function buildFlyover(link, site, heightAt = null, lift = 0.25) {
  const deck = [];
  const P = {};
  for (let d = 0; d <= site.length + 1e-6; d += STEP) {
    stationAt(link, site.s0 + d, P);
    const L = liftAt(d);
    deck.push({ x: P.x, z: P.z, tx: P.tx, tz: P.tz, nx: P.nx, nz: P.nz, half: P.half, ground: P.y, lift: L, y: P.y + lift + L, d });
  }
  // Piers where the deck is clear of its walls, evenly between the two wall ends.
  const open = deck.filter((p) => p.lift > WALL_TO);
  const piers = [];
  if (open.length > 2) {
    const d0 = open[0].d;
    const d1 = open[open.length - 1].d;
    const n = Math.max(2, Math.round((d1 - d0) / PIER_EVERY));
    const mid = site.length / 2;
    for (let k = 0; k <= n; k++) {
      const d = d0 + ((d1 - d0) * k) / n;
      // None in the local road: the pair either side of it stand at its kerbs.
      if (Math.abs(d - mid) < CROSS_HALF + 1.6) continue;
      const p = deck[Math.round(d / STEP)];
      piers.push({ x: p.x, z: p.z, ground: p.ground, top: p.y - 1.25, ry: Math.atan2(-p.tz, p.tx), d });
    }
  }
  // The lanes: out of the inner lane, across to the deck, over, and back.
  const lanes = [];
  for (const dir of [1, -1]) {
    const pts = [];
    for (let i = 0; i < deck.length; i += 2) {
      const p = deck[dir > 0 ? i : deck.length - 1 - i];
      // The first carriageway is on the -n side and runs with the stations; the second on +n, against them.
      const o = -dir * laneShiftAt(p.d, p.half);
      pts.push([p.x + p.nx * o, p.z + p.nz * o, p.y + 0.02]);
    }
    lanes.push({ pts, meta: { kind: 'road', name: `${link.name} flyover`, fast: 1.55, take: 0.62, from: 1, hw: 2, flyover: true } });
  }
  // The local road under the top, square across, on the ground as it lies.
  const m = deck[Math.round(site.length / 2 / STEP)];
  const cross = [];
  const reach = crossReach({ x: m.x, z: m.z, nx: m.nx, nz: m.nz, half: m.half, y: m.ground }, heightAt);
  for (let o = -reach[0]; o <= reach[1] + 1e-6; o += 5) {
    const x = m.x + m.nx * o;
    const z = m.z + m.nz * o;
    cross.push([x, z, (heightAt ? heightAt(x, z) : m.ground) + lift]);
  }
  // What an aeroplane hits: the solid ramps whole, the deck as a slab with air under it, the piers.
  const solids = [];
  const what = 'You flew into the flyover';
  for (let i = 0; i < deck.length; i += 2) {
    const p = deck[i];
    if (p.lift < 0.5) continue;
    const r = DECK_HALF + 1;
    solids.push({ x0: p.x - r, x1: p.x + r, z0: p.z - r, z1: p.z + r, y0: p.lift > WALL_TO ? p.y - 1.5 : p.ground - 1, y1: p.y + 1.15, what });
  }
  for (const p of piers) solids.push({ x0: p.x - 1.6, x1: p.x + 1.6, z0: p.z - 1.6, z1: p.z + 1.6, y0: p.ground - 1, y1: p.top + 0.2, what });
  return { name: `${link.name} flyover`, link: link.name, s0: site.s0, s1: site.s1, deck, piers, lanes, cross, solids, mid: { x: m.x, z: m.z, y: m.y }, clearance: FLY_H - 1.25 };
}

/**
 * The whole plan for a map's roads. `ctx`: { heightAt, towns, airports, lift } (lift: the
 * tarmac's height over the ground it is laid on, roads.js's own for this map).
 */
export function planHighways(roads, ctx = {}) {
  const links = highwayLinks(roads, ctx.heightAt || null);
  const flyovers = [];
  for (const link of links) {
    const site = siteFlyover(link, ctx);
    if (!site) continue;
    link.flyover = buildFlyover(link, site, ctx.heightAt || null, ctx.lift ?? 0.25);
    flyovers.push(link.flyover);
  }
  return { links, flyovers };
}

/**
 * Where a link's central barrier runs: runs of stations [[i0, i1]…], leaving out the ends
 * (the roundabouts), the gaps (two bridge decks over a river) and the flyover's footprint.
 */
export function barrierRuns(link, endClear = 45) {
  const st = link.stations;
  const runs = [];
  let start = -1;
  const f = link.flyover;
  for (let i = 0; i < st.length; i++) {
    const p = st[i];
    const on = p.s > endClear && p.s < link.length - endClear && !p.gap && p.half > 6.5 && !(f && p.s > f.s0 - 6 && p.s < f.s1 + 6);
    if (on && start < 0) start = i;
    if (!on && start >= 0) {
      if (i - 1 - start > 3) runs.push([start, i - 1]);
      start = -1;
    }
  }
  if (start >= 0 && st.length - 1 - start > 3) runs.push([start, st.length - 1]);
  return runs;
}

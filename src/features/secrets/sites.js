/**
 * Finding the ground for a hiding place: level, dry, clear, and out of the
 * way of everything else — every time the world is built, from the spot's
 * named landmark (./data.js).
 *
 * PURE. Everything about the world comes in through `env`, so the node test
 * (tests/features/secrets.mjs) runs it on every map with the real height
 * field and the real obstacle list, and the game runs it the same way:
 *
 *   env = {
 *     map,                      the map's data (world/maps.js)
 *     heightAt(x, z),           the height field (with the decks on it)
 *     obstacles,                world/terrain.js OBSTACLES (boxes)
 *     paved(x, z),              airfield pavement, the runways included
 *     onRunway(x, z, margin),   either runway, with a margin
 *     corridor(x, z),           inside an approach lane
 *     padWeight(x, z),          the airfield plateau (0 off it)
 *     flat(x, z),               an authored flat (world/terrain.js flatAt)
 *     onRoad(x, z, margin),     an authored road
 *     pads,                     [{ x, z, r }] helipads
 *     carrier,                  { x, z, deckY, headingDeg } or null
 *     airport,                  { runway: { cx, cz, length }, elev, pad }
 *   }
 *
 * THE BUILDING is axis-aligned (its floor is a terrain.js platform, which is
 * an axis-aligned box), so its door faces one of the four compass points.
 * A site is
 *   { x, z, headingDeg, w, d, hx, hz, floorY, door: { x, z }, apron: { x, z } }
 * where (x, z) is the middle of the floor, `headingDeg` the way the door
 * faces (out), w across the door and d from the door to the back wall.
 */

const D2R = Math.PI / 180;

/** The building for each kind, before it is fitted round its aeroplane (metres). */
export const KINDS = {
  shed: { w: 15, d: 15, h: 6.4, doorH: 4.9, range: 0.45, apron: 26 },
  cave: { w: 21, d: 21, h: 8.5, doorH: 6.4, range: 1.2, apron: 28, behind: 7 },
  bunker: { w: 22, d: 22, h: 7.6, doorH: 5.8, range: 0.5, apron: 28 },
  far: { w: 34, d: 32, h: 13, doorH: 10, range: 0.5, apron: 40 },
  hatch: { w: 26, d: 26, h: 0, doorH: 0, range: 0, apron: 0 },
};

/**
 * Fit the building round the aeroplane in it: span plus a walkway each side,
 * length plus room to walk round the tail.
 */
export function sizeFor(kind, plane) {
  const k = KINDS[kind] || KINDS.shed;
  const span = plane && Number.isFinite(plane.span) ? plane.span : 12;
  const length = plane && Number.isFinite(plane.length) ? plane.length : 9;
  const w = Math.max(k.w, Math.ceil(span + 4));
  const d = Math.max(k.d, Math.ceil(length + 6));
  const h = kind === 'hatch' ? 0 : Math.max(k.h, k.doorH + 1.5);
  return { w, d, h, doorH: k.doorH, apron: k.apron, range: k.range, behind: k.behind || 0 };
}

/** Where a landmark is, for a spot's `near`, or null if this map has none. */
export function landmarkPoint(map, near, env = {}) {
  if (!map || !near) return null;
  const sc = map.scenery || {};
  if (near.pad) {
    const p = (sc.pads || []).find((q) => q.id === near.pad);
    return p ? { x: p.x, z: p.z } : null;
  }
  if (near.island) {
    const i = (map.islands || []).find((q) => q.name === near.island);
    return i ? { x: i.cx, z: i.cz } : null;
  }
  if (near.outpost) return map.outpost ? { x: map.outpost.cx, z: map.outpost.cz } : null;
  if (near.town) return sc.town ? { x: sc.town.cx, z: sc.town.cz } : null;
  if (near.lighthouse) return Array.isArray(sc.lighthouse) ? { x: sc.lighthouse[0], z: sc.lighthouse[1] } : null;
  if (near.runway) {
    const a = env.airport || map.airport;
    const r = a && a.runway;
    if (!r) return null;
    const s = near.runway === 'west' ? -1 : 1;
    return { x: r.cx + (s * r.length) / 2, z: r.cz };
  }
  if (near.carrier) return env.carrier ? { x: env.carrier.x, z: env.carrier.z } : null;
  if (Array.isArray(near.at)) return { x: near.at[0], z: near.at[1] };
  return null;
}

/** A compass bearing and a distance from (x, z). */
function along(x, z, bearingDeg, dist) {
  const b = (bearingDeg || 0) * D2R;
  return { x: x + Math.sin(b) * dist, z: z - Math.cos(b) * dist };
}

/** Half-extents on x and z for a building of w x d whose door faces `h`. */
function halves(w, d, h) {
  const ns = h % 180 === 0;
  return ns ? { hx: w / 2, hz: d / 2 } : { hx: d / 2, hz: w / 2 };
}

/** The unit vector a compass heading points along, world x / z. */
function dirOf(h) {
  return { x: Math.round(Math.sin(h * D2R)), z: Math.round(-Math.cos(h * D2R)) };
}

/** The obstacles that could matter near (x, z): a short list to test candidates against. */
function nearObstacles(obstacles, x, z, r) {
  const out = [];
  if (!Array.isArray(obstacles)) return out;
  for (let i = 0; i < obstacles.length; i++) {
    const o = obstacles[i];
    if (!o) continue;
    if (o.x1 < x - r || o.x0 > x + r || o.z1 < z - r || o.z0 > z + r) continue;
    out.push(o);
  }
  return out;
}


/** A tree is in the way of nothing: it is cleared for the building (secrets.js clearTrees). */
export function isTree(o) {
  return !!(o && typeof o.what === 'string' && /tree/i.test(o.what));
}

/**
 * Test one candidate: centre (x, z), door facing h. Returns the site or a
 * reason it was refused (for the test's report), never throws. The cheap
 * questions are asked first: most of the island fails on the slope of its
 * middle and four corners, five samples in.
 */
export function trySite(kind, size, x, z, h, env, obstacles) {
  const { hx, hz } = halves(size.w, size.d, h);
  const dir = dirOf(h);
  const H = env.heightAt;
  const halfW = dir.x === 0 ? hx : hz;
  const depth = dir.x === 0 ? hz : hx;
  const y0 = H(x, z);
  if (!(y0 > 1.4)) return { why: 'wet' };
  // A cave is a door in a hillside: the ground behind it climbs.
  if (kind === 'cave') {
    const b1 = H(x - dir.x * (depth + 12), z - dir.z * (depth + 12));
    if (!(b1 > y0 + 2)) return { why: 'no hillside' };
    const b2 = H(x - dir.x * (depth + 30), z - dir.z * (depth + 30));
    if (!(b2 > y0 + 5)) return { why: 'no hillside' };
  }
  let lo = y0;
  let hi = y0;
  // The corners first, then the rest of a 5 x 5 grid.
  for (let n = 0; n < ORDER.length; n++) {
    const px = x - hx + (2 * hx * ORDER[n][0]) / 4;
    const pz = z - hz + (2 * hz * ORDER[n][1]) / 4;
    const y = H(px, pz);
    if (!(y > 1.4)) return { why: 'wet' };
    if (y < lo) lo = y;
    if (y > hi) hi = y;
    if (hi - lo > size.range) return { why: 'slope' };
  }
  const floorY = hi + 0.08;
  // Out of everybody's way: runways and their lanes, the airfield (but the
  // far hangar stands on it), roads, helipads, the delivery strip.
  const margin = 6;
  const ex = depth + size.apron;
  const fx0 = Math.min(x - hx, x + dir.x * ex - (dir.z !== 0 ? hx : 0)) - margin;
  const fx1 = Math.max(x + hx, x + dir.x * ex + (dir.z !== 0 ? hx : 0)) + margin;
  const fz0 = Math.min(z - hz, z + dir.z * ex - (dir.x !== 0 ? hz : 0)) - margin;
  const fz1 = Math.max(z + hz, z + dir.z * ex + (dir.x !== 0 ? hz : 0)) + margin;
  const pts = [[fx0, fz0], [fx1, fz0], [fx0, fz1], [fx1, fz1], [(fx0 + fx1) / 2, (fz0 + fz1) / 2], [x, z]];
  for (const [px, pz] of pts) {
    if (env.onRunway && env.onRunway(px, pz, kind === 'far' ? 70 : 45)) return { why: 'runway' };
    if (env.corridor && env.corridor(px, pz)) return { why: 'approach lane' };
    if (kind !== 'far' && env.padWeight && env.padWeight(px, pz) > 0) return { why: 'airfield' };
    if (env.paved && env.paved(px, pz)) return { why: 'paved' };
    if (env.flat && env.flat(px, pz)) return { why: 'flat' };
    if (env.onRoad && env.onRoad(px, pz, 14)) return { why: 'road' };
  }
  for (const p of env.pads || []) {
    const r = (p.r || 12) + 30;
    if (p.x + r > fx0 && p.x - r < fx1 && p.z + r > fz0 && p.z - r < fz1) return { why: 'helipad' };
  }
  const o = env.map && env.map.outpost;
  if (o && x + hx > o.cx - o.halfLen - 70 && x - hx < o.cx + o.halfLen + 70 && Math.abs(z - o.cz) < hz + 26) return { why: 'strip' };
  // The ground in front of the door: dry, gentle, near the floor's height.
  let alo = Infinity;
  let ahi = -Infinity;
  for (let i = 0; i <= 3; i++) {
    for (let j = 1; j <= 4; j++) {
      const out = depth + (size.apron * j) / 4;
      const lat = -halfW + (2 * halfW * i) / 3;
      const px = x + dir.x * out + (dir.z !== 0 ? lat : 0);
      const pz = z + dir.z * out + (dir.x !== 0 ? lat : 0);
      const y = H(px, pz);
      if (!(y > 1.0)) return { why: 'apron wet' };
      if (y < alo) alo = y;
      if (y > ahi) ahi = y;
    }
  }
  if (ahi - alo > 2.4 || Math.abs(alo - lo) > 1.6 || ahi > floorY + 1.2) return { why: 'apron slope' };
  // Buildings, walls, masts: anything solid but a tree.
  const rect = { x0: fx0 + margin - 2.5, x1: fx1 - margin + 2.5, z0: fz0 + margin - 2.5, z1: fz1 - margin + 2.5 };
  const trees = [];
  for (let i = 0; i < obstacles.length; i++) {
    const b = obstacles[i];
    if (b.x1 < rect.x0 || b.x0 > rect.x1 || b.z1 < rect.z0 || b.z0 > rect.z1) continue;
    if (isTree(b)) trees.push(b);
    else return { why: `obstacle (${b.what || 'something'})` };
  }
  return {
    x,
    z,
    headingDeg: h,
    w: size.w,
    d: size.d,
    h: size.h,
    doorH: size.doorH,
    hx,
    hz,
    floorY,
    groundLo: lo,
    door: { x: x + dir.x * depth, z: z + dir.z * depth },
    apron: { x: x + dir.x * (depth + Math.min(16, size.apron * 0.6)), z: z + dir.z * (depth + Math.min(16, size.apron * 0.6)) },
    /** The whole of the ground it takes, building and apron: where trees are cleared. */
    rect,
    trees,
  };
}

/** The 5 x 5 floor samples, corners and edges first (the centre is asked before). */
const ORDER = [[0, 0], [4, 0], [0, 4], [4, 4], [2, 0], [0, 2], [4, 2], [2, 4], [1, 1], [3, 1], [1, 3], [3, 3], [2, 1], [1, 2], [3, 2], [2, 3], [1, 0], [3, 0], [0, 1], [4, 1], [0, 3], [4, 3], [1, 4], [3, 4]];

/**
 * The site for a spot, or null. Its own known place first (`spot.at`, as
 * the node test last found it: one candidate, a millisecond), and only if
 * the map has changed under it the search: rings out from the landmark
 * (plus the spot's bearing and distance), nearest first, at each point the
 * four door headings, the one facing back towards the landmark first — and
 * a time budget, so a map that has no room cannot stall the world build.
 */
export function findSite(spot, plane, env, { maxR = 1400, step = 14, budgetMs = 60, now = defaultNow } = {}) {
  const map = env.map;
  const size = sizeFor(spot.kind, plane);
  if (spot.kind === 'hatch') return hatchSite(spot, size, env);
  const lm = landmarkPoint(map, spot.near, env);
  if (!lm) return null;
  const obstaclesAll = env.obstacles || [];
  if (Array.isArray(spot.at)) {
    const [ax, az, ah] = spot.at;
    const s = trySite(spot.kind, size, ax, az, ah, env, nearObstacles(obstaclesAll, ax, az, 160));
    if (!s.why) {
      s.from = { x: lm.x, z: lm.z, r: Math.hypot(ax - lm.x, az - lm.z), known: true };
      return s;
    }
    findSite.knownRefused = s.why;
  }
  const seed = along(lm.x, lm.z, spot.bearing, spot.dist || 0);
  const obstacles = nearObstacles(obstaclesAll, seed.x, seed.z, maxR + 160);
  const toLm = (Math.atan2(lm.x - seed.x, -(lm.z - seed.z)) * 180) / Math.PI;
  const first = (((Math.round(toLm / 90) * 90) % 360) + 360) % 360;
  const heads = [first, (first + 90) % 360, (first + 270) % 360, (first + 180) % 360];
  const refused = {};
  const t0 = now();
  for (let r = 0; r <= maxR; r += step) {
    const n = r === 0 ? 1 : Math.max(6, Math.round((2 * Math.PI * r) / step));
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const x = Math.round(seed.x + Math.sin(a) * r);
      const z = Math.round(seed.z - Math.cos(a) * r);
      for (const h of heads) {
        const s = trySite(spot.kind, size, x, z, h, env, obstacles);
        if (s.why) {
          refused[s.why] = (refused[s.why] || 0) + 1;
          continue;
        }
        s.from = { x: lm.x, z: lm.z, seedX: seed.x, seedZ: seed.z, r };
        return s;
      }
    }
    if (budgetMs > 0 && now() - t0 > budgetMs) {
      refused.budget = r;
      break;
    }
  }
  findSite.lastRefused = refused;
  return null;
}

function defaultNow() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/*
 * The carrier's hatch: a lift in the deck, forward of the island on the
 * starboard side — clear of the angled landing lane, both catapults and the
 * parked jets (tests/features/secrets.mjs checks it against the deck's own
 * geometry, features/carrier/deck.js). Ship-local metres, x to starboard,
 * z aft; the deck is 360 x 1500.
 */
export const HATCH_LOCAL = { x: 112, z: -40 };

function hatchSite(spot, size, env) {
  const c = env.carrier;
  if (!c || !Number.isFinite(c.x)) return null;
  const th = -(c.headingDeg || 0) * D2R;
  const cos = Math.cos(th);
  const sin = Math.sin(th);
  const lx = HATCH_LOCAL.x;
  const lz = HATCH_LOCAL.z;
  const x = c.x + lx * cos + lz * sin;
  const z = c.z - lx * sin + lz * cos;
  const hd = (((c.headingDeg || 0) % 360) + 360) % 360;
  return {
    x,
    z,
    // The lift's "door" is the deck: you walk onto it from the island's side.
    headingDeg: (hd + 270) % 360,
    w: size.w,
    d: size.d,
    h: 0,
    doorH: 0,
    hx: size.w / 2,
    hz: size.d / 2,
    floorY: c.deckY,
    groundLo: c.deckY,
    door: { x, z },
    apron: { x: x - size.w * 0.9, z },
    hatch: true,
    from: { x: c.x, z: c.z, r: 0 },
  };
}

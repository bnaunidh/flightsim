/**
 * People in town: walkers on the pavements and people stood about by the buildings.
 *
 * The owner: "cars there, people there". The airfield had people (features/world-life.js);
 * the towns had none. These are the same figures — life/people.js's Crowd, every one of
 * them in ONE draw call, walked by the vertex shader — on plans made here.
 *
 *   WHERE    along the streets the town really has (the lanes' own polylines), on the
 *            pavement either side: never in the carriageway, never on or beside a runway
 *            (`blocked`), more of them towards the middle of town than at its edge.
 *   WHAT     most walk a stretch of pavement, wait a while at its end, and walk back; the
 *            rest stand, alone facing the street or in pairs facing each other.
 *   SAFE     nobody is ever hit: nothing here is solid, and with the player's aeroplane
 *            or car close by on the ground a person stops, turns to look and steps back
 *            from the kerb until it has gone.
 *   COST     the plan is made once a town; a frame is one pass over the people within
 *            reach, no allocation, and nothing at all when the town is out of sight.
 *
 * planWalkers is pure (node: tests/features/street-life.mjs).
 */

/** People a town gets at each tier (a town of 600 m; bigger towns more, to CAP). None at Low. */
export const PEOPLE = Object.freeze({ low: 0, medium: 28, high: 64, ultra: 110 });
export const PEOPLE_CAP = 160;
/** Radians of the walk cycle a metre (life/crowd.js STRIDE). */
const STRIDE = 3.9;
/** Metres from a person the player's vehicle makes them step back. */
const SHY = 9;

function lengthOf(pts) {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return l;
}

/** The point `s` metres along `pts`, `off` metres to the right of the way it runs: [x, z, tx, tz]. */
function along(pts, s, off, out) {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dz = pts[i][1] - pts[i - 1][1];
    const L = Math.hypot(dx, dz);
    if (L < 1e-6) continue;
    if (s <= acc + L || i === pts.length - 1) {
      const t = Math.max(0, Math.min(1, (s - acc) / L));
      const tx = dx / L;
      const tz = dz / L;
      out[0] = pts[i - 1][0] + dx * t - tz * off;
      out[1] = pts[i - 1][1] + dz * t + tx * off;
      out[2] = tx;
      out[3] = tz;
      return out;
    }
    acc += L;
  }
  return out;
}

/**
 * Plan a town's people.
 * @param {object[]} streets  [{ pts: [[x, z]…], hw (half the carriageway), walk? (the pavement's width) }]
 * @param {object} o  count; centre { x, z, r }; ground(x, z) => y; blocked(x, z) => true where nobody may stand;
 *                    keep(x, z) => false to turn a spot down (too far from the player, or too close to appear at); rnd
 * @returns {object[]} [{ mode: 'walk' | 'stand', path: [{ x, y, z }], len, speed, yaw, street, off }]
 */
export function planWalkers(streets, { count = 0, centre = null, ground = () => 0, blocked = () => false, keep = null, rnd = Math.random } = {}) {
  const out = [];
  const use = (streets || []).filter((s) => s && s.pts && s.pts.length >= 2).map((s) => ({ s, len: lengthOf(s.pts) })).filter((q) => q.len > 30);
  const total = use.reduce((a, q) => a + q.len, 0);
  if (!(count > 0) || !(total > 0)) return out;
  const P = [0, 0, 0, 0];
  const pickStreet = () => {
    let r = rnd() * total;
    for (const q of use) {
      r -= q.len;
      if (r <= 0) return q;
    }
    return use[use.length - 1];
  };
  let guard = count * 30;
  while (out.length < count && guard-- > 0) {
    const q = pickStreet();
    const s0 = 6 + rnd() * (q.len - 12);
    const side = rnd() < 0.5 ? 1 : -1;
    const pave = q.s.walk || 2.2;
    const off = side * ((q.s.hw || 5) + pave * 0.55);
    along(q.s.pts, s0, off, P);
    // More in the middle of town: a spot at the edge is kept one time in four.
    if (centre && rnd() > 1 - 0.75 * Math.min(1, Math.hypot(P[0] - centre.x, P[1] - centre.z) / (centre.r || 600))) continue;
    if (blocked(P[0], P[1]) || (keep && !keep(P[0], P[1]))) continue;
    const street = use.indexOf(q);
    if (rnd() < 0.24) {
      // Stood by the buildings: facing the street, or a pair facing each other.
      const back = side * ((q.s.hw || 5) + pave * 0.85);
      along(q.s.pts, s0, back, P);
      if (blocked(P[0], P[1])) continue;
      const pair = rnd() < 0.45 && out.length + 1 < count;
      const face = Math.atan2(-P[3] * side, P[2] * side); // towards the carriageway
      const a = { mode: 'stand', path: [{ x: P[0], y: ground(P[0], P[1]), z: P[1] }], len: 0, speed: 0, yaw: pair ? Math.atan2(-P[2], -P[3]) : face, street, off: back };
      out.push(a);
      if (pair) {
        const x = P[0] + P[2] * 0.95;
        const z = P[1] + P[3] * 0.95;
        out.push({ mode: 'stand', path: [{ x, y: ground(x, z), z }], len: 0, speed: 0, yaw: Math.atan2(P[2], P[3]), street, off: back });
      }
      continue;
    }
    // A stretch of pavement, a point every 8 m, cut short where it would leave the pavement's own ground.
    const want = 35 + rnd() * 75;
    const path = [];
    for (let s = s0; s <= Math.min(q.len - 4, s0 + want); s += 8) {
      along(q.s.pts, s, off, P);
      if (blocked(P[0], P[1])) break;
      path.push({ x: P[0], y: ground(P[0], P[1]), z: P[1] });
    }
    if (path.length < 3) continue;
    let len = 0;
    for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].z - path[i - 1].z);
    out.push({ mode: 'walk', path, len, speed: 1.05 + rnd() * 0.55, yaw: 0, street, off });
  }
  return out;
}

/** The plan's people as the Crowd draws them, and the walk that moves them. */
export class StreetWalkers {
  /** `plan` from planWalkers; `size` leaves room for more (put fills a place later). */
  constructor(plan, rnd = Math.random, size = plan.length) {
    this.rnd = rnd;
    this.people = [];
    for (let i = 0; i < Math.max(size, plan.length); i++) {
      this.people.push({ x: 0, y: 0, z: 0, yaw: 0, walk: 0, moving: false, shift: 0, outfit: 5, bag: false, hidden: true, look: i * 7 + 3, dim: 1, w: null, cum: null, s: 0, dir: 1, wait: 0, away: 0, hx: 0, hz: 0, seg: 1, slotN: -1 });
      if (i < plan.length) this.put(i, plan[i]);
    }
    this.shied = 0;
  }

  /** How many places have somebody in them. */
  get count() {
    let n = 0;
    for (const p of this.people) if (p.w) n++;
    return n;
  }

  /** Put planned walker `w` in place `i` (whoever was there has walked out of reach). */
  put(i, w) {
    const p = this.people[i];
    const rnd = this.rnd;
    const cum = [0];
    for (let k = 1; k < w.path.length; k++) cum.push(cum[k - 1] + Math.hypot(w.path[k].x - w.path[k - 1].x, w.path[k].z - w.path[k - 1].z));
    Object.assign(p, { x: w.path[0].x, y: w.path[0].y, z: w.path[0].z, yaw: w.yaw, walk: rnd() * 6.28, moving: false, shift: rnd() * 6.28, hidden: false, w, cum, s: w.len * rnd(), dir: rnd() < 0.5 ? 1 : -1, wait: w.mode === 'walk' ? rnd() * 4 : 0, away: 0, hx: 0, hz: 0, seg: 1, slotN: -1 });
  }

  /**
   * One frame. `danger` is the player's aeroplane or car on the ground ({ x, z, r }) or null;
   * `share` (0-1) is how many are out (fewer after dark).
   */
  step(dt, danger = null, share = 1) {
    const out = Math.ceil(this.people.length * share);
    let shied = 0;
    for (let i = 0; i < this.people.length; i++) {
      const p = this.people[i];
      p.hidden = i >= out || !p.w;
      if (p.hidden) continue;
      let near = false;
      if (danger) {
        const dx = p.x - danger.x;
        const dz = p.z - danger.z;
        const reach = SHY + (danger.r || 2);
        const d2 = dx * dx + dz * dz;
        if (d2 < reach * reach) {
          near = true;
          const d = Math.sqrt(d2) || 1;
          p.hx = dx / d;
          p.hz = dz / d;
        }
      }
      // Stepping back from it, and coming back when it has gone.
      p.away += ((near ? 1 : 0) - p.away) * Math.min(1, dt * 2.5);
      const w = p.w;
      if (near) {
        shied++;
        p.moving = false;
        p.yaw = Math.atan2(p.hx, p.hz);
      } else if (w.mode === 'walk') {
        if (p.wait > 0) {
          p.wait -= dt;
          p.moving = false;
        } else {
          p.moving = true;
          p.s += p.dir * w.speed * dt;
          p.walk += w.speed * dt * STRIDE;
          if (p.s >= w.len || p.s <= 0) {
            p.s = p.s <= 0 ? 0 : w.len;
            p.dir = -p.dir;
            p.wait = 2 + ((i * 37) % 7);
          }
        }
      }
      if (!p.moving) p.shift += dt * 0.6;
      if (w.mode === 'walk') {
        let k = p.seg;
        const cum = p.cum;
        while (k > 1 && cum[k - 1] > p.s) k--;
        while (k < cum.length - 1 && cum[k] < p.s) k++;
        p.seg = k;
        const a = w.path[k - 1];
        const b = w.path[k];
        const L = cum[k] - cum[k - 1] || 1;
        const t = (p.s - cum[k - 1]) / L;
        p.x = a.x + (b.x - a.x) * t + p.hx * p.away * 1.7;
        p.y = a.y + (b.y - a.y) * t;
        p.z = a.z + (b.z - a.z) * t + p.hz * p.away * 1.7;
        if (!near) p.yaw = Math.atan2(-(b.x - a.x) * p.dir, -(b.z - a.z) * p.dir);
      } else {
        const a = w.path[0];
        p.x = a.x + p.hx * p.away * 1.7;
        p.z = a.z + p.hz * p.away * 1.7;
        if (!near && p.away < 0.05) p.yaw = w.yaw;
      }
    }
    this.shied = shied;
  }
}

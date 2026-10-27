/**
 * The apron's people and vehicles, keeping out of each other's way (wave 18,
 * owner, at a Gateway gate: "need to make sure npcs arent coliding o getting
 * hit by cars").
 *
 * Before this the walkers followed their planned routes blind — a passenger
 * caught up with the slower one in front and walked through her, two people
 * on the kerb met head-on and passed through each other, and everybody
 * walked through the side of a moving bus or baggage train, while the
 * vehicles looked for people at three points ahead and drove through anyone
 * between them. Now, cheaply:
 *
 *   PEOPLE      keep personal space: they queue behind the one in front going
 *               the same way, step to their right to pass somebody coming the
 *               other way, step round somebody standing, and give way on a
 *               crossing. A side-step never takes anyone into an aeroplane, a
 *               parked vehicle, a bridge or a building (Statics: the plan's
 *               own obstacles); it eases back onto the route when clear.
 *   VEHICLES    are waited for: a walker about to step closer to a vehicle,
 *               or into the next few seconds of a moving one's path, stops at
 *               the edge and looks; and every vehicle checks its own path
 *               ahead, the width of its body and a margin, for anybody in it
 *               and stops (brake lights) until they are clear. If both are
 *               waiting on each other the walker steps out of its way.
 *   NOBODY      appears inside another person or a vehicle (a passenger
 *               waits behind the door until the doorway is clear), and if two
 *               ever do overlap they are eased apart, a few centimetres a
 *               frame, never popped.
 *
 * COST. A spatial hash of the people (Grid, rebuilt each frame, no
 * allocation), the vehicles as boxes; people beyond 150 m of the camera are
 * stepped every other frame and beyond 300 m every fourth, with the time they
 * missed. Pure: no THREE, no sim — tests/features/apron-crowd.mjs runs it in
 * node for minutes of apron time at several airports.
 */

import { FOOT } from '../../world/vehicle-footprints.js';

/** A person's radius for "touching", metres (shoulders and a wheeled case). */
export const WALKER_R = 0.3;
/** Centre to centre two people keep when they can (2R and a hand). */
export const PERSONAL = 0.8;
/** The hard floor the push-apart keeps (2R and a little). */
const APART = 2 * WALKER_R + 0.06;

/** Vehicle footprints (world/vehicle-footprints.js), re-exported for the tests. */
export { FOOT };

/** Metres from (x, z) to a vehicle's box (0 inside it). */
export function boxDist(m, x, z) {
  const dx = x - m.x;
  const dz = z - m.z;
  const lx = dx * m.c - dz * m.s;
  const lz = dx * m.s + dz * m.c;
  const ex = Math.max(Math.abs(lx) - m.hw, 0);
  const ez = Math.max(m.z0 - lz, lz - m.z1, 0);
  return Math.hypot(ex, ez);
}

/* ------------------------------------------------------------------ */
/* A spatial hash of points                                            */
/* ------------------------------------------------------------------ */

export class Grid {
  constructor(cap = 256, cell = 2.5, buckets = 1024) {
    this.cell = cell;
    this.mask = buckets - 1;
    this.heads = new Int32Array(buckets).fill(-1);
    this.next = new Int32Array(cap).fill(-1);
    this.xs = new Float32Array(cap);
    this.zs = new Float32Array(cap);
    this.used = [];
    this.out = new Int32Array(cap);
  }

  key(cx, cz) {
    return ((cx * 73856093) ^ (cz * 19349663)) & this.mask;
  }

  clear() {
    for (const b of this.used) this.heads[b] = -1;
    this.used.length = 0;
  }

  insert(i, x, z) {
    if (i >= this.next.length) return;
    const b = this.key(Math.floor(x / this.cell), Math.floor(z / this.cell));
    if (this.heads[b] === -1) this.used.push(b);
    this.next[i] = this.heads[b];
    this.heads[b] = i;
    this.xs[i] = x;
    this.zs[i] = z;
  }

  /** The indices within r of (x, z), into this.out; returns how many. */
  near(x, z, r) {
    const c = this.cell;
    const cx0 = Math.floor((x - r) / c);
    const cx1 = Math.floor((x + r) / c);
    const cz0 = Math.floor((z - r) / c);
    const cz1 = Math.floor((z + r) / c);
    const r2 = r * r;
    let n = 0;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cz = cz0; cz <= cz1; cz++) {
        let i = this.heads[this.key(cx, cz)];
        while (i !== -1) {
          const dx = this.xs[i] - x;
          const dz = this.zs[i] - z;
          if (dx * dx + dz * dz <= r2 && n < this.out.length) {
            // A bucket can hold two cells (the hash); the distance test sorts them.
            let dup = false;
            for (let k = 0; k < n; k++) if (this.out[k] === i) dup = true;
            if (!dup) this.out[n++] = i;
          }
          i = this.next[i];
        }
      }
    }
    return n;
  }

  /** Is anybody within r of (x, z)? */
  any(x, z, r) {
    return this.near(x, z, r) > 0;
  }
}

/* ------------------------------------------------------------------ */
/* The vehicles, this frame                                            */
/* ------------------------------------------------------------------ */

const _t = { x: 0, y: 0, z: 0, yaw: 0 };

export class MoverSet {
  constructor() {
    this.list = [];
    this.n = 0;
  }

  begin() {
    this.n = 0;
  }

  /**
   * One vehicle (or one cart of a train) this frame. `route`/`d`/`dir`: what it
   * is driving along, to sweep the next few seconds ahead of its front; null
   * for a cart, a parked one, anything not leading.
   */
  add(kind, x, z, yaw, v = 0, route = null, d = 0, dir = 1) {
    let m = this.list[this.n];
    if (!m) {
      m = { sweep: new Float32Array(20), ns: 0 };
      this.list.push(m);
    }
    this.n++;
    const f = FOOT[kind] || FOOT.cart;
    m.kind = kind;
    m.x = x;
    m.z = z;
    m.yaw = yaw;
    m.c = Math.cos(yaw);
    m.s = Math.sin(yaw);
    m.hw = f.hw;
    m.z0 = f.z0;
    m.z1 = f.z1;
    m.R = Math.hypot(f.hw, Math.max(-f.z0, f.z1));
    m.v = Math.abs(v);
    m.moving = m.v > 0.15;
    m.ns = 0;
    if (route && m.v > 0.05) {
      const n = Math.min(10, Math.ceil((m.v * 2.5 + 3) / 1.5));
      for (let k = 1; k <= n; k++) {
        route.sample(d + dir * (-f.z0 + k * 1.5), _t);
        m.sweep[m.ns * 2] = _t.x;
        m.sweep[m.ns * 2 + 1] = _t.z;
        m.ns++;
      }
    }
    return m;
  }
}

/**
 * Is anybody in this vehicle's way: along its route from its front bumper to
 * `look` metres beyond it, its half-width and a margin either side?
 */
export function pathBlocked(route, d, dir, kind, look, people, margin = 0.9) {
  if (!people) return false;
  const f = FOOT[kind] || FOOT.cart;
  const r = f.hw + margin;
  const n = Math.max(1, Math.ceil(look / 1.2));
  for (let k = 0; k <= n; k++) {
    route.sample(d + dir * (-f.z0 + (look * k) / n), _t);
    if (people.any(_t.x, _t.z, r)) return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* What is solid                                                        */
/* ------------------------------------------------------------------ */

/** The plan's obstacles (life/plan.js apronObstacles), hashed, with each walker's own exemptions. */
export class Statics {
  constructor(obs) {
    this.circles = (obs && obs.circles) || [];
    this.rects = (obs && obs.rects) || [];
    this.cell = 8;
    this.map = new Map();
    this.circles.forEach((c, i) => {
      const r = c.r + 1;
      for (let cx = Math.floor((c.x - r) / 8); cx <= Math.floor((c.x + r) / 8); cx++) {
        for (let cz = Math.floor((c.z - r) / 8); cz <= Math.floor((c.z + r) / 8); cz++) {
          const k = cx * 65536 + cz;
          let a = this.map.get(k);
          if (!a) this.map.set(k, (a = []));
          a.push(i);
        }
      }
    });
  }

  /** Can this walker stand at (x, z)? Its own aeroplane, and the vehicle it works at, are not in its way. */
  clear(w, x, z, r = WALKER_R) {
    const a = this.map.get(Math.floor(x / 8) * 65536 + Math.floor(z / 8));
    if (a) {
      for (const i of a) {
        const c = this.circles[i];
        if (w.tg && c.tg === w.tg && (c.kind === 'plane' || (w.skip && w.skip.includes(c.kind)))) continue;
        const dx = x - c.x;
        const dz = z - c.z;
        if (dx * dx + dz * dz < (c.r + r) * (c.r + r)) return false;
      }
    }
    // Buildings — but the kerb is landside of the terminal, on the far side of its wall.
    for (const q of this.rects) if (x > q.x0 - r && x < q.x1 + r && z > q.z0 - r && z < q.z1 + r) return false;
    return true;
  }
}

/* ------------------------------------------------------------------ */
/* The walkers                                                          */
/* ------------------------------------------------------------------ */

/**
 * The runtime records for the plan's walkers (`Route` is life/vans.js's,
 * passed in so this file stays free of THREE). `elev` the field.
 */
export function makeWalkers(planWalkers, elev, rnd, Route) {
  const at = { x: 0, y: 0, z: 0, yaw: 0 };
  return planWalkers.map((p, i) => {
    const w = makeWalker(p, i, elev, rnd, Route);
    // Where it really starts: its own place along the route, not the route's first point.
    if (w.mode !== 'idle' && w.d >= 0) {
      w.route.sample(w.d, at);
      w.x = w.bx = at.x;
      w.z = w.bz = at.z;
      w.y = elev + (at.y || 0);
    }
    return w;
  });
}

function makeWalker(p, i, elev, rnd, Route) {
  return {
    role: p.role,
    outfit: p.outfit,
    mode: p.mode,
    route: new Route(p.path, p.mode === 'loop'),
    speed: p.speed || 1.2,
    d: p.d0 || 0,
    d0: p.d0 || 0,
    dir: 1,
    wait: 0,
    pause: p.pause || 2,
    rest: p.rest || 20,
    bag: !!p.bag,
    zone: p.zone ?? null,
    tg: p.tg || null,
    skip: p.skip || [],
    look: i * 7 + 3,
    x: p.path[0].x,
    y: elev + (p.path[0].y || 0),
    z: p.path[0].z,
    yaw: p.yaw || 0,
    baseYaw: p.yaw || 0,
    walk: rnd() * 6,
    shift: rnd() * 6,
    turn: 4 + rnd() * 12,
    moving: false,
    hidden: p.mode === 'cycle' && (p.d0 || 0) < 0,
    held: false,
    slotN: -1,
    caseN: -1,
    // Steering: where the route puts them, and how far off it they have stepped.
    bx: p.path[0].x,
    bz: p.path[0].z,
    ox: 0,
    oz: 0,
    fx: 0,
    fz: 0,
    acc: 0,
    vehWait: 0,
    calm: false,
    lx: 0,
    lz: 0,
    _s: { x: 0, y: 0, z: 0, yaw: p.yaw || 0 },
  };
}

/**
 * One airfield's people and vehicles, stepped together.
 *
 *   walkers   makeWalkers()
 *   vans      a life/vans.js VanFleet or null
 *   apron     the world/apron.js Apron (its crews' baggage trains, the
 *             spare crew driving in, the follow-me van), or null
 *   obs       the plan's obstacles
 */
export class ApronLife {
  constructor({ walkers = [], vans = null, apron = null, obs = null, elev = 0 } = {}) {
    this.walkers = walkers;
    this.vans = vans;
    this.apron = apron;
    this.elev = elev;
    this.statics = new Statics(obs);
    this.grid = new Grid(Math.max(16, walkers.length + 8));
    this.movers = new MoverSet();
    this.frame = 0;
    this.stats = { pushes: 0, vehicleWaits: 0, stepAsides: 0, steps: 0, skipped: 0 };
    // The apron's own vehicles ask the same question the vans do.
    if (apron) apron.peopleNear = (x, z, r) => this.grid.any(x, z, r);
    this._index();
    this.settle();
    this._index();
  }

  /** Everybody in sight, into the hash. */
  _index() {
    this.grid.clear();
    const W = this.walkers;
    for (let i = 0; i < W.length; i++) if (!W[i].hidden) this.grid.insert(i, W[i].x, W[i].z);
  }

  /** Every vehicle moving or parked in the apron's lanes, this frame. */
  _collect() {
    const M = this.movers;
    M.begin();
    if (this.vans && this.vans.group.visible !== false) this.vans.moversInto(M);
    if (this.apron && this.apron.moversInto) this.apron.moversInto(M);
  }

  /** Space to appear at (x, z): nobody within PERSONAL, no vehicle within its margin. */
  spawnClear(x, z, self = -1) {
    const n = this.grid.near(x, z, PERSONAL + 0.1);
    for (let k = 0; k < n; k++) if (this.grid.out[k] !== self) return false;
    const M = this.movers;
    for (let i = 0; i < M.n; i++) {
      const m = M.list[i];
      if (Math.abs(x - m.x) > m.R + 3 || Math.abs(z - m.z) > m.R + 3) continue;
      if (boxDist(m, x, z) < WALKER_R + 1.0) return false;
    }
    return true;
  }

  /**
   * One frame. `aircraft`: [{ x, z, r }] — keep-clear circles round every
   * aeroplane on the ground about; `cam`: { x, z } or null.
   */
  step(dt, aircraft = [], cam = null, night = false) {
    this.frame++;
    this._index();
    // The vehicles first, against where everybody is now.
    if (this.vans && this.vans.group.visible !== false) this.vans.step(dt, aircraft, this.grid, night);
    this._collect();
    this.stepWalkers(dt, aircraft, cam);
    this._index();
    this.separate(dt);
  }

  stepWalkers(dt, aircraft, cam) {
    const W = this.walkers;
    const G = this.grid;
    const M = this.movers;
    const S = this.statics;
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      // Far from the camera: every other frame, or every fourth, with the time it missed.
      w.acc += dt;
      if (cam) {
        const dx = w.x - cam.x;
        const dz = w.z - cam.z;
        const d2 = dx * dx + dz * dz;
        const every = d2 > 300 * 300 ? 4 : d2 > 150 * 150 ? 2 : 1;
        // Only somebody with nobody and nothing near: anyone in company is stepped every frame.
        if (every > 1 && w.calm && (this.frame + i) % every !== 0) {
          this.stats.skipped++;
          continue;
        }
      }
      const h = Math.min(w.acc, 0.25);
      w.acc = 0;
      this.stats.steps++;
      this.stepOne(w, i, h, aircraft, G, M, S);
      w.calm = this.calmAt(w, i);
    }
  }

  /** Nobody within 3 m and no vehicle within 15 m of its box: safe to step less often. */
  calmAt(w, i) {
    // Waiting at a door to come out: every frame, so two never step out at once.
    if (w.mode === 'cycle' && w.d < 0 && w.d > -3) return false;
    if (w.hidden) return true;
    const n = this.grid.near(w.x, w.z, 3);
    for (let k = 0; k < n; k++) if (this.grid.out[k] !== i) return false;
    const M = this.movers;
    for (let k = 0; k < M.n; k++) {
      const m = M.list[k];
      if (Math.abs(w.x - m.x) < m.R + 15 && Math.abs(w.z - m.z) < m.R + 15) return false;
    }
    return true;
  }

  /**
   * Before the first frame: anybody planned on top of somebody (two on the
   * kerb's lane at random places) is moved apart now, while nobody is looking.
   */
  settle() {
    this._collect();
    for (let it = 0; it < 40; it++) {
      this._index();
      const before = this.stats.pushes;
      this.separate(1, 0.25);
      if (this.stats.pushes === before) break;
    }
    this.stats.pushes = 0;
  }

  stepOne(w, i, dt, aircraft, G, M, S) {
    // Held: an aeroplane is near. Stand still where you are.
    let held = false;
    for (const c of aircraft) {
      const dx = w.x - c.x;
      const dz = w.z - c.z;
      if (dx * dx + dz * dz < c.r * c.r) {
        held = true;
        break;
      }
    }
    if (held && !w.held && this.onWait) this.onWait();
    w.held = held;
    w.shift += dt * 0.6;
    const R = w.route;
    const s = w._s;
    if (w.mode === 'idle') {
      // Now and then a look round, and back.
      w.turn -= dt;
      if (w.turn < 0) {
        w.turn = 5 + ((w.look * 13) % 11);
        w.yaw = w.yaw === w.baseYaw ? w.baseYaw + (w.look % 2 ? 0.5 : -0.5) : w.baseYaw;
      }
      w.moving = false;
      w.fx = 0;
      w.fz = 0;
      this.ease(w, dt, S, M);
      return;
    }
    // Which way the route runs here, and so which way this walker faces.
    R.sample(Math.max(0, w.d), s);
    let fx = -Math.sin(s.yaw);
    let fz = -Math.cos(s.yaw);
    if (w.mode === 'pingpong' && w.dir < 0) {
      fx = -fx;
      fz = -fz;
    }
    let v = held ? 0 : w.speed;
    let factor = 1;
    let side = 0;
    let veh = null;
    const visible = !w.hidden && !(w.mode === 'cycle' && (w.wait > 0 || w.d < 0));
    if (visible && v > 0 && !(w.mode === 'pingpong' && w.wait > 0)) {
      // --- people ahead ---
      const n = G.near(w.x, w.z, 1.9);
      for (let k = 0; k < n; k++) {
        const j = G.out[k];
        if (j === i) continue;
        const o = this.walkers[j];
        const rx = o.x - w.x;
        const rz = o.z - w.z;
        const dist = Math.hypot(rx, rz);
        const ahead = rx * fx + rz * fz;
        if (ahead <= 0.05) continue;
        const lat = rx * -fz + rz * fx;
        if (Math.abs(lat) > PERSONAL) continue;
        const dot = o.fx * fx + o.fz * fz;
        if (o.moving && dot > 0.5) {
          // Going my way: queue behind, a body's length back.
          factor = Math.min(factor, Math.max(0, Math.min(1, (dist - PERSONAL) / 0.6)));
        } else if (o.moving && dot < -0.5) {
          // Coming the other way: both step to their right and pass.
          side = 1;
          factor = Math.min(factor, dist < PERSONAL ? 0.2 : 0.65);
        } else if (o.moving) {
          // Crossing: whoever has the other more squarely ahead gives way; a tie, the later one.
          const oAhead = -(rx * o.fx + rz * o.fz);
          const mine = ahead / Math.max(dist, 1e-3);
          const theirs = oAhead / Math.max(dist, 1e-3);
          if (mine > theirs || (Math.abs(mine - theirs) < 0.05 && i > j)) factor = Math.min(factor, Math.max(0, Math.min(1, (dist - PERSONAL) / 0.8)));
        } else {
          // Standing: round them, on the side away.
          side = lat > 0 ? -1 : 1;
          factor = Math.min(factor, dist < PERSONAL ? 0.15 : 0.7);
        }
      }
      // --- vehicles ---
      const lx = w.x + fx * (0.8 + v * 0.7);
      const lz = w.z + fz * (0.8 + v * 0.7);
      for (let k = 0; k < M.n; k++) {
        const m = M.list[k];
        if (Math.abs(w.x - m.x) > m.R + 6 || Math.abs(w.z - m.z) > m.R + 6) continue;
        const dNow = boxDist(m, w.x, w.z);
        const dLook = boxDist(m, lx, lz);
        const marg = m.moving ? 1.5 : 0.8;
        let block = dLook < marg && dLook <= dNow + 1e-3;
        for (let q = 0; !block && q < m.ns; q++) {
          const sx = m.sweep[q * 2];
          const sz = m.sweep[q * 2 + 1];
          const dl = Math.hypot(lx - sx, lz - sz) - m.hw;
          const dn = Math.hypot(w.x - sx, w.z - sz) - m.hw;
          if (dl < 1.3 && dl <= dn + 1e-3) block = true;
        }
        if (block) {
          factor = 0;
          veh = m;
        }
      }
    }
    if (veh) {
      if (w.vehWait === 0) this.stats.vehicleWaits++;
      w.vehWait += dt;
    } else w.vehWait = 0;
    v *= factor;

    // --- along the route, as it always went ---
    if (w.mode === 'pingpong') {
      if (w.wait > 0) {
        w.wait -= dt;
        v = 0;
      } else if (v > 0) {
        w.d += w.dir * v * dt;
        if (w.d >= R.length || w.d <= 0) {
          w.d = Math.max(0, Math.min(R.length, w.d));
          w.dir = -w.dir;
          w.wait = w.pause;
        }
      }
    } else if (w.mode === 'loop') {
      w.d += v * dt;
    } else if (w.mode === 'cycle') {
      if (w.wait > 0) {
        w.wait -= dt;
        // Back to the door, behind it: out again only through the doorway check below.
        if (w.wait <= 0) w.d = Math.min(w.d0, -1e-3);
        w.hidden = true;
        w.moving = false;
        return;
      }
      if (w.d < 0) {
        // Behind the door (or in the cabin): out only when the doorway is clear.
        const step = (w.d >= 0 || !held ? w.speed : 0) * dt;
        if (w.d + step >= 0) {
          R.sample(Math.min(w.d + step, 0.5), s);
          if (this.spawnClear(s.x, s.z, i)) {
            w.d = Math.min(w.d + step, 0.5);
            // In the hash at once, so the next one out of the same door this frame sees it.
            this.grid.insert(i, s.x, s.z);
            w.ox = 0;
            w.oz = 0;
            w.lx = 0;
            w.lz = 0;
          } else w.d = -1e-3;
        } else w.d += step;
        w.hidden = w.d < 0;
        if (w.hidden) {
          w.moving = false;
          return;
        }
      } else {
        w.d += v * dt;
      }
      if (w.d > R.length) {
        w.wait = w.rest;
        w.hidden = true;
        w.moving = false;
        return;
      }
      w.hidden = false;
    }

    R.sample(w.d, s);
    w.bx = s.x;
    w.bz = s.z;
    w.y = this.elev + s.y;
    w.yaw = w.mode === 'pingpong' && w.dir < 0 ? s.yaw + Math.PI : s.yaw;
    w.moving = v > 0.02 && !(w.mode === 'pingpong' && w.wait > 0);
    w.fx = w.moving ? -Math.sin(w.yaw) : 0;
    w.fz = w.moving ? -Math.cos(w.yaw) : 0;
    if (w.moving) w.walk += v * dt * 2.25;

    // --- stepping aside ---
    // Both waiting on each other: out of the vehicle's way, square to it.
    if (veh && w.vehWait > 2.5 && veh.v < 0.3) {
      const dx = w.x - veh.x;
      const dz = w.z - veh.z;
      const lx = dx * veh.c - dz * veh.s;
      const sg = lx >= 0 ? 1 : -1;
      this.nudge(w, sg * veh.c * 0.7 * dt, -sg * veh.s * 0.7 * dt, S, 3);
      this.stats.stepAsides++;
    }
    // To the right to pass, or round somebody standing; back onto the route when clear.
    // Kept in the world's frame, so turning round at the end of a beat does not flip it.
    const tx = side ? side * 0.85 * -fz : 0;
    const tz = side ? side * 0.85 * fx : 0;
    const ex = tx - w.lx;
    const ez = tz - w.lz;
    const el = Math.hypot(ex, ez);
    const rate = (side ? 0.9 : 0.5) * dt;
    if (el > 1e-6) {
      const k = Math.min(1, rate / el);
      const nx = w.lx + ex * k;
      const nz = w.lz + ez * k;
      // Easing back onto the route is never a step towards a vehicle.
      if (side || !veh) {
        w.lx = nx;
        w.lz = nz;
      }
    }
    this.ease(w, dt, S, M, !!veh);
  }

  /** Put the walker at its route point plus its side-step and push, easing the push back when nothing needs it. */
  ease(w, dt, S, M, frozen = false) {
    if (w.mode === 'idle') {
      w.bx = w.route.x[0];
      w.bz = w.route.z[0];
    }
    // The extra push (an overlap eased apart, a step out of a vehicle's way) fades at half a metre a second.
    if (!frozen) {
      const ol = Math.hypot(w.ox, w.oz);
      if (ol > 0) {
        const k = Math.max(0, ol - 0.5 * dt) / ol;
        const nx = w.ox * k;
        const nz = w.oz * k;
        if (this.vehicleOk(w.bx + nx + w.lx, w.bz + nz + w.lz, w.x, w.z, M) && this.peopleOk(w, w.bx + nx + w.lx, w.bz + nz + w.lz)) {
          w.ox = nx;
          w.oz = nz;
        }
      }
    }
    let x = w.bx + w.ox + w.lx;
    let z = w.bz + w.oz + w.lz;
    if (!S.clear(w, x, z)) {
      // Never into something solid: give up the side-step, then the push.
      w.lx *= 0.5;
      w.lz *= 0.5;
      x = w.bx + w.ox + w.lx;
      z = w.bz + w.oz + w.lz;
      if (!S.clear(w, x, z)) {
        w.lx = 0;
        w.lz = 0;
        w.ox *= 0.5;
        w.oz *= 0.5;
        x = w.bx + w.ox;
        z = w.bz + w.oz;
        if (!S.clear(w, x, z)) {
          w.ox = 0;
          w.oz = 0;
          x = w.bx;
          z = w.bz;
        }
      }
    }
    w.x = x;
    w.z = z;
  }

  /** Would (x, z) be closer than APART to anybody it is not already that close to? */
  peopleOk(w, x, z) {
    const n = this.grid.near(x, z, APART);
    for (let k = 0; k < n; k++) {
      const o = this.walkers[this.grid.out[k]];
      if (o === w || o.hidden) continue;
      if (Math.hypot(o.x - x, o.z - z) < Math.hypot(o.x - w.x, o.z - w.z)) return false;
    }
    return true;
  }

  /** Does moving from (ox, oz) to (x, z) keep out of every vehicle's margin it is not already inside? */
  vehicleOk(x, z, ox, oz, M) {
    for (let k = 0; k < M.n; k++) {
      const m = M.list[k];
      if (Math.abs(x - m.x) > m.R + 3 || Math.abs(z - m.z) > m.R + 3) continue;
      const dn = boxDist(m, x, z);
      if (dn < (m.moving ? 1.5 : 0.8) && dn < boxDist(m, ox, oz)) return false;
    }
    return true;
  }

  /** Move a walker's push offset by (dx, dz) if it stays clear of solid things; at most `cap` metres off. */
  nudge(w, dx, dz, S, cap = 1.5) {
    let nx = w.ox + dx;
    let nz = w.oz + dz;
    const l = Math.hypot(nx, nz);
    if (l > cap) {
      nx *= cap / l;
      nz *= cap / l;
    }
    const x = w.x + (nx - w.ox);
    const z = w.z + (nz - w.oz);
    if (!S.clear(w, x, z)) return false;
    w.ox = nx;
    w.oz = nz;
    w.x = x;
    w.z = z;
    return true;
  }

  /**
   * The backstop: anybody closer than APART to somebody, or inside a vehicle's
   * box and a little, is eased apart — 4 cm a frame at most, never popped.
   */
  separate(dt, cap = 0.04) {
    const W = this.walkers;
    const G = this.grid;
    const S = this.statics;
    const M = this.movers;
    const max = Math.max(0.01, Math.min(cap, 1.6 * dt));
    for (let i = 0; i < W.length; i++) {
      const w = W[i];
      if (w.hidden) continue;
      const n = G.near(w.x, w.z, APART);
      for (let k = 0; k < n; k++) {
        const j = G.out[k];
        if (j <= i) continue;
        const o = W[j];
        let dx = o.x - w.x;
        let dz = o.z - w.z;
        let d = Math.hypot(dx, dz);
        if (d >= APART) continue;
        if (d < 1e-4) {
          dx = Math.cos(i * 2.39996);
          dz = Math.sin(i * 2.39996);
          d = 1;
        }
        const push = Math.min(max, (APART - d) / 2);
        const ux = dx / d;
        const uz = dz / d;
        const a = this.nudge(w, -ux * push, -uz * push, S);
        const b = this.nudge(o, ux * push, uz * push, S);
        if (!a && b) this.nudge(o, ux * push, uz * push, S);
        else if (a && !b) this.nudge(w, -ux * push, -uz * push, S);
        this.stats.pushes++;
      }
      // Out of a vehicle's box (it should have stopped; this is the belt and braces).
      for (let k = 0; k < M.n; k++) {
        const m = M.list[k];
        if (Math.abs(w.x - m.x) > m.R + 1 || Math.abs(w.z - m.z) > m.R + 1) continue;
        const dn = boxDist(m, w.x, w.z);
        if (dn >= WALKER_R + 0.08) continue;
        // Straight out sideways from the box's long axis, the way people step back from a kerb.
        const dx = w.x - m.x;
        const dz = w.z - m.z;
        const lx = dx * m.c - dz * m.s;
        const sg = lx >= 0 ? 1 : -1;
        const step = Math.min(0.08, WALKER_R + 0.1 - dn);
        this.nudge(w, sg * m.c * step, -sg * m.s * step, S, 3);
        this.stats.pushes++;
      }
    }
  }
}

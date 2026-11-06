/**
 * The inside of a terminal, in numbers: no meshes, so tests/features/walk-in.mjs
 * can walk every room of every terminal in node.
 *
 * Measured in the building's own frame: `u` along the wall (lay.frame.x), `b`
 * metres in from the apron glass (0) to the kerb wall (D), `y` up from the field.
 *
 *   KERB (b = D)   the doors the forecourt already has (life/doors.js)
 *   HALL           check-in islands, one storey to the ceiling
 *   b = B          SECURITY in the middle (its lanes through this wall); a
 *                  passage each end of it through to the arrivals corridor
 *   CONCOURSE      upstairs over b 0..B, at UP (the height of the jet bridges'
 *                  floor, world/apron.js ROT_FLOOR): gate seats along the glass
 *                  (which is real: the apron is out there), a walkway, shops
 *                  backing onto the hall, the airline lounge at one end
 *   CORRIDOR       downstairs along the glass, b < 3.6: the apron doors open
 *                  into it, and a stair from each passage goes up to the gates
 *
 * The downstairs glass cannot be seen out of: world/apron.js has a 2.6 m
 * spandrel along both long walls. That is why the gates are upstairs, as they
 * are at a real two-level terminal.
 *
 * A hub's terminal is a kilometre long: only a core of it, CORE_U either side of
 * the middle, is fitted out, with a wall across each end.
 */
import { terminalDoors, DOOR, ENTRANCES_U } from '../life/doors.js';

/** Metres. */
export const UP = 4.6;
export const FLOOR = 0.06;
/** The ceiling, upstairs and over the hall; and of the rooms under the concourse. */
export const CEIL = 10.4;
export const CEIL_LOW = 4.3;
const SHOP_DEPTH = 7.5;
const WALKWAY = 5;
const CORE_U = 192;
const CORRIDOR = 3.6;
const PASSAGE = 3;
/** A stair rises 1 in 2. */
export const STAIR_LEN = UP * 2;
const WALL = 0.3;
/** Past this, a rail is not something to jump: as high as a jump gets you, and more. */
const RAIL_SOLID = 2.2;

/** Can this terminal be walked into? Regional and hub passenger terminals. */
export function canWalkIn(lay) {
  const T = lay && lay.terminal;
  return !!(T && T.rect && !lay.military && (lay.shape === 'regional' || lay.shape === 'hub') && T.depth >= 36);
}

/** Take gaps [{ a, b }] out of the span lo..hi; what is left, as [a, b] pairs. */
export function spans(lo, hi, gaps) {
  const out = [];
  let at = lo;
  for (const g of gaps.slice().sort((p, q) => p.a - q.a)) {
    if (g.b <= at || g.a >= hi) continue;
    if (g.a > at) out.push([at, g.a]);
    at = Math.max(at, g.b);
  }
  if (at < hi) out.push([at, hi]);
  return out;
}

/** A rectangle less some holes, as rectangles. */
export function rectLess(r, holes) {
  let list = [r];
  for (const h of holes) {
    const next = [];
    for (const q of list) {
      if (h.u1 <= q.u0 || h.u0 >= q.u1 || h.b1 <= q.b0 || h.b0 >= q.b1) {
        next.push(q);
        continue;
      }
      if (h.b0 > q.b0) next.push({ ...q, b1: h.b0 });
      if (h.b1 < q.b1) next.push({ ...q, b0: h.b1 });
      const b0 = Math.max(q.b0, h.b0);
      const b1 = Math.min(q.b1, h.b1);
      if (h.u0 > q.u0) next.push({ ...q, u1: h.u0, b0, b1 });
      if (h.u1 < q.u1) next.push({ ...q, u0: h.u1, b0, b1 });
    }
    list = next;
  }
  return list;
}

/** The shops along the concourse, in order; the list repeats down a long terminal. All invented. */
export const SHOP_KINDS = Object.freeze(['coffee', 'duty', 'burger', 'tech', 'news', 'pizza', 'style']);

/**
 * Everything about one terminal's inside. `id` strings are stable, for the tests.
 */
export function planInterior(lay) {
  if (!canWalkIn(lay)) return null;
  const T = lay.terminal;
  const F = lay.frame;
  const D = T.depth;
  const H = T.H;
  const u0 = T.u0;
  const u1 = T.u1;
  const mid = (u0 + u1) / 2;
  const cu0 = Math.max(u0, mid - CORE_U);
  const cu1 = Math.min(u1, mid + CORE_U);
  const B = D >= 45 ? 30 : 20;
  const shopB0 = B - SHOP_DEPTH;
  const walkB0 = shopB0 - WALKWAY;
  const inCore = (u) => u > cu0 + 2 && u < cu1 - 2;
  const doors = terminalDoors(lay).filter((d) => inCore(d.u));
  const air = doors.filter((d) => d.side === 'air');
  const land = doors.filter((d) => d.side === 'land');

  const solids = [];
  const solid = (a0, a1, c0, c1, y0, y1, tag = 'a wall') => {
    solids.push({ u0: Math.min(a0, a1), u1: Math.max(a0, a1), b0: Math.min(c0, c1), b1: Math.max(c0, c1), y0, y1, tag });
  };
  const walls = [];
  /** A wall drawn and solid. `axis` 'u': along u at b = at; 'b': along b at u = at. */
  const wall = (axis, lo, hi, at, y0, y1, col = 'wall', solidTop = y1) => {
    walls.push({ axis, lo, hi, at, y0, y1, col });
    if (axis === 'u') solid(lo, hi, at - WALL / 2, at + WALL / 2, y0, solidTop);
    else solid(at - WALL / 2, at + WALL / 2, lo, hi, y0, solidTop);
  };

  /* ---- the building's own walls: whole length, door gaps downstairs ---- */
  const gap = (d) => ({ a: d.u - d.hw - 0.25, b: d.u + d.hw + 0.25 });
  for (const [a, c] of spans(u0, u1, air.map(gap))) solid(a, c, -0.5, 0.3, 0, H);
  for (const [a, c] of spans(u0, u1, land.map(gap))) solid(a, c, D - 0.3, D + 0.55, 0, H);
  for (const d of [...air, ...land]) {
    const g = gap(d);
    const b = d.side === 'air' ? 0 : D;
    solid(g.a, g.b, b - 0.3, b + 0.3, DOOR[d.side].h + 0.1, H);
  }
  solid(u0 - 0.3, u0 + 0.3, 0, D, 0, H);
  solid(u1 - 0.3, u1 + 0.3, 0, D, 0, H);
  // Where the core stops, a wall right across (a hub). On a regional terminal it is the end wall.
  for (const c of [cu0, cu1]) walls.push({ axis: 'b', lo: 0, hi: D, at: c, y0: 0, y1: CEIL, col: 'wall' });
  if (cu0 > u0) solid(cu0 - 0.3, cu0 + 0.3, 0, D, 0, H);
  if (cu1 < u1) solid(cu1 - 0.3, cu1 + 0.3, 0, D, 0, H);

  /* ---- security: a room under the concourse, its lanes through the hall wall ---- */
  const sec = { u0: mid - 24, u1: mid + 1, b0: B - 8, b1: B, lanes: [] };
  const LANE = 4.5;
  for (let k = 0; k < 4; k++) {
    const c = sec.u0 + 2.6 + k * LANE;
    sec.lanes.push({ u: c, id: k + 1 });
    // The scanner and its belt, a long low box; the frame stands beside it.
    solid(c - 0.55, c + 0.55, B - 4.6, B + 2.4, 0, 1.3, 'a scanner');
    solid(c + 0.95, c + 1.1, B - 2.8, B - 2.2, 0, 2.3, 'a scanner');
    solid(c + 2.85, c + 3.0, B - 2.8, B - 2.2, 0, 2.3, 'a scanner');
  }
  const secGap = { a: sec.u0 + 0.4, b: sec.u0 + 0.4 + 4 * LANE };

  /* ---- passages through to the corridor, and the stairs up from them ---- */
  const passU = ENTRANCES_U(Math.min(u1 - u0, 660)).map((o) => mid + o);
  const passages = passU.map((u) => ({ u, u0: u - PASSAGE, u1: u + PASSAGE }));

  const stairs = [];
  /** A stair rising towards +u from uFoot; `holes` keeps its well out of the floor above. */
  const stair = (id, uFoot, b0, b1, kind) => {
    const s = { id, kind, uFoot, u0: uFoot - 1, u1: uFoot + STAIR_LEN, b0, b1 };
    stairs.push(s);
    return s;
  };
  const secStair = stair('security', sec.u1 + 1, shopB0 + 0.5, B - 0.2, 'escalator');
  for (let i = 0; i < passages.length; i++) stair(`gates-${i}`, passages[i].u1 + 1, CORRIDOR + 0.4, CORRIDOR + 4.2, 'stair');

  const holes = stairs.map((s) => ({ u0: s.u0, u1: s.u1, b0: s.b0, b1: s.b1 }));

  /* ---- downstairs walls ---- */
  const passGaps = passages.map((p) => ({ a: p.u0, b: p.u1 }));
  // Hall to everything under the concourse: to the ceiling, with lintels over the ways through.
  for (const [a, c] of spans(cu0, cu1, [secGap, ...passGaps])) wall('u', a, c, B, 0, CEIL);
  for (const g of [secGap, ...passGaps]) {
    walls.push({ axis: 'u', lo: g.a, hi: g.b, at: B, y0: CEIL_LOW, y1: CEIL, col: 'wall' });
    solid(g.a, g.b, B - WALL / 2, B + WALL / 2, CEIL_LOW, CEIL);
  }
  // The corridor's inner wall.
  for (const [a, c] of spans(cu0, cu1, passGaps)) wall('u', a, c, CORRIDOR, 0, CEIL_LOW);
  // Each passage's two sides: the +u one opens into the foot of its stair.
  for (let i = 0; i < passages.length; i++) {
    const p = passages[i];
    const s = stairs[i + 1];
    wall('b', CORRIDOR, B, p.u0, 0, CEIL_LOW);
    for (const [a, c] of spans(CORRIDOR, B, [{ a: s.b0, b: s.b1 }])) wall('b', a, c, p.u1, 0, CEIL_LOW);
  }
  // Security's room: its back wall, its far end, and the end it shares with the hall wall.
  wall('u', sec.u0, sec.u1 + 0.3, sec.b0, 0, CEIL_LOW);
  wall('b', sec.b0, B, sec.u0, 0, CEIL_LOW);
  // Past the lanes, along the wall to the escalator's foot: the room's near end closes at the stair.
  const secEnd = secStair.u0 - 0.4;
  wall('b', sec.b0, secStair.b0, secEnd, 0, CEIL_LOW);

  /* ---- stair sides: solid full height, so nobody walks under one or off one ---- */
  for (const s of stairs) {
    const top = UP + RAIL_SOLID;
    for (const b of [s.b0, s.b1]) solid(s.u0, s.uFoot + STAIR_LEN, b - 0.12, b + 0.12, 0, top, 'a rail');
    // The well's end behind the stair's foot, upstairs.
    solid(s.u0 - 0.12, s.u0 + 0.12, s.b0, s.b1, UP - 0.3, top, 'a rail');
  }

  /* ---- upstairs ---- */
  // The airline lounge has the far end to itself, glass and all.
  const lounge = { u0: cu1 - 34, u1: cu1 - 0.3, b0: 0.3, b1: B };
  // Shops: modules along the hall side of the concourse.
  const shops = [];
  const shopW = 15;
  let n = 0;
  for (const [a, c] of spans(cu0 + 1, lounge.u0 - 1, [{ a: holes[0].u0 - 1, b: holes[0].u1 + 4 }])) {
    const count = Math.floor((c - a) / shopW);
    if (count < 1) continue;
    const w = (c - a) / count;
    for (let k = 0; k < count; k++) {
      const kind = SHOP_KINDS[n % SHOP_KINDS.length];
      shops.push({ id: `shop-${n}`, kind, u0: a + k * w, u1: a + (k + 1) * w, b0: shopB0, b1: B });
      n++;
    }
  }
  for (const s of shops) {
    // Party walls, and the counter or the fittings inside.
    solid(s.u0 - 0.1, s.u0 + 0.1, s.b0, s.b1, UP, CEIL, 'a wall');
    solid(s.u1 - 0.1, s.u1 + 0.1, s.b0, s.b1, UP, CEIL, 'a wall');
    const mu = (s.u0 + s.u1) / 2;
    const fitted = s.u1 - s.u0 - 3;
    if (s.kind === 'tech' || s.kind === 'style') {
      solid(mu - fitted / 2, mu - 0.9, s.b0 + 3, s.b0 + 4.2, UP, UP + 0.95, 'a table');
      solid(mu + 0.9, mu + fitted / 2, s.b0 + 3, s.b0 + 4.2, UP, UP + 0.95, 'a table');
    } else if (s.kind === 'duty' || s.kind === 'news') {
      for (const q of [-1, 1]) solid(mu + q * fitted * 0.32 - 2, mu + q * fitted * 0.32 + 2, s.b0 + 2.6, s.b0 + 3.4, UP, UP + 1.5, 'a shelf');
    } else {
      // A counter along the back: coffee, burgers, pizza.
      solid(mu - fitted / 2, mu + fitted / 2, s.b1 - 3.2, s.b1 - 2.2, UP, UP + 1.1, 'a counter');
      for (const q of [-1, 1]) solid(mu + q * fitted * 0.28 - 0.5, mu + q * fitted * 0.28 + 0.5, s.b0 + 1.4, s.b0 + 2.4, UP, UP + 0.75, 'a table');
    }
  }
  // Its wall across the concourse, with the way in off the walkway.
  const lGap = { a: walkB0 + 0.8, b: walkB0 + 4.2 };
  for (const [a, c] of spans(0.3, B, [lGap])) solid(lounge.u0 - 0.15, lounge.u0 + 0.15, a, c, UP, CEIL, 'a wall');
  solid(lounge.u0 - 0.15, lounge.u0 + 0.15, lGap.a, lGap.b, UP + 3, CEIL, 'a wall');
  lounge.door = lGap;
  // Reception inside the door, armchair groups down the room to the glass.
  lounge.desk = { u: lounge.u0 + 5, b: lGap.b + 2.2 };
  solid(lounge.desk.u - 1.8, lounge.desk.u + 1.8, lounge.desk.b - 0.5, lounge.desk.b + 0.5, UP, UP + 1.1, 'a desk');
  lounge.sets = [];
  for (let a = lounge.u0 + 5; a < lounge.u1 - 2; a += 6.5) {
    for (let c = 2.4; c < B - 1.5; c += 4.2) {
      if (a < lounge.u0 + 9 && c > lGap.a - 1.5 && c < lGap.b + 4) continue;
      lounge.sets.push({ u: a, b: c });
      solid(a - 1.4, a + 1.4, c - 0.85, c + 0.85, UP, UP + 0.8, 'a seat');
    }
  }

  // Gates: one lounge at each apron door, seats along the glass, clear of the stair wells.
  const gates = [];
  const gateW = 14;
  for (const d of air) {
    if (d.u > lounge.u0 - 8) continue;
    const st = (lay.stands || []).find((q) => (q.id ?? q.number) === d.stand) || null;
    const number = st && st.number ? st.number : gates.length + 1;
    // Where the jet bridge's fixed link meets the wall (world/apron.js buildBridges).
    const link = st && st.bridge ? d.u - lay.side * 5.5 : d.u;
    gates.push({ id: `gate-${number}`, number, stand: st, door: d, u: d.u, link, seats: [] });
  }
  gates.sort((p, q) => p.u - q.u);
  const seatBlocks = [];
  const wells = holes.map((h) => ({ a: h.u0 - 1.2, b: h.u1 + 1.2 }));
  gates.forEach((g, i) => {
    const lo = Math.max(g.u - gateW, i ? (gates[i - 1].u + g.u) / 2 + 1 : cu0 + 2);
    const hi = Math.min(g.u + gateW, i < gates.length - 1 ? (gates[i + 1].u + g.u) / 2 - 1 : lounge.u0 - 2);
    g.desk = { u: g.link + 3.2, b: 1.0 };
    solid(g.desk.u - 1.2, g.desk.u + 1.2, 0.55, 1.45, UP, UP + 1.1, 'a desk');
    for (let row = 0; row < 2; row++) {
      const b = 2.9 + row * 2.6;
      if (b + 0.9 > walkB0) continue;
      const clear = row ? wells : [...wells, { a: g.link - 1, b: g.link + 5.4 }];
      for (const [a, c] of spans(lo, hi, clear)) {
        const count = Math.floor((c - a + 2) / 9);
        for (let k = 0; k < count; k++) {
          const q = { gate: g.number, u0: a + k * 9, u1: a + k * 9 + 7, b, row };
          seatBlocks.push(q);
          g.seats.push(q);
          solid(q.u0, q.u1, b - 0.75, b + 0.75, UP, UP + 0.9, 'a seat');
        }
      }
    }
  });

  /* ---- the rails round the stair wells, upstairs (the stair sides stand through them) ---- */
  const rails = [];
  for (const s of stairs) {
    rails.push({ axis: 'u', lo: s.u0, hi: s.uFoot + STAIR_LEN, at: s.b0 });
    rails.push({ axis: 'u', lo: s.u0, hi: s.uFoot + STAIR_LEN, at: s.b1 });
    rails.push({ axis: 'b', lo: s.b0, hi: s.b1, at: s.u0 });
  }

  /* ---- columns ---- */
  const columns = [];
  const col = (u, b) => {
    const clear = (r) => u < r.u0 - 1 || u > r.u1 + 1 || b < r.b0 - 1 || b > r.b1 + 1;
    if (!holes.every(clear)) return;
    if (!passages.every((p) => u < p.u0 - 0.6 || u > p.u1 + 0.6)) return;
    if (u > sec.u0 - 1 && u < sec.u1 + 1 && Math.abs(b - B) < 9) return;
    if (land.some((d) => Math.abs(d.u - u) < 2.6)) return;
    columns.push({ u, b });
    solid(u - 0.45, u + 0.45, b - 0.45, b + 0.45, b < B ? UP : 0, CEIL, 'a column');
  };
  for (let u = cu0 + 9; u < cu1 - 6; u += 18) {
    col(u, D - 5.5);
    col(u, walkB0 + 0.4);
  }

  /* ---- the hall: check-in islands, between the entrances and the security lanes ---- */
  const islands = [];
  const isB = B + 6.5;
  const islandLen = 22;
  const clearH = [...land.map((d) => ({ a: d.u - 7, b: d.u + 7 })), { a: sec.u0 - 3, b: sec.u1 + 3 }, ...passGaps.map((g) => ({ a: g.a - 4, b: g.b + 4 }))];
  for (const [a, c] of spans(cu0 + 3, cu1 - 3, clearH)) {
    const count = Math.floor((c - a + 4) / (islandLen + 4));
    for (let k = 0; k < count; k++) {
      const s0 = a + k * (islandLen + 4);
      islands.push({ id: `island-${islands.length}`, u0: s0, u1: s0 + islandLen, b: isB });
      solid(s0, s0 + islandLen, isB - 1.1, isB + 0.7, 0, 1.15, 'a check-in desk');
    }
  }

  /* ---- where the crowd goes ---- */
  const routes = [
    { y: FLOOR, pts: [[cu0 + 8, D - 3], [cu1 - 8, D - 3]] },
    { y: FLOOR, pts: [[cu0 + 8, B + 2.6], [secGap.a - 3, B + 2.6]] },
    { y: FLOOR, pts: [[sec.u1 + 4, B + 2.6], [cu1 - 8, B + 2.6]] },
    { y: FLOOR, pts: [[cu0 + 6, 1.9], [cu1 - 6, 1.9]] },
    { y: UP + FLOOR, pts: [[cu0 + 6, walkB0 + 2.5], [lounge.u0 - 4, walkB0 + 2.5]] },
    { y: UP + FLOOR, pts: [[cu0 + 10, walkB0 + 1.2], [lounge.u0 - 6, walkB0 + 1.2]] },
    { y: UP + FLOOR, pts: [[cu0 + 12, walkB0 + 3.8], [lounge.u0 - 8, walkB0 + 3.8]] },
  ];

  const P = {
    lay, T, F, D, B, H, mid, cu0, cu1, u0, u1, shopB0, walkB0,
    doors, air, land, solids, walls, stairs, holes, sec, secGap, passages, shops, lounge, gates, seatBlocks, rails, columns, islands, routes,
    upper: { u0: cu0, u1: cu1, b0: 0, b1: B },
    /** Downstairs, the floors there are. */
    lower: [
      { u0: cu0, u1: cu1, b0: B, b1: D },
      { u0: cu0, u1: cu1, b0: 0, b1: CORRIDOR },
      { u0: sec.u0, u1: sec.u1 + 2, b0: sec.b0, b1: B },
      ...passages.map((p) => ({ u0: p.u0, u1: p.u1, b0: CORRIDOR, b1: B })),
    ],
  };
  return P;
}

/** From the building's frame to the world's. */
export function toWorld(P, u, b) {
  return { x: P.F.x(u), z: P.F.z(P.T.front + b) };
}

/** The building's frame from the world's: the frame is a shift and, at most, a flip. */
export function fromWorld(P, x, z) {
  const F = P.F;
  const sx = Math.sign(F.x(1) - F.x(0)) || 1;
  const sz = Math.sign(F.z(1) - F.z(0)) || 1;
  return { u: (x - F.x(0)) * sx, b: (z - F.z(0)) * sz - P.T.front };
}

/**
 * The floor at (u, b) with the feet at `y` (metres over the field), or null
 * outside the building's footprint and its door lobbies.
 */
export function floorIn(P, u, b, y) {
  if (u < P.u0 - 0.5 || u > P.u1 + 0.5) return null;
  const lobby = DOOR.air.depth + 0.2;
  if (b < -lobby || b > P.D + DOOR.land.depth + 0.2) return null;
  if (b < 0 || b > P.D) {
    // A door's lobby floor; the concrete anywhere else.
    const side = b < 0 ? 'air' : 'land';
    return P.doors.some((d) => d.side === side && Math.abs(d.u - u) < DOOR[side].wide) ? FLOOR : null;
  }
  for (const s of P.stairs) {
    if (u >= s.u0 && u <= s.uFoot + STAIR_LEN && b >= s.b0 && b <= s.b1) {
      return FLOOR + Math.max(0, Math.min(UP, ((u - s.uFoot) / STAIR_LEN) * UP));
    }
  }
  return y > 2.6 && b <= P.B ? UP + FLOOR : FLOOR;
}

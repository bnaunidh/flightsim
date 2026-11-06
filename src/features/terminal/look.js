/**
 * The inside of a terminal, drawn from plan.js.
 *
 * No lights: the building is baked. Every surface is a MeshBasicMaterial with
 * its shade in the vertex colours (a face's direction, a little darker at the
 * foot of a wall), so being indoors costs nothing per light, it looks the same
 * on Low, and it stands lit at night. Four merged meshes (fittings on the
 * paint sheet, floors, ceilings, glass) and the boards.
 *
 * The windows are real holes: world/apron.js's curtain wall is one-sided, so
 * from in here it is not drawn, and what is out there is the apron.
 *
 * Built by a generator, a step at a time, so it can be spread across frames.
 */
import * as THREE from '../../vendor/three.module.js';
import { Batch } from '../../world/airport-kit.js';
import { DOOR, ENTRANCE_DOORS, ENTRANCES_U } from '../life/doors.js';
import { UP, FLOOR, CEIL, CEIL_LOW, STAIR_LEN, rectLess, spans } from './plan.js';
import { BRANDS, passengerAirlines } from './atlas.js';

const _c = new THREE.Color();
const WHITE_WALL = 0xeeeeea;
const STEEL = 0x8c939b;
const DARK = 0x2b2f35;
const CARPET = 0x4d5f7a;
const SEAT = 0x2f3b4c;
const SEAT_PAD = 0x4a627f;
const WOOD = 0xa9835c;
const STONE = 0xc9c5bc;

/** Merged triangles: position, colour, uv. One Bake is one draw call. */
class Bake {
  constructor(white = [0, 0]) {
    this.p = [];
    this.c = [];
    this.t = [];
    this.w = white;
  }

  /** A quad from four world points, counter-clockwise from the side it faces; colours bottom and top. */
  quad(a, b, c, d, cb, ct, uv = null) {
    const P = this.p;
    const C = this.c;
    const T = this.t;
    const w = this.w;
    const put = (q, col, u, v) => {
      P.push(q[0], q[1], q[2]);
      C.push(col[0], col[1], col[2]);
      T.push(u, v);
    };
    const [u0, v0, u1, v1] = uv || [w[0], w[1], w[0], w[1]];
    put(a, cb, u0, v0);
    put(b, cb, u1, v0);
    put(c, ct, u1, v1);
    put(a, cb, u0, v0);
    put(c, ct, u1, v1);
    put(d, ct, u0, v1);
  }

  box(x0, x1, y0, y1, z0, z1, hex, ao = 0.84) {
    _c.set(hex);
    const r = _c.r;
    const g = _c.g;
    const b = _c.b;
    const sh = (k) => [r * k, g * k, b * k];
    const top = sh(1);
    this.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], top, top);
    const low = sh(0.74);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], low, low);
    const xs = sh(0.93);
    const xb = sh(0.93 * ao);
    this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], xb, xs);
    this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], xb, xs);
    const zs = sh(0.86);
    const zb = sh(0.86 * ao);
    this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], zb, zs);
    this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], zb, zs);
  }

  mesh(material, name) {
    if (!this.p.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.t, 2));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.castShadow = false;
    m.receiveShadow = false;
    return m;
  }
}

/** What every drawing routine below shares: the plan, the sheet, the frame's flips. */
class Room {
  constructor(P, atlas, elev) {
    this.P = P;
    this.atlas = atlas;
    this.e = elev;
    this.fit = new Bake(atlas.white);
    this.floor = new Bake();
    this.ceil = new Bake();
    this.glass = new Bake();
    this.board = new Bake();
    const F = P.F;
    this.sx = Math.sign(F.x(1) - F.x(0)) || 1;
    this.sz = Math.sign(F.z(1) - F.z(0)) || 1;
  }

  x(u) {
    return this.P.F.x(u);
  }

  z(b) {
    return this.P.F.z(this.P.T.front + b);
  }

  /** A box in the building's frame. */
  box(u0, u1, b0, b1, y0, y1, hex, ao, bake = this.fit) {
    const xa = this.x(u0);
    const xb = this.x(u1);
    const za = this.z(b0);
    const zb = this.z(b1);
    bake.box(Math.min(xa, xb), Math.max(xa, xb), this.e + y0, this.e + y1, Math.min(za, zb), Math.max(za, zb), hex, ao);
  }

  /** A flat floor, tiled in world metres. */
  flat(u0, u1, b0, b1, y, hex, tile = 4.8, bake = this.floor, down = false, k = 1) {
    const xa = Math.min(this.x(u0), this.x(u1));
    const xb = Math.max(this.x(u0), this.x(u1));
    const za = Math.min(this.z(b0), this.z(b1));
    const zb = Math.max(this.z(b0), this.z(b1));
    _c.set(hex);
    const col = [_c.r * k, _c.g * k, _c.b * k];
    const Y = this.e + y;
    const uv = bake === this.fit ? null : [xa / tile, za / tile, xb / tile, zb / tile];
    if (down) bake.quad([xa, Y, za], [xb, Y, za], [xb, Y, zb], [xa, Y, zb], col, col, uv);
    else bake.quad([xa, Y, zb], [xb, Y, zb], [xb, Y, za], [xa, Y, za], col, col, uv);
  }

  /**
   * A flat picture on a wall. (u, b) is its middle, `w` wide, y0..y1; `facing`
   * 'b+' or 'b-' (looks along b), 'u+' or 'u-'. Left and right are worked out
   * from the world, so nothing reads backwards whichever way the frame flips.
   */
  panel(u, b, facing, w, y0, y1, rect, tint = 0xffffff, bake = this.fit, out = 0.03, lit = 1) {
    let nx = 0;
    let nz = 0;
    if (facing[0] === 'b') nz = (facing[1] === '+' ? 1 : -1) * this.sz;
    else nx = (facing[1] === '+' ? 1 : -1) * this.sx;
    const cx = this.x(u) + nx * out;
    const cz = this.z(b) + nz * out;
    const rx = nz;
    const rz = -nx;
    const hw = w / 2;
    const Y0 = this.e + y0;
    const Y1 = this.e + y1;
    _c.set(tint);
    const col = [_c.r * lit, _c.g * lit, _c.b * lit];
    bake.quad(
      [cx - rx * hw, Y0, cz - rz * hw],
      [cx + rx * hw, Y0, cz + rz * hw],
      [cx + rx * hw, Y1, cz + rz * hw],
      [cx - rx * hw, Y1, cz - rz * hw],
      col, col, rect
    );
  }

  /** The same picture hung in mid-air and readable from both sides. */
  hung(u, b, axis, w, y0, y1, rect) {
    const t = 0.1;
    if (axis === 'b') {
      this.box(u - w / 2, u + w / 2, b - t, b + t, y0 - 0.04, y1 + 0.04, DARK);
      this.panel(u, b + t, 'b+', w, y0, y1, rect);
      this.panel(u, b - t, 'b-', w, y0, y1, rect);
    } else {
      this.box(u - t, u + t, b - w / 2, b + w / 2, y0 - 0.04, y1 + 0.04, DARK);
      this.panel(u + t, b, 'u+', w, y0, y1, rect);
      this.panel(u - t, b, 'u-', w, y0, y1, rect);
    }
  }

  /** A sloped quad along u at b, seen from both sides: stair flanks. */
  flank(u0, y0a, y0b, u1, y1a, y1b, b, hex) {
    const xa = this.x(u0);
    const xb = this.x(u1);
    const z = this.z(b);
    const e = this.e;
    _c.set(hex);
    const lo = [_c.r * 0.82, _c.g * 0.82, _c.b * 0.82];
    const hi = [_c.r, _c.g, _c.b];
    const a = [xa, e + y0a, z];
    const c = [xb, e + y1a, z];
    const d = [xb, e + y1b, z];
    const f = [xa, e + y0b, z];
    this.fit.quad(a, c, d, f, lo, hi);
    this.fit.quad(c, a, f, d, lo, hi);
  }
}

/* ------------------------------------------------------------------ */
/* The shell: floors, ceilings, walls, glass                           */
/* ------------------------------------------------------------------ */

function shell(R) {
  const P = R.P;
  const { D, B, cu0, cu1, shopB0, walkB0 } = P;
  // Downstairs floors.
  for (const r of P.lower) R.flat(r.u0, r.u1, r.b0, r.b1, FLOOR, 0xffffff);
  // Upstairs: the slab less the stair wells, carpet at the gates.
  for (const r of rectLess(P.upper, P.holes)) R.flat(r.u0, r.u1, r.b0, r.b1, UP + FLOOR, 0xffffff);
  for (const r of rectLess({ u0: cu0, u1: P.lounge.u0, b0: 0.3, b1: walkB0 }, P.holes)) R.flat(r.u0, r.u1, r.b0, r.b1, UP + FLOOR + 0.008, CARPET, 2.4, R.fit, false, 1);
  // Ceilings: the high one over everything upstairs and the hall.
  R.flat(cu0, cu1, 0, D, CEIL, 0xffffff, 6, R.ceil, true);
  // The low ones over the rooms under the concourse, and the undersides round the stairs.
  for (const r of P.lower) {
    if (r.b0 >= B) continue;
    for (const q of rectLess(r, P.holes)) R.flat(q.u0, q.u1, q.b0, q.b1, CEIL_LOW, 0xe2e4e4, 6, R.ceil, true, 0.92);
  }
  for (const w of P.walls) {
    const t = 0.15;
    const hex = WHITE_WALL;
    if (w.axis === 'u') R.box(w.lo, w.hi, w.at - t, w.at + t, w.y0, w.y1, hex);
    else R.box(w.at - t, w.at + t, w.lo, w.hi, w.y0, w.y1, hex);
    // A stone dado down here, where hands and trolleys are.
    if (w.y0 === 0 && w.y1 <= CEIL) {
      const q = t + 0.015;
      if (w.axis === 'u') R.box(w.lo, w.hi, w.at - q, w.at + q, 0, 1.2, STONE, 0.9);
      else R.box(w.at - q, w.at + q, w.lo, w.hi, 0, 1.2, STONE, 0.9);
    }
  }

  /* ---- the apron wall ---- */
  const gaps = (list) => list.map((d) => ({ a: d.u - d.hw - 0.2, b: d.u + d.hw + 0.2 }));
  const air = gaps(P.air);
  for (const [a, c] of spans(cu0, cu1, air)) R.box(a, c, 0, 0.32, 0, UP + 0.4, WHITE_WALL);
  for (const g of air) R.box(g.a, g.b, 0, 0.32, DOOR.air.h + 0.1, UP + 0.4, WHITE_WALL);
  const glass = (b, facing, y0) => {
    _c.set(0xa8cfe2);
    const col = [_c.r, _c.g, _c.b];
    const xa = Math.min(R.x(cu0), R.x(cu1));
    const xb = Math.max(R.x(cu0), R.x(cu1));
    const z = R.z(b);
    const Y0 = R.e + y0;
    const Y1 = R.e + CEIL;
    const a = [xa, Y0, z];
    const c = [xb, Y0, z];
    const d = [xb, Y1, z];
    const f = [xa, Y1, z];
    if (facing * R.sz > 0) R.glass.quad(a, c, d, f, col, col);
    else R.glass.quad(c, a, f, d, col, col);
  };
  glass(0.12, 1, UP + 0.3);
  // Mullions every bay, a thinner one on the half-bay, a transom and a head.
  for (let u = cu0; u <= cu1; u += 1.5) {
    const heavy = Math.round((u - cu0) / 1.5) % 4 === 0;
    R.box(u - (heavy ? 0.07 : 0.03), u + (heavy ? 0.07 : 0.03), 0.04, heavy ? 0.28 : 0.18, UP + 0.4, CEIL, heavy ? STEEL : 0xa3aab1);
  }
  R.box(cu0, cu1, 0.04, 0.2, UP + 3.0, UP + 3.07, STEEL);
  R.box(cu0, cu1, 0.04, 0.34, CEIL - 0.3, CEIL, DARK);

  /* ---- the kerb wall ---- */
  const land = gaps(P.land);
  for (const [a, c] of spans(cu0, cu1, land)) R.box(a, c, D - 0.32, D, 0, 2.72, WHITE_WALL);
  for (const g of land) R.box(g.a, g.b, D - 0.32, D, DOOR.land.h + 0.1, 3.3, WHITE_WALL);
  glass(D - 0.12, -1, 2.72);
  for (let u = cu0; u <= cu1; u += 3) R.box(u - 0.06, u + 0.06, D - 0.26, D - 0.04, 2.72, CEIL, STEEL);
  R.box(cu0, cu1, D - 0.2, D - 0.04, 6.2, 6.27, STEEL);

  /* ---- timber along the top of the hall wall, and a dark line in the floor to walk by ---- */
  R.box(cu0, cu1, B + 0.15, B + 0.24, CEIL - 1.5, CEIL, WOOD);
  R.flat(cu0 + 1, cu1 - 1, B + 3.3, B + 3.6, FLOOR + 0.006, 0x4a5563, 2.4, R.fit);
  R.flat(cu0 + 1, cu1 - 1, D - 2.0, D - 1.85, FLOOR + 0.006, 0x4a5563, 2.4, R.fit);
  R.flat(cu0 + 1, P.lounge.u0 - 1, walkB0 + 2.4, walkB0 + 2.6, UP + FLOOR + 0.006, 0x4a5563, 2.4, R.fit);

  /* ---- columns ---- */
  for (const c of P.columns) {
    const y0 = c.b < B ? UP + FLOOR : FLOOR;
    R.box(c.u - 0.42, c.u + 0.42, c.b - 0.42, c.b + 0.42, y0, CEIL, 0xe6e8e8);
    R.box(c.u - 0.46, c.u + 0.46, c.b - 0.46, c.b + 0.46, y0, y0 + 1.1, STONE, 0.9);
  }
}

/* ------------------------------------------------------------------ */
/* Stairs and rails                                                    */
/* ------------------------------------------------------------------ */

function stairs(R) {
  const P = R.P;
  for (const s of P.stairs) {
    const n = Math.round(STAIR_LEN / 0.5);
    const dy = UP / n;
    const esc = s.kind === 'escalator';
    const midB = (s.b0 + s.b1) / 2;
    for (let i = 0; i < n; i++) {
      const u = s.uFoot + i * 0.5;
      const y = FLOOR + (i + 0.5) * dy;
      R.box(u, u + 0.5, s.b0, s.b1, y - dy - 0.02, y, esc ? 0x6e747b : 0xd7d5cf, 0.7);
      if (esc) R.box(u, u + 0.06, s.b0 + 0.1, s.b1 - 0.1, y - 0.02, y + 0.005, 0xe8c23a, 1);
    }
    R.box(s.u0 - 0.2, s.uFoot, s.b0, s.b1, 0, FLOOR + 0.01, esc ? 0x8d949c : STONE, 1);
    const yAt = (u) => FLOOR + Math.max(0, Math.min(UP, ((u - s.uFoot) / STAIR_LEN) * UP));
    const uEnd = s.uFoot + STAIR_LEN;
    for (const b of esc ? [s.b0, midB, s.b1] : [s.b0, s.b1]) {
      // The flanks: floor to a metre over the steps.
      R.flank(s.u0, 0, yAt(s.u0) + 1.0, s.uFoot, 0, yAt(s.uFoot) + 1.0, b, esc ? 0xb8bfc6 : WHITE_WALL);
      R.flank(s.uFoot, 0, yAt(s.uFoot) + 1.0, uEnd, 0, yAt(uEnd) + 1.0, b, esc ? 0xb8bfc6 : WHITE_WALL);
      // A dark handrail on top.
      R.flank(s.u0, yAt(s.u0) + 1.0, yAt(s.u0) + 1.09, s.uFoot, yAt(s.uFoot) + 1.0, yAt(s.uFoot) + 1.09, b, 0x17191c);
      R.flank(s.uFoot, yAt(s.uFoot) + 1.0, yAt(s.uFoot) + 1.09, uEnd, yAt(uEnd) + 1.0, yAt(uEnd) + 1.09, b, 0x17191c);
    }
  }
  for (const r of P.rails) {
    const y = UP + FLOOR;
    if (r.axis === 'b') {
      R.box(r.at - 0.03, r.at + 0.03, r.lo, r.hi, y, y + 1.05, 0xa9c7d6);
      R.box(r.at - 0.05, r.at + 0.05, r.lo, r.hi, y + 1.05, y + 1.12, 0x17191c);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The hall: check-in, security, signs                                 */
/* ------------------------------------------------------------------ */

function hall(R) {
  const P = R.P;
  const { D, B, cu0, cu1 } = P;
  const lines = passengerAirlines();
  const A = R.atlas;
  P.islands.forEach((isl, n) => {
    const { u0, u1, b } = isl;
    // Body, top, and a belt along the back.
    R.box(u0, u1, b - 1.1, b + 0.7, 0, 1.0, 0xdfe2e4);
    R.box(u0 - 0.04, u1 + 0.04, b + 0.1, b + 0.74, 1.0, 1.08, WOOD);
    R.box(u0, u1, b - 1.1, b - 0.5, 1.0, 1.1, 0x2c3036);
    // Desks: an airline panel on a tall spine behind each pair.
    R.box(u0 + 0.3, u1 - 0.3, b - 1.3, b - 1.1, 0, 2.9, 0xd9dcde);
    const each = 5.2;
    const count = Math.floor((u1 - u0) / each);
    for (let i = 0; i < count; i++) {
      const c = u0 + (i + 0.5) * ((u1 - u0) / count);
      const l = lines[(n * 3 + i) % lines.length];
      R.panel(c, b - 1.1, 'b+', 3.6, 1.9, 2.8, A.rect(`airline:${l.id}`), 0xffffff, R.fit, 0.01);
      // A screen on the desk.
      R.box(c - 0.3, c + 0.3, b + 0.32, b + 0.38, 1.08, 1.42, 0x20252b);
    }
    // Rope lines out in front.
    const q0 = b + 1.6;
    for (let i = 0; i < count; i++) {
      const c = u0 + (i + 0.5) * ((u1 - u0) / count);
      for (const o of [-1.1, 1.1]) {
        for (const k of [0, 1, 2]) R.box(c + o - 0.04, c + o + 0.04, q0 + k * 1.3 - 0.04, q0 + k * 1.3 + 0.04, 0, 0.98, STEEL);
        R.box(c + o - 0.015, c + o + 0.015, q0, q0 + 2.6, 0.88, 0.94, 0x2d4f7f);
      }
    }
  });
  // A check-in sign over the middle of each run.
  for (const isl of P.islands) R.hung((isl.u0 + isl.u1) / 2, isl.b + 0.1, 'b', 3.6, 6.2, 7.1, A.rect('sign:checkin'));

  /* ---- security ---- */
  const S = P.sec;
  const c0 = (P.secGap.a + P.secGap.b) / 2;
  for (const l of S.lanes) {
    const c = l.u;
    R.box(c - 0.55, c + 0.55, B + 0.2, B + 2.4, 0, 0.82, 0xd7dadc);
    R.box(c - 0.45, c + 0.45, B + 0.2, B + 2.4, 0.82, 0.88, 0x25282c);
    R.box(c - 0.6, c + 0.6, B - 1.7, B + 0.2, 0, 1.75, 0xc7ccd0);
    R.box(c - 0.45, c + 0.45, B - 1.72, B + 0.22, 0.75, 1.18, 0x101215);
    R.box(c - 0.55, c + 0.55, B - 4.6, B - 1.7, 0, 0.82, 0xd7dadc);
    R.box(c - 0.45, c + 0.45, B - 4.6, B - 1.7, 0.82, 0.88, 0x25282c);
    // The walk-through frame.
    R.box(c + 0.95, c + 1.1, B - 2.8, B - 2.2, 0, 2.3, 0xeceef0);
    R.box(c + 2.85, c + 3.0, B - 2.8, B - 2.2, 0, 2.3, 0xeceef0);
    R.box(c + 0.95, c + 3.0, B - 2.8, B - 2.2, 2.3, 2.5, 0xeceef0);
  }
  R.panel(c0, B + 0.17, 'b+', 7.2, 3.3, 4.2, A.rect('sign:security'));
  for (const p of P.passages) {
    R.panel(p.u, B + 0.17, 'b+', 5.6, 3.3, 4.1, A.rect('sign:arrivals'));
    R.hung(p.u, 3.6 + 0.8, 'b', 3.6, 3.2, 3.95, A.rect('sign:upgates'));
  }
  // Posters between the entrances.
  let k = 0;
  for (const [a, c] of spans(cu0 + 4, cu1 - 4, [P.secGap, ...P.passages.map((p) => ({ a: p.u0, b: p.u1 }))].map((g) => ({ a: g.a - 8, b: g.b + 8 })))) {
    const n = Math.max(1, Math.floor((c - a) / 26));
    for (let i = 0; i < n; i++) {
      const u = a + ((i + 0.5) * (c - a)) / n;
      R.box(u - 3.2, u + 3.2, B + 0.15, B + 0.22, 1.5, 4.7, DARK);
      R.panel(u, B + 0.22, 'b+', 6, 1.6, 4.6, A.rect(`ad:${k++ % 4}`), 0xffffff, R.fit, 0.01);
    }
  }
  // Benches along the kerb windows.
  for (let u = cu0 + 14; u < cu1 - 8; u += 22) {
    if (P.land.some((d) => Math.abs(d.u - u) < 8)) continue;
    R.box(u - 2.4, u + 2.4, D - 1.5, D - 1.0, 0.38, 0.46, WOOD);
    R.box(u - 2.2, u - 2.1, D - 1.45, D - 1.05, 0, 0.38, STEEL);
    R.box(u + 2.1, u + 2.2, D - 1.45, D - 1.05, 0, 0.38, STEEL);
  }
}

/* ------------------------------------------------------------------ */
/* Upstairs: gates, shops, the lounge                                  */
/* ------------------------------------------------------------------ */

function seatRow(R, q) {
  const y = UP + FLOOR;
  const { u0, u1, b } = q;
  R.box(u0, u1, b - 0.06, b + 0.06, y + 0.42, y + 0.85, SEAT);
  R.box(u0, u1, b - 0.75, b + 0.75, y + 0.28, y + 0.36, 0x6d747c);
  const n = Math.round((u1 - u0) / 0.62);
  const w = (u1 - u0) / n;
  for (let i = 0; i < n; i++) {
    const a = u0 + i * w + 0.03;
    const c = a + w - 0.06;
    for (const s of [-1, 1]) {
      R.box(a, c, b + s * 0.42 - 0.26, b + s * 0.42 + 0.26, y + 0.36, y + 0.46, SEAT_PAD, 1);
      R.box(a, c, b + s * 0.13 - 0.05, b + s * 0.13 + 0.05, y + 0.46, y + 0.84, SEAT_PAD, 1);
    }
  }
  for (const u of [u0 + 0.4, (u0 + u1) / 2, u1 - 0.4]) R.box(u - 0.05, u + 0.05, b - 0.5, b + 0.5, y, y + 0.28, 0x3a3f46);
}

function gate(R, g) {
  const A = R.atlas;
  const P = R.P;
  const y = UP + FLOOR;
  for (const q of g.seats) seatRow(R, q);
  // The hanging number over the seats, and again at the desk.
  R.hung(g.u, P.walkB0 - 0.2, 'b', 2.4, y + 3.2, y + 4.4, A.rect(`gate:${g.number}`));
  R.box(g.desk.u - 1.2, g.desk.u + 1.2, 0.55, 1.45, y, y + 1.08, 0xdfe2e4);
  R.box(g.desk.u - 1.26, g.desk.u + 1.26, 0.5, 1.5, y + 1.08, y + 1.13, WOOD);
  R.box(g.desk.u - 0.3, g.desk.u + 0.3, 1.0, 1.06, y + 1.13, y + 1.45, 0x20252b);
  // The way onto the bridge: a steel portal at the glass.
  const c = g.link;
  R.box(c - 1.5, c + 1.5, 0.05, 0.36, y + 2.5, y + 3.0, STEEL);
  for (const s of [-1, 1]) R.box(c + s * 1.5 - 0.1, c + s * 1.5 + 0.1, 0.05, 0.36, y, y + 2.5, STEEL);
  R.box(c - 1.4, c + 1.4, 0.2, 0.26, y, y + 2.5, 0x3a4652);
  R.panel(c, 0.36, 'b+', 1.3, y + 2.56, y + 2.95, A.rect(`gate:${g.number}`), 0xffffff, R.fit, 0.01);
}

function shop(R, s) {
  const A = R.atlas;
  const P = R.P;
  const br = BRANDS[s.kind];
  const y = UP + FLOOR;
  const mu = (s.u0 + s.u1) / 2;
  const w = s.u1 - s.u0;
  const fitted = w - 3;
  R.flat(s.u0, s.u1, s.b0, s.b1 - 0.15, y + 0.01, br.floor, 2.4, R.fit, false, 1);
  // Party walls, the back, a low ceiling with lights in it, and the name across the top.
  R.box(s.u0 - 0.1, s.u0 + 0.1, s.b0, s.b1, y, CEIL, br.wall);
  R.box(s.u1 - 0.1, s.u1 + 0.1, s.b0, s.b1, y, CEIL, br.wall);
  R.box(s.u0, s.u1, s.b1 - 0.34, s.b1 - 0.2, y, CEIL, br.wall);
  R.panel(mu, s.b1 - 0.34, 'b-', w - 0.4, y + 0.3, y + 3.4, A.rect(`back:${s.kind}`));
  R.box(s.u0, s.u1, s.b0 + 0.3, s.b1 - 0.2, y + 3.5, y + 3.62, 0xf1efe8);
  for (let u = s.u0 + 2; u < s.u1 - 1; u += 3) R.box(u - 0.5, u + 0.5, s.b0 + 1, s.b1 - 1, y + 3.48, y + 3.5, 0xfffbea, 1);
  R.box(s.u0 - 0.1, s.u1 + 0.1, s.b0 - 0.2, s.b0 + 0.3, y + 3.5, CEIL, 0x2b2f35);
  const sign = Math.min(w - 1.4, 9.6);
  R.panel(mu, s.b0 - 0.2, 'b-', sign, y + 4.0, y + 4.0 + sign * 0.125, A.rect(`fascia:${s.kind}`));
  if (s.kind === 'tech' || s.kind === 'style') {
    for (const q of [-1, 1]) {
      const a = q < 0 ? mu - fitted / 2 : mu + 0.9;
      const c = q < 0 ? mu - 0.9 : mu + fitted / 2;
      R.box(a, c, s.b0 + 3, s.b0 + 4.2, y, y + 0.9, s.kind === 'tech' ? 0xcdb79a : 0xeeeae2);
      R.box(a - 0.03, c + 0.03, s.b0 + 2.97, s.b0 + 4.23, y + 0.9, y + 0.95, s.kind === 'tech' ? 0xd9c7ad : WOOD);
      for (let u = a + 0.5; u < c - 0.4; u += 1.05) {
        if (s.kind === 'tech') {
          R.box(u - 0.2, u + 0.2, s.b0 + 3.35, s.b0 + 3.75, y + 0.95, y + 0.97, 0xb9bdc2);
          R.box(u - 0.2, u + 0.2, s.b0 + 3.75, s.b0 + 3.78, y + 0.97, y + 1.26, 0x20242a);
        } else {
          R.box(u - 0.22, u + 0.22, s.b0 + 3.4, s.b0 + 3.8, y + 0.95, y + 1.05, [0xc8453b, 0x2f6fbd, 0x3a8f63, 0xd9a02e][Math.floor(u * 7) & 3]);
        }
      }
    }
  } else if (s.kind === 'duty' || s.kind === 'news') {
    for (const q of [-1, 1]) {
      const c = mu + q * fitted * 0.32;
      R.box(c - 2, c + 2, s.b0 + 2.6, s.b0 + 3.4, y, y + 1.45, s.kind === 'duty' ? 0x2c4560 : 0xbba98c);
      R.panel(c, s.b0 + 2.6, 'b-', 3.8, y + 0.12, y + 1.4, A.rect(`back:${s.kind}`), 0xffffff, R.fit, 0.01);
      R.panel(c, s.b0 + 3.4, 'b+', 3.8, y + 0.12, y + 1.4, A.rect(`back:${s.kind}`), 0xffffff, R.fit, 0.01);
    }
  } else {
    R.box(mu - fitted / 2, mu + fitted / 2, s.b1 - 3.2, s.b1 - 2.2, y, y + 1.05, br.wall);
    R.box(mu - fitted / 2 - 0.04, mu + fitted / 2 + 0.04, s.b1 - 3.24, s.b1 - 2.16, y + 1.05, y + 1.1, s.kind === 'coffee' ? WOOD : 0xdcdad4);
    for (let u = mu - fitted / 2 + 1; u < mu + fitted / 2; u += 2.2) {
      R.box(u - 0.26, u + 0.26, s.b1 - 2.95, s.b1 - 2.5, y + 1.1, y + 1.42, s.kind === 'coffee' ? 0x8f949a : 0x2e3238);
      R.box(u - 0.03, u + 0.03, s.b1 - 3.1, s.b1 - 3.04, y + 1.1, y + 1.2, 0xd5d8da);
    }
    for (const q of [-1, 1]) {
      const c = mu + q * fitted * 0.28;
      R.box(c - 0.5, c + 0.5, s.b0 + 1.4, s.b0 + 2.4, y + 0.7, y + 0.75, WOOD);
      R.box(c - 0.05, c + 0.05, s.b0 + 1.85, s.b0 + 1.95, y, y + 0.7, 0x3a3f46);
    }
  }
}

function lounge(R) {
  const A = R.atlas;
  const P = R.P;
  const L = P.lounge;
  const y = UP + FLOOR;
  R.flat(L.u0, L.u1, L.b0, L.b1, y + 0.01, 0x9b8a72, 2.4, R.fit, false, 1);
  // Rugs under the armchairs, a lower warm ceiling with lamps in it.
  R.box(L.u0 + 0.3, L.u1 - 0.3, 0.5, L.b1 - 0.4, y + 4.1, y + 4.2, 0xe9dfca);
  for (let u = L.u0 + 4; u < L.u1 - 2; u += 6.5) for (let b = 3; b < L.b1 - 1; b += 4.2) R.box(u - 0.5, u + 0.5, b - 0.5, b + 0.5, y + 4.08, y + 4.1, 0xfff4d8, 1);
  for (const [a, c] of spans(0.3, P.B, [L.door])) R.box(L.u0 - 0.12, L.u0 + 0.12, a, c, y, CEIL, 0x3a332c);
  R.box(L.u0 - 0.12, L.u0 + 0.12, L.door.a, L.door.b, y + 3, CEIL, 0x3a332c);
  const signW = Math.min(9, P.B - 1);
  R.panel(L.u0 - 0.12, (L.door.a + L.door.b) / 2, 'u-', signW, y + 3.5, y + 3.5 + signW * 0.125, A.rect('fascia:lounge'));
  // Warm panelling inside.
  R.box(L.u1 - 0.3, L.u1 - 0.2, L.b0, L.b1, y, CEIL, WOOD);
  R.box(L.u0, L.u1, L.b1 - 0.34, L.b1 - 0.22, y, CEIL, WOOD);
  const d = L.desk;
  R.box(d.u - 1.8, d.u + 1.8, d.b - 0.5, d.b + 0.5, y, y + 1.05, 0x3a2f26);
  R.box(d.u - 1.86, d.u + 1.86, d.b - 0.56, d.b + 0.56, y + 1.05, y + 1.11, 0xd9b774);
  for (const s of L.sets) {
    for (const q of [-1, 1]) {
      const c = s.u + q * 0.8;
      R.box(c - 0.45, c + 0.45, s.b - 0.42, s.b + 0.42, y + 0.1, y + 0.44, 0x3f5a57);
      R.box(c - 0.45, c + 0.45, s.b - 0.42, s.b - 0.2, y + 0.44, y + 0.82, 0x365048);
      for (const a of [-0.45, 0.35]) R.box(c + a, c + a + 0.1, s.b - 0.4, s.b + 0.38, y + 0.44, y + 0.58, 0x2f4744);
      R.box(c - 0.4, c + 0.4, s.b - 0.36, s.b + 0.36, y, y + 0.1, 0x2b2f35);
    }
    R.box(s.u - 0.25, s.u + 0.25, s.b + 0.46, s.b + 0.86, y, y + 0.4, 0x2b2f35);
    R.box(s.u - 0.1, s.u + 0.1, s.b + 0.6, s.b + 0.72, y + 0.4, y + 0.5, 0xe9e6df);
  }
}

/** The door surrounds inside, and where each board hangs. Returns the board placements. */
function boards(R) {
  const P = R.P;
  const { B, secGap, cu0, cu1 } = P;
  const y = UP + FLOOR;
  const c0 = (secGap.a + secGap.b) / 2;
  const list = [];
  // The big one in the hall, over security; a pair in the concourse at the top of the escalator.
  const put = (u, b, facing, w, y0) => {
    const h = w / 2;
    R.box(u - w / 2 - 0.12, u + w / 2 + 0.12, b - 0.1, b + 0.1, y0 - 0.12, y0 + h + 0.12, 0x17191c);
    R.panel(u, b, facing, w, y0, y0 + h, [0, 0, 1, 1], 0xffffff, R.board, 0.12);
    list.push({ u, b, w });
  };
  put(c0, B + 0.2, 'b+', 11, 4.6);
  const e = P.stairs[0];
  put(e.u1 + 4.5, B - 0.2 - 0.1, 'b-', 5.4, y + 1.8);
  for (const g of P.gates) {
    if (Math.abs(g.u - e.u1) < 18) continue;
    // A small screen at each gate, hung beside its number, facing the seats.
    const u = g.u + 3;
    const b = P.walkB0 - 0.2;
    R.box(u - 1.22, u + 1.22, b - 0.05, b + 0.05, y + 3.04, y + 4.36, 0x17191c);
    R.panel(u, b - 0.05, 'b-', 2.3, y + 3.1, y + 4.3, [0, 0, 1, 1], 0xffffff, R.board, 0.01);
    for (const s of [-1, 1]) R.box(u + s - 0.02, u + s + 0.02, b - 0.02, b + 0.02, y + 4.36, CEIL, DARK);
  }
  return { list, cu0, cu1 };
}

/** The steps of the build. Each `yield` is a place to wait for the next frame. */
export function* buildRoom(P, atlas, elev, out) {
  const R = new Room(P, atlas, elev);
  shell(R);
  yield;
  stairs(R);
  yield;
  hall(R);
  yield;
  for (const g of P.gates) {
    gate(R, g);
    yield;
  }
  for (const s of P.shops) {
    shop(R, s);
    yield;
  }
  lounge(R);
  boards(R);
  yield;
  out.fit = R.fit;
  out.floor = R.floor;
  out.ceil = R.ceil;
  out.glass = R.glass;
  out.board = R.board;
}

/**
 * The outside of the two walls the doors go through, with holes in them: the
 * bands world/apron.js drew whole, which this replaces while the building is
 * open (see interior.js). `ap` is the apron, for its material.
 */
export function outerBands(P, ap, elev) {
  const F = P.F;
  const T = P.T;
  const v = new Batch();
  const r = T.rect;
  const W = r.x1 - r.x0;
  const Dp = T.depth;
  const cx = (r.x0 + r.x1) / 2;
  const zFront = F.z(T.front);
  const zBack = F.z(T.back);
  const dz = Math.sign(zBack - zFront);
  const zMid = (zFront + zBack) / 2;
  const WHITE = 0xe8ecef;
  const t = 0.7;
  const y = elev + 1.3;
  const cut = (x0, x1, list, z, thick) => {
    const gaps = list.map((d) => {
      const a = F.x(d.u);
      return { a: a - d.hw - 0.15, b: a + d.hw + 0.15 };
    });
    for (const [a, c] of spans(x0, x1, gaps)) v.box(c - a, 2.6, thick, (a + c) / 2, y, z, WHITE);
  };
  cut(cx - W / 2 - t, cx + W / 2 + t, P.air, zFront - dz * (t / 2 - 0.25), t);
  for (const [ex, s] of [[r.x0, -1], [r.x1, 1]]) v.box(t, 2.6, Dp - 0.5, ex + s * (t / 2 - 0.25), y, zMid, WHITE);
  cut(cx - W / 2 - t, cx + W / 2 + t, P.land, zBack + dz * 0.1, t);
  return v.mesh(ap.mats ? ap.mats.vc : null, { name: 'terminal-bands-cut' });
}

export { ENTRANCE_DOORS, ENTRANCES_U };

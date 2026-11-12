/**
 * The road traffic's better shapes (Medium and up; Low keeps cars.js's boxes).
 *
 * A car here is a lofted body — a nose that tucks in, a bonnet that rises to
 * the scuttle, shoulders with a chamfer that catches the light — under a
 * glasshouse with raked screens and tumblehome, on wheels that are wheels (a
 * tyre, a rim, an arch behind it), with bumpers, lamps, mirrors and door
 * shuts. 350 to 600 triangles: fewer than the downloaded models they replace
 * (1,500), so a street of them costs less than it did.
 *
 * ONE DRAW A KIND, as before. The paint is white and takes the instance's
 * colour; everything that is not paint (glass, tyres, lamps, trim) carries
 * `aFixed` = 1 and keeps its own colour (carPaint() below patches the
 * material: a few lines of vertex shader, no new program per kind).
 *
 * Length along -Z (the nose), width across X, wheels on y = 0: cars.js KINDS
 * gives each kind's box, and every shape here fits inside its own.
 *
 * Pure geometry: `node tests/features/better-models.mjs` builds every kind.
 */
import * as THREE from '../../vendor/three.module.js';

const GLASS = 0x202c38;
const TYRE = 0x141518;
const RIM = 0xa9adb4;
const TRIM = 0x1d1f23;
const LAMP = 0xf3f1e2;
const TAIL = 0xa81616;
const AMBER = 0xe08a1a;
const PLATE = 0xe8e6da;

/** Collects flat-shaded triangles: position, normal, colour, and whether the colour is fixed. */
class Shell {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.col = [];
    this.fix = [];
    this.c = new THREE.Color();
    /** Faces are turned to look away from this point. */
    this.from = [0, 0.7, 0];
  }

  tri(a, b, c, colour, fixed) {
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-9) return;
    nx /= l; ny /= l; nz /= l;
    const f = this.from;
    const out = ((a[0] + b[0] + c[0]) / 3 - f[0]) * nx + ((a[1] + b[1] + c[1]) / 3 - f[1]) * ny + ((a[2] + b[2] + c[2]) / 3 - f[2]) * nz;
    if (out < 0) {
      const t = b; b = c; c = t;
      nx = -nx; ny = -ny; nz = -nz;
    }
    this.c.set(colour);
    for (const p of [a, b, c]) {
      this.pos.push(p[0], p[1], p[2]);
      this.nrm.push(nx, ny, nz);
      this.col.push(this.c.r, this.c.g, this.c.b);
      this.fix.push(fixed ? 1 : 0);
    }
  }

  quad(a, b, c, d, colour, fixed) {
    this.tri(a, b, c, colour, fixed);
    this.tri(a, c, d, colour, fixed);
  }

  /** A convex polygon, as a fan. */
  fan(pts, colour, fixed) {
    for (let i = 1; i < pts.length - 1; i++) this.tri(pts[0], pts[i], pts[i + 1], colour, fixed);
  }

  /** A box by its corners. */
  box(x0, x1, y0, y1, z0, z1, colour, fixed = true) {
    const keep = this.from;
    this.from = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    const P = (x, y, z) => [x, y, z];
    this.quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), colour, fixed);
    this.quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y1, z0), P(x0, y1, z0), colour, fixed);
    this.quad(P(x1, y0, z0), P(x1, y0, z1), P(x1, y1, z1), P(x1, y1, z0), colour, fixed);
    this.quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), colour, fixed);
    this.quad(P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1), colour, fixed);
    this.from = keep;
  }

  /** The part of quad a-b-c-d (a→b along u, a→d along v) between u0..u1 and v0..v1, lifted `lift` off it. */
  patch(a, b, c, d, u0, u1, v0, v1, colour, lift = 0.012) {
    const at = (u, v) => {
      const p = [0, 0, 0];
      for (let k = 0; k < 3; k++) p[k] = (a[k] * (1 - u) + b[k] * u) * (1 - v) + (d[k] * (1 - u) + c[k] * u) * v;
      return p;
    };
    const q = [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)];
    // Off the face, away from the middle of the car.
    let ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    let vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    const f = this.from;
    if ((a[0] - f[0]) * nx + (a[1] - f[1]) * ny + (a[2] - f[2]) * nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
    for (const p of q) { p[0] += nx * lift; p[1] += ny * lift; p[2] += nz * lift; }
    this.quad(q[0], q[1], q[2], q[3], colour, true);
  }

  /** A wheel on the X axis: tyre, sidewall and rim, the outer face at x (side = ±1). */
  wheel(x, z, r, w, side, n = 10) {
    const keep = this.from;
    const xi = x - side * w;
    this.from = [xi, r, z];
    const ring = (rad, xx) => {
      const o = [];
      for (let i = 0; i < n; i++) {
        // (A corner of the tyre on the road: n is even.)
        const a = (i / n) * Math.PI * 2 + Math.PI / 2;
        o.push([xx, r + Math.sin(a) * rad, z + Math.cos(a) * rad]);
      }
      return o;
    };
    const outer = ring(r, x - side * 0.03);
    const inner = ring(r, xi);
    const wall = ring(r * 0.62, x);
    const dish = ring(r * 0.2, x - side * 0.035);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.quad(inner[i], inner[j], outer[j], outer[i], TYRE, true);
      this.quad(outer[i], outer[j], wall[j], wall[i], TYRE, true);
      this.quad(wall[i], wall[j], dish[j], dish[i], RIM, true);
    }
    this.fan(dish, 0x6e7279, true);
    this.from = keep;
  }

  /** The wheel arch: a dark half-disc on the body's side behind the wheel. */
  arch(x, z, r, y0, n = 8) {
    const pts = [[x, y0, z - r], [x, y0, z + r]];
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI;
      pts.push([x, y0 + Math.sin(a) * r * 1.02, z + Math.cos(a) * r]);
    }
    this.fan(pts, 0x0d0e10, true);
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aFixed', new THREE.Float32BufferAttribute(this.fix, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Half the body's width at z, from the stations. */
function halfAt(st, z) {
  if (z <= st[0].z) return st[0].hw;
  for (let i = 1; i < st.length; i++) {
    if (z <= st[i].z) {
      const t = (z - st[i - 1].z) / (st[i].z - st[i - 1].z || 1);
      return st[i - 1].hw + (st[i].hw - st[i - 1].hw) * t;
    }
  }
  return st[st.length - 1].hw;
}

/**
 * The lower body through `st` ([{ z, y1, hw }], nose first), from y0 up: sides, a chamfered
 * shoulder, the top, and the two ends. `paint` its colour (white: the instance's), `fixed`.
 */
function loft(S, st, y0, paint = 0xffffff, fixed = false, ch = 0.07) {
  const sec = (s) => [[-s.hw, y0, s.z], [-s.hw, s.y1 - ch, s.z], [-s.hw + ch, s.y1, s.z], [s.hw - ch, s.y1, s.z], [s.hw, s.y1 - ch, s.z], [s.hw, y0, s.z]];
  for (let i = 0; i < st.length - 1; i++) {
    const a = sec(st[i]);
    const b = sec(st[i + 1]);
    for (let k = 0; k < 5; k++) S.quad(a[k], a[k + 1], b[k + 1], b[k], paint, fixed);
    // The floor: nothing shows through from underneath.
    S.quad(a[0], a[5], b[5], b[0], 0x0c0d0e, true);
  }
  S.fan(sec(st[0]), paint, fixed);
  S.fan(sec(st[st.length - 1]), paint, fixed);
}

/**
 * The glasshouse: base (cf..cb at `belt`, half-width bw) to roof (rf..rb at `roof`, half-width rw).
 * `side`: the side windows as [u0, u1] spans along the car (none: a panel van). `rear`: a rear window.
 */
function cabin(S, { cf, cb, rf, rb, belt, roof, bw, rw, side = [[0.05, 0.47], [0.53, 0.95]], rear = true, screen = [0.06, 0.94, 0.1, 0.9], paint = 0xffffff, fixed = false }) {
  const A = [-bw, belt, cf], B = [bw, belt, cf], C = [bw, belt, cb], D = [-bw, belt, cb];
  const a = [-rw, roof, rf], b = [rw, roof, rf], c = [rw, roof, rb], d = [-rw, roof, rb];
  const keep = S.from;
  S.from = [0, belt - 0.1, (cf + cb) / 2];
  S.quad(A, B, b, a, paint, fixed);
  S.quad(a, b, c, d, paint, fixed);
  S.quad(D, C, c, d, paint, fixed);
  S.quad(B, C, c, b, paint, fixed);
  S.quad(A, D, d, a, paint, fixed);
  S.patch(A, B, b, a, screen[0], screen[1], screen[2], screen[3], GLASS);
  if (rear) S.patch(D, C, c, d, 0.08, 0.92, 0.14, 0.88, GLASS);
  for (const [u0, u1] of side) {
    S.patch(B, C, c, b, u0, u1, 0.12, 0.9, GLASS);
    S.patch(A, D, d, a, u0, u1, 0.12, 0.9, GLASS);
  }
  S.from = keep;
}

/** Lamps, grille, plate and valance on the nose and the tail. */
function ends(S, st, y0, { grille = true, lampH = 0.13, tailH = 0.14, tall = false } = {}) {
  const n = st[0];
  const t = st[st.length - 1];
  const zf = n.z - 0.008;
  const zr = t.z + 0.008;
  const q = (x0, x1, ya, yb, z, colour) => S.quad([x0, ya, z], [x1, ya, z], [x1, yb, z], [x0, yb, z], colour, true);
  // The nose: lamps at the corners, a grille between, a dark intake under, the plate.
  const ly = n.y1 - 0.1;
  for (const s of [-1, 1]) q(s * (n.hw - 0.3), s * (n.hw - 0.02), ly - lampH, ly, zf, LAMP);
  if (grille) q(-(n.hw - 0.34), n.hw - 0.34, ly - lampH + 0.01, ly - 0.01, zf, TRIM);
  q(-(n.hw - 0.12), n.hw - 0.12, y0 + 0.02, y0 + 0.16, zf, TRIM);
  q(-0.24, 0.24, y0 + 0.19, y0 + 0.3, zf - 0.002, PLATE);
  // The tail: red lamps, an amber corner, the plate, a dark valance.
  const ty = t.y1 - (tall ? 0.5 : 0.08);
  for (const s of [-1, 1]) {
    q(s * (t.hw - 0.34), s * (t.hw - 0.02), ty - tailH, ty, zr, TAIL);
    q(s * (t.hw - 0.12), s * (t.hw - 0.02), ty - tailH - 0.05, ty - tailH - 0.005, zr, AMBER);
  }
  q(-0.24, 0.24, y0 + 0.24, y0 + 0.35, zr + 0.002, PLATE);
  q(-(t.hw - 0.12), t.hw - 0.12, y0 + 0.02, y0 + 0.14, zr, TRIM);
}

/** Four (or six) wheels with their arches, the outer faces just proud of the body. */
function wheels(S, st, axles, r, w, y0) {
  for (const z of axles) {
    const hw = halfAt(st, z);
    for (const s of [-1, 1]) {
      S.arch(s * (hw + 0.006), z, r + 0.085, Math.min(y0, r));
      S.wheel(s * (hw + 0.012), z, r, w, s);
    }
  }
}

/** Mirrors, door shuts, and a sill along the foot of the doors. */
function trim(S, st, y0, { cf, cb, belt, bw, doors = [0.5], mirrors = true }) {
  if (mirrors) for (const s of [-1, 1]) S.box(s * (bw + 0.05) - 0.07, s * (bw + 0.05) + 0.07, belt + 0.02, belt + 0.12, cf + 0.2, cf + 0.28, 0xffffff, false);
  for (const u of doors) {
    const z = cf + (cb - cf) * u;
    const hw = halfAt(st, z) + 0.004;
    for (const s of [-1, 1]) S.quad([s * hw, y0 + 0.06, z - 0.012], [s * hw, y0 + 0.06, z + 0.012], [s * hw, belt - 0.09, z + 0.012], [s * hw, belt - 0.09, z - 0.012], 0x101113, true);
  }
}

/** Saloon, hatchback, estate, SUV, 4x4, jeep, taxi and police car: one recipe, different numbers. */
function carBody(S, k, d) {
  const L = d.L;
  const W = d.W;
  const H = d.H;
  const h = W / 2;
  const P = {
    car: { y0: 0.24, r: 0.32, nose: 0.66, belt: 0.9, cf: 1.2, cb: 0.72, rf: 0.72, rb: 0.5, deck: 0.9, tail: 0.82 },
    hatch: { y0: 0.24, r: 0.31, nose: 0.68, belt: 0.92, cf: 1.02, cb: 0.06, rf: 0.68, rb: 0.36, deck: 0.92, tail: 0.9 },
    estate: { y0: 0.24, r: 0.32, nose: 0.66, belt: 0.9, cf: 1.2, cb: 0.05, rf: 0.72, rb: 0.2, deck: 0.9, tail: 0.88, rails: true },
    suv: { y0: 0.33, r: 0.37, nose: 0.86, belt: 1.06, cf: 1.2, cb: 0.05, rf: 0.6, rb: 0.24, deck: 1.06, tail: 1.02, rails: true, clad: true },
    fourx4: { y0: 0.4, r: 0.42, nose: 1.0, belt: 1.22, cf: 1.35, cb: 0.05, rf: 0.5, rb: 0.16, deck: 1.22, tail: 1.2, rails: true, clad: true, spare: true },
    jeep: { y0: 0.4, r: 0.42, nose: 1.02, belt: 1.16, cf: 1.3, cb: 0.1, rf: 0.14, rb: 0.08, deck: 1.16, tail: 1.14, clad: true, spare: true, square: true },
  }[k === 'taxi' || k === 'police' ? 'car' : k];
  const boxy = P.square ? 0.03 : 0.11;
  const st = [
    { z: -L / 2, y1: P.nose, hw: h - boxy },
    { z: -L / 2 + 0.2, y1: P.nose + 0.08, hw: h - 0.02 },
    { z: -L / 2 + P.cf, y1: P.belt, hw: h },
    { z: L / 2 - Math.max(P.cb, 0.5), y1: P.deck, hw: h },
    { z: L / 2 - 0.18, y1: P.deck - 0.01, hw: h - 0.03 },
    { z: L / 2, y1: P.tail, hw: h - boxy },
  ];
  loft(S, st, P.y0);
  const cab = { cf: -L / 2 + P.cf - 0.04, cb: L / 2 - P.cb, rf: -L / 2 + P.cf + P.rf, rb: L / 2 - P.cb - P.rb, belt: P.belt - 0.02, roof: H - 0.05, bw: h - 0.07, rw: h - (P.square ? 0.12 : 0.22) };
  if (k === 'hatch' || k === 'estate' || k === 'suv' || k === 'fourx4') cab.side = [[0.04, 0.34], [0.38, 0.66], [0.7, 0.95]];
  cabin(S, cab);
  ends(S, st, P.y0, { tall: false });
  const axF = -L / 2 + (P.cf > 1.25 ? 0.95 : 0.84);
  const axR = L / 2 - (P.cb < 0.3 ? 0.78 : 0.92);
  wheels(S, st, [axF, axR], P.r, 0.22, P.y0);
  trim(S, st, P.y0, { cf: cab.cf, cb: cab.cb, belt: P.belt, bw: h, doors: cab.side ? [0.36, 0.68] : [0.5] });
  if (P.clad) {
    // Dark cladding along the sills and round the arches.
    for (const s of [-1, 1]) S.quad([s * (h + 0.005), P.y0, axF + P.r + 0.1], [s * (h + 0.005), P.y0, axR - P.r - 0.1], [s * (h + 0.005), P.y0 + 0.13, axR - P.r - 0.1], [s * (h + 0.005), P.y0 + 0.13, axF + P.r + 0.1], TRIM, true);
  }
  if (P.rails) for (const s of [-1, 1]) S.box(s * (cab.rw - 0.1) - 0.02, s * (cab.rw - 0.1) + 0.02, H - 0.05, H, cab.rf + 0.15, cab.rb - 0.1, TRIM);
  if (P.spare) {
    const keep = S.from;
    S.from = [0, P.r + 0.45, L / 2 - 0.2];
    const n = 10;
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([Math.cos((i / n) * 6.2832) * P.r * 0.92, P.r + 0.45 + Math.sin((i / n) * 6.2832) * P.r * 0.92, L / 2 + 0.16]);
    S.fan(pts, TYRE, true);
    for (let i = 0; i < n; i++) S.quad(pts[i], pts[(i + 1) % n], [pts[(i + 1) % n][0], pts[(i + 1) % n][1], L / 2], [pts[i][0], pts[i][1], L / 2], TYRE, true);
    S.from = keep;
  }
  if (k === 'taxi') S.box(-0.3, 0.3, H - 0.05, H + 0.13, -0.42, -0.2, 0xf4f2e6);
  if (k === 'police') {
    // A dark band along the doors and a steady light bar: nothing here flashes.
    for (const s of [-1, 1]) S.quad([s * (h + 0.005), P.y0 + 0.2, cab.cf + 0.1], [s * (h + 0.005), P.y0 + 0.2, cab.cb - 0.2], [s * (h + 0.005), P.belt - 0.16, cab.cb - 0.2], [s * (h + 0.005), P.belt - 0.16, cab.cf + 0.1], 0x1d3f8a, true);
    S.box(-0.52, -0.04, H - 0.05, H + 0.09, -0.2, 0.05, 0x2c5fd8);
    S.box(0.04, 0.52, H - 0.05, H + 0.09, -0.2, 0.05, 0xc8322a);
  }
}

function pickup(S, d) {
  const { L, W, H } = d;
  const h = W / 2;
  const y0 = 0.36;
  const belt = 1.06;
  const st = [
    { z: -L / 2, y1: 0.86, hw: h - 0.08 },
    { z: -L / 2 + 0.2, y1: 0.96, hw: h - 0.02 },
    { z: -L / 2 + 1.45, y1: belt, hw: h },
    { z: L / 2 - 0.12, y1: belt, hw: h },
    { z: L / 2, y1: belt - 0.02, hw: h - 0.03 },
  ];
  loft(S, st, y0, 0xffffff, false, 0.05);
  const cab = { cf: -L / 2 + 1.4, cb: -L / 2 + 3.25, rf: -L / 2 + 2.0, rb: -L / 2 + 3.15, belt: belt - 0.02, roof: H - 0.04, bw: h - 0.06, rw: h - 0.2 };
  cabin(S, cab);
  // The open bed: its floor dark, below the tops of the sides.
  S.quad([-(h - 0.12), belt + 0.004, cab.cb + 0.06], [h - 0.12, belt + 0.004, cab.cb + 0.06], [h - 0.12, belt + 0.004, L / 2 - 0.1], [-(h - 0.12), belt + 0.004, L / 2 - 0.1], 0x18191b, true);
  ends(S, st, y0);
  wheels(S, st, [-L / 2 + 1.0, L / 2 - 1.2], 0.4, 0.25, y0);
  trim(S, st, y0, { cf: cab.cf, cb: cab.cb, belt, bw: h, doors: [0.5, 1.0] });
}

function van(S, d) {
  const { L, W, H } = d;
  const h = W / 2;
  const y0 = 0.3;
  const belt = 1.12;
  const st = [
    { z: -L / 2, y1: 0.92, hw: h - 0.1 },
    { z: -L / 2 + 0.16, y1: 1.02, hw: h - 0.02 },
    { z: -L / 2 + 0.85, y1: belt, hw: h },
    { z: L / 2 - 0.1, y1: belt, hw: h },
    { z: L / 2, y1: belt, hw: h - 0.03 },
  ];
  loft(S, st, y0, 0xffffff, false, 0.05);
  const cab = { cf: -L / 2 + 0.8, cb: L / 2 - 0.02, rf: -L / 2 + 1.55, rb: L / 2 - 0.06, belt: belt - 0.02, roof: H - 0.04, bw: h - 0.04, rw: h - 0.13, side: [[0.03, 0.24]], rear: false };
  cabin(S, cab);
  // Two small panes in the back doors, and the shut between them.
  for (const s of [-1, 1]) S.quad([s * 0.1, 1.5, L / 2 - 0.02], [s * (h - 0.25), 1.5, L / 2 - 0.02], [s * (h - 0.27), 1.95, L / 2 - 0.04], [s * 0.1, 1.95, L / 2 - 0.04], GLASS, true);
  S.quad([-0.012, y0 + 0.2, L / 2 + 0.006], [0.012, y0 + 0.2, L / 2 + 0.006], [0.012, 1.1, L / 2 + 0.006], [-0.012, 1.1, L / 2 + 0.006], 0x101113, true);
  ends(S, st, y0, { tall: false });
  wheels(S, st, [-L / 2 + 0.95, L / 2 - 1.15], 0.36, 0.24, y0);
  trim(S, st, y0, { cf: cab.cf, cb: cab.cb, belt, bw: h, doors: [0.27, 0.56] });
}

function bus(S, d) {
  const { L, W, H } = d;
  const h = W / 2;
  const y0 = 0.36;
  const belt = 1.3;
  const st = [
    { z: -L / 2, y1: belt, hw: h - 0.06 },
    { z: -L / 2 + 0.2, y1: belt, hw: h },
    { z: L / 2 - 0.2, y1: belt, hw: h },
    { z: L / 2, y1: belt, hw: h - 0.06 },
  ];
  loft(S, st, y0, 0xffffff, false, 0.03);
  const side = [];
  for (let i = 0; i < 8; i++) side.push([0.02 + i * 0.122, 0.02 + i * 0.122 + 0.108]);
  const cab = { cf: -L / 2 + 0.03, cb: L / 2 - 0.03, rf: -L / 2 + 0.22, rb: L / 2 - 0.1, belt, roof: H - 0.22, bw: h - 0.02, rw: h - 0.1, side, screen: [0.04, 0.96, 0.04, 0.78] };
  cabin(S, cab);
  // The destination panel over the screen, a skirt stripe, the doors, and the cooling on the roof.
  S.quad([-(h - 0.3), H - 0.62, -L / 2 + 0.165], [h - 0.3, H - 0.62, -L / 2 + 0.165], [h - 0.3, H - 0.34, -L / 2 + 0.2], [-(h - 0.3), H - 0.34, -L / 2 + 0.2], 0x16181b, true);
  for (const s of [-1, 1]) S.quad([s * (h + 0.005), 0.86, -L / 2 + 0.3], [s * (h + 0.005), 0.86, L / 2 - 0.3], [s * (h + 0.005), 1.0, L / 2 - 0.3], [s * (h + 0.005), 1.0, -L / 2 + 0.3], 0xf0eee6, true);
  for (const z of [-L / 2 + 0.75, 0.6]) S.quad([h + 0.008, y0 + 0.06, z], [h + 0.008, y0 + 0.06, z + 1.15], [h + 0.008, belt + 0.95, z + 1.15], [h + 0.008, belt + 0.95, z], GLASS, true);
  S.box(-0.8, 0.8, H - 0.22, H, -1.6, 1.2, 0xd9dbdc);
  ends(S, st, y0, { grille: false, lampH: 0.16 });
  wheels(S, st, [-L / 2 + 2.1, L / 2 - 2.6], 0.5, 0.3, y0);
}

function truck(S, d) {
  const { L, W, H } = d;
  const h = W / 2;
  const y0 = 0.55;
  const belt = 1.5;
  const zc = -L / 2 + 2.15;
  // The cab: paint. The chassis and the box body behind it: their own colours.
  const st = [
    { z: -L / 2, y1: belt - 0.1, hw: h - 0.1 },
    { z: -L / 2 + 0.14, y1: belt, hw: h - 0.03 },
    { z: zc, y1: belt, hw: h - 0.03 },
  ];
  loft(S, st, y0, 0xffffff, false, 0.05);
  cabin(S, { cf: -L / 2 + 0.12, cb: zc, rf: -L / 2 + 0.5, rb: zc, belt, roof: 2.62, bw: h - 0.05, rw: h - 0.14, side: [[0.1, 0.62]], rear: false, screen: [0.05, 0.95, 0.06, 0.86] });
  S.box(-0.5, 0.5, 0.62, 0.95, zc, L / 2 - 0.1, 0x202226);
  S.box(-h, h, 0.98, H, zc + 0.22, L / 2, 0xe2e0d8);
  // The body's corner posts and its back doors.
  S.quad([-0.012, 1.05, L / 2 + 0.006], [0.012, 1.05, L / 2 + 0.006], [0.012, H - 0.08, L / 2 + 0.006], [-0.012, H - 0.08, L / 2 + 0.006], 0x6a6c70, true);
  for (const s of [-1, 1]) {
    S.quad([s * (h - 0.4), 0.7, L / 2 + 0.006], [s * (h - 0.08), 0.7, L / 2 + 0.006], [s * (h - 0.08), 0.86, L / 2 + 0.006], [s * (h - 0.4), 0.86, L / 2 + 0.006], TAIL, true);
    S.quad([s * (h + 0.004), 0.98, zc + 0.24], [s * (h + 0.004), 0.98, L / 2], [s * (h + 0.004), 1.1, L / 2], [s * (h + 0.004), 1.1, zc + 0.24], 0x8d9096, true);
  }
  // Lamps and grille on the cab's flat nose.
  const zf = -L / 2 - 0.008;
  for (const s of [-1, 1]) S.quad([s * (h - 0.42), 0.72, zf], [s * (h - 0.14), 0.72, zf], [s * (h - 0.14), 0.9, zf], [s * (h - 0.42), 0.9, zf], LAMP, true);
  S.quad([-(h - 0.5), 0.95, zf], [h - 0.5, 0.95, zf], [h - 0.5, 1.32, zf], [-(h - 0.5), 1.32, zf], TRIM, true);
  S.box(-(h - 0.04), h - 0.04, 0.5, 0.68, -L / 2 - 0.06, -L / 2 + 0.1, 0x2a2c30);
  const cabSt = [{ z: -L / 2, hw: h - 0.03 }, { z: L / 2, hw: h - 0.03 }];
  wheels(S, cabSt, [-L / 2 + 1.25, L / 2 - 2.5, L / 2 - 1.15], 0.52, 0.32, 0.9);
  for (const s of [-1, 1]) S.box(s * (h + 0.02) - 0.08, s * (h + 0.02) + 0.08, belt + 0.1, belt + 0.42, -L / 2 + 0.42, -L / 2 + 0.5, 0x202226);
}

/** The kinds this file draws. (A tractor and a fire engine keep their own.) */
export const BETTER_KINDS = Object.freeze(['car', 'taxi', 'police', 'hatch', 'estate', 'suv', 'pickup', 'van', 'jeep', 'fourx4', 'bus', 'truck']);

/** The better shape for `kind` (`d`: its cars.js KINDS entry), or null when there is none. */
export function betterCarGeometry(kind, d) {
  if (!BETTER_KINDS.includes(kind) || !d) return null;
  const S = new Shell();
  S.from = [0, Math.min(0.75, d.H * 0.4), 0];
  if (kind === 'pickup') pickup(S, d);
  else if (kind === 'van') van(S, d);
  else if (kind === 'bus') bus(S, d);
  else if (kind === 'truck') truck(S, d);
  else carBody(S, kind, d);
  return S.geometry();
}

/**
 * Teach a material `aFixed`: a vertex that has it keeps its own colour whatever the instance's.
 * A geometry without the attribute reads 0 (WebGL's default), so it is painted as before.
 */
export function carPaint(mat) {
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aFixed;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = mix(vColor.xyz, color.rgb, aFixed);\n#endif');
  };
  mat.customProgramCacheKey = () => 'car-paint';
  return mat;
}

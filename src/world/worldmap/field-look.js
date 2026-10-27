/**
 * World Map — Preview: how each field's buildings and landmarks are drawn,
 * in the style of the map whose airport it is (worldmap/personas.js).
 *
 * Everything goes into the field's one vertex-coloured Batch (airport-kit.js),
 * so a field is still two draw calls by day however many shelters, silos or
 * radomes it has; the lights at night are one more (glowPoints). Every solid
 * thing is an obstacle box (terrain.js addObstacleAt), like the buildings
 * the field already had.
 *
 * Coordinates: the field's own frame — x along the runway from its centre,
 * z across it (north negative), y up from field elevation — the frame of
 * `a.layout`, `a.extras` and the group outstation.js puts the field in.
 * Landmarks are stored in world coordinates and converted here.
 */
import * as THREE from '../../vendor/three.module.js';
import { addObstacleAt } from '../terrain.js';
import { STYLES, styleOf } from './personas.js';

const ID = new THREE.Matrix4();

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return c.getHex();
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

/**
 * A pitched roof over x0..x1 × z0..z1 at height y, ridge `rise` above it,
 * along the longer side; `over` metres of eave all round. Two slopes and two
 * gable ends.
 */
export function gableRoof(b, x0, x1, z0, z1, y, rise, col, over = 0.8) {
  x0 -= over; x1 += over; z0 -= over; z1 += over;
  const alongX = x1 - x0 >= z1 - z0;
  const end = shade(col, 0.82);
  if (alongX) {
    const zm = (z0 + z1) / 2;
    const top = y + rise;
    b.quad([x0, y, z1], [x1, y, z1], [x1, top, zm], [x0, top, zm], [0, 0, 1, 1], col);
    b.quad([x1, y, z0], [x0, y, z0], [x0, top, zm], [x1, top, zm], [0, 0, 1, 1], col);
    b.tri([x0, y, z0], [x0, y, z1], [x0, top, zm], [0, 0], [1, 0], [0.5, 1], end);
    b.tri([x1, y, z1], [x1, y, z0], [x1, top, zm], [0, 0], [1, 0], [0.5, 1], end);
  } else {
    const xm = (x0 + x1) / 2;
    const top = y + rise;
    b.quad([x1, y, z1], [x1, y, z0], [xm, top, z0], [xm, top, z1], [0, 0, 1, 1], col);
    b.quad([x0, y, z0], [x0, y, z1], [xm, top, z1], [xm, top, z0], [0, 0, 1, 1], col);
    b.tri([x0, y, z1], [x1, y, z1], [xm, top, z1], [0, 0], [1, 0], [0.5, 1], end);
    b.tri([x1, y, z0], [x0, y, z0], [xm, top, z0], [0, 0], [1, 0], [0.5, 1], end);
  }
}

/** A hipped roof (four slopes; a short ridge along the longer side): thatch and chalets. */
export function hipRoof(b, x0, x1, z0, z1, y, rise, col, over = 1.5) {
  x0 -= over; x1 += over; z0 -= over; z1 += over;
  const w = x1 - x0;
  const d = z1 - z0;
  const top = y + rise;
  const alongX = w >= d;
  const inset = (alongX ? d : w) / 2;
  const r0 = alongX ? [x0 + inset, top, (z0 + z1) / 2] : [(x0 + x1) / 2, top, z0 + inset];
  const r1 = alongX ? [x1 - inset, top, (z0 + z1) / 2] : [(x0 + x1) / 2, top, z1 - inset];
  const A = [x0, y, z1];
  const B = [x1, y, z1];
  const C = [x1, y, z0];
  const D = [x0, y, z0];
  const side = shade(col, 0.88);
  if (alongX) {
    b.quad(A, B, r1, r0, [0, 0, 1, 1], col);
    b.quad(C, D, r0, r1, [0, 0, 1, 1], col);
    b.tri(D, A, r0, [0, 0], [1, 0], [0.5, 1], side);
    b.tri(B, C, r1, [0, 0], [1, 0], [0.5, 1], side);
  } else {
    b.quad(B, C, r0, r1, [0, 0, 1, 1], col);
    b.quad(D, A, r1, r0, [0, 0, 1, 1], col);
    b.tri(A, B, r1, [0, 0], [1, 0], [0.5, 1], side);
    b.tri(C, D, r0, [0, 0], [1, 0], [0.5, 1], side);
  }
}

/** A barrel vault: a half (or shallower) cylinder lying along x or z. */
export function vault(b, x0, x1, z0, z1, y, rise, col, alongX = true, seg = 14) {
  const span = alongX ? z1 - z0 : x1 - x0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const r = span / 2;
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false, Math.PI / 2, Math.PI);
  // Axis along z, the arc upwards (see the frame note in the header).
  g.rotateX(Math.PI / 2);
  g.scale(1, rise / r, 1);
  if (alongX) g.rotateY(Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  b.add(g, ID, col);
  g.dispose();
}

function sphere(b, r, x, y, z, col, seg = 14) {
  const g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.7));
  g.translate(x, y, z);
  b.add(g, ID, col);
  g.dispose();
}

/* ------------------------------------------------------------------ */
/* Buildings                                                           */
/* ------------------------------------------------------------------ */

const WINDOW_NIGHT = 0xffe2a8;

/**
 * The terminal in this style. `s` is the plan's rect {x0,x1,z0,z1,h}; the
 * airside face is z1 (towards the runway). Pushes night windows to `night`.
 */
export function terminal(b, s, st, night) {
  // A clubhouse, a pavilion, a chalet or a stilt house is not a kilometre
  // long: on a big field's terminal footprint, a row of them with covered
  // walkways between.
  const low = st.terminal === 'pavilion' || st.terminal === 'cottage' || st.terminal === 'chalet' || st.terminal === 'stilts';
  const W = s.x1 - s.x0;
  if (low && W > 110) {
    const n = Math.max(2, Math.round(W / 95));
    const gap = 16;
    const seg = (W - gap * (n - 1)) / n;
    for (let i = 0; i < n; i++) {
      const x0 = s.x0 + i * (seg + gap);
      // Every other one a storey taller, set back a little: a village, not a terrace.
      const tall = i % 2 === 0;
      const d = s.z1 - s.z0;
      terminalOne(b, { x0, x1: x0 + seg, z0: s.z0 + (tall ? 0 : d * 0.15), z1: s.z1, h: tall ? s.h : s.h * 0.75 }, st, night);
      if (i) b.box(gap + 2, 3.2, 5, x0 - gap / 2, 1.6, s.z1 - 4, shade(st.wall, 0.85));
    }
    return;
  }
  terminalOne(b, s, st, night);
  // Long glazed and block terminals: entrance bays and roof plant every hundred metres or so.
  if (W > 160 && !low && st.terminal !== 'modules') {
    for (let x = s.x0 + 80; x < s.x1 - 40; x += 110) {
      b.box(14, s.h * 1.08, 6, x, (s.h * 1.08) / 2, s.z0 - 3, shade(st.wall, 0.9));
      b.box(8, 2.6, 6, x + 30, s.h + 1.3 + (st.roof === 'wave' ? s.h * 0.2 : 0), (s.z0 + s.z1) / 2, 0x8d9296);
    }
    // The kerb: a canopy along the landside, on columns.
    b.box(W * 0.8, 0.6, 9, (s.x0 + s.x1) / 2, Math.min(7, s.h * 0.4), s.z0 - 5, shade(st.roofCol, 0.95));
    for (let x = s.x0 + W * 0.1; x <= s.x1 - W * 0.1; x += 24) b.box(0.6, Math.min(7, s.h * 0.4), 0.6, x, Math.min(7, s.h * 0.4) / 2, s.z0 - 9, 0x8a8f92);
  }
}

function terminalOne(b, s, st, night) {
  const w = s.x1 - s.x0;
  const d = s.z1 - s.z0;
  const cx = (s.x0 + s.x1) / 2;
  const cz = (s.z0 + s.z1) / 2;
  const h = s.h;
  const T = st.terminal;
  if (T === 'hall') {
    // Gateway: a glazed hall, full height glass on the airside, a pale wave roof floating over it.
    b.box(w, h * 0.35, d, cx, h * 0.175, cz, st.wall);
    b.box(w * 0.985, h * 0.62, 0.5, cx, h * 0.66, s.z1 + 0.25, st.glass);
    b.box(w * 0.985, h * 0.62, 0.5, cx, h * 0.66, s.z0 - 0.25, shade(st.glass, 0.85));
    for (let x = s.x0 + 12; x < s.x1 - 6; x += 18) b.box(0.8, h * 0.62, 1.2, x, h * 0.66, s.z1 + 0.5, st.trim);
    b.box(w, h * 0.65, d - 2, cx, h * 0.675, cz, shade(st.wall, 0.92));
    vault(b, s.x0 - 6, s.x1 + 6, s.z0 - 8, s.z1 + 10, h, h * 0.28, st.roofCol, true);
    night.push([cx, h * 0.6, s.z1 + 1.5, w * 0.9]);
  } else if (T === 'block') {
    // Concrete or brick, punched windows in two rows, a parapet.
    b.box(w, h, d, cx, h / 2, cz, st.wall);
    for (const y of [h * 0.3, h * 0.72]) for (let x = s.x0 + 6; x < s.x1 - 4; x += 9) b.box(5, h * 0.18, 0.4, x, y, s.z1 + 0.2, st.glass);
    b.box(w + 0.8, 1.2, d + 0.8, cx, h + 0.6, cz, shade(st.wall, 0.8));
    if (st.roof === 'sawtooth') {
      for (let x = s.x0; x < s.x1 - 8; x += 16) gableRoof(b, x, x + 16, s.z0, s.z1, h, 5, st.roofCol, 0);
    } else b.box(w - 2, 0.4, d - 2, cx, h + 0.2, cz, st.roofCol);
    night.push([cx, h * 0.5, s.z1 + 1.5, w * 0.8]);
  } else if (T === 'modules') {
    // A polar station: insulated red modules on legs, linked, snow on top.
    const n = Math.max(2, Math.round(w / 28));
    const mw = (w - (n - 1) * 4) / n;
    for (let i = 0; i < n; i++) {
      const x = s.x0 + mw / 2 + i * (mw + 4);
      for (const lx of [-mw / 2 + 1.5, mw / 2 - 1.5]) for (const lz of [-d / 2 + 1.5, d / 2 - 1.5]) b.box(0.6, 2.4, 0.6, x + lx, 1.2, cz + lz, 0x55595c);
      b.box(mw, h - 2.4, d, x, 2.4 + (h - 2.4) / 2, cz, i % 2 ? shade(st.wall, 1.1) : st.wall);
      for (let k = -1; k <= 1; k++) b.box(2.2, 1.2, 0.3, x + k * mw * 0.3, 2.4 + (h - 2.4) * 0.55, s.z1 + 0.15, st.glass);
      b.box(mw + 0.4, 0.5, d + 0.4, x, h + 0.25, cz, st.roofCol);
      if (i) b.box(4, 2.4, 3, x - mw / 2 - 2, 2.4 + 1.6, cz, 0x8a8f92);
    }
    night.push([cx, h * 0.6, s.z1 + 1.5, w * 0.8]);
  } else if (T === 'pavilion') {
    // The tropics: white columns, open sides, a deep thatch overhang.
    b.box(w, 0.6, d, cx, 0.3, cz, 0xd8d0be);
    b.box(w * 0.6, h * 0.62, d * 0.55, cx, h * 0.31, cz, st.wall);
    for (let x = s.x0 + 2; x <= s.x1 - 2; x += 8) for (const z of [s.z0 + 1.5, s.z1 - 1.5]) b.cyl(0.45, 0.5, h * 0.7, x, 0, z, 0xf4f1ea, 8);
    hipRoof(b, s.x0, s.x1, s.z0, s.z1, h * 0.7, h * 0.65, st.roofCol, 3.5);
    night.push([cx, h * 0.35, s.z1, w * 0.6]);
  } else if (T === 'chalet') {
    // Mountains: a stone footing, a timber upper storey, a steep dark roof with deep eaves.
    b.box(w, h * 0.42, d, cx, h * 0.21, cz, 0x8c8a84);
    b.box(w, h * 0.38, d, cx, h * 0.61, cz, st.wall);
    for (let x = s.x0 + 5; x < s.x1 - 3; x += 7) b.box(3.2, h * 0.16, 0.35, x, h * 0.62, s.z1 + 0.2, st.glass);
    gableRoof(b, s.x0, s.x1, s.z0, s.z1, h * 0.8, Math.min(d * 0.55, 9), st.roofCol, 2.2);
    night.push([cx, h * 0.6, s.z1 + 1.5, w * 0.8]);
  } else if (T === 'stilts') {
    // A delta: tarred timber on piles above the flood line.
    for (let x = s.x0 + 2; x <= s.x1 - 2; x += 6) for (const z of [s.z0 + 1.5, s.z1 - 1.5]) b.box(0.5, 2.2, 0.5, x, 1.1, z, 0x3c3226);
    b.box(w, 0.5, d + 3, cx, 2.35, cz + 1.5, 0x6b5a44);
    b.box(w, h - 2.6, d, cx, 2.6 + (h - 2.6) / 2, cz, st.wall);
    for (let x = s.x0 + 4; x < s.x1 - 2; x += 6) b.box(2, 1.2, 0.3, x, 2.6 + (h - 2.6) * 0.5, s.z1 + 0.15, st.glass);
    gableRoof(b, s.x0, s.x1, s.z0, s.z1, h, Math.min(d * 0.45, 6), st.roofCol, 1);
    night.push([cx, h * 0.6, s.z1 + 1.5, w * 0.8]);
  } else if (T === 'cottage') {
    // A clubhouse: rendered or stone walls, small windows, a pitched roof and a chimney.
    const hh = Math.min(h, 8);
    b.box(w, hh, d, cx, hh / 2, cz, st.wall);
    for (let x = s.x0 + 4; x < s.x1 - 2; x += 6) b.box(2.2, 1.6, 0.3, x, hh * 0.5, s.z1 + 0.15, st.glass);
    b.box(2.4, 1.2, 0.35, cx, hh * 0.25 + 0.6, s.z1 + 0.18, st.trim);
    gableRoof(b, s.x0, s.x1, s.z0, s.z1, hh, Math.min(d * 0.45, 6), st.roofCol, 0.7);
    b.box(1.4, 3, 1.4, s.x0 + 3, hh + 2, cz, shade(st.wall, 0.8));
    night.push([cx, hh * 0.5, s.z1 + 1.2, w * 0.7]);
  } else {
    // 'glass': a rendered box with a band of glass along the airside, a flat roof (Kestrel's own).
    b.box(w, h, d, cx, h / 2, cz, st.wall);
    b.box(w * 0.96, h * 0.42, 0.4, cx, h * 0.55, s.z1 + 0.2, st.glass);
    for (let x = s.x0 + 8; x < s.x1 - 4; x += 12) b.box(0.6, h * 0.42, 0.7, x, h * 0.55, s.z1 + 0.4, st.trim);
    b.box(w + 2, 0.8, d + 2, cx, h + 0.4, cz, st.roofCol);
    night.push([cx, h * 0.55, s.z1 + 1.5, w * 0.9]);
  }
  if (st.snow && T !== 'modules') b.box(w * 0.98, 0.3, d * 0.98, cx, (T === 'cottage' ? Math.min(h, 8) : h) + 1.05, cz, 0xf4f7fa);
}

/** The control tower in this style. `s` its rect; `h` the cab floor. */
export function tower(b, s, st, night) {
  const w = s.x1 - s.x0;
  const d = s.z1 - s.z0;
  const cx = (s.x0 + s.x1) / 2;
  const cz = (s.z0 + s.z1) / 2;
  const h = s.h;
  const T = st.tower;
  if (T === 'slender') {
    // A tall tapering shaft and a wide flared cab.
    b.cyl(w * 0.28, w * 0.42, h, cx, 0, cz, st.towerCol, 16);
    b.cyl(w * 0.62, w * 0.36, 2.2, cx, h - 0.2, cz, shade(st.towerCol, 0.9), 16);
    b.cyl(w * 0.7, w * 0.62, 4.6, cx, h + 2, cz, st.glass, 16);
    b.cyl(w * 0.76, w * 0.7, 0.9, cx, h + 6.6, cz, st.trim, 16);
    b.cyl(0.3, 0.3, 8, cx, h + 7.5, cz, 0xd0d0d0, 6);
    night.push([cx, h + 4, cz, 3]);
  } else if (T === 'square') {
    // Military: a blocky concrete tower, a glazed square cab, an aerial.
    b.box(w, h, d, cx, h / 2, cz, st.towerCol);
    b.box(w + 3, 4, d + 3, cx, h + 2, cz, st.glass);
    b.box(w + 3.6, 0.8, d + 3.6, cx, h + 4.4, cz, shade(st.towerCol, 0.75));
    b.cyl(0.25, 0.25, 9, cx + w / 3, h + 4.8, cz, 0x9a9a9a, 6);
    if (st.snow) b.box(w + 3.4, 0.3, d + 3.4, cx, h + 4.95, cz, 0xf4f7fa);
    night.push([cx, h + 2, cz, 2]);
  } else if (T === 'club') {
    // A small field: two storeys of the clubhouse's walls and a glass room on top.
    const hh = Math.min(h, 14);
    b.box(w, hh, d, cx, hh / 2, cz, st.towerCol);
    b.box(w + 1.5, 3.2, d + 1.5, cx, hh + 1.6, cz, st.glass);
    if (st.roof === 'gable' || st.roof === 'steep' || st.roof === 'thatch') gableRoof(b, s.x0 - 1, s.x1 + 1, s.z0 - 1, s.z1 + 1, hh + 3.2, 2.4, st.roofCol, 0.4);
    else b.box(w + 2.2, 0.5, d + 2.2, cx, hh + 3.45, cz, st.roofCol);
    night.push([cx, hh + 1.6, cz, 2]);
  } else if (T === 'lattice') {
    // A steel lattice tower with a cab: four legs, braces, the cab on top.
    const o = w / 2 - 0.6;
    for (const [lx, lz] of [[-o, -o], [o, -o], [o, o], [-o, o]]) b.tube(cx + lx, 0, cz + lz, cx + lx * 0.6, h, cz + lz * 0.6, 0.35, st.towerCol, 6);
    for (let y = 4; y < h; y += 5) b.box(w * 0.8 * (1 - (y / h) * 0.4), 0.4, 0.4, cx, y, cz - o * (1 - (y / h) * 0.4), st.towerCol);
    b.box(w * 0.9, 3.6, d * 0.9, cx, h + 1.8, cz, st.glass);
    b.box(w, 0.6, d, cx, h + 3.9, cz, st.roofCol);
    night.push([cx, h + 1.8, cz, 2]);
  } else {
    // 'concrete': Kestrel's shaft, a gallery, a glazed cab and a roof.
    b.box(w, h, d, cx, h / 2, cz, st.towerCol);
    b.box(w + 2.5, 0.6, d + 2.5, cx, h - 0.3, cz, shade(st.towerCol, 0.85));
    b.box(w + 3.5, 4.2, d + 3.5, cx, h + 2.1, cz, st.glass);
    b.box(w + 4.5, 0.6, d + 4.5, cx, h + 4.5, cz, st.roofCol);
    night.push([cx, h + 2.1, cz, 2]);
  }
}

/** A hangar in this style, doors on the airside (z1). */
export function hangar(b, s, st) {
  const w = s.x1 - s.x0;
  const d = s.z1 - s.z0;
  const cx = (s.x0 + s.x1) / 2;
  const cz = (s.z0 + s.z1) / 2;
  const h = s.h;
  const T = st.hangar;
  const door = shade(st.hangarCol, 0.72);
  if (T === 'shelter') {
    // A hardened aircraft shelter: a squat concrete vault, a steel door in front.
    vault(b, s.x0, s.x1, s.z0, s.z1, 0, h, st.hangarCol, false, 12);
    b.box(w * 0.82, h * 0.82, 0.8, cx, h * 0.41, s.z1, door);
  } else if (T === 'quonset') {
    vault(b, s.x0, s.x1, s.z0, s.z1, 0, h, st.hangarCol, false, 14);
    b.box(w * 0.7, h * 0.7, 0.4, cx, h * 0.35, s.z1 + 0.1, door);
    if (st.snow) vault(b, s.x0 + 0.5, s.x1 - 0.5, s.z0 + 0.5, s.z1 - 0.5, h * 0.7, h * 0.32, 0xf4f7fa, false, 10);
  } else if (T === 'barn') {
    // A farm barn: red boards, a gambrel roof (two pitches each side).
    const wall = h * 0.55;
    b.box(w, wall, d, cx, wall / 2, cz, st.hangarCol);
    b.box(w * 0.6, wall * 0.85, 0.3, cx, wall * 0.425, s.z1 + 0.15, 0xe9e2d4);
    gableRoof(b, s.x0, s.x1, s.z0, s.z1, wall, h - wall, 0x4d4a46, 0.6);
  } else if (T === 'shed') {
    // A steel shed: clad walls and a shallow pitch.
    const wall = h * 0.8;
    b.box(w, wall, d, cx, wall / 2, cz, st.hangarCol);
    b.box(w * 0.86, wall * 0.85, 0.3, cx, wall * 0.425, s.z1 + 0.15, door);
    gableRoof(b, s.x0, s.x1, s.z0, s.z1, wall, h * 0.2, shade(st.roofCol, 1), 0.5);
  } else {
    // 'arch': a big maintenance hangar, low walls and a curved roof.
    const wall = h * 0.55;
    b.box(w, wall, d, cx, wall / 2, cz, st.hangarCol);
    vault(b, s.x0, s.x1, s.z0, s.z1, wall, h - wall, shade(st.hangarCol, 0.92), true);
    b.box(w * 0.9, wall * 0.92, 0.3, cx, wall * 0.46, s.z1 + 0.15, door);
  }
}

/* ------------------------------------------------------------------ */
/* Extras and landmarks                                                */
/* ------------------------------------------------------------------ */

/** Height of each extra's solid box (for addObstacleAt), metres. */
function solidH(e) {
  return e.h + (e.kind === 'radome' || e.kind === 'radar' ? 2 : 1);
}

/**
 * One extra (personas.js EXTRA_SIZES) into the batch, in its style. Palms go
 * to `palms` ([x, z, h]) for the caller's instanced trees. Returns false for
 * things that are not solid (paths, bladders).
 */
export function extra(b, e, st, night, palms) {
  const w = e.x1 - e.x0;
  const d = e.z1 - e.z0;
  const cx = (e.x0 + e.x1) / 2;
  const cz = (e.z0 + e.z1) / 2;
  const h = e.h;
  switch (e.kind) {
    case 'concourse': {
      // A second, satellite concourse: a long low glazed block with jet-bridge stubs to the airside.
      b.box(w, h, d, cx, h / 2, cz, st.wall);
      for (const zf of [e.z1 + 0.2, e.z0 - 0.2]) b.box(w * 0.98, h * 0.5, 0.4, cx, h * 0.55, zf, st.glass);
      for (let x = e.x0 + 10; x < e.x1 - 5; x += 12) b.box(0.6, h * 0.5, 0.8, x, h * 0.55, e.z1 + 0.5, st.trim);
      if (st.roof === 'wave') vault(b, e.x0 - 3, e.x1 + 3, e.z0 - 3, e.z1 + 3, h, h * 0.25, st.roofCol, true);
      else b.box(w + 1.6, 0.8, d + 1.6, cx, h + 0.4, cz, st.roofCol);
      night.push([cx, h * 0.55, e.z1 + 1.5, w * 0.9]);
      return true;
    }
    case 'multistorey': {
      // A car park: open decks on columns, cars on each.
      for (let k = 0; k < 4; k++) {
        const y = k * (h / 4);
        b.box(w, 0.6, d, cx, y + 0.3, cz, 0x9b9b96);
        for (let x = e.x0 + 4; x < e.x1 - 3; x += 7) for (const z of [e.z0 + 3, e.z1 - 3]) b.box(0.7, h / 4 - 0.6, 0.7, x, y + h / 8 + 0.3, z, 0x8a8a86);
        for (let x = e.x0 + 4; x < e.x1 - 3; x += 3.2) {
          const q = Math.abs(Math.sin(x * 3.1 + k * 7.7)) % 1;
          if (q < 0.35) continue;
          b.box(1.8, 1.4, 4.2, x, y + 1.3, cz - d / 4, [0xb8bec4, 0x2f3a46, 0x8a1f24, 0xe6e6e0][Math.floor(q * 40) % 4]);
        }
      }
      b.box(w, 1.1, 0.25, cx, h + 0.55, e.z0, 0x8f8f8a);
      b.box(w, 1.1, 0.25, cx, h + 0.55, e.z1, 0x8f8f8a);
      return true;
    }
    case 'cargo':
    case 'warehouses':
    case 'rescue': {
      // A long shed with loading doors; cargo stacks or containers in front.
      b.box(w, h, d, cx, h / 2, cz, e.kind === 'warehouses' ? st.wall : st.hangarCol);
      gableRoof(b, e.x0, e.x1, e.z0, e.z1, h, Math.min(4, d * 0.12), st.roofCol, 0.4);
      for (let x = e.x0 + 8; x < e.x1 - 6; x += 14) b.box(7, h * 0.6, 0.3, x, h * 0.3, e.z1 + 0.15, shade(st.hangarCol, 0.7));
      if (e.kind === 'rescue') b.box(w * 0.3, 1.4, 0.3, cx, h * 0.85, e.z1 + 0.2, 0xd0402a);
      return true;
    }
    case 'shelters':
      vault(b, e.x0, e.x1, e.z0, e.z1, 0, h, st.hangarCol, false, 12);
      b.box(w * 0.84, h * 0.82, 0.9, cx, h * 0.41, e.z1, shade(st.hangarCol, 0.7));
      b.flat(w * 0.9, 22, cx, 0.05, e.z1 + 11, 0x8d8d88);
      return true;
    case 'blastwalls':
      for (let x = e.x0; x < e.x1 - 0.1; x += 3.6) b.box(3.4, h, d * 0.6, x + 1.7, h / 2, cz, 0xa9a49a);
      return true;
    case 'radar': {
      b.box(4, h - 4, 4, cx, (h - 4) / 2, cz, 0x8a8f86);
      b.box(11, 3, 1, cx, h - 2, cz, 0xd9dcdf);
      return true;
    }
    case 'radome': {
      // A radome: a white sphere on a short tower, the way Northwatch has them.
      const r = w / 2 - 1;
      b.box(w * 0.7, h - 2 * r, d * 0.7, cx, (h - 2 * r) / 2, cz, 0x8f9692);
      sphere(b, r, cx, h - r, cz, 0xf2f3f0);
      return true;
    }
    case 'silos':
      for (let i = 0; i < 3; i++) {
        const x = e.x0 + 5 + i * 10;
        b.cyl(4.4, 4.4, h - 3, x, 0, cz, 0xc8ccce, 16);
        b.cyl(0.4, 4.4, 3, x, h - 3, cz, 0x9ea4a8, 16);
      }
      return true;
    case 'barn':
      b.box(w, h * 0.55, d, cx, h * 0.275, cz, 0x9c3a2c);
      gableRoof(b, e.x0, e.x1, e.z0, e.z1, h * 0.55, h * 0.45, 0x4d4a46, 0.6);
      b.box(w * 0.4, h * 0.45, 0.3, cx, h * 0.225, e.z1 + 0.15, 0xe9e2d4);
      return true;
    case 'mast': {
      // A lattice radio mast with red and white bands and a red light on top.
      for (let y = 0; y < h; y += 6) b.box(1.6, 6, 1.6, cx, y + 3, cz, Math.floor(y / 6) % 2 ? 0xe9e9e6 : 0xc8402a);
      for (const [dx, dz] of [[-24, 0], [24, 0], [0, -24]]) b.tube(cx, h * 0.8, cz, cx + dx, 0, cz + dz, 0.06, 0x9a9a9a, 4);
      night.push([cx, h + 0.5, cz, 1.4, 0xff3020]);
      return true;
    }
    case 'boardwalk':
      for (let x = e.x0; x <= e.x1; x += 4) b.box(0.3, 1.6, 0.3, x, 0.8, cz - d / 2, 0x3c3226);
      b.box(w, 0.25, d, cx, 1.4, cz, 0x7a6a52);
      return false;
    case 'palms': {
      // A clump of six to nine palms, leaning a little every which way.
      const n = 6 + (Math.abs(Math.round(cx * 7 + cz * 3)) % 4);
      for (let i = 0; i < n; i++) {
        const q = Math.abs(Math.sin(cx * 12.9898 + cz * 78.233 + i * 37.719) * 43758.5453) % 1;
        const r = Math.abs(Math.sin(cx * 4.1 + i * 9.7) * 1531.7) % 1;
        palms.push([cx + (q - 0.5) * w, cz + (r - 0.5) * d, h * (0.75 + q * 0.5)]);
      }
      return false;
    }
    case 'cabanas':
    case 'huts':
      b.box(w * 0.7, h * 0.5, d * 0.7, cx, h * 0.25, cz, st.wall);
      if (e.kind === 'cabanas') hipRoof(b, e.x0 + w * 0.1, e.x1 - w * 0.1, e.z0 + d * 0.1, e.z1 - d * 0.1, h * 0.5, h * 0.5, st.roofCol, 1.2);
      else gableRoof(b, e.x0 + w * 0.15, e.x1 - w * 0.15, e.z0 + d * 0.15, e.z1 - d * 0.15, h * 0.5, h * 0.4, st.roofCol, 0.4);
      return true;
    case 'watertower':
      for (const [dx, dz] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) b.tube(cx + dx * 1.3, 0, cz + dz * 1.3, cx + dx, h * 0.65, cz + dz, 0.35, 0x6b6560, 6);
      b.cyl(6, 6, h * 0.3, cx, h * 0.65, cz, 0xe9e5dc, 16);
      for (let k = 0; k < 8; k++) b.box(2.4, h * 0.3 + 0.1, 0.2, cx + Math.cos((k / 8) * Math.PI * 2) * 6, h * 0.8, cz + Math.sin((k / 8) * Math.PI * 2) * 6, k % 2 ? 0xc8402a : 0xe9e5dc, -(k / 8) * Math.PI * 2 + Math.PI / 2);
      b.cyl(0.4, 6.4, 1.6, cx, h * 0.95, cz, 0x6b6560, 16);
      return true;
    case 'bladders':
      for (let i = 0; i < 3; i++) b.box(10, h, 18, e.x0 + 7 + i * 13, h / 2, cz, 0x2d3438);
      return false;
    case 'boathouse':
      b.box(w, h * 0.6, d, cx, h * 0.3, cz, st.wall);
      gableRoof(b, e.x0, e.x1, e.z0, e.z1, h * 0.6, h * 0.4, st.roofCol, 0.5);
      b.box(w * 0.5, h * 0.5, 0.3, cx, h * 0.25, e.z1 + 0.15, 0x37506a);
      return true;
    case 'beacon':
      // An aerodrome beacon on a lattice: a white and green light at night.
      for (const [dx, dz] of [[-2, -2], [2, -2], [2, 2], [-2, 2]]) b.tube(cx + dx, 0, cz + dz, cx + dx * 0.4, h, cz + dz * 0.4, 0.2, 0xd8d8d4, 4);
      b.box(2.6, 1.6, 2.6, cx, h + 0.8, cz, 0x2f3438);
      night.push([cx, h + 1, cz, 2.2, 0x9cff9a]);
      return true;
    default:
      return false;
  }
}

/** A landmark (world coordinates in `L`), drawn into the field's batch at its own ground. */
export function landmark(b, L, a, night) {
  const x = L.x - a.x;
  const z = L.z - a.z;
  const y = (L.y || 0) - a.elev;
  if (L.kind === 'lighthouse' || L.kind === 'daymark') {
    const h = L.h;
    if (L.kind === 'lighthouse') {
      // White tower with a red band, a gallery, the lantern and its keeper's cottage.
      b.cyl(2.6, 3.6, h, x, y, z, 0xf2f1ec, 16);
      b.cyl(3.62, 3.62, 4, x, y + h * 0.45, z, 0xb53a2a, 16);
      b.cyl(3.4, 3.0, 0.8, x, y + h, z, 0x2a2f33, 16);
      b.cyl(1.9, 1.9, 3, x, y + h + 0.8, z, 0xdfe8ee, 12);
      b.cyl(0.2, 2.2, 1.8, x, y + h + 3.8, z, 0xb53a2a, 12);
      b.box(9, 4, 6, x + 9, y + 2, z + 4, 0xf2f1ec);
      gableRoof(b, x + 4.5, x + 13.5, z + 1, z + 7, y + 4, 2.4, 0x3d4248, 0.5);
      night.push([x, y + h + 2.3, z, 5, 0xfff2c4]);
    } else {
      // A daymark: a black-and-white banded beacon on a sandbank.
      for (let k = 0; k < 6; k++) b.cyl(2.2 - k * 0.18, 2.4 - k * 0.18, h / 6, x, y + (k * h) / 6, z, k % 2 ? 0x222428 : 0xf2f1ec, 12);
    }
    addObstacleAt(L.x, L.z, 8, 8, (L.y || 0) - 1, L.h + 6, `You flew into the ${L.kind === 'lighthouse' ? 'lighthouse' : 'daymark'}`);
    return;
  }
  if (L.kind === 'cranes') {
    // Dock gantry cranes on the shore, booms raised over the water.
    const ang = ((L.faceDeg || 0) * Math.PI) / 180;
    const fx = Math.sin(ang);
    const fz = -Math.cos(ang);
    const sx = -fz;
    const sz = fx;
    for (let i = 0; i < (L.count || 3); i++) {
      const cx = x + sx * (i - 1) * 40;
      const cz = z + sz * (i - 1) * 40;
      for (const [a1, a2] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
        b.tube(cx + sx * a1 * 8 + fx * a2 * 9, y, cz + sz * a1 * 8 + fz * a2 * 9, cx + sx * a1 * 7 + fx * a2 * 8, y + L.h * 0.62, cz + sz * a1 * 7 + fz * a2 * 8, 0.6, 0xc8402a, 6);
      }
      // The boom out over the water, and the machinery house.
      b.tube(cx - fx * 16, y + L.h * 0.62, cz - fz * 16, cx + fx * 46, y + L.h * 0.62, cz + fz * 46, 1.1, 0xc8402a, 6);
      b.box(10, 6, 10, cx, y + L.h * 0.62 + 3, cz, 0xe9e5dc, -ang);
      b.tube(cx, y + L.h * 0.62 + 6, cz, cx, y + L.h, cz, 0.5, 0xc8402a, 6);
      addObstacleAt(cx, cz, 22, 22, (L.y || 0) - 1, L.h + 2, 'You flew into a dock crane');
    }
    // Stacked containers on the quay behind them.
    for (let i = 0; i < 18; i++) {
      const row = Math.floor(i / 6);
      const col = i % 6;
      const px = x - fx * (24 + row * 4) + sx * (col - 2.5) * 13;
      const pz = z - fz * (24 + row * 4) + sz * (col - 2.5) * 13;
      b.box(12, 2.6, 2.5, px, y + 1.3 + (i % 2) * 2.6, pz, [0x2f6f9a, 0xb84a2e, 0x4a7a3a, 0xd9a032, 0x6a6e72][i % 5], -ang + Math.PI / 2);
    }
    return;
  }
  if (L.kind === 'escort') {
    // A frigate of the carrier group, at anchor beside the carrier: hull, superstructure, mast.
    b.box(16, 8, 130, x, y + 1, z, 0x5d646c);
    b.cyl(0.1, 8, 22, x, y + 1, z - 76, 0x5d646c, 4, { rx: -Math.PI / 2 });
    b.box(12, 10, 34, x, y + 10, z - 8, 0x6b737b);
    b.box(9, 6, 16, x, y + 18, z - 10, 0x737b83);
    b.cyl(0.6, 0.9, 16, x, y + 24, z - 10, 0x4b5259, 6);
    b.box(6, 3, 8, x, y + 6.5, z - 40, 0x6b737b);
    addObstacleAt(L.x, L.z, 18, 140, -6, 42, 'You flew into a frigate of the carrier group');
  }
}

/* ------------------------------------------------------------------ */
/* The apron of a field you did not start from                         */
/* ------------------------------------------------------------------ */

/** Tail colours for the parked airliners: plain paint, no airline (no real names or liveries). */
const TAILS = [0x1f4e8c, 0xb7372a, 0x2e7d5b, 0xe0a428, 0x4b3f8f, 0x1d8a9e, 0x8c2f55, 0x37474f];

/**
 * An airliner as a few boxes and cylinders into the batch, parked with its
 * nose to -z at (x, z): fuselage, nose, wings, engines, tail. `L` length,
 * `S` span. White with a coloured tail.
 */
export function parkedJet(b, x, z, L, S, tail, heavy = false) {
  const r = L * 0.055;
  const body = 0xeef0f2;
  const y = r + 1.6;
  const g = new THREE.CylinderGeometry(r, r, L * 0.78, 10, 1);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z + L * 0.04);
  b.add(g, ID, body);
  g.dispose();
  const n = new THREE.CylinderGeometry(r * 0.25, r, L * 0.12, 10, 1);
  n.rotateX(-Math.PI / 2);
  n.translate(x, y - r * 0.15, z - L * 0.41);
  b.add(n, ID, body);
  n.dispose();
  const t = new THREE.CylinderGeometry(r, r * 0.3, L * 0.14, 10, 1);
  t.rotateX(Math.PI / 2);
  t.translate(x, y + r * 0.2, z + L * 0.5);
  b.add(t, ID, body);
  t.dispose();
  // Swept wings, low on the body; engines under them; the fin and tailplane.
  const sweep = 0.48;
  for (const side of [-1, 1]) {
    b.box(S / 2, 0.5, L * 0.13, x + side * S / 4, y - r * 0.55, z + L * 0.06 + S * 0.12, 0xdfe2e5, -side * sweep);
    b.box(L * 0.2, 0.35, L * 0.06, x + side * L * 0.1, y + r * 0.3, z + L * 0.47, 0xdfe2e5, -side * sweep * 0.9);
    for (const k of heavy ? [0.24, 0.42] : [0.3]) {
      const e = new THREE.CylinderGeometry(r * 0.42, r * 0.38, L * 0.09, 10, 1);
      e.rotateX(Math.PI / 2);
      e.translate(x + side * S * k, y - r * 1.25, z - L * 0.02 + S * k * 0.42);
      b.add(e, ID, 0xc9ccd0);
      e.dispose();
    }
  }
  b.box(0.6, L * 0.17, L * 0.13, x, y + r + L * 0.07, z + L * 0.45, tail);
  // Gear: two dark blocks to stand it on.
  b.box(r * 1.4, 1.6, 2, x, 0.8, z + L * 0.08, 0x2a2d30);
  b.box(0.6, 1.6, 0.8, x, 0.8, z - L * 0.33, 0x2a2d30);
}

/** A light aircraft: high wing, a fuselage, a tail. Nose to -z. */
function parkedLight(b, x, z, col) {
  b.box(1.3, 1.4, 7.4, x, 1.3, z, 0xf2f2f0);
  b.box(10.8, 0.18, 1.5, x, 2.2, z - 0.8, 0xf2f2f0);
  b.box(3.2, 0.12, 0.9, x, 1.5, z + 3.2, 0xf2f2f0);
  b.box(0.12, 1.4, 1.1, x, 2.2, z + 3.3, col);
  b.box(1.2, 0.5, 0.6, x, 1.1, z - 3.8, 0x3a3d40);
}

/**
 * Stands with airliners on them (most occupied, not all), jet bridges at the
 * bigger fields, floodlight masts along the apron, light aircraft on a
 * strip's apron. Pushes night lights. For the outstations only: at the field
 * you start from apron.js parks the real aircraft.
 */
export function apronDressing(b, a, st, night) {
  const lay = a.layout || {};
  const ap = (lay.pavement || []).find((p) => p.kind === 'apron');
  if (!ap) return;
  const cls = lay.cls;
  const seed = (i) => Math.abs(Math.sin((a.x + i * 131.7) * 0.0123 + a.z * 0.0071) * 43758.5453) % 1;
  const t = lay.terminal;
  const bridges = (cls === 'hub' || cls === 'regional') && ['hall', 'glass', 'block'].includes(st.terminal) && t && t.z1 <= ap.z0 + 4;
  if (cls === 'strip' || a.kind === 'ga') {
    for (let x = ap.x0 + 10, i = 0; x < ap.x1 - 8; x += 15, i++) {
      if (seed(i) < 0.35) continue;
      parkedLight(b, x, ap.z0 + 9, TAILS[i % TAILS.length]);
    }
  } else {
    const heavyFirst = cls === 'hub';
    const depth = ap.z1 - ap.z0;
    let x = ap.x0 + 30;
    let i = 0;
    while (x < ap.x1 - 25) {
      const heavy = heavyFirst && i < 3;
      const L = heavy ? 64 : 38;
      const S = heavy ? 62 : 34;
      const pitch = heavy ? 82 : 46;
      const cx = x + pitch / 2 - 4;
      if (cx + S / 2 > ap.x1 - 4 || L + 8 > depth) break;
      if (seed(i) > 0.22) {
        parkedJet(b, cx, ap.z0 + 6 + L / 2, L, S, TAILS[(i * 3 + Math.round(a.x)) % TAILS.length], heavy);
        if (bridges) {
          // The bridge: from the terminal's airside face to the front door, on its wheeled leg.
          b.box(3.4, 3.4, 12, cx - 6, 5.2, ap.z0 + 3, 0xb9bec2);
          b.box(0.9, 4, 0.9, cx - 6, 2, ap.z0 + 8, 0x5a5f63);
          b.cyl(2.6, 2.6, 4, cx - 6, 3.2, ap.z0 - 3, 0x9aa0a4, 10);
        }
      }
      x += pitch;
      i++;
    }
  }
  // Floodlight masts along the back of the apron.
  if (cls !== 'strip') {
    for (let x = ap.x0 + 60; x < ap.x1 - 20; x += 160) {
      const z = ap.z1 + 8;
      b.cyl(0.35, 0.5, 24, x, 0, z, 0x8f9498, 8);
      b.box(4, 1.2, 1, x, 24.4, z, 0x3d4246);
      night.push([x, 23.6, z, 4, 0xfff1d6]);
    }
  }
}

/* ------------------------------------------------------------------ */
/* The far carrier                                                     */
/* ------------------------------------------------------------------ */

/**
 * A carrier as one grey mesh (hull, bow, deck, island): what is drawn past
 * the real ship's range, and where the carrier group lies off a field you
 * did not start from. `deck` is { length, width, y } (carrier.js DECK).
 */
export function carrierProxyGeometry(deck) {
  const L = deck.length;
  const W = deck.width;
  const H = deck.y;
  const b = { pos: [], nrm: [], idx: [] };
  const parts = [];
  const box = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    parts.push(g);
  };
  box(W * 0.62, H, L * 0.86, 0, H / 2 - 2, L * 0.02);
  const bow = new THREE.CylinderGeometry(0.01, W * 0.31, L * 0.14, 3, 1);
  bow.rotateX(-Math.PI / 2);
  bow.rotateZ(Math.PI);
  bow.scale(1, H / (W * 0.31), 1);
  bow.translate(0, H / 2 - 2, -L * 0.48);
  parts.push(bow);
  box(W, 2, L, 0, H, 0);
  box(W * 0.19, H * 0.3, L * 0.1, W * 0.34, H + H * 0.15, L * 0.08);
  let base = 0;
  for (const g of parts) {
    const c = g.attributes.position.count;
    b.pos.push(...g.attributes.position.array);
    b.nrm.push(...g.attributes.normal.array);
    if (g.index) for (let i = 0; i < g.index.count; i++) b.idx.push(g.index.array[i] + base);
    else for (let i = 0; i < c; i++) b.idx.push(i + base);
    base += c;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
  out.setIndex(b.idx);
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/* ------------------------------------------------------------------ */
/* A whole field's dressing                                            */
/* ------------------------------------------------------------------ */

/**
 * The field's extras and landmarks into `b` (and their obstacles). Used for
 * every field: outstation.js for the ones you did not start from, and the
 * World Map feature for the one you did (whose buildings airport.js makes).
 * Returns { palms } for the caller's instanced palms.
 */
export function dress(b, a, night) {
  const st = styleOf(a);
  const palms = [];
  for (const e of a.extras || []) {
    const solid = extra(b, e, st, night, palms);
    if (solid) addObstacleAt(a.x + (e.x0 + e.x1) / 2, a.z + (e.z0 + e.z1) / 2, e.x1 - e.x0 + 1, e.z1 - e.z0 + 1, a.elev - 1, solidH(e), `You flew into the ${e.kind.replace(/s$/, '')} at ${a.name}`);
  }
  for (const L of a.landmarks || []) landmark(b, L, a, night);
  return { palms };
}

export { STYLES };

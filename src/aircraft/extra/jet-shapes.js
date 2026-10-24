/**
 * Fuselages for the aeroplanes added in new-aircraft (./jets.js, ./giants.js):
 * the station tables the models are lofted from, worked out here in plain
 * numbers so that the flight model and the drawing read ONE description.
 *
 * Why this is its own file. The flight model takes the belly, the tyre
 * contact height and the tail-strike point from `shape` (pointsFor() in
 * ../types.js), and the model lofts the skin from a table of stations
 * (src/fleet/extra/jets.js). The three airliners before these typed the
 * strike point in beside the table and measured afterwards that the two
 * agreed. Here the table is generated first and the strike point is SOLVED
 * from it — the tail point is put on the line from the main wheels that just
 * touches the drawn underside — so a change to a tail cone moves the physics
 * with it and cannot leave the tail buried or floating.
 *
 * No THREE in here: the type files import this, and types.js runs in node
 * tests and at boot before anything is drawn.
 *
 * Everything is in metres in the aeroplane's frame: origin at the centre of
 * gravity, -Z forward, +Y up, +X right; the fuselage centreline at y = 0.
 *
 * A STATION is { z, top, bot, w, yc, nT, nB } — the civil kit's hull()
 * station (src/aircraft/models/civil-kit.js): the skin's top and bottom on
 * the centreline, its half-width, the height of its widest point and the
 * superellipse exponents above and below it.
 */

/* ------------------------------------------------------------------ *
 * Interpolation — the hull's own, so the solver sees the drawn underside.
 * ------------------------------------------------------------------ */

/**
 * Monotone cubic (Fritsch–Carlson) through (xs, ys): the same curve
 * civil-kit's hull() draws between stations, copied rather than imported
 * because that module brings THREE with it.
 */
export function monotone(xs, ys) {
  const n = xs.length;
  if (n === 1) return () => ys[0];
  const d = new Array(n - 1);
  const m = new Array(n);
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  return (x) => {
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] > x) hi = mid;
      else lo = mid;
    }
    const h = xs[hi] - xs[lo];
    const t = (x - xs[lo]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[lo] + (t3 - 2 * t2 + t) * h * m[lo] + (-2 * t3 + 3 * t2) * ys[hi] + (t3 - t2) * h * m[hi];
  };
}

/** A station, the fleet airliners' st() in object form. */
export function station(z, top, bot, w, yc, nT = 2, nB = 2) {
  return { z, top, bot, w, yc: yc ?? (top + bot) / 2, nT, nB };
}

const r3 = (v) => Math.round(v * 1000) / 1000;

/* ------------------------------------------------------------------ *
 * Templates
 *
 * Each is a real table drawn for one airframe, kept in that airframe's own
 * metres together with the size it was drawn at, and stretched to another
 * one. Stretching is honest for a nose: an airliner nose is the same shape
 * at every size within a few per cent, and the flight-deck glazing and the
 * pilot's eye are carried in the same coordinates so they stay in it.
 * ------------------------------------------------------------------ */

/**
 * The Airbus nose: the A320's own table (src/fleet/extra/airliners.js),
 * tip at -16.8, full section at -10.6, half-width 1.975, half-height 2.07.
 * A blunt radome with its tip low, a near-flat top to the windscreen, then
 * the break and a long brow over to the crown.
 */
const AIRBUS = {
  z0: -16.8,
  z1: -10.6,
  R: 1.975,
  H: 2.07,
  rows: [
    [-16.8, -0.45, -0.45, 0.0, -0.45],
    [-16.76, -0.22, -0.66, 0.24, -0.44],
    [-16.66, -0.06, -0.83, 0.46, -0.45],
    [-16.45, 0.06, -1.06, 0.74, -0.48],
    [-16.1, 0.15, -1.33, 1.04, -0.52],
    [-15.6, 0.22, -1.58, 1.33, -0.56],
    [-15.0, 0.27, -1.78, 1.57, -0.58, 2.05],
    [-14.6, 0.32, -1.88, 1.69, -0.58, 2.1],
    [-14.3, 0.62, -1.94, 1.77, -0.55, 2.15],
    [-14.0, 0.98, -1.99, 1.83, -0.5, 2.2],
    [-13.6, 1.27, -2.03, 1.88, -0.42, 2.2],
    [-13.1, 1.55, -2.05, 1.92, -0.32, 2.15],
    [-12.4, 1.83, -2.065, 1.95, -0.18, 2.1],
    [-11.6, 2.0, -2.07, 1.97, -0.06, 2.05],
    [-10.6, 2.07, -2.07, 1.975, 0],
  ],
  radomeZ: -14.72,
  // Six panes: two windscreens either side of the centre post, the sliding
  // window and the small rear one — the A320's, in its metres.
  panes: [
    { name: 'Windscreen', wiper: true, corners: [{ z: -14.56, x: 0.07 }, { z: -14.4, y: 0.37 }, { z: -13.99, y: 0.88 }, { z: -14.06, x: 0.07 }] },
    { name: 'Sliding window', corners: [{ z: -14.3, y: 0.37 }, { z: -13.42, y: 0.4 }, { z: -13.46, y: 0.95 }, { z: -13.9, y: 0.9 }] },
    { name: 'Rear side window', corners: [{ z: -13.32, y: 0.41 }, { z: -12.8, y: 0.43 }, { z: -12.96, y: 0.86 }, { z: -13.32, y: 0.94 }] },
  ],
  eye: [-0.52, 0.6, -13.35],
};

/**
 * The Boeing narrow-body nose (the 737's), drawn for this file: a pointed
 * radome whose tip droops below the cabin floor, a longer slope up to a more
 * upright windscreen, and the crown reached sooner. Half-width 1.88,
 * half-height 2.0, 6.4 m from tip to full section.
 */
const BOEING = {
  z0: 0,
  z1: 6.4,
  R: 1.88,
  H: 2.0,
  rows: [
    [0.0, -0.62, -0.62, 0.0, -0.62],
    [0.05, -0.46, -0.78, 0.17, -0.62],
    [0.16, -0.31, -0.94, 0.33, -0.62],
    [0.36, -0.15, -1.13, 0.52, -0.63],
    [0.72, 0.03, -1.38, 0.8, -0.64],
    [1.22, 0.2, -1.61, 1.1, -0.64],
    [1.8, 0.36, -1.82, 1.47, -0.62, 2.05],
    [2.3, 0.46, -1.89, 1.59, -0.6, 2.1],
    [2.62, 0.76, -1.93, 1.66, -0.57, 2.15],
    [2.98, 1.09, -1.96, 1.73, -0.52, 2.2],
    [3.42, 1.36, -1.98, 1.79, -0.44, 2.2],
    [4.02, 1.62, -1.995, 1.83, -0.34, 2.15],
    [4.8, 1.84, -2.0, 1.86, -0.2, 2.1],
    [5.6, 1.96, -2.0, 1.875, -0.07, 2.05],
    [6.4, 2.0, -2.0, 1.88, 0],
  ],
  radomeZ: 2.15,
  panes: [
    { name: 'Windscreen', wiper: true, corners: [{ z: 2.36, x: 0.07 }, { z: 2.5, y: 0.45 }, { z: 2.93, y: 0.94 }, { z: 2.86, x: 0.07 }] },
    { name: 'Sliding window', corners: [{ z: 2.44, y: 0.44 }, { z: 3.3, y: 0.5 }, { z: 3.26, y: 1.02 }, { z: 2.86, y: 0.9 }] },
    { name: 'Rear side window', corners: [{ z: 3.4, y: 0.51 }, { z: 3.92, y: 0.53 }, { z: 3.78, y: 0.96 }, { z: 3.4, y: 1.05 }] },
  ],
  eye: [-0.5, 0.68, 3.45],
};

/**
 * The smooth wide-body nose of the 787 and the A350: no break at the
 * windscreen — the top line runs up from the radome in one curve — and a
 * fuller, rounder chin. Drawn at the A320's size so it stretches the same
 * way; the panes below are the 787's four big ones and its small rear pair.
 */
const SMOOTH = {
  z0: -16.8,
  z1: -10.6,
  R: 1.975,
  H: 2.07,
  rows: [
    [-16.8, -0.42, -0.42, 0.0, -0.42],
    [-16.76, -0.18, -0.64, 0.25, -0.42],
    [-16.66, 0.0, -0.82, 0.48, -0.43],
    [-16.45, 0.15, -1.07, 0.77, -0.45],
    [-16.1, 0.3, -1.35, 1.07, -0.48],
    [-15.6, 0.45, -1.6, 1.36, -0.52],
    [-15.0, 0.62, -1.8, 1.59, -0.53, 2.05],
    [-14.6, 0.78, -1.9, 1.7, -0.52, 2.1],
    [-14.2, 0.98, -1.96, 1.78, -0.49, 2.15],
    [-13.75, 1.2, -2.0, 1.84, -0.44, 2.2],
    [-13.2, 1.44, -2.03, 1.89, -0.36, 2.2],
    [-12.5, 1.7, -2.055, 1.935, -0.24, 2.15],
    [-11.7, 1.93, -2.068, 1.965, -0.1, 2.08],
    [-10.6, 2.07, -2.07, 1.975, 0],
  ],
  radomeZ: -15.05,
  panes: [
    { name: 'Windscreen', wiper: true, corners: [{ z: -14.86, x: 0.07 }, { z: -14.66, y: 0.5 }, { z: -14.08, y: 0.96 }, { z: -14.2, x: 0.07 }] },
    { name: 'Side window', corners: [{ z: -14.56, y: 0.51 }, { z: -13.66, y: 0.54 }, { z: -13.66, y: 1.1 }, { z: -14.0, y: 1.0 }] },
    { name: 'Rear side window', corners: [{ z: -13.56, y: 0.55 }, { z: -13.1, y: 0.57 }, { z: -13.2, y: 0.98 }, { z: -13.56, y: 1.08 }] },
  ],
  eye: [-0.52, 0.66, -13.55],
};

export const NOSES = { airbus: AIRBUS, boeing: BOEING, smooth: SMOOTH };

/**
 * Tail cones: the A320's (narrow) and the 747's (wide), as fractions — z
 * from the end of the parallel section (0) to the tip (1), heights and
 * widths of the full section. The narrow one rounds the crown down as the
 * belly sweeps up; the wide one keeps the crown straight half way, which is
 * the long-haul look, and finishes higher.
 */
export const TAILS = {
  narrow: [
    // [f, top, bot, w] in fractions of the full section's half-height and half-width.
    [0.229, 1.0, -0.865, 0.962],
    [0.458, 0.952, -0.546, 0.82],
    [0.688, 0.86, -0.106, 0.567],
    [0.871, 0.744, 0.242, 0.314],
    [0.963, 0.676, 0.406, 0.152],
    [1.0, 0.604, 0.507, 0.051],
  ],
  wide: [
    [0.175, 1.0, -0.773, 0.96],
    [0.386, 1.0, -0.409, 0.846],
    [0.596, 1.0, -0.042, 0.652],
    [0.789, 0.994, 0.339, 0.431],
    [0.933, 0.961, 0.627, 0.222],
    [1.0, 0.891, 0.806, 0.043],
  ],
};

/* ------------------------------------------------------------------ *
 * The generator
 * ------------------------------------------------------------------ */

/**
 * A template nose stretched to a fuselage: tip at z0, `len` to the full
 * section, half-width R, top T, bottom B (negative), centred at yMid.
 * Returns the stations, the panes, the eye and the radome joint in the same
 * stretched metres.
 */
export function stretchNose(tpl, { z0, len, R, T, B, droop = 0 }) {
  const yMid = (T + B) / 2;
  const kx = R / tpl.R;
  const ky = (T - B) / 2 / tpl.H;
  const kz = len / (tpl.z1 - tpl.z0);
  const Z = (z) => r3(z0 + (z - tpl.z0) * kz);
  // A drooped tip (the 737's) pulls the front stations down a little more,
  // fading to nothing at the full section.
  const f = (z) => (z - tpl.z0) / (tpl.z1 - tpl.z0);
  const Y = (y, z) => r3(yMid + y * ky - droop * Math.max(0, 1 - f(z) / 0.6) ** 2);
  const stations = tpl.rows.map(([z, top, bot, w, yc, nT = 2.0]) => station(Z(z), Y(top, z), Y(bot, z), r3(w * kx), Y(yc, z), nT, 2));
  const corner = (c) => {
    const o = { z: Z(c.z) };
    if (c.x !== undefined) o.x = r3(c.x * kx);
    if (c.y !== undefined) o.y = Y(c.y, c.z);
    return o;
  };
  const panes = tpl.panes.map((p) => ({ ...p, corners: p.corners.map(corner) }));
  const eye = [r3(tpl.eye[0] * kx), Y(tpl.eye[1], tpl.eye[2]), Z(tpl.eye[2])];
  return { stations, panes, eye, radomeZ: Z(tpl.radomeZ), k: Math.min(kx, ky) };
}

/** A template tail cone from the end of the parallel section z0 to the tip z1. */
export function stretchTail(rows, { z0, z1, R, T, B }) {
  const yMid = (T + B) / 2;
  const H = (T - B) / 2;
  return rows.map(([f, top, bot, w]) => {
    const z = r3(z0 + f * (z1 - z0));
    const t = r3(yMid + top * H);
    const b = r3(yMid + bot * H);
    return station(z, t, b, r3(w * R), r3((t + b) / 2));
  });
}

/**
 * The whole fuselage from a short description:
 *
 *   noseZ, length          the tip and the overall length (tail = noseZ + length)
 *   R, T, B                the parallel section's half-width, top and bottom
 *   nose: { style, len, droop }
 *   tail: { style, start } the parallel section ends at `start`
 *   extra: [stations]      anything hand-placed in between (merged by z)
 *
 * Returns { stations, panes, eye, radomeZ, k, tailZ }.
 */
export function fuselage(d) {
  const tailZ = r3(d.noseZ + d.length);
  const n = stretchNose(NOSES[d.nose.style], { z0: d.noseZ, len: d.nose.len, R: d.R, T: d.T, B: d.B, droop: d.nose.droop || 0 });
  const yMid = (d.T + d.B) / 2;
  const full = (z) => station(r3(z), d.T, d.B, d.R, yMid);
  const tail = stretchTail(TAILS[d.tail.style], { z0: d.tail.start, z1: tailZ, R: d.R, T: d.T, B: d.B });
  const stations = [...n.stations, ...(d.extra || []), full(d.tail.start), ...tail].sort((a, b) => a.z - b.z);
  return { stations, panes: n.panes, eye: n.eye, radomeZ: n.radomeZ, k: n.k, tailZ };
}

/* ------------------------------------------------------------------ *
 * The tail strike, solved
 * ------------------------------------------------------------------ */

/**
 * The drawn underside as the hull draws it: the monotone spline through the
 * stations' bottoms.
 */
export function undersideOf(stations) {
  return monotone(stations.map((s) => s.z), stations.map((s) => s.bot));
}

/**
 * The steepest nose-up attitude the aeroplane can sit at on its main wheels
 * before the drawn underside touches the runway: the smallest angle, seen
 * from the main contact point (mainZ, ground), of any point of the underside
 * more than 2 m aft of it — the same measure tests/features/airliners.mjs
 * takes off the built model. Also where it touches.
 */
export function strikeAngle(stations, mainZ, ground, { from = 2, extraPoints = [] } = {}) {
  const bot = undersideOf(stations);
  const zEnd = stations[stations.length - 1].z;
  let best = { deg: 90, z: zEnd, y: bot(zEnd) };
  const test = (z, y) => {
    if (z < mainZ + from) return;
    const deg = (Math.atan2(y - ground, z - mainZ) * 180) / Math.PI;
    if (deg < best.deg) best = { deg, z, y };
  };
  for (let z = mainZ + from; z <= zEnd + 1e-9; z += 0.05) test(z, bot(z));
  for (const [z, y] of extraPoints) test(z, y);
  return best;
}

/**
 * The physics tail point for an airframe. pointsFor() puts it 0.12 × scale
 * below the centreline, scale being belly / 0.82, at 3.95 × bodyLength ×
 * scale aft — so its height is fixed by the belly and only its z is free.
 * It goes on the line from the main contact point at the drawn strike angle
 * less `margin` degrees: the physics strikes a hair before the drawing does,
 * never after.
 */
export function tailStrikeZ(belly, mainZ, ground, deg, margin = 0.25) {
  const y = -0.12 * (belly / 0.82);
  const a = ((deg - margin) * Math.PI) / 180;
  return r3(mainZ + (y - ground) / Math.tan(a));
}

/** Ring stations every `step` between a and b, for a curving tail cone. */
export function ringsBetween(a, b, step) {
  const out = [];
  for (let z = a + step; z < b - step * 0.4; z += step) out.push(+z.toFixed(3));
  return out;
}

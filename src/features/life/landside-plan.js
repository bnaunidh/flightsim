/**
 * What stands on the kerb: every bench, bin, planter, lamp, bollard, flag,
 * trolley bay and shelter on a terminal's forecourt, pure numbers, so the
 * drawing (life/landside-look.js) and the crowd's routes (life/plan.js) agree.
 *
 * In the terminal's frame: u along it, w out from its landside wall. The doors
 * are at the two entrances, a third of the way in from each end. Everything
 * keeps out of the people's two walking lanes:
 *
 *   w 0.6 - 1.6    against the wall: benches, bins
 *   w 3.05 - 3.6   the lane under the canopy, clear of the lobbies' fronts (2.5 and a person's width)
 *   w 4.2 - 5.2    the line of the canopy's columns: benches, planters, bins, trolleys
 *   w 5.6 - 6.4    the lane outside the columns
 *   w 6.6 - 8.4    the kerb's edge: people waiting, shelters, lamps, flags, bollards
 *
 * Nothing on the way out of a door (DOORWAY metres either side of an entrance).
 */
import { KERB_W, CARPARK_W, landsideRing } from '../../world/airport-layout.js';
import { ENTRANCES_U, terminalDoors } from './doors.js';

/** The pavement's edge, metres out from the wall. */
export const KERB_EDGE = KERB_W;
/** The two walking lanes along the kerb: { w0, w1 }. */
export const LANES = Object.freeze([Object.freeze({ w0: 3.05, w1: 3.6 }), Object.freeze({ w0: 5.6, w1: 6.4 })]);
/** Half the width of an entrance and the space in front of it. */
const DOORWAY = 9.5;

/** Footprint of each thing, for the crowd: a circle's radius. */
const R = { bin: 0.32, lamp: 0.2, bollard: 0.12, flag: 0.12, totem: 0.5, sign: 0.14 };
/** ...or a box's half-length along the kerb and half-depth across it. */
const BOX = { bench: [1.0, 0.3], planter: [1.3, 0.55], trolleys: [1.7, 0.5], shelter: [4.3, 0.9] };
/** How far the kerb lane runs out from the road's centre line. */
const LANE = 3.2;

export function landsidePlan(lay) {
  const T = lay && lay.terminal;
  if (!T || !T.rect || lay.military || lay.shape === 'strip') return null;
  const mid = (T.u0 + T.u1) / 2;
  const W = T.u1 - T.u0;
  const half = W * 0.35;
  const doors = ENTRANCES_U(W).map((o) => mid + o);
  const clearOfDoors = (u, m = DOORWAY) => doors.every((d) => Math.abs(u - d) > m);
  const items = [];
  const add = (kind, u, w, extra = {}) => items.push({ kind, u, w, ...extra });

  // Against the wall, either side of each entrance: benches with a bin at the end.
  for (const d of doors) {
    for (const s of [-1, 1]) {
      for (const k of [0, 1]) {
        const u = d + s * (12 + k * 7);
        if (u < T.u0 + 6 || u > T.u1 - 6) continue;
        add('bench', u, 1.05, { face: 1 });
        if (k === 1) add('bin', u + s * 2.2, 1.0);
      }
    }
  }
  // Along the column line: planters and benches turn about, bins and trolleys by the doors.
  const step = W / 9;
  for (let k = -3; k < 3; k++) {
    const u = mid + (k + 0.5) * step;
    if (!clearOfDoors(u, DOORWAY + 1)) continue;
    add(k % 2 ? 'planter' : 'bench', u, 4.7, { face: 1 });
    if (step > 18) add('planter', u + step * 0.26, 4.7);
    if (step > 18) add('bin', u - step * 0.26, 4.7);
  }
  for (const d of doors) for (const s of [-1, 1]) add('trolleys', d + s * 13.5, 4.7);

  // The kerb's edge: lamps the length of the forecourt, and bollards between them.
  const edge = KERB_EDGE;
  for (let u = mid - half - 6; u <= mid + half + 6; u += 26) add('lamp', u, edge - 0.7);
  for (let u = mid - half; u <= mid + half; u += 3.2) {
    // Gaps for the bus, the taxis and the crossings.
    if (Math.abs(u - (mid + half * 0.72)) < 8 || Math.abs(u - (mid - half * 0.72)) < 14 || !clearOfDoors(u, 6)) continue;
    add('bollard', u, edge - 0.3);
  }
  // Six plain flags on tall poles, off to one side of the middle.
  for (let k = 0; k < 6; k++) add('flag', mid - 15 + k * 6, edge - 1.2, { c: k });
  // The bus stop, the taxi rank, and a tall sign at each entrance.
  add('shelter', mid + half * 0.72, 7.4);
  add('sign', mid - half * 0.72 + 10, edge - 0.5, { text: 'TAXI' });
  add('sign', mid + half * 0.72 - 6, edge - 0.5, { text: 'BUS' });
  for (const d of doors) add('totem', d + DOORWAY + 1.5, 7.2, { text: d < mid ? 'DEPARTURES' : 'ARRIVALS' });
  // The stairs up from the car park, at the middle of its near edge.
  const R = landsideRing(lay);
  if (R && R.inRing) add('kiosk', mid, CARPARK_W - 2.2);
  return { mid, W, half, doors, items };
}

/** The bits of a plan a person cannot walk through, in the world: circles { x, z, r }, rectangles. */
export function landsideSolids(lay, plan = landsidePlan(lay)) {
  if (!plan) return [];
  const F = lay.frame;
  const T = lay.terminal;
  const out = [];
  for (const it of plan.items) {
    // The stairs are walked into: their door is on the near face.
    if (it.kind === 'kiosk') continue;
    const q = BOX[it.kind];
    if (q) {
      const a = F.z(T.back + it.w - q[1]);
      const b = F.z(T.back + it.w + q[1]);
      out.push({ x0: F.x(it.u - q[0]), x1: F.x(it.u + q[0]), z0: Math.min(a, b), z1: Math.max(a, b), kind: it.kind });
    } else out.push({ x: F.x(it.u), z: F.z(T.back + it.w), r: R[it.kind] || 0.3, kind: it.kind });
  }
  return out;
}

/** Benches and seats somebody could sit on: { u, w, face }, the wall's first. */
export function seats(plan) {
  return plan ? plan.items.filter((i) => i.kind === 'bench') : [];
}

/* ------------------------------------------------------------------ */
/* The forecourt road                                                  */
/* ------------------------------------------------------------------ */

/** A closed loop of corners [u, w], each rounded to radius r, as points. Starts just after the first corner. */
function rounded(corners, r, seg = 5) {
  const n = corners.length;
  const out = [];
  for (let k = 1; k <= n; k++) {
    const p = corners[(k - 1 + n) % n];
    const c = corners[k % n];
    const q = corners[(k + 1) % n];
    const unit = (a, b) => {
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    };
    const a = unit(c, p);
    const b = unit(c, q);
    // A quarter circle: the corners are square.
    const ox = c[0] + (a[0] + b[0]) * r;
    const oz = c[1] + (a[1] + b[1]) * r;
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * (Math.PI / 2);
      // From the leg we came in on to the leg we leave by.
      out.push([ox - b[0] * r * Math.cos(t) - a[0] * r * Math.sin(t), oz - b[1] * r * Math.cos(t) - a[1] * r * Math.sin(t)]);
    }
  }
  return out;
}

/**
 * The forecourt road, in the world: a one-way loop along the kerb and round the
 * car park, kerb on the driver's right. `ground(x, z)` metres above the field;
 * `free(x, z)` false where something already stands; `level(x, z)` the true ground,
 * which is what decides if there is room (the drawn mesh, `ground`, stands proud of
 * it where it is coarse: on Low, enough to lose the road). Null where there is no
 * loop to lay, or (a World Map field's extras, the sea) no room for it: then the
 * kerb is a pavement, and nothing drives it.
 *
 *   { ring, lane, hw, stops, dirU, near, far, mid, L, zebras }
 *   stops: { id, kind, x, z, d, in: {x, z, y}, kerb: {x, z}, u }
 */
export function forecourtRoad(lay, ground = () => 0, free = () => true, level = ground) {
  const R = landsideRing(lay);
  const plan = landsidePlan(lay);
  if (!R || !plan) return null;
  const F = lay.frame;
  const T = lay.terminal;
  const dirU = -F.side;
  const P = ([u, w]) => ({ x: F.x(u), z: F.z(T.back + w) });
  const box = (L, w0, w1) => [[R.mid - dirU * L, w0], [R.mid + dirU * L, w0], [R.mid + dirU * L, w1], [R.mid - dirU * L, w1]];
  const lift = (q) => ({ ...q, y: ground(q.x, q.z) });
  const ring = rounded(box(R.L, R.nearW, R.farW), 9).map(P);
  const laneW = R.nearW - LANE;
  const raw = rounded(box(R.L + LANE, laneW, R.farW + LANE), 12.2);
  const lane = raw.map(P).map(lift);
  for (const q of ring) if (!free(q.x, q.z) || Math.abs(level(q.x, q.z)) > 1.6) return null;
  // Distance along the near side, from the lane's first point.
  const u0 = raw[0][0];
  const dAt = (u) => dirU * (u - u0);
  const stops = [];
  const stop = (kind, u, doorU, inW = laneW - 0.5, y = -0.5) => {
    const q = P([u, laneW]);
    const a = P([doorU, inW]);
    stops.push({ id: stops.length, kind, u: doorU, x: q.x, z: q.z, d: dAt(u), in: { ...a, y: ground(a.x, a.z) + y }, kerb: lift(P([doorU, KERB_EDGE - 0.5])), r: 1.5 });
  };
  // The taxi rank; a drop-off opposite each entrance's nearer doors, a little behind the car's middle; the bus.
  const taxiU = R.mid - plan.half * 0.72;
  stop('taxi', taxiU, taxiU - dirU * 0.6);
  const land = terminalDoors(lay).filter((d) => d.side === 'land');
  const byEntrance = plan.doors.map((c) => land.filter((d) => Math.abs(d.u - c) < 6).sort((a, b) => dirU * (a.u - b.u))[0]);
  for (const d of byEntrance) stop('car', d.u + dirU * 0.6, d.u);
  const busU = R.mid + plan.half * 0.72;
  stop('bus', busU + dirU * 1.6, busU + dirU * 5.6, laneW - 1.0, 0.25);
  stops.sort((a, b) => a.d - b.d).forEach((s, i) => { s.id = i; });
  // A zebra from the far doors of each entrance, for the walk from the car park.
  const zebras = plan.doors.map((c) => land.filter((d) => Math.abs(d.u - c) < 6).sort((a, b) => dirU * (b.u - a.u))[0]).map((d) => d.u);
  return { ring, lane, hw: R.hw, stops, dirU, near: R.nearW, far: R.farW, mid: R.mid, L: R.L, zebras, inRing: R.inRing };
}

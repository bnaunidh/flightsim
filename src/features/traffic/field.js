/**
 * The airfield as the traffic sees it: a runway, a parallel taxiway, the
 * connectors between them, and somewhere to park.
 *
 * TWO SOURCES, one shape.
 *
 *   airport.js airportLayout(), when there is one. The airport work lays the
 *   field out per map — taxiway, connectors, stands, hangars — and publishes
 *   the lot, so the traffic taxis on exactly the paving that is drawn and
 *   parks exactly where parkingSlots() says there is room.
 *
 *   The stock layout otherwise: the numbers airport.js buildPavement() and
 *   terrain.js isPaved() have always used, repeated once here. They only line
 *   up with the runway when it is centred on the origin, so without a layout
 *   the maps whose strip is somewhere else get no traffic, and say why.
 *
 * Everything is kept in the airfield's own frame, the one airport-layout.js
 * uses: u along the runway (+X), w away from the centreline on the side the
 * buildings are. world x = cx + u, z = cz + side * w. Kestrel's apron is on
 * the north side (side -1); a map whose apron is south of its runway is the
 * same field mirrored, and nothing below needs to know which it is.
 *
 * SLOTS face one of two ways, and both are handled:
 *   nose in   (pointing away from the taxiway) — a stand, or the stock hangar.
 *             Taxi straight in; leave by being pushed back out.
 *   nose out  (pointing at the taxiway) — airport-layout.js's hangars, whose
 *             heading "points out of the doors, because aeroplanes are put
 *             away tail first". Arrive by taxiing just past the lead-in and
 *             being pushed back in; leave by taxiing straight out.
 * A slot at right angles to the taxiway is set aside and named rather than
 * driven into sideways.
 *
 * Nothing here draws or moves anything. It answers: where are the slots, how
 * do you get from one to the runway, and how do you get back.
 */

import { AIRPORT, heightAt, isPaved, OBSTACLES, MAP } from '../../world/terrain.js';
import * as AP from '../../world/airport.js';
import * as TAXI from '../../game/taxi.js';
import { Draft, DEG, wrapPi } from './path.js';

/*
 * The stock layout, from airport.js buildPavement() and terrain.js isPaved():
 *   parallel taxiway   z = -95, 24 m wide, x from -430 to 430
 *   connectors         x = -430 and x = 0, from the taxiway to the runway
 *   apron              x -260..100, z -190..-106
 *   cones              a line of them at z = -118, x = -240 + 26 i, i = 0..13
 *                      (airport.js buildClutter) — the taxi tracks run between
 * The taxiway is on the NORTH side of the runway (negative z).
 */
export const STOCK = Object.freeze({
  twZ: -95,
  twX0: -430,
  twX1: 430,
  apron: { x0: -260, x1: 100, z0: -190, z1: -106 },
  connectors: [-430, 0],
  coneZ: -118,
  coneX0: -240,
  coneStep: 26,
  coneCount: 14,
  // Where a pushback leaves a small aeroplane, facing along the apron: north of
  // the cones, south of the service vehicles parked round the stands (-152).
  pushZ: -134,
});

/** x positions where a taxi track can cross the cone line without hitting one. */
export function coneGaps() {
  const out = [STOCK.coneX0 - 12];
  for (let i = 0; i < STOCK.coneCount - 1; i++) out.push(STOCK.coneX0 + STOCK.coneStep * (i + 0.5));
  return out.filter((x) => x >= STOCK.apron.x0 + 6 && x <= STOCK.apron.x1 - 6);
}

/*
 * Our own slots, used only on the stock layout and only when airport.js does
 * not publish parkingSlots().
 *
 * Measured against the obstacle boxes the stock airport registers (see
 * tests/features/traffic.mjs): the western hangar is the only one whose door
 * opens on to the apron — the other one's door is inside the terminal's
 * service block. The two light-aircraft spots sit on the empty western apron
 * between the cones' gaps, clear of the Meridian parked at stand 1 and its
 * ground power unit, and the big stand is east of the air bridges, clear of
 * the tower and the steps. All of them face north, nose in, and every one is
 * reached by a straight run north off the taxiway through a gap in the cones.
 *
 * Never used on top of an airport layout: there, (-201, -166) is the middle of
 * the heavy stand, which may have a jumbo of the airport's own parked on it.
 */
const OWN_SLOTS = [
  { id: 'hangar-west', kind: 'hangar', x: -250, z: -250, headingDeg: 0, maxSpan: 44 },
  { id: 'ga-1', kind: 'stand', x: -201, z: -166, headingDeg: 0, maxSpan: 20 },
  { id: 'ga-2', kind: 'stand', x: -175, z: -166, headingDeg: 0, maxSpan: 20 },
  { id: 'remote-1', kind: 'stand', x: 59, z: -152, headingDeg: 0, maxSpan: 68 },
];

/** The smallest swing a tug can put an aeroplane through, metres. */
const MIN_SWING = 8;

/* ------------------------------------------------------------------ */
/* The ground under the wheels                                         */
/* ------------------------------------------------------------------ */

/** Made ground from the airport layout, [{x0,x1,z0,z1}], or null on the stock field. */
let PAVE = null;

/** Height of the surface the wheels are on at (x, z). */
export function groundY(x, z) {
  // The pavement is laid flat at field elevation (+5 to 7 cm) whatever the
  // terrain under it does; off it, the wheels are on the terrain itself.
  if (PAVE) {
    for (let i = 0; i < PAVE.length; i++) {
      const p = PAVE[i];
      if (x >= p.x0 && x <= p.x1 && z >= p.z0 && z <= p.z1) return AIRPORT.elev + 0.06;
    }
  }
  if (isPaved(x, z)) return AIRPORT.elev + 0.06;
  return heightAt(x, z) + 0.02;
}

/** "the terminal", from an obstacle's crash message ("You flew into the terminal"). */
function buildingName(o) {
  return String((o && o.what) || 'a building').replace(/^You flew into\s+/i, '');
}

/** The obstacle box (x0..z1) that contains the point, or null. With y0/y1, only one overlapping that height band. */
export function obstacleAt(x, z, y0 = null, y1 = null) {
  for (const o of OBSTACLES) {
    if (x < o.x0 || x > o.x1 || z < o.z0 || z > o.z1) continue;
    if (y0 != null && (o.y1 < y0 || o.y0 > y1)) continue;
    return o;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Wings and buildings                                                 */
/* ------------------------------------------------------------------ */

/**
 * The buildings a taxiing aeroplane could touch on this field: the ones near
 * the paving that come down to wing height. Worked out once per field.
 */
function fieldObstacles(field) {
  if (field._obst) return field._obst;
  const x0 = Math.min(field.west, field.twX0) - 300;
  const x1 = Math.max(field.east, field.twX1) + 300;
  const w0 = -(field.halfWidth + 100);
  const w1 = field.twW + 500;
  const out = [];
  for (const o of OBSTACLES) {
    if (o.x1 < x0 || o.x0 > x1) continue;
    const wa = field.W(o.z0);
    const wb = field.W(o.z1);
    if (Math.max(wa, wb) < w0 || Math.min(wa, wb) > w1) continue;
    // Anything that starts above a jumbo's fin is not in the way.
    if (o.y0 > field.elev + 20 || o.y1 < field.elev + 0.3) continue;
    out.push(o);
  }
  field._obst = out;
  return out;
}

/** Does the segment (ax, az)-(bx, bz) pass through the box, grown by `pad`? */
function segmentHitsBox(ax, az, bx, bz, o, pad) {
  const bx0 = o.x0 - pad;
  const bx1 = o.x1 + pad;
  const bz0 = o.z0 - pad;
  const bz1 = o.z1 + pad;
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dz = bz - az;
  // Slabs: x, then z.
  if (Math.abs(dx) < 1e-9) {
    if (ax < bx0 || ax > bx1) return false;
  } else {
    let u = (bx0 - ax) / dx;
    let v = (bx1 - ax) / dx;
    if (u > v) [u, v] = [v, u];
    t0 = Math.max(t0, u);
    t1 = Math.min(t1, v);
    if (t0 > t1) return false;
  }
  if (Math.abs(dz) < 1e-9) return az >= bz0 && az <= bz1;
  let u = (bz0 - az) / dz;
  let v = (bz1 - az) / dz;
  if (u > v) [u, v] = [v, u];
  t0 = Math.max(t0, u);
  t1 = Math.min(t1, v);
  return t0 <= t1;
}

/**
 * Where a ground path puts this aeroplane's wings or fuselage through a
 * building, as words, or null if it is clear all the way.
 *
 * Measured on the integrated airport: the big fields' taxiway runs 25 m in
 * front of the hangars and the fire station, and a 747's wing reaches 32 m
 * from its centreline and an A380's 40 m — so a jumbo taxiing past them put a
 * wing through the hangar wall every time. Nothing checked, because the
 * planner's own test walked the centreline and the tips at the points it had
 * drawn, and the runtime never asked at all.
 *
 * The wing is checked as the whole line from tip to tip (a hangar wall is two
 * metres thick; a tip moved three metres between two points would step over
 * it), every box grown by half the longest step on the path, at the height
 * the wing is: from the ground up to a metre and a half above the main wheels'
 * leg height. The fuselage is checked nose to tail. `own` is the slot being
 * left or entered — the building the slot is inside is its hangar, which the
 * aeroplane is meant to be in.
 */
export function groundPathProblem(field, perf, path, own = null, reverse = false) {
  const obst = fieldObstacles(field);
  if (!obst.length || !path || path.n < 1) return null;
  // Half a metre beyond the shape's own tip (the drawn winglets reach a
  // little further than the flight model's span: 64.4 m to 62.7 on the 747).
  const half = (perf.span / 2) * 1.015 + 0.5;
  /*
   * Nose ahead and tail behind: as drawn where the roster says (perf.noseLen
   * and tailLen, from `plan`), otherwise 62% of the shape's length each way.
   * The first cut used the 62% for everything, which for a 747 is 27 m each
   * way — 4 m short of its nose and 12.5 m short of its tail. A pushback's
   * path points the way it moves, tail first (`reverse`), so its nose is
   * behind.
   */
  const fwd = perf.drawnPlan ? perf.noseLen + 0.5 : perf.length * 0.62;
  const aft = perf.drawnPlan ? perf.tailLen + 0.5 : perf.length * 0.62;
  const ahead = reverse ? aft : fwd;
  const behind = reverse ? fwd : aft;
  const nose = Math.max(ahead, behind);
  const wingTop = field.elev + Math.max(2.5, -((perf.gear && perf.gear.mainY) || -1.5) + 1.5);
  const bodyTop = field.elev + Math.max(3, -((perf.gear && perf.gear.mainY) || -1.5) * 1.6 + 1.5);
  // Between two points of the path the pose is interpolated, finely enough
  // that no part of the wing moves more than a metre from one pose to the
  // next — on a turn the tip sweeps much further than the middle does (an
  // A380 turning out of an SFO hangar moved its tip 6 m between two points
  // and stepped over the corner of the wall) — and every box is grown by
  // half a metre so a wall a metre thick cannot fall between two poses.
  const pad = 0.5;
  const reachAll = Math.max(half, nose);
  // The hangar the slot is in: every box that contains the slot's middle.
  const mine = own ? obst.filter((o) => own.x >= o.x0 && own.x <= o.x1 && own.z >= o.z0 && own.z <= o.z1) : [];
  // Bounding box of the whole path, grown by the wing: most buildings are
  // rejected here before any per-point work.
  let px0 = Infinity;
  let px1 = -Infinity;
  let pz0 = Infinity;
  let pz1 = -Infinity;
  for (let i = 0; i < path.n; i++) {
    const x = path.x[i];
    const z = path.z[i];
    if (x < px0) px0 = x;
    if (x > px1) px1 = x;
    if (z < pz0) pz0 = z;
    if (z > pz1) pz1 = z;
  }
  const reach = Math.max(half, nose) + pad;
  const near = obst.filter(
    (o) => !mine.includes(o) && o.x1 > px0 - reach && o.x0 < px1 + reach && o.z1 > pz0 - reach && o.z0 < pz1 + reach
  );
  if (!near.length) return null;
  const here = [];
  for (let i = 0; i < path.n; i++) {
    const x0 = path.x[i];
    const z0 = path.z[i];
    const h0 = path.hdg[i];
    const last = i === path.n - 1;
    const dx = last ? 0 : path.x[i + 1] - x0;
    const dz = last ? 0 : path.z[i + 1] - z0;
    const dh = last ? 0 : wrapPi(path.hdg[i + 1] - h0);
    // The buildings within reach of this stretch, once for all its poses.
    here.length = 0;
    const bx0 = Math.min(x0, x0 + dx) - reach;
    const bx1 = Math.max(x0, x0 + dx) + reach;
    const bz0 = Math.min(z0, z0 + dz) - reach;
    const bz1 = Math.max(z0, z0 + dz) + reach;
    for (const o of near) if (o.x1 > bx0 && o.x0 < bx1 && o.z1 > bz0 && o.z0 < bz1) here.push(o);
    if (!here.length) continue;
    const k = last ? 1 : Math.max(1, Math.ceil(Math.hypot(dx, dz) + reachAll * Math.abs(dh)));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      const x = x0 + dx * t;
      const z = z0 + dz * t;
      const h = h0 + dh * t;
      const c = Math.cos(h);
      const s = Math.sin(h);
      // Right wing tip is along (cos h, sin h); the nose along (sin h, -cos h).
      for (const o of here) {
        if (o.y0 <= wingTop && segmentHitsBox(x - c * half, z - s * half, x + c * half, z + s * half, o, pad)) {
          return `a wing tip through ${buildingName(o)} at (${Math.round(x)}, ${Math.round(z)})`;
        }
        if (o.y0 <= bodyTop && segmentHitsBox(x - s * behind, z + c * behind, x + s * ahead, z - c * ahead, o, pad)) {
          return `its nose or tail through ${buildingName(o)} at (${Math.round(x)}, ${Math.round(z)})`;
        }
      }
    }
  }
  return null;
}

/** Where the player is put when Free Flight starts on the stand. */
export function playerStand() {
  const first = TAXI.TAXI_ROUTE && TAXI.TAXI_ROUTE[0];
  if (first && first.pos && Number.isFinite(first.pos.x)) return { x: first.pos.x, z: first.pos.z };
  return { x: -80, z: -150 };
}

/* ------------------------------------------------------------------ */
/* The field                                                           */
/* ------------------------------------------------------------------ */

const fail = (why, extra = {}) => ({ ok: false, why, ...extra });

/** Finite number, or the fallback. */
const num = (v, d = null) => (Number.isFinite(v) ? v : d);

/**
 * The airport work's layout, read defensively: any field it does not have, or
 * has in a shape this was not written for, and the stock layout is used —
 * or, where the stock layout would be wrong too, the map gets no traffic.
 * Returns null (no layout), { bad } (a layout this cannot use) or the geometry.
 */
function readLayout(rw) {
  if (typeof AP.airportLayout !== 'function') return null;
  let lay = null;
  try {
    lay = AP.airportLayout();
  } catch (e) {
    console.warn('[traffic] airportLayout() threw; no traffic on this map.', e);
    return { bad: 'the airport layout could not be read' };
  }
  if (!lay) return null;
  const t = lay.taxiway;
  const side = lay.side === 1 ? 1 : lay.side === -1 ? -1 : 0;
  if (!t || !side) return { bad: 'this airfield has no taxiway' };
  const twW = num(t.w);
  const u0 = num(t.u0);
  const u1 = num(t.u1);
  const width = num(t.width, 20);
  if (twW == null || u0 == null || u1 == null || !(u1 > u0)) return { bad: 'this airfield has no taxiway' };
  const conns = [];
  let holdW = null;
  for (const c of lay.connectors || []) {
    const u = c && num(c.u);
    if (u == null) continue;
    conns.push(u);
    const hw = c.hold && num(c.hold.w);
    if (hw != null) holdW = holdW == null ? hw : Math.max(holdW, hw);
  }
  const run = lay.runway || {};
  const pave = [];
  for (const p of lay.pavement || []) {
    if (p && [p.x0, p.x1, p.z0, p.z1].every(Number.isFinite)) pave.push({ x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 });
  }
  return {
    source: 'airport',
    side,
    cx: num(run.cx, rw.cx),
    cz: num(run.cz, rw.cz),
    twW,
    twHalf: width / 2,
    twU0: u0,
    twU1: u1,
    connU: conns,
    holdW: holdW == null ? Math.min(twW - width / 2 - 8, rw.halfWidth + 30) : holdW,
    pave,
    military: !!lay.military,
  };
}

/** The stock layout, as the same geometry. Only valid with the runway on the origin. */
function stockGeometry(rw) {
  return {
    source: 'stock',
    side: -1,
    cx: 0,
    cz: 0,
    twW: -STOCK.twZ,
    twHalf: 12,
    twU0: STOCK.twX0,
    twU1: STOCK.twX1,
    connU: [...STOCK.connectors],
    // Thirty metres back from the runway edge, on the connector.
    holdW: Math.min(-STOCK.twZ - 14, rw.halfWidth + 30),
    pave: null,
    military: false,
  };
}

/**
 * The airfield for whatever map is loaded now, or { ok: false, why }.
 * Called after refreshRunways(), which main.js does before every world build.
 */
export function buildField() {
  PAVE = null;
  const rw = AIRPORT && AIRPORT.runway;
  if (!rw) return fail('this map has no runway');
  if (Math.abs(((AIRPORT.headingDeg ?? 90) % 180) - 90) > 1) {
    return fail('this runway does not run east-west like the taxiways');
  }
  if (rw.length < 600) return fail('the runway is too short for traffic');

  let g = readLayout(rw);
  if (g && g.bad) return fail(g.bad);
  if (!g) {
    if (Math.abs(rw.cx) > 1 || Math.abs(rw.cz) > 1) return fail('the taxiways on this map are not beside its runway');
    g = stockGeometry(rw);
  }
  if (!(g.holdW > rw.halfWidth + 5 && g.holdW < g.twW - g.twHalf)) {
    return fail('there is nowhere to hold short between the taxiway and the runway');
  }
  PAVE = g.pave && g.pave.length ? g.pave : null;

  const elev = AIRPORT.elev;
  const half = rw.length / 2;
  const side = g.side;
  const cx = g.cx;
  const cz = g.cz;
  const field = {
    ok: true,
    mapId: MAP && MAP.id,
    layout: g.source,
    military: g.military,
    elev,
    cx,
    cz,
    length: rw.length,
    halfWidth: rw.halfWidth,
    west: cx - half,
    east: cx + half,
    side,
    /** Heading, degrees, of a nose pointing away from the runway on the airfield side. */
    awayDeg: side < 0 ? 0 : 180,
    twW: g.twW,
    twHalf: g.twHalf,
    twZ: cz + side * g.twW,
    twX0: cx + g.twU0,
    twX1: cx + g.twU1,
    holdW: g.holdW,
    holdZ: cz + side * g.holdW,
    connectors: [],
    apronLane: null,
    slots: [],
    rejectedSlots: [],
    slotSource: 'none',
    X: (u) => cx + u,
    Z: (w) => cz + side * w,
    W: (z) => (z - cz) * side,
  };

  // Connectors that actually meet this runway, with room for a turn at each end.
  for (const u of g.connU) {
    const x = cx + u;
    if (Math.abs(x - rw.cx) < half - 60 && x >= field.twX0 - 2 && x <= field.twX1 + 2) field.connectors.push(x);
  }
  /*
   * The crosswind runway as a third way on and off, where it crosses both the
   * main runway and the parallel taxiway — Kestrel's 18/36 does, at x 250.
   * Taxiing along a runway is legitimate at a small field, and without it a
   * runway 27 departure would have to backtrack from the middle.
   */
  const r2 = AIRPORT.runway2;
  field.r2 = null;
  if (r2) {
    const ns = Math.abs((((r2.headingDeg ?? 180) % 180) + 180) % 180) < 1;
    const zA = r2.cz - r2.length / 2;
    const zB = r2.cz + r2.length / 2;
    const crossesMain = ns && zA < cz - rw.halfWidth && zB > cz + rw.halfWidth;
    // The traffic keeps off 09/27 while the player uses a runway that crosses it.
    field.r2Crosses = !!crossesMain && Math.abs(r2.cx - cx) < half;
    const crossesTaxi = ns && zA < field.twZ - 12 && zB > field.twZ + 12;
    // Where the crosswind runway crosses the parallel taxiway, whether or not
    // the traffic uses it as a connector: nobody stops on it there either.
    if (crossesTaxi && r2.cx > field.twX0 - r2.halfWidth && r2.cx < field.twX1 + r2.halfWidth) {
      field.r2 = { cx: r2.cx, hw: r2.halfWidth, zA, zB, conn: false, side: 1 };
    }
    const nearOne = field.connectors.some((x) => Math.abs(x - r2.cx) < 60);
    if (crossesMain && crossesTaxi && !nearOne && r2.cx > field.twX0 && r2.cx < field.twX1 && Math.abs(r2.cx - rw.cx) < half - 60) {
      field.connectors.push(r2.cx);
      field.r2.conn = true;
    }
  }
  field.connectors.sort((a, b) => a - b);
  if (!field.connectors.length) return fail('no taxiway reaches this runway');

  /*
   * The parking slots: airport.js's if it publishes them, ours on the stock
   * layout otherwise. Theirs are taken as given; any we cannot reach without
   * driving through a building is set aside and named, rather than used and
   * clipped through.
   */
  let raw = null;
  try {
    const got = typeof AP.parkingSlots === 'function' ? AP.parkingSlots() : null;
    if (Array.isArray(got) && got.length) raw = got.filter((s) => s && Number.isFinite(s.x) && Number.isFinite(s.z));
  } catch (e) {
    console.warn('[traffic] airport parkingSlots() threw.', e);
    raw = null;
  }
  const take = (list, source) => {
    field.slotSource = source;
    for (const s of list) {
      const slot = {
        id: String(s.id),
        kind: s.kind === 'hangar' ? 'hangar' : 'stand',
        x: s.x,
        z: s.z,
        y: groundY(s.x, s.z),
        headingDeg: Number.isFinite(s.headingDeg) ? s.headingDeg : field.awayDeg,
        maxSpan: Number.isFinite(s.maxSpan) ? s.maxSpan : 20,
        maxLength: Number.isFinite(s.maxLength) ? s.maxLength : Infinity,
        nose: 'in',
        owner: null,
      };
      const why = slotProblem(field, slot);
      if (why) field.rejectedSlots.push({ id: slot.id, why });
      else field.slots.push(slot);
    }
  };
  if (raw && raw.length) take(raw, 'airport');
  if (!field.slots.length && g.source === 'stock') {
    // Every published slot unusable, or none published: ours, on the stock field.
    const before = field.slotSource;
    take(OWN_SLOTS, before === 'airport' ? 'own (airport slots unusable)' : 'own');
  }
  if (!field.slots.length) return fail('nowhere to park', { rejectedSlots: field.rejectedSlots });
  /*
   * The side of the crosswind runway the slots are on: its holding point on
   * the taxiway is on that side, so nobody crosses 18/36 to get to it.
   */
  if (field.r2) {
    let sum = 0;
    for (const s of field.slots) sum += Math.sign(field.r2.cx - s.x) || 1;
    field.r2.side = sum >= 0 ? 1 : -1;
  }
  /*
   * Small aeroplanes on OUR stock slots are pushed back on to the apron and
   * taxi out between the cones, which is what the stock apron is painted
   * for. Anywhere else everyone is pushed out on to the taxiway itself: the
   * airport layout parks its own airliners on the stands either side, and the
   * apron in front of a stand is where their tails are.
   */
  if (field.slotSource.startsWith('own')) field.apronLane = { w: -STOCK.pushZ, gaps: coneGaps() };
  return field;
}

/**
 * Why a slot cannot be used, or null. Cheap checks only — the planner checks
 * the paths. Sets slot.nose to 'in' or 'out' on the way.
 */
export function slotProblem(field, slot) {
  const W = field.W ? field.W(slot.z) : -slot.z;
  const twW = field.twW ?? -STOCK.twZ;
  const twHalf = field.twHalf ?? 12;
  // The slot's own lead-in has to reach the taxiway from the airfield side.
  if (W < twW + twHalf + 4) return 'not beyond the taxiway';
  const tx0 = field.twX0 ?? STOCK.twX0;
  const tx1 = field.twX1 ?? STOCK.twX1;
  if (slot.x < tx0 + 6 || slot.x > tx1 - 6) return 'no taxiway in front of it';
  const c = Math.cos((slot.headingDeg - (field.awayDeg ?? 0)) * DEG);
  if (c > 0.7) slot.nose = 'in';
  else if (c < -0.7) slot.nose = 'out';
  else return 'parked side-on to the taxiway';
  /*
   * A tug swings the aeroplane on to (or off) the taxiway in whichever
   * direction the day's runway wants, so there has to be taxiway both sides
   * of the lead-in for the smallest swing. Checked here once, so the route
   * builders below never have to turn an aeroplane round on the taxiway.
   */
  const need = MIN_SWING + 6;
  if (slot.x - need < tx0 || slot.x + need > tx1) return 'too near the end of the taxiway to be pushed round';
  const g = groundY(slot.x, slot.z);
  if (Math.abs(g - field.elev) > 6) return `ground ${(g - field.elev).toFixed(1)} m off field level`;
  // Where the player starts a Free Flight on the stand.
  const ps = playerStand();
  const reach = (slot.maxSpan || 20) / 2 + 8;
  if (Math.abs(ps.x - slot.x) < reach && Math.abs(ps.z - slot.z) < reach) return 'it is where you start when you taxi out';
  /*
   * The way in is a straight run off the taxiway. If a registered building
   * stands on it — other than the slot's own hangar — the slot cannot be
   * reached: this is what keeps the second stock hangar, whose door opens
   * into the back of the terminal, from ever being offered. Only what is at
   * wheel-to-wing height counts: a hangar's roof over its doors does not.
   */
  const lo = field.elev + 0.3;
  const hi = field.elev + 4;
  const own = obstacleAt(slot.x, slot.z, lo, hi);
  const twZ = field.twZ ?? STOCK.twZ;
  const step = slot.z >= twZ ? 4 : -4;
  for (let z = twZ; Math.abs(z - twZ) < Math.abs(slot.z - twZ); z += step) {
    const o = obstacleAt(slot.x, z, lo, hi);
    if (o && o !== own) return `the way in runs through ${buildingName(o)}`;
  }
  if (own && own.what && !/hangar/i.test(own.what)) return `it is inside ${buildingName(own)}`;
  return null;
}

/* ------------------------------------------------------------------ */
/* Holding points: always OFF the runway                               */
/* ------------------------------------------------------------------ */

/**
 * Does connector x run along the crosswind runway — is it 18/36 itself, the
 * way Kestrel's third connector at x 250 is?
 */
export function alongR2(field, x) {
  return !!(field && field.r2 && field.r2.conn && x != null && Math.abs(x - field.r2.cx) < 1);
}

/** How far back from the crosswind runway's edge its holding point on the taxiway is, for this aeroplane. */
export function r2HoldBack(perf) {
  return Math.max(30, (perf ? perf.noseLen : 0) + 16, (perf ? perf.span / 2 : 0) + 12);
}

/**
 * Where an aeroplane holds at connector cx: where a departure waits to be
 * cleared on to the runway, and where an arrival that turned off there
 * stops to wait to taxi in. Every one is off every runway — the rule real
 * airports paint on the ground as a holding-point line.
 *
 * On an ordinary connector it is on the connector, 30 m back from 09/27's
 * edge. On a connector that IS the crosswind runway (Kestrel's x 250) the
 * connector is runway all the way to the taxiway, so the holding point is on
 * the taxiway, short of 18/36 on the side the slots are (field.r2.side, +1:
 * west of it). The first cut held there at (250, -47), on 18/36, and a child
 * rolling down 18/36 met whoever was waiting (the review: 168 of 224 runs).
 * `far`: the one on the other side of 18/36, where one that has had to
 * cross it to get off it waits.
 */
export function holdPoint(field, cx, perf, far = false) {
  if (alongR2(field, cx)) {
    const s = far ? -field.r2.side : field.r2.side;
    return { x: cx - s * (field.r2.hw + r2HoldBack(perf)), z: field.twZ, onTaxiway: true, side: s };
  }
  return { x: cx, z: field.holdZ, onTaxiway: false, side: 0 };
}

/**
 * Runway-side geometry for one direction: dir +1 lands and departs eastbound
 * (runway 09), -1 westbound (27).
 */
export function runwayFor(field, dir) {
  const approachEnd = dir > 0 ? field.west : field.east;
  const farEnd = dir > 0 ? field.east : field.west;
  // The aiming point, 200 m in — the same distance the tutorial, the PAPI and
  // RUNWAY.touchdown use for 09, mirrored for 27.
  const aim = approachEnd + dir * 200;
  // Departures use the connector giving the most runway ahead; arrivals the
  // others, so a departure waiting at the hold is never nose to nose with an
  // arrival coming off.
  const byUpwind = [...field.connectors].sort((a, b) => (a - b) * dir);
  return {
    dir,
    heading: dir > 0 ? 90 * DEG : 270 * DEG,
    name: dir > 0 ? '09' : '27',
    approachEnd,
    farEnd,
    aim,
    depConnector: byUpwind[0],
    exits: byUpwind,
  };
}

/* ------------------------------------------------------------------ */
/* Ground routes                                                       */
/* ------------------------------------------------------------------ */

/** Aeroplanes this long are pushed out on to the taxiway even on the stock apron. */
const BIG = 44;

/** How far past a slot the swing on to or off the taxiway reaches, in each direction. */
function swingRoom(field, slot, m) {
  return m > 0 ? field.twX1 - slot.x : slot.x - field.twX0;
}

/** The radius a tug swings this aeroplane through on to the taxiway, towards m (+1 east). */
function swingRadius(field, slot, perf, m) {
  const want = perf.length >= BIG ? 26 : 14;
  return Math.max(MIN_SWING, Math.min(want, swingRoom(field, slot, m) - 6));
}

/**
 * The pushback from a nose-in slot: tail first out of it, then swung so the
 * nose points along the apron or the taxiway towards the connector at
 * `towardX`.
 *
 * Returned as a Draft of the path the aeroplane's reference point follows,
 * in the direction it MOVES — so its headings are the tail's. The caller
 * flips the nose.
 */
export function pushbackDraft(field, slot, perf, towardX) {
  const big = perf.length >= BIG;
  const lane = field.apronLane && !big;
  // Move away from the connector so the nose ends up facing it. slotProblem()
  // has made sure there is taxiway that way.
  const m = towardX < slot.x ? 1 : -1;
  const lineZ = lane ? field.Z(field.apronLane.w) : field.twZ;
  const r = lane ? 11 : swingRadius(field, slot, perf, m);
  const pts = [
    { x: slot.x, z: slot.z, r: 0 },
    { x: slot.x, z: lineZ, r },
    { x: slot.x + m * (r + 4), z: lineZ, r: 0 },
  ];
  return new Draft().fillet(pts, 2, 6);
}

/**
 * Forward taxi to the holding point on connector `cx`, from `from` ({ x, z }):
 * the end of a pushback, facing along the lane (noseDir +1 east), or a
 * nose-out slot, facing the taxiway.
 */
export function taxiOutDraft(field, perf, from, noseDir, cx) {
  const big = perf.length >= BIG;
  const r = big ? 24 : 14;
  const pts = [{ x: from.x, z: from.z, r: 0 }];
  const onLane = field.apronLane && Math.abs(from.z - field.Z(field.apronLane.w)) < 1;
  if (onLane) {
    // The first gap in the cones in the direction the nose points, far
    // enough ahead to make the turn.
    const gaps = field.apronLane.gaps;
    let gx = null;
    for (const g of noseDir > 0 ? gaps : [...gaps].reverse()) {
      if ((g - from.x) * noseDir >= r * 0.8) {
        gx = g;
        break;
      }
    }
    if (gx == null) gx = noseDir > 0 ? gaps[gaps.length - 1] : gaps[0];
    pts.push({ x: gx, z: from.z, r });
    pts.push({ x: gx, z: field.twZ, r });
  } else if (Math.abs(from.z - field.twZ) > 1) {
    // Straight out of a nose-out slot on to the taxiway.
    pts.push({ x: from.x, z: field.twZ, r });
  }
  const h = holdPoint(field, cx, perf);
  if (h.onTaxiway) {
    // Short of the crosswind runway, on the taxiway.
    pts.push({ x: h.x, z: field.twZ, r: 0 });
  } else {
    pts.push({ x: cx, z: field.twZ, r });
    pts.push({ x: cx, z: field.holdZ, r: 0 });
  }
  return new Draft().fillet(pts, 3, 6);
}

/**
 * From the holding point on connector `cx` on to the runway, lined up and
 * stopped facing `rw.dir`. If there is not enough runway ahead for this
 * aeroplane, it backtracks along the runway first and turns round at the end.
 * Returns { draft, tora }.
 */
export function lineupDraft(field, rw, perf, cx) {
  const r = Math.min(field.halfWidth + 6, 22);
  const need = perf.toraNeed;
  const aheadFrom = (x) => (rw.farEnd - x) * rw.dir;
  const straightStop = cx + rw.dir * (r + 18);
  /*
   * From the holding point. Off the crosswind runway's, on the taxiway, that
   * is along the taxiway on to 18/36, down it and on to 09/27 in one go: the
   * crossing is one clearance and nobody stops on 18/36 half-way through it.
   */
  const h = holdPoint(field, cx, perf);
  const from = h.onTaxiway
    ? [
        { x: h.x, z: field.twZ, r: 0 },
        { x: cx, z: field.twZ, r: perf.length >= 44 ? 24 : 14 },
      ]
    : [{ x: cx, z: field.holdZ, r: 0 }];
  if (aheadFrom(straightStop) >= need) {
    const d = new Draft().fillet([...from, { x: cx, z: field.cz, r }, { x: straightStop, z: field.cz, r: 0 }], 3, 6);
    return { draft: d, tora: aheadFrom(straightStop), backtrack: false };
  }
  // Backtrack: turn the other way on to the runway, taxi to the end, turn round.
  const w = uTurnWidth(field);
  const turnAt = rw.approachEnd + rw.dir * (UTURN_BLEND + w + 12);
  const d = new Draft().fillet([...from, { x: cx, z: field.cz, r }, { x: turnAt, z: field.cz, r: 0 }], 3, 6);
  uTurn(d, -rw.dir, field.cz, w, -(field.side || -1));
  const stop = turnAt + rw.dir * 15;
  d.line(stop, field.cz, 3);
  return { draft: d, tora: aheadFrom(stop), backtrack: true };
}

/** Distance an S-bend takes to move across the runway before and after a U-turn. */
export const UTURN_BLEND = 40;

/** Radius of a U-turn on this runway: under half its width, so it stays on the tarmac. */
export function uTurnWidth(field) {
  return Math.max(5, field.halfWidth * 0.42);
}

/**
 * Turn round on the runway. The draft is on the centreline at z = cz, moving
 * in direction `moveDir` (+1 east, -1 west); it drifts across to the side
 * `away` (+1 is +z) — away from the taxiway — swings through 180 degrees of
 * radius w, and drifts back to the centreline where it started, now facing
 * the other way.
 */
export function uTurn(d, moveDir, cz, w, away = 1, blend = UTURN_BLEND, back = true) {
  const x0 = d.lastX;
  const a = away >= 0 ? 1 : -1;
  /*
   * `blend` is how far the S-bend takes to drift across. A short one (a turn
   * round with somebody not far ahead) drifts less far, so it is never
   * tighter than the half circle itself: an S of length L across sh has a
   * radius of 2L²/(π² sh) at its tightest.
   */
  const sh = blend > 0 ? Math.min(w, (2 * blend * blend) / (Math.PI * Math.PI * w)) : 0;
  if (blend > 0) {
    for (let i = 1; i <= 10; i++) {
      const t = i / 10;
      d.push(x0 + moveDir * blend * t, cz + (a * sh * (1 - Math.cos(Math.PI * t))) / 2);
    }
  }
  const h = moveDir > 0 ? 90 * DEG : 270 * DEG;
  // Moving east offset to the south (+z): turning left brings it round through
  // north. Each flip — westbound, or offset north — flips the turn.
  const left = (moveDir > 0) === (a > 0);
  d.turn(h, left ? -Math.PI : Math.PI, w, 6);
  // `back` false: it stays on the far side, for a turn off at an exit.
  if (!back) return d;
  const x1 = d.lastX;
  const z1 = d.lastZ;
  for (let i = 1; i <= 10; i++) {
    const t = i / 10;
    d.push(x1 - moveDir * blend * t, z1 + ((cz - z1) * (1 - Math.cos(Math.PI * t))) / 2);
  }
  return d;
}

/**
 * From the runway exit's holding point to the slot. Returns
 * { taxi, push }: `taxi` a forward Draft; `push` null for a nose-in slot, or
 * for a nose-out one the Draft of being pushed back into it, in the direction
 * of travel (so, like the pushback, its headings are the tail's).
 */
export function taxiInDraft(field, perf, ex, slot, start = null) {
  const big = perf.length >= BIG;
  const r = big ? 24 : 14;
  /*
   * From the exit's holding point — or from `start`, somewhere on the
   * taxiway itself ({ x }): the far side of the crosswind runway, say.
   */
  const h = start ? { x: start.x, z: field.twZ, onTaxiway: true } : holdPoint(field, ex, perf);
  const from = h.onTaxiway ? [{ x: h.x, z: field.twZ, r: 0 }] : [{ x: ex, z: field.holdZ, r: 0 }, { x: ex, z: field.twZ, r }];
  if (slot.nose !== 'out') {
    return {
      taxi: new Draft().fillet([...from, { x: slot.x, z: field.twZ, r }, { x: slot.x, z: slot.z, r: 0 }], 3, 6),
      push: null,
    };
  }
  // Carry on past the lead-in, stop, and be pushed back round into it.
  const m = Math.sign(slot.x - h.x) || 1;
  const rs = swingRadius(field, slot, perf, m);
  const stopX = slot.x + m * (rs + 4);
  const taxi = new Draft().fillet([...from, { x: stopX, z: field.twZ, r: 0 }], 3, 6);
  const push = new Draft().fillet(
    [
      { x: stopX, z: field.twZ, r: 0 },
      { x: slot.x, z: field.twZ, r: rs },
      { x: slot.x, z: slot.z, r: 0 },
    ],
    2,
    6
  );
  return { taxi, push };
}

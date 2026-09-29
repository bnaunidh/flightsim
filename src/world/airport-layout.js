/**
 * Where everything on the airfield goes, worked out from the map.
 *
 * The airfield used to be written in Kestrel's coordinates: taxiway at
 * z = -95, apron at x -260..100, terminal at (-60, -212), hangars at z = -250.
 * Every map moves its runway, and thirty-two maps later that put the terminal
 * of Town's 450 m strip 2 km from the strip, in a hillside, and Lagoon's
 * taxiway out over the water. So nothing here is a coordinate any more — it
 * is a distance from whichever runway is loaded, and every building is
 * checked against the ground before it is allowed to stand there.
 *
 * FRAME. All 32 runways run along X (headingDeg 90). The layout is written in
 * two numbers measured from the runway centre:
 *
 *   u  metres along the runway, +X
 *   w  metres away from the runway centreline, on the airfield side
 *
 * and `side` says which side that is: -1 north (-Z, where Kestrel's apron has
 * always been) or +1 south. So world x = cx + u, z = cz + side * w.
 *
 * THREE SIZES, chosen by runway length:
 *   strip     < 600 m   a flying club: light stands, a clubhouse, a small tower
 *   regional  < 1500 m  Kestrel: jet bridges, a 64 m tower, maintenance hangars
 *   hub       otherwise the 3-4 km fields: a long terminal, heavy stands, big hangars
 * and when a size does not fit its field, the next one down is tried:
 * `compact` (a regional airport on 140 m of level ground — Sennen, Skerries,
 * Longbank, Firewatch) and `mini` (a strip on 90 m — The Stacks).
 *
 * KESTREL IS NOT MOVED. The taxi tutorial drives to (-430, -95), the tower view
 * stands at (40, -195), the physics' isPaved() knows the taxiway at z = -95 and
 * the apron at x -260..100, and the road on Kestrel crosses the apron at
 * (-80, -150). The regional template is those numbers, so on Kestrel (and the
 * five maps that share its runway) every one of them comes out where it was.
 *
 * THE RULES a building has to pass (groundOk, clearOf and keepOutHit below):
 *   - dry: every sample of its footprint is more than 1.5 m above the sea
 *   - level: within 2 m above and 0.8 m below field elevation, which a
 *     plinth and a wall cut into the rise can hide; made ground you can see
 *     — pavement, the car park, a hangar floor — within +4 / -35 cm
 *   - clear of both runways, every taxiway, the apron and every stand
 *   - clear of the map's own furniture: helipads, the air base's shelters and
 *     blast walls, the delivery strip's huts, authored roads, flats
 *   - clear of every other building by six metres
 * A building that fails is slid along the field until it passes, and dropped
 * — logged in `layout.dropped` — if nowhere does. Nothing is placed on trust.
 *
 * PURE. No meshes, no THREE. The world builders, parkingSlots() and the node
 * test all read the same object, memoised per map, so what the traffic is told
 * is a stand is exactly what is drawn as one.
 */

import { AIRPORT, MAP, heightAt, flatAt } from './terrain.js';
import { AIRCRAFT } from '../aircraft/types.js';

/* ------------------------------------------------------------------ */
/* Sizes                                                               */
/* ------------------------------------------------------------------ */

/**
 * Stand sizes. `span` is the widest wing that fits with 3 m to spare each
 * side of the neighbours; `pitch` is the centre-to-centre spacing along the
 * terminal; `depth` is the longest aeroplane the box takes, nose to tail.
 *
 * Heavy is sized for the A380 (79.8 m span, 72.7 m long) and the 747 (64.4 m,
 * 70.7 m). Medium takes an A320 (35.8 m) or the Meridian (28.8 m drawn).
 *
 * These are the most a stand is given. Where the apron is shallower its
 * stands are cut to it (place(), below): 70 m heavy stands on the regional
 * template, 36 m medium ones on the compact. What goes on a stand is decided
 * by standFits() against that stand's own numbers, never by its class.
 */
export const STAND_SIZES = Object.freeze({
  light: Object.freeze({ span: 16, pitch: 22, depth: 18 }),
  medium: Object.freeze({ span: 38, pitch: 44, depth: 44 }),
  heavy: Object.freeze({ span: 80, pitch: 86, depth: 76 }),
});

/** Gap kept between any two buildings, and between a building and pavement. */
const GAP = 6;

/*
 * How far the ground may stray from field elevation under made ground.
 * Pavement is drawn 5 cm above the field, so ground more than 4 cm higher
 * pokes up through it; ground lower than 35 cm leaves a visible lip at the
 * edge. The first hangar on Kestrel was sited with the building tolerance
 * (2 m up) and the hillside grew up through the back of its floor.
 */
const PAVE_UP = 0.04;
const PAVE_DOWN = 0.35;

/* ------------------------------------------------------------------ */
/* Small geometry                                                      */
/* ------------------------------------------------------------------ */

/** Axis-aligned world rectangle. */
function rect(x0, x1, z0, z1) {
  return { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1) };
}

function overlaps(a, b, margin = 0) {
  return a.x0 < b.x1 + margin && a.x1 > b.x0 - margin && a.z0 < b.z1 + margin && a.z1 > b.z0 - margin;
}

function inside(r, x, z, margin = 0) {
  return x >= r.x0 - margin && x <= r.x1 + margin && z >= r.z0 - margin && z <= r.z1 + margin;
}

/** Distance from a point to a segment, in the ground plane. */
function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax;
  const dz = bz - az;
  const L2 = dx * dx + dz * dz;
  let t = L2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t - px;
  const qz = az + dz * t - pz;
  return Math.sqrt(qx * qx + qz * qz);
}

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

class Frame {
  constructor(cx, cz, side) {
    this.cx = cx;
    this.cz = cz;
    this.side = side;
  }
  x(u) {
    return this.cx + u;
  }
  z(w) {
    return this.cz + this.side * w;
  }
  /** A rectangle given in (u, w) ranges. */
  rect(u0, u1, w0, w1) {
    return rect(this.cx + u0, this.cx + u1, this.cz + this.side * w0, this.cz + this.side * w1);
  }
  /** Heading of something whose nose points away from the runway (+w). */
  get awayDeg() {
    return this.side < 0 ? 0 : 180;
  }
  /** Heading of something facing the runway (-w). */
  get towardDeg() {
    return this.side < 0 ? 180 : 0;
  }
}

/* ------------------------------------------------------------------ */
/* What the map already has standing on the field                      */
/* ------------------------------------------------------------------ */

/**
 * Circles and rectangles this airfield must keep off, taken from the map's own
 * data. Each is { kind: 'circle', x, z, r } or { kind: 'rect', ...rect }.
 */
function keepOuts(map) {
  const out = [];
  const sc = (map && map.scenery) || {};
  // Helipads. The Kestrel clones all carry one at (-520, -150), just west of
  // the apron, and a hangar on it would be a pad nobody can land on.
  for (const p of (map && (map.pads || sc.pads)) || []) {
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) out.push({ kind: 'circle', x: p.x, z: p.z, r: (p.r || 11) + 16 });
  }
  /*
   * The delivery strip and its village. scenery.js plants nine huts on a ring
   * 70-114 m round it, and on Sennen, Skerries and Longbank the strip IS the
   * runway centre — so a terminal there would have been built through them.
   */
  if (Array.isArray(sc.deliveryPad)) {
    out.push({ kind: 'circle', x: sc.deliveryPad[0], z: sc.deliveryPad[1], r: 128 });
  }
  /*
   * The air base's own furniture, by the formulas scenery.js places it with
   * (addAirBase). Shelters, revetments, blast walls, the radar and the fuel
   * tanks are all registered as obstacles after this airfield is built, so
   * nothing would have stopped a hangar going up inside a blast wall.
   */
  const base = sc.base;
  if (base) {
    const cx = base.cx || 0;
    const cz = base.cz || 0;
    const spread = base.spread ?? 620;
    const n = base.shelters ?? 8;
    for (let i = 0; i < n; i++) {
      const s = i % 2 === 0 ? -1 : 1;
      const along = (Math.floor(i / 2) - (n / 4 - 0.5)) * 150;
      const x = cx + along;
      const z = cz + s * spread;
      out.push({ kind: 'rect', ...rect(x - 15, x + 15, z - 13, z + 13), pad: 30 });
    }
    const revs = base.revetments ?? 6;
    for (let i = 0; i < revs; i++) {
      const s = i % 2 === 0 ? -1 : 1;
      const along = (Math.floor(i / 2) - (revs / 4 - 0.5)) * 170 + 80;
      const x = cx + along;
      const z = cz + s * (spread + 210);
      out.push({ kind: 'rect', ...rect(x - 22, x + 22, z - 20, z + 20) });
    }
    const walls = base.walls ?? 14;
    for (let i = 0; i < walls; i++) {
      const s = i % 2 === 0 ? -1 : 1;
      const along = (Math.floor(i / 2) - (walls / 4 - 0.5)) * 96;
      const x = cx + along;
      const z = cz + s * spread * 0.62;
      out.push({ kind: 'rect', ...rect(x - 30, x + 30, z - 1.1, z + 1.1) });
    }
    const off = base.radarOffset ?? 900;
    out.push({ kind: 'circle', x: cx - off, z: cz + spread * 1.5, r: 12 });
    const fx = cx + off * 1.15;
    const fz = cz - spread * 1.35;
    out.push({ kind: 'rect', ...rect(fx - 88, fx + 88, fz - 36, fz + 36) });
  }
  return out;
}

/**
 * Authored road centrelines, as segments. Only AUTHORED: a generated network
 * is routed round this airfield's buildings after they exist, so reading it
 * back here would make the layout depend on whether the roads had been laid
 * yet — and the second world build would come out different from the first.
 */
function authoredRoads(map) {
  const w = map && map.waters;
  if (!w || w._generated || !Array.isArray(w.roads)) return [];
  const segs = [];
  for (const r of w.roads) {
    const hw = (r.halfWidth || (r.width ? r.width / 2 : 7)) + 2;
    const p = r.path || [];
    for (let i = 1; i < p.length; i++) segs.push({ ax: p[i - 1][0], az: p[i - 1][1], bx: p[i][0], bz: p[i][1], hw });
  }
  return segs;
}

/* ------------------------------------------------------------------ */
/* Templates                                                           */
/* ------------------------------------------------------------------ */

function classFor(L) {
  return L < 600 ? 'strip' : L < 1500 ? 'regional' : 'hub';
}

/**
 * The numbers each size starts from, before anything is checked.
 *
 * Regional is Kestrel exactly — see the header. The others are the same shape
 * scaled: a strip's taxiway sits 45 m out because its pad is only 130 m deep,
 * a hub's at 170 m because a jumbo's tail must clear the runway strip.
 */
function template(shape, L, hw) {
  if (shape === 'strip') {
    // Clear of the PAPI, which stands 15-33 m off the runway edge at the
    // touchdown point (see buildLighting); at hw + 33 its outer box sat on
    // the taxiway's inner edge.
    const wTx = hw + 40;
    return {
      shape,
      twy: { w: wTx, width: 12, half: L / 2 - 35 },
      connectors: [-(L / 2 - 45), 0, L / 2 - 45],
      apron: { u0: -Math.round(L * 0.34), u1: Math.round(L * 0.1), w0: wTx + 6, depth: 44 },
      terminal: { depth: 14, H: 8, name: 'clubhouse', minLen: 30, maxLen: 48 },
      tower: { size: 9, H: 17, kind: 'small', du: -20, dw: 14 },
      standPlan: ['light', 'light', 'light', 'light', 'light', 'light', 'medium'],
      bridges: false,
      // Both hangars east of the apron: west of it is the clubhouse's end,
      // and the taxiway there stops short of where a hangar's lead-in would
      // have to join it — measured, the west hangar was dropped on all twelve
      // 450 m strips.
      hangars: [
        { width: 34, depth: 28, H: 11, at: ['east', 20], front: ['apron', 8] },
        { width: 34, depth: 28, H: 11, at: ['east', 62], front: ['apron', 8] },
      ],
      fire: { width: 18, depth: 14, H: 7, bays: 1, at: ['east', 108], front: ['twy', 12] },
      carPark: { width: 36, depth: 22, at: ['west', -24], front: ['apron', 0] },
      fuel: { width: 22, depth: 16, tanks: 2, r: 2.6, H: 6, at: ['west', -72], front: ['apron', 6] },
      edgeStep: 24,
      holdDist: 20,
      floodH: 12,
      floodGap: 60,
    };
  }
  if (shape === 'compact') {
    const wTx = hw + 45;
    return {
      shape,
      twy: { w: wTx, width: 18, half: L / 2 - 80 },
      connectors: [-(L / 2 - 90), 0, L / 2 - 90],
      apron: { u0: -Math.round(L * 0.3), u1: Math.round(L * 0.08), w0: wTx + 9, depth: 50 },
      terminal: { depth: 18, H: 14, name: 'terminal', minLen: 90, maxLen: 220 },
      tower: { size: 12, H: 34, kind: 'tall', du: -40, dw: 12 },
      standPlan: ['medium', 'medium', 'medium', 'medium', 'medium'],
      bridges: true,
      hangars: [
        { width: 48, depth: 36, H: 14, at: ['west', -30], front: ['apron', 4] },
        { width: 34, depth: 28, H: 11, at: ['east', 220], front: ['apron', 4] },
      ],
      fire: { width: 30, depth: 18, H: 8, bays: 2, at: ['east', 150], front: ['twy', 14] },
      carPark: { width: 60, depth: 36, at: ['east', 300], front: ['apron', 0] },
      fuel: { width: 40, depth: 30, tanks: 3, r: 4.5, H: 9, at: ['east', 380], front: ['apron', 6] },
      edgeStep: 30,
      holdDist: 24,
      floodH: 20,
      floodGap: 70,
    };
  }
  if (shape === 'regional') {
    const k = Math.min(1, L / 1100);
    return {
      shape,
      twy: { w: 95, width: 24, half: L / 2 - 110 },
      connectors: [-(L / 2 - 120), 0, L / 2 - 120],
      apron: { u0: Math.round(-260 * k), u1: Math.round(100 * k), w0: 106, depth: 84 },
      terminal: { depth: 38, H: 24, name: 'terminal', minLen: 120, maxLen: 300 },
      // Kestrel's tower, (40, -206): 60 m in from the apron's east end, 16 m behind it.
      tower: { size: 16, H: 64, kind: 'tall', du: -60, dw: 16 },
      standPlan: ['heavy', 'medium', 'medium', 'medium', 'medium', 'medium', 'medium'],
      bridges: true,
      hangars: [
        { width: 64, depth: 56, H: 22, at: ['west', -58], front: ['abs', 170] },
        { width: 48, depth: 40, H: 16, at: ['east', 290], front: ['abs', 170] },
      ],
      fire: { width: 40, depth: 22, H: 9, bays: 3, at: ['east', 220], front: ['abs', 150] },
      carPark: { width: 96, depth: 56, at: ['east', 368], front: ['abs', 140] },
      fuel: { width: 60, depth: 44, tanks: 3, r: 7, H: 12, at: ['east', 470], front: ['abs', 176] },
      edgeStep: 30,
      holdDist: 27,
      floodH: 24,
      floodGap: 80,
    };
  }
  return {
    shape: 'hub',
    twy: { w: 170, width: 30, half: L / 2 - 150 },
    connectors: [-(L / 2 - 160), -L / 4, 0, L / 4, L / 2 - 160],
    apron: { u0: -700, u1: 500, w0: 185, depth: 121 },
    terminal: { depth: 56, H: 26, name: 'terminal', minLen: 400, maxLen: 1060 },
    tower: { size: 20, H: 84, kind: 'tall', du: -75, dw: 46 },
    standPlan: ['heavy', 'medium', 'medium', 'heavy', 'medium', 'medium', 'heavy', 'medium', 'medium', 'medium', 'heavy', 'medium', 'medium', 'medium', 'medium'],
    bridges: true,
    hangars: [
      { width: 110, depth: 90, H: 32, at: ['west', -81], front: ['apron', 10] },
      { width: 110, depth: 90, H: 32, at: ['west', -201], front: ['apron', 10] },
      { width: 70, depth: 60, H: 22, at: ['east', 295], front: ['apron', 10] },
    ],
    fire: { width: 60, depth: 26, H: 11, bays: 4, at: ['east', 120], front: ['twy', 12] },
    carPark: { width: 160, depth: 90, at: ['east', 410], front: ['apron', 20] },
    fuel: { width: 110, depth: 70, tanks: 4, r: 11, H: 16, at: ['east', 540], front: ['apron', 40] },
    edgeStep: 45,
    holdDist: 60,
    floodH: 30,
    floodGap: 110,
  };
}

/**
 * The smallest: a strip whose level ground is not deep enough for even the
 * strip's apron. The Stacks has 90 m of pad either side of its runway and
 * sea-stack rock straight after it; a 30 m apron fits, a 44 m one does not.
 */
function miniTemplate(L, hw) {
  const t = template('strip', L, hw);
  t.shape = 'strip';
  t.apron = { ...t.apron, depth: 30 };
  t.standPlan = ['light', 'light', 'light', 'light', 'light'];
  return t;
}

/** Which templates to try, biggest first, for a runway of this class. */
function ladder(cls) {
  if (cls === 'hub') return ['hub', 'regional', 'compact'];
  if (cls === 'regional') return ['regional', 'compact', 'strip', 'mini'];
  return ['strip', 'mini'];
}

/* ------------------------------------------------------------------ */
/* What sits on the stands before any traffic arrives                   */
/* ------------------------------------------------------------------ */

const hasType = (id) => AIRCRAFT.some((a) => a.id === id);

/**
 * Drawn wingspan and length of a roster type.
 *
 * From the type's `plan` where it has one — the drawn aeroplane from above,
 * in metres: { nose, tail, span } (see ../aircraft/extra/index.js). Otherwise
 * worked out from the physics shape, which is only right for aeroplanes drawn
 * the way the original eight are: nose 2.6 x bodyLength ahead of the centre
 * of gravity. The airliners and the jets pin bodyLength to the tail-strike
 * point instead and say so, and from the shape alone an A320 came out 29 m
 * long (drawn: 37.6), a 747 49 m (70.7) and an F-22 13 m (18.8) — and the
 * A320 was parked on a 36 m stand, its tail over the taxiway.
 */
export function typeSize(id) {
  const t = AIRCRAFT.find((a) => a.id === id);
  if (!t || !t.shape) return null;
  const p = t.plan;
  if (p) return { span: p.span, length: p.tail - p.nose };
  const s = t.shape;
  const sc = s.scale || 1;
  const span = 2 * ((s.wingRootX || 0) + (s.halfSpan || 5)) * sc;
  const length = (2.6 + 3.95) * (s.bodyLength || 1) * sc * 1.12;
  return { span, length };
}

/**
 * The longest aeroplane a stand takes: its depth less a metre each end. The
 * same number parkingSlots() tells the traffic, and the one the airport's own
 * aeroplanes are held to — nose-in, with the nose NOSE_STOP (1.5 m) short of
 * the line, that leaves half a metre of box behind the tail.
 */
export function standMaxLength(st) {
  return st.depth - 2;
}

/** Does an aeroplane this wide and this long fit on this stand? */
export function standFits(st, span, length) {
  return span <= st.maxSpan && length <= standMaxLength(st);
}

/**
 * Which stands get an aeroplane of their own, and which.
 *
 * The rule is "busy but never full". Every map keeps free stands of every
 * size for the traffic to use, and on the regional template the two stands
 * either side of the taxi tutorial's start point (-80, -150) stay empty, so
 * the first thing a new pilot does is not taxi out between two wingtips.
 *
 * An aeroplane only goes where it fits, drawn size against the stand's own
 * numbers (standFits). A stand is cut shorter than its class where the apron
 * is shallow — a medium stand on a compact field is 36 m, not 44; the
 * regional heavy stand is 70, not 76 — so a class is a hint, not a promise:
 * the 747 (70.7 m) fits no regional heavy stand and the A320 (37.6 m) no
 * compact medium one. A heavy stand nothing heavy fits takes a medium
 * aeroplane instead, as a real one would.
 */
function dressStands(stands, shape, military) {
  const heavyPick = ['b747', 'a380'].filter(hasType);
  const medPick = ['a320', 'meridian'].filter(hasType);
  const lightPick = ['courier', 'skylark'].filter(hasType);
  const fits = (id, st) => {
    const sz = typeSize(id);
    return !!sz && standFits(st, sz.span, sz.length);
  };
  const pick = (list, st, i) => {
    for (let k = 0; k < list.length; k++) {
      const id = list[(i + k) % list.length];
      if (fits(id, st)) return id;
    }
    return null;
  };
  let n = 0;
  /*
   * The air base: fighters on one stand in four. It had twenty-seven empty
   * stands and nothing on them, which is a car park, not an air base. The
   * fighters team's jets when they exist; the Vanguard until then. Three in
   * four stay free for the traffic.
   */
  if (military) {
    const jets = ['f22', 'fa18', 'f35b', 'vanguard'].filter(hasType);
    stands.forEach((st, i) => {
      if (i % 4 !== 1) return;
      const id = pick(jets, st, n);
      if (!id) return;
      st.occupant = id;
      st.livery = n;
      n++;
    });
    return;
  }
  stands.forEach((st, i) => {
    let want = false;
    if (shape === 'regional') {
      // Kestrel: heavy, then S2 and S5 at the terminal, one light remote stand.
      want = st.size === 'heavy' || (st.bridge && (st.number === 2 || st.number === 5)) || (!st.bridge && i === stands.length - 1);
    } else if (shape === 'hub') {
      want = st.bridge ? [0, 2, 3, 6, 8, 11, 13].includes(i) : i === stands.length - 2;
    } else if (shape === 'compact') {
      want = st.bridge ? st.number === 2 || st.number === 4 : i === stands.length - 1;
    } else {
      want = i === 0 || i === 3;
    }
    if (!want) return;
    const list = st.size === 'heavy' ? heavyPick : st.size === 'medium' ? medPick : lightPick;
    const id = pick(list, st, n) || (st.size === 'heavy' ? pick(medPick, st, n) : null);
    if (!id) return;
    st.occupant = id;
    st.livery = n;
    n++;
  });
}

/* ------------------------------------------------------------------ */
/* The builder                                                         */
/* ------------------------------------------------------------------ */

let memo = null;
let memoKey = '';

function keyOf() {
  const a = AIRPORT;
  const r = a.runway;
  const r2 = a.runway2;
  return [
    MAP && MAP.id, a.elev, r.cx, r.cz, r.length, r.halfWidth,
    r2 ? `${r2.cx},${r2.cz},${r2.length},${r2.halfWidth},${r2.headingDeg}` : '-',
    AIRCRAFT.length,
  ].join('|');
}

/*
 * The same question without building a string. airportLayout() is asked from
 * the frame loop — standAt() every frame the aeroplane sits still anywhere,
 * onAirportPavement() per wheel if the physics is handed it — and keyOf()
 * made a twelve-part string each time to find out nothing had changed. These
 * are the numbers the key is made of, compared one by one.
 */
const seen = { map: null, airport: null, elev: NaN, cx: NaN, cz: NaN, len: NaN, hw: NaN, r2: null, r2cx: NaN, r2cz: NaN, n: -1 };
function unchanged() {
  const a = AIRPORT;
  const r = a.runway;
  const r2 = a.runway2 || null;
  return (
    seen.map === MAP && seen.airport === a && seen.elev === a.elev && seen.cx === r.cx && seen.cz === r.cz &&
    seen.len === r.length && seen.hw === r.halfWidth && seen.r2 === r2 &&
    (!r2 || (seen.r2cx === r2.cx && seen.r2cz === r2.cz)) && seen.n === AIRCRAFT.length
  );
}
function remember() {
  const a = AIRPORT;
  const r = a.runway;
  const r2 = a.runway2 || null;
  seen.map = MAP;
  seen.airport = a;
  seen.elev = a.elev;
  seen.cx = r.cx;
  seen.cz = r.cz;
  seen.len = r.length;
  seen.hw = r.halfWidth;
  seen.r2 = r2;
  seen.r2cx = r2 ? r2.cx : NaN;
  seen.r2cz = r2 ? r2.cz : NaN;
  seen.n = AIRCRAFT.length;
}

/**
 * How often airportLayout() fell through to the slow path. For the node
 * check, which used to time 100,000 calls against 40 ms of wall clock and so
 * failed whenever the machine was busy (148 ms at load average 300, 3 ms idle).
 * Counting is the thing that matters: a call that neither keys nor builds
 * allocates nothing.
 */
export const layoutMemoStats = { keyed: 0, built: 0 };

/**
 * The layout for the map that is loaded. Memoised: the same object comes back
 * until the map (or the roster) changes.
 */
export function airportLayout() {
  if (memo && unchanged()) return memo;
  layoutMemoStats.keyed++;
  const k = keyOf();
  if (!memo || memoKey !== k) {
    layoutMemoStats.built++;
    memo = buildLayout();
    memoKey = k;
  }
  remember();
  return memo;
}

function buildLayout() {
  const A = AIRPORT;
  const R = A.runway;
  const elev = A.elev;
  const L = R.length;
  const hw = R.halfWidth;
  const cls = classFor(L);
  const military = !!(MAP && MAP.scenery && MAP.scenery.base);
  const dropped = [];

  const r2 = A.runway2 || null;
  const runways = [rect(R.cx - L / 2, R.cx + L / 2, R.cz - hw, R.cz + hw)];
  if (r2) {
    const alongX = Math.abs((((r2.headingDeg ?? 180) % 180) - 90)) < 45;
    runways.push(
      alongX
        ? rect(r2.cx - r2.length / 2, r2.cx + r2.length / 2, r2.cz - r2.halfWidth, r2.cz + r2.halfWidth)
        : rect(r2.cx - r2.halfWidth, r2.cx + r2.halfWidth, r2.cz - r2.length / 2, r2.cz + r2.length / 2)
    );
  }
  const avoid = keepOuts(MAP);
  const roads = authoredRoads(MAP);

  /* ---- ground tests ---- */
  /*
   * Up to two metres ABOVE field level is allowed for a building — its back
   * wall is cut into the rise, which is what a building on a slope looks
   * like. Less than a metre below, because the plinth under every building
   * goes down 1.5 m and anything deeper would show daylight under it.
   */
  const groundOk = (r, tolUp = 2.0, tolDown = 0.8, step = 0) => {
    const sx = step || Math.max(4, Math.min(25, (r.x1 - r.x0) / 3));
    const sz = step || Math.max(4, Math.min(25, (r.z1 - r.z0) / 3));
    for (let x = r.x0; x <= r.x1 + 0.01; x += sx) {
      for (let z = r.z0; z <= r.z1 + 0.01; z += sz) {
        const h = heightAt(x, z);
        if (!(h > 1.5)) return false;
        const d = h - elev;
        if (d > tolUp || d < -tolDown) return false;
      }
    }
    return true;
  };
  const keepOutHit = (r, withRoads) => {
    for (const k of avoid) {
      if (k.kind === 'circle') {
        const qx = Math.max(r.x0, Math.min(k.x, r.x1));
        const qz = Math.max(r.z0, Math.min(k.z, r.z1));
        if ((qx - k.x) ** 2 + (qz - k.z) ** 2 < k.r * k.r) return true;
      } else if (overlaps(r, k, k.pad || GAP)) return true;
    }
    if (withRoads) {
      const cxr = (r.x0 + r.x1) / 2;
      const czr = (r.z0 + r.z1) / 2;
      const rad = Math.hypot(r.x1 - r.x0, r.z1 - r.z0) / 2;
      for (const s of roads) {
        // Cheap reject on the circle round the rectangle, then sample it.
        if (segDist(cxr, czr, s.ax, s.az, s.bx, s.bz) > rad + s.hw + 2) continue;
        for (let i = 0; i <= 4; i++) {
          for (let j = 0; j <= 4; j++) {
            const x = r.x0 + ((r.x1 - r.x0) * i) / 4;
            const z = r.z0 + ((r.z1 - r.z0) * j) / 4;
            if (segDist(x, z, s.ax, s.az, s.bx, s.bz) < s.hw + 3) return true;
          }
        }
      }
    }
    // A flat that is somebody else's (a quay, a causeway, a depot).
    const fx = [r.x0, (r.x0 + r.x1) / 2, r.x1];
    const fz = [r.z0, (r.z0 + r.z1) / 2, r.z1];
    for (const x of fx) for (const z of fz) if (flatAt(x, z)) return true;
    return false;
  };
  const runwayHit = (r, margin) => runways.some((rw) => overlaps(r, rw, margin));

  /* ---- choose the side and the apron block ---- */
  /*
   * The apron, the terminal behind it and the tower beside it move as one
   * block, because a terminal that has slid 300 m away from its own jet
   * bridges is worse than no terminal. Try the template position, then slide
   * along the runway, then try the other side; the first place all three pass
   * wins.
   */
  const trySide = (T, side) => {
    const F = new Frame(R.cx, R.cz, side);
    const apW0 = T.apron.w0;
    const apW1 = T.apron.w0 + T.apron.depth;
    const tFront = apW1 + 3;
    const tBack = tFront + T.terminal.depth;
    const width = T.apron.u1 - T.apron.u0;
    const shifts = [0];
    for (let d = 20; d <= L / 2; d += 20) shifts.push(d, -d);
    // A shorter apron is better than none: 100%, then 75%, then 55%.
    for (const shrink of [1, 0.75, 0.55]) {
      const wAp = Math.round(width * shrink);
      const u0base = T.apron.u0 + (width - wAp) / 2;
      for (const du of shifts) {
        const u0 = u0base + du;
        const u1 = u0 + wAp;
        if (u0 < -L / 2 + 10 || u1 > L / 2 - 10) continue;
        const apron = F.rect(u0, u1, apW0, apW1);
        const towerU = u1 + T.tower.du;
        const towerW = apW1 + T.tower.dw;
        const ts = T.tower.size;
        const tower = F.rect(towerU - ts / 2, towerU + ts / 2, towerW - ts / 2, towerW + ts / 2);
        const termU0 = u0 + 5;
        const termU1 = T.shape === 'strip'
          ? termU0 + Math.min(T.terminal.maxLen, wAp * 0.4)
          : Math.min(towerU - ts / 2 - 10, termU0 + T.terminal.maxLen);
        if (termU1 - termU0 < T.terminal.minLen * (shrink < 1 ? 0.6 : 1)) continue;
        const terminal = F.rect(termU0, termU1, tFront, tBack);
        if (runwayHit(apron, 20) || runwayHit(terminal, 30) || runwayHit(tower, 30)) continue;
        if (keepOutHit(apron, false) || keepOutHit(terminal, true) || keepOutHit(tower, true)) continue;
        if (!groundOk(apron, PAVE_UP, PAVE_DOWN, 12)) continue;
        if (!groundOk(terminal) || !groundOk(tower)) continue;
        if (overlaps(terminal, tower, 2)) continue;
        return { F, side, apron, apU0: u0, apU1: u1, apW0, apW1, tFront, tBack, termU0, termU1, terminal, tower, towerU, towerW, shift: du, shrink };
      }
    }
    return null;
  };
  let block = null;
  let T = null;
  for (const shape of ladder(cls)) {
    const t = shape === 'mini' ? miniTemplate(L, hw) : template(shape, L, hw);
    /*
     * An air base has no passenger terminal, and the hub's one — 1,060 m of
     * 26 m office wall — stood along Ironhead's apron like a dam. Its
     * operations block is a squadron building: 240 m at most, 12 m high.
     */
    if (military) t.terminal = { ...t.terminal, name: 'operations', H: 12, minLen: 60, maxLen: 240 };
    block = trySide(t, -1) || trySide(t, 1);
    if (block) {
      T = t;
      break;
    }
  }
  if (!block) {
    // No room anywhere. The runway still works; the airfield is just grass.
    return emptyLayout(cls, military, elev, R, dropped.concat(['apron', 'terminal', 'tower']));
  }
  const F = block.F;
  const side = block.side;
  const shape = T.shape;

  /* ---- taxiways ---- */
  const pavement = [];
  const twyW = T.twy.w;
  const twyHalf = T.twy.width / 2;
  // Clip the parallel taxiway to ground it can actually lie on.
  let tu0 = -T.twy.half;
  let tu1 = T.twy.half;
  const twyOk = (ua, ub) => groundOk(F.rect(ua, ub, twyW - twyHalf, twyW + twyHalf), PAVE_UP, PAVE_DOWN, 10) && !keepOutHit(F.rect(ua, ub, twyW - twyHalf, twyW + twyHalf), false);
  // Always keep the stretch in front of the apron.
  tu0 = Math.min(tu0, block.apU0);
  tu1 = Math.max(tu1, block.apU1);
  while (tu0 < block.apU0 - 10 && !twyOk(tu0, tu0 + 20)) tu0 += 20;
  while (tu1 > block.apU1 + 10 && !twyOk(tu1 - 20, tu1)) tu1 -= 20;
  const taxiway = { id: 'A', rect: F.rect(tu0, tu1, twyW - twyHalf, twyW + twyHalf), u0: tu0, u1: tu1, w: twyW, width: T.twy.width };
  pavement.push({ kind: 'taxiway', ...taxiway.rect });

  /*
   * Connectors, from the runway edge to the parallel taxiway. On Kestrel the
   * two that always existed (x -430 and 0) come out where they were; the
   * third (x 430) is new.
   */
  const connectors = [];
  const kestrelShape = shape === 'regional' && L === 1100 && R.cx === 0 && R.cz === 0 && hw === 17 && side === -1 && block.shift === 0;
  let cn = 0;
  for (const cu of T.connectors) {
    if (cu < tu0 - 2 || cu > tu1 + 2) continue;
    // From just under the runway edge: the runway is drawn over the first
    // half-metre, so there is no crack and nothing is drawn on top of it.
    const r = F.rect(cu - twyHalf, cu + twyHalf, hw - 0.5, twyW - twyHalf);
    if (!groundOk(F.rect(cu - twyHalf, cu + twyHalf, hw + 2, twyW - twyHalf), PAVE_UP, PAVE_DOWN, 8)) continue;
    cn++;
    connectors.push({ id: `A${cn}`, u: cu, rect: r, hold: { u: cu, w: hw + T.holdDist } });
    pavement.push({ kind: 'connector', ...r });
  }

  /* ---- apron ---- */
  pavement.push({ kind: 'apron', ...block.apron });

  /* ---- stands ---- */
  const stands = [];
  const noseW = block.tFront - 15; // Kestrel: 193 - 15 = 178, where the stop bars always were
  const noseWStrip = block.apW1 - 4;
  let uCursor = block.termU0 + 1;
  const termEnd = block.termU1 - 1;
  const plan = T.standPlan.slice();
  const place = (size, bridge, uStart, uEnd) => {
    const S = STAND_SIZES[size];
    if (uStart + S.pitch > uEnd + 0.01) return false;
    const nW = shape === 'strip' ? noseWStrip : noseW;
    const depth = Math.min(S.depth, nW - block.apW0 - 2);
    const u = uStart + S.pitch / 2;
    const number = stands.length + 1;
    const noseX = F.x(u);
    const noseZ = F.z(nW);
    const cW = nW - depth / 2;
    stands.push({
      id: `stand-${number}`,
      number,
      size,
      bridge,
      u,
      noseW: nW,
      depth,
      pitch: S.pitch,
      maxSpan: S.span,
      x: F.x(u),
      z: F.z(cW),
      noseX,
      noseZ,
      headingDeg: F.awayDeg,
      box: F.rect(u - S.pitch / 2, u + S.pitch / 2, nW - depth, nW),
      occupant: null,
      livery: 0,
    });
    return true;
  };
  if (shape === 'strip') {
    // A strip has no terminal front to line up on: the stands run along the
    // back of the apron, and the clubhouse sits behind the first few.
    uCursor = block.apU0 + 2;
    for (const size of plan) {
      if (!place(size, false, uCursor, block.apU1 - 2)) break;
      uCursor += STAND_SIZES[size].pitch;
    }
  } else {
    // Contact stands along the terminal, with bridges...
    for (const size of plan) {
      if (military) break;
      if (!place(size, T.bridges, uCursor, termEnd)) {
        // A heavy that does not fit may leave room for a medium.
        if (size === 'heavy' && place('medium', T.bridges, uCursor, termEnd)) {
          uCursor += STAND_SIZES.medium.pitch;
          continue;
        }
        continue;
      }
      uCursor += STAND_SIZES[size].pitch;
    }
    // ...and remote stands in front of the tower, walked out to by stairs.
    const remoteSize = shape === 'hub' || military ? 'medium' : 'light';
    let ru = military ? block.apU0 + 2 : Math.max(uCursor, block.termU1) + 4;
    while (place(remoteSize, false, ru, block.apU1 - 2)) ru += STAND_SIZES[remoteSize].pitch;
  }
  dressStands(stands, shape, military);

  /* ---- buildings ---- */
  const buildings = [];
  const standRects = stands.map((s) => s.box);
  const clearOf = (r) => {
    if (runwayHit(r, shape === 'strip' ? 25 : 40)) return false;
    for (const p of pavement) if (overlaps(r, p, 3)) return false;
    for (const s of standRects) if (overlaps(r, s, 2)) return false;
    for (const b of buildings) if (overlaps(r, b.clear || b.rect, GAP)) return false;
    if (keepOutHit(r, true)) return false;
    return true;
  };
  buildings.push({ kind: 'terminal', rect: block.terminal });
  buildings.push({ kind: 'tower', rect: block.tower });

  /**
   * Find somewhere for a building of `wid` (along the runway) by `dep`, whose
   * FRONT (the edge nearest the runway) wants to be at `w0` and whose middle
   * wants to be at `uPref`. Searches outward from there, sliding along first
   * because the rows of an airfield run along its runway.
   */
  /*
   * Candidates are tried cheapest first, where sliding along the field costs
   * one per metre and stepping back from the runway costs three: a hangar
   * 40 m further along the row reads better than one pushed back into the
   * hillside, and far better than one on the wrong side of the tower.
   */
  const stepU = shape === 'hub' ? 20 : 10;
  const candidates = [];
  for (let du = -L * 0.7; du <= L * 0.7; du += stepU) {
    for (let dw = 0; dw <= 90; dw += 10) candidates.push({ du, dw, cost: Math.abs(du) + 3 * dw });
  }
  candidates.sort((a, b) => a.cost - b.cost);
  const site = (wid, dep, uPref, w0Pref, wMax, extraOk) => {
    let tries = 0;
    for (const c of candidates) {
      const w0 = w0Pref + c.dw;
      if (w0 + dep > wMax) continue;
      const u = uPref + c.du;
      if (Math.abs(u) + wid / 2 > L / 2 + 60) continue;
      const r = F.rect(u - wid / 2, u + wid / 2, w0, w0 + dep);
      if (!clearOf(r)) continue;
      if (++tries > 1500) return null;
      if (!groundOk(r)) continue;
      if (extraOk && !extraOk(r, u, w0)) continue;
      return { u, w0, rect: r };
    }
    return null;
  };
  // Deepest the flat ground goes on this side, measured, so nothing is placed
  // on the hillside behind the pad.
  const padDepth = (() => {
    let w = twyW;
    while (w < 1200) {
      const r = F.rect(block.apU0, block.apU1, w, w + 10);
      if (!groundOk(r, 1.0, 0.8, 20)) break;
      w += 10;
    }
    return w;
  })();
  const behindTwy = twyW + twyHalf + 3;
  const eastOf = block.apU1;
  const westOf = block.apU0;
  // Where a template's `at` and `front` land on this field.
  const anchorU = (at, wid) => (at[0] === 'west' ? westOf + at[1] - wid / 2 : eastOf + at[1] + wid / 2);
  const anchorW = (front) =>
    front[0] === 'abs' ? front[1] : front[0] === 'twy' ? behindTwy + front[1] : block.apW0 + front[1];
  const wLimit = (w0, dep) => Math.max(padDepth + 30, w0 + dep);

  /* hangars, with a paved lead-in from the taxiway to the doors */
  const hangars = [];
  for (const h of T.hangars) {
    const uPref = anchorU(h.at, h.width);
    const w0Pref = Math.max(anchorW(h.front), behindTwy);
    // The door leaves slide out past the walls, a quarter of the width each
    // side, so the site has to be half as wide again as the building.
    const runoff = h.width * 1.5;
    const s = site(runoff, h.depth, uPref, w0Pref, wLimit(w0Pref, h.depth), (r, u, w0) => {
      // You can see the floor through the doors, so it is held to pavement's
      // tolerance, not a building's.
      if (!groundOk(F.rect(u - h.width / 2, u + h.width / 2, w0, w0 + h.depth), 0.08, 0.8, 6)) return false;
      // The lead-in has to be clear too.
      const lead = F.rect(u - h.width / 2, u + h.width / 2, twyW + twyHalf, w0);
      if (w0 - (twyW + twyHalf) < 1) return true;
      if (runwayHit(lead, 5) || keepOutHit(lead, false)) return false;
      for (const b of buildings) if (overlaps(lead, b.rect, 2)) return false;
      for (const st of standRects) if (overlaps(lead, st, 1)) return false;
      if (u - h.width / 2 < tu0 || u + h.width / 2 > tu1) return false;
      return groundOk(lead, PAVE_UP, PAVE_DOWN, 10);
    });
    if (!s) {
      dropped.push(`hangar ${h.width}x${h.depth}`);
      continue;
    }
    const n = hangars.length + 1;
    const real = F.rect(s.u - h.width / 2, s.u + h.width / 2, s.w0, s.w0 + h.depth);
    const hg = {
      id: `hangar-${n}`,
      number: n,
      u: s.u,
      w0: s.w0,
      width: h.width,
      depth: h.depth,
      H: h.H,
      rect: real,
      clearRect: s.rect,
      doorWidth: h.width - 2,
      slot: {
        id: `hangar-${n}`,
        kind: 'hangar',
        x: F.x(s.u),
        z: F.z(s.w0 + h.depth / 2),
        headingDeg: F.towardDeg,
        maxSpan: h.width - 6,
        maxLength: h.depth - 4,
      },
      occupant: null,
    };
    hangars.push(hg);
    buildings.push({ kind: 'hangar', rect: real, clear: s.rect });
    if (s.w0 > behindTwy - 3) {
      const lead = F.rect(s.u - h.width / 2, s.u + h.width / 2, twyW + twyHalf, s.w0);
      pavement.push({ kind: 'lead', ...lead });
    }
  }
  /*
   * One hangar is always busy: an aeroplane in for maintenance, doors open,
   * lights on. It is the first one — the others are the traffic's. A jet if
   * the hangar is a jet's size: a Courier alone in a 64 m hangar looked like
   * a toy somebody had left on the floor.
   */
  if (hangars.length && !military) {
    const h = hangars[0];
    const id = ['meridian', 'courier', 'skylark'].find((t) => {
      const sz = hasType(t) && typeSize(t);
      return sz && sz.span <= h.width - 8 && sz.length <= h.depth - 6;
    });
    if (id) h.occupant = id;
  }

  /* fire station: close to the runway's middle, with its own driveway */
  let fire = null;
  {
    const f = T.fire;
    const uPref = anchorU(f.at, f.width);
    const w0Pref = Math.max(anchorW(f.front), behindTwy);
    const s = site(f.width, f.depth, uPref, w0Pref, wLimit(w0Pref, f.depth));
    if (s) {
      fire = { ...f, u: s.u, w0: s.w0, rect: s.rect };
      buildings.push({ kind: 'fire', rect: s.rect });
      const drive = F.rect(s.u - f.width / 2 + 2, s.u + f.width / 2 - 2, twyW + twyHalf, s.w0);
      const driveOk = s.w0 - (twyW + twyHalf) > 2 && !runwayHit(drive, 2) && groundOk(drive, PAVE_UP, PAVE_DOWN, 8) && !keepOutHit(drive, false);
      if (driveOk) pavement.push({ kind: 'drive', ...drive });
    } else dropped.push('fire station');
  }

  /* car park */
  let carPark = null;
  {
    const c = T.carPark;
    const uPref = anchorU(c.at, c.width);
    const w0Pref = Math.max(anchorW(c.front), behindTwy);
    // Tarmac, so tarmac's tolerance.
    const s = site(c.width, c.depth, uPref, w0Pref, wLimit(w0Pref, c.depth), (r) => groundOk(r, PAVE_UP, PAVE_DOWN, 8));
    if (s) {
      carPark = { ...c, u: s.u, w0: s.w0, rect: s.rect };
      buildings.push({ kind: 'carpark', rect: s.rect });
    } else dropped.push('car park');
  }

  /* fuel farm: well away from the terminal */
  let fuel = null;
  {
    const f = T.fuel;
    const uPref = anchorU(f.at, f.width);
    const w0Pref = Math.max(anchorW(f.front), behindTwy);
    const s = site(f.width, f.depth, uPref, w0Pref, wLimit(w0Pref, f.depth));
    if (s) {
      fuel = { ...f, u: s.u, w0: s.w0, rect: s.rect };
      buildings.push({ kind: 'fuel', rect: s.rect });
    } else dropped.push('fuel farm');
  }

  /* ---- floodlight masts along the back of the apron ---- */
  const floods = [];
  {
    const H = T.floodH;
    const back = block.apW1 - 2;
    const edges = [block.apU0 + 2];
    for (let i = 1; i < stands.length; i++) edges.push(stands[i].u - stands[i].pitch / 2);
    edges.push(block.apU1 - 2);
    let last = -1e9;
    const gap = T.floodGap;
    for (const u of edges) {
      if (u - last < gap) continue;
      last = u;
      floods.push({ x: F.x(u), z: F.z(back), H, facing: F.towardDeg });
    }
  }

  /* ---- signs ---- */
  const signs = [];
  {
    const rwName = '09-27';
    const small = shape === 'strip';
    for (const c of connectors) {
      // Mandatory sign at the hold line, on the pilot's left as they face the
      // runway: heading south from a north apron, left is east (+u), so -side.
      const lx = F.x(c.u - side * (twyHalf + 7));
      signs.push({ kind: 'mandatory', text: rwName, x: lx, z: F.z(c.hold.w + 2), facingDeg: F.towardDeg, small });
      // Location sign at the junction, on the left of a pilot leaving the runway.
      signs.push({ kind: 'location', text: c.id, x: F.x(c.u + side * (twyHalf + 7)), z: F.z(twyW - twyHalf - 8), facingDeg: F.awayDeg, small });
    }
    // Direction boards on the parallel taxiway at the apron's two corners.
    // `facingDeg` is the heading of the pilot who reads it.
    signs.push({ kind: 'direction', text: 'APRON', arrow: side < 0 ? 'left' : 'right', x: F.x(block.apU0 - 10), z: F.z(twyW - twyHalf - 7), facingDeg: 90, small });
    signs.push({ kind: 'location', text: 'A', x: F.x(block.apU1 + 10), z: F.z(twyW - twyHalf - 7), facingDeg: 270, small });
    // Keep them off the pavement and off buildings.
    for (let i = signs.length - 1; i >= 0; i--) {
      const s = signs[i];
      const r = rect(s.x - 2, s.x + 2, s.z - 1, s.z + 1);
      const bad = runwayHit(r, 3) || pavement.some((p) => overlaps(r, p, 0.5)) || buildings.some((b) => overlaps(r, b.rect, 1)) || !groundOk(r, 1.2, 1.2, 2);
      if (bad) signs.splice(i, 1);
    }
  }

  /* ---- the windsock ---- */
  /*
   * Kestrel's has always been at (-500, -60), where the approach to 09 can see
   * it. Elsewhere the same idea: 50 m in from the 09 threshold, between the
   * runway and the taxiway, moved along until it is off every piece of
   * pavement and clear of the PAPI.
   */
  let windsock = null;
  {
    const wPref = kestrelShape ? 60 : Math.round((hw + (twyW - twyHalf)) / 2);
    const touchU = -L / 2 + 200;
    for (let d = 0; d <= L / 2 && !windsock; d += 10) {
      const u = -L / 2 + 50 + d;
      const r = F.rect(u - 3, u + 3, wPref - 3, wPref + 3);
      if (Math.abs(u - touchU) < 12) continue;
      if (runwayHit(r, 2) || pavement.some((p) => overlaps(r, p, 3)) || keepOutHit(r, false)) continue;
      if (!groundOk(r, 1.5, 1.5, 3)) continue;
      windsock = { x: F.x(u), z: F.z(wPref) };
    }
  }

  /* ---- the exported slots ---- */
  const slots = [];
  for (const st of stands) if (!st.occupant) slots.push(standSlot(st, elev));
  for (const h of hangars) if (!h.occupant) slots.push({ ...h.slot, y: elev });

  let paveBox = null;
  for (const p of pavement) {
    if (!paveBox) paveBox = { x0: p.x0, x1: p.x1, z0: p.z0, z1: p.z1 };
    else {
      paveBox.x0 = Math.min(paveBox.x0, p.x0);
      paveBox.x1 = Math.max(paveBox.x1, p.x1);
      paveBox.z0 = Math.min(paveBox.z0, p.z0);
      paveBox.z1 = Math.max(paveBox.z1, p.z1);
    }
  }

  return {
    key: keyOf(),
    mapId: MAP && MAP.id,
    cls,
    shape,
    military,
    kestrelShape,
    paveBox,
    elev,
    side,
    frame: F,
    bridges: T.bridges && !military,
    holdDist: T.holdDist,
    runway: { cx: R.cx, cz: R.cz, length: L, halfWidth: hw },
    runways,
    taxiway,
    connectors,
    apron: { rect: block.apron, u0: block.apU0, u1: block.apU1, w0: block.apW0, w1: block.apW1 },
    pavement,
    terminal: {
      rect: block.terminal,
      u0: block.termU0,
      u1: block.termU1,
      front: block.tFront,
      back: block.tBack,
      H: T.terminal.H,
      name: T.terminal.name,
      depth: T.terminal.depth,
    },
    tower: {
      x: F.x(block.towerU),
      z: F.z(block.towerW),
      u: block.towerU,
      w: block.towerW,
      size: T.tower.size,
      H: T.tower.H,
      kind: T.tower.kind,
      rect: block.tower,
    },
    stands,
    hangars,
    fire,
    fuel,
    carPark,
    floods,
    signs,
    windsock,
    edgeStep: T.edgeStep,
    buildings,
    slots,
    /*
     * Stands and hangars the airport meant to fill but the world did not
     * draw — the detail level caps how many parked aeroplanes a laptop is
     * asked for, and 'low' draws none. apron.js fills this in as it builds;
     * parkingSlots() hands them to the traffic as free.
     */
    undrawn: new Set(),
    padDepth,
    dropped,
    shift: block.shift,
    shrink: block.shrink,
  };
}

function emptyLayout(cls, military, elev, R, dropped) {
  return {
    key: keyOf(), mapId: MAP && MAP.id, cls, shape: 'none', military, kestrelShape: false, paveBox: null, elev, side: -1,
    bridges: false, holdDist: 20,
    frame: new Frame(R.cx, R.cz, -1),
    runway: { cx: R.cx, cz: R.cz, length: R.length, halfWidth: R.halfWidth },
    runways: [], taxiway: null, connectors: [], apron: null, pavement: [], terminal: null, tower: null,
    stands: [], hangars: [], fire: null, fuel: null, carPark: null, floods: [], signs: [], windsock: null, edgeStep: 30,
    buildings: [], slots: [], undrawn: new Set(), padDepth: 0, dropped, shift: 0, shrink: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/**
 * True if (x, z) is on this airfield's made ground (not counting runways).
 *
 * Cheap enough for a wheel contact: one box round all the pavement rejects
 * everything off the airfield before any rectangle is looked at.
 */
export function onAirportPavement(x, z) {
  return pavedIn(airportLayout(), x, z);
}

/** The same, against a layout you already hold. */
export function pavedIn(lay, x, z) {
  const b = lay && lay.paveBox;
  if (!b || x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) return false;
  const p = lay.pavement;
  for (let i = 0; i < p.length; i++) if (inside(p[i], x, z)) return true;
  return false;
}

/** A stand, in the shape parkingSlots() hands out. */
export function standSlot(st, elev) {
  return {
    id: st.id,
    kind: 'stand',
    x: st.x,
    y: elev,
    z: st.z,
    headingDeg: st.headingDeg,
    maxSpan: st.maxSpan,
    maxLength: standMaxLength(st),
    noseX: st.noseX,
    noseZ: st.noseZ,
    bridge: st.bridge,
    size: st.size,
  };
}

/**
 * Is there an aeroplane of the airport's own on this stand? Drawn, or meant
 * to be and not yet built. One the detail level left out is not there.
 */
export function standTaken(st) {
  if (!st) return false;
  if (st.parked) return true;
  return !!st.occupant && !(memo && memo.undrawn.has(st));
}

/** The stand whose box contains (x, z), or null. */
export function standAt(x, z, margin = 0) {
  const lay = airportLayout();
  for (const s of lay.stands) if (inside(s.box, x, z, margin)) return s;
  return null;
}

/**
 * Where the nose of a parked aeroplane stops: 1.5 m short of the stand's nose
 * line, which puts the nose wheel of everything on the roster on or just
 * behind the painted stop bar (3 m short of the line). The airport's own
 * aeroplanes are parked to this, and the docking board counts down to it.
 */
export const NOSE_STOP = 1.5;

/**
 * The stand an aeroplane is pulling onto, for the docking board.
 *
 * (noseX, noseZ) is the tip of its nose. It counts as on a stand's lead-in
 * when it is inside that stand's column of apron, between the taxi lane and
 * twelve metres past the stop, pointing into the stand within 40 degrees.
 * Twelve, because an aeroplane can roll well past and cannot back out: it
 * has to go on being on its stand, so it can be told so and pushed back.
 *
 * Returns { stand, toGo, lateral } — metres still to roll to the stop (goes
 * negative past it), and metres off the lead-in line, positive to the pilot's
 * right — or null. Writes into `out` so the frame loop allocates nothing.
 */
export function standApproach(noseX, noseZ, headingDeg, out = {}) {
  const lay = airportLayout();
  if (!lay.apron || !lay.stands.length) return null;
  const F = lay.frame;
  const u = noseX - F.cx;
  const w = (noseZ - F.cz) * F.side;
  if (w < lay.apron.w0 - 4 || w > lay.apron.w1 + 14) return null;
  for (let i = 0; i < lay.stands.length; i++) {
    const st = lay.stands[i];
    const du = u - st.u;
    if (Math.abs(du) > st.pitch / 2) continue;
    if (w > st.noseW + 12) continue;
    const dh = Math.abs((((headingDeg - st.headingDeg) % 360) + 540) % 360 - 180);
    if (dh > 40) continue;
    out.stand = st;
    out.toGo = st.noseW - NOSE_STOP - w;
    // Facing +w, the pilot's right is +u on a north apron (side -1) and -u
    // on a south one.
    out.lateral = -F.side * du;
    return out;
  }
  return null;
}

export { rect as layoutRect, overlaps as rectsOverlap, inside as rectContains };

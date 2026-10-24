/**
 * The popular airliners, drawn at full size: Boeing 737 MAX 8, Airbus
 * A321neo, Boeing 787-9, Airbus A350-900, Boeing 777-300ER and the Dash 8
 * Q400. Built exactly the way ./airliners.js builds the A320, the 747 and
 * the A380 — the airliner kit's lofted fuselage and livery, framed flight
 * deck, window rows, doors that open, turbofans, real undercarriage — from
 * the same measurements the flight model flies (JET_GEOMETRY in
 * ../../aircraft/extra/jets.js), whose fuselage stations are generated in
 * ../../aircraft/extra/jet-shapes.js.
 *
 * WHAT MAKES EACH ONE ITSELF, from 300 m and from the jet bridge:
 *
 *   737   a pointed, drooping nose; big round fans tucked forward and right
 *         up under the wing; split-tip winglets (a blade up, a blade down);
 *         the dorsal fin fillet running forward from the fin
 *   A321  the A320 nose and sharklets on a tube seven metres longer, four
 *         pairs of doors, bigger new-generation fans
 *   787   a smooth nose with no break at the windscreen; tall cabin windows;
 *         a long thin wing curving up at the tips; serrated (chevron) fan
 *         nozzles
 *   A350  the same smooth nose with a broad black mask round the glazing;
 *         sharklets that curl up out of the tip in one sweep
 *   777   the longest here; the two biggest fans in the game; six wheels on
 *         each main leg; a blade-shaped tail cone
 *   Q400  a regional turboprop: a high wing with the nacelles slung under it
 *         and the main wheels in them, six-bladed propellers, a T-tail
 *
 * Proportions against the real aeroplanes (span x length), held to 2% by
 * tests/features/new-aircraft.mjs on the built model:
 *   737 35.92 x 39.52   A321 35.80 x 44.51   787 60.12 x 62.81
 *   A350 64.75 x 66.80  777 64.80 x 73.86    Q400 28.42 x 32.83
 *
 * No maker's logo, emblem or trademark is drawn anywhere: the house colours
 * are the game's own, and type names are only names.
 */

import * as THREE from '../../vendor/three.module.js';
import { JET_GEOMETRY } from '../../aircraft/extra/jets.js';
import { ringsBetween } from '../../aircraft/extra/jet-shapes.js';
import {
  dressAirliner as dress, refitAirlinerLeg as refitLeg, bodyOf, ellipseStation as ell,
  plate, wingAt, trailingEdgeFill, levelBogies, findByName,
} from './airliners.js';
import { meshOf, piecewise, loftFuselage } from './airliner-kit.js';
import { hull } from '../../aircraft/models/civil-kit.js';

const mix = (a, b, t) => a + (b - a) * t;

/** Axle height: the contact point plus a tyre radius. */
const axleY = (g, r) => g.ground + r;

/** Both sides of a door list ('#' becomes L and R). */
const both = (list) => list.flatMap((d) => [
  { ...d, id: d.id.replace('#', 'L'), side: 'left' },
  { ...d, id: d.id.replace('#', 'R'), side: 'right' },
]);

/** The engines a model draws, from the geometry's (already mirrored) list. */
function enginesOf(g, { kind = 'jet', names = null, prop = null } = {}) {
  const four = g.engines.length > 2;
  return g.engines.map((e, i) => {
    const side = e.x < 0 ? 'left' : 'right';
    const id = names ? names[i] : four ? `${side}${i % (g.engines.length / 2) ? 'Outboard' : 'Inboard'}Engine` : `${side}Engine`;
    const out = { id, kind, x: e.x, y: e.y, z: e.z, radius: e.r, length: e.length };
    if (prop) Object.assign(out, { propRadius: e.prop, blades: e.blades || 6, counterRotate: e.x < 0 });
    return out;
  });
}

/**
 * The kit's dress() with the engines left out: it lays a turbofan on every
 * engine group, and a turboprop's nacelle and propeller are the pack core's
 * own (aircraft-core.js), which dress would strip. Same for a twin fin.
 */
function dressWithout(ctx, S, { engines = false, fin = false } = {}) {
  const saved = ctx.config;
  ctx.config = { ...saved, ...(engines ? { engines: [] } : {}), ...(fin ? { fin: null } : {}) };
  try {
    return dress(ctx, S);
  } finally {
    ctx.config = saved;
  }
}

/* ------------------------------------------------------------------ *
 * Details
 * ------------------------------------------------------------------ */

/**
 * Chevrons: the saw-tooth trailing edge on a quiet fan nozzle (787, 737
 * MAX). A ring of thin teeth round the fan nozzle's exit, each a little
 * triangle pointing aft and tipped slightly in.
 */
function chevrons(ctx, e, mat, count = 14) {
  const g = ctx.parts[e.id];
  if (!g) return;
  const R = e.radius;
  const L = e.length;
  const z0 = e.z - L / 2 + 0.7 * L;
  const r0 = 0.865 * R;
  const pos = [];
  const depth = 0.07 * L;
  for (let i = 0; i < count; i++) {
    const a0 = (i / count) * Math.PI * 2;
    const a1 = ((i + 1) / count) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const p0 = [e.x + Math.cos(a0) * r0, e.y + Math.sin(a0) * r0, z0];
    const p1 = [e.x + Math.cos(a1) * r0, e.y + Math.sin(a1) * r0, z0];
    const tip = [e.x + Math.cos(am) * r0 * 0.93, e.y + Math.sin(am) * r0 * 0.93, z0 + depth];
    // Both faces: outside and in.
    pos.push(...p0, ...tip, ...p1, ...p0, ...p1, ...tip);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.computeVertexNormals();
  meshOf(ctx, 'Chevron nozzle', geo, mat, g);
}

/** A dorsal fillet: the low swept strake running forward from the fin root along the crown. */
function dorsalFin(ctx, h, z0, z1, height, mat) {
  const top0 = h.topAt(z0);
  const top1 = h.topAt(z1);
  plate(ctx, 'Dorsal fin', [
    [0, top0 - 0.03, z0], [0, top1 - 0.05, z1], [0, top1 + height, z1], [0, top0 + 0.02, z0 + 0.05],
  ], 0.18, mat, ctx.parts.verticalFin || ctx.parts.tail);
}

/** Split-tip winglets (737 MAX): a tall blade up and back, a short one down and forward. */
function splitScimitar(ctx, m, up, down) {
  const w = ctx.config.wing;
  const tipX = w.rootX + w.span;
  const tip = wingAt(w, tipX);
  for (const s of [-1, 1]) {
    const wing = ctx.parts[s < 0 ? 'leftWing' : 'rightWing'];
    const x0 = s * (tipX - 0.04);
    plate(ctx, 'Winglet', [
      [x0, tip.mid, tip.le + 0.05], [x0, tip.mid, tip.te - 0.05],
      [s * (tipX + up.out), tip.mid + up.h, tip.te + up.back], [s * (tipX + up.out), tip.mid + up.h, tip.te + up.back - up.chord],
    ], 0.1, m.accent, wing);
    plate(ctx, 'Lower winglet', [
      [x0, tip.mid - 0.02, tip.le + 0.1], [x0, tip.mid - 0.02, tip.le + 0.75],
      [s * (tipX + down.out), tip.mid - down.h, tip.le + 0.75 + down.back], [s * (tipX + down.out), tip.mid - down.h, tip.le + 0.4 + down.back],
    ], 0.08, m.accent, wing);
  }
}

/** Sharklets, A320-family style: a curved blend out of the tip, then a tall swept fin. */
function sharklets(ctx, m, { out = 0.57, rise = 0.62, h = 2.45, lean = 0.28 } = {}) {
  const w = ctx.config.wing;
  const tipX = w.rootX + w.span;
  const tip = wingAt(w, tipX);
  for (const s of [-1, 1]) {
    const wing = ctx.parts[s < 0 ? 'leftWing' : 'rightWing'];
    const x0 = s * (tipX - 0.05);
    const x1 = s * (tipX + out);
    plate(ctx, 'Sharklet blend', [
      [x0, tip.mid, tip.le + 0.05], [x0, tip.mid, tip.te],
      [x1, tip.mid + rise, tip.te + 0.1], [x1, tip.mid + rise, tip.le + 0.55],
    ], 0.13, m.accent, wing);
    plate(ctx, 'Sharklet', [
      [x1, tip.mid + rise, tip.le + 0.55], [x1, tip.mid + rise, tip.te + 0.1],
      [x1 + s * lean, tip.mid + h, tip.te + 0.5], [x1 + s * lean, tip.mid + h, tip.te + 0.08],
    ], 0.11, m.accent, wing);
  }
}

/**
 * The A350's sharklet: no corner where it leaves the wing — three panels
 * bending up out of the tip through about eighty degrees.
 */
function curlTips(ctx, m, { out, h, steps = 3 }) {
  const w = ctx.config.wing;
  const tipX = w.rootX + w.span;
  const tip = wingAt(w, tipX);
  for (const s of [-1, 1]) {
    const wing = ctx.parts[s < 0 ? 'leftWing' : 'rightWing'];
    let prev = { x: tipX - 0.05, y: tip.mid, le: tip.le + 0.05, te: tip.te };
    for (let i = 1; i <= steps; i++) {
      const a = (i / steps) * (Math.PI / 2) * 0.9;
      const x = tipX + out * Math.sin(a);
      const y = tip.mid + h * (1 - Math.cos(a)) * 1.35;
      const chord = mix(tip.te - tip.le, 0.7, i / steps);
      const te = tip.te + 0.6 * (i / steps);
      const cur = { x, y, le: te - chord, te };
      plate(ctx, 'Curved sharklet', [
        [s * prev.x, prev.y, prev.le], [s * prev.x, prev.y, prev.te], [s * cur.x, cur.y, cur.te], [s * cur.x, cur.y, cur.le],
      ], 0.12, m.accent, wing);
      prev = cur;
    }
  }
}

/** A turboprop nacelle's fairing up into the high wing, so the nacelle hangs from it rather than floating. */
function nacelleFairing(ctx, e, mat) {
  const w = ctx.config.wing;
  const g = ctx.parts[e.id];
  if (!g) return;
  const wa = wingAt(w, e.x);
  const r = e.radius;
  plate(ctx, 'Nacelle fairing', [
    [e.x, e.y + r * 0.8, wa.le + 0.1], [e.x, e.y + r * 0.7, wa.te + 0.2],
    [e.x, wa.under + 0.08, wa.te - 0.1], [e.x, wa.under + 0.08, wa.le + 0.05],
  ], r * 1.25, mat, g);
}

/**
 * A fairing on top of the fuselage where a high wing sits on it, painted
 * the roof's colour: the skin material's own texture, sampled from the top
 * row (v near 1) along the body, as bellyFairing samples the bottom one.
 */
function dorsalFairing(ctx, stations, along, mat) {
  const h = hull({ stations: stations.map(ell), radial: 8, maxStep: 1.5, closeTail: true });
  const p = h.geometry.attributes.position;
  const uv = h.geometry.attributes.uv;
  for (let i = 0; i < p.count; i++) uv.setXY(i, along(p.getZ(i)), 0.97);
  meshOf(ctx, 'Wing-root fairing', h.geometry, mat, ctx.parts.fuselage);
}

/** The 777's tail cone ends in a vertical blade round the APU exhaust. */
function bladeTail(ctx, last, mat, len = 1.6, height = 1.1) {
  plate(ctx, 'Tail cone blade', [
    [0, last.yc - height * 0.45, last.z - len], [0, last.yc - height * 0.2, last.z + 0.05],
    [0, last.yc + height * 0.3, last.z + 0.05], [0, last.yc + height * 0.55, last.z - len],
  ], 0.22, mat, ctx.parts.tail);
}

/** Take every mesh of that name out from under a part (a piece the kit added that this type has not got). */
function removeNamed(root, name) {
  if (!root) return;
  const hits = [];
  root.traverse((o) => {
    if (o.name === name) hits.push(o);
  });
  for (const o of hits) o.removeFromParent();
}

/* ------------------------------------------------------------------ *
 * Assembly
 * ------------------------------------------------------------------ */

/**
 * The model spec dress() reads (see A320 in ./airliners.js for every
 * field), with the fuselage, the glazing and the eye taken from the
 * geometry so the drawing and the flight model share them.
 */
function specOf(g, s) {
  const F = g.body;
  const tail = F.stations[F.stations.length - 1].z;
  return {
    fuselage: {
      stations: F.stations,
      radial: s.radial || 16,
      rings: ringsBetween(s.tailStart, tail, s.ringStep || 1.5),
      cuts: s.cuts,
      alongKnots: [[g.noseZ, 0], [s.cuts[0], s.alongNose || 0.17], [tail, 1]],
    },
    cabinZ: 0,
    bellyY: s.bellyY,
    laps: s.laps,
    radomeZ: F.radomeZ,
    cheat: s.cheat,
    reg: s.reg,
    title: s.title,
    frame: s.frame ?? 0.065 * Math.max(1, F.k),
    panes: F.panes,
    windows: s.windows,
    doors: both(s.doors),
    fairing: s.fairing,
    flapTracks: s.flapTracks,
    aerials: s.aerials,
    beaconZ: s.beaconZ,
  };
}

/* ---------------------------------------------------------------- *
 * Boeing 737 MAX 8
 * ---------------------------------------------------------------- */
const G737 = JET_GEOMETRY.b737;
const B737 = specOf(G737, {
  tailStart: 5.0,
  cuts: [-12.7, 9.0],
  bellyY: -1.15,
  laps: [1.38, -0.75],
  cheat: { y0: -0.12, y1: 0.12, z0: -15.4, z1: 15.0 },
  reg: { z: 15.6, y: 0.85, w: 1.9 },
  title: { z: -3.6, y: 1.1, w: 15 },
  windows: [{ y: 0.42, z0: -12.6, z1: 12.4, pitch: 0.508, w: 0.24, ht: 0.34 }],
  doors: [
    { id: '#1', z: -14.25, y: 0.3, w: 0.86, h: 1.83, kind: 'passenger', sill: -0.62 },
    { id: '#2', z: 13.9, y: 0.3, w: 0.76, h: 1.83, kind: 'passenger', sill: -0.62 },
    { id: 'O#1', z: -0.94, y: 0.36, w: 0.51, h: 0.97, kind: 'overwing', sill: -0.12 },
    { id: 'O#2', z: -0.43, y: 0.36, w: 0.51, h: 0.97, kind: 'overwing', sill: -0.12 },
  ],
  fairing: [
    [-5.9, 1.15, 0.28, -1.68], [-3.9, 1.72, 0.58, -1.53], [-0.8, 1.88, 0.68, -1.45],
    [2.1, 1.86, 0.64, -1.48], [4.3, 1.38, 0.36, -1.64], [5.3, 0.86, 0.19, -1.72],
  ],
  aerials: { crown: [-7.0, 3.0], belly: [-11.0, -9.0] },
  beaconZ: -2.0,
});

const b737 = {
  id: 'b737', name: 'Boeing 737 MAX 8', kind: 'airliner', massKg: 17500,
  paint: '#f4f6f9', accent: '#1f4fa8', registration: 'N737IF', bodySegments: 8,
  body: bodyOf(B737.fuselage.stations),
  wing: {
    rootX: 1.4, span: G737.tip.x - 1.4, rootZ: G737.wingZ, rootY: -1.5,
    rootChord: 5.0, tipChord: 1.25, sweep: 8.1, dihedral: G737.tip.y + 1.5,
    thickness: 0.6, tipThickness: 0.15, flaps: true, struts: false,
  },
  tail: {
    rootX: 0.9, span: 6.27, rootZ: 15.4, rootY: 0.75,
    rootChord: 3.6, tipChord: 1.15, sweep: 3.3, dihedral: 0.75, thickness: 0.3, tipThickness: 0.08,
  },
  fin: { rootZ: 11.5, rootY: 1.7, height: 7.0, rootChord: 6.8, tipChord: 2.0, sweep: 5.2, thickness: 0.5 },
  canopy: null,
  gear: {
    nose: [0, axleY(G737, G737.nose.r), G737.nose.z], main: [G737.main.x, axleY(G737, G737.main.r), G737.main.z],
    noseRadius: G737.nose.r, mainRadius: G737.main.r,
    noseAttach: [0, -1.62, G737.nose.z + 0.15], mainAttach: [G737.main.x, -1.5, G737.main.z - 0.1],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(G737),
  eye: G737.eye,
  decorate(ctx) {
    const { M, h } = dress(ctx, B737);
    trailingEdgeFill(ctx, 6.2, 1.7, 0.3);
    splitScimitar(ctx, ctx.materials, { out: 0.62, h: 2.25, back: 0.55, chord: 1.0 }, { out: 0.18, h: 0.85, back: -0.15 });
    dorsalFin(ctx, h, 7.6, 11.6, 0.55, ctx.materials.accent);
    for (const e of ctx.config.engines) chevrons(ctx, e, M.nacelle, 12);
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.48, r: G737.nose.r, width: 0.24, oleo: 0.11, mats: M });
    for (const id of ['leftGear', 'rightGear']) refitLeg(ctx, id, { kind: 'dual', track: 0.86, r: G737.main.r, width: 0.4, oleo: 0.14, mats: M });
  },
  description: 'A narrow-body twin: the pointed Boeing nose, high-mounted forward turbofans with chevron nozzles, split-tip winglets, a dorsal fin fillet, twin-wheel gear, doors that open.',
  inspiration: 'Drawn to the 737 MAX 8\'s published dimensions; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- *
 * Airbus A321neo
 * ---------------------------------------------------------------- */
const G321 = JET_GEOMETRY.a321;
const A321 = specOf(G321, {
  tailStart: 5.7,
  cuts: [-14.6, 11.5],
  alongNose: 0.15,
  bellyY: -1.2,
  laps: [1.45, -0.8],
  cheat: { y0: -0.1, y1: 0.15, z0: -16.9, z1: 18.5 },
  reg: { z: 17.3, y: 0.95, w: 2.0 },
  title: { z: -3.0, y: 1.15, w: 17 },
  windows: [{ y: 0.4, z0: -14.3, z1: 14.6, pitch: 0.533, w: 0.235, ht: 0.33, skip: [[-9.15, -8.05], [5.85, 6.95]] }],
  doors: [
    { id: '#1', z: -15.95, y: 0.31, w: 0.81, h: 1.85, kind: 'passenger', sill: -0.62 },
    { id: '#2', z: -8.6, y: 0.31, w: 0.81, h: 1.85, kind: 'passenger', sill: -0.62 },
    { id: '#3', z: 6.4, y: 0.31, w: 0.81, h: 1.85, kind: 'passenger', sill: -0.62 },
    { id: '#4', z: 15.24, y: 0.31, w: 0.81, h: 1.85, kind: 'passenger', sill: -0.62 },
  ],
  fairing: [
    [-5.3, 1.2, 0.3, -1.75], [-3.3, 1.8, 0.62, -1.6], [-0.2, 1.98, 0.72, -1.52],
    [2.7, 1.95, 0.68, -1.55], [4.9, 1.45, 0.38, -1.72], [5.9, 0.9, 0.2, -1.8],
  ],
  aerials: { crown: [-9.0, 4.0], belly: [-13.5, -11.5] },
  beaconZ: -1.7,
});

const a321 = {
  id: 'a321', name: 'Airbus A321neo', kind: 'airliner', massKg: 20500,
  paint: '#f6f7f9', accent: '#6a2c91', registration: 'N321IF', bodySegments: 8,
  body: bodyOf(A321.fuselage.stations),
  wing: {
    rootX: 1.35, span: G321.tip.x - 1.35, rootZ: G321.wingZ, rootY: -1.45,
    rootChord: 4.82, tipChord: 1.45, sweep: 8.0, dihedral: G321.tip.y + 1.45,
    thickness: 0.62, tipThickness: 0.16, flaps: true, struts: false,
  },
  tail: {
    rootX: 0.9, span: 5.32, rootZ: 17.35, rootY: 0.72,
    rootChord: 3.7, tipChord: 1.2, sweep: 3.1, dihedral: 0.55, thickness: 0.3, tipThickness: 0.08,
  },
  fin: { rootZ: 12.25, rootY: 1.75, height: 6.05, rootChord: 6.0, tipChord: 1.9, sweep: 4.3, thickness: 0.5 },
  canopy: null,
  gear: {
    nose: [0, axleY(G321, G321.nose.r), G321.nose.z], main: [G321.main.x, axleY(G321, G321.main.r), G321.main.z],
    noseRadius: G321.nose.r, mainRadius: G321.main.r,
    noseAttach: [0, -1.55, G321.nose.z + 0.15], mainAttach: [G321.main.x, -1.45, G321.main.z - 0.1],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(G321),
  eye: G321.eye,
  decorate(ctx) {
    const { M } = dress(ctx, A321);
    trailingEdgeFill(ctx, 6.3, 1.65, 0.3);
    sharklets(ctx, ctx.materials);
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.52, r: G321.nose.r, width: 0.26, oleo: 0.11, mats: M });
    for (const id of ['leftGear', 'rightGear']) refitLeg(ctx, id, { kind: 'dual', track: 0.95, r: G321.main.r, width: 0.42, oleo: 0.15, mats: M });
  },
  description: 'The stretched A320: the Airbus nose and six-pane windscreen on a longer tube with four pairs of doors, sharklets, larger new-engine-option fans, twin-wheel gear.',
  inspiration: 'Drawn to the A321neo\'s published dimensions; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- *
 * Boeing 787-9
 * ---------------------------------------------------------------- */
const G787 = JET_GEOMETRY.b787;
const B787 = specOf(G787, {
  tailStart: 9.0,
  ringStep: 2.0,
  radial: 18,
  cuts: [-20.0, 14.0],
  alongNose: 0.16,
  bellyY: -1.75,
  laps: [2.1, -1.2],
  cheat: { y0: -0.2, y1: 0.18, z0: -26.0, z1: 27.5 },
  reg: { z: 27.0, y: 1.6, w: 3.0 },
  title: { z: -12.0, y: 1.45, w: 18 },
  windows: [{ y: 0.5, z0: -19.5, z1: 23.3, pitch: 0.61, w: 0.3, ht: 0.5, skip: [[-9.95, -8.85], [8.05, 9.15]] }],
  doors: [
    { id: '#1', z: -21.6, y: 0.33, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.65 },
    { id: '#2', z: -9.4, y: 0.33, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.65 },
    { id: '#3', z: 8.6, y: 0.33, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.65 },
    { id: '#4', z: 24.4, y: 0.33, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.65 },
  ],
  fairing: [
    [-12.4, 2.2, 0.5, -2.6], [-9.0, 2.75, 0.85, -2.4], [-3.5, 2.95, 1.05, -2.3],
    [2.0, 2.95, 1.0, -2.33], [5.6, 2.6, 0.7, -2.45], [8.2, 1.8, 0.36, -2.6],
  ],
  aerials: { crown: [-14.0, 6.0, 16.0], belly: [-19.0, -16.5] },
  beaconZ: 3.0,
});

const b787 = {
  id: 'b787', name: 'Boeing 787-9 Dreamliner', kind: 'airliner', massKg: 22000,
  paint: '#f3f5f8', accent: '#0b3d7a', registration: 'N787IF', bodySegments: 8,
  body: bodyOf(B787.fuselage.stations),
  wing: {
    rootX: 2.6, span: G787.tip.x - 2.6, rootZ: G787.wingZ, rootY: -2.0,
    rootChord: 8.0, tipChord: 1.6, sweep: 19.2, dihedral: G787.tip.y + 2.0,
    thickness: 1.3, tipThickness: 0.22, flaps: true, struts: false,
  },
  tail: {
    rootX: 1.0, span: 8.9, rootZ: 24.2, rootY: 1.4,
    rootChord: 6.0, tipChord: 1.8, sweep: 6.0, dihedral: 1.0, thickness: 0.5, tipThickness: 0.12,
  },
  fin: { rootZ: 20.0, rootY: 2.6, height: 9.0, rootChord: 10.5, tipChord: 3.3, sweep: 8.4, thickness: 0.9 },
  canopy: null,
  gear: {
    nose: [0, axleY(G787, G787.nose.r), G787.nose.z], main: [G787.main.x, axleY(G787, G787.main.r), G787.main.z],
    noseRadius: G787.nose.r, mainRadius: G787.main.r,
    noseAttach: [0, -2.4, G787.nose.z + 0.2], mainAttach: [G787.main.x, -2.2, G787.main.z - 0.2],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(G787),
  eye: G787.eye,
  decorate(ctx) {
    const { M } = dress(ctx, B787);
    trailingEdgeFill(ctx, 9.8, 3.0, 0.5);
    for (const e of ctx.config.engines) chevrons(ctx, e, M.nacelle, 16);
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.74, r: G787.nose.r, width: 0.34, oleo: 0.15, mats: M });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.45, track: 1.3, r: G787.main.r, width: 0.5, oleo: 0.22, mats: M });
      if (b) bogies.push({ node: b, z: G787.main.z });
    }
    levelBogies(ctx, bogies, G787.main.z);
  },
  description: 'The 787-9: a smooth unbroken nose with four large windscreens, tall cabin windows, a long slender wing rising at the tips, chevron-edged turbofans, four-wheel bogies.',
  inspiration: 'Drawn to the 787-9\'s published dimensions; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- *
 * Airbus A350-900
 * ---------------------------------------------------------------- */
const G350 = JET_GEOMETRY.a350;
const A350 = specOf(G350, {
  tailStart: 10.2,
  ringStep: 2.0,
  radial: 18,
  cuts: [-23.0, 15.0],
  alongNose: 0.15,
  bellyY: -1.8,
  laps: [2.15, -1.25],
  cheat: { y0: -0.22, y1: 0.18, z0: -29.0, z1: 28.6 },
  reg: { z: 28.2, y: 1.6, w: 3.1 },
  title: { z: -12.5, y: 1.5, w: 19 },
  // The mask: the frame round the glazing is broad and black, the A350's face.
  frame: 0.2,
  windows: [{ y: 0.48, z0: -23.4, z1: 24.5, pitch: 0.56, w: 0.29, ht: 0.44, skip: [[-11.55, -10.45], [8.35, 9.45]] }],
  doors: [
    { id: '#1', z: -24.4, y: 0.33, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.66 },
    { id: '#2', z: -11.0, y: 0.33, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.66 },
    { id: '#3', z: 8.9, y: 0.33, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.66 },
    { id: '#4', z: 25.6, y: 0.33, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.66 },
  ],
  fairing: [
    [-13.6, 2.3, 0.52, -2.66], [-10.0, 2.85, 0.9, -2.45], [-4.0, 3.05, 1.1, -2.35],
    [2.0, 3.05, 1.05, -2.38], [6.0, 2.7, 0.75, -2.5], [8.8, 1.85, 0.38, -2.66],
  ],
  aerials: { crown: [-15.0, 6.0, 17.0], belly: [-21.0, -18.5] },
  beaconZ: 3.0,
});

const a350 = {
  id: 'a350', name: 'Airbus A350-900', kind: 'airliner', massKg: 23000,
  paint: '#f5f6f8', accent: '#a3142a', registration: 'N350IF', bodySegments: 8,
  body: bodyOf(A350.fuselage.stations),
  wing: {
    rootX: 2.7, span: G350.tip.x - 2.7, rootZ: G350.wingZ, rootY: -2.1,
    rootChord: 8.6, tipChord: 1.8, sweep: 20.0, dihedral: G350.tip.y + 2.1,
    thickness: 1.4, tipThickness: 0.24, flaps: true, struts: false,
  },
  tail: {
    rootX: 1.0, span: 8.4, rootZ: 24.8, rootY: 1.45,
    rootChord: 6.2, tipChord: 2.0, sweep: 6.4, dihedral: 1.0, thickness: 0.5, tipThickness: 0.12,
  },
  fin: { rootZ: 20.5, rootY: 2.7, height: 9.2, rootChord: 11.0, tipChord: 3.4, sweep: 9.0, thickness: 0.95 },
  canopy: null,
  gear: {
    nose: [0, axleY(G350, G350.nose.r), G350.nose.z], main: [G350.main.x, axleY(G350, G350.main.r), G350.main.z],
    noseRadius: G350.nose.r, mainRadius: G350.main.r,
    noseAttach: [0, -2.5, G350.nose.z + 0.2], mainAttach: [G350.main.x, -2.3, G350.main.z - 0.2],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(G350),
  eye: G350.eye,
  decorate(ctx) {
    const { M } = dress(ctx, A350);
    trailingEdgeFill(ctx, 10.5, 3.4, 0.55);
    curlTips(ctx, ctx.materials, { out: 1.3, h: 1.9 });
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.76, r: G350.nose.r, width: 0.35, oleo: 0.15, mats: M });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.5, track: 1.36, r: G350.main.r, width: 0.52, oleo: 0.22, mats: M });
      if (b) bogies.push({ node: b, z: G350.main.z });
    }
    levelBogies(ctx, bogies, G350.main.z);
  },
  description: 'The A350-900: a smooth nose with the broad black mask round its windscreen, curved sharklets that bend up out of the wing tip, two big turbofans, four-wheel bogies.',
  inspiration: 'Drawn to the A350-900\'s published dimensions; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- *
 * Boeing 777-300ER
 * ---------------------------------------------------------------- */
const G777 = JET_GEOMETRY.b777;
const B777 = specOf(G777, {
  tailStart: 10.0,
  ringStep: 2.0,
  radial: 18,
  cuts: [-25.0, 17.0],
  alongNose: 0.14,
  bellyY: -1.85,
  laps: [2.2, -1.3],
  cheat: { y0: -0.2, y1: 0.2, z0: -31.0, z1: 33.4 },
  reg: { z: 32.8, y: 1.6, w: 3.3 },
  title: { z: -14.0, y: 1.5, w: 20 },
  windows: [{ y: 0.48, z0: -24.8, z1: 28.3, pitch: 0.533, w: 0.27, ht: 0.42, skip: [[-13.35, -12.25], [4.05, 5.15], [17.05, 18.15]] }],
  doors: [
    { id: '#1', z: -26.0, y: 0.35, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.62 },
    { id: '#2', z: -12.8, y: 0.35, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.62 },
    { id: '#3', z: 4.6, y: 0.35, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.62 },
    { id: '#4', z: 17.6, y: 0.35, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.62 },
    { id: '#5', z: 29.4, y: 0.35, w: 1.07, h: 1.93, kind: 'passenger', sill: -0.62 },
  ],
  fairing: [
    [-14.3, 2.4, 0.55, -2.68], [-10.5, 2.95, 0.95, -2.45], [-4.2, 3.15, 1.15, -2.35],
    [2.3, 3.15, 1.1, -2.38], [6.6, 2.8, 0.78, -2.5], [9.5, 1.9, 0.4, -2.68],
  ],
  aerials: { crown: [-16.0, 7.0, 20.0], belly: [-23.5, -21.0] },
  beaconZ: 3.0,
});

const b777 = {
  id: 'b777', name: 'Boeing 777-300ER', kind: 'airliner', massKg: 25500,
  paint: '#f4f6f8', accent: '#0f5f4a', registration: 'N777IF', bodySegments: 8,
  body: bodyOf(B777.fuselage.stations),
  wing: {
    rootX: 2.9, span: G777.tip.x - 2.9, rootZ: G777.wingZ, rootY: -2.2,
    rootChord: 9.0, tipChord: 1.9, sweep: 21.5, dihedral: G777.tip.y + 2.2,
    thickness: 1.5, tipThickness: 0.25, flaps: true, struts: false,
  },
  tail: {
    rootX: 1.0, span: 9.75, rootZ: 28.8, rootY: 1.6,
    rootChord: 6.8, tipChord: 2.2, sweep: 7.0, dihedral: 1.1, thickness: 0.55, tipThickness: 0.13,
  },
  fin: { rootZ: 23.5, rootY: 2.8, height: 9.6, rootChord: 11.5, tipChord: 3.6, sweep: 9.0, thickness: 1.0 },
  canopy: null,
  gear: {
    nose: [0, axleY(G777, G777.nose.r), G777.nose.z], main: [G777.main.x, axleY(G777, G777.main.r), G777.main.z],
    noseRadius: G777.nose.r, mainRadius: G777.main.r,
    noseAttach: [0, -2.6, G777.nose.z + 0.2], mainAttach: [G777.main.x, -2.3, G777.main.z - 0.2],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(G777),
  eye: G777.eye,
  decorate(ctx) {
    const { M } = dress(ctx, B777);
    trailingEdgeFill(ctx, 10.0, 3.6, 0.6);
    const F = B777.fuselage.stations;
    bladeTail(ctx, F[F.length - 1], M.skin, 1.8, 1.0);
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.8, r: G777.nose.r, width: 0.37, oleo: 0.16, mats: M });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 3, pitch: 1.45, track: 1.4, r: G777.main.r, width: 0.53, oleo: 0.24, mats: M });
      if (b) bogies.push({ node: b, z: G777.main.z });
    }
    levelBogies(ctx, bogies, G777.main.z);
  },
  description: 'The 777-300ER: a long wide-body tube, the two largest turbofans in the game, raked wing tips, six-wheel main bogies and the blade-shaped tail cone.',
  inspiration: 'Drawn to the 777-300ER\'s published dimensions; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- *
 * Dash 8 Q400
 * ---------------------------------------------------------------- */
const GQ4 = JET_GEOMETRY.q400;
const Q400 = specOf(GQ4, {
  // A turboprop's flaps hang on plain hinges: no canoe fairings under the wing.
  flapTracks: false,
  tailStart: 3.0,
  ringStep: 1.0,
  radial: 14,
  cuts: [-10.94, 7.0],
  alongNose: 0.15,
  bellyY: -0.85,
  laps: [1.0, -0.55],
  cheat: { y0: -0.15, y1: 0.08, z0: -13.0, z1: 13.0 },
  reg: { z: 12.5, y: 0.6, w: 1.5 },
  title: { z: -2.5, y: 0.78, w: 11 },
  windows: [{ y: 0.28, z0: -10.9, z1: 8.3, pitch: 0.64, w: 0.25, ht: 0.34 }],
  doors: [
    { id: '#1', z: -12.15, y: 0.1, w: 0.8, h: 1.65, kind: 'passenger', sill: -0.72 },
    { id: '#2', z: 9.6, y: 0.1, w: 0.76, h: 1.6, kind: 'passenger', sill: -0.68 },
  ],
  // No wing-body fairing under a high wing: kept inside the skin (dress()
  // lofts one regardless); the dorsal one is drawn in decorate().
  fairing: [
    [-1.2, 0.3, 0.05, -0.6], [-0.6, 0.4, 0.06, -0.6], [0.0, 0.4, 0.06, -0.6],
    [0.6, 0.4, 0.06, -0.6], [1.0, 0.3, 0.05, -0.6], [1.3, 0.2, 0.04, -0.6],
  ],
  aerials: { crown: [-7.0, 4.5], belly: [-9.0, -7.0] },
  beaconZ: 5.5,
});

const q400 = {
  id: 'q400', name: 'Dash 8 Q400', kind: 'airliner', massKg: 13000,
  paint: '#f5f6f8', accent: '#d4351c', registration: 'N400IF', bodySegments: 8,
  body: bodyOf(Q400.fuselage.stations),
  wing: {
    rootX: 1.0, span: GQ4.tip.x - 1.0, rootZ: GQ4.wingZ, rootY: 1.55,
    rootChord: 3.0, tipChord: 1.35, sweep: 0.75, dihedral: GQ4.tip.y - 1.55,
    thickness: 0.45, tipThickness: 0.16, flaps: true, struts: false,
  },
  // A T-tail: the tailplane on top of the fin.
  tail: {
    rootX: 0.15, span: 4.0, rootZ: 13.6, rootY: 5.62,
    rootChord: 2.3, tipChord: 1.2, sweep: 0.9, dihedral: 0.0, thickness: 0.24, tipThickness: 0.08,
  },
  fin: { rootZ: 9.6, rootY: 1.1, height: 4.6, rootChord: 4.4, tipChord: 2.6, sweep: 3.6, thickness: 0.42 },
  canopy: null,
  gear: {
    nose: [0, axleY(GQ4, GQ4.nose.r), GQ4.nose.z], main: [GQ4.main.x, axleY(GQ4, GQ4.main.r), GQ4.main.z],
    noseRadius: GQ4.nose.r, mainRadius: GQ4.main.r,
    // The mains come down out of the nacelles.
    noseAttach: [0, -1.05, GQ4.nose.z + 0.15], mainAttach: [GQ4.main.x, 0.25, GQ4.main.z - 0.1],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(GQ4, { kind: 'prop', prop: true }),
  eye: GQ4.eye,
  decorate(ctx) {
    const { M, h } = dressWithout(ctx, Q400, { engines: true });
    const along = piecewise(Q400.fuselage.alongKnots);
    // The high wing sits on a long dorsal fairing.
    dorsalFairing(ctx, [
      [-2.9, 0.15, 0.06, 1.38], [-2.2, 0.62, 0.2, 1.36], [-1.0, 0.82, 0.26, 1.35],
      [0.4, 0.82, 0.26, 1.35], [1.4, 0.6, 0.18, 1.36], [2.2, 0.18, 0.06, 1.38],
    ], along, M.skin);
    dorsalFin(ctx, h, 6.2, 9.7, 0.42, ctx.materials.accent);
    for (const e of ctx.config.engines) nacelleFairing(ctx, e, M.nacelle);
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.44, r: GQ4.nose.r, width: 0.22, oleo: 0.1, mats: M });
    for (const id of ['leftGear', 'rightGear']) {
      refitLeg(ctx, id, { kind: 'dual', track: 0.62, r: GQ4.main.r, width: 0.3, oleo: 0.13, mats: M });
      // The legs come straight down out of the nacelles, whose own doors close behind them:
      // no slab of a leg door hanging beside a 2.7 m strut.
      removeNamed(ctx.parts[id], 'Gear leg door');
    }
  },
  description: 'The Q400: a regional turboprop with a high wing on a dorsal fairing, nacelles slung under it carrying the main wheels, six-bladed propellers, a T-tail, doors that open.',
  inspiration: 'Drawn to the Dash 8 Q400\'s published dimensions; house livery is the game\'s own.',
};

/* ---------------------------------------------------------------- *
 * Concorde
 * ---------------------------------------------------------------- */

/**
 * A box nacelle for one engine of a Concorde pair: the rectangular intake
 * raked back at the bottom lip, the box under the wing, a round nozzle out
 * of the back. Replaces the pack's round pod in that engine's own group, so
 * the engine still breaks away on its own.
 */
function boxNacelle(ctx, e, M, { width, top, bottom, rake }) {
  const g = ctx.parts[e.id];
  if (!g) return;
  for (const c of [...g.children]) {
    if (['Lofted aircraft skin', 'Polished intake lip', 'Recessed front fan', 'Exhaust throat', 'Engine support pylon', 'Core cowl', 'Exhaust plug', 'Spinning jet fan', 'Fan spinner'].includes(c.name)) c.removeFromParent();
  }
  const z0 = e.z - e.length / 2;
  const z1 = e.z + e.length / 2;
  const h = top - bottom;
  const geo = new THREE.BoxGeometry(width, h, e.length, 1, 1, 2);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    let z = p.getZ(i) + e.z;
    const y = p.getY(i) + (top + bottom) / 2;
    // The intake's lower lip sits forward of its top: the raked front.
    if (p.getZ(i) < -e.length / 2 + 1e-6 && y < (top + bottom) / 2) z -= rake;
    p.setXYZ(i, p.getX(i) + e.x, y, z);
  }
  geo.computeVertexNormals();
  meshOf(ctx, 'Engine box', geo, M.nacelle, g);
  // The intake mouth, dark, just inside the front.
  plate(ctx, 'Intake mouth', [
    [e.x - width * 0.42, top - 0.12, z0 + 0.06], [e.x + width * 0.42, top - 0.12, z0 + 0.06],
    [e.x + width * 0.42, bottom + 0.14, z0 - rake * 0.92], [e.x - width * 0.42, bottom + 0.14, z0 - rake * 0.92],
  ], 0.04, M.duct, g);
  // The nozzle and its reverser buckets.
  ctx.tube('Nozzle', [e.x, (top + bottom) / 2 - 0.05, z1 - 0.2], [e.x, (top + bottom) / 2 - 0.05, z1 + 0.7], h * 0.36, M.core, g, 14);
  ctx.tube('Nozzle throat', [e.x, (top + bottom) / 2 - 0.05, z1 + 0.55], [e.x, (top + bottom) / 2 - 0.05, z1 + 0.72], h * 0.3, M.duct, g, 12);
}

/** A cap over the hull's open front at the droop hinge (seen as the gap when the nose is down). */
function hingeCap(ctx, h, z, mat, parent) {
  const pos = [];
  const P = new THREE.Vector3();
  const c = h.section(z);
  const n = 24;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI + (i / n) * Math.PI * 2;
    const b = -Math.PI + ((i + 1) / n) * Math.PI * 2;
    h.point(z, a, P);
    const pa = [P.x, P.y, z + 0.01];
    h.point(z, b, P);
    pos.push(0, c.yc, z + 0.01, ...pa, P.x, P.y, z + 0.01);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((pos.length / 3) * 2), 2));
  geo.computeVertexNormals();
  return meshOf(ctx, 'Hinge bulkhead', geo, mat, parent);
}

const GCC = JET_GEOMETRY.concorde;
const CONCORDE = specOf(GCC, {
  // A delta has no flaps, so no flap-track fairings.
  flapTracks: false,
  tailStart: 12.0,
  ringStep: 1.5,
  radial: 16,
  cuts: [-20.0, 14.0],
  alongNose: 0.2,
  bellyY: -1.0,
  laps: [1.15, -0.6],
  cheat: { y0: 0.0, y1: 0.12, z0: -21.0, z1: 24.0 },
  reg: { z: 21.5, y: 0.65, w: 1.8 },
  windows: [{ y: 0.32, z0: -19.4, z1: 10.6, pitch: 0.5, w: 0.16, ht: 0.24, skip: [[3.9, 5.1]] }],
  doors: [
    { id: '#1', z: -20.6, y: 0.1, w: 0.76, h: 1.68, kind: 'passenger', sill: -0.75 },
    { id: '#2', z: 4.5, y: 0.1, w: 0.76, h: 1.68, kind: 'passenger', sill: -0.75 },
  ],
  // The delta blends into the body: no belly fairing to draw (kept inside the skin).
  fairing: [
    [-6.0, 0.3, 0.05, -0.8], [-4.0, 0.4, 0.06, -0.8], [-1.0, 0.4, 0.06, -0.8],
    [2.0, 0.4, 0.06, -0.8], [4.0, 0.3, 0.05, -0.8], [5.0, 0.2, 0.04, -0.8],
  ],
  aerials: { crown: [-10.0, 6.0], belly: [-15.0, -12.0] },
  beaconZ: -2.0,
});

const concorde = {
  id: 'concorde', name: 'Concorde', kind: 'airliner', massKg: 20000,
  paint: '#f6f7f9', accent: '#1b2f5b', registration: 'G-ISLE', bodySegments: 8,
  body: bodyOf(CONCORDE.fuselage.stations),
  // A delta: one huge trapezoid each side, its leading edge swept 64 degrees,
  // the ogive's forward sweep along the body added in decorate().
  wing: {
    rootX: 1.3, span: GCC.tip.x - 1.3, rootZ: GCC.wingZ, rootY: -1.2,
    rootChord: 26.0, tipChord: 2.4, sweep: 24.0, dihedral: GCC.tip.y + 1.2,
    thickness: 0.75, tipThickness: 0.1, flaps: false, struts: false,
  },
  // No tailplane: the elevons on the wing do its work.
  tail: null,
  fin: { rootZ: 15.5, rootY: 1.3, height: 6.0, rootChord: 11.0, tipChord: 2.6, sweep: 8.0, thickness: 0.5 },
  canopy: null,
  gear: {
    nose: [0, axleY(GCC, GCC.nose.r), GCC.nose.z], main: [GCC.main.x, axleY(GCC, GCC.main.r), GCC.main.z],
    noseRadius: GCC.nose.r, mainRadius: GCC.main.r,
    noseAttach: [0, -1.4, GCC.nose.z + 0.15], mainAttach: [GCC.main.x, -1.45, GCC.main.z - 0.1],
    retractable: true, dualMain: false, doors: false,
  },
  engines: enginesOf(GCC),
  eye: GCC.eye,
  decorate(ctx) {
    const { M, h } = dressWithout(ctx, CONCORDE, { engines: true });
    const along = piecewise(CONCORDE.fuselage.alongKnots);
    // The droop nose: its own loft from the needle to the hinge, on a pivot
    // at the hinge's underside — 12.5 degrees down with the gear down (to see
    // the runway), straight up with it away.
    const hingeZ = CONCORDE.fuselage.stations[0].z;
    const hingeY = CONCORDE.fuselage.stations[0].bot;
    const cone = loftFuselage({ stations: GCC.cone, radial: 16, maxStep: 0.6, along }, { closeTail: false });
    cone.geometry.translate(0, -hingeY, -hingeZ);
    const pivot = new THREE.Group();
    pivot.name = 'Droop nose';
    pivot.position.set(0, hingeY, hingeZ);
    ctx.parts.nose.add(pivot);
    meshOf(ctx, 'Droop nose skin', cone.geometry, M.skin, pivot).userData.dynamic = true;
    hingeCap(ctx, h, hingeZ, M.duct, ctx.parts.nose);
    let droop = 0;
    ctx.registerAnimation((dt, state) => {
      const want = (state.gear ?? 1) > 0.5 ? -0.218 : 0;
      droop = dt > 0 ? mix(droop, want, 1 - Math.exp(-dt * 1.5)) : want;
      pivot.rotation.x = droop;
    });
    // The ogive: the leading edge sweeps forward along the body ahead of the
    // delta's straight edge.
    const w = ctx.config.wing;
    for (const s of [-1, 1]) {
      const parent = ctx.parts[s < 0 ? 'leftWing' : 'rightWing'];
      const a = wingAt(w, 4.2);
      plate(ctx, 'Ogee leading edge', [
        [s * 1.3, w.rootY, w.rootZ - 4.6], [s * 1.3, w.rootY, w.rootZ + 1.5],
        [s * 4.2, a.mid, a.le + 0.6], [s * 2.4, w.rootY - 0.02, w.rootZ - 1.6],
      ], 0.22, ctx.materials.wing, parent);
    }
    for (const e of ctx.config.engines) boxNacelle(ctx, e, M, { width: 1.42, top: -1.52, bottom: -2.82, rake: 0.9 });
    refitLeg(ctx, 'noseGear', { kind: 'dual', track: 0.5, r: GCC.nose.r, width: 0.3, oleo: 0.12, mats: M });
    const bogies = [];
    for (const id of ['leftGear', 'rightGear']) {
      const b = refitLeg(ctx, id, { kind: 'bogie', axles: 2, pitch: 1.67, track: 0.78, r: GCC.main.r, width: 0.4, oleo: 0.16, mats: M });
      if (b) bogies.push({ node: b, z: GCC.main.z });
    }
    levelBogies(ctx, bogies, GCC.main.z);
  },
  description: 'Concorde: a slim tube with a droop nose on a hinge, a slender delta wing with an ogee leading edge and no tailplane, four engines in two box nacelles with raked intakes, tall four-wheel main gear.',
  inspiration: 'Drawn to Concorde\'s published dimensions; house livery is the game\'s own.',
};

export const DEFINITIONS = [b737, a321, b787, a350, b777, q400, concorde];
export const DRAWS = DEFINITIONS.map((d) => d.id);

/** For tests and the hangar: each type's fuselage, deck and door specification, in metres. */
export const JET_SPECS = { b737: B737, a321: A321, b787: B787, a350: A350, b777: B777, q400: Q400, concorde: CONCORDE };
// For the giants (./giants.js), which are assembled the same way.
export { findByName, both, axleY, enginesOf, dressWithout, specOf, dorsalFairing, dorsalFin, chevrons, removeNamed };

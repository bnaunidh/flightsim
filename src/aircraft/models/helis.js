/**
 * The helicopter wave, drawn: Bell 407, Airbus H145, Robinson R44, AW139,
 * UH-60 Black Hawk, CH-47 Chinook and AH-64 Apache (../extra/helis.js has
 * the numbers; HELI_GEOMETRY there is the one set of dimensions both this
 * file and the physics read).
 *
 * One builder, seven designs. Each design is a table of hull stations in
 * metres from the origin (-Z forward, +Y up; the origin is where
 * ../extra/helis.js heliShape puts it, 2.6/6.55 of the length behind the
 * nose so the physics' hard points land on the drawing), plus a tail, an
 * undercarriage and the few parts that make the type what it is: the
 * fenestron and clamshell doors on the H145, the T-bar cabin and single
 * stabiliser of the R44, the sponsons and hoist of the AW139, the Black
 * Hawk's canted tail rotor and stabilator, the Chinook's two pylons, four
 * wheels and ramp, the Apache's stepped tandem cockpit, stub wings and the
 * gun under the nose.
 *
 * The rotors are the Builder's own (civil-build.js addRotor): blades that
 * droop at rest, cone with the collective and flap once a turn with the
 * airspeed, a head that leans with the cyclic, a coned blur disc at speed,
 * and a tail rotor (or a fan in a shroud, or none at all on the tandem).
 * The skids' and wheels' bottoms run through the flight model's contact
 * points; the tail guard's or tail wheel's lowest point is the tail-strike
 * point. Original drawings from published proportions; nothing here is a
 * licensed replica.
 */
import * as THREE from '../../vendor/three.module.js';
import { hull, wing, roundNose, tubePath, turned } from './civil-kit.js';
import { HELI_GEOMETRY } from '../extra/helis.js';

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

/** Engine deck / transmission fairing on the cabin roof, and the mast up to the hub. */
function deckAndMast(b, { z0, z1, w, roofY, topY, hubY, hubZ, mastR = 0.09, exhausts = 2, exhaustZ = null }) {
  const { m } = b;
  const yc = (roofY + topY) / 2;
  const deck = hull({
    stations: [
      ...roundNose(z0, (z1 - z0) * 0.3, { w, top: topY, bot: roofY, yc, nT: 2.4, nB: 2.4 }, { y: yc - 0.02 }, 3),
      { z: z0 + (z1 - z0) * 0.62, w: w * 1.02, top: topY + 0.03, bot: roofY, yc, nT: 2.6, nB: 2.4 },
      { z: z1 - (z1 - z0) * 0.12, w: w * 0.8, top: topY - 0.08, bot: roofY, yc: yc - 0.02, nT: 2.4, nB: 2.2 },
      { z: z1, w: w * 0.3, top: topY - 0.2, bot: roofY + 0.02, yc: yc - 0.05, nT: 2.2, nB: 2.2 },
    ],
    radial: 7,
    uvBand: 0.2,
    maxStep: 0.5,
  });
  b.put(deck.geometry, m.body);
  // Intake grilles and exhaust stacks.
  const ez = exhaustZ ?? z1 - (z1 - z0) * 0.25;
  for (let i = 0; i < exhausts; i++) {
    const side = exhausts === 1 ? 0 : i === 0 ? -1 : 1;
    b.put(new THREE.BoxGeometry(0.03, 0.14, 0.32), m.dark, { p: [side * (w * 0.98), yc + 0.05, z0 + (z1 - z0) * 0.4] });
    b.put(tubePath([[side * w * 0.45, topY - 0.14, ez], [side * w * 0.5, topY - 0.08, ez + 0.3], [side * w * 0.56, topY, ez + 0.5]], 0.08, 8), m.grey);
  }
  // Mast and swashplate, still while the head turns above them.
  b.put(turned([[mastR, 0], [mastR * 0.9, 0.2], [mastR * 0.8, hubY - topY + 0.06]], 10), m.metal, { p: [0, topY - 0.06, hubZ], r: [-Math.PI / 2, 0, 0] });
  b.put(new THREE.CylinderGeometry(mastR * 2.2, mastR * 2.2, 0.05, 12), m.grey, { p: [0, topY + 0.08, hubZ] });
}

/** A fin with a leading-edge sweep, from the boom at `zBase` up `height`. */
function fin(b, { zBase, baseY, height, rootChord, tipChord, sweep = 0.4, lean = 0, mat = null }) {
  const f = wing({
    frame: 'fin',
    origin: [0, baseY, 0],
    lean,
    stations: [
      { s: -0.05, chord: rootChord, le: zBase, y: 0 },
      { s: height, chord: tipChord, le: zBase + sweep * height, y: 0 },
    ],
    t: 0.12,
    m: 0,
    steps: 6,
    tipRound: 0.05,
    uvV: [0.66, 0.98],
  });
  b.put(f.fixed, mat || b.m.tail);
  return f;
}

/** A ventral fin under the boom. */
function ventral(b, { zBase, baseY, depth, chord }) {
  const v = wing({
    frame: 'fin',
    origin: [0, baseY, 0],
    lean: Math.PI,
    stations: [
      { s: -0.04, chord, le: zBase, y: 0 },
      { s: depth, chord: chord * 0.7, le: zBase + 0.15, y: 0 },
    ],
    t: 0.12,
    m: 0,
    steps: 5,
    tipRound: 0,
  });
  b.put(v.fixed, b.m.tail);
}

/** A horizontal stabiliser, both sides (or one), with optional endplates. */
function stabiliser(b, { z, y, halfSpan, chord, endplates = false, sides = ['right', 'left'], dihedral = 0 }) {
  const { m } = b;
  for (const side of sides) {
    const sx = side === 'right' ? 1 : -1;
    const st = wing({
      frame: side,
      stations: [
        { s: 0, chord, le: z, y },
        { s: halfSpan, chord: chord * 0.85, le: z + 0.05, y: y + dihedral },
      ],
      t: 0.12,
      m: 0.02,
      steps: 6,
      tipRound: 0,
    });
    b.put(st.fixed, m.body);
    if (endplates) {
      const ep = wing({
        frame: 'fin',
        origin: [sx * halfSpan, y - chord * 0.45, 0],
        stations: [
          { s: 0, chord, le: z + 0.02, y: 0 },
          { s: chord * 0.95, chord: chord * 0.75, le: z + 0.2, y: 0 },
        ],
        t: 0.1,
        m: 0,
        steps: 5,
        tipRound: 0,
      });
      b.put(ep.fixed, m.tail);
    }
  }
}

/**
 * Skids: two tubes whose bottoms pass through the contact points (S.nose.y
 * at the nose point's station, S.main.y at the mains'), toes turned up at
 * the front and heels behind the aft cross tube, and two arched cross tubes
 * through the belly. One leg (`lift`), so it rises as one under the weight.
 */
function skids(b, { x, zFront, zBack, bellyY, crossZ, rs = 0.045, steps = false }) {
  const { S, m } = b;
  const botAt = (z) => (z >= S.main.z ? S.main.y : S.nose.y + ((S.main.y - S.nose.y) * (z - S.nose.z)) / (S.main.z - S.nose.z));
  const leg = b.addLeg({ pivot: [0, 0, 0], name: 'skid gear', lift: true });
  for (const side of [-1, 1]) {
    const sx = side * x;
    const pts = [];
    pts.push([sx, botAt(zFront) + rs + 0.26, zFront - 0.3]);
    pts.push([sx, botAt(zFront) + rs + 0.1, zFront - 0.12]);
    for (const z of [zFront, (zFront + zBack) / 2, zBack]) pts.push([sx, botAt(z) + rs, z]);
    pts.push([sx, botAt(zBack) + rs + 0.035, zBack + 0.15]);
    pts.push([sx, botAt(zBack) + rs + 0.13, zBack + 0.28]);
    leg.add(tubePath(pts, rs, 8), m.metal);
    if (steps) leg.add(new THREE.BoxGeometry(0.28, 0.03, 0.5), m.dark, { p: [sx * 0.72, botAt(0) + 0.42, crossZ[0] + 0.6] });
  }
  for (const z of crossZ) {
    const y0 = botAt(z) + rs;
    const pts = [
      [-x, y0, z],
      [-x + 0.08, y0 + 0.28, z],
      [-x + 0.34, y0 + 0.62, z],
      [-0.4 * x, bellyY, z],
      [0.4 * x, bellyY, z],
      [x - 0.34, y0 + 0.62, z],
      [x - 0.08, y0 + 0.28, z],
      [x, y0, z],
    ];
    leg.add(tubePath(pts, rs * 0.9, 8), m.metal);
  }
}

/** A wheel on an oleo leg hung from `top`, axle at `axle`. */
function wheelLeg(b, { top, axle, R, width, steer = false, twin = 0, name = 'main gear', fairing = null }) {
  const { m } = b;
  const leg = b.addLeg({ pivot: top, name });
  leg.add(tubePath([top, [axle[0], axle[1] + R * 0.6, axle[2]]], R * 0.22, 8), m.metal);
  leg.add(tubePath([[axle[0], axle[1] + R * 0.62, axle[2]], [axle[0], axle[1] + R * 0.1, axle[2] + 0.02]], R * 0.16, 8), m.metal);
  if (fairing) leg.add(fairing, m.body);
  b.addWheel(leg, axle, R, width, { steer, twin });
  return leg;
}

/** Window lines shared by every cabin: angles from the top centreline. */
const CABIN_LINES = { ctr: 0.06, roofEdge: 0.62, ws: 1.25, belt: 1.72, chinTop: 1.95, chinBot: 2.55 };

/** A hoist arm over the right door with its hook, for the rescue machines. */
function hoist(b, { x, y, z }) {
  const { m } = b;
  b.put(tubePath([[x - 0.3, y - 0.1, z], [x + 0.25, y + 0.1, z], [x + 0.55, y + 0.08, z]], 0.05, 8), m.grey);
  b.put(new THREE.BoxGeometry(0.22, 0.26, 0.3), m.dark, { p: [x + 0.2, y + 0.05, z] });
  b.put(tubePath([[x + 0.55, y + 0.02, z], [x + 0.55, y - 0.5, z]], 0.012, 5), m.dark);
  b.put(new THREE.CylinderGeometry(0.05, 0.03, 0.2, 8), m.metal, { p: [x + 0.55, y - 0.6, z] });
}

/* ------------------------------------------------------------------ *
 * The designs
 * ------------------------------------------------------------------ */

function buildBell407(b) {
  const { S, m } = b;
  const Gm = HELI_GEOMETRY.bell407;
  const nz = -4.13;
  // Pod and boom, one hull: a JetRanger-family pod (glass front, flat-sided
  // cabin) into a slim round boom.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.0, { w: 0.66, top: 0.55, bot: -0.85, yc: -0.1, nT: 2.2, nB: 2.4 }, { y: -0.25 }, 6, 0.85),
      { z: -2.4, w: 0.72, top: 0.62, bot: -0.9, yc: -0.08, nT: 2.4, nB: 2.6 },
      { z: -0.8, w: 0.72, top: 0.64, bot: -0.9, yc: -0.06, nT: 2.4, nB: 2.6 },
      { z: 0.2, w: 0.62, top: 0.6, bot: -0.7, yc: 0.0, nT: 2.3, nB: 2.3 },
      { z: 1.0, w: 0.34, top: 0.5, bot: -0.25, yc: 0.2, nT: 2.1, nB: 2.1 },
      { z: 1.7, w: 0.2, top: 0.44, bot: 0.06, yc: 0.26, nT: 2.0, nB: 2.0 },
      { z: 5.4, w: 0.12, top: 0.42, bot: 0.16, yc: 0.3, nT: 2.0, nB: 2.0 },
      { z: 6.1, w: 0.07, top: 0.4, bot: 0.22, yc: 0.31, nT: 2.0, nB: 2.0 },
    ],
    radial: 10,
    maxStep: 0.45,
    lines: CABIN_LINES,
    windows: [
      { z0: nz + 0.05, z1: -2.6, from: 'ctr', to: 'ws' },
      { z0: nz + 0.2, z1: -3.0, from: 'chinTop', to: 'chinBot' },
      { z0: -2.5, z1: -1.6, from: 'roofEdge', to: 'belt' },
      { z0: -1.5, z1: -0.5, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  deckAndMast(b, { z0: -1.9, z1: 1.3, w: 0.4, roofY: 0.55, topY: 1.05, hubY: Gm.hubY, hubZ: Gm.hubZ, exhausts: 1, exhaustZ: 0.7 });
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 4, chord: 0.27, droop: -0.035, cone: 0.05, tilt: 0.09, hz: Gm.hz, dir: 1,
    tail: { at: [-0.2, 0.95, 5.95], radius: Gm.tailR, blades: 2, chord: 0.14 },
  });
  fin(b, { zBase: 5.3, baseY: 0.4, height: 0.95, rootChord: 0.8, tipChord: 0.4, sweep: 0.42 });
  ventral(b, { zBase: 5.55, baseY: 0.25, depth: 0.3, chord: 0.5 });
  stabiliser(b, { z: 4.0, y: 0.36, halfSpan: 0.95, chord: 0.42, endplates: true });
  // Tail guard: lowest point is the tail-strike point.
  const tz = 3.95 * S.bodyLength;
  b.put(tubePath([[0, h.botAt(tz - 0.3) + 0.03, tz - 0.3], [0, -0.1, tz], [0, 0.02, tz + 0.3], [0, 0.15, tz + 0.42]], 0.03, 6), m.metal);
  skids(b, { x: S.main.x, zFront: -2.3, zBack: S.main.z, bellyY: -0.8, crossZ: [-1.5, 0.5] });
  // The cargo hook.
  b.put(tubePath([[0, -0.85, -0.3], [0, -1.0, -0.3], [0, -1.06, -0.24]], 0.025, 5), m.dark);
  b.lamp('navL', [-0.95, 0.4, 4.1]);
  b.lamp('navR', [0.95, 0.4, 4.1]);
  b.lamp('strobeL', [-0.95, 0.56, 4.15]);
  b.lamp('strobeR', [0.95, 0.56, 4.15]);
  b.lamp('tail', [0, 1.4, 6.0]);
  b.lamp('beacon', [0, 1.08, 1.0]);
  b.lamp('beacon2', [0, -0.92, 0.5]);
  b.lamp('landing', [0, -0.85, -3.2]);
  return { spot: [0, -0.85, -3.3], hull: h };
}

function buildH145(b) {
  const { S, m } = b;
  const Gm = HELI_GEOMETRY.h145;
  const nz = -4.52;
  // A wide, squarer cabin with a flat rear end for the clamshell doors, a
  // boom that rises to the fenestron fin.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.1, { w: 0.78, top: 0.6, bot: -0.95, yc: -0.15, nT: 2.3, nB: 2.5 }, { y: -0.3 }, 6, 0.85),
      { z: -2.6, w: 0.86, top: 0.68, bot: -1.0, yc: -0.12, nT: 2.6, nB: 2.8 },
      { z: -0.6, w: 0.86, top: 0.7, bot: -1.0, yc: -0.1, nT: 2.7, nB: 2.8 },
      { z: 1.4, w: 0.8, top: 0.66, bot: -0.9, yc: -0.08, nT: 2.6, nB: 2.6 },
      { z: 2.3, w: 0.5, top: 0.6, bot: -0.3, yc: 0.2, nT: 2.4, nB: 2.4 },
      { z: 3.0, w: 0.28, top: 0.56, bot: 0.1, yc: 0.33, nT: 2.1, nB: 2.1 },
      { z: 5.4, w: 0.16, top: 0.62, bot: 0.3, yc: 0.46, nT: 2.0, nB: 2.0 },
      { z: 5.9, w: 0.1, top: 0.7, bot: 0.4, yc: 0.55, nT: 2.0, nB: 2.0 },
    ],
    radial: 10,
    maxStep: 0.45,
    lines: CABIN_LINES,
    windows: [
      { z0: nz + 0.05, z1: -2.9, from: 'ctr', to: 'ws' },
      { z0: nz + 0.25, z1: -3.3, from: 'chinTop', to: 'chinBot' },
      { z0: -2.7, z1: -1.7, from: 'roofEdge', to: 'belt' },
      { z0: -1.6, z1: -0.1, from: 'roofEdge', to: 'belt' },
      { z0: 0.1, z1: 1.2, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  // Clamshell door seams at the back, and the rear step.
  b.put(new THREE.BoxGeometry(0.02, 1.3, 0.03), m.dark, { p: [0, -0.2, 2.05] });
  b.put(new THREE.BoxGeometry(1.4, 0.03, 0.02), m.dark, { p: [0, 0.45, 2.0] });
  deckAndMast(b, { z0: -2.2, z1: 1.9, w: 0.5, roofY: 0.62, topY: 1.18, hubY: Gm.hubY, hubZ: Gm.hubZ, exhausts: 2, exhaustZ: 1.0 });
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 4, chord: 0.3, droop: -0.03, cone: 0.05, tilt: 0.09, hz: Gm.hz, dir: -1,
    tail: { at: [0, 1.6, 6.3], radius: Gm.tailR, blades: Gm.tailBlades, chord: 0.09, fenestron: true, dir: -1 },
  });
  // The fenestron fin: tall, with the shroud in it, and a swept tip.
  fin(b, { zBase: 5.6, baseY: 0.5, height: 2.0, rootChord: 1.25, tipChord: 0.55, sweep: 0.3 });
  stabiliser(b, { z: 4.4, y: 0.5, halfSpan: 1.2, chord: 0.5, endplates: true });
  const tz = 3.95 * S.bodyLength;
  b.put(tubePath([[0, h.botAt(tz - 0.3) + 0.03, tz - 0.3], [0, -0.05, tz], [0, 0.1, tz + 0.3], [0, 0.25, tz + 0.4]], 0.03, 6), m.metal);
  skids(b, { x: S.main.x, zFront: -2.5, zBack: S.main.z, bellyY: -0.9, crossZ: [-1.6, 0.7], steps: true });
  b.lamp('navL', [-1.2, 0.55, 4.5]);
  b.lamp('navR', [1.2, 0.55, 4.5]);
  b.lamp('strobeL', [-1.2, 0.7, 4.55]);
  b.lamp('strobeR', [1.2, 0.7, 4.55]);
  b.lamp('tail', [0, 2.5, 6.5]);
  b.lamp('beacon', [0, 1.22, 0.6]);
  b.lamp('beacon2', [0, -1.02, 0.4]);
  b.lamp('landing', [0, -0.95, -3.6]);
  return { spot: [0, -0.95, -3.7], hull: h };
}

function buildR44(b) {
  const { S, m } = b;
  const Gm = HELI_GEOMETRY.r44;
  const nz = -3.61;
  // A bubble cabin, an engine cowl behind it, a very slim boom.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.0, { w: 0.58, top: 0.5, bot: -0.8, yc: -0.15, nT: 2.1, nB: 2.3 }, { y: -0.35 }, 6, 0.8),
      { z: -2.0, w: 0.64, top: 0.56, bot: -0.85, yc: -0.14, nT: 2.2, nB: 2.4 },
      { z: -0.9, w: 0.62, top: 0.55, bot: -0.85, yc: -0.12, nT: 2.2, nB: 2.4 },
      { z: 0.0, w: 0.5, top: 0.42, bot: -0.6, yc: -0.05, nT: 2.3, nB: 2.3 },
      { z: 0.8, w: 0.3, top: 0.3, bot: -0.15, yc: 0.08, nT: 2.2, nB: 2.2 },
      { z: 1.3, w: 0.13, top: 0.28, bot: 0.04, yc: 0.16, nT: 2.0, nB: 2.0 },
      { z: 4.8, w: 0.09, top: 0.3, bot: 0.12, yc: 0.21, nT: 2.0, nB: 2.0 },
      { z: 5.35, w: 0.05, top: 0.3, bot: 0.16, yc: 0.23, nT: 2.0, nB: 2.0 },
    ],
    radial: 10,
    maxStep: 0.4,
    lines: { ctr: 0.06, roofEdge: 0.5, ws: 1.3, belt: 1.85, chinTop: 2.0, chinBot: 2.6 },
    windows: [
      { z0: nz + 0.05, z1: -1.9, from: 'ctr', to: 'ws' },
      { z0: nz + 0.2, z1: -2.3, from: 'chinTop', to: 'chinBot' },
      { z0: -2.1, z1: -1.3, from: 'roofEdge', to: 'belt' },
      { z0: -1.2, z1: -0.3, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  // The piston engine's cowl under the mast, with its cooling scoop.
  deckAndMast(b, { z0: -0.9, z1: 1.0, w: 0.3, roofY: 0.45, topY: 0.82, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.07, exhausts: 1, exhaustZ: 0.5 });
  b.put(new THREE.BoxGeometry(0.5, 0.18, 0.35), m.grey, { p: [0, -0.72, 0.75] });
  b.put(tubePath([[0.2, -0.75, 0.9], [0.25, -0.78, 1.25]], 0.035, 6), m.dark);
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 2, chord: 0.26, droop: -0.045, cone: 0.06, tilt: 0.1, hz: Gm.hz, dir: 1, hubR: 0.14, rootCut: 0.4,
    tail: { at: [-0.16, 0.85, 5.2], radius: Gm.tailR, blades: 2, chord: 0.11 },
  });
  // Small swept fin above and below the boom, and the one stabiliser on the left.
  fin(b, { zBase: 4.6, baseY: 0.3, height: 0.8, rootChord: 0.7, tipChord: 0.32, sweep: 0.5 });
  ventral(b, { zBase: 4.8, baseY: 0.14, depth: 0.45, chord: 0.5 });
  stabiliser(b, { z: 4.65, y: 0.22, halfSpan: 0.85, chord: 0.34, sides: ['left'] });
  const tz = 3.95 * S.bodyLength;
  b.put(tubePath([[0, h.botAt(tz - 0.25) + 0.03, tz - 0.25], [0, -0.05, tz], [0, 0.05, tz + 0.2], [0, 0.14, tz + 0.3]], 0.025, 6), m.metal);
  skids(b, { x: S.main.x, zFront: -2.1, zBack: S.main.z, bellyY: -0.75, crossZ: [-1.4, 0.4], rs: 0.035 });
  b.lamp('navL', [-0.9, 0.25, 4.7]);
  b.lamp('navR', [0.4, 0.3, 4.7]);
  b.lamp('strobeL', [0, 1.1, 4.9]);
  b.lamp('strobeR', [0, 1.1, 4.95]);
  b.lamp('tail', [0, 1.12, 5.3]);
  b.lamp('beacon', [0, 0.86, 0.3]);
  b.lamp('beacon2', [0, -0.88, 0.1]);
  b.lamp('landing', [0, -0.8, -2.7]);
  return { spot: [0, -0.8, -2.8], hull: h };
}

function buildAW139(b) {
  const { S, m } = b;
  const Gm = HELI_GEOMETRY.aw139;
  const nz = -5.48;
  const h = hull({
    stations: [
      ...roundNose(nz, 1.4, { w: 0.95, top: 0.7, bot: -1.0, yc: -0.15, nT: 2.3, nB: 2.5 }, { y: -0.4 }, 6, 0.85),
      { z: -3.4, w: 1.1, top: 0.85, bot: -1.1, yc: -0.1, nT: 2.6, nB: 2.7 },
      { z: -1.0, w: 1.1, top: 0.88, bot: -1.1, yc: -0.08, nT: 2.7, nB: 2.7 },
      { z: 1.4, w: 1.0, top: 0.84, bot: -1.0, yc: -0.05, nT: 2.6, nB: 2.6 },
      { z: 2.6, w: 0.56, top: 0.72, bot: -0.35, yc: 0.2, nT: 2.3, nB: 2.3 },
      { z: 3.6, w: 0.32, top: 0.66, bot: 0.1, yc: 0.4, nT: 2.1, nB: 2.1 },
      { z: 7.0, w: 0.2, top: 0.75, bot: 0.35, yc: 0.55, nT: 2.0, nB: 2.0 },
      { z: 7.8, w: 0.12, top: 0.85, bot: 0.5, yc: 0.68, nT: 2.0, nB: 2.0 },
    ],
    radial: 10,
    maxStep: 0.5,
    lines: CABIN_LINES,
    windows: [
      { z0: nz + 0.05, z1: -3.7, from: 'ctr', to: 'ws' },
      { z0: nz + 0.3, z1: -4.1, from: 'chinTop', to: 'chinBot' },
      { z0: -3.5, z1: -2.4, from: 'roofEdge', to: 'belt' },
      { z0: -2.2, z1: -0.9, from: 'roofEdge', to: 'belt' },
      { z0: -0.7, z1: 0.6, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  deckAndMast(b, { z0: -2.6, z1: 2.4, w: 0.64, roofY: 0.82, topY: 1.42, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.11, exhausts: 2, exhaustZ: 1.3 });
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 5, chord: 0.36, droop: -0.03, cone: 0.05, tilt: 0.085, hz: Gm.hz, dir: 1, hubR: 0.3, rootCut: 0.55,
    tail: { at: [0.28, 2.5, 7.75], radius: Gm.tailR, blades: 4, chord: 0.16 },
  });
  fin(b, { zBase: 6.7, baseY: 0.7, height: 1.9, rootChord: 1.2, tipChord: 0.55, sweep: 0.45 });
  ventral(b, { zBase: 7.1, baseY: 0.45, depth: 0.5, chord: 0.7 });
  stabiliser(b, { z: 6.3, y: 0.62, halfSpan: 1.4, chord: 0.6, endplates: true });
  const tz = 3.95 * S.bodyLength;
  b.put(tubePath([[0, h.botAt(tz - 0.3) + 0.03, tz - 0.3], [0, -0.05, tz], [0, 0.12, tz + 0.3], [0, 0.3, tz + 0.4]], 0.03, 6), m.metal);
  // Sponsons over the main wheels, and the wheels: nose (twin) and mains.
  for (const side of [-1, 1]) {
    const x = side * S.main.x;
    const spon = hull({
      stations: [
        ...roundNose(S.main.z - 1.6, 0.6, { w: 0.42, top: -0.35, bot: -1.05, yc: -0.7, nT: 2.4, nB: 2.4 }, { y: -0.75 }, 3),
        { z: S.main.z + 0.4, w: 0.44, top: -0.3, bot: -1.08, yc: -0.7, nT: 2.6, nB: 2.4 },
        { z: S.main.z + 1.6, w: 0.08, top: -0.45, bot: -0.7, yc: -0.58, nT: 2.2, nB: 2.2 },
      ],
      radial: 8,
      uvBand: 0.2,
      maxStep: 0.4,
    });
    b.put(spon.geometry, m.body, { p: [x - side * 0.3, 0, 0] });
    wheelLeg(b, { top: [x, -1.0, S.main.z], axle: [x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.26 });
  }
  wheelLeg(b, { top: [0, -0.95, S.nose.z - 0.1], axle: [0, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.14, steer: true, twin: 0.3, name: 'nose gear' });
  hoist(b, { x: 1.1, y: 1.05, z: -1.9 });
  // A searchlight under the nose.
  b.put(new THREE.CylinderGeometry(0.17, 0.2, 0.22, 10), m.dark, { p: [0.5, -1.05, -3.6] });
  b.lamp('navL', [-1.4, 0.65, 6.4]);
  b.lamp('navR', [1.4, 0.65, 6.4]);
  b.lamp('strobeL', [-1.4, 0.8, 6.45]);
  b.lamp('strobeR', [1.4, 0.8, 6.45]);
  b.lamp('tail', [0, 2.6, 8.1]);
  b.lamp('beacon', [0, 1.46, 0.4]);
  b.lamp('beacon2', [0, -1.12, 0.2]);
  b.lamp('landing', [0.5, -1.18, -3.6]);
  return { spot: [0.5, -1.18, -3.7], hull: h };
}

function buildUH60(b) {
  const { S, m } = b;
  const Gm = HELI_GEOMETRY.uh60;
  const nz = -6.27;
  // A long, low cabin under a long engine deck; the boom rises to a canted
  // fin with the stabilator low on it.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.5, { w: 0.9, top: 0.45, bot: -1.05, yc: -0.3, nT: 2.3, nB: 2.5 }, { y: -0.55 }, 6, 0.85),
      { z: -4.0, w: 1.15, top: 0.55, bot: -1.1, yc: -0.25, nT: 2.6, nB: 2.7 },
      { z: -1.0, w: 1.18, top: 0.56, bot: -1.1, yc: -0.25, nT: 2.7, nB: 2.7 },
      { z: 1.6, w: 1.1, top: 0.52, bot: -1.0, yc: -0.22, nT: 2.6, nB: 2.6 },
      { z: 2.8, w: 0.6, top: 0.45, bot: -0.4, yc: 0.05, nT: 2.3, nB: 2.3 },
      { z: 3.8, w: 0.36, top: 0.5, bot: -0.05, yc: 0.25, nT: 2.1, nB: 2.1 },
      { z: 7.6, w: 0.22, top: 0.85, bot: 0.35, yc: 0.6, nT: 2.0, nB: 2.0 },
      { z: 8.6, w: 0.12, top: 1.0, bot: 0.55, yc: 0.78, nT: 2.0, nB: 2.0 },
    ],
    radial: 10,
    maxStep: 0.5,
    lines: { ctr: 0.06, roofEdge: 0.7, ws: 1.3, belt: 1.75, chinTop: 2.0, chinBot: 2.55 },
    windows: [
      { z0: nz + 0.05, z1: -4.4, from: 'ctr', to: 'ws' },
      { z0: nz + 0.3, z1: -4.8, from: 'chinTop', to: 'chinBot' },
      { z0: -4.3, z1: -3.3, from: 'roofEdge', to: 'belt' },
      { z0: -2.6, z1: -1.2, from: 'roofEdge', to: 'belt' },
      { z0: -0.9, z1: 0.5, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  deckAndMast(b, { z0: -3.6, z1: 2.6, w: 0.72, roofY: 0.5, topY: 1.25, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.13, exhausts: 2, exhaustZ: 1.6 });
  // The two engine pods either side of the deck, exhausts turned outboard.
  for (const side of [-1, 1]) {
    b.put(turned([[0.0, -0.9], [0.3, -0.7], [0.36, 0.4], [0.3, 0.9], [0.22, 1.0]], 10, { closeEnds: true }), m.body, { p: [side * 0.95, 0.95, 0.9] });
    b.put(tubePath([[side * 1.05, 0.95, 1.85], [side * 1.25, 0.98, 2.1]], 0.2, 8), m.dark);
  }
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 4, chord: 0.5, droop: -0.03, cone: 0.045, tilt: 0.08, hz: Gm.hz, dir: 1, hubR: 0.34, rootCut: 0.7,
    tail: { at: [-0.3, 2.3, 8.9], radius: Gm.tailR, blades: 4, chord: 0.22, cant: Gm.tailCant },
  });
  fin(b, { zBase: 7.4, baseY: 0.8, height: 2.3, rootChord: 1.6, tipChord: 0.7, sweep: 0.5, lean: -Gm.tailCant });
  // The stabilator: a wide low tailplane under the fin.
  stabiliser(b, { z: 8.2, y: 0.5, halfSpan: 2.2, chord: 0.9 });
  // Tail wheel on its leg under the fin; mains on sprung legs far forward.
  wheelLeg(b, { top: [0, 0.3, S.nose.z - 0.3], axle: [0, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.16, steer: true, name: 'tail gear' });
  for (const side of [-1, 1]) {
    const x = side * S.main.x;
    wheelLeg(b, { top: [side * 0.9, -0.9, S.main.z], axle: [x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.3 });
  }
  // Pitot, wire cutters, the refuelling probe stub and the hoist.
  b.put(tubePath([[0.6, 0.2, nz + 0.4], [0.6, 0.2, nz - 0.3]], 0.025, 6), m.dark);
  b.put(new THREE.BoxGeometry(0.04, 0.5, 0.3), m.dark, { p: [0, 0.75, -4.4], r: [0.6, 0, 0] });
  hoist(b, { x: 1.2, y: 0.7, z: -2.2 });
  b.lamp('navL', [-2.2, 0.55, 8.3]);
  b.lamp('navR', [2.2, 0.55, 8.3]);
  b.lamp('strobeL', [-1.2, 0.6, -2.0]);
  b.lamp('strobeR', [1.2, 0.6, -2.0]);
  b.lamp('tail', [0, 3.1, 8.9]);
  b.lamp('beacon', [0, 1.3, 2.4]);
  b.lamp('beacon2', [0, -1.12, 0.6]);
  b.lamp('landing', [0, -1.1, -4.4]);
  return { spot: [0, -1.1, -4.5], hull: h };
}

function buildCH47(b) {
  const { S, m } = b;
  const Gm = HELI_GEOMETRY.ch47;
  const nz = -6.31;
  // A box of a fuselage: flat floor, flat sides, a stepped cockpit at the
  // front and the aft pylon rising over the ramp at the back.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.6, { w: 1.05, top: 0.6, bot: -1.1, yc: -0.3, nT: 2.4, nB: 2.6 }, { y: -0.5 }, 6, 0.85),
      { z: -4.2, w: 1.4, top: 1.0, bot: -1.1, yc: -0.1, nT: 3.0, nB: 3.0 },
      { z: -1.0, w: 1.42, top: 1.02, bot: -1.1, yc: -0.08, nT: 3.2, nB: 3.2 },
      { z: 4.0, w: 1.42, top: 1.02, bot: -1.1, yc: -0.08, nT: 3.2, nB: 3.2 },
      { z: 6.4, w: 1.3, top: 0.95, bot: -0.6, yc: 0.15, nT: 3.0, nB: 2.6 },
      { z: 8.3, w: 1.0, top: 0.8, bot: 0.1, yc: 0.45, nT: 2.8, nB: 2.4 },
      { z: 9.4, w: 0.5, top: 0.6, bot: 0.25, yc: 0.42, nT: 2.4, nB: 2.4 },
    ],
    radial: 10,
    maxStep: 0.6,
    lines: { ctr: 0.06, roofEdge: 0.75, ws: 1.35, belt: 1.8, chinTop: 2.05, chinBot: 2.6 },
    windows: [
      { z0: nz + 0.05, z1: -4.5, from: 'ctr', to: 'ws' },
      { z0: nz + 0.3, z1: -4.9, from: 'chinTop', to: 'chinBot' },
      { z0: -4.3, z1: -3.3, from: 'roofEdge', to: 'belt' },
      { z0: -2.4, z1: -1.8, from: 'ws', to: 'belt' },
      { z0: -0.4, z1: 0.2, from: 'ws', to: 'belt' },
      { z0: 1.6, z1: 2.2, from: 'ws', to: 'belt' },
      { z0: 3.6, z1: 4.2, from: 'ws', to: 'belt' },
    ],
  });
  b.addHull(h);
  // Sponsons along the lower sides: fuel, and the wheels hang from them.
  for (const side of [-1, 1]) {
    const spon = hull({
      stations: [
        ...roundNose(-4.6, 0.8, { w: 0.5, top: -0.35, bot: -1.15, yc: -0.75, nT: 2.6, nB: 2.4 }, { y: -0.8 }, 3),
        { z: 5.6, w: 0.52, top: -0.3, bot: -1.15, yc: -0.72, nT: 2.8, nB: 2.4 },
        { z: 7.2, w: 0.1, top: -0.5, bot: -0.8, yc: -0.65, nT: 2.2, nB: 2.2 },
      ],
      radial: 8,
      uvBand: 0.2,
      maxStep: 0.6,
    });
    b.put(spon.geometry, m.body, { p: [side * 1.45, 0, 0] });
  }
  // The forward pylon, and the aft pylon with the two engines under it.
  const fwd = hull({
    stations: [
      ...roundNose(-4.6, 0.6, { w: 0.6, top: 1.75, bot: 1.0, yc: 1.35, nT: 2.4, nB: 2.4 }, { y: 1.2 }, 3),
      { z: -3.2, w: 0.62, top: 1.8, bot: 1.0, yc: 1.38, nT: 2.6, nB: 2.4 },
      { z: -2.0, w: 0.4, top: 1.5, bot: 1.0, yc: 1.25, nT: 2.4, nB: 2.2 },
      { z: -1.2, w: 0.15, top: 1.2, bot: 1.0, yc: 1.1, nT: 2.2, nB: 2.2 },
    ],
    radial: 7,
    uvBand: 0.2,
    maxStep: 0.5,
  });
  b.put(fwd.geometry, m.body);
  const aft = hull({
    stations: [
      ...roundNose(5.6, 0.8, { w: 0.5, top: 1.6, bot: 0.95, yc: 1.25, nT: 2.4, nB: 2.4 }, { y: 1.05 }, 3),
      { z: 7.4, w: 0.85, top: 3.1, bot: 0.8, yc: 1.9, nT: 2.8, nB: 2.4 },
      { z: 8.6, w: 0.85, top: 3.5, bot: 0.6, yc: 2.0, nT: 2.8, nB: 2.4 },
      { z: 9.5, w: 0.5, top: 3.4, bot: 0.5, yc: 1.95, nT: 2.4, nB: 2.4 },
      { z: 9.9, w: 0.15, top: 3.2, bot: 0.6, yc: 1.9, nT: 2.2, nB: 2.2 },
    ],
    radial: 8,
    uvBand: 0.2,
    maxStep: 0.5,
  });
  b.put(aft.geometry, m.body);
  for (const side of [-1, 1]) {
    b.put(turned([[0.0, -1.0], [0.42, -0.7], [0.5, 0.6], [0.44, 1.5], [0.3, 1.7]], 10, { closeEnds: true }), m.body, { p: [side * 1.35, 1.6, 8.3] });
    b.put(tubePath([[side * 1.35, 1.65, 9.9], [side * 1.4, 1.65, 10.2]], 0.3, 10), m.dark);
  }
  // Masts under each hub.
  b.put(turned([[0.16, 0], [0.14, Gm.hubY - 1.8 + 0.1]], 10), m.metal, { p: [0, 1.75, Gm.hubZ], r: [-Math.PI / 2, 0, 0] });
  b.put(turned([[0.16, 0], [0.14, Gm.aftHubY - 3.5 + 0.1]], 10), m.metal, { p: [0, 3.45, Gm.aftHubZ], r: [-Math.PI / 2, 0, 0] });
  // Two rotors, counter-rotating: forward anticlockwise, aft clockwise.
  b.addRotor({ hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 3, chord: 0.8, droop: -0.03, cone: 0.045, tilt: 0.07, hz: Gm.hz, dir: 1, hubR: 0.36, rootCut: 0.9 });
  b.addRotor({ hub: [0, Gm.aftHubY, Gm.aftHubZ], radius: Gm.R, blades: 3, chord: 0.8, droop: -0.03, cone: 0.045, tilt: 0.07, hz: Gm.hz, dir: -1, hubR: 0.36, rootCut: 0.9 });
  // The rear ramp, closed, and its seam.
  b.put(new THREE.BoxGeometry(2.3, 0.03, 0.02), m.dark, { p: [0, 0.05, 8.8] });
  b.put(new THREE.BoxGeometry(2.2, 1.0, 0.06), m.grey, { p: [0, -0.4, 9.2], r: [-0.5, 0, 0] });
  // Four wheels: the front pair under the cockpit, the rear pair castoring.
  for (const side of [-1, 1]) {
    wheelLeg(b, { top: [side * 1.6, -0.9, S.nose.z], axle: [side * 1.6, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.34, twin: 0.4, name: side < 0 ? 'front left gear' : 'front right gear' });
    wheelLeg(b, { top: [side * S.main.x, -0.9, S.main.z], axle: [side * S.main.x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.34, steer: false });
  }
  b.lamp('navL', [-1.9, -0.4, 1.0]);
  b.lamp('navR', [1.9, -0.4, 1.0]);
  b.lamp('strobeL', [-1.45, 1.05, -1.0]);
  b.lamp('strobeR', [1.45, 1.05, -1.0]);
  b.lamp('tail', [0, 3.6, 9.6]);
  b.lamp('beacon', [0, 1.85, -3.4]);
  b.lamp('beacon2', [0, -1.15, 1.0]);
  b.lamp('landing', [0, -1.15, -4.6]);
  return { spot: [0, -1.15, -4.7], hull: h };
}

function buildAH64(b) {
  const { S, m } = b;
  const Gm = HELI_GEOMETRY.ah64;
  const nz = -6.15;
  // A slim body with the two cockpits stepped one behind the other.
  const h = hull({
    stations: [
      ...roundNose(nz, 0.9, { w: 0.45, top: -0.15, bot: -0.95, yc: -0.55, nT: 2.3, nB: 2.4 }, { y: -0.6 }, 5, 0.85),
      { z: -4.9, w: 0.55, top: 0.3, bot: -1.0, yc: -0.35, nT: 2.4, nB: 2.5 },
      { z: -3.9, w: 0.6, top: 0.55, bot: -1.0, yc: -0.25, nT: 2.4, nB: 2.5 },
      { z: -3.2, w: 0.62, top: 0.95, bot: -1.0, yc: -0.05, nT: 2.4, nB: 2.5 },
      { z: -1.6, w: 0.64, top: 1.0, bot: -0.95, yc: 0.0, nT: 2.5, nB: 2.5 },
      { z: 0.6, w: 0.62, top: 0.85, bot: -0.75, yc: 0.05, nT: 2.5, nB: 2.4 },
      { z: 2.4, w: 0.4, top: 0.62, bot: -0.2, yc: 0.2, nT: 2.3, nB: 2.3 },
      { z: 3.6, w: 0.28, top: 0.56, bot: 0.05, yc: 0.3, nT: 2.1, nB: 2.1 },
      { z: 7.6, w: 0.2, top: 0.75, bot: 0.3, yc: 0.52, nT: 2.0, nB: 2.0 },
      { z: 8.6, w: 0.12, top: 0.9, bot: 0.45, yc: 0.68, nT: 2.0, nB: 2.0 },
    ],
    radial: 10,
    maxStep: 0.5,
    lines: { ctr: 0.06, roofEdge: 0.55, ws: 1.25, belt: 1.7, chinTop: 2.0, chinBot: 2.5 },
    windows: [
      // The gunner's canopy, forward and low; the pilot's, aft and high.
      { z0: -5.2, z1: -3.9, from: 'ctr', to: 'belt' },
      { z0: -3.7, z1: -2.3, from: 'ctr', to: 'belt' },
    ],
  });
  b.addHull(h);
  // Canopy frames between the flat panes.
  for (const z of [-5.2, -3.9, -3.0, -2.3]) b.put(new THREE.BoxGeometry(1.3, 0.04, 0.05), m.dark, { p: [0, z < -3.8 ? 0.45 : 0.98, z] });
  // The nose sensor turret and the gun under the chin.
  b.put(new THREE.SphereGeometry(0.42, 12, 8), m.dark, { p: [0, -0.55, nz + 0.35] });
  b.put(new THREE.BoxGeometry(0.5, 0.3, 0.3), m.grey, { p: [0, -1.05, -4.1] });
  b.put(tubePath([[0, -1.1, -4.2], [0, -1.1, -5.6]], 0.06, 8), m.dark);
  // Engine pods high on each side, exhausts to the rear; the deck between them.
  deckAndMast(b, { z0: -2.6, z1: 2.2, w: 0.5, roofY: 0.95, topY: 1.3, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.12, exhausts: 0 });
  for (const side of [-1, 1]) {
    b.put(turned([[0.0, -1.0], [0.34, -0.75], [0.4, 0.8], [0.34, 1.6], [0.25, 1.75]], 10, { closeEnds: true }), m.body, { p: [side * 1.0, 0.65, 0.9] });
    b.put(tubePath([[side * 1.0, 0.65, 2.65], [side * 1.05, 0.65, 3.1]], 0.24, 10), m.dark);
  }
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 4, chord: 0.53, droop: -0.03, cone: 0.045, tilt: 0.085, hz: Gm.hz, dir: 1, hubR: 0.3, rootCut: 0.65,
    tail: { at: [-0.32, 2.2, 8.9], radius: Gm.tailR, blades: 4, chord: 0.2 },
  });
  // Stub wings with two pylons each.
  for (const side of ['right', 'left']) {
    const sx = side === 'right' ? 1 : -1;
    const w = wing({
      frame: side,
      stations: [
        { s: 0.6, chord: 1.2, le: -0.9, y: -0.1 },
        { s: S.halfSpan, chord: 0.95, le: -0.75, y: -0.1 },
      ],
      t: 0.12,
      m: 0.02,
      steps: 6,
      tipRound: 0.05,
    });
    b.put(w.fixed, m.body);
    for (const px of [1.6, 2.35]) {
      b.put(new THREE.BoxGeometry(0.12, 0.3, 0.9), m.grey, { p: [sx * px, -0.35, -0.3] });
      b.put(turned([[0.0, -0.9], [0.16, -0.7], [0.16, 0.7], [0.0, 0.9]], 8, { closeEnds: true }), m.dark, { p: [sx * px, -0.6, -0.2] });
    }
  }
  fin(b, { zBase: 7.6, baseY: 0.75, height: 2.0, rootChord: 1.4, tipChord: 0.6, sweep: 0.45 });
  stabiliser(b, { z: 8.6, y: 0.45, halfSpan: 1.7, chord: 0.8 });
  // Tail wheel under the fin; mains far forward on trailing legs.
  wheelLeg(b, { top: [0, 0.4, S.nose.z - 0.4], axle: [0, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.15, steer: true, name: 'tail gear' });
  for (const side of [-1, 1]) {
    wheelLeg(b, { top: [side * 0.6, -0.6, S.main.z - 0.6], axle: [side * S.main.x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.28 });
  }
  b.lamp('navL', [-S.halfSpan, -0.05, -0.3]);
  b.lamp('navR', [S.halfSpan, -0.05, -0.3]);
  b.lamp('strobeL', [-1.0, 1.1, 0.0]);
  b.lamp('strobeR', [1.0, 1.1, 0.0]);
  b.lamp('tail', [0, 2.8, 8.9]);
  b.lamp('beacon', [0, 1.35, 1.8]);
  b.lamp('beacon2', [0, -1.0, 1.0]);
  b.lamp('landing', [0, -0.95, -4.5]);
  return { spot: [0, -0.95, -4.6], hull: h };
}

/** By type id, for model.js's CIVIL table. */
export const HELI_BUILDERS = {
  bell407: buildBell407,
  h145: buildH145,
  r44: buildR44,
  aw139: buildAW139,
  uh60: buildUH60,
  ch47: buildCH47,
  ah64: buildAH64,
};

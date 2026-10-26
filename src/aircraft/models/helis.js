/**
 * The helicopter wave, drawn: Bell 407, Airbus H145, Robinson R44, AW139,
 * UH-60 Black Hawk, CH-47 Chinook, AH-64 Apache and the presidential VH-3D
 * Sea King, Marine One (../extra/helis.js has the numbers; HELI_GEOMETRY
 * there is the one set of dimensions both this file and the physics read).
 *
 * One builder, eight designs. Each design is a table of hull stations in
 * metres from the origin (-Z forward, +Y up; the origin is where
 * ../extra/helis.js heliShape puts it, 2.6/6.55 of the length behind the
 * nose so the physics' hard points land on the drawing), plus a tail, an
 * undercarriage and the few parts that make the type what it is.
 *
 * REDRAWN against photographs (owner, 2026-10-25: "fix heli models"). What
 * was wrong, by type, and what changed:
 *   all     the masts stood bare for most of a metre between a low cowling
 *           and the hub (a toy's pole); the cowlings now come up to the
 *           height the real transmission fairings do, with a fairing round
 *           the mast. Rounder cabins (more sides per section), registrations
 *           painted on, and the service machines in flat (matte) olive with
 *           tinted glass instead of an airliner's gloss and sky-blue windows.
 *   R44     a long low cabin and a block floating under the boom; now the
 *           tall bubble cabin, the tall mast fairing, the stabiliser on the
 *           right where it clears the tail rotor.
 *   407/H145 taller cabins; the H145's fenestron is a thick duct set into
 *           the fin, not a hoop on its face.
 *   AW139   the sponsons were torpedo floats hung off the sides; now low
 *           fairings blended into the fuselage over the main wheels.
 *   UH-60   the tail boom rose two metres off the ground to a tail wheel on a
 *           1.5 m stilt; the boom now runs low and level the way a Black
 *           Hawk's does, the tail rotor is on the RIGHT of the pylon (it was
 *           on the left) at the real height, the box above the windscreen
 *           is a wire cutter again.
 *   AH-64   the same stilted tail; the boom is low, the tail rotor (on the
 *           left) is the scissor four-blade at the right height, the cheeks
 *           (the avionics bays either side of the cockpits) are there, and
 *           the nose sensor is a turret, not a black ball.
 *   CH-47   too low and too round: the fuselage is the tall flat-sided box,
 *           the dorsal tunnel joins the two pylons, the aft pylon is a tower
 *           with the engines on its flanks, the sponsons are flush boxes.
 *
 * The rotors are the Builder's own (civil-build.js addRotor). The skids' and
 * wheels' bottoms run through the flight model's contact points; the tail
 * guard's or tail wheel's lowest point is the tail-strike point. Original
 * drawings from published proportions; nothing here is a licensed replica.
 */
import * as THREE from '../../vendor/three.module.js';
import { hull, wing, roundNose, tubePath, turned } from './civil-kit.js';
import { fuselageLettering, skinDecal } from './civil-details.js';
import { airframeTexture, starRoundelTexture } from '../../render/textures.js';
import { HELI_GEOMETRY } from '../extra/helis.js';
import { qualityRank } from '../model-quality.js';

/**
 * Sides per half-section of the cabins: rounder on Medium and up, the old
 * count on Low so a Chromebook's helicopter costs what it did before the
 * redraw (about 1,500 triangles fewer on the big ones).
 */
const radial = () => (qualityRank() <= 0 ? 10 : 12);
/** Low: the small dressing (door seams, skid shoes, painted registrations) is left off. */
const low = () => qualityRank() <= 0;

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ *
 * Shared pieces
 * ------------------------------------------------------------------ */

/**
 * The engine and transmission cowling on the cabin roof, a fairing round the
 * foot of the mast, and the bare mast only for the last few centimetres up
 * to the hub — as every one of these machines has it.
 */
function deckAndMast(b, { z0, z1, w, roofY, topY, hubY, hubZ, mastR = 0.09, exhausts = 2, exhaustZ = null, uvBand = 0.2, mat = null, fairing = true, grilles = true, rearRoof = null, cowl = null }) {
  const { m } = b;
  const yc = (roofY + topY) / 2;
  // The back comes down to the boom where the roof falls away under it (`rearRoof`).
  const rr = rearRoof ?? roofY;
  // The front slopes down onto the roof (a cowling, not a capsule set on it).
  const deck = hull({
    stations: cowl || [
      ...roundNose(z0, (z1 - z0) * 0.34, { w, top: topY, bot: roofY, yc, nT: 2.6, nB: 2.6 }, { y: roofY + 0.04 }, 5, 0.8),
      { z: z0 + (z1 - z0) * 0.6, w: w * 1.02, top: topY + 0.02, bot: (roofY * 2 + rr) / 3, yc, nT: 2.8, nB: 2.6 },
      { z: z1 - (z1 - z0) * 0.14, w: w * 0.84, top: topY - 0.06, bot: rr, yc: yc - 0.02, nT: 2.6, nB: 2.4 },
      { z: z1, w: w * 0.35, top: topY - 0.22, bot: rr + 0.02, yc: (topY - 0.22 + rr) / 2, nT: 2.2, nB: 2.2 },
    ],
    radial: 8,
    uvBand,
    maxStep: 0.45,
  });
  b.put(deck.geometry, mat || m.body);
  // Intake grilles either side at the front, and the exhaust stacks.
  const ez = exhaustZ ?? z1 - (z1 - z0) * 0.25;
  if (grilles) for (const side of [-1, 1]) b.put(new THREE.BoxGeometry(0.03, (topY - roofY) * 0.26, 0.34), m.grey, { p: [side * w * 1.0, yc + 0.04, z0 + (z1 - z0) * 0.45] });
  for (let i = 0; i < exhausts; i++) {
    const side = exhausts === 1 ? 0.35 : i === 0 ? -1 : 1;
    b.put(tubePath([[side * w * 0.5, topY - 0.16, ez], [side * w * 0.56, topY - 0.08, ez + 0.28], [side * w * 0.66, topY - 0.02, ez + 0.46]], [0.09, 0.1, 0.11], 10), m.grey);
    b.put(new THREE.CylinderGeometry(0.075, 0.075, 0.02, 10), m.dark, { p: [side * w * 0.67, topY - 0.01, ez + 0.47], r: [Math.PI / 2 - 0.5, 0, 0] });
  }
  // The fairing up the mast: from the cowling to a hand's width under the swashplate.
  const bare = hubY - topY;
  const fTop = hubY - Math.min(0.32, bare * 0.5);
  if (fairing && fTop > topY + 0.08) {
    const h = fTop - topY + 0.06;
    b.put(turned([[w * 0.52, 0], [w * 0.42, h * 0.35], [mastR * 2.1, h * 0.85], [mastR * 1.8, h]], 12, { closeEnds: true, vBand: uvBand }), mat || m.body, { p: [0, topY - 0.06, hubZ], r: [-Math.PI / 2, 0, 0] });
  }
  // Mast and swashplate, still while the head turns above them.
  b.put(turned([[mastR, 0], [mastR * 0.9, 0.2], [mastR * 0.85, bare + 0.06]], 10), m.metal, { p: [0, topY - 0.06, hubZ], r: [-Math.PI / 2, 0, 0] });
  b.put(new THREE.CylinderGeometry(mastR * 2.4, mastR * 2.4, 0.06, 14), m.grey, { p: [0, hubY - 0.2, hubZ] });
}

/** A fin with a leading-edge sweep, from the boom at `zBase` up `height`. */
function fin(b, { zBase, baseY, height, rootChord, tipChord, sweep = 0.4, lean = 0, mat = null, t = 0.12 }) {
  const f = wing({
    frame: 'fin',
    origin: [0, baseY, 0],
    lean,
    stations: [
      { s: -0.05, chord: rootChord, le: zBase, y: 0 },
      { s: height, chord: tipChord, le: zBase + sweep * height, y: 0 },
    ],
    t,
    m: 0,
    steps: 7,
    tipRound: 0.05,
    uvV: [0.66, 0.98],
  });
  b.put(f.fixed, mat || b.m.tail);
  return f;
}

/** A ventral fin under the boom. */
function ventral(b, { zBase, baseY, depth, chord, sweep = 0.15, mat = null }) {
  const v = wing({
    frame: 'fin',
    origin: [0, baseY, 0],
    lean: Math.PI,
    stations: [
      { s: -0.04, chord, le: zBase, y: 0 },
      { s: depth, chord: chord * 0.7, le: zBase + sweep, y: 0 },
    ],
    t: 0.12,
    m: 0,
    steps: 5,
    tipRound: 0,
  });
  b.put(v.fixed, mat || b.m.tail);
}

/** A horizontal stabiliser, both sides (or one), with optional endplates. */
function stabiliser(b, { z, y, halfSpan, chord, endplates = false, sides = ['right', 'left'], dihedral = 0, root = 0, mat = null }) {
  const { m } = b;
  for (const side of sides) {
    const sx = side === 'right' ? 1 : -1;
    const st = wing({
      frame: side,
      stations: [
        { s: root, chord, le: z, y },
        { s: halfSpan, chord: chord * 0.85, le: z + 0.05, y: y + dihedral },
      ],
      t: 0.12,
      m: 0.02,
      steps: 6,
      tipRound: 0.03,
    });
    b.put(st.fixed, mat || m.body);
    if (endplates) {
      const ep = wing({
        frame: 'fin',
        origin: [sx * halfSpan, y + dihedral - chord * 0.45, 0],
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
 * up into the belly. One leg (`lift`), so it rises as one under the weight.
 */
function skids(b, { x, zFront, zBack, bellyY, crossZ, rs = 0.045, steps = false }) {
  const { S, m } = b;
  tintGlass(b);
  const botAt = (z) => (z >= S.main.z ? S.main.y : S.nose.y + ((S.main.y - S.nose.y) * (z - S.nose.z)) / (S.main.z - S.nose.z));
  const leg = b.addLeg({ pivot: [0, 0, 0], name: 'skid gear', lift: true });
  for (const side of [-1, 1]) {
    const sx = side * x;
    const pts = [];
    pts.push([sx, botAt(zFront) + rs + 0.3, zFront - 0.34]);
    pts.push([sx, botAt(zFront) + rs + 0.14, zFront - 0.2]);
    pts.push([sx, botAt(zFront) + rs + 0.03, zFront - 0.05]);
    for (const z of [zFront + 0.1, (zFront + zBack) / 2, zBack]) pts.push([sx, botAt(z) + rs, z]);
    pts.push([sx, botAt(zBack) + rs + 0.035, zBack + 0.18]);
    pts.push([sx, botAt(zBack) + rs + 0.12, zBack + 0.3]);
    leg.add(tubePath(pts, rs, 8), m.metal);
    // Wear shoes under the skid tubes.
    if (!low()) leg.add(new THREE.BoxGeometry(rs * 1.6, rs * 0.7, 0.6), m.dark, { p: [sx, botAt((zFront + zBack) / 2) + rs * 0.35, (zFront + zBack) / 2] });
    if (steps) leg.add(new THREE.BoxGeometry(0.3, 0.03, 0.55), m.dark, { p: [side * (x - 0.26), botAt(crossZ[0]) + 0.42, crossZ[0] + 0.55] });
  }
  for (const z of crossZ) {
    const y0 = botAt(z) + rs;
    const pts = [
      [-x, y0, z],
      [-x + 0.06, y0 + 0.22, z],
      [-x + 0.26, y0 + 0.52, z],
      [-x + 0.5, bellyY - 0.03, z],
      [-0.35 * x, bellyY + 0.02, z],
      [0.35 * x, bellyY + 0.02, z],
      [x - 0.5, bellyY - 0.03, z],
      [x - 0.26, y0 + 0.52, z],
      [x - 0.06, y0 + 0.22, z],
      [x, y0, z],
    ];
    leg.add(tubePath(pts, rs * 1.05, 8), m.metal);
  }
}

/** A wheel on an oleo leg hung from `top`, axle at `axle`. */
function wheelLeg(b, { top, axle, R, width, steer = false, twin = 0, name = 'main gear', fairing = null, strut = 0 }) {
  const { m } = b;
  const leg = b.addLeg({ pivot: top, name });
  leg.add(tubePath([top, [axle[0], axle[1] + R * 0.6, axle[2]]], strut || R * 0.22, 8), m.metal);
  leg.add(tubePath([[axle[0], axle[1] + R * 0.62, axle[2]], [axle[0], axle[1] + R * 0.1, axle[2] + 0.02]], R * 0.16, 8), m.metal);
  if (fairing) leg.add(fairing, m.body);
  b.addWheel(leg, axle, R, width, { steer, twin });
  return leg;
}

/** A blended pod low on each side (sponsons, cheeks): a short hull, boxy, `inset` into the body. */
function pods(b, { x, z0, z1, w, top, bot, nose = 0.6, tail = 0.9, n = 3.2, mat = null, uvBand = 0.2 }) {
  const yc = (top + bot) / 2;
  const geo = hull({
    stations: [
      ...roundNose(z0, nose, { w, top, bot, yc, nT: n, nB: n }, { y: yc }, 4),
      { z: z1 - tail, w, top, bot, yc, nT: n, nB: n },
      { z: z1, w: w * 0.35, top: top - (top - bot) * 0.25, bot: bot + (top - bot) * 0.2, yc: yc + (top - bot) * 0.03, nT: 2.4, nB: 2.4 },
    ],
    radial: 7,
    uvBand,
    maxStep: 0.6,
  }).geometry;
  // One geometry per side: Batch.place moves the geometry it is given in
  // place, so the same one put twice went out to the left and straight back
  // to the centreline, and both pods sat buried inside the hull.
  const pair = [geo, geo.clone()];
  [-1, 1].forEach((side, i) => b.put(pair[i], mat || b.m.body, { p: [side * x, 0, 0] }));
}

/**
 * Helicopter glass is tinted (sun on a bubble all day): dark, with the sky in
 * it. The airliners' rule — pale glass on a dark scheme so the windows do
 * not vanish — gave the red AW139 and the green Sea King sky-blue toy
 * windows; reflective dark glass reads against any paint once the sky is in
 * it. Called before the hull is added (addHull takes the material then).
 */
function tintGlass(b) {
  const g = b.m.glass;
  g.color.setHex(0x26323f);
  g.roughness = 0.06;
  g.metalness = 0.7;
  g.envMapIntensity = 1.2;
}

/** Window lines shared by most cabins: angles from the top centreline. */
const CABIN_LINES = { ctr: 0.06, roofEdge: 0.62, ws: 1.25, belt: 1.78, chinTop: 2.0, chinBot: 2.6 };

/** A hoist arm over the right door with its hook, for the rescue machines. */
function hoist(b, { x, y, z }) {
  const { m } = b;
  b.put(tubePath([[x - 0.3, y - 0.1, z], [x + 0.25, y + 0.1, z], [x + 0.55, y + 0.08, z]], 0.05, 8), m.grey);
  b.put(new THREE.BoxGeometry(0.22, 0.26, 0.3), m.dark, { p: [x + 0.2, y + 0.05, z] });
  b.put(tubePath([[x + 0.55, y + 0.02, z], [x + 0.55, y - 0.5, z]], 0.012, 5), m.dark);
  b.put(new THREE.CylinderGeometry(0.05, 0.03, 0.2, 8), m.metal, { p: [x + 0.55, y - 0.6, z] });
}

/** Door seams on both sides, following the skin: thin dark lines at each door edge. */
function doorSeam(b, h, { z0, z1, yTop, yBot, sides = [1, -1] }) {
  const { m } = b;
  if (low()) return;
  for (const side of sides) {
    for (const z of [z0, z1]) {
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        const y = yBot + ((yTop - yBot) * k) / 5;
        const p = h.point(z, h.angleAt(z, y));
        pts.push([side * (Math.abs(p.x) + 0.006), p.y, z]);
      }
      b.put(tubePath(pts, 0.012, 4), m.dark);
    }
  }
}

/** Registration on both sides of the boom root, where every one of them wears it. */
function registration(b, h, at) {
  if (!b.scheme || !b.scheme.reg || low()) return;
  fuselageLettering(b, h, { regAt: at });
}

/* ------------------------------------------------------------------ *
 * The designs
 * ------------------------------------------------------------------ */

function buildBell407(b) {
  const { S, m } = b;
  tintGlass(b);
  const Gm = HELI_GEOMETRY.bell407;
  const nz = -4.13;
  // Pod and boom, one hull: the JetRanger-family pod (a deep glass front, a
  // flat-sided cabin) into a slim round boom.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.15, { w: 0.7, top: 0.78, bot: -0.95, yc: -0.08, nT: 2.3, nB: 2.5 }, { y: -0.36 }, 7, 0.85),
      { z: -2.5, w: 0.76, top: 0.86, bot: -1.0, yc: -0.06, nT: 2.6, nB: 2.8 },
      { z: -0.7, w: 0.76, top: 0.87, bot: -1.0, yc: -0.05, nT: 2.6, nB: 2.8 },
      { z: 0.35, w: 0.68, top: 0.84, bot: -0.8, yc: 0.0, nT: 2.5, nB: 2.5 },
      { z: 1.2, w: 0.36, top: 0.66, bot: -0.12, yc: 0.28, nT: 2.2, nB: 2.2 },
      { z: 1.9, w: 0.2, top: 0.54, bot: 0.12, yc: 0.33, nT: 2.0, nB: 2.0 },
      { z: 5.5, w: 0.12, top: 0.46, bot: 0.2, yc: 0.33, nT: 2.0, nB: 2.0 },
      { z: 6.2, w: 0.07, top: 0.43, bot: 0.26, yc: 0.34, nT: 2.0, nB: 2.0 },
    ],
    radial: radial(),
    maxStep: 0.45,
    lines: CABIN_LINES,
    windows: [
      { z0: nz + 0.05, z1: -2.75, from: 'ctr', to: 'ws' },
      { z0: nz + 0.22, z1: -3.05, from: 'chinTop', to: 'chinBot' },
      { z0: -2.62, z1: -1.72, from: 'roofEdge', to: 'belt' },
      { z0: -1.6, z1: -0.45, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  deckAndMast(b, { z0: -2.0, z1: 1.55, w: 0.46, roofY: 0.78, topY: 1.4, hubY: Gm.hubY, hubZ: Gm.hubZ, exhausts: 1, exhaustZ: 0.95, rearRoof: 0.6 });
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 4, chord: 0.27, droop: -0.035, cone: 0.05, tilt: 0.09, hz: Gm.hz, dir: 1, hubR: 0.24, rootCut: 0.42,
    tail: { at: [-0.2, 0.62, 5.95], radius: Gm.tailR, blades: 2, chord: 0.15 },
  });
  fin(b, { zBase: 5.3, baseY: 0.4, height: 1.0, rootChord: 0.85, tipChord: 0.42, sweep: 0.5 });
  ventral(b, { zBase: 5.55, baseY: 0.24, depth: 0.32, chord: 0.5 });
  stabiliser(b, { z: 4.0, y: 0.36, halfSpan: 0.98, chord: 0.42, endplates: true });
  // Tail guard: lowest point is the tail-strike point.
  const tz = 3.95 * S.bodyLength;
  b.put(tubePath([[0, h.botAt(tz - 0.3) + 0.03, tz - 0.3], [0, -0.1, tz], [0, 0.02, tz + 0.3], [0, 0.15, tz + 0.42]], 0.03, 6), m.metal);
  skids(b, { x: S.main.x, zFront: -2.35, zBack: S.main.z, bellyY: -0.96, crossZ: [-1.55, 0.45] });
  doorSeam(b, h, { z0: -2.68, z1: -0.38, yTop: 0.62, yBot: -0.85 });
  // The cargo hook.
  b.put(tubePath([[0, -0.95, -0.3], [0, -1.08, -0.3], [0, -1.12, -0.24]], 0.025, 5), m.dark);
  registration(b, h, { z: 2.6, y: 0.33, w: 0.9 });
  b.lamp('navL', [-0.98, 0.4, 4.1]);
  b.lamp('navR', [0.98, 0.4, 4.1]);
  b.lamp('strobeL', [-0.98, 0.56, 4.15]);
  b.lamp('strobeR', [0.98, 0.56, 4.15]);
  b.lamp('tail', [0, 1.44, 6.1]);
  b.lamp('beacon', [0, 1.4, 1.3]);
  b.lamp('beacon2', [0, -1.02, 0.5]);
  b.lamp('landing', [0, -0.95, -3.2]);
  return { spot: [0, -0.95, -3.3], hull: h };
}

function buildH145(b) {
  const { S, m } = b;
  tintGlass(b);
  const Gm = HELI_GEOMETRY.h145;
  const nz = -4.52;
  // A tall, squarer cabin with a flat rear end for the clamshell doors and
  // the boom taken off its roof, rising a little to the fenestron fin.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.25, { w: 0.82, top: 0.82, bot: -1.04, yc: -0.1, nT: 2.5, nB: 2.7 }, { y: -0.4 }, 7, 0.85),
      { z: -2.6, w: 0.9, top: 0.92, bot: -1.1, yc: -0.08, nT: 2.9, nB: 3.0 },
      { z: -0.4, w: 0.9, top: 0.94, bot: -1.1, yc: -0.07, nT: 3.0, nB: 3.0 },
      { z: 1.55, w: 0.86, top: 0.9, bot: -1.0, yc: -0.05, nT: 2.9, nB: 2.9 },
      { z: 2.05, w: 0.5, top: 0.86, bot: 0.05, yc: 0.45, nT: 2.4, nB: 2.4 },
      { z: 2.8, w: 0.3, top: 0.8, bot: 0.3, yc: 0.56, nT: 2.1, nB: 2.1 },
      { z: 5.6, w: 0.2, top: 0.8, bot: 0.42, yc: 0.62, nT: 2.0, nB: 2.0 },
      { z: 6.15, w: 0.14, top: 0.82, bot: 0.5, yc: 0.66, nT: 2.0, nB: 2.0 },
    ],
    radial: radial(),
    maxStep: 0.45,
    lines: CABIN_LINES,
    windows: [
      { z0: nz + 0.05, z1: -3.0, from: 'ctr', to: 'ws' },
      { z0: nz + 0.25, z1: -3.35, from: 'chinTop', to: 'chinBot' },
      { z0: -2.8, z1: -1.8, from: 'roofEdge', to: 'belt' },
      { z0: -1.6, z1: -0.15, from: 'roofEdge', to: 'belt' },
      { z0: 0.1, z1: 1.25, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  // Clamshell door seams at the back.
  b.put(new THREE.BoxGeometry(0.02, 1.2, 0.03), m.dark, { p: [0, -0.4, 1.85] });
  b.put(new THREE.BoxGeometry(1.5, 0.03, 0.02), m.dark, { p: [0, 0.25, 1.75] });
  doorSeam(b, h, { z0: -2.88, z1: -0.08, yTop: 0.7, yBot: -0.95 });
  deckAndMast(b, { z0: -2.3, z1: 2.15, w: 0.56, roofY: 0.86, topY: 1.48, hubY: Gm.hubY, hubZ: Gm.hubZ, exhausts: 2, exhaustZ: 1.2 });
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 4, chord: 0.3, droop: -0.03, cone: 0.05, tilt: 0.09, hz: Gm.hz, dir: -1, hubR: 0.26, rootCut: 0.45,
    tail: { at: [0, 1.2, 6.45], radius: Gm.tailR, blades: Gm.tailBlades, chord: 0.09, fenestron: true, dir: -1 },
  });
  // The fenestron fin: thick at the duct, swept above it.
  // The fin sits on top of the duct (it must not run through the fan); a
  // short skeg under the duct carries the tail guard.
  fin(b, { zBase: 6.02, baseY: 1.72, height: 0.95, rootChord: 1.05, tipChord: 0.58, sweep: 0.4, t: 0.16 });
  ventral(b, { zBase: 6.0, baseY: 0.62, depth: 0.22, chord: 0.8, sweep: 0.2 });
  stabiliser(b, { z: 5.0, y: 0.72, halfSpan: 1.15, chord: 0.5, endplates: true });
  const tz = 3.95 * S.bodyLength;
  b.put(tubePath([[0, h.botAt(tz - 0.3) + 0.03, tz - 0.3], [0, 0.1, tz], [0, 0.22, tz + 0.25], [0, 0.4, tz + 0.35]], 0.03, 6), m.metal);
  skids(b, { x: S.main.x, zFront: -2.55, zBack: S.main.z, bellyY: -1.06, crossZ: [-1.65, 0.62], steps: true });
  registration(b, h, { z: 3.6, y: 0.62, w: 1.0 });
  b.lamp('navL', [-1.15, 0.72, 5.05]);
  b.lamp('navR', [1.15, 0.72, 5.05]);
  b.lamp('strobeL', [-1.15, 0.9, 5.1]);
  b.lamp('strobeR', [1.15, 0.9, 5.1]);
  b.lamp('tail', [0, 2.7, 6.95]);
  b.lamp('beacon', [0, 1.5, 0.9]);
  b.lamp('beacon2', [0, -1.12, 0.4]);
  b.lamp('landing', [0, -1.05, -3.6]);
  return { spot: [0, -1.05, -3.7], hull: h };
}

function buildR44(b) {
  const { S, m } = b;
  tintGlass(b);
  const Gm = HELI_GEOMETRY.r44;
  const nz = -3.61;
  // The tall bubble cabin, the engine bay under a tall mast fairing behind
  // it, and the very slim tapered boom.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.2, { w: 0.62, top: 0.68, bot: -0.98, yc: -0.1, nT: 2.1, nB: 2.2 }, { y: -0.48 }, 7, 0.78),
      { z: -2.0, w: 0.66, top: 0.76, bot: -1.0, yc: -0.08, nT: 2.2, nB: 2.4 },
      { z: -1.15, w: 0.64, top: 0.74, bot: -1.0, yc: -0.08, nT: 2.3, nB: 2.4 },
      { z: -0.55, w: 0.5, top: 0.58, bot: -0.86, yc: -0.1, nT: 2.5, nB: 2.4 },
      { z: 0.35, w: 0.36, top: 0.42, bot: -0.5, yc: -0.02, nT: 2.4, nB: 2.3 },
      { z: 1.0, w: 0.14, top: 0.3, bot: 0.02, yc: 0.16, nT: 2.0, nB: 2.0 },
      { z: 4.9, w: 0.08, top: 0.3, bot: 0.14, yc: 0.22, nT: 2.0, nB: 2.0 },
      { z: 5.4, w: 0.05, top: 0.3, bot: 0.18, yc: 0.24, nT: 2.0, nB: 2.0 },
    ],
    radial: radial(),
    maxStep: 0.4,
    lines: { ctr: 0.06, roofEdge: 0.42, ws: 1.38, belt: 2.0, chinTop: 2.1, chinBot: 2.68 },
    windows: [
      { z0: nz + 0.05, z1: -2.05, from: 'ctr', to: 'ws' },
      { z0: nz + 0.25, z1: -2.45, from: 'chinTop', to: 'chinBot' },
      { z0: -2.0, z1: -1.58, from: 'roofEdge', to: 'belt' },
      { z0: -1.48, z1: -1.1, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  // The mast fairing: a tall narrow cowl over the engine and gearbox, its
  // top a short reach under the hub — the R44's own profile.
  deckAndMast(b, {
    z0: -1.35, z1: 1.3, w: 0.27, roofY: 0.62, topY: 1.08, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.07, exhausts: 0, grilles: false,
    // Its own shape: up off the cabin roof, over the engine bay, and down
    // along the top of the boom.
    cowl: [
      { z: -1.4, w: 0.02, top: 0.74, bot: 0.7, yc: 0.72, nT: 2.4, nB: 2.4 },
      { z: -1.15, w: 0.24, top: 0.92, bot: 0.66, yc: 0.79, nT: 2.4, nB: 2.4 },
      { z: -0.6, w: 0.3, top: 1.08, bot: 0.5, yc: 0.79, nT: 2.6, nB: 2.4 },
      { z: 0.1, w: 0.3, top: 1.08, bot: 0.36, yc: 0.72, nT: 2.6, nB: 2.4 },
      { z: 0.8, w: 0.17, top: 0.62, bot: 0.24, yc: 0.43, nT: 2.4, nB: 2.4 },
      { z: 1.4, w: 0.08, top: 0.36, bot: 0.24, yc: 0.3, nT: 2.2, nB: 2.2 },
    ],
  });
  // The engine bay behind the cabin, open at the sides under the cowl.
  for (const side of [-1, 1]) b.put(new THREE.BoxGeometry(0.03, 0.3, 0.62), m.grey, { p: [side * 0.43, 0.0, -0.15] });
  b.put(tubePath([[0.18, -0.25, 0.55], [0.3, -0.32, 0.95], [0.34, -0.3, 1.1]], 0.04, 8), m.grey);
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 2, chord: 0.254, droop: -0.045, cone: 0.06, tilt: 0.1, hz: Gm.hz, dir: 1, hubR: 0.13, rootCut: 0.4,
    tail: { at: [-0.16, 0.42, 5.22], radius: Gm.tailR, blades: 2, chord: 0.11 },
  });
  // The swept fin above and below the boom, and the one stabiliser — on the
  // right, clear of the tail rotor on the left.
  fin(b, { zBase: 4.62, baseY: 0.28, height: 0.82, rootChord: 0.66, tipChord: 0.3, sweep: 0.55 });
  ventral(b, { zBase: 4.8, baseY: 0.16, depth: 0.48, chord: 0.52, sweep: 0.3 });
  stabiliser(b, { z: 4.6, y: 0.24, halfSpan: 0.6, chord: 0.32, sides: ['right'] });
  const tz = 3.95 * S.bodyLength;
  b.put(tubePath([[0, h.botAt(tz - 0.25) + 0.03, tz - 0.25], [0, -0.05, tz], [0, 0.05, tz + 0.2], [0, 0.14, tz + 0.3]], 0.025, 6), m.metal);
  skids(b, { x: S.main.x, zFront: -2.15, zBack: S.main.z, bellyY: -0.98, crossZ: [-1.5, 0.35], rs: 0.035 });
  doorSeam(b, h, { z0: -2.02, z1: -1.06, yTop: 0.55, yBot: -0.85 });
  registration(b, h, { z: 2.1, y: 0.16, w: 0.72 });
  b.lamp('navL', [-0.62, 0.26, 4.65]);
  b.lamp('navR', [0.62, 0.26, 4.65]);
  b.lamp('strobeL', [0, 1.06, 5.0]);
  b.lamp('strobeR', [0, 1.06, 5.05]);
  b.lamp('tail', [0, 1.12, 5.15]);
  b.lamp('beacon', [0, 1.2, 0.5]);
  b.lamp('beacon2', [0, -1.0, 0.1]);
  b.lamp('landing', [0, -0.92, -2.9]);
  return { spot: [0, -0.92, -3.0], hull: h };
}

function buildAW139(b) {
  const { S, m } = b;
  tintGlass(b);
  const Gm = HELI_GEOMETRY.aw139;
  const nz = -5.48;
  // The long avionics nose, a big windscreen, a tall cabin with the sliding
  // doors, and a boom that rises gently from its roof.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.7, { w: 0.92, top: 0.72, bot: -1.06, yc: -0.18, nT: 2.4, nB: 2.6 }, { y: -0.55 }, 7, 0.85),
      { z: -3.5, w: 1.1, top: 0.98, bot: -1.15, yc: -0.08, nT: 2.8, nB: 2.9 },
      { z: -0.8, w: 1.12, top: 1.02, bot: -1.15, yc: -0.06, nT: 2.9, nB: 2.9 },
      { z: 1.2, w: 1.06, top: 1.0, bot: -1.05, yc: -0.04, nT: 2.8, nB: 2.8 },
      { z: 2.4, w: 0.66, top: 0.94, bot: -0.35, yc: 0.32, nT: 2.4, nB: 2.4 },
      { z: 3.5, w: 0.38, top: 0.88, bot: 0.2, yc: 0.54, nT: 2.1, nB: 2.1 },
      { z: 7.1, w: 0.2, top: 0.84, bot: 0.44, yc: 0.64, nT: 2.0, nB: 2.0 },
      { z: 7.95, w: 0.12, top: 0.9, bot: 0.56, yc: 0.73, nT: 2.0, nB: 2.0 },
    ],
    radial: radial(),
    maxStep: 0.5,
    lines: CABIN_LINES,
    windows: [
      { z0: nz + 0.3, z1: -3.8, from: 'ctr', to: 'ws' },
      { z0: nz + 0.5, z1: -4.05, from: 'chinTop', to: 'chinBot' },
      { z0: -3.65, z1: -2.65, from: 'roofEdge', to: 'belt' },
      { z0: -2.25, z1: -1.3, from: 'roofEdge', to: 'belt' },
      { z0: -1.15, z1: -0.2, from: 'roofEdge', to: 'belt' },
      { z0: 0.0, z1: 0.9, from: 'roofEdge', to: 'belt' },
    ],
  });
  b.addHull(h);
  doorSeam(b, h, { z0: -2.4, z1: 1.0, yTop: 0.82, yBot: -0.98 });
  deckAndMast(b, { z0: -2.6, z1: 2.55, w: 0.66, roofY: 0.96, topY: 1.6, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.11, exhausts: 2, exhaustZ: 1.55 });
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 5, chord: 0.36, droop: -0.03, cone: 0.05, tilt: 0.085, hz: Gm.hz, dir: 1, hubR: 0.3, rootCut: 0.6,
    tail: { at: [-0.3, 2.35, 7.85], radius: Gm.tailR, blades: 4, chord: 0.16 },
  });
  fin(b, { zBase: 6.75, baseY: 0.75, height: 1.85, rootChord: 1.25, tipChord: 0.6, sweep: 0.5 });
  ventral(b, { zBase: 7.15, baseY: 0.5, depth: 0.45, chord: 0.7 });
  stabiliser(b, { z: 6.25, y: 0.66, halfSpan: 1.35, chord: 0.58, endplates: true });
  const tz = 3.95 * S.bodyLength;
  b.put(tubePath([[0, h.botAt(tz - 0.3) + 0.03, tz - 0.3], [0, 0.0, tz], [0, 0.15, tz + 0.3], [0, 0.32, tz + 0.4]], 0.03, 6), m.metal);
  // The sponsons: low fairings blended into the lower sides over the main
  // wheels (they fold up into them in flight on the real one).
  pods(b, { x: 0.95, z0: S.main.z - 1.5, z1: S.main.z + 1.5, w: 0.48, top: -0.42, bot: -1.08, nose: 0.7, tail: 0.9, n: 3.0 });
  for (const side of [-1, 1]) {
    const x = side * S.main.x;
    wheelLeg(b, { top: [side * 1.25, -0.95, S.main.z], axle: [x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.24 });
  }
  wheelLeg(b, { top: [0, -1.0, S.nose.z - 0.1], axle: [0, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.14, steer: true, twin: 0.3, name: 'nose gear' });
  hoist(b, { x: 1.12, y: 1.18, z: -1.8 });
  // A searchlight under the nose.
  b.put(new THREE.CylinderGeometry(0.17, 0.2, 0.22, 10), m.dark, { p: [0.5, -1.12, -3.4] });
  registration(b, h, { z: 4.2, y: 0.56, w: 1.1 });
  b.lamp('navL', [-1.35, 0.66, 6.4]);
  b.lamp('navR', [1.35, 0.66, 6.4]);
  b.lamp('strobeL', [-1.35, 0.82, 6.45]);
  b.lamp('strobeR', [1.35, 0.82, 6.45]);
  b.lamp('tail', [0, 2.62, 8.1]);
  b.lamp('beacon', [0, 1.64, 0.6]);
  b.lamp('beacon2', [0, -1.18, 0.2]);
  b.lamp('landing', [0.5, -1.22, -3.4]);
  return { spot: [0.5, -1.22, -3.5], hull: h };
}

function buildUH60(b) {
  const { S, m } = b;
  tintGlass(b);
  const Gm = HELI_GEOMETRY.uh60;
  const nz = -6.27;
  // A long, low, flat-sided cabin under a long engine deck; the tail cone
  // runs back LOW and nearly level to the pylon, which rises steeply with the
  // canted tail rotor on its right and the stabilator at its foot.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.5, { w: 0.95, top: 0.42, bot: -1.22, yc: -0.4, nT: 2.6, nB: 2.7 }, { y: -0.62 }, 7, 0.85),
      { z: -4.2, w: 1.15, top: 0.6, bot: -1.32, yc: -0.32, nT: 3.2, nB: 3.2 },
      { z: -0.6, w: 1.18, top: 0.64, bot: -1.34, yc: -0.3, nT: 3.4, nB: 3.3 },
      { z: 1.6, w: 1.12, top: 0.62, bot: -1.22, yc: -0.28, nT: 3.2, nB: 3.0 },
      { z: 2.9, w: 0.74, top: 0.56, bot: -0.82, yc: -0.12, nT: 2.8, nB: 2.6 },
      { z: 4.3, w: 0.47, top: 0.46, bot: -0.78, yc: -0.14, nT: 2.4, nB: 2.4 },
      { z: 6.6, w: 0.35, top: 0.36, bot: -0.7, yc: -0.15, nT: 2.3, nB: 2.3 },
      { z: 7.7, w: 0.27, top: 0.5, bot: -0.42, yc: 0.04, nT: 2.2, nB: 2.2 },
      { z: 8.7, w: 0.18, top: 0.95, bot: 0.15, yc: 0.55, nT: 2.0, nB: 2.0 },
      { z: 9.15, w: 0.1, top: 1.1, bot: 0.45, yc: 0.78, nT: 2.0, nB: 2.0 },
    ],
    radial: radial(),
    maxStep: 0.5,
    lines: { ctr: 0.06, roofEdge: 0.72, ws: 1.32, belt: 1.85, chinTop: 2.05, chinBot: 2.6 },
    windows: [
      { z0: nz + 0.05, z1: -4.45, from: 'ctr', to: 'ws' },
      { z0: nz + 0.35, z1: -4.85, from: 'chinTop', to: 'chinBot' },
      { z0: -4.35, z1: -3.45, from: 'roofEdge', to: 'belt' },
      { z0: -3.2, z1: -2.65, from: 'roofEdge', to: 'ws' },
      { z0: -2.35, z1: -1.55, from: 'roofEdge', to: 'ws' },
      { z0: -1.35, z1: -0.55, from: 'roofEdge', to: 'ws' },
    ],
  });
  b.addHull(h);
  doorSeam(b, h, { z0: -2.5, z1: -0.4, yTop: 0.45, yBot: -1.18 });
  doorSeam(b, h, { z0: -4.42, z1: -3.38, yTop: 0.4, yBot: -1.1 });
  deckAndMast(b, { z0: -3.5, z1: 2.7, w: 0.74, roofY: 0.55, topY: 1.22, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.13, exhausts: 0 });
  // The two engine nacelles on the shoulders either side of the gearbox, the
  // intakes forward and the exhaust suppressors turned outboard at the back.
  for (const side of [-1, 1]) {
    b.put(turned([[0.0, -1.3], [0.24, -1.2], [0.33, -0.8], [0.35, 0.6], [0.3, 1.1], [0.22, 1.25]], 12, { closeEnds: true }), m.body, { p: [side * 0.82, 1.0, 0.6] });
    b.put(new THREE.CylinderGeometry(0.2, 0.2, 0.04, 12), m.dark, { p: [side * 0.82, 1.0, -0.69], r: [Math.PI / 2, 0, 0] });
    b.put(tubePath([[side * 0.88, 1.0, 1.75], [side * 1.08, 1.03, 2.1], [side * 1.24, 1.05, 2.3]], [0.2, 0.19, 0.17], 10), m.dark);
  }
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 4, chord: 0.53, droop: -0.03, cone: 0.045, tilt: 0.08, hz: Gm.hz, dir: 1, hubR: 0.36, rootCut: 0.75,
    tail: { at: [0.34, 1.72, 8.95], radius: Gm.tailR, blades: 4, chord: 0.24, cant: -Gm.tailCant },
  });
  fin(b, { zBase: 7.6, baseY: 0.4, height: 2.45, rootChord: 1.55, tipChord: 0.75, sweep: 0.6, lean: Gm.tailCant * 0.5, t: 0.14 });
  // The stabilator: a wide low tailplane at the foot of the pylon.
  stabiliser(b, { z: 8.55, y: 0.42, halfSpan: 2.2, chord: 0.92, root: 0.1 });
  // Tail wheel on a short leg under the tail cone; mains on drag beams forward.
  wheelLeg(b, { top: [0, h.botAt(S.nose.z - 0.3) + 0.05, S.nose.z - 0.3], axle: [0, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.16, steer: true, name: 'tail gear', strut: 0.085 });
  for (const side of [-1, 1]) {
    const x = side * S.main.x;
    wheelLeg(b, { top: [side * 0.95, -1.05, S.main.z + 0.35], axle: [x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.3 });
    b.put(tubePath([[side * 1.0, -0.6, S.main.z - 0.2], [x, S.main.y + S.wheelR.main + 0.35, S.main.z]], 0.06, 8), m.metal);
  }
  // Pitot tubes, the wire cutters above and below the windscreen, the hoist.
  for (const side of [-1, 1]) b.put(tubePath([[side * 0.55, 0.1, nz + 0.6], [side * 0.55, 0.1, nz - 0.2]], 0.022, 6), m.dark);
  b.put(new THREE.BoxGeometry(0.03, 0.34, 0.06), m.dark, { p: [0, 0.72, -4.75], r: [-0.45, 0, 0] });
  b.put(new THREE.BoxGeometry(0.03, 0.28, 0.06), m.dark, { p: [0, -1.36, -5.4], r: [0.5, 0, 0] });
  hoist(b, { x: 1.18, y: 0.85, z: -2.2 });
  registration(b, h, { z: 5.2, y: -0.15, w: 1.4 });
  b.lamp('navL', [-2.2, 0.42, 8.6]);
  b.lamp('navR', [2.2, 0.42, 8.6]);
  b.lamp('strobeL', [-1.15, 0.62, -2.0]);
  b.lamp('strobeR', [1.15, 0.62, -2.0]);
  b.lamp('tail', [0, 2.9, 9.4]);
  b.lamp('beacon', [0, 1.26, 2.5]);
  b.lamp('beacon2', [0, -1.36, 0.6]);
  b.lamp('landing', [0, -1.3, -4.4]);
  return { spot: [0, -1.3, -4.5], hull: h };
}

function buildCH47(b) {
  const { S, m } = b;
  tintGlass(b);
  const Gm = HELI_GEOMETRY.ch47;
  const nz = -6.31;
  // The tall flat-sided box of a fuselage: flat floor, square corners, the
  // stepped cockpit at the front and the ramp sweeping up at the back.
  const h = hull({
    stations: [
      ...roundNose(nz, 1.7, { w: 1.12, top: 0.72, bot: -1.1, yc: -0.28, nT: 2.6, nB: 2.8 }, { y: -0.5 }, 7, 0.85),
      { z: -4.3, w: 1.42, top: 1.2, bot: -1.14, yc: 0.0, nT: 3.6, nB: 3.8 },
      { z: -2.6, w: 1.45, top: 1.26, bot: -1.15, yc: 0.02, nT: 4.4, nB: 4.6 },
      { z: 5.0, w: 1.45, top: 1.26, bot: -1.15, yc: 0.02, nT: 4.4, nB: 4.6 },
      { z: 7.0, w: 1.42, top: 1.24, bot: -0.6, yc: 0.3, nT: 4.0, nB: 3.6 },
      { z: 8.8, w: 1.3, top: 1.18, bot: 0.22, yc: 0.7, nT: 3.4, nB: 3.0 },
      { z: 9.55, w: 0.95, top: 1.05, bot: 0.48, yc: 0.76, nT: 2.8, nB: 2.6 },
    ],
    radial: radial(),
    maxStep: 0.6,
    lines: { ctr: 0.06, roofEdge: 0.8, ws: 1.32, belt: 1.72, chinTop: 2.05, chinBot: 2.62 },
    windows: [
      { z0: nz + 0.05, z1: -4.55, from: 'ctr', to: 'ws' },
      { z0: nz + 0.35, z1: -4.95, from: 'chinTop', to: 'chinBot' },
      { z0: -4.4, z1: -3.5, from: 'roofEdge', to: 'belt' },
      { z0: -2.3, z1: -1.85, from: 'ws', to: 'belt' },
      { z0: -0.6, z1: -0.15, from: 'ws', to: 'belt' },
      { z0: 1.1, z1: 1.55, from: 'ws', to: 'belt' },
      { z0: 2.8, z1: 3.25, from: 'ws', to: 'belt' },
      { z0: 4.4, z1: 4.85, from: 'ws', to: 'belt' },
    ],
  });
  b.addHull(h);
  // The crew door forward on the right, and the ramp's hinge line.
  doorSeam(b, h, { z0: -3.3, z1: -2.45, yTop: 0.75, yBot: -1.05, sides: [1] });
  // Sponsons along the lower sides, flush boxes: fuel, and the wheels hang from them.
  pods(b, { x: 1.4, z0: -4.6, z1: 6.3, w: 0.5, top: -0.25, bot: -1.12, nose: 0.9, tail: 1.3, n: 4.0 });
  // The forward pylon on the cockpit roof, the dorsal tunnel along the top
  // (the shaft that keeps the two rotors in step), the aft pylon tower.
  const fwd = hull({
    stations: [
      ...roundNose(-5.0, 0.7, { w: 0.62, top: 1.78, bot: 1.0, yc: 1.38, nT: 2.6, nB: 2.6 }, { y: 1.2 }, 4),
      { z: -3.0, w: 0.64, top: 1.8, bot: 1.0, yc: 1.4, nT: 2.8, nB: 2.6 },
      { z: -1.9, w: 0.42, top: 1.58, bot: 1.0, yc: 1.3, nT: 2.6, nB: 2.4 },
      { z: -1.0, w: 0.28, top: 1.5, bot: 1.0, yc: 1.25, nT: 2.4, nB: 2.4 },
    ],
    radial: 8,
    uvBand: 0.2,
    maxStep: 0.5,
  });
  b.put(fwd.geometry, m.body);
  b.put(new THREE.BoxGeometry(0.5, 0.3, 7.6), m.body, { p: [0, 1.36, 2.5] });
  b.put(turned([[0.25, 0], [0.25, 7.6]], 10, { yScale: 0.6 }), m.body, { p: [0, 1.48, -1.3] });
  const aft = hull({
    stations: [
      ...roundNose(5.3, 1.2, { w: 0.55, top: 1.75, bot: 1.0, yc: 1.35, nT: 2.6, nB: 2.6 }, { y: 1.2 }, 4),
      { z: 7.3, w: 0.82, top: 3.1, bot: 0.95, yc: 2.0, nT: 3.0, nB: 2.6 },
      { z: 8.7, w: 0.86, top: 3.38, bot: 0.9, yc: 2.1, nT: 3.0, nB: 2.6 },
      { z: 9.5, w: 0.62, top: 3.3, bot: 0.9, yc: 2.05, nT: 2.6, nB: 2.4 },
      { z: 9.9, w: 0.2, top: 3.05, bot: 1.0, yc: 2.0, nT: 2.2, nB: 2.2 },
    ],
    radial: 9,
    uvBand: 0.2,
    maxStep: 0.5,
  });
  b.put(aft.geometry, m.body);
  // The engines in their nacelles on the aft pylon's flanks, the intakes
  // forward, the exhausts out the back.
  for (const side of [-1, 1]) {
    b.put(turned([[0.0, -1.4], [0.36, -1.3], [0.44, -0.9], [0.46, 0.7], [0.4, 1.1], [0.32, 1.25]], 12, { closeEnds: true }), m.body, { p: [side * 1.28, 1.85, 8.35] });
    b.put(new THREE.CylinderGeometry(0.3, 0.3, 0.04, 12), m.dark, { p: [side * 1.28, 1.85, 6.94], r: [Math.PI / 2, 0, 0] });
    b.put(tubePath([[side * 1.28, 1.85, 9.55], [side * 1.32, 1.85, 9.85]], 0.27, 10), m.dark);
    b.put(new THREE.BoxGeometry(0.6, 0.18, 1.2), m.body, { p: [side * 0.98, 1.72, 8.3] });
  }
  // Masts and swashplates under each hub.
  b.put(turned([[0.18, 0], [0.15, Gm.hubY - 1.8 + 0.06]], 10), m.metal, { p: [0, 1.8, Gm.hubZ], r: [-Math.PI / 2, 0, 0] });
  b.put(new THREE.CylinderGeometry(0.4, 0.4, 0.07, 14), m.grey, { p: [0, Gm.hubY - 0.16, Gm.hubZ] });
  b.put(turned([[0.18, 0], [0.15, Gm.aftHubY - 3.38 + 0.06]], 10), m.metal, { p: [0, 3.38, Gm.aftHubZ], r: [-Math.PI / 2, 0, 0] });
  b.put(new THREE.CylinderGeometry(0.4, 0.4, 0.07, 14), m.grey, { p: [0, Gm.aftHubY - 0.16, Gm.aftHubZ] });
  // Two rotors, counter-rotating: forward anticlockwise, aft clockwise.
  b.addRotor({ hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 3, chord: 0.81, droop: -0.03, cone: 0.045, tilt: 0.07, hz: Gm.hz, dir: 1, hubR: 0.4, rootCut: 0.95 });
  b.addRotor({ hub: [0, Gm.aftHubY, Gm.aftHubZ], radius: Gm.R, blades: 3, chord: 0.81, droop: -0.03, cone: 0.045, tilt: 0.07, hz: Gm.hz, dir: -1, hubR: 0.4, rootCut: 0.95 });
  // The rear ramp, closed: its seam and hinge.
  b.put(new THREE.BoxGeometry(2.3, 0.03, 0.03), m.dark, { p: [0, -0.62, 7.0] });
  // Four wheels: the front pair twinned under the sponsons, the rear pair singles.
  for (const side of [-1, 1]) {
    wheelLeg(b, { top: [side * 1.6, -0.95, S.nose.z], axle: [side * 1.6, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.3, twin: 0.4, name: side < 0 ? 'front left gear' : 'front right gear' });
    wheelLeg(b, { top: [side * S.main.x, -0.95, S.main.z], axle: [side * S.main.x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.34, steer: false });
  }
  registration(b, h, { z: 6.4, y: 0.75, w: 1.3 });
  b.lamp('navL', [-1.92, -0.45, 0.6]);
  b.lamp('navR', [1.92, -0.45, 0.6]);
  b.lamp('strobeL', [-1.45, 1.22, -1.0]);
  b.lamp('strobeR', [1.45, 1.22, -1.0]);
  b.lamp('tail', [0, 3.4, 9.5]);
  b.lamp('beacon', [0, 1.62, 0.8]);
  b.lamp('beacon2', [0, -1.18, 1.0]);
  b.lamp('landing', [0, -1.18, -4.6]);
  return { spot: [0, -1.18, -4.7], hull: h };
}

function buildAH64(b) {
  const { S, m } = b;
  tintGlass(b);
  const Gm = HELI_GEOMETRY.ah64;
  const nz = -6.15;
  // A narrow, angular body with the two cockpits stepped one behind the
  // other, and the long slim boom running back low and level.
  const h = hull({
    stations: [
      ...roundNose(nz, 0.85, { w: 0.44, top: -0.22, bot: -1.02, yc: -0.62, nT: 2.6, nB: 2.6 }, { y: -0.64 }, 5, 0.85),
      { z: -5.0, w: 0.52, top: 0.22, bot: -1.12, yc: -0.48, nT: 3.0, nB: 2.8 },
      { z: -4.05, w: 0.58, top: 0.58, bot: -1.16, yc: -0.34, nT: 3.0, nB: 2.8 },
      { z: -3.25, w: 0.6, top: 1.04, bot: -1.16, yc: -0.22, nT: 3.0, nB: 2.8 },
      { z: -1.6, w: 0.62, top: 1.1, bot: -1.1, yc: -0.12, nT: 3.0, nB: 2.8 },
      { z: 0.6, w: 0.6, top: 0.95, bot: -0.92, yc: -0.04, nT: 3.0, nB: 2.8 },
      { z: 2.4, w: 0.4, top: 0.62, bot: -0.62, yc: 0.0, nT: 2.6, nB: 2.6 },
      { z: 4.0, w: 0.29, top: 0.2, bot: -0.62, yc: -0.2, nT: 2.4, nB: 2.4 },
      { z: 8.0, w: 0.21, top: 0.04, bot: -0.7, yc: -0.33, nT: 2.4, nB: 2.4 },
      { z: 9.0, w: 0.14, top: 0.28, bot: -0.46, yc: -0.1, nT: 2.2, nB: 2.2 },
    ],
    radial: radial(),
    maxStep: 0.5,
    lines: { ctr: 0.06, roofEdge: 0.55, ws: 1.25, belt: 1.7, chinTop: 2.0, chinBot: 2.5 },
    windows: [
      // The gunner's canopy, forward and low; the pilot's, aft and high.
      { z0: -5.2, z1: -4.0, from: 'ctr', to: 'belt' },
      { z0: -3.95, z1: -2.35, from: 'ctr', to: 'belt' },
    ],
  });
  b.addHull(h);
  // Canopy frames between the flat panes.
  for (const z of [-5.2, -3.97, -3.2, -2.35]) b.put(new THREE.BoxGeometry(1.16, 0.04, 0.05), m.dark, { p: [0, z < -3.9 ? 0.42 : 1.02, z] });
  // The cheeks: the avionics bays either side of both cockpits, the Apache's
  // broad-shouldered look from the front.
  pods(b, { x: 0.5, z0: -4.6, z1: 0.9, w: 0.36, top: 0.22, bot: -0.86, nose: 0.6, tail: 1.1, n: 3.6 });
  // The nose sensor turret (sight and night-vision heads) and the gun under the chin.
  b.put(new THREE.CylinderGeometry(0.27, 0.27, 0.5, 14), m.grey, { p: [0, -0.64, nz - 0.02] });
  b.put(new THREE.BoxGeometry(0.4, 0.3, 0.1), m.dark, { p: [0, -0.66, nz - 0.3] });
  b.put(new THREE.SphereGeometry(0.14, 10, 8), m.grey, { p: [0, -0.2, nz + 0.16] });
  b.put(new THREE.CylinderGeometry(0.2, 0.24, 0.26, 10), m.grey, { p: [0, -1.25, -4.2] });
  b.put(tubePath([[0, -1.3, -4.3], [0, -1.3, -5.65]], [0.07, 0.05], 8), m.dark);
  // Engine nacelles high on each side, exhausts to the rear; the deck between them.
  deckAndMast(b, { z0: -2.4, z1: 2.3, w: 0.5, roofY: 0.98, topY: 1.38, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.12, exhausts: 0 });
  for (const side of [-1, 1]) {
    b.put(turned([[0.0, -1.0], [0.3, -0.85], [0.38, -0.4], [0.4, 0.9], [0.34, 1.55], [0.26, 1.7]], 12, { closeEnds: true }), m.body, { p: [side * 0.92, 0.66, 0.85] });
    b.put(new THREE.BoxGeometry(0.42, 0.5, 0.65), m.body, { p: [side * 0.98, 0.62, 2.7] });
    b.put(new THREE.BoxGeometry(0.06, 0.34, 0.5), m.dark, { p: [side * 1.2, 0.62, 2.72] });
  }
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 4, chord: 0.53, droop: -0.03, cone: 0.045, tilt: 0.085, hz: Gm.hz, dir: 1, hubR: 0.32, rootCut: 0.68,
    tail: { at: [-0.3, 0.9, 9.0], radius: Gm.tailR, blades: 4, chord: 0.25, angles: [0, 55 * DEG, 180 * DEG, 235 * DEG] },
  });
  // Stub wings with two pylons each, and the stores on them.
  for (const side of ['right', 'left']) {
    const sx = side === 'right' ? 1 : -1;
    const w = wing({
      frame: side,
      stations: [
        { s: 0.55, chord: 1.15, le: -0.9, y: -0.12 },
        { s: S.halfSpan, chord: 0.92, le: -0.72, y: -0.08 },
      ],
      t: 0.13,
      m: 0.02,
      steps: 6,
      tipRound: 0.05,
    });
    b.put(w.fixed, m.body);
    for (const px of [1.45, 2.2]) {
      b.put(new THREE.BoxGeometry(0.1, 0.28, 0.85), m.grey, { p: [sx * px, -0.32, -0.3] });
      b.put(turned([[0.0, -0.95], [0.19, -0.75], [0.2, 0.75], [0.12, 0.9]], 10, { closeEnds: true }), m.dark, { p: [sx * px, -0.62, -0.2] });
    }
  }
  fin(b, { zBase: 7.75, baseY: -0.05, height: 2.15, rootChord: 1.35, tipChord: 0.62, sweep: 0.45, t: 0.14 });
  stabiliser(b, { z: 8.65, y: -0.2, halfSpan: 1.7, chord: 0.78, root: 0.1 });
  // Tail wheel on a short leg under the boom; mains forward on trailing legs.
  wheelLeg(b, { top: [0, h.botAt(S.nose.z - 0.3) + 0.04, S.nose.z - 0.35], axle: [0, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.15, steer: true, name: 'tail gear', strut: 0.08 });
  for (const side of [-1, 1]) {
    wheelLeg(b, { top: [side * 0.62, -0.75, S.main.z - 0.6], axle: [side * S.main.x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.28 });
  }
  registration(b, h, { z: 5.6, y: -0.3, w: 1.2 });
  b.lamp('navL', [-S.halfSpan, -0.06, -0.3]);
  b.lamp('navR', [S.halfSpan, -0.06, -0.3]);
  b.lamp('strobeL', [-1.0, 1.1, 0.0]);
  b.lamp('strobeR', [1.0, 1.1, 0.0]);
  b.lamp('tail', [0, 2.2, 9.3]);
  b.lamp('beacon', [0, 1.42, 1.8]);
  b.lamp('beacon2', [0, -0.95, 1.0]);
  b.lamp('landing', [0, -1.1, -4.5]);
  return { spot: [0, -1.1, -4.6], hull: h };
}

/**
 * Marine One: the presidential VH-3D Sea King. A boat hull (it was built to
 * land on water) with a sharp chine and the bottom sweeping up into the tail
 * pylon; the two engines side by side on the roof ahead of the gearbox; the
 * five-blade rotor; sponsons low on each side aft carrying the twin main
 * wheels; the tail wheel under the rear hull; the five-blade tail rotor on
 * the left of the pylon and a stabiliser on the right. White top over dark
 * green (TYPE_SCHEMES 'marine-one' in liveries.js), the title in white along
 * the rear fuselage, our own gold star roundel on each side — no seal.
 */
function buildVH3D(b) {
  const { S, m } = b;
  tintGlass(b);
  const Gm = HELI_GEOMETRY.vh3d;
  const sch = b.scheme || {};
  const nz = -2.6 * S.bodyLength;
  // The white of the top, and plain dark green for the pylon (a fin's UVs
  // read the top band of the skin, which on this scheme is white).
  const white = m.body.clone();
  white.map = airframeTexture({ base: sch.upper || '#f3f2ec', plain: true });
  const green = m.body.clone();
  green.map = airframeTexture({ base: sch.base || '#22352a', plain: true });
  const h = hull({
    stations: [
      ...roundNose(nz, 1.6, { w: 1.0, top: 0.75, bot: -1.2, yc: -0.25, nT: 2.5, nB: 2.2 }, { y: -0.45 }, 7, 0.85),
      { z: -4.6, w: 1.18, top: 1.0, bot: -1.32, yc: -0.15, nT: 2.9, nB: 2.0 },
      { z: -2.0, w: 1.22, top: 1.06, bot: -1.36, yc: -0.12, nT: 3.1, nB: 2.0 },
      { z: 1.0, w: 1.2, top: 1.06, bot: -1.34, yc: -0.12, nT: 3.1, nB: 2.0 },
      { z: 3.0, w: 1.08, top: 1.03, bot: -1.12, yc: -0.05, nT: 3.0, nB: 2.0 },
      { z: 5.0, w: 0.76, top: 0.98, bot: -0.72, yc: 0.14, nT: 2.7, nB: 2.0 },
      { z: 7.2, w: 0.46, top: 1.0, bot: -0.12, yc: 0.46, nT: 2.3, nB: 2.0 },
      { z: 8.8, w: 0.3, top: 1.12, bot: 0.42, yc: 0.78, nT: 2.2, nB: 2.0 },
      { z: 9.6, w: 0.16, top: 1.3, bot: 0.7, yc: 1.0, nT: 2.1, nB: 2.0 },
    ],
    radial: radial(),
    maxStep: 0.5,
    lines: { ctr: 0.06, roofEdge: 0.7, ws: 1.3, belt: 1.66, chinTop: 1.95, chinBot: 2.45 },
    windows: [
      { z0: nz + 0.05, z1: -4.75, from: 'ctr', to: 'ws' },
      { z0: nz + 0.3, z1: -5.1, from: 'chinTop', to: 'chinBot' },
      { z0: -4.6, z1: -3.75, from: 'roofEdge', to: 'belt' },
      { z0: -2.9, z1: -2.25, from: 'ws', to: 'belt' },
      { z0: -1.8, z1: -1.15, from: 'ws', to: 'belt' },
      { z0: -0.7, z1: -0.05, from: 'ws', to: 'belt' },
      { z0: 0.4, z1: 1.05, from: 'ws', to: 'belt' },
    ],
  });
  b.addHull(h);
  // The airstair door forward on the right, the cockpit doors.
  doorSeam(b, h, { z0: -3.6, z1: -3.0, yTop: 0.72, yBot: -1.15, sides: [1] });
  doorSeam(b, h, { z0: -4.65, z1: -3.7, yTop: 0.85, yBot: -0.6 });
  // The boat hull's chine: a strake along each side where the planing bottom meets the topsides.
  for (const side of [-1, 1]) {
    const pts = [];
    for (const z of [nz + 1.2, -4.0, -2.5, -0.5, 1.5, 3.2]) {
      const p = h.point(z, h.angleAt(z, h.botAt(z) + 0.2));
      pts.push([side * (Math.abs(p.x) + 0.02), p.y, z]);
    }
    b.put(tubePath(pts, 0.035, 6), green);
  }
  // The two engines side by side on the roof ahead of the gearbox, their
  // intakes at the front over the cockpit; then the gearbox fairing and mast.
  for (const side of [-1, 1]) {
    b.put(turned([[0.0, -1.55], [0.22, -1.48], [0.34, -1.2], [0.36, 0.5], [0.3, 0.9], [0.18, 1.05]], 12, { closeEnds: true, vBand: 0.92 }), white, { p: [side * 0.45, 1.3, -2.95] });
    b.put(new THREE.CylinderGeometry(0.24, 0.24, 0.04, 12), m.dark, { p: [side * 0.45, 1.3, -4.52], r: [Math.PI / 2, 0, 0] });
    b.put(tubePath([[side * 0.6, 1.38, -2.2], [side * 0.82, 1.45, -1.9], [side * 0.98, 1.5, -1.75]], [0.15, 0.15, 0.14], 10), m.dark);
  }
  deckAndMast(b, { z0: -2.8, z1: 1.2, w: 0.72, roofY: 1.0, topY: 1.9, hubY: Gm.hubY, hubZ: Gm.hubZ, mastR: 0.14, exhausts: 0, uvBand: 0.95, mat: white });
  b.addRotor({
    hub: [0, Gm.hubY, Gm.hubZ], radius: Gm.R, blades: 5, chord: 0.46, droop: -0.03, cone: 0.045, tilt: 0.075, hz: Gm.hz, dir: 1, hubR: 0.4, rootCut: 0.8,
    tail: { at: [-0.3, 1.85, 9.45], radius: Gm.tailR, blades: 5, chord: 0.18 },
  });
  // The tail pylon, swept, and the stabiliser on the right near its top.
  fin(b, { zBase: 7.85, baseY: 0.85, height: 2.35, rootChord: 2.05, tipChord: 1.0, sweep: 0.4, t: 0.15, mat: green });
  stabiliser(b, { z: 9.35, y: 2.2, halfSpan: 1.5, chord: 0.62, sides: ['right'], root: 0.05, mat: green });
  // Sponsons low on each side aft of the cabin door, the main wheels under them.
  pods(b, { x: 1.22, z0: S.main.z - 1.8, z1: S.main.z + 1.7, w: 0.62, top: -0.62, bot: -1.2, nose: 0.85, tail: 1.1, n: 2.6, mat: green });
  for (const side of [-1, 1]) {
    wheelLeg(b, { top: [side * S.main.x, -0.95, S.main.z], axle: [side * S.main.x, S.main.y + S.wheelR.main, S.main.z], R: S.wheelR.main, width: 0.22, twin: 0.3 });
  }
  // The tail wheel under the rear hull.
  wheelLeg(b, { top: [0, h.botAt(S.nose.z - 0.25) + 0.05, S.nose.z - 0.3], axle: [0, S.nose.y + S.wheelR.nose, S.nose.z], R: S.wheelR.nose, width: 0.16, steer: true, name: 'tail gear', strut: 0.09 });
  // The title along the rear fuselage under the white, and the roundel.
  fuselageLettering(b, h, { titleAt: { z: 3.75, y: 0.1, w: 5.0 } });
  skinDecal(b, h, 'Star roundel', starRoundelTexture(256), { z: -3.3, y: -0.35, w: 0.62 }, 1);
  b.lamp('navL', [-1.85, -0.62, S.main.z]);
  b.lamp('navR', [1.85, -0.62, S.main.z]);
  b.lamp('strobeL', [-1.2, 1.0, -0.8]);
  b.lamp('strobeR', [1.2, 1.0, -0.8]);
  b.lamp('tail', [0, 3.1, 9.6]);
  b.lamp('beacon', [0, 2.1, 1.0]);
  b.lamp('beacon2', [0, -1.38, -1.0]);
  b.lamp('landing', [0, -1.3, -5.2]);
  return { spot: [0, -1.3, -5.3], hull: h };
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
  vh3d: buildVH3D,
};

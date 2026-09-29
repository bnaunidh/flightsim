/**
 * Skyhook H-3 (type id 'harrier') — a light utility helicopter, the
 * JetRanger / 407 kind: a glass-fronted pod, a slim boom, a four-blade
 * rotor on a short mast, skids.
 *
 * What was wrong with it (rendered from outside, before this file):
 *
 *  - It had stub wings, flaps, ailerons, a fixed-wing fin and an elevator
 *    slab — an aeroplane's tail on a helicopter — and a tricycle
 *    undercarriage with wheel spats.
 *  - Two rotor blades as flat boxes on a thick mast 1.6 m above the axis,
 *    standing the hub 3.7 m off the ground (a JetRanger's is 2.9).
 *  - The tail rotor was a pair of boxes on the fin, and it sat inside the
 *    main rotor's disc: the boom ended at 4.3 m and the blades reached 4.3.
 *  - The cabin was the same glass shed the aeroplanes had, sawtooth and all.
 *
 * The skids' bottoms run through the flight model's gear contact points
 * (they are wheels to the physics, and on flat ground a skid touching at the
 * same height is the same thing). The rotor radius is the physics' own
 * rotorRadius, unchanged; the hub height is drawing-only. The tail guard's
 * lowest point is the tail-strike point.
 */
import * as THREE from '../../vendor/three.module.js';
import { hull, wing, roundNose, tubePath, turned } from './civil-kit.js';

export function buildSkyhook(b) {
  const { S, m } = b;
  const P = S.power;
  const hubY = P.y ?? 1.28;
  const hubZ = P.z ?? 0.1;
  const R = P.propRadius;

  /* ---------------- Pod and boom: one hull ---------------- */
  const stations = [
    ...roundNose(-2.15, 0.95, { w: 0.64, top: 0.62, bot: -0.52, yc: 0.02, nT: 2.2, nB: 2.4 }, { y: -0.12 }, 6, 0.85),
    { z: -0.9, w: 0.68, top: 0.72, bot: -0.54, yc: 0.04, nT: 2.4, nB: 2.6 },
    { z: 0.5, w: 0.68, top: 0.74, bot: -0.52, yc: 0.05, nT: 2.4, nB: 2.6 },
    { z: 1.0, w: 0.6, top: 0.72, bot: -0.38, yc: 0.08, nT: 2.3, nB: 2.3 },
    { z: 1.55, w: 0.34, top: 0.62, bot: -0.04, yc: 0.26, nT: 2.1, nB: 2.1 },
    { z: 2.1, w: 0.16, top: 0.5, bot: 0.16, yc: 0.33, nT: 2.0, nB: 2.0 },
    { z: 5.0, w: 0.1, top: 0.44, bot: 0.22, yc: 0.33, nT: 2.0, nB: 2.0 },
    { z: 5.35, w: 0.06, top: 0.41, bot: 0.27, yc: 0.34, nT: 2.0, nB: 2.0 },
  ];
  const h = hull({
    stations,
    radial: 10,
    maxStep: 0.45,
    lines: { ctr: 0.06, roofEdge: 0.62, ws: 1.25, belt: 1.72, chinTop: 1.95, chinBot: 2.55 },
    windows: [
      { z0: -2.1, z1: -1.0, from: 'ctr', to: 'ws' }, // the wraparound windscreen
      { z0: -2.0, z1: -1.3, from: 'chinTop', to: 'chinBot' }, // chin windows
      { z0: -0.92, z1: -0.2, from: 'roofEdge', to: 'belt' }, // front doors
      { z0: -0.12, z1: 0.62, from: 'roofEdge', to: 'belt' }, // rear doors
    ],
  });
  b.addHull(h);

  /* ---------------- Engine deck, mast, exhausts ---------------- */
  const deck = hull({
    stations: [
      ...roundNose(-0.45, 0.4, { w: 0.36, top: 1.0, bot: 0.6, yc: 0.76, nT: 2.4, nB: 2.4 }, { y: 0.74 }, 3),
      { z: 0.85, w: 0.4, top: 1.04, bot: 0.6, yc: 0.78, nT: 2.6, nB: 2.4 },
      { z: 1.5, w: 0.3, top: 0.92, bot: 0.58, yc: 0.72, nT: 2.4, nB: 2.2 },
      { z: 1.9, w: 0.1, top: 0.78, bot: 0.6, yc: 0.68, nT: 2.2, nB: 2.2 },
    ],
    radial: 7,
    uvBand: 0.2,
    maxStep: 0.5,
  });
  b.put(deck.geometry, m.body);
  // Intake grilles on the deck sides, and two exhaust stacks at its back.
  for (const side of [-1, 1]) {
    b.put(new THREE.BoxGeometry(0.03, 0.14, 0.32), m.dark, { p: [side * (deck.halfWidthAt(0.35, 0.86) - 0.005), 0.86, 0.35] });
    b.put(tubePath([[side * 0.13, 0.84, 1.35], [side * 0.15, 0.9, 1.62], [side * 0.18, 0.99, 1.8]], 0.07, 8), m.grey);
  }
  // Mast and swashplate, which stay still while the head turns above them.
  b.put(turned([[0.09, 0], [0.08, 0.2], [0.07, hubY - 1.0 - 0.06]], 10), m.metal, { p: [0, 1.0, hubZ], r: [-Math.PI / 2, 0, 0] });
  b.put(new THREE.CylinderGeometry(0.19, 0.19, 0.05, 12), m.grey, { p: [0, 1.1, hubZ] });

  b.addRotor({
    hub: [0, hubY, hubZ],
    radius: R,
    blades: 4,
    chord: 0.24,
    droop: -0.035,
    cone: 0.05,
    tilt: 0.09,
    hz: 6.5,
    tail: { at: [-0.17, 0.86, 5.08], radius: 0.62, blades: 2, chord: 0.12 },
  });

  /* ---------------- Tail: fin, ventral fin, stabiliser, guard ---------------- */
  const fin = wing({
    frame: 'fin',
    origin: [0, 0.4, 0],
    stations: [
      { s: -0.08, chord: 0.72, le: 4.65, y: 0 },
      { s: 0.9, chord: 0.36, le: 5.02, y: 0 },
    ],
    t: 0.12,
    m: 0,
    steps: 6,
    tipRound: 0.05,
    uvV: [0.66, 0.98],
  });
  b.put(fin.fixed, m.tail);
  const ventral = wing({
    frame: 'fin',
    origin: [0, 0.3, 0],
    lean: Math.PI,
    stations: [
      { s: -0.04, chord: 0.5, le: 4.82, y: 0 },
      { s: 0.16, chord: 0.34, le: 4.96, y: 0 },
    ],
    t: 0.12,
    m: 0,
    steps: 5,
    tipRound: 0,
  });
  b.put(ventral.fixed, m.tail);
  /*
   * Tail guard: a bent tube whose lowest point is the tail-strike point, and
   * which climbs aft of it at least as steeply as the line from the main
   * contact through that point — so pitching up, it is the first thing to
   * touch and nothing behind it touches sooner. A guard and fin that did not
   * climb touched at 17.5 degrees against the physics' 19.
   */
  const tz = 3.95 * S.bodyLength;
  const rg = 0.03;
  b.put(
    tubePath([[0, h.botAt(tz - 0.3) + 0.03, tz - 0.3], [0, -0.12 + rg, tz], [0, 0.02, tz + 0.3], [0, 0.13, tz + 0.43]], rg, 6),
    m.metal
  );
  // Horizontal stabiliser with endplates.
  for (const side of ['right', 'left']) {
    const sx = side === 'right' ? 1 : -1;
    const st = wing({
      frame: side,
      stations: [
        { s: 0, chord: 0.4, le: 3.6, y: 0.36 },
        { s: 0.72, chord: 0.34, le: 3.64, y: 0.36 },
      ],
      t: 0.12,
      m: 0.02,
      steps: 6,
      tipRound: 0,
    });
    b.put(st.fixed, m.body);
    const ep = wing({
      frame: 'fin',
      origin: [sx * 0.72, 0.18, 0],
      stations: [
        { s: 0, chord: 0.4, le: 3.62, y: 0 },
        { s: 0.38, chord: 0.3, le: 3.7, y: 0 },
      ],
      t: 0.1,
      m: 0,
      steps: 5,
      tipRound: 0,
    });
    b.put(ep.fixed, m.tail);
  }

  /* ---------------- Skids ---------------- */
  // The bottom of each skid passes through the contact points: y -1.30 at
  // the nose point's station and -1.35 at the mains'.
  // Straight between the two contact stations, level behind the aft one: a
  // continued slope put the skid's tail 1.9 cm below the ground plane.
  const botAt = (z) => (z >= S.main.z ? S.main.y : S.nose.y + ((S.main.y - S.nose.y) * (z - S.nose.z)) / (S.main.z - S.nose.z));
  const rs = 0.045;
  // One piece, so it can rise as one under the machine's weight (see
  // squash in civil-build.js): standing, the skids were 0.16 m in the ground.
  const skids = b.addLeg({ pivot: [0, 0, 0], name: 'skid gear', lift: true });
  for (const side of [-1, 1]) {
    const x = side * S.main.x;
    // Toe curled up at the front; heel turned up just behind the rear cross
    // tube. The physics pivots on its main contact point, so a skid run
    // on flat past that point digs its heel into the runway as soon as the
    // nose comes up (measured: 1.9 degrees). Turned up, it clears 20.
    const pts = [];
    pts.push([x, botAt(-1.55) + rs + 0.26, -1.86]);
    pts.push([x, botAt(-1.55) + rs + 0.1, -1.74]);
    for (const z of [-1.55, -1.0, 0.0, S.main.z]) pts.push([x, botAt(z) + rs, z]);
    pts.push([x, botAt(S.main.z) + rs + 0.035, S.main.z + 0.15]);
    pts.push([x, botAt(S.main.z) + rs + 0.13, S.main.z + 0.28]);
    skids.add(tubePath(pts, rs, 8), m.metal);
  }
  // Cross tubes: arched, from skid to skid through the belly.
  for (const z of [-0.72, 0.48]) {
    const y0 = botAt(z) + rs;
    const x0 = S.main.x;
    const pts = [
      [-x0, y0, z],
      [-x0 + 0.08, y0 + 0.28, z],
      [-x0 + 0.34, y0 + 0.6, z],
      [-0.4, -0.5, z],
      [0.4, -0.5, z],
      [x0 - 0.34, y0 + 0.6, z],
      [x0 - 0.08, y0 + 0.28, z],
      [x0, y0, z],
    ];
    skids.add(tubePath(pts, 0.04, 8), m.metal);
  }
  // The cargo hook the machine is named for, under the belly.
  b.put(tubePath([[0, -0.5, 0.1], [0, -0.66, 0.1], [0, -0.74, 0.16], [0, -0.7, 0.24]], 0.025, 5), m.dark);

  /* ---------------- Lights ---------------- */
  b.lamp('navL', [-0.74, 0.4, 3.8]);
  b.lamp('navR', [0.74, 0.4, 3.8]);
  b.lamp('strobeL', [-0.74, 0.56, 3.85]);
  b.lamp('strobeR', [0.74, 0.56, 3.85]);
  b.lamp('tail', [0, 1.3, 5.4]);
  b.lamp('beacon', [0, 1.06, 1.25]);
  b.lamp('beacon2', [0, -0.55, 0.9]);
  b.lamp('landing', [0, -0.5, -1.7]);
  return { spot: [0, -0.5, -1.8], hull: h };
}

/**
 * Meridian 220 — a forty-seat twin-jet, the regional-jet kind.
 *
 * What was wrong with it (rendered from outside, before this file):
 *
 *  - THE ENGINES WERE IN THE GROUND. Each nacelle's centre sat 1.5 shape
 *    units below the axis with a radius of 0.6 — its bottom 0.6 below the
 *    main wheels' contact point, which at scale 2.05 is 1.36 m under the
 *    runway surface. In the old Blender views the ground plane is laid at
 *    the lowest vertex, so the aeroplane appeared to hover on its engines.
 *  - The nacelles were 2.5 m across on an aeroplane with a 3.6 m body:
 *    CF34-class engines on a regional jet are about 1.5 m.
 *  - The body was 3.6 m across and 18 m long, a fineness of 5 — a barrel.
 *  - The flight deck was a glass box with a flat roof and square corners.
 *  - The same slabs-on-top control surfaces, a single straight-tapered
 *    wing with no trailing-edge kink and no winglets, and single tyres
 *    0.8 m in radius where an airliner has pairs of much smaller ones.
 *
 * The body runs as far aft as the tail-strike point allows: its belly
 * follows the line from the main wheels to that point, so the tail cone
 * sweeps up the way a jet's does and touches the runway at the same pitch
 * the flight model says it does. Gear, eye, scale, wing tips and strike
 * points unchanged.
 *
 * It was still a barrel after that. At 2.95 m across and 19.6 m long it had
 * a fineness of 6.7, and with the flight model's 28.8 m of wing on it the
 * whole aeroplane was 0.70 as long as it was wide: from outside, a baby
 * A318. A forty-seat regional jet is a 2.6-2.7 m tube about ten times as
 * long as it is wide (the CRJ200's is 2.69 m and 26.8 m). The tube is 2.62 m
 * now, and slimming it is also what lets it grow — the belly meets the
 * tail-strike line later, so the cabin runs 0.3 further aft before the
 * cone starts and the cone itself ends 0.6 further back, with the fin and
 * tailplane moved back onto it (types.js finZ, hZ). The nose is 0.3 further
 * forward. Measured: 21.5 m of body 2.59 m across, a fineness of 8.3, and
 * 0.76 as long as the span; the drawn tail still reaches the runway at
 * 19.6 degrees against the physics' 19.1.
 */
import { hull, wing, roundNose, tubePath, turned } from './civil-kit.js';
import { tailGroup, oleoLeg, windowRow, jetNacelle, seamOnSkin } from './civil-details.js';

export function buildMeridian(b) {
  const { S, m } = b;
  const tipX = S.wingRootX + S.halfSpan;
  const R = 0.64; // body radius, shape units (1.31 m)

  /* ---------------- Fuselage ---------------- */
  // The nose top keeps rising behind the windscreen, so there is skin above
  // the glass — the "eyebrow" — as there is on every airliner.
  //
  // Aft of the constant section every station's belly sits 0.06-0.08 above
  // the tail-strike line, y = -1.5 + 0.3113 (z - 0.9): the line from the
  // main wheels' contact to the physics' tail point (0, -0.12, 5.3325).
  const stations = [
    ...roundNose(-3.76, 1.0, { w: 0.54, top: 0.33, bot: -0.59, yc: -0.11, nT: 2.0, nB: 2.0 }, { y: -0.18 }, 5, 0.9),
    { z: -2.4, w: 0.6, top: 0.47, bot: -0.62, yc: -0.05, nT: 2.0, nB: 2.0 },
    { z: -2.0, w: 0.63, top: 0.59, bot: -0.635, yc: -0.02, nT: 2.0, nB: 2.0 },
    { z: -1.5, w: R, top: R, bot: -R, yc: 0, nT: 2.0, nB: 2.05 },
    { z: 3.3, w: R, top: R, bot: -R, yc: 0, nT: 2.0, nB: 2.05 },
    { z: 4.05, w: 0.6, top: 0.63, bot: -0.45, yc: 0.06, nT: 2.0, nB: 2.0 },
    { z: 4.8, w: 0.49, top: 0.61, bot: -0.21, yc: 0.15, nT: 2.0, nB: 2.0 },
    { z: 5.55, w: 0.35, top: 0.58, bot: 0.02, yc: 0.27, nT: 2.0, nB: 2.0 },
    { z: 6.25, w: 0.2, top: 0.55, bot: 0.24, yc: 0.38, nT: 2.0, nB: 2.0 },
    { z: 6.72, w: 0.09, top: 0.52, bot: 0.39, yc: 0.45, nT: 2.0, nB: 2.0 },
  ];
  const h = hull({
    stations,
    radial: 9,
    // Rings where the section changes; the constant cabin between -1.5 and
    // 3.3 needs none but the stations, and a ring every 0.5 through it was
    // 400 triangles bending nothing.
    maxStep: 0.8,
    rings: [-1.75, 3.7, 4.4, 5.15, 5.9],
    lines: {
      ctr: 0.05, // the windscreen's centre post
      fdTop: 0.55, // top of the flight-deck side windows
      ws: 0.9, // the windscreen wraps this far round
      fdBot: 1.1, // bottom of the flight-deck side windows
    },
    windows: [
      { z0: -2.74, z1: -2.44, from: 'ctr', to: 'ws' },
      { z0: -2.4, z1: -2.2, from: 'fdTop', to: 'fdBot' },
      { z0: -2.16, z1: -1.92, from: 'fdTop', to: 'fdBot' },
    ],
    uv: { right: 0, left: -0.7 },
  });
  b.addHull(h);

  // Cabin windows on the skin, a door at each end each side.
  const winY = 0.2;
  const doorZ = [-1.5, 3.3];
  windowRow(b, h, { z0: -1.25, z1: 3.05, pitch: 0.25, y: winY, w: 0.1, h: 0.15, skip: [] });
  for (const dz of doorZ) {
    for (const side of [-1, 1]) {
      // Door outline: a thin dark seam laid on the skin, following its
      // curve (see seamOnSkin).
      const corners = [[-0.17, -0.36], [-0.17, 0.33], [-0.11, 0.4], [0.11, 0.4], [0.17, 0.33], [0.17, -0.36], [-0.17, -0.36]];
      b.put(seamOnSkin(h, dz, side, corners), m.grey);
    }
  }

  // Belly fairing where the wing passes under the body.
  const belly = hull({
    stations: [
      ...roundNose(-0.75, 0.9, { w: 0.56, top: -0.25, bot: -0.76, yc: -0.45 }, { y: -0.55 }, 3),
      { z: 1.4, w: 0.58, top: -0.25, bot: -0.76, yc: -0.45 },
      { z: 2.5, w: 0.38, top: -0.28, bot: -0.65, yc: -0.45 },
      { z: 3.05, w: 0.13, top: -0.4, bot: -0.6, yc: -0.52 },
    ],
    radial: 5,
    uvBand: 0.2,
    maxStep: 0.5,
  });
  b.put(belly.geometry, m.body);

  /* ---------------- Wing ---------------- */
  const le0 = S.wingZ;
  const sKink = S.wingRootX + S.halfSpan * 0.34;
  const f = (s) => Math.max(0, (s - S.wingRootX) / S.halfSpan);
  const yAt = (s) => S.wingY + S.dihedral * f(s);
  const leAt = (s) => le0 + S.sweep * f(s);
  const teRoot = le0 + S.rootChord;
  const teKink = teRoot + 0.05;
  const teTip = leAt(tipX) + S.tipChord;
  const wingStations = [
    { s: 0, chord: S.rootChord, le: le0, y: S.wingY, thick: 1.1 },
    { s: S.wingRootX, chord: S.rootChord, le: le0, y: S.wingY, thick: 1.05 },
    { s: sKink, chord: teKink - leAt(sKink), le: leAt(sKink), y: yAt(sKink) },
    { s: tipX, chord: teTip - leAt(tipX), le: leAt(tipX), y: yAt(tipX), thick: 0.9 },
  ];
  const cuts = [
    { name: 'flapIn', s0: S.wingRootX + 0.1, s1: sKink - 0.05, hinge: 0.7 },
    { name: 'flapOut', s0: sKink + 0.05, s1: S.wingRootX + S.halfSpan * 0.68, hinge: 0.72 },
    { name: 'aileron', s0: S.wingRootX + S.halfSpan * 0.7, s1: tipX - 0.3, hinge: 0.74 },
  ];
  for (const side of ['right', 'left']) {
    const w = wing({ frame: side, stations: wingStations, t: 0.11, m: 0.015, steps: 6, cuts, tipRound: 0 });
    b.put(w.fixed, m.body);
    b.addSurface('flap', w.surfaces.flapIn);
    b.addSurface('flap', w.surfaces.flapOut);
    b.addSurface(side === 'right' ? 'aileronR' : 'aileronL', w.surfaces.aileron);
    // Winglet: up from the tip, swept and canted out a little.
    const sx = side === 'right' ? 1 : -1;
    const tipC = teTip - leAt(tipX);
    const wl = wing({
      frame: 'fin',
      origin: [sx * tipX, yAt(tipX), 0],
      lean: -sx * 0.16,
      stations: [
        { s: -0.03, chord: tipC, le: leAt(tipX), y: 0 },
        { s: 0.62, chord: tipC * 0.42, le: leAt(tipX) + tipC * 0.62, y: 0 },
      ],
      t: 0.09,
      m: 0,
      steps: 7,
      tipRound: 0,
    });
    b.put(wl.fixed, m.tail);
  }

  /* ---------------- Engines ---------------- */
  const P = S.power;
  for (const side of [-1, 1]) {
    const x = side * P.x;
    const s = Math.abs(x);
    jetNacelle(b, {
      at: [x, P.y, P.z - P.length],
      radius: P.radius,
      length: P.length * 2,
      pylonTo: yAt(s) - 0.02,
      pylonZ: [P.z - P.length * 0.45, leAt(s) + 0.9],
    });
  }

  /* ---------------- Tail ---------------- */
  tailGroup(b, {
    fin: { base: 0.58, le: S.finZ, root: S.finRootChord, tip: S.finRootChord * 0.48, height: S.finHeight, sweep: S.finSweep, dorsal: { len: 1.3, rise: 0.22 }, hinge: 0.66, t: 0.1, rudderTop: 0.12 },
    stab: { y: 0.4, le: S.hZ, root: S.hRootChord, tip: S.hRootChord * 0.42, span: S.hSpan, sweep: S.hRootChord * 0.95, dihedral: 0.12, hinge: 0.68, inner: 0.3, t: 0.1 },
  });
  // APU exhaust in the end of the tail cone.
  b.put(turned([[0.06, 0], [0.06, 0.1], [0.001, 0.1]], 10, { closeEnds: false }), m.dark, { p: [0, 0.45, 6.66] });

  /* ---------------- Gear ---------------- */
  const RM = S.wheelR.main;
  const RN = S.wheelR.nose;
  for (const side of [-1, 1]) {
    const x = side * S.main.x;
    oleoLeg(b, {
      name: 'main gear',
      top: [x, yAt(Math.abs(x)) - 0.08, S.main.z],
      axle: [x, S.main.y + RM, S.main.z],
      R: RM,
      width: 0.13,
      twin: 0.3,
      strut: 0.06,
      fold: { axis: [0, 0, 1], angle: -side * 1.5 },
      door: 'outboard',
      doorWidth: 0.36,
    });
  }
  oleoLeg(b, {
    name: 'nose gear',
    top: [0, -0.62, S.nose.z - 0.05],
    axle: [0, S.nose.y + RN, S.nose.z],
    R: RN,
    width: 0.09,
    twin: 0.2,
    strut: 0.045,
    steer: true,
    fold: { axis: [1, 0, 0], angle: 1.45 },
  });

  /* ---------------- Details ---------------- */
  // Antennas on the crown and belly, and pitot probes by the flight deck.
  b.put(tubePath([[0, R - 0.02, 0.4], [0, R + 0.2, 0.58]], [0.03, 0.012], 4), m.dark);
  b.put(tubePath([[0, -0.66, 2.2], [0, -0.82, 2.32]], [0.025, 0.01], 4), m.dark);
  for (const side of [-1, 1]) {
    const z = -2.4;
    b.put(tubePath([[side * (h.halfWidthAt(z, -0.1) - 0.01), -0.1, z], [side * (h.halfWidthAt(z, -0.1) + 0.08), -0.1, z - 0.06]], 0.01, 4), m.metal);
  }

  /* ---------------- Lights ---------------- */
  const tipY = yAt(tipX);
  const tipZ = leAt(tipX) + S.tipChord * 0.25;
  b.lamp('navL', [-tipX - 0.03, tipY + 0.03, tipZ]);
  b.lamp('navR', [tipX + 0.03, tipY + 0.03, tipZ]);
  b.lamp('strobeL', [-tipX - 0.03, tipY + 0.05, tipZ + 0.25]);
  b.lamp('strobeR', [tipX + 0.03, tipY + 0.05, tipZ + 0.25]);
  b.lamp('tail', [0, 0.45, 6.8]);
  b.lamp('beacon', [0, R + 0.03, 1.2]);
  b.lamp('beacon2', [0, -0.79, 1.0]);
  b.lamp('landing', [-1.05, yAt(1.05) - 0.08, leAt(1.05) + 0.05]);
  return { spot: [-1.05, yAt(1.05) - 0.1, leAt(1.05) - 0.2], hull: h };
}

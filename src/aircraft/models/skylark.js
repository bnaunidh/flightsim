/**
 * Skylark 172 — the high-wing trainer the class learns on.
 *
 * What was wrong with it, rendered from outside (tools/blender_aircraft.py):
 *
 *  - The body was a lathe, round in section, and its tail cone ended on the
 *    thrust line. A 172's top line runs almost straight back to the fin and
 *    its belly sweeps up to meet it; the cabin is a box with rounded corners.
 *  - Flaps and ailerons were 5.5 cm slabs lying 14 cm ABOVE the wing's upper
 *    skin: from every angle, six plates resting on a wing. The elevator was
 *    one slab 3.7 m wide passing straight through the tail cone.
 *  - The fin stood 3.2 m off the ground (a 172 is 2.7) and was a plain
 *    tapered plank with a box stuck to its front for a dorsal fin.
 *  - Two struts a side, fanned fore and aft, which is a Cub. A 172 has one.
 *  - Tyres 0.62 m across on the mains; a 172 wears 0.44.
 *  - The wing began 1.1 m ahead of the pilot's eye, so the windscreen sat
 *    under the middle of the wing chord, and the cowl was 0.5 m long.
 *
 * What did not move: the gear contact points, the eye, the scale, the wing
 * tips (the wing-strike points) and the nose and tail strike points. The
 * wing's fore-and-aft station and the tail's are drawing-only numbers (the
 * flight model never reads them) and moved to where a 172 has them.
 */
import { hull, wing, roundNose, tubePath, turned, Batch } from './civil-kit.js';

export function buildSkylark(b) {
  const { S, m } = b;
  const tipX = S.wingRootX + S.halfSpan;
  const hub = [0, -0.02, -2.42];

  /* ---------------- Fuselage ---------------- */
  // Nose bowl to firewall, cabin under the wing, then a tail cone whose top
  // line barely falls while the belly climbs to meet it.
  //
  // The cowl falls away from the windscreen towards the spinner, as a 172's
  // does. It is also what the pilot looks over: the eye is 0.46 up, and with
  // the cowl top at 0.38 at the firewall the sight line over the nose was
  // 4 degrees down — so everything below that went into the closed hull,
  // where every face is culled, and the cockpit view showed a spinner
  // floating over the runway with no aeroplane around it. At 0.30 it is
  // 9 degrees, and the firewall bulkhead below fills the rest.
  //
  // The roof under the wing is the wing's own underside, as a 172's is: flat
  // and full-width from the windscreen's top to the trailing edge. It was a
  // rounded top that fell away 13 cm at the cabin's sides and ended at the
  // rear window 0.1 lower than the wing, so rays through the side of the
  // aeroplane between the cabin and the wing met nothing from 0.74 to 1.06
  // (a slot of sky 12 cm tall under the back of the wing) and from the front
  // there was a slot down each side of the roof: the wing floated on the
  // cabin. Measured by casting rays through the drawn model (civil.mjs,
  // "no daylight between the wing root and the body"); none now.
  // Behind the trailing edge the top falls away over the rear window.
  //
  // The tail cone was 0.24 m wide at the tailplane, a stick from above; it
  // is 0.32 now, and 4 cm deeper where the tail-strike line leaves room.
  const stations = [
    ...roundNose(-2.3, 0.42, { w: 0.43, top: 0.19, bot: -0.46, yc: -0.08, nT: 2.3, nB: 2.4 }, { y: -0.04 }, 5),
    { z: -1.55, w: 0.49, top: 0.24, bot: -0.53, yc: -0.06, nT: 2.4, nB: 2.6 },
    { z: -1.0, w: 0.53, top: 0.3, bot: -0.56, yc: -0.03, nT: 2.5, nB: 2.8 },
    { z: -0.72, w: 0.55, top: 0.53, bot: -0.57, yc: 0.02, nT: 2.8, nB: 3.0 },
    { z: -0.58, w: 0.555, top: 0.712, bot: -0.57, yc: 0.04, nT: 3.8, nB: 3.0 },
    { z: -0.42, w: 0.56, top: 0.705, bot: -0.57, yc: 0.05, nT: 5.0, nB: 3.0 },
    { z: 0.55, w: 0.55, top: 0.715, bot: -0.55, yc: 0.05, nT: 5.0, nB: 3.0 },
    { z: 1.1, w: 0.5, top: 0.735, bot: -0.5, yc: 0.06, nT: 4.0, nB: 2.8 },
    { z: 1.6, w: 0.43, top: 0.53, bot: -0.43, yc: 0.07, nT: 2.4, nB: 2.5 },
    { z: 2.3, w: 0.335, top: 0.41, bot: -0.32, yc: 0.08, nT: 2.2, nB: 2.3 },
    { z: 3.0, w: 0.24, top: 0.35, bot: -0.2, yc: 0.1, nT: 2.1, nB: 2.2 },
    { z: 3.7, w: 0.16, top: 0.315, bot: -0.06, yc: 0.13, nT: 2.0, nB: 2.1 },
    { z: 4.4, w: 0.085, top: 0.28, bot: 0.09, yc: 0.18, nT: 2.0, nB: 2.0 },
    { z: 4.62, w: 0.05, top: 0.26, bot: 0.14, yc: 0.2, nT: 2.0, nB: 2.0 },
  ];
  const h = hull({
    stations,
    radial: 10,
    maxStep: 0.34,
    lines: {
      ctr: 0.045, // the windscreen's centre strip
      ws: 1.02, // windscreen wraps round to the door posts
      roof: 0.5, // top edge of the side glass, under the wing
      belt: 1.5, // bottom edge of the side glass
    },
    windows: [
      { z0: -0.99, z1: -0.46, from: 'ctr', to: 'ws' },
      { z0: -0.4, z1: 0.3, from: 'roof', to: 'belt' },
      { z0: 0.36, z1: 0.92, from: 'roof', to: 'belt' },
      { z0: 1.14, z1: 1.62, from: 'top', to: 'roof' }, // the rear window, behind the wing
    ],
  });
  b.addHull(h);
  // The firewall, seen only from the cockpit (see civil-kit.js capAt).
  b.put(h.capAt(-1.02), m.dark);

  /* ---------------- Wing ---------------- */
  // Rectangular inboard, tapered outboard, the way a 172's is. Lofted right
  // across the cabin roof so the two halves meet on the centreline.
  const le0 = S.wingZ;
  const cR = S.rootChord;
  const cT = S.tipChord;
  const yAt = (s) => S.wingY + S.dihedral * Math.max(0, (s - S.wingRootX) / S.halfSpan);
  const sBreak = S.wingRootX + S.halfSpan * 0.42;
  const wingStations = [
    { s: 0, chord: cR, le: le0, y: S.wingY },
    { s: S.wingRootX, chord: cR, le: le0, y: S.wingY },
    { s: sBreak, chord: cR, le: le0, y: yAt(sBreak) },
    { s: tipX, chord: cT, le: le0 + S.sweep, y: yAt(tipX) },
  ];
  const cuts = [
    { name: 'flap', s0: S.wingRootX + 0.02, s1: sBreak - 0.05, hinge: 0.7 },
    { name: 'aileron', s0: sBreak + 0.1, s1: tipX - 0.45, hinge: 0.74 },
  ];
  for (const side of ['right', 'left']) {
    const w = wing({ frame: side, stations: wingStations, t: 0.125, m: 0.022, cuts, tipRound: 0.16 });
    b.put(w.fixed, m.body);
    b.addSurface('flap', w.surfaces.flap);
    b.addSurface(side === 'right' ? 'aileronR' : 'aileronL', w.surfaces.aileron);
  }

  /* Lift struts: one a side, streamlined, from the lower cabin to the
   * wing's front spar at 45% span — the one detail that says "Cessna". */
  const sStrut = S.wingRootX + S.halfSpan * 0.45;
  for (const side of [-1, 1]) {
    const zW = le0 + 0.27 * cR;
    const top = [side * sStrut, yAt(sStrut) - 0.05, zW];
    const zF = 0.05;
    const low = [side * (h.halfWidthAt(zF, -0.36) - 0.01), -0.36, zF];
    // Section 4.4 cm thick by 11 cm chord: `flat` stretches it fore and aft.
    b.put(tubePath([low, top], 0.022, 8, { flat: 2.6 }), m.body);
    // A small fairing where it meets the fuselage.
    b.put(turned([[0, -0.1], [0.06, -0.05], [0.07, 0.05], [0, 0.12]], 8, {}), m.body, { p: [side * (h.halfWidthAt(zF, -0.36) - 0.02), -0.36, zF] });
  }

  /* Wing-root fairing over the windscreen: the wing root's leading edge
   * blends into the cabin top rather than hanging out over it. */
  // (the hull's roof already meets the wing's underside at y 0.69)

  /* ---------------- Tail ---------------- */
  const tailBaseY = 0.3;
  const finLe = S.finZ;
  const finStations = [
    { s: -0.12, chord: 2.3, le: finLe - 1.05, y: 0 },
    { s: 0.02, chord: 2.05, le: finLe - 0.72, y: 0 },
    { s: 0.14, chord: S.finRootChord, le: finLe, y: 0 },
    { s: S.finHeight, chord: S.finRootChord * 0.46, le: finLe + S.finSweep, y: 0 },
  ];
  const fin = wing({
    frame: 'fin',
    origin: [0, tailBaseY, 0],
    stations: finStations,
    t: 0.1,
    m: 0,
    steps: 8,
    cuts: [{ name: 'rudder', s0: 0.14, s1: S.finHeight - 0.08, hinge: 0.58 }],
    tipRound: 0.08,
    uvV: [0.66, 0.98],
  });
  b.put(fin.fixed, m.tail);
  b.addSurface('rudder', fin.surfaces.rudder, m.tailMatte);

  const stabY = 0.21;
  const hStations = [
    { s: 0, chord: S.hRootChord, le: S.hZ, y: stabY },
    { s: S.hSpan, chord: S.hRootChord * 0.74, le: S.hZ + S.hRootChord * 0.12, y: stabY },
  ];
  for (const side of ['right', 'left']) {
    const st = wing({
      frame: side,
      stations: hStations,
      t: 0.1,
      m: 0,
      steps: 7,
      cuts: [{ name: 'elevator', s0: 0.16, s1: S.hSpan - 0.1, hinge: 0.58 }],
      tipRound: 0.1,
    });
    b.put(st.fixed, m.body);
    b.addSurface('elevator', st.surfaces.elevator);
  }

  /* Tail tie-down skid, down to the tail-strike point the flight model
   * uses, so a tail strike touches the thing that is drawn there. */
  const tailZ = 3.95 * S.bodyLength;
  b.put(
    tubePath([[0, h.botAt(tailZ - 0.25) + 0.02, tailZ - 0.25], [0, -0.1, tailZ - 0.02], [0, h.botAt(tailZ + 0.12) + 0.02, tailZ + 0.12]], 0.025, 6),
    m.metal
  );

  /* ---------------- Engine and cowl details ---------------- */
  // Two cooling-air inlets either side of the spinner, and the exhaust.
  for (const side of [-1, 1]) {
    b.put(turned([[0.001, -0.02], [0.075, 0], [0.075, 0.1]], 10, { closeEnds: true, yScale: 0.7 }), m.dark, { p: [side * 0.25, 0.1, -2.12] });
  }
  b.put(tubePath([[0.12, -0.5, -1.62], [0.13, -0.56, -1.42]], 0.035, 8), m.grey);
  // Air-filter scoop under the nose.
  b.put(turned([[0.001, -0.02], [0.07, 0], [0.07, 0.12]], 10, { closeEnds: true, yScale: 0.6 }), m.dark, { p: [0, -0.4, -2.05] });

  b.addProp({ at: hub, radius: 0.97, blades: 2, chord: 0.16, spinner: { r: 0.2, len: 0.36 }, dir: 1 });

  /* ---------------- Landing gear ---------------- */
  // Mains: flat spring-steel legs, spats over the wheels.
  const RM = 0.235;
  const RN = 0.2;
  for (const side of [-1, 1]) {
    const hubY = S.main.y + RM;
    const top = [side * 0.42, -0.5, S.main.z];
    // Spring steel: under load the leg bends up about its root, pant and all.
    const leg = b.addLeg({ pivot: top, name: 'main gear', swing: true });
    const axle = [side * S.main.x, hubY, S.main.z];
    leg.add(
      tubePath([[side * 0.38, -0.47, S.main.z], [side * 0.8, -0.84, S.main.z], [side * (S.main.x - 0.11), hubY + 0.02, S.main.z]], [0.026, 0.022, 0.018], 6, { flat: 2.6 }),
      m.body
    );
    b.addWheel(leg, axle, RM, 0.15);
    // Spat: a teardrop over the top of the wheel, open underneath. Its top
    // was 0.21 over the axle and the tyre's 0.235, so a black crescent of
    // tyre stuck up through the top of every wheel pant.
    leg.add(
      hull({
        stations: [
          ...roundNose(S.main.z - 0.36, 0.18, { w: 0.12, top: hubY + 0.26, bot: hubY - 0.1, yc: hubY + 0.04 }, { y: hubY + 0.02 }, 3),
          { z: S.main.z + 0.08, w: 0.125, top: hubY + 0.275, bot: hubY - 0.12, yc: hubY + 0.05 },
          { z: S.main.z + 0.46, w: 0.03, top: hubY + 0.12, bot: hubY + 0.02, yc: hubY + 0.07 },
        ],
        radial: 8,
        uvBand: 0.2,
        maxStep: 0.12,
      }).geometry,
      m.body,
      { p: [axle[0], 0, 0] }
    );
  }
  // Nose: an oleo under the firewall, with a spat of its own.
  {
    const hubY = S.nose.y + RN;
    const nz = S.nose.z;
    const leg = b.addLeg({ pivot: [0, -0.52, nz - 0.12], name: 'nose gear' });
    leg.add(tubePath([[0, -0.48, nz - 0.14], [0, hubY + 0.3, nz - 0.06]], 0.045, 8), m.metal);
    leg.add(tubePath([[0, hubY + 0.32, nz - 0.06], [0, hubY + 0.05, nz - 0.01]], 0.035, 8), m.metal);
    const wh = b.addWheel(leg, [0, hubY, nz], RN, 0.12, { steer: true });
    // Fork and spat ride with the steering. The fork's prongs and the tyre
    // both stood out of the top of a spat 0.19 tall over a 0.2 tyre; the
    // spat now closes over both and the strut enters it from above.
    const fork = tubePath([[-0.075, 0, 0], [-0.075, 0.17, -0.03], [0.075, 0.17, -0.03], [0.075, 0, 0]], 0.02, 6);
    const spat = hull({
      stations: [
        ...roundNose(-0.32, 0.16, { w: 0.115, top: 0.25, bot: -0.08, yc: 0.05, nT: 2.6 }, { y: 0.02 }, 3),
        { z: 0.04, w: 0.12, top: 0.27, bot: -0.1, yc: 0.05, nT: 2.6 },
        { z: 0.36, w: 0.03, top: 0.12, bot: 0.03, yc: 0.07 },
      ],
      radial: 8,
      uvBand: 0.2,
      maxStep: 0.12,
    }).geometry;
    new Batch('nose fork').add(fork, m.metal).add(spat, m.body).build(wh.holder);
  }

  /* ---------------- Lights ---------------- */
  const tipY = yAt(tipX);
  const tipZ = le0 + S.sweep + cT * 0.2;
  b.lamp('navL', [-tipX - 0.02, tipY, tipZ]);
  b.lamp('navR', [tipX + 0.02, tipY, tipZ]);
  b.lamp('strobeL', [-tipX - 0.02, tipY, tipZ + 0.1]);
  b.lamp('strobeR', [tipX + 0.02, tipY, tipZ + 0.1]);
  b.lamp('tail', [0, 0.36, 4.66]);
  b.lamp('beacon', [0, tailBaseY + S.finHeight + 0.04, finLe + S.finSweep + 0.3]);
  b.lamp('landing', [-2.3, yAt(2.3) - 0.02, le0 - 0.02]);

  return { spot: [-2.3, yAt(2.3) - 0.1, le0 - 0.2], hull: h };
}

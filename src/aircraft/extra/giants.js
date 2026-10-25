/**
 * The giants (owner, 2026-10-16: "bigger planes like the beluga"): the
 * Airbus BelugaXL, the Boeing 747 Dreamlifter, the Antonov An-225 and the
 * Lockheed C-5 Galaxy — drawn at full size in src/fleet/extra/giants.js.
 *
 * Same contract as ./jets.js (whose geometryFrom() these go through), with
 * three differences:
 *
 * 1. THE FUSELAGES ARE DRAWN BY HAND. None of these is a tube with a nose
 *    on: the Beluga is an A330's lower half under a cargo bubble nine metres
 *    across, the Dreamlifter a 747 whose upper deck swells into one, and the
 *    An-225 and the C-5 are high-wing freighters with blunt visor noses,
 *    gear pods and tails swept up for the ramp. Each table below is in
 *    metres, and the tail strike is still solved from it, across the upper
 *    loft as well as the lower.
 *
 * 2. THEY NEED A LONG RUNWAY, on purpose. The airliners before them are
 *    tuned to the 1,100 m Kestrel strip; these have a quarter more wing
 *    loading (about 250 kg/m²), a thrust-to-weight of 0.26 where the
 *    airliners have 0.36, and the drag of a barn, so they roll about a
 *    kilometre before they fly, are 15 m up after a kilometre and a half,
 *    and want Gateway International's 3,800 m (or the air base's 3,200,
 *    Northwatch's 3,000). `minRunway` says so: on a map whose main runway
 *    is shorter, the spawner starts them in the air offshore instead of on a
 *    stand they could never leave (src/world/spawns.js candidatesFor), and
 *    src/features/giants.js says where the long runways are.
 *
 *    Why not the real 150-kt approach speeds: physics.js grades any
 *    touchdown faster than 62 m/s (120 kt) over the ground as a crash, "Way
 *    too fast for a landing". So the stall speed stays near the airliners'
 *    (about 80 kt with full flap, an approach at 104) and the length of the
 *    runway they need comes from the acceleration they do not have.
 *
 * 3. THE STALL GUARD SITS LOWER. Their bodies run 35-40 m behind the main
 *    wheels, so the tail meets the runway at 11.5-12.5 degrees however the
 *    tail cone is drawn; alphaStall 0.19-0.20 holds the simplified mode's
 *    rotation near 8.5-9 degrees (it stops pulling at alphaStall - 0.045),
 *    with CL0 raised to give back the lift.
 *
 * Mass is still the flight model's number, not the brochure's: the
 * undercarriage caps every leg at 160 kN (physics.js), so 26-28 t, with the
 * span, length and inertia proportions of the real thing.
 *
 * Looks: original. The Beluga's smiling-whale face is a generic idea painted
 * our own way; no Airbus, Boeing, Antonov or Lockheed logo, emblem or
 * trademark lettering appears anywhere. The C-5 is a military transport and
 * sits behind the military passcode like every other military type.
 */
import { AIRLINER_GEOMETRY, AIRLINER_DOORS, planFrom, shapeFrom } from './airliners.js';
import { stretchNose, NOSES, station as st } from './jet-shapes.js';
import { geometryFrom, jet } from './jets.js';

/* ------------------------------------------------------------------ *
 * The fuselages
 * ------------------------------------------------------------------ */

/**
 * BelugaXL. The lower lobe is an A330's (5.64 m round), its nose the Airbus
 * nose stretched to that size; above it, a cargo bubble 8.9 m across whose
 * front rises like a forehead straight off the top of the flight deck
 * glazing, and whose tail carries the fin.
 */
function belugaFuselage() {
  const n = stretchNose(NOSES.airbus, { z0: -25.98, len: 8.85, R: 2.82, T: 2.82, B: -2.82 });
  const stations = [
    ...n.stations,
    st(7.0, 2.82, -2.82, 2.82, 0),
    st(13.0, 2.82, -2.1, 2.7, 0.36),
    st(19.0, 2.82, -1.1, 2.45, 0.86),
    st(25.0, 2.9, 0.1, 2.0, 1.5),
    st(30.0, 3.2, 1.6, 1.3, 2.4),
    st(33.5, 3.55, 2.9, 0.5, 3.22),
    st(34.5, 3.4, 3.2, 0.1, 3.3),
  ];
  const bubble = [
    st(-21.7, 2.35, 1.55, 0.0, 1.95),
    st(-21.55, 2.85, 1.25, 0.9, 2.05, 2.0, 2.0),
    st(-21.0, 3.75, 0.85, 1.85, 2.3, 2.0, 2.0),
    st(-20.0, 5.0, 0.3, 2.85, 2.7, 2.05, 2.0),
    st(-18.6, 6.15, -0.2, 3.6, 3.05, 2.1, 2.0),
    st(-16.6, 7.2, -0.6, 4.1, 3.35, 2.1, 2.0),
    st(-14.0, 7.95, -0.85, 4.38, 3.55, 2.1, 2.0),
    st(-10.5, 8.2, -0.92, 4.45, 3.62, 2.1, 2.0),
    st(8.0, 8.2, -0.92, 4.45, 3.62, 2.1, 2.0),
    st(16.0, 8.0, -0.2, 4.2, 3.9, 2.1, 2.0),
    st(24.0, 7.4, 1.2, 3.4, 4.3),
    st(30.0, 6.6, 2.5, 2.4, 4.6),
    st(34.2, 5.7, 3.4, 1.3, 4.6),
    st(36.6, 5.0, 4.05, 0.45, 4.55),
    st(37.12, 4.65, 4.45, 0.08, 4.55),
  ];
  return { stations, bubble, panes: n.panes, eye: n.eye, radomeZ: n.radomeZ, k: n.k, tailZ: 37.12 };
}

/**
 * The Dreamlifter: the 747-400's main tube exactly (the table in
 * src/fleet/extra/airliners.js), and its upper deck's flight-deck front,
 * from which the cargo section swells to 8.5 m across and 6.4 m above the
 * centreline, running back over the tail to the swing-tail's end.
 */
function dreamlifterFuselage() {
  const ell = (z, rx, ry, cy) => st(z, cy + ry, cy - ry, rx, cy);
  const stations = [
    st(-31.1, -0.95, -0.95, 0.0, -0.95),
    st(-31.04, -0.6, -1.27, 0.38, -0.95),
    st(-30.92, -0.3, -1.55, 0.72, -0.95),
    st(-30.6, 0.2, -1.95, 1.25, -0.95),
    st(-30.1, 0.85, -2.35, 1.78, -0.92),
    st(-29.4, 1.55, -2.7, 2.25, -0.85),
    st(-28.5, 2.2, -2.98, 2.66, -0.72),
    st(-27.3, 2.78, -3.17, 2.98, -0.52),
    st(-26.0, 3.12, -3.26, 3.16, -0.28),
    st(-24.6, 3.28, -3.3, 3.24, -0.06),
    st(-23.4, 3.3, -3.3, 3.25, 0),
    st(11.0, 3.3, -3.3, 3.25, 0),
    st(16.0, 3.3, -2.55, 3.12, 0.4),
    st(22.0, 3.3, -1.35, 2.75, 1.0),
    ell(28.0, 2.12, 1.72, 1.58),
    ell(33.5, 1.4, 1.08, 2.2),
    ell(37.6, 0.72, 0.55, 2.62),
    ell(39.5, 0.14, 0.14, 2.8),
  ];
  const bubble = [
    st(-30.35, 0.5, 0.4, 0.0, 0.45),
    st(-30.15, 1.02, 0.3, 0.6, 0.7, 2, 1.6),
    st(-29.8, 1.65, 0.35, 1.12, 1.15, 2, 1.6),
    st(-29.3, 2.4, 0.5, 1.55, 1.75, 2, 1.6),
    st(-28.85, 2.98, 0.65, 1.82, 2.25, 2.1, 1.6),
    st(-28.62, 3.2, 0.75, 1.92, 2.45, 2.1, 1.6),
    st(-28.05, 3.95, 0.85, 2.08, 2.95, 2.2, 1.7),
    st(-27.5, 4.33, 0.95, 2.16, 3.05, 2.2, 1.8),
    st(-26.6, 4.66, 1.0, 2.21, 3.0, 2.2, 1.9),
    st(-25.4, 4.82, 1.0, 2.22, 2.95, 2.1, 2),
    st(-24.4, 4.9, 0.95, 2.3, 2.93, 2.1, 2),
    st(-21.8, 5.55, 0.55, 2.85, 2.95, 2.1, 2.0),
    st(-18.0, 6.35, -0.15, 3.6, 2.9, 2.15, 2.0),
    st(-13.0, 6.9, -0.7, 4.12, 2.78, 2.2, 2.0),
    st(-7.5, 7.08, -0.95, 4.28, 2.7, 2.2, 2.0),
    st(17.0, 7.08, -0.95, 4.28, 2.7, 2.2, 2.0),
    st(23.5, 6.85, 0.1, 3.95, 3.1),
    st(29.5, 6.3, 1.7, 3.05, 3.65),
    st(34.8, 5.4, 2.85, 1.95, 3.95),
    st(38.6, 4.45, 3.45, 0.95, 3.9),
    st(40.58, 4.0, 3.72, 0.15, 3.86),
  ];
  const panes = [
    { name: 'Windscreen', wiper: true, corners: [{ z: -28.72, x: 0.07 }, { z: -28.52, y: 3.18 }, { z: -28.06, y: 3.82 }, { z: -28.14, x: 0.07 }] },
    { name: 'Second side window', corners: [{ z: -28.42, y: 3.18 }, { z: -27.55, y: 3.25 }, { z: -27.62, y: 3.95 }, { z: -27.96, y: 3.84 }] },
    { name: 'Rear side window', corners: [{ z: -27.45, y: 3.26 }, { z: -26.85, y: 3.3 }, { z: -27.0, y: 3.9 }, { z: -27.42, y: 3.98 }] },
  ];
  return { stations, bubble, panes, eye: [-0.55, 3.55, -27.4], radomeZ: -29.7, k: 1.65, tailZ: 40.58 };
}

/**
 * An-225: a blunt round nose that is a cargo door (it lifts), the flight
 * deck high on its crown, an upper deck behind it under a high wing, gear
 * pods along the belly, and a long tail cone swept up for the rear door.
 */
function an225Fuselage() {
  const stations = [
    st(-36.0, 0.0, 0.0, 0.0, 0.0),
    st(-35.95, 0.55, -0.5, 0.6, 0.0),
    st(-35.8, 1.0, -1.0, 1.12, 0.0),
    st(-35.4, 1.62, -1.72, 1.82, 0.0),
    st(-34.8, 2.18, -2.32, 2.42, 0.05),
    st(-34.0, 2.62, -2.8, 2.9, 0.12, 2.0, 2.2),
    st(-33.0, 3.02, -3.15, 3.25, 0.2, 2.0, 2.4),
    st(-32.0, 3.5, -3.36, 3.45, 0.28, 2.05, 2.5),
    st(-30.8, 3.95, -3.46, 3.56, 0.34, 2.1, 2.6),
    st(-29.0, 4.22, -3.5, 3.6, 0.38, 2.1, 2.6),
    st(-27.0, 4.3, -3.5, 3.6, 0.4, 2.1, 2.6),
    st(12.0, 4.3, -3.5, 3.6, 0.4, 2.1, 2.6),
    st(18.0, 4.3, -2.6, 3.5, 0.75, 2.1, 2.4),
    st(24.0, 4.28, -1.3, 3.2, 1.3, 2.1, 2.2),
    st(30.0, 4.2, 0.0, 2.75, 1.95, 2.05, 2.0),
    st(36.0, 4.08, 1.25, 2.15, 2.55),
    st(42.0, 3.95, 2.45, 1.3, 3.1),
    st(46.0, 3.84, 3.18, 0.55, 3.42),
    st(48.0, 3.74, 3.56, 0.08, 3.62),
  ];
  // Every side corner sits at least 0.12 m below the crown at its station:
  // a corner given above the skin has nowhere to go but the top centreline,
  // and the pane folds into a zig-zag (seen in the game, 2026-10-16).
  const panes = [
    // The windscreen's inboard corners run further up and down the forehead
    // than its outboard ones: cut only between the side corners, the glass in
    // front of the captain (x -0.65) was 15 cm tall between its frames, and
    // his eye line met the frame, not the sky (the wave-8 cockpit check).
    { name: 'Windscreen', wiper: true, corners: [{ z: -34.15, x: 0.08 }, { z: -33.7, y: 2.35 }, { z: -32.95, y: 2.85 }, { z: -32.75, x: 0.08 }] },
    { name: 'Side window', corners: [{ z: -33.5, y: 2.4 }, { z: -32.3, y: 2.6 }, { z: -32.35, y: 3.12 }, { z: -32.85, y: 2.95 }] },
    { name: 'Rear side window', corners: [{ z: -32.15, y: 2.65 }, { z: -31.35, y: 2.8 }, { z: -31.45, y: 3.4 }, { z: -32.15, y: 3.25 }] },
  ];
  // The eye 5 cm lower and 45 cm nearer the glass than first drawn: it sat
  // at the windscreen's top (the overhead hung into the top third of the
  // picture); 13 degrees of sky and 10 of nose-drop now (wave-8 cockpit check).
  return { stations, panes, eye: [-0.65, 2.87, -32.35], radomeZ: -34.4, k: 1.8, tailZ: 48.0 };
}

/** C-5: a rounded visor nose, the flight deck above the cargo floor, gear pods, a ramp tail under a T-tail. */
function c5Fuselage() {
  const stations = [
    st(-30.5, -0.3, -0.3, 0.0, -0.3),
    st(-30.44, 0.25, -0.85, 0.6, -0.3),
    st(-30.25, 0.8, -1.45, 1.2, -0.3),
    st(-29.8, 1.45, -2.1, 1.85, -0.28),
    st(-29.1, 2.05, -2.65, 2.45, -0.22),
    st(-28.2, 2.55, -3.0, 2.9, -0.12, 2.0, 2.2),
    st(-27.1, 3.0, -3.25, 3.22, 0.0, 2.0, 2.4),
    st(-26.0, 3.45, -3.36, 3.4, 0.1, 2.05, 2.5),
    st(-24.6, 3.85, -3.4, 3.48, 0.18, 2.1, 2.6),
    st(-22.8, 4.12, -3.4, 3.5, 0.24, 2.1, 2.6),
    st(-21.0, 4.2, -3.4, 3.5, 0.25, 2.1, 2.6),
    st(9.0, 4.2, -3.4, 3.5, 0.25, 2.1, 2.6),
    st(15.0, 4.2, -2.3, 3.4, 0.7, 2.1, 2.3),
    st(21.0, 4.2, -1.0, 3.15, 1.3, 2.1, 2.1),
    st(27.0, 4.15, 0.3, 2.7, 2.0, 2.05, 2.0),
    st(33.0, 4.1, 1.6, 2.1, 2.6),
    st(39.0, 4.05, 2.8, 1.25, 3.2),
    st(42.8, 4.0, 3.48, 0.6, 3.52),
    st(44.81, 3.96, 3.84, 0.1, 3.88),
  ];
  // As the An-225's: every side corner below the crown at its station.
  const panes = [
    // Inboard corners further up and down the forehead, as the An-225's.
    { name: 'Windscreen', wiper: true, corners: [{ z: -28.7, x: 0.08 }, { z: -28.25, y: 2.1 }, { z: -27.5, y: 2.65 }, { z: -27.3, x: 0.08 }] },
    { name: 'Side window', corners: [{ z: -28.05, y: 2.15 }, { z: -27.0, y: 2.35 }, { z: -27.05, y: 2.85 }, { z: -27.45, y: 2.72 }] },
    { name: 'Rear side window', corners: [{ z: -26.9, y: 2.38 }, { z: -26.2, y: 2.48 }, { z: -26.25, y: 3.0 }, { z: -26.9, y: 2.92 }] },
  ];
  // The eye 5 cm lower and 30 cm nearer the glass than first drawn: the
  // windscreen's top was a degree over the eye line; 14 degrees of sky and
  // 10 of nose-drop now (the wave-8 cockpit check).
  return { stations, panes, eye: [-0.62, 2.65, -26.9], radomeZ: -29.3, k: 1.75, tailZ: 44.81 };
}

/*
 * The descriptions, as ./jets.js's DESC but with the fuselage given. The
 * tail-strike line is solved over the lower loft and the upper one.
 */
const BELUGA = belugaFuselage();
const LCF = dreamlifterFuselage();
const MRIYA = an225Fuselage();
const GALAXY = c5Fuselage();

const DESC = {
  belugaxl: {
    span: 60.3,
    fuselage: BELUGA,
    lofts: [BELUGA.bubble],
    bottom: -2.82,
    ground: -5.0,
    nose: { z: -20.68, r: 0.51 },
    main: { x: 5.345, z: 1.5, r: 0.69 },
    tip: { x: 29.6, y: 0.4 },
    wingZ: -8.0,
    engines: [{ x: 9.37, y: -2.8, z: -7.0, r: 1.5, length: 5.8 }],
  },
  dreamlifter: {
    span: 64.44,
    fuselage: LCF,
    lofts: [LCF.bubble],
    bottom: -3.3,
    ground: -5.9,
    nose: { z: -23.4, r: 0.58 },
    main: { x: 5.5, z: 2.4, r: 0.62 },
    tip: { x: 31.35, y: 1.35 },
    wingZ: -12.57,
    engines: [
      { x: 11.9, y: -3.05, z: -5.9, r: 1.35, length: 4.6 },
      { x: 21.15, y: -1.74, z: 1.82, r: 1.35, length: 4.6 },
    ],
  },
  an225: {
    span: 88.4,
    fuselage: MRIYA,
    bottom: -3.5,
    ground: -5.0,
    nose: { z: -28.0, r: 0.62 },
    // The physics pivots on the rearmost axle of the seven-axle rows: the
    // An-225 rotates on its back wheels, and that is what keeps its 40 m of
    // tail off the runway.
    main: { x: 3.9, z: 8.0, r: 0.62 },
    tip: { x: 44.2, y: 1.4 },
    wingZ: -9.0,
    engines: [
      { x: 9.6, y: 0.95, z: -6.2, r: 1.25, length: 5.4 },
      { x: 15.8, y: 0.7, z: -2.4, r: 1.25, length: 5.4 },
      { x: 22.2, y: 0.45, z: 1.6, r: 1.25, length: 5.4 },
    ],
  },
  c5: {
    span: 67.89,
    fuselage: GALAXY,
    bottom: -3.4,
    ground: -4.7,
    nose: { z: -22.0, r: 0.6 },
    // As the An-225: on the rearmost axle of the aft bogies.
    main: { x: 5.7, z: 5.0, r: 0.6 },
    tip: { x: 33.9, y: 0.9 },
    wingZ: -6.5,
    engines: [
      { x: 11.5, y: 0.82, z: -4.0, r: 1.38, length: 5.5 },
      { x: 18.7, y: 0.4, z: -0.4, r: 1.38, length: 5.5 },
    ],
  },
};

export const GIANT_GEOMETRY = Object.fromEntries(Object.entries(DESC).map(([id, d]) => [id, geometryFrom(d)]));
/* The upper lofts, for the models (the bubble is a second skin, as the 747's hump is). */
GIANT_GEOMETRY.belugaxl.bubble = BELUGA.bubble;
GIANT_GEOMETRY.dreamlifter.bubble = LCF.bubble;

Object.assign(AIRLINER_GEOMETRY, GIANT_GEOMETRY);

/**
 * Every door of each model as drawn, in metres in the aeroplane's frame — the
 * AIRLINER_DOORS format (./airliners.js has the field list): for the
 * evacuation (passengers out of these, crew, then you), the jet bridges and
 * the stair trucks. Measured off the built models, not typed in;
 * tests/features/new-aircraft.mjs rebuilds every one and fails if the table
 * and the drawing are 2 cm apart anywhere.
 *
 * The freighters carry crew, not passengers: one crew door each side, and
 * `freighter: true` on the roster entry says there is no cabin to empty.
 */
export const GIANT_DOORS = {
  belugaxl: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -2.802, y: 0, z: -19, w: 0.8, h: 1.7, sill: -0.85, normal: [-0.999,0.04,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 2.802, y: 0, z: -19, w: 0.8, h: 1.7, sill: -0.85, normal: [0.999,0.04,0] },
  ],
  dreamlifter: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -3.218, y: 0.465, z: -22.3, w: 1.07, h: 1.93, sill: -0.5, normal: [-0.99,0.139,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 3.218, y: 0.465, z: -22.3, w: 1.07, h: 1.93, sill: -0.5, normal: [0.99,0.139,0] },
  ],
  an225: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -3.459, y: -1.2, z: -25, w: 0.9, h: 1.8, sill: -2.1, normal: [-0.973,-0.23,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 3.459, y: -1.2, z: -25, w: 0.9, h: 1.8, sill: -2.1, normal: [0.973,-0.23,0] },
  ],
  c5: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -3.415, y: -1, z: -19.5, w: 0.9, h: 1.8, sill: -1.9, normal: [-0.984,-0.177,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 3.415, y: -1, z: -19.5, w: 0.9, h: 1.8, sill: -1.9, normal: [0.984,-0.177,0] },
  ],
};
Object.assign(AIRLINER_DOORS, GIANT_DOORS);

/** What the giants share in the flight model: the jets' set, a lower stall guard and more lift at zero alpha (see 3. above), and more drag. */
const GIANT = { CL0: 0.46, alphaStall: 0.2, CD0: 0.028, k: 0.04 };

export function TYPES(base) {
  const G = GIANT_GEOMETRY;
  return [
    /* ---------------------------------------------------------------- *
     * BelugaXL: the whale.
     * ---------------------------------------------------------------- */
    {
      id: 'belugaxl',
      name: 'Airbus BelugaXL',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: true,
      freighter: true,
      cockpit: 'big-jet',
      minRunway: 2000,
      blurb:
        'The flying whale: an airliner\'s nose and wings under a cargo bubble nearly nine metres across, ' +
        'built to carry whole aeroplane wings in one piece. It needs a long runway and a gentle hand — ' +
        'and it smiles the whole time.',
      stats: { speed: 2, handling: 1, ease: 2 },
      livery: '#f2f5f8',
      accent: '#1d78c8',
      callsign: 'Island whale heavy',
      price: 2400,
      why: 'Carries wings inside its own body',
      takeoffFlaps: 2,
      plan: planFrom(G.belugaxl),
      shape: shapeFrom(G.belugaxl, base, {
        radius: 2.82, wingRootX: 2.8, rootChord: 8.4, tipChord: 1.65, sweep: 15.4, rootY: -2.0,
        hSpan: 8.6, hRootChord: 6.0, hZ: 25.5, finHeight: 6.9, finRootChord: 9.5, finSweep: 6.4, finZ: 24.5,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.belugaxl, {
        ...GIANT,
        mass: 26000, wingArea: 104, wingSpan: 60.3, chord: 7.3,
        Clda: 0.1, Cmq: -34.0,
        thrustMax: 66000, fuelCapacity: 15000, fuelBurnMax: 0.7,
        gearDragArea: 3.2, maxGearSpeed: 120, vne: 170,
        ceiling: 35000, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },

    /* ---------------------------------------------------------------- *
     * 747 Dreamlifter: a jumbo with a hold for aeroplane parts.
     * ---------------------------------------------------------------- */
    {
      id: 'dreamlifter',
      name: 'Boeing 747 Dreamlifter',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: true,
      freighter: true,
      cockpit: 'big-jet',
      minRunway: 2000,
      blurb:
        'A 747 blown up like a balloon behind its flight deck, so whole fuselage sections fit inside — ' +
        'the tail swings open to load them. Four engines, eighteen wheels, and a lot of air to push: ' +
        'give it the whole runway.',
      stats: { speed: 3, handling: 1, ease: 2 },
      livery: '#f3f5f7',
      accent: '#163f6e',
      callsign: 'Island heavy lift',
      price: 2600,
      why: 'A jumbo with a hold for aeroplanes',
      takeoffFlaps: 2,
      plan: planFrom(G.dreamlifter),
      shape: shapeFrom(G.dreamlifter, base, {
        radius: 3.25, wingRootX: 2.45, rootChord: 13.78, tipChord: 3.6, sweep: 24.25, rootY: -2.1,
        hSpan: 11.1, hRootChord: 7.4, hZ: 28.8, finHeight: 9.3, finRootChord: 13.0, finSweep: 11.0, finZ: 25.0,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.dreamlifter, {
        ...GIANT,
        mass: 28000, wingArea: 112, wingSpan: 64.44, chord: 8.3,
        Clda: 0.1,
        thrustMax: 72000, fuelCapacity: 20000, fuelBurnMax: 0.9,
        gearDragArea: 3.4, maxGearSpeed: 120, vne: 175,
        ceiling: 40000, // service ceiling, ft (about; Boeing gives none); above it the air thins faster (physics.js ceilingFactor)
      }),
    },

    /* ---------------------------------------------------------------- *
     * An-225 Mriya: the biggest aeroplane there ever was.
     * ---------------------------------------------------------------- */
    {
      id: 'an225',
      name: 'Antonov An-225 Mriya',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: true,
      freighter: true,
      cockpit: 'big-jet',
      minRunway: 2000,
      blurb:
        'The biggest aeroplane ever built: six engines, a wing eighty-eight metres across, a twin tail ' +
        'and thirty-two wheels. It once carried a space shuttle on its back. Everything it does, it ' +
        'does slowly — start the turn early and use every metre of the runway.',
      stats: { speed: 2, handling: 1, ease: 1 },
      livery: '#f1f3f6',
      accent: '#2c5aa0',
      callsign: 'Island giant heavy',
      price: 3200,
      why: 'The biggest aeroplane ever built',
      takeoffFlaps: 2,
      plan: planFrom(G.an225),
      shape: shapeFrom(G.an225, base, {
        radius: 3.6, wingRootX: 1.5, rootChord: 15.0, tipChord: 4.2, sweep: 26.7, rootY: 4.0,
        hSpan: 15.7, hRootChord: 8.5, hZ: 37.0, finHeight: 9.0, finRootChord: 7.6, finSweep: 3.2, finZ: 40.6,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.an225, {
        ...GIANT,
        alphaStall: 0.19,
        CL0: 0.48,
        mass: 28000, wingArea: 113, wingSpan: 88.4, chord: 10.5,
        Clda: 0.14,
        thrustMax: 74000, fuelCapacity: 24000, fuelBurnMax: 1.0,
        gearDragArea: 4.2, maxGearSpeed: 115, vne: 165,
        ceiling: 36000, // service ceiling, ft (11,000 m, published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },

    /* ---------------------------------------------------------------- *
     * C-5 Galaxy: the military airlifter (behind the passcode).
     * ---------------------------------------------------------------- */
    {
      id: 'c5',
      name: 'Lockheed C-5 Galaxy',
      class: 'Airliner',
      category: 'military',
      military: true,
      // Military, not a combat jet: carrier/who.js isMilitary() is false for a
      // transport, so it gets no carrier start, no hook, no guns, no missiles.
      transport: true,
      longHaul: true,
      freighter: true,
      cockpit: 'big-jet',
      minRunway: 2000,
      blurb:
        'The air force\'s giant: a nose that lifts up and a ramp at the back so trucks drive straight ' +
        'through, a T-tail as tall as a six-storey building and twenty-eight wheels. Heavy and steady — ' +
        'it flies like a building would.',
      stats: { speed: 2, handling: 1, ease: 2 },
      livery: '#6e747b', // the same airlifter grey as the C-17
      accent: '#4d555d',
      callsign: 'Galaxy zero five',
      price: 2800,
      why: 'Trucks drive straight through it',
      takeoffFlaps: 2,
      plan: planFrom(G.c5),
      shape: shapeFrom(G.c5, base, {
        radius: 3.5, wingRootX: 1.5, rootChord: 11.0, tipChord: 3.6, sweep: 16.5, rootY: 4.0,
        hSpan: 10.2, hRootChord: 5.8, hZ: 37.3, finHeight: 11.1, finRootChord: 11.0, finSweep: 7.0, finZ: 30.0,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.c5, {
        ...GIANT,
        mass: 27000, wingArea: 108, wingSpan: 67.89, chord: 9.4,
        Clda: 0.11,
        thrustMax: 69000, fuelCapacity: 20000, fuelBurnMax: 0.85,
        gearDragArea: 3.6, maxGearSpeed: 120, vne: 170,
        ceiling: 35700, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },
  ];
}


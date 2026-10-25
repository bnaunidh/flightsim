/**
 * Popular airliners (owner, 2026-10-16: "add popular planes and bigger
 * planes like the beluga"): the Boeing 737 MAX 8, the Airbus A321neo, the
 * Boeing 787-9, the Airbus A350-900, the Boeing 777-300ER, the De
 * Havilland Dash 8 Q400 and Concorde — drawn at full size in
 * src/fleet/extra/jets.js.
 * The giants are ./giants.js.
 *
 * Same contract as ./airliners.js, whose helpers these use: a function of
 * `base` (TRAINER_SHAPE and TRAINER_AERO) returning roster entries, and one
 * set of measurements in metres (JET_GEOMETRY) that both the flight model's
 * `shape` and the drawing are derived from. What is new is where the
 * measurements come from: the fuselage is generated from a short description
 * (./jet-shapes.js), and the tail-strike point is solved from the drawn
 * underside rather than typed in beside it.
 *
 * THE HONEST PART, as for the three before them. The real aeroplanes weigh
 * 60 to 350 tonnes; these fly as lightly loaded versions of themselves — the
 * real span, length and proportions, inertia per kilogram from the same
 * radii of gyration, the Meridian's wing loading (about 200 kg/m²) — so all
 * six take off and land on the 1,100 m Kestrel strip like the A320, the 747
 * and the A380 do. Heavier ones take longer to roll, to answer and to stop.
 *
 * WHAT THE OTHER FILES READ OFF AN ENTRY (beyond the usual roster fields):
 *   price, why      the hangar's sale row (src/features/airliners.js)
 *   takeoffFlaps    the flap set for a flight that starts on the ground
 *   cockpit         a hint for the cockpit framework: 'big-jet' | 'jet' |
 *                   'turboprop' (cockpits-v2); `class: 'Airliner'` is the
 *                   default every cockpit builder already understands
 *   minRunway       metres of runway a giant needs (./giants.js) — none here
 *
 * The geometry is registered into AIRLINER_GEOMETRY and the door table into
 * AIRLINER_DOORS (./airliners.js) when this module loads, so everything that
 * asks "is this an airliner, how long is it, where are its doors" — the
 * camera stretch and the seat panel (src/features/airliners.js), the
 * evacuation, the jet bridges — knows these without being edited.
 */
import { AIRLINER_GEOMETRY, AIRLINER_DOORS, planFrom, shapeFrom, inertias } from './airliners.js';
import { fuselage, strikeAngle, tailStrikeZ } from './jet-shapes.js';

/** Starboard engines mirrored to port, as in ./airliners.js. */
const pair = (list) => [...list.map((e) => ({ ...e, x: -e.x })), ...list];

/*
 * The descriptions. Real figures (manufacturers' published dimensions) for
 * length, span, fuselage section, wheelbase, track and tyre sizes; the
 * position of the centre of gravity is a choice — just ahead of the main
 * wheels, where every airliner's is — and everything else is placed from it.
 *
 *   body       the fuselage (./jet-shapes.js fuselage())
 *   ground     tyre contact height below the centreline
 *   nose/main  gear contact z and tyre radius (main.x: half the track)
 *   tip        the wing tip (where a winglet, sharklet or rake starts)
 *   wingZ      the wing root's leading edge
 *   engines    starboard ones; mirrored
 */
const DESC = {
  b737: {
    span: 35.92,
    body: { noseZ: -19.1, length: 39.52, R: 1.88, T: 2.0, B: -2.0, nose: { style: 'boeing', len: 6.4 }, tail: { style: 'narrow', start: 5.0 } },
    ground: -3.6,
    nose: { z: -14.6, r: 0.345 },
    main: { x: 2.86, z: 1.0, r: 0.57 },
    tip: { x: 17.25, y: 0.17 },
    wingZ: -4.2,
    engines: [{ x: 4.85, y: -2.09, z: -3.4, r: 1.1, length: 3.6 }], // LEAP-1B: a 1.76 m fan in a 2.2 m cowl, 0.4 m off the ground
    // Over the Boeing nose's own eye (12 cm higher, 1 cm nearer the glass):
    // the glareshield's sill cut the view 8 degrees under the horizon, where
    // a 3-degree approach puts the runway; 14.5 now, with 15.5 of sky above.
    // No nearer: 15 cm nearer (and 10 higher) gave 15.5 of nose-drop but
    // put the screens, which hang under the sill, half out of the bottom of
    // the default view (cockpits.mjs holds them in it).
    eye: [-0.5, 0.8, -15.66],
  },
  a321: {
    span: 35.8,
    body: { noseZ: -20.8, length: 44.51, R: 1.975, T: 2.07, B: -2.07, nose: { style: 'airbus', len: 6.2 }, tail: { style: 'narrow', start: 5.7 } },
    ground: -4.05,
    nose: { z: -15.6, r: 0.39 },
    main: { x: 3.795, z: 1.3, r: 0.6 },
    tip: { x: 17.05, y: -0.1 },
    wingZ: -3.42,
    engines: [{ x: 5.75, y: -2.35, z: -2.2, r: 1.24, length: 3.9 }], // LEAP-1A / PW1100G: a 2 m fan in a 2.5 m cowl
  },
  b787: {
    span: 60.12,
    body: { noseZ: -30.56, length: 62.81, R: 2.885, T: 2.985, B: -2.985, nose: { style: 'smooth', len: 9.3 }, tail: { style: 'wide', start: 9.0 } },
    ground: -5.0,
    nose: { z: -24.26, r: 0.51 },
    main: { x: 4.915, z: 1.6, r: 0.635 },
    tip: { x: 30.06, y: 1.65 },
    wingZ: -7.4,
    engines: [{ x: 9.7, y: -2.6, z: -6.1, r: 1.76, length: 5.6 }], // GEnx: a 2.82 m fan in a 3.5 m cowl (r 1.65 drew it a size small)
  },
  a350: {
    span: 64.75,
    body: { noseZ: -33.6, length: 66.8, R: 2.98, T: 3.045, B: -3.045, nose: { style: 'smooth', len: 9.6 }, tail: { style: 'wide', start: 10.2 } },
    ground: -5.3,
    nose: { z: -27.0, r: 0.525 },
    main: { x: 5.3, z: 1.7, r: 0.635 },
    tip: { x: 31.0, y: 1.1 },
    wingZ: -8.3,
    engines: [{ x: 10.25, y: -2.75, z: -7.2, r: 1.85, length: 6.1 }],
  },
  b777: {
    span: 64.8,
    body: { noseZ: -35.72, length: 73.86, R: 3.095, T: 3.1, B: -3.1, nose: { style: 'airbus', len: 9.6 }, tail: { style: 'wide', start: 10.0 } },
    ground: -5.8,
    nose: { z: -29.42, r: 0.546 },
    main: { x: 5.485, z: 1.8, r: 0.66 },
    tip: { x: 32.4, y: 1.0 },
    wingZ: -8.7,
    engines: [{ x: 9.66, y: -2.95, z: -7.9, r: 1.95, length: 6.8 }],
  },
  q400: {
    span: 28.42,
    body: { noseZ: -15.54, length: 32.83, R: 1.345, T: 1.42, B: -1.42, nose: { style: 'boeing', len: 4.6 }, tail: { style: 'narrow', start: 3.0 } },
    ground: -2.95,
    nose: { z: -12.94, r: 0.33 },
    main: { x: 4.39, z: 1.0, r: 0.45 },
    tip: { x: 14.21, y: 2.13 },
    wingZ: -2.3,
    // Turboprops: the propeller plane is z, the nacelle runs back from it.
    engines: [{ x: 4.39, y: 0.75, z: -4.6, r: 0.62, length: 6.2, prop: 2.055, blades: 6 }],
    // Over the stretched Boeing nose's eye, 8 cm higher and 10 cm further
    // back: its panes shrink with the fuselage (72 % of a 737's) but the
    // pilot does not, and the sill's frame cut the view 7.5 degrees under the
    // horizon; 11.5 now, 12 of sky above. Further back than the template so
    // the screens, 38 cm in front of the eye there, stay in the default view.
    eye: [-0.358, 0.56, -12.96],
  },
  // Hand-drawn (see concordeFuselage below): the main hull starts at the
  // droop-nose hinge; the needle nose ahead of it is its own loft that tilts.
  concorde: {
    span: 25.6,
    fuselage: null, // filled in below, before geometryFrom runs
    bottom: -1.66,
    ground: -5.0,
    nose: { z: -14.7, r: 0.45 },
    main: { x: 3.86, z: 3.5, r: 0.6 },
    tip: { x: 12.8, y: -1.45 },
    wingZ: -11.0,
    // Two engines in each box nacelle under the wing; the drawing makes the box.
    engines: [
      { x: 2.95, y: -2.15, z: 10.2, r: 0.68, length: 11.0 },
      { x: 4.45, y: -2.2, z: 10.6, r: 0.68, length: 11.0 },
    ],
  },
};

/**
 * Concorde. A slim tube (2.88 m wide, 3.32 m tall) and a needle nose that
 * droops on a hinge in front of the flight deck — 12.5 degrees with the gear
 * down so the pilots can see the runway, straight in cruise. The main hull
 * starts at the hinge; `cone` is the nose ahead of it, drawn as its own loft
 * (src/fleet/extra/jets.js) so it can tilt. The rear of the tube sweeps up
 * hard to the tail: on the real one a small tail wheel guarded it; here the
 * drawing keeps the strike at about 14 degrees on its tall gear.
 */
function concordeFuselage() {
  const st = (z, top, bot, w, yc, nT = 2, nB = 2) => ({ z, top, bot, w, yc, nT, nB });
  const stations = [
    st(-24.5, 0.55, -1.42, 1.12, -0.35),
    st(-24.0, 0.85, -1.5, 1.22, -0.3),
    st(-23.4, 1.15, -1.56, 1.3, -0.22),
    st(-22.6, 1.4, -1.6, 1.37, -0.12),
    st(-21.5, 1.58, -1.64, 1.42, -0.04),
    st(-20.0, 1.66, -1.66, 1.44, 0),
    st(12.0, 1.66, -1.66, 1.44, 0),
    st(17.0, 1.66, -1.05, 1.3, 0.3),
    st(22.0, 1.6, -0.05, 1.02, 0.78),
    st(26.0, 1.55, 0.75, 0.62, 1.15),
    st(28.6, 1.5, 1.25, 0.28, 1.38),
    st(29.66, 1.46, 1.42, 0.05, 1.44),
  ];
  const cone = [
    st(-32.0, -0.42, -0.42, 0.0, -0.42),
    st(-31.5, -0.25, -0.6, 0.18, -0.42),
    st(-30.5, -0.05, -0.8, 0.38, -0.42),
    st(-29.0, 0.15, -1.02, 0.62, -0.41),
    st(-27.5, 0.32, -1.2, 0.84, -0.39),
    st(-26.0, 0.45, -1.33, 1.0, -0.37),
    st(-24.5, 0.55, -1.42, 1.12, -0.35),
  ];
  const panes = [
    // Inboard corners a little further down and up the nose than the
    // outboard ones, so the glass in front of the pilot is taller than the
    // 20 cm it was between its frames (the wave-8 cockpit check).
    { name: 'Windscreen', wiper: true, corners: [{ z: -24.5, x: 0.06 }, { z: -24.28, y: 0.48 }, { z: -23.88, y: 0.82 }, { z: -23.78, x: 0.06 }] },
    { name: 'Side window', corners: [{ z: -24.18, y: 0.5 }, { z: -23.5, y: 0.6 }, { z: -23.52, y: 1.0 }, { z: -23.8, y: 0.86 }] },
    { name: 'Rear side window', corners: [{ z: -23.38, y: 0.62 }, { z: -22.95, y: 0.66 }, { z: -23.0, y: 1.05 }, { z: -23.38, y: 1.06 }] },
  ];
  // The eye 45 cm nearer the glass than first drawn: Concorde's panes are
  // small (the visor's), and from 1.4 m back they gave 4.5 degrees of sky
  // and 2 of nose-drop; 10 and 8 from 1 m (the wave-8 cockpit check).
  return { stations, cone, panes, eye: [-0.42, 0.72, -23.4], radomeZ: -24.5, k: 0.75, tailZ: 29.66 };
}
const CONCORDE = concordeFuselage();
DESC.concorde.fuselage = CONCORDE;

/**
 * One description into the geometry record the rest of the game reads —
 * the same fields as AIRLINER_GEOMETRY, plus `body` (the generated
 * fuselage) and `strike` (the drawn tail-strike angle and where it touches).
 */
export function geometryFrom(d) {
  // A hand-drawn fuselage (the giants, ./giants.js) brings its own stations,
  // glazing and eye in place of a generated one; an upper loft (a hump or a
  // cargo bubble) comes as `lofts`, and its underside is held to the same
  // strike line as the main one where it hangs below it.
  const f = d.fuselage || fuselage(d.body);
  const body = d.body || { noseZ: f.stations[0].z, length: f.tailZ - f.stations[0].z, B: d.bottom };
  const belly = -body.B;
  const strikes = [f.stations, ...(d.lofts || [])].map((st) => strikeAngle(st, d.main.z, d.ground));
  const strike = strikes.reduce((a, b) => (b.deg < a.deg ? b : a));
  return {
    length: body.length,
    span: d.span,
    noseZ: body.noseZ,
    belly,
    ground: d.ground,
    nose: { ...d.nose },
    main: { ...d.main },
    tailStrike: { z: tailStrikeZ(belly, d.main.z, d.ground, strike.deg) },
    tip: { ...d.tip },
    wingZ: d.wingZ,
    engines: pair(d.engines),
    eye: d.eye || f.eye,
    body: f,
    strike,
  };
}

export { pair, jet, JET_AERO };

export const JET_GEOMETRY = Object.fromEntries(Object.entries(DESC).map(([id, d]) => [id, geometryFrom(d)]));
// The Concorde's plan starts at the tip of its needle, not at the hinge where the main hull does.
JET_GEOMETRY.concorde.noseZ = CONCORDE.cone[0].z;
JET_GEOMETRY.concorde.length = +(CONCORDE.tailZ - CONCORDE.cone[0].z).toFixed(2);
JET_GEOMETRY.concorde.cone = CONCORDE.cone;

/* Into the shared table, for everything that already reads it (above). */
Object.assign(AIRLINER_GEOMETRY, JET_GEOMETRY);

/**
 * Every door of each model as drawn, in metres in the aeroplane's frame — the
 * AIRLINER_DOORS format (./airliners.js has the field list): for the
 * evacuation (passengers out of these, crew, then you), the jet bridges and
 * the stair trucks. Measured off the built models, not typed in;
 * tests/features/new-aircraft.mjs rebuilds every one and fails if the table
 * and the drawing are 2 cm apart anywhere.
 */
export const JET_DOORS = {
  b737: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -1.816, y: 0.3, z: -14.25, w: 0.86, h: 1.83, sill: -0.62, normal: [-0.98,0.192,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 1.816, y: 0.3, z: -14.25, w: 0.86, h: 1.83, sill: -0.62, normal: [0.98,0.192,0] },
    { id: "L2", side: "left", deck: "main", kind: "passenger", x: -1.28, y: 0.3, z: 13.9, w: 0.76, h: 1.83, sill: -0.62, normal: [-0.957,-0.242,0] },
    { id: "R2", side: "right", deck: "main", kind: "passenger", x: 1.28, y: 0.3, z: 13.9, w: 0.76, h: 1.83, sill: -0.62, normal: [0.957,-0.242,0] },
    { id: "OL1", side: "left", deck: "main", kind: "overwing", x: -1.849, y: 0.36, z: -0.94, w: 0.51, h: 0.97, sill: -0.12, normal: [-0.986,0.17,0] },
    { id: "OR1", side: "right", deck: "main", kind: "overwing", x: 1.849, y: 0.36, z: -0.94, w: 0.51, h: 0.97, sill: -0.12, normal: [0.986,0.17,0] },
    { id: "OL2", side: "left", deck: "main", kind: "overwing", x: -1.849, y: 0.36, z: -0.43, w: 0.51, h: 0.97, sill: -0.12, normal: [-0.986,0.17,0] },
    { id: "OR2", side: "right", deck: "main", kind: "overwing", x: 1.849, y: 0.36, z: -0.43, w: 0.51, h: 0.97, sill: -0.12, normal: [0.986,0.17,0] },
  ],
  a321: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -1.928, y: 0.31, z: -15.95, w: 0.81, h: 1.85, sill: -0.62, normal: [-0.984,0.174,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 1.928, y: 0.31, z: -15.95, w: 0.81, h: 1.85, sill: -0.62, normal: [0.984,0.174,0] },
    { id: "L2", side: "left", deck: "main", kind: "passenger", x: -1.953, y: 0.31, z: -8.6, w: 0.81, h: 1.85, sill: -0.62, normal: [-0.99,0.143,0] },
    { id: "R2", side: "right", deck: "main", kind: "passenger", x: 1.953, y: 0.31, z: -8.6, w: 0.81, h: 1.85, sill: -0.62, normal: [0.99,0.143,0] },
    { id: "L3", side: "left", deck: "main", kind: "passenger", x: -1.952, y: 0.31, z: 6.4, w: 0.81, h: 1.85, sill: -0.62, normal: [-0.99,0.141,0] },
    { id: "R3", side: "right", deck: "main", kind: "passenger", x: 1.952, y: 0.31, z: 6.4, w: 0.81, h: 1.85, sill: -0.62, normal: [0.99,0.141,0] },
    { id: "L4", side: "left", deck: "main", kind: "passenger", x: -1.466, y: 0.31, z: 15.24, w: 0.81, h: 1.85, sill: -0.62, normal: [-0.978,-0.166,0] },
    { id: "R4", side: "right", deck: "main", kind: "passenger", x: 1.466, y: 0.31, z: 15.24, w: 0.81, h: 1.85, sill: -0.62, normal: [0.978,-0.166,0] },
  ],
  b787: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -2.867, y: 0.33, z: -21.6, w: 1.07, h: 1.93, sill: -0.65, normal: [-0.994,0.106,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 2.867, y: 0.33, z: -21.6, w: 1.07, h: 1.93, sill: -0.65, normal: [0.994,0.106,0] },
    { id: "L2", side: "left", deck: "main", kind: "passenger", x: -2.867, y: 0.33, z: -9.4, w: 1.07, h: 1.93, sill: -0.65, normal: [-0.994,0.107,0] },
    { id: "R2", side: "right", deck: "main", kind: "passenger", x: 2.867, y: 0.33, z: -9.4, w: 1.07, h: 1.93, sill: -0.65, normal: [0.994,0.107,0] },
    { id: "L3", side: "left", deck: "main", kind: "passenger", x: -2.867, y: 0.33, z: 8.6, w: 1.07, h: 1.93, sill: -0.65, normal: [-0.994,0.107,0] },
    { id: "R3", side: "right", deck: "main", kind: "passenger", x: 2.867, y: 0.33, z: 8.6, w: 1.07, h: 1.93, sill: -0.65, normal: [0.994,0.107,0] },
    { id: "L4", side: "left", deck: "main", kind: "passenger", x: -0.546, y: 0.33, z: 24.4, w: 1.07, h: 1.93, sill: -0.65, normal: [-0.261,-0.934,0] },
    { id: "R4", side: "right", deck: "main", kind: "passenger", x: 0.546, y: 0.33, z: 24.4, w: 1.07, h: 1.93, sill: -0.65, normal: [0.261,-0.934,0] },
  ],
  a350: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -2.962, y: 0.33, z: -24.4, w: 1.07, h: 1.93, sill: -0.66, normal: [-0.994,0.106,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 2.962, y: 0.33, z: -24.4, w: 1.07, h: 1.93, sill: -0.66, normal: [0.994,0.106,0] },
    { id: "L2", side: "left", deck: "main", kind: "passenger", x: -2.962, y: 0.33, z: -11, w: 1.07, h: 1.93, sill: -0.66, normal: [-0.994,0.106,0] },
    { id: "R2", side: "right", deck: "main", kind: "passenger", x: 2.962, y: 0.33, z: -11, w: 1.07, h: 1.93, sill: -0.66, normal: [0.994,0.106,0] },
    { id: "L3", side: "left", deck: "main", kind: "passenger", x: -2.962, y: 0.33, z: 8.9, w: 1.07, h: 1.93, sill: -0.66, normal: [-0.994,0.106,0] },
    { id: "R3", side: "right", deck: "main", kind: "passenger", x: 2.962, y: 0.33, z: 8.9, w: 1.07, h: 1.93, sill: -0.66, normal: [0.994,0.106,0] },
    { id: "L4", side: "left", deck: "main", kind: "passenger", x: -0.333, y: 0.33, z: 25.6, w: 1.07, h: 1.93, sill: -0.66, normal: [-0.152,-0.956,0] },
    { id: "R4", side: "right", deck: "main", kind: "passenger", x: 0.333, y: 0.33, z: 25.6, w: 1.07, h: 1.93, sill: -0.66, normal: [0.152,-0.956,0] },
  ],
  b777: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -3.075, y: 0.35, z: -26, w: 1.07, h: 1.93, sill: -0.62, normal: [-0.994,0.113,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 3.075, y: 0.35, z: -26, w: 1.07, h: 1.93, sill: -0.62, normal: [0.994,0.113,0] },
    { id: "L2", side: "left", deck: "main", kind: "passenger", x: -3.075, y: 0.35, z: -12.8, w: 1.07, h: 1.93, sill: -0.62, normal: [-0.994,0.113,0] },
    { id: "R2", side: "right", deck: "main", kind: "passenger", x: 3.075, y: 0.35, z: -12.8, w: 1.07, h: 1.93, sill: -0.62, normal: [0.994,0.113,0] },
    { id: "L3", side: "left", deck: "main", kind: "passenger", x: -3.075, y: 0.35, z: 4.6, w: 1.07, h: 1.93, sill: -0.62, normal: [-0.994,0.113,0] },
    { id: "R3", side: "right", deck: "main", kind: "passenger", x: 3.075, y: 0.35, z: 4.6, w: 1.07, h: 1.93, sill: -0.62, normal: [0.994,0.113,0] },
    { id: "L4", side: "left", deck: "main", kind: "passenger", x: -2.826, y: 0.35, z: 17.6, w: 1.07, h: 1.93, sill: -0.62, normal: [-0.991,-0.111,0] },
    { id: "R4", side: "right", deck: "main", kind: "passenger", x: 2.826, y: 0.35, z: 17.6, w: 1.07, h: 1.93, sill: -0.62, normal: [0.991,-0.111,0] },
    { id: "L5", side: "left", deck: "main", kind: "passenger", x: 0, y: 0.35, z: 29.4, w: 1.07, h: 1.93, sill: -0.62, normal: [0,-0.977,0] },
    { id: "R5", side: "right", deck: "main", kind: "passenger", x: 0, y: 0.35, z: 29.4, w: 1.07, h: 1.93, sill: -0.62, normal: [0,-0.977,0] },
  ],
  q400: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -1.313, y: 0.1, z: -12.15, w: 0.8, h: 1.65, sill: -0.72, normal: [-0.99,0.134,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 1.313, y: 0.1, z: -12.15, w: 0.8, h: 1.65, sill: -0.72, normal: [0.99,0.134,0] },
    { id: "L2", side: "left", deck: "main", kind: "passenger", x: -1.08, y: 0.1, z: 9.6, w: 0.76, h: 1.6, sill: -0.68, normal: [-0.978,-0.188,0] },
    { id: "R2", side: "right", deck: "main", kind: "passenger", x: 1.08, y: 0.1, z: 9.6, w: 0.76, h: 1.6, sill: -0.68, normal: [0.978,-0.188,0] },
  ],
  concorde: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -1.434, y: 0.1, z: -20.6, w: 0.76, h: 1.68, sill: -0.75, normal: [-0.998,0.056,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 1.434, y: 0.1, z: -20.6, w: 0.76, h: 1.68, sill: -0.75, normal: [0.998,0.056,0] },
    { id: "L2", side: "left", deck: "main", kind: "passenger", x: -1.437, y: 0.1, z: 4.5, w: 0.76, h: 1.68, sill: -0.75, normal: [-0.999,0.052,0] },
    { id: "R2", side: "right", deck: "main", kind: "passenger", x: 1.437, y: 0.1, z: 4.5, w: 0.76, h: 1.68, sill: -0.75, normal: [0.999,0.052,0] },
  ],
};
Object.assign(AIRLINER_DOORS, JET_DOORS);

/*
 * THE AERO NUMBERS. Every one of these is the A320 / 747 / A380 set (see
 * ./airliners.js, where each was measured) with the mass, wing, thrust,
 * inertia and roll power scaled to the aeroplane; tests/features/new-
 * aircraft.mjs flies each on physics.js — take-off, the playtest's circuit,
 * a landing — on the runway it is meant for, and prints the distances.
 */
const JET_AERO = {
  CL0: 0.4,
  CLa: 5.0,
  alphaStall: 0.22,
  CYb: -0.45,
  Cmalpha: -1.2,
  Cmq: -30.0,
  Cmde: -1.0,
  Clb: -0.12,
  Clp: -0.6,
  Cnb: 0.11,
  Cnr: -0.16,
  Cndr: 0.011,
};

function jet(base, g, a) {
  return { ...base.TRAINER_AERO, ...JET_AERO, ...inertias(a.mass, g), ...a };
}

export function TYPES(base) {
  const G = JET_GEOMETRY;
  return [
    /* ---------------------------------------------------------------- *
     * Boeing 737 MAX 8: the best-selling airliner there has ever been.
     * ---------------------------------------------------------------- */
    {
      id: 'b737',
      name: 'Boeing 737 MAX 8',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: false,
      cockpit: 'jet',
      blurb:
        'The short-hop workhorse you see at every airport on Earth: a pointed nose, big round engines ' +
        'tucked right up under the wing, and split-tip winglets. Quick to roll and easy to land — the ' +
        'one most real pilots learn airliners on.',
      stats: { speed: 3, handling: 3, ease: 3 },
      livery: '#f4f6f9',
      accent: '#1f4fa8',
      callsign: 'Island seven three seven',
      price: 600,
      why: 'The best-selling airliner ever built',
      takeoffFlaps: 1,
      plan: planFrom(G.b737),
      shape: shapeFrom(G.b737, base, {
        radius: 1.88, wingRootX: 1.4, rootChord: 5.0, tipChord: 1.25, sweep: 8.1, rootY: -1.5,
        hSpan: 6.27, hRootChord: 3.6, hZ: 15.4, finHeight: 7.0, finRootChord: 6.8, finSweep: 5.2, finZ: 11.5,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.b737, {
        mass: 17500, wingArea: 98, wingSpan: 35.92, chord: 4.17,
        CD0: 0.022, k: 0.042, Clda: 0.065,
        thrustMax: 62000, fuelCapacity: 6000, fuelBurnMax: 0.6,
        gearDragArea: 2.6, maxGearSpeed: 115, vne: 175,
        ceiling: 41000, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },

    /* ---------------------------------------------------------------- *
     * Airbus A321neo: the A320, seven metres longer, with bigger fans.
     * ---------------------------------------------------------------- */
    {
      id: 'a321',
      name: 'Airbus A321neo',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: false,
      cockpit: 'jet',
      blurb:
        'The stretched one: an A320 seven metres longer, with four pairs of doors and huge new-generation ' +
        'fans. It needs more runway than its little sister and the long tail is closer to the ground ' +
        'when you rotate — lift the nose gently.',
      stats: { speed: 3, handling: 2, ease: 3 },
      livery: '#f6f7f9',
      accent: '#6a2c91',
      callsign: 'Island three two one',
      price: 700,
      why: 'An A320 stretched seven metres',
      takeoffFlaps: 2,
      plan: planFrom(G.a321),
      shape: shapeFrom(G.a321, base, {
        radius: 1.975, wingRootX: 1.35, rootChord: 4.82, tipChord: 1.45, sweep: 8.0, rootY: -1.45,
        hSpan: 6.2, hRootChord: 3.7, hZ: 17.35, finHeight: 6.05, finRootChord: 6.0, finSweep: 4.3, finZ: 12.25,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.a321, {
        mass: 20500, wingArea: 104, wingSpan: 35.8, chord: 4.19,
        CD0: 0.022, k: 0.042, Clda: 0.068,
        // Seven metres more fuselage on the same wing chord: at the A320's
        // -30 the simplified height-hold drove a 36 deg/s pitch oscillation
        // hands-off at 280 kt. Damping goes with (length / chord)^2.
        Cmq: -40.0,
        thrustMax: 71000, fuelCapacity: 7000, fuelBurnMax: 0.62,
        gearDragArea: 2.7, maxGearSpeed: 115, vne: 175,
        ceiling: 39800, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },

    /* ---------------------------------------------------------------- *
     * Boeing 787-9 Dreamliner: the carbon long-hauler with the bendy wing.
     * ---------------------------------------------------------------- */
    {
      id: 'b787',
      name: 'Boeing 787-9 Dreamliner',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: true,
      cockpit: 'big-jet',
      blurb:
        'The Dreamliner: a smooth nose with four big windscreens, the biggest cabin windows in the sky, ' +
        'jagged-edged engines and a long, thin wing that curls up at the tips in flight. Long-haul, but ' +
        'light on its feet for a wide-body.',
      stats: { speed: 4, handling: 2, ease: 3 },
      livery: '#f3f5f8',
      accent: '#0b3d7a',
      callsign: 'Island seven eight seven heavy',
      price: 1300,
      why: 'Carbon fibre and a wing that bends',
      takeoffFlaps: 2,
      plan: planFrom(G.b787),
      shape: shapeFrom(G.b787, base, {
        radius: 2.885, wingRootX: 2.6, rootChord: 8.0, tipChord: 1.6, sweep: 19.2, rootY: -2.0,
        hSpan: 8.9, hRootChord: 6.0, hZ: 24.2, finHeight: 9.0, finRootChord: 10.5, finSweep: 8.4, finZ: 20.0,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.b787, {
        mass: 22000, wingArea: 114, wingSpan: 60.12, chord: 7.0,
        CD0: 0.021, k: 0.038, Clda: 0.095,
        thrustMax: 80000, fuelCapacity: 18000, fuelBurnMax: 0.75,
        gearDragArea: 3.0, maxGearSpeed: 120, vne: 185,
        ceiling: 43100, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },

    /* ---------------------------------------------------------------- *
     * Airbus A350-900: the masked windscreen and the curling sharklets.
     * ---------------------------------------------------------------- */
    {
      id: 'a350',
      name: 'Airbus A350-900',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: true,
      cockpit: 'big-jet',
      blurb:
        'Airbus\'s carbon long-hauler, easy to spot by the black "mask" round its windscreen and the ' +
        'wing tips that curl up in one smooth sweep. Big and calm — it rolls a long way, then flies ' +
        'like it is on rails.',
      stats: { speed: 4, handling: 2, ease: 3 },
      livery: '#f5f6f8',
      accent: '#a3142a',
      callsign: 'Island three five zero heavy',
      price: 1400,
      why: 'The one with the black mask',
      takeoffFlaps: 2,
      plan: planFrom(G.a350),
      shape: shapeFrom(G.a350, base, {
        radius: 2.98, wingRootX: 2.7, rootChord: 8.6, tipChord: 1.8, sweep: 20.0, rootY: -2.1,
        hSpan: 8.4, hRootChord: 6.2, hZ: 24.8, finHeight: 9.2, finRootChord: 11.0, finSweep: 9.0, finZ: 20.5,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.a350, {
        mass: 23000, wingArea: 118, wingSpan: 64.75, chord: 7.6,
        CD0: 0.021, k: 0.038, Clda: 0.1,
        thrustMax: 83000, fuelCapacity: 19000, fuelBurnMax: 0.8,
        gearDragArea: 3.1, maxGearSpeed: 120, vne: 175, // 340 kt indicated, the A350's published Vmo (it was 360)
        ceiling: 43100, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },

    /* ---------------------------------------------------------------- *
     * Boeing 777-300ER: the biggest twin-engined airliner of its day.
     * ---------------------------------------------------------------- */
    {
      id: 'b777',
      name: 'Boeing 777-300ER',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: true,
      cockpit: 'big-jet',
      blurb:
        'The Triple Seven: seventy-four metres long, six wheels on each main leg and two of the most ' +
        'powerful jet engines ever made — each as wide as a 737\'s body. Long and heavy, with a tail ' +
        'that is easy to scrape: rotate slowly.',
      stats: { speed: 4, handling: 1, ease: 2 },
      livery: '#f4f6f8',
      accent: '#0f5f4a',
      callsign: 'Island triple seven heavy',
      price: 1500,
      why: 'Two engines as big as a fuselage',
      takeoffFlaps: 2,
      plan: planFrom(G.b777),
      shape: shapeFrom(G.b777, base, {
        radius: 3.095, wingRootX: 2.9, rootChord: 9.0, tipChord: 1.9, sweep: 21.5, rootY: -2.2,
        hSpan: 9.75, hRootChord: 6.8, hZ: 28.8, finHeight: 9.6, finRootChord: 11.5, finSweep: 9.0, finZ: 23.5,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.b777, {
        mass: 25500, wingArea: 124, wingSpan: 64.8, chord: 7.9,
        CD0: 0.021, k: 0.038, Clda: 0.1,
        thrustMax: 92000, fuelCapacity: 22000, fuelBurnMax: 0.9,
        gearDragArea: 3.3, maxGearSpeed: 120, vne: 170, // 330 kt indicated, the 777's published Vmo (it was 360)
        ceiling: 43100, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },

    /* ---------------------------------------------------------------- *
     * Dash 8 Q400: the fast regional turboprop, high wing and T-tail.
     * ---------------------------------------------------------------- */
    {
      id: 'q400',
      name: 'Dash 8 Q400',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: false,
      cockpit: 'turboprop',
      blurb:
        'The island-hopper: a high wing, a T-tail and two big six-bladed propellers, with seventy-odd ' +
        'seats and the speed of a small jet. Short strips are no trouble — and you can see the ' +
        'propellers spin from your seat.',
      stats: { speed: 2, handling: 3, ease: 4 },
      livery: '#f5f6f8',
      accent: '#d4351c',
      callsign: 'Island four hundred',
      price: 500,
      why: 'Propellers, a high wing and a T-tail',
      takeoffFlaps: 1,
      plan: planFrom(G.q400),
      shape: {
        ...shapeFrom(G.q400, base, {
          radius: 1.345, wingRootX: 1.0, rootChord: 3.0, tipChord: 1.35, sweep: 0.75, rootY: 1.55,
          hSpan: 3.95, hRootChord: 2.3, hZ: 13.6, finHeight: 4.6, finRootChord: 4.4, finSweep: 3.6, finZ: 9.6,
          gearStiffness: 1.6,
        }),
        /*
         * A twin turboprop, as the Tempest is: `prop`, so the audio picks the
         * propeller sound and the flight model its torque and slipstream
         * (specFor: propeller = kind 'prop' and no rotor). The radius is the
         * real 4.11 m propeller's, in shape units like everything else here.
         */
        power: (() => {
          const g = G.q400;
          const s = g.belly / 0.82;
          const e = g.engines.find((v) => v.x > 0);
          return {
            kind: 'prop', count: 2, propRadius: +(e.prop / s).toFixed(3),
            x: +(e.x / s).toFixed(3), y: +(e.y / s).toFixed(3), z: +(e.z / s).toFixed(3),
            radius: +(e.r / s).toFixed(3), length: +(e.length / s).toFixed(3),
          };
        })(),
      },
      aero: {
        ...base.TRAINER_AERO,
        ...inertias(13000, G.q400),
        mass: 13000,
        wingArea: 72,
        wingSpan: 28.42,
        chord: 2.6,
        CL0: 0.4,
        CLa: 5.0,
        alphaStall: 0.22,
        CD0: 0.028,
        k: 0.042,
        CYb: -0.48,
        Cmalpha: -1.3,
        // A 33 m body on a 2.6 m chord: the most pitch inertia per unit of
        // damping in the fleet, and at the Tempest's -26 it porpoised at
        // 47 deg/s hands-off at 280 kt (see the A321).
        Cmq: -55.0,
        Cmde: -0.9,
        Clb: -0.12,
        Clp: -0.6,
        Clda: 0.05,
        Cnb: 0.12,
        Cnr: -0.18,
        Cndr: 0.012,
        thrustMax: 48000,
        fuelCapacity: 3600,
        fuelBurnMax: 0.45,
        gearDragArea: 1.8,
        maxGearSpeed: 100,
        vne: 147, // 286 kt indicated, the Q400's published Vmo (it was 311)
        ceiling: 27000, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      },
    },

    /* ---------------------------------------------------------------- *
     * Concorde: the one everybody knows.
     * ---------------------------------------------------------------- */
    {
      id: 'concorde',
      name: 'Concorde',
      class: 'Airliner',
      category: 'airliner',
      military: false,
      longHaul: false,
      cockpit: 'jet',
      blurb:
        'The supersonic airliner: a needle nose that droops so the pilots can see the runway, a ' +
        'delta wing with no tailplane at all, and four engines in two boxes with afterburners. ' +
        'Climb high and it is the fastest thing with passengers in it.',
      stats: { speed: 5, handling: 2, ease: 2 },
      livery: '#f6f7f9',
      accent: '#1b2f5b',
      callsign: 'Speedbird one',
      price: 2000,
      why: 'Twice the speed of sound, with passengers',
      takeoffFlaps: 2,
      plan: planFrom(G.concorde),
      shape: shapeFrom(G.concorde, base, {
        radius: 1.44, wingRootX: 1.3, rootChord: 26.0, tipChord: 2.4, sweep: 24.0, rootY: -1.2,
        hSpan: 0.6, hRootChord: 0.6, hZ: 27.0, finHeight: 6.0, finRootChord: 11.0, finSweep: 8.0, finZ: 15.5,
        gearStiffness: 1.7,
      }),
      /*
       * A delta, flown like an airliner in this flight model, with a little
       * less lift per degree (CLa 4.8), more drag due to lift (k 0.055) and the
       * thrust of four afterburning engines. "Twice the speed of sound" is what its
       * true airspeed comes to when the indicated limit below is flown at the
       * game's 70,000 ft ceiling, where the air is a tenth as thick.
       */
      aero: jet(base, G.concorde, {
        // `chord` is the length the flight model scales pitch damping by (with
        // its square). The delta's real 18 m made it so over-damped it could
        // not be flared — measured: full back stick at 85 kt, 2 degrees of
        // pitch in 3 s, down at 950 ft/min — so it is given the pitch
        // behaviour of the 787, whose chord and inertia it is closest to.
        mass: 20000, wingArea: 100, wingSpan: 25.6, chord: 6.5,
        CL0: 0.4, CLa: 4.8, alphaStall: 0.22,
        CD0: 0.02, k: 0.055, Clda: 0.07, Cnb: 0.12, Cnr: -0.18,
        thrustMax: 86000, fuelCapacity: 9000, fuelBurnMax: 1.1,
        gearDragArea: 2.4, maxGearSpeed: 120, vne: 230,
        ceiling: 60000, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },
  ];
}

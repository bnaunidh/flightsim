/**
 * The helicopter wave (owner, 2026-10-21/23: "MORE HELICOPTERS (e.g. Bell
 * 407, Airbus H145, UH-60 Black Hawk, CH-47 Chinook, Robinson R44, AW139
 * rescue)" + "AH-64 Apache … gun follows existing PvP/gunsight rules").
 * Seven rotorcraft beside the Skyhook, drawn at full size in
 * ../models/helis.js from the real published dimensions, flown on the same
 * rotor model (physics.js's rotor block + rotor-assist.js) with their own
 * numbers.
 *
 * Same contract as ./fighters.js: what the physics reads (`bodyLength`,
 * `nose`, `main`, `gearStiffness`, `power`) is in metres at scale 1, origin
 * at the centre of gravity, -Z forward, +Y up; `plan` is the drawn machine
 * seen from above, measured off the model by tests/features/airport.mjs (a
 * helicopter's span is its rotor, blades at rest).
 *
 * THE NUMBERS. Masses sit between the real empty weight and the maximum
 * take-off weight (a crew and half a load), rotor radii, blade counts,
 * rotor speeds, red lines and ceilings are the published figures, and the
 * three control arms are solved from the rates each class of machine turns
 * at (see arms() below; rotor-assist.js explains the formula) so an R44
 * snaps round and a Chinook does not. Rotor drag scales with the mass so a
 * given disc tilt buys the same speed across the fleet, and
 * `rotorStallAt` — where the retreating blade stalls — is each type's own,
 * 0.86 of its red line the way the Skyhook's 62 m/s is of its 72.
 *
 * Where the hub is drawn (`power.y`, `power.z`) is drawing-only, as it is
 * for the Skyhook: the rotor thrust acts through the CG in physics.js. The
 * hard points' nose and tail (types.js pointsFor: -2.6 and 3.95
 * bodyLengths) are made to land on the drawn nose and tail by choosing the
 * origin along the body, which is why the mast sits ahead of the origin on
 * the longer machines.
 *
 * Military (passcode, like the jets): the Black Hawk, the Chinook and the
 * Apache — `category: 'helicopter'` keeps them under the Helicopters
 * heading, hidden until the hangar is opened. The Apache alone carries a
 * gun (`guns: true`; features/gunsight/rules.js), and no helicopter ever
 * carries heat-seekers.
 */

const G = 9.80665;
const DEG = Math.PI / 180;
// rotor-assist.js ROTOR_TUNE's airframe damping, 1/s — the arms are solved
// against these (and describeRotorFeel() there prints what they produce).
const DAMP = { roll: 1.8, pitch: 1.45, yaw: 1.7 };

/**
 * Inertias from the mass and the two lengths, scaled off the Skyhook
 * (2,200 kg, 11.8 m, R 4.2 m: Ixx 4200 pitch, Iyy 6000 yaw, Izz 3000 roll).
 */
function inertias(mass, length, R) {
  const k = mass / 2200;
  const l2 = (length / 11.8) ** 2;
  const r2 = (R / 4.2) ** 2;
  return { Ixx: Math.round(4200 * k * l2), Iyy: Math.round(6000 * k * (0.6 * l2 + 0.4 * r2)), Izz: Math.round(3000 * k * r2) };
}

/** The three control arms that give these rates (deg/s) at hover collective. */
function arms(mass, I, rates) {
  const T = 0.675 * mass * G;
  return {
    rotorPitchArm: +((rates.pitch * DEG * DAMP.pitch * I.Ixx) / T).toFixed(3),
    rotorRollArm: +((rates.roll * DEG * DAMP.roll * I.Izz) / T).toFixed(3),
    rotorYawArm: +((rates.yaw * DEG * DAMP.yaw * I.Iyy) / T).toFixed(3),
  };
}

/** The aero block every helicopter shares, sized to one machine. */
function heliAero(base, { mass, length, R, rates, vneKt, ceiling, fuel, burn }) {
  const I = inertias(mass, length, R);
  const vne = vneKt / 1.94384;
  const s2 = (length / 11.8) ** 2;
  return {
    ...base.TRAINER_AERO,
    mass,
    // A token wing: it must not glide (see the Skyhook).
    wingArea: +(3.0 * s2).toFixed(1),
    wingSpan: +(3.6 * Math.sqrt(s2)).toFixed(1),
    chord: 0.9,
    ...I,
    CL0: 0.0,
    CLa: 0.6,
    alphaStall: 0.6,
    CD0: 0.09,
    k: 0.09,
    CYb: -0.36,
    Cmalpha: -0.45,
    Cmq: -12.0,
    Cmde: -0.62,
    Clb: -0.05,
    Clp: -0.42,
    Clda: 0.065,
    Cnb: 0.045,
    Cnr: -0.09,
    Cndr: 0.022,
    ...arms(mass, I, rates),
    rotorDrag: Math.round((260 * mass) / 2200),
    rotorStallAt: +(vne * 0.86).toFixed(1),
    thrustMax: 1,
    fuelCapacity: fuel,
    fuelBurnMax: burn,
    gearDragArea: 0.2,
    maxGearSpeed: 200,
    vne: +vne.toFixed(1),
    ceiling,
  };
}

/**
 * The shape block: the physics' contact and hard points, the hub, the eye.
 * `length` is the drawn nose-to-tail; the origin is 2.6/6.55 of it behind
 * the nose so pointsFor's nose and tail land on the drawing.
 */
function heliShape(base, { length, halfSpan, wingY = -0.5, cgH, nose, main, wheelR, retractable = false, power, eye, stiffness = 1.1, hardNoseY = null }) {
  return {
    ...base.TRAINER_SHAPE,
    scale: 1,
    bodyLength: +(length / 6.55).toFixed(3),
    bodyRadius: 1.0,
    halfSpan,
    rootChord: 0.8,
    tipChord: 0.5,
    sweep: 0,
    dihedral: 0.0,
    wingY,
    wingZ: 0,
    wingRootX: 0,
    struts: false,
    retractable,
    hSpan: 1.0,
    hRootChord: 0.5,
    hZ: 3.0,
    finHeight: 1.0,
    finRootChord: 0.8,
    finSweep: 0.3,
    finZ: 3.0,
    main: { x: main[0], y: -cgH, z: main[1] },
    nose: { x: 0, y: -cgH, z: nose },
    wheelR,
    gearStiffness: stiffness,
    ...(hardNoseY != null ? { hardNoseY } : {}),
    power: { kind: 'prop', count: 1, rotor: true, ...power },
    canopy: 'cabin',
    eye,
  };
}

/* ------------------------------------------------------------------ *
 * The airframes, in metres from the origin (see heliShape), for the model
 * builder (../models/helis.js) and the physics alike.
 * ------------------------------------------------------------------ */
export const HELI_GEOMETRY = {
  /* Bell 407: 10.2 m fuselage, 10.67 m four-blade rotor at 413 rpm, skids. */
  bell407: { length: 10.4, R: 5.335, blades: 4, hz: 6.88, hubY: 1.9, hubZ: -0.3, tailR: 0.825, tailBlades: 2, cgH: 1.5, kind: 'skids' },
  /* Airbus H145 (BK117 D-2): 11.4 m with the fenestron, 11.0 m four-blade rotor at 383 rpm, wide skids, clamshell doors. */
  h145: { length: 11.4, R: 5.5, blades: 4, hz: 6.38, hubY: 2.05, hubZ: -0.25, tailR: 0.5, tailBlades: 8, fenestron: true, cgH: 1.55, kind: 'skids' },
  /* Robinson R44: 9.1 m, 10.06 m two-blade rotor at 408 rpm, the smallest here. */
  r44: { length: 9.1, R: 5.03, blades: 2, hz: 6.8, hubY: 1.83, hubZ: -0.3, tailR: 0.735, tailBlades: 2, cgH: 1.45, kind: 'skids' },
  /* AW139: 13.8 m, 13.8 m five-blade rotor at 300 rpm, wheels (nose, two mains in sponsons). */
  aw139: { length: 13.8, R: 6.9, blades: 5, hz: 5.0, hubY: 2.05, hubZ: -0.4, tailR: 1.35, tailBlades: 4, cgH: 1.9, kind: 'wheels' },
  /* UH-60 Black Hawk: 15.3 m fuselage (15.8 to the tail rotor), 16.36 m four-blade rotor at 258 rpm, tailwheel gear, canted tail rotor. */
  uh60: { length: 15.8, R: 8.18, blades: 4, hz: 4.3, hubY: 1.96, hubZ: -1.3, tailR: 1.675, tailBlades: 4, tailCant: 20 * DEG, cgH: 1.8, kind: 'tailwheel' },
  /* CH-47F Chinook: 15.9 m, two 18.3 m three-blade rotors at 225 rpm, 11.94 m apart, counter-rotating, four wheels, a rear ramp. */
  ch47: { length: 15.9, R: 9.15, blades: 3, hz: 3.75, hubY: 1.9, hubZ: -3.4, aftHubY: 3.6, aftHubZ: 8.54, tandem: true, cgH: 1.9, kind: 'quad' },
  /* AH-64 Apache: 15.5 m with the tail rotor, 14.63 m four-blade rotor at 289 rpm, tailwheel gear, stub wings, the gun under the nose. */
  ah64: { length: 15.5, R: 7.315, blades: 4, hz: 4.82, hubY: 1.97, hubZ: -0.65, tailR: 1.395, tailBlades: 4, cgH: 1.9, kind: 'tailwheel' },
};

export function TYPES(base) {
  const Gm = HELI_GEOMETRY;
  return [
    {
      id: 'bell407',
      name: 'Bell 407',
      class: 'Helicopter',
      blurb:
        'The light single everybody learns to recognise: a glass-fronted cabin, four blades, skids. Quick, '
        + 'honest and happy on a hospital roof. Shift and Ctrl are the collective, W A S D the cyclic, Q and E the pedals.',
      stats: { speed: 2, handling: 4, ease: 3 },
      livery: '#1f3a5f',
      accent: '#d9a441',
      callsign: 'Four zero seven',
      stores: 4,
      plan: { nose: -5.63, tail: 6.71, span: 10.66 },
      shape: heliShape(base, {
        length: Gm.bell407.length, halfSpan: 1.3, cgH: Gm.bell407.cgH, nose: -1.3, main: [1.1, 0.7], wheelR: { nose: 0.2, main: 0.2 },
        power: { propRadius: Gm.bell407.R, y: Gm.bell407.hubY, z: Gm.bell407.hubZ, blades: 4, hz: Gm.bell407.hz, dir: 1 },
        eye: [-0.3, 0.35, -2.2],
      }),
      aero: heliAero(base, { mass: 2000, length: Gm.bell407.length, R: Gm.bell407.R, rates: { roll: 72, pitch: 48, yaw: 68 }, vneKt: 140, ceiling: 18690, fuel: 480, burn: 0.034 }),
    },
    {
      id: 'h145',
      name: 'Airbus H145',
      class: 'Helicopter',
      blurb:
        'The twin-engined air-ambulance workhorse: a fenestron fan in the fin instead of a tail rotor, clamshell doors '
        + 'at the back and room for a stretcher. Smooth, stable and fast for its size.',
      stats: { speed: 3, handling: 3, ease: 4 },
      livery: '#e8e9ea',
      accent: '#d1281e',
      callsign: 'Medic one four five',
      stores: 4,
      plan: { nose: -5.75, tail: 7.30, span: 11.00 },
      shape: heliShape(base, {
        length: Gm.h145.length, halfSpan: 1.45, cgH: Gm.h145.cgH, nose: -1.5, main: [1.2, 0.8], wheelR: { nose: 0.2, main: 0.2 },
        power: { propRadius: Gm.h145.R, y: Gm.h145.hubY, z: Gm.h145.hubZ, blades: 4, hz: Gm.h145.hz, dir: -1 },
        eye: [-0.3, 0.38, -2.5],
      }),
      aero: heliAero(base, { mass: 3000, length: Gm.h145.length, R: Gm.h145.R, rates: { roll: 62, pitch: 42, yaw: 60 }, vneKt: 150, ceiling: 20000, fuel: 700, burn: 0.05 }),
    },
    {
      id: 'r44',
      name: 'Robinson R44',
      class: 'Helicopter',
      blurb:
        'Two blades, two seats each side, a piston engine and a T-bar for a stick: the lightest machine in the '
        + 'hangar and the liveliest. It goes exactly where you point it, so point it carefully.',
      stats: { speed: 1, handling: 5, ease: 2 },
      livery: '#f3f4f2',
      accent: '#2c5aa0',
      callsign: 'Robinson four four',
      stores: 2,
      plan: { nose: -3.61, tail: 5.80, span: 10.05 },
      shape: heliShape(base, {
        length: Gm.r44.length, halfSpan: 1.1, cgH: Gm.r44.cgH, nose: -1.1, main: [0.95, 0.6], wheelR: { nose: 0.18, main: 0.18 },
        power: { propRadius: Gm.r44.R, y: Gm.r44.hubY, z: Gm.r44.hubZ, blades: 2, hz: Gm.r44.hz, dir: 1 },
        eye: [-0.3, 0.3, -1.9],
      }),
      aero: heliAero(base, { mass: 1000, length: Gm.r44.length, R: Gm.r44.R, rates: { roll: 85, pitch: 55, yaw: 75 }, vneKt: 130, ceiling: 14000, fuel: 180, burn: 0.016 }),
    },
    {
      id: 'aw139',
      name: 'AW139 Rescue',
      class: 'Helicopter',
      blurb:
        'The search-and-rescue twin: five blades, a hoist over the door, a wheeled undercarriage and the legs to '
        + 'reach a ship far out. In the red and white of the island rescue service.',
      stats: { speed: 4, handling: 3, ease: 3 },
      livery: '#d8232a',
      accent: '#f4f4f2',
      callsign: 'Rescue one three nine',
      stores: 6,
      plan: { nose: -6.98, tail: 9.10, span: 13.79 },
      shape: heliShape(base, {
        length: Gm.aw139.length, halfSpan: 1.75, cgH: Gm.aw139.cgH, nose: -3.9, main: [1.52, 0.9], wheelR: { nose: 0.26, main: 0.33 },
        power: { propRadius: Gm.aw139.R, y: Gm.aw139.hubY, z: Gm.aw139.hubZ, blades: 5, hz: Gm.aw139.hz, dir: 1 },
        eye: [-0.32, 0.45, -3.3],
      }),
      aero: heliAero(base, { mass: 5200, length: Gm.aw139.length, R: Gm.aw139.R, rates: { roll: 55, pitch: 38, yaw: 55 }, vneKt: 167, ceiling: 20000, fuel: 1568, burn: 0.1 }),
    },
    {
      id: 'uh60',
      name: 'UH-60 Black Hawk',
      class: 'Helicopter',
      category: 'helicopter',
      military: true,
      carrier: false,
      blurb:
        'The utility helicopter of every army film: a long low cabin for eleven troops, a tail rotor canted to lift, '
        + 'a tail wheel. Heavy, steady and fast — nearly 200 knots on the red line.',
      stats: { speed: 4, handling: 2, ease: 3 },
      livery: '#3e4a3a',
      accent: '#2b3328',
      callsign: 'Hawk two six',
      stores: 6,
      plan: { nose: -9.48, tail: 10.57, span: 16.35 },
      shape: heliShape(base, {
        length: Gm.uh60.length, halfSpan: 1.6, cgH: Gm.uh60.cgH, nose: 6.2, main: [1.35, -2.6], wheelR: { nose: 0.25, main: 0.4 },
        power: { propRadius: Gm.uh60.R, y: Gm.uh60.hubY, z: Gm.uh60.hubZ, blades: 4, hz: Gm.uh60.hz, dir: 1 },
        eye: [-0.55, 0.15, -4.6], stiffness: 1.2, hardNoseY: -0.65,
      }),
      aero: heliAero(base, { mass: 7500, length: Gm.uh60.length, R: Gm.uh60.R, rates: { roll: 50, pitch: 35, yaw: 50 }, vneKt: 193, ceiling: 19000, fuel: 1360, burn: 0.14 }),
    },
    {
      id: 'ch47',
      name: 'CH-47 Chinook',
      class: 'Helicopter',
      category: 'helicopter',
      military: true,
      carrier: false,
      blurb:
        'Two rotors turning opposite ways, no tail rotor, and a cabin you could park a car in behind a rear ramp. '
        + 'The pedals turn it by tilting the two discs against each other. Big, slow to answer, and nothing lifts more.',
      stats: { speed: 3, handling: 1, ease: 2 },
      livery: '#4a5a42',
      accent: '#2b3328',
      callsign: 'Chinook four four',
      stores: 8,
      plan: { nose: -11.40, tail: 16.54, span: 18.29 },
      shape: heliShape(base, {
        length: Gm.ch47.length, halfSpan: 1.9, cgH: Gm.ch47.cgH, nose: -3.0, main: [1.9, 5.1], wheelR: { nose: 0.4, main: 0.4 },
        power: { propRadius: Gm.ch47.R, y: Gm.ch47.hubY, z: Gm.ch47.hubZ, blades: 3, hz: Gm.ch47.hz, dir: 1, tandem: true },
        eye: [-0.55, 0.25, -5.4], stiffness: 1.3, hardNoseY: -0.45,
      }),
      aero: heliAero(base, { mass: 15000, length: Gm.ch47.length, R: Gm.ch47.R, rates: { roll: 40, pitch: 30, yaw: 42 }, vneKt: 170, ceiling: 20000, fuel: 3914, burn: 0.3 }),
    },
    {
      id: 'ah64',
      name: 'AH-64 Apache',
      class: 'Helicopter',
      category: 'helicopter',
      military: true,
      carrier: false,
      guns: true,
      blurb:
        'The attack helicopter: two crew one behind the other, stub wings, a tail wheel and the chain gun under '
        + 'the nose that follows the gunsight. Fast, agile for its weight, and built to be hit.',
      stats: { speed: 4, handling: 4, ease: 2 },
      livery: '#4b5248',
      accent: '#2b3328',
      callsign: 'Apache one one',
      stores: 4,
      plan: { nose: -7.96, tail: 10.30, span: 14.62 },
      shape: heliShape(base, {
        length: Gm.ah64.length, halfSpan: 2.6, wingY: -0.1, cgH: Gm.ah64.cgH, nose: 8.6, main: [1.0, -1.95], wheelR: { nose: 0.22, main: 0.38 },
        power: { propRadius: Gm.ah64.R, y: Gm.ah64.hubY, z: Gm.ah64.hubZ, blades: 4, hz: Gm.ah64.hz, dir: 1 },
        eye: [-0.0, 0.7, -3.4], stiffness: 1.2, hardNoseY: -0.7,
      }),
      aero: heliAero(base, { mass: 7500, length: Gm.ah64.length, R: Gm.ah64.R, rates: { roll: 60, pitch: 40, yaw: 55 }, vneKt: 197, ceiling: 20000, fuel: 1420, burn: 0.15 }),
    },
  ];
}

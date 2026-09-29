/**
 * The jets from the wishlist: the F-22, the F-35B, the F/A-18 and Air
 * Massimo, the fastest aeroplane in the game.
 *
 * A FUNCTION, not an array, and it has to be. These entries want to spread
 * TRAINER_SHAPE and TRAINER_AERO from ../types.js, and types.js imports this
 * file — so importing types.js from here is a cycle, and at the moment this
 * module runs those constants are not defined yet. types.js calls TYPES(base)
 * at its own bottom, once they are.
 *
 *   base = { TRAINER_SHAPE, TRAINER_AERO }
 *
 * THE SHAPES carry two kinds of number, and it matters which is which.
 *
 *   What the physics reads — `bodyLength`, `wingRootX + halfSpan`, `wingY`,
 *   `dihedral`, `nose`, `main`, `gearStiffness`, `power.kind` — is in metres
 *   at scale 1, the same numbers the models in ../../fleet/extra/fighters.js
 *   are built from: origin at the centre of gravity, gear contact = axle
 *   minus tyre radius. The physics lands on `nose` and `main` verbatim and
 *   the model is only ever shifted to meet them, so if the two disagree the
 *   wheels float or sink. `bodyLength` is chosen so the tail strike point
 *   pointsFor() puts at 3.95 x bodyLength lands on each jet's real aft end,
 *   and `wingRootX` is 0 so `halfSpan` is the whole semi-span.
 *
 *   Everything else — chords, sweep, wingZ, the tail and fin, bodyRadius,
 *   power.count — is only drawn: by the plan view on the hangar card
 *   (aircraftThumbnail in ../../ui/menus.js) and by model.js if the fleet pack
 *   ever fails to load. They are in the CARD's convention, because the card
 *   is what every child sees: z in units of bodyLength, measured to the chord
 *   centre, the wing drawn from the centreline, and one engine, because a
 *   count of 2 draws airliner nacelles under the wings. In metres these four
 *   drew with their wings stretched off the card and nacelles on the wings.
 *
 * IDLE CREEP caps the thrust. With the brakes held, the tyres' friction is
 * proportional to speed near zero — about 6,000 N per m/s on two braked
 * mains — so idle thrust, 18% of thrustMax, sets the speed a jet creeps at:
 * 0.18 x thrustMax / 6000 m/s. The landing missions call under 2.5 m/s
 * "stopped". The first numbers here (91-150 kN) crept at 2.6-4.5 m/s and no
 * landing mission could ever have finished. 62 kN, the Vanguard's, creeps at
 * 1.9-2.0, so the masses were brought down to the Vanguard's scale to keep a
 * fighter's thrust-to-weight around 1.
 *
 * THE NUMBERS are game numbers, in the same spirit as the Vanguard's: masses
 * lighter than the real aeroplanes and more lift at low speed, so that every
 * one of them unsticks inside the 1,100 m runway and can be landed at a speed
 * a ten-year-old can manage. What is kept honest is the relative feel — the
 * Raptor has the best thrust-to-weight (0.99) and the fastest roll of the
 * three real jets and is the fastest of them (321 kt flat out, against 316
 * and 311), the Hornet has the gentlest approach (63 kt) and the stiffest
 * legs, the F-35B hovers — and
 * Air Massimo is the fastest thing here by a margin you can measure:
 * tests/features/fighters.mjs flies every aeroplane in the roster flat out
 * and checks it.
 *
 * Inertias are scaled from the Vanguard's by mass and by length and span
 * squared, which is what an inertia is. Remember the axes in physics.js:
 * Ixx is PITCH, Iyy is YAW, Izz is ROLL.
 *
 * SETTLING. The first F-22 spawned thirty metres up and upside down and hit
 * the runway wing-first before anyone had touched a key. Aircraft.reset()
 * stands an aeroplane on its wheels with a fixed-gain relaxation —
 * pos.y += 1.5e-6 x net force, pitch += 3e-7 x net moment — and a relaxation
 * like that diverges once its loop gain passes 2. The gains are
 * 1.5e-6 x (sum of the leg springs) and 3e-7 x (sum of spring x leg-z²), and
 * the springs scale with mass; a 14.5 t jet with a nose leg 4.95 m ahead of
 * the centre of gravity had 2.42 and 3.70. So every one of these keeps both
 * gains at or under 1.5, two ways: gearStiffness is sized to the mass, and
 * the physics' nose leg sits a little nearer the centre of gravity than the
 * drawn one — the same compromise the Vanguard makes (physics nose leg at
 * -1.83 m, drawn at -3.48). Both legs are at the same height, so it still
 * sits level; tests/features/fighters.mjs spawns each one and checks.
 *
 * `plan` is the drawn jet from above — nose tip, aft end and span, in metres
 * from the centre of gravity — measured off the built models the way the
 * table in ../../fleet/extra/fighters.js is. The airfield parks and pushes
 * aeroplanes without building them, and cannot get these from the shape:
 * bodyLength puts the tail point on the nozzles, and the nose point it
 * implies lands 4-8 m inside the drawn nose. tests/features/airport.mjs
 * bakes every roster type and holds these to the drawing.
 */
export function TYPES(base) {
  const { TRAINER_SHAPE, TRAINER_AERO } = base;
  return [
    {
      id: 'f22',
      name: 'F-22 Raptor',
      class: 'Fighter',
      category: 'military',
      military: true,
      blurb:
        'Two huge engines, a diamond wing and nozzles that steer the thrust. The quickest of the real jets '
        + 'to answer the stick, and the fastest — so be gentle with it until you know it.',
      stats: { speed: 5, handling: 5, ease: 2 },
      livery: '#8e959c',
      accent: '#5b636b',
      callsign: 'Raptor zero one',
      stores: 2,
      plan: { nose: -10.75, tail: 8.05, span: 13.56 },
      shape: {
        ...TRAINER_SHAPE,
        scale: 1,
        bodyLength: 1.772, // tail point at z 7.0, the nozzle exits
        bodyRadius: 2.0,
        halfSpan: 6.78,
        rootChord: 5.51,
        tipChord: 0.9,
        sweep: 1.15,
        dihedral: -0.28,
        wingY: 0.05,
        wingZ: 0.42,
        wingRootX: 0,
        struts: false,
        retractable: true,
        hSpan: 4.42,
        hRootChord: 1.86,
        hZ: 3.39,
        finHeight: 3.05,
        finRootChord: 2.2,
        finSweep: 1.35,
        finZ: 1.92,
        main: { x: 1.6, y: -2.05, z: 1.1 },
        nose: { x: 0, y: -2.05, z: -4.6 }, // drawn at -4.95: see SETTLING above
        wheelR: { nose: 0.33, main: 0.46 },
        gearStiffness: 1.2,
        power: { kind: 'jet', count: 1, x: 0, y: -0.02, z: 6.2, radius: 0.55, length: 1.6, afterburner: true },
        canopy: 'bubble',
        hook: false,
        eye: [0, 1.02, -6.2],
      },
      aero: {
        ...TRAINER_AERO,
        mass: 6400,
        wingArea: 32,
        wingSpan: 13.56,
        chord: 4.5,
        Ixx: 80150,
        Iyy: 170700,
        Izz: 21680,
        CL0: 0.28,
        CLa: 3.6,
        alphaStall: 0.42,
        CD0: 0.019,
        k: 0.14,
        CYb: -0.36,
        Cmalpha: -1.0,
        Cmq: -18.0,
        Cmde: -1.2,
        Clb: -0.075,
        Clp: -0.58,
        Clda: 0.18,
        Cnb: 0.13,
        Cnr: -0.18,
        Cndr: 0.012,
        thrustMax: 62000,
        fuelCapacity: 3400,
        fuelBurnMax: 0.95,
        gearDragArea: 3.0,
        maxGearSpeed: 128,
        vne: 310,
      },
    },

    {
      id: 'f35b',
      name: 'F-35B Lightning II',
      class: 'Fighter',
      category: 'military',
      military: true,
      blurb:
        'It can stop in mid-air. Press T and the nozzle swings down: it hovers, lands on a pad and takes off '
        + 'straight up. Over 60 knots the hover switches itself off and it flies like any other jet.',
      stats: { speed: 4, handling: 3, ease: 3 },
      livery: '#6e757c',
      accent: '#484e55',
      callsign: 'Lightning three five',
      stores: 2,
      /** STOVL: src/features/stovl.js gives it a hover on the T key. */
      stovl: true,
      plan: { nose: -9.15, tail: 6.59, span: 10.67 },
      shape: {
        ...TRAINER_SHAPE,
        scale: 1,
        bodyLength: 1.544, // tail point at z 6.1, the stabilator trailing edge
        bodyRadius: 1.85,
        halfSpan: 5.335,
        rootChord: 4.24,
        tipChord: 0.95,
        sweep: 0.78,
        dihedral: -0.18,
        wingY: 0,
        wingZ: 0.34,
        wingRootX: 0,
        struts: false,
        retractable: true,
        hSpan: 3.4,
        hRootChord: 1.75,
        hZ: 2.91,
        finHeight: 2.35,
        finRootChord: 1.81,
        finSweep: 1.6,
        finZ: 2.04,
        main: { x: 1.45, y: -1.78, z: 0.85 },
        nose: { x: 0, y: -1.78, z: -4.55 },
        wheelR: { nose: 0.3, main: 0.42 },
        gearStiffness: 1.3,
        power: { kind: 'jet', count: 1, x: 0, y: 0, z: 5.6, radius: 0.6, length: 1.5, afterburner: true },
        canopy: 'bubble',
        hook: false,
        eye: [0, 1.02, -5.45],
      },
      aero: {
        ...TRAINER_AERO,
        mass: 6500,
        wingArea: 31,
        wingSpan: 10.67,
        chord: 3.9,
        Ixx: 55500,
        Iyy: 112900,
        Izz: 13640,
        CL0: 0.3,
        CLa: 3.8,
        alphaStall: 0.4,
        CD0: 0.024,
        k: 0.115,
        CYb: -0.36,
        Cmalpha: -1.0,
        Cmq: -18.0,
        Cmde: -1.15,
        Clb: -0.08,
        Clp: -0.58,
        Clda: 0.13,
        Cnb: 0.12,
        Cnr: -0.18,
        Cndr: 0.012,
        thrustMax: 60000,
        fuelCapacity: 3200,
        fuelBurnMax: 0.9,
        gearDragArea: 2.6,
        maxGearSpeed: 120,
        vne: 268,
      },
    },

    {
      id: 'fa18',
      name: 'F/A-18 Hornet',
      class: 'Carrier',
      category: 'military',
      military: true,
      blurb:
        'Built for the carrier: legs that shrug off a hard arrival, a tail hook, and big wing extensions '
        + 'that keep it flying slowly. The kindest of the real jets to land — and it can catch a wire.',
      stats: { speed: 4, handling: 4, ease: 3 },
      livery: '#9ba4ac',
      accent: '#5f6a74',
      callsign: 'Hornet three hundred',
      stores: 2,
      plan: { nose: -10.8, tail: 6.8, span: 11.74 },
      shape: {
        ...TRAINER_SHAPE,
        scale: 1,
        bodyLength: 1.67, // tail point at z 6.6, the nozzle exits
        bodyRadius: 1.43,
        halfSpan: 5.715,
        rootChord: 2.89,
        tipChord: 1.01,
        sweep: 0.78,
        dihedral: -0.24,
        wingY: -0.02,
        wingZ: 0.155,
        wingRootX: 0,
        struts: false,
        retractable: true,
        hSpan: 3.3,
        hRootChord: 1.56,
        hZ: 2.75,
        finHeight: 2.65,
        finRootChord: 1.98,
        finSweep: 2.0,
        finZ: 1.11,
        main: { x: 1.55, y: -1.72, z: 0.9 },
        nose: { x: 0, y: -1.72, z: -4.2 }, // drawn at -4.5
        wheelR: { nose: 0.28, main: 0.4 },
        gearStiffness: 1.5, // the stiffest of the four: a naval undercarriage
        hook: true,
        power: { kind: 'jet', count: 1, x: 0, y: -0.02, z: 5.7, radius: 0.5, length: 1.9, afterburner: true },
        canopy: 'bubble',
        eye: [0, 0.98, -5.9],
      },
      aero: {
        ...TRAINER_AERO,
        mass: 6800,
        // 37.2 m² of wing plus the LEX, which really does lift: 40 m².
        wingArea: 34,
        wingSpan: 12.31,
        chord: 3.5,
        Ixx: 69650,
        Iyy: 148600,
        Izz: 18950,
        CL0: 0.36,
        CLa: 4.3,
        alphaStall: 0.42,
        CD0: 0.021,
        k: 0.1,
        CYb: -0.36,
        Cmalpha: -1.0,
        Cmq: -20.0,
        Cmde: -1.15,
        Clb: -0.09,
        Clp: -0.56,
        Clda: 0.14,
        Cnb: 0.12,
        Cnr: -0.18,
        Cndr: 0.012,
        thrustMax: 62000,
        fuelCapacity: 3300,
        fuelBurnMax: 0.95,
        gearDragArea: 3.0,
        maxGearSpeed: 125,
        vne: 278,
      },
    },

    {
      id: 'massimo',
      name: 'Air Massimo',
      class: 'Racer',
      category: 'special',
      blurb:
        'The fastest thing in the game, and not by a little. Long, pointy and red-nosed, with a blue flame '
        + 'out of the back. A big wing lets it land slowly — just give yourself room to stop.',
      stats: { speed: 5, handling: 4, ease: 3 },
      livery: '#f3f4f6',
      accent: '#e0262b',
      callsign: 'Massimo one',
      plan: { nose: -13.2, tail: 8.31, span: 9.66 },
      shape: {
        ...TRAINER_SHAPE,
        scale: 1,
        bodyLength: 2.1, // tail point at z 8.3, the nozzle exits
        bodyRadius: 1.5,
        halfSpan: 4.8,
        rootChord: 4.4,
        tipChord: 0.9,
        sweep: 1.9,
        dihedral: -0.05,
        wingY: -0.12,
        wingZ: 0.6,
        wingRootX: 0,
        struts: false,
        retractable: true,
        hSpan: 1.0,
        hRootChord: 0.9,
        hZ: 3.3,
        finHeight: 2.1,
        finRootChord: 1.5,
        finSweep: 2.4,
        finZ: 2.5,
        main: { x: 1.4, y: -2.1, z: 1.4 },
        nose: { x: 0, y: -2.1, z: -5.4 }, // drawn at -5.6
        wheelR: { nose: 0.28, main: 0.38 },
        gearStiffness: 1.1,
        power: { kind: 'jet', count: 1, x: 0, y: -0.04, z: 7.3, radius: 0.5, length: 1.8, afterburner: true },
        canopy: 'bubble',
        hook: false,
        eye: [0, 0.85, -6.8],
      },
      aero: {
        ...TRAINER_AERO,
        mass: 5200,
        wingArea: 30,
        wingSpan: 9.6,
        chord: 4.5,
        Ixx: 80400,
        Iyy: 121300,
        Izz: 8820,
        CL0: 0.32,
        CLa: 3.2,
        alphaStall: 0.5,
        CD0: 0.006,
        k: 0.2,
        CYb: -0.3,
        Cmalpha: -1.1,
        Cmq: -24.0,
        Cmde: -0.85,
        Clb: -0.08,
        Clp: -0.6,
        Clda: 0.09,
        Cnb: 0.14,
        Cnr: -0.18,
        Cndr: 0.011,
        thrustMax: 62000,
        fuelCapacity: 3000,
        fuelBurnMax: 1.0,
        gearDragArea: 3.0,
        maxGearSpeed: 130,
        vne: 360,
      },
    },
  ];
}

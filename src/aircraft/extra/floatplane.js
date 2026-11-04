/**
 * The Petrel: a light aeroplane on two floats, plain paint, no wheels.
 * `aero.floats` is what the flight model and features/floatplane.js read:
 * where the keels are, how deep she sits, and how hard a keel drags on land.
 */
export const TYPES = ({ TRAINER_SHAPE, TRAINER_AERO }) => [
  {
    id: 'petrel',
    name: 'Petrel 185 Floatplane',
    class: 'Floatplane',
    category: 'light',
    floats: true,
    plan: { nose: -2.8, tail: 4.62, span: 12.28 },
    blurb:
      'A high-wing single on two floats. It takes off and lands on the sea, and steers on the water with rudders on the float heels. ' +
      'On land it can only slide.',
    stats: { speed: 1, handling: 3, ease: 4 },
    livery: '#e9e6dc',
    accent: '#1f5f6b',
    callsign: 'Petrel one eight five',
    shape: {
      ...TRAINER_SHAPE,
      canopy: 'greenhouse',
      wingZ: -0.6,
      hZ: 3.55,
      hRootChord: 1.05,
      finZ: 3.2,
      finRootChord: 1.35,
      finHeight: 1.1,
      finSweep: 0.62,
      wheelR: { nose: 0.2, main: 0.235 },
      nose: { x: 0, y: -2.3, z: -1.75 },
      main: { x: 1.3, y: -2.3, z: 1.05 },
      gearStiffness: 1.3,
      floatGear: { y: -2.3, x: 1.3, bow: -2.75, stern: 2.1, width: 0.36, depth: 0.52 },
    },
    aero: {
      ...TRAINER_AERO,
      mass: 1300,
      Ixx: 2200,
      Iyy: 3200,
      Izz: 1800,
      // The wing is rigged nose-up to the keels: she cannot rotate far on the water, so the incidence does it.
      CL0: 0.46,
      CD0: 0.058,
      thrustMax: 4900,
      fuelCapacity: 200,
      ceiling: 13000,
      vne: 76,
      maxGearSpeed: 200,
      floats: {
        draft: 0.34,
        skid: 0.2,
        stations: [[-1.3, -2.3, -1.5], [1.3, -2.3, -1.5], [-1.3, -2.3, 1.5], [1.3, -2.3, 1.5]],
      },
    },
  },
];

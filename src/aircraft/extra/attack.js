/**
 * The A-10 Thunderbolt II (owner, 2026-10-21: "Fairchild A-10 Thunderbolt
 * II (twin rear engines, straight wings, slow & tough, gun = existing
 * gunsight/PvP rules only, takes lots of damage)") — drawn at full size in
 * src/fleet/extra/attack.js.
 *
 * Same contract as ./fighters.js, whose conventions these numbers follow:
 * what the physics reads (`bodyLength`, `halfSpan`, `wingY`, `dihedral`,
 * `nose`, `main`, `gearStiffness`, `power.kind`) is in metres at scale 1 —
 * origin at the centre of gravity, gear contact = axle minus tyre radius —
 * and the rest (chords, sweep, wingZ, the tail and fin, bodyRadius) is in
 * the hangar card's units (z in bodyLengths to the chord centre).
 *
 * THE NUMBERS are game numbers in the fighters' spirit: a mass lighter than
 * the real 11-23 t so it unsticks inside the 1,100 m runway and lands at a
 * speed a child can fly (64 kt), the real span, length and proportions. What
 * is kept honest is the FEEL: it is the slowest of the jets by a margin —
 * 330 kt on the red line against the Raptor's 310 flat out it never reaches
 * (its two small fans give it 0.63 of its weight in thrust, the least of any
 * jet here, where tests/features/fighters.mjs wants at least 0.6) — with a
 * thick straight wing that turns tight and slow and a high stall angle. It
 * is a military jet with guns (features/gunsight: nothing marks it unarmed)
 * and never starts on the carrier (`carrier: false`: no hook, no catapult
 * bar). Real figures: 16.26 m long, 17.53 m across, 4.47 m tall, two TF34s
 * high on the rear fuselage, a twin tail, the gun under the nose.
 *
 * IDLE CREEP (see ./fighters.js): 0.18 x 32 kN / 6000 = 0.96 m/s with the
 * brakes on, well under the 2.5 the landing missions call stopped.
 *
 * SETTLING (./fighters.js): the physics' nose leg sits at -4.4 m, the drawn
 * one at -5.0, so Aircraft.reset()'s relaxation gains stay under 1.5.
 */
export function TYPES(base) {
  const { TRAINER_SHAPE, TRAINER_AERO } = base;
  return [
    {
      id: 'a10',
      name: 'A-10 Thunderbolt II',
      class: 'Fighter',
      category: 'military',
      military: true,
      carrier: false,
      blurb:
        'The Warthog: a straight wing, two engines up on its back, a twin tail and a gun as long as a '
        + 'car under the nose. Slow for a jet and happy that way — it turns tight, takes a beating, and '
        + 'lands on anything.',
      stats: { speed: 2, handling: 4, ease: 4 },
      livery: '#7e868d',
      accent: '#5a6168',
      callsign: 'Hawg zero seven',
      stores: 2,
      plan: { nose: -8.1, tail: 8.2, span: 17.53 },
      shape: {
        ...TRAINER_SHAPE,
        scale: 1,
        bodyLength: 2.025, // tail point at z 8.0, the aft end of the body
        bodyRadius: 1.0,
        halfSpan: 8.765,
        rootChord: 1.53,
        tipChord: 0.99,
        sweep: 0,
        dihedral: 0.55,
        wingY: -0.45,
        wingZ: -0.02,
        wingRootX: 0,
        struts: false,
        retractable: true,
        hSpan: 2.87,
        hRootChord: 1.09,
        hZ: 3.46,
        finHeight: 2.6,
        finRootChord: 1.23,
        finSweep: 0.27,
        finZ: 3.42,
        main: { x: 2.62, y: -1.6, z: 0.9 },
        nose: { x: 0, y: -1.6, z: -4.4 }, // drawn at -5.0: see SETTLING above
        wheelR: { nose: 0.3, main: 0.45 },
        gearStiffness: 1.1,
        power: { kind: 'jet', count: 1, x: 0, y: 0.4, z: 3.4, radius: 0.6, length: 1.8 },
        canopy: 'bubble',
        hook: false,
        eye: [0, 1.05, -5.3],
      },
      aero: {
        ...TRAINER_AERO,
        mass: 5200,
        wingArea: 30,
        wingSpan: 17.53,
        chord: 2.7,
        Ixx: 48000,
        Iyy: 90000,
        Izz: 29500,
        CL0: 0.3,
        CLa: 4.5,
        alphaStall: 0.3,
        CD0: 0.03,
        k: 0.07,
        CYb: -0.4,
        Cmalpha: -0.9,
        Cmq: -16.0,
        Cmde: -1.1,
        Clb: -0.06,
        Clp: -0.5,
        Clda: 0.16,
        Cnb: 0.1,
        Cnr: -0.15,
        Cndr: 0.012,
        thrustMax: 32000,
        fuelCapacity: 3000,
        fuelBurnMax: 0.5,
        gearDragArea: 2.0,
        maxGearSpeed: 110,
        vne: 170,
        ceiling: 45000, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      },
    },
  ];
}

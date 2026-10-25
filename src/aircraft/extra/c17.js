/**
 * The Boeing C-17 Globemaster III (owner, 2026-10-21: "Boeing C-17
 * Globemaster III (4-engine heavy airlifter, high T-tail, rear cargo ramp you
 * can open / walk / drive vehicles into, short-field / dirt landings)") —
 * drawn at full size in src/fleet/extra/c17.js.
 *
 * Same contract as ./giants.js: a hand-drawn fuselage (the airlifter shape —
 * a blunt nose with the flight deck high on it, a deep square-ish hold, gear
 * sponsons on the sides, the belly swept up behind the wheels for the ramp,
 * a T-tail), the tail strike solved off the drawing, the geometry registered
 * into AIRLINER_GEOMETRY and the doors into AIRLINER_DOORS when this module
 * loads — so the camera, the seat panel, the evacuation and the jet bridges
 * know it without being edited.
 *
 * NOT A GIANT, ON PURPOSE. The real C-17 was built for short, rough strips:
 * it lands in 1,060 m at its maximum landing weight and, lightly loaded,
 * is off the ground in under a kilometre — that is what the externally
 * blown flaps and the thrust reversers that work in flight are for. So,
 * unlike the C-5 (./giants.js, `minRunway` 2,000), this one flies from the
 * 1,100 m Kestrel strip like the airliners do, on the same honest terms:
 * the real span, length and proportions, the flight model's 26 t rather
 * than the brochure's 265, a thrust-to-weight of 0.40 (the real one is 0.28
 * full and 0.57 empty) and the lift of blown flaps (CL0 0.46, the giants'
 * number). tests/features/new-aircraft.mjs flies it on Kestrel.
 *
 * THE RAMP. The hold's floor runs flat from the flight deck to a hinge at
 * C17_RAMP.hingeZ; the ramp (6.05 m, the real one's) lies along the swept
 * underside from there, and the cargo door above it closes the rest of the
 * opening and swings up inside. The model exports them as userData.cargo
 * (open / close / toggle / set / amount); src/features/cargo-ramp.js is the
 * key, the panel and the touch button, and the rule that it opens on the
 * ground or under 150 kt. Everything here is in metres in the aeroplane's
 * frame (origin at the centre of gravity, -Z forward, +Y up, +X right), and
 * nothing imports THREE: types.js runs in node and at boot before anything
 * is drawn.
 *
 * Real dimensions (Boeing's published figures): length 53.04 m, span 51.75 m
 * with the winglets, height 16.79 m, wing area 353 m², sweep 25°, four
 * F117-PW-100 turbofans of 180 kN, cargo floor 26.8 m with the ramp, 5.49 m
 * wide, 3.76 m high. No service markings: this game names no air force.
 */
import { AIRLINER_GEOMETRY, AIRLINER_DOORS, planFrom, shapeFrom } from './airliners.js';
import { station as st } from './jet-shapes.js';
import { geometryFrom, jet } from './jets.js';

/* ------------------------------------------------------------------ *
 * The fuselage
 * ------------------------------------------------------------------ */

/**
 * C-17: a short blunt nose with the windscreen high and fairly upright, a
 * near-square section 6.6 m wide and 7.2 m tall over the hold, the belly
 * rising from just behind the gear sponsons to the ramp hinge and on up to
 * a tail that ends high and narrow under the T-tail.
 */
function c17Fuselage() {
  const stations = [
    st(-24.0, -0.5, -0.5, 0.0, -0.5),
    st(-23.93, 0.1, -1.05, 0.7, -0.48),
    st(-23.7, 0.65, -1.6, 1.35, -0.45),
    st(-23.2, 1.3, -2.2, 2.0, -0.4),
    st(-22.5, 1.95, -2.65, 2.5, -0.3, 2.0, 2.2),
    st(-21.7, 2.5, -2.95, 2.85, -0.15, 2.0, 2.3),
    st(-20.8, 3.1, -3.12, 3.1, 0.0, 2.05, 2.4),
    st(-19.8, 3.6, -3.2, 3.25, 0.15, 2.1, 2.5),
    st(-18.6, 3.9, -3.2, 3.3, 0.25, 2.1, 2.5),
    st(-17.2, 4.0, -3.2, 3.3, 0.3, 2.1, 2.5),
    st(9.0, 4.0, -3.2, 3.3, 0.3, 2.1, 2.5),
    st(10.8, 4.0, -2.75, 3.25, 0.5, 2.1, 2.4),
    // The ramp hinge: the belly meets the cargo floor here.
    st(12.5, 4.0, -2.3, 3.15, 0.75, 2.1, 2.3),
    st(15.5, 4.0, -1.6, 3.0, 1.1, 2.1, 2.2),
    // The ramp's aft edge; the cargo door runs on from here.
    st(18.3, 4.0, -0.9, 2.8, 1.45, 2.1, 2.1),
    st(22.6, 3.95, 0.55, 2.3, 2.2, 2.05, 2.0),
    st(25.5, 3.85, 1.7, 1.65, 2.75),
    st(28.0, 3.65, 2.8, 0.85, 3.2),
    st(29.04, 3.45, 3.25, 0.12, 3.35),
  ];
  // Every side corner below the crown at its station (see ./giants.js).
  const panes = [
    { name: 'Windscreen', wiper: true, corners: [{ z: -21.6, x: 0.08 }, { z: -21.4, y: 2.1 }, { z: -20.75, y: 2.7 }, { z: -20.85, x: 0.08 }] },
    { name: 'Side window', corners: [{ z: -21.2, y: 2.15 }, { z: -20.3, y: 2.35 }, { z: -20.35, y: 2.95 }, { z: -20.7, y: 2.8 }] },
    { name: 'Rear side window', corners: [{ z: -20.2, y: 2.4 }, { z: -19.5, y: 2.5 }, { z: -19.55, y: 3.1 }, { z: -20.2, y: 3.0 }] },
  ];
  // The eye 15 cm higher and 15 cm nearer the glass than first drawn: the
  // nose came up 5 degrees under the horizon, where a 3-degree approach puts
  // the runway; it drops 11.5 degrees away now (the wave-8 cockpit check).
  // No nearer: 30 cm nearer gave 12.5 but sank the screens (which sit on
  // the sill's low side corners) out of the bottom of the default view.
  return { stations, panes, eye: [-0.6, 2.85, -20.15], radomeZ: -22.6, k: 1.7, tailZ: 29.04 };
}

const GLOBEMASTER = c17Fuselage();

/**
 * The ramp and the hold, for the model, the feature and the tests.
 *
 *   hingeZ, floorY  the ramp's hinge: the aft end of the flat cargo floor
 *   rampEnd         where the closed ramp's aft edge meets the cargo door
 *   doorEnd         the aft end of the cargo door on the underside
 *   length          the ramp, hinge to toe (the real one's 6.05 m)
 *   holdFront       the forward bulkhead of the hold
 *   holdWidth/holdHeight  the hold's clear section (the real 5.49 x 3.76)
 *   edgeS           the hull angle (from the top centreline) of the opening's
 *                   side edges: about 1 m above the floor at the hinge
 *   openSeconds     how long the ramp takes to come down
 */
export const C17_RAMP = Object.freeze({
  hingeZ: 12.5, floorY: -2.3, rampEnd: 18.3, doorEnd: 22.6, length: 6.05,
  holdFront: -12.0, holdWidth: 5.5, holdHeight: 3.8, edgeS: 2.086, openSeconds: 8,
});

const DESC = {
  c17: {
    span: 51.75,
    fuselage: GLOBEMASTER,
    bottom: -3.2,
    // The gear is tall: the cargo floor rides 2.2 m up (the real one 1.6),
    // which with the belly swept up from z 9 keeps the tail strike past 13
    // degrees on main wheels 4 m behind the centre of gravity.
    ground: -4.5,
    // Wheelbase 20.05 m (the real one's); the physics pivots on the rearmost
    // of the three axles each side, as the giants do.
    nose: { z: -16.05, r: 0.5 },
    main: { x: 4.6, z: 4.0, r: 0.63 },
    // The wing tip is where the winglet starts; the winglet leans out to the
    // 51.75 m span.
    tip: { x: 25.6, y: 3.0 },
    wingZ: -7.6,
    engines: [
      { x: 8.9, y: 0.9, z: -5.4, r: 1.25, length: 5.2 },
      { x: 15.6, y: 0.75, z: -2.3, r: 1.25, length: 5.2 },
    ],
  },
};

export const C17_GEOMETRY = Object.fromEntries(Object.entries(DESC).map(([id, d]) => [id, geometryFrom(d)]));
Object.assign(AIRLINER_GEOMETRY, C17_GEOMETRY);

/**
 * The doors as drawn (the AIRLINER_DOORS format, ./airliners.js): a crew
 * door each side forward and a paratroop door each side aft, ahead of the
 * ramp. Measured off the built model; tests/features/new-aircraft.mjs holds
 * the table to the drawing to 2 cm. `freighter: true` on the roster entry
 * says there is no cabin to empty.
 */
export const C17_DOORS = {
  c17: [
    { id: "L1", side: "left", deck: "main", kind: "passenger", x: -3.207, y: -0.9, z: -17, w: 0.9, h: 1.8, sill: -1.8, normal: [-0.981,-0.194,0] },
    { id: "R1", side: "right", deck: "main", kind: "passenger", x: 3.207, y: -0.9, z: -17, w: 0.9, h: 1.8, sill: -1.8, normal: [0.981,-0.194,0] },
    { id: "PL1", side: "left", deck: "main", kind: "passenger", x: -3.185, y: -0.9, z: 9.6, w: 0.9, h: 1.8, sill: -1.8, normal: [-0.974,-0.216,0] },
    { id: "PR1", side: "right", deck: "main", kind: "passenger", x: 3.185, y: -0.9, z: 9.6, w: 0.9, h: 1.8, sill: -1.8, normal: [0.974,-0.216,0] },
  ],
};
Object.assign(AIRLINER_DOORS, C17_DOORS);

export function TYPES(base) {
  const G = C17_GEOMETRY;
  return [
    {
      id: 'c17',
      name: 'Boeing C-17 Globemaster III',
      class: 'Airliner',
      category: 'military',
      military: true,
      // Military, not a combat jet (carrier/who.js): no carrier start, no
      // hook, no guns, no missiles.
      transport: true,
      longHaul: true,
      freighter: true,
      cargoRamp: true,
      cockpit: 'big-jet',
      blurb:
        'The air force\'s workhorse: four big engines under a high wing, a T-tail and a ramp at the ' +
        'back that comes down so trucks drive straight in. Built for short, rough strips — it lands ' +
        'in a kilometre and gets off the ground in less — so it is the one heavy that is at home ' +
        'on the Kestrel strip. Press 6 to open the ramp.',
      stats: { speed: 3, handling: 2, ease: 3 },
      livery: '#6f777f',
      accent: '#4a5157',
      callsign: 'Reach one seven heavy',
      price: 2200,
      why: 'Lands on a dirt strip, opens at the back',
      takeoffFlaps: 2,
      plan: planFrom(G.c17),
      shape: shapeFrom(G.c17, base, {
        radius: 3.3, wingRootX: 1.5, rootChord: 10.6, tipChord: 2.4, sweep: 11.2, rootY: 3.6,
        hSpan: 9.4, hRootChord: 4.6, hZ: 24.0, finHeight: 8.5, finRootChord: 11.0, finSweep: 6.5, finZ: 17.5,
        gearStiffness: 1.7,
      }),
      aero: jet(base, G.c17, {
        // Blown flaps: more lift at zero alpha than the airliners' 0.40 and
        // the giants' lower stall guard (the tail is 25 m behind the wheels),
        // the jets' drag. The wing loading sits between the airliners' 200
        // and the giants' 250: at the airliners' it floated on landing — the
        // wing still carrying most of the weight at 96 kt, the wheels too
        // light to brake — and used the whole Kestrel strip to stop.
        CL0: 0.44, alphaStall: 0.2, CD0: 0.026, k: 0.04,
        mass: 26000, wingArea: 110, wingSpan: 51.75, chord: 6.8,
        Clda: 0.11, Cmq: -32.0,
        // Big turbofans idle low: at the default 0.18 the four engines' idle
        // (21 kN) beat the brakes and it crept at 3.4 m/s with them full on,
        // never counting as stopped. At 0.12 it creeps at 2.3 and stops; at
        // 0.08 an idle approach sank at 6 m/s and arrived too hard.
        idleRpm: 0.12,
        thrustMax: 102000, fuelCapacity: 20000, fuelBurnMax: 0.85,
        gearDragArea: 3.6, maxGearSpeed: 125, vne: 170,
        ceiling: 45000, // service ceiling, ft (published); above it the air thins faster (physics.js ceilingFactor)
      }),
    },
  ];
}

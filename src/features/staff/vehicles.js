/**
 * The ramp crew's vehicles, as specs the game's own driving code runs.
 *
 * src/vehicles/ belongs to the team rebuilding the car and the boat, so this
 * does not edit it. It adds four entries to the VEHICLES table that
 * surface.js exports, at import time, each one the van's spec with its own
 * numbers over the top — so `sim.startDrive('tug')` builds a SurfaceVehicle
 * that drives with the van's physics and the tug's size and speed.
 *
 * `kind: 'car'` is what makes the car physics, the car's pedals and the
 * car's HUD apply; `staff: true` is how everything else (onfoot.js, the
 * tests) tells these apart from the van.
 *
 * Top speeds are real ones: a pushback tug does about 25 km/h on its own,
 * a baggage tractor 30, the trucks 35. Drag is set so that is where the
 * engine and the drag balance on tarmac, the same rule the van's spec uses.
 */

import * as SURF from '../../vehicles/surface.js';

export const STAFF_IDS = ['tug', 'baggage', 'stairs', 'catering'];

const TARMAC_ROLL = 0.45;

const SPECS = {
  tug: {
    name: 'Pushback Tug',
    blurb: 'Low, heavy and slow. It pushes aeroplanes backwards off the stand.',
    topSpeed: 7,
    accel: 2.4,
    brakeDecel: 5,
    reverseFrac: 0.6,
    wheelbase: 2.8,
    track: 2.2,
    latGrip: 6.5,
    steerLockMax: 40,
    halfLength: 2.85,
    halfWidth: 1.3,
    height: 2.3,
    eye: [-0.55, 1.9, 1.3],
  },
  baggage: {
    name: 'Baggage Tractor',
    blurb: 'Tows the baggage carts. Mind the corners: they follow you round them.',
    topSpeed: 8.5,
    accel: 2.8,
    brakeDecel: 5.5,
    reverseFrac: 0.4,
    wheelbase: 1.8,
    track: 1.36,
    latGrip: 6,
    steerLockMax: 42,
    halfLength: 1.55,
    halfWidth: 0.78,
    height: 2.2,
    eye: [0, 1.75, 0.25],
  },
  stairs: {
    name: 'Stair Truck',
    blurb: 'A flight of steps on wheels. Drive it nose-first up to the door.',
    topSpeed: 9.5,
    accel: 2.4,
    brakeDecel: 5.5,
    reverseFrac: 0.35,
    wheelbase: 4.3,
    track: 2.0,
    latGrip: 6,
    steerLockMax: 36,
    halfLength: 3.6,
    halfWidth: 1.1,
    height: 3.2,
    eye: [0, 2.05, -2.7],
  },
  catering: {
    name: 'Catering Truck',
    blurb: 'Brings the food. The box lifts right up to the galley door.',
    topSpeed: 10,
    accel: 2.3,
    brakeDecel: 5.5,
    reverseFrac: 0.35,
    wheelbase: 5.2,
    track: 2.04,
    latGrip: 6,
    steerLockMax: 34,
    halfLength: 4.1,
    halfWidth: 1.2,
    height: 3.6,
    eye: [0, 2.1, -3.2],
  },
};

/**
 * Put the four specs into the game's table. Safe to call twice; will not
 * overwrite a vehicle of the same name that somebody else registered.
 * Returns the ids it registered.
 */
export function registerStaffVehicles(table = SURF.VEHICLES) {
  const done = [];
  if (!table || typeof table !== 'object') return done;
  const base = table.car || {};
  for (const id of STAFF_IDS) {
    if (table[id] && !table[id].staff) continue;
    const sp = SPECS[id];
    table[id] = {
      ...base,
      ...sp,
      id,
      kind: 'car',
      staff: true,
      // Flat push, as these were tuned: the van's engine now fades with speed
      // (powerFall), and inheriting that with this drag left them at ~75% of
      // their top speed. Airport tugs are electric; flat torque is right.
      powerFall: 0,
      dragK: (sp.accel - TARMAC_ROLL) / (sp.topSpeed * sp.topSpeed),
      rideHeight: 0.02,
      rackMargin: 1.1,
      bodyRoll: 0.05,
      bobAmp: 0,
      offElement: 'You drove into the water',
    };
    done.push(id);
  }
  return done;
}

registerStaffVehicles();

export function isStaffVehicle(v) {
  return !!(v && v.spec && v.spec.staff);
}

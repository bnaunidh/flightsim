/**
 * The apron vehicles' footprints, for keeping people out of them (wave 18:
 * features/life/crowd.js, and the apron's own vehicles yielding in
 * world/apron.js). In each vehicle's own frame — -Z forward, +X right, the
 * origin where its model's is: half-width, and the z of its front and back.
 * Measured off the shapes in world/airport-vehicles.js and the airside bus
 * in features/life/vans.js. Pure data: node tests import it directly.
 */
export const FOOT = Object.freeze({
  tug: { hw: 1.35, z0: -2.85, z1: 2.85 },
  stairTruck: { hw: 1.2, z0: -3.6, z1: 3.6 },
  cateringTruck: { hw: 1.3, z0: -3.9, z1: 4.2 },
  fuelTruck: { hw: 1.3, z0: -4.9, z1: 4.7 },
  beltLoader: { hw: 1.0, z0: -3.4, z1: 2.8 },
  tractor: { hw: 0.85, z0: -1.7, z1: 1.4 },
  cart: { hw: 0.82, z0: -1.5, z1: 1.25 },
  gpu: { hw: 0.72, z0: -1.12, z1: 1.12 },
  bus: { hw: 1.45, z0: -6.75, z1: 6.75 },
  followMe: { hw: 0.95, z0: -2.4, z1: 2.4 },
});

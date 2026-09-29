/**
 * The ground crew's vehicles, as shapes.
 *
 * Each function returns one merged, vertex-coloured BufferGeometry in the
 * vehicle's own frame: -Z forward, +X right, y = 0 on the ground, origin in
 * the middle of its wheelbase. apron.js draws every vehicle of a kind with one
 * InstancedMesh, so a tug costs the same whether there is one on the field or
 * twenty.
 *
 * Parts that move on their own — the stairs, the catering box and its scissor,
 * the belt — are separate geometries built at UNIT size along the axis that
 * moves, so an instance matrix can stretch them: a stair built one unit high
 * and scaled to 4.9 m reaches a jumbo's door, and scaled to 2.5 m a
 * Meridian's, with the treads spaced to match.
 *
 * Sizes are real ones, rounded: a TUG 5.4 m long, a stair truck 7 m, a
 * catering truck 8 m with a box that lifts to 5.5 m, a baggage cart 2.6 m.
 */

import * as THREE from '../vendor/three.module.js';
import { Batch, trs, trse } from './airport-kit.js';

const YELLOW = 0xe9b925;
const WHITE = 0xe9ecee;
const GREY = 0x8d949c;
const DARK = 0x262b31;
const TYRE = 0x17191c;
const STEEL = 0xa7aeb6;
const GLASS = 0x2f3d4a;
const RED = 0xc8322a;
const ORANGE = 0xf06a1d;
const BLUE = 0x2f5f9e;
const GREEN = 0x2f8f5b;

const _m = new THREE.Matrix4();

/** Four (or six) tyres, lying on their sides. */
function tyres(b, halfTrack, axles, r, width = 0.35) {
  for (const z of axles) {
    for (const s of [-1, 1]) {
      b.cyl(r, r, width, s * halfTrack, r - width / 2, z, TYRE, 10, {
        matrix: trse(s * halfTrack, r, z, 0, 0, Math.PI / 2, 1, 1, 1, _m),
      });
    }
  }
}

/** A truck cab: box, windscreen, roof. `front` is its forward face (z). */
function cab(b, w, h, len, front, color, y0 = 0.7) {
  b.slab(-w / 2, w / 2, y0, y0 + h, front, front + len, color);
  // Windscreen and side windows as dark insets.
  b.slab(-w / 2 + 0.12, w / 2 - 0.12, y0 + h * 0.5, y0 + h - 0.12, front - 0.02, front + 0.05, GLASS);
  for (const s of [-1, 1]) b.slab(s * (w / 2) - 0.02, s * (w / 2) + 0.02, y0 + h * 0.5, y0 + h - 0.15, front + 0.2, front + len - 0.3, GLASS);
  b.slab(-w / 2 - 0.05, w / 2 + 0.05, y0 + h, y0 + h + 0.08, front - 0.05, front + len + 0.05, DARK);
  // A beacon on the roof. Its glow is a separate Points in apron.js.
  b.cyl(0.1, 0.12, 0.16, 0, y0 + h + 0.08, front + len / 2, ORANGE, 8);
}

/* ------------------------------------------------------------------ */

/**
 * Pushback tug with its towbar. The bar's tip — where it pins to the nose
 * gear — is `TUG_BAR_TIP` metres ahead of the origin.
 */
export const TUG_BAR_TIP = 7.4;
export function tugGeometry() {
  const b = new Batch();
  // Low, wide, heavy body with a sloped nose.
  b.slab(-1.3, 1.3, 0.35, 1.25, -2.7, 2.7, YELLOW);
  b.box(2.5, 0.5, 1.2, 0, 1.05, -2.35, YELLOW, 0);
  b.slab(-1.35, 1.35, 0.25, 0.45, -2.85, 2.85, DARK); // rubbing strip
  // A low sunken cab to one side, as real tugs have, so the driver sees past the nose.
  b.slab(-1.2, 0.1, 1.25, 2.35, 0.2, 1.8, YELLOW);
  b.slab(-1.15, 0.05, 1.8, 2.3, 0.18, 0.22, GLASS);
  b.slab(-1.25, 0.15, 2.35, 2.45, 0.1, 1.9, DARK);
  b.cyl(0.1, 0.12, 0.16, -0.55, 2.45, 1.0, ORANGE, 8);
  tyres(b, 1.15, [-1.8, 1.8], 0.55, 0.45);
  // Towbar: A-frame from the tug's nose to a hitch at the tip.
  b.tube(-0.5, 0.55, -2.85, 0, 0.5, -TUG_BAR_TIP + 0.25, 0.07, STEEL);
  b.tube(0.5, 0.55, -2.85, 0, 0.5, -TUG_BAR_TIP + 0.25, 0.07, STEEL);
  b.cyl(0.14, 0.14, 0.3, 0, 0.35, -TUG_BAR_TIP + 0.1, DARK, 8);
  // Small wheels near the bar's tip.
  b.cyl(0.18, 0.18, 0.12, -0.25, 0.18, -TUG_BAR_TIP + 1.0, TYRE, 8, { matrix: trse(-0.25, 0.18, -TUG_BAR_TIP + 1.0, 0, 0, Math.PI / 2, 1, 1, 1, _m) });
  b.cyl(0.18, 0.18, 0.12, 0.25, 0.18, -TUG_BAR_TIP + 1.0, TYRE, 8, { matrix: trse(0.25, 0.18, -TUG_BAR_TIP + 1.0, 0, 0, Math.PI / 2, 1, 1, 1, _m) });
  return b.geometry();
}

/** Where the tug's beacon is, in its own frame. */
export const TUG_BEACON = [-0.55, 2.6, 1.0];

/* ------------------------------------------------------------------ */

/**
 * Stair truck chassis: cab at the front, a flat bed behind it that the stair
 * unit sits on. The stairs themselves are `stairGeometry`.
 */
export const STAIR_BED_Y = 1.25;
export const STAIR_FRONT = -3.4; // the top platform's front edge, in truck z
export function stairTruckGeometry() {
  const b = new Batch();
  b.slab(-1.15, 1.15, 0.55, STAIR_BED_Y, -3.1, 3.4, WHITE);
  cab(b, 2.2, 1.4, 1.8, -3.1, WHITE, 0.6);
  b.slab(-1.2, 1.2, 0.45, 0.62, -3.3, 3.5, BLUE); // livery stripe
  tyres(b, 1.0, [-2.3, 2.2], 0.45);
  return b.geometry();
}

/**
 * Unit stairs: the flight rises from the back of the bed (z = +3.1, y = 0) to
 * a platform at the front (z = STAIR_FRONT, y = 1), where y = 1 is scaled to
 * the door sill above the bed. Rails both sides and round the platform.
 */
export function stairGeometry() {
  const b = new Batch();
  const steps = 14;
  const z0 = 3.1;
  const z1 = -1.6; // top of the flight
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const z = z0 + (z1 - z0) * t;
    b.box(1.5, 0.04, 0.34, 0, t, z, STEEL);
  }
  // Stringers.
  for (const s of [-0.8, 0.8]) {
    b.tube(s, 0, z0, s, 1, z1, 0.05, GREY, 5);
    // Handrail, a metre above.
    b.tube(s, 0.9 / 4, z0, s, 1 + 0.9 / 4, z1, 0.03, WHITE, 4);
  }
  // Platform and its rail.
  b.slab(-0.9, 0.9, 0.97, 1.0, STAIR_FRONT, z1, STEEL);
  for (const s of [-0.9, 0.9]) b.slab(s - 0.03, s + 0.03, 1.0, 1.0 + 0.9 / 4, STAIR_FRONT + 0.2, z1, WHITE);
  // Support legs from the bed to the platform.
  for (const s of [-0.7, 0.7]) b.tube(s, 0, -1.4, s, 0.97, -1.4, 0.06, GREY, 5);
  // A canopy over the platform.
  b.slab(-1.0, 1.0, 1.0 + 2.1 / 4, 1.0 + 2.2 / 4, STAIR_FRONT - 0.1, z1 + 0.1, WHITE);
  return b.geometry();
}

/* ------------------------------------------------------------------ */

/** Catering truck: chassis and cab. The box and the scissor lift are separate. */
export const CATER_BED_Y = 1.3;
export const CATER_FRONT = -3.9; // the box's serving platform front edge
export function cateringTruckGeometry() {
  const b = new Batch();
  b.slab(-1.2, 1.2, 0.6, CATER_BED_Y, -2.6, 4.2, GREY);
  cab(b, 2.3, 1.6, 1.8, -4.3, WHITE, 0.65);
  tyres(b, 1.05, [-3.1, 2.9], 0.5);
  // Stabiliser legs at the corners, down on the ground while it is lifted.
  for (const [x, z] of [[-1.3, -2.2], [1.3, -2.2], [-1.3, 3.8], [1.3, 3.8]]) {
    b.slab(x - 0.12, x + 0.12, 0.05, 0.9, z - 0.12, z + 0.12, STEEL);
  }
  return b.geometry();
}

/**
 * The insulated box and its serving platform, with its floor at y = 0. The
 * front of the platform, which bridges the gap to the door, is CATER_FRONT.
 */
export function cateringBoxGeometry() {
  const b = new Batch();
  b.slab(-1.25, 1.25, 0, 2.6, -2.2, 3.4, WHITE);
  b.slab(-1.27, 1.27, 1.7, 2.2, -2.22, 3.42, GREEN); // company band
  b.slab(-1.3, 1.3, -0.12, 0.02, CATER_FRONT, 3.5, STEEL);
  // Platform rails.
  for (const s of [-1.28, 1.28]) b.slab(s - 0.03, s + 0.03, 0.02, 1.0, CATER_FRONT + 0.1, -2.2, WHITE);
  b.slab(-1.2, 1.2, 0.3, 2.3, -2.24, -2.2, DARK); // the doorway in the box
  return b.geometry();
}

/** One pair of crossed scissor arms, unit high (y 0..1), 3.8 m long. */
export function scissorGeometry() {
  const b = new Batch();
  for (const s of [-1.0, 1.0]) {
    b.tube(s, 0, -1.6, s, 1, 2.4, 0.08, STEEL, 5);
    b.tube(s, 0, 2.4, s, 1, -1.6, 0.08, STEEL, 5);
  }
  b.tube(-1.0, 0.5, 0.4, 1.0, 0.5, 0.4, 0.06, GREY, 5);
  return b.geometry();
}

/* ------------------------------------------------------------------ */

/** Fuel bowser: cab and an elliptical tank. The hose is drawn separately. */
export const FUEL_HOSE_REEL = [0.9, 1.4, 3.6];
export function fuelTruckGeometry() {
  const b = new Batch();
  b.slab(-1.2, 1.2, 0.6, 1.1, -3.0, 4.4, DARK);
  cab(b, 2.4, 1.7, 2.1, -4.9, WHITE, 0.65);
  // Laid along Z by the rotation; the scale is applied before it, so the
  // squash that makes the section elliptical is on the cylinder's own Z.
  const tank = new THREE.CylinderGeometry(1.25, 1.25, 7.0, 16, 1, false);
  b.add(tank, trse(0, 2.2, 0.8, Math.PI / 2, 0, 0, 1, 1, 0.78, _m), WHITE);
  tank.dispose();
  for (const z of [-2.7, 4.3]) {
    const cap = new THREE.SphereGeometry(1.25, 14, 8);
    b.add(cap, trse(0, 2.2, z, 0, 0, 0, 1, 0.78, 0.3, _m), WHITE);
    cap.dispose();
  }
  b.slab(-1.27, 1.27, 1.9, 2.25, -2.6, 4.2, RED); // band
  b.slab(0.6, 1.3, 0.9, 1.9, 3.1, 4.3, GREY); // hose cabinet
  b.cyl(0.5, 0.5, 0.35, FUEL_HOSE_REEL[0], FUEL_HOSE_REEL[1] - 0.18, FUEL_HOSE_REEL[2], DARK, 12, {
    matrix: trse(FUEL_HOSE_REEL[0] + 0.25, FUEL_HOSE_REEL[1], FUEL_HOSE_REEL[2], 0, 0, Math.PI / 2, 1, 1, 1, _m),
  });
  tyres(b, 1.05, [-3.6, 2.2, 3.6], 0.5);
  return b.geometry();
}

/* ------------------------------------------------------------------ */

/** Belt loader chassis. The belt is `beltGeometry`, unit high. */
export const BELT_FRONT = -3.4;
export function beltLoaderGeometry() {
  const b = new Batch();
  b.slab(-0.95, 0.95, 0.35, 0.8, -2.6, 2.8, YELLOW);
  b.slab(0.2, 0.95, 0.8, 2.0, 1.4, 2.6, YELLOW); // driver's seat pod
  b.slab(0.25, 0.9, 1.4, 1.95, 1.38, 1.42, GLASS);
  tyres(b, 0.85, [-1.9, 1.9], 0.35, 0.25);
  return b.geometry();
}
/** The belt: from the back of the chassis (y 0) up to the hold sill at the front (y 1). */
export function beltGeometry() {
  const b = new Batch();
  const z0 = 2.8;
  const z1 = BELT_FRONT;
  // A flat conveyor, as a thin box sheared along the slope.
  const g = new THREE.BoxGeometry(1.0, 0.12, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getZ(i) + 0.5; // 0 at the back, 1 at the front
    p.setZ(i, z0 + (z1 - z0) * t);
    p.setY(i, p.getY(i) + t);
  }
  g.computeVertexNormals();
  b.add(g, trs(0, 0, 0, 0, 1, 1, 1, _m), DARK);
  g.dispose();
  for (const s of [-0.55, 0.55]) b.tube(s, 0.1, z0, s, 1.1, z1, 0.05, YELLOW, 4);
  return b.geometry();
}

/* ------------------------------------------------------------------ */

/** Baggage tractor. */
export function baggageTractorGeometry() {
  const b = new Batch();
  b.slab(-0.8, 0.8, 0.35, 1.05, -1.3, 1.3, BLUE);
  b.slab(-0.75, 0.75, 1.05, 1.9, 0.0, 1.2, BLUE);
  b.slab(-0.72, 0.72, 1.35, 1.85, -0.02, 0.02, GLASS);
  b.slab(-0.85, 0.85, 1.9, 2.0, -0.1, 1.3, DARK);
  b.cyl(0.08, 0.1, 0.14, 0, 2.0, 0.6, ORANGE, 8);
  tyres(b, 0.72, [-0.85, 0.85], 0.36, 0.26);
  b.tube(0, 0.45, 1.3, 0, 0.45, 1.9, 0.05, STEEL, 4);
  return b.geometry();
}

/** A baggage cart with a canvas cover. Colour per instance comes from instanceColor. */
export function baggageCartGeometry() {
  const b = new Batch();
  b.slab(-0.8, 0.8, 0.45, 0.62, -1.2, 1.2, 0x9aa1a8);
  b.slab(-0.78, 0.78, 0.62, 1.7, -1.1, 1.1, 0xffffff); // the load, tinted per cart
  for (const [x, z] of [[-0.78, -1.15], [0.78, -1.15], [-0.78, 1.15], [0.78, 1.15]]) b.slab(x - 0.04, x + 0.04, 0.62, 1.8, z - 0.04, z + 0.04, STEEL);
  b.slab(-0.82, 0.82, 1.78, 1.84, -1.2, 1.2, 0xcfd3d6); // roof
  tyres(b, 0.7, [-0.8, 0.8], 0.24, 0.16);
  b.tube(0, 0.45, -1.2, 0, 0.45, -1.9, 0.04, STEEL, 4);
  return b.geometry();
}

/* ------------------------------------------------------------------ */

/** Ground power unit on a little trailer. */
export function gpuGeometry() {
  const b = new Batch();
  b.slab(-0.7, 0.7, 0.4, 1.5, -1.1, 1.1, YELLOW);
  b.slab(-0.72, 0.72, 1.2, 1.3, -1.12, 1.12, DARK);
  tyres(b, 0.6, [-0.7, 0.7], 0.28, 0.2);
  b.tube(0, 0.4, -1.1, 0, 0.3, -1.8, 0.04, STEEL, 4);
  return b.geometry();
}

/** Airport crash tender: big, red, six wheels, a roof monitor. */
export function fireEngineGeometry() {
  const b = new Batch();
  b.slab(-1.35, 1.35, 0.8, 3.1, -2.8, 5.0, RED);
  cab(b, 2.7, 1.6, 2.3, -5.2, RED, 0.9);
  b.slab(-1.37, 1.37, 1.4, 1.65, -5.2, 5.0, 0xf2d24a); // reflective stripe
  b.slab(-1.2, 1.2, 3.1, 3.3, -2.6, 4.6, STEEL); // roof walkway
  b.cyl(0.35, 0.4, 0.4, 0, 3.3, -1.6, DARK, 10);
  b.tube(0, 3.8, -1.6, 0, 3.9, -3.4, 0.12, STEEL, 6); // monitor
  b.cyl(0.1, 0.12, 0.16, -0.8, 2.6, -3.9, 0x3a7bff, 8);
  b.cyl(0.1, 0.12, 0.16, 0.8, 2.6, -3.9, 0x3a7bff, 8);
  tyres(b, 1.2, [-3.6, 1.6, 3.7], 0.65, 0.5);
  return b.geometry();
}

/**
 * A car for the car park. Body colour comes from instanceColor. Boxes only —
 * a hub's car park holds a hundred and twenty of these, and round tyres made
 * each one 232 triangles; square ones nobody can see from the air make it 96.
 */
export function carGeometry() {
  const b = new Batch();
  b.slab(-0.88, 0.88, 0.3, 0.95, -2.2, 2.2, 0xffffff);
  b.slab(-0.8, 0.8, 0.95, 1.45, -0.9, 1.1, 0xffffff);
  b.slab(-0.82, 0.82, 1.0, 1.38, -0.95, -0.85, GLASS);
  b.slab(-0.82, 0.82, 1.0, 1.38, 1.05, 1.15, GLASS);
  for (const s of [-1, 1]) b.slab(s * 0.81 - 0.01, s * 0.81 + 0.01, 1.0, 1.38, -0.8, 1.0, GLASS);
  for (const z of [-1.35, 1.35]) b.slab(-0.9, 0.9, 0.0, 0.6, z - 0.3, z + 0.3, TYRE);
  return b.geometry();
}

/** "Follow me": a small van with a chequered board on its roof. */
export function followMeGeometry() {
  const b = new Batch();
  b.slab(-0.9, 0.9, 0.3, 1.9, -2.3, 2.3, YELLOW);
  b.slab(-0.85, 0.85, 1.2, 1.8, -2.32, -2.28, GLASS);
  for (let i = 0; i < 6; i++) {
    b.slab(-0.9 + i * 0.3, -0.6 + i * 0.3, 2.0, 2.45, -0.05, 0.05, i % 2 ? DARK : YELLOW);
  }
  b.slab(-0.95, 0.95, 1.9, 2.0, -0.2, 0.2, DARK);
  b.cyl(0.08, 0.1, 0.14, -0.6, 1.9, 1.2, ORANGE, 8);
  b.cyl(0.08, 0.1, 0.14, 0.6, 1.9, 1.2, ORANGE, 8);
  tyres(b, 0.8, [-1.4, 1.4], 0.34, 0.24);
  return b.geometry();
}

/** A traffic cone, orange with a white band. */
export function coneGeometry() {
  const b = new Batch();
  b.slab(-0.22, 0.22, 0, 0.04, -0.22, 0.22, 0x222222);
  b.cyl(0.03, 0.17, 0.3, 0, 0.04, 0, ORANGE, 8);
  b.cyl(0.09, 0.12, 0.12, 0, 0.34, 0, 0xf4f4f4, 8);
  b.cyl(0.02, 0.09, 0.28, 0, 0.46, 0, ORANGE, 8);
  return b.geometry();
}

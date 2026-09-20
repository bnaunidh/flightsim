/**
 * The boat and the car, built from primitives like everything else here.
 *
 * Neither is trying to be a beautiful model. Each is trying to be instantly
 * readable from the outside camera at the distance you actually drive it from:
 * a hull with a wake, and a van with wheels that turn. Detail beyond that is
 * invisible in motion and costs frames.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp } from '../core/noise.js';

/*
 * The boat and the car come from the model pack.
 *
 * What was here was eight untextured boxes each — a white box hull with a dark
 * box on it, and the car the same idea with wheels on sticks. Two of the four
 * games looked like placeholder art, because they were.
 *
 * The pack draws a chined planing hull with a helm, a windscreen, rails and a
 * steerable outboard, and a van with recessed wheel arches, glass you can see
 * through, mirrors, doors and a roof beacon. Both are kept behind a try, and
 * the boxes below stay as the fallback: a game that will not start is worse
 * than one that looks plain.
 */
let packBoat = null;
let packCar = null;
try {
  ({ createPlayerBoat: packBoat } = await import('../fleet/maritime.js'));
  ({ createAirfieldRunabout: packCar } = await import('../fleet/ground.js'));
} catch (e) {
  console.warn('The pack vehicles are unavailable; using the built-in ones.', e);
}

function mat(color, { rough = 0.7, metal = 0.1 } = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
}

/** A small planing launch: hull, cabin, screen, and a wake behind it. */
export function createBoat() {
  if (packBoat) {
    try {
      const b = packBoat();
      b.userData.fromPack = true;
      return b;
    } catch (e) {
      console.warn('The pack boat could not be built; using the built-in one.', e);
    }
  }
  const g = new THREE.Group();
  g.name = 'boat';

  const hullMat = mat(0xf2f4f6, { rough: 0.4 });
  const deckMat = mat(0x2b3a48, { rough: 0.75 });
  const trimMat = mat(0x1f6fb0, { rough: 0.45 });

  // Hull: a box tapering to a bow, which reads as a boat from any angle.
  const hull = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.0, 7.4), hullMat);
  hull.position.y = 0.2;
  hull.castShadow = true;
  g.add(hull);

  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.32, 2.6, 4), hullMat);
  bow.rotation.x = -Math.PI / 2;
  bow.rotation.y = Math.PI / 4;
  bow.position.set(0, 0.2, -4.6);
  g.add(bow);

  // A blue stripe along the waterline, which is what makes it look like a boat
  // rather than a crate.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.66, 0.18, 7.0), trimMat);
  stripe.position.y = -0.12;
  g.add(stripe);

  const deck = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 6.6), deckMat);
  deck.position.y = 0.72;
  g.add(deck);

  // Cabin and windscreen.
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 2.1), hullMat);
  cabin.position.set(0, 1.22, 0.6);
  cabin.castShadow = true;
  g.add(cabin);
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(1.55, 0.62, 0.08),
    new THREE.MeshPhysicalMaterial({ color: 0x9fc8dd, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.55 })
  );
  screen.position.set(0, 1.34, -0.48);
  screen.rotation.x = -0.32;
  g.add(screen);

  // The wake: two spray sheets that grow with speed.
  const wakeMat = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const wake = new THREE.Group();
  for (const side of [-1, 1]) {
    const geo = new THREE.PlaneGeometry(6, 1.6);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, wakeMat);
    m.position.set(side * 1.7, -0.18, 2.6);
    m.rotation.y = side * 0.22;
    wake.add(m);
  }
  g.add(wake);
  g.userData.wakeMat = wakeMat;
  return g;
}

/** A small airside van, with wheels that steer and roll. */
export function createCar() {
  if (packCar) {
    try {
      const c = packCar();
      c.userData.fromPack = true;
      return c;
    } catch (e) {
      console.warn('The pack car could not be built; using the built-in one.', e);
    }
  }
  const g = new THREE.Group();
  g.name = 'car';

  const bodyMat = mat(0xe8eaee, { rough: 0.45 });
  const trimMat = mat(0xe0a838, { rough: 0.5 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0x8fb4cc, roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.6,
  });
  const tyreMat = mat(0x16181c, { rough: 0.95 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.05, 4.2), bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  g.add(body);

  const cab = new THREE.Mesh(new THREE.BoxGeometry(1.74, 0.72, 1.7), bodyMat);
  cab.position.set(0, 1.72, -0.7);
  cab.castShadow = true;
  g.add(cab);

  for (const [z, w] of [[-1.56, 1.6], [0.16, 1.72]]) {
    const win = new THREE.Mesh(new THREE.BoxGeometry(w, 0.56, 0.06), glassMat);
    win.position.set(0, 1.74, z);
    g.add(win);
  }

  // The high-visibility stripe every airside vehicle wears.
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(1.94, 0.24, 4.24), trimMat);
  stripe.position.y = 1.18;
  g.add(stripe);

  const wheels = [];
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14);
  wheelGeo.rotateZ(Math.PI / 2);
  for (const [x, z, steers] of [
    [-1.0, -1.35, true],
    [1.0, -1.35, true],
    [-1.0, 1.35, false],
    [1.0, 1.35, false],
  ]) {
    const w = new THREE.Mesh(wheelGeo, tyreMat);
    w.position.set(x, 0.42, z);
    w.castShadow = true;
    g.add(w);
    wheels.push({ mesh: w, steers });
  }
  g.userData.wheels = wheels;
  return g;
}

/** Per-frame dressing: wake opacity, wheel spin and steering. */
export function updateVehicleModel(model, vehicle, dt) {
  if (!model) return;

  /*
   * The pack's vehicles animate themselves from a state object. Everything it
   * wants, the SurfaceVehicle already knows — it just calls the fields
   * something else, which is the whole job of this block.
   */
  if (model.userData.fromPack && model.userData.update) {
    const r = vehicle.readouts();
    const boat = vehicle.spec.kind === 'boat';
    model.userData.update(dt, {
      speed: vehicle.speed,
      speedMps: Math.abs(vehicle.speed),
      steer: vehicle.steer,
      steering: vehicle.steer,
      braking: (vehicle.brakes || 0) > 0.05,
      // No suspension model on a 3-DOF vehicle, so the body squats with
      // acceleration instead — which is the part you actually see.
      suspension: boat ? 0 : clamp(Math.abs(vehicle.throttle || 0) * 0.05, 0, 0.16),
      headlights: true,
      beacon: !boat,
      lights: true,
      hazard: false,
      doorOpen: 0,
    });
    return;
  }

  if (model.userData.wakeMat) {
    const v = Math.abs(vehicle.speed) / vehicle.spec.topSpeed;
    model.userData.wakeMat.opacity = Math.min(0.55, v * 0.7);
  }
  if (model.userData.wheels) {
    const spin = (vehicle.speed / 0.42) * dt;
    for (const w of model.userData.wheels) {
      w.mesh.rotation.x += spin;
      if (w.steers) w.mesh.rotation.y = -vehicle.steer * 0.5;
    }
  }
}

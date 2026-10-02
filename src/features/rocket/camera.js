/**
 * The rocket's camera.
 *
 * Every view looks at the rocket from the same side of its flight, so the
 * direction it is flying is always to the RIGHT of the screen. That is what
 * lets the controls be two arrows: ▶ leans the rocket right on the screen,
 * in every view, the whole way to orbit and the whole way down again.
 *
 *   Side     the default. Close beside it low down; as it climbs the camera
 *            rises and looks down past it, so from space you see the planet
 *            curving away under the rocket, the island a speck on it.
 *   Onboard  a camera on the rocket looking down its side, the way real
 *            launches are filmed: the flame, and the ground falling away.
 *   Wide     pulled far back — the whole curve of the planet.
 *   Ground   a tracking camera on the ground by the pad, as on a launch
 *            broadcast. Only near the pad; after that it hands over to Side.
 *
 * The offset from the rocket is smoothed, never the camera's position: the
 * rocket does two kilometres a second, and smoothing a position that fast
 * is how a camera ends up a kilometre behind what it is filming.
 */

import * as THREE from '../../vendor/three.module.js';

export const VIEWS = ['side', 'onboard', 'wide', 'ground'];
export const VIEW_NAMES = { side: 'Side', onboard: 'Onboard', wide: 'Wide', ground: 'Ground' };

const V1 = new THREE.Vector3();
const V2 = new THREE.Vector3();
const V3 = new THREE.Vector3();
const D1 = new THREE.Vector3();
const D2 = new THREE.Vector3();

function smooth(t) {
  return t * t * (3 - 2 * t);
}

export class RocketCamera {
  constructor(camera) {
    this.camera = camera;
    this.saved = { fov: camera.fov, near: camera.near, far: camera.far, up: camera.up.clone() };
    this.view = 'side';
    this.offset = new THREE.Vector3();
    this.hasOffset = false;
    this.moment = 0;
    this.momentLen = 7;
    this.fov = 55;
    this.groundPos = null;
  }

  restore() {
    const c = this.camera;
    c.fov = this.saved.fov;
    c.near = this.saved.near;
    c.far = this.saved.far;
    c.up.copy(this.saved.up);
    c.updateProjectionMatrix();
  }

  cycle(canGround) {
    let i = VIEWS.indexOf(this.view);
    for (let k = 0; k < VIEWS.length; k++) {
      i = (i + 1) % VIEWS.length;
      if (VIEWS[i] !== 'ground' || canGround) break;
    }
    this.view = VIEWS[i];
    this.hasOffset = false;
    return this.view;
  }

  /** "Look at this" — the space moment: pull back and down for a few seconds. */
  startMoment(len = 7, strength = 1) {
    this.moment = len;
    this.momentLen = len;
    this.momentK = strength;
  }

  /**
   * @param {number} dt
   * @param {object} f  the frame: bottom (world), nose, up, along, side
   *   (unit vectors), height, radius, speed, alt, space (0..1 how far into
   *   space), pad (world, for the ground camera), flat (bool),
   *   padK (0..1: still on the launch pad — frame the rocket and its tower),
   *   towerU (metres along the flight line to the tower), shake (metres)
   */
  update(dt, f) {
    const c = this.camera;
    if (this.moment > 0) this.moment = Math.max(0, this.moment - dt);
    const mk = this.moment > 0 ? Math.sin((1 - this.moment / this.momentLen) * Math.PI) * (this.momentK || 1) : 0;
    let view = this.view;
    if (view === 'ground' && (!f.flat || f.alt > 4000 || !f.pad)) view = 'side';

    const mid = V1.copy(f.bottom).addScaledVector(f.nose, f.height * 0.5);
    let fov = 55;
    let wantUp = f.up;
    const off = V2.set(0, 0, 0);
    let look = mid;
    /** After the camera is placed: how far to turn its gaze from the rocket towards `lookTo`. */
    let lookBlend = 0;
    let lookTo = null;

    if (view === 'side') {
      // Low down, level with it. High up, above it and looking down past it,
      // so the planet fills the bottom of the screen: the curve of it, and
      // the island a speck on it. The space moment looks almost straight down.
      const k = smooth(Math.max(0, Math.min(1, (f.alt - 15000) / 60000)));
      let d = (Math.max(f.close ? 14 : 34, Math.min(95, f.height * 2.3)) + Math.min(70, f.speed * 0.015)) * (1 + k * 1.2) * (1 + mk * 2.2);
      let el = Math.min(76, 7 + 43 * k + 24 * mk);
      if (f.padK > 0) {
        // On the pad: a little closer and lower, panned towards the tower so
        // the rocket and the tower that holds it are both in the shot — and
        // eased out as it climbs away, so the camera follows it up.
        const pk = smooth(Math.min(1, f.padK));
        d = d * (1 - pk) + pk * Math.max(30, f.height * 1.45 + 6);
        el = el * (1 - pk) + pk * 4;
        mid.addScaledVector(f.along, (f.towerU || 0) * 0.35 * pk);
      }
      if (f.landing) {
        // Landing: from above and to the side, looking down past the booster
        // at the pad or the ship — the thing being steered for has to be on
        // the screen — and coming down level with it for the touchdown.
        const hk = smooth(Math.max(0, Math.min(1, (f.landing.above - 60) / 1400)));
        el = 10 + 50 * hk;
        d *= 1 + 0.5 * hk;
        lookTo = f.landing.target;
        lookBlend = 0.55 * hk;
      } else if (k > 0 || mk > 0) {
        // High up, turn the gaze down past the rocket to the planet — and
        // for the space moment, nearly straight down at the island.
        lookTo = V3.copy(f.bottom).addScaledVector(f.up, -Math.max(1000, f.alt));
        lookBlend = 0.3 * k + 0.45 * mk;
      }
      el *= Math.PI / 180;
      off.copy(f.side).multiplyScalar(Math.cos(el) * d).addScaledVector(f.up, Math.sin(el) * d).addScaledVector(f.along, -d * 0.12);
    } else if (view === 'wide') {
      const k = smooth(Math.max(0, Math.min(1, (f.alt - 10000) / 60000)));
      const d = (420 + f.height * 6 + Math.min(1500, f.alt * 0.02)) * (1 + mk * 1.5);
      const el = (10 + 28 * k) * (Math.PI / 180);
      off.copy(f.side).multiplyScalar(Math.cos(el) * d).addScaledVector(f.up, Math.sin(el) * d).addScaledVector(f.along, -d * 0.35);
      fov = 50;
    } else if (view === 'onboard') {
      // On the skin near the top, looking back down along the body.
      off.copy(f.nose).multiplyScalar(f.height * 0.42).addScaledVector(f.side, f.radius * 2.2);
      look = V3.copy(f.bottom).addScaledVector(f.nose, -60).addScaledVector(f.side, f.radius * 0.5);
      wantUp = f.along;
      fov = 70;
    } else if (view === 'ground') {
      if (!this.groundPos) this.groundPos = new THREE.Vector3();
      this.groundPos.copy(f.pad).addScaledVector(f.side, 420).addScaledVector(f.along, -140);
      this.groundPos.y = f.pad.y + 4;
      const dist = this.groundPos.distanceTo(mid);
      // A long lens that zooms as it climbs away, like a tracking camera.
      fov = Math.max(4, Math.min(45, (2 * Math.atan((f.height * 3.2) / dist) * 180) / Math.PI));
      off.copy(this.groundPos).sub(mid);
    }

    // Smooth the offset, not the position.
    if (!this.hasOffset || view === 'ground') {
      this.offset.copy(off);
      this.hasOffset = true;
    } else {
      this.offset.lerp(off, 1 - Math.exp(-dt * 3.5));
    }
    c.position.copy(mid).add(this.offset);
    if (view === 'onboard') c.position.copy(f.bottom).add(this.offset);
    if (f.shake > 0 && view !== 'onboard') {
      // The ground shakes while the engines roar close by.
      this.shakeT = (this.shakeT || 0) + dt;
      const t = this.shakeT;
      c.position.x += f.shake * (Math.sin(t * 43.1) + Math.sin(t * 27.7)) * 0.5;
      c.position.y += f.shake * (Math.sin(t * 38.3) + Math.sin(t * 21.9)) * 0.5;
      c.position.z += f.shake * (Math.sin(t * 31.7) + Math.sin(t * 47.3)) * 0.5;
    }
    c.up.copy(wantUp);
    if (lookTo && lookBlend > 0) {
      // Between two directions, not two points: the pad may be a kilometre
      // away and the rocket fifty metres, and halfway between them in
      // metres is nearly all pad.
      D1.copy(mid).sub(c.position).normalize();
      D2.copy(lookTo).sub(c.position).normalize();
      D1.lerp(D2, Math.min(0.85, lookBlend)).normalize();
      c.lookAt(D2.copy(c.position).add(D1));
    } else {
      c.lookAt(look);
    }

    this.fov += (fov - this.fov) * (1 - Math.exp(-dt * 4));
    const near = f.flat ? (f.alt > 3000 ? 2 : 0.4) : 4;
    const far = f.flat ? (f.alt > 3000 ? 160000 : 60000) : 4.5e6;
    if (Math.abs(c.fov - this.fov) > 0.01 || c.near !== near || c.far !== far) {
      c.fov = this.fov;
      c.near = near;
      c.far = far;
      c.updateProjectionMatrix();
    }
    return view;
  }
}

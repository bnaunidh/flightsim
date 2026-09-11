/**
 * Surface vehicles: the boat and the car.
 *
 * These share almost everything. Both sit on a surface, both steer from the
 * front and both have one number for "how hard am I pushing" — the differences
 * are which surface they are allowed on, how quickly they turn, and what
 * happens when they leave it. So they are one class with a spec rather than
 * two files that drift apart.
 *
 * Three degrees of freedom, not six. A boat that can pitch and roll
 * independently of its heading is a physics exercise; a boat that leans in its
 * turns and bobs on the swell is what it feels like from the helm, and the
 * second is both cheaper and more convincing. Pitch and roll here are *display*
 * angles driven by what the vehicle is doing, not state the integrator solves.
 */

import * as THREE from '../vendor/three.module.js';
import { heightAt, isPaved, obstacleAt } from '../world/terrain.js';
import { clamp, lerp } from '../core/noise.js';

/** Sea level. The ocean is a flat plane at y=0 with a decorative swell. */
export const SEA = 0;

export const VEHICLES = {
  boat: {
    id: 'boat',
    name: 'Kestrel Launch',
    kind: 'boat',
    blurb: 'A fast harbour boat. Turns on its wake and stops like a boat — which is to say, slowly.',
    topSpeed: 22,
    accel: 3.4,
    dragK: 0.055,
    turnRate: 0.85,
    turnAtRest: 0.12,
    bankInTurn: 0.42,
    bobAmp: 0.22,
    eye: [0, 1.6, 0.4],
    offElement: 'You ran aground',
  },
  car: {
    id: 'car',
    name: 'Airfield Runabout',
    kind: 'car',
    blurb: 'A little airside van. Quick on the tarmac, hopeless on the grass.',
    topSpeed: 31,
    accel: 6.5,
    dragK: 0.02,
    turnRate: 1.5,
    turnAtRest: 0,
    bankInTurn: -0.16,
    bobAmp: 0,
    eye: [0, 1.3, 0.1],
    offElement: 'You went into the water',
  },
};

export class SurfaceVehicle {
  constructor(specId = 'boat') {
    this.spec = VEHICLES[specId] || VEHICLES.boat;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.heading = 90;
    this.speed = 0;
    this.throttle = 0;
    this.steer = 0;
    this.bank = 0;
    this.pitch = 0;
    this.t = 0;
    this.crashed = false;
    this.crashReason = '';
    this.distance = 0;
  }

  get isBoat() {
    return this.spec.kind === 'boat';
  }

  reset({ pos, headingDeg = 90 }) {
    this.pos.copy(pos);
    this.heading = headingDeg;
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.throttle = 0;
    this.steer = 0;
    this.bank = 0;
    this.crashed = false;
    this.crashReason = '';
    this.distance = 0;
    this.t = 0;
    this.pos.y = this.surfaceY(this.pos.x, this.pos.z);
  }

  surfaceY(x, z) {
    return this.isBoat ? SEA : Math.max(SEA, heightAt(x, z));
  }

  /**
   * Is this vehicle where it is supposed to be?
   *
   * A boat wants water — the terrain beneath it below sea level. A car wants
   * land. Each is the other's failure, which is why one function answers both.
   */
  onItsElement(x, z) {
    const ground = heightAt(x, z);
    return this.isBoat ? ground < -0.6 : ground > 0.2;
  }

  crash(reason) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashReason = reason;
    this.speed *= 0.15;
  }

  update(dt, controls = {}) {
    this.t += dt;
    if (this.crashed) {
      this.speed = lerp(this.speed, 0, clamp(dt * 1.5, 0, 1));
    } else {
      const S = this.spec;
      this.throttle = clamp(controls.throttle ?? 0, -1, 1);
      this.steer = clamp(controls.steer ?? 0, -1, 1);
      const brake = clamp(controls.brake ?? 0, 0, 1);
      // Kept so the model can light the brake lights — it is the only place
      // that knows you are braking.
      this.brakes = brake;

      // Drag grows with the square of speed, which gives each vehicle its own
      // natural top speed rather than an arbitrary cap.
      const push = this.throttle * S.accel;
      const drag = S.dragK * this.speed * Math.abs(this.speed);
      const braking = brake * (this.isBoat ? 1.2 : 9) * Math.sign(this.speed);
      this.speed += (push - drag - braking) * dt;
      this.speed = clamp(this.speed, -S.topSpeed * 0.35, S.topSpeed);
      if (Math.abs(this.speed) < 0.04 && !this.throttle) this.speed = 0;

      /*
       * Steering scales with speed, and that is the whole feel of both.
       * A rudder does nothing without water flowing over it, and a car that
       * turns as sharply at 110 km/h as in a car park is a shopping trolley.
       */
      const v = Math.abs(this.speed);
      const authority = S.turnAtRest + (1 - S.turnAtRest) * clamp(v / (S.topSpeed * 0.45), 0, 1);
      const rate = this.steer * S.turnRate * authority * Math.sign(this.speed || 1);
      this.heading = (this.heading + rate * dt * 57.2958 + 360) % 360;

      const ahead = this.step(this.pos.x, this.pos.z, this.speed * dt);
      if (!this.onItsElement(ahead.x, ahead.z)) {
        if (this.isBoat) {
          if (v > 4) this.crash(S.offElement);
          this.speed *= 0.2;
        } else if (heightAt(ahead.x, ahead.z) <= 0.2) {
          this.crash(S.offElement);
        }
      } else if (!this.isBoat && !isPaved(ahead.x, ahead.z)) {
        // Grass is draggy but not fatal — the difference between the taxiway
        // and the field, and you should feel it straight away.
        this.speed *= 1 - clamp(dt * 1.1, 0, 0.6);
      }
    }

    const rad = (this.heading * Math.PI) / 180;
    const dx = Math.sin(rad) * this.speed * dt;
    const dz = -Math.cos(rad) * this.speed * dt;
    this.pos.x += dx;
    this.pos.z += dz;
    this.distance += Math.abs(this.speed) * dt;
    this.vel.set(dx / Math.max(dt, 1e-4), 0, dz / Math.max(dt, 1e-4));

    const hit = obstacleAt(this.pos.x, this.pos.y + 1, this.pos.z);
    if (hit && !this.crashed) this.crash(hit.what);

    const base = this.surfaceY(this.pos.x, this.pos.z);
    const bob = this.spec.bobAmp
      ? Math.sin(this.t * 1.6) * this.spec.bobAmp + Math.sin(this.t * 2.7 + 1.1) * this.spec.bobAmp * 0.5
      : 0;
    this.pos.y = lerp(this.pos.y, base + bob, clamp(dt * 6, 0, 1));

    const leanTarget = -this.steer * this.spec.bankInTurn * clamp(Math.abs(this.speed) / 8, 0, 1);
    this.bank = lerp(this.bank, leanTarget, clamp(dt * 3, 0, 1));
    const pitchTarget = this.isBoat ? clamp(this.speed / this.spec.topSpeed, 0, 1) * 0.14 : 0;
    this.pitch = lerp(this.pitch, pitchTarget, clamp(dt * 2, 0, 1));
    this.quat.setFromEuler(new THREE.Euler(this.pitch, -rad, this.bank, 'YXZ'));
  }

  step(x, z, d) {
    const rad = (this.heading * Math.PI) / 180;
    return { x: x + Math.sin(rad) * d, z: z - Math.cos(rad) * d };
  }

  readouts() {
    return {
      speedKts: Math.abs(this.speed) * 1.94384,
      speedKph: Math.abs(this.speed) * 3.6,
      heading: this.heading,
      throttle: Math.abs(this.throttle),
      crashed: this.crashed,
      distanceM: this.distance,
    };
  }
}

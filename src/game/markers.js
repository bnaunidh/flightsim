/**
 * In-world objective markers: checkpoint rings, a landing-pad target and the
 * cargo crate with its parachute.
 *
 * Rings are big, bright and unmistakable — a 12-year-old should never have to
 * wonder where to fly next.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp } from '../core/noise.js';

function ringGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 20, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0)');
  g.addColorStop(0.72, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.86, 'rgba(255,255,255,0.85)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

let glowTex = null;

export class RingGate {
  /**
   * @param {THREE.Vector3} pos centre of the ring
   * @param {number} headingDeg direction you should be flying when you pass it
   */
  constructor(pos, headingDeg = 90, radius = 34) {
    if (!glowTex) glowTex = ringGlowTexture();
    this.pos = pos.clone();
    this.radius = radius;
    this.passed = false;
    this.active = false;

    this.group = new THREE.Group();
    this.group.position.copy(pos);
    this.group.rotation.y = THREE.MathUtils.degToRad(-headingDeg);

    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 2.1, 10, 44),
      new THREE.MeshStandardMaterial({
        color: 0x2fd6ff,
        emissive: 0x1c9fd0,
        emissiveIntensity: 1.4,
        roughness: 0.35,
        metalness: 0.2,
        transparent: true,
        opacity: 0.92,
      })
    );
    this.torus = torus;
    this.group.add(torus);

    // Additive halo so the ring is visible against bright sky or dark night.
    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(radius * 2.9, radius * 2.9),
      new THREE.MeshBasicMaterial({
        map: glowTex,
        color: 0x7ce9ff,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.halo = halo;
    this.group.add(halo);

    // Chevrons around the rim to show which way to fly through.
    const chevMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 });
    this.chevrons = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      const ch = new THREE.Mesh(new THREE.ConeGeometry(2.4, 6, 4), chevMat);
      ch.position.set(Math.cos(a) * radius, Math.sin(a) * radius, 0);
      ch.rotation.x = -Math.PI / 2;
      this.group.add(ch);
      this.chevrons.push(ch);
    }

    this.t = 0;
  }

  setActive(on) {
    this.active = on;
    const col = this.passed ? 0x3ec96a : on ? 0x2fd6ff : 0x8892a0;
    this.torus.material.color.setHex(col);
    this.torus.material.emissive.setHex(this.passed ? 0x2c9a52 : on ? 0x1c9fd0 : 0x3a4048);
    this.halo.material.color.setHex(this.passed ? 0x86ffae : on ? 0x7ce9ff : 0x6a7480);
    this.halo.material.opacity = on ? 0.55 : 0.18;
    this.torus.material.opacity = on ? 0.95 : 0.55;
  }

  markPassed() {
    this.passed = true;
    this.setActive(false);
  }

  /** Did the aeroplane just fly through? */
  test(pos) {
    if (this.passed) return false;
    return pos.distanceTo(this.pos) < this.radius * 0.95;
  }

  update(dt, camPos) {
    this.t += dt;
    const pulse = this.active ? 1 + Math.sin(this.t * 3.4) * 0.06 : 1;
    this.torus.scale.setScalar(pulse);
    this.torus.rotation.z += dt * (this.active ? 0.55 : 0.12);
    this.halo.lookAt(camPos);
    for (let i = 0; i < this.chevrons.length; i++) {
      this.chevrons[i].position.z = Math.sin(this.t * 2.4 + i * 0.5) * 2.2;
    }
  }

  dispose(scene) {
    scene.remove(this.group);
    this.torus.geometry.dispose();
    this.halo.geometry.dispose();
  }
}

/** The supply crate, dropped over Mango Cay. */
export class CargoCrate {
  constructor(scene, pos, vel) {
    this.group = new THREE.Group();
    const crate = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.2, 1.4),
      new THREE.MeshStandardMaterial({ color: 0xb07a3c, roughness: 0.85 })
    );
    crate.castShadow = true;
    this.group.add(crate);
    // Strapping.
    const strapMat = new THREE.MeshStandardMaterial({ color: 0x2a2f36, roughness: 0.7 });
    for (const axis of ['x', 'z']) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(axis === 'x' ? 1.5 : 0.18, 1.3, axis === 'x' ? 0.18 : 1.5), strapMat);
      this.group.add(s);
    }
    // Parachute.
    this.chute = new THREE.Mesh(
      new THREE.SphereGeometry(2.6, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshStandardMaterial({ color: 0xff7a3c, roughness: 0.8, side: THREE.DoubleSide })
    );
    this.chute.position.y = 3.4;
    this.chute.scale.set(0, 0, 0);
    this.group.add(this.chute);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const line = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.2, 4), strapMat);
      line.position.set(Math.cos(a) * 0.6, 1.8, Math.sin(a) * 0.6);
      this.group.add(line);
    }

    this.group.position.copy(pos);
    this.vel = vel.clone().multiplyScalar(0.6);
    this.landed = false;
    this.t = 0;
    scene.add(this.group);
    this.scene = scene;
  }

  update(dt, heightAt, wind) {
    if (this.landed) {
      this.t += dt;
      return;
    }
    this.t += dt;
    // Chute blossoms after a second, then it settles to a steady descent and
    // sheds its forward speed quickly — so releasing over the target actually
    // puts the crate on the target.
    const open = clamp((this.t - 0.9) * 2.2, 0, 1);
    this.chute.scale.setScalar(open);
    if (open < 0.05) {
      this.vel.y -= 9.81 * dt;
    } else {
      // Approach a 4.5 m/s descent rate, like a real cargo parachute.
      this.vel.y += (-4.5 - this.vel.y) * clamp(dt * 2.4 * open, 0, 1);
    }
    // Horizontal speed decays toward the wind speed.
    const hDecay = clamp(dt * (0.35 + open * 1.5), 0, 1);
    this.vel.x += (wind.x * 0.9 - this.vel.x) * hDecay;
    this.vel.z += (wind.z * 0.9 - this.vel.z) * hDecay;
    this.group.position.addScaledVector(this.vel, dt);
    this.group.rotation.z = Math.sin(this.t * 1.6) * 0.12 * open;
    const gh = heightAt(this.group.position.x, this.group.position.z);
    if (this.group.position.y <= gh + 0.7) {
      this.group.position.y = gh + 0.7;
      this.landed = true;
      this.chute.scale.setScalar(0.4);
      this.chute.position.set(2.4, 0.2, 0.6);
      this.chute.rotation.z = 1.4;
    }
  }

  dispose() {
    this.scene.remove(this.group);
  }
}

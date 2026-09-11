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

/**
 * A practice bomb.
 *
 * The weapons range used to drop a cargo crate under an orange parachute,
 * which is a supply drop, not a bombing run — and the class noticed
 * immediately. A bomb is a different problem to solve: it keeps the
 * aeroplane's forward speed all the way down, so you have to release *before*
 * the target and judge how far ahead, which is the whole skill.
 *
 * It is an inert practice store. It marks where it lands with dust and a
 * scorch, and does nothing else.
 */
export class PracticeBomb {
  constructor(scene, pos, vel) {
    this.group = new THREE.Group();

    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2f6fb5, roughness: 0.5, metalness: 0.25 });
    const finMat = new THREE.MeshStandardMaterial({ color: 0x243a52, roughness: 0.6, metalness: 0.3 });

    // The store itself, lying along its own -Z, so pointing it along its
    // velocity is a lookAt and nothing more.
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.15, 12), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.castShadow = true;
    this.group.add(body);

    const nose = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), bodyMat);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.575;
    this.group.add(nose);

    const tailCone = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.07, 0.3, 12), bodyMat);
    tailCone.rotation.x = Math.PI / 2;
    tailCone.position.z = 0.72;
    this.group.add(tailCone);

    // Four swept fins at the tail. They are what makes a shape at this size
    // read as a bomb rather than as a pipe.
    for (let i = 0; i < 4; i++) {
      const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.26, 0.34), finMat);
      fin.position.z = 0.66;
      fin.rotation.z = (i / 4) * Math.PI * 2;
      fin.position.y = Math.cos((i / 4) * Math.PI * 2) * 0.17;
      fin.position.x = Math.sin((i / 4) * Math.PI * 2) * 0.17;
      fin.castShadow = true;
      this.group.add(fin);
    }

    // The dust it throws up on impact, made now and hidden, so nothing is
    // allocated at the moment it matters.
    this.dust = new THREE.Mesh(
      new THREE.SphereGeometry(1, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0xb9a983, roughness: 1, transparent: true, opacity: 0 })
    );
    this.dust.visible = false;
    scene.add(this.dust);

    this.scorch = new THREE.Mesh(
      new THREE.CircleGeometry(2.6, 20),
      new THREE.MeshStandardMaterial({ color: 0x2a2622, roughness: 1, transparent: true, opacity: 0 })
    );
    this.scorch.rotation.x = -Math.PI / 2;
    this.scorch.visible = false;
    scene.add(this.scorch);

    this.group.position.copy(pos);
    // It leaves with the aeroplane's velocity, all of it. That is the point.
    this.vel = vel.clone();
    this.landed = false;
    this.t = 0;
    this.settle = 0;
    this.scene = scene;
    scene.add(this.group);
    this.mesh = this.group; // the missions read `crate.mesh.position`
  }

  update(dt, heightAt, wind) {
    this.t += dt;
    if (this.landed) {
      // Dust blooms and fades; the scorch stays.
      this.settle += dt;
      const k = clamp(this.settle / 2.6, 0, 1);
      this.dust.scale.setScalar(1.4 + k * 5.5);
      this.dust.material.opacity = (1 - k) * 0.5;
      this.dust.position.y += dt * 1.4;
      this.dust.visible = k < 1;
      this.scorch.material.opacity = 0.55;
      return;
    }

    // Gravity, and a little drag. A real store slows very slightly and the
    // wind pushes it about, which is why the range mission has a crosswind.
    this.vel.y -= 9.81 * dt;
    const drag = clamp(dt * 0.09, 0, 1);
    this.vel.x += (wind.x * 0.5 - this.vel.x) * drag;
    this.vel.z += (wind.z * 0.5 - this.vel.z) * drag;
    this.group.position.addScaledVector(this.vel, dt);

    // Point it where it is going. A bomb that falls flat looks like litter.
    if (this.vel.lengthSq() > 1) {
      this.group.lookAt(
        this.group.position.x + this.vel.x,
        this.group.position.y + this.vel.y,
        this.group.position.z + this.vel.z
      );
      this.group.rotateY(Math.PI); // the model points along -Z
    }

    const gh = heightAt(this.group.position.x, this.group.position.z);
    if (this.group.position.y <= gh + 0.15) {
      this.group.position.y = gh + 0.1;
      this.landed = true;
      this.group.visible = false;
      const p = this.group.position;
      this.dust.position.set(p.x, gh + 1.2, p.z);
      this.dust.visible = true;
      this.scorch.position.set(p.x, gh + 0.09, p.z);
      this.scorch.visible = true;
    }
  }

  dispose() {
    this.scene.remove(this.group);
    this.scene.remove(this.dust);
    this.scene.remove(this.scorch);
  }
}

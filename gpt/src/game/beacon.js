/**
 * A beacon at the target.
 *
 * The arrow tells you which way to turn; a beacon tells you where the place
 * *is*. They suit different people and different moments — an arrow is precise
 * but abstract, and a shaft of light standing over the runway is something you
 * fly towards without thinking about it. Twenty-nine children asked to be able
 * to choose, which is a better argument than any I had.
 *
 * Built the same way as everything else here: no textures, no models. A tall
 * cylinder with a soft gradient painted in a canvas, plus a ring on the ground
 * so you can see exactly where the base of it lands.
 */

import * as THREE from '../vendor/three.module.js';

const HEIGHT = 1400;
const RADIUS = 26;

function beamTexture() {
  const c = document.createElement('canvas');
  c.width = 8;
  c.height = 256;
  const g = c.getContext('2d');
  // Bright at the bottom where it meets the ground, fading out with height —
  // a solid-topped column looks like a wall rather than light.
  const grad = g.createLinearGradient(0, 256, 0, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.16)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Beacon {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'beacon';
    this.group.visible = false;
    this.t = 0;

    const tex = beamTexture();
    // Two shells, counter-rotating, so it shimmers instead of sitting still.
    this.shells = [];
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.CylinderGeometry(
        RADIUS * (1 - i * 0.35),
        RADIUS * (1.25 - i * 0.3),
        HEIGHT,
        18,
        1,
        true
      );
      const mat = new THREE.MeshBasicMaterial({
        map: tex.clone(),
        color: 0x62e0ff,
        transparent: true,
        opacity: 0.34 - i * 0.1,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.y = HEIGHT / 2;
      m.rotation.y = i * 0.8;
      this.group.add(m);
      this.shells.push({ mesh: m, spin: i ? -0.18 : 0.25 });
    }

    // A ring on the ground, so the exact spot is unambiguous.
    const ringGeo = new THREE.RingGeometry(RADIUS * 1.1, RADIUS * 1.7, 40);
    ringGeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(
      ringGeo,
      new THREE.MeshBasicMaterial({
        color: 0x7dffb4,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    this.ring.position.y = 1.2;
    this.group.add(this.ring);

    scene.add(this.group);
  }

  /** @param {THREE.Vector3|null} pos where to stand it, or null to hide it */
  setTarget(pos) {
    if (!pos) {
      this.group.visible = false;
      return;
    }
    this.group.visible = true;
    this.group.position.set(pos.x, 0, pos.z);
  }

  update(dt) {
    if (!this.group.visible) return;
    this.t += dt;
    for (const s of this.shells) s.mesh.rotation.y += s.spin * dt;
    // A slow pulse, and the ground ring breathes with it.
    const pulse = 0.78 + Math.sin(this.t * 1.7) * 0.22;
    this.shells[0].mesh.material.opacity = 0.34 * pulse;
    this.shells[1].mesh.material.opacity = 0.24 * pulse;
    this.ring.material.opacity = 0.5 * pulse;
    this.ring.scale.setScalar(1 + Math.sin(this.t * 1.7) * 0.06);
  }

  dispose(scene) {
    scene.remove(this.group);
  }
}

/**
 * Drag parachutes, for the fast jets' landing roll.
 *
 * "Drag parachutes on landing for fast planes": touch down, brake, and a
 * parachute blooms out behind the tail and hauls you back. The planes that
 * get one are the ones that land fast and roll a long way (profiles.js:
 * Air Massimo, T-Pose Harrison, the F-22, the Vanguard, the Nightjar B-2).
 *
 * THE KEY IS THE BRAKES. Every child already brakes after landing — Space,
 * or the BRAKE pad — so that is what pops it, on the landing roll above
 * 40 knots. On a touch screen a CHUTE button shows on the roll as well. No
 * new key to learn, and the chute is seen on the very first landing.
 *
 * THE FORCE is a real drag: 0.5 · rho · V² · CdA, pulling back along the
 * ground track. CdA is sized to the aeroplane's mass (CDA_PER_KG), so a
 * 9.8 t Nightjar gets a bigger chute than a 5.2 t racer and they slow alike:
 * 30 m² for Massimo, about a 9 m round canopy, which is a fighter's. At 70
 * knots that is nearly half a g on top of the brakes, and it fades as you
 * slow — which is why real jets drop it at taxi speed. Measured in
 * tests/features/aircrew.mjs: it shortens the landing roll.
 *
 * It is let go (cut) below CUT_BELOW m/s, or if the throttle goes up for a
 * go-around, and lies on the runway behind you for a few seconds.
 */

import * as THREE from '../../vendor/three.module.js';

export const DRAG_CHUTE = {
  CDA_PER_KG: 30 / 5200, // m² of drag area per kg of aeroplane
  POP_ABOVE: 40 / 1.94384, // m/s: the brakes pop it on the roll above 40 kt
  CUT_BELOW: 5, // m/s: let go at a walk
  CUT_THROTTLE: 0.7, // a go-around cuts it
  FILL: 0.45, // seconds to fill
  RHO: 1.225,
};

/** Metres per second squared of deceleration the chute makes at `speed`. */
export function chuteDecel(speed, massKg, fill = 1) {
  const cda = DRAG_CHUTE.CDA_PER_KG * massKg * Math.max(0, Math.min(1, fill));
  return (0.5 * DRAG_CHUTE.RHO * speed * speed * cda) / Math.max(1, massKg);
}

/**
 * Slow the aeroplane for one step: take the chute's deceleration off the
 * horizontal velocity, never past a stop. Returns the deceleration applied.
 */
export function applyChute(ac, massKg, fill, dt) {
  const vx = ac.vel.x;
  const vz = ac.vel.z;
  const sp = Math.hypot(vx, vz);
  if (sp < 0.05) return 0;
  const a = chuteDecel(sp, massKg, fill);
  const k = Math.max(0, sp - a * dt) / sp;
  ac.vel.x = vx * k;
  ac.vel.z = vz * k;
  return a;
}

/* ------------------------------------------------------------------ */
/* The picture: a canopy on risers, open end towards the aeroplane.     */
/* ------------------------------------------------------------------ */

let MAT = null;
let LINE = null;

export class DragChuteModel {
  constructor(massKg) {
    if (!MAT) {
      MAT = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, transparent: true, opacity: 1 });
      LINE = new THREE.LineBasicMaterial({ color: 0x333333 });
    }
    /*
     * Drawn at 0.6 of the size its drag works out to, and close behind the
     * tail. At full size (a 7 m canopy 13 m back) it streamed straight into
     * the follow camera, 17 m behind the aeroplane, and filled the screen
     * with orange. It fades as well if the camera still gets near it.
     */
    const area = DRAG_CHUTE.CDA_PER_KG * massKg / 0.75;
    this.radius = Math.sqrt(area / Math.PI) * 0.6;
    this.root = new THREE.Group();
    this.root.name = 'eject:dragchute';
    // A dome whose crown points aft (+Z) and whose mouth faces the aeroplane.
    const g = new THREE.SphereGeometry(this.radius, 16, 5, 0, Math.PI * 2, 0, 1.25);
    g.rotateX(Math.PI / 2);
    g.scale(1, 1, 0.8);
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const a = new THREE.Color(0xff6a1a);
    const b = new THREE.Color(0xf4f4f0);
    for (let i = 0; i < pos.count; i++) {
      const ang = Math.atan2(pos.getY(i), pos.getX(i));
      const c = Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 8) % 2 ? a : b;
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.canopy = new THREE.Mesh(g, MAT);
    this.canopy.castShadow = true;
    this.root.add(this.canopy);
    this.len = Math.max(3.5, this.radius * 2.4);
    const pts = [];
    const skirt = this.radius * Math.sin(1.25);
    const zs = this.radius * Math.cos(1.25) * 0.8; // the mouth's rim, just ahead of the crown
    for (let k = 0; k < 6; k++) {
      const an = (k / 6) * Math.PI * 2;
      pts.push(Math.cos(an) * skirt, Math.sin(an) * skirt, zs, 0, 0, -this.len);
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lines = new THREE.LineSegments(lg, LINE);
    this.root.add(this.lines);
    this.t = 0;
  }

  /**
   * Stream it behind `anchor` (world position of the tail) along the ground
   * track `dir` (unit, the way the aeroplane is rolling). `fill` 0..1.
   */
  sync(anchor, dir, fill, dt, groundY, camera = null) {
    this.t += dt;
    if (camera && camera.position) {
      const d = camera.position.distanceTo(this.root.position);
      MAT.opacity = Math.max(0.25, Math.min(1, (d - this.radius) / (this.radius * 2.5)));
    } else MAT.opacity = 1;
    const back = this.len + this.radius * 0.4;
    this.root.position.set(anchor.x - dir.x * back, Math.max(groundY + this.radius * 0.9, anchor.y + 0.4), anchor.z - dir.z * back);
    this.root.rotation.set(0, Math.atan2(-dir.x, -dir.z), 0);
    const f = Math.max(0.05, fill);
    const flutter = 1 + Math.sin(this.t * 13) * 0.04;
    this.canopy.scale.set(f * flutter, f / flutter, 0.4 + f * 0.6);
  }

  /** Cut loose: it sags onto the ground where it is. Returns true when gone. */
  drop(dt, groundY) {
    this.t += dt;
    this.root.position.y = Math.max(groundY + 0.15, this.root.position.y - dt * 2.5);
    this.canopy.scale.y = Math.max(0.08, this.canopy.scale.y - dt * 0.8);
    this.lines.visible = false;
    return this.t > 7;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.canopy.geometry.dispose();
    this.lines.geometry.dispose();
  }
}

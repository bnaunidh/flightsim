/**
 * The parachute: a person under a canopy, from the moment the seat fires to
 * the moment their feet touch the ground.
 *
 * Two halves, kept apart so the node tests can fly the physics without a
 * scene:
 *
 *   ChuteFlight   the numbers — where the parachutist is, how fast they are
 *                 going, whether the canopy is open. No THREE objects beyond
 *                 vectors, no DOM.
 *   ChuteModel    the picture — a striped canopy, its lines, the person
 *                 hanging under it (in their uniform), and for a rocket seat
 *                 the seat itself falling away.
 *
 * HOW IT FLIES. Cartoon-honest, and quick, because a ten-year-old should not
 * wait two minutes to reach the ground:
 *
 *   'seat'  a rocket seat: shot up out of the aeroplane at 24 m/s on top of
 *           whatever the aeroplane was doing, the seat falls away at 1.0 s and
 *           the canopy snaps open at 1.5 s. Works from any height, even the
 *           ground (a real seat is "zero-zero": zero height, zero speed).
 *   'bail'  a light aeroplane: out of the door, a tumble, canopy at 2.0 s.
 *   'jump'  T-Pose Harrison stepping off his board: canopy at 1.1 s.
 *
 * In free fall air drag bleeds off the aeroplane's speed (a cartoon-strong
 * drag, so a Massimo at 900 km/h does not fling you three kilometres). Under
 * the canopy the velocity eases toward a steady glide: forward at 5.5 m/s the
 * way you face plus the wind, and down at 11 m/s high up, slowing to 4.5 m/s
 * for the last 60 m so the landing is gentle. Holding "sink" spills air: 16
 * m/s down, still slowing near the ground. Steering turns you at 50°/s.
 */

import * as THREE from '../../vendor/three.module.js';

const G = 9.81;

export const CHUTE = {
  seatKick: 24, // m/s straight up out of the aeroplane
  bailKick: 3,
  jumpKick: 6,
  openAt: { seat: 1.5, bail: 2.0, jump: 1.1, crew: 1.5 },
  seatOffAt: 1.0,
  openTime: 0.9, // seconds for the canopy to fill
  fallDrag: 0.004, // 1/m: a = -k |v| v in free fall (terminal ~50 m/s)
  glide: 5.5, // m/s forward under the canopy
  sinkHigh: 11, // m/s down above lowFrom (quick: 600 m is under a minute)
  sinkLow: 4.5, // m/s down near the ground
  sinkFast: 16, // m/s down with "sink" held, high up
  lowFrom: 60, // metres above the ground where it slows for the landing
  turnRate: 50, // degrees per second of steering
  settle: 1.6, // 1/s: how quickly the canopy brings the velocity to the glide
};

/** The numbers of one parachutist. */
export class ChuteFlight {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0; // compass degrees the person faces
    this.kind = 'seat';
    this.t = 0;
    this.open = 0; // 0..1, how full the canopy is
    this.landed = false;
    this.seatOff = false;
    this.lowest = Infinity;
  }

  /**
   * Out of the aeroplane. `up` is the aeroplane's own up (a seat fires along
   * it — upside down, it fires you at the ground, as a real one would; the
   * canopy still saves you from any height the game can reach).
   */
  launch(pos, vel, up, headingDeg, kind = 'seat') {
    this.pos.copy(pos);
    this.vel.copy(vel);
    const kick = kind === 'seat' || kind === 'crew' ? CHUTE.seatKick : kind === 'jump' ? CHUTE.jumpKick : CHUTE.bailKick;
    this.vel.addScaledVector(up, kick);
    if (kind === 'bail') this.vel.y += 1.5;
    this.heading = headingDeg;
    this.kind = kind;
    this.t = 0;
    this.open = 0;
    this.landed = false;
    this.seatOff = !(kind === 'seat' || kind === 'crew');
    return this;
  }

  /**
   * One step. `input` = { turn: -1..1 (right +), sink: bool }; `wind` a
   * Vector3 of the wind (m/s, the direction it blows to); `groundY` the
   * height of whatever is under the parachutist (sea level at least).
   * Returns true on the step it lands.
   */
  step(dt, input, wind, groundY) {
    if (this.landed || !(dt > 0)) return false;
    this.t += dt;
    const openAt = CHUTE.openAt[this.kind] ?? 1.5;
    if (!this.seatOff && this.t >= CHUTE.seatOffAt) this.seatOff = true;
    if (this.t >= openAt) this.open = Math.min(1, this.open + dt / CHUTE.openTime);
    const agl = this.pos.y - groundY;
    // Free fall: gravity and a strong cartoon drag.
    const v = this.vel;
    const sp = v.length();
    const k = CHUTE.fallDrag * (1 - this.open);
    v.y -= G * dt * (1 - this.open);
    if (sp > 0) v.multiplyScalar(Math.max(0, 1 - k * sp * dt));
    // Under the canopy: ease toward the glide.
    if (this.open > 0) {
      const turn = input && input.turn ? Math.max(-1, Math.min(1, input.turn)) : 0;
      this.heading = (this.heading + turn * CHUTE.turnRate * this.open * dt + 360) % 360;
      const h = (this.heading * Math.PI) / 180;
      const low = agl < CHUTE.lowFrom;
      const lowK = Math.max(0, Math.min(1, agl / CHUTE.lowFrom));
      let sink = low ? CHUTE.sinkLow + (CHUTE.sinkHigh - CHUTE.sinkLow) * lowK : CHUTE.sinkHigh;
      if (input && input.sink) sink = low ? CHUTE.sinkLow + (CHUTE.sinkFast - CHUTE.sinkLow) * lowK : CHUTE.sinkFast;
      const wx = wind ? wind.x : 0;
      const wz = wind ? wind.z : 0;
      const tx = Math.sin(h) * CHUTE.glide + wx;
      const tz = -Math.cos(h) * CHUTE.glide + wz;
      const r = Math.min(1, dt * CHUTE.settle * (0.4 + this.open * 2));
      v.x += (tx - v.x) * r;
      v.z += (tz - v.z) * r;
      v.y += (-sink - v.y) * r;
    }
    this.pos.addScaledVector(v, dt);
    this.lowest = Math.min(this.lowest, this.pos.y - groundY);
    if (this.pos.y <= groundY && this.t > 0.3) {
      this.pos.y = groundY;
      this.landed = true;
      return true;
    }
    return false;
  }

  /** Metres per second down, positive. */
  get sinkRate() {
    return -this.vel.y;
  }
}

/* ------------------------------------------------------------------ */
/* The picture                                                          */
/* ------------------------------------------------------------------ */

/** Canopy colours by uniform: alternating gores. */
const CANOPY = {
  fighter: [0xff7a1a, 0xf4f4f0],
  racer: [0xd4252a, 0xf4f4f0],
  harrison: [0x2fb36b, 0x7a3bd1],
  casual: [0x45a2dd, 0xffd23f, 0xe0473c, 0x3aa66b],
  captain: [0x1d2a45, 0xe7b93c],
  heli: [0xf0762a, 0xf4f4f0],
  pilot: [0xff7a1a, 0xf4f4f0],
};

let canopyMat = null;
let lineMat = null;
let seatMat = null;
let flameMat = null;
function materials() {
  if (!canopyMat) {
    canopyMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.85, metalness: 0 });
    lineMat = new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.8 });
    seatMat = new THREE.MeshStandardMaterial({ color: 0x4a5058, roughness: 0.6, metalness: 0.4 });
    flameMat = new THREE.MeshBasicMaterial({ color: 0xffb23a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  }
  return { canopyMat, lineMat, seatMat, flameMat };
}

const GORES = 12;
const RADIUS = 3.6;
const HEIGHT = 6.4; // canopy skirt above the feet

function canopyGeometry(colors) {
  const g = new THREE.SphereGeometry(RADIUS, GORES * 2, 6, 0, Math.PI * 2, 0, 1.05);
  g.scale(1, 0.62, 1);
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const gore = Math.floor(((a + Math.PI) / (Math.PI * 2)) * GORES) % GORES;
    c.setHex(colors[gore % colors.length]);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // The skirt at y 0, the crown above it.
  g.translate(0, -RADIUS * 0.62 * Math.cos(1.05), 0);
  return g;
}

function linesGeometry() {
  const pts = [];
  const skirtR = RADIUS * Math.sin(1.05);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const x = Math.cos(a) * skirtR;
    const z = Math.sin(a) * skirtR;
    const side = x < 0 ? -1 : 1;
    pts.push(x, HEIGHT, z, side * 0.22, 1.5, 0);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}

function seatGeometry() {
  const a = new THREE.BoxGeometry(0.62, 0.14, 0.6);
  a.translate(0, 0, 0);
  const b = new THREE.BoxGeometry(0.62, 1.05, 0.14);
  b.translate(0, 0.55, 0.26);
  const c = new THREE.BoxGeometry(0.4, 0.3, 0.16);
  c.translate(0, 1.2, 0.26);
  return [a, b, c];
}

/**
 * The picture of one parachutist. `person` is a built person (uniforms.js),
 * `uniform` picks the canopy colours, `seat` adds a rocket seat that falls
 * away.
 */
export class ChuteModel {
  constructor(person, { uniform = 'pilot', seat = false } = {}) {
    const M = materials();
    this.root = new THREE.Group();
    this.root.name = 'eject:chute';
    this.person = person;
    this.root.add(person);
    this.canopyPivot = new THREE.Group();
    this.canopyPivot.position.y = HEIGHT;
    this.root.add(this.canopyPivot);
    this.canopy = new THREE.Mesh(canopyGeometry(CANOPY[uniform] || CANOPY.pilot), M.canopyMat);
    this.canopy.castShadow = true;
    this.canopyPivot.add(this.canopy);
    this.lines = new THREE.LineSegments(linesGeometry(), M.lineMat);
    this.root.add(this.lines);
    this.seat = null;
    if (seat) {
      this.seat = new THREE.Group();
      this.seat.name = 'eject:seat';
      for (const g of seatGeometry()) {
        const m = new THREE.Mesh(g, M.seatMat);
        m.castShadow = true;
        this.seat.add(m);
      }
      const fl = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.4, 10, 1, true), M.flameMat);
      fl.rotation.x = Math.PI;
      fl.position.y = -0.75;
      this.seatFlame = fl;
      this.seat.add(fl);
      this.seatPos = new THREE.Vector3();
      this.seatVel = new THREE.Vector3();
      this.seatSpin = new THREE.Vector3();
      this.seatAttached = true;
    }
    this.setOpen(0, 0);
    this.collapse = 0;
  }

  /** Put the seat (if any) in the scene: it leaves the parachutist and falls on its own. */
  addTo(scene) {
    scene.add(this.root);
    if (this.seat) scene.add(this.seat);
  }

  setOpen(open, t) {
    const o = Math.max(0, Math.min(1, open));
    const visible = o > 0.01;
    this.canopy.visible = visible;
    this.lines.visible = visible;
    if (!visible) return;
    // Fills from a streamer to a dome, with a little overshoot and a flutter.
    const e = 1 - Math.pow(1 - o, 3);
    const over = o < 1 ? Math.sin(o * Math.PI) * 0.12 : 0;
    const flutter = 1 + Math.sin(t * 9) * 0.015 * o;
    const w = 0.12 + (e + over) * 0.88;
    this.canopyPivot.scale.set(w * flutter, 0.35 + e * 0.65, w / flutter);
    this.lines.scale.set(Math.max(0.12, w), 1, Math.max(0.12, w));
  }

  /** Place and pose it from a ChuteFlight. `turn` tilts the canopy into the turn. */
  sync(f, dt, turn = 0, groundY = -Infinity) {
    this.root.position.copy(f.pos);
    this.root.rotation.set(0, -(f.heading * Math.PI) / 180, 0);
    // Swing: under the canopy the body hangs, leaning into a turn.
    const bank = -turn * 0.18 * f.open;
    this.root.rotation.z = bank;
    this.setOpen(f.open, f.t);
    if (this.seat) {
      if (this.seatAttached) {
        this.seat.position.copy(f.pos).y -= 0.15;
        this.seat.rotation.copy(this.root.rotation);
        this.seatFlame.visible = f.t < 0.35;
        this.seatFlame.scale.setScalar(0.7 + Math.random() * 0.5);
        if (f.seatOff) {
          this.seatAttached = false;
          this.seatPos.copy(this.seat.position);
          this.seatVel.copy(f.vel).multiplyScalar(0.6);
          this.seatVel.y -= 2;
          this.seatVel.x += (Math.random() - 0.5) * 3;
          this.seatSpin.set(Math.random() * 3 - 1.5, Math.random() * 2 - 1, Math.random() * 3 - 1.5);
          this.seatFlame.visible = false;
        }
      } else if (this.seat.visible) {
        this.seatVel.y -= G * dt;
        this.seatVel.multiplyScalar(1 - Math.min(1, 0.02 * dt * this.seatVel.length()));
        this.seatPos.addScaledVector(this.seatVel, dt);
        this.seat.position.copy(this.seatPos);
        this.seat.rotation.x += this.seatSpin.x * dt;
        this.seat.rotation.y += this.seatSpin.y * dt;
        this.seat.rotation.z += this.seatSpin.z * dt;
        if (this.seatPos.y < groundY || f.t > 14) this.seat.visible = false;
      }
    }
  }

  /** On the ground: the canopy sags down beside the person. */
  collapseStep(dt) {
    this.collapse = Math.min(1, this.collapse + dt / 1.6);
    const c = this.collapse;
    this.canopyPivot.position.set(c * 3.2, HEIGHT * (1 - c) + 0.2 * c, c * 1.5);
    this.canopyPivot.rotation.z = -c * 1.3;
    this.canopyPivot.scale.y = Math.max(0.12, 1 - c * 0.85);
    this.lines.visible = c < 0.5;
    return c >= 1;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    if (this.seat && this.seat.parent) this.seat.parent.remove(this.seat);
    this.canopy.geometry.dispose();
    this.lines.geometry.dispose();
    if (this.seat) this.seat.traverse((o) => o.geometry && o.geometry.dispose());
    this.person.traverse((o) => {
      if (o.isMesh && o.geometry) o.geometry.dispose();
    });
  }
}

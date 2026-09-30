/**
 * How each custom crash MOVES — two seconds of cartoon choreography.
 *
 * The flight model stops dead when it crashes (physics.js damps the wreck
 * and then its update returns early), so a crash used to be the aeroplane
 * sitting where it hit. These are scripted poses instead: a function of
 * time that says where the aeroplane's origin is and which way up it is,
 * starting from exactly where and how it hit, and done in CRASH_SECONDS —
 * before main.js brings the debrief up at 2.2 s.
 *
 *   cartwheel  rolls wingtip over wingtip along its track, a tip slamming
 *              the ground every half turn, and ends upside down (a big
 *              aeroplane goes over once, a small one one and a half times)
 *   bellyflop  slaps down flat, bounces twice, skids and slews round
 *   wingclip   the low tip digs in and it spins like a top, twice round
 *   noseplant  stops dead, nose buried, tail in the air — and wobbles: boing
 *   bonk       bounces back off the wall and drops, nose up
 *   splash     ducks right under and bobs back up like a cork
 *
 * Geometry comes from the flight model's own strike points (the nose, the
 * wing tips, the belly — physics SPEC.hardPoints), so a jumbo cartwheels on
 * its 35 m span and the trainer on its 12. Pure three.js maths: no scene, so
 * tests/features/crashes.mjs runs every one in node and checks nothing ends
 * up underground.
 */

import * as THREE from '../../vendor/three.module.js';

export const CRASH_SECONDS = 2.0;

const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const easeOut2 = (x) => 1 - (1 - clamp(x, 0, 1)) ** 2;
const easeOut3 = (x) => 1 - (1 - clamp(x, 0, 1)) ** 3;
const slide = (v0, tau, t) => v0 * tau * (1 - Math.exp(-t / tau));

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

/** Sizes of the aeroplane from its strike points, with a fallback for anything missing. */
export function dimsFrom(hardPoints, plan) {
  const hp = Array.isArray(hardPoints) ? hardPoints : [];
  const find = (part) => hp.find((p) => p && p.part === part && p.pos);
  const nose = find('nose');
  const tip = find('rightWing') || find('leftWing');
  const tail = find('tail');
  const belly = find('fuselage');
  const pl = plan || {};
  const noseZ = nose ? nose.pos.z : Number.isFinite(pl.nose) ? pl.nose : -3;
  const tailZ = tail ? tail.pos.z : Number.isFinite(pl.tail) ? pl.tail : 5;
  const semi = tip ? Math.abs(tip.pos.x) : Number.isFinite(pl.span) ? pl.span / 2 : 6;
  const bellyY = belly ? belly.pos.y : nose ? nose.pos.y : -1;
  const L = Math.max(3, tailZ - noseZ);
  return {
    L,
    semi: Math.max(1.5, semi),
    // Origin height when it lies on its belly.
    r: clamp(-bellyY, 0.4, 6),
    noseZ,
    noseY: nose ? nose.pos.y : bellyY * 0.6,
    tailZ,
  };
}

/**
 * @param kind   see the header
 * @param start  { pos, quat, vel, side, dims, ground(x, z) → surface height, agl }
 */
export function makeScript(kind, start) {
  const pos = start.pos.clone();
  const quat = start.quat.clone().normalize();
  const vel = start.vel ? start.vel.clone() : new THREE.Vector3();
  const f = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
  const h = Math.hypot(vel.x, vel.z);
  const d = h > 2 ? new THREE.Vector3(vel.x / h, 0, vel.z / h) : new THREE.Vector3(f.x, 0, f.z);
  if (d.lengthSq() < 1e-6) d.set(0, 0, -1);
  d.normalize();
  const fh = new THREE.Vector3(f.x, 0, f.z);
  if (fh.lengthSq() < 1e-6) fh.copy(d);
  fh.normalize();
  const s = {
    kind,
    t: 0,
    dur: CRASH_SECONDS,
    p0: pos,
    q0: quat,
    vy: vel.y,
    h,
    d,
    // UP × d: horizontal, square to the track.
    across: new THREE.Vector3(d.z, 0, -d.x),
    yaw0: Math.atan2(-fh.x, -fh.z),
    side: start.side >= 0 ? 1 : -1,
    dims: start.dims,
    ground: start.ground,
    airborne: (start.agl || 0) > 12,
    slams: 0,
    pos: pos.clone(),
    quat: quat.clone(),
    contact: new THREE.Vector3(),
    hasContact: false,
    speed: 0,
    done: false,
  };
  return s;
}

function yawQ(out, a) {
  return out.setFromAxisAngle(UP, a);
}

/** Right wing down is a positive bank. */
function bankQ(out, b) {
  return out.setFromAxisAngle(AZ, -b);
}

function pitchQ(out, p) {
  return out.setFromAxisAngle(AX, p);
}

/** Ease out of the pose it hit in, so nothing pops on the first frame. */
function blendIn(s, t, secs) {
  const k = clamp(t / secs, 0, 1);
  if (k < 1) s.quat.slerpQuaternions(s.q0, s.quat, k * k * (3 - 2 * k));
}

/**
 * Advance to time t (seconds since impact). Fills s.pos, s.quat, and
 * s.contact / s.hasContact (where it is touching, for the dust) and s.speed.
 */
export function poseAt(s, t) {
  s.t = t;
  const D = s.dims;
  const g = (x, z) => s.ground(x, z);
  const u = clamp(t / s.dur, 0, 1);
  s.hasContact = false;
  switch (s.kind) {
    case 'cartwheel': {
      const v0 = clamp(s.h, 10, s.airborne ? 60 : 34);
      const tau = 0.75;
      const dist = slide(v0, tau, t);
      s.speed = v0 * Math.exp(-t / tau);
      // Round the track, tipped a little across it so it is not a perfect log roll.
      _v.copy(s.d).addScaledVector(s.across, 0.28).normalize();
      // A trainer goes over one and a half times; anything with a wing
      // longer than a bus goes over once, onto its back — the same tip speed
      // on a 36 m span would be a blur. Both end upside down.
      const turns = D.semi > 9 ? 1 : 3;
      const phi = s.side * turns * Math.PI * easeOut3(u);
      _q.setFromAxisAngle(_v, phi);
      s.quat.copy(_q).multiply(yawQ(_q2, s.yaw0));
      blendIn(s, t, 0.1);
      const x = s.p0.x + s.d.x * dist;
      const z = s.p0.z + s.d.z * dist;
      const lift = Math.max(D.r, D.semi * Math.abs(Math.sin(phi)) * 0.92 + D.r * Math.abs(Math.cos(phi)));
      const floor = g(x, z) + lift;
      const ballistic = s.p0.y + s.vy * t - 4.905 * t * t;
      const y = s.airborne ? Math.max(floor, ballistic) : floor;
      s.pos.set(x, y, z);
      // A wing tip hits the ground each time the wings pass vertical.
      const onGround = y <= floor + 0.05;
      const n = Math.floor((Math.abs(phi) + Math.PI / 2) / Math.PI);
      if (onGround) {
        s.slams = Math.max(s.slams, n);
        _w.set(1, 0, 0).applyQuaternion(s.quat);
        const sign = _w.y < 0 ? 1 : -1;
        s.contact.set(x + _w.x * D.semi * sign, 0, z + _w.z * D.semi * sign);
        s.contact.y = g(s.contact.x, s.contact.z);
        s.hasContact = true;
      }
      break;
    }
    case 'wingclip': {
      const v0 = clamp(s.h * 0.6, 6, 20);
      const tau = 0.5;
      const dist = slide(v0, tau, t);
      s.speed = v0 * Math.exp(-t / tau) + (1 - u) * 6;
      // The low wing digs in and drags it round: right tip down, it turns right.
      const yaw = s.yaw0 - s.side * 4.4 * Math.PI * easeOut3(u);
      const bank = s.side * (0.34 - 0.14 * u);
      s.quat.copy(yawQ(_q, yaw)).multiply(bankQ(_q2, bank));
      blendIn(s, t, 0.12);
      const x = s.p0.x + s.d.x * dist;
      const z = s.p0.z + s.d.z * dist;
      const y = g(x, z) + D.r + D.semi * Math.sin(Math.abs(bank)) * 0.9;
      s.pos.set(x, y, z);
      _w.set(s.side, 0, 0).applyQuaternion(s.quat);
      s.contact.set(x + _w.x * D.semi, 0, z + _w.z * D.semi);
      s.contact.y = g(s.contact.x, s.contact.z);
      s.hasContact = true;
      s.slams = Math.floor(easeOut3(u) * 2.2);
      break;
    }
    case 'noseplant': {
      const v0 = clamp(s.h, 5, 25);
      const dist = slide(v0, 0.12, t);
      s.speed = v0 * Math.exp(-t / 0.12);
      const A = 0.16;
      const target = (-62 * Math.PI) / 180;
      if (s.pitch0 === undefined) s.pitch0 = Math.asin(clamp(_v.set(0, 0, -1).applyQuaternion(s.q0).y, -1, 1));
      const pitch0 = s.pitch0;
      let pitch;
      if (t < A) pitch = pitch0 + (target - pitch0) * easeOut2(t / A);
      else {
        const w = t - A;
        // Boing: the tail wobbles and settles.
        pitch = target + (10 * Math.PI) / 180 * Math.exp(-3.2 * w) * Math.sin(17 * w);
      }
      s.quat.copy(yawQ(_q, s.yaw0)).multiply(pitchQ(_q2, pitch));
      const bury = (1 + 0.04 * D.L) * easeOut2(t / A);
      const fwd = _v.set(0, 0, -1).applyQuaternion(yawQ(_q, s.yaw0));
      const nx = s.p0.x + s.d.x * dist + fwd.x * Math.abs(D.noseZ) * 0.4;
      const nz = s.p0.z + s.d.z * dist + fwd.z * Math.abs(D.noseZ) * 0.4;
      const ny = g(nx, nz) - bury;
      // Origin = nose tip - q·(nose point).
      _w.set(0, D.noseY, D.noseZ).applyQuaternion(s.quat);
      s.pos.set(nx - _w.x, ny - _w.y, nz - _w.z);
      s.contact.set(nx, ny + bury, nz);
      s.hasContact = true;
      s.slams = t >= A ? 1 : 0;
      break;
    }
    case 'bonk': {
      const back = slide(7, 0.4, t);
      s.speed = 7 * Math.exp(-t / 0.4);
      const x = s.p0.x - s.d.x * back;
      const z = s.p0.z - s.d.z * back;
      const floor = g(x, z) + D.r;
      let y = s.p0.y + 3 * t - 4.905 * t * t;
      if (y <= floor) {
        y = floor;
        s.hasContact = true;
        s.contact.set(x, g(x, z), z);
        s.slams = 1;
      }
      s.pos.set(x, y, z);
      const wob = 0.18 * Math.sin(9 * t) * Math.exp(-2 * t);
      s.quat.copy(yawQ(_q, s.yaw0)).multiply(pitchQ(_q2, 0.26 * (1 - easeOut2(u)) + 0.08)).multiply(bankQ(_q3, wob));
      blendIn(s, t, 0.1);
      break;
    }
    case 'splash': {
      const v0 = clamp(s.h * 0.5, 3, 14);
      const dist = slide(v0, 0.45, t);
      s.speed = v0 * Math.exp(-t / 0.45);
      const x = s.p0.x + s.d.x * dist;
      const z = s.p0.z + s.d.z * dist;
      const float = D.r * 0.35;
      let y;
      if (t < 0.35) y = s.p0.y + (-D.r * 1.2 - s.p0.y) * easeOut2(t / 0.35);
      else {
        const w = t - 0.35;
        y = float - D.r * 1.55 * Math.exp(-2.4 * w) * Math.cos(7.5 * w);
      }
      s.pos.set(x, y, z);
      const pitch = (-10 * Math.PI) / 180 + (6 * Math.PI) / 180 * Math.sin(5 * t) * Math.exp(-t);
      const roll = (8 * Math.PI) / 180 * Math.sin(3.3 * t);
      s.quat.copy(yawQ(_q, s.yaw0)).multiply(pitchQ(_q2, pitch)).multiply(bankQ(_q2, roll));
      blendIn(s, t, 0.15);
      s.contact.set(x, 0, z);
      s.hasContact = true;
      s.slams = t > 0.3 ? 1 : 0;
      break;
    }
    default: {
      // bellyflop
      const v0 = clamp(s.h, 8, 30);
      const tau = 0.55;
      const dist = slide(v0, tau, t);
      s.speed = v0 * Math.exp(-t / tau);
      const yaw = s.yaw0 - s.side * 1.3 * easeOut2(u);
      s.quat.copy(yawQ(_q, yaw));
      blendIn(s, t, 0.18);
      const x = s.p0.x + s.d.x * dist;
      const z = s.p0.z + s.d.z * dist;
      const floor = g(x, z) + D.r;
      const bounce = 0.35 * D.r + 0.8;
      const hop = bounce * Math.abs(Math.sin((Math.PI * t) / 0.32)) * Math.exp(-3.5 * t);
      let y = floor + hop;
      if (t < 0.1) y = s.p0.y + (y - s.p0.y) * (t / 0.1);
      s.pos.set(x, Math.max(y, floor), z);
      s.contact.set(x, g(x, z), z);
      s.hasContact = s.speed > 0.8;
      s.slams = Math.min(3, Math.floor(t / 0.32) + 1);
    }
  }
  // And out of the place it hit, the same way: the pose it hit in is not
  // always the pose the choreography starts from (a jumbo banked 55 degrees
  // stands higher on its tip than a trainer does), and a frame that jumps
  // five metres reads as a glitch, not a crash.
  if (t < POS_BLEND && s.kind !== 'bonk') {
    const k = t / POS_BLEND;
    s.pos.lerpVectors(s.p0, s.pos, k * k * (3 - 2 * k));
  }
  if (t >= s.dur) s.done = true;
  return s;
}

const POS_BLEND = 0.14;

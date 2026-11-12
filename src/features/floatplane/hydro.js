/**
 * The sea under a float. Four keel stations; each is pushed up by what it has
 * displaced and dragged by the water it is in. Pure numbers plus one step
 * function, so tests/features/floatplane.mjs can read the drag curve.
 *
 * What a floatplane does, and this has to do: at taxi speed she ploughs, cheap;
 * around 10 m/s she climbs her own bow wave (the hump, a quarter of her weight
 * in drag); past it she is on the step, planing, and as the wing takes the
 * load the drag falls away and she unsticks. Drag is the load on the keel
 * times a coefficient, so the wing lifting her off is what lowers it.
 */

import * as THREE from '../../vendor/three.module.js';
import { heightAt, swellAt } from '../../world/terrain.js';
import { SPEC } from '../../aircraft/physics.js';

const G = 9.80665;
/** How far in a keel goes, in drafts, before it is all float and pushes as hard as it can. */
const FULL = 3;
const _r = new THREE.Vector3();
const _w = new THREE.Vector3();
const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _t = new THREE.Vector3();
const _om = new THREE.Vector3();
const _fwd = new THREE.Vector3();

/** Drag as a fraction of the load on the keel, at this speed through the water (m/s). */
export function keelDrag(v) {
  const s = Math.abs(v);
  const plough = 0.05 * s * Math.exp(-((s / 6) ** 2));
  const hump = 0.21 * Math.exp(-(((s - 10.5) / 4.4) ** 2));
  return 0.018 + 0.0032 * s + plough + hump;
}

/** The lift a planing keel makes: 1 standing still, up to 3 on the step. */
export function planeLift(v) {
  return 1 + Math.min(2, (v * v) / 240);
}

/** Yaw authority of the water rudders, 0..1: nothing standing still with no power, all of it by 6 m/s. */
export function rudderBite(v, throttle = 0) {
  return Math.min(1, Math.abs(v) / 6 + throttle * 0.35);
}

/** One physics step on the water. ac.floatStep: called after the gear, before the sum of forces is integrated. */
export function floatStep(ac, dt) {
  const fl = SPEC.floats;
  if (!fl) return;
  const m = SPEC.mass;
  const W = m * G;
  const d0 = fl.draft;
  const each = W / fl.stations.length;
  const k = each / d0;
  const c = 2 * 0.7 * Math.sqrt(k * (m / fl.stations.length));
  _om.copy(ac.omega).applyQuaternion(ac.quat);
  _fwd.set(0, 0, -1).applyQuaternion(ac.quat);
  _fwd.y = 0;
  _fwd.normalize();
  const rx = -_fwd.z;
  const rz = _fwd.x;
  let wet = 0;
  let load = 0;
  for (const s of fl.stations) {
    _r.set(s[0], s[1], s[2]).applyQuaternion(ac.quat);
    _w.copy(_r).add(ac.pos);
    // The water's own height here: she rides the swell (world/sea-state.js).
    const d = swellAt(_w.x, _w.z) - _w.y;
    if (d <= 0 || heightAt(_w.x, _w.z) >= 0) continue;
    _v.copy(_om).cross(_r).add(ac.vel);
    const hs = Math.hypot(_v.x, _v.z);
    let N = (Math.min(d, d0 * FULL) / d0) * each * planeLift(hs);
    if (d > d0 * FULL) N += (d - d0 * FULL) * k * 6;
    N = Math.max(0, N - c * _v.y);
    wet++;
    load += N;
    const along = _v.x * _fwd.x + _v.z * _fwd.z;
    const side = _v.x * rx + _v.z * rz;
    const cd = keelDrag(along);
    const fa = -Math.sign(along) * N * cd;
    // A keel is a blade sideways: firm, and never more than stops that sideways slip in a step.
    const lim = Math.abs(side) * (m * 0.25) / Math.max(dt, 1 / 240);
    const fs = Math.max(-lim, Math.min(lim, -side * N * 0.45));
    _f.set(_fwd.x * fa + rx * fs, N, _fwd.z * fa + rz * fs);
    ac._f.add(_f);
    // The drag acts through the hull, not at the keel's depth: taken at the keel it couples
    // with the thrust and held her nose five degrees down at taxi speed.
    _t.set(_r.x, _r.y * 0.2, _r.z).cross(_f).applyQuaternion(ac._invQ);
    ac._t.add(_t);
  }
  ac.onWater = wet > 0;
  if (!wet) return;
  // The runway's heading hold is written for tyres: on a keel it and its drift term fought
  // each other, and she swung twenty-five degrees either side of her course.
  ac._rollHeading = null;
  ac.contactCount += wet;
  ac.wheelLoad += load;
  // The water rudders, and water holding her straight. +Y torque is nose left.
  const along = ac.vel.x * _fwd.x + ac.vel.z * _fwd.z;
  const share = Math.min(1, load / W);
  const steer = (ac.controls.yaw || 0) + (ac.mode === 'simplified' ? ac._steerAssist || 0 : 0);
  ac._t.y += -steer * rudderBite(along, ac.controls.throttle) * SPEC.Iyy * 1.1 * share;
  // Light on the step the rudders have little to bite on, and without this she yawed twenty degrees each way.
  ac._t.y += -ac.omega.y * SPEC.Iyy * (1.6 * share + 5 * (1 - share));
  // Two hulls a beam apart do not rock: nearly flying on one float she went wing to wing, sixteen degrees each way.
  ac._t.z += -ac.omega.z * SPEC.Izz * 7;
}

/** The landing's marks on water: speed and sink limits of its own, and no runway to be on. */
export function gradeWater(ac, vsFpm, bank, difficulty = 'normal') {
  const sink = Math.abs(vsFpm);
  const kts = Math.round(ac.groundSpeed * 1.94384);
  const hard = difficulty === 'easy' ? 1.35 : difficulty === 'realistic' ? 0.85 : 1;
  const sinkLimit = 760 * hard;
  const speedLimit = 82;
  const pitch = ac.pitchAngleDeg();
  let crashed = false;
  let reason = '';
  if (sink > sinkLimit) {
    crashed = true;
    reason = 'You hit the water far too hard';
  } else if (Math.abs(bank) > 16) {
    crashed = true;
    reason = 'A float dug in and she went over';
  } else if (kts > speedLimit) {
    crashed = true;
    reason = 'Too fast on the water: the floats tripped';
  } else if (pitch < -7) {
    crashed = true;
    reason = 'The float bows dug in and she went over';
  }
  const smooth = Math.max(0, Math.min(1, 1 - sink / 560));
  const level = Math.max(0, Math.min(1, 1 - Math.abs(bank) / 12));
  const speedOk = Math.max(0, Math.min(1, 1 - Math.abs(kts - 55) / 34));
  const attitude = Math.max(0, Math.min(1, 1 - Math.abs(pitch - 4) / 9));
  const score = Math.round(smooth * 56 + level * 18 + speedOk * 14 + attitude * 12);
  const quality = crashed ? 'rough' : sink < 150 ? 'perfect' : sink < 320 ? 'good' : sink < 520 ? 'firm' : 'rough';
  return { crashed, reason, quality, vsFpm: Math.round(vsFpm), bank: Math.round(bank), centreline: 0, onRunway: true, paved: false, water: true, speedKts: kts, score: Math.max(0, Math.min(100, score)) };
}

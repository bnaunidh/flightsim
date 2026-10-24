/**
 * THE AIRFRAME AFTER THE HIT — the owner's bar is BeamNG.drive's aeroplanes
 * (2026-10-23: "need to be a lot better"): the impact depends on speed, angle
 * and WHERE it hits. A wing tip that catches the ground throws the aeroplane
 * into a yaw and a roll over it (a cartwheel); a belly slides on, sparks
 * flying, until friction stops it; nose-in, the forward fuselage takes it and
 * the tail comes over; a tail strike slaps the nose down. None of that is
 * choreographed here. What is left of the airframe after the break-up becomes
 * a rigid body (src/game/breakup-body.js) on ITS OWN contact points — the
 * nose, the tail, the wing tips, the fin top, the belly, read off the zone
 * boxes of what is still on it — and the surface takes hold of the point
 * that touched the way the impact's kind says (catchPoint: grip and
 * restitution from game/breakup.js classifyImpact). The rest is physics.
 *
 * This file is the pure part — no scene, no DOM — so the node tests can run
 * all of it:
 *
 *   hullOf(asg, layout, gone)          the body's points, size and centre from
 *                                      the zones still on the airframe
 *   hingeFor(frame, zone, com, rand)   the seam a hanging piece swings on
 *   hangPose(hinge, t, out)            where a hanging piece is, t seconds
 *                                      into its hang (a local matrix)
 *   attachedPose(M, attach, t, pos, quat)
 *                                      a piece still on the airframe, world
 *
 * features/breakup.js steps the body every frame, writes the aeroplane's
 * position and attitude from it (the game draws the model from those), and
 * hands the wreck to the slow sink once it has stopped in the sea.
 */

import * as THREE from '../../vendor/three.module.js';
import { ZONES } from '../../game/breakup.js';

/** A bounce of the airframe this hard (m/s into the ground) tears off whatever was hanging on by a thread. */
export const JOLT_TEARS = 4;
/** In the sea: once the airframe is this slow (m/s), or after this long (s), the slow sink takes it. */
export const SINK_HANDOFF = { speed: 2.5, maxT: 6 };
/** Zones whose box corners make the airframe's contact points (not folded gear, not blades). */
const HULL_ZONES = /^(nose|core|rear|wingInner|wingOuter|fin|tailplane|engine)/;
/** How a hanging part droops: radians, and the seconds it takes to get there. */
export const DROOP = { wing: 0.55, tail: 0.5, fin: 0.6, engine: 0.45, tau: 0.35, flutter: 0.08, flutterHz: 2.8 };

const _v = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * The body of what is left: every corner of every remaining zone's box (body
 * metres, model axes), the union box's size and its centre (the body's
 * centre of mass, as a model-local offset). `gone` is the set of zones that
 * have come off (torn or hanging). Returns null when nothing is left.
 */
export function hullOf(asg, layout, gone) {
  const boxes = asg.boxes || {};
  const points = [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const zones = [];
  for (const id of layout.zones) {
    if (gone && gone.has(id)) continue;
    if (!HULL_ZONES.test(id)) continue;
    const b = boxes[id];
    if (!b) continue;
    zones.push(id);
    for (let k = 0; k < 3; k++) {
      if (b.min[k] < min[k]) min[k] = b.min[k];
      if (b.max[k] > max[k]) max[k] = b.max[k];
    }
    for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) points.push([x, y, z]);
  }
  if (points.length < 4) return null;
  const com = new THREE.Vector3((min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2);
  const size = new THREE.Vector3(Math.max(0.3, max[0] - min[0]), Math.max(0.3, max[1] - min[1]), Math.max(0.3, max[2] - min[2]));
  // Points about the centre of mass, deduplicated (shared box faces give the same corner twice).
  const seen = new Set();
  const local = [];
  for (const p of points) {
    const key = `${Math.round(p[0] * 20)},${Math.round(p[1] * 20)},${Math.round(p[2] * 20)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    local.push([p[0] - com.x, p[1] - com.y, p[2] - com.z]);
  }
  return { points: local, size, com, zones };
}

/**
 * The seam a hanging zone swings on: a pivot (body metres) and an axis, and
 * how far it droops (signed). A wing or tailplane bends about the fore-aft
 * line at its root, down under its own weight; a fin leans over sideways
 * (the side the seed says); an engine droops nose-down on its pylon.
 */
export function hingeFor(frame, zone, com, rand = Math.random) {
  const Z = ZONES[zone] || {};
  const f = frame;
  if (Z.kind === 'wing' && f.wing) {
    const s = Z.side || (com.x < 0 ? -1 : 1);
    const hingeX = /Outer/.test(zone) ? f.wing.splitX : Math.max(f.wing.rootX, 0.05);
    // About +Z at the root, the tip going DOWN: the left tip (-x) goes down on a positive turn about +z, the right on a negative one.
    return { pivot: new THREE.Vector3(s * hingeX, com.y, com.z), axis: new THREE.Vector3(0, 0, 1), droop: -s * DROOP.wing, phase: rand() * 6.28 };
  }
  if (zone === 'tailplaneL' || zone === 'tailplaneR') {
    const s = Z.side || (com.x < 0 ? -1 : 1);
    return { pivot: new THREE.Vector3(s * 0.3 * (f.scale || 1), com.y, com.z), axis: new THREE.Vector3(0, 0, 1), droop: -s * DROOP.tail, phase: rand() * 6.28 };
  }
  if (zone === 'fin') {
    const side = rand() < 0.5 ? -1 : 1;
    const top = f.profile.reduce((m, p) => Math.max(m, p.top), 0);
    return { pivot: new THREE.Vector3(0, Math.min(top, com.y), com.z), axis: new THREE.Vector3(0, 0, 1), droop: side * DROOP.fin, phase: rand() * 6.28 };
  }
  if (Z.kind === 'engine') {
    const e = f.engines.find((q) => q.id === zone);
    const top = e ? e.y + e.r : com.y + 0.5;
    // About +X at the top of the pylon, the intake dropping: for a body facing -z the intake (ahead of the pivot) goes down on a NEGATIVE turn about +x.
    return { pivot: new THREE.Vector3(com.x, top, com.z), axis: new THREE.Vector3(1, 0, 0), droop: -DROOP.engine, phase: rand() * 6.28 };
  }
  return { pivot: com.clone(), axis: new THREE.Vector3(0, 0, 1), droop: 0, phase: 0 };
}

/** The hinge's angle `t` seconds into the hang: it sags to its droop over DROOP.tau and flutters a little on the way. */
export function hangAngle(hinge, t) {
  if (!(t > 0)) return 0;
  const k = 1 - Math.exp(-t / DROOP.tau);
  const flutter = Math.sin(t * DROOP.flutterHz * 6.283 + hinge.phase) * DROOP.flutter * Math.exp(-t * 1.5) * Math.min(1, t * 6);
  return hinge.droop * k + flutter * Math.sign(hinge.droop || 1);
}

/**
 * The local (model-axes, body-metre) matrix of a hanging piece `t` seconds
 * into its hang: turned about its hinge, then where its centre sat. `out` is
 * filled and returned.
 */
export function hangPose(hinge, com, t, out) {
  const a = hangAngle(hinge, t);
  _q.setFromAxisAngle(hinge.axis, a);
  // T(pivot) R T(-pivot) T(com)
  out.makeTranslation(hinge.pivot.x, hinge.pivot.y, hinge.pivot.z);
  _m.makeRotationFromQuaternion(_q);
  out.multiply(_m);
  _m.makeTranslation(com.x - hinge.pivot.x, com.y - hinge.pivot.y, com.z - hinge.pivot.z);
  out.multiply(_m);
  return out;
}

/**
 * Where a piece still on the airframe is, in the world: the airframe's pose
 * `M` (position and rotation only) times the piece's place on it — swinging
 * on its hinge when it is hanging and its hang has begun (`t` seconds ago).
 * Fills `pos` and `quat`.
 */
export function attachedPose(M, attach, t, pos, quat) {
  if (attach.hinge && t > 0) hangPose(attach.hinge, attach.com, t, _m2);
  else _m2.copy(attach.local);
  _m.multiplyMatrices(M, _m2).decompose(pos, quat, _s);
  return pos;
}

/** The velocity of a point `r` out from a body's centre (world), given its velocity and turning. */
export function pointVelocity(vel, omega, r, out) {
  return out.copy(omega).cross(r).add(vel);
}

void _v;

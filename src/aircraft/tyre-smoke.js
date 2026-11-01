/**
 * Touchdown tyre smoke, in flight (A6 of the rival brief).
 *
 * fleet/effects.js has had createTouchdownSmoke() since the model preview
 * gallery was built — a bounded pool of 48 puffs that grow, thin and drift —
 * and nothing in the game ever fired it: the player's touchdown already
 * makes the thump and the chirp (main.js, EVENTS.TOUCHDOWN) but no smoke.
 *
 * This fires it from that same event: a puff at each main wheel's contact
 * patch, sized by the sink rate and by the ground speed the tyres have to
 * spin up to (a fast, firm arrival smokes; a feather-light one barely), and
 * the puffs are left on the runway behind you — the pool sits in the world
 * at the touchdown point, not on the aeroplane. Small and grey, no fire, no
 * cartoon; nothing on a wet grass strip (the brief's "realistic, not
 * cartoon": wet grass does not smoke).
 */

import * as THREE from '../vendor/three.module.js';
import { createTouchdownSmoke } from '../fleet/effects.js';

export const TYRE_SMOKE = Object.freeze({
  /** Metres per second of sink under which there is no puff. */
  minSinkMps: 0.4,
  /** Metres per second of ground speed under which there is no puff (a rolling re-contact). */
  minSpeedMps: 12,
  /** The effect's full-strength descent rate is 3.5 m/s; ground speed adds this much per m/s. */
  speedToSink: 1 / 45,
  /** How long the pool keeps updating after the last puff (its longest life is 1.45 s). */
  settleS: 2.5,
  /** A puff's longest life (fleet/effects.js: 0.65 + 0.8 s): a pool younger than this is still showing puffs. */
  puffLifeS: 1.45,
  /** The pool was drawn for a gallery close-up; in the world its puffs are this much larger (a metre or two, like real ones). */
  scale: 1.6,
});

const _fwd = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _inv = new THREE.Quaternion();
const _axisY = new THREE.Vector3(0, 1, 0);

/**
 * Pure: the puff's strength input (the effect's "descent rate", m/s) for a
 * touchdown, or 0 for none. `sinkMps` the sink at contact, `speedMps` the
 * ground speed, `paved` whether the surface is hard, `wet` 0..1.
 */
export function smokeDescentRate(sinkMps, speedMps, paved = true, wet = 0) {
  const sink = Math.abs(sinkMps);
  if (sink < TYRE_SMOKE.minSinkMps || speedMps < TYRE_SMOKE.minSpeedMps) return 0;
  if (!paved && wet > 0.3) return 0;
  const v = sink + speedMps * TYRE_SMOKE.speedToSink;
  // Grass makes dust, less of it.
  return paved ? v : v * 0.55;
}

/**
 * The main wheels' contact points in aircraft space, from the built model
 * (aircraft/model.js keeps its gear in userData.parts.gear), else a pair a
 * tenth of the span apart.
 */
export function mainWheelContacts(model, spanM = 11) {
  const out = [];
  const parts = model && model.userData && model.userData.parts;
  const mains = parts && parts.gear && parts.gear.mains;
  if (Array.isArray(mains) && mains.length) {
    for (const m of mains) {
      const g = m.group || m.wheel;
      if (g && g.position) out.push([g.position.x, 0.08, g.position.z]);
    }
  }
  if (out.length < 2) {
    const half = Math.max(0.8, spanM * 0.1);
    return [[-half, 0.08, 0], [half, 0.08, 0]];
  }
  return out.slice(0, 4);
}

export class TyreSmoke {
  /*
   * Two pools, not one: a pool is parked at its touchdown point, so a bounce
   * (or a rolling re-contact) re-using it within a puff's life would carry
   * the first touchdown's puffs forward to the second — smoke jumping tens of
   * metres down the runway. Each touchdown takes the pool that has been
   * quiet longest; if both are still smoking, it makes no new puff.
   * (Checker, realism-1.) `fx` is the pool used last.
   */
  constructor(scene) {
    this.pools = [0, 1].map(() => {
      const fx = createTouchdownSmoke({ initialGrounded: true });
      fx.name = 'tyre-smoke';
      fx.visible = false;
      fx.frustumCulled = false;
      fx.scale.setScalar(TYRE_SMOKE.scale);
      fx.userData.left = 0;
      scene.add(fx);
      return fx;
    });
    this.fx = this.pools[0];
    this.puffs = 0;
  }

  /** Seconds the longest-lived pool still has to run (0 when all have settled). */
  get left() {
    return Math.max(...this.pools.map((p) => p.userData.left));
  }

  /**
   * The player's touchdown: `ac` the aircraft (pos, quat, vel, groundSpeed),
   * `grade` the touchdown grade (vsFpm, paved), `model` its model, `wet`
   * the surface wetness 0..1 (render/surfaces.js). Returns the strength
   * used, 0 for no puff.
   */
  touchdown(ac, grade, model, wet = 0, spanM = 11) {
    if (!ac || !grade || grade.crashed) return 0;
    const sink = Math.abs(grade.vsFpm || 0) / 196.85;
    const rate = smokeDescentRate(sink, ac.groundSpeed || 0, grade.paved !== false, wet);
    if (rate <= 0) return 0;
    // The pool that has been quiet longest; one still showing its puffs is never moved.
    const fx = this.pools[0].userData.left <= this.pools[1].userData.left ? this.pools[0] : this.pools[1];
    if (fx.userData.left > TYRE_SMOKE.settleS - TYRE_SMOKE.puffLifeS) return 0;
    // The pool sits in the world at the touchdown point, turned to the heading, so the puffs stay behind.
    _fwd.set(0, 0, -1).applyQuaternion(ac.quat);
    const yaw = Math.atan2(-_fwd.x, -_fwd.z);
    fx.position.copy(ac.pos);
    fx.rotation.set(0, yaw, 0);
    fx.updateMatrixWorld(true);
    _inv.setFromAxisAngle(_axisY, -yaw);
    _vel.copy(ac.vel).applyQuaternion(_inv);
    // The pool is scaled up (TYRE_SMOKE.scale): wheel positions and speeds go in at the pool's own scale.
    const k = 1 / TYRE_SMOKE.scale;
    fx.userData.trigger({
      descentRate: rate,
      contacts: mainWheelContacts(model, spanM).map((c) => [c[0] * k, c[1] * k, c[2] * k]),
      velocity: [_vel.x * k, 0, _vel.z * k],
    });
    fx.visible = true;
    fx.userData.left = TYRE_SMOKE.settleS;
    this.fx = fx;
    this.puffs++;
    return rate;
  }

  update(dt, camera) {
    for (const fx of this.pools) {
      if (fx.userData.left <= 0) continue;
      fx.userData.left -= dt;
      fx.userData.update(dt, { camera });
      if (fx.userData.left <= 0) fx.visible = false;
    }
  }

  dispose() {
    for (const fx of this.pools) {
      if (fx.userData.dispose) fx.userData.dispose();
      if (fx.parent) fx.parent.remove(fx);
    }
  }
}

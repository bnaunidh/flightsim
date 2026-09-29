/**
 * Two fighter jets sent up to an airliner that has squawked 7500.
 *
 * When a transponder shows 7500, a pair of fighters really is sent up. They
 * are there to keep eyes on the aeroplane and to guide it, not to do
 * anything to it, and what they do depends on the story:
 *
 *   'shadow'   sit low behind the tail, out of sight of anybody in the
 *              cockpit. The film version: the hijacker is on the flight deck
 *              and must not see them. Hold B to look behind and they are there.
 *   'lead'     the intercept position from the ICAO rules (Annex 2, App. 2):
 *              slightly above, ahead and to the LEFT of the airliner. Rocking
 *              the wings from there means "You have been intercepted. Follow
 *              me", and the slow level turn that follows is the way to go.
 *   'trail'    the second jet's place while the leader leads: behind and to
 *              the right, keeping watch.
 *   'breakaway' an abrupt climbing turn of ninety degrees or more away from
 *              the airliner, without crossing its path — the signal for "You
 *              may proceed".
 *   'wing'     alongside a wingtip, used by the escort that joins, rocks its
 *              wings to say goodbye and 'break's off (the gentle ending).
 *
 * These are pictures with a position, like the jets in Shake the Tail — not
 * flight models, not colliders. Every vector a jet uses is allocated when it
 * is built; update() makes nothing.
 */

import * as THREE from '../../vendor/three.module.js';
import { createAircraftModel } from '../../aircraft/model-adapter.js';
import { AIRCRAFT, getAircraft } from '../../aircraft/types.js';
import { heightAt } from '../../world/terrain.js';

const FWD = new THREE.Vector3(0, 0, -1);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);
const DEG = Math.PI / 180;

/**
 * The F-22 if the fighters team's roster has one, otherwise the Vanguard.
 * Looked up rather than asked for by id, because getAircraft() falls back to
 * the TRAINER for an unknown id — and a Skylark escorting a jumbo is a joke
 * nobody meant to tell.
 */
export function escortType() {
  return AIRCRAFT.find((a) => a.id === 'f22') || getAircraft('vanguard');
}

export class Escort {
  /**
   * @param {THREE.Scene} scene
   * @param {number} side  -1 = the airliner's left, +1 = its right
   */
  constructor(scene, side, type = escortType()) {
    this.scene = scene;
    this.side = side;
    this.type = type;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.mode = 'join'; // join/form/salute (wing slot) | shadow | lead | trail | break | breakaway
    this.slot = 'wing';
    this.t = 0;
    this.modeT = 0;
    this.dist = Infinity;
    this.formed = false;
    this.gone = false;
    /** In 'lead': the heading the leader is flying, degrees. The airliner follows it. */
    this.leadHeading = 0;
    /** Rock the wings: the ICAO "follow me", or a wave. */
    this.rock = false;
    /** 'shadow' only: 1 = sink a further 25 m out of sight (somebody is looking). */
    this.duck = 0;
    /** 'lead' only: the height to lead the airliner down to, or null for alongside. */
    this.leadAlt = null;
    this._rockT = 0;
    this._bank = 0;
    this._lastHdg = null;
    this._gearWant = 0;

    this._slot = new THREE.Vector3();
    this._local = new THREE.Vector3();
    this._to = new THREE.Vector3();
    this._want = new THREE.Vector3();
    this._dir = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._qh = new THREE.Quaternion();
    this._qr = new THREE.Quaternion();
    this._right = new THREE.Vector3();

    this.model = null;
    try {
      this.model = createAircraftModel({ type, livery: type.livery });
      this.model.name = `escort-${side < 0 ? 'left' : 'right'}`;
      scene.add(this.model);
    } catch (e) {
      console.warn('[events] an escort jet could not be built; it will be invisible.', e);
    }
    // What the model's own animation reads: gear up, engine running. One
    // object, reused, so the per-frame call allocates nothing.
    this._state = {
      controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.8, brakes: 0 },
      rpm: 0.9,
      flaps: 0,
      gearPos: 0,
      gearDown: false,
      onGround: false,
      groundSpeed: 0,
      engineOn: true,
      agl: 500,
      alt: 0,
      airspeed: 0,
      ias: 0,
      vel: this.vel,
      pos: this.pos,
      quat: this.model ? this.model.quaternion : new THREE.Quaternion(),
    };
    this._animOk = true;
  }

  /** Start a long way behind, off to its own side, so the join is visible. */
  placeBehind(ac, distance = 1800) {
    this._local.set(this.side * 140, 30, distance);
    this.pos.copy(this._local).applyQuaternion(ac.quat).add(ac.pos);
    const floor = heightAt(this.pos.x, this.pos.z) + 120;
    if (this.pos.y < floor) this.pos.y = floor;
    this.vel.copy(ac.vel);
    if (this.model) {
      this.model.position.copy(this.pos);
      this.model.quaternion.copy(ac.quat);
    }
  }

  setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.modeT = 0;
    if (mode === 'shadow' || mode === 'lead' || mode === 'trail') this.slot = mode;
    else if (mode === 'join' || mode === 'form' || mode === 'salute') this.slot = 'wing';
    if (mode === 'breakaway' || mode === 'break') this.rock = false;
  }

  /**
   * Where this jet wants to be, in the world. `span` is the airliner's
   * wingspan, so every slot clears its wingtips whatever it is.
   */
  slotFor(ac, span, out) {
    if (this.slot === 'lead') {
      // Ahead, left and above — along the heading the LEADER is flying,
      // so once the airliner follows it the leader is exactly where the
      // rules put it, and until then it is showing the way to turn.
      const h = this.leadHeading * DEG;
      this._f.set(Math.sin(h), 0, -Math.cos(h));
      this._r.set(Math.cos(h), 0, Math.sin(h));
      /*
       * Close enough to read. This was 170 m + 1.2 spans ahead (250 m for
       * the 747) and 77 m out, and the airliners' chase camera stands 140 m
       * behind a jumbo: nearly 400 m from the camera, the F-22 was a speck
       * in the screenshot, and the signal the whole scene is about could not
       * be seen rocking. At 80 m + half a span ahead of the centre (about
       * 75 m in front of a 747's nose) and 25 m clear of the wingtip it is
       * plainly an aeroplane, banking.
       */
      out.copy(ac.pos)
        .addScaledVector(this._f, 80 + span * 0.5)
        .addScaledVector(this._r, -(span * 0.5 + 25))
        .addScaledVector(Y, 12);
      /*
       * Leading the way down. With `leadAlt` set (the height the story wants
       * the airliner at, hijack.js), the leader flies that instead — but
       * never more than 60 m below the airliner, and never above its usual
       * 12 m. Sixty, not more: the chase camera stands about 140 m behind a
       * 747, and a jet 110 m ahead of the airliner's centre and 160 m down
       * sits roughly 30 degrees below the middle of the picture, at the
       * bottom edge or off it, leading a way nobody could see. Sixty below,
       * and still going down, is "follow me down".
       */
      if (this.leadAlt != null && Number.isFinite(this.leadAlt)) {
        out.y = Math.min(ac.pos.y + 12, Math.max(ac.pos.y - 60, this.leadAlt + 12));
      }
      return out;
    }
    if (this.slot === 'shadow') {
      // Low behind the tail: the one place a person on the flight deck
      // cannot see. (160 m + 1.2 spans: 237 m behind a 747, close enough to
      // make out from over the fin, which is where "hold B" puts you.)
      this._local.set(this.side * (span * 0.5 + 24), -30 - this.duck * 25, 160 + span * 1.2);
    } else if (this.slot === 'trail') {
      this._local.set(this.side * (span * 0.5 + 40), 12, 150 + span);
    } else {
      // The wing slot: off the wingtip, a little back, a little up.
      this._local.set(this.side * (span * 0.5 + 36), 5, 30);
    }
    return out.copy(this._local).applyQuaternion(ac.quat).add(ac.pos);
  }

  /** @param {number} span  the airliner's wingspan, so the slot clears its tips */
  update(dt, ac, span = 30, weather = null) {
    if (this.gone) return;
    this.t += dt;
    this.modeT += dt;
    const acSpeed = ac.vel.length();

    if (this.mode === 'break' || this.mode === 'breakaway') {
      // Away and up, accelerating. 'break' peels off at about thirty-five
      // degrees; 'breakaway' is the intercept signal, a hard climbing turn
      // through ninety degrees or more, on its own side so it never crosses
      // the airliner's path.
      const hard = this.mode === 'breakaway';
      this._right.set(1, 0, 0).applyQuaternion(ac.quat).setY(0);
      if (this._right.lengthSq() < 1e-6) this._right.set(1, 0, 0);
      this._right.normalize();
      this._dir.copy(FWD).applyQuaternion(ac.quat).setY(0);
      if (this._dir.lengthSq() < 1e-6) this._dir.set(0, 0, -1);
      this._dir.normalize();
      if (hard) this._dir.multiplyScalar(-0.15).addScaledVector(this._right, this.side * 0.99);
      else this._dir.multiplyScalar(0.82).addScaledVector(this._right, this.side * 0.57);
      this._dir.y = hard ? 0.55 : 0.36;
      this._dir.normalize();
      this._want.copy(this._dir).multiplyScalar(Math.max(acSpeed, 90) + (hard ? 110 : 80));
      this.vel.lerp(this._want, 1 - Math.exp(-dt * (hard ? 1.6 : 1.2)));
      this.pos.addScaledVector(this.vel, dt);
      if (this.modeT > 24) this.dispose();
      this.orient(dt, null, -this.side * (hard ? 1.25 : 1.0));
      this.animate(dt, weather);
      return;
    }

    this.slotFor(ac, span, this._slot);
    this._to.subVectors(this._slot, this.pos);
    const d = this._to.length();
    this.dist = d;

    // Carry the airliner's velocity, plus whatever closes the gap. The
    // closing speed tapers as the gap does, so it slides into place rather
    // than overshooting it.
    const close = Math.min(85, d * 0.55);
    this._want.copy(ac.vel);
    if (d > 0.01) this._want.addScaledVector(this._to, close / d);
    this.vel.lerp(this._want, 1 - Math.exp(-dt * 2.4));
    this.pos.addScaledVector(this.vel, dt);
    const floor = heightAt(this.pos.x, this.pos.z) + 25;
    if (this.pos.y < floor) this.pos.y = floor;

    if (this.mode === 'join' && d < 28) this.setMode('form');
    if (this.slot === 'wing') this.formed = this.mode === 'form' || this.mode === 'salute';
    else this.formed = d < 60;

    let roll = 0;
    if (this.mode === 'salute') {
      // Rocking the wings is how one aeroplane waves to another.
      roll = Math.sin(this.modeT * 5.2) * 0.42 * Math.min(1, this.modeT * 2);
      if (this.modeT > 2.8) this.setMode('break');
    }
    if (this.rock) {
      this._rockT += dt;
      // Big and slow enough to read from a flight deck: about 30 degrees
      // each way, a full rock every 1.6 s.
      roll += Math.sin(this._rockT * 3.9) * 0.52 * Math.min(1, this._rockT * 1.5);
    } else {
      this._rockT = 0;
    }

    if (this.slot === 'lead' && d < 140) {
      // Pointing where it is leading, banked into its own turn.
      const h = this.leadHeading;
      if (this._lastHdg !== null && dt > 0) {
        const rate = (((h - this._lastHdg + 540) % 360) - 180) / dt; // deg/s, + = right
        const want = Math.max(-0.5, Math.min(0.5, -rate * 0.1));
        this._bank += (want - this._bank) * (1 - Math.exp(-dt * 2));
      }
      this._lastHdg = h;
      this._qh.setFromAxisAngle(Y, -h * DEG);
      this.orient(dt, this._qh, roll + this._bank);
    } else {
      this._lastHdg = null;
      this.orient(dt, d < 90 ? ac.quat : null, roll);
    }
    this.animate(dt, weather);
  }

  /** Face along the velocity, or copy a given attitude once alongside. */
  orient(dt, match, roll) {
    if (!this.model) return;
    if (match) {
      this._q.copy(match);
    } else {
      this._dir.copy(this.vel);
      if (this._dir.lengthSq() < 1) this._dir.copy(FWD).applyQuaternion(this.model.quaternion);
      this._dir.normalize();
      this._q.setFromUnitVectors(FWD, this._dir);
    }
    if (roll) {
      this._qr.setFromAxisAngle(Z, roll);
      this._q.multiply(this._qr);
    }
    this.model.quaternion.slerp(this._q, 1 - Math.exp(-dt * 3));
    this.model.position.copy(this.pos);
  }

  /**
   * Wheels down or up. Down, from the leader on an approach, is the ICAO
   * signal "land at this aerodrome" (Annex 2, Appendix 2, Series 3). Both
   * model factories animate the legs from `gearPos`, so easing that number
   * is all it takes.
   */
  setGear(down) {
    this._state.gearDown = !!down;
    this._gearWant = down ? 1 : 0;
  }

  get gearDown() {
    return this._state.gearDown;
  }

  animate(dt, weather) {
    if (!this.model || !this._animOk || !this.model.userData.update) return;
    const s = this._state;
    const gw = this._gearWant || 0;
    if (s.gearPos !== gw) s.gearPos = gw > s.gearPos ? Math.min(gw, s.gearPos + dt / 4) : Math.max(gw, s.gearPos - dt / 4);
    s.alt = this.pos.y;
    s.airspeed = s.ias = this.vel.length();
    try {
      this.model.userData.update(dt, s, weather || { isNight: false, cond: { cloud: 0 } });
    } catch (e) {
      // A model that will not animate is still worth looking at.
      this._animOk = false;
      console.warn('[events] escort model animation failed; showing it still.', e);
    }
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    if (this.model) {
      this.scene.remove(this.model);
      // The same teardown main.js gives the aeroplane you fly when you swap
      // it: every event builds two of these, and a session is many events.
      const seen = new Set();
      this.model.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) {
          seen.add(o.geometry);
          o.geometry.dispose();
        }
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        for (const m of mats) {
          if (seen.has(m)) continue;
          seen.add(m);
          m.dispose();
        }
      });
    }
    this.model = null;
  }
}

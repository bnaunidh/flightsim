/**
 * An aircraft the game flies for you, in a story where you are flying
 * something else: the airliner you intercept, when you are the fighter.
 *
 * A picture with a position, in the same spirit as the escort jets
 * (src/features/events/escort.js) and the Shake the Tail pursuers — not a
 * flight model and not a collider. Heading, height and speed, each changed
 * at a rate a real aeroplane of the kind could manage, and the attitude
 * drawn from them: it banks to turn, pitches to climb, flares, sits on its
 * wheels and stops.
 *
 * Four ways to fly it:
 *   'hold'    keep the heading, height and speed it has
 *   'direct'  fly the heading, height and speed set by direct()
 *   'follow'  hold station behind and to the right of a leader — the place
 *             an intercepted aircraft flies when it follows the interceptor
 *   'land'    its own approach to a runway — round to an entry point and a
 *             gate if it is not lined up, then the three-degree slope, the
 *             flare, the roll-out — and stop where it was told to
 *
 * WHAT IT MUST NEVER DO is crash, whatever a child leads it into. So it
 * has a floor: never below the ground ahead plus `floorAGL` (300 m in the
 * air, the wheels' own clearance on a lined-up final), whatever it is asked
 * for; never faster than 1,500 ft a minute up or down; never more than 25
 * degrees of bank. And the landing is its own: a leader can bring it to the
 * runway, but the last two kilometres are flown here, on the slope.
 *
 * It exposes pos, vel, quat, heading, onGround, groundSpeed and gearDown,
 * so Escort.update(dt, npc, span) works on it unchanged: the wingman can
 * trail the airliner the same way the captain seat's jets trail you.
 * Every vector is allocated here; update() makes nothing.
 */

import * as THREE from '../../vendor/three.module.js';
import { createAircraftModel, groundOffsetFor } from '../../aircraft/model-adapter.js';
import { AIRCRAFT, getAircraft, specFor } from '../../aircraft/types.js';
import { heightAt } from '../../world/terrain.js';

const G = 9.81;
const DEG = Math.PI / 180;
const TAN3 = Math.tan(3 * DEG);
const EUL = new THREE.Euler();
const FLOOR_AHEAD = [4, 8, 12, 16, 20, 25, 30, 35, 40, 45];

function wrap(h) {
  return ((h % 360) + 360) % 360;
}

/** Signed b - a, degrees, -180..180. */
function adiff(a, b) {
  return ((b - a + 540) % 360) - 180;
}

function bearingTo(ax, az, bx, bz) {
  return wrap((Math.atan2(bx - ax, -(bz - az)) * 180) / Math.PI);
}

function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

/** The ground, or the sea's surface: what a floor is measured from. */
function surface(x, z) {
  const h = heightAt(x, z);
  return h > 0 ? h : 0;
}

export class NpcFlyer {
  /**
   * @param {THREE.Scene} scene
   * @param {string} typeId  an aircraft id; looked up rather than asked for,
   *        because getAircraft() falls back to the trainer for an unknown id
   */
  /**
   * @param {object} [opts.livery] a scheme from aircraft/liveries.js
   *        (schemeFor()'s return) to paint this NPC in, overriding the
   *        type's own house colours — the airliner you intercept always
   *        wears house colours in a hijack; the one "Air Force One" flies
   *        (src/game/roles/afo-lead.js) always wears that scheme, whichever
   *        seat is a person's.
   */
  constructor(scene, typeId, { name = 'npc', livery = null } = {}) {
    this.scene = scene;
    this.type = AIRCRAFT.find((a) => a.id === typeId) || getAircraft(typeId);
    this.id = this.type.id;
    this.span = (this.type.aero && this.type.aero.wingSpan) || 30;
    // As hijack.js's planeFrame(): the fleet airliners are about as long as they are wide.
    this.length = this.span * 1.05;
    this.callsign = this.type.callsign || 'Island seven four seven heavy';

    /*
     * How high the middle of it sits when it is on its wheels: the lowest
     * gear point, less the oleo the flight model squashes under the weight.
     * Measured in the game on Kestrel's runway, the 747 rests 5.3 m up with
     * its gear points at -5.9 and 1.05 m of travel — about half of it.
     */
    let low = -2;
    let travel = 0.3;
    try {
      const sp = specFor(this.type.id);
      this._spec = sp;
      for (const p of sp.gearPoints) {
        if (p.pos.y < low) low = p.pos.y;
        travel = Math.max(travel, p.travel || 0);
      }
    } catch (e) {
      this._spec = null;
    }
    this.ride = Math.max(0.8, -low - travel * 0.55);

    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.heading = 0;
    this.speed = 0;
    this.vs = 0;
    this.bank = 0;
    this.pitch = 0;
    this.onGround = false;
    this.groundSpeed = 0;
    this.engineOn = true;
    this.mode = 'hold';
    this.t = 0;

    // Targets, for 'hold' and 'direct'.
    this.tHdg = 0;
    this.tAlt = 0;
    this.tSpd = 0;
    // Rates and limits: an airliner's, unless told otherwise.
    this.maxRate = 3; // deg/s, standard rate
    this.maxBank = 25;
    this.maxClimb = 7.6; // 1,500 ft/min
    this.maxDesc = 7.6;
    this.accel = 1;
    this.vMin = 60;
    this.vMax = 100;
    this.floorAGL = 300;
    this.floorOn = true;
    this.floorAhead = true;
    this._linedFloor = null;
    this.vsFF = 0;
    /** Below the floor at any point: for the tests, which prove it never is. */
    this.minClear = Infinity;

    // Follow.
    this.leader = null;
    this.station = { back: 160, right: 60, down: 15, lookahead: 600 };
    this.leaderDist = Infinity;

    // Land.
    this.rw = null;
    this.landPhase = '';
    this.entryDone = false;
    this.goArounds = 0;
    this.touchdownAt = new THREE.Vector3();
    this.touchdownV = 0;
    this.stoppedT = 0;
    /** Told when something worth saying happens: ('goaround'|'final'|'touchdown'|'stopped'). */
    this.onEvent = null;

    this._rock = 0;
    this._rockT = 0;
    this._gearWant = 0;
    this._flaps = 0;
    this._f = new THREE.Vector3();
    this._r = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._entry = new THREE.Vector3();
    this._gate = new THREE.Vector3();
    this._right = new THREE.Vector3();

    this.model = null;
    this.rideOffset = 0;
    try {
      this.model = createAircraftModel({ type: this.type, livery: livery || this.type.livery });
      this.model.name = `npc-${name}`;
      scene.add(this.model);
      if (this.model.userData.fleetBridge && this._spec) this.rideOffset = groundOffsetFor(this.model, this._spec);
    } catch (e) {
      console.warn('[roles] the NPC aircraft could not be built; it will be invisible.', e);
    }
    this._state = {
      controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brakes: 0 },
      rpm: 0.8,
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
      quat: this.quat,
    };
    this._animOk = true;
    this.gone = false;
  }

  /* ------------------------------------------------------------ setup -- */

  place({ pos, headingDeg = 0, speed = 75, onGround = false, gearDown = false }) {
    this.pos.copy(pos);
    this.heading = wrap(headingDeg);
    this.speed = speed;
    this.vs = 0;
    this.bank = 0;
    this.onGround = onGround;
    if (onGround) this.pos.y = heightAt(pos.x, pos.z) + this.ride;
    this.tHdg = this.heading;
    this.tAlt = this.pos.y;
    this.tSpd = speed;
    this.setGear(gearDown, true);
    this.pitch = onGround ? 0 : 2;
    this.sync(0);
    return this;
  }

  setMode(mode) {
    this.mode = mode;
    if (mode === 'land') {
      this.landPhase = this.onGround ? 'roll' : 'vector';
      this.entryDone = false;
    }
  }

  direct(hdg, alt, spd) {
    this.mode = 'direct';
    this.tHdg = wrap(hdg);
    this.tAlt = alt;
    this.tSpd = spd;
  }

  hold() {
    this.mode = 'hold';
    this.tHdg = this.heading;
    this.tAlt = this.pos.y;
    this.tSpd = this.speed;
  }

  /**
   * Fly behind and to the right of `leader` ({pos, vel, heading}).
   * The defaults put a 747 about 190 m behind and 60 m right of the jet.
   */
  follow(leader, station = null) {
    this.mode = 'follow';
    this.leader = leader;
    if (station) Object.assign(this.station, station);
  }

  /**
   * Land on a runway and stop at `stop`. `rw`: { thr, dir (unit, the way
   * it lands), hdg, td (the aiming point), stop }, all Vector3 but hdg.
   */
  land(rw) {
    this.rw = rw;
    this.setMode('land');
  }

  /** Rock the wings for a few seconds: "understood, will comply". */
  rock(seconds = 5) {
    this._rock = seconds;
    this._rockT = 0;
  }

  get rocking() {
    return this._rock > 0;
  }

  setGear(down, now = false) {
    this._gearWant = down ? 1 : 0;
    this._state.gearDown = !!down;
    if (now) this._state.gearPos = this._gearWant;
  }

  get gearDown() {
    return this._state.gearDown;
  }

  /** Forward, along the ground, as a unit vector. */
  forward(out = new THREE.Vector3()) {
    const h = this.heading * DEG;
    return out.set(Math.sin(h), 0, -Math.cos(h));
  }

  get agl() {
    return this.pos.y - this.ride - surface(this.pos.x, this.pos.z);
  }

  get stopped() {
    return this.onGround && this.speed < 0.3;
  }

  /* ------------------------------------------------------------ floor -- */

  /**
   * The lowest the middle of it may be now, so that it is `floorAGL` above
   * the ground here AND everywhere it will be over the next 45 s — counting
   * the climb it can make before it gets there (three-quarters of its best,
   * after six seconds to start). Looking only 25 s ahead, a jumbo led low
   * over the sea towards Kestrel's 218 m peaks saw them too late to climb
   * 300 m clear: measured, 173 m.
   */
  floorY() {
    const h = this.heading * DEG;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    let need = surface(this.pos.x, this.pos.z);
    for (const s of FLOOR_AHEAD) {
      const d = this.speed * s;
      const v = surface(this.pos.x + fx * d, this.pos.z + fz * d) - (s > 6 ? this.maxClimb * 0.75 * (s - 6) : 0);
      if (v > need) need = v;
    }
    return need + this.ride + this.floorAGL;
  }

  /* ----------------------------------------------------------- follow -- */

  _followTargets() {
    const L = this.leader;
    if (!L || !L.pos) {
      this.tHdg = this.heading;
      this.tAlt = this.pos.y;
      this.tSpd = this.speed;
      return;
    }
    const lh = (Number.isFinite(L.heading) ? L.heading : this.heading) * DEG;
    const fx = Math.sin(lh);
    const fz = -Math.cos(lh);
    const st = this.station;
    // The station: behind the leader, to its right, a little below.
    const sx = L.pos.x - fx * st.back - fz * st.right;
    const sz = L.pos.z - fz * st.back + fx * st.right;
    const lx = L.pos.x - this.pos.x;
    const lz = L.pos.z - this.pos.z;
    const d = Math.hypot(lx, lz);
    this.leaderDist = d;
    let lsp = this.speed;
    if (L.vel) lsp = Math.hypot(L.vel.x, L.vel.z);
    if (d > 4000) {
      // Lost sight of the station: head for the leader himself.
      this.tHdg = bearingTo(this.pos.x, this.pos.z, L.pos.x, L.pos.z);
      this.tSpd = this.vMax - 5;
      this.tAlt = L.pos.y - st.down;
      return;
    }
    // Aim at a point a little ahead of the station, along the leader's track:
    // a pure pursuit of a moving point settles on it rather than circling it.
    this.tHdg = bearingTo(this.pos.x, this.pos.z, sx + fx * st.lookahead, sz + fz * st.lookahead);
    const h = this.heading * DEG;
    const along = (sx - this.pos.x) * Math.sin(h) + (sz - this.pos.z) * -Math.cos(h);
    this.tSpd = clamp(lsp + clamp(along * 0.06, -12, 12), this.vMin + 2, this.vMax - 5);
    // Never fly into the leader: close and he is still ahead of us, back right off.
    const ahead = lx * Math.sin(h) + lz * -Math.cos(h);
    if (d < 90 && ahead > -20) this.tSpd = this.vMin + 2;
    this.tAlt = L.pos.y - st.down;
  }

  /* ------------------------------------------------------------- land -- */

  _landTargets(dt) {
    const R = this.rw;
    const p = this.pos;
    const dx = R.dir.x;
    const dz = R.dir.z;
    // Along the runway from the threshold (negative before it), and across it (+ to the right).
    const along = (p.x - R.thr.x) * dx + (p.z - R.thr.z) * dz;
    const cross = (p.x - R.thr.x) * -dz + (p.z - R.thr.z) * dx;
    const alongTd = (p.x - R.td.x) * dx + (p.z - R.td.z) * dz;
    const hdgOff = Math.abs(adiff(this.heading, R.hdg));
    const ground = surface(p.x, p.z);
    const wheels = p.y - this.ride - ground;
    // Above the runway's own height, not the ground under it: there is a
    // ridge 500 m short of Kestrel's 09, and the flare is for the runway.
    const wheelsRw = p.y - this.ride - R.td.y;
    const slopeY = R.td.y + this.ride + Math.max(0, -alongTd) * TAN3;
    this.slopeY = slopeY;

    if (this.landPhase === 'vector') {
      this.floorAGL = 300;
      this.floorAhead = true;
      const high = p.y - slopeY;
      const far = along < -2600;
      // Stable: on the centre line, pointing down it, on the slope. Further
      // out there is room to settle; close in it has to be nearly exact.
      const stable = along > -11500 && along < -800
        && Math.abs(cross) < (far ? 650 : 150) && hdgOff < (far ? 35 : 12)
        && high < (far ? 150 : 50) && high > -120;
      if (stable) {
        this.landPhase = 'final';
        if (this.onEvent) this.onEvent('final');
      } else {
        const side = cross >= 0 ? 1 : -1;
        this._entry.set(R.thr.x - dx * 9500 + -dz * side * 1800, 0, R.thr.z - dz * 9500 + dx * side * 1800);
        this._gate.set(R.thr.x - dx * 7000, 0, R.thr.z - dz * 7000);
        const gateY = Math.max(R.thr.y + this.ride + 380, surface(this._gate.x, this._gate.z) + this.ride + 300);
        // Already on the extended centre line, a long way out: straight to the gate.
        if (along < -7500 && Math.abs(cross) < 1500 && hdgOff < 60) this.entryDone = true;
        if (!this.entryDone && Math.hypot(p.x - this._entry.x, p.z - this._entry.z) < 1300) this.entryDone = true;
        // Inside the gate and still not stable (or past the runway): back out
        // to the entry point and come round again.
        if (this.entryDone && along > -2000) this.entryDone = false;
        const tgt = this.entryDone ? this._gate : this._entry;
        const toT = Math.hypot(p.x - tgt.x, p.z - tgt.z);
        const rest = this.entryDone ? 0 : Math.hypot(this._entry.x - this._gate.x, this._entry.z - this._gate.z);
        if (this.entryDone && (toT < 2200 || along > -7600)) {
          // Turning in: a localiser in miniature.
          this.tHdg = wrap(R.hdg - clamp(cross * 0.035, -35, 35));
        } else {
          this.tHdg = bearingTo(p.x, p.z, tgt.x, tgt.z);
        }
        // Down the three-degree profile to the gate, never climbing for it.
        this.tAlt = Math.min(this.vecAlt ?? p.y, gateY + (toT + rest) * TAN3);
        this.tSpd = 72;
      }
      this.vsFF = 0;
    }
    if (this.landPhase === 'final') {
      this.floorAGL = 3;
      this.floorAhead = false;
      this.tHdg = wrap(R.hdg - clamp(cross * 0.05, -25, 25));
      this.tAlt = slopeY;
      this.vsFF = -this.speed * TAN3;
      this.tSpd = alongTd < -2600 ? 68 : 64;
      if (alongTd > -9000 && !this.gearDown) this.setGear(true);
      if (alongTd > -6000) this._flaps = 2;
      const off = Math.abs(cross) > 260 && alongTd > -3000;
      const tooHigh = p.y - slopeY > 110 && alongTd > -2400;
      if (off || tooHigh) {
        // Not stable: round again, the way a real crew would.
        this.landPhase = 'vector';
        this.entryDone = false;
        this.vecAlt = Math.max(p.y + 150, R.thr.y + this.ride + 450);
        this.goArounds++;
        if (this.onEvent) this.onEvent('goaround');
      } else if (wheelsRw < 11 && alongTd > -400) {
        this.landPhase = 'flare';
      }
    }
    if (this.landPhase === 'flare') {
      this.floorAGL = 0;
      this.floorAhead = false;
      this.tHdg = wrap(R.hdg - clamp(cross * 0.08, -6, 6));
      this.tSpd = 61;
      if (wheels <= 0.05) {
        this.onGround = true;
        this.vs = 0;
        this.pos.y = ground + this.ride;
        this.landPhase = 'roll';
        this.touchdownAt.copy(this.pos);
        this.touchdownV = this.speed;
        if (this.onEvent) this.onEvent('touchdown');
      }
    }
    return { along, cross, alongTd, wheels, ground };
  }

  /* ----------------------------------------------------------- update -- */

  update(dt, weather = null) {
    if (this.gone || !(dt > 0)) return;
    this.t += dt;
    if (this._rock > 0) {
      this._rock -= dt;
      this._rockT += dt;
    }
    if (this.onGround) {
      this._roll(dt);
    } else {
      if (this.mode === 'follow') {
        this.floorAGL = 300;
        this.floorAhead = true;
        this._followTargets();
        this.vsFF = 0;
        // Lined up on a final it can land from, the floor is the slope less a margin.
        if (this.rw) {
          const R = this.rw;
          const along = (this.pos.x - R.thr.x) * R.dir.x + (this.pos.z - R.thr.z) * R.dir.z;
          const cross = (this.pos.x - R.thr.x) * -R.dir.z + (this.pos.z - R.thr.z) * R.dir.x;
          if (along > -9000 && along < -1200 && Math.abs(cross) < 500 && Math.abs(adiff(this.heading, R.hdg)) < 25) {
            const alongTd = (this.pos.x - R.td.x) * R.dir.x + (this.pos.z - R.td.z) * R.dir.z;
            this.floorAGL = 0;
            this._linedFloor = R.td.y + this.ride + Math.max(0, -alongTd) * TAN3 - 60;
          } else {
            this._linedFloor = null;
          }
        }
      } else if (this.mode === 'land' && this.rw) {
        this._linedFloor = null;
        this._landTargets(dt);
      } else {
        this.floorAGL = 300;
        this.floorAhead = true;
        this._linedFloor = null;
        this.vsFF = 0;
      }
      this._fly(dt);
    }
    this.sync(dt, weather);
  }

  _fly(dt) {
    // Speed.
    const tSpd = clamp(this.tSpd, this.landPhase === 'flare' ? 55 : this.vMin, this.vMax);
    this.speed += clamp(tSpd - this.speed, -this.accel * dt, this.accel * dt);
    // Heading, through the bank: the bank is what turns it.
    const err = adiff(this.heading, this.tHdg);
    const rateWant = clamp(err * 0.4, -this.maxRate, this.maxRate);
    const v = Math.max(30, this.speed);
    const bankWant = clamp(Math.atan((v * rateWant * DEG) / G) / DEG, -this.maxBank, this.maxBank);
    this.bank += clamp(bankWant - this.bank, -8 * dt, 8 * dt);
    const rate = (G * Math.tan(this.bank * DEG)) / v / DEG;
    this.heading = wrap(this.heading + rate * dt);
    // Height. The floor looks 25 s ahead everywhere but on a lined-up final,
    // where looking ahead would see the ground past the far end of the runway.
    let floor = -Infinity;
    if (this.floorOn) {
      const here = surface(this.pos.x, this.pos.z) + this.ride;
      if (this._linedFloor != null) floor = Math.max(this._linedFloor, here + 25);
      else if (this.floorAhead) floor = this.floorY();
      else floor = here + this.floorAGL;
    }
    const want = Math.max(this.tAlt, floor);
    let vsWant = clamp((want - this.pos.y) * 0.12 + (this.vsFF || 0), -this.maxDesc, this.maxClimb);
    if (this.landPhase === 'flare' && this.mode === 'land') {
      const wheels = this.pos.y - this.ride - surface(this.pos.x, this.pos.z);
      vsWant = -Math.max(0.45, wheels * 0.22);
    }
    if (this.pos.y < floor) vsWant = Math.max(vsWant, Math.min(this.maxClimb * 1.5, (floor - this.pos.y) * 0.4 + 1));
    this.vs += clamp(vsWant - this.vs, -1.6 * dt, 1.6 * dt);
    const h = this.heading * DEG;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;
    this.pos.y += this.vs * dt;
    // The only hard rule: the wheels never go into anything.
    const minY = surface(this.pos.x, this.pos.z) + this.ride;
    const clear = this.pos.y - minY;
    if (clear < this.minClear && !(this.mode === 'land' && this.landPhase === 'flare')) this.minClear = clear;
    if (this.pos.y < minY) {
      this.pos.y = minY;
      if (this.vs < 0) this.vs = 0;
    }
    this.vel.set(fx * this.speed, this.vs, fz * this.speed);
    this.groundSpeed = this.speed;
    // Attitude: the flight path plus a few degrees of wing, more in the flare.
    const aoa = this.landPhase === 'flare' ? 5.5 : this._gearWant ? 3.5 : 2;
    const pWant = Math.atan2(this.vs, Math.max(30, this.speed)) / DEG + aoa;
    this.pitch += clamp(pWant - this.pitch, -4 * dt, 4 * dt);
  }

  /** On the ground: the roll-out to the stopping point, then stood still. */
  _roll(dt) {
    const R = this.rw;
    this.bank += clamp(-this.bank, -10 * dt, 10 * dt);
    if (R && this.speed > 0) {
      const p = this.pos;
      const cross = (p.x - R.thr.x) * -R.dir.z + (p.z - R.thr.z) * R.dir.x;
      const left = (R.stop.x - p.x) * R.dir.x + (R.stop.z - p.z) * R.dir.z;
      // Brakes and reversers, as hard as it takes to stop at the stopping point.
      const a = clamp((this.speed * this.speed) / (2 * Math.max(15, left)), 1.0, 4.5);
      this.speed = Math.max(0, this.speed - a * dt);
      if (this.speed < 0.3 || left < -40) this.speed = 0;
      this.heading = wrap(R.hdg - clamp(cross * 0.6, -4, 4));
    } else {
      this.speed = Math.max(0, this.speed - 2 * dt);
    }
    const h = this.heading * DEG;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    this.pos.x += fx * this.speed * dt;
    this.pos.z += fz * this.speed * dt;
    this.pos.y = heightAt(this.pos.x, this.pos.z) + this.ride;
    this.vs = 0;
    this.vel.set(fx * this.speed, 0, fz * this.speed);
    this.groundSpeed = this.speed;
    // Nose wheel down a couple of seconds after the mains.
    this.pitch += clamp(0 - this.pitch, -2.5 * dt, 2.5 * dt);
    if (this.speed === 0) {
      if (this.landPhase !== 'stopped') {
        this.landPhase = 'stopped';
        this.stoppedT = 0;
        if (this.onEvent) this.onEvent('stopped');
      }
      this.stoppedT += dt;
      if (this.stoppedT > 4) this.engineOn = false;
    }
  }

  /** Put the picture where the aeroplane is, and animate it. */
  sync(dt = 0, weather = null) {
    let rockRoll = 0;
    if (this._rock > 0) rockRoll = Math.sin(this._rockT * 3.4) * 0.38 * Math.min(1, this._rockT * 1.5, this._rock * 1.5);
    EUL.set(this.pitch * DEG, -this.heading * DEG, -this.bank * DEG + rockRoll, 'YXZ');
    this.quat.setFromEuler(EUL);
    if (!this.model) return;
    this.model.position.copy(this.pos);
    this.model.position.y += this.rideOffset;
    this.model.quaternion.copy(this.quat);
    if (!this._animOk || !this.model.userData.update) return;
    const s = this._state;
    const gw = this._gearWant;
    if (s.gearPos !== gw) s.gearPos = gw > s.gearPos ? Math.min(gw, s.gearPos + dt / 6) : Math.max(gw, s.gearPos - dt / 6);
    s.flaps = this._flaps;
    s.onGround = this.onGround;
    s.groundSpeed = this.groundSpeed;
    s.engineOn = this.engineOn;
    s.rpm = this.engineOn ? (this.onGround && this.speed > 5 ? 0.9 : 0.65) : Math.max(0, s.rpm - dt * 0.2);
    s.controls.throttle = this.engineOn ? 0.55 : 0;
    s.controls.roll = clamp(rockRoll * 2, -1, 1);
    s.alt = this.pos.y;
    s.agl = this.agl;
    s.airspeed = s.ias = this.speed;
    try {
      this.model.userData.update(dt, s, weather || { isNight: false, cond: { cloud: 0 } });
    } catch (e) {
      this._animOk = false;
      console.warn('[roles] NPC model animation failed; showing it still.', e);
    }
  }

  dispose() {
    if (this.gone) return;
    this.gone = true;
    if (!this.model) return;
    this.scene.remove(this.model);
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
    this.model = null;
  }
}

export { TAN3 };

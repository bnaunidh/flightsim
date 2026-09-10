/**
 * Autopilot.
 *
 * Holds the wings level, holds the height it was engaged at, and — if the game
 * has given you somewhere to go — turns towards it. It works by moving the
 * controls, exactly as the beginner assists do, so it can never do anything
 * you could not do yourself and it behaves sensibly at any airspeed.
 *
 * Two rules keep it out of the way:
 *   1. Touching the stick hands control straight back to you.
 *   2. It refuses to fly you into the ground: below a safe height it climbs.
 *
 * It deliberately does not land the aeroplane. Landing is the game.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp } from '../core/noise.js';
import { AIRPORT } from '../world/terrain.js';

/**
 * What you can ask it to do. "Hold" is what it always did; the other two are
 * the jobs people actually want an autopilot for — get me back, and get me
 * lined up — and both hand control back before the interesting part.
 */
export const AP_MODES = [
  { id: 'hold', label: 'Hold heading and height', hint: 'Wings level on the heading and height you engaged at' },
  {
    id: 'level',
    label: 'Climb or descend to a height',
    hint: 'Sets off for the height on the slider and levels off there',
    usesAlt: true,
  },
  { id: 'field', label: 'Return to the airfield', hint: 'Flies overhead the field at 2,000 ft and holds' },
  { id: 'approach', label: 'Line up with the runway', hint: 'Intercepts the centreline and flies the glidepath down to 500 ft' },
];

const DEG = Math.PI / 180;
/** Where runway 09 begins, and the course you fly to reach it. */
const THRESHOLD = new THREE.Vector3(
  AIRPORT.runway.cx - AIRPORT.runway.length / 2,
  AIRPORT.elev,
  AIRPORT.runway.cz
);

const M_TO_FT = 3.28084;
/** Below this height above ground the autopilot climbs instead of holding. */
const SAFE_AGL_FT = 500;
/** How far the player has to move a control before it counts as taking over. */
const TAKEOVER = 0.14;

const _fwd = new THREE.Vector3();
const _to = new THREE.Vector3();

export class Autopilot {
  constructor() {
    this.engaged = false;
    this.targetAltFt = 1500;
    /**
     * The height on the slider. Kept apart from `targetAltFt` on purpose:
     * engaging in "hold" captures whatever height you are at, which would
     * throw away a number you had deliberately dialled in. Level change reads
     * this one instead, so setting 8,000 ft and then engaging does what it
     * says rather than levelling off where you already were.
     */
    this.selectedAltFt = 2000;
    /** Set once a level change has arrived, so the label can stop nagging. */
    this.levelOff = false;
    this.targetSpeedKts = 95;
    this.holdHeadingDeg = null;
    this.mode = 'hold';
    this._iAlt = 0;
    this._iSpd = 0;
    /** Set when a mode has finished its job and given the aeroplane back. */
    this.handedBack = null;
  }

  setMode(id) {
    this.mode = AP_MODES.some((m) => m.id === id) ? id : 'hold';
    this.handedBack = null;
    if (this.mode === 'level') {
      this.targetAltFt = this.selectedAltFt;
      this.levelOff = false;
    }
    return this.mode;
  }

  /** Dial in a height. Takes effect immediately if it is flying a level change. */
  setSelectedAlt(ft) {
    this.selectedAltFt = clamp(Math.round(ft), 500, 12000);
    if (this.mode === 'level') {
      this.targetAltFt = this.selectedAltFt;
      this.levelOff = false;
    } else if (this.mode === 'hold') {
      // In plain hold the slider is still the height it holds, as before.
      this.targetAltFt = this.selectedAltFt;
    }
    return this.selectedAltFt;
  }

  /**
   * Where this mode wants to go, and how high, worked out fresh each frame.
   * Returns null to mean "just hold what you were given".
   */
  planFor(ac) {
    if (this.mode === 'level') {
      // No target: hold the heading you handed over on and put all the effort
      // into the height. `target: null` means "keep flying the way you are
      // pointing", which is what a level change does — it is a vertical
      // instruction, not a navigational one.
      const r = ac.readouts();
      if (!this.levelOff && Math.abs(r.altFt - this.selectedAltFt) < 60 && Math.abs(r.vsFpm) < 260) {
        this.levelOff = true;
      }
      return { target: null, altFt: this.selectedAltFt, brisk: true };
    }
    if (this.mode === 'field') {
      // Overhead the field at 2,000 ft, which is where you would join.
      return {
        target: new THREE.Vector3(AIRPORT.runway.cx, AIRPORT.elev, AIRPORT.runway.cz),
        altFt: (AIRPORT.elev + 610) * 3.28084,
      };
    }
    if (this.mode === 'approach') {
      // How far west of the threshold we are. Runway 09 is flown eastbound, so
      // the approach lies along -X from the threshold.
      const out = THRESHOLD.x - ac.pos.x;
      // A platform altitude, then the slope — which is how an approach is
      // actually flown, and it fixes the real problem: aiming straight at the
      // threshold from a long way out means flying level until the glidepath
      // comes up to meet you, and by then there is no room left to descend.
      // Levelling at 1,500 ft first gets the height off early.
      const PLATFORM_M = 460;
      // Only descend on the slope once actually pointing down the approach.
      // Coming at the field from the east it would start following the
      // glidepath while still turning through 180 degrees, and fly itself into
      // the ground a mile short with the runway behind it.
      const hdg = (Math.atan2(ac.vel.x, -ac.vel.z) * 180) / Math.PI;
      const offCourse = Math.abs(((hdg - AIRPORT.headingDeg + 540) % 360) - 180);
      const inbound = offCourse < 50 && Math.abs(ac.pos.z - AIRPORT.runway.cz) < 2200;
      const wantM = inbound
        ? AIRPORT.elev + Math.min(Math.max(0, out) * Math.tan(3 * DEG), PLATFORM_M)
        : AIRPORT.elev + PLATFORM_M;
      const highBy = ac.pos.y - wantM;
      // Remembered so the descent limit can be relaxed while it is catching up.
      this._highBy = highBy;
      if (out < 400) {
        // Either we have flown the approach and arrived, or we started behind
        // the field and have no approach to fly yet.
        if (ac.agl < 210 && Math.abs(ac.pos.z - AIRPORT.runway.cz) < 150) {
          this.handedBack =
            highBy > 120
              ? `Runway ahead, but you are ${Math.round(highBy)} m high — go around or lose it fast`
              : 'Established on the approach — landing is yours';
          return null;
        }
        // High, or past the runway, or coming at it from the wrong side. Go
        // round: position nine kilometres west at circuit height and start
        // again, which is what you would do rather than dive at it.
        return {
          target: new THREE.Vector3(THRESHOLD.x - 9000, AIRPORT.elev, AIRPORT.runway.cz),
          altFt: (AIRPORT.elev + 460) * 3.28084,
          repositioning: true,
        };
      }
      // Decision height: down the slope, lined up, runway in front of you.
      if (ac.agl < 62 && Math.abs(ac.pos.z - AIRPORT.runway.cz) < 120) {
        this.handedBack = 'Runway ahead — landing is yours';
        return null;
      }
      // Or established early: on the slope and on the centreline.
      if (out < 2600 && Math.abs(highBy) < 45 && Math.abs(ac.pos.z - AIRPORT.runway.cz) < 120) {
        this.handedBack = 'Established on the approach — landing is yours';
        return null;
      }
      // Aim at a point further down the centreline, which makes it intercept
      // and then track rather than chase the threshold from an angle.
      const ahead = Math.min(THRESHOLD.x, ac.pos.x + 1500);
      // Feed the glidepath's own rate of descent forward.
      //
      // Holding altitude with a proportional controller cannot track a target
      // that is itself descending — it settles at whatever error produces the
      // right rate, and that error was a steady 115 m above the slope the
      // whole way down. Telling it up front how fast the slope falls removes
      // the lag entirely; the proportional part then only has to correct what
      // is left.
      const onSlope = inbound && Math.max(0, out) * Math.tan(3 * DEG) < PLATFORM_M;
      const slopeFpm = onSlope ? -ac.groundSpeed * Math.tan(3 * DEG) * 196.85 : 0;
      return {
        target: new THREE.Vector3(ahead, AIRPORT.elev, AIRPORT.runway.cz),
        altFt: wantM * 3.28084,
        feedForwardFpm: slopeFpm,
      };
    }
    return null;
  }

  /** @returns {boolean} whether it is now engaged */
  setEngaged(on, ac) {
    if (on && !this.engaged) {
      // Capture the current state so it does not lurch on engagement.
      const r = ac.readouts();
      // Hold the height you were at — but if you hand over low, climb to a
      // sensible 1,000 ft above the ground first. Nobody engages an autopilot
      // hoping to be left skimming the trees.
      const groundFt = r.altFt - r.aglFt;
      this._lastAltFt = r.altFt;
      this.targetAltFt =
        this.mode === 'level'
          ? // A level change was given a height on purpose. Capturing the
            // current one here would quietly cancel the instruction.
            this.selectedAltFt
          : clamp(Math.max(Math.round(r.altFt / 50) * 50, groundFt + 1000), 400, 12000);
      if (this.mode === 'level') this.levelOff = false;
      this.targetSpeedKts = clamp(Math.round(r.iasKts / 5) * 5, 70, 120);
      this.holdHeadingDeg = r.heading;
      this._iAlt = 0;
      this._iSpd = 0;
    }
    this.engaged = on;
    return this.engaged;
  }

  /** True if the player has moved a control enough to want it back. */
  playerTookOver(input) {
    return (
      Math.abs(input.pitch) > TAKEOVER ||
      Math.abs(input.roll) > TAKEOVER ||
      Math.abs(input.yaw) > TAKEOVER
    );
  }

  /**
   * Produce control positions. Call only when engaged.
   *
   * @param {object} ac the aeroplane
   * @param {THREE.Vector3|null} target where to steer, or null to hold heading
   * @returns {{pitch:number, roll:number, yaw:number, throttle:number}}
   */
  update(dt, ac, target) {
    const r = ac.readouts();
    // Remembered so the status line can say whether it is on its way up or
    // down without the caller having to tell it.
    this._lastAltFt = r.altFt;

    // A mode's own plan takes precedence over whatever the game handed in.
    const plan = this.planFor(ac);
    if (plan) {
      // A plan with no target of its own leaves the steering alone rather than
      // cancelling it — that is how a level change keeps flying straight ahead
      // instead of snapping back to whatever the game last pointed it at.
      if (plan.target) target = plan.target;
      else if (plan.target === null) target = null;
      this.targetAltFt = plan.altFt;
      this._repositioning = !!plan.repositioning;
      this._ffFpm = plan.feedForwardFpm || 0;
      this._brisk = !!plan.brisk;
    }

    /* ---- Where do we want to be pointing? ---- */
    let wantHeading = this.holdHeadingDeg;
    if (target) {
      _to.subVectors(target, ac.pos);
      // Heading is measured clockwise from north, and -Z is north.
      wantHeading = (Math.atan2(_to.x, -_to.z) * 180) / Math.PI;
      if (wantHeading < 0) wantHeading += 360;
    }
    let hdgErr = ((wantHeading - r.heading + 540) % 360) - 180;

    /* ---- Roll: turn towards the target, never steeply ---- */
    // A 25 degree bank is a comfortable rate-one turn in this aeroplane.
    const wantBankDeg = clamp(hdgErr * 0.8, -25, 25);
    const bankNowDeg = (ac.bankAngleRad() * 180) / Math.PI;
    const roll = clamp((wantBankDeg - bankNowDeg) * 0.055 - ac.omega.z * 0.55, -0.7, 0.7);

    /* ---- Pitch: hold height, but never fly into the ground ---- */
    let wantAlt = this.targetAltFt;
    // The floor that stops it flying you into the ground. It is 500 ft
    // normally — but on an approach that floor *is* the problem: every
    // approach stopped dead at 500 ft above the ground and handed over a
    // quarter of a mile from the runway and 460 ft high, which looked like a
    // descent-rate problem and was nothing of the sort. Lining up to land is
    // the one time you are supposed to go below it, so it becomes a decision
    // height instead.
    const floorFt = this.mode === 'approach' ? 185 : SAFE_AGL_FT;
    if (r.aglFt < floorFt) wantAlt = Math.max(wantAlt, r.altFt + (floorFt - r.aglFt));
    const altErrFt = wantAlt - r.altFt;
    // Aim for a vertical speed proportional to the error, capped so it is
    // always a gentle ride.
    // Normally a gentle ride. On an approach it is allowed to come down
    // properly: capped at 700 fpm it could not lose the height it needed
    // before reaching the runway, and handed you back a thousand feet high
    // and two miles out, which is not "lined up" in any useful sense.
    // A comfortable 700 fpm normally. On an approach it may come down at
    // 1,150 — and if it is well above the glidepath, properly, because at the
    // gentle rate it simply arrived at the runway a thousand feet high and
    // apologised. A real descent to intercept looks like this.
    // A level change is a deliberate instruction, so it may use a proper climb
    // and descent rate rather than the polite one — being told to go to 8,000
    // ft and getting there at 700 fpm is a five-minute wait.
    const downLimit =
      this.mode === 'approach'
        ? (this._highBy || 0) > 200
          ? -2000
          : -1150
        : this._brisk
          ? -1200
          : -700;
    const upLimit = this._brisk ? 1200 : 800;
    const wantVsFpm = clamp(altErrFt * 1.6 + (this._ffFpm || 0), downLimit, upLimit);
    const vsErr = (wantVsFpm - r.vsFpm) / 1000;
    this._iAlt = clamp(this._iAlt + vsErr * dt * 0.35, -0.35, 0.35);
    // Steeper banks need back pressure or the nose drops through the turn.
    const bankLoad = Math.abs(bankNowDeg) / 25;
    let pitch = clamp(vsErr * 1.35 + this._iAlt - ac.omega.x * 0.5 + bankLoad * 0.06, -0.75, 0.85);

    // Stall guard: whatever else is going on, do not pull into a stall.
    if (r.iasKts < 58) pitch = Math.min(pitch, 0.05);

    /* ---- Throttle: hold the speed ---- */
    const spdErr = (this.targetSpeedKts - r.iasKts) / 40;
    this._iSpd = clamp(this._iSpd + spdErr * dt * 0.25, -0.35, 0.45);
    // Climbing costs power, descending gives it back.
    const climbBias = clamp(wantVsFpm / 900, -0.25, 0.3);
    const throttle = clamp(0.6 + spdErr * 0.8 + this._iSpd + climbBias, 0.12, 1);

    /* ---- Yaw: keep the turn coordinated ---- */
    const yaw = clamp(ac.beta * 1.6, -0.5, 0.5);

    return { pitch, roll, yaw, throttle };
  }

  /** One-line description for the HUD. */
  status(target) {
    const alt = `${Math.round(this.targetAltFt).toLocaleString()} ft`;
    if (this.mode === 'level') {
      if (this.levelOff) return `AUTO · LEVEL ${alt}`;
      const up = this.targetAltFt > this._lastAltFt;
      return `AUTO · ${up ? 'CLIMBING' : 'DESCENDING'} TO ${alt}`;
    }
    if (this.mode === 'approach') return this._repositioning ? `AUTO · POSITIONING · ${alt}` : `AUTO · APPROACH · ${alt}`;
    if (this.mode === 'field') return `AUTO · TO FIELD · ${alt}`;
    return target ? `AUTO · ${alt} · to target` : `AUTO · ${alt}`;
  }
}

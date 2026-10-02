/**
 * The driving HUD — Island Courier.
 *
 * A mode on top of the existing HUD, not a second HUD. Everything an aeroplane
 * needs is still built and still works; this borrows the panels that are on
 * screen anyway, hides the instruments a van does not have, and adds the three
 * things a courier does have: what is under the wheels, how long is left, and
 * what state the load is in.
 *
 * WHY IT IS A SEPARATE FILE AND EDITS NOTHING IN hud.js
 * Hud.build() is one 400-line method that four other people are working in this
 * week. Every node this module needs is already public on the Hud instance —
 * speedValue, altValue, hdgValue, objective, objectiveClock, throttleBar, the
 * chips — so the drive mode reaches for those and adds three small elements of
 * its own. Nothing in hud.js changes. That also means a merge cannot
 * half-apply this: either the file is imported and driving has a HUD, or it is
 * not and driving looks exactly as it does today.
 *
 * WHAT IT REPLACES, AND WHY
 * hud.setVehicle() (hud.js:695) put the distance travelled where the altimeter
 * was. Distance travelled is a fact nobody acts on — you cannot steer with it,
 * you cannot lose with it. In its place is the distance still to run, which is
 * the number you actually want when a clock is going down, and it falls back to
 * the trip distance when there is no job on. setVehicle is left in place for
 * anything still calling it; once main.js goes through this module it is dead
 * code and can be deleted by whoever owns hud.js.
 *
 * THE THREE NUMBERS
 *   speed          big, km/h, with the surface named underneath it. The surface
 *                  word is why you just slid, and it is one text node.
 *   the clock       top centre, counting down, amber then red, ticking in the
 *                  last five seconds. It reuses the mission clock element, so
 *                  the game has one clock rather than two that disagree.
 *   cargo condition five pips beside the clock. One goes out per knock. This is
 *                  the only instrument here that is genuinely new.
 *
 * And the one instruction: a next-turn chevron, bottom centre, big. A
 * ten-year-old cannot read a minimap and steer at the same time. They can read
 * one arrow.
 *
 * Every write is guarded against its own last value. The HUD is repainted sixty
 * times a second and writing the same string into the same node sixty times a
 * second is how a panel like this ends up costing more than the island behind
 * it. That is the rule the rest of hud.js already follows.
 */

/**
 * The van's own few rules, injected once. styles/main.css is shared by every
 * game and is not this file's to edit; these only ever match nodes this
 * module creates.
 */
function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('hud-drive-car-style')) return;
  const st = document.createElement('style');
  st.id = 'hud-drive-car-style';
  st.textContent = `
.hud-drive-gear { display: none; align-items: center; gap: 6px; margin-bottom: 8px; }
.hud.is-drive-car .hud-drive-gear { display: flex; }
.hud-drive-gear b {
  width: 26px; height: 26px; display: grid; place-items: center; border-radius: 7px;
  font-size: 15px; font-weight: 700; color: rgba(255,255,255,0.32); background: rgba(255,255,255,0.07);
}
.hud-drive-gear b.is-on { color: #0c1420; background: var(--accent, #5ec8ff); }
.hud-drive-gear b.is-on[data-g="R"] { background: var(--amber, #ffc247); }
.hud-drive-gear span { margin-left: 6px; font-size: 12px; color: var(--text-dim, #a9b4c4); }
.hud-drive-gear span.is-hand { color: var(--amber, #ffc247); font-weight: 700; }
.hud-chevron-arrow { transform-origin: 50% 55%; transition: transform 0.12s linear; }
.hud-chevron.is-slow { border-color: rgba(255, 194, 71, 0.8); background: rgba(70, 48, 8, 0.78); }
.hud-chevron.is-slow .hud-chevron-what { color: var(--amber, #ffc247); }
.hud-chevron.is-brake, .hud-chevron[data-dir="blocked"] { border-color: rgba(255, 107, 91, 0.85); background: rgba(80, 20, 16, 0.8); }
.hud-chevron.is-brake .hud-chevron-what, .hud-chevron[data-dir="blocked"] .hud-chevron-what,
.hud-chevron[data-dir="blocked"] .hud-chevron-arrow { color: #ff8a7a; }
.hud.is-drive .hud-word[data-surface="dirt"] { color: #d8bf98; }
.hud.is-drive .hud-word[data-surface="field"] { color: #e6d58f; }
`;
  document.head.appendChild(st);
}

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

/**
 * Surfaces, in the words used on screen.
 *
 * The grip numbers live with the physics, not here — this is only the label and
 * the colour, so that a change to how slippery gravel is does not need a change
 * to the HUD. The order is best grip to worst, which is also the order the
 * colours run from calm to hot.
 */
export const SURFACE_WORDS = {
  tarmac: 'tarmac',
  road: 'tarmac',
  apron: 'tarmac',
  runway: 'tarmac',
  gravel: 'gravel',
  track: 'gravel',
  grass: 'grass',
  sand: 'sand',
  water: 'water',
};

/* ------------------------------------------------------------------ turns */

/**
 * Where the next turn is, walked off the route the delivery is following.
 *
 * The chevron is the single most important element on the driving screen and it
 * needs exactly one thing: the polyline the job is routed along. Give it the
 * road graph's route (an array of {x, z} in world metres), the car's position
 * and its heading, and it answers "left in 200 metres" — which is an
 * instruction a child can act on, unlike a blue line on a map they are not
 * looking at.
 *
 * It keeps its own index into the route and only searches a window around it,
 * so the cost does not grow with the length of the route. A fresh tracker, or
 * one whose car has been picked out of the sea and put back on the road
 * somewhere else, re-finds itself with `reset()`.
 */
export class RouteTracker {
  constructor(route = []) {
    this.setRoute(route);
  }

  setRoute(route) {
    this.route = Array.isArray(route) ? route : [];
    // Whoever gives the route says where the stop is (see nearTheDrop);
    // until they do, it is the route's own end.
    this.goalX = NaN;
    this.goalZ = NaN;
    this.reset();
  }

  reset() {
    this.i = 0;
    this.searchAll = true;
    this._steer = false;
    this.slow = false;
    this.brakeNow = false;
    this.slowKph = 0;
    this.slowIn = 0;
    this.slowWhat = '';
  }

  /**
   * @param {{x:number,z:number}} pos    where the car is
   * @param {number} headingDeg          where it is pointing, compass degrees
   * @param {number} [turnDeg]           how much swing in 60 m is a turn
   * @param {number} [lookaheadM]        how far ahead to look for one
   * @param {number} [speed]             m/s, for the SLOW call (see slowFor)
   * @param {number} [grip]              the tyres' grip today, 1 = dry tarmac
   * @returns {{dir:string,label:string,distanceM:number,angleDeg:number,remainingM:number,slow:boolean,brake:boolean}|null}
   */
  next(pos, headingDeg, turnDeg = 30, lookaheadM = 1600, speed = 0, grip = 1) {
    const r = this.route;
    if (!r || r.length < 2) {
      this.offM = null;
      this.slow = false;
      this.brakeNow = false;
      return null;
    }

    /*
     * Find the segment we are on. After the first frame this only looks a
     * handful of segments either side of where we were, because a car at 30 m/s
     * moves under three metres between frames and cannot have jumped halfway
     * round the island. The full sweep is kept for the first frame and for
     * after a recovery, where it really has.
     */
    const from = this.searchAll ? 0 : Math.max(0, this.i - 6);
    const to = this.searchAll ? r.length - 1 : Math.min(r.length - 1, this.i + 24);
    let best = from;
    let bestD = Infinity;
    let bestT = 0;
    for (let k = from; k < to; k++) {
      const ax = r[k].x, az = r[k].z;
      const bx = r[k + 1].x, bz = r[k + 1].z;
      const ex = bx - ax, ez = bz - az;
      const len2 = ex * ex + ez * ez || 1e-6;
      const t = Math.max(0, Math.min(1, ((pos.x - ax) * ex + (pos.z - az) * ez) / len2));
      const px = ax + ex * t, pz = az + ez * t;
      const d = (pos.x - px) * (pos.x - px) + (pos.z - pz) * (pos.z - pz);
      if (d < bestD) { bestD = d; best = k; bestT = t; }
    }
    this.i = best;
    this.searchAll = false;
    /** How far the van is from the route, for whoever re-plans it. */
    this.offM = Math.sqrt(bestD);

    // Distance from here to the far end of the segment we are on, then whole
    // segments after it. (segLen and segBearing are module functions, not
    // closures made per call: this runs every frame.)

    let walked = segLen(r, best) * (1 - bestT);
    let remaining = walked;
    for (let k = best + 1; k < r.length - 1; k++) remaining += segLen(r, k);

    /*
     * Which way to steer RIGHT NOW: the bearing to a point 35 m further along
     * the route, relative to the nose.
     *
     * The arrow used to be a fixed glyph per instruction — an upward arrow for
     * "straight on" whatever the van was doing — so a van parked facing the
     * wrong way was told STRAIGHT ON, and followed it. The arrow now turns to
     * point at the road ahead, which is the one instruction a child can follow
     * without reading anything; and if the road ahead is behind you, it says so.
     */
    let need = 35;
    let ak = best;
    let at = bestT;
    let aimX = r[r.length - 1].x;
    let aimZ = r[r.length - 1].z;
    while (ak < r.length - 1) {
      const len = segLen(r, ak);
      const rest = len * (1 - at);
      if (rest >= need) {
        const u = at + need / Math.max(len, 1e-6);
        aimX = r[ak].x + (r[ak + 1].x - r[ak].x) * u;
        aimZ = r[ak].z + (r[ak + 1].z - r[ak].z) * u;
        break;
      }
      /*
       * A corner the route goes round to miss a building (off the road, see
       * aroundObstacles in jobs.js) is aimed at until the van is on it, not
       * cut: 35 m on round a corner is a line across the building's own
       * corner, and a child steering at it drove into the wall.
       */
      if (r[ak + 1].round && 35 - need + rest > 4) {
        aimX = r[ak + 1].x;
        aimZ = r[ak + 1].z;
        break;
      }
      need -= rest;
      ak++;
      at = 0;
    }
    const aimBearing = (Math.atan2(aimX - pos.x, -(aimZ - pos.z)) * 180) / Math.PI;
    const pointDeg = ((aimBearing - headingDeg + 540) % 360) - 180;
    // Facing the wrong way along the road — the road where the van IS, not
    // the aim point, which on a hairpin can be behind you legitimately.
    const facing = ((segBearing(r, best) - headingDeg + 540) % 360) - 180;
    this.slowFor(best, bestT, speed, grip, facing);

    /*
     * ARRIVING only where stopping counts.
     *
     * It said ARRIVING, "drop it here", with 45 m of ROUTE left — and the
     * job only takes a stop within 34 m of the drop-off in a straight line
     * (jobs.js ARRIVE_R; 44-48 m on some steps, never less). The reviewer's
     * careful kid, never above 30 or 40 km/h, stopping the moment it said
     * ARRIVING and waiting, stalled 36.8-40.3 m out on First Run and the
     * Shuttle in four runs of six, under TO GO 0.0 km, for good. And past
     * the end of the route the distance left is nought wherever the van
     * is, so a van that coasted 37 m beyond the town on Night Call-out sat
     * under ARRIVING for 760 s with no way-back arrow at all.
     *
     * So near a drop-off the chevron is worked out from the drop-off itself
     * (goalX/goalZ and arriveR, which the courier guide sets from the job):
     * ARRIVING only inside the zone, and only if braking now still stops the
     * van in it; NEARLY THERE and how many metres more on the way in; BACK
     * UP, hold S, when it is behind the van and near — S brakes and then
     * reverses, so it is the one key whatever the van is doing. A split you
     * drive through, and free drive's places, are not stops (stopAtEnd).
     */
    const gx = this.goalX === this.goalX && this.goalX != null ? this.goalX : r[r.length - 1].x;
    const gz = this.goalZ === this.goalZ && this.goalZ != null ? this.goalZ : r[r.length - 1].z;
    const dGoal = Math.hypot(gx - pos.x, gz - pos.z);
    // Past the end of the route the route has nothing left; the drop-off
    // is still where it was.
    const toGo = Math.max(remaining, dGoal);
    if (this.stopAtEnd !== false) {
      /*
       * Going round something to get there: off the road, with a corner of
       * the way round still ahead (jobs.js: the guide's way back to the
       * road, round the houses). Then the drop-off behind the van is not
       * straight back — BACK UP reversed a van stopped 55 m out on the far
       * side of a house from First Run's yard into that house, and the kid
       * holding S sat against it for the rest of the minute.
       */
      let rounding = false;
      if (r[best].grass) for (let k = best + 1; k < r.length && !rounding; k++) rounding = !!r[k].round;
      const near = this.nearTheDrop(pos, headingDeg, speed, grip, gx, gz, dGoal, toGo, pointDeg, rounding);
      if (near) return near;
    } else if (toGo < 45) {
      return this.answer('arrive', 'ARRIVING', toGo, 0, toGo, pointDeg);
    }
    remaining = toGo;
    // Facing the wrong way along the road; or gone past the end of the
    // route with where it leads behind you (the route's last bit points the
    // way the van went, so "facing" alone said STEER RIGHT, 0 m, there).
    const pastEnd = best >= r.length - 2 && bestT > 0.999;
    /*
     * Off the road — on the leg the guide lays from the van across the
     * grass (jobs.js marks its points `grass`) — there is no road to be
     * facing the wrong way along, and TURN AROUND's arrow does not lean: a
     * van re-planned from where it stood pinned against a house was told
     * TURN AROUND with the arrow straight up, and the kid who steers by the
     * arrow drove off across the island (measured behind four Drover's Flat
     * houses). There the arrow leans the way to turn, and the words agree.
     */
    if (r[best].grass && Math.abs(pointDeg) > 90) {
      this._steer = true;
      return this.steerAnswer(pointDeg, toGo);
    }
    if ((Math.abs(facing) > 115 || pastEnd) && Math.abs(pointDeg) > 90) {
      return this.answer('uturn', 'TURN AROUND', 0, pointDeg, toGo, pointDeg);
    }

    /*
     * The next real turn.
     *
     * Consecutive segments were compared, and a turn was a change of 25
     * degrees between two of them. That was right for a route of two or three
     * straight lines and is wrong for a road: the roads are written every 16 m
     * and round their corners, so a bend made of several small swings was
     * invisible to it and the arrow said STRAIGHT ON all the way round. A turn
     * is now how far the road swings within any 60 m stretch of it, which is
     * what a driver means by one.
     */
    const WINDOW = 60;
    let dk = -bestT * segLen(r, best); // from here to the START of segment k
    let k0 = best;
    let d0 = dk; // ...and to the start of the window's tail, k0
    for (let k = best; k < r.length - 1 && dk < lookaheadM; k++) {
      const len = segLen(r, k);
      if (len < 0.5) { dk += len; continue; }
      // Move the window's tail up until it is no more than WINDOW behind k.
      while (k0 < k && dk - d0 > WINDOW) {
        d0 += segLen(r, k0);
        k0++;
      }
      const turn = ((segBearing(r, k) - segBearing(r, k0) + 540) % 360) - 180;
      if (Math.abs(turn) >= turnDeg) {
        const dist = Math.max(0, d0 + segLen(r, k0));
        const sharp = Math.abs(turn) > 115;
        const side = turn > 0 ? 'right' : 'left';
        const words = turn > 0 ? (sharp ? 'HAIRPIN RIGHT' : 'RIGHT') : sharp ? 'HAIRPIN LEFT' : 'LEFT';
        // Coming up, and the way the arrow already points: the turn is the
        // instruction. Otherwise the arrow is saying something more urgent.
        if (!this.steering(pointDeg, dist < 90 && Math.sign(turn) === Math.sign(pointDeg))) {
          return this.answer(side, words, dist, turn, remaining, pointDeg);
        }
        return this.steerAnswer(pointDeg, remaining);
      }
      dk += len;
    }

    // Nothing to do for a while. Say how far the straight runs, because "1.4 km
    // of nothing" is itself information: it is when you use the throttle.
    if (this.steering(pointDeg, false)) return this.steerAnswer(pointDeg, remaining);
    return this.answer('straight', 'STRAIGHT ON', Math.min(Math.max(dk, walked), remaining), 0, remaining, pointDeg);
  }

  /**
   * The last stretch to a stop, or null when the van is not on it yet.
   *
   * `inside`: where the van would come to a halt (under 4.2 m/s, which is
   * what the job calls stopped) if S went down now — a third of a second to
   * get a finger there, then 4 m/s² times today's grip, which is well under
   * what the brake does (7 m/s²) so the answer is never too hopeful — is
   * still 1.5 m inside the zone.
   *
   * @returns {object|null}
   */
  nearTheDrop(pos, headingDeg, speed, grip, gx, gz, dGoal, toGo, pointDeg, rounding = false) {
    const R = this.arriveR > 0 ? this.arriveR : ARRIVE_M;
    const goalDeg = ((((Math.atan2(gx - pos.x, -(gz - pos.z)) * 180) / Math.PI - headingDeg) + 540) % 360) - 180;
    const behind = Math.abs(goalDeg) > 110;
    if (dGoal <= R) {
      const v = Math.abs(speed || 0);
      const a = 4 * Math.max(0.3, grip || 1);
      const s = v * 0.35 + (v > STOPPED_V ? (v * v - STOPPED_V * STOPPED_V) / (2 * a) : 0);
      const dir = (((speed || 0) < 0 ? headingDeg + 180 : headingDeg) * Math.PI) / 180;
      const px = pos.x + Math.sin(dir) * s;
      const pz = pos.z - Math.cos(dir) * s;
      if (Math.hypot(px - gx, pz - gz) <= R - 1.5) {
        return this.answer('arrive', 'ARRIVING', 0, 0, toGo, goalDeg);
      }
      // Going too fast to stop in it: towards it, brake now; away from it,
      // it is behind you.
      if (!behind || (speed || 0) < 0) {
        const o = this.answer('arrive', 'ARRIVING', 0, 0, toGo, goalDeg);
        o.brake = true;
        return o;
      }
      return this.answer('back', 'BACK UP', 0, goalDeg, toGo, goalDeg);
    }
    // Just past it, behind the van: back up, not a U-turn in the road —
    // unless the way there goes round something (see next()).
    if (behind && dGoal <= R + 45 && !rounding) {
      return this.answer('back', 'BACK UP', dGoal - R, goalDeg, toGo, goalDeg);
    }
    // On the way in: how much further to where stopping counts.
    if (!behind && toGo < R + 60) {
      if (this.steering(pointDeg, false)) return this.steerAnswer(pointDeg, toGo);
      return this.answer('near', 'NEARLY THERE', dGoal - R, 0, toGo, pointDeg);
    }
    return null;
  }

  /*
   * STEER LEFT / STEER RIGHT: when the arrow is well off the nose, the words
   * say what the arrow says.
   *
   * "Words say what is coming; the arrow says what to do about it" was the
   * rule, and it read as two instructions at once. Measured on Drover's Flat
   * holding W with no steering: the van runs off where the road curves
   * gently left at 10-11 s, the arrow swings to -45° and the words go on
   * saying STRAIGHT ON 1190 m. A child reads the words. So past 35° the
   * words agree with the arrow, until it is back under 20° (the gap stops it
   * flickering on a wobbly line); a turn coming up within 90 m the way the
   * arrow already points keeps its own words, because they agree.
   */
  steering(pointDeg, turnAgrees) {
    const off = Math.abs(pointDeg);
    this._steer = turnAgrees ? false : this._steer ? off > 20 : off >= 35;
    return this._steer;
  }

  steerAnswer(pointDeg, remaining) {
    const left = pointDeg < 0;
    return this.answer(left ? 'left' : 'right', left ? 'STEER LEFT' : 'STEER RIGHT', 0, pointDeg, remaining, pointDeg, true);
  }

  /*
   * SLOW DOWN: is the van going faster than it can stop down to for the bends
   * (and the drop-off) coming up on this route?
   *
   * The reviewer drove every job as a ten-year-old does — W held the whole
   * way, steering by the arrow, stamping on S at ARRIVING — and the hard jobs
   * scored nothing: Coast Road 274 s for 0/100, Summit Relay 377 s for 0/100,
   * five "Off the road at speed" knocks each. Measured again at the start of
   * this repair, and it is always the same thing: the van arrives at a
   * junction or a hairpin at 90-112 km/h, the turn was called 4-24 m before it
   * ("LEFT 4 m" at 105 km/h, "HAIRPIN LEFT 20 m" at 112), nothing on the
   * screen said slow down, and at 105 km/h the tightest the van can turn on
   * dry tarmac is a 98 m circle. So the bend runs out onto the grass.
   *
   * This is the missing call. For every corner on the route ahead within
   * stopping range it works out how fast that bit of road can be taken — the
   * turn within 16 m either side of it, as a radius (so one kink in a road
   * written every 16 m is not a bend, and a junction corner is), at 0.65 of
   * the van's cornering grip — and how fast the van can be going HERE and
   * still get down to that by rolling off the accelerator alone (1.8 m/s²,
   * about the least the engine, the tyres and the air take off it at any
   * speed). Faster than that for any of them, and it is SLOW DOWN. Faster
   * than even a firm brake (5 m/s²) gets it down to in the room left, and it
   * is BRAKE. The drop-off counts as a bend taken at 25 km/h, so the van
   * comes in to it at a speed the brake finishes in a few metres.
   *
   * Only while the van is going along the route (within 50 degrees of it and
   * 14 m of it): a child driving somewhere else on purpose is not told to
   * slow down for a road they are not on. And it stays on until the van is
   * 1.5 m/s under the line, so it does not flicker on and off along a curve.
   *
   * The first version of this (never shown on screen) forgot both halves of
   * that: `worst` started at 0, so the margin could never hold it on, and the
   * drop-off was looked for from the wrong segment whenever a short segment
   * had been skipped.
   *
   * No allocation: this runs every frame. Up to 48 corners ahead.
   */
  slowFor(best, bestT, speed, grip, facing) {
    const r = this.route;
    const v = Math.abs(speed || 0);
    if (!(v > 3) || Math.abs(facing) > 50 || !(this.offM < 14)) {
      this.slow = false;
      this.brakeNow = false;
      return;
    }
    const A_LAT = 8.6 * 0.65 * Math.max(0.3, grip || 1);
    const A_ROLL = 1.8;
    const A_BRAKE = 5;
    const V_DROP = 7;
    const V_MIN = 6;
    const horizon = Math.min(320, (v * v) / (2 * A_ROLL) + 30);
    const D = SLOW_D;
    const T = SLOW_T;
    // The route's corners ahead: distance to each, and how far it turns there.
    let n = 0;
    let d = segLen(r, best) * (1 - bestT);
    let k = best + 1;
    let prevB = segBearing(r, best);
    for (; k < r.length - 1 && d - 16 < horizon; k++) {
      const len = segLen(r, k);
      if (len < 0.5) continue;
      const b = segBearing(r, k);
      if (n < D.length) {
        D[n] = d;
        T[n] = Math.abs(((b - prevB + 540) % 360) - 180) * (Math.PI / 180);
        n++;
      }
      prevB = b;
      d += len;
    }
    // Most over the line, bend or drop: v minus the speed that still makes it.
    let over = -Infinity;
    let overBrake = -Infinity;
    let kph = 0;
    let dist = 0;
    let what = '';
    for (let i = 0; i < n; i++) {
      if (D[i] > horizon) break;
      let th = 0;
      for (let j = i; j >= 0 && D[i] - D[j] <= 16; j--) th += T[j];
      for (let j = i + 1; j < n && D[j] - D[i] <= 16; j++) th += T[j];
      if (th < 0.12) continue;
      const vs = Math.max(V_MIN, Math.sqrt(A_LAT * (32 / th)));
      const room = Math.max(0, D[i]);
      const may = Math.sqrt(vs * vs + 2 * A_ROLL * room);
      if (v - may > over) {
        over = v - may;
        kph = vs * 3.6;
        dist = room;
        what = 'bend';
      }
      overBrake = Math.max(overBrake, v - Math.sqrt(vs * vs + 2 * A_BRAKE * room));
    }
    // And the drop-off at the end of the route, if it is in range: the rest
    // of the segments from where the corner walk stopped. Only where the van
    // has to stop (stopAtEnd, set by whoever gives the route): the first
    // version slowed a child to 25 km/h for every split on the Coast Road,
    // which is a blue ring you drive through — measured, "SLOW DOWN
    // drop-off in 220 m" at 103 km/h on the way to the first headland.
    let toEnd = d;
    for (; k < r.length - 1 && toEnd <= horizon; k++) toEnd += segLen(r, k);
    if (this.stopAtEnd !== false && toEnd <= horizon) {
      const may = Math.sqrt(V_DROP * V_DROP + 2 * A_ROLL * toEnd);
      if (v - may > over) {
        over = v - may;
        kph = V_DROP * 3.6;
        dist = toEnd;
        what = 'drop';
      }
      overBrake = Math.max(overBrake, v - Math.sqrt(V_DROP * V_DROP + 2 * A_BRAKE * toEnd));
    }
    this.slow = over > 0 || (this.slow && over > -1.5);
    this.brakeNow = overBrake > 0 || (this.brakeNow && overBrake > -1);
    if (this.slow) {
      this.slowKph = kph;
      this.slowIn = dist;
      this.slowWhat = what;
    }
  }

  /**
   * The answer, in one object per tracker refilled every frame: next() runs
   * sixty times a second, and the HUD reads the answer and lets it go.
   */
  answer(dir, label, distanceM, angleDeg, remainingM, pointDeg, steer = false) {
    const o = this._out || (this._out = {});
    o.dir = dir;
    o.label = label;
    o.distanceM = distanceM;
    o.angleDeg = angleDeg;
    o.remainingM = remainingM;
    o.pointDeg = pointDeg;
    // STEER has no distance: it is now. The HUD words its second line.
    o.steer = steer;
    // And whether to come off the power first (see slowFor).
    o.slow = this.slow;
    o.brake = this.brakeNow;
    o.slowIn = this.slowIn;
    o.slowWhat = this.slowWhat;
    return o;
  }
}


/**
 * The drop-off zone when nobody has said how big it is: jobs.js's ARRIVE_R,
 * the smallest any job step stops in (some are 44-48 m). And what the job
 * calls stopped, its ARRIVE_SPEED, in m/s.
 */
const ARRIVE_M = 34;
const STOPPED_V = 4.2;

/** The corners slowFor() looks at, reused every frame. */
const SLOW_D = new Float64Array(48);
const SLOW_T = new Float64Array(48);

/** Length of route segment k, and its compass bearing. */
function segLen(r, k) {
  return Math.hypot(r[k + 1].x - r[k].x, r[k + 1].z - r[k].z);
}
function segBearing(r, k) {
  return (Math.atan2(r[k + 1].x - r[k].x, -(r[k + 1].z - r[k].z)) * 180) / Math.PI;
}

/* -------------------------------------------------------------- the mode */

export class DriveHud {
  /**
   * @param {import('./hud.js').Hud} hud the live HUD, already built
   */
  constructor(hud) {
    this.hud = hud;
    this.active = false;
    this.last = {};
    this.audio = null;
    this.tracker = new RouteTracker();
    this.build();
  }

  /* ---------------------------------------------------------------- build */

  build() {
    const hud = this.hud;
    const wrap = hud.wrap;

    /*
     * Handles on the bits of the existing strip this mode rewrites.
     *
     * Looked up once and cached, and every one of them is allowed to be
     * missing: if somebody reorganises the left panel, driving should lose a
     * label, not throw inside the frame loop and take the whole game with it.
     */
    const rowOf = (node) => (node && node.closest ? node.closest('.hud-row') : null);
    this.speedRow = rowOf(hud.speedValue);
    this.distRow = rowOf(hud.altValue);
    this.vsRow = rowOf(hud.vsValue);
    this.hdgRow = rowOf(hud.hdgValue);
    this.speedLabel = this.speedRow && this.speedRow.querySelector('.hud-label');
    this.distLabel = this.distRow && this.distRow.querySelector('.hud-label');
    this.speedUnit = hud.speedValue && hud.speedValue.parentElement.querySelector('.hud-unit');
    this.distUnit = hud.altValue && hud.altValue.parentElement.querySelector('.hud-unit');
    this.keyhint = wrap.querySelector('.hud-keyhint');
    this.keyhintFlight = this.keyhint ? this.keyhint.innerHTML : '';
    this.speedLabelFlight = this.speedLabel ? this.speedLabel.textContent : 'Airspeed';
    this.distLabelFlight = this.distLabel ? this.distLabel.textContent : 'Altitude';

    /*
     * The cargo pips, beside the clock.
     *
     * Five divs. This is the whole teaching device of the game: go fast and you
     * make the clock, go fast and the load takes knocks, and a load delivered
     * whole pays double. Nothing on screen explains that and nothing should —
     * the pips going out while the clock is still green is the lesson, and a
     * child works it out in about four minutes.
     *
     * It is inserted into the objective panel between the clock and the
     * objective text, which is a fixed sibling order the CSS lays out as a
     * two-column row. Inserted rather than appended so the order holds however
     * many times we enter and leave.
     */
    this.cargo = el('div', 'hud-cargo');
    this.cargo.hidden = true;
    this.cargoPips = [];
    const pipHost = el('div', 'hud-cargo-pips');
    for (let i = 0; i < 5; i++) {
      const p = el('i', 'hud-cargo-pip');
      this.cargoPips.push(p);
      pipHost.appendChild(p);
    }
    this.cargoLabel = el('div', 'hud-cargo-label', 'LOAD');
    this.cargo.appendChild(this.cargoLabel);
    this.cargo.appendChild(pipHost);
    if (hud.objective && hud.objectiveText) {
      hud.objective.insertBefore(this.cargo, hud.objectiveText);
    }

    /*
     * The next-turn chevron.
     *
     * Bottom centre, big, and the only thing on the screen a child has to read
     * while moving. An arrow and a distance: "LEFT 200 m". It is deliberately
     * not near the minimap and not in a panel with anything else in it.
     */
    this.chev = el('div', 'hud-chevron');
    this.chev.hidden = true;
    this.chevArrow = el('div', 'hud-chevron-arrow', '&#8593;');
    this.chevWords = el('div', 'hud-chevron-words');
    this.chevWhat = el('div', 'hud-chevron-what', '');
    this.chevDist = el('div', 'hud-chevron-dist', '');
    this.chevWords.appendChild(this.chevWhat);
    this.chevWords.appendChild(this.chevDist);
    this.chev.appendChild(this.chevArrow);
    this.chev.appendChild(this.chevWords);
    wrap.appendChild(this.chev);

    /*
     * The gear: D, N or R, lit. Reverse is "hold Ctrl once you have stopped",
     * and a child who has just started going backwards wants to see why.
     * It goes where the aeroplane's POWER bar was, in the same panel.
     */
    injectStyle();
    this.gearBox = el('div', 'hud-drive-gear');
    this.gearCells = {};
    for (const g of ['R', 'N', 'D']) {
      const b = el('b', '', g);
      b.dataset.g = g;
      this.gearCells[g] = b;
      this.gearBox.appendChild(b);
    }
    this.gearWord = el('span', '', '');
    this.gearBox.appendChild(this.gearWord);
    const bottom = hud.throttleBar && hud.throttleBar.root ? hud.throttleBar.root.parentElement : null;
    if (bottom) bottom.insertBefore(this.gearBox, bottom.firstChild);
    this._saved = null;
  }

  /**
   * Take down every aeroplane row, remembering exactly how each was, so that
   * putting them back restores what hud.js had rather than what this guesses.
   *
   * Measured in the van before this: POWER 0%, BRAKES, EASY MODE, the wind
   * rose saying "wind on the nose", and a key hint telling a child that Space
   * is the brake (it is the handbrake; Ctrl is the brake). The fuel bar was
   * set `hidden`, which loses to the `.hud-bar { display: grid }` rule, so
   * that one was never actually hidden at all. Inline display wins over both.
   */
  hideAero(hide) {
    const hud = this.hud;
    if (hide) {
      if (this._saved) return;
      this._saved = new Map();
      const nodes = [
        hud.throttleBar && hud.throttleBar.root,
        hud.fuelBar && hud.fuelBar.root,
        hud.brakeChip,
        hud.modeChip,
        hud.gearChip,
        hud.flapChip,
        hud.trimChip,
        hud.apChip,
        hud.windRose ? hud.windRose.closest('.hud-right') || hud.windRose : null,
        hud.damagePanel,
        hud.waypoint,
        hud.stallWarn,
        hud.papiHint,
        hud.coach,
        /*
         * And three of the aeroplane's buttons in the ⋯ tray, which nothing
         * took away: opened in the van it offered Guidance (the flight's
         * rails), Autopilot (the parked aeroplane's, with its toast) and
         * "Brace for impact" ("You are already on the ground").
         */
        hud.btnGuide,
        hud.btnAuto,
        hud.btnBrace,
      ];
      for (const n of nodes) {
        if (!n || this._saved.has(n)) continue;
        this._saved.set(n, n.style.display);
        n.style.display = 'none';
      }
      /*
       * And H, "show controls", which in the van listed the aeroplane's:
       * pitch, roll, rudder, flaps, gear, the starter and the autopilot —
       * two dozen keys, four of which do anything in a van. The card is
       * hud.js's; what goes on it while driving is the van's.
       */
      if (!this.isBoat && hud.showControls && !Object.prototype.hasOwnProperty.call(hud, 'showControls')) {
        hud.showControls = (bindings, keyLabel) => this.showVanControls(bindings, keyLabel);
        this._ownCard = true;
      }
    } else if (this._saved) {
      for (const [n, was] of this._saved) n.style.display = was;
      this._saved = null;
      if (this._ownCard) {
        // Back to the prototype's, which lists the aeroplane's keys.
        delete hud.showControls;
        this._ownCard = false;
        if (hud.hideControls) hud.hideControls();
      }
    }
  }

  /**
   * The controls card, for the van: the keys that do something in it — the
   * van's own (Settings → Car) — read from the player's bindings so a
   * re-bound key shows as re-bound.
   */
  showVanControls(bindings = {}, keyLabel = (k) => k) {
    const keys = (...actions) => {
      const seen = new Set();
      const out = [];
      for (const a of actions) {
        for (const k of bindings[a] || []) {
          const label = keyLabel(k);
          if (seen.has(label)) continue;
          seen.add(label);
          out.push(`<kbd>${label}</kbd>`);
        }
      }
      return out.join(' ');
    };
    const row = (what, ...actions) => `<div class="cc-row"><span>${what}</span><span class="cc-keys">${keys(...actions)}</span></div>`;
    const card = this.hud.controlsCard;
    if (!card) return;
    card.innerHTML =
      '<div class="cc-head">Driving the van</div><div class="cc-grid">'
      + '<div class="cc-group"><h4>Pedals</h4>'
      + row('Go', 'carGo')
      + row('Brake — hold it once stopped to reverse', 'carBrake')
      + row('Handbrake', 'carHandbrake')
      + '</div><div class="cc-group"><h4>Steering</h4>'
      + row('Steer left', 'carLeft')
      + row('Steer right', 'carRight')
      + '</div><div class="cc-group"><h4>Game</h4>'
      + row('Change the view', 'camera')
      + row('Map', 'minimap')
      + row('Pause / menu', 'pause')
      + `</div></div><div class="cc-foot">Press ${keys('help').replace(/<\/?kbd>/g, '') || 'H'} to close · follow the big arrow at the bottom · change keys in Settings → Controls → Car</div>`;
    card.style.display = '';
  }

  /* ---------------------------------------------------------------- enter */

  /**
   * Put the HUD into driving.
   *
   * @param {object} spec        the vehicle spec from vehicles/surface.js
   * @param {object} [opts]
   * @param {object} [opts.audio] the audio front end, for the clock tick
   */
  enter(spec, { audio = null } = {}) {
    const hud = this.hud;
    this.active = true;
    this.audio = audio;
    this.spec = spec || { kind: 'car' };
    this.isBoat = this.spec.kind === 'boat';
    this.last = {};
    this.blocked = false;
    this.tracker.reset();

    /*
     * is-vehicle as well as is-drive. hud.clearVehicle() refuses to do anything
     * unless hud.inVehicle is true, and it carries the fix for the bug where
     * one trip in the boat left the altimeter reading kilometres for the rest
     * of the session. Setting the flag here is what keeps that fix working.
     */
    hud.inVehicle = true;
    hud.wrap.classList.add('is-vehicle', 'is-drive');
    hud.wrap.classList.toggle('is-drive-boat', this.isBoat);
    hud.wrap.classList.toggle('is-drive-car', !this.isBoat);

    if (this.speedLabel) this.speedLabel.textContent = 'Speed';
    if (this.speedUnit) this.speedUnit.textContent = this.isBoat ? 'kt' : 'km/h';
    if (this.distLabel) this.distLabel.textContent = 'Trip';
    if (this.distUnit) this.distUnit.textContent = 'km';
    if (this.vsRow) this.vsRow.hidden = true;          // a van has no vertical speed
    // Every other aeroplane row, remembered and put back on exit().
    this.hideAero(true);
    if (this.keyhint) {
      this.keyhint.innerHTML = this.isBoat
        ? 'Throttle: <kbd>Shift</kbd>/<kbd>&uarr;</kbd> · Steer: <kbd>A</kbd><kbd>D</kbd> · Slow: <kbd>Ctrl</kbd>/<kbd>&darr;</kbd>'
        : 'Go <kbd>W</kbd>/<kbd>&uarr;</kbd>/<kbd>Shift</kbd> · Brake, then reverse <kbd>S</kbd>/<kbd>&darr;</kbd>/<kbd>Ctrl</kbd> · Steer <kbd>A</kbd><kbd>D</kbd> · Handbrake <kbd>Space</kbd> · Keys <kbd>H</kbd>';
    }
    /*
     * The clock element is shared with flying, and both sides cache the last
     * value they wrote into hud.lastValues.clock. Clearing it here means the
     * first frame of a job always paints, instead of being swallowed because a
     * flight happened to end on the same number of seconds.
     */
    hud.lastValues.clock = null;
    this.setClock(null);
    this.setCargo(null);
    this.setTurn(null);
    this.pauseWords(!this.isBoat);
  }

  /**
   * The pause menu, in the van's words while the van is out.
   *
   * Measured at the start of this repair: Esc in the van offered "Resume
   * flight" and "Return to the airfield". The menu is menus.js's; the two
   * labels are found by the actions they carry (data-act), remembered, and
   * put back on exit(), the same way the aeroplane rows are. "Back to the
   * start" only for the courier van itself: in it that button starts the job
   * (or free drive) again from the depot (see the courier-van plug-in in
   * jobs.js). A tug on the apron keeps whatever its own game says.
   */
  pauseWords(on) {
    const pause = typeof document !== 'undefined' ? document.querySelector('[data-screen="pause"]') : null;
    if (on) {
      if (!pause || this._pauseSaved) return;
      this._pauseSaved = [];
      const say = (act, words) => {
        const span = pause.querySelector(`[data-act="${act}"] span`);
        if (!span) return;
        this._pauseSaved.push([span, span.textContent]);
        span.textContent = words;
      };
      say('resume', 'Resume driving');
      if (this.spec && this.spec.id === 'car') {
        say('airport', 'Back to the start');
        // The ⋯ tray's copy of the same button, words and tooltip.
        const b = this.hud && this.hud.btnAirport;
        const span = b && b.querySelector('span');
        if (span) {
          this._pauseSaved.push([span, span.textContent]);
          span.textContent = 'Back to the start';
          this._trayTitle = [b, b.title, b.getAttribute('aria-label')];
          b.title = 'Start again from the depot';
          b.setAttribute('aria-label', b.title);
        }
      }
      // And the Autopilot fold, which a van has not got (seen on the card
      // in the van: "AUTOPILOT" under the van's own buttons). And the View
      // fold: "Free look" and "Realistic cockpit" are the aeroplane's camera
      // rig's, and neither does anything to the van's camera (C does) —
      // measured, both still on the van's card after the first repair.
      this._pauseFolds = [];
      for (const sel of ['[data-apmode]', '[data-freelook]']) {
        const n = pause.querySelector(sel);
        const fold = n && n.closest ? n.closest('details') : null;
        if (!fold) continue;
        this._pauseFolds.push([fold, fold.style.display]);
        fold.style.display = 'none';
      }
    } else if (this._pauseSaved) {
      for (const [span, was] of this._pauseSaved) span.textContent = was;
      this._pauseSaved = null;
      if (this._trayTitle) {
        const [b, title, aria] = this._trayTitle;
        b.title = title;
        if (aria != null) b.setAttribute('aria-label', aria);
        this._trayTitle = null;
      }
      for (const [fold, was] of this._pauseFolds || []) fold.style.display = was;
      this._pauseFolds = null;
    }
  }

  /* ----------------------------------------------------------------- exit */

  /**
   * Back to the aeroplane. Everything enter() touched goes back, including the
   * two unit labels, which is what hud.clearVehicle() is for.
   */
  exit() {
    if (!this.active) return;
    const hud = this.hud;
    this.active = false;
    this.audio = null;
    hud.wrap.classList.remove('is-drive', 'is-drive-boat', 'is-drive-car');
    if (this.speedLabel) this.speedLabel.textContent = this.speedLabelFlight;
    if (this.distLabel) this.distLabel.textContent = this.distLabelFlight;
    if (this.vsRow) this.vsRow.hidden = false;
    this.hideAero(false);
    if (this.keyhint) this.keyhint.innerHTML = this.keyhintFlight;
    this.blocked = false;
    this.setClock(null);
    this.setCargo(null);
    this.setTurn(null);
    this.pauseWords(false);
    /*
     * And the van's numbers off the aeroplane's rows. The next flight frame
     * writes its own, but until it does the rows read what the van left:
     * measured, starting a flight straight after the van read "AIRSPEED 99 kt
     * tarmac" over Drover's Flat. Blank, and the aeroplane's cache cleared so
     * that frame writes every one of them.
     */
    for (const n of [hud.speedValue, hud.speedWord, hud.altValue, hud.altWord, hud.hdgValue, hud.hdgWord]) {
      if (n) n.textContent = '';
    }
    if (hud.speedWord && hud.speedWord.dataset) delete hud.speedWord.dataset.surface;
    hud.lastValues = {};
    hud.clearVehicle();
  }

  /* -------------------------------------------------------------- setters */

  /** The job strip. Exactly hud.setObjective, named for what it is here. */
  setJob(title, text) {
    this.hud.setObjective(title || 'Island Roads', text || 'No job on. Take one at the depot, or just drive.');
  }

  /**
   * Seconds left, or null for no clock at all.
   *
   * Amber under thirty, red under ten, and an audible tick in the last five.
   * The flight side of the same element turns amber at a minute; a delivery is
   * a shorter thing and a minute of amber is a minute of ignoring it.
   */
  setClock(secondsLeft) {
    const node = this.hud.objectiveClock;
    if (!node) return;
    if (secondsLeft == null) {
      if (!node.hidden) node.hidden = true;
      node.classList.remove('is-warn', 'is-bad');
      this.last.clock = null;
      this._tickedAt = -1;
      return;
    }
    const left = Math.max(0, Math.ceil(secondsLeft));
    if (left <= 5 && left !== this._tickedAt) {
      this._tickedAt = left;
      this.tick(left === 0);
    }
    if (this.last.clock === left) return;
    this.last.clock = left;
    this.hud.lastValues.clock = null;
    node.hidden = false;
    const m = Math.floor(left / 60);
    node.textContent = `${m}:${String(left % 60).padStart(2, '0')}`;
    node.classList.toggle('is-warn', left <= 30 && left > 10);
    node.classList.toggle('is-bad', left <= 10);
  }

  /** One short blip a second in the last five. Silent if audio is not up. */
  tick(last = false) {
    const a = this.audio;
    if (!a || !a.available || !a.mixer) return;
    try {
      a.mixer.tone({
        bus: 'alerts',
        freq: last ? 660 : 1180,
        duration: last ? 0.22 : 0.05,
        gain: 0.13,
        type: 'square',
      });
    } catch (e) {
      // A HUD must never be the reason a frame throws. If the mixer is not
      // ready, the clock is still perfectly readable.
    }
  }

  /**
   * How the load is doing. Pass null to hide it — free driving has no cargo.
   *
   * @param {number|null} pips  how many are still lit
   * @param {number} [max]
   * @param {string} [label]    what is in the back, e.g. CHILLED VACCINE
   */
  setCargo(pips, max = 5, label = 'LOAD') {
    if (pips == null) {
      if (!this.cargo.hidden) this.cargo.hidden = true;
      this.last.cargo = null;
      return;
    }
    const n = Math.max(0, Math.min(this.cargoPips.length, Math.round(pips)));
    const cap = Math.max(1, Math.min(this.cargoPips.length, Math.round(max)));
    const key = `${n}/${cap}/${label}`;
    if (this.last.cargo === key) return;
    this.last.cargo = key;
    this.cargo.hidden = false;
    if (this.cargoLabel.textContent !== label) this.cargoLabel.textContent = label;
    for (let i = 0; i < this.cargoPips.length; i++) {
      const p = this.cargoPips[i];
      const state = i >= cap ? 'none' : i < n ? 'lit' : 'out';
      if (p.dataset.state === state) continue;
      p.dataset.state = state;
      p.hidden = state === 'none';
      p.classList.toggle('is-out', state === 'out');
    }
    // Amber from two pips down: the point where "floor it" stops paying.
    this.cargo.classList.toggle('is-care', n <= 2 && n > 0);
    this.cargo.classList.toggle('is-ruined', n === 0);
  }

  /**
   * A knock. Called by the jobs code when the load takes one, so the pip goes
   * out with a shake rather than silently becoming a smaller number.
   */
  cargoHit() {
    this.cargo.classList.remove('is-hit');
    void this.cargo.offsetWidth;
    this.cargo.classList.add('is-hit');
  }

  /**
   * The next instruction. Pass null when there is no route — free driving shows
   * no chevron at all rather than an arrow pointing nowhere.
   *
   * @param {{dir:string,label:string,distanceM:number,angleDeg:number}|null} turn
   */
  setTurn(turn) {
    /*
     * Up against something and not getting anywhere: that is the instruction,
     * whatever the route says. The reviewer's arrow-following kid overshot a
     * junction on Drover's Flat, crossed the grass into a building at 76 km/h
     * and sat there holding W for 140 s under "STRAIGHT ON 1.6 km" — the
     * route was re-planned from where the van was, and its first leg went
     * through the wall.
     */
    /*
     * And which way out, pointed at like any other turn. The first version
     * said "back up with S, or steer round it" under a down arrow, and a
     * child who steered the wrong way round got nowhere: from the grass
     * behind three of six Drover's Flat buildings the van touched the wall
     * with one front corner, could only turn away from it, and the kid
     * holding the other key sat there 85 s. The van works out which way is
     * free (SurfaceVehicle.pinWay); where either is, the side the route is
     * on. Neither: back up.
     */
    if (this.blocked) {
      const L = this.last;
      /*
       * Once it has said a side, it keeps saying it while the van is still
       * pinned, until that side is the one blocked: turned a little towards
       * it, both sides are free, and going back to the route's side there
       * sent the van straight back into the wall — measured, LEFT and RIGHT
       * swapping every half second for eight seconds.
       */
      let w = this.blockedWay;
      if (w === 2) w = this._blockSide || (turn && turn.pointDeg < 0 ? -1 : 1);
      if (w) this._blockSide = w;
      const key = `blocked${w}`;
      if (L.turn === key) return;
      L.turn = key;
      L.turnLabel = null;
      L.rot = w ? w * 70 : 0;
      this.chevArrow.style.transform = w ? `rotate(${w * 70}deg)` : '';
      this.chev.hidden = false;
      this.chevArrow.innerHTML = w ? '&#8593;' : '&#8595;';
      this.chevWhat.textContent = 'BLOCKED';
      this.chevDist.textContent = w < 0 ? 'steer left and go' : w > 0 ? 'steer right and go' : 'back up with S';
      this.chev.dataset.dir = 'blocked';
      this.chev.classList.add('is-near');
      this.chev.classList.remove('is-slow', 'is-brake');
      return;
    }
    if (!turn) {
      if (!this.chev.hidden) this.chev.hidden = true;
      this.last.turn = null;
      return;
    }
    const d = turn.distanceM || 0;
    // Round the way the number is useful: to the nearest 10 m when it is far
    // enough away to plan, to the nearest 5 m when you are about to do it.
    // As a number first, and words only when the number changes: this runs
    // every frame, and building the string and a key out of it every frame
    // was two new strings sixty times a second.
    const far = !turn.steer && turn.dir !== 'arrive' && d > 1200;
    // STEER's second line is off the road or not, so that is all its key is.
    // (By what is under the wheels, not by distance from the route: the
    // guide re-plans from wherever the van is, so the route always starts
    // under it.)
    // NEARLY THERE counts UP to the next five metres, never down to 0 m: a
    // child who stops when it reads "0 m more" is still outside the zone.
    const q = turn.steer ? (this.offRoad ? 1 : 0)
      : turn.dir === 'near' ? Math.max(5, Math.ceil(d / 5) * 5)
        : turn.dir === 'arrive' ? (turn.brake ? 1 : 0)
          : far ? Math.round(d / 100) * 100 : d > 150 ? Math.round(d / 10) * 10 : Math.round(d / 5) * 5;
    /*
     * SLOW DOWN, or BRAKE, over the top of the turn it is for (see slowFor in
     * the tracker): the first line is what to do with your right foot, the
     * second what is coming. Keyed on its own rounded distance, so it counts
     * down in tens like everything else here.
     */
    const pace = turn.dir === 'arrive' || turn.dir === 'back' ? '' : turn.brake ? 'brake' : turn.slow ? 'slow' : '';
    const qs = pace ? Math.round((turn.slowIn || 0) / 10) * 10 : 0;
    /*
     * The arrow points where to steer now (see RouteTracker.next), in five
     * degree steps so it does not rewrite the style sixty times a second.
     * Words say what is coming; the arrow says what to do about it.
     */
    const pointing = turn.dir !== 'arrive' && turn.dir !== 'uturn' && turn.dir !== 'back' && typeof turn.pointDeg === 'number';
    const rot = pointing ? Math.max(-80, Math.min(80, Math.round(turn.pointDeg / 5) * 5)) : 0;
    if (this.last.rot !== rot) {
      this.last.rot = rot;
      this.chevArrow.style.transform = rot ? `rotate(${rot}deg)` : '';
    }
    const L = this.last;
    if (L.turn === turn.dir && L.turnLabel === turn.label && L.turnQ === q && L.turnFar === far && L.pace === pace && L.paceQ === qs) return;
    L.turn = turn.dir;
    L.turnLabel = turn.label;
    L.turnQ = q;
    L.turnFar = far;
    L.pace = pace;
    L.paceQ = qs;
    const distText = far ? `${(q / 1000).toFixed(1)} km` : `${q} m`;
    this.chev.hidden = false;
    const glyph =
      turn.dir === 'uturn' ? '&#8634;'
        : turn.dir === 'arrive' ? '&#9679;'
          : turn.dir === 'back' ? '&#8595;'
            : '&#8593;';
    if (this.chevArrow.innerHTML !== glyph) this.chevArrow.innerHTML = glyph;
    if (pace) {
      this.chevWhat.textContent = pace === 'brake' ? 'BRAKE!' : 'SLOW DOWN';
      this.chevDist.textContent = turn.steer
        ? (turn.pointDeg < 0 ? 'steer left' : 'steer right')
        : turn.slowWhat === 'drop' ? `drop-off in ${qs} m`
          : turn.dir === 'left' || turn.dir === 'right' ? `${turn.label} ${distText}`
            : `bend in ${qs} m`;
    } else {
      this.chevWhat.textContent = turn.label || '';
      /*
       * The second line says what to do, not "0 m": TURN AROUND read "0 m"
       * under it, and ARRIVING said "drop it here" wherever it was shown.
       * ARRIVING is now only shown where a stop counts (RouteTracker
       * .nearTheDrop), or where it will if the brake goes on now.
       */
      this.chevDist.textContent = turn.dir === 'arrive'
        ? (this.tracker.stopAtEnd === false ? 'you are there' : turn.brake ? 'brake now' : 'stop here')
        : turn.dir === 'near' ? `${q} m more`
          : turn.dir === 'back' ? 'hold S'
            : turn.dir === 'uturn' ? 'it is behind you'
              : turn.steer ? (q ? 'back to the road' : 'round the bend') : distText;
    }
    this.chev.dataset.dir = turn.dir;
    this.chev.classList.toggle('is-slow', pace === 'slow');
    this.chev.classList.toggle('is-brake', pace === 'brake' || (turn.dir === 'arrive' && !!turn.brake));
    // Close now: the chevron gets bigger and warms up. Distance, not time, so
    // it reads the same whether you are creeping or flying.
    this.chev.classList.toggle('is-near', !!pace || turn.steer || d < 90 || turn.dir === 'arrive' || turn.dir === 'back' || turn.dir === 'near');
  }

  /* --------------------------------------------------------------- frame */

  /**
   * One frame of driving.
   *
   * Everything here is optional except `readouts`, on purpose: the roads and
   * the jobs land after this does, and until they do this still gives a correct
   * speed, surface and heading with no clock, no pips and no chevron. A HUD
   * that needs three other people's work before it shows anything is a HUD that
   * cannot be tested.
   *
   * @param {number} dt
   * @param {object} s
   * @param {object} s.readouts  SurfaceVehicle.readouts()
   * @param {{kind:string}} [s.surface]   what is under the wheels right now
   * @param {{name:string,toGoM:number}} [s.job]
   * @param {number} [s.clock]   seconds left, or null
   * @param {{pips:number,max:number,label:string}} [s.cargo]
   * @param {object} [s.turn]    from RouteTracker.next(), or null
   */
  update(dt, s = {}) {
    const hud = this.hud;
    const r = s.readouts || {};
    if (!this.active) return;

    /* -- speed, big, with the surface underneath it -------------------- */
    const fast = this.isBoat ? Math.round(r.speedKts || 0) : Math.round(r.speedKph || 0);
    if (this.last.speed !== fast) {
      this.last.speed = fast;
      hud.speedValue.textContent = String(fast);
    }
    const surfKind = (s.surface && s.surface.kind) || null;
    const onMade = SURFACE_WORDS[surfKind] === 'tarmac' || SURFACE_WORDS[surfKind] === 'gravel';
    this.offRoad = !this.isBoat && !onMade;
    // Grass drawn as something else (s.looks, from jobs.js: 'field' on a
    // crop patch that is not green, else 'sand' or 'dirt', whichever the
    // terrain shader paints most of there) is called what it looks like, in
    // that colour.
    const looks = !this.isBoat && surfKind === 'grass' && s.looks ? s.looks : null;
    const word = this.isBoat
      ? (fast < 1 ? 'stopped' : fast < 8 ? 'idling along' : fast < 25 ? 'making way' : 'on the plane')
      : looks || SURFACE_WORDS[surfKind] || (fast < 1 ? 'stopped' : 'off road');
    if (this.last.word !== word) {
      this.last.word = word;
      hud.speedWord.textContent = word;
      hud.speedWord.dataset.surface = looks || surfKind || '';
    }

    /* -- the second row: how far there is left to go -------------------
     *
     * The old drive HUD put the distance travelled here, which is a number you
     * cannot act on. With a job on, this is the distance still to run, which is
     * the number the clock is about. With no job it falls back to the trip,
     * because something has to be there and a blank row looks broken.
     */
    const job = s.job || null;
    const toGo = job && job.toGoM != null ? job.toGoM : null;
    const wantLabel = toGo != null ? 'To go' : 'Trip';
    if (this.last.distLabel !== wantLabel) {
      this.last.distLabel = wantLabel;
      if (this.distLabel) this.distLabel.textContent = wantLabel;
    }
    const metres = toGo != null ? toGo : (r.distanceM || 0);
    const km = metres / 1000;
    /*
     * The last kilometre to a drop-off in metres, to the nearest ten: "0.0
     * km" read TO GO with the van 40 m short of the zone, which is exactly
     * the distance a child needs to see.
     */
    const inM = toGo != null && metres < 995;
    const shown = inM ? String(Math.max(0, Math.round(metres / 10) * 10)) : km < 10 ? km.toFixed(1) : String(Math.round(km));
    if (this.last.dist !== shown) {
      this.last.dist = shown;
      hud.altValue.textContent = shown;
    }
    const unit = inM ? 'm' : 'km';
    if (this.last.distUnit !== unit) {
      this.last.distUnit = unit;
      if (this.distUnit) this.distUnit.textContent = unit;
    }
    const dWord = toGo != null ? (job.name || 'to the drop') : 'travelled';
    if (this.last.distWord !== dWord) {
      this.last.distWord = dWord;
      hud.altWord.textContent = dWord;
    }

    /* -- heading, unchanged from the aeroplane ------------------------- */
    const h = Math.round(r.heading || 0);
    if (this.last.hdg !== h) {
      this.last.hdg = h;
      hud.hdgValue.textContent = String(h).padStart(3, '0');
      const dirs = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
      hud.hdgWord.textContent = dirs[Math.round(h / 45) % 8];
    }

    /* -- the gear, where the POWER bar was ------------------------------ */
    if (!this.isBoat) {
      const g = r.gear || 'N';
      if (this.last.gear !== g) {
        this.last.gear = g;
        for (const k in this.gearCells) this.gearCells[k].classList.toggle('is-on', k === g);
      }
      const word = s.handbrake ? 'HANDBRAKE' : g === 'R' ? 'reversing' : g === 'D' ? 'drive' : 'stopped';
      if (this.last.gearWord !== word) {
        this.last.gearWord = word;
        this.gearWord.textContent = word;
        this.gearWord.classList.toggle('is-hand', word === 'HANDBRAKE');
      }
    } else {
      const thr = Math.round((r.throttle || 0) * 100);
      if (this.last.thr !== thr) {
        this.last.thr = thr;
        hud.throttleBar.fill.style.width = `${thr}%`;
        hud.throttleBar.val.textContent = `${thr}%`;
      }
    }

    /* -- the three courier instruments --------------------------------- */
    this.setClock(s.clock == null ? null : s.clock);
    if (s.cargo) this.setCargo(s.cargo.pips, s.cargo.max || 5, s.cargo.label || 'LOAD');
    else this.setCargo(null);
    // Pinned against a wall or a tree with the go key held (SurfaceVehicle
    // .blockedT): the chevron says so, over whatever the route says.
    this.blocked = !this.isBoat && !!s.blocked;
    this.blockedWay = s.readouts && s.readouts.blockedWay != null ? s.readouts.blockedWay : 2;
    if (!this.blocked) this._blockSide = 0;
    this.setTurn(s.turn || null);

    this.tickOverlays(dt);
  }

  /**
   * Age the toasts, the banner and the subtitle.
   *
   * These are ticked inside Hud.update(), and main.js returns from its drive
   * branch long before Hud.update() is reached — so today a toast raised while
   * driving never expires. Take the boat out, run aground, and "You ran aground
   * — press Esc to go back" stays welded to the screen for the rest of the
   * session, including through every flight afterwards. Ticking them here is
   * the smallest fix that does not need an edit inside hud.js. That method
   * has since grown a public `updateOverlays(dt)` — which also fades the
   * radio line and folds the objective into its chip — so this calls it
   * instead of repeating it.
   */
  tickOverlays(dt) {
    if (this.hud.updateOverlays) this.hud.updateOverlays(dt);
  }
}

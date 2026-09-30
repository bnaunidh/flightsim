/**
 * One rocket flight, from the pad to the result — pure numbers again.
 *
 * The page (rocket.js) owns the pictures, the sound and the keys; this owns
 * what is happening and what the child should do about it, which is the
 * part that has to be right. It is stepped at a fixed 1/60 s, as many times
 * a frame as the time warp asks for, and it can be flown to the end by the
 * robot at the bottom of this file — which is what tests/features/rocket.mjs
 * does for every mission, and what it checks can be LOST as well as won.
 *
 * THE GOAL IS ALWAYS ON SCREEN
 * objective() answers "what do I do now?" in one line for every moment of
 * every flight: press SPACE, lean right a little, drop the booster, hold
 * SPACE to slow down. A ten-year-old reads that line and nothing else, so
 * it is written for them and it changes the moment the answer changes.
 *
 * THE FOUR GOALS
 *   space       Starling — straight up past 100 km.
 *   land-pad    Petrel 9 — climb, drop the booster, and land the booster
 *               back on the landing pad beside the launch pad. The upper
 *               stage flies itself on to space while you do.
 *   land-barge  the same, onto a ship out at sea.
 *   orbit       Albatross — two burns: climb until the top of the path is
 *               110 km (the engine stops by itself), coast up, fire FLAT at
 *               the top until it is going fast enough sideways to stay up,
 *               then let the satellite go.
 */

import {
  Body, ROCKETS, PLANET, stepBody, guideTilt, orbitOf, landingThrottle,
  aimAlong, setAlong, predictImpact, timeToTop, ORBIT_AIM, circularSpeed, DEG,
} from './physics.js';

export const GOALS = {
  space: { id: 'space', name: 'Reach space', line: 'Fly up past 100 km, where space begins.', icon: '⇡' },
  'land-pad': { id: 'land-pad', name: 'Land on the pad', line: 'Drop the booster, then land it back on the landing pad.', icon: '⤓' },
  'land-barge': { id: 'land-barge', name: 'Land on the ship', line: 'Drop the booster, then land it on the ship out at sea.', icon: '⚓' },
  orbit: { id: 'orbit', name: 'Satellite to orbit', line: 'Go fast enough sideways to stay up, then let the satellite go.', icon: '⊙' },
};

/** The four rocket missions on the board. */
export const ROCKET_MISSIONS = [
  {
    id: 'rocket-space',
    name: 'First Launch',
    rocket: 'starling',
    goal: 'space',
    difficulty: 'Easy',
    short: 'Starling · fly to space',
    icon: '⇡',
    blurb: 'Your first rocket. Count down, lift off and keep it pointing straight up until you pass 100 km — the edge of space.',
    reward: 'Learn: lift-off, keeping straight, and where space begins',
  },
  {
    id: 'rocket-home',
    name: 'Come Home',
    rocket: 'petrel',
    goal: 'land-pad',
    difficulty: 'Medium',
    short: 'Petrel 9 · land the booster on the pad',
    icon: '⤓',
    blurb: 'Climb, drop the booster, then fly the booster back and set it down on its legs on the landing pad by the launch site.',
    reward: 'Learn: stages, and landing a rocket on its tail',
  },
  {
    id: 'rocket-barge',
    name: 'Ship Landing',
    rocket: 'petrel',
    goal: 'land-barge',
    difficulty: 'Hard',
    short: 'Petrel 9 · land the booster on the ship',
    icon: '⚓',
    blurb: 'The same climb, but the booster lands on a ship out at sea. A smaller target, and water all round it.',
    reward: 'Learn: steering a falling booster onto a moving deck',
  },
  {
    id: 'rocket-satellite',
    name: 'Satellite Delivery',
    rocket: 'albatross',
    goal: 'orbit',
    difficulty: 'Hard',
    short: 'Albatross · put a satellite in orbit',
    icon: '⊙',
    blurb: 'Climb high, coast to the top, then fire flat until you are going fast enough sideways to stay up. Then let the satellite go.',
    reward: 'Learn: what an orbit really is — falling round the planet',
  },
];

export function findRocketMission(id) {
  return ROCKET_MISSIONS.find((m) => m.id === id) || null;
}

/** How fast a child can lean the rocket, radians a second. */
export const TILT_RATE = 0.45;
/** How far a landing booster leans when you hold ◀ or ▶ (or the helper leans it). */
export const LAND_LEAN = 22 * DEG;
/** A soft touchdown: slower than this down, and this sideways, and this upright. */
export const SOFT = { down: 6, side: 5, tilt: 12 * DEG };

/*
 * THE LANDING HELPER STEERS AS WELL AS BRAKES
 *
 * The keys and the touch pads are on or off, and a booster that leans the
 * full 22° for as long as ◀ is held swings straight past the pad: a child
 * who holds ◀ until the card says "Right over it" and lets go is still
 * sliding at 50 m/s. Nobody could land it by doing what the screen said.
 *
 * So with the helper on, ◀ ▶ ask for a SLIDE, not a lean, and the helper
 * picks the lean that gets it — the way a drone holds still when you let go
 * of the stick:
 *   hands off        it leans against any slide (the wind, the fall) until
 *                    the booster comes straight down where it is;
 *   hold towards     it glides that way and eases off as the target comes
 *   the target       up, so it stops right over it;
 *   hold away        it slides that way, as fast as is safe at that height.
 * Near the deck the slide and the lean it may use both shrink, so it
 * always touches down upright and slow. With the helper off, ◀ ▶ lean the
 * booster themselves — the pilot's way — and stopping a slide is leaning
 * the other way, which the card and the crash message both say.
 */
/** The fastest slide the helper will fly, by height above the deck (m/s). */
export function slideLimit(above) {
  return clamp(3 + Math.max(0, above) / 45, 3, 45);
}
/** How hard the helper brakes a glide as the target comes up (m/s²) — well inside what the fins can do. */
export const GLIDE_BRAKE = 2.4;
/** The helper counts itself over the target this close (m); the card says "Right over it" at 12. */
export const OVER_IT = 5;
/** The card's "Right over it". */
export const OVER_CARD = 12;
/** Leaning the full LAND_LEAN for a slide this far off what was asked (m/s) — when there is little to push with. */
const LEAN_GAIN = LAND_LEAN / 10;
/** How briskly the helper closes the gap to the slide it wants (per second). */
const SLIDE_RESPONSE = 0.9;
/** Where the child takes the booster over from the computer. */
export const HANDOVER = 6000;
export const COUNTDOWN = 5;

const STEP = 1 / 60;

export class Flight {
  /**
   * @param {object} o
   * @param {string} o.rocket   id in ROCKETS
   * @param {string} o.goal     id in GOALS
   * @param {object} o.site     { padY, surface(s) → {y, kind}, lzS, bargeS }
   * @param {boolean} [o.helper=true]  the landing helper (hold = slow down safely)
   * @param {string} [o.mission]  a mission id, or null for a launch from the picker
   */
  constructor({ rocket, goal, site, helper = true, mission = null }) {
    const def = ROCKETS[rocket] || ROCKETS.starling;
    if (!def.goals.includes(goal)) goal = def.goals[0];
    this.def = def;
    this.goal = goal;
    this.site = site;
    this.helper = helper !== false;
    this.mission = mission;
    this.t = 0;
    this.met = 0;
    this.phase = 'pad';
    this.countdown = COUNTDOWN;
    this.input = { lean: 0, action: false, burn: false };
    this.events = [];
    this.result = null;
    this.flags = {};
    this.upperBest = 0;
    this.maxQ = 0;
    /** Which way the wind blows on the way down — from the mission, so a retry is the same flight. */
    this.seed = seedOf(`${mission || ''}${rocket}${goal}${site.bargeS || 0}`);

    const stages = def.stages.map((s) => ({ ...s, fuelLeft: s.fuel }));
    this.stack = new Body({
      role: 'stack',
      stages,
      payload: def.payload ? { ...def.payload } : null,
      fairing: def.fairing ? { ...def.fairing } : null,
      pos: { x: 0, y: PLANET.R + site.padY },
      vel: { x: 0, y: 0 },
      cd: def.cd,
    });
    // A booster that is to land keeps its landing fuel out of the climb.
    const s0 = stages[0];
    if (s0.landable && s0.reserve && goal.startsWith('land')) this.stack.fuelFloor = s0.fuel * s0.reserve;
    this.bodies = [this.stack];
    this.focus = this.stack;
    this.booster = null;
    this.upper = null;
    this.satellite = null;
  }

  emit(type, extra = {}) {
    this.events.push({ type, t: this.t, ...extra });
  }

  /** Take everything that happened since the last call. */
  drain() {
    const out = this.events;
    this.events = [];
    return out;
  }

  get done() {
    return !!this.result;
  }

  target() {
    if (this.goal === 'land-pad') return { s: this.site.lzS, kind: 'lz', name: 'landing pad' };
    if (this.goal === 'land-barge') return { s: this.site.bargeS, kind: 'barge', name: 'ship' };
    return null;
  }

  /** The most time warp that is safe right now. */
  warpCap() {
    const p = this.phase;
    if (this.result) return 4;
    if (p === 'pad' || p === 'countdown' || p === 'landing') return 1;
    if (this.flags.stageWaiting || this.flags.firePrompt) return 1;
    if (p === 'return') return this.flags.boostDone && this.focus.alt > 8000 ? 8 : 1;
    // First Launch after its engine is done: a long, safe coast up to space.
    if (p === 'ascent' && this.flags.burnout && !this.flags.space) return 4;
    if (p === 'ascent' || p === 'circ') return 2;
    return 4;
  }

  step(dt = STEP) {
    this.t += dt;
    const input = this.input;
    const action = input.action;
    input.action = false;

    switch (this.phase) {
      case 'pad':
        if (action) {
          this.phase = 'countdown';
          this.countdown = COUNTDOWN;
          this.emit('countdown', { n: COUNTDOWN });
        }
        break;
      case 'countdown': {
        const before = Math.ceil(this.countdown);
        this.countdown -= dt;
        const after = Math.ceil(this.countdown);
        if (after < before && after > 0) this.emit('tick', { n: after });
        if (!this.flags.ignition && this.countdown <= 2) {
          this.flags.ignition = true;
          this.stack.engineOn = true;
          this.emit('ignition');
        }
        // Held down on the pad while the engines come up to full power.
        if (this.flags.ignition) this.stack.throttle = Math.min(1, 0.35 + (2 - this.countdown) * 0.33);
        if (this.countdown <= 0) {
          this.phase = 'ascent';
          this.met = 0;
          this.emit('liftoff');
        }
        break;
      }
      default:
        this.met += dt;
        this.fly(dt, action);
    }
    // Everything else that is flying keeps flying.
    for (const b of this.bodies) {
      if (b === this.focus || b.landed || b.crashed || b.gone) continue;
      this.stepOther(b, dt);
    }
  }

  /** The thing you are flying. */
  fly(dt, action) {
    const b = this.focus;
    if (this.result && (b.landed || b.crashed)) return;
    const p = this.phase;
    const input = this.input;

    if (p === 'ascent' || p === 'coast' || p === 'circ' || p === 'orbit') {
      // Lean. Hands off, it holds whatever lean it has — plus a gust in the
      // thick air for the child to correct, so keeping straight is a thing
      // you do rather than a thing that happens.
      let rate = input.lean * TILT_RATE;
      if (p === 'ascent' && b.alt < 25000) rate += gust(this.t) * Math.min(1, b.q / 20000);
      const lo = -45 * DEG;
      const hi = 120 * DEG;
      if (b.tilt + rate * dt < lo) rate = (lo - b.tilt) / dt;
      if (b.tilt + rate * dt > hi) rate = (hi - b.tilt) / dt;

      let throttle = 0;
      if (p === 'ascent' || p === 'circ') throttle = b.usableFuel > 0 ? 1 : 0;
      stepBody(b, dt, { throttle, tiltRate: rate });
      this.afterStep(b);
      if (this.result) return;

      // Max Q: the moment the air pushes hardest, said once as it passes.
      if (b.q > this.maxQ) this.maxQ = b.q;
      else if (!this.flags.maxq && this.maxQ > 18000 && b.q < this.maxQ * 0.97) {
        this.flags.maxq = true;
        this.emit('maxq');
      }
      if (!this.flags.quiet && b.alt > 36000) {
        this.flags.quiet = true;
        this.emit('quiet');
      }
      if (b.fairing && b.alt > b.fairing.dropAt) this.dropFairing(b);

      // An empty stage with another above it: say so, then wait for SPACE.
      if (b.stages.length > 1 && b.usableFuel <= 0 && (p === 'ascent' || p === 'circ')) {
        if (!this.flags.stageWaiting) {
          this.flags.stageWaiting = true;
          this.flags.stageSince = this.t;
          this.emit(b.fuelFloor > 0 ? 'meco-reserve' : 'stage-empty');
        }
        if (action || this.t - this.flags.stageSince > 6) {
          this.separate(b, !action);
          return;
        }
      }
      if (p === 'ascent') this.ascentChecks(b);
      else if (p === 'coast') this.coastChecks(b, action);
      else if (p === 'circ') this.circChecks(b);
      else if (p === 'orbit' && action && !this.satellite) this.release(b);
      return;
    }

    if (p === 'return') {
      this.returnStep(b, dt);
      return;
    }
    if (p === 'landing') {
      this.landingStep(b, dt);
      return;
    }
    if (p === 'done' && !b.landed && !b.crashed && !b.gone) {
      // The result is in; the rocket carries on behind the card, engine off.
      stepBody(b, dt, { throttle: 0, tiltRate: 0 });
      if (b.alt < this.site.surface(b.downrange).y) b.gone = true;
    }
  }

  ascentChecks(b) {
    const lv = b.localVel(LV);
    // Space: the moment it crosses 100 km.
    if (!this.flags.space && b.alt >= PLANET.SPACE && this.focus === b) {
      this.flags.space = true;
      this.flags.spaceAt = this.t;
      this.emit('space');
    }
    if (this.goal === 'space') {
      if (b.stages.length === 1 && b.usableFuel <= 0 && !this.flags.burnout) {
        this.flags.burnout = true;
        this.emit('burnout');
      }
      if (this.flags.space && (lv.up <= 0 || this.t - this.flags.spaceAt > 9)) {
        const top = Math.max(b.maxAlt, lv.up > 0 && b.usableFuel <= 0 ? orbitOf(b).apoapsis : 0);
        this.win({
          title: 'You reached space!',
          reason: `Your ${this.def.name} is going up to ${km(top)} — past the 100 km line where space begins.`,
          score: clamp(Math.round(55 + (top - PLANET.SPACE) / 500), 55, 100),
        });
        return;
      }
      if (!this.flags.space && lv.up < 0 && b.usableFuel <= 0) {
        this.lose(
          'Not quite space',
          `It got to ${km(b.maxAlt)} and started to fall back. Space starts at 100 km — keep it pointing straighter up next time.`
        );
      }
      return;
    }
    if (this.goal === 'orbit') {
      const o = orbitOf(b);
      if (o.apoapsis >= ORBIT_AIM) {
        this.phase = 'coast';
        this.flags.stageWaiting = false;
        this.emit('cut');
        return;
      }
      if (b.stages.length === 1 && b.usableFuel <= 0) {
        this.lose('Out of fuel', 'The rocket ran out of fuel before it was high enough. Follow the green wedge — up first, then over.');
      }
    }
    // The land goals have nothing to check here: separation is what ends
    // their climb, and separate() takes it from there.
  }

  coastChecks(b, action) {
    const tt = timeToTop(b);
    const lv = b.localVel(LV);
    if (!this.flags.firePrompt && tt < 12) {
      this.flags.firePrompt = true;
      this.emit('fire-prompt');
    }
    if (action) {
      this.phase = 'circ';
      b.engineOn = true;
      this.flags.firePrompt = false;
      this.emit('relight');
      return;
    }
    if (lv.up < 0 && b.alt < 72000) {
      this.lose('Fell back into the air', 'It went over the top and fell back down. Press SPACE at the top of the climb to fire the engine flat.');
    }
  }

  circChecks(b) {
    const o = orbitOf(b);
    if (o.periapsis >= PLANET.ORBIT_MIN) {
      this.phase = 'orbit';
      this.emit('orbit');
      return;
    }
    if (b.stages.length === 1 && b.usableFuel <= 0) {
      this.lose(
        'Not fast enough to stay up',
        `Out of fuel at ${Math.round(sideways(b)).toLocaleString('en-GB')} m/s sideways — it needed ${Math.round(circularSpeed(b.r)).toLocaleString('en-GB')}. Keep it flat, and fire right at the top.`
      );
      return;
    }
    const lv = b.localVel(LV);
    if (lv.up < 0 && b.alt < 72000) {
      this.lose('Fell back into the air', 'It dropped back into the air before it was going fast enough. Keep it flat and fire at the top.');
    }
  }

  /** Split the bottom stage off. The flight goes wherever the goal is. */
  separate(stack, auto) {
    const s0 = stack.stages[0];
    const f = stack.frame({});
    const lift = s0.height + 0.6;
    const booster = new Body({
      role: 'booster',
      stages: [s0],
      pos: stack.pos,
      vel: stack.vel,
      tilt: stack.tilt,
      cd: 0.95,
    });
    booster.fuelFloor = 0;
    booster.engineOn = false;
    const nx = f.ax * Math.sin(stack.tilt) + f.ux * Math.cos(stack.tilt);
    const ny = f.ay * Math.sin(stack.tilt) + f.uy * Math.cos(stack.tilt);
    const upper = new Body({
      role: 'upper',
      stages: stack.stages.slice(1),
      payload: stack.payload,
      fairing: stack.fairing,
      pos: { x: stack.pos.x + nx * lift, y: stack.pos.y + ny * lift },
      vel: { x: stack.vel.x + nx * 2, y: stack.vel.y + ny * 2 },
      tilt: stack.tilt,
      cd: this.def.cd,
    });
    upper.engineOn = true;
    upper.maxAlt = stack.maxAlt;
    // Gently apart: the booster is pushed back a little so they never touch.
    booster.vel.x -= nx * 1.5;
    booster.vel.y -= ny * 1.5;
    this.bodies = this.bodies.filter((x) => x !== stack);
    this.bodies.push(booster, upper);
    this.booster = booster;
    this.upper = upper;
    this.flags.stageWaiting = false;
    this.emit('separation', { auto: !!auto });

    if (this.goal === 'land-pad' || this.goal === 'land-barge') {
      this.focus = booster;
      this.phase = 'return';
      this.flags.returnStart = this.t;
      upper.auto = true;
      booster.gone = false;
    } else {
      this.focus = upper;
      booster.auto = 'home';
      booster.goneAt = this.t + 14;
      if (this.phase !== 'circ') this.phase = this.phase === 'coast' ? 'coast' : 'ascent';
    }
  }

  dropFairing(b) {
    const f = b.frame({});
    b.fairing = null;
    for (const side of [-1, 1]) {
      const half = new Body({
        role: 'fairing',
        stages: [],
        payload: { mass: 70 },
        pos: b.pos,
        vel: { x: b.vel.x + f.ax * side * 6, y: b.vel.y + f.ay * side * 6 },
        tilt: b.tilt + side * 0.3,
        cd: 1.2,
      });
      half.side = side;
      half.goneAt = this.t + 16;
      this.bodies.push(half);
    }
    this.emit('fairing');
  }

  release(b) {
    const f = b.frame({});
    const nx = f.ax * Math.sin(b.tilt) + f.ux * Math.cos(b.tilt);
    const ny = f.ay * Math.sin(b.tilt) + f.uy * Math.cos(b.tilt);
    const sat = new Body({
      role: 'satellite',
      stages: [],
      payload: b.payload,
      pos: { x: b.pos.x + nx * 1.5, y: b.pos.y + ny * 1.5 },
      vel: { x: b.vel.x + nx * 1.2, y: b.vel.y + ny * 1.2 },
      tilt: b.tilt,
    });
    b.payload = null;
    this.satellite = sat;
    this.bodies.push(sat);
    this.emit('release');
    const o = orbitOf(sat);
    const round = clamp(1 - (o.apoapsis - o.periapsis) / 120000, 0, 1);
    this.win({
      title: 'Satellite in orbit!',
      reason: `It is going round the planet between ${km(o.periapsis)} and ${km(o.apoapsis)} up, at ${Math.round(sat.speed).toLocaleString('en-GB')} m/s — falling all the way round, and never hitting the ground.`,
      score: clamp(Math.round(60 + b.fuelFrac * 90 + round * 12), 60, 100),
      keepFlying: true,
    });
  }

  /**
   * The booster's trip home, flown by its computer: flip, burn back, flip
   * engine-down, fall. The child gets it at HANDOVER metres.
   */
  returnStep(b, dt) {
    const since = this.t - this.flags.returnStart;
    const tgt = this.target();
    if (!this.flags.flip && since > 1.2) {
      this.flags.flip = true;
      // Which way it has to push, and how hard: a quick look ahead.
      const want = aimAlong(b, tgt.s, { cd: b.cd, groundAt: (s) => this.site.surface(s).y });
      this.flags.aimAlong = want;
      const lv = b.localVel(LV);
      this.flags.boostDir = want < lv.along ? -1 : 1;
      this.flags.boostFrom = lv.along;
      this.emit('boostback');
    }
    let rate = 0;
    let throttle = 0;
    if (this.flags.flip && !this.flags.boostDone) {
      const aim = this.flags.boostDir * 80 * DEG;
      rate = clamp((aim - b.tilt) * 2.5, -0.9, 0.9);
      const lined = Math.abs(aim - b.tilt) < 8 * DEG;
      if (lined && !this.flags.boostback) {
        // Aim again now it is pointing the right way — the flip took a few
        // seconds of falling, and those moved where it would come down.
        this.flags.aimAlong = aimAlong(b, tgt.s, { cd: b.cd, groundAt: (s) => this.site.surface(s).y });
        this.flags.boostFrom = b.localVel(LV).along;
      }
      if (lined) {
        this.flags.boostback = (this.flags.boostback || 0) + dt;
        b.engineOn = true;
        throttle = 1;
        // The boostback is given, not earned: it moves the path onto the
        // target over three seconds and spends a third of the fuel kept for
        // landing, whatever the climb was like. A child who leaned too far
        // on the way up should still get a booster to land.
        const k = Math.min(1, this.flags.boostback / 3);
        setAlong(b, this.flags.boostFrom + (this.flags.aimAlong - this.flags.boostFrom) * k);
        const s = b.stage;
        if (s) s.fuelLeft = Math.max(0, s.fuelLeft - (s.fuel * (s.reserve || 0.15) * 0.34 * dt) / 3);
        if (k >= 1) {
          this.flags.boostDone = true;
          b.engineOn = false;
          this.emit('boostback-done');
        }
      }
    } else if (this.flags.boostDone) {
      // Engine-down and let the fins and the air do the rest.
      rate = clamp(-b.tilt * 2, -0.8, 0.8);
      // Keep it honest on the way down: re-aim with the fins every so often.
      if (!this.flags.lastAim || this.t - this.flags.lastAim > 4) {
        this.flags.lastAim = this.t;
        this.flags.predict = predictImpact(b, { cd: b.cd, groundAt: (s) => this.site.surface(s).y, dt: 0.5 });
      }
    }
    // The thrust from the burn is written straight into the velocity above,
    // so the step itself is flown engine-off.
    stepBody(b, dt, { throttle: 0, tiltRate: rate });
    b.throttle = throttle;
    this.afterStep(b);
    if (this.result) return;
    if (this.flags.boostDone && b.alt < HANDOVER && b.localVel(LV).up < 0) {
      this.phase = 'landing';
      // Kept, so "Try the landing again" starts right here and not on the pad.
      this.handover = this.snapshot();
      this.emit('your-turn');
    }
  }

  /** The child's landing. */
  landingStep(b, dt) {
    const input = this.input;
    const deck = this.site.surface(b.downrange).y;
    const above = b.alt - deck;
    if (input.lean) this.flags.steered = true;
    const aim = this.helper ? this.helperLean(b, above) : clamp(input.lean, -1, 1) * LAND_LEAN;
    const rate = clamp((aim - b.tilt) * 3, -0.8, 0.8);
    let throttle = 0;
    if (input.burn && b.stage && b.stage.fuelLeft > 0) {
      b.engineOn = true;
      throttle = this.helper ? landingThrottle(b, above) : 1;
    } else {
      b.engineOn = false;
    }
    if (!this.flags.legs && above < 900) {
      this.flags.legs = true;
      b.legs = true;
      this.emit('legs');
    }
    if (!this.flags.noFuel && b.stage && b.stage.fuelLeft <= 0) {
      this.flags.noFuel = true;
      this.emit('no-fuel');
    }
    stepBody(b, dt, { throttle, tiltRate: rate, fins: b.tilt / LAND_LEAN });
    // The wind down low, pushing it along the ground: never the same twice,
    // and the reason the child has to steer even when the computer aimed
    // the boostback perfectly.
    if (above > 30) {
      const w = crosswind(this.t, this.seed) * Math.min(1, b.q / 8000);
      const f = b.frame(FR);
      b.vel.x += f.ax * w * dt;
      b.vel.y += f.ay * w * dt;
    }
    this.afterStep(b);
  }

  /**
   * The slide the helper is flying for, from what is held (see the note on
   * LAND_LEAN): m/s along the ground, + is ▶.
   */
  slideWant(b, above) {
    const lean = clamp(this.input.lean || 0, -1, 1);
    if (!lean) return 0;
    const dir = Math.sign(lean);
    const cap = slideLimit(above) * Math.abs(lean);
    const tgt = this.target();
    if (!tgt) return dir * cap;
    // Metres to the target in the way the child is pushing: past it by a
    // little still counts as "there", so a key held a moment too long holds
    // it over the target instead of sending it off the other side.
    const ahead = (tgt.s - b.downrange) * dir;
    if (ahead < -25) return dir * cap;
    return dir * Math.min(cap, Math.sqrt(2 * GLIDE_BRAKE * Math.max(0, ahead - OVER_IT)));
  }

  /**
   * The lean the helper picks to fly that slide — never more than is safe
   * this near the deck. It works in pushes, not degrees: how hard it wants
   * to change the slide, plus whatever the wind is doing right now, divided
   * by how hard one radian of lean pushes at this speed (the fins in the
   * fast air, the engine once it is lit). So it answers the same way high
   * and fast or low and slow, and a steady wind does not leave it drifting.
   */
  helperLean(b, above) {
    const along = b.localVel(LV).along;
    const most = LAND_LEAN * clamp(above / 60, 0.25, 1);
    const want = this.slideWant(b, above);
    const area = Math.PI * b.radius * b.radius;
    const perRad = ((b.q * area * 0.55) / LAND_LEAN + (b.lastThrust || 0)) / b.mass;
    if (perRad < 0.4) return clamp((want - along) * LEAN_GAIN, -most, most);
    const wind = above > 30 ? crosswind(this.t, this.seed) * Math.min(1, b.q / 8000) : 0;
    const push = (want - along) * SLIDE_RESPONSE - wind;
    return clamp(push / perRad, -most, most);
  }

  /**
   * The landing card, as numbers — the same ones the objective line reads,
   * so the HUD and the tests see exactly what the child sees.
   */
  landingInfo() {
    const b = this.focus;
    const tgt = this.target();
    const lv = b.localVel(LV);
    const deck = this.site.surface(b.downrange).y;
    const above = b.alt - deck;
    const dist = tgt ? tgt.s - b.downrange : 0;
    const down = -lv.up;
    const slide = lv.along;
    const over = Math.abs(dist) < OVER_CARD;
    let slideTone = 'good';
    if (Math.abs(slide) >= 1.5) {
      const towards = !over && Math.sign(slide) === Math.sign(dist);
      if (above < 60 && Math.abs(slide) > SOFT.side) slideTone = 'bad';
      else if (!towards) slideTone = 'warn';
    }
    return {
      dist,
      over,
      slide,
      slideTone,
      down,
      above,
      burning: b.throttle > 0,
      holding: !!this.input.burn,
      need: !this.input.burn && above < 2600 && down > 40,
      helper: this.helper,
    };
  }

  /**
   * Everything that is flying, copied: taken at the handover, so the child
   * can have the landing again without flying the whole climb again. The
   * wind is a function of the clock and the mission, so the same moment
   * comes back with the same wind.
   */
  snapshot() {
    const at = (x) => (x ? this.bodies.indexOf(x) : -1);
    return copyData({
      t: this.t,
      met: this.met,
      phase: this.phase,
      flags: this.flags,
      upperBest: this.upperBest,
      maxQ: this.maxQ,
      bodies: this.bodies.map((b) => ({ ...b })),
      focus: at(this.focus),
      booster: at(this.booster),
      upper: at(this.upper),
      satellite: at(this.satellite),
    });
  }

  /** Put the flight back to a snapshot() — "Try the landing again". */
  resumeFrom(snap) {
    const s = copyData(snap);
    this.t = s.t;
    this.met = s.met;
    this.phase = s.phase;
    this.flags = s.flags;
    this.upperBest = s.upperBest;
    this.maxQ = s.maxQ;
    this.bodies = s.bodies.map((o) => Object.assign(Object.create(Body.prototype), o));
    const at = (i) => (i >= 0 ? this.bodies[i] : null);
    this.focus = at(s.focus);
    this.booster = at(s.booster);
    this.upper = at(s.upper);
    this.satellite = at(s.satellite);
    // The whole stack came apart long before the handover.
    this.stack = null;
    this.result = null;
    this.events = [];
    this.input = { lean: 0, action: false, burn: false };
    this.handover = snap;
    this.again = (this.again || 0) + 1;
    this.emit('your-turn', { again: true });
    return this;
  }

  /** Ground and water, for whatever is being flown. */
  afterStep(b) {
    const lv = b.localVel(LV);
    if (lv.up >= 0) return;
    const surf = this.site.surface(b.downrange);
    if (b.alt > surf.y) return;
    // Down.
    b.pos.x *= (PLANET.R + surf.y) / b.r;
    b.pos.y *= (PLANET.R + surf.y) / b.r;
    const down = -lv.up;
    const side = Math.abs(lv.along);
    const upright = Math.abs(b.tilt);
    b.vel.x = 0;
    b.vel.y = 0;
    b.engineOn = false;
    b.throttle = 0;
    const tgt = this.target();
    const landing = this.phase === 'landing' || this.phase === 'return';
    if (surf.kind === 'sea') {
      b.crashed = true;
      this.emit('splash', { kind: surf.kind });
      const miss = tgt ? Math.round(Math.abs(b.downrange - tgt.s)) : 0;
      const dir = tgt && b.downrange < tgt.s ? 'short of' : 'past';
      this.lose(
        'Splash!',
        landing && tgt
          ? `The booster came down in the sea, ${miss.toLocaleString('en-GB')} m ${dir} the ${tgt.name}. ${this.steerTip(tgt)}`
          : 'It came down in the sea. Keep it pointing up until the green wedge tells you to lean.'
      );
      return;
    }
    const soft = down <= SOFT.down && side <= SOFT.side && upright <= SOFT.tilt;
    if (!landing) {
      b.crashed = true;
      this.emit('crash');
      this.lose('Came down', 'It leaned over too far and came back down. Keep it on the green wedge.');
      return;
    }
    const onTarget = tgt && surf.kind === tgt.kind;
    const miss = tgt ? Math.abs(b.downrange - tgt.s) : 0;
    if (!soft) {
      b.crashed = true;
      this.emit('crash');
      const slideDir = lv.along > 0 ? '▶' : '◀';
      const other = lv.along > 0 ? '◀' : '▶';
      const why = down > SOFT.down
        ? `It hit at ${Math.round(down)} m/s — hold SPACE sooner so the engine can slow it to a gentle ${SOFT.down} m/s.`
        : upright > SOFT.tilt
          ? 'It touched down leaning and tipped over. Let go of ◀ ▶ just before it lands so it stands up straight.'
          : this.helper
            ? `It was still sliding ${slideDir} at ${Math.round(side)} m/s. Let go of ◀ ▶ sooner — the helper leans the other way to stop the slide.`
            : `It was still sliding ${slideDir} at ${Math.round(side)} m/s. Lean the other way (${other}) to stop sliding — watch the Sliding arrow.`;
      this.lose('Too hard!', why);
      return;
    }
    b.landed = true;
    this.emit('touchdown', { kind: surf.kind });
    if (!onTarget) {
      this.lose(
        'Down safely — but not on it',
        `A perfect gentle landing, ${Math.round(miss).toLocaleString('en-GB')} m from the ${tgt ? tgt.name : 'target'}. ${tgt ? this.steerTip(tgt) : ''}`.trim(),
        { soft: true }
      );
      return;
    }
    const fuel = b.stage ? b.stage.fuelLeft / (b.stage.fuel * (b.stage.reserve || 0.15)) : 0;
    const score = clamp(Math.round(100 - miss * 1.2 - down * 3 - side * 3 - (upright / DEG) * 0.8 + fuel * 8), 40, 100);
    const upperNote = this.upper && this.upper.maxAlt >= PLANET.SPACE
      ? ` And the upper stage flew itself on to ${km(this.upper.maxAlt)}.`
      : '';
    this.win({
      title: tgt.kind === 'barge' ? 'Landed on the ship!' : 'Landed on the pad!',
      reason: `Touchdown at ${down.toFixed(1)} m/s, ${Math.round(miss)} m from the middle.${upperNote}`,
      score,
    });
  }

  /** How to get over the target next time, for the way this landing is flown. */
  steerTip(tgt) {
    if (!this.helper) return `Lean ◀ ▶ sooner to steer over the ${tgt.name}, and lean the other way to stop sliding.`;
    return this.flags.steered
      ? 'Keep holding ◀ or ▶ the way the card points until it says Right over it — and start as soon as it is your turn.'
      : 'Hold ◀ or ▶ the way the card points to glide over it, and let go when it says Right over it.';
  }

  /** Everything the child is not flying. */
  stepOther(b, dt) {
    if (b.goneAt && this.t > b.goneAt) {
      b.gone = true;
      return;
    }
    if (b.auto === true) {
      // The upper stage in a landing mission, flying itself to space.
      const target = guideTilt(this.goal, b);
      const rate = clamp((target - b.tilt) * 2, -TILT_RATE, TILT_RATE);
      stepBody(b, dt, { throttle: b.usableFuel > 0 ? 1 : 0, tiltRate: rate });
      if (b.maxAlt > this.upperBest) this.upperBest = b.maxAlt;
      if (!this.flags.upperSpace && b.alt >= PLANET.SPACE) {
        this.flags.upperSpace = true;
        this.emit('upper-space');
      }
      if (b.alt > 400000 || (b.localVel(LV).up < 0 && b.alt < 20000)) b.gone = true;
      return;
    }
    stepBody(b, dt, { throttle: 0, tiltRate: b.role === 'fairing' ? (b.side || 1) * 0.6 : 0 });
    const surf = this.site.surface(b.downrange);
    if (b.alt < surf.y) b.gone = true;
  }

  win({ title, reason, score, keepFlying = false }) {
    if (this.result) return;
    this.result = { success: true, title, reason, score, time: this.met, goal: this.goal, rocket: this.def.id };
    if (!keepFlying) this.phase = 'done';
    this.emit('success');
  }

  lose(title, reason, extra = {}) {
    if (this.result) return;
    this.result = { success: false, title, reason, score: 0, time: this.met, goal: this.goal, rocket: this.def.id, ...extra };
    this.phase = 'done';
    this.emit('fail');
  }

  /**
   * What to do right now, in one line — see the header.
   * `tone` is 'go' (do this), 'warn' (do this NOW), 'info' (watch), 'good'.
   */
  objective() {
    const b = this.focus;
    const p = this.phase;
    const goal = GOALS[this.goal];
    if (this.result) {
      return { title: this.result.title, text: this.result.reason, tone: this.result.success ? 'good' : 'warn' };
    }
    if (p === 'pad') {
      return { title: `${this.def.name} · ${goal.name}`, text: 'Ready on the pad. Press SPACE — or tap LAUNCH — to start the countdown.', tone: 'go' };
    }
    if (p === 'countdown') {
      return { title: 'Countdown', text: `Hands off — lift-off in ${Math.max(1, Math.ceil(this.countdown))}…`, tone: 'info' };
    }
    if (this.flags.stageWaiting) {
      return b.fuelFloor > 0
        ? { title: 'Drop the booster', text: 'The booster has saved its landing fuel. Press SPACE to let it go!', tone: 'warn' }
        : { title: 'Drop the booster', text: 'This stage is empty. Press SPACE to drop it!', tone: 'warn' };
    }
    if (p === 'ascent') {
      const lean = this.leanWord();
      if (this.flags.space && this.goal === 'space') {
        return { title: 'You are in space!', text: 'Above 100 km. Look down: the island, and the curve of the planet.', tone: 'good' };
      }
      if (this.goal === 'space') {
        if (this.flags.burnout) return { title: 'Coasting up', text: `Engine done — it is still flying up. ${km(Math.max(0, PLANET.SPACE - b.alt))} to space.`, tone: 'info' };
        return { title: 'Fly to space', text: `${lean} ${km(Math.max(0, PLANET.SPACE - b.alt))} to go.`, tone: lean.startsWith('Lean') ? 'go' : 'info' };
      }
      if (this.goal === 'orbit') {
        return { title: 'Climb and turn', text: `${lean} The engine stops by itself when the top of your path reaches 110 km.`, tone: lean.startsWith('Lean') ? 'go' : 'info' };
      }
      return { title: 'Climb', text: `${lean} The booster keeps its landing fuel — you will drop it soon.`, tone: lean.startsWith('Lean') ? 'go' : 'info' };
    }
    if (p === 'coast') {
      const tt = Math.round(timeToTop(b));
      if (this.flags.firePrompt || tt <= 0) return { title: 'Fire the engine!', text: 'You are at the top. Press SPACE now, and keep it flat!', tone: 'warn' };
      const flat = Math.abs(b.tilt / DEG - 90) < 12;
      return {
        title: 'Coast to the top',
        // Past flat (more than 90°) it has to come back the other way.
        text: `${flat ? 'Flat — ready.' : b.tilt / DEG > 90 ? 'Lean ◀ back until it is flat (90°).' : 'Lean ▶ until it is flat (90°).'} Fire again at the top, in ${clock(tt)}.`,
        tone: flat ? 'info' : 'go',
      };
    }
    if (p === 'circ') {
      const v = Math.round(sideways(b));
      const need = Math.round(circularSpeed(b.r));
      return { title: 'Go fast sideways', text: `Keep it flat on the wedge — ${v.toLocaleString('en-GB')} of ${need.toLocaleString('en-GB')} m/s sideways.`, tone: 'go' };
    }
    if (p === 'orbit') {
      return { title: 'You are in orbit!', text: 'Press SPACE to let the satellite go.', tone: 'warn' };
    }
    if (p === 'return') {
      if (!this.flags.boostDone) return { title: 'Booster turning for home', text: 'The booster flips round and fires to head back. Watch — you land it next.', tone: 'info' };
      const t = this.flags.predict ? Math.max(0, Math.round(this.flags.predict.t - (this.t - this.flags.lastAim))) : null;
      return { title: 'Booster falling home', text: `Your turn at ${km(HANDOVER)} up${t ? ` — about ${clock(Math.max(0, t - 20))} away` : ''}. Press ⏩ to speed up.`, tone: 'info' };
    }
    if (p === 'landing') {
      const tgt = this.target();
      const L = this.landingInfo();
      const d = Math.round(L.dist);
      const dir = L.over ? 'right over it' : d > 0 ? `${d.toLocaleString('en-GB')} m ▶` : `◀ ${(-d).toLocaleString('en-GB')} m`;
      const key = d > 0 ? '▶' : '◀';
      if (b.stage && b.stage.fuelLeft <= 0) return { title: 'Out of fuel!', text: 'No fuel left to slow down with.', tone: 'warn' };
      if (L.need) {
        return { title: 'Hold SPACE!', text: `Hold SPACE to fire the engine and slow down. The ${tgt.name}: ${dir}.`, tone: 'warn' };
      }
      if (this.helper) {
        if (L.over) {
          return { title: `Right over the ${tgt.name}`, text: 'Let go of ◀ ▶ — the helper stops the slide and keeps it here. Hold SPACE to slow down.', tone: 'good' };
        }
        return {
          title: `Land on the ${tgt.name}`,
          text: `Hold ${key} to glide over it (${dir}) — it stops by itself when it gets there. Hold SPACE to slow down.`,
          tone: 'go',
        };
      }
      // No helper: the child's own lean. Stopping a slide is leaning against it.
      const sliding = Math.abs(L.slide) >= 3 && (L.over || Math.sign(L.slide) !== Math.sign(L.dist));
      if (sliding) {
        return { title: 'Stop the slide', text: `Sliding ${L.slide > 0 ? '▶' : '◀'} — lean the other way (${L.slide > 0 ? '◀' : '▶'}) to stop it. The ${tgt.name}: ${dir}.`, tone: 'warn' };
      }
      return {
        title: `Land on the ${tgt.name}`,
        text: `Lean ◀ ▶ to get over it (${dir}); lean the other way to stop. Hold SPACE to fire the engine.`,
        tone: 'go',
      };
    }
    return { title: goal.name, text: goal.line, tone: 'info' };
  }

  /** "Lean ▶ a little", "On the wedge — hold it there". */
  leanWord() {
    const b = this.focus;
    const want = this.guide();
    const err = (want - b.tilt) / DEG;
    if (Math.abs(err) < 5) return 'On the green — hold it there.';
    const how = Math.abs(err) > 20 ? 'more' : 'a little';
    return err > 0 ? `Lean ▶ ${how}.` : `Lean ◀ ${how}.`;
  }

  /** The green wedge, for whatever is being flown now. */
  guide() {
    const b = this.focus;
    if (this.phase === 'coast') return 90 * DEG;
    if (this.phase === 'landing' || this.phase === 'return') return 0;
    return guideTilt(this.goal, b, { circularising: this.phase === 'circ' || this.phase === 'orbit' });
  }
}

const LV = {};
const FR = {};

function gust(t) {
  return (Math.sin(t * 0.9) + 0.6 * Math.sin(t * 2.3 + 1) + 0.4 * Math.sin(t * 0.37 + 2)) * 0.028;
}

function crosswind(t, seed) {
  return (Math.sin(t * 0.13 + seed) + 0.6 * Math.sin(t * 0.37 + seed * 2.1)) * 1.6;
}

function seedOf(str) {
  let h = 7;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 100003;
  return (h % 628) / 100;
}

/** A deep copy of plain data — numbers, strings, flags, arrays, objects. */
function copyData(v) {
  if (Array.isArray(v)) return v.map(copyData);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = copyData(v[k]);
    return o;
  }
  return v;
}

export function sideways(b) {
  return Math.abs(b.localVel(LV).along);
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function km(m) {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function clock(s) {
  s = Math.max(0, Math.round(s));
  const m = Math.floor(s / 60);
  return m ? `${m}:${String(s % 60).padStart(2, '0')}` : `${s} s`;
}

/**
 * A pilot for the tests (and for the dev-mode "watch the robot fly it").
 *
 * `sloppy` adds a slow wobble to the lean it holds; `lazyLanding` never
 * steers the booster; `noBurn` never holds SPACE; `late` fires the orbit's
 * second burn that many seconds after the top.
 */
export function robotInput(flight, { sloppy = 0, lazyLanding = false, noBurn = false, late = 0, leanOver = 0 } = {}) {
  const f = flight;
  const b = f.focus;
  const input = f.input;
  input.action = false;
  input.burn = false;
  input.lean = 0;
  if (f.result) return;
  const p = f.phase;
  if (p === 'pad') {
    input.action = true;
    return;
  }
  if (p === 'countdown') return;
  if (f.flags.stageWaiting && f.t - f.flags.stageSince > 0.8) {
    input.action = true;
    return;
  }
  if (p === 'ascent' || p === 'coast' || p === 'circ' || p === 'orbit') {
    const want = f.guide() + (leanOver * DEG) + sloppy * Math.sin(f.t * 0.6) * DEG;
    input.lean = clamp(((want - b.tilt) / DEG) * 0.25, -1, 1);
    if (p === 'coast') {
      const tt = timeToTop(b);
      if (late > 0 ? tt <= 0 && (f.flags.pastTop = (f.flags.pastTop || f.t)) && f.t - f.flags.pastTop >= late : tt < 8) input.action = true;
    }
    if (p === 'orbit') input.action = true;
    return;
  }
  if (p === 'landing') {
    if (!noBurn) input.burn = true;
    if (lazyLanding) return;
    const tgt = f.target();
    const ds = tgt.s - b.downrange;
    if (f.helper) {
      // With the helper, the robot flies it the way a child does: hold the
      // way the card points, let go when it is over it.
      input.lean = Math.abs(ds) >= OVER_CARD ? Math.sign(ds) : 0;
      return;
    }
    const lv = b.localVel(LV);
    const deck = f.site.surface(b.downrange).y;
    const above = b.alt - deck;
    const wantV = above < 60 ? clamp(ds * 0.3, -3, 3) : clamp(ds * 0.16, -70, 70);
    input.lean = clamp((wantV - lv.along) * 0.18, -1, 1);
    // Stand it up for the last few metres.
    if (above < 12) input.lean *= 0.3;
  }
}

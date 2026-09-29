/**
 * Flight events: things that can happen to a flight that nobody planned.
 *
 * 1. THE HIJACK (long-haul airliners, one Free Flight in ten). Two versions,
 *    because the kid who owns the game asked for two: "let hijacking be bad,
 *    but the more realistic one is behind a code". The film version is for
 *    everybody; the by-the-book one needs the Dev passcode. Both live in
 *    ./events/hijack.js, which says what is in them and what is not.
 *
 * 2. THE PIZZA CAR (any flight at a field with room for it, one in six).
 *    A lost pizza delivery driver goes through the perimeter fence and does
 *    donuts on the runway. The airport police chase him back out through the
 *    hole, sirens going, while the tower holds you: "hold position" if you are
 *    on the ground, "go around" if you are on the way in. Funny, not scary.
 *
 * All of them run on their own in Free Flight, can be forced from the Dev
 * panel, and have a guaranteed version as a mission (src/game/extra/events.js),
 * which drives them through forceHijack / forceBreakIn and reads their
 * progress back from hijackInfo / breakInInfo — through ./events/bridge.js,
 * which this file fills in, so that leaving this file out of
 * src/features/index.js really does turn all of it off.
 *
 * None ever runs during a mission's critical step. The hijack only happens
 * in Free Flight (a mission already has a story); the pizza car only happens
 * in a mission while you are still sitting on the runway at the very start of
 * it, and never in a mission with a clock.
 *
 * Keys, and only while the story that wants them is on: 7 squawks 7500; 8, 9
 * and 0 answer the question on the card when there is one; C hands the
 * camera back while the police are going in.
 *
 * Sound is procedural and quiet (./events/sfx.js). Radio calls go through
 * sim.speak(), which honours the player's own voice setting — the default is
 * the game's formant radio chatter with subtitles, never text-to-speech.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extStatus } from '../game/extensions.js';
import { heightAt } from '../world/terrain.js';
import { createPizzaCar, flashPolice, buildFence } from './events/vehicles.js';
import * as SFX from './events/sfx.js';
import * as UI from './events/ui.js';
import {
  RUNWAY, FT, typeOf, callsign, field, runwayWords, longHaulId, cruiseSpeed, idleHeld, speak, notify, banner, flat,
  RW, runwayFrame, rw, after, runBeats, objective, restoreObjective, addPolice, removePolice, registerVoices,
} from './events/common.js';
import * as HJ from './events/hijack.js';
import { BRIDGE } from './events/bridge.js';
// The goofy missions' prop cleanup registers itself from here too, so it is
// in place even if nothing else imports it first.
import './events/props.js';

export { longHaulId };
export { squawk, hijackInfo, devOpen, answerChoice, TALK_LINES } from './events/hijack.js';

/** How often each one happens on its own. Exported so the tests can see them. */
export const ODDS = { hijack: 0.1, breakin: 1 / 6 };

const TMP = new THREE.Vector3();

/** Where the fence runs, to the right of the runway (the side away from the terminal at Kestrel). */
const FENCE_V = 140;

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */

const S = {
  sim: null,
  t: 0,
  frames: 0,
  fence: null,
  /** Whether this field has room for a break-in: flat along the fence, dry beyond it. */
  breakInOk: false,
};

function freshBreakIn() {
  return {
    phase: 'idle', // idle | armed | run | exit | clear | done
    owner: null,
    t: 0,
    phaseT: 0,
    window: null, // 'free' | 'mission'
    car: null,
    carPos: new THREE.Vector3(),
    carPrev: new THREE.Vector3(),
    carHeading: 0,
    carSpeed: 0,
    curve: null,
    len: 0,
    s: 0,
    sBreachIn: 0,
    sBreachOut: 0,
    breach: new THREE.Vector3(),
    police: [],
    base: [],
    parkSpots: [],
    siren: null,
    ground: true,
    holdPos: new THREE.Vector3(),
    warned: false,
    landedWarned: false,
    knocked: false,
    honkT: 0,
    beats: [],
    homeT: 0,
  };
}

let B = freshBreakIn();

/*
 * How the police drive, as fixed objects: Driver.driveTo takes an options
 * object, and a fresh literal per car per frame is exactly the allocation the
 * hot path is not allowed.
 */
const DRIVE_PARK = { maxSpeed: 18, stopAt: 3 };
const DRIVE_IDLE = { maxSpeed: 12, stopAt: 3 };
const DRIVE_BACK = { maxSpeed: 14, stopAt: 3 };
const DRIVE_CHASE = { maxSpeed: 21, accel: 7, stopAt: 6, matchSpeed: 0 };

/* ================================================================== *
 * 1. THE HIJACK — see ./events/hijack.js
 * ================================================================== */

/**
 * Begin a hijack now. `version` is 'film' (everybody) or 'real' (the
 * by-the-book one, behind the Dev passcode — the caller checks the code,
 * because a mission or a test may start it on purpose).
 */
export function forceHijack(sim, { owner = 'dev', version = 'film' } = {}) {
  sim = sim || S.sim;
  if (!sim) return false;
  S.sim = sim;
  /*
   * A pizza car the dice armed for this flight must not turn up in the
   * middle of a hijack. The Dev button starts a fresh Free Flight and then
   * the hijack, and that fresh flight rolls the break-in dice like any
   * other: one time in six the car drove through the fence while you were
   * on final with two fighters and a hijacker.
   */
  if (B.phase === 'armed') B.phase = 'idle';
  return HJ.forceHijack(sim, { owner, version });
}

/* ================================================================== *
 * 2. THE PIZZA CAR
 * ================================================================== */

/**
 * The car's route, in the runway's frame (u along it, v to the right),
 * scaled by the runway's length. In through the fence, onto the runway, a
 * run along it, a donut, back the way it came and out through the same hole.
 */
function routePoints(L) {
  /*
   * Short on purpose. The first route was 1,750 m and the hold it caused ran
   * two minutes, measured — far longer than anybody sitting still on a
   * runway will put up with. This one is about 1,100 m, which at the car's
   * speeds is a hold of just over a minute: long enough to watch the chase,
   * short enough to still be funny when it ends.
   */
  const pts = [
    [-0.23 * L, 300], [-0.2 * L, 225], [-0.155 * L, FENCE_V], [-0.1 * L, 48],
    [-0.05 * L, 4], [0.04 * L, -3],
  ];
  // The donut: a lap round a point on the runway.
  const cx = 0.13 * L;
  for (let i = 0; i <= 8; i++) {
    const a = -Math.PI / 2 + (i / 8) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * 24 - 24, Math.sin(a) * 24 + 24]);
  }
  pts.push([0.02 * L, 9], [-0.08 * L, 30], [-0.155 * L, FENCE_V], [-0.19 * L, 230], [-0.22 * L, 320]);
  return pts;
}

/** Can this field hold the story? Flat along the fence, dry where the car starts and ends. */
function breakInSite() {
  runwayFrame();
  const elev = RW.c.y;
  for (let u = -RW.L / 2 - 80; u <= RW.L / 2 + 80; u += 40) {
    const h = rw(u, FENCE_V, TMP).y;
    if (h < elev - 4 || h > elev + 14) return false;
  }
  for (const [u, v] of [[-0.23 * RW.L, 300], [-0.22 * RW.L, 320], [-0.2 * RW.L, 225]]) {
    if (rw(u, v, TMP).y < 1) return false;
  }
  return true;
}

export function forceBreakIn(sim, { owner = 'dev' } = {}) {
  sim = sim || S.sim;
  if (!sim) return false;
  S.sim = sim;
  resetBreakIn(sim);
  B.owner = owner;
  startBreakIn(sim);
  return true;
}

function startBreakIn(sim) {
  runwayFrame();
  B.phase = 'run';
  B.phaseT = 0;
  const pts = routePoints(RW.L).map(([u, v]) => rw(u, v));
  B.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  B.len = B.curve.getLength();
  // Find where along the route the two passes through the fence are.
  const N = 300;
  let bestIn = Infinity;
  let bestOut = Infinity;
  rw(-0.155 * RW.L, FENCE_V, B.breach);
  for (let i = 0; i <= N; i++) {
    B.curve.getPointAt(i / N, TMP);
    const d = flat(TMP, B.breach);
    const s = (i / N) * B.len;
    if (i < N / 2 && d < bestIn) { bestIn = d; B.sBreachIn = s; }
    if (i >= N / 2 && d < bestOut) { bestOut = d; B.sBreachOut = s; }
  }
  B.s = 0;
  B.carSpeed = 15;
  B.car = createPizzaCar();
  sim.scene.add(B.car);
  B.curve.getPointAt(0, B.carPos);
  B.carPrev.copy(B.carPos);
  B.car.position.copy(B.carPos);
  // Police wait at the far end of the taxiway and set off a moment later.
  removePolice(sim, B.police);
  B.base = [rw(-RW.L * 0.25, -95), rw(-RW.L * 0.25 - 18, -95)];
  addPolice(sim, B.police, B.base[0].x, B.base[0].z, RUNWAY.headingDeg ?? 90);
  addPolice(sim, B.police, B.base[1].x, B.base[1].z, RUNWAY.headingDeg ?? 90);
  B.parkSpots = [
    new THREE.Vector3().copy(B.breach).addScaledVector(RW.r, -14).addScaledVector(RW.f, -8),
    new THREE.Vector3().copy(B.breach).addScaledVector(RW.r, -14).addScaledVector(RW.f, 8),
  ];
  if (B.siren) B.siren.stop();
  B.siren = new SFX.Loop(sim, 'wail', 0.06);
  B.knocked = false;
  B.warned = false;
  B.landedWarned = false;
  B.honkT = 2;

  // What the tower tells you depends on where you are.
  const ac = sim.aircraft;
  const cs = callsign(sim);
  B.ground = ac.onGround;
  B.holdPos.copy(ac.pos);
  if (B.ground) {
    speak(sim, `${cs}, ${field()} Tower, hold position. There is a car on the runway. I say again, hold position.`, 'tower', 1);
    banner(sim, 'Hold position', 'A car is on the runway — power off and stay still', 'bad', 5);
    objective(sim, B, 'Hold position', B.window === 'mission'
      ? 'A car has got onto the runway. Power off and keep still until the tower says it is clear — then your mission carries on. Rolling? Hold Space.'
      : 'A car has got onto the runway. Power off and keep still until the tower says it is clear. Rolling? Hold Space.');
  } else {
    speak(sim, `${cs}, ${field()} Tower, go around. There is a car on the runway. Climb and circle the field, I will call you when it is clear.`, 'tower', 1);
    banner(sim, 'Go around', 'A car is on the runway — climb away and circle the field', 'bad', 5);
    objective(sim, B, 'Runway closed', 'Do not land! Climb away and circle the airfield until the tower says the runway is clear.');
  }
  UI.showCard(sim, {
    who: `${field()} Tower`,
    tone: 'warn',
    text: B.ground
      ? 'A little pink car has driven through the fence and is on the runway! The airport police are on their way. Hold position until it is clear.'
      : 'A little pink car has driven through the fence and is on the runway! Go around and circle the airfield while the police chase it off.',
  });
  after(B, 9, (s) => {
    if (B.phase !== 'run') return;
    UI.showCard(s, {
      who: `${field()} Tower`,
      tone: 'warn',
      text: 'It is a pizza delivery car. It is doing DONUTS on the runway. The police are chasing it now — keep holding.',
    });
  });
}

function carDrive(sim, dt) {
  // Slower round the donut, faster on the straights, like somebody showing off.
  const u = B.s / B.len;
  B.carSpeed = u > 0.38 && u < 0.62 ? 12 : 18;
  B.s = Math.min(B.len, B.s + B.carSpeed * dt);
  B.carPrev.copy(B.carPos);
  B.curve.getPointAt(B.s / B.len, B.carPos);
  B.carPos.y = heightAt(B.carPos.x, B.carPos.z);
  const dx = B.carPos.x - B.carPrev.x;
  const dz = B.carPos.z - B.carPrev.z;
  if (dx * dx + dz * dz > 1e-6) B.carHeading = Math.atan2(dx, -dz);
  B.car.position.copy(B.carPos);
  B.car.rotation.set(0, -B.carHeading, Math.sin(B.t * 9) * 0.03);
  // The pizza wobbles, because it is not very well tied on.
  if (B.car.userData.pizza) B.car.userData.pizza.rotation.z = Math.sin(B.t * 6) * 0.08;
  // Through the fence.
  if (!B.knocked && B.s >= B.sBreachIn - 3) {
    B.knocked = true;
    if (S.fence) S.fence.knockDown(B.carPrev);
    SFX.pop(sim);
  }
  B.honkT -= dt;
  if (B.honkT <= 0) {
    B.honkT = 5 + Math.random() * 4;
    const d = sim.camera ? sim.camera.position.distanceTo(B.carPos) : 1000;
    SFX.honk(sim, SFX.falloff(d, 60, 900));
  }
}

function updateBreakIn(sim, dt) {
  if (B.phase === 'idle') return;
  const ac = sim.aircraft;
  B.t += dt;
  B.phaseT += dt;
  runBeats(B, sim);

  if (B.phase === 'armed') {
    tryTriggerBreakIn(sim, dt);
    return;
  }

  /*
   * In somebody else's mission the hold is not the child's time to lose: the
   * runner's time bonus counts elapsed seconds against the par, and a car
   * doing donuts for seventy of them would come off the score. So the
   * mission's clock stands still from the car's arrival to the all-clear,
   * for as long as you are still on the ground: somebody who takes off
   * anyway is flying the mission, and their clock runs. (Only untimed
   * missions ever get the car, so no deadline moves.)
   */
  if (B.window === 'mission' && B.phase !== 'done' && sim.aircraft && sim.aircraft.onGround) {
    const r = sim.runner;
    if (r && r.status === 'running' && Number.isFinite(r.elapsed)) r.elapsed = Math.max(0, r.elapsed - dt);
  }

  if (B.phase === 'run' || B.phase === 'exit') {
    if (B.car) carDrive(sim, dt);
    // The police: hold for a moment, then chase — each aiming at a point
    // just behind the car, one either side, so they do not drive through
    // each other. Once it is heading out, they stop at the hole.
    const chasing = B.phase === 'run' && B.phaseT > 3;
    const hx = Math.sin(B.carHeading);
    const hz = -Math.cos(B.carHeading);
    DRIVE_CHASE.matchSpeed = B.carSpeed;
    for (let i = 0; i < B.police.length; i++) {
      const d = B.police[i];
      if (B.phase === 'exit') {
        const p = B.parkSpots[i] || B.parkSpots[0];
        d.driveTo(p.x, p.z, dt, DRIVE_PARK);
      } else if (chasing) {
        const back = 10 + i * 5;
        const side = i === 0 ? -4 : 4;
        const tx = B.carPos.x - hx * back + hz * -side;
        const tz = B.carPos.z - hz * back + hx * side;
        d.driveTo(tx, tz, dt, DRIVE_CHASE);
      }
    }
    if (B.phase === 'run' && B.s > B.sBreachOut) {
      B.phase = 'exit';
      B.phaseT = 0;
      notify(sim, 'The police have chased the pizza car back out through the fence!', 'good', 4);
    }
    if (B.phase === 'exit' && B.s >= B.len - 0.5) clearBreakIn(sim);
    watchHold(sim, ac);
  } else if (B.phase === 'clear' || B.phase === 'done') {
    let kept = 0;
    for (let i = 0; i < B.police.length; i++) {
      const d = B.police[i];
      /*
       * In the mission they stay by the hole in the fence: its next step is
       * "fly low past the police cars to say thank you", which takes a take-off
       * and a lap — a minute or more — and at twenty seconds they had already
       * driven home, so it said "the police are waving back" to an empty field.
       */
      if (B.phase === 'done' && B.homeT > 20 && B.owner !== 'mission') {
        // Back to where they came from, and gone once they get there.
        const p = B.base[i] || B.base[0];
        const left = d.driveTo(p.x, p.z, dt, DRIVE_BACK);
        if (left < 6 && d.obj) {
          if (d.obj.parent) d.obj.parent.remove(d.obj);
          d.obj = null;
        }
      } else {
        const p = B.parkSpots[i] || B.parkSpots[0];
        d.driveTo(p.x, p.z, dt, DRIVE_IDLE);
      }
      if (d.obj) B.police[kept++] = d;
    }
    B.police.length = kept;
    if (B.phase === 'done') B.homeT += dt;
  }

  // The siren follows the nearest police car and fades once it is over.
  if (B.siren) {
    let near = Infinity;
    if (sim.camera) for (const d of B.police) near = Math.min(near, sim.camera.position.distanceTo(d.pos));
    const on = B.phase === 'run' || B.phase === 'exit' ? 1 : 0;
    B.siren.set(on * SFX.falloff(near, 60, 1500), dt);
  }
  // Keep the ambient tower from clearing anybody while the car is out there.
  if ((B.phase === 'run' || B.phase === 'exit') && sim.atc && sim.atc.said) {
    sim.atc.said.clearance = true;
    sim.atc.said.final = true;
    sim.atc.said.shortfinal = true;
  }
  if (S.fence) S.fence.update(dt);
}

/** What happens if you do not hold. Not a failure — the tower just says so. */
function watchHold(sim, ac) {
  if (B.ground) {
    const moved = flat(ac.pos, B.holdPos);
    /*
     * Creeping at idle with the brakes on is not "not holding". A heavy jet
     * does exactly that in this flight model — the 747 settles at 2.7 m/s
     * with idle power and full brakes, measured — and shouting STOP at a
     * child who has done both is shouting at the wrong person. Power, or
     * real speed, is what earns the warning.
     */
    const blameless = idleHeld(ac) && ac.groundSpeed < 4.5;
    if (!B.warned && ((moved > 30 && !blameless) || ac.groundSpeed > 9)) {
      B.warned = true;
      speak(sim, `${callsign(sim)}, STOP, hold position! There is a pizza car on the runway!`, 'tower', 1);
      notify(sim, 'Stop! The tower said hold position — power off and hold Space', 'warn', 5);
    }
    if (B.warned && !ac.onGround && !B.landedWarned) {
      B.landedWarned = true;
      notify(sim, 'You took off without a clearance! The tower is not impressed.', 'warn', 5);
    }
  } else if (ac.onGround && ac.groundTime > 0.5 && !B.landedWarned) {
    B.landedWarned = true;
    speak(sim, `${callsign(sim)}, that runway was closed! Luckily the car was at the other end.`, 'tower', 1);
    notify(sim, 'You landed on a closed runway — luckily the car was at the other end', 'warn', 5);
  }
}

function clearBreakIn(sim) {
  B.phase = 'clear';
  B.phaseT = 0;
  if (B.car) {
    if (B.car.parent) B.car.parent.remove(B.car);
    B.car = null;
  }
  after(B, 3, (s) => {
    B.phase = 'done';
    B.homeT = 0;
    if (B.siren) {
      B.siren.stop();
      B.siren = null;
    }
    const cs = callsign(s);
    const ac = s.aircraft;
    const rwy = runwayWords();
    speak(s, ac.onGround
      ? `${cs}, the runway is clear. Thanks for waiting! The driver was lost — he was delivering a pizza to the control tower. Runway ${rwy}, cleared for take-off when you are ready.`
      : `${cs}, the runway is clear. Thanks for waiting! The driver was lost — he was delivering a pizza to the control tower. Runway ${rwy}, cleared to land.`, 'tower');
    banner(s, 'Runway clear', 'The police chased the pizza car away', 'good', 4);
    UI.showCard(s, {
      who: `${field()} Tower`,
      tone: 'good',
      text: 'All clear! The driver was lost — he was trying to deliver a pizza to the control tower. The police have had a word. Thanks for holding!',
      ttl: 12,
    });
    SFX.cheer(s, 1.6, 0.6);
    if (s.atc && s.atc.said) {
      s.atc.said.clearance = false;
      s.atc.said.final = false;
      s.atc.said.shortfinal = false;
    }
    restoreObjective(s, B);
  });
}

/** Free Flight and the start of a mission: is now a good moment? */
function tryTriggerBreakIn(sim) {
  const ac = sim.aircraft;
  if (ac.crashed) return;
  // One story at a time: nothing drives onto the runway during a hijack.
  if (HJ.hijackActive()) return;
  if (B.window === 'mission') {
    const r = sim.runner;
    const ok = r && r.status === 'running' && r.stepIndex === 0 && ac.onGround && ac.groundSpeed < 8;
    if (!ok || B.t > 16) {
      B.phase = 'idle';
      return;
    }
    if (B.t > 4) startBreakIn(sim);
    return;
  }
  // Free flight: sitting on the ground early on, or on the way back in.
  if (ac.onGround && B.t > 8 && B.t < 45 && ac.groundSpeed < 12) {
    startBreakIn(sim);
    return;
  }
  if (!ac.onGround && ac.airborneTime > 60) {
    const d = flat(ac.pos, RUNWAY.touchdown);
    const toField = Math.atan2(RUNWAY.touchdown.x - ac.pos.x, -(RUNWAY.touchdown.z - ac.pos.z)) * (180 / Math.PI);
    const off = Math.abs(((toField - ac.heading + 540) % 360) - 180);
    if (d < 6500 && d > 1500 && ac.agl * FT < 2200 && off < 50) startBreakIn(sim);
  }
}

function resetBreakIn(sim) {
  if (B.car && B.car.parent) B.car.parent.remove(B.car);
  if (sim) removePolice(sim, B.police);
  if (B.siren) B.siren.stop();
  const wasShowing = B.phase !== 'idle' && B.phase !== 'armed';
  // A story cut off halfway (a second Dev press, back to the menu) gives the
  // objective panel back too, or the next one would save "Hold position" as
  // the line to put back.
  if (wasShowing && sim) restoreObjective(sim, B);
  if (wasShowing && sim && sim.atc && sim.atc.said) {
    sim.atc.said.clearance = false;
    sim.atc.said.final = false;
    sim.atc.said.shortfinal = false;
  }
  B = freshBreakIn();
  if (S.fence) S.fence.reset();
  if (wasShowing) UI.hideCard();
}

const BINFO = {
  phase: 'idle', owner: null, police: 0, car: false, progress: 0, clear: false, done: false,
  breach: null, holdPos: null, ground: true, warned: false, siteOk: false,
};

export function breakInInfo() {
  BINFO.phase = B.phase;
  BINFO.owner = B.owner;
  BINFO.police = B.police.length;
  BINFO.car = !!B.car;
  BINFO.progress = B.len ? B.s / B.len : 0;
  BINFO.clear = B.phase === 'clear' || B.phase === 'done';
  BINFO.done = B.phase === 'done';
  BINFO.breach = B.phase !== 'idle' && B.phase !== 'armed' ? B.breach : null;
  BINFO.holdPos = B.holdPos;
  BINFO.ground = B.ground;
  BINFO.warned = B.warned;
  BINFO.siteOk = S.breakInOk;
  return BINFO;
}

/** True while this feature has not been switched off for throwing. */
export function eventsLive() {
  const me = extStatus().find((e) => e.id === 'flightevents');
  return !!(me && me.live);
}

/**
 * Counts up every frame this feature's update runs. A mission step waiting on
 * an event reads it instead of eventsLive(), which builds two arrays a call:
 * if the count stops moving while the mission is running, the feature has
 * been switched off and the step should stop waiting.
 */
export function eventsHeartbeat() {
  return S.frames;
}

/* ================================================================== *
 * The dice
 * ================================================================== */

/**
 * Is this mission one the pizza car may visit? Only at its very start, sat
 * on the ground, in an aeroplane mission with no clock and no story of its
 * own. What the car may do to the mission once it comes is in startBreakIn.
 */
function missionTakesCar(sim) {
  const r = sim.runner;
  const def = r && r.def;
  return !!(def
    && r.status === 'running'
    && !def.timeLimit
    && !def.vehicle
    && (def.game || 'flight') === 'flight'
    && def.category !== 'goofy'
    && def.category !== 'events'
    && sim.aircraft && sim.aircraft.onGround);
}

/**
 * Arm the pizza car for this flight: 'free' (Free Flight, on the ground early
 * or on the way back in) or 'mission' (the first seconds of a mission, while
 * you are still sat on the runway). Exported for the tests, which arm it on
 * purpose rather than wait for a one-in-six.
 */
export function armBreakIn(sim, window = 'free') {
  sim = sim || S.sim;
  if (!sim || !S.breakInOk) return false;
  if (window === 'mission' && !missionTakesCar(sim)) return false;
  resetBreakIn(sim);
  B.phase = 'armed';
  B.window = window === 'mission' ? 'mission' : 'free';
  B.owner = 'free';
  return true;
}

/**
 * What the dice decide at the start of a flight: a hijack in a long-haul
 * Free Flight one time in ten (the by-the-book one if the Dev passcode is
 * in), otherwise the pizza car one time in six. Returns what it armed, for
 * the tests. startMode calls it after its own "no dice under the self-test"
 * guards, which the tests step round by calling this directly.
 */
export function rollDice(sim, mode) {
  if (mode === 'free') {
    const t = typeOf(sim);
    if (t && t.longHaul && Math.random() < ODDS.hijack) {
      HJ.armHijack(sim, HJ.devOpen(sim) ? 'real' : 'film');
      return HJ.hijackInfo().version === 'real' ? 'hijack-real' : 'hijack';
    }
    if (Math.random() < ODDS.breakin && armBreakIn(sim, 'free')) return 'breakin';
    return null;
  }
  if (mode === 'mission' && missionTakesCar(sim) && Math.random() < ODDS.breakin && armBreakIn(sim, 'mission')) {
    return 'breakin-mission';
  }
  return null;
}

/* ================================================================== *
 * The hooks
 * ================================================================== */

function resetAll(sim) {
  HJ.resetHijack(sim);
  resetBreakIn(sim);
}

/**
 * Put the aeroplane twenty-two kilometres out along the runway's extended
 * centre line (five to the side) at 1,500 m, pointing at it. Free Flight's
 * own airborne start is three kilometres out at 600 m, which is already
 * inside the point where the escort says goodbye — so a Dev-button story
 * started there had the jets leave before they arrived. It was sixteen: that
 * put a jumbo 500 m above a three-degree slope to the approach gate before
 * the story had said a word, and "you are high" was the first thing it heard.
 */
function farOut(sim) {
  const ac = sim.aircraft;
  if (!ac || typeof ac.reset !== 'function') return;
  runwayFrame();
  const t = typeOf(sim);
  const p = TMP.copy(RW.c).addScaledVector(RW.f, -22000).addScaledVector(RW.r, 5000);
  ac.reset({ pos: p.clone(), headingDeg: RUNWAY.headingDeg ?? 90, speed: cruiseSpeed(t && t.id), altAGL: Math.max(300, 1500 - heightAt(p.x, p.z)), engineOn: true, gearDown: false });
  ac.controls.throttle = 0.65;
  if (sim.input) sim.input.throttleTarget = 0.65;
}

/** Start a Free Flight for a Dev button when there is no flight to put the event in. */
function devFlight(sim, aircraftId, airborne) {
  if (!sim || typeof sim.startMode !== 'function') return Promise.resolve(false);
  const weather = sim.weather && sim.weather.serialize ? sim.weather.serialize() : {};
  return Promise.resolve(sim.startMode('free', { ...weather, aircraft: aircraftId, airborne })).then(() => true);
}

/** Both Dev hijack buttons: now, in this flight if it is airborne, or a fresh long-haul one if not. */
function devHijack(sim, version) {
  const flying = sim.state === 'flying' || sim.state === 'paused';
  const t = typeOf(sim);
  // A story about a cabin full of passengers, a flight deck door and an
  // airliner's approach: in the Skylark it made no sense, and the button
  // used to start it in whatever you happened to be flying.
  const airliner = !!t && (t.longHaul || t.id === longHaulId());
  if (flying && airliner && sim.mode !== 'drive' && sim.mode !== 'mission' && sim.aircraft && !sim.aircraft.onGround && !sim.aircraft.crashed) {
    forceHijack(sim, { owner: 'dev', version });
    return;
  }
  // Not flying, not in a long-haul airliner, in a mission, driving, or sat
  // on the ground: the story needs sky and a jumbo, so start a long-haul
  // Free Flight out over the sea and begin it there.
  devFlight(sim, longHaulId(), true).then((ok) => {
    if (!ok) return;
    farOut(sim);
    forceHijack(sim, { owner: 'dev', version });
  }).catch((e) => console.error('[events] could not start the hijack flight', e));
}

const CHOICE_CODES = new Set(['Digit8', 'Digit9', 'Digit0', 'Numpad8', 'Numpad9', 'Numpad0']);

/*
 * "The more realistic one is behind a code."
 *
 * The by-the-book mission is in the mission list for everybody, flagged
 * `devOnly`. Without the Dev passcode its card is shown LOCKED: greyed, its
 * button switched off, and a line under it saying where the code goes — the
 * way the car's board shows a job the island cannot offer (is-unavailable
 * and mission-why, styles/main.css), which says a card you can see and are
 * told about beats one you cannot find.
 *
 * It used to be hidden instead, and that broke two things. The menus' own
 * check counts every card that is not behind the military passcode as one
 * the board must show, so with this branch merged it went red ("flight:
 * missing event-hijack-real"). And the game switcher (game-ui.js) un-hides a
 * card it hid for another game without asking why else it was hidden, so
 * after flight -> car -> flight the "hidden" card was back anyway. A locked
 * card needs nobody else to know what devOnly means.
 *
 * The menus call syncMissionLocks every time the Missions screen opens; this
 * wraps it, after whatever it already does, so entering the code unlocks the
 * card the next time the screen opens, with no reload. The click is guarded
 * as well, in the capture phase, in case anything switches the button back on.
 */
const DEV_WHY = 'Behind the Dev passcode — enter it under Dev mode, at the bottom of the Hangar.';

function lockDevCard(card, locked) {
  card.classList.toggle('is-unavailable', locked);
  card.classList.toggle('ev-dev-locked', locked);
  const btn = card.querySelector('[data-start]');
  if (btn) btn.disabled = locked;
  let why = card.querySelector('[data-dev-why]');
  if (!why && locked) {
    why = document.createElement('p');
    why.className = 'mission-why';
    why.setAttribute('data-dev-why', '');
    why.textContent = DEV_WHY;
    card.appendChild(why);
  }
  if (why) why.hidden = !locked;
}

function guardDevMissions(sim, MISSIONS) {
  const menus = sim && sim.menus;
  if (!menus || menus._eventsDevGuard || !Array.isArray(MISSIONS)) return;
  const devIds = new Set(MISSIONS.filter((m) => m && m.devOnly).map((m) => m.id));
  if (!devIds.size) return;
  menus._eventsDevGuard = true;
  const syncLocks = () => {
    const screen = menus.screens && menus.screens.missions;
    if (!screen) return;
    const open = HJ.devOpen(sim);
    for (const id of devIds) {
      const card = screen.querySelector(`[data-mission="${id}"]`);
      if (card) lockDevCard(card, !open);
    }
  };
  const inner = menus.syncMissionLocks;
  menus.syncMissionLocks = function (...args) {
    const out = typeof inner === 'function' ? inner.apply(this, args) : undefined;
    syncLocks();
    return out;
  };
  syncLocks();
  const screen = menus.screens && menus.screens.missions;
  if (screen) {
    screen.addEventListener('click', (e) => {
      const start = e.target && e.target.closest ? e.target.closest('[data-start]') : null;
      if (!start || !devIds.has(start.dataset.start) || HJ.devOpen(sim)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      syncLocks();
      if (menus.hooks && typeof menus.hooks.onLocked === 'function') menus.hooks.onLocked(DEV_WHY);
    }, true);
  }
}

/*
 * The missions reach this feature through ./events/bridge.js, filled in here
 * and only here, so taking this file's line out of src/features/index.js
 * really does switch the dice, the Dev buttons and the stories off.
 */
BRIDGE.api = {
  forceHijack: (sim, o) => forceHijack(sim, o),
  hijackInfo: HJ.hijackInfo,
  forceBreakIn: (sim, o) => forceBreakIn(sim, o),
  breakInInfo,
  heartbeat: eventsHeartbeat,
};

registerExtension({
  id: 'flightevents',

  install(sim) {
    S.sim = sim;
    registerVoices();
    /*
     * The mission list, asked for here and not imported at the top: the
     * missions import this file (src/game/extra/events.js drives the stories
     * through it), so a static import back would be a cycle. By install time
     * every module has loaded and this resolves at once.
     */
    import('../game/missions.js')
      .then((m) => guardDevMissions(sim, m.MISSIONS))
      .catch((e) => console.warn('[events] could not guard the Dev-only mission card', e));
    // For the console and the tests: window.__sim.flightEvents.forceHijack().
    sim.flightEvents = {
      forceHijack: (o) => forceHijack(sim, o),
      forceBreakIn: (o) => forceBreakIn(sim, o),
      squawk: () => HJ.squawk(sim),
      hijackInfo: HJ.hijackInfo,
      breakInInfo,
      ODDS,
      /** Set false to stop the dice (the Dev buttons and the missions still work). */
      random: true,
    };
  },

  buildWorld(sim, group) {
    S.sim = sim;
    S.fence = null;
    S.breakInOk = breakInSite();
    if (!S.breakInOk) return;
    runwayFrame();
    const a = rw(-RW.L / 2 - 80, FENCE_V);
    const b = rw(RW.L / 2 + 80, FENCE_V);
    const breach = rw(-0.155 * RW.L, FENCE_V);
    S.fence = buildFence(group, a, b, breach, 10);
  },

  startMode(sim, mode) {
    S.sim = sim;
    resetAll(sim);
    /*
     * No dice while something scripted is flying. tests/selftest.js switches
     * auto-pause off for exactly as long as it is driving the game, and a
     * pizza car arming itself on one run in six would make every team's
     * checks pass or fail on luck — a "hold position" rewrites the free
     * flight objective the suite reads back.
     */
    if (sim.autoPauseOnHide === false) return;
    if (sim.flightEvents && sim.flightEvents.random === false) return;
    rollDice(sim, mode);
  },

  stop(sim) {
    resetAll(sim);
  },

  update(sim, dt) {
    S.frames++;
    if (sim.mode === 'drive') return;
    S.t += dt;
    HJ.updateHijack(sim, dt);
    updateBreakIn(sim, dt);
    if (HJ.flashingNow() || B.police.length) flashPolice(S.t);
  },

  camera(sim, dt, camera) {
    return HJ.hijackCamera(sim, dt, camera);
  },

  key(sim, code, down) {
    if (code === 'Digit7' || code === 'Numpad7') {
      if (!HJ.hijackActive()) return false;
      if (down) HJ.squawk(sim);
      return true;
    }
    if (CHOICE_CODES.has(code)) {
      if (down) return UI.chooseByCode(code);
      return UI.isChoiceCode(code);
    }
    if (code === 'KeyC' && HJ.cinematicOn()) {
      if (down) HJ.skipCinematic();
      return true;
    }
    return false;
  },

  devActions: [
    {
      label: 'Trigger hijack event',
      hint: 'The hijack, now — the version everybody gets. Starts a long-haul Free Flight unless you are already flying one.',
      run(sim) {
        devHijack(sim, 'film');
      },
    },
    {
      label: 'Realistic hijack',
      hint: 'The by-the-book version: the locked door, 7500, the intercept signals, the remote runway. Starts a long-haul Free Flight unless you are already flying one.',
      run(sim) {
        devHijack(sim, 'real');
      },
    },
    {
      label: 'Trigger airport break-in',
      hint: 'The pizza car, now. Starts a Free Flight on the runway if you are not already flying.',
      run(sim) {
        if (sim.state === 'flying' || sim.state === 'paused') {
          if (sim.mode === 'drive') {
            notify(sim, 'That one needs an aeroplane — pick Flight first.', 'warn', 4);
            return;
          }
          forceBreakIn(sim, { owner: 'dev' });
          return;
        }
        const id = (sim.aircraftType && sim.aircraftType.id) || 'skylark';
        devFlight(sim, id, false).then((ok) => {
          if (ok) forceBreakIn(sim, { owner: 'dev' });
        }).catch((e) => console.error('[events] could not start the break-in flight', e));
      },
    },
  ],
});

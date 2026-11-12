/**
 * Ditching: a gentle, wings-level, slow arrival on the sea leaves the
 * aeroplane whole. It slides and slows hard with spray, stops, floats level,
 * and settles over a couple of minutes while the rafts go out and a boat or a
 * helicopter comes; then a scored card, like a runway's.
 *
 * A bad arrival is none of this file's business: waterTouch() says no and the
 * flight model goes on to the crash it always had ("You flew into the sea",
 * crashes/kinds.js, wreck.js, breakup.js), not one line of which changes.
 *
 * The rules are ./ditching/judge.js (pure). The rafts, the spray and the boat
 * are ./ditching/scene.js and water-fx.js, loaded the first time an aeroplane
 * is low over the sea and coming down, never before.
 *
 * A running mission does not expect the sea unless it says so
 * (`allowDitch: true`, and then its steps read sim.ditching.state()). Any
 * other mission ends with the sequence, as a failed mission and in the
 * runner's own words (runner.fail), so the Story's and the seats' failure
 * handling is what runs.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extKeyContext } from '../game/extensions.js';
import { heightAt, obstacleAt, swellAt } from '../world/terrain.js';
import { performanceFor } from '../aircraft/types.js';
import { SPEC } from '../aircraft/physics.js';
import { STATUS } from '../game/runner.js';
import { multiplayer } from './multiplayer.js';
import { debriefPayRow } from '../game/progression.js';
import { ditchClass, ditchLimits, survivable, gradeDitching, sinkSeconds, waterDecelG, floatHeight, missWords } from './ditching/judge.js';

/** Seconds after it stops: the rescue sets off, arrives, and the card comes up. The aeroplane is still going down behind it. */
export const TIMES = Object.freeze({ radio: 4, launch: 10, arrive: 36, card: 46 });

const KT = 1.94384;
const FPM = 196.85;
const D2R = Math.PI / 180;
const _v = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _box = new THREE.Box3();

const S = {
  sim: null,
  phase: null, // null | 'slide' | 'afloat' | 'over'
  t: 0,
  refused: false,
  arrival: null,
  result: null,
  cls: null,
  heading: 0,
  pitch: 0,
  bank: 0,
  yawRate: 0,
  floatY: 0,
  belly: -1,
  halfBeam: 2,
  fullDepth: 8,
  depth: 0,
  sinkAt: 150,
  sunk: false,
  sea: 0,
  spraying: 0,
  said: 0,
  card: false,
  checkT: 0,
  scene: null,
  fx: null,
  loading: null,
  rescue: null,
};

/* ---- the lazy half ---------------------------------------------------- */

/** The rafts and the spray, the first time they might be wanted. */
function loadScene(sim) {
  if (S.loading) return S.loading;
  const low = !!(sim.settings && sim.settings.quality === 'low');
  S.loading = Promise.all([import('./ditching/scene.js'), import('./ditching/water-fx.js')])
    .then(([sc, fx]) => {
      S.sceneMod = sc;
      S.scene = new sc.DitchScene(sim.scene, { low });
      S.fx = new fx.SeaFx(sim.scene, { low });
      S.fx.setLight(!!sim.weather.isNight);
      if (S.phase === 'afloat') startRafts(sim);
    })
    .catch((e) => {
      // The aeroplane still floats and the card still comes; only the pictures are missing.
      console.warn('[ditching] the rafts did not load', e);
    });
  return S.loading;
}

/* ---- the sea's first refusal ------------------------------------------- */

/** Is the person flying this actually in it, in a flight, in a type that does this? */
function canDitch(sim) {
  if (!sim || sim.state !== 'flying' || !sim.mode || sim.vehicle || sim.riding) return false;
  if (!ditchClass(sim.aircraftType)) return false;
  try {
    const k = extKeyContext(sim);
    if (k === 'foot' || k === 'chute' || k === 'rocket') return false;
  } catch (e) {
    return false;
  }
  const f = sim.walking;
  if (f && (f.ejected || f.runaway)) return false;
  // A PvP round's wreck is what its "back in three" is waiting for.
  if (multiplayer && multiplayer.extraFlags && multiplayer.extraFlags.pvp) return false;
  return true;
}

/** The lowest point of the aeroplane that has reached the sea, in `_v`, or null. */
function wetPoint(ac) {
  const q = ac.quat;
  const check = (p) => {
    _v.copy(p).applyQuaternion(q);
    const y = _v.y + ac.pos.y;
    if (y >= 0) return false;
    _v.add(ac.pos);
    return heightAt(_v.x, _v.z) < 0;
  };
  for (const hp of SPEC.hardPoints) if (check(hp.pos)) return _v;
  if (ac.gearPos > 0.5) for (const gp of SPEC.gearPoints) if (check(gp.pos)) return _v;
  return null;
}

/** ac.waterHook: every physics step, before the gear. Returns true when it took the aeroplane. */
function waterTouch(ac) {
  if (ac.pos.y > 90) {
    S.refused = false;
    return false;
  }
  if (S.refused || ac.crashed || ac.ditched || SPEC.rotor || SPEC.floats) return false;
  if (!wetPoint(ac)) return false;
  // Rolled off a beach at walking pace with the centre still over land: the flight model's.
  if (heightAt(ac.pos.x, ac.pos.z) >= 0) return false;
  const sim = S.sim;
  if (!canDitch(sim)) {
    S.refused = true;
    return false;
  }
  const speedKts = Math.hypot(ac.vel.x, ac.vel.z) * KT;
  // vel.y: `vs` is a copy taken once per step (the old braceSurvivable's note).
  const arrival = { speedKts, sinkFpm: Math.max(0, -ac.vel.y * FPM), bank: ac.bankAngleDeg(), pitch: ac.pitchAngleDeg() };
  const type = sim.aircraftType;
  const cls = ditchClass(type);
  const gearDown = ac.gearPos > 0.5;
  const limits = ditchLimits({ stallKts: performanceFor(type.id).stallClean, cls, gearDown, difficulty: ac.difficulty });
  const verdict = survivable(arrival, limits);
  if (!verdict.ok) {
    S.refused = true;
    S.lastRefusal = { arrival, limits, over: verdict.over };
    return false;
  }
  begin(sim, ac, arrival, limits, cls, gearDown);
  return true;
}

function begin(sim, ac, arrival, limits, cls, gearDown) {
  const type = sim.aircraftType;
  S.phase = 'slide';
  S.t = 0;
  S.cls = cls;
  S.card = false;
  S.said = 0;
  S.sunk = false;
  S.depth = 0;
  S.rescue = null;
  S.sea = Math.max(0, Math.min(1, ((sim.weather && sim.weather.windSpeedKts) || 0) / 40));
  const flaps = ac.flaps || 0;
  const g = gradeDitching(arrival, limits, { gearDown, flaps, rough: S.sea });
  S.result = {
    speedKts: Math.round(arrival.speedKts),
    sinkFpm: Math.round(arrival.sinkFpm),
    bank: Math.round(Math.abs(arrival.bank)),
    pitch: Math.round(arrival.pitch),
    gearDown,
    flaps,
    ...g,
  };
  S.arrival = arrival;

  // If a mayday was under way it stops here; the sea has made its decision for it.
  if (sim.bracing || sim.braceRescueT) {
    sim.bracing = false;
    sim.braceOwnsEnding = false;
    clearTimeout(sim.braceRescueT);
    sim.braceRescueT = null;
    sim.clearRescue();
    sim.clearChute();
    sim.hud.setEmergencyChoice(null);
  }
  sim.autopilot.setEngaged(false, ac);
  sim.hud.setAutopilot(false);
  sim.clearCheckpoint();

  ac.ditched = true;
  ac.engineOn = false;
  ac.starting = 0;
  ac.stalled = false;
  ac.onGround = true;
  ac.vel.y = 0;
  ac.omega.set(0, 0, 0);
  ac.controls.throttle = 0;
  S.heading = ac.heading * D2R;
  S.pitch = arrival.pitch * D2R;
  S.bank = arrival.bank * D2R;
  S.yawRate = -arrival.bank * D2R * 0.1;
  const belly = SPEC.hardPoints.find((h) => /belly/i.test(h.what));
  S.belly = belly ? belly.pos.y : -1;
  S.floatY = floatHeight(S.belly);
  S.tailZ = (type.plan && type.plan.tail) || 6;
  S.noseZ = (type.plan && type.plan.nose) || -6;
  S.afloatPitch = null;
  S.lineT = 0;
  S.halfBeam = Math.max(1, Math.abs(S.belly) * 1.1);
  S.sinkAt = sinkSeconds(cls, type.aero.mass);

  if (sim.audio.available) {
    sim.audio.ambience.playSplash();
    sim.audio.engine.playStop();
  }
  sim.rig.kick(0.5 + Math.min(0.5, arrival.sinkFpm / 1400));
  sim.hud.showBanner('Ditched', 'Hold it straight and let her slow down.', 'warn', 4);
  loadScene(sim);
  if (S.fx) {
    S.fx.setLight(!!sim.weather.isNight);
    burst(ac);
  }
}

/* ---- sliding to a stop ------------------------------------------------- */

function setAttitude(ac) {
  _e.set(S.pitch, -S.heading, -S.bank);
  ac.quat.setFromEuler(_e);
}

/** What the instruments and everybody else read off a stopped flight model. */
function publish(ac, speed) {
  ac.groundSpeed = speed;
  ac.airspeed = speed;
  ac.ias = speed;
  ac.vs = 0;
  ac.gLoad = 1;
  ac.alt = ac.pos.y;
  ac.agl = Math.max(0, ac.pos.y - Math.max(0, heightAt(ac.pos.x, ac.pos.z)));
  ac.heading = (((S.heading / D2R) % 360) + 360) % 360;
  ac.wheelsRolling = false;
}

function burst(ac) {
  const fx = S.fx;
  const v = ac.groundSpeed || 20;
  const n = Math.min(40, fx.N >> 2);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = 0.5 + (i % 5) * 0.5;
    fx.spray(ac.pos.x + Math.cos(a) * S.halfBeam, 0.3, ac.pos.z + Math.sin(a) * S.halfBeam, ac.vel.x * 0.4 + Math.cos(a) * 3 * r, 3 + (i % 4) * 2.6 + v * 0.07, ac.vel.z * 0.4 + Math.sin(a) * 3 * r, 0.5 + S.halfBeam * 0.2, 0.9 + (i % 3) * 0.2, 0.9);
  }
}

function spray(ac, speed, dt) {
  const fx = S.fx;
  if (!fx || speed < 2.5) return;
  const sin = Math.sin(S.heading);
  const cos = Math.cos(S.heading);
  const k = Math.min(1, speed / 45);
  // By time, not by frame: the same plume at 30 and at 120 frames a second.
  S.spraying = Math.min(4, (S.spraying || 0) + dt * (fx.N / 2.2));
  while (S.spraying >= 1) {
    S.spraying -= 1;
    const side = (S.sideFlip = -(S.sideFlip || 1));
    // Off the chine on each side, somewhere along the hull, thrown out and up and left behind in the air.
    const along = S.tailZ * (0.1 + Math.random() * 0.5);
    const beam = S.halfBeam * (0.8 + Math.random() * 0.35);
    const x = ac.pos.x + cos * side * beam - sin * along;
    const z = ac.pos.z + sin * side * beam + cos * along;
    const out = 1.5 + speed * 0.12;
    fx.spray(x, 0.4, z, cos * side * out + ac.vel.x * 0.42, 2 + k * (5 + Math.random() * 9), sin * side * out + ac.vel.z * 0.42, 0.4 + S.halfBeam * 0.22 + k * 0.5, 0.7 + k * 0.7, 0.9);
  }
  // The wash, laid down by distance so it joins up, and the pool has to cover the whole trail:
  // fast, each patch is a longer one, further apart.
  S.wakeGap = (S.wakeGap || 0) + speed * dt;
  const patch = S.halfBeam * 2.4;
  const gap = Math.max(patch * 0.8, (speed * 6) / fx.W);
  if (S.wakeGap >= gap) {
    S.wakeGap = 0;
    const aft = S.tailZ * 0.8;
    fx.wake(ac.pos.x - sin * aft, ac.pos.z + cos * aft, -S.heading, patch, 6, S.halfBeam * 0.45, gap * 2.6);
  }
}

function slide(sim, dt) {
  const ac = sim.aircraft;
  const speed = Math.hypot(ac.vel.x, ac.vel.z);
  // Wheels hanging, flaps out: both are more drag in the water, not less.
  const extra = (ac.gearPos > 0.5 ? 0.12 : 0) + (ac.flaps || 0) * 0.05;
  const decel = waterDecelG(speed, extra) * 9.81;
  const next = Math.max(0, speed - decel * dt);
  S.heading += S.yawRate * dt;
  S.yawRate *= 1 - Math.min(1, dt * 0.7);
  ac.vel.x = Math.sin(S.heading) * next;
  ac.vel.z = -Math.cos(S.heading) * next;
  ac.pos.x += ac.vel.x * dt;
  ac.pos.z += ac.vel.z * dt;

  /*
   * Running out of sea. Slow, she stops on the bottom where she is, afloat or
   * nearly; fast, that is the crash the flight model would have had. And a
   * pier, a ship or a bridge pile in the way is what it always was.
   */
  const lookX = ac.pos.x + Math.sin(S.heading) * Math.max(8, next * 0.4);
  const lookZ = ac.pos.z - Math.cos(S.heading) * Math.max(8, next * 0.4);
  const shoal = heightAt(lookX, lookZ) > -0.6;
  const hit = obstacleAt(ac.pos.x, 1, ac.pos.z);
  if (hit || (shoal && next > 14)) {
    wreckIt(sim, hit ? hit.what : 'You ran aground at speed');
    return;
  }
  const floor = heightAt(ac.pos.x, ac.pos.z) - S.belly * 0.9;
  const rest = Math.max(S.floatY + Math.min(1, next / 40) * 0.4, floor);
  ac.pos.y += (rest - ac.pos.y) * Math.min(1, dt * 3);
  // The nose comes down onto the water, and the wings settle level.
  const trim = 1.5 * D2R + Math.min(1, next / 40) * 3 * D2R;
  S.pitch += (trim - S.pitch) * Math.min(1, dt * 1.6);
  S.bank += (0 - S.bank) * Math.min(1, dt * 1.8);
  setAttitude(ac);
  publish(ac, next);
  spray(ac, next, dt);
  if (S.fx) S.fx.update(dt);
  if (next < 0.5 || shoal) restNow(sim);
}

function wreckIt(sim, why) {
  const ac = sim.aircraft;
  S.phase = null;
  ac.ditched = false;
  ac.crash(why, { worldPoint: ac.pos.clone(), part: 'nose', surfaceKind: 'water' });
}

/* ---- at rest ----------------------------------------------------------- */

function restNow(sim) {
  const ac = sim.aircraft;
  S.phase = 'afloat';
  S.t = 0;
  ac.vel.set(0, 0, 0);
  publish(ac, 0);
  const model = sim.model;
  if (model) {
    try {
      _box.setFromObject(model);
      S.fullDepth = Math.max(4, _box.max.y - ac.pos.y + S.floatY + 1);
    } catch (e) {
      S.fullDepth = 10;
    }
  }
  const call = (sim.atc && sim.atc.callsign) || 'Skylark one seven two';
  sim.speak(`Mayday, mayday, mayday. ${call}, down on the water, aeroplane intact. Evacuating.`, 'pilot', 1);
  sim.hud.showBanner('Afloat', S.cls === 'airliner' ? 'Doors open. Rafts going out.' : 'Out of the aeroplane and into the raft.', 'good', 5);
  objective(sim, S.cls === 'airliner' ? 'Everyone into the rafts. Rescue is on its way.' : 'Get clear of the aeroplane. Rescue is on its way.');
  startRafts(sim);
}

function objective(sim, text) {
  const r = sim.runner;
  // A mission that expects this is writing its own words.
  if (r && r.status === STATUS.RUNNING && r.def && r.def.allowDitch) return;
  if (sim.hud && sim.hud.setObjective) sim.hud.setObjective('Ditched', text);
}

function startRafts(sim) {
  if (!S.scene || S.scene.plan) return;
  const ac = sim.aircraft;
  const tip = SPEC.hardPoints.find((h) => /right wing tip/i.test(h.what));
  S.scene.deploy({ cls: S.cls, ac, model: sim.model, type: sim.aircraftType, belly: S.belly, floatY: S.floatY, tip: tip && tip.pos });
}

/** How far she has settled at this time: level for the first half-minute, and then going down faster the lower she gets. */
export function settled(t, sinkAt, fullDepth) {
  const u = Math.max(0, Math.min(1, (t - 26) / (sinkAt - 26)));
  return fullDepth * u * u * (1.6 - 0.6 * u);
}

/** The disturbed water where the hull meets the sea: long soft patches laid in place of one another. */
function waterline(ac, dt) {
  S.lineT -= dt;
  if (S.sunk || S.lineT > 0) return;
  S.lineT = 1.2;
  const z = (S.noseZ + S.tailZ) * 0.5 * 0.8;
  const sin = Math.sin(S.heading);
  const cos = Math.cos(S.heading);
  const beam = S.halfBeam * 3;
  S.fx.wake(ac.pos.x - sin * z, ac.pos.z + cos * z, -S.heading, beam, 3.6, 0.25, (S.tailZ - S.noseZ) * 1.02, 0.5);
}

function afloat(sim, dt) {
  const ac = sim.aircraft;
  S.t += dt;
  const t = S.t;
  const d = settled(t, S.sinkAt, S.fullDepth);
  const floor = heightAt(ac.pos.x, ac.pos.z) - S.belly * 0.9;
  const swell = (0.05 + S.sea * 0.3) * Math.max(0, 1 - d * 0.2);
  // On the swell that is drawn (world/sea-state.js), less of it as she goes under.
  const y = Math.max(S.floatY - d + Math.sin(t * 0.9) * swell + swellAt(ac.pos.x, ac.pos.z) * Math.max(0, 1 - d * 0.2), floor);
  ac.pos.y = y;
  S.depth = Math.max(0, S.floatY - y);
  const u = S.depth / S.fullDepth;
  // An airliner's tail goes first, a single's engine pulls the nose in. Eased: she stopped on the step's trim.
  const want = (S.cls === 'airliner' ? 1.5 + u * 6 : -2.5 - u * 7) * D2R;
  S.afloatPitch = S.afloatPitch == null ? S.pitch : S.afloatPitch + (want - S.afloatPitch) * Math.min(1, dt * 0.5);
  S.pitch = S.afloatPitch + Math.sin(t * 0.7) * 0.006 * (1 + S.sea * 3);
  S.bank = Math.sin(t * 0.53 + 1) * 0.01 * (1 + S.sea * 3);
  setAttitude(ac);
  publish(ac, 0);
  if (!S.sunk && ac.pos.y <= S.floatY - S.fullDepth + 1e-3) {
    S.sunk = true;
    if (sim.model) sim.model.visible = false;
  }
  if (S.scene) S.scene.update(dt, ac, t, S.depth, S.sunk);
  if (S.fx) {
    waterline(ac, dt);
    S.fx.update(dt);
  }
  if (S.phase === 'over') return;

  const call = (sim.atc && sim.atc.callsign) || 'Skylark one seven two';
  const field = (sim.atc && sim.atc.field) || 'Kestrel';
  if (S.said < 1 && t >= TIMES.radio) {
    S.said = 1;
    sim.speak(`${call}, ${field} Tower. We have your position. Rescue is launching.`, 'tower', 1);
  }
  if (S.said < 2 && t >= TIMES.launch) {
    S.said = 2;
    callRescue(sim);
  }
  if (S.said < 3 && t >= TIMES.arrive) {
    S.said = 3;
    const who = S.rescue === 'heli' ? 'Rescue helicopter' : 'Rescue boat';
    sim.speak(`${who} on scene. We have them. Everyone is accounted for.`, 'approach', 1);
    objective(sim, 'Rescue is alongside. Everyone is safe.');
    sim.hud.showBanner('Rescue on scene', 'Everyone is accounted for.', 'good', 4);
  }
  if (t >= TIMES.card && !S.card) showCard(sim);
}

function callRescue(sim) {
  const ac = sim.aircraft;
  const from = S.sceneMod ? S.sceneMod.clearApproach(ac.pos.x, ac.pos.z) : null;
  const useBoat = S.cls !== 'fast' && !!from;
  S.rescue = useBoat ? 'boat' : 'heli';
  sim.speak(useBoat ? 'Rescue boat under way. Hold on.' : 'Rescue helicopter is on its way. Stay with the raft.', 'approach');
  if (!S.scene) return;
  // Alongside, off the wing tip; the rafts are nearer than that.
  const off = Math.max(18, ((sim.aircraftType.plan && sim.aircraftType.plan.span) || 12) * 0.5 + 12);
  const a = S.heading;
  // A helicopter holds ahead and off to one side, where a pilot still in the seat can see it.
  const ahead = S.rescue === 'heli' ? off * 2 : 0;
  const to = { x: ac.pos.x + Math.cos(a) * off + Math.sin(a) * ahead, z: ac.pos.z + Math.sin(a) * off - Math.cos(a) * ahead };
  const start = from || { x: to.x + 900, z: to.z + 200 };
  S.scene.callRescue(S.rescue, start, to, TIMES.arrive - TIMES.launch, S.fx, sim.weather);
}

/* ---- the card ----------------------------------------------------------- */

function rows(R, more = '') {
  const flaps = R.flaps > 0.05 ? `${Math.round(R.flaps * 100)}%` : 'Up';
  return `<div class="debrief-score">${R.score}<span>/100</span></div>
    <ul class="debrief-list">
      <li>Grade <b>${R.grade}</b></li>
      <li>Touchdown speed <b>${R.speedKts} kt</b></li>
      <li>Sink rate <b>${R.sinkFpm} ft/min</b></li>
      <li>Bank <b>${R.bank}&deg;</b></li>
      <li>Flaps <b>${flaps}</b></li>
      <li>Wheels <b>${R.gearDown ? 'Down' : 'Up'}</b></li>
      ${more}
    </ul>`;
}

/** What a runner keeps of a landing: the debrief and the mission's score read this. */
function asLanding(R) {
  return { crashed: false, quality: R.quality, score: R.score, vsFpm: -R.sinkFpm, bank: R.bank, centreline: 0, onRunway: false, paved: false, speedKts: R.speedKts, water: true, ditched: true };
}

function showCard(sim) {
  S.card = true;
  // A mission that ended some other way while she was going down keeps its own card.
  if (sim.state !== 'flying') return;
  const R = S.result;
  const r = sim.runner;
  if (r && r.status === STATUS.RUNNING && r.def) {
    r.data.lastTouchdown = asLanding(R);
    r.data.ditching = R;
    if (r.def.allowDitch) return; // its last step completes on state().done
    r.fail(`You ditched at ${R.speedKts} knots, wings level, and everybody got out. The aeroplane is in the sea, and the mission is over.`);
    return;
  }
  sim.state = 'debrief';
  sim.hud.setVisible(false);
  if (sim.audio.available) sim.audio.alerts.checkpoint();
  sim.menus.showDebrief({
    title: 'Ditching',
    kind: R.score >= 56 ? 'good' : 'warn',
    body: `${rows(R)}<p class="debrief-reason">${lead(R)}</p>`,
    actions: [
      { label: 'Try again', onClick: () => sim.restart(), primary: true },
      { label: 'Main menu', onClick: () => sim.quitToMenu('main') },
    ],
  });
}

function lead(R) {
  if (R.gearDown) return 'Everybody got out, though the wheels should have been up: they catch the water and pull the nose in.';
  if (R.grade === 'Textbook') return 'Wings level, nose up, as slow as she would fly. Everybody got out dry.';
  if (R.grade === 'Good') return 'A clean ditching. The aeroplane stayed in one piece and everybody got out.';
  if (R.grade === 'Firm') return 'A hard one, but the hull held and everybody got out.';
  return 'She stayed in one piece, only just. Slower and flatter next time.';
}

/**
 * A mission's own ending is the same card with its pay on it: main.js writes
 * "Mission complete!", and this puts the ditching's words in its place.
 */
function wrapDebrief(sim) {
  const menus = sim.menus;
  if (!menus || menus.showDebrief.__ditching) return;
  const orig = menus.showDebrief;
  const wrapped = function wrappedDebrief(d) {
    const R = S.result;
    const def = sim.runner.def;
    // A mission that had no use for the sea: nobody failed to do anything, she is in the water. One word for what happened, as a crash has.
    if (R && S.card && def && !def.allowDitch && sim.runner.status === STATUS.FAILED) return orig.call(this, { ...d, title: 'Ditched' });
    if (S.lastRefusal && def && def.allowDitch && sim.runner.status === STATUS.FAILED) {
      return orig.call(this, { ...d, body: `${d.body}<p class="debrief-reason">${missWords(S.lastRefusal)}</p>` });
    }
    if (!R || !S.card || !sim.runner.def || !sim.runner.def.allowDitch || sim.runner.status !== STATUS.COMPLETE) return orig.call(this, d);
    return orig.call(this, {
      ...d,
      title: 'Ditching',
      body: `${rows(R, d.paid ? debriefPayRow(d.paid) : '')}<p class="debrief-reason">${lead(R)}</p>`,
      actions: d.actions.map((a) => (a.primary ? { ...a, label: 'Try again' } : a)),
    });
  };
  wrapped.__ditching = true;
  menus.showDebrief = wrapped;
}

/** Tear it all down: the aeroplane is the flight model's again. */
function stand(sim) {
  S.phase = null;
  S.lastRefusal = null;
  S.t = 0;
  S.refused = false;
  S.result = null;
  S.card = false;
  S.sunk = false;
  S.rescue = null;
  if (S.scene) S.scene.clear();
  if (S.fx) S.fx.clear();
  if (sim && sim.aircraft) sim.aircraft.ditched = false;
  // Not in the boat or the van: startDrive() has just parked the aeroplane out of sight, and this showed it on the runway again.
  if (sim && sim.model && sim.mode !== 'drive') sim.model.visible = true;
}

export function ditchingState() {
  const sim = S.sim;
  return {
    phase: S.phase,
    t: S.t,
    ditched: !!(sim && sim.aircraft && sim.aircraft.ditched),
    cls: S.cls,
    result: S.result,
    depth: S.depth,
    fullDepth: S.fullDepth,
    sinkAt: S.sinkAt,
    sunk: S.sunk,
    rescue: S.rescue,
    rescueHere: !!(S.scene && S.scene.rescueHere),
    atRest: S.phase === 'afloat',
    done: S.card,
    sceneLoaded: !!S.scene,
    refused: S.lastRefusal || null,
    pool: S.fx ? { spray: S.fx.N, foam: S.fx.W, alive: S.fx.alive, light: S.fx.brightness } : null,
    rafts: S.scene && S.scene.plan ? S.scene.plan.rafts.length : 0,
  };
}

const API = {
  state: ditchingState,
  load: () => (S.sim ? loadScene(S.sim) : null),
};

registerExtension({
  id: 'ditching',

  install(sim) {
    S.sim = sim;
    sim.ditching = API;
    sim.aircraft.waterHook = waterTouch;
    wrapDebrief(sim);
    // Behind the card she keeps going down (main.js frame).
    sim.afterFlight = (dt) => {
      if (S.phase === 'afloat' && sim.aircraft.ditched) afloat(sim, dt);
    };
  },

  startMode(sim) {
    stand(sim);
    sim.aircraft.waterHook = waterTouch;
  },

  stop(sim) {
    stand(sim);
  },

  update(sim, dt) {
    // Somebody reset the aeroplane under us (a lesson going back a step, a teleport): it is flying again, and this is over.
    if (S.phase && !sim.aircraft.ditched) stand(sim);
    if (S.phase === 'slide') {
      S.t += dt;
      slide(sim, dt);
      return;
    }
    if (S.phase === 'afloat') {
      afloat(sim, dt);
      return;
    }
    if (S.fx && !S.fx.idle) S.fx.update(dt);
    // Once a second: low, over the sea and coming down is when the rafts might be wanted.
    S.checkT -= dt;
    if (S.checkT > 0 || S.loading) return;
    S.checkT = 1;
    const ac = sim.aircraft;
    if (!ac || sim.vehicle || ac.onGround || ac.pos.y > 320 || ac.vel.y > -1) return;
    if (SPEC.rotor || !ditchClass(sim.aircraftType)) return;
    if (heightAt(ac.pos.x, ac.pos.z) < 0) loadScene(sim);
  },
});

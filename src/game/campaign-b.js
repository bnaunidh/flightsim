/**
 * Campaign, second half — missions nine to fifteen.
 *
 * These are the hard ones. Everything up to mission eight taught a skill in
 * clean air with the airfield in sight; from here the aeroplane is flown into
 * places that bite back: a mountain bowl, a fuel leak, a thunderstorm, a dead
 * engine, an empty ocean, a painted box on the tarmac, and finally all of it at
 * once with a rough-running engine.
 *
 * Two rules govern every number in this file, because both have already caused
 * a shipped bug:
 *   - `ac.agl` and `ac.alt` are METRES. Feet only ever appear after `ft()`.
 *   - `ac.agl` measures to the sea *bed* (-34 m) over water, so anything
 *     happening over the sea is judged with `ac.alt`, which is height above the
 *     waves because sea level is y = 0.
 *
 * Mechanics that need an engine change are written so the mission still works
 * today and gets better when the change lands — see `pump()`, `holdPower()` and
 * `killEngine()`. Each one says what the integrator should add.
 */

import * as THREE from '../vendor/three.module.js';
import { RUNWAY } from '../world/airport.js';
import { UNITS } from '../aircraft/physics.js';
import * as SCENERY from '../world/scenery.js';
import * as MARKERS from './markers.js';

const ELEV = RUNWAY.elev;
const ft = (m) => m * UNITS.FT;
const kt = (v) => v * UNITS.KTS;
const fpm = (v) => v * UNITS.FPM;

/**
 * The runway spawn is redefined here rather than imported from missions.js.
 * The integrator is expected to pull this file *into* missions.js, and an import
 * in the other direction would make a cycle that leaves the constant in its
 * temporal dead zone while this module's mission objects are being built.
 */
const RUNWAY_START = {
  pos: new THREE.Vector3(-470, ELEV, 0),
  headingDeg: 90,
};

/* ------------------------------------------------------------------ */
/* World fixtures                                                      */
/* ------------------------------------------------------------------ */

/**
 * World additions W1–W3 are built by the scenery owner in parallel with this
 * file. Reading them through the namespace means a mission never fails to load
 * because a constant has not been exported yet; the fallbacks are the surveyed
 * figures the whole campaign was designed against, so the missions fly the same
 * either way.
 */
const CAY_STRIP = SCENERY.CAY_STRIP || {
  centre: new THREE.Vector3(6000, 111, -5300),
  headingDeg: 165,
  threshold16: new THREE.Vector3(5935, 111, -5541),
  threshold34: new THREE.Vector3(6065, 111, -5059),
  touchdown16: new THREE.Vector3(5955, 111, -5470),
  elev: 111,
  length: 420,
  halfWidth: 22,
};

const RIDGE_PAD = SCENERY.RIDGE_PAD || new THREE.Vector3(900, 303.7, -1450);

const CUTTER =
  SCENERY.KESTREL_GUARD || SCENERY.CUTTER || new THREE.Vector3(-2450, 0, -2600);

/** Unit vector along the Mango Cay strip, pointing the way runway 16 lands. */
const CAY_DIR = (() => {
  const h = THREE.MathUtils.degToRad(CAY_STRIP.headingDeg);
  return new THREE.Vector3(Math.sin(h), 0, -Math.cos(h));
})();

/** How far along the strip, and how far off its centreline, a point lies. */
function stripOffsets(x, z) {
  const dx = x - CAY_STRIP.centre.x;
  const dz = z - CAY_STRIP.centre.z;
  return {
    along: dx * CAY_DIR.x + dz * CAY_DIR.z,
    across: dx * CAY_DIR.z - dz * CAY_DIR.x,
  };
}

const flatDist = (pos, target) => Math.hypot(pos.x - target.x, pos.z - target.z);

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function landedAndStopped(ctx) {
  const ac = ctx.ac;
  return (
    !!ctx.data.lastTouchdown &&
    !ctx.data.lastTouchdown.crashed &&
    ac.onGround &&
    ac.groundSpeed < 2.5 &&
    ac.groundTime > 1.2
  );
}

/** True when the aeroplane is west of the field, pointing east, ready for 09. */
function linedUpFor09(ctx, maxRange = 4200) {
  const ac = ctx.ac;
  return (
    ac.pos.x < RUNWAY.thresholdWest.x - 300 &&
    ac.pos.distanceTo(RUNWAY.touchdown) < maxRange &&
    Math.abs(((ac.heading - 90 + 540) % 360) - 180) < 60
  );
}

/**
 * Per-frame work.
 *
 * Engine addition A1 gives missions an `onUpdate(ctx, dt)` hook. Until it is
 * wired in, `failIf` is the only callback the runner makes every frame, so both
 * routes call `pump()` and it runs the work exactly once per frame whichever of
 * them fired first. `ctx.elapsed` is the frame clock, so the difference between
 * two calls is the frame's own dt.
 */
function pump(ctx, work) {
  const last = ctx.data._pumpAt;
  if (last === ctx.elapsed) return;
  const dt = last == null ? 0 : Math.min(0.25, Math.max(0, ctx.elapsed - last));
  ctx.data._pumpAt = ctx.elapsed;
  if (dt > 0) work(ctx, dt);
}

/** Says something once, however many frames the condition stays true. */
function sayOnce(ctx, key, text, kind = 'info') {
  if (ctx.data['_said_' + key]) return;
  ctx.data['_said_' + key] = true;
  ctx.sim.notify(text, kind);
}

/**
 * A landing that has just happened, or null.
 *
 * `x`/`z` are the contact point. Engine addition A2 puts them on the grade
 * itself; without it we stamp the aeroplane's own position, which is a few
 * metres out at most because this runs on the frame of the touch. Bounces
 * re-fire the touchdown event, so a contact only counts once the aeroplane has
 * been properly airborne again.
 */
function newLanding(ctx) {
  const d = ctx.data;
  const td = d.lastTouchdown;
  if (!td || td === d._seenTouchdown || !d._flownProperly) return null;
  d._seenTouchdown = td;
  d._flownProperly = false;
  return {
    grade: td,
    x: td.x != null ? td.x : ctx.ac.pos.x,
    z: td.z != null ? td.z : ctx.ac.pos.z,
    vsFpm: Math.abs(td.vsFpm),
  };
}

/** Feeds `newLanding`; call it from every tick that watches for landings. */
function watchAirborne(ctx) {
  if (ctx.ac.airborneTime > 6) ctx.data._flownProperly = true;
}

/**
 * Stops the engine for good.
 *
 * Engine addition A4 adds `failEngine()`, which also blocks the starter. Until
 * then the player can restart with the I key, so the tick that owns the failure
 * keeps shutting it down again — the effect a forced landing needs either way.
 */
function killEngine(ac, reason) {
  if (typeof ac.failEngine === 'function') ac.failEngine(reason);
  else ac.stopEngine(reason);
}

function holdEngineDead(ctx) {
  const ac = ctx.ac;
  if (typeof ac.failEngine === 'function') return;
  if (ac.starting > 0) ac.starting = 0;
  if (ac.engineOn) {
    ac.stopEngine('failure');
    ctx.sim.notify('The engine will not restart. Fly it down — you can do this.', 'warn');
  }
}

/**
 * Caps engine power.
 *
 * Engine addition A5 adds `powerLimit`, which the thrust and fuel-burn maths
 * respect. Without it the same feel comes from holding the player's own
 * throttle demand down, which is where the number really comes from.
 */
function holdPower(ctx, cap) {
  const ac = ctx.ac;
  if (ac.powerLimit !== undefined) {
    ac.powerLimit = cap;
    return;
  }
  const input = ctx.sim.input;
  if (input) {
    if (input.throttleTarget > cap) input.throttleTarget = cap;
    if (input.out && input.out.throttle > cap) input.out.throttle = cap;
  }
  if (ac.controls.throttle > cap) ac.controls.throttle = cap;
}

/**
 * Passenger comfort, the mechanic mission five introduces and mission fifteen
 * finishes with. Steep bank, hard pulls and dive-bombing descents cost points;
 * an ordinary gentle flight costs almost nothing.
 */
function comfortTick(ctx, dt) {
  const ac = ctx.ac;
  if (ac.onGround) return;
  const bank = Math.abs(ac.bankAngleDeg());
  const gErr = Math.abs(ac.gLoad - 1);
  const vs = Math.abs(fpm(ac.vs));
  let p = 0;
  if (bank > 25) p += (bank - 25) * 0.06;
  if (gErr > 0.35) p += (gErr - 0.35) * 9;
  if (vs > 900) p += (vs - 900) * 0.004;
  if (ac.stalled) p += 12;
  ctx.data.comfort = Math.max(0, (ctx.data.comfort ?? 100) - p * dt);
  const c = ctx.data.comfort;
  if (c < 75) sayOnce(ctx, 'comfort75', 'Your passenger has gone a bit quiet.', 'info');
  if (c < 55) sayOnce(ctx, 'comfort55', 'She is holding on to the seat — gentler, please.', 'warn');
  if (c < 40) sayOnce(ctx, 'comfort40', 'She has asked you to take it easy.', 'bad');
}

/* ------------------------------------------------------------------ */
/* Temporary props                                                     */
/* ------------------------------------------------------------------ */

/**
 * Props live on the sim between `onStart` and `onComplete`. The runner has no
 * failure hook, so a mission that is failed or abandoned would leak its props —
 * clearing at the start of every mission means at most one set is ever left in
 * the scene, and only until the next campaign mission begins.
 */
function addProp(sim, prop) {
  if (!sim._campaignProps) sim._campaignProps = [];
  sim._campaignProps.push(prop);
  if (prop.group && !prop.group.parent) sim.scene.add(prop.group);
  return prop;
}

function clearProps(sim) {
  for (const p of sim._campaignProps || []) {
    if (typeof p.dispose === 'function') p.dispose(sim.scene);
    if (p.group && p.group.parent) p.group.parent.remove(p.group);
  }
  sim._campaignProps = [];
}

/** An orange life raft with a dye slick and a smoke column you can see for miles. */
function makeRaft(pos) {
  const group = new THREE.Group();
  group.position.set(pos.x, 0, pos.z);
  const geometries = [];

  const raftGeo = new THREE.TorusGeometry(3, 0.8, 8, 18);
  geometries.push(raftGeo);
  const raft = new THREE.Mesh(
    raftGeo,
    new THREE.MeshStandardMaterial({ color: 0xff6a1e, emissive: 0x3a1200, roughness: 0.8 })
  );
  raft.rotation.x = -Math.PI / 2;
  raft.position.y = 0.6;
  group.add(raft);

  const slickGeo = new THREE.CircleGeometry(46, 28);
  geometries.push(slickGeo);
  const slick = new THREE.Mesh(
    slickGeo,
    new THREE.MeshBasicMaterial({ color: 0xffb03a, transparent: true, opacity: 0.3, depthWrite: false })
  );
  slick.rotation.x = -Math.PI / 2;
  slick.position.y = 0.25;
  group.add(slick);

  // The smoke, not the raft, is what a searching pilot actually spots: 120 m of
  // additive orange stands out against grey sea from roughly two and a half km.
  const smokeGeo = new THREE.CylinderGeometry(9, 2.6, 120, 10, 1, true);
  geometries.push(smokeGeo);
  const smoke = new THREE.Mesh(
    smokeGeo,
    new THREE.MeshBasicMaterial({
      color: 0xff7a2a,
      transparent: true,
      opacity: 0.3,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })
  );
  smoke.position.y = 62;
  group.add(smoke);

  return {
    group,
    update(dt, t) {
      group.position.y = Math.sin(t * 1.3) * 0.5;
      raft.rotation.z = Math.sin(t * 0.9) * 0.12;
      smoke.rotation.y = t * 0.15;
    },
    dispose() {
      for (const g of geometries) g.dispose();
    },
  };
}

/**
 * The raft the search mission looks for. Uses world addition W4 when the
 * scenery owner has landed it, and its own raft otherwise; the guard is there
 * because that class belongs to another module and its constructor may not take
 * what we guess it takes.
 */
function spawnRaft(sim, pos) {
  const SeaMarker = MARKERS.SeaMarker;
  if (typeof SeaMarker === 'function') {
    try {
      return addProp(sim, new SeaMarker(sim.scene, pos.clone()));
    } catch (err) {
      console.warn('SeaMarker refused those arguments — using the campaign raft.', err);
    }
  }
  return addProp(sim, makeRaft(pos));
}

/** The painted spot-landing box: exactly the area the mission scores you on. */
function makeTargetBox(centre, halfLen, halfWid) {
  const group = new THREE.Group();
  const geometries = [];
  const paint = (w, d, dx, dz, colour, opacity) => {
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    geometries.push(geo);
    const m = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity, depthWrite: false })
    );
    m.position.set(centre.x + dx, centre.y + 0.12, centre.z + dz);
    group.add(m);
  };
  // Four bars make the box you must land inside.
  paint(2.5, halfWid * 2, -halfLen, 0, 0xffffff, 0.95);
  paint(2.5, halfWid * 2, halfLen, 0, 0xffffff, 0.95);
  paint(halfLen * 2, 2.5, 0, -halfWid, 0xffffff, 0.95);
  paint(halfLen * 2, 2.5, 0, halfWid, 0xffffff, 0.95);
  // And a bullseye in the middle for the pilots who want the extra badge.
  paint(40, 6, 0, 0, 0xffd23f, 0.9);
  paint(6, 20, 0, 0, 0xffd23f, 0.9);
  return {
    group,
    dispose() {
      for (const g of geometries) g.dispose();
    },
  };
}

/* ------------------------------------------------------------------ */
/* 9. Kestrel Ridge Rescue                                             */
/* ------------------------------------------------------------------ */

function ridgeTick(ctx, dt) {
  const ac = ctx.ac;
  const d = ctx.data;
  watchAirborne(ctx);

  // Warn — do not fail — if they head for the hills before they have the height.
  if (!ac.onGround && ac.pos.z < -820 && ac.alt < 400 && ac.pos.x < 1500) {
    sayOnce(ctx, 'lowRidge', 'You are lower than the hills ahead. Turn back to the sea and climb first.', 'bad');
  }
  // The escape the briefing asks for: east, downhill, over falling ground.
  if (ac.pos.x > 1700 && ac.pos.z > -1700 && ac.pos.z < -1200) d.escapedEast = true;
  if (d.escapedEast == null && ac.pos.x < 400 && ac.pos.z > -900 && d.dropDistance != null) {
    d.escapedEast = false; // left the bowl the other way
  }
}

const ridgeDrop = {
  id: 'ridge-drop',
  name: 'Kestrel Ridge Rescue',
  short: 'Supply drop in the mountains',
  difficulty: 'Hard',
  icon: '⛰',
  blurb:
    'Two rangers are stranded on Kestrel Ridge, a thousand feet up in a bowl between the hills. Carry their supplies up there, drop them on the smoke, and get out the safe way — downhill to the east.',
  reward: 'Teaches mountain flying: clearing high ground, working inside a bowl and planning your way out before you go in.',
  briefing: [
    { speaker: 'Chief Pilot', text: 'Two rangers are stuck on Kestrel Ridge. The track up washed away in the night and their radio is dead.' },
    { speaker: 'Dispatch', text: 'One crate of food and blankets is in the back. One crate. There is no second one on the shelf.' },
    { speaker: 'Chief Pilot', text: 'The ridge sits in a bowl. There is a hill to the west of the target that is higher than the target, and the island summit is north-west of it. Do not try to leave that way.' },
    { speaker: 'Chief Pilot', text: 'Climb to at least 1,400 feet before you go anywhere near the hills. Drop low and slow over the orange smoke, then leave east, downhill, out over the sea.' },
    { speaker: 'Kestrel Tower', text: 'Wind is one four knots from the north-west, so the air over the ridge will be lumpy. Keep your speed up and your turns gentle.' },
  ],
  pay: 1050,
  xp: 220,
  requires: ['medevac', 'crosswind'],
  unlocks: 'Kestrel Ridge as a free-flight starting point, and the fuel emergency contract.',
  optional: [
    {
      id: 'ridge-runner',
      text: 'Leave the bowl to the east, downhill, before turning for home',
      check: (ctx) => ctx.data.escapedEast === true,
    },
    {
      id: 'pinpoint',
      text: 'Put the crate within 25 metres of the target',
      check: (ctx) => ctx.data.dropDistance != null && ctx.data.dropDistance < 25,
    },
  ],
  weather: { time: 'day', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 320 },
  spawn: RUNWAY_START,
  parTime: 480,
  timeLimit: 780,
  onStart: (ctx) => {
    clearProps(ctx.sim);
    ctx.sim.hasCargo = true;
    ctx.data.comfort = 100;
    ctx.sim.notify('Supplies loaded. One crate — there is no spare.', 'info');
  },
  onUpdate: (ctx, dt) => pump(ctx, ridgeTick),
  failIf: (ctx) => {
    pump(ctx, ridgeTick);
    if (ctx.data.dropMissed) return 'The supplies went over the ridge. The rangers will have to wait for the boat';
    return null;
  },
  steps: [
    {
      id: 'depart',
      text: 'Hold Shift for full power, lift off at 55 knots, and climb straight ahead down the valley.',
      hint: 'Shift is power, S pulls the nose up. Do not turn yet — the valley is the safest place to climb.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, cleared for take-off runway zero nine. The rangers are waiting on you.',
        voice: 'tower',
      },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.thresholdEast,
      check: (ctx) => ctx.ac.airborneTime > 3 && ctx.ac.agl > 30,
    },
    {
      id: 'climb',
      text: 'Climb to 1,400 feet before you turn towards the ridge. The hills ahead are 1,000 feet high.',
      hint: 'Full power, nose a little above the horizon, and watch the altimeter wind up to 1,400 feet.',
      atc: {
        text: 'Skylark one seven two, climb to one thousand four hundred feet before turning north. Terrain is high all along the ridge.',
        voice: 'approach',
      },
      check: (ctx) => ft(ctx.ac.alt) > 1400,
    },
    {
      id: 'cross',
      text: 'Now turn left and fly through the ring on the shoulder of the hill. Look for orange smoke on the ridge beyond it.',
      hint: 'Turn with A, then level the wings again. The ring is up the slope to the north-west of the runway.',
      targetLabel: 'Ridge station',
      gates: [{ pos: new THREE.Vector3(520, 520, -780), heading: 340, radius: 60 }],
    },
    {
      id: 'setup',
      text: 'Come down to below 400 feet above the ridge and slow to about 70 knots. Fly along the flat ground, not at the hill.',
      hint: 'Ease the power back with Ctrl. Below 400 feet above the ground and inside 500 metres of the smoke.',
      atc: {
        text: 'Sea Bird, this is Ranger Station. We can hear you. The wind is swirling up here — come in from the east if you can.',
        voice: 'ranger',
      },
      targetLabel: 'Ranger station',
      target: () => RIDGE_PAD,
      check: (ctx) => ft(ctx.ac.agl) < 400 && flatDist(ctx.ac.pos, RIDGE_PAD) < 500,
    },
    {
      id: 'drop',
      text: 'Press X to release the crate right over the target circle.',
      hint: 'Fly across the middle of the circle and press X. The slower you are, the closer it lands.',
      targetLabel: 'Ranger station',
      target: () => RIDGE_PAD,
      check: (ctx) => {
        const crate = ctx.sim.crate;
        if (!crate || !crate.landed) return false;
        const d = flatDist(crate.group.position, RIDGE_PAD);
        ctx.data.dropDistance = d;
        if (d > 70) {
          ctx.data.dropMissed = true;
          return false;
        }
        ctx.sim.notify(`Crate on the target — ${Math.round(d)} metres from the middle!`, 'good');
        return true;
      },
    },
    {
      id: 'escape',
      text: 'Turn east and fly downhill towards the sea. Never turn towards the higher ground to the west.',
      hint: 'East is to the right of the ring you came through. The ground drops away that way, so you will gain height without trying.',
      atc: { text: 'Sea Bird, supplies received. You have saved us a very cold week. Ranger Station out.', voice: 'ranger' },
      targetLabel: 'Open sea to the east',
      target: () => new THREE.Vector3(2400, 400, -1450),
      check: (ctx) => ctx.ac.pos.x > 1450 || ctx.ac.pos.z > -700,
    },
    {
      id: 'home',
      text: 'Fly back round to the west of the island and line up with runway 09.',
      hint: 'You land heading east, so you must start from the west. Follow the arrow round.',
      atc: { text: 'Skylark one seven two, Kestrel Tower, join for runway zero nine, cleared to land.', voice: 'tower' },
      targetLabel: 'Runway 09 approach',
      target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1800, 240, 0)),
      check: (ctx) => linedUpFor09(ctx),
    },
    {
      id: 'land',
      text: 'Land on runway 09 and bring the aeroplane to a stop.',
      hint: 'Two white and two red on the PAPI lights means you are on the perfect glide path.',
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    clearProps(ctx.sim);
    ctx.sim.speak(
      'Skylark one seven two, the rangers are on the radio thanking you personally. Welcome home.',
      'tower'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const drop = ctx.data.dropDistance != null ? Math.max(0, 1 - ctx.data.dropDistance / 70) : 0;
    const time = Math.max(0, 1 - ctx.elapsed / 780);
    return Math.round(drop * 45 + (l ? l.score : 40) * 0.35 + time * 20);
  },
};

/* ------------------------------------------------------------------ */
/* 10. Running on Fumes                                                */
/* ------------------------------------------------------------------ */

function fuelTick(ctx, dt) {
  const ac = ctx.ac;
  const d = ctx.data;
  watchAirborne(ctx);

  // The leak, on top of whatever the engine is drinking.
  ac.fuel = Math.max(0, ac.fuel - 0.012 * dt);

  if (ctx.elapsed > 20 && ac.controls.throttle > 0.7) d.throttleDiscipline = false;
  if (!ac.engineOn && !d.wentQuiet && !ac.onGround) {
    d.wentQuiet = true;
    ctx.sim.notify('The engine has stopped. Lower the nose to 70 knots and glide it in — you have the height.', 'bad');
  }
  if (ac.fuel < 3 && !d.warnedThree) {
    d.warnedThree = true;
    ctx.sim.notify('Three litres left. Straight in, no messing about.', 'warn');
  }
}

const lowFuel = {
  id: 'low-fuel',
  name: 'Running on Fumes',
  short: 'Get home on what is left',
  difficulty: 'Hard',
  icon: '⛽',
  blurb:
    'You are coming back from Mango Cay when the fuel gauge starts falling far too quickly. There is a leak. Fly straight home, use as little fuel as you can, and land.',
  reward: 'Teaches fuel management: less power goes further, and the straight-in approach beats the pretty one.',
  briefing: [
    { speaker: 'Dispatch', text: 'Skylark one seven two, your fuel gauge is dropping about four times faster than it should. You have a leak somewhere behind the engine.' },
    { speaker: 'Chief Pilot', text: 'Do not panic. Turn towards the island now and pull the power back to about sixty per cent — a slower aeroplane burns far less and still gets there.' },
    { speaker: 'Kestrel Tower', text: 'You are coming in from the east, so take runway two seven, straight in, into the wind. No circuit. The runway is yours.' },
    { speaker: 'Chief Pilot', text: 'If it does go quiet on you, that is not the end. From 2,400 feet you can glide about two miles. Nose down to seventy knots and keep flying it.' },
  ],
  pay: 900,
  xp: 240,
  requires: ['ridge-drop'],
  unlocks: 'Storm operations.',
  optional: [
    {
      id: 'still-something-left',
      text: 'Land with more than 1.5 litres still in the tank',
      check: (ctx) => ctx.ac.fuel > 1.5,
    },
    {
      id: 'disciplined',
      text: 'Never open the throttle past 70% after the first twenty seconds',
      check: (ctx) => ctx.data.throttleDiscipline !== false,
    },
  ],
  weather: { time: 'day', condition: 'clear', windSpeedKts: 8, windDirDeg: 250 },
  // Over water `reset()` measures altAGL from the sea bed at -34 m, so 766
  // puts the aeroplane at 732 m — 2,400 feet above the waves.
  spawn: {
    pos: new THREE.Vector3(6600, 0, -3900),
    headingDeg: 300,
    speed: 58,
    altAGL: 766,
    engineOn: true,
  },
  parTime: 300,
  timeLimit: 420,
  onStart: (ctx) => {
    clearProps(ctx.sim);
    // Engine addition A3 plumbs `spawn.fuel` through `reset()`. Setting it here
    // works today because `onStart` runs after the aeroplane is placed.
    ctx.ac.fuel = 9.0;
    ctx.data.throttleDiscipline = true;
    ctx.sim.notify('Fuel gauge falling fast — you are losing fuel.', 'bad');
  },
  onUpdate: (ctx, dt) => pump(ctx, fuelTick),
  failIf: (ctx) => {
    pump(ctx, fuelTick);
    return null;
  },
  steps: [
    {
      id: 'turn-home',
      text: 'Turn towards Kestrel Island and pull the power back to about 60% with Ctrl. Slower burns less.',
      hint: 'Follow the arrow. Watch the green power bar: about two thirds of the way up is right.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, we have your emergency. Come straight home, we are keeping everybody else out of your way.',
        voice: 'tower',
        urgency: 1,
      },
      targetLabel: 'Kestrel Island',
      target: () => RUNWAY.thresholdEast.clone().add(new THREE.Vector3(1400, 180, 0)),
      check: (ctx) => ctx.ac.pos.distanceTo(RUNWAY.touchdown) < 6200,
    },
    {
      id: 'straight-in',
      text: 'Line up with the runway from the east. You are landing on runway 27, heading west, into the wind.',
      hint: 'Aim to be pointing due west with the runway straight ahead. Start letting the height come off now.',
      atc: {
        text: 'Skylark one seven two, runway two seven, cleared to land. Wind two five zero at eight. Fire crews are standing by.',
        voice: 'tower',
      },
      targetLabel: 'Runway 27 threshold',
      target: () => RUNWAY.thresholdEast,
      check: (ctx) =>
        ctx.ac.pos.x < 2600 &&
        ctx.ac.pos.x > RUNWAY.thresholdEast.x &&
        Math.abs(ctx.ac.pos.z) < 700 &&
        Math.abs(((ctx.ac.heading - 270 + 540) % 360) - 180) < 55,
    },
    {
      id: 'land',
      text: 'Land on the runway and stop. There are no PAPI lights from this end — judge it by eye.',
      hint: 'Aim at the near end of the tarmac, keep about 65 knots, and flare gently just before the wheels touch.',
      targetLabel: 'Runway',
      target: () => new THREE.Vector3(350, ELEV, 0),
      check: (ctx) => landedAndStopped(ctx) && ctx.data.lastTouchdown.onRunway,
    },
  ],
  onComplete: (ctx) => {
    clearProps(ctx.sim);
    const litres = Math.max(0, ctx.ac.fuel).toFixed(1);
    ctx.sim.speak(
      'Skylark one seven two, shut down where you are, the tug is coming to you. Nicely flown.',
      'tower'
    );
    ctx.sim.notify(`On the ground with ${litres} litres left. That is how you fly an emergency.`, 'good');
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const spare = Math.min(1, Math.max(0, ctx.ac.fuel / 4));
    return Math.round((l ? l.score : 40) * 0.55 + spare * 30 + (ctx.data.throttleDiscipline !== false ? 15 : 0));
  },
};

/* ------------------------------------------------------------------ */
/* 11. Storm Approach                                                  */
/* ------------------------------------------------------------------ */

const CLOUD_CEILING_M = 670; // 2,200 feet: the base of the storm cloud, near enough.

function stormTick(ctx, dt) {
  const ac = ctx.ac;
  const d = ctx.data;
  watchAirborne(ctx);

  if (ac.alt > CLOUD_CEILING_M && !ac.onGround) {
    d.inCloud = (d.inCloud || 0) + dt;
    if (d.inCloud > 4) sayOnce(ctx, 'cloud', 'You are in the cloud — get back down where you can see the sea.', 'bad');
  } else {
    d.inCloud = 0;
  }
  if (ac.pos.distanceTo(RUNWAY.touchdown) < 3000 && Math.abs(ac.bankAngleDeg()) > 30) d.steadyHands = false;
}

const stormApproach = {
  id: 'storm',
  name: 'Storm Approach',
  short: 'Land in a thunderstorm',
  difficulty: 'Hard',
  icon: '⚡',
  blurb:
    'A thunderstorm has parked itself over Kestrel Island and you are out to the west in it. The cloud sits at 1,800 feet and the air will throw you around. Fly small, steady corrections all the way to the runway.',
  reward: 'Teaches flying in air that moves the aeroplane on its own: small corrections, and a firm landing on purpose.',
  briefing: [
    { speaker: 'Kestrel Tower', text: 'Skylark one seven two, Kestrel Tower. Wind three five two at two four, gusting hard. Visibility poor in heavy rain.' },
    { speaker: 'Chief Pilot', text: 'The cloud base is low. Stay under 2,200 feet the whole way in — if you go up into it you lose sight of the sea and we lose you.' },
    { speaker: 'Chief Pilot', text: 'The air will shove you about. Make one small correction, wait, then make the next one. Chasing it makes everything worse.' },
    { speaker: 'Kestrel Tower', text: 'And do not try to grease this one on. In this wind a firm, positive landing is the safe landing. Plant it and keep it straight.' },
  ],
  pay: 1150,
  xp: 260,
  requires: ['low-fuel'],
  unlocks: 'The Storm Front weather preset in the Hangar.',
  optional: [
    {
      id: 'steady-hands',
      text: 'Never bank past 30 degrees inside 3 km of the runway',
      check: (ctx) => ctx.data.steadyHands !== false,
    },
    {
      id: 'firm-but-fair',
      text: 'Touch down between 150 and 500 feet per minute — firm, on purpose',
      check: (ctx) => {
        const l = ctx.data.lastTouchdown;
        if (!l) return false;
        const s = Math.abs(l.vsFpm);
        return s >= 150 && s <= 500;
      },
    },
  ],
  weather: { time: 'sunset', condition: 'stormy', windSpeedKts: 24, windDirDeg: 352 },
  // 504 above the sea bed is 470 m above the waves — about 1,540 feet, safely
  // under the 1,800-foot storm cloud base.
  spawn: {
    pos: new THREE.Vector3(-6800, 0, 40),
    headingDeg: 90,
    speed: 58,
    altAGL: 504,
    engineOn: true,
  },
  parTime: 300,
  timeLimit: 420,
  onStart: (ctx) => {
    clearProps(ctx.sim);
    ctx.data.steadyHands = true;
    ctx.sim.notify('Stay below 2,200 feet so you can keep the sea in sight.', 'warn');
  },
  onUpdate: (ctx, dt) => pump(ctx, stormTick),
  failIf: (ctx) => {
    pump(ctx, stormTick);
    if ((ctx.data.inCloud || 0) > 10) return 'You lost sight of the sea in the cloud';
    return null;
  },
  steps: [
    {
      id: 'inbound',
      text: 'Fly east towards the island, staying below 2,200 feet. The wind is pushing you from the left, so point the nose slightly into it.',
      hint: 'Small, gentle inputs. Let the aeroplane settle after each one before you make the next.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, wind three five two at two four gusting. Runway zero nine, cleared to land. Caution, wind shear on final.',
        voice: 'tower',
        urgency: 1,
      },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      check: (ctx) => ctx.ac.pos.distanceTo(RUNWAY.touchdown) < 4200,
    },
    {
      id: 'final',
      text: 'Follow the PAPI lights: two white and two red. Keep the wings as level as the wind lets you.',
      hint: 'All red means too low, add power. All white means too high, take some off.',
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: (ctx) => ft(ctx.ac.agl) < 220 && ctx.ac.pos.x > RUNWAY.thresholdWest.x - 1400,
    },
    {
      id: 'land',
      text: 'Straighten the nose just before the wheels touch, and put it down firmly.',
      hint: 'A firm landing is the right landing today. Keep it on the tarmac and let the brakes do the rest.',
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    clearProps(ctx.sim);
    ctx.sim.speak(
      'Skylark one seven two, that was a fine piece of flying in filthy weather. Welcome back to Kestrel.',
      'tower'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const base = l ? l.score : 30;
    return Math.round(base * 0.8 + (ctx.data.steadyHands !== false ? 12 : 0) + 8);
  },
};

/* ------------------------------------------------------------------ */
/* 12. Dead Stick                                                      */
/* ------------------------------------------------------------------ */

function deadStickTick(ctx, dt) {
  const ac = ctx.ac;
  const d = ctx.data;
  watchAirborne(ctx);

  if (!d.engineKilled) return;
  holdEngineDead(ctx);

  const speed = kt(ac.ias);
  if (!ac.onGround && speed > 62 && speed < 74) d.glideSeconds = (d.glideSeconds || 0) + dt;
  if (d.noFlapPanic == null && ac.pos.x > -1200) d.noFlapPanic = ac.flapStep() === 0;
  if (!ac.onGround && speed < 55) {
    sayOnce(ctx, 'slow', 'Too slow — lower the nose. Seventy knots glides furthest.', 'bad');
  }
}

const deadStick = {
  id: 'dead-stick',
  name: 'Dead Stick',
  short: 'Land with no engine',
  difficulty: 'Hard',
  icon: '✖',
  blurb:
    'Somewhere over the water west of the island, the engine is going to stop. You will have plenty of height and the runway straight ahead. Glide it home and land — no engine, no second go.',
  reward: 'Teaches the forced landing: hold 70 knots, trade height for distance, and leave the flaps alone until the runway is certain.',
  briefing: [
    { speaker: 'Chief Pilot', text: 'Today we practise the one nobody wants: the engine stopping. You will be at 2,600 feet, three miles west, with the runway dead ahead.' },
    { speaker: 'Chief Pilot', text: 'When it goes quiet, do not touch anything for a moment. Lower the nose until the speed reads seventy knots. That is the speed that glides furthest.' },
    { speaker: 'Chief Pilot', text: 'From that height, seventy knots buys you about four miles of gliding. The runway is under three. You have the height — do not waste it wandering about.' },
    { speaker: 'Chief Pilot', text: 'Leave the flaps at zero until you are certain you will reach the tarmac. Flaps make you sink, and you cannot get that height back.' },
    { speaker: 'Kestrel Tower', text: 'Runway zero nine is clear and it is yours. Nothing else is moving. Take your time.' },
  ],
  pay: 1000,
  xp: 280,
  requires: ['storm'],
  unlocks: 'Search-and-rescue duty.',
  optional: [
    {
      id: 'best-glide',
      text: 'Hold between 62 and 74 knots for at least 45 seconds of the glide',
      check: (ctx) => (ctx.data.glideSeconds || 0) >= 45,
    },
    {
      id: 'no-flap-panic',
      text: 'Reach the coast with the flaps still up',
      check: (ctx) => ctx.data.noFlapPanic === true,
    },
  ],
  weather: { time: 'day', condition: 'clear', windSpeedKts: 6, windDirDeg: 90 },
  // 826 above the sea bed is 792 m above the waves: 2,600 feet.
  spawn: {
    pos: new THREE.Vector3(-5200, 0, 0),
    headingDeg: 90,
    speed: 55,
    altAGL: 826,
    engineOn: true,
  },
  parTime: 260,
  timeLimit: 360,
  onStart: (ctx) => {
    clearProps(ctx.sim);
    ctx.data.glideSeconds = 0;
  },
  onUpdate: (ctx, dt) => pump(ctx, deadStickTick),
  failIf: (ctx) => {
    pump(ctx, deadStickTick);
    return null;
  },
  steps: [
    {
      id: 'cruise',
      text: 'Fly east towards the island. Everything is normal — for now.',
      hint: 'Keep the wings level and the runway ahead of you.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, you are three miles west, runway zero nine, report on final.',
        voice: 'tower',
      },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      duration: 15,
      check: (ctx) => ctx.runner.stepElapsed > 15,
    },
    {
      id: 'failure',
      text: 'The engine has stopped. Lower the nose with W until the speed reads 70 knots. The runway is straight ahead of you.',
      hint: 'Nose down to 70 knots. Do not turn, do not touch the flaps — just point at the runway and glide.',
      atc: {
        text: 'Do not touch anything yet. Lower the nose until the speed reads seventy knots. The runway is straight ahead of you.',
        voice: 'instructor',
        urgency: 1,
      },
      enter: (ctx) => {
        killEngine(ctx.ac, 'oil pressure');
        ctx.data.engineKilled = true;
        if (ctx.sim.audio && ctx.sim.audio.available && ctx.sim.audio.ambience.playFlaps) {
          ctx.sim.audio.ambience.playFlaps();
        }
        ctx.sim.notify('Engine failure! Nose down to 70 knots and glide to the runway.', 'bad');
      },
      targetLabel: 'Runway 09',
      target: () => RUNWAY.touchdown,
      check: (ctx) => kt(ctx.ac.ias) < 78 && kt(ctx.ac.ias) > 58 && ctx.runner.stepElapsed > 6,
    },
    {
      id: 'glide',
      text: 'Hold 70 knots all the way to the runway. Aim a little way in from the near end.',
      hint: 'Faster than 75 and you are wasting height. Slower than 65 and you are sinking. Keep it at 70.',
      atc: { text: 'Skylark one seven two, runway zero nine, cleared to land. The field is clear for you.', voice: 'tower' },
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: (ctx) => ctx.ac.pos.x > RUNWAY.thresholdWest.x - 1200 && ft(ctx.ac.agl) < 320,
    },
    {
      id: 'land',
      text: 'Flaps down now if you need them, then land on the runway and stop.',
      hint: 'F puts the flaps down a step: more lift and more drag, so use them only once the runway is certain.',
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    clearProps(ctx.sim);
    ctx.sim.speak(
      'Skylark one seven two, dead stick, on the runway, on your first go. That is a proper piece of flying.',
      'tower'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const glide = Math.min(1, (ctx.data.glideSeconds || 0) / 45);
    return Math.round((l ? l.score : 40) * 0.65 + glide * 25 + 10);
  },
};

/* ------------------------------------------------------------------ */
/* 13. Search and Rescue                                               */
/* ------------------------------------------------------------------ */

/** Three fixed places the raft can be, all verified deep water. */
const RAFT_SPOTS = [
  new THREE.Vector3(-4250, 0, -1650),
  new THREE.Vector3(-3400, 0, -4750),
  new THREE.Vector3(-1750, 0, -4400),
];

function searchTick(ctx, dt) {
  const ac = ctx.ac;
  const d = ctx.data;
  watchAirborne(ctx);

  if (d.raftProp && typeof d.raftProp.update === 'function') d.raftProp.update(dt, ctx.elapsed);
  if (ctx.sim.navGuide && ctx.sim.navGuide.enabled && !d.foundAt) d.eyesOut = false;
  if (!d.raftPos) return;

  const dist = flatDist(ac.pos, d.raftPos);
  d.raftDistance = dist;

  // Circling: add up how much of the way round the raft the aeroplane has gone.
  // Leaving the 400 m circle starts the lap again, which is exactly what a real
  // "hold overhead so the cutter can find them" looks like.
  if (d.marking) {
    const bearing = Math.atan2(ac.pos.z - d.raftPos.z, ac.pos.x - d.raftPos.x);
    if (dist < 400) {
      if (d.lastBearing != null) {
        let step = bearing - d.lastBearing;
        while (step > Math.PI) step -= Math.PI * 2;
        while (step < -Math.PI) step += Math.PI * 2;
        d.circled = (d.circled || 0) + step;
      }
      d.lastBearing = bearing;
    } else if (d.lastBearing != null) {
      d.lastBearing = null;
      if (Math.abs(d.circled || 0) > 0.6) {
        d.circled = 0;
        ctx.sim.notify('You drifted too far out — come back inside 400 metres and start the circle again.', 'warn');
      }
    }
  }
}

const searchRescue = {
  id: 'search-rescue',
  name: 'Search and Rescue',
  short: 'Find a missing boat',
  difficulty: 'Hard',
  icon: '🔍',
  blurb:
    'A fishing boat has gone down somewhere in the north-west sector and nobody knows where. There is no arrow to follow this time. Fly a proper search pattern, spot the orange smoke, and circle it so the coastguard can reach them.',
  reward: 'Teaches searching: a deliberate low pattern over water, and looking out of the window instead of at the instruments.',
  briefing: [
    { speaker: 'Kestrel Tower', text: 'Mayday relay. A fishing boat is overdue somewhere in the north-west sector. They got one call out and then nothing.' },
    { speaker: 'Doctor Reyes', text: 'There will be people in the water. The sooner you find them, the better their chances. Do not rush it into a crash, though — a second casualty helps nobody.' },
    { speaker: 'Chief Pilot', text: 'Your search box runs from the coastguard cutter Kestrel Guard out west, and north past the Needle Rock lighthouse. Those two are your landmarks.' },
    { speaker: 'Chief Pilot', text: 'Fly a creeping line: a long leg west, turn, step 800 metres north, a long leg back east. The rings show you the first leg, then you are on your own.' },
    { speaker: 'Chief Pilot', text: 'Stay under 1,000 feet and slow, or you will fly straight over them. Look for orange smoke — it stands 400 feet up and you can see it from a mile and a half.' },
  ],
  pay: 1350,
  xp: 300,
  requires: ['dead-stick'],
  unlocks: 'The precision-landing course.',
  optional: [
    {
      id: 'first-pass',
      text: 'Find the raft within the first five minutes',
      check: (ctx) => ctx.data.foundAt != null && ctx.data.foundAt < 300,
    },
    {
      id: 'eyes-out',
      text: 'Search with the guidance line switched off (press G)',
      check: (ctx) => ctx.data.eyesOut === true,
    },
  ],
  weather: { time: 'day', condition: 'cloudy', windSpeedKts: 12, windDirDeg: 40 },
  spawn: RUNWAY_START,
  parTime: 600,
  timeLimit: 900,
  onStart: (ctx) => {
    clearProps(ctx.sim);
    const spot = RAFT_SPOTS[Math.floor(Math.random() * RAFT_SPOTS.length)];
    ctx.data.raftPos = spot.clone();
    ctx.data.raftProp = spawnRaft(ctx.sim, spot);
    ctx.data.eyesOut = true;
    ctx.data.circled = 0;
  },
  onUpdate: (ctx, dt) => pump(ctx, searchTick),
  failIf: (ctx) => {
    pump(ctx, searchTick);
    return null;
  },
  steps: [
    {
      id: 'launch',
      text: 'Take off from runway 09, then turn left and climb to about 900 feet. Head out to the coastguard cutter to the north-west.',
      hint: 'Full power with Shift, up at 55 knots, then a left turn with A once you are past the end of the runway.',
      atc: {
        text: 'Skylark one seven two, cleared for immediate take-off runway zero nine. Kestrel Guard is anchored north-west of the field and will be your marker.',
        voice: 'tower',
        urgency: 1,
      },
      targetLabel: 'Kestrel Guard',
      target: () => CUTTER,
      check: (ctx) => flatDist(ctx.ac.pos, CUTTER) < 900 && ctx.ac.airborneTime > 10,
    },
    {
      id: 'first-leg',
      text: 'Fly the first search leg west through the three rings, at about 600 feet and 80 knots.',
      hint: 'Straight and level, due west. This is what every leg after this one should look like.',
      atc: {
        text: 'Sea Bird, Kestrel Guard. We will work east of you. Fly your legs west and east and step north each time. Good hunting.',
        voice: 'traffic',
      },
      targetLabel: 'Search leg',
      gates: [
        { pos: new THREE.Vector3(-1900, 180, -2200), heading: 270, radius: 60 },
        { pos: new THREE.Vector3(-3400, 180, -2200), heading: 270, radius: 60 },
        { pos: new THREE.Vector3(-4600, 180, -2200), heading: 270, radius: 60 },
      ],
    },
    {
      id: 'search',
      text: 'No more rings. Turn north 800 metres, fly back east, and keep stepping. Stay under 1,000 feet and look out of the window for orange smoke.',
      hint: 'North is 360 on the compass, west is 270, east is 090. Keep the legs straight and count your steps — a tidy pattern finds people.',
      // No `target`, on purpose: this is the first time the game does not tell
      // the player where to go. The guidance line falls back to the runway,
      // which is honest — it points home, not at something nobody has found yet.
      check: (ctx) => {
        const d = ctx.data;
        if (!d.raftPos) return false;
        const dist = flatDist(ctx.ac.pos, d.raftPos);
        if (dist > 260) return false;
        if (ctx.ac.alt > 300) {
          sayOnce(ctx, 'tooHigh', 'Something orange below you — come down under 1,000 feet for a proper look.', 'warn');
          return false;
        }
        if (ctx.ac.ias > 45) {
          sayOnce(ctx, 'tooFast', 'Slow down to under 85 knots so you can see what is in the water.', 'warn');
          return false;
        }
        d.foundAt = ctx.elapsed;
        ctx.sim.notify('Life raft spotted! Circle it so the cutter can find them.', 'good');
        return true;
      },
    },
    {
      id: 'mark',
      text: 'Fly one complete circle all the way round the raft, staying inside 400 metres, so the cutter gets an exact position.',
      hint: 'Hold a gentle turn with A or D and keep the raft out of your side window. One full lap is all it takes.',
      atc: {
        text: 'Sea Bird, Kestrel Guard, we have your smoke. Hold overhead and we will be with them in twenty minutes.',
        voice: 'traffic',
      },
      targetLabel: 'Life raft',
      target: (ctx) => ctx.data.raftPos || null,
      enter: (ctx) => {
        ctx.data.marking = true;
        ctx.data.circled = 0;
        ctx.data.lastBearing = null;
      },
      check: (ctx) => Math.abs(ctx.data.circled || 0) > Math.PI * 1.94,
      onDone: (ctx) => {
        ctx.data.marking = false;
        ctx.sim.notify('Position marked. The cutter is on its way.', 'good');
      },
    },
    {
      id: 'home',
      text: 'Good work. Fly back to Kestrel Island and line up with runway 09 from the west.',
      hint: 'Home is south-east of you. Follow the arrow, then swing round to the west of the runway.',
      atc: { text: 'Skylark one seven two, come on home. Runway zero nine, cleared to land.', voice: 'tower' },
      targetLabel: 'Runway 09 approach',
      target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1800, 240, 0)),
      check: (ctx) => linedUpFor09(ctx),
    },
    {
      id: 'land',
      text: 'Land on runway 09 and bring the aeroplane to a stop.',
      hint: 'Two white and two red on the PAPI lights is the perfect glide path.',
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: landedAndStopped,
    },
  ],
  onComplete: (ctx) => {
    clearProps(ctx.sim);
    ctx.sim.speak(
      'Skylark one seven two, Kestrel Guard has all four of them aboard, wet and cross and alive. That was your doing.',
      'tower'
    );
  },
  score: (ctx) => {
    const l = ctx.data.lastTouchdown;
    const found = ctx.data.foundAt != null ? Math.max(0.2, 1 - ctx.data.foundAt / 600) : 0;
    return Math.round(found * 45 + (l ? l.score : 40) * 0.4 + (ctx.data.eyesOut ? 15 : 0));
  },
};

/* ------------------------------------------------------------------ */
/* 14. Precision Landing                                               */
/* ------------------------------------------------------------------ */

const SPOT = RUNWAY.touchdown; // (-350, 14, 0)
const SPOT_HALF_LEN = 60;
const SPOT_HALF_WID = 10;

function precisionTick(ctx, dt) {
  const d = ctx.data;
  watchAirborne(ctx);
  const landing = newLanding(ctx);
  if (!landing) return;

  const g = landing.grade;
  const alongErr = Math.abs(landing.x - SPOT.x);
  const off = Math.abs(g.centreline);
  const sink = landing.vsFpm;
  const good = g.onRunway && alongErr < SPOT_HALF_LEN && sink < 400 && off < SPOT_HALF_WID;

  d.attempts = (d.attempts || 0) + 1;
  if (good) {
    d.streak = (d.streak || 0) + 1;
    d.greasers = (d.greasers || 0) + (sink < 200 ? 1 : 0);
    if (alongErr < 20 && off < 3) d.deadCentre = true;
    ctx.sim.notify(
      `Landing ${d.streak} of 3 — ${Math.round(alongErr)} m from the mark, ${Math.round(sink)} feet a minute.`,
      'good'
    );
  } else {
    const why = !g.onRunway
      ? 'that was off the runway'
      : alongErr >= SPOT_HALF_LEN
        ? `you touched down ${Math.round(alongErr)} m from the box`
        : off >= SPOT_HALF_WID
          ? `you were ${Math.round(off)} m off the centreline`
          : `that was ${Math.round(sink)} feet a minute — too hard`;
    d.streak = 0;
    d.greasers = 0;
    d.deadCentre = false;
    ctx.sim.notify(`Back to zero: ${why}. Go around and try again.`, 'warn');
  }
}

const precision = {
  id: 'precision',
  name: 'Precision Landing',
  short: 'Three landings on the spot',
  difficulty: 'Expert',
  icon: '◉',
  blurb:
    'There is a white box painted on runway 09. Put the wheels inside it three times in a row, gently and on the centreline. Miss any part of it and the count goes back to zero.',
  reward: 'Teaches the spot landing: choosing a point, flying a stable approach and arriving exactly there, three times running.',
  briefing: [
    { speaker: 'Chief Pilot', text: 'Every landing you have done so far only had to be on the runway. This one has to be on the spot.' },
    { speaker: 'Chief Pilot', text: 'The ground crew have painted a box across the touchdown zone. The wheels go inside it, within ten metres of the centreline, at under 400 feet a minute.' },
    { speaker: 'Chief Pilot', text: 'Three in a row. If one is out, you go back to zero — so fly a steady approach rather than a clever one.' },
    { speaker: 'Kestrel Tower', text: 'Wind one two zero at ten, so there is a little push from your right on final. Correct for it early and it will not surprise you.' },
    { speaker: 'Chief Pilot', text: 'You are already airborne two miles west, at 1,000 feet. Take the first one straight in.' },
  ],
  pay: 1250,
  xp: 320,
  requires: ['search-rescue'],
  unlocks: 'Hard mode — guidance and hints off — and the captain’s test.',
  optional: [
    {
      id: 'three-greasers',
      text: 'All three landings softer than 200 feet per minute',
      check: (ctx) => (ctx.data.greasers || 0) >= 3,
    },
    {
      id: 'dead-centre',
      text: 'One landing within 20 m of the mark and 3 m of the centreline',
      check: (ctx) => ctx.data.deadCentre === true,
    },
  ],
  weather: { time: 'day', condition: 'clear', windSpeedKts: 10, windDirDeg: 120 },
  // 354 above the sea bed is 320 m above the waves: about 1,050 feet, which is
  // a sensible height to be at two miles out on a straight-in approach.
  spawn: {
    pos: new THREE.Vector3(-3400, 0, -60),
    headingDeg: 90,
    speed: 58,
    altAGL: 354,
    engineOn: true,
  },
  parTime: 560,
  timeLimit: 900,
  onStart: (ctx) => {
    clearProps(ctx.sim);
    addProp(ctx.sim, makeTargetBox(SPOT, SPOT_HALF_LEN, SPOT_HALF_WID));
    ctx.data.streak = 0;
    ctx.data.attempts = 0;
  },
  onUpdate: (ctx, dt) => pump(ctx, precisionTick),
  failIf: (ctx) => {
    pump(ctx, precisionTick);
    return null;
  },
  steps: [
    {
      id: 'first',
      text: 'Land inside the white box: gently, on the centreline. You may keep rolling and take off again afterwards.',
      hint: 'Aim at the near edge of the box and hold your approach steady. Do not dive at it at the last second.',
      atc: {
        text: 'Skylark one seven two, runway zero nine, cleared for the option. Wind one two zero at one zero.',
        voice: 'tower',
      },
      targetLabel: 'Target box',
      target: () => SPOT,
      check: (ctx) => (ctx.data.streak || 0) >= 1,
    },
    {
      id: 'second',
      text: 'One down. Take off again, fly a left-hand circuit, and land in the box a second time.',
      hint: 'Climb straight ahead to 1,000 feet, turn left twice onto the downwind leg, then left again onto final.',
      atc: { text: 'Skylark one seven two, cleared for the option, left-hand circuit.', voice: 'tower' },
      targetLabel: 'Circuit',
      target: (ctx) =>
        !ctx.ac.onGround && ctx.ac.pos.x > -2000
          ? new THREE.Vector3(-300, ELEV + 330, -1250)
          : SPOT,
      check: (ctx) => (ctx.data.streak || 0) >= 2,
    },
    {
      id: 'third',
      text: 'Two in a row. One more, exactly the same as the last one.',
      hint: 'Do not change anything. The same circuit, the same speeds, the same aiming point.',
      atc: { text: 'Skylark one seven two, cleared for the option. Last one, make it your best.', voice: 'tower' },
      targetLabel: 'Circuit',
      target: (ctx) =>
        !ctx.ac.onGround && ctx.ac.pos.x > -2000
          ? new THREE.Vector3(-2900, ELEV + 240, -120)
          : SPOT,
      check: (ctx) => (ctx.data.streak || 0) >= 3,
    },
  ],
  onComplete: (ctx) => {
    clearProps(ctx.sim);
    ctx.sim.speak(
      'Skylark one seven two, three for three in the box. The chief pilot says you have earned the checkride.',
      'tower'
    );
  },
  score: (ctx) => {
    const attempts = Math.max(3, ctx.data.attempts || 3);
    const tidy = 3 / attempts; // three attempts for three landings is perfect
    return Math.round(55 + tidy * 30 + (ctx.data.greasers || 0) * 5);
  },
};

/* ------------------------------------------------------------------ */
/* 15. The Captain's Test                                              */
/* ------------------------------------------------------------------ */

const ROUGH_POWER = 0.55;

function captainTick(ctx, dt) {
  const ac = ctx.ac;
  const d = ctx.data;
  watchAirborne(ctx);
  comfortTick(ctx, dt);

  if (d.roughRunning) holdPower(ctx, ROUGH_POWER);

  const landing = newLanding(ctx);
  if (!landing) return;

  if (flatDist(landing, CAY_STRIP.centre) < 1400) {
    const o = stripOffsets(landing.x, landing.z);
    d.cayLanding = { across: Math.abs(o.across), along: o.along, vsFpm: landing.vsFpm };
    if (d.cayLanding.across <= 60) {
      ctx.sim.notify(
        `On the strip, ${Math.round(d.cayLanding.across)} m off the centreline. Nicely judged.`,
        'good'
      );
    }
  } else if (landing.grade.onRunway) {
    d.homeLanding = { score: landing.grade.score, vsFpm: landing.vsFpm };
    if (landing.grade.score < 55) {
      ctx.sim.notify(
        'That was untidy for a captain. Take off, go round the circuit and land it properly.',
        'warn'
      );
    }
  }
  // Both landings count towards the "gentle for the passenger" badge.
  if (landing.vsFpm > 350) d.bothGentle = false;
}

const captainsTest = {
  id: 'captains-test',
  name: "The Captain's Test",
  short: 'Everything, all at once',
  difficulty: 'Expert',
  icon: '★',
  blurb:
    'One flight, at dusk, in the rain, with a doctor in the seat beside you: out to Mango Cay, collect a patient, and bring them home. Nobody is going to talk you through it, and the aeroplane may not stay perfect.',
  reward: 'The captain’s rank. Everything the campaign has taught you, unprompted, with a surprise in the middle.',
  briefing: [
    { speaker: 'Chief Pilot', text: 'This is your checkride. I am not going to tell you how to do any of it — you already know.' },
    { speaker: 'Doctor Reyes', text: 'I am flying with you. There is a patient on Mango Cay who needs to be at Kestrel tonight, and I would rather arrive without feeling ill, if that is all right.' },
    { speaker: 'Chief Pilot', text: 'Out to the cay, land on the grass strip on runway one six from the north, pick them up, then take off on three four and come home.' },
    { speaker: 'Kestrel Tower', text: 'Wind zero four zero at one eight, rain, cloud at 2,500 feet. That is a strong crosswind on runway zero nine and the tarmac will be slippery.' },
    { speaker: 'Chief Pilot', text: 'Fly it gently, land it properly, and the island is yours. Good luck, Captain.' },
  ],
  pay: 2400,
  xp: 400,
  requires: ['precision'],
  unlocks: 'The rank of Captain of Kestrel Island, the Night Black and Gold livery, and the credits.',
  optional: [
    {
      id: 'captain-material',
      text: 'Score 80 or better on the final landing',
      check: (ctx) => !!ctx.data.homeLanding && ctx.data.homeLanding.score >= 80,
    },
    {
      id: 'bedside-manner',
      text: 'Finish with your passenger still comfortable (75 or more)',
      check: (ctx) => (ctx.data.comfort ?? 0) >= 75,
    },
  ],
  weather: { time: 'sunset', condition: 'rainy', windSpeedKts: 18, windDirDeg: 40 },
  spawn: RUNWAY_START,
  parTime: 1050,
  timeLimit: 1500,
  onStart: (ctx) => {
    clearProps(ctx.sim);
    ctx.data.comfort = 100;
    ctx.data.bothGentle = true;
    ctx.sim.notify('Doctor Reyes is aboard. Fly it the way you would want to be flown.', 'info');
  },
  onUpdate: (ctx, dt) => pump(ctx, captainTick),
  failIf: (ctx) => {
    pump(ctx, captainTick);
    if ((ctx.data.comfort ?? 100) < 25) return 'Your passenger was too ill to carry on';
    if (ctx.data.cayLanding && ctx.data.cayLanding.across > 60) {
      return 'You touched down off the strip, in the trees';
    }
    return null;
  },
  steps: [
    {
      id: 'depart',
      text: 'Take off from runway 09 and turn south-east for Mango Cay. Gently — you have a passenger.',
      hint: 'Keep the bank under 25 degrees and the climb steady. Rough flying makes her ill and costs you the flight.',
      atc: {
        text: 'Skylark one seven two, Kestrel Tower, cleared for take-off runway zero nine, wind zero four zero at one eight.',
        voice: 'tower',
      },
      targetLabel: 'Mango Cay',
      target: () => CAY_STRIP.centre,
      check: (ctx) => ctx.ac.airborneTime > 5 && ctx.ac.agl > 60,
    },
    {
      id: 'cross',
      text: 'Fly south-east to Mango Cay. Come down to about 1,200 feet as you get close and set up to land on the grass strip.',
      hint: 'The strip runs almost north to south. You will land heading 165 — that is south-south-east — coming in over the water from the north.',
      atc: {
        text: 'Skylark one seven two, radar service terminated, no tower at Mango. The strip is yours, land at your discretion.',
        voice: 'approach',
      },
      targetLabel: 'Mango Cay strip',
      target: () => CAY_STRIP.threshold16,
      check: (ctx) =>
        flatDist(ctx.ac.pos, CAY_STRIP.threshold16) < 1600 && ctx.ac.alt < 500,
    },
    {
      id: 'land-cay',
      text: 'Land on the grass strip and stop. No lights, no PAPI, no tower — judge it by eye and keep it on the mown grass.',
      hint: 'Come in low over the water, aim at the white bars at the near end, and touch down within 60 metres of the middle of the strip.',
      atc: { text: 'Sea Bird, this is Mango Cay. The patient is on the stretcher by the tent. We can see your lights.', voice: 'village' },
      targetLabel: 'Strip touchdown',
      target: () => CAY_STRIP.touchdown16,
      check: (ctx) =>
        landedAndStopped(ctx) && flatDist(ctx.ac.pos, CAY_STRIP.centre) < 500,
    },
    {
      id: 'load',
      text: 'The patient is being loaded. Take off again on runway 34 — back the way you came, to the north — and turn for Kestrel.',
      hint: 'Turn the aeroplane round on the strip first, so you are pointing north-north-west, then full power.',
      atc: {
        text: 'Sea Bird, the patient is aboard and the doctor is happy. Thank you. Safe flight home.',
        voice: 'village',
      },
      targetLabel: 'Kestrel Island',
      target: () => RUNWAY.thresholdEast,
      check: (ctx) => ctx.ac.airborneTime > 6 && ctx.ac.alt > CAY_STRIP.elev + 90,
    },
    {
      id: 'cruise',
      text: 'Fly north-west, back towards Kestrel Island, and climb to about 2,000 feet.',
      hint: 'Follow the arrow. Keep the turns gentle — there is somebody poorly in the back now as well.',
      targetLabel: 'Kestrel Island',
      target: () => RUNWAY.thresholdEast.clone().add(new THREE.Vector3(1400, 200, 0)),
      check: (ctx) => ctx.ac.pos.x < 4600,
    },
    {
      id: 'rough',
      text: 'The engine is running rough and will only give you about half power. Keep the nose down, hold your speed, and fly it home flat.',
      hint: 'Do not try to climb — you cannot, at this power. Point at the island, keep 80 knots, and let the height come off slowly.',
      atc: {
        text: 'Skylark one seven two, we have you on radar. Take your time. Runway zero nine is yours, and the fire crews are out.',
        voice: 'tower',
        urgency: 1,
      },
      enter: (ctx) => {
        ctx.data.roughRunning = true;
        holdPower(ctx, ROUGH_POWER);
        ctx.sim.notify('The engine is running rough — you have about half power. Fly it flat and fast enough.', 'bad');
        if (ctx.sim.audio && ctx.sim.audio.available && ctx.sim.audio.ambience.playFlaps) {
          ctx.sim.audio.ambience.playFlaps();
        }
      },
      targetLabel: 'Runway 09 approach',
      target: () => RUNWAY.thresholdWest.clone().add(new THREE.Vector3(-1600, 200, 0)),
      check: (ctx) => linedUpFor09(ctx, 5200),
    },
    {
      id: 'land-home',
      text: 'Land on runway 09. Crosswind from your left, wet tarmac, half an engine — fly it all the way to a stop.',
      hint: 'Point the nose slightly into the wind on final, straighten it just before the wheels touch, then brake gently.',
      atc: { text: 'Skylark one seven two, runway zero nine, cleared to land. Wind zero four zero at one eight.', voice: 'tower' },
      targetLabel: 'Touchdown zone',
      target: () => RUNWAY.touchdown,
      check: (ctx) =>
        landedAndStopped(ctx) && !!ctx.data.homeLanding && ctx.data.homeLanding.score >= 55,
    },
  ],
  onComplete: (ctx) => {
    clearProps(ctx.sim);
    if (ctx.ac.powerLimit !== undefined) ctx.ac.powerLimit = 1;
    ctx.sim.speak(
      'Skylark one seven two, Kestrel Tower. The doctor and her patient are on their way to the hospital, and you brought them home in the dark, in the rain, on half an engine.',
      'tower'
    );
    ctx.sim.notify('Kestrel Tower: welcome home, Captain. The island is yours.', 'good');
  },
  score: (ctx) => {
    const home = ctx.data.homeLanding ? ctx.data.homeLanding.score : 40;
    const cay = ctx.data.cayLanding ? Math.max(0, 1 - ctx.data.cayLanding.across / 60) : 0.3;
    const comfort = (ctx.data.comfort ?? 60) / 100;
    return Math.round(home * 0.45 + cay * 25 + comfort * 30);
  },
};

/* ------------------------------------------------------------------ */

export const CAMPAIGN_PART_B = [
  ridgeDrop,
  lowFuel,
  stormApproach,
  deadStick,
  searchRescue,
  precision,
  captainsTest,
];

export default CAMPAIGN_PART_B;

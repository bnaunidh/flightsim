/**
 * Every plane warning system — the cockpit's master WARNING and CAUTION.
 *
 * WHAT IT DOES
 *
 *   Ground proximity   PULL UP, TERRAIN, TERRAIN AHEAD, SINK RATE, DON'T SINK
 *                      (after take-off), GEAR NOT DOWN / too low gear, TOO LOW
 *                      FLAPS, and the radio altitude callouts on landing:
 *                      100, 50, 40, 30, 20, 10.
 *   The aeroplane      STALL, OVERSPEED, BANK ANGLE, WINDSHEAR, ENGINE FIRE,
 *                      ENGINE FAIL / OFF / ROUGH, LOW FUEL, FUEL LEAK,
 *                      AUTOPILOT OFF.
 *   Other aircraft     TCAS: TRAFFIC, and CLIMB / DESCEND when it is close,
 *                      from `sim.traffic` (tolerates there being none).
 *   The boat           SHALLOW WATER ahead. Not AGROUND: running aground
 *                      already beeps (main.js), captions itself in the middle
 *                      of the screen (hud-boat.js) and flashes the chart, and
 *                      a fourth voice saying the same thing is noise.
 *
 * An ENGINE FIRE starts when a bird goes through the engine (the bird strike
 * in disasters.js, armed or random), when the engine takes a heavy hit with
 * the damage model on, or when another feature calls `sim.warnings.startFire()`
 * — a meteor, a missile. You see it as well as hear it: flame and a smoke trail
 * from wherever that aeroplane's engine is, until the handle is pulled.
 *
 * A lightning strike that takes the instruments out takes this out with them.
 *
 * Helicopters get what applies to a helicopter — no stall horn, no flaps, no
 * gear, gentler sink-rate limits, a steeper bank limit, traffic advisories but
 * never a climb/descend command. The van gets nothing: nothing ahead of it
 * can hurt it, and the map already says when it has left the road.
 *
 * HOW A CHILD USES IT
 *
 * Nothing is on screen while all is well. When something happens, two lights
 * appear under the wind panel — MASTER WARNING (red) and MASTER CAUTION
 * (amber) — flashing, with a short line under them for each problem saying
 * what it is and what to do about it, in words a ten-year-old can act on:
 * "GEAR NOT DOWN — put the wheels down, press G" ("tap GEAR" on an iPad,
 * which has no G key). The really urgent ones (PULL UP, TERRAIN, WINDSHEAR,
 * CLIMB) are also shown big in the middle of the screen. Press R, or tap
 * either light, and the noise stops; the lines stay until the problem has
 * gone.
 *
 * Nothing is said twice. Where the game already puts its own words on screen
 * — main.js's toast for a stall, an overspeed, low fuel or the engine off,
 * the HUD's STALL slab — the panel stays out of it until those words have
 * gone (see ECHO). AUTOPILOT OFF is for the autopilot letting go by itself;
 * the pilot switching it off, taking over with the stick, or being handed
 * the landing by the approach mode is not an alarm (see apLetGo).
 *
 * SOUND
 *
 * Every class of alert has its own procedural sound (see src/audio/alerts.js
 * for the list), quiet, and nothing that already made a noise has been given a
 * second one: the stall horn, the overspeed clacker and the low-fuel tone are
 * the game's own and this only lights the lamp for them. The old gear horn and
 * terrain beep in alerts.js stand down while this is running (`claim`) and
 * come back if it ever stops. Spoken words go through `sim.speak` and ONLY
 * when the player has chosen the speech voice for the radio; the default is
 * tones and words on screen, and no text-to-speech.
 *
 * WHERE THE RULES ARE
 *
 * When each alert switches on and off — every threshold, every bit of
 * hysteresis — is in ./warnings-rules.js, which is pure and tested in node.
 * This file turns the game into a reading, plays what the rules decide, and
 * draws the panel.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { SPEC, TYPE, EVENTS } from '../aircraft/physics.js';
import { performanceFor } from '../aircraft/types.js';
import { stallWarning } from '../audio/alerts.js';
import { keyLabel, registerActions, isKey, codesFor, keyName, playerClaimed } from '../flight/input.js';

/* R, in the one registry: Settings → Controls → Flying. */
registerActions({
  ackWarnings: { label: 'Hush the warnings (and pull the fire handle)', group: 'Flying', ctx: ['plane', 'heli', 'boat'], default: ['KeyR'] },
});
import { aircraftLookahead, shoalConflict } from '../ui/minimap.js';
import { platformAt } from '../world/terrain.js';
import * as R from './warnings-rules.js';

const FT = 3.28084;
const FPM = 196.85;
const KT = 1.94384;
const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ */
/* State — one game, one set                                            */
/* ------------------------------------------------------------------ */

const W = {
  E: R.createEngine(),
  r: {}, // the reading, reused every frame
  kind: 'none',
  tcasMem: new Map(),
  tcasOut: R.createTcasOut(),
  own: { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, airborne: false, aglFt: 0, canRA: false },
  merged: [],
  drill: [],
  look: { t: 1, bp: { x: 0, z: 0, headingDeg: 0, speed: 0, draught: 1 } },
  terrainS: Infinity,
  shoalS: Infinity,
  wsPrevS: 0,
  wsF: 0,
  stallWas: false,
  engineStop: null,
  apWas: false,
  apClickMs: -1e9,
  apHandBack: false,
  apOffPending: false,
  airborneWas: false,
  inhibitWas: false,
  sawPause: false,
  lastMs: 0,
  fire: { on: false, t: 0, acked: false, ackT: 0, outUntil: -1 },
  birdWas: false,
  sayT: -1e9,
  log: [],
  logN: 0,
  demo: null,
  ui: null,
  sim: null,
};

/* ------------------------------------------------------------------ */
/* What are we in, and what is it                                       */
/* ------------------------------------------------------------------ */

function kindOf(sim) {
  if (!sim || !sim.mode) return 'none';
  if (sim.mode === 'drive') {
    const v = sim.vehicle;
    if (!v || !v.pos) return 'none';
    return v.spec && v.spec.kind === 'car' ? 'car' : 'boat';
  }
  if (!sim.aircraft || !sim.aircraft.pos) return 'none';
  return SPEC && SPEC.rotor ? 'heli' : 'plane';
}

/**
 * The few facts about the type being flown that the rules care about,
 * worked out once per type. `category` comes from the roster when the roster
 * says (the new aircraft do — see the brief's contract) and from the old
 * `class` label otherwise.
 */
const typeInfo = { id: null, category: 'light', needsFlaps: false, stallLandingKt: 50, engineParts: ['nose'] };
function info() {
  const t = TYPE;
  if (!t || typeInfo.id === t.id) return typeInfo;
  typeInfo.id = t.id;
  const cls = String(t.class || '').toLowerCase();
  const pw = (t.shape && t.shape.power) || {};
  typeInfo.category =
    t.category ||
    (pw.rotor
      ? 'helicopter'
      : t.military || cls === 'fighter' || cls === 'carrier'
        ? 'military'
        : cls === 'airliner'
          ? 'airliner'
          : 'light');
  /*
   * Flaps are something you land with in an airliner, and in anything else
   * with two engines or real weight; a trainer lands perfectly well without,
   * so it is not told off. Not a fighter: they did get TOO LOW — FLAPS on
   * every approach, because every jet counted, and a fast jet's GPWS has no
   * flap mode — it lands on its angle of attack, flap or none. Nor a
   * 'special', whatever that turns out to be: a warning that might be wrong
   * is a warning that nags.
   */
  const cat = typeInfo.category;
  typeInfo.needsFlaps =
    cat === 'airliner' ||
    (cat !== 'military' &&
      cat !== 'helicopter' &&
      cat !== 'special' &&
      (pw.kind === 'jet' || (pw.count || 1) >= 2 || !!(t.aero && t.aero.mass > 5000)));
  let stallL = 50;
  try {
    stallL = performanceFor(t.id).stallLanding || 50;
  } catch (e) {
    /* a type the performance table cannot work out keeps the default */
  }
  typeInfo.stallLandingKt = stallL;
  // Where the engine is, for "that hit set it on fire".
  typeInfo.engineParts = pw.rotor
    ? ['fuselage']
    : (pw.count || 1) >= 2
      ? ['leftWing', 'rightWing']
      : (pw.z || 0) < 0 && pw.kind !== 'jet'
        ? ['nose']
        : ['fuselage', 'tail'];
  return typeInfo;
}

/* ------------------------------------------------------------------ */
/* The reading                                                          */
/* ------------------------------------------------------------------ */

function reading(sim, dt, kind) {
  const r = W.r;
  const E = W.E;
  r.kind = kind;
  r.inhibit = !!(sim.bracing || sim.chute);
  /*
   * A lightning strike takes the panel out (main.js, instrumentBlackout), and
   * the warning computer is on the panel. The minimap already goes dark with
   * it and the autopilot drops out; this going on calmly saying SINK RATE
   * would be the one instrument that survived the strike, which is not how
   * it works and undoes the point of the event — "an aeroplane in cloud with
   * no help". It goes quiet and dark, and picks up where it left off when the
   * instruments come back. The stall horn in alerts.js is a vane on the wing
   * and keeps working, as it would.
   */
  r.blackout = kind !== 'boat' && sim.instrumentBlackout > 0;
  r.apOffEvent = false;
  r.tcasLevel = 0;
  r.tcasSense = null;
  r.fire = W.fire.on;
  r.fireOut = E.t < W.fire.outUntil;
  W.look.t += dt;
  const lookNow = W.look.t >= 0.2;
  if (lookNow) W.look.t = 0;

  if (kind === 'plane' || kind === 'heli') {
    const ac = sim.aircraft;
    const ti = info();
    const heli = kind === 'heli';
    r.category = ti.category;
    r.needsFlaps = ti.needsFlaps;
    r.stallLandingKt = ti.stallLandingKt;
    r.airborne = !ac.onGround;
    r.crashed = !!ac.crashed;
    /*
     * RADIO altitude: to whatever is underneath, and at sea that is the
     * water. `ac.agl` is measured to heightAt, which over the sea is the sea
     * FLOOR — measured on Kestrel, 34 m (111 ft) down — so every callout
     * over water came a hundred feet early and the carrier's "fifty" would
     * have been said with the wheels in the sea. And over a deck — the
     * carrier, a rooftop pad — it is the deck, which terrain.js keeps as a
     * platform and heightAt knows nothing about: the carrier's deck is twenty
     * metres up, so measured to the water "fifty, forty, thirty" came after
     * the hook had caught.
     */
    let ra = Math.min(ac.agl || 0, ac.pos.y);
    const deck = platformAt(ac.pos.x, ac.pos.z);
    if (deck && Number.isFinite(deck.y)) ra = Math.min(ra, ac.pos.y - deck.y);
    r.aglFt = Math.max(0, ra) * FT;
    r.altFt = ac.pos.y * FT;
    r.vsFpm = (ac.vs || 0) * FPM;
    r.iasKt = (ac.ias || 0) * KT;
    r.bankDeg = typeof ac.bankAngleDeg === 'function' ? ac.bankAngleDeg() : 0;
    r.gearDown = !!ac.gearDown;
    r.flapStep = typeof ac.flapStep === 'function' ? ac.flapStep() : 0;
    r.throttle = (ac.controls && ac.controls.throttle) || 0;
    r.vneKt = SPEC && SPEC.vne ? SPEC.vne * KT : Infinity;
    W.stallWas = stallWarning(ac, W.stallWas);
    r.stallWarn = W.stallWas;
    r.fuelFrac = typeof ac.fuelFraction === 'function' ? ac.fuelFraction() : 1;
    r.engineOn = !!ac.engineOn;
    r.engineStarting = ac.starting > 0;
    const f = ac.failures || {};
    r.engineFailed = !!f.engine;
    r.engineRough = !!f.roughEngine;
    r.fuelLeak = !!f.fuelLeak;
    r.engineStopReason = W.engineStop;

    // Terrain ahead, five times a second — it samples the ground. The very
    // same function the minimap's red ring uses, so they always agree.
    if (lookNow) W.terrainS = aircraftLookahead(ac, heli);
    r.terrainS = W.terrainS;
    r.windshearF = windshear(sim, ac, dt);

    // Other aircraft.
    const own = W.own;
    own.x = ac.pos.x;
    own.y = ac.pos.y;
    own.z = ac.pos.z;
    own.vx = ac.vel.x;
    own.vy = ac.vel.y;
    own.vz = ac.vel.z;
    own.airborne = r.airborne && !r.crashed;
    own.aglFt = r.aglFt; // radio altitude, so over the sea it is height above the water
    own.canRA = !heli; // a helicopter's system gives advisories, never commands
    R.tcasAssess(own, trafficList(sim), W.tcasMem, dt, E.t, W.tcasOut);
    r.tcasLevel = W.tcasOut.level;
    r.tcasSense = W.tcasOut.sense;

    /*
     * A bird through the engine sets it alight. disasters.js's bird strike
     * makes the engine run rough and says "engine damaged", and nothing in the
     * game could ever start a fire, so without this the fire bell was only
     * reachable from a Dev-mode drill or with the damage model switched on.
     * The strike shows up as a new entry in sim.activeEvents (triggerNatural).
     */
    const ev = sim.activeEvents;
    const bird = !!(ev && ev.birdStrike > 0);
    if (bird && !W.birdWas && r.airborne && !r.crashed) startFire();
    W.birdWas = bird;

    /*
     * The autopilot letting go BY ITSELF — which in this game means the
     * lightning strike taking the instruments it flies on. Every other way it
     * disengages is the pilot's own doing, and the wail for those was the
     * panel telling a child off for doing what the game had just told them
     * to: "Autopilot on … Move the stick to take over." Measured by the
     * reviewer in the game, the stick and the planned hand-back on the
     * approach ("Runway ahead — landing is yours") both set off the wail and
     * five seconds of amber AUTOPILOT OFF, every time. See apLetGo().
     *
     * A drop-out while the panel is dark is told when the panel comes back:
     * the one moment the child most needs to hear that nothing is flying the
     * aeroplane but them.
     */
    const ap = sim.autopilot;
    const engaged = !!(ap && ap.engaged);
    if (W.apWas && !engaged && r.airborne && W.airborneWas && !r.crashed && !r.inhibit && !W.inhibitWas && !apLetGo(sim, ap)) {
      if (r.blackout) W.apOffPending = true;
      else r.apOffEvent = true;
    }
    if (W.apOffPending && !r.blackout) {
      W.apOffPending = false;
      if (!engaged && r.airborne && !r.crashed) r.apOffEvent = true;
    }
    // Set by the autopilot's approach mode the frame BEFORE main.js acts on it
    // and clears it, so it is remembered from last frame.
    W.apHandBack = engaged && !!(ap && ap.handedBack);
    W.apWas = engaged;
  } else if (kind === 'boat') {
    const v = sim.vehicle;
    r.airborne = false;
    r.crashed = !!v.crashed;
    r.aground = !!v.aground;
    r.speedKt = Math.abs(v.speed || 0) * KT;
    if (lookNow) {
      const bp = W.look.bp;
      bp.x = v.pos.x;
      bp.z = v.pos.z;
      bp.headingDeg = v.heading || 0;
      bp.speed = v.speed || 0;
      bp.draught = (v.spec && v.spec.draught) || 1;
      W.shoalS = shoalConflict(bp);
    }
    r.shoalS = W.shoalS;
    W.apWas = false;
    W.apOffPending = false;
  }
  W.airborneWas = !!r.airborne && !r.crashed;
  W.inhibitWas = !!r.inhibit;
  W.sawPause = false;
  return r;
}

/**
 * Did the pilot switch the autopilot off, one way or another? Any of: the P
 * key, the tray button, the pause menu, moving the stick past the autopilot's
 * own take-over threshold (main.js asks `playerTookOver` of this same input a
 * moment earlier in the frame), or the approach mode handing the landing
 * back as planned.
 */
function apLetGo(sim, ap) {
  const inp = sim.input;
  if (inp && typeof inp.pressed === 'function' && inp.pressed('autopilot')) return true;
  if (now() - W.apClickMs < 1500) return true;
  if (W.sawPause) return true;
  if (W.apHandBack) return true;
  if (ap && typeof ap.playerTookOver === 'function' && inp && inp.out && ap.playerTookOver(inp.out)) return true;
  // ...and the hand-back once more, by what main.js says as it lets go, for a
  // hand-back set and acted on inside one frame (a test harness can do that).
  const ts = sim.hud && sim.hud.toasts;
  const last = Array.isArray(ts) && ts.length ? ts[ts.length - 1] : null;
  if (last && last.node && /landing is yours|go around or lose it/.test(last.node.textContent || '')) return true;
  return false;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** sim.traffic, plus the drill's pretend aircraft if a drill is running. */
function trafficList(sim) {
  const list = sim.traffic;
  if (!W.drill.length) return Array.isArray(list) ? list : null;
  const m = W.merged;
  m.length = 0;
  if (Array.isArray(list)) for (let i = 0; i < list.length; i++) m.push(list[i]);
  for (let i = 0; i < W.drill.length; i++) m.push(W.drill[i]);
  return m;
}

/*
 * The drill's pretend aircraft, drawn, so there is something in the sky to
 * look for when the panel says TRAFFIC. Loaded on demand: the aircraft models
 * are a big import that the node tests have no DOM for, and a Dev-mode drill
 * is the only thing that ever wants one here.
 */
function showDrillModel(sim, d) {
  Promise.all([import('../aircraft/model-adapter.js'), import('../aircraft/types.js')])
    .then(([MA, TY]) => {
      if (!W.drill.includes(d) || !sim.scene) return;
      const m = MA.createAircraftModel({ type: TY.getAircraft(d.typeId) || TY.getAircraft('skylark') });
      m.name = 'tcas-drill-aircraft';
      sim.scene.add(m);
      d.model = m;
      placeDrillModel(d);
    })
    .catch((err) => console.warn('[warnings] the drill aircraft could not be drawn:', err));
}

const _yAxis = new THREE.Vector3(0, 1, 0);
function placeDrillModel(d) {
  if (!d.model) return;
  d.model.position.copy(d.pos);
  // Heading 0 is north (-Z), the same rotation physics.js reset() uses.
  d.model.quaternion.setFromAxisAngle(_yAxis, -d.heading * DEG);
}

/**
 * Out of the scene AND out of the GPU: its geometry and materials are its own
 * (main.js disposes the player's aeroplane the same way when it swaps one).
 */
function dropDrillModel(d) {
  const m = d.model;
  d.model = null;
  if (!m) return;
  if (m.parent) m.parent.remove(m);
  try {
    if (m.userData && m.userData.fleetBridge && typeof m.userData.dispose === 'function') {
      m.userData.dispose();
      return;
    }
    const seen = new Set();
    m.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry);
        o.geometry.dispose();
      }
      const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mt of mats) {
        if (seen.has(mt)) continue;
        seen.add(mt);
        mt.dispose();
      }
    });
  } catch (e) {
    /* a leak is better than a thrown frame */
  }
}

/**
 * Windshear, as the F-factor real reactive windshear systems use: the rate
 * the headwind is being lost, in g, plus the downdraught over the airspeed.
 * Above 0.1 the air is taking energy away faster than the engine can put it
 * back. The microburst in weather.js is a function of time, not place, so the
 * headwind rate is its rate of change along the nose — NOT the change caused
 * by turning, which is not a loss of anything.
 */
function windshear(sim, ac, dt) {
  const w = sim.weather;
  if (!w || !(dt > 0)) return 0;
  const shear = Number(w.shearHeadwind) || 0;
  const down = Number(w.downdraft) || 0;
  if (!shear && !down && W.wsF < 1e-3) {
    W.wsPrevS = 0;
    W.wsF = 0;
    return 0;
  }
  const dS = (shear - W.wsPrevS) / dt;
  W.wsPrevS = shear;
  const along = Math.cos(((w.windDirDeg || 0) - (ac.heading || 0)) * DEG);
  const V = Math.max(20, ac.ias || 0);
  const F = (-dS * along) / 9.81 + down / V;
  W.wsF += (F - W.wsF) * Math.min(1, dt / 0.6);
  return W.wsF;
}

/* ------------------------------------------------------------------ */
/* Doing what the rules decided                                         */
/* ------------------------------------------------------------------ */

function speechOn(sim) {
  const a = sim.audio;
  if (!a || !a.radio || a.radio.mode !== 'speech') return false;
  const s = sim.settings || {};
  if (s.muted) return false;
  if (s.soundOn && s.soundOn.alerts === false) return false;
  return typeof sim.speak === 'function';
}

/** The last sixty sounds decided, numbered, for the tests and the console. */
function logPlay(entry) {
  entry.n = ++W.logN;
  W.log.push(entry);
  if (W.log.length > 60) W.log.shift();
}

function playDecided(sim, E) {
  if (!E.play) return;
  const a = sim.audio;
  logPlay({ n: 0, t: +E.t.toFixed(2), sound: E.play.sound, id: E.play.id, arg: E.play.arg ?? null });
  if (a && a.available && a.alerts) {
    const fn = a.alerts[E.play.sound];
    if (typeof fn === 'function') fn.call(a.alerts, E.play.arg);
  }
  if (E.say && speechOn(sim) && E.t - W.sayT > 0.9) {
    W.sayT = E.t;
    const d = R.DEFS[E.play.id];
    sim.speak(E.say, 'instructor', d && d.level === 'warning' ? 1 : 0);
  }
}

function startFire() {
  const F = W.fire;
  if (F.on) return;
  F.on = true;
  F.t = 0;
  F.acked = false;
}

/** The fire handle: the bottle goes off a moment after you pull it. */
function tickFire(sim, dt, flying) {
  const F = W.fire;
  if (!F.on) return;
  if (!flying) {
    F.on = false;
    return;
  }
  F.t += dt;
  // Nobody pulled it? It goes off by itself after 25 s. A bell ringing for
  // ever because a child did not know which key to press is not a lesson.
  const due = F.acked ? W.E.t - F.ackT > 2.5 : F.t > 25;
  if (!due) return;
  F.on = false;
  F.outUntil = W.E.t + 5;
  const ac = sim.aircraft;
  // What a fire leaves behind: an engine that runs, but not properly.
  if (ac && ac.engineOn && ac.failures && !ac.failures.roughEngine && typeof sim.toggleFailure === 'function') {
    sim.toggleFailure('roughEngine');
  }
}

/* ------------------------------------------------------------------ */
/* The fire you can see                                                 */
/* ------------------------------------------------------------------ */

/*
 * A bell and a red light are half an engine fire. The other half is looking
 * over your shoulder in the chase view and seeing it: flame at the engine and
 * a smoke trail streaming behind you, which is also how a ten-year-old knows
 * the handle worked — the flame stops, the smoke thins, and it is over.
 *
 * One Points object of 72 puffs, one draw call, drawn only while there is
 * smoke. Each puff is left where it was made, so the aeroplane flying on is
 * what draws the trail out. Sizes are per puff, through one line injected
 * into three's own points shader. Nothing is allocated per frame.
 */
const FX_N = 72;
const FX = {
  pts: null,
  pos: null,
  col: null,
  size: null,
  age: new Float32Array(FX_N),
  life: new Float32Array(FX_N),
  vel: new Float32Array(FX_N * 3),
  flame: new Uint8Array(FX_N),
  next: 0,
  acc: 0,
  alive: 0,
  v: new THREE.Vector3(),
};

function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function buildFx(group) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(FX_N * 3);
  const col = new Float32Array(FX_N * 4);
  const size = new Float32Array(FX_N);
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.PointsMaterial({
    size: 1,
    map: puffTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    sizeAttenuation: true,
  });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('uniform float size;', 'uniform float size;\nattribute float aSize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
  };
  const pts = new THREE.Points(geo, mat);
  pts.name = 'engine-fire-smoke';
  pts.frustumCulled = false;
  pts.visible = false;
  group.add(pts);
  FX.pts = pts;
  FX.pos = pos;
  FX.col = col;
  FX.size = size;
  clearFx();
}

function clearFx() {
  FX.life.fill(0);
  FX.age.fill(0);
  FX.acc = 0;
  FX.alive = 0;
  if (FX.size) FX.size.fill(0);
  if (FX.col) FX.col.fill(0);
  if (FX.pts) FX.pts.visible = false;
}

/** Where the burning engine is, in the world: the left one of a pair. */
function enginePoint(ac, out) {
  const pw = (TYPE && TYPE.shape && TYPE.shape.power) || {};
  const twin = (pw.count || 1) >= 2;
  const x = twin ? -Math.abs(pw.x || 2.5) : 0;
  const y = Number.isFinite(pw.y) ? pw.y : 0;
  // A propeller's z is the disc; the fire is in the cowling just behind it.
  const z = (Number.isFinite(pw.z) ? pw.z : 0) + (pw.kind === 'jet' ? (pw.length || 1) * 0.5 : 0.9);
  out.set(x, y, z).applyQuaternion(ac.quat).add(ac.pos);
  return out;
}

function tickFx(sim, dt, flying) {
  if (!FX.pts) return;
  const ac = sim.aircraft;
  const burning = W.fire.on && flying;
  // After the handle: thin smoke for as long as FIRE OUT is shown.
  const smoke = !burning && flying && W.E.t < W.fire.outUntil;
  const rate = burning ? 26 : smoke ? 6 : 0;
  if (rate > 0 && ac && ac.pos && ac.quat) {
    FX.acc += dt * rate;
    if (FX.acc >= 1) enginePoint(ac, FX.v);
    const vel = ac.vel;
    while (FX.acc >= 1) {
      FX.acc -= 1;
      const i = FX.next;
      FX.next = (FX.next + 1) % FX_N;
      const j = FX.acc / rate; // spread the puffs over the frame
      FX.pos[i * 3] = FX.v.x - (vel ? vel.x * j : 0) + (Math.random() - 0.5) * 0.6;
      FX.pos[i * 3 + 1] = FX.v.y - (vel ? vel.y * j : 0) + (Math.random() - 0.5) * 0.6;
      FX.pos[i * 3 + 2] = FX.v.z - (vel ? vel.z * j : 0) + (Math.random() - 0.5) * 0.6;
      // A little of the aeroplane's speed, a little of its own, and it rises.
      FX.vel[i * 3] = (vel ? vel.x * 0.12 : 0) + (Math.random() - 0.5) * 2;
      FX.vel[i * 3 + 1] = (vel ? vel.y * 0.12 : 0) + 1.2 + Math.random();
      FX.vel[i * 3 + 2] = (vel ? vel.z * 0.12 : 0) + (Math.random() - 0.5) * 2;
      FX.age[i] = 0;
      FX.life[i] = burning ? 2.2 + Math.random() * 0.8 : 1.6 + Math.random() * 0.6;
      FX.flame[i] = burning ? 1 : 0;
    }
  } else {
    FX.acc = 0;
  }
  let alive = 0;
  const damp = Math.max(0, 1 - dt * 1.6);
  for (let i = 0; i < FX_N; i++) {
    if (FX.life[i] <= 0) continue;
    FX.age[i] += dt;
    const a = FX.age[i];
    const L = FX.life[i];
    const c = i * 4;
    if (a >= L) {
      FX.life[i] = 0;
      FX.size[i] = 0;
      FX.col[c + 3] = 0;
      continue;
    }
    alive++;
    const p = i * 3;
    FX.pos[p] += FX.vel[p] * dt;
    FX.pos[p + 1] += FX.vel[p + 1] * dt;
    FX.pos[p + 2] += FX.vel[p + 2] * dt;
    FX.vel[p] *= damp;
    FX.vel[p + 2] *= damp;
    const f = a / L;
    if (FX.flame[i] && a < 0.25) {
      // Flame: yellow at the engine, orange a moment later.
      const k = a / 0.25;
      FX.col[c] = 1;
      FX.col[c + 1] = 0.75 - k * 0.45;
      FX.col[c + 2] = 0.2 - k * 0.15;
      FX.col[c + 3] = 0.95;
      FX.size[i] = 1.6 + k * 1.6;
    } else {
      // Smoke: dark grey out of a fire, paler once it is only smouldering.
      const g = FX.flame[i] ? 0.06 + f * 0.1 : 0.22 + f * 0.1;
      FX.col[c] = g;
      FX.col[c + 1] = g * 0.95;
      FX.col[c + 2] = g * 0.92;
      FX.col[c + 3] = (FX.flame[i] ? 0.8 : 0.45) * (1 - f) * (1 - f * 0.3);
      FX.size[i] = (FX.flame[i] ? 3.2 : 2) + f * (FX.flame[i] ? 11 : 7);
    }
  }
  FX.alive = alive;
  // Not from inside the cockpit: a nose fire's smoke is a grey wall there.
  const show = alive > 0 && !(sim.rig && sim.rig.mode === 'cockpit');
  if (FX.pts.visible !== show) FX.pts.visible = show;
  if (alive > 0) {
    const at = FX.pts.geometry.attributes;
    at.position.needsUpdate = true;
    at.color.needsUpdate = true;
    at.aSize.needsUpdate = true;
  }
}

/** R, or a tap on either light. */
function acknowledge() {
  const n = R.acknowledge(W.E);
  const F = W.fire;
  if (F.on && !F.acked) {
    F.acked = true;
    F.ackT = W.E.t;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* The panel                                                            */
/* ------------------------------------------------------------------ */

const CSS = `
.wx { position: absolute; inset: 0; pointer-events: none; font-family: inherit; }
.wx[hidden], .wx [hidden] { display: none !important; }
/*
 * Down the right-hand side, under whatever the HUD has put at the top of that
 * column and above whatever it has put at the bottom. The top here is only the
 * starting guess: placePanel() measures the real layout once a second and
 * moves it, because that column holds something different on a laptop, a
 * portrait iPad (the objective box reaches into it), a phone, the boat and
 * the helicopter, and with the damage diagram on.
 */
.wx-panel {
  position: absolute; right: 16px; top: 112px; width: 216px;
  display: flex; flex-direction: column; gap: 5px;
}
.wx-lamps { display: flex; gap: 6px; }
.wx-lamp {
  flex: 1; min-height: 40px; padding: 5px 4px; border-radius: 10px;
  pointer-events: auto; cursor: pointer; -webkit-appearance: none; appearance: none;
  font-family: inherit; font-weight: 800; font-size: 11px; line-height: 1.08;
  letter-spacing: 0.08em; text-align: center; text-transform: uppercase;
  background: rgba(12, 20, 32, 0.74); color: rgba(255, 255, 255, 0.26);
  border: 1px solid rgba(140, 180, 230, 0.22);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
  touch-action: manipulation;
}
.wx-lamp.is-lit.is-warn {
  background: #d4302a; color: #fff; border-color: #ff9a90;
  box-shadow: 0 0 18px rgba(255, 70, 50, 0.65); animation: wxFlash 0.8s steps(1, end) infinite;
}
.wx-lamp.is-lit.is-caut {
  background: #eba21c; color: #1c1303; border-color: #ffe0a0;
  box-shadow: 0 0 16px rgba(255, 190, 60, 0.55); animation: wxFlash 0.8s steps(1, end) infinite;
}
@keyframes wxFlash { 50% { filter: brightness(0.5); } }
.wx-row {
  background: rgba(8, 13, 22, 0.86); border-radius: 9px; padding: 5px 10px 6px;
  border-left: 5px solid #9fdcff; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
}
.wx-row b { display: block; font-size: 15px; font-weight: 780; letter-spacing: 0.05em; line-height: 1.15; }
.wx-row span { display: block; font-size: 12px; line-height: 1.28; color: rgba(226, 236, 246, 0.9); margin-top: 1px; }
.wx-row.is-warning { border-left-color: #ff5a4a; }
.wx-row.is-warning b { color: #ff9186; }
.wx-row.is-caution { border-left-color: #ffc247; }
.wx-row.is-caution b { color: #ffd67e; }
.wx-row.is-advisory b { color: #cfeeff; }
.wx-row.is-acked { opacity: 0.74; }
.wx-foot { font-size: 11.5px; color: rgba(226, 236, 246, 0.9); text-align: right; text-shadow: 0 1px 3px #000; }
/*
 * 36% and not higher: the HUD's own STALL / TOO SLOW slab sits at 30% and the
 * notifications stack down from 96 px, and at 27% this landed on both —
 * measured at 1024x768, TERRAIN at 55 kt put "TOO SLOW" and "TERRAIN" in the
 * same forty pixels.
 */
.wx-cmd {
  position: absolute; left: 50%; top: 36%; transform: translateX(-50%);
  padding: 8px 24px; border-radius: 14px; white-space: nowrap;
  font-family: inherit; font-weight: 850; font-size: 34px; line-height: 1; letter-spacing: 0.09em;
  color: #fff; background: rgba(140, 16, 12, 0.8); border: 2px solid #ff7466;
  box-shadow: 0 0 30px rgba(255, 60, 40, 0.45); text-shadow: 0 2px 6px rgba(0, 0, 0, 0.5);
}
.wx-cmd.is-callout {
  background: none; border: none; box-shadow: none; padding: 0;
  font-size: 46px; font-weight: 800; letter-spacing: 0.02em; color: #f4f8fc;
  text-shadow: 0 2px 10px rgba(0, 0, 0, 0.8);
}
.wx.is-contrast .wx-row, .wx.is-contrast .wx-lamp { background: #000; }
.wx.is-contrast .wx-row span { color: #fff; }
.wx.is-large .wx-row b { font-size: 18px; }
.wx.is-large .wx-row span { font-size: 14px; }
.wx.is-short .wx-row span { display: none; }
@media (max-width: 760px), (pointer: coarse) {
  .wx-panel { right: 10px; top: 170px; width: 196px; }
  .wx-cmd { font-size: 28px; }
}
/*
 * A phone: measured at 375x812, the objective box ends at 158 px and the
 * coaching line starts at 450, so the panel goes between them (placePanel
 * finds that) and the big command goes below it, clear of both.
 */
@media (max-width: 560px) {
  .wx-panel { top: 170px; right: 6px; width: 150px; gap: 4px; }
  .wx-lamp { min-height: 34px; font-size: 9.5px; }
  .wx-row b { font-size: 12.5px; }
  .wx-row span { display: none; }
  .wx-cmd { top: 41%; font-size: 22px; padding: 6px 14px; }
  .wx-cmd.is-callout { font-size: 34px; }
}
`;

const MAX_ROWS = 4;

/*
 * The persistent bits of the HUD that can share the panel's column. Not the
 * toasts, the subtitles or the coaching line: they come and go, and a panel
 * that jumped every time a notification appeared would be worse than one
 * that is briefly overlapped by it.
 */
const OBSTACLES = [
  '.hud-right', '.hud-buttons', '.hud-top', '.hud-damage', '.hud-left', '.hud-rotor',
  '.minimap', '.touch-pads', '.touch-throttle', '.touch-stick', '.touch-rudder',
  '.touch-lever', '.hud-bottom',
].map((c) => `#ui ${c}`).join(', ');

/**
 * Where the panel goes and how many lines it has room for — measured, once a
 * second, not assumed.
 *
 * The column is the panel's own CSS width against the right edge. Its top is
 * just under the lowest thing already in that column in the top part of the
 * screen; its floor is just above the highest thing below that. Rows are
 * whatever fits between, so the panel never runs into the minimap or the
 * touch controls and "+2 more" tells the truth. Measured this replaces a
 * fixed 112 px, which on a portrait iPad (767x1024) put the panel over the
 * right-hand 33 px of the objective box.
 */
function placePanel(sim, ui) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !document.querySelectorAll) return;
  const H = window.innerHeight || 768;
  const Wd = window.innerWidth || 1024;
  let width = 216;
  let right = 16;
  try {
    const cs = getComputedStyle(ui.panel);
    width = parseFloat(cs.width) || width;
    right = parseFloat(cs.right) || right;
  } catch (e) {
    /* keep the desktop numbers */
  }
  const colR = Wd - right;
  const colL = colR - width;
  let top = 12;
  let floor = H - 10;
  const els = document.querySelectorAll(OBSTACLES);
  const rects = ui.rects || (ui.rects = []);
  rects.length = 0;
  for (let i = 0; i < els.length; i++) {
    const r = els[i].getBoundingClientRect();
    if (!r.width || !r.height || r.right <= colL || r.left >= colR) continue;
    rects.push(r);
    if (r.top < H * 0.4) top = Math.max(top, r.bottom + 10);
  }
  for (let i = 0; i < rects.length; i++) {
    if (rects[i].top >= top) floor = Math.min(floor, rects[i].top - 10);
  }
  top = Math.round(top);
  if (top !== ui.top) {
    ui.top = top;
    ui.panel.style.top = `${top}px`;
  }
  // Lamps and the footer, then rows: a title and one or two lines of hint,
  // or the title alone where the hint is hidden.
  const narrow = Wd <= 560;
  const rowH = ui.short || narrow ? 30 : 62;
  const room = floor - top - (narrow ? 38 : 45) - 22;
  ui.maxRows = Math.max(1, Math.min(MAX_ROWS, Math.floor(room / (rowH + 5))));
}

function buildUi(sim) {
  if (W.ui || typeof document === 'undefined') return W.ui;
  const layer = extLayer();
  if (!document.getElementById('wx-style')) {
    const st = document.createElement('style');
    st.id = 'wx-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.className = 'wx';
  root.hidden = true;
  const cmd = document.createElement('div');
  cmd.className = 'wx-cmd';
  cmd.hidden = true;
  const panel = document.createElement('div');
  panel.className = 'wx-panel';
  panel.hidden = true;
  const lamps = document.createElement('div');
  lamps.className = 'wx-lamps';
  const mkLamp = (cls, words, title) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `wx-lamp ${cls}`;
    b.tabIndex = -1; // Space is the brakes; a focused button would eat it
    b.title = title;
    b.setAttribute('aria-label', title);
    b.innerHTML = words;
    // No focus on press, so a keyboard press afterwards goes to the game.
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      acknowledge();
    });
    lamps.appendChild(b);
    return b;
  };
  const warnLamp = mkLamp('is-warn', 'Master<br>warning', 'Master warning — tap to silence');
  const cautLamp = mkLamp('is-caut', 'Master<br>caution', 'Master caution — tap to silence');
  panel.appendChild(lamps);
  const list = document.createElement('div');
  list.className = 'wx-list';
  list.style.display = 'flex';
  list.style.flexDirection = 'column';
  list.style.gap = '5px';
  const rows = [];
  for (let i = 0; i < MAX_ROWS; i++) {
    const row = document.createElement('div');
    row.className = 'wx-row';
    row.hidden = true;
    const b = document.createElement('b');
    const s = document.createElement('span');
    row.appendChild(b);
    row.appendChild(s);
    list.appendChild(row);
    rows.push({ el: row, b, s, key: null, acked: null, sense: null });
  }
  panel.appendChild(list);
  const foot = document.createElement('div');
  foot.className = 'wx-foot';
  foot.hidden = true;
  panel.appendChild(foot);
  root.appendChild(cmd);
  root.appendChild(panel);
  layer.appendChild(root);

  /*
   * The autopilot's own button on the tray. Pressing it to turn the autopilot
   * off is the pilot's choice and gets no wail; this is how that is told apart
   * from the autopilot dropping out on its own.
   */
  const btn = sim && sim.hud && sim.hud.btnAuto;
  if (btn && btn.addEventListener) btn.addEventListener('click', () => (W.apClickMs = now()), true);

  W.ui = {
    root, cmd, panel, warnLamp, cautLamp, rows, foot,
    shown: false, cmdId: null, cmdCallout: null, cmdSense: null, moreN: -1, footAck: null,
    lampW: null, lampC: null, contrast: null, large: null,
    fitAt: -1e9, maxRows: MAX_ROWS, short: null, top: null, rects: null,
  };
  return W.ui;
}

function isTouch() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('is-touch-device');
}

function keyFor(sim, action) {
  const b = sim.input && sim.input.bindings && sim.input.bindings[action];
  return b && b[0] ? keyLabel(b[0]) : '?';
}

/**
 * Has the player put one of the game's own actions on the hush key (R, or
 * wherever it is now)? Then that key is theirs, and the lights are clicked.
 */
function rTaken(sim) {
  const codes = codesFor('ackWarnings', sim);
  if (!codes.length) return true;
  return codes.every((c) => playerClaimed(sim, c, 'ackWarnings'));
}

/**
 * How to silence it, in words for this player: a tap on a touch screen, R on
 * a keyboard, and a click on the light if R has been given to something else.
 */
function ackWords(sim, sentence) {
  const w = isTouch() ? 'tap the red light' : rTaken(sim) ? 'click the red light' : `press ${keyName('ackWarnings', sim)}`;
  return sentence ? w[0].toUpperCase() + w.slice(1) : w;
}

/*
 * The what-to-do line, with the control named the way this player works it.
 * On an iPad there are no keys: "press G" at a child holding a tablet is an
 * instruction they cannot follow (the reviewer found it). touch.js labels its
 * pads GEAR, FLAPS and START, so that is what the words say there.
 */
function hintFor(sim, id) {
  const d = R.DEFS[id];
  let h = d.hint;
  if (id === 'tcasRA' && W.E.tcasSense === 'descend') h = 'Another aircraft is close — descend now';
  if (h.indexOf('{') < 0) return h;
  const touch = isTouch();
  return h
    .replace('{gear}', touch ? 'tap GEAR' : `press ${keyFor(sim, 'gear')}`)
    .replace('{flaps}', touch ? 'tap FLAPS' : `press ${keyFor(sim, 'flapsDown')}`)
    .replace('{Starter}', touch ? 'Tap START' : `Press ${keyFor(sim, 'starter')}`)
    .replace('{Ack}', ackWords(sim, true));
}

/*
 * Said already, by the game. main.js puts up its own toast for a stall, an
 * overspeed, low fuel and an engine switched off the moment each happens, and
 * the HUD has a STALL / TOO SLOW slab of its own. A panel line saying the same
 * words beside them was the same warning twice (the reviewer counted three
 * for a stall). So while the game's own words are on screen the panel adds
 * no line and lights no master lamp for it — the lamp means "read the panel".
 * When the toast has gone and the trouble has not, the line appears: low fuel
 * is still low after its six seconds are up.
 */
const ECHO = {
  stall: /^Stall!/,
  overspeed: /^Too fast/,
  lowFuel: /^Low fuel/,
  engineOff: /^Engine off$/,
};

function echoed(sim, id) {
  const re = ECHO[id];
  const hud = re && sim.hud;
  if (!hud) return false;
  if (id === 'stall') {
    const slab = hud.stallWarn;
    if (slab && slab.style && slab.style.display !== 'none') return true;
  }
  const ts = hud.toasts;
  if (!Array.isArray(ts)) return false;
  for (let i = 0; i < ts.length; i++) {
    const n = ts[i] && ts[i].node;
    if (n && ts[i].life > 0 && re.test(n.textContent || '')) return true;
  }
  return false;
}

function titleFor(id) {
  if (id === 'tcasRA') return W.E.tcasSense === 'descend' ? 'DESCEND' : 'CLIMB';
  return R.DEFS[id].title;
}

function setHidden(el, hide) {
  if (el.hidden !== hide) el.hidden = hide;
}

/**
 * Only writes to the DOM when something it shows has changed — this runs every
 * frame and the answer is nearly always "nothing".
 */
function drawUi(sim, show) {
  const ui = W.ui;
  if (!ui) return;
  const E = W.E;
  if (E.t - ui.fitAt > 1 || E.t < ui.fitAt) {
    ui.fitAt = E.t;
    const short = typeof window !== 'undefined' && (window.innerHeight || 768) < 640;
    if (short !== ui.short) {
      ui.short = short;
      ui.root.classList.toggle('is-short', short);
    }
    placePanel(sim, ui);
  }
  let n = 0;
  let total = 0;
  let unacked = 0;
  let lampW = false;
  let lampC = false;
  if (show) {
    for (let i = 0; i < R.ORDER.length; i++) {
      const id = R.ORDER[i];
      const s = E.alerts[id];
      if (!s.on) continue;
      if (!W.demo && echoed(sim, id)) continue;
      total++;
      const level = R.DEFS[id].level;
      if (!s.acked) {
        if (level === 'warning') lampW = true;
        else if (level === 'caution') lampC = true;
        if (level !== 'advisory') unacked++;
      }
      if (n >= ui.maxRows) continue;
      const row = ui.rows[n++];
      const sense = id === 'tcasRA' ? E.tcasSense : null;
      if (row.key !== id || row.acked !== s.acked || row.sense !== sense) {
        row.key = id;
        row.acked = s.acked;
        row.sense = sense;
        row.el.className = `wx-row is-${R.DEFS[id].level}${s.acked ? ' is-acked' : ''}`;
        row.b.textContent = titleFor(id);
        row.s.textContent = hintFor(sim, id);
      }
      setHidden(row.el, false);
    }
  }
  for (let i = n; i < ui.rows.length; i++) {
    if (ui.rows[i].key !== null) {
      ui.rows[i].key = null;
      setHidden(ui.rows[i].el, true);
    }
  }
  if (lampW !== ui.lampW) {
    ui.lampW = lampW;
    ui.warnLamp.classList.toggle('is-lit', lampW);
  }
  if (lampC !== ui.lampC) {
    ui.lampC = lampC;
    ui.cautLamp.classList.toggle('is-lit', lampC);
  }
  const more = total - n;
  const wantAck = unacked > 0;
  if (more !== ui.moreN || wantAck !== ui.footAck) {
    ui.moreN = more;
    ui.footAck = wantAck;
    const ack = wantAck ? (isTouch() ? 'tap a light to silence' : rTaken(sim) ? 'click a light to silence' : `press ${keyName('ackWarnings', sim)} to silence`) : '';
    ui.foot.textContent = more > 0 ? `+${more} more${ack ? ' · ' + ack : ''}` : ack;
    setHidden(ui.foot, !(more > 0 || wantAck));
  }
  setHidden(ui.panel, !(show && total > 0));

  // The middle of the screen: the most urgent command, or a height callout.
  let cmdId = null;
  let callout = null;
  if (show) {
    cmdId = R.command(E);
    if (!cmdId) callout = E.callout.shown || null;
  }
  const sense = cmdId === 'tcasRA' ? E.tcasSense : null;
  if (cmdId !== ui.cmdId || callout !== ui.cmdCallout || sense !== ui.cmdSense) {
    ui.cmdId = cmdId;
    ui.cmdCallout = callout;
    ui.cmdSense = sense;
    if (cmdId || callout) {
      ui.cmd.className = `wx-cmd${callout ? ' is-callout' : ''}`;
      ui.cmd.textContent = callout
        ? String(callout)
        : cmdId === 'tcasRA'
          ? sense === 'descend'
            ? '▼ DESCEND'
            : '▲ CLIMB'
          : R.DEFS[cmdId].title;
    }
    setHidden(ui.cmd, !(cmdId || callout));
  }
  // Settings the HUD already has: high contrast and large text.
  const st = sim.settings || {};
  if (!!st.highContrast !== ui.contrast || !!st.largeText !== ui.large) {
    ui.contrast = !!st.highContrast;
    ui.large = !!st.largeText;
    ui.root.classList.toggle('is-contrast', ui.contrast);
    ui.root.classList.toggle('is-large', ui.large);
  }
  const vis = show && (total > 0 || !!cmdId || !!callout);
  if (vis !== ui.shown) {
    ui.shown = vis;
    setHidden(ui.root, !vis);
  }
}

function hideUi() {
  if (!W.ui) return;
  W.ui.shown = false;
  setHidden(W.ui.root, true);
}

/* ------------------------------------------------------------------ */
/* Drills — the Dev mode buttons                                        */
/* ------------------------------------------------------------------ */

/** Every alert in turn, with its sound, two seconds each: a lamp test you can hear. */
function tickDemo(sim, dt) {
  const D = W.demo;
  const E = W.E;
  D.t -= dt;
  if (D.t > 0) return;
  for (const id of R.ORDER) E.alerts[id].on = false;
  E.callout.shown = null;
  if (D.i >= D.ids.length) {
    W.demo = null;
    R.resetEngine(E);
    return;
  }
  const id = D.ids[D.i++];
  D.t = 2;
  if (typeof id === 'number') {
    E.callout.shown = id;
    E.play = { sound: 'radioAltitude', arg: id, id: 'callout' };
    E.say = null;
  } else {
    const s = E.alerts[id];
    s.on = true;
    s.acked = false;
    if (id === 'tcasRA') E.tcasSense = D.i % 2 ? 'climb' : 'descend';
    const d = R.DEFS[id];
    E.play = d.sound ? { sound: d.sound, id, arg: id === 'tcasRA' ? E.tcasSense : undefined } : null;
    E.say = d.say || null;
  }
  playDecided(sim, E);
  E.play = null;
}

function startFlight(sim, then) {
  const opts = { aircraft: (sim.settings && sim.settings.aircraft) || 'skylark', airborne: true, taxi: false };
  Promise.resolve(sim.startMode && sim.startMode('free', opts))
    .then(() => then && then())
    .catch((err) => console.error('[warnings] could not start the drill:', err));
}

/* ------------------------------------------------------------------ */
/* The hooks                                                            */
/* ------------------------------------------------------------------ */

function releaseAudio(sim) {
  try {
    const a = sim && sim.audio && sim.audio.alerts;
    if (a && a.release) a.release();
  } catch (e) {
    /* nothing more can be done from here */
  }
}

function resetAll(sim) {
  R.resetEngine(W.E);
  W.fire.on = false;
  W.fire.outUntil = -1;
  W.birdWas = false;
  W.terrainS = Infinity;
  W.shoalS = Infinity;
  W.wsF = 0;
  W.wsPrevS = 0;
  W.stallWas = false;
  W.engineStop = null;
  W.apWas = !!(sim && sim.autopilot && sim.autopilot.engaged);
  W.apHandBack = false;
  W.apOffPending = false;
  W.airborneWas = false;
  W.inhibitWas = false;
  W.tcasMem.clear();
  W.tcasOut.levels.clear();
  W.tcasOut.level = 0;
  for (const d of W.drill) dropDrillModel(d);
  W.drill.length = 0;
  W.demo = null;
  clearFx();
  releaseAudio(sim);
  hideUi();
}

function tick(sim, dt) {
  W.sim = sim;
  // Ejected (eject.js sets sim.walking.ejected): the warning computer is in
  // the empty aeroplane diving away, not with the pilot under the parachute.
  // "PULL UP" at someone hanging from a canopy is wrong. Quiet, once.
  if (sim.walking && sim.walking.ejected) {
    if (!W.ejectedWas) {
      W.ejectedWas = true;
      resetAll(sim);
    }
    return;
  }
  W.ejectedWas = false;
  const kind = kindOf(sim);
  W.kind = kind;
  const alerts = sim.audio && sim.audio.alerts;
  const aircraft = kind === 'plane' || kind === 'heli';
  if (alerts) {
    if (aircraft && !alerts.claimed && alerts.claim) alerts.claim();
    else if (!aircraft && alerts.claimed) releaseAudio(sim);
  }
  if (kind === 'none' || kind === 'car') {
    hideUi();
    return;
  }
  const E = W.E;
  if (W.demo) {
    E.t += dt;
    tickDemo(sim, dt);
    drawUi(sim, true);
    return;
  }

  // The drill's pretend aircraft flies straight on until it is well past.
  for (let i = W.drill.length - 1; i >= 0; i--) {
    const d = W.drill[i];
    d.pos.x += Math.sin(d.heading * DEG) * d.speed * dt;
    d.pos.z -= Math.cos(d.heading * DEG) * d.speed * dt;
    placeDrillModel(d);
    d.life -= dt;
    if (d.life <= 0) {
      dropDrillModel(d);
      W.drill.splice(i, 1);
    }
  }

  const r = reading(sim, dt, kind);
  R.evaluate(E, r, dt);
  tickFire(sim, dt, aircraft && r.airborne && !r.crashed);
  if (aircraft) tickFx(sim, dt, r.airborne && !r.crashed);
  playDecided(sim, E);

  if (alerts && alerts.claimed) {
    // One gear horn, driven from the rules, silenced by R.
    const g = E.alerts.gear;
    if (alerts.setGearWarning) alerts.setGearWarning(g.on && !g.acked && !r.inhibit && !r.blackout);
    alerts.overspeedSilenced = E.alerts.overspeed.on && E.alerts.overspeed.acked;
  }
  drawUi(sim, !(sim.hud && sim.hud.hidden) && !r.blackout);
}

registerExtension({
  id: 'warnings',

  install(sim) {
    W.sim = sim;
    buildUi(sim);
    const ac = sim.aircraft;
    if (ac && typeof ac.on === 'function') {
      // Listeners run inside the flight model's step; they must never throw.
      ac.on(EVENTS.ENGINE_STOP, (d) => {
        W.engineStop = (d && d.reason) || 'shutdown';
      });
      ac.on(EVENTS.ENGINE_START, () => {
        W.engineStop = null;
      });
      ac.on(EVENTS.DAMAGE, (d) => {
        try {
          if (!d || !d.worsened || !(d.level > 0.55)) return;
          if (W.kind !== 'plane' && W.kind !== 'heli') return;
          if (ac.onGround || ac.crashed) return;
          if (info().engineParts.includes(d.part)) startFire();
        } catch (e) {
          /* a fire that could not be started is not worth a crash */
        }
      });
    }
    // Paused, or on the menu: the panel goes, and the autopilot change that
    // is about to be made from the pause menu is the pilot's own.
    const iv = setInterval(() => {
      if (sim.state !== 'flying') {
        W.sawPause = true;
        hideUi();
      }
    }, 250);
    if (iv && typeof iv.unref === 'function') iv.unref(); // node tests
    W.interval = iv;
    /*
     * For the other teams and for the tests. `trafficLevel` is what the
     * minimap colours other aircraft by; `startFire` is for anything that
     * ought to set an engine alight (a meteor, a missile), since the flight
     * model has no fire of its own.
     */
    sim.warnings = {
      isActive: (id) => !!(W.E.alerts[id] && W.E.alerts[id].on),
      active: () => R.ORDER.filter((id) => W.E.alerts[id].on),
      acknowledge: () => acknowledge(),
      trafficLevel: (e) => R.tcasLevelOf(W.tcasOut, e),
      startFire: () => startFire(),
      get terrainAheadS() {
        return W.terrainS;
      },
      get shoalAheadS() {
        return W.shoalS;
      },
      get tcasSense() {
        return W.E.tcasSense;
      },
      get callout() {
        return W.E.callout.shown;
      },
      get fire() {
        return W.fire.on;
      },
      drillTraffic: W.drill,
      log: W.log,
      get logN() {
        return W.logN;
      },
      engine: W.E,
      reset: () => resetAll(sim),
    };
  },

  buildWorld(sim, group) {
    buildFx(group);
  },

  startMode(sim) {
    resetAll(sim);
  },

  stop(sim) {
    resetAll(sim);
  },

  update(sim, dt) {
    try {
      tick(sim, dt);
    } catch (err) {
      // Give the gear horn and terrain beep back to alerts.js before the
      // plug-in layer switches this off, or the game would have neither.
      releaseAudio(sim);
      hideUi();
      throw err;
    }
  },

  key(sim, code, down, e) {
    if (!isKey(sim, 'ackWarnings', code)) return false;
    const k = kindOf(sim);
    if (k !== 'plane' && k !== 'heli' && k !== 'boat') return false;
    // R is ours by the contract; but a player who has bound R to something of
    // their own keeps it — all of it. This used to acknowledge first and ask
    // second, so their R silenced the warnings as well as doing their thing.
    // They silence them with a tap on the light instead, and the panel says so.
    if (playerClaimed(sim, code, 'ackWarnings')) return false;
    if (down && !(e && e.repeat)) acknowledge();
    return true;
  },

  devActions: [
    {
      label: 'Warning lights test',
      hint: 'Flies you up to 2,000 ft and shows every cockpit warning in turn, with its sound',
      run(sim) {
        startFlight(sim, () => {
          // The boat's one is not part of an aeroplane's lamp test.
          const ids = R.ORDER.filter((id) => id !== 'fireOut' && id !== 'shoal');
          W.demo = { i: 0, t: 0.8, ids: [...ids, 100, 50, 40, 30, 20, 10] };
        });
      },
    },
    {
      label: 'Engine fire drill',
      hint: 'Flies you up to 2,000 ft and sets the engine on fire after four seconds — press R to pull the handle',
      run(sim) {
        startFlight(sim, () => {
          setTimeout(() => {
            if (sim.state === 'flying' && sim.mode === 'free') startFire();
          }, 4000);
        });
      },
    },
    {
      label: 'Traffic (TCAS) drill',
      hint: 'Flies you up to 2,000 ft and sends another aeroplane straight at you — TRAFFIC first, then CLIMB: do what it says',
      run(sim) {
        startFlight(sim, () => {
          const ac = sim.aircraft;
          const V = ac.pos.constructor;
          const h = ac.heading || 90;
          /*
           * 4.6 km out, closing at about 113 m/s: forty seconds to meet, so
           * TRAFFIC comes first at 35 and CLIMB at 22. It started at 2.6 km,
           * which is 21.7 s — straight into CLIMB with no TRAFFIC before it,
           * which is not the order anybody should learn them in.
           */
          const pos = new V(ac.pos.x + Math.sin(h * DEG) * 4600, ac.pos.y - 25, ac.pos.z - Math.cos(h * DEG) * 4600);
          W.drill.length = 0;
          const d = {
            id: 'tcas-drill',
            typeId: 'skylark',
            pos,
            heading: (h + 180) % 360,
            speed: 55,
            alt: pos.y,
            onGround: false,
            phase: 'drill',
            tcas: true,
            life: 80,
            model: null,
          };
          W.drill.push(d);
          showDrillModel(sim, d);
        });
      },
    },
  ],
});

/* For the node tests. */
export const __warnings = { W, kindOf, info, reading, tick, acknowledge, startFire, resetAll };

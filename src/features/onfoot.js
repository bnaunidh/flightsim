/**
 * Getting out and walking about.
 *
 * "Add you can come out of plane." Stop on the ground and press O: a little
 * pilot climbs down beside the door and the game is yours on foot — W A S D
 * to walk (Shift to run), the mouse or the arrow keys to look round, C for
 * the view, Space to jump, E to wave. Walk back to the aeroplane and press O
 * to get back in. The same works for the boat alongside a quay and the van
 * parked anywhere, and for the ramp crew's vehicles in staff.js.
 *
 * WHAT HAPPENS TO THE AEROPLANE. It is parked: engine off, brakes on,
 * throttle closed, held there every frame through `sim.override` — the one
 * input main.js lets a caller put over the top of the keyboard, applied after
 * the input and the autopilot and before the physics. What was in
 * `sim.override` before is put back when you get in, and the engine is
 * restarted if it was running when you got out. A boat is moored (held where
 * she was, lever at STOP) and a van is parked the same way.
 *
 * THE KEYS. The key hook runs in the capture phase ahead of the game's own
 * input, so while you are walking every flying key is taken — W must not
 * push the parked aeroplane's nose down — except the ones that are about the
 * game rather than the aeroplane: Esc, the map, mute, help, hide-interface
 * (wherever the player has moved them in Settings), and the keys other
 * features reserved (R, T, Y, 7). Key-UPS always go through, so a key that
 * was held when you climbed out is released properly rather than stuck down
 * for the next flight.
 *
 * WHAT IS SOLID. The island's OBSTACLES (buildings, trees), the apron's own
 * furniture (walk.js reads it as "props"), the aeroplane or vehicle you got
 * out of, other aeroplanes on the ground in sim.traffic, and whatever other
 * features list through addProvider (the ramp crew's vehicles). Deep water
 * stops you; shallow water is a paddle.
 *
 * THE CAMERA. Owned through the camera hook while walking. It orbits the
 * walker at shoulder height, never goes through a wall (it pulls in instead)
 * or under the ground, and eases round behind you as you walk forwards so a
 * player with no mouse can steer with W and A alone. Three views on C.
 *
 * On a touch screen there is no O key and no WASD, so the prompt itself is a
 * button and walking gets a thumb-stick, a look pad and big buttons.
 *
 * ON SCREEN, AND WHEN IT IS NOT. The feature layer is drawn above the menus,
 * and update() does not run while paused, so staff/ui.js watches the menu
 * layer and the HUD and takes all of this off screen whenever the game is not
 * flying with its interface up. The same watcher notices if the game has
 * switched this feature off (a hook threw) and hands the aeroplane back.
 *
 * GETTING OUT OF AN AEROPLANE needs it on the ground at walking pace or less
 * with the throttle at idle — a jet at idle creeps — and it is parked as the
 * door opens.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extStatus } from '../game/extensions.js';
import { heightAt, isPaved } from '../world/terrain.js';
import { createPerson, posePerson, setWands, disposePerson } from './staff/person.js';
import { Walker, WALK, groundAt, setTerrainMeshes, forgetObstacles, setProps, solidBox, solidAt } from './staff/walk.js';
import { planeProfile, offset, local, angleDiff } from './staff/jobs.js';
import * as UI from './staff/ui.js';
import * as TYPES from '../aircraft/types.js';

const D2R = Math.PI / 180;

/** What the parked aeroplane is held at while you are out of it. */
const PARK = { throttle: 0, brakes: 1, pitch: 0, roll: 0, yaw: 0 };

/** Keys that are about the game, not the vehicle: always left for the game. */
const PASS = new Set([
  'Escape', 'KeyJ', 'KeyK', 'KeyM', 'KeyU', 'KeyN', 'KeyH', 'Tab',
  'KeyR', 'KeyT', 'KeyY', 'Digit7',
  'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight',
]);

/*
 * ...and whatever keys the player has moved those game actions to. Bindings
 * can be changed in Settings; a player who put Pause on P could not pause
 * while walking, because P is not in the list above and walking takes it.
 */
const GAME_ACTIONS = ['pause', 'help', 'hideUi', 'guide', 'mute', 'minimap', 'minimapRange'];
function passes(sim, code) {
  if (PASS.has(code) || /^F\d+$/.test(code)) return true;
  const b = sim && sim.input && sim.input.bindings;
  if (!b) return false;
  for (let i = 0; i < GAME_ACTIONS.length; i++) {
    const codes = b[GAME_ACTIONS[i]];
    if (codes && codes.indexOf(code) >= 0) return true;
  }
  return false;
}

const VIEWS = ['chase', 'wide', 'eyes'];
const VIEW_LABEL = { chase: 'Behind', wide: 'Wide', eyes: 'Your eyes' };

const S = {
  sim: null,
  active: false,
  walker: new Walker(),
  model: null,
  outfit: 'pilot',
  outfitOverride: null,
  /** What we climbed out of: { type: 'aircraft' | 'vehicle' | 'none', ... } */
  from: null,
  keys: Object.create(null),
  camYaw: 0,
  camPitch: -12,
  view: 'chase',
  lookIdle: 9,
  camPos: new THREE.Vector3(),
  camStarted: false,
  savedFov: null,
  touchHidden: false,
  providers: [],
  control: null,
  hint: '',
  solids: [],
  pool: [],
  poolUsed: 0,
  enter: [],
  entryPool: [],
  promptCache: new Map(),
  stoppedT: 0,
  hintT: 0,
  landCheckT: 0,
  landSpot: null,
  jump: false,
  runToggle: false,
  helloT: 0,
  since: 0,
  profCache: new Map(),
  drag: null,
  tmpLook: { x: 0, y: 0 },
  /** Which half of the stride the feet are in, for the footsteps. */
  stepHalf: 0,
  wasAir: false,
  /** The game switched this feature off and the watchdog has tidied up. */
  retired: false,
  staffGone: false,
};

const _v = new THREE.Vector3();
const _look = new THREE.Vector3();
const _oa = { x: 0, z: 0 };
const _ob = { x: 0, z: 0 };
const _la = { along: 0, side: 0 };
const POSE = { speed: 0, air: false, wave: null };

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function notify(sim, text, kind = 'info', secs = 3) {
  try {
    if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
  } catch (e) {
    /* a HUD that is not there is not worth a thrown frame */
  }
}

/** A soft two-note chime through the game's own mixer, if there is one. */
function chime(sim, up = true) {
  try {
    const a = sim && sim.audio;
    if (!a || !a.available || !a.mixer || !a.mixer.tone) return;
    a.mixer.tone({ bus: 'alerts', freq: up ? 660 : 520, duration: 0.12, gain: 0.05, type: 'sine' });
    setTimeout(() => {
      try { a.mixer.tone({ bus: 'alerts', freq: up ? 880 : 390, duration: 0.16, gain: 0.05, type: 'sine' }); } catch (e) { /* ignore */ }
    }, 110);
  } catch (e) {
    /* sound is a nicety */
  }
}

function isTouch(sim) {
  return !!(sim && sim.touch);
}

/**
 * One footstep: a short burst of filtered noise through the game's own
 * mixer, on the environment bus so the player's volume and mute apply. Crisp
 * on tarmac, dull on grass, a splash in the shallows. Quiet: a step is
 * something you notice when it stops, not something you listen to.
 */
function footstep(sim, w, landing) {
  try {
    const a = sim && sim.audio;
    const mx = a && a.available && a.mixer;
    if (!mx || !mx.noiseBurst) return;
    const wet = w.wading;
    const hard = !wet && isPaved(w.x, w.z);
    mx.noiseBurst({
      bus: 'environment',
      duration: wet ? 0.16 : landing ? 0.12 : 0.055,
      gain: (landing ? 0.06 : 0.03) * (w.speed > 3 ? 1.3 : 1),
      type: wet ? 'highpass' : 'bandpass',
      freq: wet ? 1600 : hard ? 950 : 360,
      q: hard ? 1.3 : 0.7,
    });
  } catch (e) {
    /* sound is a nicety */
  }
}

function driving(sim) {
  return !!(sim && sim.mode === 'drive' && sim.vehicle);
}

/** A pooled oriented box for this frame's solids list. */
function addSolid(x, z, heading, hl, hw, y0, y1, tag) {
  let s = S.pool[S.poolUsed];
  if (!s) {
    s = {};
    S.pool.push(s);
  }
  S.poolUsed++;
  solidBox(s, x, z, heading, hl, hw, y0, y1, tag);
  S.solids.push(s);
  return s;
}

function profileFor(sim) {
  const type = sim.aircraftType || null;
  const key = `${type ? type.id : '?'}|${sim.model ? sim.model.uuid : ''}`;
  let p = S.profCache.get(key);
  if (!p) {
    p = planeProfile(type, sim.model || null);
    S.profCache.set(key, p);
  }
  return p;
}

/*
 * Which way the aeroplane you left points NOW. Parked, it does not turn by
 * itself — but the airport's ground crew can push it back with you out on
 * the apron, and its box and its door must go round with it.
 */
function acHeading(sim, f) {
  const h = sim.aircraft && sim.aircraft.heading;
  return Number.isFinite(h) ? h : f.heading;
}

/** The aeroplane you are standing next to, as boxes the walker cannot enter. */
function aircraftSolids(sim) {
  const f = S.from;
  if (!f || f.type !== 'aircraft' || !sim.aircraft) return;
  const p = f.prof;
  const ac = sim.aircraft;
  const h = acHeading(sim, f);
  const g = f.groundY;
  const mid = (p.nose + p.tail) / 2;
  const c = offset(ac.pos.x, ac.pos.z, h, mid, 0, _oa);
  addSolid(c.x, c.z, h, (p.nose - p.tail) / 2, p.halfWidth, g - 1, Math.max(g + 1, g + p.top), 'the aeroplane');
  // The wing, which a walker only meets if it is lower than their head.
  if (p.wingH < WALK.height + 0.3) {
    const w = offset(ac.pos.x, ac.pos.z, h, (p.wingFront + p.wingBack) / 2, 0, _ob);
    addSolid(w.x, w.z, h, (p.wingFront - p.wingBack) / 2, p.wingSpan || p.halfSpan, g + p.wingH - 0.3, g + p.wingH + 0.3, 'the wing');
  }
}

/*
 * Other aeroplanes taxiing and parked round you (the traffic feature's
 * sim.traffic, when it is there): solid, like the one you got out of. Types
 * are measured once each from their shape numbers.
 */
const trafficProf = new Map();
/** An aeroplane type's measured profile by id, or null; once per type. */
function typeProfile(typeId) {
  let p = trafficProf.get(typeId);
  if (p === undefined) {
    const type = (TYPES.AIRCRAFT || []).find((a) => a && a.id === typeId) || null;
    p = type ? planeProfile(type, null) : null;
    trafficProf.set(typeId, p);
  }
  return p;
}

function trafficSolids(sim, cx, cz) {
  const list = sim.traffic;
  if (!Array.isArray(list) || !list.length) return;
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (!t || !t.pos || !t.onGround) continue;
    const dx = t.pos.x - cx;
    const dz = t.pos.z - cz;
    if (dx * dx + dz * dz > 80 * 80) continue;
    const p = typeProfile(t.typeId);
    if (!p) continue;
    const h = Number.isFinite(t.heading) ? t.heading : 0;
    const g = groundAt(t.pos.x, t.pos.z);
    const c = offset(t.pos.x, t.pos.z, h, (p.nose + p.tail) / 2, 0, _oa);
    addSolid(c.x, c.z, h, (p.nose - p.tail) / 2, p.halfWidth, g - 1, g + Math.max(1, p.top), 'an aeroplane');
    if (p.wingH < WALK.height + 0.3) {
      const wc = offset(t.pos.x, t.pos.z, h, (p.wingFront + p.wingBack) / 2, 0, _ob);
      addSolid(wc.x, wc.z, h, (p.wingFront - p.wingBack) / 2, p.wingSpan || p.halfSpan, g + p.wingH - 0.3, g + p.wingH + 0.3, 'a wing');
    }
  }
}

/**
 * Everything solid that is not the thing you got out of: traffic, and
 * whatever the other features list (the ramp crew's vehicles and airliner).
 * Used for the spot you step out onto as well as for every step after it —
 * stepping out of the stair truck used to be checked against the stair
 * truck alone, and could put you inside the baggage carts parked beside it.
 */
function otherSolids(sim, cx, cz) {
  trafficSolids(sim, cx, cz);
  for (const p of S.providers) {
    try {
      if (p.solids) p.solids(sim, addSolid);
    } catch (e) {
      console.warn('[onfoot] a provider failed to list its solid things', e);
    }
  }
}

/** Could somebody stand here? Dry enough, not inside anything, not a cliff away. */
function spotOK(x, z, refY) {
  if (heightAt(x, z) < WALK.deep) return false;
  const g = groundAt(x, z);
  if (refY != null && Math.abs(g - refY) > 3) return false;
  return !solidAt(x, z, g, WALK.radius + 0.08, S.solids);
}

/* ------------------------------------------------------------------ */
/* Getting out                                                         */
/* ------------------------------------------------------------------ */

/** Why you cannot get out right now, or null if you can. */
export function cannotGetOut(sim) {
  if (!sim || sim.state !== 'flying' || S.retired) return 'Not now';
  if (driving(sim)) {
    const v = sim.vehicle;
    if (v.crashed) return 'Not after that — press Esc to go back';
    if (v.swamped) return 'Hold on — the truck is pulling you out';
    if (Math.abs(v.speed || 0) > (v.isBoat ? 0.6 : 0.8)) return 'Stop first, then press O to get out';
    return null;
  }
  const ac = sim.aircraft;
  if (!ac) return 'Not now';
  if (ac.crashed) return 'Not after that — press Esc and choose Restart';
  if (!ac.onGround) return 'You cannot get out in the air!';
  /*
   * Walking pace or less, and it is parked for you. A jet at idle on the
   * runway creeps: measured two seconds after the start, a Meridian at 0.91
   * m/s, an A320 at 0.99, a 747 at 1.07 and an F-35B at 1.63 — so with the
   * old limit of 1 m/s a 747 or an F-35B could only be left by holding the
   * brakes and pressing O at the same time.
   */
  if ((ac.groundSpeed || 0) > CREEP) return 'Stop the aeroplane first (hold Space to brake), then press O';
  return null;
}

/** Ground speed, m/s, an aeroplane is parked from when you get out: a brisk walk. */
const CREEP = 2.0;

function exitAircraft(sim) {
  const ac = sim.aircraft;
  const prof = profileFor(sim);
  const heading = ac.heading;
  const g = groundAt(ac.pos.x, ac.pos.z);
  S.from = {
    type: 'aircraft',
    prof,
    heading,
    groundY: g,
    x: ac.pos.x,
    z: ac.pos.z,
    engineWasOn: !!(ac.engineOn || ac.starting > 0),
    override: sim.override,
  };
  // Where the pilot sits, along the aeroplane: that is where the door is.
  const sh = (sim.aircraftType && sim.aircraftType.shape) || {};
  const eyeZ = sh.eye ? sh.eye[2] * (sh.scale || 1) : 0;
  const along = Math.max(prof.tail + 1, Math.min(prof.nose - 0.6, -eyeZ));
  S.solids.length = 0;
  S.poolUsed = 0;
  aircraftSolids(sim);
  otherSolids(sim, ac.pos.x, ac.pos.z);
  let spot = null;
  // Out of the left door, stepping further out until clear of anything low.
  for (const side of [-1, 1]) {
    for (let lat = prof.halfWidth + 0.7; lat < prof.halfSpan + 3 && !spot; lat += 0.7) {
      const p = offset(ac.pos.x, ac.pos.z, heading, along, side * lat);
      if (spotOK(p.x, p.z, g)) spot = { x: p.x, z: p.z, heading: (heading + side * 90 + 360) % 360 };
    }
    if (spot) break;
  }
  if (!spot) {
    // Nowhere beside it (a narrow deck, a hangar): in front of the nose.
    for (const d of [2, 4, 7]) {
      const p = offset(ac.pos.x, ac.pos.z, heading, prof.nose + d, 0);
      if (spotOK(p.x, p.z, g)) {
        spot = { x: p.x, z: p.z, heading };
        break;
      }
    }
  }
  if (!spot) {
    S.from = null;
    return 'There is nowhere to stand here';
  }
  // Park it. The engine goes off; it comes back on when you get back in.
  if (ac.engineOn && ac.stopEngine) ac.stopEngine('shutdown');
  if (ac.starting > 0) ac.starting = 0;
  sim.override = PARK;
  // Still creeping at idle: the brakes are on as you open the door, not a
  // metre later with you already beside the wheel.
  if (ac.vel && ac.vel.isVector3) {
    ac.vel.x = 0;
    ac.vel.z = 0;
  }
  if (ac.omega && ac.omega.isVector3) ac.omega.y = 0;
  if (sim.input) sim.input.throttleTarget = 0;
  if (sim.autopilot && sim.autopilot.engaged && sim.toggleAutopilot) sim.toggleAutopilot(false);
  begin(sim, spot.x, spot.z, spot.heading, S.outfitOverride || 'pilot', true);
  return null;
}

/** A dry place to step off a boat onto, or null. */
function landingFor(v) {
  for (const r of [2.8, 4, 5.5, 7, 9]) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const x = v.pos.x + Math.sin(a) * r;
      const z = v.pos.z - Math.cos(a) * r;
      const h = heightAt(x, z);
      if (h < 0.25 || h > 6) continue;
      if (solidAt(x, z, groundAt(x, z), WALK.radius + 0.08, null)) continue;
      return { x, z, heading: (a * 180) / Math.PI };
    }
  }
  return null;
}

function exitVehicle(sim) {
  const v = sim.vehicle;
  const spec = v.spec || {};
  const moor = { x: v.pos.x, z: v.pos.z, heading: v.heading };
  let spot = null;
  S.solids.length = 0;
  S.poolUsed = 0;
  if (v.isBoat) {
    spot = landingFor(v);
    if (!spot) return 'Bring her alongside the quay first — there is nowhere dry to step off';
  } else {
    const hw = spec.halfWidth || 1.05;
    const hl = spec.halfLength || 2.4;
    addSolid(v.pos.x, v.pos.z, v.heading, hl, hw, v.pos.y - 1, v.pos.y + (spec.height || 2.2), spec.name || 'the van');
    otherSolids(sim, v.pos.x, v.pos.z);
    const g = groundAt(v.pos.x, v.pos.z);
    const tries = [
      [hl * 0.25, -(hw + 0.6)], [hl * 0.25, hw + 0.6], [-(hl + 0.8), 0], [hl + 0.8, 0],
      [hl * 0.25, -(hw + 1.6)], [hl * 0.25, hw + 1.6],
    ];
    for (const [a, s] of tries) {
      const p = offset(v.pos.x, v.pos.z, v.heading, a, s);
      if (spotOK(p.x, p.z, g)) {
        spot = { x: p.x, z: p.z, heading: (v.heading + (s < 0 ? -90 : s > 0 ? 90 : 0) + 360) % 360 };
        break;
      }
    }
    if (!spot) return 'There is no room to open the door here';
  }
  S.from = { type: 'vehicle', kind: v.isBoat ? 'boat' : spec.id || 'car', staff: !!spec.staff, moor };
  const outfit = S.outfitOverride || (spec.staff ? 'staff' : v.isBoat ? 'pilot' : 'passenger');
  begin(sim, spot.x, spot.z, spot.heading, outfit, true);
  return null;
}

/** Press O while driving or flying. */
export function getOut(sim) {
  const why = cannotGetOut(sim);
  if (why) return why;
  return driving(sim) ? exitVehicle(sim) : exitAircraft(sim);
}

/* ------------------------------------------------------------------ */
/* Walking                                                             */
/* ------------------------------------------------------------------ */

function begin(sim, x, z, headingDeg, outfit, fromVehicle) {
  S.sim = sim;
  if (S.model && S.outfit !== outfit) {
    disposePerson(S.model);
    S.model = null;
  }
  S.outfit = outfit;
  if (!S.model) {
    S.model = createPerson({ outfit, seed: outfit === 'passenger' ? 11 : 5 });
    S.model.name = 'onfoot:walker';
  }
  if (sim.scene && S.model.parent !== sim.scene) sim.scene.add(S.model);
  S.model.visible = true;
  setWands(S.model, false);
  S.walker.place(x, z, headingDeg);
  S.walker.walked = 0;
  // A little hop down out of the cockpit.
  if (fromVehicle) {
    S.walker.y += 0.5;
    S.walker.air = true;
    S.walker.vy = 1.2;
  }
  S.active = true;
  S.since = 0;
  S.wasAir = S.walker.air;
  S.keys = Object.create(null);
  // Out of a vehicle, the camera starts in front of you looking back, so the
  // first thing you see is yourself standing beside what you got out of.
  S.camYaw = headingDeg + (fromVehicle ? 150 : 0);
  S.camPitch = -12;
  S.lookIdle = 9;
  S.camStarted = false;
  S.jump = false;
  S.helloT = 0;
  S.stoppedT = 0;
  if (sim.camera && S.savedFov == null) S.savedFov = sim.camera.fov;
  // The flight / drive thumb controls give way to the walking ones.
  if (sim.touch && sim.touch.setVisible) {
    sim.touch.setVisible(false);
    S.touchHidden = true;
  }
  if (sim.input && sim.input.keys && sim.input.keys.clear) sim.input.keys.clear();
  UI.setHudWalking(sim.hud, true);
  chime(sim, false);
}

/** Put the walker away and hand the vehicle back. */
function finish(sim) {
  if (!S.active) return;
  S.active = false;
  S.control = null;
  if (S.model) {
    S.model.visible = false;
    if (S.model.parent) S.model.parent.remove(S.model);
  }
  const f = S.from;
  S.from = null;
  if (f && f.type === 'aircraft' && sim) {
    sim.override = f.override === PARK ? null : f.override || null;
    if (sim.input) {
      sim.input.throttleTarget = 0;
      if (sim.input.out) sim.input.out.throttle = 0;
      if (sim.input.mouse) {
        sim.input.mouse.x = 0;
        sim.input.mouse.y = 0;
      }
    }
    const ac = sim.aircraft;
    if (f.engineWasOn && ac && !ac.engineOn && !ac.crashed && ac.startEngine) ac.startEngine();
  }
  if (sim && sim.camera && S.savedFov != null) {
    sim.camera.fov = S.savedFov;
    sim.camera.updateProjectionMatrix();
  }
  S.savedFov = null;
  if (sim && sim.driveCam) sim.driveCam.started = false;
  if (S.touchHidden && sim && sim.touch && sim.touch.setVisible) sim.touch.setVisible(true);
  S.touchHidden = false;
  UI.setTouch(false);
  UI.setPrompt('');
  if (sim) UI.setHudWalking(sim.hud, false);
  S.keys = Object.create(null);
  if (sim && sim.input && sim.input.keys && sim.input.keys.clear) sim.input.keys.clear();
}

/** Get back into whatever you got out of. */
function getBackIn(sim) {
  finish(sim);
  chime(sim, true);
}

/** One pooled entry in this frame's list of things to get into. */
function addEntry(label, dist, enter) {
  let e = S.entryPool[S.enter.length];
  if (!e) {
    e = { label: '', dist: 0, enter: null };
    S.entryPool.push(e);
  }
  e.label = label;
  e.dist = dist;
  e.enter = enter;
  S.enter.push(e);
  return e;
}

/**
 * Everything you could get into from where you stand, nearest first. The
 * list and its entries are reused frame to frame.
 */
function gatherEnterables(sim) {
  const out = S.enter;
  out.length = 0;
  const w = S.walker;
  const f = S.from;
  if (f && f.type === 'aircraft' && sim.aircraft) {
    const ac = sim.aircraft;
    const l = local(ac.pos.x, ac.pos.z, acHeading(sim, f), w.x, w.z, _la);
    const p = f.prof;
    // Distance from the fuselage box, not from the middle: an airliner's
    // door is fifteen metres from its centre of gravity.
    const da = Math.max(0, l.along - p.nose, p.tail - l.along);
    const ds = Math.max(0, Math.abs(l.side) - p.halfWidth);
    const d = Math.hypot(da, ds);
    if (d < 2.6) addEntry('the aeroplane', d, getBackIn);
  } else if (f && f.type === 'vehicle' && !f.staff && driving(sim)) {
    const v = sim.vehicle;
    const d = Math.hypot(v.pos.x - w.x, v.pos.z - w.z);
    const reach = v.isBoat ? 9 : (v.spec && v.spec.halfLength ? v.spec.halfLength + 2.2 : 4.5);
    if (d < reach) addEntry(v.isBoat ? 'the boat' : 'the van', d, getBackIn);
  }
  for (const p of S.providers) {
    try {
      if (p.enterables) p.enterables(sim, w, addEntry);
    } catch (e) {
      console.warn('[onfoot] a provider failed to list what can be entered', e);
    }
  }
  if (out.length > 1) out.sort(byDist);
  return out;
}

function byDist(a, b) {
  return a.dist - b.dist;
}

function pressO(sim) {
  if (S.active) {
    // Whoever has the walker (the marshalling wands) may take O to let go.
    const ctl = S.control;
    if (ctl && typeof ctl.onO === 'function') {
      try {
        ctl.onO(sim);
      } catch (err) {
        console.warn('[onfoot] control O handler failed', err);
        S.control = null;
      }
      return true;
    }
    const list = gatherEnterables(sim);
    if (list.length) {
      enter(sim, list[0].enter);
      return true;
    }
    const f = S.from;
    notify(sim, f && f.type === 'aircraft' ? 'Walk up to the aeroplane to get back in' : 'Walk up to something to get in', 'info', 2.4);
    return false;
  }
  const why = getOut(sim);
  if (why) {
    notify(sim, why, 'info', 2.6);
    return false;
  }
  return true;
}

function cycleView(sim) {
  const i = VIEWS.indexOf(S.view);
  S.view = VIEWS[(i + 1) % VIEWS.length];
  S.camStarted = false;
  notify(sim, `View: ${VIEW_LABEL[S.view]}`, 'info', 1.6);
}

/* ------------------------------------------------------------------ */
/* One frame on foot                                                   */
/* ------------------------------------------------------------------ */

function holdVehicle(sim) {
  const f = S.from;
  if (f && f.type === 'aircraft') {
    if (sim.override !== PARK) sim.override = PARK;
    if (sim.input) sim.input.throttleTarget = 0;
  }
  // Whatever you are driving (or were), it stays where you left it.
  if (driving(sim)) {
    const v = sim.vehicle;
    const m = f && f.moor;
    if (m) {
      v.pos.x = m.x;
      v.pos.z = m.z;
      v.heading = m.heading;
    }
    v.speed = 0;
    if (v.vel && v.vel.set) v.vel.set(0, 0, 0);
    if (v.isBoat && v.setLever) v.setLever(1);
  }
}

function walkFrame(sim, dt) {
  S.since += dt;
  holdVehicle(sim);

  const K = S.keys;
  const T = UI.touch;
  const ctl = S.control;
  const locked = !!(ctl && ctl.locked);

  // Look: arrows, the mouse (in the pointer handlers) and the touch pad.
  let looked = false;
  const turn = (K.ArrowRight ? 1 : 0) - (K.ArrowLeft ? 1 : 0);
  const tilt = (K.ArrowUp ? 1 : 0) - (K.ArrowDown ? 1 : 0);
  if (turn) {
    S.camYaw += turn * 110 * dt;
    looked = true;
  }
  if (tilt) {
    S.camPitch += tilt * 60 * dt;
    looked = true;
  }
  const tl = UI.takeLook(S.tmpLook);
  if (tl.x || tl.y) {
    S.camYaw += tl.x * 0.3;
    S.camPitch -= tl.y * 0.22;
    looked = true;
  }
  if (S.drag && (S.drag.dx || S.drag.dy)) {
    S.camYaw += S.drag.dx * 0.25;
    S.camPitch -= S.drag.dy * 0.2;
    S.drag.dx = 0;
    S.drag.dy = 0;
    looked = true;
  }
  S.camPitch = Math.max(-62, Math.min(28, S.camPitch));
  S.lookIdle = looked ? 0 : S.lookIdle + dt;

  // Move, relative to where the camera looks.
  let ix = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0) + T.x;
  let iy = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0) + T.y;
  if (locked) {
    ix = 0;
    iy = 0;
  }
  const cy = S.camYaw * D2R;
  const fx = Math.sin(cy);
  const fz = -Math.cos(cy);
  let mx = fx * iy + Math.cos(cy) * ix;
  let mz = fz * iy + Math.sin(cy) * ix;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) {
    mx /= ml;
    mz /= ml;
  }
  const run = !!(K.ShiftLeft || K.ShiftRight || T.run || S.runToggle);

  S.solids.length = 0;
  S.poolUsed = 0;
  aircraftSolids(sim);
  if (driving(sim) && S.from && S.from.type === 'vehicle' && !S.from.staff && !sim.vehicle.isBoat) {
    const v = sim.vehicle;
    const sp = v.spec || {};
    addSolid(v.pos.x, v.pos.z, v.heading, sp.halfLength || 2.4, sp.halfWidth || 1.05, v.pos.y - 1, v.pos.y + (sp.height || 2.2), 'the van');
  }
  otherSolids(sim, S.walker.x, S.walker.z);

  const w = S.walker;
  w.step(dt, mx, mz, run, S.jump && !locked, S.solids);
  S.jump = false;
  if (locked && ctl.face != null) w.heading = ctl.face;

  // The camera eases round behind you while you walk forwards.
  if (!locked && iy > 0.2 && S.lookIdle > 0.8 && S.view !== 'eyes' && w.speed > 0.3) {
    const d = angleDiff(w.heading, S.camYaw);
    S.camYaw += d * Math.min(1, dt * 1.3 * iy);
  }
  if (ctl && ctl.camYaw != null && S.lookIdle > 1.2) {
    S.camYaw += angleDiff(ctl.camYaw, S.camYaw) * Math.min(1, dt * 2);
  }
  S.camYaw = ((S.camYaw % 360) + 360) % 360;

  // The body.
  const m = S.model;
  if (m) {
    m.position.set(w.x, w.y, w.z);
    m.rotation.set(0, -w.heading * D2R, 0);
    if (S.helloT > 0) S.helloT -= dt;
    POSE.speed = w.speed;
    POSE.air = w.air;
    POSE.wave = ctl && ctl.wave ? ctl.wave : S.helloT > 0 ? 'hello' : null;
    posePerson(m, dt, POSE);
    setWands(m, !!(ctl && ctl.wands));
    m.visible = S.view !== 'eyes';
    // A soft step each time a foot goes down, and a thump on landing.
    const A = m.userData.anim;
    if (A) {
      const half = A.phase < Math.PI ? 0 : 1;
      if (half !== S.stepHalf) {
        S.stepHalf = half;
        if (w.speed > 0.6 && !w.air) footstep(sim, w, false);
      }
    }
    if (S.wasAir && !w.air) footstep(sim, w, true);
    S.wasAir = w.air;
  }

  // What O would do here.
  const list = gatherEnterables(sim);
  if (list.length) {
    const e = list[0];
    S.promptEnter = e.enter;
    UI.setPrompt(promptFor(sim, e.label), enterFromPrompt);
  } else if (ctl && ctl.prompt) {
    UI.setPrompt(ctl.prompt, ctl.promptAction || null);
  } else if (S.hint) {
    UI.setPrompt(S.hint);
  } else if (S.since < 6) {
    UI.setPrompt(
      isTouch(sim)
        ? 'Use the stick to walk — push it right out to run'
        : '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk · <kbd>Shift</kbd> run · <kbd>C</kbd> view · <kbd>E</kbd> wave'
    );
  } else {
    UI.setPrompt('');
  }
  if (sim.hud && sim.hud.setCoach) sim.hud.setCoach(null);

  if (isTouch(sim)) {
    const btns = ctl && ctl.buttons ? ctl.buttons : S.runToggle ? WALK_BUTTONS_RUN : WALK_BUTTONS;
    UI.setTouch(true, btns, onTouchButton);
  }

  placeCamera(sim, dt);
}

const WALK_BUTTONS = [
  { id: 'run', label: 'Run' },
  { id: 'jump', label: 'Jump' },
  { id: 'view', label: 'View' },
  { id: 'wave', label: 'Wave' },
];
const WALK_BUTTONS_RUN = WALK_BUTTONS.map((b) => (b.id === 'run' ? { ...b, on: true } : b));

function onTouchButton(id) {
  const sim = S.sim;
  if (id === 'run') S.runToggle = !S.runToggle;
  else if (id === 'jump') S.jump = true;
  else if (id === 'view') cycleView(sim);
  else if (id === 'wave') S.helloT = 2.2;
  else if (S.control && S.control.onButton) S.control.onButton(id);
}

function pressOFromPrompt() {
  if (S.sim) pressO(S.sim);
}

function enterFromPrompt() {
  const fn = S.promptEnter;
  if (S.active && fn) enter(S.sim, fn);
}

/*
 * Getting into a ramp vehicle is staff.js's code, which calls startDrive,
 * which is the car team's. It runs from this feature's key hook, so a throw
 * in there would switch walking off for the session with the walker still
 * standing on the apron. Caught here; the walker stays a walker.
 */
function enter(sim, fn) {
  try {
    fn(sim);
  } catch (err) {
    console.warn('[onfoot] getting in failed', err);
    notify(sim, 'That will not start just now — try again', 'warn', 2.5);
  }
}

/** "Press O to get in the tug", built once per label rather than per frame. */
function promptFor(sim, label) {
  const key = (isTouch(sim) ? 't:' : 'k:') + label;
  let html = S.promptCache.get(key);
  if (!html) {
    html = isTouch(sim) ? `Tap here to get in ${label}` : `Press <kbd>O</kbd> to get in ${label}`;
    S.promptCache.set(key, html);
  }
  return html;
}

function placeCamera(sim, dt) {
  const cam = sim.camera;
  if (!cam) return;
  const w = S.walker;
  const yaw = S.camYaw * D2R;
  const pitch = S.camPitch * D2R;
  const lx = Math.sin(yaw) * Math.cos(pitch);
  const ly = Math.sin(pitch);
  const lz = -Math.cos(yaw) * Math.cos(pitch);
  if (S.view === 'eyes') {
    _v.set(w.x + lx * 0.15, w.y + 1.62, w.z + lz * 0.15);
    S.camPos.copy(_v);
    S.camStarted = true;
  } else {
    const wide = S.view === 'wide';
    const D = wide ? 11 : 4.4;
    const tx = w.x;
    const ty = w.y + (wide ? 1.2 : 1.5);
    const tz = w.z;
    const pl = wide ? Math.min(ly, -0.28) : ly;
    let d = D;
    /*
     * Pull in rather than look through a wall. The test is a short column
     * round the lens, not a person-height one: tested as if the camera were
     * a person standing there, a high wing two metres up counted as a wall,
     * and walking under a Skylark's wing put the camera in the pilot's face.
     */
    for (let k = 1; k <= 6; k++) {
      const t = (D * k) / 6;
      const px = tx - lx * t;
      const py = ty - pl * t;
      const pz = tz - lz * t;
      if (solidAt(px, pz, py - 0.3, 0.2, S.solids, 0.6) || py < groundAt(px, pz) + 0.15) {
        d = Math.max(0.7, t - D / 6);
        break;
      }
    }
    _v.set(tx - lx * d, ty - pl * d, tz - lz * d);
    const floor = groundAt(_v.x, _v.z) + 0.35;
    if (_v.y < floor) _v.y = floor;
    if (!S.camStarted || d < D) {
      S.camPos.copy(_v);
      S.camStarted = true;
    } else {
      S.camPos.lerp(_v, Math.min(1, dt * 12));
    }
  }
  cam.position.copy(S.camPos);
  if (S.view === 'eyes') _look.set(S.camPos.x + lx, S.camPos.y + ly, S.camPos.z + lz);
  else _look.set(w.x + lx * 1.5, w.y + (S.view === 'wide' ? 1.0 : 1.35) + ly * 1.5, w.z + lz * 1.5);
  cam.lookAt(_look);
  const wantFov = S.view === 'eyes' ? 70 : 62;
  if (Math.abs(cam.fov - wantFov) > 0.05 || cam.near !== 0.1) {
    cam.fov += (wantFov - cam.fov) * Math.min(1, dt * 4);
    cam.near = 0.1;
    cam.updateProjectionMatrix();
  }
}

/** Not walking: offer the way out when it is on offer. */
function idleFrame(sim, dt) {
  S.sim = sim;
  if (sim.state !== 'flying') {
    S.stoppedT = 0;
    UI.setPrompt('');
    return;
  }
  let stopped = false;
  if (driving(sim)) {
    const v = sim.vehicle;
    stopped = Math.abs(v.speed || 0) < 0.3 && !v.crashed && !v.swamped;
    if (stopped && v.isBoat) {
      S.landCheckT -= dt;
      if (S.landCheckT <= 0) {
        S.landCheckT = 0.5;
        S.landSpot = landingFor(v);
      }
      stopped = !!S.landSpot;
    }
  } else if (sim.aircraft) {
    const ac = sim.aircraft;
    // Stopped, or creeping at idle (see CREEP): not taxiing on purpose.
    const idle = !(ac.controls && ac.controls.throttle > 0.15);
    stopped = !!(ac.onGround && !ac.crashed && (ac.groundSpeed || 0) < (idle ? CREEP : 0.5)) && !sim.bracing;
  }
  S.stoppedT = stopped ? S.stoppedT + dt : 0;
  const staffDrive = driving(sim) && sim.vehicle.spec && sim.vehicle.spec.staff;
  // On a keyboard it is a hint that comes and goes; on a touch screen it is
  // the only door there is, so it stays.
  const show = S.stoppedT > 1.5 && (isTouch(sim) || S.stoppedT < 9 || staffDrive);
  if (show) {
    UI.setPrompt(isTouch(sim) ? 'Tap here to get out' : 'Press <kbd>O</kbd> to get out', pressOFromPrompt);
  } else if (S.hint && staffDrive) {
    UI.setPrompt(S.hint);
  } else {
    UI.setPrompt('');
  }
}

/* ------------------------------------------------------------------ */
/* The API staff.js and the tests use                                  */
/* ------------------------------------------------------------------ */

export const onFoot = {
  get active() {
    return S.active;
  },
  get walker() {
    return S.walker;
  },
  get model() {
    return S.model;
  },
  get view() {
    return S.view;
  },
  get from() {
    return S.from;
  },
  /** True while the walker's hand is up (E, or the Wave button). */
  get waving() {
    return S.active && S.helloT > 0;
  },
  get solids() {
    return S.solids;
  },
  /** Put a walker down with nothing to get back into (the ramp crew). */
  start(sim, { x, z, headingDeg = 0, outfit = 'staff', moorVehicle = true } = {}) {
    // Switched off by the game: nothing would move a walker put down now.
    if (S.retired) return false;
    if (S.active) finish(sim);
    S.from = { type: 'none' };
    if (moorVehicle && driving(sim)) {
      const v = sim.vehicle;
      S.from = { type: 'vehicle', kind: (v.spec && v.spec.id) || 'car', staff: !!(v.spec && v.spec.staff), moor: { x: v.pos.x, z: v.pos.z, heading: v.heading } };
    }
    begin(sim, x, z, headingDeg, outfit, false);
    return true;
  },
  /** Take the walker away. */
  end(sim) {
    finish(sim || S.sim);
  },
  getOut(sim) {
    return getOut(sim);
  },
  pressO(sim) {
    return pressO(sim);
  },
  cannotGetOut(sim) {
    return cannotGetOut(sim);
  },
  /** Teleport, for the tests and for staff.js. */
  place(x, z, headingDeg = S.walker.heading) {
    S.walker.place(x, z, headingDeg);
    S.camStarted = false;
  },
  addProvider(p) {
    if (p && !S.providers.includes(p)) S.providers.push(p);
  },
  /**
   * Hand the walker to somebody else for a while (marshalling):
   *   { locked, face, wave, wands, camYaw, prompt, promptAction,
   *     buttons, onButton, key(sim, code, down) -> bool }
   */
  setControl(c) {
    S.control = c || null;
  },
  get control() {
    return S.control;
  },
  setOutfit(o) {
    S.outfitOverride = o || null;
  },
  setHint(html) {
    S.hint = html || '';
  },
  setView(v) {
    if (VIEWS.includes(v)) {
      S.view = v;
      S.camStarted = false;
    }
  },
  setCamera(yawDeg, pitchDeg = null) {
    S.camYaw = yawDeg;
    if (pitchDeg != null) S.camPitch = pitchDeg;
    S.lookIdle = 0;
  },
  /** What a test wants to know. */
  snapshot() {
    const w = S.walker;
    return {
      active: S.active,
      x: w.x,
      y: w.y,
      z: w.z,
      heading: w.heading,
      walked: w.walked,
      air: w.air,
      wading: w.wading,
      lastBlock: w.lastBlock,
      view: S.view,
      from: S.from ? S.from.type : null,
      outfit: S.outfit,
      prompt: UI.promptText(),
      camYaw: S.camYaw,
    };
  },
  /** For the tests: what the key hook would do with this key. */
  keysHeld() {
    return { ...S.keys };
  },
  /** Run the switched-off watchdog now (the menu watcher runs it four times a second). */
  checkSwitchedOff() {
    watchdog();
    return S.retired;
  },
};

/* ------------------------------------------------------------------ */
/* The plug-in                                                         */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'onfoot',

  install(sim) {
    S.sim = sim;
    // Off screen while paused or in a menu, and put right if we are switched off.
    UI.watchGame(sim, watchdog);
    // Drag with the mouse to look round. Only while walking, only the mouse
    // (a finger uses the look pad), and never stopping the game's own
    // listeners from seeing the same events.
    const canvas = sim.renderer && sim.renderer.domElement;
    if (canvas && canvas.addEventListener && typeof window !== 'undefined') {
      canvas.addEventListener('pointerdown', (ev) => {
        if (!S.active || ev.pointerType === 'touch') return;
        S.drag = { dx: 0, dy: 0, id: ev.pointerId };
      });
      window.addEventListener('pointermove', (ev) => {
        if (!S.active || !S.drag || ev.pointerId !== S.drag.id) return;
        S.drag.dx += ev.movementX || 0;
        S.drag.dy += ev.movementY || 0;
      });
      const up = (ev) => {
        if (S.drag && (!ev || ev.pointerId === S.drag.id)) S.drag = null;
      };
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('blur', () => {
        S.keys = Object.create(null);
        S.drag = null;
      });
      /*
       * A key let go while the game is paused must still be let go. The
       * plug-in layer only passes keys on while flying, so walking with W,
       * pausing, releasing W and resuming left S.keys.KeyW set: the walker
       * went on by itself (reviewer: 4.4 m in 3 s). Releases are always safe
       * to take, so they are taken here, whatever the game is doing.
       */
      window.addEventListener('keyup', (ev) => {
        if (S.keys && S.keys[ev.code]) S.keys[ev.code] = false;
      }, true);
    }
  },

  buildWorld(sim) {
    // New terrain, new buildings: re-read the one and forget the other.
    setTerrainMeshes(sim.terrain);
    forgetObstacles();
    // The apron's and the airfield's own things, which OBSTACLES does not list.
    // The carrier's too: its island and the aeroplane parked on its deck.
    // Aeroplanes the apron parks as instances are boxed by their type's shape.
    setProps([sim.apron && sim.apron.group, sim.airport && sim.airport.group, sim.carrier && sim.carrier.group], { aircraft: typeProfile });
    S.profCache.clear();
  },

  startMode(sim) {
    // Anything that starts — a flight, a drive, a restart — starts in the seat.
    if (S.active) finish(sim);
    S.stoppedT = 0;
  },

  stop(sim) {
    if (S.active) finish(sim);
    S.stoppedT = 0;
    UI.setPrompt('');
  },

  update(sim, dt) {
    UI.syncGate();
    if (S.active) {
      // The thing we got out of has gone (a drive ended underneath us).
      const f = S.from;
      if (f && f.type === 'vehicle' && !driving(sim)) {
        finish(sim);
        return;
      }
      walkFrame(sim, dt);
    } else {
      idleFrame(sim, dt);
    }
  },

  camera() {
    return S.active;
  },

  key(sim, code, down, e) {
    if (code === 'KeyO') {
      if (down) unsee(sim, code);
      if (down && !(e && e.repeat)) pressO(sim);
      return true;
    }
    if (!S.active) return false;
    const ctl = S.control;
    if (ctl && ctl.key) {
      try {
        if (ctl.key(sim, code, down)) {
          /*
           * Kept in step here too. W held while walking onto the marshalling
           * spot and let go while waving the wands used to leave KeyW down in
           * this table for ever — the release went to the wands, not here —
           * and when the aeroplane was parked the marshaller set off walking
           * on their own.
           */
          S.keys[code] = down;
          if (down) unsee(sim, code);
          return down;
        }
      } catch (err) {
        console.warn('[onfoot] control key handler failed', err);
      }
    }
    if (passes(sim, code)) return false;
    S.keys[code] = down;
    if (down) unsee(sim, code);
    if (down && !(e && e.repeat)) {
      if (code === 'KeyC') cycleView(sim);
      else if (code === 'Space') S.jump = true;
      else if (code === 'KeyE') S.helloT = 2.2;
    }
    // Take the press; let the release through so nothing the game saw go down
    // before you climbed out is left held.
    return down;
  },
});

/**
 * If the game switches a feature off (one of its hooks threw), nothing calls
 * its update() or key() again — but what it left behind stays. A walker left
 * standing would leave the aeroplane held under sim.override, brakes on and
 * throttle shut, for the rest of the session; the flight's thumb controls
 * hidden and the walking ones up, doing nothing; the camera let go but the
 * instruments still hidden. A ramp shift would leave its job card, and the
 * marshaller locked to the spot. Four times a second, from the menu watcher,
 * this looks, and puts it right once.
 */
function watchdog() {
  if (S.retired) return;
  let meDead = false;
  let staffDead = false;
  const list = extStatus();
  for (let i = 0; i < list.length; i++) {
    const e = list[i];
    if (e.live) continue;
    if (e.id === 'onfoot') meDead = true;
    else if (e.id === 'staff') staffDead = true;
  }
  if (staffDead && !S.staffGone) {
    S.staffGone = true;
    S.control = null;
    S.hint = '';
    S.outfitOverride = null;
    UI.setCard(null);
  }
  if (!meDead) return;
  S.retired = true;
  const sim = S.sim;
  const from = S.from;
  try {
    if (S.active) finish(sim);
  } catch (err) {
    console.warn('[onfoot] could not put the walker away cleanly', err);
    S.active = false;
    if (sim && from && from.type === 'aircraft' && sim.override === PARK) sim.override = from.override || null;
    if (sim && sim.touch && sim.touch.setVisible) sim.touch.setVisible(true);
  }
  UI.setPrompt('');
  UI.setTouch(false);
  if (sim) UI.setHudWalking(sim.hud, false);
}

/**
 * Take a key press back off the game if it has already seen it.
 *
 * The key hook listens in the capture phase so it runs first — for a real
 * keyboard, whose events are aimed at the page and pass the window on the way
 * down. An event aimed at the window ITSELF (which is what sim.key() and so
 * every scripted test sends) is at its target there, and Chrome runs a
 * target's listeners in the order they were added, capture or not: the game's
 * input, added at boot, saw W first and held it. Measured in headless Chrome
 * 153: a bubble listener added before a capture one on window fires first.
 * Consuming the event cannot take back what the input already recorded, so
 * this does.
 */
function unsee(sim, code) {
  const inp = sim && sim.input;
  if (!inp) return;
  try {
    if (inp.keys && inp.keys.delete) inp.keys.delete(code);
    if (inp.pressedThisFrame && inp.pressedThisFrame.delete) inp.pressedThisFrame.delete(code);
  } catch (e) {
    /* an input without those sets never saw the key either */
  }
}

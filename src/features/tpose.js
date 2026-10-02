/**
 * T-Pose Harrison in the game: in the hangar shop, on his own hangar card,
 * his two tricks, and close enough to the camera to see.
 *
 * The aeroplane itself is ../aircraft/extra/tpose.js (the numbers: Massimo's
 * with 0.19% less drag — exactly 1 km/h faster at the top) and
 * ../aircraft/models/tpose-harrison.js (the drawing: a man floating head-first,
 * arms out as the wing, the flap lever flapping them). This file is the parts
 * of the game around him:
 *
 *   THE SHOP. An aeroplane progression.js does not price is locked for ever
 *   (see airliners.js for how that bit the jumbos). He costs 3,601 credits:
 *   one more than Air Massimo, because of course he does.
 *
 *   THE CARD. The Free Flight picker draws every aeroplane's card as a plan
 *   view from its shape. His card gets his portrait instead: flying at you
 *   head-first, arms out, shades on, his shadow on the ground under him and a
 *   "+1 km/h" tag. Painted after the picker paints its own, whenever it does.
 *
 *   THE SPIN CLIMB — T ("harrisonSpin", remappable; SPIN on a touch screen).
 *   He swings head-up, spins like a drill and climbs at 500 kt; T again or a
 *   firm pull or push on the stick and he eases back to level; near the top
 *   of the world he levels off by himself. T is the smoke trail on every
 *   other aeroplane (fun.js) and the hover on the F-35B (stovl.js): on him it
 *   is the spin, and never the smoke.
 *
 *   THE BOOST — P three times ("harrisonBoost", remappable; BOOST on a touch
 *   screen). 1000 kt along his flight path until P P P again or the throttle
 *   goes to idle. P is the autopilot key, so on him a single P waits 0.4 s to
 *   see whether two more follow before it toggles the autopilot — three
 *   quick presses never flip it three times. The spin and the boost cancel
 *   each other. Both are flown by ./tpose/moves.js through the flight
 *   model's own step (endless crash checks included), on a gate installed in
 *   the aeroplane's step the way stovl.js and multiplayer.js install theirs.
 *
 *   THE CAMERA. The follow view stands 17 m back for an aeroplane, which
 *   makes a 3.3 m man a stick figure: he gets 8 m. While he spins straight up
 *   the follow view is ours — behind and below him, upright, never spinning —
 *   and it hands back to the game's own without a jump.
 *
 *   GETTING OUT ON THE GROUND (O, onfoot.js). He IS the aeroplane, so when he
 *   stands up and walks there is nothing left hovering: his floating self is
 *   hidden while the walker is out, and a soft ring on the ground marks where
 *   he was — walk back to it and press O to lie down and float again.
 *   (In the air, eject.js: he opens his own parachute and the flight ends.)
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import * as PROG from '../game/progression.js';
import { ACTIONS, keyLabel } from '../flight/input.js';
import { onFoot } from './onfoot.js';
import { eject } from './eject.js';
import * as FootUI from './staff/ui.js';
import { Moves, PressCounter, BOOST, SPIN, CEILING_M, isSpinSignal } from './tpose/moves.js';
import * as UI from './tpose/ui.js';

export const HARRISON_PRICE = 3601;

try {
  const rows = PROG.UNLOCKS;
  if (Array.isArray(rows) && !rows.some((u) => u && u.aircraft === 'tpose')) {
    rows.push({ aircraft: 'tpose', cost: HARRISON_PRICE, why: 'One km/h faster than Air Massimo' });
  }
} catch (e) {
  console.warn('[tpose] could not put T-Pose Harrison in the shop', e);
}

/*
 * His two keys, as named actions: in the H card, in Settings' key list, and
 * remappable like every other. Added before the game builds its Input, which
 * copies ACTIONS' defaults. `harrisonBoost` shares the autopilot's key on
 * purpose (three quick presses): `presses` and `shares` say so.
 */
if (!ACTIONS.harrisonSpin) {
  ACTIONS.harrisonSpin = { label: 'T-Pose Harrison: spin climb (press again to stop)', group: 'Flying', ctx: ['plane'], default: ['KeyT'] };
}
if (!ACTIONS.harrisonBoost) {
  ACTIONS.harrisonBoost = { label: 'T-Pose Harrison: 1000 kt boost (press 3 times)', group: 'Flying', ctx: ['plane'], default: ['KeyP'], presses: 3, shares: 'autopilot' };
}

/** The follow view's standoff for him, metres (the game's is 17 and 5.2). */
const CHASE = { back: 8, up: 2.6 };
/** The spin camera: behind him and below, metres. */
const SPIN_CAM = { back: 15, below: 5.5 };
const HINT_KEY = 'islandsim.harrison.hint.v1';

const T = {
  sim: null,
  moves: new Moves(),
  presses: new PressCounter(),
  now: 0,
  wrapped: null,
  input: { pitch: 0, roll: 0, throttle: 0 },
  cam: { on: false, pos: new THREE.Vector3(), off: new THREE.Vector3(), vel: new THREE.Vector3(), look: new THREE.Vector3(), blend: 0 },
  hinted: false,
  walkFrom: null,
  wasWalking: false,
  ring: null,
  ringAt: new THREE.Vector3(),
  hidden: false,
  last: [],
  pressCode: '',
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

function isHarrison(sim) {
  return !!(sim && sim.aircraftType && sim.aircraftType.id === 'tpose');
}

/** Flying him right now: in the seat (so to speak), not walking, not under his parachute. */
function flyingHim(sim) {
  return !!(isHarrison(sim) && sim.state === 'flying' && sim.mode !== 'drive' && sim.aircraft && !onFoot.active && eject.phase === 'idle');
}

function isTouch(sim) {
  return !!(sim && sim.touch);
}

function notify(sim, html, kind = 'info', secs = 3) {
  try {
    if (sim.hud && sim.hud.notify) sim.hud.notify(html, kind, secs);
  } catch (e) {
    /* a HUD that is not there is not worth a thrown frame */
  }
}

function bound(sim, action) {
  const b = sim && sim.input && sim.input.bindings;
  const own = b && b[action];
  return own && own.length ? own : ACTIONS[action] ? ACTIONS[action].default : [];
}

/* ------------------------------------------------------------------ */
/* The step                                                            */
/* ------------------------------------------------------------------ */

/**
 * What the pilot is holding, for the moves: the controls main.js put on the
 * aeroplane this frame — except while he spins, when the stick bytes carry
 * the spin pattern between frames (moves.js), and the last real ones stand.
 */
function inputFor(ac) {
  const c = ac.controls;
  if (!isSpinSignal(c)) {
    T.input.pitch = c.pitch || 0;
    T.input.roll = c.roll || 0;
  }
  T.input.throttle = c.throttle || 0;
  return T.input;
}

/** Once per aeroplane, left in the chain: with no move running it is the step it was. */
function wrapStep(sim) {
  const ac = sim && sim.aircraft;
  if (!ac || T.wrapped === ac || ac._tposeGate || typeof ac.update !== 'function') return;
  const inner = ac.update;
  Object.defineProperty(ac, '_tposeGate', { value: true, enumerable: false });
  ac.update = function tposeMoveStep(dt, weather) {
    const mv = T.moves;
    if (!mv.active || this._mpHeld || !isHarrison(T.sim) || this !== T.sim.aircraft) return inner.call(this, dt, weather);
    return mv.step(this, dt, weather, inner, inputFor(this));
  };
  T.wrapped = ac;
}

/* ------------------------------------------------------------------ */
/* The tricks                                                          */
/* ------------------------------------------------------------------ */

function cannotMove(sim, which) {
  const ac = sim.aircraft;
  if (!flyingHim(sim)) return 'Not now';
  if (ac.crashed) return 'Not after that';
  if (!ac.engineOn) return 'Start up first — press I';
  if (which === 'boost' && ac.onGround) return 'Take off first — then P P P for 1000 knots!';
  return null;
}

function autopilotOff(sim) {
  if (sim.autopilot && sim.autopilot.engaged && typeof sim.toggleAutopilot === 'function') sim.toggleAutopilot(false);
}

export function toggleSpin(sim = T.sim) {
  const mv = T.moves;
  if (mv.spinning) return mv.stop('key');
  const why = cannotMove(sim, 'spin');
  if (why) {
    notify(sim, why, 'info', 2.6);
    return false;
  }
  wrapStep(sim);
  autopilotOff(sim);
  return mv.startSpin(sim.aircraft);
}

export function toggleBoost(sim = T.sim) {
  const mv = T.moves;
  if (mv.boosting) return mv.stop('key');
  const why = cannotMove(sim, 'boost');
  if (why) {
    notify(sim, why, 'info', 3);
    return false;
  }
  wrapStep(sim);
  autopilotOff(sim);
  // He means it: the lever goes up if it was at idle (idle is what stops it).
  if (sim.input && sim.input.throttleTarget < 0.2) sim.input.throttleTarget = 1;
  if (sim.aircraft.controls.throttle < 0.2) sim.aircraft.controls.throttle = 1;
  return mv.startBoost(sim.aircraft);
}

/** The sonic boom: two cracks a tenth of a second apart, and the rumble. Never a file. */
function boom(sim) {
  const a = sim && sim.audio;
  const mx = a && a.available && a.mixer ? a.mixer : null;
  if (sim && sim.rig && typeof sim.rig.kick === 'function') sim.rig.kick(0.22);
  if (!mx) return false;
  try {
    mx.noiseBurst({ bus: 'environment', duration: 0.09, gain: 0.32, type: 'lowpass', freq: 900, q: 0.7 });
    mx.noiseBurst({ bus: 'environment', duration: 0.09, gain: 0.28, type: 'lowpass', freq: 800, q: 0.7, when: mx.time + 0.11 });
    mx.noiseBurst({ bus: 'environment', duration: 1.1, gain: 0.16, type: 'lowpass', freq: 160, q: 0.5, pink: true, when: mx.time + 0.05 });
    return true;
  } catch (e) {
    return false;
  }
}

/** What the moves did since last frame: words (few) and the boom. */
function handleEvents(sim) {
  const ev = T.moves.take();
  for (const e of ev) {
    T.last.push(e);
    if (e === 'ceiling') notify(sim, 'Top of the sky — Harrison levels off', 'info', 3);
    else if (e === 'boom') boom(sim);
  }
  if (T.last.length > 24) T.last.splice(0, T.last.length - 24);
}

/* ------------------------------------------------------------------ */
/* Getting out on the ground                                           */
/* ------------------------------------------------------------------ */

function ensureRing(sim) {
  if (T.ring || !sim.scene) return T.ring;
  const g = new THREE.RingGeometry(1.25, 1.55, 48);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.MeshBasicMaterial({ color: 0x2fb36b, transparent: true, opacity: 0.55, depthWrite: false });
  T.ring = new THREE.Mesh(g, m);
  T.ring.name = 'tpose:spot';
  T.ring.renderOrder = 3;
  T.ring.visible = false;
  sim.scene.add(T.ring);
  return T.ring;
}

function updateWalking(sim, dt) {
  const walking = !!onFoot.active;
  if (walking !== T.wasWalking) {
    T.wasWalking = walking;
    T.walkFrom = walking ? onFoot.snapshot().from : null;
  }
  // Out of HIM on the ground (not out of his parachute: eject.js has that).
  const out = walking && T.walkFrom === 'aircraft' && isHarrison(sim) && eject.phase === 'idle';
  const model = sim.model;
  if (out !== T.hidden && model && model.userData && typeof model.userData.setRider === 'function') {
    model.userData.setRider(!out);
    T.hidden = out;
  }
  const ring = out ? ensureRing(sim) : T.ring;
  if (ring) {
    ring.visible = out;
    if (out) {
      const ac = sim.aircraft;
      ring.position.set(ac.pos.x, ac.pos.y - 0.56, ac.pos.z);
      ring.material.opacity = 0.35 + 0.25 * Math.sin(T.now * 3);
    }
  }
  void dt;
}

/* ------------------------------------------------------------------ */
/* The camera while he spins                                           */
/* ------------------------------------------------------------------ */

const _goal = new THREE.Vector3();
const _spinPose = new THREE.Vector3();
const _nose = new THREE.Vector3();
const _zero = new THREE.Vector3();

function spinCamera(sim, dt, cam) {
  const mv = T.moves;
  const rig = sim.rig;
  const ac = sim.aircraft;
  const chaseView = !!(rig && rig.mode === 'chase');
  const want = flyingHim(sim) && chaseView && (mv.mode === 'spin' || mv.mode === 'level');
  if (!chaseView || !flyingHim(sim)) {
    T.cam.on = false;
    return false;
  }
  if (!want && !T.cam.on) return false;
  const pos = ac.pos;
  // How far into the spin pose: by his body's pitch (up = 1, level = 0).
  const nose = _nose.set(0, 0, -1).applyQuaternion(ac.quat);
  const k = want ? Math.max(0, Math.min(1, nose.y / 0.85)) : 0;
  if (!T.cam.on) {
    T.cam.on = true;
    T.cam.off.copy(cam.position).sub(pos);
    T.cam.vel.set(0, 0, 0);
    T.cam.look.copy(rig.lookAt || pos).sub(pos);
  }
  // The game's own follow pose (behind along the nose, a little up)...
  const h = mv.heading;
  const goal = _goal.copy(nose).multiplyScalar(-(rig.chaseBack || CHASE.back)).addScaledVector(UPV, rig.chaseUp || CHASE.up);
  // ...and the spin pose: behind him (by his heading) and below, looking up at him.
  const spin = _spinPose.copy(h).multiplyScalar(-SPIN_CAM.back).addScaledVector(UPV, -SPIN_CAM.below);
  goal.lerp(spin, k);
  // A critically damped spring on the OFFSET from him: at 500 kt as at 5.
  const kk = 9;
  const acc = _v.copy(goal).sub(T.cam.off).multiplyScalar(kk * kk).addScaledVector(T.cam.vel, -2 * kk);
  T.cam.vel.addScaledVector(acc, Math.min(dt, 0.05));
  T.cam.off.addScaledVector(T.cam.vel, Math.min(dt, 0.05));
  T.cam.look.lerp(_zero, Math.min(1, dt * 6));
  cam.position.copy(pos).add(T.cam.off);
  cam.up.set(0, 1, 0);
  cam.lookAt(_w.copy(pos).add(T.cam.look));
  cam.fov += (66 - cam.fov) * Math.min(1, dt * 3);
  cam.near = 0.4;
  cam.updateProjectionMatrix();
  if (!want && T.cam.off.distanceTo(goal) < 0.4) {
    // Hand the follow view back exactly where ours is, moving as he moves.
    if (rig.chasePos) rig.chasePos.copy(cam.position);
    if (rig.chaseVel) rig.chaseVel.copy(ac.vel);
    if (rig.lookAt) rig.lookAt.copy(pos);
    rig.initialised = true;
    T.cam.on = false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* The card                                                            */
/* ------------------------------------------------------------------ */

/**
 * His portrait for the hangar card, the same size and class as the plan
 * views: Harrison flying at you head-first — arms straight out (the wing),
 * his body and legs going away behind him, his shadow on the ground below
 * because there is nothing under him at all.
 */
export function drawHarrisonCard(doc = document) {
  const W = 300;
  const H = 190;
  const c = doc.createElement('canvas');
  c.width = W * 2;
  c.height = H * 2;
  c.className = 'fleet-art';
  c.dataset.tpose = '1';
  c.dataset.pose = 'floating';
  const g = c.getContext('2d');
  if (!g) return c;
  g.scale(2, 2);
  const cx = W / 2;
  const rr = (x, y, w, h, r, fill) => {
    g.fillStyle = fill;
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
    g.fill();
  };
  const ell = (x, y, rx, ry, fill, rot = 0) => {
    g.fillStyle = fill;
    g.beginPath();
    g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
    g.fill();
  };
  // His shadow on the ground, well below him: he floats.
  ell(cx, 170, 92, 7, 'rgba(0,0,0,0.22)');
  ell(cx, 170, 40, 5, 'rgba(0,0,0,0.18)');
  // Far away behind him: his legs, together, red trainers soles-up.
  rr(cx - 9, 28, 8, 34, 3, '#2f4f8a');
  rr(cx + 1, 28, 8, 34, 3, '#2f4f8a');
  rr(cx - 10, 22, 9, 9, 3, '#e0302b');
  rr(cx + 1, 22, 9, 9, 3, '#e0302b');
  g.fillStyle = '#f4f6f8';
  g.fillRect(cx - 9, 22, 7, 2.5);
  g.fillRect(cx + 2, 22, 7, 2.5);
  // His body, coming towards you: green T-shirt, widening to the shoulders.
  g.fillStyle = '#2fb36b';
  g.beginPath();
  g.moveTo(cx - 13, 58);
  g.lineTo(cx + 13, 58);
  g.lineTo(cx + 27, 96);
  g.lineTo(cx - 27, 96);
  g.closePath();
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(cx - 2, 60, 4, 34);
  // The arms, dead straight out: the whole point of him. Sleeves, then skin.
  rr(cx - 128, 88, 256, 11, 5.5, '#e8b894');
  rr(cx - 46, 86, 92, 15, 6, '#2fb36b');
  // Open hands, flat, fingers together.
  ell(cx - 130, 93.5, 8, 6.5, '#e8b894');
  ell(cx + 130, 93.5, 8, 6.5, '#e8b894');
  // The head, lifted, looking straight at you: spiky hair forward, shades, a grin.
  g.fillStyle = '#5a3a1e';
  g.beginPath();
  for (let k = 0; k < 7; k++) {
    const a = Math.PI + (k / 6) * Math.PI;
    const x0 = cx + Math.cos(a) * 17;
    const y0 = 100 + Math.sin(a) * 15;
    g.moveTo(x0 - 5, y0 + 4);
    g.lineTo(cx + Math.cos(a) * 27, 100 + Math.sin(a) * 25);
    g.lineTo(x0 + 5, y0 + 4);
  }
  g.fill();
  ell(cx, 104, 17, 17, '#e8b894');
  g.fillStyle = '#5a3a1e';
  g.beginPath();
  g.arc(cx, 102, 17, Math.PI * 1.05, Math.PI * 1.95);
  g.fill();
  rr(cx - 14, 101, 28, 7, 2.5, '#0b0b0b');
  g.strokeStyle = '#8a3a2a';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(cx, 111, 6, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  // The big white T, just showing on his chest under his chin.
  g.fillStyle = '#f4f6f8';
  g.fillRect(cx - 11, 122, 22, 4);
  g.fillRect(cx - 2.5, 122, 5, 9);
  g.fillStyle = '#2fb36b';
  g.beginPath();
  g.ellipse(cx, 124, 20, 9, 0, 0, Math.PI);
  g.globalCompositeOperation = 'destination-over';
  g.fill();
  g.globalCompositeOperation = 'source-over';
  // The tag.
  rr(W - 96, 10, 84, 22, 11, '#ffd23f');
  g.fillStyle = '#1a1a1a';
  g.font = '800 12px system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('+1 km/h', W - 54, 21.5);
  return c;
}

function paintCard(sim) {
  const layer = (sim.menus && sim.menus.layer) || (typeof document !== 'undefined' ? document : null);
  const host = layer && layer.querySelector ? layer.querySelector('[data-fleet-art="tpose"]') : null;
  if (!host) return false;
  host.innerHTML = '';
  host.appendChild(drawHarrisonCard());
  return true;
}

function wrapPicker(sim) {
  const m = sim.menus;
  if (!m || typeof m.repaintFleetArt !== 'function' || m._tposeArt) return;
  const inner = m.repaintFleetArt;
  m._tposeArt = true;
  m.repaintFleetArt = function repaintWithHarrison(...args) {
    const out = inner.apply(this, args);
    try {
      paintCard(sim);
    } catch (e) {
      console.warn('[tpose] could not paint his card', e);
    }
    return out;
  };
}

/* ------------------------------------------------------------------ */
/* The hint                                                            */
/* ------------------------------------------------------------------ */

function hintOnce(sim) {
  if (T.hinted) return;
  T.hinted = true;
  let seen = false;
  try {
    seen = localStorage.getItem(HINT_KEY) === '1';
    localStorage.setItem(HINT_KEY, '1');
  } catch (e) {
    seen = false;
  }
  if (seen) return;
  const spin = keyLabel(bound(sim, 'harrisonSpin')[0]);
  const p = keyLabel(bound(sim, 'harrisonBoost')[0]);
  notify(sim, isTouch(sim)
    ? 'SPIN — spin climb · BOOST — 1000 kt'
    : `<kbd>${spin}</kbd> spin climb · <kbd>${p}</kbd><kbd>${p}</kbd><kbd>${p}</kbd> boost`, 'info', 6);
}

/* ------------------------------------------------------------------ */
/* The plug-in                                                         */
/* ------------------------------------------------------------------ */

function resetMoves(sim) {
  T.moves.cancel('reset', sim && sim.aircraft);
  T.moves.take();
  T.presses.clear();
  T.cam.on = false;
  T.last.length = 0;
}

registerExtension({
  id: 'tpose',
  install(sim) {
    T.sim = sim;
    // Bindings saved before these actions existed: give them their keys.
    const b = sim.input && sim.input.bindings;
    if (b) {
      for (const k of ['harrisonSpin', 'harrisonBoost']) if (!b[k]) b[k] = [...ACTIONS[k].default];
    }
    wrapPicker(sim);
    paintCard(sim);
    UI.build((id) => {
      const s = T.sim;
      if (!s || s.state !== 'flying' || !flyingHim(s)) return;
      if (id === 'spin') toggleSpin(s);
      else if (id === 'boost') toggleBoost(s);
    });
  },
  startMode(sim) {
    T.sim = sim;
    resetMoves(sim);
    T.hidden = false;
    T.wasWalking = !!onFoot.active;
    if (T.ring) T.ring.visible = false;
    if (!isHarrison(sim) || !sim.rig) return;
    wrapStep(sim);
    // setAircraft() fits the standoff to the model on every change of type
    // and not otherwise, so this holds for as long as he is the one flying.
    sim.rig.chaseBack = CHASE.back;
    sim.rig.chaseUp = CHASE.up;
    T.hinted = false;
    hintOnce(sim);
  },
  stop(sim) {
    resetMoves(sim);
    if (T.ring) T.ring.visible = false;
    if (T.hidden && sim && sim.model && sim.model.userData && sim.model.userData.setRider) sim.model.userData.setRider(true);
    T.hidden = false;
    UI.setButtons({ show: false });
  },
  update(sim, dt) {
    T.sim = sim;
    T.now += dt;
    const mv = T.moves;
    if (!isHarrison(sim)) {
      if (mv.active) resetMoves(sim);
      UI.setButtons({ show: false });
      if (T.ring) T.ring.visible = false;
      return;
    }
    wrapStep(sim);
    // Out of him (walking, his parachute), crashed: the trick is over at once.
    if (mv.active && (!flyingHim(sim) || sim.aircraft.crashed)) mv.cancel(sim.aircraft.crashed ? 'crash' : 'out', sim.aircraft);
    // The single P that waited: it was the autopilot after all.
    const r = T.presses.tick(T.now);
    if (r === 'single' && flyingHim(sim) && T.pressCode && bound(sim, 'autopilot').includes(T.pressCode) && typeof sim.toggleAutopilot === 'function') {
      sim.toggleAutopilot();
    }
    handleEvents(sim);
    updateWalking(sim, dt);
    const touch = isTouch(sim);
    const ac = sim.aircraft;
    UI.setButtons({
      show: touch && flyingHim(sim) && !ac.crashed,
      spinOn: mv.spinning,
      boostOn: mv.boosting,
      boostReady: !ac.onGround,
    });
    UI.setGate(FootUI.gated());
  },
  camera(sim, dt, cam) {
    if (!isHarrison(sim) || !cam) {
      T.cam.on = false;
      return false;
    }
    return spinCamera(sim, dt, cam);
  },
  key(sim, code, down, e) {
    if (!flyingHim(sim)) return false;
    const rep = !!(e && e.repeat);
    if (bound(sim, 'harrisonSpin').includes(code)) {
      if (down && !rep) toggleSpin(sim);
      return true; // never the smoke trail, never the hover
    }
    if (bound(sim, 'harrisonBoost').includes(code)) {
      if (down && !rep) {
        T.pressCode = code;
        if (T.presses.press(T.now) === 'triple') toggleBoost(sim);
      }
      return true; // the autopilot hears it in update(), if it was a single press
    }
    return false;
  },
  devActions: [
    {
      label: 'Harrison: spin climb from 600 m',
      hint: 'T-Pose Harrison, airborne, spinning up',
      async run(sim) {
        if (typeof sim.startMode === 'function') await sim.startMode('free', { aircraft: 'tpose', airborne: true, taxi: false });
        toggleSpin(sim);
      },
    },
  ],
});

/** For the browser check and the console. */
export const harrison = {
  get moves() {
    return T.moves;
  },
  get events() {
    return T.last.slice();
  },
  get hidden() {
    return T.hidden;
  },
  get ring() {
    return T.ring;
  },
  get camOwned() {
    return T.cam.on;
  },
  toggleSpin: (sim) => toggleSpin(sim || T.sim),
  toggleBoost: (sim) => toggleBoost(sim || T.sim),
  boom: (sim) => boom(sim || T.sim),
  ui: UI,
  SPIN,
  BOOST,
  CEILING_M,
};

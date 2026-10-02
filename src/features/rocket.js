/**
 * Island Rockets — the fifth game.
 *
 * "add rocket sim", from the class's list. A child picks a rocket, sees it
 * standing on a launch pad on whichever island is loaded, counts down,
 * lifts off, leans it over (◀ ▶), drops the booster (SPACE), watches the sky
 * go black and the island shrink to a speck on a curving planet — and then
 * either flies to space, lands the booster back on its legs (on the pad or
 * a ship at sea), or puts a satellite in orbit. The numbers are in
 * rocket/physics.js, what the child should do at every moment is in
 * rocket/flights.js, and both are flown end to end by a robot in the node
 * test.
 *
 * HOW IT PLUGS IN, WITHOUT EDITING main.js
 * The other four games are wired into main.js; this one is a plug-in
 * feature (see ../game/extensions.js), so it goes in from outside, the way
 * game-ui.js goes into menus.js — by wrapping a few methods on the live
 * game object at install():
 *
 *   update(dt)        while a rocket session is open, the frame is ours:
 *                     the aeroplane is not simulated, drawn or heard, and
 *                     the world is updated around the rocket instead. With
 *                     no session this is exactly the old update().
 *   switchGame(id)    'rocket' goes to the rocket's front page; anything
 *                     else goes where it always went.
 *   startAnyMission   the four rocket missions start a rocket.
 *   restart, pause,   Restart restarts the rocket; the pause card shows
 *   resume            rocket numbers and hides the aeroplane-only parts;
 *                     Resume does not bring the aeroplane's HUD back.
 *
 * Quitting to the menu from anywhere goes through quitToMenu(), which
 * calls every feature's stop() — and stop() here puts everything back:
 * the world's visibility, the camera's lens, the aeroplane, the HUD.
 *
 * ONE FEATURE MUST NOT TAKE THE GAME DOWN
 * The frame is fenced: if anything in it throws, the session is closed,
 * the game goes back to the menu with a message, and the Rocket button
 * says it is unavailable. Everything else carries on.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { registerActions, isKey, heldKey } from '../flight/input.js';

/*
 * The rocket's keys, in the one registry: Settings → Controls → Rocket.
 * SPACE is both "do the next thing" (launch, drop the booster, let the
 * satellite go) and, held, the engine — a share by design.
 */
registerActions({
  rocketAction: { label: 'Launch · drop the booster · let the satellite go', group: 'Rocket', ctx: ['rocket'], default: ['Space', 'Enter', 'NumpadEnter'] },
  rocketBurn: { label: 'Fire the engine (hold)', group: 'Rocket', ctx: ['rocket'], default: ['Space', 'ArrowUp', 'KeyW'] },
  rocketLeanLeft: { label: 'Lean left', group: 'Rocket', ctx: ['rocket'], default: ['ArrowLeft', 'KeyA'] },
  rocketLeanRight: { label: 'Lean right', group: 'Rocket', ctx: ['rocket'], default: ['ArrowRight', 'KeyD'] },
  rocketView: { label: 'Change the camera', group: 'Rocket', ctx: ['rocket'], default: ['KeyC', 'KeyV'] },
  rocketWarp: { label: 'Faster time', group: 'Rocket', ctx: ['rocket'], default: ['KeyF', 'Period'] },
});

/** Keys that are not anybody's action and always go through: the browser's own. */
const PASS = new Set(['Escape']);
import { heightAt, MAP, OBSTACLES, isOnAnyRunway, isPaved, harbourBerth } from '../world/terrain.js';
import { PADS } from '../world/pads.js';
import { DELIVERY_PAD } from '../world/scenery.js';
import * as Prog from '../game/progression.js';
import { recordMission } from '../core/storage.js';
import { ROCKETS, PLANET, orbitOf, circularSpeed, pressureRatio, DEG } from './rocket/physics.js';
import { Flight, GOALS, findRocketMission, ROCKET_MISSIONS, robotInput, km, COUNTDOWN } from './rocket/flights.js';
import { findLaunchSite, surfaceFor, planSpaceport, padToWorld, PAD_TOP, PAD_HALF } from './rocket/site.js';
import { Kit, buildRocket, setLegs, setFins, buildPlume, updatePlume, Smoke } from './rocket/models.js';
import { buildSpaceport, animateSpaceport, clearFootprints } from './rocket/spaceport.js';
import { SpaceView, IslandPainter, blendFor } from './rocket/space.js';
import { RocketCamera, VIEW_NAMES } from './rocket/camera.js';
import { RocketHud } from './rocket/hud.js';
import { RocketAudio } from './rocket/audio.js';
import { installRocketMenu } from './rocket/menu.js';

const STEP = 1 / 60;
const WARPS = [1, 2, 4, 8];
const UP = new THREE.Vector3(0, 1, 0);

const R = {
  sim: null,
  session: null,
  keys: Object.create(null),
  touchLean: { l: false, r: false },
  touchBurn: false,
  pendingAction: false,
  warpWant: 1,
  broken: false,
  helper: readHelper(),
  lastSite: null,
};

function readHelper() {
  try {
    return localStorage.getItem('ifs.rocket.helper') !== '0';
  } catch (e) {
    return true;
  }
}
function saveHelper(on) {
  R.helper = !!on;
  try {
    localStorage.setItem('ifs.rocket.helper', on ? '1' : '0');
  } catch (e) {
    /* private window: remembered for this visit only */
  }
}

/* ------------------------------------------------------------------ */
/* Keys                                                                */
/* ------------------------------------------------------------------ */

/*
 * Our own listener, in the capture phase, registered when this module is
 * imported — before the plug-in layer's, before the game's input. While a
 * rocket is flying every key is ours except Escape (and whatever the player
 * bound Pause to), the function keys and anything with Cmd/Ctrl held, so
 * no feature that hooked the keyboard for the aeroplane can act on a
 * parked aeroplane nobody can see. Key-ups always go through.
 */
function passKey(sim, ev) {
  const code = ev.code;
  if (PASS.has(code) || /^F\d+$/.test(code) || ev.metaKey || ev.ctrlKey || ev.altKey) return true;
  // Pause, wherever the player has put it — unless it is also one of the rocket's own keys.
  return isKey(sim, 'pause', code) && !['rocketAction', 'rocketBurn'].some((a) => isKey(sim, a, code));
}

function onKey(down) {
  return (ev) => {
    const sim = R.sim;
    const S = R.session;
    if (!S || !sim) return;
    if (!down) {
      R.keys[ev.code] = false;
      return;
    }
    if (sim.state !== 'flying') return;
    const t = ev.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (passKey(sim, ev)) return;
    const code = ev.code;
    R.keys[code] = true;
    if (!ev.repeat) {
      if (isKey(sim, 'rocketAction', code)) R.pendingAction = true;
      else if (isKey(sim, 'rocketView', code)) cycleView();
      else if (isKey(sim, 'rocketWarp', code)) cycleWarp();
      else if (isKey(sim, 'mute', code)) sim.hudAction && sim.hudAction('mute');
    }
    ev.preventDefault();
    ev.stopImmediatePropagation();
  };
}

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', onKey(true), true);
  window.addEventListener('keyup', onKey(false), true);
  window.addEventListener('blur', () => {
    R.keys = Object.create(null);
    R.touchBurn = false;
    R.touchLean.l = R.touchLean.r = false;
  });
}

function cycleView() {
  const S = R.session;
  if (!S) return;
  const v = S.cam.cycle(S.flight.focus.alt < 3500 && !S.spaceMode);
  S.hud.setView(VIEW_NAMES[v]);
}

function cycleWarp() {
  const i = WARPS.indexOf(R.warpWant);
  R.warpWant = WARPS[(i + 1) % WARPS.length];
}

/* ------------------------------------------------------------------ */
/* The launch site                                                     */
/* ------------------------------------------------------------------ */

function blockedFor(sim) {
  return (x, z, r) => {
    if (isOnAnyRunway(x, z, r + 160)) return true;
    for (const [dx, dz] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      if (isPaved(x + dx, z + dz)) return true;
    }
    for (let i = 0; i < OBSTACLES.length; i++) {
      const o = OBSTACLES[i];
      if (x + r > o.x0 && x - r < o.x1 && z + r > o.z0 && z - r < o.z1) return true;
    }
    try {
      if (sim.onRoad && sim.onRoad(x, z, r + 6)) return true;
    } catch (e) {
      /* no roads on this map */
    }
    for (const p of PADS) if (Math.hypot(p.x - x, p.z - z) < r + 140) return true;
    if (DELIVERY_PAD && Math.hypot(DELIVERY_PAD.x - x, DELIVERY_PAD.z - z) < r + 950) return true;
    const hb = harbourBerth();
    if (hb && Math.hypot(hb.x - x, hb.z - z) < r + 450) return true;
    return false;
  };
}

function siteFor(sim) {
  const blocked = blockedFor(sim);
  const site = findLaunchSite({ heightAt, islands: MAP.islands, blocked });
  site.mapId = MAP.id;
  R.lastSite = site;
  return site;
}

function siteName() {
  const where = MAP && MAP.name ? MAP.name : 'this island';
  return `Launching from ${where}.`;
}

/* ------------------------------------------------------------------ */
/* Starting and ending a flight                                        */
/* ------------------------------------------------------------------ */

/**
 * Start a flight — fenced like the frame is. It runs from menu buttons, and
 * a start that threw half-way would leave the game saying "rocket" with no
 * rocket in it; instead it is closed up and the game goes back to the menu.
 */
function start(sim, opts = {}) {
  try {
    return startFlight(sim, opts);
  } catch (err) {
    console.error('[rocket] could not start a flight; the rocket game is off for this visit:', err);
    R.broken = true;
    try { end(sim); } catch (e) { /* as much as can be put back is back */ }
    try {
      sim.quitToMenu('main');
      sim.hud.notify('The rocket game hit a problem and was closed — everything else still works.', 'warn', 6);
    } catch (e) {
      /* the menu will come back on its own */
    }
    return null;
  }
}

function startFlight(sim, opts) {
  if (R.broken) {
    sim.hud.notify('The rocket game is switched off for this visit — see the console.', 'warn', 5);
    return null;
  }
  const mission = opts.mission ? findRocketMission(opts.mission) : null;
  const rocket = mission ? mission.rocket : ROCKETS[opts.rocket] ? opts.rocket : 'starling';
  const def = ROCKETS[rocket];
  const goal = mission ? mission.goal : def.goals.includes(opts.goal) ? opts.goal : def.goals[0];
  const helper = opts.helper === undefined ? R.helper : !!opts.helper;
  if (opts.helper !== undefined) saveHelper(helper);
  if (R.session) end(sim, 'restart');

  // Stand the rest of the game down, the way startDrive() does.
  try {
    sim.stopDrive && sim.stopDrive();
    sim.autopilot && sim.autopilot.setEngaged(false, sim.aircraft);
    sim.hud.setAutopilot && sim.hud.setAutopilot(false);
    sim.hud.hideControls && sim.hud.hideControls();
    sim.hud.clearTransient && sim.hud.clearTransient();
    sim.taxi && sim.taxi.stop();
    sim.wreck && sim.wreck.clear();
    sim.tornado && sim.tornado.clear();
    sim.atc && sim.atc.reset();
    sim.removeCrate && sim.removeCrate();
    sim.clearPursuer && sim.clearPursuer();
  } catch (e) {
    console.warn('[rocket] standing the aeroplane down', e);
  }
  sim.hasCargo = false;
  sim.armed = {};
  sim.armedEvents = {};
  sim.activeEvents = {};
  sim.randomDisasters = false;
  if (sim.runner) {
    sim.runner.clearGates && sim.runner.clearGates();
    sim.runner.status = 'idle';
  }
  sim.menus.hide();
  sim.hud.setVisible(false);
  sim.mode = 'rocket';
  sim.modeOpts = { rocket, goal, mission: mission ? mission.id : null, helper, robot: !!opts.robot };
  sim.game = 'rocket';
  if (sim.menus.currentGame !== 'rocket') sim.menus.setGame('rocket');
  sim.state = 'flying';
  sim.wakeAudio && sim.wakeAudio();
  if (sim.unlockAudio) sim.unlockAudio().catch(() => {});
  try {
    if (sim.audio && sim.audio.available && sim.audio.music) sim.audio.music.stop({ fade: 1.5 });
  } catch (e) {
    /* no music to stop */
  }

  const site = siteFor(sim);
  const surface = surfaceFor(site, heightAt);
  const flight = new Flight({
    rocket,
    goal,
    helper,
    mission: mission ? mission.id : null,
    site: { padY: site.pad.y + PAD_TOP, surface, lzS: site.lzS, bargeS: site.bargeS },
  });
  // "Try the landing again": the same flight, put back to the moment the
  // child took the booster over — not the whole climb again.
  const handover = opts.handover && opts.handover.mapId === site.mapId ? opts.handover : null;
  if (handover) flight.resumeFrom(handover.snap);

  const kit = new Kit();
  const root = new THREE.Group();
  root.name = 'rocket:root';
  const built = buildRocket(kit, def);
  const tallest = def.stages.reduce((a, s) => a + s.height, 0) + (built.heights.payload || 0);
  // The spaceport round the pad, laid out for this island.
  const plan = planSpaceport(site, heightAt, blockedFor(sim));
  const r0 = def.stages[0].radius;
  const payH = built.heights.payload || 0;
  const arms = [{ y: tallest - payH * 0.5 - 1.0, room: !!(def.payload && def.payload.kind === 'capsule'), r: def.fairing ? r0 * 1.18 : r0 }];
  if (def.stages.length > 1) arms.push({ y: def.stages[0].height + def.stages[1].height * 0.5 }, { y: def.stages[0].height * 0.62 });
  else arms.push({ y: def.stages[0].height * 0.55 });
  const quality = sim.settings && sim.settings.quality;
  const ground = buildSpaceport(kit, site, plan, heightAt, { tallest, mount: built.mount, arms, islandName: MAP.name, accent: def.colour, quality });
  root.add(ground);
  const vehicles = new THREE.Group();
  vehicles.name = 'rocket:vehicles';
  root.add(vehicles);
  const painter = new IslandPainter(kit, { heightAt, islands: MAP.islands, palette: MAP.palette, size: 640 });
  const deep = MAP.palette && MAP.palette.deepWater;
  const space = new SpaceView(kit, { pad: site.pad, painter, oceanColor: deep || 0x1b4f7c });
  root.add(space.group);
  const smoke = new Smoke(kit, quality === 'low' ? 320 : 700);
  root.add(smoke.points);
  sim.scene.add(root);
  // The island's trees, out of the spaceport's way until the flight ends.
  let unclear = () => {};
  try {
    unclear = clearFootprints(sim.scenery && sim.scenery.group, site, plan.zones);
  } catch (e) {
    console.warn('[rocket] could not clear the trees off the spaceport', e);
  }

  const cam = new RocketCamera(sim.camera);
  const touch = document.documentElement.classList.contains('is-touch-device');
  const hud = new RocketHud({
    touch,
    onPause: () => sim.state === 'flying' && sim.pause(),
    onView: () => cycleView(),
    onWarp: () => cycleWarp(),
    onAction: () => { R.pendingAction = true; },
    onLean: (v, on) => { if (v < 0) R.touchLean.l = on; else R.touchLean.r = on; },
    onBurn: (on) => { R.touchBurn = on; },
  });
  hud.setLarge(sim.settings && sim.settings.largeText);
  hud.layoutLadder(goal === 'orbit' || goal === 'space' ? 130000 : 80000);
  hud.setView(VIEW_NAMES[cam.view]);
  hud.setVisible(true);

  // Restart and "Fly it again" go back to the pad, so the handover is not kept.
  const plain = { ...opts };
  delete plain.handover;
  const S = {
    opts: { ...plain, rocket, goal, helper },
    mission,
    def,
    flight,
    site,
    plan,
    unclear,
    yaw: -Math.atan2(site.az.z, site.az.x),
    kit,
    root,
    ground,
    vehicles,
    built,
    painter,
    space,
    smoke,
    cam,
    hud,
    audio: new RocketAudio(sim),
    views: new Map(),
    keep: new Set([root]),
    spaceMode: false,
    acc: 0,
    t: 0,
    resultAt: null,
    resultShown: false,
    countShown: null,
    legsK: 0,
    finsK: 0,
    robot: !!opts.robot,
    saved: {
      modelVisible: sim.model ? sim.model.visible : true,
      cockpitVisible: sim.cockpit ? sim.cockpit.visible : false,
    },
    az: new THREE.Vector3(site.az.x, 0, site.az.z),
    axis: new THREE.Vector3(site.az.z, 0, -site.az.x),
    side: new THREE.Vector3(-site.az.z, 0, site.az.x),
    padWorld: new THREE.Vector3(site.pad.x, site.pad.y + PAD_TOP, site.pad.z),
    worldOk: new Set(),
  };
  R.session = S;
  R.keys = Object.create(null);
  R.pendingAction = false;
  R.touchBurn = false;
  R.touchLean.l = R.touchLean.r = false;
  R.warpWant = 1;
  if (sim.model) sim.model.visible = false;
  if (sim.cockpit) sim.cockpit.visible = false;
  sim.clock && sim.clock.getDelta();
  // One frame straight away, so the rocket is on its pad before anything draws.
  frame(sim, 0);
  return S;
}

function end(sim) {
  const S = R.session;
  if (!S) return;
  R.session = null;
  try { S.audio.stop(); } catch (e) { /* already quiet */ }
  try { S.space.setWorldHidden(sim, S.keep, false); } catch (e) { console.warn('[rocket] putting the world back', e); }
  if (S.root.parent) S.root.parent.remove(S.root);
  try { S.unclear(); } catch (e) { console.warn('[rocket] putting the trees back', e); }
  S.kit.dispose();
  S.cam.restore();
  S.hud.destroy();
  if (sim.model) sim.model.visible = S.saved.modelVisible;
  if (sim.cockpit) sim.cockpit.visible = S.saved.cockpitVisible;
  const pause = sim.menus && sim.menus.screens && sim.menus.screens.pause;
  if (pause) pause.classList.remove('is-rocket');
  R.keys = Object.create(null);
  R.touchBurn = false;
  R.touchLean.l = R.touchLean.r = false;
  R.pendingAction = false;
}

function restartRocket(sim) {
  const S = R.session;
  const opts = S ? S.opts : sim.modeOpts || {};
  sim.menus.hide();
  return start(sim, opts);
}

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

const TMP = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), cam: new THREE.Vector3(), s: new THREE.Vector3(), q: new THREE.Quaternion() };

/** Where a body is drawn: flat world low down, round planet high up. */
function worldPos(S, b, k, out) {
  const phi = Math.atan2(b.pos.x, b.pos.y);
  const s = PLANET.R * phi;
  const h = b.r - PLANET.R;
  const pad = S.site.pad;
  const az = S.site.az;
  const fx = pad.x + az.x * s;
  const fz = pad.z + az.z * s;
  const cx = pad.x + az.x * b.pos.x;
  const cy = -PLANET.R + b.pos.y;
  const cz = pad.z + az.z * b.pos.x;
  out.set(fx + (cx - fx) * k, h + (cy - h) * k, fz + (cz - fz) * k);
  return phi;
}

function stackHeight(S, b) {
  let h = 0;
  for (const s of b.stages) h += S.built.heights[s.id] || 0;
  if (b.payload && b.role !== 'fairing') h += S.built.heights.payload || 0;
  return Math.max(h, 3);
}

function viewFor(S, b) {
  let v = S.views.get(b);
  const key = `${b.role}:${b.stages.map((s) => s.id).join(',')}:${b.payload ? 'p' : ''}:${b.fairing ? 'f' : ''}`;
  if (!v) {
    v = { group: new THREE.Group(), key: '', plume: null, born: S.t, exitR: 1 };
    v.group.name = `rocket:body:${b.role}`;
    S.vehicles.add(v.group);
    S.views.set(b, v);
  }
  if (v.key !== key) {
    v.key = key;
    const P = S.built.parts;
    let y = 0;
    if (b.role === 'fairing') {
      // Half 0 is the downrange half, and flies off forwards (side +1).
      const half = S.built.fairing && S.built.fairing[b.side > 0 ? 0 : 1];
      if (half) {
        half.position.set(0, S.built.heights.upper || 0, 0);
        half.rotation.y = S.yaw;
        v.group.add(half);
      }
    } else {
      for (const s of b.stages) {
        const part = P[s.id];
        if (!part) continue;
        part.position.set(0, y, 0);
        // Built facing +X; turned so its front faces the launch direction
        // and its name faces the camera's side.
        part.rotation.y = S.yaw;
        v.group.add(part);
        y += S.built.heights[s.id] || 0;
      }
      if (b.payload && P.payload) {
        P.payload.position.set(0, y, 0);
        P.payload.rotation.y = S.yaw;
        v.group.add(P.payload);
        if (b.fairing && S.built.fairing) {
          for (const half of S.built.fairing) {
            half.position.set(0, y, 0);
            half.rotation.y = S.yaw;
            if (half.userData.hinge) half.userData.hinge.rotation.z = 0;
            v.group.add(half);
          }
        }
      }
      if (b.stages.length && !v.plume) {
        // The flame comes out of the engines: the whole cluster under a
        // booster, the big vacuum bell under an upper stage.
        const ex = (S.built.exits && S.built.exits[b.stages[0].id]) || { y: 0, r: b.stages[0].radius };
        v.plume = buildPlume(S.kit, ex.r, ex.y);
        v.exitR = ex.r;
        v.group.add(v.plume);
      }
    }
  }
  return v;
}

function frame(sim, dt) {
  const S = R.session;
  const flight = S.flight;
  const input = sim.input;
  input.update(dt, { simple: true });
  if (input.pressed('pause')) {
    if (sim.state === 'flying') sim.pause();
    else if (sim.state === 'paused') sim.resume();
  }
  const flying = sim.state === 'flying';
  const watching = sim.state === 'debrief';
  S.hud.setVisible(flying);

  // Time.
  let warp = 1;
  if (flying) {
    warp = Math.min(R.warpWant, flight.warpCap());
    S.acc += dt * warp;
  } else if (watching) {
    S.acc += dt;
  }
  let n = Math.floor(S.acc / STEP);
  if (n > 40) n = 40;
  S.acc = Math.max(0, S.acc - n * STEP);
  if (S.acc > STEP * 4) S.acc = 0;
  for (let i = 0; i < n; i++) {
    if (flying) {
      if (S.robot) {
        robotInput(flight);
      } else {
        const lean = (heldKey(sim, 'rocketLeanRight', R.keys) || R.touchLean.r ? 1 : 0) - (heldKey(sim, 'rocketLeanLeft', R.keys) || R.touchLean.l ? 1 : 0);
        flight.input.lean = lean;
        flight.input.burn = !!(heldKey(sim, 'rocketBurn', R.keys) || R.touchBurn);
        if (R.pendingAction) {
          flight.input.action = true;
          R.pendingAction = false;
        }
      }
    } else {
      flight.input.lean = 0;
      flight.input.burn = false;
      flight.input.action = false;
    }
    flight.step(STEP);
    for (const e of flight.drain()) onEvent(sim, S, e);
  }
  if (!flying) R.pendingAction = false;
  S.t += dt;

  // Where everything is drawn.
  const focus = flight.focus;
  const k = blendFor(focus.alt);
  const wantSpace = S.space.wantSpace(Math.max(0, focus.alt));
  if (wantSpace !== S.spaceMode) {
    S.spaceMode = wantSpace;
    S.space.setWorldHidden(sim, S.keep, wantSpace);
    S.ground.visible = !wantSpace;
    S.smoke.points.visible = !wantSpace;
  }
  if (!S.painter.done) S.painter.step(focus.alt > 4000 ? 48 : 16);

  // Bodies.
  const live = new Set();
  let focusPhi = 0;
  for (const b of flight.bodies) {
    if (b.gone || (b.crashed && S.t - (b.crashedAt || S.t) > 0.25)) continue;
    const v = viewFor(S, b);
    live.add(v);
    const phi = worldPos(S, b, k, v.group.position);
    if (b === focus) focusPhi = phi;
    v.group.quaternion.setFromAxisAngle(S.axis, b.tilt + phi * k);
    v.group.visible = true;
    if (v.plume) {
      const power = b.engineOn && b.throttle > 0 ? b.throttle : 0;
      updatePlume(v.plume, S.t, power, 1 - pressureRatio(b.alt), v.exitR);
    }
    if (b.role === 'fairing') {
      // Clamshell: each half swings open on its hinge, then tumbles away.
      const half = v.group.children[0];
      const hinge = half && half.userData.hinge;
      if (hinge) hinge.rotation.z = -half.userData.side * Math.min(1.5, (S.t - v.born) * 1.2);
    }
  }
  for (const v of S.views.values()) {
    if (!live.has(v)) v.group.visible = false;
  }
  // Legs and fins on whichever body holds the booster.
  const booster = flight.booster || (flight.stack && flight.stack.stages[0] && flight.stack.stages[0].landable ? flight.stack : null);
  if (S.built.legs.length && booster) {
    const want = booster.legs ? 1 : 0;
    S.legsK += (want - S.legsK) * Math.min(1, dt * 2.5);
    setLegs(S.built.legs, S.legsK);
    const finWant = flight.booster && flight.focus === flight.booster ? 1 : 0;
    S.finsK += (finWant - S.finsK) * Math.min(1, dt * 3);
    setFins(S.built.fins, S.finsK);
  }
  // The tower's arms swing away during the countdown; the ship rides the swell.
  if (!S.spaceMode) animateSpaceport(S.ground, S.t, armProgress(flight));
  if (flight.satellite && S.built.sat) {
    const since = S.t - (S.releasedAt || S.t);
    const u = Math.min(1, Math.max(0.08, since / 3));
    for (const p of S.built.sat.userData.panels) p.scale.x = u;
  }

  // The world round the rocket.
  const fpos = TMP.a;
  worldPos(S, focus, k, fpos);
  const flatPos = TMP.b;
  worldPos(S, focus, 0, flatPos);
  updateWorld(sim, S, dt, fpos, flatPos, focus);

  // Smoke, low down, and the pad's steam and water.
  if (!S.spaceMode) {
    emitSmoke(sim, S, dt);
    emitPad(sim, S, dt);
  }
  S.smoke.update(dt, window.innerHeight || 720);

  // The camera, looking from the side the rocket flies to the right of —
  // at the satellite once it has been let go.
  const camBody = flight.satellite && S.releasedAt !== undefined ? flight.satellite : focus;
  let camPos = fpos;
  if (camBody !== focus) {
    worldPos(S, camBody, k, TMP.cam);
    camPos = TMP.cam;
  }
  const camPhi = Math.atan2(camBody.pos.x, camBody.pos.y);
  const up = TMP.c.copy(UP).applyAxisAngle(S.axis, camPhi * k);
  const along = new THREE.Vector3().copy(S.az).applyAxisAngle(S.axis, camPhi * k);
  const nose = new THREE.Vector3().copy(UP).applyAxisAngle(S.axis, camBody.tilt + camPhi * k);
  const viewUsed = S.cam.update(dt, {
    bottom: camPos,
    nose,
    up,
    along,
    side: S.side,
    height: camBody === focus ? stackHeight(S, focus) : 6,
    close: camBody !== focus,
    landing: landingView(S, flight, focus),
    radius: focus.radius,
    speed: camBody.speed,
    alt: Math.max(0, camBody.alt),
    flat: !S.spaceMode,
    pad: S.padWorld,
    ...padFraming(S, flight, camBody),
  });
  S.hud.setView(VIEW_NAMES[viewUsed]);

  // Sky, after the sky has had its say.
  darkenSky(sim, S, Math.max(0, focus.alt));
  S.space.place(S.spaceMode, Math.max(0, focus.alt), sim.sky && sim.sky._sunDir ? sim.sky._sunDir : new THREE.Vector3(0.4, 0.8, 0.3));

  // Sound.
  const air = Math.min(1, pressureRatio(focus.alt) * 3.2);
  const power = focus.engineOn ? focus.throttle || 0 : 0;
  const near = S.cam.view === 'ground' && focus.alt < 4000 ? 0.55 : 1;
  S.audio.update(dt, flying ? power : 0, air, near);
  S.audio.hushAeroplane(dt);

  // Instruments.
  if (flying) S.hud.update(dt, hudState(sim, S, warp));

  // The result, a moment after it happens.
  if (flight.result && !S.resultShown && S.resultAt !== null && S.t >= S.resultAt) {
    S.resultShown = true;
    showResult(sim, S);
  }
  input.endFrame();
}

/** For the camera while the child lands: where the target is, and how high above it. */
function landingView(S, flight, b) {
  if (S.spaceMode || (flight.phase !== 'landing' && !(flight.phase === 'return' && flight.flags.boostDone))) return null;
  const tgt = flight.target();
  if (!tgt) return null;
  const y = flight.site.surface(tgt.s).y;
  if (!S.lzTarget) S.lzTarget = new THREE.Vector3();
  S.lzTarget.set(S.site.pad.x + S.site.az.x * tgt.s, y, S.site.pad.z + S.site.az.z * tgt.s);
  return { target: S.lzTarget, above: b.alt - flight.site.surface(b.downrange).y };
}

function updateWorld(sim, S, dt, fpos, flatPos, focus) {
  const w = sim.weather;
  const safe = (id, fn) => {
    if (S.worldOk.has(id)) return;
    try {
      fn();
    } catch (e) {
      S.worldOk.add(id);
      console.warn(`[rocket] ${id} would not update round the rocket; leaving it`, e);
    }
  };
  safe('weather', () => w.update(dt));
  safe('sky', () => {
    sim.sky.update(w);
    sim.sky.followTarget(fpos);
  });
  if (!S.spaceMode) {
    safe('ocean', () => {
      sim.ocean.follow(flatPos);
      sim.ocean.update(dt, w);
    });
    safe('clouds', () => sim.clouds && sim.clouds.update(dt, w, flatPos));
    if (focus.alt < 6000) {
      safe('scenery', () => sim.scenery && sim.scenery.update(dt, w));
      safe('features', () => sim.features && sim.features.update(dt, w));
      safe('airport', () => sim.airport && sim.airport.update(dt, w));
      safe('apron', () => sim.apron && sim.apron.update(dt, w));
      safe('seamarks', () => sim.seamarks && sim.seamarks.update(dt, w));
    }
  }
}

const BLACK_TOP = new THREE.Color(0x01020a);
const BLACK_HORIZON = new THREE.Color(0x060b1c);

/** The sky goes dark blue, then black, and the stars come out. */
function darkenSky(sim, S, alt) {
  const sky = sim.sky;
  if (!sky || !sky.uniforms) return;
  const t = Math.max(0, Math.min(1, (alt - 8000) / 55000));
  const k = t * t * (3 - 2 * t);
  sky.uniforms.uTop.value.lerp(BLACK_TOP, k);
  sky.uniforms.uHorizon.value.lerp(BLACK_HORIZON, Math.min(1, k * 1.25));
  sky.uniforms.uStars.value = Math.max(sky.uniforms.uStars.value, Math.max(0, (k - 0.35) / 0.65));
  sky.mesh.position.copy(sim.camera.position);
  if (sim.scene.fog) {
    const f = S.spaceMode ? 0 : 1 - Math.max(0, Math.min(1, (alt - 1500) / 12000));
    sim.scene.fog.density *= f;
    sim.scene.fog.color.lerp(BLACK_HORIZON, k);
  }
}

function emitSmoke(sim, S, dt) {
  const flight = S.flight;
  const sm = S.smoke;
  const rate = sim.settings && sim.settings.quality === 'low' ? 0.5 : 1;
  for (const b of flight.bodies) {
    if (b.gone || b.crashed) continue;
    const power = b.engineOn && b.throttle > 0 ? b.throttle : 0;
    if (power <= 0 && !(flight.phase === 'countdown' && b === flight.stack && flight.flags.ignition)) continue;
    const p = TMP.s;
    worldPos(S, b, 0, p);
    const deck = flight.site.surface(b.downrange).y;
    const above = b.alt - deck;
    if (b.alt > 14000) continue;
    const pw = power || 0.6;
    const onPad = b === flight.stack && Math.abs(b.downrange) < PAD_HALF;
    if (above < 70) {
      // On (or near) the ground: the exhaust hits the concrete and rolls out
      // sideways. A billow at lift-off (the pad's own steam is emitPad's);
      // a light dusting for a landing, which must not hide the booster the
      // child is trying to set down.
      const landing = b.role === 'booster';
      const per = landing ? 10 + 12 * pw : onPad ? (above > 4 ? 18 + 26 * pw : 0) : 50 + 60 * pw;
      const count = Math.round(per * dt * rate + Math.random() * (landing ? 0.4 : per ? 1 : 0));
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const sp = 18 + Math.random() * 26;
        sm.emit(p.x, deck + 1.5, p.z, Math.cos(a) * sp, 2 + Math.random() * 5, Math.sin(a) * sp, 8 + Math.random() * 6, 6 + Math.random() * 4, 10, landing ? 1 : 0.9);
      }
    }
    // A trail behind it on the way up. Not under a booster coming down to
    // land: it would sink through its own trail into a fog of its making.
    if (above > 5 && !(b.role === 'booster' && above < 400)) {
      const count = Math.round(26 * pw * dt * rate + Math.random() * 0.6);
      for (let i = 0; i < count; i++) {
        const j = () => (Math.random() - 0.5) * 3;
        const len = b.stages[0] ? b.stages[0].radius * 6 : 5;
        sm.emit(p.x + j(), p.y - len, p.z + j(), j() * 2, -6 + j(), j() * 2, 4 + Math.random() * 3, 4 + Math.random() * 3, 5 + b.alt / 1500);
      }
    }
  }
}

/**
 * The launch pad at ignition: steam roaring out of the flame trench and
 * billowing up out of the hole round the rocket, and the deluge — water
 * sprayed over the deck from the rainbirds — from just before the engines
 * light until the rocket is well clear.
 */
function emitPad(sim, S, dt) {
  const flight = S.flight;
  const st = flight.stack;
  if (!st || st.gone || !flight.bodies.includes(st)) return;
  const ud = S.ground.userData;
  if (!ud.trench) return;
  const sm = S.smoke;
  const site = S.site;
  const rate = sim.settings && sim.settings.quality === 'low' ? 0.5 : 1;
  const above = st.alt - (site.pad.y + PAD_TOP);
  const phase = flight.phase;
  // How hard the exhaust is hitting the pad.
  const hit = st.engineOn ? (st.throttle || 0) * Math.max(0, 1 - above / 140) : 0;
  const deluge = (phase === 'countdown' && flight.countdown < 3.2) || (phase !== 'pad' && phase !== 'countdown' && above < 400 && flight.met < 10);
  const az = site.az;
  const wv = (vu, vv) => [az.x * vu - az.z * vv, az.z * vu + az.x * vv];
  const R = Math.random;
  if (hit > 0.01) {
    // Out of the trench's mouth, towards the sea.
    let n = Math.round(42 * hit * rate * dt + R() * 0.8);
    for (let i = 0; i < n; i++) {
      const w = padToWorld(site, ud.trench.u + R() * 6, (R() - 0.5) * 2 * ud.trench.w);
      const [vx, vz] = wv(20 + R() * 22, (R() - 0.5) * 16);
      sm.emit(w.x, site.pad.y + ud.trench.y + R() * 1.5, w.z, vx, 2 + R() * 5, vz, 9 + R() * 6, 7 + R() * 4, 9 + R() * 4, 1.05, 1.4, 0.55, 0.62);
    }
    // Up out of the hole, round the rocket's feet.
    n = Math.round(24 * hit * rate * dt + R() * 0.6);
    for (let i = 0; i < n; i++) {
      const a = R() * Math.PI * 2;
      const r = 2.5 + R() * 2;
      const w = padToWorld(site, Math.cos(a) * r, Math.sin(a) * r);
      const sp = 4 + R() * 8;
      const [vx, vz] = wv(Math.cos(a) * sp, Math.sin(a) * sp);
      sm.emit(w.x, site.pad.y + PAD_TOP + 0.5, w.z, vx, 7 + R() * 9, vz, 7 + R() * 5, 6 + R() * 3, 7 + R() * 3, 1.05, 1.2, 0.6, 0.6);
    }
  }
  if (deluge && ud.rainbirds) {
    // Water: arcs from the nozzles in towards the hole, falling as it goes.
    for (const rb of ud.rainbirds) {
      const n = Math.round(16 * rate * dt + R() * 0.5);
      for (let i = 0; i < n; i++) {
        const w = padToWorld(site, rb.u, rb.v);
        const l = Math.hypot(rb.u, rb.v) || 1;
        const sp = 7 + R() * 5;
        const [vx, vz] = wv((-rb.u / l) * sp + (R() - 0.5) * 3, (-rb.v / l) * sp + (R() - 0.5) * 3);
        sm.emit(w.x, site.pad.y + rb.y, w.z, vx, 6 + R() * 4, vz, 1.8 + R() * 1.4, 1.1 + R() * 0.5, 2.6, 1.12, -9.8, 0.3, 0.42);
      }
    }
  }
}

/** The tower's arms: [top, middle, low], 0 against the rocket … 1 swung away. */
function armProgress(flight) {
  if (flight.phase === 'pad') return [0, 0, 0];
  if (flight.phase === 'countdown') {
    const e = COUNTDOWN - flight.countdown;
    return [(e - 0.2) / 1.5, (e - 0.9) / 1.5, (e - 1.6) / 1.5];
  }
  return [1, 1, 1];
}

/**
 * What the camera needs to frame the pad: how much of the pad shot to use
 * (1 on the pad, fading as it climbs), the tower's side, and a shake while
 * the engines roar close by.
 */
function padFraming(S, flight, camBody) {
  const st = flight.stack;
  if (S.spaceMode || !st || camBody !== st || !flight.bodies.includes(st)) return { padK: 0, shake: 0 };
  const above = st.alt - (S.site.pad.y + PAD_TOP);
  const padK = Math.max(0, Math.min(1, 1 - above / 90));
  const shake = st.engineOn ? (st.throttle || 0) * 0.12 * Math.max(0, 1 - above / 350) : 0;
  const tw = S.ground.userData.tower;
  return { padK, shake, towerU: tw ? tw.u : 0 };
}

function puff(S, b, kind) {
  if (S.spaceMode) return;
  const p = TMP.s;
  worldPos(S, b, 0, p);
  const white = kind === 'splash';
  for (let i = 0; i < 36; i++) {
    const a = Math.random() * Math.PI * 2;
    const sp = 6 + Math.random() * (white ? 14 : 20);
    S.smoke.emit(p.x, p.y + Math.random() * 10, p.z, Math.cos(a) * sp, 4 + Math.random() * 10, Math.sin(a) * sp, 10 + Math.random() * 10, 4 + Math.random() * 3, 6);
  }
}

/* ------------------------------------------------------------------ */
/* What happened, said once                                            */
/* ------------------------------------------------------------------ */

const TOASTS = {
  ignition: ['Engines on!', ''],
  maxq: ['Max Q — the air is pushing hardest now', ''],
  quiet: ['So quiet! No air up here to carry the sound', ''],
  'stage-empty': ['Booster empty — drop it!', 'warn'],
  'meco-reserve': ['Booster done — it kept its landing fuel', 'warn'],
  separation: ['Stage 1 away!', 'good'],
  fairing: ['Nose cone open — the satellite can see space', ''],
  space: ['SPACE! You are above 100 km', 'good'],
  'upper-space': ['Your upper stage just reached space ✓', 'good'],
  cut: ['Engine off — coasting up to the top', ''],
  'fire-prompt': ['At the top — FIRE the engine!', 'warn'],
  relight: ['Engine on — keep it flat!', ''],
  orbit: ['ORBIT! You are falling round the planet', 'good'],
  release: ['Satellite away!', 'good'],
  boostback: ['The booster flips round to fly home', ''],
  'boostback-done': ['Booster heading home — ⏩ to speed up', ''],
  'your-turn': ['Your turn — land it!', 'warn'],
  legs: ['Legs out!', ''],
  'no-fuel': ['Out of fuel!', 'warn'],
  burnout: ['Engine done — still going up!', ''],
};

function onEvent(sim, S, e) {
  const t = e.again ? ['Back at 6 km — your turn, land it!', 'warn'] : TOASTS[e.type];
  if (t) S.hud.toast(t[0], t[1]);
  switch (e.type) {
    case 'tick':
      S.audio.beep(false);
      break;
    case 'liftoff':
      S.audio.beep(true);
      S.liftoffAt = S.t;
      break;
    case 'separation':
      S.audio.clunk();
      R.warpWant = 1;
      break;
    case 'space':
      S.cam.startMoment(7);
      R.warpWant = 1;
      break;
    case 'stage-empty':
    case 'meco-reserve':
    case 'fire-prompt':
    case 'orbit':
    case 'your-turn':
      R.warpWant = 1;
      break;
    case 'release':
      // Watch the satellite open its panels, close to, with the planet behind.
      S.releasedAt = S.t;
      S.cam.hasOffset = false;
      break;
    case 'touchdown':
      S.audio.thump();
      break;
    case 'crash':
    case 'splash': {
      S.audio.thump();
      const b = S.flight.focus;
      b.crashedAt = S.t;
      puff(S, b, e.type);
      break;
    }
    case 'success':
      S.audio.chime(true);
      S.resultAt = S.t + (S.flight.goal === 'orbit' ? 5 : 3.2);
      break;
    case 'fail':
      S.audio.chime(false);
      S.resultAt = S.t + 2.6;
      break;
    default:
  }
}

/* ------------------------------------------------------------------ */
/* Instruments                                                         */
/* ------------------------------------------------------------------ */

function hudState(sim, S, warp) {
  const flight = S.flight;
  const b = flight.focus;
  const lv = b.localVel({});
  const phase = flight.phase;
  const def = S.def;

  // The countdown numbers, big in the middle.
  if (phase === 'countdown') {
    S.hud.showCount(String(Math.max(1, Math.ceil(flight.countdown))), false);
  } else if (S.liftoffAt !== undefined && S.t - S.liftoffAt < 1.6) {
    S.hud.showCount('LIFTOFF!', true);
  } else {
    S.hud.showCount(null);
  }
  S.hud.setWarp(warp);

  // Every tank on the rocket, whoever has it now.
  const tanks = def.stages.map((st, i) => {
    let s = null;
    let holder = null;
    for (const body of flight.bodies) {
      const f = body.stages.find((x) => x.id === st.id);
      if (f) { s = f; holder = body; break; }
    }
    const name = def.stages.length === 1 ? 'Rocket' : i === 0 ? 'Booster' : 'Upper';
    if (!s) return { name, frac: 0, gone: true };
    return { name, frac: s.fuelLeft / s.fuel, gone: holder !== b, reserve: holder && holder.fuelFloor > 0 && i === 0 };
  });

  const state = {
    done: !!flight.result,
    objective: flight.objective(),
    alt: Math.max(0, b.alt),
    speed: b.speed,
    tanks,
    touch: document.documentElement.classList.contains('is-touch-device'),
  };
  if (flight.goal === 'orbit' && (phase === 'coast' || phase === 'circ' || phase === 'orbit')) {
    state.orbit = { v: Math.abs(lv.along), need: circularSpeed(b.r) };
  }
  if ((flight.goal === 'orbit' || flight.goal === 'space') && lv.up > 0 && (phase === 'ascent' || phase === 'coast')) {
    state.top = orbitOf(b).apoapsis;
  }
  if (phase === 'ascent' || phase === 'coast' || phase === 'circ' || phase === 'orbit') {
    const guide = flight.guide();
    const err = Math.abs(guide - b.tilt) / DEG;
    state.dial = {
      tilt: b.tilt,
      guide,
      burning: b.throttle > 0,
      word: err < 5 ? { text: 'On the green ✓', tone: 'ok' } : { text: guide > b.tilt ? 'Lean ▶' : 'Lean ◀', tone: 'go' },
    };
  }
  if (phase === 'landing') state.landing = flight.landingInfo();
  // What SPACE does now.
  if (phase === 'pad') state.action = { label: 'LAUNCH', tone: 'warn' };
  else if (flight.flags.stageWaiting) state.action = { label: 'DROP STAGE', tone: 'warn' };
  else if (phase === 'coast') state.action = { label: 'FIRE', tone: flight.flags.firePrompt ? 'warn' : '' };
  else if (phase === 'orbit' && !flight.satellite) state.action = { label: 'LET GO', tone: 'warn' };
  else if (phase === 'landing') state.action = { label: 'HOLD: BURN', mode: 'burn' };
  // The pad or the ship, marked on the screen.
  if ((phase === 'return' || phase === 'landing') && !S.spaceMode) {
    const tgt = flight.target();
    if (tgt) {
      const p = TMP.b;
      const s = tgt.s;
      p.set(S.site.pad.x + S.site.az.x * s, flight.site.surface(s).y + 2, S.site.pad.z + S.site.az.z * s);
      const v = p.clone().project(sim.camera);
      const W = window.innerWidth;
      const H = window.innerHeight;
      const behind = v.z > 1;
      let x = (v.x * 0.5 + 0.5) * W;
      const y = (-v.y * 0.5 + 0.5) * H;
      if (behind) x = W - x;
      state.target = {
        x,
        y,
        onScreen: !behind && x > 0 && x < W && y > 0 && y < H,
        label: tgt.kind === 'barge' ? 'SHIP' : 'LANDING PAD',
      };
    }
  }
  return state;
}

/* ------------------------------------------------------------------ */
/* The result                                                          */
/* ------------------------------------------------------------------ */

function showResult(sim, S) {
  const r = S.flight.result;
  const mission = S.mission;
  const goal = GOALS[S.flight.goal];
  let credits = '';
  if (r.success) {
    try {
      // Under the Space heading on the board (rocket/menu.js), so priced as
      // Space; the rocket does not read the settings difficulty, so neither
      // does its pay (progression.js, SETTINGS_FREE_GAMES).
      const paid = Prog.award(sim.prog || sim.menus.prog, {
        kind: mission ? 'mission' : 'free',
        score: r.score,
        label: mission ? mission.name : `${S.def.name}: ${goal.name}`,
        mission,
        category: 'space',
        game: 'rocket',
      });
      credits = Prog.debriefPayRow(paid);
      if (mission) sim.progress = recordMission(sim.progress, mission.id, { score: r.score, time: Math.round(r.time) });
      sim.menus.syncProgression && sim.menus.syncProgression(sim.prog || sim.menus.prog);
      sim.menus.syncProgress && sim.menus.syncProgress(sim.progress);
      sim.menus.syncBar && sim.menus.syncBar();
    } catch (e) {
      console.warn('[rocket] could not pay for the flight', e);
    }
  }
  const b = S.flight.focus;
  const top = Math.max(...S.flight.bodies.map((x) => x.maxAlt || 0), b.maxAlt || 0);
  const mins = Math.floor(r.time / 60);
  const secs = Math.round(r.time % 60);
  const body = r.success
    ? `<div class="debrief-score">${r.score}<span>/100</span></div>
       <ul class="debrief-list">
         <li>Highest <b>${km(top)}</b></li>
         <li>Flight time <b>${mins}m ${String(secs).padStart(2, '0')}s</b></li>
         ${credits}
       </ul>
       <p class="debrief-reason">${r.reason}</p>`
    : `<p class="debrief-reason">${r.reason}</p>
       <ul class="debrief-list"><li>Highest <b>${km(top)}</b></li></ul>
       <p>Nobody was on board — it is a simulator. Have another go; everyone gets better every time.</p>`;
  const next = mission && r.success ? ROCKET_MISSIONS[ROCKET_MISSIONS.findIndex((m) => m.id === mission.id) + 1] : null;
  // A landing that went wrong starts again where the child took over, 6 km
  // up — not four minutes back on the pad.
  const snap = S.flight.handover;
  const again = snap ? { snap, mapId: S.site.mapId } : null;
  const actions = [];
  if (again && !r.success) {
    actions.push({ label: 'Try the landing again', primary: true, onClick: () => { sim.menus.hide(); start(sim, { ...S.opts, handover: again }); } });
    actions.push({ label: 'Start from the pad', onClick: () => restartRocket(sim) });
  } else {
    actions.push({ label: r.success ? 'Fly it again' : 'Try again', primary: true, onClick: () => restartRocket(sim) });
  }
  if (next) actions.push({ label: `Next: ${next.name}`, onClick: () => start(sim, { mission: next.id }) });
  actions.push({ label: 'Rockets', onClick: () => sim.quitToMenu('rocket') });
  actions.push({ label: 'Main menu', onClick: () => sim.quitToMenu('main') });
  sim.state = 'debrief';
  S.hud.setVisible(false);
  sim.menus.showDebrief({ title: r.title, kind: r.success ? 'good' : 'bad', body, actions });
}

/* ------------------------------------------------------------------ */
/* Plugging in                                                         */
/* ------------------------------------------------------------------ */

const PAUSE_CSS = `
.screen-pause.is-rocket .pause-fold,
.screen-pause.is-rocket [data-act="airport"],
.screen-pause.is-rocket [data-triggers],
.screen-pause.is-rocket [data-natural-fold] { display: none !important; }
`;

function install(sim) {
  R.sim = sim;
  if (!document.getElementById('rk-pause-css')) {
    const st = document.createElement('style');
    st.id = 'rk-pause-css';
    st.textContent = PAUSE_CSS;
    document.head.appendChild(st);
  }

  const baseUpdate = sim.update;
  sim.update = function rocketAwareUpdate(dt) {
    if (!R.session) return baseUpdate.call(sim, dt);
    try {
      return frame(sim, dt);
    } catch (err) {
      console.error('[rocket] the rocket frame threw; closing the rocket game for this visit:', err);
      R.broken = true;
      try { end(sim); } catch (e) { /* as much as can be put back is back */ }
      const btn = sim.menus && sim.menus.bar && sim.menus.bar.querySelector('[data-game="rocket"]');
      if (btn) btn.title = 'The rocket game hit a problem and is switched off until you reload';
      sim.quitToMenu('main');
      sim.hud.notify('The rocket game hit a problem and was closed — everything else still works.', 'warn', 6);
      return undefined;
    }
  };

  const baseSwitch = sim.switchGame;
  sim.switchGame = function (id) {
    if (id !== 'rocket') return baseSwitch.call(sim, id);
    sim.stopDrive && sim.stopDrive();
    sim.game = 'rocket';
    sim.quitToMenu('main');
    sim.menus.setGame('rocket');
    return null;
  };

  const baseStartAny = sim.startAnyMission;
  sim.startAnyMission = function (id) {
    if (findRocketMission(id)) return start(sim, { mission: id });
    return baseStartAny.call(sim, id);
  };

  const baseRestart = sim.restart;
  sim.restart = function () {
    if (R.session || sim.mode === 'rocket') return restartRocket(sim);
    return baseRestart.call(sim);
  };

  const basePause = sim.pause;
  sim.pause = function () {
    if (!R.session) return basePause.call(sim);
    if (sim.state !== 'flying') return undefined;
    basePause.call(sim);
    const S = R.session;
    const b = S.flight.focus;
    const pause = sim.menus.screens.pause;
    if (pause) pause.classList.add('is-rocket');
    sim.menus.setPauseInfo && sim.menus.setPauseInfo(`
      <div class="pause-grid">
        <span>Rocket<b>${S.def.name}</b></span>
        <span>Goal<b>${GOALS[S.flight.goal].name}</b></span>
        <span>Height<b>${km(Math.max(0, b.alt))}</b></span>
        <span>Speed<b>${Math.round(b.speed * 3.6).toLocaleString('en-GB')} km/h</b></span>
      </div>`);
    S.hud.setVisible(false);
    return undefined;
  };

  const baseResume = sim.resume;
  sim.resume = function () {
    const r = baseResume.call(sim);
    if (R.session) {
      sim.hud.setVisible(false);
      R.session.hud.setVisible(sim.state === 'flying');
      const pause = sim.menus.screens.pause;
      if (pause) pause.classList.remove('is-rocket');
    }
    return r;
  };

  installRocketMenu(sim, {
    start: (o) => start(sim, o),
    siteName,
    helper: () => R.helper,
  });
}

registerExtension({
  id: 'rocket',
  /** A rocket on the pad or in the sky has every key: the hints and Settings name the Rocket ones. */
  keyContext() {
    return R.session ? 'rocket' : null;
  },
  install,
  stop(sim) {
    if (R.session) end(sim);
  },
  devActions: [
    { label: 'Rocket: robot flies Satellite Delivery', hint: 'Watch the test pilot put a satellite in orbit', run: (sim) => start(sim, { mission: 'rocket-satellite', robot: true }) },
    { label: 'Rocket: robot lands on the ship', hint: 'Watch the test pilot land the booster at sea', run: (sim) => start(sim, { mission: 'rocket-barge', robot: true }) },
  ],
});

/** For the tests and the console. */
export const rocketDebug = {
  get session() {
    return R.session;
  },
  get broken() {
    return R.broken;
  },
  get lastSite() {
    return R.lastSite;
  },
  start: (opts) => start(R.sim, opts),
  end: () => end(R.sim),
  siteFor: () => siteFor(R.sim),
  get keys() {
    return R.keys;
  },
  press: () => { R.pendingAction = true; },
  setWarp: (w) => { R.warpWant = w; },
  robot(on = true) {
    if (R.session) R.session.robot = !!on;
  },
};

/**
 * Out of your aircraft on foot: start again, or find another ride.
 *
 * RESET. The owner, 2026-10-12: "if you get out of a plane or smth you
 * should be able to reset but that dispears if you get into a nother plane
 * or vehcile". Out of an aeroplane on foot — hopped out, or watching it go
 * without you — a Reset button (and the fly-again key, Enter, in Settings →
 * Controls → On foot) puts you in a fresh one of the aeroplane you got out
 * of at a sensible place for its class: the "Start at" spawns (spawns.js /
 * world/spawns.js), Auto unless you picked one. It is there only while you
 * are on foot out of an aeroplane, so the moment you get into anything —
 * back into your own, into another plane, a van, a tug — it is gone. Not in
 * a mission (they have their own fail and restart: the runner's Try again),
 * not as a passenger, not in a race. After an ejection, and with a runaway
 * plane, eject.js's and runaway.js's own "Fly again" is already on screen on
 * the same key, so this stays out of the way of both.
 *
 * A RIDE. "if you eject, i think itd be fun for you to find another
 * plane/vechile, in a closed garage or carrier you have to open". Parked
 * aeroplanes are rides: the airliners on the stands, the one in for
 * maintenance, a spare in a hangar you opened (features/secrets.js), a
 * secret plane once found — and the aeroplane you left behind when you took
 * another. Walk up and the prompt says "Press O to get in the A320" (the
 * walker's own enterables, onfoot.js); in you go, and Free Flight starts
 * again in that aeroplane, where it stood, engines off. Only an aeroplane
 * that is yours (bought, free or found): a locked one says so instead. Only
 * in Free Flight, never in a mission.
 *
 * Other features add rides with addRideSource({ id, list(sim, walker, add) })
 * and `add({ typeId, x, z, headingDeg, label, where, spawn?, onTake() })` — `spawn`
 * ({ x, z, headingDeg }) when the flight should start somewhere else than
 * where it is parked (out of a building, in front of its door).
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { isKey, keyName, registerActions } from '../flight/input.js';

/*
 * Reset is the fly-again key: one action, in Settings → Controls → On foot,
 * shared with eject.js and runaway.js (registering it again keeps theirs).
 */
registerActions({
  flyAgain: { label: 'Fly again (after ejecting, or a runaway)', group: 'On foot', ctx: ['foot'], default: ['Enter', 'NumpadEnter'] },
});
import { onFoot } from './onfoot.js';
import { getAircraft, AIRCRAFT } from '../aircraft/types.js';
import * as Prog from '../game/progression.js';
import { createAircraftModel } from '../aircraft/model-adapter.js';
import { schemeFor } from '../aircraft/liveries.js';
import { liveryOf } from '../core/plane-paint.js';
import { bakeModel, disposeBake } from '../world/airport-kit.js';
import { planeProfile, local } from './staff/jobs.js';
import { groundAt } from './staff/walk.js';
import { raceState } from './race.js';

const R = {
  sim: null,
  group: null,
  sources: [],
  /** Aeroplanes you swapped out of, parked where you left them: { typeId, x, z, headingDeg, mesh, bake }. */
  left: [],
  profiles: new Map(),
  chip: null,
  chipOn: false,
  resets: 0,
  rides: 0,
  lastRide: null,
};

function notify(sim, text, kind = 'info', secs = 3) {
  try {
    if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
  } catch (e) {
    /* no HUD, no words */
  }
}

function missionRunning(sim) {
  return !!(sim && sim.runner && sim.runner.status === 'running');
}

function racing() {
  try {
    const st = raceState();
    return !!(st && st.phase && !/^(idle|done|over|finished)$/i.test(String(st.phase)));
  } catch (e) {
    return false;
  }
}

/** Free Flight with nothing else in charge of how it ends. */
function freeAndClear(sim) {
  return !!(sim && sim.state === 'flying' && sim.mode === 'free' && !missionRunning(sim) && !sim.riding && !racing());
}

/* ------------------------------------------------------------------ */
/* Reset                                                               */
/* ------------------------------------------------------------------ */

/**
 * Is Reset on offer right now? On foot, out of an aeroplane, in Free Flight
 * with no mission, and nobody else's "fly again" already on screen.
 */
export function resetAvailable(sim) {
  if (!freeAndClear(sim) || !onFoot.active) return false;
  const ctl = onFoot.control;
  if (ctl && (ctl.ejected || ctl.runaway || ctl.locked || ctl.wands)) return false;
  const f = onFoot.from;
  return !!(f && f.type === 'aircraft');
}

/** Where a fresh one of this aeroplane starts: the Start-at choice for its class, else Auto. */
function startFor(sim, typeId) {
  const prev = (sim.modeOpts && sim.modeOpts.startAt) || '';
  let startAt = prev && prev !== 'runway' ? prev : 'auto';
  try {
    if (sim.spawns && typeof sim.spawns.preview === 'function') {
      const r = sim.spawns.preview(startAt === 'carrier' ? 'auto' : startAt, typeId);
      if (r && r.kind === 'carrier') startAt = 'carrier';
    }
  } catch (e) {
    /* Auto it is */
  }
  return startAt;
}

/** A fresh one of the aeroplane you got out of, at a sensible spawn. */
export function doReset(sim) {
  if (!resetAvailable(sim)) return false;
  const type = sim.aircraftType;
  const id = type ? type.id : 'skylark';
  const opts = { ...(sim.modeOpts || {}) };
  delete opts.rideFrom;
  opts.aircraft = id;
  opts.airborne = false;
  opts.taxi = false;
  opts.startAt = startFor(sim, id);
  R.resets++;
  try {
    const p = sim.startMode('free', opts);
    if (p && typeof p.then === 'function') {
      p.then(() => notify(sim, `Reset — a fresh ${type ? type.name : 'aeroplane'}, ready to go.`, 'good', 3.2), () => {});
    }
  } catch (e) {
    console.warn('[rides] reset failed', e);
    return false;
  }
  return true;
}

const CSS = `
.rs-chip {
  position: absolute; left: 16px; bottom: 96px; pointer-events: auto; cursor: pointer;
  display: none; align-items: center; gap: 8px; padding: 8px 14px 8px 10px; border-radius: 12px;
  background: rgba(12, 20, 34, 0.84); color: #f4f7fa; border: 1px solid rgba(242, 197, 61, 0.45);
  font: 600 14px/1.2 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); user-select: none; -webkit-user-select: none;
}
.rs-chip.on { display: inline-flex; }
.rs-chip kbd {
  display: inline-block; min-width: 1.4em; padding: 1px 7px; border-radius: 6px; background: #f2c53d; color: #1a1d20;
  font-family: inherit; font-weight: 800; font-size: 13px; line-height: 1.3;
}
.rs-chip em { font-style: normal; opacity: 0.72; font-weight: 500; }
.rs-chip:hover { border-color: rgba(242, 197, 61, 0.85); }
.rs-chip:active { transform: scale(0.97); }
@media (max-width: 620px) { .rs-chip { bottom: auto; top: 262px; left: 8px; font-size: 13px; } .rs-chip em { display: none; } }
`;

function chip() {
  if (R.chip) return R.chip;
  if (typeof document === 'undefined' || !document.createElement || !document.head) return null;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'rs-chip';
  el.setAttribute('aria-label', 'Reset: start again in a fresh aircraft');
  el.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (R.sim) doReset(R.sim);
  });
  // Inside the walker's own layer, so it goes off screen with it (paused, a menu up).
  const host = document.querySelector('.of-root') || extLayer();
  host.appendChild(el);
  R.chip = el;
  return el;
}

let chipHtml = '';
function syncChip(sim) {
  // On a touch screen the Reset is a thumb button (buttons() below), not this.
  const want = resetAvailable(sim) && !sim.touch && !gatedOff(sim);
  const el = want || R.chipOn ? chip() : null;
  if (!el) return;
  if (want) {
    const html = `<kbd>${keyName('flyAgain', sim)}</kbd> Reset <em>— a fresh aircraft</em>`;
    if (html !== chipHtml) {
      chipHtml = html;
      el.innerHTML = html;
    }
  }
  if (want !== R.chipOn) {
    R.chipOn = want;
    el.classList.toggle('on', want);
  }
}

/** The pause screen, a menu or a hidden interface: nothing of ours over it. */
function gatedOff(sim) {
  if (!sim || sim.state !== 'flying') return true;
  const menus = sim.menus;
  if (menus && menus.isOpen) return true;
  const hud = sim.hud;
  if (hud && hud.root && hud.root.classList && (hud.root.classList.contains('hidden-ui') || hud.root.hidden)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Rides                                                               */
/* ------------------------------------------------------------------ */

export function addRideSource(src) {
  if (!src || !src.id || typeof src.list !== 'function') return false;
  const i = R.sources.findIndex((s) => s.id === src.id);
  if (i >= 0) R.sources[i] = src;
  else R.sources.push(src);
  return true;
}

function profileOf(typeId) {
  let p = R.profiles.get(typeId);
  if (p === undefined) {
    const t = AIRCRAFT.find((a) => a.id === typeId) || null;
    try {
      p = t ? planeProfile(t, null) : null;
    } catch (e) {
      p = null;
    }
    R.profiles.set(typeId, p);
  }
  return p;
}

/** Yours to fly: free, bought or found. */
export function owned(sim, type) {
  if (!type) return false;
  return Prog.isUnlocked((sim && sim.prog) || Prog.load(), type.id);
}

const _la = { along: 0, side: 0 };
/** Metres from the walker to the aeroplane's body (not its middle: an airliner's door is 15 m from it). */
function bodyDistance(ride, w) {
  const p = profileOf(ride.typeId);
  if (!p) return Math.hypot(ride.x - w.x, ride.z - w.z);
  local(ride.x, ride.z, ride.headingDeg || 0, w.x, w.z, _la);
  const da = Math.max(0, _la.along - p.nose, p.tail - _la.along);
  const ds = Math.max(0, Math.abs(_la.side) - p.halfWidth);
  return Math.hypot(da, ds);
}

const LIST = [];
const POOL = [];
function gatherRides(sim, w) {
  LIST.length = 0;
  let used = 0;
  const add = (r) => {
    if (!r || !r.typeId || !Number.isFinite(r.x) || !Number.isFinite(r.z)) return;
    let o = POOL[used];
    if (!o) {
      o = {};
      POOL.push(o);
    }
    used++;
    for (const k in o) delete o[k];
    Object.assign(o, r);
    LIST.push(o);
  };
  for (const s of R.sources) {
    try {
      s.list(sim, w, add);
    } catch (e) {
      if (!s._warned) {
        s._warned = true;
        console.warn(`[rides] "${s.id}" failed to list its rides`, e);
      }
    }
  }
  return LIST;
}

/** The walker's provider: rides as things to get into, solid left-behind planes. */
const PROVIDER = {
  enterables(sim, w, addEntry) {
    if (!freeAndClear(sim)) return;
    const ctl = onFoot.control;
    if (ctl && ctl.locked) return;
    const list = gatherRides(sim, w);
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      const d = bodyDistance(r, w);
      if (d > (r.reach || 2.6)) continue;
      const type = getAircraft(r.typeId);
      if (!owned(sim, type)) continue;
      const ride = { ...r };
      addEntry(r.label || `the ${type.name}`, d, () => takeRide(sim, ride));
    }
  },
  solids(sim, addSolid) {
    for (const l of R.left) {
      const p = profileOf(l.typeId);
      if (!p || !l.mesh || !l.mesh.visible) continue;
      const h = l.headingDeg;
      const mid = (p.nose + p.tail) / 2;
      const rad = (h * Math.PI) / 180;
      const cx = l.x + Math.sin(rad) * mid;
      const cz = l.z - Math.cos(rad) * mid;
      addSolid(cx, cz, h, (p.nose - p.tail) / 2, p.halfWidth, l.y - 1, l.y + Math.max(1, p.top || 2), `the ${getAircraft(l.typeId).name}`);
    }
  },
  buttons(sim) {
    return resetAvailable(sim) ? RESET_BUTTONS : null;
  },
  onButton(sim, id) {
    if (id !== 'reset') return false;
    doReset(sim);
    return true;
  },
  key(sim, code, down) {
    if (!isKey(sim, 'flyAgain', code) || !resetAvailable(sim)) return false;
    if (down) doReset(sim);
    return true;
  },
};
const RESET_BUTTONS = [{ id: 'reset', label: 'Reset' }];

/** The aeroplane you are leaving, parked where it stands, so it can be got back into. */
function leaveBehind(sim) {
  const f = onFoot.from;
  const ac = sim.aircraft;
  const type = sim.aircraftType;
  if (!f || f.type !== 'aircraft' || f.runaway || !ac || ac.crashed || !type || !sim.model || !R.group) return;
  try {
    const model = createAircraftModel({ type, livery: schemeFor(type, liveryOf(sim.settings, type.id)), landingLight: false });
    if (model.userData && typeof model.userData.update === 'function') {
      model.userData.update(0.016, {
        controls: { pitch: 0, roll: 0, yaw: 0, throttle: 0, brakes: 1 }, rpm: 0, flaps: 0, gearPos: 1, gearDown: true,
        onGround: true, groundSpeed: 0, agl: 0, engineOn: false,
      }, { isNight: false, cond: { cloud: 0 } });
    }
    const bake = bakeModel(model);
    const g = new THREE.Group();
    g.name = `rides:left:${type.id}`;
    for (const p of bake.parts) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.castShadow = true;
      m.receiveShadow = true;
      g.add(m);
    }
    // Exactly where the one you flew was drawn, nose, attitude and all.
    sim.model.updateMatrixWorld(true);
    g.position.copy(sim.model.position);
    g.quaternion.copy(sim.model.quaternion);
    R.group.add(g);
    R.left.push({ typeId: type.id, x: ac.pos.x, y: groundAt(ac.pos.x, ac.pos.z), z: ac.pos.z, headingDeg: ac.heading, mesh: g, bake });
    // Two at most: the oldest goes.
    while (R.left.length > 2) dropLeft(R.left[0]);
  } catch (e) {
    console.warn('[rides] could not park the aeroplane you left', e);
  }
}

function dropLeft(l) {
  const i = R.left.indexOf(l);
  if (i >= 0) R.left.splice(i, 1);
  if (l.mesh && l.mesh.parent) l.mesh.parent.remove(l.mesh);
  disposeBake(l.bake);
}

/** In you get: Free Flight starts again in that aeroplane, where it stands. */
export function takeRide(sim, ride) {
  if (!freeAndClear(sim)) {
    notify(sim, 'Not now — finish the mission first.', 'info', 2.6);
    return false;
  }
  const type = getAircraft(ride.typeId);
  if (!owned(sim, type)) {
    notify(sim, `Locked — the ${type.name} is not yours yet.`, 'info', 2.8);
    return false;
  }
  leaveBehind(sim);
  try {
    if (typeof ride.onTake === 'function') ride.onTake();
  } catch (e) {
    console.warn('[rides] a ride could not be taken away', e);
  }
  const opts = { ...(sim.modeOpts || {}) };
  delete opts.startAt;
  opts.aircraft = type.id;
  opts.airborne = false;
  opts.taxi = false;
  // Where the flight starts: where it stands, or — out of a building — in front of the door.
  const at = ride.spawn && Number.isFinite(ride.spawn.x) ? ride.spawn : ride;
  opts.rideFrom = { x: at.x, z: at.z, headingDeg: at.headingDeg != null ? at.headingDeg : ride.headingDeg || 0, where: ride.where || '', name: type.name };
  R.rides++;
  R.lastRide = { typeId: type.id, where: ride.where || '' };
  try {
    sim.startMode('free', opts);
  } catch (e) {
    console.warn('[rides] could not start the ride', e);
    return false;
  }
  return true;
}

/** The ride's start: where it stood, engines off, the tower told. */
function placeRide(sim, opts) {
  const r = opts.rideFrom;
  const ac = sim.aircraft;
  if (!ac || !r) return;
  const fuel = opts.fuel != null ? Math.max(0.05, Math.min(1, opts.fuel)) : 1;
  ac.reset({ pos: new THREE.Vector3(r.x, 0, r.z), headingDeg: r.headingDeg || 0, speed: 0, altAGL: null, engineOn: false, fuel });
  if (sim.input) {
    sim.input.throttleTarget = 0;
    if (sim.input.out) sim.input.out.throttle = 0;
  }
  if (sim.taxi && sim.taxi.active && sim.taxi.stop) sim.taxi.stop();
  const rig = sim.rig;
  if (rig && typeof rig === 'object') {
    rig.initialised = false;
    if (rig.chaseVel && rig.chaseVel.set) rig.chaseVel.set(0, 0, 0);
  }
  const name = r.name || (sim.aircraftType && sim.aircraftType.name) || 'aeroplane';
  if (sim.hud && typeof sim.hud.setObjective === 'function') {
    sim.hud.setObjective('Free Flight', `You took the ${name}${r.where ? ` from ${r.where}` : ''}. ${keyName('starter', sim)} starts the engine; then taxi out and go.`);
  }
  if (sim.atc && sim.atc.said) sim.atc.said.start = true;
  // The airliners' take-off flap, which reset() just took off again.
  if (typeof sim.restoreTakeoffConfig === 'function') {
    try {
      sim.restoreTakeoffConfig();
    } catch (e) {
      /* flap is a nicety */
    }
  }
}

/* ------------------------------------------------------------------ */
/* The airport's own parked aeroplanes                                 */
/* ------------------------------------------------------------------ */

const _hide = new THREE.Matrix4().makeScale(0, 0, 0);
addRideSource({
  id: 'apron',
  list(sim, w, add) {
    const parked = sim.apron && sim.apron.parked;
    if (!Array.isArray(parked)) return;
    for (const p of parked) {
      const tg = p && p.tg;
      if (!tg || p.rideTaken || !tg.info || !tg.info.typeId) continue;
      if ((tg.ox - w.x) ** 2 + (tg.oz - w.z) ** 2 > 90 * 90) continue;
      add({
        typeId: tg.info.typeId,
        x: tg.ox,
        z: tg.oz,
        headingDeg: tg.heading,
        reach: 2.6,
        where: p.kind === 'hangar' ? 'the maintenance hangar' : 'the stand',
        onTake: () => {
          p.rideTaken = true;
          for (const m of p.meshes || []) {
            m.setMatrixAt(p.index, _hide);
            m.instanceMatrix.needsUpdate = true;
          }
        },
      });
    }
  },
});

addRideSource({
  id: 'left',
  list(sim, w, add) {
    for (const l of R.left) {
      add({
        typeId: l.typeId,
        x: l.x,
        z: l.z,
        headingDeg: l.headingDeg,
        reach: 2.6,
        where: 'where you left it',
        onTake: () => dropLeft(l),
      });
    }
  },
});

/* ------------------------------------------------------------------ */
/* The plug-in                                                         */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'rides',

  install(sim) {
    R.sim = sim;
    onFoot.addProvider(PROVIDER);
  },

  buildWorld(sim, group) {
    R.group = group;
    for (const l of R.left.slice()) dropLeft(l);
    R.left.length = 0;
  },

  startMode(sim, mode, opts) {
    if (mode === 'free' && opts && opts.rideFrom) placeRide(sim, opts);
  },

  stop(sim) {
    syncChip(sim);
  },

  update(sim) {
    syncChip(sim);
  },
});

/** For the tests and the console. */
export function ridesState(sim = R.sim) {
  return {
    resetAvailable: resetAvailable(sim),
    chip: R.chipOn,
    resets: R.resets,
    rides: R.rides,
    lastRide: R.lastRide,
    left: R.left.map((l) => ({ typeId: l.typeId, x: Math.round(l.x), z: Math.round(l.z) })),
    sources: R.sources.map((s) => s.id),
  };
}

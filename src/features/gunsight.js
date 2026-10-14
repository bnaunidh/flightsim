/**
 * THE GUNSIGHT AND THE LOCK KEY — "make the crosshair better and have a
 * lockon" (the owner, 2026-10-12, on the heat-seekers).
 *
 * WHAT A PILOT SEES. In an aeroplane with guns (every military jet: the
 * Vanguard, Osprey, Nightjar, F-22, F-35B, F/A-18), or in any aeroplane while
 * PvP is on for you (the paint pellets), a clean sight sits where the nose
 * points: a dot inside a ring, with twelve range ticks round the ring that
 * light up as a locked target comes into the gun's reach (all twelve = in
 * range). It is hidden on the ground and in an aeroplane with no gun at all.
 *
 * THE LOCK KEY (Home, in Settings → Controls → Weapons; a LOCK button on a
 * touch screen). Each press moves to the next valid target in front of you,
 * nearest the nose first; past the last it lets go. The locked target gets a
 * box with its range, an arrow round the middle of the screen when it is off
 * the screen, and — the point of it — a LEAD PIPPER: where the nose has to
 * point, counting the pellet's speed, your own speed and the target's
 * velocity, for a burst to arrive with it (./gunsight/rules.js leadAim).
 * Put the centre dot on the pipper and fire.
 *
 * The same box serves the missiles: a locked target that is a drone is also
 * the heat-seeker's (./heatseek.js setPrefer: the seeker works on that one
 * only, and the box turns yellow while the seeker closes and red when it is
 * locked). A meteor is a gun target only.
 *
 * WHAT CAN BE LOCKED. The heat-seekers' own filter (heatseek/rules.js
 * targetVerdict): the drones of Air Force One - Under Attack, practice
 * drones, another player only with PvP on for you both; plus the meteors the
 * zapper can pop, in a plane that has guns. Never civilian traffic, an
 * airliner, Air Force One, a rescue aeroplane: they are not in the list the
 * key cycles, however well they sit in front of the nose.
 *
 * NO SOUND, NO FLASH. The box changes colour and stays put; nothing blinks.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { registerActions, isKey, keyName } from '../flight/input.js';
import { forwardOf } from './mpplay/shared.js';
import * as HSK from './heatseek.js';
import * as G from './gunsight/rules.js';
import * as UI from './gunsight/hud.js';

/*
 * The lock key, in the one registry: Settings → Controls → Weapons.
 *
 * Every letter, digit and mark on a keyboard is already an action in the
 * aeroplane (the heat-seekers took the backslash for the very same reason),
 * so the lock key is Home — fn + ← on a laptop. A LOCK button does it on a
 * touch screen.
 */
registerActions({
  lockOn: { label: 'Lock on: pick the next target in front (guns and missiles)', group: 'Weapons', ctx: ['plane'], default: ['Home'] },
});

const S = {
  sim: null,
  des: new G.Designation(),
  cands: [],
  mets: [],
  tgt: null,
  gun: G.GUNS.pellet,
  lead: null,
  up: false,
  wasUp: false,
  shown: false,
  stats: { presses: 0, locked: 0, released: 0, nothing: 0, unarmed: 0 },
  notes: [],
};

const _p = new THREE.Vector3();
const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const SCR = { x: 0, y: 0, front: false, inside: false };

function say(text, kind = 'info', secs = 2.5) {
  S.notes.push(text);
  if (S.notes.length > 12) S.notes.shift();
  const hud = S.sim && S.sim.hud;
  if (hud && typeof hud.notify === 'function') hud.notify(text, kind, secs);
}

/* ------------------------------------------------------------------ *
 * Is there a gun to sight?
 * ------------------------------------------------------------------ */

function flyingPlane(sim) {
  return !!(sim && sim.state === 'flying' && sim.aircraft && sim.mode !== 'drive' && sim.game !== 'heli' && !sim.aircraft.crashed && !(sim.walking && sim.walking.active) && !sim.riding);
}

/** A gun aboard: a military jet's own, or the paint pellets while PvP is on for me. */
export function gunAboard(sim) {
  return flyingPlane(sim) && (G.hasGuns(sim.aircraftType, sim.game) || HSK.net.on());
}

function mayShow(sim) {
  if (!sim || sim.state !== 'flying') return false;
  const hud = sim.hud;
  if (hud && (hud.hidden || hud.enabled === false)) return false;
  if (sim.menus && sim.menus.current) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Who can be locked for the gun
 * ------------------------------------------------------------------ */

/**
 * Everything the key may cycle through right now: the heat-seekers' valid
 * targets (drones, practice drones, PvP players), and — in a plane that has
 * guns — the meteors the zapper can pop. [{ id, pos, vel, radius, kind, name, ref }]
 */
export function gunTargets(sim, dt = 0, out = []) {
  HSK.validTargets(sim, dt, out);
  const met = sim && sim.meteors;
  if (met && met.active && typeof met.targets === 'function' && G.hasGuns(sim.aircraftType, sim.game)) {
    met.targets(S.mets);
    for (const m of S.mets) out.push(m);
  }
  return out;
}

function setLock(id, cand) {
  HSK.setPrefer(id);
  const met = S.sim && S.sim.meteors;
  if (met && typeof met.prefer === 'function') met.prefer(cand && cand.kind === 'meteor' ? cand.uid : 0);
}

function kindWord(c) {
  if (!c) return '';
  if (c.kind === 'meteor') return 'METEOR';
  if (c.kind === 'player') return String(c.name || 'PLAYER').toUpperCase().slice(0, 14);
  return 'DRONE';
}

/**
 * The lock key (or the LOCK button). Returns { ok, action, target }.
 */
export function lockPress(sim = S.sim, via = 'key') {
  if (!sim) return { ok: false, action: 'none' };
  S.sim = sim;
  S.stats.presses++;
  if (!gunAboard(sim)) {
    if (flyingPlane(sim)) {
      S.stats.unarmed++;
      say('No guns or missiles on this aeroplane — the military jets have them.', 'info', 3);
    }
    return { ok: false, action: 'unarmed' };
  }
  const ac = sim.aircraft;
  if (ac.onGround) {
    say('Take off first — there is nothing to lock on the ground.', 'info', 2.5);
    return { ok: false, action: 'ground' };
  }
  gunTargets(sim, 0, S.cands);
  forwardOf(ac.quat, _fwd);
  const res = S.des.cycle(ac.pos, _fwd, S.cands);
  if (res.action === 'set' || res.action === 'next') {
    S.stats.locked++;
    setLock(res.cand.id, res.cand);
    say(`LOCKED ${kindWord(res.cand)} — put the dot on the pipper${via === 'touch' ? '' : `, ${keyName('lockOn', sim)} for the next`}`, 'good', 2.5);
    return { ok: true, action: res.action, target: res.cand, via };
  }
  if (res.action === 'cleared') {
    S.stats.released++;
    setLock(null, null);
    say('Lock released', 'info', 1.8);
    return { ok: true, action: 'cleared', via };
  }
  S.stats.nothing++;
  say('Nothing to lock in front of you — turn towards a drone or a meteor', 'info', 2.8);
  return { ok: false, action: 'none', via };
}

/** Let go of the lock without a press (a new flight, the aeroplane changed). */
export function release() {
  if (!S.des.active) return;
  S.des.reset();
  setLock(null, null);
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

function toScreen(pos, cam, w, h, out) {
  _p.set(pos.x, pos.y, pos.z).project(cam);
  out.x = (_p.x * 0.5 + 0.5) * w;
  out.y = (-_p.y * 0.5 + 0.5) * h;
  out.front = _p.z < 1 && _p.z > -1;
  out.inside = out.front && out.x > -30 && out.x < w + 30 && out.y > -30 && out.y < h + 30;
  return out;
}

function paint(sim) {
  const ac = sim.aircraft;
  const cam = sim.camera;
  if (!cam) return;
  const w = (typeof window !== 'undefined' && window.innerWidth) || 1280;
  const h = (typeof window !== 'undefined' && window.innerHeight) || 720;
  forwardOf(ac.quat, _fwd);

  // The target to sight: the one the lock key picked, else the heat-seeker's own (a drone in the circle).
  let tgt = S.des.active ? S.des.target : null;
  const picked = !!tgt;
  const lk = HSK.heatseek.lock;
  if (!tgt && lk && lk.target) tgt = lk.target;
  S.tgt = tgt;

  // The dot and ring where the nose points.
  _v.set(ac.pos.x, ac.pos.y, ac.pos.z).addScaledVector(_fwd, G.AIM_DIST);
  toScreen(_v, cam, w, h, SCR);
  const nose = { x: SCR.x, y: SCR.y, on: SCR.front && SCR.inside };

  if (!tgt) {
    UI.setSight(nose.on, nose.x, nose.y, { idle: true, lit: 0, inRange: false });
    UI.setPipper(false);
    UI.setBox(false);
    UI.setArrow(false);
    S.lead = null;
    return;
  }

  const gun = G.gunFor(tgt);
  S.gun = gun;
  const lead = G.leadAim({ pos: ac.pos, vel: ac.vel }, { pos: tgt.pos, vel: tgt.vel }, gun);
  S.lead = lead;
  const ticks = G.rangeTicks(lead.range, gun);
  UI.setSight(nose.on, nose.x, nose.y, { idle: false, lit: ticks.lit, inRange: ticks.inRange });

  // The pipper: where the nose must point.
  if (lead.ok) {
    _v.set(ac.pos.x + lead.dir.x * G.AIM_DIST, ac.pos.y + lead.dir.y * G.AIM_DIST, ac.pos.z + lead.dir.z * G.AIM_DIST);
    toScreen(_v, cam, w, h, SCR);
    UI.setPipper(SCR.front && SCR.inside, SCR.x, SCR.y, !lead.inRange);
  } else {
    UI.setPipper(false);
  }

  // The box colour: the seeker's own state when it is working on this target, else plain.
  let state = 'locked';
  let word = kindWord(tgt);
  if (lk && lk.target && lk.target.id === tgt.id) {
    if (lk.locked) {
      state = 'red';
      word = 'LOCKED';
    } else {
      state = 'acquire';
      word = `LOCK ${Math.round(lk.progress * 100)}%`;
    }
  } else if (!picked) {
    state = 'acquire';
  }
  const text = `${word} ${G.rangeText(lead.range)}`;

  // The box on the target, or an arrow on a ring round the middle when it is off the screen.
  toScreen(tgt.pos, cam, w, h, SCR);
  if (SCR.front && SCR.inside && SCR.x > 8 && SCR.x < w - 8 && SCR.y > 8 && SCR.y < h - 8) {
    UI.setBox(true, SCR.x, SCR.y, state, text);
    UI.setArrow(false);
  } else {
    UI.setBox(false);
    _v.set(tgt.pos.x, tgt.pos.y, tgt.pos.z).applyMatrix4(cam.matrixWorldInverse);
    const m = G.ringMark(_v.x, -_v.y, Math.min(w, h) * 0.4);
    UI.setArrow(true, w / 2 + m.x, h / 2 + m.y, m.ang, state, G.rangeText(lead.range));
  }
}

function hideAll() {
  UI.setSight(false);
  UI.setPipper(false);
  UI.setBox(false);
  UI.setArrow(false);
  UI.setButton(false);
}

/* ------------------------------------------------------------------ *
 * The plug-in
 * ------------------------------------------------------------------ */

registerExtension({
  id: 'gunsight',

  install(sim) {
    S.sim = sim;
    UI.ensureHud({ lock: () => lockPress(S.sim, 'touch') });
  },

  startMode(sim) {
    S.sim = sim;
    release();
    S.tgt = null;
    S.lead = null;
  },

  stop(sim) {
    release();
    S.tgt = null;
    S.lead = null;
    S.up = false;
    S.wasUp = false;
    if (sim) sim.gunsightUp = false;
    UI.show(false);
    hideAll();
  },

  update(sim, dt) {
    S.sim = sim;
    const up = gunAboard(sim) && !sim.aircraft.onGround;
    S.up = up;
    sim.gunsightUp = up && mayShow(sim);
    if (!up) {
      // Nothing to sight (on the ground, a new aeroplane without guns, PvP switched off): let go and take the parts down.
      if (S.des.active) release();
      if (S.wasUp) {
        hideAll();
        S.tgt = null;
        S.lead = null;
      }
      S.wasUp = false;
      UI.show(false);
      return;
    }
    S.wasUp = true;
    gunTargets(sim, dt, S.cands);
    forwardOf(sim.aircraft.quat, _fwd);
    if (S.des.active && S.des.update(dt, sim.aircraft.pos, S.cands)) {
      setLock(null, null);
      say('Target gone — lock released', 'info', 1.8);
    }
    const shown = mayShow(sim);
    UI.show(shown);
    if (shown) {
      paint(sim);
      UI.setButton(true, S.des.active);
    }
  },

  key(sim, code, down, e) {
    if (!down || (e && e.repeat)) return false;
    if (!isKey(sim, 'lockOn', code)) return false;
    if (!flyingPlane(sim)) return false;
    lockPress(sim, 'key');
    return true;
  },
});

/** For the tests and the console. */
export const gunsight = {
  get S() {
    return S;
  },
  get up() {
    return S.up;
  },
  get designated() {
    return S.des.active ? S.des.target : null;
  },
  get target() {
    return S.tgt;
  },
  get lead() {
    return S.lead;
  },
  get gun() {
    return S.gun;
  },
  get stats() {
    return { ...S.stats };
  },
  get notes() {
    return S.notes.slice();
  },
  lockPress,
  release,
  gunAboard,
  gunTargets: (sim = S.sim) => gunTargets(sim, 0, []),
  hud: UI,
  snapshot: () => UI.snapshot(),
};

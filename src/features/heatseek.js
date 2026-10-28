/**
 * HEAT-SEEKING MISSILES — "heat seeking missles on miltary pllanes", and then
 * "only get 3" (the owner, 2026-10-12).
 *
 * WHAT A PILOT SEES. Every military aeroplane (the Vanguard, the Osprey, the
 * Nightjar, the F-22, the F-35B, the F/A-18: carrier/who.js isMilitary(), the
 * same rule the hangar and the carrier use — never an airliner, a trainer,
 * a helicopter, Air Force One, Air Massimo or T-Pose Harrison) carries THREE
 * heat-seekers, hung on pylons you can see under the wings and belly. The
 * screen says MSL 3/3. A ring ahead of the nose is the seeker, about twenty
 * degrees across: hold a valid target inside it for a second and a box
 * closes on it and turns red — LOCKED. Press the fire key (\ by default, in
 * Settings → Controls → Weapons; a FIRE MSL button on a touch screen) and the
 * missile drops off its pylon, the motor lights, a white trail draws the
 * path, and it steers on the target by proportional navigation
 * (./heatseek/rules.js). That pylon is empty from then on. Land and stop at
 * an airbase or a carrier, or start a new flight, and the three come back.
 *
 * WHAT IT CAN LOCK. Drones only — school-safe, and the same rule as the
 * rest of the game ("drones, missiles and rocks"; nobody is aboard what
 * goes up in the airburst):
 *   - the hostile drones of Air Force One - Under Attack (the escort seat
 *     flies a fighter);
 *   - practice target drones, orange and white, which a pilot spawns in Free
 *     Flight (the pause menu's Targets, or the Free Flight screen's tick);
 *   - another player's aeroplane, ONLY with the PvP switch on for both of
 *     you. A hit there is the PvP "tagged out": the host decides, the pilot
 *     ejects under a parachute, a shield comes up, nobody is hurt.
 * Never civilian traffic, an airliner, Air Force One, the rescue
 * aeroplanes, a friend, or the chase's manned pursuer: targetVerdict()
 * (./heatseek/rules.js) is the one place that says so, and the node test
 * feeds it every kind of body the game has.
 *
 * FLARES. A military jet also has eight pairs of flares on the same key as
 * Air Force One's decoys (4); a missile aimed at it can be pulled onto
 * one, better still if the jet is also turning hard. In the Heat-Seeker
 * disaster (./heatseek-disaster.js) every aeroplane has them.
 *
 * NO SOUND. Not a lock tone, not a launch whoosh: the game's own sound is
 * muted by default and this adds none. Every glow here is steady or a slow
 * swell (Reduce flashing); the bang is explosions.js's own airburst.
 *
 * Wired through the plug-in layer; the only edits outside this file and
 * ./heatseek/ are the key group, the drone's `shot()`, the PvP judge's missile
 * claim, and the one-line features list.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension } from '../game/extensions.js';
import { registerActions, isKey, keyName } from '../flight/input.js';
import { heightAt, isPaved } from '../world/terrain.js';
import { militaryJet, AIM_DIST } from './gunsight/rules.js';
import { explode } from './explosions.js';
import { registerBody, unregisterBody, bodies } from './sky.js';
import { isBroken } from '../game/breakup-mesh.js';
import { ch, mp, inGame, who, forwardOf } from './mpplay/shared.js';
import { row as pvpRow, myRow as pvpMyRow } from './pvp.js';
import * as R from './heatseek/rules.js';
import * as Fly from './heatseek/fly.js';
import * as UI from './heatseek/hud.js';
import { HS, ensureWorld, clearWorld, deployFlares, launchMissile, updateWorld, liveMissiles, standoff } from './heatseek/world.js';

/*
 * The keys, in the one registry: Settings → Controls → Weapons.
 *
 * FIRE is the backslash, which nothing else in the game uses (every letter,
 * digit and the rest of the punctuation was taken: the autopilot's quote,
 * minus and equals, the crash replay's backtick, the drag chute's semicolon,
 * the hook's and the salute's brackets). FLARES is 4, shared by design with
 * Air Force One's decoys (afoFlare) — it is the same thing, a flare, in a
 * different aeroplane — and with quick-chat 4 in a lobby, which a pilot
 * popping flares does not also want to send (a used key is not passed on).
 */
registerActions({
  fireMissile: { label: 'Fire a heat-seeking missile (military aeroplanes: lock on first)', group: 'Weapons', ctx: ['plane'], default: ['Backslash'] },
  flares: { label: 'Drop flares (military aeroplanes; everybody in the Heat-Seeker disaster)', group: 'Weapons', ctx: ['plane', 'heli'], default: ['Digit4'] },
});

/** Channels: a launch, so everybody sees the missile go; a flare, so a missile can be pulled onto it; the host's judging is in pvp.js. */
ch.define('hs:launch', { validate: R.cleanLaunch, rate: 4 });
ch.define('hs:flare', { validate: R.cleanFlare, rate: 3 });

const D2R = Math.PI / 180;
const ME = 'me';

const S = {
  sim: null,
  armed: false,
  load: new R.Loadout(),
  flare: { left: 0, max: 0, cool: 0 },
  lock: new R.LockTracker(),
  rearm: new R.RearmGate(),
  rig: null,
  rigFailed: null,
  cands: [],
  practice: [],
  practiceId: 0,
  vel: new WeakMap(),
  watch: 0,
  shown: false,
  wasShown: false,
  pending: false,
  flightT: 0,
  frameId: 0,
  prefer: null,
  hooks: { disaster: null },
  stats: { fired: 0, kills: 0, decoyed: 0, lost: 0, noLock: 0, rearmed: 0, flares: 0, remote: 0, claims: 0 },
  notes: [],
};

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _p = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _q = new THREE.Quaternion();

function say(text, kind = 'info', secs = 3) {
  S.notes.push(text);
  if (S.notes.length > 12) S.notes.shift();
  const hud = S.sim && S.sim.hud;
  if (hud && typeof hud.notify === 'function') hud.notify(text, kind, secs);
}

/* ------------------------------------------------------------------ *
 * Is the weapon live?
 * ------------------------------------------------------------------ */

function flying(sim) {
  return !!(sim && sim.state === 'flying' && sim.aircraft && sim.mode !== 'drive' && !sim.aircraft.crashed);
}

function onFoot(sim) {
  return !!(sim && sim.walking && sim.walking.active);
}

/** Does this aeroplane carry heat-seekers? Military, flown as an aeroplane. */
export function carriesMissiles(sim) {
  const t = sim && sim.aircraftType;
  return !!t && militaryJet(t, sim.game);
}

function isArmed(sim) {
  return flying(sim) && !onFoot(sim) && !sim.riding && carriesMissiles(sim);
}

/* ------------------------------------------------------------------ *
 * The pylons
 * ------------------------------------------------------------------ */

function dropRig() {
  const r = S.rig;
  if (!r) return;
  if (r.group.parent) r.group.parent.remove(r.group);
  S.rig = null;
  if (S.sim && S.sim.weaponsRig === r.group) S.sim.weaponsRig = null;
}

function syncRig(sim) {
  const model = sim.model;
  if (!isArmed(sim) || !model) {
    if (S.rig) dropRig();
    return;
  }
  if ((!S.rig || S.rig.model !== model) && S.rigFailed !== model) {
    dropRig();
    try {
      S.rig = Fly.buildPylons(model, sim.aircraftType, R.LOADOUT);
      sim.weaponsRig = S.rig.group;
    } catch (e) {
      console.warn('[heatseek] the pylons could not be hung; the missiles still fly:', e);
      S.rig = null;
      S.rigFailed = model;
    }
  }
  const r = S.rig;
  if (!r) return;
  // Each pylon shows the missile it still has, in the order they go: right, left, belly.
  const left = S.load.left;
  r.stations.forEach((st, i) => {
    const on = i >= r.stations.length - left;
    st.on = on;
    st.mesh.visible = on;
  });
  // The wreck takes the pylons with it (the break-up skips them, so they would hang in the air).
  const ac = sim.aircraft;
  r.group.visible = !(ac.crashed || (model && isBroken(model)));
}

/** The next missile off the rack, and where it hangs in the world. */
function takeStation(out) {
  const r = S.rig;
  if (!r) return null;
  // Go in order: right wing, left wing, belly.
  const st = r.stations.find((s) => s.on);
  if (!st) return null;
  st.on = false;
  st.mesh.visible = false;
  r.model.updateWorldMatrix(true, false);
  out.set(st.x, st.y - 0.31 - 0.025 - Fly.MISSILE.radius, st.z).applyMatrix4(r.model.matrixWorld);
  return st;
}

/* ------------------------------------------------------------------ *
 * Who can be locked
 * ------------------------------------------------------------------ */

function liveRow(r) {
  return !!(r && r.on && !r.arming && !r.down);
}

/** PvP counts for me: in a game, my own switch is on and has taken effect. */
function pvpOn() {
  return inGame() && liveRow(pvpMyRow());
}

/**
 * What the lock-on asks of the lobby. One seam, so a browser test can stand a
 * crowd in front of the seeker without a network: replace these and put them back.
 */
export const net = {
  on: () => pvpOn(),
  players: () => ch.players(),
  row: (id) => pvpRow(id),
};

function velOf(b, dt) {
  if (b.vel && Number.isFinite(b.vel.x) && Number.isFinite(b.vel.z)) return b.vel;
  let e = S.vel.get(b);
  if (!e) {
    e = { x: b.pos.x, y: b.pos.y, z: b.pos.z, v: new THREE.Vector3(), f: S.frameId };
    S.vel.set(b, e);
  } else if (dt > 0 && e.f !== S.frameId) {
    // Once a frame: the gunsight asks for the same list (./gunsight.js), and a second look in the same frame saw nothing move.
    e.f = S.frameId;
    e.v.set((b.pos.x - e.x) / dt, (b.pos.y - e.y) / dt, (b.pos.z - e.z) / dt);
    e.x = b.pos.x;
    e.y = b.pos.y;
    e.z = b.pos.z;
  }
  return e.v;
}

/**
 * Everything the seeker may lock right now: [{ id, pos, vel, radius, kind,
 * name, ref }] — drones from the sky list, and (PvP on, both sides) other
 * players. Nothing else ever gets through targetVerdict().
 */
export function validTargets(sim, dt = 0, out = []) {
  out.length = 0;
  const pvp = net.on();
  for (const b of bodies()) {
    if (!b || b.gone || !b.pos) continue;
    const v = R.targetVerdict({ kind: b.kind, small: b.small, crew: b.crew, practice: b.practice, name: b.name, bodyName: b.bodyName, typeId: b.typeId, civilian: b.civilian, protected: b.protected }, { pvp });
    if (!v.ok) continue;
    out.push({ id: b.id, pos: b.pos, vel: velOf(b, dt), radius: b.radius || 8, kind: 'body', name: b.name || 'a drone', ref: b });
  }
  if (pvp) {
    for (const p of net.players()) {
      if (p.me || !p.pos || !p.visible || !p.pvp || p.ghost) continue;
      const r = net.row(p.id);
      const v = R.targetVerdict({ kind: 'player', pvpLive: liveRow(r) && !r.shield, name: p.name }, { pvp: true });
      if (!v.ok) continue;
      out.push({ id: `p${p.id}`, pos: p.pos, vel: p.vel || { x: 0, y: 0, z: 0 }, radius: Math.max(5, (p.radius || 6) * 0.8), kind: 'player', playerId: p.id, name: p.name, ref: p });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Practice target drones
 * ------------------------------------------------------------------ */

export class PracticeDrone {
  constructor(sim, centre, { radius = 800, y = 300, phase = 0, dir = 1, speed = 55 } = {}) {
    this.sim = sim;
    this.centre = centre.clone();
    this.r = radius;
    this.y = y;
    this.a = phase;
    this.dir = dir;
    this.speed = speed;
    this.t = 0;
    this.alive = true;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.heading = 0;
    this.model = Fly.makeTargetDroneModel();
    sim.scene.add(this.model);
    this.place(0);
    const self = this;
    this.body = registerBody({
      id: `target-drone-${++S.practiceId}`,
      kind: 'enemy',
      name: 'a target drone',
      pos: this.pos,
      vel: this.vel,
      radius: 8,
      small: true,
      crew: 0,
      practice: true,
      onGround: false,
      get heading() {
        return self.heading;
      },
      // Flown into: it is a bump for you and the end of the drone, as for every drone.
      hit: (s) => self.shot(s || self.sim),
      // A heat-seeker's strike.
      shot: (s) => self.shot(s || self.sim),
    });
  }

  place(dt) {
    this.a += (this.speed / this.r) * dt * this.dir;
    const x = this.centre.x + Math.sin(this.a) * this.r;
    const z = this.centre.z + Math.cos(this.a) * this.r;
    this.pos.set(x, this.y + Math.sin(this.t * 0.35 + this.a) * 18, z);
    // Tangent of the circle: where it is going.
    this.vel.set(Math.cos(this.a) * this.speed * this.dir, 0, -Math.sin(this.a) * this.speed * this.dir);
    this.heading = ((Math.atan2(this.vel.x, -this.vel.z) * 180) / Math.PI + 360) % 360;
    const floor = Math.max(0, heightAt(x, z)) + 60;
    if (this.pos.y < floor) this.pos.y = floor;
    this.model.position.copy(this.pos);
    this.model.rotation.set(0, -this.heading * D2R, Math.sin(this.a * 3) * 0.08);
  }

  update(dt) {
    if (!this.alive) return;
    this.t += dt;
    this.place(dt);
    if (this.model.userData.tick) this.model.userData.tick(this.t);
  }

  shot(sim) {
    if (!this.alive) return false;
    this.alive = false;
    explode(sim || this.sim, standoff(sim || this.sim, this.pos), { kind: 'airburst', size: 0.9 });
    this.dispose();
    return true;
  }

  dispose() {
    this.alive = false;
    unregisterBody(this.body);
    Fly.disposeModel(this.model);
  }
}

/**
 * Put `n` practice drones out ahead: orange and white, unmanned, circling
 * a point 2 km in front of the nose. Returns the list.
 */
export function spawnTargets(sim, n = 3) {
  if (!sim || !sim.aircraft || !sim.scene) return [];
  clearTargets();
  const ac = sim.aircraft;
  const h = (ac.heading || 0) * D2R;
  const ahead = 2100;
  const cx = ac.pos.x + Math.sin(h) * ahead;
  const cz = ac.pos.z - Math.cos(h) * ahead;
  const ground = Math.max(0, heightAt(cx, cz));
  const baseY = Math.max(ground + 260, ac.pos.y + 20);
  for (let i = 0; i < n; i++) {
    const d = new PracticeDrone(sim, new THREE.Vector3(cx, 0, cz), {
      radius: 700 + i * 160,
      y: baseY + (i - (n - 1) / 2) * 90,
      phase: (i / n) * Math.PI * 2 + 0.4,
      dir: i % 2 ? -1 : 1,
      speed: 50 + i * 4,
    });
    S.practice.push(d);
  }
  say(`${n} practice target drones out ahead — hold one in the circle until the box goes red`, 'info', 5);
  return S.practice.slice();
}

export function clearTargets() {
  for (const d of S.practice) d.dispose();
  S.practice.length = 0;
}

/* ------------------------------------------------------------------ *
 * Firing
 * ------------------------------------------------------------------ */

const STATION_AT = new THREE.Vector3();

function aimAtCand(c) {
  return (out) => {
    const p = c.ref && c.ref.pos ? c.ref.pos : c.pos;
    if (c.ref && (c.ref.gone || c.ref.alive === false)) return false;
    const v = c.kind === 'player' ? (c.ref && c.ref.vel) || c.vel : velOf(c.ref || c, 0);
    out.x = p.x; out.y = p.y; out.z = p.z;
    out.vx = (v && v.x) || 0; out.vy = (v && v.y) || 0; out.vz = (v && v.z) || 0;
    return true;
  };
}

/**
 * Fire at the locked target. Returns { ok, why, missile }. A press with no
 * lock, or none left, says so and costs nothing.
 */
export function fire(sim = S.sim, via = 'key') {
  if (!sim) return { ok: false, why: 'no game' };
  if (!isArmed(sim)) {
    if (flying(sim) && !onFoot(sim)) say('This aeroplane carries no missiles — the military jets do.', 'info', 3);
    return { ok: false, why: 'unarmed' };
  }
  const ac = sim.aircraft;
  if (ac.onGround) {
    say('Take off first — the seeker needs the sky.', 'info', 2.5);
    return { ok: false, why: 'on the ground' };
  }
  if (S.load.left <= 0) {
    say(`${S.load.label} — out of missiles. Land and stop at an airbase or a carrier to rearm.`, 'warn', 4);
    return { ok: false, why: 'empty' };
  }
  const lk = S.lock;
  if (!lk.locked || !lk.target) {
    S.stats.noLock++;
    say('NO LOCK — hold a target drone in the circle until the box turns red', 'info', 3);
    return { ok: false, why: 'no lock' };
  }
  const cand = lk.target;
  if (!S.load.fire()) return { ok: false, why: 'empty' };
  S.stats.fired++;

  // Off the pylon it hung on.
  const st = takeStation(STATION_AT);
  const origin = st ? STATION_AT : _v.copy(ac.pos);
  forwardOf(ac.quat, _fwd);
  const out = { x: origin.x, y: origin.y, z: origin.z };
  const vel = { x: ac.vel.x + _fwd.x * 22, y: ac.vel.y + _fwd.y * 22 - 6, z: ac.vel.z + _fwd.z * 22 };
  const m = launchMissile({
    pos: out,
    vel,
    params: R.FLIGHT.player,
    owner: ME,
    label: cand.name,
    target: { id: cand.id, owner: cand.kind === 'player' ? `p${cand.playerId}` : `t:${cand.id}`, aim: aimAtCand(cand), g: () => lateralG(cand) },
    onEnd: (mm, why) => ended(sim, mm, why, cand),
  });
  m.cand = cand;
  if (cand.kind === 'player' && inGame()) ch.send('hs:launch', { t: cand.playerId }, { self: false });
  say(`${S.load.label} — missile away${cand.kind === 'player' ? '' : ' on ' + cand.name}`, 'good', 2.5);
  syncRig(sim);
  S.pending = false;
  // One missile, one target: the lock starts over.
  lk.reset();
  return { ok: true, missile: m, via };
}

/** How hard a target is turning, in g — a flare works better behind a hard break. */
function lateralG(c) {
  const v = c.kind === 'player' ? (c.ref && c.ref.vel) || c.vel : velOf(c.ref || c, 0);
  const sp = Math.hypot(v.x || 0, v.z || 0);
  if (!(sp > 5)) return 0;
  const e = (S.vel.get(c) || { h: null, t: 0 });
  const h = Math.atan2(v.x, -v.z);
  let g = 0;
  if (e.h != null && HS.clock > e.t) {
    let dh = h - e.h;
    while (dh > Math.PI) dh -= 2 * Math.PI;
    while (dh < -Math.PI) dh += 2 * Math.PI;
    g = Math.abs(dh / (HS.clock - e.t)) * sp / 9.80665;
  }
  e.h = h;
  e.t = HS.clock;
  S.vel.set(c, e);
  return g;
}

function ended(sim, m, why, cand) {
  if (why === 'hit') {
    if (cand.kind === 'player') claimPlayerHit(sim, m, cand);
    else killBody(sim, m, cand);
  } else if (why === 'decoyed') {
    S.stats.decoyed++;
    say('The missile took a flare — it missed', 'info', 3);
  } else if (why === 'lost' || why === 'spent') {
    S.stats.lost++;
    say('The missile lost its target', 'info', 2.5);
  }
}

/** A drone struck: its own airburst, its own tally. */
function killBody(sim, m, cand) {
  const b = cand.ref;
  S.stats.kills++;
  if (b && !b.gone) {
    if (typeof b.shot === 'function') b.shot(sim, { by: ME, at: m.s });
    else if (typeof b.hit === 'function') b.hit(sim, { by: ME });
  } else {
    explode(sim, standoff(sim, { x: m.s.x, y: m.s.y, z: m.s.z }), { kind: 'airburst', size: 0.9 });
  }
  say('Target destroyed — the drone is down', 'good', 3);
}

/* ------------------------------------------------------------------ *
 * PvP: a missile that hits a player is the PvP tag, judged by the host
 * ------------------------------------------------------------------ */

function claimPlayerHit(sim, m, cand) {
  if (!inGame()) return;
  // The missile went off beside them: a small bang everybody sees, the tag itself is the host's word.
  explode(sim, standoff(sim, { x: m.s.x, y: m.s.y, z: m.s.z }), { kind: 'airburst', size: 0.45 });
  S.stats.claims++;
  ch.toHost('pvp:msl', { t: cand.playerId });
}

/* ------------------------------------------------------------------ *
 * Flares
 * ------------------------------------------------------------------ */

export function canFlare(sim = S.sim) {
  return !!(sim && flying(sim) && !onFoot(sim) && S.flare.left > 0 && S.flare.cool <= 0);
}

export function dropFlares(sim = S.sim, via = 'key') {
  if (!sim || !flying(sim)) return { ok: false, why: 'not flying' };
  if (S.flare.max <= 0) {
    say('No flares aboard.', 'info', 2.5);
    return { ok: false, why: 'none' };
  }
  if (S.flare.left <= 0) {
    say('Out of flares — land and stop at a base to restock.', 'warn', 3);
    return { ok: false, why: 'empty' };
  }
  if (S.flare.cool > 0) return { ok: false, why: 'cooling' };
  const ac = sim.aircraft;
  S.flare.left--;
  S.flare.cool = 0.8;
  S.stats.flares++;
  const salvo = deployFlares(ME, ac.pos, ac.vel, { count: 2 });
  if (inGame()) ch.send('hs:flare', {});
  say(`Flares away — ${S.flare.left} left`, 'info', 2);
  return { ok: true, salvo, via };
}

/** The disaster hands everybody flares; a military jet already has them. */
export function grantFlares(sim, n = R.FLARE_CHARGES) {
  S.flare.max = Math.max(S.flare.max, n);
  S.flare.left = Math.max(S.flare.left, n);
}

/** The disaster is over: an aeroplane that is not military has no flares again; a military jet keeps its own. */
export function revokeFlares(sim) {
  const own = carriesMissiles(sim) ? R.FLARE_CHARGES : 0;
  S.flare.max = own;
  S.flare.left = Math.min(S.flare.left, own);
}

/* ------------------------------------------------------------------ *
 * Somebody else's launch and flares, in a lobby
 * ------------------------------------------------------------------ */

function playerById(id) {
  return ch.players().find((p) => p.id === id) || null;
}

ch.on('hs:launch', (d, from) => {
  if (!from || from.id === mp.meId || !S.sim || !flying(S.sim)) return;
  const shooter = playerById(from.id);
  if (!shooter || !shooter.pos || !HS.group) return;
  S.stats.remote++;
  const targetMe = d.t === mp.meId;
  const tgt = targetMe ? null : playerById(d.t);
  if (!targetMe && !(tgt && tgt.pos)) return;
  const q = shooter.quat ? new THREE.Quaternion(shooter.quat.x, shooter.quat.y, shooter.quat.z, shooter.quat.w) : _q.identity();
  forwardOf(q, _fwd);
  const sv = shooter.vel || { x: 0, y: 0, z: 0 };
  const sim = S.sim;
  launchMissile({
    pos: { x: shooter.pos.x, y: shooter.pos.y - 1.5, z: shooter.pos.z },
    vel: { x: sv.x + _fwd.x * 40, y: sv.y + _fwd.y * 40 - 6, z: sv.z + _fwd.z * 40 },
    params: R.FLIGHT.player,
    owner: 'remote',
    cosmetic: true,
    label: shooter.name || 'a player',
    target: targetMe
      ? { id: 'me', owner: ME, aim: (o) => { const a = sim.aircraft; o.x = a.pos.x; o.y = a.pos.y; o.z = a.pos.z; o.vx = a.vel.x; o.vy = a.vel.y; o.vz = a.vel.z; return true; }, g: () => Math.max(0, Math.sqrt(Math.max(0, (sim.aircraft.gLoad || 1) ** 2 - 1))) }
      : { id: `p${d.t}`, owner: `p${d.t}`, aim: (o) => { const p = playerById(d.t); if (!p || !p.pos) return false; const v = p.vel || { x: 0, y: 0, z: 0 }; o.x = p.pos.x; o.y = p.pos.y; o.z = p.pos.z; o.vx = v.x; o.vy = v.y; o.vz = v.z; return true; } },
    onEnd: () => {},
  });
  if (targetMe) {
    const w = who(from.id);
    say(`MISSILE LAUNCH from ${w.name} — pop flares and break!`, 'warn', 4);
  }
});

ch.on('hs:flare', (d, from) => {
  if (!from || from.id === mp.meId || !HS.group) return;
  const p = playerById(from.id);
  if (!p || !p.pos) return;
  deployFlares(`p${from.id}`, p.pos, p.vel || { x: 0, y: 0, z: 0 }, { count: 2 });
});

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

const hudCtx = { w: 0, h: 0 };

function project(pos, camera, out) {
  _p.set(pos.x, pos.y, pos.z).project(camera);
  hudCtx.w = window.innerWidth;
  hudCtx.h = window.innerHeight;
  out.x = (_p.x * 0.5 + 0.5) * hudCtx.w;
  out.y = (-_p.y * 0.5 + 0.5) * hudCtx.h;
  out.front = _p.z < 1 && _p.z > -1;
  out.inside = out.front && out.x > -40 && out.x < hudCtx.w + 40 && out.y > -40 && out.y < hudCtx.h + 40;
  return out;
}

const SCR = { x: 0, y: 0, front: false, inside: false };

function ringRadius(camera, h) {
  return (Math.tan(R.SEEKER.halfDeg * D2R) / Math.tan((camera.fov * D2R) / 2)) * (h / 2);
}

function keyLabel(action, sim) {
  return keyName(action, sim);
}

function paintHud(sim) {
  const ac = sim.aircraft;
  const cam = sim.camera;
  const armed = S.armed;
  const wantPanel = armed || S.flare.max > 0;
  const lk = S.lock;
  const left = S.load.left;
  UI.setPanel({
    show: wantPanel,
    msl: armed,
    left: armed ? left : 0,
    max: R.LOADOUT,
    flares: S.flare.max > 0 ? S.flare.left : null,
    fireKey: keyLabel('fireMissile', sim),
    flareKey: keyLabel('flares', sim),
    state: armed ? (left <= 0 ? 'rearm at a base' : lk.locked ? 'locked' : lk.target ? 'acquiring' : 'seeking') : '',
    locked: armed && lk.locked,
  });
  UI.setButtons({ fire: armed, flares: S.flare.max > 0 });
  if (armed && cam) {
    // The seeker's circle where the nose points.
    _v.copy(ac.pos).addScaledVector(forwardOf(ac.quat, _fwd), AIM_DIST);
    project(_v, cam, SCR);
    // Not on the ground: lined up on the runway it only cluttered the view (the owner's screenshot, 2026-10-27).
    UI.setSeeker(SCR.front && SCR.inside && left > 0 && !ac.onGround, SCR.x, SCR.y, ringRadius(cam, hudCtx.h));
    // With a target picked by the lock key the gunsight draws the one box (./gunsight.js), in the colour this lock is in.
    if (lk.target && left > 0 && S.prefer === null) {
      project(lk.target.pos, cam, SCR);
      const km = lk.range >= 1000 ? `${(lk.range / 1000).toFixed(1)} km` : `${Math.round(lk.range)} m`;
      UI.setLock(SCR.front && SCR.inside, SCR.x, SCR.y, lk.locked ? 'locked' : 'acquire', lk.locked ? 1 : lk.progress, lk.locked ? `LOCKED ${km}` : `LOCK ${Math.round(lk.progress * 100)}%`);
    } else {
      UI.setLock(false);
    }
  } else {
    UI.setSeeker(false, 0, 0, 0);
    UI.setLock(false);
  }
}

function mayShow(sim) {
  if (!sim || sim.state !== 'flying') return false;
  const hud = sim.hud;
  if (hud && (hud.hidden || hud.enabled === false)) return false;
  if (sim.menus && sim.menus.current) return false;
  return true;
}

function syncShown() {
  const sim = S.sim;
  UI.show(S.shown && mayShow(sim));
}

/* ------------------------------------------------------------------ *
 * The pause menu's Targets fold, and the Free Flight tick
 * ------------------------------------------------------------------ */

function installMenu(sim) {
  const host = sim && sim.menus && sim.menus.screens && sim.menus.screens.pause;
  if (!host || typeof host.querySelector !== 'function') return;
  let fold = host.querySelector('[data-hsk-fold]');
  if (!fold) {
    const after = host.querySelector('[data-natural-fold]');
    if (!after || !after.parentNode) return;
    fold = document.createElement('details');
    fold.className = 'pause-fold';
    fold.setAttribute('data-hsk-fold', '');
    fold.hidden = true;
    fold.innerHTML = `<summary>Targets</summary>
      <p class="trigger-note">Orange practice drones for the heat-seekers. Military jets carry three: hold a drone in the circle until the box turns red (or press Home to lock one), then fire. Land and stop at a base to rearm.</p>
      <div class="trigger-grid">
        <button class="trigger-btn" data-hsk-spawn type="button"><span>Practice target drones<small>Put three out ahead of you</small></span></button>
        <button class="trigger-btn" data-hsk-clear type="button"><span>Clear the targets<small>Take them away again</small></span></button>
      </div>`;
    after.parentNode.insertBefore(fold, after.nextSibling);
    fold.addEventListener('click', (e) => {
      const s = e.target.closest('[data-hsk-spawn]');
      const c = e.target.closest('[data-hsk-clear]');
      if (s) {
        if (!(flying(S.sim) || (S.sim && S.sim.state === 'paused'))) return;
        spawnTargets(S.sim, 3);
        if (S.sim.state === 'paused' && typeof S.sim.resume === 'function') S.sim.resume();
      } else if (c) {
        clearTargets();
      }
    });
  }
  fold.hidden = !(sim.mode === 'free');
}

/* ------------------------------------------------------------------ *
 * The plug-in
 * ------------------------------------------------------------------ */

function resetFlight(sim) {
  S.prefer = null;
  S.load.rearm();
  S.rearm.reset();
  S.lock.reset();
  S.pending = false;
  S.flightT = 0;
  S.flare.left = carriesMissiles(sim) ? R.FLARE_CHARGES : 0;
  S.flare.max = S.flare.left;
  S.flare.cool = 0;
  S.stats.fired = 0;
  clearWorld();
  clearTargets();
}

registerExtension({
  id: 'heatseek',

  install(sim) {
    S.sim = sim;
    UI.ensureHud({ fire: () => fire(S.sim, 'touch'), flares: () => dropFlares(S.sim, 'touch') });
    installMenu(sim);
    // The overlay sits above the menus, so while paused (update() is not running) a slow watcher keeps it down.
    if (!S.watch && typeof setInterval === 'function') S.watch = setInterval(syncShown, 250);
  },

  buildWorld(sim, group) {
    S.sim = sim;
    ensureWorld(sim, group);
    S.rig = null;
    // Drones belong to the world that is going: they leave the sky list with it.
    clearTargets();
  },

  startMode(sim, mode, opts) {
    S.sim = sim;
    dropRig();
    resetFlight(sim);
    installMenu(sim);
    // "Practice target drones" ticked on the Free Flight screen.
    if (mode === 'free' && opts && opts.practiceTargets) {
      try {
        spawnTargets(sim, 3);
      } catch (e) {
        console.warn('[heatseek] the practice targets could not be put out:', e);
      }
    }
  },

  stop(sim, why) {
    // Back on the runway is a new start: the rack is full again.
    if (why === 'airport') {
      S.load.rearm();
      S.flare.left = S.flare.max;
      clearWorld();
    } else {
      clearWorld();
      clearTargets();
      dropRig();
    }
    S.lock.reset();
    S.prefer = null;
    UI.setLock(false);
    UI.setSeeker(false, 0, 0, 0);
    UI.setThreats([], 1, 1);
    UI.setAlert('');
    UI.setGlow(0, 0);
    S.shown = false;
    syncShown();
  },

  update(sim, dt) {
    S.sim = sim;
    S.frameId++;
    S.flightT += dt;
    S.flare.cool = Math.max(0, S.flare.cool - dt);
    S.armed = isArmed(sim);
    for (const d of S.practice) d.update(dt);
    for (let i = S.practice.length - 1; i >= 0; i--) if (!S.practice[i].alive) S.practice.splice(i, 1);

    syncRig(sim);
    updateWorld(dt, sim);

    const ac = sim.aircraft;
    if (S.armed) {
      // Rearm: on the ground, on made ground, stopped.
      const atBase = isPaved(ac.pos.x, ac.pos.z);
      const needs = S.load.left < S.load.max || S.flare.left < S.flare.max;
      if (S.rearm.update(dt, { onGround: ac.onGround, speed: ac.groundSpeed || 0, atBase, needs })) {
        S.load.rearm();
        S.flare.left = S.flare.max;
        S.stats.rearmed++;
        syncRig(sim);
        say(`Rearmed — ${S.load.label}${S.flare.max ? ` · flares ${S.flare.left}` : ''}`, 'good', 3.5);
      }
      // The lock.
      validTargets(sim, dt, S.cands);
      forwardOf(ac.quat, _fwd);
      if (S.load.left > 0 && !ac.onGround) {
        const before = S.lock.locked;
        S.lock.update(dt, ac.pos, _fwd, S.cands, S.prefer);
        if (S.lock.locked && !before) say(`LOCKED — press ${keyLabel('fireMissile', sim)} to fire`, 'good', 3);
      } else {
        S.lock.reset();
      }
    } else {
      S.lock.reset();
      S.rearm.reset();
    }

    S.shown = S.armed || S.flare.max > 0 || (S.hooks.disaster ? S.hooks.disaster.active() : false);
    if (S.shown) paintHud(sim);
    else if (S.wasShown) {
      // Nothing to show any more (a new aeroplane, the disaster over): take the parts down, not just the frame.
      UI.setPanel({ show: false });
      UI.setButtons({ fire: false, flares: false });
      UI.setSeeker(false, 0, 0, 0);
      UI.setLock(false);
    }
    S.wasShown = S.shown;
    if (S.hooks.disaster && S.hooks.disaster.paint) S.hooks.disaster.paint(sim, dt);
    syncShown();
  },

  key(sim, code, down, e) {
    if (!down || (e && e.repeat)) return false;
    if (isKey(sim, 'fireMissile', code)) {
      if (!isArmed(sim)) return false;
      fire(sim, 'key');
      return true;
    }
    if (isKey(sim, 'flares', code)) {
      if (!flying(sim) || onFoot(sim) || S.flare.max <= 0) return false;
      dropFlares(sim, 'key');
      return true;
    }
    return false;
  },

  devActions: [
    {
      label: 'Practice target drones',
      hint: 'Puts three orange practice drones out ahead of you for the heat-seekers (a military jet, in Free Flight).',
      run(sim) {
        if (sim && sim.state === 'flying') spawnTargets(sim, 3);
      },
    },
  ],
});

/**
 * The lock key (../gunsight.js) picked a target: from now the seeker works on
 * that one only (or, if it is a meteor, not at all). Null: the seeker looks
 * for itself again.
 */
export function setPrefer(id) {
  S.prefer = id === undefined ? null : id;
  if (S.lock.target && S.prefer !== null && S.lock.target.id !== S.prefer) S.lock.reset();
}

/** The Heat-Seeker disaster plugs its panel and its flares in here. */
export function setDisasterHook(h) {
  S.hooks.disaster = h || null;
}

/** For the tests and the console. */
export const heatseek = {
  get S() {
    return S;
  },
  get armed() {
    return S.armed;
  },
  get left() {
    return S.load.left;
  },
  get max() {
    return S.load.max;
  },
  get label() {
    return S.load.label;
  },
  get flares() {
    return S.flare;
  },
  get lock() {
    return S.lock;
  },
  get prefer() {
    return S.prefer;
  },
  setPrefer,
  get practice() {
    return S.practice;
  },
  get stats() {
    return { ...S.stats };
  },
  get world() {
    return HS;
  },
  get rig() {
    return S.rig;
  },
  get notes() {
    return S.notes.slice();
  },
  fire,
  dropFlares,
  grantFlares,
  revokeFlares,
  spawnTargets,
  clearTargets,
  validTargets: (sim = S.sim) => validTargets(sim, 0, []),
  net,
  carriesMissiles,
  liveMissiles,
  hud: UI,
  snapshot: () => UI.snapshot(),
};

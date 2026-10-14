/**
 * DISASTER TROLLS — "I can also launch any natural disaster on them, that
 * targets them for however long I like, and everyone else can see it and
 * maybe get hit by it".
 *
 * In the owner's troll row (./trolls.js, "⚡ Disasters ▸"): pick a player, pick
 * ANY disaster the game has — every one in src/game/disasters.js that a player
 * may arm (the tornado, the microburst, the typhoon, the storm cell, the fog
 * bank, the bird strike, the lightning storm, the volcanic ash, and the
 * wildfire that src/features/wildfire-disaster.js adds there) and the meteor
 * shower from the shared world's Summon menu (../mpworld.js) — pick how long
 * (presets and a slider, 10 s to 10 min, or "until I stop it"), GO. A STOP
 * NOW button on the row, and STOP ALL at the foot of the list.
 *
 * IT FOLLOWS THEM. Four of them hunt the target; the rest are weather, which
 * is everywhere at once:
 *   tornado      touches down near them and chases them (a steady 28 m/s, so
 *                it can be outrun — just) for as long as it lasts;
 *   lightning    a storm overhead, and a strike beside them every few
 *                seconds — anybody within 140 m of a strike loses their
 *                instruments for a while, as a strike does in the game;
 *   meteors      a shower, with a rock aimed at where they are going every
 *                few seconds — the game's own near-miss / bonk rules apply to
 *                whoever is there;
 *   wildfire     a fire is lit on the land under their path every fifteen
 *                seconds (on the nearest land if they are over the sea).
 *
 * ADMINS TOO ("troll thing for admin"). An admin (the host checked the admin
 * key) sends them on plain players, with the same durations, the same caps
 * and the same STOP NOW — and never on the owner or on another admin (common.js
 * mayTroll; only the owner sends one at an admin). The owner always wins a
 * clash: an admin cannot replace a disaster the owner has running on a
 * player, cannot stop one of the owner's, and cannot take the last of the
 * three places in the game (they get two between them); and the host ends a
 * disaster by itself when whoever sent it has left or lost their powers (the
 * owner's hour is up), so "until I stop it" never runs with nobody to stop it.
 *
 * IT IS THE SHARED WORLD'S. Exactly as ../mpworld.js does it: the owner (or an
 * admin) asks the host ('owner:dis'); the host checks for itself who is asking
 * and whom (the pass, session.js isOwner, or the admin key it checked at the
 * door; common.js hostMayTroll), caps it (one per target — a new one
 * replaces the old —, three in the game at once), and tells everybody
 * ('owner:disgo'); every copy starts the disaster itself, from the game's own
 * code, so it is on every screen. The HOST runs the hunting: where its tornado
 * is, where a strike lands, where a meteor is aimed, where the fire is lit
 * ('owner:disat', a few numbers, at most twice a second), and every copy
 * follows that, so it is the same storm for everybody and anybody near can be
 * hit by it — blown around by the tornado, struck, bonked by a rock: the
 * game's normal, kid-safe outcomes. It ends on the host's clock
 * ('owner:disend'), or at STOP NOW, on every screen at once; every copy also
 * has its own deadline in case the host's word is lost.
 *
 * Everything on the wire: a disaster's id from the game's own list, player
 * ids, seconds, metres. Nothing anybody could type.
 */

import * as THREE from '../../vendor/three.module.js';
import { registerExtension } from '../../game/extensions.js';
import { NATURAL_EVENTS, findEvent } from '../../game/disasters.js';
import { SUMMON, landNear } from '../mpworld.js';
import { spawnMeteor } from '../meteor.js';
import { startWildfireAt } from '../wildfire-disaster.js';
import { wildfireDebug } from '../wildfire.js';
import { heightAt } from '../../world/terrain.js';
import { mp, ch, ride, inGame, who, esc, feed } from '../mpplay/shared.js';
import { hostRole, hostMayTroll, ROLE_RANK, amStaffInGame, mayTroll, myRole, playerOf, rosterRole, byWho, placeOf, nameOf, isId, num, now, showTag, tellWait, OWNER_GOLD } from './common.js';
import { Bolts } from './fx.js';

/** The duration buttons: seconds, 0 for "until I stop it". The slider runs MIN_S..MAX_S. */
export const PRESETS = Object.freeze([10, 30, 60, 120, 300, 0]);
export const MIN_S = 10;
export const MAX_S = 600;
/** How long "until I stop it" runs if nobody ever does. */
export const UNTIL_STOPPED_S = 3600;
/** Disasters in a game at once. */
export const GLOBAL_CAP = 3;
/** The tornado's chase, m/s — a light aeroplane outruns it, just. */
export const TORNADO_CHASE = 28;
/** A strike takes the instruments of anybody this near it. */
export const STRIKE_R = 140;
export const STRIKE_EVERY_S = [5, 11];
export const METEOR_EVERY_S = [3, 5];
export const IGNITE_EVERY_S = 15;
/** The host says where its hunt is this often. */
export const AT_EVERY_MS = 500;
/** Places in the game an admin can hold between them: the owner keeps the last one. */
export const ADMIN_CAP = GLOBAL_CAP - 1;
/** The host looks at who sent what it runs this often (the sender left, or lost their powers). */
export const SWEEP_EVERY_MS = 1000;
/** The ones that hunt the target; everything else is weather, everywhere. */
export const HUNTERS = Object.freeze(['tornado', 'lightning', 'meteors', 'wildfire']);

const ICONS = { birdStrike: '🐦', ashCloud: '🌋' };
for (const s of SUMMON) ICONS[s.id] = s.icon;

/** The disasters the owner may send, from the game's own lists, with a picture a kid can find. */
export function trollDisasters() {
  const list = NATURAL_EVENTS.filter((e) => !e.hidden).map((e) => ({ id: e.id, name: e.name, hint: e.hint || '', icon: ICONS[e.id] || '🌩️' }));
  const m = SUMMON.find((s) => s.id === 'meteors');
  if (m) list.push({ id: 'meteors', name: m.name || 'Meteor shower', hint: m.hint || '', icon: m.icon });
  return list;
}
export const isDisaster = (id) => typeof id === 'string' && (id === 'meteors' || !!(findEvent(id) && !findEvent(id).hidden));
export function disasterName(id) {
  const d = trollDisasters().find((x) => x.id === id);
  return d ? d.name : id;
}
export function secsLabel(s) {
  if (!s) return 'until I stop it';
  if (s < 60) return `${s} s`;
  return s % 60 ? `${Math.floor(s / 60)} min ${s % 60} s` : `${s / 60} min`;
}

/* ---- what may travel ------------------------------------------------------------------- */

const secsOk = (s) => Number.isInteger(s) && (s === 0 || (s >= MIN_S && s <= MAX_S));
const nOk = (n) => Number.isInteger(n) && n >= 1 && n <= 1e6;

export function cleanAsk(d) {
  return d && isDisaster(d.id) && isId(d.t) && secsOk(d.s) ? { id: d.id, t: d.t, s: d.s } : null;
}
export function cleanGo(d) {
  const c = cleanAsk(d);
  return c && isId(d.by) && nOk(d.n) ? { ...c, by: d.by, n: d.n } : null;
}
export function cleanStop(d) {
  return d && Number.isInteger(d.n) && d.n >= 0 && d.n <= 1e6 ? { n: d.n } : null;
}
export function cleanEnd(d) {
  return d && nOk(d.n) ? { n: d.n } : null;
}
/** The host's hunt: k 0 the tornado's place, 1 a strike, 2 a meteor, 3 a fire. */
export function cleanAt(d) {
  if (!d || !nOk(d.n) || !Number.isInteger(d.k) || d.k < 0 || d.k > 3 || !num(d.x) || !num(d.z)) return null;
  const out = { n: d.n, k: d.k, x: Math.round(d.x), z: Math.round(d.z) };
  if (d.k === 2) {
    if (!num(d.y, 2e4) || !num(d.a, 360) || !num(d.dv, 90) || !num(d.v, 400) || !num(d.T, 20) || d.v < 50 || d.T < 1) return null;
    Object.assign(out, { y: Math.round(d.y), a: Math.round(d.a), dv: Math.round(d.dv), v: Math.round(d.v), T: Math.round(d.T * 10) / 10 });
  }
  return out;
}

ch.define('owner:dis', { validate: cleanAsk, rate: 2 });
ch.define('owner:disgo', { from: 'host', validate: cleanGo, rate: 4 });
ch.define('owner:disstop', { validate: cleanStop, rate: 2 });
ch.define('owner:disend', { from: 'host', validate: cleanEnd, rate: 4 });
ch.define('owner:disat', { from: 'host', validate: cleanAt, rate: 8 });

/* ---- the host --------------------------------------------------------------------------- */

/**
 * What the host keeps: which disasters run, on whom, until when. A class, so
 * the node test can run it with its own clock and no game.
 */
export class DisasterDesk {
  constructor(clock = now, { cap = GLOBAL_CAP, adminCap = cap - 1 } = {}) {
    this.now = clock;
    this.cap = cap;
    /** How many an admin's can fill: the owner's rank (2) gets all of `cap`, an admin's (1) gets `adminCap`. */
    this.adminCap = adminCap;
    this.seq = 0;
    this.running = new Map();
  }

  /**
   * The owner or an admin asks (`rank`: 2 the owner, 1 an admin): { ok, n,
   * replaced } or { ok: false, why }. why 'cap': the game is full (for an
   * admin, full to `adminCap`, which leaves the owner a place); why 'held': a
   * player who has a bigger name's disaster on them cannot have it replaced.
   */
  ask({ id, t, s, by, rank = 2 }, t0 = this.now()) {
    const old = [...this.running.values()].find((r) => r.t === t);
    if (old && (old.rank || 2) > rank) return { ok: false, why: 'held' };
    // Replacing one needs no new place; a new target needs one — and an admin cannot take the last (the owner's).
    if (!old && this.running.size >= (rank >= 2 ? this.cap : this.adminCap)) return { ok: false, why: 'cap' };
    if (old) this.running.delete(old.n);
    const n = ++this.seq;
    const life = s || UNTIL_STOPPED_S;
    this.running.set(n, { n, id, t, s, by, rank, at: t0, until: t0 + life * 1000 });
    return { ok: true, n, replaced: old ? old.n : 0 };
  }

  /**
   * STOP NOW (n) or STOP ALL by `by` (n = 0): the ones ended. A disaster is
   * stopped by whoever sent it, or by someone of at least its sender's rank
   * (the owner stops any; an admin cannot stop the owner's).
   */
  stop(n, by, rank = 2) {
    const out = [];
    for (const r of [...this.running.values()]) {
      if ((n === 0 && r.by === by) || (r.n === n && (r.by === by || rank >= (r.rank || 2)))) {
        this.running.delete(r.n);
        out.push(r.n);
      }
    }
    return out;
  }

  /** The ones whose sender is not `valid` any more (left, or lost their powers) — skipping any marked `kept` — ended and returned. */
  sweep(valid) {
    const out = [];
    for (const r of [...this.running.values()]) {
      if (!r.kept && !valid(r.by)) {
        this.running.delete(r.n);
        out.push(r.n);
      }
    }
    return out;
  }

  /** The ones whose time is up at t. */
  due(t = this.now()) {
    const out = [];
    for (const r of [...this.running.values()]) {
      if (t >= r.until) {
        this.running.delete(r.n);
        out.push(r.n);
      }
    }
    return out;
  }

  onTarget(t) {
    return [...this.running.values()].find((r) => r.t === t) || null;
  }

  clear() {
    this.running.clear();
  }
}

const D = {
  sim: null,
  group: null,
  bolts: null,
  desk: new DisasterDesk(),
  sweepAt: 0,
  /** Every running disaster this copy knows of: n → inst. */
  active: new Map(),
  stats: { asked: 0, started: 0, refused: 0, stopped: 0, ended: 0, in: 0, applied: 0, strikes: 0, hits: 0, meteors: 0, ignites: 0, at: 0, atSent: 0 },
};

function hostEnd(n, why) {
  D.desk.running.delete(n);
  ch.send('owner:disend', { n }, { self: true });
  if (why === 'stop') D.stats.stopped++;
}

ch.on('owner:dis', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !from) return;
  D.stats.asked++;
  // The host's own reading of who is asking and whom: an owner or an admin, aiming at a player their role may troll — or at
  // themselves, which has always been theirs to do. A plain player's ask, an admin's at the owner or at another admin: nothing.
  const role = hostRole(from.id);
  const aimed = d.t === from.id ? !!role && role !== 'player' : hostMayTroll(from.id, d.t);
  if (!aimed || !ch.players().some((p) => p.id === d.t)) {
    D.stats.refused++;
    return;
  }
  const r = D.desk.ask({ ...d, by: from.id, rank: ROLE_RANK[role] });
  if (!r.ok) {
    D.stats.refused++;
    const soonest = Math.min(...[...D.desk.running.values()].map((x) => x.until)) - now();
    tellWait(from.id, Math.max(1000, Math.min(60000, soonest)), r.why === 'held' ? 3 : 1);
    return;
  }
  if (r.replaced) ch.send('owner:disend', { n: r.replaced }, { self: true });
  D.stats.started++;
  ch.send('owner:disgo', { id: d.id, t: d.t, s: d.s, by: from.id, n: r.n }, { self: true });
});

ch.on('owner:disstop', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !from) return;
  const role = hostRole(from.id);
  if (role !== 'owner' && role !== 'admin') return;
  for (const n of D.desk.stop(d.n, from.id, ROLE_RANK[role])) hostEnd(n, 'stop');
});

/** The owner's copy, or an admin's (the host judges whom). */
export function sendDisaster(id, t, s) {
  if (!amStaffInGame() || !cleanAsk({ id, t, s })) return false;
  // This copy's own reading of the roster, so the menu does not send what the host will only refuse (aiming at yourself is allowed).
  if (t !== mp.meId && !mayTroll(myRole(), rosterRole(playerOf(t)))) return false;
  return ch.toHost('owner:dis', { id, t, s });
}
export function sendStop(n = 0) {
  if (!amStaffInGame()) return false;
  return ch.toHost('owner:disstop', { n });
}

/* ---- everybody ----------------------------------------------------------------------------- */

ch.on('owner:disgo', (d, from) => {
  if (from && from.host) begin(d);
});
ch.on('owner:disend', (d, from) => {
  if (from && from.host) end(d.n, 'host');
});
ch.on('owner:disat', (d, from) => {
  if (from && from.host) at(d);
});

function playing(sim) {
  return !!(sim && sim.mode === 'free' && (sim.state === 'flying' || sim.state === 'paused'));
}

/** One begins here, because the host said so. */
function begin(d) {
  const sim = D.sim;
  D.stats.in++;
  const name = disasterName(d.id);
  const icon = (trollDisasters().find((x) => x.id === d.id) || {}).icon || '';
  const mine = d.t === mp.meId;
  feed(`🃏 <b>${esc(who(d.by).name)}</b> sent ${icon} <b>${esc(name)}</b> after <b>${mine ? 'you' : esc(who(d.t).name)}</b> — ${esc(secsLabel(d.s))}`, OWNER_GOLD);
  // Whose it is, for "the owner stopped it" and for the tag: the roster's reading of the sender, as it stands now.
  const byRole = byWho(d.by);
  const old = D.active.get(d.n);
  if (old) end(d.n, 'again');
  const life = d.s || UNTIL_STOPPED_S;
  const t0 = now();
  const inst = {
    ...d, name, icon, mine, life, byRole, at: t0, deadline: t0 + life * 1000 + 3000, applied: false,
    torAt: null, nextStrike: 2, nextMeteor: 1.5, nextIgnite: 0, nextAt: 0, strikes: 0, hits: 0, meteors: 0, ignites: 0, tagAt: 0,
  };
  D.active.set(d.n, inst);
  if (mine) showTag(`${name} after you`, Math.min(life, 4), d.by);
  if (!playing(sim)) return;
  try {
    apply(sim, inst);
  } catch (err) {
    console.warn('[owner-disasters] could not start', d.id, err);
  }
}

/** Start it in this copy, from the game's own code. */
function apply(sim, inst) {
  const { id, life } = inst;
  const w = sim.weather;
  switch (id) {
    case 'tornado': {
      const p = placeOf(inst.t, sim) || (ride(sim) && ride(sim).pos);
      if (!p || !sim.tornado) return;
      sim.tornado.spawn(p, life, sim.tornadoEF);
      w.vortex = sim.tornado;
      inst.tornado = true;
      break;
    }
    case 'lightning':
      w.temporaryCondition('stormy', life);
      inst.storm = true;
      break;
    case 'meteors':
      if (sim.meteors && !sim.meteors.active) {
        sim.meteors.begin({ mode: 'shower' });
        inst.meteorsMine = true;
      }
      break;
    case 'wildfire':
      // Lit where the host says (at, k 3): nothing to do until then.
      break;
    case 'birdStrike':
      if (inst.mine) {
        const ev = findEvent(id);
        if (ev) ev.apply(sim);
        inst.rough = true;
      }
      break;
    default: {
      const ev = findEvent(id);
      if (!ev) return;
      ev.apply(sim);
      // For as long as the owner said, not the game's own figure.
      if (w._tempCond) w._tempCond.left = life;
      if (w._shear) {
        w._shear.left = life;
        w._shear.total = life;
      }
      if (w._front) w._front.left = life;
      if (id === 'ashCloud') inst.rough = true;
    }
  }
  sim.activeEvents = sim.activeEvents || {};
  sim.activeEvents[id] = life;
  if (sim.menus && typeof sim.menus.syncNatural === 'function') sim.menus.syncNatural(sim.activeEvents);
  inst.applied = true;
  D.stats.applied++;
}

/** Over: on time, at STOP NOW, or replaced. */
function end(n, why) {
  const inst = D.active.get(n);
  if (!inst) return false;
  D.active.delete(n);
  D.stats.ended++;
  const sim = D.sim;
  if (inst.applied && sim) {
    try {
      undo(sim, inst);
    } catch (err) {
      console.warn('[owner-disasters] could not end', inst.id, err);
    }
  }
  if (why !== 'again') feed(`${inst.icon} ${esc(inst.name)} after <b>${inst.mine ? 'you' : esc(who(inst.t).name)}</b> is over${why === 'host' && inst.s === 0 ? ` — ${inst.byRole || 'the owner'} stopped it` : ''}`);
  return true;
}

function undo(sim, inst) {
  const w = sim.weather;
  const ac = sim.aircraft;
  switch (inst.id) {
    case 'tornado':
      if (inst.tornado && sim.tornado && sim.tornado.active) sim.tornado.clear();
      break;
    case 'lightning':
      if (inst.storm && w._tempCond && w._tempCond.id === 'stormy') w._tempCond = null;
      if (sim.hud && sim.hud.notify) sim.hud.notify('The storm has passed', 'good', 3);
      break;
    case 'meteors':
      if (inst.meteorsMine && sim.meteors && sim.meteors.active && sim.meteors.mode === 'shower') sim.meteors.end();
      break;
    case 'wildfire': {
      const W = inst.ignites ? wildfireDebug() : null;
      if (W && W.grid && typeof W.grid.extinguishAll === 'function') {
        W.grid.extinguishAll(true);
        W.flameDirty = true;
      }
      break;
    }
    default:
      if (w._tempCond) w._tempCond = null;
      if (w._shear) w._shear.left = 0;
      if (w._front) w._front.left = 0.01;
  }
  if (inst.rough && ac && ac.failures && ac.failures.roughEngine && typeof sim.toggleFailure === 'function') sim.toggleFailure('roughEngine');
  if (sim.activeEvents) {
    delete sim.activeEvents[inst.id];
    if (sim.menus && typeof sim.menus.syncNatural === 'function') sim.menus.syncNatural(sim.activeEvents);
  }
}

/* ---- the hunt -------------------------------------------------------------------------------- */

const rand = (a, b) => a + Math.random() * (b - a);

/** The host's word on where its hunt is: everybody follows it. */
function at(d) {
  const inst = D.active.get(d.n);
  if (!inst) return;
  D.stats.at++;
  const sim = D.sim;
  switch (d.k) {
    case 0:
      inst.torAt = { x: d.x, z: d.z };
      break;
    case 1:
      if (playing(sim)) strike(sim, inst, d.x, d.z);
      break;
    case 2:
      if (playing(sim)) meteor(sim, inst, d);
      break;
    case 3:
      if (playing(sim)) ignite(sim, inst, d.x, d.z);
      break;
    default:
      break;
  }
}

function strike(sim, inst, x, z) {
  inst.strikes++;
  D.stats.strikes++;
  if (sim.weather) sim.weather.lightningFlash = 1;
  const a = sim.audio;
  if (a && a.available && a.ambience && typeof a.ambience.playThunder === 'function') a.ambience.playThunder();
  if (D.bolts) D.bolts.strike(x, z);
  // Whoever is near it — the target it was aimed beside, or anybody else there — as a strike does in the game.
  const me = ride(sim);
  if (me && me.kind === 'air' && Math.hypot(me.pos.x - x, me.pos.z - z) < STRIKE_R) {
    inst.hits++;
    D.stats.hits++;
    sim.instrumentBlackout = Math.max(sim.instrumentBlackout || 0, 6 + Math.random() * 5);
    if (sim.hud && sim.hud.notify) sim.hud.notify('Struck — instruments out', 'warn', 3);
  }
}

function meteor(sim, inst, d) {
  if (!sim.meteors || !sim.meteors.active) return;
  const m = spawnMeteor({ kind: 'threat', target: new THREE.Vector3(d.x, d.y, d.z), az: d.a, dive: d.dv, speed: d.v, T: d.T, radius: 3.5, size: 1.6, threat: true });
  if (m) {
    inst.meteors++;
    D.stats.meteors++;
  }
}

function ignite(sim, inst, x, z) {
  let lit = false;
  try {
    lit = !!startWildfireAt(sim, { x, z });
  } catch (err) {
    lit = false;
  }
  if (lit) {
    inst.ignites++;
    D.stats.ignites++;
    if (sim.activeEvents) sim.activeEvents.wildfire = Math.max(3, inst.deadline - now()) / 1000;
  }
}

/** Every frame, every copy: the tornado's chase; the host's clocks for its strikes, rocks and fires. */
function tick(sim, dt) {
  const t = now();
  if (ch.isHost && D.desk.running.size) {
    for (const n of D.desk.due(t)) hostEnd(n, 'time');
    // Whoever sent it has left, or the owner's hour is up: it ends, so "until I stop it" is never left with nobody to stop it.
    if (t - D.sweepAt >= SWEEP_EVERY_MS) {
      D.sweepAt = t;
      for (const n of D.desk.sweep((by) => { const r = hostRole(by); return r === 'owner' || r === 'admin'; })) hostEnd(n, 'sender');
    }
  }
  if (D.active.size) {
    for (const inst of [...D.active.values()]) {
      if (t > inst.deadline) {
        end(inst.n, 'time');
        continue;
      }
      if (inst.mine && t - inst.tagAt > 1500) {
        inst.tagAt = t;
        showTag(`${inst.name} after you`, 2.5, inst.by);
      }
      if (!inst.applied) {
        // Into the aeroplane after it started (the menus, the van): start it now.
        if (playing(sim)) {
          try {
            apply(sim, inst);
          } catch (err) {
            inst.applied = true;
          }
        }
        continue;
      }
      hunt(sim, inst, dt, t);
    }
  }
  if (D.bolts) D.bolts.update(dt);
}

const _d = new THREE.Vector3();

function hunt(sim, inst, dt, t) {
  const host = ch.isHost;
  const target = placeOf(inst.t, sim);
  switch (inst.id) {
    case 'tornado': {
      const tor = sim.tornado;
      if (!inst.tornado || !tor || !tor.active) return;
      // Everybody steers at the target they see; the host also says where its funnel is, and the others pull theirs onto that.
      if (target) {
        _d.set(target.x - tor.pos.x, 0, target.z - tor.pos.z);
        const dist = _d.length();
        if (dist > 1) {
          const v = Math.min(TORNADO_CHASE, dist / 3);
          tor.drift.copy(_d.multiplyScalar(v / dist));
        }
      }
      if (host) {
        if (t - inst.nextAt >= AT_EVERY_MS) {
          inst.nextAt = t;
          D.stats.atSent++;
          ch.send('owner:disat', { n: inst.n, k: 0, x: tor.pos.x, z: tor.pos.z });
        }
      } else if (inst.torAt) {
        const off = Math.hypot(inst.torAt.x - tor.pos.x, inst.torAt.z - tor.pos.z);
        if (off > 60) {
          const k = Math.min(1, dt * (off > 400 ? 4 : 1.2));
          tor.pos.x += (inst.torAt.x - tor.pos.x) * k;
          tor.pos.z += (inst.torAt.z - tor.pos.z) * k;
        }
      }
      break;
    }
    case 'lightning':
      if (!host || !target) return;
      inst.nextStrike -= dt;
      if (inst.nextStrike <= 0) {
        inst.nextStrike = rand(STRIKE_EVERY_S[0], STRIKE_EVERY_S[1]);
        ch.send('owner:disat', { n: inst.n, k: 1, x: target.x + rand(-70, 70), z: target.z + rand(-70, 70) }, { self: true });
        D.stats.atSent++;
      }
      break;
    case 'meteors':
      if (!host || !target) return;
      inst.nextMeteor -= dt;
      if (inst.nextMeteor <= 0) {
        inst.nextMeteor = rand(METEOR_EVERY_S[0], METEOR_EVERY_S[1]);
        const T = 6;
        const vel = target.vel || { x: 0, y: 0, z: 0 };
        const sp = Math.hypot(vel.x, vel.y, vel.z);
        const kv = sp > 120 ? 120 / sp : 1;
        const miss = Math.random() < 0.35 ? rand(0, 10) : rand(25, 80);
        const ang = rand(0, Math.PI * 2);
        const x = target.x + vel.x * kv * T + Math.cos(ang) * miss;
        const z = target.z + vel.z * kv * T + Math.sin(ang) * miss;
        const y = Math.max(target.y + vel.y * kv * T, Math.max(0, heightAt(x, z)) + 120);
        ch.send('owner:disat', { n: inst.n, k: 2, x, y, z, a: rand(0, 360), dv: rand(30, 50), v: rand(190, 250), T }, { self: true });
        D.stats.atSent++;
      }
      break;
    case 'wildfire':
      if (!host || !target) return;
      inst.nextIgnite -= dt;
      if (inst.nextIgnite <= 0) {
        inst.nextIgnite = IGNITE_EVERY_S;
        const land = landNear(target.x, target.z, 4000);
        if (land) {
          ch.send('owner:disat', { n: inst.n, k: 3, x: land.x, z: land.z }, { self: true });
          D.stats.atSent++;
        }
      }
      break;
    default:
      break;
  }
}

function endAll(sim, why = 'end') {
  for (const inst of [...D.active.values()]) end(inst.n, why);
  if (ch.isHost) D.desk.clear();
}

ch.on('mp:end', () => {
  endAll(D.sim, 'end');
  D.desk.clear();
});
ch.on('mp:host', () => {
  // The lobby re-formed round this tab: what the old host ran, this one now runs out (its own clock, from what it knew).
  // `kept`: the new host cannot read the old one's roles, so these run out on their own clocks (or at STOP NOW) and are not swept.
  for (const inst of D.active.values()) D.desk.running.set(inst.n, { n: inst.n, id: inst.id, t: inst.t, s: inst.s, by: inst.by, rank: 2, kept: true, at: inst.at, until: inst.deadline - 3000 });
  D.desk.seq = Math.max(D.desk.seq, ...[...D.active.keys()], 0);
});
ch.on('mp:leave', (p) => {
  if (!ch.isHost || !p) return;
  for (const r of [...D.desk.running.values()]) if (r.t === p.id || r.by === p.id) hostEnd(r.n, 'left');
});

/* ---- the menu, in the owner's troll row ---------------------------------------------------- */

let M = null;

/** Whether this copy may stop that one: the owner any, an admin theirs and other admins' — never the owner's (the host judges again). */
function canStop(i) {
  return myRole() === 'owner' || i.by === mp.meId || rosterRole(playerOf(i.by)) !== 'owner';
}

/** The pieces ./trolls.js paints into the player list. */
export const disasterMenu = {
  use(menu) {
    M = menu;
  },
  shape() {
    return [...D.active.values()].map((i) => `${i.n}:${i.id}:${i.t}`).join(',');
  },
  row(p, menu) {
    const m = menu || M;
    if (!m) return '';
    if (!isDisaster(m.dis)) m.dis = 'tornado';
    const list = trollDisasters();
    const picks = list.map((d) => `<button class="${m.dis === d.id ? 'is-on' : ''}" data-mp-own="pick:${esc(d.id)}:${p.id}" title="${esc(d.hint)}">${d.icon} ${esc(d.name)}</button>`).join('');
    const secs = PRESETS.map((s) => `<button class="${m.secs === s ? 'is-on' : ''}" data-mp-own="secs:${s}:${p.id}">${esc(secsLabel(s))}</button>`).join('');
    const slider = `<input type="range" min="${MIN_S}" max="${MAX_S}" step="10" value="${m.secs || MAX_S}" data-mp-own-range aria-label="How long, in seconds"><output>${esc(secsLabel(m.secs))}</output>`;
    const running = [...D.active.values()].filter((i) => i.t === p.id && canStop(i));
    const stops = running.map((i) => `<button class="mp-own-stop" data-mp-own="stop:${i.n}:${p.id}">⏹ STOP NOW — ${i.icon} ${esc(i.name)}</button>`).join('');
    const chosen = list.find((d) => d.id === m.dis) || list[0];
    const hunts = HUNTERS.includes(chosen.id) ? 'It follows them.' : 'Weather: everybody gets it.';
    return `<div class="mp-admrow mp-ownrow" data-mp-ownrow="${p.id}" data-mp-owndis="${p.id}">`
      + `<button class="mp-own-tab" data-mp-own="tab:trolls:${p.id}">◂ Trolls</button>`
      + `<span class="mp-own-group" data-mp-own-picks>${picks}</span>`
      + `<span class="mp-own-group" data-mp-own-secs><small>How long</small>${secs}${slider}</span>`
      + `<button class="mp-own-go" data-mp-own="dis:${p.id}">GO — ${chosen.icon} ${esc(chosen.name)} after ${esc(p.name)}, ${esc(secsLabel(m.secs))}</button>`
      + stops
      + `<span class="mp-own-note">${hunts} Everybody sees it, and anybody near can be hit. One per player, three in the game at once.</span></div>`;
  },
  foot() {
    const mine = [...D.active.values()].filter((i) => i.by === mp.meId);
    if (!mine.length) return '';
    return `<div class="mp-admrow mp-ownrow" data-mp-ownrow="stopall"><b class="mp-admintag mp-ownertag">🃏</b>`
      + `<span>${mine.map((i) => `${i.icon} ${esc(i.name)} after ${esc(nameOf(i.t))}`).join(' · ')}</span>`
      + `<button class="mp-own-stop" data-mp-own="stopall">⏹ STOP ALL</button></div>`;
  },
  /** "pick:tornado:5", "secs:30:5", "dis:5", "stop:12:5", "stopall". */
  act(op, a, b) {
    if (!M) return false;
    switch (op) {
      case 'pick':
        if (isDisaster(a)) M.dis = a;
        return true;
      case 'secs':
        M.secs = secsOk(Number(a)) ? Number(a) : 30;
        return true;
      case 'dis':
        sendDisaster(M.dis, Number(a), M.secs);
        return true;
      case 'stop':
        sendStop(Number(a));
        return true;
      case 'stopall':
        sendStop(0);
        return true;
      default:
        return false;
    }
  },
  /** The slider: the seconds, and its readout, without a repaint while the finger is on it. */
  slid(v, el) {
    if (!M) return;
    const s = Math.max(MIN_S, Math.min(MAX_S, Math.round(v / 10) * 10));
    M.secs = s;
    const out = el && el.nextElementSibling;
    if (out && out.tagName === 'OUTPUT') out.textContent = secsLabel(s);
    const row = el && el.closest('[data-mp-owndis]');
    for (const btn of row ? row.querySelectorAll('[data-mp-own^="secs:"]') : []) btn.classList.toggle('is-on', Number(btn.dataset.mpOwn.split(':')[1]) === s);
    const go = row && row.querySelector('[data-mp-own^="dis:"]');
    if (go) go.textContent = go.textContent.replace(/, [^,]*$/, `, ${secsLabel(s)}`);
  },
};

/* ---- the plug-in --------------------------------------------------------------------------- */

registerExtension({
  id: 'owner-disasters',
  install(sim) {
    D.sim = sim;
    if (typeof window !== 'undefined') window.__ownerDisasters = disastersDebug();
  },
  buildWorld(sim, group) {
    D.sim = sim;
    D.group = group;
    D.bolts = new Bolts(group);
  },
  update(sim, dt) {
    D.sim = sim;
    if (!inGame() && !D.active.size) return;
    tick(sim, dt);
  },
  stop(sim, why) {
    if (why === 'airport') return;
    // The flight ended here: nothing of it is left on; the host's list still runs (its word ends it for everybody).
    for (const inst of [...D.active.values()]) if (inst.applied) {
      try {
        undo(sim, inst);
      } catch (e) {
        /* over */
      }
      inst.applied = false;
    }
  },
});

/** For the checks and the console. */
export function disastersDebug() {
  return {
    D,
    stats: D.stats,
    desk: D.desk,
    list: trollDisasters,
    active: () => [...D.active.values()].map((i) => ({ n: i.n, id: i.id, t: i.t, s: i.s, by: i.by, applied: i.applied, strikes: i.strikes, hits: i.hits, meteors: i.meteors, ignites: i.ignites, torAt: i.torAt })),
    bolts: () => (D.bolts ? { struck: D.bolts.struck, lit: D.bolts.lit } : null),
    /** Begin / end / hunt here and now, as if the host had said so (no network). */
    begin: (d) => begin({ s: 30, by: 0, n: ++D.desk.seq + 1000, t: mp.meId, ...d }),
    end: (n) => end(n, 'host'),
    at,
    send: sendDisaster,
    stop: sendStop,
    endAll: () => endAll(D.sim),
    secsLabel,
  };
}

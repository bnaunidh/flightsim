/**
 * THE OWNER'S TROLL MENU — "in owner mode you should have a bunch of trolls
 * to use" — AND THE ADMINS' ("troll thing for admin").
 *
 * Only while owner mode is on (the fan x10 and the code, ../owner.js — and in
 * a game, only once the HOST has checked the pass, ../multiplayer/owner.js),
 * or for an ADMIN (the admin code; the host has checked the key's signature),
 * the player list (Tab, and the pause menu's fold) has a 🃏 Troll button on
 * the rows of the players that role may troll, beside Admin: the owner's on
 * everybody but another owner, an admin's on plain players only (an admin can
 * NEVER troll the owner, and only the owner trolls an admin: common.js
 * mayTroll, which the HOST applies, from its own reading of both roles). It
 * opens a gold row: pick a troll, and it happens to them. Harmless, short, funny, each wears off by itself,
 * never crashes, kicks or deletes anything:
 *
 *   Barrel roll    their aeroplane rolls once on its own (1.6 s)
 *   Yeet           a big launch straight up — safe, it only goes up
 *   Tiny / Giant   drawn at 0.4x / 2.5x for 30 s, physics unchanged
 *   Harrison-ify   drawn as T-Pose Harrison for 30 s
 *   Upside-down    their picture is upside down for 5 s (the HUD stays upright)
 *   Fake WASTED    the WASTED screen, then "jk 😂"
 *   Pink paint     hot pink for 60 s
 *   Duck rain      rubber ducks fall round them for 8 s
 *   Moon gravity   a sixth of the gravity for 20 s
 *   Bring here     they are put beside the owner, safely in the air
 *   Go there       the owner is put beside them
 *   Freeze controls   their stick does nothing for 3 s (the aeroplane flies on)
 *
 * HOW IT TRAVELS. The existing game-events channel (../multiplayer/events.js),
 * host-relayed as everything is: the owner's (or an admin's) copy asks the
 * host ('owner:troll' { k, t }); the host checks for ITSELF who is asking and
 * whom (session.js isOwner — the pass and its signature —, or the admin key
 * it checked at the door; never a flag a player sent): that the target is in
 * the game and one the asker may troll (common.js hostMayTroll), and that
 * this target has not been trolled in the last COOLDOWN_MS (the same
 * cooldown, whoever trolled); then it tells everybody
 * ('owner:trolled' { k, t, by }). Everything on the wire is three small
 * numbers. The target's copy does the troll to itself; everybody else's draws
 * what can be seen from outside (tiny, giant, pink, Harrison, ducks); the
 * target sees a small "🃏 trolled by the owner — Duck rain" tag ("by an
 * admin", for an admin's: read off the roster the host sent). Lobbies,
 * private matches and World lobbies all go through the same host, so it
 * works in all three.
 *
 * Nothing here is cartoon-y to anybody who did not ask for it: the owner asked
 * ("goofy is allowed here — it is the owner's toy"), and it is over in seconds.
 */

import * as THREE from '../../vendor/three.module.js';
import { registerExtension } from '../../game/extensions.js';
import { mp, ch, ride, inGame, who, esc, feed, bigCard } from '../mpplay/shared.js';
import { showWasted, endWasted, wasted } from '../wasted.js';
import { pick } from '../../render/comic.js';
import { placeAircraft, besideOf } from './place.js';
import { paintPink, scaleModel, harrisonFor, poseHarrison, DuckShower, forgetHarrisons } from './fx.js';
import { hostMayTroll, amStaffInGame, mayTroll, myRole, playerOf, rosterRole, byWho, placeOf, nameOf, isId, now, showTag, clearTag, dropTag, tickTag, injectOwnerStyle, tellWait, OWNER_GOLD } from './common.js';
import { disasterMenu } from './disasters.js';
import { armTeleport } from './teleport.js';
import { isHiddenAircraft } from '../../core/edition.js';

/** The trolls, in the order the menu shows them. `secs`: how long each lasts (0: a moment). */
export const TROLLS = Object.freeze([
  { id: 'roll', name: 'Barrel roll', icon: '🔄', secs: 1.6, hint: 'Their aeroplane rolls once on its own' },
  { id: 'yeet', name: 'Yeet', icon: '🚀', secs: 1.5, hint: 'A big launch straight up — safe, it only goes up' },
  { id: 'tiny', name: 'Tiny', icon: '🐜', secs: 30, hint: 'Their aircraft drawn at 0.4x for 30 s — it flies the same' },
  { id: 'giant', name: 'Giant', icon: '🦕', secs: 30, hint: 'Their aircraft drawn at 2.5x for 30 s — it flies the same' },
  { id: 'harrison', name: 'Harrison-ify', icon: '🧍', secs: 30, hint: 'Their aircraft drawn as T-Pose Harrison for 30 s' },
  { id: 'flip', name: 'Upside-down camera', icon: '🙃', secs: 5, hint: 'Their picture is upside down for 5 s' },
  { id: 'wasted', name: 'Fake WASTED', icon: '💀', secs: 4, hint: 'The WASTED screen… then “jk 😂”' },
  { id: 'pink', name: 'Pink paint', icon: '🎀', secs: 60, hint: 'Hot pink for 60 s' },
  { id: 'ducks', name: 'Duck rain', icon: '🦆', secs: 8, hint: 'Rubber ducks fall round them for 8 s' },
  { id: 'moon', name: 'Moon gravity', icon: '🌙', secs: 20, hint: 'A sixth of the gravity for 20 s' },
  { id: 'bring', name: 'Bring here', icon: '🧲', secs: 3, hint: 'Teleport them to you, safely in the air' },
  { id: 'go', name: 'Go there', icon: '🛸', secs: 3, hint: 'Teleport you to them, safely in the air' },
  { id: 'freeze', name: 'Freeze controls', icon: '🧊', secs: 3, hint: 'Their controls do nothing for 3 s — the aeroplane flies on' },
]);
/** One troll per target per this long. */
export const COOLDOWN_MS = 6000;
export const TINY = 0.4;
export const GIANT = 2.5;
export const MOON = 1 / 6;
export const YEET_MS = 70;
export const G = 9.80665;
export const ROLL_SECS = 1.6;
/** The fake WASTED's cause on the screen (wasted.js keeps it): the troll's end takes down only a screen that is its own. */
export const WASTED_CAUSE = 'owner-troll';

export const trollIndex = (id) => TROLLS.findIndex((t) => t.id === id);
/** The trolls everybody else can SEE on the target (drawn on their model here). */
export const SEEN_ON_THEM = new Set(['tiny', 'giant', 'harrison', 'pink', 'ducks']);

/* ---- what may travel ------------------------------------------------------------------ */

export function cleanTroll(d) {
  return d && Number.isInteger(d.k) && d.k >= 0 && d.k < TROLLS.length && isId(d.t) ? { k: d.k, t: d.t } : null;
}
export function cleanTrolled(d) {
  const c = cleanTroll(d);
  return c && isId(d.by) && d.by !== d.t ? { ...c, by: d.by } : null;
}

ch.define('owner:troll', { validate: cleanTroll, rate: 2 });
ch.define('owner:trolled', { from: 'host', validate: cleanTrolled, rate: 6 });

/* ---- the host's gate ------------------------------------------------------------------ */

/** Per-target cooldown: one troll per target per `cool` ms. */
export class TrollGate {
  constructor(clock = now, cool = COOLDOWN_MS) {
    this.now = clock;
    this.cool = cool;
    this.last = new Map();
  }

  /** { ok: true } and the time is taken, or { ok: false, waitMs }. */
  ask(target, t = this.now()) {
    const at = this.last.get(target);
    if (at !== undefined && t - at < this.cool) return { ok: false, waitMs: this.cool - (t - at) };
    this.last.set(target, t);
    return { ok: true, waitMs: 0 };
  }

  reset() {
    this.last.clear();
  }
}

const A = {
  sim: null,
  group: null,
  gate: new TrollGate(),
  /** Trolls on THIS player: id → effect. */
  mine: new Map(),
  /** Trolls drawn on others: player id → (troll id → effect). */
  theirs: new Map(),
  showers: [],
  frozen: false,
  stats: { asked: 0, sent: 0, refused: 0, waits: 0, in: 0, applied: 0, seen: 0, ended: 0 },
};

ch.on('owner:troll', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost || !from) return;
  A.stats.asked++;
  // The host's own check of who is asking and whom: the owner's pass or an admin's signature, verified by this session, and
  // the one rule (mayTroll). A plain player gets no troll; an admin none on the owner or on another admin; nobody one on the owner.
  if (!hostMayTroll(from.id, d.t) || d.t === from.id || !ch.players().some((p) => p.id === d.t)) {
    A.stats.refused++;
    return;
  }
  const g = A.gate.ask(d.t);
  if (!g.ok) {
    A.stats.waits++;
    tellWait(from.id, g.waitMs, 0);
    return;
  }
  A.stats.sent++;
  ch.send('owner:trolled', { k: d.k, t: d.t, by: from.id }, { self: true });
});

ch.on('owner:trolled', (d, from) => {
  if (!from || !from.host) return;
  arrive(d);
});

/** The owner's or an admin's copy: ask the host. False when this copy is neither, in a game. */
export function sendTroll(k, targetId) {
  if (!amStaffInGame() || !cleanTroll({ k, t: targetId }) || targetId === mp.meId) return false;
  // This copy's own reading of the roster, so the menu does not send what the host will only refuse. The host decides all the same.
  if (!mayTroll(myRole(), rosterRole(playerOf(targetId)))) return false;
  return ch.toHost('owner:troll', { k, t: targetId });
}

/* ---- one arrives ---------------------------------------------------------------------- */

function arrive(d) {
  const troll = TROLLS[d.k];
  if (!troll) return;
  A.stats.in++;
  // Sent from the other site, where he exists: nothing here to draw, so nothing to say (core/edition.js).
  if (troll.id === 'harrison' && isHiddenAircraft('tpose')) return;
  const by = who(d.by);
  const target = who(d.t);
  feed(`🃏 <b>${esc(by.name)}</b> trolled <b>${esc(target.name)}</b>: ${esc(troll.name)}`, OWNER_GOLD);
  const sim = A.sim;
  if (!sim) return;
  if (d.t === mp.meId) applyToMe(sim, troll, d);
  else if (troll.id === 'go' && d.by === mp.meId) goTo(sim, d.t);
  else if (SEEN_ON_THEM.has(troll.id)) applyToThem(sim, troll, d);
}

/* ---- on me ----------------------------------------------------------------------------- */

const FWD = new THREE.Vector3(0, 0, -1);
const Q = new THREE.Quaternion();

function air(sim) {
  const r = ride(sim);
  return r && r.kind === 'air' ? r : null;
}

/** The target's copy: the troll happens here. Exported through trollsDebug for the checks (no network). */
function applyToMe(sim, troll, d) {
  const old = A.mine.get(troll.id);
  if (old) endMine(sim, old, true);
  // Tiny and Giant are one knob: the new one takes the old one's place.
  const other = troll.id === 'tiny' ? A.mine.get('giant') : troll.id === 'giant' ? A.mine.get('tiny') : null;
  if (other) endMine(sim, other, true);
  const eff = { id: troll.id, name: troll.name, until: now() + troll.secs * 1000, by: d.by };
  const ac = sim.aircraft;
  switch (troll.id) {
    case 'roll':
      eff.step = (s, dt) => {
        const r = air(s);
        if (!r || r.onGround) return;
        Q.setFromAxisAngle(FWD, ((Math.PI * 2) / ROLL_SECS) * dt);
        r.quat.multiply(Q).normalize();
      };
      break;
    case 'yeet': {
      const r = air(sim);
      if (r) {
        ac.onGround = false;
        ac.parkingBrake = false;
        ac.pos.y += 2;
        ac.vel.y = Math.max(0, ac.vel.y) + YEET_MS;
        bigCard('YEET!', `${byWho(d.by)} launched you`, 1.6);
      }
      break;
    }
    case 'tiny':
    case 'giant': {
      const f = troll.id === 'tiny' ? TINY : GIANT;
      eff.scale = scaleModel(sim.model, f);
      eff.step = (s) => {
        if (s.model !== eff.scale.model) {
          eff.scale.undo();
          eff.scale = scaleModel(s.model, f);
        }
        eff.scale.hold();
      };
      eff.end = () => eff.scale.undo();
      break;
    }
    case 'harrison':
      eff.h = harrisonFor('me', A.group);
      if (!eff.h) return;
      // Swapped at once, not a frame later: never both the aeroplane and Harrison, and never a frame of neither.
      if (sim.model && sim.model.visible) {
        sim.model.visible = false;
        eff.hid = sim.model;
      }
      {
        const r0 = air(sim);
        if (r0) poseHarrison(eff.h, r0.pos, r0.quat, r0.vel, 0, sim.weather);
      }
      eff.step = (s, dt) => {
        const r = air(s);
        if (!r || !s.model) return;
        if (s.model.visible) {
          s.model.visible = false;
          eff.hid = s.model;
        }
        poseHarrison(eff.h, r.pos, r.quat, r.vel, dt, s.weather);
      };
      eff.end = () => {
        if (eff.h) eff.h.visible = false;
        if (eff.hid) eff.hid.visible = true;
      };
      break;
    case 'flip': {
      const el = sim.renderer && sim.renderer.domElement;
      if (el) el.style.transform = 'rotate(180deg)';
      eff.end = () => {
        if (el) el.style.transform = '';
      };
      break;
    }
    case 'wasted': {
      // The joke's own words are Comic effects (render/comic.js): off, it says so plainly. The fake screen itself is the troll.
      const joke = pick(`jk 😂 — ${byWho(d.by)} got you`, `Just a joke — ${byWho(d.by)} trolled you`);
      if (!showWasted(sim, WASTED_CAUSE, { words: joke })) bigCard('WASTED', joke, 2.5);
      /*
       * The screen runs on the game's own clock (wasted.js counts the frames'
       * dt; 3.7 s of them) and the troll on the wall clock (4 s). On a laptop
       * that is drawing slowly the frames add up to less than the wall says, so
       * when the troll's four seconds are up the joke comes down with it, if it
       * is still ours — a real knock's screen (another cause) is left alone.
       */
      eff.end = () => {
        if (wasted.active && wasted.cause === WASTED_CAUSE) endWasted(sim);
      };
      break;
    }
    case 'pink':
      eff.paint = paintPink(sim.model, sim.cockpit);
      eff.step = (s) => {
        if (s.model !== eff.paint.model) {
          eff.paint.undo();
          eff.paint = paintPink(s.model, s.cockpit);
        }
      };
      eff.end = () => eff.paint.undo();
      break;
    case 'ducks':
      eff.shower = shower();
      if (!eff.shower) return;
      eff.shower.start(() => {
        const r = ride(sim);
        return r ? r.pos : null;
      });
      eff.end = () => eff.shower.stop();
      break;
    case 'moon':
      eff.step = (s, dt) => {
        const r = air(s);
        if (!r || r.onGround) return;
        r.vel.y += G * (1 - MOON) * dt;
      };
      break;
    case 'bring': {
      const o = placeOf(d.by, sim);
      const me = placeOf(mp.meId, sim);
      if (o && me) {
        const at = besideOf(o, o.heading);
        placeAircraft(sim, { x: at.x, z: at.z, y: Math.max(o.y, 120), headingDeg: o.heading, speed: Math.max(me.speed, o.speed) });
        bigCard('WHOOSH', `${byWho(d.by)} brought you to ${nameOf(d.by)}`, 1.8);
      }
      break;
    }
    case 'go':
      bigCard('HI 👋', `${byWho(d.by)} came to you`, 1.6);
      break;
    case 'freeze':
      gateInput(sim);
      A.frozen = true;
      eff.end = () => {
        A.frozen = false;
      };
      break;
    default:
      return;
  }
  A.mine.set(troll.id, eff);
  A.stats.applied++;
  showTag(troll.name, Math.max(3, troll.secs), d.by);
}

/** The owner's copy, "Go there": beside the target. */
function goTo(sim, targetId) {
  const t = placeOf(targetId, sim);
  const me = placeOf(mp.meId, sim);
  if (!t || !me) return false;
  const at = besideOf(t, t.heading);
  placeAircraft(sim, { x: at.x, z: at.z, y: Math.max(t.y, 120), headingDeg: t.heading, speed: Math.max(me.speed, t.speed) });
  bigCard('WHOOSH', `you are with ${nameOf(targetId)}`, 1.6);
  return true;
}

function endMine(sim, eff, replaced = false) {
  if (eff.end) {
    try {
      eff.end(sim);
    } catch (e) {
      /* the troll is over either way */
    }
  }
  A.mine.delete(eff.id);
  // Its line comes off the tag with it (the tag's own clock would have agreed, unless it ended early).
  dropTag(eff.name);
  if (!replaced) A.stats.ended++;
}

/**
 * The stick does nothing while frozen: a gate on the input module's update,
 * installed once, which zeroes what it returns (the autopilot's output goes
 * round it, so an aeroplane on autopilot flies on exactly as before).
 */
function gateInput(sim) {
  const inp = sim && sim.input;
  if (!inp || inp._ownerGate || typeof inp.update !== 'function') return;
  const inner = inp.update;
  Object.defineProperty(inp, '_ownerGate', { value: true, enumerable: false });
  inp.update = function ownerFreezeGate(...args) {
    const c = inner.apply(this, args);
    if (A.frozen && c) {
      c.pitch = 0;
      c.roll = 0;
      c.yaw = 0;
    }
    return c;
  };
}

/* ---- on them ----------------------------------------------------------------------------- */

function applyToThem(sim, troll, d) {
  let map = A.theirs.get(d.t);
  if (!map) {
    map = new Map();
    A.theirs.set(d.t, map);
  }
  const old = map.get(troll.id);
  if (old) endTheirs(old);
  const other = troll.id === 'tiny' ? map.get('giant') : troll.id === 'giant' ? map.get('tiny') : null;
  if (other) endTheirs(other);
  const eff = { id: troll.id, until: now() + troll.secs * 1000, pid: d.t };
  switch (troll.id) {
    case 'tiny':
    case 'giant': {
      const f = troll.id === 'tiny' ? TINY : GIANT;
      eff.step = (r) => {
        const m = r && r.model;
        if (!m) return;
        if (!eff.scale || eff.scale.model !== m) {
          if (eff.scale) eff.scale.undo();
          eff.scale = scaleModel(m, f);
        }
        eff.scale.hold();
      };
      eff.end = () => eff.scale && eff.scale.undo();
      break;
    }
    case 'pink':
      eff.step = (r) => {
        const m = r && r.model;
        if (!m) return;
        if (!eff.paint || eff.paint.model !== m) {
          if (eff.paint) eff.paint.undo();
          eff.paint = paintPink(m);
        }
      };
      eff.end = () => eff.paint && eff.paint.undo();
      break;
    case 'harrison':
      eff.h = harrisonFor(`p${d.t}`, A.group);
      if (!eff.h) return;
      eff.step = (r, dt) => {
        if (!r || !r.visible || !r.drawn || !r.quat) {
          eff.h.visible = false;
          return;
        }
        if (r.model && r.model.visible) r.model.visible = false;
        poseHarrison(eff.h, r.drawn, r.quat, r.sample && r.sample.vel, dt, sim.weather);
      };
      eff.end = () => {
        eff.h.visible = false;
      };
      break;
    case 'ducks':
      eff.shower = shower();
      if (!eff.shower) return;
      eff.shower.start(() => {
        const p = placeOf(d.t, sim);
        return p && !p.me ? p : null;
      });
      eff.end = () => eff.shower.stop();
      break;
    default:
      return;
  }
  map.set(troll.id, eff);
  A.stats.seen++;
}

function endTheirs(eff) {
  if (eff.end) {
    try {
      eff.end();
    } catch (e) {
      /* over either way */
    }
  }
  const map = A.theirs.get(eff.pid);
  if (map) {
    map.delete(eff.id);
    if (!map.size) A.theirs.delete(eff.pid);
  }
}

/** A duck shower from the pool (two at most at once; a third asks the oldest to finish). */
function shower() {
  if (!A.group || !A.group.parent) return null;
  let s = A.showers.find((x) => !x.on);
  if (!s && A.showers.length < 2) {
    s = new DuckShower(A.group);
    A.showers.push(s);
  }
  if (!s) s = A.showers[0];
  return s;
}

/* ---- every frame ---------------------------------------------------------------------------- */

function tick(sim, dt) {
  const t = now();
  if (A.mine.size) {
    for (const eff of [...A.mine.values()]) {
      if (t >= eff.until) endMine(sim, eff);
      else if (eff.step) eff.step(sim, dt);
    }
  }
  if (A.theirs.size) {
    for (const [pid, map] of [...A.theirs]) {
      const r = mp.remotes && mp.remotes.players.get(pid);
      for (const eff of [...map.values()]) {
        if (t >= eff.until || !inGame()) endTheirs(eff);
        else if (eff.step) eff.step(r, dt);
      }
    }
  }
  for (const s of A.showers) if (!s.idle) s.update(dt);
  tickTag();
}

/** Everything off, now: the flight ended, or the game was left. */
function endAll(sim) {
  for (const eff of [...A.mine.values()]) endMine(sim, eff, true);
  for (const map of [...A.theirs.values()]) for (const eff of [...map.values()]) endTheirs(eff);
  for (const s of A.showers) s.stop();
  A.frozen = false;
  clearTag();
}

ch.on('mp:end', () => endAll(A.sim));
ch.on('mp:leave', (p) => {
  const map = p && A.theirs.get(p.id);
  if (map) for (const eff of [...map.values()]) endTheirs(eff);
});

/* ---- the menu, in the player list (multiplayer/ui.js paints what this returns) ------------------- */

/** Which row is open, and the disaster picker's choices (../owner/disasters.js reads them). */
export const MENU = { open: null, tab: 'trolls', secs: 30, dis: 'tornado' };
disasterMenu.use(MENU);

function trollRow(p) {
  // Harrison-ify is not offered on a copy without him (core/edition.js). Filtered here, not in TROLLS: the index is what travels.
  const btns = TROLLS.map((t, k) => (t.id === 'harrison' && isHiddenAircraft('tpose') ? '' : `<button data-mp-own="troll:${k}:${p.id}" title="${esc(t.hint)}">${t.icon} ${esc(t.name)}</button>`)).join('');
  return `<div class="mp-admrow mp-ownrow" data-mp-ownrow="${p.id}"><b class="mp-admintag mp-ownertag">🃏</b>${btns}`
    + `<button data-mp-own="tp:${p.id}" title="Then tap the map where ${esc(p.name)} should go, and pick a height">🗺 Teleport them</button>`
    + `<button class="mp-own-tab" data-mp-own="tab:dis:${p.id}" title="Send a natural disaster after ${esc(p.name)}">⚡ Disasters ▸</button></div>`;
}

/**
 * What multiplayer/ui.js asks of the owner's menu: a shape string (so the
 * list is rebuilt only when something here changed), a button for a row, the
 * open row, the foot, and what a click or a slider did. All of it only when
 * the list says this copy has admin powers (opts.admin: an owner or an admin),
 * and `mine` ('owner' | 'admin') is which: a row gets the button only if that
 * role may troll that player (common.js mayTroll — the host judges again).
 */
export const ownerMenu = {
  shape() {
    return `${MENU.open}|${MENU.tab}|${MENU.secs}|${MENU.dis}|${disasterMenu.shape()}`;
  },
  /** Whether `mine` ('owner' | 'admin') may troll the player on this roster row. */
  allows(p, mine) {
    return !!p && mayTroll(mine === 'owner' ? 'owner' : 'admin', rosterRole(p));
  },
  button(p, mine = 'owner') {
    if (!ownerMenu.allows(p, mine)) return '';
    return `<button class="mp-ownbtn" data-mp-own-open="${p.id}" aria-expanded="${MENU.open === p.id}" title="${mine === 'owner' ? 'Owner' : 'Admin'}: troll ${esc(p.name)}">🃏 Troll</button>`;
  },
  row(p, mine = 'owner') {
    if (MENU.open !== p.id || !ownerMenu.allows(p, mine)) return '';
    return MENU.tab === 'dis' ? disasterMenu.row(p, MENU) : trollRow(p);
  },
  foot() {
    return disasterMenu.foot();
  },
  /** A row's menu for somebody who has gone, or who this role may not troll (now an admin, say): shut. */
  prune(players, mine = 'owner') {
    if (MENU.open != null && !players.some((p) => p.id === MENU.open && ownerMenu.allows(p, mine))) MENU.open = null;
  },
  /** A click in the list. True if it was this menu's (the list repaints). */
  click(e) {
    const open = e.target.closest('[data-mp-own-open]');
    if (open) {
      const id = Number(open.dataset.mpOwnOpen);
      MENU.open = MENU.open === id ? null : id;
      MENU.tab = 'trolls';
      return true;
    }
    const b = e.target.closest('[data-mp-own]');
    if (!b) return false;
    act(b.dataset.mpOwn);
    return true;
  },
  /** The duration slider moved. */
  input(e) {
    const r = e.target.closest && e.target.closest('[data-mp-own-range]');
    if (!r) return false;
    disasterMenu.slid(Number(r.value), r);
    return true;
  },
};

/** "troll:3:5", "tab:dis:5", "tp:5", and the disaster menu's own words. */
export function act(what) {
  const [op, a, b] = String(what).split(':');
  const id = Number(b ?? a);
  switch (op) {
    case 'troll':
      sendTroll(Number(a), id);
      return true;
    case 'tab':
      MENU.tab = a === 'dis' ? 'dis' : 'trolls';
      return true;
    case 'tp':
      armTeleport(id, nameOf(id));
      return true;
    default:
      return disasterMenu.act(op, a, b);
  }
}

/* ---- the plug-in ------------------------------------------------------------------------------ */

registerExtension({
  id: 'owner-trolls',
  install(sim) {
    A.sim = sim;
    injectOwnerStyle();
    mp.ownerMenu = ownerMenu;
    if (typeof window !== 'undefined') window.__ownerTrolls = trollsDebug();
  },
  buildWorld(sim, group) {
    A.sim = sim;
    A.group = group;
    // The old world took the old models with it.
    forgetHarrisons();
    A.showers = [];
    for (const eff of A.mine.values()) if (eff.h || eff.shower) endMine(sim, eff, true);
    for (const map of A.theirs.values()) for (const eff of [...map.values()]) if (eff.h || eff.shower) endTheirs(eff);
  },
  update(sim, dt) {
    A.sim = sim;
    tick(sim, dt);
  },
  stop(sim) {
    endAll(sim);
  },
});

/** For the checks and the console. */
export function trollsDebug() {
  return {
    A,
    TROLLS,
    gate: A.gate,
    stats: A.stats,
    menu: MENU,
    mine: () => [...A.mine.keys()],
    theirs: () => Object.fromEntries([...A.theirs].map(([pid, m]) => [pid, [...m.keys()]])),
    frozen: () => A.frozen,
    showers: () => A.showers.map((s) => ({ on: s.on, dropped: s.dropped, idle: s.idle, falling: s.ducks.filter((d) => d.live).length })),
    /** The troll, here and now, as if the host had said so: { k | id, t, by }. */
    arrive: (d) => arrive({ k: typeof d.k === 'number' ? d.k : trollIndex(d.id), t: d.t ?? mp.meId, by: d.by ?? 0 }),
    send: sendTroll,
    /** One player's row of troll buttons, as HTML (tests/features/edition.mjs reads it). */
    row: (p) => trollRow(p),
    endAll: () => endAll(A.sim),
    act,
  };
}

/**
 * A WORLD THAT EVERYBODY SHARES (the owner's list, list 2: "natural disasters
 * affect everyone, if you summon them", "add synced weather", "crashes show
 * on minimap", "the same planes (npc)").
 *
 * In a multiplayer game, four things now happen for everybody at once:
 *
 *   WEATHER is the host's. The time of day, the sky, the wind and any storm a
 *   disaster brought: the host says (a shared value, 'world:wx', whenever it
 *   changes) and every other game follows — the wind included, so nobody's
 *   crosswind wanders off on its own.
 *
 *   DISASTERS anybody summons happen to everybody: "⚡ Summon" on the badge —
 *   a tornado, a storm cell, a typhoon, a lightning storm, a fog bank, a
 *   microburst, a WILDFIRE or a METEOR SHOWER — or the pause menu's own
 *   Disasters buttons. The host says yes (no more than one every fifteen
 *   seconds in a game, one every thirty from any one player, so nobody
 *   buries a lobby in tornadoes) and every game starts it, with a line
 *   saying who summoned it. A wildfire is lit where the summoner's is, so a
 *   lobby fights the same fire. In the van and the boat too: the weather
 *   ones are the game's own there as well (a tornado down near them, on the
 *   minimap with where it is, the storm, the fog, the lightning), and the
 *   two that are flying games — the wildfire and the meteors — are sights
 *   there (./mpplay/sights.js): the fire's smoke, and shooting stars. They
 *   can summon from the badge as well. A wildfire burns on land: summoned
 *   from the boat, or from an aeroplane over the sea, it is lit on the
 *   nearest land (landNear), and the van's and the boat's smoke, its line
 *   and its minimap flame are where the fire is — the host's own fire
 *   ('world:fire') once the host has one, that nearest land until then.
 *
 *   The AI AEROPLANES are the host's. The host runs the traffic — in Dev mode
 *   only, exactly as in single player (traffic.js: "anything not finished
 *   goes to dev mode") — and everybody else draws the host's aeroplanes where
 *   the host has them, five times a second, eased in between. Nobody else
 *   runs traffic of their own in a game (multiplayer.js enterWorld), so there
 *   is one set of AI aeroplanes and everybody sees the same one.
 *
 *   CRASHES show on everybody's minimap, in the colour of whoever crashed.
 *   The crash itself is the crashes feature's (src/features/crashes.js, on
 *   its own branch); what crosses the network is its "happening"
 *   (../game/happenings.js — the contract between the two teams, the same
 *   file byte for byte). With that feature here, it draws the mark; without
 *   it, this file draws a simple one of its own on the multiplayer minimap
 *   overlay, and watches for crashes and summoned disasters itself, so the
 *   game works whichever branches are in it.
 *
 * Everything on the wire is numbers, player ids and ids from the game's own
 * lists — a disaster's id, an aircraft type's, a map's. Nothing anybody
 * could type.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extStatus } from '../game/extensions.js';
import { findEvent, NATURAL_EVENTS } from '../game/disasters.js';
import { onHappening, receiveHappening, emitHappening, setHappeningReceiver, setSummonPoint, cleanHappening, CRASH_KINDS } from '../game/happenings.js';
import { EVENTS } from '../aircraft/physics.js';
import { TIMES, CONDITIONS } from '../world/weather.js';
import { heightAt } from '../world/terrain.js';
import { createAircraftModel, syncAircraftModel, groundOffsetFor } from '../aircraft/model-adapter.js';
import { getAircraft, specFor } from '../aircraft/types.js';
import { schemeFor } from '../aircraft/liveries.js';
import * as Prog from '../game/progression.js';
import { clearTraffic, spawnTraffic } from './traffic.js';
import { registerBody, unregisterBody, radiusOfType } from './sky.js';
import { setupFire, startDevFire, wildfireDebug } from './wildfire.js';
import { mp, ch, ride, forwardOf, inGame, who, esc, feed, chip, toon, injectStyle } from './mpplay/shared.js';
import { GroundSights } from './mpplay/sights.js';

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const TIME_IDS = Object.keys(TIMES);
const COND_IDS = Object.keys(CONDITIONS);

/** What the Summon menu offers, in this order, with a picture a kid can find. */
export const SUMMON = [
  { id: 'tornado', icon: '🌪️' },
  { id: 'stormCell', icon: '⛈️' },
  { id: 'typhoon', icon: '🌀' },
  { id: 'lightning', icon: '⚡' },
  { id: 'fogBank', icon: '🌫️' },
  { id: 'microburst', icon: '💨' },
  { id: 'wildfire', icon: '🔥', name: 'Wildfire', hint: 'A forest fire starts — scoop water from the sea and drop it on the flames (X)' },
  { id: 'meteors', icon: '☄️', name: 'Meteor shower', hint: 'Rocks streak across the sky for a minute and a half — point at one and zap it (Z)' },
];
export const GAME_COOL_MS = 15000;
export const PLAYER_COOL_MS = 30000;
export const METEOR_MS = 90000;
export const TRAFFIC_HZ = 5;
/** How far out from a summon over the sea to look for land for a wildfire, and what counts as land (sights.js draws smoke above 1 m). */
export const LAND_SEARCH_M = 8000;
const LAND_MIN_M = 1.5;
/** The host's fire is taken as this summon's when it is this near the land the summon was put on. */
const FIRE_NEAR_M = 2500;

const summonable = (id) => SUMMON.some((s) => s.id === id);
const num = (v, lim = 2e5) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim;

/* ---- what may travel ---------------------------------------------------------------------------- */

export function cleanWx(d) {
  if (!d || !Number.isInteger(d.t) || !TIME_IDS[d.t] || !Number.isInteger(d.c) || !COND_IDS[d.c]) return null;
  if (!num(d.w, 80) || d.w < 0 || !num(d.d, 3600)) return null;
  const tc = Number.isInteger(d.tc) && COND_IDS[d.tc] ? d.tc : -1;
  const tl = tc >= 0 && num(d.tl, 3600) && d.tl > 0 ? Math.round(d.tl) : 0;
  return { t: d.t, c: d.c, w: Math.round(d.w * 10) / 10, d: Math.round(((d.d % 360) + 360) % 360), tc, tl };
}
export function cleanSummon(d) {
  return d && typeof d.id === 'string' && summonable(d.id) && num(d.x) && num(d.z) ? { id: d.id, x: Math.round(d.x), z: Math.round(d.z) } : null;
}
export function cleanDis(d) {
  const s = cleanSummon(d);
  return s && Number.isInteger(d.by) && d.by >= 0 && d.by <= 7 ? { ...s, by: d.by } : null;
}
export function cleanHap(d) {
  if (!d || d.type !== 'crash' || typeof d.map !== 'string' || !/^[a-z0-9-]{1,32}$/.test(d.map)) return null;
  const c = cleanHappening(d);
  return c ? { type: 'crash', kind: c.kind, vehicle: c.vehicle, x: Math.round(c.x), z: Math.round(c.z), map: c.map } : null;
}
/** Where the host's own wildfire is burning: { x, z }, the middle of what burns, metres. */
export function cleanFire(d) {
  return d && num(d.x) && num(d.z) ? { x: Math.round(d.x), z: Math.round(d.z) } : null;
}
/** The host's AI aeroplanes: { a: [[id, type, x, y, z, heading, speed, climb, flags], ...] } — flags 1 gear down, 2 on the ground. */
export function cleanTraffic(d) {
  if (!d || !Array.isArray(d.a) || d.a.length > 12) return null;
  const a = [];
  for (const r of d.a) {
    if (!Array.isArray(r) || r.length !== 9) return null;
    const [id, type, x, y, z, h, v, vs, f] = r;
    if (!Number.isInteger(id) || id < 0 || id > 999 || typeof type !== 'string' || !/^[a-z0-9_-]{1,24}$/.test(type)) return null;
    if (![x, y, z].every((n) => num(n)) || !num(h, 720) || !num(v, 600) || !num(vs, 200) || !Number.isInteger(f) || f < 0 || f > 3) return null;
    a.push([id, type, x, y, z, h, v, vs, f]);
  }
  return { a };
}

ch.define('world:wx', { from: 'host', validate: cleanWx });
ch.define('world:summon', { validate: cleanSummon, rate: 0.5 });
ch.define('world:dis', { from: 'host', validate: cleanDis, rate: 2 });
/** The host to one player: not yet — the next disaster can come in `s` seconds. */
ch.define('world:wait', { from: 'host', validate: (d) => (d && Number.isInteger(d.s) && d.s >= 1 && d.s <= 60 ? { s: d.s } : null), rate: 4 });
ch.define('world:hap', { validate: cleanHap, rate: 1 });
ch.define('world:traffic', { from: 'host', validate: cleanTraffic, rate: TRAFFIC_HZ * 2 });
/** Shared state: the host's live wildfire, while it burns (hostFire) — where the ground players' smoke goes. */
ch.define('world:fire', { from: 'host', validate: cleanFire });

const W = {
  sim: null,
  timer: null,
  lastWx: null,
  wxApplied: 0,
  lastGameSummon: -Infinity,
  lastBy: new Map(),
  localSummon: new Map(),
  applying: false,
  meteorTimer: null,
  mirror: new Map(),
  group: null,
  trafficAt: 0,
  marks: [],
  sentSome: false,
  acHooked: null,
  wrapped: false,
  menuEl: null,
  sights: new GroundSights(),
  /** The host's live wildfire ('world:fire'), as last said — and, on the host, as last sent. */
  fireAt: null,
  fireSent: null,
  hazard: false,
  hazardFrom: 0,
  stats: { wxSent: 0, wxApplied: 0, summons: 0, applied: 0, refused: 0, hapSent: 0, hapIn: 0, trafficSent: 0, trafficIn: 0, marks: 0, ground: 0, flashes: 0 },
};

const crashesHere = () => extStatus().some((e) => e.id === 'crashes' && e.live);

/* ---- weather ------------------------------------------------------------------------------------- */

function wxNow(sim) {
  const w = sim && sim.weather;
  if (!w) return null;
  const tc = w._tempCond ? COND_IDS.indexOf(w._tempCond.id) : -1;
  return cleanWx({
    t: Math.max(0, TIME_IDS.indexOf(w.time)), c: Math.max(0, COND_IDS.indexOf(w.condition)),
    w: w.windSpeedKts, d: w.windDirDeg,
    tc, tl: w._tempCond ? w._tempCond.left : 0,
  });
}

function wxDiffers(a, b) {
  if (!a || !b) return true;
  if (a.t !== b.t || a.c !== b.c || a.tc !== b.tc) return true;
  if (Math.abs(a.w - b.w) >= 1) return true;
  const dd = Math.abs(((a.d - b.d + 540) % 360) - 180);
  return dd >= 5;
}

function hostWeather(sim) {
  const w = wxNow(sim);
  if (!w || !wxDiffers(w, W.lastWx)) return;
  W.lastWx = w;
  W.stats.wxSent++;
  ch.setState('world:wx', w);
}

function applyWeather(v) {
  const sim = W.sim;
  const w = sim && sim.weather;
  if (!v || !w || ch.isHost) return;
  W.stats.wxApplied++;
  const time = TIME_IDS[v.t];
  const condition = COND_IDS[v.c];
  if (w.time !== time || w.condition !== condition) w.load({ time, condition });
  // The host's wind, as it is now — no wandering of our own.
  if (w.randomWinds) w.randomWinds = false;
  w.windSpeedKts = v.w;
  w.windDirDeg = v.d;
  w.baseWindKts = v.w;
  w.baseWindDirDeg = v.d;
  if (v.tc >= 0) {
    const id = COND_IDS[v.tc];
    if (!w._tempCond || w._tempCond.id !== id) w.temporaryCondition(id, v.tl || 60);
    else w._tempCond.left = v.tl || w._tempCond.left;
  } else if (w._tempCond) w._tempCond = null;
  W.wxApplied = now();
}

ch.onState('world:wx', (v) => applyWeather(v));

/* ---- disasters ------------------------------------------------------------------------------------- */

/** The disasters this copy can start, with their names and lines. */
export function summonList() {
  return SUMMON.map((s) => {
    const ev = findEvent(s.id);
    return { id: s.id, icon: s.icon, name: (ev && ev.name) || s.name || s.id, hint: s.hint || (ev && ev.hint) || '' };
  }).filter((s) => s.id === 'meteors' || s.id === 'wildfire' || findEvent(s.id));
}

function nameOf(id) {
  const s = summonList().find((x) => x.id === id);
  return s ? s.name : id;
}

/** Ask for one: the host says yes or no, and everybody (you too) starts it. */
export function summon(id) {
  const sim = W.sim;
  const me = ride(sim);
  if (!inGame() || !me || !summonable(id)) return false;
  if (sim.mode !== 'free' && sim.mode !== 'drive') {
    feed('Disasters are for a game out on the island');
    return false;
  }
  W.stats.summons++;
  return ch.toHost('world:summon', { id, x: me.pos.x, z: me.pos.z });
}

function cooldownLeft(id, t = now()) {
  const g = W.lastGameSummon + GAME_COOL_MS - t;
  const p = (W.lastBy.get(id) || -Infinity) + PLAYER_COOL_MS - t;
  return Math.max(0, g, p);
}

ch.on('world:summon', (d, from, meta) => {
  if (!ch.isHost || !meta || !meta.toHost) return;
  const t = now();
  const left = cooldownLeft(from.id, t);
  if (left > 0) {
    W.stats.refused++;
    // Only the asker needs telling, and only in words their own copy has.
    const secs = Math.max(1, Math.min(60, Math.ceil(left / 1000)));
    if (from.id === mp.meId) waitLine(secs);
    else ch.sendTo(from.id, 'world:wait', { s: secs });
    return;
  }
  W.lastGameSummon = t;
  W.lastBy.set(from.id, t);
  // A wildfire goes out on the wire already on land, so every game starts from the same spot.
  const at = d.id === 'wildfire' ? landNear(d.x, d.z) : null;
  ch.send('world:dis', { id: d.id, x: at ? at.x : d.x, z: at ? at.z : d.z, by: from.id }, { self: true });
});

function waitLine(s) {
  feed(`One disaster at a time — the next one can come in ${s} s`);
}
ch.on('world:wait', (d, from) => {
  if (from && from.host) waitLine(d.s);
});

ch.on('world:dis', (d, from) => {
  if (!from || !from.host) return;
  applyDisaster(d);
});

/** Start one here, because somebody summoned it. */
function applyDisaster(d) {
  const sim = W.sim;
  const by = who(d.by);
  const mine = d.by === mp.meId;
  // Summoned from the pause menu a moment ago: it has already happened here.
  const already = mine && now() - (W.localSummon.get(d.id) || -Infinity) < 4000;
  feed(`${mine ? '<b>You</b>' : `<b>${esc(by.name)}</b>`} summoned: ${esc(nameOf(d.id))}!`, by.colour);
  if (already || !sim || (sim.state !== 'flying' && sim.state !== 'paused')) return;
  // In the van or the boat: it happens there too (it used to stop here, with the line above promising it).
  if (sim.mode === 'drive') {
    applyOnGround(sim, d);
    return;
  }
  if (sim.mode !== 'free') return;
  W.stats.applied++;
  W.applying = true;
  try {
    if (d.id === 'meteors') {
      const m = sim.meteors;
      if (m && !m.active) {
        m.begin({ mode: 'shower' });
        clearTimeout(W.meteorTimer);
        // A summoned shower is a shower, not the rest of the game.
        W.meteorTimer = setTimeout(() => {
          if (m.active && !(sim.runner && sim.runner.def && sim.runner.def.category === 'meteor')) m.end();
        }, METEOR_MS);
      }
      if (sim.hud && sim.hud.notify) sim.hud.notify('Meteor shower! Point your nose at one and zap it — Z, or the ZAP button', 'good', 5);
      return;
    }
    // A wildfire burns on land — summoned from the boat or over the sea, on the nearest land (the ground players' smoke is there too).
    const at = (d.id === 'wildfire' && landNear(d.x, d.z)) || { x: d.x, z: d.z };
    if (d.id === 'wildfire' && !findEvent('wildfire')) {
      lightFire(sim, at);
      return;
    }
    setSummonPoint(at);
    sim.triggerNatural(d.id);
  } catch (err) {
    console.warn('[mpworld] could not start', d.id, err);
  } finally {
    setSummonPoint(null);
    W.applying = false;
    // The host says where its fire is now, not at the next tick: the van and the boat put their smoke there.
    if (d.id === 'wildfire' && ch.isHost) hostFire(sim);
  }
}

/** The Summon menu's line for the two flying games, read in the van or the boat. */
const GROUND_HINTS = {
  wildfire: 'A forest fire for the pilots to put out — you will see its smoke',
  meteors: 'Shooting stars streak across the sky for a minute and a half',
};

/** The weather disasters, in words for somebody on the road or on the water (the game's own are about flying). */
const GROUND_LINES = {
  stormCell: 'Storm cell overhead — thunder, lightning and rain on the way',
  typhoon: 'TYPHOON — storm-force wind! Take it slowly',
  lightning: 'LIGHTNING STORM — flashes and thunder all around',
  fogBank: 'Fog rolling in — slow down, it is hard to see',
  microburst: 'MICROBURST — a blast of wind comes down out of the sky',
};

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
/** Where a place is from a player on the ground, as a child would say it: how far, and ahead / behind / on the left / on the right. */
export function whereFrom(me, fwd, x, z) {
  const dx = x - me.x;
  const dz = z - me.z;
  const km = Math.hypot(dx, dz) / 1000;
  let brg = (Math.atan2(dx, -dz) * 180) / Math.PI;
  if (brg < 0) brg += 360;
  const nose = (Math.atan2(fwd.x, -fwd.z) * 180) / Math.PI;
  const rel = ((brg - nose + 540) % 360) - 180;
  const side = Math.abs(rel) < 40 ? 'ahead' : Math.abs(rel) > 140 ? 'behind you' : rel < 0 ? 'on your left' : 'on your right';
  return { km, side, compass: COMPASS[Math.round(brg / 45) % 8] };
}

/**
 * The nearest land to (x, z) — (x, z) itself when it is land — or null when
 * there is only sea within `maxR` metres. A ring search, outwards: 25 m rings
 * to a kilometre, then wider ones, a point every 40 m or so round each (at
 * most 160). Found land is taken a little further on, off the beach, when
 * that is land too. Numbers from the game's own terrain only, so every copy
 * on the same island finds the same spot.
 */
export function landNear(x, z, maxR = LAND_SEARCH_M) {
  if (!num(x) || !num(z)) return null;
  const land = (px, pz) => heightAt(px, pz) > LAND_MIN_M;
  const rx = Math.round(x);
  const rz = Math.round(z);
  if (land(rx, rz)) return { x: rx, z: rz };
  for (let r = 25; r <= maxR; r += r < 1000 ? 25 : r < 3000 ? 50 : 100) {
    const n = Math.min(160, Math.max(12, Math.round((2 * Math.PI * r) / 40)));
    for (let a = 0; a < n; a++) {
      const ang = (a / n) * Math.PI * 2;
      const sx = Math.sin(ang);
      const cz = -Math.cos(ang);
      const px = Math.round(x + sx * r);
      const pz = Math.round(z + cz * r);
      if (!land(px, pz)) continue;
      const ix = Math.round(x + sx * (r + 40));
      const iz = Math.round(z + cz * (r + 40));
      return land(ix, iz) ? { x: ix, z: iz } : { x: px, z: pz };
    }
  }
  return null;
}

/**
 * Where a summoned wildfire really is, for somebody in the van or the boat:
 * the host's own fire ('world:fire') when the host has one near this
 * summon's land, else the nearest land to where it was summoned — where the
 * pilots' fire is lit (setupFire looks for grass and forest from there).
 * { x, z, host } or null (only sea).
 */
export function fireSpot(d) {
  const land = d ? landNear(d.x, d.z) : null;
  const f = W.fireAt;
  if (f && land && Math.hypot(f.x - land.x, f.z - land.z) < FIRE_NEAR_M && heightAt(f.x, f.z) > 1) return { x: f.x, z: f.z, host: true };
  return land ? { ...land, host: false } : null;
}

/** Host: where its own wildfire burns, said to everybody (every second, and straight after a summon) while it burns. */
function hostFire(sim) {
  if (!ch.active || !ch.isHost) return;
  const Wf = wildfireDebug();
  const g = Wf && Wf.live ? Wf.grid : null;
  let at = null;
  if (g && g.burning > 0 && sim && sim.mode !== 'drive' && typeof g.centroid === 'function') {
    const c = g.centroid({ x: 0, z: 0 });
    if (c && num(c.x) && num(c.z)) at = { x: Math.round(c.x), z: Math.round(c.z) };
  }
  const was = W.fireSent;
  if (!at) {
    // Out — said by a host who is flying, and so would see it. From the van or the boat the pilots' fires may still burn.
    if (was && sim && sim.mode !== 'drive') {
      ch.setState('world:fire', null);
      W.fireSent = null;
    }
    return;
  }
  // Moved less than a few cells: not worth a message.
  if (was && Math.hypot(at.x - was.x, at.z - was.z) < 60) return;
  if (ch.setState('world:fire', at)) W.fireSent = at;
}

/** A player: the host's fire, as it moves and when it goes out — the smoke in the van and the boat follows it. */
ch.onState('world:fire', (v) => {
  const had = W.fireAt;
  W.fireAt = v || null;
  const S = W.sights.smoke;
  if (!S || ch.isHost) return;
  if (v) {
    const from = S.anchor || S;
    if (Math.hypot(v.x - from.x, v.z - from.z) < FIRE_NEAR_M && W.sights.moveSmoke(v.x, v.z)) S.fromHost = true;
  } else if (had && S.fromHost) W.sights.endSmoke(20);
});

/**
 * A summoned disaster in the van or the boat. The weather ones are the
 * game's own, started as the pause menu would (a tornado put down near this
 * player, as it is near every pilot); the wildfire and the meteors, which
 * are flying games, are sights (./mpplay/sights.js).
 */
function applyOnGround(sim, d) {
  const me = ride(sim);
  if (!me) return;
  W.stats.applied++;
  W.stats.ground++;
  const say = (text, kind = 'warn') => sim.hud && typeof sim.hud.notify === 'function' && sim.hud.notify(text, kind, 6);
  W.applying = true;
  try {
    if (d.id === 'meteors') {
      W.sights.startMeteors();
      say('Meteor shower! Look up — shooting stars streak across the sky', 'good');
      return;
    }
    if (d.id === 'wildfire') {
      // Where the fire really is (fireSpot) — the smoke, this line and the minimap's flame all use that one spot.
      const spot = fireSpot(d);
      const lit = !!spot && W.sights.startSmoke(spot.x, spot.z);
      if (lit) {
        W.sights.smoke.anchor = { x: spot.x, z: spot.z };
        W.sights.smoke.fromHost = spot.host === true;
        const w = whereFrom(me.pos, forwardOf(me.quat), spot.x, spot.z);
        say(`WILDFIRE! See the smoke ${w.km.toFixed(1)} km ${w.side} — the pilots are putting it out with water`);
      } else say('WILDFIRE! The pilots are putting it out with water from the sea');
      return;
    }
    const ev = findEvent(d.id);
    if (!ev) return;
    let line = GROUND_LINES[d.id] || ev.warn;
    if (d.id === 'tornado') {
      const at = sim.tornado.spawn(me.pos, ev.duration || 260, sim.tornadoEF);
      sim.weather.vortex = sim.tornado;
      const w = whereFrom(me.pos, forwardOf(me.quat), at.x, at.z);
      line = `TORNADO! It touched down ${w.km.toFixed(1)} km ${w.side} — keep away from it`;
      // Its line on the screen once that message has gone: the two sit in the same place.
      W.hazardFrom = now() + 6000;
    } else ev.apply(sim);
    sim.activeEvents = sim.activeEvents || {};
    sim.activeEvents[d.id] = ev.duration || 8;
    if (sim.menus && typeof sim.menus.syncNatural === 'function') sim.menus.syncNatural(sim.activeEvents);
    say(line);
  } catch (err) {
    console.warn('[mpworld] could not start', d.id, 'on the ground', err);
  } finally {
    W.applying = false;
  }
}

/**
 * The van and the boat skip the flying game's clocks (main.js), so the
 * tornado, the lightning storm and the clocks on what is happening run here
 * while a summoned one is on — with the tornado's whereabouts on the screen,
 * as a pilot has them.
 */
function tickGround(sim, dt) {
  const t = sim.tornado;
  if (t && t.active) {
    t.update(dt);
    const me = ride(sim);
    if (me && t.active && now() >= W.hazardFrom && sim.hud && typeof sim.hud.setHazard === 'function') {
      const w = whereFrom(me.pos, forwardOf(me.quat), t.pos.x, t.pos.z);
      sim.hud.setHazard(`<b>${esc(t.label || '')} TORNADO</b> ${w.km.toFixed(1)} km · ${w.side}`);
      W.hazard = true;
    }
  }
  if (W.hazard && !(t && t.active)) clearHazard(sim);
  const st = sim.lightningStorm;
  if (st) {
    st.left -= dt;
    st.next -= dt;
    if (st.next <= 0 && st.left > 0) {
      st.next = 20 + Math.random() * 20;
      if (sim.weather) sim.weather.lightningFlash = 1;
      W.stats.flashes++;
      const a = sim.audio;
      if (a && a.available && a.ambience && typeof a.ambience.playThunder === 'function') a.ambience.playThunder();
    }
    if (st.left <= 0) {
      sim.lightningStorm = null;
      if (sim.hud && sim.hud.notify) sim.hud.notify('The storm has passed', 'good', 3);
    }
  }
  if (sim.activeEvents) {
    for (const id of Object.keys(sim.activeEvents)) {
      sim.activeEvents[id] -= dt;
      if (sim.activeEvents[id] <= 0) delete sim.activeEvents[id];
    }
  }
  const wv = sim.weather && typeof sim.weather.windVector === 'function' ? sim.weather.windVector() : null;
  W.sights.update(dt, sim.camera, wv);
}

function clearHazard(sim) {
  W.hazard = false;
  if (sim && sim.hud && typeof sim.hud.setHazard === 'function') sim.hud.setHazard(null);
}

/**
 * The wildfire, when this copy has no "wildfire" in its disasters list (the
 * crashes team's src/features/wildfire-disaster.js adds it there): the
 * wildfire feature's own fire, lit where the summoner's is.
 */
function lightFire(sim, p) {
  const Wf = wildfireDebug();
  const g = Wf && Wf.grid;
  if (Wf && Wf.live && g && g.burning && g.inside(p.x, p.z) && Math.hypot(p.x - g.cx, p.z - g.cz) < 2600) {
    g.ignite(p.x, p.z, 45);
    Wf.flameDirty = true;
    return true;
  }
  // Where the summoner's is; if there is nothing to burn there, the nearest grass or forest ahead of this player.
  const lit = setupFire(sim, { centre: { x: p.x, z: p.z }, ignite: [{ x: p.x, z: p.z, r: 45 }], preburn: 15, protect: 'town', mopUp: 0.85, dev: true });
  if (!lit) return !!startDevFire(sim);
  if (sim.hud && sim.hud.notify) sim.hud.notify('WILDFIRE! Scoop water from the sea and drop it on the flames (X)', 'warn', 5);
  return true;
}

/* ---- happenings: crashes across the network ------------------------------------------------------------ */

onHappening((e) => {
  if (!inGame() || !e || e.remote || W.applying) return;
  if (e.type === 'crash') {
    const h = cleanHap(e);
    if (h) {
      W.stats.hapSent++;
      ch.send('world:hap', h);
    }
    return;
  }
  // A disaster summoned here from the pause menu's own buttons: everybody gets it too.
  if (e.type === 'disaster' && e.summoned && summonable(e.id)) {
    W.localSummon.set(e.id, now());
    ch.toHost('world:summon', { id: e.id, x: e.x, z: e.z });
  }
});

ch.on('world:hap', (d, from) => {
  if (!from || from.id === mp.meId) return;
  W.stats.hapIn++;
  const sim = W.sim;
  if (crashesHere()) {
    receiveHappening(sim, d, { name: from.name, colour: from.colour, apply: false });
    return;
  }
  // The crashes feature is not in this copy: a mark of our own.
  const map = sim && sim.settings ? sim.settings.map : null;
  if (d.map && map && d.map !== map) return;
  W.marks.push({ x: d.x, z: d.z, colour: from.colour, at: now(), name: from.name });
  if (W.marks.length > 12) W.marks.shift();
  W.stats.marks++;
  feed(`<b>${esc(from.name)}</b> crashed — the ✖ on your map`, from.colour);
});

/** Without the crashes feature: this copy notices its own crashes and summoned disasters. */
function fallbackHooks(sim) {
  if (crashesHere()) return;
  const ac = sim && sim.aircraft;
  if (ac && W.acHooked !== ac && typeof ac.on === 'function') {
    W.acHooked = ac;
    ac.on(EVENTS.CRASH, () => {
      if (!inGame() || crashesHere()) return;
      const map = sim.settings ? sim.settings.map : null;
      emitHappening({ type: 'crash', kind: 'bonk', vehicle: sim.aircraftType && sim.aircraftType.id === 'harrier' ? 'heli' : 'plane', x: Math.round(ac.pos.x), z: Math.round(ac.pos.z), map });
    });
  }
  if (!W.wrapped && typeof sim.triggerNatural === 'function' && !sim.triggerNatural.__happenings) {
    W.wrapped = true;
    const orig = sim.triggerNatural;
    let pressing = false;
    const wrapped = function (id, ...rest) {
      const out = orig.call(this, id, ...rest);
      try {
        const me = ride(sim);
        if (me && !W.applying && !crashesHere()) emitHappening({ type: 'disaster', id, summoned: pressing, x: Math.round(me.pos.x), z: Math.round(me.pos.z), map: sim.settings ? sim.settings.map : null });
      } catch (e) {
        /* the disaster has happened either way */
      }
      return out;
    };
    wrapped.__happenings = true;
    sim.triggerNatural = wrapped;
    const hooks = sim.menus && sim.menus.hooks;
    if (hooks && typeof hooks.onNatural === 'function' && !hooks.onNatural.__happenings) {
      const press = hooks.onNatural;
      const pressed = function (...args) {
        pressing = true;
        try {
          return press.apply(this, args);
        } finally {
          pressing = false;
        }
      };
      pressed.__happenings = true;
      hooks.onNatural = pressed;
    }
  }
}

/* ---- the host's AI aeroplanes -------------------------------------------------------------------------- */

function hostTraffic(sim) {
  const list = Array.isArray(sim.traffic) ? sim.traffic : [];
  const t = now();
  if (t - W.trafficAt < 1000 / TRAFFIC_HZ) return;
  W.trafficAt = t;
  const a = [];
  for (const c of list) {
    if (a.length >= 12 || !c || !c.pos || typeof c.typeId !== 'string') continue;
    // traffic.js names them "traffic-3": the number is the id.
    const id = Number(String(c.id).replace(/\D/g, '')) % 1000;
    if (!Number.isInteger(id)) continue;
    a.push([id, c.typeId, Math.round(c.pos.x * 10) / 10, Math.round(c.pos.y * 10) / 10, Math.round(c.pos.z * 10) / 10,
      Math.round((c.heading || 0) * 10) / 10, Math.round((c.speed || 0) * 10) / 10, Math.round((c.vs || 0) * 10) / 10, (c.gearDown ? 1 : 0) | (c.onGround ? 2 : 0)]);
  }
  if (!a.length && !W.sentSome) return;
  W.sentSome = a.length > 0;
  W.stats.trafficSent++;
  ch.send('world:traffic', { a });
}

ch.on('world:traffic', (d, from) => {
  if (!from || !from.host || ch.isHost) return;
  W.stats.trafficIn++;
  const t = now();
  const seen = new Set();
  for (const [id, type, x, y, z, h, v, vs, f] of d.a) {
    seen.add(id);
    let m = W.mirror.get(id);
    if (!m) {
      m = { id, type, model: null, failed: false, x, y, z, h, v, vs, f, dx: x, dy: y, dz: z, dh: h, at: t, bank: 0, lastH: h, pos: new THREE.Vector3(x, y, z), body: null };
      W.mirror.set(id, m);
      /*
       * In the sky's list (./sky.js) on this side too: the host's aeroplane
       * is on our minimap and solid to fly into, where it is drawn (m.pos,
       * kept by drawMirror). It is the host's to fly, so a hit here knocks
       * nothing down on their side: our own aeroplane has the bump.
       */
      try {
        const ty = getAircraft(type);
        m.body = registerBody({
          id: `mp-traffic-${id}`,
          kind: 'traffic',
          name: ty && ty.id === type ? `the ${ty.name}` : 'another aeroplane',
          pos: m.pos,
          vel: null,
          radius: ty && ty.id === type ? radiusOfType(ty) : 8,
          crew: 1,
          get heading() {
            return m.dh;
          },
          get onGround() {
            return !!(m.f & 2);
          },
        });
      } catch (e) {
        m.body = null;
      }
    }
    if (m.type !== type) {
      dropModel(m);
      m.type = type;
    }
    Object.assign(m, { x, y, z, h, v, vs, f, at: t });
  }
  for (const [id, m] of W.mirror) {
    if (!seen.has(id)) dropMirror(id, m);
  }
});

function dropModel(m) {
  if (m.model) m.model.removeFromParent();
  m.model = null;
}

/** Out of the mirror for good: its body goes with it (dropModel alone is also used for a type change). */
function dropMirror(id, m) {
  dropModel(m);
  if (m.body) unregisterBody(m.body);
  m.body = null;
  W.mirror.delete(id);
}

function clearMirror() {
  for (const [id, m] of [...W.mirror]) dropMirror(id, m);
  W.mirror.clear();
}

const Q = new THREE.Quaternion();
const E = new THREE.Euler();
const D2R = Math.PI / 180;

function buildMirrorModel(m) {
  if (m.model || m.failed || !W.group || !W.group.parent) return;
  try {
    const type = getAircraft(m.type);
    if (!type || type.id !== m.type) throw new Error('unknown type');
    const model = createAircraftModel({ type, livery: schemeFor(type, 'house') });
    const lights = [];
    model.traverse((o) => {
      if (o.isLight) lights.push(o);
    });
    for (const l of lights) if (l.parent) l.parent.remove(l);
    try {
      model.userData.groundOffsetY = model.userData.fleetBridge ? groundOffsetFor(model, specFor(type.id)) : 0;
    } catch (e) {
      model.userData.groundOffsetY = 0;
    }
    model.name = `mp-traffic-${m.id}`;
    W.group.add(model);
    m.model = model;
    m.fake = {
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(), vel: new THREE.Vector3(), omega: new THREE.Vector3(),
      controls: { pitch: 0, roll: 0, yaw: 0, brakes: 0, throttle: 0.6 }, rpm: 0.8, flaps: 0, gearPos: 1, gearDown: true, onGround: false,
      groundSpeed: 0, engineOn: true, agl: 500, crashed: false,
    };
  } catch (e) {
    m.failed = true;
  }
}

/** Every frame: each of the host's aeroplanes where the host has it now, eased so nothing jumps. */
function drawMirror(dt) {
  if (!W.mirror.size) return;
  const t = now();
  let built = false;
  for (const m of W.mirror.values()) {
    if (!m.model && !built) {
      buildMirrorModel(m);
      built = true;
    }
    const age = Math.min(1.5, (t - m.at) / 1000);
    const hr = m.h * D2R;
    // Where it is now: the last report, flown on for as long ago as that was.
    const px = m.x + Math.sin(hr) * m.v * age;
    const pz = m.z - Math.cos(hr) * m.v * age;
    const py = m.f & 2 ? m.y : m.y + m.vs * age;
    const k = 1 - Math.exp(-dt * 5);
    if (Math.hypot(px - m.dx, pz - m.dz) > 300) {
      m.dx = px;
      m.dy = py;
      m.dz = pz;
    } else {
      m.dx += (px - m.dx) * k;
      m.dy += (py - m.dy) * k;
      m.dz += (pz - m.dz) * k;
    }
    const dh = ((m.h - m.dh + 540) % 360) - 180;
    m.dh = (m.dh + dh * k + 360) % 360;
    // Where it is drawn is where it can be hit and where the map shows it (sky.js).
    m.pos.set(m.dx, m.dy, m.dz);
    // Bank from the turn it is making; nose up or down from its climb.
    const turn = (((m.h - m.lastH + 540) % 360) - 180) * D2R;
    m.lastH = m.h;
    const rate = dt > 0 ? turn / Math.max(dt, 1 / 60) : 0;
    const bankWant = m.f & 2 ? 0 : Math.max(-0.6, Math.min(0.6, Math.atan((m.v * rate) / 9.81)));
    m.bank += (bankWant - m.bank) * Math.min(1, dt * 2);
    const pitch = m.f & 2 || m.v < 1 ? 0 : Math.atan2(m.vs, m.v);
    if (!m.model) continue;
    const a = m.fake;
    a.pos.set(m.dx, m.dy, m.dz);
    E.set(pitch, -m.dh * D2R, -m.bank, 'YXZ');
    a.quat.setFromEuler(E);
    a.vel.set(Math.sin(m.dh * D2R) * m.v, m.vs, -Math.cos(m.dh * D2R) * m.v);
    a.onGround = !!(m.f & 2);
    a.gearDown = !!(m.f & 1);
    a.gearPos = a.gearDown ? 1 : 0;
    a.groundSpeed = m.v;
    a.agl = a.onGround ? 0 : 500;
    try {
      syncAircraftModel(m.model, a);
      if (m.model.userData.update) m.model.userData.update(dt, a, W.sim && W.sim.weather);
    } catch (e) {
      m.model.position.copy(a.pos);
      m.model.quaternion.copy(a.quat);
    }
  }
}

/* ---- the minimap: crashes and the host's aeroplanes ------------------------------------------------------- */

mp.minimapExtras.push((g, toXY) => {
  const t = now();
  W.marks = W.marks.filter((m) => t - m.at < 60000);
  for (const m of W.marks) {
    const [x, y, off] = toXY(m.x, m.z);
    // Past the rim it is not drawn: a cross pinned to the bezel read as a
    // mark on the chart (the crashes feature's own rule, marks.js).
    if (off) continue;
    const a = Math.max(0.25, 1 - (t - m.at) / 60000);
    g.globalAlpha = a;
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(8, 13, 22, 0.9)';
    g.lineWidth = 8;
    for (const s of [1, -1]) {
      g.beginPath();
      g.moveTo(x - 8, y - 8 * s);
      g.lineTo(x + 8, y + 8 * s);
      g.stroke();
    }
    g.strokeStyle = m.colour;
    g.lineWidth = 4.5;
    for (const s of [1, -1]) {
      g.beginPath();
      g.moveTo(x - 8, y - 8 * s);
      g.lineTo(x + 8, y + 8 * s);
      g.stroke();
    }
  }
  g.globalAlpha = 1;
  // The wildfire's smoke, seen from the van or the boat: a flame mark where it is.
  const sm = W.sights.smoke;
  if (sm && W.sim && W.sim.mode === 'drive') {
    const [x, y, off] = toXY(sm.x, sm.z);
    if (!off) {
      g.fillStyle = '#ff7a2a';
      g.strokeStyle = 'rgba(8, 13, 22, 0.9)';
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(x, y - 10);
      g.quadraticCurveTo(x + 8, y - 2, x + 5, y + 5);
      g.quadraticCurveTo(x, y + 9, x - 5, y + 5);
      g.quadraticCurveTo(x - 8, y - 2, x, y - 10);
      g.fill();
      g.stroke();
      g.fillStyle = '#ffd23f';
      g.beginPath();
      g.arc(x, y + 3, 2.6, 0, Math.PI * 2);
      g.fill();
    }
  }
  for (const m of W.mirror.values()) {
    const [x, y, off] = toXY(m.dx, m.dz);
    if (off) continue;
    g.fillStyle = 'rgba(230, 236, 244, 0.85)';
    g.strokeStyle = 'rgba(8, 13, 22, 0.8)';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, 4.5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
  }
});

/* ---- the Summon menu -------------------------------------------------------------------------------------- */

function paintSummon(sim) {
  // In the aeroplane, the helicopter, the van and the boat: everybody can summon, and everybody gets it.
  const free = sim.mode === 'free' || sim.mode === 'drive';
  const b = chip('summon', 2, () => toggleMenu());
  if (!b) return;
  if (b.hidden === free) b.hidden = !free;
  if (!b._done) {
    b._done = true;
    b.innerHTML = '⚡ Summon';
    b.title = 'Summon a natural disaster for everybody in this game';
  }
  if (!free && W.menuEl) W.menuEl.hidden = true;
}

function toggleMenu() {
  const row = mp.hud && mp.hud.ext;
  if (!row) return;
  injectStyle();
  if (!W.menuEl || !W.menuEl.isConnected) {
    W.menuEl = document.createElement('div');
    W.menuEl.className = 'mpp-menu';
    W.menuEl.hidden = true;
    W.menuEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-summon]');
      if (!btn) return;
      e.stopPropagation();
      W.menuEl.hidden = true;
      summon(btn.dataset.summon);
    });
    row.appendChild(W.menuEl);
  }
  const m = W.menuEl;
  if (!m.hidden) {
    m.hidden = true;
    return;
  }
  m.className = `mpp-menu ${mp.hud.menuUp ? 'is-up' : 'is-down'}`;
  // On the road or the water, the two flying games say what you will see from there.
  const drive = W.sim && W.sim.mode === 'drive';
  const hintOf = (s) => (drive && GROUND_HINTS[s.id]) || s.hint;
  m.innerHTML = `<h5>Summon for everybody</h5>${summonList().map((s) => `<button type="button" data-summon="${esc(s.id)}"><span aria-hidden="true">${s.icon}</span><b>${esc(s.name)}</b><small>${esc(hintOf(s))}</small></button>`).join('')}`
    + '<p>One at a time — the host says when the next can come.</p>';
  m.hidden = false;
}

/* ---- the plug-in ------------------------------------------------------------------------------------------- */

function startTimer() {
  clearInterval(W.timer);
  W.timer = setInterval(() => {
    try {
      if (!ch.active || !ch.isHost || !W.sim) return;
      hostWeather(W.sim);
      hostFire(W.sim);
    } catch (e) {
      /* next second */
    }
  }, 1000);
}

ch.on('mp:start', ({ role }) => {
  W.lastWx = null;
  W.fireAt = null;
  W.fireSent = null;
  W.lastGameSummon = -Infinity;
  W.lastBy.clear();
  clearMirror();
  startTimer();
  if (role === 'host' && W.sim) hostWeather(W.sim);
  // A player's own AI traffic stops: the host's is the one everybody sees.
  if (role !== 'host' && W.sim) {
    try {
      clearTraffic(W.sim);
    } catch (e) {
      /* traffic may be switched off */
    }
  }
});
ch.on('mp:host', () => {
  // The lobby re-formed round this tab: the old host's aeroplanes go, and in Dev mode this tab starts its own.
  clearMirror();
  W.lastWx = null;
  // What the old host said of its fire is kept by every player (events.js); this tab says its own from the next tick.
  W.fireSent = W.fireAt;
  if (W.sim) hostWeather(W.sim);
  try {
    const sim = W.sim;
    if (sim && sim.mode === 'free' && Prog.isDev((sim.menus && sim.menus.prog) || Prog.load())) {
      spawnTraffic(sim, 'depart');
      spawnTraffic(sim, 'arrive');
    }
  } catch (e) {
    /* traffic is a Dev-mode extra */
  }
});
ch.on('mp:end', () => {
  clearInterval(W.timer);
  W.timer = null;
  clearMirror();
  W.marks = [];
  W.fireAt = null;
  W.fireSent = null;
  W.sights.clear();
  if (W.hazard) clearHazard(W.sim);
  if (W.menuEl) W.menuEl.hidden = true;
});

registerExtension({
  id: 'mp-world',
  install(sim) {
    W.sim = sim;
  },
  buildWorld(sim, group) {
    W.sim = sim;
    W.group = group;
    W.sights.build(group);
    // The old models went with the old world.
    for (const m of W.mirror.values()) {
      m.model = null;
      m.failed = false;
    }
  },
  startMode(sim) {
    W.sim = sim;
    // Into the aeroplane: the real fire and meteors are there; the ground's sights go.
    W.sights.clear();
    fallbackHooks(sim);
  },
  update(sim, dt) {
    W.sim = sim;
    if (!inGame()) return;
    fallbackHooks(sim);
    if (sim.mode === 'drive') tickGround(sim, dt);
    else if (W.sights.smoke || W.sights.meteors) W.sights.clear();
    if (ch.isHost) hostTraffic(sim);
    else drawMirror(dt);
    paintSummon(sim);
  },
});

/**
 * The host's AI aeroplanes as this (not-host) game draws them, for
 * ./knockdown.js (through ./pilot-mp.js): they can knock a walking pilot
 * over too. Read-only: { type, dx, dy, dz (drawn position), dh (heading),
 * v (m/s), vs, f (1 gear down, 2 on the ground) } per aeroplane.
 */
export function mirrorTraffic() {
  return W.mirror;
}

/** For the tests and the console. */
export function worldDebug() {
  return {
    W, stats: { ...W.stats }, mirror: [...W.mirror.values()].map((m) => ({ id: m.id, type: m.type, x: m.dx, y: m.dy, z: m.dz, model: !!m.model })),
    marks: W.marks.slice(), crashes: crashesHere(), summonList: summonList(), cooldown: cooldownLeft, sights: W.sights.state(), hazard: W.hazard,
    // The host's two jobs, for a test that has no frames to wait for.
    hostWeather: () => W.sim && hostWeather(W.sim),
    hostFire: () => W.sim && hostFire(W.sim),
    fireAt: W.fireAt,
    landNear,
    fireSpot,
    hostTraffic: () => {
      W.trafficAt = -Infinity;
      if (W.sim) hostTraffic(W.sim);
    },
    drawMirror: (dt) => drawMirror(dt),
  };
}

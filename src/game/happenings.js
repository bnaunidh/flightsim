/**
 * Happenings — crashes and natural disasters as small events, so another
 * player's game can be told about them.
 *
 * "crashes show on minimap" and "natural disasters affect everyone, if you
 * summon them" were both on the list, and both are one player's moment that
 * the others ought to see. The crash team makes the moment; the multiplayer
 * team carries it across the network. This file is the whole contract
 * between the two, so neither has to read the other's code.
 *
 * THE API (everything is plain JSON — safe to send as it is):
 *
 *   import { onHappening, receiveHappening } from '../game/happenings.js';
 *
 *   // 1. Hear every crash and disaster THIS player has, and send it on.
 *   //    Skip `remote: true` ones — those came from someone else, and
 *   //    sending them back would bounce them round the lobby for ever.
 *   const off = onHappening((e) => { if (!e.remote && (e.type === 'crash' || e.summoned)) broadcast(e); });
 *
 *   // 2. When one arrives from another player, hand it over. `from` is who
 *   //    it was (their chosen name and colour); the crash lands on your
 *   //    minimap with their colour, a disaster is summoned here too if
 *   //    `apply` says so (Free Flight only — never in a mission or lesson).
 *   receiveHappening(sim, e, { name: 'Brave Otter', colour: '#ff9f1c', apply: true });
 *
 * The two shapes:
 *
 *   { type: 'crash', kind, vehicle, x, z, map, t }
 *       kind     one of CRASH_KINDS: 'cartwheel' | 'bellyflop' | 'splash' |
 *                'wingclip' | 'noseplant' | 'bonk'
 *       vehicle  'plane' | 'heli'
 *   { type: 'disaster', id, summoned, x, z, map, t }
 *       id       a disasters.js id: 'tornado', 'wildfire', 'microburst', …
 *       summoned true when the player asked for it — the pause menu's
 *                Disasters buttons, or armed on the Free Flight screen.
 *                False when the world did it: the randomiser, a mission's
 *                own tornado, the volcano's ash. "Natural disasters affect
 *                everyone, IF YOU SUMMON THEM" — send on the summoned ones.
 *
 *   x, z are world metres (north is -z), `map` the map id it happened on,
 *   `t` Date.now() when it happened. Nothing else is in them — no names, no
 *   text: the receiving game writes its own words from `kind` and `id`.
 *
 * receiveHappening checks everything (a kind or id it does not know, a map
 * it is not on, a number that is not a number) and quietly drops what is
 * wrong. It returns true if it did something with it.
 *
 * Listeners are fenced: one that throws is dropped with a warning and the
 * rest still hear the event. This file knows nothing about the game — the
 * crashes feature (src/features/crashes.js) registers what "receiving" means.
 */

export const CRASH_KINDS = ['cartwheel', 'bellyflop', 'splash', 'wingclip', 'noseplant', 'bonk', 'midair'];
export const CRASH_VEHICLES = ['plane', 'heli'];

const listeners = new Set();
const receivers = { crash: null, disaster: null };
const RECENT_MAX = 24;
const recent = [];

/** Hear every happening. Returns a function that stops listening. */
export function onHappening(fn) {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** For the game's own features: something happened here. */
export function emitHappening(e) {
  if (!e || (e.type !== 'crash' && e.type !== 'disaster')) return null;
  const out = { ...e, t: Number.isFinite(e.t) ? e.t : Date.now() };
  recent.push(out);
  if (recent.length > RECENT_MAX) recent.shift();
  for (const fn of [...listeners]) {
    try {
      fn(out);
    } catch (err) {
      listeners.delete(fn);
      console.warn('[happenings] a listener threw and was removed:', err);
    }
  }
  return out;
}

/** The last few, newest last — for a player who has just joined, and for the tests. */
export function recentHappenings() {
  return recent.slice();
}

/** The crashes feature says what receiving each type means. */
export function setHappeningReceiver(type, fn) {
  if (type in receivers) receivers[type] = typeof fn === 'function' ? fn : null;
}

/*
 * Where the next summoned disaster should happen, if it cares. A tornado
 * spawns near whoever summons it wherever they are, but a wildfire someone
 * else lit is at THEIR fire — so a received wildfire leaves its spot here and
 * the wildfire's own apply() picks it up (src/features/wildfire-disaster.js).
 * Taken once; a stale one is ignored after two seconds.
 */
let summonPoint = null;
export function setSummonPoint(p) {
  summonPoint = p && num(p.x) && num(p.z) ? { x: p.x, z: p.z, at: Date.now() } : null;
}
export function takeSummonPoint() {
  const p = summonPoint;
  summonPoint = null;
  return p && Date.now() - p.at < 2000 ? { x: p.x, z: p.z } : null;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v);
}
const LIMIT = 200000;

/** Is this a well-formed happening? Returns a clean copy, or null. */
export function cleanHappening(e) {
  if (!e || typeof e !== 'object') return null;
  if (!num(e.x) || !num(e.z) || Math.abs(e.x) > LIMIT || Math.abs(e.z) > LIMIT) return null;
  const base = { x: e.x, z: e.z, map: typeof e.map === 'string' ? e.map.slice(0, 40) : null, t: num(e.t) ? e.t : Date.now() };
  if (e.type === 'crash') {
    if (!CRASH_KINDS.includes(e.kind)) return null;
    const vehicle = CRASH_VEHICLES.includes(e.vehicle) ? e.vehicle : 'plane';
    return { type: 'crash', kind: e.kind, vehicle, ...base };
  }
  if (e.type === 'disaster') {
    if (typeof e.id !== 'string' || !/^[a-zA-Z]{2,24}$/.test(e.id)) return null;
    return { type: 'disaster', id: e.id, summoned: e.summoned === true, ...base };
  }
  return null;
}

/**
 * Another player's happening, arrived over the network.
 * @param from { name, colour, apply } — all optional.
 */
export function receiveHappening(sim, e, from = {}) {
  const clean = cleanHappening(e);
  if (!clean) return false;
  const fn = receivers[clean.type];
  if (!fn) return false;
  try {
    return !!fn(sim, clean, from || {});
  } catch (err) {
    console.warn('[happenings] could not receive', clean.type, err);
    return false;
  }
}

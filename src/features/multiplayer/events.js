/**
 * Game events: the channel other features use to play TOGETHER.
 *
 * Multiplayer already carries where everybody is (15 snapshots a second,
 * interp.js) and quick chat. Anything else two players' games must agree on
 * — a hit, a race start, a disaster somebody summoned, a gate passed, a
 * score — goes through this: typed events, and a little shared state that
 * the HOST owns. Part 2 of the list builds PvP, racing and world sync on it.
 *
 * USING IT, from any feature module:
 *
 *   import { multiplayer } from './multiplayer.js';
 *   const ch = multiplayer.events;
 *
 *   // 1. Say what may be sent, once, at load. Anything not defined is dropped everywhere.
 *   ch.define('race:gate', {
 *     validate: (d) => (Number.isInteger(d.gate) && d.gate >= 0 && d.gate < 40 ? { gate: d.gate } : null),
 *     rate: 5,                 // per player per second (default 10), bursts of twice that
 *   });
 *   ch.define('race:start', { from: 'host' });   // only the host may send it
 *
 *   // 2. Listen. `from` is { id, name, colour, host } — a name is a list-built
 *   //    username (protocol.js), safe to show; nothing else from `data` is.
 *   const off = ch.on('race:gate', (data, from, meta) => { ... });
 *
 *   // 3. Send.
 *   ch.send('race:gate', { gate: 3 });          // to everybody else (through the host)
 *   ch.send('race:gate', { gate: 3 }, { self: true });   // ...and to your own handlers too
 *   ch.toHost('pvp:hit', { target: 4 });        // only the host hears it: a claim for it to judge
 *   ch.sendTo(4, 'pvp:ouch', { by: 2 });        // host only: to one player
 *
 *   // 4. Shared state, host-authoritative: only the host writes; everybody
 *   //    (and anybody who joins later) reads the same value.
 *   ch.define('race', { from: 'host', validate: cleanRace });
 *   if (ch.isHost) ch.setState('race', { lap: 1, gates: 12 });
 *   ch.getState('race');
 *   ch.onState('race', (value) => { ... });
 *
 *   // 5. Who is here, and where you see them (what hit tests should use).
 *   ch.players()   // [{ id, name, colour, host, me, ride: { game, type }, pos, quat, vel, visible }]
 *   ch.active / ch.isHost / ch.me
 *
 *   // 6. Local happenings (never sent): 'mp:start' { role }, 'mp:end',
 *   //    'mp:join' / 'mp:leave' { id, name, colour }, 'mp:host' (this tab is the host now).
 *
 * HOST-AUTHORITATIVE, and why. The host's tab is the server (session.js):
 * every event a player sends goes to the host first; the host checks it is a
 * kind it knows, that this player may send it, that it passes the kind's
 * validate(), and that the player is not over the rate — and only then
 * passes the CLEANED data on, stamped with who sent it. So a modified tab
 * cannot speak for anybody else, flood the game or send a kind nobody
 * defined; and a claim ("I hit Sam") sent with toHost() is only an event the
 * moment the host says so, with send() or setState(). Players check what
 * arrives again (validate() and `from`), in case the host is the modified one.
 *
 * NO FREE TEXT. This game is played by ten-year-olds and nothing anybody
 * types is ever shown to anybody else (protocol.js, names). Without a
 * validate(), data may be numbers, booleans, null, arrays and plain objects
 * of those, and strings only as ids — 24 letters, digits, - and _ at most —
 * never words to put on the screen: send a number and look the words up
 * locally, as quick chat does. One event is at most 1.5 KB of JSON, one
 * state value 2 KB, 64 state keys.
 *
 * In a lobby the host can change (lobby.js): the state is kept by every
 * player, so whoever hosts next already has it, and sends it on to anybody
 * new. Out of a game — single-player, or between games — send() returns
 * false, handlers are simply not called, and state is empty: features can
 * call this unconditionally.
 *
 * Example that ties to the owner's list — natural disasters affect everyone:
 *
 *   ch.define('disaster', { from: 'host', validate: (d) => (DISASTERS.includes(d.kind) ? { kind: d.kind, x: +d.x || 0, z: +d.z || 0 } : null) });
 *   ch.define('disaster:ask', { validate: (d) => (DISASTERS.includes(d.kind) ? { kind: d.kind } : null), rate: 0.2 });
 *   // a player summons one: ch.toHost('disaster:ask', { kind: 'wildfire' });
 *   // the host decides, and everybody (itself too) starts it: ch.send('disaster', {...}, { self: true })
 *
 * No DOM, no three.js: the node tests run a host and players through it.
 */

export const KIND_RE = /^[a-z][a-z0-9]*(?:[.:_-][a-z0-9]+){0,3}$/;
export const KIND_MAX = 32;
export const DATA_MAX_BYTES = 1500;
export const STATE_MAX_BYTES = 2000;
export const STATE_KEYS_MAX = 64;
const ID_STRING = /^[A-Za-z0-9_-]{0,24}$/;

/** The data an event may carry when its kind brings no validate(): no free text. Returns a clean copy or undefined. */
export function plainData(d, depth = 0) {
  if (d === null || typeof d === 'boolean') return d;
  if (typeof d === 'number') return Number.isFinite(d) ? d : undefined;
  if (typeof d === 'string') return ID_STRING.test(d) ? d : undefined;
  if (depth > 4 || typeof d !== 'object') return undefined;
  if (Array.isArray(d)) {
    if (d.length > 64) return undefined;
    const out = [];
    for (const x of d) {
      const c = plainData(x, depth + 1);
      if (c === undefined) return undefined;
      out.push(c);
    }
    return out;
  }
  const keys = Object.keys(d);
  if (keys.length > 32) return undefined;
  const out = {};
  for (const k of keys) {
    if (!ID_STRING.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') return undefined;
    const c = plainData(d[k], depth + 1);
    if (c === undefined) return undefined;
    out[k] = c;
  }
  return out;
}

function sizeOf(v) {
  try {
    return JSON.stringify(v === undefined ? null : v).length;
  } catch (e) {
    return Infinity;
  }
}

const nowMs = () => (globalThis.performance ? performance.now() : Date.now());

export class GameEvents {
  constructor({ now = nowMs } = {}) {
    this.now = now;
    this.kinds = new Map();
    this.handlers = new Map();
    this.stateHandlers = new Map();
    this.state = new Map();
    this.session = null;
    this.role = null;
    this.meId = null;
    this._buckets = new Map();
    /** Set by the controller: () => the players list for players(). */
    this.roster = () => [];
    /** What was dropped and why, the last twenty, for the console and the tests. */
    this.dropped = [];
  }

  /* ---- the feature's side ------------------------------------------------ */

  /**
   * Say that `kind` may be sent. `validate(data)` returns the data to deliver
   * (cleaned) or null to drop it; `from` is 'anyone' or 'host'; `rate` is per
   * player per second.
   */
  define(kind, { validate = null, from = 'anyone', rate = 10 } = {}) {
    if (typeof kind !== 'string' || kind.length > KIND_MAX || !KIND_RE.test(kind) || kind.startsWith('mp:')) {
      throw new Error(`multiplayer events: "${kind}" is not a kind that can be defined (lower-case words joined by : . _ or -, not mp:)`);
    }
    this.kinds.set(kind, { validate: typeof validate === 'function' ? validate : null, host: from === 'host', rate: Math.max(0.05, Number(rate) || 10) });
    return this;
  }

  on(kind, fn) {
    return add(this.handlers, kind, fn);
  }

  onState(key, fn) {
    return add(this.stateHandlers, key, fn);
  }

  get active() {
    return !!(this.session && this.role);
  }

  get isHost() {
    return this.role === 'host';
  }

  get me() {
    return this.active ? this.players().find((p) => p.me) || null : null;
  }

  players() {
    try {
      return this.roster() || [];
    } catch (e) {
      return [];
    }
  }

  getState(key) {
    return this.state.get(key);
  }

  /** To everybody else in the game. `{ self: true }` also calls this tab's own handlers. */
  send(kind, data = null, { self = false } = {}) {
    const clean = this._check(kind, data, this.meId, 'send');
    if (clean === undefined || !this.active) return false;
    const def = this.kinds.get(kind);
    if (def.host && !this.isHost) return this._drop(kind, 'only the host sends this');
    if (!this._take(this.meId, kind, def)) return this._drop(kind, 'too many, too fast');
    const ok = this.isHost ? this.session.sendGame({ k: kind, d: clean, f: 0 }) : this.session.sendGame({ k: kind, d: clean });
    if (self) this._deliver(kind, clean, this._whoIs(this.meId), { self: true });
    return ok !== false;
  }

  /** Only the host hears it — a claim or a request for the host to decide on. On the host, straight to its own handlers. */
  toHost(kind, data = null) {
    const clean = this._check(kind, data, this.meId, 'toHost');
    if (clean === undefined || !this.active) return false;
    const def = this.kinds.get(kind);
    if (!this._take(this.meId, kind, def)) return this._drop(kind, 'too many, too fast');
    if (this.isHost) {
      this._deliver(kind, clean, this._whoIs(this.meId), { toHost: true, self: true });
      return true;
    }
    return this.session.sendGame({ k: kind, d: clean, h: 1 }) !== false;
  }

  /** Host only: to one player. */
  sendTo(id, kind, data = null) {
    if (!this.isHost) return false;
    const clean = this._check(kind, data, 0, 'sendTo');
    if (clean === undefined) return false;
    return this.session.sendGameTo(id, { k: kind, d: clean, f: 0 }) !== false;
  }

  /** Host only: set (or, with undefined or null, clear) a shared value everybody sees. */
  setState(key, value) {
    if (!this.isHost) return false;
    if (value === undefined || value === null) {
      if (!this.state.has(key)) return true;
      this.state.delete(key);
      this.session.sendGameState({ k: key, d: null });
      this._stateChanged(key, undefined);
      return true;
    }
    const clean = this._check(key, value, 0, 'setState', STATE_MAX_BYTES);
    if (clean === undefined) return false;
    if (!this.state.has(key) && this.state.size >= STATE_KEYS_MAX) return this._drop(key, 'too many state keys');
    this.state.set(key, clean);
    this.session.sendGameState({ k: key, d: clean });
    this._stateChanged(key, clean);
    return true;
  }

  /* ---- the controller's side (multiplayer.js) ----------------------------- */

  /** A session began, or this tab's role in it changed (a lobby re-formed). */
  attach(session, role, meId) {
    const was = this.role;
    // Between hosts (detach with keepState): the same game going on, not a new one.
    const resumed = !this.session && was !== null;
    this.session = session;
    this.role = role;
    this.meId = meId;
    this._buckets.clear();
    if (!resumed && was === null) this._local('mp:start', { role });
    if (role === 'host') {
      if (resumed && was !== 'host') this._local('mp:host', { id: meId });
      // Whoever hosts now has the state everybody agreed on; say it again, so nobody is behind.
      for (const [k, d] of this.state) session.sendGameState({ k, d });
    } else if (session && session.gstate instanceof Map) {
      // What the host said before this was hooked up — a joiner's first values arrive right behind the welcome.
      for (const [k, d] of session.gstate) this.stateFromWire({ k, d });
    }
  }

  /** The game is over for this tab (left, dropped, kicked), or it is between hosts: `keepState` for the latter. */
  detach({ keepState = false } = {}) {
    if (!this.session && !this.role) return;
    const ended = !keepState;
    this.session = null;
    if (ended) {
      this.role = null;
      this.meId = null;
      const keys = [...this.state.keys()];
      this.state.clear();
      for (const k of keys) this._stateChanged(k, undefined);
      this._local('mp:end', {});
    }
  }

  /** A new player is in (host): send them the shared state, one key a message. */
  joined(p) {
    if (this.isHost && this.session) for (const [k, d] of this.state) this.session.sendGameStateTo(p.id, { k, d });
    this._local('mp:join', p);
  }

  left(p) {
    for (const key of [...this._buckets.keys()]) if (key.startsWith(`${p.id}|`)) this._buckets.delete(key);
    this._local('mp:leave', p);
  }

  /**
   * An event off the wire. On the host, from player `from` (as the session
   * knows them): checked, and relayed unless it was for the host. On a
   * player, from the host's relay: checked again and delivered.
   */
  fromWire(from, ev) {
    if (!this.active || !ev || !from) return;
    const kind = ev.k;
    const def = typeof kind === 'string' ? this.kinds.get(kind) : null;
    if (!def) return this._drop(String(kind).slice(0, KIND_MAX), 'not a defined kind');
    if (this.isHost) {
      // `from` is the player whose channel it came in on: whatever they claim, it is theirs.
      if (def.host) return this._drop(kind, `${from.name} is not the host`);
      const clean = this._clean(def, ev.d, DATA_MAX_BYTES);
      if (clean === undefined) return this._drop(kind, 'failed validate()');
      if (!this._take(from.id, kind, def)) return this._drop(kind, `${from.name} is sending too fast`);
      if (ev.h) return this._deliver(kind, clean, from, { toHost: true });
      this.session.sendGame({ k: kind, d: clean, f: from.id }, from.id);
      this._deliver(kind, clean, from, {});
      return undefined;
    }
    // A player: only ever from the host's relay, and a host-only kind only if the host itself sent it.
    if (def.host && !from.host) return this._drop(kind, 'a host-only kind not from the host');
    const clean = this._clean(def, ev.d, DATA_MAX_BYTES);
    if (clean === undefined) return this._drop(kind, 'failed validate()');
    this._deliver(kind, clean, from, {});
    return undefined;
  }

  /** A state value off the wire (players only). */
  stateFromWire(ev) {
    if (!this.active || this.isHost || !ev || typeof ev.k !== 'string') return;
    const def = this.kinds.get(ev.k);
    if (!def) return this._drop(ev.k.slice(0, KIND_MAX), 'not a defined state key');
    if (ev.d === null) {
      if (this.state.delete(ev.k)) this._stateChanged(ev.k, undefined);
      return;
    }
    const clean = this._clean(def, ev.d, STATE_MAX_BYTES);
    if (clean === undefined) return this._drop(ev.k, 'failed validate()');
    if (!this.state.has(ev.k) && this.state.size >= STATE_KEYS_MAX) return;
    this.state.set(ev.k, clean);
    this._stateChanged(ev.k, clean);
  }

  /* ---- inside ------------------------------------------------------------------ */

  _check(kind, data, who, how, max = DATA_MAX_BYTES) {
    const def = this.kinds.get(kind);
    if (!def) {
      this._drop(kind, `${how}: define() it first`);
      return undefined;
    }
    const clean = this._clean(def, data, max);
    if (clean === undefined) this._drop(kind, `${how}: failed validate() or too big`);
    return clean;
  }

  _clean(def, data, max) {
    let clean;
    try {
      clean = def.validate ? def.validate(data === undefined ? null : data) : plainData(data === undefined ? null : data);
    } catch (e) {
      clean = undefined;
    }
    if (clean === undefined || (def.validate && clean === null && data !== null && data !== undefined)) return undefined;
    // A validate() that returns text or deep objects is still held to the size.
    return sizeOf(clean) <= max ? clean : undefined;
  }

  /** A token bucket per player per kind: `rate` a second, bursts of twice that. */
  _take(id, kind, def) {
    const key = `${id}|${kind}`;
    const t = this.now();
    let b = this._buckets.get(key);
    if (!b) {
      b = { tokens: def.rate * 2, at: t };
      this._buckets.set(key, b);
    }
    b.tokens = Math.min(def.rate * 2, b.tokens + ((t - b.at) / 1000) * def.rate);
    b.at = t;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  _whoIs(id) {
    const p = this.players().find((x) => x.id === id);
    return p ? { id: p.id, name: p.name, colour: p.colour, host: !!p.host } : { id, name: '', colour: '', host: id === 0 };
  }

  _deliver(kind, data, from, meta) {
    const set = this.handlers.get(kind);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(data, from, meta);
      } catch (e) {
        console.warn(`[mp events] a handler for "${kind}" threw`, e);
      }
    }
  }

  _stateChanged(key, value) {
    const set = this.stateHandlers.get(key);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(value);
      } catch (e) {
        console.warn(`[mp events] a state handler for "${key}" threw`, e);
      }
    }
  }

  _local(kind, data) {
    this._deliver(kind, data, null, { local: true });
  }

  _drop(kind, why) {
    this.dropped.push(`${kind}: ${why}`);
    if (this.dropped.length > 20) this.dropped.shift();
    return false;
  }
}

function add(map, key, fn) {
  if (typeof fn !== 'function') return () => {};
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(fn);
  return () => {
    const s = map.get(key);
    if (s) s.delete(fn);
  };
}

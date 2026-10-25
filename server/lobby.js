/**
 * One lobby, as the server sees it — the logic, with nothing of Cloudflare
 * in it. worker.js wraps a LobbyRoom in a Durable Object; the node harness
 * (tests/features/cf-lobby.fakes.js) wraps the same class in a fake one.
 *
 * WHAT IT IS. In the game today one player's tab is the server (session.js
 * HostSession) and relays everybody's snapshots to everybody. Here the room
 * is the host: nobody hosts, nobody can be the host that leaves, and nobody's
 * tab has to be reachable from anybody else's — every player holds one
 * WebSocket to the room, over 443, which school networks let through where
 * they block WebRTC. The room speaks the SAME protocol the host does
 * (protocol.js: hello/welcome/join/leave/roster/chat/ping/pong/gev on text
 * frames, the 45-byte snapshots and their bundles on binary frames), so the
 * player's side of the game (session.js ClientSession) is unchanged: it
 * thinks it joined a host whose id is 0 and who never says anything.
 *
 * WHAT IT CHECKS, which a host made of somebody's browser could not be
 * trusted to:
 *   - a snapshot is relayed under the id of the socket it came in on (as the
 *     host already does), never the id it claimed;
 *   - a snapshot that says the aeroplane is outside the world, faster than
 *     anything in the hangar (SPEED_CAP), or further from its last place
 *     than anything could have flown since (JUMP_CAP) is dropped — unless
 *     the next ones agree with it, which is a respawn after a crash, and
 *     those are let through;
 *   - snapshots over STATE_HZ × 2 a second are dropped, events over a
 *     bucket (roomier than the game's own per-kind limits add up to) are
 *     dropped, and a socket that keeps doing either — strikes wear off, so
 *     a lot of crashes is not "keeps" — is closed, its key kept out, and an
 *     address kicked three times in the ban is kept out too;
 *   - chat is the game's preset lines, by index (protocol.js QUICK_CHAT);
 *     anything with text in it goes through filter.js, and goes nowhere if
 *     that says no;
 *   - names are call signs from the lists, or the one the room gives;
 *   - the relay goes out at a capped tick (TICK_HZ, 15 by default): the
 *     newest snapshot of everybody else, bundled, no more often than that,
 *     however fast anybody sends.
 *
 * WHAT IT DOES NOT DO (this round): no admin powers (the host's signature
 * check, admin.js, needs the admin keys — the room lets an admin in as
 * anybody), and no host-only game events ('gev' with h: 1 — the races, PvP
 * hit claims, the host's AI traffic). Those features need a host, and a cloud lobby has none.
 *
 * Players are 1..PLAYER_IDS-1 under this protocol version (the client refuses
 * a seat of 0, the host's, or beyond PLAYER_IDS): with PROTO 4 that is seven.
 * MAX_PLAYERS (16 by default, set in wrangler.toml) is the room's own cap;
 * the smaller of the two applies, so the room grows when the protocol does.
 */

import {
  PROTO, PLAYER_IDS, QUICK_CHAT, GAMES, STATE_HZ, STATE_HEAD, EVENT_MAX_BYTES, BUMP_DEFAULT, BUMP_RULES,
  readEvent, writeEvent, decodeState, stampStateId, encodeBundle,
  parseCallSign, callSignForId, uniqueName, safeColour, randomToken, mapIndex, mapNameFor, worldName, worldMap, WORLD_COUNT,
} from '../src/features/multiplayer/protocol.js';
import { cleanChat } from './filter.js';

export const DEFAULTS = Object.freeze({
  /** The room's own cap; the protocol's id space caps it further (see the top of this file). */
  maxPlayers: 16,
  /** Relay tick: the newest of everybody else goes out to each player at most this often. */
  tickHz: STATE_HZ,
  /** A socket that has not said hello by then is closed. */
  helloMs: 10000,
  /** Silent for this long after its first snapshot: gone. */
  timeoutMs: 12000,
  /** ...and this long while it is still loading the island. */
  loadingTimeoutMs: 45000,
  pingEveryMs: 2000,
  rosterEveryMs: 5000,
  /** One quick-chat line per player per this many ms (the host's own rule). */
  chatGapMs: 1200,
  /**
   * Events (not ping/pong): a bucket of this many, refilled at eventsPerSec.
   * Roomy on purpose: the game's own per-kind limits (events.js define()
   * rates) add up past 20 a second in a dogfight — pvp:hit alone may go at
   * 12, pvp:fire 4, bump:knock 6 — and a player inside those must never be
   * striking. This only stops a flood.
   */
  eventsBurst: 60,
  eventsPerSec: 30,
  /** Snapshots accepted per second per player; the rest are dropped unread. */
  statesPerSec: STATE_HZ * 2,
  /** Faster than this (m/s) and the snapshot is not believed. The fastest aeroplane in the hangar is well under half of it. */
  speedCapMps: 900,
  /** A jump between two snapshots faster than this (m/s) is not believed either... */
  jumpCapMps: 1200,
  /** ...unless this many in a row agree with it: a respawn. */
  respawnAfter: 3,
  /** Rejected snapshots and dropped events add up; this many and the socket is closed and the key kept out for banMs. */
  strikesToKick: 60,
  /**
   * ...but they wear off, this many a second: every respawn costs two jump
   * strikes, and a player who crashed thirty times in an afternoon is not
   * a cheat. A flood (hundreds a second) still reaches strikesToKick at once.
   */
  strikeDecayPerSec: 0.5,
  banMs: 10 * 60 * 1000,
  /** Kicked this many times within banMs from one address (a fresh key each time): the address is kept out too. */
  kicksPerAddress: 3,
  /** The world's edges, metres: the biggest island is a few kilometres across. */
  worldHalf: 60000,
  skyTop: 30000,
  seaFloor: -500,
});

/** The biggest snapshot there is: head, the longest type id, the walker's tail. */
export const STATE_MAX_BYTES = STATE_HEAD + 24 + 19;

const DENY_CLOSE_MS = 400;

/**
 * What a room is called and which island it is on, from its id. The game's
 * world lobbies are `world-<PROTO>-<n>` (transport.js maps protocol.js
 * worldId(n) onto that); anything else is a private room, named for nobody.
 */
export function roomInfoFor(id) {
  const m = /^world-(\d{1,3})-([1-9])$/.exec(String(id || ''));
  const n = m && Number(m[1]) === PROTO ? Number(m[2]) : 0;
  if (n >= 1 && n <= WORLD_COUNT) return { id, name: worldName(n), map: worldMap(n), game: 'flight', lobby: n, world: true, priv: false };
  return { id: String(id || ''), name: 'A server', map: worldMap(1), game: 'flight', lobby: 0, world: false, priv: true };
}

/** Is this an id a room may have? Short, lower-case, nothing a URL or a key would trip on. */
export function validRoomId(id) {
  return /^[a-z0-9][a-z0-9-]{0,39}$/.test(String(id || ''));
}

const nowMs = () => Date.now();

/** Heading in degrees from a snapshot: the way it is going if it is going anywhere, else the way its nose points. */
function headingOf(snap) {
  const v = snap.vel || {};
  const sp = Math.hypot(v.x || 0, v.z || 0);
  if (sp > 5) return ((Math.atan2(v.x, -v.z) * 180) / Math.PI + 360) % 360;
  // The nose: (0, 0, -1) turned by the quaternion.
  const q = snap.quat || { x: 0, y: 0, z: 0, w: 1 };
  const fx = -(2 * (q.x * q.z + q.w * q.y));
  const fz = -(1 - 2 * (q.x * q.x + q.y * q.y));
  return ((Math.atan2(fx, -fz) * 180) / Math.PI + 360) % 360;
}

export class LobbyRoom {
  /**
   * @param id        the room's id (roomInfoFor reads the name and island off it)
   * @param now       the clock, ms (Date.now in the Worker; the tests pass their own)
   * @param onCount   called when the head-count changes, with describe()
   * @param onEmpty   called when the last player goes
   */
  constructor({ id, now = nowMs, onCount = null, onEmpty = null, ...opts } = {}) {
    this.id = String(id || 'room');
    this.info = roomInfoFor(this.id);
    this.now = now;
    this.opts = { ...DEFAULTS, ...opts };
    /** Effective cap: the room's, or as many seats as the protocol has ids for (1..PLAYER_IDS-1). */
    this.max = Math.max(1, Math.min(this.opts.maxPlayers, PLAYER_IDS - 1));
    this.tickMs = 1000 / this.opts.tickHz;
    /** Random, in the welcome's server.h: the client compares it with the list's and never sees it change. */
    this.token = randomToken().slice(0, 12);
    this.bump = BUMP_DEFAULT;
    /** Every socket, hello'd or not → its record. */
    this.conns = new Map();
    /** Players by id. */
    this.players = new Map();
    /** Keys kept out, → until (ms). */
    this.banned = new Map();
    this.onCount = onCount || (() => {});
    this.onEmpty = onEmpty || (() => {});
    this._rank = 0;
    this._rosterDirty = false;
    this._rosterT = -Infinity;
    this._pingT = -Infinity;
    this.closed = false;
    /** Counters, for the health line and the tests. */
    this.stats = { joined: 0, left: 0, relayed: 0, bundles: 0, dropped: { bad: 0, bounds: 0, speed: 0, jump: 0, rate: 0, events: 0, chat: 0 }, kicked: 0, respawns: 0 };
  }

  get count() {
    return this.players.size;
  }

  get full() {
    return this.players.size >= this.max;
  }

  /** The head-count and the island, for the lobby list — numbers and list words, never a player's name. */
  describe() {
    return {
      id: this.id,
      name: this.info.name,
      players: this.count,
      max: this.max,
      map: this.info.map,
      mapName: mapNameFor(this.info.map),
      m: mapIndex(this.info.map),
      game: this.info.game,
      g: Math.max(0, GAMES.indexOf(this.info.game)),
      bump: BUMP_RULES[this.bump],
      b: this.bump,
      h: this.token,
      lobby: this.info.lobby,
      world: this.info.world,
      v: PROTO,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Sockets                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * A socket has connected. `sock` is anything with send(data) and
   * close(code, reason); `attach(obj)` if it has one is given the player's
   * seat once they are in, so a Durable Object that hibernated can give it
   * back as `restore`.
   */
  connect(sock, { ip = null, restore = null } = {}) {
    if (this.closed || !sock || this.conns.has(sock)) return null;
    const now = this.now();
    const c = {
      sock, ip, id: null, name: null, colour: null, key: null, seat: null, rank: 0, joinedAt: now,
      lastHeard: now, lastSnap: null, lastBuf: null, lastPos: null, lastT: 0, jumpRun: 0,
      strikes: 0, strikeAt: now, bucket: this.opts.eventsBurst, bucketAt: now, stateWindow: [], chatAt: -Infinity, ping: null,
      out: new Map(), outAt: -Infinity, helloAt: now,
    };
    this.conns.set(sock, c);
    if (restore && Number.isInteger(restore.id) && restore.id >= 1 && restore.id < PLAYER_IDS && !this.players.has(restore.id)) {
      // Back from hibernation: the seat is theirs again, without a new hello.
      Object.assign(c, { id: restore.id, name: restore.name, colour: safeColour(restore.colour), key: restore.key, seat: restore.seat || null, rank: restore.rank || ++this._rank });
      if (!parseCallSign(c.name)) c.name = callSignForId(c.id);
      this.players.set(c.id, c);
      this._rosterDirty = true;
    }
    return c;
  }

  /** Something arrived on a socket: a text frame is an event, a binary one a snapshot. */
  message(sock, data) {
    const c = this.conns.get(sock);
    // A refused or kicked socket is only waiting for its refusal to land: nothing it says is read (its old seat may be somebody else's by now).
    if (!c || this.closed || c.denied) return;
    c.lastHeard = this.now();
    if (typeof data === 'string') {
      if (data.length > EVENT_MAX_BYTES) return this._strike(c, 'events');
      const ev = readEvent(data);
      if (!ev) return this._strike(c, 'events');
      return this._event(c, ev);
    }
    const buf = data instanceof ArrayBuffer ? data : data && data.buffer instanceof ArrayBuffer ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : null;
    if (!buf) return this._strike(c, 'bad');
    return this._state(c, buf);
  }

  /** A socket closed, or errored. */
  close(sock, reason = 'closed') {
    const c = this.conns.get(sock);
    if (!c) return;
    this.conns.delete(sock);
    if (c.id != null && this.players.get(c.id) === c) this._gone(c, reason === 'bye' ? 'left' : 'dropped', reason);
  }

  _send(c, ev) {
    try {
      c.sock.send(writeEvent(ev));
      return true;
    } catch (err) {
      return false;
    }
  }

  _sendState(c, buf) {
    try {
      c.sock.send(buf);
      return true;
    } catch (err) {
      return false;
    }
  }

  _drop(c, code, reason) {
    this.conns.delete(c.sock);
    try {
      c.sock.close(code, reason);
    } catch (err) {
      /* already gone */
    }
  }

  _deny(c, why, extra = null) {
    this._send(c, { ...(extra || {}), t: 'deny', why });
    // Let the refusal arrive before the line goes dead (the host's own courtesy).
    c.denyAt = this.now() + DENY_CLOSE_MS;
    c.denied = true;
  }

  /* ---------------------------------------------------------------- */
  /* Events                                                            */
  /* ---------------------------------------------------------------- */

  _takeToken(c) {
    const now = this.now();
    c.bucket = Math.min(this.opts.eventsBurst, c.bucket + ((now - c.bucketAt) / 1000) * this.opts.eventsPerSec);
    c.bucketAt = now;
    if (c.bucket < 1) return false;
    c.bucket -= 1;
    return true;
  }

  _event(c, ev) {
    if (ev.t === 'ping') return this._send(c, { t: 'pong', ts: ev.ts });
    if (ev.t === 'pong') {
      if (Number.isFinite(ev.ts)) c.ping = Math.max(0, this.now() - ev.ts);
      return;
    }
    if (!this._takeToken(c)) return this._strike(c, 'events');
    if (c.id == null) {
      if (ev.t === 'hello' && !c.denied) return this._hello(c, ev);
      return;
    }
    switch (ev.t) {
      case 'chat': {
        if (c.muted) return;
        const now = this.now();
        if (now - c.chatAt < this.opts.chatGapMs) return;
        const r = cleanChat(ev, QUICK_CHAT.length);
        if (!r.ok) return this._strike(c, 'chat');
        c.chatAt = now;
        this._broadcast(r.text != null ? { t: 'chat', id: c.id, text: r.text } : { t: 'chat', id: c.id, m: r.m }, c.id);
        break;
      }
      case 'bye':
        this._gone(c, 'left', 'bye');
        this._drop(c, 1000, 'bye');
        break;
      case 'gev':
        // Game events (events.js): relayed to everybody, under the id it came in on. Host-only ones (h: 1) have no host to go to.
        if (typeof ev.k !== 'string' || ev.k.length > 32 || ev.h) return;
        this._broadcast({ t: 'gev', k: ev.k, d: ev.d, f: c.id }, c.id);
        break;
      default:
        // hello again, adm, unown, prove, info?: nothing a room answers.
        break;
    }
  }

  _hello(c, ev) {
    if (Number(ev.v) !== PROTO) return this._deny(c, 'version');
    const key = typeof ev.key === 'string' && /^[\x21-\x7e]{1,40}$/.test(ev.key) ? ev.key : `ip:${c.ip || 'unknown'}`;
    const until = Math.max(this.banned.get(key) || 0, (c.ip && this.banned.get(`addr:${c.ip}`)) || 0);
    if (until > this.now()) return this._deny(c, 'kicked');
    const seat = typeof ev.seat === 'string' && /^[a-z0-9]{8,24}$/.test(ev.seat) ? ev.seat : null;
    // The same tab coming back: its old seat goes, so its own username does not keep it out.
    if (seat) for (const old of [...this.players.values()]) if (old.seat === seat) this._gone(old, 'left', 'came back');
    if (this.full) return this._deny(c, 'full');
    let id = 1;
    while (this.players.has(id)) id++;
    if (id > this.max || id >= PLAYER_IDS) return this._deny(c, 'full');
    const taken = [...this.players.values()].map((p) => p.name);
    const own = parseCallSign(ev.name) ? ev.name : null;
    if (own && taken.includes(own)) return this._deny(c, 'name', { suggest: uniqueName(own, taken) });
    c.id = id;
    c.name = own || uniqueName(callSignForId(id), taken);
    c.colour = safeColour(ev.colour);
    c.key = key;
    c.seat = seat;
    c.rank = ++this._rank;
    c.joinedAt = this.now();
    this.players.set(id, c);
    this.stats.joined++;
    if (typeof c.sock.attach === 'function') {
      try {
        c.sock.attach({ id, name: c.name, colour: c.colour, key, seat, rank: c.rank });
      } catch (err) {
        /* a socket that keeps nothing */
      }
    }
    this._send(c, {
      t: 'welcome',
      v: PROTO,
      you: id,
      name: c.name,
      server: { name: this.info.name, map: this.info.map, mapName: mapNameFor(this.info.map), game: this.info.game, lobby: this.info.lobby || undefined, max: Math.min(this.max, PLAYER_IDS), priv: this.info.priv, bump: this.bump, h: this.token, cloud: 1 },
      players: this.roster(),
      at: this.spawnFor(c),
      weather: null,
    });
    this._broadcast({ t: 'join', p: this._pub(c) }, id);
    this._rosterDirty = true;
    this.onCount(this.describe());
  }

  /** Where to drop a joiner: beside whoever is already here (the player who has been here longest and has said where they are). */
  spawnFor(except) {
    let best = null;
    for (const p of this.players.values()) {
      if (p === except || !p.lastSnap) continue;
      if (!best || p.rank < best.rank) best = p;
    }
    if (!best) return null;
    const s = best.lastSnap;
    const sp = Math.hypot(s.vel.x || 0, s.vel.y || 0, s.vel.z || 0);
    return { x: s.pos.x, y: s.pos.y, z: s.pos.z, heading: headingOf(s), speed: sp, agl: s.onGround ? 0 : 100, onGround: !!s.onGround };
  }

  _pub(p) {
    return { id: p.id, name: p.name, colour: p.colour, host: false, ping: p.ping == null ? null : Math.round(p.ping), rank: p.rank, mu: p.muted ? 1 : undefined };
  }

  roster() {
    return [...this.players.values()].sort((a, b) => a.id - b.id).map((p) => this._pub(p));
  }

  _broadcast(ev, except = -1) {
    const text = writeEvent(ev);
    for (const q of this.players.values()) {
      if (q.id === except) continue;
      try {
        q.sock.send(text);
      } catch (err) {
        /* its close will follow */
      }
    }
  }

  _strike(c, what) {
    if (what in this.stats.dropped) this.stats.dropped[what]++;
    const now = this.now();
    c.strikes = Math.max(0, c.strikes - ((now - (c.strikeAt ?? now)) / 1000) * this.opts.strikeDecayPerSec);
    c.strikeAt = now;
    c.strikes++;
    if (c.strikes >= this.opts.strikesToKick) this.kick(c, 'strikes');
  }

  /** Out, and kept out for banMs by key. The room's own call: nobody in it can ask for it. */
  kick(c, why = 'kicked') {
    const until = this.now() + this.opts.banMs;
    if (c.key) this.banned.set(c.key, until);
    if (c.ip) {
      // A cleared browser is a new key; the same address kicked again and again is kept out as well.
      this.kicks = this.kicks || new Map();
      const recent = (this.kicks.get(c.ip) || []).filter((t) => t > this.now() - this.opts.banMs);
      recent.push(this.now());
      this.kicks.set(c.ip, recent);
      if (recent.length >= this.opts.kicksPerAddress) this.banned.set(`addr:${c.ip}`, until);
    }
    this.stats.kicked++;
    if (c.id != null && this.players.get(c.id) === c) {
      this._send(c, { t: 'kick' });
      this.players.delete(c.id);
      this._broadcast({ t: 'leave', id: c.id, why: 'kicked' });
      this._rosterDirty = true;
      this.stats.left++;
      this.onCount(this.describe());
      if (!this.players.size) this.onEmpty();
    }
    c.denied = true;
    c.denyAt = this.now() + 300;
    c.kickedFor = why;
  }

  _gone(c, why, detail = why) {
    if (c.id == null || this.players.get(c.id) !== c) return;
    this.players.delete(c.id);
    this.stats.left++;
    this._broadcast({ t: 'leave', id: c.id, why: why === 'left' ? 'left' : 'dropped' });
    this._rosterDirty = true;
    c.id = null;
    this.onCount(this.describe());
    if (!this.players.size) this.onEmpty();
    void detail;
  }

  /* ---------------------------------------------------------------- */
  /* Snapshots                                                         */
  /* ---------------------------------------------------------------- */

  _state(c, buf) {
    if (c.id == null) return;
    if (buf.byteLength > STATE_MAX_BYTES) return this._strike(c, 'bad');
    const now = this.now();
    // No more than statesPerSec a second from one player; the rest are not even read.
    const w = c.stateWindow;
    while (w.length && now - w[0] > 1000) w.shift();
    if (w.length >= this.opts.statesPerSec) {
      this.stats.dropped.rate++;
      return;
    }
    w.push(now);
    const snap = decodeState(buf);
    if (!snap) return this._strike(c, 'bad');
    const { pos, vel } = snap;
    const o = this.opts;
    if (!(Math.abs(pos.x) <= o.worldHalf && Math.abs(pos.z) <= o.worldHalf && pos.y >= o.seaFloor && pos.y <= o.skyTop)) return this._strike(c, 'bounds');
    if (Math.hypot(vel.x, vel.y, vel.z) > o.speedCapMps) return this._strike(c, 'speed');
    if (c.lastPos) {
      const dt = Math.max(0.001, (now - c.lastT) / 1000);
      const dist = Math.hypot(pos.x - c.lastPos.x, pos.y - c.lastPos.y, pos.z - c.lastPos.z);
      if (dist > 50 && dist / dt > o.jumpCapMps) {
        c.jumpRun++;
        if (c.jumpRun < o.respawnAfter) {
          // Not believed — yet. Three in a row from the new place is a respawn, and those go through.
          c.lastT = now;
          return this._strike(c, 'jump');
        }
        this.stats.respawns++;
      }
    }
    c.jumpRun = 0;
    c.lastPos = { x: pos.x, y: pos.y, z: pos.z };
    c.lastT = now;
    stampStateId(buf, c.id);
    snap.id = c.id;
    c.lastSnap = snap;
    c.lastBuf = buf;
    this.stats.relayed++;
    for (const q of this.players.values()) if (q !== c) this._queue(q, c.id, buf, now);
  }

  /** Hold `buf` (player `id`'s newest) for q; send q's packet now if it is due. */
  _queue(q, id, buf, now) {
    q.out.set(id, buf);
    if (now - q.outAt >= this.tickMs) this._flush(q, now);
  }

  _flush(q, now) {
    if (!q.out.size) return;
    q.outAt = now;
    const bufs = [...q.out.values()];
    q.out.clear();
    if (bufs.length === 1) {
      this._sendState(q, bufs[0]);
      this.stats.bundles++;
      return;
    }
    // A bundle holds at most PLAYER_IDS snapshots (protocol.js decodeBundle): a bigger room sends two.
    for (let i = 0; i < bufs.length; i += PLAYER_IDS) {
      const part = bufs.slice(i, i + PLAYER_IDS);
      this._sendState(q, part.length === 1 ? part[0] : encodeBundle(part));
      this.stats.bundles++;
    }
  }

  /* ---------------------------------------------------------------- */
  /* The tick                                                          */
  /* ---------------------------------------------------------------- */

  /** Called at the tick rate (or oftener; it does nothing that is not due). */
  tick(now = this.now()) {
    if (this.closed) return;
    for (const c of [...this.conns.values()]) {
      // A refusal has had its moment to land: the line goes.
      if (c.denied) {
        if (now >= c.denyAt) this._drop(c, 1000, c.kickedFor || 'denied');
        continue;
      }
      if (c.id == null) {
        if (now - c.helloAt > this.opts.helloMs) this._drop(c, 1000, 'no-hello');
        continue;
      }
      const limit = c.lastSnap ? this.opts.timeoutMs : this.opts.loadingTimeoutMs;
      if (now - c.lastHeard > limit) {
        this._gone(c, 'dropped', 'silent');
        this._drop(c, 1000, 'silent');
        continue;
      }
      if (c.out.size && now - c.outAt >= this.tickMs) this._flush(c, now);
    }
    if (now - this._pingT >= this.opts.pingEveryMs) {
      this._pingT = now;
      this._broadcast({ t: 'ping', ts: now });
    }
    if (this.players.size && (this._rosterDirty || now - this._rosterT > this.opts.rosterEveryMs)) {
      this._rosterDirty = false;
      this._rosterT = now;
      this._broadcast({ t: 'roster', players: this.roster() });
    }
    if (this.banned.size > 64) for (const [k, until] of this.banned) if (until <= now) this.banned.delete(k);
    if (this.kicks && this.kicks.size > 64) for (const [ip, list] of this.kicks) if (!list.some((t) => t > now - this.opts.banMs)) this.kicks.delete(ip);
  }

  /** Everybody out, kindly: the server is going away (a deploy, a shutdown). */
  shutdown() {
    if (this.closed) return;
    this.closed = true;
    this._broadcast({ t: 'close' });
    for (const c of [...this.conns.values()]) this._drop(c, 1001, 'shutdown');
    this.players.clear();
  }
}

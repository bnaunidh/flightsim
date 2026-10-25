/**
 * The lobby server on Cloudflare: a Worker in front of two kinds of Durable
 * Object. Nothing in here is game logic — that is lobby.js, which the node
 * harness runs without Cloudflare at all.
 *
 *   GET  /health                 { ok, v, max }            is anybody home, which protocol version
 *   GET  /lobbies                [ describe()... ]         every room with somebody in it (the Directory)
 *   GET  /lobby/<id>  (Upgrade)  the WebSocket into room <id> — one Lobby object per id
 *   GET  /lobby/<id>             describe() for that one room
 *
 * The game is a static site on another origin (GitHub Pages), so the JSON
 * answers carry CORS headers; a WebSocket needs none. ALLOWED_ORIGIN in
 * wrangler.toml narrows them from "*" once the owner knows the site's address.
 *
 * RATE LIMITS, best effort and per isolate (a Worker has no shared memory
 * across the edge; these stop one bored tab, not a botnet): CONNECTS_PER_MIN
 * upgrades a minute from one address, LIST_PER_MIN reads of the list. A
 * whole classroom is ONE address (the school's), and every tab on the lobby
 * screen reads the list every four seconds — so the defaults are a class's
 * worth (thirty tabs), and the list itself is kept for LIST_CACHE_MS in the
 * isolate, so however many ask, the Directory is asked about once a second.
 *
 * ROOMS live in a `Lobby` Durable Object each, with the hibernatable
 * WebSocket API: the object may be put to sleep between messages and its
 * sockets kept by the platform; each socket carries the player's seat as an
 * attachment, and on waking the room is rebuilt from them. While anybody is
 * in, a timer runs the room's tick (lobby.js). The `Directory` object keeps
 * the lobby list: every room reports its head-count there as it changes,
 * and an entry nobody has reported for a minute is forgotten.
 *
 * No keys, no account ids: wrangler.toml holds placeholders, and the owner's
 * own Cloudflare login does the deploy (README.md).
 */

import { LobbyRoom, roomInfoFor, validRoomId, DEFAULTS } from './lobby.js';
import { PROTO } from '../src/features/multiplayer/protocol.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function cors(env, extra = {}) {
  return {
    ...extra,
    'access-control-allow-origin': (env && env.ALLOWED_ORIGIN) || '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '600',
  };
}

const json = (body, env, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: cors(env, { ...JSON_HEADERS, ...extra }) });

/**
 * The 101 for a WebSocketPair. Cloudflare's Response takes { webSocket };
 * node's refuses status 101 outright (the harness reads .webSocket off the
 * plain object instead — the only place the two runtimes differ).
 */
function upgradeResponse(client) {
  try {
    return new Response(null, { status: 101, webSocket: client });
  } catch (err) {
    return { status: 101, webSocket: client, headers: new Map() };
  }
}

/** A sliding one-minute window per key, in this isolate's memory. */
class Window {
  constructor(limit) {
    this.limit = limit;
    this.hits = new Map();
  }

  allow(key, now = Date.now()) {
    let list = this.hits.get(key);
    if (!list) this.hits.set(key, (list = []));
    while (list.length && now - list[0] > 60000) list.shift();
    if (list.length >= this.limit) return false;
    list.push(now);
    if (this.hits.size > 5000) this.hits.clear(); // never grow without bound
    return true;
  }
}

/** The limiters, by name — made for the limit in force (the vars are fixed per deployment; the tests run two). */
const LIMITS = {};
function limiter(name, limit) {
  if (!LIMITS[name] || LIMITS[name].limit !== limit) LIMITS[name] = new Window(limit);
  return LIMITS[name];
}

/** A class's worth from one (school) address: thirty tabs joining, with a retry or two each... */
export const DEFAULT_CONNECTS_PER_MIN = 120;
/** ...and thirty lobby screens reading the list every four seconds (transport.js CloudWatch). */
export const DEFAULT_LIST_PER_MIN = 600;
/** A room with anybody in it tells the Directory its head-count at least this often (the Directory forgets after a minute). */
export const REPORT_EVERY_MS = 20000;
/** The list, kept in the isolate this long: the Directory is one object for the whole world. */
export const LIST_CACHE_MS = 1000;

let LIST_KEPT = null;
/** The lobby list, from the Directory — or the copy this isolate read under LIST_CACHE_MS ago. */
async function listOf(env, now = Date.now()) {
  if (LIST_KEPT && LIST_KEPT.env === env && now - LIST_KEPT.at < LIST_CACHE_MS) return LIST_KEPT.list;
  const dir = env.DIRECTORY.get(env.DIRECTORY.idFromName('main'));
  const res = await dir.fetch('https://directory/list');
  const list = await res.json();
  LIST_KEPT = { env, at: now, list };
  return list;
}

const ipOf = (request) => request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'unknown';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(env) });
    if (request.method !== 'GET') return json({ error: 'method' }, env, 405);
    if (path === '/health' || path === '/') {
      return json({ ok: true, v: PROTO, max: Math.min(Number(env.MAX_PLAYERS) || DEFAULTS.maxPlayers, 255), tickHz: Number(env.TICK_HZ) || DEFAULTS.tickHz }, env);
    }
    if (path === '/lobbies') {
      if (!limiter('list', Number(env.LIST_PER_MIN) || DEFAULT_LIST_PER_MIN).allow(ipOf(request))) return json({ error: 'slow down' }, env, 429, { 'retry-after': '10' });
      return json(await listOf(env), env);
    }
    const m = /^\/lobby\/([^/]+)$/.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]).toLowerCase();
      if (!validRoomId(id)) return json({ error: 'bad lobby id' }, env, 400);
      const upgrade = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
      if (upgrade) {
        if (!limiter('connect', Number(env.CONNECTS_PER_MIN) || DEFAULT_CONNECTS_PER_MIN).allow(ipOf(request))) return json({ error: 'slow down' }, env, 429, { 'retry-after': '30' });
      }
      const stub = env.LOBBY.get(env.LOBBY.idFromName(id));
      const headers = new Headers(request.headers);
      headers.set('x-lobby-id', id);
      headers.set('x-player-ip', ipOf(request));
      return stub.fetch(new Request(`https://lobby/${id}`, { method: 'GET', headers }));
    }
    return json({ error: 'not found' }, env, 404);
  },
};

/* ------------------------------------------------------------------ */
/* One room                                                            */
/* ------------------------------------------------------------------ */

/**
 * The room's view of a platform WebSocket, one per socket, kept while the
 * object is awake. The attachment the platform keeps through a sleep carries
 * the room's id as well as the seat: an object woken by a message has no
 * request to read its id from.
 */
function wrapSocket(ws, roomId) {
  return {
    ws,
    send: (data) => ws.send(data),
    close: (code, reason) => ws.close(code, reason),
    attach: (obj) => {
      if (typeof ws.serializeAttachment === 'function') ws.serializeAttachment({ room: roomId, ...obj });
    },
  };
}

function attachmentOf(ws) {
  try {
    return typeof ws.deserializeAttachment === 'function' ? ws.deserializeAttachment() : null;
  } catch (err) {
    return null;
  }
}

export class Lobby {
  constructor(state, env) {
    this.ctx = state;
    this.env = env || {};
    this.room = null;
    this.id = null;
    this.wrappers = new Map();
    this._timer = null;
    this._reportT = null;
    this._reportedAt = -Infinity;
  }

  _opts() {
    const env = this.env;
    const n = (k, d) => (Number.isFinite(Number(env[k])) && env[k] !== '' && env[k] != null ? Number(env[k]) : d);
    return { maxPlayers: n('MAX_PLAYERS', DEFAULTS.maxPlayers), tickHz: n('TICK_HZ', DEFAULTS.tickHz), speedCapMps: n('SPEED_CAP_MPS', DEFAULTS.speedCapMps) };
  }

  /** The room, made on the first request and rebuilt from the kept sockets after a sleep. */
  _room(id) {
    if (this.room) return this.room;
    const kept = typeof this.ctx.getWebSockets === 'function' ? this.ctx.getWebSockets() : [];
    if (!id && !this.id) {
      // Woken by a message, not a request: the id is on every kept socket.
      for (const ws of kept) {
        const a = attachmentOf(ws);
        if (a && validRoomId(a.room)) {
          this.id = a.room;
          break;
        }
      }
    }
    this.id = id || this.id || 'room';
    this.room = new LobbyRoom({
      id: this.id,
      ...this._opts(),
      onCount: () => this._report(),
      onEmpty: () => this._report(true),
    });
    for (const ws of kept) this.room.connect(this._wrap(ws), { restore: attachmentOf(ws) });
    if (this.room.count) this._startTimer();
    return this.room;
  }

  _wrap(ws) {
    let w = this.wrappers.get(ws);
    if (!w) this.wrappers.set(ws, (w = wrapSocket(ws, this.id)));
    return w;
  }

  async fetch(request) {
    const id = (request.headers.get('x-lobby-id') || new URL(request.url).pathname.split('/').pop() || '').toLowerCase();
    const room = this._room(validRoomId(id) ? id : 'room');
    const upgrade = (request.headers.get('upgrade') || '').toLowerCase() === 'websocket';
    if (!upgrade) return json(room.describe(), this.env);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    const w = this._wrap(server);
    w.attach({});
    room.connect(w, { ip: request.headers.get('x-player-ip') || null });
    this._startTimer();
    return upgradeResponse(client);
  }

  webSocketMessage(ws, message) {
    this._room().message(this._wrap(ws), message);
  }

  webSocketClose(ws, code, reason) {
    this._room().close(this._wrap(ws), reason === 'bye' ? 'bye' : 'closed');
    this.wrappers.delete(ws);
    this._maybeStop();
  }

  webSocketError(ws) {
    this._room().close(this._wrap(ws), 'error');
    this.wrappers.delete(ws);
    this._maybeStop();
  }

  /** The housekeeping alarm, every 30 s while anybody is in: a tick even if the timer was lost to a sleep. */
  async alarm() {
    const room = this._room();
    room.tick(Date.now());
    if (room.count) this._report();
    if (room.conns.size) {
      this._startTimer();
      await this.ctx.storage.setAlarm(Date.now() + 30000);
    }
  }

  _startTimer() {
    if (this._timer) return;
    const room = this._room();
    this._timer = setInterval(() => {
      const now = Date.now();
      room.tick(now);
      // The Directory forgets a room nobody has reported for DIRECTORY_TTL_MS: a room whose head-count holds still says so again.
      if (room.count && now - this._reportedAt > REPORT_EVERY_MS) this._report();
      this._maybeStop();
    }, Math.max(20, Math.round(room.tickMs)));
    this.ctx.storage.setAlarm(Date.now() + 30000).catch?.(() => {});
  }

  _maybeStop() {
    const room = this.room;
    if (!room || room.conns.size) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  /** Tell the Directory the head-count — at most once a second, at once when the room empties. */
  _report(gone = false) {
    const dir = this.env.DIRECTORY;
    if (!dir || !this.room) return;
    const send = () => {
      this._reportT = null;
      this._reportedAt = Date.now();
      const room = this.room;
      if (!room) return;
      const body = JSON.stringify(room.count ? room.describe() : { id: room.id, players: 0 });
      const stub = dir.get(dir.idFromName('main'));
      const p = stub.fetch(new Request(`https://directory/${room.count ? 'report' : 'gone'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
      if (this.ctx.waitUntil) this.ctx.waitUntil(p.catch(() => {}));
      else p.catch(() => {});
    };
    if (gone) {
      clearTimeout(this._reportT);
      send();
      return;
    }
    if (this._reportT) return;
    // Counted from now, so the heartbeat does not ask again while this one waits.
    this._reportedAt = Date.now();
    this._reportT = setTimeout(send, 1000);
  }
}

/* ------------------------------------------------------------------ */
/* The lobby list                                                      */
/* ------------------------------------------------------------------ */

const DIRECTORY_TTL_MS = 60000;

export class Directory {
  constructor(state, env) {
    this.ctx = state;
    this.env = env || {};
    this.rooms = null;
  }

  async _load() {
    if (this.rooms) return this.rooms;
    let kept = null;
    try {
      kept = await this.ctx.storage.get('rooms');
    } catch (err) {
      kept = null;
    }
    this.rooms = new Map(Array.isArray(kept) ? kept : []);
    return this.rooms;
  }

  async _save() {
    try {
      await this.ctx.storage.put('rooms', [...this.rooms.entries()]);
    } catch (err) {
      /* the list is a convenience; the rooms are the truth */
    }
  }

  async fetch(request) {
    const rooms = await this._load();
    const path = new URL(request.url).pathname;
    const now = Date.now();
    if (request.method === 'POST' && (path === '/report' || path === '/gone')) {
      let body = null;
      try {
        body = await request.json();
      } catch (err) {
        body = null;
      }
      const id = body && typeof body.id === 'string' && validRoomId(body.id) ? body.id : null;
      if (!id) return new Response('{"error":"bad report"}', { status: 400, headers: JSON_HEADERS });
      if (path === '/gone' || !(Number(body.players) > 0)) rooms.delete(id);
      else {
        // Only the numbers and list words lobby.js describe() sends; nothing a room says is shown as text but its own list name.
        const info = roomInfoFor(id);
        const n = (v, d) => (Number.isInteger(v) ? v : d);
        rooms.set(id, { id, name: info.name, players: Math.min(255, n(body.players, 1)), max: Math.min(255, n(body.max, 8)), m: n(body.m, -1), g: n(body.g, 0), b: n(body.b, 2), h: typeof body.h === 'string' ? body.h.slice(0, 16) : '', v: n(body.v, 0), lobby: info.lobby, world: info.world, at: now });
      }
      await this._save();
      return new Response('{"ok":true}', { headers: JSON_HEADERS });
    }
    if (path === '/list') {
      const out = [];
      for (const [id, r] of rooms) {
        if (now - r.at > DIRECTORY_TTL_MS) rooms.delete(id);
        else out.push(r);
      }
      return new Response(JSON.stringify(out), { headers: JSON_HEADERS });
    }
    return new Response('{"error":"not found"}', { status: 404, headers: JSON_HEADERS });
  }
}

/**
 * The cloud transport: the world lobbies over one WebSocket to the lobby
 * server (server/), instead of a WebRTC star round a host.
 *
 * The player's side of the game (session.js ClientSession, and everything
 * above it) talks to a `net` and the `link` it hands back:
 *
 *   net.connect(target, kind, meta) → link      link.send(ev) / link.sendState(buf)
 *   net.pingInfo(target) → { r, meta }          link.onopen / onevent / onstate / onclose
 *   net.sig.id, net.sig.isOpen, net.destroy()   link.state, isOpen, lastHeard, close(reason)
 *
 * link.js gives it those over WebRTC; this file gives it the same over a
 * WebSocket to `<server>/lobby/<room>`. The room speaks the host's protocol
 * (server/lobby.js), so the ClientSession does not know which it got. A
 * target is a world lobby's id (protocol.js worldId); the room's id is the
 * same minus the `ifs-` — every copy of this version of the game meets in
 * the same room, as it meets at the same PeerJS id.
 *
 * FALLING BACK. multiplayer.js asks probeLobbyServer() first: no address
 * configured (config.js), or /health not answering within a couple of
 * seconds, or a server built for another protocol version, and the join
 * goes the tab-to-tab way without a word to the player. A connection that
 * is refused or dropped BEFORE the welcome falls back the same way.
 *
 * Nothing here knows about Cloudflare: any server speaking server/lobby.js's
 * protocol at those paths will do.
 */

import { PROTO, PLAYER_IDS, LOBBY_MAX, WORLD_COUNT, worldId, worldMap, mapNameFor, mapAtIndex, GAMES, BUMP_RULES, bumpRule, readEvent, writeEvent } from './protocol.js';
import { LOBBY_SERVER_URL } from './config.js';

/** How long a cloud join may take to connect: one TCP + TLS handshake to the nearest edge; eight seconds is generous. */
export const CLOUD_CONNECT_MS = 8000;
/** /health is asked at most this often while it answers... */
export const PROBE_OK_MS = 60000;
/** ...and this often after it did not. */
export const PROBE_FAIL_MS = 15000;
/** How long /health gets to answer. */
export const PROBE_TIMEOUT_MS = 2500;

const nowMs = () => (globalThis.performance ? performance.now() : Date.now());

/** A page served from this computer (a developer's copy), not the published game. */
export function isDevPage(loc = globalThis.location) {
  const h = loc && typeof loc.hostname === 'string' ? loc.hostname.toLowerCase() : '';
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
}

/**
 * The server's address: an override (a test, the controller), else
 * ?lobby=... in the page's address — on a developer's own copy only
 * (localhost), so a link somebody shares cannot send the published game's
 * players to a server of theirs — else config.js. '' for none. Only
 * http(s)/ws(s) URLs, with no path, query or trailing slash.
 */
export function lobbyServerUrl(override) {
  let raw = override;
  if (raw === undefined) {
    try {
      const loc = globalThis.location;
      const q = loc && typeof loc.search === 'string' && isDevPage(loc) ? new URLSearchParams(loc.search).get('lobby') : null;
      raw = q != null ? q : LOBBY_SERVER_URL;
    } catch (err) {
      raw = LOBBY_SERVER_URL;
    }
  }
  if (typeof raw !== 'string') return '';
  const s = raw.trim();
  if (!s) return '';
  let u;
  try {
    u = new URL(s);
  } catch (err) {
    return '';
  }
  if (!/^(https?|wss?):$/.test(u.protocol)) return '';
  return `${u.protocol}//${u.host}`;
}

/** The room a target lives in: protocol.js worldId(n) 'ifs-world-4-1' → 'world-4-1'. */
export function roomIdFor(target) {
  return String(target || '').toLowerCase().replace(/^ifs-/, '').replace(/[^a-z0-9-]/g, '-').slice(0, 40);
}

export function httpUrlFor(base, path = '') {
  return `${base.replace(/^ws(s?):/, 'http$1:')}${path}`;
}

export function wsUrlFor(base, roomId) {
  return `${base.replace(/^http(s?):/, 'ws$1:')}/lobby/${encodeURIComponent(roomId)}`;
}

async function fetchJson(fetchImpl, url, ms) {
  if (typeof fetchImpl !== 'function') return null;
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const PROBES = new Map();

/** Forget what /health said (the tests, between servers). */
export function forgetProbes() {
  PROBES.clear();
}

/**
 * Is the lobby server there, and ours? { ok: true, v, max } or null —
 * remembered for a minute when it is, fifteen seconds when it is not, so
 * a list that repaints and a join a moment later ask once.
 */
export async function probeLobbyServer(base, { fetchImpl = globalThis.fetch, ms = PROBE_TIMEOUT_MS, now = nowMs } = {}) {
  const url = lobbyServerUrl(base);
  if (!url) return null;
  const t = now();
  const kept = PROBES.get(url);
  if (kept && t < kept.until) return kept.info;
  if (kept && kept.asking) return kept.asking;
  const asking = fetchJson(fetchImpl, httpUrlFor(url, '/health'), ms).then((h) => {
    const info = h && h.ok === true && Number(h.v) === PROTO ? { ok: true, v: PROTO, max: Number(h.max) || 0, url } : null;
    PROBES.set(url, { info, until: now() + (info ? PROBE_OK_MS : PROBE_FAIL_MS) });
    return info;
  });
  PROBES.set(url, { info: null, until: -Infinity, asking });
  return asking;
}

const rid = () => Math.random().toString(36).slice(2, 12);

/**
 * One WebSocket to one room, with a Link's face on it. Text frames are the
 * events, binary frames the snapshots — the two channels of link.js, on one
 * socket (a WebSocket is ordered and reliable; the server's tick, not a
 * retransmit queue, is what keeps a late snapshot from queueing ahead of
 * the next).
 */
export class CloudLink {
  constructor(net, { peer, kind = 'join', meta = null, url }) {
    this.net = net;
    this.peer = peer;
    this.kind = kind;
    this.meta = meta || {};
    this.url = url;
    this.connectionId = `ws_${rid()}`;
    this.initiator = true;
    this.state = 'new';
    this.ws = null;
    this.onopen = null;
    this.onevent = null;
    this.onstate = null;
    this.onclose = null;
    this.closeReason = null;
    this.lastHeard = 0;
    this._timer = null;
    /** For anything that reads a Link's ICE tally: nothing is ever sent through a signaling server here. */
    this.candidates = { sent: 0, kept: 0 };
    this.share = 'none';
  }

  start() {
    this.state = 'connecting';
    const WS = this.net.WS;
    if (typeof WS !== 'function') return this.close('rtc');
    let ws;
    try {
      ws = new WS(this.url);
    } catch (err) {
      return this.close('ice');
    }
    this.ws = ws;
    try {
      ws.binaryType = 'arraybuffer';
    } catch (err) {
      /* a socket that takes no hint */
    }
    const own = Math.min(60000, Number(this.meta && this.meta.connectMs) || 0);
    const ms = own > 0 ? own : this.net.connectTimeoutMs;
    this._timer = setTimeout(() => this.state !== 'open' && this.close('timeout'), ms);
    ws.onopen = () => {
      if (this.state !== 'connecting') return;
      this.state = 'open';
      this.lastHeard = this.net.now();
      clearTimeout(this._timer);
      if (this.onopen) this.onopen(this);
    };
    ws.onmessage = (e) => {
      this.lastHeard = this.net.now();
      const d = e && e.data;
      if (typeof d === 'string') {
        const ev = readEvent(d);
        if (ev && this.onevent) this.onevent(ev, this);
      } else if (d && typeof d.byteLength === 'number') {
        if (this.onstate) this.onstate(d instanceof ArrayBuffer ? d : d.buffer ? d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) : d, this);
      } else if (d && typeof d.arrayBuffer === 'function') {
        // A Blob, from a socket that ignored binaryType.
        d.arrayBuffer().then((buf) => this.state === 'open' && this.onstate && this.onstate(buf, this)).catch(() => {});
      }
    };
    ws.onclose = () => this.close(this.state === 'open' ? 'dropped' : 'ice');
    ws.onerror = () => {
      /* onclose follows */
    };
    return undefined;
  }

  get isOpen() {
    return this.state === 'open';
  }

  send(ev) {
    if (this.state !== 'open' || !this.ws) return false;
    try {
      this.ws.send(writeEvent(ev));
      return true;
    } catch (err) {
      return false;
    }
  }

  sendState(buf) {
    if (this.state !== 'open' || !this.ws) return false;
    // A backed-up socket means a slow line; drop this one rather than queue it (link.js does the same).
    if ((this.ws.bufferedAmount || 0) > 64 * 1024) return false;
    try {
      this.ws.send(buf);
      return true;
    } catch (err) {
      return false;
    }
  }

  close(reason = 'local') {
    if (this.state === 'closed') return;
    const was = this.state;
    this.state = 'closed';
    this.closeReason = reason;
    clearTimeout(this._timer);
    this.net._forget(this);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close(1000, reason === 'local' ? 'bye' : reason);
      } catch (err) {
        /* already closed */
      }
    }
    if (this.onclose) this.onclose(reason, was, this);
  }
}

/**
 * A Net for one lobby server.
 *
 * `sig` is what a ClientSession reads of its signaling socket: an id for the
 * admin proof text (no admin check runs in a cloud room; see server/lobby.js)
 * and isOpen for the gone-probe — kept false, so no probe runs: the room
 * pings every two seconds, and a room that has gone closes the socket, so
 * there is nothing to ask the list about between.
 */
export class CloudNet {
  constructor(base, { WebSocketImpl, fetchImpl, now, connectTimeoutMs = CLOUD_CONNECT_MS } = {}) {
    this.base = lobbyServerUrl(base);
    this.WS = WebSocketImpl || globalThis.WebSocket;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.now = now || nowMs;
    this.connectTimeoutMs = connectTimeoutMs;
    this.links = new Map();
    this.sig = { id: 'cloud', isOpen: false, kind: 'cloud' };
    this.onsigclose = null;
    this.answersPings = false;
    this.pongMeta = null;
    this.onOffer = null;
    this.destroyed = false;
  }

  get available() {
    return !!this.base && typeof this.WS === 'function';
  }

  get cloud() {
    return true;
  }

  connect(peer, kind = 'join', meta) {
    const link = new CloudLink(this, { peer, kind, meta, url: wsUrlFor(this.base, roomIdFor(peer)) });
    this.links.set(link.connectionId, link);
    link.start();
    return link;
  }

  _forget(link) {
    if (this.links.get(link.connectionId) === link) this.links.delete(link.connectionId);
  }

  /** The lobby list: every room with somebody in it, as server/lobby.js describe()s it; [] when the server is away. */
  async lobbies(ms = PROBE_TIMEOUT_MS) {
    const list = await fetchJson(this.fetchImpl, httpUrlFor(this.base, '/lobbies'), ms);
    return Array.isArray(list) ? list.filter((e) => e && typeof e === 'object' && typeof e.id === 'string') : null;
  }

  /** Is anybody in that room? A pong's shape (protocol.js readLobbyCount), from the list. */
  async pingInfo(peer, ms = 5000) {
    const list = await this.lobbies(ms);
    if (!list) return { r: 'timeout', meta: null };
    const e = list.find((x) => x.id === roomIdFor(peer));
    if (!e) return { r: 'empty', meta: null };
    return { r: 'here', meta: { k: 'pong', v: Number(e.v) | 0, n: e.players | 0, max: e.max | 0, m: e.m, g: e.g, h: e.h, b: e.b } };
  }

  ping(peer, ms = 5000) {
    return this.pingInfo(peer, ms).then((x) => x.r);
  }

  destroy() {
    this.destroyed = true;
    for (const link of [...this.links.values()]) link.close('local');
  }
}

/**
 * The world lobbies' list from the server, in the shape lobbyui.js paints
 * (lobby.js LobbyWatch): five rows, each { n, state, players, max, map,
 * mapName, game, bump, at }. One GET every few seconds while the screen is
 * up and the tab is visible — for all five rows at once, where the
 * peer-to-peer list pings each lobby on its own.
 */
export class CloudWatch {
  constructor({ net, onChange, everyMs = 4000, active = () => true, now = nowMs }) {
    this.net = net;
    this.onChange = onChange || (() => {});
    this.everyMs = everyMs;
    this.active = active;
    this.now = now;
    this.world = true;
    this.running = false;
    this._timer = null;
    this.lobbies = [];
    for (let n = 1; n <= WORLD_COUNT; n++) {
      const home = worldMap(n);
      this.lobbies.push({ n, state: 'looking', players: 0, max: LOBBY_MAX, home, map: home, mapName: mapNameFor(home), game: 'flight', bump: 'pvp', at: -Infinity, cloud: true });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._poll();
  }

  stop() {
    this.running = false;
    clearTimeout(this._timer);
    this._timer = null;
  }

  /** The lobby with the most room, other than n (lobbyRefused): open with the fewest in, else an empty one. */
  emptiest(except) {
    const open = this.lobbies.filter((l) => l.n !== except && (l.state === 'open' || l.state === 'empty'));
    open.sort((a, b) => (a.state === 'empty') - (b.state === 'empty') || a.players - b.players || a.n - b.n);
    return open[0] || null;
  }

  async _poll() {
    if (!this.running) return;
    let list = null;
    if (this.active()) list = await this.net.lobbies();
    if (!this.running) return;
    if (list) this._apply(list);
    this._timer = setTimeout(() => this._poll(), this.everyMs);
  }

  _apply(list) {
    const t = this.now();
    let changed = false;
    for (const l of this.lobbies) {
      const e = list.find((x) => x.id === roomIdFor(worldId(l.n)));
      const was = `${l.state}|${l.players}|${l.map}`;
      if (!e) Object.assign(l, { state: 'empty', players: 0, max: LOBBY_MAX, map: l.home, mapName: mapNameFor(l.home), game: 'flight', bump: 'pvp', at: t });
      else {
        const max = Math.max(1, Math.min(Number(e.max) | 0 || LOBBY_MAX, PLAYER_IDS));
        const players = Math.max(0, Math.min(Number(e.players) | 0, max));
        const map = mapAtIndex(Number(e.m)) || l.home;
        const g = Number(e.g);
        Object.assign(l, {
          state: Number(e.v) !== PROTO ? 'old' : players >= max ? 'full' : players > 0 ? 'open' : 'empty',
          players, max, map, mapName: mapNameFor(map), game: Number.isInteger(g) && GAMES[g] ? GAMES[g] : 'flight', bump: BUMP_RULES[bumpRule(e.b)], at: t,
        });
      }
      if (`${l.state}|${l.players}|${l.map}` !== was) changed = true;
    }
    if (changed) this.onChange(this.lobbies, null);
  }
}

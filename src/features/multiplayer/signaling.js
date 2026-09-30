/**
 * Signaling: how two browser tabs find each other before they can talk.
 *
 * A browser cannot listen on a port, so a tab cannot be a server in the way a
 * Minecraft LAN world is. What it can do is hold a WebSocket open to somebody
 * else's server and have that server pass three kinds of note between tabs —
 * an offer, an answer and the network candidates — until the two have a
 * direct WebRTC connection of their own. After that the signaling server
 * carries nothing: names, chat and positions only ever travel peer to peer.
 *
 * This speaks the PeerJS server protocol, which the free public server at
 * 0.peerjs.com runs, on port 443 because school networks block anything odd.
 * Measured against it from this Mac on 2026-09-23, and every one of these is
 * load-bearing:
 *
 *   - wss://0.peerjs.com:443/peerjs?key=peerjs&id=<id>&token=<token>
 *     answers {"type":"OPEN"}, or {"type":"ID-TAKEN"} and a close if somebody
 *     else holds the id. That refusal is what makes a server slot a lock.
 *   - The same id with the SAME token takes the id over: the old socket is
 *     sent {"type":"ID-TAKEOVER"} and closed. So a reconnect is a new token
 *     only if we mean to give the slot up.
 *   - A message to an id nobody holds comes straight back as EXPIRE (0.2 s).
 *     Nothing is queued for a late arrival. That makes probing the five slots
 *     fast: an empty slot says so at once.
 *   - The server CHECKS PAYLOADS and hangs up on a bad one. An OFFER needs
 *     sdp, type, connectionId, label and serialization; a CANDIDATE with an
 *     empty candidate string, or any LEAVE from a client, closes the socket.
 *     Extra fields are passed through. The first draft sent its own compact
 *     offer and was disconnected on the spot. It reads the description too:
 *     an sdp of "fake pc1" is hung up on, one that starts "v=0" is not.
 *   - An idle socket survived 75 s without a heartbeat; heartbeats go every
 *     5 s anyway, as the PeerJS client does.
 *
 * The transport is this one class. A different backend — the LAN server in
 * tools/lan-server.py, a fake in the tests — is a different URL or a different
 * WebSocket constructor, and nothing above this file changes.
 */

import { randomToken, parseTrace, netHashFor } from './protocol.js';

export const PUBLIC_BACKEND = Object.freeze({
  id: 'public',
  url: 'wss://0.peerjs.com:443/peerjs',
  key: 'peerjs',
  label: 'the internet',
});

export class SignalError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

/** Payload shapes the public server insists on. Kept in one place so the fake server can enforce the same. */
export function offerPayload({ sdp, connectionId, metadata }) {
  return {
    sdp,
    type: 'data',
    connectionId,
    label: 'ifs',
    reliable: true,
    serialization: 'binary',
    metadata: metadata || null,
  };
}

export function answerPayload({ sdp, connectionId, metadata }) {
  const p = { sdp, type: 'data', connectionId };
  if (metadata) p.metadata = metadata;
  return p;
}

export class Signaling {
  /**
   * @param backend  { url, key }
   * @param opts     { WebSocketImpl, openTimeoutMs, heartbeatMs, token }
   */
  constructor(backend = PUBLIC_BACKEND, opts = {}) {
    this.backend = backend;
    this.WS = opts.WebSocketImpl || globalThis.WebSocket;
    this.openTimeoutMs = opts.openTimeoutMs || 9000;
    this.heartbeatMs = opts.heartbeatMs || 5000;
    this.token = opts.token || randomToken();
    this.id = null;
    this.state = 'idle';
    this.ws = null;
    this.listeners = new Set();
    this.onclose = null;
    this._hb = null;
  }

  /** Claim `id`. Resolves once the server says OPEN; rejects with a SignalError. */
  open(id) {
    this.id = id;
    this.state = 'connecting';
    return new Promise((resolve, reject) => {
      if (typeof this.WS !== 'function') {
        this.state = 'closed';
        reject(new SignalError('unavailable', 'This browser has no WebSocket'));
        return;
      }
      const b = this.backend;
      const url = `${b.url}?key=${encodeURIComponent(b.key || 'peerjs')}&id=${encodeURIComponent(id)}`
        + `&token=${encodeURIComponent(this.token)}&version=1.5.4`;
      let ws;
      try {
        ws = new this.WS(url);
      } catch (err) {
        this.state = 'closed';
        reject(new SignalError('blocked', String(err && err.message)));
        return;
      }
      this.ws = ws;
      let settled = false;
      const settle = (fn, v) => {
        if (settled) return;
        settled = true;
        this._abortOpen = null;
        clearTimeout(timer);
        fn(v);
      };
      // Closed by us before the server answered: say so now, not when the nine-second timer runs out.
      this._abortOpen = () => settle(reject, new SignalError('closed', 'Closed before the signaling server answered'));
      const timer = setTimeout(() => {
        settle(reject, new SignalError('timeout', 'The signaling server did not answer'));
        this._drop('timeout');
      }, this.openTimeoutMs);

      ws.onmessage = (e) => {
        let m;
        try {
          m = JSON.parse(typeof e.data === 'string' ? e.data : String(e.data));
        } catch (err) {
          return;
        }
        if (!m || typeof m !== 'object') return;
        if (m.type === 'OPEN') {
          this.state = 'open';
          this._startHeartbeat();
          settle(resolve, 'open');
          return;
        }
        if (m.type === 'ID-TAKEN') {
          settle(reject, new SignalError('taken', 'That id is in use'));
          this._drop('taken');
          return;
        }
        if (m.type === 'ERROR' && this.state !== 'open') {
          settle(reject, new SignalError('error', (m.payload && m.payload.msg) || 'Signaling error'));
          this._drop('error');
          return;
        }
        if (m.type === 'ID-TAKEOVER') {
          // Our own id was claimed with our own token somewhere else.
          this._drop('takeover');
          return;
        }
        if (m.type === 'HEARTBEAT') return;
        for (const fn of this.listeners) {
          try {
            fn(m.type, m.src, m.payload, m);
          } catch (err) {
            console.warn('[mp] signaling listener threw', err);
          }
        }
      };
      ws.onclose = () => {
        settle(reject, new SignalError('closed', `The signaling server closed the connection (${id})`));
        this._drop('closed');
      };
      ws.onerror = () => {
        /* onclose follows and says the same thing */
      };
    });
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  get isOpen() {
    return this.state === 'open';
  }

  send(type, dst, payload) {
    if (this.state !== 'open' || !this.ws) return false;
    const m = { type, dst };
    if (payload !== undefined) m.payload = payload;
    try {
      this.ws.send(JSON.stringify(m));
      return true;
    } catch (err) {
      return false;
    }
  }

  close() {
    this._drop('local', true);
  }

  _startHeartbeat() {
    clearInterval(this._hb);
    this._hb = setInterval(() => {
      if (this.state !== 'open') return;
      try {
        this.ws.send('{"type":"HEARTBEAT"}');
      } catch (err) {
        /* the close handler will say so */
      }
    }, this.heartbeatMs);
  }

  _drop(reason, quiet = false) {
    if (this.state === 'closed') return;
    const wasOpen = this.state === 'open';
    this.state = 'closed';
    clearInterval(this._hb);
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      try {
        ws.close();
      } catch (err) {
        /* already gone */
      }
    }
    if (this._abortOpen) this._abortOpen();
    if (wasOpen && !quiet && this.onclose) this.onclose(reason);
  }
}

/* ------------------------------------------------------------------ */
/* Which network are we on?                                            */
/* ------------------------------------------------------------------ */

async function fetchText(fetchImpl, url, ms) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  try {
    const res = await fetchImpl(url, { cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    if (!res.ok) return null;
    return await res.text();
  } catch (err) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The public address, via STUN, for a network that blocks Cloudflare but lets
 * WebRTC out — which is also the only way anything below works at all.
 */
export async function stunAddress(RTC = globalThis.RTCPeerConnection, ms = 3000) {
  if (typeof RTC !== 'function') return null;
  let pc;
  try {
    pc = new RTC({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    pc.createDataChannel('probe');
    const found = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), ms);
      pc.onicecandidate = (e) => {
        const c = e && e.candidate && e.candidate.candidate;
        if (!c) return;
        const m = / ([0-9a-fA-F:.]+) \d+ typ srflx/.exec(c);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    return await found;
  } catch (err) {
    return null;
  } finally {
    try {
      pc && pc.close();
    } catch (err) {
      /* nothing to close */
    }
  }
}

/**
 * The network's hash, or null if there is no way to tell.
 *
 * The address read here is hashed here, and this copy of it goes nowhere else
 * — not to the signaling server, not to other players, not into a log line.
 * (WebRTC is another matter: a join by code sends the public IPv4 to the
 * other side, because a path between two networks needs it. See link.js.)
 *
 * Order: Cloudflare's trace, which is what the browser LAN-sharing apps use;
 * if that says IPv6, ask 1.1.1.1 as well, because connecting to an IPv4
 * literal can only answer in IPv4 and a v4-only Chromebook on the same Wi-Fi
 * will have got a v4 answer. Then STUN. Then give up and say so — joining by
 * code still works without it.
 */
export async function findNetHash({ fetchImpl = globalThis.fetch, RTC = globalThis.RTCPeerConnection, ms = 3500 } = {}) {
  const trace = async (url) => (typeof fetchImpl === 'function' ? parseTrace(await fetchText(fetchImpl, url, ms)) : null);
  let ip = await trace('https://www.cloudflare.com/cdn-cgi/trace');
  let via = 'cloudflare';
  if (!ip || ip.includes(':')) {
    const v4 = await trace('https://1.1.1.1/cdn-cgi/trace');
    if (v4) {
      ip = v4;
      via = '1.1.1.1';
    }
  }
  if (!ip) {
    ip = await stunAddress(RTC);
    via = 'stun';
  }
  const hash = ip ? netHashFor(ip) : null;
  ip = null; // and forget it
  return hash ? { hash, via } : null;
}

/** detectLanServer's answer when it could not tell — as opposed to null, "this is not a LAN server". */
export const LAN_UNKNOWN = 'unknown';

/**
 * Is this page being served by tools/lan-server.py? If it is, that server is
 * the signaling server, and every tab it served is on the same network by
 * definition — which is the only answer there can be with no internet.
 *
 * Returns the backend and hash, null if this is not a LAN server, or
 * LAN_UNKNOWN if the question went unanswered (the caller asks again later).
 *
 * Measured in the two-page playtest: with 1.5 s allowed, a page busy
 * loading the game on a loaded machine did not hear back in time, decided it
 * had not been served by a LAN server, and looked for friends on the public
 * server instead — the other page, which had heard back, was on the LAN one.
 * Six seconds now, and a timeout is "don't know", not "no". It is a POST
 * because the game's service worker answers GETs of anything that is not
 * code from its cache first: a folder once served by the LAN server and
 * later by a plain one on the same address would have gone on claiming to
 * be a LAN server for ever.
 */
export async function detectLanServer({ fetchImpl = globalThis.fetch, base = null, ms = 6000 } = {}) {
  if (typeof fetchImpl !== 'function') return null;
  let url;
  try {
    url = new URL('lan/info', base || (globalThis.location && globalThis.location.href) || 'http://localhost/').href;
  } catch (err) {
    return null;
  }
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => ctl && ctl.abort(), ms);
  let text;
  try {
    const res = await fetchImpl(url, { method: 'POST', cache: 'no-store', signal: ctl ? ctl.signal : undefined });
    // A static host answers a POST with 405 or 501 (GitHub Pages, python -m http.server): not a LAN server.
    if (!res.ok) return null;
    text = await res.text();
  } catch (err) {
    return LAN_UNKNOWN;
  } finally {
    clearTimeout(timer);
  }
  let info;
  try {
    info = JSON.parse(text);
  } catch (err) {
    return null;
  }
  if (!info || info.lan !== true || !/^[0-9a-f]{12}$/.test(String(info.net || ''))) return null;
  const loc = globalThis.location;
  const wsProto = loc && loc.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = loc && loc.host ? loc.host : 'localhost';
  const backend = { id: 'lan', url: `${wsProto}//${host}/peerjs`, key: 'peerjs', label: String(info.name || 'this computer').slice(0, 40) };
  return {
    backend,
    hash: info.net,
    /*
     * List 3: a LAN server started with --local (a test run on one computer)
     * or --world stands in for the public matchmaking server for the world
     * lobbies too, so a test never touches 0.peerjs.com. Otherwise the world
     * lobbies are on the public server, as they are everywhere else.
     */
    world: info.world === true ? { ...backend, id: 'lan-world' } : null,
  };
}

/**
 * A node stand-in for the Cloudflare runtime, enough to run server/worker.js
 * as written — nothing installed, nothing on the network:
 *
 *   - FakeState        a Durable Object's `state`: acceptWebSocket (the
 *                      hibernatable API: messages go to webSocketMessage /
 *                      webSocketClose on the object), getWebSockets,
 *                      serialize/deserializeAttachment, storage, alarms;
 *   - FakeNamespace    `env.LOBBY` / `env.DIRECTORY`: idFromName, get → a
 *                      stub whose fetch runs the object's fetch, one object
 *                      per name, kept — unless the test evicts it;
 *   - WebSocketPair    the global the Worker makes sockets with: two ends
 *                      that pass each other's frames, a millisecond later,
 *                      in order, as one TCP connection would;
 *   - FakeServer       the whole thing wired up: fetch(url, init) runs the
 *                      Worker; WebSocket is a browser-shaped class that
 *                      upgrades through it, for the game's own transport.js;
 *                      fetchImpl for /health and /lobbies.
 *
 * Plain module with no imports of the game, so the tests decide what to load.
 */

const tick = (fn) => setTimeout(fn, 1);

/** One end of a socket pair. Platform-shaped (send/close/addEventListener) AND browser-shaped (onopen/onmessage/onclose). */
class End {
  constructor() {
    this.other = null;
    this.readyState = 0;
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    this.binaryType = 'arraybuffer';
    this.bufferedAmount = 0;
    this._attachment = undefined;
    this._q = [];
    this._qt = null;
    this._accepted = null; // the FakeState that accepted this end, if any
    this.sent = 0;
  }

  _emit(fn) {
    this._q.push(fn);
    if (this._qt) return;
    this._qt = tick(() => {
      this._qt = null;
      const q = this._q;
      this._q = [];
      for (const f of q) f();
    });
  }

  /** The platform's: accept() opens both ends. */
  accept() {
    this.readyState = 1;
    if (this.other && this.other.readyState === 0) {
      this.other.readyState = 1;
      this.other._emit(() => this.other.onopen && this.other.onopen({}));
    }
  }

  send(data) {
    if (this.readyState !== 1) throw new Error('InvalidStateError: not open');
    this.sent++;
    const copy = typeof data === 'string' ? data : data instanceof ArrayBuffer ? data.slice(0) : new Uint8Array(data).slice().buffer;
    const o = this.other;
    if (!o || o.readyState !== 1) return;
    o._emit(() => o._receive(copy));
  }

  _receive(data) {
    if (this.readyState !== 1) return;
    if (this._accepted) this._accepted._message(this, data);
    else if (this.onmessage) this.onmessage({ data });
  }

  close(code = 1000, reason = '') {
    if (this.readyState >= 2) return;
    this.readyState = 3;
    const o = this.other;
    this._emit(() => {
      if (this._accepted) this._accepted._close(this, code, reason);
      else if (this.onclose) this.onclose({ code, reason });
    });
    if (o && o.readyState < 2) {
      o.readyState = 3;
      o._emit(() => {
        if (o._accepted) o._accepted._close(o, code, reason);
        else if (o.onclose) o.onclose({ code, reason });
      });
    }
  }

  serializeAttachment(obj) {
    this._attachment = JSON.parse(JSON.stringify(obj));
  }

  deserializeAttachment() {
    return this._attachment === undefined ? null : JSON.parse(JSON.stringify(this._attachment));
  }
}

export class WebSocketPair {
  constructor() {
    const a = new End();
    const b = new End();
    a.other = b;
    b.other = a;
    this[0] = a;
    this[1] = b;
  }
}

export class FakeStorage {
  constructor() {
    this.map = new Map();
    this.alarm = null;
  }

  async get(k) {
    return this.map.has(k) ? JSON.parse(this.map.get(k)) : undefined;
  }

  async put(k, v) {
    this.map.set(k, JSON.stringify(v));
  }

  async delete(k) {
    this.map.delete(k);
  }

  async setAlarm(t) {
    this.alarm = t;
  }

  async getAlarm() {
    return this.alarm;
  }

  async deleteAlarm() {
    this.alarm = null;
  }
}

export class FakeState {
  constructor(name) {
    this.id = { name, toString: () => name };
    this.storage = new FakeStorage();
    this.sockets = new Set();
    this.obj = null;
    this.waited = [];
  }

  acceptWebSocket(ws) {
    ws._accepted = this;
    this.sockets.add(ws);
    ws.accept();
  }

  getWebSockets() {
    return [...this.sockets].filter((w) => w.readyState === 1);
  }

  waitUntil(p) {
    this.waited.push(p);
  }

  _message(ws, data) {
    if (this.obj && this.obj.webSocketMessage) this.obj.webSocketMessage(ws, data);
  }

  _close(ws, code, reason) {
    this.sockets.delete(ws);
    if (this.obj && this.obj.webSocketClose) this.obj.webSocketClose(ws, code, reason);
  }
}

export class FakeNamespace {
  constructor(Cls, env) {
    this.Cls = Cls;
    this.env = env;
    this.objects = new Map();
    this.states = new Map();
  }

  idFromName(name) {
    return { name, toString: () => name };
  }

  /** The object for a name, made on first use. */
  instance(name) {
    let o = this.objects.get(name);
    if (!o) {
      let state = this.states.get(name);
      if (!state) this.states.set(name, (state = new FakeState(name)));
      o = new this.Cls(state, this.env);
      state.obj = o;
      this.objects.set(name, o);
    }
    return o;
  }

  /** Throw the in-memory object away, keeping its state and sockets: what the platform does when it hibernates one. */
  evict(name) {
    const o = this.objects.get(name);
    if (o && o._timer) clearInterval(o._timer);
    this.objects.delete(name);
    const state = this.states.get(name);
    if (state) state.obj = null;
    return state;
  }

  get(id) {
    const name = id.name;
    return {
      fetch: async (input, init) => {
        const req = input instanceof Request ? input : new Request(input, init);
        return this.instance(name).fetch(req);
      },
    };
  }
}

/**
 * The server, in one object.
 *
 *   const srv = await FakeServer.start({ env })      // loads server/worker.js
 *   srv.fetch(path)                                   // GET through the Worker
 *   srv.connect('world-4-1')                          // a raw browser-shaped socket into a room
 *   new srv.WebSocket(url) / srv.fetchImpl             // for the game's transport.js
 */
export class FakeServer {
  static async start({ env = {}, base = 'https://lobby.test', worker = null } = {}) {
    globalThis.WebSocketPair = WebSocketPair;
    const mod = worker || (await import('../../server/worker.js'));
    return new FakeServer(mod, env, base);
  }

  constructor(mod, env, base) {
    this.mod = mod;
    this.base = base;
    this.env = { ...env };
    this.env.LOBBY = new FakeNamespace(mod.Lobby, this.env);
    this.env.DIRECTORY = new FakeNamespace(mod.Directory, this.env);
    this.ctx = { waitUntil() {} };
    this.down = false;
    this.requests = [];
    const srv = this;
    /** Browser-shaped, for transport.js: new WebSocket(url) upgrades through the Worker. */
    this.WebSocket = class FakeBrowserSocket extends End {
      constructor(url) {
        super();
        this.url = String(url);
        this.readyState = 0;
        tick(async () => {
          if (this.readyState !== 0) return;
          let res = null;
          try {
            res = srv.down ? null : await srv.fetch(this.url.replace(/^ws(s?):/, 'http$1:'), { headers: { upgrade: 'websocket' } });
          } catch (err) {
            res = null;
          }
          if (!res || res.status !== 101 || !res.webSocket) {
            this.readyState = 3;
            if (this.onerror) this.onerror({});
            if (this.onclose) this.onclose({ code: 1006, reason: res ? String(res.status) : 'down' });
            return;
          }
          // The pair's client end is ours: splice it in so frames reach our handlers.
          const client = res.webSocket;
          this.other = client.other;
          client.other.other = this;
          this.readyState = 1;
          if (this.onopen) this.onopen({});
        });
      }

      close(code, reason) {
        if (this.readyState === 0) {
          this.readyState = 3;
          return;
        }
        super.close(code, reason);
      }
    };
    this.fetchImpl = (url, init) => {
      if (srv.down) return Promise.reject(new Error('down'));
      return srv.fetch(String(url), init);
    };
  }

  /** A GET (or whatever `init` says) through the Worker. `path` may be a path or a full URL on this server. */
  async fetch(path, init = {}) {
    const url = /^https?:/.test(path) ? path : `${this.base}${path}`;
    this.requests.push(url);
    const headers = new Headers(init.headers || {});
    if (!headers.has('cf-connecting-ip')) headers.set('cf-connecting-ip', init.ip || '203.0.113.7');
    const req = new Request(url, { method: init.method || 'GET', headers });
    return this.mod.default.fetch(req, this.env, this.ctx);
  }

  /** A raw socket into a room, browser-shaped, already connecting. */
  connect(roomId, ip) {
    const ws = new this.WebSocket(`${this.base.replace(/^http/, 'ws')}/lobby/${roomId}`);
    if (ip) ws._ip = ip;
    return ws;
  }

  /** The room object (server/worker.js Lobby) for an id, if it has been made. */
  lobby(roomId) {
    return this.env.LOBBY.objects.get(roomId) || null;
  }

  room(roomId) {
    const l = this.lobby(roomId);
    return l ? l.room : null;
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function until(fn, ms = 3000, step = 5) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) return null;
    await sleep(step);
  }
}

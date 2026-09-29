/**
 * Stand-ins for the network, for the multiplayer tests.
 *
 * FakeSignalServer behaves the way the public PeerJS server was MEASURED to
 * behave (see src/features/multiplayer/signaling.js): OPEN, ID-TAKEN for a
 * held id, ID-TAKEOVER for the same token, an immediate EXPIRE for a message
 * to nobody, and — the one that bit — hanging up on a payload it does not
 * like. A test that passes against a lenient fake and fails against the real
 * server is worse than no test.
 *
 * makeFakeRTC gives an RTCPeerConnection that pairs with its partner once
 * both descriptions and a candidate have crossed the signaling server, then
 * passes channel messages with a millisecond's delay. It can be told to fail
 * ICE, which is what a school network that keeps devices apart looks like.
 *
 * Plain modules with no imports, so both node and the browser check can use them.
 */

export class FakeSignalServer {
  constructor({ expireDelayMs = 2 } = {}) {
    this.expireDelayMs = expireDelayMs;
    this.clients = new Map();
    this.log = [];
    this.hungUp = 0;
    const server = this;
    this.WebSocket = class FakeWebSocket {
      constructor(url) {
        const u = new URL(url);
        this.url = url;
        this.id = u.searchParams.get('id');
        this.token = u.searchParams.get('token');
        this.key = u.searchParams.get('key');
        this.readyState = 0;
        this.onopen = this.onmessage = this.onclose = this.onerror = null;
        setTimeout(() => {
          if (this.readyState !== 0) return;
          this.readyState = 1;
          if (this.onopen) this.onopen({});
          server._connect(this);
        }, 1);
      }
      send(data) {
        if (this.readyState !== 1) throw new Error('InvalidStateError');
        server._message(this, String(data));
      }
      close() {
        if (this.readyState >= 2) return;
        this.readyState = 3;
        server._disconnect(this);
        this._emit(() => this.onclose && this.onclose({ code: 1000, reason: '' }));
      }
      /*
       * Everything the server sends this socket goes through one queue, in
       * order, the way it would down one TCP connection. The first version
       * used a timer per message and a longer timer for the hang-up, and under
       * load node fired the 3 ms hang-up before the 1 ms ID-TAKEN: one run in
       * four "lost" a slot claim to a close that no real server can send first.
       */
      _emit(fn) {
        (this._q || (this._q = [])).push(fn);
        if (this._qt) return;
        this._qt = setTimeout(() => {
          this._qt = null;
          const q = this._q;
          this._q = [];
          for (const f of q) f();
        }, 1);
      }
      _deliver(obj) {
        if (this.readyState !== 1 || this._closing) return;
        const data = JSON.stringify(obj);
        this._emit(() => {
          if (this.readyState === 1 && this.onmessage) this.onmessage({ data });
        });
      }
      _hangUp() {
        if (this.readyState >= 2 || this._closing) return;
        this._closing = true;
        server._disconnect(this);
        this._emit(() => {
          this.readyState = 3;
          if (this.onclose) this.onclose({ code: 1000, reason: '' });
        });
      }
    };
  }

  _connect(ws) {
    if (ws.key !== 'peerjs' || !ws.id || !ws.token) {
      ws._deliver({ type: 'ERROR', payload: { msg: 'Invalid key provided' } });
      ws._hangUp();
      return;
    }
    const held = this.clients.get(ws.id);
    if (held) {
      if (held.token === ws.token) {
        held._deliver({ type: 'ID-TAKEOVER' });
        held._hangUp();
      } else {
        ws._deliver({ type: 'ID-TAKEN', payload: { msg: 'ID is taken' } });
        ws._hangUp();
        return;
      }
    }
    this.clients.set(ws.id, ws);
    ws._deliver({ type: 'OPEN' });
  }

  _disconnect(ws) {
    if (this.clients.get(ws.id) === ws) this.clients.delete(ws.id);
  }

  static valid(m) {
    const p = m.payload;
    if (m.type === 'HEARTBEAT') return true;
    if (!p || typeof p !== 'object' || typeof m.dst !== 'string') return false;
    if (m.type === 'OFFER') return !!(p.sdp && p.type && p.connectionId && p.label && p.serialization);
    if (m.type === 'ANSWER') return !!(p.sdp && p.type && p.connectionId);
    if (m.type === 'CANDIDATE') return !!(p.candidate && p.candidate.candidate && p.type && p.connectionId);
    return false; // LEAVE, EXPIRE and anything else from a client: hung up on
  }

  _message(ws, data) {
    let m;
    try {
      m = JSON.parse(data);
    } catch (e) {
      this.hungUp++;
      ws._hangUp();
      return;
    }
    this.log.push({ from: ws.id, type: m.type, dst: m.dst });
    if (!FakeSignalServer.valid(m)) {
      this.hungUp++;
      ws._hangUp();
      return;
    }
    if (m.type === 'HEARTBEAT') return;
    const dst = this.clients.get(m.dst);
    if (dst) dst._deliver({ type: m.type, src: ws.id, dst: m.dst, payload: m.payload });
    else setTimeout(() => ws._deliver({ type: 'EXPIRE', src: m.dst, dst: ws.id }), this.expireDelayMs);
  }
}

/**
 * A fake RTCPeerConnection class. `opts.fail(a, b)` returning true makes that
 * pair's ICE fail; `opts.loss` drops that fraction of messages on unreliable
 * channels.
 */
export function makeFakeRTC(opts = {}) {
  const registry = new Map();
  let seq = 0;
  const fail = opts.fail || (() => false);
  const loss = opts.loss || 0;

  class FakeChannel {
    constructor(pc, label, o = {}) {
      this.pc = pc;
      this.label = label;
      this.id = o.id;
      this.reliable = o.maxRetransmits === undefined;
      this.readyState = 'connecting';
      this.bufferedAmount = 0;
      this.binaryType = 'blob';
      this.other = null;
      this.onopen = this.onclose = this.onmessage = null;
    }
    send(data) {
      if (this.readyState !== 'open') throw new Error('InvalidStateError');
      const o = this.other;
      if (!this.reliable && loss && Math.random() < loss) return;
      const copy = typeof data === 'string' ? data : data.slice(0);
      setTimeout(() => {
        if (o && o.readyState === 'open' && o.onmessage) o.onmessage({ data: copy });
      }, 1);
    }
    close() {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed';
      const o = this.other;
      setTimeout(() => this.onclose && this.onclose({}), 1);
      if (o && o.readyState !== 'closed') o.close();
    }
  }

  class FakePC {
    constructor(cfg) {
      this.cfg = cfg;
      this.name = `pc${++seq}`;
      registry.set(this.name, this);
      this.channels = new Map();
      this.localDescription = null;
      this.remoteDescription = null;
      this.remoteName = null;
      this.remoteCandidates = 0;
      this.connectionState = 'new';
      this.iceConnectionState = 'new';
      this.linked = false;
      this.closed = false;
      this.onicecandidate = this.onconnectionstatechange = this.oniceconnectionstatechange = null;
    }
    createDataChannel(label, o = {}) {
      const ch = new FakeChannel(this, label, o);
      this.channels.set(o.id, ch);
      return ch;
    }
    /*
     * The description has to look like SDP: the public server reads it, and
     * hung up on the first draft of this fake, whose offer was the string
     * "fake pc1". Measured with --real; the placeholder "v=0" the ping uses
     * passes, "fake pc1" does not.
     */
    _sdp() {
      return `v=0\r\no=- ${1000 + seq} 2 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\na=fake-pc:${this.name}\r\n`;
    }
    async createOffer() {
      return { type: 'offer', sdp: this._sdp() };
    }
    async createAnswer() {
      return { type: 'answer', sdp: this._sdp() };
    }
    async setLocalDescription(d) {
      this.localDescription = d;
      /*
       * What a real browser gathers: its mDNS name, and — when it was given a
       * STUN server — the network's public IPv4 and the device's own IPv6
       * (documentation addresses here), plus an un-hidden global IPv6 host
       * address, which a page with camera permission gets. link.js decides
       * which of these may go through the signaling server.
       */
      setTimeout(() => {
        if (this.closed || !this.onicecandidate) return;
        const list = [`candidate:1 1 udp 2122260223 ${this.name}-fake.local 9 typ host generation 0`,
          'candidate:4 1 udp 2122262783 2001:db8:77::2 9 typ host generation 0'];
        if (this.cfg && Array.isArray(this.cfg.iceServers) && this.cfg.iceServers.length) {
          list.push('candidate:2 1 udp 1686052607 203.0.113.77 9 typ srflx raddr 0.0.0.0 rport 0 generation 0',
            'candidate:3 1 udp 1686052863 2001:db8:77::1 9 typ srflx raddr :: rport 0 generation 0');
        }
        for (const cand of list) {
          const c = { candidate: cand, sdpMid: '0', sdpMLineIndex: 0, usernameFragment: 'x' };
          this.onicecandidate({ candidate: { ...c, toJSON: () => c } });
        }
        this.onicecandidate({ candidate: null });
      }, 1);
      this._try();
    }
    async setRemoteDescription(d) {
      const m = d && /^v=0\r\n[\s\S]*a=fake-pc:(pc\d+)\r\n/.exec(String(d.sdp));
      if (!m) throw new Error('bad description');
      this.remoteDescription = d;
      this.remoteName = m[1];
      this._try();
    }
    async addIceCandidate(c) {
      if (!c || !c.candidate) return;
      this.remoteCandidates++;
      this._try();
    }
    _state(s) {
      this.connectionState = s;
      this.iceConnectionState = s;
      if (this.onconnectionstatechange) this.onconnectionstatechange({});
    }
    _try() {
      if (this.linked || this.closed || !this.localDescription || !this.remoteDescription || !this.remoteCandidates) return;
      const peer = registry.get(this.remoteName);
      if (!peer || peer.closed || peer.remoteName !== this.name || !peer.localDescription || !peer.remoteDescription || !peer.remoteCandidates) return;
      this.linked = peer.linked = true;
      if (fail(this, peer)) {
        setTimeout(() => {
          this._state('failed');
          peer._state('failed');
        }, 20);
        return;
      }
      for (const [id, ch] of this.channels) {
        const other = peer.channels.get(id);
        if (!other) continue;
        ch.other = other;
        other.other = ch;
      }
      setTimeout(() => {
        for (const pc of [this, peer]) {
          if (pc.closed) continue;
          pc._state('connected');
          for (const ch of pc.channels.values()) {
            if (ch.other && ch.readyState === 'connecting') {
              ch.readyState = 'open';
              if (ch.onopen) ch.onopen({});
            }
          }
        }
      }, 3);
    }
    close() {
      if (this.closed) return;
      this.closed = true;
      this.connectionState = 'closed';
      for (const ch of this.channels.values()) ch.close();
      registry.delete(this.name);
    }
  }
  FakePC.registry = registry;
  return FakePC;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait until `fn()` is truthy, or give up. */
export async function until(fn, ms = 3000, step = 5) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = fn();
    if (v) return v;
    await sleep(step);
  }
  return fn();
}

/**
 * One WebRTC connection between two tabs, and the thing that routes signaling
 * notes to the right one.
 *
 * STAR, NOT MESH. Every player has exactly one connection, to the host; the
 * host's tab is the server and relays. Five players is four connections
 * rather than ten, and "who is in this game" has one answer — the host's.
 *
 * Each link carries two channels, both negotiated up front with fixed ids so
 * neither side has to wait to be told about the other's:
 *
 *   'ev'  reliable and ordered — hello, welcome, chat, join, leave, kick.
 *   'st'  unreliable and unordered, no retransmits — the 15 Hz snapshots.
 *         A late snapshot is worth nothing, and a retransmit of one queues
 *         ahead of the snapshot that replaced it.
 *
 * ICE, and what it tells the signaling server. A WebRTC candidate is an
 * address to try, and it travels through the signaling server to the other
 * side. The ones a STUN server finds ("srflx") are this network's PUBLIC
 * address — the raw IP the rest of this feature only ever hashes — and on
 * IPv6 that is the device's own. Recorded in review: 8 of the 20 candidates
 * in a real run carried the Mac's public IPv4 and IPv6 addresses through
 * 0.peerjs.com to whoever was probing or joining. So there are two policies:
 *
 *   'lan'  the server list and joining from it — the same Wi-Fi by
 *          definition. No STUN server at all, and only local candidates are
 *          sent: the browser's own mDNS names (xxxx.local) and private
 *          addresses. No public address leaves the tab.
 *   'v4'   joining by code — a friend on another network, where a direct
 *          path needs the public address. The public IPv4 is sent (it is
 *          the address every website this tab visits already sees, and it
 *          goes only to someone who has the code); the per-device IPv6 one
 *          and any public host address are not.
 *
 * No TURN: nobody is paying for a relay, so two networks that both refuse a
 * direct path cannot play together, and the game says so rather than hanging.
 */

import { offerPayload, answerPayload } from './signaling.js';
import { PROTO, readEvent, writeEvent } from './protocol.js';

export const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const isCodeId = (id) => /^ifs-code-/.test(String(id || ''));

/** mDNS names, private and link-local IPv4, link-local and unique-local IPv6, loopback. */
export function isLocalAddress(a) {
  const s = String(a || '').toLowerCase().replace(/^\[|\]$/g, '');
  if (s.endsWith('.local')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(s);
  if (v4) {
    const [a1, a2] = [Number(v4[1]), Number(v4[2])];
    return a1 === 10 || a1 === 127 || (a1 === 172 && a2 >= 16 && a2 <= 31) || (a1 === 192 && a2 === 168)
      || (a1 === 169 && a2 === 254) || (a1 === 100 && a2 >= 64 && a2 <= 127);
  }
  if (s.includes(':')) return s === '::1' || /^fe[89ab]/.test(s) || /^f[cd]/.test(s);
  return false;
}

/**
 * May this ICE candidate go through the signaling server under `share`?
 * Anything that does not parse as a candidate is kept back: a candidate that
 * goes unsent costs a path, one sent by mistake cannot be taken back.
 */
export function candidateAllowed(candidate, share = 'lan') {
  const f = String(candidate || '').replace(/^a=/, '').replace(/^candidate:/, '').trim().split(/\s+/);
  if (f.length < 8 || f[6] !== 'typ') return false;
  const addr = f[4];
  const type = f[7];
  if (type === 'host') return isLocalAddress(addr);
  if (type === 'srflx') return share === 'v4' && /^\d{1,3}(\.\d{1,3}){3}$/.test(addr);
  return false;
}

const rid = () => Math.random().toString(36).slice(2, 12);

export class Link {
  constructor(net, { peer, connectionId, initiator, kind, meta }) {
    this.net = net;
    this.peer = peer;
    this.connectionId = connectionId || `dc_${rid()}`;
    this.initiator = !!initiator;
    this.kind = kind || 'join';
    this.meta = meta || {};
    this.state = 'new';
    this.pc = null;
    this.ev = null;
    this.st = null;
    this.pending = [];
    this.remoteSet = false;
    this.onopen = null;
    this.onevent = null;
    this.onstate = null;
    this.onclose = null;
    this.closeReason = null;
    this.lastHeard = 0;
    this._timer = null;
    this._grace = null;
    /*
     * Which candidates may go through the signaling server (see the top of
     * this file). A link we start is judged by who it is to; one we accept,
     * by the id it arrived at — a host's code socket answers friends from
     * other networks, its slot socket answers the Wi-Fi.
     */
    this.share = isCodeId(this.initiator ? peer : net.sig && net.sig.id) ? 'v4' : 'lan';
    this.candidates = { sent: 0, kept: 0 };
  }

  _setup() {
    const RTC = this.net.RTC;
    // A same-Wi-Fi link asks no STUN server: it needs no public address, so it does not look one up.
    this.pc = new RTC({ iceServers: this.share === 'v4' ? this.net.iceServers : [] });
    const pc = this.pc;
    this.ev = pc.createDataChannel('ev', { negotiated: true, id: 0, ordered: true });
    this.st = pc.createDataChannel('st', { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    for (const ch of [this.ev, this.st]) ch.binaryType = 'arraybuffer';
    this.ev.onopen = () => this._maybeOpen();
    this.ev.onclose = () => this.close('channel');
    this.ev.onmessage = (e) => {
      this.lastHeard = this.net.now();
      const ev = readEvent(e.data);
      if (ev && this.onevent) this.onevent(ev, this);
    };
    this.st.onmessage = (e) => {
      this.lastHeard = this.net.now();
      if (this.onstate && e.data && typeof e.data !== 'string') this.onstate(e.data, this);
    };
    pc.onicecandidate = (e) => {
      const c = e && e.candidate;
      // The public server hangs up on an empty candidate — the end-of-candidates marker is not sent.
      if (!c || !c.candidate) return;
      if (!candidateAllowed(c.candidate, this.share)) {
        this.candidates.kept++;
        return;
      }
      this.candidates.sent++;
      const json = typeof c.toJSON === 'function' ? c.toJSON() : c;
      this.net.sig.send('CANDIDATE', this.peer, {
        candidate: { candidate: json.candidate, sdpMid: json.sdpMid, sdpMLineIndex: json.sdpMLineIndex, usernameFragment: json.usernameFragment },
        type: 'data',
        connectionId: this.connectionId,
      });
    };
    const watch = () => {
      const s = pc.connectionState || pc.iceConnectionState;
      if (s === 'failed' || s === 'closed') this.close(this.state === 'open' ? 'dropped' : 'ice');
      else if (s === 'disconnected') {
        // Wi-Fi blips recover by themselves; give it a few seconds first.
        clearTimeout(this._grace);
        this._grace = setTimeout(() => {
          const now = pc.connectionState || pc.iceConnectionState;
          if (now === 'disconnected' || now === 'failed') this.close('dropped');
        }, 6000);
      } else if (s === 'connected') clearTimeout(this._grace);
    };
    pc.onconnectionstatechange = watch;
    pc.oniceconnectionstatechange = watch;
    // Not open in fifteen seconds is not going to open.
    this._timer = setTimeout(() => {
      if (this.state !== 'open') this.close('timeout');
    }, this.net.connectTimeoutMs);
  }

  async start() {
    this.state = 'connecting';
    try {
      this._setup();
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      if (this.state === 'closed') return;
      const ok = this.net.sig.send('OFFER', this.peer, offerPayload({
        sdp: { type: offer.type, sdp: offer.sdp },
        connectionId: this.connectionId,
        metadata: { k: this.kind, v: PROTO },
      }));
      if (!ok) this.close('signaling');
    } catch (err) {
      console.warn('[mp] could not start a connection', err);
      this.close('rtc');
    }
  }

  async accept(payload) {
    this.state = 'connecting';
    try {
      this._setup();
      await this.pc.setRemoteDescription(payload.sdp);
      this.remoteSet = true;
      await this._flush();
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      if (this.state === 'closed') return;
      this.net.sig.send('ANSWER', this.peer, answerPayload({
        sdp: { type: answer.type, sdp: answer.sdp },
        connectionId: this.connectionId,
      }));
    } catch (err) {
      console.warn('[mp] could not answer a connection', err);
      this.close('rtc');
    }
  }

  async onAnswer(payload) {
    if (!this.pc || this.remoteSet || this.state === 'closed') return;
    try {
      await this.pc.setRemoteDescription(payload.sdp);
      this.remoteSet = true;
      await this._flush();
    } catch (err) {
      console.warn('[mp] bad answer', err);
      this.close('rtc');
    }
  }

  async onCandidate(payload) {
    const c = payload && payload.candidate;
    if (!c || !c.candidate) return;
    if (!this.remoteSet) {
      this.pending.push(c);
      return;
    }
    try {
      await this.pc.addIceCandidate(c);
    } catch (err) {
      /* a candidate for a network we cannot use; the others will do */
    }
  }

  async _flush() {
    const list = this.pending;
    this.pending = [];
    for (const c of list) {
      try {
        await this.pc.addIceCandidate(c);
      } catch (err) {
        /* as above */
      }
    }
  }

  _maybeOpen() {
    if (this.state === 'open' || this.state === 'closed') return;
    if (!this.ev || this.ev.readyState !== 'open') return;
    this.state = 'open';
    this.lastHeard = this.net.now();
    clearTimeout(this._timer);
    if (this.onopen) this.onopen(this);
  }

  get isOpen() {
    return this.state === 'open';
  }

  send(ev) {
    if (this.state !== 'open' || !this.ev || this.ev.readyState !== 'open') return false;
    try {
      this.ev.send(writeEvent(ev));
      return true;
    } catch (err) {
      return false;
    }
  }

  sendState(buf) {
    const ch = this.st;
    if (this.state !== 'open' || !ch || ch.readyState !== 'open') return false;
    // A backed-up channel means a slow link; drop this one rather than queue it.
    if (ch.bufferedAmount > 64 * 1024) return false;
    try {
      ch.send(buf);
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
    clearTimeout(this._grace);
    this.net._forget(this);
    for (const ch of [this.ev, this.st]) {
      if (!ch) continue;
      ch.onopen = ch.onclose = ch.onmessage = null;
      try {
        ch.close();
      } catch (err) {
        /* already closed */
      }
    }
    if (this.pc) {
      this.pc.onicecandidate = this.pc.onconnectionstatechange = this.pc.oniceconnectionstatechange = null;
      try {
        this.pc.close();
      } catch (err) {
        /* already closed */
      }
    }
    if (this.onclose) this.onclose(reason, was, this);
  }
}

/**
 * One signaling socket and the links it carries.
 *
 *   net.connect(peer, kind)       a link we start
 *   net.onOffer = (link, meta)    a link somebody else started; return false to
 *                                 refuse it, or 'busy' to refuse it for now
 *   net.ping(peer)                is anybody holding that id? — 'here' | 'empty' | 'timeout'
 *   net.pingInfo(peer)            the same, with what the pong carried: { r, meta }
 *
 * The ping is an OFFER with a placeholder description and `k: 'ping'` in the
 * metadata, answered by an ANSWER with `k: 'pong'`. It exists so that probing
 * five slots, most of them empty, does not start five WebRTC connections every
 * few seconds just to find out nobody is there: an empty slot comes straight
 * back as EXPIRE and costs one small message. A host's pong carries its
 * head-count — three small numbers, never a name — so the list can keep "3/5"
 * up to date without holding a connection open to every host.
 *
 * A refused offer is ANSWERED, with `k: 'busy'` or `k: 'no'`. It used to get
 * silence, and silence is indistinguishable from a network that keeps devices
 * apart: measured in review with twenty server lists open on one host, the
 * eight it had no room for waited out the 15 s connection timeout, showed the
 * host as "Found, but can't connect" with Join greyed out, and stayed that
 * way for a minute.
 */
export class Net {
  constructor(sig, opts = {}) {
    this.sig = sig;
    this.RTC = opts.RTC || globalThis.RTCPeerConnection;
    this.iceServers = opts.iceServers || ICE_SERVERS;
    this.connectTimeoutMs = opts.connectTimeoutMs || 15000;
    this.now = opts.now || (() => (globalThis.performance ? performance.now() : Date.now()));
    this.links = new Map();
    this.pings = new Map();
    this.onOffer = null;
    this.answersPings = false;
    this.pongMeta = null;
    this.onsigclose = null;
    this._off = sig.on((type, src, payload) => this._route(type, src, payload));
    sig.onclose = (why) => {
      if (this.onsigclose) this.onsigclose(why);
    };
  }

  get available() {
    return typeof this.RTC === 'function';
  }

  connect(peer, kind = 'join', meta) {
    const link = new Link(this, { peer, initiator: true, kind, meta });
    this.links.set(link.connectionId, link);
    link.start();
    return link;
  }

  ping(peer, ms = 5000) {
    return this.pingInfo(peer, ms).then((x) => x.r);
  }

  pingInfo(peer, ms = 5000) {
    const connectionId = `dc_ping_${rid()}`;
    return new Promise((resolve) => {
      const done = (r, meta = null) => {
        if (!this.pings.has(connectionId)) return;
        clearTimeout(this.pings.get(connectionId).timer);
        this.pings.delete(connectionId);
        resolve({ r, meta: meta && typeof meta === 'object' ? meta : null });
      };
      const timer = setTimeout(() => done('timeout'), ms);
      this.pings.set(connectionId, { peer, done, timer });
      const ok = this.sig.send('OFFER', peer, offerPayload({
        sdp: { type: 'offer', sdp: 'v=0\r\n' },
        connectionId,
        metadata: { k: 'ping', v: PROTO },
      }));
      if (!ok) done('offline');
    });
  }

  _forget(link) {
    if (this.links.get(link.connectionId) === link) this.links.delete(link.connectionId);
  }

  _route(type, src, payload) {
    const p = payload && typeof payload === 'object' ? payload : null;
    const cid = p && typeof p.connectionId === 'string' ? p.connectionId : null;
    if (type === 'EXPIRE') {
      // `src` is the id that turned out not to exist.
      for (const [, w] of this.pings) if (w.peer === src) w.done('empty');
      for (const link of [...this.links.values()]) {
        if (link.peer === src && link.state !== 'open') link.close('gone');
      }
      return;
    }
    if (!cid || typeof src !== 'string') return;
    if (type === 'OFFER') {
      const meta = (p.metadata && typeof p.metadata === 'object') ? p.metadata : {};
      if (meta.k === 'ping') {
        if (this.answersPings) {
          let extra = null;
          try {
            extra = typeof this.pongMeta === 'function' ? this.pongMeta() : this.pongMeta;
          } catch (err) {
            extra = null;
          }
          this.sig.send('ANSWER', src, answerPayload({
            sdp: { type: 'answer', sdp: 'v=0\r\n' },
            connectionId: cid,
            metadata: { k: 'pong', v: PROTO, ...(extra || {}) },
          }));
        }
        return;
      }
      if (!this.onOffer || this.links.has(cid) || !p.sdp || typeof p.sdp.sdp !== 'string') return;
      const link = new Link(this, { peer: src, connectionId: cid, initiator: false, kind: String(meta.k || 'join'), meta });
      const yes = this.onOffer(link, meta);
      if (yes === false || yes === 'busy') {
        this.sig.send('ANSWER', src, answerPayload({
          sdp: { type: 'answer', sdp: 'v=0\r\n' },
          connectionId: cid,
          metadata: { k: yes === 'busy' ? 'busy' : 'no', v: PROTO },
        }));
        return;
      }
      this.links.set(cid, link);
      link.accept(p);
      return;
    }
    if (type === 'ANSWER') {
      const w = this.pings.get(cid);
      if (w) {
        w.done('here', p.metadata);
        return;
      }
      const link = this.links.get(cid);
      if (!link || link.peer !== src) return;
      const k = p.metadata && typeof p.metadata === 'object' ? p.metadata.k : null;
      if (k === 'busy' || k === 'no') {
        if (!link.remoteSet) link.close(k === 'busy' ? 'busy' : 'refused');
        return;
      }
      if (p.sdp) link.onAnswer(p);
      return;
    }
    if (type === 'CANDIDATE') {
      const link = this.links.get(cid);
      if (link && link.peer === src) link.onCandidate(p);
    }
  }

  destroy() {
    this._off && this._off();
    for (const link of [...this.links.values()]) link.close('local');
    for (const [, w] of this.pings) w.done('offline');
    this.sig.onclose = null;
  }
}

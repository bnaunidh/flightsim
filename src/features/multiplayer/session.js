/**
 * Sessions: who is in the game, and what each side says to the other.
 *
 * The HOST's tab is the server. It is the only source of truth for who is
 * playing, which map, which game, and each player's number; a client believes
 * what the host tells it and nothing else. The host relays every snapshot and
 * every chat message, stamping the sender's number on each as it goes, so a
 * client cannot speak for somebody else however it is modified.
 *
 * No three.js, no DOM, no game: these classes see links and bytes, which is
 * what lets the node tests run a host and five clients against a fake
 * signaling server and count exactly who got what.
 *
 *   claimSlot / claimCode   take a free server slot, and a join code
 *   HostSession             the server: hello → welcome or deny, relay, kick, close
 *   ClientSession           one player's connection to a host
 *   Prober                  the LAN list: who holds each of the five slots
 */

import {
  PROTO, MAX_PLAYERS, SLOT_COUNT, QUICK_CHAT, LOBBY_COUNT, LOBBY_MAX, CODE_GAME_MAX, PLAYER_IDS, GAMES,
  slotId, codeId, codeOfId, makeCode, shownCode, safeName, safeServerName, callSignForId, serverNameFor, mapNameFor, safeColour, uniqueName,
  parseCallSign, lobbyName, mapIndex, randomToken,
  decodeState, stampStateId, readPlayer, readInfo, readCount, readSpawn, readWeather,
} from './protocol.js';
import { SignalError } from './signaling.js';

const nowMs = () => (globalThis.performance ? performance.now() : Date.now());

/** Friends drop after this long with nothing heard — not even a snapshot. */
export const TIMEOUT_MS = 12000;
/*
 * ...unless they have not sent a snapshot yet, which means they are still
 * loading the island. Joining changes map: applyMap, the roads and the world
 * rebuild, all on the main thread, 330-470 ms on the Mac the playtest ran on
 * and several times that on a school Chromebook, plus the shader compiles of
 * the first frame. A tab that busy answers nothing, so a slow machine could
 * be dropped as "lost connection" in the middle of arriving.
 */
export const LOADING_TIMEOUT_MS = 45000;
/*
 * And a tab that was itself asleep — its timers stopped, a long frame, a
 * laptop lid — has not heard anybody for the same reason nobody heard it.
 * The first tick after a gap this long gives everybody a moment to be heard
 * again — their messages are queued behind the stall — before anyone is
 * called silent. In the playtest, two tabs in a hidden, shared browser pane,
 * one player was once dropped "silent for 12 s" and the logs could not say
 * whose tab had stopped; this is for the case where it was the host's own.
 */
const STALL_MS = 3000;
const STALL_GRACE_MS = 2500;
const PING_EVERY_MS = 2000;
const CHAT_GAP_MS = 1200;
/*
 * A tab that is CLOSED says goodbye on its way out, but a closing page is
 * not given time to send anything: measured in the two-page playtest, the
 * host's "close" never arrived, and the player learned the host had gone
 * 11.3 s later, from WebRTC giving up, as "Lost the connection" — which
 * reads like their own Wi-Fi. A closed tab does drop its signaling sockets
 * at once, though, and the signaling server answers a note to an id nobody
 * holds with EXPIRE in a fifth of a second. So once somebody has been quiet
 * for a moment — with snapshots at 15 Hz, a quarter of a second is already
 * unusual — ask the signaling server whether they are still there. Gone from
 * it and gone from the channel is a closed tab, not a bad connection. Quiet
 * but still there (a slow machine, a stalled tab) waits for the timeout as
 * before; a player whose own internet has gone gets no answer at all and
 * also waits.
 */
export const GONE_QUIET_MS = 1500;
export const HOST_GONE_QUIET_MS = 4000;
const GONE_PROBE_EVERY_MS = 2000;
/** Server lists a host reads its details to at once. Each takes well under a second. */
export const INFO_AT_ONCE = 12;
const GONE_PING_MS = 1500;

/**
 * Whether it is time to ask if a quiet link's other end has gone: at most
 * every two seconds, and only while `link` has been quiet for `quietMs`.
 * Separate from the asking, and taking no object, because it runs for every
 * player every frame: review counted 174 minor GCs in 2M host ticks with
 * four players when the tick built an argument object, an id array and a
 * closure per player per frame just to find out it was not time.
 */
function dueGoneProbe(mark, link, net, now, quietMs) {
  if (!link || !link.lastHeard || !net || mark._goneProbe || link.state === 'closed') return false;
  if (now - link.lastHeard < quietMs || now - (mark._goneAt ?? -Infinity) < GONE_PROBE_EVERY_MS) return false;
  return !!(net.sig && net.sig.isOpen);
}

/**
 * Asks whether every id in `ids` has gone from the signaling server; calls
 * `gone()` if they all have and nothing has been heard on the link while
 * the question was out. `mark` holds this link's probe state. Only after
 * dueGoneProbe() said it was time.
 */
function probeGone(mark, link, net, ids, now, gone) {
  mark._goneAt = now;
  mark._goneProbe = true;
  const heard = link.lastHeard;
  /*
   * An empty id comes back EXPIRE in 0.2-0.6 s (measured, public server). A
   * question that is not answered in 1.5 s went to a socket that is still
   * there, or still closing: measured in the playtest, a first question sent
   * while the host's tab was closing waited out a 4 s timeout, and the player
   * heard at 5.4 s instead of 2. Short, so the next question goes sooner.
   */
  Promise.all(ids.map((id) => net.ping(id, GONE_PING_MS)))
    .then((answers) => {
      mark._goneProbe = false;
      if (link.lastHeard === heard && link.state !== 'closed' && answers.every((a) => a === 'empty')) gone();
    })
    .catch(() => {
      mark._goneProbe = false;
    });
}

/**
 * Records this tick, and says whether the session is inside the grace that
 * follows a stall of its own — in which case nobody is to be called silent yet.
 */
function justWoke(session, now) {
  const last = session._tickAt;
  session._tickAt = now;
  if (last != null && now - last > STALL_MS) session._graceUntil = now + STALL_GRACE_MS;
  return now < (session._graceUntil ?? -Infinity);
}

/* ------------------------------------------------------------------ */
/* Claiming                                                            */
/* ------------------------------------------------------------------ */

/**
 * Take the first free slot on this network. Returns { n, sig } with the
 * signaling socket that now holds it, or null when all five are taken.
 * Anything other than "taken" — a blocked socket, a server that is down — is
 * thrown, because trying the next slot will not fix it.
 */
export async function claimSlot({ hash, makeSig, prefer = 0 }) {
  const order = [];
  if (prefer >= 1 && prefer <= SLOT_COUNT) order.push(prefer);
  for (let n = 1; n <= SLOT_COUNT; n++) if (n !== prefer) order.push(n);
  for (const n of order) {
    const sig = makeSig();
    try {
      await sig.open(slotId(hash, n));
      return { n, sig };
    } catch (err) {
      sig.close();
      if (err && err.code === 'taken') continue;
      throw err;
    }
  }
  return null;
}

/**
 * A join code nobody else is using, and the socket holding it: two list
 * words and a number. Only ever a code shownCode() takes as it is, whatever
 * `rand` rolls: the host shows it on its own screen, and every joiner on
 * theirs.
 */
export async function claimCode({ makeSig, rand = Math.random, tries = 6 }) {
  for (let i = 0; i < tries; i++) {
    const code = makeCode(rand);
    if (!code || shownCode(code) !== code) continue;
    const sig = makeSig();
    try {
      await sig.open(codeId(code));
      return { code, sig };
    } catch (err) {
      sig.close();
      if (err && err.code === 'taken') continue;
      throw err;
    }
  }
  throw new SignalError('taken', 'Could not find a free code');
}

/* ------------------------------------------------------------------ */
/* The host                                                            */
/* ------------------------------------------------------------------ */

export class HostSession {
  /**
   * @param profile   { name, colour, key }
   * @param server    { name, map, mapName, game, code, slot, lobby }
   * @param hooks     { spawnInfo(), weather(), onEvent(type, ...args) }
   * @param mode      'slot'  a server a player made, from the older LAN list: five, lock and kick, a second
   *                          Swift Falcon becomes Swift Falcon 2;
   *                  'lobby' one of the five public lobbies: eight, and nobody hosts on purpose, so no lock
   *                          and no kick — and nobody may join under a username already in it;
   *                  'code'  a game for a friend on another network, joined by code: eight, the same
   *                          username rule, and lock and kick, since the host made it.
   */
  constructor({ profile, server, spawnInfo, weather, onEvent, now = nowMs, mode = 'slot', max = 0 }) {
    this.now = now;
    this.mode = mode === 'lobby' || mode === 'code' ? mode : 'slot';
    this.max = Math.min(PLAYER_IDS, max || (this.mode === 'lobby' ? LOBBY_MAX : this.mode === 'code' ? CODE_GAME_MAX : MAX_PLAYERS));
    const lobby = this.mode === 'lobby' && Number.isInteger(server.lobby) && server.lobby >= 1 && server.lobby <= LOBBY_COUNT ? server.lobby : 0;
    // Checked here too, whoever built them: everything the host sends out is list words. A lobby's name is the lobby's own.
    const name = lobby ? lobbyName(lobby) : safeServerName(server.name, serverNameFor(profile.key));
    this.server = { ...server, name, mapName: mapNameFor(server.map), lobby, max: this.max };
    this.me = { id: 0, name: safeName(profile.name, callSignForId(0)), colour: safeColour(profile.colour), host: true, key: profile.key, ping: 0, rank: 0 };
    this._rank = 0;
    /** Random, in a lobby's pong: how this host tells its own answer from another tab's (lobby.js, split brain). */
    this.token = randomToken().slice(0, 12);
    this.players = new Map();
    /*
     * Who was kicked, by the random key their browser keeps — never by name.
     * Banning the name as well (the last version did) locked out the next
     * child who happened to pick the same call sign, and with call signs from
     * two lists that is not rare. A child who clears their site data comes
     * back with a new key; that is what Lock in the player list is for.
     */
    this.banned = new Set();
    this.info = new Set();
    this.pending = new Set();
    this.nets = [];
    this.spawnInfo = spawnInfo || (() => null);
    this.weather = weather || (() => null);
    this.emit = onEvent || (() => {});
    this.closed = false;
    this._pingT = 0;
    this._rosterT = 0;
    this._rosterDirty = true;
    this._seq = 0;
    this.timeoutMs = TIMEOUT_MS;
    this.loadingTimeoutMs = LOADING_TIMEOUT_MS;
    this.goneQuietMs = HOST_GONE_QUIET_MS;
    this.locked = false;
  }

  attach(net) {
    this.nets.push(net);
    net.answersPings = true;
    // The head-count, for the server lists' pings: numbers only, never a name. A lobby adds its map and game, as numbers.
    net.pongMeta = () => (this.mode === 'lobby'
      ? { n: this.count, max: this.max, m: mapIndex(this.server.map), g: Math.max(0, GAMES.indexOf(this.server.game)), h: this.token }
      : { n: this.count, max: this.max, lk: this.locked ? 1 : 0 });
    net.onOffer = (link, meta) => this._offer(link, meta);
  }

  /**
   * A locked server lets nobody new in; the players already in stay. For a
   * host who has the whole group and does not want anybody else who shares
   * the school's internet address wandering in. Not in a lobby: its host is
   * only whoever happened to arrive first.
   */
  setLocked(on) {
    if (this.mode === 'lobby') return false;
    this.locked = !!on;
    this._rosterDirty = true;
    return this.locked;
  }

  get count() {
    return this.players.size + 1;
  }

  get full() {
    return this.count >= this.max;
  }

  describe() {
    return {
      t: 'info',
      name: this.server.name,
      map: this.server.map,
      mapName: this.server.mapName,
      game: this.server.game,
      players: this.count,
      max: this.max,
      locked: this.locked,
      v: PROTO,
    };
  }

  roster() {
    const pub = (p) => ({ id: p.id, name: p.name, colour: p.colour, host: !!p.host, ping: p.ping == null ? null : Math.round(p.ping), rank: p.rank });
    return [pub(this.me), ...[...this.players.values()].sort((a, b) => a.id - b.id).map(pub)];
  }

  _offer(link, meta) {
    if (this.closed) return false;
    if (link.kind === 'info') {
      /*
       * Somebody's server list asking what this is. Twelve at a time, and a
       * thirteenth is told it is busy — answered, not ignored (see Net) — and
       * asks again in a second or two. The list hangs up after two answers;
       * ten seconds is for one that does not.
       */
      if (this.info.size >= INFO_AT_ONCE) return 'busy';
      this.info.add(link);
      link.onevent = (ev) => {
        if (ev.t === 'info?') link.send({ ...this.describe(), ts: ev.ts });
      };
      link.onclose = () => {
        clearTimeout(link._expire);
        this.info.delete(link);
      };
      link._expire = setTimeout(() => link.close('done'), 10000);
      return true;
    }
    if (link.kind !== 'join') return false;
    if (this.pending.size >= 6) return 'busy';
    this.pending.add(link);
    link.onopen = () => {
      link._hello = setTimeout(() => link.close('no-hello'), 10000);
    };
    link.onevent = (ev) => {
      if (ev.t === 'hello') this._hello(link, ev);
      else if (ev.t === 'ping') link.send({ t: 'pong', ts: ev.ts });
    };
    link.onclose = () => {
      clearTimeout(link._hello);
      this.pending.delete(link);
    };
    return true;
  }

  _deny(link, why, extra = null) {
    link.send({ ...(extra || {}), t: 'deny', why });
    this.pending.delete(link);
    clearTimeout(link._hello);
    // Let the refusal arrive before the line goes dead.
    setTimeout(() => link.close('denied'), 400);
  }

  _hello(link, ev) {
    clearTimeout(link._hello);
    if (this.closed) return this._deny(link, 'closing');
    if (Number(ev.v) !== PROTO) return this._deny(link, 'version');
    // A client that sends no key is kept out by the id it connected under instead.
    const key = typeof ev.key === 'string' && /^[\x21-\x7e]{1,40}$/.test(ev.key) ? ev.key : `peer:${link.peer}`;
    if (this.banned.has(key)) return this._deny(link, 'kicked');
    /*
     * The same tab coming back — its connection to us broke and it asked
     * again, which is what a player does when it thinks the lobby's host has
     * gone. The old seat is theirs; without this their own username, still
     * held by the seat that is going, would keep them out.
     */
    const seat = typeof ev.seat === 'string' && /^[a-z0-9]{8,24}$/.test(ev.seat) ? ev.seat : null;
    if (seat) for (const old of this.players.values()) if (old.seat === seat) this._gone(old, 'left', 'came back');
    if (this.full) return this._deny(link, 'full');
    if (this.locked) return this._deny(link, 'locked');
    let id = 1;
    while (this.players.has(id)) id++;
    if (id >= this.max) return this._deny(link, 'full');
    const taken = [this.me.name, ...[...this.players.values()].map((p) => p.name)];
    // Their call sign if it parses against the lists; if not, one made from their number. Nothing else is ever shown.
    const own = parseCallSign(ev.name) ? ev.name : null;
    let name;
    if (this.mode === 'slot') name = uniqueName(safeName(ev.name, callSignForId(id)), taken);
    else if (own && taken.includes(own)) {
      /*
       * A lobby, or a game joined by code: one username, one player. The
       * joiner is told, with a username that is free here right now to take
       * with one tap. Two who ask at once are answered one after the other —
       * this is one tab's event loop — so the second is the one told.
       */
      return this._deny(link, 'name', { suggest: uniqueName(own, taken) });
    } else name = own || uniqueName(callSignForId(id), taken);
    this.pending.delete(link);
    const p = {
      id,
      name,
      colour: safeColour(ev.colour),
      key,
      seat,
      host: false,
      link,
      ping: null,
      chatAt: -Infinity,
      last: null,
      lastSnap: null,
      rank: ++this._rank,
    };
    this.players.set(id, p);
    link.onevent = (e) => this._event(p, e);
    link.onstate = (buf) => this._state(p, buf);
    link.onclose = (reason) => this._gone(p, reason === 'local' ? 'left' : 'dropped', reason);
    link.send({
      t: 'welcome',
      v: PROTO,
      you: id,
      name: p.name,
      // A lobby's host says which token its pongs carry, so a player can tell it from the next host (lobby.js).
      server: { ...this.server, h: this.mode === 'lobby' ? this.token : undefined },
      players: this.roster(),
      at: this.spawnInfo(),
      weather: this.weather(),
    });
    this._broadcast({ t: 'join', p: { id, name: p.name, colour: p.colour, host: false, rank: p.rank } }, p.id);
    this._rosterDirty = true;
    this.emit('join', { id, name: p.name, colour: p.colour });
  }

  _event(p, ev) {
    switch (ev.t) {
      case 'ping':
        p.link.send({ t: 'pong', ts: ev.ts });
        break;
      case 'pong':
        if (Number.isFinite(ev.ts)) p.ping = Math.max(0, this.now() - ev.ts);
        break;
      case 'chat': {
        const m = Number(ev.m);
        if (!Number.isInteger(m) || !QUICK_CHAT[m]) return;
        const now = this.now();
        if (now - p.chatAt < CHAT_GAP_MS) return; // one at a time, please
        p.chatAt = now;
        this._broadcast({ t: 'chat', id: p.id, m }, p.id);
        this.emit('chat', { id: p.id, name: p.name, colour: p.colour }, m);
        break;
      }
      case 'bye':
        this._gone(p, 'left');
        break;
      default:
        break;
    }
  }

  _state(p, buf) {
    const snap = decodeState(buf);
    if (!snap) return;
    // Whatever number they put on it, it is theirs now.
    stampStateId(buf, p.id);
    snap.id = p.id;
    p.lastSnap = snap;
    for (const q of this.players.values()) if (q !== p) q.link.sendState(buf);
    this.emit('state', snap);
  }

  _gone(p, why, detail = why) {
    if (this.players.get(p.id) !== p) return;
    this.players.delete(p.id);
    if (p.link.state !== 'closed') {
      p.link.onclose = null;
      p.link.close('local');
    }
    this._broadcast({ t: 'leave', id: p.id, why });
    this._rosterDirty = true;
    this.emit('leave', { id: p.id, name: p.name, colour: p.colour }, why, detail);
  }

  _broadcast(ev, except = -1) {
    for (const q of this.players.values()) if (q.id !== except) q.link.send(ev);
  }

  kick(id) {
    // Nobody hosts a lobby on purpose, so nobody in one can remove anybody.
    if (this.mode === 'lobby') return false;
    const p = this.players.get(id);
    if (!p) return false;
    this.banned.add(p.key);
    p.link.send({ t: 'kick' });
    const link = p.link;
    // Out of the list now; the line itself goes once the message has had time to land.
    link.onclose = null;
    this.players.delete(p.id);
    this._broadcast({ t: 'leave', id: p.id, why: 'kicked' });
    this._rosterDirty = true;
    this.emit('leave', { id: p.id, name: p.name, colour: p.colour }, 'kicked');
    setTimeout(() => link.close('kicked'), 300);
    return true;
  }

  chat(m) {
    if (!QUICK_CHAT[m] || this.closed) return false;
    const now = this.now();
    if (now - (this.me.chatAt || -Infinity) < CHAT_GAP_MS) return false;
    this.me.chatAt = now;
    this._broadcast({ t: 'chat', id: 0, m });
    return true;
  }

  /** Once a frame or so. `stateBuf` is the host's own snapshot, if it is time to send one. */
  tick(now = this.now(), stateBuf = null) {
    if (this.closed) return;
    if (stateBuf) {
      stampStateId(stateBuf, 0);
      for (const p of this.players.values()) p.link.sendState(stateBuf);
    }
    if (now - this._pingT >= PING_EVERY_MS) {
      this._pingT = now;
      for (const p of this.players.values()) p.link.send({ t: 'ping', ts: now });
    }
    if (!justWoke(this, now)) {
      // Deleting the entry being visited is safe in a Map's for...of; no copy of the list every frame.
      for (const p of this.players.values()) {
        const limit = p.lastSnap ? this.timeoutMs : this.loadingTimeoutMs;
        if (p.link.lastHeard && now - p.link.lastHeard > limit) {
          this._gone(p, 'dropped', `silent for ${Math.round(limit / 1000)} s`);
          continue;
        }
        // A player's tab that was closed: gone from the signaling server too. Longer than the
        // player's own wait, because a joiner loading the island is quiet for seconds.
        if (dueGoneProbe(p, p.link, p.link.net, now, this.goneQuietMs)) {
          probeGone(p, p.link, p.link.net, [p.link.peer], now, () => this.players.get(p.id) === p && this._gone(p, 'left', 'closed their game'));
        }
      }
    }
    if (this._rosterDirty || now - this._rosterT > 5000) {
      this._rosterDirty = false;
      this._rosterT = now;
      this._broadcast({ t: 'roster', players: this.roster() });
      this.emit('roster', this.roster());
    }
  }

  /**
   * This tab is not the lobby's host after all: somebody else holds the
   * lobby's id (see lobby.js). Everybody here is told to go and join them,
   * and this tab follows.
   */
  move() {
    if (this.closed) return;
    this._broadcast({ t: 'move' });
    this.close();
  }

  /** The host is leaving. Everybody is told, then every line is closed. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this._broadcast({ t: 'close' });
    const links = [...[...this.players.values()].map((p) => p.link), ...this.info, ...this.pending];
    for (const p of this.players.values()) p.link.onclose = null;
    this.players.clear();
    setTimeout(() => {
      for (const l of links) l.close('local');
      for (const n of this.nets) n.destroy();
    }, 250);
  }
}

/* ------------------------------------------------------------------ */
/* A player                                                            */
/* ------------------------------------------------------------------ */

const DENY = {
  full: 'That server is full — five players is the most.',
  name: 'Somebody there already has your username — change your number or pick another name.',
  version: 'That server is running a different version of the game. Reload the page on both computers.',
  kicked: 'The host has taken you out of that server for now. You can join a different one, or fly on your own.',
  closing: 'That server is closing.',
  locked: 'That server is locked — the host isn’t letting anybody new in.',
};

export class ClientSession {
  constructor({ net, target, profile, onEvent, now = nowMs, seat = null }) {
    this.net = net;
    this.target = target;
    this.profile = profile;
    this.seat = seat;
    this.rank = null;
    this.emit = onEvent || (() => {});
    this.now = now;
    this.id = null;
    this.server = null;
    this.players = new Map();
    this.welcomed = false;
    this.ended = false;
    this.link = null;
    this._pingT = 0;
    this.ping = null;
    this.timeoutMs = TIMEOUT_MS;
    this.goneQuietMs = GONE_QUIET_MS;
  }

  /** Resolves with the welcome; rejects with an Error whose `code` says why. */
  start() {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      const link = this.net.connect(this.target, 'join');
      this.link = link;
      link.onopen = () => {
        link.send({ t: 'hello', v: PROTO, name: this.profile.name, colour: this.profile.colour, key: this.profile.key, seat: this.seat || undefined });
      };
      link.onevent = (ev) => this._event(ev);
      link.onstate = (buf) => {
        const snap = decodeState(buf);
        if (snap && snap.id !== this.id && this.welcomed) this.emit('state', snap);
      };
      link.onclose = (reason) => this._closed(reason);
    });
  }

  _fail(code, message, extra = null) {
    if (this._reject) {
      const e = new Error(message || code);
      e.code = code;
      if (extra) Object.assign(e, extra);
      const r = this._reject;
      this._reject = this._resolve = null;
      r(e);
    }
  }

  _event(ev) {
    switch (ev.t) {
      case 'welcome': {
        if (this.welcomed) return;
        const you = Number(ev.you);
        if (!Number.isInteger(you) || you < 1 || you >= PLAYER_IDS) return this.link.close('bad-welcome');
        this.id = you;
        this.welcomed = true;
        const s = ev.server || {};
        this.server = {
          name: safeServerName(s.name),
          map: String(s.map || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 32),
          mapName: mapNameFor(s.map),
          game: ['flight', 'heli', 'boat', 'car'].includes(s.game) ? s.game : 'flight',
          /*
           * Shown on this player's badge and list all game. A player who
           * typed a code is shown that code — their own, as the lists spell
           * it. One who joined from the list is shown the host's only if it
           * is exactly two list words and a list number: a modified host can
           * pick among those, and nothing else.
           */
          code: codeOfId(this.target) || shownCode(s.code),
          slot: Number.isInteger(s.slot) && s.slot >= 1 && s.slot <= SLOT_COUNT ? s.slot : 0,
          lobby: Number.isInteger(s.lobby) && s.lobby >= 1 && s.lobby <= LOBBY_COUNT ? s.lobby : 0,
          h: typeof s.h === 'string' && /^[a-z0-9]{1,16}$/.test(s.h) ? s.h : null,
          max: Number.isInteger(s.max) && s.max >= 2 && s.max <= PLAYER_IDS ? s.max : MAX_PLAYERS,
        };
        // A lobby is called what this copy calls it, whatever the host said.
        if (this.server.lobby) this.server.name = lobbyName(this.server.lobby);
        this.name = safeName(ev.name, safeName(this.profile.name, callSignForId(you)));
        this._roster(ev.players);
        const w = { you, name: this.name, server: this.server, players: [...this.players.values()], at: readSpawn(ev.at), weather: readWeather(ev.weather) };
        if (this._resolve) {
          const r = this._resolve;
          this._resolve = this._reject = null;
          r(w);
        }
        break;
      }
      case 'deny':
        // The words are this copy's own, looked up; what the host sent is only the key — and a suggestion only if it is a call sign.
        if (ev.why === 'name') this._fail('name', DENY.name, { suggest: parseCallSign(ev.suggest) && ev.suggest !== this.profile.name ? ev.suggest : null });
        else if (Object.hasOwn(DENY, ev.why)) this._fail(ev.why, DENY[ev.why]);
        else this._fail('denied', 'The server said no.');
        this.link.close('denied');
        break;
      case 'join': {
        const p = readPlayer(ev.p);
        if (!p || !this.welcomed || p.id === this.id) return;
        this.players.set(p.id, p);
        this.emit('join', p);
        break;
      }
      case 'leave': {
        const p = this.players.get(Number(ev.id));
        if (!p) return;
        this.players.delete(p.id);
        // One of three words, never the host's text: the screen looks it up in a table.
        this.emit('leave', p, ['left', 'dropped', 'kicked'].includes(ev.why) ? ev.why : 'left');
        break;
      }
      case 'roster':
        if (this.welcomed) {
          this._roster(ev.players);
          this.emit('roster', [...this.players.values()]);
        }
        break;
      case 'chat': {
        const m = Number(ev.m);
        const p = this.players.get(Number(ev.id));
        if (p && Number.isInteger(m) && QUICK_CHAT[m]) this.emit('chat', p, m);
        break;
      }
      case 'ping':
        this.link.send({ t: 'pong', ts: ev.ts });
        break;
      case 'pong':
        if (Number.isFinite(ev.ts)) this.ping = Math.max(0, this.now() - ev.ts);
        break;
      case 'kick':
        this._end('kicked');
        break;
      case 'close':
        this._end('closed');
        break;
      case 'move':
        // The lobby's real host is somebody else; go and join them (lobby.js).
        this._end('moved');
        break;
      default:
        break;
    }
  }

  /** The host's list is the list: anybody missing from it has gone. */
  _roster(list) {
    if (!Array.isArray(list)) return;
    const seen = new Set();
    for (const raw of list.slice(0, PLAYER_IDS)) {
      const p = readPlayer(raw);
      if (!p) continue;
      seen.add(p.id);
      if (p.id === this.id) {
        this.name = p.name;
        this.rank = p.rank;
        continue;
      }
      const had = this.players.get(p.id);
      this.players.set(p.id, had ? Object.assign(had, p) : p);
    }
    for (const id of [...this.players.keys()]) if (!seen.has(id)) this.players.delete(id);
  }

  _closed(reason) {
    if (!this.welcomed) {
      /*
       * A server from the list is on this Wi-Fi's internet address, and is
       * reached over the Wi-Fi alone (see link.js); a network that keeps its
       * devices apart stops that, and the code — which may use the public
       * address — is the other way in. A code that fails is two networks
       * that will not connect directly.
       */
      const unreachable = /^ifs-code-/.test(String(this.target))
        ? 'Couldn’t reach the other planes — the two networks won’t connect directly. Try from the same Wi-Fi.'
        : 'Couldn’t reach the other planes over this Wi-Fi — ask the host for their join code and join with that.';
      const why = {
        gone: ['gone', 'Nobody is hosting there any more.'],
        timeout: ['timeout', unreachable],
        ice: ['ice', unreachable],
        signaling: ['signaling', 'Lost the connection to the matchmaking server.'],
        rtc: ['rtc', 'This browser could not start a connection.'],
        busy: ['busy', 'That server is busy letting somebody else in — try again in a moment.'],
        refused: ['refused', 'That server isn’t taking players.'],
      }[reason] || ['dropped', 'The connection closed before the game started.'];
      this._fail(why[0], why[1]);
      return;
    }
    this._end(reason === 'kicked' ? 'kicked' : 'dropped', reason);
  }

  _end(why, detail = why) {
    if (this.ended) return;
    this.ended = true;
    if (this.link && this.link.state !== 'closed') {
      this.link.onclose = null;
      this.link.close('local');
    }
    this.emit('ended', why, detail);
  }

  chat(m) {
    if (!this.welcomed || this.ended || !QUICK_CHAT[m]) return false;
    const now = this.now();
    if (now - (this._chatAt || -Infinity) < CHAT_GAP_MS) return false;
    this._chatAt = now;
    return this.link.send({ t: 'chat', m });
  }

  tick(now = this.now(), stateBuf = null) {
    if (!this.welcomed || this.ended) return;
    if (stateBuf) {
      stampStateId(stateBuf, this.id);
      this.link.sendState(stateBuf);
    }
    if (now - this._pingT >= PING_EVERY_MS) {
      this._pingT = now;
      this.link.send({ t: 'ping', ts: now });
    }
    if (justWoke(this, now)) return;
    if (this.link.lastHeard && now - this.link.lastHeard > this.timeoutMs) {
      this._end('dropped', `silent for ${Math.round(this.timeoutMs / 1000)} s`);
      return;
    }
    // The host's tab closed: its slot and its code both gone from the signaling server.
    if (!dueGoneProbe(this, this.link, this.net, now, this.goneQuietMs)) return;
    if (this.server && this.server.lobby && this.server.h) {
      /*
       * A lobby: its host has gone if nobody holds the lobby — or if somebody
       * else does, because the lobby has already re-formed round the next in
       * line while this player's question was on its way (their pong carries
       * a different token). Without the second half, a player a moment slower
       * than the rest heard "still there" from the new host and sat out the
       * twelve-second silence.
       */
      this._goneAt = now;
      this._goneProbe = true;
      const heard = this.link.lastHeard;
      this.net.pingInfo(this.target, GONE_PING_MS).then(({ r, meta }) => {
        this._goneProbe = false;
        if (this.ended || this.link.lastHeard !== heard || this.link.state === 'closed') return;
        const other = r === 'here' && meta && typeof meta.h === 'string' && meta.h !== this.server.h;
        if (r === 'empty' || other) this._end('closed', other ? 'the lobby has a new host' : 'the host is gone from the matchmaking server');
      }).catch(() => {
        this._goneProbe = false;
      });
      return;
    }
    const ids = [this.target];
    const byCode = this.server && this.server.code ? codeId(this.server.code) : null;
    if (byCode && byCode !== this.target) ids.push(byCode);
    probeGone(this, this.link, this.net, ids, now, () => this._end('closed', 'the host is gone from the matchmaking server'));
  }

  leave() {
    if (this.ended) return;
    this.ended = true;
    const link = this.link;
    if (!link) return;
    link.onclose = null;
    if (link.isOpen) {
      link.send({ t: 'bye' });
      setTimeout(() => link.close('local'), 150);
    } else link.close('local');
    this._fail('left', 'Stopped joining.');
  }
}

/* ------------------------------------------------------------------ */
/* The LAN list                                                        */
/* ------------------------------------------------------------------ */

/**
 * Keeps an eye on the five slots while the Multiplayer screen is open.
 *
 * Each slot is pinged every three seconds through the signaling server; an
 * empty one answers EXPIRE at once, and a host's pong carries its head-count.
 * The rest of what the card shows — the server's name, map and game — is
 * asked over a data channel, twice (the quicker round trip is the ping on the
 * card), and then the channel is CLOSED. It used to be held open and asked
 * every two seconds, and a host has room for twelve of those: measured in
 * review with twenty lists open on one host, the other eight never got in.
 * Now each list holds a host's attention for well under a second, reads the
 * name again every thirty, and a host that is busy says so and is asked again
 * a moment later.
 *
 * Slot states:
 *   looking      not heard from yet, or reading the details
 *   empty        nobody hosting in it
 *   open / full  a server, details known
 *   locked       its host is not letting anybody new in
 *   old          a different version of the game
 *   busy         a server is there, too busy to give its details yet — Join works
 *   unreachable  a server is there, but no connection could be made to it — Join can still be tried
 */
export class Prober {
  constructor({
    net, hash, onChange, now = nowMs, pingEveryMs = 3000, infoEveryMs = 30000,
    busyRetryMs = [1500, 4000], failRetryMs = [5000, 20000], rand = Math.random,
  }) {
    this.net = net;
    this.hash = hash;
    this.onChange = onChange || (() => {});
    this.now = now;
    this.pingEveryMs = pingEveryMs;
    this.infoEveryMs = infoEveryMs;
    this.busyRetryMs = busyRetryMs;
    this.failRetryMs = failRetryMs;
    this.rand = rand;
    this.slots = [];
    for (let n = 1; n <= SLOT_COUNT; n++) {
      this.slots.push({
        n, id: slotId(hash, n), state: 'looking', info: null, count: null, ping: null, link: null, timer: null,
        fails: 0, infoAt: -Infinity, infoAfter: -Infinity, why: null,
      });
    }
    this.running = false;
  }

  start() {
    if (this.running) return;
    this.running = true;
    for (const s of this.slots) this._probe(s);
  }

  stop() {
    this.running = false;
    for (const s of this.slots) {
      clearTimeout(s.timer);
      this.release(s.n);
    }
  }

  /** Let a slot's details connection go — used when we are about to join it ourselves. */
  release(n) {
    const s = this.slots[n - 1];
    if (!s || !s.link) return;
    s.link.onclose = null;
    s.link.close('local');
    s.link = null;
  }

  /** Whether the card should offer Join: there is a server there that we have not been told is full or shut. */
  static joinable(s) {
    return !!s && (s.state === 'open' || s.state === 'busy' || s.state === 'unreachable');
  }

  _paint(s) {
    this.onChange(this.slots, s);
  }

  /** The card's state from what is known: the details if we have them, the head-count from the last pong either way. */
  _settle(s) {
    const c = s.count;
    if (s.info) {
      if (c) {
        s.info.players = c.players;
        s.info.max = c.max;
        s.info.full = c.full;
        s.info.locked = c.locked;
      }
      const i = s.info;
      s.state = i.v !== PROTO ? 'old' : i.full ? 'full' : i.locked ? 'locked' : 'open';
    } else if (c && c.v && c.v !== PROTO) s.state = 'old';
    else if (c && c.full) s.state = 'full';
    else if (c && c.locked) s.state = 'locked';
    else if (s.why === 'busy') s.state = 'busy';
    else if (s.why === 'unreachable') s.state = 'unreachable';
    else s.state = 'looking';
  }

  _later(s, ms) {
    clearTimeout(s.timer);
    if (this.running) s.timer = setTimeout(() => this._probe(s), ms);
  }

  _between([a, b]) {
    return a + (b - a) * this.rand();
  }

  async _probe(s) {
    if (!this.running) return;
    const { r, meta } = await this.net.pingInfo(s.id);
    if (!this.running) return;
    if (r === 'empty') {
      const was = s.state;
      s.fails = 0;
      s.ping = null;
      s.info = null;
      s.count = null;
      s.why = null;
      s.infoAt = s.infoAfter = -Infinity;
      if (s.link) this.release(s.n);
      s.state = 'empty';
      if (was !== 'empty') this._paint(s);
      this._later(s, this.pingEveryMs);
      return;
    }
    if (r !== 'here') {
      // No answer at all: the signaling server is having a moment. Keep what the card says.
      this._later(s, this.pingEveryMs);
      return;
    }
    if (s.state === 'empty') s.info = null;
    s.count = readCount(meta);
    const t = this.now();
    if (!s.link && (!s.info || t - s.infoAt > this.infoEveryMs) && t >= s.infoAfter) this._details(s);
    this._settle(s);
    this._paint(s);
    this._later(s, this.pingEveryMs);
  }

  /** Ask the host for its name, map and game over a data channel, twice, then hang up. */
  _details(s) {
    const link = this.net.connect(s.id, 'info');
    s.link = link;
    let answers = 0;
    let best = Infinity;
    const ask = () => link.send({ t: 'info?', ts: this.now() });
    link.onopen = ask;
    link.onevent = (ev) => {
      if (ev.t !== 'info') return;
      const info = readInfo(ev);
      if (!info) return;
      answers++;
      if (Number.isFinite(ev.ts)) best = Math.min(best, Math.max(1, Math.round(this.now() - ev.ts)));
      if (Number.isFinite(best)) s.ping = best;
      s.info = info;
      s.infoAt = this.now();
      s.fails = 0;
      s.why = null;
      // The details are newer than the last pong's head-count.
      s.count = { players: info.players, max: info.max, full: info.full, locked: info.locked, v: info.v };
      this._settle(s);
      this._paint(s);
      if (answers < 2) ask();
      else link.close('done');
    };
    link.onclose = (reason) => {
      if (s.link === link) s.link = null;
      if (!this.running || reason === 'done' || reason === 'local') return;
      if (reason === 'busy') {
        // Twelve other lists are reading it right now; one of them will be done in a moment.
        s.why = s.info ? s.why : 'busy';
        s.infoAfter = this.now() + this._between(this.busyRetryMs);
        this._later(s, s.infoAfter - this.now());
      } else if (answers === 0) {
        s.fails++;
        if (!s.info) s.why = 'unreachable';
        s.infoAfter = this.now() + (s.fails > 2 ? this.failRetryMs[1] : this.failRetryMs[0]);
      }
      this._settle(s);
      this._paint(s);
    };
  }
}

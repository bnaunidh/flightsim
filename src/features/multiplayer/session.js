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
  parseCallSign, lobbyName, worldName, worldOf, WORLD_COUNT, mapIndex, randomToken, pdirId, PDIR_COUNT, bumpRule,
  decodeState, decodeStates, encodeBundle, stampStateId, readPlayer, readInfo, readCount, readSpawn, readWeather,
} from './protocol.js';
import { SignalError } from './signaling.js';
import { nonce, proofText, verifyProof, adminCrypto } from './admin.js';

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
/*
 * The host sends each player at most one state packet this often, holding
 * everybody's newest snapshot for them meanwhile (protocol.js, bundles).
 * It flushes on the next thing to happen after this long — another
 * snapshot arriving, which in a lobby of eight is every 10 ms, or its own
 * frame — so a bundle waits 25 ms on average, which predict() (interp.js)
 * draws past. 0 relays each snapshot the moment it arrives, as before.
 */
export const BUNDLE_MS = 50;

/*
 * Part 3b, admins (admin.js). An admin's freeze holds a player still this
 * long, then lets go by itself; an admin can let go sooner. How long a host
 * waits for an admin's signed answer before letting them in as anybody else.
 */
export const FREEZE_MS = 30000;
const PROVE_WAIT_MS = 5000;
/** What an admin may ask a host to do. */
export const ADMIN_OPS = Object.freeze(['kick', 'mute', 'unmute', 'freeze', 'unfreeze', 'close']);

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

/**
 * Part 3b: a place in the admins' directory of private matches (protocol.js,
 * pdirId), and the socket holding it — a few tries from a random place, then
 * none: a private match that finds the directory full is still a private
 * match, only one an admin cannot find. Null rather than an error, always.
 */
export async function claimPdir({ makeSig, rand = Math.random, tries = 4 }) {
  const start = Math.floor(rand() * PDIR_COUNT);
  for (let i = 0; i < tries; i++) {
    const n = ((start + i) % PDIR_COUNT) + 1;
    const sig = makeSig();
    try {
      await sig.open(pdirId(n));
      return { n, sig };
    } catch (err) {
      sig.close();
      if (!(err && err.code === 'taken')) return null;
    }
  }
  return null;
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
  constructor({ profile, server, spawnInfo, weather, onEvent, now = nowMs, mode = 'slot', max = 0, admin = false }) {
    this.now = now;
    this.mode = mode === 'lobby' || mode === 'code' ? mode : 'slot';
    this.max = Math.min(PLAYER_IDS, max || (this.mode === 'lobby' ? LOBBY_MAX : this.mode === 'code' ? CODE_GAME_MAX : MAX_PLAYERS));
    // A world lobby (list 3): one of the five that are the same for everybody on the internet.
    const world = this.mode === 'lobby' && server.world === true;
    const lobby = this.mode === 'lobby' && Number.isInteger(server.lobby) && server.lobby >= 1 && server.lobby <= (world ? WORLD_COUNT : LOBBY_COUNT) ? server.lobby : 0;
    // Checked here too, whoever built them: everything the host sends out is list words. A lobby's name is the lobby's own.
    const name = lobby ? (world ? worldName(lobby) : lobbyName(lobby)) : safeServerName(server.name, serverNameFor(profile.key));
    // A game made to be joined by code only (the lobby screen's private match): on no list anywhere.
    this.server = { ...server, name, mapName: mapNameFor(server.map), lobby, world: !!(world && lobby), max: this.max, priv: this.mode === 'code' };
    // `admin`: this device has an admin key (admin.js). The host is its own server, so it takes its own word for it.
    this.me = {
      id: 0, name: safeName(profile.name, callSignForId(0)), colour: safeColour(profile.colour), host: true, key: profile.key, ping: 0, rank: 0,
      admin: !!admin, muted: false, frozenUntil: 0,
    };
    this.freezeMs = FREEZE_MS;
    this.proveWaitMs = PROVE_WAIT_MS;
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
    this.bundleMs = BUNDLE_MS;
  }

  attach(net) {
    this.nets.push(net);
    net.answersPings = true;
    // The head-count, for the server lists' pings: numbers only, never a name. A lobby adds its map and game, as numbers.
    // A private match adds its map and game too, as numbers, for the card a friend sees when they type its code (lobbyui.js).
    // List 2, part 2: and the bumping rule, a number (protocol.js BUMP_RULES), for the lobby card.
    net.pongMeta = () => (this.mode === 'lobby'
      ? { n: this.count, max: this.max, m: mapIndex(this.server.map), g: Math.max(0, GAMES.indexOf(this.server.game)), h: this.token, b: bumpRule(this.server.bump) }
      : this.mode === 'code'
        ? { n: this.count, max: this.max, lk: this.locked ? 1 : 0, m: mapIndex(this.server.map), g: Math.max(0, GAMES.indexOf(this.server.game)), b: bumpRule(this.server.bump) }
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
    const now = this.now();
    // Part 3b: an admin (the host checked their signature), and who an admin has muted or frozen — flags, nothing else.
    const pub = (p) => ({
      id: p.id, name: p.name, colour: p.colour, host: !!p.host, ping: p.ping == null ? null : Math.round(p.ping), rank: p.rank,
      adm: p.admin ? 1 : undefined, mu: p.muted ? 1 : undefined, fz: p.frozenUntil > now ? 1 : undefined,
    });
    return [pub(this.me), ...[...this.players.values()].sort((a, b) => a.id - b.id).map(pub)];
  }

  _offer(link, meta) {
    if (this.closed) return false;
    // An admin's way into a private match (the directory, protocol.js pdirId): joining only, and only for an admin.
    if (link.net && link.net.dirOnly && link.kind !== 'join') return false;
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
      else if (ev.t === 'prove') this._prove(link, ev);
      else if (ev.t === 'ping') link.send({ t: 'pong', ts: ev.ts });
    };
    link.onclose = () => {
      clearTimeout(link._hello);
      clearTimeout(link._proveTimer);
      this.pending.delete(link);
    };
    return true;
  }

  /*
   * Part 3b: somebody says they are an admin. They are asked — a fresh random
   * nonce, for this line only — and their hello waits for the answer. Only a
   * signature by an admin key over that nonce, this host's id and the id they
   * came from makes them one (admin.js); anything else, or nothing within
   * five seconds, and they come in as anybody would.
   */
  _ask(link, ev) {
    if (link._chal) return;
    link._chal = nonce();
    link._helloEv = ev;
    link.send({ t: 'chal', n: link._chal });
    link._proveTimer = setTimeout(() => this._proved(link, false), this.proveWaitMs);
  }

  _prove(link, ev) {
    if (!link._chal || link._proving || link._proof != null) return;
    link._proving = true;
    const hostId = link.net && link.net.sig ? link.net.sig.id : null;
    const text = proofText(link._chal, hostId, link.peer);
    verifyProof(text, ev.s).then((yes) => this._proved(link, !!(yes && hostId)), () => this._proved(link, false));
  }

  _proved(link, yes) {
    if (link._proof != null) return;
    clearTimeout(link._proveTimer);
    link._proof = !!yes;
    if (this.closed || link.state === 'closed' || !this.pending.has(link)) return;
    this._hello(link, link._helloEv);
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
    // "I am an admin": asked first (see _ask). A host that cannot check (no WebCrypto) lets them in as anybody.
    if (ev.adm === 1 && link._proof == null && adminCrypto()) return this._ask(link, ev);
    const admin = link._proof === true;
    // Through the directory, a private match lets in admins only; everybody else needs its code.
    if (link.net && link.net.dirOnly && !admin) return this._deny(link, 'private');
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
    // An admin comes in whether or not the host has locked the door.
    if (this.locked && !admin) return this._deny(link, 'locked');
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
      admin,
      muted: false,
      frozenUntil: 0,
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
    this._broadcast({ t: 'join', p: { id, name: p.name, colour: p.colour, host: false, rank: p.rank, adm: admin ? 1 : undefined } }, p.id);
    this._rosterDirty = true;
    this.emit('join', { id, name: p.name, colour: p.colour, admin });
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
        // Muted by an admin: said to nobody.
        if (p.muted) return;
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
      case 'adm':
        // An admin's request. Only from a player this host checked the signature of; from anybody else, nothing.
        if (p.admin) this.adminAct(ev.op, Number(ev.id), p);
        break;
      case 'gev':
        // A game event (events.js): checked, relayed or kept by the controller's GameEvents, which knows the kinds.
        if (typeof ev.k === 'string') this.emit('gev', { id: p.id, name: p.name, colour: p.colour, host: false }, { k: ev.k, d: ev.d, h: ev.h ? 1 : 0 });
        break;
      default:
        break;
    }
  }

  /* Game events and shared state out (events.js). The host is always player 0. */
  sendGame(ev, except = -1) {
    if (this.closed) return false;
    this._broadcast({ t: 'gev', k: ev.k, d: ev.d, f: Number.isInteger(ev.f) ? ev.f : 0 }, except);
    return true;
  }

  sendGameTo(id, ev) {
    const p = this.players.get(id);
    return !!(p && !this.closed && p.link.send({ t: 'gev', k: ev.k, d: ev.d, f: Number.isInteger(ev.f) ? ev.f : 0 }));
  }

  sendGameState(ev) {
    if (this.closed) return false;
    this._broadcast({ t: 'gst', k: ev.k, d: ev.d });
    return true;
  }

  sendGameStateTo(id, ev) {
    const p = this.players.get(id);
    return !!(p && !this.closed && p.link.send({ t: 'gst', k: ev.k, d: ev.d }));
  }

  _state(p, buf) {
    let snap = decodeState(buf);
    if (!snap) return;
    // Whatever number they put on it, it is theirs now.
    stampStateId(buf, p.id);
    snap.id = p.id;
    if (p.frozenUntil > this.now()) {
      // Frozen by an admin: wherever their own game says they are, everybody sees them where they were frozen, still.
      if (!p.frozenBuf) p.frozenBuf = buf.slice(0);
      const u = new Uint8Array(buf);
      u.set(new Uint8Array(p.frozenBuf, 8, 20), 8);
      u.fill(0, 28, 34);
      snap = decodeState(buf) || snap;
    } else p.lastBuf = buf;
    p.lastSnap = snap;
    const now = this.now();
    for (const q of this.players.values()) if (q !== p) this._queue(q, p.id, buf, now);
    this.emit('state', snap);
  }

  /** Hold `buf` (player `id`'s newest) for player q, and send q's packet if it is due. */
  _queue(q, id, buf, now) {
    if (!q.out) q.out = new Map();
    q.out.set(id, buf);
    if (now - (q.outAt ?? -Infinity) >= this.bundleMs) this._flush(q, now);
  }

  _flush(q, now) {
    const out = q.out;
    if (!out || !out.size) return;
    q.outAt = now;
    let sent;
    if (out.size === 1) sent = q.link.sendState(out.values().next().value);
    else sent = q.link.sendState(encodeBundle([...out.values()]));
    this.sentPackets = (this.sentPackets || 0) + (sent ? 1 : 0);
    out.clear();
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

  kick(id, byAdmin = false) {
    // Nobody hosts a lobby on purpose, so nobody in one can remove anybody — except an admin (part 3b).
    if (this.mode === 'lobby' && !byAdmin) return false;
    const p = this.players.get(id);
    if (!p) return false;
    // An admin is not removed by anybody.
    if (p.admin) return false;
    this.banned.add(p.key);
    p.link.send(byAdmin ? { t: 'kick', a: 1 } : { t: 'kick' });
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
    if (!QUICK_CHAT[m] || this.closed || this.me.muted) return false;
    const now = this.now();
    if (now - (this.me.chatAt || -Infinity) < CHAT_GAP_MS) return false;
    this.me.chatAt = now;
    this._broadcast({ t: 'chat', id: 0, m });
    return true;
  }

  /**
   * Part 3b: what an admin asks for, done by the host — `by` is the admin (a
   * player whose signature this host checked, or the host itself if this
   * device is an admin). Returns true if it was done.
   *
   *   kick      out, and kept out of this host's game; in a lobby the host
   *             itself goes, and the lobby re-forms round the next in line
   *   mute      their quick chat goes to nobody, until unmute
   *   freeze    they cannot move for FREEZE_MS, or until unfreeze: their own
   *             game holds them, and the host relays them where they were
   *   close     everybody back to the lobby list, kindly
   *
   * Nobody does any of it to an admin. Everybody sees who is muted or frozen
   * (the list), and admins wear a badge: nothing an admin does is hidden.
   */
  adminAct(op, id, by = this.me) {
    if (this.closed || !by || !by.admin || !ADMIN_OPS.includes(op)) return false;
    if (op === 'close') return this.adminClose(by);
    const self = id === 0;
    const p = self ? this.me : this.players.get(id);
    if (!p || p.admin || p === by) return false;
    const now = this.now();
    let done = false;
    if (op === 'kick') {
      if (self) {
        // The host itself: out of a lobby, which re-forms; in a match the host made, the match is over — that is Close.
        if (this.mode !== 'lobby') return false;
        this.emit('admin', { op, id, by: by.name, name: p.name });
        this.emit('removed', 'kicked');
        return true;
      }
      done = this.kick(id, true);
    } else if (op === 'mute' || op === 'unmute') {
      done = p.muted !== (op === 'mute');
      p.muted = op === 'mute';
    } else if (op === 'freeze') {
      p.frozenUntil = now + this.freezeMs;
      p.frozenBuf = !self && p.lastBuf ? p.lastBuf.slice(0) : null;
      done = true;
    } else if (op === 'unfreeze') {
      done = p.frozenUntil > now;
      p.frozenUntil = 0;
      p.frozenBuf = null;
    }
    if (!done) return false;
    this._rosterDirty = true;
    this.emit('admin', { op, id, by: by.name, name: p.name });
    return true;
  }

  /** An admin closes the game: everybody is told kindly (a: 1, "an admin closed it") and goes back to the list. */
  adminClose(by = this.me) {
    if (this.closed || !by || !by.admin) return false;
    this.emit('admin', { op: 'close', id: -1, by: by.name, name: '' });
    this.close(true);
    this.emit('removed', 'shut');
    return true;
  }

  /** Once a frame or so. `stateBuf` is the host's own snapshot, if it is time to send one. */
  tick(now = this.now(), stateBuf = null) {
    if (this.closed) return;
    // An admin's freeze lets go by itself.
    if (this.me.frozenUntil && this.me.frozenUntil <= now) {
      this.me.frozenUntil = 0;
      this._rosterDirty = true;
    }
    for (const p of this.players.values()) {
      if (p.frozenUntil && p.frozenUntil <= now) {
        p.frozenUntil = 0;
        p.frozenBuf = null;
        this._rosterDirty = true;
      }
    }
    if (stateBuf) {
      stampStateId(stateBuf, 0);
      for (const p of this.players.values()) this._queue(p, 0, stateBuf, now);
    }
    // Whatever is still held for somebody goes once it is due, even if nothing new arrives to carry it.
    for (const p of this.players.values()) if (p.out && p.out.size && now - (p.outAt ?? -Infinity) >= this.bundleMs) this._flush(p, now);
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

  /** The host is leaving. Everybody is told, then every line is closed. `byAdmin`: an admin closed it (part 3b). */
  close(byAdmin = false) {
    if (this.closed) return;
    this.closed = true;
    this._broadcast(byAdmin === true ? { t: 'close', a: 1 } : { t: 'close' });
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
  private: 'That match is private — you need its code to join.',
};

export class ClientSession {
  constructor({ net, target, profile, onEvent, now = nowMs, seat = null, relayOnly = false, admin = null }) {
    this.net = net;
    this.target = target;
    /** A second try at a join by code, through a relay only (link.js, RELAY_SERVERS). */
    this.relayOnly = !!relayOnly;
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
    /** The host's shared state as it last said it (events.js), key → value, unchecked: GameEvents checks it. */
    this.gstate = new Map();
    /** Part 3b: this device's admin key (admin.js), to answer a host's question with; null for everybody else. */
    this.admin = admin && typeof admin.sign === 'function' ? admin : null;
    /** What the host says about this player: an admin, muted or frozen by one. */
    this.self = { admin: false, muted: false, frozen: false };
  }

  /** Resolves with the welcome; rejects with an Error whose `code` says why. */
  start() {
    return new Promise((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
      const link = this.net.connect(this.target, 'join', this.relayOnly ? { relayOnly: true } : undefined);
      this.link = link;
      link.onopen = () => {
        link.send({
          t: 'hello', v: PROTO, name: this.profile.name, colour: this.profile.colour, key: this.profile.key, seat: this.seat || undefined,
          // An admin says so, and is asked to prove it (HostSession._ask).
          adm: this.admin ? 1 : undefined,
        });
      };
      link.onevent = (ev) => this._event(ev);
      link.onstate = (buf) => {
        if (!this.welcomed) return;
        // One snapshot, or the host's bundle of everybody's.
        for (const snap of decodeStates(buf)) if (snap.id !== this.id) this.emit('state', snap);
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
          // A world lobby is known by the id this player asked for, not by anything the host says (list 3).
          world: false,
          h: typeof s.h === 'string' && /^[a-z0-9]{1,16}$/.test(s.h) ? s.h : null,
          max: Number.isInteger(s.max) && s.max >= 2 && s.max <= PLAYER_IDS ? s.max : MAX_PLAYERS,
          priv: s.priv === true,
          // The game's bumping rule (protocol.js BUMP_RULES), a number.
          bump: bumpRule(s.bump),
        };
        const wn = worldOf(this.target);
        if (wn) {
          this.server.lobby = wn;
          this.server.world = true;
          this.server.slot = 0;
          this.server.code = null;
        }
        if (this.server.slot || this.server.lobby) this.server.priv = false;
        // A lobby is called what this copy calls it, whatever the host said.
        if (this.server.lobby) this.server.name = wn ? worldName(wn) : lobbyName(this.server.lobby);
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
      case 'chal':
        // The host's question for an admin: signed with this device's key, over the host's id and ours (admin.js).
        if (this.admin && !this._answered && !this.welcomed && typeof ev.n === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(ev.n)) {
          this._answered = true;
          const link = this.link;
          this.admin.sign(proofText(ev.n, this.target, this.net.sig ? this.net.sig.id : null))
            .then((sig) => link.send({ t: 'prove', s: sig }))
            .catch(() => link.send({ t: 'prove', s: '' }));
        }
        break;
      case 'kick':
        this._end('kicked', ev.a === 1 ? 'admin' : 'host');
        break;
      case 'close':
        // Closed by an admin: back to the lobby list (part 3b), not the lobby re-forming as it does when a host leaves.
        this._end(ev.a === 1 ? 'shut' : 'closed');
        break;
      case 'move':
        // The lobby's real host is somebody else; go and join them (lobby.js).
        this._end('moved');
        break;
      case 'gev': {
        // From the host's relay: who it says sent it, as this copy knows them (the host is player 0).
        if (!this.welcomed || typeof ev.k !== 'string') return;
        const f = Number(ev.f);
        const p = f === 0 ? this.players.get(0) || { id: 0, name: '', colour: '', host: true } : this.players.get(f);
        if (!p || f === this.id) return;
        this.emit('gev', { id: p.id, name: p.name, colour: p.colour, host: f === 0 }, { k: ev.k, d: ev.d });
        break;
      }
      case 'gst':
        if (!this.welcomed || typeof ev.k !== 'string' || ev.k.length > 32) return;
        // Kept here as well, so a value that lands before the game has hooked up events.js is not lost.
        if (ev.d === null) this.gstate.delete(ev.k);
        else if (this.gstate.has(ev.k) || this.gstate.size < 64) this.gstate.set(ev.k, ev.d);
        this.emit('gst', { k: ev.k, d: ev.d });
        break;
      default:
        break;
    }
  }

  /** Part 3b: an admin's request to the host. The host does it only if it checked this player's signature. */
  adminAct(op, id) {
    if (!this.welcomed || this.ended || !ADMIN_OPS.includes(op)) return false;
    return this.link.send({ t: 'adm', op, id: Number.isInteger(id) ? id : -1 });
  }

  /** A game event to the host (events.js): for everybody, or with h for the host alone. */
  sendGame(ev) {
    if (!this.welcomed || this.ended) return false;
    return this.link.send(ev.h ? { t: 'gev', k: ev.k, d: ev.d, h: 1 } : { t: 'gev', k: ev.k, d: ev.d });
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
        this.self = { admin: p.admin, muted: p.muted, frozen: p.frozen };
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
      const byCode = /^ifs-code-/.test(String(this.target));
      const byWorld = !!worldOf(this.target);
      // List 2: words a child can do something with — the friend's internet, or the code.
      const unreachable = byCode
        ? 'Couldn’t reach your friend’s game — ask them to check their internet, and check the code is right.'
        : byWorld ? 'Couldn’t reach that world lobby’s host over the internet — try again, or try another world lobby.'
          : 'Couldn’t reach the other planes over this Wi-Fi — ask the host for their join code and join with that.';
      const why = {
        gone: ['gone', byCode ? 'No game has that code right now — check the code with your friend.' : 'Nobody is hosting there any more.'],
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

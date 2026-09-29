/**
 * Lobbies: five public games on every network, always there, eight to each.
 *
 * "add multiplayer LAN, 5 lobbies to join, all public, 8 people each."
 *
 * A browser tab cannot listen on a port, so every lobby still needs one tab
 * to be its server. Nobody chooses to be it: the first player into an empty
 * lobby quietly becomes its host by claiming the lobby's fixed peer id, and
 * everybody after joins them. The signaling server hands an id to one socket
 * at a time, and that refusal is the only lock there is — so at any moment
 * at most one tab holds a lobby, and that tab is its host.
 *
 * When the host goes — Leave, a closed tab, a dropped connection — the lobby
 * re-forms by itself. Every player still in it had the host's list of who
 * joined in what order (`rank`), and they all work out the same line from it:
 * the earliest to have joined claims the lobby's id straight away, the next
 * a little later if the first has not, and so on; everybody else just asks to
 * join whoever holds it. Nobody's aeroplane stops meanwhile — the game only
 * swaps what it is connected to, and says "reconnecting…".
 *
 * Split brain. Two tabs can believe they host the same lobby only if one of
 * them lost its signaling socket and somebody else claimed the id in the
 * meantime. The one that lost its socket finds out the moment it tries to
 * take the id back — "taken" — and gives way: it tells its own players to
 * move (they join the id's holder), and joins too. The holder of the id is
 * always the host. A player whose username turns out to be taken in the lobby
 * they are moving into is refused like anybody else, and flies on alone.
 *
 * No DOM, no three.js: the node tests run eight of these against the fake
 * signaling server and count who hosts.
 */

import { LOBBY_COUNT, LOBBY_MAX, PROTO, lobbyId, lobbyName, readLobbyCount, mapNameFor, seatToken } from './protocol.js';
import { HostSession, ClientSession } from './session.js';
import { Net } from './link.js';

const nowMs = () => (globalThis.performance ? performance.now() : Date.now());
const pause = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** Each place in the line waits this long for the ones ahead of it to claim the lobby. */
export const SUCCESSION_STEP_MS = 1200;
/** A first join that has found nobody to join and could not claim either gives up after this. */
export const ENTER_GIVE_UP_MS = 20000;
/**
 * Re-forming gives up after this. It is long on purpose: a host whose Wi-Fi
 * went holds the lobby's id until the signaling server notices — 15 s on the
 * LAN server, about a minute on the public one — and until then nobody else
 * can claim it.
 */
export const REFORM_GIVE_UP_MS = 75000;
/** A tab that gave way waits this long before it would claim the lobby itself — the holder should answer first. */
const MOVE_CLAIM_MS = 4000;
/** How long a lobby's host may be silent before a player asks whether it has gone (see _join). */
export const LOBBY_GONE_QUIET_MS = 600;

/** Coded errors, for the screen to put into words. */
function coded(code, message, extra) {
  const e = new Error(message || code);
  e.code = code;
  if (extra) Object.assign(e, extra);
  return e;
}

/**
 * Who hosts next, in order: everybody in the last list except the host that
 * went, earliest to join first (ties, which a host never makes, by number).
 */
export function successionOrder(players, goneHostId = 0) {
  return [...players]
    .filter((p) => p && p.id !== goneHostId && !p.host)
    .sort((a, b) => (a.rank - b.rank) || (a.id - b.id))
    .map((p) => p.id);
}

/**
 * One player's place in one lobby: hosting it or in it, and re-forming it when
 * its host goes.
 *
 *   start()   into the lobby — resolves { role, session, welcome }, or rejects
 *             with code 'name' (and `suggest`), 'full', 'version', 'cancelled',
 *             'signaling' or 'unreachable'
 *   leave()   out, for good; a host hands the lobby on by leaving
 *   session   the HostSession or ClientSession of the moment, or null while re-forming
 *
 * Events, through onEvent(type, ...args): the session's own (join, leave,
 * chat, state, roster), and
 *   'role'          (role, session, { welcome, server }) after re-forming
 *   'reconnecting'  (why) the host went; flying on, looking for the lobby
 *   'out'           (why, error) re-forming failed — refused ('name', 'full') or gave up ('lost')
 */
export class LobbyMember {
  constructor({
    n, hash, net, makeSig, profile, place, spawnInfo, weather, onEvent, now = nowMs, netOpts = {},
    stepMs = SUCCESSION_STEP_MS, enterGiveUpMs = ENTER_GIVE_UP_MS, reformGiveUpMs = REFORM_GIVE_UP_MS, pingMs = 1500,
    seat = seatToken(), verifyEveryMs = 3000,
  }) {
    this.verifyEveryMs = verifyEveryMs;
    this._verifyTimer = null;
    this.n = n;
    this.hash = hash;
    this.id = lobbyId(hash, n);
    // The connection this player looks and joins with — or a function for it, so a dropped one can be opened again.
    this.getNet = typeof net === 'function' ? net : () => net;
    this.makeSig = makeSig;
    this.profile = profile;
    this.place = place || (() => ({ map: 'kestrel', game: 'flight' }));
    this.spawnInfo = spawnInfo || (() => null);
    this.weather = weather || (() => null);
    this.emit = onEvent || (() => {});
    this.now = now;
    this.netOpts = netOpts;
    this.stepMs = stepMs;
    this.enterGiveUpMs = enterGiveUpMs;
    this.reformGiveUpMs = reformGiveUpMs;
    this.pingMs = pingMs;
    this.seat = seat;
    this.role = null;
    this.session = null;
    this.server = null;
    this.left = false;
    this.reforming = false;
    this.sig = null;
    this.hostNet = null;
    this._pending = null;
    /** How the lobby re-formed, for the log and the playtest: [{ why, ms, role }]. */
    this.history = [];
  }

  /** Into the lobby for the first time. */
  async start() {
    const r = await this._enter({ claimAt: this.now(), deadline: this.now() + this.enterGiveUpMs });
    this._took(r);
    return r;
  }

  /** Out, for good. `closing` is a tab going away: let the lobby's id go at once, which is what tells everybody. */
  leave(closing = false) {
    if (this.left) return;
    this.left = true;
    const pending = this._pending;
    this._pending = null;
    if (pending) pending.leave();
    const s = this.session;
    this.session = null;
    this.role = null;
    if (s instanceof HostSession) {
      // Everybody is told on the data channels; letting the id go at once is what lets the next host claim it.
      s.close();
      const sig = this.sig;
      this.sig = null;
      if (sig) {
        if (closing) sig.close();
        else setTimeout(() => sig.close(), 50);
      }
    } else if (s) s.leave();
  }

  /** Once a frame: the session's own tick. Nothing while re-forming. */
  tick(now, stateBuf) {
    if (this.session && !this.left) this.session.tick(now, stateBuf);
  }

  get isHost() {
    return this.session instanceof HostSession;
  }

  /* ---------------------------------------------------------------- */

  _took(r) {
    this.role = r.role;
    this.session = r.session;
    this.server = r.role === 'host' ? r.session.server : r.welcome.server;
  }

  /**
   * Ask who holds the lobby; claim it if nobody does and it is our turn; join
   * whoever does. Round again for anything that is not an answer — a host in
   * the middle of going, a claim somebody else won, an id nobody answers on.
   */
  async _enter({ claimAt, deadline }) {
    let last = null;
    for (;;) {
      if (this.left) throw coded('cancelled', 'Stopped joining.');
      if (this.now() > deadline) throw last && (last.code === 'full' || last.code === 'signaling') ? last : coded('unreachable', 'Couldn’t reach the lobby.');
      let net = null;
      try {
        net = await this.getNet();
      } catch (err) {
        net = null;
      }
      const r = net ? await net.ping(this.id, this.pingMs) : 'offline';
      if (this.left) throw coded('cancelled', 'Stopped joining.');
      if (r === 'offline') {
        // The matchmaking server is out of reach for a moment; keep trying until the deadline.
        last = coded('signaling', 'Lost the connection to the matchmaking server.');
        await pause(1000);
        continue;
      }
      if (r === 'empty') {
        const wait = claimAt - this.now();
        if (wait > 0) {
          await pause(Math.min(wait, 300));
          continue;
        }
        const host = await this._claim();
        if (host) return { role: 'host', session: host, welcome: null };
        continue; // taken a moment ago: somebody else hosts it now
      }
      if (r === 'here') {
        try {
          const { client, welcome } = await this._join(net);
          return { role: 'client', session: client, welcome };
        } catch (err) {
          if (['name', 'full', 'version', 'cancelled', 'kicked'].includes(err && err.code)) throw err;
          // Gone, closing, busy, timed out: the lobby is changing hands. Ask again.
          last = err;
          await pause(250);
          continue;
        }
      }
      // No answer: an id held by a socket that does not reply — a host whose tab froze or whose Wi-Fi went.
      await pause(400);
    }
  }

  /** Take the lobby's id and host it; null if somebody else has it. */
  async _claim() {
    const sig = this.makeSig();
    try {
      await sig.open(this.id);
    } catch (err) {
      sig.close();
      if (err && err.code === 'taken') return null;
      throw coded('signaling', 'Couldn’t reach the matchmaking server.');
    }
    if (this.left) {
      sig.close();
      throw coded('cancelled', 'Stopped joining.');
    }
    // An empty lobby takes this player's island; one that is re-forming keeps the island it was on.
    const here = this.place();
    const map = this.server && this.server.map ? this.server.map : here.map;
    const game = here.game;
    const host = new HostSession({
      mode: 'lobby',
      max: LOBBY_MAX,
      profile: this.profile,
      server: { name: lobbyName(this.n), map, mapName: mapNameFor(map), game, code: null, slot: 0, lobby: this.n },
      spawnInfo: this.spawnInfo,
      weather: this.weather,
      now: this.now,
      onEvent: (type, ...args) => {
        if (this.session === host) this.emit(type, ...args);
      },
    });
    this.sig = sig;
    this._watch(host, sig);
    this._startVerify(host);
    return host;
  }

  /*
   * Every few seconds a host asks the signaling server, from its other
   * socket, who answers for the lobby. Itself: fine. Nobody: the server let
   * its lobby socket go without a word reaching this tab — take the id back.
   * Somebody else (their pong carries a different token): they claimed the
   * lobby while this tab was not holding it — give way. Without this, a host
   * whose socket died quietly could go on believing it hosted for as long as
   * the operating system took to notice.
   */
  _startVerify(host) {
    clearInterval(this._verifyTimer);
    this._verifyTimer = setInterval(() => this._verify(host), this.verifyEveryMs);
  }

  async _verify(host) {
    if (this.session !== host || host.closed || this.left) {
      clearInterval(this._verifyTimer);
      return;
    }
    if (this._verifying) return;
    this._verifying = true;
    try {
      let net = null;
      try {
        net = await this.getNet();
      } catch (err) {
        net = null;
      }
      if (!net) return;
      const { r, meta } = await net.pingInfo(this.id, 2000);
      if (this.session !== host || host.closed || this.left) return;
      if (r === 'here' && meta && typeof meta.h === 'string' && meta.h !== host.token) {
        this.history.push({ why: 'another host answered', at: this.now() });
        this._giveWay(host);
      } else if (r === 'empty') {
        this.history.push({ why: 'lobby id let go quietly', at: this.now() });
        const sig = this.sig;
        const token = sig ? sig.token : null;
        if (sig) {
          sig.onclose = null;
          sig.close();
        }
        this._reclaim(host, token, 0);
      }
    } finally {
      this._verifying = false;
    }
  }

  _watch(host, sig) {
    const net = new Net(sig, this.netOpts);
    this.hostNet = net;
    host.attach(net);
    net.onsigclose = (why) => {
      if (this.session !== host || host.closed || this.left || why === 'takeover') return;
      this._reclaim(host, sig.token, 0);
    };
  }

  /**
   * The host's signaling socket went. Its players are still connected tab to
   * tab, so it keeps hosting while it takes the lobby's id back — with the
   * same token, which takes it over from a socket the server has not yet
   * noticed is dead. "Taken" means somebody else claimed the lobby meanwhile:
   * give way (see the top of this file).
   */
  async _reclaim(host, token, tries) {
    if (this.session !== host || host.closed || this.left) return;
    const sig = this.makeSig(token);
    try {
      await sig.open(this.id);
    } catch (err) {
      sig.close();
      if (this.session !== host || host.closed || this.left) return;
      if (err && err.code === 'taken') {
        this._giveWay(host);
        return;
      }
      if (tries < 40) setTimeout(() => this._reclaim(host, token, tries + 1), tries < 3 ? 500 : 2000);
      return;
    }
    if (this.session !== host || host.closed || this.left) {
      sig.close();
      return;
    }
    this.sig = sig;
    this._watch(host, sig);
  }

  _giveWay(host) {
    this.history.push({ why: 'gave way', at: this.now() });
    clearInterval(this._verifyTimer);
    host.move();
    // Whatever socket this tab still has for the lobby holds nothing any more.
    const sig = this.sig;
    this.sig = null;
    if (sig) sig.close();
    this._reform('moved', [], -1, MOVE_CLAIM_MS);
  }

  /** Join whoever holds the lobby. */
  _join(net) {
    const client = new ClientSession({
      net,
      target: this.id,
      profile: this.profile,
      seat: this.seat,
      now: this.now,
      onEvent: (type, ...args) => {
        if (this.session !== client) return;
        if (type === 'ended') this._hostGone(client, args[0], args[1]);
        else this.emit(type, ...args);
      },
    });
    /*
     * A lobby player asks the signaling server whether the host is still
     * there after 0.6 s without a word from it, not 1.5. Measured in the
     * eight-tab playtest: a host's closed tab was noticed 3.2-3.5 s later,
     * all of it this wait — its goodbye did not arrive and the connection
     * did not say it had closed. Asking sooner is safe: "gone" still needs
     * the signaling server to say nobody holds the lobby, which a host that
     * is merely busy for a moment does.
     */
    client.goneQuietMs = LOBBY_GONE_QUIET_MS;
    this._pending = client;
    return client.start().then(
      (welcome) => {
        if (this._pending === client) this._pending = null;
        if (this.left) {
          client.leave();
          throw coded('cancelled', 'Stopped joining.');
        }
        return { client, welcome };
      },
      (err) => {
        if (this._pending === client) this._pending = null;
        throw err;
      },
    );
  }

  /** Our connection to the host ended. In a lobby that is not the end of the game: re-form it. */
  _hostGone(client, why, detail) {
    if (this.left) return;
    const players = [...client.players.values()];
    if (client.id != null) players.push({ id: client.id, rank: client.rank ?? 1e9, host: false });
    this._reform(why === 'moved' ? 'moved' : why, players, client.id, why === 'moved' ? MOVE_CLAIM_MS : null, detail);
  }

  /**
   * Find the lobby again. `players` is the last list we had, which says where
   * we are in the line to host it; `fixedWait` overrides that (a tab that
   * has just given way waits for the real host to answer instead).
   */
  async _reform(why, players, meId, fixedWait = null, detail = '') {
    if (this.left || this.reforming) return;
    this.reforming = true;
    const began = this.now();
    this.session = null;
    this.role = null;
    this.emit('reconnecting', why, detail);
    const order = successionOrder(players, 0);
    const place = order.indexOf(meId);
    const wait = fixedWait != null ? fixedWait : place >= 0 ? place * this.stepMs : Math.max(order.length, 1) * this.stepMs;
    try {
      const r = await this._enter({ claimAt: began + wait, deadline: began + this.reformGiveUpMs });
      this._took(r);
      this.reforming = false;
      this.history.push({ why, ms: Math.round(this.now() - began), role: r.role, place });
      this.emit('role', r.role, r.session, { welcome: r.welcome, server: this.server, ms: this.now() - began });
    } catch (err) {
      this.reforming = false;
      if (this.left) return;
      this.left = true;
      this.history.push({ why, ms: Math.round(this.now() - began), out: err && err.code });
      const code = err && ['name', 'full'].includes(err.code) ? err.code : 'lost';
      this.emit('out', code, err);
    }
  }
}

/**
 * The list of the five lobbies, kept up to date while the screen is open: a
 * ping to each lobby's id every couple of seconds. An empty lobby answers at
 * once (the signaling server's EXPIRE); a hosted one answers with its
 * head-count and its map and game, as numbers. No connection is opened to
 * anybody for this, and no name goes anywhere.
 *
 *   state   'looking' | 'empty' | 'open' | 'full' | 'old' | 'quiet'
 */
export class LobbyWatch {
  constructor({ net, hash, onChange, everyMs = 2500, pingMs = 2500 }) {
    this.net = net;
    this.hash = hash;
    this.onChange = onChange || (() => {});
    this.everyMs = everyMs;
    this.pingMs = pingMs;
    this.running = false;
    this.lobbies = [];
    for (let n = 1; n <= LOBBY_COUNT; n++) {
      this.lobbies.push({ n, id: lobbyId(hash, n), name: lobbyName(n), state: 'looking', players: 0, max: LOBBY_MAX, map: null, mapName: '', game: 'flight', timer: null, quiet: 0 });
    }
  }

  start() {
    if (this.running) return;
    this.running = true;
    for (const l of this.lobbies) this._ask(l);
  }

  stop() {
    this.running = false;
    for (const l of this.lobbies) clearTimeout(l.timer);
  }

  /** The lobby with the most room, other than `except` — for a ninth player, or somebody who wants company. */
  emptiest(except = 0) {
    const open = this.lobbies.filter((l) => l.n !== except && (l.state === 'open' || l.state === 'empty'));
    if (!open.length) return null;
    // Somebody to fly with beats an empty lobby; then the most room.
    open.sort((a, b) => (a.state === 'empty') - (b.state === 'empty') || (a.players - b.players) || (a.n - b.n));
    return open[0];
  }

  async _ask(l) {
    if (!this.running) return;
    const { r, meta } = await this.net.pingInfo(l.id, this.pingMs);
    if (!this.running) return;
    const was = `${l.state}|${l.players}|${l.map}`;
    if (r === 'empty') {
      l.state = 'empty';
      l.players = 0;
      l.map = null;
      l.mapName = '';
      l.quiet = 0;
    } else if (r === 'here') {
      const c = readLobbyCount(meta);
      l.quiet = 0;
      if (!c) l.state = 'old';
      else {
        l.players = c.players;
        l.max = c.max;
        l.map = c.map;
        l.mapName = c.mapName;
        l.game = c.game;
        l.state = c.v !== PROTO ? 'old' : c.full ? 'full' : 'open';
      }
    } else if (++l.quiet >= 2) l.state = 'quiet'; // somebody holds it and does not answer — a host going
    if (`${l.state}|${l.players}|${l.map}` !== was) this.onChange(this.lobbies, l);
    clearTimeout(l.timer);
    if (this.running) l.timer = setTimeout(() => this._ask(l), this.everyMs);
  }
}

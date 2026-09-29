/**
 * Multiplayer — "add LAN servers please in multiplayer, and only 5 server
 * slots etc"; then "add multiplayer LAN, 5 lobbies to join, all public, 8
 * people each" and "make it so you can choose your account username, and
 * people cant have the same username in lobbies".
 *
 * LOBBIES (the main menu's card): five on every network, always listed, eight
 * in each, one tap to join; nobody makes, names, locks or hides one. The first
 * player into an empty lobby hosts it without being asked, and when that
 * player goes the lobby re-forms round whoever joined next
 * (./multiplayer/lobby.js). A player chooses their username from word lists
 * (./multiplayer/lobbyui.js), and nobody may join a lobby where somebody
 * already has it. The older list of servers players make, below, is still
 * there in Dev mode; a friend on another network joins a private game by code.
 *
 * Minecraft-style: a list of the servers on your Wi-Fi, five slots of them,
 * five players in each; host one in two clicks; or join a friend somewhere
 * else with a code of two words and a number. Everybody flies (or sails, or
 * drives) their own aeroplane in their own colour with their name over it,
 * sees everybody else, and can send a handful of preset messages. No
 * free-text chat and no collisions: this is played by a class of ten-year-olds.
 *
 * How, in one paragraph: a browser cannot listen on a port, so the HOST'S TAB
 * is the server and every other player holds one WebRTC connection to it
 * (./multiplayer/link.js). They find each other through a signaling server —
 * the free public PeerJS one on port 443, or tools/lan-server.py on a network
 * with no internet (./multiplayer/signaling.js). "Same Wi-Fi" means the same
 * public address, hashed in the tab; the five server
 * slots are five peer ids derived from that hash, and the signaling server's
 * refusal to hand out an id twice is the lock on each one
 * (./multiplayer/session.js). Snapshots go fifteen times a second over an
 * unreliable channel and are drawn 100 ms in the past, between the two either
 * side (./multiplayer/interp.js), with the game's own models
 * (./multiplayer/remotes.js). What each side tells the signaling server about
 * its addresses is in ./multiplayer/link.js: nothing public for a server on
 * the same Wi-Fi, the public IPv4 for a join by code.
 *
 * EVERYTHING FAILS SOFT. No internet, a blocked socket, a network that keeps
 * devices apart: the screen says so in words a ten-year-old can act on, and
 * single-player carries on exactly as before. A host who quits, a kick and a
 * dropped connection all leave you flying on your own, not on a black screen.
 *
 * Wired in through src/game/extensions.js only. The one thing a plug-in cannot
 * do is put a button on the main menu; `openMultiplayer(sim)` is exported for
 * that, and until it is wired there is a "Multiplayer" button in Dev mode.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { applyMap, heightAt } from '../world/terrain.js';
import { refreshRunways } from '../world/airport.js';
import { refreshApronElevation } from '../world/apron.js';
import { getMap, mapsForGame } from '../world/maps.js';
import { getAircraft, performanceFor } from '../aircraft/types.js';
import * as Prog from '../game/progression.js';
import { saveSettings } from '../core/storage.js';
import { icon } from '../ui/icons.js';
import {
  PROTO, MAX_PLAYERS, STATE_HZ, QUICK_CHAT, COLOURS, GAMES, LOBBY_MAX, CODE_GAME_MAX,
  slotId, codeId, normaliseCode, shownCode, playerPeerId, randomToken, CODE_EXAMPLE, seatToken, lobbyName,
  cleanName, parseServerName, randomCallSign, randomServerName, serverNameFor, mapNameFor,
  escapeHtml, encodeState, chatIndexForKey, safeColour,
} from './multiplayer/protocol.js';
import { Signaling, PUBLIC_BACKEND, LAN_UNKNOWN, findNetHash, detectLanServer } from './multiplayer/signaling.js';
import { Net } from './multiplayer/link.js';
import { HostSession, ClientSession, Prober, claimSlot, claimCode } from './multiplayer/session.js';
import { LobbyMember, LobbyWatch } from './multiplayer/lobby.js';
import { Remotes } from './multiplayer/remotes.js';
import { injectStyle, buildScreen, buildHud } from './multiplayer/ui.js';
import { buildLobbyScreen } from './multiplayer/lobbyui.js';

/*
 * Which Multiplayer the main menu's card opens: the five public lobbies (true),
 * or the older list of servers players make (false). Both are always in Dev
 * mode. Decided from tests/features/multiplayer.lobbies.playtest.mjs — eight
 * tabs and a ninth in one Chrome over tools/lan-server.py: 19 of 19, all
 * eight seeing each other, a closed host tab re-formed in 0.54 s with every
 * aeroplane still flying, a host tab that vanished without a word in 2.5 s.
 */
export const LOBBIES_ON_MAIN_MENU = true;

const PROFILE_KEY = 'islandsim.multiplayer.v1';
const now = () => (globalThis.performance ? performance.now() : Date.now());

function loadProfile() {
  let p = null;
  try {
    p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
  } catch (e) {
    p = null;
  }
  // Lets a host keep a kicked player out for the rest of the session. Random; means nothing anywhere else.
  const key = p && typeof p.key === 'string' && /^[a-z0-9]{20}$/.test(p.key) ? p.key : randomToken();
  const named = !!(p && cleanName(p.name).ok);
  return {
    // A call sign from the lists, remembered; a name saved by an older version (typed, free text) is replaced by a new one.
    name: named ? p.name : randomCallSign(),
    // Whether the player has chosen it themselves: the lobby screen asks the first time.
    chosen: named && !!p.chosen,
    colour: safeColour(p && p.colour ? p.colour : COLOURS[Math.floor(Math.random() * COLOURS.length)]),
    key,
    server: p && parseServerName(p.server) ? p.server : serverNameFor(key),
  };
}

function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: p.name, chosen: !!p.chosen, colour: p.colour, key: p.key, server: p.server }));
  } catch (e) {
    /* private mode: remembered for this visit only */
  }
}

const say = (text) => escapeHtml(text);
const NO_DOTS = Object.freeze([]);

class Multiplayer {
  constructor() {
    this.sim = null;
    this.installed = false;
    this.profile = null;
    this.backend = PUBLIC_BACKEND;
    this.lanChecked = false;
    this.hash = null;
    this.hashVia = null;
    this._hashAt = -Infinity;
    this.lookSig = null;
    this.lookNet = null;
    this.prober = null;
    this.role = null;
    this.host = null;
    this.hostSockets = [];
    this.client = null;
    this.server = null;
    this.meId = null;
    this.ready = false;
    this.remotes = new Remotes();
    this.screen = null;
    this.hud = null;
    this.pendingSpawn = null;
    this.transition = false;
    this.busy = false;
    this._seq = 0;
    this._lastSend = -Infinity;
    this._lastTick = -Infinity;
    this._timer = null;
    this._screenHiddenAt = null;
    this._restoreGameMap = null;
    this._dots = NO_DOTS;
    /** Set by the tests to swap the network for fakes: { backend, hash, WebSocketImpl }. */
    this.override = null;
    this.log = [];
    /* Lobbies. */
    this.lobby = null;
    this.lobbyWatch = null;
    this.lobbyScreen = null;
    this._lobbyLooking = false;
    /** One per tab: a host tells this tab coming back from a new player (session.js). */
    this.seat = seatToken();
    this.reconnecting = false;
    /** Usernames whose quick chat this player has hidden, for themselves only. */
    this.muted = new Set();
  }

  /**
   * Point multiplayer at a different signaling server — a fake in the tests,
   * or any PeerJS-protocol server — and optionally say which network this is.
   * Pass null to go back to finding out for real.
   */
  configure(o) {
    this.override = o || null;
    this.backend = (o && o.backend) || PUBLIC_BACKEND;
    this.hash = (o && o.hash) || null;
    this.hashVia = o && o.hash ? 'override' : null;
    this.lanChecked = !!o;
    this._backendAsk = null;
    this._hashAsk = null;
    this._hashAt = o ? now() : -Infinity;
    this.closeLookSocket();
  }

  makeSig(token = null) {
    const opts = {};
    if (this.override && this.override.WebSocketImpl) opts.WebSocketImpl = this.override.WebSocketImpl;
    if (token) opts.token = token;
    return new Signaling(this.backend, opts);
  }

  /* ---------------------------------------------------------------- */
  /* Setting up                                                        */
  /* ---------------------------------------------------------------- */

  install(sim) {
    if (this.installed && this.sim === sim) return;
    this.sim = sim;
    this.installed = true;
    this.profile = loadProfile();
    injectStyle();
    this.hud = buildHud(this, extLayer());
    this.keepMenuCard();
    if (typeof window !== 'undefined') {
      window.__mp = this;
      // Tab held down while the window loses focus never sends its keyup; do not leave the list stuck open.
      window.addEventListener('blur', () => {
        if (this.hud) this.hud.hold(false);
        this.freeMouse(false, false);
      });
      /*
       * A host who closes the tab has quit, and should be heard to. Measured
       * before this: the players found out 3.8 s later from the dead channel,
       * and were told "Lost the connection" — true, but it reads like their
       * own Wi-Fi. The goodbye is queued on the data channel synchronously,
       * which is all a closing page allows, and it arrived in the playtest.
       */
      window.addEventListener('pagehide', () => {
        if (this.role || this.lobby) this.leave('tab closed');
      });
    }
  }

  /**
   * The main menu's Multiplayer card, kept on the main menu.
   *
   * menus.js has the card and its click (data-act="multiplayer" calls
   * hooks.openMultiplayer, delegated on the screen); but game-ui.js rewrites
   * the main menu's cards from its own list for each game — at boot and on
   * every switch between flying, the helicopter, the boat and the car — and
   * its lists do not have it. Measured in the lobby playtest: no card at all.
   * So the card is put back after each rewrite, after Free Flight (or Open
   * Water, Island Roads). The click still goes through menus.js.
   */
  keepMenuCard() {
    if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
    const main = this.sim && this.sim.menus && this.sim.menus.screens && this.sim.menus.screens.main;
    const nav = main && main.querySelector && main.querySelector('.main-nav');
    if (!nav) {
      // The menus are not built yet: look again shortly, a few times.
      this._cardTries = (this._cardTries || 0) + 1;
      if (this._cardTries < 20) setTimeout(() => this.keepMenuCard(), 500);
      return;
    }
    const ensure = () => {
      if (nav.querySelector('[data-act="multiplayer"]')) return;
      const b = document.createElement('button');
      b.className = 'card-btn';
      b.dataset.act = 'multiplayer';
      b.innerHTML = `<span class="card-icon">${icon('players', 24)}</span>`
        + '<span class="card-body"><strong>Multiplayer</strong><em>Fly with your friends — five lobbies on your Wi-Fi, eight in each, or a friend by code</em></span>';
      const after = nav.querySelector('[data-act="free"], [data-act="drive"]');
      if (after && after.nextSibling) nav.insertBefore(b, after.nextSibling);
      else nav.appendChild(b);
    };
    ensure();
    if (this._cardObserver) this._cardObserver.disconnect();
    this._cardObserver = new MutationObserver(ensure);
    this._cardObserver.observe(nav, { childList: true });
  }

  /** The screen, added to the menus' own list so show() and hide() treat it like any other. */
  ensureScreen() {
    if (this.screen) return this.screen;
    const sim = this.sim;
    this.screen = buildScreen(this);
    const menus = sim.menus;
    if (menus && menus.screens && menus.layer && typeof menus.show === 'function') {
      menus.layer.appendChild(this.screen.el);
      menus.screens.multiplayer = this.screen.el;
      this.screen.viaMenus = true;
    } else {
      // No menu system to join: our own overlay, which is ugly and works.
      const wrap = document.createElement('div');
      wrap.className = 'menu-layer';
      wrap.style.zIndex = '40';
      wrap.style.pointerEvents = 'auto';
      wrap.appendChild(this.screen.el);
      extLayer().appendChild(wrap);
      this.screen.wrap = wrap;
    }
    return this.screen;
  }

  /*
   * The ten-a-second timer runs from the moment the screen is first opened
   * until nothing is left for it to do. It used to start when the game
   * loaded, for every child, including the ones who never open
   * Multiplayer.
   */
  wake() {
    if (!this._timer && typeof setInterval === 'function') this._timer = setInterval(() => this.idle(), 100);
  }

  sleepIfIdle() {
    if (!this._timer || this.role || this.lobby || this.busy || this.prober || this._looking || this.screenOpen) return;
    if (this.lobbyWatch || this._lobbyLooking) return;
    if (this._pauseShown || this._mouseFreed || this._screenHiddenAt !== null) return;
    clearInterval(this._timer);
    this._timer = null;
  }

  open() {
    const sim = this.sim;
    this.wake();
    const ui = this.ensureScreen();
    ui.refresh();
    if (ui.viaMenus) sim.menus.show('multiplayer');
    else {
      ui.wrap.hidden = false;
      ui.el.hidden = false;
    }
    if (this.role) {
      ui.status(this.role === 'host' ? 'You are hosting a server. Close it from the player list (Tab) first.' : 'You are in a game. Leave it from the player list (Tab) first.', 'warn');
    }
    this.startLooking();
  }

  back() {
    const sim = this.sim;
    // Back while "Joining…" or "Setting up your server…" means stop: review found the join went on and dropped the kid in a moment later.
    if (this.busy) this.cancelAttempt();
    this.stopLooking();
    this.stopWatchingLobbies();
    const ui = this.lobbyScreenOpen ? this.lobbyScreen : this.screen;
    if (ui && ui.viaMenus) sim.menus.show(sim.state === 'paused' ? 'pause' : 'main');
    else if (ui) ui.wrap.hidden = true;
  }

  get screenOpen() {
    return this.legacyScreenOpen || this.lobbyScreenOpen;
  }

  get legacyScreenOpen() {
    return !!(this.screen && !this.screen.el.hidden && (!this.screen.wrap || !this.screen.wrap.hidden));
  }

  get lobbyScreenOpen() {
    return !!(this.lobbyScreen && !this.lobbyScreen.el.hidden && (!this.lobbyScreen.wrap || !this.lobbyScreen.wrap.hidden));
  }

  /* ---------------------------------------------------------------- */
  /* The lobby screen                                                  */
  /* ---------------------------------------------------------------- */

  ensureLobbyScreen() {
    if (this.lobbyScreen) return this.lobbyScreen;
    const sim = this.sim;
    this.lobbyScreen = buildLobbyScreen(this);
    const menus = sim.menus;
    if (menus && menus.screens && menus.layer && typeof menus.show === 'function') {
      menus.layer.appendChild(this.lobbyScreen.el);
      menus.screens.lobbies = this.lobbyScreen.el;
      this.lobbyScreen.viaMenus = true;
    } else {
      const wrap = document.createElement('div');
      wrap.className = 'menu-layer';
      wrap.style.zIndex = '40';
      wrap.style.pointerEvents = 'auto';
      wrap.appendChild(this.lobbyScreen.el);
      extLayer().appendChild(wrap);
      this.lobbyScreen.wrap = wrap;
    }
    return this.lobbyScreen;
  }

  /** The five lobbies, your username, and a friend somewhere else by code. */
  openLobbies() {
    const sim = this.sim;
    this.wake();
    const ui = this.ensureLobbyScreen();
    ui.refresh();
    if (ui.viaMenus) sim.menus.show('lobbies');
    else {
      ui.wrap.hidden = false;
      ui.el.hidden = false;
    }
    if (this.lobby) ui.status(`You are in Lobby ${this.lobby.n}. Leave it from the player list (Tab) first.`, 'warn');
    else if (this.role) ui.status('You are in a game. Leave it from the player list (Tab) first.', 'warn');
    this.watchLobbies();
  }

  async watchLobbies() {
    const ui = this.lobbyScreen;
    if (this.lobbyWatch || this._lobbyLooking) return;
    this._lobbyLooking = true;
    try {
      ui.net('Finding your Wi-Fi…');
      const hash = await this.ensureNetwork();
      if (typeof RTCPeerConnection !== 'function') {
        ui.net('This browser can’t do multiplayer', true);
        ui.status('This browser has no WebRTC, which multiplayer needs. Chrome, Edge, Safari and Firefox all have it.', 'bad');
        ui.lobbies(null);
        return;
      }
      if (!hash) {
        ui.net('Couldn’t tell which Wi-Fi you are on', true);
        ui.lobbies(null);
        return;
      }
      ui.net(this.hashVia === 'lan' ? `On ${this.backend.label}` : `Wi-Fi #${hash.slice(0, 4)}`, false);
      let net = null;
      for (let attempt = 0; attempt < 2 && !net; attempt++) {
        try {
          net = await this.ensureLookSocket();
        } catch (err) {
          if (!(err && err.code === 'closed' && this.lobbyScreenOpen)) break;
        }
      }
      if (!net) {
        if (this.lobbyScreenOpen) {
          ui.net('Can’t reach the matchmaking server', true);
          ui.status('Couldn’t reach the other planes — check the internet is working. You can still fly on your own.', 'bad');
        }
        return;
      }
      if (!this.lobbyScreenOpen) return;
      this.lobbyWatch = new LobbyWatch({ net, hash, onChange: (list) => this.lobbyScreen && this.lobbyScreen.lobbies(list) });
      ui.lobbies(this.lobbyWatch.lobbies);
      this.lobbyWatch.start();
    } finally {
      this._lobbyLooking = false;
    }
  }

  stopWatchingLobbies() {
    if (this.lobbyWatch) this.lobbyWatch.stop();
    this.lobbyWatch = null;
    if (this.role || this.lobby || this.busy || this.prober) return;
    this.closeLookSocket();
  }

  /** The game a player joins a lobby's island in: their own if the island allows it, else one it does. */
  gameFor(mapId, lobbyGame) {
    const allows = (g) => mapsForGame(g).some((m) => m.id === mapId);
    const mine = this.currentGame();
    if (GAMES.includes(mine) && allows(mine)) return mine;
    if (GAMES.includes(lobbyGame) && allows(lobbyGame)) return lobbyGame;
    return GAMES.find(allows) || 'flight';
  }

  /** Where this player is, for a lobby they are about to host: in the world, where they are; on the menu, the map they picked. */
  lobbyPlace() {
    const sim = this.sim;
    if (this.server && this.server.map) {
      const game = sim.mode === 'drive' && sim.vehicle ? (sim.vehicle.spec && sim.vehicle.spec.kind === 'car' ? 'car' : 'boat') : sim.game || 'flight';
      return { map: this.server.map, game: GAMES.includes(game) ? game : 'flight' };
    }
    const game = this.currentGame();
    return { map: this.defaultMap(game), game: GAMES.includes(game) ? game : 'flight' };
  }

  /** Into lobby n: host it if it is empty, join whoever hosts it if not. */
  async joinLobby(n) {
    const ui = this.lobbyScreen;
    if (this.role || this.busy || this.lobby) return ui && ui.status('You are already in a game.', 'warn');
    if (!this.profile.chosen) return ui && ui.status('Pick your username first — then you can join.', 'warn');
    this.busy = true;
    this.wake();
    ui.busy(true);
    ui.offer(null);
    ui.status(`Joining Lobby ${n}…`);
    const attempt = this.newAttempt();
    const wanted = () => this._attempt === attempt;
    let member = null;
    try {
      const hash = await this.ensureNetwork();
      if (!wanted()) return;
      if (typeof RTCPeerConnection !== 'function') return ui.status('This browser has no WebRTC, which multiplayer needs.', 'bad');
      if (!hash) return ui.status('Couldn’t tell which Wi-Fi you are on, so the lobbies can’t be found. A friend’s code still works.', 'bad');
      let net;
      try {
        net = await this.ensureLookSocket();
      } catch (err) {
        if (wanted()) ui.status('Couldn’t reach the matchmaking server — check the internet is working. You can still fly on your own.', 'bad');
        return;
      }
      if (!wanted()) return;
      member = new LobbyMember({
        n, hash, net: () => this.ensureLookSocket(), makeSig: (token) => this.makeSig(token), profile: this.profile, seat: this.seat,
        place: () => this.lobbyPlace(),
        spawnInfo: () => this.whereAmI(),
        weather: () => (this.sim.weather && this.sim.weather.serialize ? this.sim.weather.serialize() : null),
        onEvent: (type, ...args) => this.onLobbyEvent(member, type, ...args),
      });
      this.lobby = member;
      this._cancelLobby = () => member.leave();
      let r;
      try {
        r = await member.start();
      } catch (err) {
        if (this.lobby === member) this.lobby = null;
        if (!wanted() || (err && err.code === 'cancelled')) {
          ui.status('');
          return;
        }
        this.lobbyRefused(n, err);
        return;
      } finally {
        this._cancelLobby = null;
      }
      if (!wanted()) {
        member.leave();
        if (this.lobby === member) this.lobby = null;
        return;
      }
      if (this.lobbyWatch) this.lobbyWatch.stop();
      this.lobbyWatch = null;
      this.takeLobbySession(r.role, r.session, r.welcome);
      const server = member.server;
      this.server = { ...server };
      ui.status('');
      await this.enterWorld({ ...server, game: r.role === 'host' ? server.game : this.gameFor(server.map, server.game) },
        r.welcome ? r.welcome.at : null, r.welcome ? r.welcome.weather : null);
      if (this.lobby !== member) return;
      this.ready = true;
      this.showHud();
      this.note(`in lobby ${n} (${server.map}) as ${r.role === 'host' ? 'its host' : `player ${this.meId}`}`);
      this.toast(`You’re in Lobby ${n} · ${lobbyName(n)} — on ${mapNameFor(server.map)}`, 'good', 5);
    } finally {
      this.afterAttempt(attempt);
    }
  }

  /** The session a lobby has just given us — at first, or after it re-formed. */
  takeLobbySession(role, session, welcome) {
    this.role = role;
    this.host = role === 'host' ? session : null;
    this.client = role === 'client' ? session : null;
    this.meId = role === 'host' ? 0 : welcome.you;
    this.remotes.dropPlayers();
    if (welcome) for (const p of welcome.players) if (p.id !== this.meId) this.remotes.add(p.id, p);
  }

  /** Said on the lobby screen when a lobby would not have us, with the one tap that fixes it. */
  lobbyRefused(n, err) {
    const ui = this.lobbyScreen;
    const code = err && err.code;
    if (code === 'name') {
      ui.status(`Someone in Lobby ${n} is already called ${this.profile.name} — change your number or pick another name.`, 'warn');
      if (err.suggest) ui.offer({ kind: 'name', n, name: err.suggest });
      return;
    }
    if (code === 'full') {
      const other = this.lobbyWatch && this.lobbyWatch.emptiest(n);
      ui.status(`Lobby ${n} is full — eight players is the most.${other ? ` Lobby ${other.n} has room.` : ''}`, 'warn');
      if (other) ui.offer({ kind: 'lobby', n: other.n, players: other.players, max: other.max });
      return;
    }
    if (code === 'version') return ui.status('That lobby is running a different version of the game. Reload the page on both computers.', 'bad');
    if (code === 'signaling') return ui.status('Lost the connection to the matchmaking server — try again in a moment.', 'bad');
    ui.status(`Couldn’t get into Lobby ${n} — try again, or try another lobby.`, 'bad');
  }

  /** What a lobby says while we are in it. */
  onLobbyEvent(member, type, ...args) {
    if (member !== this.lobby) return;
    switch (type) {
      case 'reconnecting': {
        this.reconnecting = true;
        this.host = null;
        this.client = null;
        this.remotes.dropPlayers();
        this.note(`lobby ${member.n}: ${args[0] === 'moved' ? 'moving to the lobby’s real host' : `the host went (${args[0]}${args[1] && args[1] !== args[0] ? `, ${args[1]}` : ''})`} — re-forming`);
        this.syncRoster();
        break;
      }
      case 'role': {
        const [role, session, info] = args;
        this.reconnecting = false;
        this.takeLobbySession(role, session, info.welcome);
        const was = this.server && this.server.map;
        this.server = { ...info.server };
        this.note(`lobby ${member.n} re-formed in ${Math.round(info.ms)} ms; ${role === 'host' ? 'this tab hosts it now' : `player ${this.meId}`}`);
        // Only a merge with a lobby on another island moves anybody: re-forming in place changes nothing on screen.
        if (was && info.server.map !== was) {
          this.ready = false;
          this.enterWorld({ ...info.server, game: this.gameFor(info.server.map, info.server.game) }, info.welcome ? info.welcome.at : null, null)
            .then(() => {
              if (this.lobby === member) this.ready = true;
            });
        }
        this.syncRoster();
        break;
      }
      case 'out': {
        const [why] = args;
        const n = member.n;
        this.note(`out of lobby ${n}: ${why}`);
        this.lobby = null;
        this.cleanup();
        const words = why === 'name'
          ? `Someone in Lobby ${n} is already called ${this.profile.name} — flying on your own. Open Multiplayer to pick another name.`
          : why === 'full' ? `Lobby ${n} filled up while it re-formed — flying on your own now.`
            : 'Lost the lobby — flying on your own now.';
        this.toast(words, 'warn', 7);
        if (this.lobbyScreen) this.lobbyScreen.status(words, 'warn');
        break;
      }
      default:
        this.onSessionEvent(type, ...args);
    }
  }

  /** Hide one player's quick chat — for this player only; nobody else is told. By username, which survives the lobby re-forming. */
  toggleMute(name) {
    if (this.muted.has(name)) this.muted.delete(name);
    else this.muted.add(name);
    this.syncRoster();
    return this.muted.has(name);
  }

  /* ---------------------------------------------------------------- */
  /* The profile                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * The call sign, colour or server name. A name or server name that is not
   * built from the lists is not taken — the screen only ever offers ones that
   * are, so this is for anything else that calls it. Returns { ok, why }.
   */
  setProfile({ name, colour, server, chosen }) {
    if (colour !== undefined) this.profile.colour = safeColour(colour);
    let r = { ok: true, why: null };
    if (name !== undefined) {
      r = cleanName(name);
      if (r.ok) this.profile.name = r.name;
    }
    // The username is the player's own once they have picked it, or said "that's me" to the one they were given.
    if (chosen !== undefined && r.ok) this.profile.chosen = !!chosen;
    if (server !== undefined) {
      if (parseServerName(server)) this.profile.server = server;
      else r = { ok: false, why: 'list' };
    }
    saveProfile(this.profile);
    return r;
  }

  /** The dice. */
  rollName() {
    let name = this.profile.name;
    for (let i = 0; i < 5 && name === this.profile.name; i++) name = randomCallSign();
    return this.setProfile({ name });
  }

  rollServerName() {
    let server = this.profile.server;
    for (let i = 0; i < 5 && server === this.profile.server; i++) server = randomServerName();
    return this.setProfile({ server });
  }

  /** The game whose menu is showing, so the host form starts on it. */
  currentGame() {
    const sim = this.sim;
    return (sim.menus && sim.menus.currentGame) || sim.game || 'flight';
  }

  /*
   * A server's name is seen by everybody on the same internet connection —
   * a whole school — and review showed that anybody who can guess the
   * school's address can read the list from outside, too. It used to be
   * "<the child's name>'s server". Now it is a place and a base from the
   * lists ("Harbour Hangar"): the same one every time for this player until
   * they roll the dice, and never anything they typed.
   */
  serverName() {
    return parseServerName(this.profile.server) ? this.profile.server : serverNameFor(this.profile.key);
  }

  mapsFor(game) {
    const prog = this.sim.prog || this.sim.menus && this.sim.menus.prog;
    return mapsForGame(game)
      .filter((m) => !(prog && Prog.needsPasscode(prog, m)))
      .map((m) => ({ id: m.id, name: m.name }));
  }

  /** A map's name from this copy of the game, which knows it — never what the host said. */
  mapName(id) {
    return mapNameFor(id);
  }

  defaultMap(game) {
    const list = this.mapsFor(game);
    let want = null;
    try {
      want = typeof this.sim.mapForGame === 'function' ? this.sim.mapForGame(game) : this.sim.settings.map;
    } catch (e) {
      want = null;
    }
    return list.some((m) => m.id === want) ? want : list.length ? list[0].id : 'kestrel';
  }

  /* ---------------------------------------------------------------- */
  /* Which network, which server                                       */
  /* ---------------------------------------------------------------- */

  /** Which signaling server: this computer, if it served the page (tools/lan-server.py), else the public one. */
  /*
   * Both of these are asked by the list as the screen opens AND by Host the
   * moment it is clicked, and both used to answer the second caller with
   * whatever was known so far. Measured in the two-page playtest: Host,
   * clicked while the list's check for a LAN server was still in flight, got
   * "no LAN server" and went to Cloudflare for the network's hash; the check
   * then finished and pointed the tab at the LAN server — and the Cloudflare
   * answer, arriving after, overwrote the LAN's hash. The server took slot 1
   * under the wrong hash, on the right signaling server, where nobody's list
   * would ever look: every slot showed "Empty", and only the code worked. On
   * the public server the same race hosted with no slot at all. Each is now
   * asked once, and every caller waits for that one answer.
   */
  ensureBackend() {
    if (this.lanChecked) return this._backendAsk || Promise.resolve(this.backend);
    this.lanChecked = true;
    this._backendAsk = detectLanServer().then((lan) => {
      if (lan === LAN_UNKNOWN) {
        // No answer is not "no": ask again next time the screen opens.
        this.lanChecked = false;
        this._backendAsk = null;
      } else if (lan) {
        const moved = this.backend.id !== 'lan';
        this.backend = lan.backend;
        this.hash = lan.hash;
        this.hashVia = 'lan';
        // An earlier "don't know" left a socket open on the public server; the next one goes to the LAN.
        if (moved && !this.role && !this.lobby) {
          if (this.prober) this.prober.stop();
          this.prober = null;
          if (this.lobbyWatch) this.lobbyWatch.stop();
          this.lobbyWatch = null;
          this.closeLookSocket();
        }
      }
      return this.backend;
    });
    return this._backendAsk;
  }

  /** The network's hash, for the five slots. Joining by code does not need it. */
  async ensureNetwork() {
    await this.ensureBackend();
    if (this.hash) return this.hash;
    if (!this._hashAsk && now() - this._hashAt > 20000) {
      this._hashAt = now();
      this._hashAsk = findNetHash()
        .then((r) => {
          // A LAN server's answer, if one arrived meanwhile, is the one that counts.
          if (r && !this.hash) {
            this.hash = r.hash;
            this.hashVia = r.via;
          }
        })
        .finally(() => {
          this._hashAsk = null;
        });
    }
    if (this._hashAsk) await this._hashAsk;
    return this.hash;
  }

  /**
   * The socket used for looking and joining. One per tab, under a private random id.
   *
   * One at a time, too. Opening the screen starts the list's socket, and a
   * code typed and joined before it had opened started a second: each call
   * replaced `lookSig` under the other, the list's Net and the join's ended up
   * on whichever socket was made last, and the first was never closed. Now a
   * second caller waits for the socket already on its way.
   */
  ensureLookSocket() {
    if (this.lookSig && this.lookSig.isOpen && this.lookNet) return Promise.resolve(this.lookNet);
    if (!this._lookOpening) {
      const p = this.openLookSocket().finally(() => {
        if (this._lookOpening === p) this._lookOpening = null;
      });
      this._lookOpening = p;
    }
    return this._lookOpening;
  }

  async openLookSocket() {
    if (this.lookNet) this.lookNet.destroy();
    if (this.lookSig) this.lookSig.close();
    const sig = this.makeSig();
    this.lookSig = sig;
    this.lookNet = null;
    try {
      await sig.open(playerPeerId());
    } catch (err) {
      sig.close();
      if (this.lookSig === sig) this.lookSig = null;
      throw err;
    }
    if (this.lookSig !== sig) {
      // Closed (the screen went away) while it was opening.
      sig.close();
      throw Object.assign(new Error('closed while opening'), { code: 'closed' });
    }
    this.lookNet = new Net(sig);
    this.lookNet.onsigclose = () => {
      /*
       * In a lobby this socket is how the lobby is found again if its host
       * goes, so it is let go without closing the connection riding on it,
       * and the next look opens a fresh one (lobby.js asks for it each time).
       */
      if (this.lobby) {
        if (this.lookSig === sig) {
          this.lookSig = null;
          this.lookNet = null;
        }
        return;
      }
      // A game already joined no longer needs signaling; a list that is still looking does.
      if (this.role === 'client' || this.busy) return;
      if (this.prober) this.prober.stop();
      this.prober = null;
      this.closeLookSocket();
      if (this.screenOpen) {
        this.screen.net('Lost the matchmaking server — trying again', true);
        setTimeout(() => this.screenOpen && !this.role && this.startLooking(), 3000);
      }
    };
    return this.lookNet;
  }

  async startLooking() {
    const ui = this.screen;
    if (this.prober || this._looking) return;
    this._looking = true;
    try {
      ui.net('Finding your Wi-Fi…');
      const hash = await this.ensureNetwork();
      if (typeof RTCPeerConnection !== 'function') {
        ui.net('This browser can’t do multiplayer', true);
        ui.status('This browser has no WebRTC, which multiplayer needs. Chrome, Edge, Safari and Firefox all have it.', 'bad');
        ui.slots(null);
        return;
      }
      if (!hash) {
        ui.net('Couldn’t tell which Wi-Fi you are on', true, 'use a code instead');
        ui.slots(null);
      } else {
        ui.net(this.hashVia === 'lan' ? `On ${this.backend.label}` : `Wi-Fi #${hash.slice(0, 4)}`, false);
      }
      let net = null;
      for (let attempt = 0; attempt < 2 && !net; attempt++) {
        try {
          net = await this.ensureLookSocket();
        } catch (err) {
          // Closed under us because the screen was shut and opened again while it connected: once more.
          if (!(err && err.code === 'closed' && this.screenOpen)) break;
        }
      }
      if (!net) {
        if (this.screenOpen) {
          ui.net('Can’t reach the matchmaking server', true);
          ui.status('Couldn’t reach the other planes — check the internet is working. You can still fly on your own.', 'bad');
        }
        return;
      }
      if (!hash || !this.screenOpen) return;
      this.prober = new Prober({ net, hash, onChange: (slots) => this.screen && this.screen.slots(slots) });
      this.screen.slots(this.prober.slots);
      this.prober.start();
    } finally {
      this._looking = false;
    }
  }

  /** Stop watching the five slots, and let the socket go unless a game or a join is riding on it. */
  stopLooking() {
    if (this.prober) this.prober.stop();
    this.prober = null;
    if (this.role === 'client' || this.busy || this.lobby || this.lobbyWatch) return;
    this.closeLookSocket();
  }

  closeLookSocket() {
    if (this.lookNet) this.lookNet.destroy();
    if (this.lookSig) this.lookSig.close();
    this.lookNet = null;
    this.lookSig = null;
    // A socket still opening is dead now; the next caller starts a fresh one rather than wait on it.
    this._lookOpening = null;
  }

  /* ---------------------------------------------------------------- */
  /* Hosting                                                           */
  /* ---------------------------------------------------------------- */

  /** Abandon a join or a host that has not finished. Each checks, after every wait, that it is still wanted. */
  cancelAttempt() {
    this._attempt = null;
    if (this._cancelLobby) this._cancelLobby();
    this._cancelLobby = null;
    if (this.lobby && !this.role) this.lobby = null;
    const c = this.client;
    if (c && this.role !== 'client') {
      this.client = null;
      c.leave();
    }
  }

  /** A token for one join or host; `check()` throws once it has been cancelled. */
  newAttempt() {
    const attempt = {};
    this._attempt = attempt;
    attempt.check = () => {
      if (this._attempt !== attempt) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
    };
    return attempt;
  }

  /** After a join or a host has finished either way: the list's socket goes too if nobody is looking any more. */
  afterAttempt(attempt) {
    if (this._attempt === attempt) this._attempt = null;
    this.busy = false;
    if (this.screen) this.screen.busy(false);
    if (this.lobbyScreen) this.lobbyScreen.busy(false);
    if (!this.role && !this.screenOpen) this.stopLooking();
    if (!this.role && !this.lobby && !this.screenOpen) this.stopWatchingLobbies();
  }

  /**
   * Host a server. `privateGame` is the lobby screen's "play with a friend on
   * another Wi-Fi": no slot on the list, only a code, eight players, and one
   * username to one player, like a lobby.
   */
  async hostServer({ serverName, map, game, privateGame = false }) {
    const ui = privateGame ? this.lobbyScreen : this.screen;
    if (this.role || this.busy) return ui && ui.status('You are already in a game.', 'warn');
    const name = parseServerName(serverName) ? serverName : this.serverName();
    if (!['flight', 'heli', 'boat', 'car'].includes(game)) game = 'flight';
    const mapDef = getMap(map);
    this.busy = true;
    this.wake();
    ui.busy(true);
    ui.status('Setting up your server…');
    const sockets = [];
    const attempt = this.newAttempt();
    try {
      const hash = await this.ensureNetwork();
      attempt.check();
      if (typeof RTCPeerConnection !== 'function') throw Object.assign(new Error('no rtc'), { code: 'nortc' });
      const makeSig = () => this.makeSig();
      let slot = 0;
      if (hash && !privateGame) {
        const prefer = this.prober ? (this.prober.slots.find((s) => s.state === 'empty') || {}).n : 0;
        const claim = await claimSlot({ hash, makeSig, prefer });
        if (!claim) {
          ui.status('All five server slots on this Wi-Fi are taken. Join one of them, or try again when somebody finishes.', 'warn');
          return;
        }
        slot = claim.n;
        sockets.push({ id: slotId(hash, slot), sig: claim.sig, what: 'slot' });
        attempt.check();
      }
      const code = await claimCode({ makeSig });
      sockets.push({ id: codeId(code.code), sig: code.sig, what: 'code' });
      attempt.check();

      // The host needs its slot and code sockets, not the one it was looking with.
      if (this.prober) this.prober.stop();
      this.prober = null;
      this.closeLookSocket();
      this.stopWatchingLobbies();
      this.server = { name, map: mapDef.id, mapName: mapDef.name, game, code: code.code, slot, max: privateGame ? CODE_GAME_MAX : MAX_PLAYERS };
      this.host = new HostSession({
        mode: privateGame ? 'code' : 'slot',
        profile: this.profile,
        server: this.server,
        spawnInfo: () => this.whereAmI(),
        weather: () => (this.sim.weather && this.sim.weather.serialize ? this.sim.weather.serialize() : null),
        onEvent: (type, ...args) => this.onSessionEvent(type, ...args),
      });
      for (const s of sockets) this.watchHostSocket(s);
      this.hostSockets = sockets;
      this.role = 'host';
      this.wake();
      this.meId = 0;
      this.ready = false;
      this.remotes.clear();
      ui.status('');
      await this.enterWorld(this.server, null, null);
      this.ready = true;
      this.showHud();
      this.note(`hosting "${name}" (${game}, ${mapDef.id}) in slot ${slot || "none"}, code ${code.code}`);
      this.toast(slot ? `Your server is up — slot ${slot}, code ${code.code}` : `Your server is up — code ${code.code}`, 'good', 6);
    } catch (err) {
      for (const s of sockets) s.sig.close();
      this.role = null;
      this.host = null;
      if (err && err.code === 'cancelled') {
        this.note('stopped setting up a server');
        ui.status('');
        return;
      }
      ui.status(err && err.code === 'nortc'
        ? 'This browser has no WebRTC, which multiplayer needs.'
        : 'Couldn’t reach the matchmaking server — check the internet is working, then try again. You can still fly on your own.', 'bad');
      console.warn('[mp] hosting failed', err);
    } finally {
      this.afterAttempt(attempt);
    }
  }

  /** Keep a host's slot and code if the signaling socket blips. */
  watchHostSocket(entry) {
    const net = new Net(entry.sig);
    entry.net = net;
    this.host.attach(net);
    net.onsigclose = (why) => {
      if (!this.host || this.host.closed || why === 'takeover') return;
      setTimeout(() => this.reclaim(entry, 0), 2000);
    };
  }

  async reclaim(entry, tries) {
    if (!this.host || this.host.closed) return;
    const sig = this.makeSig(entry.sig.token);
    try {
      await sig.open(entry.id);
    } catch (err) {
      sig.close();
      if (err && err.code === 'taken') {
        this.toast(entry.what === 'slot' ? 'Your server lost its slot on the list — friends can still join with the code' : 'Your join code stopped working', 'warn', 6);
        return;
      }
      if (tries < 20) setTimeout(() => this.reclaim(entry, tries + 1), 3000);
      return;
    }
    if (!this.host || this.host.closed) {
      sig.close();
      return;
    }
    entry.sig = sig;
    this.watchHostSocket(entry);
  }

  /* ---------------------------------------------------------------- */
  /* Joining                                                           */
  /* ---------------------------------------------------------------- */

  joinSlot(n) {
    if (!this.hash) return;
    if (this.prober) this.prober.release(n);
    return this.join(slotId(this.hash, n));
  }

  joinCode(raw) {
    const code = normaliseCode(raw);
    const ui = this.lobbyScreenOpen ? this.lobbyScreen : this.screen;
    if (!code) return ui.status(`A code is two words and a number, like ${CODE_EXAMPLE} — check the spelling with the host.`, 'warn');
    return this.join(codeId(code));
  }

  async join(target) {
    const ui = this.lobbyScreenOpen ? this.lobbyScreen : this.screen;
    if (this.role || this.busy) return ui.status('You are already in a game.', 'warn');
    this.busy = true;
    this.wake();
    ui.busy(true);
    ui.status('Joining…');
    const attempt = this.newAttempt();
    const wanted = () => this._attempt === attempt;
    try {
      await this.ensureBackend();
      if (!wanted()) return;
      if (typeof RTCPeerConnection !== 'function') {
        ui.status('This browser has no WebRTC, which multiplayer needs.', 'bad');
        return;
      }
      let net;
      try {
        net = await this.ensureLookSocket();
      } catch (err) {
        if (wanted()) ui.status('Couldn’t reach the matchmaking server — check the internet is working. You can still fly on your own.', 'bad');
        return;
      }
      if (!wanted()) return;
      const client = new ClientSession({ net, target, profile: this.profile, seat: this.seat, onEvent: (type, ...args) => this.onSessionEvent(type, ...args) });
      this.client = client;
      let welcome;
      try {
        welcome = await client.start();
      } catch (err) {
        if (this.client === client) this.client = null;
        if (err && err.code === 'left') {
          this.note('stopped joining');
          ui.status('');
        } else if (err && err.code === 'name') {
          // A game joined by code keeps one username to one player too; the host says which one is free.
          ui.status(`Someone in that game is already called ${this.profile.name} — change your number or pick another name.`, 'warn');
          if (err.suggest && ui.offer) ui.offer({ kind: 'name', target, name: err.suggest });
        } else ui.status(err && err.message ? err.message : 'Couldn’t join that server.', 'bad');
        return;
      }
      if (!wanted()) {
        // Welcomed a moment after Back was pressed: say goodbye rather than arrive.
        client.leave();
        if (this.client === client) this.client = null;
        return;
      }
      if (client.ended) {
        this.client = null;
        ui.status('That server closed just as you joined.', 'warn');
        return;
      }
      if (this.prober) this.prober.stop();
      this.prober = null;
      this.role = 'client';
      this.wake();
      this.meId = welcome.you;
      this.server = welcome.server;
      this.ready = false;
      this.remotes.clear();
      for (const p of welcome.players) if (p.id !== this.meId) this.remotes.add(p.id, p);
      ui.status('');
      await this.enterWorld(welcome.server, welcome.at, welcome.weather);
      // The client may have been dropped while the world was loading.
      if (this.role !== 'client') return;
      this.ready = true;
      this.showHud();
      this.note(`joined "${welcome.server.name}" as player ${welcome.you}`);
      this.toast(`Joined ${welcome.server.name}${welcome.name !== this.profile.name ? ` as ${welcome.name}` : ''}`, 'good', 5);
    } finally {
      this.afterAttempt(attempt);
    }
  }

  /* ---------------------------------------------------------------- */
  /* Into the world                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Put this player on the server's map, in the server's game.
   *
   * The map is BORROWED the way a mission borrows one: main.js remembers the
   * map you chose in `mapBeforeMission` and puts it back when you go back to
   * the menu. The aeroplane is your own; the helicopter server flies the
   * Skyhook; the boat and car servers go through startDrive with the map set
   * for that game.
   */
  async enterWorld(server, at, weather) {
    const sim = this.sim;
    this.transition = true;
    this.pendingSpawn = { at, game: server.game };
    try {
      if (server.game === 'boat' || server.game === 'car') {
        if (sim.gameMap) {
          if (!this._restoreGameMap) this._restoreGameMap = { game: server.game, had: server.game in sim.gameMap, map: sim.gameMap[server.game] };
          sim.gameMap[server.game] = server.map;
        }
        sim.startDrive(server.game);
      } else {
        this.borrowMap(server.map);
        sim.game = server.game;
        if (sim.menus && sim.menus.setGame) sim.menus.setGame(server.game);
        let base = {};
        try {
          base = typeof sim.freeOpts === 'function' ? sim.freeOpts() : {};
        } catch (e) {
          base = {};
        }
        await sim.startMode('free', { ...base, aircraft: server.game === 'heli' ? 'harrier' : this.myAircraft(), airborne: false, taxi: false });
        this.keepOwnMapSaved();
      }
      if (weather && sim.weather && sim.weather.load) sim.weather.load(weather);
    } finally {
      this.transition = false;
      this.pendingSpawn = null;
    }
  }

  borrowMap(id) {
    const sim = this.sim;
    if (!id || sim.settings.map === id) return;
    // A cleaner door, if main.js ever grows one.
    if (typeof sim.borrowMap === 'function') {
      sim.borrowMap(id);
      return;
    }
    if (!sim.mapBeforeMission) sim.mapBeforeMission = sim.settings.map;
    applyMap(id);
    sim.layRoads();
    refreshRunways();
    refreshApronElevation();
    sim.settings.map = id;
    if (sim.menus && sim.menus.syncMap) sim.menus.syncMap(id);
    sim.buildWorld(sim.settings.quality);
  }

  /**
   * Free Flight saves the settings as it starts (for the weather), and by then
   * the map in them is the host's. Quitting to the menu puts yours back and
   * saves again — but a tab closed mid-game never quits, and the next visit
   * opened on the host's island. Save your own map over it at once.
   */
  keepOwnMapSaved() {
    const sim = this.sim;
    const own = sim.mapBeforeMission;
    if (!own || !sim.settings || sim.settings.map === own) return;
    try {
      saveSettings({ ...sim.settings, map: own });
    } catch (e) {
      /* storage is not ours to fix */
    }
  }

  myAircraft() {
    const sim = this.sim;
    const prog = sim.prog || (sim.menus && sim.menus.prog);
    let id = (sim.menus && sim.menus.chosenAircraft) || 'skylark';
    if (id === 'harrier') id = 'skylark';
    const t = getAircraft(id);
    if (!t || t.id !== id) return 'skylark';
    if (prog && (Prog.needsPasscode(prog, t) || (Array.isArray(prog.unlocked) && !Prog.isUnlocked(prog, id)))) return 'skylark';
    return id;
  }

  /** Where this player is, for somebody joining them. */
  whereAmI() {
    const sim = this.sim;
    if (sim.mode === 'drive' && sim.vehicle) {
      const v = sim.vehicle;
      return { x: v.pos.x, y: v.pos.y, z: v.pos.z, heading: v.heading, speed: Math.abs(v.speed || 0), agl: 0, onGround: true };
    }
    const ac = sim.aircraft;
    if (!ac) return null;
    const r = ac.readouts();
    return { x: ac.pos.x, y: ac.pos.y, z: ac.pos.z, heading: r.heading, speed: ac.airspeed || ac.groundSpeed || 0, agl: ac.agl || 0, onGround: !!ac.onGround };
  }

  /**
   * Drop a joiner beside the host: in the air, behind and off to one side at
   * the host's height, going fast enough to fly; on the water, alongside; on
   * the road, behind.
   *
   * A host who is still on the ground is on the runway, which is where the
   * normal start puts a joiner too — EXACTLY where, measured in the two-tab
   * playtest: host and joiner both at (-470, 16, 0), 0 m apart, two aeroplanes
   * drawn inside each other and the joiner's chase camera looking out through
   * the host's tail. So on the ground the joiners line up for a formation
   * take-off instead: alternately ten metres either side of the centreline,
   * the first pair abreast of the start and each pair after 22 metres behind
   * the one before — seven joiners in a lobby of eight make four pairs, the
   * last 66 metres back and still 14 inside the threshold, because the start
   * is always eighty in.
   */
  applySpawn(sim, mode, pending) {
    const at = pending && pending.at;
    if (!at) return;
    const idx = Math.max(1, this.meId || 1);
    const side = idx % 2 ? 1 : -1;
    const rank = Math.ceil(idx / 2);
    const h = (at.heading * Math.PI) / 180;
    const fx = Math.sin(h);
    const fz = -Math.cos(h);
    const rx = Math.cos(h);
    const rz = Math.sin(h);
    if (mode === 'drive' && sim.vehicle) {
      const v = sim.vehicle;
      if (pending.game === 'boat') {
        for (const s of [side, -side]) {
          const x = at.x + rx * 16 * rank * s;
          const z = at.z + rz * 16 * rank * s;
          if (heightAt(x, z) < -1.5) {
            v.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: at.heading });
            return;
          }
        }
        return;
      }
      const x = at.x - fx * 9 * idx;
      const z = at.z - fz * 9 * idx;
      const onRoad = typeof sim.onRoad === 'function' ? sim.onRoad(x, z, 1) : true;
      if (onRoad) v.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: at.heading });
      return;
    }
    if (mode !== 'free' || !sim.aircraft) return;
    if (at.onGround || at.agl < 25) {
      // Lined up off the start the game just gave us, along its runway, not the host's heading.
      const ac = sim.aircraft;
      const start = ac.pos.clone();
      let hdg = at.heading;
      try {
        hdg = ac.readouts().heading;
      } catch (e) {
        /* the host's heading will do */
      }
      const g = (hdg * Math.PI) / 180;
      const x = start.x + Math.cos(g) * 10 * side - Math.sin(g) * 22 * (rank - 1);
      const z = start.z + Math.sin(g) * 10 * side + Math.cos(g) * 22 * (rank - 1);
      ac.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: hdg, speed: 0, altAGL: null, engineOn: true });
      this.snapCamera(sim);
      return;
    }
    const x = at.x - fx * 140 + rx * 40 * rank * side;
    const z = at.z - fz * 140 + rz * 40 * rank * side;
    const ground = heightAt(x, z);
    const y = Math.max(at.y, Math.max(0, ground) + 120);
    const heli = pending.game === 'heli';
    let speed;
    if (heli) speed = Math.min(Math.max(at.speed, 0), 45);
    else {
      let stall = 30;
      let vne = 250;
      try {
        const perf = performanceFor(sim.aircraftType ? sim.aircraftType.id : 'skylark');
        stall = perf.stallClean / 1.94384;
        vne = perf.vne / 1.94384;
      } catch (e) {
        /* the defaults are a trainer's */
      }
      speed = Math.min(Math.max(at.speed, stall * 1.45), vne * 0.75);
    }
    sim.aircraft.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: at.heading, speed, altAGL: y - ground, engineOn: true, gearDown: false });
    sim.aircraft.controls.throttle = 0.7;
    if (sim.input) {
      sim.input.throttleTarget = 0.7;
      if (sim.input.out) sim.input.out.throttle = 0.7;
    }
    this.snapCamera(sim);
  }

  /**
   * The chase camera is a spring, set up where the start put the aeroplane —
   * on the runway, which for a joiner dropped beside a host in the air can be
   * kilometres away: the view would come swooping across the island to catch
   * up. The rig starts afresh from where the aeroplane is now.
   */
  snapCamera(sim) {
    const rig = sim.rig;
    if (!rig || typeof rig !== 'object') return;
    rig.initialised = false;
    if (rig.chaseVel && rig.chaseVel.set) rig.chaseVel.set(0, 0, 0);
    // What it looks at eases after the aeroplane too: measured 2 km away, the
    // camera was in place behind it but still facing the runway, 65 degrees off.
    if (rig.lookAt && rig.lookAt.copy && sim.aircraft) rig.lookAt.copy(sim.aircraft.pos);
  }

  /* ---------------------------------------------------------------- */
  /* In the game                                                       */
  /* ---------------------------------------------------------------- */

  get session() {
    return this.role === 'host' ? this.host : this.role === 'client' ? this.client : null;
  }

  /**
   * The last fifty things that happened, with why. A toast is gone in four
   * seconds; "why did Sam drop out" needs an answer after that, from the
   * console (`__mp.log`) if nowhere else.
   */
  note(what) {
    this.log.push(`${new Date().toISOString().slice(11, 19)} ${what}`);
    if (this.log.length > 50) this.log.shift();
    console.info(`[multiplayer] ${what}`);
  }

  onSessionEvent(type, a, b, detail) {
    const t = now();
    switch (type) {
      case 'state':
        if (a.id !== this.meId) this.remotes.push(a, t);
        break;
      case 'join':
        this.remotes.add(a.id, a);
        this.note(`${a.name} joined as player ${a.id}`);
        this.toast(`${a.name} joined`, 'good');
        this.syncRoster();
        break;
      case 'leave': {
        this.remotes.remove(a.id);
        this.note(`${a.name} left: ${b}${detail && detail !== b ? ` (${detail})` : ''}`);
        // Only the host is told somebody was removed; everybody else sees them leave, and nobody is made an example of.
        const words = { kicked: this.role === 'host' ? `${a.name} was removed` : `${a.name} left`, dropped: `${a.name} lost connection` }[b] || `${a.name} left`;
        this.toast(words, 'info');
        this.syncRoster();
        break;
      }
      case 'chat':
        // Muted: not over their aeroplane and not in a toast — for this player only.
        if (this.muted.has(a.name)) break;
        this.remotes.say(a.id, b, t);
        this.toast(`${a.name}: ${QUICK_CHAT[b].text}`, 'info', 4);
        break;
      case 'roster':
        if (this.role === 'client') for (const p of a) this.remotes.add(p.id, p);
        this.syncRoster();
        break;
      case 'ended':
        this.ended(a, b);
        break;
      default:
        break;
    }
  }

  /**
   * Holding Tab frees the mouse. With mouse flying on, the pointer is locked
   * to the game and hidden: review found the list's Kick, Leave and Lock, and
   * the Chat button, could not be clicked at all, so a host flying with the
   * mouse could not remove anybody. While Tab is down the lock is let go and
   * mouse steering paused (moving to a button would otherwise bank the
   * aeroplane); letting go of Tab puts both back.
   */
  freeMouse(on, relock = true) {
    const sim = this.sim;
    const input = sim && sim.input;
    if (on) {
      if (this._mouseFreed || typeof document === 'undefined' || !document.pointerLockElement) return;
      this._mouseFreed = { el: document.pointerLockElement, enabled: !!(input && input.mouseEnabled) };
      if (input) {
        input.mouseEnabled = false;
        if (input.mouse) input.mouse.x = input.mouse.y = 0;
      }
      try {
        document.exitPointerLock();
      } catch (e) {
        /* already free */
      }
      return;
    }
    const f = this._mouseFreed;
    this._mouseFreed = null;
    if (!f) return;
    if (input) input.mouseEnabled = f.enabled;
    if (!relock || !f.enabled || !f.el || typeof f.el.requestPointerLock !== 'function' || !sim || sim.state !== 'flying') return;
    try {
      // Allowed: the Tab press (or the click on Kick) a moment ago is the gesture a lock needs.
      const r = f.el.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) {
      /* the game still flies by mouse without the lock, as it does after Esc */
    }
  }

  /** The client's session is over: the host closed it, kicked us, or the line dropped. */
  ended(why, detail) {
    if (this.role !== 'client') return;
    this.note(`game ended: ${why}${detail && detail !== why ? ` (${detail})` : ''}`);
    const words = {
      closed: 'The host closed the server',
      kicked: 'The host took you out of this game — you can keep flying on your own, or join another server',
      dropped: 'Lost the connection to the server — flying on your own now',
    }[why] || 'The multiplayer game ended';
    this.cleanup();
    this.toast(words, why === 'closed' ? 'info' : 'warn', 6);
    if (this.screenOpen) this.screen.status(words, 'warn');
  }

  leave(why = 'left') {
    if (this.lobby) {
      const m = this.lobby;
      this.lobby = null;
      this.note(`left lobby ${m.n} (${why})`);
      // A host hands the lobby on by leaving it: the next in line claims it (lobby.js).
      m.leave(why === 'tab closed');
      if (why !== 'menu' && why !== 'tab closed') this.toast(`You left Lobby ${m.n}`, 'info');
      this.cleanup();
      return;
    }
    if (!this.role) return;
    this.note(`left the game (${why})`);
    // A closing page gets no four hundred milliseconds: let the slot and code go now, which is also what tells the players.
    const closing = why === 'tab closed';
    if (this.role === 'host' && this.host) {
      this.host.close();
      const sockets = this.hostSockets;
      const drop = () => {
        for (const s of sockets) s.sig.close();
      };
      if (closing) drop();
      else setTimeout(drop, 400);
      this.toast('Server closed', 'info');
    } else if (this.client) {
      this.client.leave();
      // The socket only, not its links: the "bye" just queued on the channel still has to go.
      if (closing && this.lookSig) this.lookSig.close();
      else if (why !== 'menu') this.toast(`You left ${this.server ? this.server.name : 'the server'}`, 'info');
    }
    this.cleanup();
  }

  cleanup() {
    this.role = null;
    this.host = null;
    this.lobby = null;
    this.reconnecting = false;
    this.hostSockets = [];
    this.client = null;
    this.ready = false;
    this.meId = null;
    this.server = null;
    this.remotes.clear();
    this.showHud(false);
    const r = this._restoreGameMap;
    this._restoreGameMap = null;
    if (r && this.sim && this.sim.gameMap) {
      if (r.had) this.sim.gameMap[r.game] = r.map;
      else delete this.sim.gameMap[r.game];
    }
    if (!this.screenOpen) this.stopLooking();
  }

  kick(id) {
    if (this.role !== 'host' || !this.host) return;
    this.host.kick(id);
  }

  chat(m) {
    const s = this.session;
    if (!s || !QUICK_CHAT[m]) return;
    const sent = s.chat(m);
    if (sent) this.toast(`You: ${QUICK_CHAT[m].text}`, 'info', 2.5);
  }

  roster() {
    if (this.lobby && !this.lobby.session) {
      // Re-forming: only ourselves, until the lobby is back.
      return [{ id: this.meId ?? 0, name: this.profile.name, colour: this.profile.colour, host: false, ping: null }];
    }
    if (this.role === 'host' && this.host) return this.host.roster();
    if (this.role === 'client' && this.client) {
      const me = { id: this.meId, name: this.client.name || this.profile.name, colour: this.profile.colour, host: false, ping: this.client.ping == null ? null : Math.round(this.client.ping) };
      return [me, ...this.client.players.values()].sort((a, b) => a.id - b.id);
    }
    return [];
  }

  syncRoster() {
    if (!this.hud || !this.role) return;
    const list = this.roster();
    const lobby = this.lobby ? this.lobby.n : 0;
    const locked = !!(!lobby && this.role === 'host' && this.host && this.host.locked);
    // The join code is on everybody's screen for the whole game: shown only if it is exactly one the game could make.
    const shown = lobby ? null : shownCode(this.server && this.server.code);
    const max = lobby ? LOBBY_MAX : (this.server && this.server.max) || MAX_PLAYERS;
    const title = lobby ? `Lobby ${lobby} · ${lobbyName(lobby)}` : this.server ? this.server.name : '';
    /*
     * In a lobby nobody is the host on purpose, so nobody gets Kick or Lock
     * and nobody is labelled host; what everybody gets is Mute, which hides
     * one player's quick chat for themselves.
     */
    const opts = {
      meId: this.meId, isHost: !lobby && this.role === 'host', lobby: !!lobby, muted: this.muted, max, reconnecting: this.reconnecting,
      code: shown, server: title, locked,
    };
    this.hud.roster(list, opts);
    if (this.sim && this.sim.state === 'paused') this.hud.pauseList(this.sim, true, list, opts);
    const code = shown ? ` · code <b>${say(shown)}</b>` : '';
    const again = this.reconnecting ? ' · <em class="mp-again">reconnecting…</em>' : '';
    this.hud.badge(`<b>${say(title)}</b> · ${list.length}/${max}${locked ? ' · locked' : ''}${code}${again}`);
  }

  /** The host stops (or starts again) letting new players in. */
  lock(on) {
    if (this.role !== 'host' || !this.host) return;
    const now = this.host.setLocked(on);
    this.note(now ? 'locked the server' : 'unlocked the server');
    this.toast(now ? 'Server locked — nobody new can join' : 'Server unlocked — friends can join again', 'info', 4);
    this.syncRoster();
  }

  showHud(on = true) {
    if (!this.hud) return;
    this.hud.show(on);
    if (on) this.syncRoster();
  }

  toast(text, kind = 'info', secs = 3.2) {
    const hud = this.sim && this.sim.hud;
    if (hud && hud.notify) hud.notify(say(text), kind, secs);
  }

  /** This player's snapshot, encoded. */
  myState(t) {
    const sim = this.sim;
    this._seq = (this._seq + 1) & 0xffff;
    if (sim.mode === 'drive' && sim.vehicle) {
      const v = sim.vehicle;
      const kind = v.spec && v.spec.kind === 'car' ? 'car' : 'boat';
      return encodeState({
        id: this.meId, seq: this._seq, t, pos: v.pos, quat: v.quat, vel: v.vel, game: kind, type: kind,
        throttle: Math.abs(v.throttle || 0), steer: v.steer || 0, brakes: (v.brakes || 0) > 0.05,
        onGround: true, engineOn: true, lights: true, gearDown: true, gearPos: 1,
      });
    }
    const ac = sim.aircraft;
    const c = ac.controls || {};
    const type = sim.aircraftType ? sim.aircraftType.id : 'skylark';
    return encodeState({
      id: this.meId, seq: this._seq, t, pos: ac.pos, quat: ac.quat, vel: ac.vel,
      game: type === 'harrier' ? 'heli' : 'flight', type,
      gearDown: ac.gearDown, gearPos: ac.gearPos, flaps: ac.flaps, throttle: c.throttle, rpm: ac.rpm,
      pitch: c.pitch, roll: c.roll, yaw: c.yaw, brakes: (c.brakes || 0) > 0.1,
      onGround: ac.onGround, engineOn: ac.engineOn, crashed: ac.crashed, lights: ac.engineOn || ac.rpm > 0.05,
    });
  }

  /** Every frame the game is running. */
  frame(dt) {
    const t = now();
    const s = this.session;
    if (s) {
      let buf = null;
      if (this.ready && !this.transition && t - this._lastSend >= 1000 / STATE_HZ - 4) {
        this._lastSend = t;
        buf = this.myState(t);
      }
      s.tick(t, buf);
      this._lastTick = t;
    }
    this._dots = this.remotes.players.size ? this.remotes.update(dt, t, this.sim, !(this.sim.hud && this.sim.hud.hidden)) : NO_DOTS;
    if (this.hud) {
      this.hud.el.style.visibility = this.sim.hud && this.sim.hud.hidden ? 'hidden' : '';
      this.hud.place();
      this.hud.minimap(this.sim, this._dots);
    }
  }

  /** Ten times a second whatever the game is doing — paused, in a menu, in a background tab. */
  idle() {
    const sim = this.sim;
    if (!sim) return;
    const t = now();
    const s = this.session;
    // The game's frame hook stops while paused; the server must not.
    if (s && t - this._lastTick > 150) {
      let buf = null;
      if (this.ready && !this.transition && sim.state === 'paused' && t - this._lastSend > 250) {
        this._lastSend = t;
        buf = this.myState(t);
      }
      s.tick(t, buf);
      this._lastTick = t;
    }
    if (this.hud && this.role) {
      const flying = sim.state === 'flying';
      if (this.hud.el.hidden === flying) this.hud.show(flying);
      // Paused, the list is in the pause menu instead, where the mouse is free to reach Kick.
      const paused = sim.state === 'paused';
      if (paused !== !!this._pauseShown) {
        this._pauseShown = paused;
        if (paused) this.syncRoster();
        else this.hud.pauseList(sim, false);
      }
    } else if (this._pauseShown && this.hud) {
      this._pauseShown = false;
      this.hud.pauseList(sim, false);
    }
    // Tab was down when the game paused (Esc) and its release never reached us: mouse steering back on, no re-lock.
    if (this._mouseFreed && sim.state !== 'flying') {
      this.hud && this.hud.hold(false);
      this.freeMouse(false, false);
    }
    // The list stops looking a little after its screen is closed.
    if (this.prober && !this.screenOpen) {
      if (this._screenHiddenAt === null) this._screenHiddenAt = t;
      else if (t - this._screenHiddenAt > 1500) {
        this._screenHiddenAt = null;
        this.stopLooking();
      }
    } else this._screenHiddenAt = null;
    // And the lobby list the same way.
    if (this.lobbyWatch && !this.lobbyScreenOpen) {
      if (this._lobbyHiddenAt == null) this._lobbyHiddenAt = t;
      else if (t - this._lobbyHiddenAt > 1500) {
        this._lobbyHiddenAt = null;
        this.stopWatchingLobbies();
      }
    } else this._lobbyHiddenAt = null;
    if (this.role && this.hud && (!this.hud.el.hidden || this._pauseShown) && this._rosterT !== Math.floor(t / 1000)) {
      this._rosterT = Math.floor(t / 1000);
      this.syncRoster();
    }
    this.sleepIfIdle();
  }
}

export const multiplayer = new Multiplayer();

/** The door for the main menu's Multiplayer button: the lobbies, or the older server list (LOBBIES_ON_MAIN_MENU). */
export function openMultiplayer(sim) {
  multiplayer.install(sim);
  if (LOBBIES_ON_MAIN_MENU) multiplayer.openLobbies();
  else multiplayer.open();
  return multiplayer;
}

/** The lobby screen whichever the main menu opens — for Dev mode and the tests. */
export function openLobbies(sim) {
  multiplayer.install(sim);
  multiplayer.openLobbies();
  return multiplayer;
}

/** The older list of servers players make, whichever the main menu opens. */
export function openServerList(sim) {
  multiplayer.install(sim);
  multiplayer.open();
  return multiplayer;
}

registerExtension({
  id: 'multiplayer',
  install(sim) {
    multiplayer.install(sim);
  },
  buildWorld(sim, group) {
    multiplayer.remotes.setGroup(group);
  },
  startMode(sim, mode) {
    const p = multiplayer.pendingSpawn;
    if (p) {
      multiplayer.pendingSpawn = null;
      multiplayer.applySpawn(sim, mode, p);
    }
  },
  stop(sim, why) {
    // Going back to the menu is leaving the game. Going back to the runway is not.
    if (multiplayer.transition || !multiplayer.role) return;
    if (why === 'menu') multiplayer.leave('menu');
  },
  update(sim, dt) {
    if (!multiplayer.installed) return;
    multiplayer.frame(dt);
  },
  key(sim, code, down, e) {
    // Tab let go after the game was left with it held down (Leave, in the list): the mouse still has to come back.
    if (code === 'Tab' && !down && multiplayer._mouseFreed && !multiplayer.role) {
      multiplayer.freeMouse(false);
      return true;
    }
    if (!multiplayer.role) return false;
    if (code === 'Tab') {
      multiplayer.hud.hold(down);
      multiplayer.freeMouse(down);
      return true;
    }
    const i = chatIndexForKey(code);
    if (i >= 0) {
      if (down && !(e && e.repeat)) multiplayer.chat(i);
      return true;
    }
    return false;
  },
  devActions: [
    {
      label: 'Multiplayer lobbies',
      hint: 'Five public lobbies, eight each, and choosing your username',
      run: (sim) => openLobbies(sim),
    },
    {
      label: 'Multiplayer servers',
      hint: 'The older LAN list: host a server, five each, and joining by code',
      run: (sim) => openServerList(sim),
    },
  ],
});

export { PROTO };

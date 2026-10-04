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
 * free-text chat: this is played by a class of ten-year-olds. (Bumping into
 * each other came with list 2, part 2 — gentle unless both have PvP on, and a
 * rule on every lobby card: ./bump.js.)
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
 *
 * LIST 2 ("less lag", "able to create private matches", "the same planes"):
 *
 *   - friends are drawn where they are NOW, not 100-350 ms ago (interp.js,
 *     predict), the host bundles what it relays (session.js, BUNDLE_MS) and
 *     every game sends a steady 15 Hz; measured in tests/features/multiplayer.lag.mjs;
 *   - a PRIVATE MATCH beside the five lobbies: a code of two words and a
 *     number, only friends with it can join, eight at most, one username to
 *     one player — on no list anywhere (HostSession mode 'code');
 *   - YOUR RIDE, on the lobby screen of every game: any aeroplane you have,
 *     the helicopter, the boat or the car. A lobby can hold all four at once
 *     and everybody sees everybody's real vehicle (remotes.js). An island
 *     without water or roads puts you in the nearest thing it does have.
 *
 * PART 3b, CROWN AND ADMIN ("the owner of each lobby has a crown on their
 * head"; "if i put in the code in the hangar it gives me admin in every
 * server"):
 *
 *   - whoever hosts a game right now — a lobby's owner, a private match's
 *     maker — wears a small gold crown over their name tag and in the player
 *     list (remotes.js, ui.js); it moves when the lobby re-forms round a new
 *     host;
 *   - the admin code, typed in the hangar's code box, makes this device an
 *     admin (./multiplayer/admin.js, whose header says why the code is in no
 *     file of the game). An admin proves it to every host by signing the
 *     host's fresh question; the host checks, and then does what the admin
 *     asks — kick, mute, freeze, close — and lets them into locked games and,
 *     from the admin's list of private matches, into private matches without
 *     their code. Admins wear an ADMIN badge on their tag and in the list.
 *
 * LIST 2, PART 2 — built on the events channel below, each its own plug-in:
 *   ./pvp.js      PvP, a per-player switch (OFF until turned on); Space or FIRE;
 *                 five hearts, a cartoon tag, back in three seconds in a shield;
 *                 the host judges every hit (./pvp/rules.js)
 *   ./bump.js     bumping into each other under the game's rule (protocol.js
 *                 BUMP_RULES, on every lobby card), safe on the ground and at spawn
 *   ./race.js     the Ring Rally on Coral Atoll: grid, countdown, rings, results
 *   ./mpworld.js  the host's weather and AI aeroplanes, disasters anybody
 *                 summons (the wildfire too), crash marks on everybody's minimap
 *   Every snapshot now carries two more bits: ghost (nobody may bump into or hit
 *   this player now) and pvp (this.extraFlags, set by those features).
 *
 * FOR OTHER FEATURES — `multiplayer.events` (./multiplayer/events.js, whose
 * header is the full reference): typed game events and host-owned shared
 * state, checked and relayed by the host, for PvP, racing and world sync.
 *
 *   import { multiplayer } from './multiplayer.js';
 *   const ch = multiplayer.events;
 *   ch.define('race:gate', { validate, from: 'anyone' | 'host', rate });
 *   ch.on('race:gate', (data, from, meta) => {});    ch.onState('race', (value) => {});
 *   ch.send(kind, data, { self })   ch.toHost(kind, data)   ch.sendTo(id, kind, data)   (host)
 *   ch.setState(key, value) (host)   ch.getState(key)   ch.players()   ch.active / isHost / me
 *   local: 'mp:start', 'mp:end', 'mp:join', 'mp:leave', 'mp:host'
 *
 * LIST 3 ("different lobbies have different maps", "go BEYOND lan", "palo
 * alto to berkeley"):
 *
 *   - every lobby is on its own island, always (protocol.js LOBBY_MAPS),
 *     shown on its card before anybody is in it; joining takes you there;
 *   - WORLD LOBBIES, a second row: five more that are the same for
 *     everybody on the internet (lobby.js, world), found through the public
 *     matchmaking server (worldBackend) and connected the way a join by code
 *     is (link.js, 'v4') — with the same eight, the same username lists, the
 *     same quick chat and the same next-in-line hosting as a Wi-Fi lobby.
 *     The public server is shared by everybody and turns away an address
 *     that asks too much, so the world list asks it gently (lobby.js), a
 *     page served by the LAN server opens a second socket only while the
 *     lobby screen is up or a world lobby needs it, and a server out of
 *     reach is asked again later and later, not in a storm. A LAN server
 *     started with --local or --world stands in for it (tests, no internet).
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey } from '../flight/input.js';
import { applyMap, heightAt } from '../world/terrain.js';
import { refreshRunways } from '../world/airport.js';
import { refreshApronElevation } from '../world/apron.js';
import { getMap, mapsForGame } from '../world/maps.js';
import { AIRCRAFT, getAircraft, performanceFor } from '../aircraft/types.js';
import { VEHICLES } from '../vehicles/surface.js';
import * as Prog from '../game/progression.js';
import { saveSettings } from '../core/storage.js';
import { icon } from '../ui/icons.js';
import {
  PROTO, MAX_PLAYERS, STATE_HZ, QUICK_CHAT, COLOURS, GAMES, LOBBY_MAX, CODE_GAME_MAX, BUMP_DEFAULT, BUMP_RULES, BUMP_SHORT, bumpRule,
  slotId, codeId, normaliseCode, shownCode, playerPeerId, randomToken, CODE_EXAMPLE, seatToken, lobbyName, worldName, lobbyLabel, readPrivateCount, pdirId, pdirOf, readPlayer,
  cleanName, parseServerName, randomCallSign, randomServerName, serverNameFor, mapNameFor,
  escapeHtml, encodeState, safeColour,
} from './multiplayer/protocol.js';
import { Signaling, PUBLIC_BACKEND, LAN_UNKNOWN, findNetHash, detectLanServer } from './multiplayer/signaling.js';
import { Net, RELAY_SERVERS } from './multiplayer/link.js';
import { HostSession, ClientSession, Prober, claimSlot, claimCode, claimPdir, FREEZE_MS } from './multiplayer/session.js';
import { LobbyMember, LobbyWatch, PrivateWatch } from './multiplayer/lobby.js';
import { AdminKey, adminCrypto } from './multiplayer/admin.js';
import { Remotes } from './multiplayer/remotes.js';
import { GameEvents } from './multiplayer/events.js';
import { injectStyle, buildScreen, buildHud, CROWN_SVG } from './multiplayer/ui.js';
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
/** How long the lobby screen's sockets stay open after it is shut, in case it is opened again (lingerSockets). */
export const SOCKET_LINGER_MS = 10000;
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
    // What they bring into a game (rides()): checked against what they can fly when it is used, not here.
    ride: p && p.ride && GAMES.includes(p.ride.game) && typeof p.ride.type === 'string' && /^[a-z0-9_-]{1,24}$/.test(p.ride.type) ? { game: p.ride.game, type: p.ride.type } : null,
    // List 2, part 2: PvP, the player's own switch — OFF until they turn it on (../pvp.js).
    pvp: !!(p && p.pvp === true),
  };
}

function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify({ name: p.name, chosen: !!p.chosen, colour: p.colour, key: p.key, server: p.server, ride: p.ride || null, pvp: !!p.pvp }));
  } catch (e) {
    /* private mode: remembered for this visit only */
  }
}

const say = (text) => escapeHtml(text);
const NO_DOTS = Object.freeze([]);
/**
 * The gate an admin's freeze puts on an aeroplane's (or vehicle's) own step
 * (see holdStill): installed once per object, the first time it is frozen,
 * and left in place — while `_mpHeld` is set the step does nothing, after
 * that it is the step it was. Other features wrap the same step (stovl.js
 * wraps every aeroplane's), before or after: a gate in the chain works
 * either way, and nothing ever has to be unwrapped.
 */
function gateStep(v) {
  if (v._mpGate) return;
  const inner = v.update;
  Object.defineProperty(v, '_mpGate', { value: true, enumerable: false });
  v.update = function mpFreezeGate(...args) {
    if (v._mpHeld) return undefined;
    return inner.apply(this, args);
  };
}

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
    this._nextSend = -Infinity;
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
    /* World lobbies (list 3): their own list, and their own socket when they are on another server. */
    this.worldWatch = null;
    this._worldLooking = false;
    /** The LAN server's stand-in for the public server's world lobbies, if it offers one (signaling.js). */
    this.worldLan = null;
    this.worldSig = null;
    this.worldNet = null;
    this._worldOpening = null;
    /** Tries at the world lobbies' server that failed in a row: the next is put off longer each time. */
    this._worldFails = 0;
    this._watchRetry = null;
    /** One per tab: a host tells this tab coming back from a new player (session.js). */
    this.seat = seatToken();
    this.reconnecting = false;
    /** Usernames whose quick chat this player has hidden, for themselves only. */
    this.muted = new Set();
    /** The channel other features play together through (./multiplayer/events.js). */
    this.events = new GameEvents();
    this.events.roster = () => this.eventPlayers();
    /* Part 3b. This device's admin key, if the admin code was typed in the hangar (admin.js). */
    this.adminKey = null;
    /** The admin's list of private matches, while their lobby screen is open. */
    this.privateWatch = null;
    /** What the host says about this player right now: an admin here, muted or frozen by one. */
    this.me = { admin: false, muted: false, frozen: false };
    this._frozeAt = 0;
    /** A lobby an admin took this player out of: not straight back in (the lobby's next host would not know). */
    this._barred = null;
    /*
     * List 2, part 2. Two bits every snapshot carries, set by the features
     * each frame: `ghost` — nobody can bump into or hit this player right now
     * (../bump.js, ../pvp.js) — and `pvp`, switched on (../pvp.js).
     */
    this.extraFlags = { ghost: false, pvp: false };
    /**
     * Out on foot: () => the walking pilot for the snapshot ({ x, y, z,
     * heading, speed, air, down, wave, wading, outfit, knock }) or null.
     * Set by ../pilot-mp.js; nothing here knows what walking is.
     */
    this.walkState = null;
    /** Things other features draw on the minimap overlay: fn(g, toXY, sim), toXY(x, z) → [x, y] or null. */
    this.minimapExtras = [];
    /** The bumping rule a private match is made with (protocol.js BUMP_RULES), picked on the lobby screen. */
    this.bumpPick = BUMP_DEFAULT;
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
    this.worldLan = null;
    this._worldFails = 0;
    clearTimeout(this._lingerTimer);
    this._lingerTimer = null;
    this.closeLookSocket();
    this.closeWorldSocket();
  }

  makeSig(token = null) {
    const opts = {};
    if (this.override && this.override.WebSocketImpl) opts.WebSocketImpl = this.override.WebSocketImpl;
    if (token) opts.token = token;
    return new Signaling(this.backend, opts);
  }

  /**
   * Where the world lobbies are found (list 3): the public matchmaking
   * server — or, in the tests, `configure({ world })` or the override's own
   * server; or a LAN server that offers to stand in for it (--local, --world).
   */
  worldBackend() {
    if (this.override) return this.override.world || this.override.backend || PUBLIC_BACKEND;
    return this.worldLan || PUBLIC_BACKEND;
  }

  makeWorldSig(token = null) {
    const opts = {};
    if (this.override && this.override.WebSocketImpl) opts.WebSocketImpl = this.override.WebSocketImpl;
    if (token) opts.token = token;
    return new Signaling(this.worldBackend(), opts);
  }

  /** The world lobbies are on the same server as the Wi-Fi ones — then one socket does both. */
  worldOnLookServer() {
    const w = this.worldBackend();
    return w.url === this.backend.url && (w.key || 'peerjs') === (this.backend.key || 'peerjs');
  }

  /* ---------------------------------------------------------------- */
  /* Setting up                                                        */
  /* ---------------------------------------------------------------- */

  install(sim) {
    if (this.installed && this.sim === sim) return;
    this.sim = sim;
    this.installed = true;
    this.profile = loadProfile();
    this.adminKey = AdminKey.load();
    injectStyle();
    this.hud = buildHud(this, extLayer());
    this.keepMenuCard();
    this.followMenuPlane();
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
        + '<span class="card-body"><strong>Multiplayer</strong><em>Fly with friends — Wi-Fi and World lobbies, or a private match with a code</em></span>';
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
    if (this.lobbyWatch || this._lobbyLooking || this.worldWatch || this._worldLooking) return;
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
    if (this.lobby) ui.status(`You are in ${lobbyLabel(this.lobby.n, this.lobby.world)}. Leave it from the player list (Tab) first.`, 'warn');
    else if (this.role) ui.status('You are in a game. Leave it from the player list (Tab) first.', 'warn');
    this.watchLobbies();
    if (this.isAdmin) this.watchPrivates();
  }

  /** Both rows of lobbies: the Wi-Fi's and the world's. Each starts only if it is not already going. */
  watchLobbies() {
    const a = this.watchWifiLobbies();
    const b = this.watchWorldLobbies();
    return Promise.all([a, b]);
  }

  async watchWifiLobbies() {
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
        this._wifiFails = (this._wifiFails || 0) + 1;
        if (this.lobbyScreenOpen) {
          ui.net('Can’t reach the matchmaking server', true);
          ui.status('Couldn’t reach the other planes — check the internet is working. You can still fly on your own.', 'bad');
          this.retryLobbyWatch();
        }
        return;
      }
      this._wifiFails = 0;
      if (!this.lobbyScreenOpen || this.lobbyWatch) return;
      this.lobbyWatch = new LobbyWatch({ net, hash, onChange: (list) => this.lobbyScreen && this.lobbyScreen.lobbies(list) });
      ui.lobbies(this.lobbyWatch.lobbies);
      this.lobbyWatch.start();
    } finally {
      this._lobbyLooking = false;
    }
  }

  /**
   * The world lobbies' row (list 3). They do not need to know which Wi-Fi
   * this is — only a way to the public matchmaking server (or whatever
   * stands in for it) — so the row works on a network the Wi-Fi row cannot
   * tell apart, and says so plainly when there is no internet.
   */
  async watchWorldLobbies() {
    const ui = this.lobbyScreen;
    if (this.worldWatch || this._worldLooking) return;
    this._worldLooking = true;
    try {
      ui.worldNet('Looking for the world lobbies…');
      await this.ensureBackend();
      if (typeof RTCPeerConnection !== 'function') {
        ui.worldNet('This browser can’t do multiplayer', true);
        ui.worlds(null);
        return;
      }
      let net = null;
      for (let attempt = 0; attempt < 2 && !net; attempt++) {
        try {
          net = await this.ensureWorldSocket();
        } catch (err) {
          if (!(err && err.code === 'closed' && this.lobbyScreenOpen)) break;
        }
      }
      if (!net) {
        this._worldFails++;
        if (this.lobbyScreenOpen) {
          ui.worldNet('Can’t reach the world lobbies — they need the internet', true);
          ui.worlds(null);
          this.retryLobbyWatch();
        }
        return;
      }
      this._worldFails = 0;
      if (!this.lobbyScreenOpen || this.worldWatch) return;
      const w = this.worldBackend();
      // On the public server: "Over the internet". On a LAN server standing in for it (--local, --world): which one.
      ui.worldNet(w.id === 'public' ? 'Over the internet' : `On ${w.label || 'a test server'}, not the internet`, false);
      this.worldWatch = new LobbyWatch({
        net,
        world: true,
        onChange: (list) => this.lobbyScreen && this.lobbyScreen.worlds(list),
        // A hidden tab asks the public server nothing.
        active: () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
      });
      ui.worlds(this.worldWatch.lobbies);
      this.worldWatch.start();
    } finally {
      this._worldLooking = false;
    }
  }

  /**
   * A row that could not reach its matchmaking server looks again later —
   * 3 s, then 6, 12, 24, up to a minute — while the screen is up, never in
   * a loop that keeps knocking.
   */
  retryLobbyWatch() {
    if (this._watchRetry) return;
    const fails = Math.max(this._worldFails, this._wifiFails || 0);
    const wait = Math.min(60000, 3000 * 2 ** Math.min(5, Math.max(0, fails - 1)));
    this._watchRetry = setTimeout(() => {
      this._watchRetry = null;
      if (this.lobbyScreenOpen && !this.lobby && !this.role) this.watchLobbies();
    }, wait);
  }

  stopWatchingLobbies() {
    if (this.lobbyWatch) this.lobbyWatch.stop();
    this.lobbyWatch = null;
    if (this.worldWatch) this.worldWatch.stop();
    this.worldWatch = null;
    clearTimeout(this._watchRetry);
    this._watchRetry = null;
    if (this.role || this.lobby || this.busy || this.prober) return;
    this.lingerSockets();
  }

  /*
   * The lobby screen's sockets stay open a little after it is shut, and go
   * then if nothing has wanted them again (list 3). A child who goes Back
   * and opens Multiplayer again straight away — which children do — used to
   * open a new connection to the matchmaking server every time; the public
   * one is shared by everybody and turns away an address that connects too
   * often, and a whole school is one address.
   */
  lingerSockets(ms = SOCKET_LINGER_MS) {
    clearTimeout(this._lingerTimer);
    this._lingerTimer = setTimeout(() => {
      this._lingerTimer = null;
      if (this.role || this.lobby || this.busy || this.prober || this.lobbyWatch || this.worldWatch || this.screenOpen) return;
      if (this._looking || this._lobbyLooking || this._worldLooking || this._lookOpening || this._worldOpening) return;
      this.closeLookSocket();
      this.closeWorldSocket();
    }, ms);
  }

  /* ---------------------------------------------------------------- */
  /* Your ride: the same aeroplanes from every game                     */
  /* ---------------------------------------------------------------- */

  /*
   * "the same planes": whichever of the four games a player opens
   * Multiplayer from, they can bring any aeroplane they can fly, the
   * helicopter, the boat or the car — and in a lobby everybody sees
   * everybody's real one (remotes.js builds each from the snapshot's game
   * and type). The main menu's own choice is only where it starts: the
   * aeroplane picked in the Hangar, or the helicopter from Rotors, the boat
   * from the Boat page, the van from the Car page.
   */

  /** Everything this player can bring: every aeroplane they can fly, the helicopter, the boat and the car. */
  rides() {
    const sim = this.sim;
    const prog = sim && (sim.prog || (sim.menus && sim.menus.prog));
    const canFly = (t) => t.id === 'skylark' || !prog || (!Prog.needsPasscode(prog, t) && !(Array.isArray(prog.unlocked) && !Prog.isUnlocked(prog, t.id)));
    const planes = AIRCRAFT.filter((t) => t.id !== 'harrier' && canFly(t)).map((t) => ({ game: 'flight', type: t.id, name: t.name, kind: 'plane' }));
    return [
      ...planes,
      { game: 'heli', type: 'harrier', name: `${getAircraft('harrier').name} helicopter`, kind: 'heli' },
      { game: 'boat', type: 'boat', name: VEHICLES.boat.name, kind: 'boat' },
      { game: 'car', type: 'car', name: VEHICLES.car.name, kind: 'car' },
    ];
  }

  /** The ride a game's own menu is about. */
  rideFor(game) {
    if (game === 'heli') return { game: 'heli', type: 'harrier' };
    if (game === 'boat' || game === 'car') return { game, type: game };
    const r = this.profile && this.profile.ride;
    return { game: 'flight', type: r && r.game === 'flight' && this.rides().some((x) => x.type === r.type) ? r.type : this.myAircraft() };
  }

  /** The ride picked on the lobby screen — or, until one is, the one the game you came from is about. */
  ride() {
    const want = this.profile && this.profile.ride;
    if (want && this.rides().some((r) => r.game === want.game && r.type === want.type)) return { game: want.game, type: want.type };
    return this.rideFor(this.currentGame());
  }

  setRide(r) {
    if (!r || !this.rides().some((x) => x.game === r.game && x.type === r.type)) return false;
    this.profile.ride = { game: r.game, type: r.type };
    saveProfile(this.profile);
    return true;
  }

  /*
   * v56: a plane picked in the Hangar or on the Free Flight screen is the
   * ride again, as the Hangar says ("Free Flight and Multiplayer will start
   * in it"). setRide() keeps the lobby screen's pick for good, and ride() put
   * it first ever after: one tap on the Skylark, or the boat, and every plane
   * picked in the Hangar since was ignored in every lobby — as host and as
   * client, and the others saw the Skylark. Both screens pick through
   * menus.pickFreeAircraft, so that is where this listens: a pick there
   * forgets the lobby screen's, and the menu's own choice decides again
   * (rideFor: that plane, with myAircraft()'s locks; the boat from the Boat
   * page). The newest pick, on either screen, is the ride.
   */
  followMenuPlane() {
    const menus = this.sim && this.sim.menus;
    const pick = menus && menus.pickFreeAircraft;
    if (typeof pick !== 'function' || pick.mpFollows) return;
    const follows = (id) => {
      const out = pick(id);
      if (this.profile && this.profile.ride) {
        this.profile.ride = null;
        saveProfile(this.profile);
      }
      return out;
    };
    follows.mpFollows = true;
    menus.pickFreeAircraft = follows;
  }

  rideName(r) {
    const x = r && this.rides().find((y) => y.game === r.game && y.type === r.type);
    return x ? x.name : r && r.game === 'flight' ? getAircraft(r.type).name : 'your plane';
  }

  /**
   * The ride on island `mapId`: the one picked, if the island has room for it
   * — Kestrel Island takes all four — or the nearest thing it does have:
   * an aeroplane on a helicopter island flies the helicopter, anything on a
   * harbour island without roads sails, and so on. { ride, swapped }.
   */
  rideOn(mapId, lobbyGame) {
    const allows = (g) => mapsForGame(g).some((m) => m.id === mapId);
    const want = this.ride();
    if (allows(want.game)) return { ride: want, swapped: false };
    const order = want.game === 'flight' ? ['heli', lobbyGame, 'boat', 'car'] : [lobbyGame, 'flight', 'heli', 'boat', 'car'];
    const g = order.find((x) => GAMES.includes(x) && allows(x)) || GAMES.find(allows) || 'flight';
    return { ride: this.rideFor(g), swapped: true };
  }

  /**
   * Where this player is, for a lobby they are about to host: in the world, where they are; on the menu, their ride's island.
   * Since list 3 a lobby takes only the game from this: its island is its own (lobby.js).
   */
  lobbyPlace() {
    const sim = this.sim;
    if (this.server && this.server.map) {
      const game = sim.mode === 'drive' && sim.vehicle ? (sim.vehicle.spec && sim.vehicle.spec.kind === 'car' ? 'car' : 'boat') : sim.game || 'flight';
      return { map: this.server.map, game: GAMES.includes(game) ? game : 'flight' };
    }
    const game = this.ride().game;
    return { map: this.defaultMap(game), game };
  }

  /** Into the world on `server`'s island in this player's ride, saying so if the island had no room for the one they picked. */
  async enterWithRide(server, at, weather) {
    const { ride, swapped } = this.rideOn(server.map, server.game);
    await this.enterWorld({ ...server, game: ride.game }, at, weather, ride);
    if (swapped) {
      const want = this.ride();
      const what = { flight: 'runway', heli: 'helipad', boat: 'harbour', car: 'roads' }[want.game] || 'room';
      this.toast(`${mapNameFor(server.map)} has no ${what} for the ${this.rideName(want)} — you’re in the ${this.rideName(ride)}`, 'info', 6);
    }
    return ride;
  }

  /**
   * Into lobby n: host it if it is empty, join whoever hosts it if not.
   * `world` (list 3): world lobby n instead — the same for everybody on the
   * internet, through the world lobbies' own server; it needs no Wi-Fi hash.
   */
  async joinLobby(n, world = false) {
    const ui = this.lobbyScreen;
    world = !!world;
    const label = lobbyLabel(n, world);
    if (this.role || this.busy || this.lobby) return ui && ui.status('You are already in a game.', 'warn');
    if (!this.profile.chosen) return ui && ui.status('Pick your username first — then you can join.', 'warn');
    if (this._barred && this._barred.n === n && now() < this._barred.until) {
      return ui && ui.status(`An admin took you out of Lobby ${n} a moment ago — try another lobby for now.`, 'warn');
    }
    this.busy = true;
    this.wake();
    ui.busy(true);
    ui.offer(null);
    ui.status(`Joining ${label}…`);
    const attempt = this.newAttempt();
    const wanted = () => this._attempt === attempt;
    let member = null;
    try {
      const hash = world ? (await this.ensureBackend(), this.hash) : await this.ensureNetwork();
      if (!wanted()) return;
      if (typeof RTCPeerConnection !== 'function') return ui.status('This browser has no WebRTC, which multiplayer needs.', 'bad');
      if (!world && !hash) return ui.status('Couldn’t tell which Wi-Fi you are on, so the lobbies can’t be found. The World lobbies and a friend’s code still work.', 'bad');
      const net = world ? await this.worldSocketWithRetry(2, ui, wanted) : await this.lookSocketWithRetry(1, null, wanted);
      if (!wanted()) return;
      if (!net) {
        ui.status(world
          ? 'Couldn’t reach the world lobbies — they need the internet. The Wi-Fi lobbies still work.'
          : 'Couldn’t reach the matchmaking server — check the internet is working. You can still fly on your own.', 'bad');
        return;
      }
      member = new LobbyMember({
        n, hash, world,
        net: () => (world ? this.ensureWorldSocket() : this.ensureLookSocket()),
        makeSig: (token) => (world ? this.makeWorldSig(token) : this.makeSig(token)),
        profile: this.profile, seat: this.seat,
        admin: () => this.adminNow(),
        place: () => this.lobbyPlace(),
        spawnInfo: () => this.whereAmI(),
        weather: () => (this.sim.weather && this.sim.weather.serialize ? this.sim.weather.serialize() : null),
        onEvent: (type, ...args) => this.onLobbyEvent(member, type, ...args),
      });
      this.lobby = member;
      this._cancelLobby = () => member.leave();
      // Across the internet a first connection can take a while: after a few seconds, say it is still going.
      const slow = world ? setTimeout(() => {
        if (wanted() && this.lobby === member && !this.role) ui.status(`Still joining ${label} — reaching its host over the internet can take a few seconds…`);
      }, 6000) : null;
      let r;
      try {
        r = await member.start();
      } catch (err) {
        if (this.lobby === member) this.lobby = null;
        if (!wanted() || (err && err.code === 'cancelled')) {
          ui.status('');
          return;
        }
        this.lobbyRefused(n, err, world);
        return;
      } finally {
        clearTimeout(slow);
        this._cancelLobby = null;
      }
      if (!wanted()) {
        member.leave();
        if (this.lobby === member) this.lobby = null;
        return;
      }
      if (this.lobbyWatch) this.lobbyWatch.stop();
      this.lobbyWatch = null;
      if (this.worldWatch) this.worldWatch.stop();
      this.worldWatch = null;
      // In a lobby, only its own server's socket is needed; the other row's goes, if it is a different one.
      if (!this.worldOnLookServer()) {
        if (world) this.closeLookSocket();
        else this.closeWorldSocket();
      }
      this.takeLobbySession(r.role, r.session, r.welcome);
      const server = member.server;
      this.server = { ...server };
      ui.status('');
      await this.enterWithRide(server, r.welcome ? r.welcome.at : null, r.welcome ? r.welcome.weather : null);
      if (this.lobby !== member) return;
      this.ready = true;
      this.showHud();
      this.note(`in ${world ? 'world lobby' : 'lobby'} ${n} (${server.map}) as ${r.role === 'host' ? 'its host' : `player ${this.meId}`}`);
      this.toast(`You’re in ${label} · ${world ? worldName(n) : lobbyName(n)} — on ${mapNameFor(server.map)}`, 'good', 5);
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
    this.events.attach(session, role, this.meId);
    this.syncSelf();
  }

  /** Said on the lobby screen when a lobby would not have us, with the one tap that fixes it. */
  lobbyRefused(n, err, world = false) {
    const ui = this.lobbyScreen;
    const code = err && err.code;
    const label = lobbyLabel(n, world);
    if (code === 'name') {
      ui.status(`Someone in ${label} is already called ${this.profile.name} — change your number or pick another name.`, 'warn');
      if (err.suggest) ui.offer({ kind: 'name', n, world, name: err.suggest });
      return;
    }
    if (code === 'full') {
      const watch = world ? this.worldWatch : this.lobbyWatch;
      const other = watch && watch.emptiest(n);
      ui.status(`${label} is full — eight players is the most.${other ? ` ${lobbyLabel(other.n, world)} has room.` : ''}`, 'warn');
      if (other) ui.offer({ kind: 'lobby', n: other.n, world, players: other.players, max: other.max });
      return;
    }
    if (code === 'version') return ui.status('That lobby is running a different version of the game. Reload the page on both computers.', 'bad');
    if (code === 'signaling') return ui.status('Lost the connection to the matchmaking server — try again in a moment.', 'bad');
    ui.status(world ? `Couldn’t get into ${label} over the internet — try again, or try another world lobby.`
      : `Couldn’t get into ${label} — try again, or try another lobby.`, 'bad');
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
        // Between hosts: the shared state is kept, for whoever hosts next (events.js).
        this.events.detach({ keepState: true });
        this.note(`${member.world ? 'world lobby' : 'lobby'} ${member.n}: ${args[0] === 'moved' ? 'moving to the lobby’s real host' : `the host went (${args[0]}${args[1] && args[1] !== args[0] ? `, ${args[1]}` : ''})`} — re-forming`);
        this.syncRoster();
        break;
      }
      case 'role': {
        const [role, session, info] = args;
        this.reconnecting = false;
        this.takeLobbySession(role, session, info.welcome);
        const was = this.server && this.server.map;
        this.server = { ...info.server };
        this.note(`${member.world ? 'world lobby' : 'lobby'} ${member.n} re-formed in ${Math.round(info.ms)} ms; ${role === 'host' ? 'this tab hosts it now' : `player ${this.meId}`}`);
        // Only a merge with a lobby on another island moves anybody: re-forming in place changes nothing on screen.
        if (was && info.server.map !== was) {
          this.ready = false;
          this.enterWithRide(info.server, info.welcome ? info.welcome.at : null, null)
            .then(() => {
              if (this.lobby === member) this.ready = true;
            });
        }
        this.syncRoster();
        break;
      }
      case 'trying': {
        // A world lobby's host could not be reached on the first path (list 3): say so while it tries again.
        this.note(`world lobby ${member.n}: no path to its host (${args[0]}); trying again${RELAY_SERVERS.length ? ' through a relay' : ''}`);
        if (this.busy && this.lobbyScreen) this.lobbyScreen.status(`Still reaching ${lobbyLabel(member.n, true)} over the internet — this can take a few seconds…`);
        break;
      }
      case 'out': {
        const [why] = args;
        const n = member.n;
        const label = lobbyLabel(n, member.world);
        this.note(`out of ${member.world ? 'world lobby' : 'lobby'} ${n}: ${why}`);
        this.lobby = null;
        this.cleanup();
        // Part 3b: an admin took this player out, or closed the lobby.
        if (why === 'kicked') {
          this._barred = { n, until: now() + 120000 };
          const said = `An admin took you out of Lobby ${n} — you can keep flying on your own, or join another lobby.`;
          this.toast(said, 'warn', 7);
          if (this.lobbyScreen) this.lobbyScreen.status(said, 'warn');
          break;
        }
        if (why === 'shut') {
          this.backToLobbies(`An admin closed Lobby ${n} for now — everybody is back here. Pick a lobby to fly again.`);
          break;
        }
        const words = why === 'name'
          ? `Someone in ${label} is already called ${this.profile.name} — flying on your own. Open Multiplayer to pick another name.`
          : why === 'full' ? `${label} filled up while it re-formed — flying on your own now.`
            : 'Lost the lobby — flying on your own now.';
        this.toast(words, 'warn', 7);
        if (this.lobbyScreen) this.lobbyScreen.status(words, 'warn');
        break;
      }
      default:
        this.onSessionEvent(type, ...args);
    }
  }

  /**
   * "Swift Falcon joined", said once for everybody who joined in the same
   * moment. Seven joining at once was four toasts stacked down the middle
   * of the view (the HUD keeps four), over the nametags of the very people
   * joining: now it is one line — "Swift Falcon, Sunny Puffin and 5 more
   * joined" — gathered while they keep arriving, three seconds at most.
   */
  comeAndGo(what, name) {
    const q = this._cag || (this._cag = new Map());
    if (!q.has(what)) q.set(what, []);
    q.get(what).push(name);
    // Gathered until a second passes with nobody new — three at the most, so it is still said promptly.
    const t = now();
    if (!this._cagTimer) this._cagFirst = t;
    clearTimeout(this._cagTimer);
    this._cagTimer = setTimeout(() => {
      this._cagTimer = null;
      const all = [...q.entries()];
      q.clear();
      for (const [w, names] of all) {
        const who = names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]}, ${names[1]} and ${names.length - 2} more`;
        this.toast(`${who} ${w}`, w === 'joined' ? 'good' : 'info');
      }
    }, Math.max(0, Math.min(1000, this._cagFirst + 3000 - t)));
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
  /**
   * List 2, part 2: the player's own PvP switch, remembered on this device.
   * What it does in a game — the three seconds before it counts, the host
   * saying so to everybody — is ../pvp.js, which listens here.
   */
  setPvp(on) {
    const want = !!on;
    if (!this.profile || this.profile.pvp === want) return want;
    this.profile.pvp = want;
    saveProfile(this.profile);
    for (const fn of [...(this._pvpListeners || [])]) {
      try {
        fn(want);
      } catch (e) {
        /* a listener's problem, not the switch's */
      }
    }
    if (this.lobbyScreenOpen && this.lobbyScreen) this.lobbyScreen.refresh();
    return want;
  }

  onPvpChange(fn) {
    if (!this._pvpListeners) this._pvpListeners = new Set();
    this._pvpListeners.add(fn);
    return () => this._pvpListeners.delete(fn);
  }

  /** The bumping rule of the game this player is in (protocol.js BUMP_RULES): 'off', 'gentle' or 'pvp'. */
  bumpRuleNow() {
    return BUMP_RULES[bumpRule(this.server ? this.server.bump : undefined)];
  }

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
      .map((m) => ({ id: m.id, name: m.name, subtitle: m.subtitle || '' }));
  }

  /** Where a private match starts out: the island you are on, if the game has it; else the one the menu picked for that game. */
  privateDefault(game) {
    const sim = this.sim;
    const here = sim && sim.settings && sim.settings.map;
    return this.mapsFor(game).some((m) => m.id === here) ? here : this.defaultMap(game);
  }

  /** The Maps screen's painted picture of an island (menus.js draws one per map at boot), or null. */
  mapPicture(id) {
    const maps = this.sim && this.sim.menus && this.sim.menus.screens && this.sim.menus.screens.maps;
    const c = maps && maps.querySelector ? maps.querySelector(`[data-map-art="${String(id).replace(/[^a-z0-9_-]/gi, '')}"] canvas`) : null;
    return c || null;
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
        const worldWas = this.worldBackend().url;
        this.backend = lan.backend;
        this.hash = lan.hash;
        this.hashVia = 'lan';
        // A LAN server started with --local or --world stands in for the public server's world lobbies (list 3).
        this.worldLan = lan.world || null;
        // An earlier "don't know" left a socket open on the public server; the next one goes to the LAN.
        if (moved && !this.role && !this.lobby) {
          if (this.prober) this.prober.stop();
          this.prober = null;
          if (this.lobbyWatch) this.lobbyWatch.stop();
          this.lobbyWatch = null;
          this.closeLookSocket();
          if (this.worldBackend().url !== worldWas) {
            if (this.worldWatch) this.worldWatch.stop();
            this.worldWatch = null;
            this.closeWorldSocket();
          }
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
      if (this.legacyScreenOpen) {
        this.screen.net('Lost the matchmaking server — trying again', true);
        setTimeout(() => this.screenOpen && !this.role && this.startLooking(), 3000);
      }
      // The lobby screen's rows were looking through this socket: look again, a little later (list 3).
      if (this.lobbyScreenOpen) {
        if (this.lobbyWatch) this.lobbyWatch.stop();
        this.lobbyWatch = null;
        if (this.worldOnLookServer() && this.worldWatch) {
          this.worldWatch.stop();
          this.worldWatch = null;
        }
        this.lobbyScreen.net('Lost the matchmaking server — trying again', true);
        this.retryLobbyWatch();
      }
    };
    return this.lookNet;
  }

  /*
   * The world lobbies' socket (list 3). On the same server as the Wi-Fi
   * lobbies — the public one, for nearly everybody — it IS the look socket,
   * and nothing extra is opened. On a page served by the LAN server it is a
   * second socket, to the public server, open only while the lobby screen is
   * up or a world lobby is riding on it.
   */
  ensureWorldSocket() {
    if (this.worldOnLookServer()) return this.ensureLookSocket();
    if (this.worldSig && this.worldSig.isOpen && this.worldNet) return Promise.resolve(this.worldNet);
    if (!this._worldOpening) {
      const p = this.openWorldSocket().finally(() => {
        if (this._worldOpening === p) this._worldOpening = null;
      });
      this._worldOpening = p;
    }
    return this._worldOpening;
  }

  async openWorldSocket() {
    if (this.worldNet) this.worldNet.destroy();
    if (this.worldSig) this.worldSig.close();
    const sig = this.makeWorldSig();
    this.worldSig = sig;
    this.worldNet = null;
    try {
      await sig.open(playerPeerId());
    } catch (err) {
      sig.close();
      if (this.worldSig === sig) this.worldSig = null;
      throw err;
    }
    if (this.worldSig !== sig) {
      sig.close();
      throw Object.assign(new Error('closed while opening'), { code: 'closed' });
    }
    this.worldNet = new Net(sig);
    this.worldNet.onsigclose = () => {
      // In a world lobby: let it go without closing what rides on it; lobby.js asks for a fresh one when it needs one.
      if (this.worldSig === sig) {
        this.worldSig = null;
        this.worldNet = null;
      }
      if (this.lobby || this.role === 'client' || this.busy) return;
      if (this.worldWatch) this.worldWatch.stop();
      this.worldWatch = null;
      if (this.lobbyScreenOpen) {
        this.lobbyScreen.worldNet('Lost the world lobbies — trying again', true);
        this.retryLobbyWatch();
      }
    };
    return this.worldNet;
  }

  closeWorldSocket() {
    if (this.worldNet) this.worldNet.destroy();
    if (this.worldSig) this.worldSig.close();
    this.worldNet = null;
    this.worldSig = null;
    this._worldOpening = null;
  }

  /** The world lobbies' socket, tried again after a pause if the server turns this address away (it rate-limits). */
  async worldSocketWithRetry(tries, ui, wanted = () => true) {
    const pauses = [2000, 5000, 10000];
    for (let i = 0; i < tries; i++) {
      try {
        return await this.ensureWorldSocket();
      } catch (err) {
        if (!wanted() || i === tries - 1) return null;
        this.note(`world lobbies' server: ${err && err.code ? err.code : 'no answer'}; trying again`);
        if (ui) ui.status('The world lobbies’ server is busy — trying again…');
        await new Promise((r) => setTimeout(r, pauses[i] || 10000));
        if (!wanted()) return null;
      }
    }
    return null;
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
    // The world row may be looking through this same socket (list 3).
    if (this.worldWatch && this.worldOnLookServer()) return;
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
  async hostServer({ serverName, map, game, privateGame = false, ride = null, bump = BUMP_DEFAULT }) {
    const ui = privateGame ? this.lobbyScreen : this.screen;
    if (this.role || this.busy || this.lobby) return ui && ui.status('You are already in a game.', 'warn');
    const name = parseServerName(serverName) ? serverName : this.serverName();
    if (ride) game = ride.game;
    if (!['flight', 'heli', 'boat', 'car'].includes(game)) game = 'flight';
    // An island this game has, and one this player may use (the menu's own passcode rules).
    if (!this.mapsFor(game).some((m) => m.id === map)) map = this.defaultMap(game);
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
      // The matchmaking server can turn a busy address away for a moment (list 2, range): twice more, after a pause.
      let code = null;
      for (let i = 0; !code; i++) {
        try {
          code = await claimCode({ makeSig });
        } catch (err) {
          if (i >= 2 || (err && err.code === 'taken')) throw err;
          this.note(`claiming a code: ${err && err.code ? err.code : 'no answer'}; trying again`);
          ui.status('The matchmaking server is busy — trying again…');
          await new Promise((r) => setTimeout(r, [1500, 4000][i]));
          attempt.check();
        }
      }
      sockets.push({ id: codeId(code.code), sig: code.sig, what: 'code' });
      attempt.check();
      // Part 3b: a private match is also in the admins' directory — no code there, and nobody but an admin gets in through it.
      if (privateGame) {
        const dir = await claimPdir({ makeSig }).catch(() => null);
        if (dir) sockets.push({ id: pdirId(dir.n), sig: dir.sig, what: 'pdir' });
        attempt.check();
      }

      // The host needs its slot and code sockets, not the one it was looking with.
      if (this.prober) this.prober.stop();
      this.prober = null;
      this.closeLookSocket();
      this.stopWatchingLobbies();
      this.server = { name, map: mapDef.id, mapName: mapDef.name, game, code: code.code, slot, max: privateGame ? CODE_GAME_MAX : MAX_PLAYERS, priv: !!privateGame, bump: bumpRule(bump) };
      this.host = new HostSession({
        mode: privateGame ? 'code' : 'slot',
        admin: !!this.adminNow(),
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
      this.events.attach(this.host, 'host', 0);
      this.syncSelf();
      this.ready = false;
      this.remotes.clear();
      ui.status('');
      await this.enterWorld(this.server, null, null, ride);
      this.ready = true;
      this.showHud();
      this.note(`hosting "${name}" (${game}, ${mapDef.id}) in slot ${slot || 'none'}, code ${code.code}${privateGame ? ', private' : ''}`);
      this.toast(privateGame ? `Your private match on ${mapDef.name} is ready — tell your friends the code: ${code.code}. It works with friends who aren’t on your Wi-Fi.`
        : slot ? `Your server is up — slot ${slot}, code ${code.code}` : `Your server is up — code ${code.code}`, 'good', 8);
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
    // The admins' directory: joining only, admins only (HostSession).
    if (entry.what === 'pdir') net.dirOnly = true;
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
        if (entry.what === 'pdir') this.note('lost its place in the admins’ directory of private matches');
        else this.toast(entry.what === 'slot' ? 'Your server lost its slot on the list — friends can still join with the code' : 'Your join code stopped working', 'warn', 6);
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

  /**
   * A private match by its code, for its card on the lobby screen: one ping
   * to the matchmaking server, answered with numbers (how many, the most,
   * which island and game) — never a name. { state: 'here' | 'empty' |
   * 'offline' | 'bad', code, count }.
   */
  async lookupCode(raw) {
    const code = normaliseCode(raw);
    if (!code) return { state: 'bad', code: null, count: null };
    await this.ensureBackend();
    const net = await this.lookSocketWithRetry(1, null);
    if (!net) return { state: 'offline', code, count: null };
    const { r, meta } = await net.pingInfo(codeId(code), 2500);
    return { state: r === 'here' ? 'here' : r === 'empty' ? 'empty' : 'offline', code, count: r === 'here' ? readPrivateCount(meta) : null };
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
      // A code, or an admin joining a private match from the directory: both reach across networks.
      const byCode = /^ifs-(code|pdir)-/.test(String(target));
      let net = await this.lookSocketWithRetry(byCode ? 3 : 1, ui, wanted);
      if (!wanted()) return;
      if (!net) {
        ui.status('Couldn’t reach the matchmaking server — check the internet is working. You can still fly on your own.', 'bad');
        return;
      }
      /*
       * List 2, range: a join by code that cannot connect gets a second,
       * fresh try — through a relay only, if one is configured (link.js,
       * RELAY_SERVERS) — before the child is told. A path between two
       * networks is what most often needs it; the first try's candidates
       * can also simply have crossed badly, or the matchmaking server blipped.
       */
      let client = null;
      let welcome = null;
      for (let tryNo = 0; tryNo < 2 && !welcome; tryNo++) {
        client = new ClientSession({
          net, target, profile: this.profile, seat: this.seat, relayOnly: tryNo > 0 && RELAY_SERVERS.length > 0, admin: this.adminNow(),
          onEvent: (type, ...args) => this.onSessionEvent(type, ...args),
        });
        this.client = client;
        try {
          welcome = await client.start();
        } catch (err) {
          if (this.client === client) this.client = null;
          if (byCode && tryNo === 0 && wanted() && err && ['ice', 'timeout', 'signaling', 'dropped'].includes(err.code)) {
            this.note(`join by code: the first try failed (${err.code}); trying again${RELAY_SERVERS.length ? ' through a relay' : ''}`);
            ui.status('Still trying to reach your friend’s game — this can take a few seconds…');
            if (!(net.sig && net.sig.isOpen)) net = await this.lookSocketWithRetry(3, ui, wanted);
            if (!wanted()) return;
            if (net) continue;
          }
          this.joinFailed(err, target, ui);
          return;
        }
      }
      if (!welcome) return;
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
      this.events.attach(client, 'client', welcome.you);
      this.syncSelf();
      this.ready = false;
      this.remotes.clear();
      for (const p of welcome.players) if (p.id !== this.meId) this.remotes.add(p.id, p);
      ui.status('');
      // A private match: in this player's own ride, as in a lobby. A server from the older list: its game.
      if (welcome.server.priv) await this.enterWithRide(welcome.server, welcome.at, welcome.weather);
      else await this.enterWorld(welcome.server, welcome.at, welcome.weather);
      // The client may have been dropped while the world was loading.
      if (this.role !== 'client') return;
      this.ready = true;
      this.showHud();
      this.note(`joined "${welcome.server.name}" as player ${welcome.you}${welcome.server.priv ? `, private, on ${welcome.server.map}` : ''}`);
      this.toast(welcome.server.priv
        ? `You’re in the private match — on ${mapNameFor(welcome.server.map)}${welcome.name !== this.profile.name ? `, as ${welcome.name}` : ''}`
        : `Joined ${welcome.server.name}${welcome.name !== this.profile.name ? ` as ${welcome.name}` : ''}`, 'good', 5);
    } finally {
      this.afterAttempt(attempt);
    }
  }

  /** What a join that did not work says: a username to change (with the one-tap fix), or the join's own words. */
  joinFailed(err, target, ui) {
    if (err && err.code === 'left') {
      this.note('stopped joining');
      ui.status('');
    } else if (err && err.code === 'name') {
      // A game joined by code keeps one username to one player too; the host says which one is free.
      ui.status(`Someone in that game is already called ${this.profile.name} — change your number or pick another name.`, 'warn');
      if (err.suggest && ui.offer) ui.offer({ kind: 'name', target, name: err.suggest });
    } else ui.status(err && err.message ? err.message : 'Couldn’t join that server.', 'bad');
  }

  /**
   * The look socket, opened again after a pause when the matchmaking server
   * refuses or drops it — 0.peerjs.com turns away an address that opens too
   * many at once, and a school's connection blips. `tries` in all; null if
   * none worked, or the join was cancelled meanwhile.
   */
  async lookSocketWithRetry(tries, ui, wanted = () => true) {
    const pauses = [1500, 4000, 8000];
    for (let i = 0; i < tries; i++) {
      try {
        return await this.ensureLookSocket();
      } catch (err) {
        if (!wanted() || i === tries - 1) return null;
        this.note(`matchmaking server: ${err && err.code ? err.code : 'no answer'}; trying again`);
        if (ui) ui.status('The matchmaking server is busy — trying again…');
        await new Promise((r) => setTimeout(r, pauses[i] || 8000));
        if (!wanted()) return null;
      }
    }
    return null;
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
  async enterWorld(server, at, weather, ride = null) {
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
        const aircraft = server.game === 'heli' ? 'harrier' : ride && ride.game === 'flight' ? ride.type : this.myAircraft();
        /*
         * The AI aeroplanes are the host's (list 2, "the same planes"): the host
         * runs them — in Dev mode only, as in single player — and everybody else
         * draws the host's (../mpworld.js). Nobody but the host starts their own.
         */
        const traffic = this.role === 'host' ? {} : { traffic: false };
        await sim.startMode('free', { ...base, aircraft, airborne: false, taxi: false, ...traffic });
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
        this.events.joined({ id: a.id, name: a.name, colour: a.colour });
        this.note(`${a.name} joined as player ${a.id}`);
        // An admin arriving is said to be one: nothing an admin does is hidden from the others (part 3b).
        this.comeAndGo('joined', a.admin ? `${a.name} (an admin)` : a.name);
        this.syncRoster();
        break;
      case 'leave': {
        this.remotes.remove(a.id);
        this.events.left({ id: a.id, name: a.name, colour: a.colour });
        this.note(`${a.name} left: ${b}${detail && detail !== b ? ` (${detail})` : ''}`);
        // Only the host is told somebody was removed; everybody else sees them leave, and nobody is made an example of.
        if (b === 'kicked' && this.role === 'host') this.toast(`${a.name} was removed`, 'info');
        else this.comeAndGo(b === 'dropped' ? 'lost connection' : 'left', a.name);
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
        // Everybody's tag, with who hosts (the crown) and who is an admin — the host's list is the list.
        for (const raw of a) {
          const p = this.role === 'host' ? readPlayer(raw) : raw;
          // A player: everybody in the list. The host: its players are added as they join; this only brings their flags up to date.
          if (p && p.id !== this.meId && (this.role === 'client' || this.remotes.players.has(p.id))) this.remotes.add(p.id, p);
        }
        this.syncSelf();
        this.syncRoster();
        break;
      case 'ended':
        this.ended(a, b);
        break;
      case 'admin':
        // Part 3b, on the host's screen: what an admin just did here, said plainly.
        this.adminSaid(a);
        break;
      case 'removed':
        // Part 3b: an admin took this host out of its lobby ('kicked'), or closed the game ('shut').
        this.removedByAdmin(a);
        break;
      case 'gev':
        this.events.fromWire(a, b);
        break;
      case 'gst':
        this.events.stateFromWire(a);
        break;
      default:
        break;
    }
  }

  /**
   * Everybody in the game for events.players(): who they are, what they are
   * in, and where THIS player sees them — the drawn position, which is what
   * a hit test from this player's point of view has to use.
   */
  eventPlayers() {
    if (!this.role) return [];
    const sim = this.sim;
    const plain = (v) => (v ? { x: v.x, y: v.y, z: v.z } : null);
    return this.roster().map((p) => {
      // Part 3b's `frozen` too: a player an admin froze shoots nobody (../pvp.js).
      const base = { id: p.id, name: p.name, colour: p.colour, host: !!p.host, frozen: !!p.frozen };
      if (p.id === this.meId) {
        const v = sim && (sim.mode === 'drive' && sim.vehicle ? sim.vehicle : sim.aircraft);
        const q = v && v.quat;
        let walk = null;
        try {
          walk = this.walkState ? this.walkState() : null;
        } catch (e) {
          walk = null;
        }
        return {
          ...base, me: true, ride: this.rideNow(), pos: plain(v && v.pos), quat: q ? { x: q.x, y: q.y, z: q.z, w: q.w } : null, vel: plain(v && v.vel), visible: true,
          ghost: !!this.extraFlags.ghost, pvp: !!this.extraFlags.pvp, onGround: sim.mode === 'drive' ? true : !!(v && v.onGround),
          // Out on foot: where the pilot is (the ride is parked, or flying itself).
          walk: walk ? { x: walk.x, y: walk.y, z: walk.z, down: !!walk.down } : null,
        };
      }
      const r = this.remotes.players.get(p.id);
      const snap = r && r.sample && r.sample.snap;
      return {
        ...base, me: false, ride: snap ? { game: snap.game, type: snap.type } : null,
        pos: plain(r && r.drawn), quat: r && r.quat ? { x: r.quat.x, y: r.quat.y, z: r.quat.z, w: r.quat.w } : null,
        vel: plain(r && r.sample && r.sample.vel), visible: !!(r && r.visible),
        // List 2, part 2: what their snapshot says (protocol.js flags), and how big what is drawn is.
        ghost: !!(snap && snap.ghost), pvp: !!(snap && snap.pvp), onGround: !!(snap && snap.onGround),
        radius: r && r.model && r.model.userData ? r.model.userData.mpRadius || 0 : 0,
        // Out on foot: where this game draws their pilot (../multiplayer/walkers.js).
        walk: r && r.walker && r.walker.on ? { x: r.walker.x, y: r.walker.y, z: r.walker.z, down: !!r.walker.down } : null,
      };
    });
  }

  /** What this player is in right now: { game, type }. */
  rideNow() {
    const sim = this.sim;
    if (!sim) return null;
    if (sim.mode === 'drive' && sim.vehicle) return { game: sim.vehicle.spec && sim.vehicle.spec.kind === 'car' ? 'car' : 'boat', type: sim.vehicle.spec && sim.vehicle.spec.kind === 'car' ? 'car' : 'boat' };
    const type = sim.aircraftType ? sim.aircraftType.id : 'skylark';
    return { game: type === 'harrier' ? 'heli' : 'flight', type };
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
    if (why === 'shut') {
      this.cleanup();
      this.backToLobbies('An admin closed that game for now — everybody is back here. Pick a lobby to fly again.');
      return;
    }
    const words = {
      closed: 'The host closed the server',
      kicked: detail === 'admin'
        ? 'An admin took you out of this game — you can keep flying on your own, or join another one'
        : 'The host took you out of this game — you can keep flying on your own, or join another server',
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
      this.note(`left ${m.world ? 'world lobby' : 'lobby'} ${m.n} (${why})`);
      // A host hands the lobby on by leaving it: the next in line claims it (lobby.js).
      m.leave(why === 'tab closed');
      if (why !== 'menu' && why !== 'tab closed') this.toast(`You left ${lobbyLabel(m.n, m.world)}`, 'info');
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
    this.holdStill(false);
    this.me = { admin: false, muted: false, frozen: false };
    this.events.detach();
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
    // Out of a world lobby: its own socket to the public server goes too, unless the lobby screen is looking through it.
    if (!this.lobbyScreenOpen && !this.worldWatch && !this.worldOnLookServer()) this.closeWorldSocket();
  }

  kick(id) {
    if (this.role !== 'host' || !this.host) return;
    this.host.kick(id);
  }

  chat(m) {
    const s = this.session;
    if (!s || !QUICK_CHAT[m]) return;
    if (this.me.muted) {
      this.toast('An admin has muted your chat for now', 'warn', 3);
      return;
    }
    const sent = s.chat(m);
    if (sent) this.toast(`You: ${QUICK_CHAT[m].text}`, 'info', 2.5);
  }

  roster() {
    if (this.lobby && !this.lobby.session) {
      // Re-forming: only ourselves, until the lobby is back.
      return [{ id: this.meId ?? 0, name: this.profile.name, colour: this.profile.colour, host: false, ping: null }];
    }
    // Read the same way on both sides (protocol.js readPlayer): host, admin, muted and frozen as flags.
    if (this.role === 'host' && this.host) return this.host.roster().map((p) => readPlayer(p)).filter(Boolean);
    if (this.role === 'client' && this.client) {
      const self = this.client.self || {};
      const me = {
        id: this.meId, name: this.client.name || this.profile.name, colour: this.profile.colour, host: false, ping: this.client.ping == null ? null : Math.round(this.client.ping),
        admin: !!self.admin, muted: !!self.muted, frozen: !!self.frozen,
      };
      return [me, ...this.client.players.values()].sort((a, b) => a.id - b.id);
    }
    return [];
  }

  syncRoster() {
    if (!this.hud || !this.role) return;
    const list = this.roster();
    const lobby = this.lobby ? this.lobby.n : 0;
    const world = !!(this.lobby && this.lobby.world);
    const locked = !!(!lobby && this.role === 'host' && this.host && this.host.locked);
    // The join code is on everybody's screen for the whole game: shown only if it is exactly one the game could make.
    const shown = lobby ? null : shownCode(this.server && this.server.code);
    const max = lobby ? LOBBY_MAX : (this.server && this.server.max) || MAX_PLAYERS;
    const priv = !lobby && !!(this.server && this.server.priv);
    const title = lobby ? `${lobbyLabel(lobby, world)} · ${world ? worldName(lobby) : lobbyName(lobby)}` : priv ? 'Private match' : this.server ? this.server.name : '';
    /*
     * In a lobby nobody is the host on purpose, so nobody gets Kick or Lock
     * and nobody is labelled host; what everybody gets is Mute, which hides
     * one player's quick chat for themselves.
     */
    // Which island, from this copy's own list of maps: the lobby's or the private match's.
    const place = this.server && this.server.map ? mapNameFor(this.server.map) : '';
    const opts = {
      meId: this.meId, isHost: !lobby && this.role === 'host', lobby: !!lobby, muted: this.muted, max, reconnecting: this.reconnecting,
      code: shown, server: title, locked, place, priv, world,
      // Part 3b: this player is an admin here (the host checked), so the list has the admin menu.
      admin: !!this.me.admin && !this.reconnecting,
    };
    this.hud.roster(list, opts);
    if (this.sim && this.sim.state === 'paused') this.hud.pauseList(this.sim, true, list, opts);
    // Two short lines: where you are and how many; and, in a game joined by code, the code — the host is told to share it.
    const again = this.reconnecting ? ' · <em class="mp-again">reconnecting…</em>' : '';
    const codeLine = shown ? `Code <b>${say(shown)}</b>${priv && this.role === 'host' ? ' — tell your friends' : ''}` : '';
    // List 2, part 2: and the game's bumping rule, as its lobby card said it.
    const rule = BUMP_SHORT[this.bumpRuleNow()] || '';
    const placeLine = place ? `On ${say(place)}${rule ? ` · ${say(rule)}` : ''}` : '';
    // Part 3b: an admin sees that they are one; a player an admin muted or froze is told, here as well as in a toast.
    const left = this.me.frozen ? Math.max(1, Math.ceil((this._frozeAt + FREEZE_MS - now()) / 1000)) : 0;
    const adminLine = this.me.frozen ? `<b class="mp-frozen">Frozen by an admin</b>${left <= 30 ? ` — ${left} s` : ''}`
      : this.me.muted ? '<b class="mp-frozen">Your chat is muted by an admin</b>' : '';
    const tag = this.me.admin ? ' · <b class="mp-admintag">ADMIN</b>' : '';
    // The crown on your own badge while this game is yours (you host it): everybody else sees it over your aeroplane.
    const crown = this.role === 'host' && !this.reconnecting ? CROWN_SVG : '';
    this.hud.badge(`${crown}<b>${say(title)}</b> · ${list.length}/${max}${locked ? ' · locked' : ''}${tag}${again}`, [adminLine, placeLine, codeLine].filter(Boolean).join('<br>'));
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

  /**
   * This player's snapshot, encoded. Out on foot, the walking pilot rides on
   * it too (protocol.js, the walker's tail): `walkState`, set by
   * ./pilot-mp.js, says where they are, or null.
   */
  myState(t) {
    const sim = this.sim;
    this._seq = (this._seq + 1) & 0xffff;
    let walk = null;
    if (this.walkState) {
      try {
        walk = this.walkState() || null;
      } catch (e) {
        walk = null;
      }
    }
    if (sim.mode === 'drive' && sim.vehicle) {
      const v = sim.vehicle;
      const kind = v.spec && v.spec.kind === 'car' ? 'car' : 'boat';
      return encodeState({
        id: this.meId, seq: this._seq, t, pos: v.pos, quat: v.quat, vel: v.vel, game: kind, type: kind,
        throttle: Math.abs(v.throttle || 0), steer: v.steer || 0, brakes: (v.brakes || 0) > 0.05,
        onGround: true, engineOn: true, lights: true, gearDown: true, gearPos: 1,
        ghost: !!this.extraFlags.ghost, pvp: !!this.extraFlags.pvp, walk,
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
      ghost: !!this.extraFlags.ghost, pvp: !!this.extraFlags.pvp, walk,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Part 3b: admin                                                     */
  /* ---------------------------------------------------------------- */

  /** This device's admin key, if it has one the game accepts — asked afresh each time. */
  adminNow() {
    return this.adminKey && this.adminKey.valid ? this.adminKey : null;
  }

  get isAdmin() {
    return !!this.adminNow();
  }

  /**
   * The hangar's code box (menus.js, through extensions.js' code hook). An
   * admin code makes this device an admin, and says so; anything else is not
   * this feature's (null), and the ordinary codes answer it — the same
   * answer for every wrong code.
   */
  async tryCode(typed) {
    const key = await AdminKey.fromCode(typed);
    if (!key) return null;
    this.adminKey = key;
    key.save();
    this.note('this device is an admin now');
    // Hosting right now: the host is its own server, so it is an admin here at once. A player is checked from the next game.
    if (this.role === 'host' && this.host && !this.host.closed) {
      this.host.me.admin = true;
      this.host._rosterDirty = true;
      this.syncSelf();
      return { ok: true, note: 'Admin is on for this device — open the player list (Tab) for the admin menu.' };
    }
    const inGame = this.role || this.lobby;
    return {
      ok: true,
      note: inGame
        ? 'Admin is on for this device — it works from the next game you join.'
        : 'Admin is on for this device. In any game, open the player list (Tab) for the admin menu.',
    };
  }

  /** Admin off on this device. */
  adminOff() {
    AdminKey.forget();
    this.adminKey = null;
    this.stopWatchingPrivates();
    this.note('admin turned off on this device');
    if (this.lobbyScreen) this.lobbyScreen.refresh();
  }

  /** What the host says about this player right now, and what this device does about it: freeze and unfreeze. */
  syncSelf() {
    let me = { admin: false, muted: false, frozen: false };
    if (this.role === 'host' && this.host) {
      const m = this.host.me;
      me = { admin: !!m.admin, muted: !!m.muted, frozen: m.frozenUntil > now() };
    } else if (this.role === 'client' && this.client && this.client.self) me = { ...this.client.self };
    const was = this.me;
    this.me = me;
    if (me.frozen && !was.frozen) {
      this._frozeAt = now();
      this.toast(`An admin has frozen you for ${Math.round(FREEZE_MS / 1000)} seconds — hang on, you’ll be let go`, 'warn', 5);
    } else if (!me.frozen && was.frozen) {
      this.holdStill(false);
      this.toast('You can move again', 'good', 3);
    }
    if (me.muted && !was.muted) this.toast('An admin has muted your chat for now', 'warn', 5);
    else if (!me.muted && was.muted) this.toast('Your chat is back on', 'good', 3);
    if (me.admin && !was.admin) this.note('the host checked this device’s admin key');
  }

  /**
   * Held still, or let go. The aeroplane's (and the boat's or car's) own
   * step does nothing while held (gateStep), so the world goes on around a
   * player who is simply not moving — not crashed, not paused, and carrying
   * on at the same speed when let go.
   */
  holdStill(on) {
    const sim = this.sim;
    if (!this._held) this._held = new Set();
    if (on && sim) {
      for (const v of [sim.aircraft, sim.vehicle]) {
        if (!v || typeof v !== 'object' || typeof v.update !== 'function') continue;
        gateStep(v);
        v._mpHeld = true;
        this._held.add(v);
      }
      return;
    }
    if (!on) {
      for (const v of this._held) v._mpHeld = false;
      this._held.clear();
    }
  }

  /** An admin's request: done by this tab if it hosts, or asked of the host. The host checks either way. */
  adminAct(op, id) {
    if (!this.me.admin) return false;
    const done = this.role === 'host' && this.host ? this.host.adminAct(op, id) : this.role === 'client' && this.client ? this.client.adminAct(op, id) : false;
    this.note(`admin: ${op} ${id}${done ? '' : ' (not done)'}`);
    return done;
  }

  /** On the host's screen: what an admin did here, for everybody's sake said as it is. */
  adminSaid(a) {
    if (!a) return;
    this.note(`admin ${a.by}: ${a.op} ${a.name || ''}`);
    const who = a.name || 'somebody';
    const words = {
      kick: `${who} was taken out by an admin`, mute: `An admin muted ${who}’s chat`, unmute: `${who}’s chat is back on`,
      freeze: `An admin froze ${who} for ${Math.round(FREEZE_MS / 1000)} s`, unfreeze: `${who} can move again`,
    }[a.op];
    if (words && a.id !== 0) this.toast(words, 'info', 4);
    this.syncSelf();
  }

  /** This tab hosted, and an admin took it out of the lobby, or closed the game. */
  removedByAdmin(why) {
    if (this.lobby) {
      const m = this.lobby;
      const n = m.n;
      this.lobby = null;
      m.leave();
      this.cleanup();
      if (why === 'shut') this.backToLobbies(`An admin closed Lobby ${n} for now — everybody is back here. Pick a lobby to fly again.`);
      else {
        this._barred = { n, until: now() + 120000 };
        const said = `An admin took you out of Lobby ${n} — you can keep flying on your own, or join another lobby.`;
        this.toast(said, 'warn', 7);
        if (this.lobbyScreen) this.lobbyScreen.status(said, 'warn');
      }
      return;
    }
    if (this.role !== 'host') return;
    const sockets = this.hostSockets;
    setTimeout(() => {
      for (const x of sockets) x.sig.close();
    }, 400);
    this.cleanup();
    this.backToLobbies('An admin closed your game for now — pick a lobby to fly again.');
  }

  /** Back to the lobby list, with a kind word on it — where an admin closing a game sends everybody. */
  backToLobbies(words) {
    const sim = this.sim;
    this.note(`back to the lobby list: ${words}`);
    this.toast(words, 'info', 7);
    try {
      if (sim && (sim.state === 'flying' || sim.state === 'paused') && typeof sim.quitToMenu === 'function') sim.quitToMenu('main');
    } catch (err) {
      console.warn('[mp] back to the menu', err);
    }
    this.openLobbies();
    if (this.lobbyScreen) this.lobbyScreen.status(words, 'warn');
  }

  /** The admin's list of private matches on the lobby screen, kept up to date while it is open. */
  async watchPrivates() {
    if (!this.isAdmin || this.privateWatch || this._privLooking) return;
    this._privLooking = true;
    try {
      await this.ensureBackend();
      const net = await this.ensureLookSocket().catch(() => null);
      if (!net || !this.lobbyScreenOpen || !this.isAdmin || this.privateWatch) return;
      this.privateWatch = new PrivateWatch({ net, onChange: (places) => this.lobbyScreen && this.lobbyScreen.privates(places) });
      this.lobbyScreen.privates(this.privateWatch.places);
      this.privateWatch.start();
    } finally {
      this._privLooking = false;
    }
  }

  stopWatchingPrivates() {
    if (this.privateWatch) this.privateWatch.stop();
    this.privateWatch = null;
    if (this.lobbyScreen) this.lobbyScreen.privates(null);
  }

  /** An admin joins private match n of the directory, without its code. */
  joinPrivate(n) {
    const ui = this.lobbyScreen;
    if (!this.isAdmin) return ui && ui.status('Only an admin can join a private match without its code.', 'warn');
    if (!pdirOf(pdirId(n))) return undefined;
    if (!this.profile.chosen) return ui && ui.status('Pick your username first — then you can join.', 'warn');
    return this.join(pdirId(n));
  }

  /** Every frame the game is running. */
  frame(dt) {
    const t = now();
    const s = this.session;
    // Frozen by an admin: the aeroplane (or boat, or car) is held where it is — its own step does nothing until let go.
    if (this.me.frozen) this.holdStill(true);
    if (s) {
      let buf = null;
      /*
       * Fifteen a second on a clock of its own, not "66 ms since the last
       * one": that rule sent every other frame at 30 fps but every THIRD at
       * 20-29 fps — 10 Hz on a school Chromebook, measured 13.4 Hz with
       * frame jitter in the lag bench (tests/features/multiplayer.lag.mjs),
       * 14.8 Hz this way. After a stall it starts again rather than burst.
       */
      const period = 1000 / STATE_HZ;
      if (this.ready && !this.transition && t >= this._nextSend) {
        this._nextSend += period;
        if (this._nextSend < t - period) this._nextSend = t + period;
        this._lastSend = t;
        buf = this.myState(t);
      }
      s.tick(t, buf);
      this._lastTick = t;
    }
    this._dots = this.remotes.players.size ? this.remotes.update(dt, t, this.sim, !(this.sim.hud && this.sim.hud.hidden)) : NO_DOTS;
    if (this.hud) {
      this.hud.el.style.visibility = this.sim.hud && this.sim.hud.hidden ? 'hidden' : '';
      this.hud.place(this.sim);
      this.hud.minimap(this.sim, this._dots, this.minimapExtras);
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
    // An admin's list of private matches: while the lobby screen is open.
    if (this.privateWatch && !this.lobbyScreenOpen) this.stopWatchingPrivates();
    // A freeze the host has not been heard to let go of (a host gone mid-freeze): let go after the most it can be.
    if (this.me.frozen && now() - this._frozeAt > FREEZE_MS + 5000) {
      this.me = { ...this.me, frozen: false };
      this.holdStill(false);
    }
    // And the lobby lists the same way.
    if ((this.lobbyWatch || this.worldWatch) && !this.lobbyScreenOpen) {
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

/*
 * The keys, in the one registry: Settings → Controls → Multiplayer & PvP.
 * The quick-chat lines keep their default keys in QUICK_CHAT (protocol.js);
 * the player can move them here.
 */
const MP_ACTIONS = {
  mpPlayers: { label: 'Multiplayer: player list (hold)', group: 'Multiplayer & PvP', ctx: ['plane', 'heli', 'boat', 'car'], default: ['Tab'] },
};
QUICK_CHAT.forEach((c, i) => {
  if (c.key) MP_ACTIONS[`mpChat${i + 1}`] = { label: `Quick chat: ${c.text}`, group: 'Multiplayer & PvP', ctx: ['plane', 'heli', 'boat', 'car'], default: [c.key] };
});
registerActions(MP_ACTIONS);
const CHAT_ACTIONS = Object.keys(MP_ACTIONS).filter((a) => a !== 'mpPlayers');

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
  // Part 3b: the hangar's code box. An admin code is this feature's; anything else, null, and the ordinary codes answer.
  code(sim, typed) {
    if (!multiplayer.installed || !adminCrypto()) return null;
    return multiplayer.tryCode(typed);
  },
  key(sim, code, down, e) {
    // Tab let go after the game was left with it held down (Leave, in the list): the mouse still has to come back.
    if (isKey(sim, 'mpPlayers', code) && !down && multiplayer._mouseFreed && !multiplayer.role) {
      multiplayer.freeMouse(false);
      return true;
    }
    if (!multiplayer.role) return false;
    if (isKey(sim, 'mpPlayers', code)) {
      multiplayer.hud.hold(down);
      multiplayer.freeMouse(down);
      return true;
    }
    const a = CHAT_ACTIONS.find((id) => isKey(sim, id, code));
    const i = a ? Number(a.slice(6)) - 1 : -1;
    if (i >= 0) {
      if (down && !(e && e.repeat)) multiplayer.chat(i);
      return true;
    }
    return false;
  },
  devActions: [
    {
      label: 'Multiplayer lobbies',
      hint: 'Five Wi-Fi lobbies and five World lobbies, eight each, and choosing your username',
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

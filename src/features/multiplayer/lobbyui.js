/**
 * The lobby screen: your username, the five lobbies, and a friend somewhere
 * else by code.
 *
 * YOUR USERNAME. A player chooses it — the first time they open Multiplayer,
 * and whenever they like after — from two lists and an optional number, with
 * a search box over each list, a live preview and "Surprise me". It is saved
 * on the device and used everywhere: over their aeroplane, in the player
 * list, in quick chat. The search boxes only filter the lists on this screen;
 * what they hold is never a name, never saved and never sent. There is no
 * box anywhere that makes a name.
 *
 * YOUR RIDE (list 2, "the same planes"): every aeroplane the player can fly,
 * the helicopter, the boat and the car, the same list from all four games'
 * menus. It is what they arrive in, in a lobby or a private match.
 *
 * THE LOBBIES. Two rows of five, always listed, each card with its fixed
 * name, its island (list 3: every lobby has its own, always the same, with
 * the Maps screen's picture of it), how many are in it out of eight, and
 * Join. One tap joins, and takes you to that island. Nobody makes, names,
 * locks or hides one.
 *
 *   Wi-Fi lobbies — people on your network: the five on this Wi-Fi.
 *   World lobbies — anyone, anywhere (list 3, "beyond LAN", "palo alto to
 *     berkeley"): five that are the same for everybody on the internet, with
 *     the same rules — usernames from the lists, quick chat only, eight.
 *
 * PRIVATE MATCH (list 2, "able to create private matches"): beside the
 * lobbies, not folded away under "a friend on a different Wi-Fi" as it was.
 * "Before you make a private game, you can choose the map": the card opens
 * on a picker — a tile for every island that suits your ride, with its
 * picture (the Maps screen's own), its name and its one line — starting on
 * the island you are on, and the button says where: "Make it on Harrier
 * Flats". You get a code of two words and a number; only somebody with the
 * code can join, eight at most, one username to one player, and everybody
 * who joins is taken to that island. It is on no list anywhere.
 *
 * ADMIN (part 3b), on a device where the admin code was typed in the hangar:
 * a box under the private match that says this device is an admin, lists
 * the private matches going on now (the directory, lobby.js PrivateWatch —
 * how many and which island, never a code) with Join, which gets in without
 * the code, and turns admin off. Nobody else sees any of it.
 *
 * The screen is a menu screen like the others (see ui.js), built once and
 * written into, never rebuilt, so a button under the pointer is never
 * replaced between a press and its release.
 */

import {
  COLOURS, COLOUR_NAMES, CALLSIGN_ADJECTIVES, CALLSIGN_NOUNS, CALLSIGN_NUMBERS, CODE_EXAMPLE, CODE_TYPED_MAX, LOBBY_COUNT, LOBBY_MAX, WORLD_COUNT,
  BUMP_RULES, BUMP_LABEL, BUMP_SHORT, BUMP_DEFAULT,
  parseCallSign, formatCallSign, randomCallSign, mapNameFor, escapeHtml, lobbyName, lobbyMap, worldName, worldMap, lobbyLabel, normaliseCode, shownCode,
} from './protocol.js';
import { icon } from '../../ui/icons.js';

const STYLE_ID = 'ifs-mp-lobby-style';
const CSS = `
.mp-lobbies .mp-usercard { margin-bottom: 16px; }
.mp-userhead { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
.mp-userhead .mp-callsign strong { font-size: 24px; }
.mp-userhead .hint { margin: 2px 0 0; }
.mp-userpick[hidden] { display: none !important; }
.mp-userpick { margin-top: 12px; display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 10px; align-items: start; }
.mp-picker { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.mp-picker label, .mp-numpick label { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); }
.mp-picker .mp-input { flex: none; padding: 7px 10px; font-size: 14px; }
.mp-words { height: 168px; overflow-y: auto; display: flex; flex-wrap: wrap; align-content: flex-start; gap: 5px; padding: 6px;
  border-radius: 10px; border: 1px solid var(--panel-line); background: rgba(255, 255, 255, 0.04); overscroll-behavior: contain; }
.mp-lobbies .mp-words button { font: inherit; font-size: 13px; padding: 5px 9px; border-radius: 8px; border: 1px solid transparent;
  background: rgba(255, 255, 255, 0.07); color: var(--text); cursor: pointer; }
.mp-lobbies .mp-words button:hover { border-color: rgba(88, 198, 255, 0.5); }
.mp-lobbies .mp-words button.is-on { background: var(--accent); color: #0b1220; font-weight: 650; }
.mp-words button[hidden] { display: none !important; }
.mp-words .mp-none { font-size: 12.5px; color: var(--text-dim); padding: 4px; }
.mp-numpick { display: flex; flex-direction: column; gap: 6px; }
.mp-numpick .mp-select { flex: none; }
.mp-userbtns { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
.mp-lobbylist { display: grid; grid-template-columns: repeat(${LOBBY_COUNT}, minmax(0, 1fr)); gap: 10px; }
.mp-lobby { display: flex; flex-direction: column; gap: 4px; min-height: 150px; padding: 12px; border-radius: 12px;
  border: 1px solid rgba(140, 180, 230, 0.3); background: var(--panel); color: var(--text-dim); font-size: 12.5px; }
.mp-lobby .mp-slot-n { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; }
.mp-lobby strong { color: var(--text); font-size: 14.5px; font-weight: 650; line-height: 1.2; }
.mp-lobby em { font-style: normal; }
.mp-lobby .mp-count { font-variant-numeric: tabular-nums; color: var(--text); font-weight: 650; }
.mp-lobby .mp-bar { height: 5px; border-radius: 3px; background: rgba(255, 255, 255, 0.08); overflow: hidden; }
.mp-lobby .mp-bar i { display: block; height: 100%; background: var(--accent); border-radius: 3px; transition: width 0.3s; }
.mp-lobby.is-full .mp-bar i { background: var(--amber); }
.mp-lobby.is-empty { border-style: dashed; background: rgba(255, 255, 255, 0.03); }
.mp-lobby.is-open { border-color: rgba(88, 198, 255, 0.5); }
.mp-lobby button.primary { margin-top: auto; width: 100%; padding: 8px 10px; }
.mp-lobby button.primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
/* A private match, shown in the lobby list like any lobby (list 2: "display private lobbies normally"). */
.mp-lobbylist.has-private { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); }
.mp-lobby.is-private { border-style: solid; border-color: rgba(167, 139, 250, 0.6); background: var(--panel); }
.mp-lobby.is-private .mp-slot-n { color: #cdbcff; }
.mp-lobby.is-private .mp-pv-code { white-space: nowrap; }
.mp-lobby.is-private .mp-bar i { background: #a78bfa; }
.mp-lobby .mp-crown { margin-right: 4px; }
.mp-lobby .mp-anywifi { font-size: 11.5px; color: var(--text-dim); }
.mp-lobby[hidden] { display: none !important; }
/* List 3: each lobby's island, with its picture; and the two rows. */
.mp-lhead { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: 2px 9px; align-items: center; }
.mp-lhead .mp-thumb { grid-row: 1 / 3; width: 44px; height: 44px; border-radius: 9px; overflow: hidden; background: rgba(40, 90, 140, 0.5); }
.mp-lhead .mp-thumb canvas { display: block; width: 44px; height: 44px; }
.mp-lobby .mp-isle { color: var(--text); font-weight: 600; font-size: 12.5px; line-height: 1.25; }
.mp-lobby .mp-fit { font-size: 11.5px; color: var(--amber, #ffb84d); }
.mp-lobby .mp-fit:empty { display: none; }
.mp-rowhead .mp-rowtitle { display: inline-flex; align-items: center; gap: 8px; }
.mp-rowhead .mp-rowicon { display: inline-flex; color: var(--accent); }
.mp-worldhead { margin-top: 20px; }
.mp-lobby.is-world .mp-slot-n { color: #9fe3c0; }
.mp-lobby.is-world.is-open { border-color: rgba(79, 214, 132, 0.55); }
.mp-lobby.is-world .mp-bar i { background: #4fd684; }
.mp-offer[hidden] { display: none !important; }
.mp-offer { margin-top: 10px; }
.mp-lobbies .mp-ridecard { margin-bottom: 16px; }
.mp-rides { display: flex; flex-wrap: wrap; gap: 6px; }
.mp-lobbies .mp-rides button { display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 13px; padding: 6px 10px;
  border-radius: 999px; border: 1px solid var(--panel-line); background: rgba(255, 255, 255, 0.06); color: var(--text); cursor: pointer; }
.mp-lobbies .mp-rides button:hover { border-color: rgba(88, 198, 255, 0.55); }
.mp-lobbies .mp-rides button.is-on { background: var(--accent); border-color: var(--accent); color: #0b1220; font-weight: 650; }
.mp-rides .mp-ridegap { width: 1px; align-self: stretch; margin: 2px 4px; background: var(--panel-line); }
.mp-ridenote { margin: 10px 0 0; font-size: 12.5px; color: var(--text-dim); }
.mp-privhead { margin-top: 22px; }
.mp-lobbies .mp-grid.mp-private { align-items: start; }
.mp-private .mp-card { display: flex; flex-direction: column; }
.mp-mappick { display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 8px; max-height: 262px; overflow-y: auto;
  padding: 2px; margin-bottom: 12px; overscroll-behavior: contain; }
.mp-lobbies .mp-mappick button { display: grid; grid-template-columns: 52px minmax(0, 1fr); gap: 4px 9px; align-items: center; text-align: left;
  font: inherit; padding: 7px; border-radius: 11px; border: 1px solid var(--panel-line); background: rgba(255, 255, 255, 0.05); color: var(--text); cursor: pointer; }
.mp-lobbies .mp-mappick button:hover { border-color: rgba(88, 198, 255, 0.55); }
.mp-lobbies .mp-mappick button.is-on { border-color: var(--accent); background: rgba(88, 198, 255, 0.16); box-shadow: 0 0 0 1px var(--accent) inset; }
.mp-mappick canvas, .mp-mappick .mp-mapblank { grid-row: 1 / 3; width: 52px; height: 52px; border-radius: 9px; display: block; background: rgba(40, 90, 140, 0.5); }
.mp-mappick strong { font-size: 13.5px; font-weight: 650; line-height: 1.15; overflow-wrap: anywhere; }
.mp-mappick em { font-style: normal; font-size: 11.5px; line-height: 1.25; color: var(--text-dim); align-self: start; }
.mp-mappick .mp-here { color: var(--accent); font-weight: 600; }
.mp-private .mp-row { justify-content: flex-start; }
.mp-privnow[hidden] { display: none; }
.mp-privnow { margin: 0 0 10px; font-size: 13.5px; color: var(--text); }
.mp-privnow b { font-family: var(--mono); }
.mp-adminbox[hidden] { display: none !important; }
.mp-adminbox .mp-lobbylist { grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); margin: 8px 0 10px; }
.mp-adminbox .mp-lobby { min-height: 118px; }
.mp-adminbox .mp-lobby.is-adminpriv { border-color: rgba(255, 90, 79, 0.55); }
.mp-adminbox .mp-privnone[hidden] { display: none; }
/* List 2, part 2: PvP, the bumping rule on every card, and a race course. */
.mp-lobbies .mp-pvpcard { margin-bottom: 16px; }
.mp-racecard .hint { margin-top: 0; }
.mp-racecard .mp-row { justify-content: flex-start; flex-wrap: wrap; }
.mp-pvprow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; }
.mp-pvprow .hint { margin: 0; flex: 1 1 260px; }
.mp-switch { display: inline-flex; border-radius: 999px; border: 1px solid var(--panel-line); background: rgba(255, 255, 255, 0.05); padding: 3px; gap: 3px; }
.mp-lobbies .mp-switch button { font: inherit; font-size: 13.5px; font-weight: 650; min-width: 62px; padding: 6px 14px; border-radius: 999px;
  border: 0; background: transparent; color: var(--text-dim); cursor: pointer; }
.mp-lobbies .mp-switch button.is-on { background: var(--accent); color: #0b1220; }
.mp-lobbies .mp-switch button[data-mp-pvp="on"].is-on { background: #ff7a59; color: #1a0b06; }
.mp-lobby .mp-rule { font-style: normal; font-size: 11.5px; color: var(--text-dim); display: flex; align-items: center; gap: 5px; }
.mp-lobby .mp-rule i { font-style: normal; }
.mp-bumppick { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; }
.mp-bumppick > span { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); width: 100%; }
.mp-lobbies .mp-bumppick button { font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 999px; border: 1px solid var(--panel-line);
  background: rgba(255, 255, 255, 0.05); color: var(--text); cursor: pointer; }
.mp-lobbies .mp-bumppick button.is-on { background: var(--accent); border-color: var(--accent); color: #0b1220; font-weight: 650; }
@media (max-width: 860px) {
  .mp-lobbylist { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mp-userpick { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .mp-numpick { grid-column: 1 / -1; }
}
@media (max-width: 480px) { .mp-lobbylist, .mp-userpick { grid-template-columns: 1fr; } .mp-lobby { min-height: 0; } }
`;

/* The two rows' marks: a Wi-Fi fan and a globe, drawn like the game's own icons (ui/icons.js). */
const svg = (body) => `<svg class="icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
const WIFI_ICON = svg('<path d="M2.5 9a14 14 0 0 1 19 0"/><path d="M5.5 12.5a9.5 9.5 0 0 1 13 0"/><path d="M8.7 16a5 5 0 0 1 6.6 0"/><circle cx="12" cy="19.3" r="0.9" fill="currentColor"/>');
const GLOBE_ICON = svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3z"/>');

function injectLobbyStyle() {
  if (typeof document === 'undefined' || !document.head || document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = CSS;
  document.head.appendChild(s);
}

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

export function buildLobbyScreen(ctrl) {
  injectLobbyStyle();
  const s = h(`
    <section class="screen screen-list mp-screen mp-lobbies" data-screen="lobbies" hidden>
      <header class="screen-head">
        <button class="ghost" data-mp-back>← Back</button>
        <h2>Multiplayer</h2>
        <span></span>
      </header>
      <p class="hint">Lobbies are always open, up to eight players in each, and every lobby has its own island. Everybody sees everybody and you can bump into each other — switch PvP on to tag each other too. Chat is quick messages only.</p>

      <div class="mp-card mp-usercard">
        <h3>Your username</h3>
        <div class="mp-userhead">
          <div class="mp-callsign"><small data-mp-user-label>This is you</small><strong data-mp-user aria-live="polite"></strong>
            <p class="hint" data-mp-user-hint>Everybody sees it over your plane, in the player list and in chat.</p></div>
          <button class="ghost mp-dice" data-mp-user-change>Change</button>
          <div class="mp-swatches" role="group" aria-label="Your plane’s colour">
            ${COLOURS.map((c, i) => `<button class="mp-swatch" data-mp-colour="${c}" style="background:${c}" title="${COLOUR_NAMES[i]}" aria-label="${COLOUR_NAMES[i]}"></button>`).join('')}
          </div>
        </div>
        <div class="mp-userpick" data-mp-userpick hidden>
          <div class="mp-picker">
            <label for="mp-find-adj">First word</label>
            <input class="mp-input" id="mp-find-adj" type="search" data-mp-find="adj" maxlength="12" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Find a word…" aria-label="Find a first word">
            <div class="mp-words" data-mp-words="adj" role="listbox" aria-label="First word">
              ${CALLSIGN_ADJECTIVES.map((w) => `<button type="button" role="option" data-mp-word="${w}">${w}</button>`).join('')}
              <span class="mp-none" hidden>No word like that — try another.</span>
            </div>
          </div>
          <div class="mp-picker">
            <label for="mp-find-noun">Animal, aircraft or thing</label>
            <input class="mp-input" id="mp-find-noun" type="search" data-mp-find="noun" maxlength="12" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Find a word…" aria-label="Find an animal, aircraft or thing">
            <div class="mp-words" data-mp-words="noun" role="listbox" aria-label="Animal, aircraft or thing">
              ${CALLSIGN_NOUNS.map((w) => `<button type="button" role="option" data-mp-word="${w}">${w}</button>`).join('')}
              <span class="mp-none" hidden>No word like that — try another.</span>
            </div>
          </div>
          <div class="mp-numpick">
            <label for="mp-num">Number</label>
            <select class="mp-select" id="mp-num" data-mp-num aria-label="Number (you don’t need one)">
              <option value="0">No number</option>${CALLSIGN_NUMBERS.map((n) => `<option value="${n}">${n}</option>`).join('')}
            </select>
          </div>
          <div class="mp-userbtns">
            <button class="ghost mp-dice" data-mp-surprise><span aria-hidden="true">🎲</span>Surprise me</button>
            <button class="primary" data-mp-user-done>That’s me</button>
          </div>
        </div>
      </div>

      <div class="mp-card mp-ridecard">
        <h3>Your ride</h3>
        <p class="hint">Bring any of these into a lobby or a private match, from any game. Everybody sees what you’re in.</p>
        <div class="mp-rides" role="radiogroup" aria-label="Your ride" data-mp-rides></div>
        <p class="mp-ridenote" data-mp-ridenote></p>
      </div>

      <div class="mp-card mp-pvpcard">
        <h3>PvP — tag other players</h3>
        <div class="mp-pvprow">
          <div class="mp-switch" role="radiogroup" aria-label="PvP">
            <button type="button" role="radio" data-mp-pvp="off">OFF</button><button type="button" role="radio" data-mp-pvp="on">ON</button>
          </div>
          <p class="hint" data-mp-pvphint></p>
        </div>
      </div>

      <h3 class="fail-heading mp-lanhead mp-rowhead" data-mp-wifihead><span class="mp-rowtitle"><span class="mp-rowicon">${WIFI_ICON}</span>Wi-Fi lobbies — people on your network</span>
        <span class="mp-net" data-mp-net><span class="mp-dot"></span><span data-mp-net-text>Finding your Wi-Fi…</span></span>
      </h3>
      <p class="hint">Everybody on the same Wi-Fi as you. Each lobby has its own island, and joining takes you there. <span data-mp-joinas></span></p>
      <div class="mp-lobbylist" data-mp-lobbylist></div>

      <h3 class="fail-heading mp-lanhead mp-rowhead mp-worldhead" data-mp-worldhead><span class="mp-rowtitle"><span class="mp-rowicon">${GLOBE_ICON}</span>World lobbies — anyone, anywhere</span>
        <span class="mp-net" data-mp-world-net><span class="mp-dot"></span><span data-mp-world-net-text>Looking for the world lobbies…</span></span>
      </h3>
      <p class="hint">Play with people who aren’t on your Wi-Fi — across town or across the world. The same rules as every lobby: usernames from the lists, quick chat only, eight at most.</p>
      <div class="mp-lobbylist mp-worldlist" data-mp-worldlist></div>
      <div class="mp-offer" data-mp-offer hidden><button class="primary" data-mp-offer-go></button></div>
      <p class="mp-status" data-mp-status role="status" aria-live="polite"></p>

      <h3 class="fail-heading mp-lanhead mp-privhead">Private match</h3>
      <p class="hint">Only friends who have the code can join — up to eight. <b>Works with friends who aren’t on your Wi-Fi.</b> It isn’t on any list.</p>
      <div class="mp-grid mp-private">
        <div class="mp-card">
          <h3>Make a private match</h3>
          <p class="hint">First pick the island you’ll all play on. Then you get a code — two words and a number — to tell your friends.</p>
          <div class="mp-mappick" role="radiogroup" aria-label="Island for your private match" data-mp-private-maps></div>
          <div class="mp-bumppick" role="radiogroup" aria-label="Bumping into each other" data-mp-bumppick><span>Bumping into each other</span>${BUMP_RULES.slice().reverse().map((r) => `<button type="button" role="radio" data-mp-bump="${BUMP_RULES.indexOf(r)}">${escapeHtml(BUMP_LABEL[r])}</button>`).join('')}</div>
          <p class="mp-privnow" data-mp-privnow hidden></p>
          <div class="mp-row">
            <button class="primary" data-mp-private>Make it</button>
          </div>
        </div>
        <div class="mp-card">
          <h3>Join a private match</h3>
          <p class="hint">Type the code a friend tells you, like ${CODE_EXAMPLE} — their match shows up with the lobbies. Works with friends who aren’t on your Wi-Fi.</p>
          <div class="mp-row">
            <input class="mp-input mp-code" data-mp-code maxlength="${CODE_TYPED_MAX}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${CODE_EXAMPLE}" aria-label="Join code">
            <button class="primary" data-mp-join-code>Join</button>
          </div>
        </div>
      </div>

      <h3 class="fail-heading mp-lanhead mp-privhead">Ring Rally — a race</h3>
      <div class="mp-card mp-racecard">
        <p class="hint">Eight big rings round <b>Coral Atoll</b>, two laps, a start grid on the runway — 3, 2, 1, GO! In any lobby or private match on Coral Atoll, tap <b>🏁 Race</b> on the badge and everybody flying goes on the grid. Planes and the helicopter race.</p>
        <div class="mp-row">
          <button class="primary" data-mp-race-alone>🏁 Race alone</button>
          <button class="ghost" data-mp-race-pick>Pick Coral Atoll for a private match</button>
        </div>
      </div>

      <div class="mp-adminbox" data-mp-adminbox hidden>
        <h3 class="fail-heading mp-lanhead mp-privhead">Admin <b class="mp-admintag">ADMIN</b></h3>
        <p class="hint">This device is an admin. In any game, the player list (<kbd>Tab</kbd>) has the admin menu — and everybody sees an ADMIN badge on you. Private matches going on now; join one without its code:</p>
        <div class="mp-lobbylist" data-mp-privlist></div>
        <p class="hint tiny mp-privnone" data-mp-privnone>Looking for private matches…</p>
        <button class="ghost" data-mp-admin-off>Turn admin off on this device</button>
      </div>
    </section>
  `);

  if (ctrl.racesCard) ctrl.racesCard(s); // ../race.js makes the race card the Races card: one race for every ride
  const $ = (sel) => s.querySelector(sel);
  const userOut = $('[data-mp-user]');
  const userLabel = $('[data-mp-user-label]');
  const pickBox = $('[data-mp-userpick]');
  const changeBtn = $('[data-mp-user-change]');
  const numSel = $('[data-mp-num]');
  const codeIn = $('[data-mp-code]');
  const joinAs = $('[data-mp-joinas]');
  const offerBox = $('[data-mp-offer]');
  const offerBtn = $('[data-mp-offer-go]');
  const lists = { adj: $('[data-mp-words="adj"]'), noun: $('[data-mp-words="noun"]') };
  const ridesEl = $('[data-mp-rides]');
  const rideNote = $('[data-mp-ridenote]');
  const privMaps = $('[data-mp-private-maps]');
  const privBtn = $('[data-mp-private]');
  const privNow = $('[data-mp-privnow]');
  const bumpPick = $('[data-mp-bumppick]');
  const pvpHint = $('[data-mp-pvphint]');
  /** The island picked for a private match: kept while it suits the ride, else the island you're on. */
  let privPick = null;
  const finds = { adj: $('[data-mp-find="adj"]'), noun: $('[data-mp-find="noun"]') };
  let offer = null;

  const current = () => parseCallSign(ctrl.profile.name) || { adjective: CALLSIGN_ADJECTIVES[0], noun: CALLSIGN_NOUNS[0], number: 0 };

  const paintWords = (scroll = false) => {
    const cs = current();
    for (const [kind, want] of [['adj', cs.adjective], ['noun', cs.noun]]) {
      for (const b of lists[kind].querySelectorAll('[data-mp-word]')) {
        const on = b.dataset.mpWord === want;
        b.classList.toggle('is-on', on);
        b.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on && scroll && !b.hidden) b.scrollIntoView({ block: 'nearest' });
      }
    }
    numSel.value = String(cs.number);
  };
  const paintUser = () => {
    const inGame = !!(ctrl.role || ctrl.lobby);
    setText(userOut, ctrl.profile.name || '');
    setText(userLabel, ctrl.profile.chosen ? 'This is you' : 'Pick your username');
    for (const b of s.querySelectorAll('[data-mp-colour]')) b.classList.toggle('is-on', b.dataset.mpColour === ctrl.profile.colour);
    // The first time, the pickers are open; after that, behind Change. Not while in a game: the lobby knows you by it.
    if (inGame) pickBox.hidden = true;
    else if (!ctrl.profile.chosen) pickBox.hidden = false;
    changeBtn.hidden = inGame || !pickBox.hidden;
    changeBtn.disabled = inGame;
    setText(joinAs, ctrl.profile.chosen ? `You’ll join as ${ctrl.profile.name}${ctrl.ride && ctrl.rideName ? `, in the ${ctrl.rideName(ctrl.ride())}` : ''}.` : 'Pick your username first.');
    paintWords();
    paintRides();
    paintPrivate();
    paintPvp();
  };
  /* PvP: the player's own switch, OFF until they turn it on (../pvp.js). */
  const paintPvp = () => {
    const on = !!ctrl.profile.pvp;
    for (const b of s.querySelectorAll('[data-mp-pvp]')) {
      const me = (b.dataset.mpPvp === 'on') === on;
      b.classList.toggle('is-on', me);
      b.setAttribute('aria-checked', me ? 'true' : 'false');
    }
    setText(pvpHint, on
      ? 'ON: press Space (or FIRE) to tag players who have PvP on too — and they can tag you. Tagged? You’re back in the air in three seconds.'
      : 'OFF: nobody can tag you and you can’t tag anybody. You can switch it on in the game, too.');
  };
  const filter = (kind) => {
    // ASCII letters only, folded by hand: this is a filter over the list, never a name.
    const q = finds[kind].value.replace(/[^A-Za-z]/g, '').replace(/[A-Z]/g, (c) => c.toLowerCase());
    let shown = 0;
    for (const b of lists[kind].querySelectorAll('[data-mp-word]')) {
      const hit = !q || b.dataset.mpWord.toLowerCase().includes(q);
      if (b.hidden === hit) b.hidden = !hit;
      if (hit) shown++;
    }
    lists[kind].querySelector('.mp-none').hidden = shown > 0;
  };
  /*
   * The ride chips: rebuilt only when what the player can fly changes (an
   * unlock), otherwise written into — the same rule as the lobby cards.
   */
  const RIDE_ICON = { plane: 'plane', heli: 'heli', boat: 'boat', car: 'car' };
  const paintRides = () => {
    const all = ctrl.rides ? ctrl.rides() : [];
    const sig = all.map((r) => `${r.game}:${r.type}`).join('|');
    if (ridesEl._sig !== sig) {
      ridesEl._sig = sig;
      let html = '';
      let last = null;
      for (const r of all) {
        if (last === 'plane' && r.kind !== 'plane') html += '<span class="mp-ridegap" aria-hidden="true"></span>';
        last = r.kind;
        html += `<button type="button" role="radio" data-mp-ride="${escapeHtml(`${r.game}:${r.type}`)}">${icon(RIDE_ICON[r.kind] || 'plane', 16)}${escapeHtml(r.name)}</button>`;
      }
      ridesEl.innerHTML = html;
    }
    const now = ctrl.ride ? ctrl.ride() : null;
    const key = now ? `${now.game}:${now.type}` : '';
    for (const b of ridesEl.querySelectorAll('[data-mp-ride]')) {
      const on = b.dataset.mpRide === key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    }
    const inGame = !!(ctrl.role || ctrl.lobby);
    for (const b of ridesEl.querySelectorAll('button')) b.disabled = inGame;
    setText(rideNote, inGame ? 'You can change it when you leave this game.'
      : now && now.game === 'flight' ? 'Planes take off from the runway. Kestrel Island has room for all four — a runway, a helipad, a harbour and roads.'
        : now && now.game === 'heli' ? 'The helicopter can land almost anywhere.'
          : now && now.game === 'boat' ? 'On an island with no harbour you’ll fly instead.' : 'Cars need roads — on an island with none you’ll fly instead.');
  };
  /*
   * The islands for a private match, as tiles: rebuilt only when the list
   * changes (a different ride, an unlock), and written into otherwise.
   */
  const paintPrivate = () => {
    const now = ctrl.ride ? ctrl.ride() : { game: 'flight' };
    const maps = ctrl.mapsFor ? ctrl.mapsFor(now.game) : [];
    const here = ctrl.privateDefault ? ctrl.privateDefault(now.game) : maps[0] && maps[0].id;
    const sig = `${now.game}|${maps.map((m) => m.id).join(',')}`;
    if (privMaps._sig !== sig) {
      privMaps._sig = sig;
      privMaps.innerHTML = maps.map((m) => `<button type="button" role="radio" data-mp-private-map="${escapeHtml(m.id)}" title="${escapeHtml(m.name)}">`
        + `<span class="mp-mapblank"></span><strong>${escapeHtml(m.name)}</strong><em>${escapeHtml(m.subtitle || '')}</em></button>`).join('');
      // The picture is the Maps screen's own, painted from the terrain's island list.
      for (const b of privMaps.querySelectorAll('[data-mp-private-map]')) {
        const src = ctrl.mapPicture ? ctrl.mapPicture(b.dataset.mpPrivateMap) : null;
        if (!src || !src.width) continue;
        const c = document.createElement('canvas');
        c.width = c.height = 104;
        const g = c.getContext('2d');
        if (g && typeof g.drawImage === 'function') {
          g.drawImage(src, 0, 0, 104, 104);
          b.replaceChild(c, b.querySelector('.mp-mapblank'));
        }
      }
    }
    if (!privPick || !maps.some((m) => m.id === privPick)) privPick = maps.some((m) => m.id === here) ? here : maps[0] ? maps[0].id : null;
    for (const b of privMaps.querySelectorAll('[data-mp-private-map]')) {
      const on = b.dataset.mpPrivateMap === privPick;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      const em = b.querySelector('em');
      const m = maps.find((x) => x.id === b.dataset.mpPrivateMap);
      const note = ctrl.mapNote ? ctrl.mapNote(b.dataset.mpPrivateMap) : '';
      const line = `${m ? m.subtitle || '' : ''}${note ? ` · ${note}` : ''}${b.dataset.mpPrivateMap === here ? ' · you’re here' : ''}`;
      setText(em, line);
    }
    const pickedName = privPick ? mapNameFor(privPick) : '';
    const inPrivate = !!(ctrl.server && ctrl.server.priv && ctrl.role);
    privNow.hidden = !inPrivate;
    if (inPrivate) privNow.innerHTML = `You’re in a private match on <strong>${escapeHtml(mapNameFor(ctrl.server.map))}</strong>${ctrl.server.code ? ` — code <b>${escapeHtml(ctrl.server.code)}</b>` : ''}.`;
    setText(privBtn, pickedName ? `Make it on ${pickedName}` : 'Make it');
    const busyNow = !!(ctrl.role || ctrl.lobby);
    for (const b of privMaps.querySelectorAll('button')) b.disabled = busyNow;
    privBtn.disabled = busyNow || !privPick;
    const rule = ctrl.bumpPick == null ? BUMP_DEFAULT : ctrl.bumpPick;
    for (const b of bumpPick.querySelectorAll('[data-mp-bump]')) {
      const on = Number(b.dataset.mpBump) === rule;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
      b.disabled = busyNow;
    }
  };

  const pick = (patch) => {
    const cs = { ...current(), ...patch };
    const r = ctrl.setProfile({ name: formatCallSign(cs) });
    if (r.ok) ui.offer(null);
    paintUser();
  };
  for (const kind of ['adj', 'noun']) finds[kind].addEventListener('input', () => filter(kind));
  numSel.addEventListener('change', () => pick({ number: Number(numSel.value) || 0 }));

  codeIn.addEventListener('input', () => {
    const v = codeIn.value.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/[^a-z0-9 -]/g, '').slice(0, CODE_TYPED_MAX);
    if (v !== codeIn.value) codeIn.value = v;
    // A code that is a whole code: look it up, and show the match with the lobbies.
    clearTimeout(lookTimer);
    lookTimer = setTimeout(() => lookPrivate(), 350);
  });
  codeIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ctrl.joinCode(codeIn.value);
  });

  s.addEventListener('click', (e) => {
    const t = e.target;
    if (t.closest('[data-mp-back]')) return ctrl.back();
    const word = t.closest('[data-mp-word]');
    if (word) {
      const kind = word.parentElement === lists.adj ? 'adjective' : 'noun';
      return pick({ [kind]: word.dataset.mpWord });
    }
    if (t.closest('[data-mp-surprise]')) {
      let name = ctrl.profile.name;
      for (let i = 0; i < 5 && name === ctrl.profile.name; i++) name = randomCallSign();
      for (const kind of ['adj', 'noun']) {
        finds[kind].value = '';
        filter(kind);
      }
      ctrl.setProfile({ name });
      ui.offer(null);
      paintUser();
      paintWords(true);
      return;
    }
    if (t.closest('[data-mp-user-done]')) {
      ctrl.setProfile({ name: ctrl.profile.name, chosen: true });
      pickBox.hidden = true;
      paintUser();
      ui.status(`Hello, ${ctrl.profile.name}! Pick a lobby to join.`, 'good');
      ui.lobbies(ctrl.lobbyWatch ? ctrl.lobbyWatch.lobbies : null);
      ui.worlds(ctrl.worldWatch ? ctrl.worldWatch.lobbies : null);
      return;
    }
    if (t.closest('[data-mp-user-change]')) {
      pickBox.hidden = false;
      paintUser();
      paintWords(true);
      return;
    }
    const sw = t.closest('[data-mp-colour]');
    if (sw) {
      ctrl.setProfile({ colour: sw.dataset.mpColour });
      paintUser();
      return;
    }
    const rideBtn = t.closest('[data-mp-ride]');
    if (rideBtn) {
      const [game, type] = rideBtn.dataset.mpRide.split(':');
      if (ctrl.setRide) ctrl.setRide({ game, type });
      paintUser();
      ui.lobbies(ctrl.lobbyWatch ? ctrl.lobbyWatch.lobbies : null);
      ui.worlds(ctrl.worldWatch ? ctrl.worldWatch.lobbies : null);
      return undefined;
    }
    const join = t.closest('[data-mp-lobby-join]');
    if (join) return ctrl.joinLobby(Number(join.dataset.mpLobbyJoin));
    const wjoin = t.closest('[data-mp-world-join]');
    if (wjoin) return ctrl.joinLobby(Number(wjoin.dataset.mpWorldJoin), true);
    if (t.closest('[data-mp-offer-go]') && offer) {
      const o = offer;
      ui.offer(null);
      if (o.kind === 'name') {
        // One tap: take the free username and try again.
        ctrl.setProfile({ name: o.name, chosen: true });
        paintUser();
        return o.n ? ctrl.joinLobby(o.n, !!o.world) : ctrl.join(o.target);
      }
      if (o.kind === 'lobby') return ctrl.joinLobby(o.n, !!o.world);
      return undefined;
    }
    const pvpBtn = t.closest('[data-mp-pvp]');
    if (pvpBtn) {
      if (ctrl.setPvp) ctrl.setPvp(pvpBtn.dataset.mpPvp === 'on');
      paintPvp();
      return undefined;
    }
    const bumpBtn = t.closest('[data-mp-bump]');
    if (bumpBtn) {
      ctrl.bumpPick = Number(bumpBtn.dataset.mpBump);
      paintPrivate();
      return undefined;
    }
    if (t.closest('[data-mp-race-alone]')) {
      if (ctrl.raceAlone) ctrl.raceAlone();
      return undefined;
    }
    if (t.closest('[data-mp-race-pick]')) {
      const maps = ctrl.mapsFor ? ctrl.mapsFor((ctrl.ride ? ctrl.ride() : { game: 'flight' }).game) : [];
      if (maps.some((m) => m.id === 'atoll')) {
        privPick = 'atoll';
        paintPrivate();
        const tileNow = privMaps.querySelector('[data-mp-private-map="atoll"]');
        if (tileNow && tileNow.scrollIntoView) tileNow.scrollIntoView({ block: 'nearest' });
        if (privBtn.scrollIntoView) privBtn.scrollIntoView({ block: 'center' });
        ui.status('Coral Atoll is picked — make your private match, and tell your friends the code.', 'good');
      } else ui.status('Pick a plane or the helicopter as your ride first — races are in the air.', 'warn');
      return undefined;
    }
    const tile = t.closest('[data-mp-private-map]');
    if (tile) {
      privPick = tile.dataset.mpPrivateMap;
      paintPrivate();
      return undefined;
    }
    if (t.closest('[data-mp-private]')) {
      if (!ctrl.profile.chosen) return ui.status('Pick your username first — then you can make a private match.', 'warn');
      const ride = ctrl.ride();
      return ctrl.hostServer({ serverName: ctrl.serverName(), map: privPick || ctrl.defaultMap(ride.game), game: ride.game, privateGame: true, ride, bump: ctrl.bumpPick });
    }
    if (t.closest('[data-mp-join-code]')) {
      if (!ctrl.profile.chosen) return ui.status('Pick your username first — then you can join.', 'warn');
      return ctrl.joinCode(codeIn.value);
    }
    // Part 3b: an admin's join of a private match from the directory, and admin off.
    const pdir = t.closest('[data-mp-pdir-join]');
    if (pdir) return ctrl.joinPrivate(Number(pdir.dataset.mpPdirJoin));
    if (t.closest('[data-mp-admin-off]')) {
      ctrl.adminOff();
      ui.status('Admin is off on this device.', 'good');
      return undefined;
    }
    return undefined;
  });

  const adminBox = $('[data-mp-adminbox]');
  const privList = $('[data-mp-privlist]');
  const privNone = $('[data-mp-privnone]');
  const privCards = new Map();

  const listEl = $('[data-mp-lobbylist]');
  const worldEl = $('[data-mp-worldlist]');
  let lookTimer = null;
  /*
   * One card per lobby, built once and written into. List 3: the island is
   * on the card from the start — its picture, its name — because it is
   * always the same one.
   */
  const makeCard = (n, world) => {
    const home = world ? worldMap(n) : lobbyMap(n);
    const el = h(`<div class="mp-lobby is-looking${world ? ' is-world' : ''}" ${world ? 'data-mp-world' : 'data-mp-lobby'}="${n}">
      <div class="mp-lhead"><span class="mp-thumb" data-mp-thumb></span><span class="mp-slot-n">${escapeHtml(lobbyLabel(n, world))}</span><strong>${escapeHtml(world ? worldName(n) : lobbyName(n))}</strong></div>
      <span class="mp-isle" data-mp-isle>${escapeHtml(mapNameFor(home))}</span><em class="mp-fit" data-mp-fit></em>
      <span><span class="mp-count"></span> <em data-mp-players-word></em></span><span class="mp-bar"><i style="width:0%"></i></span>
      <em data-mp-where></em><em class="mp-rule" data-mp-rule><i aria-hidden="true">💥</i><span></span></em><button class="primary" ${world ? 'data-mp-world-join' : 'data-mp-lobby-join'}="${n}">Join</button></div>`);
    return {
      el, n, world, home, thumbMap: null,
      thumb: el.querySelector('[data-mp-thumb]'), isle: el.querySelector('[data-mp-isle]'), fit: el.querySelector('[data-mp-fit]'),
      count: el.querySelector('.mp-count'), word: el.querySelector('[data-mp-players-word]'), bar: el.querySelector('.mp-bar i'), where: el.querySelector('[data-mp-where]'),
      rule: el.querySelector('[data-mp-rule] span'), join: el.querySelector('button'),
    };
  };
  const cards = [];
  for (let n = 1; n <= LOBBY_COUNT; n++) {
    const c = makeCard(n, false);
    cards.push(c);
    listEl.appendChild(c.el);
  }
  const worldCards = [];
  for (let n = 1; n <= WORLD_COUNT; n++) {
    const c = makeCard(n, true);
    worldCards.push(c);
    worldEl.appendChild(c.el);
  }
  /** The island's picture on a card: the Maps screen's own, copied once it has been painted. */
  const paintThumb = (c, map) => {
    if (c.thumbMap === map) return;
    const src = ctrl.mapPicture ? ctrl.mapPicture(map) : null;
    if (!src || !src.width) return;
    const cv = document.createElement('canvas');
    cv.width = cv.height = 88;
    const g = cv.getContext('2d');
    if (!g || typeof g.drawImage !== 'function') return;
    g.drawImage(src, 0, 0, 88, 88);
    c.thumb.replaceChildren(cv);
    c.thumbMap = map;
  };
  /** What a ride that has no room on an island becomes there — said on the card, before you join. */
  const FIT_WHAT = { flight: 'runway', heli: 'helipad', boat: 'harbour', car: 'roads' };
  const fitNote = (map) => {
    if (!ctrl.rideOn || !ctrl.ride || !ctrl.rideName) return '';
    const fit = ctrl.rideOn(map, 'flight');
    if (!fit || !fit.swapped) return '';
    const want = ctrl.ride();
    return `No ${FIT_WHAT[want.game] || 'room'} for your ${want.game === 'flight' ? 'plane' : want.game === 'heli' ? 'helicopter' : want.game === 'boat' ? 'boat' : 'car'} — you’ll come in the ${ctrl.rideName(fit.ride)}`;
  };
  /**
   * One row of cards from its list (LobbyWatch.lobbies), or null when that
   * row cannot look (`off` says why).
   */
  const paintRow = (row, list, world, off) => {
    // For a full lobby: the one with the most room — somebody to fly with first, then an empty one.
    const room = (except) => {
      const open = (list || []).filter((l) => l.n !== except && (l.state === 'open' || l.state === 'empty'));
      open.sort((a, b) => (a.state === 'empty') - (b.state === 'empty') || a.players - b.players || a.n - b.n);
      return open[0] || null;
    };
    const inGame = !!(ctrl.role || ctrl.lobby);
    for (let i = 0; i < row.length; i++) {
      const c = row[i];
      const l = list && list[i];
      const state = l ? l.state : 'off';
      const cls = `mp-lobby is-${state}${world ? ' is-world' : ''}`;
      if (c.el.className !== cls) c.el.className = cls;
      const map = (l && l.map) || c.home;
      setText(c.isle, mapNameFor(map));
      paintThumb(c, map);
      setText(c.fit, inGame ? '' : fitNote(map));
      const players = l && (state === 'open' || state === 'full') ? l.players : 0;
      const max = (l && l.max) || LOBBY_MAX;
      setText(c.count, !l ? '—' : state === 'looking' || state === 'quiet' ? '…' : `${players}/${max}`);
      setText(c.word, !l ? '' : players === 1 ? 'player' : 'players');
      c.bar.style.width = `${Math.round((players / max) * 100)}%`;
      let where;
      let label = 'Join';
      let target = i + 1;
      let dis = !ctrl.profile.chosen;
      if (!l) {
        where = off || 'Can’t look for lobbies on this network';
        dis = true;
      } else if (state === 'empty') {
        where = 'Nobody here yet — be the first';
        label = 'Start it';
      } else if (state === 'open') where = map !== c.home ? `On ${mapNameFor(map)} for now` : 'Playing now — hop in';
      else if (state === 'full') {
        // Full, said kindly, with somewhere to go instead.
        const other = room(i + 1);
        where = 'Full — eight is the most';
        if (other) {
          label = `Full — join ${lobbyLabel(other.n, world)}`;
          target = other.n;
        } else {
          label = 'Full';
          dis = true;
        }
      } else if (state === 'old') {
        where = 'A different version of the game — reload';
        dis = true;
      } else if (state === 'quiet') where = 'Changing hosts — try in a moment';
      else where = 'Looking…';
      setText(c.where, where);
      // List 2, part 2: the game's bumping rule. The lobbies all play by the default; a host that says otherwise is shown as it says.
      setText(c.rule, l && state === 'old' ? '' : BUMP_SHORT[l && l.bump] || BUMP_SHORT[BUMP_RULES[BUMP_DEFAULT]]);
      setText(c.join, label);
      const key = world ? 'mpWorldJoin' : 'mpLobbyJoin';
      if (c.join.dataset[key] !== String(target)) c.join.dataset[key] = String(target);
      if (c.join.disabled !== dis) c.join.disabled = dis;
    }
  };
  let worldOff = '';

  /*
   * A PRIVATE MATCH, shown like a lobby (list 2: "display private lobbies
   * normally"): the same card, with the lobbies — marked Private and its
   * code, how many are in it out of eight, its island, a crown if it is
   * yours, and Join. It appears for a code typed below (looked up with one
   * ping to the matchmaking server, numbers only, again every three seconds
   * while it is on screen) and for the private match you are hosting.
   */
  // List 3: built like every other lobby card — the island's picture and name, the count, Join — marked Private with its code.
  const pv = h(`<div class="mp-lobby is-private" data-mp-private-card hidden>
    <div class="mp-lhead"><span class="mp-thumb" data-mp-pv-thumb></span><span class="mp-slot-n" data-mp-pv-kicker>Private</span><strong data-mp-pv-title>Private match</strong></div>
    <span class="mp-isle" data-mp-pv-isle></span>
    <span><span class="mp-count" data-mp-pv-count>—</span> <em>players</em></span>
    <span class="mp-bar"><i style="width:0%"></i></span><em data-mp-pv-where></em><em class="mp-rule" data-mp-pv-rule hidden><i aria-hidden="true">💥</i><span></span></em><em class="mp-anywifi">Works with friends who aren’t on your Wi-Fi.</em>
    <button class="primary" data-mp-pv-join>Join</button></div>`);
  listEl.appendChild(pv);
  const pvEls = {
    kicker: pv.querySelector('[data-mp-pv-kicker]'), title: pv.querySelector('[data-mp-pv-title]'), count: pv.querySelector('[data-mp-pv-count]'),
    bar: pv.querySelector('.mp-bar i'), where: pv.querySelector('[data-mp-pv-where]'), join: pv.querySelector('[data-mp-pv-join]'),
    isle: pv.querySelector('[data-mp-pv-isle]'),
    rule: pv.querySelector('[data-mp-pv-rule]'),
  };
  const pvThumb = { thumb: pv.querySelector('[data-mp-pv-thumb]'), thumbMap: null };
  /** What the private card shows: null to hide it, or { code, players, max, map, mapName, mine, full, locked, state }. */
  let pvState = null;
  const paintPrivateCard = () => {
    const st = pvState;
    const show = !!st;
    if (pv.hidden === show) pv.hidden = !show;
    listEl.classList.toggle('has-private', show);
    if (!st) return;
    const code = shownCode(st.code);
    // The code never breaks at its own hyphens ("LAGOON-" / "KITE-44"): if the line is too narrow it breaks after the dot.
    const kick = code ? `Private · <span class="mp-pv-code">${escapeHtml(code)}</span>` : 'Private';
    if (pvEls.kicker.innerHTML !== kick) pvEls.kicker.innerHTML = kick;
    pvEls.title.innerHTML = st.mine ? '<span class="mp-crown" aria-hidden="true">👑</span>Your private match' : 'Private match';
    setText(pvEls.count, st.state === 'here' || st.mine ? `${st.players}/${st.max}` : '—');
    pvEls.bar.style.width = `${Math.round(((st.players || 0) / (st.max || 8)) * 100)}%`;
    const known = st.state === 'here' || st.mine;
    setText(pvEls.isle, known ? st.mapName || 'An island' : '');
    if (known && st.map) paintThumb(pvThumb, st.map);
    setText(pvEls.where, st.state === 'empty' ? 'No game has that code right now — check it with your friend.'
      : st.state === 'offline' ? 'Can’t reach the matchmaking server — try again in a moment.'
        : st.state === 'looking' ? 'Looking…' : st.mine ? 'Only friends with the code can join' : 'Only friends with the code');
    // The game's bumping rule, as its host set it (protocol.js BUMP_RULES).
    const ruleOn = !!(st.bump && (st.state === 'here' || st.mine));
    if (pvEls.rule.hidden === ruleOn) pvEls.rule.hidden = !ruleOn;
    if (ruleOn) setText(pvEls.rule.querySelector('span'), BUMP_SHORT[st.bump] || '');
    let label = 'Join';
    let off = !ctrl.profile.chosen || st.state !== 'here';
    if (st.mine) {
      label = 'You’re hosting it';
      off = true;
    } else if (st.full) {
      label = 'Full';
      off = true;
    } else if (st.locked) {
      label = 'Locked';
      off = true;
    } else if (ctrl.role || ctrl.lobby) off = true;
    setText(pvEls.join, label);
    if (pvEls.join.disabled !== off) pvEls.join.disabled = off;
    pvEls.join.dataset.mpPvCode = code || '';
  };
  /** Look up the code in the box, or show the private match this player hosts. */
  async function lookPrivate() {
    if (ctrl.role === 'host' && ctrl.server && ctrl.server.priv) {
      const list = ctrl.roster ? ctrl.roster() : [];
      pvState = { code: ctrl.server.code, players: list.length || 1, max: ctrl.server.max || 8, map: ctrl.server.map, mapName: mapNameFor(ctrl.server.map), mine: true, state: 'here', bump: BUMP_RULES[ctrl.server.bump == null ? BUMP_DEFAULT : ctrl.server.bump] };
      paintPrivateCard();
      return;
    }
    const code = normaliseCode(codeIn.value);
    if (!code) {
      if (pvState) {
        pvState = null;
        paintPrivateCard();
      }
      return;
    }
    if (!pvState || pvState.code !== code) {
      pvState = { code, players: 0, max: 8, state: 'looking' };
      paintPrivateCard();
    }
    const r = ctrl.lookupCode ? await ctrl.lookupCode(code) : null;
    if (!r || normaliseCode(codeIn.value) !== code) return;
    const c = r.count;
    pvState = { code, state: r.state, players: c ? c.players : 0, max: c ? c.max : 8, map: c && c.map ? c.map : null, mapName: c && c.map ? c.mapName : null, full: !!(c && c.full), locked: !!(c && c.locked), mine: false, bump: c ? c.bump : null };
    paintPrivateCard();
  }
  // Again every three seconds while the screen is up and there is something to show.
  let pvTimer = null;
  const watchPrivate = (on) => {
    clearInterval(pvTimer);
    pvTimer = on ? setInterval(() => {
      if (s.hidden) {
        clearInterval(pvTimer);
        pvTimer = null;
        return;
      }
      lookPrivate();
    }, 3000) : null;
  };
  pvEls.join.addEventListener('click', () => {
    const code = pvEls.join.dataset.mpPvCode;
    if (!code) return;
    if (!ctrl.profile.chosen) return ui.status('Pick your username first — then you can join.', 'warn');
    return ctrl.joinCode(code);
  });

  const ui = {
    el: s,
    /**
     * Part 3b: the admin's list of private matches, from the directory — null
     * hides the box. Only on a device that is an admin.
     */
    privates(places) {
      const on = !!(places && ctrl.isAdmin);
      if (adminBox.hidden === on) adminBox.hidden = !on;
      if (!on) return;
      const found = places.filter((p) => p.state === 'here');
      const looking = places.some((p) => p.state === 'looking');
      privNone.hidden = found.length > 0;
      setText(privNone, looking ? 'Looking for private matches…' : 'No private matches going on right now.');
      for (const [n, c] of privCards) {
        if (!found.some((p) => p.n === n)) {
          c.el.remove();
          privCards.delete(n);
        }
      }
      for (const p of found) {
        let c = privCards.get(p.n);
        if (!c) {
          const el = h(`<div class="mp-lobby is-private is-adminpriv" data-mp-pdir="${p.n}"><span class="mp-slot-n">Private · admin</span><strong>Private match</strong>
            <span><span class="mp-count"></span> <em>players</em></span><span class="mp-bar"><i style="width:0%"></i></span><em data-mp-where></em>
            <em class="mp-rule" data-mp-rule><i aria-hidden="true">💥</i><span></span></em>
            <button class="primary" data-mp-pdir-join="${p.n}">Join without the code</button></div>`);
          c = { el, count: el.querySelector('.mp-count'), bar: el.querySelector('.mp-bar i'), where: el.querySelector('[data-mp-where]'), rule: el.querySelector('[data-mp-rule] span'), join: el.querySelector('button') };
          privCards.set(p.n, c);
          privList.appendChild(el);
        }
        setText(c.count, `${p.players}/${p.max}`);
        c.bar.style.width = `${Math.round((p.players / (p.max || 8)) * 100)}%`;
        setText(c.where, `On ${p.mapName || 'an island'}${p.full ? ' — full' : ''}`);
        setText(c.rule, BUMP_SHORT[p.bump] || '');
        const off = !!(p.full || ctrl.role || ctrl.lobby || !ctrl.profile.chosen);
        if (c.join.disabled !== off) c.join.disabled = off;
      }
    },
    get privateCount() {
      return privCards.size;
    },
    /** The island picked for a private match (for the tests and the controller). */
    get privatePick() {
      return privPick;
    },
    refresh() {
      paintUser();
      if (!ctrl.profile.chosen) paintWords(true);
      // The admin box: shown on an admin's device (its list fills in from the directory), gone when admin is turned off.
      if (!ctrl.isAdmin) ui.privates(null);
      else if (adminBox.hidden) ui.privates(ctrl.privateWatch ? ctrl.privateWatch.places : []);
      // The private match card: the one you host, or the code in the box (looked up again while the screen is up).
      lookPrivate();
      watchPrivate(true);
    },
    status(text, kind = '') {
      const el = $('[data-mp-status]');
      el.textContent = text || '';
      el.className = `mp-status${kind ? ` is-${kind}` : ''}`;
    },
    busy(on) {
      s.classList.toggle('mp-busy', !!on);
    },
    net(text, bad = false) {
      $('[data-mp-net-text]').textContent = text;
      $('[data-mp-net]').classList.toggle('is-bad', !!bad);
    },
    /** The one-tap fix after a refusal: a free username, or a lobby with room. */
    offer(o) {
      offer = o || null;
      offerBox.hidden = !offer;
      if (!offer) return;
      offerBtn.textContent = offer.kind === 'name'
        ? `Use ${offer.name} and join`
        : `Join ${lobbyLabel(offer.n, !!offer.world)} instead (${offer.players}/${offer.max || LOBBY_MAX})`;
    },
    /** The world row's line beside its heading (list 3). */
    worldNet(text, bad = false) {
      $('[data-mp-world-net-text]').textContent = text;
      $('[data-mp-world-net]').classList.toggle('is-bad', !!bad);
      worldOff = bad ? text : '';
    },
    /** The world row, from the world lobbies' LobbyWatch — or null when they cannot be reached. */
    worlds(list) {
      paintRow(worldCards, list, true, worldOff || 'Looking for the world lobbies…');
    },
    get offered() {
      return offer;
    },
    lobbies(list) {
      paintRow(cards, list, false, null);
    },
  };
  ui.lobbies(null);
  ui.worlds(null);
  /** The private card, for the screen's refresh and the tests: look again now, and keep looking while the screen is up. */
  ui.privateCard = async () => {
    await lookPrivate();
    watchPrivate(true);
    return pvState;
  };
  return ui;
}

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
 * THE LOBBIES. Five, always listed, each with its fixed name, how many are in
 * it out of eight, and the island it is on. One tap joins; an empty lobby is
 * started on your island. Nobody makes, names, locks or hides one.
 *
 * The screen is a menu screen like the others (see ui.js), built once and
 * written into, never rebuilt, so a button under the pointer is never
 * replaced between a press and its release.
 */

import {
  COLOURS, COLOUR_NAMES, CALLSIGN_ADJECTIVES, CALLSIGN_NOUNS, CALLSIGN_NUMBERS, CODE_EXAMPLE, CODE_TYPED_MAX, LOBBY_COUNT, LOBBY_MAX,
  parseCallSign, formatCallSign, randomCallSign, mapNameFor, escapeHtml, lobbyName,
} from './protocol.js';

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
.mp-offer[hidden] { display: none !important; }
.mp-offer { margin-top: 10px; }
.mp-lobbies details.mp-friend { margin-top: 16px; }
.mp-lobbies details.mp-friend summary { cursor: pointer; color: var(--text); font-weight: 600; }
.mp-lobbies details.mp-friend .mp-grid { margin-top: 12px; }
@media (max-width: 860px) {
  .mp-lobbylist { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .mp-userpick { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .mp-numpick { grid-column: 1 / -1; }
}
@media (max-width: 480px) { .mp-lobbylist, .mp-userpick { grid-template-columns: 1fr; } .mp-lobby { min-height: 0; } }
`;

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
      <p class="hint">Five lobbies, always open, up to eight players in each. Everybody sees everybody — no crashing into each other, and chat is quick messages only.</p>

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

      <h3 class="fail-heading mp-lanhead">Lobbies
        <span class="mp-net" data-mp-net><span class="mp-dot"></span><span data-mp-net-text>Finding your Wi-Fi…</span></span>
      </h3>
      <p class="hint">Each lobby is on one island, and joining takes you there. An empty lobby starts on the island you picked on the menu. <span data-mp-joinas></span></p>
      <div class="mp-lobbylist" data-mp-lobbylist></div>
      <div class="mp-offer" data-mp-offer hidden><button class="primary" data-mp-offer-go></button></div>
      <p class="mp-status" data-mp-status role="status" aria-live="polite"></p>

      <details class="mp-friend">
        <summary>Playing with a friend on a different Wi-Fi?</summary>
        <div class="mp-grid">
          <div class="mp-card">
            <h3>Start a private game</h3>
            <p class="hint">You get a code — two words and a number — to read out to your friend. Up to eight players.</p>
            <button class="primary" data-mp-private>Start a private game</button>
          </div>
          <div class="mp-card">
            <h3>Join with a code</h3>
            <p class="hint">Type the code your friend reads out, like ${CODE_EXAMPLE}.</p>
            <div class="mp-row">
              <input class="mp-input mp-code" data-mp-code maxlength="${CODE_TYPED_MAX}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${CODE_EXAMPLE}" aria-label="Join code">
              <button class="primary" data-mp-join-code>Join</button>
            </div>
          </div>
        </div>
      </details>
    </section>
  `);

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
    setText(joinAs, ctrl.profile.chosen ? `You’ll join as ${ctrl.profile.name}.` : 'Pick your username first.');
    paintWords();
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
    const join = t.closest('[data-mp-lobby-join]');
    if (join) return ctrl.joinLobby(Number(join.dataset.mpLobbyJoin));
    if (t.closest('[data-mp-offer-go]') && offer) {
      const o = offer;
      ui.offer(null);
      if (o.kind === 'name') {
        // One tap: take the free username and try again.
        ctrl.setProfile({ name: o.name, chosen: true });
        paintUser();
        return o.n ? ctrl.joinLobby(o.n) : ctrl.join(o.target);
      }
      if (o.kind === 'lobby') return ctrl.joinLobby(o.n);
      return undefined;
    }
    if (t.closest('[data-mp-private]')) {
      if (!ctrl.profile.chosen) return ui.status('Pick your username first — then you can start a game.', 'warn');
      const game = ctrl.currentGame();
      return ctrl.hostServer({ serverName: ctrl.serverName(), map: ctrl.defaultMap(game), game, privateGame: true });
    }
    if (t.closest('[data-mp-join-code]')) {
      if (!ctrl.profile.chosen) return ui.status('Pick your username first — then you can join.', 'warn');
      return ctrl.joinCode(codeIn.value);
    }
    return undefined;
  });

  const listEl = $('[data-mp-lobbylist]');
  const cards = [];
  for (let n = 1; n <= LOBBY_COUNT; n++) {
    const el = h(`<div class="mp-lobby is-looking" data-mp-lobby="${n}"><span class="mp-slot-n">Lobby ${n}</span><strong>${escapeHtml(lobbyName(n))}</strong>
      <span><span class="mp-count"></span> <em data-mp-players-word></em></span><span class="mp-bar"><i style="width:0%"></i></span>
      <em data-mp-where></em><button class="primary" data-mp-lobby-join="${n}">Join</button></div>`);
    cards.push({ el, count: el.querySelector('.mp-count'), word: el.querySelector('[data-mp-players-word]'), bar: el.querySelector('.mp-bar i'), where: el.querySelector('[data-mp-where]'), join: el.querySelector('button') });
    listEl.appendChild(el);
  }

  const ui = {
    el: s,
    refresh() {
      paintUser();
      if (!ctrl.profile.chosen) paintWords(true);
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
        : `Join Lobby ${offer.n} instead (${offer.players}/${offer.max || LOBBY_MAX})`;
    },
    get offered() {
      return offer;
    },
    lobbies(list) {
      const mine = ctrl.lobbyPlace ? ctrl.lobbyPlace() : null;
      // For a full lobby: the one with the most room — somebody to fly with first, then an empty one.
      const room = (except) => {
        const open = (list || []).filter((l) => l.n !== except && (l.state === 'open' || l.state === 'empty'));
        open.sort((a, b) => (a.state === 'empty') - (b.state === 'empty') || a.players - b.players || a.n - b.n);
        return open[0] || null;
      };
      for (let i = 0; i < LOBBY_COUNT; i++) {
        const c = cards[i];
        const l = list && list[i];
        const state = l ? l.state : 'off';
        const cls = `mp-lobby is-${state}`;
        if (c.el.className !== cls) c.el.className = cls;
        const players = l && (state === 'open' || state === 'full') ? l.players : 0;
        const max = (l && l.max) || LOBBY_MAX;
        setText(c.count, !l ? '—' : state === 'looking' || state === 'quiet' ? '…' : `${players}/${max}`);
        setText(c.word, !l ? '' : players === 1 ? 'player' : 'players');
        c.bar.style.width = `${Math.round((players / max) * 100)}%`;
        let where;
        let label = 'Join';
        let target = i + 1;
        let off = !ctrl.profile.chosen;
        if (!l) {
          where = 'Can’t look for lobbies on this network';
          off = true;
        } else if (state === 'empty') {
          where = mine ? `Empty — starts on your island, ${mapNameFor(mine.map)}` : 'Empty';
          label = 'Start it';
        } else if (state === 'open') where = `On ${l.mapName}`;
        else if (state === 'full') {
          // Full, said kindly, with somewhere to go instead.
          const other = room(i + 1);
          where = `On ${l.mapName} — full, eight is the most`;
          if (other) {
            label = `Full — join Lobby ${other.n}`;
            target = other.n;
          } else {
            label = 'Full';
            off = true;
          }
        } else if (state === 'old') {
          where = 'A different version of the game — reload';
          off = true;
        } else if (state === 'quiet') where = 'Changing hosts — try in a moment';
        else where = 'Looking…';
        setText(c.where, where);
        setText(c.join, label);
        if (c.join.dataset.mpLobbyJoin !== String(target)) c.join.dataset.mpLobbyJoin = String(target);
        if (c.join.disabled !== off) c.join.disabled = off;
      }
    },
  };
  ui.lobbies(null);
  return ui;
}

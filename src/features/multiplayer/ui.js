/**
 * The Multiplayer screen, and the few things multiplayer puts on the HUD.
 *
 * The screen is a menu screen like the others — same header, same cards, same
 * buttons, built from the classes in styles/main.css — and it is added to the
 * menus' own screen list, so show() and hide() treat it exactly like Maps or
 * Settings. The stylesheet is not this feature's to edit, so the handful of
 * rules the screen needs that the game does not already have are injected
 * from here, written against the game's own variables.
 *
 * In flight: a small badge (server, head-count, code, and on a touch screen
 * the Players and Chat buttons), the player list while Tab is held, the
 * quick-chat menu, and coloured dots over the minimap. Nothing here touches
 * the HUD's elements; everything sits in the plug-in layer above them.
 *
 * List 2 ("the multiplayer UI is weird"), looked at with eight players at
 * 1366x768 and 1024x768: the badge was a wide bar that re-measured the HUD
 * once a second to stay out of its way — and counted the "joined" toasts as
 * HUD, so each time somebody joined it dropped to the middle of the right
 * side of the view, on top of the nametags, and went back up when the toast
 * did. Now it is two short lines docked to the minimap (above it where the
 * minimap is at the bottom, below it where it is at the top), where the
 * coloured dots of the same players are, with the chat menu opening away
 * from it; and the player list sits above the other features' prompts.
 */

import {
  COLOURS, COLOUR_NAMES, QUICK_CHAT, GAME_LABEL, CODE_EXAMPLE, CODE_TYPED_MAX, escapeHtml, MAX_PLAYERS, SLOT_COUNT, shownCode, pingLabel,
  CALLSIGN_ADJECTIVES, CALLSIGN_NOUNS, CALLSIGN_NUMBERS, parseCallSign, formatCallSign,
} from './protocol.js';

const STYLE_ID = 'ifs-mp-style';

const CSS = `
.mp-screen .mp-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
.mp-card {
  background: linear-gradient(165deg, rgba(20, 32, 52, 0.92), rgba(11, 18, 32, 0.92));
  border: 1px solid var(--panel-line); border-radius: var(--radius); padding: 16px 18px;
}
.mp-card h3 { margin: 0 0 4px; font-size: 13px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; }
.mp-card .hint { margin: 0 0 12px; }
.mp-you { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; }
.mp-callsign { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 200px; }
.mp-callsign small { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim); }
.mp-callsign strong { font-size: 21px; font-weight: 700; line-height: 1.2; color: var(--text); overflow-wrap: anywhere; }
.mp-screen button.mp-dice { display: inline-flex; align-items: center; gap: 7px; padding: 8px 12px; border-radius: 10px; font-size: 14px; white-space: nowrap; }
.mp-dice span { font-size: 17px; line-height: 1; }
.mp-picks { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.mp-picks .mp-select { flex: 1 1 130px; padding: 7px 9px; font-size: 13.5px; }
.mp-picks .mp-select.mp-num { flex: 0 1 132px; }
.mp-servername { flex: 1 1 180px; min-width: 0; font-size: 16px; font-weight: 650; color: var(--text); overflow-wrap: anywhere; }
.mp-input {
  flex: 1 1 180px; min-width: 0; padding: 10px 12px; border-radius: 10px; font: inherit; font-size: 15px;
  border: 1px solid var(--panel-line); background: rgba(255, 255, 255, 0.06); color: var(--text);
}
.mp-input:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
.mp-code { font-weight: 700; font-family: var(--mono); flex: 0 1 240px; }
.mp-swatches { display: flex; gap: 6px; flex-wrap: wrap; }
.mp-screen button.mp-swatch {
  width: 28px; height: 28px; border-radius: 50%; padding: 0; border: 2px solid rgba(255,255,255,0.25);
  box-shadow: inset 0 0 0 2px rgba(0,0,0,0.25);
}
.mp-screen button.mp-swatch.is-on { border-color: #fff; transform: scale(1.12); box-shadow: 0 0 0 3px rgba(255,255,255,0.18); }
.mp-slots { display: grid; grid-template-columns: repeat(${SLOT_COUNT}, minmax(0, 1fr)); gap: 10px; }
.mp-slot {
  position: relative; display: flex; flex-direction: column; gap: 4px; min-height: 142px;
  padding: 12px; border-radius: 12px; border: 1px dashed rgba(140, 180, 230, 0.28);
  background: rgba(255, 255, 255, 0.03); color: var(--text-dim); font-size: 12.5px;
}
.mp-slot .mp-slot-n { font-size: 10.5px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--text-dim); }
.mp-slot strong { color: var(--text); font-size: 14px; font-weight: 650; line-height: 1.2; overflow-wrap: anywhere; }
.mp-slot em { font-style: normal; }
.mp-slot .mp-slot-meta { display: flex; gap: 8px; margin-top: auto; font-variant-numeric: tabular-nums; }
.mp-slot .mp-slot-meta b { color: var(--text); }
.mp-slot.is-open, .mp-slot.is-full, .mp-slot.is-old, .mp-slot.is-unreachable, .mp-slot.is-busy, .mp-slot.is-locked { border-style: solid; background: var(--panel); border-color: rgba(140, 180, 230, 0.3); }
.mp-slot.is-open, .mp-slot.is-busy { border-color: rgba(88, 198, 255, 0.5); }
.mp-slot.is-full .mp-slot-meta b, .mp-slot.is-locked .mp-slot-meta b, .mp-slot.is-unreachable em { color: var(--amber); }
.mp-slot.is-empty { cursor: pointer; }
.mp-slot.is-empty:hover { border-color: rgba(124, 199, 255, 0.55); color: var(--text); }
.mp-slot.is-looking em::after { content: ''; display: inline-block; width: 10px; animation: mp-dots 1.2s steps(4, end) infinite; overflow: hidden; vertical-align: bottom; white-space: nowrap; }
@keyframes mp-dots { 0% { width: 0; } 100% { width: 12px; } }
.mp-slot button.primary { margin-top: 6px; width: 100%; padding: 8px 10px; }
.mp-slot button.primary:disabled { opacity: 0.45; cursor: not-allowed; transform: none; }
.mp-slot [hidden] { display: none !important; }
.mp-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; background: var(--good); box-shadow: 0 0 0 3px rgba(79, 214, 132, 0.18); vertical-align: middle; }
.mp-row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.mp-seg { display: inline-flex; gap: 4px; padding: 3px; border-radius: 12px; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); }
.mp-screen .mp-seg button { border: 0; background: transparent; color: var(--text-dim); padding: 7px 12px; border-radius: 9px; font-size: 13.5px; font-weight: 560; }
.mp-screen .mp-seg button.is-on { background: var(--accent); color: #0b1220; }
.mp-select { font: inherit; color: var(--text); background: rgba(255,255,255,0.07); border: 1px solid var(--panel-line); border-radius: 10px; padding: 9px 10px; flex: 1 1 160px; min-width: 0; }
.mp-select option { color: #0b1220; }
.mp-share-note { margin-top: -6px; font-size: 12.5px; }
.mp-share-note kbd { font-family: var(--mono); font-size: 11px; padding: 0 4px; border-radius: 4px; border: 1px solid var(--panel-line); }
.mp-status { min-height: 22px; margin: 14px 0 0; font-size: 14px; color: var(--text-dim); }
.mp-status.is-bad { color: #ffcfc8; } .mp-status.is-good { color: #c9ffdd; } .mp-status.is-warn { color: #ffe6b3; }
.mp-lanhead { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 6px 12px; }
.mp-net { font-size: 12.5px; color: var(--text-dim); display: inline-flex; align-items: center; gap: 7px; text-transform: none; letter-spacing: 0; font-weight: 500; }
.mp-net.is-bad .mp-dot { background: var(--amber); box-shadow: 0 0 0 3px rgba(255, 194, 71, 0.18); }
.mp-busy button.primary { opacity: 0.6; pointer-events: none; }
@media (max-width: 860px) { .mp-slots { grid-template-columns: repeat(2, minmax(0, 1fr)); } .mp-screen .mp-grid { grid-template-columns: 1fr; } }
@media (max-width: 480px) { .mp-slots { grid-template-columns: 1fr; } .mp-slot { min-height: 0; } }

/* ---- in flight ---- */
.mp-hud { position: absolute; inset: 0; pointer-events: none; font-family: var(--font); color: var(--text); z-index: 4; }
.mp-hud[hidden] { display: none !important; }
.mp-badge {
  position: absolute; right: 16px; top: 16px; width: max-content; max-width: min(250px, 44vw);
  display: flex; flex-direction: column; gap: 5px;
  padding: 7px 9px 7px 11px; border-radius: 12px; font-size: 12.5px;
  background: var(--panel); border: 1px solid var(--panel-line);
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); box-shadow: var(--shadow);
}
.mp-badge .mp-brow { display: flex; align-items: center; gap: 7px; min-width: 0; }
.mp-badge .mp-brow [data-mp-badge-text] { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mp-badge .mp-bcode { font-size: 11.5px; color: var(--text-dim); line-height: 1.35; }
.mp-badge .mp-bcode b { white-space: nowrap; }
.mp-badge .mp-bcode b { font-family: var(--mono); color: var(--text); letter-spacing: 0.04em; }
.mp-badge .mp-bcode[hidden] { display: none; }
.mp-badge .mp-bact { display: flex; align-items: center; gap: 6px; justify-content: space-between; }
/* List 2, part 2: the chips other features put here — PvP, Summon, Race (../pvp.js, ../mpworld.js, ../race.js). */
.mp-badge .mp-bext { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; position: relative; }
.mp-badge .mp-bext[hidden] { display: none; }
.mp-badge b { font-weight: 650; }
.mp-badge .mp-keys { color: var(--text-dim); font-size: 11px; white-space: nowrap; }
.mp-badge kbd { font-family: var(--mono); font-size: 10.5px; padding: 1px 5px; border-radius: 5px; border: 1px solid var(--panel-line); background: rgba(255,255,255,0.07); }
.mp-hud button {
  pointer-events: auto; font: inherit; font-size: 12.5px; cursor: pointer; color: var(--text);
  padding: 5px 10px; border-radius: 9px; border: 1px solid var(--panel-line); background: rgba(255,255,255,0.08);
}
.mp-hud button:hover { background: rgba(88, 198, 255, 0.18); border-color: rgba(88, 198, 255, 0.5); }
.mp-hud .mp-touch-only { display: none; }
.is-touch-device .mp-hud .mp-touch-only { display: inline-block; }
.is-touch-device .mp-hud .mp-keys { display: none; }
.is-touch-device .mp-hud button { padding: 9px 14px; font-size: 14px; }
.is-touch-device .mp-badge .mp-bact { justify-content: flex-start; }
.mp-list {
  position: absolute; left: 50%; top: 18%; transform: translateX(-50%); width: min(440px, 92vw); z-index: 2;
  max-height: 70vh; overflow-y: auto;
  pointer-events: auto; padding: 14px 16px; border-radius: var(--radius);
  background: rgba(10, 17, 30, 0.9); border: 1px solid var(--panel-line); box-shadow: var(--shadow);
  backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
}
.mp-list h4 { margin: 0 0 10px; font-size: 13px; color: var(--accent); text-transform: uppercase; letter-spacing: 0.08em; display: flex; justify-content: space-between; }
.mp-list h4 span { color: var(--text-dim); text-transform: none; letter-spacing: 0; font-weight: 500; }
.mp-prow { display: grid; grid-template-columns: 14px 1fr auto auto; gap: 10px; align-items: center; padding: 7px 0; border-top: 1px solid rgba(140, 180, 230, 0.1); font-size: 14px; }
.mp-prow:first-of-type { border-top: 0; }
.mp-prow i { width: 12px; height: 12px; border-radius: 50%; display: block; }
.mp-prow .mp-ping { color: var(--text-dim); font-size: 12px; font-variant-numeric: tabular-nums; }
.mp-prow .mp-tagline { color: var(--text-dim); font-size: 11.5px; margin-left: 6px; }
.mp-list .mp-foot, .mp-pausefold .mp-foot { margin-top: 10px; display: flex; justify-content: space-between; align-items: center; gap: 10px; font-size: 12.5px; color: var(--text-dim); }
.mp-list .mp-foot b, .mp-pausefold .mp-foot b { font-family: var(--mono); color: var(--text); letter-spacing: 0.18em; font-size: 15px; }
.mp-pausefold { text-align: left; }
.mp-pausefold h4 { display: none; }
.mp-pausefold button { font: inherit; font-size: 12.5px; padding: 5px 10px; border-radius: 9px; }
.mp-chatmenu {
  position: absolute; right: 16px; top: 64px; width: min(300px, 80vw); pointer-events: auto; z-index: 1;
  display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px; border-radius: 14px;
  background: rgba(10, 17, 30, 0.9); border: 1px solid var(--panel-line); box-shadow: var(--shadow);
}
.mp-chatmenu[hidden] { display: none !important; }
.mp-hud .mp-chatmenu button { text-align: left; padding: 9px 10px; }
.mp-chatmenu kbd { font-family: var(--mono); font-size: 10.5px; color: var(--text-dim); margin-right: 5px; }
.mp-mini { position: absolute; pointer-events: none; }
.mp-again { font-style: normal; color: #ffe6b3; }
/* Part 3b: the crown, the ADMIN badge, and the admin menu. */
.mp-crown { display: inline-block; width: 17px; height: 13px; margin-right: 5px; vertical-align: -1px; }
.mp-admintag { display: inline-block; margin-left: 6px; padding: 1px 5px; border-radius: 5px; background: #ff5a4f; color: #fff;
  font-size: 10px; font-weight: 800; letter-spacing: 0.06em; vertical-align: 1px; }
.mp-badge .mp-admintag { margin-left: 0; }
.mp-frozen { color: #bfe6ff; font-weight: 650; }
.mp-prow .mp-acts { display: inline-flex; gap: 5px; justify-content: flex-end; }
.mp-admrow { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 2px 0 9px 24px; font-size: 12.5px; color: var(--text-dim); }
.mp-admrow .mp-sure { color: var(--text); font-weight: 600; }
.mp-hud .mp-admrow button.mp-yes, .mp-pausefold .mp-admrow button.mp-yes { background: rgba(255, 90, 79, 0.28); border-color: rgba(255, 90, 79, 0.7); }
.mp-hud button.mp-admbtn, .mp-pausefold button.mp-admbtn { border-color: rgba(255, 90, 79, 0.55); }
`;

/** The owner's crown, for the player list (the tags draw their own: remotes.js). */
export const CROWN_SVG = '<svg class="mp-crown" viewBox="0 0 24 18" role="img" aria-label="Owner"><title>Owner</title>'
  + '<path d="M2 16.5h20V5.5l-5.5 5L12 1.5l-4.5 9L2 5.5z" fill="#ffd23f" stroke="#6b4e00" stroke-width="1.4" stroke-linejoin="round"/>'
  + '<rect x="3" y="13" width="18" height="2.4" fill="#e0a800"/></svg>';

/** What each admin action is called on its button, and what its "are you sure" says. */
const ADMIN_WORDS = {
  kick: ['Kick', (n) => `Take ${n} out of this game?`],
  mute: ['Mute chat', (n) => `Mute ${n}’s chat for everybody?`],
  unmute: ['Unmute chat', (n) => `Let ${n} chat again?`],
  freeze: ['Freeze 30 s', (n) => `Freeze ${n} for 30 seconds?`],
  unfreeze: ['Unfreeze', (n) => `Let ${n} move again?`],
  close: ['Close server', () => 'Close this game for everybody? They all go back to the lobby list.'],
};

export function injectStyle() {
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

/** Writes text only when it changed: a write is a layout, and most paints change nothing. */
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

/* ------------------------------------------------------------------ */
/* The screen                                                          */
/* ------------------------------------------------------------------ */

const SLOT_WORDS = {
  looking: ['Looking', 'Checking this slot'],
  empty: ['Empty', 'Empty — host here'],
};

/** Join works on a server we know is there and not full or locked — even before its name has arrived. */
const JOINABLE = new Set(['open', 'busy', 'unreachable']);

export function buildScreen(ctrl) {
  const games = ['flight', 'heli', 'boat', 'car'];
  const s = h(`
    <section class="screen screen-list mp-screen" data-screen="multiplayer" hidden>
      <header class="screen-head">
        <button class="ghost" data-mp-back>← Back</button>
        <h2>Multiplayer</h2>
        <span></span>
      </header>
      <p class="hint">Fly with up to four friends. Everybody sees everybody — you bump into each other gently (a real crash only if you both have PvP on), and chat is quick messages only.</p>

      <div class="mp-card">
        <h3>You</h3>
        <div class="mp-you">
          <div class="mp-callsign"><small>Your call sign</small><strong data-mp-callsign aria-live="polite"></strong></div>
          <button class="ghost mp-dice" data-mp-roll title="Roll a new call sign"><span aria-hidden="true">🎲</span>New name</button>
          <div class="mp-swatches" role="group" aria-label="Your plane's colour">
            ${COLOURS.map((c, i) => `<button class="mp-swatch" data-mp-colour="${c}" style="background:${c}" title="${COLOUR_NAMES[i]}" aria-label="${COLOUR_NAMES[i]}"></button>`).join('')}
          </div>
        </div>
        <div class="mp-picks">
          <select class="mp-select" data-mp-adj aria-label="First word of your call sign">
            ${CALLSIGN_ADJECTIVES.map((w) => `<option value="${w}">${w}</option>`).join('')}
          </select>
          <select class="mp-select" data-mp-noun aria-label="Animal or aircraft">
            ${CALLSIGN_NOUNS.map((w) => `<option value="${w}">${w}</option>`).join('')}
          </select>
          <select class="mp-select mp-num" data-mp-num aria-label="Number (optional)">
            <option value="0">No number</option>${CALLSIGN_NUMBERS.map((n) => `<option value="${n}">${n}</option>`).join('')}
          </select>
        </div>
      </div>

      <h3 class="fail-heading mp-lanhead">LAN servers
        <span class="mp-net" data-mp-net><span class="mp-dot"></span><span data-mp-net-text>Finding your Wi-Fi…</span></span>
      </h3>
      <p class="hint">Servers on this Wi-Fi. Five slots, and five players in each. <span data-mp-lan-note></span></p>
      <p class="hint mp-share-note">Everybody on the same internet connection sees this list — at a big school, other classes can too. Once your friends are in, lock your server from the player list (<kbd>Tab</kbd>).</p>
      <div class="mp-slots" data-mp-slots></div>

      <div class="mp-grid" style="margin-top:18px">
        <div class="mp-card" data-mp-hostcard>
          <h3>Host a server</h3>
          <p class="hint">Takes the first free slot. You fly straight away and friends join you.</p>
          <div class="mp-row" style="margin-bottom:10px">
            <span class="mp-servername" data-mp-server aria-live="polite"></span>
            <button class="ghost mp-dice" data-mp-server-roll title="Roll a new server name"><span aria-hidden="true">🎲</span>New name</button>
          </div>
          <div class="mp-row" style="margin-bottom:10px">
            <div class="mp-seg" role="group" aria-label="Game">
              ${games.map((g) => `<button data-mp-game="${g}">${GAME_LABEL[g]}</button>`).join('')}
            </div>
            <select class="mp-select" data-mp-map aria-label="Map"></select>
          </div>
          <button class="primary" data-mp-host>Host</button>
        </div>
        <div class="mp-card">
          <h3>Join with a code</h3>
          <p class="hint">Works with friends who aren’t on your Wi-Fi. Every server has a code: two words and a number, like ${CODE_EXAMPLE}.</p>
          <div class="mp-row">
            <input class="mp-input mp-code" data-mp-code maxlength="${CODE_TYPED_MAX}" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="${CODE_EXAMPLE}" aria-label="Join code">
            <button class="primary" data-mp-join-code>Join</button>
          </div>
        </div>
      </div>
      <p class="mp-status" data-mp-status role="status" aria-live="polite"></p>
    </section>
  `);

  const $ = (sel) => s.querySelector(sel);
  const nameOut = $('[data-mp-callsign]');
  const adjSel = $('[data-mp-adj]');
  const nounSel = $('[data-mp-noun]');
  const numSel = $('[data-mp-num]');
  const serverOut = $('[data-mp-server]');
  const mapSel = $('[data-mp-map]');
  const codeIn = $('[data-mp-code]');
  let game = 'flight';

  const paintProfile = () => {
    const cs = parseCallSign(ctrl.profile.name);
    nameOut.textContent = ctrl.profile.name || '';
    if (cs) {
      adjSel.value = cs.adjective;
      nounSel.value = cs.noun;
      numSel.value = String(cs.number);
    }
    for (const b of s.querySelectorAll('[data-mp-colour]')) b.classList.toggle('is-on', b.dataset.mpColour === ctrl.profile.colour);
    serverOut.textContent = ctrl.serverName();
  };
  // The pickers only ever hold list words, so what they make always parses.
  const picked = () => {
    ctrl.setProfile({ name: formatCallSign({ adjective: adjSel.value, noun: nounSel.value, number: Number(numSel.value) || 0 }) });
    paintProfile();
  };
  for (const sel of [adjSel, nounSel, numSel]) sel.addEventListener('change', picked);
  const paintGame = () => {
    for (const b of s.querySelectorAll('[data-mp-game]')) b.classList.toggle('is-on', b.dataset.mpGame === game);
    const maps = ctrl.mapsFor(game);
    const want = ctrl.defaultMap(game);
    mapSel.innerHTML = maps.map((m) => `<option value="${escapeHtml(m.id)}"${m.id === want ? ' selected' : ''}>${escapeHtml(m.name)}</option>`).join('');
  };

  codeIn.addEventListener('input', () => {
    // Letters, digits, spaces and hyphens, in lower case (folded by hand: ASCII only); normaliseCode() reads the rest.
    const v = codeIn.value.replace(/[A-Z]/g, (c) => c.toLowerCase()).replace(/[^a-z0-9 -]/g, '').slice(0, CODE_TYPED_MAX);
    if (v !== codeIn.value) codeIn.value = v;
  });
  codeIn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') ctrl.joinCode(codeIn.value);
  });

  s.addEventListener('click', (e) => {
    if (e.target.closest('[data-mp-back]')) return ctrl.back();
    if (e.target.closest('[data-mp-roll]')) {
      ctrl.rollName();
      paintProfile();
      return;
    }
    if (e.target.closest('[data-mp-server-roll]')) {
      ctrl.rollServerName();
      paintProfile();
      return;
    }
    const sw = e.target.closest('[data-mp-colour]');
    if (sw) {
      ctrl.setProfile({ colour: sw.dataset.mpColour });
      paintProfile();
      return;
    }
    const g = e.target.closest('[data-mp-game]');
    if (g) {
      game = g.dataset.mpGame;
      paintGame();
      return;
    }
    if (e.target.closest('[data-mp-host]')) return ctrl.hostServer({ serverName: ctrl.serverName(), map: mapSel.value, game });
    if (e.target.closest('[data-mp-join-code]')) return ctrl.joinCode(codeIn.value);
    const join = e.target.closest('[data-mp-join]');
    if (join) return ctrl.joinSlot(Number(join.dataset.mpJoin));
    const empty = e.target.closest('.mp-slot.is-empty');
    if (empty) {
      // "Empty — host here": take them to the host form.
      const card = $('[data-mp-hostcard]');
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      $('[data-mp-host]').focus({ preventScroll: true });
    }
  });

  const slotsEl = $('[data-mp-slots]');
  const ui = {
    el: s,
    refresh() {
      // Host the game whose menu you came from: Multiplayer on the Boat page means a boat server.
      const g = ctrl.currentGame && ctrl.currentGame();
      if (g && games.includes(g)) game = g;
      paintProfile();
      paintGame();
    },
    status(text, kind = '') {
      const el = $('[data-mp-status]');
      el.textContent = text || '';
      el.className = `mp-status${kind ? ` is-${kind}` : ''}`;
    },
    busy(on) {
      s.classList.toggle('mp-busy', !!on);
    },
    net(text, bad = false, lanNote = '') {
      $('[data-mp-net-text]').textContent = text;
      $('[data-mp-net]').classList.toggle('is-bad', !!bad);
      $('[data-mp-lan-note]').textContent = lanNote ? `(${lanNote.charAt(0).toUpperCase()}${lanNote.slice(1)}.)` : '';
    },
    /*
     * The five cards are built once and written into, never rebuilt. They
     * were rebuilt with innerHTML on every paint, and the list paints on
     * every 3 s ping: review measured the Join button under the pointer
     * replaced by a paint (the old one detached), which eats a click that
     * lands between press and release, and drops keyboard focus from Join.
     */
    slots(list) {
      for (let i = 0; i < SLOT_COUNT; i++) {
        const c = slotCards[i];
        const sl = list && list[i];
        const state = sl ? sl.state : 'off';
        const info = sl && sl.info;
        const count = info ? info : sl && sl.count;
        let title;
        let sub = '';
        let note = '';
        let details = false;
        if (!sl || state === 'off') {
          title = '—';
          sub = 'Can’t look for servers on this network';
        } else if (SLOT_WORDS[state] && (!info || state === 'empty') && !(state === 'looking' && count)) {
          [title, sub] = SLOT_WORDS[state];
        } else {
          details = true;
          title = info ? info.name : 'A server';
          sub = info ? `${info.mapName} · ${GAME_LABEL[info.game] || 'Flight'}` : '';
          note = state === 'full' ? 'Server full'
            : state === 'locked' ? 'Locked by the host'
            : state === 'old' ? 'Different version — reload'
            : state === 'unreachable' ? 'Found, but can’t connect — try joining, or ask for the code'
            : state === 'busy' ? 'Busy — its name is on the way'
            : state === 'looking' ? 'Checking' : '';
        }
        const cls = `mp-slot is-${state}`;
        if (c.el.className !== cls) c.el.className = cls;
        setText(c.title, title);
        setText(c.sub, sub);
        setText(c.note, note);
        if (c.note.hidden !== !note) c.note.hidden = !note;
        if (c.meta.hidden === details) c.meta.hidden = !details;
        if (c.join.hidden === details) c.join.hidden = !details;
        if (!details) continue;
        setText(c.heads, count ? `${count.players}/${count.max || MAX_PLAYERS}` : '?');
        // Measured by this copy, but a host can hold its answer back to pick the number: round steps here too.
        setText(c.ping, sl.ping ? pingLabel(sl.ping) : '');
        setText(c.join, state === 'full' ? 'Full' : state === 'locked' ? 'Locked' : state === 'unreachable' ? 'Try to join' : 'Join');
        const off = !JOINABLE.has(state);
        if (c.join.disabled !== off) c.join.disabled = off;
      }
    },
  };
  const slotCards = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const el = h(`<div class="mp-slot is-off" data-mp-slot="${i + 1}"><span class="mp-slot-n">Slot ${i + 1}</span><strong></strong><em></em><em hidden></em>
      <span class="mp-slot-meta" hidden><span><b></b> players</span><span></span></span>
      <button class="primary" data-mp-join="${i + 1}" hidden>Join</button></div>`);
    const ems = el.querySelectorAll('em');
    const meta = el.querySelector('.mp-slot-meta');
    slotCards.push({
      el, title: el.querySelector('strong'), sub: ems[0], note: ems[1], meta, heads: meta.querySelector('b'),
      ping: meta.lastElementChild, join: el.querySelector('button'),
    });
    slotsEl.appendChild(el);
  }
  ui.slots(null);
  return ui;
}

/* ------------------------------------------------------------------ */
/* In flight                                                           */
/* ------------------------------------------------------------------ */

/**
 * The player list, into `box`. Rebuilt only when who is in it changes; the
 * pings, which change every second or two, are written into their own
 * spans. It used to be rebuilt whenever a ping moved, and replacing a button
 * between the press and the release of a click eats the click — a Kick or a
 * Leave that did nothing, about one time in several.
 */
function paintRoster(box, players, {
  meId, isHost, code: rawCode, server, locked, closeButton = false, lobby = false, muted = null, max = MAX_PLAYERS, reconnecting = false, place = '', priv = false,
  world = false,
  admin = false, adm = null,
}) {
  if (!box) return;
  // Checked again here, the last step before the screen: a code is shown only if it is exactly one the game could make.
  const code = shownCode(rawCode);
  // Part 3b: which row's admin menu is open, and which action is waiting for "yes" (buildHud keeps both).
  const open = admin && adm ? adm.open : null;
  const armed = admin && adm ? adm.armed : null;
  let shape = `${meId}|${isHost}|${code}|${server}|${locked}|${closeButton}|${lobby}|${max}|${reconnecting}|${place}|${priv}|${world}|${admin}|${open}|${armed ? `${armed.op}:${armed.id}` : ''}`;
  for (const p of players) shape += `#${p.id}|${p.name}|${p.colour}|${p.host ? 1 : 0}|${muted && muted.has(p.name) ? 1 : 0}|${p.admin ? 1 : 0}${p.muted ? 1 : 0}${p.frozen ? 1 : 0}`;
  if (shape !== box._shape) {
    box._shape = shape;
    const rows = players.map((p) => {
      const you = p.id === meId;
      const hush = !!(muted && muted.has(p.name));
      const name = escapeHtml(p.name);
      // Part 3b: the crown is whoever hosts — a lobby's owner too, now; the word "host" only where the host made the game.
      const tags = [p.host && !lobby ? 'host' : '', you ? 'you' : '', hush ? 'muted' : '', p.muted ? 'chat muted by an admin' : '', p.frozen ? 'frozen' : ''].filter(Boolean).join(', ');
      const acts = [];
      if (lobby && !you) {
        acts.push(`<button data-mp-mute="${name}" title="${hush ? 'Show' : 'Hide'} ${name}’s quick chat — only on your screen">${hush ? 'Unmute' : 'Mute'}</button>`);
      } else if (!lobby && isHost && !p.host && !p.admin) acts.push(`<button data-mp-kick="${p.id}" title="Remove ${name} from the server">Kick</button>`);
      // The admin menu: for anybody here who is not an admin themselves.
      if (admin && !you && !p.admin) acts.push(`<button class="mp-admbtn" data-mp-adm-open="${p.id}" aria-expanded="${open === p.id}" title="Admin: kick, mute or freeze ${name}">Admin</button>`);
      let sub = '';
      if (admin && open === p.id && !you && !p.admin) {
        if (armed && armed.id === p.id) {
          sub = `<div class="mp-admrow" data-mp-admrow="${p.id}"><span class="mp-sure">${escapeHtml(ADMIN_WORDS[armed.op][1](p.name))}</span>`
            + '<button class="mp-yes" data-mp-adm-yes>Yes</button><button data-mp-adm-no>No</button></div>';
        } else {
          const ops = [];
          // A match the host made: taking its host out would end it, which is Close server.
          if (!(p.host && !lobby)) ops.push('kick');
          ops.push(p.muted ? 'unmute' : 'mute', p.frozen ? 'unfreeze' : 'freeze');
          sub = `<div class="mp-admrow" data-mp-admrow="${p.id}">${ops.map((op) => `<button data-mp-adm="${op}:${p.id}">${ADMIN_WORDS[op][0]}</button>`).join('')}</div>`;
        }
      }
      return `<div class="mp-prow"><i style="background:${safeCss(p.colour)}"></i><span>${p.host ? CROWN_SVG : ''}${name}${p.admin ? '<b class="mp-admintag">ADMIN</b>' : ''}${tags ? `<span class="mp-tagline">${tags}</span>` : ''}</span><span class="mp-ping" data-mp-ping="${p.id}"></span><span class="mp-acts">${acts.join('')}</span></div>${sub}`;
    });
    const lockBtn = isHost && !lobby ? `<button data-mp-lock="${locked ? 'off' : 'on'}" title="${locked ? 'Let new players join again' : 'Stop anybody new from joining'}">${locked ? 'Unlock' : 'Lock'}</button> ` : '';
    // A world lobby (list 3) says so: the others in it can be anybody, anywhere — usernames from the lists and quick chat only, as everywhere.
    const note = reconnecting ? '<span class="mp-again">Reconnecting… keep flying</span>'
      : world ? '<small>World lobby — players from anywhere. Quick chat only; Mute hides someone’s.</small>' : '';
    // An admin can close the game for everybody — asked first.
    const closing = admin && armed && armed.op === 'close';
    const adminClose = !admin ? '' : closing
      ? `<div class="mp-admrow" data-mp-admrow="close"><span class="mp-sure">${escapeHtml(ADMIN_WORDS.close[1]())}</span><button class="mp-yes" data-mp-adm-yes>Yes, close it</button><button data-mp-adm-no>No</button></div>`
      : '<div class="mp-admrow" data-mp-admrow="close"><b class="mp-admintag">ADMIN</b><button class="mp-admbtn" data-mp-adm="close:-1">Close server for everybody</button></div>';
    box.innerHTML = `
      <h4>Players <span>${players.length}/${max} · ${escapeHtml(server || '')}${place ? ` · ${escapeHtml(place)}` : ''}${locked ? ' · locked' : ''}</span></h4>
      ${rows.join('')}
      ${adminClose}
      <div class="mp-foot">
        <span>${code ? `Code <b>${escapeHtml(code)}</b>${priv ? '<br><small>Works with friends who aren’t on your Wi-Fi.</small>' : ''}` : note}</span>
        <span>${closeButton ? '<button class="mp-touch-only" data-mp-close-list>Close</button> ' : ''}${lockBtn}<button data-mp-leave>${lobby ? 'Leave lobby' : isHost ? 'Close server' : 'Leave'}</button></span>
      </div>`;
    box._pings = new Map();
    for (const el of box.querySelectorAll('[data-mp-ping]')) box._pings.set(Number(el.dataset.mpPing), el);
  }
  for (const p of players) {
    const el = box._pings && box._pings.get(p.id);
    // The host's own row has no ping: every other number is measured to the host, and shown in round steps (pingLabel).
    const text = p.host ? '' : pingLabel(p.ping);
    if (el && el.textContent !== text) el.textContent = text;
  }
}

const safeCss = (c) => (/^#[0-9a-f]{6}$/i.test(String(c)) ? c : '#58c6ff');

export function buildHud(ctrl, layer) {
  const el = h(`
    <div class="mp-hud" hidden>
      <div class="mp-badge">
        <div class="mp-brow"><span class="mp-dot"></span><span data-mp-badge-text></span></div>
        <div class="mp-bcode" data-mp-badge-code hidden></div>
        <div class="mp-bact">
          <span class="mp-keys"><kbd>Tab</kbd> players · <kbd>3</kbd>–<kbd>6</kbd> chat</span>
          <button class="mp-touch-only" data-mp-players>Players</button>
          <button data-mp-chat title="Quick chat">Chat</button>
        </div>
        <div class="mp-bext" data-mp-badge-ext hidden></div>
      </div>
      <div class="mp-list" data-mp-list hidden></div>
      <div class="mp-chatmenu" data-mp-chatmenu hidden>
        ${QUICK_CHAT.map((c, i) => `<button data-mp-say="${i}">${c.key ? `<kbd>${c.key.slice(-1)}</kbd>` : ''}${escapeHtml(c.text)}</button>`).join('')}
      </div>
      <canvas class="mp-mini" data-mp-mini width="380" height="380"></canvas>
    </div>
  `);
  layer.appendChild(el);
  const list = el.querySelector('[data-mp-list]');
  const menu = el.querySelector('[data-mp-chatmenu]');
  const mini = el.querySelector('[data-mp-mini]');
  const badge = el.querySelector('.mp-badge');
  const badgeText = el.querySelector('[data-mp-badge-text]');
  const badgeCode = el.querySelector('[data-mp-badge-code]');
  const ext = el.querySelector('[data-mp-badge-ext]');
  let badgeHtml = null;
  let codeHtml = null;
  let placedAt = -Infinity;
  let hudNodes = [];
  let hudNodesAt = -Infinity;
  const boxes = [];
  let listPinned = false;
  let listHeld = false;

  let pause = null;
  // Part 3b: the admin menu's state — whose row is open, and the one action waiting for "yes". One at a time.
  const adm = { open: null, armed: null };
  let lastRoster = null;
  const repaint = () => {
    if (lastRoster) hud.roster(lastRoster.players, lastRoster.opts);
  };
  const onClick = (e) => {
    const admOpen = e.target.closest('[data-mp-adm-open]');
    if (admOpen) {
      const id = Number(admOpen.dataset.mpAdmOpen);
      adm.open = adm.open === id ? null : id;
      adm.armed = null;
      repaint();
      return;
    }
    const admBtn = e.target.closest('[data-mp-adm]');
    if (admBtn) {
      const [op, id] = admBtn.dataset.mpAdm.split(':');
      adm.armed = { op, id: Number(id) };
      if (op === 'close') adm.open = null;
      repaint();
      return;
    }
    if (e.target.closest('[data-mp-adm-yes]')) {
      const a = adm.armed;
      adm.armed = null;
      adm.open = null;
      if (a) ctrl.adminAct(a.op, a.id);
      repaint();
      return;
    }
    if (e.target.closest('[data-mp-adm-no]')) {
      adm.armed = null;
      repaint();
      return;
    }
    if (e.target.closest('[data-mp-players]')) {
      listPinned = !listPinned;
      hud.syncList();
      return;
    }
    if (e.target.closest('[data-mp-chat]')) {
      menu.hidden = !menu.hidden;
      return;
    }
    const say = e.target.closest('[data-mp-say]');
    if (say) {
      ctrl.chat(Number(say.dataset.mpSay));
      menu.hidden = true;
      return;
    }
    const kick = e.target.closest('[data-mp-kick]');
    if (kick) {
      ctrl.kick(Number(kick.dataset.mpKick));
      return;
    }
    const mute = e.target.closest('[data-mp-mute]');
    if (mute) {
      ctrl.toggleMute(mute.dataset.mpMute);
      return;
    }
    if (e.target.closest('[data-mp-leave]')) {
      ctrl.leave('left');
      return;
    }
    const lock = e.target.closest('[data-mp-lock]');
    if (lock) {
      ctrl.lock(lock.dataset.mpLock === 'on');
      return;
    }
    if (e.target.closest('[data-mp-close-list]')) {
      listPinned = false;
      hud.syncList();
    }
  };
  el.addEventListener('click', onClick);

  const hud = {
    el,
    /** Where other features put their chips on the badge (list 2, part 2); shown once something is in it. */
    ext,
    /** True when the badge sits over the minimap, so a feature's menu opens upwards. */
    menuUp: false,
    show(on) {
      el.hidden = !on;
      if (!on) {
        listPinned = listHeld = false;
        list.hidden = true;
        menu.hidden = true;
      }
    },
    // Once a second from the idle loop; written only when it changed, which is rarely.
    badge(text, code = '') {
      if (badgeHtml !== text) {
        badgeHtml = text;
        badgeText.innerHTML = text;
      }
      if (codeHtml !== code) {
        codeHtml = code;
        badgeCode.innerHTML = code;
        badgeCode.hidden = !code;
        placedAt = -Infinity;
      }
    },
    hold(on) {
      listHeld = !!on;
      hud.syncList();
    },
    syncList() {
      list.hidden = !(listHeld || listPinned);
    },
    get listOpen() {
      return !list.hidden;
    },
    roster(players, opts) {
      lastRoster = { players, opts };
      // An admin menu for somebody who has gone, or who is now an admin: closed. And none at all for a player who is not an admin here.
      if (adm.open != null && !players.some((p) => p.id === adm.open && !p.admin)) {
        adm.open = null;
        if (adm.armed && adm.armed.op !== 'close') adm.armed = null;
      }
      if (!(opts && opts.admin)) adm.open = adm.armed = null;
      paintRoster(list, players, { ...opts, closeButton: true, adm });
      if (pause && !pause.hidden) paintRoster(pause.querySelector('[data-mp-pauselist]'), players, { ...opts, adm });
    },
    /** For the tests: the admin menu's state. */
    get adminMenu() {
      return { open: adm.open, armed: adm.armed };
    },
    /**
     * The same list in the pause menu, as one of its folds. Paused is where
     * the mouse is free, and review found a host flying with the mouse had
     * no way to reach Kick at all: the Tab list opened under a locked
     * pointer, and pausing hid it.
     */
    pauseList(sim, on, players, opts) {
      const card = sim && sim.menus && sim.menus.screens && sim.menus.screens.pause
        && sim.menus.screens.pause.querySelector('.pause-card');
      if (!card) return;
      if (!pause) {
        pause = h(`<details class="pause-fold mp-pausefold" open hidden><summary>Multiplayer · <span data-mp-pausehead></span></summary><div data-mp-pauselist></div></details>`);
        pause.addEventListener('click', onClick);
      }
      if (pause.parentNode !== card) {
        const after = card.querySelector('.pause-actions');
        if (after && after.nextSibling) card.insertBefore(pause, after.nextSibling);
        else card.appendChild(pause);
      }
      if (pause.hidden === !!on) pause.hidden = !on;
      if (on) {
        setText(pause.querySelector('[data-mp-pausehead]'), `${players.length}/${(opts && opts.max) || MAX_PLAYERS} players`);
        paintRoster(pause.querySelector('[data-mp-pauselist]'), players, { ...opts, adm });
      }
    },
    /**
     * Where the badge goes: docked to the minimap, where the same players'
     * dots are — above it when the minimap is at the bottom (a computer),
     * below it when it is at the top (a tablet) — with the chat menu
     * opening away from it. Without a minimap (hidden with M), the top right
     * corner, below whatever of the game's own HUD is there: re-measured once
     * a second, and never counting the toasts, which come and go and used to
     * push it into the middle of the view.
     */
    place(sim) {
      const t = typeof performance !== 'undefined' ? performance.now() : 0;
      if (t - placedAt < 1000 || el.hidden || typeof document === 'undefined') return;
      placedAt = t;
      const W = window.innerWidth;
      const H = window.innerHeight;
      const bw = badge.offsetWidth || 200;
      const bh = badge.offsetHeight || 60;
      const mm = sim && sim.minimap;
      const canvas = mm && mm.visible && mm.canvas;
      const r = canvas && canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : null;
      let pos;
      if (r && r.width > 20 && r.height > 20) {
        const bottomHalf = r.top + r.height / 2 > H / 2;
        const rightHalf = r.left + r.width / 2 > W / 2;
        const top = bottomHalf ? Math.max(8, r.top - 8 - bh) : Math.min(H - bh - 8, r.bottom + 8);
        pos = rightHalf ? { right: Math.max(8, W - r.right), top } : { left: Math.max(8, r.left), top };
        pos.menuUp = bottomHalf;
        // The wildfire's panel grows down that side to meet it (a laptop, 1366x768: its last lines were under the
        // badge): the badge steps to the left of the panel rather than cover it.
        if (rightHalf) {
          const bx1 = W - pos.right;
          let edge = Infinity;
          for (const n of document.querySelectorAll('.wf-panel')) {
            const b = n.getBoundingClientRect();
            if (b.width && b.height && b.left < bx1 && b.right > bx1 - bw && b.top < top + bh && b.bottom > top) edge = Math.min(edge, b.left);
          }
          if (edge < Infinity && edge - 8 - bw > 8) pos.right = Math.round(W - edge + 8);
        }
      } else {
        if (t - hudNodesAt > 5000) {
          hudNodesAt = t;
          hudNodes = [];
          for (const n of document.querySelectorAll('[class*="hud-"]')) if (!el.contains(n) && !/hud-toast/.test(n.className)) hudNodes.push(n);
        }
        const left = W - 16 - bw;
        boxes.length = 0;
        for (const n of hudNodes) {
          if (!n.isConnected) continue;
          const b = n.getBoundingClientRect();
          if (!b.width || !b.height || b.right <= left || b.left >= W || b.top > H * 0.55) continue;
          if (b.width > W * 0.6 || b.height > H * 0.6) continue;
          const cs = getComputedStyle(n);
          if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05) continue;
          boxes.push(b);
        }
        let y = 16;
        for (let k = 0, moved = true; moved && k < 12; k++) {
          moved = false;
          for (const b of boxes) {
            if (b.top < y + bh && b.bottom > y) {
              y = Math.ceil(b.bottom) + 8;
              moved = true;
            }
          }
        }
        pos = { right: 16, top: Math.min(y, Math.max(16, H * 0.55)), menuUp: false };
      }
      const key = `${pos.left}|${pos.right}|${pos.top}|${pos.menuUp}|${bh}`;
      hud.menuUp = !!pos.menuUp;
      if (badge._pos === key) return;
      badge._pos = key;
      badge.style.left = pos.left != null ? `${pos.left}px` : 'auto';
      badge.style.right = pos.right != null ? `${pos.right}px` : 'auto';
      badge.style.top = `${pos.top}px`;
      menu.style.left = pos.left != null ? `${pos.left}px` : 'auto';
      menu.style.right = pos.right != null ? `${pos.right}px` : 'auto';
      if (pos.menuUp) {
        menu.style.top = 'auto';
        menu.style.bottom = `${H - pos.top + 8}px`;
      } else {
        menu.style.bottom = 'auto';
        menu.style.top = `${pos.top + bh + 8}px`;
      }
    },
    /** Coloured dots over the game's minimap, drawn on our own canvas so minimap.js is untouched. */
    minimap(sim, dots, extras = null) {
      const mm = sim && sim.minimap;
      const canvas = mm && mm.canvas;
      const more = !!(extras && extras.length);
      const visible = !!(mm && mm.visible && canvas && canvas.getBoundingClientRect && !el.hidden && (dots.length || more));
      if (!visible) {
        if (mini.style.display !== 'none') mini.style.display = 'none';
        return;
      }
      // Where the minimap is, re-measured four times a second rather than forcing a layout every frame.
      const t = typeof performance !== 'undefined' ? performance.now() : 0;
      if (!mini._rect || t - mini._rectAt > 250) {
        mini._rect = canvas.getBoundingClientRect();
        mini._rectAt = t;
      }
      const r = mini._rect;
      if (!r.width) {
        if (mini.style.display !== 'none') mini.style.display = 'none';
        return;
      }
      if (mini.style.display === 'none') mini.style.display = '';
      // Moved only when the minimap has: four style strings a frame was review's count.
      if (mini._pl !== r.left || mini._pt !== r.top || mini._pw !== r.width || mini._ph !== r.height) {
        mini._pl = r.left;
        mini._pt = r.top;
        mini._pw = r.width;
        mini._ph = r.height;
        mini.style.left = `${r.left}px`;
        mini.style.top = `${r.top}px`;
        mini.style.width = `${r.width}px`;
        mini.style.height = `${r.height}px`;
      }
      const g = mini.getContext('2d');
      if (!g) return;
      const W = mini.width;
      g.clearRect(0, 0, W, W);
      const me = sim.mode === 'drive' && sim.vehicle ? sim.vehicle.pos : sim.aircraft.pos;
      const span = mm.span || 4000;
      const k = W / span;
      const c = W / 2;
      g.save();
      g.beginPath();
      g.arc(c, c, c - 4, 0, Math.PI * 2);
      g.clip();
      for (const d of dots) {
        let x = c + (d.x - me.x) * k;
        let y = c + (d.z - me.z) * k;
        // Off the edge: pin them to the rim, so a friend out of range is still a direction.
        const dx = x - c;
        const dy = y - c;
        const rr = Math.hypot(dx, dy);
        const edge = c - 12;
        const off = rr > edge;
        if (off) {
          x = c + (dx / rr) * edge;
          y = c + (dy / rr) * edge;
        }
        const a = (d.heading * Math.PI) / 180;
        g.save();
        g.translate(x, y);
        g.rotate(a);
        g.fillStyle = d.colour;
        g.strokeStyle = 'rgba(8, 13, 22, 0.9)';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(0, -12);
        g.lineTo(8, 9);
        g.lineTo(0, 4);
        g.lineTo(-8, 9);
        g.closePath();
        g.globalAlpha = off ? 0.75 : 1;
        g.stroke();
        g.fill();
        g.restore();
      }
      /*
       * List 2, part 2: whatever else the game shares — a crash somebody had,
       * the race's gates, the host's AI aeroplanes. Each gets a way to turn a
       * place into a point on this canvas: [x, y, off] with `off` for a place
       * past the rim, pinned to it.
       */
      if (more) {
        const toXY = (wx, wz) => {
          let x = c + (wx - me.x) * k;
          let y = c + (wz - me.z) * k;
          const dx = x - c;
          const dy = y - c;
          const rr = Math.hypot(dx, dy);
          const edge = c - 12;
          if (rr > edge) return [c + (dx / rr) * edge, c + (dy / rr) * edge, true];
          return [x, y, false];
        };
        for (const fn of extras) {
          try {
            g.save();
            fn(g, toXY, sim);
          } catch (e) {
            /* one feature's marks are not worth the others' */
          } finally {
            g.restore();
          }
        }
      }
      g.restore();
    },
  };
  return hud;
}

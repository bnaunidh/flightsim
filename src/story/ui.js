/**
 * SIGNAL ZERO — the interface: the Story card, the Story screen and its
 * children, the briefing card, the debrief, the fail panel, the TO BE
 * CONTINUED card, the pause additions and the objective tracker.
 *
 * Same shape as features/achievements/ui.js: elements added to things
 * main.js and menus.js already built, neither of which knows this exists.
 *
 *   Main menu ──► STORY screen
 *                   ├─ CONTINUE  (only if a save exists; "Chapter 1 · The Glint — checkpoint: On final · saved 2 min ago")
 *                   ├─ CHAPTERS  → the 13 tiles (12 + Epilogue); locked ones are a number and "???"
 *                   ├─ NEW GAME  → difficulty → (confirm if a save exists) → chapter 1
 *                   ├─ EXTRAS    → Kittiwake Files · Cast · Achievements
 *                   └─ BACK
 *
 * The STORY card goes FIRST on every game's front page, the same size as
 * Free Flight (owner decision 6), through ui/game-ui.js's GAME_UI table — a
 * card added only in menus.js never shows (the project's own note).
 */

import { GAME_UI } from '../ui/game-ui.js';
import { MAPS } from '../world/maps.js';
import { CHAPTERS, STORY_CHAPTER_COUNT, chapterLabel, chapterById, TITLE } from './chapters.js';
import { CAST, FILES } from './script.js';
import { portrait } from './portraits.js';
import * as Save from './save.js';
import { D, newGame, continueGame, replayChapter, setSkipCinematics, setDifficulty, retryFromCheckpoint, restartChapter, quitToStory } from './director.js';
import { extLayer } from '../game/extensions.js';

const NEW_RIBBON_DAYS = 7;

const CSS = /* css */ `
.sz-mark { display: inline-block; vertical-align: middle; }
.card-btn[data-act="story"] { position: relative; overflow: hidden;
  background: linear-gradient(120deg, rgba(255,191,71,0.16), rgba(40,55,90,0.34)); border-color: rgba(255,191,71,0.4); }
.card-btn[data-act="story"] .card-icon { color: #ffbf47; }
.card-btn[data-act="story"] .sz-prog { display: block; height: 4px; margin-top: 7px; border-radius: 2px; background: rgba(255,255,255,0.1); overflow: hidden; }
.card-btn[data-act="story"] .sz-prog i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #ffbf47, #ff7a1a); transition: width 0.4s ease; }
.card-btn[data-act="story"] .sz-new { position: absolute; top: 10px; right: -30px; transform: rotate(38deg); background: #ffbf47; color: #0b1220;
  font: 800 10px/1 var(--font); letter-spacing: 0.2em; padding: 4px 36px; text-transform: uppercase; }

.sz-screen .sz-word { display: flex; align-items: center; gap: 14px; margin: 4px 0 18px; }
.sz-screen .sz-word h2 { margin: 0; font-size: clamp(28px, 5vw, 44px); font-weight: 850; letter-spacing: 0.14em; text-transform: uppercase; text-shadow: 0 2px 18px rgba(0,0,0,0.7); }
.sz-screen .sz-word h2 .sz-o { color: #ffbf47; }
.sz-screen .sz-word p { margin: 2px 0 0; color: var(--text-dim); font-size: 14px; }
.sz-hub { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
.sz-hub .sz-big { grid-column: 1 / -1; }
.sz-opt { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; padding: 16px 18px; border-radius: 16px; cursor: pointer; font: inherit;
  color: var(--text); border: 1px solid var(--panel-line); background: linear-gradient(120deg, rgba(120,150,210,0.16), rgba(40,55,90,0.3)); transition: transform 0.15s ease; }
.sz-opt:hover { transform: translateY(-3px); }
.sz-opt:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.sz-opt.is-primary { background: linear-gradient(120deg, rgba(255,191,71,0.22), rgba(255,122,26,0.18)); border-color: rgba(255,191,71,0.5); }
.sz-opt.is-off { opacity: 0.45; cursor: default; }
.sz-opt .sz-ico { width: 30px; height: 30px; flex: none; color: #ffbf47; display: grid; place-items: center; }
.sz-opt strong { display: block; font-size: 18px; }
.sz-opt em { display: block; font-style: normal; font-size: 13.5px; opacity: 0.85; margin-top: 2px; }
.sz-note { color: var(--text-dim); font-size: 13px; margin: 8px 0 0; }
.sz-warn { color: var(--amber); font-size: 13px; margin: 8px 0 0; }

.sz-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 10px; }
.sz-tile { position: relative; border-radius: 14px; border: 1px solid var(--panel-line); padding: 12px 14px 12px; min-height: 96px; cursor: pointer; text-align: left; font: inherit; color: var(--text);
  background: linear-gradient(160deg, rgba(20,32,52,0.9), rgba(11,18,32,0.9)); }
.sz-tile.is-locked { opacity: 0.55; cursor: default; }
.sz-tile.is-done { border-color: rgba(255,191,71,0.45); }
.sz-tile.is-next { border-color: rgba(126,232,178,0.6); box-shadow: 0 0 0 1px rgba(126,232,178,0.25) inset; }
.sz-tile .sz-n { font: 800 11px/1 var(--font); letter-spacing: 0.22em; color: var(--text-dim); text-transform: uppercase; }
.sz-tile h4 { margin: 4px 0 2px; font-size: 16px; }
.sz-tile p { margin: 0; font-size: 12px; color: var(--text-dim); line-height: 1.35; }
.sz-tile .sz-medal { position: absolute; top: 10px; right: 10px; }
.sz-medal { display: inline-block; width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.5); vertical-align: middle; }
.sz-medal.is-bronze { background: radial-gradient(circle at 35% 35%, #dd9a5c, #8a4a12); }
.sz-medal.is-silver { background: radial-gradient(circle at 35% 35%, #eef2f6, #8b96a6); }
.sz-medal.is-gold { background: radial-gradient(circle at 35% 35%, #ffdd80, #b9842a); }
.sz-medal.is-big { width: 54px; height: 54px; border-width: 3px; }
.sz-badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font: 700 11px/1 var(--font); letter-spacing: 0.08em; text-transform: uppercase;
  background: rgba(255,191,71,0.16); border: 1px solid rgba(255,191,71,0.45); color: #ffd98a; margin: 2px 4px 2px 0; }

.sz-brief { display: grid; grid-template-columns: minmax(220px, 320px) 1fr; gap: 20px; align-items: start; }
.sz-brief canvas { width: 100%; aspect-ratio: 1; border-radius: 14px; border: 1px solid var(--panel-line); background: #0b1a2c; display: block; }
.sz-brief ul { margin: 12px 0 0; padding-left: 20px; font-size: 15px; line-height: 1.5; }
.sz-brief li { margin-bottom: 8px; }
.sz-brief .sz-meta { font: 700 12px/1.4 var(--font); letter-spacing: 0.18em; text-transform: uppercase; color: #ffbf47; }
.sz-brief h3 { margin: 4px 0 2px; font-size: 26px; letter-spacing: 0.06em; text-transform: uppercase; }
.sz-go { display: flex; align-items: center; gap: 14px; margin-top: 18px; }
.sz-go .sz-count { color: var(--text-dim); font-size: 12.5px; }
@media (max-width: 720px) { .sz-brief { grid-template-columns: 1fr; } }

.sz-debrief .sz-top { display: flex; align-items: center; gap: 16px; margin-bottom: 10px; }
.sz-debrief .sz-score { font-size: 40px; font-weight: 800; }
.sz-debrief .sz-score span { font-size: 16px; color: var(--text-dim); }
.sz-rows { list-style: none; padding: 0; margin: 10px 0; }
.sz-rows li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 0; border-bottom: 1px solid var(--panel-line); font-size: 14px; }
.sz-rows li b { color: #ffd98a; }
.sz-tbc { text-align: center; padding: 26px 10px; }
.sz-tbc h2 { font-size: clamp(30px, 6vw, 52px); letter-spacing: 0.18em; text-transform: uppercase; margin: 10px 0 6px; font-weight: 850; }
.sz-tbc p { color: var(--text-dim); font-size: 15px; }

.sz-pause { border: 1px solid rgba(255,191,71,0.35); border-radius: 14px; padding: 10px 12px 12px; margin-bottom: 12px; background: rgba(255,191,71,0.07); }
.sz-pause[hidden] { display: none; }
.sz-pause .sz-ptitle { font: 800 11px/1 var(--font); letter-spacing: 0.22em; text-transform: uppercase; color: #ffbf47; margin-bottom: 8px; }
.sz-pause .sz-pline { font-size: 12.5px; color: var(--text-dim); margin-bottom: 8px; }
.sz-pause .sz-pbtns { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 6px; }
.sz-pause .sz-pbtns button { font-size: 13px; padding: 8px 10px; }
.sz-pause .sz-pset { display: flex; flex-wrap: wrap; gap: 10px 16px; margin-top: 8px; font-size: 12.5px; color: var(--text-dim); align-items: center; }
.sz-pause .sz-pset select { font: inherit; background: var(--panel-solid); color: var(--text); border: 1px solid var(--panel-line); border-radius: 8px; padding: 3px 6px; }
.sz-pmap { margin-top: 10px; display: none; gap: 12px; grid-template-columns: 180px 1fr; align-items: start; }
.sz-pmap.on { display: grid; }
.sz-pmap canvas { width: 180px; height: 180px; border-radius: 10px; border: 1px solid var(--panel-line); display: block; }

#sz-tracker { position: fixed; left: 14px; top: 38%; width: 250px; pointer-events: none; z-index: 29;
  font-family: var(--font); color: #eaf1fb; opacity: 0; transition: opacity 0.4s ease; }
#sz-tracker.on { opacity: 1; }
#sz-tracker .sz-tbox { background: rgba(6,10,18,0.78); border: 1px solid rgba(140,180,230,0.22); border-radius: 12px; padding: 8px 12px 9px;
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); }
#sz-tracker .sz-ttitle { font: 800 10.5px/1 var(--font); letter-spacing: 0.2em; text-transform: uppercase; color: #ffbf47; margin-bottom: 6px; }
#sz-tracker ol { list-style: none; margin: 0; padding: 0; }
#sz-tracker li { display: flex; gap: 8px; align-items: flex-start; font-size: 12.5px; line-height: 1.3; padding: 3px 0; color: #b9c6d8; }
#sz-tracker li .sz-dot { flex: none; width: 12px; height: 12px; margin-top: 2px; border-radius: 50%; border: 1.5px solid #6f82a0; }
#sz-tracker li.is-done { color: #7a8a9f; text-decoration: line-through; }
#sz-tracker li.is-done .sz-dot { background: #4fd684; border-color: #4fd684; }
#sz-tracker li.is-active { color: #fff; font-weight: 650; }
#sz-tracker li.is-active .sz-dot { border-color: #ffbf47; background: rgba(255,191,71,0.35); }
#sz-tracker li.is-failed { color: #ff8a7a; }
#sz-tracker li.is-failed .sz-dot { border-color: #ff6a5c; background: rgba(255,106,92,0.3); }
#sz-tracker li .sz-meter { display: block; height: 3px; margin-top: 4px; border-radius: 2px; background: rgba(255,255,255,0.12); overflow: hidden; width: 100%; }
#sz-tracker li .sz-meter i { display: block; height: 100%; background: #ffbf47; width: 0; }
#sz-tracker li .sz-note { display: block; font-size: 11px; color: #9fb2cc; font-weight: 500; }
/* In the HUD's right-hand stack it is a card like the others: there only while it is on, and folded to its step. */
.hud-rstack > #sz-tracker:not(.on) { display: none !important; }
.hud-rstack > #sz-tracker { opacity: 1; }
#sz-tracker.rs-chip .sz-ttitle, #sz-tracker.rs-chip li:not(.is-active) { display: none; }
#sz-tracker.rs-chip .sz-tbox { padding: 6px 10px; }
.is-touch-device #sz-tracker { top: 30%; width: 200px; }
@media (max-width: 720px) { #sz-tracker { width: 190px; left: 8px; } #sz-tracker li { font-size: 11.5px; } }
`;

const KITTIWAKE = (size = 24) => `<svg class="sz-mark" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12.5c3.2-3.4 6.4-4.2 9.5-1.1 3.1-3.1 6.3-2.3 9.5 1.1"/><path d="M12 11.4c-.6 2.6-1.6 4.9-3.1 7"/><path d="M12 11.4c.6 2.6 1.6 4.9 3.1 7"/><circle cx="12" cy="9.2" r="0.6" fill="currentColor"/></svg>`;

function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function medalHtml(m, big = false) {
  return m ? `<span class="sz-medal is-${m}${big ? ' is-big' : ''}" title="${m}"></span>` : '';
}

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('sz-ui-style')) return;
  const s = document.createElement('style');
  s.id = 'sz-ui-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ====================================================================== */

export function installStoryUi(sim) {
  injectStyle();
  const menus = sim.menus;
  const U = {
    sim,
    menus,
    tracker: null,
    trackerItems: [],
    trackerTitle: '',
    trackerT: 0,
    trackerKey: '',
    pauseBlock: null,
    briefTimer: null,
    briefKey: null,
    chapterOpen: null,
  };

  /* ---- the Story card, first on every game's front page ---------------- */
  // The rocket's page is in the table too by now (rocket/menu.js installs before this).
  for (const g of ['flight', 'heli', 'boat', 'car', 'rocket']) {
    const def = GAME_UI[g];
    if (!def || !def.cards || def.cards.some((c) => c.to === 'story')) continue;
    def.cards.unshift({ to: 'story', icon: 'target', title: 'Story — Signal Zero', sub: 'A 12-chapter story across every vehicle' });
  }
  const applyGameUi = menus.applyGameUi;
  menus.applyGameUi = function storyApplyGameUi() {
    applyGameUi.call(menus);
    refreshCard();
  };
  const show = menus.show.bind(menus);
  menus.show = function storyShow(name) {
    show(name);
    if (name === 'main') refreshCard();
    if (name === 'story') renderHub();
    if (name === 'story-chapters') renderChapters();
    if (name === 'story-extras') renderExtras();
    if (name !== 'story-briefing') clearBriefing();
  };
  if (menus.screens.main && !menus._storyActBound) {
    menus._storyActBound = true;
    menus.screens.main.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act="story"]');
      if (!btn) return;
      menus.show('story');
    });
  }

  function refreshCard() {
    const main = menus.screens.main;
    if (!main) return;
    for (const btn of main.querySelectorAll('[data-act="story"]')) {
      const ico = btn.querySelector('.card-icon');
      if (ico && !ico.querySelector('.sz-mark')) ico.innerHTML = KITTIWAKE(26);
      const em = btn.querySelector('em');
      if (!em) continue;
      const data = D.data || Save.blank();
      const done = CHAPTERS.filter((c) => !c.epilogue && data.chapters[c.id] && data.chapters[c.id].done).length;
      let line;
      if (data.chapter) {
        const ch = chapterById(data.chapter);
        line = ch ? (ch.available ? chapterLabel(ch) : `${done} of ${STORY_CHAPTER_COUNT} chapters done · more coming`) : 'Continue your story';
      } else {
        line = 'New — a 12-chapter story across every vehicle';
      }
      const pct = Math.round((done / STORY_CHAPTER_COUNT) * 100);
      em.innerHTML = `${esc(line)}<span class="sz-prog"><i style="width:${pct}%"></i></span>`;
      const fresh = !data.chapter && Date.now() - (data.flags.firstSeen || Date.now()) < NEW_RIBBON_DAYS * 86400e3;
      let rib = btn.querySelector('.sz-new');
      if (fresh && !rib) btn.appendChild(h('<span class="sz-new">New</span>'));
      else if (!fresh && rib) rib.remove();
    }
  }

  /* ---- screens ------------------------------------------------------- */
  function screen(id, title, bodyHtml, back = 'story') {
    const s = h(`
      <section class="screen screen-list sz-screen" data-screen="${id}" hidden>
        <header class="screen-head">
          <button class="ghost" data-back>← Back</button>
          <h2>${esc(title)}</h2>
          <span></span>
        </header>
        <div class="sz-body">${bodyHtml}</div>
      </section>`);
    s.addEventListener('click', (e) => {
      if (e.target.closest('[data-back]')) menus.show(typeof back === 'function' ? back() : back);
    });
    menus.layer.appendChild(s);
    menus.screens[id] = s;
    return s;
  }

  // The hub.
  const hub = screen('story', 'Story', `
    <div class="sz-word">${KITTIWAKE(44)}<div><h2>SIGNAL ZER<span class="sz-o">O</span></h2><p>A 12-chapter story across every vehicle. Leave whenever: it saves at every checkpoint.</p></div></div>
    <div class="sz-hub" data-hub></div>
    <p class="sz-note" data-hub-note></p>`, 'main');
  hub.addEventListener('click', (e) => {
    const b = e.target.closest('[data-story]');
    if (!b) return;
    const act = b.dataset.story;
    if (act === 'continue') continueGame();
    else if (act === 'chapters') menus.show('story-chapters');
    else if (act === 'new') menus.show('story-new');
    else if (act === 'extras') menus.show('story-extras');
  });

  function renderHub() {
    const data = D.data || Save.blank();
    const host = hub.querySelector('[data-hub]');
    const plan = Save.resumePlan(data, CHAPTERS);
    let cont = '';
    if (plan.kind === 'resume' || plan.kind === 'start' || plan.kind === 'tbc') {
      const ch = chapterById(data.chapter);
      const where = plan.kind === 'resume' ? `checkpoint: ${data.checkpoint || 'where you left off'}` : plan.kind === 'tbc' ? 'the next chapter is coming' : 'chapter start';
      const label = ch ? `${ch.epilogue ? ch.title : `Chapter ${ch.n} · ${ch.title}`} — ${where}` : 'Continue';
      cont = `<button class="sz-opt is-primary sz-big" data-story="continue"><span class="sz-ico">${KITTIWAKE(26)}</span><span><strong>Continue</strong><em>${esc(label)} · ${esc(Save.agoLabel(data.savedAt))}</em></span></button>`;
    }
    const done = CHAPTERS.filter((c) => data.chapters[c.id] && data.chapters[c.id].done).length;
    host.innerHTML = `${cont}
      <button class="sz-opt" data-story="chapters"><span class="sz-ico">▦</span><span><strong>Chapters</strong><em>${done ? `${done} finished — replay for gold and the Files` : 'Chapter 1 is ready; the rest unlock in order'}</em></span></button>
      <button class="sz-opt${cont ? '' : ' is-primary'}" data-story="new"><span class="sz-ico">▶</span><span><strong>${cont ? 'New game' : 'Start the story'}</strong><em>Pick a difficulty. Chapter 1 opens in the air.</em></span></button>
      <button class="sz-opt" data-story="extras"><span class="sz-ico">✦</span><span><strong>Extras</strong><em>Kittiwake Files, the cast, achievements</em></span></button>`;
    hub.querySelector('[data-hub-note]').textContent = D.storageOk
      ? 'Voices are text and subtitles. Cutscenes are short and skippable. Reduce flashing is respected.'
      : 'Progress cannot be saved on this device (storage is blocked). The story still plays.';
  }

  // Chapters.
  const chaptersScreen = screen('story-chapters', 'Chapters', `<div class="sz-grid" data-tiles></div><div data-chapter-card></div>`);
  chaptersScreen.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tile]');
    if (t && !t.classList.contains('is-locked')) {
      U.chapterOpen = t.dataset.tile;
      renderChapters();
      return;
    }
    const play = e.target.closest('[data-play]');
    if (play) {
      replayChapter(play.dataset.play);
      return;
    }
    if (e.target.closest('[data-close-card]')) {
      U.chapterOpen = null;
      renderChapters();
    }
  });

  function renderChapters() {
    const data = D.data || Save.blank();
    const host = chaptersScreen.querySelector('[data-tiles]');
    const reached = data.chapter ? (chapterById(data.chapter) || { n: 1 }).n : 0;
    host.innerHTML = CHAPTERS.map((c) => {
      const st = data.chapters[c.id];
      const done = !!(st && st.done);
      const open = c.available && (done || c.n <= Math.max(1, reached));
      const locked = !open;
      const cls = locked ? 'is-locked' : done ? 'is-done' : 'is-next';
      const n = c.epilogue ? 'Epilogue' : `Chapter ${c.n}`;
      const title = locked ? '???' : c.title;
      const sub = locked ? (c.available ? 'Locked — play the chapters before it' : 'Coming soon') : done
        ? `${st.medal ? st.medal[0].toUpperCase() + st.medal.slice(1) : 'Done'} · best ${st.score} · ${FILES && Object.values(FILES).some((f) => f.chapter === c.id) ? `files ${data.flags.files.filter((f) => FILES[f] && FILES[f].chapter === c.id).length}/${Object.values(FILES).filter((f) => f.chapter === c.id).length}` : 'no files'}${st.bestTime ? ` · ${fmtTime(st.bestTime)}` : ''}`
        : `${c.place} · ${c.vehicle} · about ${c.minutes} min`;
      return `<button class="sz-tile ${cls}" data-tile="${c.id}" ${locked ? 'aria-disabled="true"' : ''}><span class="sz-n">${n}</span><h4>${esc(title)}</h4><p>${esc(sub)}</p>${done ? `<span class="sz-medal is-${st.medal || 'bronze'}"></span>` : ''}</button>`;
    }).join('');
    const card = chaptersScreen.querySelector('[data-chapter-card]');
    const c = U.chapterOpen ? chapterById(U.chapterOpen) : null;
    if (!c) {
      card.innerHTML = '';
      return;
    }
    const st = data.chapters[c.id];
    card.innerHTML = `
      <div class="pause-card debrief-card" style="margin-top:14px">
        <h2>${esc(c.epilogue ? c.title : `Chapter ${c.n} — ${c.title}`)}</h2>
        <p class="sz-note">${esc(c.place)} · ${esc(c.when)} · ${esc(c.vehicle)} · about ${c.minutes} min</p>
        <p>${esc(c.blurb)}</p>
        ${st && st.done ? `<p class="sz-note">Best: ${medalHtml(st.medal)} ${esc((st.medal || 'done').toUpperCase())} · ${st.score}/100${st.style && st.style.length ? ' · ' + st.style.map((s) => `<span class="sz-badge">${esc(s.replace(/-/g, ' '))}</span>`).join('') : ''}</p>` : ''}
        <div class="pause-actions">
          <button class="primary" data-play="${c.id}">${st && st.done ? 'Replay (medals and files count; your place in the story is kept)' : 'Play'}</button>
          <button data-close-card>Close</button>
        </div>
      </div>`;
  }

  // New game.
  const newScreen = screen('story-new', 'New game', `
    <p class="sz-note">Pick how it plays. You can change it any time from the pause menu.</p>
    <div class="sz-hub" data-diffs>
      <button class="sz-opt" data-diff="story"><span class="sz-ico">○</span><span><strong>Story</strong><em>Timers +40%, Cole takes his time, assists on. For the story.</em></span></button>
      <button class="sz-opt is-primary" data-diff="pilot"><span class="sz-ico">◎</span><span><strong>Pilot</strong><em>The way it is meant to be flown.</em></span></button>
      <button class="sz-opt" data-diff="ace"><span class="sz-ico">◉</span><span><strong>Ace</strong><em>Tight timers, a quick rival, no help. An ACE ribbon on your medals.</em></span></button>
    </div>
    <div data-confirm hidden>
      <p class="sz-warn">This replaces your story progress. Medals, files and achievements stay.</p>
      <div class="pause-actions"><button class="primary" data-start-over>Start over</button><button data-keep>Keep my progress</button></div>
    </div>`);
  let chosenDiff = 'pilot';
  newScreen.addEventListener('click', (e) => {
    const d = e.target.closest('[data-diff]');
    if (d) {
      chosenDiff = d.dataset.diff;
      for (const b of newScreen.querySelectorAll('[data-diff]')) b.classList.toggle('is-primary', b === d);
      if (Save.hasProgress(D.data)) newScreen.querySelector('[data-confirm]').hidden = false;
      else newGame(chosenDiff);
      return;
    }
    if (e.target.closest('[data-start-over]')) newGame(chosenDiff);
    if (e.target.closest('[data-keep]')) menus.show('story');
  });

  // Extras.
  const extras = screen('story-extras', 'Extras', `<div data-extras></div>`);
  extras.addEventListener('click', (e) => {
    if (e.target.closest('[data-open-ach]') && menus.screens.achievements) menus.show('achievements');
  });
  function renderExtras() {
    const data = D.data || Save.blank();
    const reached = data.chapter ? (chapterById(data.chapter) || { n: 1 }).n : 0;
    const files = Object.entries(FILES).map(([id, f]) => {
      const got = data.flags.files.includes(id);
      const ch = chapterById(f.chapter);
      return `<div class="sz-tile ${got ? 'is-done' : 'is-locked'}" style="cursor:default"><span class="sz-n">${esc(got ? f.title : `File ${id.slice(1)} · Chapter ${ch ? ch.n : '?'}`)}</span>${got ? `<p style="white-space:pre-line;color:#eaf1fb">${esc(f.text)}</p>` : `<p>${esc(reached >= (ch ? ch.n : 99) ? f.where : 'Not found yet.')}</p>`}</div>`;
    }).join('');
    const cast = Object.entries(CAST).map(([id, c]) => {
      const seen = c.firstSeen <= Math.max(1, reached) || (data.chapters && Object.keys(data.chapters).length >= c.firstSeen);
      const por = seen ? portrait(id, 120).toDataURL('image/png') : null;
      return `<div class="sz-tile is-${seen ? 'done' : 'locked'}" style="cursor:default;display:flex;gap:12px;align-items:center">${por ? `<img src="${por}" width="56" height="56" style="border-radius:50%;flex:none" alt="">` : '<span class="sz-medal is-big" style="opacity:.3;flex:none"></span>'}<span><span class="sz-n" style="color:${seen ? c.colour : 'inherit'}">${esc(seen ? c.name : '???')}</span><p>${esc(seen ? c.role || ' ' : 'Not met yet')}</p></span></div>`;
    }).join('');
    extras.querySelector('[data-extras]').innerHTML = `
      <h3 class="fail-heading">Kittiwake Files</h3>
      <div class="sz-grid">${files}</div>
      <h3 class="fail-heading">Cast</h3>
      <div class="sz-grid">${cast}</div>
      <h3 class="fail-heading">Achievements</h3>
      <button class="sz-opt" data-open-ach><span class="sz-ico">★</span><span><strong>Achievements</strong><em>The story's own are under "Story — Signal Zero"</em></span></button>`;
  }

  // The briefing card: title, the route, three bullets, GO.
  const brief = screen('story-briefing', 'Briefing', `
    <div class="sz-brief">
      <canvas data-brief-map width="320" height="320"></canvas>
      <div>
        <div class="sz-meta" data-brief-meta></div>
        <h3 data-brief-title></h3>
        <p class="sz-note" data-brief-line></p>
        <ul data-brief-bullets></ul>
        <div class="sz-go"><button class="primary big" data-go style="width:auto;margin:0">GO</button><span class="sz-count" data-brief-count>Hold SPACE to skip · starts on its own in 20 s</span></div>
      </div>
    </div>`, () => {
    // Back out of the briefing: the chapter is stood down, not left half-started.
    const back = briefBack;
    clearBriefing();
    if (back) back();
    return 'story';
  });
  let briefGo = null;
  let briefBack = null;
  brief.addEventListener('click', (e) => {
    if (e.target.closest('[data-go]')) fireGo();
  });
  function fireGo() {
    const go = briefGo;
    clearBriefing();
    if (go) {
      menus.hide();
      go();
    }
  }
  function clearBriefing() {
    if (U.briefTimer) clearTimeout(U.briefTimer);
    U.briefTimer = null;
    if (U.briefKey) window.removeEventListener('keydown', U.briefKey, true);
    U.briefKey = null;
    briefGo = null;
    briefBack = null;
  }
  function showBriefing(ch, mod, { onGo, onBack = null }) {
    briefBack = onBack;
    const b = mod.briefing || {};
    brief.querySelector('[data-brief-meta]').textContent = `Chapter ${ch.n} of ${STORY_CHAPTER_COUNT} · ${ch.place} · ${ch.when}`;
    brief.querySelector('[data-brief-title]').textContent = ch.title;
    brief.querySelector('[data-brief-line]').textContent = b.line || ch.blurb;
    brief.querySelector('[data-brief-bullets]').innerHTML = (b.bullets || []).map((t) => `<li>${esc(t)}</li>`).join('');
    drawRouteMap(brief.querySelector('[data-brief-map]'), ch, b.route || [], null);
    briefGo = onGo;
    menus.show('story-briefing');
    const started = Date.now();
    const count = brief.querySelector('[data-brief-count]');
    const tick = () => {
      const left = Math.max(0, 20 - Math.round((Date.now() - started) / 1000));
      count.textContent = `Hold SPACE to skip · starts on its own in ${left} s`;
      if (left <= 0) fireGo();
      else U.briefTimer = setTimeout(tick, 1000);
    };
    U.briefTimer = setTimeout(tick, 1000);
    // The briefing is a dialog, not the game: its own Enter (and the space bar
    // the card names) are the form's keys, like every "press Enter" box in menus.js.
    U.briefKey = (e) => {
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        fireGo();
      }
    };
    window.addEventListener('keydown', U.briefKey, true);
  }

  // The debrief.
  const debrief = screen('story-debrief', 'Debrief', `<div class="pause-card debrief-card sz-debrief" data-debrief></div>`);
  let debriefActs = null;
  debrief.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dact]');
    if (!b || !debriefActs) return;
    const fn = debriefActs[b.dataset.dact];
    if (fn) fn();
  });
  function showDebrief(ch, verdict, best, acts) {
    debriefActs = acts;
    const next = Save.nextChapter(ch.id, CHAPTERS);
    const rows = (verdict.breakdown || []).map((r) => `<li><span>${esc(r.label)}</span><b>${esc(r.value)}</b></li>`).join('');
    const style = (verdict.style || []).map((s) => `<span class="sz-badge">${esc(s.replace(/-/g, ' '))}</span>`).join('');
    const files = Object.entries(FILES).filter(([, f]) => f.chapter === ch.id);
    const gotFiles = files.filter(([id]) => (D.data.flags.files || []).includes(id)).length;
    debrief.querySelector('[data-debrief]').innerHTML = `
      <h2 class="debrief-title is-good">Chapter ${ch.n} complete — ${esc(ch.title)}</h2>
      <div class="sz-top">${medalHtml(verdict.medal, true)}<div><div class="sz-score">${verdict.score}<span>/100</span></div><div class="sz-note">${esc(String(verdict.medal || '').toUpperCase())} medal${D.data.difficulty === 'ace' ? ' · ACE' : ''}${best && best.medal && best.medal !== verdict.medal ? ` · best ${esc(best.medal)}` : ''}</div></div></div>
      <ul class="sz-rows">${rows}<li><span>Time</span><b>${fmtTime(verdict.time)}</b></li>${files.length ? `<li><span>Kittiwake File</span><b>${gotFiles}/${files.length}${gotFiles < files.length ? ' — still out there' : ''}</b></li>` : ''}</ul>
      ${style ? `<p>${style}</p>` : ''}
      <p class="sz-note">${esc(verdict.note || '')}</p>
      <div class="pause-actions">
        <button class="primary" data-dact="next">${next && next.available ? `Next chapter — ${esc(next.title)}` : 'Continue'}</button>
        <button data-dact="replay">Replay chapter</button>
        <button data-dact="menu">Story menu</button>
      </div>`;
    menus.show('story-debrief');
  }

  // Failed: a kind line, then Retry from checkpoint.
  const fail = screen('story-fail', 'Not this time', `<div class="pause-card debrief-card" data-fail></div>`);
  let failActs = null;
  fail.addEventListener('click', (e) => {
    const b = e.target.closest('[data-fact]');
    if (!b || !failActs) return;
    const fn = failActs[b.dataset.fact];
    if (fn) fn();
  });
  function showFail(reason, cp, acts) {
    failActs = acts;
    fail.querySelector('[data-fail]').innerHTML = `
      <h2 class="debrief-title is-bad">Not this time</h2>
      <p class="debrief-reason">${esc(reason)}</p>
      <p>Everybody walks away in this simulator. Checkpoint: <b>${esc(cp ? cp.label : 'chapter start')}</b>.</p>
      <div class="pause-actions">
        <button class="primary" data-fact="retry">Retry from checkpoint</button>
        <button data-fact="restart">Restart chapter</button>
        <button data-fact="quit">Quit to Story menu</button>
      </div>`;
    menus.show('story-fail');
  }

  // TO BE CONTINUED.
  const tbc = screen('story-tbc', 'Signal Zero', `<div class="sz-tbc" data-tbc></div>`);
  tbc.addEventListener('click', (e) => {
    if (e.target.closest('[data-tbc-menu]')) menus.show('story');
  });
  function showTbc(last, next, best) {
    tbc.querySelector('[data-tbc]').innerHTML = `
      ${KITTIWAKE(48)}
      <h2>To be continued</h2>
      <p>${next ? `${esc(next.epilogue ? next.title : `Chapter ${next.n} — ${next.title}`)} arrives in the next update.` : 'That is the whole story for now.'}</p>
      ${best && best.medal ? `<p>${medalHtml(best.medal, true)}<br>${esc(`Chapter ${last.n} — ${last.title}`)}: ${esc(best.medal.toUpperCase())} · ${best.score}/100</p>` : ''}
      <p class="sz-note">Your place is saved. Replay any finished chapter from Chapters for gold and the Files.</p>
      <div class="pause-actions" style="justify-content:center"><button class="primary" data-tbc-menu>Story menu</button></div>`;
    menus.show('story-tbc');
  }

  /* ---- the pause menu's story block ------------------------------------ */
  const pauseCard = menus.screens.pause && menus.screens.pause.querySelector('.pause-card');
  if (pauseCard && !pauseCard.querySelector('.sz-pause')) {
    const block = h(`
      <div class="sz-pause" hidden data-sz-pause>
        <div class="sz-ptitle">Signal Zero</div>
        <div class="sz-pline" data-pline></div>
        <div class="sz-pbtns">
          <button data-pact="map">Objectives &amp; map</button>
          <button data-pact="retry">Retry from checkpoint</button>
          <button data-pact="restart">Restart chapter</button>
          <button data-pact="quit">Save &amp; quit</button>
        </div>
        <div class="sz-pmap" data-pmap><canvas width="180" height="180" data-pmap-canvas></canvas><ol data-pmap-list style="margin:0;padding-left:18px;font-size:13px;line-height:1.5"></ol></div>
        <div class="sz-pset">
          <label><input type="checkbox" data-pskip> Skip cinematics</label>
          <label>Difficulty <select data-pdiff><option value="story">Story</option><option value="pilot">Pilot</option><option value="ace">Ace</option></select></label>
        </div>
      </div>`);
    const title = pauseCard.querySelector('h2');
    if (title && title.nextSibling) pauseCard.insertBefore(block, title.nextSibling);
    else pauseCard.appendChild(block);
    block.addEventListener('click', (e) => {
      const b = e.target.closest('[data-pact]');
      if (!b) return;
      e.stopPropagation();
      const a = b.dataset.pact;
      if (a === 'map') {
        const m = block.querySelector('[data-pmap]');
        m.classList.toggle('on');
        if (m.classList.contains('on')) {
          const ch = D.chapter;
          const route = (D.mod && D.mod.briefing && D.mod.briefing.route) || [];
          drawRouteMap(block.querySelector('[data-pmap-canvas]'), ch, route, sim.aircraft ? sim.aircraft.pos : null);
          block.querySelector('[data-pmap-list]').innerHTML = U.trackerItems.map((it) => `<li class="${it.state === 'done' ? 'is-done' : ''}" style="${it.state === 'done' ? 'opacity:.55;text-decoration:line-through' : it.state === 'active' ? 'color:#fff;font-weight:650' : ''}">${esc(it.text)}</li>`).join('');
        }
      } else if (a === 'retry') {
        sim.wakeAudio && sim.wakeAudio();
        retryFromCheckpoint();
      } else if (a === 'restart') {
        sim.wakeAudio && sim.wakeAudio();
        restartChapter();
      } else if (a === 'quit') {
        sim.wakeAudio && sim.wakeAudio();
        quitToStory();
      }
    });
    block.querySelector('[data-pskip]').addEventListener('change', (e) => setSkipCinematics(e.target.checked));
    block.querySelector('[data-pdiff]').addEventListener('change', (e) => setDifficulty(e.target.value));
    U.pauseBlock = block;
  }
  function showPauseBlock(on, info) {
    const b = U.pauseBlock;
    if (!b) return;
    b.hidden = !on;
    if (!on) return;
    b.querySelector('[data-pline]').textContent = `${info.chapter} · Saved at: ${info.checkpoint}${info.storageOk ? '' : ' (this device will not keep saves)'}`;
    b.querySelector('[data-pmap]').classList.remove('on');
    b.querySelector('[data-pskip]').checked = !!(D.data && D.data.flags.skipCinematics);
    b.querySelector('[data-pdiff]').value = D.data ? D.data.difficulty : 'pilot';
  }

  /* ---- the objective tracker ------------------------------------------ */
  function tracker() {
    if (U.tracker) return U.tracker;
    const el = h(`<div id="sz-tracker"><div class="sz-tbox"><div class="sz-ttitle" data-ttitle></div><ol data-tlist></ol></div></div>`);
    /*
     * A card in the HUD's right-hand stack (ui/hud-stack.js), with the
     * mission's other panels: on the left at 38% it ran into the smoke chip,
     * the helicopter's card and the missile panel, and on a phone the story's
     * own coach. Information: in the Clean HUD it folds to the step you are on
     * a few seconds after a step changes (.rs-chip, below).
     */
    const stack = sim.hud && sim.hud.stack;
    if (stack && typeof stack.add === 'function') stack.add(el, { prio: 1.6, id: 'story', info: true });
    else extLayer().appendChild(el);
    U.tracker = el;
    return el;
  }
  function setTracker(items, title) {
    U.trackerItems = items || [];
    if (title != null) U.trackerTitle = title;
    renderTracker();
  }
  function renderTracker() {
    const el = tracker();
    // A step changed (not just a meter moving): the whole list for a few
    // seconds, then (in the Clean HUD) only the step you are on.
    const key = `${U.trackerTitle}|${U.trackerItems.map((it) => `${it.state}:${it.text}`).join('|')}`;
    if (key !== U.trackerKey) {
      U.trackerKey = key;
      const stack = sim.hud && sim.hud.stack;
      if (stack && el.parentNode === stack.el) stack.poke(el);
    }
    el.querySelector('[data-ttitle]').textContent = U.trackerTitle || (D.chapter ? `Chapter ${D.chapter.n} · ${D.chapter.title}` : '');
    el.querySelector('[data-tlist]').innerHTML = U.trackerItems.map((it) => `<li class="is-${it.state || 'todo'}"><span class="sz-dot"></span><span style="flex:1;min-width:0">${esc(it.text)}${it.note ? `<span class="sz-note">${esc(it.note)}</span>` : ''}${it.meter != null ? `<span class="sz-meter"><i style="width:${Math.round(Math.max(0, Math.min(1, it.meter)) * 100)}%"></i></span>` : ''}</span></li>`).join('');
  }
  function showTracker(on) {
    const el = tracker();
    el.classList.toggle('on', !!on && U.trackerItems.length > 0);
  }
  function refreshTracker() {
    renderTracker();
  }
  function tickTracker() {
    const el = U.tracker;
    if (!el) return;
    // Hidden with the rest of the interface (U), and never over a menu.
    const hud = sim.hud;
    const want = D.active && sim.state === 'flying' && !(hud && hud.hidden) && U.trackerItems.length > 0 && D.phase !== 'cutscene';
    el.classList.toggle('on', want);
  }

  /* ---- the route picture ------------------------------------------------ */
  function drawRouteMap(canvas, ch, route, you) {
    if (!canvas || !ch) return;
    const map = MAPS.find((m) => m.id === ch.map);
    const g = canvas.getContext('2d');
    if (!g) return;
    const W = canvas.width;
    const H = canvas.height;
    g.fillStyle = '#0b1a2c';
    g.fillRect(0, 0, W, H);
    if (!map) return;
    const islands = map.islands || [];
    const pts = [...islands.map((i) => [i.cx, i.cz, i.radius]), ...route.map((p) => [p[0], p[1], 0]), ...(you ? [[you.x, you.z, 0]] : [])];
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const [x, z, r] of pts) {
      minX = Math.min(minX, x - r);
      maxX = Math.max(maxX, x + r);
      minZ = Math.min(minZ, z - r);
      maxZ = Math.max(maxZ, z + r);
    }
    const span = Math.max(maxX - minX, maxZ - minZ) * 1.12 || 1;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const px = (x) => W / 2 + ((x - cx) / span) * W;
    const pz = (z) => H / 2 + ((z - cz) / span) * H;
    const s = (r) => (r / span) * W;
    // Sea, then islands as soft discs (a chart, not a photograph).
    for (const i of islands) {
      const rr = s(i.radius);
      const grad = g.createRadialGradient(px(i.cx), pz(i.cz), rr * 0.2, px(i.cx), pz(i.cz), rr);
      grad.addColorStop(0, i.peak > 150 ? '#6b6a58' : '#4f7a46');
      grad.addColorStop(0.75, '#3b5a3a');
      grad.addColorStop(1, 'rgba(60,90,70,0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(px(i.cx), pz(i.cz), rr, 0, Math.PI * 2);
      g.fill();
    }
    // The runway.
    const ap = map.airport;
    if (ap && ap.runway) {
      const r = ap.runway;
      const hdg = ((ap.headingDeg ?? 90) * Math.PI) / 180;
      const dx = Math.sin(hdg) * r.length * 0.5;
      const dz = -Math.cos(hdg) * r.length * 0.5;
      g.strokeStyle = '#e8eef7';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(px(r.cx - dx), pz(r.cz - dz));
      g.lineTo(px(r.cx + dx), pz(r.cz + dz));
      g.stroke();
    }
    // The route: a dashed amber line with numbered marks.
    if (route.length) {
      g.strokeStyle = '#ffbf47';
      g.lineWidth = 2;
      g.setLineDash([6, 5]);
      g.beginPath();
      route.forEach((p, i) => (i ? g.lineTo(px(p[0]), pz(p[1])) : g.moveTo(px(p[0]), pz(p[1]))));
      g.stroke();
      g.setLineDash([]);
      route.forEach((p, i) => {
        g.fillStyle = '#ffbf47';
        g.beginPath();
        g.arc(px(p[0]), pz(p[1]), 7, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#0b1220';
        g.font = '700 10px sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(i + 1), px(p[0]), pz(p[1]) + 0.5);
        if (p[2]) {
          g.fillStyle = '#eaf1fb';
          g.font = '600 10px sans-serif';
          g.textAlign = 'left';
          g.fillText(p[2], px(p[0]) + 10, pz(p[1]));
        }
      });
    }
    if (you) {
      g.fillStyle = '#7ee8b2';
      g.beginPath();
      g.arc(px(you.x), pz(you.z), 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(234,241,251,0.7)';
    g.font = '700 10px sans-serif';
    g.textAlign = 'left';
    g.fillText(map.name.toUpperCase(), 8, H - 8);
  }

  const api = { refreshCard, showBriefing, showDebrief, showFail, showTbc, showPauseBlock, setTracker, showTracker, refreshTracker, tickTracker, drawRouteMap, renderHub };
  // Repaint the front page now that the Story card is in the table.
  menus.applyGameUi();
  return api;
}

function fmtTime(s) {
  const v = Math.max(0, Math.round(s || 0));
  return `${Math.floor(v / 60)}m ${String(v % 60).padStart(2, '0')}s`;
}

export { TITLE };

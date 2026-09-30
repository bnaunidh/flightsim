/**
 * The rocket's place in the menus — all of it from outside menus.js.
 *
 * game-ui.js already made the menu about "whichever game is selected" from
 * a table (GAME_UI) and a bar of buttons (menus.js GAMES), and main.js
 * switches with switchGame(). A fifth game plugs into all three without
 * editing any of them:
 *
 *   - GAME_UI.rocket is added to the table, so setGame('rocket') paints a
 *     front page like the other four;
 *   - a fifth button is added to the bar that is already built (and to the
 *     GAMES list, for anyone who reads it later), and the bar's own click
 *     handler already calls hooks.switchGame, which rocket.js answers;
 *   - its missions go on the board through game-ui.js's registerMissions,
 *     under a heading of their own, 'Space';
 *   - one new screen, the rocket picker, is added to menus.screens, which
 *     is all show() needs to know about it.
 *
 * The same pattern game-ui.js itself uses on menus.js: wrap, never edit.
 */

import { GAME_UI } from '../../ui/game-ui.js';
import { GAMES, MISSION_CATEGORIES } from '../../ui/menus.js';
import { ROCKETS, ROCKET_IDS } from './physics.js';
import { GOALS, ROCKET_MISSIONS } from './flights.js';

export const ROCKET_ACCENT = '#b28dff';

const ROCKET_ICON = '<svg class="icon" viewBox="0 0 24 24" width="SIZE" height="SIZE" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M12 2.8c2.4 2 3.4 4.9 3.4 7.9v5.6H8.6v-5.6c0-3 1-5.9 3.4-7.9Z"/><path d="M8.6 12.6 6 16v2.4l2.6-1.3M15.4 12.6 18 16v2.4l-2.6-1.3"/><circle cx="12" cy="9" r="1.5"/><path d="M10.4 18.6 12 21.4l1.6-2.8"/></svg>';

export function rocketIcon(size = 20) {
  return ROCKET_ICON.replace(/SIZE/g, String(size));
}

/** The front page, in GAME_UI's own shape. */
export const ROCKET_UI = {
  hero: 'Island Rockets',
  line: 'Count down, lift off, and fly to space',
  cards: [
    { to: 'rocket-learn', icon: 'learn', title: 'First Launch', sub: 'Start here — a small rocket, straight up to space' },
    { to: 'rocket-launch', icon: 'rocket', title: 'Launch', sub: 'Pick one of three rockets and what you want it to do' },
    { to: 'missions', icon: 'target', title: 'Missions', sub: 'Reach space, land the booster, put a satellite in orbit' },
    { to: 'maps', icon: 'map', title: 'Choose your island', sub: 'Every island gets its own launch pad by the sea' },
    { to: 'more', icon: 'more', title: 'More', sub: 'Your rank and leaderboard, the hangar, and settings' },
  ],
};

const CSS = `
[data-game="rocket"] .menu-layer { --game-accent: ${ROCKET_ACCENT}; }
.switcher button:where(.switch-btn)[data-game="rocket"].is-on { background: ${ROCKET_ACCENT}; }
.rk-pick-lead { margin: 0 0 14px; color: var(--text-dim, #9fb2cc); font-size: 14px; }
.rk-pick-lead b { color: var(--text, #eaf1fb); }
.rk-pick-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 14px; }
.rk-card { position: relative; display: grid; grid-template-columns: 74px 1fr; gap: 4px 14px; padding: 14px; border-radius: 16px;
  background: rgba(12, 20, 34, 0.72); border: 1px solid rgba(140, 180, 230, 0.16); }
.rk-card .rk-art { grid-row: 1 / span 3; width: 74px; height: 150px; display: grid; place-items: end center;
  background: radial-gradient(ellipse at 50% 100%, rgba(178,141,255,0.22), transparent 70%); border-radius: 12px; }
.rk-card h3 { margin: 2px 0 0; font-size: 19px; }
.rk-card .rk-tag { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--rk-c); font-weight: 700; }
.rk-card p { margin: 4px 0 0; font-size: 13.5px; line-height: 1.4; color: #cfdbec; }
.rk-goals { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
.rk-goal { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 48px; padding: 8px 12px; border-radius: 12px; text-align: left; cursor: pointer;
  border: 1px solid var(--rk-line); background: var(--rk-soft); color: var(--text, #eaf1fb); font: inherit; }
.rk-goal:hover, .rk-goal:focus-visible { background: var(--rk-soft2); }
.rk-goal .rk-gi { flex: none; width: 30px; height: 30px; display: grid; place-items: center; border-radius: 9px; background: var(--rk-c); color: #0b1220; font-weight: 800; font-size: 16px; }
.rk-goal span:last-child { display: flex; flex-direction: column; }
.rk-goal strong { font-size: 14.5px; }
.rk-goal em { font-style: normal; font-size: 12.5px; color: var(--text-dim, #9fb2cc); }
.rk-helper { display: flex; align-items: center; gap: 10px; margin: 16px 2px 4px; font-size: 14px; color: #cfdbec; }
.rk-helper input { width: 22px; height: 22px; accent-color: ${ROCKET_ACCENT}; }
.rk-site-note { margin: 10px 2px 0; font-size: 12.5px; color: var(--text-dim, #9fb2cc); }
`;

/** '#58c6ff' → 'rgba(88,198,255,0.16)' — color-mix() is too new for a 2019 Chromebook. */
function soft(hex, a) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A little picture of each rocket, in its own colours. */
function rocketArt(def) {
  const c = def.colour;
  const W = 74;
  const H = 150;
  const total = def.stages.reduce((a, s) => a + s.height, 0) + (def.payload ? def.payload.height : 0) + (def.fairing ? 0.6 : 0);
  const k = (H - 10) / Math.max(total, 30);
  const wMax = Math.max(...def.stages.map((s) => s.radius)) * 2 * k * 1.6;
  let y = H - 4;
  let out = '';
  def.stages.forEach((s, i) => {
    const h = s.height * k;
    const w = s.radius * 2 * k * 1.6;
    const x = (W - w) / 2;
    out += `<rect x="${x.toFixed(1)}" y="${(y - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="#f1f3f6"/>`;
    out += `<rect x="${x.toFixed(1)}" y="${(y - h * 0.86).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(2, h * 0.07).toFixed(1)}" fill="${c}"/>`;
    if (i === 0 && def.stages.length > 1) out += `<rect x="${x.toFixed(1)}" y="${(y - h).toFixed(1)}" width="${w.toFixed(1)}" height="${(2 * k).toFixed(1)}" fill="#24282f"/>`;
    if (i === 0 && def.stages.length === 1) {
      out += `<path d="M${x.toFixed(1)} ${(y - 2).toFixed(1)} l-7 4 v-12 l7 -8Z M${(x + w).toFixed(1)} ${(y - 2).toFixed(1)} l7 4 v-12 l-7 -8Z" fill="${c}"/>`;
    }
    if (s.landable) out += `<path d="M${x.toFixed(1)} ${(y - h * 0.3).toFixed(1)} l-6 ${(h * 0.3).toFixed(1)} M${(x + w).toFixed(1)} ${(y - h * 0.3).toFixed(1)} l6 ${(h * 0.3).toFixed(1)}" stroke="#24282f" stroke-width="2"/>`;
    y -= h;
  });
  const ph = ((def.payload ? def.payload.height : 3) + (def.fairing ? 0.6 : 0)) * k;
  const w = wMax / 1.6;
  out += `<path d="M${((W - w) / 2).toFixed(1)} ${y.toFixed(1)} Q ${(W / 2).toFixed(1)} ${(y - ph * 1.4).toFixed(1)} ${((W + w) / 2).toFixed(1)} ${y.toFixed(1)} Z" fill="#f1f3f6"/>`;
  out += `<path d="M${(W / 2 - 4).toFixed(1)} ${(H - 3).toFixed(1)} L${(W / 2).toFixed(1)} ${H} L${(W / 2 + 4).toFixed(1)} ${(H - 3).toFixed(1)}Z" fill="#ffb14a"/>`;
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">${out}</svg>`;
}

/**
 * Fit the rocket into the live menus.
 * @param {object} sim   the game
 * @param {object} api   { start({rocket, goal, mission}), siteName() }
 */
export function installRocketMenu(sim, api) {
  const menus = sim.menus;
  if (!menus || menus._rocketInstalled) return;
  menus._rocketInstalled = true;

  if (!document.getElementById('rk-menu-css')) {
    const st = document.createElement('style');
    st.id = 'rk-menu-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  // 1. The table and the list.
  GAME_UI.rocket = ROCKET_UI;
  if (!GAMES.some((g) => g.id === 'rocket')) {
    GAMES.push({ id: 'rocket', name: 'Rocket', icon: 'rocket', title: 'Island Rockets — fly to space' });
  }

  // 2. The fifth button, on the bar that was built before we got here.
  const bar = menus.bar && menus.bar.querySelector('.switcher');
  if (bar && !bar.querySelector('[data-game="rocket"]')) {
    const b = document.createElement('button');
    b.className = 'switch-btn';
    b.dataset.game = 'rocket';
    b.title = 'Island Rockets — fly to space';
    b.innerHTML = `${rocketIcon(19)}<span>Rocket</span>`;
    bar.appendChild(b);
  }
  menus.syncBar && menus.syncBar();

  // 3. The missions, under their own heading.
  if (!MISSION_CATEGORIES.some((c) => c.id === 'space')) {
    const mil = MISSION_CATEGORIES.findIndex((c) => c.id === 'military');
    const def = { id: 'space', label: 'Space', blurb: 'Rockets, boosters and satellites', colour: ROCKET_ACCENT, icon: 'meteor' };
    if (mil >= 0) MISSION_CATEGORIES.splice(mil, 0, def);
    else MISSION_CATEGORIES.push(def);
  }
  const defs = ROCKET_MISSIONS.map((m) => ({
    id: m.id,
    name: m.name,
    short: m.short,
    difficulty: m.difficulty,
    icon: m.icon,
    blurb: m.blurb,
    reward: m.reward,
    category: 'space',
    game: 'rocket',
  }));
  menus.registerMissions && menus.registerMissions('rocket', defs);

  // 3b. And on the More screen's list of the other games, so it can be found
  //     from there as well as from the bar.
  const more = menus.screens.more && menus.screens.more.querySelector('[data-more-games]');
  if (more && !more.querySelector('[data-rk-more]')) {
    const b = document.createElement('button');
    b.className = 'game-card';
    b.dataset.rkMore = '';
    b.innerHTML = '<strong>Rocket</strong><em>Island Rockets — fly to space, land the booster</em>';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      sim.switchGame('rocket');
    });
    more.appendChild(b);
  }

  // 4. The picker screen.
  const screen = buildPicker(sim, api);
  menus.screens.rocket = screen;
  menus.layer.appendChild(screen);

  // 5. The front page's own acts, on a listener of our own (as game-ui.js
  //    does for 'drive'), so buildMain()'s handler is never touched.
  menus.screens.main.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act^="rocket-"]');
    if (!btn) return;
    if (btn.dataset.act === 'rocket-launch') {
      refreshPicker(sim, api);
      menus.show('rocket');
    } else if (btn.dataset.act === 'rocket-learn') {
      api.start({ mission: 'rocket-space' });
    }
  });

  // The picker says which island it launches from, whoever opened it.
  const onScreen = menus.hooks.onScreen;
  menus.hooks.onScreen = (name) => {
    if (onScreen) onScreen(name);
    if (name === 'rocket') refreshPicker(sim, api);
  };

  // 6. Everything game-ui.js repaints per game, painted for the rocket too.
  const paintUi = menus.applyGameUi;
  menus.applyGameUi = function () {
    paintUi.call(menus);
    if (menus.currentGame !== 'rocket') return;
    const icon = menus.screens.main.querySelector('[data-act="rocket-launch"] .card-icon');
    if (icon && !icon.innerHTML.trim()) icon.innerHTML = rocketIcon(24);
  };
  const paintCards = menus.applyGameToCards;
  menus.applyGameToCards = function () {
    paintCards.call(menus);
    if (menus.currentGame !== 'rocket') return;
    paintRocketCards(sim);
  };
  if (menus.currentGame === 'rocket') menus.setGame('rocket');
}

function paintRocketCards(sim) {
  const menus = sim.menus;
  const board = menus.screens.missions;
  if (board) {
    for (const m of ROCKET_MISSIONS) {
      const card = board.querySelector(`[data-mission="${m.id}"]`);
      if (!card) continue;
      const btn = card.querySelector('[data-start]');
      if (btn && btn.textContent !== 'Launch') btn.textContent = 'Launch';
      const best = card.querySelector(`[data-best="${m.id}"]`);
      const rec = sim.progress && sim.progress.missions && sim.progress.missions[m.id];
      if (best) {
        const html = rec && rec.complete ? `<span class="ok">Completed ✓</span> best ${rec.bestScore}/100` : 'Not flown yet';
        if (best.innerHTML !== html) best.innerHTML = html;
      }
    }
  }
  const maps = menus.screens.maps;
  if (maps) {
    // Every island can launch a rocket; none of them is "borrowed".
    for (const card of maps.querySelectorAll('[data-map-card]')) {
      card.classList.remove('is-borrowed');
      const badge = card.querySelector('[data-borrowed]');
      if (badge) badge.hidden = true;
    }
    for (const b of maps.querySelectorAll('[data-choose-map]')) b.textContent = 'Launch from here';
    const hint = maps.querySelector('.hint');
    if (hint) hint.textContent = 'Every island gets its own launch pad, on flat ground by the sea, with the landing pad behind it and the ship out in front.';
  }
}

function buildPicker(sim, api) {
  const s = document.createElement('section');
  s.className = 'screen screen-list screen-rocket';
  s.dataset.screen = 'rocket';
  s.hidden = true;
  const cards = ROCKET_IDS.map((id) => {
    const def = ROCKETS[id];
    const goals = def.goals
      .map((g) => `<button class="rk-goal" data-rk-rocket="${id}" data-rk-goal="${g}"><span class="rk-gi">${GOALS[g].icon}</span><span><strong>${GOALS[g].name}</strong><em>${GOALS[g].line}</em></span></button>`)
      .join('');
    const vars = `--rk-c:${def.colour};--rk-soft:${soft(def.colour, 0.14)};--rk-soft2:${soft(def.colour, 0.26)};--rk-line:${soft(def.colour, 0.45)}`;
    return `<article class="rk-card" style="${vars}" data-rk-card="${id}">
      <div class="rk-art">${rocketArt(def)}</div>
      <span class="rk-tag">${def.tag}</span>
      <h3>${def.name}</h3>
      <p>${def.blurb}</p>
      <div class="rk-goals">${goals}</div>
    </article>`;
  }).join('');
  s.innerHTML = `
    <header class="screen-head">
      <button class="ghost" data-back>← Back</button>
      <h2>Choose your rocket</h2>
      <span></span>
    </header>
    <p class="rk-pick-lead">Pick a rocket, then what you want it to do. <b data-rk-site></b></p>
    <div class="rk-pick-grid">${cards}</div>
    <label class="rk-helper"><input type="checkbox" data-rk-helper checked>
      <span><b>Landing helper</b> — hold ◀ or ▶ and the booster glides over the pad and stops there; hold SPACE and it slows down safely. Turn it off to fly the landing all by yourself.</span></label>
    <p class="rk-site-note">Space starts at 100 km. This planet is a small one, so a rocket can go all the way round it in a few minutes.</p>`;
  s.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) return sim.menus.show('main');
    const g = e.target.closest('[data-rk-goal]');
    if (!g) return;
    sim.menus.hooks.onClick && sim.menus.hooks.onClick('rocket');
    const helper = s.querySelector('[data-rk-helper]');
    api.start({ rocket: g.dataset.rkRocket, goal: g.dataset.rkGoal, helper: !helper || helper.checked });
  });
  return s;
}

function refreshPicker(sim, api) {
  const s = sim.menus.screens.rocket;
  if (!s) return;
  const where = s.querySelector('[data-rk-site]');
  if (where) where.textContent = api.siteName ? api.siteName() : '';
  const helper = s.querySelector('[data-rk-helper]');
  if (helper && api.helper) helper.checked = api.helper();
}

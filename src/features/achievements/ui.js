/**
 * The Achievements screen, the start-screen button and the unlock toast.
 *
 * Same shape as features/fun/ui.js: elements added to things main.js and
 * menus.js already built; neither file knows this exists.
 */

import { badgeSvg } from './icons.js';

const CSS = /* css */ `
.ach-open {
  display: flex; align-items: center; gap: 14px; width: 100%; margin-top: 10px; text-align: left;
  padding: 14px 18px; border-radius: 16px; cursor: pointer; font: inherit; color: var(--text, #eaf1fb);
  border: 1px solid var(--panel-line, rgba(140,180,230,0.22));
  background: linear-gradient(120deg, rgba(120,150,210,0.22), rgba(40,55,90,0.32));
  transition: transform 0.15s ease;
}
.ach-open:hover { transform: translateY(-3px); }
.ach-open:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.ach-open .ach-open-badge { width: 34px; height: 34px; flex: none; }
.ach-open strong { display: block; font-size: 18px; }
.ach-open em { display: block; font-style: normal; font-size: 13.5px; opacity: 0.8; margin-top: 2px; }

.ach-screen .ach-head-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 2px 0 12px; }
.ach-progress-line { font-size: 14px; color: var(--text-dim, #9fb2cc); font-weight: 600; }
.ach-filters { display: flex; gap: 6px; }
.ach-filter {
  padding: 6px 12px; border-radius: 10px; border: 1px solid var(--panel-line, rgba(140,180,230,0.22));
  background: rgba(255,255,255,0.04); color: var(--text, #eaf1fb); font: 600 13px inherit; cursor: pointer;
}
.ach-filter.is-on { background: rgba(130,170,255,0.24); border-color: rgba(150,190,255,0.65); }
.ach-group-head { margin: 16px 0 8px; }
.ach-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 10px; }
.ach-card {
  display: flex; gap: 12px; border-radius: 14px; border: 1px solid var(--panel-line, rgba(140,180,230,0.16));
  padding: 12px 14px; background: linear-gradient(160deg, rgba(20,32,52,0.88), rgba(11,18,32,0.88));
  min-width: 0;
}
.ach-card.is-locked { opacity: 0.55; }
.ach-card .ach-badge { flex: none; width: 34px; height: 34px; margin-top: 2px; }
.ach-card h4 { margin: 0 0 2px; font-size: 15px; color: var(--text, #eaf1fb); }
.ach-card p { margin: 0; font-size: 12.5px; line-height: 1.35; color: var(--text-dim, #9fb2cc); }
.ach-card .ach-bar { margin-top: 6px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.08); overflow: hidden; }
.ach-card .ach-bar i { display: block; height: 100%; background: linear-gradient(90deg, #7fb8ff, #9fe8c8); }
.ach-card .ach-when { font-size: 11px; opacity: 0.7; margin-top: 4px; }
.ach-empty { color: var(--text-dim, #9fb2cc); padding: 20px 6px; }

/* The toast — reuses the HUD's own toast stack and styling (hud-toast), so
   it already keeps clear of the minimap and the warnings slot the way every
   other transient message does; this only adds the icon-and-name layout. */
.hud-toast.is-unlock { border-color: rgba(255, 210, 120, 0.55); color: #ffe9bf; }
.ach-toast { display: flex; align-items: center; gap: 10px; text-align: left; }
.ach-toast .ach-toast-badge { width: 26px; height: 26px; flex: none; }
.ach-toast b { display: block; font-size: 10.5px; letter-spacing: 0.04em; text-transform: uppercase; opacity: 0.8; font-weight: 700; }
.ach-toast span { display: block; font-size: 14px; font-weight: 700; margin-top: 1px; }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('ach-style')) return;
  const s = document.createElement('style');
  s.id = 'ach-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

const GROUP_ORDER = ['flying', 'missions', 'games', 'multiplayer', 'afo', 'fun', 'progress'];
const GROUP_LABELS = {
  flying: 'Flying',
  missions: 'Missions',
  games: 'The other games',
  multiplayer: 'Multiplayer',
  afo: 'Air Force One',
  fun: 'Just for fun',
  progress: 'Milestones',
};

function progressOf(def, store) {
  if (!def.progress) return null;
  const raw = store.counts ? store.counts[def.progress.key] : undefined;
  const have = Array.isArray(raw) ? raw.length : Number(raw) || 0;
  return { have: Math.min(have, def.progress.target), target: def.progress.target };
}

function cardHtml(def, store) {
  const unlockedAt = store.unlocked[def.id];
  const locked = !unlockedAt;
  const hideDetail = locked && def.hidden;
  const prog = progressOf(def, store);
  const name = hideDetail ? '???' : def.name;
  const how = hideDetail ? 'A hidden achievement — keep playing to find it.' : def.how;
  // A progress bar only while it is still locked: an unlocked one is done.
  const bar = prog && locked && !hideDetail
    ? `<div class="ach-bar"><i style="width:${Math.round((prog.have / prog.target) * 100)}%"></i></div>
       <div class="ach-when">${prog.have}/${prog.target}</div>`
    : '';
  const when = !locked
    ? `<div class="ach-when">Unlocked ${new Date(unlockedAt).toLocaleDateString()}</div>`
    : '';
  const state = locked ? (hideDetail ? 'hidden' : 'locked') : 'unlocked';
  return (
    `<article class="ach-card${locked ? ' is-locked' : ''}" data-ach="${def.id}">` +
    `<div class="ach-badge">${badgeSvg(def.glyph, { tier: def.tier, size: 34, state })}</div>` +
    `<div><h4>${name}</h4><p>${how}</p>${bar}${when}</div>` +
    `</article>`
  );
}

/* ------------------------------------------------------------------ *
 * The start screen button
 * ------------------------------------------------------------------ */

export function addMenuButton(menus, onOpen) {
  injectStyle();
  const main = menus && menus.screens && menus.screens.main;
  if (!main || main.querySelector('[data-ach-open]')) return null;
  const b = el(
    'button',
    'ach-open',
    `<span class="ach-open-badge">${badgeSvg('medal', { tier: 'gold', size: 34 })}</span>
     <span><strong>Achievements</strong>
     <em>See what you've earned</em></span>`
  );
  b.type = 'button';
  b.setAttribute('data-ach-open', '');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onOpen();
  });
  // Right after the Fun Stuff button if the game has one, otherwise after the nav.
  const after = main.querySelector('[data-fun-open]') || main.querySelector('.main-nav');
  if (after && after.parentNode) after.parentNode.insertBefore(b, after.nextSibling);
  else main.appendChild(b);
  return b;
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

export function buildAchievementsScreen(menus, { list, model }) {
  injectStyle();
  if (!menus || !menus.layer || !menus.screens) return null;
  const s = el('section', 'screen screen-list ach-screen');
  s.setAttribute('data-screen', 'achievements');
  s.hidden = true;
  s.innerHTML = `
    <header class="screen-head">
      <button class="ghost" data-back>← Back</button>
      <h2>Achievements</h2>
      <span></span>
    </header>
    <div class="ach-head-row">
      <div class="ach-progress-line" data-ach-progress></div>
      <div class="ach-filters" role="tablist">
        <button type="button" class="ach-filter is-on" data-filter="all">All</button>
        <button type="button" class="ach-filter" data-filter="unlocked">Unlocked</button>
        <button type="button" class="ach-filter" data-filter="locked">Locked</button>
      </div>
    </div>
    <div class="ach-body" data-ach-body></div>`;
  let filter = 'all';
  s.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) {
      menus.show('main');
      return;
    }
    const f = e.target.closest('[data-filter]');
    if (f) {
      filter = f.dataset.filter;
      for (const btn of s.querySelectorAll('[data-filter]')) btn.classList.toggle('is-on', btn === f);
      render();
    }
  });
  menus.layer.appendChild(s);
  menus.screens.achievements = s;

  const render = () => {
    const { store } = model();
    const total = list.length;
    const have = list.filter((d) => store.unlocked[d.id]).length;
    s.querySelector('[data-ach-progress]').textContent = `${have} / ${total} unlocked`;
    const groups = new Map();
    for (const def of list) {
      const unlocked = !!store.unlocked[def.id];
      if (filter === 'unlocked' && !unlocked) continue;
      if (filter === 'locked' && unlocked) continue;
      const g = def.group || 'flying';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(def);
    }
    const body = s.querySelector('[data-ach-body]');
    if (!groups.size) {
      body.innerHTML = '<p class="ach-empty">Nothing here with this filter yet.</p>';
      return;
    }
    body.innerHTML = GROUP_ORDER.filter((g) => groups.has(g))
      .map(
        (g) => `
      <h3 class="fail-heading ach-group-head">${GROUP_LABELS[g] || g}</h3>
      <div class="ach-grid">${groups.get(g).map((def) => cardHtml(def, store)).join('')}</div>`
      )
      .join('');
  };
  s.render = render;
  return s;
}

/* ------------------------------------------------------------------ *
 * The toast
 * ------------------------------------------------------------------ */

/** A calm, small toast — icon and name, three seconds, no confetti. */
export function showUnlockToast(hud, def) {
  if (!hud || typeof hud.notify !== 'function') return;
  injectStyle();
  const html =
    `<div class="ach-toast">` +
    `<span class="ach-toast-badge">${badgeSvg(def.glyph, { tier: def.tier || 'gold', size: 26 })}</span>` +
    `<span><b>Achievement unlocked</b><span>${def.name}</span></span>` +
    `</div>`;
  const entry = hud.notify(html, 'unlock', 3);
  /*
   * notify()'s own 3 s only counts down from updateOverlays(), which
   * main.js calls just once a frame and only while state === 'flying'. An
   * achievement can unlock the instant a mission ends — state flips to
   * 'debrief' in that same call, before the next frame — or during the
   * rocket game, whose own loop never calls hud.update() at all for as
   * long as the flight lasts. Either way the toast would otherwise sit at
   * full life forever, then resurface stale whenever flying next resumes.
   * A plain wall-clock timer clears it on schedule regardless of game
   * state; when the normal dt-based path already removed it first (the
   * ordinary flying case), the entry is gone from hud.toasts and this is a
   * no-op.
   */
  if (entry && Array.isArray(hud.toasts)) {
    setTimeout(() => {
      const i = hud.toasts.indexOf(entry);
      if (i < 0) return;
      hud.toasts.splice(i, 1);
      entry.node.classList.add('is-out');
      setTimeout(() => entry.node.remove(), 400);
    }, 3200);
  }
}

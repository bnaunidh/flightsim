/**
 * The fun pack on screen: the chip in flight (stars found, stunt points, the
 * smoke button), the pop-ups ("BARREL ROLL! +200"), the "Fun Stuff" button
 * on the start screen and the Fun Stuff screen behind it.
 *
 * All of it is added from here, to elements main.js and menus.js already
 * built; neither file knows it exists. Every string a child reads is written
 * here, and none of it is typed by anybody — there is no text box anywhere.
 */

import { extLayer } from '../../game/extensions.js';
import { keyName, bindingsVersion } from '../../flight/input.js';

/*
 * The stunt and sticker lines name keys ("hold A or D"); these put the
 * player's own in (Settings → Controls), the aeroplane's roll and pitch and
 * the helicopter's turn.
 */
export function withKeys(text) {
  return String(text)
    .replace(/\bhold A or D\b/g, () => `hold ${keyName('rollLeft')} or ${keyName('rollRight')}`)
    .replace(/\bhold S\b/g, () => `hold ${keyName('pitchUp')}`)
    .replace(/\bhold Q or E\b/g, () => `hold ${keyName('heliTurnLeft')} or ${keyName('heliTurnRight')}`);
}
import { STICKERS, SMOKE_COLOURS, colourUnlocked, colourNeeds, stickerCount } from './stickers.js';
import { STUNTS } from './stunts.js';

const CSS = /* css */ `
.fun-chip {
  position: absolute; left: 16px; top: 270px; display: flex; align-items: center; gap: 8px;
  padding: 6px 8px 6px 12px; border-radius: 14px; background: rgba(12, 20, 34, 0.72);
  border: 1px solid rgba(255, 200, 70, 0.35); color: #eaf1fb; pointer-events: none;
  font: 700 15px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  box-shadow: 0 8px 24px rgba(0,0,0,0.35); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  transition: transform 0.2s ease; z-index: 31;
}
.fun-chip[hidden] { display: none; }
.fun-chip b { color: #ffd45a; font-variant-numeric: tabular-nums; }
.fun-chip .fun-part { white-space: nowrap; }
.fun-chip .fun-part[hidden] { display: none; }
.fun-chip.is-bump { transform: scale(1.12); }
.fun-smoke {
  pointer-events: auto; cursor: pointer; border: 1px solid rgba(255,255,255,0.18); border-radius: 10px;
  background: rgba(255,255,255,0.08); color: #eaf1fb; font-family: inherit; font-weight: 700; font-size: 15px; line-height: 1; padding: 5px 8px;
  display: inline-flex; align-items: center; gap: 4px; min-height: 30px;
}
.fun-smoke small { font-size: 10px; opacity: 0.7; font-weight: 700; }
.fun-smoke[aria-pressed="true"] { background: rgba(255, 200, 70, 0.28); border-color: rgba(255, 210, 90, 0.8); }
.fun-smoke[hidden] { display: none; }
.is-touch-fun .fun-smoke { min-height: 40px; min-width: 44px; justify-content: center; }
.is-touch-fun .fun-smoke small { display: none; }

.fun-pops { position: absolute; left: 0; right: 0; top: 24%; display: flex; flex-direction: column; align-items: center; pointer-events: none; z-index: 32; }
.fun-pop {
  text-align: center; color: #fff; font: 900 34px/1.05 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  letter-spacing: 0.02em; text-shadow: 0 3px 0 #b3560b, 0 6px 18px rgba(0,0,0,0.55);
  animation: fun-pop 1.7s ease-out forwards; white-space: nowrap;
}
.fun-pop.is-star { color: #ffe27a; }
.fun-pop small { display: block; margin-top: 4px; font-size: 18px; color: #ffd45a; text-shadow: 0 2px 8px rgba(0,0,0,0.6); }
.fun-pop .combo { color: #7dffb4; }
@keyframes fun-pop {
  0% { transform: scale(0.4) translateY(10px); opacity: 0; }
  12% { transform: scale(1.12) translateY(0); opacity: 1; }
  22% { transform: scale(1); }
  75% { opacity: 1; transform: translateY(-14px); }
  100% { opacity: 0; transform: translateY(-34px); }
}
.fun-calm .fun-pop { animation: fun-fade 1.7s linear forwards; }
@keyframes fun-fade { 0% { opacity: 0; } 10% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
.fun-side {
  position: absolute; left: 16px; top: 322px; width: min(330px, 44vw); display: flex; flex-direction: column;
  gap: 8px; pointer-events: none; z-index: 32;
}
.fun-sticker-toast {
  display: flex; align-items: center; gap: 12px; text-align: left;
  padding: 10px 16px 10px 12px; border-radius: 16px; background: linear-gradient(160deg, #fff6d8, #ffe08a);
  color: #3a2600; box-shadow: 0 12px 30px rgba(0,0,0,0.4); pointer-events: none; z-index: 33;
  font: 700 15px/1.25 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  animation: fun-fade 3.4s linear forwards;
}
.fun-note {
  padding: 8px 12px; border-radius: 12px; text-align: left;
  background: rgba(12, 20, 34, 0.82); border: 1px solid rgba(255, 200, 70, 0.35); color: #eaf1fb;
  font: 600 14px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  animation: fun-fade 4s linear forwards;
}
.fun-sticker-toast .emoji { font-size: 34px; line-height: 1; }
.fun-sticker-toast em { display: block; font-style: normal; font-weight: 600; font-size: 13px; opacity: 0.8; }
@media (max-width: 700px), (max-height: 480px) {
  .fun-pop { font-size: 26px; }
  .fun-pop small { font-size: 15px; }
  .fun-chip { font-size: 14px; }
}

.fun-open {
  display: flex; align-items: center; gap: 14px; width: 100%; margin-top: 12px; text-align: left;
  padding: 14px 18px; border-radius: 16px; cursor: pointer; font: inherit; color: #2d1c00;
  border: 1px solid rgba(255, 220, 120, 0.9);
  background: linear-gradient(120deg, #ffe07a, #ffc247 55%, #ff9f5a);
  box-shadow: 0 10px 28px rgba(255, 170, 60, 0.25); transition: transform 0.15s ease;
}
.fun-open:hover { transform: translateY(-3px); }
.fun-open:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.fun-open .emoji { font-size: 30px; line-height: 1; }
.fun-open strong { display: block; font-size: 18px; }
.fun-open em { display: block; font-style: normal; font-size: 13.5px; opacity: 0.85; margin-top: 2px; }
.fun-open .count { font-weight: 800; }

.fun-screen .fun-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
.fun-card {
  border-radius: 16px; border: 1px solid var(--panel-line, rgba(140,180,230,0.18)); padding: 14px 16px;
  background: linear-gradient(160deg, rgba(20, 32, 52, 0.9), rgba(11, 18, 32, 0.9)); color: var(--text, #eaf1fb);
  min-width: 0;
}
.fun-card h3 { margin: 0 0 6px; font-size: 18px; }
.fun-card p { margin: 0 0 8px; color: var(--text-dim, #9fb2cc); font-size: 14px; line-height: 1.4; }
.fun-card .big { font-size: 26px; font-weight: 800; color: #ffd45a; }
.fun-card ul { margin: 6px 0 0; padding: 0; list-style: none; font-size: 13.5px; line-height: 1.5; }
.fun-card li b { color: #ffd45a; }
.fun-card .row { display: flex; justify-content: space-between; gap: 8px; font-size: 14px; padding: 3px 0; border-top: 1px solid rgba(255,255,255,0.06); }
.fun-swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.fun-swatch {
  display: flex; flex-direction: column; align-items: center; gap: 4px; width: 74px; padding: 6px 4px; border-radius: 12px;
  border: 2px solid transparent; background: rgba(255,255,255,0.05); color: var(--text, #eaf1fb); cursor: pointer; font-family: inherit; font-weight: 600; font-size: 11px; line-height: 1.2;
}
.fun-swatch i { width: 30px; height: 30px; border-radius: 50%; display: block; box-shadow: inset 0 -3px 0 rgba(0,0,0,0.2); }
.fun-swatch.is-on { border-color: #ffd45a; background: rgba(255, 212, 90, 0.14); }
.fun-swatch[disabled] { cursor: default; opacity: 0.55; }
.fun-swatch[disabled] i { filter: grayscale(1) brightness(0.6); }
.fun-stickers { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
.fun-sticker {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 4px; padding: 10px 8px 12px;
  border-radius: 16px; background: rgba(255,255,255,0.05); border: 1px dashed rgba(255,255,255,0.18); min-width: 0;
}
.fun-sticker .emoji { font-size: 34px; line-height: 1.1; filter: grayscale(1) opacity(0.35); }
.fun-sticker strong { font-size: 13px; }
.fun-sticker em { font-style: normal; font-size: 11.5px; color: var(--text-dim, #9fb2cc); line-height: 1.3; }
.fun-sticker.is-got { background: linear-gradient(160deg, #fff6d8, #ffe08a); border: 1px solid #ffd45a; color: #3a2600; transform: rotate(-2deg); }
.fun-sticker.is-got:nth-child(2n) { transform: rotate(2deg); }
.fun-sticker.is-got .emoji { filter: none; }
.fun-sticker.is-got em { color: #6b4b00; }
.fun-new { display: inline-block; margin-left: 6px; padding: 2px 7px; border-radius: 8px; background: #ff6a5a; color: #fff; font-size: 11px; font-weight: 800; vertical-align: middle; }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('fun-style')) return;
  const s = document.createElement('style');
  s.id = 'fun-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export const GAME_WORDS = {
  flight: { emoji: '✈️', name: 'plane' },
  heli: { emoji: '🚁', name: 'helicopter' },
  boat: { emoji: '⛵', name: 'boat' },
  car: { emoji: '🚗', name: 'car' },
};

/* ------------------------------------------------------------------ *
 * In flight
 * ------------------------------------------------------------------ */

export class FunHud {
  constructor({ onSmoke, touch = false }) {
    injectStyle();
    const layer = extLayer();
    this.layer = layer;
    this.chip = el(
      'div',
      'fun-chip',
      `<span class="fun-part" data-fun-stars>⭐ <b data-n>0</b>/<span data-of>10</span></span>
       <span class="fun-part" data-fun-score hidden>🎪 <b data-pts>0</b></span>
       <button class="fun-smoke" type="button" data-fun-smoke aria-pressed="false" title="Smoke trail — press ${keyName('smoke')}">💨<small>${keyName('smoke')}</small></button>`
    );
    this.chip.hidden = true;
    this.pops = el('div', 'fun-pops');
    // Sticker cards and our own messages: under the chip, off to the side,
    // so nothing but the brief "BARREL ROLL!" ever sits in front of the plane.
    this.side = el('div', 'fun-side');
    layer.appendChild(this.chip);
    layer.appendChild(this.pops);
    layer.appendChild(this.side);
    this.$n = this.chip.querySelector('[data-n]');
    this.$of = this.chip.querySelector('[data-of]');
    this.$stars = this.chip.querySelector('[data-fun-stars]');
    this.$score = this.chip.querySelector('[data-fun-score]');
    this.$pts = this.chip.querySelector('[data-pts]');
    this.$smoke = this.chip.querySelector('[data-fun-smoke]');
    this.$smoke.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onSmoke && onSmoke();
      this.$smoke.blur();
    });
    // Touch (the game's own decision: it has put its on-screen controls
    // up): the button is the only way to smoke, so it is finger-sized.
    if (touch) this.chip.classList.add('is-touch-fun');
    this.bumpT = 0;
    this.placeT = 0;
    this.last = '';
  }

  setVisible(on) {
    if (this.chip.hidden === !on) return;
    this.chip.hidden = !on;
  }

  /** n/of stars (of = 0 hides the star part), stunt points, smoke state. */
  set({ n, of, pts, smokeOk, smokeOn }) {
    const key = `${n}|${of}|${pts}|${smokeOk}|${smokeOn}|${bindingsVersion()}`;
    if (key === this.last) return;
    this.last = key;
    // The smoke key, as the player has it now (Settings → Controls → Fun Stuff).
    const sk = keyName('smoke');
    const small = this.$smoke.querySelector('small');
    if (small && small.textContent !== sk) small.textContent = sk;
    this.$smoke.title = `Smoke trail — press ${sk}`;
    this.$stars.hidden = !of;
    this.$n.textContent = String(n);
    this.$of.textContent = String(of);
    this.$score.hidden = !pts;
    this.$pts.textContent = pts.toLocaleString();
    this.$smoke.hidden = !smokeOk;
    this.$smoke.setAttribute('aria-pressed', smokeOn ? 'true' : 'false');
  }

  bump() {
    this.chip.classList.add('is-bump');
    this.bumpT = 0.25;
  }

  /**
   * Sit under whatever is in the top-left corner — the instrument panel on a
   * laptop, the round map on a phone — and never on top of the touch stick.
   * Measured once a second, because the HUD rearranges itself by screen size.
   */
  place(dt, root) {
    if (this.bumpT > 0) {
      this.bumpT -= dt;
      if (this.bumpT <= 0) this.chip.classList.remove('is-bump');
    }
    this.placeT -= dt;
    if (this.placeT > 0 || this.chip.hidden || !root) return;
    this.placeT = 1;
    const H = window.innerHeight;
    let bottom = 8;
    let left = 16;
    for (const e of root.querySelectorAll('.hud-panel, .minimap')) {
      const r = e.getBoundingClientRect();
      if (!r.width || !r.height || r.left > 240 || r.top > H * 0.45 || r.width > 420) continue;
      if (r.bottom > bottom) {
        // Line up with whatever we are sitting under.
        bottom = r.bottom;
        left = Math.max(8, r.left);
      }
    }
    let top = bottom + 10;
    const stick = root.querySelector('.touch-stick');
    if (stick) {
      const r = stick.getBoundingClientRect();
      if (r.width && top + 44 > r.top) top = Math.max(8, r.top - 52);
    }
    this.chip.style.top = `${Math.round(top)}px`;
    this.chip.style.left = `${Math.round(left)}px`;
    this.side.style.top = `${Math.round(top + (this.chip.offsetHeight || 44) + 8)}px`;
    this.side.style.left = `${Math.round(left)}px`;
  }

  /** A big "BARREL ROLL! +200" in the middle of the screen. */
  pop(title, sub, { star = false, calm = false } = {}) {
    this.pops.classList.toggle('fun-calm', !!calm);
    const p = el('div', `fun-pop${star ? ' is-star' : ''}`, `${title}${sub ? `<small>${sub}</small>` : ''}`);
    this.pops.appendChild(p);
    const all = this.pops.querySelectorAll('.fun-pop');
    for (let i = 0; i < all.length - 2; i++) all[i].remove();
    setTimeout(() => p.remove(), 1800);
  }

  /**
   * A line of our own — "the stars are here", "smoke on" — in our own
   * column, never in the game's toast stack: that holds four, and a test or
   * a child waiting on one of the game's messages must not lose it to ours.
   */
  note(text, secs = 4) {
    const t = el('div', 'fun-note');
    t.textContent = text;
    t.style.animationDuration = `${secs}s`;
    this.side.appendChild(t);
    this.trimSide();
    setTimeout(() => t.remove(), secs * 1000 + 100);
  }

  /** Back to the menu: nothing of the flight's is left over the menu. */
  clearPops() {
    this.pops.textContent = '';
    this.side.textContent = '';
  }

  /** At most three things at the side; on a short screen, where the stick is close, two. */
  trimSide() {
    const max = typeof window !== 'undefined' && window.innerHeight < 500 ? 1 : 3;
    while (this.side.children.length > max) this.side.firstChild.remove();
  }

  sticker(s, extra = '') {
    // In the same column as the pop-ups, under them: the top of the screen
    // is where the game's own messages stack.
    const t = el('div', 'fun-sticker-toast', `<span class="emoji">${s.emoji}</span><span>New sticker: ${s.name}!<em>${withKeys(s.how)}</em>${extra ? `<em>${extra}</em>` : ''}</span>`);
    this.side.appendChild(t);
    this.trimSide();
    setTimeout(() => t.remove(), 3500);
  }
}

/* ------------------------------------------------------------------ *
 * The start screen button, and the Fun Stuff screen
 * ------------------------------------------------------------------ */

export function addMenuButton(menus, onOpen) {
  injectStyle();
  const main = menus && menus.screens && menus.screens.main;
  if (!main || main.querySelector('[data-fun-open]')) return null;
  const b = el(
    'button',
    'fun-open',
    `<span class="emoji" aria-hidden="true">🎉</span>
     <span><strong>Fun Stuff</strong>
     <em>Star Hunt · Stunts · Smoke trails · Sticker book — <span class="count" data-fun-count>0 stickers</span></em></span>`
  );
  b.type = 'button';
  b.setAttribute('data-fun-open', '');
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    onOpen();
  });
  const nav = main.querySelector('.main-nav');
  if (nav && nav.parentNode) nav.parentNode.insertBefore(b, nav.nextSibling);
  else main.appendChild(b);
  return b;
}

export function setMenuCount(btn, data) {
  if (!btn) return;
  const c = btn.querySelector('[data-fun-count]');
  if (c) c.textContent = `${stickerCount(data)} of ${STICKERS.length} stickers`;
}

/**
 * The screen. `model()` is asked for everything it shows each time it opens,
 * so it is always current; `onColour(id)` picks a smoke colour.
 */
export function buildFunScreen(menus, { model, onColour }) {
  injectStyle();
  if (!menus || !menus.layer || !menus.screens) return null;
  const s = el('section', 'screen screen-list fun-screen');
  s.setAttribute('data-screen', 'fun');
  s.hidden = true;
  s.innerHTML = `
    <header class="screen-head">
      <button class="ghost" data-back>← Back</button>
      <h2>Fun Stuff</h2>
      <span></span>
    </header>
    <p class="trigger-note">Four things to do anywhere in the game. It all saves on this device, and works offline.</p>
    <div class="fun-grid" data-fun-cards></div>
    <h3 class="fail-heading">📒 Sticker book — <span data-fun-book-count></span></h3>
    <p class="trigger-note">Every sticker says how to get it. Stickers unlock smoke colours.</p>
    <div class="fun-stickers" data-fun-stickers></div>`;
  s.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) {
      menus.show('main');
      return;
    }
    const sw = e.target.closest('[data-colour]');
    if (sw && !sw.disabled) {
      onColour(sw.dataset.colour);
      render();
    }
  });
  menus.layer.appendChild(s);
  menus.screens.fun = s;

  const render = () => {
    const m = model();
    const d = m.data;
    const gw = GAME_WORDS[m.game] || GAME_WORDS.flight;
    const stuntRows = m.stunts
      .map((id) => `<li><b>${STUNTS[id].name.replace(/!$/, '')}</b> — ${withKeys(STUNT_HOW[id])}</li>`)
      .join('');
    const best = d.stunts.best || {};
    const bestRows = Object.keys(GAME_WORDS)
      .map((g) => `<div class="row"><span>${GAME_WORDS[g].emoji} Best in the ${GAME_WORDS[g].name}</span><b>${(best[g] || 0).toLocaleString()}</b></div>`)
      .join('');
    const swatches = SMOKE_COLOURS.map((c) => {
      const ok = colourUnlocked(d, c);
      const on = ok && m.colour === c.id;
      const bg = c.rgb ? `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(',')})` : 'conic-gradient(#ff4a4a, #ffc247, #4fd684, #58c6ff, #b06bff, #ff4a4a)';
      return `<button type="button" class="fun-swatch${on ? ' is-on' : ''}" data-colour="${c.id}" ${ok ? '' : 'disabled'}
        title="${ok ? c.name : `Locked — ${colourNeeds(c)}`}"><i style="background:${bg}"></i>${ok ? c.name : `🔒 ${colourNeeds(c)}`}</button>`;
    }).join('');
    const hunt = m.hunt;
    s.querySelector('[data-fun-cards]').innerHTML = `
      <article class="fun-card">
        <h3>⭐ Star Hunt</h3>
        <p>Golden stars are hidden on every map — up high, on the water and on the roads. Fly or drive
        right through them. They show as gold stars on your minimap. Each one is worth 25 credits.</p>
        ${hunt.of
          ? `<div class="big">${hunt.n} / ${hunt.of}</div><p>found on ${m.mapName} in the ${gw.name}</p>`
          : `<p>No stars for the ${gw.name} on ${m.mapName} — try another map.</p>`}
        <div class="row"><span>Stars found everywhere</span><b>${m.total}</b></div>
      </article>
      <article class="fun-card">
        <h3>🎪 Stunts</h3>
        <p>Do tricks for points. Do them close together for a COMBO — double, triple, more!</p>
        <ul>${stuntRows}</ul>
        ${bestRows}
      </article>
      <article class="fun-card">
        <h3>💨 Smoke trails</h3>
        <p>While flying, press <b>${keyName('smoke')}</b> (or the 💨 button) to leave a smoke trail. Pick a colour:</p>
        <div class="fun-swatches">${swatches}</div>
      </article>
      <article class="fun-card">
        <h3>🔥 New disaster: Wildfire</h3>
        <p>In Free Flight, open <b>Disasters</b> and tick <b>Wildfire</b>. Scoop water at the sea, then drop it
        on the flames with <b>X</b> (or DROP WATER). Put it out for the Firefighter sticker!</p>
      </article>`;
    const got = stickerCount(d);
    s.querySelector('[data-fun-book-count]').textContent = `${got} of ${STICKERS.length}`;
    s.querySelector('[data-fun-stickers]').innerHTML = STICKERS.map((k) => {
      const when = d.stickers[k.id];
      return `<div class="fun-sticker${when ? ' is-got' : ''}" data-sticker="${k.id}">
        <span class="emoji" aria-hidden="true">${k.emoji}</span>
        <strong>${k.name}${when && m.fresh && m.fresh.has(k.id) ? '<span class="fun-new">NEW</span>' : ''}</strong>
        <em>${withKeys(k.how)}</em></div>`;
    }).join('');
  };
  s.render = render;
  return s;
}

/** One line on how to do each stunt, for the Fun Stuff screen. */
export const STUNT_HOW = {
  roll: 'plane: hold A or D until you go all the way round',
  loop: 'plane: full power, then hold S over the top',
  upside: 'plane: roll over and stay upside down for 3 seconds',
  sideways: 'plane: tip onto your side and hold it for 2 seconds',
  low: 'plane or helicopter: zoom along very low, then climb away',
  spin: 'helicopter: hover and hold Q or E for a full turn',
  donut: 'car or boat: turn hard in a full circle',
  air: 'car: go over a bump fast and fly!',
};

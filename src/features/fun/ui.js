/**
 * The fun pack on screen: the smoke-trail chip in flight, the "Fun Stuff"
 * button on the start screen and the Fun Stuff screen behind it (just the
 * smoke colour picker now — see git history for the Star Hunt, Stunts and
 * sticker book this used to also carry).
 *
 * All of it is added from here, to elements main.js and menus.js already
 * built; neither file knows it exists.
 */

import { extLayer } from '../../game/extensions.js';
import { keyName, bindingsVersion } from '../../flight/input.js';
import { SMOKE_COLOURS } from './smoke.js';

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

.fun-side { position: absolute; left: 16px; top: 322px; width: min(330px, 44vw); display: flex; flex-direction: column; gap: 8px; pointer-events: none; z-index: 32; }
.fun-note {
  padding: 8px 12px; border-radius: 12px; text-align: left;
  background: rgba(12, 20, 34, 0.82); border: 1px solid rgba(255, 200, 70, 0.35); color: #eaf1fb;
  font: 600 14px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
  animation: fun-fade 4s linear forwards;
}
@keyframes fun-fade { 0% { opacity: 0; } 10% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
@media (max-width: 700px), (max-height: 480px) {
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

.fun-screen .fun-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 12px; }
.fun-card {
  border-radius: 16px; border: 1px solid var(--panel-line, rgba(140,180,230,0.18)); padding: 14px 16px;
  background: linear-gradient(160deg, rgba(20, 32, 52, 0.9), rgba(11, 18, 32, 0.9)); color: var(--text, #eaf1fb);
  min-width: 0;
}
.fun-card h3 { margin: 0 0 6px; font-size: 18px; }
.fun-card p { margin: 0 0 8px; color: var(--text-dim, #9fb2cc); font-size: 14px; line-height: 1.4; }
.fun-swatches { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
.fun-swatch {
  display: flex; flex-direction: column; align-items: center; gap: 4px; width: 74px; padding: 6px 4px; border-radius: 12px;
  border: 2px solid transparent; background: rgba(255,255,255,0.05); color: var(--text, #eaf1fb); cursor: pointer; font-family: inherit; font-weight: 600; font-size: 11px; line-height: 1.2;
}
.fun-swatch i { width: 30px; height: 30px; border-radius: 50%; display: block; box-shadow: inset 0 -3px 0 rgba(0,0,0,0.2); }
.fun-swatch.is-on { border-color: #ffd45a; background: rgba(255, 212, 90, 0.14); }
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
      `<button class="fun-smoke" type="button" data-fun-smoke aria-pressed="false" title="Smoke trail — press ${keyName('smoke')}">💨<small>${keyName('smoke')}</small></button>`
    );
    this.chip.hidden = true;
    // Our own messages ("Smoke on: ...") under the chip, off to the side, so
    // nothing but the game's own toasts ever sits in front of the plane.
    this.side = el('div', 'fun-side');
    layer.appendChild(this.chip);
    layer.appendChild(this.side);
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
    this.placeT = 0;
    this.last = '';
  }

  setVisible(on) {
    if (this.chip.hidden === !on) return;
    this.chip.hidden = !on;
  }

  /** smoke on/off, and whether this craft can smoke at all. */
  set({ smokeOk, smokeOn }) {
    const key = `${smokeOk}|${smokeOn}|${bindingsVersion()}`;
    if (key === this.last) return;
    this.last = key;
    // The smoke key, as the player has it now (Settings → Controls → Fun Stuff).
    const sk = keyName('smoke');
    const small = this.$smoke.querySelector('small');
    if (small && small.textContent !== sk) small.textContent = sk;
    this.$smoke.title = `Smoke trail — press ${sk}`;
    this.$smoke.hidden = !smokeOk;
    this.$smoke.setAttribute('aria-pressed', smokeOn ? 'true' : 'false');
  }

  /**
   * Sit under whatever is in the top-left corner — the instrument panel on a
   * laptop, the round map on a phone — and never on top of the touch stick.
   * Measured once a second, because the HUD rearranges itself by screen size.
   */
  place(dt, root) {
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

  /**
   * A line of our own — "smoke on" — in our own column, never in the
   * game's toast stack: that holds four, and a test or a child waiting on
   * one of the game's messages must not lose it to ours.
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
    this.side.textContent = '';
  }

  /** At most three things at the side; on a short screen, where the stick is close, two. */
  trimSide() {
    const max = typeof window !== 'undefined' && window.innerHeight < 500 ? 1 : 3;
    while (this.side.children.length > max) this.side.firstChild.remove();
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
    `<span class="emoji" aria-hidden="true">💨</span>
     <span><strong>Fun Stuff</strong>
     <em>Smoke trails — pick a colour</em></span>`
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
    <p class="trigger-note">Anywhere in the game. It all saves on this device, and works offline.</p>
    <div class="fun-grid" data-fun-cards></div>`;
  s.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) {
      menus.show('main');
      return;
    }
    const sw = e.target.closest('[data-colour]');
    if (sw) {
      onColour(sw.dataset.colour);
      render();
    }
  });
  menus.layer.appendChild(s);
  menus.screens.fun = s;

  const render = () => {
    const m = model();
    const swatches = SMOKE_COLOURS.map((c) => {
      const on = m.colour === c.id;
      const bg = c.rgb ? `rgb(${c.rgb.map((v) => Math.round(v * 255)).join(',')})` : 'conic-gradient(#ff4a4a, #ffc247, #4fd684, #58c6ff, #b06bff, #ff4a4a)';
      return `<button type="button" class="fun-swatch${on ? ' is-on' : ''}" data-colour="${c.id}"
        title="${c.name}"><i style="background:${bg}"></i>${c.name}</button>`;
    }).join('');
    s.querySelector('[data-fun-cards]').innerHTML = `
      <article class="fun-card">
        <h3>💨 Smoke trails</h3>
        <p>While flying, press <b>${keyName('smoke')}</b> (or the 💨 button) to leave a smoke trail. Pick a colour:</p>
        <div class="fun-swatches">${swatches}</div>
      </article>`;
  };
  s.render = render;
  return s;
}

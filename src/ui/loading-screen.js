/**
 * The map loading screen: a full-screen picture of the place you are going,
 * its name in big letters, what you are flying, a tip and a slim bar.
 *
 * This file is only the screen and its clock. It knows nothing of the game:
 * features/loading-screens.js decides when to show it, what to put on it and
 * what the bar means. Everything here runs on timers, never requestAnimationFrame,
 * because the test harnesses freeze that and a hidden tab stops it.
 *
 *   show(info)      put it up (fades in); resolves once it has painted
 *   setTarget(p,m)  how far the REAL loading has got (0..1) and what it is doing
 *   ready()         resolves when it may go: the minimum time is up, or the
 *                   player skipped (any key or tap, once skipAfterMs has passed)
 *   hide()          fade out and remove; resolves when it is gone
 *
 * The bar shows min(real loading, time / minMs): it glides across the minimum
 * time, and it never gets ahead of the loading it stands for. A slow load
 * holds it where the loading has got to.
 *
 * Calm: the picture drifts in slowly (a Ken Burns zoom) unless the player has
 * asked for reduced motion; everything else is a plain fade of at least a third
 * of a second, so nothing on it can flash (Reduce flashing, WCAG 2.3.1). It
 * makes no sound.
 *
 * info = { mapId, title, subtitle, kicker, vehicle, game, art, focus, credit, tip, tips }
 * (`focus` is [x, y], in percent: where the picture's subject is, so a phone held upright crops round it)
 */

const CSS = `
.map-load {
  position: fixed; inset: 0; z-index: 150; overflow: hidden;
  display: flex; flex-direction: column; justify-content: flex-end;
  background: #070c15; color: #eaf1fb;
  font-family: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif);
  -webkit-font-smoothing: antialiased; user-select: none; -webkit-user-select: none;
  opacity: 0; transition: opacity var(--ml-in, 320ms) ease;
  touch-action: manipulation; cursor: default;
  padding: env(safe-area-inset-top) env(safe-area-inset-right) 0 env(safe-area-inset-left);
}
.map-load.is-in { opacity: 1; }
.map-load.is-out { opacity: 0; transition-duration: var(--ml-out, 480ms); pointer-events: none; }
.map-load[hidden] { display: none; }
.map-load:focus { outline: none; }

.ml-art { position: absolute; inset: 0; background: var(--ml-fallback, linear-gradient(180deg, #14263f 0%, #070c15 100%)); }
.ml-art img {
  position: absolute; inset: -2%; width: 104%; height: 104%; object-fit: cover; object-position: 50% 60%;
  opacity: 0; transition: opacity 600ms ease; transform-origin: 50% 58%; will-change: transform;
}
.ml-art img.is-loaded { opacity: 1; }
.map-load.is-drifting .ml-art img { animation: ml-drift var(--ml-drift, 11s) ease-out forwards; }
@keyframes ml-drift {
  from { transform: scale(1) translate3d(0, 0, 0); }
  to { transform: scale(1.085) translate3d(-1.1%, -0.7%, 0); }
}
.ml-shade {
  position: absolute; inset: 0; pointer-events: none;
  background:
    linear-gradient(180deg, rgba(7, 12, 21, 0.42) 0%, rgba(7, 12, 21, 0) 26%, rgba(7, 12, 21, 0) 40%, rgba(7, 12, 21, 0.74) 76%, rgba(7, 12, 21, 0.94) 100%),
    linear-gradient(90deg, rgba(7, 12, 21, 0.6) 0%, rgba(7, 12, 21, 0) 60%);
}

.ml-main { position: relative; padding: 0 clamp(20px, 5vw, 72px); margin-bottom: clamp(18px, 4vh, 40px); max-width: 1100px; }
.ml-kicker {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: clamp(12px, 1.5vw, 15px); font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--accent, #58c6ff); text-shadow: 0 1px 12px rgba(0, 0, 0, 0.5);
}
.ml-kicker::before { content: ''; width: 28px; height: 2px; border-radius: 2px; background: currentColor; }
.ml-title {
  margin: 8px 0 0; font-weight: 800; letter-spacing: -0.035em; line-height: 0.96;
  font-size: clamp(2.5rem, 9.4vw, 6.6rem); text-wrap: balance;
  text-shadow: 0 2px 30px rgba(0, 0, 0, 0.5), 0 1px 2px rgba(0, 0, 0, 0.4);
}
.ml-sub { margin: 12px 0 0; font-size: clamp(15px, 2vw, 22px); font-weight: 500; color: rgba(234, 241, 251, 0.9); text-shadow: 0 1px 14px rgba(0, 0, 0, 0.55); }
.ml-craft {
  margin: 16px 0 0; display: inline-flex; align-items: center; gap: 9px;
  padding: 6px 13px 6px 10px; border-radius: 99px;
  font-size: clamp(12px, 1.4vw, 14px); font-weight: 600; letter-spacing: 0.02em;
  background: rgba(12, 20, 34, 0.55); border: 1px solid rgba(140, 180, 230, 0.22);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
.ml-craft svg { width: 17px; height: 17px; fill: currentColor; opacity: 0.9; }
.ml-craft span { color: var(--text-dim, #9fb2cc); font-weight: 500; }

.ml-foot { position: relative; padding: 0 clamp(20px, 5vw, 72px) clamp(14px, 2.6vh, 26px); display: grid; gap: 10px; }
.ml-tip {
  display: flex; align-items: baseline; gap: 12px; max-width: 760px; min-height: 2.8em;
  font-size: clamp(14px, 1.7vw, 18px); line-height: 1.4; color: #eaf1fb; text-shadow: 0 1px 12px rgba(0, 0, 0, 0.55);
  transition: opacity 420ms ease;
}
.ml-tip.is-swapping { opacity: 0; }
.ml-tip-label {
  flex: none; font-size: 0.7em; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase;
  padding: 3px 8px; border-radius: 6px; color: #07101c; background: var(--amber, #ffc247);
}
.ml-status { display: flex; justify-content: space-between; gap: 16px; font-size: clamp(11px, 1.3vw, 13px); color: var(--text-dim, #9fb2cc); }
.ml-skip { opacity: 0; transition: opacity 400ms ease; white-space: nowrap; }
.ml-skip.is-on { opacity: 1; }
.ml-bar { height: 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.14); overflow: hidden; }
.ml-fill {
  height: 100%; width: 0; border-radius: 4px;
  background: linear-gradient(90deg, var(--accent, #58c6ff), var(--accent-2, #7ee8b2));
  transition: width 220ms linear;
}
.ml-credit {
  position: absolute; right: clamp(20px, 5vw, 72px); bottom: clamp(52px, 8vh, 88px); margin: 0;
  font-size: 11px; letter-spacing: 0.02em; color: rgba(234, 241, 251, 0.62); text-shadow: 0 1px 6px rgba(0, 0, 0, 0.7);
}
.ml-foot { padding-bottom: calc(clamp(14px, 2.6vh, 26px) + env(safe-area-inset-bottom)); }

@media (max-width: 560px) {
  .ml-art img { object-position: 42% 60%; }
  .ml-shade { background: linear-gradient(180deg, rgba(7, 12, 21, 0.42) 0%, rgba(7, 12, 21, 0) 24%, rgba(7, 12, 21, 0.1) 38%, rgba(7, 12, 21, 0.8) 70%, rgba(7, 12, 21, 0.95) 100%); }
  .ml-tip { min-height: 4.2em; }
  .ml-credit { position: static; padding: 0 20px 6px; text-align: right; }
}
@media (prefers-reduced-motion: reduce) {
  .map-load.is-drifting .ml-art img { animation: none; }
}
`;

const GLYPHS = {
  flight: '<path d="M12 2l2 7.5 8 4.5v2l-8-2.2-1 4.7 3 2v1.5L12 20.5 8 21.5V20l3-2-1-4.7-8 2.2v-2l8-4.5z"/>',
  heli: '<ellipse cx="10.5" cy="14.5" rx="6" ry="4"/><rect x="2" y="5.5" width="17" height="1.7" rx=".85"/><rect x="9.65" y="6" width="1.7" height="4.5"/><path d="M15.5 13.6H22v1.8h-6.5z"/><rect x="5" y="19.2" width="11" height="1.5" rx=".75"/>',
  boat: '<path d="M2.5 15.5h19l-3.2 5H5.7z"/><path d="M11 3.5v10H4.8z"/><path d="M13 7v6.5h6.2z"/>',
  car: '<path d="M3.5 13.5l1.9-5.2c.3-.8 1-1.3 1.9-1.3h9.4c.9 0 1.6.5 1.9 1.3l1.9 5.2v4.2H19v-1.8H5v1.8H3.5z"/><circle cx="7.4" cy="14.4" r="1.4" fill="#0e1726"/><circle cx="16.6" cy="14.4" r="1.4" fill="#0e1726"/>',
};

let cssIn = false;
function ensureCss(doc) {
  if (cssIn && doc.getElementById('map-load-css')) return;
  const el = doc.createElement('style');
  el.id = 'map-load-css';
  el.textContent = CSS;
  doc.head.appendChild(el);
  cssIn = true;
}

const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export class LoadingScreen {
  /**
   * @param {object} o
   * @param {number} o.minMs        shown at least this long (about three seconds)
   * @param {number} o.skipAfterMs  a key or tap skips from this moment
   * @param {number} o.fadeInMs
   * @param {number} o.fadeOutMs
   * @param {number} o.tipEveryMs   how long a tip stays before the next
   * @param {()=>boolean} o.reducedMotion  true: no zoom
   * @param {()=>string} o.skipWord  "Press any key" or "Tap"
   */
  constructor(o = {}) {
    this.doc = o.doc || document;
    this.cfg = {
      minMs: 3000,
      skipAfterMs: 1000,
      fadeInMs: 320,
      fadeOutMs: 480,
      tipEveryMs: 4200,
      ...o.cfg,
    };
    this.reducedMotion = o.reducedMotion || (() => false);
    this.touch = o.touch || (() => false);
    this.el = null;
    this.t0 = 0;
    this.target = 0;
    this.shown = 0;
    this.message = '';
    this.skipRequested = false;
    this.skippedAt = null;
    this._timer = null;
    this._waiters = [];
    this._tipAt = 0;
    this._tipI = 0;
    this._keyHandler = null;
    this._ready = false;
  }

  get active() {
    return !!this.el;
  }

  /** Milliseconds since it went up. */
  get elapsed() {
    return this.el ? performance.now() - this.t0 : 0;
  }

  /** May a key or tap skip it yet? */
  get skipReady() {
    return this.active && this.elapsed >= this.cfg.skipAfterMs;
  }

  /** True once it may go: the minimum is up, or it was skipped. */
  get canLeave() {
    return this.active && (this.elapsed >= this.cfg.minMs || this.skipRequested);
  }

  async show(info) {
    if (this.el) this.destroy();
    const doc = this.doc;
    ensureCss(doc);
    this.info = info;
    this.t0 = performance.now();
    this.target = 0.02;
    this.shown = 0;
    this.message = 'Getting ready…';
    this.skipRequested = false;
    this.skippedAt = null;
    this._ready = false;

    const el = doc.createElement('div');
    el.className = 'map-load';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', `Loading ${info.title}`);
    el.tabIndex = -1;
    el.dataset.map = info.mapId || '';
    el.dataset.game = info.game || '';
    el.style.setProperty('--ml-in', `${this.cfg.fadeInMs}ms`);
    el.style.setProperty('--ml-out', `${this.cfg.fadeOutMs}ms`);
    if (info.fallback) el.style.setProperty('--ml-fallback', info.fallback);
    const glyph = GLYPHS[info.game] || GLYPHS.flight;
    el.innerHTML = `
      <div class="ml-art"><img alt="" decoding="async" draggable="false"></div>
      <div class="ml-shade"></div>
      <div class="ml-main">
        <div class="ml-kicker">${esc(info.kicker || '')}</div>
        <h1 class="ml-title">${esc(info.title)}</h1>
        <p class="ml-sub">${esc(info.subtitle || '')}</p>
        <p class="ml-craft"><svg viewBox="0 0 24 24" aria-hidden="true">${glyph}</svg>${esc(info.vehicle || '')}</p>
      </div>
      <div class="ml-foot">
        <div class="ml-tip" aria-live="off"><span class="ml-tip-label">Tip</span><span class="ml-tip-text"></span></div>
        <div class="ml-status"><span class="ml-msg" role="status" aria-live="polite"></span><span class="ml-skip"></span></div>
        <div class="ml-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="ml-fill"></div></div>
      </div>
      ${info.credit ? `<p class="ml-credit">${esc(info.credit)}</p>` : ''}`;
    this.el = el;
    this.$img = el.querySelector('.ml-art img');
    this.$tip = el.querySelector('.ml-tip');
    this.$tipText = el.querySelector('.ml-tip-text');
    this.$msg = el.querySelector('.ml-msg');
    this.$skip = el.querySelector('.ml-skip');
    this.$fill = el.querySelector('.ml-fill');
    this.$bar = el.querySelector('.ml-bar');
    this.$skip.textContent = `${this.touch() ? 'Tap' : 'Press any key'} to skip`;
    this._tipI = 0;
    this._tipAt = performance.now();
    this._setTip(this._tips()[0] || '');
    this.$msg.textContent = this.message;

    // The picture: the screen shows the gradient until it is in, then the picture fades up over it.
    // A map with no picture (or one that will not load) keeps the gradient and loses nothing else.
    if (info.art) {
      // A tall narrow screen shows a slice of the 16:9 picture: centre it on the subject, and zoom towards it.
      if (info.focus) {
        const pos = `${info.focus[0]}% ${info.focus[1]}%`;
        this.$img.style.objectPosition = pos;
        this.$img.style.transformOrigin = pos;
      }
      this.$img.addEventListener('load', () => this.$img.classList.add('is-loaded'), { once: true });
      this.$img.addEventListener('error', () => { el.dataset.art = 'missing'; }, { once: true });
      this.$img.src = info.art;
    } else {
      el.dataset.art = 'none';
    }

    // Quiet: this screen swallows key presses and taps so the menu behind it cannot act on them. Key RELEASES
    // are left alone, so a key that was already down when it went up is not left stuck down in the game.
    this._keyHandler = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.type === 'keydown' && !e.repeat) this.skip();
    };
    for (const type of ['keydown', 'keypress']) window.addEventListener(type, this._keyHandler, true);
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.skip();
    });
    el.addEventListener('click', (e) => e.stopPropagation());

    doc.body.appendChild(el);
    try {
      if (doc.activeElement && doc.activeElement !== doc.body && doc.activeElement.blur) doc.activeElement.blur();
      el.focus({ preventScroll: true });
    } catch (e) {
      /* focus is a courtesy */
    }
    if (!this.reducedMotion()) {
      el.classList.add('is-drifting');
      el.style.setProperty('--ml-drift', `${Math.max(8, Math.round((this.cfg.minMs + 6000) / 1000))}s`);
    }
    // One frame at opacity 0, then the fade (timers, not rAF).
    await new Promise((r) => setTimeout(r, 30));
    if (this.el !== el) return;
    el.classList.add('is-in');
    this._paint();
    this._timer = setInterval(() => this._tick(), 50);
    // Resolve once it is up on the screen, however long a picture takes to decode.
    await Promise.race([
      this.$img.decode ? this.$img.decode().catch(() => {}) : Promise.resolve(),
      new Promise((r) => setTimeout(r, 400)),
    ]);
    if (this.el === el && this.$img.complete && this.$img.naturalWidth > 0) this.$img.classList.add('is-loaded');
  }

  _tips() {
    const t = this.info && this.info.tips;
    return t && t.length ? t : [this.info && this.info.tip ? this.info.tip : ''];
  }

  _setTip(text) {
    if (this.$tipText) this.$tipText.textContent = text;
  }

  /** The real loading's progress and what it is doing, for the bar and the line under the tip. */
  setTarget(p, message) {
    this.target = Math.max(this.target, Math.min(1, p));
    if (message) this.message = message;
    this._paint();
  }

  _tick() {
    if (!this.el) return;
    const now = performance.now();
    if (!this.skipReady && this.elapsed >= this.cfg.skipAfterMs) this._paint();
    // The tip changes every few seconds, with a fade.
    const tips = this._tips();
    if (tips.length > 1 && now - this._tipAt >= this.cfg.tipEveryMs) {
      this._tipAt = now;
      this._tipI = (this._tipI + 1) % tips.length;
      const next = tips[this._tipI];
      this.$tip.classList.add('is-swapping');
      setTimeout(() => {
        if (!this.el) return;
        this._setTip(next);
        this.$tip.classList.remove('is-swapping');
      }, 440);
    }
    this._paint();
    if (this.canLeave) this._release();
  }

  _paint() {
    if (!this.el) return;
    const cap = Math.min(this.target, this.elapsed / this.cfg.minMs);
    this.shown = Math.max(this.shown, Math.min(1, cap));
    const pct = Math.round(this.shown * 100);
    this.$fill.style.width = `${(this.shown * 100).toFixed(1)}%`;
    this.$bar.setAttribute('aria-valuenow', String(pct));
    if (this.$msg.textContent !== this.message) this.$msg.textContent = this.message;
    this.$skip.classList.toggle('is-on', this.skipReady);
  }

  /** A key or a tap. Counts only once skipAfterMs has passed. Returns whether it counted. */
  skip() {
    if (!this.active || !this.skipReady || this.skipRequested) return false;
    this.skipRequested = true;
    this.skippedAt = this.elapsed;
    this._tick();
    return true;
  }

  /** Resolves when it may go: the minimum time is up, or it was skipped. */
  ready() {
    if (this.canLeave) return Promise.resolve();
    return new Promise((res) => this._waiters.push(res));
  }

  _release() {
    const w = this._waiters;
    this._waiters = [];
    for (const r of w) r();
  }

  /** Fade out and take it away. Resolves when it has gone. */
  async hide() {
    const el = this.el;
    if (!el) return;
    this.setTarget(1);
    this._release();
    clearInterval(this._timer);
    this._timer = null;
    for (const type of ['keydown', 'keypress']) window.removeEventListener(type, this._keyHandler, true);
    this._keyHandler = null;
    el.classList.add('is-out');
    el.classList.remove('is-in');
    await new Promise((r) => setTimeout(r, this.cfg.fadeOutMs + 40));
    if (this.el === el) this.destroy();
  }

  /** Straight away, no fade. */
  destroy() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    if (this._keyHandler) for (const type of ['keydown', 'keypress']) window.removeEventListener(type, this._keyHandler, true);
    this._keyHandler = null;
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
    this._release();
  }
}

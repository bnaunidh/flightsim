/**
 * The passengers' panel: one small card on the left, under the instruments,
 * for an airliner flight.
 *
 *   PASSENGERS   ★★★★½ 4.6
 *   Relaxed · 168 aboard
 *   Easy on the bank                 (only while something bothers them)
 *   [ Boarding 142/180 ▮▮▮▮▮▯ ]      (at the gate)
 *   [ Skip boarding ]  [ Skip to the runway ]
 *
 * Calm on purpose: muted colours, no flashing, no animation beyond the bar
 * easing, written four times a second and only when something changed. It
 * lives inside the game's HUD wrapper, so it hides with the HUD (U, pause,
 * the debrief) and takes its large-text and high-contrast switches.
 *
 * Its place is measured, not fixed: just under the instrument panel
 * (.hud-left), whatever shape that panel is on this screen (a column on a
 * laptop, a band across the top on a tablet).
 */

import { extLayer } from '../../game/extensions.js';
import { starsText } from './comfort.js';

const CSS = `
.px-panel {
  position: absolute; left: 16px; top: 220px; width: 214px; box-sizing: border-box;
  background: var(--panel, rgba(12,20,34,0.72));
  backdrop-filter: blur(12px) saturate(1.15); -webkit-backdrop-filter: blur(12px) saturate(1.15);
  border: 1px solid rgba(150,190,240,0.22); border-radius: 12px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.35);
  padding: 8px 11px 9px; color: var(--text, #eaf1fb);
  font: 12.5px/1.3 var(--font, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif);
  font-variant-numeric: tabular-nums; pointer-events: none; user-select: none; -webkit-user-select: none;
}
.px-panel[hidden] { display: none; }
.px-head { display: flex; align-items: baseline; gap: 6px; }
.px-lbl { font-size: 10px; letter-spacing: 0.12em; color: var(--text-dim, #9fb2cc); font-weight: 650; }
.px-stars { margin-left: auto; color: #f2cf6b; letter-spacing: 0.02em; font-size: 13px; }
.px-score { font-weight: 700; font-size: 15px; min-width: 26px; text-align: right; }
.px-mood { margin-top: 2px; color: #cfdbea; }
.px-now { margin-top: 3px; color: #ffe0a8; font-size: 12px; }
.px-now:empty { display: none; }
.px-board { margin-top: 6px; }
.px-board[hidden] { display: none; }
.px-board-text { display: flex; justify-content: space-between; font-weight: 620; }
.px-bar { height: 6px; border-radius: 99px; background: rgba(120,170,230,0.18); overflow: hidden; margin-top: 4px; }
.px-bar i { display: block; height: 100%; width: 0; border-radius: 99px; background: linear-gradient(90deg, #58c6ff, #9fe0ff); transition: width 0.25s ease; }
.px-btns { display: flex; gap: 6px; margin-top: 7px; flex-wrap: wrap; }
.px-btns:empty { display: none; }
.px-btn {
  pointer-events: auto; cursor: pointer; border-radius: 8px; padding: 5px 9px;
  font: 650 12px/1.1 var(--font, sans-serif); color: #eaf1fb; background: rgba(88,198,255,0.16);
  border: 1px solid rgba(88,198,255,0.45); touch-action: manipulation;
}
.px-btn:active { transform: scale(0.97); }
.px-btn kbd { font: 700 10px/1 var(--font, sans-serif); padding: 1px 4px; border-radius: 4px; background: rgba(0,0,0,0.3); margin-left: 3px; }
.px-final { margin-top: 5px; font-weight: 620; color: #bff0cf; }
.px-final:empty { display: none; }
.hud.is-large .px-panel { width: 250px; font-size: 14.5px; }
.hud.is-contrast .px-panel { background: #000; border-color: #ffe95c; }
.hud.is-hidden .px-panel { display: none; }
@media (max-width: 560px) { .px-panel { width: 186px; font-size: 11.5px; padding: 6px 9px 7px; } .px-score { font-size: 13px; } }
`;

let styled = false;

export class PassengerPanel {
  constructor(sim, { onButton } = {}) {
    this.sim = sim;
    this.onButton = onButton || (() => {});
    this.last = Object.create(null);
    this.el = null;
    this._layoutT = 0;
    this.mount();
  }

  mount() {
    if (typeof document === 'undefined' || !document.head) return;
    if (!styled) {
      const st = document.createElement('style');
      st.id = 'passengers-style';
      st.textContent = CSS;
      document.head.appendChild(st);
      styled = true;
    }
    const host = (this.sim && this.sim.hud && this.sim.hud.wrap) || extLayer();
    const el = document.createElement('div');
    el.className = 'px-panel';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.innerHTML = `
      <div class="px-head"><span class="px-lbl">PASSENGERS</span><span class="px-stars" data-stars></span><b class="px-score" data-score></b></div>
      <div class="px-mood" data-mood></div>
      <div class="px-now" data-now></div>
      <div class="px-board" data-board hidden><div class="px-board-text"><span data-boardtext></span><span data-boardn></span></div><div class="px-bar"><i data-bar></i></div></div>
      <div class="px-final" data-final></div>
      <div class="px-btns" data-btns></div>`;
    host.appendChild(el);
    this.el = el;
    const q = (k) => el.querySelector(`[data-${k}]`);
    this.stars = q('stars');
    this.score = q('score');
    this.mood = q('mood');
    this.now = q('now');
    this.board = q('board');
    this.boardText = q('boardtext');
    this.boardN = q('boardn');
    this.bar = q('bar');
    this.final = q('final');
    this.btns = q('btns');
    this.btns.addEventListener('pointerdown', (e) => {
      const b = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
      if (!b) return;
      e.preventDefault();
      e.stopPropagation();
      this.onButton(b.dataset.act);
    });
    this.btns.addEventListener('click', (e) => e.preventDefault());
  }

  _set(key, node, prop, value) {
    if (!node || this.last[key] === value) return;
    this.last[key] = value;
    if (prop === 'text') node.textContent = value;
    else if (prop === 'html') node.innerHTML = value;
    else if (prop === 'width') node.style.width = value;
    else if (prop === 'hidden') node.hidden = value;
  }

  /**
   * v = { show, rating, mood, aboard, now, board: { text, n, of } | null,
   *       final, buttons: [{ act, label, key }] }
   */
  render(v) {
    if (!this.el) return;
    if (!v || !v.show) {
      this._set('hidden', this.el, 'hidden', true);
      return;
    }
    this._set('hidden', this.el, 'hidden', false);
    this._set('stars', this.stars, 'text', starsText(v.rating));
    this._set('score', this.score, 'text', v.rating.toFixed(1));
    this._set('mood', this.mood, 'text', `${v.mood} · ${v.aboard} aboard`);
    this._set('now', this.now, 'text', v.now || '');
    const b = v.board;
    this._set('boardh', this.board, 'hidden', !b);
    if (b) {
      this._set('boardtext', this.boardText, 'text', b.text);
      this._set('boardn', this.boardN, 'text', `${b.n}/${b.of}`);
      this._set('bar', this.bar, 'width', `${Math.round((100 * b.n) / Math.max(1, b.of))}%`);
    }
    this._set('final', this.final, 'text', v.final || '');
    const html = (v.buttons || []).map((x) => `<button type="button" class="px-btn" data-act="${x.act}">${x.label}${x.key ? `<kbd>${x.key}</kbd>` : ''}</button>`).join('');
    this._set('btns', this.btns, 'html', html);
  }

  /** Just under the instruments, wherever they are on this screen. */
  layout() {
    if (!this.el || this.el.hidden || typeof document === 'undefined') return;
    const left = document.querySelector('.hud-left');
    if (!left) return;
    const r = left.getBoundingClientRect();
    if (!r.height) return;
    const host = this.el.offsetParent || document.body;
    const hr = host.getBoundingClientRect();
    const top = Math.round(r.bottom - hr.top + 8);
    const lx = Math.round(r.left - hr.left);
    if (this.last.topPx !== top) {
      this.last.topPx = top;
      this.el.style.top = `${top}px`;
    }
    if (this.last.leftPx !== lx) {
      this.last.leftPx = lx;
      this.el.style.left = `${Math.max(8, lx)}px`;
    }
  }

  /** For the tests. */
  snapshot() {
    if (!this.el) return null;
    return {
      shown: !this.el.hidden,
      score: this.score.textContent,
      mood: this.mood.textContent,
      now: this.now.textContent,
      board: this.board.hidden ? '' : `${this.boardText.textContent} ${this.boardN.textContent}`,
      final: this.final.textContent,
      buttons: [...this.btns.querySelectorAll('[data-act]')].map((b) => b.dataset.act),
      rect: (() => {
        const r = this.el.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      })(),
    };
  }

  dispose() {
    if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
    this.el = null;
  }
}

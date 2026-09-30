/**
 * The fire panel, the touch DROP button, and the fire on the minimap.
 *
 * The panel answers the four questions a child has in the middle of this,
 * in the order they have them:
 *   1. How am I doing?         CONTAINED 45 %, with a bar, and a white mark
 *                              on the bar where the crews take over.
 *   2. Have I got water?       a tank gauge and the litres.
 *   3. Where do I go?          FILL or DROP, an arrow turned to where it is
 *                              from the nose, and how far.
 *   4. What am I doing wrong?  one line: "Flaps out — press F", "Lower — the
 *                              bucket has to dip in", "Press X to drop".
 *
 * It lives inside the game's own HUD wrapper, so it hides when the HUD hides
 * (the U key, the pause menu, the debrief) without having to be told, and it
 * inherits the large-text and high-contrast switches. It is written at eight
 * frames a second and only when a value changed, because touching the DOM
 * sixty times a second for a number that moved by one is how a Chromebook
 * drops frames it did not need to.
 *
 * The DROP button exists because X does not: on an iPad the only way to let
 * go of the water is a thing you can touch, and the game's own DROP pad only
 * appears for crates (touch.js hides it unless sim.hasCargo).
 */

import { extLayer } from '../../game/extensions.js';

const CSS = `
.wf-panel {
  position: absolute; right: 16px; top: 250px; width: 236px;
  background: var(--panel, rgba(12,20,34,0.72));
  backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2);
  border: 1px solid rgba(255,140,70,0.35); border-radius: 14px;
  box-shadow: 0 14px 40px rgba(0,0,0,0.45);
  padding: 10px 12px 11px; color: var(--text, #eaf1fb);
  font: 13px/1.3 var(--font, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif);
  pointer-events: none; font-variant-numeric: tabular-nums;
}
.wf-panel[hidden] { display: none; }
.wf-head { display: flex; align-items: center; gap: 7px; font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #ffb37a; }
.wf-head svg { width: 15px; height: 15px; flex: none; }
.wf-pct { margin-left: auto; font-size: 20px; font-weight: 680; letter-spacing: -0.01em; color: #fff; text-transform: none; }
.wf-pct small { font-size: 11px; font-weight: 560; color: #cfd8e6; margin-left: 3px; letter-spacing: 0.04em; }
.wf-bar { position: relative; height: 7px; border-radius: 99px; background: rgba(255,90,40,0.28); overflow: hidden; margin: 6px 0 9px; }
.wf-bar i { display: block; height: 100%; width: 0; border-radius: 99px; background: linear-gradient(90deg, #4fd684, #7ee8b2); transition: width 0.3s ease; }
.wf-bar b { position: absolute; top: 0; bottom: 0; width: 2px; margin-left: -1px; background: #fff; opacity: 0.9; }
.wf-bar b[hidden] { display: none; }
.wf-row { display: grid; grid-template-columns: 48px 1fr auto; align-items: center; gap: 8px; }
.wf-lbl { font-size: 10.5px; letter-spacing: 0.1em; color: var(--text-dim, #9fb2cc); }
.wf-tank { height: 12px; border-radius: 4px; background: rgba(88,198,255,0.14); border: 1px solid rgba(88,198,255,0.35); overflow: hidden; }
.wf-tank i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #2f8fe0, #58c6ff); }
.wf-tank.is-filling i { background: linear-gradient(90deg, #58c6ff, #bfeaff); }
.wf-lit { font-size: 12px; font-weight: 620; min-width: 58px; text-align: right; }
.wf-next { display: flex; align-items: center; gap: 9px; margin-top: 9px; padding: 7px 9px; border-radius: 10px; background: rgba(255,255,255,0.06); }
.wf-next.is-fill { background: rgba(88,198,255,0.14); }
.wf-next.is-drop { background: rgba(255,120,60,0.16); }
.wf-arrow { width: 22px; height: 22px; display: grid; place-items: center; flex: none; transition: transform 0.15s linear; }
.wf-arrow svg { width: 20px; height: 20px; }
.wf-next-text { font-size: 13px; font-weight: 600; }
.wf-next-text em { font-style: normal; font-weight: 500; color: var(--text-dim, #9fb2cc); margin-left: 4px; }
.wf-tip { margin-top: 7px; font-size: 12.5px; color: #ffe0a8; min-height: 16px; }
.wf-tip.is-good { color: #9ff0bf; }
.wf-tip:empty { display: none; }
.wf-warn { margin-top: 7px; padding: 5px 8px; border-radius: 8px; background: rgba(200,40,25,0.85); color: #fff; font-size: 12px; font-weight: 680; letter-spacing: 0.02em; }
.wf-warn[hidden] { display: none; }
.wf-clock { margin-top: 7px; font-size: 12.5px; font-weight: 640; color: #bfe6ff; letter-spacing: 0.02em; }
.wf-clock:empty { display: none; }
.hud.is-large .wf-panel { width: 270px; font-size: 15px; }
.hud.is-contrast .wf-panel { background: #000; border-color: #ffe95c; }
.hud.is-touch .wf-panel { top: 140px; right: 12px; width: 214px; }
.hud.is-touch.is-rotorhover .wf-panel { top: 186px; }
.wf-drop {
  position: absolute; right: 96px; bottom: 196px; width: 104px; height: 70px;
  border-radius: 16px; border: 2px solid rgba(190,234,255,0.8);
  background: linear-gradient(180deg, #2f9bef, #1a6fc0); color: #fff;
  font: 800 15px/1.1 var(--font, sans-serif); letter-spacing: 0.06em;
  box-shadow: 0 10px 26px rgba(0,0,0,0.45); pointer-events: auto; touch-action: manipulation;
  -webkit-user-select: none; user-select: none;
}
.wf-drop[hidden] { display: none; }
.wf-drop:active { transform: scale(0.96); }
.wf-drop.is-empty { background: rgba(40,60,80,0.8); border-color: rgba(140,180,230,0.4); color: #cfe0f2; font-size: 12px; }
@media (max-width: 560px) { .wf-panel { width: 190px; top: 120px; font-size: 12px; } .wf-pct { font-size: 17px; } }
/* A phone stacks the control pads two by three from 60 px up to 208, which
   is where the button sits on a tablet. Above the stick instead: 8-124 is
   the stick, 216 up is the radio line. */
@media (max-width: 560px) { .wf-drop { left: 8px; right: auto; bottom: 132px; width: 116px; height: 56px; font-size: 13px; } }
`;

const FLAME_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#ff8a3d" d="M12 2c1 3.2-1.3 4.6-2.6 6.6C8 10.8 7 12.7 7 15a5 5 0 0 0 10 0c0-2.1-.9-3.6-2-5 .1 1.6-.5 2.8-1.6 3.3.4-2.9-.4-7.4-1.4-11.3z"/><path fill="#ffd36b" d="M12 12.5c.6 1.6-.6 2.3-1 3.3-.3.7 0 1.9 1 1.9s1.6-1 1.4-2c-.2-1.3-.8-2.3-1.4-3.2z"/></svg>`;
const ARROW_SVG = `<svg viewBox="0 0 20 20" aria-hidden="true"><path fill="currentColor" d="M10 1.5 16.5 17 10 13.4 3.5 17z"/></svg>`;

let styled = false;
const DASH = [4, 3];
const NO_DASH = [];

/** What else lives down the right-hand side of the screen. */
const BLOCKERS = ['.hud-right', '.hud-damage', '.hud-vital', '.hud-tray', '.hud-buttons', '.minimap', '.touch-pads', '.touch-throttle', '.touch-lever', '.wf-drop'];

export class FireHud {
  constructor(sim, { onDrop } = {}) {
    this.sim = sim;
    this.onDrop = onDrop;
    this.last = {};
    this.visible = false;
    this._t = 0;
    this._layoutT = 0;
    this.mount();
  }

  mount() {
    if (typeof document === 'undefined') return;
    if (!styled) {
      const st = document.createElement('style');
      st.id = 'wildfire-style';
      st.textContent = CSS;
      document.head.appendChild(st);
      styled = true;
    }
    const host = (this.sim && this.sim.hud && this.sim.hud.wrap) || extLayer();
    const el = document.createElement('div');
    el.className = 'wf-panel';
    el.hidden = true;
    el.setAttribute('role', 'status');
    el.innerHTML = `
      <div class="wf-head">${FLAME_SVG}<span>Wildfire</span><span class="wf-pct" data-pct>0%<small>contained</small></span></div>
      <div class="wf-bar"><i data-bar></i><b data-goal hidden title="The crews take over here"></b></div>
      <div class="wf-row"><span class="wf-lbl" data-tanklbl>WATER</span><div class="wf-tank" data-tank><i></i></div><b class="wf-lit" data-lit>0 L</b></div>
      <div class="wf-next" data-next><span class="wf-arrow" data-arrow>${ARROW_SVG}</span><span class="wf-next-text" data-nexttext></span></div>
      <div class="wf-tip" data-tip></div>
      <div class="wf-clock" data-clock></div>
      <div class="wf-warn" data-warn hidden></div>`;
    host.appendChild(el);
    this.el = el;
    this.q = (k) => el.querySelector(`[data-${k}]`);
    this.pct = this.q('pct');
    this.bar = this.q('bar');
    this.goal = this.q('goal');
    this.tank = this.q('tank');
    this.tankFill = this.tank.firstElementChild;
    this.tankLbl = this.q('tanklbl');
    this.lit = this.q('lit');
    this.next = this.q('next');
    this.arrow = this.q('arrow');
    this.nextText = this.q('nexttext');
    this.tip = this.q('tip');
    this.warn = this.q('warn');
    this.clock = this.q('clock');

    const btn = document.createElement('button');
    btn.className = 'wf-drop';
    btn.type = 'button';
    btn.hidden = true;
    btn.innerHTML = 'DROP<br>WATER';
    const fire = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (this.onDrop) this.onDrop();
    };
    btn.addEventListener('pointerdown', fire);
    btn.addEventListener('click', (e) => e.preventDefault());
    host.appendChild(btn);
    this.btn = btn;
  }

  _set(key, node, prop, value) {
    if (this.last[key] === value) return;
    this.last[key] = value;
    if (prop === 'text') node.textContent = value;
    else if (prop === 'html') node.innerHTML = value;
    else if (prop === 'width') node.style.width = value;
    else if (prop === 'left') node.style.left = value;
    else if (prop === 'transform') node.style.transform = value;
    else if (prop === 'class') node.className = value;
    else if (prop === 'hidden') node.hidden = value;
  }

  /**
   * Find the panel a place on the right that nothing else is using.
   *
   * It sat at a fixed 250 px from the top, clear of the damage box — and on a
   * Chromebook, whose window is about 650 px tall, the minimap in the bottom
   * right starts at 350, so the two overlapped by seventy pixels. What sits
   * on the right changes with the screen, the touch layout and the flight
   * (the damage box only appears once you have been hit), so it is measured:
   * twice a second, the first gap down the right-hand column that the panel
   * fits in. If there is none, it goes under whatever is at the top and
   * overlaps what is at the bottom, which is the minimap: the one thing on
   * that side a child can switch off (J).
   */
  layout() {
    const el = this.el;
    if (!el || el.hidden || typeof document === 'undefined') return;
    const pr = el.getBoundingClientRect();
    if (!pr.height) return;
    const H = window.innerHeight || 800;
    const spans = [];
    for (const sel of BLOCKERS) {
      for (const n of document.querySelectorAll(sel)) {
        if (n === el) continue;
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height || r.right < pr.left || r.left > pr.right) continue;
        spans.push([r.top, r.bottom]);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const need = pr.height + 16;
    let y = 8;
    let top = null;
    for (const [t, b] of spans) {
      if (t - y >= need) {
        top = y + 8;
        break;
      }
      // Only what is near the top pushes the fallback down.
      if (t < H * 0.5) y = Math.max(y, b);
    }
    if (top === null) top = y + 8;
    top = Math.round(Math.max(8, top));
    if (this.last.top !== top) {
      this.last.top = top;
      el.style.top = `${top}px`;
    }
  }

  setVisible(on) {
    if (!this.el) return;
    if (this.visible === on) return;
    this.visible = on;
    this._layoutT = 0;
    this.el.hidden = !on;
    if (!on && this.btn) this.btn.hidden = true;
    this.last = {};
  }

  /**
   * @param {object} m
   *   contained 0..1, burning, litres, capacity, kind, filling,
   *   next { kind: 'fill'|'drop', dist, rel } | null,
   *   tip, tipGood, warn, touch, armed
   */
  update(dt, m) {
    if (!this.el || !this.visible) return;
    this._t += dt;
    this._layoutT -= dt;
    if (this._t < 0.125 && !m.force) return;
    this._t = 0;
    if (this._layoutT <= 0) {
      this._layoutT = 0.5;
      this.layout();
    }
    const pct = Math.round(m.contained * 100);
    this._set('pct', this.pct, 'html', m.burning ? `${pct}%<small>contained</small>` : 'Out<small>all clear</small>');
    this._set('bar', this.bar, 'width', `${m.burning ? pct : 100}%`);
    const goal = m.goal && m.burning ? Math.round(m.goal * 100) : 0;
    this._set('goalh', this.goal, 'hidden', !goal);
    if (goal) this._set('goall', this.goal, 'left', `${goal}%`);
    const f = m.capacity ? Math.max(0, Math.min(1, m.litres / m.capacity)) : 0;
    this._set('tankw', this.tankFill, 'width', `${Math.round(f * 100)}%`);
    this._set('tankc', this.tank, 'class', m.filling ? 'wf-tank is-filling' : 'wf-tank');
    this._set('tankl', this.tankLbl, 'text', m.kind === 'bucket' ? 'BUCKET' : 'TANK');
    this._set('lit', this.lit, 'text', `${Math.max(0, Math.round(m.litres)).toLocaleString('en-GB')} L`);
    if (m.next) {
      const km = m.next.dist >= 1000 ? `${(m.next.dist / 1000).toFixed(1)} km` : `${Math.round(m.next.dist / 10) * 10} m`;
      const word = m.next.kind === 'fill' ? 'FILL UP' : 'DROP';
      const where = m.next.label ? ` ${m.next.label}` : '';
      this._set('nextc', this.next, 'class', `wf-next is-${m.next.kind}`);
      this._set('nextt', this.nextText, 'html', `${word}${where}<em>${km}</em>`);
      const rot = Math.round(m.next.rel / 5) * 5;
      this._set('rot', this.arrow, 'transform', `rotate(${rot}deg)`);
      this._set('nexth', this.next, 'hidden', false);
    } else {
      this._set('nexth', this.next, 'hidden', true);
    }
    this._set('tip', this.tip, 'text', m.tip || '');
    this._set('tipc', this.tip, 'class', m.tipGood ? 'wf-tip is-good' : 'wf-tip');
    this._set('clock', this.clock, 'text', m.clock || '');
    this._set('warnt', this.warn, 'text', m.warn || '');
    this._set('warnh', this.warn, 'hidden', !m.warn);
    if (this.btn) {
      const show = !!(m.touch && m.armed);
      this._set('btnh', this.btn, 'hidden', !show);
      const empty = f < 0.05;
      this._set('btnc', this.btn, 'class', empty ? 'wf-drop is-empty' : 'wf-drop');
      this._set('btnt', this.btn, 'html', empty ? (m.kind === 'bucket' ? 'BUCKET<br>EMPTY' : 'TANK<br>EMPTY') : 'DROP<br>WATER');
    }
  }

  dispose() {
    if (this.el) this.el.remove();
    if (this.btn) this.btn.remove();
    this.el = null;
    this.btn = null;
  }
}

/**
 * The fire, on the game's minimap, drawn after the minimap has drawn itself
 * this frame (main.js ticks the minimap before the plug-ins' update).
 *
 * The minimap has no hook for extra marks, so this uses what it does expose:
 * its canvas context (already scaled 2x), `span` in metres across, `visible`
 * and `mode`. North up, the aircraft in the middle, 190 logical pixels — the
 * same arithmetic as Minimap.update(). Guarded throughout: if the minimap is
 * ever rebuilt differently this draws nothing rather than something wrong.
 */
export function drawOnMinimap(sim, grid, fill, target, line = null) {
  const mm = sim && sim.minimap;
  if (!mm || !mm.visible || !mm.ctx || typeof mm.span !== 'number') return;
  if (mm.mode !== 'flight' && mm.mode !== 'heli') return;
  const ac = sim.aircraft;
  if (!ac) return;
  const SIZE = 190;
  const ctx = mm.ctx;
  const k = SIZE / mm.span;
  const k0 = k;
  const c = SIZE / 2;
  const ox = ac.pos.x;
  const oz = ac.pos.z;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c, c, SIZE / 2 - 2, 0, Math.PI * 2);
  ctx.clip();
  if (line && line.length > 1) {
    // The crews' line: a dashed yellow track, the same as the tape on the ground.
    ctx.strokeStyle = 'rgba(255, 205, 40, 0.95)';
    ctx.lineWidth = 2;
    ctx.setLineDash(DASH);
    ctx.beginPath();
    for (let k = 0; k < line.length; k++) {
      const x = c + (line[k].x - ox) * k0;
      const y = c + (line[k].z - oz) * k0;
      if (k) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash(NO_DASH);
  }
  if (grid && grid.burning) {
    const r = Math.max(1.3, grid.cell * k * 0.8);
    ctx.fillStyle = 'rgba(255, 110, 40, 0.9)';
    // At most ~300 dots; a big fire is drawn with a stride and still reads.
    const stride = Math.max(1, Math.ceil(grid.burning / 300));
    for (let s = 0; s < grid.burning; s += stride) {
      const i = grid.slotCell[s];
      const x = c + (grid.cellX(i) - ox) * k;
      const y = c + (grid.cellZ(i) - oz) * k;
      if (x < -4 || y < -4 || x > SIZE + 4 || y > SIZE + 4) continue;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
  if (fill) {
    const x = Math.max(8, Math.min(SIZE - 8, c + (fill.x - ox) * k));
    const y = Math.max(8, Math.min(SIZE - 8, c + (fill.z - oz) * k));
    ctx.fillStyle = '#58c6ff';
    ctx.strokeStyle = 'rgba(8,14,24,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.quadraticCurveTo(x + 5, y + 1, x, y + 5);
    ctx.quadraticCurveTo(x - 5, y + 1, x, y - 6);
    ctx.fill();
    ctx.stroke();
  }
  if (target) {
    const x = c + (target.x - ox) * k;
    const y = c + (target.z - oz) * k;
    if (x > 0 && y > 0 && x < SIZE && y < SIZE) {
      ctx.strokeStyle = 'rgba(255, 235, 150, 0.95)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.restore();
}

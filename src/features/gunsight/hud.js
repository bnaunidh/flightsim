/**
 * The gunsight's screen: a centre dot inside a ring (where the nose points),
 * range ticks round the ring, a lead pipper (where the nose must point to hit
 * the locked target), the target box with its name and range, an arrow for a
 * target that is off the screen, and the touch LOCK button.
 *
 * "make the crosshair better and have a lockon" (the owner, 2026-10-12).
 * Plain DOM and SVG on the feature layer (extensions.js extLayer), pointer
 * events off except the button. One thin line weight and one dark halo so it
 * stays readable on sky, sea and cloud at 390x844 or 1440x900, and nothing
 * on it blinks: the box changes colour and stays put, the pipper dims, and
 * the ticks light up one by one (Reduce flashing has nothing to do here).
 * No sound is made at all.
 */

import { extLayer } from '../../game/extensions.js';

const CSS = `
.gsk-root { position: fixed; inset: 0; pointer-events: none; z-index: 28; }
.gsk-root[hidden], .gsk-sight[hidden], .gsk-pip[hidden], .gsk-box[hidden], .gsk-arrow[hidden], .gsk-btn[hidden] { display: none !important; }
.gsk-sight svg, .gsk-pip svg { display: block; width: 100%; height: 100%; overflow: visible; }
.gsk-sight { position: fixed; left: 0; top: 0; width: 64px; height: 64px; margin: -32px 0 0 -32px; will-change: transform; overflow: visible;
  filter: drop-shadow(0 0 1px rgba(0,0,0,0.85)) drop-shadow(0 0 2px rgba(0,0,0,0.35)); }
.gsk-sight .gsk-ring { fill: none; stroke: #c9ffd6; stroke-width: 1.6; opacity: 0.85; }
.gsk-sight .gsk-dot { fill: #eafff0; }
.gsk-sight .gsk-tick { stroke: #c9ffd6; stroke-width: 1.7; stroke-linecap: round; opacity: 0.28; }
.gsk-sight .gsk-tick.is-lit { opacity: 1; stroke: #9dffb4; }
.gsk-sight.is-inrange .gsk-ring { stroke: #7dffa0; opacity: 1; }
.gsk-sight.is-idle .gsk-ring { opacity: 0.55; }
.gsk-sight.is-idle .gsk-tick { display: none; }
.gsk-pip { position: fixed; left: 0; top: 0; width: 30px; height: 30px; margin: -15px 0 0 -15px; will-change: transform; overflow: visible;
  filter: drop-shadow(0 0 1px rgba(0,0,0,0.85)); }
.gsk-pip circle { fill: none; stroke: #ffe27a; stroke-width: 1.8; }
.gsk-pip line { stroke: #ffe27a; stroke-width: 1.8; stroke-linecap: round; }
.gsk-pip.is-far { opacity: 0.55; }
.gsk-pip.is-far circle { stroke-dasharray: 2.4 2.4; }
.gsk-box { position: fixed; left: 0; top: 0; width: 56px; height: 56px; margin: -28px 0 0 -28px; will-change: transform; color: #8fe8ff; }
.gsk-box i { position: absolute; width: 14px; height: 14px; border: 2.5px solid currentColor; filter: drop-shadow(0 0 1px rgba(0,0,0,0.8)); }
.gsk-box i:nth-child(1) { left: 0; top: 0; border-right: 0; border-bottom: 0; }
.gsk-box i:nth-child(2) { right: 0; top: 0; border-left: 0; border-bottom: 0; }
.gsk-box i:nth-child(3) { left: 0; bottom: 0; border-right: 0; border-top: 0; }
.gsk-box i:nth-child(4) { right: 0; bottom: 0; border-left: 0; border-top: 0; }
.gsk-box.is-acquire { color: #ffd24a; }
.gsk-box.is-locked { color: #ff3b30; }
.gsk-box .gsk-tag { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); margin-top: 5px; white-space: nowrap; padding: 1px 7px; border-radius: 4px;
  background: rgba(10,16,24,0.78); font: 800 11px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.08em; color: inherit; }
.gsk-arrow { position: fixed; left: 0; top: 0; width: 0; height: 0; margin: 0; will-change: transform; color: #8fe8ff; }
.gsk-arrow::before { content: ''; position: absolute; left: -11px; top: -14px; border-left: 11px solid transparent; border-right: 11px solid transparent; border-bottom: 20px solid currentColor;
  filter: drop-shadow(0 0 3px rgba(0,0,0,0.7)); }
.gsk-arrow.is-acquire { color: #ffd24a; }
.gsk-arrow.is-locked { color: #ff3b30; }
.gsk-arrow b { position: absolute; left: -44px; top: 9px; width: 88px; text-align: center; font: 800 11.5px/1.15 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff; letter-spacing: 0.04em;
  text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 2px #000; }
.gsk-btn { position: fixed; z-index: 31; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; cursor: pointer; border-radius: 50%; color: #fff;
  border: 3px solid #1b1030; font: 900 13px/1.05 "Arial Black", Impact, sans-serif; display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  box-shadow: 0 5px 0 #1b1030, 0 8px 18px rgba(0,0,0,0.35); background: radial-gradient(circle at 35% 30%, #b8f0ff, #3fb6e6 60%, #1c7fb0); }
.gsk-btn small { font: 700 10px/1.1 system-ui, sans-serif; opacity: 0.9; margin-top: 2px; }
.gsk-btn.is-down { transform: translateY(3px); box-shadow: 0 2px 0 #1b1030; }
.gsk-btn.is-held { background: radial-gradient(circle at 35% 30%, #ffe08a, #ffb02f 60%, #c98212); }
html.is-touch-device .gsk-btn { display: flex; }
html.is-touch-device .gsk-btn[hidden] { display: none !important; }
/* A tablet or a big phone: next to the FLARES button, in the same row above the touch pads. */
.gsk-btn.is-lock { right: 356px; bottom: 214px; width: 58px; height: 58px; }
/* A phone upright: the right edge above FIRE MSL, which has the whole column up there to itself. */
@media (max-width: 560px) {
  html.is-touch-device .gsk-btn.is-lock { right: 12px; bottom: 340px; width: 56px; height: 56px; }
}
/* A phone on its side: in the same low row, left of FLARES. */
@media (max-height: 520px) and (min-width: 561px) {
  html.is-touch-device .gsk-btn.is-lock { right: 418px; bottom: 104px; width: 56px; height: 56px; }
}
`;

const S = { els: null, tickLit: -1, key: '' };
const TICKS = 12;

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

/** An HTML box (so `hidden` works) holding one SVG drawing. */
function svg(cls, parent, inner, viewBox) {
  return el('div', cls, parent, `<svg viewBox="${viewBox}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${inner}</svg>`);
}

export function ensureHud(handlers = {}) {
  if (S.els || typeof document === 'undefined') return S.els;
  if (!document.getElementById('ifs-gunsight-style')) {
    const st = document.createElement('style');
    st.id = 'ifs-gunsight-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = el('div', 'gsk-root', extLayer());
  root.hidden = true;
  let ticks = '';
  for (let i = 0; i < TICKS; i++) {
    const a = (i / TICKS) * Math.PI * 2;
    const s = Math.sin(a);
    const c = Math.cos(a);
    ticks += `<line class="gsk-tick" x1="${(s * 26).toFixed(2)}" y1="${(-c * 26).toFixed(2)}" x2="${(s * 31).toFixed(2)}" y2="${(-c * 31).toFixed(2)}"/>`;
  }
  const sight = svg('gsk-sight is-idle', root, `<circle class="gsk-ring" r="21"/><circle class="gsk-dot" r="2.2"/>${ticks}`, '-32 -32 64 64');
  sight.hidden = true;
  const pip = svg('gsk-pip', root, '<circle r="6.5"/><line x1="0" y1="-12" x2="0" y2="-9"/><line x1="0" y1="12" x2="0" y2="9"/><line x1="-12" y1="0" x2="-9" y2="0"/><line x1="12" y1="0" x2="9" y2="0"/>', '-15 -15 30 30');
  pip.hidden = true;
  const box = el('div', 'gsk-box', root, '<i></i><i></i><i></i><i></i><span class="gsk-tag"></span>');
  box.hidden = true;
  const arrow = el('div', 'gsk-arrow', root, '<b></b>');
  arrow.hidden = true;

  // The touch button lives on the layer itself, not in the root, so it stays tappable when the root's pointer events are off.
  const btn = el('button', 'gsk-btn is-lock', extLayer(), 'LOCK<small>target</small>');
  btn.type = 'button';
  btn.hidden = true;
  btn.setAttribute('aria-label', 'Lock on: pick the next target in front');
  btn.addEventListener('pointerdown', (e) => {
    if (e && e.cancelable) e.preventDefault();
    try {
      btn.setPointerCapture(e.pointerId);
    } catch (err) {
      /* a synthetic event in a test has no pointer to capture */
    }
    btn.classList.add('is-down');
    if (handlers.lock) handlers.lock();
  });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) btn.addEventListener(ev, () => btn.classList.remove('is-down'));

  S.els = { root, sight, pip, box, arrow, btn, tag: box.querySelector('.gsk-tag'), arrowText: arrow.querySelector('b'), ticks: Array.from(sight.querySelectorAll('.gsk-tick')) };
  return S.els;
}

/** The whole overlay on or off (not flying, hidden interface, paused...). */
export function show(on) {
  const e = S.els;
  if (!e) return;
  e.root.hidden = !on;
  if (!on) e.btn.hidden = true;
}

/** The ring and dot where the nose points. `idle`: no target, so the ticks are not drawn. */
export function setSight(on, x = 0, y = 0, { idle = true, lit = 0, inRange = false } = {}) {
  const e = S.els;
  if (!e) return;
  e.sight.hidden = !on;
  if (!on) return;
  e.sight.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  const cls = `gsk-sight${idle ? ' is-idle' : ''}${inRange ? ' is-inrange' : ''}`;
  if (e.sight.className !== cls) e.sight.className = cls;
  if (lit !== S.tickLit) {
    S.tickLit = lit;
    e.ticks.forEach((t, i) => t.classList.toggle('is-lit', i < lit));
  }
}

/** The lead pipper at screen (x, y). `far`: out of the gun's reach, drawn dim and dashed. */
export function setPipper(on, x = 0, y = 0, far = false) {
  const e = S.els;
  if (!e) return;
  e.pip.hidden = !on;
  if (!on) return;
  e.pip.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  const cls = `gsk-pip${far ? ' is-far' : ''}`;
  if (e.pip.className !== cls) e.pip.className = cls;
}

/** The target box on the locked target at (x, y). state: 'locked' (a target is held) | 'acquire' | 'red'. */
export function setBox(on, x = 0, y = 0, state = 'locked', tag = '') {
  const e = S.els;
  if (!e) return;
  e.box.hidden = !on;
  if (!on) return;
  const cls = `gsk-box${state === 'acquire' ? ' is-acquire' : state === 'red' ? ' is-locked' : ''}`;
  if (e.box.className !== cls) e.box.className = cls;
  e.box.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  if (e.tag.textContent !== tag) e.tag.textContent = tag;
}

/** The off-screen arrow: at (x, y) on the ring round the middle, turned `ang` radians clockwise from up. */
export function setArrow(on, x = 0, y = 0, ang = 0, state = 'locked', text = '') {
  const e = S.els;
  if (!e) return;
  e.arrow.hidden = !on;
  if (!on) return;
  const cls = `gsk-arrow${state === 'acquire' ? ' is-acquire' : state === 'red' ? ' is-locked' : ''}`;
  if (e.arrow.className !== cls) e.arrow.className = cls;
  e.arrow.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${((ang * 180) / Math.PI).toFixed(1)}deg)`;
  // The words stay upright whatever the arrow does.
  e.arrowText.style.transform = `rotate(${((-ang * 180) / Math.PI).toFixed(1)}deg)`;
  if (e.arrowText.textContent !== text) e.arrowText.textContent = text;
}

export function setButton(on, held = false) {
  const e = S.els;
  if (!e) return;
  e.btn.hidden = !on;
  e.btn.classList.toggle('is-held', !!held);
  const small = e.btn.querySelector('small');
  const word = held ? 'next' : 'target';
  if (small && small.textContent !== word) small.textContent = word;
}

export function snapshot() {
  const e = S.els;
  if (!e) return null;
  const up = !e.root.hidden;
  return {
    visible: up,
    sightShown: up && !e.sight.hidden,
    idle: up && !e.sight.hidden && /is-idle/.test(e.sight.className || ''),
    inRange: up && !e.sight.hidden && /is-inrange/.test(e.sight.className || ''),
    ticksLit: e.ticks.filter((t) => t.classList.contains('is-lit')).length,
    pipperShown: up && !e.pip.hidden,
    pipperFar: up && !e.pip.hidden && /is-far/.test(e.pip.className || ''),
    boxShown: up && !e.box.hidden,
    boxRed: up && !e.box.hidden && /is-locked/.test(e.box.className),
    boxAcquire: up && !e.box.hidden && /is-acquire/.test(e.box.className),
    tag: up && !e.box.hidden ? e.tag.textContent : '',
    arrowShown: up && !e.arrow.hidden,
    arrowText: up && !e.arrow.hidden ? e.arrowText.textContent : '',
    lockButton: up && !e.btn.hidden,
  };
}

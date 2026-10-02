/**
 * T-Pose Harrison's two buttons on a touch screen: SPIN (the spin climb, T on
 * a keyboard) and BOOST (1000 kt, P P P). Shown only while you fly him, and
 * only on a touch screen; a keyboard has the keys and a one-line hint the
 * first time you fly him.
 *
 * Above the throttle, on the right, clear of the stick (bottom left), the
 * pads (bottom right) and the EJECT column (left). Off whenever the game is
 * paused, in a menu or has its interface hidden — the same gate as the
 * walker's and the eject buttons (staff/ui.js), set by ../tpose.js.
 */

import { extLayer } from '../../game/extensions.js';

const CSS = `
.tp-root { position: fixed; inset: 0; pointer-events: none; z-index: 31; font-family: var(--font, system-ui, sans-serif); }
.tp-root.tp-off { display: none; }
.tp-col { position: absolute; right: 14px; bottom: 196px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.tp-btn { pointer-events: auto; display: none; min-width: 86px; height: 46px; padding: 0 12px; border-radius: 12px;
  font: 800 13px/1 var(--font, system-ui, sans-serif); letter-spacing: .06em; color: #fff; cursor: pointer;
  touch-action: manipulation; user-select: none; -webkit-user-select: none; border: 2px solid rgba(255,255,255,.35);
  background: rgba(20,60,38,.82); box-shadow: 0 3px 10px rgba(0,0,0,.35); align-items: center; justify-content: center; gap: 6px; }
.tp-btn.is-on { display: inline-flex; }
.tp-btn small { font-size: 9.5px; font-weight: 700; opacity: .85; letter-spacing: 0; }
.tp-btn.is-active { background: #2fb36b; border-color: #d9ffe8; }
.tp-btn.is-dim { opacity: .55; }
@media (max-height: 520px) { .tp-col { bottom: 186px; right: 10px; gap: 6px; } .tp-btn { height: 40px; min-width: 76px; } }
`;

const UI = { root: null, buttons: {}, onPress: null, key: '' };

function btn(html, id) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tp-btn';
  b.innerHTML = html;
  b.dataset.tp = id;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (UI.onPress) UI.onPress(id);
  });
  return b;
}

/** Build once. `onPress(id)` gets 'spin' or 'boost'. False with no page. */
export function build(onPress) {
  if (UI.root) {
    UI.onPress = onPress;
    return true;
  }
  if (typeof document === 'undefined' || !document.body) return false;
  UI.onPress = onPress;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'tp-root';
  const col = document.createElement('div');
  col.className = 'tp-col';
  UI.buttons.spin = btn('SPIN <small>climb</small>', 'spin');
  UI.buttons.boost = btn('BOOST <small>1000 kt</small>', 'boost');
  col.append(UI.buttons.spin, UI.buttons.boost);
  root.appendChild(col);
  extLayer().appendChild(root);
  UI.root = root;
  return true;
}

/** Everything off (paused, a menu, the interface hidden). */
export function setGate(off) {
  if (UI.root) UI.root.classList.toggle('tp-off', !!off);
}

/** { show, spinOn, boostOn, boostReady } — show: Harrison on a touch screen. */
export function setButtons(want) {
  if (!UI.root) return;
  const key = `${!!want.show}${!!want.spinOn}${!!want.boostOn}${!!want.boostReady}`;
  if (key === UI.key) return;
  UI.key = key;
  const { spin, boost } = UI.buttons;
  spin.classList.toggle('is-on', !!want.show);
  boost.classList.toggle('is-on', !!want.show);
  spin.classList.toggle('is-active', !!want.spinOn);
  boost.classList.toggle('is-active', !!want.boostOn);
  boost.classList.toggle('is-dim', !want.boostOn && !want.boostReady);
  spin.innerHTML = want.spinOn ? 'SPIN <small>stop</small>' : 'SPIN <small>climb</small>';
  boost.innerHTML = want.boostOn ? 'BOOST <small>stop</small>' : 'BOOST <small>1000 kt</small>';
}

/** For the tests: what is showing. */
export function snapshot() {
  const on = (el) => !!(el && el.classList.contains('is-on'));
  return {
    built: !!UI.root,
    off: !!(UI.root && UI.root.classList.contains('tp-off')),
    spin: on(UI.buttons.spin),
    boost: on(UI.buttons.boost),
    spinText: UI.buttons.spin ? UI.buttons.spin.textContent : '',
    boostText: UI.buttons.boost ? UI.buttons.boost.textContent : '',
  };
}

/** For the tests: press a button the way a finger does. */
export function press(id) {
  const b = UI.buttons[id];
  if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
}

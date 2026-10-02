/**
 * What the eject feature puts on screen: the touch buttons (EJECT, the
 * guarded SELF-DESTRUCT, CHUTE), the parachute's steering buttons, the
 * self-destruct countdown, and its words on the HUD's controls line.
 *
 * Everything is in the feature layer (extensions.js extLayer), off whenever
 * the game is paused, in a menu or has its interface hidden — the same gate
 * the walker's controls use (staff/ui.js), read four times a second.
 *
 * The buttons show on a touch screen; a keyboard gets the keys on the
 * controls line and in the H card — and, in Free Flight, the EJECT button as
 * well, smaller and with "Enter" on it (eject.js showEject), because the
 * controls line alone was a way out nobody found.
 */

import { extLayer } from '../../game/extensions.js';

const CSS = `
.ej-root { position: fixed; inset: 0; pointer-events: none; z-index: 31; font-family: var(--font, system-ui, sans-serif); }
.ej-root.ej-off { display: none; }
.ej-col { position: absolute; left: 18px; bottom: 186px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
.ej-btn { pointer-events: auto; display: none; min-width: 92px; height: 46px; padding: 0 12px; border-radius: 12px;
  font: 800 13px/1 var(--font, system-ui, sans-serif); letter-spacing: .06em; color: #fff; cursor: pointer;
  touch-action: manipulation; user-select: none; -webkit-user-select: none; border: 2px solid rgba(255,255,255,.35);
  box-shadow: 0 3px 10px rgba(0,0,0,.35); }
.ej-btn.is-on { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.ej-btn small { font-size: 9.5px; font-weight: 700; opacity: .85; letter-spacing: 0; }
.ej-eject { background: repeating-linear-gradient(135deg, #d8262c 0 10px, #b51d22 10px 20px); border-color: #ffd23f; }
.ej-eject.is-armed { animation: ej-pulse .5s ease-in-out infinite alternate; }
/* A laptop's: the same handle, smaller, with its key on it. */
.ej-desk .ej-eject { min-width: 0; height: 32px; padding: 0 9px 0 11px; border-radius: 9px; font-size: 12px; border-width: 1.5px; }
.ej-eject kbd { font: 700 10px/1 var(--font, system-ui, sans-serif); letter-spacing: 0; padding: 3px 5px; border-radius: 4px;
  background: rgba(0,0,0,.38); border: 0; color: #ffe9a8; }
.ej-sd { background: #3a3f48; border-color: #8a93a0; }
.ej-sd.is-open { background: #b51d22; border-color: #ffd23f; }
.ej-sd.is-count { background: #1f6f3b; border-color: #9ff0bf; }
.ej-chute { background: #d8661a; border-color: #ffd9b3; }
/* Thumbs: steer left under the left thumb, steer right and sink under the right. */
.ej-row { position: absolute; left: 16px; right: 16px; bottom: 22px; display: none; justify-content: space-between; align-items: flex-end; }
.ej-row.is-on { display: flex; }
.ej-row .ej-pair { display: flex; gap: 10px; }
.ej-row .ej-btn { display: inline-flex; align-items: center; justify-content: center; min-width: 76px; height: 56px;
  background: rgba(12,20,34,.72); border-color: rgba(160,200,255,.45); font-size: 15px; }
.ej-row .ej-btn.is-held { background: rgba(88,198,255,.35); }
.ej-count { position: absolute; left: 50%; top: 18%; transform: translateX(-50%); display: none; text-align: center;
  padding: 12px 22px 14px; border-radius: 16px; background: rgba(120,10,14,.86); color: #fff; border: 3px solid #ffd23f;
  box-shadow: 0 6px 26px rgba(0,0,0,.45); }
.ej-count.is-on { display: block; }
.ej-count b { display: block; font-size: 30px; font-weight: 900; letter-spacing: .08em; }
.ej-count span { display: block; margin-top: 5px; font-size: 13px; font-weight: 700; color: #ffe6b3; }
.ej-chutehud { position: absolute; left: 50%; bottom: 22px; transform: translateX(-50%); display: none; padding: 7px 14px;
  border-radius: 12px; background: rgba(12,20,34,.72); color: #eaf1fb; font: 700 13px/1.35 var(--font, system-ui, sans-serif);
  text-align: center; border: 1px solid rgba(140,180,230,.3); }
.ej-chutehud.is-on { display: block; }
.ej-chutehud b { font-size: 16px; font-variant-numeric: tabular-nums; }
.ej-chutehud kbd { font: 700 11px/1 var(--font, system-ui, sans-serif); padding: 1px 5px; border-radius: 4px;
  background: rgba(255,255,255,.14); border-bottom: 2px solid rgba(255,255,255,.25); }
.ej-keys { white-space: nowrap; }
@keyframes ej-pulse { from { transform: scale(1); } to { transform: scale(1.07); } }
@media (max-height: 520px) { .ej-col { bottom: 150px; left: 10px; gap: 6px; } .ej-btn { height: 40px; min-width: 80px; }
  .ej-row { bottom: 10px; } .ej-count { top: 10%; } .ej-chutehud { bottom: 8px; font-size: 12px; } }
`;

const UI = {
  root: null,
  buttons: {},
  row: null,
  held: { left: false, right: false, sink: false },
  count: null,
  hud: null,
  onPress: null,
  shown: {},
  key: '',
  keyEl: null,
};

export const held = UI.held;

function btn(cls, html, id, hold) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `ej-btn ${cls}`;
  b.innerHTML = html;
  b.dataset.id = id;
  // Never the keyboard's focus: Enter and Space belong to the aeroplane.
  b.tabIndex = -1;
  b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (hold) {
      UI.held[id] = true;
      b.classList.add('is-held');
    } else if (UI.onPress) UI.onPress(id, e.pointerType || '');
  });
  if (hold) {
    const up = () => {
      UI.held[id] = false;
      b.classList.remove('is-held');
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('pointerleave', up);
  }
  return b;
}

/** Build once. `onPress(id)` gets 'eject', 'sd' and 'chute'. Returns false with no page. */
export function build(onPress) {
  if (UI.root) return true;
  if (typeof document === 'undefined' || !document.body) return false;
  UI.onPress = onPress;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'ej-root';
  const col = document.createElement('div');
  col.className = 'ej-col';
  UI.buttons.eject = btn('ej-eject', 'EJECT', 'eject');
  UI.buttons.sd = btn('ej-sd', 'SELF-DESTRUCT <small>cover</small>', 'sd');
  UI.buttons.chute = btn('ej-chute', 'CHUTE', 'chute');
  col.append(UI.buttons.eject, UI.buttons.sd, UI.buttons.chute);
  root.appendChild(col);
  const row = document.createElement('div');
  row.className = 'ej-row';
  const pair = document.createElement('span');
  pair.className = 'ej-pair';
  pair.append(btn('', 'Sink', 'sink', true), btn('', 'Steer ▶', 'right', true));
  row.append(btn('', '◀ Steer', 'left', true), pair);
  UI.row = row;
  root.appendChild(row);
  const count = document.createElement('div');
  count.className = 'ej-count';
  count.innerHTML = '<b></b><span></span>';
  UI.count = count;
  root.appendChild(count);
  const hud = document.createElement('div');
  hud.className = 'ej-chutehud';
  UI.hud = hud;
  root.appendChild(hud);
  extLayer().appendChild(root);
  UI.root = root;
  return true;
}

/** Everything off (paused, a menu, the interface hidden). */
export function setGate(off) {
  if (UI.root) UI.root.classList.toggle('ej-off', !!off);
  if (off) for (const k in UI.held) UI.held[k] = false;
}

/**
 * Which flight buttons show: { eject, sd, chute } booleans, and the states
 * `armed` (EJECT pulsing: press again) and `sd` ('off' | 'open' | 'count').
 */
export function setButtons(want) {
  if (!UI.root) return;
  const b = UI.buttons;
  const key = `${!!want.eject}${!!want.armed}${!!want.sd}${want.sdState}${!!want.chute}${!!want.desk}`;
  if (key === UI.key) return;
  UI.key = key;
  // A laptop's EJECT is smaller, and names its key: the button teaches Enter.
  UI.root.classList.toggle('ej-desk', !!want.desk);
  b.eject.classList.toggle('is-on', !!want.eject);
  b.eject.classList.toggle('is-armed', !!want.armed);
  b.eject.innerHTML = want.armed ? 'EJECT <small>again!</small>' : want.desk ? 'EJECT <kbd>Enter</kbd>' : 'EJECT';
  b.eject.title = want.desk ? 'Eject — click twice, or press Enter twice' : '';
  b.sd.classList.toggle('is-on', !!want.sd);
  b.sd.classList.toggle('is-open', want.sdState === 'open');
  b.sd.classList.toggle('is-count', want.sdState === 'count');
  b.sd.innerHTML = want.sdState === 'count' ? 'CANCEL' : want.sdState === 'open' ? 'SELF-DESTRUCT <small>arm</small>' : 'SELF-DESTRUCT <small>cover</small>';
  b.chute.classList.toggle('is-on', !!want.chute);
}

/** The parachute's steering row. */
export function setSteer(on) {
  if (!UI.row) return;
  UI.row.classList.toggle('is-on', !!on);
  if (!on) for (const k in UI.held) UI.held[k] = false;
}

/** The self-destruct countdown, or null to hide it. */
export function setCountdown(n, sub = '') {
  if (!UI.count) return;
  const on = n != null;
  UI.count.classList.toggle('is-on', on);
  if (!on) return;
  const title = `SELF-DESTRUCT IN ${n}`;
  const b = UI.count.firstChild;
  if (b.textContent !== title) b.textContent = title;
  const s = UI.count.lastChild;
  if (s.innerHTML !== sub) s.innerHTML = sub;
}

/** The parachute's own little readout: height and what to press. */
export function setChuteHud(html) {
  if (!UI.hud) return;
  const on = !!html;
  UI.hud.classList.toggle('is-on', on);
  if (on && UI.shown.hud !== html) {
    UI.shown.hud = html;
    UI.hud.innerHTML = html;
  }
}

/**
 * Our words on the HUD's controls line ("Power: Shift/↑ up · … · Space
 * brakes"). Added as one span after what is there, replaced as the aeroplane
 * changes; the line itself is the HUD's.
 */
export function setKeyLine(hud, html) {
  // Once a frame: nothing to do unless the words changed or the line went.
  if (UI.keyEl && UI.keyEl.isConnected && UI.keyHtml === html) return;
  const wrap = hud && hud.wrap;
  if (!wrap || !wrap.querySelector) return;
  const line = wrap.querySelector('.hud-keyhint');
  if (!line) return;
  if (!UI.keyEl || UI.keyEl.parentNode !== line) {
    UI.keyEl = document.createElement('span');
    UI.keyEl.className = 'ej-keys';
    line.appendChild(UI.keyEl);
  }
  UI.keyHtml = html;
  UI.keyEl.innerHTML = html;
}

export function keyLineText() {
  return UI.keyEl ? UI.keyEl.textContent : '';
}

/** For the tests: what is showing. */
export function snapshot() {
  const on = (el) => !!(el && el.classList.contains('is-on'));
  return {
    built: !!UI.root,
    off: !!(UI.root && UI.root.classList.contains('ej-off')),
    eject: on(UI.buttons.eject),
    ejectText: UI.buttons.eject ? UI.buttons.eject.textContent : '',
    desk: !!(UI.root && UI.root.classList.contains('ej-desk')),
    armed:!!(UI.buttons.eject && UI.buttons.eject.classList.contains('is-armed')),
    sd: on(UI.buttons.sd),
    sdText: UI.buttons.sd ? UI.buttons.sd.textContent : '',
    chute: on(UI.buttons.chute),
    steer: on(UI.row),
    count: on(UI.count) ? UI.count.textContent : '',
    chuteHud: on(UI.hud) ? UI.hud.textContent : '',
    keyLine: keyLineText(),
  };
}

/** For the tests: press a button the way a finger (or, with 'mouse', a click) does. */
export function press(id, pointerType = 'touch') {
  const b = UI.buttons[id];
  if (b) b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType }));
}

/**
 * The carrier feature's on-screen parts.
 *
 *   HOOK         a lamp in the HUD's own chip row, beside GEAR and FLAPS:
 *                HOOK UP (dim), HOOK (amber, travelling), HOOK DOWN (green),
 *                flashing amber in the groove with the hook still up. A click
 *                works it too.
 *   THE BALL     a repeater of the lens for the groove — the ball, the green
 *                datums, the red wave-off lights, a lineup arrow and the
 *                height over the deck — so the meatball can be flown from
 *                the chase view, where the real lens is a speck.
 *   THE BOARD    after each pass: the grade, the wire, Paddles' reason, the
 *                stop, and the session's greenie board.
 *   TOUCH        HOOK and LAUNCH buttons over the throttle on a touch screen.
 *   START        "Start at: Carrier / Airbase" in the Free Flight screen's
 *                bottom bar, only when the chosen aeroplane is military.
 *
 * Everything is in the feature layer, off when the game is paused or its
 * interface hidden.
 */

import { extLayer } from '../../game/extensions.js';

const CSS = `
.co-root { position: fixed; inset: 0; pointer-events: none; z-index: 31; font-family: var(--font, system-ui, sans-serif); }
.co-root.co-off { display: none; }
.co-ball { position: absolute; right: 16px; top: 34%; width: 150px; padding: 8px 10px 9px; border-radius: 14px;
  background: rgba(10,16,26,.74); border: 1px solid rgba(150,190,235,.28); color: #e9f1fb; display: none;
  box-shadow: 0 4px 18px rgba(0,0,0,.35); }
.co-ball.is-on { display: block; }
.co-head { display: flex; justify-content: space-between; font: 800 10px/1 var(--font, system-ui); letter-spacing: .12em; color: #9fb4cc; }
.co-head b { color: #e9f1fb; }
.co-lens { position: relative; height: 92px; margin: 8px 0 6px; }
.co-cells { position: absolute; left: 50%; top: 0; bottom: 0; width: 26px; margin-left: -13px; border-radius: 5px;
  background: repeating-linear-gradient(180deg, #1a2029 0 17px, #262e39 17px 18.4px); border: 1px solid #3b4654; }
.co-cells::after { content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 18px; background: rgba(120,20,20,.35); border-radius: 0 0 5px 5px; }
.co-meat { position: absolute; left: 3px; right: 3px; height: 13px; margin-top: -6.5px; border-radius: 7px; background: #ffa21a;
  box-shadow: 0 0 10px 2px rgba(255,162,26,.8); transition: top .12s linear; top: 50%; }
.co-meat.is-red { background: #ff3030; box-shadow: 0 0 10px 2px rgba(255,48,48,.8); }
.co-meat.is-gone { display: none; }
.co-datum { position: absolute; top: 50%; height: 6px; margin-top: -3px; width: 44px; border-radius: 3px;
  background: repeating-linear-gradient(90deg, #36ff6c 0 6px, transparent 6px 9px); filter: drop-shadow(0 0 3px rgba(54,255,108,.7)); }
.co-datum.l { right: calc(50% + 17px); } .co-datum.r { left: calc(50% + 17px); }
.co-wo { position: absolute; top: 8px; bottom: 8px; width: 6px; border-radius: 3px; background: repeating-linear-gradient(180deg, #4a0b0b 0 10px, transparent 10px 20px); }
.co-wo.l { right: calc(50% + 20px); top: 0; bottom: 56%; } .co-wo.r { left: calc(50% + 20px); top: 0; bottom: 56%; }
.co-ball.is-waveoff .co-wo { animation: co-flash .3s steps(1) infinite; }
.co-cut { position: absolute; left: 50%; top: -6px; width: 26px; margin-left: -13px; height: 4px; border-radius: 2px; background: #0f3a19; }
.co-ball.is-cut .co-cut { animation: co-cut .3s steps(1) infinite; }
/* Reduce flashing (render/flash-safety.js): 3.3 flashes a second is over the line; 1.25 is not. */
html.reduce-flashing .co-ball.is-waveoff .co-wo, html.reduce-flashing .co-ball.is-cut .co-cut { animation-duration: .8s; }
.co-line { text-align: center; font: 800 12px/1.2 var(--font, system-ui); letter-spacing: .04em; min-height: 15px; }
.co-line.is-ok { color: #6fe39a; } .co-line.is-off { color: #ffc247; }
.co-read { margin-top: 3px; text-align: center; font: 600 10.5px/1.3 var(--font, system-ui); color: #b9c9db; font-variant-numeric: tabular-nums; }
.co-call { margin-top: 5px; text-align: center; font: 800 12px/1.25 var(--font, system-ui); color: #fff; min-height: 15px; }
.co-ball.is-waveoff .co-call { color: #ff6b6b; }
.co-board { position: absolute; right: 16px; top: 34%; width: 220px; padding: 10px 12px 11px; border-radius: 14px;
  background: rgba(10,16,26,.8); border: 1px solid rgba(150,190,235,.3); color: #e9f1fb; display: none; box-shadow: 0 4px 18px rgba(0,0,0,.35); }
.co-board.is-on { display: block; }
.co-grade { font: 900 26px/1 var(--font, system-ui); letter-spacing: .02em; }
.co-grade u { text-decoration-thickness: 3px; text-underline-offset: 4px; }
.co-grade small { font-size: 14px; font-weight: 800; color: #b9c9db; margin-left: 6px; }
.co-why { margin-top: 6px; font: 600 12px/1.35 var(--font, system-ui); color: #dbe6f2; }
.co-stop { margin-top: 5px; font: 600 11px/1.3 var(--font, system-ui); color: #9fb4cc; font-variant-numeric: tabular-nums; }
.co-greenie { display: flex; gap: 3px; margin-top: 8px; }
.co-greenie i { width: 16px; height: 16px; border-radius: 3px; font: 800 8px/16px var(--font, system-ui); text-align: center; color: #10161f; font-style: normal; }
.co-g-OKs, .co-g-OK { background: #3fcf6e; } .co-g-OKs { box-shadow: inset 0 -3px 0 #1d7a3c; }
.co-g-F { background: #f2cf3c; } .co-g-NG { background: #8a5a2b; color: #fff !important; } .co-g-B { background: #5aa9ff; } .co-g-WO { background: #d84b4b; color: #fff !important; }
.co-btns { position: absolute; right: 20px; bottom: 210px; display: flex; flex-direction: column; gap: 8px; align-items: flex-end; }
.co-btn { pointer-events: auto; display: none; min-width: 78px; height: 44px; padding: 0 12px; border-radius: 12px; color: #fff;
  font: 800 13px/1 var(--font, system-ui); letter-spacing: .06em; border: 2px solid rgba(255,255,255,.35); background: rgba(12,20,34,.78);
  box-shadow: 0 3px 10px rgba(0,0,0,.35); touch-action: manipulation; user-select: none; -webkit-user-select: none; cursor: pointer; }
.co-btn.is-on { display: inline-flex; align-items: center; justify-content: center; }
.co-btn.is-down { background: rgba(63,207,110,.4); border-color: #8cf0b0; }
.co-btn.co-launch { background: #1f6f3b; border-color: #9ff0bf; }
.co-btn.co-launch.is-hot { animation: co-pulse .5s ease-in-out infinite alternate; }
.hud-chip.co-hook { cursor: pointer; pointer-events: auto; }
.hud-chip.co-hook.is-dim { opacity: .55; }
.hud-chip.co-hook.is-blink { animation: co-blink .5s steps(1) infinite; }
.co-start { display: none; align-items: center; gap: 6px; margin-right: 10px; font: 700 12px/1 var(--font, system-ui); color: #c9d6e6; }
.co-start.is-on { display: inline-flex; }
.co-start button { height: 34px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(160,190,230,.35); background: rgba(255,255,255,.06);
  color: #dfe9f5; font: 700 12.5px/1 var(--font, system-ui); cursor: pointer; }
.co-start button.is-on { background: rgba(88,198,255,.28); border-color: rgba(124,199,255,.8); color: #fff; }
@keyframes co-flash { 0% { background: repeating-linear-gradient(180deg, #ff2a2a 0 10px, transparent 10px 20px); } 50% { background: repeating-linear-gradient(180deg, #4a0b0b 0 10px, transparent 10px 20px); } }
@keyframes co-cut { 0% { background: #3dff6e; } 50% { background: #0f3a19; } }
@keyframes co-blink { 0% { color: #ffc247; border-color: rgba(255,194,71,.7); } 50% { color: #7c6a40; } }
@keyframes co-pulse { from { transform: scale(1); } to { transform: scale(1.07); } }
@media (max-height: 560px) { .co-ball, .co-board { top: 22%; } .co-btns { bottom: 150px; } }
@media (max-width: 640px) { .co-ball { width: 128px; right: 8px; } .co-board { width: 190px; right: 8px; } }
`;

const UI = {
  root: null,
  ball: null,
  board: null,
  chip: null,
  btns: null,
  hookBtn: null,
  launchBtn: null,
  start: null,
  onPress: null,
  boardUntil: 0,
  last: {},
};

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
};

/** Build once. `onPress(id)` gets 'hook' and 'launch'. */
export function build(onPress) {
  if (UI.root) return true;
  if (typeof document === 'undefined' || !document.body) return false;
  UI.onPress = onPress;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = el('div', 'co-root');
  root.dataset.carrierUi = '';

  const ball = el('div', 'co-ball');
  ball.innerHTML = `
    <div class="co-head"><span>BALL</span><b data-co-range></b></div>
    <div class="co-lens"><i class="co-cut"></i><i class="co-wo l"></i><i class="co-wo r"></i>
      <span class="co-datum l"></span><span class="co-datum r"></span>
      <div class="co-cells"><b class="co-meat" data-co-meat></b></div></div>
    <div class="co-line" data-co-line></div>
    <div class="co-read" data-co-read></div>
    <div class="co-call" data-co-call></div>`;
  UI.ball = ball;
  root.appendChild(ball);

  const board = el('div', 'co-board');
  board.innerHTML = '<div class="co-grade" data-co-grade></div><div class="co-why" data-co-why></div><div class="co-stop" data-co-stop></div><div class="co-greenie" data-co-greenie></div>';
  UI.board = board;
  root.appendChild(board);

  const btns = el('div', 'co-btns');
  const mk = (cls, label, id) => {
    const b = el('button', `co-btn ${cls}`, label);
    b.type = 'button';
    b.dataset.coBtn = id;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (UI.onPress) UI.onPress(id);
    });
    return b;
  };
  UI.launchBtn = mk('co-launch', 'LAUNCH', 'launch');
  UI.hookBtn = mk('co-hookbtn', 'HOOK', 'hook');
  btns.append(UI.launchBtn, UI.hookBtn);
  UI.btns = btns;
  root.appendChild(btns);

  extLayer().appendChild(root);
  UI.root = root;
  return true;
}

export function setGate(off) {
  if (UI.root) UI.root.classList.toggle('co-off', !!off);
}

/* ---- The HOOK lamp, in the HUD's chip row ---- */

export function hookChip(hud, state) {
  if (!hud || !hud.root) return;
  if (!UI.chip || !UI.chip.isConnected) {
    const row = hud.root.querySelector('.hud-chips');
    if (!row) return;
    const chip = el('div', 'hud-chip co-hook', 'HOOK UP');
    chip.dataset.coHook = '';
    chip.title = 'Tail hook — click, or use the hook key';
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      if (UI.onPress) UI.onPress('hook');
    });
    row.appendChild(chip);
    UI.chip = chip;
  }
  const c = UI.chip;
  const want = state ? `${state.text}|${state.cls}|${state.blink ? 1 : 0}` : 'off';
  if (UI.last.chip === want) return;
  UI.last.chip = want;
  if (!state) {
    c.style.display = 'none';
    return;
  }
  c.style.display = '';
  c.textContent = state.text;
  c.classList.toggle('is-good', state.cls === 'good');
  c.classList.toggle('is-warn', state.cls === 'warn');
  c.classList.toggle('is-dim', state.cls === 'dim');
  c.classList.toggle('is-blink', !!state.blink);
}

/* ---- The ball ---- */

export function showBall(b) {
  if (!UI.ball) return;
  if (!b) {
    if (UI.last.ball !== 'off') {
      UI.ball.classList.remove('is-on');
      UI.last.ball = 'off';
    }
    return;
  }
  UI.last.ball = 'on';
  UI.ball.classList.add('is-on');
  UI.ball.classList.toggle('is-waveoff', !!b.waveoff);
  UI.ball.classList.toggle('is-cut', !!b.cut);
  const meat = UI.ball.querySelector('[data-co-meat]');
  // 5 cells of 18.4 px in a 92 px column; +cells is up.
  const y = 46 - Math.max(-2.5, Math.min(2.5, b.cells)) * 18.4;
  meat.style.top = `${y.toFixed(1)}px`;
  meat.classList.toggle('is-red', !!b.red);
  meat.classList.toggle('is-gone', b.off === 'high');
  const line = UI.ball.querySelector('[data-co-line]');
  const lat = b.lat || 0;
  let txt;
  let cls;
  if (Math.abs(lat) < 6) {
    txt = 'LINED UP';
    cls = 'is-ok';
  } else if (lat < 0) {
    txt = `▶ RIGHT ${Math.round(-lat)} m`;
    cls = 'is-off';
  } else {
    txt = `LEFT ${Math.round(lat)} m ◀`;
    cls = 'is-off';
  }
  if (line.textContent !== txt) line.textContent = txt;
  line.className = `co-line ${cls}`;
  const rng = UI.ball.querySelector('[data-co-range]');
  const r = b.range > 1000 ? `${(b.range / 1000).toFixed(1)} km` : `${Math.max(0, Math.round(b.range))} m`;
  if (rng.textContent !== r) rng.textContent = r;
  const read = UI.ball.querySelector('[data-co-read]');
  const rd = `DECK +${Math.max(0, Math.round(b.hFt))} ft · ${Math.round(b.kts)} kt`;
  if (read.textContent !== rd) read.textContent = rd;
  const call = UI.ball.querySelector('[data-co-call]');
  const ct = b.call || '';
  if (call.textContent !== ct) call.textContent = ct;
}

/* ---- The board ---- */

export function showBoard(result, passes, now, seconds = 9) {
  if (!UI.board) return;
  const keyCls = (k) => `co-g-${String(k).replace('*', 's').replace(/[^A-Za-z]/g, '')}`;
  const gradeHtml = result.key === 'OK*'
    ? '<u>OK</u>'
    : result.grade;
  UI.board.querySelector('[data-co-grade]').innerHTML = `${gradeHtml}${result.wire ? `<small>${result.wire}-wire</small>` : ''}`;
  UI.board.querySelector('[data-co-why]').textContent = result.comment || '';
  UI.board.querySelector('[data-co-stop]').textContent = result.stop || '';
  UI.board.querySelector('[data-co-greenie]').innerHTML = (passes || []).slice(-10)
    .map((p) => `<i class="${keyCls(p.key)}" title="${p.grade}">${p.wire || p.key.replace('*', '')}</i>`).join('');
  UI.board.classList.add('is-on');
  UI.boardUntil = now + seconds;
}

export function tickBoard(now, hide) {
  if (!UI.board) return;
  // Only when it is on: removing a class that is not there still rewrites the
  // attribute, and a rewrite every frame made the page restyle every frame.
  if ((hide || now > UI.boardUntil) && UI.board.classList.contains('is-on')) UI.board.classList.remove('is-on');
}

export function boardShown() {
  return !!(UI.board && UI.board.classList.contains('is-on'));
}

/* ---- Touch buttons ---- */

export function buttons({ hook = false, hookDown = false, launch = false, hot = false }) {
  if (!UI.btns) return;
  const want = `${hook}|${hookDown}|${launch}|${hot}`;
  if (UI.last.btns === want) return;
  UI.last.btns = want;
  UI.hookBtn.classList.toggle('is-on', !!hook);
  UI.hookBtn.classList.toggle('is-down', !!hookDown);
  UI.hookBtn.textContent = hookDown ? 'HOOK ▼' : 'HOOK';
  UI.launchBtn.classList.toggle('is-on', !!launch);
  UI.launchBtn.classList.toggle('is-hot', !!hot);
}

/* ---- Free Flight: Start at Carrier / Airbase ---- */

/**
 * Put the choice in the Free Flight screen's bottom bar, beside Take off.
 * `get()` and `set(v)` read and write the saved choice; `visible()` says
 * whether the chosen aeroplane is a military one. Returns the element, or
 * null when the screen is not there.
 */
export function startChoice(menusRoot, { get, set, visible }) {
  if (!menusRoot) return null;
  const fly = menusRoot.querySelector('[data-fly]');
  if (!fly || !fly.parentElement) return null;
  if (!UI.start || !UI.start.isConnected) {
    const box = el('div', 'co-start');
    box.dataset.coStart = '';
    box.innerHTML = '<span>Start at</span><button type="button" data-co-start="carrier">⚓ Carrier</button><button type="button" data-co-start="airbase">Airbase</button>';
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-co-start]');
      if (!b) return;
      e.stopPropagation();
      set(b.dataset.coStart);
      paint();
    });
    fly.parentElement.insertBefore(box, fly);
    UI.start = box;
  }
  const paint = () => {
    const v = get();
    UI.start.classList.toggle('is-on', !!visible());
    UI.start.querySelectorAll('[data-co-start]').forEach((b) => b.classList.toggle('is-on', b.dataset.coStart === v));
  };
  paint();
  UI.start.paint = paint;
  return UI.start;
}

export function paintStart() {
  if (UI.start && UI.start.paint) UI.start.paint();
}

export { UI };

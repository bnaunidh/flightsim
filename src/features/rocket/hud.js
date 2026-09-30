/**
 * The rocket's instruments, in the game's own glass panels.
 *
 * What a child needs, in the order they look for it:
 *   1. What do I do now?    the objective card, top middle — one line that
 *                           changes the moment the answer does (flights.js).
 *   2. Am I doing it?       the tilt dial, bottom middle: a little rocket
 *                           leaning exactly as the real one leans on the
 *                           screen, and a green wedge where it should be.
 *   3. How far to space?    the ladder on the right: the ground, where the
 *                           airliners fly, where the sky goes dark, SPACE.
 *   4. Numbers              height, speed and fuel, top left, for the child
 *                           who wants them. Nothing depends on reading them.
 * Landing swaps the dial for the landing card: which way the pad is and how
 * far, how fast it is coming down (green, amber, red), which way it is
 * SLIDING and how fast (so stopping a slide is something you can see), and
 * HOLD SPACE.
 *
 * Lives in the plug-in layer's overlay (extLayer), above the canvas; hidden
 * whenever the game is not flying, because that layer is drawn above the
 * menus too. Text is written about eight times a second and only when it
 * changed — touching the DOM sixty times a second for a number that moved
 * by one is how a Chromebook drops frames it did not need to.
 */

import { extLayer } from '../../game/extensions.js';

const CSS = `
.rk-hud { position: absolute; inset: 0; pointer-events: none; color: var(--text, #eaf1fb);
  font: 14px/1.3 var(--font, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif); font-variant-numeric: tabular-nums; }
.rk-hud[hidden] { display: none; }
.rk-glass { background: rgba(12, 20, 34, 0.78); backdrop-filter: blur(14px) saturate(1.2); -webkit-backdrop-filter: blur(14px) saturate(1.2);
  border: 1px solid rgba(140, 180, 230, 0.18); border-radius: 16px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.45); }
.rk-obj { position: absolute; top: 14px; left: 50%; transform: translateX(-50%); width: min(560px, calc(100vw - 32px));
  padding: 10px 16px; text-align: center; }
.rk-obj-title { font-size: 11px; letter-spacing: 0.1em; text-transform: uppercase; color: #b28dff; margin-bottom: 3px; font-weight: 650; }
.rk-obj.is-go .rk-obj-title { color: #7ee8b2; }
.rk-obj.is-warn { border-color: rgba(255, 194, 71, 0.6); }
.rk-obj.is-warn .rk-obj-title { color: #ffc247; }
.rk-obj.is-good .rk-obj-title { color: #4fd684; }
.rk-obj-text { font-size: 16px; line-height: 1.35; }
.rk-obj-text.is-flash { animation: rkFlash 0.5s ease; }
@keyframes rkFlash { from { opacity: 0.2; transform: translateY(-3px); } }
.rk-panel { position: absolute; left: 16px; top: 16px; width: 188px; padding: 9px 12px; }
.rk-row { display: grid; grid-template-columns: 62px 1fr; align-items: baseline; padding: 3px 0; }
.rk-row + .rk-row { border-top: 1px solid rgba(140, 180, 230, 0.1); }
.rk-lbl { font-size: 10px; letter-spacing: 0.07em; text-transform: uppercase; color: var(--text-dim, #9fb2cc); }
.rk-val { font-size: 22px; font-weight: 640; letter-spacing: -0.02em; }
.rk-val small { font-size: 11px; font-weight: 500; color: var(--text-dim, #9fb2cc); margin-left: 3px; letter-spacing: 0; }
.rk-val.is-warn { color: #ffc247; } .rk-val.is-bad { color: #ff6a5a; } .rk-val.is-good { color: #4fd684; }
.rk-fuel { grid-column: 1 / -1; display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
.rk-tank { display: grid; grid-template-columns: 62px 1fr 34px; align-items: center; gap: 6px; font-size: 11px; color: var(--text-dim, #9fb2cc); }
.rk-tank b { display: block; height: 8px; border-radius: 99px; background: rgba(178, 141, 255, 0.16); overflow: hidden; }
.rk-tank b i { display: block; height: 100%; width: 100%; border-radius: 99px; background: linear-gradient(90deg, #8f6bff, #b28dff); transform-origin: left; }
.rk-tank.is-reserve b i { background: linear-gradient(90deg, #d49b2b, #ffc247); }
.rk-tank.is-gone { opacity: 0.35; }
.rk-orbit { grid-column: 1 / -1; margin-top: 4px; font-size: 11px; color: var(--text-dim, #9fb2cc); }
.rk-orbit b { display: block; height: 9px; margin-top: 3px; border-radius: 99px; background: rgba(79, 214, 132, 0.15); overflow: hidden; }
.rk-orbit b i { display: block; height: 100%; width: 0; border-radius: 99px; background: linear-gradient(90deg, #2fae68, #4fd684); }
.rk-ladder { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); width: 132px; height: min(330px, 52vh); padding: 10px 10px 10px 12px; }
.rk-lad-track { position: absolute; left: 22px; top: 12px; bottom: 12px; width: 6px; border-radius: 99px;
  background: linear-gradient(0deg, #58c6ff 0%, #3d6fd0 35%, #1b1f4a 70%, #07081a 100%); }
.rk-tick { position: absolute; left: 16px; right: 6px; height: 0; border-top: 1px dashed rgba(234, 241, 251, 0.25); font-size: 10.5px; }
.rk-tick span { position: absolute; left: 20px; top: -15px; white-space: nowrap; color: var(--text-dim, #9fb2cc); }
.rk-tick.is-space { border-top: 2px solid #b28dff; }
.rk-tick.is-space span { color: #d9c7ff; font-weight: 700; letter-spacing: 0.06em; }
.rk-me { position: absolute; left: 13px; width: 24px; height: 24px; margin-top: -12px; transition: top 0.1s linear; }
.rk-me svg { width: 24px; height: 24px; filter: drop-shadow(0 0 6px rgba(178, 141, 255, 0.8)); }
.rk-top-mark { position: absolute; left: 30px; width: 10px; height: 0; border-top: 2px solid #7ee8b2; }
.rk-dial { position: absolute; left: 50%; bottom: 18px; transform: translateX(-50%); width: 210px; padding: 8px 10px 6px; text-align: center; }
.rk-dial svg { display: block; width: 190px; height: 112px; margin: 0 auto; }
.rk-dial-word { font-size: 12.5px; font-weight: 600; margin-top: 1px; }
.rk-dial-word.is-ok { color: #4fd684; } .rk-dial-word.is-go { color: #ffc247; }
/* Up at the top left under the numbers, not in the middle and not at the
   bottom: while landing, the camera looks down past the booster at the pad,
   so the booster is at the top of the middle and the pad below it — the two
   things being steered — and the card keeps out of the way of both. */
.rk-land { position: absolute; left: 16px; top: 176px; width: 320px; padding: 9px 14px;
  display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(0, 1fr); gap: 6px 14px; }
.rk-hud.is-landing .rk-toast { top: 264px; }
.rk-land .rk-big { font-size: 24px; font-weight: 700; letter-spacing: -0.02em; white-space: nowrap; }
.rk-land .rk-slide { grid-column: 1 / -1; display: flex; align-items: baseline; justify-content: center; gap: 8px; font-size: 14px; font-weight: 700;
  padding: 4px 6px; border-radius: 10px; background: rgba(255,255,255,0.04); }
.rk-land .rk-slide .rk-cap { flex: none; }
.rk-land .is-good { color: #4fd684; } .rk-land .is-warn { color: #ffc247; } .rk-land .is-bad { color: #ff6a5a; }
.rk-land .rk-cap { font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-dim, #9fb2cc); }
.rk-land .rk-burn { grid-column: 1 / -1; text-align: center; font-weight: 700; font-size: 14px; padding: 5px; border-radius: 10px; background: rgba(255,255,255,0.06); }
.rk-land .rk-burn.is-on { background: rgba(255, 150, 60, 0.28); color: #ffd08a; }
.rk-land .rk-burn.is-need { background: rgba(255, 106, 90, 0.3); color: #fff; animation: rkPulse 0.6s ease infinite alternate; }
@keyframes rkPulse { to { background: rgba(255, 106, 90, 0.55); } }
.rk-btns { position: absolute; right: 16px; top: 16px; display: flex; gap: 8px; pointer-events: auto; }
.rk-btn { pointer-events: auto; appearance: none; border: 1px solid rgba(140, 180, 230, 0.25); background: rgba(12, 20, 34, 0.78); color: var(--text, #eaf1fb);
  border-radius: 12px; min-width: 44px; height: 44px; padding: 0 12px; font: 600 13px/1 var(--font, sans-serif); cursor: pointer;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); display: inline-flex; align-items: center; gap: 6px; }
.rk-btn:hover { border-color: rgba(178, 141, 255, 0.7); }
.rk-btn svg { width: 18px; height: 18px; }
.rk-count { position: absolute; left: 50%; top: 40%; transform: translate(-50%, -50%); font-size: 120px; font-weight: 800; color: #fff;
  text-shadow: 0 6px 30px rgba(0,0,0,0.55), 0 0 40px rgba(178,141,255,0.6); letter-spacing: -0.04em; }
.rk-count.is-go { font-size: 76px; color: #ffd08a; }
.rk-count.is-pop { animation: rkPop 0.9s ease-out; }
@keyframes rkPop { from { transform: translate(-50%, -50%) scale(1.5); opacity: 0.2; } 30% { opacity: 1; } }
.rk-toast { position: absolute; left: 50%; top: 104px; transform: translateX(-50%); padding: 8px 18px; border-radius: 99px;
  background: rgba(178, 141, 255, 0.92); color: #140a2e; font-weight: 750; font-size: 16px; letter-spacing: 0.01em; white-space: nowrap;
  box-shadow: 0 10px 30px rgba(0,0,0,0.35); }
.rk-toast.is-good { background: rgba(79, 214, 132, 0.95); }
.rk-toast.is-warn { background: rgba(255, 194, 71, 0.95); }
.rk-toast.is-in { animation: rkToast 0.35s ease-out; }
@keyframes rkToast { from { transform: translate(-50%, -8px); opacity: 0; } }
.rk-action { position: absolute; right: 20px; bottom: 22px; pointer-events: auto; min-width: 150px; height: 64px; padding: 0 20px; border-radius: 18px;
  border: 2px solid rgba(255,255,255,0.25); background: linear-gradient(180deg, #9d7bff, #7a55f0); color: #fff; font: 800 18px/1 var(--font, sans-serif);
  letter-spacing: 0.04em; box-shadow: 0 12px 30px rgba(0,0,0,0.4); cursor: pointer; touch-action: none; user-select: none; -webkit-user-select: none; }
.rk-action small { display: block; font-size: 10.5px; font-weight: 600; opacity: 0.8; margin-top: 4px; letter-spacing: 0.08em; }
.rk-action.is-warn { background: linear-gradient(180deg, #ffcf5a, #f0a824); color: #2b1a00; animation: rkPulse2 0.7s ease infinite alternate; }
.rk-action.is-burn { background: linear-gradient(180deg, #ff9a52, #e2622b); }
.rk-action.is-held { filter: brightness(1.25); transform: scale(0.97); }
@keyframes rkPulse2 { to { box-shadow: 0 0 0 8px rgba(255, 194, 71, 0.25), 0 12px 30px rgba(0,0,0,0.4); } }
.rk-lean { position: absolute; left: 18px; bottom: 22px; display: flex; gap: 12px; pointer-events: auto; }
.rk-lean button { width: 78px; height: 78px; border-radius: 20px; border: 2px solid rgba(255,255,255,0.22); background: rgba(12, 20, 34, 0.7);
  color: #fff; font: 800 30px/1 var(--font, sans-serif); touch-action: none; user-select: none; -webkit-user-select: none; cursor: pointer;
  backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
.rk-lean button.is-held { background: rgba(178, 141, 255, 0.55); }
.rk-keys { position: absolute; left: 50%; bottom: 156px; transform: translateX(-50%); font-size: 12px; color: rgba(234,241,251,0.85);
  white-space: nowrap; padding: 5px 10px; border-radius: 99px; background: rgba(8, 13, 22, 0.55); }
.rk-keys kbd { font: 600 11px/1 var(--mono, monospace); padding: 2px 5px; border-radius: 5px; background: rgba(255,255,255,0.16); color: #fff; }
.rk-target { position: absolute; left: 0; top: 0; z-index: 2; pointer-events: none; transform: translate(-50%, -100%); text-align: center; white-space: nowrap; }
.rk-target b { display: inline-block; padding: 3px 8px; border-radius: 8px; background: #ffc247; color: #2b1a00; font-size: 12px; font-weight: 800; letter-spacing: 0.05em; }
.rk-target i { display: block; width: 0; height: 0; margin: 0 auto; border-left: 8px solid transparent; border-right: 8px solid transparent; border-top: 10px solid #ffc247; }
.rk-target.is-edge b { background: #ff9a52; }
.rk-hud.is-touch .rk-dial { bottom: 112px; }
.rk-hud.is-touch .rk-keys { display: none; }
.rk-hud.is-large { font-size: 16px; }
.rk-hud.is-large .rk-obj-text { font-size: 18px; }
/*
 * Narrow screens — an iPad held upright, a phone on its side. Across the
 * top there is room for the goal OR the instruments and the buttons, not
 * all three side by side, so the goal gets the whole width at the top (it
 * is the one thing that must always be read) and the rest steps down under
 * it. The dial drops into the gap between the thumb pads.
 */
@media (max-width: 900px) {
  .rk-obj { top: 8px; width: calc(100vw - 16px); padding: 7px 12px; }
  .rk-obj-text { font-size: 14.5px; }
  .rk-panel { top: 96px; width: 158px; padding: 6px 9px; }
  .rk-val { font-size: 18px; }
  .rk-btns { top: 96px; }
  .rk-toast { top: 150px; font-size: 14px; }
  /* Landing on an upright iPad: the card takes the numbers' place, as on a
     phone on its side — it has the only numbers that matter now. */
  .rk-hud.is-landing .rk-panel { display: none; }
  .rk-land { top: 96px; left: 8px; width: min(320px, calc(100vw - 16px)); }
  .rk-hud.is-landing .rk-toast { top: 300px; }
  .rk-ladder { width: 108px; height: min(260px, 38vh); top: 58%; right: 10px; }
  .rk-tick span { font-size: 9.5px; }
  .rk-keys { display: none; }
  .rk-lean button { width: 66px; height: 66px; }
  .rk-action { min-width: 124px; height: 60px; font-size: 16px; }
}
@media (max-height: 520px) {
  .rk-obj { width: min(620px, calc(100vw - 16px)); }
  .rk-obj-text { font-size: 13.5px; }
  .rk-panel, .rk-btns { top: 78px; }
  .rk-toast { top: 128px; }
  /* Landing on a phone on its side: the landing card takes the numbers'
     place — it has the only two numbers that matter now. */
  .rk-hud.is-landing .rk-panel { display: none; }
  .rk-land { top: 78px; left: 16px; transform: none; width: 290px; }
  .rk-hud.is-landing .rk-toast { top: 128px; }
  .rk-ladder { height: 40vh; top: 56%; }
  .rk-dial svg { height: 76px; width: 140px; }
  .rk-dial { width: 160px; padding: 5px 8px 4px; }
  .rk-hud.is-touch .rk-dial { bottom: 10px; }
  .rk-dial-word { font-size: 11.5px; }
}
`;

const ICONS = {
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="5" width="3.4" height="14" rx="1.2"/><rect x="13.6" y="5" width="3.4" height="14" rx="1.2"/></svg>',
  cam: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M3 8.5a2 2 0 0 1 2-2h2.2l1.3-2h6.9l1.3 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/><circle cx="12" cy="12.5" r="3.4"/></svg>',
  fast: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 6.5 12 12 4 17.5Z"/><path d="M12 6.5 20 12 12 17.5Z"/></svg>',
  rocket: '<svg viewBox="0 0 24 24"><path d="M12 2.5c2.6 2.2 3.6 5.2 3.6 8.4v6.1H8.4v-6.1c0-3.2 1-6.2 3.6-8.4Z" fill="#fff"/><path d="M8.4 13.4 5.5 17v2.3l2.9-1.4ZM15.6 13.4l2.9 3.6v2.3l-2.9-1.4Z" fill="#b28dff"/><circle cx="12" cy="9.2" r="1.6" fill="#58c6ff"/><path d="M10.2 17.8h3.6L12 21.5Z" fill="#ffb14a"/></svg>',
};

function el(tag, cls, html) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html != null) n.innerHTML = html;
  return n;
}

function fmt(n) {
  return Math.round(n).toLocaleString('en-GB');
}

/** The heights marked on the ladder. */
const MARKS = [
  { at: 10000, text: 'Airliners' },
  { at: 40000, text: 'Sky goes dark' },
  { at: 100000, text: 'SPACE · 100 km', space: true },
];


/**
 * On a touch screen there is no SPACE key: the big action button does what
 * SPACE does (LAUNCH, DROP, BURN…), so the words say that instead.
 */
function touchWords(str) {
  return String(str)
    .replace(/Press SPACE — or tap LAUNCH —/g, 'Tap LAUNCH')
    .replace(/Hold SPACE/g, 'Hold BURN')
    .replace(/HOLD SPACE/g, 'HOLD BURN')
    .replace(/SPACE held/g, 'BURN held')
    .replace(/Press SPACE/g, 'Tap the big button')
    .replace(/hold SPACE/g, 'hold BURN');
}

export class RocketHud {
  constructor({ touch, onPause, onView, onWarp, onAction, onLean, onBurn }) {
    if (!document.getElementById('rk-css')) {
      const s = document.createElement('style');
      s.id = 'rk-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.cbs = { onPause, onView, onWarp, onAction, onLean, onBurn };
    const root = el('div', 'rk-hud');
    root.hidden = true;
    if (touch) root.classList.add('is-touch');
    this.touch = !!touch;
    this.root = root;

    this.obj = el('div', 'rk-obj rk-glass', '<div class="rk-obj-title"></div><div class="rk-obj-text"></div>');
    this.objTitle = this.obj.firstChild;
    this.objText = this.obj.lastChild;

    this.panel = el('div', 'rk-panel rk-glass', `
      <div class="rk-row"><span class="rk-lbl">Height</span><span class="rk-val" data-h></span></div>
      <div class="rk-row"><span class="rk-lbl">Speed</span><span class="rk-val" data-v></span></div>
      <div class="rk-row"><span class="rk-lbl">Fuel</span><span></span><div class="rk-fuel" data-fuel></div></div>
      <div class="rk-orbit" data-orbit hidden>Sideways speed <span data-orbit-txt></span><b><i data-orbit-bar></i></b></div>`);
    this.hEl = this.panel.querySelector('[data-h]');
    this.vEl = this.panel.querySelector('[data-v]');
    this.fuelEl = this.panel.querySelector('[data-fuel]');
    this.orbitEl = this.panel.querySelector('[data-orbit]');
    this.orbitTxt = this.panel.querySelector('[data-orbit-txt]');
    this.orbitBar = this.panel.querySelector('[data-orbit-bar]');

    this.ladder = el('div', 'rk-ladder rk-glass', '<div class="rk-lad-track"></div>');
    this.ladderMarks = [];
    this.topMark = el('div', 'rk-top-mark');
    this.topMark.hidden = true;
    this.ladder.appendChild(this.topMark);
    this.me = el('div', 'rk-me', ICONS.rocket);
    this.ladder.appendChild(this.me);

    this.dial = el('div', 'rk-dial rk-glass', `
      <svg viewBox="0 0 190 112" aria-hidden="true">
        <path d="M 25 95 A 70 70 0 1 1 165 95" fill="none" stroke="rgba(234,241,251,0.14)" stroke-width="14" stroke-linecap="round"/>
        <path data-wedge fill="rgba(79,214,132,0.85)"/>
        <text x="95" y="14" fill="#9fb2cc" font-size="10" text-anchor="middle" font-weight="700">UP</text>
        <text x="186" y="110" fill="#9fb2cc" font-size="10" text-anchor="end" font-weight="700">FLAT ▶</text>
        <g data-needle><path d="M95 32 C 100 40 101 50 101 60 L101 86 L89 86 L89 60 C 89 50 90 40 95 32Z" fill="#fff"/>
          <path d="M89 76 L83 88 L89 86Z M101 76 L107 88 L101 86Z" fill="#b28dff"/><circle cx="95" cy="52" r="3" fill="#58c6ff"/>
          <path d="M91 87 L99 87 L95 97Z" fill="#ffb14a" data-flame/></g>
        <circle cx="95" cy="95" r="4" fill="#9fb2cc"/>
      </svg>
      <div class="rk-dial-word"></div>`);
    this.wedge = this.dial.querySelector('[data-wedge]');
    this.needle = this.dial.querySelector('[data-needle]');
    this.dialFlame = this.dial.querySelector('[data-flame]');
    this.dialWord = this.dial.querySelector('.rk-dial-word');

    this.land = el('div', 'rk-land rk-glass', `
      <div><div class="rk-cap">To the target</div><div class="rk-big" data-dist></div></div>
      <div><div class="rk-cap">Coming down</div><div class="rk-big" data-down></div></div>
      <div class="rk-slide"><span class="rk-cap">Sliding</span><span data-slide></span></div>
      <div class="rk-burn" data-burn></div>`);
    this.land.hidden = true;
    this.distEl = this.land.querySelector('[data-dist]');
    this.downEl = this.land.querySelector('[data-down]');
    this.burnEl = this.land.querySelector('[data-burn]');
    this.slideEl = this.land.querySelector('[data-slide]');

    this.btns = el('div', 'rk-btns');
    this.warpBtn = el('button', 'rk-btn', `${ICONS.fast}<span>×1</span>`);
    this.warpBtn.title = 'Speed up time (F)';
    this.viewBtn = el('button', 'rk-btn', `${ICONS.cam}<span>Side</span>`);
    this.viewBtn.title = 'Change the camera (C)';
    const pauseBtn = el('button', 'rk-btn', ICONS.pause);
    pauseBtn.title = 'Pause (Esc)';
    pauseBtn.setAttribute('aria-label', 'Pause');
    this.btns.append(this.warpBtn, this.viewBtn, pauseBtn);
    this.warpBtn.addEventListener('click', () => this.cbs.onWarp && this.cbs.onWarp());
    this.viewBtn.addEventListener('click', () => this.cbs.onView && this.cbs.onView());
    pauseBtn.addEventListener('click', () => this.cbs.onPause && this.cbs.onPause());

    this.count = el('div', 'rk-count');
    this.count.hidden = true;
    this.toastEl = el('div', 'rk-toast');
    this.toastEl.hidden = true;
    this.toasts = [];
    this.toastLeft = 0;

    this.action = el('button', 'rk-action', 'LAUNCH');
    this.action.hidden = true;
    const press = (e) => {
      e.preventDefault();
      this.action.classList.add('is-held');
      if (this.action.dataset.mode === 'burn') this.cbs.onBurn && this.cbs.onBurn(true);
      else this.cbs.onAction && this.cbs.onAction();
    };
    const release = () => {
      this.action.classList.remove('is-held');
      this.cbs.onBurn && this.cbs.onBurn(false);
    };
    this.action.addEventListener('pointerdown', press);
    this.action.addEventListener('pointerup', release);
    this.action.addEventListener('pointercancel', release);
    this.action.addEventListener('pointerleave', release);

    this.lean = el('div', 'rk-lean', '<button aria-label="Lean left" data-lean="-1">◀</button><button aria-label="Lean right" data-lean="1">▶</button>');
    this.lean.hidden = !touch;
    for (const b of this.lean.querySelectorAll('button')) {
      const v = Number(b.dataset.lean);
      const on = (e) => { e.preventDefault(); b.classList.add('is-held'); this.cbs.onLean && this.cbs.onLean(v, true); };
      const off = () => { b.classList.remove('is-held'); this.cbs.onLean && this.cbs.onLean(v, false); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointercancel', off);
      b.addEventListener('pointerleave', off);
    }

    this.keys = el('div', 'rk-keys', '<kbd>◀</kbd> <kbd>▶</kbd> lean · <kbd>SPACE</kbd> launch · drop · burn · <kbd>C</kbd> camera · <kbd>F</kbd> faster · <kbd>Esc</kbd> pause');

    this.target = el('div', 'rk-target', '<b>LAND HERE</b><i></i>');
    this.target.hidden = true;

    root.append(this.target, this.obj, this.panel, this.ladder, this.dial, this.land, this.btns, this.count, this.toastEl, this.lean, this.action, this.keys);
    extLayer().appendChild(root);
    this.last = {};
    this.textT = 0;
    this.ladderTop = 130000;
  }

  destroy() {
    this.root.remove();
  }

  setVisible(on) {
    this.root.hidden = !on;
  }

  setLarge(on) {
    this.root.classList.toggle('is-large', !!on);
  }

  /** The ladder's marks, laid out once per flight for its own top height. */
  layoutLadder(top) {
    this.ladderTop = top;
    for (const m of this.ladderMarks) m.remove();
    this.ladderMarks = [];
    for (const m of MARKS) {
      if (m.at > top) continue;
      const t = el('div', `rk-tick${m.space ? ' is-space' : ''}`, `<span>${m.text}</span>`);
      t.style.top = `${this.ladderY(m.at)}%`;
      this.ladder.insertBefore(t, this.me);
      this.ladderMarks.push(t);
    }
  }

  ladderY(alt) {
    // Square-root scale: the first few kilometres, where everything happens
    // near the ground, get room; space still sits near the top.
    const k = Math.sqrt(Math.max(0, Math.min(1, alt / this.ladderTop)));
    return 4 + (1 - k) * 92;
  }

  toast(text, kind = '') {
    this.toasts.push({ text, kind });
  }

  showCount(text, go) {
    this.count.hidden = !text;
    if (!text) return;
    if (this.count.textContent !== text) {
      this.count.textContent = text;
      this.count.classList.toggle('is-go', !!go);
      this.count.classList.remove('is-pop');
      void this.count.offsetWidth;
      this.count.classList.add('is-pop');
    }
  }

  setWarp(w) {
    const s = this.warpBtn.querySelector('span');
    const t = `×${w}`;
    if (s.textContent !== t) s.textContent = t;
  }

  setView(name) {
    const s = this.viewBtn.querySelector('span');
    if (s.textContent !== name) s.textContent = name;
  }

  /**
   * One frame of instruments.
   * @param {number} dt
   * @param {object} s  what to show — built by rocket.js from the flight.
   */
  update(dt, s) {
    this.textT -= dt;
    const writeText = this.textT <= 0;
    if (writeText) this.textT = 0.12;

    // Toasts, one at a time.
    this.toastLeft -= dt;
    if (this.toastLeft <= 0) {
      const next = this.toasts.shift();
      if (next) {
        this.toastEl.textContent = next.text;
        this.toastEl.className = `rk-toast${next.kind ? ` is-${next.kind}` : ''}`;
        this.toastEl.hidden = false;
        void this.toastEl.offsetWidth;
        this.toastEl.classList.add('is-in');
        this.toastLeft = 2.6;
      } else if (!this.toastEl.hidden) {
        this.toastEl.hidden = true;
      }
    }

    if (writeText) {
      const o = s.objective;
      if (this.last.title !== o.title) {
        this.objTitle.textContent = this.touch ? touchWords(o.title) : o.title;
        this.last.title = o.title;
      }
      if (this.last.text !== o.text) {
        this.objText.textContent = this.touch ? touchWords(o.text) : o.text;
        if (this.last.tone !== o.tone || !this.last.text || this.last.text.slice(0, 12) !== o.text.slice(0, 12)) {
          this.objText.classList.remove('is-flash');
          void this.objText.offsetWidth;
          this.objText.classList.add('is-flash');
        }
        this.last.text = o.text;
      }
      if (this.last.tone !== o.tone) {
        this.obj.className = `rk-obj rk-glass is-${o.tone}`;
        this.last.tone = o.tone;
      }
      const hTxt = s.alt < 1000 ? `${fmt(s.alt)}<small>m</small>` : `${(s.alt / 1000).toFixed(s.alt < 10000 ? 2 : 1)}<small>km</small>`;
      if (this.last.h !== hTxt) { this.hEl.innerHTML = hTxt; this.last.h = hTxt; }
      const vTxt = `${fmt(s.speed * 3.6)}<small>km/h</small>`;
      if (this.last.v !== vTxt) { this.vEl.innerHTML = vTxt; this.last.v = vTxt; }
      const fuelKey = s.tanks.map((t) => `${t.name}:${Math.round(t.frac * 50)}:${t.gone ? 1 : 0}:${t.reserve ? 1 : 0}`).join('|');
      if (this.last.fuel !== fuelKey) {
        this.fuelEl.innerHTML = s.tanks.map((t) => `<div class="rk-tank${t.gone ? ' is-gone' : ''}${t.reserve ? ' is-reserve' : ''}"><span>${t.name}</span><b><i style="transform:scaleX(${Math.max(0, Math.min(1, t.frac)).toFixed(3)})"></i></b><span>${t.gone ? '—' : `${Math.round(t.frac * 100)}%`}</span></div>`).join('');
        this.last.fuel = fuelKey;
      }
      if (s.orbit) {
        this.orbitEl.hidden = false;
        const t = `${fmt(s.orbit.v)} / ${fmt(s.orbit.need)} m/s`;
        if (this.last.orbit !== t) {
          this.orbitTxt.textContent = t;
          this.orbitBar.style.width = `${Math.min(100, (s.orbit.v / s.orbit.need) * 100).toFixed(1)}%`;
          this.last.orbit = t;
        }
      } else {
        this.orbitEl.hidden = true;
      }
      // The action button: what SPACE does right now.
      const act = s.action;
      if (!act) {
        this.action.hidden = true;
      } else {
        this.action.hidden = false;
        const html = `${act.label}${s.touch ? '' : '<small>SPACE</small>'}`;
        if (this.last.act !== html) { this.action.innerHTML = html; this.last.act = html; }
        this.action.dataset.mode = act.mode || 'press';
        this.action.classList.toggle('is-warn', act.tone === 'warn');
        this.action.classList.toggle('is-burn', act.mode === 'burn');
      }
    }

    // The ladder marker, and the top of the path.
    this.me.style.top = `${this.ladderY(s.alt)}%`;
    if (s.top && s.top > s.alt + 500 && isFinite(s.top)) {
      this.topMark.hidden = false;
      this.topMark.style.top = `${this.ladderY(Math.min(s.top, this.ladderTop))}%`;
    } else {
      this.topMark.hidden = true;
    }

    // The dial, or the landing card.
    const landing = !!s.landing;
    this.keys.hidden = landing || !!s.done;
    this.root.classList.toggle('is-landing', landing);
    this.dial.hidden = landing || !s.dial;
    this.land.hidden = !landing;
    if (!landing && s.dial) {
      const deg = (s.dial.tilt * 180) / Math.PI;
      this.needle.setAttribute('transform', `rotate(${Math.max(-100, Math.min(125, deg)).toFixed(1)} 95 95)`);
      this.dialFlame.style.opacity = s.dial.burning ? '1' : '0';
      const g = Math.round((s.dial.guide * 180) / Math.PI);
      if (this.last.guide !== g) {
        this.wedge.setAttribute('d', wedgePath(g - 7, g + 7));
        this.last.guide = g;
      }
      if (writeText) {
        const w = s.dial.word;
        if (this.last.word !== w.text) {
          this.dialWord.textContent = w.text;
          this.dialWord.className = `rk-dial-word is-${w.tone}`;
          this.last.word = w.text;
        }
      }
    }
    if (landing && writeText) {
      const L = s.landing;
      const dist = L.over ? 'Right over it ✓' : L.dist > 0 ? `${fmt(L.dist)} m ▶` : `◀ ${fmt(-L.dist)} m`;
      if (this.last.dist !== dist) { this.distEl.textContent = dist; this.last.dist = dist; }
      const down = `${Math.max(0, Math.round(L.down))} m/s`;
      if (this.last.down !== down) { this.downEl.textContent = down; this.last.down = down; }
      const tone = L.down <= 6 ? 'is-good' : L.down <= 40 || L.above > 2500 ? 'is-warn' : 'is-bad';
      this.downEl.className = `rk-big ${tone}`;
      // Which way it is sliding: the thing to stop before it lands.
      const sv = Math.abs(L.slide);
      let slide = 'Not sliding ✓';
      if (sv >= 1.5) {
        slide = `${L.slide > 0 ? '▶' : '◀'} ${fmt(sv)} m/s`;
        if (L.slideTone !== 'good') slide += L.helper ? ' — let go of ◀ ▶ to stop' : ` — lean ${L.slide > 0 ? '◀' : '▶'} to stop`;
      }
      if (this.last.slide !== slide) {
        this.slideEl.textContent = slide;
        this.last.slide = slide;
        // A hint on the end may wrap the line: measure the card again.
        const long = slide.length > 14;
        if (this.last.slideLong !== long) { this.last.slideLong = long; this.landBottom = 0; }
      }
      this.slideEl.className = `is-${L.slideTone}`;
      const burnTxt = L.burning
        ? 'ENGINE ON — slowing down'
        : L.need
          ? 'HOLD SPACE TO SLOW DOWN!'
          : L.holding && L.helper
            ? 'SPACE held ✓ — it fires by itself'
            : 'Hold SPACE when you want to slow down';
      if (this.last.burn !== burnTxt) {
        this.burnEl.textContent = this.touch ? touchWords(burnTxt) : burnTxt;
        this.burnEl.className = `rk-burn${L.burning ? ' is-on' : L.need ? ' is-need' : ''}`;
        this.last.burn = burnTxt;
        this.landBottom = 0;
      }
    }

    // The target marker, pinned to the pad or ship on screen.
    if (s.target) {
      const t = s.target;
      this.target.hidden = false;
      const W = window.innerWidth;
      const H = window.innerHeight;
      let x = t.x;
      let y = t.y;
      const edge = !t.onScreen;
      // Kept clear of the goal, the landing card and the buttons along the bottom.
      if (landing && (!this.landBottom || this.last.landW !== W || this.last.landH !== H)) {
        const r = this.land.getBoundingClientRect();
        this.landBottom = r.bottom > 0 ? r.bottom : 0;
        this.landRight = r.right > 0 ? r.right : 0;
        this.last.landW = W;
        this.last.landH = H;
      }
      x = Math.max(70, Math.min(W - 70, x));
      const underCard = landing && x - 70 < (this.landRight || 0);
      y = Math.max(underCard ? (this.landBottom || 0) + 36 : 110, Math.min(H - 120, y));
      this.target.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(-50%, -100%)`;
      this.target.classList.toggle('is-edge', edge);
      const label = t.label + (!edge ? '' : t.y > H - 120 ? ' ▼' : t.x < 70 ? ' ◀' : t.x > W - 70 ? ' ▶' : ' ▲');
      if (this.last.tgt !== label) {
        this.target.querySelector('b').textContent = label;
        this.last.tgt = label;
      }
    } else {
      this.target.hidden = true;
    }
  }
}

function wedgePath(a0, a1) {
  // Angles in degrees from straight up, clockwise; the dial's centre is (95, 95).
  const cx = 95;
  const cy = 95;
  const r0 = 62;
  const r1 = 78;
  const p = (a, r) => {
    const t = (a * Math.PI) / 180;
    return `${(cx + Math.sin(t) * r).toFixed(1)} ${(cy - Math.cos(t) * r).toFixed(1)}`;
  };
  return `M ${p(a0, r0)} L ${p(a0, r1)} A ${r1} ${r1} 0 0 1 ${p(a1, r1)} L ${p(a1, r0)} A ${r0} ${r0} 0 0 0 ${p(a0, r0)} Z`;
}


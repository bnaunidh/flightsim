/**
 * On-screen bits for walking about and for the ramp crew: the "Press O"
 * prompt, the job card, and — because half the class is on an iPad with no
 * keyboard at all — a thumb-stick, a look pad and big buttons.
 *
 * Everything lives in extLayer(), which has pointer events off; the pieces
 * that take a tap turn them on for themselves only, and only while shown, so
 * nothing here can swallow a tap meant for the game.
 *
 * Built lazily, on first use, so importing this in node (the tests) touches
 * no DOM at all.
 */

import { extLayer } from '../../game/extensions.js';

const CSS = `
.of-prompt {
  position: absolute; left: 50%; bottom: 330px; transform: translateX(-50%);
  background: rgba(12, 20, 34, 0.84); color: #f4f7fa;
  font: 600 15px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  padding: 10px 18px; border-radius: 12px; max-width: min(520px, 86vw);
  text-align: center; border: 1px solid rgba(242, 197, 61, 0.6);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); pointer-events: none;
  opacity: 0; transition: opacity 0.2s; user-select: none; -webkit-user-select: none;
  /* Above the look pad: on a phone the prompt sits where the pad is, and the
     pad comes later in the page, so without this a tap on the prompt's right
     half would start a look-round instead of getting you in. */
  z-index: 3;
}
.of-prompt.on { opacity: 1; }
.of-prompt.act { pointer-events: auto; cursor: pointer; }
.of-prompt.act:active { transform: translateX(-50%) scale(0.97); }
.of-prompt kbd {
  display: inline-block; min-width: 1.4em; padding: 1px 7px; margin: 0 2px;
  border-radius: 6px; background: #f2c53d; color: #1a1d20;
  /* Longhands: "font: 800 14px/1.3 inherit" is not valid CSS, so the whole
     line was dropped and the key fell back to the 11 px monospace kbd, where
     "Press O to get out" read as "Press 0". */
  font-family: inherit; font-weight: 800; font-size: 14px; line-height: 1.3;
}
.of-prompt b { color: #ffd166; }
.of-card {
  position: absolute; left: 16px; top: 34%; width: 220px;
  background: rgba(12, 20, 34, 0.8); color: #eef3f8; border-radius: 14px;
  border: 1px solid rgba(242, 197, 61, 0.45); padding: 10px 12px;
  font: 500 13px/1.35 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3); pointer-events: none; display: none;
}
.of-card.on { display: block; }
.of-card h4 {
  margin: 0 0 6px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: #f2c53d;
}
.of-card .row { display: flex; gap: 8px; align-items: baseline; padding: 3px 0; opacity: 0.62; }
.of-card .row.now { opacity: 1; font-weight: 650; }
.of-card .row.done { opacity: 0.9; }
.of-card .tick { width: 1.2em; text-align: center; color: #7ee8b2; }
.of-card .stars { margin-left: auto; color: #ffd166; letter-spacing: 1px; }
.of-card .total { margin-top: 6px; padding-top: 6px; border-top: 1px solid rgba(255,255,255,0.12); color: #ffd166; }
.of-stick {
  position: absolute; left: 22px; bottom: 26px; width: 136px; height: 136px; border-radius: 50%;
  background: rgba(12, 20, 34, 0.42); border: 2px solid rgba(255, 255, 255, 0.28);
  pointer-events: auto; touch-action: none; display: none;
}
.of-stick .nub {
  position: absolute; left: 43px; top: 43px; width: 50px; height: 50px; border-radius: 50%;
  background: rgba(242, 197, 61, 0.85); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35);
}
.of-look {
  position: absolute; right: 0; top: 22%; width: 52%; height: 44%;
  pointer-events: auto; touch-action: none; display: none;
}
.of-btns {
  position: absolute; right: 18px; bottom: 26px; display: none; gap: 10px;
  flex-wrap: wrap-reverse; justify-content: flex-end; width: 250px; pointer-events: none;
}
.of-btns button {
  pointer-events: auto; touch-action: none; min-width: 74px; height: 58px; border-radius: 16px;
  border: 2px solid rgba(255, 255, 255, 0.35); background: rgba(12, 20, 34, 0.62); color: #fff;
  font: 700 14px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
}
.of-btns button.on { background: rgba(242, 197, 61, 0.9); color: #1a1d20; }
.of-btns button:active { transform: scale(0.95); }
.of-on .of-stick, .of-on .of-look { display: block; }
.of-on .of-btns { display: flex; }
/*
 * On foot, the instruments of whatever you climbed out of are not yours: a
 * speed of 0 km/h and a POWER bar saying "Go: Shift" beside a person who runs
 * with Shift is two games talking at once. The objective, the toasts, the
 * wind and the map stay.
 */
.of-walking .hud-left, .of-walking .hud-bottom, .of-walking .hud-chevron,
.of-walking .hud-cargo, .of-walking .hud-coach, .of-walking .hud-stall,
.of-walking .hud-papi, .of-walking .hud-taxi, .of-walking .hud-waypoint { display: none !important; }
/*
 * A passenger riding along (sim.riding — Air Force One's President seat) is
 * not the ground crew above: there is no aeroplane of their own parked
 * nearby to glance the wind for, so .of-riding folds the wind panel away
 * too, on top of everything .of-walking already hides.
 */
.of-riding .hud-right { display: none !important; }
/*
 * On foot the vehicle's bottom panels are gone, so the prompt comes down out
 * of the middle of the picture — where it sat over the marshaller's back and
 * the nose of the aeroplane being waved in — to just above the radio line.
 */
.of-root.of-walk .of-prompt { bottom: 190px; }
/*
 * A phone on its side is 390 px tall: the card (a third of the way down, two
 * hundred pixels of it) lands on top of the thumb-stick. There the objective
 * banner says what to do next and the toasts give the stars, so the card
 * steps out of the way; the prompt comes up off the stick too.
 */
@media (max-height: 500px) {
  .of-card { display: none !important; }
  .of-root.of-walk .of-prompt { bottom: 172px; }
}
/*
 * A phone held upright: 390 px across. The whole card, parked above the
 * stick, sat on top of the radio subtitles and the walker — in a 390 x 700
 * frame it covered half the character and all of the tower's words. The jobs
 * are in the objective banner anyway; here the card is just the round and
 * the stars, tucked under the map in the corner.
 */
@media (max-width: 620px) {
  .of-prompt, .of-root.of-walk .of-prompt { bottom: auto; top: 210px; font-size: 13px; }
  .of-card { top: 100px; bottom: auto; left: 8px; width: auto; max-width: 132px; padding: 6px 8px; font-size: 12px; }
  .of-card .row { display: none; }
  .of-card h4 { margin: 0; font-size: 10px; }
  .of-card .total { margin-top: 3px; padding-top: 3px; }
  /*
   * Two buttons to a row. Four in a 250 px row put Run on top of the right
   * third of the thumb-stick in a 390 px frame (Run 130-203 px, stick 22-158):
   * a thumb pushing the stick right went to Run instead.
   */
  .of-btns { width: 168px; right: 12px; }
}
/*
 * Nothing of ours over the pause screen or a menu. This layer sits above the
 * menus (z-index 30 against their 10), so the walking controls stayed on top
 * of the pause screen: in a 390 x 700 touch frame, paused while walking, the
 * look pad was the element under the middle of Restart, Return to the
 * airfield and Quit to menu, and "Tap here to get in the aeroplane" stood
 * over it, live. Hidden while the game is not flying with its interface up.
 */
.of-root.of-off { display: none !important; }
`;

const UI = {
  built: false,
  root: null,
  prompt: null,
  promptHtml: '',
  promptAction: null,
  card: null,
  cardHtml: '',
  stick: null,
  nub: null,
  btns: null,
  touchOn: false,
  buttonsRef: null,
  /** What the thumbs are doing, read by onfoot.js every frame. */
  touch: { x: 0, y: 0, lookX: 0, lookY: 0, run: false, jump: false, held: Object.create(null) },
  onButton: null,
  /** The game, for the gate below; true while everything of ours is kept off screen. */
  game: null,
  off: false,
  watch: 0,
  observer: null,
};

function build() {
  if (UI.built) return true;
  if (typeof document === 'undefined' || !document.createElement || !document.head) return false;
  UI.built = true;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'of-root';
  Object.assign(root.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
  extLayer().appendChild(root);
  UI.root = root;

  const p = document.createElement('div');
  p.className = 'of-prompt';
  p.setAttribute('role', 'status');
  // A tap is the same as the key. pointerdown answers at once on a touch
  // screen; stopped here so the game underneath never sees the press.
  p.addEventListener('pointerdown', (ev) => {
    // Hidden with the pause screen up, and dead too: a tap that reached it
    // in the moment before the gate closed must not get anybody in or out.
    syncGate();
    if (!UI.promptAction || UI.off) return;
    ev.preventDefault();
    ev.stopPropagation();
    const fn = UI.promptAction;
    fn();
  });
  root.appendChild(p);
  UI.prompt = p;

  const card = document.createElement('div');
  card.className = 'of-card';
  root.appendChild(card);
  UI.card = card;

  buildTouch(root);
  return true;
}

function buildTouch(root) {
  const stick = document.createElement('div');
  stick.className = 'of-stick';
  const nub = document.createElement('div');
  nub.className = 'nub';
  stick.appendChild(nub);
  root.appendChild(stick);
  UI.stick = stick;
  UI.nub = nub;
  let id = null;
  const R = 58;
  const move = (ev) => {
    const r = stick.getBoundingClientRect();
    let dx = ev.clientX - (r.left + r.width / 2);
    let dy = ev.clientY - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    if (d > R) {
      dx *= R / d;
      dy *= R / d;
    }
    nub.style.transform = `translate(${dx}px, ${dy}px)`;
    UI.touch.x = dx / R;
    UI.touch.y = -dy / R;
    // Push the stick right out and you run.
    UI.touch.run = d > R * 0.92;
  };
  stick.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    id = ev.pointerId;
    try { stick.setPointerCapture(id); } catch (e) { /* older Safari */ }
    move(ev);
  });
  stick.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== id) return;
    ev.preventDefault();
    move(ev);
  });
  const end = (ev) => {
    if (ev.pointerId !== id) return;
    id = null;
    nub.style.transform = '';
    UI.touch.x = 0;
    UI.touch.y = 0;
    UI.touch.run = false;
  };
  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);

  const look = document.createElement('div');
  look.className = 'of-look';
  root.appendChild(look);
  let lid = null;
  let lx = 0;
  let ly = 0;
  look.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    lid = ev.pointerId;
    lx = ev.clientX;
    ly = ev.clientY;
    try { look.setPointerCapture(lid); } catch (e) { /* older Safari */ }
  });
  look.addEventListener('pointermove', (ev) => {
    if (ev.pointerId !== lid) return;
    UI.touch.lookX += ev.clientX - lx;
    UI.touch.lookY += ev.clientY - ly;
    lx = ev.clientX;
    ly = ev.clientY;
  });
  const lend = (ev) => {
    if (ev.pointerId === lid) lid = null;
  };
  look.addEventListener('pointerup', lend);
  look.addEventListener('pointercancel', lend);

  const btns = document.createElement('div');
  btns.className = 'of-btns';
  root.appendChild(btns);
  UI.btns = btns;
}

/* ------------------------------------------------------------------ */

/** Show `html` (or nothing); `action`, if given, is what a tap does. */
export function setPrompt(html, action = null) {
  if (!build()) {
    // No page (the node tests): remember the words, draw nothing.
    UI.promptHtml = html || '';
    UI.promptAction = html ? action : null;
    return;
  }
  UI.promptAction = html ? action : null;
  UI.prompt.classList.toggle('act', !!UI.promptAction);
  if (UI.promptHtml === html) return;
  UI.promptHtml = html;
  if (html) UI.prompt.innerHTML = html;
  UI.prompt.classList.toggle('on', !!html);
}

export function promptText() {
  return UI.promptHtml || '';
}

/** The job card. `html` null hides it. */
export function setCard(html) {
  if (!build()) return;
  if (UI.cardHtml === html) return;
  UI.cardHtml = html || '';
  if (html) UI.card.innerHTML = html;
  UI.card.classList.toggle('on', !!html);
}

/**
 * The thumb controls. `buttons` is a list of { id, label, hold } — a hold
 * button reports itself in touch.held[id] while a finger is on it; the
 * others call `onButton(id)` once per tap.
 */
export function setTouch(on, buttons = [], onButton = null) {
  if (!build()) return;
  UI.onButton = onButton;
  if (UI.touchOn !== !!on) {
    UI.touchOn = !!on;
    UI.root.classList.toggle('of-on', UI.touchOn);
    if (!on) {
      UI.touch.x = 0;
      UI.touch.y = 0;
      UI.touch.run = false;
      for (const k in UI.touch.held) UI.touch.held[k] = false;
      if (UI.nub) UI.nub.style.transform = '';
    }
  }
  // The same list as last frame is the same buttons: nothing to rebuild.
  const want = on ? buttons : null;
  if (want === UI.buttonsRef) return;
  UI.buttonsRef = want;
  UI.btns.innerHTML = '';
  for (const b of on ? buttons : []) {
    const el = document.createElement('button');
    el.textContent = b.label;
    el.dataset.id = b.id;
    if (b.on) el.classList.add('on');
    el.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (b.hold) UI.touch.held[b.id] = true;
      else if (UI.onButton) UI.onButton(b.id);
    });
    const up = () => {
      if (b.hold) UI.touch.held[b.id] = false;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    el.addEventListener('pointerleave', up);
    UI.btns.appendChild(el);
  }
}

/** Step the vehicle's or aeroplane's instruments aside while on foot. */
export function setHudWalking(hud, on) {
  const w = hud && hud.wrap;
  if (!w || !w.classList) return;
  build();
  w.classList.toggle('of-walking', !!on);
  if (UI.root) UI.root.classList.toggle('of-walk', !!on);
}

/**
 * Fold the wind panel away too — only for a passenger (sim.riding), never
 * for the ground crew's ordinary walk, which keeps it (see .of-walking's own
 * note above .of-riding in the CSS). Call alongside setHudWalking(hud, true).
 */
export function setHudRiding(hud, on) {
  const w = hud && hud.wrap;
  if (!w || !w.classList) return;
  w.classList.toggle('of-riding', !!on);
}

/* ------------------------------------------------------------------ */
/* The gate: nothing of ours over the pause screen or a menu            */
/* ------------------------------------------------------------------ */

/** May anything of ours be on screen? Only while flying with the interface up. */
function gameShowing(sim) {
  if (!sim) return true;
  if (sim.state !== 'flying') return false;
  const hud = sim.hud;
  if (hud && (hud.hidden || hud.enabled === false)) return false;
  if (sim.menus && sim.menus.current) return false;
  return true;
}

/** Hide or show the whole layer to match. Cheap when nothing has changed. */
export function syncGate() {
  if (!UI.root) return;
  const off = !gameShowing(UI.game);
  if (off === UI.off) return;
  UI.off = off;
  UI.root.classList.toggle('of-off', off);
  if (off) {
    // A thumb on the stick when the menu came up has let go, as far as the
    // walker is concerned; it must not set off walking on Resume.
    UI.touch.x = 0;
    UI.touch.y = 0;
    UI.touch.run = false;
    for (const k in UI.touch.held) UI.touch.held[k] = false;
    if (UI.nub) UI.nub.style.transform = '';
  }
}

/** True while the gate has everything of ours off screen. */
export function gated() {
  return UI.off;
}

/**
 * Watch the game for the pause screen, a menu or the interface being hidden:
 * each of those flips one attribute, on the menu layer or on the HUD's
 * wrapper, and an observer hears it before the next frame is drawn — which
 * matters because update() does not run while paused, so nothing else would
 * ever hide us. A quarter-second timer backs it up, and runs `tick` too.
 *
 * Both run outside the fence extensions.js puts round every hook, so each
 * has its own try/catch, and a watcher that fails stops rather than failing
 * four times a second for ever.
 */
export function watchGame(sim, tick = null) {
  UI.game = sim || null;
  if (!build() || UI.watch) return;
  const safe = () => {
    try {
      syncGate();
      if (tick) tick();
    } catch (e) {
      console.warn('[onfoot] the menu watcher failed and has stopped', e);
      if (UI.watch > 0) clearInterval(UI.watch);
      UI.watch = -1;
      if (UI.observer) UI.observer.disconnect();
      UI.observer = null;
    }
  };
  try {
    if (typeof setInterval === 'function') UI.watch = setInterval(safe, 250);
    if (typeof MutationObserver === 'function' && sim) {
      const obs = new MutationObserver(safe);
      const layer = sim.menus && sim.menus.layer;
      const wrap = sim.hud && sim.hud.wrap;
      if (layer && layer.nodeType === 1) obs.observe(layer, { attributes: true, attributeFilter: ['hidden'] });
      if (wrap && wrap.nodeType === 1) obs.observe(wrap, { attributes: true, attributeFilter: ['style'] });
      UI.observer = obs;
    }
  } catch (e) {
    console.warn('[onfoot] could not watch the menus; the per-frame check still runs', e);
  }
  syncGate();
}

export const touch = UI.touch;

/** Take and clear the look pad's accumulated drag, in pixels. */
export function takeLook(out) {
  out.x = UI.touch.lookX;
  out.y = UI.touch.lookY;
  UI.touch.lookX = 0;
  UI.touch.lookY = 0;
  return out;
}

/**
 * The heat-seeker's screen: the count (MSL 3/3), the seeker ring, the lock
 * box that goes red, the missile-approach arrows, and the two touch buttons.
 * Plain DOM on the feature layer (extensions.js extLayer), pointer events off
 * except the buttons.
 *
 * Nothing here flashes. The lock box turns red and stays red; the warning
 * ring and the edge glow swell and fade through blinkLevel() — a slow soft
 * pulse with Reduce flashing on (the default), a plain blink without it —
 * and the glow is held under the full-screen cap (screenOpacity). No sound is
 * made here at all: the game's own sound is muted by default, and there is no
 * lock tone.
 */

import { extLayer } from '../../game/extensions.js';
import { blinkLevel, screenOpacity, FLASH } from '../../render/flash-safety.js';

const CSS = `
.hsk-root { position: fixed; inset: 0; pointer-events: none; z-index: 29; }
.hsk-root[hidden], .hsk-panel[hidden], .hsk-seeker[hidden], .hsk-lock[hidden], .hsk-btn[hidden], .hsk-threats[hidden], .hsk-alert[hidden], .hsk-glow[hidden] { display: none !important; }
.hsk-panel { position: fixed; left: 16px; top: 340px; display: flex; flex-direction: column; gap: 4px; padding: 7px 11px 8px; border-radius: 10px;
  background: rgba(10, 16, 24, 0.72); border: 1px solid rgba(180, 205, 235, 0.28); color: #eaf2fb; font: 700 15px/1.1 "SF Mono", ui-monospace, Menlo, Consolas, monospace;
  letter-spacing: 0.04em; min-width: 108px; }
.hsk-panel .hsk-count { display: flex; align-items: center; gap: 8px; }
.hsk-panel .hsk-pips { display: inline-flex; gap: 4px; }
.hsk-panel .hsk-pip { width: 7px; height: 15px; border-radius: 2px 2px 3px 3px; background: #f3f6f8; border: 1px solid #1c2229; }
.hsk-panel .hsk-pip.is-gone { background: transparent; border-color: rgba(180, 205, 235, 0.35); }
.hsk-panel .hsk-flr { font-size: 12.5px; color: #ffd98a; }
.hsk-panel .hsk-keys { font: 600 10.5px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.02em; color: #a8b8c9; }
.hsk-panel .hsk-keys kbd { font: inherit; padding: 0 4px; border-radius: 3px; background: rgba(255,255,255,0.12); color: #eaf2fb; }
.hsk-panel .hsk-state { font: 700 11px/1.2 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.08em; color: #b9c6d4; text-transform: uppercase; }
.hsk-panel.is-locked .hsk-state { color: #ff6a58; }
.hsk-panel.is-empty .hsk-count { color: #ff9a8a; }
.hsk-seeker { position: fixed; left: 0; top: 0; width: 80px; height: 80px; margin: -40px 0 0 -40px; will-change: transform; color: rgba(225, 245, 235, 0.78);
  filter: drop-shadow(0 0 1.5px rgba(0, 0, 0, 0.55)); }
.hsk-seeker svg { display: block; width: 100%; height: 100%; overflow: visible; }
.hsk-seeker .hsk-ring { fill: none; stroke: currentColor; stroke-width: 1.25; vector-effect: non-scaling-stroke; }
.hsk-seeker .hsk-tick { stroke: currentColor; stroke-width: 1.5; stroke-linecap: round; vector-effect: non-scaling-stroke; }
.hsk-lock { position: fixed; left: 0; top: 0; width: 64px; height: 64px; margin: -32px 0 0 -32px; will-change: transform; color: #ffd24a; }
.hsk-lock i { position: absolute; width: 16px; height: 16px; border: 3px solid currentColor; }
.hsk-lock i:nth-child(1) { left: 0; top: 0; border-right: 0; border-bottom: 0; }
.hsk-lock i:nth-child(2) { right: 0; top: 0; border-left: 0; border-bottom: 0; }
.hsk-lock i:nth-child(3) { left: 0; bottom: 0; border-right: 0; border-top: 0; }
.hsk-lock i:nth-child(4) { right: 0; bottom: 0; border-left: 0; border-top: 0; }
.hsk-lock.is-locked { color: #ff3b30; }
.gsk-box.is-under-lock i, .gsk-box.is-under-lock .gsk-tag { visibility: hidden; }
.hsk-lock .hsk-lock-tag { position: absolute; left: 50%; top: 100%; transform: translateX(-50%); margin-top: 5px; white-space: nowrap; padding: 1px 7px; border-radius: 4px;
  background: rgba(10,16,24,0.78); font: 800 11px/1.5 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.1em; color: inherit; }
.hsk-lock .hsk-lock-bar { position: absolute; left: 6px; right: 6px; bottom: -3px; height: 3px; border-radius: 2px; background: rgba(255,255,255,0.18); overflow: hidden; }
.hsk-lock .hsk-lock-bar b { display: block; height: 100%; width: 0; background: currentColor; }
.hsk-threats { position: fixed; inset: 0; }
.hsk-arrow { position: fixed; left: 0; top: 0; width: 0; height: 0; margin: 0; will-change: transform; }
.hsk-arrow::before { content: ''; position: absolute; left: -13px; top: -16px; border-left: 13px solid transparent; border-right: 13px solid transparent; border-bottom: 24px solid #ff4a3a;
  filter: drop-shadow(0 0 4px rgba(0,0,0,0.6)); }
.hsk-arrow b { position: absolute; left: -34px; top: 10px; width: 68px; text-align: center; font: 800 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff;
  text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 2px #000; }
.hsk-diamond { position: fixed; left: 0; top: 0; width: 34px; height: 34px; margin: -17px 0 0 -17px; border: 3px solid #ff4a3a; transform-origin: center; will-change: transform; }
.hsk-diamond b { position: absolute; left: 50%; top: 100%; transform: translateX(-50%) rotate(-45deg); margin-top: 12px; white-space: nowrap; font: 800 12px/1 system-ui, -apple-system, 'Segoe UI', sans-serif; color: #fff;
  text-shadow: 0 0 4px rgba(0,0,0,0.9), 0 0 2px #000; }
.hsk-alert { position: fixed; left: 50%; top: 18%; transform: translateX(-50%); box-sizing: border-box; width: max-content; max-width: min(calc(100vw - 24px), 560px); overflow-wrap: anywhere; text-align: center; padding: 9px 18px; border-radius: 10px;
  background: rgba(120, 18, 12, 0.82); border: 2px solid #ff5a4a; color: #fff; font: 800 17px/1.25 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 0.04em;
  box-shadow: 0 6px 22px rgba(0,0,0,0.4); }
.hsk-alert small { display: block; font: 600 12px/1.3 system-ui, sans-serif; letter-spacing: 0.02em; opacity: 0.9; margin-top: 3px; }
.hsk-glow { position: fixed; inset: 0; box-shadow: inset 0 0 110px 34px rgba(255, 56, 40, 1); opacity: 0; }
.hsk-btn { position: fixed; z-index: 31; pointer-events: auto; touch-action: none; user-select: none; -webkit-user-select: none; cursor: pointer; border-radius: 50%; color: #fff;
  border: 3px solid #1b1030; font: 900 14px/1.05 "Arial Black", Impact, sans-serif; display: none; flex-direction: column; align-items: center; justify-content: center; text-align: center;
  box-shadow: 0 5px 0 #1b1030, 0 8px 18px rgba(0,0,0,0.35); }
.hsk-btn small { font: 700 10px/1.1 system-ui, sans-serif; opacity: 0.9; margin-top: 2px; }
/* On a touch screen: in a row above the touch pads, to the left of Air Force One's FIRE (right 96, bottom 196) and clear of the throttle, the race bar and the map. */
.hsk-btn.is-fire { right: 190px; bottom: 204px; width: 76px; height: 76px; background: radial-gradient(circle at 35% 30%, #ffb27a, #ff6a2f 60%, #c8431a); }
.hsk-btn.is-flare { right: 276px; bottom: 212px; width: 62px; height: 62px; font-size: 12px; letter-spacing: -0.02em; background: radial-gradient(circle at 35% 30%, #ffe08a, #ffb02f 60%, #c98212); }
.hsk-btn.is-down { transform: translateY(3px); box-shadow: 0 2px 0 #1b1030; }
.hsk-btn.is-dim { filter: grayscale(0.85) brightness(0.8); }
html.is-touch-device .hsk-btn { display: flex; }
html.is-touch-device .hsk-btn[hidden] { display: none !important; }
/* The buttons say the counts, so a touch screen has no panel to find room for. */
html.is-touch-device .hsk-panel { display: none; }
/* A phone upright: above the HOOK pad on the right, which has the whole right edge to itself up there. */
@media (max-width: 560px) {
  html.is-touch-device .hsk-btn.is-fire { right: 12px; bottom: 262px; width: 68px; height: 68px; }
  html.is-touch-device .hsk-btn.is-flare { right: 90px; bottom: 268px; width: 58px; height: 58px; }
}
/* A phone on its side has the top of the screen to the instruments: down in the gap between the rudder and the pads. */
@media (max-height: 520px) and (min-width: 561px) {
  html.is-touch-device .hsk-btn.is-fire { right: 260px; bottom: 96px; width: 72px; height: 72px; }
  html.is-touch-device .hsk-btn.is-flare { right: 344px; bottom: 102px; width: 58px; height: 58px; }
}
`;

const S = { els: null, key: '' };

function el(tag, cls, parent, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  if (parent) parent.appendChild(e);
  return e;
}

export function ensureHud(handlers = {}) {
  if (S.els || typeof document === 'undefined') return S.els;
  if (!document.getElementById('ifs-heatseek-style')) {
    const st = document.createElement('style');
    st.id = 'ifs-heatseek-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = el('div', 'hsk-root', extLayer());
  root.hidden = true;
  const panel = el('div', 'hsk-panel', root);
  const count = el('div', 'hsk-count', panel);
  const label = el('span', 'hsk-label', count, 'MSL 3/3');
  const pips = el('span', 'hsk-pips', count);
  const flr = el('div', 'hsk-flr', panel, '');
  const state = el('div', 'hsk-state', panel, '');
  const keys = el('div', 'hsk-keys', panel, '');
  // A fighter HUD's missile reticle, not a dashed hoop (the owner, 2026-10-27: "make this crosshair or smth
  // better"): four thin arcs with a gap and an inward tick at each quarter, and a small winged pipper in the middle.
  const arcs = [0, 90, 180, 270].map((a) => {
    const r = 48, g = 9, p0 = ((a + g) * Math.PI) / 180, p1 = ((a + 90 - g) * Math.PI) / 180;
    return `<path class="hsk-ring" d="M${(50 + r * Math.cos(p0)).toFixed(2)} ${(50 + r * Math.sin(p0)).toFixed(2)} A${r} ${r} 0 0 1 ${(50 + r * Math.cos(p1)).toFixed(2)} ${(50 + r * Math.sin(p1)).toFixed(2)}"/>`;
  }).join('');
  const ticks = [[50, 2, 50, 9], [98, 50, 91, 50], [50, 98, 50, 91], [2, 50, 9, 50]].map(([a, b, c, d]) => `<line class="hsk-tick" x1="${a}" y1="${b}" x2="${c}" y2="${d}"/>`).join('');
  const pipper = '<circle cx="50" cy="50" r="1.6" fill="currentColor"/><line class="hsk-tick" x1="41" y1="50" x2="46" y2="50"/><line class="hsk-tick" x1="54" y1="50" x2="59" y2="50"/>';
  const seeker = el('div', 'hsk-seeker', root, `<svg viewBox="0 0 100 100" aria-hidden="true">${arcs}${ticks}${pipper}</svg>`);
  seeker.hidden = true;
  const lock = el('div', 'hsk-lock', root, '<i></i><i></i><i></i><i></i><span class="hsk-lock-tag"></span><span class="hsk-lock-bar"><b></b></span>');
  lock.hidden = true;
  const threats = el('div', 'hsk-threats', root);
  threats.hidden = true;
  const alert = el('div', 'hsk-alert', root);
  alert.hidden = true;
  const glow = el('div', 'hsk-glow', root);
  glow.hidden = true;

  // Touch buttons live on the layer itself, not in the root, so they stay tappable when the root's pointer events are off.
  const mkBtn = (cls, text, on) => {
    const b = el('button', `hsk-btn ${cls}`, extLayer(), text);
    b.type = 'button';
    b.hidden = true;
    const press = (down) => (e) => {
      if (e && e.cancelable) e.preventDefault();
      b.classList.toggle('is-down', down);
      if (down) on();
    };
    b.addEventListener('pointerdown', (e) => {
      try {
        b.setPointerCapture(e.pointerId);
      } catch (err) {
        /* a synthetic event in a test has no pointer to capture */
      }
      press(true)(e);
    });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, press(false));
    return b;
  };
  const fire = mkBtn('is-fire', 'FIRE<br>MSL<small>MSL 3/3</small>', () => handlers.fire && handlers.fire());
  fire.setAttribute('aria-label', 'Fire heat-seeking missile');
  const flare = mkBtn('is-flare', 'FLARES<small>8</small>', () => handlers.flares && handlers.flares());
  flare.setAttribute('aria-label', 'Drop flares');

  const arrows = [];
  const diamonds = [];
  for (let i = 0; i < 3; i++) {
    const a = el('div', 'hsk-arrow', threats, '<b></b>');
    a.hidden = true;
    arrows.push(a);
    const d = el('div', 'hsk-diamond', threats, '<b></b>');
    d.hidden = true;
    diamonds.push(d);
  }
  S.els = { root, panel, label, pips, flr, state, keys, seeker, lock, threats, alert, glow, fire, flare, arrows, diamonds, lockTag: lock.querySelector('.hsk-lock-tag'), lockBar: lock.querySelector('.hsk-lock-bar b') };
  return S.els;
}

/** The whole overlay on or off (not flying, hidden interface, paused...). */
export function show(on) {
  const e = S.els;
  if (!e) return;
  e.root.hidden = !on;
  if (!on) {
    e.fire.hidden = true;
    e.flare.hidden = true;
  }
}

export function setPanel(p) {
  const e = ensureHud();
  if (!e) return;
  e.panel.hidden = !p.show;
  if (!p.show) return;
  const text = `MSL ${p.left}/${p.max}`;
  if (e.label.textContent !== text) e.label.textContent = text;
  // An aeroplane with flares for the disaster but no missiles shows only the flares.
  const msl = p.msl !== false;
  e.label.parentNode.hidden = !msl;
  const key = `${p.left}/${p.max}|${p.flares}|${p.state}|${p.fireKey}|${p.flareKey}|${p.locked}|${msl}`;
  if (key === S.key) return;
  S.key = key;
  e.pips.innerHTML = Array.from({ length: p.max }, (_, i) => `<span class="hsk-pip${i >= p.left ? ' is-gone' : ''}"></span>`).join('');
  e.panel.classList.toggle('is-empty', p.left <= 0);
  e.panel.classList.toggle('is-locked', !!p.locked);
  e.flr.textContent = p.flares != null ? `FLR ${p.flares}` : '';
  e.flr.hidden = p.flares == null;
  e.state.textContent = p.state || '';
  e.keys.innerHTML = `${msl ? `<kbd>${p.fireKey}</kbd> fire` : ''}${msl && p.flares != null ? ' · ' : ''}${p.flares != null ? `<kbd>${p.flareKey}</kbd> flares` : ''}`;
  e.fire.querySelector('small').textContent = `MSL ${p.left}/${p.max}`;
  e.fire.classList.toggle('is-dim', p.left <= 0);
  e.flare.querySelector('small').textContent = String(p.flares == null ? '' : p.flares);
  e.flare.classList.toggle('is-dim', !(p.flares > 0));
}

export function setButtons({ fire, flares }) {
  const e = S.els;
  if (!e) return;
  e.fire.hidden = !fire;
  e.flare.hidden = !flares;
}

export function setSeeker(on, x, y, r) {
  const e = S.els;
  if (!e) return;
  e.seeker.hidden = !on;
  if (!on) return;
  e.seeker.style.width = e.seeker.style.height = `${Math.max(36, Math.min(220, r * 2))}px`;
  e.seeker.style.margin = `${-Math.max(36, Math.min(220, r * 2)) / 2}px 0 0 ${-Math.max(36, Math.min(220, r * 2)) / 2}px`;
  e.seeker.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
}

/** The lock box on a target at screen (x, y). state: 'acquire' | 'locked'. */
export function setLock(on, x = 0, y = 0, state = 'acquire', progress = 0, tag = '') {
  const e = S.els;
  if (!e) return;
  e.lock.hidden = !on;
  mergeGunBox(on, x, y);
  if (!on) return;
  e.lock.classList.toggle('is-locked', state === 'locked');
  e.lock.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  e.lockBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  if (e.lockTag.textContent !== tag) e.lockTag.textContent = tag;
}

/*
 * One lock marker on one target. The gunsight draws its own box on the
 * same drone, so a practice run showed two sets of corner brackets 12 px
 * apart and "LOCKED 760 m" twice. When the gun's box sits on our lock, its
 * brackets and words step back (CSS below; the box is still there for the
 * gunsight's own logic and its tests) and ours, which carry the missile's
 * lock bar, are the one marker. Read from the two transforms, never laid out.
 */
let gunBox = null;
function mergeGunBox(on, x, y) {
  if (typeof document === 'undefined') return;
  if (!gunBox || !gunBox.isConnected) gunBox = document.querySelector('.gsk-box');
  if (!gunBox) return;
  let merged = false;
  if (on && !gunBox.hidden) {
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(gunBox.style.transform || '');
    merged = !!m && Math.abs(Number(m[1]) - x) < 16 && Math.abs(Number(m[2]) - y) < 16;
  }
  if (gunBox.classList.contains('is-under-lock') !== merged) gunBox.classList.toggle('is-under-lock', merged);
}

/**
 * Incoming missiles. Each { onScreen, x, y, ang (radians from straight up, clockwise), range }.
 * On screen: a diamond on the missile. Off screen: an arrow on a ring round the middle pointing at it.
 */
export function setThreats(list, w, h) {
  const e = S.els;
  if (!e) return;
  e.threats.hidden = !list.length;
  const ring = Math.min(w, h) * 0.34;
  for (let i = 0; i < 3; i++) {
    const t = list[i];
    const a = e.arrows[i];
    const d = e.diamonds[i];
    if (!t) {
      a.hidden = true;
      d.hidden = true;
      continue;
    }
    const km = t.range >= 1000 ? `${(t.range / 1000).toFixed(1)} km` : `${Math.round(t.range / 10) * 10} m`;
    if (t.onScreen) {
      a.hidden = true;
      d.hidden = false;
      d.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) rotate(45deg)`;
      d.querySelector('b').textContent = km;
    } else {
      d.hidden = true;
      a.hidden = false;
      const cx = w / 2 + Math.sin(t.ang) * ring;
      const cy = h / 2 - Math.cos(t.ang) * ring;
      a.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px) rotate(${((t.ang * 180) / Math.PI).toFixed(1)}deg)`;
      const b = a.querySelector('b');
      b.textContent = km;
      // Keep the words upright whatever the arrow does.
      b.style.transform = `rotate(${((-t.ang * 180) / Math.PI).toFixed(1)}deg)`;
    }
  }
}

/** The banner ("MISSILE LAUNCH — break left and pop flares"). Empty text hides it. */
export function setAlert(text, sub = '') {
  const e = S.els;
  if (!e) return;
  e.alert.hidden = !text;
  if (!text) return;
  const html = `${text}${sub ? `<small>${sub}</small>` : ''}`;
  if (e.alert.__html !== html) {
    e.alert.__html = html;
    e.alert.innerHTML = html;
    keepOnScreen(e.alert);
  }
}

/**
 * Owner (Oct 25): the "MISSILE LAUNCH — break right…" notice was cut off at
 * the left edge. Centred on 50% it cannot be — unless something it lives in
 * is offset or scaled — so after every new text it is measured, and nudged
 * back inside the screen by however much it is out. Only on a text change.
 */
export function keepOnScreen(node, margin = 8) {
  if (!node || typeof node.getBoundingClientRect !== 'function' || typeof innerWidth !== 'number') return 0;
  node.style.marginLeft = '';
  const r = node.getBoundingClientRect();
  let dx = 0;
  if (r.left < margin) dx = margin - r.left;
  else if (r.right > innerWidth - margin) dx = innerWidth - margin - r.right;
  if (dx) node.style.marginLeft = `${Math.round(dx)}px`;
  return dx;
}

/**
 * The red edge glow while a missile is coming. With Reduce flashing on it
 * swells slowly and never goes over the full-screen cap; without, it
 * pulses at about one and a half hertz.
 */
export function setGlow(strength, t) {
  const e = S.els;
  if (!e) return;
  if (!(strength > 0)) {
    e.glow.hidden = true;
    return;
  }
  e.glow.hidden = false;
  const swell = blinkLevel(t, FLASH.reduce ? 1.8 : 0.7, 0.5, 0.35);
  e.glow.style.opacity = String(screenOpacity(Math.min(1, strength) * 0.5 * swell));
}

export function snapshot() {
  const e = S.els;
  if (!e) return null;
  // What a player would see: nothing at all while the whole overlay is down.
  const up = !e.root.hidden;
  return {
    visible: up,
    panelShown: up && !e.panel.hidden,
    count: e.label.textContent,
    flares: e.flr.textContent,
    fireKeys: e.keys.textContent,
    lockShown: up && !e.lock.hidden,
    lockLocked: up && !e.lock.hidden && e.lock.classList.contains('is-locked'),
    lockTag: e.lockTag.textContent,
    seekerShown: up && !e.seeker.hidden,
    alert: up && !e.alert.hidden ? e.alert.textContent : '',
    threatsShown: up && !e.threats.hidden,
    arrows: up ? e.arrows.filter((a) => !a.hidden).length : 0,
    diamonds: up ? e.diamonds.filter((a) => !a.hidden).length : 0,
    fireButton: up && !e.fire.hidden,
    flareButton: up && !e.flare.hidden,
  };
}

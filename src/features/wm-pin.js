/**
 * World Map — the pin's map: the whole world, the sea, the Border Range and the
 * Farlands, full screen, and a pin you drop on it.
 *
 * Opened from the World Map card (world-preview.js), which fetches this file
 * the first time, so nobody who never opens it pays for it. A click or a tap
 * drops the pin and another moves it; on the keyboard the arrow keys do, with
 * Shift for longer steps. A tap in the void comes back to the land's end
 * (worldmap/pin-far.js clampFar). The readout says the nearest field, how far,
 * and land, sea or the zone of the ring (worldmap/pin.js pinWords).
 *
 * The chart is the live map's (livemap/chart.js), which is why it looks the
 * same. On the menu the map loaded is usually another one, so nothing on this
 * thread can read this sea's heights: a worker of its own loads the World Map
 * for the chart and answers the land-or-sea question. It is not the live map's
 * shared worker, because that one holds the live map's tiles for a later open.
 * With no worker at all the islands' circles stand in (pin.js roughHeightAt).
 */

import { ChartTiles } from './livemap/chart.js';
import { AIRPORTS, PREVIEW, previewDef } from '../world/worldmap/preview.js';
import { pinWords, roughHeightAt, fieldAt } from '../world/worldmap/pin.js';
import { clampFar, namesThatFit, zoneOf } from '../world/worldmap/pin-far.js';
import { FARLANDS } from '../world/worldmap/farlands.js';

/** Arrow-key steps, metres; how long land or sea waits for the worker. */
const STEP_M = 1000;
const STEP_LONG_M = 8000;
const ASK_MS = 2500;
const HINT = 'Tap anywhere, sea or mountains, to drop a pin. Tap again to move it.';

const CSS = `
.wpp { position: fixed; inset: 0; z-index: 140; display: flex; flex-direction: column; background: #0b1522; color: var(--text, #eaf1fb);
  font: 14px var(--font, system-ui), sans-serif; padding: env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left); }
.wpp-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 6px 12px; }
.wpp-head h3 { margin: 0; font: 700 17px var(--font, system-ui), sans-serif; }
.wpp button { min-height: 44px; min-width: 44px; padding: 8px 14px; border-radius: 10px; border: 1px solid var(--panel-line, rgba(255,255,255,0.18));
  background: rgba(255,255,255,0.06); color: inherit; font: 600 14px var(--font, system-ui), sans-serif; cursor: pointer; }
.wpp button.primary { background: var(--accent, #4aa3ff); border-color: var(--accent, #4aa3ff); color: #06121f; }
.wpp button[disabled] { opacity: 0.5; cursor: default; }
.wpp button[hidden] { display: none; }
.wpp button:focus-visible, .wpp canvas:focus-visible { outline: 2px solid #ffd166; outline-offset: -2px; }
.wpp-main { flex: 1; min-height: 0; display: flex; gap: 12px; padding: 0 12px 12px; }
.wpp-map { flex: 1; min-width: 0; min-height: 0; position: relative; border-radius: 12px; overflow: hidden; }
.wpp-map canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: crosshair; touch-action: manipulation; }
.wpp-side { width: 280px; flex: none; display: flex; flex-direction: column; gap: 6px; }
.wpp-side p { margin: 0; }
.wpp-title { font-weight: 700; font-size: 16px; }
.wpp-hint { opacity: 0.75; font-size: 13px; }
.wpp-acts { display: flex; gap: 8px; margin-top: auto; padding-top: 8px; }
.wpp-acts .primary { flex: 1; }
@media (max-width: 560px), (orientation: portrait) {
  .wpp-main { flex-direction: column; }
  .wpp-side { width: auto; min-height: 150px; }
}
`;

function injectStyle() {
  if (document.getElementById('wpp-style')) return;
  const st = document.createElement('style');
  st.id = 'wpp-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/** Land or sea with no worker: the ring has its own sums, cheap enough for a chart. */
const roughAt = (x, z) => (FARLANDS.past(x, z) ? FARLANDS.height(x, z) : roughHeightAt(x, z));

function makeWorker() {
  try {
    if (typeof Worker === 'function') return new Worker(new URL('./livemap/chart-worker.js', import.meta.url), { type: 'module' });
  } catch (e) {
    /* no module workers: the islands' circles */
  }
  return null;
}

/**
 * @param {object} o
 *   quality   the graphics tier (the chart's budget)
 *   pin       the pin so far, or null
 *   onPin     told every pin: { x, z, h } (h null until the ground is known), or null when it is taken up
 *   onFly     Fly here
 *   onClose   the map has gone
 * @returns {{ close: function, el: HTMLElement }}
 */
export function openPinMap({ quality = 'medium', pin = null, onPin, onFly, onClose }) {
  injectStyle();
  const el = document.createElement('div');
  el.className = 'wpp';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.setAttribute('aria-label', 'Pick a spot on the map');
  el.setAttribute('data-wp-pinmap', '');
  // Focusable, so Esc still reaches it after a click on the words.
  el.tabIndex = -1;
  el.innerHTML = `
    <div class="wpp-head"><h3>Pick a spot</h3><button type="button" data-wpp-close>Back</button></div>
    <div class="wpp-main">
      <div class="wpp-map"><canvas tabindex="0" role="application" aria-label="Map of the world. Tap to drop a pin, or use the arrow keys. Shift moves it further."></canvas></div>
      <div class="wpp-side">
        <p class="wpp-title" data-wpp-title aria-live="polite">No pin yet</p>
        <p data-wpp-where aria-live="polite"></p>
        <p class="wpp-hint" data-wpp-hint>${HINT}</p>
        <div class="wpp-acts">
          <button type="button" data-wpp-clear hidden>Remove pin</button>
          <button type="button" class="primary" data-wpp-fly disabled>Fly here</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const cv = el.querySelector('canvas');
  const g = cv.getContext('2d');
  // All of it, as the live map has it (livemap/places.js), told to the worker whether or not the World Map has been chosen yet.
  const half = FARLANDS.chartHalf;
  const size = half * 2;
  const def = { ...previewDef(), farlands: true };
  const worker = makeWorker();
  const chart = new ChartTiles({
    box: { x0: -half, z0: -half, size },
    heightAt: roughAt,
    def,
    palette: PREVIEW.palette,
    flats: PREVIEW.flats,
    quality,
    seaFloor: FARLANDS.voidH,
    worker: worker || false,
  });
  const view = { cx: 0, cz: 0, s: 1, W: 1, H: 1, dpr: 1 };
  const X = (x) => view.W / 2 + (x - view.cx) * view.s;
  const Z = (z) => view.H / 2 + (z - view.cz) * view.s;

  let dirty = true;
  let raf = 0;
  let last = performance.now();
  let builtAt = 0;
  let built = 0;
  let closed = false;

  function measure() {
    const r = cv.parentElement.getBoundingClientRect();
    view.W = Math.max(1, r.width);
    view.H = Math.max(1, r.height);
    view.dpr = Math.min(2, window.devicePixelRatio || 1);
    view.s = Math.min(view.W, view.H) / size;
    cv.width = Math.round(view.W * view.dpr);
    cv.height = Math.round(view.H * view.dpr);
    dirty = true;
  }

  function paint() {
    g.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    chart.draw(g, view);
    g.font = '600 10px "Jost", Arial, sans-serif';
    g.textAlign = 'center';
    g.lineJoin = 'round';
    for (const a of AIRPORTS) {
      const px = X(a.x);
      const py = Z(a.z);
      g.fillStyle = '#fff';
      g.fillRect(px - 4, py - 1.5, 8, 3);
      g.strokeStyle = 'rgba(6,18,31,0.85)';
      g.lineWidth = 3;
      g.strokeText(a.code, px, py - 5);
      g.fillStyle = '#fff';
      g.fillText(a.code, px, py - 5);
    }
    // The ring's names, the live map's (farlands.js labels).
    const sized = (name, x, y) => ({ name, x, y, w: g.measureText(name).width });
    const codes = AIRPORTS.map((a) => sized(a.code, X(a.x), Z(a.z) - 8));
    for (const l of namesThatFit(FARLANDS.labels.map((n) => sized(n.name, X(n.x), Z(n.z))), view.W, view.H, codes)) {
      g.strokeStyle = 'rgba(6,18,31,0.85)';
      g.lineWidth = 3;
      g.strokeText(l.name, l.x, l.y);
      g.fillStyle = 'rgba(255,255,255,0.8)';
      g.fillText(l.name, l.x, l.y);
    }
    if (!pin) return;
    const px = X(pin.x);
    const py = Z(pin.z);
    const w = pinWords(pin.x, pin.z);
    if (!w.field) {
      g.strokeStyle = 'rgba(255,255,255,0.8)';
      g.lineWidth = 1.5;
      g.setLineDash([5, 5]);
      g.beginPath();
      g.moveTo(px, py);
      g.lineTo(X(w.near.x), Z(w.near.z));
      g.stroke();
      g.setLineDash([]);
    }
    g.fillStyle = '#ffd166';
    g.strokeStyle = '#06121f';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(px, py - 16, 8, Math.PI * 0.85, Math.PI * 0.15);
    g.lineTo(px, py);
    g.closePath();
    g.fill();
    g.stroke();
    g.fillStyle = '#06121f';
    g.beginPath();
    g.arc(px, py - 16, 3, 0, Math.PI * 2);
    g.fill();
  }

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    if (chart.stats.built !== built) {
      built = chart.stats.built;
      builtAt = now;
    }
    // Nothing to do once the chart is whole and has faded in.
    const busy = !chart.readyFor(view) || now - builtAt < 400;
    if (!busy && !dirty) return;
    chart.pump(dt);
    paint();
    dirty = false;
  }

  const q = {
    title: el.querySelector('[data-wpp-title]'),
    where: el.querySelector('[data-wpp-where]'),
    hint: el.querySelector('[data-wpp-hint]'),
    fly: el.querySelector('[data-wpp-fly]'),
    clear: el.querySelector('[data-wpp-clear]'),
  };

  function words() {
    q.fly.disabled = !pin;
    q.clear.hidden = !pin;
    if (!pin) {
      q.title.textContent = 'No pin yet';
      q.where.textContent = '';
      q.hint.textContent = HINT;
      return;
    }
    const w = pinWords(pin.x, pin.z, pin.h, pin.zone);
    q.title.textContent = w.title;
    q.where.textContent = w.where;
    q.hint.textContent = w.note;
  }

  /* ---- land or sea, from the worker ---- */
  let asked = 0;
  let askT = 0;
  function answer(id, h) {
    if (id !== asked || !pin) return;
    clearTimeout(askT);
    pin = { ...pin, h: Number.isFinite(h) ? h : 0 };
    onPin(pin);
    words();
  }
  function ask() {
    const id = ++asked;
    const { x, z } = pin;
    clearTimeout(askT);
    if (fieldAt(x, z)) return;
    if (!worker) return answer(id, roughAt(x, z));
    askT = setTimeout(() => answer(id, roughAt(x, z)), ASK_MS);
    worker.postMessage({ op: 'height', seq: chart.seq, key: id, x, z });
    return undefined;
  }
  const onWorker = (ev) => {
    const m = ev.data;
    if (m && m.op === 'height') answer(m.key, m.error ? roughAt(pin ? pin.x : 0, pin ? pin.z : 0) : m.h);
  };
  if (worker) worker.addEventListener('message', onWorker);

  function setPin(x, z) {
    const at = clampFar(x, z);
    pin = { ...at, h: null, zone: zoneOf(at.x, at.z) };
    onPin(pin);
    words();
    ask();
    dirty = true;
  }

  cv.addEventListener('click', (e) => {
    const r = cv.getBoundingClientRect();
    setPin(view.cx + (e.clientX - r.left - view.W / 2) / view.s, view.cz + (e.clientY - r.top - view.H / 2) / view.s);
  });
  cv.addEventListener('keydown', (e) => {
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!dir) return;
    const step = e.shiftKey ? STEP_LONG_M : STEP_M;
    const from = pin || { x: view.cx, z: view.cz };
    setPin(from.x + dir[0] * step, from.z + dir[1] * step);
    e.preventDefault();
  });

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(raf);
    clearTimeout(askT);
    removeEventListener('resize', measure);
    chart.dispose();
    if (worker) worker.terminate();
    el.remove();
    onClose();
  }

  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-wpp-close]')) close();
    else if (e.target.closest('[data-wpp-clear]')) {
      pin = null;
      asked++;
      onPin(null);
      words();
      dirty = true;
      cv.focus();
    } else if (e.target.closest('[data-wpp-fly]') && pin) {
      close();
      onFly();
    }
  });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      // The screen is the only thing there: the keyboard stays on it.
      const all = [...el.querySelectorAll('button:not([disabled]):not([hidden]), canvas')];
      const i = all.indexOf(document.activeElement);
      const next = all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length];
      next.focus();
      e.preventDefault();
    }
  });
  addEventListener('resize', measure);

  measure();
  words();
  if (pin) ask();
  cv.focus();
  raf = requestAnimationFrame(frame);
  return { close, el, chart, view, frame };
}

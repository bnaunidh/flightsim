/**
 * The full-screen LIVE map, on every map.
 *
 * The owner, 2026-10-26: "if i press a keybind itll expand worldmap fully",
 * "opening map shouldnt pause game, in the background it should show it isnt
 * paused", "make this look nicer", "the more u zoom in the more details".
 *
 *   OPEN      5 (the `worldMap` action, rebindable: M is the mute key, so it
 *             is not taken), the minimap itself (tap or click it), the World
 *             Map preview's MAP button and its pause-screen button. 5 again,
 *             Esc or the ✕ closes it. In a game with friends 5 is a quick
 *             chat line, as it always was; the minimap still opens it.
 *   LIVE      it never pauses anything: the 3D view keeps moving round a
 *             glass panel, a LIVE readout (height, speed, heading, the
 *             autopilot) ticks, your arrow moves, the keys and a joystick
 *             keep flying (the mouse is the map's while it is open: input.js
 *             mapOpen), the autopilot keeps flying, multiplayer and the sim
 *             rate carry on. A PULL UP, a stall, a fire or the other urgent
 *             warnings (URGENT) close it, with a toast saying why.
 *   CHART     chart.js (tiles per zoom level, built in a worker) under
 *             render.js (everything else, by level of detail): wheel, pinch
 *             and drag pan and zoom round the cursor or the fingers.
 *   PICK      tap a place (an airport, a fix, a town, a heliport) or
 *             anywhere (a pin, with its latitude and longitude): the card
 *             says what it is, how far, which way and how long.
 *
 * What other parts plug in (nav.js: DIRECT TO and the flight plan) —
 *   addMapPanel({ id, order, html, bind, sync })   a section of the side panel
 *   addSelectionAction({ id, label, order, primary, visible, run })   a button on the card
 *   addMapState(fn(sim, st))                        draw state (the route)
 *   addPickSource(fn(sim) → waypoints)              more things a tap can pick
 *   addMapLayer(fn(g, view, sim))                   drawn over the rest (the regional weather)
 */

import { registerExtension, registerActions } from '../../game/extensions.js';
import { isKey } from '../../flight/input.js';
import { MAP, heightAt, FLATS, PALETTE } from '../../world/terrain.js';
import { icon } from '../../ui/icons.js';
import { ChartTiles } from './chart.js';
import { drawLayers, drawFurniture, LabelPlacer } from './render.js';
import { collectPlaces, carrierOf } from './places.js';
import * as G from './geo.js';

registerActions({
  worldMap: { label: 'Full-screen map (any map; 5 again or Esc closes it)', group: 'Game', ctx: ['plane', 'heli', 'boat', 'car'], default: ['Digit5'] },
});

const KT = 1.94384;
/**
 * The warnings that close the map: the ones you must be looking out of the window for — every red
 * one (warnings-rules.js level 'warning'). The map sits over the warnings panel, so a red one left
 * out (ENGINE FAIL, GEAR NOT DOWN were) lit up unseen behind it.
 */
export const URGENT = Object.freeze(['pullup', 'windshear', 'terrain', 'tcasRA', 'stall', 'gear', 'engineFire', 'engineFail', 'overspeed']);
const WARN_WORDS = { pullup: 'PULL UP', windshear: 'WINDSHEAR', terrain: 'TERRAIN', tcasRA: 'TRAFFIC — CLIMB', stall: 'STALL', gear: 'GEAR NOT DOWN', engineFire: 'ENGINE FIRE', engineFail: 'ENGINE FAIL', overspeed: 'OVERSPEED' };

const S = {
  sim: null,
  ui: null,
  open: false,
  P: null,
  pKey: null,
  chart: null,
  chartKey: null,
  view: null,
  target: null,
  follow: false,
  fitted: null,
  sel: null,
  pin: null,
  drawAcc: 1,
  readAcc: 1,
  sideAcc: 1,
  clock: 0,
  openedFor: 0,
  placer: new LabelPlacer(),
  pointers: new Map(),
  drag: null,
  pinch: null,
  dpr: 1,
  W: 0,
  H: 0,
  lastStats: null,
  closedBy: null,
};

/** What other modules plug in (nav.js). */
const EXT = { panels: [], actions: [], states: [], picks: [], layers: [] };
export function addMapPanel(p) {
  EXT.panels.push(p);
  EXT.panels.sort((a, b) => a.order - b.order);
}
export function addSelectionAction(a) {
  EXT.actions.push(a);
  EXT.actions.sort((x, y) => x.order - y.order);
}
/** A layer drawn over the map's own (the regional weather, features/wx-map.js): fn(g, view, sim). */
export function addMapLayer(fn) {
  EXT.layers.push(fn);
}
export function addMapState(fn) {
  EXT.states.push(fn);
}
export function addPickSource(fn) {
  EXT.picks.push(fn);
}

/* ------------------------------------------------------------------ */
/* Who and where                                                       */
/* ------------------------------------------------------------------ */

function quality(sim) {
  return (sim.settings && sim.settings.quality) || 'medium';
}
function lowTier(sim) {
  return quality(sim) === 'low';
}

/** You: the aircraft, or the boat or the van while driving. */
export function meOf(sim) {
  const drive = sim.mode === 'drive' && sim.vehicle;
  const b = drive ? sim.vehicle : sim.aircraft;
  if (!b || !b.pos) return null;
  let hdg = 0;
  let gsMs = 0;
  let altFt = 0;
  let iasKts = 0;
  if (drive) {
    const r = typeof b.readouts === 'function' ? b.readouts() : {};
    hdg = Number.isFinite(r.heading) ? r.heading : Number.isFinite(b.heading) ? b.heading : 0;
    gsMs = Number.isFinite(r.speedKts) ? r.speedKts / KT : Math.hypot((b.vel && b.vel.x) || 0, (b.vel && b.vel.z) || 0);
  } else {
    const r = b.readouts();
    hdg = r.heading;
    gsMs = b.groundSpeed || 0;
    altFt = r.altFt;
    iasKts = r.iasKts;
  }
  return { x: b.pos.x, z: b.pos.z, hdg, gsMs, gsKts: gsMs * KT, altFt, iasKts, drive: !!drive };
}

/** The map's places (places.js), rebuilt when the map changes. */
export function placesOf(sim) {
  const key = `${MAP && MAP.id}|${MAP && MAP.name}`;
  if (!S.P || S.pKey !== key) {
    S.P = collectPlaces(sim);
    S.pKey = key;
  }
  return S.P;
}

function chart(sim) {
  const P = placesOf(sim);
  const key = `${S.pKey}|${quality(sim)}`;
  if (!S.chart || S.chartKey !== key) {
    if (S.chart) S.chart.dispose();
    S.chart = new ChartTiles({ box: P.box, heightAt, def: MAP, palette: PALETTE, flats: FLATS, quality: quality(sim), seaFloor: MAP && MAP.seaFloor });
    S.chartKey = key;
  }
  return S.chart;
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const CSS = `
.lm { position: fixed; inset: 0; z-index: 85; pointer-events: auto; color: #eaf2f8; font: 500 13.5px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  padding: max(12px, 2.2vh) max(12px, 2.2vw); background: rgba(4, 9, 16, 0.16); }
.lm[hidden] { display: none; }
.lm-panel { position: relative; width: 100%; height: 100%; border-radius: 18px; overflow: hidden; background: rgba(12, 30, 48, 0.5);
  box-shadow: 0 18px 60px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.14) inset; }
.lm:not(.is-lite) .lm-panel { backdrop-filter: blur(3px); -webkit-backdrop-filter: blur(3px); }
.lm-cv { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; opacity: 0.95; }
.lm-cv.is-grab { cursor: grabbing; }
.lm-glass { background: rgba(10, 20, 32, 0.66); border: 1px solid rgba(255,255,255,0.14); border-radius: 14px; box-shadow: 0 8px 30px rgba(0,0,0,0.3); }
.lm:not(.is-lite) .lm-glass { backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); background: rgba(10, 20, 32, 0.52); }
.lm-top { position: absolute; top: 12px; left: 12px; right: 12px; display: flex; align-items: center; gap: 10px; pointer-events: none; }
.lm-top > * { pointer-events: auto; }
.lm-btn { min-width: 44px; min-height: 44px; border-radius: 12px; border: 1px solid rgba(255,255,255,0.2); background: rgba(10, 20, 32, 0.7); color: #fff;
  font: 700 15px system-ui, sans-serif; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 0 10px; }
.lm-btn:hover { background: rgba(30, 48, 66, 0.85); }
.lm-btn:focus-visible, .lm button:focus-visible, .lm input:focus-visible { outline: 2px solid #8fd0ff; outline-offset: 2px; }
.lm-title { padding: 8px 14px; line-height: 1.15; }
.lm-title b { display: block; font-size: 14px; }
.lm-title span { font-size: 11px; opacity: 0.7; letter-spacing: 0.06em; text-transform: uppercase; }
.lm-live { margin: 0 auto; padding: 9px 14px; display: flex; align-items: center; gap: 10px; font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
.lm-live .lm-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff4f5e; box-shadow: 0 0 0 3px rgba(255,79,94,0.22); animation: lm-pulse 2.4s ease-in-out infinite; }
.lm-live .lm-word { font-weight: 800; letter-spacing: 0.12em; font-size: 11.5px; }
.lm-live .lm-ap { color: #f6a5f4; font-weight: 700; }
@keyframes lm-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
html.reduce-motion .lm-live .lm-dot { animation: none; }
@media (prefers-reduced-motion: reduce) { .lm-live .lm-dot { animation: none; } }
.lm-zoom { position: absolute; left: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 8px; }
.lm-zoom .lm-btn.is-on { border-color: #ffd640; color: #ffd640; }
.lm-side { position: absolute; top: 68px; right: 12px; bottom: 60px; width: min(340px, 42%); overflow: auto; padding: 12px 14px; display: flex; flex-direction: column; gap: 12px; }
.lm-side h4 { margin: 0 0 6px; font: 800 10.5px system-ui, sans-serif; letter-spacing: 0.12em; opacity: 0.72; display: flex; align-items: center; gap: 8px; }
.lm-side h4 button { margin-left: auto; }
.lm-pos { font: 600 13px ui-monospace, "SF Mono", Menlo, monospace; letter-spacing: 0.02em; }
.lm-sub { font-size: 11.5px; opacity: 0.7; font-variant-numeric: tabular-nums; }
.lm-selname { font-size: 16px; font-weight: 700; }
.lm-facts { font-variant-numeric: tabular-nums; margin-top: 3px; }
.lm-btns { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.lm-btns:empty { display: none; }
.lm-side button { min-height: 40px; padding: 6px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.08);
  color: #fff; font: 700 12.5px system-ui, sans-serif; letter-spacing: 0.04em; cursor: pointer; }
.lm-side button.lm-primary { background: #e83ee6; border-color: #f07af0; }
.lm-side button.lm-small { min-height: 30px; padding: 3px 9px; font-size: 11px; }
.lm-places { display: flex; flex-direction: column; gap: 4px; }
.lm-places h5 { margin: 6px 0 2px; font: 700 10.5px system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; opacity: 0.6; }
.lm-places button { text-align: left; display: flex; flex-direction: column; gap: 1px; font-weight: 600; letter-spacing: 0; }
.lm-places button small { font-weight: 500; opacity: 0.72; font-variant-numeric: tabular-nums; }
.lm-places button.is-sel { border-color: #8fd0ff; background: rgba(143, 208, 255, 0.14); }
.lm-sheet-toggle { display: none; }
html.lm-tap #ui > .minimap { pointer-events: auto; cursor: zoom-in; }
@media (max-width: 760px), (max-height: 520px) {
  .lm { padding: 6px; }
  .lm-panel { border-radius: 14px; }
  .lm-live { font-size: 11.5px; padding: 7px 10px; gap: 7px; }
  .lm-live .lm-extra { display: none; }
  .lm-title { display: none; }
  .lm-side { top: auto; left: 8px; right: 8px; bottom: 8px; width: auto; max-height: 46%; padding: 8px 12px 12px; }
  .lm-side.is-folded { max-height: 58px; overflow: hidden; }
  .lm-sheet-toggle { display: flex; justify-content: center; align-items: center; min-height: 40px !important; padding: 0 !important; border: 0 !important; background: transparent !important; }
  .lm-sheet-toggle i { width: 44px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.45); display: block; }
  .lm-zoom { bottom: auto; top: 64px; }
}
@media (max-height: 520px) and (min-width: 600px) {
  .lm-side { top: 60px; left: auto; right: 8px; bottom: 8px; width: min(320px, 46%); max-height: none; }
  .lm-side.is-folded { max-height: none; }
  .lm-sheet-toggle { display: none !important; }
}
.lm-loading { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); padding: 8px 14px; font-size: 12px; opacity: 0.85; pointer-events: none; }
.lm-loading[hidden] { display: none; }
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('lm-style')) return;
  const st = document.createElement('style');
  st.id = 'lm-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

function build(sim) {
  if (S.ui) return S.ui;
  injectStyle();
  const root = document.createElement('div');
  root.className = 'lm';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'Map');
  root.innerHTML = `
    <div class="lm-panel">
      <canvas class="lm-cv" data-lm-cv aria-label="Chart: tap a place, or anywhere for a pin"></canvas>
      <div class="lm-loading lm-glass" data-lm-loading hidden>Drawing the chart…</div>
      <div class="lm-top">
        <button type="button" class="lm-btn lm-close" data-lm="close" aria-label="Close the map">${icon('close', 18)}</button>
        <div class="lm-title lm-glass"><b data-lm-title>Map</b><span>Live chart</span></div>
        <div class="lm-live lm-glass" aria-live="off"><i class="lm-dot" aria-hidden="true"></i><span class="lm-word">LIVE</span><span data-lm-read></span></div>
      </div>
      <div class="lm-zoom">
        <button type="button" class="lm-btn" data-lm="in" aria-label="Zoom in">+</button>
        <button type="button" class="lm-btn" data-lm="out" aria-label="Zoom out">−</button>
        <button type="button" class="lm-btn" data-lm="fit" aria-label="The whole map">${icon('map', 18)}</button>
        <button type="button" class="lm-btn" data-lm="me" aria-label="Follow me">${icon('target', 18)}</button>
      </div>
      <aside class="lm-side lm-glass" data-lm-side>
        <button type="button" class="lm-sheet-toggle" data-lm="sheet" aria-label="Show or hide the details"><i></i></button>
        <section data-lm-panel="you" style="order:10">
          <h4>YOU</h4>
          <div class="lm-pos" data-lm-you></div>
          <div class="lm-sub" data-lm-grid></div>
        </section>
        <section data-lm-selsec hidden style="order:20">
          <h4 data-lm-selkind>PIN</h4>
          <div class="lm-selname" data-lm-selname></div>
          <div class="lm-pos" data-lm-selpos></div>
          <div class="lm-sub" data-lm-selmore></div>
          <div class="lm-facts" data-lm-selfacts></div>
          <div class="lm-btns" data-lm-selbtns></div>
        </section>
        <section data-lm-panel="places" style="order:90">
          <h4>PLACES</h4>
          <div class="lm-places" data-lm-places></div>
        </section>
      </aside>
    </div>`;
  document.body.appendChild(root);
  const q = (s) => root.querySelector(s);
  const ui = {
    root,
    cv: q('[data-lm-cv]'),
    loading: q('[data-lm-loading]'),
    title: q('[data-lm-title]'),
    read: q('[data-lm-read]'),
    side: q('[data-lm-side]'),
    you: q('[data-lm-you]'),
    grid: q('[data-lm-grid]'),
    selsec: q('[data-lm-selsec]'),
    selkind: q('[data-lm-selkind]'),
    selname: q('[data-lm-selname]'),
    selpos: q('[data-lm-selpos]'),
    selmore: q('[data-lm-selmore]'),
    selfacts: q('[data-lm-selfacts]'),
    selbtns: q('[data-lm-selbtns]'),
    places: q('[data-lm-places]'),
    btn: (k) => q(`[data-lm="${k}"]`),
    panels: {},
    last: {},
  };
  S.ui = ui;
  // The plug-ins' sections (nav.js: the flight plan, GO TO), in their order.
  for (const p of EXT.panels) {
    const sec = document.createElement('section');
    sec.setAttribute('data-lm-panel', p.id);
    sec.style.order = String(p.order);
    sec.innerHTML = p.html();
    ui.side.appendChild(sec);
    ui.panels[p.id] = sec;
    if (p.bind) p.bind(sec, sim);
  }
  root.addEventListener('click', (e) => onClick(sim, e));
  wirePointer(sim, ui.cv);
  window.addEventListener('resize', () => {
    if (S.open) S.drawAcc = 1;
  });
  return ui;
}

function onClick(sim, e) {
  const place = e.target.closest('[data-lm-place]');
  if (place) {
    const w = findById(sim, place.dataset.lmPlace);
    if (w) select(sim, w, true);
    return;
  }
  const act = e.target.closest('[data-lm-act]');
  if (act) {
    const a = EXT.actions.find((x) => x.id === act.dataset.lmAct);
    if (a && S.sel) a.run(sim, S.sel);
    refresh(sim, true);
    return;
  }
  const b = e.target.closest('[data-lm]');
  if (!b) return;
  const k = b.dataset.lm;
  const v = S.target;
  if (k === 'close') return close(sim);
  if (k === 'in' && v) return zoomAt(1.6, S.W / 2, S.H / 2);
  if (k === 'out' && v) return zoomAt(1 / 1.6, S.W / 2, S.H / 2);
  if (k === 'fit') {
    S.follow = false;
    fit(sim);
    syncFollow();
    return;
  }
  if (k === 'me') {
    S.follow = !S.follow;
    const me = meOf(sim);
    if (S.follow && me && v) {
      v.cx = me.x;
      v.cz = me.z;
      v.s = Math.max(v.s, 1 / 60);
    }
    syncFollow();
    return;
  }
  if (k === 'sheet') {
    S.ui.side.classList.toggle('is-folded');
    S.reservedAt = -1;
    return;
  }
  if (k === 'unpin') {
    S.sel = null;
    S.pin = null;
    refresh(sim, true);
    return;
  }
  if (k === 'start' && S.sel && sim.worldPreview) {
    const ref = S.sel.ref;
    close(sim);
    sim.worldPreview.choose(ref);
  }
}

function syncFollow() {
  const b = S.ui && S.ui.btn('me');
  if (b) b.classList.toggle('is-on', S.follow);
}

/* ------------------------------------------------------------------ */
/* Selection and pins                                                  */
/* ------------------------------------------------------------------ */

/** Everything a tap or the list can pick, as waypoints: { id, name, long, x, z, kind, ref? }. */
export function waypointsOf(sim) {
  const P = placesOf(sim);
  const out = [];
  for (const a of P.airports) out.push({ id: `apt:${a.id}`, name: a.code, long: a.name, x: a.x, z: a.z, kind: 'airport', ref: a.id, region: a.region, a });
  for (const f of P.fixes) out.push({ id: f.id, name: f.name, long: f.role === 'approach' ? 'Approach fix' : 'En-route fix', x: f.x, z: f.z, kind: 'fix' });
  for (const t of P.towns) out.push({ id: t.id, name: t.name, long: 'Town', x: t.x, z: t.z, kind: 'town' });
  for (const h of P.heliports) out.push({ id: h.id, name: h.name, long: 'Heliport', x: h.x, z: h.z, kind: 'heliport' });
  return out;
}

export function findById(sim, id) {
  return waypointsOf(sim).find((w) => w.id === id) || null;
}

/** Centre the view on (x, z) (stops following you). */
export function centreOn(x, z) {
  if (!S.target) return;
  S.follow = false;
  S.target.cx = x;
  S.target.cz = z;
  syncFollow();
}

/** Select a waypoint (and centre on it when it came from the list). */
export function select(sim, w, centre = false) {
  S.sel = w;
  S.pin = w && w.kind === 'pin' ? { x: w.x, z: w.z } : null;
  if (centre && w) centreOn(w.x, w.z);
  if (S.ui) S.ui.side.classList.remove('is-folded');
  refresh(sim, true);
  S.drawAcc = 1;
  return w;
}

/** A pin anywhere: its name is its position. */
export function pinAt(sim, x, z) {
  const P = placesOf(sim);
  const ll = G.toLatLon(x, z, P.origin);
  const w = { id: `pin:${Math.round(x)},${Math.round(z)}`, name: 'PIN', long: G.fmtLatLon(ll.lat, ll.lon), x, z, kind: 'pin' };
  return select(sim, w);
}

/** The nearest thing under a tap (within 22 px), else a pin there. */
export function pickAt(sim, sx, sy) {
  const v = S.view;
  if (!v) return null;
  const wx = v.cx + (sx - v.W / 2) / v.s;
  const wz = v.cz + (sy - v.H / 2) / v.s;
  const mpp = 1 / v.s;
  let best = null;
  let bd = 22;
  const P = placesOf(sim);
  const fixUntil = P.isPreview ? 160 : 45;
  const consider = (w) => {
    const d = Math.hypot((w.x - wx) * v.s, (w.z - wz) * v.s) - (w.kind === 'airport' ? 6 : 0);
    if (d < bd) {
      bd = d;
      best = w;
    }
  };
  for (const w of waypointsOf(sim)) {
    if (w.kind === 'fix' && mpp > fixUntil) continue;
    if ((w.kind === 'heliport' || w.kind === 'town') && mpp > 90) continue;
    consider(w);
  }
  for (const f of EXT.picks) for (const w of f(sim) || []) consider(w);
  if (best) return select(sim, best);
  return pinAt(sim, wx, wz);
}

/* ------------------------------------------------------------------ */
/* The side panel                                                      */
/* ------------------------------------------------------------------ */

export function kindWord(w) {
  if (w.kind === 'airport') {
    const a = w.a;
    if (!a) return 'Airport';
    return a.kind === 'hub' ? 'International airport' : a.kind === 'regional' ? 'Regional airport' : a.kind === 'remote' ? 'Long-haul outpost' : 'Airstrip';
  }
  return w.kind === 'fix' ? w.long || 'Fix' : w.kind === 'town' ? 'Town' : w.kind === 'heliport' ? 'Heliport' : w.kind === 'pin' ? 'Pin' : 'Waypoint';
}

/** Bring the side panel up to date (`structure`: rebuild its lists, not only the numbers). */
export function refresh(sim, structure = false) {
  const ui = S.ui;
  if (!ui || !sim) return;
  const P = placesOf(sim);
  const me = meOf(sim);
  if (!me) return;
  const ll = G.toLatLon(me.x, me.z, P.origin);
  ui.you.textContent = G.fmtLatLon(ll.lat, ll.lon);
  ui.grid.textContent = G.gridText(me.x, me.z);
  const w = S.sel;
  ui.selsec.hidden = !w;
  if (w) {
    const d = G.distM(me.x, me.z, w.x, w.z);
    if (structure || ui.last.selId !== w.id) {
      ui.last.selId = w.id;
      const wl = G.toLatLon(w.x, w.z, P.origin);
      ui.selkind.textContent = kindWord(w).toUpperCase();
      ui.selname.textContent = w.kind === 'airport' ? `${w.name} · ${w.long}` : w.kind === 'pin' ? 'Dropped pin' : w.name;
      ui.selpos.textContent = G.fmtLatLon(wl.lat, wl.lon);
      let more = G.gridText(w.x, w.z);
      if (w.kind === 'airport' && w.a) {
        const a = w.a;
        const z = P.zones.find((q) => q.field === a.id);
        more = `${a.runways.map((r) => `${r.ident} ${Math.round(r.length).toLocaleString('en-GB')} m`).join(' · ')} · ${Math.round((a.elev || 0) * 3.28084)} ft${z ? ` · APP ${z.freq}` : ''}`;
      }
      ui.selmore.textContent = more;
      const dep = P.isPreview && sim.worldPreview && sim.worldPreview.built ? sim.worldPreview.built() : null;
      const btns = EXT.actions.filter((a) => a.visible(sim, w, me)).map((a) => `<button type="button" class="${a.primary ? 'lm-primary' : ''}" data-lm-act="${a.id}">${a.label}</button>`);
      if (w.kind === 'airport' && P.isPreview && dep && dep.id !== w.ref) btns.push('<button type="button" data-lm="start">START HERE</button>');
      btns.push(`<button type="button" data-lm="unpin" aria-label="Clear the selection">${icon('close', 14)}</button>`);
      ui.selbtns.innerHTML = btns.join('');
    }
    ui.selfacts.textContent = `${G.fmtKm(d)} (${G.fmtNm(d)}) · ${G.fmtBrg(G.bearingDeg(me.x, me.z, w.x, w.z))} · ETA ${G.fmtEta(G.etaMin(d, me.gsKts))}`;
  }
  for (const p of EXT.panels) if (p.sync) p.sync(sim, ui.panels[p.id], structure, me);
  syncPlaces(sim, me, structure);
}

function syncPlaces(sim, me, structure) {
  const ui = S.ui;
  const P = placesOf(sim);
  const list = waypointsOf(sim);
  const rows = (ws) => ws.map((w) => {
    const d = G.distM(me.x, me.z, w.x, w.z);
    return `<button type="button" data-lm-place="${w.id}" class="${S.sel && S.sel.id === w.id ? 'is-sel' : ''}"><span>${w.kind === 'airport' ? `<b>${w.name}</b> ${w.long}` : w.name}</span><small>${G.fmtKm(d)} · ${G.fmtBrg(G.bearingDeg(me.x, me.z, w.x, w.z))} · about ${G.fmtEta(G.etaMin(d, me.gsKts))}</small></button>`;
  }).join('');
  let html = '';
  const apts = list.filter((w) => w.kind === 'airport');
  if (P.regions && P.regions.length) {
    for (const r of P.regions) {
      const ws = apts.filter((w) => w.region === r.id);
      if (ws.length) html += `<h5>${r.name}</h5>${rows(ws)}`;
    }
    const rest = apts.filter((w) => !P.regions.some((r) => r.id === w.region));
    if (rest.length) html += `<h5>Airports</h5>${rows(rest)}`;
  } else html += `<h5>Airports</h5>${rows(apts)}`;
  const heli = list.filter((w) => w.kind === 'heliport');
  if (heli.length) html += `<h5>Heliports</h5>${rows(heli)}`;
  const fixes = list.filter((w) => w.kind === 'fix').sort((a, b) => G.distM(me.x, me.z, a.x, a.z) - G.distM(me.x, me.z, b.x, b.z)).slice(0, 8);
  if (fixes.length) html += `<h5>Nearest fixes</h5>${rows(fixes)}`;
  if (structure || ui.last.places !== html) {
    ui.places.innerHTML = html;
    ui.last.places = html;
  }
}

/* ------------------------------------------------------------------ */
/* Open, close, the view                                               */
/* ------------------------------------------------------------------ */

export function isOpen() {
  return S.open;
}

export function open(sim) {
  if (!sim || S.open) return S.open;
  // From the pause screen (the World Map's "World map" button): back to flying, map up.
  if (sim.state === 'paused' && typeof sim.resume === 'function') sim.resume();
  if (sim.state !== 'flying') return false;
  const me = meOf(sim);
  if (!me) return false;
  // An urgent warning is lit: it would only shut again next frame — a one-frame flash of the whole
  // screen each time 5 is pressed. It stays shut, and says why.
  const warn = sim.mode !== 'drive' ? urgentWarning(sim) : null;
  if (warn) {
    S.closedBy = warn;
    if (sim.hud) sim.hud.notify(`Map closed — ${WARN_WORDS[warn] || 'warning'}`, 'warn', 2.6);
    return false;
  }
  const ui = build(sim);
  const P = placesOf(sim);
  chart(sim);
  S.open = true;
  S.closedBy = null;
  S.openedFor = 0;
  ui.root.hidden = false;
  ui.root.classList.toggle('is-lite', lowTier(sim));
  ui.title.textContent = P.title;
  document.documentElement.classList.add('lm-open');
  // The mouse is the map's while it is open; the stick it was flying centres (input.js mapOpen).
  if (sim.input) {
    sim.input.mapOpen = true;
    if (sim.input.mouse) {
      sim.input.mouse.x = 0;
      sim.input.mouse.y = 0;
    }
  }
  if (document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  measure();
  if (!S.view || S.fitted !== S.pKey) {
    fit(sim);
    S.fitted = S.pKey;
  }
  S.drawAcc = 1;
  S.readAcc = 1;
  syncFollow();
  readout(sim);
  refresh(sim, true);
  draw(sim);
  return true;
}

export function close(sim, why = null) {
  if (!S.open) return;
  S.open = false;
  S.closedBy = why;
  if (S.ui) S.ui.root.hidden = true;
  if (typeof document !== 'undefined') document.documentElement.classList.remove('lm-open');
  if (sim && sim.input) sim.input.mapOpen = false;
  S.pointers.clear();
  S.drag = null;
  S.pinch = null;
  if (S.ui && document.activeElement && S.ui.root.contains(document.activeElement)) document.activeElement.blur();
}

export function toggle(sim) {
  if (S.open) {
    close(sim);
    return false;
  }
  return open(sim);
}

function measure() {
  const cv = S.ui.cv;
  const r = cv.getBoundingClientRect();
  const W = Math.max(50, r.width);
  const H = Math.max(50, r.height);
  S.dpr = Math.min(lowTier(S.sim) ? 1.25 : 2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const pw = Math.round(W * S.dpr);
  const ph = Math.round(H * S.dpr);
  if (cv.width !== pw) cv.width = pw;
  if (cv.height !== ph) cv.height = ph;
  S.W = W;
  S.H = H;
  S.reservedAt = -1;
}

/**
 * Where the panel's own controls sit over the chart (the close button, the
 * readout, the zoom buttons, the side panel), in chart pixels: labels keep
 * out of them. Measured when the layout may have changed, not every frame.
 */
function reserved() {
  const ui = S.ui;
  if (!ui) return [];
  if (S.reservedAt === S.clock && S.reserved) return S.reserved;
  if (S.reserved && S.reservedAt >= 0 && S.clock - S.reservedAt < 1) return S.reserved;
  const base = ui.cv.getBoundingClientRect();
  const out = [];
  for (const el of [ui.root.querySelector('.lm-close'), ui.root.querySelector('.lm-title'), ui.root.querySelector('.lm-live'), ui.root.querySelector('.lm-zoom'), ui.side]) {
    if (!el || !el.offsetParent) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.height) out.push([r.left - base.left - 4, r.top - base.top - 4, r.right - base.left + 4, r.bottom - base.top + 4]);
  }
  S.reserved = out;
  S.reservedAt = S.clock;
  return out;
}

/** Zoom limits: the whole sea and a little more, down to about 1.2 m a pixel. */
function limits() {
  const e = S.P.extent;
  const fitS = Math.min(S.W / (e.x1 - e.x0), S.H / (e.z1 - e.z0));
  return { min: Math.min(fitS * 0.5, 1 / 2500), max: 1 / 1.2 };
}

function fit(sim) {
  const P = placesOf(sim);
  const e = P.extent;
  // The side panel covers the right of a wide screen, the bottom of a phone held upright: fit in what is left.
  const sr = S.ui && S.ui.side && S.ui.side.offsetParent ? S.ui.side.getBoundingClientRect() : null;
  const cr = S.ui ? S.ui.cv.getBoundingClientRect() : null;
  const bottomSheet = !!(sr && cr && sr.width > cr.width * 0.7);
  const side = sr && !bottomSheet && S.W > 600 ? Math.min(sr.width, S.W * 0.46) + 24 : 0;
  const below = sr && bottomSheet ? Math.min(sr.height, S.H * 0.5) + 12 : 0;
  const W = Math.max(120, S.W - side);
  const Hh = Math.max(120, S.H - below);
  const s = Math.min(W / (e.x1 - e.x0), Hh / (e.z1 - e.z0)) * 0.9;
  const cx = (e.x0 + e.x1) / 2 + side / 2 / s;
  const cz = (e.z0 + e.z1) / 2 + below / 2 / s;
  S.target = { cx, cz, s };
  S.view = { cx, cz, s, W: S.W, H: S.H, dpr: S.dpr };
}

/** Zoom by k about the screen point (sx, sy): what is under it stays under it. */
function zoomAt(k, sx, sy) {
  const t = S.target;
  if (!t) return;
  const L = limits();
  const s2 = Math.max(L.min, Math.min(L.max, t.s * k));
  if (!S.follow) {
    const wx = t.cx + (sx - S.W / 2) / t.s;
    const wz = t.cz + (sy - S.H / 2) / t.s;
    t.cx = wx - (sx - S.W / 2) / s2;
    t.cz = wz - (sy - S.H / 2) / s2;
  }
  t.s = s2;
  S.drawAcc = 1;
}

function wirePointer(sim, cv) {
  const pos = (e) => {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  cv.addEventListener('pointerdown', (e) => {
    const p = pos(e);
    S.pointers.set(e.pointerId, p);
    try {
      cv.setPointerCapture(e.pointerId);
    } catch (err) {
      /* a synthetic event has no capture: fine */
    }
    if (S.pointers.size === 1) S.drag = { x: p.x, y: p.y, moved: 0 };
    else if (S.pointers.size === 2) {
      const [a, b] = [...S.pointers.values()];
      S.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      S.drag = null;
    }
    cv.classList.add('is-grab');
    e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => {
    if (!S.pointers.has(e.pointerId) || !S.target) return;
    const p = pos(e);
    S.pointers.set(e.pointerId, p);
    if (S.pinch && S.pointers.size >= 2) {
      const [a, b] = [...S.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      S.follow = false;
      syncFollow();
      if (S.pinch.d > 10) zoomAt(d / S.pinch.d, mx, my);
      // ...and pan with the two fingers' middle.
      S.target.cx -= (mx - S.pinch.x) / S.target.s;
      S.target.cz -= (my - S.pinch.y) / S.target.s;
      S.pinch = { d, x: mx, y: my };
      snapView();
      return;
    }
    const dr = S.drag;
    if (!dr) return;
    const dx = p.x - dr.x;
    const dy = p.y - dr.y;
    dr.moved += Math.abs(dx) + Math.abs(dy);
    dr.x = p.x;
    dr.y = p.y;
    if (dr.moved > 6) {
      if (S.follow) {
        S.follow = false;
        syncFollow();
      }
      S.target.cx -= dx / S.target.s;
      S.target.cz -= dy / S.target.s;
      snapView();
    }
  });
  const up = (e) => {
    const had = S.pointers.has(e.pointerId);
    S.pointers.delete(e.pointerId);
    if (S.pointers.size < 2) S.pinch = null;
    if (!S.pointers.size) cv.classList.remove('is-grab');
    const dr = S.drag;
    if (had && dr && dr.moved <= 6 && e.type === 'pointerup') {
      const p = pos(e);
      pickAt(sim, p.x, p.y);
    }
    if (!S.pointers.size) S.drag = null;
  };
  cv.addEventListener('pointerup', up);
  cv.addEventListener('pointercancel', up);
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    const p = pos(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // A trackpad pinch arrives as ctrl+wheel with small deltas: the same, a little keener.
    const k = Math.exp(-(e.deltaY * unit) * (e.ctrlKey ? 0.01 : 0.0018));
    zoomAt(k, p.x, p.y);
  }, { passive: false });
  cv.addEventListener('dblclick', (e) => {
    const p = pos(e);
    zoomAt(2, p.x, p.y);
  });
}

/** A drag or a pinch moves the picture now (no easing under a finger). */
function snapView() {
  const v = S.view;
  const t = S.target;
  if (!v || !t) return;
  v.cx = t.cx;
  v.cz = t.cz;
  v.s = t.s;
  S.drawAcc = 1;
}

/** Ease the view towards where it is going (wheel and buttons zoom smoothly). */
function easeView(dt) {
  const v = S.view;
  const t = S.target;
  if (!v || !t) return;
  const a = 1 - Math.exp(-Math.max(0, dt) / 0.11);
  const ls = Math.log(v.s);
  v.s = Math.exp(ls + (Math.log(t.s) - ls) * a);
  v.cx += (t.cx - v.cx) * a;
  v.cz += (t.cz - v.cz) * a;
  if (Math.abs(Math.log(t.s / v.s)) < 0.002 && Math.abs(t.cx - v.cx) * v.s < 0.3 && Math.abs(t.cz - v.cz) * v.s < 0.3) {
    v.s = t.s;
    v.cx = t.cx;
    v.cz = t.cz;
  }
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

function trafficOf(sim) {
  const T = sim.traffic;
  if (!Array.isArray(T) || !T.length) return null;
  const out = [];
  for (const e of T) {
    if (!e || !e.pos) continue;
    out.push({ x: e.pos.x, z: e.pos.z, hdg: Number.isFinite(e.heading) ? e.heading : Number.isFinite(e.headingDeg) ? e.headingDeg : 0 });
    if (out.length > 60) break;
  }
  return out;
}

function draw(sim) {
  const ui = S.ui;
  const v = S.view;
  if (!ui || !v) return;
  const cv = ui.cv;
  if (cv.clientWidth && (Math.abs(cv.clientWidth - S.W) > 1 || Math.abs(cv.clientHeight - S.H) > 1)) measure();
  v.W = S.W;
  v.H = S.H;
  v.dpr = S.dpr;
  const g = cv.getContext('2d');
  if (!g) return;
  g.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
  const C = chart(sim);
  C.draw(g, v);
  const me = meOf(sim);
  const P = placesOf(sim);
  const st = { me, pin: S.pin, sel: S.sel, carrier: carrierOf(sim), traffic: trafficOf(sim), plan: null, zone: null, reserved: reserved() };
  for (const f of EXT.states) f(sim, st);
  const stats = drawLayers(g, v, P, st, S.placer);
  for (const f of EXT.layers) {
    try {
      f(g, v, sim);
    } catch (e) {
      /* a layer that cannot draw is a missing layer, not a missing map */
    }
  }
  stats.scale = drawFurniture(g, v);
  stats.tiles = C.tiles.size;
  stats.level = C.level;
  S.lastStats = stats;
  const loading = C.tiles.size === 0;
  if (ui.loading.hidden !== !loading) ui.loading.hidden = !loading;
}

function readout(sim) {
  const ui = S.ui;
  const me = meOf(sim);
  if (!ui || !me) return;
  const ap = sim.autopilot;
  let txt;
  if (me.drive) txt = `${Math.round(me.gsKts)} kt · ${G.fmtBrg(me.hdg)}`;
  else txt = `${Math.round(me.altFt).toLocaleString('en-GB')} ft · ${Math.round(me.iasKts)} kt · HDG ${G.fmtBrg(me.hdg)}`;
  const rate = sim.timeScale > 1 ? ` · ${sim.timeScale}x` : '';
  let apTxt = '';
  if (ap && ap.engaged && !me.drive) {
    const nav = ap.lateral === 'NAV' && ap.nav && typeof ap.nav.label === 'function' ? ap.nav.label() : '';
    apTxt = nav ? `AP NAV ${nav}` : `AP ${ap.mode === 'approach' ? 'APPR' : 'HDG'}`;
  }
  const html = `<span>${txt}${rate}</span>${apTxt ? `<span class="lm-ap lm-extra">${apTxt}</span>` : ''}`;
  if (ui.last.read !== html) {
    ui.read.innerHTML = html;
    ui.last.read = html;
  }
}

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

function urgentWarning(sim) {
  const w = sim.warnings;
  if (!w || typeof w.active !== 'function') return null;
  const on = w.active();
  for (const id of URGENT) if (on.includes(id)) return id;
  return null;
}

function frame(sim, dt) {
  S.clock += dt;
  if (!S.open) return;
  S.openedFor += dt;
  // Flying stopped under it (a crash, a debrief, the menus): it goes.
  const ac = sim.aircraft;
  if (sim.state !== 'flying' || (sim.mode !== 'drive' && ac && ac.crashed)) {
    close(sim, 'state');
    return;
  }
  const warn = sim.mode !== 'drive' ? urgentWarning(sim) : null;
  if (warn) {
    close(sim, warn);
    if (sim.hud) sim.hud.notify(`Map closed — ${WARN_WORDS[warn] || 'warning'}`, 'warn', 2.6);
    return;
  }
  const me = meOf(sim);
  if (S.follow && me && S.target) {
    S.target.cx = me.x;
    S.target.cz = me.z;
  }
  easeView(dt);
  chart(sim).pump(dt);
  S.drawAcc += dt;
  if (S.drawAcc >= (lowTier(sim) ? 1 / 15 : 1 / 30)) {
    S.drawAcc = 0;
    draw(sim);
  }
  S.readAcc += dt;
  if (S.readAcc >= 0.25) {
    S.readAcc = 0;
    readout(sim);
  }
  S.sideAcc += dt;
  if (S.sideAcc >= 0.5) {
    S.sideAcc = 0;
    refresh(sim, false);
  }
}

/* ------------------------------------------------------------------ */
/* The extension                                                        */
/* ------------------------------------------------------------------ */

/**
 * Is this a quick-chat key in a multiplayer game? The multiplayer module is
 * looked up once the game is installed (a static import here would change the
 * order every feature registers in), and its chat actions are mpChat1..N.
 */
const MP = { ref: null, asked: false };
export function mpChatKey(sim, code) {
  const mp = MP.ref;
  if (!mp || !mp.role) return false;
  for (let i = 1; i <= 12; i++) if (isKey(sim, `mpChat${i}`, code)) return true;
  return false;
}
function findMultiplayer() {
  if (MP.asked) return;
  MP.asked = true;
  import('../multiplayer.js').then((m) => {
    MP.ref = (m && m.multiplayer) || null;
  }).catch(() => {});
}

function wireMinimap(sim) {
  const mm = sim.minimap && sim.minimap.el;
  if (!mm || mm._lmWired) return;
  mm._lmWired = true;
  document.documentElement.classList.add('lm-tap');
  mm.setAttribute('role', 'button');
  mm.setAttribute('aria-label', 'Open the full-screen map');
  mm.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    open(sim);
  });
}

registerExtension({
  id: 'livemap',
  install(sim) {
    S.sim = sim;
    if (typeof document !== 'undefined') {
      wireMinimap(sim);
      findMultiplayer();
    }
    sim.liveMap = {
      open: () => open(sim),
      close: () => close(sim),
      toggle: () => toggle(sim),
      isOpen,
      places: () => placesOf(sim),
      pinAt: (x, z) => pinAt(sim, x, z),
      pickAt: (sx, sy) => pickAt(sim, sx, sy),
      select: (w) => select(sim, w),
      selected: () => S.sel,
      waypoints: () => waypointsOf(sim),
      view: () => (S.view ? { ...S.view } : null),
      setView: (cx, cz, s) => {
        if (!S.target) return;
        S.follow = false;
        Object.assign(S.target, { cx, cz, s });
        snapView();
      },
      stats: () => S.lastStats,
      chart: () => S.chart,
      closedBy: () => S.closedBy,
      ui: () => S.ui,
      origin: () => placesOf(sim).origin,
    };
  },
  buildWorld() {
    // A new world: new places, a new chart, nothing selected.
    S.P = null;
    S.pKey = null;
    S.fitted = null;
    S.sel = null;
    S.pin = null;
  },
  startMode(sim) {
    close(sim);
    S.sel = null;
    S.pin = null;
    if (typeof document !== 'undefined') wireMinimap(sim);
  },
  stop(sim) {
    close(sim);
  },
  update(sim, dt) {
    frame(sim, dt);
  },
  key(sim, code, down, e) {
    // In a game with friends a quick-chat key is the chat's (5 is "Race you!"), as it always was:
    // this extension's key() runs before multiplayer's, so it steps aside (the minimap still opens the map).
    if (mpChatKey(sim, code)) return false;
    if (S.open && (isKey(sim, 'pause', code) || isKey(sim, 'worldMap', code))) {
      if (down && !(e && e.repeat)) close(sim);
      return true;
    }
    if (!isKey(sim, 'worldMap', code)) return false;
    if (down && !(e && e.repeat)) open(sim);
    return true;
  },
  hudAction(sim, action) {
    if (action !== 'worldMap') return false;
    toggle(sim);
    return true;
  },
});

export const __livemap = { S, EXT, meOf, URGENT, MP };

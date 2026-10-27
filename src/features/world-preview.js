/**
 * World Map — Preview: the card in the map picker, the streamed ground, the
 * other airports, the world map, and a destination you can fly to.
 *
 * Nothing here runs unless the player picks the preview's card. It is not in
 * MAPS (world/maps.js registerExtraMap): the flight game still offers its own
 * maps, the lobbies still index the roster, and a saved id naming the preview
 * boots the default map like any unknown id (maps-retired.js). See
 * world/worldmap/preview.js for how the sea fits in one frame and why the
 * ground is the same whichever field you start from.
 *
 *   The card    top of "Choose your map", marked PREVIEW: the five fields as a
 *               start picker (the field you start from is the full airport —
 *               terminal, stands, tower, ATC — and the others are drawn by
 *               worldmap/outstation.js), and Fly here.
 *   The ground  worldmap/stream.js, built round the camera in a worker, inside
 *               the tier's budget, far tiles unloaded.
 *   The map     5 (rebindable, `worldMap`), the MAP button on the HUD, or the
 *               pause screen: the sea, every field with its code and runway,
 *               where you are, and a destination. Solo: the game pauses while
 *               it is open.
 *   The trip    a destination puts the guidance (the HUD arrow, the minimap's
 *               mark, the autopilot's heading) on that field's approach, then
 *               its runway; a full stop there is an arrival. Long legs are
 *               an autopilot job: engage it at height and it holds the course.
 */
import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey, keyName } from '../flight/input.js';
import * as Terrain from '../world/terrain.js';
import { MAP, makeTerrainMaterial, setPavedExtra } from '../world/terrain.js';
import { registerExtraMap } from '../world/maps.js';
import { airportLayout } from '../world/airport.js';
import { pavedIn } from '../world/airport-layout.js';
import { RUNWAY } from '../world/airport.js';
import {
  WORLD_PREVIEW_ID, WORLD_PREVIEW_TITLE, PREVIEW, AIRPORTS, airportById, previewDef, setDeparture, departure,
  nearestAirport, headingTo, legM, HUB_ID,
} from '../world/worldmap/preview.js';
import { TerrainStream } from '../world/worldmap/stream.js';
import { buildOutstations, pavedTest } from '../world/worldmap/outstation.js';
import { icon } from '../ui/icons.js';
import { setExtraRunways } from '../ui/minimap.js';

registerActions({
  worldMap: { label: 'World map (World Map preview)', group: 'Game', ctx: ['plane', 'heli'], default: ['Digit5'] },
});

const KT = 1.94384;
const STORE_KEY = 'islandsim.worldpreview.v1';

/** The live state while the preview is the loaded map (null otherwise). */
const S = {
  sim: null,
  stream: null,
  out: null,
  dest: null,
  arrivedT: 0,
  ui: null,
  overlay: null,
  chart: null,
  chartAsked: false,
  pick: HUB_ID,
  pausedForMap: false,
  builtFor: null,
  onBuilt: [],
};

/* ------------------------------------------------------------------ */
/* Memory: the fields you have landed at                               */
/* ------------------------------------------------------------------ */

function readStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const v = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object') return { visited: Array.isArray(v.visited) ? v.visited.filter((id) => airportById(id)) : [], start: airportById(v.start) ? v.start : HUB_ID };
  } catch (e) {
    /* private window, blocked storage: start fresh */
  }
  return { visited: [], start: HUB_ID };
}

function writeStore(v) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(v));
  } catch (e) {
    /* nothing to do: the preview works without it */
  }
}

let STORE = null;
function store() {
  if (!STORE) STORE = readStore();
  return STORE;
}

/* ------------------------------------------------------------------ */
/* Is the preview the map?                                             */
/* ------------------------------------------------------------------ */

export function active() {
  return !!(MAP && MAP.id === WORLD_PREVIEW_ID);
}

/** Load the preview, built round this field. The same path as any map card. */
export function choosePreview(sim, airportId = S.pick) {
  registerExtraMap(previewDef());
  const a = airportById(airportId) || AIRPORTS[0];
  setDeparture(a.id);
  S.pick = a.id;
  const st = store();
  st.start = a.id;
  writeStore(st);
  if (sim.menus && sim.menus.hooks && typeof sim.menus.hooks.chooseMap === 'function') return sim.menus.hooks.chooseMap(WORLD_PREVIEW_ID);
  return sim.setMap(WORLD_PREVIEW_ID);
}

/** Resolves once the preview's world has been built (for "Fly now" and the tests). */
export function whenBuilt() {
  return new Promise((res) => S.onBuilt.push(res));
}

/* ------------------------------------------------------------------ */
/* The world                                                           */
/* ------------------------------------------------------------------ */

function teardown() {
  if (S.stream) S.stream.dispose();
  S.stream = null;
  S.out = null;
  S.builtFor = null;
  setExtraRunways([]);
  if (S.ui && S.ui.card) S.ui.card.hidden = true;
}

function buildWorld(sim, group) {
  teardown();
  if (!active()) return;
  const q = sim.settings.quality || 'medium';
  const t0 = performance.now();
  const mat = makeTerrainMaterial(q);
  S.stream = new TerrainStream({ T: Terrain, material: mat, group, quality: q, def: MAP });
  // The ground the first frame needs, now, behind the loading screen.
  const r = RUNWAY;
  S.stream.prime(r.thresholdWest.x + 80, r.elev + 60, r.thresholdWest.z);
  const t1 = performance.now();
  const dep = departure();
  S.out = buildOutstations(PREVIEW, dep.id, q);
  console.debug(`[wp] ground ${Math.round(t1 - t0)} ms (${S.stream.counts.primed} tiles), other fields and towns ${Math.round(performance.now() - t1)} ms`, S.out.timing || '');
  group.add(S.out.group);
  // The tyres: the main field's layout (airport.js set it) and the other fields' made ground.
  const others = PREVIEW.airports.filter((a) => a.id !== dep.id);
  const outPaved = pavedTest(others);
  setPavedExtra((x, z) => pavedIn(airportLayout(), x, z) || outPaved(x, z));
  // The terrain warning knows the other fields' approaches too.
  setExtraRunways(others.map((a) => ({ cx: a.x, cz: a.z, length: a.length })));
  S.builtFor = { id: dep.id, quality: q, ms: performance.now() - t0 };
  const waiting = S.onBuilt.splice(0);
  for (const f of waiting) {
    try {
      f(S.builtFor);
    } catch (e) {
      /* a waiter that throws is its own problem */
    }
  }
}

/** The world map's picture: heights over the whole sea, from the tile worker once a session. */
function askChart() {
  if (S.chart || S.chartAsked || !S.stream || !S.stream.worker) return;
  S.chartAsked = true;
  const w = S.stream.worker;
  const box = chartBox();
  const onMsg = (ev) => {
    const m = ev.data;
    if (!m || m.op !== 'chart') return;
    w.removeEventListener('message', onMsg);
    if (m.heights) S.chart = { box, w: m.w, h: m.h, heights: m.heights, img: null };
    if (S.overlay && S.overlay.open) S.overlay.draw();
  };
  w.addEventListener('message', onMsg);
  w.postMessage({ op: 'chart', gen: -2, box, w: 220, h: 220 });
}

export function chartBox() {
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const i of PREVIEW.islands) {
    x0 = Math.min(x0, i.cx - i.radius * 1.5); x1 = Math.max(x1, i.cx + i.radius * 1.5);
    z0 = Math.min(z0, i.cz - i.radius * 1.5); z1 = Math.max(z1, i.cz + i.radius * 1.5);
  }
  const pad = 6000;
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const half = Math.max(x1 - x0, z1 - z0) / 2 + pad;
  return { x0: cx - half, x1: cx + half, z0: cz - half, z1: cz + half };
}

/* ------------------------------------------------------------------ */
/* The trip                                                            */
/* ------------------------------------------------------------------ */

/** Where the guidance points for a destination: its approach gate, then its runway. */
export function routeTarget(a, x, z, windDirDeg = 80) {
  // Land into the wind: 09 when the wind has any east in it, 27 otherwise.
  const land09 = Math.cos(((windDirDeg - 90) * Math.PI) / 180) >= 0;
  const end = land09 ? -1 : 1;
  const thr = { x: a.x + end * (a.length / 2), z: a.z };
  const gate = { x: thr.x + end * 7000, z: a.z };
  const toField = Math.hypot(x - a.x, z - a.z);
  const toGate = Math.hypot(x - gate.x, z - gate.z);
  // On the approach side and lined up, or already close: the runway itself.
  const inbound = Math.sign(x - thr.x) === end && Math.abs(z - a.z) < 1800;
  if (toGate < 2500 || (inbound && toField < 12000) || toField < 3500) {
    return { stage: 'final', x: thr.x - end * 200, z: a.z, y: a.elev, runway: land09 ? '09' : '27' };
  }
  return { stage: 'gate', x: gate.x, z: gate.z, y: a.elev + 450, runway: land09 ? '09' : '27' };
}

const _tgt = new THREE.Vector3();
function worldTarget(sim) {
  if (!active() || !S.dest || sim.mode !== 'free') return null;
  const ac = sim.aircraft;
  if (!ac) return null;
  const w = (sim.weather && sim.weather.windDirDeg) ?? 80;
  const r = routeTarget(S.dest, ac.pos.x, ac.pos.z, w);
  _tgt.set(r.x, r.y, r.z);
  const km = Math.hypot(ac.pos.x - S.dest.x, ac.pos.z - S.dest.z) / 1000;
  const label = r.stage === 'final' ? `${S.dest.code} runway ${r.runway}` : `${S.dest.code} ${S.dest.name} · ${km.toFixed(0)} km`;
  return { pos: _tgt, label };
}

export function setDestination(sim, id) {
  const a = id ? airportById(id) : null;
  S.dest = a;
  S.arrivedT = 0;
  if (sim.hud && a) {
    const km = legM({ x: sim.aircraft.pos.x, z: sim.aircraft.pos.z }, a) / 1000;
    sim.hud.notify(`Destination ${a.code} ${a.name} — ${km.toFixed(0)} km, heading ${String(Math.round(headingTo(sim.aircraft.pos.x, sim.aircraft.pos.z, a.x, a.z))).padStart(3, '0')}°`, 'info', 5);
  }
  syncCard(sim);
  return S.dest;
}

function etaMin(sim, distM) {
  const r = sim.aircraft && sim.aircraft.readouts ? sim.aircraft.readouts() : null;
  const kts = r && r.groundKts > 40 ? r.groundKts : 120;
  return distM / (kts / KT) / 60;
}

/** A full stop on a field's runway or apron: that field is visited. */
function checkArrival(sim, dt) {
  const ac = sim.aircraft;
  if (!ac || ac.crashed) return;
  const r = ac.readouts();
  if (!ac.onGround || r.groundKts > 5) {
    S.arrivedT = 0;
    return;
  }
  const { airport: a, distM } = nearestAirport(ac.pos.x, ac.pos.z);
  if (!a || distM > a.length / 2 + 900) return;
  S.arrivedT += dt;
  if (S.arrivedT < 3) return;
  const st = store();
  const first = !st.visited.includes(a.id);
  if (first) {
    st.visited.push(a.id);
    writeStore(st);
  }
  if (S.dest && S.dest.id === a.id) {
    sim.hud && sim.hud.showBanner(`Arrived — ${a.name}`, `${a.code} · ${a.place}${first ? ' · first visit' : ''}`, 'good', 5);
    S.dest = null;
  } else if (first && a.id !== departure().id) {
    sim.hud && sim.hud.notify(`First landing at ${a.name} (${a.code})`, 'good', 4);
  }
  S.arrivedT = -1e9; // once per stop
  syncCard(sim);
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const CSS = `
.wp-card { position: relative; border: 1px solid var(--accent, #4aa3ff); }
.wp-card .wp-badge { position: absolute; top: 10px; left: 10px; font: 700 11px/1 var(--font, system-ui), sans-serif; letter-spacing: 0.08em;
  padding: 5px 8px; border-radius: 6px; background: #ffd166; color: #23180a; }
.wp-card .wp-art canvas { width: 100%; height: 100%; display: block; border-radius: inherit; }
.wp-picks { display: flex; flex-direction: column; gap: 6px; margin: 10px 0 2px; }
.wp-picks button { display: flex; justify-content: space-between; gap: 10px; align-items: center; min-height: 44px; padding: 8px 12px;
  border-radius: 10px; border: 1px solid var(--panel-line, rgba(255,255,255,0.18)); background: rgba(255,255,255,0.05); color: inherit;
  font: 600 13px var(--font, system-ui), sans-serif; text-align: left; cursor: pointer; }
.wp-picks button em { font-style: normal; opacity: 0.7; font-weight: 500; white-space: nowrap; }
.wp-picks button[aria-checked="true"] { border-color: var(--accent, #4aa3ff); background: rgba(74,163,255,0.16); }
.wp-picks button:focus-visible, .wp-ov button:focus-visible { outline: 2px solid var(--accent, #4aa3ff); outline-offset: 2px; }
.wp-hudcard { display: flex; align-items: center; gap: 8px; align-self: flex-end; pointer-events: auto; font: 600 13px var(--font, system-ui), sans-serif; color: #fff; }
.wp-hudcard button { min-height: 36px; min-width: 44px; padding: 6px 10px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.22);
  background: rgba(12,20,32,0.72); color: #fff; font: inherit; cursor: pointer; display: inline-flex; gap: 6px; align-items: center; }
.wp-hudcard .wp-destline { padding: 6px 10px; border-radius: 10px; background: rgba(12,20,32,0.62); font-variant-numeric: tabular-nums; }
.wp-hudcard.is-chip .wp-destline, .wp-hudcard.is-chip .wp-word { display: none; }
.wp-hudcard[hidden], .wp-hudcard .wp-destline[hidden] { display: none !important; }
.wp-ov { position: fixed; inset: 0; z-index: 80; display: grid; grid-template-columns: 1fr minmax(260px, 340px); background: #dfe8ee; color: #1d2a33;
  font: 500 14px var(--font, system-ui), sans-serif; pointer-events: auto; }
.wp-ov[hidden] { display: none; }
.wp-ov canvas { width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.wp-ov .wp-side { background: #f6f3ec; border-left: 1px solid #c9c3b4; padding: 16px; overflow: auto; display: flex; flex-direction: column; gap: 10px; }
.wp-ov h2 { margin: 0; font-size: 18px; }
.wp-ov .wp-tag { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: 0.08em; padding: 3px 7px; border-radius: 5px; background: #ffd166; color: #23180a; }
.wp-ov .wp-list { display: flex; flex-direction: column; gap: 6px; }
.wp-ov .wp-list button { min-height: 44px; text-align: left; border-radius: 10px; border: 1px solid #cfc8b8; background: #fffdf7; color: inherit; font: inherit; padding: 8px 10px; cursor: pointer; }
.wp-ov .wp-list button.is-sel { border-color: #2b6cb0; box-shadow: 0 0 0 2px rgba(43,108,176,0.25); }
.wp-ov .wp-list small { display: block; opacity: 0.75; font-weight: 500; }
.wp-ov .wp-info { line-height: 1.45; }
.wp-ov .wp-btns { display: flex; flex-wrap: wrap; gap: 8px; }
.wp-ov .wp-btns button { min-height: 44px; padding: 8px 12px; border-radius: 10px; border: 1px solid #2b6cb0; background: #2b6cb0; color: #fff; font: 600 14px var(--font, system-ui), sans-serif; cursor: pointer; }
.wp-ov .wp-btns button.ghost { background: transparent; color: #2b6cb0; }
.wp-ov .wp-close { position: absolute; top: 12px; left: 12px; min-width: 44px; min-height: 44px; border-radius: 10px; border: 1px solid #9aa7b0; background: #fffdf7; font: 700 16px sans-serif; cursor: pointer; }
.wp-ov .wp-zoom { position: absolute; bottom: 14px; left: 12px; display: flex; gap: 6px; }
.wp-ov .wp-zoom button { min-width: 44px; min-height: 44px; border-radius: 10px; border: 1px solid #9aa7b0; background: #fffdf7; font: 700 18px sans-serif; cursor: pointer; }
.wp-ov .wp-note { font-size: 12.5px; opacity: 0.8; }
@media (max-width: 720px) { .wp-ov { grid-template-columns: 1fr; grid-template-rows: 1fr auto; } .wp-ov .wp-side { max-height: 46vh; border-left: 0; border-top: 1px solid #c9c3b4; } }
@media (prefers-color-scheme: dark) {
  .wp-ov { background: #182430; color: #e8eef2; }
  .wp-ov .wp-side { background: #1f2c38; border-color: #33475a; }
  .wp-ov .wp-list button, .wp-ov .wp-close, .wp-ov .wp-zoom button { background: #253645; border-color: #3d5468; color: #e8eef2; }
}
`;

function injectStyle() {
  if (typeof document === 'undefined' || document.getElementById('wp-style')) return;
  const st = document.createElement('style');
  st.id = 'wp-style';
  st.textContent = CSS;
  document.head.appendChild(st);
}

/* ------------------------------------------------------------------ */
/* The card in the map picker                                          */
/* ------------------------------------------------------------------ */

function fmtM(m) {
  return `${Math.round(m).toLocaleString('en-GB')} m`;
}

/** A painted sketch of the sea for the card: islands, fields, the long haul. */
function drawSketch(cv) {
  const g = cv.getContext && cv.getContext('2d');
  if (!g || !g.fillRect) return;
  const W = cv.width;
  const H = cv.height;
  const box = chartBox();
  const sx = W / (box.x1 - box.x0);
  const sz = H / (box.z1 - box.z0);
  const s = Math.min(sx, sz);
  const ox = (W - (box.x1 - box.x0) * s) / 2;
  const oz = (H - (box.z1 - box.z0) * s) / 2;
  const X = (x) => ox + (x - box.x0) * s;
  const Z = (z) => oz + (z - box.z0) * s;
  const sea = g.createLinearGradient ? g.createLinearGradient(0, 0, 0, H) : null;
  if (sea && sea.addColorStop) {
    sea.addColorStop(0, '#2f78a6');
    sea.addColorStop(1, '#174a72');
    g.fillStyle = sea;
  } else g.fillStyle = '#245f8a';
  g.fillRect(0, 0, W, H);
  for (const i of PREVIEW.islands) {
    g.fillStyle = i.profile === 'flat' ? '#d9cf9c' : i.profile === 'cone' ? '#8a7a6a' : '#6f9a54';
    g.beginPath();
    g.arc(X(i.cx), Z(i.cz), Math.max(1.5, i.radius * s * 0.9), 0, Math.PI * 2);
    g.fill();
  }
  const A = PREVIEW.airports;
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.setLineDash && g.setLineDash([4, 4]);
  g.lineWidth = 1.2;
  g.beginPath();
  for (let k = 1; k < A.length; k++) {
    g.moveTo(X(A[0].x), Z(A[0].z));
    g.lineTo(X(A[k].x), Z(A[k].z));
  }
  g.stroke();
  g.setLineDash && g.setLineDash([]);
  g.font = '600 11px system-ui, sans-serif';
  for (const a of A) {
    g.fillStyle = '#1b1f24';
    g.fillRect(X(a.x - a.length / 2) - 1, Z(a.z) - 2, Math.max(6, a.length * s) + 2, 4);
    g.fillStyle = '#fff';
    g.fillText(a.code, X(a.x) + 6, Z(a.z) - 6);
  }
}

function buildCard(sim) {
  const menus = sim.menus;
  const screen = menus && menus.screens && menus.screens.maps;
  if (!screen || screen.querySelector('[data-world-preview-card]')) return null;
  const grid = screen.querySelector('.map-grid');
  if (!grid) return null;
  injectStyle();
  const st = store();
  S.pick = st.start || HUB_ID;
  const card = document.createElement('article');
  card.className = 'map-card wp-card';
  card.setAttribute('data-world-preview-card', '');
  const picks = AIRPORTS.map((a) => `<button type="button" role="radio" data-wp-pick="${a.id}" aria-checked="${a.id === S.pick}">
      <span>${a.code} · ${a.name}</span><em>${fmtM(a.length)}${st.visited.includes(a.id) ? ' · visited' : ''}</em></button>`).join('');
  card.innerHTML = `
    <div class="map-art wp-art" aria-hidden="true"><canvas width="360" height="200"></canvas><span class="wp-badge">PREVIEW</span></div>
    <div class="map-text">
      <h3>${WORLD_PREVIEW_TITLE}</h3>
      <span class="map-sub">One sea · ${AIRPORTS.length} airports · islands every few minutes</span>
      <span class="map-diff diff-2">●●○○○ Open sea</span>
      <p>${previewDef().blurb} The longest leg, ${longestLeg()}, is a proper long haul.</p>
      <div class="wp-picks" role="radiogroup" aria-label="Start at">${picks}</div>
    </div>
    <div class="map-foot">
      <span class="map-current" data-wp-current hidden>Currently flying here</span>
      <button class="primary" type="button" data-wp-fly>Fly here</button>
    </div>`;
  grid.insertBefore(card, grid.firstChild);
  drawSketch(card.querySelector('canvas'));
  card.addEventListener('click', (e) => {
    const p = e.target.closest('[data-wp-pick]');
    if (p) {
      S.pick = p.dataset.wpPick;
      for (const b of card.querySelectorAll('[data-wp-pick]')) b.setAttribute('aria-checked', String(b.dataset.wpPick === S.pick));
      return;
    }
    if (e.target.closest('[data-wp-fly]')) {
      menus.hooks && menus.hooks.onClick && menus.hooks.onClick('map');
      choosePreview(sim, S.pick);
    }
  });
  card.addEventListener('keydown', (e) => {
    const p = e.target.closest && e.target.closest('[data-wp-pick]');
    if (!p || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    const all = [...card.querySelectorAll('[data-wp-pick]')];
    const i = all.indexOf(p) + (e.key === 'ArrowDown' ? 1 : -1);
    const next = all[(i + all.length) % all.length];
    next.focus();
    next.click();
    e.preventDefault();
  });
  return card;
}

function longestLeg() {
  let best = null;
  for (let i = 0; i < AIRPORTS.length; i++) {
    for (let j = i + 1; j < AIRPORTS.length; j++) {
      const d = legM(AIRPORTS[i], AIRPORTS[j]);
      if (!best || d > best.d) best = { d, a: AIRPORTS[i], b: AIRPORTS[j] };
    }
  }
  return best ? `${best.a.code}–${best.b.code} at ${Math.round(best.d / 1000)} km` : '';
}

/** Show the card only to games that fly. */
function syncCardForGame(sim) {
  const card = S.ui && S.ui.mapCard;
  if (!card) return;
  const g = sim.game || 'flight';
  card.hidden = !(g === 'flight' || g === 'heli');
  const cur = card.querySelector('[data-wp-current]');
  if (cur) cur.hidden = !active();
  card.classList.toggle('is-current', active());
}

/* ------------------------------------------------------------------ */
/* The HUD card and the pause-screen button                            */
/* ------------------------------------------------------------------ */

function hudCard(sim) {
  if (S.ui && S.ui.card) return S.ui.card;
  injectStyle();
  const el = document.createElement('div');
  el.className = 'wp-hudcard';
  el.hidden = true;
  el.innerHTML = `<button type="button" class="wp-mapchip" data-wp-map aria-label="World map">${icon('map', 16)}<span class="wp-word">Map</span></button><span class="wp-destline" hidden></span>`;
  el.querySelector('[data-wp-map]').addEventListener('click', () => openMap(sim));
  const stack = sim.hud && sim.hud.stack;
  if (stack && typeof stack.add === 'function') stack.add(el, { prio: 3.2, id: 'world-preview', info: true });
  else extLayer().appendChild(el);
  S.ui = S.ui || {};
  S.ui.card = el;
  return el;
}

let lastCardText = '';
function syncCard(sim) {
  const el = hudCard(sim);
  const on = active() && sim.state === 'flying';
  if (el.hidden === on) el.hidden = !on;
  const line = el.querySelector('.wp-destline');
  let text = '';
  if (on && S.dest && sim.aircraft) {
    const d = Math.hypot(sim.aircraft.pos.x - S.dest.x, sim.aircraft.pos.z - S.dest.z);
    text = `→ ${S.dest.code} ${(d / 1000).toFixed(d < 10000 ? 1 : 0)} km · ${Math.max(1, Math.round(etaMin(sim, d)))} min`;
  }
  if (text !== lastCardText) {
    lastCardText = text;
    line.textContent = text;
    line.hidden = !text;
    if (text && sim.hud && sim.hud.stack && sim.hud.stack.poke && !syncCard._poked) {
      sim.hud.stack.poke(el, 4);
      syncCard._poked = true;
    }
    if (!text) syncCard._poked = false;
  }
}

function pauseButton(sim) {
  const pause = sim.menus && sim.menus.screens && sim.menus.screens.pause;
  if (!pause) return null;
  let b = pause.querySelector('[data-wp-open]');
  if (b) return b;
  const row = pause.querySelector('.pause-actions');
  if (!row) return null;
  b = document.createElement('button');
  b.type = 'button';
  b.setAttribute('data-wp-open', '');
  b.innerHTML = `${icon('map', 18)}<span>World map</span>`;
  b.hidden = true;
  b.addEventListener('click', () => openMap(sim));
  row.insertBefore(b, row.children[1] || null);
  return b;
}

/* ------------------------------------------------------------------ */
/* The world map                                                        */
/* ------------------------------------------------------------------ */

function overlay(sim) {
  if (S.overlay) return S.overlay;
  injectStyle();
  const root = document.createElement('div');
  root.className = 'wp-ov';
  root.hidden = true;
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'World map');
  root.innerHTML = `
    <div style="position:relative;min-height:0">
      <canvas data-wp-canvas></canvas>
      <button type="button" class="wp-close" data-wp-close aria-label="Close the map">✕</button>
      <div class="wp-zoom"><button type="button" data-wp-zoom="1" aria-label="Zoom in">+</button><button type="button" data-wp-zoom="-1" aria-label="Zoom out">−</button></div>
    </div>
    <aside class="wp-side">
      <div><span class="wp-tag">PREVIEW</span></div>
      <h2>${WORLD_PREVIEW_TITLE}</h2>
      <div class="wp-note" data-wp-count></div>
      <div class="wp-list" data-wp-list></div>
      <div class="wp-info" data-wp-info></div>
      <div class="wp-btns" data-wp-btns></div>
      <p class="wp-note" data-wp-tip></p>
    </aside>`;
  document.body.appendChild(root);
  const cv = root.querySelector('[data-wp-canvas]');
  const O = {
    root,
    cv,
    open: false,
    sel: null,
    view: null,
    draw: () => drawMap(sim, O),
  };
  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-wp-close]')) return closeMap(sim);
    const z = e.target.closest('[data-wp-zoom]');
    if (z) {
      zoomBy(O, Number(z.dataset.wpZoom) > 0 ? 1.5 : 1 / 1.5);
      return O.draw();
    }
    const pick = e.target.closest('[data-wp-sel]');
    if (pick) {
      O.sel = airportById(pick.dataset.wpSel);
      return fillSide(sim, O);
    }
    const b = e.target.closest('[data-wp-do]');
    if (b) {
      const what = b.dataset.wpDo;
      if (what === 'dest' && O.sel) setDestination(sim, O.sel.id);
      else if (what === 'clear') setDestination(sim, null);
      else if (what === 'start' && O.sel) {
        closeMap(sim);
        choosePreview(sim, O.sel.id);
        return;
      }
      fillSide(sim, O);
      O.draw();
    }
  });
  // Drag to pan, wheel or pinch to zoom.
  let drag = null;
  cv.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: 0 };
    cv.setPointerCapture && cv.setPointerCapture(e.pointerId);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!drag || !O.view) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX;
    drag.y = e.clientY;
    O.view.cx -= dx / O.view.s;
    O.view.cz -= dy / O.view.s;
    O.draw();
  });
  cv.addEventListener('pointerup', (e) => {
    if (drag && drag.moved < 6 && O.view) {
      // A tap: the field nearest it, if any is close.
      const r = cv.getBoundingClientRect();
      const wx = O.view.cx + (e.clientX - r.left - r.width / 2) / O.view.s;
      const wz = O.view.cz + (e.clientY - r.top - r.height / 2) / O.view.s;
      const { airport, distM } = nearestAirport(wx, wz);
      if (airport && distM * O.view.s < 40) {
        O.sel = airport;
        fillSide(sim, O);
        O.draw();
      }
    }
    drag = null;
  });
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(O, e.deltaY < 0 ? 1.25 : 1 / 1.25);
    O.draw();
  }, { passive: false });
  // Its own keys while open: the game's are paused.
  window.addEventListener('keydown', (e) => {
    if (!O.open) return;
    if (isKey(sim, 'pause', e.code) || isKey(sim, 'worldMap', e.code)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      closeMap(sim);
    }
  }, true);
  window.addEventListener('resize', () => O.open && O.draw());
  S.overlay = O;
  return O;
}

function zoomBy(O, k) {
  if (!O.view) return;
  O.view.s = Math.min(O.view.max, Math.max(O.view.min, O.view.s * k));
}

export function openMap(sim) {
  if (!active()) return false;
  const O = overlay(sim);
  if (sim.state === 'flying' && !(sim.multiplayer && sim.multiplayer.active)) {
    sim.pause();
    S.pausedForMap = sim.state === 'paused';
  } else S.pausedForMap = false;
  O.open = true;
  O.root.hidden = false;
  if (!O.sel) O.sel = S.dest || nearestAirport(sim.aircraft.pos.x, sim.aircraft.pos.z).airport;
  O.view = null;
  askChart();
  fillSide(sim, O);
  O.draw();
  const first = O.root.querySelector('[data-wp-close]');
  first && first.focus && first.focus();
  return true;
}

export function closeMap(sim) {
  const O = S.overlay;
  if (!O || !O.open) return;
  O.open = false;
  O.root.hidden = true;
  if (S.pausedForMap && sim.state === 'paused') sim.resume();
  S.pausedForMap = false;
}

function fillSide(sim, O) {
  const ac = sim.aircraft;
  const st = store();
  const dep = departure();
  const list = O.root.querySelector('[data-wp-list]');
  list.innerHTML = AIRPORTS.map((a) => {
    const d = Math.hypot(ac.pos.x - a.x, ac.pos.z - a.z);
    const tags = [a.id === dep.id ? 'started here' : '', st.visited.includes(a.id) ? 'visited' : '', S.dest && S.dest.id === a.id ? 'destination' : ''].filter(Boolean).join(' · ');
    return `<button type="button" data-wp-sel="${a.id}" class="${O.sel && O.sel.id === a.id ? 'is-sel' : ''}">
      <b>${a.code}</b> ${a.name}<small>${(d / 1000).toFixed(0)} km · ${fmtM(a.length)} runway${tags ? ' · ' + tags : ''}</small></button>`;
  }).join('');
  O.root.querySelector('[data-wp-count]').textContent = `${st.visited.length} of ${AIRPORTS.length} airports visited`;
  const a = O.sel;
  const info = O.root.querySelector('[data-wp-info]');
  const btns = O.root.querySelector('[data-wp-btns]');
  if (!a) {
    info.textContent = '';
    btns.innerHTML = '';
    return;
  }
  const d = Math.hypot(ac.pos.x - a.x, ac.pos.z - a.z);
  const hdg = Math.round(headingTo(ac.pos.x, ac.pos.z, a.x, a.z));
  const town = PREVIEW.towns.find((t) => t.airport === a.id);
  info.innerHTML = `<b>${a.name}</b> (${a.code}) on ${a.place}<br>
    Runway 09/27 · ${fmtM(a.length)} × ${a.halfWidth * 2} m · field ${Math.round(a.elev * 3.28084)} ft<br>
    ${a.kind === 'hub' ? 'Airliners, jets and light aircraft' : a.kind === 'regional' ? 'Regional: airliners and light aircraft' : 'Grass-roots strip: light aircraft and helicopters'}${a.parking ? ' · car park' : ''}<br>
    ${town ? `Town: ${town.name}` : ''}<br>
    ${(d / 1000).toFixed(1)} km away, heading ${String(hdg).padStart(3, '0')}° · about ${Math.max(1, Math.round(etaMin(sim, d)))} min`;
  const isDest = S.dest && S.dest.id === a.id;
  btns.innerHTML = [
    sim.mode === 'free' ? (isDest ? '<button type="button" class="ghost" data-wp-do="clear">Clear destination</button>' : '<button type="button" data-wp-do="dest">Fly here</button>') : '',
    a.id !== dep.id ? '<button type="button" class="ghost" data-wp-do="start">Start a flight here</button>' : '',
  ].join('');
  O.root.querySelector('[data-wp-tip]').textContent = sim.mode === 'free'
    ? `Long leg? Climb to height and engage the autopilot (${keyName('autopilot', sim)}): it holds the course to your destination. Close the map with ${keyName('worldMap', sim)} or Esc.`
    : 'Destinations are for Free Flight.';
}

function chartImage(g, ch) {
  if (ch.img) return ch.img;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = ch.w;
  c.height = ch.h;
  const x = c.getContext('2d');
  if (!x || !x.createImageData) return null;
  const im = x.createImageData(ch.w, ch.h);
  const H = ch.heights;
  for (let j = 0; j < ch.h; j++) {
    for (let i = 0; i < ch.w; i++) {
      const h = H[j * ch.w + i];
      const k = (j * ch.w + i) * 4;
      if (h <= 0) {
        const t = Math.min(1, -h / 60);
        im.data[k] = 150 - 70 * t; im.data[k + 1] = 200 - 60 * t; im.data[k + 2] = 220 - 30 * t;
      } else {
        const e = H[j * ch.w + Math.min(ch.w - 1, i + 1)] - H[Math.max(0, j - 1) * ch.w + i];
        const sh = Math.max(0.6, Math.min(1.25, 1 - e * 0.01));
        const t = Math.min(1, h / 500);
        im.data[k] = (156 + 60 * t) * sh; im.data[k + 1] = (182 + 20 * t) * sh; im.data[k + 2] = (120 + 60 * t) * sh;
      }
      im.data[k + 3] = 255;
    }
  }
  x.putImageData(im, 0, 0);
  ch.img = c;
  return c;
}

function drawMap(sim, O) {
  const cv = O.cv;
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  const W = Math.max(50, Math.round(r.width * dpr));
  const H = Math.max(50, Math.round(r.height * dpr));
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return;
  const box = chartBox();
  if (!O.view) {
    const fit = Math.min(r.width / (box.x1 - box.x0), r.height / (box.z1 - box.z0));
    O.view = { cx: (box.x0 + box.x1) / 2, cz: (box.z0 + box.z1) / 2, s: fit, min: fit * 0.6, max: fit * 24 };
  }
  const v = O.view;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  const X = (x) => r.width / 2 + (x - v.cx) * v.s;
  const Z = (z) => r.height / 2 + (z - v.cz) * v.s;
  g.fillStyle = '#7fb6cf';
  g.fillRect(0, 0, r.width, r.height);
  const img = S.chart ? chartImage(g, S.chart) : null;
  if (img) {
    g.imageSmoothingEnabled = true;
    g.drawImage(img, X(box.x0), Z(box.z0), (box.x1 - box.x0) * v.s, (box.z1 - box.z0) * v.s);
  } else {
    for (const i of PREVIEW.islands) {
      g.fillStyle = i.profile === 'flat' ? '#e2d7a4' : '#a9c38c';
      g.beginPath();
      g.arc(X(i.cx), Z(i.cz), Math.max(2, i.radius * v.s * 0.92), 0, Math.PI * 2);
      g.fill();
    }
  }
  // A 20 km grid, faint.
  g.strokeStyle = 'rgba(20,40,60,0.12)';
  g.lineWidth = 1;
  g.beginPath();
  for (let x = Math.ceil(box.x0 / 20000) * 20000; x < box.x1; x += 20000) { g.moveTo(X(x), Z(box.z0)); g.lineTo(X(x), Z(box.z1)); }
  for (let z = Math.ceil(box.z0 / 20000) * 20000; z < box.z1; z += 20000) { g.moveTo(X(box.x0), Z(z)); g.lineTo(X(box.x1), Z(z)); }
  g.stroke();
  const ac = sim.aircraft;
  // The route.
  if (S.dest && ac) {
    g.strokeStyle = '#d6336c';
    g.lineWidth = 2.5;
    g.setLineDash([8, 6]);
    g.beginPath();
    g.moveTo(X(ac.pos.x), Z(ac.pos.z));
    g.lineTo(X(S.dest.x), Z(S.dest.z));
    g.stroke();
    g.setLineDash([]);
  }
  // Island names, small.
  g.font = '500 11px system-ui, sans-serif';
  g.fillStyle = 'rgba(30,40,30,0.75)';
  for (const i of PREVIEW.islands) {
    if (i.radius < 1200 && v.s < 0.004) continue;
    if (AIRPORTS.some((a) => a.place === i.name)) continue;
    g.fillText(i.name, X(i.cx) + 6, Z(i.cz) + i.radius * v.s + 12);
  }
  // The fields.
  const st = store();
  for (const a of AIRPORTS) {
    const sel = O.sel && O.sel.id === a.id;
    const L = Math.max(14, a.length * v.s);
    g.fillStyle = '#20262c';
    g.fillRect(X(a.x) - L / 2, Z(a.z) - 3, L, 6);
    g.strokeStyle = sel ? '#2b6cb0' : '#ffffff';
    g.lineWidth = sel ? 3 : 1.5;
    g.strokeRect(X(a.x) - L / 2 - 2, Z(a.z) - 5, L + 4, 10);
    g.font = '700 13px system-ui, sans-serif';
    g.fillStyle = '#10161c';
    const label = `${a.code}${st.visited.includes(a.id) ? ' ✓' : ''}`;
    g.fillText(label, X(a.x) + L / 2 + 8, Z(a.z) + 4);
    g.font = '500 11px system-ui, sans-serif';
    g.fillText(a.name, X(a.x) + L / 2 + 8, Z(a.z) + 18);
  }
  // You, as an arrow along your heading.
  if (ac) {
    const hdg = ac.readouts ? ac.readouts().heading : 0;
    const a = (hdg * Math.PI) / 180;
    const px = X(ac.pos.x);
    const pz = Z(ac.pos.z);
    g.save();
    g.translate(px, pz);
    g.rotate(a);
    g.fillStyle = '#ffcc00';
    g.strokeStyle = '#1a1a1a';
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(0, -12);
    g.lineTo(8, 9);
    g.lineTo(0, 4);
    g.lineTo(-8, 9);
    g.closePath();
    g.fill();
    g.stroke();
    g.restore();
  }
  // A scale bar.
  const km = v.s * 10000 > 160 ? 5 : v.s * 10000 > 60 ? 10 : 20;
  const px = km * 1000 * v.s;
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillRect(r.width - px - 26, r.height - 34, px + 16, 22);
  g.fillStyle = '#10161c';
  g.fillRect(r.width - px - 18, r.height - 20, px, 3);
  g.font = '600 11px system-ui, sans-serif';
  g.fillText(`${km} km`, r.width - px - 18, r.height - 24);
}

/* ------------------------------------------------------------------ */
/* The menus' "Now flying" line                                        */
/* ------------------------------------------------------------------ */

function wrapSyncMap(sim) {
  const menus = sim.menus;
  if (!menus || menus._wpSync || typeof menus.syncMap !== 'function') return;
  const orig = menus.syncMap.bind(menus);
  menus._wpSync = true;
  menus.syncMap = function (id) {
    const out = orig(id);
    if (id === WORLD_PREVIEW_ID) {
      const dep = departure();
      for (const el of menus.root.querySelectorAll('[data-map-name]')) el.textContent = WORLD_PREVIEW_TITLE;
      for (const el of menus.root.querySelectorAll('[data-map-blurb]')) el.textContent = `Now flying ${WORLD_PREVIEW_TITLE} — from ${dep.code} ${dep.name}`;
    }
    syncCardForGame(sim);
    return out;
  };
  const show = menus.show && menus.show.bind(menus);
  if (show) {
    menus.show = function (name, ...rest) {
      const out = show(name, ...rest);
      if (name === 'maps') {
        if (!S.ui || !S.ui.mapCard || !S.ui.mapCard.isConnected) {
          S.ui = S.ui || {};
          S.ui.mapCard = buildCard(sim) || (menus.screens.maps && menus.screens.maps.querySelector('[data-world-preview-card]'));
        }
        syncCardForGame(sim);
      }
      if (name === 'pause') {
        const b = pauseButton(sim);
        if (b) b.hidden = !active();
      }
      return out;
    };
  }
}

/* ------------------------------------------------------------------ */
/* The extension                                                        */
/* ------------------------------------------------------------------ */

registerExtension({
  id: 'world-preview',
  install(sim) {
    S.sim = sim;
    wrapSyncMap(sim);
    S.ui = S.ui || {};
    S.ui.mapCard = buildCard(sim);
    syncCardForGame(sim);
    // The guidance: the runner's target when a mission names one, otherwise the trip's.
    const R = sim.runner;
    if (R && typeof R.activeTarget === 'function' && !R._wpWrapped) {
      const orig = R.activeTarget.bind(R);
      R._wpWrapped = true;
      R.activeTarget = () => orig() || worldTarget(sim);
    }
    sim.worldPreview = {
      active,
      stats: () => (S.stream ? S.stream.stats() : null),
      built: () => S.builtFor,
      choose: (id) => choosePreview(sim, id),
      whenBuilt,
      openMap: () => openMap(sim),
      closeMap: () => closeMap(sim),
      setDestination: (id) => setDestination(sim, id),
      destination: () => S.dest,
      airports: () => AIRPORTS,
      outstations: () => S.out,
      stream: () => S.stream,
      visited: () => store().visited.slice(),
    };
  },
  buildWorld(sim, group) {
    buildWorld(sim, group);
  },
  startMode(sim, mode, opts) {
    if (!active()) {
      S.dest = null;
      return;
    }
    // Free Flight's airborne start is written 3.4 km west of Kestrel's runway;
    // here it is 3.4 km west of the runway you chose to start from.
    if (mode === 'free' && opts && opts.airborne && sim.aircraft) {
      const ac = sim.aircraft;
      const want = new THREE.Vector3(RUNWAY.cx - RUNWAY.length / 2 - 2850, 0, RUNWAY.cz + 300);
      if (Math.hypot(ac.pos.x - want.x, ac.pos.z - want.z) > 500) {
        ac.reset({ pos: want, headingDeg: 90, speed: 60, altAGL: 610, engineOn: true, fuel: opts.fuel != null ? Math.max(0.05, Math.min(1, opts.fuel)) : 1 });
        ac.controls.throttle = 0.7;
        if (sim.input) sim.input.throttleTarget = 0.7;
      }
    }
    if (S.stream && sim.aircraft) S.stream.prime(sim.aircraft.pos.x, sim.aircraft.pos.y, sim.aircraft.pos.z, 500);
    syncCard(sim);
  },
  stop(sim) {
    closeMap(sim);
    syncCard(sim);
  },
  update(sim, dt) {
    if (!active()) {
      if (S.ui && S.ui.card && !S.ui.card.hidden) S.ui.card.hidden = true;
      return;
    }
    const cam = sim.camera && sim.camera.position;
    if (S.stream && cam) S.stream.update(dt, cam.x, cam.y, cam.z);
    if (S.out) S.out.update(dt, sim.weather, cam);
    if (sim.mode === 'free') checkArrival(sim, dt);
    syncCard(sim);
  },
  key(sim, code, down) {
    if (!down || !active() || !isKey(sim, 'worldMap', code)) return false;
    if (S.overlay && S.overlay.open) closeMap(sim);
    else openMap(sim);
    return true;
  },
  devActions: [
    { label: 'World preview: tile stats', hint: 'Streamed terrain numbers in the console', run: () => console.info('[world-preview]', S.stream && S.stream.stats()) },
  ],
});

/**
 * The photo studio's panel, its touch sticks and its letterbox (./studio.js
 * is the studio). Built when the studio opens, removed when it closes.
 *
 * On a touch screen: the left stick moves the camera, the right stick turns
 * it, the two buttons above the right stick go up and down, a finger dragged
 * on the picture looks (or orbits) and two fingers pinch the lens. With the
 * panel hidden for a clean shot, a tap on the picture brings it back.
 */

import { keyName } from '../../flight/input.js';
import { SNAPS, SNAP_LABELS, SKIES, MAX_KEYS } from './studio.js';

const CSS = `
html.pst-on body > :not(#view):not(.pst-root) { visibility: hidden !important; pointer-events: none !important; }
.pst-root { position: fixed; inset: 0; z-index: 140; font: 13px/1.35 'Jost', system-ui, -apple-system, 'Segoe UI', sans-serif; color: #e4ecf6; }
.pst-pic { position: absolute; inset: 0; touch-action: none; cursor: grab; }
.pst-pic:active { cursor: grabbing; }
.pst-bar { position: absolute; left: 0; right: 0; height: var(--pst-lb, 12vh); background: #000; pointer-events: none; }
.pst-bar.is-top { top: 0; } .pst-bar.is-bottom { bottom: 0; }
.pst-bar[hidden] { display: none; }
.pst-panel { position: absolute; top: 12px; right: 12px; width: 312px; max-height: calc(100% - 24px); display: flex; flex-direction: column;
  background: rgba(9, 14, 22, 0.9); border: 1px solid rgba(160, 195, 240, 0.22); border-radius: 12px; box-shadow: 0 16px 44px rgba(0,0,0,0.45); }
.pst-root.is-touch .pst-panel { max-height: calc(100% - 210px); }
.pst-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid rgba(160,195,240,0.14); }
.pst-head h2 { flex: 1; margin: 0; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: #9fb2cc; font-weight: 600; }
.pst-body { overflow-y: auto; padding: 4px 10px 10px; -webkit-overflow-scrolling: touch; }
.pst-panel.is-min .pst-body { display: none; }
.pst-sec { padding: 8px 0 6px; border-bottom: 1px solid rgba(160,195,240,0.1); }
.pst-sec:last-child { border-bottom: 0; }
.pst-sec h3 { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; color: #7f93ad; font-weight: 600; }
.pst-row { display: flex; flex-wrap: wrap; gap: 5px; margin: 4px 0; align-items: center; }
.pst-root button { min-height: 32px; padding: 0 10px; border: 1px solid rgba(160,195,240,0.18); border-radius: 8px; background: rgba(255,255,255,0.06);
  color: inherit; font: inherit; cursor: pointer; touch-action: manipulation; }
.pst-root button:hover { background: rgba(255,255,255,0.12); }
.pst-root button.is-on { background: #58c6ff; color: #04111d; border-color: #58c6ff; }
.pst-root button.is-primary { background: #e9f1fb; color: #0a1220; border-color: #e9f1fb; }
.pst-root button:disabled { opacity: 0.4; cursor: default; }
.pst-root label.pst-sl { display: grid; grid-template-columns: 74px 1fr 52px; gap: 6px; align-items: center; margin: 3px 0; color: #b9c8da; }
.pst-root label.pst-sl b { font-weight: 500; text-align: right; color: #e4ecf6; font-variant-numeric: tabular-nums; }
.pst-root input[type=range] { width: 100%; min-height: 28px; accent-color: #58c6ff; }
.pst-root input[type=search], .pst-root select { width: 100%; min-height: 32px; box-sizing: border-box; border-radius: 8px; border: 1px solid rgba(160,195,240,0.2);
  background: rgba(0,0,0,0.35); color: inherit; font: inherit; padding: 0 8px; }
.pst-list { display: flex; flex-direction: column; gap: 3px; max-height: 150px; overflow-y: auto; }
.pst-item { display: flex; gap: 4px; align-items: center; }
.pst-item > button:first-child { flex: 1; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pst-item > button.x { flex: 0 0 34px; padding: 0; }
.pst-note { margin: 4px 0 0; color: #8ea2bb; font-size: 12px; }
.pst-keys { margin: 6px 0 0; color: #7f93ad; font-size: 11.5px; }
.pst-keys kbd { font: inherit; color: #cfdbea; }
.pst-root.is-hidden .pst-panel, .pst-root.is-hidden .pst-touch { display: none; }
.pst-touch { display: none; }
.pst-root.is-touch .pst-touch { display: block; }
.pst-stick { position: absolute; bottom: 22px; width: 150px; height: 150px; border-radius: 50%; background: rgba(9,14,22,0.35); border: 1px solid rgba(220,235,255,0.35); touch-action: none; }
.pst-stick.is-left { left: 22px; } .pst-stick.is-right { right: 22px; }
.pst-stick i { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px; border-radius: 50%; background: rgba(233,241,251,0.75); pointer-events: none; }
.pst-stick span { position: absolute; left: 0; right: 0; top: -20px; text-align: center; font-size: 11px; color: #e4ecf6; text-shadow: 0 1px 2px #000; letter-spacing: 0.06em; text-transform: uppercase; }
.pst-ud { position: absolute; right: 186px; bottom: 30px; display: flex; flex-direction: column; gap: 10px; }
.pst-ud button { width: 58px; min-height: 58px; border-radius: 50%; background: rgba(9,14,22,0.55); font-weight: 600; }
@media (max-width: 700px) {
  .pst-panel { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 46%; }
  .pst-root.is-touch .pst-panel { bottom: 190px; max-height: calc(100% - 200px); }
  .pst-stick { width: 128px; height: 128px; }
  .pst-ud { right: 160px; }
}
`;

const h = (html) => {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
};
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clock = (hr) => {
  const m = Math.round(((hr % 24) + 24) % 24 * 60);
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};
// The camera's speed slider is logarithmic: 0..100 is 1..400 m/s.
const toSpeed = (v) => Math.round(Math.exp((v / 100) * Math.log(400)));
const fromSpeed = (s) => Math.round((Math.log(Math.max(1, s)) / Math.log(400)) * 100);

export function buildUi(api, sim) {
  if (!document.getElementById('pst-css')) {
    const st = document.createElement('style');
    st.id = 'pst-css';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const K = (a) => esc(keyName(a, sim));
  const slider = (id, label, min, max, step, val) =>
    `<label class="pst-sl"><span>${label}</span><input type="range" data-s="${id}" min="${min}" max="${max}" step="${step}" value="${val}"><b data-v="${id}"></b></label>`;
  const root = h(`<div class="pst-root" data-studio>
    <div class="pst-pic" data-pic></div>
    <div class="pst-bar is-top" data-lb hidden></div><div class="pst-bar is-bottom" data-lb hidden></div>
    <div class="pst-touch" data-touch>
      <div class="pst-stick is-left" data-stick="move"><span>Move</span><i></i></div>
      <div class="pst-stick is-right" data-stick="look"><span>Look</span><i></i></div>
      <div class="pst-ud"><button data-ud="1" aria-label="Camera up">Up</button><button data-ud="-1" aria-label="Camera down">Down</button></div>
    </div>
    <section class="pst-panel" data-panel aria-label="Photo studio">
      <div class="pst-head"><h2>Photo studio</h2>
        <button data-a="min" aria-label="Fold the panel">–</button>
        <button data-a="hide" title="${K('hideUi')}">Hide</button>
        <button data-a="leave" title="${K('pause')}">Leave</button></div>
      <div class="pst-body">
        <div class="pst-sec"><h3>World</h3>
          <div class="pst-row"><button data-a="freeze" class="is-primary"></button><button data-a="step">Next frame</button></div>
          ${slider('scale', 'Slow-mo', 0.05, 1, 0.05, 1)}
          ${slider('hour', 'Time', 0, 24, 0.25, 12)}
          <div class="pst-row" data-skies><button data-sky="flight">As it was</button>${SKIES.map((id) => `<button data-sky="${id}">${id[0].toUpperCase() + id.slice(1)}</button>`).join('')}</div>
        </div>
        <div class="pst-sec"><h3>Camera</h3>
          <div class="pst-row"><button data-cm="free">Free</button><button data-cm="orbit">Orbit</button><button data-a="follow">Ride along</button></div>
          ${slider('speed', 'Speed', 0, 100, 1, 50)}
          ${slider('fov', 'Lens', 8, 110, 1, 60)}
          ${slider('roll', 'Roll', -90, 90, 1, 0)}
          <div class="pst-row">${SNAPS.map((s) => `<button data-snap="${s}">${SNAP_LABELS[s]}</button>`).join('')}</div>
        </div>
        <div class="pst-sec"><h3>Aeroplanes</h3>
          <div class="pst-list" data-props></div>
          <div data-edit hidden>
            ${slider('pitch', 'Pitch', -60, 60, 1, 0)}
            ${slider('bank', 'Bank', -90, 90, 1, 0)}
            ${slider('heading', 'Heading', 0, 359, 1, 0)}
            ${slider('flaps', 'Flaps', 0, 3, 1, 0)}
            ${slider('kt', 'Flies at', 0, 600, 5, 160)}
            <div class="pst-row"><button data-a="gear">Gear</button><button data-a="engines">Engines</button><button data-a="ground">On the ground</button><button data-a="bring">To camera</button></div>
          </div>
          <input type="search" data-q placeholder="Add an aeroplane: search" autocomplete="off" spellcheck="false" aria-label="Search the aeroplanes">
          <div class="pst-list" data-results></div>
          <div data-add hidden>
            <p class="pst-note" data-add-name></p>
            <select data-paint aria-label="Paint"></select>
            <div class="pst-row"><button data-at="air">In the air ahead</button><button data-at="ground">On the ground ahead</button><button data-at="beside">Beside my plane</button></div>
          </div>
        </div>
        <div class="pst-sec"><h3>Shot</h3>
          <div class="pst-row"><button data-a="shot" class="is-primary">Save picture</button><button data-a="lb">Letterbox</button></div>
          <p class="pst-note" data-shot-note>A PNG of the picture at the screen's own resolution.</p>
        </div>
        <div class="pst-sec"><h3>Trailer</h3>
          <div class="pst-list" data-keys></div>
          <div class="pst-row"><button data-a="key">Add key from camera</button></div>
          ${slider('secs', 'Length', 3, 60, 1, 12)}
          <div class="pst-row"><button data-a="play" class="is-primary">Play</button><button data-a="stop">Stop</button></div>
          <p class="pst-note">${MAX_KEYS} keys at most. Each key keeps the world frozen or running (and how fast) for the stretch after it. Playing hides everything; ${K('pause')} or a tap stops it.</p>
        </div>
        <p class="pst-keys"><kbd>${K('pitchDown')}${K('rollLeft')}${K('pitchUp')}${K('rollRight')}</kbd> move · <kbd>${K('yawLeft')}</kbd>/<kbd>${K('yawRight')}</kbd> down/up · drag to look · wheel lens · Shift fast ·
          <kbd>${K('trimDown')}</kbd> <kbd>${K('trimUp')}</kbd> roll, <kbd>${K('trimReset')}</kbd> level · <kbd>${K('brakes')}</kbd> freeze · <kbd>${K('guide')}</kbd> next frame · <kbd>${K('camera')}</kbd> snap ·
          <kbd>${K('lookBehind')}</kbd> orbit · <kbd>${K('starter')}</kbd> picture · <kbd>${K('hideUi')}</kbd> hide · <kbd>${K('pause')}</kbd> leave</p>
      </div>
    </section>
  </div>`);
  document.body.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const S = api.state;
  if (sim.touch || (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) root.classList.add('is-touch');
  api.pointerLayer($('[data-pic]'));
  // Nothing on the panel reaches the game's own pointer and mouse listeners (mouse flying, the touch look).
  for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup', 'wheel']) {
    $('[data-panel]').addEventListener(t, (e) => e.stopPropagation(), { passive: true });
  }

  let picked = null;
  const results = () => {
    const q = $('[data-q]').value;
    const list = api.search(q).slice(0, q ? 40 : 60);
    $('[data-results]').innerHTML = list.map((a) => `<div class="pst-item"><button data-type="${esc(a.id)}">${esc(a.name)}</button></div>`).join('');
  };
  const pick = (id) => {
    picked = id;
    const t = api.roster().find((a) => a.id === id);
    $('[data-add]').hidden = !t;
    if (!t) return;
    $('[data-add-name]').textContent = t.name;
    $('[data-paint]').innerHTML = api.paintsFor(id).map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  };

  const setV = (id, text) => { const b = $(`[data-v="${id}"]`); if (b) b.textContent = text; };
  const setS = (id, val) => { const i = $(`[data-s="${id}"]`); if (i && document.activeElement !== i) i.value = val; };

  function sync() {
    const k = S.cam;
    $('[data-a="freeze"]').textContent = S.frozen ? 'Run the world' : 'Freeze the world';
    $('[data-a="freeze"]').classList.toggle('is-on', !S.frozen);
    $('[data-a="step"]').disabled = !S.frozen;
    setS('scale', S.scale); setV('scale', `${S.scale.toFixed(2)}x`);
    const hr = sim.weather ? sim.weather.hour : 12;
    setS('hour', hr); setV('hour', clock(hr));
    $$('[data-sky]').forEach((b) => b.classList.toggle('is-on', b.dataset.sky === S.sky));
    $$('[data-cm]').forEach((b) => b.classList.toggle('is-on', b.dataset.cm === k.mode));
    $('[data-a="follow"]').classList.toggle('is-on', !!k.follow);
    $('[data-a="follow"]').disabled = k.mode === 'orbit';
    setS('speed', fromSpeed(k.speed)); setV('speed', `${Math.round(k.speed)} m/s`);
    setS('fov', Math.round(k.fov)); setV('fov', `${Math.round(k.fov)}°`);
    setS('roll', Math.round(k.roll * 57.2958)); setV('roll', `${Math.round(k.roll * 57.2958)}°`);
    const own = sim.aircraftType ? sim.aircraftType.name : 'aeroplane';
    $('[data-props]').innerHTML = [`<div class="pst-item"><button data-sel="own" class="${S.sel === 'own' ? 'is-on' : ''}">Your ${esc(own)}</button></div>`]
      .concat(S.props.map((p) => `<div class="pst-item"><button data-sel="${p.id}" class="${S.sel === p.id ? 'is-on' : ''}">${p.id}. ${esc(p.name)}</button><button class="x" data-del="${p.id}" aria-label="Remove ${esc(p.name)}">✕</button></div>`)).join('');
    const p = api.prop(S.sel);
    $('[data-edit]').hidden = !p;
    if (p) {
      setS('pitch', p.pitch); setV('pitch', `${Math.round(p.pitch)}°`);
      setS('bank', p.bank); setV('bank', `${Math.round(p.bank)}°`);
      setS('heading', Math.round(p.heading)); setV('heading', `${String(Math.round(p.heading) % 360).padStart(3, '0')}°`);
      setS('flaps', Math.round(p.flaps * 3)); setV('flaps', `${Math.round(p.flaps * 3)}`);
      setS('kt', p.speedKt); setV('kt', `${Math.round(p.speedKt)} kt`);
      $('[data-a="gear"]').classList.toggle('is-on', p.gear);
      $('[data-a="gear"]').textContent = p.gear ? 'Gear down' : 'Gear up';
      $('[data-a="engines"]').classList.toggle('is-on', p.engines);
      $('[data-a="ground"]').textContent = p.onGround ? 'Lift into the air' : 'Park on the ground';
      for (const id of ['pitch', 'bank', 'kt']) $(`[data-s="${id}"]`).disabled = p.onGround;
    }
    const tr = S.trailer;
    $('[data-keys]').innerHTML = tr.keys.map((key, i) => `<div class="pst-item"><button data-goto="${i}">Key ${i + 1} · ${key.frozen ? 'frozen' : `${key.scale.toFixed(2)}x`} · ${Math.round(key.fov)}°</button><button class="x" data-unkey="${i}" aria-label="Remove key ${i + 1}">✕</button></div>`).join('')
      || '<p class="pst-note">No keys yet: frame a shot, Add key, move, Add key again.</p>';
    $('[data-a="key"]').disabled = tr.keys.length >= MAX_KEYS;
    $('[data-a="play"]').disabled = tr.keys.length < 2 || tr.playing;
    $('[data-a="stop"]').disabled = !tr.playing;
    setS('secs', tr.seconds); setV('secs', `${tr.seconds} s`);
    $('[data-a="lb"]').classList.toggle('is-on', S.letterbox);
  }

  root.addEventListener('input', (e) => {
    const s = e.target.dataset && e.target.dataset.s;
    if (e.target.matches('[data-q]')) return results();
    if (!s) return;
    const v = Number(e.target.value);
    const p = api.prop(S.sel);
    if (s === 'scale') api.setScale(v);
    else if (s === 'hour') api.setHour(v);
    else if (s === 'speed') S.cam.speed = toSpeed(v);
    else if (s === 'fov') api.setFov(v);
    else if (s === 'roll') S.cam.roll = v / 57.2958;
    else if (s === 'secs') S.trailer.seconds = v;
    else if (p && s === 'pitch') api.edit(p.id, { pitch: v });
    else if (p && s === 'bank') api.edit(p.id, { bank: v });
    else if (p && s === 'heading') api.edit(p.id, { heading: v });
    else if (p && s === 'flaps') api.edit(p.id, { flaps: v / 3 });
    else if (p && s === 'kt') api.edit(p.id, { speedKt: v });
    sync();
  });

  root.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t || !root.contains(t)) return;
    const d = t.dataset;
    const p = api.prop(S.sel);
    if (d.a === 'min') $('[data-panel]').classList.toggle('is-min');
    else if (d.a === 'hide') api.setPanelHidden(true);
    else if (d.a === 'leave') api.close(sim);
    else if (d.a === 'freeze') api.setFrozen(!S.frozen);
    else if (d.a === 'step') api.stepFrame();
    else if (d.sky) api.setSky(d.sky);
    else if (d.cm) api.setCamMode(d.cm);
    else if (d.a === 'follow') { S.cam.follow = !S.cam.follow; S.cam.lastT = null; }
    else if (d.snap) api.snap(d.snap);
    else if (d.sel) api.select(d.sel === 'own' ? 'own' : Number(d.sel));
    else if (d.del) api.remove(Number(d.del));
    else if (d.type) pick(d.type);
    else if (d.at && picked) api.spawn(picked, { at: d.at, livery: $('[data-paint]').value });
    else if (p && d.a === 'gear') api.edit(p.id, { gear: !p.gear });
    else if (p && d.a === 'engines') api.edit(p.id, { engines: !p.engines });
    else if (p && d.a === 'ground') api.edit(p.id, { onGround: !p.onGround });
    else if (p && d.a === 'bring') api.bringToCamera(p.id);
    else if (d.a === 'shot') {
      const note = $('[data-shot-note]');
      api.shot().then((r) => { if (note) note.textContent = r ? `Saved: ${r.width}×${r.height} PNG.` : 'The picture could not be read.'; });
    } else if (d.a === 'lb') api.setLetterbox(!S.letterbox);
    else if (d.a === 'key') api.addKey();
    else if (d.unkey) api.removeKey(Number(d.unkey));
    else if (d.goto) api.gotoKey(Number(d.goto));
    else if (d.a === 'play') api.play();
    else if (d.a === 'stop') api.stop();
    if (S.on) sync();
  });

  // The sticks: a knob that follows the finger, -1..1 on each axis while it is held.
  for (const st of $$('[data-stick]')) {
    const knob = st.querySelector('i');
    let id = null;
    const set = (x, y) => {
      knob.style.transform = `translate(${x * 46}px, ${y * 46}px)`;
      if (st.dataset.stick === 'move') { S.touch.mx = x; S.touch.my = -y; } else { S.touch.lx = x; S.touch.ly = -y; }
    };
    const at = (e) => {
      const r = st.getBoundingClientRect();
      let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
      let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
      const m = Math.hypot(x, y);
      if (m > 1) { x /= m; y /= m; }
      set(x, y);
    };
    st.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); id = e.pointerId; st.setPointerCapture && st.setPointerCapture(id); at(e); });
    st.addEventListener('pointermove', (e) => { e.stopPropagation(); if (e.pointerId === id) at(e); });
    const end = (e) => { e.stopPropagation(); if (e.pointerId !== id) return; id = null; set(0, 0); };
    st.addEventListener('pointerup', end);
    st.addEventListener('pointercancel', end);
  }
  for (const b of $$('[data-ud]')) {
    const v = Number(b.dataset.ud);
    b.addEventListener('pointerdown', (e) => { e.stopPropagation(); S.touch.up = v; });
    for (const t of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(t, (e) => { e.stopPropagation(); if (S.touch.up === v) S.touch.up = 0; });
  }

  results();
  return {
    root,
    sync,
    setHidden(on) {
      root.classList.toggle('is-hidden', !!on);
    },
    setLetterbox(on) {
      const w = window.innerWidth;
      const hgt = window.innerHeight;
      const bar = Math.max(0, (hgt - w / 2.39) / 2);
      root.style.setProperty('--pst-lb', `${bar}px`);
      $$('[data-lb]').forEach((n) => { n.hidden = !on; });
    },
    destroy() {
      root.remove();
    },
  };
}

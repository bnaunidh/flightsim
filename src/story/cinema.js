/**
 * SIGNAL ZERO — cinema: letterbox, title cards, captions, the dialogue box
 * and short in-engine cutscenes.
 *
 * Generalised from features/events/afo-movie.js, which does this for Air
 * Force One alone: a thin, cheap overlay in the plug-in layer, every beat on
 * a clock counted in GAME seconds (through update()'s dt, so nothing runs on
 * while the game is paused) and cleared by itself. What the story adds:
 *
 *   - a DIALOGUE BOX: a portrait painted in code (portraits.js), a coloured
 *     name tag and the line as a subtitle. Radio lines also go out as the
 *     game's own formant chatter (text and subtitles only — no TTS unless
 *     the player has opted into it in Settings → Sound);
 *   - CUTSCENES: a camera rail (the chapter hands over a function of time),
 *     timed lines, big bars, the HUD hidden, the aircraft held still — all
 *     ≤ 20 s and all skippable: the "Skip cinematic" key, or the Skip button;
 *   - "Skip cinematics" in the story's settings turns every cutscene into a
 *     one-line caption;
 *   - RECAP and READY cards for Continue, and a FADE for a load.
 *
 * SEIZURE SAFETY (Reduce flashing): nothing here flashes. Bars slide, cards
 * and captions fade over 0.4-0.6 s, the fade-to-black is a smooth ramp, and
 * no element is ever shown and hidden faster than that. The flicker probe
 * (tests/flicker-probe.js) measures the screen, not the intent, so the
 * transitions are plain CSS and never shortened.
 *
 * Nothing here can fail a mission or block a control outside a cutscene: the
 * overlay is pointer-events: none except the Skip button.
 */

import { extLayer } from '../game/extensions.js';
import { isKey } from '../flight/input.js';
import { CAST, LINES } from './script.js';
import { portrait } from './portraits.js';

const CSS = `
#sz-cinema { position: fixed; inset: 0; pointer-events: none; z-index: 34; overflow: hidden;
  font-family: var(--font, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif); color: #f4f1e6; }
#sz-cinema[hidden] { display: none !important; }
#sz-cinema .sz-bar { position: absolute; left: 0; right: 0; background: #07070a; opacity: 0.94; height: 0;
  transition: height 0.45s cubic-bezier(.2,.7,.2,1); }
#sz-cinema .sz-bar.top { top: 0; } #sz-cinema .sz-bar.bot { bottom: 0; }
#sz-cinema.bars-big .sz-bar { height: 12.5%; }
#sz-cinema.bars-thin .sz-bar { height: 5.2%; }
#sz-cinema .sz-fade { position: absolute; inset: 0; background: #000; opacity: 0; transition: opacity 0.6s ease; }
#sz-cinema .sz-fade.on { opacity: 1; }

#sz-cinema .sz-card { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(92vw, 720px);
  text-align: center; opacity: 0; transition: opacity 0.55s ease; text-shadow: 0 2px 18px rgba(0,0,0,0.75); }
#sz-cinema .sz-card.on { opacity: 1; }
#sz-cinema .sz-card .sz-over { display: block; font-size: 12.5px; font-weight: 700; letter-spacing: 0.3em; text-transform: uppercase; color: #cdd6e4; margin-bottom: 10px; }
#sz-cinema .sz-card .sz-main { display: block; font-size: clamp(26px, 6vw, 46px); font-weight: 850; letter-spacing: 0.14em; text-transform: uppercase; line-height: 1.05; }
#sz-cinema .sz-card .sz-main .sz-o { color: #ffbf47; }
#sz-cinema .sz-card .sz-sub { display: block; margin-top: 10px; font-size: 13px; font-weight: 650; letter-spacing: 0.22em; text-transform: uppercase; color: #cdd6e4; }
#sz-cinema .sz-card .sz-lines { display: block; margin: 14px auto 0; max-width: 560px; font-size: 17px; line-height: 1.5; color: #eaf1fb; letter-spacing: 0; text-transform: none; font-weight: 500; }
#sz-cinema .sz-card .sz-lines p { margin: 0 0 4px; }
#sz-cinema .sz-card .sz-foot { display: block; margin-top: 14px; font-size: 12px; letter-spacing: 0.18em; text-transform: uppercase; color: #ffbf47; font-weight: 700; }
#sz-cinema .sz-card.is-ready .sz-main { color: #7ee8b2; }

/*
 * Clear of the HUD's controls: the caption chip, the lower third and the
 * dialogue box sit above the bottom lane the HUD measures (--bl-wide, the
 * top of the highest control across the middle of the screen: the engine
 * strip, the thumb pads, the stick — ui/hud.js updateLanes()). At their old
 * fixed places the box sat on the engine strip and covered the PAPI pill,
 * and on a tablet it covered the stick and the throttle.
 */
#sz-cinema .sz-chip { position: absolute; left: 50%; bottom: max(7%, calc(var(--bl-wide, 0px) + 10px)); transform: translateX(-50%); opacity: 0; transition: opacity 0.4s ease;
  font: 800 13px/1 var(--font, sans-serif); letter-spacing: 0.16em; text-transform: uppercase; white-space: nowrap; text-shadow: 0 1px 10px rgba(0,0,0,0.8); }
#sz-cinema .sz-chip.on { opacity: 1; }
/* U (the player's clean shot, ui/hud.js setCleanShot()) takes the caption and the lower third too. */
html.ui-clean #sz-cinema .sz-chip, html.ui-clean #sz-cinema .sz-third { opacity: 0 !important; }
#sz-cinema .sz-third { position: absolute; left: 4%; bottom: max(14%, calc(var(--bl-wide, 0px) + 116px)); opacity: 0; transition: opacity 0.4s ease; padding: 8px 14px 8px 12px;
  background: linear-gradient(90deg, rgba(7,7,10,0.9), rgba(7,7,10,0)); border-left: 3px solid #ffbf47;
  font: 700 14px/1.2 var(--font, sans-serif); letter-spacing: 0.14em; text-transform: uppercase; }
#sz-cinema .sz-third.on { opacity: 1; }

#sz-cinema .sz-dlg { position: absolute; left: 50%; bottom: max(60px, calc(var(--bl-wide, 0px) + 14px)); transform: translateX(-50%);
  width: min(760px, calc(100vw - 24px)); box-sizing: border-box;
  display: flex; align-items: flex-end; gap: 12px; opacity: 0; transition: opacity 0.4s ease; }
#sz-cinema .sz-dlg.on { opacity: 1; }
#sz-cinema .sz-dlg .sz-por { width: 76px; height: 76px; flex: none; border-radius: 50%; overflow: hidden; background: #0b1220;
  box-shadow: 0 6px 22px rgba(0,0,0,0.6); }
#sz-cinema .sz-dlg .sz-por canvas { width: 100%; height: 100%; display: block; }
#sz-cinema .sz-dlg .sz-box { flex: 1; min-width: 0; background: rgba(6,10,18,0.86); border: 1px solid rgba(140,180,230,0.22); border-radius: 12px;
  padding: 9px 14px 11px; backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
/* The name and the role wrap inside the box: "LARK · you · Harbourlight
   Charter" on one unbreakable flex line ran off the right of a narrow window. */
#sz-cinema .sz-dlg .sz-who { font-size: 11.5px; font-weight: 800; letter-spacing: 0.14em; text-transform: uppercase; margin-bottom: 3px;
  display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; min-width: 0; }
#sz-cinema .sz-dlg .sz-who small { font-weight: 600; letter-spacing: 0.04em; text-transform: none; color: #9fb2cc; min-width: 0; overflow-wrap: anywhere; }
#sz-cinema .sz-dlg .sz-text { overflow-wrap: break-word; }
#sz-cinema .sz-dlg .sz-text { font-size: 17px; line-height: 1.38; color: #eaf1fb; }
#sz-cinema .sz-dlg.is-range .sz-text { font-family: var(--mono, ui-monospace, Menlo, monospace); letter-spacing: 0.04em; color: #ffd6d6; }
#sz-cinema .sz-dlg.is-room .sz-box { border-color: rgba(255,191,71,0.35); }

#sz-cinema .sz-skip { position: absolute; right: 18px; bottom: 14%; pointer-events: auto; opacity: 0; transition: opacity 0.4s ease;
  background: rgba(6,10,18,0.78); color: #eaf1fb; border: 1px solid rgba(140,180,230,0.3); border-radius: 999px; padding: 8px 14px;
  font: 700 12px/1 var(--font, sans-serif); letter-spacing: 0.12em; text-transform: uppercase; cursor: pointer; }
#sz-cinema .sz-skip.on { opacity: 1; }
#sz-cinema .sz-skip:focus-visible { outline: 2px solid #fff; }
@media (max-width: 720px) { #sz-cinema .sz-dlg { gap: 8px; } #sz-cinema .sz-dlg .sz-por { width: 56px; height: 56px; } #sz-cinema .sz-dlg .sz-text { font-size: 15px; } }
@media (max-width: 480px) { #sz-cinema .sz-dlg .sz-por { width: 44px; height: 44px; } #sz-cinema .sz-dlg .sz-box { padding: 7px 10px 9px; } #sz-cinema .sz-dlg .sz-text { font-size: 14px; } }
@media (prefers-reduced-motion: reduce) { #sz-cinema .sz-bar, #sz-cinema .sz-card, #sz-cinema .sz-chip, #sz-cinema .sz-third, #sz-cinema .sz-dlg, #sz-cinema .sz-fade { transition: none; } }
`;

const C = {
  sim: null,
  el: null,
  bars: null, // 'big' | 'thin' | null
  card: null, // { kind, left, ... }
  cardQueue: [],
  chip: null,
  third: null,
  dlg: null, // { id, who, left }
  dlgQueue: [],
  cutscene: null, // { def, t, done, resolve }
  hold: null, // { pos, quat, vel } the aircraft is held at
  fade: 0, // seconds of black left (0 = none)
  skipCinematics: false,
  log: [], // what was shown, for the tests
};

function readSeconds(text) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean).length;
  return 1.4 + words * 0.36;
}

function build() {
  if (C.el || typeof document === 'undefined') return C.el;
  if (!document.getElementById('sz-cinema-style')) {
    const st = document.createElement('style');
    st.id = 'sz-cinema-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.id = 'sz-cinema';
  root.hidden = true;
  root.innerHTML = `
    <div class="sz-fade"></div>
    <div class="sz-bar top"></div>
    <div class="sz-bar bot"></div>
    <div class="sz-card"><span class="sz-over" data-over></span><span class="sz-main" data-main></span><span class="sz-sub" data-sub></span><span class="sz-lines" data-lines></span><span class="sz-foot" data-foot></span></div>
    <div class="sz-chip" data-chip></div>
    <div class="sz-third" data-third></div>
    <div class="sz-dlg"><div class="sz-por" data-por></div><div class="sz-box"><div class="sz-who" data-who></div><div class="sz-text" data-text></div></div></div>
    <button class="sz-skip" type="button" data-sz-skip>Skip ▸</button>`;
  extLayer().appendChild(root);
  C.el = {
    root,
    fade: root.querySelector('.sz-fade'),
    card: root.querySelector('.sz-card'),
    over: root.querySelector('[data-over]'),
    main: root.querySelector('[data-main]'),
    sub: root.querySelector('[data-sub]'),
    lines: root.querySelector('[data-lines]'),
    foot: root.querySelector('[data-foot]'),
    chip: root.querySelector('[data-chip]'),
    third: root.querySelector('[data-third]'),
    dlg: root.querySelector('.sz-dlg'),
    por: root.querySelector('[data-por]'),
    who: root.querySelector('[data-who]'),
    text: root.querySelector('[data-text]'),
    skip: root.querySelector('[data-sz-skip]'),
  };
  C.el.skip.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    skip();
  });
  return C.el;
}

export function installCinema(sim) {
  C.sim = sim;
  build();
}

function show() {
  const e = build();
  if (e) e.root.hidden = false;
}

function maybeHide() {
  const e = C.el;
  if (!e) return;
  if (!C.bars && !C.card && !C.cardQueue.length && !C.chip && !C.third && !C.dlg && !C.dlgQueue.length && !C.cutscene && C.fade <= 0) {
    e.root.hidden = true;
  }
}

/* ---------------------------------------------------------------- bars */

export function bars(kind) {
  const e = build();
  C.bars = kind || null;
  /*
   * The HUD makes room for the bars instead of being covered by them:
   * html[data-cine] insets the HUD's wrapper by the bars' height (main.css),
   * so the airspeed, the objective's title, the wind, the engine strip and
   * the dock all step inside the picture rather than lose 24 px under it.
   */
  if (typeof document !== 'undefined' && document.documentElement && document.documentElement.dataset) {
    if (kind) document.documentElement.dataset.cine = kind;
    else delete document.documentElement.dataset.cine;
  }
  if (!e) return;
  e.root.classList.toggle('bars-big', kind === 'big');
  e.root.classList.toggle('bars-thin', kind === 'thin');
  if (kind) show();
}

/* ---------------------------------------------------------------- cards */

/**
 * A title card: `main` ("THE GLINT"), `sub` ("CONDOR ROCK · 23:41"), an
 * `over` line above ("CHAPTER 1"), for `dur` game seconds. `bars` puts the
 * letterbox up with it ('thin' by default: you keep flying). Cards queue.
 * `wordmark` draws the O of SIGNAL ZERO as the kittiwake colour.
 */
export function titleCard({ main = '', sub = '', over = '', dur = 4, bars: b = 'thin', wordmark = false, lines = null, foot = '', kind = 'title' } = {}) {
  if (C.cardQueue.length > 6) return;
  C.cardQueue.push({ kind, main, sub, over, dur, bars: b, wordmark, lines, foot });
  C.log.push({ t: performance.now(), kind: 'card', main });
  showNextCard();
}

/** "PREVIOUSLY ON SIGNAL ZERO…": three lines and the checkpoint name. */
export function recapCard({ lines = [], checkpoint = '', dur = 8 } = {}) {
  titleCard({ kind: 'recap', over: 'Previously on', main: 'SIGNAL ZERO', wordmark: true, lines, foot: checkpoint ? `Checkpoint: ${checkpoint}` : '', dur, bars: 'big' });
}

/** The READY moment: controls frozen, one line, then play. */
export function readyCard({ objective = '', dur = 1.8 } = {}) {
  titleCard({ kind: 'ready', main: 'READY', lines: objective ? [objective] : null, dur, bars: 'thin' });
}

function showNextCard() {
  const e = build();
  if (!e || C.card || !C.cardQueue.length) return;
  const c = C.cardQueue.shift();
  C.card = { ...c, left: c.dur };
  e.over.textContent = c.over || '';
  e.over.style.display = c.over ? '' : 'none';
  if (c.wordmark && /SIGNAL ZERO/.test(c.main)) {
    e.main.innerHTML = c.main.replace('SIGNAL ZERO', 'SIGNAL ZER<span class="sz-o">O</span>');
  } else {
    e.main.textContent = c.main || '';
  }
  e.sub.textContent = c.sub || '';
  e.sub.style.display = c.sub ? '' : 'none';
  e.lines.innerHTML = c.lines && c.lines.length ? c.lines.filter(Boolean).map((l) => `<p>${esc(l)}</p>`).join('') : '';
  e.lines.style.display = c.lines && c.lines.length ? '' : 'none';
  e.foot.textContent = c.foot || '';
  e.foot.style.display = c.foot ? '' : 'none';
  e.card.classList.toggle('is-ready', c.kind === 'ready');
  e.card.classList.add('on');
  if (c.bars && !C.cutscene) bars(c.bars);
  show();
}

function clearCard() {
  const e = C.el;
  C.card = null;
  if (!e) return;
  e.card.classList.remove('on');
  if (!C.cutscene && !C.cardQueue.length) bars(null);
}

/* ------------------------------------------------------- chip and third */

export function caption(text, dur = 2) {
  const e = build();
  if (!e) return;
  C.chip = { left: dur };
  e.chip.textContent = text;
  e.chip.classList.add('on');
  show();
}

export function lowerThird(text, dur = 4) {
  const e = build();
  if (!e) return;
  C.third = { left: dur };
  e.third.textContent = text;
  e.third.classList.add('on');
  show();
}

/* ------------------------------------------------------------- dialogue */

/**
 * Say a scripted line (by id, or a literal { who, text, radio }). Lines
 * queue; each shows for as long as it takes to read. Radio lines also go out
 * through the game's radio as chatter, with the HUD's own subtitle off so the
 * line is not shown twice.
 */
export function say(idOrLine, { dur = null, urgency = 0 } = {}) {
  const l = typeof idOrLine === 'string' ? LINES[idOrLine] : idOrLine;
  if (!l || !l.text) return;
  if (C.dlgQueue.length > 8) C.dlgQueue.shift();
  C.dlgQueue.push({ id: typeof idOrLine === 'string' ? idOrLine : null, who: l.who, text: l.text, radio: l.radio !== false, dur, urgency });
  showNextLine();
}

function showNextLine() {
  const e = build();
  if (!e || C.dlg || !C.dlgQueue.length) return;
  const l = C.dlgQueue.shift();
  const who = CAST[l.who] || CAST.lark;
  const dur = Math.max(2.6, l.dur || readSeconds(l.text));
  C.dlg = { ...l, left: dur };
  C.log.push({ t: performance.now(), kind: 'line', id: l.id, who: l.who });
  e.por.innerHTML = '';
  try {
    e.por.appendChild(portrait(l.who, 152));
  } catch (err) {
    /* no portrait is fine */
  }
  e.who.innerHTML = `<span style="color:${who.colour}">${esc(who.name)}</span>${who.role ? `<small>${esc(who.role)}</small>` : ''}`;
  e.text.textContent = l.text;
  e.dlg.classList.toggle('is-range', l.who === 'range');
  e.dlg.classList.toggle('is-room', !l.radio);
  e.dlg.classList.add('on');
  // While a story line is up it IS the subtitle: the HUD's radio line (the
  // tower, say) steps out rather than print a second line under the box.
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.classList.add('sz-talking');
  show();
  // The radio: the game's own formant chatter, muted or not as the player
  // has it. Its subtitle is off because the box above IS the subtitle.
  const sim = C.sim;
  if (l.radio && sim && sim.audio && sim.audio.available && sim.audio.radio) {
    try {
      sim.audio.radio.transmit(l.text, { voice: who.voice || 'tower', urgency: l.urgency || 0, subtitle: false });
    } catch (err) {
      /* silence is fine */
    }
  }
}

function clearLine() {
  const e = C.el;
  C.dlg = null;
  if (e) e.dlg.classList.remove('on');
  if (typeof document !== 'undefined' && document.documentElement) document.documentElement.classList.remove('sz-talking');
}

/* ------------------------------------------------------------ cutscenes */

/**
 * Play a cutscene. Resolves when it ends or is skipped.
 *
 *   def = {
 *     id, dur,                       // ≤ 20 s
 *     bars: 'big' | 'thin',          // 'big' hides most of the HUD's edges; thin keeps you flying
 *     hideHud: true,                 // the HUD goes away for the scene
 *     hold: true,                    // the aircraft is held still where it is
 *     camera(t01, camera, sim),      // place the camera; omit to leave the game's own
 *     beats: [{ at, line }, { at, caption }, { at, fn(sim) }],   // in game seconds from the start
 *     caption,                       // what the one-line version says when cinematics are skipped
 *   }
 */
export function playCutscene(def) {
  const sim = C.sim;
  if (C.cutscene) skip();
  if (C.skipCinematics) {
    if (def.caption) caption(def.caption, 2.4);
    for (const b of def.beats || []) if (b.fn) safe(() => b.fn(sim));
    return Promise.resolve('skipped-setting');
  }
  return new Promise((resolve) => {
    C.cutscene = { def, t: 0, fired: new Set(), resolve, hudWasHidden: false };
    C.log.push({ t: performance.now(), kind: 'cutscene', id: def.id });
    bars(def.bars || 'big');
    show();
    if (def.hideHud && sim && sim.hud) {
      C.cutscene.hudWasHidden = !!sim.hud.hidden;
      sim.hud.setHidden(true);
    }
    if (def.hold) holdStill(true);
    const e = C.el;
    if (e) e.skip.classList.add('on');
  });
}

function endCutscene(how) {
  const cs = C.cutscene;
  if (!cs) return;
  C.cutscene = null;
  const sim = C.sim;
  // Lines queued by the scene that never showed: drop them — the scene is over.
  C.dlgQueue.length = 0;
  clearLine();
  if (cs.def.hideHud && sim && sim.hud && !cs.hudWasHidden) sim.hud.setHidden(false);
  if (cs.def.hold) holdStill(false);
  const e = C.el;
  if (e) e.skip.classList.remove('on');
  if (!C.card && !C.cardQueue.length) bars(null);
  C.log.push({ t: performance.now(), kind: 'cutscene-end', id: cs.def.id, how });
  safe(() => cs.resolve(how));
}

/** The Skip key or button: clears whatever is up right now. */
export function skip() {
  if (C.cutscene) {
    // Fire anything the scene still had to do (a flag, a save), then end it.
    const cs = C.cutscene;
    for (const b of cs.def.beats || []) if (b.fn && !cs.fired.has(b)) {
      cs.fired.add(b);
      safe(() => b.fn(C.sim));
    }
    endCutscene('skipped');
    return true;
  }
  if (C.card) {
    clearCard();
    showNextCard();
    return true;
  }
  if (C.dlg) {
    clearLine();
    showNextLine();
    return true;
  }
  return false;
}

/* ----------------------------------------------------------------- hold */

/**
 * Hold the aircraft exactly where it is. The physics still steps (nothing
 * here reaches into main.js), so the pose is written back after each frame:
 * a drift of a few centimetres a frame, undone before it is drawn.
 */
export function holdStill(on) {
  const sim = C.sim;
  const ac = sim && sim.aircraft;
  if (!on || !ac) {
    C.hold = null;
    return;
  }
  C.hold = { pos: ac.pos.clone(), quat: ac.quat.clone(), vel: ac.vel.clone(), onGround: ac.onGround };
}

function applyHold() {
  const sim = C.sim;
  const ac = sim && sim.aircraft;
  const h = C.hold;
  if (!ac || !h) return;
  ac.pos.copy(h.pos);
  ac.quat.copy(h.quat);
  ac.vel.copy(h.vel);
  if (ac.omega) ac.omega.set(0, 0, 0);
  ac.onGround = h.onGround;
}

/* ----------------------------------------------------------------- fade */

/** A smooth fade to black for `seconds`, covering a load. Never a cut. */
export function fadeBlack(seconds = 1.2) {
  const e = build();
  if (!e) return;
  C.fade = seconds;
  e.fade.classList.add('on');
  show();
}

/* --------------------------------------------------------------- update */

export function update(sim, dt) {
  if (!(dt > 0)) return;
  dt = Math.min(dt, 0.1);
  const cs = C.cutscene;
  if (cs) {
    cs.t += dt;
    for (const b of cs.def.beats || []) {
      if (cs.fired.has(b) || cs.t < (b.at || 0)) continue;
      cs.fired.add(b);
      if (b.line) say(b.line, { dur: b.dur || null });
      if (b.caption) caption(b.caption, b.dur || 2.2);
      if (b.third) lowerThird(b.third, b.dur || 4);
      if (b.fn) safe(() => b.fn(sim));
    }
    if (cs.t >= (cs.def.dur || 10)) endCutscene('ended');
  }
  if (C.hold) applyHold();
  if (C.card) {
    C.card.left -= dt;
    if (C.card.left <= 0) {
      clearCard();
      showNextCard();
    }
  } else showNextCard();
  if (C.chip) {
    C.chip.left -= dt;
    if (C.chip.left <= 0) {
      C.chip = null;
      if (C.el) C.el.chip.classList.remove('on');
    }
  }
  if (C.third) {
    C.third.left -= dt;
    if (C.third.left <= 0) {
      C.third = null;
      if (C.el) C.el.third.classList.remove('on');
    }
  }
  if (C.dlg) {
    C.dlg.left -= dt;
    if (C.dlg.left <= 0) {
      clearLine();
      showNextLine();
    }
  } else showNextLine();
  if (C.fade > 0) {
    C.fade -= dt;
    if (C.fade <= 0 && C.el) C.el.fade.classList.remove('on');
  }
  maybeHide();
}

/** The camera hook: true while a cutscene owns the camera. */
export function cameraHook(sim, dt, camera) {
  const cs = C.cutscene;
  if (!cs || typeof cs.def.camera !== 'function') return false;
  const t01 = Math.min(1, cs.t / Math.max(0.01, cs.def.dur || 10));
  try {
    cs.def.camera(t01, camera, sim, cs.t);
  } catch (e) {
    return false;
  }
  return true;
}

/**
 * Keys while a cutscene plays: the skip key skips; everything else is eaten
 * so the parked aeroplane never taxis off during the hangar scene. Outside a
 * cutscene, the skip key clears a card or a line and nothing else is touched.
 */
export function handleKey(sim, code, down) {
  if (!down) return !!C.cutscene;
  if (isKey(sim, 'eventSkip', code)) return skip();
  if (C.cutscene) return code !== 'Escape';
  return false;
}

/** Everything down, now (the flight ended, or the menu came up). */
export function hideAll() {
  C.cardQueue.length = 0;
  C.dlgQueue.length = 0;
  if (C.cutscene) endCutscene('aborted');
  clearCard();
  clearLine();
  C.chip = null;
  C.third = null;
  C.hold = null;
  C.fade = 0;
  bars(null);
  const e = C.el;
  if (e) {
    e.chip.classList.remove('on');
    e.third.classList.remove('on');
    e.fade.classList.remove('on');
    e.skip.classList.remove('on');
    e.root.hidden = true;
  }
}

/** The pause menu is up: keep the bars out of its way (and bring them back after). */
export function setSuspended(on) {
  const e = C.el;
  if (!e) return;
  if (on) e.root.hidden = true;
  else if (C.bars || C.card || C.dlg || C.cutscene || C.chip || C.third) e.root.hidden = false;
}

export function setSkipCinematics(on) {
  C.skipCinematics = !!on;
}

/** For the tests: what is on screen, and what has been. */
export function cinemaState() {
  return {
    bars: C.bars,
    card: C.card ? C.card.main : null,
    cardKind: C.card ? C.card.kind : null,
    line: C.dlg ? C.dlg.id || C.dlg.text : null,
    cutscene: C.cutscene ? C.cutscene.def.id : null,
    hold: !!C.hold,
    queued: C.cardQueue.length + C.dlgQueue.length,
    log: C.log.slice(-60),
  };
}

export function clearLog() {
  C.log.length = 0;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function safe(fn) {
  try {
    fn();
  } catch (e) {
    console.warn('[story] a cutscene beat threw and was skipped:', e);
  }
}

/**
 * The cargo ramp, in the game (owner, 2026-10-21: the C-17's "rear cargo
 * ramp you can open"). The ramp itself is drawn and moved by the model
 * (src/fleet/extra/c17.js, userData.cargo); this file is everything round
 * it:
 *
 *   the key    6 — open / close (Settings → Controls → Flying, like every key)
 *   the rule   on the ground, any time; in the air only under 150 kt, and
 *              above 165 kt with it open it closes itself — the real C-17
 *              drops cargo with the ramp open at about 130-150 kt, and
 *              nothing here is allowed to be a way to lose the aeroplane
 *   the panel  one line: "Cargo ramp · Closed" and a small Open button with
 *              its keycap; a thin bar only while it moves, the speed rule
 *              only after a refusal. On a touch screen a pad among the
 *              others instead (every new action needs one). Steady colours.
 *   the words  once each, through the HUD's own notes
 *
 * Nothing here is written for the C-17 by name: a type with `cargoRamp:
 * true` in its roster entry whose model exports userData.cargo gets it.
 * `rampRule()` is the decision on its own, for the node test.
 */
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey, keyName, bindingsVersion } from '../flight/input.js';

registerActions({
  cargoRamp: { label: 'Cargo ramp open / close (airlifters)', group: 'Flying', ctx: ['plane'], default: ['Digit6'] },
});

const KT = 1.94384;
/** Open it in the air only under this. */
export const RAMP_OPEN_KT = 150;
/** With it open, faster than this and it closes itself. */
export const RAMP_SHUT_KT = 165;

/**
 * What a press does, from the aeroplane's state and the ramp's: 'closing'
 * (it was open or opening), 'opening', or 'refused' (too fast in the air).
 * Pure: the model and the words are applied by the caller.
 */
export function rampRule({ onGround, kt, target }) {
  if (target > 0.5) return { action: 'closing', note: 'Ramp closing.' };
  if (!onGround && kt > RAMP_OPEN_KT) {
    return { action: 'refused', note: `Too fast for the ramp — slow to under ${RAMP_OPEN_KT} knots first.`, kind: 'warn' };
  }
  return {
    action: 'opening',
    note: onGround ? 'Ramp coming down.' : `Ramp opening — keep it under ${RAMP_OPEN_KT} knots.`,
  };
}

/** True when the ramp should shut itself: open or opening, airborne, and fast. */
export function rampMustShut({ onGround, kt, target }) {
  return target > 0.5 && !onGround && kt > RAMP_SHUT_KT;
}

const hasRamp = (sim) => !!(sim && sim.aircraftType && sim.aircraftType.cargoRamp && sim.state !== 'menu');
function cargoOf(sim) {
  const m = sim && sim.model;
  return (m && m.userData && m.userData.cargo) || null;
}
/** Out of the cockpit: driving, walking, or the parked aeroplane held by the on-foot override. */
function outOfCockpit(sim) {
  if (sim.mode === 'drive') return true;
  const f = sim.onFoot || sim.onfoot || sim.walking;
  if (f && (f === true || f.active === true || f.on === true)) return true;
  return false;
}
const flying = (sim) => hasRamp(sim) && !outOfCockpit(sim);

function notify(sim, text, kind = 'info', seconds = 4) {
  try { sim && sim.hud && sim.hud.notify(text, kind, seconds); } catch (e) { void e; }
}

const S = { ui: null, shown: '', groundStart: false, shutSaid: false, last: null };

/** A press of the key or the button. Returns the rule's action. */
export function pressRamp(sim) {
  const cargo = cargoOf(sim);
  const ac = sim && sim.aircraft;
  if (!cargo || !ac) return 'none';
  const r = rampRule({ onGround: !!ac.onGround, kt: (ac.ias || 0) * KT, target: cargo.target });
  if (r.action === 'opening') cargo.open();
  else if (r.action === 'closing') cargo.close();
  notify(sim, r.note, r.kind || 'info');
  // The speed rule on the card, only now that it has mattered.
  if (S.ui) S.ui.noteT = r.action === 'refused' ? NOTE_S : 0;
  S.last = r.action;
  return r.action;
}

/* --- the panel --- */
/*
 * One line in the right-hand column (owner, 2026-10-25: "too big"): "Cargo
 * ramp · Closed" and a small Open button with the key on a keycap. A thin
 * bar under it only while the ramp is moving; "Under 150 kt in the air" only
 * after an open has been refused, for a few seconds. It was a 136 px card of
 * four rows — heading, state badge, bar, a full-width button and a note —
 * every second of every C-17 flight.
 */
const CSS = `
.ramp-panel { position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
  padding: 5px 5px 5px 10px; border-radius: 99px; background: rgba(12,20,34,.72);
  border: 1px solid var(--panel-line, rgba(140,180,230,.18)); color: var(--text, #eaf1fb);
  font: 600 12px/1.2 var(--font, system-ui, sans-serif); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px); display: none; user-select: none; }
.ramp-panel.is-shown { display: block; }
/* On a narrow column (a phone held upright) the button wraps under the line, to the right, rather than off the screen. */
.ramp-row { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; white-space: nowrap; }
.ramp-name { color: var(--text-dim, #9fb2cc); font-weight: 600; }
.ramp-dot { color: var(--text-dim, #9fb2cc); opacity: .7; }
.ramp-state { font-weight: 700; color: #dfe7f1; }
.ramp-state.is-open { color: #bfe6ff; }
.ramp-state.is-moving { color: #ffe6b3; }
.ramp-btn { pointer-events: auto; margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
  padding: 3px 4px 3px 9px; border-radius: 99px; border: 1px solid rgba(140,180,230,.35);
  background: rgba(88,198,255,.10); color: inherit; cursor: pointer; font: 700 11.5px/1 var(--font, system-ui, sans-serif);
  touch-action: manipulation; }
.ramp-btn:hover { background: rgba(88,198,255,.18); }
.ramp-btn kbd { font: 700 10px/1 var(--mono, ui-monospace, monospace); min-width: 16px; padding: 2px 4px 1px;
  text-align: center; border-radius: 5px; border: 1px solid rgba(255,255,255,.22); border-bottom-width: 2px;
  background: rgba(255,255,255,.08); color: #eaf1fb; }
.ramp-btn kbd:empty { display: none; }
.ramp-bar { display: none; position: relative; height: 3px; margin: 5px 6px 1px 0; border-radius: 2px; background: rgba(255,255,255,.1); overflow: hidden; }
.ramp-panel.is-moving .ramp-bar { display: block; }
.ramp-bar i { position: absolute; left: 0; top: 0; bottom: 0; width: 0; background: #58c6ff; border-radius: 2px; }
.ramp-note { margin: 4px 6px 1px 0; font-size: 10.5px; color: #ffe6b3; }
.ramp-note[hidden] { display: none; }
.ramp-panel.has-note, .ramp-panel.is-moving { border-radius: 14px; }
/* In the HUD's right-hand column (ui/hud-stack.js), which places it: no centring of its own,
   and against the right edge like a chip rather than stretched to the column. */
.hud-rstack > .ramp-panel { transform: none; align-self: flex-end; }
.hud-rstack > .ramp-panel:not(.is-shown) { display: none !important; }
`;

/** Seconds the "under 150 kt" line stays after a refused open. */
const NOTE_S = 4;

function buildUi(sim) {
  if (S.ui || typeof document === 'undefined') return S.ui;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.className = 'ramp-panel';
  panel.innerHTML = `
    <div class="ramp-row"><span class="ramp-name">Cargo ramp</span><span class="ramp-dot" aria-hidden="true">·</span><span class="ramp-state">Closed</span><button class="ramp-btn" type="button" aria-label="Cargo ramp open or close"><span class="ramp-act">Open</span><kbd class="ramp-key"></kbd></button></div>
    <div class="ramp-bar"><i></i></div>
    <div class="ramp-note" hidden>Under ${RAMP_OPEN_KT} kt in the air</div>`;
  extLayer().appendChild(panel);
  joinStack(sim, panel);
  const q = (s) => panel.querySelector(s);
  const btn = q('.ramp-btn');
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (flying(sim)) pressRamp(sim);
  });
  S.ui = {
    panel, state: q('.ramp-state'), bar: q('.ramp-bar i'), btn, act: q('.ramp-act'), key: q('.ramp-key'), note: q('.ramp-note'), noteT: 0,
    touch: !!sim.touch || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches),
    pad: null,
  };
  syncKeys(sim);
  return S.ui;
}

/*
 * On a touch screen the ramp is a pad among the others (ui/touch.js: BRAKES,
 * the engine, GEAR, FLAPS, the camera), not a card: the card in the right-hand
 * column of a phone held sideways pushed the notices down over those very
 * pads. Appended after the camera pad, so it takes the empty cell beside it
 * and nothing under a thumb moves. Like the engine pad it says what a press
 * will do — OPEN RAMP, CLOSE RAMP — and lights while the ramp is down or moving.
 */
function buildPad(sim) {
  const ui = S.ui;
  if (!ui || ui.pad || !sim || typeof document === 'undefined') return ui && ui.pad;
  // ui/touch.js builds the pads only on a touch screen; on a desktop there are none.
  const pads = ((sim.touch && sim.touch.layer) || document).querySelector('.touch-pads');
  if (!pads) return null;
  const pad = document.createElement('button');
  pad.type = 'button';
  pad.className = 'touch-pad is-wing ramp-pad';
  pad.textContent = 'OPEN RAMP';
  pad.setAttribute('aria-label', 'Cargo ramp open or close');
  pad.hidden = true;
  pad.addEventListener('click', (e) => {
    e.preventDefault();
    pad.blur();
    if (flying(sim)) pressRamp(sim);
  });
  pads.appendChild(pad);
  ui.pad = pad;
  return pad;
}

/*
 * A card in the HUD's right-hand column (sim.hud.stack, ui/hud-stack.js), as
 * the carrier's ball and the autopilot are: with its own `right: 18px; top:
 * 50%` it sat on the notices — on a phone held sideways, on the very note
 * that tells you to press the RAMP button. Under the warnings and the
 * mission's own panels, above the notices; never folded (it has a button).
 * The HUD may come after this file's install, so update() tries again; in the
 * Node tests' mock game there is no stack and it stays in the layer.
 */
function joinStack(sim, panel) {
  const stack = sim && sim.hud && sim.hud.stack;
  if (!panel || !stack || typeof stack.add !== 'function' || !stack.el) return false;
  if (panel.parentNode !== stack.el) stack.add(panel, { prio: 1.5, id: 'cargo-ramp', chip: false });
  return true;
}

function syncKeys(sim) {
  const ui = S.ui;
  if (!ui || ui.keysVer === bindingsVersion()) return;
  ui.keysVer = bindingsVersion();
  // The keycap: the key that does it. None on a touch screen (the button is tapped).
  ui.key.textContent = ui.touch ? '' : keyName('cargoRamp', sim);
}

function updateUi(sim, on) {
  const ui = S.ui;
  if (!ui) return;
  if (on && !ui.stacked) ui.stacked = joinStack(sim, ui.panel);
  if (on && !ui.pad) buildPad(sim);
  const show = on && sim.state === 'flying' && !(sim.hud && (sim.hud.enabled === false || sim.hud.hidden));
  // With a pad (a touch screen) the pad is the control and the card stays away.
  const card = show && !ui.pad;
  if (ui.panel.classList.contains('is-shown') !== card) ui.panel.classList.toggle('is-shown', card);
  if (ui.pad && ui.pad.hidden === show) ui.pad.hidden = !show;
  if (!show) return;
  syncKeys(sim);
  const cargo = cargoOf(sim);
  const state = cargo ? cargo.state : 'closed';
  const pct = Math.round((cargo ? cargo.amount() : 0) * 100);
  const noted = ui.noteT > 0;
  const key = `${state}|${pct}|${noted}`;
  if (key === S.shown) return;
  S.shown = key;
  const moving = state === 'opening' || state === 'closing';
  ui.panel.classList.toggle('is-moving', moving);
  ui.panel.classList.toggle('has-note', noted);
  if (ui.note.hidden === noted) ui.note.hidden = !noted;
  if (ui.pad) {
    ui.pad.textContent = cargo && cargo.target > 0.5 ? 'CLOSE RAMP' : 'OPEN RAMP';
    ui.pad.classList.toggle('is-on', state !== 'closed');
  }
  ui.state.textContent = state.charAt(0).toUpperCase() + state.slice(1);
  ui.state.classList.toggle('is-open', state === 'open');
  ui.state.classList.toggle('is-moving', moving);
  ui.bar.style.width = `${pct}%`;
  ui.act.textContent = cargo && cargo.target > 0.5 ? 'Close' : 'Open';
}

function off() {
  S.shown = '';
  S.shutSaid = false;
  if (S.ui) S.ui.noteT = 0;
  if (S.ui) S.ui.panel.classList.remove('is-shown');
  if (S.ui && S.ui.pad) S.ui.pad.hidden = true;
}

registerExtension({
  id: 'cargo-ramp',
  install(sim) {
    buildUi(sim);
  },
  startMode(sim, mode) {
    off();
    S.groundStart = mode !== 'drive' && hasRamp(sim);
  },
  stop() {
    off();
  },
  update(sim, dt) {
    if (S.ui && S.ui.noteT > 0) S.ui.noteT = Math.max(0, S.ui.noteT - (Number.isFinite(dt) ? dt : 1 / 60));
    if (!hasRamp(sim)) {
      if (S.ui && S.ui.panel.classList.contains('is-shown')) off();
      return;
    }
    const on = flying(sim);
    const ac = sim.aircraft;
    const cargo = cargoOf(sim);
    // The touch pad first: with one, the hint below is not needed.
    if (on && S.ui && !S.ui.pad) buildPad(sim);
    // Once, on the first frame of a flight (after the spawner has placed it): the key.
    // Not on a touch screen, where the pad says OPEN RAMP itself: a phone held
    // sideways has room in the right-hand column for one notice, and the
    // take-off flap note already has it — a second ran down behind the pads.
    if (S.groundStart && ac && cargo) {
      S.groundStart = false;
      if (ac.onGround && ac.groundSpeed < 2 && !(S.ui && S.ui.pad)) {
        const k = S.ui && S.ui.touch ? 'the RAMP button' : `${keyName('cargoRamp', sim)} (or the RAMP button)`;
        notify(sim, `Press ${k} to lower the cargo ramp. In the air it opens under ${RAMP_OPEN_KT} knots.`, 'info', 7);
      }
    }
    // Too fast with it open: it closes itself, and says so once per flight.
    if (ac && cargo && rampMustShut({ onGround: !!ac.onGround, kt: (ac.ias || 0) * KT, target: cargo.target })) {
      cargo.close();
      if (!S.shutSaid) {
        S.shutSaid = true;
        notify(sim, `The ramp closed itself — too fast with it open. Under ${RAMP_OPEN_KT} knots to open it.`, 'warn', 5);
      }
    }
    updateUi(sim, on);
  },
  key(sim, code, down, e) {
    if (!isKey(sim, 'cargoRamp', code) || !flying(sim)) return false;
    if (down && !(e && e.repeat)) pressRamp(sim);
    return true;
  },
  devActions: [
    {
      label: 'C-17: on the ground, ramp down',
      hint: 'A Globemaster on the Kestrel strip with its ramp on the tarmac',
      async run(sim) {
        await sim.startMode('free', { aircraft: 'c17', time: 'day', condition: 'clear', windSpeedKts: 0 });
        const cargo = cargoOf(sim);
        if (cargo) cargo.open();
      },
    },
  ],
});

/** For the browser check: forget the touch pad (a stand-in touch layer's) and take it off the page. */
export function dropPad() {
  if (!S.ui || !S.ui.pad) return;
  S.ui.pad.remove();
  S.ui.pad = null;
  S.shown = '';
}

/** For the browser check and the console. */
export function rampState() {
  const pad = S.ui && S.ui.pad;
  return {
    shown: !!(S.ui && S.ui.panel.classList.contains('is-shown')), text: S.ui ? S.ui.panel.textContent.replace(/\s+/g, ' ').trim() : '', last: S.last,
    pad: pad ? { shown: !pad.hidden, text: pad.textContent, on: pad.classList.contains('is-on') } : null,
  };
}

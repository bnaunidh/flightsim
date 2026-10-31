/**
 * The B-1B Lancer's swing wing and afterburners, in the game (owner,
 * 2026-10-16: "also note: add b1 lancers" — "swing wings: they sweep back at
 * speed; the player can control the sweep, four afterburning engines, a
 * low-level penetration feel, and supersonic flight").
 *
 * The flying is ../aircraft/swing-wing.js, put on the aeroplane's own
 * update() here exactly as node puts it on in tests/features/lancer.mjs. This
 * file is everything round it:
 *
 *   ] and [   one notch back / forward (15, 25, 45, 67.5 degrees), which takes
 *             the wing out of AUTO; [ at the forward stop puts AUTO back.
 *             Shared by design with the carrier's hook and catapult keys: a
 *             Lancer never goes to sea (no hook, no catapult). Settings →
 *             Controls → Flying, like every key.
 *   the panel one line: the wing's angle, AUTO / MANUAL and two small
 *             buttons with their keys; under it, only when it matters, the
 *             Mach number, AB when the burners are lit, and the radar
 *             altitude when it is down low and fast. The buttons are a touch
 *             screen's way in. Steady colours only: nothing here flashes.
 *   the model where the wing is drawn and whether the burners show
 *             (userData.sweepRig, src/fleet/extra/lancer.js)
 *   the words the wing's advice (flaps up first, too slow for the sweep),
 *             once each, through the HUD's own notes
 *   the hangar the sale row, under Military like the others
 *   take-off  flaps 20 on a ground start, and the wing forward
 *
 * Nothing here is written for the Lancer by name: a type with `swingWing:
 * true` in its roster entry gets it.
 */
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey, keyName, bindingsVersion } from '../flight/input.js';
import { SwingWing, wrapUpdate } from '../aircraft/swing-wing.js';
import { AIRCRAFT } from '../aircraft/types.js';
import { SPEC } from '../aircraft/physics.js';
import * as PROG from '../game/progression.js';

registerActions({
  wingsBack: { label: 'B-1B Lancer: wings back one notch', group: 'Flying', ctx: ['plane'], default: ['BracketRight'] },
  wingsForward: { label: 'B-1B Lancer: wings forward one notch (at the front: AUTO)', group: 'Flying', ctx: ['plane'], default: ['BracketLeft'] },
});

const KT = 1.94384;
const FT = 3.28084;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/*
 * For sale in the hangar, like the airliners (features/airliners.js says why
 * the row has to be added from outside progression.js): priced between the
 * F-35B and the F-22, and military. Fenced.
 */
try {
  const rows = PROG.UNLOCKS;
  if (Array.isArray(rows)) {
    for (const t of AIRCRAFT) {
      if (!t.swingWing || !t.price || rows.some((u) => u && u.aircraft === t.id)) continue;
      rows.push({ aircraft: t.id, cost: t.price, why: t.why || '', military: !!t.military });
    }
  }
} catch (e) {
  console.warn('[swing-wing] could not list the Lancer for sale in the hangar', e);
}

const wing = new SwingWing();
const wrapped = new WeakSet();
let ui = null;
let rigModel = null;
let rig = null;
let groundStart = false;
const shown = { key: '' };

/** Out of the cockpit: driving, walking, or the parked aeroplane held by the on-foot override (stovl.js). */
function outOfCockpit(sim) {
  if (sim.mode === 'drive') return true;
  const f = sim.onFoot || sim.onfoot || sim.walking;
  if (f && (f === true || f.active === true || f.on === true)) return true;
  const o = sim.override;
  const ac = sim.aircraft;
  return !!(o && o.throttle === 0 && o.brakes === 1 && ac && ac.onGround);
}

const isSwing = (sim) => !!(sim && sim.aircraftType && sim.aircraftType.swingWing && sim.state !== 'menu');
const flying = (sim) => isSwing(sim) && !outOfCockpit(sim);

function fail(sim, err) {
  console.error('[swing-wing] switched off for this session:', err);
  try { sim && sim.hud && sim.hud.notify('Wing sweep fault — the wings stay where they are.', 'warn', 4); } catch (e) { void e; }
}

function wrap(sim) {
  const ac = sim && sim.aircraft;
  if (!ac || wrapped.has(ac) || typeof ac.update !== 'function') return;
  wrapUpdate(ac, wing, { active: () => flying(sim), onError: (e) => fail(sim, e) });
  wrapped.add(ac);
}

function flushNotes(sim) {
  while (wing.notes.length) {
    const n = wing.notes.shift();
    try { sim.hud && sim.hud.notify(n.text, n.kind, n.seconds); } catch (e) { void e; }
  }
}

/* --- the model: where the wing is drawn, and the burners --- */
function updateRig(sim, on) {
  const model = sim.model;
  if (model !== rigModel) {
    rigModel = model;
    rig = (model && model.userData && model.userData.sweepRig) || null;
  }
  if (!rig) return;
  rig.sweep = on ? wing.sweep : null;
  rig.burner = on ? wing.burner : null;
}

/* --- the panel --- */
/*
 * Slimmed like the cargo ramp's (owner, 2026-10-25: the ramp card was "too
 * big", and this one was its twin): one line — "Wings 25° AUTO" and the two
 * small buttons with their keys on keycaps — and a second only when it has
 * something to say: the Mach number and the burners once past Mach 0.5 or
 * lit, LOW LEVEL when low and fast. The top-view gauge went: the number in
 * the line is the sweep, and the model shows the wing.
 */
const CSS = `
.swing-panel { position: absolute; right: 18px; top: 50%; transform: translateY(-50%);
  padding: 5px 5px 5px 9px; border-radius: 16px; background: rgba(12,20,34,.72);
  border: 1px solid var(--panel-line, rgba(140,180,230,.18)); color: var(--text, #eaf1fb);
  font: 600 12px/1.2 var(--font, system-ui, sans-serif); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px); display: none; user-select: none; }
.swing-panel.is-shown { display: block; }
.swing-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; white-space: nowrap; }
.swing-head > span:first-child { color: var(--text-dim, #9fb2cc); }
.swing-head b { font-weight: 800; font-variant-numeric: tabular-nums; }
.swing-mode { padding: 1px 4px; border-radius: 5px; font-size: 9.5px;
  font-weight: 800; letter-spacing: .06em; background: rgba(88,198,255,.16); color: #bfe6ff; }
.swing-mode.is-manual { background: rgba(255,194,71,.18); color: #ffe6b3; }
/* On a narrow column (a phone) the two buttons wrap under the line, to the right, rather than off the screen. */
.swing-btns { display: inline-flex; gap: 3px; margin-left: auto; }
.swing-btn { pointer-events: auto; display: inline-flex; align-items: center; gap: 4px; padding: 3px 4px 3px 7px;
  border-radius: 99px; border: 1px solid rgba(140,180,230,.35); background: rgba(88,198,255,.10); color: inherit;
  cursor: pointer; font: 700 11px/1 var(--font, system-ui, sans-serif); touch-action: manipulation; }
.swing-btn:hover { background: rgba(88,198,255,.18); }
.swing-btn kbd { font: 700 10px/1 var(--mono, ui-monospace, monospace); min-width: 14px; padding: 2px 4px 1px;
  text-align: center; border-radius: 5px; border: 1px solid rgba(255,255,255,.22); border-bottom-width: 2px;
  background: rgba(255,255,255,.08); color: #eaf1fb; }
.swing-btn kbd:empty { display: none; }
.swing-read { display: none; align-items: center; gap: 6px; margin: 4px 0 1px; font-variant-numeric: tabular-nums; }
.swing-read.is-on { display: flex; }
.swing-read b { font-size: 12px; font-weight: 800; }
.swing-ab { padding: 1px 5px; border-radius: 5px; font-size: 9.5px; font-weight: 800; letter-spacing: .06em;
  color: #9fb2cc; background: rgba(255,255,255,.07); }
.swing-ab.is-lit { color: #1b1206; background: #ffb347; }
.swing-low { display: none; margin: 4px 0 1px; font-size: 10.5px; font-weight: 700; color: #c9ffdd; }
.swing-low.is-on { display: block; }
/*
 * The coach's "Far too fast — ease the power right off" is 80% of a type's red
 * line (main.js coachHint), which for the Lancer is 500 kt: its whole low-level
 * dash. With the burners lit and under the red line it is being flown that
 * fast on purpose, so the coach line is quiet; past the red line the game's own
 * OVERSPEED warning still speaks.
 */
body.swing-dash .hud-coach { display: none !important; }
/* In the HUD's right-hand column (ui/hud-stack.js), which places it, against its right edge like a chip. */
.hud-rstack > .swing-panel { transform: none; position: relative; align-self: flex-end; }
.hud-rstack > .swing-panel:not(.is-shown) { display: none !important; }
`;

function buildUi(sim) {
  if (ui || typeof document === 'undefined') return ui;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.className = 'swing-panel';
  panel.innerHTML = `
    <div class="swing-head"><span>Wings</span><b class="swing-deg">15°</b><span class="swing-mode">AUTO</span><span class="swing-btns"><button class="swing-btn" type="button" data-dir="-1" aria-label="Wings forward">Fwd<kbd class="swing-kf"></kbd></button><button class="swing-btn" type="button" data-dir="1" aria-label="Wings back">Back<kbd class="swing-kb"></kbd></button></span></div>
    <div class="swing-read"><b class="swing-mach">M 0.00</b><span class="swing-ab">AB</span></div>
    <div class="swing-low"></div>`;
  extLayer().appendChild(panel);
  joinStack(sim, panel);
  const q = (s) => panel.querySelector(s);
  for (const b of panel.querySelectorAll('.swing-btn')) {
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (flying(sim)) press(sim, Number(b.dataset.dir));
    });
  }
  ui = {
    panel, deg: q('.swing-deg'), mode: q('.swing-mode'), read: q('.swing-read'), mach: q('.swing-mach'), ab: q('.swing-ab'),
    low: q('.swing-low'), kf: q('.swing-kf'), kb: q('.swing-kb'),
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  };
  syncKeys(sim);
  return ui;
}

function syncKeys(sim) {
  if (!ui || ui.keysVer === bindingsVersion()) return;
  ui.keysVer = bindingsVersion();
  // Keycaps: the keys that do it. None on a touch screen (the buttons are tapped).
  ui.kf.textContent = ui.touch ? '' : keyName('wingsForward', sim);
  ui.kb.textContent = ui.touch ? '' : keyName('wingsBack', sim);
}

function press(sim, dir) {
  wrap(sim);
  const what = wing.nudge(dir, sim.aircraft);
  flushNotes(sim);
  return what;
}

/* A card in the HUD's right-hand column, as the cargo ramp's is; the HUD may come after install. */
function joinStack(sim, panel) {
  const stack = sim && sim.hud && sim.hud.stack;
  if (!panel || !stack || typeof stack.add !== 'function' || !stack.el) return false;
  if (panel.parentNode !== stack.el) stack.add(panel, { prio: 1.5, id: 'swing-wing', chip: false });
  return true;
}

function updateUi(sim, on) {
  if (!ui) return;
  if (on && !ui.stacked) ui.stacked = joinStack(sim, ui.panel);
  const show = on && sim.state === 'flying' && !(sim.hud && (sim.hud.enabled === false || sim.hud.hidden));
  if (ui.panel.classList.contains('is-shown') !== show) ui.panel.classList.toggle('is-shown', show);
  if (!show) return;
  syncKeys(sim);
  const ac = sim.aircraft;
  // To the half degree: the last notch is 67.5, and it should say so.
  const deg = Math.round(wing.sweep * 2) / 2;
  const mach = Math.round(wing.mach * 100);
  const lit = wing.burner > 0.05;
  const kt = (ac.ias || 0) * KT;
  const agl = Math.max(0, ac.agl || 0) * FT;
  const low = !ac.onGround && agl < 1000 && kt > 300 ? Math.round(agl / 10) * 10 : -1;
  // Only touch the DOM when something visible changed.
  const key = `${deg}|${wing.mode}|${mach}|${lit}|${low}`;
  if (key === shown.key) return;
  shown.key = key;
  ui.deg.textContent = `${deg}°`;
  ui.mode.textContent = wing.mode === 'auto' ? 'AUTO' : 'MANUAL';
  ui.mode.classList.toggle('is-manual', wing.mode !== 'auto');
  // The second line only when it has something to say.
  ui.read.classList.toggle('is-on', lit || mach >= 50);
  ui.mach.textContent = `M ${(mach / 100).toFixed(2)}`;
  ui.ab.classList.toggle('is-lit', lit);
  ui.low.classList.toggle('is-on', low >= 0);
  if (low >= 0) ui.low.textContent = `LOW LEVEL · ${low} ft`;
}

let dashing = false;
function setDash(on) {
  if (on === dashing || typeof document === 'undefined' || !document.body) return;
  dashing = on;
  document.body.classList.toggle('swing-dash', on);
}

function off(sim) {
  shown.key = '';
  setDash(false);
  if (ui) ui.panel.classList.remove('is-shown');
  if (rig) {
    rig.sweep = null;
    rig.burner = null;
  }
  void sim;
}

registerExtension({
  id: 'swing-wing',
  install(sim) {
    wrap(sim);
    buildUi(sim);
  },
  startMode(sim, mode) {
    off(sim);
    wing.broken = false;
    wing.reset();
    groundStart = false;
    if (mode === 'drive' || !isSwing(sim)) return;
    wrap(sim);
    groundStart = true;
  },
  stop(sim) {
    off(sim);
  },
  update(sim) {
    const on = flying(sim) && !wing.broken;
    if (!isSwing(sim)) {
      if (ui && ui.panel.classList.contains('is-shown')) off(sim);
      return;
    }
    wrap(sim);
    const ac = sim.aircraft;
    // Take-off flap on a ground start, once, on the first frame (after the spawner has placed it).
    if (groundStart && ac) {
      groundStart = false;
      if (ac.onGround && ac.groundSpeed < 2 && sim.aircraftType.takeoffFlaps && ac.flapStep() < sim.aircraftType.takeoffFlaps) {
        ac.setFlaps(sim.aircraftType.takeoffFlaps);
        try {
          sim.hud && sim.hud.notify(`Wings forward, flaps ${sim.aircraftType.takeoffFlaps * 10}° for take-off. Full throttle lights the afterburners; ] and [ move the wings.`, 'info', 7);
        } catch (e) { void e; }
      }
    }
    flushNotes(sim);
    updateRig(sim, on);
    updateUi(sim, on);
    setDash(on && !!ac && !ac.onGround && wing.burner > 0.5 && (ac.ias || 0) < SPEC.vne);
  },
  key(sim, code, down, e) {
    const back = isKey(sim, 'wingsBack', code);
    const fwd = !back && isKey(sim, 'wingsForward', code);
    if ((!back && !fwd) || !flying(sim)) return false;
    if (down && !(e && e.repeat)) press(sim, back ? 1 : -1);
    return true;
  },
  devActions: [
    {
      label: 'Lancer: start at 40,000 ft, wings back',
      hint: 'Mach 0.9 at 12,000 m, burners lit: push on through the sound barrier',
      async run(sim) {
        await sim.startMode('free', { aircraft: 'b1b', time: 'day', condition: 'clear', windSpeedKts: 0 });
        const ac = sim.aircraft;
        const THREE = await import('../vendor/three.module.js');
        ac.reset({ pos: new THREE.Vector3(-8000, 0, 2000), headingDeg: 90, speed: 266, altAGL: 12000, engineOn: true, gearDown: false });
        ac.pos.y = 12000;
        ac.setFlaps(0);
        ac.rpm = 1;
        if (sim.input) sim.input.throttleTarget = 1;
        wing.reset(67.5);
      },
    },
  ],
});

/** For the browser check and the console: the live wing. */
export function swingState() {
  return wing;
}

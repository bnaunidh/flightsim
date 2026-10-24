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
 *   the panel the wing's angle and mode on a little gauge, AUTO / MANUAL, the
 *             Mach number, AB when the burners are lit, and the radar
 *             altitude when it is down low and fast — with two buttons for a
 *             touch screen. Steady colours only: nothing here flashes.
 *   the model where the wing is drawn and whether the burners show
 *             (userData.sweepRig, src/fleet/extra/lancer.js)
 *   the words the wing's advice (flaps up first, too slow for the sweep),
 *             once each, through the HUD's own notes
 *   the hangar the sale row, behind the military passcode like the others
 *   take-off  flaps 20 on a ground start, and the wing forward
 *
 * Nothing here is written for the Lancer by name: a type with `swingWing:
 * true` in its roster entry gets it.
 */
import { registerExtension, extLayer } from '../game/extensions.js';
import { registerActions, isKey, keyName, bindingsVersion } from '../flight/input.js';
import { SwingWing, wrapUpdate } from '../aircraft/swing-wing.js';
import { LANCER_WING } from '../aircraft/extra/lancer.js';
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
 * F-35B and the F-22, and military, so behind the passcode. Fenced.
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
const CSS = `
.swing-panel { position: absolute; right: 18px; top: 50%; transform: translateY(-50%); width: 136px;
  padding: 9px 10px 10px; border-radius: 14px; background: rgba(12,20,34,.78);
  border: 1px solid var(--panel-line, rgba(140,180,230,.18)); color: var(--text, #eaf1fb);
  font: 600 12px/1.25 var(--font, system-ui, sans-serif); backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px); display: none; user-select: none; }
.swing-panel.is-shown { display: block; }
.swing-head { display: flex; justify-content: space-between; align-items: baseline; }
.swing-head span { color: var(--text-dim, #9fb2cc); font-size: 10.5px; letter-spacing: .08em; }
.swing-head b { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
.swing-mode { display: inline-block; margin-top: 4px; padding: 1px 6px; border-radius: 6px; font-size: 10px;
  font-weight: 800; letter-spacing: .06em; background: rgba(88,198,255,.16); color: #bfe6ff; }
.swing-mode.is-manual { background: rgba(255,194,71,.18); color: #ffe6b3; }
.swing-gauge { position: relative; height: 34px; margin: 6px 0 4px; }
.swing-gauge svg { width: 100%; height: 100%; display: block; }
.swing-btns { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 4px; }
.swing-btn { pointer-events: auto; padding: 6px 0 5px; border-radius: 9px; border: 1px solid rgba(140,180,230,.35);
  background: rgba(88,198,255,.10); color: inherit; cursor: pointer; font: 800 11px/1 var(--font, system-ui, sans-serif);
  touch-action: manipulation; }
.swing-btn small { display: block; margin-top: 2px; font-size: 9.5px; font-weight: 600; opacity: .7; }
.swing-read { display: flex; justify-content: space-between; margin-top: 7px; font-variant-numeric: tabular-nums; }
.swing-read b { font-size: 14px; font-weight: 800; }
.swing-ab { padding: 1px 6px; border-radius: 6px; font-size: 10.5px; font-weight: 800; letter-spacing: .06em;
  color: #9fb2cc; background: rgba(255,255,255,.07); }
.swing-ab.is-lit { color: #1b1206; background: #ffb347; }
.swing-low { display: none; margin-top: 5px; font-size: 10.5px; font-weight: 700; color: #c9ffdd; text-align: center; }
.swing-low.is-on { display: block; }
@media (max-width: 700px) { .swing-panel { right: 8px; width: 122px; } }
/*
 * The coach's "Far too fast — ease the power right off" is 80% of a type's red
 * line (main.js coachHint), which for the Lancer is 500 kt: its whole low-level
 * dash. With the burners lit and under the red line it is being flown that
 * fast on purpose, so the coach line is quiet; past the red line the game's own
 * OVERSPEED warning still speaks.
 */
body.swing-dash .hud-coach { display: none !important; }
@media (max-height: 560px) { .swing-panel { top: 64px; transform: none; padding: 7px 8px 8px; } .swing-gauge { height: 26px; } }
/*
 * In the HUD's right-hand column (ui/hud-stack.js), which places it: on its own
 * it sat on the notices, and on a phone held sideways ran down over the STOP
 * pad. On a short screen it keeps the sweep, the mode and the two buttons; the
 * gauge and the Mach line go (the number in the head is the sweep).
 */
.hud-rstack > .swing-panel { transform: none; }
.hud-rstack > .swing-panel { position: relative; }
.hud-rstack > .swing-panel:not(.is-shown) { display: none !important; }
@media (max-height: 560px) {
  .hud-rstack > .swing-panel { padding: 6px 8px 7px; }
  .hud-rstack > .swing-panel .swing-gauge,
  .hud-rstack > .swing-panel .swing-read,
  .hud-rstack > .swing-panel .swing-btn small { display: none; }
  /* AUTO / MANUAL beside the sweep in the head, not on a line of its own. */
  .hud-rstack > .swing-panel .swing-mode { position: absolute; top: 6px; left: 58px; margin: 0; }
  .hud-rstack > .swing-panel .swing-btn { padding: 7px 0; }
}
`;

/** The gauge: a top view of one wing on its pin, drawn at the sweep. Static art plus one rotated line. */
function gaugeSvg() {
  const D = LANCER_WING.detents;
  const ticks = D.map((d) => {
    const r = (d * Math.PI) / 180;
    const x = 10 + Math.cos(r) * 100;
    const y = 4 + Math.sin(r) * 28;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.6" fill="rgba(159,178,204,.7)"/>`;
  }).join('');
  return `<svg viewBox="0 0 116 34" aria-hidden="true">
    <rect x="0" y="0" width="12" height="34" rx="4" fill="rgba(255,255,255,.12)"/>
    ${ticks}
    <line class="swing-arm" x1="10" y1="4" x2="106" y2="30" stroke="#eaf1fb" stroke-width="4" stroke-linecap="round"/>
    <circle cx="10" cy="4" r="3" fill="#58c6ff"/>
  </svg>`;
}

function buildUi(sim) {
  if (ui || typeof document === 'undefined') return ui;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const panel = document.createElement('div');
  panel.className = 'swing-panel';
  panel.innerHTML = `
    <div class="swing-head"><span>WINGS</span><b class="swing-deg">15°</b></div>
    <span class="swing-mode">AUTO</span>
    <div class="swing-gauge">${gaugeSvg()}</div>
    <div class="swing-btns">
      <button class="swing-btn" type="button" data-dir="-1" aria-label="Wings forward">FWD<small class="swing-kf"></small></button>
      <button class="swing-btn" type="button" data-dir="1" aria-label="Wings back">BACK<small class="swing-kb"></small></button>
    </div>
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
    panel, deg: q('.swing-deg'), mode: q('.swing-mode'), arm: q('.swing-arm'), mach: q('.swing-mach'), ab: q('.swing-ab'),
    low: q('.swing-low'), kf: q('.swing-kf'), kb: q('.swing-kb'),
    touch: typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches,
  };
  syncKeys(sim);
  return ui;
}

function syncKeys(sim) {
  if (!ui || ui.keysVer === bindingsVersion()) return;
  ui.keysVer = bindingsVersion();
  ui.kf.textContent = ui.touch ? 'tap' : keyName('wingsForward', sim);
  ui.kb.textContent = ui.touch ? 'tap' : keyName('wingsBack', sim);
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
  const r = (wing.sweep * Math.PI) / 180;
  ui.arm.setAttribute('x2', (10 + Math.cos(r) * 100).toFixed(1));
  ui.arm.setAttribute('y2', (4 + Math.sin(r) * 28).toFixed(1));
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

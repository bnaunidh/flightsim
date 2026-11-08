/**
 * THE INSTRUMENTS GIVING OUT, deep in the Farlands. The owner, 2026-11-08:
 * "once ur 1/4 of the way in the farlands your insturments start failing,
 * the farther u go the most glitches and stuff break".
 *
 * The ring (world/worldmap/farlands.js): the range to RANGE_DEEP, the
 * Farlands on to EDGE_D, the void past that. From a quarter of the way in
 * (START_D) an intensity rises from 0 to 1 at the edge, and stays 1 in the
 * void. It only ever changes what the instruments SHOW, and the autopilot:
 *
 *   0.00+  the compass wanders, more the further out
 *   0.30+  the clock runs slow, then stands, then backwards; rows of the panel
 *          slip sideways by a pixel or two; digits ghost
 *   0.35+  the autopilot drops with a caution, and will not stay in
 *   0.45+  the altimeter and the airspeed creep and jump to plausible wrong
 *          numbers; the minimap goes to noise and bands, its chart smears
 *   0.50+  a readout shows dashes for a moment; the radio's text garbles
 *   0.60+  the compass slowly spins
 *   0.97+  (the void) the readouts are frozen or gone: dashes
 *
 * HOW: one hook. The HUD (ui/hud.js) and the cockpit panels (aircraft/cockpit)
 * read the aeroplane's ias / alt / agl / vs / heading, through readouts() or
 * straight off it. While those two update, and only then, the fields hold the
 * wrong numbers; they are put back before anything else runs, so the physics,
 * the warnings, the touch sheets and the missions see the truth. Nothing
 * here takes control or changes the flight: look out of the window and fly.
 *
 * FLASH-SAFE: the picked changes (jumps, dashes, slips) happen on a tick of
 * TICK_S, under three a second, and the overlays move by CSS transitions of
 * the same length; everything else is a smooth drift. No per-frame
 * allocation: the state is a handful of numbers, the overlay is one element
 * with a noise tile drawn once, and no draw call is added to the scene.
 *
 * Loaded with the ring (features/world-preview.js loadRing), so no other map
 * and no first load has a byte of it. Off whenever the World Map is not the
 * map; everything eases back when you fly home.
 */
import { registerExtension } from '../game/extensions.js';
import { depthOf, RANGE_DEEP, FAR_DEEP, EDGE_D } from '../world/worldmap/farlands.js';
import { active as worldMapActive } from './world-preview.js';
import { __readouts, clockParts } from './hud-readouts.js';

/** D (metres past the coast) where the failures begin: a quarter of the Farlands in. */
export const START_D = RANGE_DEEP + FAR_DEEP / 4;
/** Picked changes come no faster than this (WCAG 2.3.1: three a second). */
export const TICK_S = 0.4;
/** How fast the felt intensity follows the true one: a teleport still eases in and out. */
export const EASE_PER_S = 0.35;
/** Thresholds, by intensity. */
export const K = Object.freeze({ clock: 0.3, autopilot: 0.35, numbers: 0.45, dashes: 0.5, spin: 0.6, freeze: 0.97 });

/** Intensity 0..1 for a depth D: 0 before START_D, 1 from EDGE_D on. Pure. */
export function glitchIntensity(d) {
  if (!(d > START_D)) return 0;
  const t = (d - START_D) / (EDGE_D - START_D);
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** The intensity for where the aeroplane is: 0 off the World Map. */
export function intensityFor(sim) {
  if (!worldMapActive() || !sim || !sim.aircraft) return 0;
  const ac = sim.aircraft;
  return glitchIntensity(depthOf(ac.pos.x, ac.pos.z));
}

/* Units as physics.js keeps them (metres, m/s) against the panels' knots and feet. */
const KT = 1 / 1.94384;
const FT = 1 / 3.28084;
const FPM = 1 / 196.850394;

const CSS = `
.hud.is-farglitch .hud-left .hud-row { transition: transform ${TICK_S}s linear; }
.hud.is-farglitch .hud-left .hud-row:nth-child(odd) { transform: translateX(var(--fg-tx1, 0px)); }
.hud.is-farglitch .hud-left .hud-row:nth-child(even) { transform: translateX(var(--fg-tx2, 0px)); }
.hud.is-farglitch .hud-left .hud-value { transition: opacity ${TICK_S}s linear, text-shadow ${TICK_S}s linear; }
.hud.is-farglitch .hud-left .hud-row:nth-child(3n) .hud-value { opacity: var(--fg-seg, 1); }
.hud.is-farglitch.fg-ghost .hud-left .hud-value { text-shadow: var(--fg-ghost, none); }
.minimap .fg-static {
  position: absolute; inset: 0; pointer-events: none; opacity: 0;
  background-repeat: repeat, repeat;
  background-size: 64px 64px, auto;
  image-rendering: pixelated;
  transition: opacity ${TICK_S}s linear, background-position ${TICK_S}s linear;
}
.minimap.is-farglitch .minimap-canvas { transition: opacity ${TICK_S}s linear, filter ${TICK_S}s linear; opacity: var(--fg-mm, 1); filter: blur(var(--fg-blur, 0px)); }
`;

/** A 64 px tile of grey noise, drawn once: the static. */
function noiseTile() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) return '';
  const img = g.createImageData(64, 64);
  const d = img.data;
  let s = 0x9e3779b9;
  for (let i = 0; i < d.length; i += 4) {
    s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x1b873593) | 0;
    const v = 70 + ((s >>> 24) % 150);
    d[i] = v * 0.85;
    d[i + 1] = v;
    d[i + 2] = v * 1.05;
    d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return `url(${c.toDataURL()})`;
}

/** Small, fast, deterministic: the picks. */
function rand() {
  S.seed = (Math.imul(S.seed ^ (S.seed >>> 15), 0x2c1b3c6d) + 0x1b873593) | 0;
  return ((S.seed >>> 8) & 0xffffff) / 0x1000000;
}

const S = {
  k: 0, // felt intensity, eased
  target: 0,
  t: 0,
  tick: 0,
  ticks: 0,
  writes: 0,
  seed: 0x5bd1e995,
  // smooth drifts
  ph1: 0, ph2: 0, ph3: 0,
  spin: 0,
  // the picked, held-for-a-tick wrongs
  jumpAlt: 0, jumpIas: 0,
  dash: 0, // 0 none, 1 speed, 2 alt, 3 vs, 4 hdg, 5 stall, 6 clock
  // what the panels are shown (and hold while frozen or dashed), in the aeroplane's units
  show: { ias: 0, alt: 0, agl: 0, vs: 0, heading: 0 },
  hold: { ias: false, alt: false, vs: false, heading: false },
  frozen: false,
  save: { ias: 0, alt: 0, agl: 0, vs: 0, heading: 0 },
  swapped: false,
  // the clock
  clockDrift: 0,
  clockWhole: -1,
  clockOn: false,
  // the autopilot
  apHold: 0,
  apToastT: 0,
  apWas: false,
  // DOM
  hud: null,
  hudOwn: null,
  hudHadOwn: false,
  subHadOwn: false,
  ck: null,
  mm: null,
  overlay: null,
  styled: false,
  subOwn: null,
  dashed: null,
};

function ensureStyle() {
  if (S.styled || typeof document === 'undefined') return;
  S.styled = true;
  const s = document.createElement('style');
  s.id = 'fg-style';
  s.textContent = CSS;
  document.head.appendChild(s);
}

/* ------------------------------------------------------------------ */
/* The one hook: the fields, swapped while the panels read them         */
/* ------------------------------------------------------------------ */

function swapIn(ac) {
  if (S.swapped || !ac || typeof ac.ias !== 'number') return;
  const v = S.save;
  v.ias = ac.ias;
  v.alt = ac.alt;
  v.agl = ac.agl;
  v.vs = ac.vs;
  v.heading = ac.heading;
  const s = S.show;
  ac.ias = s.ias;
  ac.alt = s.alt;
  ac.agl = s.agl;
  ac.vs = s.vs;
  ac.heading = s.heading;
  S.swapped = true;
}

function swapOut(ac) {
  if (!S.swapped || !ac) return;
  const v = S.save;
  ac.ias = v.ias;
  ac.alt = v.alt;
  ac.agl = v.agl;
  ac.vs = v.vs;
  ac.heading = v.heading;
  S.swapped = false;
}

function hudUpdate(dt, sim) {
  const ac = sim && sim.aircraft;
  if (S.k <= 0 || !ac) return S.hudOwn.call(this, dt, sim);
  swapIn(ac);
  try {
    return S.hudOwn.call(this, dt, sim);
  } finally {
    swapOut(ac);
  }
}

function hookHud(hud) {
  if (!hud || S.hud === hud) return;
  unhookHud();
  S.hud = hud;
  S.hudHadOwn = Object.prototype.hasOwnProperty.call(hud, 'update');
  S.hudOwn = hud.update;
  hud.update = hudUpdate;
}

function unhookHud() {
  const hud = S.hud;
  if (hud && hud.update === hudUpdate) {
    if (S.hudHadOwn) hud.update = S.hudOwn;
    else delete hud.update;
  }
  S.hud = null;
  S.hudOwn = null;
}

function cockpitUpdate(dt, ac, weather, sim) {
  const own = this._fgOwn;
  if (S.k <= 0 || !ac) return own.call(this, dt, ac, weather, sim);
  swapIn(ac);
  try {
    return own.call(this, dt, ac, weather, sim);
  } finally {
    swapOut(ac);
  }
}

function hookCockpit(sim) {
  const ud = sim.cockpit && sim.cockpit.userData;
  if (ud === S.ck) return;
  unhookCockpit();
  if (!ud || typeof ud.update !== 'function') return;
  ud._fgOwn = ud.update;
  ud.update = cockpitUpdate;
  S.ck = ud;
}

function unhookCockpit() {
  const ud = S.ck;
  if (ud && ud.update === cockpitUpdate) {
    ud.update = ud._fgOwn;
    delete ud._fgOwn;
  }
  S.ck = null;
}

/* ------------------------------------------------------------------ */
/* The radio                                                            */
/* ------------------------------------------------------------------ */

const GARBLE = '#%/?\\-·_';
/** A line as a failing radio would print it: a share of its letters lost. */
export function garble(text, k) {
  if (!text || k <= K.dashes) return text;
  const f = Math.min(0.7, (k - K.dashes) * 1.4);
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    out += ch !== ' ' && rand() < f ? GARBLE[(rand() * GARBLE.length) | 0] : ch;
  }
  return out;
}

function hookSubtitle(hud) {
  if (!hud || S.subOwn) return;
  S.subHadOwn = Object.prototype.hasOwnProperty.call(hud, 'setSubtitle');
  S.subOwn = hud.setSubtitle;
  hud.setSubtitle = function setSubtitle(text, who, duration) {
    if (S.k > K.dashes) {
      text = garble(text, S.k);
      if (S.k > 0.8) who = '???';
    }
    return S.subOwn.call(this, text, who, duration);
  };
}

function unhookSubtitle(hud) {
  if (hud && S.subOwn && Object.prototype.hasOwnProperty.call(hud, 'setSubtitle')) {
    if (S.subHadOwn) hud.setSubtitle = S.subOwn;
    else delete hud.setSubtitle;
  }
  S.subOwn = null;
}

/* ------------------------------------------------------------------ */
/* What the panels are shown                                            */
/* ------------------------------------------------------------------ */

/** The wrong numbers for this frame, from the true ones. Smooth parts per frame, picked parts per tick. */
function shown(ac, dt) {
  const k = S.k;
  const s = S.show;
  if (S.frozen) return; // the void: whatever they last read
  // Smooth drifts: three slow phases, incommensurate, so nothing repeats or pulses.
  S.ph1 += dt * (0.21 + 0.5 * k);
  S.ph2 += dt * (0.137 + 0.3 * k);
  S.ph3 += dt * (0.31 + 0.2 * k);
  const n1 = Math.sin(S.ph1) * 0.6 + Math.sin(S.ph2 * 1.7 + 1.3) * 0.4;
  const n2 = Math.sin(S.ph2) * 0.6 + Math.sin(S.ph3 * 1.3 + 0.4) * 0.4;
  const n3 = Math.sin(S.ph3) * 0.6 + Math.sin(S.ph1 * 0.7 + 2.1) * 0.4;
  // The compass: a wander that grows, then from K.spin a slow turn on top.
  const wander = n1 * k * 45;
  if (k > K.spin) S.spin = (S.spin + dt * ((k - K.spin) / (1 - K.spin)) * 28) % 360;
  else if (S.spin) {
    // Flying back in: the turn it has on unwinds the short way, faster the nearer home, so the compass comes round, not snaps.
    let sp = ((S.spin + 540) % 360) - 180;
    const back = dt * (6 + ((K.spin - k) / K.spin) * 24);
    sp = Math.abs(sp) <= back ? 0 : sp - Math.sign(sp) * back;
    S.spin = sp;
  }
  if (!S.hold.heading) s.heading = (ac.heading + wander + S.spin + 720) % 360;
  // The altimeter and the airspeed: a creep from K.numbers, and the held jumps picked each tick.
  const num = k > K.numbers ? (k - K.numbers) / (1 - K.numbers) : 0;
  const altBias = (num * num * 2600 * n2 + S.jumpAlt) * FT;
  const iasBias = (num * num * 55 * n3 + S.jumpIas) * KT;
  if (!S.hold.alt) {
    s.alt = Math.max(0, ac.alt + altBias);
    s.agl = Math.max(0, ac.agl + altBias);
  }
  if (!S.hold.ias) s.ias = Math.max(0, ac.ias + iasBias);
  if (!S.hold.vs) s.vs = ac.vs + num * 1500 * n1 * FPM;
}

/** Once a tick: the picks. Dashes, jumps, the panel's slips, the overlay's drift. */
function tick(sim) {
  const k = S.k;
  S.ticks++;
  // Jumps: plausible, wrong, and held for the tick so the digits stand still between picks.
  const num = k > K.numbers ? (k - K.numbers) / (1 - K.numbers) : 0;
  if (num > 0 && rand() < 0.25 + num * 0.5) {
    S.jumpAlt = (rand() - 0.5) * 2 * num * 5000;
    S.jumpIas = (rand() - 0.5) * 2 * num * 80;
  } else {
    S.jumpAlt *= 0.5;
    S.jumpIas *= 0.5;
  }
  // Dashes: one readout at a time, for a tick, from K.dashes. In the void they all stand, untouched.
  if (!S.frozen) {
    clearDash(sim);
    S.dash = k > K.dashes && rand() < (k - K.dashes) * 1.6 ? 1 + ((rand() * 6) | 0) : 0;
    S.hold.ias = S.dash === 1;
    S.hold.alt = S.dash === 2;
    S.hold.vs = S.dash === 3;
    S.hold.heading = S.dash === 4;
  }
  paintCss(sim);
}

function clearDash(sim) {
  if (!S.dashed) return;
  const hud = sim.hud;
  const R = __readouts.R;
  // The panel repaints a readout only when its value changes: tell it to.
  if (hud && hud.lastValues) {
    hud.lastValues.ias = undefined;
    hud.lastValues.alt = undefined;
    hud.lastValues.vs = undefined;
    hud.lastValues.hdg = undefined;
  }
  if (R) {
    R.kt = -1;
    R.hm = '';
    R.s = -1;
  }
  S.dashed = null;
}

/** After the HUD has painted: the dashes over whichever readout is picked, and all of them in the void. */
function paintDashes(sim) {
  const hud = sim.hud;
  if (!hud || !hud.speedValue) return;
  const R = __readouts.R;
  const put = (el, text) => {
    if (el && el.textContent !== text) {
      el.textContent = text;
      S.writes++;
    }
  };
  if (S.frozen) {
    put(hud.speedValue, '---');
    put(hud.altValue, '----');
    put(hud.vsValue, '---');
    if (R && R.stall) put(R.stall, '');
    S.dashed = hud;
    return;
  }
  if (!S.dash) return;
  if (S.dash === 1) put(hud.speedValue, '---');
  else if (S.dash === 2) put(hud.altValue, '----');
  else if (S.dash === 3) put(hud.vsValue, '---');
  else if (S.dash === 4) put(hud.hdgValue, '---');
  else if (S.dash === 5 && R && R.stall) put(R.stall, 'stall -- kt');
  S.dashed = hud;
}

/* ------------------------------------------------------------------ */
/* The clock                                                            */
/* ------------------------------------------------------------------ */

function clock(sim, dt) {
  const R = __readouts.R;
  if (!R || !R.time) return;
  const k = S.k;
  if (k <= K.clock) {
    if (S.clockOn) {
      S.clockOn = false;
      S.clockDrift = 0;
      S.clockWhole = -1;
      R.hm = '';
      R.s = -1;
      R.whole = -1; // repaint the truth next frame
    }
    return;
  }
  S.clockOn = true;
  // Runs slow, stands at about 0.6, then backwards, faster the further out.
  const rate = -((k - K.clock) / (1 - K.clock)) * 2.4;
  S.clockDrift += dt * rate;
  if (R.whole === S.clockWhole) return; // once a second, as the real one paints
  S.clockWhole = R.whole;
  if (S.frozen || (S.dash === 6 && k > 0.85)) {
    // Both spans: the real clock repaints the seconds every second, and it must not get them back.
    if (R.time.textContent !== '--:--' || R.sec.textContent !== '') {
      R.time.textContent = '--:--';
      R.sec.textContent = '';
      S.writes++;
    }
    return;
  }
  const p = clockParts((R.whole + S.clockDrift) / 3600);
  R.time.textContent = p.hm;
  R.sec.textContent = `:${String(p.s).padStart(2, '0')}`;
  sim.clockText = p.hm;
  sim.clockSeconds = p.day;
  S.writes++;
}

/* ------------------------------------------------------------------ */
/* The autopilot                                                        */
/* ------------------------------------------------------------------ */

function autopilot(sim, dt) {
  const ap = sim.autopilot;
  if (!ap) return;
  S.apToastT = Math.max(0, S.apToastT - dt);
  if (S.k <= K.autopilot || sim.instrumentBlackout > 0 || sim.bracing) {
    S.apWas = ap.engaged;
    return;
  }
  if (!ap.engaged) {
    S.apWas = false;
    return;
  }
  // Just engaged out here: it holds for a few seconds, worse the further out, then lets go.
  if (!S.apWas) {
    S.apWas = true;
    S.apHold = 2 + (1 - S.k) * 6;
    return;
  }
  S.apHold -= dt;
  if (S.apHold > 0) return;
  if (typeof sim.toggleAutopilot === 'function') sim.toggleAutopilot(false);
  else ap.setEngaged(false, sim.aircraft);
  S.apWas = false;
  if (S.apToastT <= 0 && sim.hud && typeof sim.hud.notify === 'function') {
    S.apToastT = 10;
    sim.hud.notify('Autopilot disconnected — the heading and height out here cannot be trusted', 'warn', 4.5);
  }
}

/* ------------------------------------------------------------------ */
/* The look: CSS variables on the HUD and the minimap, once a tick       */
/* ------------------------------------------------------------------ */

function ensureOverlay(sim) {
  const mm = sim.minimap;
  if (!mm || !mm.el || S.mm === mm) return;
  S.mm = mm;
  if (!S.overlay) {
    S.overlay = document.createElement('div');
    S.overlay.className = 'fg-static';
    S.overlay.style.backgroundImage = `${noiseTile()}, repeating-linear-gradient(180deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 9px, rgba(0,0,0,0.45) 9px, rgba(0,0,0,0.45) 12px)`;
  }
  mm.el.appendChild(S.overlay);
}

function paintCss(sim) {
  const k = S.k;
  const hud = sim.hud;
  const low = sim.settings && sim.settings.quality === 'low';
  if (hud && hud.wrap) {
    const st = hud.wrap.style;
    const slip = k > K.clock ? ((k - K.clock) / (1 - K.clock)) * 7 : 0;
    st.setProperty('--fg-tx1', `${((rand() - 0.5) * 2 * slip).toFixed(1)}px`);
    st.setProperty('--fg-tx2', `${((rand() - 0.5) * 2 * slip).toFixed(1)}px`);
    // A row's digits dim and come back on a slow wave: never a step.
    const seg = 1 - k * 0.5 * (0.5 + 0.5 * Math.sin(S.ph2 * 0.9));
    st.setProperty('--fg-seg', seg.toFixed(2));
    if (!low && k > K.clock) {
      const g = ((k - K.clock) / (1 - K.clock)) * 3;
      st.setProperty('--fg-ghost', `${(g * Math.sin(S.ph1)).toFixed(1)}px 0 rgba(120, 220, 255, 0.55), ${(-g * Math.sin(S.ph1)).toFixed(1)}px 0 rgba(255, 110, 110, 0.5)`);
      hud.wrap.classList.add('fg-ghost');
    } else hud.wrap.classList.remove('fg-ghost');
    S.writes++;
  }
  if (S.overlay && S.mm) {
    const n = k > 0.2 ? Math.min(1, (k - 0.2) / 0.75) : 0;
    const a = S.frozen ? 0.96 : n * n * 0.9;
    const o = S.overlay.style;
    o.opacity = a.toFixed(2);
    // The static scrolls a little each tick, in one direction: a slow crawl, not a flicker.
    const px = (S.ticks * 7) % 64;
    const py = (S.ticks * 3) % 12;
    o.backgroundPosition = `${px}px ${(S.ticks * 11) % 64}px, 0 ${py}px`;
    const mmst = S.mm.el.style;
    mmst.setProperty('--fg-mm', (1 - n * 0.65).toFixed(2));
    mmst.setProperty('--fg-blur', low || k <= K.numbers ? '0px' : `${(((k - K.numbers) / (1 - K.numbers)) * 3.5).toFixed(1)}px`);
    S.writes++;
  }
}

function setOn(sim, on) {
  const hud = sim.hud;
  if (hud && hud.wrap) hud.wrap.classList.toggle('is-farglitch', on);
  if (S.mm && S.mm.el) S.mm.el.classList.toggle('is-farglitch', on);
  if (!on) {
    if (hud && hud.wrap) {
      const st = hud.wrap.style;
      st.removeProperty('--fg-tx1');
      st.removeProperty('--fg-tx2');
      st.removeProperty('--fg-seg');
      st.removeProperty('--fg-ghost');
      hud.wrap.classList.remove('fg-ghost');
    }
    if (S.overlay) S.overlay.style.opacity = '0';
    if (S.mm && S.mm.el) {
      S.mm.el.style.removeProperty('--fg-mm');
      S.mm.el.style.removeProperty('--fg-blur');
    }
  }
}

/* ------------------------------------------------------------------ */
/* The frame                                                            */
/* ------------------------------------------------------------------ */

function reset(sim) {
  clearDash(sim);
  if (S.clockOn) {
    const R = __readouts.R;
    S.clockOn = false;
    S.clockDrift = 0;
    S.clockWhole = -1;
    if (R) {
      R.hm = '';
      R.s = -1;
      R.whole = -1;
    }
  }
  S.frozen = false;
  S.spin = 0;
  S.jumpAlt = 0;
  S.jumpIas = 0;
  S.dash = 0;
  S.hold.ias = S.hold.alt = S.hold.vs = S.hold.heading = false;
  S.apWas = false;
  unhookHud();
  unhookCockpit();
  unhookSubtitle(sim.hud);
  setOn(sim, false);
  S.k = 0;
  S.target = 0;
}

let wasOn = false;

function update(sim, dt) {
  const ac = sim.aircraft;
  S.target = sim.state === 'flying' && ac && !ac.crashed ? intensityFor(sim) : 0;
  // Eased: the teleports of a test and the Continue of a flight come in and go out as smoothly as flying does.
  const d = S.target - S.k;
  const step = EASE_PER_S * dt;
  S.k = Math.abs(d) <= step ? S.target : S.k + Math.sign(d) * step;
  if (S.k <= 0) {
    if (wasOn) {
      wasOn = false;
      reset(sim);
    }
    return;
  }
  if (!wasOn) {
    wasOn = true;
    ensureStyle();
    S.ph1 = S.ph2 = S.ph3 = 0;
    S.tick = 0;
    S.show.heading = ac.heading;
    S.show.ias = ac.ias;
    S.show.alt = ac.alt;
    S.show.agl = ac.agl;
    S.show.vs = ac.vs;
  }
  hookHud(sim.hud);
  hookSubtitle(sim.hud);
  hookCockpit(sim);
  ensureOverlay(sim);
  if (sim.hud && sim.hud.wrap && !sim.hud.wrap.classList.contains('is-farglitch')) setOn(sim, true);
  // The void: whatever the panels last read, they keep.
  const freeze = S.k >= K.freeze;
  if (freeze !== S.frozen) {
    S.frozen = freeze;
    clearDash(sim);
    if (!freeze) S.dash = 0;
    paintCss(sim);
  }
  shown(ac, dt);
  S.t += dt;
  S.tick += dt;
  if (S.tick >= TICK_S) {
    S.tick -= TICK_S;
    tick(sim);
  }
  paintDashes(sim);
  clock(sim, dt);
  autopilot(sim, dt);
}

registerExtension({
  id: 'far-glitch',
  update,
  startMode(sim) {
    if (wasOn) {
      wasOn = false;
      reset(sim);
    }
  },
  stop(sim) {
    if (wasOn) {
      wasOn = false;
      reset(sim);
    }
  },
});

/** For the tests. */
export const __farGlitch = {
  S,
  stats: () => ({ k: S.k, target: S.target, t: S.t, ticks: S.ticks, writes: S.writes, frozen: S.frozen, dash: S.dash, spin: S.spin, on: wasOn, swapped: S.swapped, show: { ...S.show } }),
};

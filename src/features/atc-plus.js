/**
 * More ATC (the owner, 2026-11-11: "add more stuff for ATC"). Loaded on
 * demand by features/pilot-systems.js the first time you sit in a cockpit,
 * so the first load does not carry it. The rules are game/atc-controller.js
 * (pure, tests/features/atc-plus.mjs); this is the flight's snapshot, the
 * radio, and the buttons.
 *
 *   the RADIO card  under the four requests, the ones that fit the moment
 *                   (clearance, climb, descend, direct, ILS, visual, go
 *                   around, flight following, freq change, position, MAYDAY,
 *                   PAN-PAN), and at the top who you are talking to, on what,
 *                   and what you were last told. The desktop ATC window is the
 *                   same card, so it shows the same.
 *   READBACK        a button that comes up with every instruction (touch and
 *                   mouse), and the radio key (Z / F8) reads back too while one
 *                   is waiting. "You:" notes say what you read back.
 *   the radio       every line goes through the game's ATC director (its
 *                   voice, its subtitle, its cooldown); lines the director
 *                   says itself ("cleared to land", "hold short") are heard
 *                   here and become instructions to read back as well.
 *   the score       a card when you have landed and stopped: readbacks on time
 *                   and instructions flown.
 *   an emergency    sim.atcEmergency: the AI traffic holds (features/traffic.js)
 *                   and the fire crews stand by beside the runway.
 */
import { AtcController, frameOf, runwayConflict } from '../game/atc-controller.js';
import { isOnAnyRunway } from '../world/terrain.js';
import { RUNWAY } from '../world/airport.js';
import { navField, thresholdOf, onFieldRunway } from '../world/navfield.js';
import { isRotorType } from '../aircraft/systems.js';
import { extLayer } from '../game/extensions.js';
import { icon } from '../ui/icons.js';

const FT = 3.28084;
/** Seconds before the controller answers a request (as pilot-systems.js's REPLY_DELAY). */
const REPLY = 1.4;
const SCORE_FOR = 14;

const P = {
  ctl: new AtcController({ seed: (Date.now() & 0xffff) || 1 }),
  sim: null, api: null, acc: 0, q: [], mine: false, ui: null, hinted: false,
  scene: null, sceneT: 0, score: null, scoreT: 0, menuKey: '', nowKey: '', snap: null, lastYou: '',
};

const TRAFFIC = [];

function clsOf(t) {
  if (isRotorType(t)) return 'heli';
  return /airliner|carrier|hypersonic|prototype|fighter/i.test(String((t && t.class) || '')) ? 'jet' : 'light';
}

/** The field the director speaks for: its aiming point, height and landing course. */
function fieldOf(sim) {
  const d = sim.atc;
  const nf = navField();
  if (nf) {
    const t = thresholdOf(nf);
    return { name: d.field, x: t.touchX, z: nf.cz, elev: nf.elev || 0, crs: nf.dir > 0 ? 90 : 270, rw: d.runwayCall };
  }
  return { name: d.field, x: RUNWAY.touchdown.x, z: RUNWAY.touchdown.z, elev: RUNWAY.elev || 0, crs: RUNWAY.headingDeg || 90, rw: d.runwayCall };
}

const zoneWord = (z) => {
  const w = String((z && z.name) || '').split(' ')[0];
  return w ? w.charAt(0) + w.slice(1).toLowerCase() : '';
};

/** The flight, as the controller reads it (game/atc-controller.js SNAP). */
export function snapOf(sim) {
  const ac = sim.aircraft;
  const r = ac.readouts();
  const field = fieldOf(sim);
  const nf = navField();
  const onRw = (m) => (nf ? onFieldRunway(nf, ac.pos.x, ac.pos.z, m) : isOnAnyRunway(ac.pos.x, ac.pos.z, m));
  const onGround = !!ac.onGround;
  const onRunway = onGround && onRw(12);
  const lined = onRunway && Math.abs(((ac.heading - field.crs + 540) % 360) - 180) < 25;
  const as = sim.airspace;
  const zone = as && typeof as.current === 'function' ? as.current() : null;
  // The clearance's destination: the nearest other field with a control zone.
  let dest = null;
  try {
    const zs = as && typeof as.watch === 'function' ? as.watch().zones : [];
    let bd = Infinity;
    for (const z of zs || []) {
      const dd = Math.hypot(z.x - field.x, z.z - field.z);
      if (dd > 15000 && dd < bd && zoneWord(z) !== field.name) {
        bd = dd;
        dest = zoneWord(z);
      }
    }
  } catch (e) {
    dest = null;
  }
  const list = Array.isArray(sim.traffic) ? sim.traffic : [];
  TRAFFIC.length = 0;
  for (const o of list) {
    if (!o || !o.pos || typeof o.phase !== 'string') continue;
    TRAFFIC.push({
      id: o.id, cs: o.callsign || o.bodyName || 'traffic', type: o.name || 'aeroplane', x: o.pos.x, z: o.pos.z,
      altFt: (o.alt || 0) * FT, hdg: o.heading || 0, vsFpm: (o.vs || 0) * 196.85, kts: (o.speed || 0) * 1.94384, phase: o.phase, onGround: !!o.onGround,
    });
  }
  let busy = false;
  try {
    busy = !!sim.atc.runwayBusy(sim);
  } catch (e) {
    busy = false;
  }
  const ctx = P.api ? P.api.radioContext(sim) : {};
  return {
    t: performance.now() / 1000, cs: sim.atc.callsign, field, wind: ctx.wind || null,
    onGround, onRunway, nearRunway: onGround && !onRunway && onRw(55), lined, gs: ac.groundSpeed || 0,
    airborneTime: ac.airborneTime || 0, x: ac.pos.x, z: ac.pos.z, altFt: r.altFt, aglFt: r.aglFt, hdg: r.heading, kts: r.iasKts, vsFpm: r.vsFpm,
    cls: clsOf(sim.aircraftType), zone: zone ? { name: zone.name, freq: zone.freq } : null, dest, directTo: null,
    runwayBusy: busy, crashed: !!ac.crashed || !!ac.ditched, traffic: TRAFFIC,
  };
}

/* ------------------------------------------------------------------ *
 * The radio
 * ------------------------------------------------------------------ */

function notify(sim, text, kind = 'info', s = 3) {
  if (P.api) P.api.notify(sim, text, kind, s);
}

/** Say a controller line now through the director, as ours (not heard back as the director's). */
function sayNow(sim, e) {
  const d = sim.atc;
  if (!d) return true;
  if (e.force) d.cool = 0;
  P.mine = true;
  let said = false;
  try {
    said = d.say(e.text, e.voice, e.urgency || 0);
  } finally {
    P.mine = false;
  }
  return said !== false;
}

function applyFx(sim, fx) {
  const d = sim.atc;
  if (fx.block && d) for (const k of fx.block) d.said[k] = true;
  if (fx.unblock && d) for (const k of fx.unblock) d.said[k] = false;
  if ('emergency' in fx) sim.atcEmergency = fx.emergency || null;
  if (fx.scene === 'raise') raiseCrews(sim);
  else if (fx.scene === 'clear') clearCrews(sim);
  else if (fx.scene === 'clearLater') P.sceneT = 45;
  if (fx.hint === 'intentions' && P.api) {
    const how = sim.touch ? 'tap RADIO on the sheet' : `press ${P.api.radioKeyName(sim)} for the radio`;
    notify(sim, `To report your intentions: ${how}, then pick what you want to do`, 'info', 6);
  }
}

/** The controller's events: lines into the queue (answers after REPLY), effects at once, the score card. */
function handle(sim, events, { delay = 0, force = false } = {}) {
  for (const e of events || []) {
    if (e.type === 'score') {
      showScore(sim, e.score);
      continue;
    }
    if (e.fx) applyFx(sim, e.fx);
    if (e.text) P.q.push({ text: e.text, voice: e.voice, urgency: e.urgency || 0, at: delay, force: force || e.urgency > 0, instr: e.instr, life: 14 });
  }
}

function flush(sim, dt) {
  const e = P.q[0];
  if (!e) return;
  e.at -= dt;
  e.life -= dt;
  if (e.at > 0) return;
  if (sayNow(sim, e) || e.life <= 0) {
    P.q.shift();
    if (e.instr && !P.hinted && P.api) {
      P.hinted = true;
      notify(sim, sim.touch || (P.ui && P.ui.touch) ? 'Tap READBACK to read the instruction back' : `Read it back: the READBACK button, or ${P.api.radioKeyName(sim)}`, 'info', 5);
    }
  }
}

/** The director's own lines ("cleared to land", "hold short", "contact Haven Tower") become instructions too. */
function wrapSay(sim) {
  const d = sim.atc;
  if (!d || d.__plusHeard) return;
  const inner = d.say;
  d.__plusHeard = true;
  d.say = function sayHeard(text, ...rest) {
    if (!P.mine && live(sim)) {
      // An arrival on final while you were told to hold short: no take-off clearance, whoever asked.
      try {
        const st = P.ctl.st;
        if (st.holdShort && /cleared for take-off/i.test(String(text))) {
          const s = snapOf(sim);
          if (runwayConflict(s)) {
            P.q.push({ text: `${s.cs}, ${s.field.name} Tower, hold position, traffic on final. I will call you.`, voice: 'tower', urgency: 0, at: 0, force: true, life: 6 });
            return false;
          }
        }
      } catch (e) {
        void e;
      }
    }
    const said = inner.call(this, text, ...rest);
    if (said !== false && !P.mine && live(sim)) {
      try {
        P.ctl.heard(text, snapOf(sim));
      } catch (e) {
        void e;
      }
    }
    return said;
  };
}

/* ------------------------------------------------------------------ *
 * The fire crews for an emergency (features/emergency-scene.js)
 * ------------------------------------------------------------------ */

function raiseCrews(sim) {
  if (P.scene || !sim.emergencyScene || sim.multiplayer && sim.multiplayer.active) return;
  const nf = navField();
  const cx = nf ? nf.cx : RUNWAY.cx || 0;
  const cz = nf ? nf.cz : RUNWAY.cz || 0;
  const hw = nf ? nf.halfWidth : RUNWAY.halfWidth || 25;
  try {
    P.scene = sim.emergencyScene.raise({
      at: { x: cx, z: cz + hw + 140 }, kind: 'fire', radius: 60, roads: false, avoidRunway: true,
      crews: { fire: 2, ambulance: 1, police: 0 }, helis: { police: 0, news: 0, medevac: 0, fire: 0 }, label: 'Emergency services',
    });
  } catch (e) {
    P.scene = null;
  }
  P.sceneT = 0;
}

function clearCrews(sim) {
  if (P.scene && sim.emergencyScene) {
    try {
      sim.emergencyScene.clear(P.scene);
    } catch (e) {
      void e;
    }
  }
  P.scene = null;
  P.sceneT = 0;
}

/* ------------------------------------------------------------------ *
 * The public face (pilot-systems.js forwards to these)
 * ------------------------------------------------------------------ */

const inCockpit = (sim) => !!(P.api && P.api.inCockpit(sim));
/** The controller speaks unasked only in Free Flight: a mission's script has the frequency (requests are still answered). */
const live = (sim) => sim.mode === 'free' && inCockpit(sim);

export function attach(sim, api) {
  P.sim = sim;
  P.api = api;
  sim.atcPlus = { centre: '127.85', state };
  wrapSay(sim);
}

/** A flight starts or ends: a fresh controller, nothing waiting, the traffic released. */
export function reset(sim) {
  P.ctl.reset();
  P.q.length = 0;
  P.acc = 0;
  P.menuKey = '';
  P.nowKey = '';
  if (sim) {
    sim.atcEmergency = null;
    clearCrews(sim);
  }
  if (P.ui) {
    P.ui.chip.classList.remove('is-shown');
    hideScore();
  }
}

export function pendingCount() {
  return P.ctl.pending().length;
}

/** An extra request from the card. Returns the controller's answer. */
export function request(sim, id) {
  if (!inCockpit(sim) || !sim.atc) return null;
  const s = snapOf(sim);
  const r = P.ctl.request(id, s);
  if (!r) return null;
  if (r.you) notify(sim, `You: "${r.you}."`, id === 'mayday' || id === 'panpan' ? 'warn' : 'info', REPLY + 1.6);
  P.lastYou = r.you || '';
  handle(sim, r.events, { delay: id === 'readback' ? 1 : REPLY, force: true });
  if (P.api) P.api.closeRadio();
  syncAll(sim, true);
  return r;
}

/** Read back everything waiting. */
export function readback(sim) {
  if (!inCockpit(sim)) return null;
  const r = P.ctl.readback(snapOf(sim));
  if (!r) return null;
  notify(sim, `You: "${r.you}."`, 'good', 3.4);
  P.lastYou = r.you;
  handle(sim, r.events, { delay: 1.2, force: true });
  if (P.api) P.api.closeRadio();
  syncAll(sim, true);
  return r;
}

/** The head line of the radio card / ATC window: "KESTREL TOWER 118.30". */
export function freqLabel(sim) {
  if (!sim || !sim.aircraft || !sim.atc) return '';
  const c = P.ctl.current(P.snap || snapOf(sim));
  return `${c.name.toUpperCase()} ${c.freq}`;
}

export function update(sim, dt) {
  wrapSay(sim);
  if (P.sceneT > 0) {
    P.sceneT -= dt;
    if (P.sceneT <= 0) clearCrews(sim);
  }
  if (P.scoreT > 0) {
    P.scoreT -= dt;
    if (P.scoreT <= 0) hideScore();
  }
  if (!inCockpit(sim) || !sim.atc) {
    if (P.ui && P.ui.chip.classList.contains('is-shown')) P.ui.chip.classList.remove('is-shown');
    return;
  }
  flush(sim, dt);
  P.acc += dt;
  if (P.acc >= 0.25) {
    const s = snapOf(sim);
    P.snap = s;
    const ev = live(sim) ? P.ctl.step(P.acc, s) : [];
    P.acc = 0;
    handle(sim, ev);
    syncAll(sim);
  }
}

/** For the browser check and the console. */
export function state() {
  const c = P.snap ? P.ctl.current(P.snap) : null;
  return {
    unit: P.ctl.st.unit, current: c, pending: P.ctl.pending().map((i) => ({ kind: i.kind, words: i.words, rb: i.rb })),
    instructions: P.ctl.instr.map((i) => ({ kind: i.kind, words: i.words, read: i.read, missed: i.missed, warned: i.warned })),
    targets: { alt: P.ctl.st.tg.alt && P.ctl.st.tg.alt.v, hdg: P.ctl.st.tg.hdg && P.ctl.st.tg.hdg.v, kts: P.ctl.st.tg.kts && P.ctl.st.tg.kts.v, direct: P.ctl.st.tg.direct && P.ctl.st.tg.direct.name },
    approach: P.ctl.st.approach, seq: P.ctl.st.seq, holdShort: P.ctl.st.holdShort, emergency: P.ctl.st.emergency, squawk: P.ctl.st.squawk,
    reminders: P.ctl.reminders, score: P.ctl.score(), shownScore: P.score, queued: P.q.length, lastYou: P.lastYou,
    menu: P.snap ? P.ctl.menu(P.snap).map((r) => r.id) : [], scene: !!P.scene,
  };
}

/** The controller itself, for the browser check. */
export function controller() {
  return P.ctl;
}

/* ------------------------------------------------------------------ *
 * The buttons
 * ------------------------------------------------------------------ */

const CSS = `
.ap-now { margin: -2px 0 6px; padding: 6px 8px; border-radius: 9px; background: rgba(255,255,255,.05); border: 1px solid rgba(140,180,230,.18); }
.ap-unit { display: flex; justify-content: space-between; gap: 6px; font-size: 10px; letter-spacing: .06em; color: #bfe6ff; }
.ap-unit span { color: var(--text-dim, #9fb2cc); font-variant-numeric: tabular-nums; }
.ap-instr { margin-top: 3px; font-size: 11.5px; line-height: 1.25; }
.ap-instr:empty { display: none; }
.ap-tg { margin-top: 2px; font-size: 9.5px; letter-spacing: .04em; color: var(--text-dim, #9fb2cc); font-variant-numeric: tabular-nums; }
.ap-tg:empty { display: none; }
.ap-now .ap-rb { margin-top: 6px; width: 100%; }
.ps-btn.ap-rb { border-color: rgba(126,232,178,.8); background: rgba(70,170,120,.22); min-height: 44px; }
.ps-btn.ap-rb[hidden] { display: none; }
.ap-grid { margin-top: 5px; }
.ps-btn.is-warn { border-color: rgba(255,170,90,.6); color: #ffd7b0; }
.ap-chip { width: auto; min-width: 150px; max-width: 230px; }
.ap-chip .ps-btn { width: 100%; }
.ap-score b { font-size: 20px; letter-spacing: .02em; }
.ap-score .ps-note { margin-top: 3px; }
.ps-radio.is-mini .ap-grid, .ps-radio.is-mini .ap-tg { display: none; }
@media (max-height: 560px) { .ap-grid .ps-btn { min-height: 40px; padding: 4px 6px; } .ap-now { padding: 4px 6px; } }
`;

function buildUi(sim) {
  if (P.ui || typeof document === 'undefined' || !P.api) return P.ui;
  const radio = P.api.radioEl();
  if (!radio) return null;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const now = document.createElement('div');
  now.className = 'ap-now';
  now.innerHTML = '<div class="ap-unit"><b class="ap-who"></b><span class="ap-fq"></span></div><div class="ap-instr"></div><div class="ap-tg"></div><button class="ps-btn is-wide ap-rb" type="button" data-readback hidden>READBACK<small></small></button>';
  const head = radio.querySelector('.ps-head');
  head.after(now);
  const grid = document.createElement('div');
  grid.className = 'ps-grid ap-grid';
  const base = radio.querySelector('.ps-grid:not(.ap-grid)');
  (base || now).after(grid);
  const chip = document.createElement('div');
  chip.className = 'ps-card ap-chip';
  chip.innerHTML = `<button class="ps-btn is-wide ap-rb" type="button" data-readback aria-label="Read back the controller's instruction">${icon('radio', 14)} READBACK<small></small></button>`;
  const score = document.createElement('div');
  score.className = 'ps-card ap-score';
  score.setAttribute('role', 'status');
  const onClick = (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    e.preventDefault();
    b.blur();
    if (b.hasAttribute('data-readback')) readback(sim);
    else if (b.dataset.atcx) request(sim, b.dataset.atcx);
    else if (b.dataset.close != null) hideScore();
  };
  for (const el of [now, grid, chip, score]) el.addEventListener('click', onClick);
  extLayer().appendChild(chip);
  extLayer().appendChild(score);
  P.ui = {
    now, grid, chip, score, who: now.querySelector('.ap-who'), fq: now.querySelector('.ap-fq'), instr: now.querySelector('.ap-instr'),
    tg: now.querySelector('.ap-tg'), rb: now.querySelector('.ap-rb'), chipSmall: chip.querySelector('small'),
    touch: !!sim.touch || (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches), joined: false,
  };
  return P.ui;
}

/** The card's top, its extra buttons and the READBACK chip, from the controller. */
export function syncAll(sim, force = false) {
  const ui = buildUi(sim);
  if (!ui || !P.api || !sim.aircraft || !sim.atc) return;
  const s = P.snap || snapOf(sim);
  const c = P.ctl.current(s);
  const pend = P.ctl.pending();
  const rbWords = pend.map((i) => i.words).slice(-2).join(' · ');
  const nowKey = `${c.name}|${c.freq}|${c.now}|${c.targets}|${rbWords}`;
  if (force || nowKey !== P.nowKey) {
    P.nowKey = nowKey;
    ui.who.textContent = c.name.toUpperCase();
    ui.fq.textContent = c.freq;
    ui.instr.textContent = c.now;
    ui.tg.textContent = c.targets;
    ui.rb.hidden = !pend.length;
    ui.rb.lastElementChild.textContent = rbWords;
    ui.chipSmall.textContent = ui.touch ? rbWords : `${rbWords} · ${P.api.radioKeyName(sim)}`;
  }
  const open = P.api.state().radioOpen;
  if (open) {
    // The emergency calls are always there; the rest by the moment, fewer on a touchscreen's column.
    const all = P.ctl.menu(s).filter((r) => r.id !== 'readback');
    const menu = all.filter((r) => !r.warn).slice(0, ui.touch ? 4 : 8).concat(all.filter((r) => r.warn));
    const key = menu.map((r) => `${r.id}:${r.sub}`).join('|');
    if (force || key !== P.menuKey) {
      P.menuKey = key;
      ui.grid.innerHTML = menu.map((r) => `<button class="ps-btn${r.warn ? ' is-warn' : ''}" type="button" data-atcx="${r.id}">${r.label.toUpperCase()}<small>${r.sub || r.words}</small></button>`).join('');
    }
  }
  const showChip = pend.length > 0 && !open && !(sim.hud && (sim.hud.enabled === false || sim.hud.hidden));
  if (showChip && !ui.joined) ui.joined = P.api.joinStack(sim, ui.chip, { prio: 1.25, id: 'atc-readback', chip: false, keep: true });
  if (showChip && !ui.joined) {
    // No HUD column (a test page): float it bottom centre.
    ui.chip.style.cssText = 'position:fixed;left:50%;bottom:120px;transform:translateX(-50%);z-index:41;';
  }
  if (ui.chip.classList.contains('is-shown') !== showChip) ui.chip.classList.toggle('is-shown', showChip);
}

function showScore(sim, sc) {
  const ui = buildUi(sim);
  P.score = sc;
  if (!ui || !sc || sc.pct == null) return;
  const word = sc.pct >= 90 ? 'Excellent radio work' : sc.pct >= 70 ? 'Good radio work' : sc.pct >= 50 ? 'Some calls missed' : 'Lots of calls missed';
  ui.score.innerHTML = `<div class="ps-head"><span>${icon('radio', 14)} ATC SCORE</span><button class="ps-close" type="button" data-close aria-label="Close the ATC score">${icon('close', 14)}</button></div>
    <b>${sc.pct}%</b> <span>${word}</span>
    <div class="ps-note">${sc.read + sc.late} of ${sc.instructions} read back${sc.late ? ` (${sc.late} late)` : ''}${sc.flown ? ` · ${sc.kept} of ${sc.flown} flown as told` : ''}${sc.reminders ? ` · ${sc.reminders} reminder${sc.reminders > 1 ? 's' : ''}` : ''}</div>`;
  if (!ui.scoreJoined) ui.scoreJoined = P.api.joinStack(sim, ui.score, { prio: 1.4, id: 'atc-score', chip: false, keep: true });
  ui.score.classList.add('is-shown');
  P.scoreT = SCORE_FOR;
  notify(sim, `ATC score ${sc.pct}% — ${word.toLowerCase()}`, sc.pct >= 70 ? 'good' : 'info', 4);
}

function hideScore() {
  P.scoreT = 0;
  if (P.ui) P.ui.score.classList.remove('is-shown');
}

// The frame helper is re-exported for the browser check's flown approach.
export { frameOf };

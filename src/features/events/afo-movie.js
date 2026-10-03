/**
 * Air Force One: the movie.
 *
 * "It should be super sigma and overly dramatic, like you're in a movie" —
 * for EVERY Air Force One mission, in EVERY seat (captain, the lead fighter,
 * the President). This is the one place that drama lives: a thin, cheap
 * overlay that watches whichever AFO seat is running (captain/escort/
 * president, normal/attack — the same read every other AFO file does,
 * `sim.runner.def`) and puts a letterboxed title card up at the big
 * moments, a short caption at the smaller ones, and a brief vignette when a
 * missile is in the air. It never touches a mission's own steps, text or
 * scoring — nothing here can fail a mission or block a control.
 *
 * SAFE BY CONSTRUCTION. Every beat is on a clock (counted in game seconds,
 * through update()'s own dt, so it cannot run on while the game is paused)
 * and clears itself; the bars are `pointer-events: none`; the biggest bars
 * (a mission's opening and closing card) only ever show while the aeroplane
 * is stationary or the mission is already decided; the in-flight beats
 * (wheels up, the join-up, a missile launched, touchdown) use thin bars
 * that leave most of the screen clear. Press the same key that skips a
 * hijack's own cinematic (Settings → Controls → "Skip cinematic") to clear
 * whatever is up right now.
 *
 * Kid-safe throughout, exactly like afo-combat.js: no gore, nobody named,
 * nobody hurt — this is tone, not content.
 */

import { registerExtension, extLayer } from '../../game/extensions.js';
import { isKey } from '../../flight/input.js';
import { field } from './common.js';

const ID_NORMAL = 'afo-normal';
const ID_ATTACK = 'afo-attack';

const CSS = `
#afo-movie { position: fixed; inset: 0; pointer-events: none; z-index: 32; overflow: hidden; }
#afo-movie[hidden] { display: none !important; }
#afo-movie .am-bar {
  position: absolute; left: 0; right: 0; background: #07070a; opacity: 0.92;
  height: 0; transition: height 0.4s cubic-bezier(.2,.7,.2,1);
}
#afo-movie .am-bar.top { top: 0; }
#afo-movie .am-bar.bot { bottom: 0; }
#afo-movie.am-big .am-bar { height: 12.5%; }
#afo-movie.am-thin .am-bar { height: 5.2%; }
#afo-movie .am-title {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  text-align: center; opacity: 0; transition: opacity 0.5s ease; width: min(92vw, 640px);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  color: #f4f1e6; text-shadow: 0 2px 16px rgba(0, 0, 0, 0.7);
}
#afo-movie.am-big .am-title.on { opacity: 1; }
#afo-movie .am-title b {
  display: block; font-size: clamp(22px, 5vw, 34px); font-weight: 800; letter-spacing: 0.16em;
  text-transform: uppercase; margin-bottom: 8px;
}
#afo-movie .am-title span {
  display: block; font-size: 12.5px; font-weight: 600; letter-spacing: 0.22em; text-transform: uppercase;
  color: #cdd6e4;
}
#afo-movie .am-chip {
  position: absolute; left: 50%; bottom: 2.6%; transform: translate(-50%, 50%);
  opacity: 0; transition: opacity 0.35s ease; color: #fff; text-align: center;
  font: 800 13px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  letter-spacing: 0.16em; text-transform: uppercase; text-shadow: 0 1px 10px rgba(0, 0, 0, 0.8);
  white-space: nowrap;
}
#afo-movie.am-thin .am-chip.on { opacity: 1; }
#afo-movie .am-pulse {
  position: absolute; inset: 0; opacity: 0; transition: opacity 0.3s ease;
  background: radial-gradient(ellipse at center, rgba(10, 2, 2, 0) 44%, rgba(120, 14, 14, 0.4) 100%);
}
#afo-movie .am-pulse.on { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  #afo-movie .am-bar, #afo-movie .am-title, #afo-movie .am-chip, #afo-movie .am-pulse { transition: none; }
}
`;

const S = {
  sim: null,
  active: false,
  missionId: null,
  seatId: null,
  lastStepIndex: -1,
  lastStepId: null,
  lastStatus: null,
  lastMissiles: 0,
  endShown: false,
  queue: [],
  beat: null, // { kind, left }
  el: null,
};

function build() {
  if (S.el || typeof document === 'undefined') return S.el;
  if (!document.getElementById('afo-movie-style')) {
    const st = document.createElement('style');
    st.id = 'afo-movie-style';
    st.textContent = CSS;
    document.head.appendChild(st);
  }
  const root = document.createElement('div');
  root.id = 'afo-movie';
  root.hidden = true;
  root.innerHTML = `
    <div class="am-bar top"></div>
    <div class="am-bar bot"></div>
    <div class="am-title"><b data-am-main></b><span data-am-sub></span></div>
    <div class="am-chip" data-am-chip></div>
    <div class="am-pulse"></div>`;
  extLayer().appendChild(root);
  S.el = {
    root,
    title: root.querySelector('.am-title'),
    main: root.querySelector('[data-am-main]'),
    sub: root.querySelector('[data-am-sub]'),
    chip: root.querySelector('[data-am-chip]'),
    pulse: root.querySelector('.am-pulse'),
  };
  return S.el;
}

/** Which AFO mission/seat is running now, straight off the live runner — never cached. */
function currentSeat(sim) {
  const r = sim && sim.runner;
  const def = r && r.def;
  if (!def || (def.id !== ID_NORMAL && def.id !== ID_ATTACK)) return { mission: null, seat: null, def: null, status: null };
  return { mission: def.id, seat: def.roleId || 'captain', def, status: r.status };
}

/** The other seats' live drone/missile count, read the same way their own steps do. */
function attackCounts(sim, mission, seat) {
  if (mission !== ID_ATTACK) return { missiles: 0 };
  try {
    if (seat === 'captain') {
      // Lazy require avoided: this module is only ever imported after
      // features/index.js has already loaded afo.js, so a static import is
      // safe and keeps this file free of dynamic-import timing.
      return { missiles: AfoCaptainInfo().missilesInbound || 0 };
    }
    if (seat === 'escort') {
      return { missiles: CastInfo().missilesInbound || 0 };
    }
    if (seat === 'president') {
      return { missiles: PresidentInfo().missilesInbound || 0 };
    }
  } catch (e) {
    /* a feature that is not live yet reports nothing; no beat is fine */
  }
  return { missiles: 0 };
}

/* The three info readers, bound once real modules are available (see
 * install()) — kept as plain function refs so attackCounts() above never
 * has to know which seat means which import. */
let AfoCaptainInfo = () => ({ missilesInbound: 0 });
let CastInfo = () => ({ missilesInbound: 0 });
let PresidentInfo = () => ({ missilesInbound: 0 });

const TITLES = {
  [ID_NORMAL]: () => ({ main: 'AIR FORCE ONE', sub: `${field()} TOWER — 0600 HOURS` }),
  [ID_ATTACK]: () => ({ main: 'AIR FORCE ONE', sub: 'UNDER ATTACK — UNIDENTIFIED CONTACTS' }),
};
const END_TITLE = {
  [ID_NORMAL]: 'MISSION COMPLETE',
  [ID_ATTACK]: 'HOME SAFE',
};
const LIFTOFF_CHIP = { captain: 'WHEELS UP', escort: 'GUARDIAN, AIRBORNE', president: 'CLIMBING OUT' };
const LAND_CHIP = { captain: 'DOWN SAFE', escort: 'HOME, TOGETHER', president: 'WHEELS DOWN' };
const JOIN_CHIP = 'ON HIS WING';
const MISSILE_CHIP = 'MISSILE IN THE AIR';

function queueBeat(kind, opts) {
  if (S.queue.length > 4) return;
  S.queue.push({ kind, ...opts });
}

function clearBeat() {
  if (!S.beat) return;
  S.beat = null;
  const e = build();
  if (!e) return;
  e.root.className = '';
  e.title.classList.remove('on');
  e.chip.classList.remove('on');
  e.pulse.classList.remove('on');
}

function showNext() {
  const e = build();
  if (!e || S.beat || !S.queue.length) return;
  const b = S.queue.shift();
  S.beat = b;
  if (b.kind === 'card') {
    e.root.className = 'am-big';
    e.main.textContent = b.main || '';
    e.sub.textContent = b.sub || '';
    e.title.classList.add('on');
    b.left = b.dur ?? 2.6;
  } else if (b.kind === 'caption') {
    e.root.className = 'am-thin';
    e.chip.textContent = b.chip || '';
    e.chip.classList.add('on');
    b.left = b.dur ?? 1.7;
  } else if (b.kind === 'pulse') {
    e.root.className = '';
    e.chip.textContent = b.chip || '';
    e.chip.classList.add('on');
    e.pulse.classList.add('on');
    b.left = b.dur ?? 0.85;
  }
  e.root.hidden = false;
}

function hideAll() {
  S.queue.length = 0;
  clearBeat();
  const e = build();
  if (e) e.root.hidden = true;
}

function resetRun() {
  S.lastStepIndex = -1;
  S.lastStepId = null;
  S.lastStatus = null;
  S.lastMissiles = 0;
  S.endShown = false;
  hideAll();
}

registerExtension({
  id: 'afo-movie',

  install(sim) {
    S.sim = sim;
    // Bound lazily: these three modules all import plenty of their own
    // THREE/scene state, and this file's only job is to read their public
    // info readers back, the same way every AFO step already does.
    import('./afo.js').then((m) => { AfoCaptainInfo = m.afoInfo; }).catch(() => {});
    import('../../game/roles/cast.js').then((m) => { CastInfo = m.castInfo; }).catch(() => {});
    import('../../game/roles/afo-president.js').then((m) => { PresidentInfo = m.presidentInfo; }).catch(() => {});
  },

  startMode(sim) {
    const { mission, seat } = currentSeat(sim);
    S.active = !!mission;
    S.missionId = mission;
    S.seatId = seat;
    resetRun();
    if (!S.active) return;
    const t = TITLES[mission] ? TITLES[mission]() : null;
    if (t) queueBeat('card', { main: t.main, sub: t.sub, dur: 2.6 });
  },

  stop() {
    S.active = false;
    hideAll();
  },

  update(sim, dt) {
    const { mission, seat, status } = currentSeat(sim);
    if (mission !== S.missionId || seat !== S.seatId) {
      S.active = !!mission;
      S.missionId = mission;
      S.seatId = seat;
      resetRun();
      if (S.active) {
        const t = TITLES[mission] ? TITLES[mission]() : null;
        if (t) queueBeat('card', { main: t.main, sub: t.sub, dur: 2.6 });
      }
    }
    if (!S.active) return;

    const r = sim.runner;
    const step = r && r.step;
    const stepIndex = r ? r.stepIndex : -1;
    const stepId = step ? step.id : null;

    // The first step completing: wheels up / scrambled / climbing out —
    // the same "left the ground" beat, worded per seat.
    if (S.lastStepIndex === 0 && stepIndex > 0) {
      queueBeat('caption', { chip: LIFTOFF_CHIP[seat] || LIFTOFF_CHIP.captain });
    }
    // The escort's own signature moment: settling onto the wing.
    if (seat === 'escort' && S.lastStepId === 'join' && stepId && stepId !== 'join') {
      queueBeat('caption', { chip: JOIN_CHIP });
    }
    // Touchdown: the 'land' step completing, for captain and escort (the
    // one step id both of those seats actually carry).
    if (S.lastStepId === 'land' && stepId && stepId !== 'land') {
      queueBeat('caption', { chip: LAND_CHIP[seat] || LAND_CHIP.captain });
    }
    S.lastStepIndex = stepIndex;
    S.lastStepId = stepId;

    // A missile just launched: a half-second, cosmetic "bullet-time" pulse —
    // never a change to the simulation's own clock, just a vignette and a
    // word, so nothing about the attack's timing or fairness changes.
    const missiles = attackCounts(sim, mission, seat).missiles;
    if (missiles > 0 && S.lastMissiles === 0) queueBeat('pulse', { chip: MISSILE_CHIP });
    S.lastMissiles = missiles;

    // The ending: one card, whichever way it went, shown once.
    if (!S.endShown && status !== S.lastStatus) {
      if (status === 'complete') {
        S.endShown = true;
        queueBeat('card', { main: END_TITLE[mission] || 'MISSION COMPLETE', sub: 'WELL FLOWN', dur: 3 });
      } else if (status === 'failed') {
        S.endShown = true;
        queueBeat('caption', { chip: 'MISSION NOT COMPLETE', dur: 2.2 });
      }
    }
    S.lastStatus = status;

    // The clock on whatever is up now.
    if (S.beat) {
      S.beat.left -= dt;
      if (S.beat.left <= 0) clearBeat();
    }
    showNext();
    if (!S.beat && !S.queue.length) {
      const e = S.el;
      if (e && !e.root.hidden) e.root.hidden = true;
    }
  },

  key(sim, code, down) {
    if (!down || !S.beat) return false;
    if (isKey(sim, 'eventSkip', code)) {
      clearBeat();
      showNext();
      return true;
    }
    return false;
  },
});

/** For the tests. */
export function movieState() {
  return { active: S.active, missionId: S.missionId, seatId: S.seatId, beat: S.beat ? S.beat.kind : null, queued: S.queue.length };
}

/** Force a beat up right now (tests and the proof screenshots only — nothing in the game calls this). */
export function _forceBeat(kind, opts) {
  queueBeat(kind, opts || {});
  showNext();
}

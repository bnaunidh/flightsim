/**
 * Things you can use on foot: one registry, one prompt, one key.
 *
 * The owner, 2026-10-12: "everything should be interactable". Hangar doors,
 * shed doors, gates and barrier arms, the fuel pump, the tower door, the
 * lights in a hangar — every one of them is a CANDIDATE that a source lists
 * when you are near it, and this file picks the one you are closest to and
 * looking at, and puts it on the walker's prompt line as
 *
 *     E — Open hangar
 *
 * (the player's key, wherever they have moved it in Settings → Controls →
 * On foot), with a tap on the prompt — or a "Use" button — doing the same on
 * a touch screen. Getting INTO things stays where it always was (O, and
 * onfoot.js's enterables): this is for everything else.
 *
 * A CANDIDATE is a plain object a source adds each frame:
 *   { id, label, x, z, reach = 3, face = null, look = 70, hold = 0, run(sim), why = '' }
 *   - (x, z) where it is; reach how close you must be (metres, flat)
 *   - face   the compass heading its front looks along, if it only works
 *            from in front (a door from either side: leave it null)
 *   - look   how far off where you are looking it may be, degrees
 *   - hold   seconds E must be held (a big door), 0 for a press (a switch)
 *   - run    what using it does; may return a line to say
 *   - why    if set, it cannot be used now and this is why (said on use)
 *
 * PURE where it can be: pickFocus() and stepHold() take numbers and lists,
 * and tests/features/interact.mjs drives them with no game at all.
 *
 * The key is `interact`, ctx 'foot', E by default — the same E as Wave, a
 * share by design (both defaults, so findConflicts() never calls it a
 * clash): with something in front of you E uses it, and with nothing there
 * E waves, as it always did.
 */

import { registerActions, keyName } from '../flight/input.js';

registerActions({
  interact: { label: 'Use / open (hangars, doors, gates, the fuel pump, switches)', group: 'On foot', ctx: ['foot'], default: ['KeyE'] },
});

const D2R = Math.PI / 180;

/** Where each list of candidates comes from: { id, list(sim, walker, add) }. */
const SOURCES = [];

export function addInteractSource(src) {
  if (!src || !src.id || typeof src.list !== 'function') return false;
  const i = SOURCES.findIndex((s) => s.id === src.id);
  if (i >= 0) SOURCES[i] = src;
  else SOURCES.push(src);
  return true;
}

export function removeInteractSource(id) {
  const i = SOURCES.findIndex((s) => s.id === id);
  if (i >= 0) SOURCES.splice(i, 1);
}

export function interactSources() {
  return SOURCES.map((s) => s.id);
}

/** Signed difference b - a in degrees, -180..180. */
function angleDiff(b, a) {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * The candidate you mean, or null: inside its reach, in front of it if it
 * has a front, and within its `look` of where you are looking — nearest
 * first, with being looked at straight on worth a metre and a half.
 * `w` is { x, z }; `lookDeg` the compass heading the camera (or the body)
 * looks along.
 */
export function pickFocus(cands, w, lookDeg) {
  let best = null;
  let bestScore = Infinity;
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.z)) continue;
    const dx = c.x - w.x;
    const dz = c.z - w.z;
    const d = Math.hypot(dx, dz);
    const reach = c.reach > 0 ? c.reach : 3;
    if (d > reach) continue;
    if (c.face != null && Number.isFinite(c.face)) {
      // On its front side: the walker is in the half-plane its face looks into.
      const fx = Math.sin(c.face * D2R);
      const fz = -Math.cos(c.face * D2R);
      if ((w.x - c.x) * fx + (w.z - c.z) * fz < -0.4) continue;
    }
    // Right on top of it, any direction will do.
    let off = 0;
    if (d > 1.2 && Number.isFinite(lookDeg)) {
      const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
      off = Math.abs(angleDiff(bearing, lookDeg));
      if (off > (c.look > 0 ? c.look : 70)) continue;
    }
    const score = d + (off / 90) * 1.5;
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  if (best) best.dist = Math.hypot(best.x - w.x, best.z - w.z);
  return best;
}

/**
 * One frame of holding the key: { t, fired } in, the same object out.
 * A hold of 0 fires on the press (`pressed`); a longer one fills while
 * `held` and fires once when full, and must be let go before it can fire
 * again. Letting go early drains it back.
 */
export function stepHold(st, { held, pressed, hold, dt }) {
  if (!(hold > 0)) {
    st.t = 0;
    if (pressed && !st.fired) {
      st.fired = true;
      st.fire = true;
    } else st.fire = false;
    if (!held) st.fired = false;
    return st;
  }
  st.fire = false;
  if (held && !st.fired) {
    st.t = Math.min(1, st.t + dt / hold);
    if (st.t >= 1) {
      st.fired = true;
      st.fire = true;
    }
  } else if (!held) {
    st.fired = false;
    st.t = Math.max(0, st.t - dt * 3);
  }
  return st;
}

/* ------------------------------------------------------------------ */
/* The live state, for onfoot.js                                       */
/* ------------------------------------------------------------------ */

const S = {
  list: [],
  pool: [],
  used: 0,
  focus: null,
  /** The focus's id the hold belongs to: changing what you face starts it again. */
  holdId: null,
  hold: { t: 0, fired: false, fire: false },
  pressed: false,
  /** A line to say, and when it was last said (no repeating it every frame). */
  said: '',
  saidT: 0,
  sim: null,
  /** For the tests: what was last used. */
  lastUsed: null,
  uses: 0,
};

/** A pooled candidate for this frame. Sources call this through `add`. */
function add(c) {
  if (!c) return null;
  let o = S.pool[S.used];
  if (!o) {
    o = {};
    S.pool.push(o);
  }
  S.used++;
  for (const k in o) delete o[k];
  Object.assign(o, c);
  S.list.push(o);
  return o;
}

/** Ask every source for what is near the walker. A source that throws is skipped this frame. */
export function gather(sim, w) {
  S.list.length = 0;
  S.used = 0;
  for (let i = 0; i < SOURCES.length; i++) {
    try {
      SOURCES[i].list(sim, w, add);
    } catch (e) {
      if (!SOURCES[i]._warned) {
        SOURCES[i]._warned = true;
        console.warn(`[interact] "${SOURCES[i].id}" failed to list what can be used`, e);
      }
    }
  }
  return S.list;
}

function notify(sim, text, kind = 'info', secs = 2.6) {
  try {
    if (sim && sim.hud && sim.hud.notify) sim.hud.notify(text, kind, secs);
  } catch (e) {
    /* a HUD that is not there is not worth a thrown frame */
  }
}

function use(sim, c) {
  if (!c) return;
  if (c.why) {
    notify(sim, c.why, 'info', 2.8);
    return;
  }
  let msg = null;
  try {
    msg = typeof c.run === 'function' ? c.run(sim) : null;
  } catch (e) {
    console.warn(`[interact] using "${c.id}" failed`, e);
    msg = 'That will not budge just now';
  }
  S.lastUsed = c.id;
  S.uses++;
  if (typeof msg === 'string' && msg) notify(sim, msg, 'info', 2.6);
}

/**
 * Every walking frame (onfoot.js walkFrame): who is in focus, and the hold.
 * `held` is whether the interact key is down in the walker's own table.
 */
export function frame(sim, w, lookDeg, dt, held) {
  S.sim = sim;
  const list = gather(sim, w);
  const f = list.length ? pickFocus(list, w, lookDeg) : null;
  S.focus = f;
  const id = f ? f.id : null;
  if (id !== S.holdId) {
    S.holdId = id;
    S.hold.t = 0;
    S.hold.fired = !!held;
  }
  if (f) {
    stepHold(S.hold, { held: !!held, pressed: S.pressed, hold: f.why ? 0 : f.hold || 0, dt });
    if (S.hold.fire) use(sim, f);
  } else {
    S.hold.t = 0;
  }
  S.pressed = false;
  return f;
}

/** The key went down (not a repeat). Returns true if something is in focus to take it. */
export function press() {
  if (!S.focus) return false;
  S.pressed = true;
  return true;
}

/** Is there something to use right now? onfoot.js asks before it lets E wave. */
export function focused() {
  return !!S.focus;
}

export function focus() {
  return S.focus;
}

/** A tap on the prompt or the Use button: it is used at once, however long its hold. */
export function tap(sim) {
  const f = S.focus;
  if (!f) return false;
  use(sim || S.sim, f);
  S.hold.t = 0;
  return true;
}

/** Off foot: nothing is in focus and nothing is held. */
export function reset() {
  S.focus = null;
  S.holdId = null;
  S.hold.t = 0;
  S.hold.fired = false;
  S.pressed = false;
  S.list.length = 0;
}

/* The hold bar under the words: thin, calm, in the prompt's own gold. */
const CSS = `
.of-prompt .ia-bar { display: block; height: 4px; margin: 7px auto 1px; width: 120px; max-width: 70%;
  border-radius: 3px; background: rgba(255, 255, 255, 0.16); overflow: hidden; }
.of-prompt .ia-bar i { display: block; height: 100%; background: #f2c53d; border-radius: 3px; }
`;
let cssDone = false;
function ensureCss() {
  if (cssDone || typeof document === 'undefined' || !document.head || !document.createElement) return;
  cssDone = true;
  const el = document.createElement('style');
  el.textContent = CSS;
  document.head.appendChild(el);
}

/** The prompt line: "E — Open hangar", with how far the hold has got. */
export function promptHtml(sim, touch = false) {
  const f = S.focus;
  if (!f) return '';
  ensureCss();
  const label = String(f.label || 'Use');
  if (touch) return `Tap here — ${label}`;
  const k = keyName('interact', sim);
  const holdWord = f.hold > 0 && !f.why ? ' (hold)' : '';
  const bar = f.hold > 0 && !f.why && S.hold.t > 0
    ? `<span class="ia-bar"><i style="width:${Math.round(S.hold.t * 20) * 5}%"></i></span>`
    : '';
  return `<kbd>${k}</kbd> — ${label}${holdWord}${bar}`;
}

/** A short word for the Use button on a touch screen. */
export function buttonLabel() {
  const f = S.focus;
  if (!f) return '';
  return f.short || 'Use';
}

/** For the tests and the console. */
export function interactState() {
  return {
    sources: interactSources(),
    focus: S.focus ? { id: S.focus.id, label: S.focus.label, dist: S.focus.dist, hold: S.focus.hold || 0 } : null,
    candidates: S.list.map((c) => c.id),
    hold: S.hold.t,
    lastUsed: S.lastUsed,
    uses: S.uses,
  };
}

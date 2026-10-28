/**
 * Mission checkpoints and the "leave this page?" guard.
 *
 * Tomm1z (3:51 and 5:42): Ctrl is "less power" and W is a game key, so
 * Ctrl+W comes naturally — and Chrome closes the tab on it, twice, mid-
 * mission ("see if it saved my progress... No, it did not"). A page cannot
 * refuse Ctrl+W / Cmd+W / Ctrl+Q; what it can do is ask first (beforeunload,
 * while a flight is on: guardUnload) and remember where you were.
 *
 * The checkpoint, every EVERY_S seconds of a running mission or lesson:
 * the mode and its options (so startMode() can be called again exactly as
 * the menu called it), the step reached, and the aeroplane's pose (the
 * story's own helpers, story/save.js). A reload within MAX_AGE_MS offers
 * "Resume your mission?" on the main menu: the same mission, at the start
 * of the step you were on, the aeroplane where it was. What is NOT kept,
 * honestly: anything a mission gathered in the steps before (a drop made,
 * a landing graded, a timer) — the step starts afresh, and the score is
 * the resumed run's. Free Flight has nothing to resume, and Story has its
 * own autosave (story/director.js), so neither is written here.
 *
 * Pure: no DOM, no game object; main.js wires it, tests/features/tomm1z-unload.mjs runs it.
 */

import { capturePose, applyPose } from '../story/save.js';

export const KEY = 'islandsim.checkpoint.v1';
export const VERSION = 1;
/** Seconds of a running mission between checkpoints. */
export const EVERY_S = 5;
/** A checkpoint older than this is not offered (two hours). */
export const MAX_AGE_MS = 2 * 60 * 60 * 1000;
/** The modes a checkpoint is kept for. */
export const MODES = Object.freeze(['mission', 'tutorial']);

/** Should the browser ask before leaving? A flight on (flying or paused), not the menus or a debrief. */
export function guardUnload(state) {
  return state === 'flying' || state === 'paused';
}

/**
 * A new service worker has just taken control of the page: reload it 'now',
 * 'later' (when the flight is over and the player is back on the menu), or
 * not at all ('none').
 *
 * First visit — no worker controlled the page when it loaded: the page is
 * already running exactly the files the worker has just cached, so there is
 * nothing to reload into. It used to reload anyway, whenever the precache
 * finished: a moment on a fast line, minutes on school wifi — mid-flight —
 * and with the guard above armed that was a "Leave site?" box out of nowhere
 * in front of a new player (the Tomm1z checker's first-visit replay).
 * An update (an older worker controlled the page) during a flight waits for
 * the menu; on the menu it reloads at once, as it always did.
 */
export function swTakeover(hadController, state) {
  if (!hadController) return 'none';
  return guardUnload(state) ? 'later' : 'now';
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

/** Is this sim in something worth a checkpoint right now? The reason it is not, as a word, or null. */
export function whyNot(sim) {
  if (!sim) return 'no sim';
  if (sim.state !== 'flying') return 'not flying';
  if (!MODES.includes(sim.mode)) return 'not a mission';
  const r = sim.runner;
  if (!r || r.status !== 'running' || !r.def || !r.def.id) return 'no mission running';
  if (r.def.game === 'story') return 'the story has its own save';
  if (sim.mode === 'drive' || sim.vehicle) return 'driving';
  const ac = sim.aircraft;
  if (!ac || ac.crashed) return 'crashed';
  if (sim.walking && sim.walking.active) return 'on foot';
  if (sim.bracing) return 'mayday';
  return null;
}

/** The checkpoint for the sim as it is now, or null (see whyNot). */
export function captureCheckpoint(sim, now = Date.now()) {
  if (whyNot(sim)) return null;
  const r = sim.runner;
  const pose = capturePose(sim);
  if (!pose) return null;
  return {
    v: VERSION,
    mode: sim.mode,
    opts: plain(sim.modeOpts || {}),
    missionId: r.def.id,
    name: r.def.name || r.def.id,
    stepIndex: r.stepIndex,
    steps: Array.isArray(r.def.steps) ? r.def.steps.length : 0,
    stepId: r.step && r.step.id ? r.step.id : null,
    elapsed: Math.round((r.elapsed || 0) * 10) / 10,
    pose,
    savedAt: now,
  };
}

/** Options as plain data (a mission's opts may carry functions or objects a save cannot hold). */
function plain(o) {
  try {
    return JSON.parse(JSON.stringify(o));
  } catch (e) {
    return {};
  }
}

export function saveCheckpoint(cp, storage = safeStorage()) {
  if (!cp || !storage) return false;
  try {
    storage.setItem(KEY, JSON.stringify(cp));
    return true;
  } catch (e) {
    return false;
  }
}

export function loadCheckpoint(storage = safeStorage()) {
  if (!storage) return null;
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return null;
    const cp = JSON.parse(raw);
    if (!cp || cp.v !== VERSION || !cp.missionId || !MODES.includes(cp.mode)) return null;
    if (!Number.isInteger(cp.stepIndex) || cp.stepIndex < 0) return null;
    return cp;
  } catch (e) {
    return null;
  }
}

export function clearCheckpoint(storage = safeStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch (e) {
    /* nothing to clear */
  }
}

export function isFresh(cp, now = Date.now()) {
  return !!cp && Number.isFinite(cp.savedAt) && now - cp.savedAt >= 0 && now - cp.savedAt < MAX_AGE_MS;
}

/**
 * What Resume would do: { mode, opts, stepIndex, pose, name } — or null when
 * the mission no longer exists or the step index is past its end (then the
 * mission's start is the honest answer, and the card is not offered).
 */
export function resumePlan(cp, findMission, now = Date.now()) {
  if (!cp || !isFresh(cp, now)) return null;
  const def = cp.mode === 'mission' ? findMission(cp.missionId) : { id: cp.missionId, steps: new Array(cp.steps || 0) };
  if (!def) return null;
  const n = Array.isArray(def.steps) ? def.steps.length : 0;
  if (cp.stepIndex >= n) return null;
  return { mode: cp.mode, opts: cp.opts || {}, stepIndex: cp.stepIndex, pose: cp.pose || null, name: cp.name || cp.missionId, steps: n };
}

/** "step 3 of 6 · 2 min ago" for the card. */
export function describe(plan, cp, now = Date.now()) {
  if (!plan) return '';
  const ago = cp && Number.isFinite(cp.savedAt) ? Math.max(0, now - cp.savedAt) : 0;
  const mins = Math.round(ago / 60000);
  const when = mins < 1 ? 'a moment ago' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  return `step ${plan.stepIndex + 1} of ${plan.steps} · ${when}`;
}

export { applyPose };

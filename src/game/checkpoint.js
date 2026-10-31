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
 * the resumed run's. Story has its own autosave (story/director.js), so it
 * is not written here.
 *
 * FREE FLIGHT too (owner, 2026-10-30: "if u refresh it should remember ur
 * plane and map or wtv before u refreshed"): every EVERY_S seconds of a
 * free flight — on any map, the World Map included — the map, the aeroplane
 * and its paint, the setup as the Free Flight screen made it (time of day,
 * weather, wind, fuel, failures), the live sky, and the pose: where you are,
 * which way, how fast, how high, the engine, the gear and the flaps. The
 * menu then offers "Continue your flight?" / "Start fresh": Continue puts
 * you back in the air if you were in the air, on the ground if you were on
 * it. Nothing is written while crashed, on foot, in a mayday, riding along
 * in someone else's lobby, or on the menu; a checkpoint goes stale after
 * MAX_AGE_MS like a mission's.
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
export const MODES = Object.freeze(['mission', 'tutorial', 'free']);

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
  if (!MODES.includes(sim.mode)) return 'not a mission or a free flight';
  if (sim.mode === 'drive' || sim.vehicle) return 'driving';
  const free = sim.mode === 'free';
  const r = sim.runner;
  if (!free) {
    if (!r || r.status !== 'running' || !r.def || !r.def.id) return 'no mission running';
    if (r.def.game === 'story') return 'the story has its own save';
    // A mission whose whole point is a clock (Last Flight Out's warhead and
    // breach, game/extra/scp-escape.js): a resume at "the start of the step"
    // would be a run with no clock to beat. It says so, and starts over.
    if (r.def.checkpoint === false) return 'this mission restarts from the top';
  }
  const ac = sim.aircraft;
  if (!ac || ac.crashed) return 'crashed';
  if (sim.walking && sim.walking.active) return 'on foot';
  if (sim.bracing) return 'mayday';
  // Free Flight only: not someone else's aeroplane (a multiplayer ride-along),
  // and not with a mission's runner going (a role or an event started from
  // Free Flight is its own thing; the runner's checkpoint rules are above).
  if (free && sim.riding) return 'riding along';
  if (free && r && r.status === 'running' && r.def && r.def.id) return 'a mission is running';
  return null;
}

/** The checkpoint for the sim as it is now, or null (see whyNot). */
export function captureCheckpoint(sim, now = Date.now()) {
  if (whyNot(sim)) return null;
  const pose = capturePose(sim);
  if (!pose) return null;
  if (sim.mode === 'free') {
    const ac = sim.aircraft;
    const type = sim.aircraftType || null;
    const map = (sim.settings && sim.settings.map) || pose.map || null;
    if (!map || !pose.aircraft) return null;
    const liveries = (sim.settings && sim.settings.liveries) || {};
    let weather = null;
    try {
      weather = sim.weather && typeof sim.weather.serialize === 'function' ? plain(sim.weather.serialize()) : null;
    } catch (e) {
      weather = null;
    }
    return {
      v: VERSION,
      mode: 'free',
      opts: plain(sim.modeOpts || {}),
      map,
      name: (type && type.name) || pose.aircraft,
      pose,
      engineOn: ac.engineOn !== false,
      paint: liveries[pose.aircraft] || null,
      weather,
      savedAt: now,
    };
  }
  const r = sim.runner;
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
    if (!cp || cp.v !== VERSION || !MODES.includes(cp.mode)) return null;
    if (cp.mode === 'free') {
      // A free flight needs somewhere and something to put back.
      if (!cp.map || !cp.pose || !Array.isArray(cp.pose.pos) || cp.pose.pos.length !== 3 || !cp.pose.aircraft) return null;
      return cp;
    }
    if (!cp.missionId) return null;
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
 *
 * A free flight's plan: { mode: 'free', free: true, opts, map, aircraft,
 * pose, engineOn, paint, weather, name } — or null when `have.aircraft(id)`
 * or `have.map(id)` (optional checks the caller passes in) says the aeroplane
 * or the island is no longer in this copy of the game.
 */
export function resumePlan(cp, findMission, now = Date.now(), have = {}) {
  if (!cp || !isFresh(cp, now)) return null;
  if (cp.mode === 'free') {
    const aircraft = cp.pose && cp.pose.aircraft;
    if (!aircraft || !cp.map) return null;
    if (typeof have.aircraft === 'function' && !have.aircraft(aircraft)) return null;
    if (typeof have.map === 'function' && !have.map(cp.map)) return null;
    return {
      mode: 'free',
      free: true,
      opts: cp.opts || {},
      map: cp.map,
      aircraft,
      pose: cp.pose,
      engineOn: cp.engineOn !== false,
      paint: cp.paint || null,
      weather: cp.weather || null,
      name: cp.name || aircraft,
      stepIndex: 0,
      steps: 0,
    };
  }
  const def = cp.mode === 'mission' ? findMission(cp.missionId) : { id: cp.missionId, steps: new Array(cp.steps || 0) };
  if (!def) return null;
  const n = Array.isArray(def.steps) ? def.steps.length : 0;
  if (cp.stepIndex >= n) return null;
  return { mode: cp.mode, opts: cp.opts || {}, stepIndex: cp.stepIndex, pose: cp.pose || null, name: cp.name || cp.missionId, steps: n };
}

/**
 * "step 3 of 6 · 2 min ago" for the card; for a free flight "in the air at
 * 2,300 ft over Kestrel Island · 2 min ago" or "on the ground at Kestrel
 * Island · a moment ago". `mapName(id)` turns the map id into its name.
 */
export function describe(plan, cp, now = Date.now(), mapName = (id) => id) {
  if (!plan) return '';
  const ago = cp && Number.isFinite(cp.savedAt) ? Math.max(0, now - cp.savedAt) : 0;
  const mins = Math.round(ago / 60000);
  const when = mins < 1 ? 'a moment ago' : mins === 1 ? '1 min ago' : mins < 60 ? `${mins} min ago` : `${Math.round(mins / 60)} h ago`;
  if (plan.free) {
    const where = mapName(plan.map) || plan.map;
    const p = plan.pose || {};
    if (p.onGround) return `on the ground at ${where} · ${when}`;
    const ft = Math.max(0, Math.round(((p.pos && p.pos[1]) || 0) * 3.28084 / 100) * 100);
    return `in the air at ${ft.toLocaleString()} ft over ${where} · ${when}`;
  }
  return `step ${plan.stepIndex + 1} of ${plan.steps} · ${when}`;
}

/** The card's words for this plan: a mission's or a free flight's. Touch-sized buttons either way (menus.js). */
export function cardWords(plan) {
  if (plan && plan.free) return { ask: 'Continue your flight?', go: 'Continue your flight', fresh: 'Start fresh' };
  return { ask: 'Resume your mission?', go: 'Resume', fresh: 'Start over' };
}

export { applyPose };

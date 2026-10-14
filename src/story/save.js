/**
 * SIGNAL ZERO — save and continue ("leave whenever").
 *
 * One key in localStorage, `islandsim.story.v1`, a sibling of
 * game/progression.js's — the same load()/save() shape, wrapped in try/catch,
 * so a private window or a locked-down school profile never stops the story
 * from playing: it just cannot remember it, and says so.
 *
 * What is in it (story-bible.md §8):
 *
 *   {
 *     v: 1, slot: 0, difficulty: 'pilot',
 *     chapter: 'ch01-the-glint', beat: 'story-ch01-chase', step: 2,   // string ids, never indexes
 *     checkpoint: 'alongside',  elapsed: 61.2,                          // the beat's clock at the save
 *     pose: { game, map, aircraft, pos, quat, vel, throttle, gear, flaps, fuel, onGround } | null,
 *     beatState: {…},            // small plain data from beat.save()
 *     flags: { files: [], secrets: [], seat_ch5: null, skipCinematics: false, knowsFlying: false, firstSeen: ms },
 *     chapters: { 'ch01-the-glint': { done, medal, score, bestTime, style: [] } },
 *     playTime: 0, savedAt: 0
 *   }
 *
 * Everything is referenced by string id, so a chapter re-authored later can
 * still find where you were — and when it cannot (a beat that no longer
 * exists), resumePlan() falls back to the chapter's start rather than losing
 * the chapter.
 *
 * Pure on purpose: nothing here imports the game. The pose helpers take the
 * aircraft they are given, so tests/features/story.mjs can run every function
 * in node with a stand-in.
 */

export const KEY = 'islandsim.story.v1';
export const VERSION = 1;
export const DIFFICULTIES = ['story', 'pilot', 'ace'];

export function blank() {
  return {
    v: VERSION,
    slot: 0,
    difficulty: 'pilot',
    chapter: null,
    beat: null,
    step: 0,
    checkpoint: null,
    elapsed: 0,
    pose: null,
    beatState: null,
    flags: { files: [], secrets: [], seat_ch5: null, skipCinematics: false, knowsFlying: false, firstSeen: 0 },
    chapters: {},
    playTime: 0,
    savedAt: 0,
  };
}

function safeStorage() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const strList = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const vec = (v, n) => (Array.isArray(v) && v.length === n && v.every((x) => Number.isFinite(x)) ? v.map(Number) : null);

/**
 * Whatever was saved, into the current shape. Never throws: every field is
 * read generously and anything unreadable falls back to the blank.
 */
export function migrate(raw) {
  const b = blank();
  if (!isObj(raw)) return b;
  const out = { ...b };
  // v0 (a save from before this file had a version) and v1 share the shape.
  out.v = VERSION;
  out.slot = Number.isInteger(raw.slot) ? raw.slot : 0;
  out.difficulty = DIFFICULTIES.includes(raw.difficulty) ? raw.difficulty : 'pilot';
  out.chapter = typeof raw.chapter === 'string' ? raw.chapter : null;
  out.beat = typeof raw.beat === 'string' ? raw.beat : null;
  out.step = Number.isInteger(raw.step) && raw.step >= 0 ? raw.step : 0;
  out.checkpoint = typeof raw.checkpoint === 'string' ? raw.checkpoint : null;
  out.elapsed = Math.max(0, num(raw.elapsed));
  out.pose = sanitisePose(raw.pose);
  out.beatState = isObj(raw.beatState) ? { ...raw.beatState } : null;
  const f = isObj(raw.flags) ? raw.flags : {};
  out.flags = {
    files: strList(f.files),
    secrets: strList(f.secrets),
    seat_ch5: f.seat_ch5 === 'heli' || f.seat_ch5 === 'car' ? f.seat_ch5 : null,
    skipCinematics: f.skipCinematics === true,
    knowsFlying: f.knowsFlying === true,
    firstSeen: Math.max(0, num(f.firstSeen)),
  };
  out.chapters = {};
  if (isObj(raw.chapters)) {
    for (const id in raw.chapters) {
      const c = raw.chapters[id];
      if (!isObj(c)) continue;
      out.chapters[id] = {
        done: c.done === true,
        medal: ['bronze', 'silver', 'gold'].includes(c.medal) ? c.medal : null,
        score: Math.max(0, Math.min(100, Math.round(num(c.score)))),
        bestTime: Number.isFinite(c.bestTime) && c.bestTime > 0 ? c.bestTime : null,
        style: strList(c.style),
      };
    }
  }
  out.playTime = Math.max(0, num(raw.playTime));
  out.savedAt = Math.max(0, num(raw.savedAt));
  return out;
}

export function sanitisePose(p) {
  if (!isObj(p)) return null;
  const pos = vec(p.pos, 3);
  if (!pos) return null;
  return {
    game: typeof p.game === 'string' ? p.game : 'flight',
    map: typeof p.map === 'string' ? p.map : null,
    aircraft: typeof p.aircraft === 'string' ? p.aircraft : null,
    pos,
    quat: vec(p.quat, 4) || [0, 0, 0, 1],
    vel: vec(p.vel, 3) || [0, 0, 0],
    headingDeg: num(p.headingDeg),
    throttle: Math.max(0, Math.min(1, num(p.throttle))),
    gear: p.gear !== false,
    flaps: Math.max(0, Math.min(3, Math.round(num(p.flaps)))),
    fuel: Math.max(0.05, Math.min(1, num(p.fuel, 1))),
    onGround: p.onGround === true,
  };
}

/** Read the save. `storage` is injectable for the tests. */
export function load(storage = safeStorage()) {
  if (!storage) return blank();
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return blank();
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn('[story] could not read the story save — starting fresh.', e);
    return blank();
  }
}

/** Write it. False when the browser would not keep it (the story still plays). */
export function save(data, storage = safeStorage()) {
  if (!storage) return false;
  try {
    data.savedAt = Date.now();
    storage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch (e) {
    console.warn('[story] could not save story progress (storage may be full or blocked).', e);
    return false;
  }
}

export function clear(storage = safeStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(KEY);
  } catch (e) {
    /* nothing to clear */
  }
}

/** Does a save point at somewhere to continue from? */
export function hasProgress(data) {
  return !!(data && data.chapter);
}

/* ---------------------------------------------------------------------- */
/* Pose: where you were, exactly.                                          */
/* ---------------------------------------------------------------------- */

/**
 * Capture the aircraft's pose. `sim` is read for the map, the type and the
 * input's throttle; `ac` is the flight model (pos, quat, vel, …).
 */
export function capturePose(sim, ac = sim && sim.aircraft) {
  if (!ac || !ac.pos) return null;
  const type = sim && sim.aircraftType;
  return {
    game: sim && sim.mode === 'drive' ? (sim.vehicle && sim.vehicle.isBoat ? 'boat' : 'car') : 'flight',
    map: (sim && sim.settings && sim.settings.map) || null,
    aircraft: (type && type.id) || null,
    pos: [ac.pos.x, ac.pos.y, ac.pos.z],
    quat: ac.quat ? [ac.quat.x, ac.quat.y, ac.quat.z, ac.quat.w] : [0, 0, 0, 1],
    vel: ac.vel ? [ac.vel.x, ac.vel.y, ac.vel.z] : [0, 0, 0],
    headingDeg: num(ac.heading),
    throttle: num(ac.controls && ac.controls.throttle),
    gear: ac.gearDown !== false,
    flaps: typeof ac.flapStep === 'function' ? ac.flapStep() : 0,
    fuel: ac.fuel != null && Number.isFinite(ac.fuelFraction) ? ac.fuelFraction : fuelFraction(ac),
    onGround: !!ac.onGround,
  };
}

function fuelFraction(ac) {
  try {
    const r = ac.readouts && ac.readouts();
    if (r && Number.isFinite(r.fuelPct)) return Math.max(0.05, Math.min(1, r.fuelPct));
  } catch (e) {
    /* fall through */
  }
  return 1;
}

/**
 * Put the aircraft back exactly where the pose says. Goes through the flight
 * model's own reset() (so the gear, the engine and the derived readouts are
 * consistent) and then writes the exact attitude and velocity over the top,
 * because reset() only knows a heading and a speed.
 */
export function applyPose(sim, pose, ac = sim && sim.aircraft) {
  if (!ac || !pose) return false;
  const p = pose.pos;
  const speed = Math.hypot(pose.vel[0], pose.vel[1], pose.vel[2]);
  const V3 = ac.pos.constructor;
  const posV = new V3(p[0], p[1], p[2]);
  const ground = typeof sim.groundAt === 'function' ? sim.groundAt(p[0], p[2]) : null;
  ac.reset({
    pos: posV,
    headingDeg: pose.headingDeg,
    speed,
    // Airborne: the saved height as a height above the ground under it; on
    // the ground: let reset() stand it on its wheels.
    altAGL: pose.onGround ? null : Math.max(3, ground != null ? p[1] - ground : 10),
    engineOn: true,
    gearDown: pose.gear,
    fuel: pose.fuel,
  });
  if (!pose.onGround) {
    ac.pos.set(p[0], p[1], p[2]);
    if (ac.quat && pose.quat) ac.quat.set(pose.quat[0], pose.quat[1], pose.quat[2], pose.quat[3]);
    if (ac.vel && pose.vel) ac.vel.set(pose.vel[0], pose.vel[1], pose.vel[2]);
    ac.onGround = false;
  }
  if (typeof ac.setFlaps === 'function' && pose.flaps) ac.setFlaps(pose.flaps);
  if (ac.controls) ac.controls.throttle = pose.throttle;
  if (sim && sim.input) sim.input.throttleTarget = pose.throttle;
  return true;
}

/* ---------------------------------------------------------------------- */
/* Where to continue from.                                                 */
/* ---------------------------------------------------------------------- */

/**
 * The plan for Continue, from a save and the chapter list.
 *
 *   { kind: 'fresh' }                                  nothing saved: start chapter 1
 *   { kind: 'resume', chapter, beat, step, exact }     back into a beat (exact: at the saved step and pose;
 *                                                      otherwise the beat's start, because the save named a
 *                                                      step the beat no longer has)
 *   { kind: 'start', chapter }                         the chapter's own start (its first beat)
 *   { kind: 'tbc', last }                              the pointer is at a chapter that has not shipped yet
 *
 * `chapters` is the ordered list of chapter defs: { id, available, beats? }.
 */
export function resumePlan(data, chapters) {
  if (!data || !data.chapter) return { kind: 'fresh' };
  const i = chapters.findIndex((c) => c.id === data.chapter);
  if (i < 0) {
    // A chapter id this build does not know: the last finished one tells us where we are.
    const last = lastDone(data, chapters);
    return last ? { kind: 'tbc', last } : { kind: 'fresh' };
  }
  const ch = chapters[i];
  if (!ch.available) return { kind: 'tbc', last: lastDone(data, chapters) || (i > 0 ? chapters[i - 1].id : null) };
  // The chapter list keeps a shipped chapter's beats on its module.
  const beats = ch.beats || (ch.module && ch.module.beats) || [];
  if (!data.beat) return { kind: 'start', chapter: ch.id };
  const bi = beats.findIndex((b) => b.id === data.beat);
  if (bi < 0) return { kind: 'start', chapter: ch.id };
  const steps = (beats[bi].steps || []).length;
  const exact = data.pose != null && data.step < steps;
  return { kind: 'resume', chapter: ch.id, beat: data.beat, beatIndex: bi, step: exact ? data.step : 0, exact };
}

/** The id of the furthest finished chapter, in the list's order, or null. */
export function lastDone(data, chapters) {
  let out = null;
  for (const c of chapters) if (data.chapters[c.id] && data.chapters[c.id].done) out = c.id;
  return out;
}

/** The next chapter after `id` in the list, or null at the end. */
export function nextChapter(id, chapters) {
  const i = chapters.findIndex((c) => c.id === id);
  return i >= 0 && i + 1 < chapters.length ? chapters[i + 1] : null;
}

/**
 * Record a finished chapter: best medal, best score, best time and every
 * style badge ever earned. Medals only ever go up, so a replay cannot lose one.
 */
export function recordChapter(data, id, { medal = null, score = 0, time = 0, style = [] } = {}) {
  const prev = data.chapters[id] || { done: false, medal: null, score: 0, bestTime: null, style: [] };
  const rank = (m) => ['bronze', 'silver', 'gold'].indexOf(m);
  data.chapters[id] = {
    done: true,
    medal: rank(medal) > rank(prev.medal) ? medal : prev.medal,
    score: Math.max(prev.score || 0, Math.round(score || 0)),
    bestTime: prev.bestTime === null || (time > 0 && time < prev.bestTime) ? (time > 0 ? time : prev.bestTime) : prev.bestTime,
    style: [...new Set([...(prev.style || []), ...(style || [])])],
  };
  return data.chapters[id];
}

/** "saved 2 min ago", for the Continue line. */
export function agoLabel(savedAt, now = Date.now()) {
  if (!savedAt) return '';
  const s = Math.max(0, Math.round((now - savedAt) / 1000));
  if (s < 60) return 'saved just now';
  const m = Math.round(s / 60);
  if (m < 60) return `saved ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `saved ${h} h ago`;
  return `saved ${Math.round(h / 24)} days ago`;
}

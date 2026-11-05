/**
 * THE FUN KIT — what every mission in every game gets for free.
 *
 * The owner's words (finish/missions-fun.md): a clear goal in three seconds,
 * no dead minutes, a TWIST in the middle, fair fails with an instant retry,
 * spectacle, and a satisfying finish with BRONZE / SILVER / GOLD medals. The
 * mission files say WHAT happens; this file is the HOW, written once:
 *
 *   MEDALS       medalFor(def, score) from the saved bestScore — no new save
 *                data, so every old save shows its medals at once.
 *   BEATS        def.beats: [{ id, step?, at?, when?, run, say?, sting?,
 *                shake?, debrief? }] — the twist engine. Each fires once; an
 *                `at` window picks one time per run (seeded, so replays differ
 *                and stay fair). Fired beats are recorded in ctx.data._beats
 *                and their lines appear under "What happened" on the debrief.
 *   FINALE       on completion the debrief waits 2.5 s: camera to orbit, HUD
 *                off, thin letterbox bars, the mission's own last line. Any
 *                key or tap skips it; reduced motion is a 1 s still hold. It
 *                only plays when it is safe (stopped, or well above the
 *                ground) and def.finale = false turns it off.
 *   CHECKPOINTS  a step with `checkpoint: 'Patient aboard'` is remembered on
 *                entry (where you were, how much fuel, the clock, and the
 *                step's own snap()). The FAIL debrief then offers "Try again
 *                from: Patient aboard", which resumes at that step with that
 *                fuel and that elapsed time, so scores stay honest.
 *   RETRY        the debrief's primary button has focus (Enter / Space) and
 *                the `retry` key (R) presses it, declared in the one registry.
 *
 * Every helper here is a thin wrapper over something that already exists —
 * weather.gustFront, aircraft.failures, CameraRig.kick, music.nudge,
 * explosions.explode, NpcFlyer — so there is no second engine to keep in step.
 * Nothing in tickBeats allocates per frame.
 */

import * as THREE from '../vendor/three.module.js';
import { registerExtension, extLayer } from './extensions.js';
import { isKey } from '../flight/input.js';
import { heightAt } from '../world/terrain.js';
import { SPEC } from '../aircraft/physics.js';
import { MissionRunner } from './runner.js';

/* ------------------------------------------------------------------ *
 * Medals
 * ------------------------------------------------------------------ */

export const MEDAL_COLOURS = { bronze: '#b07a45', silver: '#c4ccd6', gold: '#e2b33c' };
const MEDAL_WORDS = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold' };
const DEFAULT_GOLD_HINT = 'Faster, smoother, closer: 88 or more';

/** The thresholds a mission grades by, and one line on what Gold takes. */
export function medalInfo(def) {
  const m = (def && def.medals) || {};
  const silver = Number.isFinite(m.silver) ? m.silver : 70;
  const gold = Number.isFinite(m.gold) ? m.gold : 90; // the same 90 as the Gold Medal achievement
  return { silver, gold, goldHint: m.goldHint || DEFAULT_GOLD_HINT };
}

/**
 * 'gold' | 'silver' | 'bronze' | null. Bronze means completed at all; a run
 * that failed or crashed (status other than complete) earns nothing.
 */
export function medalFor(def, score, status = 'complete') {
  if (status && status !== 'complete') return null;
  if (!Number.isFinite(score)) return null;
  const { silver, gold } = medalInfo(def);
  return score >= gold ? 'gold' : score >= silver ? 'silver' : 'bronze';
}

/** The medal above `id`, or null from gold. */
export function nextMedal(id) {
  return id === 'bronze' ? 'silver' : id === 'silver' ? 'gold' : null;
}

/** A small metallic disc with the word beside it. Inline SVG, no emoji. */
export function medalHtml(id, size = 18, word = true) {
  const c = MEDAL_COLOURS[id];
  if (!c) return '';
  const svg =
    `<svg class="medal-disc" width="${size}" height="${size}" viewBox="0 0 20 20" aria-hidden="true">` +
    `<defs><radialGradient id="mg-${id}" cx="35%" cy="30%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity="0.75"/>` +
    `<stop offset="0.35" stop-color="${c}"/><stop offset="1" stop-color="#000" stop-opacity="0.45"/></radialGradient></defs>` +
    `<circle cx="10" cy="10" r="9" fill="${c}"/><circle cx="10" cy="10" r="9" fill="url(#mg-${id})"/>` +
    `<circle cx="10" cy="10" r="6.2" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="1"/></svg>`;
  return `<span class="medal medal-${id}" data-medal="${id}" style="--medal:${c}">${svg}${word ? `<span class="medal-word">${MEDAL_WORDS[id]}</span>` : ''}</span>`;
}

/** The card's line: the disc, the best, and what the next medal takes. */
export function medalLineHtml(def, rec) {
  if (!rec || !rec.complete) return 'Not flown yet';
  const best = Number(rec.bestScore) || 0;
  const id = medalFor(def, best) || 'bronze';
  const { silver, gold } = medalInfo(def);
  const next = id === 'gold' ? '' : id === 'silver' ? ` · Gold at ${gold}` : ` · Silver at ${silver}`;
  return `${medalHtml(id, 16)} <span class="medal-best">best ${best}</span>${next}`;
}

/* ------------------------------------------------------------------ *
 * Small shared state. One mission at a time, so module-level is honest.
 * ------------------------------------------------------------------ */

let SIM = null;
let CHECKPOINT = null; // { missionId, stepIndex, elapsed, label, spawn, snap }
let PREV_BEST = null; // the saved best before the run that just ended
let FINALE = null; // { t, secs, done, view, still }
let BARS = null;
let LAST_LINE_AT = -Infinity;
let RESUMED = null; // the checkpoint the running mission resumed from
const OWNED = []; // things a mission made that must go when it ends

function reducedMotion(sim) {
  return !!(sim && sim.settings && sim.settings.reducedMotion);
}

function soundOn(sim) {
  return !!(sim && sim.audio && sim.audio.available && sim.settings && !sim.settings.muted);
}

/* mulberry32: a time picked once per run, from the start time, so replays
 * differ but the same run is the same run. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Beats
 * ------------------------------------------------------------------ */

function stepMatches(runner, want) {
  const step = runner.step;
  if (!step) return false;
  if (typeof want === 'number') return runner.stepIndex === want;
  return step.id === want;
}

function initBeats(def, runner) {
  const rnd = rng(Date.now() ^ (runner.elapsed * 1000) ^ 0x5eed);
  const list = [];
  for (let i = 0; i < def.beats.length; i++) {
    const beat = def.beats[i];
    if (!beat) continue;
    let at = null;
    if (Array.isArray(beat.at)) {
      const lo = Number(beat.at[0]) || 0;
      const hi = Number.isFinite(beat.at[1]) ? beat.at[1] : lo;
      at = lo + rnd() * Math.max(0, hi - lo);
    } else if (Number.isFinite(beat.at)) at = beat.at;
    list.push({ beat, at, fired: false, id: beat.id || `beat${i}` });
  }
  return { beats: list, eases: [], seed: 0 };
}

function fireBeat(b, ctx) {
  b.fired = true;
  const beat = b.beat;
  const sim = ctx.sim;
  try {
    if (typeof beat.run === 'function') beat.run(ctx);
    if (beat.say) say(ctx, beat.say.text, beat.say.voice || 'approach', beat.say.urgency == null ? 1 : beat.say.urgency);
    if (beat.sting) sting(ctx, beat.sting);
    if (beat.shake) shake(ctx, beat.shake);
  } catch (e) {
    console.error(`[fun-kit] beat "${b.id}" threw:`, e);
  }
  const rec = ctx.data._beats || (ctx.data._beats = []);
  rec.push({ id: b.id, at: ctx.runner ? ctx.runner.elapsed : ctx.elapsed, line: beat.debrief || null });
  if (sim && sim.hud && beat.line) line(ctx, beat.line);
}

/**
 * The runner calls this right after def.tick, every frame. Each beat fires
 * once; eases (moveTarget) run here too. No allocation on the steady path.
 */
export function tickBeats(runner, ctx, dt) {
  const def = runner.def;
  if (!def) return;
  let st = ctx.data._fun;
  if (!st) {
    if (!def.beats || !def.beats.length) return;
    st = ctx.data._fun = initBeats(def, runner);
  }
  const beats = st.beats;
  for (let i = 0; i < beats.length; i++) {
    const b = beats[i];
    if (b.fired) continue;
    const beat = b.beat;
    if (beat.step != null && !stepMatches(runner, beat.step)) continue;
    const t = beat.step != null ? runner.stepElapsed : runner.elapsed;
    if (b.at != null && t < b.at) continue;
    if (typeof beat.when === 'function' && !beat.when(ctx)) continue;
    fireBeat(b, ctx);
  }
  const eases = st.eases;
  for (let i = eases.length - 1; i >= 0; i--) {
    const e = eases[i];
    e.t += dt;
    const k = e.secs > 0 ? Math.min(1, e.t / e.secs) : 1;
    const s = k * k * (3 - 2 * k);
    e.vec.lerpVectors(e.from, e.to, s);
    if (k >= 1) eases.splice(i, 1);
  }
}

/** The beats that fired this run, oldest first: [{ id, at, line }]. */
export function firedBeats(ctx) {
  return (ctx && ctx.data && ctx.data._beats) || [];
}

/* ------------------------------------------------------------------ *
 * Helpers for a beat's run(ctx): thin wrappers over what exists.
 * ------------------------------------------------------------------ */

/** The wind jumps and swings for `secs`. weather.gustFront. */
export function gust(ctx, { mult = 2, turnDeg = 40, secs = 40 } = {}) {
  const w = ctx.weather || (ctx.sim && ctx.sim.weather);
  if (w && w.gustFront) w.gustFront({ speedMultiplier: mult, turnDeg, seconds: secs });
}

/** A microburst: sinking air and a headwind swing. weather.startShear. */
export function shear(ctx, { down = 8, headwind = 10, secs = 25 } = {}) {
  const w = ctx.weather || (ctx.sim && ctx.sim.weather);
  if (w && w.startShear) w.startShear({ down, headwind, seconds: secs });
}

/** The sky turns ('rainy', 'stormy', ...) for `secs`. weather.temporaryCondition. */
export function weatherTurn(ctx, id, secs = 90, overrides = null) {
  const w = ctx.weather || (ctx.sim && ctx.sim.weather);
  if (w && w.temporaryCondition) w.temporaryCondition(id, secs, overrides);
}

/** The engine runs rough on part power for `secs`, then clears. */
export function cough(ctx, secs = 12) {
  const ac = ctx.subject || ctx.ac;
  if (!ac || !ac.failures) return;
  ac.failures.roughEngine = true;
  const st = ctx.data._fun || (ctx.data._fun = initBeats({ beats: [] }, ctx.runner || { elapsed: 0 }));
  st.coughLeft = Math.max(st.coughLeft || 0, secs);
  own(ctx, { update(dt) { st.coughLeft -= dt; if (st.coughLeft <= 0 && ac.failures.roughEngine) { ac.failures.roughEngine = false; this.done = true; } }, dispose() { ac.failures.roughEngine = false; } });
}

/** A fuel leak from now on. */
export function leak(ctx) {
  const ac = ctx.subject || ctx.ac;
  if (ac && ac.failures) ac.failures.fuelLeak = true;
}

/**
 * Ease the Vector3 at ctx.data[key] to `to` over `secs`. The mission keeps
 * reading ctx.data[key] and the arrow, beacon and hover follow it.
 */
export function moveTarget(ctx, key, to, secs = 8) {
  const vec = ctx.data[key];
  if (!vec || !vec.isVector3) return;
  let st = ctx.data._fun;
  if (!st) st = ctx.data._fun = initBeats({ beats: [] }, ctx.runner || { elapsed: 0 });
  st.eases.push({ vec, from: vec.clone(), to: new THREE.Vector3(to.x, to.y, to.z), t: 0, secs });
}

/** One radio line, in the mission's own voice. */
export function say(ctx, text, voice = 'approach', urgency = 1) {
  const sim = ctx.sim;
  if (sim && typeof sim.speak === 'function' && text) sim.speak(text, voice, urgency);
}

/** A music gesture (music.nudge), only when sound AND music are on. */
export function sting(ctx, name) {
  const sim = ctx.sim;
  if (!soundOn(sim) || !sim.settings.music || !sim.audio.music || typeof sim.audio.music.nudge !== 'function') return;
  try {
    sim.audio.music.nudge(name);
  } catch (e) {
    /* a gesture that has not been written is silence, not a crash */
  }
}

/** A camera jolt (CameraRig.kick); the rig quarters it under reduced motion. */
export function shake(ctx, amt = 0.5) {
  const sim = ctx.sim;
  if (sim && sim.rig && typeof sim.rig.kick === 'function') sim.rig.kick(amt);
}

/** ONE pop-up, and never more than one every six seconds from here. */
export function line(ctx, text, kind = 'info', secs = 4) {
  const sim = ctx.sim;
  if (!sim || !sim.hud || !text) return false;
  const now = ctx.runner ? ctx.runner.elapsed : ctx.elapsed || 0;
  if (now - LAST_LINE_AT < 6 && now >= LAST_LINE_AT) return false;
  LAST_LINE_AT = now;
  sim.hud.notify(text, kind, secs);
  return true;
}

/** A small splash or burst in the world (features/explosions.js), loaded lazily. */
export function burst(ctx, pos, kind = 'splash', size = 0.6) {
  const sim = ctx.sim;
  if (!sim || !pos) return;
  import('../features/explosions.js')
    .then((m) => m.explode(sim, pos, { kind, size, silent: !soundOn(sim) }))
    .catch(() => {});
}

export function splash(ctx, pos, size = 0.6) {
  burst(ctx, pos, 'splash', size);
}

/**
 * An NPC aircraft the mission owns (roles/npc-flyer.js), disposed when the
 * mission ends. Resolves to the NpcFlyer; it is also ticked from here.
 */
export function npc(ctx, typeId, opts = {}) {
  const sim = ctx.sim;
  if (!sim || !sim.scene) return Promise.resolve(null);
  return import('./roles/npc-flyer.js')
    .then((m) => {
      const f = new m.NpcFlyer(sim.scene, typeId, { name: opts.name || typeId, livery: opts.livery || null });
      if (opts.pos) f.place({ pos: opts.pos, headingDeg: opts.headingDeg || 0, speed: opts.speed || 0, onGround: !!opts.onGround });
      own(ctx, {
        npc: f,
        update(dt) {
          f.update(dt, sim.weather);
        },
        dispose() {
          f.dispose();
        },
      });
      return f;
    })
    .catch((e) => {
      console.warn('[fun-kit] npc could not be made:', e);
      return null;
    });
}

/** Anything with dispose() (and an optional update(dt)) that must go when the mission ends. */
export function own(ctx, thing) {
  if (thing) {
    thing.__run = ctx && ctx.data;
    OWNED.push(thing);
  }
  return thing;
}

/** Everything a mission owns, except what `keep` (a run's data) made: onStart runs before the startMode hook. */
function clearOwned(keep = null) {
  for (let i = OWNED.length - 1; i >= 0; i--) {
    const o = OWNED[i];
    if (keep && o && o.__run === keep) continue;
    try {
      if (o && typeof o.dispose === 'function') o.dispose();
    } catch (e) {
      /* a prop that will not tidy up must not take the next flight with it */
    }
    OWNED.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ *
 * Checkpoints and resume
 * ------------------------------------------------------------------ */

/** The checkpoint a FAIL debrief may offer, or null. */
export function checkpoint() {
  return CHECKPOINT;
}

export function clearCheckpoint() {
  CHECKPOINT = null;
}

/** The checkpoint this run resumed from, if it did (for honest debriefs and tests). */
export function resumedFrom() {
  return RESUMED;
}

function spawnOf(subject) {
  const pos = subject.pos;
  const ground = heightAt(pos.x, pos.z);
  const onGround = !!subject.onGround;
  const speed = subject.vel ? subject.vel.length() : 0;
  return {
    // A Vector3, like a def's own spawn: main.js clones spawn.pos on the way in.
    pos: new THREE.Vector3(pos.x, pos.y, pos.z),
    headingDeg: Number.isFinite(subject.heading) ? subject.heading : 90,
    speed: onGround ? 0 : Math.round(speed * 10) / 10,
    altAGL: onGround ? null : Math.max(2, pos.y - ground),
    fuel: typeof subject.fuelFraction === 'function' ? subject.fuelFraction() : subject.fuel != null && SPEC.fuelCapacity ? subject.fuel / SPEC.fuelCapacity : 1,
    engineOn: subject.engineOn !== false,
  };
}

/**
 * The runner calls this when a step with `checkpoint` is entered. The
 * step's optional snap(ctx) returns plain JSON the mission needs back.
 */
export function noteCheckpoint(runner, ctx) {
  const step = runner.step;
  const def = runner.def;
  if (!step || !def || !step.checkpoint) return null;
  const subject = runner.subject();
  if (!subject || !subject.pos) return null;
  let snap = null;
  try {
    snap = typeof step.snap === 'function' ? step.snap(ctx) : null;
  } catch (e) {
    snap = null;
  }
  CHECKPOINT = {
    missionId: def.id,
    stepIndex: runner.stepIndex,
    elapsed: runner.elapsed,
    label: String(step.checkpoint),
    spawn: spawnOf(subject),
    snap,
    fuelLabel: null,
  };
  return CHECKPOINT;
}

/**
 * Put a freshly started mission at its checkpoint. The spawn has already
 * happened (main.js read cp.spawn); this restores the clock, the step and
 * the step's own data — WITHOUT running the onDone of the steps before it,
 * which already happened in the run that set the checkpoint.
 */
export function resume(sim, runner, cp) {
  if (!cp || !runner || !runner.def || runner.def.id !== cp.missionId || runner.status !== 'running') return false;
  const def = runner.def;
  const idx = Math.max(0, Math.min(def.steps.length - 1, cp.stepIndex | 0));
  const ctx = runner.ctx();
  // Leave the step the fresh start entered, quietly.
  runner.clearGates();
  const cur = runner.step;
  if (cur && cur.id !== def.steps[idx].id && typeof cur.leave === 'function') cur.leave(ctx);
  const step = def.steps[idx];
  try {
    if (typeof step.restore === 'function') step.restore(ctx, cp.snap);
  } catch (e) {
    console.error('[fun-kit] restore threw:', e);
  }
  runner.elapsed = cp.elapsed;
  if (!runner.resumeAt(idx)) return false;
  RESUMED = cp;
  if (sim.hud) sim.hud.notify(`Resumed from: ${cp.label}`, 'info', 4);
  return true;
}

/* ------------------------------------------------------------------ *
 * Finale
 * ------------------------------------------------------------------ */

function bars() {
  if (BARS) return BARS;
  const layer = extLayer();
  const mk = (where) => {
    const d = document.createElement('div');
    d.className = `fun-bar fun-bar-${where}`;
    Object.assign(d.style, {
      position: 'absolute', left: '0', right: '0', height: '0', background: '#000', [where]: '0',
      transition: 'height 0.6s ease', pointerEvents: 'none',
    });
    layer.appendChild(d);
    return d;
  };
  BARS = { top: mk('top'), bottom: mk('bottom') };
  return BARS;
}

function setBars(on, instant) {
  const b = bars();
  for (const k of ['top', 'bottom']) {
    b[k].style.transition = instant ? 'none' : 'height 0.6s ease';
    b[k].style.height = on ? '9vh' : '0';
  }
}

/** Is it safe to hold the picture for a moment: stopped, or well up in the air? */
function finaleSafe(sim, def) {
  const subject = sim.vehicle || sim.aircraft;
  if (!subject) return false;
  if (subject.crashed) return false;
  if (def && def.vehicle) return !!subject.vel && subject.vel.length() < 1.5;
  if (subject.onGround) {
    if (subject.groundSpeed < 2.5) return true;
    // A landing step counts three seconds on the runway, not a stop (game/landing-zone.js), so the
    // usual ending is still rolling: the finale takes it, with the power off and the brakes on.
    const td = sim.runner && sim.runner.data && sim.runner.data.lastTouchdown;
    return !SPEC.rotor && !!td && !!td.onRunway && !td.crashed && subject.groundSpeed < 45;
  }
  return subject.agl > 150;
}

function finaleWanted(sim, def) {
  if (!def || def.finale === false) return false;
  // Only the missions the fun pass went over: a mission with its own ending (Air Force One, the
  // ditching, the fires) keeps it.
  if (!def.finale && !def.medals) return false;
  // Aircraft missions by default; a boat or car mission asks for one.
  if (def.vehicle && !def.finale) return false;
  // Story chapters and the seats write their own endings.
  if (sim.mode === 'tutorial' || def.game === 'story' || def.roleId) return false;
  return finaleSafe(sim, def);
}

function startFinale(sim, def, done) {
  const f = typeof def.finale === 'object' && def.finale ? def.finale : {};
  const still = reducedMotion(sim);
  const secs = still ? 1 : Math.min(4, Math.max(1, Number(f.secs) || 2.5));
  const view = f.view || 'orbit';
  FINALE = { t: 0, secs, done, prevView: sim.rig ? sim.rig.mode : null, still, timer: 0, hands: null };
  // Rolling out: the crew stops it while the picture holds. The player's hands come back with the debrief.
  const ac = sim.aircraft;
  if (ac && ac.onGround && !sim.vehicle) {
    FINALE.hands = { was: sim.override || null };
    sim.override = { ...(sim.override || {}), throttle: 0, brakes: 1 };
  }
  if (sim.hud) sim.hud.setVisible(false);
  setBars(true, false);
  if (!still && sim.rig && typeof sim.rig.setMode === 'function' && ['orbit', 'tower', 'chase'].includes(view)) sim.rig.setMode(view);
  if (f.say) say({ sim }, f.say, f.voice || 'tower', 0);
  if (sim.audio && sim.audio.available && sim.settings && sim.settings.music && !sim.settings.muted) {
    try {
      sim.audio.music.nudge('win');
    } catch (e) {
      /* silence */
    }
  }
  // A hidden tab stops the frame loop, so real time ends it as well.
  FINALE.timer = setTimeout(() => endFinale(sim), secs * 1000 + 1500);
}

function handsBack(sim, f) {
  if (f.hands) sim.override = f.hands.was;
}

function endFinale(sim) {
  const f = FINALE;
  if (!f) return;
  FINALE = null;
  clearTimeout(f.timer);
  handsBack(sim, f);
  setBars(false, true);
  if (sim.rig && f.prevView && typeof sim.rig.setMode === 'function') sim.rig.setMode(f.prevView);
  try {
    f.done();
  } catch (e) {
    console.error('[fun-kit] finale handover threw:', e);
  }
}

/** For tests: is a finale playing right now? */
export function finalePlaying() {
  return !!FINALE;
}

/* ------------------------------------------------------------------ *
 * The debrief: medal strip, "What happened", Try again from…
 * ------------------------------------------------------------------ */

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
}

/** The strip at the top of a good debrief. Exported for the rocket and tests. */
export function medalStripHtml(def, score, { newBest = false, status = 'complete' } = {}) {
  const id = medalFor(def, score, status);
  if (!id) return '';
  const info = medalInfo(def);
  const next = nextMedal(id);
  const hint = next === 'gold' ? `Gold: ${esc(info.goldHint)}` : next === 'silver' ? `Silver at ${info.silver}` : 'Top marks';
  return (
    `<div class="medal-strip is-${id}" data-medal-strip="${id}">` +
    `${medalHtml(id, 34)}` +
    `<span class="medal-strip-words">${newBest ? '<b class="medal-new">New best</b>' : ''}<em class="medal-next">${hint}</em></span>` +
    `</div>`
  );
}

/** "What happened": the fired beats' lines, at most three. */
export function whatHappenedHtml(beats) {
  const lines = (beats || []).filter((b) => b && b.line).slice(-3);
  if (!lines.length) return '';
  return `<div class="debrief-happened" data-happened><h4>What happened</h4><ul>${lines.map((b) => `<li>${esc(b.line)}</li>`).join('')}</ul></div>`;
}

function decorateDebrief(sim, d) {
  const runner = sim.runner;
  const def = d.def || (runner && runner.def) || null;
  if (!def || !d || typeof d !== 'object' || def.game === 'story' || def.id === 'free') return d;
  const status = runner && runner.def === def ? runner.status : d.status || 'complete';
  const o = { ...d };
  if (d.kind === 'good' && status === 'complete' && (sim.mode === 'mission' || sim.mode === 'drive' || d.def)) {
    const score = Number.isFinite(d.score) ? d.score : runner && runner.data ? runner.data.score : NaN;
    const medal = d.medal || medalFor(def, score);
    const newBest = PREV_BEST != null ? score > PREV_BEST : false;
    const strip = medal ? medalStripHtml(def, score, { newBest }) : '';
    const happened = whatHappenedHtml(runner && runner.def === def ? firedBeats({ data: runner.data }) : []);
    o.body = `${strip}${d.body || ''}${happened}`;
    o.medal = medal;
  } else if (d.kind === 'bad' && status === 'failed' && CHECKPOINT && CHECKPOINT.missionId === def.id && sim.mode === 'mission') {
    const cp = CHECKPOINT;
    const first = (d.actions || []).find((a) => a.primary) || (d.actions || [])[0];
    const rest = (d.actions || []).filter((a) => a !== first);
    const resumeAct = {
      label: `Try again from: ${cp.label}`,
      primary: true,
      onClick: () => sim.startMode(sim.mode, { ...(sim.modeOpts || {}), resume: cp }),
    };
    const startOver = first ? { ...first, label: 'Start over', primary: false } : null;
    o.actions = [resumeAct, ...(startOver ? [startOver] : []), ...rest];
    const happened = whatHappenedHtml(runner && runner.def === def ? firedBeats({ data: runner.data }) : []);
    o.body = `${d.body || ''}${happened}`;
  }
  return o;
}

function focusPrimary(menus) {
  const s = menus && menus.screens && menus.screens.debrief;
  if (!s) return;
  const b = s.querySelector('[data-actions] button.primary') || s.querySelector('[data-actions] button');
  if (b) setTimeout(() => b.focus({ preventScroll: true }), 40);
}

function pressPrimary(menus) {
  const s = menus && menus.screens && menus.screens.debrief;
  if (!s || s.hidden) return false;
  const b = s.querySelector('[data-actions] button.primary') || s.querySelector('[data-actions] button');
  if (!b) return false;
  b.click();
  return true;
}

/* ------------------------------------------------------------------ *
 * Plugging in
 * ------------------------------------------------------------------ */

const CSS = `
.medal { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; }
.medal-disc { flex: none; filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45)); }
.medal-word { font-weight: 700; color: var(--medal); letter-spacing: 0.01em; }
.mission-best .medal-word { font-size: 12.5px; }
.mission-best .medal-best { color: var(--text); }
.medal-strip {
  display: flex; align-items: center; justify-content: center; gap: 12px;
  margin: -4px auto 12px; padding: 8px 14px; border-radius: 12px;
  background: rgba(255, 255, 255, 0.05); border: 1px solid rgba(255, 255, 255, 0.08);
  max-width: 420px; text-align: left;
}
.medal-strip .medal-word { font-size: 20px; }
.medal-strip-words { display: flex; flex-direction: column; gap: 1px; font-size: 13px; color: var(--text-dim); }
.medal-strip-words .medal-new { color: var(--good); font-size: 13px; }
.medal-strip-words .medal-next { font-style: normal; }
@media (prefers-reduced-motion: no-preference) {
  .medal-strip .medal-disc { animation: medal-shine 1.4s ease-out 1; }
  @keyframes medal-shine {
    0% { filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45)) brightness(0.9); }
    45% { filter: drop-shadow(0 0 10px var(--medal)) brightness(1.35); }
    100% { filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.45)) brightness(1); }
  }
}
.debrief-happened { margin: 12px auto 0; max-width: 460px; text-align: left; }
.debrief-happened h4 { margin: 0 0 4px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-dim); }
.debrief-happened ul { margin: 0; padding: 0 0 0 18px; }
.debrief-happened li { font-size: 13.5px; color: #d3dfef; line-height: 1.4; }
.fun-bar { z-index: 31; }
`;

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById('fun-kit-css')) return;
  const st = document.createElement('style');
  st.id = 'fun-kit-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

function install(sim) {
  SIM = sim;
  ensureCss();
  // The finale and the medal bookkeeping, round the game's own handler.
  if (typeof sim.onMissionComplete === 'function' && !sim.onMissionComplete.__funKit) {
    const orig = sim.onMissionComplete.bind(sim);
    const wrapped = (result) => {
      const def = sim.runner && sim.runner.def;
      const rec = result && sim.progress && sim.progress.missions ? sim.progress.missions[result.id] : null;
      PREV_BEST = rec && rec.complete ? Number(rec.bestScore) || 0 : null;
      CHECKPOINT = null;
      const finish = () => {
        clearOwned();
        orig(result);
      };
      if (sim.mode === 'mission' && finaleWanted(sim, def)) startFinale(sim, def, finish);
      else finish();
    };
    wrapped.__funKit = true;
    sim.onMissionComplete = wrapped;
  }
  if (typeof sim.onMissionFail === 'function' && !sim.onMissionFail.__funKit) {
    const orig = sim.onMissionFail.bind(sim);
    const wrapped = (f) => {
      clearOwned();
      orig(f);
    };
    wrapped.__funKit = true;
    sim.onMissionFail = wrapped;
  }
  const menus = sim.menus;
  if (menus && typeof menus.showDebrief === 'function' && !menus.showDebrief.__funKit) {
    const shown = menus.showDebrief;
    const wrapped = function (d) {
      let o = d;
      try {
        o = decorateDebrief(sim, d);
      } catch (e) {
        console.error('[fun-kit] debrief decoration threw:', e);
        o = d;
      }
      const out = shown.call(this, o);
      focusPrimary(menus);
      return out;
    };
    wrapped.__funKit = true;
    menus.showDebrief = wrapped;
  }
  // R on the debrief presses its primary button; any key or tap skips the finale.
  if (typeof document !== 'undefined' && !install.__keys) {
    install.__keys = true;
    document.addEventListener(
      'keydown',
      (ev) => {
        const t = ev.target;
        if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
        if (FINALE) {
          endFinale(sim);
          return;
        }
        if (sim.state === 'debrief' && menus && menus.current === 'debrief' && isKey(sim, 'retry', ev.code)) {
          if (pressPrimary(menus)) ev.preventDefault();
        }
      },
      true
    );
    document.addEventListener('pointerdown', () => {
      if (FINALE) endFinale(sim);
    }, true);
  }
}

// The runner's two doors (game/runner.js): this module loads with the features, after the menu.
MissionRunner.prototype.tickBeats = function (ctx, dt) {
  tickBeats(this, ctx, dt);
};
MissionRunner.prototype.noteStep = function (ctx) {
  noteCheckpoint(this, ctx);
};

registerExtension({
  id: 'fun-kit',
  actions: {
    // R: the same key as "hush the warnings" ON PURPOSE — that one only
    // listens while flying, this one only on the debrief, and the registry
    // treats a key two actions both declare as shared, not as a clash.
    retry: { label: 'Try again (on the debrief)', group: 'Game', ctx: ['plane', 'heli', 'boat', 'car'], default: ['KeyR'] },
  },
  install,
  startMode(sim, mode, opts) {
    SIM = sim;
    clearOwned(sim.runner && sim.runner.status === 'running' ? sim.runner.data : null);
    if (FINALE) {
      clearTimeout(FINALE.timer);
      handsBack(sim, FINALE);
      FINALE = null;
      setBars(false, true);
    }
    LAST_LINE_AT = -Infinity;
    RESUMED = null;
    const cp = opts && opts.resume;
    if (cp && sim.runner) {
      if (!resume(sim, sim.runner, cp)) CHECKPOINT = null;
    } else CHECKPOINT = null;
  },
  stop(sim, why) {
    clearOwned();
    if (FINALE) {
      const f = FINALE;
      FINALE = null;
      clearTimeout(f.timer);
      handsBack(sim, f);
      setBars(false, true);
      if (sim.rig && f.prevView) sim.rig.setMode(f.prevView);
    }
    if (why === 'menu') CHECKPOINT = null;
  },
  update(sim, dt) {
    for (let i = OWNED.length - 1; i >= 0; i--) {
      const o = OWNED[i];
      if (o && typeof o.update === 'function') {
        try {
          o.update(dt);
        } catch (e) {
          OWNED.splice(i, 1);
        }
        if (o.done) OWNED.splice(i, 1);
      }
    }
    if (FINALE) {
      FINALE.t += dt;
      if (FINALE.t >= FINALE.secs) endFinale(sim);
    }
  },
});

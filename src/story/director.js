/**
 * SIGNAL ZERO — the story director: the chapter runner.
 *
 * One object sequences a chapter's beats, each a mission def (beats.js),
 * through the game's own MissionRunner. It intercepts the runner's four
 * callbacks only while a story beat is running and hands everything else
 * straight back to main.js, so Free Flight, the tutorial and every other
 * mission behave exactly as before.
 *
 * What it owns (story-bible.md §8, §9, §11 A1-A2):
 *
 *   - starting a chapter (briefing → beat 1), continuing one (recap → READY →
 *     the saved beat, step and pose), and replaying one (temporary state);
 *   - AUTOSAVE at every checkpoint: the chapter start, every beat start,
 *     every step completion (the default — a step opts out with
 *     `checkpoint: false`), a rolling pose-only save every 30 s in beats
 *     marked `rolling: true`, and the chapter's end (the pointer moves to the
 *     next chapter). Never during a cutscene, never while failing, never
 *     while unsafe (stalled, or under 300 ft in the air);
 *   - fail → "Retry from checkpoint" (≤ 3 s), "Restart chapter", "Quit";
 *   - complete → the chapter's finale cutscene → the debrief (medal, score,
 *     style badges, Files) → the next chapter, or TO BE CONTINUED when the
 *     next one has not shipped;
 *   - the objective tracker (ui.js draws it from what the chapter reports).
 *
 * A chapter module (chNN-*.js) is data plus a few hooks; see ch01-the-glint.js
 * for the shape. It talks to the game only through the `api` handed to it.
 */

import { STATUS } from '../game/runner.js';
import { CHAPTERS, chapterById, chapterLabel } from './chapters.js';
import * as Save from './save.js';
import * as Cinema from './cinema.js';
import { registerBeats, resumeAt, isStoryDef } from './beats.js';
import { RECAPS, FILES } from './script.js';

export const ROLLING_SAVE_SECONDS = 30;
/** The authoring rule: a checkpoint at least this often (seconds of play). */
export const MAX_CHECKPOINT_GAP = 75;
const UNSAFE_AGL_M = 91; // 300 ft

export const D = {
  sim: null,
  data: null,
  storageOk: true,
  active: false,
  chapter: null,
  mod: null,
  beats: [],
  beatIndex: -1,
  beat: null,
  unregister: null,
  phase: 'idle', // briefing | loading | playing | cutscene | failed | debrief | tbc
  replay: false,
  pendingResume: null,
  expectStart: false,
  checkpoint: null,
  rollingT: 0,
  saveLog: [],
  playT: 0,
  results: [],
  ready: null,
  failInfo: null,
  ui: null,
  orig: null,
  api: null,
  lastStepKey: null,
};

/* ------------------------------------------------------------------ install */

export function installDirector(sim, ui) {
  D.sim = sim;
  D.ui = ui;
  Cinema.installCinema(sim);
  D.data = Save.load();
  if (!D.data.flags.firstSeen) {
    D.data.flags.firstSeen = Date.now();
    D.storageOk = Save.save(D.data);
  }
  Cinema.setSkipCinematics(!!D.data.flags.skipCinematics);

  const r = sim.runner;
  D.orig = { onStep: r.onStep, onComplete: r.onComplete, onFail: r.onFail, onEvent: r.onEvent };
  r.onStep = (step, i, total) => {
    if (D.orig.onStep) D.orig.onStep(step, i, total);
    if (D.active && isStoryDef(r.def)) safe(() => onStoryStep(step, i, total));
  };
  r.onComplete = (result) => {
    if (D.active && isStoryDef(r.def)) return safe(() => onBeatComplete(result));
    return D.orig.onComplete ? D.orig.onComplete(result) : undefined;
  };
  r.onFail = (f) => {
    if (D.active && isStoryDef(r.def)) return safe(() => onBeatFail(f));
    return D.orig.onFail ? D.orig.onFail(f) : undefined;
  };
  // Hints and rings go through unchanged; the tracker only reads.
  r.onEvent = (e) => {
    if (D.orig.onEvent) D.orig.onEvent(e);
  };

  // The pause menu must sit above the letterbox, and the story's own pause
  // buttons only show while a chapter is running.
  const pause = sim.pause.bind(sim);
  sim.pause = function storyPause() {
    pause();
    if (D.active && sim.state === 'paused') {
      Cinema.setSuspended(true);
      if (D.ui) {
        D.ui.showTracker(false);
        D.ui.showPauseBlock(true, pauseInfo());
      }
    }
  };
  const resume = sim.resume.bind(sim);
  sim.resume = function storyResume() {
    resume();
    if (D.active) {
      Cinema.setSuspended(false);
      if (D.ui && D.phase === 'playing') D.ui.showTracker(true);
    }
  };

  D.api = makeApi();
}

function pauseInfo() {
  const cp = D.checkpoint;
  return {
    chapter: D.chapter ? chapterLabel(D.chapter) : '',
    checkpoint: cp ? cp.label : 'Chapter start',
    storageOk: D.storageOk,
  };
}

/* ------------------------------------------------------------------- api */

/** What a chapter module may do. Everything it needs, nothing else. */
function makeApi() {
  return {
    get sim() {
      return D.sim;
    },
    get data() {
      return D.data;
    },
    get difficulty() {
      return D.data ? D.data.difficulty : 'pilot';
    },
    get replay() {
      return D.replay;
    },
    get isResume() {
      return !!D.pendingResume;
    },
    get playT() {
      return D.playT;
    },
    get beatIndex() {
      return D.beatIndex;
    },
    say: (id, opts) => Cinema.say(id, opts),
    caption: (t, d) => Cinema.caption(t, d),
    lowerThird: (t, d) => Cinema.lowerThird(t, d),
    titleCard: (o) => Cinema.titleCard(o),
    playCutscene: (def) => playCutscene(def),
    checkpoint: (id, label) => saveCheckpoint(id, label),
    tracker: (items, title) => D.ui && D.ui.setTracker(items, title),
    notify: (text, kind = 'info', dur = 4) => D.sim && D.sim.hud && D.sim.hud.notify(text, kind, dur),
    foundFile: (id) => found('files', id, FILES[id] ? FILES[id].title : id),
    foundSecret: (id, label) => found('secrets', id, label || 'Secret found'),
    style: (id, label) => {
      D.style = D.style || [];
      if (!D.style.includes(id)) {
        D.style.push(id);
        if (label && D.sim && D.sim.hud) D.sim.hud.notify(`Style: ${label}`, 'good', 3.5);
      }
    },
    hasStyle: (id) => !!(D.style && D.style.includes(id)),
    hasSecret: (id) => !!(D.data && D.data.flags.secrets.includes(id)),
    /** A player-level flag (knowsFlying…): kept across new games and replays, saved at once. */
    setFlag: (name, value) => {
      if (!D.data || D.data.flags[name] === value) return;
      D.data.flags[name] = value;
      D.storageOk = Save.save(D.data);
    },
  };
}

function found(kind, id, label) {
  if (!D.data) return false;
  const list = D.data.flags[kind];
  if (list.includes(id)) return false;
  list.push(id);
  if (!D.replay || kind === 'files' || kind === 'secrets') D.storageOk = Save.save(D.data);
  if (D.sim && D.sim.hud) D.sim.hud.notify(kind === 'files' ? `Kittiwake File found: ${label}` : `Secret: ${label}`, 'good', 4.5);
  if (D.ui) D.ui.refreshCard();
  return true;
}

/* ---------------------------------------------------------- new / continue */

/** Story → New game. Medals, files and achievements stay; the pointer resets. */
export function newGame(difficulty = 'pilot') {
  const keep = D.data || Save.blank();
  const fresh = Save.blank();
  fresh.difficulty = Save.DIFFICULTIES.includes(difficulty) ? difficulty : 'pilot';
  fresh.chapters = keep.chapters;
  fresh.flags = { ...fresh.flags, files: keep.flags.files, secrets: keep.flags.secrets, skipCinematics: keep.flags.skipCinematics, knowsFlying: keep.flags.knowsFlying, firstSeen: keep.flags.firstSeen || Date.now() };
  fresh.playTime = keep.playTime;
  fresh.chapter = CHAPTERS[0].id;
  D.data = fresh;
  D.storageOk = Save.save(D.data);
  return startChapter(CHAPTERS[0], { fresh: true });
}

/** Story → Continue. */
export function continueGame() {
  const plan = Save.resumePlan(D.data, CHAPTERS);
  switch (plan.kind) {
    case 'fresh':
      return newGame(D.data.difficulty);
    case 'start':
      return startChapter(chapterById(plan.chapter), { fresh: true });
    case 'resume':
      return startChapter(chapterById(plan.chapter), {
        resume: {
          beatIndex: plan.beatIndex,
          step: plan.step,
          exact: plan.exact,
          pose: plan.exact ? D.data.pose : null,
          beatState: plan.exact ? D.data.beatState : null,
          elapsed: plan.exact ? D.data.elapsed : 0,
          checkpoint: D.data.checkpoint,
        },
      });
    case 'tbc':
    default:
      return showTbc(plan.last);
  }
}

/** Chapters → a finished chapter → PLAY: its own temporary state. */
export function replayChapter(id) {
  const ch = chapterById(id);
  if (!ch || !ch.available) return Promise.resolve(false);
  return startChapter(ch, { fresh: true, replay: true });
}

/* ---------------------------------------------------------------- chapter */

export async function startChapter(ch, { fresh = false, resume = null, replay = false, skipBriefing = false } = {}) {
  if (!ch || !ch.available || !ch.module) return false;
  if (D.active) teardown('restart');
  D.active = true;
  D.chapter = ch;
  D.mod = ch.module;
  D.replay = !!replay;
  D.results = [];
  D.style = [];
  D.saveLog = [];
  D.playT = 0;
  D.rollingT = 0;
  D.failInfo = null;
  D.checkpoint = null;
  D.phase = 'briefing';
  D.beats = D.mod.beats;
  D.unregister = registerBeats(D.beats);
  safe(() => D.mod.enterChapter && D.mod.enterChapter(D.api));
  if (!D.replay) {
    D.data.chapter = ch.id;
    if (fresh) {
      D.data.beat = null;
      D.data.step = 0;
      D.data.pose = null;
      D.data.checkpoint = null;
      D.data.beatState = null;
    }
    D.storageOk = Save.save(D.data);
  }
  if (D.ui) D.ui.refreshCard();
  if (resume) {
    await beginBeat(resume.beatIndex, resume);
    return true;
  }
  if (skipBriefing || !D.ui) {
    await beginBeat(0, null);
    return true;
  }
  // The briefing card (the owner's "idk what to do" rule): a route picture
  // and three bullets, GO or hold SPACE, 20 s at most. Back means no chapter.
  const go = await new Promise((res) => D.ui.showBriefing(ch, D.mod, { onGo: () => res(true), onBack: () => res(false) }));
  if (!D.active) return false;
  if (!go) {
    teardown('back');
    return false;
  }
  await beginBeat(0, null);
  return true;
}

/**
 * Begin beat `i`. A `resume` carries the saved step, pose and beat state; a
 * beat marked `continues` that follows one in the same flight hands the
 * runner its def directly (no respawn), everything else goes through
 * startMode() behind a short fade.
 */
async function beginBeat(i, resume) {
  const sim = D.sim;
  const beat = D.beats[i];
  if (!beat) return;
  D.beatIndex = i;
  D.beat = beat;
  D.pendingResume = resume || null;
  D.lastStepKey = null;
  const seamless = !resume && i > 0 && beat.continues && sim.state === 'flying' && !sim.aircraft.crashed;
  D.phase = 'loading';
  if (seamless) {
    sim.runner.start(beat);
  } else {
    Cinema.fadeBlack(1.4);
    // Let the fade paint before the (blocking) world build. Not rAF: the
    // headless tests freeze rAF, and a hung await here would hang them.
    await new Promise((r) => setTimeout(r, 40));
    D.expectStart = true;
    try {
      await sim.startMode('mission', { id: beat.id });
    } finally {
      D.expectStart = false;
    }
    if (!D.active) return;
    if (resume && resume.exact && resume.pose) {
      Save.applyPose(sim, resume.pose);
      // The beat's own onStart runs inside resumeAt (it rebuilds the cast
      // from scratch); the saved state is laid over it afterwards.
      resumeAt(sim.runner, beat, resume.step, { elapsed: resume.elapsed });
      safe(() => beat.resume && beat.resume(resume.beatState, sim.runner.ctx()));
    }
  }
  D.phase = 'playing';
  D.pendingResume = null;
  if (resume && resume.exact && resume.pose) {
    // "Previously on…", then READY with the controls frozen on the objective line.
    D.checkpoint = { id: resume.checkpoint || 'resume', label: resume.checkpoint || 'Where you left off', beatIndex: i, step: resume.step, pose: resume.pose, beatState: resume.beatState, elapsed: resume.elapsed };
    const step = sim.runner.step;
    Cinema.holdStill(true);
    Cinema.recapCard({ lines: RECAPS[D.chapter.id] || [], checkpoint: resume.checkpoint || '', dur: 7 });
    Cinema.readyCard({ objective: step ? step.text : '', dur: 1.8 });
    D.ready = { on: true };
  } else {
    D.ready = null;
    saveCheckpoint(beat.startCheckpoint || `${beat.id}:start`, beat.startLabel || (i === 0 ? 'Chapter start' : beat.name || 'Beat start'));
  }
  if (D.ui) D.ui.showTracker(true);
}

/* ---------------------------------------------------------- checkpoints */

/**
 * Autosave now, as checkpoint `id`. In replay mode the pointer stays where
 * the main story left it; only medals, files and achievements are kept.
 */
export function saveCheckpoint(id, label, { quiet = false } = {}) {
  const sim = D.sim;
  if (!D.active || !sim || D.phase === 'cutscene' || D.phase === 'failed') return false;
  const r = sim.runner;
  const pose = Save.capturePose(sim);
  const cp = {
    id,
    label: label || id,
    beatIndex: D.beatIndex,
    step: Math.max(0, r.stepIndex),
    pose,
    beatState: D.beat && typeof D.beat.save === 'function' ? safeVal(() => D.beat.save(r.ctx())) : null,
    elapsed: r.elapsed,
  };
  D.checkpoint = cp;
  D.saveLog.push({ t: round1(D.playT), id, step: cp.step });
  if (!D.replay) {
    D.data.chapter = D.chapter.id;
    D.data.beat = D.beat.id;
    D.data.step = cp.step;
    D.data.checkpoint = cp.label;
    D.data.elapsed = round1(cp.elapsed);
    D.data.pose = pose;
    D.data.beatState = cp.beatState;
    D.data.playTime = round1((D.data.playTime || 0) + (D.playT - (D.lastPlayTSaved || 0)));
    D.lastPlayTSaved = D.playT;
    D.storageOk = Save.save(D.data);
  }
  D.rollingT = 0;
  if (!quiet && sim.hud && D.phase === 'playing') sim.hud.notify(D.storageOk || D.replay ? 'Checkpoint' : 'Checkpoint (progress cannot be saved on this device)', 'info', 1.6);
  return true;
}

function onStoryStep(step, i, total) {
  const r = D.sim.runner;
  const key = `${r.def && r.def.id}:${i}`;
  if (key === D.lastStepKey) return;
  D.lastStepKey = key;
  // The step just finished is the checkpoint (the default); it may opt out.
  // Not on the step a resume lands on: that one was not just completed.
  if (i > 0 && D.phase === 'playing' && !D.pendingResume) {
    const prev = r.def.steps[i - 1];
    if (prev && prev.checkpoint !== false) {
      const label = typeof prev.checkpoint === 'string' ? prev.checkpoint : prev.checkpointLabel || labelFor(prev);
      saveCheckpoint(prev.id, label);
    }
  }
  if (D.ui) D.ui.refreshTracker();
}

function labelFor(step) {
  return String(step.text || step.id || 'checkpoint').replace(/[.!…]+$/, '').slice(0, 48);
}

/* --------------------------------------------------------- beat endings */

function onBeatComplete(result) {
  const i = D.beatIndex;
  D.results.push(result);
  safe(() => D.mod.onBeatDone && D.mod.onBeatDone(D.api, i, result));
  if (i + 1 < D.beats.length) {
    beginBeat(i + 1, null);
    return;
  }
  // The last beat is done: a checkpoint here, so the finale's cutscene never
  // counts against the one-minute guarantee, and a quit during it keeps the landing.
  const last = D.beat && D.beat.steps[D.beat.steps.length - 1];
  saveCheckpoint(`${D.beat ? D.beat.id : 'beat'}:done`, (last && typeof last.checkpoint === 'string' && last.checkpoint) || 'Beat complete', { quiet: true });
  finishChapter();
}

async function finishChapter() {
  const sim = D.sim;
  /*
   * The chapter is complete the moment its last beat is: the medal, the
   * record and the pointer are written NOW, before the finale plays, so a
   * player who quits during the cutscene still has the chapter.
   */
  const verdict = safeVal(() => D.mod.medal(D.api, D.results)) || { medal: 'bronze', score: 50, breakdown: [] };
  verdict.style = [...(D.style || []), ...(verdict.style || [])];
  verdict.time = round1(D.playT);
  const ch = D.chapter;
  const next = Save.nextChapter(ch.id, CHAPTERS);
  Save.recordChapter(D.data, ch.id, { medal: verdict.medal, score: verdict.score, time: verdict.time, style: verdict.style });
  if (!D.replay) {
    D.data.chapter = next ? next.id : ch.id;
    D.data.beat = null;
    D.data.step = 0;
    D.data.pose = null;
    D.data.beatState = null;
    D.data.checkpoint = null;
    D.data.elapsed = 0;
  }
  D.storageOk = Save.save(D.data);
  D.saveLog.push({ t: round1(D.playT), id: 'chapter-complete' });
  noteAchievements(ch, verdict);
  if (D.ui) D.ui.refreshCard();

  D.phase = 'cutscene';
  if (D.mod.finale) {
    try {
      await D.mod.finale(D.api);
    } catch (e) {
      console.warn('[story] the finale threw; going to the debrief', e);
    }
  }
  if (!D.active) return;
  D.phase = 'debrief';
  sim.state = 'debrief';
  sim.hud.setVisible(false);
  Cinema.hideAll();
  if (D.ui) {
    D.ui.showTracker(false);
    D.ui.refreshCard();
    D.ui.showDebrief(ch, verdict, D.data.chapters[ch.id], {
      next: () => goNext(next),
      replay: () => restartChapter(),
      menu: () => quitToStory(),
    });
  }
}

function goNext(next) {
  if (next && next.available) {
    const wasReplay = D.replay;
    teardown('next');
    D.sim.quitToMenu('story');
    return startChapter(next, { fresh: true, replay: wasReplay });
  }
  return showTbc(D.chapter ? D.chapter.id : null);
}

/** "TO BE CONTINUED — Chapter N arrives in the next update", with the last medal. */
export function showTbc(lastId) {
  const sim = D.sim;
  if (D.active) {
    teardown('tbc');
    if (sim.state !== 'menu') sim.quitToMenu('story');
  }
  const last = chapterById(lastId) || CHAPTERS[0];
  const next = Save.nextChapter(last.id, CHAPTERS);
  D.phase = 'tbc';
  if (D.ui) D.ui.showTbc(last, next, D.data.chapters[last.id] || null);
  return Promise.resolve(true);
}

function onBeatFail(f) {
  const sim = D.sim;
  D.phase = 'failed';
  D.failInfo = f;
  if (sim.audio && sim.audio.available && sim.audio.alerts && sim.audio.alerts.failure) sim.audio.alerts.failure();
  safe(() => D.mod.onFail && D.mod.onFail(D.api, f));
  // The retry is instant, so the screen is small and kind.
  sim.state = 'debrief';
  sim.hud.setVisible(false);
  Cinema.hideAll();
  if (D.ui) {
    D.ui.showTracker(false);
    D.ui.showFail(f.reason || 'That one did not work out.', D.checkpoint, {
      retry: () => retryFromCheckpoint(),
      restart: () => restartChapter(),
      quit: () => quitToStory(),
    });
  }
}

/** Retry from the last checkpoint: ≤ 3 s, the same beat, the same step, the same pose. */
export function retryFromCheckpoint() {
  const cp = D.checkpoint;
  if (!D.active) return Promise.resolve(false);
  if (!cp || !cp.pose) return restartChapter();
  D.failInfo = null;
  D.sim.menus.hide();
  return beginBeat(cp.beatIndex, { ...cp, exact: true, checkpoint: cp.label });
}

export function restartChapter() {
  const ch = D.chapter;
  const replay = D.replay;
  if (!ch) return Promise.resolve(false);
  D.sim.menus.hide();
  teardown('restart');
  D.sim.quitToMenu('story');
  return startChapter(ch, { fresh: true, replay, skipBriefing: true });
}

export function quitToStory() {
  const sim = D.sim;
  sim.menus.hide();
  teardown('quit');
  sim.quitToMenu('story');
}

/* ----------------------------------------------------------- cutscenes */

function playCutscene(def) {
  const was = D.phase;
  D.phase = 'cutscene';
  return Cinema.playCutscene(def).then((how) => {
    if (D.phase === 'cutscene') D.phase = was === 'cutscene' ? 'playing' : was;
    return how;
  });
}

/* -------------------------------------------------------------- hooks */

/** The extension's startMode hook: a restart ("Fly again") of a story beat. */
export function onStartMode(sim, mode, opts) {
  if (!D.active) return;
  if (D.expectStart) return;
  if (mode !== 'mission' || !opts || !D.beat || opts.id !== D.beat.id) return;
  // Restarted by the pause menu or the generic debrief: the beat starts over.
  D.pendingResume = null;
  D.ready = null;
  D.phase = 'playing';
  D.lastStepKey = null;
  Cinema.hideAll();
  saveCheckpoint(`${D.beat.id}:start`, D.beat.startLabel || 'Beat start', { quiet: true });
  if (D.ui) D.ui.showTracker(true);
}

/** The extension's stop hook: the flight ended, or went back to the runway. */
export function onStop(sim, why) {
  if (!D.active) return;
  if (why === 'airport') {
    // returnToAirport() restarts the def from the runway: still the same chapter.
    D.pendingResume = null;
    D.ready = null;
    Cinema.hideAll();
    return;
  }
  teardown(why);
}

function teardown(why) {
  if (!D.active) return;
  safe(() => D.mod && D.mod.leaveChapter && D.mod.leaveChapter(D.api, why));
  if (D.unregister) D.unregister();
  D.unregister = null;
  D.active = false;
  D.phase = 'idle';
  D.beat = null;
  D.beatIndex = -1;
  D.pendingResume = null;
  D.ready = null;
  D.lastPlayTSaved = 0;
  Cinema.hideAll();
  if (D.ui) {
    D.ui.showTracker(false);
    D.ui.showPauseBlock(false);
    D.ui.refreshCard();
  }
}

export function onUpdate(sim, dt) {
  Cinema.update(sim, dt);
  if (!D.active) return;
  if (D.phase === 'playing' || D.phase === 'cutscene') D.playT += dt;
  // READY: frozen until the recap and the READY card have cleared.
  if (D.ready) {
    const st = Cinema.cinemaState();
    if (!st.card && st.queued === 0) {
      D.ready = null;
      Cinema.holdStill(false);
    }
  }
  // The rolling soft-save in cruise beats.
  if (D.phase === 'playing' && !D.ready) {
    const step = sim.runner.step;
    if (step && step.rolling) {
      D.rollingT += dt;
      if (D.rollingT >= ROLLING_SAVE_SECONDS && safeToSave(sim)) {
        saveCheckpoint('rolling', D.checkpoint ? D.checkpoint.label : labelFor(step), { quiet: true });
      }
    }
  }
  safe(() => D.mod && D.mod.update && D.mod.update(D.api, dt));
  if (D.ui) D.ui.tickTracker(dt);
}

function safeToSave(sim) {
  const ac = sim.aircraft;
  if (!ac || ac.crashed || ac.stalled) return false;
  if (!ac.onGround && ac.agl < UNSAFE_AGL_M) return false;
  return sim.runner.status === STATUS.RUNNING;
}

export function onCamera(sim, dt, camera) {
  return Cinema.cameraHook(sim, dt, camera);
}

export function onKey(sim, code, down, e) {
  if (!D.active) return false;
  if (Cinema.handleKey(sim, code, down)) return true;
  // Frozen on READY: nothing reaches the aeroplane.
  if (D.ready && down) return code !== 'Escape';
  return !!safeVal(() => D.mod && D.mod.key && D.mod.key(D.api, code, down, e));
}

/* --------------------------------------------------------- achievements */

let noteStory = null;
import('../features/achievements/index.js')
  .then((m) => {
    noteStory = m.noteStoryChapter || null;
  })
  .catch(() => {});

function noteAchievements(ch, verdict) {
  if (!noteStory) return;
  safe(() => noteStory(D.sim, { chapter: ch.id, medal: verdict.medal, style: verdict.style || [], secrets: D.data.flags.secrets.slice(), files: D.data.flags.files.slice() }));
}

/* ------------------------------------------------------------- helpers */

export function directorState() {
  return {
    active: D.active,
    phase: D.phase,
    chapter: D.chapter ? D.chapter.id : null,
    beat: D.beat ? D.beat.id : null,
    beatIndex: D.beatIndex,
    replay: D.replay,
    checkpoint: D.checkpoint ? { id: D.checkpoint.id, label: D.checkpoint.label, step: D.checkpoint.step } : null,
    playT: round1(D.playT),
    saveLog: D.saveLog.slice(),
    storageOk: D.storageOk,
    ready: !!D.ready,
    data: D.data,
  };
}

/** Reload the save from storage (the tests swap saves underneath the game). */
export function reloadSave() {
  D.data = Save.load();
  Cinema.setSkipCinematics(!!D.data.flags.skipCinematics);
  if (D.ui) D.ui.refreshCard();
  return D.data;
}

export function setSkipCinematics(on) {
  D.data.flags.skipCinematics = !!on;
  Cinema.setSkipCinematics(!!on);
  D.storageOk = Save.save(D.data);
}

export function setDifficulty(d) {
  if (!Save.DIFFICULTIES.includes(d)) return;
  D.data.difficulty = d;
  D.storageOk = Save.save(D.data);
}

function round1(v) {
  return Math.round((v || 0) * 10) / 10;
}

function safe(fn) {
  try {
    return fn();
  } catch (e) {
    console.error('[story] a chapter hook threw and was skipped:', e);
    return undefined;
  }
}

function safeVal(fn) {
  try {
    return fn();
  } catch (e) {
    console.warn('[story] a chapter reader threw:', e);
    return null;
  }
}

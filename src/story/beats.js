/**
 * SIGNAL ZERO — beats: a story beat IS a mission def.
 *
 * The chapter runner (director.js) wraps the game's own MissionRunner rather
 * than inventing a second one: a beat is a def in the exact shape of
 * src/game/missions.js, started through sim.startMode('mission', { id }) so
 * the map, the aircraft, the weather, the spawn, the HUD objective, the
 * arrow, the beacon and the minimap all come for free.
 *
 * REUSE WITHOUT DUPLICATION — adapt(). Chapter 1 is the meteor-photo mission
 * with a hand-held camera and a rival: adapt() clones the existing def and
 * swaps its id, text, radio, spawn and weather, keeping its check functions
 * by reference, so a fix to the base mission is a fix to the story.
 *
 * REGISTERED ONLY WHILE PLAYING. startMode() finds its def with
 * findMission(), which reads the one MISSIONS list — the same list every
 * board, card count and payout reads. A story beat is not a mission anybody
 * picks: it must never show on a board, never count on a Missions card and
 * never be priced. So the beats are pushed into MISSIONS when their chapter
 * starts and taken out again when it ends (registerBeats returns the undo),
 * and carry `game: 'story'` and `hidden: true` for anything that looks while
 * they are there.
 */

import { MISSIONS } from '../game/missions.js';
import { STATUS } from '../game/runner.js';
import { landedOnRunway } from '../game/landing-zone.js';

/**
 * Clone `base` and lay `patch` over it. Steps are shallow-copied one by one
 * so a patch can replace the list, or `patchSteps(id → changes)` can amend
 * individual steps by id without restating the rest.
 */
export function adapt(base, patch = {}, patchSteps = null) {
  const steps = (patch.steps || base.steps || []).map((s) => ({ ...s }));
  if (patchSteps) {
    for (const s of steps) if (patchSteps[s.id]) Object.assign(s, patchSteps[s.id]);
  }
  const out = { ...base, ...patch, steps, baseId: base.baseId || base.id };
  // A meteor/… config object is merged, not replaced, so a patch can add a knob.
  for (const k of ['meteor', 'weather']) {
    if (base[k] && patch[k] && typeof base[k] === 'object' && typeof patch[k] === 'object') out[k] = { ...base[k], ...patch[k] };
  }
  return out;
}

/** Put the chapter's beats where findMission() can see them. Returns the undo. */
export function registerBeats(defs) {
  const added = [];
  for (const d of defs) {
    if (!d || !d.id) continue;
    if (MISSIONS.some((m) => m.id === d.id)) continue;
    d.game = d.game || 'story';
    d.hidden = true;
    MISSIONS.push(d);
    added.push(d);
  }
  return () => {
    for (const d of added) {
      const i = MISSIONS.indexOf(d);
      if (i >= 0) MISSIONS.splice(i, 1);
    }
  };
}

/** Is this def one of the story's? */
export function isStoryDef(def) {
  return !!def && def.game === 'story';
}

/**
 * Enter `def` at step `index` without playing the steps before it.
 *
 * runner.start() always begins at step 0 and advance() runs the previous
 * step's onDone, so neither is right for a resume: this sets the runner's own
 * fields the way start() does, calls the def's onStart (which builds the
 * beat's cast), then enters the one step — gates, enter(), radio, the HUD —
 * exactly as advance() would have.
 */
export function resumeAt(runner, def, index, { elapsed = 0 } = {}) {
  const sim = runner.sim;
  runner.clearGates();
  runner.def = def;
  runner.status = STATUS.RUNNING;
  runner.stepIndex = -1;
  runner.elapsed = Math.max(0, elapsed || 0);
  runner.data = { score: 0 };
  runner.bindAircraft();
  if (def.onStart) def.onStart(runner.ctx());
  const steps = def.steps || [];
  const i = Math.max(0, Math.min(steps.length - 1, index | 0));
  runner.stepIndex = i;
  runner.stepElapsed = 0;
  runner.hintTimer = 0;
  const step = steps[i];
  if (!step) {
    runner.complete();
    return;
  }
  runner.buildGates(step);
  if (step.enter) step.enter(runner.ctx());
  if (step.atc && sim.audio) sim.speak(step.atc.text, step.atc.voice || 'tower', step.atc.urgency || 0);
  if (runner.onStep) runner.onStep(step, i, steps.length);
}

/**
 * "Landed": the touchdown was not a crash and the aeroplane has been down
 * inside a runway's secret box for three seconds — the same rule every
 * mission landing uses (src/game/landing-zone.js, the owner 2026-10-16).
 *
 * The name is the old one ("and stopped") because chapter 1 imports it.
 * It no longer waits for a stop: touch down long and fast anywhere on the
 * runway, roll for three seconds, and the beat is done. The stop, the
 * numbers and the centreline are what the landing grade scores.
 */
export function landedAndStopped(ctx) {
  return landedOnRunway(ctx);
}

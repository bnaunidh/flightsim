/**
 * Objective runner — drives both the tutorial and the missions.
 *
 * A mission is just a list of steps. Each step has some friendly instruction
 * text, an optional radio call, optional checkpoint rings, and a check function
 * that says when it is done. The runner handles the rings, the "next step"
 * chime, timing, failure conditions and the debrief.
 */

import * as THREE from '../vendor/three.module.js';
import { RingGate } from './markers.js';
import { EVENTS } from '../aircraft/physics.js';

export const STATUS = { IDLE: 'idle', RUNNING: 'running', COMPLETE: 'complete', FAILED: 'failed' };

export class MissionRunner {
  constructor(sim) {
    this.sim = sim;
    this.status = STATUS.IDLE;
    this.def = null;
    this.stepIndex = 0;
    this.gates = [];
    this.elapsed = 0;
    this.stepElapsed = 0;
    this.data = {};
    this.onStep = null;
    this.onComplete = null;
    this.onFail = null;
    this.onEvent = null;
    this._bound = false;
    this.hintTimer = 0;
  }

  bindAircraft() {
    if (this._bound) return;
    const ac = this.sim.aircraft;
    ac.on(EVENTS.TOUCHDOWN, (g) => {
      this.data.lastTouchdown = g;
      this.data.landedAt = this.elapsed;
    });
    ac.on(EVENTS.LIFTOFF, () => {
      this.data.tookOff = true;
    });
    ac.on(EVENTS.CRASH, (c) => {
      if (this.status === STATUS.RUNNING && this.def && this.def.failOnCrash !== false) {
        this.fail(c.reason || 'You crashed');
      }
    });
    this._bound = true;
  }

  start(def) {
    this.clearGates();
    this.def = def;
    this.status = STATUS.RUNNING;
    this.stepIndex = -1;
    this.elapsed = 0;
    this.data = { score: 0 };
    this.bindAircraft();
    if (def.onStart) def.onStart(this.ctx());
    this.advance();
  }

  ctx() {
    return {
      sim: this.sim,
      ac: this.sim.aircraft,
      weather: this.sim.weather,
      audio: this.sim.audio,
      data: this.data,
      elapsed: this.elapsed,
      runner: this,
    };
  }

  get step() {
    return this.def && this.stepIndex >= 0 ? this.def.steps[this.stepIndex] : null;
  }

  clearGates() {
    for (const g of this.gates) g.dispose(this.sim.scene);
    this.gates = [];
  }

  buildGates(step) {
    this.clearGates();
    if (!step || !step.gates) return;
    for (const g of step.gates) {
      const gate = new RingGate(g.pos, g.heading ?? 90, g.radius ?? 34);
      this.sim.scene.add(gate.group);
      this.gates.push(gate);
    }
    if (this.gates.length) this.gates[0].setActive(true);
    this.gateIndex = 0;
  }

  advance() {
    if (!this.def) return;
    const prev = this.step;
    if (prev && prev.onDone) prev.onDone(this.ctx());
    this.stepIndex++;
    this.stepElapsed = 0;
    this.hintTimer = 0;
    if (this.stepIndex >= this.def.steps.length) {
      this.complete();
      return;
    }
    const step = this.step;
    this.buildGates(step);
    if (step.enter) step.enter(this.ctx());
    if (step.atc && this.sim.audio) {
      this.sim.speak(step.atc.text, step.atc.voice || 'tower', step.atc.urgency || 0);
    }
    if (this.onStep) this.onStep(step, this.stepIndex, this.def.steps.length);
  }

  skipStep() {
    // Used by the tutorial's "skip" button.
    if (this.status === STATUS.RUNNING) this.advance();
  }

  complete() {
    this.status = STATUS.COMPLETE;
    this.clearGates();
    const result = {
      id: this.def.id,
      name: this.def.name,
      time: this.elapsed,
      score: this.computeScore(),
      landing: this.data.lastTouchdown || null,
    };
    if (this.def.onComplete) this.def.onComplete(this.ctx(), result);
    if (this.onComplete) this.onComplete(result);
  }

  /**
   * Stop, with no verdict and no screen.
   *
   * `fail()` is a result: it ends the flight and puts "mission not completed"
   * in front of you. This is for when something else has taken the aeroplane
   * over and the mission is simply no longer happening — a mayday. The clock
   * stops, the rings go, the steps stop advancing and the radio goes quiet,
   * and nothing is announced, because whatever took over is mid-sentence and
   * owns the ending.
   */
  standDown() {
    if (this.status !== STATUS.RUNNING) return null;
    const name = this.def ? this.def.name : null;
    this.status = STATUS.IDLE;
    this.clearGates();
    return name;
  }

  fail(reason) {
    if (this.status !== STATUS.RUNNING) return;
    this.status = STATUS.FAILED;
    this.clearGates();
    if (this.onFail) this.onFail({ reason, id: this.def ? this.def.id : null, time: this.elapsed });
  }

  computeScore() {
    if (!this.def) return 0;
    if (this.def.score) return this.def.score(this.ctx());
    const landing = this.data.lastTouchdown;
    const timeBonus = this.def.parTime ? Math.max(0, 1 - this.elapsed / (this.def.parTime * 2)) : 0.5;
    return Math.round((landing ? landing.score : 50) * 0.7 + timeBonus * 30);
  }

  /** Current thing the HUD should point at. */
  activeTarget() {
    /*
     * Nothing to aim at once the mission is over.
     *
     * `step` survives the end of a mission — it is just an index into the
     * list — so without this the marker and the wingtip rails went on
     * pointing at an objective that had been stood down or failed. During a
     * mayday that is the whole problem: the aeroplane is flying itself back
     * to the field and the guidance is still insisting you go to the outpost.
     */
    if (this.status !== STATUS.RUNNING) return null;
    const step = this.step;
    if (!step) return null;
    if (this.gates.length) {
      const g = this.gates.find((x) => !x.passed);
      if (g) return { pos: g.pos, label: step.targetLabel || 'Next ring' };
    }
    if (step.target) {
      const t = step.target(this.ctx());
      if (t) return { pos: t, label: step.targetLabel || 'Target' };
    }
    // Some steps are about the aeroplane rather than a place — "rotate",
    // "climb away". They name no target, and without this the guidance falls
    // back to the runway, so the arrow and the wingtip rails swing round and
    // point at the runway you have just left while you are still climbing off
    // it. Look ahead to the next step that does name somewhere: that is where
    // you are actually going.
    const ctx = this.ctx();
    for (let i = this.stepIndex + 1; i < this.def.steps.length; i++) {
      const next = this.def.steps[i];
      if (!next.target) continue;
      const t = next.target(ctx);
      if (t) return { pos: t, label: next.targetLabel || 'Target' };
    }
    return null;
  }

  update(dt) {
    if (this.status !== STATUS.RUNNING) return;
    this.elapsed += dt;
    this.stepElapsed += dt;
    const ctx = this.ctx();
    const step = this.step;
    if (!step) return;

    // A mission may run something of its own every frame — a patient's pulse,
    // a cargo temperature, anything that has to watch how you are flying
    // rather than where you have got to.
    if (this.def.tick) this.def.tick(ctx, dt);

    // Rings.
    const pos = this.sim.aircraft.pos;
    for (const g of this.gates) g.update(dt, this.sim.camera.position);
    const nextGate = this.gates.find((g) => !g.passed);
    if (nextGate && nextGate.test(pos)) {
      nextGate.markPassed();
      const remaining = this.gates.filter((g) => !g.passed);
      if (remaining.length) remaining[0].setActive(true);
      if (this.onEvent) this.onEvent({ type: 'checkpoint', remaining: remaining.length });
    }

    // Global failure conditions.
    if (this.def.timeLimit && this.elapsed > this.def.timeLimit) {
      this.fail('Ran out of time');
      return;
    }
    if (this.def.failIf) {
      const why = this.def.failIf(ctx);
      if (why) {
        this.fail(why);
        return;
      }
    }

    // Step completion.
    let done = false;
    if (step.gates && step.gates.length) {
      done = this.gates.every((g) => g.passed);
      if (done && step.check) done = step.check(ctx, dt);
    } else if (step.check) {
      done = step.check(ctx, dt);
    } else {
      done = this.stepElapsed > (step.duration || 3);
    }
    if (done) {
      if (this.onEvent) this.onEvent({ type: 'stepComplete', step });
      this.advance();
      return;
    }

    // Repeat the hint if the player seems stuck.
    if (step.hint && this.sim.settings.showHints) {
      this.hintTimer += dt;
      const every = step.hintEvery || 22;
      if (this.hintTimer > every) {
        this.hintTimer = 0;
        if (this.onEvent) this.onEvent({ type: 'hint', text: step.hint });
      }
    }
  }
}

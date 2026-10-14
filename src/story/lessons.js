/**
 * SIGNAL ZERO — teach by doing (story-bible.md §6, chapter 1).
 *
 * "For a first-time player, pitch, roll and throttle are each introduced as
 * a single prompt in the first 60 seconds. 'I know how to fly' skips them."
 *
 * No tutorial chapter and no pause: the chapter is already running, Cole is
 * already talking, and a small card says ONE thing at a time — power, then
 * the nose, then the bank — and moves on the moment you do it (or after a
 * few seconds if you don't, so it never nags past the first minute). The
 * keys in it are the player's own bindings; on a touch screen it talks about
 * the stick and the throttle slider instead.
 *
 * A first-timer is someone the game has never seen land and who has not
 * said "I know how to fly". Doing all three, or pressing the button, sets the
 * story save's `knowsFlying` flag, so nobody sees the prompts twice.
 *
 * The Coach is pure (controls in, events out) so tests/features/story.mjs
 * runs it in node; the card is a few DOM nodes in the plug-in layer, fading
 * in and out (Reduce flashing: nothing here blinks).
 */
import { keyName } from '../flight/input.js';
import { extLayer } from '../game/extensions.js';

/** The first prompt comes this long into the beat. */
export const START_S = 2;
/** Seconds of real input that count as having done it. */
export const HOLD_S = 0.4;
/** A prompt nobody acts on moves on after this long. */
export const TIMEOUT_S = 14;
/** A beat between one prompt and the next ("✓", then the next). */
export const GAP_S = 1.2;
/** The bible's limit: every prompt is over inside the first minute. */
export const WITHIN_S = 60;

export const LESSONS = [
  {
    id: 'throttle',
    title: 'Power',
    text: (k, touch) => (touch ? 'Slide the throttle up for more power, down for less.' : `Hold ${k('throttleUp')} for more power, ${k('throttleDown')} for less.`),
    did: (c, s) => Math.abs((c.throttle || 0) - s.throttle0) > 0.08,
  },
  {
    id: 'pitch',
    title: 'Nose',
    text: (k, touch) => (touch ? 'Pull the stick down to raise the nose; push it up to lower it.' : `Ease back with ${k('pitchUp')} to raise the nose; ${k('pitchDown')} lowers it.`),
    did: (c) => Math.abs(c.pitch || 0) > 0.25,
  },
  {
    id: 'roll',
    title: 'Bank',
    text: (k, touch) => (touch ? 'Tilt the stick left or right to bank, and turn toward the arrow.' : `Bank with ${k('rollLeft')} and ${k('rollRight')} — roll toward the arrow, then level out.`),
    did: (c) => Math.abs(c.roll || 0) > 0.25,
  },
];

/** Who gets the prompts: a first-timer, on a fresh start (never a resume or a replay). */
export function wantsLessons({ knowsFlying = false, landings = 0, replay = false, resume = false } = {}) {
  return !knowsFlying && !replay && !resume && !(landings > 0);
}

/**
 * The prompts' clock. step(dt, controls) returns what happened this tick:
 *   { show: lesson }      a prompt goes up
 *   { passed: id, how }   it is over ('did' — you did it — or 'timeout')
 *   { finished: true }    all three are over (or skipped)
 *   null                  nothing new
 */
export class Coach {
  constructor() {
    this.i = -1;
    this.t = 0; // since the beat began
    this.promptT = 0; // since this prompt went up
    this.held = 0;
    this.gap = START_S;
    this.state = { throttle0: 0 };
    this.results = {};
    this.over = false;
  }

  start(controls) {
    this.state.throttle0 = (controls && controls.throttle) || 0;
    return this;
  }

  skip() {
    if (this.over) return null;
    this.over = true;
    for (const l of LESSONS) if (!this.results[l.id]) this.results[l.id] = 'skipped';
    return { finished: true, skipped: true };
  }

  get current() {
    return !this.over && this.i >= 0 && this.i < LESSONS.length && this.gap <= 0 ? LESSONS[this.i] : null;
  }

  step(dt, controls) {
    if (this.over) return null;
    this.t += dt;
    if (this.gap > 0) {
      this.gap -= dt;
      if (this.gap > 0) return null;
      this.i++;
      if (this.i >= LESSONS.length) {
        this.over = true;
        return { finished: true };
      }
      this.promptT = 0;
      this.held = 0;
      // Power is measured from where the lever is when its prompt goes up.
      if (LESSONS[this.i].id === 'throttle') this.state.throttle0 = (controls && controls.throttle) || 0;
      return { show: LESSONS[this.i] };
    }
    const l = LESSONS[this.i];
    this.promptT += dt;
    if (controls && l.did(controls, this.state)) this.held += dt;
    let how = null;
    if (this.held >= HOLD_S) how = 'did';
    else if (this.promptT >= TIMEOUT_S) how = 'timeout';
    if (!how) return null;
    this.results[l.id] = how;
    this.gap = GAP_S;
    return { passed: l.id, how };
  }
}

/* ---------------------------------------------------------------- the card */

const CSS = /* css */ `
.sz-coach { position: fixed; left: 50%; top: 21%; transform: translateX(-50%); z-index: 31; width: min(420px, calc(100vw - 32px));
  background: rgba(6,10,18,0.84); border: 1px solid rgba(255,191,71,0.38); border-radius: 14px; padding: 10px 14px 11px;
  color: #eef3fb; font: 500 14px/1.35 var(--font, sans-serif); box-shadow: 0 10px 30px rgba(0,0,0,0.45);
  opacity: 0; transition: opacity 0.45s ease; pointer-events: none; }
.sz-coach.on { opacity: 1; }
.sz-coach .sz-ch { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
.sz-coach .sz-ct { font: 800 10.5px/1 var(--font, sans-serif); letter-spacing: 0.2em; text-transform: uppercase; color: #ffbf47; }
.sz-coach .sz-ct b { color: #eef3fb; margin-left: 6px; }
.sz-coach .sz-cx { pointer-events: auto; cursor: pointer; border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.06); color: #cfd8e6;
  border-radius: 999px; padding: 5px 10px; font: 700 11.5px/1 var(--font, sans-serif); }
.sz-coach .sz-cx:hover { background: rgba(255,255,255,0.12); }
.sz-coach .sz-cl { min-height: 1.35em; transition: opacity 0.3s ease; }
.sz-coach .sz-cl.ok { color: #7ee8b2; }
.sz-coach kbd { font: 700 12px/1 var(--font, sans-serif); padding: 2px 6px; border-radius: 5px; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.2); }
`;

function ensureCss() {
  if (document.getElementById('sz-coach-css')) return;
  const st = document.createElement('style');
  st.id = 'sz-coach-css';
  st.textContent = CSS;
  document.head.appendChild(st);
}

const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * The live coach for a chapter: build(), then tick(dt) every frame. onDone
 * runs once, when the three are over or skipped — the chapter saves the flag.
 */
export function createCoach(sim, { onDone } = {}) {
  ensureCss();
  const coach = new Coach().start(sim.aircraft && sim.aircraft.controls);
  const root = document.createElement('div');
  root.className = 'sz-coach';
  root.setAttribute('role', 'status');
  root.innerHTML = `<div class="sz-ch"><span class="sz-ct">First flight<b data-c-n></b></span><button type="button" class="sz-cx" data-c-skip>I know how to fly</button></div><div class="sz-cl" data-c-line></div>`;
  extLayer().appendChild(root);
  const line = root.querySelector('[data-c-line]');
  const n = root.querySelector('[data-c-n]');
  const k = (action) => `<kbd>${esc(keyName(action, sim))}</kbd>`;
  let done = false;
  let hideT = 0;
  const finish = (skipped) => {
    if (done) return;
    done = true;
    root.classList.remove('on');
    hideT = 0.6;
    if (onDone) onDone({ skipped: !!skipped, results: { ...coach.results } });
  };
  root.querySelector('[data-c-skip]').addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    coach.skip();
    finish(true);
  });
  const api = {
    coach,
    root,
    get done() {
      return done;
    },
    get showing() {
      return root.classList.contains('on') && !done ? (coach.current ? coach.current.id : 'ok') : null;
    },
    tick(dt) {
      if (done) {
        if (hideT > 0) {
          hideT -= dt;
          if (hideT <= 0) root.remove();
        }
        return;
      }
      const ac = sim.aircraft;
      const ev = coach.step(dt, ac && ac.controls);
      if (!ev) return;
      if (ev.show) {
        const i = LESSONS.indexOf(ev.show);
        n.textContent = ` · ${i + 1} of ${LESSONS.length} · ${ev.show.title}`;
        line.classList.remove('ok');
        line.innerHTML = ev.show.text(k, !!sim.touch);
        root.classList.add('on');
      } else if (ev.passed) {
        line.classList.add('ok');
        line.textContent = ev.how === 'did' ? '✓ That’s it.' : '✓ Moving on.';
      } else if (ev.finished) {
        finish(false);
      }
    },
    /** Gone at once (the chapter is leaving), without saving anything. */
    dispose() {
      done = true;
      root.remove();
    },
  };
  return api;
}

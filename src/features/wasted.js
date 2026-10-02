/**
 * WASTED — "if you get hit by a plane, it says WASTED like yk gta" (the owner);
 * then "if someone hits you with anything, a plane etc, you get pushed to the
 * ground, WASTED showing on your screen (ragdoll physics)".
 *
 * This file is the SCREEN only: the world drains to grey, a second of slow
 * motion, a big WASTED across the middle with one line under it, and it
 * clears. Being knocked over — what hits you, the ragdoll, getting back up —
 * is ./knockdown.js, which calls this when it happens, on THIS player's
 * screen only. Anything that moves can do it now (v48 said only your own
 * plane): knockdown.js decides, this shows it.
 *
 *   showWasted(sim, cause, opts)   ->  true if it started; false if one is
 *                                      already showing, the game is not on,
 *                                      or the pause menu's "Runaway plane &
 *                                      WASTED" switch is off (the knock still
 *                                      happens then — just no WASTED screen)
 *
 *     cause   a word for the tests and the log: 'plane', 'traffic', ...
 *     opts    { words: 'string' }   the small line under WASTED
 *
 *   endWasted(sim)                     take it down now
 *
 * THE SLOW MOTION is the frame's time scaled to 0.3 for 1.1 s of real time.
 * main.js's loop calls sim.update(dt) every frame, and the tests call it
 * too, so install() puts a wrapper on the instance that multiplies dt by
 * the current scale — 1 whenever nothing is happening, which is almost
 * always. The ragdoll falls in slow motion with everything else.
 *
 * THE SOUND is two generated tones through the game's own mixer (a low
 * falling "whumm" and a thud): no files, and never louder than a notify chime.
 */

import { registerExtension, extLayer } from '../game/extensions.js';

/** The timeline, in real seconds. */
export const WASTED = {
  greyIn: 0.5,
  slowFor: 1.1,
  slowScale: 0.3,
  wordAt: 0.7,
  /** The grey and the word go; knockdown.js gets you up from here, once the body has settled. */
  clearAt: 3.0,
  endAt: 3.7,
};

const CSS = `
.ws-root { position: fixed; inset: 0; z-index: 40; pointer-events: none; display: none; }
.ws-root.is-on { display: block; }
.ws-shade { position: absolute; inset: 0; opacity: 0; transition: opacity .45s ease-out;
  background: radial-gradient(ellipse at center, rgba(40,40,40,.05) 0%, rgba(20,20,20,.35) 70%, rgba(0,0,0,.6) 100%); }
.ws-root.is-grey .ws-shade { opacity: 1; }
.ws-word { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-50%) scale(1.35); opacity: 0;
  text-align: center; transition: opacity .25s ease-out, transform .35s cubic-bezier(.2,1.6,.4,1); }
.ws-root.is-word .ws-word { opacity: 1; transform: translateY(-50%) scale(1); }
.ws-word b { display: block; font: 900 clamp(64px, 15vw, 150px)/1 Impact, 'Arial Black', 'Helvetica Neue', system-ui, sans-serif;
  letter-spacing: .04em; color: #c3261f; text-transform: uppercase;
  -webkit-text-stroke: 3px #111; paint-order: stroke fill;
  text-shadow: 0 0 2px #000, 4px 4px 0 rgba(0,0,0,.55); }
.ws-word span { display: block; margin-top: 10px; font: 700 18px/1.3 var(--font, system-ui, sans-serif); color: #fff;
  text-shadow: 0 2px 6px rgba(0,0,0,.8); }
`;

const S = {
  sim: null,
  root: null,
  sub: null,
  active: false,
  t: 0,
  scale: 1,
  cause: '',
  count: 0,
  canvas: null,
  cleared: false,
  history: [],
};

function build() {
  if (S.root) return true;
  if (typeof document === 'undefined' || !document.body) return false;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const root = document.createElement('div');
  root.className = 'ws-root';
  root.innerHTML = '<div class="ws-shade"></div><div class="ws-word"><b>Wasted</b><span></span></div>';
  extLayer().appendChild(root);
  S.root = root;
  S.sub = root.querySelector('.ws-word span');
  return true;
}

function mixer(sim) {
  const a = sim && sim.audio;
  return a && a.available && a.mixer ? a.mixer : null;
}

function sound(sim) {
  const mx = mixer(sim);
  if (!mx) return;
  try {
    mx.tone({ bus: 'alerts', freq: 220, sweepTo: 55, duration: 1.3, gain: 0.09, type: 'triangle' });
    mx.noiseBurst({ bus: 'environment', duration: 0.35, gain: 0.12, type: 'lowpass', freq: 240, q: 0.7 });
  } catch (e) {
    /* sound is a nicety */
  }
}

/** The canvas the world is drawn on: greyed with a CSS filter, which costs nothing. */
function setGrey(sim, on) {
  const c = S.canvas || (sim && sim.renderer && sim.renderer.domElement);
  if (!c || !c.style) return;
  S.canvas = c;
  c.style.transition = 'filter .5s ease-out';
  c.style.filter = on ? 'grayscale(1) contrast(1.08) brightness(.82)' : '';
}

/** The pause menu's switch (runaway.js paints it): off means no WASTED screen. */
export function wastedOff(sim) {
  return !!(sim && sim.settings && sim.settings.runawayPlane === false);
}

/** The moment. See the top of the file. */
export function showWasted(sim, cause = 'plane', opts = {}) {
  sim = sim || S.sim;
  if (!sim || S.active || sim.state !== 'flying') return false;
  if (wastedOff(sim)) return false;
  S.sim = sim;
  build();
  S.active = true;
  S.t = 0;
  S.scale = WASTED.slowScale;
  S.cause = String(cause || 'plane');
  S.count++;
  S.cleared = false;
  S.history.push({ cause: S.cause, at: Date.now() });
  if (S.history.length > 10) S.history.shift();
  if (S.sub) S.sub.textContent = (opts && opts.words) || 'Knocked down.';
  if (S.root) S.root.classList.add('is-on', 'is-grey');
  setGrey(sim, true);
  sound(sim);
  return true;
}

/** The grey and the word go. */
function clear(sim) {
  if (S.cleared) return;
  S.cleared = true;
  if (S.root) S.root.classList.remove('is-grey', 'is-word');
  setGrey(sim, false);
}

function finish(sim) {
  if (!S.active) return;
  clear(sim);
  S.active = false;
  S.scale = 1;
  if (S.root) S.root.classList.remove('is-on', 'is-grey', 'is-word');
  setGrey(sim, false);
}

/** Take the screen down now (the game stopped, or the walk ended). */
export function endWasted(sim) {
  finish(sim || S.sim);
}

/** Real time, from the update wrapper; drives the whole timeline. */
function tickReal(sim, dt) {
  if (!S.active) return;
  if (sim.state !== 'flying') return; // paused: the moment waits with the game
  S.t += dt;
  const t = S.t;
  S.scale = t < WASTED.slowFor ? WASTED.slowScale : 1;
  if (t >= WASTED.wordAt && t < WASTED.clearAt && S.root && !S.root.classList.contains('is-word')) S.root.classList.add('is-word');
  if (t >= WASTED.clearAt) clear(sim);
  if (t >= WASTED.endAt) finish(sim);
}

registerExtension({
  id: 'wasted',
  install(sim) {
    S.sim = sim;
    build();
    // The slow motion: every frame's time goes through here.
    if (typeof sim.update === 'function' && !sim._wastedClock) {
      const inner = sim.update;
      sim._wastedClock = true;
      sim.update = function updateWithWastedClock(dt, ...rest) {
        if (S.active) {
          try {
            tickReal(this, dt);
          } catch (e) {
            finish(this);
          }
        }
        return inner.call(this, S.active ? dt * S.scale : dt, ...rest);
      };
    }
  },
  startMode(sim) {
    finish(sim);
  },
  stop(sim) {
    finish(sim);
  },
});

/** For the tests and the console. */
export const wasted = {
  get active() {
    return S.active;
  },
  get count() {
    return S.count;
  },
  get cause() {
    return S.cause;
  },
  get scale() {
    return S.scale;
  },
  get t() {
    return S.t;
  },
  /** The grey and the word have gone. */
  get cleared() {
    return S.cleared;
  },
  get shown() {
    return !!(S.root && S.root.classList.contains('is-on'));
  },
  get wordShown() {
    return !!(S.root && S.root.classList.contains('is-word'));
  },
  get grey() {
    return !!(S.canvas && /grayscale/.test(S.canvas.style.filter || ''));
  },
  get words() {
    return S.sub ? S.sub.textContent : '';
  },
  history: S.history,
};

/**
 * WASTED — "if you get hit by a plane, it says WASTED like yk gta" (the owner).
 *
 * Hit by an aeroplane while you are on foot: the world drains to grey, a
 * second of slow motion, a big WASTED across the screen, and then you are
 * back on your feet beside where it happened. Cartoon: you are flung, you
 * fall flat, you get up. Nothing else.
 *
 *   showWasted(sim, cause, opts)   ->  true if it started, false if one is
 *                                      already running or the game is not on
 *
 *     cause   a word for the tests and the log: 'plane', 'crash', ...
 *     opts    { push: {x, z}   which way (and how hard, m/s) to fling you,
 *               words: 'string' the small line under WASTED }
 *
 * GENERIC ON PURPOSE. runaway.js calls it when your own runaway plane runs you
 * over; the multiplayer team can call it the same way when somebody else's
 * aeroplane does. It does not care what hit you. Not on foot, it still shows
 * (the grey and the word), and there is simply nobody to knock over.
 *
 * THE SLOW MOTION is the frame's time scaled to 0.3 for 1.1 s of real time.
 * main.js's loop calls sim.update(dt) every frame, and the tests call it
 * too, so install() puts a wrapper on the instance that multiplies dt by
 * the current scale — 1 whenever nothing is happening, which is almost always.
 *
 * THE SOUND is two generated tones through the game's own mixer (a low
 * falling "whumm" and a thud): no files, and never louder than a notify chime.
 */

import { registerExtension, extLayer } from '../game/extensions.js';
import { onFoot } from './onfoot.js';
import { groundAt, solidAt, WALK } from './staff/walk.js';
import { heightAt } from '../world/terrain.js';
import * as FootUI from './staff/ui.js';

/** The timeline, in real seconds. */
export const WASTED = {
  greyIn: 0.5,
  slowFor: 1.1,
  slowScale: 0.3,
  wordAt: 0.7,
  holdUntil: 3.0,
  getUpAt: 3.0,
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
.ws-word span { display: block; margin-top: 10px; font: 800 18px/1.3 var(--font, system-ui, sans-serif); color: #fff;
  text-shadow: 0 2px 6px rgba(0,0,0,.8); }
`;

const S = {
  sim: null,
  root: null,
  word: null,
  sub: null,
  active: false,
  t: 0,
  scale: 1,
  cause: '',
  count: 0,
  canvas: null,
  prevControl: null,
  control: null,
  lying: 0,
  gotUp: false,
  at: null,
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

/** A spot to stand, near (x, z), out of anything solid and out of the sea. */
function safeSpotNear(x, z, avoid) {
  const ok = (px, pz) => {
    const h = heightAt(px, pz);
    if (!(h > WALK.deep + 0.1)) return false;
    if (solidAt(px, pz, groundAt(px, pz), WALK.radius + 0.1, onFoot.solids || null)) return false;
    if (avoid && avoid(px, pz)) return false;
    return true;
  };
  if (ok(x, z)) return { x, z };
  for (let r = 1.5; r < 60; r += 1.5) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const px = x + Math.sin(a) * r;
      const pz = z - Math.cos(a) * r;
      if (ok(px, pz)) return { x: px, z: pz };
    }
  }
  return null;
}

/**
 * The moment. See the top of the file. `opts.avoid(x, z)` -> true for places
 * you must not get up in (the runaway plane's path, say).
 */
export function showWasted(sim, cause = 'plane', opts = {}) {
  sim = sim || S.sim;
  if (!sim || S.active || sim.state !== 'flying') return false;
  S.sim = sim;
  build();
  S.active = true;
  S.t = 0;
  S.scale = WASTED.slowScale;
  S.cause = String(cause || 'plane');
  S.count++;
  S.gotUp = false;
  S.lying = 0;
  S.avoid = typeof opts.avoid === 'function' ? opts.avoid : null;
  S.history.push({ cause: S.cause, at: Date.now() });
  if (S.history.length > 10) S.history.shift();
  if (S.sub) S.sub.textContent = opts.words || 'You got hit by a plane. Up you get!';
  if (S.root) S.root.classList.add('is-on', 'is-grey');
  setGrey(sim, true);
  sound(sim);
  // On foot: flung, and nobody moves you until you are up again.
  if (onFoot.active) {
    const w = onFoot.walker;
    S.at = { x: w.x, z: w.z };
    const push = opts.push || { x: 0, z: 0 };
    const k = Math.min(1, 7 / Math.max(0.1, Math.hypot(push.x || 0, push.z || 0)));
    w.vx = (push.x || 0) * k;
    w.vz = (push.z || 0) * k;
    w.vy = 4.2;
    w.air = true;
    S.prevControl = onFoot.control;
    // O does nothing until you are up (onO swallows it: no climbing into
    // the plane that just ran you over while you lie on the runway).
    S.control = { locked: true, wasted: true, prompt: '', onO() {} };
    onFoot.setControl(S.control);
  } else {
    S.at = null;
    S.prevControl = null;
    S.control = null;
  }
  return true;
}

/** Stand back up, beside where it happened. */
function getUp(sim) {
  S.gotUp = true;
  if (!onFoot.active) return;
  const w = onFoot.walker;
  const spot = safeSpotNear(w.x, w.z, S.avoid);
  if (spot) onFoot.place(spot.x, spot.z, w.heading);
  if (onFoot.control === S.control) onFoot.setControl(S.prevControl || null);
  S.control = null;
  S.prevControl = null;
  const m = onFoot.model;
  if (m) {
    m.rotation.x = 0;
    m.rotation.z = 0;
  }
}

function finish(sim) {
  if (!S.active) return;
  if (!S.gotUp) getUp(sim);
  S.active = false;
  S.scale = 1;
  S.lying = 0;
  if (S.root) S.root.classList.remove('is-on', 'is-grey', 'is-word');
  setGrey(sim, false);
}

/** Real time, from the update wrapper; drives the whole timeline. */
function tickReal(sim, dt) {
  if (!S.active) return;
  if (sim.state !== 'flying') return; // paused: the moment waits with the game
  S.t += dt;
  const t = S.t;
  S.scale = t < WASTED.slowFor ? WASTED.slowScale : 1;
  if (t >= WASTED.wordAt && S.root && !S.root.classList.contains('is-word')) S.root.classList.add('is-word');
  if (t >= WASTED.getUpAt && !S.gotUp) {
    getUp(sim);
    if (S.root) S.root.classList.remove('is-grey', 'is-word');
    setGrey(sim, false);
  }
  if (t >= WASTED.endAt) finish(sim);
}

/** Flat on your back while it lasts: after onfoot has posed the walker this frame. */
function poseLying(dt) {
  const m = onFoot.active && onFoot.model;
  if (!m) return;
  const want = S.active && !S.gotUp ? 1 : 0;
  S.lying += (want - S.lying) * Math.min(1, dt * (want ? 7 : 5));
  if (S.lying < 0.01 && !want) return;
  m.rotation.order = 'YXZ';
  m.rotation.x = (Math.PI / 2) * S.lying;
  m.position.y += 0.16 * S.lying;
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
  update(sim, dt) {
    poseLying(dt);
    // Nothing to press while you are down: onfoot.js put its prompt up this
    // frame ("Press O to get in"), and this runs after it.
    if (S.active && !S.gotUp) FootUI.setPrompt('');
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
  get gotUp() {
    return S.gotUp;
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
  history: S.history,
};

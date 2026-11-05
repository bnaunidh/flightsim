/**
 * "SECRET FOUND": the reveal, as a calm title card.
 *
 * Thin letterbox bars ease in, a small line says SECRET FOUND, the plane's
 * name under it and where it was found; two and a half seconds later it
 * eases out. No flash, no shake, no sound effect louder than the game's own
 * soft chime; with prefers-reduced-motion nothing moves at all, it simply
 * appears and goes. pointer-events: none throughout, so it never takes a
 * tap meant for the game, and it is fixed above the HUD but below the menus'
 * own dialogs.
 */

import { extLayer } from '../../game/extensions.js';

const CSS = `
#sec-reveal { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
#sec-reveal[hidden] { display: none !important; }
#sec-reveal .sr-bar { position: absolute; left: 0; right: 0; height: 0; background: #07090c; opacity: 0.9;
  transition: height 0.5s cubic-bezier(.2,.7,.2,1); }
#sec-reveal .sr-bar.top { top: 0; }
#sec-reveal .sr-bar.bot { bottom: 0; }
#sec-reveal.on .sr-bar { height: 10%; }
#sec-reveal .sr-card { position: absolute; left: 50%; bottom: 14%; transform: translateX(-50%);
  width: min(92vw, 560px); text-align: center; opacity: 0; transition: opacity 0.6s ease;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #f4f1e6;
  text-shadow: 0 2px 14px rgba(0, 0, 0, 0.75); }
#sec-reveal.on .sr-card { opacity: 1; }
#sec-reveal .sr-kicker { display: block; font-size: 12px; font-weight: 700; letter-spacing: 0.26em; color: #f2c53d; }
#sec-reveal .sr-name { display: block; margin: 6px 0 4px; font-size: clamp(22px, 4.6vw, 32px); font-weight: 800; letter-spacing: 0.04em; }
#sec-reveal .sr-where { display: block; font-size: 13.5px; font-weight: 600; color: #d6dde7; }
@media (prefers-reduced-motion: reduce) { #sec-reveal .sr-bar, #sec-reveal .sr-card { transition: none; } }
@media (max-width: 620px) { #sec-reveal .sr-card { bottom: 18%; } }
`;

const U = { el: null, t: 0, life: 0, on: false };

function build() {
  if (U.el) return U.el;
  if (typeof document === 'undefined' || !document.createElement || !document.head) return null;
  const st = document.createElement('style');
  st.textContent = CSS;
  document.head.appendChild(st);
  const el = document.createElement('div');
  el.id = 'sec-reveal';
  el.hidden = true;
  el.innerHTML = '<div class="sr-bar top"></div><div class="sr-bar bot"></div>'
    + '<div class="sr-card" role="status" aria-live="polite"><span class="sr-kicker"></span><span class="sr-name"></span><span class="sr-where"></span></div>';
  // Inside the walker's layer (it only ever happens on foot), so it goes off screen with it when paused.
  (document.querySelector('.of-root') || extLayer()).appendChild(el);
  U.el = el;
  return el;
}

/** Show the card for `secs` seconds of game time (update() counts them). */
export function showReveal({ kicker = 'SECRET FOUND', name = '', where = '' }, secs = 3.4) {
  U.t = 0;
  U.life = secs;
  U.text = { kicker, name, where };
  const el = build();
  if (!el) return;
  el.querySelector('.sr-kicker').textContent = kicker;
  el.querySelector('.sr-name').textContent = name;
  el.querySelector('.sr-where').textContent = where;
  el.hidden = false;
  // A frame later, so the bars ease in rather than appear.
  U.on = false;
  el.classList.remove('on');
  // (A timer, not requestAnimationFrame: a hidden tab or a test page never paints.)
  setTimeout(() => {
    if (U.life > 0 && U.t < U.life - 0.6) {
      el.classList.add('on');
      U.on = true;
    }
  }, 30);
}

export function updateReveal(dt) {
  if (!(U.life > 0)) return false;
  U.t += dt;
  if (U.el && U.t > U.life - 0.6 && U.on) {
    U.el.classList.remove('on');
    U.on = false;
  }
  if (U.t >= U.life) {
    U.life = 0;
    if (U.el) U.el.hidden = true;
    return false;
  }
  return true;
}

export function hideReveal() {
  U.life = 0;
  U.on = false;
  if (U.el) {
    U.el.classList.remove('on');
    U.el.hidden = true;
  }
}

export function revealState() {
  return { showing: U.life > 0, t: U.t, text: U.text || null };
}

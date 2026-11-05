/**
 * The switch for the AI traffic: "Other aeroplanes", on unless a kid turns
 * it off (sim.settings.traffic === false, saved with the other settings).
 *
 * The owner: "there's a ton of lag" — so there is a way to have an empty sky
 * and the frames that come with it. Two places, both put there by this file
 * so menus.js need not know (the runaway switch's way, ../runaway.js):
 *
 *   - Free Flight, the Departure tab: a tick box under the fuel, read when
 *     you take off.
 *   - The pause menu: an "✈️ Other aeroplanes" fold with one button, which
 *     takes effect at once — off clears them from the sky, on fills the
 *     airfield the way the start of a flight does.
 *
 * In a multiplayer game the host's traffic is everybody's — the same
 * aeroplanes on every screen (../mpworld.js) — so the host's switch is the
 * lobby's: as the host, off stops it for everybody; as a guest, the button
 * only says so (your own switch waits for your next game of your own).
 */

import { saveSettings } from '../../core/storage.js';

const HINT_PAUSE = 'On: aeroplanes start up, take off, fly round the island and land. The runway is still yours — '
  + 'they hold short or go around while you use it. Off: an empty sky, and a quicker game on a slow computer.';
const HINT_GUEST = 'In a shared game the host’s aeroplanes are everybody’s, so every screen shows the same sky. '
  + 'Your own switch is for your own flights.';

/**
 * On unless switched off — and on Low quality, off unless switched on. Measured on the class-demo
 * path (a 4x CPU, Low): the airfield's traffic adds 70-110 draw calls on the ground (cockpit view
 * 284 against 176), five hitches over 100 ms and 15 MB in the cockpit view, and draw calls are
 * what a Chromebook's GPU runs out of. Low is what a weak computer gets, so it stays as it was.
 */
export function isOn(sim) {
  const s = sim && sim.settings;
  if (s && s.traffic === false) return false;
  if (s && s.traffic !== true && s.quality === 'low') return false;
  return true;
}

function setOn(sim, on) {
  sim.settings = sim.settings || {};
  // On is the default: kept as "not false", so an old save and a new one read the same.
  // On Low it is off unless asked for, so there on has to be written down.
  if (on) {
    if (sim.settings.quality === 'low') sim.settings.traffic = true;
    else delete sim.settings.traffic;
  }
  else sim.settings.traffic = false;
  try {
    saveSettings(sim.settings);
  } catch (e) {
    /* a private window: this session only */
  }
}

/**
 * Put the two switches in (once) and show what they say now. `apply(sim)` is
 * called when the pause-menu one is pressed, to clear or start the traffic
 * there and then. Returns which of the two it found somewhere to go.
 */
/** Whose sky it is now, as last painted: a guest's own switch does not apply (see the header). */
let lastGuest = false;

export function paintTrafficSwitches(sim, apply, { guest = false } = {}) {
  lastGuest = !!guest;
  return { pause: paintPause(sim, apply, lastGuest), free: paintFree(sim) };
}

function paintPause(sim, apply, guest = false) {
  const pause = sim && sim.menus && sim.menus.screens && sim.menus.screens.pause;
  if (!pause || typeof pause.querySelector !== 'function' || typeof document === 'undefined') return false;
  let btn = pause.querySelector('[data-traffic-toggle]');
  if (!btn) {
    const fold = document.createElement('details');
    fold.className = 'pause-fold';
    fold.dataset.trafficFold = '';
    fold.innerHTML = '<summary>✈️ Other aeroplanes</summary>'
      + '<div class="pause-actions"><button data-traffic-toggle></button></div>'
      + `<p class="hint tiny" data-traffic-hint>${HINT_PAUSE}</p>`;
    // After the runaway switch's fold if it is there, else after the view fold.
    const runaway = pause.querySelector('[data-runaway-fold]');
    const view = pause.querySelector('[data-freelook]');
    const after = runaway || (view && view.closest('.pause-fold'));
    if (after && after.parentNode) after.parentNode.insertBefore(fold, after.nextSibling);
    else (pause.querySelector('.pause-card') || pause).appendChild(fold);
    btn = fold.querySelector('[data-traffic-toggle]');
    btn.addEventListener('click', () => {
      setOn(sim, !isOn(sim));
      try {
        if (typeof apply === 'function') apply(sim);
      } catch (e) {
        console.warn('[traffic] the switch could not be applied now', e);
      }
      paintTrafficSwitches(sim, apply, { guest: lastGuest });
      if (sim.hud && sim.hud.notify) sim.hud.notify(isOn(sim) ? 'Other aeroplanes: on' : 'Other aeroplanes: off — the sky is yours', 'info', 2.5);
    });
  }
  const on = isOn(sim);
  // A guest in a shared game: the host's sky is everybody's, and the button says so (and does nothing).
  const text = guest ? 'Other aeroplanes: the host’s' : `Other aeroplanes: ${on ? 'on' : 'off'}`;
  if (btn.textContent !== text) btn.textContent = text;
  btn.classList.toggle('is-on', guest || on);
  btn.setAttribute('aria-pressed', guest || on ? 'true' : 'false');
  btn.disabled = !!guest;
  const hint = pause.querySelector('[data-traffic-hint]');
  const want = guest ? HINT_GUEST : HINT_PAUSE;
  if (hint && hint.textContent !== want) hint.textContent = want;
  return true;
}

function paintFree(sim) {
  const free = sim && sim.menus && sim.menus.screens && sim.menus.screens.free;
  if (!free || typeof free.querySelector !== 'function' || typeof document === 'undefined') return false;
  let box = free.querySelector('[data-traffic-switch]');
  if (!box) {
    const panel = free.querySelector('[data-fpanel="departure"]');
    if (!panel) return false;
    const wrap = document.createElement('div');
    wrap.dataset.trafficSetup = '';
    wrap.innerHTML = '<h3 class="fail-heading">Other aeroplanes</h3>'
      + '<label class="check check-wide"><input type="checkbox" data-traffic-switch>'
      + '<span><strong>AI traffic at the airport</strong>'
      + '<em>Other aeroplanes start up, take off, fly round the island and land. The runway is still yours: '
      + 'they hold short or go around while you use it. Untick it for an empty sky — and a quicker game on a slow computer.</em></span></label>';
    panel.appendChild(wrap);
    box = wrap.querySelector('[data-traffic-switch]');
    box.addEventListener('change', () => {
      setOn(sim, !!box.checked);
      paintPause(sim, null, lastGuest);
    });
  }
  box.checked = isOn(sim);
  return true;
}

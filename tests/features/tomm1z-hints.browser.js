/**
 * Browser check for the Tomm1z video pass, item 9 — THE SPEED READOUT AND
 * FREE LOOK (.claude/devtools/briefs/tomm1z-video.md, 3:38 "where do I see
 * my speed?", 4:43 "I just wish I could move around the camera"), in the
 * real game: the first flight ever says where the speed is and the speed
 * row pulses (ui/hud.js pointAt); the first cockpit view says how to look
 * round; neither is said again; a reset brings them back.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/tomm1z-hints.browser.js check "" 1
 */

export const id = 'tomm1z-hints';

const toasts = () => [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ');

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`tomm1z-hints: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  let seenWas = null;
  try {
    seenWas = localStorage.getItem('islandsim.hints.v1');
  } catch (e) {
    seenWas = null;
  }
  try {
    say('tomm1z-hints: the first flight and the first cockpit view');
    sim.resetHints();
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    sim.step(0.3);
    ok('the first flight says where the speed is', /speed is the top number in the box at the top left/i.test(toasts()), toasts().slice(-240));
    const row = sim.hud.speedValue.closest('.hud-row');
    ok('...and the speed row pulses (is-pointed)', row && row.classList.contains('is-pointed'));
    const rowCss = row && getComputedStyle(row).animationName;
    ok('...with the pulse animation from the stylesheet', rowCss && rowCss !== 'none', rowCss);
    sim.rig.setMode('cockpit');
    sim.step(0.3);
    ok('the first cockpit view says how to look round', /Look round the cockpit/i.test(toasts()), toasts().slice(-300));
    ok('...naming free look, the hat and the numpad snaps (keyboard) or a finger (touch)', sim.touch ? /finger/i.test(toasts()) : /Free look/i.test(toasts()) && /hat/i.test(toasts()) && /Numpad/i.test(toasts()), toasts().slice(-300));
    sim.rig.setMode('chase');
    sim.step(0.2);
    // Again: neither is said twice.
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    sim.step(0.3);
    sim.rig.setMode('cockpit');
    sim.step(0.3);
    ok('a second flight and cockpit view say neither again', !/speed is the top number/i.test(toasts()) && !/Look round the cockpit/i.test(toasts()), toasts().slice(-200));
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem('islandsim.hints.v1') || 'null');
    } catch (e) {
      stored = null;
    }
    ok('both are remembered in localStorage', stored && stored.speedBox && stored.cockpitLook, JSON.stringify(stored));
    ok('pointAt() answers false for a readout it does not have', sim.hud.pointAt('nope') === false);
  } finally {
    try {
      if (seenWas === null) localStorage.removeItem('islandsim.hints.v1');
      else localStorage.setItem('islandsim.hints.v1', seenWas);
    } catch (e) {
      void e;
    }
    sim._hintsSeen = null;
    sim.autoPauseOnHide = autoPause;
    try {
      sim.rig.setMode('chase');
      sim.quitToMenu('main');
    } catch (e) {
      void e;
    }
  }
}

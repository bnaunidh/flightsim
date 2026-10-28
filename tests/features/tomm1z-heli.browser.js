/**
 * Browser check for the Tomm1z video pass, item 7 — HELI
 * (.claude/devtools/briefs/tomm1z-video.md, 8:28: "I'm holding shift because
 * when I let go of shift it just goes down"), in the real game: with the
 * stability assist on, letting go after a climb eases the collective lever
 * to the hover (never the old snap from 100% to 18% inside a second) and the
 * height holds; with the assist off the lever stays exactly where it was
 * left, for the keyboard and for the touch slider's hand-back.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/tomm1z-heli.browser.js check "" 1
 */

export const id = 'tomm1z-heli';

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`tomm1z-heli: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const assistWas = sim.settings.heliAssist;
  try {
    say('tomm1z-heli: the collective after a climb, assist on');
    await sim.startMode('free', { aircraft: 'h145', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
    sim.setHeliAssist(true, false);
    sim.step(1);
    sim.key('ShiftLeft', true);
    sim.step(4);
    sim.key('ShiftLeft', false);
    const alt0 = sim.aircraft.readouts().altFt;
    let minLever = 1;
    let maxDrop = 0;
    let last = sim.input.throttleTarget;
    for (let i = 0; i < 80; i++) {
      sim.step(0.1);
      const v = sim.input.throttleTarget;
      maxDrop = Math.max(maxDrop, last - v);
      last = v;
      minLever = Math.min(minLever, v);
    }
    const alt1 = sim.aircraft.readouts().altFt;
    ok('assist on, let go after a climb: the lever eases, never below 30% on its way to the hover (it snapped to 18%)', minLever >= 0.3, `min ${minLever.toFixed(2)}`);
    ok('...and never more than 4% of travel in a tenth of a second', maxDrop <= 0.04, `max drop per 0.1 s ${maxDrop.toFixed(3)}`);
    ok('...and the height holds', alt1 > alt0 - 40 && Math.abs(sim.aircraft.vel.y) < 3, `${Math.round(alt0)} → ${Math.round(alt1)} ft, vs ${sim.aircraft.vel.y.toFixed(1)} m/s`);

    say('tomm1z-heli: the collective, assist off');
    await sim.startMode('free', { aircraft: 'h145', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 250 });
    sim.setHeliAssist(false, false);
    sim.step(1);
    sim.key('ShiftLeft', true);
    sim.step(2.5);
    sim.key('ShiftLeft', false);
    const set = sim.input.throttleTarget;
    sim.step(5);
    ok('assist off: the lever stays exactly where it was left', Math.abs(sim.input.throttleTarget - set) < 1e-6, `${set.toFixed(2)} → ${sim.input.throttleTarget.toFixed(2)}`);
    // The touch slider: a finger sets it, lifts off, and it stays.
    const touchWas = sim.input.touch;
    sim.input.touch = { throttle: 0.62, dragging: true };
    sim.step(0.5);
    sim.input.touch = { throttle: null, dragging: false };
    sim.step(3);
    ok('...and so does a touch slider\'s setting once the finger lifts', Math.abs(sim.input.throttleTarget - 0.62) < 1e-6, sim.input.throttleTarget.toFixed(2));
    sim.input.touch = touchWas;
  } finally {
    sim.setHeliAssist(assistWas !== false, false);
    sim.autoPauseOnHide = autoPause;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      void e;
    }
  }
}

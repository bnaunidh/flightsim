/**
 * Nobody can declare a mayday (the owner, 2026-11-04: "remove mayday mayday its
 * usless"). main.js braceAvailable() is false for good: the key, the tray and
 * the touch sheet offer nothing, in Free Flight and in a real emergency on a
 * mission, and a mission that used to offer it flies on to its own ending.
 *
 * Radio speech with the word in it stays (Dead Stick's and Both Engines Out's
 * calls, the ditching's): that is story, not the feature.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  const hud = sim.hud;
  const btn = hud.btnBrace;
  const IN = await import('../../src/flight/input.js');
  const COV = await import('../../src/ui/touch-coverage.js');
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  /** The key the mayday had, as a real press through the real input layer, then one frame. */
  const pressKey = () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyL', bubbles: true, cancelable: true }));
    sim.step(1 / 30, 1 / 30);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyL', bubbles: true, cancelable: true }));
  };
  const clearBanner = () => {
    hud.banner.style.display = 'none';
    hud.banner.innerHTML = '';
  };
  const bannerSays = () => (hud.banner.style.display === 'none' ? '' : hud.banner.textContent.trim());
  const shown = (b) => !!b && !b.hidden && getComputedStyle(b).display !== 'none';
  const trayHasBrace = () => {
    hud.setTrayOpen(true);
    const vis = [...hud.tray.querySelectorAll('button')].some((b) => /brace|mayday|emergency/i.test(b.textContent) && shown(b));
    hud.setTrayOpen(false);
    return vis;
  };
  const helpSays = () => {
    sim.hudAction('help');
    const t = hud.controlsCard.textContent;
    hud.hideControls();
    return /Declare an emergency|attempt to land|circle the airport/i.test(t);
  };
  /** Low and coming down hard: what Free Flight used to call "in trouble". */
  const lowAndDescending = () => {
    const ac = sim.aircraft;
    ac.pos.y = ac.pos.y - ac.agl + 230;
    ac.vel.y = -13;
    sim.step(1 / 30, 1 / 30);
    ac.vel.y = Math.min(ac.vel.y, -13);
  };
  /** Every way in, twice over (it used to ask twice): nothing happens, on any of them. */
  const nothing = (name) => {
    clearBanner();
    const running = sim.runner.status;
    const before = sim.mode;
    pressKey();
    pressKey();
    sim.hudAction('brace');
    sim.hudAction('brace');
    sim.step(1 / 30, 1 / 30);
    sim.braceForImpact();
    sim.braceForImpact();
    sim.step(1 / 30, 1 / 30);
    const said = bannerSays();
    r.ok(`mayday gone: ${name}: nothing on offer`, !sim.braceAvailable() && !shown(btn) && !trayHasBrace() && !helpSays() && !('brace' in sim.touchState()) && !shown(hud.emergencyChoice), `tray ${shown(btn)}, touch ${JSON.stringify(sim.touchState().brace)}`);
    r.ok(`mayday gone: ${name}: the key, the tray's action and the call do nothing`, !sim.bracing && !/emergency|mayday/i.test(said) && !sim.autopilot.engaged, `bracing ${sim.bracing}, banner "${said}"`);
    r.ok(`mayday gone: ${name}: the flight carries on`, sim.state === 'flying' && sim.mode === before && sim.runner.status === running, `${sim.state}, ${sim.mode}, ${sim.runner.status}`);
  };

  try {
    r.ok('mayday gone: the keys are out of the registry, so out of Settings → Controls and the H card', !IN.ACTIONS.brace && !IN.ACTIONS.emergencyLand && !IN.ACTIONS.emergencyCircle && !('brace' in sim.input.bindings));
    r.ok('mayday gone: the touch coverage does not list them', !['brace', 'emergencyLand', 'emergencyCircle'].some((a) => a in COV.TOUCH_COVERAGE));

    say('mayday gone: Free Flight');
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0 });
    sim.step(0.3, 1 / 30);
    nothing('Free Flight, high and healthy');
    lowAndDescending();
    nothing('Free Flight, low and descending');
    sim.toggleFailure('engine');
    sim.step(0.2, 1 / 30);
    nothing('Free Flight, engine failed');

    say('mayday gone: a real emergency on a mission');
    await sim.startMode('mission', { id: 'storm' });
    sim.step(0.2, 1 / 30);
    sim.toggleFailure('engine');
    sim.step(0.2, 1 / 30);
    nothing('Storm Approach, engine failed');

    say('mayday gone: the missions that used to offer it');
    await sim.startMode('mission', { id: 'deadstick' });
    sim.step(3.5, 1 / 30);
    r.ok('mayday gone: Dead Stick still loses its engine', !!sim.aircraft.failures.engine);
    nothing('Dead Stick, engine failed');
    await sim.startMode('mission', { id: 'both-engines-out' });
    sim.step(14);
    nothing('Both Engines Out, 14 s in');
    r.ok('mayday gone: no mission asks for it', !sim.runner.def.allowBrace);

    sim.quitToMenu('main');
    r.ok('mayday gone: the menu does not bring the tray button back', btn.hidden);
  } finally {
    sim.autoPauseOnHide = origAuto;
    if (sim.state !== 'menu') sim.quitToMenu('main');
  }
}

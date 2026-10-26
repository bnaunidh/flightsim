/**
 * The fast jets FEEL fast (the owner, 2026-10-25), in the real game:
 *
 *   1. The F-22 flat out, high: the HUD's speed line reads the Mach number
 *      ("Mach 1.xx · supersonic"), and a Skylark's never does.
 *   2. The follow view widens with speed past 250 kt (a few degrees), and
 *      not at all under Reduce motion.
 *   3. The air streaks: on at speed on High graphics, faint (no more than
 *      MAX_ALPHA_REDUCED with Reduce flashing on), one draw call; off on
 *      Low, under Reduce motion, in the Tower view and on a slow aeroplane.
 *   4. The transonic buffet is a small shake, peaked at Mach 1 and gone by
 *      Mach 0.88 / 1.12.
 *
 * `check(sim, r, say)`; every import dynamic.
 */
export async function check(sim, r, say) {
  const SF = await import('../../src/features/speed-feel.js');
  const CAM = await import('../../src/flight/camera.js');
  const { FLASH } = await import('../../src/render/flash-safety.js');
  const log = (m) => { if (say) say(`speed-feel: ${m}`); };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const set = sim.settings || {};
  const origQ = set.quality;
  const origRM = set.reducedMotion;
  const speedWord = () => (sim.hud && sim.hud.speedWord ? sim.hud.speedWord.textContent : '');
  /** Hold the aeroplane level at `tas` m/s for `secs` (its own flight model, re-pinned every step). */
  const hold = (tas, secs, alt = 12000) => {
    const ac = sim.aircraft;
    const n = Math.round(secs * 30);
    for (let i = 0; i < n; i++) {
      ac.pos.y = alt;
      const f = ac.forward ? ac.forward() : null;
      if (f) ac.vel.copy(f).multiplyScalar(tas);
      sim.update(1 / 30);
    }
  };
  try {
    log('F-22, high and fast');
    set.quality = 'high';
    set.reducedMotion = false;
    sim.rig.reducedMotion = false;
    await sim.startMode('free', { aircraft: 'f22', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0 });
    sim.rig.setMode('chase');
    hold(120, 2);
    const slowFov = sim.camera.fov;
    hold(420, 3);
    const word = speedWord();
    r.ok('speed-feel: the F-22 flat out high reads its Mach number, supersonic', /Mach 1\.\d\d · supersonic/.test(word), word);
    const fastFov = sim.camera.fov;
    r.ok('speed-feel: the follow view widens a few degrees with speed', fastFov - slowFov > 3 && fastFov - slowFov < 8, `${slowFov.toFixed(1)} -> ${fastFov.toFixed(1)}`);
    const st = SF.streakState();
    r.ok('speed-feel: air streaks on at speed on High graphics', st.visible && st.opacity > 0.02, JSON.stringify({ v: st.visible, o: st.opacity }));
    r.ok('speed-feel: ...faint (Reduce flashing on: at most MAX_ALPHA_REDUCED), one draw call',
      FLASH.reduce && st.opacity <= SF.MAX_ALPHA_REDUCED + 1e-6 && st.lines && st.lines.isLineSegments && st.lines.geometry.attributes.position.count === SF.COUNT * 2,
      `opacity ${st.opacity.toFixed(3)}`);
    sim.rig.setMode('tower');
    hold(420, 1.5);
    r.ok('speed-feel: none in the Tower view (it stands still)', !SF.streakState().visible);
    sim.rig.setMode('chase');
    hold(420, 1.5);
    set.reducedMotion = true;
    sim.rig.reducedMotion = true;
    hold(420, 1.5);
    const rmFov = sim.camera.fov;
    r.ok('speed-feel: under Reduce motion no streaks and no speed widening', !SF.streakState().visible && rmFov < fastFov - 3, `fov ${rmFov.toFixed(1)}`);
    set.reducedMotion = false;
    sim.rig.reducedMotion = false;
    set.quality = 'low';
    hold(420, 1.5);
    r.ok('speed-feel: none on Low graphics', !SF.streakState().visible);
    set.quality = 'high';

    log('F-22 at night');
    await sim.startMode('free', { aircraft: 'f22', airborne: true, time: 'night', condition: 'clear', windSpeedKts: 0 });
    sim.rig.setMode('chase');
    hold(420, 3);
    const nst = SF.streakState();
    r.ok('speed-feel: at night the streaks are kept faint (NIGHT_SHARE): no glowing speed lines on a black sky',
      !!(sim.weather && sim.weather.isNight) && nst.opacity <= SF.MAX_ALPHA_REDUCED * SF.NIGHT_SHARE + 1e-6,
      `night ${!!(sim.weather && sim.weather.isNight)}, opacity ${nst.opacity.toFixed(3)}`);

    log('Skylark');
    await sim.startMode('free', { aircraft: 'skylark', airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0 });
    sim.rig.setMode('chase');
    sim.step(1.5);
    r.ok('speed-feel: a Skylark: no Mach number, no streaks', !/Mach/.test(speedWord()) && !SF.streakState().visible, speedWord());

    r.ok('speed-feel: the transonic buffet peaks at Mach 1 and is gone by 0.88 and 1.12',
      CAM.machBuffet(1, 200) > 0.03 && CAM.machBuffet(0.87, 200) === 0 && CAM.machBuffet(1.13, 200) === 0 && CAM.machBuffet(1, 60) < CAM.machBuffet(1, 200));
  } finally {
    set.quality = origQ;
    set.reducedMotion = origRM;
    sim.rig.reducedMotion = !!origRM;
    sim.autoPauseOnHide = origAuto;
    try { sim.quitToMenu('main'); } catch (e) { /* */ }
  }
}

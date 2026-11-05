/**
 * missions-fun:heli — the helicopter's fun pass, in the real game.
 *
 * The scripted pilot from heli-missions.browser.js flies the three new
 * missions and one patched mission on the real flight model, the way a child
 * does what the card says. This grades what came back: finished, the twist
 * fired, a score and a medal, the finale took the picture, the medal strip and
 * "What happened" on the debrief. Then the two checkpoints: a fail after one
 * offers "Try again from" and comes back at that step with the clock put back.
 * The six old missions are flown by heli-missions itself, patches on.
 */

import { check as fly } from './heli-missions.browser.js';

const NEW = ['sling-load', 'rig-evac', 'raven-crag'];

export async function check(sim, r, say = () => {}) {
  const Fun = await import('../../src/game/fun-kit.js');
  const { findMission } = await import('../../src/game/missions.js');
  const quiet = { ok: (name, pass, detail) => { if (!pass) r.ok(name, pass, detail); } };

  await fly(sim, quiet, say, { ids: [...NEW, 'covepickup'], fun: Fun });
  const results = (sim.__heliMissionProgress && sim.__heliMissionProgress.results) || [];
  for (const id of [...NEW, 'covepickup']) {
    const rec = results.find((x) => x.id === id);
    r.ok(`heli fun ${id}: flown to the end by doing what it says`, !!rec && rec.ok, rec ? `${rec.status} in ${rec.clock} s: ${rec.trail}${rec.why ? ' — ' + rec.why : ''}` : 'no run');
    if (!rec) continue;
    const medal = Fun.medalFor(findMission(id), rec.score);
    r.ok(`heli fun ${id}: a twist fired and the run earned a medal`, rec.beats.length >= 1 && !!medal, `beats ${rec.beats.join(', ') || 'none'}, score ${rec.score}, ${medal}`);
  }

  // Try again from: rig-evac's first worker, then a fail.
  const origRender = sim.renderer.render;
  sim.renderer.render = () => {};
  try {
    if (sim.switchGame) sim.switchGame('heli');
    await sim.startAnyMission('rig-evac');
    sim.step(0.3);
    const want = sim.runner.def.steps.findIndex((s) => s.checkpoint);
    while (sim.runner.stepIndex < want) sim.runner.skipStep();
    sim.step(1);
    const cp = Fun.checkpoint();
    r.ok('heli fun: the checkpoint is remembered on entering the step', !!cp && cp.stepIndex === want, cp ? cp.label : 'none');
    sim.runner.fail('test: storm');
    sim.step(0.3);
    const again = [...sim.menus.screens.debrief.querySelectorAll('[data-actions] button')].find((b) => /^Try again from/.test(b.textContent));
    r.ok('heli fun: the fail debrief leads with "Try again from"', !!again && again.classList.contains('primary'), again ? again.textContent : 'no button');
    if (again) {
      const at = cp.elapsed;
      again.click();
      for (let i = 0; i < 200 && !(sim.state === 'flying' && sim.runner.status === 'running'); i++) await new Promise((res) => setTimeout(res, 50));
      sim.step(0.2);
      r.ok('heli fun: it comes back from that step, not from the start', !!Fun.resumedFrom() && Fun.resumedFrom().stepIndex === want && sim.runner.stepIndex >= want && sim.runner.elapsed >= at, `step ${sim.runner.stepIndex}, clock ${sim.runner.elapsed.toFixed(1)}`);
    }
  } catch (e) {
    r.ok('heli fun: the checkpoint check ran without throwing', false, String(e && (e.stack || e.message)).slice(0, 500));
  } finally {
    sim.renderer.render = origRender;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      /* the menu is where the next check starts */
    }
  }
}

export default check;

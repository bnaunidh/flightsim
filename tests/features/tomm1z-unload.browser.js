/**
 * Browser check for the Tomm1z video pass, item 2 — Ctrl+W CLOSING THE TAB
 * (.claude/devtools/briefs/tomm1z-video.md, 3:51 and 5:42), in the real
 * game: the leave-page guard is on in a flight and off on the menu; a running
 * mission writes a checkpoint within a few seconds; quitting by choice clears
 * it; a checkpoint left behind (a closed tab) is offered on the main menu as
 * "Resume your mission?", and Resume starts the same mission at the saved
 * step with the aeroplane where it was. The page is never actually unloaded.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/tomm1z-unload.browser.js check "" 1
 */

export const id = 'tomm1z-unload';

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`tomm1z-unload: ${name}`, !!pass, detail);
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const C = await import('../../src/game/checkpoint.js');
  const mapWas = sim.settings.map;
  try {
    say('tomm1z-unload: the guard and the checkpoint');
    ok('on the menu the browser is not asked before leaving', sim.state === 'menu' && sim.unloadGuard() === false, `${sim.state} ${sim.unloadGuard()}`);
    await sim.startMode('mission', { id: 'circuit' });
    sim.step(0.5);
    ok('in a mission flight the browser would be asked first (unloadGuard)', sim.state === 'flying' && sim.unloadGuard() === true);
    // A real beforeunload: the handler sets returnValue and prevents the default.
    const ev = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(ev);
    ok('...a beforeunload event is cancelled (the browser\'s "Leave site?")', ev.defaultPrevented === true, `defaultPrevented ${ev.defaultPrevented} returnValue ${JSON.stringify(ev.returnValue)}`);
    sim.pause();
    ok('...and while paused too', sim.unloadGuard() === true);
    sim.resume();

    // Fly to the second step so there is something to resume to, and let the checkpoint timer run.
    sim.runner.skipStep();
    sim.step(C.EVERY_S + 1);
    const cp = C.loadCheckpoint();
    ok(`a checkpoint is written within ${C.EVERY_S} s of mission flying`, !!cp && cp.missionId === 'circuit' && cp.mode === 'mission', JSON.stringify(cp && { missionId: cp.missionId, stepIndex: cp.stepIndex, steps: cp.steps }));
    ok('...at the step reached, with the aeroplane\'s pose', cp && cp.stepIndex === sim.runner.stepIndex && cp.pose && Array.isArray(cp.pose.pos), cp && JSON.stringify(cp.pose));

    // Leave by choice: nothing to resume.
    const keep = JSON.parse(JSON.stringify(cp));
    sim.quitToMenu('main');
    sim.step(0.2);
    ok('quitting to the menu clears it (a chosen exit is not a closed tab)', C.loadCheckpoint() === null && sim.unloadGuard() === false);
    const card = sim.menus.screens.main.querySelector('[data-resume]');
    ok('...and the menu shows no Resume card', card && card.hidden === true);

    // The closed-tab case: the checkpoint is there at boot. Put it back and ask the menu.
    say('tomm1z-unload: resume');
    // Airborne, somewhere distinct, so the resume is visible in the pose.
    keep.pose.pos = [keep.pose.pos[0] + 600, 380, keep.pose.pos[2] - 400];
    keep.pose.onGround = false;
    keep.pose.vel = [40, 0, -5];
    keep.savedAt = Date.now() - 90 * 1000;
    C.saveCheckpoint(keep);
    const plan = sim.offerResume();
    ok('a fresh checkpoint on the menu is offered: "Resume your mission?"', !!plan && card.hidden === false, JSON.stringify(plan && { stepIndex: plan.stepIndex, name: plan.name }));
    const name = card.querySelector('[data-resume-name]').textContent;
    const where = card.querySelector('[data-resume-where]').textContent;
    ok('...naming the mission and the step', /Island Circuit/i.test(name) && new RegExp(`step ${keep.stepIndex + 1} of ${keep.steps}`).test(where) && /min ago/.test(where), `${name} — ${where}`);
    card.querySelector('[data-act="resume"]').click();
    for (let i = 0; i < 40 && sim.state !== 'flying'; i++) await new Promise((res) => setTimeout(res, 100));
    sim.step(0.5);
    ok('Resume: the same mission is running again', sim.state === 'flying' && sim.mode === 'mission' && sim.runner.def && sim.runner.def.id === 'circuit' && sim.runner.status === 'running', `${sim.state} ${sim.mode} ${sim.runner.def && sim.runner.def.id}`);
    ok('...at the saved step', sim.runner.stepIndex === keep.stepIndex, `${sim.runner.stepIndex} vs ${keep.stepIndex}`);
    const d = Math.hypot(sim.aircraft.pos.x - keep.pose.pos[0], sim.aircraft.pos.z - keep.pose.pos[2]);
    ok('...with the aeroplane where it was (within 60 m after half a second), airborne', d < 60 && !sim.aircraft.onGround, `${d.toFixed(0)} m, onGround ${sim.aircraft.onGround}`);
    ok('...the card is gone and the checkpoint consumed', card.hidden === true);
    const toasts = [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ');
    ok('...and the HUD says so', /Resumed: .*step/i.test(toasts), toasts.slice(-160));

    // A stale one is not offered, and is dropped.
    sim.quitToMenu('main');
    keep.savedAt = Date.now() - C.MAX_AGE_MS - 1000;
    C.saveCheckpoint(keep);
    ok('a checkpoint older than two hours is not offered, and is dropped', sim.offerResume() === null && card.hidden === true && C.loadCheckpoint() === null);
  } finally {
    C.clearCheckpoint();
    if (sim.menus && sim.menus.syncResume) sim.menus.syncResume(null);
    sim.autoPauseOnHide = autoPause;
    try {
      if (sim.state !== 'menu') sim.quitToMenu('main');
      if (sim.settings.map !== mapWas) sim.setMap(mapWas);
    } catch (e) {
      void e;
    }
  }
}

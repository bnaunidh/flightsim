/**
 * Browser check for the Tomm1z video pass, item 2 — Ctrl+W CLOSING THE TAB
 * (.claude/devtools/briefs/tomm1z-video.md, 3:51 and 5:42), in the real
 * game: the leave-page guard is on in a flight and off on the menu; a running
 * mission writes a checkpoint within a few seconds; quitting by choice clears
 * it; a checkpoint left behind (a closed tab) is offered on the main menu as
 * "Resume your mission?", and Resume starts the same mission at the saved
 * step with the aeroplane where it was. A FREE FLIGHT is kept too (owner,
 * 2026-10-30): its checkpoint names the map and the aeroplane, the menu
 * offers "Continue your flight?" / "Start fresh", Continue puts the
 * aeroplane back in the air (or on the ground) where it was, and the last
 * aeroplane flown is the picker's choice for a plain new Free Flight. The
 * page is never actually unloaded.
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

    /* ---- A free flight (owner, 2026-10-30: "if u refresh it should remember ur plane and map") ---- */
    say('tomm1z-unload: free flight');
    const settle = async () => {
      for (let i = 0; i < 40 && sim.state !== 'flying'; i++) await new Promise((res) => setTimeout(res, 100));
      sim.step(0.5);
    };
    const ask = card.querySelector('[data-resume-ask]');
    const goBtn = card.querySelector('[data-act="resume"]');
    const freshBtn = card.querySelector('[data-act="resume-discard"]');
    // On the menu nothing is written.
    sim.step(C.EVERY_S + 1);
    ok('free: nothing is written on the menu', C.loadCheckpoint() === null);
    await sim.startMode('free', { aircraft: 'courier', time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 90, airborne: true, fuel: 0.8, failures: {}, events: {} });
    sim.step(C.EVERY_S + 1);
    const fcp = C.loadCheckpoint();
    ok(`free: a checkpoint is written within ${C.EVERY_S} s of free flying — the map, the aeroplane, the setup, the pose`,
      !!fcp && fcp.mode === 'free' && fcp.map === sim.settings.map && fcp.pose && fcp.pose.aircraft === 'courier' && fcp.pose.onGround === false && fcp.opts && fcp.opts.time === 'day' && fcp.opts.condition === 'clear',
      JSON.stringify(fcp && { mode: fcp.mode, map: fcp.map, aircraft: fcp.pose && fcp.pose.aircraft, onGround: fcp.pose && fcp.pose.onGround }));
    let saved = null;
    try {
      saved = JSON.parse(localStorage.getItem('islandsim.settings.v1') || '{}');
    } catch (e) {
      saved = null;
    }
    ok('free: the aeroplane flown is remembered in the settings for a plain new Free Flight', !!saved && saved.aircraft === 'courier' && saved.map === sim.settings.map, saved && `${saved.aircraft} ${saved.map}`);
    const fkeep = JSON.parse(JSON.stringify(fcp));
    sim.quitToMenu('main');
    sim.step(0.2);
    ok('free: quitting to the menu clears it', C.loadCheckpoint() === null && card.hidden === true);
    // The closed-tab case, in the air.
    fkeep.pose.pos = [fkeep.pose.pos[0] + 500, 420, fkeep.pose.pos[2] - 300];
    fkeep.pose.vel = [45, 0, -3];
    fkeep.savedAt = Date.now() - 2 * 60 * 1000;
    C.saveCheckpoint(fkeep);
    const fplan = sim.offerResume();
    ok('free: a fresh free checkpoint is offered as "Continue your flight?" with Continue / Start fresh (finger-sized)',
      !!fplan && fplan.free === true && card.hidden === false && ask && ask.textContent === 'Continue your flight?' && goBtn.textContent === 'Continue your flight' && freshBtn.textContent === 'Start fresh'
        && goBtn.getBoundingClientRect().height >= 44 && freshBtn.getBoundingClientRect().height >= 44,
      `${ask && ask.textContent} / ${goBtn.textContent} / ${freshBtn.textContent} (${goBtn.getBoundingClientRect().height}px)`);
    const fname = card.querySelector('[data-resume-name]').textContent;
    const fwhere = card.querySelector('[data-resume-where]').textContent;
    ok('free: ...naming the aeroplane and the island, in the air, with the height', /Courier/i.test(fname) && /in the air at [\d,]+ ft over/.test(fwhere) && /min ago/.test(fwhere), `${fname} — ${fwhere}`);
    goBtn.click();
    await settle();
    const fd = Math.hypot(sim.aircraft.pos.x - fkeep.pose.pos[0], sim.aircraft.pos.z - fkeep.pose.pos[2]);
    ok('free: Continue flies the same aeroplane on the same map, in the air where it was', sim.state === 'flying' && sim.mode === 'free' && sim.aircraftType.id === 'courier' && sim.settings.map === fkeep.map && fd < 80 && !sim.aircraft.onGround && sim.aircraft.engineOn,
      `${sim.state} ${sim.mode} ${sim.aircraftType && sim.aircraftType.id} ${fd.toFixed(0)} m onGround ${sim.aircraft.onGround}`);
    ok('free: ...the card is gone and the checkpoint consumed', card.hidden === true);
    const ftoasts = [...document.querySelectorAll('.hud-toast')].map((t) => t.textContent).join(' | ');
    ok('free: ...and the HUD says so', /Continuing your flight/i.test(ftoasts), ftoasts.slice(-160));
    // On the ground, engine off: back on the ground where it stood, engine off.
    sim.quitToMenu('main');
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90, airborne: false, fuel: 1, failures: {}, events: {} });
    sim.step(1);
    sim.aircraft.stopEngine('shutdown');
    sim.step(C.EVERY_S + 1);
    const gcp = C.loadCheckpoint();
    ok('free: on the ground with the engine off, the checkpoint says so', !!gcp && gcp.pose.onGround === true && gcp.engineOn === false, JSON.stringify(gcp && { onGround: gcp.pose.onGround, engineOn: gcp.engineOn }));
    const gkeep = JSON.parse(JSON.stringify(gcp));
    sim.quitToMenu('main');
    gkeep.savedAt = Date.now() - 30 * 1000;
    C.saveCheckpoint(gkeep);
    const gplan = sim.offerResume();
    const gwhere = card.querySelector('[data-resume-where]').textContent;
    ok('free: ...offered as on the ground', !!gplan && /on the ground at/.test(gwhere), gwhere);
    goBtn.click();
    await settle();
    const gd = Math.hypot(sim.aircraft.pos.x - gkeep.pose.pos[0], sim.aircraft.pos.z - gkeep.pose.pos[2]);
    ok('free: Continue puts it back on the ground where it stood, engine off', sim.state === 'flying' && sim.aircraftType.id === 'skylark' && sim.aircraft.onGround && !sim.aircraft.engineOn && gd < 20, `${gd.toFixed(1)} m onGround ${sim.aircraft.onGround} engine ${sim.aircraft.engineOn}`);
    // Start fresh drops it.
    sim.quitToMenu('main');
    C.saveCheckpoint({ ...gkeep, savedAt: Date.now() });
    sim.offerResume();
    freshBtn.click();
    ok('free: Start fresh drops the checkpoint and hides the card', C.loadCheckpoint() === null && card.hidden === true);
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

/**
 * A race alone stops its clock while the game is paused or in another tab —
 * run by tests/selftest.js through tests/features/index.js (CHECKS), or by
 * hand with .claude/devtools/briefs/one-check.mjs.
 *
 * The race clock (features/race.js now()) ran on real time, so a pause in
 * the middle of a solo race went on the race's time, and the grid's 3-2-1
 * ran out behind the pause card. Here, in the Ring Rally alone:
 *
 *   1. paused on the grid for longer than the grid lasts: still on the grid
 *      after Resume, and the count not run on;
 *   2. paused mid-race for 1.5 s of real time: the race's time moved by no
 *      more than the frames around it;
 *   3. the tab hidden (no pause, the way a game without auto-pause is) for
 *      1.2 s: the same;
 *   4. the host's time (the one the results and the best time keep) and the
 *      racer's own clock still agree, so a finish is judged on the time the
 *      racer saw; and Leave race still ends it, with no errors.
 */
import * as race from '../../src/features/race.js';
import * as RR from '../../src/features/race/rules.js';
import { multiplayer as mp } from '../../src/features/multiplayer.js';

export async function check(sim, r) {
  const ok = (name, pass, detail = '') => r.ok(`race pause: ${name}`, pass, typeof detail === 'string' ? detail : JSON.stringify(detail));
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  const DT = 1 / 15;
  const errs = [];
  const onErr = (e) => errs.push(String(e.message));
  window.addEventListener('error', onErr);
  const frames = async (n, ms = 0) => { for (let i = 0; i < n; i++) { sim.update(DT); if (ms) await sleep(ms); } };
  async function until(fn, maxMs = 30000, stepMs = 40) {
    const t0 = performance.now();
    for (;;) {
      let v = null;
      try { v = fn(); } catch (e) { v = null; }
      if (v) return v;
      if (performance.now() - t0 > maxMs) return null;
      sim.update(DT);
      await sleep(stepMs);
    }
  }
  const D = () => race.raceDebug();
  try {
    if (mp.role) mp.leave('left');
    mp.install(sim);
    await race.raceAlone(sim, 'ring-rally');
    const grid = await until(() => { const s = race.raceState(); return s && s.s === RR.S.grid && sim.state === 'flying' ? s : null; }, 60000);
    await frames(2, 20);

    // 1. Paused on the grid, longer than the grid lasts.
    const g0 = D().t;
    sim.pause();
    const paused = sim.state === 'paused';
    await sleep(RR.GRID_MS + 600);
    const gHeld = Math.round(D().t - g0);
    const stillGrid = race.raceState() && race.raceState().s === RR.S.grid;
    sim.resume();
    await frames(2, 20);
    ok('paused on the grid for longer than the grid lasts: still on the grid after Resume, the count held',
      !!grid && paused && stillGrid && race.raceState().s === RR.S.grid && gHeld < 250, { paused, stillGrid, gHeld });

    const go = await until(() => { const s = race.raceState(); return s && s.s === RR.S.go ? s : null; }, 12000, 30);
    await frames(6, 30);
    const L = D().L;

    // 2. Paused mid-race.
    const a0 = D().t - L.t0;
    const r0 = performance.now();
    sim.pause();
    await sleep(1500);
    sim.resume();
    await frames(2, 15);
    const a1 = D().t - L.t0;
    const realP = Math.round(performance.now() - r0);
    const gainP = Math.round(a1 - a0);
    ok('paused mid-race for 1.5 s: the race time moved by the frames either side, not the pause', !!go && L.t0 > 0 && realP >= 1500 && gainP < 300, { realP, gainP });

    // 3. In another tab, not paused (rAF stops; the race's own timer still ticks).
    const b0 = D().t - L.t0;
    const r1 = performance.now();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    let hidGain = 0;
    try {
      const h0 = D().t;
      await sleep(1200);
      hidGain = Math.round(D().t - h0);
    } finally {
      delete document.hidden;
    }
    await frames(2, 15);
    const b1 = D().t - L.t0;
    const realH = Math.round(performance.now() - r1);
    const gainH = Math.round(b1 - b0);
    ok('in another tab for 1.2 s: the race clock held there too', document.hidden === false && realH >= 1200 && hidGain < 50 && gainH < 300, { realH, hidGain, gainH });

    // 4. The host's time and the racer's still one clock; Leave race still ends it.
    const d = D();
    const host = d.t - d.G.solo.goAt;
    const mine = d.t - d.L.t0;
    ok('the time the host keeps (results, best time) is the racer\'s own clock, pauses left out of both', Math.abs(host - mine) < 60 && mine < realP + realH, { host: Math.round(host), mine: Math.round(mine), clockLost: Math.round(d.CLK.lost) });
    const leave = document.querySelector('.race-solobar [data-race-leave]');
    if (leave) leave.click();
    await frames(3, 10);
    const st = race.raceState();
    ok('Leave race still ends it', !!leave && st && st.s === RR.S.done && st.out.includes(0), st && { s: st.s, out: st.out });
  } catch (e) {
    ok('the run finished', false, String(e && e.stack || e).slice(0, 500));
  } finally {
    if (sim.state === 'paused') sim.resume();
    window.removeEventListener('error', onErr);
  }
  ok('no errors on the page', errs.length === 0, errs.slice(0, 3).join(' | '));
}

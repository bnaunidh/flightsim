/**
 * Browser check for the full-screen LIVE map (src/features/livemap/):
 *
 *   node .claude/devtools/briefs/one-check.mjs <url> ./tests/features/livemap.browser.js check "" 1
 *
 *   - 5 opens it on an ordinary map (Kestrel), in a Free Flight; the game is
 *     NOT paused (no pause screen), and SIM TIME ADVANCES WHILE THE MAP IS
 *     OPEN: the aeroplane flies on, the LIVE readout changes, your arrow moves
 *     across the chart
 *   - the keys still fly the plane with it open (A rolls it left)
 *   - Esc closes it (and does not pause), 5 again closes it, the ✕ closes it,
 *     a tap on the minimap opens it
 *   - an engine fire (an urgent warning) closes it, with a toast saying why
 *   - the chart: built in the worker, fills its panel edge to edge, zooms
 *     with the wheel round the cursor; level of detail — zoomed out the fixes
 *     are hidden, close in the runway numbers (09, 27) are drawn
 *   - it costs the frame little: stepping with it open is not much slower
 *     than with it shut
 * The map, the controls and Free Flight are put back afterwards.
 */

export const id = 'livemap';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  say && say('livemap: the full-screen live map');
  let L;
  try {
    L = await import('../../src/features/livemap/livemap.js');
  } catch (err) {
    r.ok('livemap: the module loads', false, String(err && err.message));
    return;
  }
  const LM = sim.liveMap;
  if (!LM) {
    r.ok('livemap: sim.liveMap is installed', false, 'missing');
    return;
  }
  const wasAutoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const run = (s) => {
    const n = Math.max(1, Math.round(s * 60));
    for (let i = 0; i < n; i++) sim.step(1 / 60);
  };
  const key = (code, down = true) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true, cancelable: true }));
  const tap = (code) => {
    key(code, true);
    key(code, false);
  };
  const root = () => document.querySelector('.lm');
  const shown = () => !!root() && !root().hidden;
  const lastToast = () => {
    const t = [...document.querySelectorAll('.hud-toast')];
    return t.map((x) => x.textContent).join(' | ');
  };
  try {
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    run(0.5);
    if (sim.minimap && !sim.minimap.visible) sim.minimap.toggle(true);

    /* ---- 5 opens it, and nothing pauses ---- */
    tap('Digit5');
    run(1 / 60);
    const pauseScreen = sim.menus && sim.menus.screens && sim.menus.screens.pause;
    r.ok('livemap: 5 opens the full-screen map on an ordinary map (Kestrel), and the game is not paused', shown() && LM.isOpen() && sim.state === 'flying' && (!pauseScreen || pauseScreen.hidden !== false || !pauseScreen.offsetParent),
      `open ${LM.isOpen()} state ${sim.state}`);

    const ac = sim.aircraft;
    const p0 = ac.pos.clone();
    const clock0 = L.__livemap.S.clock;
    const read0 = document.querySelector('[data-lm-read]').textContent;
    const v0 = LM.view();
    const ax0 = v0.W / 2 + (ac.pos.x - v0.cx) * v0.s;
    run(3);
    const v1 = LM.view();
    const ax1 = v1.W / 2 + (ac.pos.x - v1.cx) * v1.s;
    const moved = ac.pos.distanceTo(p0);
    const read1 = document.querySelector('[data-lm-read]').textContent;
    r.ok('livemap: sim time advances while the map is open — the aeroplane flies on, the LIVE readout and your arrow move',
      sim.state === 'flying' && moved > 100 && L.__livemap.S.clock - clock0 > 2.5 && /ft/.test(read1) && /kt/.test(read1) && Math.abs(ax1 - ax0) > 2 && !!document.querySelector('.lm-live .lm-dot'),
      `${moved.toFixed(0)} m in 3 s, map clock +${(L.__livemap.S.clock - clock0).toFixed(1)} s, arrow ${ax0.toFixed(0)} → ${ax1.toFixed(0)} px, "${read0}" → "${read1}"`);

    // The keys still fly it.
    const bank0 = ac.bankAngleDeg();
    key('KeyA', true);
    run(1.2);
    key('KeyA', false);
    const bank1 = ac.bankAngleDeg();
    run(0.1);
    r.ok('livemap: the keys still fly the plane with the map open (A rolls it left)', LM.isOpen() && bank1 < bank0 - 8, `bank ${bank0.toFixed(1)} → ${bank1.toFixed(1)}`);
    // Level it again.
    if (sim.toggleAutopilot) {
      sim.toggleAutopilot(true);
      run(4);
      sim.toggleAutopilot(false);
    }

    /* ---- the chart ---- */
    const t0 = performance.now();
    while (performance.now() - t0 < 8000) {
      run(0.1);
      await wait(150);
      if (LM.chart() && LM.chart().readyFor(LM.view())) break;
    }
    const C = LM.chart();
    const cv = document.querySelector('.lm-cv');
    const panel = document.querySelector('.lm-panel');
    const cr = cv.getBoundingClientRect();
    const pr = panel.getBoundingClientRect();
    r.ok('livemap: the chart is built (in the worker) and fills its panel edge to edge',
      C.stats.built > 0 && Math.abs(cr.width - pr.width) < 1.5 && Math.abs(cr.height - pr.height) < 1.5 && cv.width >= cr.width,
      `${C.stats.built} tiles (${C.stats.worker} by the worker, ${C.stats.main} here), canvas ${cr.width.toFixed(0)}×${cr.height.toFixed(0)} in a ${pr.width.toFixed(0)}×${pr.height.toFixed(0)} panel`);
    const zoomed = LM.view().s;
    cv.dispatchEvent(new WheelEvent('wheel', { deltaY: -400, clientX: cr.left + cr.width / 2, clientY: cr.top + cr.height / 2, bubbles: true, cancelable: true }));
    run(0.6);
    r.ok('livemap: the wheel zooms in, smoothly (it eases there over a few frames)', LM.view().s > zoomed * 1.6, `${zoomed.toFixed(4)} → ${LM.view().s.toFixed(4)} px/m`);
    // Level of detail: zoomed right out, no fixes; right in on the field, the runway numbers.
    const placed = () => L.__livemap.S.placer.items.filter((it) => it.placed).map((it) => it.text);
    const field = LM.places().airports[0];
    const [n1, n2] = field.runways[0].ident.split('/');
    LM.setView(field.x, field.z, 1 / 400);
    run(0.2);
    const outLabels = placed();
    const fixNames = LM.places().fixes.map((f) => f.name);
    LM.setView(field.x, field.z, 1 / 4);
    run(0.2);
    const inLabels = placed();
    r.ok(`livemap: level of detail — zoomed out the fixes are hidden; close in, the runway numbers ${n1} and ${n2} are drawn`,
      !outLabels.some((t) => fixNames.includes(t)) && inLabels.includes(n1) && inLabels.includes(n2),
      `${field.code} · out: ${outLabels.slice(0, 8).join(', ')} · in: ${inLabels.slice(0, 10).join(', ')}`);

    /* ---- what it costs ---- */
    const cost = (n) => {
      const a = performance.now();
      for (let i = 0; i < n; i++) sim.step(1 / 60);
      return (performance.now() - a) / n;
    };
    LM.setView(ac.pos.x, ac.pos.z, 1 / 25);
    run(0.5);
    const open = cost(90);
    LM.close();
    run(0.2);
    const shut = cost(90);
    r.ok('livemap: open, a frame costs little more than with it shut (the chart is cached tiles, the rest is vectors)', open - shut < 6 || open < shut * 1.5,
      `${shut.toFixed(2)} ms shut, ${open.toFixed(2)} ms open`);

    /* ---- closing it ---- */
    tap('Digit5');
    run(0.1);
    const opened = LM.isOpen();
    tap('Escape');
    run(0.1);
    r.ok('livemap: Esc closes it — and does not pause the game', opened && !LM.isOpen() && !shown() && sim.state === 'flying', `opened ${opened}, open now ${LM.isOpen()}, state ${sim.state}`);
    tap('Digit5');
    run(0.1);
    const again = LM.isOpen();
    tap('Digit5');
    run(0.1);
    r.ok('livemap: 5 again closes it', again && !LM.isOpen() && sim.state === 'flying', `${again} → ${LM.isOpen()}`);
    sim.minimap.el.click();
    run(0.1);
    const byTap = LM.isOpen();
    document.querySelector('.lm [data-lm="close"]').click();
    run(0.1);
    r.ok('livemap: a tap on the minimap opens it, the ✕ closes it', byTap && !LM.isOpen(), `tap ${byTap}, after ✕ ${LM.isOpen()}`);

    /* ---- an urgent warning closes it ---- */
    LM.open();
    run(0.1);
    if (sim.warnings && sim.warnings.startFire) sim.warnings.startFire();
    run(1);
    r.ok('livemap: an engine fire closes it, with a toast saying why', !LM.isOpen() && LM.closedBy() === 'engineFire' && /Map closed — ENGINE FIRE/.test(lastToast()), `open ${LM.isOpen()}, closed by ${LM.closedBy()}; ${lastToast().slice(-120)}`);
    // ...and while it burns, 5 does not put the whole screen up for one frame (a flash per press, the checker w18).
    const lmRoot = document.querySelector('.lm');
    let flashed = false;
    // Any change to its `hidden` at all (shown, then shut again) is the flash.
    const mo = new MutationObserver((recs) => {
      if (recs.length) flashed = true;
    });
    if (lmRoot) mo.observe(lmRoot, { attributes: true, attributeFilter: ['hidden'] });
    const reopened = LM.open();
    run(0.1);
    if (mo.takeRecords().length) flashed = true;
    mo.disconnect();
    await new Promise((res) => setTimeout(res, 0));
    r.ok('livemap: during an urgent warning it will not open (no one-frame flash), and says why', sim.warnings.active().includes('engineFire') && reopened === false && !flashed && !LM.isOpen() && /Map closed — ENGINE FIRE/.test(lastToast()),
      `open() → ${reopened}, shown for a frame ${flashed}`);
    if (sim.warnings && sim.warnings.reset) sim.warnings.reset();
  } catch (err) {
    r.ok('livemap: the check ran to the end', false, String((err && err.stack) || err).slice(0, 400));
  } finally {
    try {
      LM.close();
    } catch (e) {
      /* already shut */
    }
    sim.autoPauseOnHide = wasAutoPause;
  }
}

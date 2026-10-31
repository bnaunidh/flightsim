/**
 * THE FRAME BUDGET, in the page (ui/frame-budget.js). A Free Flight in the
 * Skylark, airborne, chase camera, the HUD and the minimap up, 120 LIVE
 * frames of the game's own update at 60 Hz with the DOM's lookups and
 * layout reads counted:
 *
 *   1. element lookups (querySelector, querySelectorAll, getElementById,
 *      closest) from a per-frame path: at most one in ten frames;
 *   2. layout reads (getBoundingClientRect, getClientRects, offsetWidth,
 *      offsetHeight, clientWidth, clientHeight, getComputedStyle): under
 *      half a read a frame (the lanes and the right-hand stack keep a slow
 *      fallback; the old code read five to eight a frame);
 *   3. DOM writes that change nothing (the same textContent again): under
 *      one in five frames (the autopilot chip wrote four a frame);
 *   4. the minimap is drawn at MINIMAP_HZ, not every frame: 60 live frames
 *      at 60 Hz draw it at most MINIMAP_HZ + 2 times;
 *   5. the HUD's numbers are written at HUD_TEXT_HZ on live frames and on
 *      EVERY frame of a driven check (sim.step / sim.update without the
 *      loop), so nothing a test measures moves.
 *
 * Every check here fails on v75.8.
 *
 *   node one-check.mjs 'http://127.0.0.1:PORT/?mute=1' ./tests/features/frame-budget.browser.js check "" 1
 */
export const id = 'frame-budget';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function check(sim, r, say) {
  const log = (m) => { if (say) say(`frame budget: ${m}`); };
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const FB = await import('../../src/ui/frame-budget.js');
  const liveFrames = (n, dt = 1 / 60) => {
    for (let i = 0; i < n; i++) {
      sim._liveFrame = true;
      try {
        sim.update(dt);
      } finally {
        sim._liveFrame = false;
      }
    }
  };

  /** Count the DOM's lookups, layout reads and same-value writes over `n` live frames. */
  const count = (n) => {
    const counts = { lookup: 0, layout: 0, sameWrite: 0, write: 0 };
    const sites = {};
    const site = (k) => {
      const st = (new Error().stack || '').split('\n').slice(3, 5).map((l) => l.replace(/^\s+at\s+/, '').replace(/https?:\/\/[^/]+/, '').replace(/\?[^:)]*/, '')).join(' < ');
      sites[`${k} ${st}`] = (sites[`${k} ${st}`] || 0) + 1;
    };
    const undo = [];
    const wrapFn = (proto, name, k) => {
      const o = proto[name];
      if (!o) return;
      proto[name] = function (...a) { counts[k]++; site(`${k}:${name}`); return o.apply(this, a); };
      undo.push(() => { proto[name] = o; });
    };
    const wrapGet = (proto, name, k) => {
      const d = Object.getOwnPropertyDescriptor(proto, name);
      if (!d || !d.get) return;
      Object.defineProperty(proto, name, { ...d, get() { counts[k]++; site(`${k}:${name}`); return d.get.call(this); } });
      undo.push(() => Object.defineProperty(proto, name, d));
    };
    wrapFn(Element.prototype, 'querySelector', 'lookup');
    wrapFn(Element.prototype, 'querySelectorAll', 'lookup');
    wrapFn(Document.prototype, 'querySelector', 'lookup');
    wrapFn(Document.prototype, 'querySelectorAll', 'lookup');
    wrapFn(Document.prototype, 'getElementById', 'lookup');
    wrapFn(Element.prototype, 'closest', 'lookup');
    wrapFn(Element.prototype, 'getBoundingClientRect', 'layout');
    wrapFn(Element.prototype, 'getClientRects', 'layout');
    wrapFn(window, 'getComputedStyle', 'layout');
    wrapGet(HTMLElement.prototype, 'offsetWidth', 'layout');
    wrapGet(HTMLElement.prototype, 'offsetHeight', 'layout');
    wrapGet(Element.prototype, 'clientWidth', 'layout');
    wrapGet(Element.prototype, 'clientHeight', 'layout');
    const td = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    Object.defineProperty(Node.prototype, 'textContent', {
      ...td,
      set(v) {
        counts.write++;
        if (td.get.call(this) === String(v)) { counts.sameWrite++; site('same'); }
        return td.set.call(this, v);
      },
    });
    undo.push(() => Object.defineProperty(Node.prototype, 'textContent', td));
    try {
      liveFrames(n);
    } finally {
      for (const u of undo) u();
    }
    const top = Object.entries(sites).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${v}x ${k}`).join(' | ');
    return { ...counts, n, top };
  };

  try {
    log('a free flight');
    await sim.startMode('free', { aircraft: 'skylark', airborne: true, time: 'day', condition: 'clear' });
    sim.rig.setMode('chase');
    if (sim.minimap && !sim.minimap.visible && sim.hudAction) sim.hudAction('minimap');
    // Let the first seconds settle: the chart builds, the lanes and the stack measure once, toasts come and go.
    liveFrames(240);
    await sleep(120);
    liveFrames(60);
    await sleep(50);

    const c = count(180);
    const per = (k) => c[k] / c.n;
    r.ok(
      'frame budget: a per-frame path looks no element up (querySelector / getElementById / closest): at most 1 in 10 frames',
      per('lookup') <= 0.1,
      `${c.lookup} lookups in ${c.n} frames (${per('lookup').toFixed(2)}/frame): ${c.top}`
    );
    r.ok(
      'frame budget: a per-frame path reads no layout size (getBoundingClientRect / getClientRects / offsetWidth…): under 0.5 a frame',
      per('layout') < 0.5,
      `${c.layout} layout reads in ${c.n} frames (${per('layout').toFixed(2)}/frame): ${c.top}`
    );
    r.ok(
      'frame budget: the DOM is written only when a value changed: same-value textContent writes under 0.2 a frame',
      per('sameWrite') < 0.2,
      `${c.sameWrite} same-value writes of ${c.write} writes in ${c.n} frames: ${c.top}`
    );

    /* ---- 4. the minimap's rate ---- */
    log('the minimap rate');
    const mm = sim.minimap;
    let draws = 0;
    const origFrame = mm.frame;
    mm.frame = function (...a) { draws++; return origFrame.apply(this, a); };
    try {
      liveFrames(60);
    } finally {
      mm.frame = origFrame;
    }
    r.ok(
      `frame budget: the minimap is drawn at ${FB.MINIMAP_HZ} Hz, not every frame (60 live frames at 60 Hz: ${draws} draws)`,
      mm.visible && draws >= FB.MINIMAP_HZ * 0.6 && draws <= FB.MINIMAP_HZ + 2,
      `visible ${mm.visible}, ${draws} draws in 60 frames, MINIMAP_HZ ${FB.MINIMAP_HZ}`
    );

    /* ---- 5. the HUD's numbers: 20 Hz live, every frame driven ---- */
    log('the HUD rate');
    const hv = sim.hud.hdgValue;
    const tdd = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
    let hdgWrites = 0;
    Object.defineProperty(Node.prototype, 'textContent', { ...tdd, set(v) { if (this === hv) hdgWrites++; return tdd.set.call(this, v); } });
    // The heading's change gate is opened before every frame, so the readout
    // is written on every frame the numbers block RUNS: 60 of 60 for a panel
    // that runs every frame, HUD_TEXT_HZ worth for one that keeps the budget.
    const forced = (n, live) => {
      hdgWrites = 0;
      for (let i = 0; i < n; i++) {
        sim.hud.lastValues.hdg = -1;
        if (live) liveFrames(1);
        else sim.update(1 / 60); // a driven check's clock: not live
      }
      return hdgWrites;
    };
    let liveWrites;
    let drivenWrites;
    try {
      liveWrites = forced(60, true);
      drivenWrites = forced(60, false);
    } finally {
      Object.defineProperty(Node.prototype, 'textContent', tdd);
    }
    r.ok(
      `frame budget: the heading readout is written ${FB.HUD_TEXT_HZ} times a second on live frames (60 at 60 Hz: ${liveWrites}), and on every frame of a driven check (${drivenWrites})`,
      liveWrites <= FB.HUD_TEXT_HZ + 2 && liveWrites >= FB.HUD_TEXT_HZ - 2 && drivenWrites === 60,
      `live ${liveWrites} writes / 60 frames, driven ${drivenWrites} / 60, HUD_TEXT_HZ ${FB.HUD_TEXT_HZ}`
    );
  } finally {
    sim.override = null;
    sim.autoPauseOnHide = origAuto;
    try { sim.quitToMenu('main'); } catch (e) { /* already */ }
  }
}

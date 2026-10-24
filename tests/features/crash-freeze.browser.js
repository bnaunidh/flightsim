/**
 * Browser checks for the crash FREEZE (the owner, 2026-10-17: "everytime i
 * crash on any device theres a huge freeze"). The GM measured the first
 * sim.step() after a crash at 775-1,568 ms on live v69. Two things did it:
 *
 *   1. wreck.js's firelight sat on the HIDDEN wreck group. Showing it on the
 *      crash frame changed the number of point lights, and three.js
 *      recompiled every lit shader in the world (144 materials) at once.
 *      The light now lives on the scene at zero intensity (game/wreck.js),
 *      and the crash's own three particle shaders are compiled on the first
 *      frame of a flight, not on the crash (features/breakup.js warmShaders).
 *   2. breakModel() surveyed and classified every triangle of the aeroplane
 *      on the crash frame. The survey is now built a few milliseconds a frame
 *      while you fly (the zone cache), so the crash only plans and splits.
 *
 * Five aircraft — small, airliner, jet, helicopter, big cargo — each crashed
 * cold on a fresh flight:
 *   - the lights the renderer sees are the same before and after;
 *   - not one material's shader program changes on the crash;
 *   - the first render after the crash compiles nothing new;
 *   - the zone cache was ready before the crash, built within a few seconds
 *     of the spawn, and the crash used it;
 *   - the crash frame (the crash call plus the first update) is under 50 ms
 *     on an unloaded machine. The headless Chrome these run in shares a Mac
 *     with whatever else is going on, so the bound scales with a fixed
 *     calibration loop measured right before each crash (10 ms = unloaded),
 *     and the raw numbers are reported either way.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export async function check(sim, r, say) {
  let bu;
  try {
    bu = await import('../../src/features/breakup.js');
  } catch (err) {
    r.ok('crash-freeze: the modules load', false, String(err && err.message));
    return;
  }
  const D = () => bu.breakupDebug();
  const origAuto = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const origAircraft = sim.aircraftType ? sim.aircraftType.id : 'skylark';
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const renderer = sim.renderer;
  const render = () => renderer.render(sim.scene, sim.camera);

  const fly = async (id) => {
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: id });
    sim.step(0.3);
    noDebrief();
    if (!sim.aircraftType || sim.aircraftType.id !== id) throw new Error(`flying ${sim.aircraftType && sim.aircraftType.id}, not ${id}`);
  };
  /** The lights the renderer will count, as it counts them (visible, by type). */
  const lightsSeen = () => {
    const out = [];
    sim.scene.traverseVisible((o) => {
      if (o.isLight) out.push(o.type);
    });
    return out.sort().join(',');
  };
  /** Every material's shader program key, as the renderer has it now. */
  const programKeys = () => {
    const m = new Map();
    sim.scene.traverse((o) => {
      const ms = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
      for (const mat of ms) {
        const pr = renderer.properties.get(mat);
        if (pr && pr.currentProgram) m.set(mat, pr.currentProgram.cacheKey);
      }
    });
    return m;
  };
  /** A fixed bit of arithmetic: about 10 ms on an unloaded laptop, more when the machine is busy. */
  const calibrate = () => {
    const t = performance.now();
    let x = 0;
    for (let i = 0; i < 3e6; i++) x += Math.sqrt(i) * 1e-7;
    return performance.now() - t + (x > 1e12 ? 1 : 0);
  };
  /** The median of twenty ordinary updates with nothing broken: about 2 ms unloaded. */
  const idleMedian = () => {
    const ms = [];
    for (let i = 0; i < 20; i++) {
      const t = performance.now();
      sim.update(1 / 60);
      ms.push(performance.now() - t);
    }
    ms.sort((a, b) => a - b);
    return ms[10];
  };
  /** A program compiled on the crash that is only the shadow pass's depth variant for a piece (small, and not a lit material). */
  const depthOnly = (progs) => progs.every((p) => /^depth,/.test(String(p.cacheKey)));

  const TYPES = [
    ['skylark', 'a small trainer'],
    ['a380', 'an airliner'],
    ['tempest', 'a jet'],
    ['harrier', 'a helicopter'],
    ['meridian', 'a big cargo turboprop'],
  ];
  const rows = [];
  let worstFrame = 0;
  let worstBound = 0;
  let worstCacheFrames = 0;
  let worstCacheStep = 0;
  for (const [id, what] of TYPES) {
    say(`crash-freeze: ${id}`);
    try {
      await fly(id);
    } catch (err) {
      r.ok(`crash-freeze: ${what} (${id}) can be flown`, false, String(err && err.message));
      continue;
    }
    // The cache builds itself in the background: count the frames until it is ready, and the dearest of them.
    let frames = 0;
    let dearest = 0;
    while (!D().zoneCache.ready && frames < 900) {
      const t = performance.now();
      sim.update(1 / 60);
      dearest = Math.max(dearest, performance.now() - t);
      frames++;
    }
    const zc = { ...D().zoneCache };
    // The spawn's own settling frames (sim.step above) usually finish the build before this loop
    // runs, so the build's frames and its dearest frame come from the cache itself.
    worstCacheFrames = Math.max(worstCacheFrames, frames + (zc.frames || 0));
    worstCacheStep = Math.max(worstCacheStep, dearest, zc.worst || 0);
    render();
    const lights0 = lightsSeen();
    const keys0 = programKeys();
    const programs0 = new Set(renderer.info.programs);
    const warms0 = D().stats.warms || 0;
    const idle = idleMedian();
    const calib = calibrate();
    // THE CRASH FRAME: the crash itself (the break-up runs inside it) and the first update after it.
    const t0 = performance.now();
    sim.aircraft.crash('Crash-freeze check');
    sim.update(1 / 60);
    const frameMs = performance.now() - t0;
    noDebrief();
    const plan = D().stats.lastPlan || {};
    // The frames after it, and the first render.
    let tail = 0;
    for (let i = 0; i < 10; i++) {
      const t = performance.now();
      sim.update(1 / 60);
      tail = Math.max(tail, performance.now() - t);
    }
    noDebrief();
    const tr = performance.now();
    render();
    const renderMs = performance.now() - tr;
    const lights1 = lightsSeen();
    const keys1 = programKeys();
    let changed = 0;
    for (const [mat, k] of keys0) if (keys1.has(mat) && keys1.get(mat) !== k) changed++;
    const fresh = renderer.info.programs.filter((p) => !programs0.has(p));
    // 50 ms unloaded; scaled by how slow THIS machine is right now (the arithmetic loop against 10 ms, an idle frame against 2 ms).
    const scale = Math.max(1, calib / 10, idle / 2);
    const bound = 50 * scale;
    worstFrame = Math.max(worstFrame, frameMs);
    worstBound = Math.max(worstBound, frameMs / bound);
    rows.push(`${id}: frame ${frameMs.toFixed(1)} ms (bound ${bound.toFixed(0)}: calib ${calib.toFixed(0)} ms, idle ${idle.toFixed(1)} ms), break ${plan.ms} ms, tail ${tail.toFixed(1)}, render ${renderMs.toFixed(0)}, cache ${frames} frames waited + ${zc.frames} building / ${Math.max(dearest, zc.worst || 0).toFixed(1)} ms worst`);
    r.ok(`crash-freeze: ${what} (${id}): the lights the renderer sees are the same before and after the crash`, lights0 === lights1 && lights1.includes('PointLight'), `${lights0} -> ${lights1}`);
    r.ok(`crash-freeze: ${what} (${id}): not one material's shader program changes on the crash`, changed === 0 && keys0.size > 50, `${changed} of ${keys0.size} changed`);
    r.ok(`crash-freeze: ${what} (${id}): the first render after the crash compiles no lit shader (the crash shaders were warmed on the flight's first frame; at most the shadow pass's small depth variant for a piece)`, (fresh.length === 0 || (fresh.length <= 1 && depthOnly(fresh))) && (D().stats.warms || 0) >= 1 && warms0 >= 1, `${fresh.length} new of ${renderer.info.programs.length} programs${fresh.length ? ` (${fresh.map((p) => String(p.cacheKey).split(',')[0]).join(', ')})` : ''}; warmed ${D().stats.warms} times`);
    r.ok(`crash-freeze: ${what} (${id}): the zone survey was built in the background before the crash, and the crash used it`, zc.ready && plan.cached === true && D().zoneCache.misses === 0, `ready after ${frames} frames (${zc.frames} working, ${zc.ms.toFixed(0)} ms in all); cached ${plan.cached}; ${D().zoneCache.hits} hits, ${D().zoneCache.misses} misses`);
    r.ok(`crash-freeze: ${what} (${id}): the crash frame is under 50 ms (scaled for a busy machine)`, frameMs < bound, `${frameMs.toFixed(1)} ms, bound ${bound.toFixed(0)} ms (calibration ${calib.toFixed(0)} ms, idle frame ${idle.toFixed(1)} ms); the break-up alone ${plan.ms} ms`);
    r.ok(`crash-freeze: ${what} (${id}): it still breaks up (pieces, a plan)`, (plan.pieces || []).length >= 1 && D().pieces.length >= 1, `${(plan.pieces || []).length} pieces planned, ${D().pieces.length} in the world`);
  }
  r.ok('crash-freeze: the cache is ready within a few seconds of every spawn (under 300 frames), a few milliseconds a frame', worstCacheFrames > 0 && worstCacheFrames < 300, `${worstCacheFrames} frames at most; the dearest building frame ${worstCacheStep.toFixed(1)} ms`);
  r.ok('crash-freeze: summary (the worst crash frame against its bound)', worstBound < 1, `${(worstBound * 100).toFixed(0)}% of the bound; worst ${worstFrame.toFixed(1)} ms\n      ${rows.join('\n      ')}`);

  /* ---- the cache follows the aeroplane: the gear, a new flight, a restore --------- */
  say('crash-freeze: the cache follows the aeroplane');
  {
    await fly('skylark');
    D().precompute();
    const key0 = D().zoneCache.key;
    const ac = sim.aircraft;
    // Cycle the gear: while it travels the cache waits; once it has settled the cache is rebuilt for the new state.
    const wasDown = ac.gearDown;
    ac.gearDown = !wasDown;
    let settled = 0;
    for (let i = 0; i < 600 && Math.abs(ac.gearPos - (ac.gearDown ? 1 : 0)) > 0.001; i++) {
      sim.update(1 / 60);
      settled++;
    }
    let rebuilt = 0;
    for (let i = 0; i < 600 && !(D().zoneCache.ready && D().zoneCache.key !== key0); i++) {
      sim.update(1 / 60);
      rebuilt++;
    }
    r.ok('crash-freeze: cycling the gear rebuilds the survey for the new state once the gear has settled', D().zoneCache.ready && D().zoneCache.key !== key0 && rebuilt < 300, `key ${key0} -> ${D().zoneCache.key}, ${settled} frames of travel, ready ${rebuilt} frames later`);
    ac.gearDown = wasDown;
    // A crash consumes the cache; the next flight (the aeroplane restored) builds a fresh one and misses nothing.
    sim.aircraft.crash('Crash-freeze cache check');
    sim.update(1 / 60);
    noDebrief();
    const afterCrash = { ...D().zoneCache };
    await fly('skylark');
    let again = 0;
    for (let i = 0; i < 600 && !D().zoneCache.ready; i++) {
      sim.update(1 / 60);
      again++;
    }
    r.ok('crash-freeze: a crash takes the cache; the next flight has a fresh survey within a few seconds', !afterCrash.ready && D().zoneCache.ready && again < 300 && D().zoneCache.misses === 0, `after the crash ready=${afterCrash.ready}; ready again after ${again} frames; misses ${D().zoneCache.misses}`);
  }

  /* ---- tidy ------------------------------------------------------------------------- */
  try {
    await fly(origAircraft);
  } catch (e) {
    /* leave it where it is */
  }
  sim.autoPauseOnHide = origAuto;
}

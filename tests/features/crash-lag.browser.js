/**
 * Browser checks for the crash LAG (the owner on a school iPad, November 2026:
 * "ran well apart from a lag spike when the plane crashes"). Measured on Low
 * with Performance mode and the main thread slowed 4x, a first crash at sea
 * stalled 300-1,340 ms a frame linking shaders nobody had warmed, on a Mac
 * whose shader link is quick. So what is held here is COUNTS, which a busy
 * test machine cannot move:
 *
 *   - the crash's lazy parts are fetched and compiled in flight, before any crash;
 *   - a first crash on land links no shader program from the hit on, slide
 *     marks and all;
 *   - a first crash at sea links none but the sea bed's own batch, and none at
 *     all on the frame the lens goes under the water;
 *   - the dents wait for the frame after the hit.
 *
 * The times are a soft report: tests/features/crash-freeze.browser.js holds the
 * crash frame's own bound.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects.
 */
export async function check(sim, r, say = () => {}) {
  const bu = await import('../../src/features/breakup.js');
  const T = await import('../../src/world/terrain.js');
  const THREE = await import('../../src/vendor/three.module.js');
  const D = () => bu.breakupDebug();
  const noDebrief = () => clearTimeout(sim._crashDebriefT);
  const yieldNow = () => new Promise((res) => setTimeout(res, 0));
  const autoWas = sim.autoPauseOnHide;
  const prepWas = { ...bu.CRASH_PREP };
  sim.autoPauseOnHide = false;
  bu.CRASH_PREP.afterMs = 0;
  bu.CRASH_PREP.lightsMs = 0;
  // What the class flies: Low with Performance mode, as a tablet starts.
  const perfWas = !!sim.settings.performanceMode;
  if (!perfWas) sim.setPerformanceMode(true);
  const gl = sim.renderer.getContext();
  const link = gl.linkProgram;
  let links = 0;
  gl.linkProgram = function linkCounted(...a) {
    links++;
    return link.apply(this, a);
  };
  const frame = (dt = 1 / 30) => {
    const t = performance.now();
    sim.update(dt);
    sim.renderFrame();
    noDebrief();
    return performance.now() - t;
  };
  const fly = async (id) => {
    await sim.startMode('free', { airborne: true, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, aircraft: id });
    sim.step(0.3);
    sim.rig.setMode('chase');
    for (let i = 0; i < 200 && !(D().prep().sea && D().prep().scars); i++) {
      frame();
      await yieldNow();
    }
    // One program a compile may still be linking in the flight's own warm: let it finish before the count starts.
    for (let i = 0; i < 4; i++) frame();
  };
  const land = () => {
    for (let rr = 400; rr < 9000; rr += 150) {
      for (let a = 0; a < 24; a++) {
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        const h = T.heightAt(x, z);
        if (h < 4) continue;
        let good = true;
        for (let d = -60; d <= 600 && good; d += 60) if (T.heightAt(x + d, z) < 4 || Math.abs(T.heightAt(x + d, z) - h) > 12 || T.platformAt(x + d, z)) good = false;
        if (good) return { x, z, y: h };
      }
    }
    return null;
  };
  const sea = () => {
    for (let rr = 2000; rr < 22000; rr += 400) {
      for (let a = 0; a < 16; a++) {
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        let good = true;
        for (let d = -300; d <= 900 && good; d += 100) if (T.heightAt(x + d, z) > -8 || T.platformAt(x + d, z)) good = false;
        if (good) return { x, z, y: 0 };
      }
    }
    return null;
  };
  const lensUnder = () => !!(D().under.info && D().under.info.on);
  /** Into the surface at (fwd, down) m/s; returns how long the frame with the hit took. */
  const crashAt = async (spot, fwd, down) => {
    const ac = sim.aircraft;
    const y0 = spot.y + 12;
    // The lamps in view here, not where the flight began: the warm follows them, as it does in a real flight.
    ac.reset({ pos: new THREE.Vector3(spot.x - 30, y0 + 150, spot.z), headingDeg: 90, speed: 60, altAGL: 162, engineOn: true, gearDown: true });
    for (let i = 0; i < 4; i++) frame();
    ac.reset({ pos: new THREE.Vector3(spot.x - 30, y0, spot.z), headingDeg: 90, speed: Math.hypot(fwd, down), altAGL: 12, engineOn: true, gearDown: true });
    ac.quat.setFromEuler(new THREE.Euler((-12 * Math.PI) / 180, -Math.PI / 2, 0, 'YXZ'));
    ac.vel.set(fwd, -down, 0);
    ac.onGround = false;
    ac._spawnOnGround = false;
    sim.override = { pitch: -0.5, roll: 0, yaw: 0, throttle: 0 };
    links = 0;
    let ms = 0;
    for (let i = 0; i < 300 && !ac.crashed; i++) ms = frame();
    sim.override = null;
    return ms;
  };

  try {
    /* ---- the lazy parts, in flight ------------------------------------------------ */
    say('crash-lag: the lazy parts');
    await fly('skylark');
    const prep = D().prep();
    r.ok('crash-lag: the wall of spray and the slide marks are here before any crash', prep.sea && prep.scars, JSON.stringify(prep));

    /* ---- land ----------------------------------------------------------------------- */
    say('crash-lag: a first crash on land');
    const ground = land();
    r.ok('crash-lag: somewhere to crash on land', !!ground);
    if (ground) {
      const flying = new Set(sim.renderer.info.programs);
      const ms = await crashAt(ground, 60, 14);
      r.ok('crash-lag: it crashed', sim.aircraft.crashed);
      r.ok('crash-lag: the dents wait for the frame after the hit', D().prep().dents === 1, JSON.stringify(D().prep()));
      let worst = ms;
      for (let i = 0; i < 90; i++) {
        worst = Math.max(worst, frame());
        await yieldNow();
      }
      r.ok('crash-lag: and nothing is left waiting', D().prep().dents === 0);
      // Booted as a tablet boots (?weak=1), none. Switched to Low after a boot on a higher tier, the game keeps
      // the one stray program crash-freeze reports at the default tier (v77.6 too).
      const allowed = /[?&]weak=1\b/.test(location.search) ? 0 : 1;
      r.ok('crash-lag: a first crash on land links no shader program, from the hit to the card', links <= allowed, `${links} linked (${sim.renderer.info.programs.filter((p) => !flying.has(p)).map((p) => `${p.name}:${String(p.cacheKey).slice(0, 40)}`).join(' ')}); soft report: hit frame ${ms.toFixed(0)} ms, worst ${worst.toFixed(0)} ms`);
    }

    /* ---- sea ---------------------------------------------------------------------- */
    say('crash-lag: a first crash at sea');
    const water = sea();
    r.ok('crash-lag: somewhere to crash at sea', !!water);
    if (water) {
      await fly('skylark');
      const ms = await crashAt(water, 60, 14);
      r.ok('crash-lag: it went in', sim.aircraft.crashed);
      let bed = 0; // the sea bed's own batch: linked in the background, on the frame it is built
      let under = 0; // on the frames from the waterline on
      let wentUnder = false;
      let worst = ms;
      let frames = 0;
      const before = new Set(sim.renderer.info.programs);
      const log = [];
      for (let i = 0; i < 300 && !wentUnder; i++) {
        const had = lensUnder();
        // The card falls due at 2.2 s (main.js), and it waits while the wreck goes down.
        if (i === 66 && sim.state === 'flying') sim.showCrashDebrief(sim.aircraft.crashReason);
        const was = links;
        worst = Math.max(worst, frame());
        frames++;
        await yieldNow();
        const made = links - was;
        if (made) log.push(`frame ${i}: ${made}`);
        // The batch for the sea bed: it is built on a frame of its own, once.
        if (made && D().under.opens && !bed) bed = made;
        else under += made;
        if (!had && lensUnder()) wentUnder = true;
      }
      for (let i = 0; i < 8 && wentUnder; i++) {
        const was = links;
        worst = Math.max(worst, frame());
        under += links - was;
      }
      r.ok('crash-lag: the lens went under the water', wentUnder, `after ${frames} frames; ${JSON.stringify(D().under)}`);
      r.ok('crash-lag: a first crash at sea links nothing but the sea bed\'s own batch, ahead of the waterline', under === 0, `${under} linked outside the batch of ${bed} (${sim.renderer.info.programs.filter((p) => !before.has(p)).map((p) => `${p.name}:${String(p.cacheKey).split(',')[0]}`).join(' ')}); ${log.join(' ')}; soft report: hit frame ${ms.toFixed(0)} ms, worst ${worst.toFixed(0)} ms`);
    }
  } finally {
    gl.linkProgram = link;
    if (!perfWas) sim.setPerformanceMode(false);
    Object.assign(bu.CRASH_PREP, prepWas);
    sim.override = null;
    sim.autoPauseOnHide = autoWas;
    noDebrief();
  }
}

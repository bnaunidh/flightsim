/**
 * Browser checks for the tsunami (src/features/tsunami.js, the wave in
 * src/world/sea-state.js), in the real game, at whatever tier it was built.
 *
 *   - it is a button in the pause menu's Disasters fold (a tap sets it going),
 *     the warning is shown and the tower says it
 *   - the sea draws back from the shore: the surface the GPU draws is the
 *     height the CPU answers (a camera lowered onto it), metres below the sea
 *   - the wave arrives: a boat's water offshore lifts, the shore floods — and
 *     over the flooded ground the GPU's water is still the CPU's
 *   - a jet parked on Cullen's low coastal runway is moved by the water and
 *     damaged; the tower closes the runway and opens it when it has drained
 *   - high ground stays dry; nothing flickers (the flicker probe, WCAG 2.3.1)
 *   - it ends by itself and leaves the sea as it was; Restart and the menu
 *     clear one that is running
 *   - the carrier rides it: she rises with it, more than a swell lifts her,
 *     comes down again, and the jet on her catapult is still on her deck
 *   - what it costs a frame while it runs
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail) per assertion.
 */

export const id = 'tsunami';

export async function check(sim, r, say) {
  const THREE = await import('../../src/vendor/three.module.js');
  const T = await import('../../src/world/terrain.js');
  const AP = await import('../../src/world/airport.js');
  const SEA = await import('../../src/world/sea-state.js');
  const P = await import('../flicker-probe.js');
  const wait = (ms) => new Promise((f) => setTimeout(f, ms));
  const origAuto = sim.autoPauseOnHide;
  const startMap = sim.settings.map;
  sim.autoPauseOnHide = false;
  const wx = { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 0, loadingScreen: false };
  const goTo = async (id) => {
    if (T.MAP.id === id && sim.settings.map === id) return;
    const before = sim.scenery;
    sim.setMap(id);
    for (let i = 0; i < 800 && (sim.scenery === before || T.MAP.id !== id); i++) await wait(10);
    await wait(100);
  };
  const ts = () => window.__tsunami;
  const loaded = async () => {
    for (let i = 0; i < 200 && !(window.__tsunami && window.__tsunami.state().on); i++) await wait(25);
    return !!(window.__tsunami && window.__tsunami.state().on);
  };
  /** Run the game on from wherever its clock is to `t` on the tsunami's. */
  const runTo = (t, dt = 1 / 30) => {
    const left = t - ts().state().t;
    if (left > 0) sim.step(left, dt);
  };
  const heard = [];
  const shown = [];
  const realSpeak = sim.speak;
  const realNotify = sim.hud.notify;
  sim.speak = function speak(text, ...a) { heard.push(String(text)); return realSpeak.call(this, text, ...a); };
  sim.hud.notify = function notify(text, ...a) { shown.push(String(text)); return realNotify.call(this, text, ...a); };

  /** The height of the sea the GPU draws at (x, z): only the sea is drawn, and a camera looking down is lowered through it. */
  const gpuSea = (x, z, lo = -9, hi = 22) => {
    const scene = sim.scene;
    const ocean = sim.ocean;
    const hidden = [];
    for (const o of scene.children) if (o !== ocean.group && o.visible) { o.visible = false; hidden.push(o); }
    for (const o of ocean.group.children) if (o !== ocean.deep && o.visible) { o.visible = false; hidden.push(o); }
    const bg = scene.background;
    const fog = scene.fog;
    scene.background = new THREE.Color(1, 0, 1);
    scene.fog = null;
    const cam = new THREE.PerspectiveCamera(8, 1, 0.01, 80);
    const gl = sim.renderer.getContext();
    const px = new Uint8Array(4);
    const seen = (y) => {
      cam.position.set(x, y, z);
      cam.up.set(0, 0, -1);
      cam.lookAt(x, y - 10, z);
      cam.updateMatrixWorld(true);
      sim.renderer.setRenderTarget(null);
      sim.renderer.render(scene, cam);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return !(px[0] > 200 && px[1] < 60 && px[2] > 200);
    };
    let out = NaN;
    if (seen(hi)) {
      for (let k = 0; k < 15; k++) {
        const m = (lo + hi) / 2;
        if (seen(m)) hi = m;
        else lo = m;
      }
      out = (lo + hi) / 2;
    }
    scene.background = bg;
    scene.fog = fog;
    for (const o of hidden) o.visible = true;
    return out;
  };
  /** Milliseconds a frame (update and draw), the median of n. */
  const frameMs = (n = 40) => {
    const ms = [];
    for (let i = 0; i < n; i++) {
      const t0 = performance.now();
      sim.step(1 / 30, 1 / 30);
      sim.renderer.getContext().finish();
      ms.push(performance.now() - t0);
    }
    ms.sort((a, b) => a - b);
    return ms[n >> 1];
  };

  try {
    /* ---------------- Cullen: the low runway by the sea ---------------- */
    say('tsunami: Cullen');
    await goTo('cullen');
    await sim.startMode('free', { ...wx, aircraft: 'fa18', airborne: false });
    sim.autoPauseOnHide = false;
    const tier = sim.qualityBuilt;
    const ac = sim.aircraft;
    const east = AP.RUNWAY.thresholdEast;
    // Parked at the end of the runway nearest the sea, brakes on.
    ac.pos.x = east.x - 30;
    ac.pos.z = east.z;
    sim.step(2, 1 / 30);
    const sea = sim.ocean && sim.ocean.sea;
    r.ok('setup: the sea has its swell (the tsunami is a wave on it)', !!sea && typeof T.SWELL.at === 'function');
    if (!sea) return;
    const vertsBefore = sim.ocean.deep.geometry.attributes.position.count;
    const msBefore = frameMs();
    const flickBefore = await P.measure(sim, { frames: 45, fps: 30 });
    const parked = { x: ac.pos.x, z: ac.pos.z };

    // From the pause menu, by a tap.
    sim.pause();
    const pause = sim.menus.screens.pause;
    const btn = pause && pause.querySelector('[data-natural="tsunami"]');
    r.ok('menu: Tsunami is a button in the pause menu\'s Disasters fold', !!btn && btn.tagName === 'BUTTON' && !!btn.closest('[data-natural-fold]'), btn ? btn.textContent.trim().replace(/\s+/g, ' ').slice(0, 80) : 'no button');
    if (!btn) return;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
    btn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
    btn.click();
    sim.resume();
    const on = await loaded();
    sim.step(0.2, 1 / 30);
    const st0 = ts().state();
    const plan = st0.plan;
    r.ok('start: a tap sets it going (the module loads on demand)', on && !!plan && plan.coast, plan ? `crest ${plan.H.toFixed(1)} m, at the shore in ${plan.tArrive.toFixed(0)} s, over in ${plan.tEnd.toFixed(0)} s, field built in ${st0.buildMs.toFixed(0)} ms` : '');
    if (!on) return;
    r.ok('warning: shown on the screen, in the words asked for', shown.some((s) => /Tsunami warning — get airborne or get to high ground/.test(s)), shown.slice(-3).join(' | '));
    r.ok('warning: and the tower says it', heard.some((s) => /tsunami warning/i.test(s) && /get airborne or get to high ground/i.test(s)), heard.slice(-2).join(' | '));
    r.ok('menu: the button shows it is running', sim.activeEvents && sim.activeEvents.tsunami > 0 && btn.classList.contains('is-on'));
    r.ok('warning: the sea has not moved yet', Math.abs(SEA.tsunamiAt(sea, plan.fx - plan.dx * 60, plan.fz - plan.dz * 60, {}).h) < 0.05);
    const vertsDuring = st0.verts;
    r.ok(`cost: the sea's grid while it runs (${tier})`, vertsDuring > vertsBefore && vertsDuring < (tier === 'low' ? 16000 : tier === 'medium' ? 52000 : 135000), `${vertsBefore} → ${vertsDuring} vertices`);

    /* ---- the sea draws back ---- */
    say('tsunami: the sea draws back');
    runTo(30);
    // A point in a few metres of water off the beach where it will come ashore, on a grid line of the sea.
    const d = SEA.GRID[tier] ? SEA.GRID[tier].d : 10;
    let shoal = null;
    for (let k = 10; k < 400 && !shoal; k += 5) {
      const x = Math.round((plan.fx - plan.dx * k) / d) * d;
      const z = Math.round((plan.fz - plan.dz * k) / d) * d;
      if (T.heightAt(x, z) < -7 && Math.hypot(x - sim.ocean.deep.position.x, z - sim.ocean.deep.position.z) < 380) shoal = { x, z };
    }
    const st1 = ts().state();
    if (shoal) {
      const cpu = T.swellAt(shoal.x, shoal.z);
      const gpu = gpuSea(shoal.x, shoal.z);
      r.ok('drawdown: the sea has drawn back from the shore, by metres', st1.D > 3.5 && cpu < -3, `${cpu.toFixed(2)} m at ${(-T.heightAt(shoal.x, shoal.z)).toFixed(0)} m of water, ${st1.t.toFixed(0)} s in`);
      r.ok('drawdown: what is drawn is what is answered', Math.abs(gpu - cpu) < 0.2, `GPU ${gpu.toFixed(2)} m, CPU ${cpu.toFixed(2)} m`);
    } else r.ok('drawdown: a shallow point near the eye to measure at', false, 'none found');
    r.ok('drawdown: the sea bed it leaves is drawn, and the old surf line is not left hanging', st1.seaCut < -3 && (() => { let n = 0; let vis = 0; sim.ocean.group.traverse((o) => { if (o.name === 'surf') { n++; if (o.visible) vis++; } }); return n === 0 || vis === 0; })(), `sea cut ${st1.seaCut.toFixed(1)} m`);
    r.ok('drawdown: said on the screen', shown.some((s) => /drawing back/i.test(s)));
    const flickDraw = await P.measure(sim, { frames: 45, fps: 30 });
    r.ok('flash: nothing flickers while the sea is drawn back', flickDraw.wcagWindow < 0.05 && flickDraw.percArea <= flickBefore.percArea + 0.01, `${(flickDraw.percArea * 100).toFixed(2)}% of the screen (before ${(flickBefore.percArea * 100).toFixed(2)}%), WCAG window ${(flickDraw.wcagWindow * 100).toFixed(1)}%`);

    /* ---- the wave ---- */
    say('tsunami: the wave');
    // Offshore, where a boat would be: the water it floats on, as the crest goes under it.
    let off = null;
    for (let k = 500; k < plan.half * 0.7 && !off; k += 50) {
      const x = plan.fx - plan.dx * k;
      const z = plan.fz - plan.dz * k;
      if (T.heightAt(x, z) < -10) off = { x, z, k };
    }
    // High ground, and the runway.
    let hill = null;
    for (const isl of T.ISLANDS) {
      for (let a = 0; a < 16 && !hill; a++) {
        for (let q = 0; q <= isl.radius && !hill; q += 60) {
          const x = isl.cx + Math.cos(a * 0.39) * q;
          const z = isl.cz + Math.sin(a * 0.39) * q;
          if (T.heightAt(x, z) > 25 && Math.hypot(x - plan.cx, z - plan.cz) < plan.half * 0.7) hill = { x, z };
        }
      }
    }
    runTo(plan.tArrive - 16);
    const msMid = frameMs();
    r.ok('warning: the wave is called when it is in sight', shown.some((s) => /wave is in sight/i.test(s)) || ts().state().t < plan.tArrive - 14);
    const flickWave = await P.measure(sim, { frames: 60, fps: 30 });
    let boatUp = 0;
    let rwDeep = 0;
    let hillWet = 0;
    let gpuFlood = null;
    let closedAt = 0;
    const rwPts = [];
    for (let i = 0; i <= 8; i++) rwPts.push({ x: AP.RUNWAY.thresholdWest.x + ((east.x - AP.RUNWAY.thresholdWest.x) * i) / 8, z: AP.RUNWAY.thresholdWest.z + ((east.z - AP.RUNWAY.thresholdWest.z) * i) / 8 });
    const flickFlood = { percArea: 0, wcagWindow: 0 };
    for (let t = ts().state().t; t < plan.tArrive + 22 && ts().state().on; t += 1) {
      sim.step(1, 1 / 30);
      if (off) boatUp = Math.max(boatUp, T.swellAt(off.x, off.z));
      let dd = 0;
      for (const p of rwPts) dd = Math.max(dd, ts().floodDepth(p.x, p.z));
      if (dd > rwDeep) {
        rwDeep = dd;
        // Over the flooded runway: the GPU's water against the CPU's, once, where it is deep.
        if (dd > 0.5 && !gpuFlood) {
          const p = rwPts.reduce((a, b) => (ts().floodDepth(b.x, b.z) > ts().floodDepth(a.x, a.z) ? b : a));
          const x = Math.round(p.x / d) * d;
          const z = Math.round(p.z / d) * d;
          gpuFlood = { gpu: gpuSea(x, z, 2, 30), cpu: T.swellAt(x, z), ground: T.heightAt(x, z) };
        }
      }
      if (hill) hillWet = Math.max(hillWet, ts().floodDepth(hill.x, hill.z));
      if (ts().state().closed && !closedAt) closedAt = ts().state().t;
      if (Math.abs(ts().state().t - (plan.tArrive + 3)) < 0.6) {
        const m = await P.measure(sim, { frames: 60, fps: 30 });
        flickFlood.percArea = m.percArea;
        flickFlood.wcagWindow = m.wcagWindow;
        flickFlood.done = true;
      }
    }
    const stF = ts().state();
    r.ok('wave: offshore the water a boat floats on lifts and comes down (boats, floats and rafts ask this same sea)', !off || (boatUp > 3 && boatUp < plan.H), off ? `${boatUp.toFixed(1)} m, ${off.k} m off the shore` : 'no deep water in reach');
    r.ok('flood: the water reaches the low runway', rwDeep > 0.3 && rwDeep < 6, `${rwDeep.toFixed(2)} m at its deepest, runway at ${T.heightAt(east.x, east.z).toFixed(1)} m`);
    r.ok('flood: over the flooded ground the GPU\'s water is the CPU\'s', !!gpuFlood && Math.abs(gpuFlood.gpu - gpuFlood.cpu) < 0.35 && gpuFlood.gpu > gpuFlood.ground, gpuFlood ? `GPU ${gpuFlood.gpu.toFixed(2)} m, CPU ${gpuFlood.cpu.toFixed(2)} m, ground ${gpuFlood.ground.toFixed(2)} m` : 'never deep enough to measure');
    r.ok('flood: high ground stays dry', !!hill && hillWet === 0, hill ? `${T.heightAt(hill.x, hill.z).toFixed(0)} m up: ${hillWet.toFixed(2)} m of water` : 'no hill in the field');
    r.ok('runway: the tower closes it while there is water on it', closedAt > 0 && heard.some((s) => /runway is closed/i.test(s)), `closed ${closedAt.toFixed(0)} s in`);
    r.ok('runway: no take-off clearance while it is closed', closedAt > 0 && (!stF.closed || (sim.atc.said.clearance = false, sim.atc.cool = 0, sim.atc.once('clearance') === false)));
    const moved = Math.hypot(ac.pos.x - parked.x, ac.pos.z - parked.z);
    const hurt = ac.damage.gear + ac.damage.fuselage;
    r.ok('jet: parked on the flooded runway, it is moved by the water', stF.maxDepth > 0.3 && stF.swept > 1 && moved > 0.5, `carried ${stF.swept.toFixed(1)} m in all (in with the water, part of the way back as it drained), ${moved.toFixed(1)} m from where it was parked, in ${stF.maxDepth.toFixed(2)} m of water`);
    r.ok('jet: and damaged by it, by the game\'s own damage model — and not blown up', hurt > 0.05 && !ac.crashed, `gear ${ac.damage.gear.toFixed(2)}, fuselage ${ac.damage.fuselage.toFixed(2)}, engine ${ac.engineOn ? 'running' : 'stopped'}${ac.crashed ? `, lost: ${ac.crashReason}` : ''}`);
    r.ok('shore: cars and boats are kept out of the flooded strip', stF.thinned > 0, `${stF.thinned} circles`);
    r.ok('flash: nothing flickers as the wave comes in', flickWave.wcagWindow < 0.05 && flickWave.percArea <= flickBefore.percArea + 0.015, `${(flickWave.percArea * 100).toFixed(2)}% of the screen, WCAG window ${(flickWave.wcagWindow * 100).toFixed(1)}%`);
    r.ok('flash: nor as it breaks and floods', !!flickFlood.done && flickFlood.wcagWindow < 0.05 && flickFlood.percArea <= flickBefore.percArea + 0.015, `${(flickFlood.percArea * 100).toFixed(2)}% of the screen, WCAG window ${(flickFlood.wcagWindow * 100).toFixed(1)}%`);
    r.ok(`cost: a frame while it runs (${tier})`, msMid < msBefore * 2 + 6, `${msBefore.toFixed(1)} ms before, ${msMid.toFixed(1)} ms with the wave coming`);

    /* ---- it drains, the runway opens, it ends ---- */
    say('tsunami: draining');
    let opened = false;
    for (let i = 0; i < 40 && ts().state().on && !opened; i++) {
      sim.step(1, 1 / 30);
      opened = closedAt > 0 && !ts().state().closed;
    }
    r.ok('runway: open again once the water has drained', opened && heard.some((s) => /runway is open again/i.test(s)), `${ts().state().t.toFixed(0)} s in`);
    ts().skipTo(plan.tEnd - 2);
    sim.step(3, 1 / 30);
    const end = ts().state();
    const shore = shoal || { x: plan.fx - plan.dx * 60, z: plan.fz - plan.dz * 60 };
    r.ok('end: it ends by itself, and says so', !end.on && shown.some((s) => /tsunami is over/i.test(s)));
    r.ok('end: the sea is the sea it was', sea.tsu === null && Math.abs(T.swellAt(shore.x, shore.z)) < 0.6 && sim.ocean.deep.geometry.attributes.position.count === vertsBefore && end.seaCut === 0, `${T.swellAt(shore.x, shore.z).toFixed(2)} m at the shore, ${sim.ocean.deep.geometry.attributes.position.count} vertices`);
    r.ok('end: the button is off, the surf line is back, nothing is left hidden', !(sim.activeEvents && sim.activeEvents.tsunami) && end.thinned === 0 && end.hidden === 0 && (() => { let ok = true; sim.ocean.group.traverse((o) => { if (o.name === 'surf' && !o.visible) ok = false; }); return ok; })());

    /* ---- it ends with the flight ---- */
    say('tsunami: restart clears it');
    await sim.startMode('free', { ...wx, aircraft: 'fa18', airborne: false });
    sim.autoPauseOnHide = false;
    sim.step(1, 1 / 30);
    sim.triggerNatural('tsunami');
    await loaded();
    ts().skipTo(28);
    sim.step(1, 1 / 30);
    const mid = ts().state();
    const wasBack = T.swellAt(shore.x, shore.z);
    await sim.startMode('free', { ...wx, aircraft: 'fa18', airborne: false });
    sim.autoPauseOnHide = false;
    sim.step(1, 1 / 30);
    r.ok('restart: a new flight has no tsunami and the ordinary sea', mid.on && wasBack < -2 && !ts().state().on && sim.ocean.sea.tsu === null && Math.abs(T.swellAt(shore.x, shore.z)) < 0.6 && !(sim.activeEvents && sim.activeEvents.tsunami), `drawn back ${wasBack.toFixed(1)} m, then ${T.swellAt(shore.x, shore.z).toFixed(2)} m`);
    sim.triggerNatural('tsunami');
    await loaded();
    ts().skipTo(28);
    sim.step(1, 1 / 30);
    const mid2 = ts().state().on;
    sim.quitToMenu();
    r.ok('menu: going back to the menu clears it too', mid2 && !ts().state().on && sim.ocean.sea.tsu === null && T.SEA_CUT.d === 0);

    /* ---------------- the carrier ---------------- */
    say('tsunami: the carrier');
    await goTo('kestrel');
    await sim.startMode('free', { ...wx, aircraft: 'fa18', startAt: 'carrier', airborne: false });
    sim.autoPauseOnHide = false;
    sim.step(20, 1 / 30);
    const way = sim.carrier && sim.carrier.way;
    if (!way) r.ok('carrier: she is under way to ride it', false, 'no ship under way on this map');
    else {
      let calm = 0;
      for (let i = 0; i < 20; i++) {
        sim.step(0.5, 1 / 30);
        calm = Math.max(calm, Math.abs(way.heave));
      }
      const deckY0 = way.platform.y;
      const jet = sim.aircraft;
      sim.triggerNatural('tsunami');
      const on2 = await loaded();
      const p2 = on2 ? ts().state().plan : null;
      r.ok('carrier: a tsunami set going from her deck reaches her', on2 && !!p2);
      if (on2) {
        const sea2 = sim.ocean.sea;
        // On to just before the first crest reaches the ship, wherever she has got to by then.
        let up = 0;
        let roll = 0;
        let water = 0;
        let found = false;
        for (let t = 10; t < p2.tEnd - 6 && ts().state().on; t += 1) {
          const w = sea2.tsu;
          const along = (way.pose.x - p2.cx) * p2.dx + (way.pose.z - p2.cz) * p2.dz;
          const eta = (along - w.U) / p2.c;
          if (!found && eta > 12) {
            ts().skipTo(ts().state().t + eta - 10);
            sim.step(0.5, 1 / 30);
            found = true;
            continue;
          }
          sim.step(1, 1 / 30);
          up = Math.max(up, way.heave);
          roll = Math.max(roll, Math.abs(way.roll), Math.abs(way.pitch));
          water = Math.max(water, SEA.tsunamiAt(sea2, way.pose.x, way.pose.z, {}).h);
          if (found && eta < -40) break;
        }
        const over = way.platform.at(jet.pos.x, jet.pos.z);
        r.ok('carrier: she rises with the wave, far more than a swell lifts her', water > 2 && up > calm + 1.5 && up > water * 0.6 && up <= water + 1.3, `the sea rose ${water.toFixed(1)} m under her, she rose ${up.toFixed(1)} m (a swell: ${calm.toFixed(2)} m)`);
        r.ok('carrier: she leans to it, a little, and no more than twice her limit', roll > 0 && roll <= (0.6 * 2 * Math.PI) / 180 + 1e-6, `${((roll * 180) / Math.PI).toFixed(2)}°`);
        r.ok('carrier: the jet on her deck is still on her deck, unhurt', !!over && !jet.crashed && Math.abs(jet.pos.y - way.platform.y) < 6, `crashed ${jet.crashed}, ${(jet.pos.y - way.platform.y).toFixed(2)} m over the deck`);
        ts().skipTo(p2.tEnd - 1);
        sim.step(8, 1 / 30);
        r.ok('carrier: and she comes down again when it has gone', !ts().state().on && Math.abs(way.heave) < calm + 0.6 && Math.abs(way.platform.y - deckY0) < calm * 2 + 0.8, `heave ${way.heave.toFixed(2)} m`);
      }
    }
  } finally {
    sim.speak = realSpeak;
    sim.hud.notify = realNotify;
    if (window.__tsunami) window.__tsunami.stop(sim);
    sim.autoPauseOnHide = origAuto;
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    if (startMap && T.MAP.id !== startMap) await goTo(startMap);
  }
}

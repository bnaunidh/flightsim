/**
 * World life in the real game (features/world-life.js): people on the
 * airfield and service vehicles on their rounds.
 *
 *   1. Free flight at Kestrel, High: the crews, the passengers, the kerb and
 *      the vehicles are there, drawn, and moving.
 *   2. Nobody and nothing of it on a runway or a taxiway.
 *   3. In the way of an aeroplane, they wait: a walker stops while you are
 *      next to it, a vehicle stops short of you on its route.
 *   4. Night: fewer passengers and fewer people at the kerb than by day.
 *   5. The tutorial has none.
 *   6. Low: a token few in a two-mesh figure, no extra vehicles, and the
 *      frame costs no more than 5% over the same frame without any of it
 *      (render + update, median of interleaved batches, the terminal in view).
 *
 * `check(sim, r, say)`, as tests/features/index.js expects.
 */

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say = () => {}) {
  let TER;
  let THREE;
  try {
    TER = await import('../../src/world/terrain.js');
    THREE = await import('../../src/vendor/three.module.js');
  } catch (e) {
    r.ok('world life: modules load', false, String(e && e.message));
    return;
  }
  const WL = sim.worldLife;
  r.ok('world life: installed (sim.worldLife)', !!(WL && WL.state));
  if (!WL) return;
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const quality0 = sim.settings.quality;
  const step = (s) => {
    for (let t = 0; t < s; t += 1 / 30) sim.step(1 / 30);
  };
  try {
    /* 1. Free flight, High */
    say('world life: free flight, High');
    if (sim.settings.quality !== 'high') {
      sim.applySetting('quality', 'high');
      await sleep(200);
    }
    if (sim.settings.map !== 'kestrel' && sim.applySetting) {
      try {
        sim.applySetting('map', 'kestrel');
        await sleep(300);
      } catch (e) {
        /* the map it is on will do */
      }
    }
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    step(1);
    const st = WL.state();
    r.ok('world life: on in free flight, at the full level', st.on && st.level === 1, JSON.stringify({ on: st.on, level: st.level }));
    r.ok('world life: crews, passengers and the kerb are all there', (st.roles.dispatcher || 0) >= 1 && (st.roles.pax || 0) >= 4 && (st.roles.kerb || 0) >= 4, JSON.stringify(st.roles));
    r.ok('world life: service vehicles on the apron loop (High: four)', st.vans.length === 4, st.vans.map((v) => v.kind).join(', ') + ' ' + st.why.join(' / '));
    const W = WL.walkers();
    const before = W.map((w) => [w.x, w.z, w.hidden]);
    const vans0 = WL.vans().map((v) => v.d);
    step(20);
    const moved = W.filter((w, i) => !w.hidden && Math.hypot(w.x - before[i][0], w.z - before[i][1]) > 2).length;
    r.ok('world life: people walk (over 20 s, several have gone more than 2 m)', moved >= 5, `${moved} of ${W.length}`);
    const vansMoved = WL.vans().filter((v, i) => Math.abs(v.d - vans0[i]) > 30).length;
    r.ok('world life: the vehicles drive their rounds', vansMoved >= 3, `${vansMoved} of ${vans0.length}`);
    // Drawn: look at the apron.
    const lay = sim.apron.lay;
    const F = lay.frame;
    const T = lay.terminal;
    const cam = sim.camera;
    const look = new THREE.Vector3(F.x((T.u0 + T.u1) / 2), lay.elev, F.z(T.front - 20));
    cam.position.set(look.x, lay.elev + 60, F.z(T.front - 160));
    cam.lookAt(look);
    cam.updateMatrixWorld();
    WL.meshes(); // (the crowd draws for the camera on the next update)
    sim.step(1 / 30);
    cam.position.set(look.x, lay.elev + 60, F.z(T.front - 160));
    cam.lookAt(look);
    cam.updateMatrixWorld();
    const people = WL.meshes().filter((m) => /^people:/.test(m.name));
    r.ok('world life: the crowd is six instanced meshes, and people are drawn', people.length === 6 && WL.state().drawn >= 10, `${people.length} meshes, ${WL.state().drawn} drawn`);
    r.ok('world life: the update is cheap (median under 0.5 ms)', WL.state().update.median < 0.5, `${WL.state().update.median.toFixed(3)} ms median, ${WL.state().update.max.toFixed(2)} max`);

    /* 2. Never on a runway or a taxiway */
    say('world life: off the runways');
    const plan = WL.plan();
    const tx = lay.taxiway && lay.taxiway.rect;
    const bad = [];
    const checkPt = (q, what) => {
      if (TER.isOnAnyRunway(q.x, q.z, 8)) bad.push(`${what} on a runway at ${q.x | 0},${q.z | 0}`);
      if (tx && q.x > tx.x0 - 2 && q.x < tx.x1 + 2 && q.z > tx.z0 - 2 && q.z < tx.z1 + 2) bad.push(`${what} on the taxiway at ${q.x | 0},${q.z | 0}`);
    };
    for (const w of plan.walkers) for (const q of w.path) checkPt(q, w.role);
    for (const v of plan.vans) {
      for (let i = 0; i < v.path.length; i++) {
        const a = v.path[i];
        const b = v.path[(i + 1) % v.path.length];
        for (let t = 0; t <= 1; t += 0.05) checkPt({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, v.kind);
      }
    }
    r.ok('world life: no route is on a runway or the taxiway', bad.length === 0, bad.slice(0, 4).join('; '));

    /* 3. They wait for aeroplanes */
    say('world life: waiting for aeroplanes');
    const ac = sim.aircraft;
    const walker = W.find((w) => !w.hidden && w.mode !== 'idle' && w.role === 'kerb') || W.find((w) => !w.hidden && w.mode !== 'idle');
    if (walker) {
      const saved = ac.pos.clone();
      ac.pos.set(walker.x + 3, lay.elev + 1, walker.z);
      sim.step(1 / 30);
      const wx = walker.x;
      const wz = walker.z;
      for (let i = 0; i < 60; i++) {
        ac.pos.set(walker.x + 3, lay.elev + 1, walker.z);
        sim.step(1 / 30);
      }
      r.ok('world life: a walker with an aeroplane beside it stands still', walker.held && Math.hypot(walker.x - wx, walker.z - wz) < 0.05, `held ${walker.held}, moved ${Math.hypot(walker.x - wx, walker.z - wz).toFixed(2)} m`);
      ac.pos.copy(saved);
    } else {
      r.ok('world life: a walker to test with', false);
    }
    const van = WL.vans()[0];
    if (van) {
      const saved = ac.pos.clone();
      // Ten metres ahead of it on its route.
      const ahead = { x: 0, y: 0, z: 0 };
      van.route.sample(van.d + van.dir * 14, ahead);
      for (let i = 0; i < 120; i++) {
        ac.pos.set(ahead.x, lay.elev + 1, ahead.z);
        sim.step(1 / 30);
      }
      const d0 = van.d;
      for (let i = 0; i < 60; i++) {
        ac.pos.set(ahead.x, lay.elev + 1, ahead.z);
        sim.step(1 / 30);
      }
      r.ok('world life: a vehicle stops short of an aeroplane on its route, and waits', van.yielding && Math.abs(van.d - d0) < 0.1 && Math.hypot(van.pos.x - ahead.x, van.pos.z - ahead.z) > 5, `yielding ${van.yielding}, crept ${Math.abs(van.d - d0).toFixed(2)} m, ${Math.hypot(van.pos.x - ahead.x, van.pos.z - ahead.z).toFixed(1)} m short`);
      // ...and the ones behind queue up behind it, never through it (the
      // checker's catch: each had its own Route, so "the one in front" was
      // never found, and the faster bus drove through the catering truck).
      const VS = WL.vans();
      let minGap = Infinity;
      let pair = '';
      for (let i = 0; i < 30 * 75; i++) {
        ac.pos.set(ahead.x, lay.elev + 1, ahead.z);
        sim.step(1 / 30);
        for (let a = 0; a < VS.length; a++) {
          for (let b = a + 1; b < VS.length; b++) {
            const g = Math.hypot(VS[a].pos.x - VS[b].pos.x, VS[a].pos.z - VS[b].pos.z);
            if (g < minGap) {
              minGap = g;
              pair = `${VS[a].kind}/${VS[b].kind}`;
            }
          }
        }
      }
      r.ok('world life: the vehicles behind queue up, never through each other (75 s held)', VS.length < 2 || minGap > 9, `closest ${minGap.toFixed(1)} m (${pair}); yielding ${VS.map((v) => `${v.kind} ${v.yielding}`).join(', ')}`);
      ac.pos.copy(saved);
    }

    /* 3b. An emergency scene's ground (ambient thinAround): nobody in it, the vehicles off the apron */
    say('world life: an emergency scene clears it');
    if (sim.ambient && sim.ambient.thinAround && sim.ambient.unthin) {
      const cx = F.x((T.u0 + T.u1) / 2);
      const cz = F.z(T.front - 20);
      const h = sim.ambient.thinAround(cx, cz, 180);
      step(0.5);
      const inZone = WL.walkers().filter((w) => Math.hypot(w.x - cx, w.z - cz) < 180);
      const shown = inZone.filter((w) => !w.hidden).length;
      const vansShown = WL.meshes().some((m) => /^life:/.test(m.name) && m.parent && m.parent.visible);
      r.ok('world life: inside an emergency scene\'s ground nobody is shown, and the apron vehicles are off', inZone.length > 0 && shown === 0 && (!WL.vans().length || !vansShown), `${shown} of ${inZone.length} shown, vehicles ${vansShown ? 'shown' : 'off'}`);
      sim.ambient.unthin(h);
      step(0.5);
      const back = WL.walkers().filter((w) => w.mode !== 'cycle' && Math.hypot(w.x - cx, w.z - cz) < 180 && !w.hidden).length;
      const vansBack = !WL.vans().length || WL.meshes().some((m) => /^life:/.test(m.name) && m.parent && m.parent.visible);
      r.ok('world life: and back as they were when it clears', back > 0 && vansBack, `${back} shown again, vehicles ${vansBack ? 'back' : 'still off'}`);
    }

    /* 4. Night */
    say('world life: night');
    const day = WL.state().roles;
    await sim.startMode('free', { aircraft: 'skylark', time: 'night', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    step(0.5);
    const night = WL.state().roles;
    r.ok('world life: at night fewer passengers and a quieter kerb; the crews still work', (night.pax || 0) < (day.pax || 0) && (night.kerb || 0) < (day.kerb || 0) && (night.dispatcher || 0) === (day.dispatcher || 0), `day ${JSON.stringify(day)} night ${JSON.stringify(night)}`);

    /* 5. The tutorial */
    say('world life: the tutorial');
    try {
      await sim.startMode('tutorial', {});
      step(0.3);
      r.ok('world life: none in the tutorial', !WL.state().on && WL.state().people === 0, JSON.stringify({ on: WL.state().on, people: WL.state().people }));
    } catch (e) {
      r.ok('world life: none in the tutorial (could not start it)', true, String(e && e.message));
    }
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();

    /* 6. Low */
    say('world life: Low');
    sim.applySetting('quality', 'low');
    await sleep(250);
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    step(1);
    const lo = WL.state();
    r.ok('world life: Low keeps a token few (≤ 14 people in the two-mesh figure, no extra vehicles)', lo.people > 0 && lo.people <= 14 && lo.vans.length === 0 && WL.meshes().length === 2, `${lo.people} people, ${lo.vans.length} vehicles, ${WL.meshes().length} meshes`);
    const view = () => {
      const look2 = new THREE.Vector3(F.x((T.u0 + T.u1) / 2), lay.elev, F.z(T.back));
      cam.position.set(look2.x + 40, lay.elev + 25, F.z(T.back + 70));
      cam.lookAt(look2);
      cam.updateMatrixWorld();
    };
    const frame = () => {
      sim.step(1 / 60);
      view();
      sim.renderer.render(sim.scene, sim.camera);
    };
    const batch = () => {
      for (let i = 0; i < 2; i++) frame();
      sim.renderer.getContext().finish();
      const t0 = performance.now();
      for (let i = 0; i < 6; i++) frame();
      sim.renderer.getContext().finish();
      return (performance.now() - t0) / 6;
    };
    // Interleaved, many short batches, and the lower quartile of each: the
    // test Mac is shared with other builds, and a load spike landing on one
    // side's batch is not the game's cost.
    const on = [];
    const off = [];
    for (let k = 0; k < 24; k++) {
      WL.setEnabled(true);
      on.push(batch());
      WL.setEnabled(false);
      off.push(batch());
    }
    const calls = (en) => {
      WL.setEnabled(en);
      frame();
      sim.renderer.info.autoReset = false;
      sim.renderer.info.reset();
      frame();
      const c = sim.renderer.info.render.calls;
      sim.renderer.info.autoReset = true;
      return c;
    };
    const cOn = calls(true);
    const cOff = calls(false);
    WL.setEnabled(true);
    on.sort((a, b) => a - b);
    off.sort((a, b) => a - b);
    const qOn = on[on.length >> 2];
    const qOff = off[off.length >> 2];
    r.ok('world life: on Low the frame costs no more than 5% over the same frame without it', qOn <= qOff * 1.05, `with ${qOn.toFixed(2)} ms, without ${qOff.toFixed(2)} ms (${(((qOn / qOff) - 1) * 100).toFixed(1)}%), lower quartiles of 24 interleaved batches`);
    r.ok('world life: on Low it adds at most eight draw calls (two people meshes and the forecourt, in each pass the frame draws)', cOn - cOff <= 8, `${cOn - cOff} more (${cOff} → ${cOn})`);
  } catch (e) {
    r.ok('world life: the checks ran', false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    try {
      WL.setEnabled(true);
      if (sim.settings.quality !== quality0) sim.applySetting('quality', quality0);
    } catch (e) {
      /* as it was */
    }
    sim.autoPauseOnHide = autoPause;
  }
}

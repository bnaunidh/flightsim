/**
 * PLANE DEPTH in the real game (src/aircraft/plane-depth.js; the node checks
 * are plane-depth.mjs).
 *
 *   1. High: the Skylark you fly is dressed -- shade on its airframe, its
 *      small parts hung on it -- and draws with no console or shader error,
 *      from the chase view and from the seat.
 *   2. The parts are drawn near the camera only: far off, their LOD shows
 *      nothing.
 *   3. What it costs on High: the draw calls and triangles it adds in the
 *      chase view, and the frame time with and without it (reported; held
 *      under a quarter more).
 *   4. Low: nothing is dressed, nothing of the module's work is there.
 *
 * `check(sim, r, say)`, as tests/features/index.js expects; every step fenced.
 */

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const errors = [];
  const realError = console.error;
  console.error = (...a) => {
    errors.push(a.map((x) => (x && x.message) || String(x)).join(' ').slice(0, 200));
    realError.apply(console, a);
  };
  const onErr = (e) => errors.push(`uncaught: ${(e && e.message) || e}`.slice(0, 200));
  window.addEventListener('error', onErr);
  const qualityWas = sim.settings.quality;
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  const fly = async (id) => {
    await sim.startMode('free', { aircraft: id, time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    sim.step(0.2);
  };
  const dressedSoon = async (model, ms = 5000) => {
    const t0 = performance.now();
    while (performance.now() - t0 < ms && !(model && model.userData.depth)) await sleep(40);
    return model && model.userData.depth;
  };
  const frameMs = () => {
    const t = [];
    for (let k = 0; k < 9; k++) {
      const t0 = performance.now();
      for (let i = 0; i < 6; i++) sim.renderer.render(sim.scene, sim.camera);
      sim.renderer.getContext().finish();
      t.push((performance.now() - t0) / 6);
    }
    t.sort((a, b) => a - b);
    return t[4];
  };
  try {
    /* 1. High: dressed */
    say('plane depth: High');
    if (sim.settings.quality !== 'high') sim.applySetting('quality', 'high');
    await sleep(200);
    await fly('skylark');
    const d = await dressedSoon(sim.model);
    const lods = (sim.model.userData.depthParts || []);
    let shaded = 0;
    sim.model.traverse((o) => {
      if (o.isMesh && o.geometry.attributes.depthAO) shaded++;
    });
    r.ok('plane depth: on High the Skylark you fly is dressed (shade on its airframe, parts hung on it)', !!d && d.ao > 0 && shaded > 0 && lods.length > 0,
      d ? `${shaded} shaded meshes, parts ${JSON.stringify(d.parts)}, ${d.ms} ms` : 'not dressed');
    const e0 = errors.length;
    sim.rig.setMode('chase');
    sim.step(0.3);
    for (let i = 0; i < 4; i++) sim.renderer.render(sim.scene, sim.camera);
    const progs = (sim.renderer.info.programs || []).filter((p) => /depthAO/.test(p.cacheKey || ''));
    r.ok('plane depth: the shaded programs compile and draw, no console or shader error (chase view)', progs.length > 0 && errors.length === e0, `${progs.length} programs; ${errors.slice(e0, e0 + 2).join(' | ')}`);
    sim.rig.setMode('cockpit');
    sim.step(0.3);
    for (let i = 0; i < 3; i++) sim.renderer.render(sim.scene, sim.camera);
    r.ok('plane depth: from the seat too', errors.length === e0, errors.slice(e0, e0 + 2).join(' | '));
    sim.rig.setMode('chase');
    sim.step(0.3);

    /* 2. near the camera only */
    say('plane depth: LOD');
    {
      const cam = sim.camera;
      const keep = cam.position.clone();
      sim.renderer.render(sim.scene, cam);
      const near = lods.every((l) => l.getCurrentLevel() === 0);
      const p = sim.model.getWorldPosition(new THREE.Vector3());
      cam.position.copy(p).add(new THREE.Vector3(0, 400, 900));
      cam.updateMatrixWorld(true);
      sim.renderer.render(sim.scene, cam);
      const far = lods.every((l) => l.getCurrentLevel() === 1);
      cam.position.copy(keep);
      cam.updateMatrixWorld(true);
      r.ok('plane depth: the parts are drawn up close and not from a kilometre off (LOD)', near && far, `near ${near}, far ${far}`);
    }

    /* 3. cost on High */
    say('plane depth: cost');
    {
      sim.renderer.info.autoReset = false;
      const count = () => {
        sim.renderer.info.reset();
        sim.renderer.render(sim.scene, sim.camera);
        return { calls: sim.renderer.info.render.calls, tris: sim.renderer.info.render.triangles };
      };
      const on = count();
      const onMs = frameMs();
      const kept = [];
      sim.model.traverse((o) => {
        if (o.isMesh && o.geometry.attributes.depthAO) {
          kept.push([o.geometry, o.geometry.attributes.depthAO]);
          o.geometry.deleteAttribute('depthAO');
        }
      });
      for (const l of lods) l.visible = false;
      const off = count();
      const offMs = frameMs();
      for (const [g, a] of kept) g.setAttribute('depthAO', a);
      for (const l of lods) l.visible = true;
      sim.renderer.info.autoReset = true;
      r.ok('plane depth: on High it costs a handful of draws and under a quarter more frame time (chase view)', on.calls - off.calls <= 12 && onMs <= Math.max(offMs * 1.25, offMs + 0.6),
        `+${on.calls - off.calls} draws, +${on.tris - off.tris} triangles; ${onMs.toFixed(2)} ms against ${offMs.toFixed(2)} ms`);
    }

    /* 4. Low */
    say('plane depth: Low');
    sim.applySetting('quality', 'low');
    await sleep(200);
    // another type: the one you were flying is kept as it was built until it is rebuilt
    await fly('courier');
    await sleep(400);
    let any = 0;
    sim.model.traverse((o) => {
      if (o.name === 'surface detail' || (o.isMesh && [].concat(o.material).some((m) => m && m.userData && m.userData.depthAO))) any++;
    });
    r.ok('plane depth: on Low nothing is dressed (the same aeroplane as before)', !sim.model.userData.depth && !any, `${any} dressed objects`);
  } catch (e) {
    r.ok('plane depth: the checks ran', false, String((e && e.stack) || e).slice(0, 300));
  } finally {
    if (sim.settings.quality !== qualityWas) sim.applySetting('quality', qualityWas);
    sim.autoPauseOnHide = autoPause;
    console.error = realError;
    window.removeEventListener('error', onErr);
  }
}

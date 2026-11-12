/**
 * Better cars, people and buildings, in the game (features/ambient/car-models.js,
 * features/life/people.js, world/town-dress.js):
 *
 *   node .claude/devtools/briefs/one-check.mjs '<url>?mute=1' ./tests/features/better-models.browser.js check "" 1
 *
 * On the World Map from Gateway International (Aldermere).
 *   HIGH  the cars round you are the better shapes (paint and trim told apart), an
 *         estate and an SUV among them; the city's blocks have shopfronts, awnings and
 *         balconies in two draw calls that go when you are away; the people in the
 *         street have street clothes to wear; every shader links
 *   LOW   the cars are the old boxes on the old material, there is no street dressing
 *         at all and nobody in the street: what Low drew before, it draws now
 * `node tests/features/better-models.mjs` holds the shapes themselves.
 */
export const id = 'better-models';

const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say) {
  say && say('better models: cars, people, buildings');
  const wp = sim.worldPreview;
  const SL = sim.streetLife;
  if (!wp || !SL || !sim.ambient || !sim.ambient.layer) {
    r.ok('better models: installed (the second bundle is in)', false, `worldPreview ${!!wp}, streetLife ${!!SL}, ambient ${!!sim.ambient}`);
    return;
  }
  const T = await import('../../src/world/terrain.js');
  const TD = await import('../../src/world/town-dress.js');
  const before = { map: sim.settings.map, quality: sim.settings.quality, perf: sim.settings.performanceMode };
  sim.autoPauseOnHide = false;
  const hold = { x: 0, y: 0, z: 0, on: false };
  const pin = () => {
    if (!hold.on) return;
    const ac = sim.aircraft;
    ac.pos.set(hold.x, hold.y, hold.z);
    if (ac.vel) ac.vel.set(0, 0, 0);
    if (ac.omega) ac.omega.set(0, 0, 0);
  };
  const run = (s, dt = 1 / 30) => {
    const n = Math.max(1, Math.round(s / dt));
    for (let i = 0; i < n; i++) {
      pin();
      sim.step(dt);
    }
    pin();
  };
  const frame = () => sim.renderer.render(sim.scene, sim.camera);
  const build = async (quality) => {
    sim.settings.performanceMode = false;
    sim.settings.quality = quality;
    let done = wp.whenBuilt();
    wp.choose('aldermere');
    await Promise.race([done, wait(180000)]);
    if (sim.qualityBuilt !== quality) {
      done = wp.whenBuilt();
      sim.applyQualityNow(quality);
      await Promise.race([done, wait(180000)]);
    }
    await Promise.race([SL.ready, wait(60000)]);
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark' });
    if (sim.state === 'paused') sim.resume();
    await Promise.race([SL.ready, wait(60000)]);
  };
  const dress = () => {
    const out = [];
    sim.scene.traverse((o) => {
      if (o.isLOD && o.userData.streetDress) out.push(o);
    });
    return out;
  };
  const carMeshes = () => {
    const out = [];
    sim.scene.traverse((o) => {
      if (o.isInstancedMesh && /^ambient-/.test(o.name) && o.userData.better !== undefined) out.push(o);
    });
    return out;
  };
  try {
    /* ================= HIGH ================= */
    await build('high');
    const town = SL.towns().slice().sort((a, b) => b.r - a.r)[0];
    Object.assign(hold, { x: town.x + 60, y: T.heightAt(town.x, town.z) + 45, z: town.z + 90, on: true });
    run(6);
    // The dressing is loaded on demand: give it a moment to arrive.
    for (let i = 0; i < 40 && !dress().length; i++) await wait(250);
    frame();
    const gl = sim.renderer.getContext();
    const broken = sim.renderer.info.programs.filter((p) => !gl.getProgramParameter(p.program, gl.LINK_STATUS));
    r.ok('better models: every shader links', broken.length === 0, broken.map((p) => (gl.getShaderInfoLog(p.vertexShader) || gl.getShaderInfoLog(p.fragmentShader) || '').slice(0, 300)).join(' | '));

    const cm = carMeshes();
    const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3;
    const own = cm.filter((m) => m.userData.better);
    r.ok('better models: at High the cars, vans, buses and trucks are the better shapes', own.length >= 6 && own.every((m) => m.geometry.attributes.aFixed && tri(m.geometry) >= 250 && tri(m.geometry) <= 700) && cm.filter((m) => !m.userData.better).every((m) => /tractor|firetruck/.test(m.name)), cm.map((m) => `${m.name.slice(8)}${m.userData.better ? '' : '(old)'} ${tri(m.geometry)}`).join(', '));
    const shapes = new Set(sim.ambient.vehicles().map((c) => c.shape));
    r.ok('better models: an estate and an SUV among the cars, with the saloon, hatchback and pick-up', ['car', 'hatch', 'pickup', 'estate', 'suv'].every((k) => shapes.has(k)), [...shapes].join(' '));
    r.ok('better models: one draw a kind, as before (at most 12 kinds)', cm.length <= 12 && cm.every((m) => m.isInstancedMesh), `${cm.length} meshes`);

    const ds = dress();
    const here = ds.filter((d) => Math.hypot(d.position.x - town.x, d.position.z - town.z) < town.r);
    const f = here.length ? here[0].userData.streetDress : null;
    r.ok('better models: the city\'s blocks have shopfronts, awnings and balconies', !!f && f.shops > 40 && f.awnings > 15 && f.balconies > 20, f ? `${f.blocks} blocks: ${f.shops} shop bays, ${f.awnings} awnings, ${f.balconies} balconies, ${f.triangles} triangles` : `${ds.length} dressed towns, none here`);
    r.ok('better models: for a few hundred triangles a block', !!f && f.triangles / f.blocks < 450, f ? `${Math.round(f.triangles / f.blocks)} a block` : '');
    if (here.length) {
      const lod = here[0];
      const inner = lod.levels[0].object;
      frame();
      // (Drawn: it and everything it hangs from is visible.)
      const shown = (o) => {
        for (let q = o; q; q = q.parent) if (!q.visible) return false;
        return true;
      };
      const near = shown(inner);
      // From well away (a camera put 600 m past where it lets go): neither mesh is drawn.
      const away = sim.camera.clone();
      away.position.set(lod.position.x + lod.levels[1].distance + 600, sim.camera.position.y, lod.position.z);
      away.updateMatrixWorld(true);
      lod.update(away);
      const far = shown(inner);
      lod.update(sim.camera);
      r.ok('better models: two draw calls in town, none from away', near === true && far === false && shown(inner) === true && inner.children.length <= 2, `in town ${near ? 'drawn' : 'hidden'}; ${Math.round(lod.levels[1].distance + 600)} m off ${far ? 'drawn' : 'hidden'} (it lets go at ${Math.round(lod.levels[1].distance)} m)`);
    }
    const crowd = sim.scene.getObjectByName('street-life:people');
    const mesh = crowd && crowd.children[0];
    const parts = new Set();
    if (mesh) for (let i = 0; i < mesh.geometry.attributes.aRig.count; i++) parts.add(mesh.geometry.attributes.aRig.getX(i));
    r.ok('better models: the people in the street have a skirt, a jacket and a sun hat to wear, in one draw call', !!mesh && crowd.children.length === 1 && [15, 16, 17].every((p) => parts.has(p)), mesh ? `${mesh.count} people, ${tri(mesh.geometry)} triangles each` : 'no crowd');

    /* ================= LOW ================= */
    sim.quitToMenu();
    await build('low');
    Object.assign(hold, { x: town.x + 60, y: T.heightAt(town.x, town.z) + 45, z: town.z + 90, on: true });
    run(6);
    await wait(1500);
    frame();
    const lowCars = carMeshes();
    r.ok('better models: at Low the cars are the boxes they were, on the plain material', lowCars.length > 0 && lowCars.every((m) => !m.userData.better && !m.geometry.attributes.aFixed), lowCars.map((m) => `${m.name.slice(8)} ${tri(m.geometry)}`).join(', '));
    r.ok('better models: at Low no street dressing is built or drawn', dress().length === 0);
    r.ok('better models: at Low nobody is in the street (as before)', !sim.scene.getObjectByName('street-life:people'));
    r.ok('better models: the dressing is a module of its own, for Medium and up', typeof TD.dressBlocks === 'function' && TD.dressBlocks(null, [{ kind: 'block' }], { quality: 'low', top: () => 0 }).triangles === 0);
  } catch (e) {
    r.ok('better models: ran to the end', false, String(e && e.stack ? e.stack : e).slice(0, 400));
  } finally {
    hold.on = false;
    try {
      sim.quitToMenu();
      sim.settings.performanceMode = before.perf;
      sim.settings.quality = before.quality;
      if (sim.settings.map !== before.map) sim.applySetting('map', before.map);
      if (sim.qualityBuilt !== before.quality) sim.applyQualityNow(before.quality);
    } catch (e) {
      /* the next check builds what it needs */
    }
  }
}

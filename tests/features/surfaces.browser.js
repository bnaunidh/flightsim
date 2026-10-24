/**
 * Browser checks for the reflections lane (render/surfaces.js), in the real
 * renderer: `one-check.mjs <url> ./tests/features/surfaces.browser.js check "" 1`.
 *
 *   - the world's glass, cladding and tarmac are registered, and every one
 *     of their shaders compiles (a frame draws with no program errors — the
 *     fake-sky and puddle chunks are string edits of three's shader, and a
 *     typo there is only ever found here);
 *   - on Low nothing in the scene has an environment map and the glass
 *     carries the fake sky; on Medium+ the sky's environment map is live;
 *   - rain wets the field: after a minute of storm the runway material is
 *     glossy and darker, and a dry spell lets it dry again;
 *   - sunset glints: the glass reflects harder than at noon;
 *   - night lights the offices, the terminal's landside and the town's
 *     blocks (emissive on), and day puts them out;
 *   - the rooftop plant is drawn near the town and hidden 3 km away.
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail).
 */

async function load(path) {
  try {
    return await import(path);
  } catch (e) {
    return { __error: String((e && e.message) || e) };
  }
}

export async function check(sim, r, say = () => {}) {
  say('surfaces: loading');
  const THREE = await load('../../src/vendor/three.module.js');
  const SF = await load('../../src/render/surfaces.js');
  const mods = { THREE, SF };
  const missing = Object.entries(mods).filter(([, m]) => !m || m.__error).map(([k, m]) => `${k}: ${m && m.__error}`);
  r.ok('surfaces: its modules load', missing.length === 0, missing.join(' | '));
  if (missing.length) return r;

  const tier = sim.qualityBuilt || sim.settings.quality;
  const dt = 1 / 60;
  const draw = () => (sim.renderFrame ? sim.renderFrame() : sim.renderer.render(sim.scene, sim.camera));
  const run = (secs) => {
    const n = Math.round(secs / dt);
    for (let i = 0; i < n; i++) sim.update(dt);
  };
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => { errors.push(a.map(String).join(' ')); origErr.apply(console, a); };

  try {
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90, airborne: false });
    sim.weather.setRandomWinds && sim.weather.setRandomWinds(false);
    sim.input.throttleTarget = 0;
    run(1);
    const counts = SF.surfaceCounts();
    r.ok(`surfaces (${tier}): the world registered glass, metal and wet tarmac`, counts.glass >= 2 && counts.metal >= 1 && counts.wet >= 3, JSON.stringify(counts));

    // Every registered material is drawn at least once from the apron, so
    // its program is compiled here.
    const mats = new Set();
    sim.scene.traverse((o) => { if (o.material && o.material.userData && o.material.userData.surface) mats.add(o.material); });
    r.ok(`surfaces (${tier}): the registered materials are on meshes in the scene`, mats.size >= 4, `${mats.size}`);
    const lay = (await load('../../src/world/airport.js')).airportLayout();
    const T = lay.terminal;
    const elev = sim.aircraft.pos.y;
    const cam = sim.camera;
    const place = (px, py, pz, lx, ly, lz) => { cam.position.set(px, py, pz); cam.lookAt(lx, ly, lz); cam.updateMatrixWorld(true); };
    const tx = T ? (T.rect.x0 + T.rect.x1) / 2 : sim.aircraft.pos.x;
    const tz = T ? (T.rect.z0 + T.rect.z1) / 2 : sim.aircraft.pos.z;
    const side = lay.side || -1;
    const look = () => place(tx + 90, elev + 6, tz - side * 110, tx, elev + 8, tz);
    errors.length = 0;
    for (let i = 0; i < 3; i++) { sim.update(dt); look(); draw(); }
    const gl = sim.renderer.getContext();
    r.ok(`surfaces (${tier}): a frame of the terminal draws with no shader or GL error`, errors.length === 0 && gl.getError() === gl.NO_ERROR, errors.slice(0, 2).join(' | '));
    const programs = sim.renderer.info.programs || [];
    const bad = programs.filter((p) => p.diagnostics && !p.diagnostics.runnable);
    r.ok(`surfaces (${tier}): every compiled program runs`, bad.length === 0, bad.map((p) => p.name).join(','));

    if (tier === 'low') {
      let withEnv = 0;
      let fake = 0;
      for (const m of mats) {
        if (m.envMap) withEnv++;
        if (m.userData.fakeSky) fake++;
      }
      r.ok('surfaces (low): no environment map anywhere, the fake sky on the glass', sim.scene.environment === null && withEnv === 0 && fake >= 3, `env ${withEnv} fake ${fake}`);
    } else {
      r.ok(`surfaces (${tier}): the sky's environment map is live`, !!sim.scene.environment && sim.sky.envReady === true);
      r.ok(`surfaces (${tier}): the runway carries its (wet-gated) puddle map`, !!(sim.airport.runwayMat.roughnessMap && sim.airport.runwayMat.userData.puddlesGated));
    }

    // Rain.
    const rw = sim.airport.runwayMat;
    const dryR = rw.roughness;
    const dryC = rw.color.getHex();
    sim.weather.load({ time: 'day', condition: 'stormy', windSpeedKts: 4, windDirDeg: 90 });
    run(60);
    r.ok(`surfaces (${tier}): a minute of storm soaks the field`, SF.fieldWetness() > 0.95 && rw.roughness < 0.4 && rw.color.getHex() < dryC, `wet ${SF.fieldWetness().toFixed(2)} rough ${rw.roughness.toFixed(2)}`);
    errors.length = 0;
    for (let i = 0; i < 3; i++) { sim.update(dt); look(); draw(); }
    r.ok(`surfaces (${tier}): the wet field draws clean`, errors.length === 0 && gl.getError() === gl.NO_ERROR);
    sim.weather.load({ time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
    run(300);
    r.ok(`surfaces (${tier}): five dry minutes dry it out, the runway as it was`, SF.fieldWetness() === 0 && rw.roughness === dryR && rw.color.getHex() === dryC, `wet ${SF.fieldWetness().toFixed(2)}`);

    // Sunset glint.
    const glassMat = [...mats].find((m) => m.userData.surface.kind === 'glass');
    const noon = glassMat.envMapIntensity;
    sim.weather.load({ time: 'sunset', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
    run(0.5);
    r.ok(`surfaces (${tier}): at a clear sunset the glass glints`, SF.sunGlint() > 0.7 && glassMat.envMapIntensity > noon * 1.5, `glint ${SF.sunGlint().toFixed(2)} ${noon.toFixed(2)} -> ${glassMat.envMapIntensity.toFixed(2)}`);
    errors.length = 0;
    for (let i = 0; i < 3; i++) { sim.update(dt); look(); draw(); }
    r.ok(`surfaces (${tier}): the sunset draws clean`, errors.length === 0);

    // Night.
    sim.weather.load({ time: 'night', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
    run(1);
    const officeLit = sim.airport.mats.wall.emissiveIntensity > 0;
    const terminalLit = sim.apron && sim.apron.mats.wall.emissiveIntensity > 0 && sim.apron.glassMat && sim.apron.glassMat.emissiveIntensity > 0;
    const town = sim.scenery && sim.scenery.town;
    const blocksLit = town && town.nightMats.filter((m) => m.emissiveMap).every((m) => m.emissiveIntensity > 0);
    r.ok(`surfaces (${tier}): night lights the offices, the terminal and the town's blocks`, officeLit && terminalLit && blocksLit, `${officeLit} ${terminalLit} ${blocksLit}`);
    r.ok(`surfaces (${tier}): no glint at night`, SF.sunGlint() === 0);
    sim.weather.load({ time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
    run(1);
    r.ok(`surfaces (${tier}): day puts them out`, sim.airport.mats.wall.emissiveIntensity === 0 && (!sim.apron || sim.apron.mats.wall.emissiveIntensity === 0));

    // Rooftop LOD.
    if (town && town.rooftops && town.rooftops.meshes.length && sim.scenery.lod) {
      const m = town.rooftops.meshes[0];
      const c = m.boundingSphere.center;
      sim.scenery.lod(new THREE.Vector3(c.x + 200, c.y + 50, c.z));
      const near = m.visible;
      sim.scenery.lod(new THREE.Vector3(c.x + 3000 + m.boundingSphere.radius, c.y + 50, c.z));
      const far = m.visible;
      sim.scenery.lod(new THREE.Vector3(c.x + 200, c.y + 50, c.z));
      r.ok(`surfaces (${tier}): the rooftop plant shows near the town and hides 3 km off`, near === true && far === false && m.visible === true, `${near} ${far}`);
    }
    // A new flight starts as wet as its weather — not drying out from the
    // last flight's storm, and not dry under a storm for the first 30 s.
    sim.weather.load({ time: 'day', condition: 'stormy', windSpeedKts: 4, windDirDeg: 90 });
    run(60);
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90, airborne: false });
    run(0.1);
    const afterClear = SF.fieldWetness();
    await sim.startMode('free', { aircraft: 'skylark', time: 'day', condition: 'stormy', windSpeedKts: 4, windDirDeg: 90, airborne: false });
    run(0.1);
    const afterStorm = SF.fieldWetness();
    r.ok(`surfaces (${tier}): a new flight starts with the field as wet as its weather`, afterClear === 0 && afterStorm === 1, `clear ${afterClear.toFixed(2)} storm ${afterStorm.toFixed(2)}`);
  } finally {
    console.error = origErr;
    if (sim.quitToMenu) sim.quitToMenu();
  }
  return r;
}

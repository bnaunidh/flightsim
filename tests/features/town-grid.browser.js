/**
 * The World Map's towns in the real game (worldmap/town-grid.js, town-stream.js,
 * world/skyline.js): `node tests/features/town-grid.mjs` holds the plan; this holds
 * what is drawn from it.
 *
 *   1. High, over Gateway: every program links, the town's buildings arrive from the
 *      worker, a few draw calls whatever the count, inside the pools, with no
 *      refill hitch; a cell costs a memcpy
 *   2. Solid: low over a street the houses round the aeroplane are obstacles, a
 *      real house among them; climbing takes them all away again
 *   3. Rising out of the paint: a house near the camera is full height, one past
 *      the radius is not drawn (nothing doubles): the shader's sum, checked here
 *   4. Skyline: the glass is one mesh; every tower has its pieces; lit at night
 *   5. Shimmer: the town's paint and buildings from 3,000 ft and 8,000 ft are steady
 *   6. Low: real houses near the aeroplane, cheaper shapes, no extras
 *
 * `check(sim, r, say)`, as tests/features/index.js expects.
 */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function goto(sim, x, z, agl, hdg = 315, n = 40) {
  const ac = sim.aircraft;
  for (let i = 0; i < n; i++) {
    ac.reset({ pos: new ac.pos.constructor(x, 0, z), headingDeg: hdg, speed: 90, altAGL: agl, engineOn: true, fuel: 1 });
    sim.step(1 / 30);
    await sleep(25);
  }
}

export async function check(sim, r, say = () => {}) {
  const T = await import('../../src/world/terrain.js');
  const G = await import('../../src/world/worldmap/town-grid.js');
  const P = await import('../flicker-probe.js');
  const wp = sim.worldPreview;
  r.ok('towns: the World Map feature is here', !!wp);
  if (!wp) return;
  sim.autoPauseOnHide = false;
  const startMap = sim.settings.map;
  const startQuality = sim.settings.quality;
  const enter = async (q) => {
    if (sim.settings.quality !== q) {
      sim.applySetting('quality', q);
      await sleep(300);
    }
    sim.applySetting('map', wp.id);
    await sleep(300);
    const done = wp.whenBuilt();
    wp.choose('haven');
    await Promise.race([done, sleep(200000)]);
    await sleep(100);
    await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
  };
  try {
    /* ---- 1 ---- */
    say('towns: High over Gateway');
    await enter('high');
    await goto(sim, -55700, 8100, 200);
    const gl = sim.renderer.getContext();
    sim.renderer.render(sim.scene, sim.camera);
    const broken = sim.renderer.info.programs.filter((p) => !gl.getProgramParameter(p.program, gl.LINK_STATUS));
    r.ok('towns: every shader links', broken.length === 0, broken.map((p) => gl.getShaderInfoLog(p.fragmentShader).slice(0, 300)).join(' | '));
    const S = wp.towns3d();
    const st = S.stats();
    r.ok('towns: the buildings came from the worker', st.workerCells > 3 && st.cpuCells === 0, JSON.stringify({ worker: st.workerCells, cpu: st.cpuCells }));
    r.ok('towns: thousands of buildings on the screen\'s side of town, three or more house types', st.drawn > 1500 && st.kinds.slice(0, 4).filter((n) => n > 20).length >= 3, `${st.drawn} instances ${st.kinds.join(',')}`);
    r.ok('towns: a dozen draw calls at the most, one per kind', S.meshes.filter((m) => m && m.visible).length <= 12, `${st.meshes}`);
    r.ok('towns: inside the pools', S.meshes.every((m) => !m || m.count <= m.instanceMatrix.count), S.meshes.map((m) => (m ? `${m.count}/${m.instanceMatrix.count}` : '-')).join(' '));
    r.ok('towns: no refill hitch (a memcpy, not a rebuild)', st.maxRefillMs < 8, `${st.maxRefillMs.toFixed(2)} ms`);

    /* ---- 2 ---- */
    say('towns: solid');
    const ctx = S.ctx;
    const F = ctx.towns.find((t) => t.name === 'Aldermere');
    let house = null;
    for (const c of S.cells.values()) {
      if (!c.cell || !c.cell.kinds[0].n) continue;
      const m = c.cell.kinds[0].m;
      const x = m[12] + c.ix * G.TOWN_CELL;
      const z = m[14] + c.iz * G.TOWN_CELL;
      if (Math.hypot(x - F.cx, z - F.cz) < 1000) { house = { x, z, y: m[13] }; break; }
    }
    r.ok('towns: found a house to fly at', !!house);
    if (house) {
      await goto(sim, house.x, house.z, 60, 315, 10);
      const before = S.stats().solid;
      const hit = T.obstacleAt(house.x, house.y + 3, house.z);
      r.ok('towns: low down, the houses round the aeroplane are solid', before > 20 && before < 1200 && !!hit, `${before} boxes, ${hit ? hit.what : 'nothing'} at the house`);
      await goto(sim, house.x, house.z, 400, 315, 10);
      r.ok('towns: climbing away takes them off the list again', S.stats().solid === 0, `${S.stats().solid} left`);
    }

    /* ---- 3 ---- */
    const uR = (await import('../../src/world/worldmap/world-terrain.js')).TOWN_SHADE.uTownR.value;
    r.ok('towns: the paint knows how far the real buildings reach', uR === G.TOWN_TIERS.high.radius, `${uR} m`);

    /* ---- 4 ---- */
    say('towns: the skyline');
    const outs = wp.outstations();
    const glass = [];
    outs.group.traverse((o) => { if (/^skyline-.*-glass$/.test(o.name)) glass.push(o); });
    r.ok('towns: every city\'s towers are one mesh of glass and one of trim', glass.length >= 3, glass.map((g) => g.name).join(', '));
    const city = outs.towns.find((t) => t.town.name === 'Aldermere');
    r.ok('towns: Gateway\'s skyline', city.built.towers >= 15 && city.built.tallest > 110, `${city.built.towers} towers, tallest ${Math.round(city.built.tallest)} m`);

    /* ---- 5 ---- */
    say('towns: steady from the air');
    // Nearly still (4 m/s): at flying speed a detailed picture sliding past is motion, which the probe can't tell from
    // shimmer. The sea and the land round it measure 0.5% at 8,000 ft on their own, with no town at all (WCAG 1.8-2.3%).
    const spot = { at: { x: F.cx, z: F.cz }, view: 'chase', look: 'down', dive: 32, heading: 315, aircraft: 'skylark', speed: 4 };
    await P.runScenario(sim, { ...spot, altFt: 3000 }, { frames: 10, fps: 30, raycast: false }); // brings the cells in
    for (const [altFt, most] of [[3000, 0.005], [8000, 0.007]]) {
      const m = await P.runScenario(sim, { ...spot, altFt }, { frames: 45, fps: 30, raycast: false });
      r.ok(`towns: the town from ${altFt} ft is steady (under ${most * 100}% of the screen)`, m.percArea <= most, `${(m.percArea * 100).toFixed(2)}%, WCAG ${(m.wcagWindow * 100).toFixed(2)}%`);
    }

    /* ---- 6 ---- */
    say('towns: Low');
    await enter('low');
    await goto(sim, -55700, 8100, 150);
    const L = wp.towns3d();
    const ls = L.stats();
    r.ok('towns: Low has real houses round the aeroplane', ls.kinds.slice(0, 4).reduce((a, b) => a + b, 0) > 300, ls.kinds.join(','));
    r.ok('towns: and no fences, garages or cars', !L.meshes[G.KIND.FENCE] && !L.meshes[G.KIND.CAR] && !L.meshes[G.KIND.GARAGE]);
    const tris = (m) => (m ? m.geometry.index.count / 3 : 0);
    r.ok('towns: a Low house is a couple of dozen triangles', tris(L.meshes[0]) <= 24, `${tris(L.meshes[0])}`);
  } finally {
    sim.quitToMenu && sim.state !== 'menu' && sim.quitToMenu();
    if (sim.settings.quality !== startQuality) sim.applySetting('quality', startQuality);
    if (startMap) sim.applySetting('map', startMap);
  }
}

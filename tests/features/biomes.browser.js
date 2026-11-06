/**
 * The biomes in the real game (`node tests/features/biomes.mjs` holds the rules).
 *
 *   1. High, over the jungle: every program links, the ground carries aBiome, the
 *      trees are the jungle's, the cards are one draw call for all their species
 *   2. Medium, in the jungle: the near real trees still take over from the pool
 *   3. Low: the trees are cards, one mesh, several species in it, no second worker
 *   4. The weather's snow lies on the woods and the fields, and off again
 *
 * `check(sim, r, say)`, as tests/features/index.js expects.
 */
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

async function goto(sim, x, z, agl, hdg = 170, n = 60) {
  const ac = sim.aircraft;
  for (let i = 0; i < n; i++) {
    ac.reset({ pos: new ac.pos.constructor(x, 0, z), headingDeg: hdg, speed: 60, altAGL: agl, engineOn: true, fuel: 1 });
    sim.step(1 / 30);
    await sleep(25);
  }
}

async function build(sim, q, id = 'frigate') {
  sim.applySetting('quality', q);
  for (let i = 0; i < 200 && sim.qualityBuilt !== q; i++) await sleep(100);
  const wp = sim.worldPreview;
  const done = wp.whenBuilt();
  wp.choose(id);
  await Promise.race([done, sleep(120000)]);
  await sim.startMode('free', { loadingScreen: false, airborne: true, aircraft: 'skylark', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 0, fuel: 1 });
  if (sim.state === 'paused') sim.resume();
  return wp;
}

export async function check(sim, r) {
  await sim.featuresReady;
  const before = { q: sim.settings.quality, auto: sim.settings.qualityAuto };
  const FL = await import('../../src/world/worldmap/flora.js');
  const RT = await import('../../src/world/real-trees.js');
  const { SNOW_COVER } = await import('../../src/render/surfaces.js');
  const gl = sim.renderer.getContext();
  const errs = () => (sim.renderer.info.programs || []).filter((p) => p.diagnostics && !p.diagnostics.runnable).length;
  try {
    /* ---- High ---- */
    let wp = await build(sim, 'high');
    await goto(sim, 49000, 37000, 300);
    r.ok('biomes: every program links on High', errs() === 0 && gl.getError() === 0, `${errs()} broken`);
    const tile = [...wp.stream().tiles.values()].find((t) => t.mesh && t.mesh.geometry && t.mesh.geometry.attributes.aBiome);
    const bytes = tile ? tile.mesh.geometry.attributes.aBiome.array : [];
    let jungle = 0;
    for (let i = 2; i < bytes.length; i += 4) jungle = Math.max(jungle, bytes[i]);
    r.ok('biomes: the ground carries the biome weights (jungle here)', !!tile && jungle > 200, `max ${jungle}`);
    const kinds = wp.flora().meshes.filter((m) => m.count > 0).map((m) => m.name.split(':')[1]);
    r.ok('biomes: the jungle\'s own trees, a few meshes of them', kinds.includes('hardwood') && kinds.length <= 8, kinds.join(', '));
    const cards = wp.cards();
    const live = cards.meshes.filter((m) => m.count > 0);
    const aKind = live[0] && live[0].geometry.attributes.aKind;
    const shown = new Set();
    if (aKind) for (let i = 0; i < live[0].count; i++) shown.add(aKind.array[i]);
    r.ok('biomes: the cards are one draw call for all their species', cards.meshes.length === 1 && live.length === 1 && shown.size >= 2, `${live[0] ? live[0].count : 0} cards of ${[...shown].map((k) => FL.SPECIES[k]).join(', ')}`);

    /* ---- Medium: the near swap ---- */
    wp = await build(sim, 'medium');
    await goto(sim, 49000, 37000, 40, 170, 90);
    for (let i = 0; i < 20; i++) {
      RT.updateRealTrees({ x: 49000, y: sim.aircraft.pos.y, z: 37000, position: sim.aircraft.pos }, 1);
      sim.step(1 / 30);
      await sleep(40);
    }
    const st = RT.realTreeStats();
    r.ok('biomes: the near real trees still take over in the jungle (Medium)', st.tier === 'medium' && st.sources >= 4, JSON.stringify(st));

    /* ---- Low ---- */
    wp = await build(sim, 'low');
    await goto(sim, 49000, 37000, 300);
    const fl = wp.flora();
    const m = fl.meshes[0];
    const seen = new Set();
    const k = m && m.geometry.attributes.aKind;
    if (k) for (let i = 0; i < m.count; i++) seen.add(k.array[i]);
    r.ok('biomes: Low\'s trees are cards, one mesh, several species, inside the pool', fl.meshes.length === 1 && m.count > 50 && seen.size >= 2 && m.count <= m.instanceMatrix.count, `${m.count} trees of ${[...seen].map((i) => FL.SPECIES[i]).join(', ')}`);
    r.ok('biomes: Low has no card pool of its own', !wp.cards());
    r.ok('biomes: every program links on Low', errs() === 0, `${errs()} broken`);

    /* ---- snow ---- */
    await goto(sim, -66000, 11000, 900, 90, 30);
    const px = () => {
      sim.renderer.render(sim.scene, sim.camera);
      const c = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, c);
      return [...c];
    };
    const was = SNOW_COVER.value;
    const dry = px();
    SNOW_COVER.value = 1;
    const white = px();
    SNOW_COVER.value = was;
    const back = px();
    const lum = (c) => c[0] + c[1] + c[2];
    r.ok('biomes: the weather\'s snow lies on the woods and fields, and goes again', lum(white) > lum(dry) + 90 && Math.abs(lum(back) - lum(dry)) < 30, `${dry} -> ${white} -> ${back}`);
  } finally {
    SNOW_COVER.value = 0;
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    sim.applySetting('quality', before.q);
    sim.settings.qualityAuto = before.auto;
  }
}

/**
 * Cloud types (wave 19, item 5).
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/clouds.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   - each phase draws its own clouds: fair-weather cumulus (no storm
 *     cells), far-off cells (cumulonimbus columns with anvils and rain
 *     shafts), a thunderstorm (cells, scud under the rain), overcast (the
 *     decks), clear (almost nothing)
 *   - cumulus have flat bases at the cloud base, a few metres apart
 *   - nothing pops: when the weather changes, no puff's opacity jumps in a
 *     frame; a puff at the edge of the field is faded out before it wraps
 *   - the decks are grey from under and sunlit from above
 *   - the storm cells' lightning: none with Reduce flashing on
 *   - every phase renders without an error
 * The weather is put back afterwards.
 */
export async function check(sim, r, say = () => {}) {
  const WX = await import('../../src/world/wx.js');
  const FS = await import('../../src/render/flash-safety.js');
  const before = JSON.parse(JSON.stringify(sim.settings.weather));
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 200));
    oe.apply(console, a);
  };
  try {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark', time: 'day', condition: 'random', windSpeedKts: 8, windDirDeg: 250, airborne: true });
    const w = sim.weather;
    const C = sim.clouds;
    const ac = sim.aircraft;
    const P = ac.pos.constructor;
    ac.reset({ pos: new P(-6000, 0, 300), headingDeg: 90, speed: 60, altAGL: 500, engineOn: true, fuel: 1 });
    const count = () => {
      const k = { cu: 0, cb: 0, scud: 0, anvil: 0 };
      for (const p of C.puffs) {
        if (p.vis < 0.5) continue;
        k[['cu', 'cb', 'scud', 'anvil'][p.kind]]++;
      }
      return k;
    };
    const phase = (id, secs = 25) => {
      w.wx.lines[w.wx.here] = new WX.WxTimeline(11, { start: id });
      for (let i = 0; i < secs; i++) sim.step(1, 1 / 20);
      return count();
    };
    const fair = phase('fair');
    const cells = phase('cells');
    const shafts = C.shafts ? C.shafts.mesh.visible : null;
    const storm = phase('storm');
    const overcast = phase('overcast');
    const decks = C.decks.filter((d) => d.visible).length;
    const clear = phase('clear');
    const tier = sim.qualityBuilt;
    r.ok('clouds: each phase draws its own clouds (fair cumulus; far cells with anvils and shafts; a storm with scud; overcast decks; clear almost nothing)',
      fair.cu > 20 && fair.cb === 0 && cells.cb > 0 && cells.anvil > 0 && (shafts === null || shafts) && storm.cb > 0 && storm.scud > 0 && decks >= 1 && clear.cu < fair.cu && clear.cb === 0,
      `fair ${JSON.stringify(fair)}; cells ${JSON.stringify(cells)} shafts ${shafts}; storm ${JSON.stringify(storm)}; overcast decks ${decks}; clear ${JSON.stringify(clear)} (${tier})`);

    // Flat bases.
    phase('scattered');
    const base = w.cond.cloudBase;
    let n = 0;
    let bad = 0;
    for (const p of C.puffs) {
      if (p.kind !== 0 || p.vis < 0.5 || (p.tower != null && p.level > 0)) continue;
      const b = C.batches[p.batch];
      const flat = b.kinds[p.index * 2];
      const bottom = b.offsets[p.index * 3 + 1] - b.scales[p.index * 2 + 1] * 0.5;
      n++;
      // The flat base within the layer's few tens of metres, and the puff reaching below it (so it IS cut flat).
      if (!(flat >= base - 1 && flat <= base + 40 && bottom < flat)) bad++;
    }
    r.ok('clouds: cumulus have flat bases at the cloud base, a few metres apart', n > 20 && bad === 0, `${n} cumulus, ${bad} off; base ${base.toFixed(0)} m`);

    // No pops: the weather changes (scattered cloud into heavy rain, the way a phase does,
    // blending) and every puff is watched, a twentieth of a second at a time, for half a minute.
    const alphaOf = () => C.puffs.map((p) => C.batches[p.batch].alphas[p.index]);
    // Away from the field (a change that thickens the murk waits for an approach).
    ac.reset({ pos: new P(-30000, 0, 300), headingDeg: 90, speed: 60, altAGL: 1500, engineOn: true, fuel: 1 });
    sim.step(0.2);
    const L = w.wx.lines[w.wx.here];
    L.next = 'heavyRain';
    L.blendDur = L._blendFor(L.phase, L.next);
    L.warned = true;
    L.t = L.dur - 0.5;
    let a0 = alphaOf();
    let worst = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(1 / 20, 1 / 20);
      const a1 = alphaOf();
      for (let j = 0; j < a1.length; j++) worst = Math.max(worst, Math.abs(a1[j] - a0[j]));
      a0 = a1;
    }
    // And at the edge of the field: faded before the wrap.
    let edgeMax = 0;
    for (const p of C.puffs) {
      if (p.kind === 1 || p.kind === 3) continue;
      const b = C.batches[p.batch];
      const x = b.offsets[p.index * 3];
      const z = b.offsets[p.index * 3 + 2];
      const e = Math.max(Math.abs(x - ac.pos.x), Math.abs(z - ac.pos.z));
      if (e > 8900) edgeMax = Math.max(edgeMax, b.alphas[p.index]);
    }
    r.ok('clouds: nothing pops — a change of weather fades puffs in and out, and the field\'s edge is faded before it wraps', worst < 0.012 && edgeMax < 0.05 && L.k > 0.05, `biggest change in a twentieth of a second ${worst.toFixed(3)} (${L.phase} → ${L.next}, ${(L.k * 100).toFixed(0)}% in), brightest puff at the edge ${edgeMax.toFixed(3)}`);

    // Decks: grey from under, sunlit from above.
    phase('overcast', 5);
    const db = w.cond.cloudBase;
    ac.reset({ pos: new P(-6000, 0, 300), headingDeg: 90, speed: 60, altAGL: Math.max(80, db - 300), engineOn: true, fuel: 1 });
    sim.step(0.5);
    const under = C.decks[0].material.color.clone();
    ac.reset({ pos: new P(-6000, 0, 300), headingDeg: 90, speed: 60, altAGL: db + 900, engineOn: true, fuel: 1 });
    sim.step(0.5);
    const over = C.decks[0].material.color.clone();
    const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
    r.ok('clouds: the overcast deck is grey from under and sunlit from above (break out on top into sun)', lum(over) > lum(under) * 1.15, `under ${lum(under).toFixed(2)}, above ${lum(over).toFixed(2)}`);

    // Lightning in the cells: none with Reduce flashing on.
    const was = FS.FLASH.reduce;
    FS.setReduceFlashing(true);
    phase('storm', 5);
    let maxCell = 0;
    let maxFlash = 0;
    for (let i = 0; i < 45; i++) {
      sim.step(1, 1 / 20);
      maxCell = Math.max(maxCell, w.cellFlash);
      maxFlash = Math.max(maxFlash, w.lightningFlash);
    }
    FS.setReduceFlashing(was);
    r.ok('clouds: with Reduce flashing on, a thunderstorm has no lightning at all (sky or cells)', maxCell === 0 && maxFlash === 0, `cell ${maxCell}, sky ${maxFlash}`);
    // Golden hour: the undersides warm.
    phase('fair', 2);
    const dayTint = C.batches[0].material.uniforms.uBaseTint.value.clone();
    const was2 = w.time;
    w.time = 'sunset';
    sim.step(0.2);
    const duskTint = C.batches[0].material.uniforms.uBaseTint.value.clone();
    w.time = was2;
    r.ok('clouds: at sunset the clouds\' undersides are lit warm (golden hour)', duskTint.r - duskTint.b > dayTint.r - dayTint.b + 0.08, `day #${dayTint.getHexString()}, sunset #${duskTint.getHexString()}`);
    // Every cloud program links (a precision mismatch between the stages once left them all undrawn).
    const gl = sim.renderer.getContext();
    const mats = [...C.batches.map((b) => b.material), ...(C.shafts ? [C.shafts.material] : [])];
    sim.renderFrame();
    const linked = mats.map((m) => {
      const pr = sim.renderer.properties.get(m);
      const p = pr && pr.currentProgram && pr.currentProgram.program;
      return p ? gl.getProgramParameter(p, gl.LINK_STATUS) === true : null;
    });
    r.ok('clouds: every cloud program is compiled and linked (the puffs and the rain shafts are really drawn)', linked.every((v) => v === true || v === null) && linked.filter((v) => v === true).length >= 3, linked.join(', '));
    r.ok('clouds: every phase renders without an error', errors.length === 0, errors.slice(0, 2).join(' / ') || 'none');
  } finally {
    console.error = oe;
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    sim.settings.weather = before;
    sim.weather.load(before);
  }
}

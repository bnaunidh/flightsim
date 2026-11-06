/**
 * The cloud layer in the game (world/cloud-deck.js; the sums are cloud-deck.mjs).
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/cloud-deck.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   - the layer is there on the built tier, its program links
 *   - one field: straight down from 15,000 ft a gap shows the sea and thick
 *     cloud shows white, where the CPU's sums say; the fog agrees at 6,000
 *     ft; the ordinary clouds stand aside in a gap; the shadow lands by it
 *   - the climb: the white-out rises smoothly, is deepest near the tops and
 *     gone over them, without a jump a frame, also through the tops in a jet;
 *     a fast run through patches stays under three swings a second
 *   - over the tops: clear sky, thin fog, no rain, on the heaviest sky
 *   - a change of sky eases in; a thinned sky takes the layer away
 *   - the sky choices, and CONDITIONS left as it was
 */
export async function check(sim, r, say = () => {}) {
  const W = await import('../../src/world/weather.js');
  const D = await import('../../src/world/cloud-deck.js');
  const CL = await import('../../src/world/clouds.js');
  const before = JSON.stringify(W.CONDITIONS);
  const saved = JSON.parse(JSON.stringify(sim.settings.weather));
  const errors = [];
  const oe = console.error;
  console.error = (...a) => {
    errors.push(a.map(String).join(' ').slice(0, 200));
    oe.apply(console, a);
  };
  try {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark', time: 'day', condition: 'cloudy', windSpeedKts: 6, windDirDeg: 250, airborne: true });
    const w = sim.weather;
    const C = sim.clouds;
    const L = C.layer;
    const ac = sim.aircraft;
    const P = ac.pos.constructor;
    r.ok('deck: the layer is attached, sheets by tier', !!L && L.count >= 1 && L.mesh.parent != null, L ? `${L.count} sheets at ${sim.qualityBuilt}` : 'none');
    L.now = () => 1.8e12;
    L.snap();
    sim.step(0.1);
    const secs = 1.8e9;
    r.ok('deck: the field is where the wall clock says (players who share a sky share its holes)', L.ox === (D.DRIFT.x * secs) % D.FIELD_SIZE && L.oz === (D.DRIFT.z * secs) % D.FIELD_SIZE, `${L.ox.toFixed(0)}, ${L.oz.toFixed(0)}`);
    // Spots over open sea: a hole wide enough to look down, and thick cloud.
    const sea = (x, z) => C.groundAt(x, z) <= 0;
    const wide = (x, z, f) => [0, 400, -400].every((a) => [0, 400, -400].every((b) => f(x + a, z + b)));
    let gap = null;
    let thick = null;
    for (let i = 0; i < 6000 && !(gap && thick); i++) {
      const a = i * 2.399963;
      const d = 300 * Math.sqrt(i);
      const x = ac.pos.x + Math.cos(a) * d;
      const z = ac.pos.z + Math.sin(a) * d;
      if (!sea(x, z)) continue;
      if (!gap && wide(x, z, (u, v) => L.gapMask(u, v) === 0)) gap = { x, z };
      if (!thick && wide(x, z, (u, v) => L.densityAt(u, v, 2800) > 0.6 && L.densityAt(u, v, 1829) > 0.4)) thick = { x, z };
    }
    r.ok('deck: there is a hole and there is thick cloud, near', !!gap && !!thick, JSON.stringify({ gap, thick }));
    const at = (s, y) => {
      ac.reset({ pos: new P(s.x, 0, s.z), headingDeg: 90, speed: 70, altAGL: 100, engineOn: true, fuel: 1 });
      ac.pos.y = y;
      L.snap();
      sim.step(0.05, 1 / 20);
      ac.pos.y = y;
      L.snap();
      sim.step(0.05, 1 / 20);
    };
    const gl = sim.renderer.getContext();
    const pixelDown = (s) => {
      at(s, 4572);
      const m = sim.model && sim.model.visible;
      if (sim.model) sim.model.visible = false;
      const cam = sim.camera;
      cam.position.set(s.x, 4572, s.z);
      cam.lookAt(s.x + 0.1, 0, s.z);
      cam.updateMatrixWorld(true);
      sim.renderFrame();
      const px = new Uint8Array(4);
      gl.readPixels(gl.drawingBufferWidth >> 1, gl.drawingBufferHeight >> 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      if (sim.model) sim.model.visible = m;
      return [...px];
    };
    const pGap = pixelDown(gap);
    const pThick = pixelDown(thick);
    r.ok('deck: what is drawn is the field: down a gap the sea, down onto thick cloud white', pGap[0] < 120 && pThick[0] > 180 && pThick[1] > 180, `gap rgb ${pGap.slice(0, 3)}, cloud rgb ${pThick.slice(0, 3)}`);

    at(gap, 1829);
    const imGap = sim.cloudImmersion;
    at(thick, 1829);
    const imThick = sim.cloudImmersion;
    r.ok('deck: the fog is the same field: clear in the gap, white in the cloud, at the same height', imGap < 0.02 && imThick > 0.3, `gap ${imGap.toFixed(2)}, cloud ${imThick.toFixed(2)}`);

    // The ordinary clouds stand aside.
    at(gap, 500);
    sim.step(0.2);
    let inGap = 0;
    let worst = 0;
    for (const p of C.puffs) {
      if (p.kind === 1 || p.kind === 3) continue;
      const b = C.batches[p.batch];
      const x = b.offsets[p.index * 3];
      const z = b.offsets[p.index * 3 + 2];
      if (b.scales[p.index * 2] <= 0 || L.gapMask(x, z) > 0) continue;
      inGap++;
      worst = Math.max(worst, b.alphas[p.index]);
    }
    r.ok('deck: no ordinary cloud stands in a gap', worst === 0, `${inGap} puffs over gaps, brightest ${worst.toFixed(3)}`);

    // The shadow (Medium and up): where the layer's own sum says shade, the ground is shaded more than where it says sun.
    if (C.shadows) {
      at(thick, 300);
      C._shadowT = 1;
      sim.step(0.1);
      sim.step(0.5, 1 / 20);
      let hi = 0, nHi = 0, lo = 0, nLo = 0;
      for (let i = 0; i < 400; i++) {
        const x = ac.pos.x + (i % 20 - 10) * 500;
        const z = ac.pos.z + (Math.floor(i / 20) - 10) * 500;
        const want = L.shadeAt(x, z);
        const got = CL.cloudShadow.shadeAt(x, z);
        if (want > 0.6) { hi += got; nHi++; } else if (want < 0.01) { lo += got; nLo++; }
      }
      r.ok('deck: the shadow is the same field: shade under the cloud, sun down the gaps', (nHi === 0 || nLo === 0) || hi / nHi > lo / nLo + 0.1, `${(hi / Math.max(1, nHi)).toFixed(2)} (${nHi}) vs ${(lo / Math.max(1, nLo)).toFixed(2)} (${nLo})`);
    }

    // The climb through: smooth, white at the top, gone over it.
    const climb = (s, rate) => {
      at(s, 900);
      const seq = [];
      let y = 900;
      let last = sim.cloudImmersion;
      let jump = 0;
      while (y < 3400) {
        y += rate / 60;
        ac.pos.y = y;
        ac.pos.x = s.x;
        ac.pos.z = s.z;
        sim.step(1 / 60, 1 / 60);
        ac.pos.y = y;
        const im = sim.cloudImmersion;
        jump = Math.max(jump, Math.abs(im - last));
        last = im;
        seq.push({ y, im });
      }
      for (let i = 0; i < 180; i++) {
        sim.step(1 / 60, 1 / 60);
        ac.pos.y = y;
      }
      return { seq, jump, end: sim.cloudImmersion };
    };
    const slow = climb(thick, 60);
    const band = (a, b) => {
      const v = slow.seq.filter((o) => o.y >= a && o.y < b).map((o) => o.im);
      return v.reduce((s, x) => s + x, 0) / Math.max(1, v.length);
    };
    const bands = [[1500, 1800], [2100, 2400], [2600, 2900]].map(([a, b]) => band(a, b));
    r.ok('deck: on a climb the white comes on as you rise', bands[0] < bands[1] && bands[1] < bands[2] && bands[2] > 0.6, bands.map((v) => v.toFixed(2)).join(' '));
    r.ok('deck: nothing jumps in a frame', slow.jump < 0.02, slow.jump.toFixed(4));
    r.ok('deck: you break out of the top into clear air', slow.end === 0, String(slow.end));
    const fast = climb(thick, 300);
    r.ok('deck: a hard climb through the tops is smooth too', fast.jump < 0.05, fast.jump.toFixed(4));

    // Over the tops of the heaviest sky.
    w.load({ condition: 'stormy', time: 'day' });
    at(thick, 3600);
    sim.step(0.5, 1 / 20);
    const p = w.palette();
    r.ok('deck: over the tops the sky is clear, the fog thin and the rain below you', p.overcast < 0.01 && sim.scene.fog.density < 0.00004 && !sim.rain.mesh.visible && sim.cloudImmersion === 0, `overcast ${p.overcast.toFixed(2)}, fog ${sim.scene.fog.density.toExponential(2)}, rain ${sim.rain.mesh.visible}`);
    at(thick, 800);
    sim.step(0.5, 1 / 20);
    r.ok('deck: under them it rains as ever', sim.rain.mesh.visible);

    // Sky choices.
    const covers = {};
    for (const id of ['clear', 'random', 'cloudy', 'rainy', 'stormy']) {
      w.load({ condition: id, time: 'day' });
      L.snap();
      sim.step(0.1);
      covers[id] = L.deck;
    }
    r.ok('deck: Clear a few patches, Random and Cloudy the layer, Rainy and Stormy heavier', covers.clear < 0.2 && covers.random >= 0.4 && covers.cloudy > covers.clear && covers.rainy > covers.cloudy && covers.stormy > covers.rainy, JSON.stringify(covers));

    // A disaster's sky eases in; no frame takes the layer more than a little.
    w.load({ condition: 'clear', time: 'day' });
    L.snap();
    sim.step(0.1);
    w.temporaryCondition('stormy', 60);
    let dMax = 0;
    let dl = L.deck;
    for (let i = 0; i < 120; i++) {
      sim.step(1 / 30, 1 / 30);
      dMax = Math.max(dMax, Math.abs(L.deck - dl));
      dl = L.deck;
    }
    r.ok('deck: a change of sky eases in', dMax < 0.01 && dl > 0.3, `${dMax.toFixed(4)} a frame, ${dl.toFixed(2)} after 4 s`);
    w.temporaryCondition('stormy', 0.01);
    sim.step(0.1);

    // The Farlands' thinned weather (farlands-run.js): its own copy, and the layer goes with it.
    w.load({ condition: 'cloudy', time: 'day' });
    L.snap();
    const view = Object.create(w);
    Object.defineProperty(view, 'cond', { value: { ...w.cond, deck: 0, cloud: 0 }, writable: true });
    L.snap();
    C.update(1 / 60, view, ac.pos);
    r.ok('deck: a thinned sky takes the layer away', L.deck === 0 && !L.mesh.visible, `${L.deck}`);
    L.snap();
    sim.step(0.1);

    sim.renderFrame();
    const pr = sim.renderer.properties.get(L.material);
    const prog = pr && pr.currentProgram && pr.currentProgram.program;
    r.ok('deck: the sheets\' program links', !!prog && gl.getProgramParameter(prog, gl.LINK_STATUS) === true);
    r.ok('deck: CONDITIONS is left as it was', JSON.stringify(W.CONDITIONS) === before);
    r.ok('deck: no errors', errors.length === 0, errors.slice(0, 2).join(' / ') || 'none');
  } finally {
    console.error = oe;
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    sim.settings.weather = saved;
    sim.weather.load(saved);
  }
}

/**
 * Fog and precipitation in the game (wave 19, item 4).
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/fog.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   - in a mist the layer is on (render/height-fog.js) and every fogging
 *     material really has it: the ground's and the sea's compiled programs
 *     hold the heightFog uniform, set to the weather's
 *   - the picture: low down, the mist changes the frame; switched off it
 *     is the frame there was; above the bank the sky is blue again
 *   - the glide-path hint gives the visibility, and says when the runway is
 *     not in sight yet
 *   - heavy rain falls as rain outside and wets the runway; a cold roll
 *     snows; inside cloud the air is bumpy (light, within the shake caps)
 * The weather is put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

function frameStats(sim) {
  sim.renderFrame();
  const gl = sim.renderer.getContext();
  const W = gl.drawingBufferWidth;
  const H = gl.drawingBufferHeight;
  const px = new Uint8Array(W * H * 4);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { W, H, px };
}
function diff(a, b, y0 = 0, y1 = 1) {
  let d = 0;
  let n = 0;
  for (let y = Math.floor(a.H * y0); y < Math.floor(a.H * y1); y += 4) {
    for (let x = 0; x < a.W; x += 4) {
      const i = (y * a.W + x) * 4;
      d += Math.abs(a.px[i] - b.px[i]) + Math.abs(a.px[i + 1] - b.px[i + 1]) + Math.abs(a.px[i + 2] - b.px[i + 2]);
      n++;
    }
  }
  return d / n / 3;
}
function blueness(s, y0, y1) {
  let b = 0;
  let n = 0;
  for (let y = Math.floor(s.H * y0); y < Math.floor(s.H * y1); y += 4) {
    for (let x = 0; x < s.W; x += 8) {
      const i = (y * s.W + x) * 4;
      b += s.px[i + 2] - (s.px[i] + s.px[i + 1]) / 2;
      n++;
    }
  }
  return b / n;
}

export async function check(sim, r, say = () => {}) {
  const WX = await import('../../src/world/wx.js');
  const HF = await import('../../src/render/height-fog.js');
  const SF = await import('../../src/render/surfaces.js');
  const before = JSON.parse(JSON.stringify(sim.settings.weather));
  try {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    await sim.startMode('free', { loadingScreen: false, aircraft: 'skylark', time: 'day', condition: 'random', windSpeedKts: 4, windDirDeg: 90, airborne: true });
    const w = sim.weather;
    const ac = sim.aircraft;
    const P = ac.pos.constructor;
    const place = (y, x = -6000, z = 300) => {
      ac.reset({ pos: new P(x, 0, z), headingDeg: 90, speed: 60, altAGL: y, engineOn: true, fuel: 1 });
      sim.step(0.3);
    };
    w.wx.lines[w.wx.here] = new WX.WxTimeline(3, { start: 'mist' });
    place(25);
    // One draw with the layer as it is now, so every program on screen holds it.
    sim.renderFrame();
    const hf = { ...HF.HEIGHT_FOG };
    // The ground's and the sea's programs: do they hold the uniform, and is it the weather's?
    const gl = sim.renderer.getContext();
    const progs = [];
    sim.scene.traverse((o) => {
      if (!o.isMesh || !o.material || progs.length > 40) return;
      const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (!m || !m.fog) return;
      const pr = sim.renderer.properties.get(m);
      const p = pr && pr.currentProgram && pr.currentProgram.program;
      if (!p) return;
      const loc = gl.getUniformLocation(p, 'heightFog');
      progs.push({ name: o.name || m.type, has: !!loc, v: loc ? gl.getUniform(p, loc) : null, type: m.type });
    });
    const withIt = progs.filter((p) => p.has);
    const set = withIt.filter((p) => p.v && Math.abs(p.v[0] - hf.x) <= hf.x * 1e-5 + 1e-12 && Math.abs(p.v[2] - hf.z) < 0.5);
    r.ok('fog: in a mist the low layer is on, and the fogging materials\' compiled programs hold it, set to the weather\'s', hf.x > 1e-5 && withIt.length >= 3 && set.length >= Math.min(3, withIt.length),
      `a ${hf.x.toExponential(2)}/m, depth ${(1 / hf.y).toFixed(0)} m, eye ${hf.z.toFixed(0)} m; ${withIt.length}/${progs.length} programs have it, ${set.length} set (${[...new Set(withIt.map((p) => p.type))].join(', ')})`);

    // The picture: a lens 30 m over the sea looking a little down, with the layer and without it.
    const cam = sim.camera;
    const cx = ac.pos.x;
    const cz = ac.pos.z;
    cam.position.set(cx, 30, cz);
    cam.lookAt(cx + 400, 0, cz);
    cam.updateMatrixWorld(true);
    HF.setHeightFog(hf.x, 1 / hf.y, 30);
    const on = frameStats(sim);
    HF.HEIGHT_FOG.x = 0;
    const off = frameStats(sim);
    HF.setHeightFog(hf.x, 1 / hf.y, 30);
    const d = diff(on, off, 0, 0.45);
    r.ok('fog: low in the mist, the layer changes the picture (the sea fades into it)', d > 3, `mean change ${d.toFixed(1)} of 255 in the lower 45% of the frame`);
    // Above the bank: the sky overhead is blue again.
    const lowSky = blueness(on, 0.75, 1);
    place(900);
    const high = frameStats(sim);
    const highSky = blueness(high, 0.75, 1);
    r.ok('fog: climb out of the top of the bank and the sky is blue again', highSky > lowSky + 2, `sky blueness ${lowSky.toFixed(1)} in it, ${highSky.toFixed(1)} above it; veil ${sim.sky.veil != null ? sim.sky.veil.toFixed(2) : '-'}`);

    // The approach hint.
    w.wx.lines[w.wx.here] = new WX.WxTimeline(3, { start: 'fog' });
    const RW = (await import('../../src/world/airport.js')).RUNWAY;
    ac.reset({ pos: new P(RW.cx - RW.length / 2 - 4500, 0, RW.cz), headingDeg: 90, speed: 55, altAGL: 230, engineOn: true, fuel: 1 });
    sim.step(0.3);
    const far = sim.papiHint ? sim.papiHint.text : '';
    ac.reset({ pos: new P(RW.cx - RW.length / 2 - 600, 0, RW.cz), headingDeg: 90, speed: 55, altAGL: 40, engineOn: true, fuel: 1 });
    sim.step(0.2);
    const near = sim.papiHint ? sim.papiHint.text : '';
    r.ok('fog: the glide-path hint gives the visibility, and says when the runway is not in sight yet', /runway not in sight yet/.test(far) && /vis \d/.test(near) && !/not in sight/.test(near), `far: "${far}" / near: "${near}"`);

    // Heavy rain: rain outside, a wet runway.
    w.wx.lines[w.wx.here] = new WX.WxTimeline(3, { start: 'heavyRain' });
    SF.setFieldWetness(0);
    place(300);
    for (let i = 0; i < 6; i++) sim.step(10, 1 / 10);
    r.ok('fog: heavy rain falls as rain outside, and the runway gets wet', sim.rain.mesh.visible && sim.rain.kind === 'rain' && SF.fieldWetness() > 0.1, `rain ${sim.rain.mesh.visible} ${sim.rain.kind}, wetness ${SF.fieldWetness().toFixed(2)}`);
    // A cold roll snows.
    w.wx.lines[w.wx.here] = new WX.WxTimeline(3, { start: 'snow' });
    sim.step(0.3);
    r.ok('fog: snow falls as snow', sim.rain.mesh.visible && sim.rain.kind === 'snow', `${sim.rain.kind}`);
    // In cloud: bumpy.
    w.wx.lines[w.wx.here] = new WX.WxTimeline(3, { start: 'overcast' });
    const base = w.cond.cloudBase;
    place(base + 80);
    sim.step(0.3);
    const inside = sim.cloudImmersion;
    const turbIn = w.turbulenceLevel();
    place(base + 1500);
    sim.step(0.3);
    const turbOut = w.turbulenceLevel();
    r.ok('fog: inside cloud the air is bumpier than above it (white-out + light bumps)', inside > 0.3 && turbIn > turbOut + 0.05, `immersion ${inside.toFixed(2)}, turbulence ${turbIn.toFixed(2)} in, ${turbOut.toFixed(2)} out`);

    /*
     * Checker (wave 19): a fresh Chromebook boots at High (Auto's default),
     * so the layer is installed, and the Auto probe then rebuilds at Low. The
     * shaders must not do the layer's per-pixel work there — Low gets the
     * even fog as thick as the layer, as a Low start does.
     */
    const was = sim.qualityBuilt;
    if (HF.heightFogInstalled() && was !== 'low') {
      w.wx.lines[w.wx.here] = new WX.WxTimeline(3, { start: 'mist' });
      sim.applyQualityNow('low');
      place(25);
      sim.step(0.2);
      const lowW = HF.HEIGHT_FOG.w;
      const vis = WX.visibilityAt({ ...w.cond, hfA: HF.HEIGHT_FOG.x }, sim.camera.position.y);
      const want = WX.densityForVisibility(vis);
      const dens = sim.scene.fog.density;
      sim.applyQualityNow(was);
      place(25);
      sim.step(0.2);
      r.ok('fog: rebuilt at Low after a High boot (the Auto probe on a Chromebook), the shaders skip the layer and the even fog carries the mist', lowW === 0 && dens >= want * 0.98 && HF.HEIGHT_FOG.w === 1,
        `Low: layer in shaders ${lowW}, fog density ${dens.toExponential(2)} (the layer's ${want.toExponential(2)}); back at ${was}: ${HF.HEIGHT_FOG.w}`);
    }
  } finally {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();
    sim.settings.weather = before;
    sim.weather.load(before);
    await wait(10);
  }
}

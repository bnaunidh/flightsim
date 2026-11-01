/**
 * Browser checks for the realism pass (the rival brief, rival-details.md):
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/realism.browser.js check "" 1
 *
 * `check(sim, r, say)` — r.ok(name, pass, detail):
 *   1. Time of day (world/atmos.js): Free Flight has the hour slider beside the
 *      three words (a range input, so it works by touch); a flight started at
 *      an hour has that hour's sun; the directional light and the shadow camera
 *      follow the sun round the day; exposure follows the daylight; the three
 *      words still start the suns they always did.
 *   2. The planform blob shadow (aircraft/blob-shadow.js) is in the world on
 *      Low, under the aircraft, offset down-sun, and fades with height.
 *   3. Touchdown tyre smoke is in the scene and fires on the player's touchdown.
 *   4. The wind at the aircraft is less on the ground than aloft (world/weather.js
 *      windAt); the HUD's readout still reads the reported wind.
 *   5. The cloud-shadow texture cross-fades (two textures, a mix uniform) and drifts.
 * Every import is dynamic. The weather and Free Flight are put back afterwards.
 */
const wait = (ms) => new Promise((res) => setTimeout(res, ms));

export async function check(sim, r, say = () => {}) {
  const THREE = await import('../../src/vendor/three.module.js');
  const before = { weather: JSON.parse(JSON.stringify(sim.settings.weather)), quality: sim.settings.quality };
  try {
    if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu();

    /* ---- 1. time of day ---- */
    say('realism: the hour slider');
    const free = sim.menus.screens && sim.menus.screens.free;
    const hourEl = free && free.querySelector('[data-hour]');
    const timeEl = free && free.querySelector('[data-time]');
    r.ok('time: Free Flight has an hour slider beside the time-of-day words (a range input: touch works)', !!hourEl && hourEl.type === 'range' && Number(hourEl.max) >= 24 && !!timeEl, hourEl ? `${hourEl.min}..${hourEl.max} step ${hourEl.step}` : 'no slider');
    const outEl = free && free.querySelector('[data-hourval]');
    r.ok('time: untouched, the slider reads "preset" (the word\'s own sun)', !!outEl && /preset/i.test(outEl.textContent), outEl && outEl.textContent);
    if (hourEl) {
      hourEl.value = '9.5';
      hourEl.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(20);
      r.ok('time: dragged to 9.5 the label says 09:30', !!outEl && outEl.textContent.trim() === '09:30', outEl && outEl.textContent);
      timeEl.value = 'sunset';
      timeEl.dispatchEvent(new Event('change', { bubbles: true }));
      await wait(20);
      r.ok('time: choosing a word hands the hour back to the preset', !!outEl && /preset/i.test(outEl.textContent), outEl && outEl.textContent);
    }

    say('realism: a flight at 09:30');
    await sim.startMode('free', { time: 'day', hour: 9.5, condition: 'clear', windSpeedKts: 4, windDirDeg: 90, airborne: true, aircraft: 'skylark' });
    sim.step(0.2);
    const w = sim.weather;
    r.ok('time: a Free Flight started at 09:30 has that hour, a morning sun in the east, the word "day"', Math.abs(w.hour - 9.5) < 1e-6 && w.sun.azimDeg > 80 && w.sun.azimDeg < 160 && w.time === 'day', `${w.hour} h, ${w.sun.elevDeg.toFixed(1)}° at ${w.sun.azimDeg.toFixed(0)}`);
    r.ok('time: the save remembers the hour', Number.isFinite(sim.settings.weather.hour) && Math.abs(sim.settings.weather.hour - 9.5) < 1e-6, JSON.stringify(sim.settings.weather));
    const lightAt = () => sim.sky.sun.position.clone().sub(sim.sky.sunTarget.position).normalize();
    const l1 = lightAt();
    const e1 = sim.renderer.toneMappingExposure;
    w.setHour(16.5);
    sim.step(0.2);
    const l2 = lightAt();
    const e2 = sim.renderer.toneMappingExposure;
    r.ok('time: the scene\'s light (and so the shadows) swings from the east in the morning to the west in the afternoon', l1.x > 0.2 && l2.x < -0.2 && l1.y > 0.2 && l2.y > 0.1, `09:30 ${l1.toArray().map((v) => v.toFixed(2))}; 16:30 ${l2.toArray().map((v) => v.toFixed(2))}`);
    w.setHour(w.presetHour('sunset'));
    sim.step(0.2);
    const e3 = sim.renderer.toneMappingExposure;
    r.ok('time: exposure follows the daylight — the same by day, lifted at sunset', Math.abs(e1 - e2) < 0.06 && e3 > e1 + 0.1, `${e1.toFixed(2)} ${e2.toFixed(2)} ${e3.toFixed(2)}`);
    const dome = sim.sky.uniforms.uSunDir.value;
    r.ok('time: at sunset the dome\'s sun sits low in the west while the light still comes from above 2°', dome.y < 0.1 && dome.x < -0.5 && lightAt().y >= Math.sin((2 * Math.PI) / 180) - 1e-3, `dome ${dome.toArray().map((v) => v.toFixed(2))}, light y ${lightAt().y.toFixed(3)}`);
    w.time = 'night';
    sim.step(0.2);
    const ln = lightAt();
    r.ok('time: at night the light is the moon\'s, from above, and the stars are out', ln.y > 0.03 && sim.sky.uniforms.uStars.value > 0.1 && w.isNight, `light y ${ln.y.toFixed(2)}, stars ${sim.sky.uniforms.uStars.value.toFixed(2)}`);
    sim.quitToMenu('main');

    say('realism: the three words');
    for (const [id, lo, hi] of [['day', 15, 90], ['sunset', 3, 6], ['night', -90, -7]]) {
      await sim.startMode('free', { time: id, condition: 'clear', windSpeedKts: 4, windDirDeg: 90, airborne: true, aircraft: 'skylark' });
      sim.step(0.1);
      const el = sim.weather.sun.elevDeg;
      r.ok(`time: the "${id}" word still starts a ${id} sun (${lo}° to ${hi}°), and the save says the word`, el >= lo && el <= hi && sim.settings.weather.time === id && sim.settings.weather.hour === undefined, `${el.toFixed(1)}°, saved ${JSON.stringify(sim.settings.weather)}`);
      sim.quitToMenu('main');
    }

    /* ---- 2. the planform blob shadow (Low) ---- */
    say('realism: the blob shadow on Low');
    const startQuality = sim.settings.quality;
    if (sim.settings.quality !== 'low') {
      sim.applySetting('quality', 'low');
      for (let i = 0; i < 400 && sim.qualityBuilt !== 'low'; i++) await wait(25);
    }
    r.ok('blob: on Low the world has the blob shadow and no shadow maps', !!sim.blobShadow && sim.sky && sim.sky.shadowsEnabled === false && !sim.renderer.shadowMap.enabled, `built ${sim.qualityBuilt}`);
    if (sim.blobShadow) {
      await sim.startMode('free', { time: 'day', hour: 15.5, condition: 'clear', windSpeedKts: 4, windDirDeg: 90, airborne: false, aircraft: 'skylark' });
      sim.step(0.5);
      const b = sim.blobShadow;
      const ac = sim.aircraft;
      r.ok('blob: on the runway by day it is drawn, dark, right under the aircraft, floating over the pavement', b.mesh.visible && b.uniforms.uOpacity.value > 0.3 && Math.hypot(b.mesh.position.x - ac.pos.x, b.mesh.position.z - ac.pos.z) < 3 && b.mesh.position.y > ac.pos.y - ac.agl + 0.4, `opacity ${b.uniforms.uOpacity.value.toFixed(2)}, ${Math.hypot(b.mesh.position.x - ac.pos.x, b.mesh.position.z - ac.pos.z).toFixed(1)} m off`);
      // Its picture is the aircraft's own silhouette: some of the target is covered, most is not.
      const px = new Uint8Array(b.target.width * b.target.height * 4);
      sim.renderer.readRenderTargetPixels(b.target, 0, 0, b.target.width, b.target.height, px);
      let covered = 0;
      for (let i = 3; i < px.length; i += 4) if (px[i] > 16) covered++;
      const share = covered / (b.target.width * b.target.height);
      r.ok('blob: its picture is the aircraft\'s own top-down silhouette (between 3% and 40% of the target covered)', share > 0.03 && share < 0.4, `${(share * 100).toFixed(1)}%`);
      // Checker: the silhouette is redrawn for a loading model a couple of times, then never again.
      ac.controls.throttle = 0; sim.input.throttleTarget = 0; ac.controls.brakeL = ac.controls.brakeR = 1;
      sim.step(12, 1 / 10);
      const capsAt12 = b.captures;
      sim.step(12, 1 / 10);
      r.ok('blob: the silhouette is redrawn at most twice after the first (a loading model), not every 3 s for ever', capsAt12 <= 3 && b.captures === capsAt12, `${capsAt12} by 12 s, ${b.captures} by 24 s`);
      // Lifted into the air it shifts down-sun and fades; high up it is gone.
      const sun = sim.weather.sunDirection(new THREE.Vector3());
      ac.pos.y += 40; ac.agl = 40;
      sim.step(0.1);
      const dx = b.mesh.position.x - ac.pos.x;
      const dz = b.mesh.position.z - ac.pos.z;
      const away = -(dx * sun.x + dz * sun.z);
      const op40 = b.uniforms.uOpacity.value;
      ac.pos.y += 400; ac.agl = 440;
      sim.step(0.1);
      r.ok('blob: at 40 m it has slid away from the sun (AGL / tan(elevation)) and thinned; at 440 m it is gone', away > 10 && op40 < 0.5 && !b.mesh.visible, `${away.toFixed(1)} m down-sun, opacity ${op40.toFixed(2)}, visible high up: ${b.mesh.visible}`);
      sim.quitToMenu('main');
    }

    /* ---- 3. touchdown tyre smoke ---- */
    say('realism: tyre smoke');
    r.ok('smoke: the touchdown smoke pool is in the world', !!sim.tyreSmoke && sim.tyreSmoke.fx.parent === sim.scene);
    if (sim.tyreSmoke) {
      await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90, airborne: false, aircraft: 'skylark' });
      sim.step(0.2);
      const ac = sim.aircraft;
      const puffsBefore = sim.tyreSmoke.puffs;
      // The same event the thump and the chirp fire on, with a firm 400 ft/min arrival at 35 m/s.
      ac.vel.set(0, 0, -1).applyQuaternion(ac.quat).multiplyScalar(35);
      ac.groundSpeed = 35;
      ac.emit('touchdown', { vsFpm: -400, paved: true, crashed: false, quality: 'firm', score: 60, onRunway: true });
      sim.step(0.1);
      const fx = sim.tyreSmoke.fx;
      const n = fx.userData.particles ? fx.userData.particles.count : -1;
      r.ok('smoke: the player\'s touchdown fires puffs at the main wheels, left at the touchdown point', sim.tyreSmoke.puffs === puffsBefore + 1 && fx.visible && n > 4 && n <= 48 && Math.hypot(fx.position.x - ac.pos.x, fx.position.z - ac.pos.z) < 5, `${n} puffs drawn`);
      // Checker: a bounce 0.6 s later, 30 m on, must not drag the first puffs forward with it.
      const firstAt = fx.position.clone();
      sim.step(0.5);
      ac.pos.x += 30;
      ac.emit('touchdown', { vsFpm: -300, paved: true, crashed: false, quality: 'firm', score: 60, onRunway: true });
      sim.step(0.05);
      const fx2 = sim.tyreSmoke.fx;
      r.ok('smoke: a bounce puffs from a second pool; the first touchdown\'s puffs stay where they were', fx2 !== fx && fx.position.distanceTo(firstAt) < 1e-6 && fx.visible && fx2.visible && Math.abs(fx2.position.x - ac.pos.x) < 5 && sim.tyreSmoke.puffs === puffsBefore + 2, `first moved ${fx.position.distanceTo(firstAt).toFixed(1)} m`);
      ac.emit('touchdown', { vsFpm: -300, paved: true, crashed: false, quality: 'firm', score: 60, onRunway: true });
      r.ok('smoke: a third contact while both pools still smoke makes no puff (nothing is moved)', sim.tyreSmoke.puffs === puffsBefore + 2 && fx.position.distanceTo(firstAt) < 1e-6);
      sim.step(3);
      r.ok('smoke: ...and the pools settle and hide a few seconds later', !fx.visible && !fx2.visible && fx.userData.particles.count === 0 && fx2.userData.particles.count === 0, `${fx.userData.particles.count} left`);
      ac.emit('touchdown', { vsFpm: -40, paved: true, crashed: false, quality: 'greaser', score: 95, onRunway: true });
      sim.step(0.1);
      r.ok('smoke: a feather-light arrival makes none', sim.tyreSmoke.puffs === puffsBefore + 2 && !fx.visible && !fx2.visible);
      sim.quitToMenu('main');
    }
    if (sim.settings.quality !== startQuality) {
      sim.applySetting('quality', startQuality);
      for (let i = 0; i < 400 && sim.qualityBuilt !== startQuality; i++) await wait(25);
    }

    /* ---- 4. wind near the ground, ground effect, turbulence ---- */
    say('realism: the wind near the ground');
    await sim.startMode('free', { time: 'day', condition: 'clear', windSpeedKts: 16, windDirDeg: 90, airborne: false, aircraft: 'skylark' });
    sim.step(0.5);
    {
      const w = sim.weather;
      const ac = sim.aircraft;
      const aloft = w.windVector(new THREE.Vector3()).length();
      const here = w.windVector(new THREE.Vector3(), ac.agl, 0.01).length();
      const high = w.windVector(new THREE.Vector3(), 300, 0.03).length();
      r.ok('wind: on the runway the aeroplane feels a little less than the reported (10 m) wind — most of it, not half — stronger aloft, and the report itself is unchanged', here < aloft * 0.95 && here > aloft * 0.6 && high > aloft * 1.3 && Math.round(w.windSpeedKts) === 16, `${here.toFixed(1)} of ${aloft.toFixed(1)} m/s at ${ac.agl.toFixed(1)} m, ${high.toFixed(1)} at 300 m`);
      r.ok('ground effect: on the ground a fixed wing is in ground effect (McCormick: the induced drag is cut by a few per cent with the wing 2–3 m up)', Number.isFinite(ac.groundEffect) && ac.groundEffect > 0.03 && ac.groundEffect < 0.5, `${(ac.groundEffect || 0).toFixed(2)}`);
      r.ok('turbulence: the aeroplane carries its own Dryden filter, stepping', !!ac._dryden && Number.isFinite(ac._dryden.out.w));
      sim.quitToMenu('main');
      await sim.startMode('free', { time: 'day', condition: 'cloudy', windSpeedKts: 16, windDirDeg: 90, airborne: true, aircraft: 'skylark' });
      sim.step(1);
      const ac2 = sim.aircraft;
      // Aloft: the full wind, no ground effect, and gusts that vary over a few seconds without a fixed period.
      const samples = [];
      for (let i = 0; i < 180; i++) { sim.step(1 / 30, 1 / 60); samples.push(ac2._dryden.out.w); }
      const sd = Math.sqrt(samples.reduce((a, v) => a + v * v, 0) / samples.length);
      r.ok('turbulence: aloft in cloudy air the vertical gust varies (a few tenths of a metre a second) and is never the same sine twice', sd > 0.05 && sd < 4 && new Set(samples.map((v) => v.toFixed(3))).size > 100, `sd ${sd.toFixed(2)} m/s over 6 s`);
      r.ok('ground effect: aloft there is none', (ac2.groundEffect || 0) < 0.02, `${(ac2.groundEffect || 0).toFixed(3)} at ${ac2.agl.toFixed(0)} m`);
      sim.quitToMenu('main');
    }

    /* ---- 5. cloud shadows: cross-fade, drift, on the sea ---- */
    say('realism: cloud shadows');
    {
      const C = await import('../../src/world/clouds.js');
      const cs = C.cloudShadow;
      if (sim.settings.quality === 'low') {
        sim.applySetting('quality', 'medium');
        for (let i = 0; i < 400 && sim.qualityBuilt !== 'medium'; i++) await wait(25);
      }
      await sim.startMode('free', { time: 'day', condition: 'cloudy', windSpeedKts: 14, windDirDeg: 270, airborne: true, aircraft: 'skylark' });
      sim.step(1.2, 1 / 30);
      const mixes = [];
      for (let i = 0; i < 24; i++) { sim.step(1 / 30, 1 / 60); mixes.push(cs.uniforms.uCloudMix.value); }
      const stepsSeen = mixes.filter((m, i) => i > 0 && m > mixes[i - 1] && m < 1).length;
      r.ok('cloud shadow: on Medium the shade is painted (strength > 0) and a repaint cross-fades over several frames rather than swapping in one', cs.xform.w > 0 && stepsSeen >= 3, `strength ${cs.xform.w.toFixed(2)}, ${stepsSeen} fading frames of 24, mixes ${mixes.slice(0, 8).map((m) => m.toFixed(2)).join(' ')}`);
      const d = cs.uniforms.uCloudDrift.value;
      r.ok('cloud shadow: between repaints the pattern drifts with the wind (a westerly: +x)', Math.abs(d.z) > 0.2 || Math.abs(d.x) > 0.2, d.toArray().map((v) => v.toFixed(1)).join(','));
      const ocean = sim.ocean && sim.ocean.deepMat;
      r.ok('cloud shadow: the sea carries the same shared uniforms on Medium and up', !!ocean && ocean.uniforms.uCloudShadow === cs.uniforms.uCloudShadow && ocean.uniforms.uCloudMix === cs.uniforms.uCloudMix);
      const s0 = cs.shadeAt(sim.aircraft.pos.x, sim.aircraft.pos.z);
      r.ok('cloud shadow: one CPU sample under the aircraft is a number in 0..1', Number.isFinite(s0) && s0 >= 0 && s0 <= 1, s0.toFixed(3));
      sim.quitToMenu('main');
    }
  } catch (e) {
    r.ok('realism: the checks ran', false, String((e && e.stack) || e).slice(0, 400));
  } finally {
    try {
      if (sim.state !== 'menu' && sim.quitToMenu) sim.quitToMenu('main');
      sim.weather.load(before.weather);
      sim.settings.weather = sim.weather.serialize();
      if (sim.menus && sim.menus.syncSettings) sim.menus.syncSettings(sim.settings);
    } catch (e) { /* leave it */ }
  }
  return r;
}

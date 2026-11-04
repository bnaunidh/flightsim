/**
 * Node checks for the realism pass (the rival brief, .claude/devtools/briefs/rival-details.md):
 *
 *   node tests/features/realism.mjs [--verbose]
 *
 *   0a. The northern lights are a slow, soft, capped glow (world/features.js AURORA).
 *   0b. A mission's radio: "Last Flight Out" is "Reach two one" on runway two seven,
 *       and the generic start/clearance calls stay off the air (game/atc-director.js).
 *   1.  Continuous time of day from the solar formula (world/atmos.js, weather.js):
 *       the presets land where the fixed suns were; the sun colour and the sky
 *       follow its elevation; exposure follows daylight.
 *   2.  The planform blob shadow under the aircraft on Low (aircraft/blob-shadow.js).
 *   3.  Touchdown tyre smoke fires on the player's touchdown, by sink rate.
 *   4.  Wind drops near the ground (log law), ground effect for fixed wings,
 *       turbulence as filtered noise (Dryden) — and the landings still land.
 *   5.  Cloud shadows cross-fade and drift between repaints.
 *
 * Exits non-zero if anything fails.
 */

if (typeof globalThis.window === 'undefined') {
  const mem = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) },
  });
}
globalThis.document = globalThis.document || {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
  documentElement: { classList: { toggle() {}, contains: () => false, add() {}, remove() {} } },
};

const root = new URL('../../', import.meta.url);
const imp = (p) => import(new URL(p, root).href);
const verbose = process.argv.includes('--verbose');
const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (verbose || !pass) console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return !!pass;
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

/* ------------------------------------------------------------- 0a. aurora -- */
{
  const F = await imp('src/world/features.js');
  const A = F.AURORA;
  ok('aurora: its look is exported and frozen', !!A && Object.isFrozen(A));
  // A stripe every 100 m at 13 km was sub-pixel shimmer; broad rays only.
  ok('aurora: a few broad rays across the ribbon (18 or fewer cycles, was 260)', A.rayCycles <= 18, `${A.rayCycles}`);
  ok('aurora: the rays and the folds drift over minutes (under 0.1 rad/s)', A.rayRate <= 0.1 && A.waveRate <= 0.1, `${A.rayRate}, ${A.waveRate}`);
  ok('aurora: no pixel of a ribbon brighter than its peak, and the peak well under white', A.peak <= 0.4 && A.strength <= 0.5, `peak ${A.peak}, strength ${A.strength}`);
  ok('aurora: the stack of every ribbon stays under 1.4 (no bloom-to-white)', A.ribbons * A.peak <= 1.4, `${A.ribbons} × ${A.peak}`);
  // The shader itself: the pixel-footprint fade and the ceiling are in the code that draws it.
  const src = await (await import('node:fs/promises')).readFile(new URL('src/world/features.js', root), 'utf8');
  const frag = src.slice(src.indexOf('buildAurora(cfg)'), src.indexOf('/* ----------------------------------------------------------- volcano'));
  ok('aurora: the fragment fades its rays by pixel footprint (fwidth) and caps at uPeak', /fwidth\(vUv\.x\)/.test(frag) && /min\(col \* body \* ray \* ends \* uOpacity, vec3\(uPeak\)\)/.test(frag));
  ok('aurora: v is clamped to 0..1 before any pow() (a NaN at a ribbon edge drew dashed white lines across the sky, by day too)', /float v = clamp\(vUv\.y, 0\.0, 1\.0\);/.test(frag) && !/pow\(1\.0 - vUv|pow\(vUv/.test(frag));
  ok('aurora: its strength follows how dark the sky is (timeInfo.daylight), not the time word', /1 - ti\.daylight/.test(src));
  ok('aurora: the glow goes through flash-safety (dim)', /dim\(AURORA\.strength, AURORA\.reduceCap\)/.test(src));
}

/* ------------------------------------------------------- 0b. mission radio -- */
{
  const { AtcDirector } = await imp('src/game/atc-director.js');
  const { MISSIONS } = await imp('src/game/extra/scp-escape.js');
  const def = MISSIONS.find((m) => m.id === 'last-flight') || MISSIONS[0];
  ok('radio: Last Flight Out names its radio (callsign, runway, quiet calls)', !!def.radio && def.radio.callsign === 'Reach two one' && def.radio.runway === 'two seven' && Array.isArray(def.radio.quiet), JSON.stringify(def.radio));
  const sim = { speak() {}, aircraftType: { callsign: 'Reach one seven heavy' }, runner: { def, status: 'running' }, mpCallsign: null };
  const atc = new AtcDirector(sim);
  ok('radio: the director calls you by the mission\'s callsign, not the C-17\'s', atc.callsign === 'Reach two one', atc.callsign);
  ok('radio: ...and says the mission\'s runway, not "zero nine"', atc.runwayCall === 'two seven', atc.runwayCall);
  ok('radio: ...from the mission\'s tower', atc.field === 'Caribou', atc.field);
  ok('radio: the generic start-up and take-off calls stay quiet in this mission', atc.once('start') === false && atc.once('clearance') === false && atc.once('airborne') === false);
  ok('radio: the landing calls still go out', atc.once('final') === true);
  // Checker: the final call fires only on the 09 approach (non-World maps), so once airborne the runway is the field's own.
  sim.aircraft = {
    onGround: false, crashed: false, engineOn: true, heading: 200, airborneTime: 0, agl: 900, alt: 900, fuel: 160,
    pos: { x: 0, y: 900, z: 0, distanceTo: () => 99999 }, controls: { throttle: 0.7 }, readouts: () => ({ heading: 200 }),
  };
  sim.weather = { condition: 'clear', windSpeedKts: 8, windDirDeg: 270, windDescription: () => ({ cross: 0, side: 'left' }) };
  atc.cool = 99;
  atc.update(0.016);
  ok('radio: once the aeroplane has flown, the landing calls say Caribou\'s own runway, not the departure strip\'s "two seven"', atc.departed === true && atc.runwayCall === 'zero nine' && atc.callsign === 'Reach two one', `${atc.departed} ${atc.runwayCall}`);
  sim.aircraft.onGround = true;
  ok('radio: ...and still after landing there', atc.runwayCall === 'zero nine', atc.runwayCall);
  atc.reset();
  ok('radio: a new flight starts on the departure strip again', atc.runwayCall === 'two seven', atc.runwayCall);
  sim.runner = { def, status: 'idle' };
  ok('radio: a mission left behind on the runner (back in the menu, status idle) names nobody', atc.missionRadio === null && atc.callsign === 'Reach one seven heavy', atc.callsign);
  delete sim.aircraft;
  delete sim.weather;
  sim.runner = { def: null, status: 'idle' };
  ok('radio: with no mission the C-17 is "Reach one seven heavy" again', atc.callsign === 'Reach one seven heavy', atc.callsign);
}

/* ------------------------------------------------- 1. the sun and the air -- */
{
  const A = await imp('src/world/atmos.js');
  const W = await imp('src/world/weather.js');
  const THREE = await imp('src/vendor/three.module.js');
  // The solar formula against known facts.
  const eqNoon = A.sunPosition(0, 80, 12); // the equator at the March equinox, noon: overhead
  ok('sun: at the equator on the equinox the noon sun is overhead', eqNoon.elevDeg > 88, eqNoon.elevDeg.toFixed(1));
  const n46 = A.sunPosition(46, 172, 12); // 46°N, midsummer noon: 90 − 46 + 23.44
  ok('sun: at 46°N on midsummer\'s day the noon sun stands at 67.4°, due south', near(n46.elevDeg, 67.4, 0.3) && near(n46.azimDeg, 180, 0.5), `${n46.elevDeg.toFixed(1)}° at ${n46.azimDeg.toFixed(0)}`);
  const w46 = A.sunPosition(46, 355, 12);
  ok('sun: ...and at midwinter 20.6°', near(w46.elevDeg, 20.6, 0.3), w46.elevDeg.toFixed(1));
  const pm = A.sunPosition(46, 172, 16);
  const am = A.sunPosition(46, 172, 8);
  ok('sun: afternoon is west of south, morning east of it, at the same height', pm.azimDeg > 200 && am.azimDeg < 160 && near(pm.elevDeg, am.elevDeg, 0.01), `08h ${am.azimDeg.toFixed(0)}°, 16h ${pm.azimDeg.toFixed(0)}°`);
  ok('sun: the day of the year and the declination', A.dayOfYearOf(new Date(2026, 0, 1).getTime()) === 1 && A.dayOfYearOf(new Date(2026, 11, 31).getTime()) === 365 && near(A.solarDeclinationDeg(172), 23.4, 0.2) && near(A.solarDeclinationDeg(355), -23.4, 0.2));
  // Presets: hourForElevation puts the sun where the fixed sun was.
  for (const lat of [12, 46, 56]) {
    const h = A.hourForElevation(lat, 304, 4.5);
    const el = A.sunPosition(lat, 304, h).elevDeg;
    ok(`sun: the sunset preset at ${lat}°N on 31 October finds the hour of a 4.5° sun`, near(el, 4.5, 0.05) && h > 12 && h < 24, `${h.toFixed(2)} h → ${el.toFixed(2)}°`);
  }
  ok('sun: a target the day cannot reach gives noon (above) or midnight (below)', A.hourForElevation(56, 304, 62) === 12 && A.hourForElevation(56, 172, -14) === 24);
  ok('sun: twilight words — 11° is day, 2° and −5° are sunset, −8° is night', A.timeBucket(11) === 'day' && A.timeBucket(2) === 'sunset' && A.timeBucket(-5) === 'sunset' && A.timeBucket(-8) === 'night');
  ok('sun: daylight is 1 with the sun well up, 0 past civil twilight, between in between', A.daylight(20) === 1 && A.daylight(-9) === 0 && A.daylight(-2) > 0.1 && A.daylight(-2) < 0.9);
  // The air: Kasten–Young air mass and per-channel transmittance.
  ok('air: air mass is 1 overhead, about 38 at the horizon', near(A.airMass(90), 1, 0.01) && A.airMass(0) > 35 && A.airMass(0) < 40, `${A.airMass(0).toFixed(1)}`);
  const T62 = A.sunTransmittance(62);
  const T4 = A.sunTransmittance(4.5);
  ok('air: blue is lost faster than red, and far more so at a low sun', T62[2] < T62[0] && T4[2] / T4[0] < (T62[2] / T62[0]) * 0.3, `62°: ${T62.map((v) => v.toFixed(3))}; 4.5°: ${T4.map((v) => v.toFixed(3))}`);
  const Th = A.sunTransmittance(30, 1);
  const Tc = A.sunTransmittance(30, 0);
  ok('air: haze dims every channel', Th[0] < Tc[0] && Th[1] < Tc[1] && Th[2] < Tc[2]);
  // The light: colour and strength from elevation, continuous.
  const s62 = A.sunLight(62);
  const s15 = A.sunLight(15);
  const s4 = A.sunLight(4.5);
  const warmth = (c) => c[0] - c[2];
  ok('light: the sun goes from near-white through yellow to orange as it drops', warmth(s62.color) < warmth(s15.color) && warmth(s15.color) < warmth(s4.color) && s4.color[0] === 1 && s4.color[2] < 0.35, `${A.hexOf(s62.color).toString(16)} ${A.hexOf(s15.color).toString(16)} ${A.hexOf(s4.color).toString(16)}`);
  ok('light: ...and dims: full strength high up, half at 4.5°, gone a degree under the horizon', s62.intensity > 3 && s4.intensity > 1.2 && s4.intensity < 2 && A.sunLight(-1.5).intensity === 0, `${s62.intensity.toFixed(2)} ${s4.intensity.toFixed(2)}`);
  ok('light: the night floor is the moon, by its phase, never black', A.moonLight(-14, 1).intensity > 0.3 && A.moonLight(-14, 0).intensity > 0.1 && A.moonLight(-14, 0).intensity < A.moonLight(-14, 1).intensity && A.moonLight(40, 1).intensity === 0);
  // The sky lands on the palettes at the three presets, and is continuous between them.
  const K62 = A.skyLight(62);
  const K4 = A.skyLight(4.5);
  const Kn = A.skyLight(-14);
  ok('sky: at a 62° sun the zenith, horizon, sky and ground bounce are the midday palette\'s', A.hexOf(K62.zenith) === 0x2f6fd0 && A.hexOf(K62.horizon) === 0xbcd7f2 && A.hexOf(K62.ambient) === 0x9fb8d8 && A.hexOf(K62.ground) === 0x5a6b52, [K62.zenith, K62.horizon, K62.ambient, K62.ground].map((c) => A.hexOf(c).toString(16)).join(' '));
  ok('sky: at −14° they are the night palette\'s', A.hexOf(Kn.zenith) === 0x040a18 && A.hexOf(Kn.horizon) === 0x121d33 && A.hexOf(Kn.ambient) === 0x2a3a55 && A.hexOf(Kn.ground) === 0x0b1018);
  ok('sky: at 4.5° the zenith is a deep blue and the horizon and the sky bounce have gone warm', K4.zenith[2] > K4.zenith[0] * 2 && K4.horizon[0] > K4.horizon[2] + 0.25 && K4.ambient[0] > K4.ambient[2], [K4.zenith, K4.horizon, K4.ambient].map((c) => A.hexOf(c).toString(16)).join(' '));
  let worst = 0;
  let prev = null;
  for (let el = -20; el <= 70; el += 0.25) {
    const k = A.skyLight(el);
    const l = A.sunLight(el);
    const v = [...k.zenith, ...k.horizon, ...k.ambient, ...k.ground, l.intensity / 3.2, A.exposureFor(el)];
    if (prev) for (let i = 0; i < v.length; i++) worst = Math.max(worst, Math.abs(v[i] - prev[i]));
    prev = v;
  }
  ok('sky: every colour, the light and the exposure move smoothly with the sun (no step over 0.05 per quarter degree — a minute of real dusk)', worst < 0.05, worst.toFixed(4));
  ok('exposure: 1.12 at midday and at night, lifted at dusk, a touch lower under overcast', near(A.exposureFor(62), 1.12, 0.001) && near(A.exposureFor(-14), 1.12, 0.001) && A.exposureFor(4.5) > 1.25 && A.exposureFor(62, 1) < 1.12);

  // Weather: the presets on a real sun, the hour, the map's latitude, the save.
  const w = new W.Weather();
  w.setLocation({ subtitle: 'Tropical · gentle hills' });
  ok('weather: a tropical map reads 12°N; an arctic one 56°N; a map may say its own', w.latitude === 12 && (w.setLocation({ subtitle: 'Arctic · snow' }), w.latitude === 56) && (w.setLocation({ latitude: 71 }), w.latitude === 71));
  w.setLocation({ subtitle: 'Tropical · gentle hills' });
  w.time = 'day';
  // The day allows it from March to the start of November: at 12°N in deep winter the noon sun is 54.6°.
  ok('weather: the Midday preset is the old 62° sun where the day allows it', w.sun.elevDeg <= 62.05 && w.sun.elevDeg > 54 && w.time === 'day' && w.preset === 'day', `${w.sun.elevDeg.toFixed(2)}° at ${w.hour.toFixed(2)} h`);
  w.time = 'sunset';
  ok('weather: the Sunset preset is a 4.5° sun in the west', near(w.sun.elevDeg, 4.5, 0.05) && w.sun.azimDeg > 240 && w.sun.azimDeg < 300 && w.time === 'sunset', `${w.sun.elevDeg.toFixed(2)}° at ${w.sun.azimDeg.toFixed(0)}`);
  w.time = 'night';
  ok('weather: the Night preset is a −14° sun, and isNight', near(w.sun.elevDeg, -14, 0.05) && w.isNight && w.timeInfo.label === 'Night');
  w.setHour(9.5);
  ok('weather: any hour: 09:30 is a morning sun in the east, the word is "day", no preset', w.sun.azimDeg > 90 && w.sun.azimDeg < 150 && w.sun.elevDeg > 20 && w.time === 'day' && w.preset === null, `${w.sun.elevDeg.toFixed(1)}° at ${w.sun.azimDeg.toFixed(0)}`);
  const dir = w.sunDirection(new THREE.Vector3());
  ok('weather: sunDirection points east-ish and up for a morning sun (+x east, −z north)', dir.x > 0.3 && dir.y > 0.3, dir.toArray().map((v) => v.toFixed(2)).join(','));
  w.time = 'sunset';
  const elTrop = w.sun.elevDeg;
  w.setLocation({ subtitle: 'Arctic · snow' });
  ok('weather: a preset keeps its sun when the map changes (its hour is found again)', near(w.sun.elevDeg, elTrop, 0.05) && w.preset === 'sunset', `${w.sun.elevDeg.toFixed(2)}°`);
  w.setHour(14);
  w.setLocation({ subtitle: 'Tropical' });
  ok('weather: a hand-set hour stays an hour when the map changes', w.hour === 14 && w.preset === null);
  const ser = w.serialize();
  ok('weather: the save carries the hour when it was set by hand', ser.hour === 14, JSON.stringify(ser));
  const w2 = new W.Weather();
  w2.setLocation({ subtitle: 'Tropical' });
  w2.load(ser);
  ok('weather: ...and loading it puts the same sun back', w2.hour === 14 && near(w2.sun.elevDeg, w.sun.elevDeg, 0.01));
  w2.load({ time: 'night' });
  ok('weather: a mission\'s { time: "night" } still means the night sun, and the save says the word, not an hour', w2.isNight && w2.serialize().time === 'night' && w2.serialize().hour === undefined);
  w2.load({ time: 'day', hour: 17.25 });
  ok('weather: a word and an hour together: the hour wins', w2.hour === 17.25 && w2.preset === null);
  // The palette follows the sun; the light's direction is the sun's by day and the moon's by night, never under 2°.
  const wd = new W.Weather();
  wd.setLocation({ subtitle: 'Tropical' });
  wd.time = 'day';
  const pd = wd.palette();
  wd.setHour(wd.presetHour('sunset'));
  const ps = wd.palette();
  ok('palette: towards sunset the sun colour warms, its strength falls and the exposure rises', ps.sun.r - ps.sun.b > pd.sun.r - pd.sun.b + 0.3 && ps.sunIntensity < pd.sunIntensity * 0.7 && ps.exposure > pd.exposure + 0.1, `day #${pd.sun.getHexString()} ${pd.sunIntensity.toFixed(2)} e${pd.exposure.toFixed(2)}; dusk #${ps.sun.getHexString()} ${ps.sunIntensity.toFixed(2)} e${ps.exposure.toFixed(2)}`);
  wd.time = 'night';
  const pn = wd.palette();
  const ld = wd.lightDirection(new THREE.Vector3());
  const sd = wd.sunDirection(new THREE.Vector3());
  ok('palette: at night the light is the moon\'s — from above, opposite the sun, the moon\'s colour, never black', ld.y > 0.03 && sd.y < 0 && Math.sign(ld.x) === -Math.sign(sd.x) && pn.sun.getHexString() === '9db4d8' && pn.moonlight > 0.1 && pn.sunIntensity > 0.1, `light y ${ld.y.toFixed(2)}, sun y ${sd.y.toFixed(2)}, #${pn.sun.getHexString()} ${pn.sunIntensity.toFixed(2)}`);
  wd.setHour(wd.presetHour('sunset') + 0.2);
  const lh = wd.lightDirection(new THREE.Vector3());
  ok('palette: a sun on the horizon lights from no lower than 2° (no horizontal shadow acne)', lh.y >= Math.sin((2 * Math.PI) / 180) - 1e-6, lh.y.toFixed(3));
  // The clock may run.
  wd.setHour(10);
  wd.clockRate = 60; // a minute of play per hour of sun
  wd.update(30);
  ok('weather: with clockRate set the hour runs (30 s at 60 s/hour = half an hour)', near(wd.hour, 10.5, 1e-6) && wd.preset === null, wd.hour.toFixed(3));
  wd.clockRate = 0;
  wd.update(30);
  ok('weather: with clockRate 0 it holds still, as every fixed sky always did', near(wd.hour, 10.5, 1e-6));
  // The three words still index the same way for the multiplayer frame (features/mpworld.js TIME_IDS).
  ok('weather: TIMES keeps its three keys in order: day, sunset, night', Object.keys(W.TIMES).join(',') === 'day,sunset,night');
}

/* ----------------------------------------------- 2. the planform blob shadow -- */
{
  const B = await imp('src/aircraft/blob-shadow.js');
  const THREE = await imp('src/vendor/three.module.js');
  const src = await (await import('node:fs/promises')).readFile(new URL('src/main.js', root), 'utf8');
  ok('blob: main.js builds the blob shadow when the sky has no shadow maps (Low), and updates it each frame', /if \(!this\.sky\.shadowsEnabled\) \{\s*this\.blobShadow = /.test(src) && /this\.blobShadow\.update\(dt, /.test(src) && /this\.blobShadow\.dispose\(\)/.test(src));
  const high = new THREE.Vector3(0.3, 0.9, 0.3).normalize(); // a high sun
  const g = B.blobPlacement(high, 0, 0);
  ok('blob: on the ground under a high clear sun it is dark and right under the aircraft', g.opacity > 0.45 && Math.abs(g.shiftX) < 0.01 && Math.abs(g.shiftZ) < 0.01, `opacity ${g.opacity.toFixed(2)}`);
  const low = new THREE.Vector3(-0.8, Math.tan((20 * Math.PI) / 180) * 0.8, 0).normalize(); // a 20° sun in the west
  const a = B.blobPlacement(low, 30, 0);
  ok('blob: at 30 m under a 20° western sun it falls 82 m to the east (AGL / tan(el)), away from the sun', a.shiftX > 0 && near(a.shiftX, 30 / Math.tan((20 * Math.PI) / 180), 0.5) && Math.abs(a.shiftZ) < 0.01, `shift ${a.shiftX.toFixed(1)}, ${a.shiftZ.toFixed(1)}`);
  const grazing = new THREE.Vector3(-1, Math.tan((2 * Math.PI) / 180), 0).normalize();
  const gz = B.blobPlacement(grazing, 30, 0);
  ok('blob: a grazing sun does not throw it to the horizon (capped at BLOB.maxShiftPerMetre × AGL) and it is faint', gz.shiftX <= B.BLOB.maxShiftPerMetre * 30 + 1e-6 && gz.opacity < 0.1, `shift ${gz.shiftX.toFixed(0)}, opacity ${gz.opacity.toFixed(2)}`);
  const fade = [0, 50, 120, 180, B.BLOB.fadeAgl, 400].map((h) => B.blobPlacement(high, h, 0).opacity);
  ok('blob: it fades with height and is gone by BLOB.fadeAgl', fade[0] > fade[2] && fade[2] > fade[3] && fade[4] === 0 && fade[5] === 0, fade.map((v) => v.toFixed(2)).join(' '));
  ok('blob: ...softening and growing a little as it goes (the penumbra)', B.blobPlacement(high, 100, 0).soft > B.blobPlacement(high, 0, 0).soft && B.blobPlacement(high, 100, 0).grow > 1);
  ok('blob: overcast thins it, night removes it', B.blobPlacement(high, 0, 1).opacity < g.opacity * 0.3 && B.blobPlacement(new THREE.Vector3(0, -0.3, 1).normalize(), 0, 0).opacity === 0);
  ok('blob: it floats over the pavement (lift ≥ 0.5 m) so the runway does not cut it', B.BLOB.lift >= 0.5, `${B.BLOB.lift}`);
}

/* ------------------------------------------------------ 3. touchdown tyre smoke -- */
{
  const T = await imp('src/aircraft/tyre-smoke.js');
  const src = await (await import('node:fs/promises')).readFile(new URL('src/main.js', root), 'utf8');
  ok('smoke: main.js fires the tyre smoke from the player\'s touchdown event and updates the pool each frame', /this\.tyreSmoke\.touchdown\(ac, g, this\.model/.test(src) && /this\.tyreSmoke\.update\(dt, this\.camera\)/.test(src) && /this\.tyreSmoke = t\('tyre smoke'/.test(src));
  const r = T.smokeDescentRate;
  ok('smoke: a firm, fast touchdown smokes more than a soft, slow one', r(3, 60) > r(1, 30) && r(1, 30) > 0, `${r(3, 60).toFixed(2)} vs ${r(1, 30).toFixed(2)}`);
  ok('smoke: a feather-light arrival (under 0.4 m/s) and a rolling re-contact (under 12 m/s) make none', r(0.2, 60) === 0 && r(2, 8) === 0);
  ok('smoke: ground speed adds to it (the tyres have to spin up)', r(1, 70) > r(1, 20));
  ok('smoke: grass makes less (dust), wet grass none', r(2, 40, false, 0) < r(2, 40, true, 0) && r(2, 40, false, 0.6) === 0 && r(2, 40, true, 0.6) > 0);
  const contacts = T.mainWheelContacts({ userData: { parts: { gear: { mains: [{ group: { position: { x: -1.2, z: 0.4 } } }, { group: { position: { x: 1.2, z: 0.4 } } }] } } } });
  ok('smoke: the puffs come from the built model\'s own main wheels', contacts.length === 2 && contacts[0][0] === -1.2 && contacts[1][0] === 1.2 && contacts[0][2] === 0.4, JSON.stringify(contacts));
  const fb = T.mainWheelContacts({ userData: {} }, 30);
  ok('smoke: ...or a pair a tenth of the span apart when the model has none (the GLB fleet)', fb.length === 2 && near(fb[1][0] - fb[0][0], 6, 1e-6), JSON.stringify(fb));
  ok('smoke: the pool is bounded (fleet/effects.js, 48 puffs) and settles a moment after its longest life', T.TYRE_SMOKE.settleS >= 1.5 && T.TYRE_SMOKE.settleS <= 4);
}

/* ------------------------------------ 4. wind near the ground, ground effect, turbulence -- */
{
  const T = await imp('src/world/turbulence.js');
  const W = await imp('src/world/weather.js');
  const THREE = await imp('src/vendor/three.module.js');
  const psrc = await (await import('node:fs/promises')).readFile(new URL('src/aircraft/physics.js', root), 'utf8');
  // F3: the log wind profile.
  const wp = T.windProfile;
  ok('wind: the chosen wind is the reported 10 m wind over grass (exactly 1 there), stronger aloft (about 1.5× at and above the 200 m cap, the same over every surface)', near(wp(10, T.ROUGHNESS.grass), 1, 1e-9) && wp(200) > 1.4 && wp(200) < 1.6 && wp(2000) === wp(200) && near(wp(200, T.ROUGHNESS.water), wp(200), 1e-9) && near(wp(200, T.ROUGHNESS.paved), wp(200), 1e-9), `10 m ${wp(10).toFixed(2)}, 200 m ${wp(200).toFixed(2)}`);
  ok('wind: at 10 m over water more, over a town less', wp(10, T.ROUGHNESS.water) > wp(10, T.ROUGHNESS.grass) && wp(10, T.ROUGHNESS.town) < wp(10, T.ROUGHNESS.grass), `grass ${wp(10, T.ROUGHNESS.grass).toFixed(2)}, water ${wp(10, T.ROUGHNESS.water).toFixed(2)}, town ${wp(10, T.ROUGHNESS.town).toFixed(2)}`);
  ok('wind: on the runway (wheels 2 m over pavement) the aeroplane still feels most of the reported crosswind (0.7–0.9 of it), not half', wp(2, T.ROUGHNESS.paved) > 0.7 && wp(2, T.ROUGHNESS.paved) < 0.9, wp(2, T.ROUGHNESS.paved).toFixed(2));
  ok('wind: it fades over the last fifty feet (15 m → 5 m → 1 m, each less), never negative', wp(15) > wp(5) && wp(5) > wp(1) && wp(0) >= 0 && wp(1) > 0.3, `${wp(15).toFixed(2)} ${wp(5).toFixed(2)} ${wp(1).toFixed(2)}`);
  const w = new W.Weather();
  w.load({ time: 'day', condition: 'clear', windSpeedKts: 20, windDirDeg: 270 });
  const aloft = w.windVector(new THREE.Vector3());
  const deck = w.windVector(new THREE.Vector3(), 10, T.ROUGHNESS.grass);
  const legacy = w.windVector(new THREE.Vector3());
  ok('weather: windVector(out, agl, z0) is the wind at that height; without a height it is the chosen (reported) wind, as every other reader expects', near(aloft.length(), 20 * 0.514444, 1e-6) && near(deck.length() / aloft.length(), wp(10), 1e-6) && legacy.equals(aloft) && deck.x > 0 && Math.abs(deck.z) < 1e-9, `aloft ${aloft.length().toFixed(2)} m/s, 10 m ${deck.length().toFixed(2)}`);
  {
    // Checker: the light's direction swaps sun → moon where its colour and strength do (palette: the brighter), not at 0°.
    const Atm = await imp('src/world/atmos.js');
    const wl = new W.Weather();
    wl.setLocation({ latitude: 46 }, 300);
    wl.moonPhase = 1;
    const at = (el) => { wl.setHour(Atm.hourForElevation(46, 300, el)); const d = wl.lightDirection(new THREE.Vector3()); const s0 = wl.sunDirection(new THREE.Vector3()); return { side: Math.sign(d.x * s0.x + d.z * s0.z), sunWins: wl.palette().sunIntensity > 0 && Atm.sunLight(el).intensity >= Atm.moonLight(el, 1).intensity }; };
    const a = at(1), b = at(0.25), c = at(-0.25);
    // Checker: palette() runs ~5× a frame and the sun getter dozens of times; neither may make garbage while the sun is still.
    wl.setHour(15);
    wl.palette();
    const a0 = wl._atmos;
    const s0 = wl.sun;
    wl.palette();
    ok('time: with the sun still, palette() reuses its sun-and-sky light and the sun getter its position (no per-call garbage)', wl._atmos === a0 && wl.sun === s0 && !('_sunKey' in wl));
    wl.setHour(15.5);
    wl.palette();
    ok('time: ...and both are worked out again when the hour moves', wl._atmos !== a0 && wl.sun !== s0);
    ok('time: the light shines from the sun\'s side exactly while the sun is the brighter light (1°: sun; 0.25° and −0.25° under a full moon: the moon\'s side)', a.side > 0 && a.sunWins && b.side < 0 && !b.sunWins && c.side < 0 && !c.sunWins, JSON.stringify([a, b, c]));
  }
  ok('physics: the flight model asks for the wind at its own height over what is under it (pavement, water or grass)', /weather\.windVector\(this\._tmp, this\.agl, z0\)/.test(psrc) && /_roughnessUnder\(\)/.test(psrc) && /isPaved\(x, z\)\) return ROUGHNESS\.paved/.test(psrc));
  // F4: ground effect.
  const ge = T.groundEffectInduced;
  ok('ground effect: a span up the induced drag is the free-air value (φ > 0.99); at b/16 it is halved', ge(11, 11) > 0.99 && near(ge(11 / 16, 11), 0.5, 0.01), `${ge(11, 11).toFixed(3)}, ${ge(11 / 16, 11).toFixed(3)}`);
  ok('ground effect: ...smoothly, and never below zero or above one', [0.1, 0.5, 1, 2, 4, 8].every((h, i, a) => ge(h, 11) >= 0 && ge(h, 11) <= 1 && (i === 0 || ge(h, 11) > ge(a[i - 1], 11))));
  ok('physics: the ground-effect lift rise is the flare\'s only (airborne); on the wheels it would stretch the strut\'s rebound into a hop', /if \(inGE > 0\.001 && !this\.onGround\) CL \*= 1 \+ 0\.06 \* inGE/.test(psrc));
  ok('physics: the induced-drag term carries McCormick\'s factor for fixed wings, the lift slope rises a little, the nose drops a touch, helicopters keep their own', /SPEC\.k \* geInduced \* CL \* CL/.test(psrc) && /CL \*= 1 \+ 0\.06 \* inGE/.test(psrc) && /this\._geMoment = qS \* \(SPEC\.chord \|\| 1\.5\) \* 0\.012 \* inGE/.test(psrc) && /this\._t\.x -= this\._geMoment \* aeroFade/.test(psrc) && /if \(!SPEC\.rotor\) \{\s*const bGE/.test(psrc));
  // F1: Dryden turbulence.
  const run = (opts, seconds = 120, dt = 1 / 60, seed = 3) => {
    const D = new T.DrydenGusts(seed);
    const w = [];
    for (let t = 0; t < seconds; t += dt) w.push(D.step(dt, opts).w);
    return w;
  };
  const stats = (a) => { const m = a.reduce((s, v) => s + v, 0) / a.length; const v = a.reduce((s, x) => s + (x - m) * (x - m), 0) / a.length; return { mean: m, sd: Math.sqrt(v) }; };
  const autocorr = (a, lag) => { const { mean: m, sd } = stats(a); let s = 0; for (let i = lag; i < a.length; i++) s += (a[i] - m) * (a[i - lag] - m); return s / ((a.length - lag) * sd * sd); };
  const base = { V: 50, aglM: 150, w20Kts: 15, level: 0.3, spanM: 11 };
  const wA = run(base);
  const sA = stats(wA);
  ok('turbulence: the vertical gust has zero mean and a strength set by the 20 ft wind (a few tenths of a metre a second at 15 kt)', Math.abs(sA.mean) < sA.sd * 0.3 && sA.sd > 0.3 && sA.sd < 3, `mean ${sA.mean.toFixed(2)}, sd ${sA.sd.toFixed(2)} m/s`);
  const sWindy = stats(run({ ...base, w20Kts: 30 }));
  ok('turbulence: double the surface wind, about double the gusts', sWindy.sd > sA.sd * 1.6 && sWindy.sd < sA.sd * 2.4, `${sA.sd.toFixed(2)} → ${sWindy.sd.toFixed(2)}`);
  // Correlation time: the lag at which the autocorrelation falls under 1/e — shorter when faster.
  const corrTime = (a, dt = 1 / 60) => { for (let lag = 1; lag < a.length / 4; lag++) if (autocorr(a, lag) < Math.exp(-1)) return lag * dt; return Infinity; };
  const tSlow = corrTime(run({ ...base, V: 30 }, 240));
  const tFast = corrTime(run({ ...base, V: 90 }, 240));
  ok('turbulence: flying faster brings the bumps quicker (the correlation time falls with airspeed)', tFast < tSlow * 0.7, `30 m/s: ${tSlow.toFixed(2)} s; 90 m/s: ${tFast.toFixed(2)} s`);
  const tLow = corrTime(run({ ...base, aglM: 30 }, 240));
  const tHigh = corrTime(run({ ...base, aglM: 1500 }, 240));
  ok('turbulence: low level is choppier (shorter correlation) than high altitude', tLow < tHigh, `30 m: ${tLow.toFixed(2)} s; 1500 m: ${tHigh.toFixed(2)} s`);
  // Not periodic: no autocorrelation peak past the first decay (the old sines had |ρ| > 0.5 at their period).
  let peak = 0;
  for (let lag = Math.round(2 * tSlow * 60); lag < 60 * 30; lag += 3) peak = Math.max(peak, Math.abs(autocorr(wA, lag)));
  ok('turbulence: random, not periodic — no autocorrelation above 0.25 beyond twice the correlation time', peak < 0.25, `worst |ρ| ${peak.toFixed(3)}`);
  // Frame-rate independence of the variance.
  const s30 = stats(run(base, 240, 1 / 30, 5));
  const s120 = stats(run(base, 240, 1 / 120, 5));
  ok('turbulence: the same strength at 30 and at 120 frames a second (exp(−dt/τ) decay, √(1−a²) noise)', Math.abs(s30.sd - s120.sd) < 0.25 * Math.max(s30.sd, s120.sd), `30 Hz ${s30.sd.toFixed(2)}, 120 Hz ${s120.sd.toFixed(2)}`);
  const D1 = new T.DrydenGusts(11);
  const D2 = new T.DrydenGusts(11);
  let same = true;
  for (let i = 0; i < 200; i++) { const a = D1.step(1 / 60, base); const b = D2.step(1 / 60, base); if (a.w !== b.w || a.np !== b.np) same = false; }
  ok('turbulence: seeded — the same seed replays the same gusts', same);
  const sUnit = stats((() => { const D = new T.DrydenGusts(2); const a = []; for (let t = 0; t < 240; t += 1 / 60) a.push(D.step(1 / 60, base).np); return a; })());
  ok('turbulence: the roll, pitch and yaw channels are unit-variance noise for the buffet moments', sUnit.sd > 0.75 && sUnit.sd < 1.25, sUnit.sd.toFixed(2));
  ok('physics: the aeroplane flies through the Dryden gusts (per aircraft, body axes turned to the world), and the buffet moments come from its channels, not sines', /new DrydenGusts\(/.test(psrc) && /this\._tmp2\.set\(D\.v, D\.w, -D\.u\)\.applyQuaternion\(this\.quat\)/.test(psrc) && /Dn\.np \* 700/.test(psrc) && !/Math\.sin\(tt \* 7\.3 \+ 1\.1\)/.test(psrc));
  const P = T.drydenParams(300, 20, 0.3);
  const Ph = T.drydenParams(5000, 20, 0.3);
  ok('turbulence: the standard\'s scale lengths — the vertical one is the height low down, 1,750 ft aloft', near(P.Lw, 300, 1e-6) && near(Ph.Lw, 1750, 1e-6) && P.Lu > P.Lw, `low Lw ${P.Lw}, Lu ${P.Lu.toFixed(0)}; high ${Ph.Lw}`);
  // Clear air at cruise is smooth: the altitude strength goes with the level squared, so a clear sky's 0.12 sits at the floor
  // and a steady autopilot run stays inside the game's wander cap (tests/features/shake.mjs); a storm still gets the lot.
  const clearHigh = T.drydenParams(36000, 0, 0.12);
  const stormHigh = T.drydenParams(36000, 0, 1);
  ok('turbulence: clear air at cruise is at the floor (0.3 ft/s); a storm aloft is the full 14 ft/s', near(clearHigh.sw, T.DRYDEN.minSigmaFtS, 1e-9) && near(stormHigh.sw, T.DRYDEN.highSigmaFtS, 1e-9), `${clearHigh.sw} / ${stormHigh.sw}`);
  const Dq = new T.DrydenGusts(3);
  const oq = Dq.step(1 / 60, { ...base, aglM: 11000, level: 0.12, w20Kts: 0 });
  ok('turbulence: the filter reports its vertical gust strength (sigmaW) for the buffet to size by', Number.isFinite(oq.sigmaW) && near(oq.sigmaW, T.DRYDEN.minSigmaFtS, 1e-9), `${oq.sigmaW}`);
  ok('physics: the buffet moments are sized by the gust strength (3 ft/s is the old full buffet) and a long frame cannot land a long kick', /clamp\(\(Dn\.sigmaW \|\| 0\) \/ 3, 0, 1\.5\)/.test(psrc) && /Math\.min\(1, 1 \/ \(40 \* Math\.max\(dt, 1e-4\)\)\)/.test(psrc));
}

/* -------------------------------------------------- 5. cloud shadows done properly -- */
{
  const C = await imp('src/world/clouds.js');
  const cs = C.cloudShadow;
  const csrc = await (await import('node:fs/promises')).readFile(new URL('src/world/clouds.js', root), 'utf8');
  const tsrc = await (await import('node:fs/promises')).readFile(new URL('src/world/terrain.js', root), 'utf8');
  const osrc = await (await import('node:fs/promises')).readFile(new URL('src/render/ocean-material.js', root), 'utf8');
  const msrc = await (await import('node:fs/promises')).readFile(new URL('src/main.js', root), 'utf8');
  ok('cloud shadow: two textures and shared uniforms (current, previous, the mix, the drift)', cs.bufs.length === 2 && cs.uniforms.uCloudShadow && cs.uniforms.uCloudShadowPrev && cs.uniforms.uCloudMix && cs.uniforms.uCloudDrift && cs.n === 128);
  ok('cloud shadow: the old names still read the current buffer', cs.texture === cs.bufs[cs.cur].texture && cs.data === cs.bufs[cs.cur].data && cs.xform === cs.bufs[cs.cur].xform);
  // A repaint: fill the next buffer, swap, and the mix starts at 0 and reaches 1 over CLOUD_SHADE_FADE_S.
  const before = cs.cur;
  cs.next.data.fill(255);
  cs.next.xform.set(0, 0, 1 / cs.size, 0.7);
  cs.swap(10);
  const wind = { x: 5, z: 0 };
  cs.tick(10, wind);
  const m0 = cs.uniforms.uCloudMix.value;
  cs.tick(10 + C.CLOUD_SHADE_FADE_S / 2, wind);
  const mHalf = cs.uniforms.uCloudMix.value;
  cs.tick(10 + C.CLOUD_SHADE_FADE_S + 0.01, wind);
  const m1 = cs.uniforms.uCloudMix.value;
  ok('cloud shadow: a repaint swaps buffers and cross-fades in over a third of a second (0 → ½ → 1), no one-frame step', cs.cur !== before && m0 === 0 && near(mHalf, 0.5, 0.05) && m1 === 1 && near(C.CLOUD_SHADE_FADE_S, 0.35, 0.1), `${m0} ${mHalf.toFixed(2)} ${m1}`);
  ok('cloud shadow: between repaints the lookup slides by wind × time (the current drifted 5 m/s × 0.36 s)', near(cs.uniforms.uCloudDrift.value.z, 5 * (C.CLOUD_SHADE_FADE_S + 0.01), 1e-6) && cs.uniforms.uCloudDrift.value.w === 0, cs.uniforms.uCloudDrift.value.toArray().join(','));
  // shadeAt reads what the shaders read: full shade inside the painted square, none outside, in between while fading.
  cs.tick(10 + 5, { x: 0, z: 0 });
  const inside = cs.shadeAt(0, 0);
  const outside = cs.shadeAt(cs.size, cs.size);
  ok('cloud shadow: one CPU sample at a point reads the shade the shaders see (0.7 inside the painted square, 0 outside)', near(inside, 0.7, 0.02) && outside === 0, `${inside.toFixed(2)} / ${outside}`);
  cs.next.data.fill(0);
  cs.next.xform.set(0, 0, 1 / cs.size, 0.7);
  cs.swap(20);
  cs.tick(20 + C.CLOUD_SHADE_FADE_S / 2, { x: 0, z: 0 });
  ok('cloud shadow: half-way through a repaint the sample is half-way between old and new', near(cs.shadeAt(0, 0), 0.35, 0.03), cs.shadeAt(0, 0).toFixed(2));
  for (const b of cs.bufs) { b.data.fill(0); b.xform.w = 0; }
  cs.uniforms.uCloudMix.value = 1;
  ok('cloud shadow: the painter writes the buffer not on show, then swaps; a sun gone low fades the shade out the same way', /const nb = cs\.next;[\s\S]*nb\.texture\.needsUpdate = true;\s*cs\.swap\(this\.t\);/.test(csrc) && /nb\.data\.fill\(0\);\s*nb\.texture\.needsUpdate = true;\s*cs\.swap\(this\.t\);/.test(csrc));
  ok('cloud shadow: shadows land on the ground that is there (groundAt), not at sea level', /this\.groundAt\(gx, gz\)/.test(csrc) && /gx = px \+ sx \* \(y - gy\)/.test(csrc) && /this\.clouds\.groundAt = heightAt/.test(msrc));
  ok('cloud shadow: the terrain and the sea sample the same cross-faded texture (one GLSL, shared uniforms); Low compiles the sea\'s taps out', /CLOUD_SHADE_GLSL/.test(tsrc) && /cloudShadeAt\(vCloudXZ\)/.test(tsrc) && /Object\.assign\(shader\.uniforms, cloudShadow\.uniforms\)/.test(tsrc) && /cloudShadeAt\(p\)/.test(osrc) && /#if WATER_DETAIL > 0\s*\$\{CLOUD_SHADE_GLSL\}/.test(osrc) && /if \(quality !== 'low'\) Object\.assign\(uniforms, cloudShadow\.uniforms\)/.test(osrc));
}

/* -------------------------------------------- 6. haze that thins with height (L4 lite) -- */
{
  const A = await imp('src/world/atmos.js');
  const ssrc = await (await import('node:fs/promises')).readFile(new URL('src/world/sky.js', root), 'utf8');
  ok('haze: the weather\'s fog holds up to 700 m (every approach, the weather checks\' heights)', A.fogThinning(0) === 1 && A.fogThinning(300) === 1 && A.fogThinning(700) === 1);
  ok('haze: from 10,000 ft the fog is about two thirds of the weather\'s; from 30,000 ft under half; never under 0.4, never over 1', near(A.fogThinning(3000), 0.68, 0.03) && A.fogThinning(9000) < 0.5 && A.fogThinning(9000) > 0.4 && A.fogThinning(50000) >= 0.4 && A.fogThinning(50000) < 0.41, `${A.fogThinning(3000).toFixed(2)} ${A.fogThinning(9000).toFixed(2)}`);
  let mono = true;
  for (let h = 0, prev = 1; h <= 20000; h += 100) { const v = A.fogThinning(h); if (v > prev + 1e-12) mono = false; prev = v; }
  ok('haze: it only ever thins as you climb', mono);
  ok('sky: the scene fog takes the thinned density (and the sunset lobe scales the same number)', /const fogDensity = p\.fogDensity \* fogThinning\(eyeY\)/.test(ssrc) && /this\.scene\.fog\.density = fogDensity;/.test(ssrc) && /this\.scene\.fog\.density = fogDensity \* \(1 \+ 2\.4 \* low \* lobe\)/.test(ssrc));
}

/* -------------------------------------------------------------- report -- */
const failed = results.filter((r) => !r.pass);
console.log(`\nrealism: ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;

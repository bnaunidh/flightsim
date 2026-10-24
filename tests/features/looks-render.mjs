/**
 * Node checks for the looks pass, package A: the sky, the light and the
 * Graphics quality setting. Run from the repo root with plain node:
 *
 *   node tests/features/looks-render.mjs
 *
 *   1. pickTier: the Auto probe's buckets (>22 ms low, >15 ms medium, else
 *      high; ultra only under 6 ms on a dense screen; junk keeps high).
 *   2. probeFrames: a trimmed mean, warm-up frames not counted, and it stops
 *      at its time budget however slow the frames are.
 *   3. The settings contract (storage.js coerceQuality / loadSettings):
 *      `quality` is ALWAYS a concrete tier — nineteen modules compare it with
 *      'low' / 'high' / 'ultra' — whatever the save holds; a fresh profile
 *      has Auto on; a save from before Auto existed keeps its tier with Auto
 *      off; 'auto' written into `quality` means the flag, never the word.
 *   4. The moon: today's phase is a real calendar's (a known full and a known
 *      new moon), and the sky scales the stars by it (a full moon leaves a
 *      third of them).
 *   5. The colour grade: warmer at sunset, flatter and cooler under cloud,
 *      and a clear noon's glow threshold high enough that only what is
 *      brighter than white (the sun's disc, its glints) blooms.
 *   6. Light scattering toward a low sun: at sunset the fog looking toward
 *      the sun is warmer than looking away; at noon it does not follow the
 *      view at all.
 *   7. The bloom pass's shaders and the terrain patch: Low's terrain shader
 *      is the old source exactly; Medium's carries the cloud shadow and the
 *      cliff projection.
 */

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);

let pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail && !cond ? ` — ${detail}` : ''}`);
}

const Q = await load('src/render/quality-probe.js');
const S = await load('src/core/storage.js');
const W = await load('src/world/weather.js');
const THREE = await load('src/vendor/three.module.js');
const SKY = await load('src/world/sky.js');

/* 1. pickTier ------------------------------------------------------------ */
{
  const cases = [
    [40, 1, 'low'],
    [22.01, 1, 'low'],
    [22, 1, 'medium'],
    [18, 2, 'medium'],
    [15.01, 1, 'medium'],
    [15, 1, 'high'],
    [9, 1, 'high'],
    [5.9, 1, 'high'],
    [5.9, 2, 'ultra'],
    [6, 2, 'high'],
    [3, 1.5, 'high'],
    [NaN, 2, 'high'],
    [-1, 1, 'high'],
    [0, 2, 'high'],
    [undefined, 1, 'high'],
    ['12', 1, 'high'],
    [Infinity, 1, 'high'],
  ];
  const bad = cases.filter(([ms, dpr, want]) => Q.pickTier(ms, dpr) !== want);
  ok('pickTier: every bucket and every junk input', bad.length === 0, bad.map(([m, d, w]) => `${m}@${d}→${Q.pickTier(m, d)} (want ${w})`).join(', '));
  ok('pickTier: only ever answers a tier', cases.every(([ms, dpr]) => Q.TIERS.includes(Q.pickTier(ms, dpr))));
  ok('asHighMs: a Medium frame reads as a dearer High one', Q.asHighMs(10, 'medium') > 10 && Q.asHighMs(10, 'high') === 10 && Q.asHighMs(10, 'nonsense') === 10);
}

/* 2. probeFrames --------------------------------------------------------- */
{
  let t = 0;
  const now = () => t;
  // 2 warm-up frames of 500 ms (shader compiles), then frames of 10 ms with
  // one 200 ms garbage-collection hiccup and one 1 ms fluke.
  const seq = [500, 500, ...Array.from({ length: 40 }, (_, i) => (i === 7 ? 200 : i === 20 ? 1 : 10))];
  let i = 0;
  const res = Q.probeFrames(() => { t += seq[Math.min(i++, seq.length - 1)]; }, { warmup: 2, frames: 40, budgetMs: 5000, now });
  ok('probeFrames: warm-up frames are not counted', res.frames === 40 && res.warmMs === 1000, JSON.stringify(res));
  ok('probeFrames: the slowest and fastest tenth are dropped', Math.abs(res.avgMs - 10) < 1e-9, String(res.avgMs));
  t = 0;
  const slow = Q.probeFrames(() => { t += 100; }, { warmup: 1, frames: 40, budgetMs: 800, now });
  ok('probeFrames: stops at its budget on a slow machine', slow.frames <= 9 && slow.totalMs <= 1000 && slow.avgMs === 100, JSON.stringify(slow));
  ok('probeFrames: a slow machine is told Low', Q.pickTier(slow.avgMs, 1) === 'low');
}

/* 3. the settings contract ---------------------------------------------- */
{
  const tiers = ['low', 'medium', 'high', 'ultra'];
  const D = S.DEFAULT_SETTINGS;
  ok('defaults: quality is a tier, Auto on, nothing picked', tiers.includes(D.quality) && D.qualityAuto === true && D.qualityAutoPicked === null);

  const co = (s, saved = s) => S.coerceQuality({ ...D, ...s }, saved);
  let s = co({ quality: 'low' }, { quality: 'low' });
  ok('an old save (no qualityAuto key) keeps its tier, Auto off', s.quality === 'low' && s.qualityAuto === false, JSON.stringify(s));
  s = co({ quality: 'ultra' }, { quality: 'ultra' });
  ok('an old Ultra save stays Ultra', s.quality === 'ultra' && s.qualityAuto === false);
  s = co({ quality: 'high', qualityAuto: false }, { quality: 'high', qualityAuto: false });
  ok('a player who chose a tier keeps it', s.quality === 'high' && s.qualityAuto === false);
  s = co({ quality: 'medium', qualityAuto: true, qualityAutoPicked: 'low' });
  ok('Auto on: the picked tier is the one built', s.quality === 'low' && s.qualityAuto === true);
  s = co({ quality: 'auto' }, { quality: 'auto' });
  ok("'auto' in quality means the flag, never the word", s.quality === 'high' && s.qualityAuto === true, JSON.stringify(s));
  s = co({ quality: 'auto', qualityAutoPicked: 'medium' }, { quality: 'auto', qualityAutoPicked: 'medium' });
  ok("'auto' with a pick builds the pick", s.quality === 'medium' && s.qualityAuto === true);
  for (const junk of ['potato', '', null, 7, undefined, 'High', { a: 1 }]) {
    s = co({ quality: junk, qualityAuto: false });
    ok(`junk quality ${JSON.stringify(junk)} becomes a tier`, tiers.includes(s.quality), String(s.quality));
  }
  s = co({ qualityAuto: true, qualityAutoPicked: 'auto' });
  ok('a junk pick is dropped', s.qualityAutoPicked === null && tiers.includes(s.quality));
  s = co({ qualityAuto: 'yes' });
  ok('qualityAuto is always a boolean', s.qualityAuto === true || s.qualityAuto === false);

  // Through the real loader, as the boot reads it.
  store.clear();
  s = S.loadSettings();
  ok('a fresh profile boots with a concrete tier and Auto on', tiers.includes(s.quality) && s.qualityAuto === true && s.qualityAutoPicked === null, JSON.stringify({ q: s.quality, a: s.qualityAuto }));
  const old = { ...D };
  delete old.qualityAuto;
  delete old.qualityAutoPicked;
  old.quality = 'medium';
  store.set('islandsim.settings.v1', JSON.stringify(old));
  s = S.loadSettings();
  ok('loadSettings: an existing save without qualityAuto keeps Medium', s.quality === 'medium' && s.qualityAuto === false, JSON.stringify({ q: s.quality, a: s.qualityAuto }));
  store.set('islandsim.settings.v1', JSON.stringify({ ...old, quality: 'auto' }));
  s = S.loadSettings();
  ok("loadSettings: a save holding 'auto' loads as a tier", tiers.includes(s.quality) && s.qualityAuto === true, s.quality);
  store.set('islandsim.settings.v1', JSON.stringify({ ...D, qualityAuto: true, qualityAutoPicked: 'low', quality: 'high' }));
  s = S.loadSettings();
  ok('loadSettings: Auto with a pick builds the pick (no probe again)', s.quality === 'low' && s.qualityAutoPicked === 'low');
  store.clear();
}

/* 4. the moon ------------------------------------------------------------ */
{
  // Real moons: full 2024-01-25 17:54 UTC, new 2024-01-11 11:57 UTC,
  // first quarter 2024-01-18 03:52 UTC.
  const full = W.moonPhaseAt(Date.UTC(2024, 0, 25, 17, 54));
  const nw = W.moonPhaseAt(Date.UTC(2024, 0, 11, 11, 57));
  const fq = W.moonPhaseAt(Date.UTC(2024, 0, 18, 3, 52));
  ok('moonPhaseAt: a known full moon is full', full.illum > 0.98, full.illum.toFixed(3));
  ok('moonPhaseAt: a known new moon is dark', nw.illum < 0.02, nw.illum.toFixed(3));
  ok('moonPhaseAt: a first quarter is half lit and waxing', Math.abs(fq.illum - 0.5) < 0.1 && fq.waxing === true, `${fq.illum.toFixed(3)} ${fq.waxing}`);
  const w = new W.Weather();
  ok('Weather seeds a moon phase per day', typeof w.moonPhase === 'number' && w.moonPhase >= 0 && w.moonPhase <= 1 && typeof w.moonWaxing === 'boolean');

  const scene = new THREE.Scene();
  const sky = new SKY.SkyDome(scene, { shadows: false });
  w.load({ time: 'night', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
  w.moonPhase = 1;
  sky.update(w);
  const starsFull = sky.uniforms.uStars.value;
  const moonFull = sky.uniforms.uMoon.value;
  w.moonPhase = 0;
  sky.update(w);
  const starsNew = sky.uniforms.uStars.value;
  ok('a full moon leaves about a third of the stars', Math.abs(starsFull / starsNew - 0.35) < 0.01, `${starsFull} / ${starsNew}`);
  ok('the moon is up at night on a clear sky', moonFull > 0.8 && sky.uniforms.uMoonPhase.value === 0);
  w.load({ time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
  sky.update(w);
  ok('no stars and no moon by day', sky.uniforms.uStars.value === 0 && sky.uniforms.uMoon.value === 0);
}

/* 5. the colour grade ---------------------------------------------------- */
{
  const w = new W.Weather();
  const look = (time, condition) => {
    w.load({ time, condition, windSpeedKts: 4, windDirDeg: 90 });
    return { ...w.look() };
  };
  const noon = look('day', 'clear');
  const sunset = look('sunset', 'clear');
  const night = look('night', 'clear');
  const grey = look('day', 'cloudy');
  ok('grade: sunset is warmer than noon', sunset.warmth > noon.warmth + 0.3, `${sunset.warmth} vs ${noon.warmth}`);
  ok('grade: cloud is cooler, flatter and greyer than clear', grey.warmth < noon.warmth && grey.contrast < noon.contrast && grey.saturation < noon.saturation, JSON.stringify(grey));
  ok('grade: gentle (no knob far from neutral)', [noon, sunset, night, grey].every((l) => Math.abs(l.warmth) <= 0.6 && Math.abs(l.contrast - 1) <= 0.1 && Math.abs(l.saturation - 1) <= 0.2));
  ok('glow: a clear noon blooms only what is brighter than white', noon.threshold >= 1);
  ok('glow: the night lights bloom more than noon', night.threshold < noon.threshold && night.bloom > noon.bloom);
}

/* 6. light scattering toward a low sun ---------------------------------- */
{
  const w = new W.Weather();
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(60, 1.5, 0.1, 1000);
  const sky = new SKY.SkyDome(scene, { shadows: false, camera: cam });
  const sun = new THREE.Vector3();
  const fogLooking = (sign) => {
    w.sunDirection(sun);
    cam.position.set(0, 10, 0);
    cam.lookAt(sign * sun.x * 100, 10, sign * sun.z * 100);
    cam.updateMatrixWorld(true);
    sky.update(w);
    return scene.fog.color.clone();
  };
  w.load({ time: 'sunset', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
  const toward = fogLooking(1);
  const away = fogLooking(-1);
  ok('sunset: the haze toward the sun is warmer than away from it', toward.r - toward.b > away.r - away.b + 0.05, `toward ${toward.getHexString()} away ${away.getHexString()}`);
  ok('sunset: the clouds fade into the same fog as the land', sky.viewFog.color.equals(scene.fog.color));
  w.load({ time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 });
  const a = fogLooking(1);
  const b = fogLooking(-1);
  ok('noon: the fog does not follow the view', a.equals(b) && a.equals(w.palette().fogColor), `${a.getHexString()} ${b.getHexString()}`);
}

/* 7. shaders ------------------------------------------------------------- */
{
  const { readFileSync } = await import('node:fs');
  const post = readFileSync(new URL('src/render/post.js', root), 'utf8');
  ok('bloom: one HalfFloat scene target with 4× MSAA, its colour sRGB', /HalfFloatType/.test(post) && /samples/.test(post) && /SRGBColorSpace/.test(post));
  const { PostFX } = await load('src/render/post.js');
  const fx = new PostFX({ getDrawingBufferSize: (v) => v.set(1366, 768) });
  ok('bloom: off until a tier turns it on, no targets', fx.enabled === false && !fx.sceneRT);
  fx.setEnabled(false);
  ok('bloom: switching off frees nothing it does not have', !fx.sceneRT && !fx.rtA && !fx.rtB);
  fx.setEnabled(true);
  ok('bloom: a card without float targets keeps the plain frame', fx.enabled === false && fx.supported === false);
  const fx2 = new PostFX({ extensions: { has: (n) => n === 'EXT_color_buffer_float' }, getDrawingBufferSize: (v) => v.set(1366, 768) });
  fx2.setEnabled(true);
  ok('bloom: a card with float targets turns it on', fx2.enabled === true);
  fx2.setEnabled(false);
  ok('bloom: and off again', fx2.enabled === false && !fx2.sceneRT);

  const terr = readFileSync(new URL('src/world/terrain.js', root), 'utf8');
  ok('terrain: Low strips the marker to the old line exactly', /texRock\.rgb  \*= uTintRock;\/\*RICH_ROCK\*\//.test(terr) && /replace\('\/\*RICH_ROCK\*\/', ''\)/.test(terr));
  ok('terrain: Medium and up carry the cloud shadow and the cliffs', /uCloudShadow/.test(terr) && /cloudShade/.test(terr) && /steep/.test(terr));
  ok("terrain: the cloud shade rides three's own directional loop", THREE.ShaderChunk.lights_fragment_begin.includes('getDirectionalLightInfo( directionalLight, directLight );'));
  const CL = await load('src/world/clouds.js');
  ok('clouds: the shadow map is small and off until painted', CL.cloudShadow.n === 128 && CL.cloudShadow.xform.w === 0);
}

/* 8. dynamic resolution ------------------------------------------------- */
{
  const D = await load('src/render/dyn-res.js');
  const d = new D.DynamicResolution();
  ok('dyn-res: starts at full size', d.scale === 1);
  let r = d.tick(20);
  ok('dyn-res: one slow second changes nothing', r.changed === false && d.scale === 1);
  r = d.tick(20);
  ok('dyn-res: two slow seconds take a step down', r.changed === true && d.scale === 0.9, String(d.scale));
  for (let i = 0; i < 40; i++) d.tick(10);
  ok('dyn-res: never under the floor', d.scale === 0.65, String(d.scale));
  d.tick(40);
  ok('dyn-res: a middling frame rate holds where it is', d.scale === 0.65);
  for (let i = 0; i < 3; i++) r = d.tick(60);
  ok('dyn-res: three fast seconds are not yet a step up', r.changed === false && d.scale === 0.65);
  r = d.tick(60);
  ok('dyn-res: the fourth is, and a smaller one', r.changed === true && d.scale === 0.7, String(d.scale));
  for (let i = 0; i < 60; i++) d.tick(60);
  ok('dyn-res: recovers to full and no further', d.scale === 1);
  d.tick(10); d.tick(10);
  d.reset();
  ok('dyn-res: a new tier starts again from full', d.scale === 1 && d.slow === 0);
  ok('dyn-res: junk frame rates are ignored', d.tick(NaN).changed === false && d.tick(0).changed === false && d.scale === 1);
  ok('pixelRatioCap: a laptop at 1.25, High at 2, Ultra up to 3, never over the screen', D.pixelRatioCap('low', 2) === 1.25 && D.pixelRatioCap('medium', 1) === 1 && D.pixelRatioCap('high', 2) === 2 && D.pixelRatioCap('ultra', 3) === 3 && D.pixelRatioCap('ultra', 2) === 2);
}

/* 9. the boot probe stays out of the test Chromes ------------------------ */
{
  const { readFileSync } = await import('node:fs');
  const main = readFileSync(new URL('src/main.js', root), 'utf8');
  // A fresh-profile headless Chrome on a busy Mac must not pick a random tier
  // for every browser suite; ?autoq=1 still exercises the boot probe.
  ok('boot probe: skipped under navigator.webdriver unless ?autoq=1', /navigator\.webdriver && !\/\[\?&\]autoq=1/.test(main) && /qualityAutoPicked && !automated\)/.test(main));
}

console.log(`\nlooks-render: ${pass}/${pass + fails.length} passed`);
if (fails.length) {
  console.log('FAILED:\n  ' + fails.join('\n  '));
  process.exit(1);
}

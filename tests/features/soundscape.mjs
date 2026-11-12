/**
 * Node checks for the soundscape's numbers (src/features/soundscape/maths.js)
 * and where it sits: after the menu, never on first load, muted by default.
 * The audio itself: soundscape.browser.js.
 *
 *   node tests/features/soundscape.mjs
 */
import { readFileSync } from 'node:fs';
import { load, ok, report, root } from './tomm1z-common.mjs';

const src = (p) => readFileSync(new URL(p, root), 'utf8');
const M = await load('src/features/soundscape/maths.js');

/* ---- aspect ---- */
ok('aspect: ahead is 1, astern -1, abeam 0', M.aspectCos(0, 0, -1, 0, 0, -50) === 1 && M.aspectCos(0, 0, -1, 0, 0, 50) === -1 && Math.abs(M.aspectCos(0, 0, -1, 40, 0, 0)) < 1e-9);
{
  const ahead = M.aspectGains(1, false);
  const astern = M.aspectGains(-1, false);
  const abeam = M.aspectGains(0, false);
  ok('aspect: the fan carries ahead, the roar astern', ahead.front > astern.front * 2 && astern.rear > ahead.rear * 2, JSON.stringify({ ahead, astern }));
  ok('aspect: a propeller is loudest abeam', abeam.disc > ahead.disc && abeam.disc > astern.disc, JSON.stringify(abeam));
  ok('aspect: on the aeroplane (cockpit, chase) nothing is weighed', JSON.stringify(M.aspectGains(-1, true)) === JSON.stringify({ front: 1, rear: 1, disc: 1 }));
}

/* ---- the ground's echo ---- */
{
  const over = M.groundEcho(0, 60, 1.7, 'paved');
  ok('echo: overhead at 60 m the delay is the path difference, 2·1.7 m over 343 m/s', Math.abs(over.delay - ((61.7 - 58.3) / 343)) < 1e-5, String(over.delay));
  const away = M.groundEcho(500, 60, 1.7, 'paved');
  ok('echo: it shortens as the aeroplane goes away (the fly-by sweep)', away.delay < over.delay / 5, `${over.delay} overhead, ${away.delay} at 500 m`);
  ok('echo: grass throws back less than concrete, water more', M.groundEcho(100, 30, 2, 'grass').gain < M.groundEcho(100, 30, 2, 'paved').gain && M.groundEcho(100, 30, 2, 'water').gain > M.groundEcho(100, 30, 2, 'paved').gain);
  ok('echo: with the ear high over the ground it is a repeat, not a comb, and is faded out', M.groundEcho(15, 300, 303, 'paved').gain === 0, JSON.stringify(M.groundEcho(15, 300, 303)));
}

/* ---- reverb ---- */
ok('reverb: none in the cockpit', M.reverbSend(800, true) === 0);
ok('reverb: more far off than close', M.reverbSend(800, false) > M.reverbSend(30, false) * 4, `${M.reverbSend(30, false)} close, ${M.reverbSend(800, false)} far`);
ok('reverb: less with the ear high in open sky', M.reverbSend(800, false, 600) < M.reverbSend(800, false, 2) / 2);

/* ---- drops ---- */
ok('clicks: the gain for a rate is exact for uniform noise (rate = sr·(1 − T/k))', Math.abs(44100 * (1 - M.CLICK_T / M.clickGain(300)) - 300) < 1e-6 && M.clickGain(0) === 0);
ok('rain: none when dry', M.rainRate(0, 100, true) === 0);
ok('rain: more flying into it', M.rainRate(1, 120, false) > M.rainRate(1, 0, false) * 2);
{
  const storm = { storm: 1, cb: 1, rain: 1 };
  ok('hail: none from ordinary rain', M.hailLevel({ rain: 1, storm: 0 }, 1, 1) === 0);
  ok('hail: in a storm only in its shafts, or inside the cell', M.hailLevel(storm, 0.3, 0) === 0 && M.hailLevel(storm, 0.95, 0) > 0.8 && M.hailLevel(storm, 0.3, 1) > 0.5);
  ok('hail: never on a snow map', M.hailLevel(storm, 1, 1, true) === 0);
}

/* ---- touchdown, spools, others ---- */
{
  const a = M.touchdownExtra(0.1, 60);
  const b = M.touchdownExtra(0.9, 60);
  ok('touchdown: the thump follows the sink rate', b.thump > a.thump * 4, `${a.thump} soft, ${b.thump} hard`);
  ok('touchdown: no spin-up scrub at walking pace', M.touchdownExtra(0.5, 2).scrub < 0.05);
  let x = 0;
  for (let i = 0; i < 60; i++) x = M.spool(x, 1, 0.5, 0.3, 1 / 30);
  ok('spool: two seconds at 0.5/s gets about two thirds of the way', x > 0.6 && x < 0.68, x.toFixed(3));
  const cars = [{ px: 5, pz: 0, speed: 13 }, { px: 400, pz: 0, speed: 13 }, { px: 6, pz: 0, speed: 0 }, { px: 5, pz: 0, speed: 13, parked: true }];
  ok('cars: only moving cars in range count', M.carBed(cars, 0, 0).weight === M.carBed([cars[0]], 0, 0).weight && M.carBed([cars[1]], 0, 0).weight === 0);
  const list = [{ pos: { x: 900, y: 0, z: 0 } }, { pos: { x: 100, y: 0, z: 0 } }, { pos: { x: 5000, y: 0, z: 0 } }, { pos: { x: 50, y: 0, z: 0 }, gone: true }];
  const n = M.nearestBodies(list, 0, 0, 0, 2, 1800);
  ok('others: nearest first, the gone and the far left out', n.length === 2 && n[0].d === 100 && n[1].d === 900);
  ok('others: a helicopter, a jet, a propeller', M.bodyVoice({ rotor: true }) === 'rotor' && M.bodyVoice({}, 'narrow') === 'jet' && M.bodyVoice({}, 'turboprop') === 'prop' && M.bodyVoice({ radius: 30 }) === 'jet');
}

/* ---- where it sits ---- */
{
  const idx = src('src/features/index.js');
  ok('loaded after the menu, with the features, after flight-sound', idx.indexOf("import './soundscape.js'") > idx.indexOf("import './flight-sound.js'"));
  const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\s+(?:[^'"\n;]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const seen = new Set();
  const walk = (url) => {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    let text = '';
    try {
      text = readFileSync(url, 'utf8');
    } catch {
      return;
    }
    let m;
    while ((m = IMPORT_RE.exec(text))) if (m[1].startsWith('.')) walk(new URL(m[1], url));
  };
  walk(new URL('src/main.js', root));
  ok('nothing of it on first load (main.js\'s static graph)', ![...seen].some((k) => /soundscape/.test(k)));
  const sw = src('sw.js');
  ok('offline: its modules are in the service worker\'s list', ['soundscape.js', 'soundscape/layers.js', 'soundscape/maths.js'].every((f) => sw.includes(`'src/features/${f}'`)));
  ok('no recordings fetched: the soundscape is synthesised', !/fetch\(|\.(m4a|mp3|ogg|wav)\b/.test(src('src/features/soundscape/layers.js') + src('src/features/soundscape.js')));
  ok('sound still starts muted (settings default muted: true)', /muted:\s*true/.test(src('src/core/storage.js')), '');
  // duckRain re-states the first-load rain's sums to turn them down: if ambience.js changes them, this has to follow.
  const amb = src('src/audio/ambience.js');
  ok('the rain duck works from the first-load rain\'s own sums', amb.includes('rain * (inside ? 0.16 : 0.3) * rainSpeed * 0.8') && amb.includes('inside ? rain * 0.16 * rainSpeed : rain * 0.07') && amb.includes('const rainSpeed = 1 + clamp(v / 60, 0, 1.2);'));
  const lay = src('src/features/soundscape/layers.js');
  ok('no speech, no voices: nothing in it speaks', !/speechSynthesis|SpeechSynthesisUtterance/.test(lay));
}

report();

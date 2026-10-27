/**
 * Node checks for the random weather (wave 19). Run from anywhere:
 *
 *   node tests/features/weather.mjs [--verbose]
 *
 *   1. THE ROLL. 'random' rolls a plausible sky from a seed: the same seed
 *      and map give the same weather every time (and different seeds give
 *      different days); mostly fair; snow only where it is cold, never rain
 *      there; no fog in the desert; never a thunderstorm overhead at the
 *      start.
 *   2. THE PHASES. Over four hours of flying the sky moves on every 8 to 20
 *      minutes (a storm 5 to 9), each change blended over 2 to 3; every
 *      change is announced first (3 minutes for murk); the visibility never
 *      halves inside a minute; every number stays in its range; the clock is
 *      sim time (a 4x sim rate is four times the weather).
 *   3. FAIR ON APPROACH. A change that thickens the murk waits while the
 *      player is on an approach, and goes ahead once they are not.
 *   4. VISIBILITY ↔ FOG. The fog drawn gives the visibility the weather says
 *      (both ways, with and without a low mist); a mist is thin above it;
 *      the fixed skies keep their order.
 *   5. THE WORDS. "wind 240 at 14 gusting 22", "visibility 3 km in mist",
 *      "Weather changing: showers in ~2 min".
 *   6. THE GAME'S WEATHER. Weather.load/beginFlight/describe/serialize with
 *      'random'; the four older words for "is it stormy"; snow only falls
 *      from a cold roll.
 *   7. LIGHTNING. Off with Reduce flashing on (the default); switched off, at
 *      most one soft strike in 20 s, never at full strength, never in one
 *      frame.
 *   8. THE SETTING. Random is the new default; a save still on the old
 *      default (clear) moves to it once, any other sky stays, and Clear
 *      always is in the picker.
 *   9. REGIONS. On the World Map each region has its own weather; the
 *      player's is the nearest's, blended between; fronts drift downwind;
 *      "weather ahead" sees a worse region on the track.
 */
const verbose = process.argv.includes('--verbose');
const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);

const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass, detail: String(detail) });
  if (verbose || !pass) console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

const WX = await load('src/world/wx.js');
const { WxSystem, WxTimeline, PHASES, fogFor, visibilityAt, windWords, visibilityWords, changeWords, climateFor } = WX;

/* ---------------------------------------------------------------- 1. roll -- */
{
  const a = new WxSystem({ seed: 1234, climate: 'temperate', time: 'day', windKts: 10, windDirDeg: 250 });
  const b = new WxSystem({ seed: 1234, climate: 'temperate', time: 'day', windKts: 10, windDirDeg: 250 });
  const trace = (s) => {
    const out = [];
    for (let i = 0; i < 3 * 3600; i++) {
      s.update(1, { x: 0, z: 0 });
      if (i % 120 === 0) out.push(`${s.cond.phase}:${s.cond.visM.toFixed(0)}:${s.wind.dirDeg.toFixed(1)}:${s.wind.kts.toFixed(2)}`);
    }
    return out.join('|');
  };
  const sa = `${a.cond.phase} ${a.wind.dirDeg.toFixed(2)} ${a.wind.kts.toFixed(2)}`;
  const sb = `${b.cond.phase} ${b.wind.dirDeg.toFixed(2)} ${b.wind.kts.toFixed(2)}`;
  ok('roll: the same seed and map give the same start (phase, wind)', sa === sb, sa);
  ok('roll: ...and the same three hours of weather, phase for phase', trace(a) === trace(b), `${a.lines[0].history.length} phases: ${a.lines[0].history.join(' → ')}`);
  const starts = new Map();
  let windsDiffer = 0;
  for (let s = 0; s < 400; s++) {
    const w = new WxSystem({ seed: s * 7919 + 13, climate: 'temperate', time: 'day', windKts: 10, windDirDeg: 250 });
    starts.set(w.cond.phase, (starts.get(w.cond.phase) || 0) + 1);
    if (Math.abs(w.wind.dirDeg - 250) > 5) windsDiffer++;
  }
  ok('roll: different seeds give different days (8 or more kinds of start in 400)', starts.size >= 8, [...starts].map(([k, v]) => `${k} ${v}`).join(', '));
  ok('roll: ...and the day\'s wind varies round the map\'s own', windsDiffer > 300, `${windsDiffer}/400 more than 5° off 250`);

  const tally = (climate, time, n = 2000) => {
    const t = {};
    for (let s = 0; s < n; s++) {
      const w = new WxTimeline(s * 2654435761 + 7, { climate, time });
      t[w.phase] = (t[w.phase] || 0) + 1;
    }
    return t;
  };
  const tz = tally('temperate', 'day');
  const fairish = ['clear', 'fair', 'scattered', 'clearing', 'haze'].reduce((n, k) => n + (tz[k] || 0), 0) / 2000;
  const wet = ['showers', 'rain', 'heavyRain', 'storm'].reduce((n, k) => n + (tz[k] || 0), 0) / 2000;
  ok('roll: mostly fair (clear, fair, scattered, haze: 60% or more of temperate days)', fairish >= 0.6, `${(fairish * 100).toFixed(0)}% fair, ${(wet * 100).toFixed(0)}% wet — ${JSON.stringify(tz)}`);
  ok('roll: sometimes rain (2-20%), overcast, broken, mist and far-off cells all turn up', wet >= 0.02 && wet <= 0.2 && tz.overcast && tz.broken && tz.mist && tz.cells, `wet ${(wet * 100).toFixed(1)}%`);
  ok('roll: never a thunderstorm overhead to start with, and no snow where it is not cold', !tz.storm && !tz.snow && !tz.snowShowers, JSON.stringify(tz));
  const tc = tally('cold', 'day');
  ok('roll: where it is cold, snow and no rain', (tc.snow || 0) > 0 && !tc.rain && !tc.heavyRain && !tc.showers, JSON.stringify(tc));
  const tt = tally('tropical', 'day');
  ok('roll: the tropics: more showers and cells than temperate, no fog', (tt.showers || 0) + (tt.cells || 0) > (tz.showers || 0) + (tz.cells || 0) && !tt.fog, JSON.stringify(tt));
  const ta = tally('arid', 'day');
  ok('roll: the desert: no fog or mist, clearer', !ta.fog && !ta.mist && (ta.clear || 0) > (tz.clear || 0), JSON.stringify(ta));
  const tn = tally('temperate', 'night');
  ok('roll: night brings more mist and fog than midday', (tn.mist || 0) + (tn.fog || 0) > (tz.mist || 0) + (tz.fog || 0), `night ${(tn.mist || 0) + (tn.fog || 0)}, day ${(tz.mist || 0) + (tz.fog || 0)}`);
  ok('climate: read from the map (snow precip, "Cold", "Tropical", "desert") and the region band',
    climateFor({ precip: 'snow' }) === 'cold' && climateFor({ subtitle: 'Cold · steep ridges' }) === 'cold' && climateFor({ subtitle: 'Tropical · gentle hills' }) === 'tropical'
      && climateFor({ subtitle: 'Military · long concrete, high desert' }) === 'arid' && climateFor({ subtitle: 'Grassland' }) === 'temperate' && climateFor(null, { band: 'cold' }) === 'cold');
}

/* -------------------------------------------------------------- 2. phases -- */
{
  const bad = [];
  let changes = 0;
  let worstDrop = 1;
  let rangeBad = '';
  for (let seed = 1; seed <= 30; seed++) {
    for (const climate of ['temperate', 'tropical', 'cold']) {
      const L = new WxTimeline(seed * 977, { climate, time: seed % 3 === 0 ? 'night' : 'day' });
      let lastSoon = null;
      let blendStart = null;
      let phaseStart = 0;
      let firstPhase = true;
      const vis = [];
      for (let t = 1; t <= 4 * 3600; t++) {
        const n = L.update(1, false);
        vis.push(L.cond.visM);
        if (vis.length > 60) {
          const drop = L.cond.visM / vis[vis.length - 61];
          if (drop < worstDrop) worstDrop = drop;
        }
        for (const k of ['cloud', 'cu', 'tcu', 'cb', 'stratus', 'cirrus', 'scud', 'rain', 'snow', 'mist', 'haze', 'turb', 'gust', 'storm']) {
          const v = L.cond[k];
          if (!(v >= 0 && v <= 1)) rangeBad = `${k}=${v} in ${L.cond.phase}`;
        }
        if (!(L.cond.visM >= 500 && L.cond.visM <= 99999)) rangeBad = `visM=${L.cond.visM}`;
        if (climate !== 'cold' && L.cond.snow > 0) rangeBad = `snow in ${climate}`;
        if (climate === 'cold' && L.cond.rain > 0) rangeBad = `rain where it is cold (${L.cond.phase})`;
        if (!n) continue;
        if (n.kind === 'soon') lastSoon = { t, n };
        if (n.kind === 'start') {
          changes++;
          blendStart = t;
          const need = n.murk ? WX.WARN_MURK_S : WX.WARN_S;
          if (!lastSoon || t - lastSoon.t < need - 1) bad.push(`${climate}#${seed}: ${n.from}→${n.to} started ${lastSoon ? t - lastSoon.t : 'with no'} s after its notice (needs ${need})`);
          const dur = t - phaseStart;
          const max = n.from === 'storm' ? WX.STORM_MAX_S : WX.PHASE_MAX_S;
          const min = n.from === 'storm' ? 300 : WX.PHASE_MIN_S;
          if (!firstPhase && (dur < min - 2 || dur > max + 2)) bad.push(`${climate}#${seed}: ${n.from} lasted ${dur} s`);
        }
        if (n.kind === 'done') {
          const bd = t - blendStart;
          const maxB = n.murk || PHASES[n.to].visM < PHASES[n.from].visM ? WX.MURK_BLEND_MAX_S : WX.BLEND_MAX_S;
          if (bd < WX.BLEND_MIN_S - 2 || bd > maxB + 2) bad.push(`${climate}#${seed}: blend ${bd} s (${n.from}→${n.to})`);
          phaseStart = t;
          firstPhase = false;
          lastSoon = null;
        }
      }
    }
  }
  ok('phases: in four hours the sky changes, every 8 to 20 min (a storm 5 to 9), each blended over 2 to 3 min (a thickening murk up to 7.5)', bad.length === 0 && changes > 90 * 7, bad.slice(0, 4).join('; ') || `${changes} changes in 90 four-hour flights`);
  ok('phases: every change is announced first (2 min, 3 for fog or mist)', !bad.some((b) => /notice/.test(b)), bad.filter((b) => /notice/.test(b)).slice(0, 3).join('; ') || 'all announced');
  ok('phases: the visibility never halves inside a minute (no fog rolling in at once)', worstDrop >= 0.5, `worst minute: × ${worstDrop.toFixed(2)}`);
  ok('phases: every number stays in range, snow only where it is cold and no rain there', !rangeBad, rangeBad || 'all in range');
  // Sim-rate aware: the clock is the sim's.
  const x1 = new WxTimeline(99, {});
  const x4 = new WxTimeline(99, {});
  for (let i = 0; i < 3600; i++) x1.update(1, false);
  for (let i = 0; i < 900; i++) x4.update(4, false);
  ok('phases: a 4x sim rate is four times the weather (the same sky after the same sim time)', x1.phase === x4.phase && x1.history.join() === x4.history.join(), `${x1.history.join(' → ')} vs ${x4.history.join(' → ')}`);
}

/* --------------------------------------------------- 3. fair on approach -- */
{
  // Find a seed whose first change thickens the murk.
  let L = null;
  for (let s = 1; s < 5000 && !L; s++) {
    const c = new WxTimeline(s, { climate: 'temperate', time: 'night' });
    if (WX.murkier(PHASES[c.phase], PHASES[c.next])) L = c;
  }
  ok('approach: a seed with fog or mist on its way exists', !!L, L ? `${L.phase} → ${L.next}` : 'none');
  if (L) {
    const vis0 = L.cond.visM;
    let warned = false;
    let held = 0;
    // On the approach until it has been waiting five minutes.
    for (let t = 0; t < L.dur + 1200 && L.held < 300; t++) {
      const n = L.update(1, true);
      if (n && n.kind === 'soon') warned = true;
      if (L.k > 0) break;
    }
    ok('approach: on an approach, the murk is warned of and then waits (no blend, the visibility as it was)', warned && L.k === 0 && L.cond.visM >= vis0 * 0.999 && L.held > 0, `warned ${warned}, held ${L.held.toFixed(0)} s, vis ${vis0.toFixed(0)} → ${L.cond.visM.toFixed(0)} m`);
    for (let t = 0; t < 30; t++) L.update(1, false);
    ok('approach: ...and once down (or away) it comes in, gently', L.k > 0 && L.k < 0.5, `blend ${(L.k * 100).toFixed(0)}%`);
    // Not held for ever.
    const M = new WxTimeline(L.seed, { climate: 'temperate', time: 'night' });
    let started = false;
    for (let t = 0; t < M.dur + WX.HOLD_MAX_S + 400; t++) if (M.update(1, true) && M.k > 0) started = true;
    ok('approach: ...but a player circling for ever does not stop the weather (it waits 15 min at most)', started && M.history.length + (M.k > 0 ? 1 : 0) > 1, `${M.history.join(' → ')}${M.k > 0 ? ' (blending)' : ''}`);
  }
}

/* ------------------------------------------------- 4. visibility <-> fog -- */
{
  const errs = [];
  for (const v of [900, 3000, 8000, 30000]) {
    for (const m of [0, 0.5, 0.9]) {
      const f = fogFor(v, m, 150);
      const back = visibilityAt(f, 0);
      if (Math.abs(back - v) / v > 0.01) errs.push(`${v} m with ${m} low: ${back.toFixed(0)}`);
    }
  }
  ok('visibility: the fog drawn gives the visibility the weather says (900 m to 30 km, with and without a low mist)', errs.length === 0, errs.join('; ') || 'within 1%');
  const mist = { ...PHASES.mist, ...fogFor(PHASES.mist.visM, PHASES.mist.mist, PHASES.mist.mistH) };
  const v0 = visibilityAt(mist, 0);
  const v600 = visibilityAt(mist, 600);
  ok('visibility: mist lies low — at 600 m above it you see three times as far, or more (a bank you climb out of)', v600 > v0 * 3, `${v0.toFixed(0)} m at the surface, ${v600.toFixed(0)} m at 600 m`);
  const { CONDITIONS } = await load('src/world/weather.js');
  const vs = ['clear', 'cloudy', 'rainy', 'stormy'].map((k) => CONDITIONS[k].visM);
  ok('visibility: the fixed skies keep their order and their fog (clear > cloudy > rainy > stormy)', vs[0] > vs[1] && vs[1] > vs[2] && vs[2] > vs[3] && CONDITIONS.clear.fog === 0.000018, vs.map((v) => `${(v / 1000).toFixed(1)} km`).join(', '));
  const fogBank = { ...CONDITIONS.clear, fog: 0.0025 };
  ok('visibility: a disaster\'s fog bank (its own fog) reads as the murk it draws', visibilityAt(fogBank, 0) < 1000, `${visibilityAt(fogBank, 0).toFixed(0)} m`);
}

/* --------------------------------------------------------------- 5. words -- */
{
  ok('words: "wind 240 at 14 gusting 22"', windWords(240, 14, 22) === 'wind 240 at 14 gusting 22', windWords(240, 14, 22));
  ok('words: on the radio, "wind 2 4 0 at 14 gusting 22"; no gust under 7 kt over; calm is calm',
    windWords(240, 14, 22, { radio: true }) === 'wind 2 4 0 at 14 gusting 22' && windWords(243, 14, 18) === 'wind 240 at 14' && windWords(90, 0.4, 0.4) === 'wind calm', windWords(240, 14, 22, { radio: true }));
  ok('words: "visibility 3 km in mist", "visibility 900 metres in fog", nothing when it is 10 km or more',
    visibilityWords({ visM: 3000, mist: 0.85 }) === 'visibility 3 km in mist' && visibilityWords({ visM: 900, mist: 0.93 }) === 'visibility 900 metres in fog'
      && visibilityWords({ visM: 6000, rain: 0.5 }) === 'visibility 6 km in rain' && visibilityWords({ visM: 30000 }) === '',
    [visibilityWords({ visM: 3000, mist: 0.85 }), visibilityWords({ visM: 900, mist: 0.93 }), visibilityWords({ visM: 6000, rain: 0.5 })].join(' / '));
  ok('words: "Weather changing: showers in ~2 min"', changeWords({ word: 'showers', inS: 118 }) === 'Weather changing: showers in ~2 min', changeWords({ word: 'showers', inS: 118 }));
}

/* ------------------------------------------------------ 6. the game's weather -- */
{
  const { Weather, CONDITIONS, SKY_CHOICES } = await load('src/world/weather.js');
  const w = new Weather();
  w.load({ time: 'day', condition: 'random', windSpeedKts: 9, windDirDeg: 200 });
  w.beginFlight({ seed: 77, map: { id: 'meadow', subtitle: 'Grassland', weather: { windSpeedKts: 10, windDirDeg: 250 } } });
  const d = w.describe();
  ok('game: a random flight has a rolled sky, its words and the day\'s wind', w.wx && d.random && d.seed === 77 && /^wind \d{3} at \d+/.test(d.wind) && d.label && PHASES[w.cond.phase], `${d.label}, ${d.wind}${d.vis ? `, ${d.vis}` : ''}`);
  ok('game: "is it stormy" still gets one of the four older words', ['clear', 'cloudy', 'rainy', 'stormy'].includes(w.effectiveCondition), w.effectiveCondition);
  const ser = w.serialize();
  ok('game: the save keeps Random and the wind you set, not the day\'s', ser.condition === 'random' && ser.windSpeedKts === 9 && ser.windDirDeg === 200, JSON.stringify(ser));
  const w2 = new Weather();
  w2.load({ time: 'day', condition: 'random' });
  w2.beginFlight({ seed: 77, map: { id: 'meadow', subtitle: 'Grassland', weather: { windSpeedKts: 10, windDirDeg: 250 } } });
  ok('game: the same seed on the same map is the same sky', w2.cond.phase === w.cond.phase && Math.abs(w2.windDirDeg - w.windDirDeg) < 1e-9, `${w2.cond.phase} ${w2.windDirDeg.toFixed(1)}°`);
  let news = 0;
  w.onWxNews = () => news++;
  for (let i = 0; i < 60 * 45; i++) w.update(1);
  ok('game: in 45 minutes of flight it tells the game about its changes', news >= 2, `${news} notices; now ${w.cond.label}`);
  w.load({ time: 'day', condition: 'clear' });
  w.beginFlight({ seed: 5 });
  const c0 = JSON.stringify(w.cond);
  for (let i = 0; i < 3600; i++) w.update(1);
  ok('game: Clear always is clear for an hour and more — no phases', !w.wx && JSON.stringify(w.cond) === c0 && w.cond === CONDITIONS.clear, w.cond.label);
  ok('game: the picker offers Random first and Clear always, and every fixed sky', SKY_CHOICES[0].id === 'random' && SKY_CHOICES.some((c) => c.id === 'clear' && /Clear always/.test(c.label)) && ['cloudy', 'rainy', 'stormy'].every((k) => SKY_CHOICES.some((c) => c.id === k)), SKY_CHOICES.map((c) => c.label).join(' / '));
  // Snow only from a cold roll.
  global.document = global.document || { createElement: () => ({ getContext: () => null, style: {} }) };
  let precip = null;
  try { precip = await load('src/world/precip.js'); } catch (e) { precip = null; }
  if (precip) {
    const cold = new Weather();
    cold.load({ condition: 'random' });
    let snowy = null;
    for (let s = 0; s < 400 && !snowy; s++) {
      cold.beginFlight({ seed: s, climate: 'cold', map: { subtitle: 'Cold' } });
      if (cold.cond.snow > 0.3) snowy = s;
    }
    const sn = snowy != null ? precip.snowIntensity(cold, { precip: null }) : 0;
    const warm = new Weather();
    warm.load({ condition: 'rainy' });
    ok('game: a cold roll snows (on any map), a warm rainy sky does not', snowy != null && sn > 0.3 && precip.snowIntensity(warm, { precip: null }) === 0, `seed ${snowy}: ${sn.toFixed(2)}`);
  }
}

/* ----------------------------------------------------------- 7. lightning -- */
{
  const FS = await load('src/render/flash-safety.js');
  const { Weather, LIGHTNING_MIN_GAP_S, LIGHTNING_PEAK } = await load('src/world/weather.js');
  const run = (reduce) => {
    FS.setReduceFlashing(reduce);
    const w = new Weather();
    w.load({ condition: 'stormy' });
    const dt = 1 / 60;
    const strikes = [];
    let peak = 0;
    let jump = 0;
    let prev = 0;
    for (let i = 0; i < 60 * 240; i++) {
      w.update(dt);
      const f = w.lightningFlash;
      if (f > 0.05 && prev <= 0.05) strikes.push(i * dt);
      peak = Math.max(peak, f);
      jump = Math.max(jump, f - prev);
      prev = f;
    }
    return { strikes, peak, jump };
  };
  const on = run(true);
  ok('lightning: with Reduce flashing on (the default) the storm makes no flash at all', on.strikes.length === 0 && on.peak === 0, `${on.strikes.length} strikes in 4 min`);
  const off = run(false);
  const gaps = off.strikes.slice(1).map((t, i) => t - off.strikes[i]);
  ok('lightning: switched off, a storm\'s strikes are at least 20 s apart', off.strikes.length >= 4 && gaps.every((g) => g >= LIGHTNING_MIN_GAP_S - 0.05), `${off.strikes.length} strikes, gaps ${gaps.map((g) => g.toFixed(1)).join(', ')} s`);
  ok('lightning: ...soft — never full strength, and never in one frame (a ramp, no step)', off.peak <= LIGHTNING_PEAK + 1e-9 && off.jump <= LIGHTNING_PEAK * 0.2, `peak ${off.peak.toFixed(2)}, biggest one-frame rise ${off.jump.toFixed(3)}`);
  // Inside the storm cells' clouds (clouds.js): the same rules.
  const { CELL_FLASH_PEAK } = await load('src/world/weather.js');
  const cells = (reduce) => {
    FS.setReduceFlashing(reduce);
    const w = new Weather();
    w.load({ condition: 'random' });
    w.beginFlight({ seed: 1 });
    w.wx.lines[0] = new WX.WxTimeline(1, { start: 'cells' });
    const dt = 1 / 60;
    const strikes = [];
    let peak = 0;
    let jump = 0;
    let prev = 0;
    for (let i = 0; i < 60 * 240; i++) {
      w.update(dt);
      const f = w.cellFlash;
      if (f > 0.05 && prev <= 0.05) strikes.push(i * dt);
      peak = Math.max(peak, f);
      jump = Math.max(jump, f - prev);
      prev = f;
    }
    return { strikes, peak, jump, flash: w.lightningFlash };
  };
  const c1 = cells(true);
  ok('lightning: far-off storm cells glow inside with Reduce flashing off only — on (the default), never', c1.strikes.length === 0 && c1.peak === 0, `${c1.strikes.length}`);
  const c2 = cells(false);
  const g2 = c2.strikes.slice(1).map((t, i) => t - c2.strikes[i]);
  ok('lightning: ...off, at most one in 20 s, soft (a ramp, never full strength), and never a wash over the sky', c2.strikes.length >= 4 && g2.every((g) => g >= LIGHTNING_MIN_GAP_S - 0.05) && c2.peak <= CELL_FLASH_PEAK + 1e-9 && c2.jump <= CELL_FLASH_PEAK * 0.1 && c2.flash === 0,
    `${c2.strikes.length} glows, gaps ${g2.map((g) => g.toFixed(0)).join(', ')} s, peak ${c2.peak.toFixed(2)}, biggest frame ${c2.jump.toFixed(3)}`);
  /*
   * Checker (wave 19): a storm has BOTH — the sky's strike and the cells'
   * glow (the fixed Stormy sky has cb 1) — and on their own clocks they
   * flashed 2.4 s apart in the real game. The 20 s is for the screen: every
   * flash of either kind, and the rolled storm's too.
   */
  const both = (setup, reduce) => {
    FS.setReduceFlashing(reduce);
    const w = new Weather();
    setup(w);
    const dt = 1 / 60;
    const starts = [];
    let pl = 0;
    let pc = 0;
    const seq0 = w.thunderSeq;
    for (let i = 0; i < 60 * 600; i++) {
      w.update(dt);
      if (w.lightningFlash > 0.02 && pl <= 0.02) starts.push(i * dt);
      if (w.cellFlash > 0.02 && pc <= 0.02) starts.push(i * dt);
      pl = w.lightningFlash;
      pc = w.cellFlash;
    }
    starts.sort((a, b) => a - b);
    return { starts, gaps: starts.slice(1).map((t, i) => t - starts[i]), thunder: w.thunderSeq - seq0 };
  };
  const fixedStorm = (w) => w.load({ condition: 'stormy' });
  const rolledStorm = (w) => {
    w.load({ condition: 'random' });
    w.beginFlight({ seed: 3 });
    w.wx.lines[0] = new WX.WxTimeline(3, { start: 'storm' });
  };
  for (const [name, setup] of [['the Stormy sky', fixedStorm], ['a rolled thunderstorm', rolledStorm]]) {
    const b = both(setup, false);
    ok(`lightning: ${name} — every flash of either kind (sky strike or cell glow) at least 20 s after the last`, b.starts.length >= 8 && b.gaps.every((g) => g >= LIGHTNING_MIN_GAP_S - 0.05),
      `${b.starts.length} flashes in 10 min, shortest gap ${Math.min(...b.gaps).toFixed(1)} s`);
    const q = both(setup, true);
    ok(`lightning: ${name} — Reduce flashing on: no flash, but it still thunders`, q.starts.length === 0 && q.thunder >= 8, `${q.starts.length} flashes, ${q.thunder} thunderclaps in 10 min`);
  }
  // A disaster's bolt (full strength, set from outside) holds the storm's own off for 20 s too.
  {
    FS.setReduceFlashing(false);
    const w = new Weather();
    w.load({ condition: 'stormy' });
    const dt = 1 / 60;
    for (let i = 0; i < 60 * 30; i++) w.update(dt);
    w.lightningFlash = 1;
    let soonest = Infinity;
    let pl = 1;
    let pc = w.cellFlash;
    for (let i = 0; i < 60 * 60; i++) {
      w.update(dt);
      const rose = (w.lightningFlash > 0.02 && pl <= 0.02) || (w.cellFlash > 0.02 && pc <= 0.02);
      if (rose) { soonest = Math.min(soonest, i * dt); break; }
      pl = w.lightningFlash;
      pc = w.cellFlash;
    }
    ok('lightning: after a disaster\'s bolt the storm\'s own flashes wait 20 s', soonest >= LIGHTNING_MIN_GAP_S - 0.05, `next flash ${soonest.toFixed(1)} s after the bolt`);
  }
  FS.setReduceFlashing(true);
}

/* ------------------------------------------------- 7b. the wind stays a day's -- */
{
  // Checker (wave 19): a thunderstorm on the windiest maps (24 kt) rolled 38 kt gusting 72.
  const { MAPS } = await load('src/world/maps.js');
  const maps = Array.isArray(MAPS) ? MAPS : Object.values(MAPS);
  let worst = { kts: 0, gust: 0, where: '' };
  for (const m of maps) {
    const mw = m.weather || {};
    for (let s = 1; s <= 40; s++) {
      const sys = new WX.WxSystem({ seed: s * 101, climate: WX.climateFor(m), windKts: mw.windSpeedKts || 8, windDirDeg: mw.windDirDeg || 250 });
      for (const id of WX.PHASE_IDS) {
        sys.lines[0] = new WX.WxTimeline(s, { start: id });
        sys.update(1, {});
        if (sys.wind.kts > worst.kts) worst.kts = sys.wind.kts;
        if (sys.wind.gustKts > worst.gust) worst = { ...worst, gust: sys.wind.gustKts, where: `${m.id} ${id}` };
      }
    }
  }
  ok(`wind: the rolled sky never blows more than ${WX.WIND_MAX_KTS} kt or gusts past ${WX.GUST_MAX_KTS}, on any map in any phase`, worst.kts <= WX.WIND_MAX_KTS + 1e-9 && worst.gust <= WX.GUST_MAX_KTS + 1e-9,
    `worst ${worst.kts.toFixed(0)} kt, gusting ${worst.gust.toFixed(0)} (${worst.where})`);
}

/* ------------------------------------ 7c. a roll with no map is the last map's -- */
{
  // Checker (wave 19): the sky put back after a boat or van job (load() → a lazy roll) was a temperate one anywhere.
  const { Weather } = await load('src/world/weather.js');
  const { MAPS } = await load('src/world/maps.js');
  const maps = Array.isArray(MAPS) ? MAPS : Object.values(MAPS);
  const cold = maps.find((m) => WX.climateFor(m) === 'cold');
  const trop = maps.find((m) => WX.climateFor(m) === 'tropical');
  const w = new Weather();
  w.load({ condition: 'random' });
  w.beginFlight({ seed: 9, map: cold, regions: null });
  w.load({ condition: 'stormy' });
  w.load({ condition: 'random' });
  const lazyCold = w.cond && w.wx.climate;
  w.beginFlight({ seed: 9, map: trop, regions: null });
  w.load({ condition: 'cloudy' });
  w.load({ condition: 'random' });
  w.update(1 / 60);
  const lazyTrop = w.wx.climate;
  ok('random: a roll with no map named (the sky put back after a boat or van job) is the last map\'s climate', lazyCold === 'cold' && lazyTrop === 'tropical', `${cold && cold.id}: ${lazyCold}, ${trop && trop.id}: ${lazyTrop}`);
}

/* ------------------------------------------------------------ 8. the setting -- */
{
  const store = new Map();
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const S = await load('src/core/storage.js');
  ok('setting: Random is the new default sky', S.DEFAULT_SETTINGS.weather.condition === 'random');
  store.clear();
  ok('setting: a new player gets Random', S.loadSettings().weather.condition === 'random');
  store.set('islandsim.settings.v1', JSON.stringify({ weather: { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 } }));
  const moved = S.loadSettings();
  ok('setting: a save still on the old default (clear) moves to Random, once', moved.weather.condition === 'random' && JSON.parse(store.get('islandsim.settings.v1')).weatherRev === S.DEFAULT_SETTINGS.weatherRev, moved.weather.condition);
  const s2 = JSON.parse(store.get('islandsim.settings.v1'));
  s2.weather.condition = 'clear';
  store.set('islandsim.settings.v1', JSON.stringify(s2));
  ok('setting: ...and Clear always picked afterwards sticks', S.loadSettings().weather.condition === 'clear');
  store.set('islandsim.settings.v1', JSON.stringify({ weather: { time: 'sunset', condition: 'rainy', windSpeedKts: 16, windDirDeg: 20 } }));
  const kept = S.loadSettings();
  ok('setting: any other sky a player picked stays', kept.weather.condition === 'rainy' && kept.weather.time === 'sunset', kept.weather.condition);
}

/* --------------------------------------------------------------- 9. regions -- */
{
  const regions = [
    { id: 'a', cx: 0, cz: 0, band: 'temperate' },
    { id: 'b', cx: 150000, cz: 0, band: 'tropical' },
    { id: 'c', cx: 0, cz: -150000, band: 'cold' },
  ];
  // A seed where a and b differ.
  let s = null;
  for (let seed = 1; seed < 400 && !s; seed++) {
    const t = new WxSystem({ seed, regions, windKts: 12, windDirDeg: 270 });
    if (t.lines[0].cond.phase !== t.lines[1].cond.phase && Math.abs(Math.log(t.lines[0].cond.visM / t.lines[1].cond.visM)) > 0.4) s = t;
  }
  ok('regions: each region rolls its own weather', !!s, s ? s.lines.map((l, i) => `${regions[i].id} ${l.cond.phase}`).join(', ') : 'none differ');
  if (s) {
    const atA = s.sample(0, 0, {});
    const atB = s.sample(150000, 0, {});
    const mid = s.sample(75000, 0, {});
    ok('regions: in a region its own weather is the weather; half-way it is between the two', atA.phase === s.lines[0].cond.phase && atB.phase === s.lines[1].cond.phase
      && mid.visM < Math.max(atA.visM, atB.visM) && mid.visM > Math.min(atA.visM, atB.visM), `${atA.phase} ${atA.visM.toFixed(0)} m | ${mid.visM.toFixed(0)} m | ${atB.phase} ${atB.visM.toFixed(0)} m`);
    const atC = s.sample(0, -150000, {});
    ok('regions: the cold region never rains (snow if anything)', atC.rain < 0.01, `${atC.phase}`);
    const d0 = { ...s.drift };
    for (let i = 0; i < 3600; i++) s.update(1, { x: 0, z: 0 });
    // Wind from 270 (west) blows east: the fronts move +x.
    ok('regions: fronts drift slowly downwind (an hour: a few km to a few tens of km)', s.drift.x - d0.x > 2000 && s.drift.x - d0.x < 60000 && Math.abs(s.drift.z - d0.z) < (s.drift.x - d0.x), `${((s.drift.x - d0.x) / 1000).toFixed(1)} km east, ${((s.drift.z - d0.z) / 1000).toFixed(1)} km south`);
  }
  // Weather ahead: force region b murky.
  const t = new WxSystem({ seed: 3, regions, windKts: 8, windDirDeg: 270 });
  const fogL = new WxTimeline(1, { start: 'fog' });
  const clrL = new WxTimeline(1, { start: 'clear' });
  t.lines[0] = clrL;
  t.lines[1] = fogL;
  t.update(0, { x: 40000, z: 0 });
  const ahead = t.ahead(40000, 0, 90, 70);
  const behind = t.ahead(40000, 0, 270, 35);
  ok('regions: "weather ahead" sees the fog on the track east, not behind', ahead && /fog|mist/.test(ahead.word) && !behind, ahead ? `${ahead.word}, ${ahead.km} km, ${ahead.visM.toFixed(0)} m` : 'nothing ahead');
  const single = new WxSystem({ seed: 3 });
  ok('regions: an ordinary map is one place (nothing "ahead")', single.lines.length === 1 && single.ahead(0, 0, 90) === null);
}

/* ------------------------------------------------------------ 10. the look -- */
{
  const THREE = await import('../../src/vendor/three.module.js');
  const { SkyDome } = await load('src/world/sky.js');
  const { Weather } = await load('src/world/weather.js');
  const glow = (cond, phase) => {
    const sky = new SkyDome(new THREE.Scene(), { shadows: false });
    const w = new Weather();
    w.load({ time: 'day', condition: cond });
    if (cond === 'random') {
      w.beginFlight({ seed: 1 });
      w.wx.lines[0] = new WX.WxTimeline(1, { start: phase });
      w.update(0);
    }
    sky.update(w);
    const h = sky.uniforms.uHaze.value;
    return { haze: h.r + h.g + h.b, k: sky.uniforms.uHazeK.value, top: sky.uniforms.uTop.value.getHexString() };
  };
  const hazy = glow('random', 'haze');
  const clean = glow('random', 'clear');
  const fixed = glow('clear');
  ok('look: a hazy day has a soft, wide glow round the sun; a clean day and the fixed Clear none (as before)', hazy.haze > 0.3 && hazy.k < 4 && clean.haze < 0.05 && fixed.haze === 0,
    `haze ${hazy.haze.toFixed(2)} (k ${hazy.k.toFixed(1)}), clear ${clean.haze.toFixed(2)}, fixed ${fixed.haze.toFixed(2)}`);
  const w = new Weather();
  w.load({ time: 'day', condition: 'random' });
  w.beginFlight({ seed: 1 });
  w.wx.lines[0] = new WX.WxTimeline(1, { start: 'overcast' });
  w.update(0);
  w.eyeY = 200;
  const under = w.palette();
  w.eyeY = 3000;
  const over = w.palette();
  ok('look: under the random sky\'s deck the sky is grey and the sun dim; above it, blue and bright', over.top.b - over.top.r > under.top.b - under.top.r + 0.1 && over.sunIntensity > under.sunIntensity * 1.5,
    `under top #${under.top.getHexString()} sun ${under.sunIntensity.toFixed(2)}; above #${over.top.getHexString()} sun ${over.sunIntensity.toFixed(2)}`);
  w.wx.lines[0] = new WX.WxTimeline(1, { start: 'storm' });
  w.update(0);
  w.eyeY = 200;
  const storm = w.palette();
  const lum = (c) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
  w.wx.lines[0] = new WX.WxTimeline(1, { start: 'mist' });
  w.update(0);
  const mist = w.palette();
  ok('look: a thunderstorm\'s murk is dark grey, a mist\'s pale', lum(storm.fogColor) < lum(mist.fogColor) * 0.75, `storm #${storm.fogColor.getHexString()}, mist #${mist.fogColor.getHexString()}`);
}

/* -------------------------------------------------------------- report -- */
const failed = results.filter((r) => !r.pass);
console.log(`\nweather: ${results.length - failed.length}/${results.length} passed`);
process.exitCode = failed.length ? 1 : 0;

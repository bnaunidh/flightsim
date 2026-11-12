/**
 * Node checks for the tsunami (src/world/tsunami.js, the wave in
 * src/world/sea-state.js, the event in src/game/disasters.js). Plain node:
 *
 *   node tests/features/tsunami.mjs
 *
 *   1. The wave is one formula: waveHeightAt = the swell + the shader's
 *      tsuAt (its GLSL evaluated here, term for term); no tsunami, no change.
 *   2. The order of things at the shore: the warning, the sea draws back,
 *      then the crest, then it drains; smaller crests follow; it ends.
 *   3. The run-up: only low ground, only near the sea, never the whole
 *      island; less in the lee; on every map.
 *   4. It scales with the map, and Low is cheaper.
 *   5. It is in the disasters list, loaded on demand, and in the offline list.
 */
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.document = {
  createElement: () => ({ getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }), width: 0, height: 0, style: {} }),
  body: { appendChild() {} },
};
const root = new URL('../../', import.meta.url);
const load = (p) => import(new URL(p, root).href);

let pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  if (cond) pass++;
  else fails.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}

const T = await load('src/world/terrain.js');
const M = await load('src/world/maps.js');
const O = await load('src/render/ocean-material.js');
const SEA = await load('src/world/sea-state.js');
const TS = await load('src/world/tsunami.js');
const DIS = await load('src/game/disasters.js');
const AP = await load('src/world/airport.js');
const f32 = Math.fround;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smoothstep = (a, b, v) => {
  const k = clamp((v - a) / (b - a), 0, 1);
  return k * k * (3 - 2 * k);
};

/** A sea with a tsunami planned at (x, z) on the map in play. */
function make(quality, x, z) {
  const sea = SEA.createSea(quality, T.MAP.id, O.buildDepthField(quality));
  const plan = TS.planTsunami({ x, z, span: TS.mapSpan(T.MAP), quality });
  if (!plan) return { sea, plan: null };
  const t0 = performance.now();
  const field = TS.buildField(plan);
  const ms = performance.now() - t0;
  const wave = TS.waveFor(plan, field);
  SEA.setTsunami(sea, wave);
  return { sea, plan, field, wave, ms };
}
function at(k, t) {
  const st = TS.stateAt(k.plan, t);
  k.wave.U = st.U;
  k.wave.D = st.D;
  return st;
}

/* 1. one formula --------------------------------------------------------- */
T.applyMap('cullen');
AP.refreshRunways();
{
  const k = make('high', AP.RUNWAY.thresholdWest.x, AP.RUNWAY.thresholdWest.z);
  const { sea, plan, field, wave } = k;
  ok('plan: Cullen has a coast to bring one to', !!plan && plan.coast);
  SEA.setSeaState(sea, 0.5);
  sea.t = 12.5;
  const src = SEA.patchShaders(O.OCEAN_SHADERS.VERT, O.OCEAN_SHADERS.FRAG);
  ok('shader: the tsunami still fits the stock sea shader', !!src);
  ok('shader: the vertex shader is the formula checked here',
    /float xi = along - \(uTsuWave\.z - float\(i\) \* uTsuShape\.w\);/.test(src.vert)
    && /float L = xi > 0\.0 \? uTsuShape\.y : uTsuShape\.z;/.test(src.vert)
    && /float e = uTsuAmp\[i\] \* exp\(-xi \* xi \/ \(L \* L\)\);/.test(src.vert)
    && /float gain = \(1\.0 - smoothstep\(0\.38, 0\.50, m\)\) \* f\.r;/.test(src.vert)
    && /float amp = uTsuWave\.w \* mix\(uTsuAmp\.w, 1\.0, f\.g\) \* f\.a;/.test(src.vert)
    && /float h = gain \* \(amp \* c - uTsuShape\.x \* f\.g \* smoothstep\(-uTsuShape\.z \* 0\.5, uTsuShape\.y \* 2\.0, along - uTsuWave\.z\)\);/.test(src.vert)
    && /vTsu = tsuAt\(wp\.xz \+ uRenderOrigin\);\s+wp\.y \+= sw\.z \+ vTsu\.x;/.test(src.vert));
  ok('shader: the boat\'s ripple patch rides it too', /tsuAt\(swWorld\.xz \+ uRenderOrigin\)\.x/.test(readFileSync(new URL('src/world/sea-state.js', root), 'utf8')));
  ok('shader: the water\'s depth is what the tsunami has made it (drawn back, or over the land)', /float depth = max\(mix\(34\.0, field\.r \* 40\.0, uDepthXform\.w\) \+ vTsu\.x - vTsu\.z, 0\.0\);/.test(src.frag));
  ok('shader: not one more texture read a pixel than the swell\'s sea', (src.frag.match(/texture2D\(/g) || []).length === (O.OCEAN_SHADERS.FRAG.match(/texture2D\(/g) || []).length);
  ok('shader: nothing flashes — no clock in the tsunami, only where the front is', !/uTime|uSwellT/.test(src.vert.slice(src.vert.indexOf('vec4 tsuAt'), src.vert.indexOf('vec4 tsuAt') + 1400)));

  // The GLSL, in single precision, from the field's own bytes (a bilinear tap at texel centres).
  const tap = (x, z) => {
    const n = field.n;
    const u = ((x - field.cx) / field.size + 0.5) * n - 0.5;
    const v = ((z - field.cz) / field.size + 0.5) * n - 0.5;
    const i0 = clamp(Math.floor(u), 0, n - 1);
    const j0 = clamp(Math.floor(v), 0, n - 1);
    const i1 = Math.min(n - 1, i0 + 1);
    const j1 = Math.min(n - 1, j0 + 1);
    const fu = clamp(u - i0, 0, 1);
    const fv = clamp(v - j0, 0, 1);
    const out = [];
    for (let c = 0; c < 4; c++) {
      const g = (i, j) => field.data[(j * n + i) * 4 + c] / 255;
      out.push((g(i0, j0) * (1 - fu) + g(i1, j0) * fu) * (1 - fv) + (g(i0, j1) * (1 - fu) + g(i1, j1) * fu) * fv);
    }
    return out;
  };
  const glsl = (x, z) => {
    const uvx = (x - field.cx) / field.size + 0.5;
    const uvy = (z - field.cz) / field.size + 0.5;
    const m = Math.max(Math.abs(uvx - 0.5), Math.abs(uvy - 0.5));
    if (m >= 0.5) return 0;
    const f = tap(x, z);
    const along = f32((x - field.cx) * wave.dx + (z - field.cz) * wave.dz);
    let c = 0;
    for (let i = 0; i < 3; i++) {
      const xi = f32(along - (wave.U - i * wave.gap));
      const L = xi > 0 ? wave.Lf : wave.Lb;
      c = f32(c + (wave.amps[i] || 0) * Math.exp(f32((-xi * xi) / (L * L))));
    }
    const gain = (1 - smoothstep(0.38, 0.5, m)) * f[0];
    const amp = wave.H * (wave.off + (1 - wave.off) * f[1]) * f[3];
    return f32(gain * (amp * c - wave.D * f[1] * smoothstep(-wave.Lb * 0.5, wave.Lf * 2, along - wave.U)));
  };
  let worst = 0;
  let big = 0;
  let low = 0;
  let swellOnly = 0;
  const rnd = (() => { let s = 7; return () => ((s = (s * 16807) % 2147483647) / 2147483647); })();
  for (const t of [20, plan.tArrive - 20, plan.tArrive - 4, plan.tArrive + 6, plan.tArrive + 40]) {
    at(k, t);
    for (let i = 0; i < 600; i++) {
      const x = plan.cx + (rnd() - 0.5) * plan.size * 1.1;
      const z = plan.cz + (rnd() - 0.5) * plan.size * 1.1;
      SEA.setTsunami(sea, null);
      const swell = SEA.waveHeightAt(sea, x, z);
      sea.tsu = wave;
      const all = SEA.waveHeightAt(sea, x, z);
      const g = glsl(x, z);
      worst = Math.max(worst, Math.abs(all - swell - g));
      big = Math.max(big, g);
      low = Math.min(low, g);
      swellOnly = Math.max(swellOnly, Math.abs(swell));
    }
  }
  ok('wave: waveHeightAt is the swell plus the shader\'s tsunami (to 2 mm)', worst < 0.002 && big > 8 && low < -3, `${(worst * 1000).toFixed(2)} mm apart at worst; crest ${big.toFixed(1)} m, drawn back ${low.toFixed(1)} m, swell to ${swellOnly.toFixed(2)} m`);

  // The slope it reports is its derivative along its travel.
  at(k, plan.tArrive - 12);
  let slopeErr = 0;
  let steep = 0;
  for (let i = 0; i < 200; i++) {
    const u = wave.U + (rnd() - 0.5) * 700;
    const x = plan.cx + wave.dx * u;
    const z = plan.cz + wave.dz * u;
    const a = SEA.tsunamiAt(sea, x, z, {});
    // Where the field is flat (open water all round), so the field's own gradient is not in it.
    const q = field.data;
    const ti = Math.floor(((x - field.cx) / field.size + 0.5) * field.n);
    const tj = Math.floor(((z - field.cz) / field.size + 0.5) * field.n);
    let flat = ti > 1 && tj > 1 && ti < field.n - 2 && tj < field.n - 2;
    for (let dj = -1; flat && dj <= 1; dj++) for (let di = -1; di <= 1; di++) for (let c = 0; c < 4; c++) if (q[((tj + dj) * field.n + ti + di) * 4 + c] !== q[(tj * field.n + ti) * 4 + c]) flat = false;
    if (!flat) continue;
    const e = 0.5;
    const hp = SEA.tsunamiAt(sea, x + wave.dx * e, z + wave.dz * e, {}).h;
    const hm = SEA.tsunamiAt(sea, x - wave.dx * e, z - wave.dz * e, {}).h;
    slopeErr = Math.max(slopeErr, Math.abs((hp - hm) / (2 * e) - a.s));
    steep = Math.max(steep, Math.abs(a.s));
  }
  ok('wave: its slope is its derivative along the way it travels', slopeErr < 0.004 && steep > 0.01, `worst ${slopeErr.toFixed(5)}, steepest ${steep.toFixed(3)}`);

  // Off: exactly the sea it was.
  SEA.setTsunami(sea, null);
  const a0 = SEA.waveHeightAt(sea, plan.cx - wave.dx * 300, plan.cz - wave.dz * 300);
  const sea2 = SEA.createSea('high', T.MAP.id, O.buildDepthField('high'));
  SEA.setSeaState(sea2, 0.5);
  sea2.t = 12.5;
  ok('clear: with the tsunami taken off, the sea is to the last bit the sea it was', a0 === SEA.waveHeightAt(sea2, plan.cx - wave.dx * 300, plan.cz - wave.dz * 300) && sea.tsu === null);
  ok('clear: nothing of it is left in tsunamiAt', SEA.tsunamiAt(sea, plan.cx, plan.cz, {}).h === 0);
}

/* 2. the order of things -------------------------------------------------- */
T.applyMap('kestrel');
AP.refreshRunways();
{
  const k = make('high', AP.RUNWAY.thresholdWest.x, AP.RUNWAY.thresholdWest.z);
  const { sea, plan, wave } = k;
  SEA.setSeaState(sea, 0);
  sea.gain = 0;
  SEA.setSeaState(sea, 0);
  // Just off the beach where it comes ashore, in a few metres of water.
  let sx = plan.cx;
  let sz = plan.cz;
  for (let r = 0; r < 400; r += 5) {
    sx = plan.cx - wave.dx * r;
    sz = plan.cz - wave.dz * r;
    if (T.heightAt(sx, sz) < -3) break;
  }
  const series = [];
  for (let t = 0; t <= plan.tEnd + 1; t += 0.5) {
    const st = at(k, t);
    series.push({ t, h: SEA.tsunamiAt(sea, sx, sz, {}).h, over: st.over });
  }
  const first6 = Math.max(...series.filter((s) => s.t <= 5).map((s) => Math.abs(s.h)));
  ok('order: for the first seconds of the warning the sea has not moved', first6 < 0.05, `${first6.toFixed(3)} m`);
  const lowest = series.reduce((a, b) => (b.h < a.h ? b : a));
  const highest = series.reduce((a, b) => (b.h > a.h ? b : a));
  ok('order: the sea draws back first, by metres', lowest.h < -3.5 && lowest.t > 15 && lowest.t < highest.t, `${lowest.h.toFixed(1)} m at ${lowest.t} s`);
  ok('order: then the crest, a good while after the warning (time to get airborne)', highest.h > 10 && highest.t > 45 && Math.abs(highest.t - plan.tArrive) < 8, `${highest.h.toFixed(1)} m at ${highest.t} s; planned ${plan.tArrive.toFixed(0)} s`);
  // The water's rise is a wave, not a wall: its fastest rise at the shore.
  let rise = 0;
  for (let i = 1; i < series.length; i++) rise = Math.max(rise, (series[i].h - series[i - 1].h) / 0.5);
  ok('order: it rises over seconds, not in a frame', rise < 4 && rise > 0.5, `${rise.toFixed(2)} m/s at its fastest`);
  // Crests: local maxima over 2 m.
  const peaks = [];
  for (let i = 1; i < series.length - 1; i++) if (series[i].h > 2 && series[i].h >= series[i - 1].h && series[i].h > series[i + 1].h) peaks.push(series[i]);
  ok('order: one or two smaller crests follow the first', peaks.length === plan.count && peaks.every((p, i) => i === 0 || p.h < peaks[i - 1].h), peaks.map((p) => `${p.h.toFixed(1)} m @ ${p.t} s`).join(', '));
  const between = series.filter((s) => s.t > peaks[0].t && s.t < peaks[1].t);
  ok('order: it drains between crests', Math.min(...between.map((s) => s.h)) < peaks[0].h * 0.35);
  const last = series[series.length - 1];
  ok('order: it ends with the sea back where it was', last.over && Math.abs(series[series.length - 3].h) < 0.15, `${series[series.length - 3].h.toFixed(3)} m just before the end, at ${plan.tEnd.toFixed(0)} s`);
  ok('order: the whole thing is a few minutes', plan.tEnd > 120 && plan.tEnd < 300, `${plan.tEnd.toFixed(0)} s`);
  ok('order: the pause menu shows it ON for at least as long as it runs', DIS.findEvent('tsunami').duration >= 60);

  // Offshore it is a long low swell; a ship there rises and comes down again.
  let ox = plan.cx;
  let oz = plan.cz;
  for (let r = 300; r < plan.half * 0.7; r += 50) {
    ox = plan.cx - wave.dx * r;
    oz = plan.cz - wave.dz * r;
    if (T.heightAt(ox, oz) < -24) break;
  }
  let deep = 0;
  let slope = 0;
  for (let t = 0; t <= plan.tEnd; t += 0.5) {
    at(k, t);
    const a = SEA.tsunamiAt(sea, ox, oz, {});
    deep = Math.max(deep, a.h);
    slope = Math.max(slope, Math.abs(a.s));
  }
  ok('offshore: in deep water it is under half the height, and a gentle slope (a ship rides it)', T.heightAt(ox, oz) < -22 && deep > 3 && deep <= plan.H * 0.5 && slope < 0.06, `${deep.toFixed(1)} m, slope ${(Math.atan(slope) * 57.3).toFixed(1)}°, in ${(-T.heightAt(ox, oz)).toFixed(0)} m of water`);
}

/* 3. the run-up ------------------------------------------------------------ */
/** The deepest the water gets at each point of a grid over the field, through the whole event. */
function flood(k, step = 40) {
  const { sea, plan } = k;
  const pts = [];
  for (let z = plan.cz - plan.half; z <= plan.cz + plan.half; z += step) {
    for (let x = plan.cx - plan.half; x <= plan.cx + plan.half; x += step) {
      const g = T.heightAt(x, z);
      if (g >= 0) pts.push({ x, z, g, d: 0 });
    }
  }
  for (let t = plan.tArrive - 30; t <= plan.tEnd; t += 1.5) {
    at(k, t);
    for (const p of pts) {
      const d = SEA.tsunamiAt(sea, p.x, p.z, {}).h - p.g;
      if (d > p.d) p.d = d;
    }
  }
  return pts;
}
/** Metres from (x, z) to the nearest sea, looked for out to `far`. */
function toSea(x, z, far) {
  for (let r = 20; r <= far; r += 20) {
    for (let a = 0; a < 24; a++) if (T.heightAt(x + Math.cos(a * 0.2618) * r, z + Math.sin(a * 0.2618) * r) < 0) return r;
  }
  return Infinity;
}
{
  const rows = [];
  let anyRunway = null;
  for (const m of M.MAPS) {
    T.applyMap(m.id);
    AP.refreshRunways();
    const R = AP.RUNWAY;
    const k = make('low', R.thresholdWest.x, R.thresholdWest.z);
    if (!k.plan) {
      rows.push({ id: m.id, none: true });
      continue;
    }
    k.sea.gain = 0;
    SEA.setSeaState(k.sea, 0);
    const pts = flood(k, 60);
    const wet = pts.filter((p) => p.d > 0.1);
    const tall = wet.reduce((a, p) => Math.max(a, p.g), 0);
    let far = 0;
    for (const p of wet) if (p.d > 0.3) far = Math.max(far, toSea(p.x, p.z, k.plan.runup + 200));
    rows.push({ id: m.id, plan: k.plan, land: pts.length, wet: wet.length, tall, far, deepest: wet.reduce((a, p) => Math.max(a, p.d), 0) });
    if (m.id === 'cullen') anyRunway = k;
  }
  const real = rows.filter((r) => !r.none && r.plan.coast && r.land > 50);
  for (const r of real) console.log(`    ${r.id}: ${r.wet}/${r.land} land points wet (${((r.wet / r.land) * 100).toFixed(1)}%), highest wet ground ${r.tall.toFixed(1)} m, furthest from the sea ${r.far} m (limit ${r.plan.runup.toFixed(0)}), deepest ${r.deepest.toFixed(1)} m, H ${r.plan.H.toFixed(1)}`);
  ok('run-up: looked at on every map with a coast', real.length >= 15, `${real.length} maps; none: ${rows.filter((r) => r.none).map((r) => r.id).join(' ') || '-'}`);
  ok('run-up: it floods some low shore on most maps', real.filter((r) => r.wet > 0).length >= real.length * 0.8);
  ok('run-up: never ground higher than a crest', real.every((r) => r.tall <= r.plan.H + 0.01), real.filter((r) => r.tall > r.plan.H).map((r) => r.id).join(' '));
  ok('run-up: never further from the sea than the limit', real.every((r) => r.far <= r.plan.runup + 90), real.filter((r) => r.far > r.plan.runup + 90).map((r) => `${r.id} ${r.far}`).join(' '));
  ok('run-up: never the whole island — under a third of the land in the field, on every map', real.every((r) => r.wet / r.land < 0.33), real.map((r) => `${r.id} ${((r.wet / r.land) * 100).toFixed(0)}%`).filter((s) => parseInt(s.split(' ')[1], 10) >= 33).join(' '));
  ok('no sea, no tsunami: on land with no coast in reach there is none', TS.planTsunami({ x: 0, z: 0, height: () => 30 }) === null);
  const openSea = TS.planTsunami({ x: 0, z: 0, height: () => -40, bearing: 1 });
  ok('open sea: far from any land it is a long swell going by (a carrier rides it)', !!openSea && !openSea.coast && Math.abs(Math.hypot(openSea.dx, openSea.dz) - 1) < 1e-9);

  // Cullen's low runway, 340 m from the sea, is one the water reaches; a jet parked there is in it.
  T.applyMap('cullen');
  AP.refreshRunways();
  const k = make('high', AP.RUNWAY.thresholdWest.x, AP.RUNWAY.thresholdWest.z);
  k.sea.gain = 0;
  SEA.setSeaState(k.sea, 0);
  const a = AP.RUNWAY.thresholdWest;
  const b = AP.RUNWAY.thresholdEast;
  let rw = 0;
  let rwT = 0;
  let dryAfter = 0;
  for (let t = 0; t <= k.plan.tEnd; t += 1) {
    at(k, t);
    let d = 0;
    for (let i = 0; i <= 8; i++) {
      const x = a.x + ((b.x - a.x) * i) / 8;
      const z = a.z + ((b.z - a.z) * i) / 8;
      d = Math.max(d, SEA.tsunamiAt(k.sea, x, z, {}).h - T.heightAt(x, z));
    }
    if (d > rw) {
      rw = d;
      rwT = t;
    }
    if (t === Math.round(k.plan.tEnd - 2)) dryAfter = d;
  }
  ok('runway: Cullen\'s low coastal runway is reached by the water', rw > 0.3 && rw < 6, `${rw.toFixed(2)} m at ${rwT} s, runway at ${T.heightAt(a.x, a.z).toFixed(1)} m`);
  ok('runway: and it is dry again by the end', dryAfter <= 0, `${dryAfter.toFixed(2)} m`);

  // The lee: the far side of the land from the wave gets less.
  const { plan, field } = k;
  let lee = 255;
  let open = 0;
  for (let i = 3; i < field.data.length; i += 4) {
    lee = Math.min(lee, field.data[i]);
    open = Math.max(open, field.data[i]);
  }
  ok('lee: the sheltered side gets a wave under half the size', open === 255 && lee / 255 < 0.5 && lee / 255 >= TS.LEE - 0.01, `${(lee / 255).toFixed(2)} against 1`);
  ok('field: the channels are what the shader is told they are', field.data.length === plan.n * plan.n * 4);
}

/* 4. size and cost --------------------------------------------------------- */
{
  T.applyMap('cullen');
  const small = TS.planTsunami({ x: 0, z: 0, span: TS.mapSpan(T.MAP), quality: 'high' });
  T.applyMap('kestrel');
  AP.refreshRunways();
  const big = TS.planTsunami({ x: 0, z: 0, span: TS.mapSpan(T.MAP), quality: 'high' });
  ok('size: a bigger map gets a bigger one (higher, wider, further inland, further to come)', big.H > small.H && big.half > small.half && big.runup > small.runup && big.tArrive > small.tArrive, `Cullen ${small.H.toFixed(1)} m / ${small.runup.toFixed(0)} m inland / ${small.tArrive.toFixed(0)} s; Kestrel ${big.H.toFixed(1)} m / ${big.runup.toFixed(0)} m / ${big.tArrive.toFixed(0)} s`);
  ok('size: never taller than a real one', big.H <= 14.5 && small.H >= 13);
  const lo = make('low', 0, 0);
  const hi = make('high', 0, 0);
  ok('Low: a quarter of the field to sound and to read', lo.plan.n * lo.plan.n * 4 === hi.plan.n * hi.plan.n, `${lo.plan.n}² against ${hi.plan.n}², built in ${lo.ms.toFixed(0)} ms against ${hi.ms.toFixed(0)} ms`);
  const count = (q, wide) => SEA.axis(SEA.GRID[q], wide).length ** 2;
  const rows = ['low', 'medium', 'high', 'ultra'].map((q) => `${q} ${count(q, 0)} → ${count(q, q === 'low' ? lo.plan.wide : hi.plan.wide)}`);
  ok('Low: the sea\'s grid while it runs is under 16 k vertices', count('low', lo.plan.wide) < 16000 && count('high', hi.plan.wide) < 90000, rows.join('; '));
  for (const q of ['low', 'medium', 'high', 'ultra']) {
    const xs = SEA.axis(SEA.GRID[q], q === 'low' ? lo.plan.wide : hi.plan.wide);
    const band = xs.filter((x) => x > SEA.GRID[q].inner && x <= (q === 'low' ? lo.plan.wide : hi.plan.wide));
    const onStep = band.every((x) => Math.abs(x / SEA.GRID[q].wd - Math.round(x / SEA.GRID[q].wd)) < 1e-9);
    if (!onStep || SEA.FOLLOW % SEA.GRID[q].wd !== 0) ok(`grid: ${q}'s even band stays on the same world points as the sea follows the eye`, false);
  }
  ok('grid: the even band stays on the same world points as the sea follows the eye', true);
  ok('grid: with no tsunami the sea\'s grid is the one it was', count('low', 0) === SEA.seaGeometry('low').attributes.position.count && SEA.axis(SEA.GRID.high).length === SEA.axis(SEA.GRID.high, 0).length);
  ok('Low: the wave is still over a grid cell and a half wide where it breaks', lo.plan.Lf >= SEA.GRID.low.wd * 1.5);
}

/* 5. the list, the first load, offline ------------------------------------- */
{
  const ev = DIS.findEvent('tsunami');
  ok('list: it is a natural event a player can pick, and the randomiser can roll', !!ev && DIS.SELECTABLE_EVENTS.includes(ev) && DIS.poolForMap(T.MAP).includes(ev));
  ok('list: the warning says what to do', /get airborne or get to high ground/i.test(ev.warn));
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
    const re = new RegExp(IMPORT_RE.source, 'g');
    while ((m = re.exec(text))) if (m[1].startsWith('.')) walk(new URL(m[1], url));
  };
  walk(new URL('src/main.js', root));
  const mine = [...seen].filter((k) => /\/tsunami\.js$/.test(k));
  ok('first load: none of it is in main.js\'s static graph', mine.length === 0, mine.join(' '));
  ok('first load: the event loads its module when it is set going', /import\('\.\.\/features\/tsunami\.js'\)/.test(readFileSync(new URL('src/game/disasters.js', root), 'utf8')));
  const sw = readFileSync(new URL('sw.js', root), 'utf8');
  ok('offline: both modules are in the service worker\'s list', sw.includes("'src/world/tsunami.js'") && sw.includes("'src/features/tsunami.js'"));
  const feat = readFileSync(new URL('src/features/tsunami.js', root), 'utf8');
  ok('ends with the flight: back to the runway, the menu or a new flight clears it', /stop: \(sim\) => end\(sim\)/.test(feat) && /startMode: \(sim\) => end\(sim\)/.test(feat) && /setTsunami\(S\.sea, null\)/.test(feat));
  ok('nobody is shown in the water: people and vans of a flooded field are hidden, cars and boats kept away', /world-life:people/.test(feat) && /thinAround/.test(feat));
  console.log(`    on-demand code: ${gzipSync(feat).length + gzipSync(readFileSync(new URL('src/world/tsunami.js', root))).length} B gzipped`);
}

console.log(`\ntsunami: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  for (const f of fails) console.log('  FAIL ' + f);
  process.exit(1);
}

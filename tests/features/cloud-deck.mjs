/**
 * The cloud layer (world/cloud-deck.js), the sums. Run from anywhere:
 *
 *   node tests/features/cloud-deck.mjs
 *
 * The owner, 2026-11-05: "the higher u are in game the cloudier it is, till
 * 10k feet where it breaks through yk yk - but theres always clear patches
 * every so often and some parts".
 *
 *   - density and cover rise with height, from the base to the tops
 *   - the tops stand at 3,048 m and nothing is above them, on any sky
 *   - gaps at every height on every sky, and a gap at the tops is a gap all
 *     the way down: a hole you can see the ground through
 *   - the sky choices: Clear stays mostly clear, Random and Cloudy the full
 *     layer, Rainy and Stormy heavier with fewer gaps
 *   - one field: the shader is deckShape() (same numbers, read from the same
 *     arrays), the layer's fog and shadow read it, the field tiles
 *   - the phases carry `deck` through the blend, and CONDITIONS is left alone
 * The browser half (cloud-deck.browser.js) compares the drawn pixels.
 */
import { readFileSync } from 'node:fs';

const SRC = new URL('../../src/', import.meta.url).href;
const D = await import(SRC + 'world/cloud-deck.js');
const W = await import(SRC + 'world/weather.js');
const X = await import(SRC + 'world/wx.js');

let n = 0;
let fails = 0;
const ok = (name, pass, detail = '') => {
  n++;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};

const before = JSON.stringify(W.CONDITIONS);
const F = D.deckField();
const MN = Math.round(Math.sqrt(F.macro.length));
const DN = Math.round(Math.sqrt(F.detail.length));
/** Spots across the whole tile, at texel centres so the billows are what the arrays hold. */
const spots = [];
for (let i = 0; i < 12000; i++) {
  const u = Math.floor(((i * 0.6180339887) % 1) * MN);
  const v = Math.floor(((i * 0.7548776662) % 1) * MN);
  spots.push([F.macro[v * MN + u] / 255, F.detail[(i * 7919) % F.detail.length] / 255]);
}
const profile = (deck, foot, k) => {
  let sum = 0;
  let cover = 0;
  for (const [m, b] of spots) {
    const r = D.deckShape(m, b, k, deck, foot);
    sum += r;
    if (r > 0.02) cover++;
  }
  return { rho: sum / spots.length, cover: cover / spots.length };
};
const ksOf = (base) => [1524, 1829, 2134, 2438, 2743].map((y) => (y - base) / (D.DECK_TOP_M - base)); // 5,000 .. 9,000 ft

ok('the layer ends at 10,000 ft', D.DECK_TOP_M === 3048 && X.DECK_TOP_M === 3048);
{
  const base = W.CONDITIONS.cloudy.cloudBase;
  const p = ksOf(base).map((k) => profile(W.CONDITIONS.cloudy.deck, 0.3 + 0.55 * W.CONDITIONS.cloudy.stratus, k));
  ok('the higher you are the cloudier it is: density rises from 5,000 to 9,000 ft', p.every((v, i) => i === 0 || v.rho > p[i - 1].rho), p.map((v) => v.rho.toFixed(3)).join(' '));
  ok('...and so does how much of the sky it covers', p.every((v, i) => i === 0 || v.cover >= p[i - 1].cover), p.map((v) => v.cover.toFixed(2)).join(' '));
  ok('...from a thin layer to a thick one (twice the density at 9,000 ft as at 5,000)', p[4].rho > p[0].rho * 2, `${p[0].rho.toFixed(3)} to ${p[4].rho.toFixed(3)}`);
}
for (const id of Object.keys(W.CONDITIONS)) {
  const c = W.CONDITIONS[id];
  const foot = 0.3 + 0.55 * (c.stratus || 0);
  let topMost = -1;
  let over = 0;
  for (const [m, b] of spots) {
    for (let y = 2900; y <= 3048; y += 12) if (D.deckShape(m, b, (y - c.cloudBase) / (D.DECK_TOP_M - c.cloudBase), c.deck, foot) > 0.02) topMost = Math.max(topMost, y);
    for (const y of [3048.5, 3060, 3300, 5000, 9000]) if (D.deckShape(m, b, (y - c.cloudBase) / (D.DECK_TOP_M - c.cloudBase), c.deck, foot) > 0) over++;
  }
  ok(`${id}: the tops stand within 100 m of 10,000 ft, and over them it is clear`, topMost >= 2948 && over === 0, `highest ${topMost} m, ${over} points of cloud above`);
}
const skies = [...Object.entries(W.CONDITIONS).map(([k, c]) => [k, c, c.stratus || 0]), ...Object.entries(X.PHASES).map(([k, c]) => [`phase ${k}`, c, c.stratus || 0])];
for (const [id, c, st] of skies) {
  const foot = 0.3 + 0.55 * st;
  const base = c.cloudBase || c.base;
  let worst = 1;
  let leak = 0;
  for (const y of [base + 50, 1500, 2000, 2500, 2900, 3000]) {
    const k = (y - base) / (D.DECK_TOP_M - base);
    worst = Math.min(worst, 1 - profile(c.deck, foot, k).cover);
  }
  for (const [m, b] of spots) {
    if (D.deckShape(m, b, 0.93, c.deck, foot) > 0.001) continue;
    if (m + (b - 0.5) * 0.2 >= 1 - c.deck) continue; // shaved by the falling tops, not a gap
    for (const k of [0.1, 0.3, 0.5, 0.7]) if (D.deckShape(m, b, k, c.deck, foot) > 0) leak++;
  }
  ok(`${id}: open sky at every height, and a gap at the tops is a gap all the way down`, worst > 0.01 && leak === 0, `at worst ${(worst * 100).toFixed(1)}% open; ${leak} leaks`);
}

/* ---- the sky choices ---- */
{
  const C = W.CONDITIONS;
  const at = (c) => profile(c.deck, 0.3 + 0.55 * (c.stratus || 0), 0.9).cover;
  ok('Clear stays mostly clear: under a fifth of the tops, only patches', at(C.clear) < 0.2 && at(C.clear) > 0.03, at(C.clear).toFixed(3));
  ok('Random and Cloudy have the full layer', at(C.random) > 0.42 && at(C.cloudy) > 0.55, `${at(C.random).toFixed(2)}, ${at(C.cloudy).toFixed(2)}`);
  ok('Rainy and Stormy a heavier one with fewer gaps', at(C.rainy) > at(C.cloudy) && at(C.stormy) > at(C.rainy), `${at(C.rainy).toFixed(2)}, ${at(C.stormy).toFixed(2)}`);
  ok('the random sky always has its layer, thin in fair weather, thick in rain', Object.values(X.PHASES).every((p) => p.deck >= 0.4) && X.PHASES.rain.deck > X.PHASES.fair.deck, Object.values(X.PHASES).map((p) => p.deck).join(' '));
}

/* ---- one field ---- */
{
  const src = readFileSync(new URL('../../src/world/cloud-deck.js', import.meta.url), 'utf8');
  const frag = src.slice(src.indexOf('const sheetFrag'), src.indexOf('const _white'));
  const body = (s) => s.replace(/\s+/g, ' ');
  const a = body(frag);
  ok('the shader is deckShape: the same inner, top and density', a.includes('float top = 1.0 - inner * inner * 0.18 - b * 0.08;') && /const top = 1 - inner \* inner \* 0\.18 - b \* 0\.08;/.test(src) && a.includes('(v - (1.0 - uShape.x))'));
  ok('...the same height curve (the vertex half)', /vThr = 1\.0 - uShape\.x \* \(uShape\.y \+ \(1\.0 - uShape\.y\) \* s\)/.test(src) && /const thr = 1 - deck \* \(foot \+ \(1 - foot\) \* sstep\(0, 1, k\)\);/.test(src) && /vRho = 0\.34 \+ 0\.66 \* iK;/.test(src) && /\(0\.34 \+ 0\.66 \* clamp\(k, 0, 1\)\)/.test(src));
  ok('...reading the very arrays the CPU reads', F.macroTex.image.data === F.macro && F.detailTex.image.data === F.detail && /uMacro: \{ value: this\.field\.macroTex \}/.test(src) && /uDetail: \{ value: this\.field\.detailTex \}/.test(src));
  ok('the fog, the shadow and the ordinary clouds all read that field', /immersionAt\(x, z, y\) \{\s*const rho = this\.densityAt/.test(src) && /shadeAt\(x, z\) \{[^}]*this\.macroAt/.test(src) && /gapMask\(x, z\) \{[^}]*this\.macroAt/.test(src));
  const clouds = readFileSync(new URL('../../src/world/clouds.js', import.meta.url), 'utf8');
  ok('...clouds.js takes its shadow and its gaps from the layer, with no field of its own', /L\.shadeAt\(/.test(clouds) && /L\.gapMask\(x, z\)/.test(clouds) && !/vnoise|hash2/.test(clouds));
  let share = 0;
  for (const v of F.macro) if (v > 0.5 * 255) share++;
  ok('the big field is flat: `deck` of the area is over 1 - deck', Math.abs(share / F.macro.length - 0.5) < 0.01, (share / F.macro.length).toFixed(3));
  ok('the two tiles wrap together (a whole number of billows)', Number.isInteger(D.FIELD_SIZE / D.DETAIL_SIZE));
  ok('a power-of-two texture each, for the wrap and the mipmaps', (MN & (MN - 1)) === 0 && (DN & (DN - 1)) === 0 && F.macroTex.generateMipmaps);
}

/* ---- leave the table alone ---- */
{
  ok('the field is a pure function: no sky table touched by any of it', JSON.stringify(W.CONDITIONS) === before);
  const farlands = readFileSync(new URL('../../src/features/farlands-run.js', import.meta.url), 'utf8');
  ok('the Farlands thin the layer with the rest (in its own copy of the weather)', /const THIN = \[[^\]]*'deck'/.test(farlands) && /Object\.assign\(v\.cond, weather\.cond\)/.test(farlands));
  const w = new W.Weather();
  w.load({ condition: 'random', time: 'day' });
  w.beginFlight({ seed: 7 });
  for (let i = 0; i < 400; i++) w.update(30);
  ok('a blended random sky carries a deck', Number.isFinite(w.cond.deck) && w.cond.deck >= 0.39, String(w.cond.deck));
  ok('a flight of it leaves CONDITIONS as it was', JSON.stringify(W.CONDITIONS) === before);
  const wc = new W.Weather();
  wc.load({ condition: 'stormy', time: 'day' });
  wc.eyeY = 200;
  const low = wc.palette();
  wc.eyeY = 3600;
  const high = wc.palette();
  ok('over the tops of a Stormy sky the sky is clear and the fog thin, on a fixed sky too', high.overcast < 0.01 && high.fogDensity < low.fogDensity * 0.3 && high.sunIntensity > low.sunIntensity * 2, `fog ${low.fogDensity} to ${high.fogDensity}, sun ${low.sunIntensity.toFixed(2)} to ${high.sunIntensity.toFixed(2)}`);
}

console.log(`\ncloud-deck: ${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

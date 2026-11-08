/**
 * The Nullspire Javelin (aircraft/extra/javelin.js), the secret aeroplane
 * parked at the city in the void, checked in node:
 *
 *   /opt/homebrew/bin/node tests/features/javelin.mjs
 *
 *   - not in the roster until registered: every list the game and the tests
 *     walk is the roster it always was; nothing in the first load imports it
 *   - registered, it is a Massimo variant with its own law: Mach 5 at 20 km,
 *     a 490 m/s red line, a 120,000 ft ceiling; specFor and performanceFor
 *     answer for it; the model adapter resolves it to the Massimo's airframe
 *   - flown level at 20 km from Mach 2.4, flat out: Mach 4.8 or more inside
 *     ninety seconds, held under Mach 5.6 by the inlets, no NaN, no crash,
 *     at the game's own 1/30 step
 *   - low and slow it is a Massimo: the same stall speeds
 *   - the Massimo itself is untouched (fighters.mjs still holds)
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
global.window = global.window || { addEventListener() {} };
import { readFileSync } from 'node:fs';

const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const P = await import(SRC + 'aircraft/physics.js');
const Ty = await import(SRC + 'aircraft/types.js');
const { Weather } = await import(SRC + 'world/weather.js');
const Terrain = await import(SRC + 'world/terrain.js');
Terrain.applyMap('kestrel');

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};
const KT = 1.94384;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---- hidden ---- */
const before = Ty.AIRCRAFT.length;
ok('not in the roster before it is registered', !Ty.AIRCRAFT.some((a) => a.id === 'javelin'));
{
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
  walk(new URL('../../src/main.js', import.meta.url));
  ok('nothing in the first load imports it', ![...seen].some((k) => /extra\/javelin\.js$/.test(k)));
}

/* ---- registered ---- */
const J = await import(SRC + 'aircraft/extra/javelin.js');
const t = J.registerJavelin();
ok('registered once: one more in the roster, the same again', !!t && Ty.AIRCRAFT.length === before + 1 && J.registerJavelin() === t && Ty.AIRCRAFT.length === before + 1);
ok('a Massimo variant with its own law', t.variantOf === 'massimo' && t.secret && t.aero.reheat && t.aero.reheat.mach === 5 && t.aero.vne === 490 && t.aero.ceiling === 120000 && Ty.baseTypeId('javelin') === 'massimo');
{
  const spec = Ty.specFor('javelin');
  const perf = Ty.performanceFor('javelin');
  const mp = Ty.performanceFor('massimo');
  ok('specFor and performanceFor answer for it', spec && spec.vne === 490 && perf.vne > 900 && perf.ceilingFt === 120000);
  ok('low and slow it is a Massimo: the same stall speeds', perf.stallClean === mp.stallClean && perf.stallLanding === mp.stallLanding, `${perf.stallLanding} kt`);
  const M = await import(SRC + 'aircraft/model-adapter.js');
  ok('the model adapter knows it (variantOf)', typeof M.createAircraftModel === 'function');
}

/* ---- Mach 5 ---- */
function flyLevel(id, alt, speed0, secs, step) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = 'simplified';
  const w = new Weather();
  w.windSpeedKts = 0;
  w.windDirDeg = 90;
  ac.reset({ pos: new THREE.Vector3(-3000, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: speed0, altAGL: alt });
  ac.pos.y = alt;
  ac.rpm = 1;
  let maxM = 0;
  let at48 = -1;
  let nan = false;
  let lastM = 0;
  for (let tt = 0; tt < secs && !ac.crashed; tt += step) {
    ac.controls.throttle = 1;
    const hdgErr = ((ac.heading - 90 + 540) % 360) - 180;
    ac.controls.roll = clamp((clamp(-hdgErr * 0.9, -14, 14) - ac.bankAngleDeg()) / 16, -0.7, 0.7);
    ac.controls.yaw = clamp(-hdgErr / 26, -0.6, 0.6);
    const wantVs = clamp((alt - ac.pos.y) * 0.1, -8, 8);
    const g = Math.min(1, (300 / Math.max(100, ac.ias * KT)) ** 2);
    ac.controls.pitch = clamp(((wantVs - ac.vs) * 0.06 - ac.omega.x) * g, -0.8, 0.9);
    ac.update(step, w);
    if (!Number.isFinite(ac.pos.x + ac.pos.y + ac.vel.length() + ac.mach)) nan = true;
    maxM = Math.max(maxM, ac.mach);
    if (at48 < 0 && ac.mach >= 4.8) at48 = tt;
    lastM = ac.mach;
  }
  return { maxM, at48, nan, lastM, crashed: ac.crashed, reason: ac.crashReason, y: ac.pos.y, iasKt: ac.ias * KT };
}
{
  const r = flyLevel('javelin', 20000, 700, 180, 1 / 30);
  ok('from Mach 2.4 at 20 km, flat out: Mach 4.8 inside ninety seconds, held under 5.6, no NaN, no crash (1/30 step)', !r.nan && !r.crashed && r.at48 >= 0 && r.at48 < 90 && r.maxM < 5.6 && r.lastM >= 4.8, `Mach 4.8 at ${r.at48.toFixed(0)} s, top ${r.maxM.toFixed(2)}, at the end ${r.lastM.toFixed(2)} at ${r.y.toFixed(0)} m, ${r.iasKt.toFixed(0)} kt indicated`);
  const r2 = flyLevel('javelin', 20000, 700, 120, 1 / 120);
  ok('the same at the fine step', !r2.nan && !r2.crashed && r2.maxM >= 4.8 && r2.maxM < 5.6, `top ${r2.maxM.toFixed(2)}`);
  const m = flyLevel('massimo', 13000, 400, 120, 1 / 30);
  ok('the Massimo is still a Mach 2.5 aeroplane', !m.nan && !m.crashed && m.maxM < 2.8, `top ${m.maxM.toFixed(2)}`);
}

const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);

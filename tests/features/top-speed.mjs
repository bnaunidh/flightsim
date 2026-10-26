/**
 * The fast jets are fast (the owner, 2026-10-25: "ultra fast planes aren't
 * fast"). Headless, against the real flight model:
 *
 *   node tests/features/top-speed.mjs
 *
 *   1. SPEED RUN, per fast type: level at its profile's height
 *      (src/aircraft/reheat.js), full throttle from 300 kt, it reaches 90%
 *      or more of its published top Mach within six minutes, and not more
 *      than 8% over it (the inlets' wall holds it).
 *   2. LOW DOWN, flat out at 300 m and 2,500 m: fast (over 480 kt at
 *      2,500 m for every fighter) but held under the red line by the
 *      q-limit, so full throttle never sets off the overspeed and never
 *      breaks the aeroplane up.
 *   3. The B-1B (its own burners, aircraft/swing-wing.js) still makes its
 *      published Mach 1.25 at 11 km through the same wrapper the game uses.
 *   4. NOTHING ELSE CHANGES: below the burner detent the thrust is the
 *      shared law exactly (same speed to the bit after a minute at 80%), and
 *      a type with no profile (the A320, the Skylark) has no burner and no
 *      wave drag at any Mach.
 *   5. The pure law: burners light only past BURNER_FROM, fade with the
 *      q-limit, wave drag is zero below mdd - 0.08 and climbs past the choke.
 *
 * Exits non-zero if anything fails.
 */
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0, height: 0, style: {},
  }),
  body: { appendChild() {} },
};
const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const P = await import(SRC + 'aircraft/physics.js');
const R = await import(SRC + 'aircraft/reheat.js');
const SW = await import(SRC + 'aircraft/swing-wing.js');
const { Weather } = await import(SRC + 'world/weather.js');
const Terrain = await import(SRC + 'world/terrain.js');
Terrain.applyMap('kestrel');

const KT = 1.94384;
const STEP = 1 / 120;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const results = [];
function ok(name, pass, detail = '') {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? '  —  ' + detail : ''}`);
}

/** Level, wings level, heading east, at `alt` m, throttle `thr`, for `secs` from `startKt`. */
function run(id, { alt, startKt = 300, secs = 240, thr = 1, wrap = null, bare = false }) {
  P.applyAircraft(id);
  if (bare) P.SPEC.reheat = null;
  const ac = new P.Aircraft();
  ac.mode = 'simplified';
  const w = new Weather();
  w.windSpeedKts = 0;
  if (wrap) wrap(ac);
  ac.reset({ pos: new THREE.Vector3(-3000, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: startKt / KT, altAGL: alt });
  ac.pos.y = alt;
  ac.rpm = thr;
  let maxIas = 0;
  let overspeed = 0;
  ac.on(P.EVENTS.OVERSPEED, () => { overspeed++; });
  for (let t = 0; t < secs && !ac.crashed; t += STEP) {
    ac.controls.throttle = thr;
    const hdgErr = ((ac.heading - 90 + 540) % 360) - 180;
    ac.controls.roll = clamp((clamp(-hdgErr * 0.9, -14, 14) - ac.bankAngleDeg()) / 16, -0.7, 0.7);
    ac.controls.yaw = clamp(-hdgErr / 26, -0.6, 0.6);
    const wantVs = clamp((alt - ac.pos.y) * 0.1, -6, 6);
    ac.controls.pitch = clamp((wantVs - ac.vs) * 0.06 - ac.omega.x, -0.8, 0.9);
    ac.update(STEP, w);
    maxIas = Math.max(maxIas, ac.ias / P.SPEC.vne);
  }
  return { ac, kt: ac.airspeed * KT, M: R.machOf(ac.airspeed, ac.pos.y), maxIas, overspeed, crashed: ac.crashed ? ac.crashReason || 'crashed' : '' };
}

const FAST = Object.keys(R.PROFILES);

/* ---- 1. speed run at height ---- */
for (const id of FAST) {
  const p = R.reheatFor(id);
  const r = run(id, { alt: p.alt, secs: 360 });
  ok(`${id}: level flat out at ${p.alt} m reaches 90%+ of Mach ${p.mach}`, !r.crashed && r.M >= 0.9 * p.mach,
    `Mach ${r.M.toFixed(2)} (${Math.round(r.kt)} kt true) ${r.crashed}`);
  ok(`${id}: ...and no more than 8% over it`, r.M <= 1.08 * p.mach, `Mach ${r.M.toFixed(2)}`);
}

/* ---- 2. low down: fast, but under the red line ---- */
const FIGHTERS = ['massimo', 'f22', 'vanguard', 'fa18', 'f35b'];
for (const id of FAST) {
  for (const alt of [300, 2500]) {
    const r = run(id, { alt, secs: 180 });
    ok(`${id}: flat out at ${alt} m stays under its red line (q-limit) and in one piece`, !r.crashed && r.maxIas < 1 && r.overspeed === 0,
      `${Math.round(r.kt)} kt true, peak ${(r.maxIas * 100).toFixed(1)}% of vne ${r.crashed}`);
    if (alt === 2500 && FIGHTERS.includes(id)) ok(`${id}: ...and fast there: over 480 kt at 2,500 m`, r.kt > 480, `${Math.round(r.kt)} kt`);
  }
}

/* ---- 3. the B-1B through its own wrapper ---- */
{
  const r = run('b1b', { alt: 11000, secs: 300, wrap: (ac) => SW.wrapUpdate(ac, new SW.SwingWing()) });
  ok('b1b: its own burners still make Mach 1.25 (90%+) at 11 km', !r.crashed && r.M >= 0.9 * 1.25, `Mach ${r.M.toFixed(2)}`);
  ok('b1b: has no reheat profile of its own (the swing wing is its law)', R.reheatFor('b1b') === null);
}

/* ---- 4. nothing else changes ---- */
{
  // Below the detent: the shared law, to the bit. The F-22 at 80% with its profile and with none.
  const a = run('f22', { alt: 2500, secs: 60, thr: 0.8 });
  const b = run('f22', { alt: 2500, secs: 60, thr: 0.8, bare: true });
  ok('f22 at 80% throttle: no burner, exactly the shared thrust law', a.ac.burner === 0 && a.kt === b.kt,
    `${a.kt.toFixed(4)} vs ${b.kt.toFixed(4)} kt bare, burner ${a.ac.burner}`);
  for (const id of ['a320', 'skylark', 'b747', 'harrier']) {
    P.applyAircraft(id);
    ok(`${id}: no reheat profile, so no burner and no wave drag`, P.SPEC.reheat === null && R.reheatFor(id) === null);
  }
  const r = run('a320', { alt: 10000, secs: 60 });
  ok('a320 flat out: the burner never lights', (r.ac.burner || 0) === 0, `${r.ac.burner}`);
}

/* ---- 4b. the ceiling still means something ---- */
/*
 * Flat out in a steady 40 m/s climb (level once under 120 m/s true) for
 * 25 minutes: the climb runs out within 1.25 x the service ceiling, where
 * aircraft-specs.mjs holds every type, and above 1.1 x it is no longer
 * supersonic. Without the burners' ceiling fade (reheat.js ceilingBurner)
 * Concorde cruised at Mach 1.86 at the 70,000 ft top of the sky and the 50,000 ft fighters held 56-57,000 ft. A zoom past it
 * on the speed built up is allowed (it is what fast jets do), staying is not.
 */
for (const id of ['concorde', 'fa18', 'f35b', 'vanguard']) {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.mode = 'simplified';
  const w = new Weather();
  w.windSpeedKts = 0;
  ac.reset({ pos: new THREE.Vector3(-3000, 0, 0), headingDeg: 90, engineOn: true, gearDown: false, speed: 250, altAGL: 3000 });
  ac.pos.y = 3000;
  ac.rpm = 1;
  for (let t = 0; t < 1500 && !ac.crashed; t += STEP) {
    ac.controls.throttle = 1;
    ac.controls.roll = clamp(-ac.bankAngleDeg() / 16, -0.7, 0.7);
    const wantVs = ac.airspeed > 120 ? 40 : 0;
    ac.controls.pitch = clamp((wantVs - ac.vs) * 0.06 - ac.omega.x, -0.8, 0.9);
    ac.update(STEP, w);
  }
  const ft = ac.pos.y * 3.28084;
  const M = R.machOf(ac.airspeed, ac.pos.y);
  ok(`${id}: flat out, the climb runs out by 1.25 x its ${P.SPEC.ceiling} ft ceiling, and not still supersonic past 1.1 x`,
    !ac.crashed && ft <= 1.25 * P.SPEC.ceiling && (ft <= 1.1 * P.SPEC.ceiling || M < 1),
    `${Math.round(ft)} ft at Mach ${M.toFixed(2)} (${Math.round(ac.airspeed * KT)} kt true) after 25 min`);
}
{
  ok('ceilingBurner: all burner to 1.05 x the ceiling, none at 1.25 x', R.ceilingBurner(1) === 1 && R.ceilingBurner(0.35, 0.35) === 0 && R.ceilingBurner(0.7, 0.35) > 0.3);
}

/* ---- 5. the pure law ---- */
{
  const p = R.PROFILES.f22;
  ok('burners dark below the detent (throttle 0.85)', R.burnerShare(0.18 + 0.82 * 0.84, 0.5) === 0);
  ok('burners fully lit at full throttle well under the red line', R.burnerShare(1, 0.5) === 1);
  ok('the q-limit trims them out by Q_TO of the red line', R.burnerShare(1, R.Q_TO + 0.001) === 0 && R.burnerShare(1, (R.Q_FROM + R.Q_TO) / 2) > 0.2);
  ok('no wave drag below mdd - 0.08', R.waveDrag(p, p.mdd - 0.081) === 0);
  ok('the wave peak just past Mach 1', Math.abs(R.waveDrag(p, 1.04) - p.wave) < 1e-9);
  ok('the inlets\' wall climbs past the choke', R.waveDrag(p, p.choke + 0.1) > R.waveDrag(p, p.choke) + 0.07);
  ok('a lit burner never gives less than the propeller law', R.reheatEff(p, { ab: 1, M: 0.1, sigma: 1, propEff: 1 }) >= 1);
}

const failed = results.filter((x) => !x.pass).length;
console.log(`\n${results.length - failed}/${results.length} top-speed checks passed`);
process.exit(failed ? 1 : 0);

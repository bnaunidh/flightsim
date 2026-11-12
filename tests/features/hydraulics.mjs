/**
 * HYDRAULICS LOSS (owner, 2026-11-11: "in break something add hydraulics loss and you can choose
 * how much of the hydraulics are gone"), aircraft/physics.js failures.hydraulics + hydraulicLoss.
 * A jet: controls slow and weak, flaps and spoilers short and slow, the gear only falls (from half
 * gone), brakes fade (an accumulator's worth left). A light aeroplane's cable controls are untouched;
 * only its brakes go.
 *
 *   node tests/features/hydraulics.mjs
 */
const SRC = new URL('../../src/', import.meta.url).href;
const THREE = await import(SRC + 'vendor/three.module.js');
const P = await import(SRC + 'aircraft/physics.js');
const { Weather } = await import(SRC + 'world/weather.js');
const Terrain = await import(SRC + 'world/terrain.js');
Terrain.applyMap(Terrain.MAP.id);
let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
};
const w = new Weather();
w.windSpeedKts = 0;
const make = (id, loss, air = true) => {
  P.applyAircraft(id);
  const ac = new P.Aircraft();
  ac.reset({ pos: new THREE.Vector3(-2000, 0, 0), headingDeg: 90, engineOn: true, gearDown: true, speed: air ? 75 : 0, altAGL: air ? 900 : 0 });
  if (loss != null) {
    ac.failures.hydraulics = true;
    ac.hydraulicLoss = loss;
  }
  return ac;
};
const step = (ac, secs, set) => {
  for (let t = 0; t < secs; t += 1 / 60) {
    if (set) set(ac);
    ac.update(1 / 60, w);
  }
};
// Controls: full back stick for a quarter of a second, then held.
const pitchAfter = (id, loss, secs) => {
  const ac = make(id, loss);
  step(ac, secs, (a) => { a.controls.pitch = 1; a.controls.roll = 0; a.controls.yaw = 0; a.controls.throttle = 0.7; });
  return ac.controls.pitch;
};
const jet = 'b737';
const p0 = pitchAfter(jet, null, 0.25);
const p60s = pitchAfter(jet, 0.6, 0.25);
const p100 = pitchAfter(jet, 1, 2);
ok('jet, working hydraulics: full stick is full stick', p0 > 0.99, p0.toFixed(2));
ok('jet, 60% gone: the stick answers slowly (a quarter-second in, well short)', p60s < 0.7, p60s.toFixed(2));
ok('jet, all gone: a fifth of the authority left, however long you hold it', Math.abs(p100 - 0.2) < 0.02, p100.toFixed(2));
// Gear: down and locked, try to raise it.
const gearAfterRaise = (loss) => { const ac = make(jet, loss); ac.gearDown = false; step(ac, 2); return ac.gearPos; };
ok('jet, 30% gone: the gear still comes up, slower', gearAfterRaise(0.3) < 0.5 && gearAfterRaise(0.3) > gearAfterRaise(null), `${gearAfterRaise(0.3).toFixed(2)} vs ${gearAfterRaise(null).toFixed(2)}`);
ok('jet, half or more gone: the gear will not come up', gearAfterRaise(0.6) > 0.99);
const gearDrop = (() => { const ac = make(jet, 0.8); ac.gearDown = false; ac.gearPos = 0; ac.gearDown = true; step(ac, 3.5); const half = ac.gearPos; step(ac, 4); return [half, ac.gearPos]; })();
ok('jet, 80% gone: the gear still falls down by gravity, slowly', gearDrop[0] > 0.3 && gearDrop[0] < 0.7 && gearDrop[1] > 0.99, gearDrop.map((v) => v.toFixed(2)).join(' -> '));
// Flaps: full flap selected.
const flapsAfter = (loss) => { const ac = make(jet, loss); ac.flaps = 0; ac.flapsTarget = 1; step(ac, 12); return ac.flaps; };
ok('jet, 40% gone: the flaps stop at 60%', Math.abs(flapsAfter(0.4) - 0.6) < 0.02, flapsAfter(0.4).toFixed(2));
ok('jet, all gone: the flaps do not move', flapsAfter(1) < 0.01, flapsAfter(1).toFixed(2));
// Brakes, on the ground.
const brakeOf = (id, loss) => { const ac = make(id, loss, false); step(ac, 0.2, (a) => { a.controls.brakes = 1; a.controls.throttle = 0; }); return ac._brakeL; };
ok('jet, all gone: an accumulator\'s worth of braking left (15%)', Math.abs(brakeOf(jet, 1) - 0.15) < 0.02, brakeOf(jet, 1).toFixed(2));
ok('jet, half gone: brakes weaker', brakeOf(jet, 0.5) < 0.7 && brakeOf(jet, 0.5) > 0.4, brakeOf(jet, 0.5).toFixed(2));
// A light aeroplane: cables.
const pl = pitchAfter('skylark', 1, 0.25);
ok('light aeroplane, all gone: its cable controls are untouched', pl > 0.99, pl.toFixed(2));
ok('light aeroplane, all gone: no brakes', brakeOf('skylark', 1) < 0.01, brakeOf('skylark', 1).toFixed(2));
// Put right.
const fixed = (() => { const ac = make(jet, 1); step(ac, 1, (a) => { a.controls.pitch = 1; }); ac.failures.hydraulics = false; step(ac, 0.1, (a) => { a.controls.pitch = 1; }); return ac.controls.pitch; })();
ok('restored: full authority straight back', fixed > 0.99, fixed.toFixed(2));
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

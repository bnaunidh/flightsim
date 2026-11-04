/**
 * Node checks for the floatplane: the Petrel's numbers, the drag curve, a
 * real take-off and landing through the flight model with no page, the grade,
 * and that the code is lazy. Run with plain node:
 *
 *   node tests/features/floatplane.mjs
 *
 * tests/features/floatplane.browser.js flies it in the game. Every check
 * fails on v76.9, which has no floatplane.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};
global.localStorage = global.localStorage || { getItem: () => null, setItem() {}, removeItem() {} };

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const src = (p) => readFileSync(resolve(ROOT, p), 'utf8');
let passed = 0;
let failed = 0;
const ok = (name, pass, detail = '') => {
  if (pass) passed++;
  else failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
};

const have = existsSync(resolve(ROOT, 'src/features/floatplane/hydro.js'));
ok('floatplane: the water model is its own module', have);
if (!have) {
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(1);
}
const url = (p) => new URL(`../../${p}`, import.meta.url).href;
const { AIRCRAFT, getAircraft, specFor, performanceFor } = await import(url('src/aircraft/types.js'));
const { spawnClassOf } = await import(url('src/world/spawns.js'));
const P = await import(url('src/aircraft/physics.js'));
const H = await import(url('src/features/floatplane/hydro.js'));
const { Weather } = await import(url('src/world/weather.js'));
const THREE = await import(url('src/vendor/three.module.js'));

/* ---- the type ---- */
const t = getAircraft('petrel');
ok('type: the Petrel is in the roster', AIRCRAFT.some((a) => a.id === 'petrel') && t.id === 'petrel');
ok('type: a water class, so the spawns start it at the harbour', spawnClassOf(t) === 'water');
ok('type: no wheels to retract', t.shape.retractable === false);
ok('type: plain colours, no airline', typeof t.livery === 'string' && typeof t.accent === 'string' && !t.fixedLivery);
ok('type: a keel station at each end of each float', t.aero.floats.stations.length === 4);
const sp = specFor('petrel');
ok('type: the flight model is told about the floats', !!sp.floats && sp.floats.stations.length === 4);
const gearLow = Math.min(...sp.gearPoints.map((g) => g.pos.y));
const hardLow = Math.min(...sp.hardPoints.map((h) => h.pos.y));
ok('type: nothing hard is below the keels at the waterline', hardLow > gearLow + sp.floats.draft, `${hardLow} v ${gearLow}`);
ok('type: the propeller clears the water', sp.hardPoints[0].pos.y > gearLow + 1);
const perf = performanceFor('petrel');
ok('type: a stall a light aeroplane can land at', perf.stallClean < 60, `${perf.stallClean} kt`);

/* ---- the curve ---- */
ok('drag: a plough at taxi speed, stiff enough to stop her', H.keelDrag(2) > 0.08 && H.keelDrag(2) < 0.14, `${H.keelDrag(2).toFixed(3)}`);
ok('drag: the hump around 10 m/s', H.keelDrag(10.5) > 0.2 && H.keelDrag(10.5) > H.keelDrag(5) && H.keelDrag(10.5) > H.keelDrag(20), `${H.keelDrag(10.5).toFixed(3)}`);
ok('drag: on the step it falls away', H.keelDrag(22) < H.keelDrag(10.5) * 0.5, `${H.keelDrag(22).toFixed(3)}`);
ok('thrust: she can climb over the hump', sp.thrustMax / (sp.mass * 9.81) > H.keelDrag(10.5) * 1.1, `${(sp.thrustMax / (sp.mass * 9.81)).toFixed(2)} of her weight`);
ok('lift: a planing keel lifts more than a still one', H.planeLift(20) > H.planeLift(0));
ok('rudder: nothing standing still and idle, all of it at taxi speed', H.rudderBite(0, 0) === 0 && H.rudderBite(6, 0) === 1 && H.rudderBite(0, 1) > 0);

/* ---- the flight model, no page ---- */
function afloat(heading = 90, x = 9000, z = 9000) {
  P.applyAircraft('petrel');
  const a = new P.Aircraft();
  a.floatStep = H.floatStep;
  a.reset({ pos: new THREE.Vector3(x, 0, z), headingDeg: heading, speed: 0, altAGL: null, engineOn: true });
  a.parkingBrake = false;
  return a;
}
const W = new Weather();
const run = (a, s, f) => {
  for (let i = 0, n = Math.round(s * 120); i < n; i++) {
    if (f) f(a, i / 120);
    a.update(1 / 120, W);
  }
};
const still = afloat();
ok('afloat: a spawn on the sea sits on the sea, not on the sea bed', Math.abs(still.pos.y - (sp.floats.draft - Math.min(...sp.floats.stations.map((s) => s[1])) * -1) * -1) < 3 && still.pos.y > 1.2 && still.pos.y < 3, `${still.pos.y.toFixed(2)} m`);
still.engineOn = false;
run(still, 8);
ok('afloat: she settles and stays', !still.crashed && still.onWater && Math.abs(still.vel.y) < 0.15 && still.pos.y > 1.2, `y ${still.pos.y.toFixed(2)}, vy ${still.vel.y.toFixed(3)}`);
ok('afloat: level', Math.abs(still.bankAngleDeg()) < 2 && Math.abs(still.pitchAngleDeg()) < 6, `bank ${still.bankAngleDeg().toFixed(1)}, pitch ${still.pitchAngleDeg().toFixed(1)}`);
ok('afloat: on the water counts as down', still.onGround);

const taxi = afloat();
const h0 = taxi.heading;
run(taxi, 4, (a) => { a.controls.throttle = 0.3; });
run(taxi, 6, (a) => { a.controls.throttle = 0.3; a.controls.yaw = 1; });
const swing = Math.abs(((taxi.heading - h0 + 540) % 360) - 180);
ok('taxi: the water rudders turn her', swing > 25 && !taxi.crashed, `${swing.toFixed(0)} degrees`);
ok('taxi: at a taxi speed', taxi.groundSpeed < 12, `${taxi.groundSpeed.toFixed(1)} m/s`);

const off = afloat();
let liftT = null;
let dist = 0;
const x0 = off.pos.x;
run(off, 60, (a, tt) => {
  a.controls.throttle = 1;
  a.controls.pitch = a.groundSpeed < 24 ? 0.25 : 0.5;
  if (liftT === null && !a.onWater && a.groundSpeed > 15 && a.pos.y > 3.2) {
    liftT = tt;
    dist = a.pos.x - x0;
  }
});
ok('take-off: full power and she unsticks', liftT !== null && !off.crashed, `${liftT && liftT.toFixed(0)} s, ${dist.toFixed(0)} m, ${off.crashReason || 'flying'}`);
ok('take-off: in a run a harbour mouth can give her', dist > 150 && dist < 1100, `${dist.toFixed(0)} m`);
ok('take-off: and climbs away', off.pos.y > 60, `${off.pos.y.toFixed(0)} m`);

/* ---- the grade ---- */
const fake = { groundSpeed: 26, pitchAngleDeg: () => 4 };
const G = (o, vs = -200, bank = 0) => H.gradeWater({ ...fake, ...o }, vs, bank);
ok('grade: a gentle one is a landing, on no runway, scored', !G({}).crashed && G({}).water && G({}).score > 70, JSON.stringify(G({})));
ok('grade: harder is worse', G({}, -500).score < G({}, -150).score);
ok('grade: too hard is the crash', G({}, -900).crashed);
ok('grade: too fast is the crash', G({ groundSpeed: 50 }).crashed);
ok('grade: banked over is the crash', G({}, -200, 22).crashed);
ok('grade: bows first is the crash', G({ pitchAngleDeg: () => -10 }).crashed);

/* ---- the land ---- */
ok('land: a keel is a skid: real friction, no brakes', sp.floats.skid >= 0.15 && sp.floats.skid < 0.5);
ok('land: and the flight model reads it', /SPEC\.floats \? SPEC\.floats\.skid : grip\.muRoll/.test(src('src/aircraft/physics.js')));

/* ---- every list that names a type ---- */
ok('hangar: a cockpit family', /petrel: 'light'/.test(src('src/aircraft/cockpit/families.js')));
ok('hangar: an escape profile', /petrel: \{ escape: 'bail'/.test(src('src/features/eject/profiles.js')));
ok('hangar: on sale', /aircraft: 'petrel'/.test(src('src/game/progression.js')));

/* ---- lazy ---- */
const F = src('src/features/floatplane.js');
ok('lazy: a feature', /import '\.\/floatplane\.js';/.test(src('src/features/index.js')));
ok('lazy: spray comes in when it is wanted', /import\('\.\/ditching\/water-fx\.js'\)/.test(F) && !/^import .*water-fx/m.test(F));
ok('lazy: spray allocates nothing per frame', !/\bnew\b/.test(F.slice(F.indexOf('function sprayAndWake'), F.indexOf('function fit('))));
const hy = src('src/features/floatplane/hydro.js');
ok('lazy: the physics step allocates nothing', !/\bnew\b/.test(hy.slice(hy.indexOf('export function floatStep'), hy.indexOf('/** The landing'))));
ok('words: nothing slapstick', !/bonk|splat|oops|whoops|kaboom/i.test(F + hy));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

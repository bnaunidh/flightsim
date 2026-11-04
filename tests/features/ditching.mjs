/**
 * Node checks for the ditching (src/features/ditching.js, ditching/judge.js).
 * Run with plain node:
 *
 *   node tests/features/ditching.mjs
 *
 * The rules, read without flying: which types ditch, the limits, the verdict
 * and the grade; the flight model's seam (a hook that says no changes nothing,
 * a hard arrival is still the same crash); the mission; and that the code is
 * lazy. tests/features/ditching.browser.js flies it. Every check fails on
 * v76.9, where none of this exists.
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

const exists = existsSync(resolve(ROOT, 'src/features/ditching/judge.js'));
ok('ditching: the rules are their own pure module', exists);
if (!exists) {
  console.log(`${passed} passed, ${failed} failed`);
  process.exit(1);
}
const J = await import(new URL('../../src/features/ditching/judge.js', import.meta.url).href);
const { AIRCRAFT, performanceFor, getAircraft } = await import(new URL('../../src/aircraft/types.js', import.meta.url).href);

/* ---- who ditches ---- */
const by = (id) => J.ditchClass(getAircraft(id));
ok('class: an airliner gets slides and rafts', by('meridian') === 'airliner' && by('a380') === 'airliner' && by('b747') === 'airliner');
ok('class: a heavy twin, a freighter and the C-17 are the rafts too', by('tempest') === 'airliner' && by('dreamlifter') === 'airliner' && by('c17') === 'airliner');
ok('class: a light aeroplane gets a raft and the wing', by('skylark') === 'light' && by('courier') === 'light');
ok('class: a fast jet gets its dinghy', by('vanguard') === 'fast' && by('f22') === 'fast' && by('osprey') === 'fast' && by('nightjar') === 'fast');
const helis = AIRCRAFT.filter((a) => a.shape.power.rotor);
ok('class: no helicopter ditches here (they keep what they had)', helis.length >= 8 && helis.every((a) => J.ditchClass(a) === null), `${helis.length} helicopters`);
ok('class: nor does T-Pose Harrison', by('tpose') === null);
const planes = AIRCRAFT.filter((a) => !a.shape.power.rotor && a.id !== 'tpose' && !a.aero.floats);
ok('class: every other aeroplane has one', planes.every((a) => ['airliner', 'light', 'fast'].includes(J.ditchClass(a))), `${planes.length} types`);

/* ---- the limits ---- */
const SKY = performanceFor('skylark').stallClean;
const base = J.ditchLimits({ stallKts: SKY, cls: 'light' });
ok('limits: the sink rate is the old brace rule, 6.5 m/s', Math.abs(base.sinkFpm - 6.5 * 196.85) < 2, `${base.sinkFpm} ft/min`);
ok('limits: the bank is the old brace rule, 14 degrees', base.bankDeg === 14);
ok('limits: speed comes from the type\'s own stall', base.speedKts === Math.round(SKY * 1.6), `${base.speedKts} kt`);
const gear = J.ditchLimits({ stallKts: SKY, cls: 'light', gearDown: true });
ok('limits: the wheels down tighten sink and speed', gear.sinkFpm < base.sinkFpm && gear.speedKts < base.speedKts, `${gear.sinkFpm}, ${gear.speedKts}`);
const easy = J.ditchLimits({ stallKts: SKY, difficulty: 'easy' });
const real = J.ditchLimits({ stallKts: SKY, difficulty: 'realistic' });
ok('limits: Easy is kinder and Realistic is not', easy.sinkFpm > base.sinkFpm && real.sinkFpm < base.sinkFpm && easy.bankDeg > 14 && real.bankDeg < 14);
const fast = J.ditchLimits({ stallKts: 81, cls: 'fast' });
const air = J.ditchLimits({ stallKts: 81, cls: 'airliner' });
ok('limits: a fast jet has less margin over its stall', fast.speedKts < air.speedKts);

/* ---- the verdict ---- */
const good = { speedKts: 55, sinkFpm: 250, bank: 2, pitch: 5 };
ok('verdict: gentle, level and slow is whole', J.survivable(good, base).ok);
for (const [what, a, over] of [
  ['too steep', { ...good, sinkFpm: 1500 }, 'sink'],
  ['banked', { ...good, bank: 20 }, 'bank'],
  ['banked the other way', { ...good, bank: -20 }, 'bank'],
  ['nose down', { ...good, pitch: -15 }, 'pitch'],
  ['nose too high', { ...good, pitch: 25 }, 'pitch'],
  ['too fast', { ...good, speedKts: 130 }, 'speed'],
]) {
  const v = J.survivable(a, base);
  ok(`verdict: ${what} stays the crash`, !v.ok && v.over === over, JSON.stringify(v));
}
ok('verdict: a good arrival with the wheels down can still be whole', J.survivable(good, gear).ok);
ok('verdict: ...and what passes clean may not pass with them down', J.survivable({ ...good, sinkFpm: 1100 }, base).ok && !J.survivable({ ...good, sinkFpm: 1100 }, gear).ok);

/* ---- the grade ---- */
const G = (a, o) => J.gradeDitching({ ...good, ...a }, base, o);
ok('grade: a feather is Textbook', G({ sinkFpm: 60, speedKts: 42, bank: 0, pitch: 4 }, { flaps: 1 }).grade === 'Textbook', JSON.stringify(G({ sinkFpm: 60, speedKts: 42, bank: 0, pitch: 4 }, { flaps: 1 })));
ok('grade: harder is worse', G({ sinkFpm: 900 }).score < G({ sinkFpm: 300 }).score);
ok('grade: faster is worse', G({ speedKts: 75 }).score < G({ speedKts: 50 }).score);
ok('grade: banked is worse', G({ bank: 12 }).score < G({ bank: 0 }).score);
ok('grade: the wheels down cost marks', G({}, { gearDown: true }).score < G({}, {}).score);
ok('grade: flaps out earn them', G({}, { flaps: 1 }).score > G({}, { flaps: 0 }).score);
ok('grade: a rough sea costs them', G({}, { rough: 1 }).score < G({}, { rough: 0 }).score);
ok('grade: 0..100, one of four words', [0, 300, 900, 1270].every((s) => {
  const g = G({ sinkFpm: s });
  return g.score >= 0 && g.score <= 100 && ['Textbook', 'Good', 'Firm', 'Rough'].includes(g.grade);
}));

/* ---- how long she stays up ---- */
const D = src('src/features/ditching.js');
ok('sink: every class stays up about two minutes or more, a fast jet less', J.sinkSeconds('light') >= 110 && J.sinkSeconds('airliner', 18000) >= 150 && J.sinkSeconds('airliner', 28000) <= 220 && J.sinkSeconds('fast') >= 80, `${J.sinkSeconds('light')}, ${J.sinkSeconds('airliner', 18000)}, ${J.sinkSeconds('fast')}`);
ok('sink: the sea pulls hard at speed and hard enough at the end', J.waterDecelG(60) > 0.6 && J.waterDecelG(5) >= 0.2 && J.waterDecelG(60, 0.12) > J.waterDecelG(60));

/* ---- the flight model's seam ---- */
const P = src('src/aircraft/physics.js');
ok('seam: the hook is asked before the gear, and it may keep the step', /this\.waterHook && this\.waterHook\(this\)\) return;/.test(P));
ok('seam: a ditched aeroplane is the feature\'s, not the flight model\'s', /if \(this\.crashed \|\| this\.ditched\) \{/.test(P));
ok('seam: a reset gives it back', /this\.ditched = false;/.test(P));
ok('crash path: "You flew into the sea" is still the sea\'s word', /You flew into the sea/.test(P));
ok('crash path: braceSurvivable went into the judge, not lost', !/braceSurvivable\(\) \{/.test(src('src/main.js')) && /survivable\(arrival, limits\)/.test(D));
const { Aircraft, applyAircraft } = await import(new URL('../../src/aircraft/physics.js', import.meta.url).href);
const { Weather } = await import(new URL('../../src/world/weather.js', import.meta.url).href).catch(() => ({ Weather: null }));
const THREE = await import(new URL('../../src/vendor/three.module.js', import.meta.url).href);
if (Weather) {
  const run = (hook) => {
    applyAircraft('skylark');
    const a = new Aircraft();
    const w = new Weather();
    a.reset({ pos: new THREE.Vector3(9000, 0, 9000), headingDeg: 90, speed: 30, altAGL: null, gearDown: false });
    a._spawnOnGround = false;
    a.pos.y = 0.5;
    a.vel.set(30, -2, 0);
    a.onGround = false;
    if (hook) a.waterHook = hook;
    for (let i = 0; i < 40 && !a.crashed && !a.ditched; i++) a.update(1 / 120, w);
    return a;
  };
  const plain = run(null);
  const said = run(() => false);
  ok('crash path: with no hook the sea is the crash it was', plain.crashed && plain.crashReason === 'You flew into the sea', plain.crashReason);
  ok('crash path: a hook that says no changes nothing', said.crashed && said.crashReason === plain.crashReason && Math.abs(said.pos.y - plain.pos.y) < 1e-9);
  const took = run((a) => {
    a.ditched = true;
    return true;
  });
  const y = took.pos.y;
  took.update(1 / 120, new Weather());
  ok('seam: a hook that says yes stops the crash, and the flight model lets go', !took.crashed && took.ditched && took.pos.y === y);
} else {
  ok('seam: the weather module loads in node', false);
}

/* ---- the mission ---- */
const { MISSIONS } = await import(new URL('../../src/game/missions.js', import.meta.url).href);
const { MISSION_AIRCRAFT } = await import(new URL('../../src/game/mission-aircraft.js', import.meta.url).href);
const m = MISSIONS.find((x) => x.id === 'both-engines-out');
ok('mission: Both Engines Out exists, under Emergencies', !!m && m.category === 'events' && m.game === 'flight');
ok('mission: it says it may end in the water', !!m && m.allowDitch === true);
ok('mission: flown in an airliner', !!m && !!MISSION_AIRCRAFT[m.id] && getAircraft(MISSION_AIRCRAFT[m.id].fly[0]).class === 'Airliner');
ok('mission: the goal is the first step, and it has somewhere to point', !!m && /engines/i.test(m.steps[0].text) && typeof m.steps[0].target === 'function' && !!m.steps[0].atc);
ok('mission: a briefing, as the Emergencies have', !!m && m.blurb.length > 80 && !!m.reward);
const words = m ? JSON.stringify(m, (k, v) => (typeof v === 'function' ? String(v) : v)) + src('src/game/extra/ditching.js') : '';
ok('mission: a parody airline that is in the game', /Sandline/.test(words) && /name: 'Sandline Air'/.test(src('src/aircraft/liveries.js')));
ok('mission: no real incident, airline or river', !/hudson|sully|sullenberger|cactus|1549|us airways|miracle|la guardia|laguardia|teterboro|new york/i.test(words));
ok('mission: nothing slapstick', !/bonk|splat|oops|whoops|kaboom|ka-?boom|dizzy/i.test(words + D));

/* ---- lazy ---- */
const FI = src('src/features/index.js');
ok('lazy: a feature, not first-load code', /import '\.\/ditching\.js';/.test(FI) && !/features\/ditching/.test(src('src/main.js').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')));
ok('lazy: before onfoot, which would walk off an aeroplane afloat', FI.indexOf("import './ditching.js'") < FI.indexOf("import './onfoot.js'"));
ok('lazy: the rafts and the spray are dynamic imports', /import\('\.\/ditching\/scene\.js'\)/.test(D) && /import\('\.\/ditching\/water-fx\.js'\)/.test(D) && !/^import .*ditching\/(scene|water-fx)/m.test(D));
const FX = src('src/features/ditching/water-fx.js');
const body = FX.slice(FX.indexOf('  update(dt) {'), FX.indexOf('  /** Everything off the water'));
ok('cheap: spray and foam allocate nothing per frame', !/\bnew\b|\[\]|\{\s*\}/.test(body.replace(/\{\s*$/gm, '')));
ok('cheap: Low gets a smaller pool', /low \? 80 : 220/.test(FX) && /low \? 22 : 54/.test(FX));
const SC = src('src/features/ditching/scene.js');
ok('cheap: rafts and people are instanced, and Low has fewer', /instanced\(/.test(SC) && /low \? 4 : 8/.test(SC) && /low \? 14 : 36/.test(SC));
ok('flash: nothing here strobes (no timers, no flashes)', !/setInterval|strobe|Math\.random\(\) *[<>]/.test(FX + SC + D));

/* ---- afloat, as the checker saw her ---- */
ok('draught: a hull floats two fifths of the way up from the belly to the centre line', Math.abs(J.floatHeight(-1.7) - 0.986) < 0.01);
ok('draught: a real depth in the water, not a skim', -1.7 + J.floatHeight(-1.7) < -0.6);
ok('miss: the debrief says which limit, in numbers', /149 knots.*under 146/.test(J.missWords({ arrival: { speedKts: 149, sinkFpm: 700, bank: 0, pitch: 2 }, limits: { speedKts: 146 }, over: 'speed' })));
ok('miss: and for a dug-in nose', /nose was 12 degrees down/.test(J.missWords({ arrival: { speedKts: 100, sinkFpm: 700, bank: 0, pitch: -12 }, limits: {}, over: 'pitch' })));
const EX = src('src/game/extra/ditching.js');
ok('mission: the generic radio stays out of the emergency', /quiet: \[[^\]]*'lowalt'[^\]]*'airspace'/.test(EX));
ok('radio: nobody asks a ditched aeroplane to report the field in sight', /ac\.ditched/.test(src('src/game/atc-director.js')) && /ac\.ditched/.test(src('src/features/livemap/airspace.js')));

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);

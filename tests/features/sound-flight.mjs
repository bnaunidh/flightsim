/**
 * Node checks for the sound pass: the engine families, the listener's maths,
 * the seatbelt sign, and the iPad's unlock path. The audio itself: sound-slots.browser.js.
 *
 *   node tests/features/sound-flight.mjs
 */
import { readFileSync } from 'node:fs';
import { load, ok, report, root } from './tomm1z-common.mjs';

const src = (p) => readFileSync(new URL(p, root), 'utf8');
const { engineFamily, FAMILIES } = await load('src/audio/profile.js');
const { AudioMixer } = await load('src/audio/mixer.js');
const { GameAudio } = await load('src/audio/index.js');
const { atDistance, doppler, beltSign, NEAR } = await load('src/features/flight-sound.js');

/* ---- families ---- */
const T = (id, cls, kind, count, kN) => ({ id, class: cls, shape: { power: { kind, count } }, aero: { thrustMax: kN * 1000 } });
const want = [
  [T('skylark', 'Trainer', 'prop', 1, 3), 'piston'],
  [T('q400', 'Airliner', 'prop', 2, 48), 'turboprop'],
  [T('tempest', 'Tourer', 'prop', 2, 42), 'turboprop'],
  [T('meridian', 'Airliner', 'jet', 2, 60), 'regional'],
  [T('a320', 'Airliner', 'jet', 2, 64), 'narrow'],
  [T('b777', 'Airliner', 'jet', 2, 92), 'wide'],
  [T('b747', 'Airliner', 'jet', 4, 85), 'wide'],
  [T('f22', 'Fighter', 'jet', 1, 62), 'fighter'],
  [T('concorde', 'Airliner', 'jet', 4, 86), 'turbojet'],
  [T('a10', 'Fighter', 'jet', 1, 32), 'highbypass'],
  [{ id: 'h145', class: 'Helicopter', shape: { power: { kind: 'prop', count: 1, rotor: true } }, aero: {} }, 'rotor'],
];
for (const [t, f] of want) ok(`${t.id} is a ${f}`, engineFamily(t) === f, engineFamily(t));
ok('heavier jets spool slower', FAMILIES.fighter.up > FAMILIES.narrow.up && FAMILIES.narrow.up > FAMILIES.wide.up);

/* ---- where you are ---- */
ok('inside NEAR nothing changes', atDistance(0).gain === 1 && atDistance(NEAR).gain === 1 && atDistance(NEAR).cut === 20000);
ok('it falls with distance', atDistance(300).gain < 0.3 && atDistance(1000).gain < atDistance(300).gain, `${atDistance(300).gain} ${atDistance(1000).gain}`);
ok('the air takes the top end', atDistance(1000).cut < 3000, String(atDistance(1000).cut));
ok('doppler: coming at you is higher, going away lower', doppler(-100) > 1.3 && doppler(100) < 0.8, `${doppler(-100)} ${doppler(100)}`);
ok('doppler is held in bounds past Mach 1', doppler(-2000) === 1.5 && doppler(2000) === 0.7);

/* ---- the sign ---- */
const f = (o) => ({ onGround: false, aglFt: 500, vsFpm: 1500, settled: 0, turb: 0, ...o });
ok('on, on the ground', beltSign(false, f({ onGround: true })) === true);
ok('stays on in the climb', beltSign(true, f({ aglFt: 2000 })) === true);
ok('off once settled above 3,000 ft', beltSign(true, f({ aglFt: 5000, settled: 9, vsFpm: 0 })) === false);
ok('on again in rough air', beltSign(false, f({ aglFt: 5000, settled: 20, turb: 0.8 })) === true);
ok('on again in the descent', beltSign(false, f({ aglFt: 6000, vsFpm: -900 })) === true);
ok('stays off in level cruise', beltSign(false, f({ aglFt: 8000, vsFpm: 0, settled: 30 })) === false);

/* ---- the iPad's unlock ---- */
{
  const m = new AudioMixer();
  m.ctx = { state: 'suspended', resume: () => new Promise(() => {}) };
  const t0 = Date.now();
  const done = await Promise.race([m.ensure(), new Promise((r) => setTimeout(() => r('hung'), 1000))]);
  ok('a resume that never settles (a touch\'s pointerdown) does not hang the start-up', done === true && Date.now() - t0 < 600, String(done));
}
{
  const m = new AudioMixer();
  let calls = 0;
  m.ctx = { state: 'interrupted', resume: () => (calls++, Promise.resolve()) };
  m.resume();
  ok('iOS\'s "interrupted" context is woken', calls === 1);
  m.ctx.state = 'closed';
  m.resume();
  ok('...a closed one is left alone', calls === 1);
  m.ctx = { state: 'interrupted', resume: () => Promise.reject(new Error('still interrupted')) };
  m.resume();
  await new Promise((r) => setTimeout(r, 10));
  ok('...and a refusal is not an unhandled rejection', true);
}
{
  const m = new AudioMixer();
  m.ctx = { state: 'suspended', currentTime: 0 };
  ok('a one-shot on a frozen clock is dropped, not queued for a blast on resume', m.noiseBurst({}) === null && m.tone({}) === null);
}
const main = src('src/main.js');
ok('the unlock listens to what is a gesture on touch', ['pointerup', 'touchend', 'click'].every((e) => new RegExp(`\\[[^\\]]*'${e}'[^\\]]*\\]\\) window\\.addEventListener\\(e, \\(\\) => this\\.unlockAudio`).test(main)));
ok('every gesture wakes a sleeping context, not only the first', /async unlockAudio\(\) \{[\s\S]{0,200}this\.audio\.mixer\.resume\(\);[\s\S]{0,80}if \(this\.audio\.started/.test(main));
ok('a paused game is not woken by a tap on the pause menu', /if \(this\.state !== 'paused' && this\.audio\.available\) this\.audio\.mixer\.resume\(\);/.test(main));
ok('coming back to the tab wakes it', /!document\.hidden && this\.state !== 'paused'\) this\.wakeAudio\(\)/.test(main));

/* ---- right synth, muted default ---- */
ok('start and stop go to the engine in use', !/this\.audio\.engine\.play(Start|Stop)/.test(main) && (main.match(/activeEngine\.play/g) || []).length === 3);
{
  const a = new GameAudio();
  a.setEngineKind('jet');
  ok('a jet is its own active engine', a.activeEngine === a.jet);
  a.setEngineKind('rotor');
  ok('a rotor is the vehicles\' synth', a.activeEngine === a.vehicles);
  a.setEngineKind('prop');
  ok('a prop is the piston synth', a.activeEngine === a.engine);
}
ok('sound still starts muted', /muted:\s*true/.test(src('src/core/storage.js')));

/* ---- first load ---- */
const features = src('src/features/index.js');
ok('the sound feature comes with the bundle, after the menu', /import '\.\/flight-sound\.js'/.test(features));
ok('main.js does not import it', !/flight-sound|sound-samples/.test(main));
ok('nothing in src/audio imports it', ['index', 'mixer', 'engine', 'jet', 'ambience', 'alerts', 'profile'].every((f) => !/import[^\n]*(flight-sound|sound-samples)/.test(src(`src/audio/${f}.js`))));

report();

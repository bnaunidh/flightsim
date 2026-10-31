/**
 * The speech voice and the alarms (the owner, 2026-10-31: "make tts voice
 * better less roboty", "add alarm noises", and on Last Flight Out "there
 * should be people loading in").
 *
 *   - the speech mode ranks the device's voices: natural / neural / premium
 *     first, Google's next, the known good plain ones next, the joke voices
 *     never, network voices only online; the speakers on the frequency get
 *     DIFFERENT good voices; a natural voice is never pitch-shifted; a picked
 *     voice wins
 *   - the words are said the way a pilot says them: runway two seven, flight
 *     level one two zero, niner, knots, decimal
 *   - Last Flight Out: the klaxon, the sector horns and the warhead's pips are
 *     scheduled only with sound on, quieter with distance, silent past range;
 *     the PA's lines go out on the 'pa' voice, each warhead call once
 *   - the ramp shot: the Follow view frames the ramp while the ramp is down and
 *     the aeroplane is standing, and lets go when it rolls; the people wear a
 *     lit copy of the person material, put back before they are freed
 *   - Settings has the Speech voice list, and the setting is saved
 */
import { readFileSync } from 'node:fs';

const SRC = new URL('../../src/', import.meta.url).href;
let fails = 0;
let n = 0;
function ok(name, pass, detail = '') {
  n++;
  if (pass) console.log(`PASS  ${name}${detail ? `  — ${detail}` : ''}`);
  else {
    fails++;
    console.log(`FAIL  ${name}${detail ? `  — ${detail}` : ''}`);
  }
}
const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

/* ---------------- the speech voice ---------------- */
const V = (name, lang = 'en-US', local = true) => ({ name, voiceURI: name, lang, localService: local });
const VOICES_ON_DEVICE = [
  V('Albert'), V('Fred'), V('Zarvox'), V('Samantha'), V('Daniel', 'en-GB'), V('Thomas', 'fr-FR'),
  V('Google US English', 'en-US', false), V('Google UK English Female', 'en-GB', false),
  V('Microsoft Aria Online (Natural) - English (United States)', 'en-US', false),
  V('Ava (Premium)'), V('Zoe (Enhanced)'),
];
let listeners = {};
globalThis.speechSynthesis = {
  getVoices: () => VOICES_ON_DEVICE,
  addEventListener: (k, fn) => (listeners[k] = fn),
  speak() {}, cancel() {},
};
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
const A = await import(SRC + 'audio/atc.js');

ok('the joke voices are never used', ['Albert', 'Fred', 'Zarvox'].every((nm) => A.voiceScore(V(nm)) < 0));
ok('only English voices', A.voiceScore(V('Thomas', 'fr-FR')) < 0);
ok('natural beats Google beats a good plain voice beats an unknown one',
  A.voiceScore(V('Ava (Premium)')) > A.voiceScore(V('Google US English', 'en-US', false)) &&
  A.voiceScore(V('Google US English', 'en-US', false)) > A.voiceScore(V('Samantha')) &&
  A.voiceScore(V('Samantha')) > A.voiceScore(V('Someone')));
ok('a network voice is not offered offline', A.voiceScore(V('Google US English', 'en-US', false), false) < 0 && A.voiceScore(V('Ava (Premium)'), false) > 0);
const list = A.speechVoices();
ok('the Settings list is best first, with no joke or foreign voices', list.length === 7 && A.isNatural({ name: list[0].name }) && !list.some((v) => /Albert|Fred|Zarvox|Thomas/.test(v.name)),
  list.map((v) => v.name).join(', '));
const seats = ['instructor', 'tower', 'ground', 'approach'].map((k) => A.voiceFor(A.VOICES[k]));
ok('the instructor, tower, ground and approach get four different natural voices', new Set(seats.map((x) => x && x.name)).size === 4 && seats.every((x) => A.isNatural(x)),
  seats.map((x) => x && x.name).join(' / '));
ok('a voice the player picked wins', A.voiceFor(A.VOICES.tower, 'Samantha').name === 'Samantha');
ok('a picked voice the device no longer has falls back to the automatic one', A.voiceFor(A.VOICES.tower, 'Gone Voice') && A.voiceFor(A.VOICES.tower, 'Gone Voice').name === seats[1].name);
ok('there is a Site PA voice on the radio', !!A.VOICES.pa && A.VOICES.pa.label === 'Site PA');

// What the device is actually asked to say.
const said = [];
globalThis.speechSynthesis.speak = (u) => said.push(u);
globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
const fakeMixer = {
  ctx: { currentTime: 0, createOscillator: () => node(), createGain: () => node(), createBiquadFilter: () => node(), createBuffer: () => ({ getChannelData: () => new Float32Array(8) }), createBufferSource: () => node(), createWaveShaper: () => node(), createDynamicsCompressor: () => node(), sampleRate: 48000 },
  muted: false, busEnabled: () => true, bus: () => node(),
};
function node() {
  const p = () => ({ value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} });
  return { connect() {}, disconnect() {}, start() {}, stop() {}, frequency: p(), gain: p(), Q: p(), detune: p(), type: '', curve: null, buffer: null, loop: false, playbackRate: p(), threshold: p(), knee: p(), ratio: p(), attack: p(), release: p() };
}
const radio = new A.Radio(fakeMixer);
radio.ctx = fakeMixer.ctx;
radio.setMode('speech');
let spoke = null;
try {
  radio.built = true;
  radio.click = () => {}; radio.squelch = () => {};
  radio.transmit('Reach two one, runway 27, wind 270 at 12 kts, climb FL120.', { voice: 'tower' });
  spoke = said[said.length - 1];
} catch (e) {
  ok('speech mode transmits', false, e.message);
}
ok('the device says the words a pilot would', spoke && spoke.text === 'Reach two one, runway two seven, wind two seven zero at one two knots, climb flight level one two zero.', spoke && spoke.text);
ok('a natural voice is not pitch-shifted', spoke && spoke.voice && A.isNatural(spoke.voice) && spoke.pitch === 1, spoke && `${spoke.voice && spoke.voice.name} pitch ${spoke.pitch}`);
ok('niner, decimal, and the separators', A.speakable('Contact 118.30 · runway nine') === 'Contact one one eight decimal three zero, runway niner', A.speakable('Contact 118.30 · runway nine'));
ok('the subtitle keeps the written words (only the voice gets the spoken form)', /onSubtitle\(\{ text,/.test(read('src/audio/atc.js')));

/* ---------------- Last Flight Out: the alarms ---------------- */
const T = await import(SRC + 'world/terrain.js');
const M = await import(SRC + 'world/maps.js');
T.applyMap(M.getMap('nunatak'));
const Esc = await import(SRC + 'features/scp-escape.js');
const cfg = T.MAP.scp;
const c = cfg.strip ? { x: cfg.strip.cx, z: cfg.strip.cz } : { x: 0, z: 0 };
let notes = 0;
function alarmSim(soundOn, dist) {
  notes = 0;
  const ctx = { currentTime: 1, createOscillator: () => { notes++; return node(); }, createGain: () => node(), createBiquadFilter: () => node() };
  const mixer = { ctx, muted: !soundOn, busEnabled: () => true, bus: () => node(), tone() {} };
  const spoken = [];
  return {
    audio: { available: true, mixer },
    aircraft: { pos: { x: c.x + dist, y: 0, z: c.z }, onGround: true },
    speak: (text, voice) => spoken.push({ text, voice }),
    spoken,
  };
}
const R0 = () => ({ t: 10, lost: 0, stripLost: false, blast: null, warhead: 200 });
{
  const sim = alarmSim(true, 50);
  const R = R0();
  Esc.stepAlarms(R, sim, 0.1);
  ok('sound on, near the Site: the klaxon whoops', notes === 1 && R.alarms === 1, `oscillators ${notes}`);
  Esc.stepAlarms(R, sim, 0.5);
  ok('...and not again until its period is up', notes === 1);
  Esc.stepAlarms(R, sim, Esc.ALARM.klaxonEvery);
  ok('...then again', notes === 2);
}
{
  const sim = alarmSim(false, 50);
  const R = R0();
  Esc.stepAlarms(R, sim, 2);
  Esc.sectorHorn(R, sim);
  ok('sound off: no alarm at all', notes === 0 && !R.alarms);
}
{
  const sim = alarmSim(true, Esc.ALARM.rangeM + 200);
  const R = R0();
  Esc.stepAlarms(R, sim, 2);
  ok('past its range: silent', notes === 0);
}
{
  const sim = alarmSim(true, 50);
  const R = R0();
  R.lost = Esc.SECTORS.length;
  Esc.stepAlarms(R, sim, 0.1);
  ok('the strip\'s sector gone: the klaxon comes faster', R.klaxonT === Esc.ALARM.klaxonUrgentEvery);
  ok('three horn blasts for a sector', Esc.sectorHorn(R, sim) && notes === 4);
}
{
  const sim = alarmSim(true, 50);
  const R = R0();
  R.warhead = 25;
  R.klaxonT = 99;
  Esc.stepAlarms(R, sim, 0.1);
  const a = notes;
  Esc.stepAlarms(R, sim, 0.5);
  Esc.stepAlarms(R, sim, 0.6);
  ok('the last thirty seconds: a pip a second', a === 1 && notes === 2, `${a} then ${notes}`);
  R.warhead = 8;
  Esc.stepAlarms(R, sim, 0.55);
  Esc.stepAlarms(R, sim, 0.5);
  ok('the last ten: two a second', R.pipT === 0.5, String(R.pipT));
}
{
  const sim = alarmSim(true, 50);
  const R = R0();
  R.t = 2;
  R.warhead = 230;
  Esc.stepPa(R, sim);
  ok('the PA opens with the evacuation call, on the Site PA voice', sim.spoken.length === 1 && sim.spoken[0].voice === 'pa' && /Evacuate/.test(sim.spoken[0].text));
  R.warhead = 179;
  Esc.stepPa(R, sim);
  Esc.stepPa(R, sim);
  ok('each warhead call once', sim.spoken.filter((s) => /three minutes/.test(s.text)).length === 1);
  R.warhead = 25;
  Esc.stepPa(R, sim);
  ok('a late frame says only the latest call, not the whole list', sim.spoken.length === 3 && /Thirty/.test(sim.spoken[2].text), sim.spoken.map((s) => s.text).join(' | '));
  const far = alarmSim(true, Esc.ALARM.rangeM + 500);
  const R2 = R0();
  R2.t = 2;
  Esc.stepPa(R2, far);
  ok('out of earshot of the PA: nothing said', far.spoken.length === 0);
}
const escSrc = read('src/features/scp-escape.js');
ok('every alarm goes through the environment bus and audioOk (sound on, not muted)', /function alarmBus\(sim\) \{\n  if \(!audioOk\(sim\)\) return null;/.test(escSrc) && /m\.bus\('environment'\)/.test(escSrc));
ok('the alarms are quiet (a class plays this on laptops)', Esc.ALARM.klaxonGain <= 0.06 && Esc.ALARM.hornGain <= 0.06 && Esc.ALARM.pipGain <= 0.06);

/* ---------------- the ramp shot and the people ---------------- */
ok('the Follow camera takes a framed shot from a mission', /this\.mode === 'chase' && typeof this\.shot === 'function' && this\.shot\(ac, this\._shot\)/.test(read('src/flight/camera.js')));
ok('the ramp shot only while the ramp is down and the aeroplane stands, and only the Follow view', /RAMP_SHOT\.maxSpeed/.test(escSrc) && /R\.phase === 'boarding' \|\| R\.phase === 'leaving'/.test(escSrc));
ok('the shot is handed back when the run ends', /E\.sim\.rig\.shot === rampShot\) E\.sim\.rig\.shot = null/.test(escSrc));
ok('the people wear a lit copy of the person material, put back before they are freed', /setFigureMaterial\(p, personMaterial\(\), litPersonMaterial\(\)\)/.test(escSrc) && /setFigureMaterial\(f\.p, litMat, personMaterial\(\)\);\n    try \{ disposePerson/.test(escSrc));
ok('no light is added to the scene for them (a new light recompiles every material)', !/new THREE\.(Point|Spot)Light/.test(escSrc));

/* ---------------- the setting ---------------- */
ok('the Speech voice setting is saved, default automatic', /atcSpeechVoice: 'auto'/.test(read('src/core/storage.js')));
ok('Settings lists the device voices under Speech voice', /data-set="atcSpeechVoice"/.test(read('src/ui/menus.js')) && /fillSpeechVoices/.test(read('src/ui/menus.js')));
ok('the game hands the choice to the radio', /this\.audio\.radio\.speechVoice = this\.settings\.atcSpeechVoice \|\| 'auto'/.test(read('src/main.js')));

console.log(`\nvoice-alarms: ${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

/**
 * Every sound in the game, rendered and measured. Fails if a slot is silent,
 * clips, or a loop has a seam. NOTHING IS PLAYED: the audio is rendered to an
 * array by an OfflineAudioContext (sound-lab.js) and only numbers are read.
 * It can say a sound exists and is level; whether it sounds good it cannot say.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/sound-slots.browser.js check "" 1
 */
import { renderAudio, measure, beat, seam, flight, CALM, TYPES } from './sound-lab.js';

export const id = 'sound-slots';

const THROTTLE = (x) => ({ throttle: x, brakes: 0, yaw: 0 });
const GROUND = { onGround: true, gearDown: true, gearPos: 1, agl: 0 };
const only = (a, buses) => {
  for (const b of ['engine', 'environment', 'atc', 'alerts', 'music']) a.mixer.buses[b].gain.value = buses.includes(b) ? a.mixer.volumes[b] : 0;
};

async function steady({ family, inside = false, ac, buses = ['engine'], secs = 7, weather = CALM, view = null, trace = null }) {
  const type = TYPES[family];
  const kind = family === 'rotor' ? 'rotor' : type.shape.power.kind;
  const r = await renderAudio({
    seconds: secs,
    setup: (a) => {
      a.setEngineKind(kind);
      if (type) a.setProfile(type);
      a.setInterior(inside);
      if (view) Object.assign(a.mixer.view, view);
      only(a, buses);
    },
    frame: (a, t, dt) => {
      a.update(dt, flight(typeof ac === 'function' ? ac(t) : ac), weather, 0, false);
      if (trace) trace(a, t);
    },
  });
  return { ...measure(r.data, r.rate, secs - 3, secs), beat: beat(r.data, r.rate, secs - 3, secs) };
}

async function shot(fire, secs = 3, buses = ['environment', 'alerts', 'engine']) {
  const FX = (await import('../../src/features/flight-sound.js')).FlightFx;
  let done = false;
  const r = await renderAudio({
    seconds: secs,
    setup: (a) => only(a, buses),
    frame: (a, t) => {
      if (!done && t >= 0.1) {
        done = true;
        fire(a, new FX({ audio: a }));
      }
    },
  });
  return measure(r.data, r.rate, 0, secs);
}

/** A mono 16-bit WAV of `fn(t)`, as a blob: URL. Nothing is added to the repo. */
function wavUrl(seconds, fn, rate = 44100) {
  const n = Math.floor(seconds * rate);
  const b = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((c, i) => b.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  b.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVEfmt ');
  b.setUint32(16, 16, true);
  b.setUint16(20, 1, true);
  b.setUint16(22, 1, true);
  b.setUint32(24, rate, true);
  b.setUint32(28, rate * 2, true);
  b.setUint16(32, 2, true);
  b.setUint16(34, 16, true);
  str(36, 'data');
  b.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) b.setInt16(44 + i * 2, Math.max(-1, Math.min(1, fn(i / rate))) * 32767, true);
  return URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' }));
}

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`sound-slots: ${name}`, !!pass, detail);
  const heard = (name, m, floor = -40) => {
    ok(`${name}: not silent on a tablet's speaker`, m.speaker > floor, `speaker ${m.speaker} dBFS`);
    ok(`${name}: does not clip`, m.peak < 0, `peak ${m.peak} dBFS`);
  };

  /* ---- engines ---- */
  const rows = {};
  for (const family of ['piston', 'turboprop', 'regional', 'narrow', 'wide', 'fighter', 'turbojet', 'highbypass']) {
    say(`sound-slots: ${family}`);
    const idle = await steady({ family, ac: { rpm: 0.18, ...GROUND } });
    const full = await steady({ family, ac: { rpm: 1, controls: THROTTLE(1), ...GROUND }, secs: 12 });
    const cruise = await steady({ family, inside: true, ac: { rpm: 0.65, controls: THROTTLE(0.65), airspeed: 100, ias: 100 }, secs: 10 });
    const outside = await steady({ family, ac: { rpm: 0.65, controls: THROTTLE(0.65), airspeed: 100, ias: 100 }, secs: 10 });
    rows[family] = { idle, full, cruise, outside };
    heard(`${family} idle`, idle, -42);
    heard(`${family} full power`, full, -28);
    heard(`${family} from the cockpit`, cruise, -45);
    ok(`${family}: full power is at least 8 dB over idle on a speaker`, full.speaker - idle.speaker >= 8, `${idle.speaker} to ${full.speaker}`);
    ok(`${family}: the cockpit is duller than outside`, cruise.centroid < outside.centroid * 0.8, `${outside.centroid} Hz out, ${cruise.centroid} Hz in`);
    ok(`${family}: the cockpit is quieter than outside`, cruise.speaker < outside.speaker - 1.5, `${outside.speaker} out, ${cruise.speaker} in`);
  }
  const names = Object.keys(rows);
  for (let i = 0; i < names.length; i++) {
    for (let k = i + 1; k < names.length; k++) {
      const a = rows[names[i]].full;
      const b = rows[names[k]].full;
      const d = Math.abs(a.centroid - b.centroid) / Math.max(a.centroid, b.centroid) + a.bands.reduce((t, v, n) => t + Math.abs(v - b.bands[n]), 0) / 30;
      ok(`${names[i]} and ${names[k]} are measurably different sounds`, d > 0.12, d.toFixed(2));
    }
  }
  const rotor = await steady({ family: 'rotor', ac: { rpm: 0.8, controls: THROTTLE(0.8), airspeed: 30, ias: 30 }, secs: 16 });
  heard('rotor', rotor, -30);

  /* ---- spool ---- */
  const spool = {};
  for (const family of ['fighter', 'narrow', 'wide']) {
    let at = null;
    await steady({ family, ac: (t) => ({ rpm: t < 0.5 ? 0.2 : 1 }), secs: 9, trace: (a, t) => {
      if (at == null && a.jet.n1 > 0.9) at = t - 0.5;
    } });
    spool[family] = at;
  }
  ok('spool: a fighter answers before an airliner, a heavy after', spool.fighter < spool.narrow && spool.narrow < spool.wide, JSON.stringify(spool));

  /* ---- what the flight does to it ---- */
  const dry = await steady({ family: 'fighter', ac: { rpm: 1, controls: THROTTLE(1), airspeed: 150, ias: 150 }, secs: 8 });
  const wet = await steady({ family: 'fighter', ac: { rpm: 1, burner: 1, controls: THROTTLE(1), airspeed: 150, ias: 150 }, secs: 8 });
  ok('the afterburner is heard', wet.rms > dry.rms + 1.5, `${dry.rms} dry, ${wet.rms} in reheat`);
  const forward = await steady({ family: 'narrow', ac: { rpm: 0.8, controls: THROTTLE(0.8), ...GROUND }, secs: 9 });
  const reverse = await steady({ family: 'narrow', ac: { rpm: 0.8, reverse: 1, controls: THROTTLE(0.8), ...GROUND }, secs: 9 });
  ok('reverse thrust is heard', reverse.rms > forward.rms + 0.7, `${forward.rms} forward, ${reverse.rms} reversed`);
  const wind = async (kt) => steady({ family: 'narrow', ac: { rpm: 0, engineOn: false, airspeed: kt / 1.944, ias: kt / 1.944 }, buses: ['environment'], secs: 3.5 });
  const w200 = await wind(200);
  const w450 = await wind(450);
  const w900 = await wind(900);
  ok('wind keeps rising past 200 kt', w450.rms > w200.rms + 2 && w900.rms > w450.rms + 1, `${w200.rms} ${w450.rms} ${w900.rms}`);
  const clean = await steady({ family: 'narrow', ac: { rpm: 0, engineOn: false, airspeed: 77, ias: 77 }, buses: ['environment'], secs: 3.5 });
  const dirty = await steady({ family: 'narrow', ac: { rpm: 0, engineOn: false, airspeed: 77, ias: 77, gearPos: 1, flaps: 1 }, buses: ['environment'], secs: 3.5 });
  ok('gear and flaps out are heard in the air', dirty.bands[1] > clean.bands[1] + 3, `100-300 Hz: ${clean.bands[1]} clean, ${dirty.bands[1]} dirty`);
  const buffet = await steady({ family: 'narrow', ac: { rpm: 0, engineOn: false, airspeed: 40, ias: 40, stalled: true }, buses: ['environment'], secs: 3.5 });
  heard('stall buffet', buffet, -42);
  const rain = await steady({ family: 'narrow', ac: { rpm: 0, engineOn: false }, buses: ['environment'], secs: 3.5, weather: { cond: { turb: 0, rain: 1 }, windSpeedKts: 0, lightningFlash: 0 } });
  heard('rain', rain, -40);

  /* ---- where you are ---- */
  const close = await steady({ family: 'narrow', ac: { rpm: 0.7, controls: THROTTLE(0.7) }, secs: 8 });
  const away = await steady({ family: 'narrow', ac: { rpm: 0.7, controls: THROTTLE(0.7) }, secs: 8, view: { gain: 0.1, cut: 1500 } });
  ok('distance: quieter and duller', away.rms < close.rms - 12 && away.centroid < close.centroid * 0.7, `${close.rms}/${close.centroid} near, ${away.rms}/${away.centroid} far`);
  const tone = (m) => parseInt(m.tones[0], 10) || 0;
  const coming = await steady({ family: 'regional', ac: { rpm: 0.7, controls: THROTTLE(0.7) }, secs: 8, view: { pitch: 1.2 } });
  const going = await steady({ family: 'regional', ac: { rpm: 0.7, controls: THROTTLE(0.7) }, secs: 8, view: { pitch: 0.85 } });
  ok('doppler: the tone falls as it goes by', tone(coming) / tone(going) > 1.25 && tone(coming) / tone(going) < 1.6, `${tone(coming)} Hz coming, ${tone(going)} Hz going`);

  /* ---- one-shots ---- */
  say('sound-slots: one-shots');
  const shots = {
    'touchdown, soft': (a) => a.ambience.playTouchdown(0.15, 'paved'),
    'touchdown, hard': (a) => a.ambience.playTouchdown(0.9, 'paved'),
    'touchdown, grass': (a) => a.ambience.playTouchdown(0.5, 'grass'),
    'gear down': (a) => a.ambience.playGear(true),
    'gear up': (a) => a.ambience.playGear(false),
    flaps: (a) => a.ambience.playFlaps(),
    crash: (a) => a.ambience.playCrash(),
    splash: (a) => a.ambience.playSplash(),
    thunder: (a) => a.ambience.playThunder(0.3),
    'piston start': (a) => a.engine.playStart(),
    'jet start': (a) => a.jet.playStart(),
    'seatbelt chime': (a, fx) => fx.chime(),
    'switch click': (a, fx) => fx.click(),
    'lever': (a, fx) => fx.lever(),
    door: (a, fx) => fx.door(),
  };
  for (const name of Object.keys(shots)) {
    const m = await shot(shots[name]);
    ok(`${name}: heard`, m.peak > -32, `peak ${m.peak}`);
    ok(`${name}: does not clip`, m.peak < 0, `peak ${m.peak}`);
  }
  const flapsPeak = (await shot(shots.flaps)).peak;
  ok('flaps are no longer inaudible (they peaked at -38)', flapsPeak > -28, `peak ${flapsPeak}`);
  const splashPeak = (await shot(shots.splash)).peak;
  ok('the splash is no longer the loudest thing in the game (it peaked at -3.8)', splashPeak < -8, `peak ${splashPeak}`);

  /* ---- loops ---- */
  const lab = await renderAudio({ seconds: 0.1 });
  const pink = lab.audio.mixer.pinkBuffer().getChannelData(0);
  ok('the pink noise loop has no seam', seam(pink) < 4, `jump ${seam(pink)} x typical`);
  const white = lab.audio.mixer.noiseBuffer().getChannelData(0);
  ok('the white noise loop has no seam', seam(white) < 4, `jump ${seam(white)} x typical`);

  /* ---- everything at once ---- */
  say('sound-slots: everything at once');
  const all = await renderAudio({
    seconds: 7,
    setup: (a) => {
      a.setEngineKind('jet');
      a.setProfile(TYPES.fighter);
      for (const b in a.mixer.volumes) a.mixer.setVolume(b, 1);
    },
    frame: (a, t, dt) => {
      a.update(dt, flight({ rpm: 1, burner: 1, controls: THROTTLE(1), airspeed: 150, ias: 150, alpha: 0.4, gearPos: 1, flaps: 1, spoilerPos: 1, stalled: true, agl: 50, vs: -10 }), { cond: { turb: 1, rain: 1 }, windSpeedKts: 40, lightningFlash: 0 }, 0, false);
      if (Math.round(t * 30) === 45) {
        a.ambience.playThunder(0);
        a.ambience.playCrash();
        a.ambience.playSplash();
        a.ambience.playTouchdown(1, 'paved');
        a.ambience.playGear(true);
        a.alerts.fireBell();
        a.alerts.masterWarning();
        a.alerts.gpwsWarning();
      }
    },
  });
  let over = 0;
  let max = 0;
  for (const v of all.data) {
    const m = Math.abs(v);
    if (m > max) max = m;
    if (m >= 1) over++;
  }
  ok('everything at once, all sliders full: at or under 0 dBFS, no sample clipped', over === 0 && max < 1, `peak ${max.toFixed(4)}, ${over} over`);
  let voices = 0;
  await renderAudio({
    seconds: 0.3,
    frame: (a, t) => {
      if (t === 0) for (let i = 0; i < 60; i++) voices += a.mixer.noiseBurst({ duration: 0.2 }) ? 1 : 0;
    },
  });
  ok('sixty one-shots in one frame stop at the voice cap', voices === 24, String(voices));

  /* ---- the voices off duty ---- */
  const inUse = await renderAudio({ seconds: 0.2, setup: (a) => a.setEngineKind('jet') });
  ok('only the synth in use is on the graph', inUse.audio.engine.plugged === false && inUse.audio.jet.plugged === true);

  /* ---- the recorded layer ---- */
  say('sound-slots: the recorded layer');
  const { SoundSamples, MAX_FILE } = await import('../../src/features/sound-samples.js');
  const thump = wavUrl(0.4, (t) => 0.5 * Math.sin(2 * Math.PI * 330 * t) * Math.exp(-t * 6));
  const loopUrl = wavUrl(1, (t) => 0.4 * Math.sin(2 * Math.PI * 200 * t));
  const noFile = wavUrl(0.1, () => 0);
  URL.revokeObjectURL(noFile);
  const big = wavUrl(3, (t) => 0.1 * Math.sin(t * 900));
  const manifest = { slots: {
    'touchdown.paved': { file: thump, gain: 0.8 },
    'loop.cabin': { file: loopUrl, loop: true, end: 1 },
    gone: { file: noFile },
    huge: { file: big },
  } };
  const rec = await renderAudio({
    seconds: 1.4,
    setup: async (a) => {
      const s = new SoundSamples(a.mixer);
      await s.load({ manifest });
      a.mixer.samples = s;
      ok('a slot with a file loads, one with a dead file does not, one over the size limit does not', s.has('touchdown.paved') && s.has('loop.cabin') && !s.has('gone') && !s.has('huge'), `${big.length} ${MAX_FILE}`);
      only(a, ['environment']);
    },
    frame: (a, t) => {
      if (t > 0.1 && !a._played) {
        a._played = true;
        a.ambience.playTouchdown(0.5, 'paved');
      }
    },
  });
  const m = measure(rec.data, rec.rate, 0.1, 0.5);
  ok('a slot with a recording plays the recording, not the synth', Math.abs(parseInt(m.tones[0], 10) - 330) < 10 && m.peak > -24, JSON.stringify(m.tones));
  const synth = await shot((a) => {
    a.mixer.samples = new SoundSamples(a.mixer);
    a.ambience.playTouchdown(0.5, 'paved');
  });
  ok('a slot with no recording plays the synth', synth.peak > -30, `peak ${synth.peak}`);
  const loop = await renderAudio({
    seconds: 3,
    setup: async (a) => {
      const s = new SoundSamples(a.mixer);
      await s.load({ manifest: { slots: { 'loop.cabin': manifest.slots['loop.cabin'] } } });
      a.mixer.samples = s;
      only(a, ['environment']);
    },
    frame: (a) => a.mixer.samples.follow('loop.cabin', 0.8),
  });
  const lm = measure(loop.data, loop.rate, 1, 3);
  ok('a recorded loop plays and follows', lm.rms > -30, `rms ${lm.rms}`);
  let jump = 0;
  for (let i = loop.rate; i < loop.data.length - 1; i++) jump = Math.max(jump, Math.abs(loop.data[i + 1] - loop.data[i]));
  ok('...with no click at its seam', jump < 0.05, `largest step ${jump.toFixed(4)}`);

  /* ---- the live game ---- */
  say('sound-slots: the live game');
  const autoPause = sim.autoPauseOnHide;
  let restore = () => {};
  sim.autoPauseOnHide = false;
  try {
    const { AIRCRAFT } = await import('../../src/aircraft/types.js');
    const { engineFamily, FAMILIES } = await import('../../src/audio/profile.js');
    ok(`all ${AIRCRAFT.length} aircraft have a family`, AIRCRAFT.every((t) => FAMILIES[engineFamily(t)]));
    ok('the sound feature installed', !!sim.audio.fx);
    const fx = sim.audio.fx;
    const heardFx = { chime: 0, lever: 0, click: 0 };
    const real = { chime: fx.chime, lever: fx.lever, click: fx.click };
    for (const k in heardFx) fx[k] = () => heardFx[k]++;
    restore = () => Object.assign(fx, real);
    await sim.startMode('free', { aircraft: 'a320', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    sim.step(1);
    ok('no chime in the first second of a flight', heardFx.chime === 0, String(heardFx.chime));
    ok('the A320 runs the jet synth as a narrow-body', sim.audio.engineKind === 'jet' && sim.audio.family === 'narrow', sim.audio.family);
    const v = sim.audio.mixer.view;
    ok('in the follow view the listener is on the aeroplane', v.gain > 0.8 && v.pitch === 1, JSON.stringify(v));
    sim.rig.setMode('tower');
    sim.step(1);
    ok('from the tower it is far off and dull', v.gain < 0.5 && v.cut < 15000, JSON.stringify(v));
    sim.rig.setMode('chase');
    sim.step(1);
    ok('back in the follow view, as it was', v.gain > 0.8, JSON.stringify(v));

    {
      ok('the A320 is on the ground with its sign on', sim.aircraft.onGround);
      sim.rig.setMode('chase');
      sim.step(0.5);
      const before = heardFx.lever;
      sim.aircraft.setFlaps(1);
      sim.step(0.3);
      ok('no lever heard from outside', heardFx.lever === before, String(heardFx.lever));
      sim.rig.setMode('cockpit');
      sim.step(0.5);
      sim.aircraft.setFlaps(2);
      sim.step(0.3);
      ok('from the cockpit the flap lever is heard', heardFx.lever === before + 1, String(heardFx.lever));
      sim.aircraft.parkingBrake = !sim.aircraft.parkingBrake;
      sim.step(0.3);
      ok('...and a switch clicks', heardFx.click >= 1, String(heardFx.click));
      const n = heardFx.lever + heardFx.click;
      sim.step(2);
      ok('...once: an unchanged panel is silent', heardFx.lever + heardFx.click === n);
      sim.aircraft.controls.throttle = 0.5;
      sim.aircraft.engineOn || sim.aircraft.startEngine();
      sim.step(3);
      ok('the seatbelt sign chimes once as the engines come up', heardFx.chime === 1, String(heardFx.chime));
      sim.step(2);
      ok('...and not again on the ground', heardFx.chime === 1, String(heardFx.chime));
      sim.rig.setMode('chase');
    }
  } finally {
    restore();
    sim.autoPauseOnHide = autoPause;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      void e;
    }
  }
}

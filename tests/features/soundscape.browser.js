/**
 * The soundscape (src/features/soundscape*), rendered and measured. NOTHING IS
 * PLAYED: the game's own audio classes render into an OfflineAudioContext
 * (sound-lab.js) and only numbers are read; the live part runs muted, with
 * the mixer unplugged from the speakers as well.
 *
 *   node .claude/devtools/briefs/one-check.mjs <url>?mute=1 ./tests/features/soundscape.browser.js check "" 1
 */
import { renderAudio, measure, flight, CALM, TYPES } from './sound-lab.js';

export const id = 'soundscape';

const THROTTLE = (x) => ({ throttle: x, brakes: 0, yaw: 0 });
const GROUND = { onGround: true, gearDown: true, gearPos: 1, agl: 0 };
const only = (a, buses) => {
  for (const b of ['engine', 'environment', 'atc', 'alerts', 'music']) a.mixer.buses[b].gain.value = buses.includes(b) ? a.mixer.volumes[b] : 0;
};
const band = (m, i) => (m.bands ? m.bands[i] + m.rms : -180);
/** Energy (dB) between lo and hi Hz of data[from..to] s. */
async function bandDb(data, rate, from, to, lo, hi) {
  const { spectrum } = await import('./sound-lab.js');
  const N = 8192;
  const P = spectrum(data, rate, from, to, N);
  const hz = rate / N;
  let e = 0;
  for (let i = Math.ceil(lo / hz); i <= Math.floor(hi / hz); i++) e += P[i];
  return 10 * Math.log10(e + 1e-20);
}

/** The ear on the aeroplane (chase view), unless a scene says otherwise. */
const EAR = { inside: false, near: true, dist: 12, cos: -0.9, earAgl: 3, acAgl: 0, horiz: 12, surface: 'paved', voices: [], cars: { weight: 0 } };

async function scene({ family = 'narrow', ac, ear = {}, secs = 6, buses = ['engine'], weather = CALM, view = null, scape = true, lite = false, trace = null, fire = null, master = null }) {
  const { Soundscape } = await import('../../src/features/soundscape/layers.js');
  const { wrap } = await import('../../src/features/soundscape.js');
  const type = TYPES[family];
  const kind = family === 'rotor' ? 'rotor' : type.shape.power.kind;
  let S = null;
  const r = await renderAudio({
    seconds: secs,
    setup: (a) => {
      a.setEngineKind(kind);
      if (type) a.setProfile(type);
      a.setInterior(!!ear.inside);
      if (view) Object.assign(a.mixer.view, view);
      only(a, buses);
      // Under the limiter's knee, for a check comparing levels: the limiter would otherwise even them out.
      if (master != null) a.mixer.master.gain.value = master;
      if (scape) {
        S = new Soundscape(a, { lite });
        wrap(a, S);
        S.build();
      }
    },
    frame: (a, t, dt) => {
      const f = flight(typeof ac === 'function' ? ac(t) : ac);
      const e = typeof ear === 'function' ? ear(t) : ear;
      // After a hush the game is in its menus: GameAudio is told to be quiet and no feature updates.
      const quiet = !!a._menu;
      a.update(dt, f, weather, e.cloud || 0, quiet);
      if (S && !quiet) S.update(dt, { ...EAR, ...e, ac: f, weather });
      if (fire) fire(a, S, t, dt);
      if (trace) trace(a, S, t);
    },
  });
  return { ...r, S };
}

export async function check(sim, r, say = () => {}) {
  const ok = (name, pass, detail = '') => r.ok(`soundscape: ${name}`, !!pass, `${name}: ${detail}`);

  /* ---- every family: louder at power, still muffled in the cockpit, never clipping ---- */
  say('soundscape: engines');
  for (const family of ['piston', 'turboprop', 'regional', 'narrow', 'wide', 'fighter', 'turbojet', 'highbypass']) {
    const outside = { inside: false, near: false, dist: 90, cos: 0, horiz: 90, acAgl: 0 };
    const idle = await scene({ family, ac: { rpm: 0.18, ...GROUND }, ear: outside, secs: 6 });
    const full = await scene({ family, ac: { rpm: 1, controls: THROTTLE(1), ...GROUND }, ear: outside, secs: 12 });
    const withL = await scene({ family, ac: { rpm: 1, controls: THROTTLE(1), ...GROUND }, ear: outside, secs: 12, master: 0.2 });
    const base = await scene({ family, ac: { rpm: 1, controls: THROTTLE(1), ...GROUND }, ear: outside, secs: 12, scape: false, master: 0.2 });
    const mi = measure(idle.data, idle.rate, 3, 6);
    const mf = measure(full.data, full.rate, 9, 12);
    const mb = measure(base.data, base.rate, 9, 12);
    const mw = measure(withL.data, withL.rate, 9, 12);
    ok(`${family}: does not clip at full power`, mf.peak < 0, `peak ${mf.peak} dBFS`);
    ok(`${family}: full power is still at least 8 dB over idle on a speaker`, mf.speaker - mi.speaker >= 8, `${mi.speaker} to ${mf.speaker}`);
    // What the layers add: measurable, not a takeover (0.3 to 6 dB on the whole).
    // Heard: some band of the spectrum moves by 2 dB or more. Not drowning it: the whole is up by less than 6.
    const add = +(mw.rms - mb.rms).toFixed(2);
    const up = mw.bands.map((v, i) => +(v + mw.rms - (mb.bands[i] + mb.rms)).toFixed(1));
    ok(`${family}: the new layers are heard over the first-load synth, without drowning it`, Math.max(...up) >= 2 && add < 6, `bands up ${JSON.stringify(up)} dB (20-100 … 8k-20k Hz), whole +${add} dB, under the limiter`);
    const inCab = await scene({ family, ac: { rpm: 0.65, controls: THROTTLE(0.65), airspeed: 100, ias: 100 }, ear: { inside: true, near: true, dist: 1 }, secs: 8 });
    const outCab = await scene({ family, ac: { rpm: 0.65, controls: THROTTLE(0.65), airspeed: 100, ias: 100 }, ear: { inside: false, near: true, dist: 12 }, secs: 8 });
    const mc = measure(inCab.data, inCab.rate, 5, 8);
    const mo = measure(outCab.data, outCab.rate, 5, 8);
    ok(`${family}: the cockpit stays duller and quieter than outside`, mc.centroid < mo.centroid * 0.8 && mc.speaker < mo.speaker - 1.5, `${mo.centroid} Hz/${mo.speaker} out, ${mc.centroid} Hz/${mc.speaker} in`);
  }

  /* ---- piston: the tips at take-off power, the bark ---- */
  {
    const L = {};
    await scene({ family: 'piston', ac: (t) => (t < 4 ? { rpm: 0.18, ...GROUND } : { rpm: 1, controls: THROTTLE(1), ...GROUND }), ear: { near: false, dist: 80, cos: 0 }, secs: 8, trace: (a, S, t) => {
      if (Math.abs(t - 3.9) < 0.02) L.idle = S.levels();
      if (Math.abs(t - 7.9) < 0.02) L.full = S.levels();
    } });
    ok('piston: the propeller tips rasp at take-off power, not at idle', L.full.tip > 0.1 && L.full.tip > L.idle.tip * 20, `tip ${L.idle.tip} idle, ${L.full.tip} full`);
    ok('piston: the exhaust barks harder with power', L.full.bark > L.idle.bark * 1.5, `bark ${L.idle.bark} to ${L.full.bark}`);
    const beside = await scene({ family: 'piston', ac: { rpm: 1, controls: THROTTLE(1), ...GROUND }, ear: { near: false, dist: 80, cos: 0 }, secs: 6, master: 0.2 });
    const behind = await scene({ family: 'piston', ac: { rpm: 1, controls: THROTTLE(1), ...GROUND }, ear: { near: false, dist: 80, cos: -1 }, secs: 6, master: 0.2 });
    const pb = await bandDb(beside.data, beside.rate, 3, 6, 1000, 3000);
    const ph = await bandDb(behind.data, behind.rate, 3, 6, 1000, 3000);
    ok('piston: the propeller is loudest abeam (in the plane of the blades)', pb > ph + 1.5, `1-3 kHz: ${pb.toFixed(1)} abeam, ${ph.toFixed(1)} behind`);
    let pops = 0;
    const real = { burst: null };
    await scene({ family: 'piston', ac: (t) => ({ rpm: t < 3 ? 0.95 : 0.6, controls: THROTTLE(t < 3 ? 1 : 0.1) }), ear: { near: false, dist: 40, cos: -0.5 }, secs: 5, fire: (a, S) => {
      if (!real.burst) {
        real.burst = S.burst.bind(S);
        S.burst = (o) => {
          if (o && o.bus === 'engine') pops++;
          return real.burst(o);
        };
      }
    } });
    ok('piston: the exhaust pops when the throttle is chopped at high rpm', pops >= 3 && pops <= 20, `${pops} pops`);
  }

  /* ---- turboprop: Ng lags, the twin's beat wanders ---- */
  {
    const tr = [];
    await scene({ family: 'turboprop', ac: (t) => ({ rpm: t < 1 ? 0.18 : 1, controls: THROTTLE(t < 1 ? 0 : 1) }), secs: 10, trace: (a, S, t) => tr.push([t, S.ng]) });
    const at = (x) => tr.reduce((p, q) => (Math.abs(q[0] - x) < Math.abs(p[0] - x) ? q : p))[1];
    ok('turboprop: the gas generator lags the lever (Ng on its own spool)', at(2) < 0.85 && at(9.5) > 0.97, `Ng ${at(2).toFixed(2)} after 1 s, ${at(9.5).toFixed(2)} after 8.5 s`);
    const one = await scene({ family: 'turboprop', ac: { rpm: 0.8, controls: THROTTLE(0.8) }, ear: { inside: true, near: true, dist: 1 }, secs: 9 });
    ok('turboprop: the twin beat is on', one.S.levels().beat > 0.02, `beat ${one.S.levels().beat}`);
  }

  /* ---- turbofan: N2 leads N1, ahead whines, behind roars ---- */
  {
    let lead = 0;
    await scene({ family: 'narrow', ac: (t) => ({ rpm: t < 0.5 ? 0.2 : 1 }), secs: 4, trace: (a, S, t) => {
      if (t > 0.5 && t < 3.5) lead = Math.max(lead, S.n2 - a.jet.n1);
    } });
    ok('turbofan: the core (N2) leads the fan (N1) on a spool-up', lead > 0.1, `largest lead ${lead.toFixed(3)}`);
    const ear = (cos) => ({ near: false, dist: 150, cos, horiz: 150, acAgl: 0 });
    const ahead = await scene({ family: 'narrow', ac: { rpm: 0.9, controls: THROTTLE(0.9), ...GROUND }, ear: ear(1), secs: 8 });
    const astern = await scene({ family: 'narrow', ac: { rpm: 0.9, controls: THROTTLE(0.9), ...GROUND }, ear: ear(-1), secs: 8 });
    const ma = measure(ahead.data, ahead.rate, 5, 8);
    const ms = measure(astern.data, astern.rate, 5, 8);
    ok('turbofan: ahead it is the fan\'s whine (brighter), behind the roar (darker)', ma.centroid > ms.centroid * 1.2, `${ma.centroid} Hz ahead, ${ms.centroid} Hz behind`);
    ok('turbofan: behind, the low roar is louder', band(ms, 0) > band(ma, 0) + 2, `20-100 Hz: ${band(ma, 0).toFixed(1)} ahead, ${band(ms, 0).toFixed(1)} behind`);
    const L = astern.S.levels();
    ok('turbofan: the crackle is on behind a big engine near full power, outside', L.on.crack && L.crackle > 0.05, `crackle ${L.crackle}`);
    const cab = await scene({ family: 'narrow', ac: { rpm: 0.9, controls: THROTTLE(0.9) }, ear: { inside: true, near: true }, secs: 3 });
    ok('turbofan: no crackle and no reverb in the cockpit', !cab.S.levels().on.crack && cab.S.levels().send === 0, JSON.stringify({ crack: cab.S.levels().on.crack, send: cab.S.levels().send }));
  }

  /* ---- the space: reverb far off, the ground's echo on a fly-over ---- */
  {
    say('soundscape: the space');
    const tail = async (lite) => {
      const s = await scene({ family: 'narrow', ac: { rpm: 0 }, ear: { near: false, dist: 700, earAgl: 2 }, buses: ['environment'], secs: 3, lite, fire: (a, S, t) => {
        if (Math.abs(t - 1.0) < 0.017) {
          S.burst({ freq: 800, q: 0.7, dur: 0.08, gain: 0.5 });
        }
      } });
      return measure(s.data, s.rate, 1.4, 2.2).rms;
    };
    const wet = await tail(false);
    const dry = await tail(true);
    ok('reverb: a short sound far off leaves a tail', wet > dry + 8, `0.3-1.1 s after: ${wet} dB with, ${dry} dB on Low (no reverb)`);
    const { groundEcho } = await import('../../src/features/soundscape/maths.js');
    const over = { near: false, dist: 58, horiz: 0, acAgl: 60, earAgl: 1.7, surface: 'paved', cos: 0 };
    const want = groundEcho(0, 60, 1.7, 'paved');
    const e = await scene({ family: 'narrow', ac: { rpm: 0.9, controls: THROTTLE(0.9) }, ear: over, secs: 6 });
    const L = e.S.levels();
    ok('ground echo: right overhead the delay is the path difference', Math.abs(L.echoDelay - want.delay) < 0.0005 && L.echo > 0.3, `${L.echoDelay} s (want ${want.delay}), level ${L.echo}`);
    const noEcho = await scene({ family: 'narrow', ac: { rpm: 0.9, controls: THROTTLE(0.9) }, ear: over, secs: 6, lite: true });
    // The comb: at 1/(2·delay) and its odd multiples the echo cancels, at 1/delay it adds.
    const f0 = 1 / want.delay;
    const notch = async (d) => (await bandDb(d.data, d.rate, 3, 6, f0 * 1.5 - 6, f0 * 1.5 + 6)) - (await bandDb(d.data, d.rate, 3, 6, f0 * 2 - 6, f0 * 2 + 6));
    const nE = await notch(e);
    const nD = await notch(noEcho);
    ok('ground echo: it combs the sound (a notch at 1.5/delay against the peak at 2/delay)', nE < nD - 4, `notch-to-peak ${nE.toFixed(1)} dB with the echo, ${nD.toFixed(1)} without (${f0.toFixed(0)} Hz)`);
    const inCab = await scene({ family: 'narrow', ac: { rpm: 0.9 }, ear: { ...over, inside: true, near: true }, secs: 2 });
    ok('ground echo and reverb: none in the cockpit', inCab.S.levels().echo === 0 && inCab.S.levels().send === 0, JSON.stringify(inCab.S.levels().echo));
  }

  /* ---- the air on the airframe ---- */
  {
    say('soundscape: the air');
    const w = async (kt, beta = 0, scape = true) => {
      const s = await scene({ family: 'narrow', ac: { rpm: 0, engineOn: false, airspeed: kt / 1.944, ias: kt / 1.944, beta }, ear: { inside: true, near: true }, buses: ['environment'], secs: 4, scape });
      return { m: measure(s.data, s.rate, 2, 4), air: s.S ? s.S.levels().air : 0, s };
    };
    const slow = await w(80);
    const fast = await w(250);
    const slip = await w(250, 0.2);
    const base = await w(250, 0, false);
    ok('air: the airframe rumble rises with speed', fast.air > slow.air * 4, `${slow.air} at 80 kt, ${fast.air} at 250`);
    ok('air: a sideslip makes it louder', slip.air > fast.air * 1.4, `${fast.air} straight, ${slip.air} at 0.2 rad slip`);
    ok('air: in the cockpit at 250 kt the rumble is heard under 100 Hz', band(fast.m, 0) > band(base.m, 0) + 3, `20-100 Hz: ${band(base.m, 0).toFixed(1)} first-load, ${band(fast.m, 0).toFixed(1)} with`);
  }

  /* ---- tyres and brakes ---- */
  {
    const sc = await scene({ family: 'narrow', ac: { rpm: 0.2, ...GROUND, groundSpeed: 25, sideScrub: 5 }, buses: ['environment'], secs: 2 });
    const gr = await scene({ family: 'narrow', ac: { rpm: 0.2, ...GROUND, groundSpeed: 6, controls: { throttle: 0, brakes: 1, yaw: 0 } }, buses: ['environment'], secs: 2 });
    const no = await scene({ family: 'narrow', ac: { rpm: 0.2, ...GROUND, groundSpeed: 25 }, buses: ['environment'], secs: 2 });
    ok('tyres: they squeal scrubbing sideways, not rolling straight', sc.S.levels().squeal > 0.05 && no.S.levels().squeal === 0, `${sc.S.levels().squeal} scrubbing, ${no.S.levels().squeal} straight`);
    ok('brakes: they groan in the last of the roll', gr.S.levels().groan > 0.01 && no.S.levels().groan === 0, `${gr.S.levels().groan} braking at 6 m/s`);
  }

  /* ---- touchdown, gear, flaps ---- */
  {
    say('soundscape: one-shots');
    const td = async (impact, gs) => {
      let done = false;
      const s = await scene({ family: 'narrow', ac: { rpm: 0.2, ...GROUND, groundSpeed: gs }, buses: ['environment'], secs: 2, fire: (a, S, t) => {
        if (!done && t > 0.3) {
          done = true;
          a.ambience.playTouchdown(impact, 'paved');
        }
      } });
      return { low: await bandDb(s.data, s.rate, 0.25, 1.0, 30, 100), m: measure(s.data, s.rate, 0.25, 1.5) };
    };
    const soft = await td(0.15, 60);
    const hard = await td(0.9, 60);
    ok('touchdown: the struts thump harder with the sink rate', hard.low > soft.low + 6, `30-100 Hz ${soft.low.toFixed(1)} soft, ${hard.low.toFixed(1)} hard`);
    ok('touchdown: no clip on the hardest', hard.m.peak < 0, `peak ${hard.m.peak}`);
    const { touchdownExtra } = await import('../../src/features/soundscape/maths.js');
    ok('touchdown: the tyres scrub more spinning up at speed', touchdownExtra(0.5, 70, 0).scrub > touchdownExtra(0.5, 15, 0).scrub * 3, JSON.stringify([touchdownExtra(0.5, 15, 0), touchdownExtra(0.5, 70, 0)]));
    const shots = {
      'gear down (airliner)': ['wide', (a) => a.ambience.playGear(true)],
      'gear up (light)': ['piston', (a) => a.ambience.playGear(false)],
      'flaps (airliner)': ['narrow', (a) => a.ambience.playFlaps()],
      'flaps (light)': ['piston', (a) => a.ambience.playFlaps()],
      'thunder, close': ['narrow', (a) => a.ambience.playThunder(0.05)],
      'thunder, far': ['narrow', (a) => a.ambience.playThunder(0.95)],
      'thunder, no argument (a disaster)': ['narrow', (a) => a.ambience.playThunder()],
      'trim tick': ['piston', (a, S) => S.tick()],
    };
    const got = {};
    for (const name of Object.keys(shots)) {
      const [family, fn] = shots[name];
      let done = false;
      const s = await scene({ family, ac: { rpm: 0 }, buses: ['environment', 'alerts', 'engine'], secs: 5, fire: (a, S, t) => {
        if (!done && t >= 0.1) {
          done = true;
          fn(a, S);
        }
      } });
      const m = measure(s.data, s.rate, 0, 5);
      got[name] = { m, late: measure(s.data, s.rate, 2.0, 2.6).rms, s };
      ok(`${name}: heard`, m.peak > -36, `peak ${m.peak}`);
      ok(`${name}: does not clip`, m.peak < 0, `peak ${m.peak}`);
    }
    const g = got['gear down (airliner)'].s;
    // Under the pump's own note (105 Hz and up): the doors and the lock are felt, not heard.
    const door = await bandDb(g.data, g.rate, 2.12, 2.5, 30, 90);
    const mid = await bandDb(g.data, g.rate, 1.2, 1.58, 30, 90);
    ok('gear (airliner): the doors and the lock thud at the end of the travel', door > mid + 6, `30-90 Hz: ${mid.toFixed(1)} mid-travel, ${door.toFixed(1)} at the lock`);
    ok('thunder: it rolls on for seconds', got['thunder, far'].late > -60, `${got['thunder, far'].late} dB at 2 s`);
    const cl = got['thunder, close'].m;
    const fr = got['thunder, far'].m;
    ok('thunder: a close strike cracks (more top), a far one only rumbles', cl.bands[4] > fr.bands[4] + 6, `3-8 kHz share ${fr.bands[4]} far, ${cl.bands[4]} close`);
  }

  /* ---- rain and hail ---- */
  {
    say('soundscape: rain and hail');
    const { clickGain, rainRate, hailLevel } = await import('../../src/features/soundscape/maths.js');
    // The click maths on the real Web Audio graph: count the hits.
    const want = 300;
    const ctx = new OfflineAudioContext(1, 44100 * 2, 44100);
    const src = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, 44100 * 2, 44100);
    const d = nb.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    src.buffer = nb;
    const pre = ctx.createGain();
    pre.gain.value = clickGain(want, 44100);
    const { Soundscape } = await import('../../src/features/soundscape/layers.js');
    void Soundscape;
    const sh = ctx.createWaveShaper();
    const n = 16385;
    const c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.abs(x) > 0.99 ? Math.sign(x) * ((Math.abs(x) - 0.99) / 0.01) : 0;
    }
    sh.curve = c;
    src.connect(pre);
    pre.connect(sh);
    sh.connect(ctx.destination);
    src.start();
    const out = (await ctx.startRendering()).getChannelData(0);
    let hits = 0;
    for (let i = 0; i < out.length; i++) if (out[i] !== 0) hits++;
    ok('rain: the drop rate on the graph is the rate asked for', Math.abs(hits / 2 - want) < want * 0.2, `${hits / 2} hits/s for ${want}`);
    ok('rain: more drops when wetter, faster, and on the windscreen', rainRate(1, 120, true) > rainRate(1, 0, true) && rainRate(1, 0, true) > rainRate(0.3, 0, true) && rainRate(1, 0, true) > rainRate(1, 0, false), `${rainRate(0.3, 0, true)} ${rainRate(1, 0, true)} ${rainRate(1, 120, true)} in, ${rainRate(1, 0, false)} out`);
    const storm = { storm: 1, cb: 1, rain: 1, turb: 1 };
    ok('hail: only out of a storm, in shafts, never on snow', hailLevel(storm, 0.95) > 0.5 && hailLevel(storm, 0.2) === 0 && hailLevel({ rain: 1, turb: 0.5 }, 1) === 0 && hailLevel(storm, 1, 0, true) === 0, `${hailLevel(storm, 0.95)} in a shaft, ${hailLevel(storm, 0.2)} between`);
    const RAIN = { cond: { turb: 0, rain: 1 }, windSpeedKts: 0, lightningFlash: 0 };
    const wetIn = await scene({ family: 'piston', ac: { rpm: 0, engineOn: false, airspeed: 40, ias: 40 }, ear: { inside: true, near: true }, buses: ['environment'], secs: 3, weather: RAIN });
    const dryIn = await scene({ family: 'piston', ac: { rpm: 0, engineOn: false, airspeed: 40, ias: 40 }, ear: { inside: true, near: true }, buses: ['environment'], secs: 3, weather: RAIN, scape: false });
    const mw = measure(wetIn.data, wetIn.rate, 1.5, 3);
    const md = measure(dryIn.data, dryIn.rate, 1.5, 3);
    ok('rain: from the cockpit the drops are heard as hits (crest factor up)', mw.crest > md.crest + 3 && mw.peak < 0, `crest ${md.crest} hiss only, ${mw.crest} with drops; peak ${mw.peak}`);
    const firstLoad = 1 * 0.16 * (1 + 40 / 60) * 0.8;
    ok('rain: the first-load hiss is turned down while the drops play', wetIn.S.ducked && wetIn.S.ducked.hiss < firstLoad * 0.6 && wetIn.S.ducked.hiss > 0, `${JSON.stringify(wetIn.S.ducked)} against ${firstLoad.toFixed(3)} first-load`);
    const STORM = { cond: { turb: 1, rain: 1, storm: 1, cb: 1 }, windSpeedKts: 20, lightningFlash: 0 };
    const hail = await scene({ family: 'piston', ac: { rpm: 0, engineOn: false, airspeed: 40, ias: 40 }, ear: { inside: true, near: true, cloud: 1 }, buses: ['environment'], secs: 3, weather: STORM });
    const mh = measure(hail.data, hail.rate, 1.5, 3);
    // Stones are heavier than drops: the body of each hit, 400-2,000 Hz, is where hail is heard over rain.
    const bh = await bandDb(hail.data, hail.rate, 1.5, 3, 400, 2000);
    const br = await bandDb(wetIn.data, wetIn.rate, 1.5, 3, 400, 2000);
    ok('hail: heard in the storm\'s core, heavier than rain, not clipping', hail.S.hail > 0.5 && bh > br + 3 && mh.peak < 0, `hail ${hail.S.hail}; 400-2000 Hz ${br.toFixed(1)} rain, ${bh.toFixed(1)} hail; peak ${mh.peak}`);
    const snow = await scene({ family: 'piston', ac: { rpm: 0, engineOn: false }, ear: { inside: true, near: true, snow: true, cloud: 1 }, buses: ['environment'], secs: 2, weather: STORM });
    ok('snow maps: no drops, no hail', snow.S.levels().rain === 0 && snow.S.hail === 0 && !snow.S.levels().on.wet, JSON.stringify(snow.S.levels().on));
  }

  /* ---- the cockpit ---- */
  {
    say('soundscape: the cockpit');
    const tone = (m, f, tol = 12) => (m.tones || []).some((s) => Math.abs(parseInt(s, 10) - f) <= tol);
    const air = await scene({ family: 'narrow', ac: { rpm: 0.2, engineOn: true, ...GROUND }, ear: { inside: true, near: true }, buses: ['environment'], secs: 3 });
    const ma = measure(air.data, air.rate, 1.5, 3);
    ok('cockpit (airliner): the 400 Hz avionics power is a tone', tone(ma, 400), JSON.stringify(ma.tones));
    const ga = await scene({ family: 'piston', ac: { rpm: 0.2, engineOn: true, ...GROUND }, ear: { inside: true, near: true }, buses: ['environment'], secs: 16 });
    const mg = measure(ga.data, ga.rate, 13, 16);
    ok('cockpit (light aircraft): the gyros spin up to a whine', ga.S.gyro > 0.9 && tone(mg, Math.round(30 + 1870 * (1 - Math.exp(-0.18 * 14.5))), 25), `gyro ${ga.S.gyro.toFixed(2)} (a tone near ${Math.round(30 + 1870 * (1 - Math.exp(-0.18 * 14.5)))} Hz mid-window), ${JSON.stringify(mg.tones)}`);
    const out = await scene({ family: 'narrow', ac: { rpm: 0.2, engineOn: true, ...GROUND }, ear: { inside: false, near: true }, buses: ['environment'], secs: 2 });
    ok('cockpit: none of it outside', !out.S.levels().on.cab, JSON.stringify(out.S.levels().on));
  }

  /* ---- the others ---- */
  {
    say('soundscape: other aircraft and cars');
    const voice = (d, rate, kind = 'jet') => ({ voices: [{ key: 'npc', kind, d, rate }] });
    const lv = async (e) => (await scene({ family: 'piston', ac: { rpm: 0 }, ear: { near: true, ...e }, buses: ['environment'], secs: 2 })).S.levels().voices[0];
    const near200 = await lv(voice(200, 0));
    const far1200 = await lv(voice(1200, 0));
    ok('others: an aircraft 200 m off is far louder than one at 1,200 m', near200 > far1200 * 6, `${near200} at 200 m, ${far1200} at 1,200 m`);
    const tn = async (rate) => {
      const s = await scene({ family: 'piston', ac: { rpm: 0 }, ear: { near: true, ...voice(150, rate) }, buses: ['environment'], secs: 3 });
      const m = measure(s.data, s.rate, 1.5, 3);
      const t = (m.tones || []).map((x) => parseInt(x, 10)).filter((x) => x > 1000)[0] || 0;
      return t;
    };
    const coming = await tn(-80);
    const going = await tn(80);
    ok('others: doppler, the jet\'s whine falls as it goes by', coming / going > 1.45 && coming / going < 1.75, `${coming} Hz coming, ${going} Hz going`);
    const heli = await scene({ family: 'piston', ac: { rpm: 0 }, ear: { near: true, ...voice(120, 0, 'rotor') }, buses: ['environment'], secs: 7 });
    const { beat } = await import('./sound-lab.js');
    const hb = beat(heli.data, heli.rate, 1.5, 7);
    ok('others: a helicopter is heard by its blade slap', Math.abs(hb.hz - 19) < 2.5, `beat ${hb.hz} Hz, depth ${hb.depth}`);
    const { carBed } = await import('../../src/features/soundscape/maths.js');
    const cars = [{ px: 10, pz: 0, speed: 12 }, { px: 30, pz: 5, speed: 14 }, { px: 15, pz: -8, speed: 0, parked: true }];
    const bed = carBed(cars, 0, 0);
    ok('cars: moving cars round you make a bed; parked ones add nothing', bed.weight > 0.3 && carBed([cars[2]], 0, 0).weight === 0, JSON.stringify(bed));
    const town = await scene({ family: 'piston', ac: { rpm: 0 }, ear: { near: true, cars: bed }, buses: ['environment'], secs: 2 });
    ok('cars: the bed is on the graph and heard', town.S.levels().road > 0.02 && measure(town.data, town.rate, 1, 2).rms > -60, `road ${town.S.levels().road}`);
    const lite = await scene({ family: 'piston', ac: { rpm: 0 }, ear: { near: true, cars: bed, ...voice(200, 0) }, buses: ['environment'], secs: 1, lite: true });
    ok('Low: no other traffic, no reverb (lite)', !lite.S.voices.length && !lite.S.road && !lite.S.verb, '');
  }

  /* ---- parked is silent; everything at once does not clip ---- */
  {
    const base = await scene({ family: 'narrow', ac: { rpm: 0.7, controls: THROTTLE(0.7) }, secs: 4, scape: false });
    const parked = await scene({ family: 'narrow', ac: { rpm: 0.7, controls: THROTTLE(0.7) }, secs: 4, fire: (a, S, t) => {
      if (t === 0) S.park();
    } });
    const mb = measure(base.data, base.rate, 2, 4);
    const mp = measure(parked.data, parked.rate, 2, 4);
    ok('parked (muted): the soundscape adds nothing', Math.abs(mb.rms - mp.rms) < 0.3 && parked.S.parked, `${mb.rms} first-load, ${mp.rms} parked`);
    const hushed = await scene({ family: 'narrow', ac: { rpm: 0.7, controls: THROTTLE(0.7), airspeed: 120, ias: 120 }, ear: { near: false, dist: 300 }, buses: ['engine', 'environment'], secs: 3, weather: { cond: { turb: 1, rain: 1, storm: 1, cb: 1 }, windSpeedKts: 10, lightningFlash: 0 }, fire: (a, S, t) => {
      if (Math.abs(t - 1.5) < 0.017) {
        a._menu = true;
        a.hush();
      }
    } });
    const L = hushed.S.levels();
    ok('the menus: hush takes the soundscape down too', L.engOut === 0 || L.engOut < 0.001, JSON.stringify({ engOut: L.engOut }));
    const all = await scene({
      family: 'fighter',
      ac: { rpm: 1, burner: 1, controls: THROTTLE(1), airspeed: 150, ias: 150, alpha: 0.4, beta: 0.2, gearPos: 1, flaps: 1, spoilerPos: 1, stalled: true, agl: 50, vs: -10, onGround: false, sideScrub: 6 },
      ear: { near: false, dist: 200, cos: -1, horiz: 100, acAgl: 50, earAgl: 2, cloud: 1, voices: [{ key: 'a', kind: 'jet', d: 90, rate: -100 }, { key: 'b', kind: 'rotor', d: 70, rate: 0 }], cars: { weight: 6 } },
      buses: ['engine', 'environment', 'alerts', 'atc', 'music'],
      secs: 7,
      weather: { cond: { turb: 1, rain: 1, storm: 1, cb: 1 }, windSpeedKts: 40, lightningFlash: 0 },
      fire: (a, S, t) => {
        if (Math.round(t * 30) === 45) {
          for (const b in a.mixer.volumes) a.mixer.setVolume(b, 1);
          a.ambience.playThunder(0);
          a.ambience.playCrash();
          a.ambience.playTouchdown(1, 'paved');
          a.ambience.playGear(true);
          a.ambience.playFlaps();
          a.alerts.masterWarning();
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
    ok('everything at once, all sliders full: no sample clipped', over === 0 && max < 1, `peak ${max.toFixed(4)}`);
    // The cost: render time with and without, the same scene, interleaved three times (the best of each: other builders share the CPU).
    const best = { base: Infinity, full: Infinity, lite: Infinity };
    for (let i = 0; i < 3; i++) {
      for (const k of ['base', 'full', 'lite']) {
        const ms = (await scene({ family: 'narrow', ac: { rpm: 0.7 }, ear: { near: false, dist: 300 }, secs: 6, scape: k !== 'base', lite: k === 'lite' })).ms;
        best[k] = Math.min(best[k], ms);
      }
    }
    ok('cost: 6 s of sound renders in under a second with the soundscape (Low cheaper)', best.full < 1000 && best.lite <= best.full * 1.05, `${best.base.toFixed(0)} ms first-load, ${best.full.toFixed(0)} ms with, ${best.lite.toFixed(0)} ms Low`);
  }

  /* ---- the live game, muted all the way ---- */
  say('soundscape: the live game');
  const mx = sim.audio && sim.audio.mixer;
  const autoPause = sim.autoPauseOnHide;
  sim.autoPauseOnHide = false;
  let unplugged = false;
  const scape = sim.audio && sim.audio.scape;
  try {
    ok('installed on the game\'s audio', !!scape && sim.audio.ambience.playTouchdown.__scape && sim.audio.ambience.playThunder.__scape, '');
    ok('sound still starts muted', sim.settings.muted === true, String(sim.settings.muted));
    if (!scape) return;
    // Belt and braces: the mixer's output off the speakers for the whole check, before anything starts.
    const unplug = () => {
      if (!unplugged && mx && mx.ctx && mx.limiter) {
        mx.limiter.disconnect();
        unplugged = true;
      }
    };
    unplug();
    // As the game's own unlock does it (main.js unlockAudio): the master made silent before the context exists.
    sim.audio.setMuted(true);
    if (!sim.audio.available) await sim.audio.start();
    sim.audio.setMuted(true);
    unplug();
    await sim.startMode('free', { aircraft: 'a320', time: 'day', condition: 'clear', windSpeedKts: 0, windDirDeg: 90 });
    sim.step(1);
    ok('muted: nothing of it built or plugged in', !scape.built || scape.parked, JSON.stringify({ built: scape.built, parked: scape.parked }));
    scape.hold = true;
    sim.aircraft.engineOn || sim.aircraft.startEngine();
    sim.input.throttleTarget = 0;
    sim.rig.setMode('chase');
    sim.step(3);
    const L0 = scape.levels();
    sim.input.throttleTarget = 0.9;
    sim.step(6);
    const L1 = scape.levels();
    ok('held (still muted): built and following the throttle', L1 && !L1.parked && L1.engOut > 0.2 && L1.core > L0.core && L1.n2 > L0.n2 + 0.2 && L1.rumble > L0.rumble, JSON.stringify({ engOut: L1 && L1.engOut, core: [L0 && L0.core, L1 && L1.core], n2: [L0 && L0.n2, L1 && L1.n2], rpm: +sim.aircraft.rpm.toFixed(2) }));
    sim.rig.setMode('tower');
    sim.step(1.5);
    const L2 = scape.levels();
    ok('from the tower: the reverb takes some, the aspect weighs the parts', L2.send > 0.06 && (L2.front !== 1 || L2.rear !== 1), JSON.stringify({ send: L2.send, front: L2.front, rear: L2.rear, echo: L2.echo, delay: L2.echoDelay }));
    sim.rig.setMode('cockpit');
    sim.step(1.5);
    const L3 = scape.levels();
    ok('from the cockpit: no reverb, the avionics on', L3.send < 0.01 && L3.on.cab && L3.hum > 0, JSON.stringify({ send: L3.send, cab: L3.on.cab, hum: L3.hum }));
    ok('still muted the whole time, and off the speakers', mx.muted === true && sim.settings.muted === true && (mx.master.gain.value === 0 || unplugged), JSON.stringify({ muted: mx.muted, master: mx.master.gain.value, unplugged }));
    // What a frame costs on the main thread, held against parked (the same flight, interleaved).
    const per = { held: Infinity, parked: Infinity };
    for (let i = 0; i < 3; i++) {
      for (const k of ['parked', 'held']) {
        scape.hold = k === 'held';
        sim.step(0.3);
        const t0 = performance.now();
        sim.step(2);
        per[k] = Math.min(per[k], (performance.now() - t0) / 120);
      }
    }
    scape.hold = true;
    ok('cost: a frame of the live game with it costs well under a millisecond more', per.held - per.parked < 0.8, `${per.parked.toFixed(2)} ms parked, ${per.held.toFixed(2)} ms held (a stepped frame, whole game)`);
    scape.hold = false;
    sim.input.throttleTarget = 0;
    sim.step(0.5);
    ok('let go: parked again while muted', scape.parked, String(scape.parked));
    sim.rig.setMode('chase');
  } finally {
    if (scape) scape.hold = false;
    sim.autoPauseOnHide = autoPause;
    try {
      sim.quitToMenu('main');
    } catch (e) {
      void e;
    }
    if (unplugged) {
      try {
        mx.limiter.connect(mx.ceiling);
      } catch (e) {
        void e;
      }
    }
  }
}

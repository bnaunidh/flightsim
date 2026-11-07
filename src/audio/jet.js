/**
 * Turbofans and fast jets, synthesised, a family each (profile.js).
 *
 *   fan        the blade-pass tone, climbing an octave and more with N1, with a
 *              second engine's a hair away so a twin slowly beats
 *   buzzsaw    at take-off power the fan's tips go supersonic and the shock off
 *              each uneven blade makes a comb of tones at the SHAFT rate: the
 *              rasp from in front of a big fan. Wide bodies have most of it.
 *   compressor the core's whine, well above the fan
 *   core       low roar, always there once it runs
 *   exhaust    pink, not white: at full power it is most of what you hear, and
 *              a white-noise jet is a hiss. Fluttered by slow noise, because a
 *              jet's roar is turbulence and never stands still.
 *   burner     the reheat's rumble and crackle (ac.burner); a pure turbojet
 *              crackles a little at high power without any.
 *
 * What makes it a jet is spool time: the sound arrives seconds after the
 * throttle, and how many seconds is the family's. A 777 takes twice an F-16's.
 */

import { clamp, lerp } from '../core/noise.js';
import { FAMILIES, partials } from './profile.js';
import { pulseCurve } from './vehicles.js';

export class JetSound {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.running = false;
    /** Simulated spool position, which lags the commanded rpm. */
    this.n1 = 0;
    this.family = FAMILIES.narrow;
    this.engines = 2;
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 0;

    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 5200;
    this.tone.Q.value = 0.5;
    this.out.connect(this.tone);
    this.tone.connect(m.bus('engine'));

    const band = (f, q) => {
      const b = ctx.createBiquadFilter();
      b.type = 'bandpass';
      b.frequency.value = f;
      b.Q.value = q;
      return b;
    };
    const level = (into = this.out) => {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(into);
      return g;
    };

    // --- Fan ---
    const fanWave = partials(ctx, 6, (h) => 0.7 ** h);
    this.fan = ctx.createOscillator();
    this.fan.setPeriodicWave(fanWave);
    this.fan2 = ctx.createOscillator();
    this.fan2.setPeriodicWave(fanWave);
    this.fanFilter = band(1400, 0.7);
    this.fanGain = level();
    this.fan2Gain = ctx.createGain();
    this.fan2Gain.gain.value = 0;
    this.fan.connect(this.fanFilter);
    this.fan2.connect(this.fan2Gain);
    this.fan2Gain.connect(this.fanFilter);
    this.fanFilter.connect(this.fanGain);

    // --- Buzzsaw: engine orders of the shaft, uneven, up where the shock is ---
    this.buzz = ctx.createOscillator();
    this.buzz.setPeriodicWave(partials(ctx, 40, (h) => (h < 6 ? 0.1 : 0.35 + 0.65 * Math.sin(h * 2.4) ** 2) / Math.sqrt(h)));
    this.buzzBand = band(1500, 0.9);
    this.buzzGain = level();
    this.buzz.connect(this.buzzBand);
    this.buzzBand.connect(this.buzzGain);

    // --- Compressor whine ---
    this.n2 = ctx.createOscillator();
    this.n2.type = 'sawtooth';
    this.n2Filter = band(3200, 2.4);
    this.n2Gain = level();
    this.n2.connect(this.n2Filter);
    this.n2Filter.connect(this.n2Gain);

    // --- Core roar ---
    this.coreSrc = m.noiseSource(true);
    this.coreFilter = ctx.createBiquadFilter();
    this.coreFilter.type = 'lowpass';
    this.coreFilter.frequency.value = 400;
    this.coreFilter.Q.value = 0.7;
    this.coreGain = level();
    this.coreSrc.connect(this.coreFilter);
    this.coreFilter.connect(this.coreGain);

    // --- Exhaust, fluttering ---
    this.exSrc = m.noiseSource(true);
    this.exFilter = band(700, 0.5);
    this.exGain = level();
    this.exFlutter = ctx.createGain();
    this.exFlutter.gain.value = 0.82;
    this.exSrc.connect(this.exFilter);
    this.exFilter.connect(this.exFlutter);
    this.exFlutter.connect(this.exGain);

    this.flutSrc = m.noiseSource(false);
    this.flutSrc.playbackRate.value = 0.25;
    this.flutFilter = ctx.createBiquadFilter();
    this.flutFilter.type = 'lowpass';
    this.flutFilter.frequency.value = 22;
    this.flutDepth = ctx.createGain();
    this.flutDepth.gain.value = 1.6;
    this.flutSrc.connect(this.flutFilter);
    this.flutFilter.connect(this.flutDepth);
    this.flutDepth.connect(this.exFlutter.gain);

    // --- Burner: rumble, and noise gated by slow noise into cracks ---
    this.burnSrc = m.noiseSource(true);
    this.burnFilter = band(190, 0.6);
    this.burnGain = level();
    this.burnSrc.connect(this.burnFilter);
    this.burnFilter.connect(this.burnGain);

    this.crackSrc = m.noiseSource(false);
    this.crackFilter = band(1500, 0.6);
    this.crackGate = ctx.createGain();
    this.crackGate.gain.value = 0;
    this.crackGain = level();
    this.crackSrc.connect(this.crackFilter);
    this.crackFilter.connect(this.crackGate);
    this.crackGate.connect(this.crackGain);
    const gate = ctx.createWaveShaper();
    gate.curve = pulseCurve(0.1, 1.2);
    const gateBoost = ctx.createGain();
    gateBoost.gain.value = 26;
    const gateLp = ctx.createBiquadFilter();
    gateLp.type = 'lowpass';
    gateLp.frequency.value = 40;
    this.flutSrc.connect(gateLp);
    gateLp.connect(gateBoost);
    gateBoost.connect(gate);
    gate.connect(this.crackGate.gain);

    for (const o of [this.fan, this.fan2, this.buzz, this.n2]) o.start();
    this.built = true;
  }

  setProfile(family, engines = 2) {
    this.family = family;
    this.engines = engines;
  }

  /** Off the graph while another synth has the job: an unconnected node is not computed. */
  plug(on) {
    if (!this.built || on === this.plugged) return;
    this.plugged = on;
    if (on) this.tone.connect(this.mixer.bus('engine'));
    else this.tone.disconnect();
  }

  setInterior(inside) {
    this.interior = inside;
  }

  /** The air starter's rush, then the light-off about a second and a half in. */
  playStart() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    const m = this.mixer;
    m.noiseBurst({ bus: 'engine', duration: 2.6, gain: 0.22, freq: 1500, q: 0.7, attack: 0.7 });
    m.noiseBurst({ bus: 'engine', when: t + 1.5, duration: 0.8, gain: 0.3, freq: 300, q: 0.7, attack: 0.04, pink: true });
  }

  playStop() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    // Winding down takes far longer than a piston engine stopping.
    this.out.gain.setTargetAtTime(0.0001, t, 2.6);
  }

  update(dt, ac, weather) {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    const F = this.family;
    const v = this.mixer.view;

    // Spool inertia: the whole character of a jet.
    const target = ac.rpm;
    this.n1 += (target - this.n1) * Math.min(1, dt * (target > this.n1 ? F.up : F.down));
    const n1 = this.n1;
    const running = n1 > 0.03;
    const on = running ? 1 : 0;
    this.running = running;
    const inside = this.interior;

    const fanHz = lerp(F.bp0, F.bp1, Math.pow(n1, 1.15)) * clamp(n1 / 0.12, 0.1, 1) * v.pitch;
    const smooth = 0.3;
    this.fan.frequency.setTargetAtTime(fanHz, t, smooth);
    this.fan2.frequency.setTargetAtTime(fanHz * 1.0016, t, smooth);
    this.fanFilter.frequency.setTargetAtTime(fanHz * 1.3, t, smooth);
    this.buzz.frequency.setTargetAtTime(Math.max(8, F.rot * n1 * v.pitch), t, smooth);
    this.n2.frequency.setTargetAtTime(F.n2 * (0.42 + 0.5 * n1) * v.pitch, t, smooth);
    this.n2Filter.frequency.setTargetAtTime(F.n2 * (0.42 + 0.5 * n1) * 1.05, t, smooth);

    // Whine at idle, roar at power: that crossover is why a jet at idle sounds
    // nothing like one on take-off.
    const whine = (0.42 + 0.58 * clamp(n1 * 1.3, 0, 1)) * (1 - n1 * 0.35) * F.whine;
    const blast = Math.pow(clamp(n1, 0, 1), 1.7) * F.blast;
    const shock = clamp((n1 - 0.72) / 0.22, 0, 1) * F.buzz;
    const burner = clamp(ac.burner || 0, 0, 1);
    const rev = clamp(ac.reverse || 0, 0, 1);
    const push = 1 + rev * 0.8;

    this.fan2Gain.gain.setTargetAtTime(this.engines > 1 ? 1 : 0, t, 0.3);
    this.out.gain.setTargetAtTime(on * (0.62 + n1 * 0.62) * (inside ? F.inside : 1) * v.gain * v.synth, t, 0.3);
    this.fanGain.gain.setTargetAtTime(on * whine * 0.13 * (inside ? 0.3 : 1), t, 0.3);
    this.n2Gain.gain.setTargetAtTime(on * whine * 0.035 * (inside ? 0.25 : 1), t, 0.3);
    this.buzzGain.gain.setTargetAtTime(on * shock * 0.3 * (inside ? 0.3 : 1), t, 0.4);
    this.buzzBand.frequency.setTargetAtTime(F.rot * 16 * v.pitch, t, 0.4);
    this.coreGain.gain.setTargetAtTime(on * (0.14 + blast * 0.34), t, 0.3);
    this.coreFilter.frequency.setTargetAtTime(240 + n1 * 340, t, 0.4);
    this.exGain.gain.setTargetAtTime(on * (0.2 + blast * 0.62 * push), t, 0.3);
    this.exFilter.frequency.setTargetAtTime((800 - n1 * 400 + blast * 620 + rev * 500) * v.pitch, t, 0.4);
    // Most aeroplanes have no burner: those voices stay off the graph until one lights.
    const crack = Math.max(burner, F.crackle ? clamp((n1 - 0.8) * 3, 0, 0.6) : 0);
    const hot = crack > 0 || this.crackGain.gain.value > 0.002;
    if (hot !== this._hot) {
      this._hot = hot;
      for (const g of [this.burnGain, this.crackGain]) {
        if (hot) g.connect(this.out);
        else g.disconnect();
      }
    }
    if (hot) {
      this.burnGain.gain.setTargetAtTime(on * burner * 0.9, t, 0.5);
      this.crackGain.gain.setTargetAtTime(on * crack * 0.5, t, 0.3);
    }
    this.tone.frequency.setTargetAtTime(Math.min(inside ? 950 + n1 * 500 : 7500, v.cut), t, 0.3);

    // Running out of fuel: the spool runs down rather than coughing.
    if (ac.fuel <= 0 && running) this.n1 *= 0.985;
  }
}

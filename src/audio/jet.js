/**
 * Turbofan, synthesised.
 *
 * Three of the five aeroplanes are jets, and they were all making the noise of
 * a four-cylinder piston engine turning a two-bladed propeller — a firing tone
 * at eighty hertz with blade slap on top. Utterly wrong, and the first thing
 * you notice flying the airliner.
 *
 * A turbofan is a different sound built from different parts:
 *
 *   fan whine    the front fan, heard as a high tone with strong upper
 *                harmonics — the "buzzsaw" you hear standing near one
 *   compressor   a second tone well above the fan, from the high-pressure
 *                spool, which is what makes a jet sound two-toned
 *   core roar    low broadband noise from combustion
 *   exhaust      the wide, hissy jet behind it, which is most of what you hear
 *                at full power
 *
 * The thing that makes it *feel* like a jet, though, is spool time. A piston
 * engine answers the throttle immediately; a turbofan takes several seconds to
 * wind up. Every parameter here is smoothed with a long time constant, so
 * slamming the throttle open does nothing for a moment and then the whole
 * sound arrives.
 */

import { clamp, lerp } from '../core/noise.js';

export class JetSound {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.running = false;
    /** Simulated spool position, which lags the commanded rpm. */
    this.n1 = 0;
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

    // --- Fan: a bright periodic wave, so the harmonics come for free ---
    const N = 16;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    // Rising then falling harmonic series: bright, but not a raw sawtooth.
    const amps = [0, 1, 0.7, 0.85, 0.55, 0.6, 0.38, 0.42, 0.26, 0.3, 0.18, 0.2, 0.12, 0.13, 0.08, 0.09];
    for (let i = 0; i < N; i++) real[i] = amps[i] || 0;
    const fanWave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    this.fan = ctx.createOscillator();
    this.fan.setPeriodicWave(fanWave);
    this.fanGain = ctx.createGain();
    this.fanGain.gain.value = 0;
    this.fanFilter = ctx.createBiquadFilter();
    this.fanFilter.type = 'bandpass';
    this.fanFilter.frequency.value = 1400;
    this.fanFilter.Q.value = 0.8;
    this.fan.connect(this.fanFilter);
    this.fanFilter.connect(this.fanGain);
    this.fanGain.connect(this.out);

    // --- Compressor whine: the second, higher tone ---
    this.n2 = ctx.createOscillator();
    this.n2.type = 'sawtooth';
    this.n2Gain = ctx.createGain();
    this.n2Gain.gain.value = 0;
    const n2Filter = ctx.createBiquadFilter();
    n2Filter.type = 'bandpass';
    n2Filter.frequency.value = 3200;
    n2Filter.Q.value = 2.4;
    this.n2.connect(n2Filter);
    n2Filter.connect(this.n2Gain);
    this.n2Gain.connect(this.out);
    this.n2Filter = n2Filter;

    // --- Core roar: low, heavy, always there once it is running ---
    this.coreSrc = m.noiseSource(true);
    this.coreFilter = ctx.createBiquadFilter();
    this.coreFilter.type = 'lowpass';
    this.coreFilter.frequency.value = 260;
    this.coreFilter.Q.value = 0.8;
    this.coreGain = ctx.createGain();
    this.coreGain.gain.value = 0;
    this.coreSrc.connect(this.coreFilter);
    this.coreFilter.connect(this.coreGain);
    this.coreGain.connect(this.out);

    // --- Exhaust: the wide hiss, and most of the noise at full power ---
    this.exSrc = m.noiseSource(false);
    this.exFilter = ctx.createBiquadFilter();
    this.exFilter.type = 'bandpass';
    this.exFilter.frequency.value = 900;
    this.exFilter.Q.value = 0.45;
    this.exGain = ctx.createGain();
    this.exGain.gain.value = 0;
    this.exSrc.connect(this.exFilter);
    this.exFilter.connect(this.exGain);
    this.exGain.connect(this.out);

    for (const o of [this.fan, this.n2]) o.start();
    this.built = true;
  }

  setInterior(inside) {
    this.interior = inside;
    if (!this.built) return;
    // A flight deck is a long way from the engines and very well insulated:
    // the whine mostly disappears and you are left with the rumble.
    this.tone.frequency.setTargetAtTime(inside ? 900 : 5200, this.ctx.currentTime, 0.3);
  }

  /** Spool-up: the whine climbs from nothing, which takes a while. */
  playStart() {
    if (!this.built) return;
    this.mixer.noiseBurst({ bus: 'engine', duration: 1.6, gain: 0.1, freq: 380, q: 0.7, attack: 0.5 });
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

    // Spool inertia. This is the whole character of a jet: the sound arrives
    // seconds after the throttle does.
    const target = ac.rpm;
    this.n1 += (target - this.n1) * Math.min(1, dt * (target > this.n1 ? 0.55 : 0.8));
    const n1 = this.n1;
    const running = n1 > 0.03;
    this.running = running;

    // Fan tone: roughly 55 Hz at idle to 340 Hz at full power. The bandpass
    // sweeping up with it is what gives the rising "howl" on take-off.
    const fanHz = lerp(48, 340, Math.pow(n1, 1.15));
    const smooth = 0.35;
    this.fan.frequency.setTargetAtTime(fanHz, t, smooth);
    this.fanFilter.frequency.setTargetAtTime(700 + n1 * 2600, t, smooth);
    this.n2.frequency.setTargetAtTime(fanHz * 3.4, t, smooth);
    this.n2Filter.frequency.setTargetAtTime(1800 + n1 * 4200, t, smooth);

    // Balance: whine dominates at low power, exhaust roar at high power. That
    // crossover is why a jet at idle sounds nothing like one on take-off.
    const whine = clamp(n1 * 1.2, 0, 1) * (1 - n1 * 0.35);
    const blast = Math.pow(clamp(n1, 0, 1), 1.7);
    const inside = this.interior ? 0.45 : 1;

    this.out.gain.setTargetAtTime(running ? 0.26 + n1 * 0.5 : 0, t, 0.4);
    this.fanGain.gain.setTargetAtTime(running ? whine * 0.36 * inside : 0, t, 0.4);
    this.n2Gain.gain.setTargetAtTime(running ? whine * 0.1 * inside : 0, t, 0.4);
    this.coreGain.gain.setTargetAtTime(running ? 0.2 + blast * 0.4 : 0, t, 0.4);
    this.coreFilter.frequency.setTargetAtTime(180 + n1 * 260, t, 0.4);
    this.exGain.gain.setTargetAtTime(running ? blast * 0.5 : 0, t, 0.4);
    this.exFilter.frequency.setTargetAtTime(600 + blast * 1500, t, 0.4);

    // Running out of fuel: the spool runs down rather than coughing.
    if (ac.fuel <= 0 && running) this.n1 *= 0.985;
  }
}

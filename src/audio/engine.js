/**
 * Piston engine and propeller, synthesised.
 *
 * A real four-cylinder aero engine at 2400 rpm fires 80 times a second and its
 * two-bladed propeller slaps the air 80 times a second too, so the sound is
 * built from exactly that: a harmonic-rich firing tone, a blade-slap layer, a
 * low crankshaft rumble and combustion hiss. Everything scales with rpm, so the
 * note rises and falls naturally with the throttle instead of being crossfaded
 * between clips.
 */

import { clamp, lerp } from '../core/noise.js';

export class EngineSound {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.running = false;
    this.startTimer = 0;
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 0;

    // Cabin muffling: the interior view rolls off the top end.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2600;
    this.tone.Q.value = 0.4;

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = m.distortionCurve(6);

    this.out.connect(this.shaper);
    this.shaper.connect(this.tone);
    this.tone.connect(m.bus('engine'));

    // --- Firing tone: a rich periodic wave so we get real harmonics. ---
    const N = 12;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    // Emphasise the 1st, 2nd and 4th harmonics like an exhaust note.
    const amps = [0, 1, 0.62, 0.3, 0.42, 0.18, 0.22, 0.1, 0.13, 0.07, 0.08, 0.05];
    for (let i = 0; i < N; i++) real[i] = amps[i] || 0;
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    this.firing = ctx.createOscillator();
    this.firing.setPeriodicWave(wave);
    this.firingGain = ctx.createGain();
    this.firingGain.gain.value = 0.5;
    this.firing.connect(this.firingGain);
    this.firingGain.connect(this.out);

    // Second, slightly detuned copy: real engines never run perfectly even.
    this.firing2 = ctx.createOscillator();
    this.firing2.setPeriodicWave(wave);
    this.firing2.detune.value = 14;
    this.firing2Gain = ctx.createGain();
    this.firing2Gain.gain.value = 0.28;
    this.firing2.connect(this.firing2Gain);
    this.firing2Gain.connect(this.out);

    // --- Crankshaft rumble ---
    this.rumble = ctx.createOscillator();
    this.rumble.type = 'sine';
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.5;
    this.rumble.connect(this.rumbleGain);
    this.rumbleGain.connect(this.out);

    // --- Combustion hiss / intake roar ---
    this.hissSrc = m.noiseSource(false);
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.frequency.value = 900;
    this.hissFilter.Q.value = 0.9;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.hissSrc.connect(this.hissFilter);
    this.hissFilter.connect(this.hissGain);
    this.hissGain.connect(this.out);

    // --- Propeller blade slap: noise chopped by an LFO at the blade rate ---
    this.propSrc = m.noiseSource(true);
    this.propFilter = ctx.createBiquadFilter();
    this.propFilter.type = 'bandpass';
    this.propFilter.frequency.value = 320;
    this.propFilter.Q.value = 1.4;
    this.propGain = ctx.createGain();
    this.propGain.gain.value = 0;
    this.propSrc.connect(this.propFilter);

    /*
     * The blade-rate chop is a stage of its own, ahead of the level control.
     *
     * The LFO used to be connected to propGain.gain, where 0.7 of modulation
     * was summed on to a level whose own maximum is 0.32. An AudioParam adds
     * what is connected to it to its intrinsic value, so for most of every
     * cycle the prop gain went negative — a polarity flip, not a tremolo — and
     * with the engine stopped the prop never fell silent because the LFO kept
     * swinging about zero. Chopping a stage in front of propGain multiplies
     * instead of adding, which leaves propGain as the one thing that decides
     * whether the propeller is heard at all.
     */
    this.propChop = ctx.createGain();
    this.propChop.gain.value = 1;
    this.propFilter.connect(this.propChop);
    this.propChop.connect(this.propGain);
    this.propGain.connect(this.out);

    this.bladeLfo = ctx.createOscillator();
    this.bladeLfo.type = 'triangle';
    this.bladeLfoGain = ctx.createGain();
    // Depth is set from load every frame in update(); this is the idle value.
    this.bladeLfoGain.gain.value = 0.18;
    this.bladeLfo.connect(this.bladeLfoGain);
    this.bladeLfoGain.connect(this.propChop.gain);

    // --- Starter motor (only audible during start-up) ---
    this.starter = ctx.createOscillator();
    this.starter.type = 'sawtooth';
    this.starter.frequency.value = 24;
    this.starterGain = ctx.createGain();
    this.starterGain.gain.value = 0;
    const starterFilter = ctx.createBiquadFilter();
    starterFilter.type = 'lowpass';
    starterFilter.frequency.value = 1400;
    this.starter.connect(starterFilter);
    starterFilter.connect(this.starterGain);
    this.starterGain.connect(m.bus('engine'));

    for (const o of [this.firing, this.firing2, this.rumble, this.bladeLfo, this.starter]) o.start();

    this.built = true;
  }

  setInterior(inside) {
    this.interior = inside;
    if (!this.built) return;
    this.tone.frequency.setTargetAtTime(inside ? 1500 : 3200, this.ctx.currentTime, 0.25);
  }

  /** Crank the starter: whirr, a few uneven catches, then it fires up. */
  playStart() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    this.starterGain.gain.cancelScheduledValues(t);
    this.starterGain.gain.setValueAtTime(0.0001, t);
    this.starterGain.gain.exponentialRampToValueAtTime(0.16, t + 0.14);
    this.starter.frequency.setValueAtTime(10, t);
    this.starter.frequency.linearRampToValueAtTime(34, t + 1.3);
    this.starterGain.gain.setValueAtTime(0.16, t + 1.25);
    this.starterGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.75);
    /*
     * Uneven catches as the cylinders come alive.
     *
     * The offsets in this list used to be read into `d` and then never used,
     * because noiseBurst had no way to be told when to fire, so all three
     * catches landed on the same tick and sounded like one thump. They are now
     * scheduled on the audio clock against the same `t` the starter ramp uses,
     * which keeps them lined up with the whirr however busy the frame is.
     */
    for (const d of [1.15, 1.34, 1.52]) {
      this.mixer.noiseBurst({ bus: 'engine', when: t + d, duration: 0.12, gain: 0.22, freq: 220, q: 1.2, attack: 0.004 });
    }
  }

  update(dt, ac, weather) {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    const rpm = ac.rpm;
    const running = rpm > 0.04;

    // Engine rpm 0.18 (idle) → ~800 rpm, 1.0 → ~2650 rpm.
    const rpmAbs = lerp(60, 2650, rpm);
    const firingHz = clamp((rpmAbs / 60) * 2, 2, 120); // 4-cyl, 4-stroke
    const bladeHz = clamp((rpmAbs / 60) * 2, 2, 120);

    const smooth = 0.09;
    this.firing.frequency.setTargetAtTime(firingHz, t, smooth);
    this.firing2.frequency.setTargetAtTime(firingHz * 1.005, t, smooth);
    this.rumble.frequency.setTargetAtTime(clamp(firingHz * 0.5, 8, 70), t, smooth);
    this.bladeLfo.frequency.setTargetAtTime(bladeHz, t, smooth);

    // Load: more throttle and more airspeed both open the sound up.
    const load = clamp(rpm * 0.75 + ac.controls.throttle * 0.25, 0, 1);
    const speedFactor = clamp(ac.airspeed / 70, 0, 1);

    this.out.gain.setTargetAtTime(running ? 0.30 + load * 0.55 : 0, t, 0.12);
    this.hissGain.gain.setTargetAtTime(running ? 0.05 + load * 0.2 : 0, t, 0.15);
    this.hissFilter.frequency.setTargetAtTime(600 + load * 1800, t, 0.2);
    this.propGain.gain.setTargetAtTime(running ? 0.06 + load * 0.26 : 0, t, 0.15);
    // Deeper blade slap with more power: the chop is the cue that tells a
    // ten-year-old the engine is actually pulling. Stays below 1 so the chop
    // stage never inverts.
    this.bladeLfoGain.gain.setTargetAtTime(0.18 + load * 0.45, t, 0.15);
    this.propFilter.frequency.setTargetAtTime(220 + load * 420 + speedFactor * 160, t, 0.2);
    this.tone.frequency.setTargetAtTime(
      (this.interior ? 1250 : 2400) + load * (this.interior ? 900 : 2200),
      t,
      0.25
    );

    // Rough running when the tank is nearly dry, and a cough when it quits.
    if (ac.fuel > 0 && ac.fuel < 8 && running) {
      const stumble = Math.sin(t * 9) > 0.86 ? 0.5 : 1;
      this.out.gain.setTargetAtTime((0.3 + load * 0.55) * stumble, t, 0.03);
    }
    this.running = running;
  }

  playStop() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    this.firing.frequency.setTargetAtTime(6, t, 0.6);
  }
}

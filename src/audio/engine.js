/**
 * Propeller engines, synthesised, two kinds (profile.js).
 *
 * Piston: a four-cylinder at 2400 rpm fires 80 times a second, but the wave's
 * fundamental is the whole four-stroke cycle (rpm / 120) and the firing rate
 * its 4th harmonic, so the partials in between are the unevenness between
 * cylinders that makes an engine lope instead of buzz. It needs 128 partials:
 * at idle the fundamental is 7 Hz and a tablet's speaker starts near 250.
 *
 * Turboprop: no firing at all. The governor holds the propeller near constant
 * speed, so the note is the blade-pass tone (six blades, about 100 Hz) barely
 * moving while the load changes, a turbine whine over it, and the slow beat of
 * two propellers that are never quite in step.
 *
 * Everything scales with rpm, so the note follows the throttle instead of
 * being crossfaded between clips.
 */

import { clamp, lerp } from '../core/noise.js';
import { FAMILIES, partials } from './profile.js';

export class EngineSound {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.running = false;
    this.startTimer = 0;
    this.family = FAMILIES.piston;
    this.twin = false;
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

    // --- The note: firing for a piston, blade-pass for a turboprop ---
    this.cycleWave = partials(ctx, 128, (h) => (h === 4 ? 0.45 : h % 4 === 0 ? 1 : 0.14 + 0.12 * Math.sin(h * 1.7) ** 2) / Math.pow(h / 4 + 0.6, 0.8));
    this.bladeWave = partials(ctx, 40, (h) => (h === 1 ? 0.3 : 1) / Math.pow(h, 0.95));

    this.firing = ctx.createOscillator();
    this.firing.setPeriodicWave(this.cycleWave);
    this.firingGain = ctx.createGain();
    this.firingGain.gain.value = 0.5;
    this.firing.connect(this.firingGain);
    this.firingGain.connect(this.out);

    // --- The propeller's own tone, and a second engine's a hair off it ---
    this.blade = ctx.createOscillator();
    this.blade.setPeriodicWave(this.bladeWave);
    this.blade2 = ctx.createOscillator();
    this.blade2.setPeriodicWave(this.bladeWave);
    this.bladeGain = ctx.createGain();
    this.bladeGain.gain.value = 0;
    this.blade2Gain = ctx.createGain();
    this.blade2Gain.gain.value = 0;
    this.blade.connect(this.bladeGain);
    this.blade2.connect(this.blade2Gain);
    this.bladeGain.connect(this.out);
    this.blade2Gain.connect(this.out);

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

    // --- Blade rasp: noise chopped at the blade rate ---
    this.propSrc = m.noiseSource(true);
    this.propFilter = ctx.createBiquadFilter();
    this.propFilter.type = 'bandpass';
    this.propFilter.frequency.value = 320;
    this.propFilter.Q.value = 1.4;
    this.propGain = ctx.createGain();
    this.propGain.gain.value = 0;
    this.propSrc.connect(this.propFilter);

    // The chop is a stage ahead of the level, so it multiplies. On propGain it
    // summed with the level, went negative and kept sounding with the engine off.
    this.propChop = ctx.createGain();
    this.propChop.gain.value = 1;
    this.propFilter.connect(this.propChop);
    this.propChop.connect(this.propGain);
    this.propGain.connect(this.out);

    this.bladeLfo = ctx.createOscillator();
    this.bladeLfo.type = 'triangle';
    this.bladeLfoGain = ctx.createGain();
    this.bladeLfoGain.gain.value = 0.18;
    this.bladeLfo.connect(this.bladeLfoGain);
    this.bladeLfoGain.connect(this.propChop.gain);

    // --- A turboprop's turbine ---
    this.whine = ctx.createOscillator();
    this.whine.type = 'sawtooth';
    this.whineBand = ctx.createBiquadFilter();
    this.whineBand.type = 'bandpass';
    this.whineBand.frequency.value = 3600;
    this.whineBand.Q.value = 3;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineBand);
    this.whineBand.connect(this.whineGain);
    this.whineGain.connect(this.out);

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

    for (const o of [this.firing, this.blade, this.blade2, this.bladeLfo, this.whine, this.starter]) o.start();

    this.setProfile(this.family, this.twin);
    this.built = true;
  }

  setProfile(family, twin = false) {
    this.family = family;
    this.twin = twin;
    if (this.firing) this.firing.setPeriodicWave(family.turbo ? this.bladeWave : this.cycleWave);
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

  /** Crank the starter: whirr, a few uneven catches, then it fires up. */
  playStart() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    if (this.family.turbo) {
      // No crank on a turbine: air, then the light-off.
      this.mixer.noiseBurst({ bus: 'engine', duration: 1.8, gain: 0.14, freq: 1500, q: 0.8, attack: 0.5 });
      this.mixer.noiseBurst({ bus: 'engine', when: t + 1.1, duration: 0.5, gain: 0.2, freq: 320, q: 0.9, attack: 0.05, pink: true });
      return;
    }
    this.starterGain.gain.cancelScheduledValues(t);
    this.starterGain.gain.setValueAtTime(0.0001, t);
    this.starterGain.gain.exponentialRampToValueAtTime(0.16, t + 0.14);
    this.starter.frequency.setValueAtTime(10, t);
    this.starter.frequency.linearRampToValueAtTime(34, t + 1.3);
    this.starterGain.gain.setValueAtTime(0.16, t + 1.25);
    this.starterGain.gain.exponentialRampToValueAtTime(0.0001, t + 1.75);
    // Uneven catches, on the audio clock against the same t as the whirr.
    for (const d of [1.15, 1.34, 1.52]) {
      this.mixer.noiseBurst({ bus: 'engine', when: t + d, duration: 0.12, gain: 0.3, freq: 340, q: 1.2, attack: 0.004 });
    }
  }

  update(dt, ac, weather) {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    const rpm = ac.rpm;
    const running = rpm > 0.04;
    const F = this.family;
    const v = this.mixer.view;

    // 0.18 is idle in the flight model; to the propeller's own rpm from there.
    const speedFactor = clamp(ac.airspeed / 70, 0, 1);
    const n = F.turbo ? clamp(rpm / 0.45, 0, 1) : rpm;
    const rpmAbs = (n <= 0.18 ? (n / 0.18) * F.idleRpm : lerp(F.idleRpm, F.maxRpm, (n - 0.18) / 0.82)) * (1 + speedFactor * 0.04);
    const bladeHz = Math.max(2, (rpmAbs / 60) * F.blades) * v.pitch;
    const noteHz = (F.turbo ? bladeHz : (rpmAbs / 120) * v.pitch);

    const smooth = 0.09;
    this.firing.frequency.setTargetAtTime(Math.max(1, noteHz), t, smooth);
    this.blade.frequency.setTargetAtTime(bladeHz, t, smooth);
    // Two propellers about a third of a hertz apart: a slow beat, slower in a governor's hold.
    this.blade2.frequency.setTargetAtTime(bladeHz + 0.35, t, smooth);
    this.bladeLfo.frequency.setTargetAtTime(bladeHz, t, smooth);
    this.whine.frequency.setTargetAtTime(F.turbo ? (rpm * 1200 + 500) * v.pitch : 200, t, 0.3);

    // Load: more throttle and more airspeed both open the sound up.
    const load = clamp(rpm * 0.75 + ac.controls.throttle * 0.25, 0, 1);
    const level = (running ? 0.15 + load * 0.24 : 0) * (F.turbo ? 0.72 : 1) * (this.interior ? F.inside : 1) * v.gain * v.synth;

    // Rough running when the tank is nearly dry, and a cough when it quits.
    const stumble = ac.fuel > 0 && ac.fuel < 8 && Math.sin(t * 9) > 0.86 ? 0.5 : 1;
    this.out.gain.setTargetAtTime(level * stumble, t, stumble < 1 ? 0.03 : 0.12);

    const on = running ? 1 : 0;
    this.firingGain.gain.setTargetAtTime(F.turbo ? 0.2 + load * 0.12 : 0.55, t, 0.15);
    this.bladeGain.gain.setTargetAtTime(on * (F.turbo ? 0.42 : 0.1 + load * 0.3), t, 0.15);
    this.blade2Gain.gain.setTargetAtTime(this.twin ? on * (F.turbo ? 0.42 : 0.1 + load * 0.3) : 0, t, 0.15);
    this.hissGain.gain.setTargetAtTime(on * (0.05 + load * 0.2), t, 0.15);
    this.hissFilter.frequency.setTargetAtTime(600 + load * 1800, t, 0.2);
    this.propGain.gain.setTargetAtTime(on * (0.1 + load * 0.34), t, 0.15);
    // Deeper chop with more power: the cue that the engine is actually pulling. Below 1, so it never inverts.
    this.bladeLfoGain.gain.setTargetAtTime(0.18 + load * 0.45, t, 0.15);
    this.propFilter.frequency.setTargetAtTime(240 + load * 520 + speedFactor * 200, t, 0.2);
    this.whineGain.gain.setTargetAtTime(F.turbo ? on * (0.05 + load * 0.08) * (this.interior ? 0.4 : 1) : 0, t, 0.3);
    this.tone.frequency.setTargetAtTime(
      Math.min((this.interior ? 1250 : 2800) + load * (this.interior ? 900 : 3000), v.cut),
      t,
      0.25
    );
    this.running = running;
  }

  playStop() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
    this.firing.frequency.setTargetAtTime(2, t, 0.6);
  }
}

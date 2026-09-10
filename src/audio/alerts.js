/**
 * Warnings and interface sounds.
 *
 * The stall warner is modelled on the real thing: a reed horn that moans
 * continuously while the wing is close to letting go, so you learn to react to
 * the sound rather than to a text label.
 */

import { clamp } from '../core/noise.js';

export class Alerts {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.stallActive = false;
    this.gearWarnActive = false;
    this.terrainTimer = 0;
    this.overspeedTimer = 0;
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;

    /* Stall horn: reedy square wave with a tremolo and a touch of noise. */
    this.stallGain = ctx.createGain();
    this.stallGain.gain.value = 0;
    this.stallGain.connect(m.bus('alerts'));

    this.stallOsc = ctx.createOscillator();
    this.stallOsc.type = 'square';
    this.stallOsc.frequency.value = 812;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 900;
    sf.Q.value = 2.2;
    this.stallOsc.connect(sf);
    sf.connect(this.stallGain);

    this.stallOsc2 = ctx.createOscillator();
    this.stallOsc2.type = 'sawtooth';
    this.stallOsc2.frequency.value = 406;
    const sg2 = ctx.createGain();
    sg2.gain.value = 0.25;
    this.stallOsc2.connect(sg2);
    sg2.connect(this.stallGain);

    this.stallTrem = ctx.createOscillator();
    this.stallTrem.type = 'sine';
    this.stallTrem.frequency.value = 7.5;
    this.stallTremGain = ctx.createGain();
    this.stallTremGain.gain.value = 0.35;
    this.stallTrem.connect(this.stallTremGain);
    this.stallTremGain.connect(this.stallGain.gain);

    /* Gear warning: softer, lower, intermittent. */
    this.gearGain = ctx.createGain();
    this.gearGain.gain.value = 0;
    this.gearGain.connect(m.bus('alerts'));
    this.gearOsc = ctx.createOscillator();
    this.gearOsc.type = 'triangle';
    this.gearOsc.frequency.value = 440;
    this.gearOsc.connect(this.gearGain);

    for (const o of [this.stallOsc, this.stallOsc2, this.stallTrem, this.gearOsc]) o.start();
    this.built = true;
  }

  setStall(on, severity = 1) {
    if (!this.built) return;
    this.stallActive = on;
    const t = this.ctx.currentTime;
    this.stallGain.gain.setTargetAtTime(on ? 0.10 + severity * 0.09 : 0, t, 0.05);
    this.stallOsc.frequency.setTargetAtTime(790 + severity * 90, t, 0.1);
  }

  setGearWarning(on) {
    if (!this.built || this.gearWarnActive === on) return;
    this.gearWarnActive = on;
    const t = this.ctx.currentTime;
    this.gearGain.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.08);
  }

  overspeed() {
    const m = this.mixer;
    // Clacker: a burst of hard clicks.
    for (let i = 0; i < 6; i++) {
      setTimeout(() => m.noiseBurst({ bus: 'alerts', duration: 0.05, gain: 0.3, freq: 2600, q: 1.6, attack: 0.002 }), i * 95);
    }
  }

  terrain() {
    const m = this.mixer;
    m.tone({ bus: 'alerts', freq: 620, duration: 0.14, gain: 0.2, type: 'square' });
    setTimeout(() => m.tone({ bus: 'alerts', freq: 620, duration: 0.14, gain: 0.2, type: 'square' }), 190);
  }

  lowFuel() {
    const m = this.mixer;
    m.tone({ bus: 'alerts', freq: 990, duration: 0.35, gain: 0.16, type: 'sine' });
    setTimeout(() => m.tone({ bus: 'alerts', freq: 740, duration: 0.5, gain: 0.16, type: 'sine' }), 260);
  }

  checkpoint() {
    const m = this.mixer;
    // Bright three-note bell.
    [1318, 1760, 2637].forEach((f, i) =>
      setTimeout(() => m.tone({ bus: 'alerts', freq: f, duration: 0.5, gain: 0.14, type: 'sine' }), i * 90)
    );
  }

  success() {
    const m = this.mixer;
    [523, 659, 784, 1046].forEach((f, i) =>
      setTimeout(() => {
        m.tone({ bus: 'alerts', freq: f, duration: 0.6, gain: 0.15, type: 'triangle' });
        m.tone({ bus: 'alerts', freq: f * 2, duration: 0.4, gain: 0.05, type: 'sine' });
      }, i * 130)
    );
  }

  failure() {
    const m = this.mixer;
    m.tone({ bus: 'alerts', freq: 220, sweepTo: 110, duration: 0.9, gain: 0.2, type: 'sawtooth' });
    setTimeout(() => m.tone({ bus: 'alerts', freq: 165, sweepTo: 82, duration: 1.1, gain: 0.16, type: 'sawtooth' }), 180);
  }

  uiClick() {
    this.mixer.tone({ bus: 'alerts', freq: 1200, duration: 0.06, gain: 0.07, type: 'sine' });
  }

  uiBack() {
    this.mixer.tone({ bus: 'alerts', freq: 660, duration: 0.09, gain: 0.07, type: 'sine' });
  }

  update(dt, ac, weather) {
    if (!this.built) return;
    // Stall warner comes on a little before the actual stall, like a real one.
    const margin = 0.29 - ac.alpha;
    const warn = !ac.onGround && ac.airspeed > 6 && margin < 0.055;
    this.setStall(warn, clamp((0.055 - margin) / 0.1, 0, 1));

    // Gear-up warning near the ground with the power back.
    const gearWarn =
      !ac.gearDown && ac.agl < 180 && ac.agl > 2 && ac.controls.throttle < 0.35 && ac.vs < 0;
    this.setGearWarning(gearWarn);
    if (gearWarn) {
      this.gearOsc.frequency.setTargetAtTime(
        Math.sin(this.ctx.currentTime * 6) > 0 ? 460 : 0.001,
        this.ctx.currentTime,
        0.01
      );
    }

    // Terrain proximity: high descent rate close to the ground, gear up.
    this.terrainTimer -= dt;
    if (ac.agl < 130 && ac.vs < -6.5 && !ac.onGround && this.terrainTimer <= 0) {
      this.terrain();
      this.terrainTimer = 1.4;
    }
  }
}

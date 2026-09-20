/**
 * Environment sound: slipstream, rain, thunder, tyres, gear and cabin ambience.
 *
 * Wind is the important one — it is the main speed cue a pilot has. Its level
 * and brightness both track airspeed, so 120 knots genuinely sounds fast.
 */

import { clamp, lerp } from '../core/noise.js';

export class Ambience {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.t = 0;
    this._lastRollSurface = 'paved';
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;
    const env = m.bus('environment');

    /* ---- Slipstream ---- */
    this.windSrc = m.noiseSource(true);
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 420;
    this.windFilter.Q.value = 0.55;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    this.windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(env);

    // High whistle around the airframe at speed.
    this.whistleSrc = m.noiseSource(false);
    this.whistleFilter = ctx.createBiquadFilter();
    this.whistleFilter.type = 'bandpass';
    this.whistleFilter.frequency.value = 2600;
    this.whistleFilter.Q.value = 5.5;
    this.whistleGain = ctx.createGain();
    this.whistleGain.gain.value = 0;
    this.whistleSrc.connect(this.whistleFilter);
    this.whistleFilter.connect(this.whistleGain);
    this.whistleGain.connect(env);

    /* ---- Rain ---- */
    this.rainSrc = m.noiseSource(false);
    this.rainHP = ctx.createBiquadFilter();
    this.rainHP.type = 'highpass';
    this.rainHP.frequency.value = 900;
    this.rainBP = ctx.createBiquadFilter();
    this.rainBP.type = 'bandpass';
    this.rainBP.frequency.value = 3400;
    this.rainBP.Q.value = 0.5;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    this.rainSrc.connect(this.rainHP);
    this.rainHP.connect(this.rainBP);
    this.rainBP.connect(this.rainGain);
    this.rainGain.connect(env);

    // Drumming on the windscreen — low-frequency companion to the hiss.
    this.rainBodySrc = m.noiseSource(true);
    this.rainBodyFilter = ctx.createBiquadFilter();
    this.rainBodyFilter.type = 'bandpass';
    this.rainBodyFilter.frequency.value = 240;
    this.rainBodyFilter.Q.value = 0.8;
    this.rainBodyGain = ctx.createGain();
    this.rainBodyGain.gain.value = 0;
    this.rainBodySrc.connect(this.rainBodyFilter);
    this.rainBodyFilter.connect(this.rainBodyGain);
    this.rainBodyGain.connect(env);

    /* ---- Tyre roll ---- */
    this.rollSrc = m.noiseSource(true);
    this.rollFilter = ctx.createBiquadFilter();
    this.rollFilter.type = 'bandpass';
    this.rollFilter.frequency.value = 180;
    this.rollFilter.Q.value = 1.1;
    this.rollGain = ctx.createGain();
    this.rollGain.gain.value = 0;
    this.rollSrc.connect(this.rollFilter);
    this.rollFilter.connect(this.rollGain);
    this.rollGain.connect(env);

    /* ---- Cabin ambience (structure creak + airflow) ---- */
    this.cabinSrc = m.noiseSource(true);
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'lowpass';
    this.cabinFilter.frequency.value = 260;
    this.cabinGain = ctx.createGain();
    this.cabinGain.gain.value = 0;
    this.cabinSrc.connect(this.cabinFilter);
    this.cabinFilter.connect(this.cabinGain);
    this.cabinGain.connect(env);

    this.built = true;
  }

  setInterior(inside) {
    this.interior = inside;
  }

  /** Wheels meeting the ground: thump plus a squeal that scales with impact. */
  playTouchdown(impact = 0.5, surface = 'paved') {
    const m = this.mixer;
    if (!m.ctx) return;
    const hard = clamp(impact, 0.05, 1);
    m.noiseBurst({
      bus: 'environment',
      duration: 0.22 + hard * 0.25,
      gain: 0.25 + hard * 0.5,
      type: 'lowpass',
      freq: 180 + hard * 220,
      q: 0.9,
      attack: 0.004,
    });
    if (surface === 'paved') {
      // Rubber chirp: a short, bright, falling squeal.
      m.tone({
        bus: 'environment',
        freq: 900 + hard * 700,
        sweepTo: 260,
        duration: 0.2 + hard * 0.2,
        gain: 0.06 + hard * 0.14,
        type: 'sawtooth',
      });
      m.noiseBurst({ bus: 'environment', duration: 0.3, gain: 0.12 + hard * 0.2, freq: 2200, q: 2.2 });
    } else {
      m.noiseBurst({ bus: 'environment', duration: 0.5, gain: 0.3, freq: 420, q: 0.6, pink: true });
    }
  }

  playGear(down) {
    const m = this.mixer;
    if (!m.ctx) return;
    // Hydraulic motor whirr...
    const ctx = m.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 780;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(down ? 62 : 74, t);
    osc.frequency.linearRampToValueAtTime(down ? 74 : 62, t + 2.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08, t + 0.12);
    g.gain.setValueAtTime(0.08, t + 2.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
    osc.connect(filt);
    filt.connect(g);
    g.connect(m.bus('environment'));
    osc.start(t);
    osc.stop(t + 2.4);
    // ...then the locking thunk.
    setTimeout(() => {
      m.noiseBurst({ bus: 'environment', duration: 0.24, gain: 0.32, type: 'lowpass', freq: 140, q: 1.4 });
      m.tone({ bus: 'environment', freq: 96, duration: 0.22, gain: 0.14, type: 'triangle' });
    }, 2200);
  }

  playFlaps() {
    this.mixer.noiseBurst({ bus: 'environment', duration: 0.55, gain: 0.1, freq: 480, q: 1.6, pink: true });
  }

  /** Distant thunder: a long low rumble with a couple of reflections. */
  playThunder(distance = 0.5) {
    const m = this.mixer;
    if (!m.ctx) return;
    const near = 1 - clamp(distance, 0, 1);
    const dur = 2.4 + (1 - near) * 3.2;
    const ctx = m.ctx;
    const src = ctx.createBufferSource();
    src.buffer = m.pinkBuffer();
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140 + near * 320;
    lp.Q.value = 0.7;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 + near * 0.4, t + 0.05 + (1 - near) * 0.4);
    g.gain.exponentialRampToValueAtTime(0.06, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(lp);
    lp.connect(g);
    g.connect(m.bus('environment'));
    src.start(t);
    src.stop(t + dur + 0.2);
    if (near > 0.55) {
      // A sharp crack arrives with a close strike.
      m.noiseBurst({ bus: 'environment', duration: 0.5, gain: 0.4, type: 'highpass', freq: 900, attack: 0.002 });
    }
  }

  playCrash() {
    const m = this.mixer;
    if (!m.ctx) return;
    m.noiseBurst({ bus: 'alerts', duration: 1.2, gain: 0.75, type: 'lowpass', freq: 260, q: 0.8, attack: 0.002 });
    m.noiseBurst({ bus: 'alerts', duration: 0.6, gain: 0.5, type: 'bandpass', freq: 2400, q: 0.7 });
    m.tone({ bus: 'alerts', freq: 120, sweepTo: 40, duration: 1.1, gain: 0.3, type: 'square' });
    // Tearing metal.
    for (let i = 0; i < 5; i++) {
      setTimeout(
        () => m.noiseBurst({ bus: 'alerts', duration: 0.22, gain: 0.22, freq: 700 + Math.random() * 2400, q: 3 }),
        120 + i * 130
      );
    }
  }

  playSplash() {
    const m = this.mixer;
    if (!m.ctx) return;
    m.noiseBurst({ bus: 'alerts', duration: 1.4, gain: 0.6, type: 'lowpass', freq: 900, q: 0.5, attack: 0.01, pink: true });
    m.noiseBurst({ bus: 'alerts', duration: 0.7, gain: 0.35, type: 'highpass', freq: 1800 });
  }

  update(dt, ac, weather, cloudImmersion = 0) {
    if (!this.built) return;
    this.t += dt;
    const t = this.ctx.currentTime;
    const inside = this.interior;

    /* Slipstream: level and brightness rise with airspeed. */
    const v = ac.airspeed;
    const speedN = clamp(v / 75, 0, 1.4);
    const gustMod = 1 + Math.sin(this.t * 1.7) * 0.12 * weather.cond.turb;
    const windLevel = (0.012 + Math.pow(speedN, 1.55) * (inside ? 0.20 : 0.38)) * gustMod;
    // On the ground with the engine off you still hear the breeze.
    const ambientBreeze = clamp(weather.windSpeedKts / 40, 0, 1) * (inside ? 0.035 : 0.09);
    this.windGain.gain.setTargetAtTime(windLevel + ambientBreeze, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(260 + speedN * 900, t, 0.15);
    this.windFilter.Q.setTargetAtTime(0.5 + speedN * 0.35, t, 0.2);

    this.whistleGain.gain.setTargetAtTime(Math.pow(clamp((v - 42) / 55, 0, 1), 2) * (inside ? 0.028 : 0.055), t, 0.2);
    this.whistleFilter.frequency.setTargetAtTime(2200 + speedN * 2200, t, 0.25);

    /* Rain: louder inside (it drums on the shell) and faster when flying fast. */
    const rain = weather.cond.rain;
    const rainSpeed = 1 + clamp(v / 60, 0, 1.2);
    this.rainGain.gain.setTargetAtTime(rain * (inside ? 0.16 : 0.3) * rainSpeed * 0.8, t, 0.3);
    this.rainBP.frequency.setTargetAtTime(2600 + rain * 1800, t, 0.3);
    this.rainBodyGain.gain.setTargetAtTime(inside ? rain * 0.16 * rainSpeed : rain * 0.07, t, 0.3);

    /* Tyres. */
    const rolling = ac.onGround && ac.groundSpeed > 0.3;
    const speedRoll = clamp(ac.groundSpeed / 45, 0, 1);
    this.rollGain.gain.setTargetAtTime(rolling ? 0.05 + speedRoll * 0.34 : 0, t, 0.08);
    this.rollFilter.frequency.setTargetAtTime(120 + speedRoll * 520, t, 0.12);
    this.rollFilter.Q.setTargetAtTime(ac.controls.brakes > 0.5 ? 3.4 : 1.1, t, 0.15);

    /* Cabin bed. */
    this.cabinGain.gain.setTargetAtTime(inside ? 0.05 + ac.rpm * 0.05 : 0.0, t, 0.3);
    this.cabinFilter.frequency.setTargetAtTime(180 + ac.rpm * 220, t, 0.3);

    /* Cloud whiteout adds a muffled hush. */
    if (cloudImmersion > 0.2) {
      this.windFilter.Q.setTargetAtTime(0.35, t, 0.3);
    }
  }
}

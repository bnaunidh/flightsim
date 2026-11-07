/**
 * Environment sound: slipstream, rain, thunder, tyres, gear and cabin ambience.
 *
 * Wind is the important one — it is the main speed cue a pilot has. Its level
 * and brightness both track airspeed, so 120 knots genuinely sounds fast.
 */

import { clamp, lerp } from '../core/noise.js';
import { MAP, isPaved } from '../world/terrain.js';

export class Ambience {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.t = 0;
    /** How much airframe to hear: 0 a Cessna, 1 a 747 (profile.js `heavy`). */
    this.heavy = 0;
    this._rolled = 0;
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

    /* ---- Buffet: gear, flaps, spoilers and a stalling wing shaking the air ---- */
    this.buffetSrc = m.noiseSource(true);
    this.buffetFilter = ctx.createBiquadFilter();
    this.buffetFilter.type = 'bandpass';
    this.buffetFilter.frequency.value = 300;
    this.buffetFilter.Q.value = 0.7;
    this.buffetGain = ctx.createGain();
    this.buffetGain.gain.value = 0;
    this.buffetSrc.connect(this.buffetFilter);
    this.buffetFilter.connect(this.buffetGain);
    this.buffetGain.connect(env);

    /* ---- Cabin ambience (structure creak + airflow) ---- */
    this.cabinSrc = m.noiseSource(true);
    this.cabinFilter = ctx.createBiquadFilter();
    this.cabinFilter.type = 'bandpass';
    this.cabinFilter.frequency.value = 420;
    this.cabinFilter.Q.value = 0.35;
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

  /** How long the crash sound may last, seconds (tests/features/tomm1z.mjs holds playCrash to it). */
  static get CRASH_SOUND_SECONDS() {
    return 1.0;
  }

  /**
   * Wheels meeting the ground: the struts taking the weight, then a chirp from
   * each main gear a moment apart (a firm arrival closes the gap), then the
   * rubber's scrub. The chirp is a narrow band of noise sweeping down, not a
   * tone, which was a synth blip on the end of every landing.
   */
  playTouchdown(impact = 0.5, surface = 'paved') {
    const m = this.mixer;
    if (!m.ctx) return;
    const hard = clamp(impact, 0.05, 1);
    if (m.sampled(surface === 'paved' ? 'touchdown.paved' : 'touchdown.grass', { gain: 0.35 + hard * 0.65 })) return;
    const big = this.heavy;
    const t = m.time;
    m.noiseBurst({ bus: 'environment', duration: 0.3 + hard * 0.3 + big * 0.2, gain: 0.3 + hard * 0.5, type: 'lowpass', freq: 240 + hard * 260, q: 0.9, attack: 0.004 });
    m.noiseBurst({ bus: 'environment', duration: 0.16 + hard * 0.12, gain: 0.14 + hard * 0.3, freq: 340, q: 1.1, attack: 0.004 });
    if (surface !== 'paved') {
      m.noiseBurst({ bus: 'environment', duration: 0.7, gain: 0.3, freq: 520, q: 0.6, pink: true, attack: 0.02 });
      return;
    }
    const f = 1350 + hard * 500 - big * 450;
    const len = 0.11 + hard * 0.16 + big * 0.1;
    for (let i = 0; i < 2; i++) {
      const at = t + i * (0.09 - hard * 0.07);
      const c = m.noiseBurst({ bus: 'environment', when: at, duration: len, gain: 0.24 + hard * 0.3, freq: f + i * 90, q: 6, attack: 0.006 });
      if (c) {
        c.filter.frequency.setValueAtTime(f + i * 90, at);
        c.filter.frequency.exponentialRampToValueAtTime(f * 0.55, at + len);
      }
    }
    m.noiseBurst({ bus: 'environment', duration: 0.55 + hard * 0.5, gain: 0.05 + hard * 0.14, freq: 2300, q: 1.1, attack: 0.02 });
  }

  /** A motor running for `dur`: held, not decaying, with its pitch moving under load. */
  _motor(f0, f1, dur, gain, cut) {
    const m = this.mixer;
    const ctx = m.ctx;
    if (m.frozen) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = cut;
    const g = ctx.createGain();
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.linearRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.1);
    g.gain.setValueAtTime(gain, t + dur - 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(filt);
    filt.connect(g);
    g.connect(m.bus('environment'));
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /**
   * The undercarriage: 2.4 s in the flight model (physics.js gearPos), so the
   * lock lands when the picture does. A small aeroplane's electric pump is
   * high and thin; an airliner's hydraulics are lower, with the doors thudding
   * first. On the audio clock now: the lock was on a timer and went off behind
   * the pause menu.
   */
  playGear(down) {
    const m = this.mixer;
    if (!m.ctx) return;
    const big = this.heavy;
    const t = m.time;
    if (!m.sampled(down ? 'gear.down' : 'gear.up', {})) {
      const f = lerp(210, 105, big);
      this._motor(down ? f : f * 1.15, down ? f * 1.15 : f, 2.3, 0.1 + big * 0.05, 900 + big * 500);
      if (big > 0.2) m.noiseBurst({ bus: 'environment', when: t + 0.12, duration: 0.3, gain: 0.3, freq: 300, q: 1, attack: 0.008 });
    }
    m.noiseBurst({ bus: 'environment', when: t + 2.25, duration: 0.3, gain: 0.34 + big * 0.2, freq: 260 - big * 80, q: 1.2, attack: 0.005 });
    m.noiseBurst({ bus: 'environment', when: t + 2.25, duration: 0.08, gain: 0.16, freq: 1300, q: 1.4, attack: 0.002 });
  }

  /** The flap motor, and the jack stopping. */
  playFlaps() {
    const m = this.mixer;
    if (!m.ctx || m.sampled('flaps', {})) return;
    const big = this.heavy;
    const dur = 1.1 + big * 1.2;
    const f = lerp(340, 170, big);
    this._motor(f, f * 1.08, dur, 0.085, 1300);
    m.noiseBurst({ bus: 'environment', when: m.time + dur - 0.05, duration: 0.14, gain: 0.16, freq: 420, q: 1.3, attack: 0.004 });
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

  /**
   * The crash: a thump, a crunch and a little debris, all over inside a
   * second. It was a 1.1 s square-wave growl sweeping 120 Hz down to 40 Hz
   * with five "tearing metal" screeches (narrow bandpass noise, 700-3100 Hz)
   * queued on timers after it — which is what Tomm1z heard at 3:00 when he
   * clipped the terminal: "that's scary ... is this like a horror game?".
   * No tone, nothing on a timer, nothing past CRASH_SOUND_SECONDS.
   */
  playCrash() {
    const m = this.mixer;
    if (!m.ctx) return;
    const t = m.time;
    m.noiseBurst({ bus: 'alerts', duration: 0.5, gain: 0.7, type: 'lowpass', freq: 160, q: 0.7, attack: 0.003, pink: true });
    m.noiseBurst({ bus: 'alerts', duration: 0.32, gain: 0.32, type: 'bandpass', freq: 1100, q: 0.9, attack: 0.002 });
    for (let i = 0; i < 3; i++) {
      m.noiseBurst({ bus: 'alerts', when: t + 0.18 + i * 0.16, duration: 0.07, gain: 0.08, type: 'bandpass', freq: 1500 + i * 500, q: 4 });
    }
  }

  /** Every loop to nothing: the menus and the debrief (audio/index.js hush). */
  silence() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    for (const g of [this.windGain, this.whistleGain, this.rainGain, this.rainBodyGain, this.rollGain, this.buffetGain, this.cabinGain]) {
      if (!g || !g.gain) continue;
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0, g.gain.value), t);
        g.gain.linearRampToValueAtTime(0, t + 0.25);
      } catch (e) {
        g.gain.value = 0;
      }
    }
  }

  /**
   * The sea: a body-blow, water thrown up and coming down, and then the bubbles
   * as it goes under. Was the loudest thing in the game (peak -3.8 dBFS) and,
   * at 8 kHz, a hiss. The bubbles are little rising sines: that is what one
   * physically is, a pocket of air ringing as it shrinks.
   */
  playSplash() {
    const m = this.mixer;
    if (!m.ctx || m.sampled('splash', {})) return;
    const t = m.time;
    m.noiseBurst({ bus: 'alerts', duration: 0.55, gain: 0.7, type: 'lowpass', freq: 480, q: 0.6, attack: 0.008, pink: true });
    m.noiseBurst({ bus: 'alerts', duration: 1.5, gain: 0.5, freq: 900, q: 0.5, attack: 0.03, pink: true });
    m.noiseBurst({ bus: 'alerts', when: t + 0.08, duration: 1.1, gain: 0.08, type: 'highpass', freq: 2400, attack: 0.05 });
    for (let i = 0; i < 12; i++) {
      const f = 300 + Math.random() * 500;
      m.tone({ bus: 'alerts', when: t + 0.5 + i * 0.2 + Math.random() * 0.14, freq: f, sweepTo: f * 1.5, duration: 0.05 + Math.random() * 0.05, gain: 0.09 - i * 0.005, type: 'sine', attack: 0.004 });
    }
  }

  update(dt, ac, weather, cloudImmersion = 0) {
    if (!this.built) return;
    this.t += dt;
    const t = this.ctx.currentTime;
    const inside = this.interior;

    /*
     * Slipstream: level and brightness rise with the air on the airframe.
     * Indicated, because wind noise is dynamic pressure: the thin air at 35,000
     * ft is quieter than the speed sounds. Past 200 kt it keeps rising, more
     * slowly: it used to stop dead there, and 900 kt measured the same as 200.
     */
    const v = Number.isFinite(ac.ias) ? ac.ias : ac.airspeed;
    const s = v / 75;
    const speedN = s < 1.4 ? s : 1.4 + 0.75 * Math.log(s / 1.4);
    const gustMod = 1 + Math.sin(this.t * 1.7) * 0.12 * weather.cond.turb;
    const windLevel = (0.012 + Math.pow(speedN, 1.55) * (inside ? 0.26 : 0.38)) * gustMod;
    // On the ground with the engine off you still hear the breeze.
    const ambientBreeze = clamp(weather.windSpeedKts / 40, 0, 1) * (inside ? 0.035 : 0.09);
    const far = this.mixer.view.gain;
    this.windGain.gain.setTargetAtTime(windLevel * far + ambientBreeze, t, 0.1);
    this.windFilter.frequency.setTargetAtTime((260 + speedN * 900) * (inside ? 0.7 : 1), t, 0.15);
    this.windFilter.Q.setTargetAtTime(0.5 + speedN * 0.35, t, 0.2);

    this.whistleGain.gain.setTargetAtTime(Math.pow(clamp((v - 42) / 55, 0, 1), 2) * (inside ? 0.028 : 0.055) * far, t, 0.2);
    this.whistleFilter.frequency.setTargetAtTime(2200 + speedN * 2200, t, 0.25);

    /* Buffet: the dirty aeroplane sounds it. Rises with dynamic pressure. */
    const q = clamp(v / 85, 0, 1.5);
    const dirty = (ac.gearPos || 0) * 0.3 + (ac.flaps || 0) * 0.16 + (ac.spoilerPos || 0) * 0.42;
    const shaking = ac.stalled ? 0.3 * clamp(v / 35, 0, 1) : 0;
    this.buffetGain.gain.setTargetAtTime((dirty * q * q + shaking) * (inside ? 1 : 0.75) * (ac.onGround ? 0.4 : 1), t, 0.2);

    /* Rain: louder inside (it drums on the shell) and faster when flying fast. */
    // On a snow map (Nunatak Reach, `precip: 'snow'`) the same weather falls
    // as snow, and snow is quiet: a blizzard must not hiss like a downpour.
    const rain = MAP && MAP.precip === 'snow' ? 0 : weather.cond.rain;
    const rainSpeed = 1 + clamp(v / 60, 0, 1.2);
    // No rain, no rain synth: off the graph, an unconnected node is not computed.
    const wet = rain > 0.002 || this.rainGain.gain.value > 0.002;
    if (wet !== this._wet) {
      this._wet = wet;
      if (wet) {
        this.rainGain.connect(this.mixer.bus('environment'));
        this.rainBodyGain.connect(this.mixer.bus('environment'));
      } else {
        this.rainGain.disconnect();
        this.rainBodyGain.disconnect();
      }
    }
    this.rainGain.gain.setTargetAtTime(rain * (inside ? 0.16 : 0.3) * rainSpeed * 0.8, t, 0.3);
    this.rainBP.frequency.setTargetAtTime(2600 + rain * 1800, t, 0.3);
    this.rainBodyGain.gain.setTargetAtTime(inside ? rain * 0.16 * rainSpeed : rain * 0.07, t, 0.3);

    /* Tyres. */
    const rolling = ac.onGround && ac.groundSpeed > 0.3;
    const speedRoll = clamp(ac.groundSpeed / 45, 0, 1);
    this.rollGain.gain.setTargetAtTime(rolling ? (0.05 + speedRoll * 0.34) * far : 0, t, 0.08);
    this.rollFilter.frequency.setTargetAtTime(120 + speedRoll * 520, t, 0.12);
    this.rollFilter.Q.setTargetAtTime(ac.controls.brakes > 0.5 ? 3.4 : 1.1, t, 0.15);
    // The joints in the concrete, a soft thud per slab; grass has none.
    this._rolled = rolling ? this._rolled + ac.groundSpeed * dt : 0;
    if (this._rolled > 15 && ac.pos && isPaved(ac.pos.x, ac.pos.z)) {
      this.mixer.noiseBurst({ bus: 'environment', duration: 0.1, gain: (inside ? 0.09 : 0.05) + speedRoll * 0.12, freq: 240, q: 1.2, attack: 0.004 });
    }
    if (this._rolled > 15) this._rolled = 0;

    /* Cabin bed. */
    this.cabinGain.gain.setTargetAtTime(inside ? 0.09 + ac.rpm * 0.05 + clamp(v / 130, 0, 1) * 0.2 : 0.0, t, 0.3);
    this.cabinFilter.frequency.setTargetAtTime(300 + ac.rpm * 160 + clamp(v / 130, 0, 1) * 260, t, 0.3);

    /* Cloud whiteout adds a muffled hush. */
    if (cloudImmersion > 0.2) {
      this.windFilter.Q.setTargetAtTime(0.35, t, 0.3);
    }
  }
}

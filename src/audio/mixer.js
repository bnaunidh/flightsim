/**
 * Audio mixer.
 *
 * All sound in this simulator is synthesised live with the Web Audio API —
 * there are no audio files to download, so the game sounds exactly the same
 * offline as it does online, and every sample is original to the project.
 *
 * Five independent buses (engine, environment, ATC, alerts, music) hang off a
 * master gain, matching the five sliders in the settings screen.
 */

export const BUSES = ['engine', 'environment', 'atc', 'alerts', 'music'];

export class AudioMixer {
  constructor() {
    this.ctx = null;
    this.buses = {};
    this.volumes = { master: 0.85, engine: 0.8, environment: 0.7, atc: 0.85, alerts: 0.9, music: 0.35 };
    this.muted = false;
    this._noise = null;
    this._pink = null;
    this.ready = false;
    this.failed = false;
  }

  /** Create (or resume) the context. Must be called from a user gesture. */
  async ensure() {
    if (this.failed) return false;
    try {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) {
          this.failed = true;
          return false;
        }
        this.ctx = new AC({ latencyHint: 'interactive' });
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volumes.master;
        // A gentle limiter keeps layered synthesis from clipping.
        this.limiter = this.ctx.createDynamicsCompressor();
        this.limiter.threshold.value = -8;
        this.limiter.knee.value = 6;
        this.limiter.ratio.value = 9;
        this.limiter.attack.value = 0.004;
        this.limiter.release.value = 0.16;
        this.master.connect(this.limiter);
        this.limiter.connect(this.ctx.destination);
        for (const b of BUSES) {
          const g = this.ctx.createGain();
          g.gain.value = this.volumes[b];
          g.connect(this.master);
          this.buses[b] = g;
        }
        this.ready = true;
      }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return true;
    } catch (err) {
      console.warn('Audio unavailable:', err);
      this.failed = true;
      return false;
    }
  }

  get time() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  bus(name) {
    return this.buses[name] || this.master;
  }

  /**
   * Switch a whole source on or off, keeping whatever volume it had.
   *
   * Separate from the slider on purpose: turning the ATC down to zero and
   * forgetting is not the same as switching the radio off, and only one of
   * those is obvious to undo.
   */
  setBusEnabled(name, on) {
    this.off = this.off || {};
    this.off[name] = !on;
    // Re-apply through the same path, so the switch and the slider can never
    // disagree about what the gain ought to be.
    this.setVolume(name, this.volumes[name] != null ? this.volumes[name] : 1);
  }

  busEnabled(name) {
    return !(this.off && this.off[name]);
  }

  setVolume(name, value) {
    this.volumes[name] = value;
    if (!this.ctx) return;
    const gain = this.busEnabled(name) ? value : 0;
    if (name === 'master') {
      this.master.gain.setTargetAtTime(this.muted ? 0 : gain, this.time, 0.05);
    } else if (this.buses[name]) {
      this.buses[name].gain.setTargetAtTime(gain, this.time, 0.05);
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : this.volumes.master, this.time, 0.04);
  }

  /** Shared white-noise buffer (2 s, looped). */
  noiseBuffer() {
    if (!this._noise) {
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this._noise = buf;
    }
    return this._noise;
  }

  /** Pink-ish noise (Voss-McCartney): better for wind and rain than white. */
  pinkBuffer() {
    if (!this._pink) {
      const len = this.ctx.sampleRate * 3;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
      this._pink = buf;
    }
    return this._pink;
  }

  /** Looping noise source, already started. */
  noiseSource(pink = false) {
    const src = this.ctx.createBufferSource();
    src.buffer = pink ? this.pinkBuffer() : this.noiseBuffer();
    src.loop = true;
    src.start();
    return src;
  }

  /** One-shot noise burst with an envelope; returns the gain node. */
  noiseBurst({ bus = 'environment', duration = 0.3, gain = 0.5, type = 'bandpass', freq = 1200, q = 1, attack = 0.005, pink = false } = {}) {
    if (!this.ctx) return null;
    const src = this.ctx.createBufferSource();
    src.buffer = pink ? this.pinkBuffer() : this.noiseBuffer();
    src.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = this.ctx.createGain();
    const t = this.time;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.bus(bus));
    src.start(t);
    src.stop(t + duration + 0.05);
    return { gain: g, filter, src };
  }

  /** Simple synth tone with an envelope — used for beeps and chimes. */
  tone({ bus = 'alerts', freq = 880, duration = 0.2, gain = 0.25, type = 'sine', attack = 0.005, detune = 0, sweepTo = null } = {}) {
    if (!this.ctx) return null;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    const g = this.ctx.createGain();
    const t = this.time;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + duration);
    osc.connect(g);
    g.connect(this.bus(bus));
    osc.start(t);
    osc.stop(t + duration + 0.05);
    return { osc, gain: g };
  }

  /** Waveshaper curve for gentle analogue-style distortion. */
  distortionCurve(amount = 12) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x));
    }
    return curve;
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }
}

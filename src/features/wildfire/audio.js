/**
 * The fire's sounds, made from the game's own noise buffers.
 *
 * Everything goes through sim.audio.mixer on the 'environment' bus, so the
 * mute key, the master volume and the environment slider all apply without
 * this file knowing they exist. Quiet by design: the loudest thing here — a
 * big fire right under you — peaks at a gain of 0.07, below the wind in the
 * wires. Nothing speaks. Every sound is a filtered noise or a short tone.
 *
 *   roar     pink noise through a low-pass, the rumble of a big fire
 *   crackle  short band-passed clicks at random, faster the closer you are
 *   whoosh   the water leaving — a falling low-pass sweep
 *   hiss     steam where it lands on flames
 *   scoop    a steady hiss while the tank or bucket is taking on water
 *   full     a soft rising tone when it is full, and when the crews take over
 *   alert    two short falling beeps when an ember lands across the line
 */

export class FireAudio {
  constructor() {
    this.roar = null;
    this.scoop = null;
    this._crackleT = 0;
  }

  mixer(sim) {
    const a = sim && sim.audio;
    if (!a || !a.available || !a.mixer || !a.mixer.ctx) return null;
    return a.mixer;
  }

  _loop(m, pink, type, freq, q) {
    try {
      const src = m.noiseSource(pink);
      const f = m.ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = m.ctx.createGain();
      g.gain.value = 0;
      src.connect(f);
      f.connect(g);
      g.connect(m.bus('environment'));
      return { src, f, g };
    } catch (e) {
      return null;
    }
  }

  /**
   * @param {number} near   0..1, how close and how big the fire is
   * @param {boolean} scooping
   */
  update(sim, dt, near, scooping) {
    const m = this.mixer(sim);
    if (!m) return;
    if (near > 0.01 && !this.roar) this.roar = this._loop(m, true, 'lowpass', 380, 0.6);
    if (this.roar) this.roar.g.gain.setTargetAtTime(Math.min(0.07, near * 0.07), m.time, 0.4);
    if (scooping && !this.scoop) this.scoop = this._loop(m, false, 'bandpass', 2400, 0.5);
    if (this.scoop) this.scoop.g.gain.setTargetAtTime(scooping ? 0.035 : 0, m.time, 0.15);
    if (near > 0.05) {
      this._crackleT -= dt;
      if (this._crackleT <= 0) {
        this._crackleT = 0.05 + Math.random() * (0.5 - near * 0.4);
        m.noiseBurst({
          bus: 'environment',
          duration: 0.03 + Math.random() * 0.05,
          gain: 0.012 + near * 0.05 * Math.random(),
          type: 'bandpass',
          freq: 1800 + Math.random() * 3200,
          q: 2.5,
        });
      }
    }
  }

  whoosh(sim, big = 1) {
    const m = this.mixer(sim);
    if (!m) return;
    const r = m.noiseBurst({ bus: 'environment', duration: 1.4, gain: 0.07 * big, type: 'lowpass', freq: 1400, q: 0.7, attack: 0.05, pink: true });
    if (r && r.filter) r.filter.frequency.exponentialRampToValueAtTime(260, m.time + 1.3);
  }

  hiss(sim, amount = 1) {
    const m = this.mixer(sim);
    if (!m) return;
    m.noiseBurst({ bus: 'environment', duration: 1.6, gain: Math.min(0.06, 0.02 + amount * 0.01), type: 'highpass', freq: 3200, q: 0.5, attack: 0.08 });
  }

  full(sim) {
    const m = this.mixer(sim);
    if (!m) return;
    m.tone({ bus: 'alerts', freq: 660, sweepTo: 990, duration: 0.32, gain: 0.06, type: 'sine' });
  }

  /** Two short falling beeps: a new spot fire. */
  alert(sim) {
    const m = this.mixer(sim);
    if (!m) return;
    m.tone({ bus: 'alerts', freq: 880, sweepTo: 700, duration: 0.14, gain: 0.05, type: 'triangle' });
    setTimeout(() => {
      const m2 = this.mixer(sim);
      if (m2) m2.tone({ bus: 'alerts', freq: 880, sweepTo: 700, duration: 0.14, gain: 0.05, type: 'triangle' });
    }, 190);
  }

  empty(sim) {
    const m = this.mixer(sim);
    if (!m) return;
    m.tone({ bus: 'alerts', freq: 330, duration: 0.18, gain: 0.05, type: 'triangle' });
  }

  stop(sim) {
    const m = this.mixer(sim);
    for (const k of ['roar', 'scoop']) {
      const l = this[k];
      if (!l) continue;
      try {
        if (m) l.g.gain.setTargetAtTime(0, m.time, 0.1);
        l.src.stop((m ? m.time : 0) + 0.5);
      } catch (e) {
        /* already stopped */
      }
      this[k] = null;
    }
  }
}

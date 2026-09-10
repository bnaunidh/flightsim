/**
 * Gentle ambient music.
 *
 * A slow four-chord pad, synthesised: three detuned triangle voices per note
 * through a soft lowpass, with a very slow filter sweep. Quiet enough to fly
 * over, and it can be turned off entirely in the settings.
 */

const PROGRESSION = [
  [220.0, 277.18, 329.63], // A minor-ish
  [174.61, 220.0, 261.63], // F
  [196.0, 246.94, 293.66], // G
  [164.81, 207.65, 246.94], // E minor
];

export class Music {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.playing = false;
    this.step = 0;
    this.timer = 0;
    this.chordLength = 7.5;
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.filter = ctx.createBiquadFilter();
    this.filter.type = 'lowpass';
    this.filter.frequency.value = 900;
    this.filter.Q.value = 0.6;
    this.out.connect(this.filter);
    this.filter.connect(m.bus('music'));

    // Slow breathing movement in the filter.
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 0.045;
    this.lfoGain = ctx.createGain();
    this.lfoGain.gain.value = 320;
    this.lfo.connect(this.lfoGain);
    this.lfoGain.connect(this.filter.frequency);
    this.lfo.start();

    this.built = true;
  }

  playChord(freqs) {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const len = this.chordLength;
    for (const f of freqs) {
      for (const detune of [-6, 0, 7]) {
        const osc = ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = f;
        osc.detune.value = detune;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.05, t + 2.2);
        g.gain.linearRampToValueAtTime(0.035, t + len * 0.7);
        g.gain.linearRampToValueAtTime(0.0001, t + len + 1.2);
        osc.connect(g);
        g.connect(this.out);
        osc.start(t);
        osc.stop(t + len + 1.4);
      }
    }
  }

  start() {
    if (!this.built) this.build();
    if (!this.built || this.playing) return;
    this.playing = true;
    this.out.gain.setTargetAtTime(1, this.ctx.currentTime, 1.5);
    this.timer = 0;
    this.playChord(PROGRESSION[this.step % PROGRESSION.length]);
    this.step++;
  }

  stop() {
    if (!this.built || !this.playing) return;
    this.playing = false;
    this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 1.2);
  }

  update(dt) {
    if (!this.playing) return;
    this.timer += dt;
    if (this.timer >= this.chordLength) {
      this.timer = 0;
      this.playChord(PROGRESSION[this.step % PROGRESSION.length]);
      this.step++;
    }
  }
}

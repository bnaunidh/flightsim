/**
 * Every sound the flight events make.
 *
 * All of it is synthesised here with Web Audio — oscillators, filters and the
 * mixer's shared noise buffers. No files, no speech. And all of it is QUIET:
 * the loudest thing in this file peaks at a tenth of full scale, the sirens
 * at six hundredths, and everything runs through the mixer's buses so the
 * player's own sliders and the mute button apply to it like everything else.
 *
 * Every function here is safe to call when the audio has not started (the
 * browser has not had its first click yet, or the mixer failed): it does
 * nothing and says nothing. A silent game is a perfectly good game.
 */

/** The mixer, if there is one that can make a sound right now. */
function mixerOf(sim) {
  const a = sim && sim.audio;
  if (!a || !a.available || !a.mixer || !a.mixer.ctx) return null;
  return a.mixer;
}

/**
 * One enveloped oscillator, scheduled on the audio clock. The mixer's own
 * tone() only plays "now"; the chimes and the moo need notes a fixed
 * distance apart, and setTimeout drifts on a busy Chromebook.
 */
function note(m, { freq, when = 0, dur = 0.3, gain = 0.06, type = 'sine', sweepTo = null, attack = 0.01, bus = 'environment', filter = null }) {
  const ctx = m.ctx;
  const t = ctx.currentTime + Math.max(0, when);
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let head = osc;
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = filter.type || 'lowpass';
    f.frequency.value = filter.freq || 1200;
    f.Q.value = filter.q || 0.8;
    osc.connect(f);
    head = f;
  }
  head.connect(g);
  g.connect(m.bus(bus));
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

/** Cabin interphone: the two-note ding-dong every passenger knows. */
export function chime(sim) {
  const m = mixerOf(sim);
  if (!m) return;
  note(m, { freq: 659, dur: 0.9, gain: 0.07, bus: 'alerts', attack: 0.004 });
  note(m, { freq: 523, when: 0.42, dur: 1.2, gain: 0.07, bus: 'alerts', attack: 0.004 });
}

/**
 * The emergency call from the cabin: the interphone chime three times.
 * Airlines use the number of chimes to say how urgent a call is, and three
 * is the one every crew member drops everything for.
 */
export function chime3(sim) {
  const m = mixerOf(sim);
  if (!m) return;
  for (let i = 0; i < 3; i++) {
    note(m, { freq: 784, when: i * 0.55, dur: 0.5, gain: 0.06, bus: 'alerts', attack: 0.004 });
  }
}

/**
 * Somebody trying the flight deck door: heavy, dull thumps through a door
 * built to take them. Low and short, with a little wooden knock on top —
 * the sound of it not opening.
 */
export function doorBang(sim, hits = 4) {
  const m = mixerOf(sim);
  if (!m) return;
  const now = m.ctx.currentTime;
  for (let i = 0; i < hits; i++) {
    const when = i * (0.32 + (i % 2) * 0.1);
    note(m, { freq: 82, sweepTo: 48, when, dur: 0.22, gain: 0.08, attack: 0.002 });
    m.noiseBurst({ bus: 'environment', duration: 0.09, gain: 0.05, type: 'lowpass', freq: 520, q: 0.8, when: now + when });
  }
}

/** The door-entry request buzzer on the flight deck: a flat, insistent buzz. */
export function buzzer(sim, seconds = 1.1) {
  const m = mixerOf(sim);
  if (!m) return;
  note(m, { freq: 340, dur: seconds, gain: 0.035, type: 'square', attack: 0.01, bus: 'alerts', filter: { type: 'lowpass', freq: 1400 } });
  note(m, { freq: 347, dur: seconds, gain: 0.02, type: 'square', attack: 0.01, bus: 'alerts', filter: { type: 'lowpass', freq: 1400 } });
}

/**
 * An angry voice you cannot quite make out — through a door, or down the
 * interphone. Not words and not speech synthesis: bursts of a low buzzy
 * tone through a vowel-ish band-pass, in an uneven rhythm, the way a raised
 * voice sounds from the other side of something. The words are on the card.
 *
 * @param {number} syllables  roughly how long he goes on for
 * @param {boolean} phone     thinner and more band-limited, as down a handset
 */
export function grumble(sim, syllables = 7, phone = false) {
  const m = mixerOf(sim);
  if (!m) return;
  let t = 0;
  const lo = phone ? 520 : 380;
  for (let i = 0; i < syllables; i++) {
    const dur = 0.11 + Math.random() * 0.12;
    const f0 = 118 + Math.random() * 34 + (i === 0 ? 20 : 0);
    note(m, {
      freq: f0,
      sweepTo: f0 * (0.78 + Math.random() * 0.1),
      when: t,
      dur,
      gain: phone ? 0.05 : 0.06,
      type: 'sawtooth',
      attack: 0.015,
      filter: { type: 'bandpass', freq: lo + Math.random() * 520, q: phone ? 2.4 : 1.6 },
    });
    t += dur + 0.03 + (Math.random() < 0.25 ? 0.18 : 0);
  }
}

/**
 * Keying the microphone without saying anything. Two clicks is a "yes" —
 * the way a pilot who cannot talk answers a question on the radio.
 */
export function micClick(sim, n = 2) {
  const m = mixerOf(sim);
  if (!m) return;
  const now = m.ctx.currentTime;
  for (let i = 0; i < n; i++) {
    const when = now + i * 0.42;
    m.noiseBurst({ bus: 'atc', duration: 0.03, gain: 0.08, type: 'highpass', freq: 1800, q: 0.7, when });
    m.noiseBurst({ bus: 'atc', duration: 0.16, gain: 0.03, type: 'bandpass', freq: 2200, q: 0.5, when: when + 0.02 });
    m.noiseBurst({ bus: 'atc', duration: 0.025, gain: 0.07, type: 'highpass', freq: 1800, q: 0.7, when: when + 0.2 });
  }
}

/** The transponder taking a new code: one small, dry blip — nothing anybody behind you would notice. */
export function blip(sim) {
  const m = mixerOf(sim);
  if (!m) return;
  note(m, { freq: 1320, dur: 0.06, gain: 0.03, type: 'sine', attack: 0.002, bus: 'alerts' });
}

/** A low thump, felt more than heard: the police team going in. */
export function thud(sim) {
  const m = mixerOf(sim);
  if (!m) return;
  note(m, { freq: 70, sweepTo: 40, dur: 0.35, gain: 0.07, attack: 0.003 });
}

/** A bubble going pop. */
export function pop(sim) {
  const m = mixerOf(sim);
  if (!m) return;
  m.noiseBurst({ bus: 'environment', duration: 0.07, gain: 0.07, type: 'highpass', freq: 2400, q: 0.7 });
  note(m, { freq: 700, sweepTo: 1800, dur: 0.08, gain: 0.05, attack: 0.002 });
}

/** The pizza car's horn: a cheerful, slightly rubbish beep-beep. */
export function honk(sim, level = 1) {
  const m = mixerOf(sim);
  if (!m || level < 0.05) return;
  for (let i = 0; i < 2; i++) {
    note(m, { freq: 440, when: i * 0.24, dur: 0.18, gain: 0.05 * level, type: 'square', filter: { type: 'lowpass', freq: 1500 } });
    note(m, { freq: 554, when: i * 0.24, dur: 0.18, gain: 0.035 * level, type: 'square', filter: { type: 'lowpass', freq: 1500 } });
  }
}

/** A little fanfare for a happy ending. */
export function fanfare(sim) {
  const m = mixerOf(sim);
  if (!m) return;
  const notes = [523, 659, 784, 1047];
  notes.forEach((f, i) => note(m, { freq: f, when: i * 0.13, dur: i === 3 ? 0.9 : 0.22, gain: 0.05, type: 'triangle', bus: 'alerts' }));
}

/**
 * Applause and cheering: a crowd is just a lot of short bright clicks at
 * random times, and a soft wash underneath.
 */
export function cheer(sim, seconds = 2.6, level = 1) {
  const m = mixerOf(sim);
  if (!m) return;
  const now = m.ctx.currentTime;
  const claps = Math.round(34 * seconds);
  for (let i = 0; i < claps; i++) {
    const when = now + Math.random() * seconds;
    m.noiseBurst({
      bus: 'environment',
      duration: 0.03 + Math.random() * 0.03,
      gain: (0.02 + Math.random() * 0.03) * level,
      type: 'bandpass',
      freq: 1300 + Math.random() * 1600,
      q: 1.2,
      when,
    });
  }
  m.noiseBurst({ bus: 'environment', duration: seconds, gain: 0.012 * level, type: 'bandpass', freq: 900, q: 0.6, attack: 0.4, pink: true });
}

/**
 * A continuous voice — a siren, the bee's buzz, the UFO's hum — whose level
 * the caller sets as it moves about. Built once, started once, and its
 * level changes are thinned to a few a second so a 60 Hz caller does not
 * pile hundreds of automation events onto the audio thread.
 */
export class Loop {
  constructor(sim, kind = 'wail', peak = 0.06) {
    this.m = mixerOf(sim);
    this.kind = kind;
    this.peak = peak;
    this.level = -1;
    this.nodes = [];
    this.gain = null;
    this.stopped = false;
    this._t = 0;
    if (!this.m) return;
    try {
      this.build();
    } catch (e) {
      console.warn('[events] a looping sound could not be built; carrying on without it.', e);
      this.gain = null;
    }
  }

  build() {
    const ctx = this.m.ctx;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    g.connect(this.m.bus('environment'));
    this.gain = g;
    const osc = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    if (this.kind === 'wail' || this.kind === 'hilo') {
      // A rising-and-falling American wail, or the European two-tone.
      osc.type = 'sawtooth';
      osc.frequency.value = this.kind === 'wail' ? 780 : 800;
      lfo.type = this.kind === 'wail' ? 'sine' : 'square';
      lfo.frequency.value = this.kind === 'wail' ? 0.3 : 1.05;
      depth.gain.value = this.kind === 'wail' ? 320 : 110;
      filt.frequency.value = 1800;
    } else if (this.kind === 'buzz') {
      // The bee: a low sawtooth with a fast flutter on it.
      osc.type = 'sawtooth';
      osc.frequency.value = 150;
      lfo.type = 'sine';
      lfo.frequency.value = 7;
      depth.gain.value = 9;
      filt.frequency.value = 900;
    } else if (this.kind === 'drone') {
      // Tension: a low, dark pulse under everything, like a film score
      // holding its breath. A triangle a fifth below the engines, with a
      // slow swell on the filter rather than the pitch.
      osc.type = 'triangle';
      osc.frequency.value = 55;
      lfo.type = 'sine';
      lfo.frequency.value = 0.18;
      depth.gain.value = 1.2;
      filt.frequency.value = 260;
      const second = ctx.createOscillator();
      second.type = 'sine';
      second.frequency.value = 82.4;
      const sg = ctx.createGain();
      sg.gain.value = 0.5;
      second.connect(sg);
      sg.connect(filt);
      second.start();
      this.nodes.push(second);
    } else if (this.kind === 'jet') {
      // A fighter going past: rushing noise with a whine in it.
      const n = this.m.noiseSource(true);
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 700;
      band.Q.value = 0.6;
      n.connect(band);
      band.connect(filt);
      this.nodes.push(n);
      osc.type = 'sawtooth';
      osc.frequency.value = 1900;
      lfo.type = 'sine';
      lfo.frequency.value = 0.4;
      depth.gain.value = 60;
      filt.frequency.value = 2400;
      const whine = ctx.createGain();
      whine.gain.value = 0.08;
      osc.connect(whine);
      whine.connect(filt);
      lfo.connect(depth);
      depth.connect(osc.frequency);
      filt.connect(g);
      osc.start();
      lfo.start();
      this.nodes.push(osc, lfo);
      return;
    } else {
      // The UFO: a round, wobbling hum.
      osc.type = 'sine';
      osc.frequency.value = 96;
      lfo.type = 'sine';
      lfo.frequency.value = 3.2;
      depth.gain.value = 14;
      filt.frequency.value = 600;
    }
    lfo.connect(depth);
    depth.connect(osc.frequency);
    osc.connect(filt);
    filt.connect(g);
    osc.start();
    lfo.start();
    this.nodes.push(osc, lfo);
  }

  /** 0..1. Called every frame; only a handful of those reach the audio thread. */
  set(level, dt = 0.016) {
    if (!this.gain || this.stopped) return;
    this._t -= dt;
    const v = Math.max(0, Math.min(1, level));
    if (this._t > 0 && Math.abs(v - this.level) < 0.08) return;
    this._t = 0.12;
    this.level = v;
    this.gain.gain.setTargetAtTime(Math.max(0.0001, v * this.peak), this.m.ctx.currentTime, 0.12);
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (!this.gain) return;
    const t = this.m.ctx.currentTime;
    try {
      this.gain.gain.setTargetAtTime(0.0001, t, 0.08);
      for (const n of this.nodes) n.stop(t + 0.6);
    } catch (e) {
      /* already stopped — nothing to do */
    }
    const g = this.gain;
    setTimeout(() => {
      try { g.disconnect(); } catch (e) { /* gone already */ }
    }, 900);
  }
}

/** How loud something is at a distance: full inside `near`, gone by `far`. */
export function falloff(d, near = 60, far = 1400) {
  if (d <= near) return 1;
  if (d >= far) return 0;
  const f = 1 - (d - near) / (far - near);
  return f * f;
}

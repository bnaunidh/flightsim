/**
 * Air-traffic-control radio.
 *
 * There is no speech synthesiser and no voice recording here — deliberately.
 * What you hear is a formant-filtered pulse train: the same three-resonance
 * model that makes a human vowel sound human, driven by a pitch contour and a
 * syllable rhythm derived from the actual message text, then pushed through a
 * proper radio chain — 300–2800 Hz band, soft clipping, squelch bursts, relay
 * clicks, AM interference and dropouts.
 *
 * The result is unmistakably "someone talking on the radio" without ever
 * forming words, which is exactly what an indistinct radio transmission is. The
 * words themselves are delivered as subtitles, so nothing is lost — and no
 * synthetic voice is pretending to be a person.
 */

import { clamp, lerp, makeRandom } from '../core/noise.js';

/** Vowel formants (F1, F2, F3) in Hz. */
const VOWELS = [
  [730, 1090, 2440], // a
  [530, 1840, 2480], // e
  [270, 2290, 3010], // i
  [570, 840, 2410], // o
  [300, 870, 2240], // u
  [640, 1190, 2390], // æ
  [490, 1350, 1690], // ə
];

/**
 * Who is on the frequency.
 *
 * `f0` is the speaker's pitch, `rate` their pace, `radio` how hard the signal
 * is squeezed through the radio chain. They are spread deliberately wide: the
 * tower is a slow low drawl, approach is quick and clipped, the instructor sits
 * next to you so barely goes through the radio at all. Told apart by ear, the
 * way real frequencies are.
 *
 * `tts` supplies pitch and rate for the optional browser-speech mode, so the
 * same characters stay recognisable either way.
 */
export const VOICES = {
  tower: { f0: 98, spread: 9, radio: 1.0, rate: 0.92, label: 'Kestrel Tower', tts: { pitch: 0.75, rate: 0.95 } },
  ground: { f0: 88, spread: 7, radio: 1.08, rate: 0.86, label: 'Kestrel Ground', tts: { pitch: 0.65, rate: 0.88 } },
  approach: { f0: 122, spread: 13, radio: 0.95, rate: 1.14, label: 'Island Approach', tts: { pitch: 1.0, rate: 1.15 } },
  instructor: { f0: 148, spread: 15, radio: 0.28, rate: 0.98, label: 'Instructor', tts: { pitch: 1.15, rate: 0.95 } },
  traffic: { f0: 132, spread: 17, radio: 1.2, rate: 1.16, label: 'Cessna 4-2-Papa', tts: { pitch: 1.1, rate: 1.15 } },
  village: { f0: 138, spread: 12, radio: 1.12, rate: 1.02, label: 'Mango Cay', tts: { pitch: 1.2, rate: 1.0 } },
};

/**
 * How the radio calls are voiced.
 *
 *   'radio'      the default — formant chatter through a radio chain. No
 *                text-to-speech and no AI voices anywhere in it.
 *   'speech'     the browser's own speech synthesiser (your operating system's
 *                voice). This *is* text-to-speech; it is opt-in for that
 *                reason and off unless you choose it.
 *   'recordings' clips you have supplied yourself in assets/atc/. Falls back to
 *                'radio' for any line you have not recorded.
 */
export const ATC_MODES = ['radio', 'speech', 'recordings'];

/** Break a message into syllable timings that match how it reads aloud. */
function syllabify(text) {
  const words = String(text)
    .replace(/[^\w\s'’\-.,!?]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  const out = [];
  for (const w of words) {
    const clean = w.replace(/[.,!?]/g, '');
    // Rough syllable count: vowel groups, minimum one.
    const groups = clean.toLowerCase().match(/[aeiouy]+/g);
    let n = groups ? groups.length : Math.max(1, Math.round(clean.length / 3));
    // Digits are read one at a time — "one two zero" not "120".
    if (/^\d+$/.test(clean)) n = clean.length;
    n = clamp(n, 1, 5);
    const stress = Math.floor(Math.random() * n);
    for (let i = 0; i < n; i++) {
      out.push({
        vowel: (clean.charCodeAt(i % clean.length) + i * 7) % VOWELS.length,
        stressed: i === stress,
        wordEnd: i === n - 1,
        punct: /[.,!?]$/.test(w) ? w.slice(-1) : '',
      });
    }
  }
  return out;
}

export class Radio {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.rnd = makeRandom(20260730);
    this.chatterTimer = 18 + Math.random() * 20;
    this.backgroundChatter = true;
    this.busyUntil = 0;
    this.queue = [];
    this.onSubtitle = null;
    /** 'radio' (default, no TTS) | 'speech' (browser TTS) | 'recordings'. */
    this.mode = 'radio';
    /** Decoded clips keyed by line, if the player has supplied any. */
    this.clips = null;
  }

  /** @param {'radio'|'speech'|'recordings'} mode */
  setMode(mode) {
    this.mode = ATC_MODES.includes(mode) ? mode : 'radio';
    if (this.mode !== 'speech' && typeof speechSynthesis !== 'undefined') {
      try {
        speechSynthesis.cancel();
      } catch {
        /* nothing to cancel */
      }
    }
    if (this.mode === 'recordings' && !this.clips && this.mixer.ctx) this.loadRecordings();
    return this.mode;
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;

    // --- The radio channel every voice passes through ---
    this.chainIn = ctx.createGain();
    this.chainIn.gain.value = 1;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 330;
    hp.Q.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2750;
    lp.Q.value = 0.9;
    // Mid presence peak: the classic "comms" honk.
    const peak = ctx.createBiquadFilter();
    peak.type = 'peaking';
    peak.frequency.value = 1700;
    peak.Q.value = 1.4;
    peak.gain.value = 7;

    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = m.distortionCurve(22);

    this.compress = ctx.createDynamicsCompressor();
    this.compress.threshold.value = -22;
    this.compress.ratio.value = 12;
    this.compress.attack.value = 0.003;
    this.compress.release.value = 0.09;

    // Interference: an amplitude wobble applied to the whole channel.
    this.amGain = ctx.createGain();
    this.amGain.gain.value = 1;
    this.amLfo = ctx.createOscillator();
    this.amLfo.type = 'sine';
    this.amLfo.frequency.value = 0.7;
    this.amDepth = ctx.createGain();
    this.amDepth.gain.value = 0.04;
    this.amLfo.connect(this.amDepth);
    this.amDepth.connect(this.amGain.gain);
    this.amLfo.start();

    this.chainIn.connect(hp);
    hp.connect(peak);
    peak.connect(lp);
    lp.connect(this.shaper);
    this.shaper.connect(this.compress);
    this.compress.connect(this.amGain);
    this.amGain.connect(m.bus('atc'));

    // --- Static bed, opened by the squelch while a transmission is live ---
    this.staticSrc = m.noiseSource(false);
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.frequency.value = 1500;
    sbp.Q.value = 0.35;
    this.staticGain = ctx.createGain();
    this.staticGain.gain.value = 0;
    this.staticSrc.connect(sbp);
    sbp.connect(this.staticGain);
    this.staticGain.connect(m.bus('atc'));

    this.built = true;
  }

  /** Relay click — the little clack a real PTT switch makes. */
  click(when, level = 0.16) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.mixer.noiseBuffer();
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.035);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.mixer.bus('atc'));
    src.start(when);
    src.stop(when + 0.06);
  }

  /** Squelch: the noise rush when the carrier opens or closes. */
  squelch(when, duration = 0.13, level = 0.2) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.mixer.noiseBuffer();
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    src.connect(bp);
    bp.connect(g);
    g.connect(this.mixer.bus('atc'));
    src.start(when);
    src.stop(when + duration + 0.05);
  }

  beep(when, freq = 1050, dur = 0.09, level = 0.12) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.exponentialRampToValueAtTime(level, when + 0.006);
    g.gain.setValueAtTime(level, when + dur - 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(this.chainIn);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  /**
   * Schedule one syllable of formant-filtered "speech".
   * Voiced syllables use a pulse train through three resonators; the onset gets
   * a short noise burst so consonants have some bite.
   */
  syllable(when, dur, f0, vowelIdx, stressed, radioAmount) {
    const ctx = this.ctx;
    const vowel = VOWELS[vowelIdx % VOWELS.length];

    const osc = ctx.createOscillator();
    // A sawtooth is a decent glottal pulse once the formants shape it.
    osc.type = 'sawtooth';
    const pitch = f0 * (stressed ? 1.09 : 1);
    osc.frequency.setValueAtTime(pitch * 0.97, when);
    osc.frequency.linearRampToValueAtTime(pitch, when + dur * 0.3);
    osc.frequency.linearRampToValueAtTime(pitch * 0.94, when + dur);
    // Vibrato keeps it from sounding like a synthesiser tone.
    const vib = ctx.createOscillator();
    vib.frequency.value = 4.6 + this.rnd() * 1.8;
    const vibGain = ctx.createGain();
    vibGain.gain.value = pitch * 0.012;
    vib.connect(vibGain);
    vibGain.connect(osc.frequency);
    vib.start(when);
    vib.stop(when + dur + 0.05);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, when);
    env.gain.exponentialRampToValueAtTime(stressed ? 0.5 : 0.34, when + dur * 0.22);
    env.gain.setValueAtTime(stressed ? 0.5 : 0.34, when + dur * 0.62);
    env.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(env);

    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const gains = [1.0, 0.62, 0.32];
    vowel.forEach((f, i) => {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f * (0.94 + this.rnd() * 0.12), when);
      // Formants glide during the syllable, which is what makes speech move.
      bp.frequency.linearRampToValueAtTime(f * (0.9 + this.rnd() * 0.2), when + dur);
      bp.Q.value = 7 + i * 3;
      const g = ctx.createGain();
      g.gain.value = gains[i];
      env.connect(bp);
      bp.connect(g);
      g.connect(mix);
    });
    mix.connect(this.chainIn);

    osc.start(when);
    osc.stop(when + dur + 0.05);

    // Consonant onset.
    if (this.rnd() < 0.66) {
      const src = ctx.createBufferSource();
      src.buffer = this.mixer.noiseBuffer();
      src.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = this.rnd() < 0.5 ? 'highpass' : 'bandpass';
      hp.frequency.value = 1400 + this.rnd() * 2600;
      hp.Q.value = 1.2;
      const g = ctx.createGain();
      const cd = 0.018 + this.rnd() * 0.03;
      g.gain.setValueAtTime(0.08 + this.rnd() * 0.09, when);
      g.gain.exponentialRampToValueAtTime(0.0001, when + cd);
      src.connect(hp);
      hp.connect(g);
      g.connect(this.chainIn);
      src.start(when);
      src.stop(when + cd + 0.03);
    }
  }

  /**
   * Transmit a message. Returns the duration in seconds so the caller can time
   * the subtitle.
   */
  transmit(text, { voice = 'tower', urgency = 0, level = 1, subtitle = true } = {}) {
    const m = this.mixer;
    if (!m.ctx) {
      // Audio not started yet: still surface the subtitle.
      if (subtitle && this.onSubtitle) this.onSubtitle({ text, voice, duration: 3.2 });
      return 3.2;
    }
    if (!this.built) this.build();

    const v = VOICES[voice] || VOICES.tower;

    // Optional voicing modes. Both keep the squelch, clicks and static of the
    // radio chain around the words, because that is most of what makes a
    // transmission sound like a transmission.
    if (this.mode === 'recordings') {
      const played = this.playRecording(text, v, level, subtitle, urgency);
      if (played != null) return played;
      // Nothing recorded for this line — fall through to the synthesised voice.
    } else if (this.mode === 'speech' && typeof speechSynthesis !== 'undefined') {
      return this.speakWithBrowser(text, v, level, subtitle, urgency);
    }
    const syl = syllabify(text);
    const start = Math.max(this.ctx.currentTime + 0.05, this.busyUntil + 0.28);

    // Carrier opens.
    this.click(start, 0.14 * level);
    this.squelch(start + 0.02, 0.11, 0.18 * level * v.radio);
    if (urgency > 0.5) {
      this.beep(start + 0.1, 1180, 0.08, 0.1);
      this.beep(start + 0.22, 1480, 0.08, 0.1);
    }

    let t = start + (urgency > 0.5 ? 0.38 : 0.16);
    const baseDur = 0.108 / v.rate;
    let f0 = v.f0;

    syl.forEach((s, i) => {
      const dur = baseDur * (s.stressed ? 1.28 : 1) * (0.85 + this.rnd() * 0.3);
      // Declarative pitch fall across the phrase, with a lift on stress.
      const progress = i / Math.max(1, syl.length - 1);
      const contour = 1 - progress * 0.14 + (s.stressed ? 0.05 : 0);
      this.syllable(t, dur, f0 * contour, s.vowel, s.stressed, v.radio);
      t += dur;
      if (s.wordEnd) t += 0.035 + this.rnd() * 0.03;
      if (s.punct === ',') t += 0.12;
      if (s.punct === '.' || s.punct === '!' || s.punct === '?') t += 0.2;
    });

    const speechEnd = t;
    const duration = speechEnd - start;

    // Static bed while the carrier is open, with dropouts and interference.
    const sg = this.staticGain.gain;
    sg.cancelScheduledValues(start);
    sg.setValueAtTime(0.0001, start);
    sg.linearRampToValueAtTime(0.02 + 0.05 * v.radio * level, start + 0.04);
    const dropouts = Math.floor(duration / 1.6);
    for (let i = 0; i < dropouts; i++) {
      const dt = start + 0.4 + this.rnd() * (duration - 0.6);
      if (this.rnd() < 0.55) {
        // Signal dip: the voice fades and the hiss rises.
        this.chainIn.gain.setValueAtTime(1, dt);
        this.chainIn.gain.linearRampToValueAtTime(0.25, dt + 0.05);
        this.chainIn.gain.linearRampToValueAtTime(1, dt + 0.16 + this.rnd() * 0.14);
        sg.setValueAtTime(0.02 + 0.05 * v.radio, dt);
        sg.linearRampToValueAtTime(0.11 * v.radio, dt + 0.05);
        sg.linearRampToValueAtTime(0.02 + 0.05 * v.radio, dt + 0.22);
      } else {
        // Heterodyne whistle drifting through the channel.
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(900 + this.rnd() * 1400, dt);
        osc.frequency.linearRampToValueAtTime(700 + this.rnd() * 1600, dt + 0.5);
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, dt);
        g.gain.linearRampToValueAtTime(0.02 * v.radio, dt + 0.1);
        g.gain.linearRampToValueAtTime(0.0001, dt + 0.5);
        osc.connect(g);
        g.connect(this.mixer.bus('atc'));
        osc.start(dt);
        osc.stop(dt + 0.55);
      }
    }
    sg.linearRampToValueAtTime(0.0001, speechEnd + 0.22);

    // Carrier closes.
    this.squelch(speechEnd + 0.04, 0.16, 0.22 * level * v.radio);
    this.click(speechEnd + 0.16, 0.1 * level);

    this.busyUntil = speechEnd + 0.3;
    this.amLfo.frequency.setValueAtTime(0.4 + this.rnd() * 1.4, start);
    this.amDepth.gain.setValueAtTime(0.02 + this.rnd() * 0.06 * v.radio, start);

    if (subtitle && this.onSubtitle) {
      this.onSubtitle({ text, voice: v.label, duration: duration + 0.4, urgency });
    }
    return duration;
  }

  /**
   * Optional: speak the line with the browser's own speech synthesiser.
   *
   * This is text-to-speech, plainly. It is off unless the player turns it on,
   * because the default radio deliberately uses none. The voice is whatever
   * the operating system provides — nothing is generated by a model, and
   * nothing is downloaded.
   *
   * The squelch and clicks still play around it so it lands as a radio call
   * rather than a phone announcement.
   */
  speakWithBrowser(text, v, level, subtitle, urgency) {
    const start = this.ctx.currentTime + 0.02;
    this.click(start, 0.14 * level);
    this.squelch(start + 0.02, 0.11, 0.18 * level * v.radio);

    // Roughly how long it will take to say — used to space the next call.
    const words = String(text).split(/\s+/).filter(Boolean).length;
    const est = Math.max(1.4, (words / 2.6) / (v.tts ? v.tts.rate : 1));

    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(String(text));
      u.pitch = v.tts ? v.tts.pitch : 1;
      u.rate = v.tts ? v.tts.rate : 1;
      u.volume = Math.min(1, 0.9 * level);
      // Prefer a local voice so it works with no network.
      const pick = speechSynthesis
        .getVoices()
        .find((x) => x.localService && /en[-_]/i.test(x.lang));
      if (pick) u.voice = pick;
      u.onend = () => {
        const end = this.ctx.currentTime + 0.03;
        this.squelch(end, 0.16, 0.22 * level * v.radio);
        this.click(end + 0.12, 0.1 * level);
      };
      speechSynthesis.speak(u);
    } catch {
      /* if speech is unavailable the clicks alone still cue the subtitle */
    }

    this.busyUntil = start + est + 0.3;
    if (subtitle && this.onSubtitle) {
      this.onSubtitle({ text, voice: v.label, duration: est + 0.4, urgency });
    }
    return est;
  }

  /**
   * Optional: play a recording you have supplied.
   *
   * Drop files into `assets/atc/` named after the line's first few words —
   * see the README. Returns null when there is no clip for this line, so the
   * caller falls back to the synthesised voice.
   */
  playRecording(text, v, level, subtitle, urgency) {
    const key = String(text)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60);
    const buf = this.clips && this.clips[key];
    if (!buf) return null;

    const start = Math.max(this.ctx.currentTime + 0.05, this.busyUntil + 0.28);
    this.click(start, 0.14 * level);
    this.squelch(start + 0.02, 0.11, 0.18 * level * v.radio);

    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    g.gain.value = level;
    // Straight through the same radio chain the synthesised voice uses, so a
    // real recording sits in the same acoustic space as everything else.
    src.connect(g);
    g.connect(this.chainIn);
    src.start(start + 0.12);

    const duration = buf.duration + 0.12;
    this.squelch(start + duration + 0.04, 0.16, 0.22 * level * v.radio);
    this.click(start + duration + 0.16, 0.1 * level);
    this.busyUntil = start + duration + 0.3;
    if (subtitle && this.onSubtitle) {
      this.onSubtitle({ text, voice: v.label, duration: duration + 0.4, urgency });
    }
    return duration;
  }

  /**
   * Load any clips the player has put in assets/atc/. Entirely optional: the
   * game ships with none, and missing files are not an error.
   */
  async loadRecordings(manifestUrl = 'assets/atc/manifest.json') {
    this.clips = this.clips || {};
    try {
      const res = await fetch(manifestUrl);
      if (!res.ok) return 0;
      const list = await res.json();
      let n = 0;
      for (const entry of list) {
        try {
          const r = await fetch(`assets/atc/${entry.file}`);
          if (!r.ok) continue;
          this.clips[entry.key] = await this.ctx.decodeAudioData(await r.arrayBuffer());
          n++;
        } catch {
          /* skip anything that will not decode */
        }
      }
      return n;
    } catch {
      return 0;
    }
  }

  /** Someone else on the frequency — pure atmosphere, never subtitled. */
  ambientChatter() {
    if (!this.built || !this.mixer.ctx) return;
    const gibberish = [
      'Kestrel Tower Cessna four two papa ready to taxi runway zero nine',
      'Island Approach November six one two descending seven thousand',
      'Roger that traffic is a Cessna two miles final runway zero nine',
      'Kestrel Ground requesting fuel at the north apron thank you',
      'Mango Cay this is Sea Bird four zero inbound with supplies',
    ];
    const pick = gibberish[Math.floor(this.rnd() * gibberish.length)];
    const voices = ['traffic', 'approach', 'ground', 'village'];
    this.transmit(pick, {
      voice: voices[Math.floor(this.rnd() * voices.length)],
      level: 0.45,
      subtitle: false,
    });
  }

  update(dt, weather) {
    if (!this.built) return;
    if (!this.backgroundChatter) return;
    this.chatterTimer -= dt;
    if (this.chatterTimer <= 0) {
      this.chatterTimer = 26 + this.rnd() * 34;
      if (this.ctx.currentTime > this.busyUntil + 1.5) this.ambientChatter();
    }
    // Storms make the radio noticeably worse.
    const noisy = weather && weather.condition === 'stormy';
    this.amDepth.gain.setTargetAtTime(noisy ? 0.12 : 0.04, this.ctx.currentTime, 0.5);
  }
}

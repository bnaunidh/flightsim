/**
 * The traffic, heard: the nearest aeroplane's engine, quietly.
 *
 * The first cut was silent. An aeroplane taxiing past your wing tip or
 * climbing out over your head made no sound at all, which from the apron
 * reads as a picture sliding across the screen. So the nearest one within a
 * kilometre makes a noise: a propeller's buzz (a sawtooth at the blade rate,
 * through a low-pass) or a jet's rush (pink noise through a band-pass, with a
 * little of the fan's whine), rising with its power setting and falling away
 * with distance, on the game's own environment bus, so the volume sliders
 * and the mute work on it and pausing (which suspends the whole mixer)
 * silences it.
 *
 * Quiet on purpose. At 30 m and full power it is about a tenth of full
 * scale before the bus and master gains; at 300 m, a hundredth. The player's
 * own engine is louder than all of it. Web Audio only, one voice, built the
 * first time there is something to hear; nothing if the game has no audio.
 */

export class TrafficSound {
  constructor() {
    this.built = false;
    this.failed = false;
    this.nodes = null;
    this.next = 0;
  }

  /** Build the voice on the game's mixer. Returns false if there is no audio. */
  build(mixer) {
    if (this.built) return true;
    if (this.failed || !mixer || !mixer.ctx) return false;
    try {
      const ctx = mixer.ctx;
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(mixer.bus('environment'));
      // Propeller: the blade-pass buzz.
      const prop = ctx.createOscillator();
      prop.type = 'sawtooth';
      prop.frequency.value = 70;
      const propLp = ctx.createBiquadFilter();
      propLp.type = 'lowpass';
      propLp.frequency.value = 420;
      propLp.Q.value = 0.8;
      const propG = ctx.createGain();
      propG.gain.value = 0;
      prop.connect(propLp).connect(propG).connect(out);
      prop.start();
      // Jet: the rush, and the fan's whine.
      const rush = mixer.noiseSource(true);
      const rushBp = ctx.createBiquadFilter();
      rushBp.type = 'bandpass';
      rushBp.frequency.value = 700;
      rushBp.Q.value = 0.6;
      const rushG = ctx.createGain();
      rushG.gain.value = 0;
      rush.connect(rushBp).connect(rushG).connect(out);
      const whine = ctx.createOscillator();
      whine.type = 'sine';
      whine.frequency.value = 2400;
      const whineG = ctx.createGain();
      whineG.gain.value = 0;
      whine.connect(whineG).connect(out);
      whine.start();
      this.nodes = { out, prop, propLp, propG, rush, rushBp, rushG, whine, whineG };
      this.built = true;
      return true;
    } catch (e) {
      this.failed = true;
      return false;
    }
  }

  /**
   * Ten times a second: `near` is { dist, rpm, jet } for the aeroplane to
   * hear, or null for silence.
   */
  update(mixer, near, now) {
    if (now < this.next) return;
    this.next = now + 0.1;
    if (!near) {
      this.silence(mixer);
      return;
    }
    if (!this.build(mixer)) return;
    const n = this.nodes;
    const t = mixer.time;
    const rpm = Math.max(0, Math.min(1, near.rpm));
    const fall = 1 / (1 + (near.dist / 90) ** 2);
    const level = 0.11 * (0.25 + 0.75 * rpm) * fall;
    n.out.gain.setTargetAtTime(level, t, 0.2);
    if (near.jet) {
      n.propG.gain.setTargetAtTime(0, t, 0.2);
      n.rushG.gain.setTargetAtTime(0.9, t, 0.2);
      n.whineG.gain.setTargetAtTime(0.05 + 0.08 * rpm, t, 0.2);
      n.rushBp.frequency.setTargetAtTime(500 + 900 * rpm, t, 0.3);
      n.whine.frequency.setTargetAtTime(1500 + 2200 * rpm, t, 0.4);
    } else {
      n.rushG.gain.setTargetAtTime(0.12, t, 0.2);
      n.whineG.gain.setTargetAtTime(0, t, 0.2);
      n.propG.gain.setTargetAtTime(0.7, t, 0.2);
      n.prop.frequency.setTargetAtTime(38 + 82 * rpm, t, 0.3);
      n.propLp.frequency.setTargetAtTime(260 + 500 * rpm, t, 0.3);
    }
  }

  silence(mixer) {
    if (!this.built || !mixer || !mixer.ctx) return;
    this.nodes.out.gain.setTargetAtTime(0, mixer.time, 0.15);
  }
}

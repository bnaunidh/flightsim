/**
 * Warnings and interface sounds.
 *
 * The stall warner is modelled on the real thing: a reed horn that moans
 * continuously while the wing is close to letting go, so you learn to react to
 * the sound rather than to a text label.
 *
 * ====================================================================
 * ONE SOUND PER CLASS OF ALERT
 * ====================================================================
 *
 * The cockpit warning system (src/features/warnings.js) decides WHEN; this
 * file decides what each class of alert SOUNDS like, and every class sounds
 * different, because a pilot is meant to know what is wrong before looking:
 *
 *   stall            reed horn, continuous                 (the flight model)
 *   gear not down    low pulsing horn, continuous
 *   overspeed        clacker
 *   ground proximity a rising "whoop" twice                 PULL UP, TERRAIN
 *   GPWS caution     two low "bup" pips                     SINK RATE, DON'T SINK
 *   bank angle       three quick high ticks
 *   windshear        a warbling two-note siren
 *   engine fire      a bell, rung three times
 *   master warning   three falling chimes                   ENGINE FAIL
 *   master caution   one soft two-note chime                everything amber
 *   traffic (TA)     two high soft pips
 *   traffic (RA)     three pips going the way to fly: up = climb, down = descend
 *   clear of conflict one up-slur
 *   radio altitude   one short pip, higher the lower you are  100 50 40 30 20 10
 *   autopilot off    the "cavalry charge" wail
 *
 * Every one of them is an oscillator or a noise burst. Nothing is a sample and
 * nothing is a voice: spoken words go through sim.speak, which follows the
 * player's own voice setting and is off (radio chatter) by default.
 *
 * Levels are deliberately low — 0.06 to 0.13 on the alerts bus. The class
 * plays this on laptops in a classroom.
 *
 * Every multi-note pattern is scheduled on the AUDIO clock rather than with
 * setTimeout, so the notes keep their spacing on a busy Chromebook and a
 * pattern started just before pause is suspended with the mixer rather than
 * finishing over the pause menu.
 */

import { clamp } from '../core/noise.js';
import { SPEC } from '../aircraft/physics.js';

/*
 * The stall warner's trigger, shared with the warning panel.
 *
 * It used to be `0.29 - ac.alpha` for every aircraft: the Skylark's stalling
 * angle, typed in. Measured against the roster (types.js, alphaStall): the
 * Vanguard stalls at 0.45 rad, so its horn sounded twelve degrees early — on
 * every slow turn — and the Nightjar stalls at 0.24, so with full flap (which
 * takes 0.03 off, to 0.21) its horn at 0.235 only came on AFTER the wing had
 * let go. And the helicopter, which has no wing to stall, got the reed horn
 * whenever it came down steeply: measured, a Harrier at 13 kt forward
 * descending at 12 m/s reads 85 degrees of "alpha" and the horn sounded from
 * 24 degrees.
 *
 * So the angle comes from the aircraft being flown, with the same flap and
 * icing penalties the flight model applies (physics.js, `aStall`), and a rotor
 * gets no stall horn at all.
 */
export const STALL_WARN_MARGIN = 0.055; // rad before the stall, on
export const STALL_CLEAR_MARGIN = 0.075; // rad before the stall, off again

/**
 * How close the wing is to stalling, in radians; negative once past it.
 * `spec` defaults to the live SPEC of the aircraft being flown.
 */
export function stallMargin(ac, spec = SPEC) {
  const base = spec && Number.isFinite(spec.alphaStall) ? spec.alphaStall : 0.29;
  const aStall = base - (ac.flaps || 0) * 0.03 - (ac.failures && ac.failures.icing ? 0.06 : 0);
  return aStall - (ac.alpha || 0);
}

/**
 * Should the stall warner be sounding? `wasOn` is last frame's answer, so the
 * horn has a small hysteresis band and does not flutter at the threshold.
 *
 * Not on the ground, not in a helicopter, and not in the last three metres of
 * a landing with the wheels down: a normal flare in the trainer reaches within
 * a few degrees of the stall on purpose, and a horn that sounds on every good
 * landing teaches a child to ignore it.
 */
export function stallWarning(ac, wasOn = false, spec = SPEC) {
  if (!ac || ac.onGround || ac.crashed) return false;
  if (spec && spec.rotor) return false;
  /*
   * Nor while the jet is holding itself up. The fighters team's F-35B hover
   * sets `ac.jetBorne` while its lift fans carry most of the weight; the wing
   * is not what is flying then, and descending in a hover into a 20 kt wind
   * puts its "alpha" past the horn (their measurement). Read defensively: no
   * other aeroplane has the field.
   */
  if (ac.jetBorne) return false;
  if (!(ac.airspeed > 6)) return false;
  if (ac.gearDown && ac.agl < 3) return false;
  const margin = stallMargin(ac, spec);
  return wasOn ? margin < STALL_CLEAR_MARGIN : margin < STALL_WARN_MARGIN;
}

/*
 * The gear horn's own trigger, for when the warning panel is not running.
 * The same idea as before — wheels up, low, power back, coming down — with the
 * hold time it never had, so level flight at 150 m with the throttle back does
 * not chirp every time the vertical speed crosses zero.
 */
function legacyGearCondition(ac) {
  return !ac.gearDown && !ac.onGround && ac.agl < 180 && ac.agl > 2 && ac.controls.throttle < 0.35 && ac.vs < -0.3;
}

export class Alerts {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.stallActive = false;
    this._stallSev = -1;
    this.gearWarnActive = false;
    this.terrainTimer = 0;
    this.overspeedTimer = 0;
    this._gearHold = 0;
    /*
     * Who is driving the gear horn and the ground-proximity sounds.
     *
     * The warning panel (src/features/warnings.js) claims them while it is
     * running, because it has the full picture — hysteresis, "you pressed R",
     * the gear AND the flaps. The simple rules in update() below are kept for
     * when it is not: switched off after an error, or never loaded. Without
     * this the game would have two gear horns and two terrain beeps.
     */
    this.claimed = false;
    /** Set when the player acknowledged the overspeed; cleared when it ends. */
    this.overspeedSilenced = false;
    this._lastCaution = -10;
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

    /*
     * The tremolo gets a stage of its own, in front of the gate.
     *
     * It used to be connected straight into stallGain.gain, and an AudioParam's
     * value is its intrinsic value plus everything connected to it. So the gate
     * could never reach silence: with the horn switched off the gain still
     * swung between plus and minus 0.35, and an 812 Hz reed sounded from the
     * first click, on the menu, before an aeroplane had moved. Worse, when the
     * wing really was stalling the intrinsic value only climbed to about 0.19
     * against that 0.35 of modulation, so the warning barely rose above the
     * drone it was hiding in.
     *
     * Modulating a node ahead of the gate multiplies the horn instead of being
     * added to it, so setStall(false) is genuinely silent and setStall(true) is
     * an unmistakable horn.
     */
    this.stallTremStage = ctx.createGain();
    this.stallTremStage.gain.value = 1;
    this.stallTremStage.connect(this.stallGain);

    this.stallOsc = ctx.createOscillator();
    this.stallOsc.type = 'square';
    this.stallOsc.frequency.value = 812;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.value = 900;
    sf.Q.value = 2.2;
    this.stallOsc.connect(sf);
    sf.connect(this.stallTremStage);

    this.stallOsc2 = ctx.createOscillator();
    this.stallOsc2.type = 'sawtooth';
    this.stallOsc2.frequency.value = 406;
    const sg2 = ctx.createGain();
    sg2.gain.value = 0.25;
    this.stallOsc2.connect(sg2);
    sg2.connect(this.stallTremStage);

    this.stallTrem = ctx.createOscillator();
    this.stallTrem.type = 'sine';
    this.stallTrem.frequency.value = 7.5;
    this.stallTremGain = ctx.createGain();
    // Depth of 0.3 about an intrinsic 1.0: the horn pulses between 0.7 and 1.3
    // of its level and never inverts.
    this.stallTremGain.gain.value = 0.3;
    this.stallTrem.connect(this.stallTremGain);
    this.stallTremGain.connect(this.stallTremStage.gain);

    /*
     * Gear warning: softer, lower, intermittent.
     *
     * The interruption used to be made by setting the oscillator's FREQUENCY
     * to 0.001 Hz half the time, every frame. A triangle wave at a thousandth
     * of a hertz is not silence, it is a slowly drifting DC level, and the
     * 10 ms glide between 460 Hz and nothing was a downward swoop on every
     * cycle. It is gated by a pulse stage now, the same trick as the stall
     * horn's tremolo: a square LFO into a gain in front of the gate, so the
     * horn is on-off-on-off at a steady 460 Hz and set once, not per frame.
     */
    this.gearGain = ctx.createGain();
    this.gearGain.gain.value = 0;
    this.gearGain.connect(m.bus('alerts'));
    this.gearPulse = ctx.createGain();
    this.gearPulse.gain.value = 0.5;
    this.gearPulse.connect(this.gearGain);
    this.gearOsc = ctx.createOscillator();
    this.gearOsc.type = 'triangle';
    this.gearOsc.frequency.value = 460;
    this.gearOsc.connect(this.gearPulse);
    this.gearLfo = ctx.createOscillator();
    this.gearLfo.type = 'square';
    this.gearLfo.frequency.value = 1.9;
    const gearLfoDepth = ctx.createGain();
    gearLfoDepth.gain.value = 0.5; // 0.5 ± 0.5: fully on, fully off
    this.gearLfo.connect(gearLfoDepth);
    gearLfoDepth.connect(this.gearPulse.gain);

    for (const o of [this.stallOsc, this.stallOsc2, this.stallTrem, this.gearOsc, this.gearLfo]) o.start();
    this.built = true;
  }

  setStall(on, severity = 1) {
    if (!this.built) return;
    // Only when something changed. This was called every frame, and every
    // call adds an automation event to two AudioParams.
    const sev = on ? Math.round(severity * 20) / 20 : 0;
    if (on === this.stallActive && sev === this._stallSev) return;
    this.stallActive = on;
    this._stallSev = sev;
    const t = this.ctx.currentTime;
    this.stallGain.gain.setTargetAtTime(on ? 0.10 + sev * 0.09 : 0, t, 0.05);
    this.stallOsc.frequency.setTargetAtTime(790 + sev * 90, t, 0.1);
  }

  setGearWarning(on) {
    if (!this.built || this.gearWarnActive === on) return;
    this.gearWarnActive = on;
    const t = this.ctx.currentTime;
    this.gearGain.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.08);
  }

  /** The warning panel takes over the gear horn and the terrain sounds. */
  claim() {
    this.claimed = true;
  }

  /** ...and hands them back: on stop, in the boat, and if it ever throws. */
  release() {
    if (!this.claimed) return;
    this.claimed = false;
    this.setGearWarning(false);
    this.overspeedSilenced = false;
  }

  overspeed() {
    // Acknowledged with R. It comes back the next time you go too fast.
    if (this.overspeedSilenced) return;
    const m = this.mixer;
    if (!m.ctx) return;
    const t0 = m.ctx.currentTime;
    // Clacker: a burst of hard clicks.
    for (let i = 0; i < 6; i++) {
      m.noiseBurst({ bus: 'alerts', when: t0 + i * 0.095, duration: 0.05, gain: 0.3, freq: 2600, q: 1.6, attack: 0.002 });
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

  /* ------------------------------------------------------------------ */
  /* The cockpit warning system's sounds                                 */
  /* ------------------------------------------------------------------ */

  /**
   * One note, `at` seconds from now on the audio clock.
   * Returns false if there is no audio to play it on.
   */
  _note(at, freq, dur, gain, type = 'sine', sweepTo = null, attack = 0.006) {
    const ctx = this.mixer.ctx;
    if (!ctx) return false;
    const t = ctx.currentTime + Math.max(0, at);
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (sweepTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    g.gain.setValueAtTime(Math.max(0.0002, gain), t + Math.max(attack, dur * 0.6));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.mixer.bus('alerts'));
    osc.start(t);
    osc.stop(t + dur + 0.05);
    return true;
  }

  /** A struck bell: a fundamental and the inharmonic partial that makes it a bell. */
  _bell(at, freq, gain) {
    const ctx = this.mixer.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + at;
    for (const [mul, g] of [[1, gain], [2.76, gain * 0.45], [5.4, gain * 0.18]]) {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * mul;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(g, t + 0.004);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.55 / Math.sqrt(mul));
      osc.connect(env);
      env.connect(this.mixer.bus('alerts'));
      osc.start(t);
      osc.stop(t + 0.6);
    }
  }

  /** PULL UP and TERRAIN: two rising whoops. ~0.8 s. */
  gpwsWarning() {
    this._note(0, 330, 0.32, 0.11, 'triangle', 1050);
    this._note(0.4, 330, 0.32, 0.11, 'triangle', 1050);
    return 0.8;
  }

  /** SINK RATE, DON'T SINK, TOO LOW, TERRAIN AHEAD: two low pips. ~0.35 s. */
  gpwsCaution() {
    this._note(0, 540, 0.11, 0.09, 'square');
    this._note(0.17, 540, 0.11, 0.09, 'square');
    return 0.35;
  }

  /** BANK ANGLE: three quick high ticks. ~0.3 s. */
  bankAngle() {
    for (let i = 0; i < 3; i++) this._note(i * 0.1, 1250, 0.05, 0.07, 'sine');
    return 0.3;
  }

  /** WINDSHEAR: a two-note warble, like a siren that cannot make up its mind. ~1 s. */
  windshear() {
    for (let i = 0; i < 6; i++) this._note(i * 0.16, i % 2 ? 660 : 880, 0.15, 0.09, 'triangle');
    return 1.0;
  }

  /** ENGINE FIRE: a bell, three strokes. ~0.9 s. */
  fireBell() {
    for (let i = 0; i < 3; i++) this._bell(i * 0.27, 1180, 0.11);
    return 0.9;
  }

  /** Master warning for a red alert with no sound of its own: three falling chimes. ~0.7 s. */
  masterWarning() {
    [1000, 800, 640].forEach((f, i) => this._note(i * 0.2, f, 0.3, 0.1, 'sine'));
    return 0.7;
  }

  /**
   * Master caution: one soft two-note chime.
   *
   * Debounced, because more than one thing asks for it — the damage handler,
   * the natural disasters and the warning panel all do, and a bird strike
   * sets off two of them in the same frame. Two chimes for one event is noise.
   */
  masterCaution() {
    const ctx = this.mixer.ctx;
    if (!ctx) return 0;
    if (ctx.currentTime - this._lastCaution < 1.5) return 0;
    this._lastCaution = ctx.currentTime;
    this._note(0, 784, 0.22, 0.08, 'sine');
    this._note(0.16, 587, 0.34, 0.08, 'sine');
    return 0.5;
  }

  /**
   * `caution()` has been called for a long time — main.js on damage and on a
   * natural event, missions.js on a failed patient check — and never existed,
   * so every one of those calls (`alerts.caution && alerts.caution()`) was
   * silently doing nothing. It is the master caution chime.
   */
  caution() {
    return this.masterCaution();
  }

  /** A soft thump, for disasters.js's bird strike, which also asked for one that was not there. */
  thud() {
    const m = this.mixer;
    if (!m.ctx) return;
    m.noiseBurst({ bus: 'alerts', duration: 0.18, gain: 0.22, type: 'lowpass', freq: 240, q: 0.7, attack: 0.003 });
    this._note(0, 110, 0.16, 0.12, 'sine', 60);
  }

  /** TCAS traffic advisory: two soft high pips. ~0.35 s. */
  tcasTraffic() {
    this._note(0, 1320, 0.09, 0.07, 'sine');
    this._note(0.17, 1320, 0.09, 0.07, 'sine');
    return 0.35;
  }

  /** TCAS resolution advisory: three pips going the way to fly. ~0.5 s. */
  tcasResolution(sense) {
    const notes = sense === 'descend' ? [1568, 1175, 880] : [880, 1175, 1568];
    notes.forEach((f, i) => this._note(i * 0.14, f, 0.12, 0.1, 'square'));
    return 0.5;
  }

  /** Clear of conflict: one up-slur. ~0.4 s. */
  tcasClear() {
    this._note(0, 1047, 0.36, 0.07, 'sine', 1319);
    return 0.4;
  }

  /** A radio altitude callout: one pip, higher the lower you are. */
  radioAltitude(ft) {
    const f = { 100: 587, 50: 698, 40: 784, 30: 880, 20: 988, 10: 1175 }[ft] || 700;
    this._note(0, f, 0.13, 0.08, 'sine');
    if (ft === 100) this._note(0.16, f, 0.13, 0.08, 'sine');
    return ft === 100 ? 0.3 : 0.15;
  }

  /** Autopilot disconnect: the "cavalry charge" wail, once through. ~1.1 s. */
  autopilotOff() {
    [1250, 990, 1250, 990].forEach((f, i) => this._note(i * 0.26, f, 0.24, 0.07, 'triangle', f * 0.94));
    return 1.1;
  }

  update(dt, ac, weather) {
    if (!this.built) return;
    // Stall warner comes on a little before the actual stall, like a real one.
    const warn = stallWarning(ac, this.stallActive);
    this.setStall(warn, warn ? clamp((STALL_WARN_MARGIN - stallMargin(ac)) / 0.1, 0, 1) : 0);

    if (this.claimed) return; // the warning panel has the rest

    // Gear-up warning near the ground with the power back, held for half a
    // second so a wobble through level flight is not a chirp.
    this._gearHold = legacyGearCondition(ac) ? this._gearHold + dt : 0;
    this.setGearWarning(this._gearHold > 0.5);

    // Terrain proximity: high descent rate close to the ground, gear up.
    this.terrainTimer -= dt;
    if (ac.agl < 130 && ac.vs < -6.5 && !ac.onGround && this.terrainTimer <= 0) {
      this.terrain();
      this.terrainTimer = 1.4;
    }
  }
}

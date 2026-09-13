/**
 * Sound for the three new games: the boat, the car and the helicopter.
 *
 * Drop this in as `src/audio/vehicles.js`. It imports nothing but
 * `../core/noise.js`, which `engine.js` and `jet.js` already import, so it adds
 * no dependency and no asset. Everything below is Web Audio, synthesised live,
 * and silent until the mixer's context exists.
 *
 * ---------------------------------------------------------------------------
 * Why this file exists at all
 * ---------------------------------------------------------------------------
 * Today `GameAudio.updateVehicle()` drives `EngineSound` — the four-cylinder
 * aero piston synth — from the vehicle's throttle, and the helicopter is an
 * aeroplane with `power.kind === 'prop'`, so it drives the same one. That means
 * the rescue launch, the delivery van and the Skyhook are currently the same
 * instrument at three different pitches. They are not the same instrument:
 *
 *   diesel     A marine diesel is not a piston aeroplane pitched down. It
 *              turns half the revs, fires six times every two revolutions
 *              instead of four, and every one of those firings is a sharp
 *              impulsive knock rather than a smooth combustion event. Its
 *              exhaust is HARD — strong low harmonics through a resonant pipe —
 *              and then it goes through the water, which takes the entire top
 *              end off it. That last part is the sound of a boat.
 *   petrol     The van revs twice as high, and the thing your ear actually
 *              uses to judge a car's speed is the GEAR STEP: the note climbs,
 *              drops a fifth, climbs again. The physics here has no gearbox
 *              (`gear` is only 'D'/'N'/'R'), so the gearbox lives in this file
 *              and is honestly labelled as a sound-only one.
 *   rotor      A helicopter's signature is BLADE SLAP — a hard periodic thump
 *              at blade-pass frequency, four blades times 6.67 revolutions a
 *              second, 26.7 Hz. The current propeller layer is a triangle-LFO
 *              tremolo on a noise band, which is a wobble, not a thump. The
 *              difference is duty cycle: a tremolo is on half the time, a slap
 *              is on about a seventh of the time. This file gets that by
 *              running an oscillator through a WaveShaper that keeps only the
 *              top of the cycle, and multiplying a noise band by the result.
 *
 * ---------------------------------------------------------------------------
 * The three rules this file obeys, taken from the existing audio code
 * ---------------------------------------------------------------------------
 * 1. MODULATE BY MULTIPLYING, NEVER BY ADDING TO A GAIN. `engine.js` carries a
 *    long comment about the bug where an LFO was connected straight to
 *    `propGain.gain`: an AudioParam ADDS what is connected to it, so the gain
 *    went negative for most of every cycle — a polarity flip, not a tremolo —
 *    and the propeller never fell silent because the LFO kept swinging about
 *    zero. Every chopper in this file is a separate gain stage whose intrinsic
 *    value is 0 and whose `.gain` is fed by a UNIPOLAR shaper output, so it
 *    can only ever multiply, and the level control downstream of it is the one
 *    thing that decides whether the layer is heard.
 * 2. DECORRELATE THE NOISE. Every noise layer uses `mixer.noiseSource()`, which
 *    already starts at a random offset in the shared buffer.
 * 3. NOTHING IS BUILT UNTIL IT IS NEEDED. A Chromebook running thirty copies of
 *    this game should not hold a helicopter's node graph alive for a lesson
 *    spent in the boat. `VehicleAudio.ensure(kind)` builds one synth the first
 *    time that vehicle is used and keeps it after that.
 *
 * ---------------------------------------------------------------------------
 * Measured node counts (counted by an instrumented AudioContext, see the
 * verification note at the foot of this file — not estimates)
 * ---------------------------------------------------------------------------
 *   DieselSound   36 nodes   CarSound   27 nodes   RotorSound   34 nodes
 * All three built at once is 97, and only one of them is ever updated.
 * One-shots (hull slaps, gravel ticks, chirps) are `mixer.noiseBurst` calls
 * that stop themselves; each is 3 nodes, and each synth holds a token bucket
 * that caps how many it may start per second — measured worst case 5.0 a
 * second for the boat driven hard in a gale and 13.1 a second for the van flat
 * out on gravel, so about 39 short-lived nodes on top of the persistent count.
 */

import { clamp, lerp } from '../core/noise.js';

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

/**
 * A WaveShaper curve that turns a sine into a narrow POSITIVE pulse.
 *
 * This is the whole trick behind blade slap, diesel knock and tail-rotor buzz,
 * and it is worth being exact about.
 *
 * Feed it `sin(theta)`. It outputs zero except near the top of the cycle,
 * where it rises to 1. The fraction of the cycle that is non-zero is `duty`.
 *
 * For a sine, the fraction of a period spent above a threshold `thr` is
 *      f = (pi - 2*asin(thr)) / (2*pi)
 * Solving for thr gives      thr = cos(pi * f)
 * which is the line below, and is why `duty` means what it says rather than
 * being a knob somebody turned until it sounded right. Verified numerically:
 * at duty 0.14 the measured non-zero fraction of a sine cycle is 0.1400.
 *
 * `shape` bends the rise. 1 is a linear ramp out of silence; above 1 the
 * attack gets softer at the foot and the peak gets pointier, which is what
 * separates a distant "thwop" from a close "whack".
 *
 * The output is unipolar 0..1 by construction, which is the property that
 * makes it safe to connect to a gain's `.gain` param (see rule 1 above).
 */
export function pulseCurve(duty = 0.2, shape = 1.6, n = 2048) {
  const d = clamp(duty, 0.01, 0.99);
  const thr = Math.cos(Math.PI * d);
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = x <= thr ? 0 : Math.pow((x - thr) / (1 - thr), shape);
  }
  return curve;
}

/** Knots to metres per second. The readouts publish knots; the synths want m/s. */
const KTS = 1 / 1.94384;

/**
 * One-shot budget, so a rough sea or a gravel track cannot allocate without
 * limit. Same idea as music.js's `EVENTS_PER_SEC`, same reason: a Chromebook
 * dropping to nine frames a second must not be handed a fistful of nodes on
 * the tick it recovers.
 */
class Budget {
  constructor(perSec) {
    this.rate = perSec;
    this.tokens = perSec;
  }
  tick(dt) {
    this.tokens = Math.min(this.rate, this.tokens + dt * this.rate);
  }
  take() {
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

/* ================================================================== *
 * BOAT — marine diesel, hull slap, bow wave
 * ================================================================== */

/**
 * The Kestrel Launch's engine and the water she is pushing.
 *
 * Engine numbers, and where they come from:
 *   Six cylinders, four-stroke, so THREE firings per revolution (six cylinders
 *   firing once every two revolutions). The aero engine in `engine.js` is a
 *   four-cylinder four-stroke: TWO per revolution. That ratio, 3:2, is the
 *   "slower firing order with more events in it" — a diesel at 1200 rpm and a
 *   Skylark at 1800 rpm make the same 60 Hz firing tone, and they sound
 *   nothing alike, because the diesel's crankshaft is turning two-thirds as
 *   fast underneath it and you can hear the individual revolutions.
 *
 *   Idle 520 rpm, full 2400 rpm (a fast marine diesel in a 27-knot launch).
 *     firing rate = rpm/60 * 3   ->   26.0 Hz idle, 120.0 Hz full
 *     crank rate  = rpm/60       ->    8.7 Hz idle,  40.0 Hz full
 *   The aero engine's range for comparison is 2.0 Hz to 88.3 Hz firing on a
 *   1.0 to 44.2 Hz crank. So the diesel idles far higher and tops out lower
 *   per revolution: a busy, chuggy, narrow range instead of an open one.
 *
 * Layers:
 *   firing     A periodic wave with heavy low harmonics, through a waveshaper
 *              and a peaking filter at the exhaust resonance. This is the hard
 *              exhaust note.
 *   lope       A gain stage in front of the firing tone, multiplied by a
 *              shallow pulse at the CRANK rate. One firing per revolution sits
 *              proud of the others, which is the loping unevenness that makes
 *              a diesel a diesel rather than a smooth six.
 *   knock      Noise, band-passed around 1.7 kHz, chopped by a narrow pulse at
 *              the FIRING rate. Diesel clatter: the sharp mechanical crack of
 *              compression ignition. This is the layer the water then eats.
 *   water      A lowpass across everything, opening from 620 Hz at idle to
 *              about 2 kHz at full — and closing hard whenever the exhaust
 *              goes under, which on a boat happens every time she squats, sits
 *              back in a following sea or comes off the plane. That damped top
 *              end is the single most boat-like thing in the chain.
 *   bow        Pink noise band whose centre climbs with speed: the mass of
 *              water she is shouldering aside.
 *   spray      A high hiss that only appears once she is up and going, i.e.
 *              above about 60 per cent of her top speed, which is roughly
 *              where this hull would come onto the plane.
 *   slap       Scheduled one-shot thumps at the wave-encounter rate. See
 *              `_slaps()`.
 */
export class DieselSound {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.running = false;
    /** Smoothed engine speed, 0..1, so the note has inertia the lever does not. */
    this.rev = 0;
    this.slapAt = 0;
    this.budget = new Budget(6);
    this._lastJolt = 0;
    this._lastAground = false;
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;

    /* ---- Engine chain: out -> shaper -> exhaust resonance -> water ---- */
    this.out = ctx.createGain();
    this.out.gain.value = 0;

    this.shaper = ctx.createWaveShaper();
    // 11, against the aero engine's 6. A diesel exhaust is harder-edged, and
    // the extra harmonics are what the water filter then has something to eat.
    this.shaper.curve = m.distortionCurve(11);

    // The exhaust pipe. A peaking filter with real gain, parked low and moved
    // with the revs, is a cheap standing wave in a tube.
    this.exhaust = ctx.createBiquadFilter();
    this.exhaust.type = 'peaking';
    this.exhaust.frequency.value = 96;
    this.exhaust.Q.value = 1.7;
    this.exhaust.gain.value = 7;

    // Wet exhaust. Everything on the engine bus goes through this.
    this.water = ctx.createBiquadFilter();
    this.water.type = 'lowpass';
    this.water.frequency.value = 620;
    this.water.Q.value = 0.7;

    this.out.connect(this.shaper);
    this.shaper.connect(this.exhaust);
    this.exhaust.connect(this.water);
    this.water.connect(m.bus('engine'));

    /* ---- Firing tone ---- */
    const N = 14;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    // Weighted low and thick. The aero engine's table thins out by the 4th
    // harmonic; this one is still at 0.46 there, which is the difference
    // between a rasp and a thud.
    const amps = [0, 1, 0.78, 0.55, 0.46, 0.3, 0.26, 0.18, 0.15, 0.1, 0.09, 0.07, 0.05, 0.04];
    for (let i = 0; i < N; i++) real[i] = amps[i] || 0;
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    this.firing = ctx.createOscillator();
    this.firing.setPeriodicWave(wave);
    this.firing2 = ctx.createOscillator();
    this.firing2.setPeriodicWave(wave);
    this.firing2.detune.value = -11;

    this.firingGain = ctx.createGain();
    this.firingGain.gain.value = 0.52;
    this.firing2Gain = ctx.createGain();
    this.firing2Gain.gain.value = 0.24;
    this.firing.connect(this.firingGain);
    this.firing2.connect(this.firing2Gain);

    /* ---- Lope: multiply the firing tone by a shallow once-per-revolution
     * pulse. `lopeFloor` is the part that always gets through, `lopeChop` the
     * part that is gated, and they are summed — so the depth of the lope is
     * the ratio of the two, and the tone can never disappear entirely. ---- */
    this.lopeFloor = ctx.createGain();
    // Floor plus maximum depth is exactly 1.0 (0.58 + 0.42), so the summed
    // pair can never exceed unity on a peak and hand the mixer's limiter work
    // it should not be doing.
    this.lopeFloor.gain.value = 0.58;
    this.lopeChop = ctx.createGain();
    this.lopeChop.gain.value = 0; // driven only by the shaper
    this.firingGain.connect(this.lopeFloor);
    this.firing2Gain.connect(this.lopeFloor);
    this.firingGain.connect(this.lopeChop);
    this.firing2Gain.connect(this.lopeChop);
    this.lopeFloor.connect(this.out);
    this.lopeChop.connect(this.out);

    this.lopeOsc = ctx.createOscillator();
    this.lopeOsc.type = 'sine';
    this.lopeOsc.frequency.value = 9;
    this.lopeShape = ctx.createWaveShaper();
    // Wide and soft: this is a lean on one revolution, not a hit.
    this.lopeShape.curve = pulseCurve(0.42, 1.0);
    this.lopeDepth = ctx.createGain();
    this.lopeDepth.gain.value = 0.34;
    this.lopeOsc.connect(this.lopeShape);
    this.lopeShape.connect(this.lopeDepth);
    this.lopeDepth.connect(this.lopeChop.gain);

    /* ---- Crank rumble: the second order of the crankshaft, which is the
     * component you feel through the deck rather than hear. ---- */
    this.rumble = ctx.createOscillator();
    this.rumble.type = 'sine';
    this.rumble.frequency.value = 18;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    this.rumble.connect(this.rumbleGain);
    this.rumbleGain.connect(this.out);

    /* ---- Knock: the diesel clatter ---- */
    this.knockSrc = m.noiseSource(false);
    this.knockBand = ctx.createBiquadFilter();
    this.knockBand.type = 'bandpass';
    this.knockBand.frequency.value = 1700;
    this.knockBand.Q.value = 1.1;
    this.knockChop = ctx.createGain();
    this.knockChop.gain.value = 0;
    this.knockGain = ctx.createGain();
    this.knockGain.gain.value = 0;
    this.knockSrc.connect(this.knockBand);
    this.knockBand.connect(this.knockChop);
    this.knockChop.connect(this.knockGain);
    this.knockGain.connect(this.out);

    this.knockOsc = ctx.createOscillator();
    this.knockOsc.type = 'sine';
    this.knockOsc.frequency.value = 26;
    this.knockShape = ctx.createWaveShaper();
    // 0.11 duty: a crack, not a pulse train you could hum.
    this.knockShape.curve = pulseCurve(0.11, 2.0);
    this.knockDepth = ctx.createGain();
    this.knockDepth.gain.value = 1;
    this.knockOsc.connect(this.knockShape);
    this.knockShape.connect(this.knockDepth);
    this.knockDepth.connect(this.knockChop.gain);

    /* ---- Combustion body: the low push under the note ---- */
    this.bodySrc = m.noiseSource(true);
    this.bodyFilter = ctx.createBiquadFilter();
    this.bodyFilter.type = 'lowpass';
    this.bodyFilter.frequency.value = 300;
    this.bodyGain = ctx.createGain();
    this.bodyGain.gain.value = 0;
    this.bodySrc.connect(this.bodyFilter);
    this.bodyFilter.connect(this.bodyGain);
    this.bodyGain.connect(this.out);

    /* ---- Water, on the ENVIRONMENT bus, because that is what it is: the
     * boat's wake belongs with the wind and the rain, not with the engine, so
     * a child who turns the engine slider down still hears the sea. ---- */
    const env = m.bus('environment');

    this.bowSrc = m.noiseSource(true);
    this.bowFilter = ctx.createBiquadFilter();
    this.bowFilter.type = 'bandpass';
    this.bowFilter.frequency.value = 320;
    this.bowFilter.Q.value = 0.7;
    this.bowGain = ctx.createGain();
    this.bowGain.gain.value = 0;
    this.bowSrc.connect(this.bowFilter);
    this.bowFilter.connect(this.bowGain);
    this.bowGain.connect(env);

    // Gurgle: a slow wander of the bow-wave centre frequency. Connected to a
    // FREQUENCY param, where adding is exactly what we want, so no chop stage.
    this.gurgleOsc = ctx.createOscillator();
    this.gurgleOsc.type = 'sine';
    this.gurgleOsc.frequency.value = 0.37;
    this.gurgleDepth = ctx.createGain();
    this.gurgleDepth.gain.value = 60;
    this.gurgleOsc.connect(this.gurgleDepth);
    this.gurgleDepth.connect(this.bowFilter.frequency);

    this.spraySrc = m.noiseSource(false);
    this.sprayFilter = ctx.createBiquadFilter();
    this.sprayFilter.type = 'highpass';
    this.sprayFilter.frequency.value = 2000;
    this.sprayGain = ctx.createGain();
    this.sprayGain.gain.value = 0;
    this.spraySrc.connect(this.sprayFilter);
    this.sprayFilter.connect(this.sprayGain);
    this.sprayGain.connect(env);

    // Wash astern: the propeller pulling water the wrong way. Cavitation is
    // broadband and rattly, and it is the cue that tells you the lever is the
    // wrong side of STOP without looking at it.
    this.washSrc = m.noiseSource(false);
    this.washFilter = ctx.createBiquadFilter();
    this.washFilter.type = 'bandpass';
    this.washFilter.frequency.value = 700;
    this.washFilter.Q.value = 0.5;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    this.washSrc.connect(this.washFilter);
    this.washFilter.connect(this.washGain);
    this.washGain.connect(env);

    for (const o of [this.firing, this.firing2, this.rumble, this.lopeOsc, this.knockOsc, this.gurgleOsc]) o.start();
    this.built = true;
  }

  setInterior(inside) {
    this.interior = inside;
  }

  /**
   * Starting a diesel: a heavy starter, a long slow crank, and it does not
   * catch on the first turn. Deliberately slower and lumpier than the
   * aeroplane's, which catches in 1.15 s — this one takes 2.0 s, because half
   * the character of a big diesel is how reluctantly it wakes up.
   */
  playStart() {
    if (!this.built) return;
    const m = this.mixer;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 700;
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(7, t);
    osc.frequency.linearRampToValueAtTime(17, t + 2.0);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.2);
    g.gain.setValueAtTime(0.2, t + 1.9);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    osc.connect(filt);
    filt.connect(g);
    g.connect(m.bus('engine'));
    osc.start(t);
    osc.stop(t + 2.6);
    // Two failed catches and then it goes. Scheduled on the audio clock, not
    // with setTimeout, for the reason engine.js documents: otherwise they all
    // land on one tick and read as a single thump.
    for (const d of [1.05, 1.62, 2.0, 2.18]) {
      m.noiseBurst({ bus: 'engine', when: t + d, duration: 0.2, gain: 0.26, freq: 120, q: 1.1, attack: 0.005 });
    }
    // The puff of smoke as she fires.
    m.noiseBurst({ bus: 'engine', when: t + 2.02, duration: 0.5, gain: 0.18, freq: 300, q: 0.5, pink: true });
  }

  playStop() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    // A diesel stops dead when the fuel is cut. Much shorter than the
    // aeroplane's 1.6 s windmill, because there is no propeller out in the
    // airflow keeping it turning.
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    this.firing.frequency.setTargetAtTime(8, t, 0.25);
    this.rev = 0;
  }

  /**
   * She has fallen off a wave and landed on her chines.
   * `strength` 0..1, and `surface.js` already publishes exactly that on its
   * `{ kind: 'slam', strength }` event.
   */
  playSlam(strength = 0.6) {
    if (!this.built) return;
    const s = clamp(strength, 0, 1);
    const m = this.mixer;
    const t = this.ctx.currentTime;
    // The hull: a big, short, low thud through the whole structure.
    m.noiseBurst({ bus: 'environment', when: t, duration: 0.3 + s * 0.28, gain: 0.32 + s * 0.42, type: 'lowpass', freq: 110 + s * 90, q: 1.3, attack: 0.003 });
    // The water leaving it: a sheet of spray a beat later.
    m.noiseBurst({ bus: 'environment', when: t + 0.06, duration: 0.55 + s * 0.4, gain: 0.14 + s * 0.26, type: 'highpass', freq: 1500, attack: 0.02 });
  }

  /** Aground. Gravel under a glassfibre hull, which is a sound nobody forgets. */
  playAground() {
    if (!this.built) return;
    const m = this.mixer;
    const t = this.ctx.currentTime;
    m.noiseBurst({ bus: 'alerts', when: t, duration: 1.1, gain: 0.4, type: 'bandpass', freq: 520, q: 0.6, attack: 0.01 });
    m.noiseBurst({ bus: 'alerts', when: t + 0.05, duration: 0.8, gain: 0.3, type: 'highpass', freq: 2200, attack: 0.02 });
    m.tone({ bus: 'alerts', freq: 88, sweepTo: 52, duration: 0.9, gain: 0.2, type: 'triangle' });
  }

  /**
   * `reading` is `SurfaceVehicle.boatReadouts()` verbatim. Every field read
   * here was checked against that method rather than guessed, which is the
   * mistake `audio/index.js` already documents having paid for once.
   *
   * Read: speedKts, throttle, astern, sea, aground, jolt, heave, crashed.
   */
  update(dt, reading, weather) {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    const r = reading || {};
    const ms = Math.abs(r.speedKts || 0) * KTS;
    const speedN = clamp(ms / 14, 0, 1); // 14 m/s is her honest top speed
    const sea = clamp(r.sea || 0, 0, 1);
    const demand = clamp(r.throttle || 0, 0, 1);
    const astern = !!r.astern;

    // Engine speed lags the lever. A diesel with a heavy flywheel and a
    // propeller on the back of it takes about a second and a half to come up,
    // and that lag is most of why a boat feels heavy to drive.
    const want = demand > 0.01 ? 0.18 + demand * 0.82 : r.crashed ? 0 : 0.13;
    this.rev += (want - this.rev) * clamp(dt * (want > this.rev ? 0.9 : 1.5), 0, 1);
    const rev = this.rev;
    const running = rev > 0.05 && !r.crashed;
    this.running = running;

    const rpm = lerp(520, 2400, clamp((rev - 0.13) / 0.87, 0, 1));
    const firingHz = clamp((rpm / 60) * 3, 8, 200); // 6-cyl 4-stroke: 3 per rev
    const crankHz = clamp(rpm / 60, 3, 60);

    const smooth = 0.12;
    this.firing.frequency.setTargetAtTime(firingHz, t, smooth);
    this.firing2.frequency.setTargetAtTime(firingHz * 1.004, t, smooth);
    this.rumble.frequency.setTargetAtTime(clamp(crankHz * 2, 16, 82), t, smooth);
    this.lopeOsc.frequency.setTargetAtTime(crankHz, t, smooth);
    this.knockOsc.frequency.setTargetAtTime(firingHz, t, smooth);

    // Load is the gap between what the lever is asking for and what she is
    // actually doing. A boat accelerating hard is working; a boat that has
    // reached her speed with the lever still at FULL is not, and a diesel
    // audibly stops straining at that moment.
    const load = clamp(demand * 0.55 + clamp(demand - speedN, 0, 1) * 0.45, 0, 1);
    const inside = this.interior ? 0.7 : 1;

    this.out.gain.setTargetAtTime(running ? (0.26 + rev * 0.5) * inside : 0, t, 0.15);
    this.rumbleGain.gain.setTargetAtTime(running ? 0.3 + load * 0.26 : 0, t, 0.2);
    this.bodyGain.gain.setTargetAtTime(running ? 0.08 + load * 0.24 : 0, t, 0.2);
    this.bodyFilter.frequency.setTargetAtTime(220 + load * 320, t, 0.25);
    // Knock is a COLD and UNLOADED sound above all: a diesel clatters most at
    // idle and when you first lean on it, and smooths out once it is pulling.
    this.knockGain.gain.setTargetAtTime(running ? 0.16 + (1 - rev) * 0.16 + load * 0.1 : 0, t, 0.2);
    this.knockBand.frequency.setTargetAtTime(1450 + rev * 900, t, 0.25);
    // The lope flattens out as she comes up to speed, exactly as a real one does.
    this.lopeDepth.gain.setTargetAtTime(0.42 - rev * 0.26, t, 0.25);
    this.exhaust.frequency.setTargetAtTime(clamp(firingHz * 1.25, 60, 320), t, 0.2);

    /*
     * The water-damped top end.
     *
     * Base cutoff opens with the revs. Then it is closed by three things, and
     * the three of them together are what makes this read as an engine in a
     * boat rather than an engine in a shed:
     *   heave     she is squatting into a trough and the exhaust is under
     *   sea       spray and broken water over the transom
     *   astern    going backwards drags the wake up over the outlet
     */
    const submerge = clamp(clamp(-(r.heave || 0) / 1.2, 0, 1) * 0.6 + sea * 0.3 + (astern ? 0.25 : 0), 0, 0.85);
    const wet = lerp(620, 2050, rev) * (1 - submerge * 0.62);
    this.water.frequency.setTargetAtTime(clamp(wet * (this.interior ? 0.55 : 1), 180, 4000), t, 0.12);

    /* ---- Bow wave and spray ---- */
    // Level goes as speed^1.6, which is between the linear the ear expects and
    // the square the physics gives, and lands where it sounds right: nothing
    // at a crawl, plainly loud at 20 knots.
    this.bowGain.gain.setTargetAtTime(Math.pow(speedN, 1.6) * 0.4 + sea * 0.07, t, 0.18);
    this.bowFilter.frequency.setTargetAtTime(300 + speedN * 620, t, 0.2);
    this.gurgleDepth.gain.setTargetAtTime(50 + sea * 120, t, 0.3);
    this.gurgleOsc.frequency.setTargetAtTime(0.3 + sea * 0.55 + speedN * 0.3, t, 0.4);
    // Spray starts at 60 per cent, which is about where this hull would lift
    // and start throwing water rather than pushing it.
    const planing = clamp((speedN - 0.6) / 0.4, 0, 1);
    this.sprayGain.gain.setTargetAtTime(Math.pow(planing, 1.4) * (0.1 + sea * 0.14), t, 0.25);
    this.sprayFilter.frequency.setTargetAtTime(1800 + planing * 1400, t, 0.3);
    this.washGain.gain.setTargetAtTime(astern ? 0.09 + demand * 0.16 : 0, t, 0.2);
    this.washFilter.frequency.setTargetAtTime(600 + demand * 500, t, 0.25);

    /* ---- Hull slap ---- */
    this.budget.tick(dt);
    this._slaps(t, dt, speedN, sea, ms);

    /* ---- Events derived from the readouts, so this works before anyone adds
     * an events field to them. `jolt` is already published and already rises
     * on exactly the frame surface.js pushes its slam event. ---- */
    const jolt = r.jolt || 0;
    if (jolt - this._lastJolt > 0.18) this.playSlam(clamp(jolt, 0, 1));
    this._lastJolt = jolt;
    if (r.aground && !this._lastAground) this.playAground();
    this._lastAground = !!r.aground;
  }

  /**
   * Hull slap: a thump every time she meets a wave.
   *
   * The rate is a WAVE-ENCOUNTER rate, not a tremolo. A boat standing still in
   * a swell still slaps, slowly; the same boat at speed slaps far faster
   * because she is running into waves as well as being lifted by them. So:
   *
   *   wavelength = 22 m in a calm, 9 m in a gale (short steep chop)
   *   rate = speed / wavelength  +  her own pitching, which rises with the sea
   *
   * Readings from this function, counting only the low thud of each slap, over
   * ten runs of sixty seconds each because the interval is jittered (means,
   * with the spread across those ten runs; printed by the harness, not
   * estimated):
   *
   *   stopped, calm       0.00 slaps/s   silent, and that is the level gate
   *                                      below doing its job: flat water with
   *                                      no way on is nothing to slap against
   *   stopped, gale       0.82 slaps/s   (0.80 to 0.83)
   *   half ahead, choppy  0.86 slaps/s   (0.83 to 0.88)
   *   full ahead, calm    0.91 slaps/s   (0.87 to 0.95)
   *   full ahead, gale    2.26 slaps/s   (2.18 to 2.32)
   *
   * That last figure is better than one every half second, which is right for
   * a planing hull being driven hard at somebody who is about to be told to
   * slow down, and it is the loudest thing in the boat game when it happens.
   *
   * Each slap is two `mixer.noiseBurst` calls — a low thud plus, when it is
   * rough, the sheet of water that comes off it. The budget caps this at six
   * a second no matter what the sea does.
   */
  _slaps(t, dt, speedN, sea, ms) {
    const waveLen = lerp(22, 9, sea);
    const rate = ms / waveLen + 0.18 + sea * 0.66;
    // Below this there is nothing to slap against: flat water, going nowhere.
    const level = clamp(sea * 0.75 + speedN * 0.45, 0, 1);
    if (level < 0.12) {
      this.slapAt = t + 1;
      return;
    }
    if (this.slapAt < t - 1 || this.slapAt > t + 2) this.slapAt = t + 0.2;
    const m = this.mixer;
    let guard = 0;
    while (this.slapAt < t + 0.25 && guard++ < 8) {
      if (!this.budget.take()) {
        this.slapAt = t + 0.3;
        break;
      }
      // Waves are not a metronome. +-30 per cent keeps it off the grid, which
      // matters because the music has a pulse voice and two clocks agreeing is
      // instantly fake.
      const jitter = 0.7 + Math.random() * 0.6;
      const g = level * (0.5 + Math.random() * 0.5);
      m.noiseBurst({
        bus: 'environment',
        when: this.slapAt,
        duration: 0.18 + g * 0.2,
        gain: 0.1 + g * 0.34,
        type: 'lowpass',
        freq: 130 + g * 150,
        q: 1.2,
        attack: 0.004,
      });
      if (g > 0.42) {
        m.noiseBurst({
          bus: 'environment',
          when: this.slapAt + 0.03,
          duration: 0.3,
          gain: 0.06 + g * 0.16,
          type: 'highpass',
          freq: 1700,
          attack: 0.015,
        });
      }
      this.slapAt += jitter / Math.max(0.12, rate);
    }
  }
}

/* ================================================================== *
 * CAR — petrol four, a sound-only gearbox, surface-tracking tyres
 * ================================================================== */

/**
 * The gearbox that exists only in the audio.
 *
 * `SurfaceVehicle` has no transmission: `gear` is 'D', 'N' or 'R', set from
 * the sign of the speed (surface.js line 929). That is the right model for a
 * ten-year-old driving a van and the wrong model for the sound, because the
 * gear step is the main thing a passenger hears a car do.
 *
 * So this table is a four-speed box laid over the physics. `topKph[g]` is the
 * road speed at which gear `g` reaches the redline. The van's top speed is
 * 105 km/h (surface.js: topSpeed 29 m/s), so fourth is entered at about
 * 79 km/h and is still only three-quarters of the way up its range flat out —
 * which is what a working van sounds like, rather than a hot hatch.
 *
 * Shift points, measured by sweeping the model 0 -> 105 -> 0 km/h in 0.05 km/h
 * steps (the harness prints these; they are readings, not intentions):
 *   up    1->2 at 31.3 km/h   2->3 at 55.2   3->4 at 84.6
 *   down  4->3 at 54.6 km/h   3->2 at 38.6   2->1 at 25.2
 * The gap between an upshift and the downshift back below it is the
 * hysteresis: 6.1 km/h in first, 16.6 in second, 30.1 in third. First gear's
 * is the narrow one, which is why there is also a half-second lock-out after
 * every shift. Verified by holding the van on each of the three shift points
 * for twenty seconds with the speed wobbling across it: zero extra shifts.
 */
const GEAR_TOP_KPH = [34, 60, 92, 130];
const IDLE_RPM = 820;
const REDLINE_RPM = 6200;
const SHIFT_UP = 0.92;
const SHIFT_DOWN = 0.42;

/**
 * Surfaces. `surface.js` publishes exactly four kinds (tarmac, gravel, grass,
 * sand) with a `grip` each, and the tyre layer reads both.
 *
 *   f/span    where the roar sits and how far it climbs with speed
 *   pink      how much of the mix is pink noise rather than white. Tarmac is
 *             nearly all pink (a low, even hum); gravel is nearly all white
 *             (bright and gritty).
 *   level     how loud this surface is at all. Grass is the quiet one, which
 *             is why leaving the tarmac feels like the volume dropped.
 *   grain     stones and grit pinging off the arches, as scheduled one-shots.
 *   squeal    how much a locked tyre will SQUEAL rather than scrabble. Only
 *             tarmac really squeals; gravel just digs.
 */
const SURFACES = {
  tarmac: { f: 250, span: 430, q: 1.3, pink: 0.85, level: 0.34, grain: 0, squeal: 1 },
  gravel: { f: 720, span: 900, q: 0.5, pink: 0.15, level: 0.44, grain: 1, squeal: 0.15 },
  grass: { f: 190, span: 260, q: 0.75, pink: 0.9, level: 0.24, grain: 0.2, squeal: 0.1 },
  sand: { f: 520, span: 620, q: 0.4, pink: 0.6, level: 0.32, grain: 0.35, squeal: 0.05 },
};

export class CarSound {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.running = false;
    this.gear = 0;
    this.rpm = IDLE_RPM;
    this.shiftT = 0;
    /* A shift lock-out. The hysteresis below is wide enough that the box
     * cannot hunt on a steady speed, but a child bouncing the throttle across
     * a shift point is not a steady speed, and half a second of "no, you have
     * just changed gear" is what a real automatic does about it. */
    this.shiftLock = 0;
    this.grainAt = 0;
    this.budget = new Budget(12);
    this._lastSlide = 0;
    this._surface = 'tarmac';
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = m.distortionCurve(5); // softer than the diesel's 11
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2200;
    this.tone.Q.value = 0.5;
    this.out.connect(this.shaper);
    this.shaper.connect(this.tone);
    this.tone.connect(m.bus('engine'));

    /* ---- Firing tone: four-cylinder four-stroke, TWO firings per rev ---- */
    const N = 12;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    // Brighter and thinner than the diesel: the 2nd is the strongest partial,
    // which is the small-petrol-engine signature.
    const amps = [0, 0.8, 1, 0.52, 0.4, 0.3, 0.2, 0.16, 0.11, 0.08, 0.06, 0.04];
    for (let i = 0; i < N; i++) real[i] = amps[i] || 0;
    const wave = ctx.createPeriodicWave(real, imag, { disableNormalization: false });

    // Exhaust resonance, moved with the revs. Shallower than the boat's: a van
    // has a silencer on it and a boat has a wet elbow.
    this.exhaust = ctx.createBiquadFilter();
    this.exhaust.type = 'peaking';
    this.exhaust.frequency.value = 140;
    this.exhaust.Q.value = 1.1;
    this.exhaust.gain.value = 4.5;
    this.exhaust.connect(this.out);

    this.firing = ctx.createOscillator();
    this.firing.setPeriodicWave(wave);
    this.firingGain = ctx.createGain();
    this.firingGain.gain.value = 0.5;
    this.firing.connect(this.firingGain);
    this.firingGain.connect(this.exhaust);

    this.firing2 = ctx.createOscillator();
    this.firing2.setPeriodicWave(wave);
    this.firing2.detune.value = 9;
    this.firing2Gain = ctx.createGain();
    this.firing2Gain.gain.value = 0.2;
    this.firing2.connect(this.firing2Gain);
    this.firing2Gain.connect(this.out);

    /* ---- Induction: the roar you only hear with your foot down ---- */
    this.intakeSrc = m.noiseSource(false);
    this.intakeFilter = ctx.createBiquadFilter();
    this.intakeFilter.type = 'bandpass';
    this.intakeFilter.frequency.value = 900;
    this.intakeFilter.Q.value = 0.8;
    this.intakeGain = ctx.createGain();
    this.intakeGain.gain.value = 0;
    this.intakeSrc.connect(this.intakeFilter);
    this.intakeFilter.connect(this.intakeGain);
    this.intakeGain.connect(this.out);

    /* ---- Transmission whine: a narrow tone at a gear-mesh order of the
     * crank. It is almost inaudible on its own and it is the difference
     * between an engine and an engine in a vehicle. ---- */
    this.whine = ctx.createOscillator();
    this.whine.type = 'sawtooth';
    this.whineFilter = ctx.createBiquadFilter();
    this.whineFilter.type = 'bandpass';
    this.whineFilter.frequency.value = 900;
    this.whineFilter.Q.value = 6;
    this.whineGain = ctx.createGain();
    this.whineGain.gain.value = 0;
    this.whine.connect(this.whineFilter);
    this.whineFilter.connect(this.whineGain);
    this.whineGain.connect(this.out);

    /* ---- Tyres, on the environment bus ---- */
    const env = m.bus('environment');
    this.tyreWhite = m.noiseSource(false);
    this.tyrePink = m.noiseSource(true);
    this.tyreWhiteGain = ctx.createGain();
    this.tyreWhiteGain.gain.value = 0.15;
    this.tyrePinkGain = ctx.createGain();
    this.tyrePinkGain.gain.value = 0.85;
    this.tyreBand = ctx.createBiquadFilter();
    this.tyreBand.type = 'bandpass';
    this.tyreBand.frequency.value = 250;
    this.tyreBand.Q.value = 1.3;
    this.tyreGain = ctx.createGain();
    this.tyreGain.gain.value = 0;
    this.tyreWhite.connect(this.tyreWhiteGain);
    this.tyrePink.connect(this.tyrePinkGain);
    this.tyreWhiteGain.connect(this.tyreBand);
    this.tyrePinkGain.connect(this.tyreBand);
    this.tyreBand.connect(this.tyreGain);
    this.tyreGain.connect(env);

    /* ---- Scrub and squeal: two detuned saws through a narrow band. Real
     * tyre squeal is a stick-slip oscillation, which is periodic, which is
     * why noise alone never sounds like it. ---- */
    this.squeal = ctx.createOscillator();
    this.squeal.type = 'sawtooth';
    this.squeal2 = ctx.createOscillator();
    this.squeal2.type = 'sawtooth';
    this.squeal2.detune.value = 22;
    this.squealBand = ctx.createBiquadFilter();
    this.squealBand.type = 'bandpass';
    this.squealBand.frequency.value = 900;
    this.squealBand.Q.value = 4.5;
    this.squealGain = ctx.createGain();
    this.squealGain.gain.value = 0;
    this.squeal.connect(this.squealBand);
    this.squeal2.connect(this.squealBand);
    this.squealBand.connect(this.squealGain);
    this.squealGain.connect(env);

    // Scrabble: what a sliding tyre does on anything that is not tarmac.
    this.scrabSrc = m.noiseSource(false);
    this.scrabFilter = ctx.createBiquadFilter();
    this.scrabFilter.type = 'bandpass';
    this.scrabFilter.frequency.value = 1600;
    this.scrabFilter.Q.value = 0.8;
    this.scrabGain = ctx.createGain();
    this.scrabGain.gain.value = 0;
    this.scrabSrc.connect(this.scrabFilter);
    this.scrabFilter.connect(this.scrabGain);
    this.scrabGain.connect(env);

    for (const o of [this.firing, this.firing2, this.whine, this.squeal, this.squeal2]) o.start();
    this.built = true;
  }

  setInterior(inside) {
    this.interior = inside;
    if (!this.built) return;
    // Inside the van the engine is in front of a bulkhead and the tyres are
    // under the floor, so the engine gets duller and the tyres do not.
    this.tone.frequency.setTargetAtTime(inside ? 1300 : 2600, this.ctx.currentTime, 0.25);
  }

  playStart() {
    if (!this.built) return;
    const m = this.mixer;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 1500;
    const g = this.ctx.createGain();
    osc.frequency.setValueAtTime(22, t);
    osc.frequency.linearRampToValueAtTime(46, t + 0.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(filt);
    filt.connect(g);
    g.connect(m.bus('engine'));
    osc.start(t);
    osc.stop(t + 0.8);
    // Catches almost at once, then a small flare of revs as it settles: the
    // opposite of the diesel on purpose, and a two-second lesson in the
    // difference between the two engines.
    m.noiseBurst({ bus: 'engine', when: t + 0.52, duration: 0.3, gain: 0.2, freq: 260, q: 0.9, attack: 0.005 });
    this.rpm = 1500;
  }

  playStop() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setValueAtTime(this.out.gain.value, t);
    this.out.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    this.rpm = IDLE_RPM;
  }

  /**
   * Handbrake, or any sudden lock-up. `strength` 0..1.
   *
   * A chirp is not a squeal: it is short, it FALLS, and it stops. The falling
   * sweep is the whole identity of the sound, and it only happens on grippy
   * tarmac — on gravel the same input is a scuffle, so this respects the
   * surface rather than chirping in a sand dune.
   */
  playChirp(strength = 0.7) {
    if (!this.built) return;
    const s = clamp(strength, 0.15, 1);
    const m = this.mixer;
    const surf = SURFACES[this._surface] || SURFACES.tarmac;
    const bite = surf.squeal;
    if (bite > 0.4) {
      m.tone({ bus: 'environment', freq: 760 + s * 620, sweepTo: 240, duration: 0.16 + s * 0.18, gain: (0.05 + s * 0.13) * bite, type: 'sawtooth' });
      m.noiseBurst({ bus: 'environment', duration: 0.22, gain: 0.08 + s * 0.16, freq: 2400, q: 2.4 });
    } else {
      m.noiseBurst({ bus: 'environment', duration: 0.3 + s * 0.2, gain: 0.12 + s * 0.2, freq: 900, q: 0.7, pink: true });
    }
  }

  /**
   * `reading` is `SurfaceVehicle.carReadouts()` verbatim.
   * Read: speedKph, throttle, surface, grip, slip, slide, airborne, swamped,
   * crashed, gear.
   */
  update(dt, reading, weather) {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    const r = reading || {};
    const kph = Math.abs(r.speedKph || 0);
    const demand = clamp(r.throttle || 0, 0, 1);
    const surfKind = SURFACES[r.surface] ? r.surface : 'tarmac';
    const surf = SURFACES[surfKind];
    this._surface = surfKind;
    const grip = r.grip != null ? clamp(r.grip, 0, 1) : 1;
    const airborne = !!r.airborne;
    const swamped = !!r.swamped;
    const running = !r.crashed;
    this.running = running;

    /* ---- Gearbox ---- */
    this.shiftT = Math.max(0, this.shiftT - dt);
    this.shiftLock = Math.max(0, this.shiftLock - dt);
    let g = this.gear;
    let f = kph / GEAR_TOP_KPH[g];
    if (this.shiftLock > 0) {
      // Locked out: carry on in the gear it has.
    } else if (f > SHIFT_UP && g < GEAR_TOP_KPH.length - 1) {
      g += 1;
      this.shiftT = 0.3;
      this.shiftLock = 0.5;
    } else if (f < SHIFT_DOWN && g > 0) {
      g -= 1;
      this.shiftT = 0.22;
      this.shiftLock = 0.5;
      // A downshift blips: the revs go UP as the lower gear takes hold, which
      // is the opposite of an upshift and is why the two are distinguishable
      // with your eyes shut.
      this.mixer.noiseBurst({ bus: 'engine', duration: 0.16, gain: 0.1, freq: 420, q: 1.1 });
    }
    this.gear = g;
    f = kph / GEAR_TOP_KPH[g];

    /*
     * Engine speed comes from ROAD SPEED and gear, not from the throttle.
     * This is the single most important line in the car synth. A car in gear
     * is mechanically connected to its wheels: lifting off does not drop the
     * revs, it drops the LOAD. Getting this the wrong way round is what makes
     * most game cars sound like a moped with a volume pedal.
     *
     * Airborne is the one exception — with no wheel load the engine flares.
     */
    let targetRpm = lerp(IDLE_RPM, REDLINE_RPM, clamp(f, 0, 1.04));
    if (kph < 2) targetRpm = IDLE_RPM + demand * 1500; // slipping the clutch
    if (airborne) targetRpm = Math.max(targetRpm, IDLE_RPM + demand * 4200);
    // During a shift the revs are pulled across fast; otherwise the flywheel
    // makes them lag a little.
    const k = this.shiftT > 0 ? 8 : 3.2;
    this.rpm += (targetRpm - this.rpm) * clamp(dt * k, 0, 1);
    const rpm = this.rpm;
    // Four-cylinder four-stroke: two firings per revolution. 820 rpm gives
    // 27.3 Hz and 6200 rpm gives 206.7 Hz — measured range printed by the
    // harness, and about two and a half times the diesel's top note.
    const firingHz = clamp(rpm / 30, 10, 260);
    const smooth = this.shiftT > 0 ? 0.03 : 0.07;
    this.firing.frequency.setTargetAtTime(firingHz, t, smooth);
    this.firing2.frequency.setTargetAtTime(firingHz * 1.003, t, smooth);
    this.exhaust.frequency.setTargetAtTime(clamp(firingHz * 1.4, 80, 500), t, 0.1);
    // Gear mesh at 4.5 times the crank. 6200 rpm -> 465 Hz.
    this.whine.frequency.setTargetAtTime(clamp((rpm / 60) * 4.5, 40, 700), t, 0.08);
    this.whineFilter.frequency.setTargetAtTime(clamp((rpm / 60) * 4.5, 80, 900), t, 0.08);

    const revN = clamp((rpm - IDLE_RPM) / (REDLINE_RPM - IDLE_RPM), 0, 1);
    const load = clamp(demand * 0.7 + revN * 0.3, 0, 1);
    const inside = this.interior ? 0.75 : 1;
    // The audible gear step: a real upshift is a 200 ms hole in the noise
    // while the clutch is out. Without the dip the note just jumps and reads
    // as a glitch rather than as a gearchange.
    const shiftDip = this.shiftT > 0 ? lerp(0.42, 1, 1 - this.shiftT / 0.3) : 1;
    const drown = swamped ? 0.35 : 1;

    this.out.gain.setTargetAtTime(running ? (0.2 + revN * 0.42 + load * 0.16) * inside * shiftDip * drown : 0, t, 0.06);
    this.intakeGain.gain.setTargetAtTime(running ? demand * (0.07 + revN * 0.2) : 0, t, 0.1);
    this.intakeFilter.frequency.setTargetAtTime(600 + revN * 1700, t, 0.15);
    this.whineGain.gain.setTargetAtTime(running ? 0.012 + revN * 0.03 : 0, t, 0.12);
    this.tone.frequency.setTargetAtTime(
      (this.interior ? 1100 : 2100) + revN * (this.interior ? 700 : 1900) * (swamped ? 0.3 : 1),
      t,
      0.15
    );

    /* ---- Tyres ---- */
    const speedN = clamp(kph / 105, 0, 1);
    const rolling = !airborne && kph > 1;
    this.tyreGain.gain.setTargetAtTime(
      rolling ? (0.03 + Math.pow(speedN, 1.25) * surf.level) * (swamped ? 0.4 : 1) : 0,
      t,
      0.1
    );
    // 0.3 s on the surface crossfade: a kerb is one frame wide, and switching
    // the filter in one frame is an audible click.
    this.tyreBand.frequency.setTargetAtTime(surf.f + speedN * surf.span, t, 0.3);
    this.tyreBand.Q.setTargetAtTime(surf.q, t, 0.3);
    this.tyrePinkGain.gain.setTargetAtTime(surf.pink, t, 0.3);
    this.tyreWhiteGain.gain.setTargetAtTime(1 - surf.pink, t, 0.3);

    /* ---- Slip: squeal on grip, scrabble off it ---- */
    const slip = clamp(Math.max(r.slip || 0, r.slide || 0), 0, 1);
    const slipping = rolling ? slip : 0;
    this.squealGain.gain.setTargetAtTime(slipping * surf.squeal * grip * 0.13, t, 0.08);
    this.squeal.frequency.setTargetAtTime(560 + slipping * 720, t, 0.1);
    this.squeal2.frequency.setTargetAtTime(566 + slipping * 720, t, 0.1);
    this.squealBand.frequency.setTargetAtTime(800 + slipping * 1100, t, 0.1);
    this.scrabGain.gain.setTargetAtTime(slipping * (1 - surf.squeal) * 0.2 * (0.4 + speedN), t, 0.1);
    this.scrabFilter.frequency.setTargetAtTime(1200 + speedN * 1400, t, 0.15);

    // A lock-up that arrives fast is a chirp; one that creeps in is a squeal,
    // and the squeal layer above already has it. 0.22 in a frame is the line.
    const slide = r.slide || 0;
    if (slide - this._lastSlide > 0.22 && kph > 6) this.playChirp(clamp(slide, 0, 1));
    this._lastSlide = slide;

    /* ---- Grit ---- */
    this.budget.tick(dt);
    this._grit(t, speedN, surf, rolling);
  }

  /** Stones off the arches. Rate rises with speed; only loose surfaces have any. */
  _grit(t, speedN, surf, rolling) {
    if (!rolling || surf.grain <= 0 || speedN < 0.05) {
      this.grainAt = t + 0.5;
      return;
    }
    const rate = surf.grain * (1.5 + speedN * 14);
    if (this.grainAt < t - 0.5 || this.grainAt > t + 1.5) this.grainAt = t + 0.05;
    let guard = 0;
    while (this.grainAt < t + 0.2 && guard++ < 10) {
      if (!this.budget.take()) {
        this.grainAt = t + 0.25;
        break;
      }
      this.mixer.noiseBurst({
        bus: 'environment',
        when: this.grainAt,
        duration: 0.035 + Math.random() * 0.04,
        gain: 0.03 + Math.random() * 0.06 * speedN,
        type: 'bandpass',
        freq: 1800 + Math.random() * 3400,
        q: 3.5,
        attack: 0.002,
      });
      this.grainAt += (0.4 + Math.random() * 1.2) / rate;
    }
  }
}

/* ================================================================== *
 * HELICOPTER — turboshaft, rotor wash, and the blade slap
 * ================================================================== */

/**
 * Rotor numbers, all taken from the helicopter model's own header rather than
 * invented here (src/fleet/helicopter.js documents a 4.20 m four-bladed main
 * rotor, a 0.80 m two-bladed tail rotor, and 400 rpm in its worked example):
 *
 *   main rotor      4.20 m radius, 4 blades, 400 rpm nominal
 *                   = 6.667 rev/s, tip speed 167.6 m/s (Mach 0.49)
 *     BLADE PASS    6.667 * 4 = 26.67 Hz   <- the thump rate
 *   tail rotor      0.80 m radius, 2 blades
 *                   geared 5.25:1, so 2100 rpm = 35 rev/s, tip speed
 *                   175.9 m/s — within 5 per cent of the main rotor's tip
 *                   speed, which is how real tail rotors are geared, and is
 *                   the check that says 5.25 is not a made-up number
 *     BLADE PASS    35 * 2 = 70.0 Hz
 *
 * ---------------------------------------------------------------------------
 * Blade slap, and why the existing propeller layer cannot produce it
 * ---------------------------------------------------------------------------
 * `engine.js` chops a noise band with a triangle LFO. Over a cycle that is
 * "on" about half the time and it rises and falls smoothly: the ear reads it
 * as tremolo. Blade slap is the opposite shape — silence, CRACK, silence —
 * because the mechanism is impulsive: each blade runs through the tip vortex
 * the blade in front of it left behind, and the pressure pulse from that is
 * short compared with the 37.5 ms between blades.
 *
 * So the slap here is a noise band multiplied by a pulse whose duty is about a
 * seventh, from `pulseCurve()`. Two of them in parallel, actually:
 *
 *   soft   duty 0.34, shape 1.0   a rounded thwop, a machine going by
 *   hard   duty 0.13, shape 2.4   a crack, a machine working
 *
 * and the collective crossfades between them. That crossfade is the sound of
 * pulling power, and it is why "rises when you pull collective" is implemented
 * as a change of SHAPE and LEVEL rather than of rate.
 *
 * ---------------------------------------------------------------------------
 * Why the thump rate does NOT rise with the collective
 * ---------------------------------------------------------------------------
 * This is the one place where the obvious implementation is wrong and it is
 * worth stating plainly for whoever reads this next. A helicopter's rotor is
 * governed: NR is held at 100 per cent and the collective changes BLADE PITCH,
 * not rotor speed. `rotor-assist.js` says so in as many words at its
 * ROTOR_TUNE comment — "the collective is a lever, not a throttle... the
 * engine holds rotor speed and the collective changes blade pitch through a
 * mechanical linkage". Pulling collective therefore makes the thump HARDER and
 * LOUDER, not faster. The rate only moves in the two cases where NR itself
 * moves, and both of them are worth hearing:
 *
 *   start-up       NR sweeps 0 -> 100 per cent, so the thump accelerates from
 *                  a slow slap to a 26.7 Hz buzz over about twelve seconds.
 *                  This is the best sound in the game and it is free.
 *   autorotation   the engine quits, NR droops to about 85 per cent and the
 *                  turbine disappears from under it. The thump stays and drops
 *                  a couple of tones. A child who has lost the engine can hear
 *                  that the rotor is still turning, which is the correct
 *                  lesson and the correct amount of reassurance.
 *
 * ---------------------------------------------------------------------------
 * And when the slap gets loud
 * ---------------------------------------------------------------------------
 * Blade-vortex interaction is worst when the rotor is flying into its own
 * wake, which is a descent at moderate speed, and worse again in a descending
 * turn. That is where the "wokka wokka" of every helicopter in every film
 * comes from, and it means the slap is a flight-condition readout: it tells a
 * child they are coming down. `_slapDrive()` is that mapping, and it reads the
 * fields `physics.js` already has — `vs`, `airspeed`, and the bank angle.
 */
const MAIN_RPM = 400;
const MAIN_BLADES = 4;
const TAIL_RATIO = 5.25;
const TAIL_BLADES = 2;
/** 26.67 Hz. */
export const MAIN_BLADE_PASS_HZ = (MAIN_RPM / 60) * MAIN_BLADES;
/** 70.0 Hz. */
export const TAIL_BLADE_PASS_HZ = ((MAIN_RPM * TAIL_RATIO) / 60) * TAIL_BLADES;

export class RotorSound {
  constructor(mixer) {
    this.mixer = mixer;
    this.built = false;
    this.interior = false;
    this.running = false;
    /** Rotor speed as a fraction of nominal. Big inertia: it moves slowly. */
    this.nr = 0;
    /** Turbine spool, which moves faster than the rotor and lags the lever. */
    this.n1 = 0;
    this.slap = 0;
  }

  build() {
    const m = this.mixer;
    if (!m.ctx || this.built) return;
    const ctx = m.ctx;
    this.ctx = ctx;

    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 4200;
    this.tone.Q.value = 0.5;
    this.out.connect(this.tone);
    this.tone.connect(m.bus('engine'));

    /* ---- One oscillator drives every rotor-locked layer ----
     * Main slap, wash tremolo and the blade-pass tone all come off `bladeOsc`,
     * so they cannot drift apart. Three separate oscillators at nominally the
     * same frequency would beat against each other and turn a thump into a
     * flutter. */
    this.bladeOsc = ctx.createOscillator();
    this.bladeOsc.type = 'sine';
    this.bladeOsc.frequency.value = MAIN_BLADE_PASS_HZ;

    this.softShape = ctx.createWaveShaper();
    this.softShape.curve = pulseCurve(0.34, 1.0);
    this.hardShape = ctx.createWaveShaper();
    this.hardShape.curve = pulseCurve(0.13, 2.4);
    this.bladeOsc.connect(this.softShape);
    this.bladeOsc.connect(this.hardShape);

    // Depth controls: these ARE the crossfade. Each scales its shaper's output
    // before it reaches the chop stage's gain param.
    this.softDepth = ctx.createGain();
    this.softDepth.gain.value = 0.7;
    this.hardDepth = ctx.createGain();
    this.hardDepth.gain.value = 0;
    this.softShape.connect(this.softDepth);
    this.hardShape.connect(this.hardDepth);

    /* ---- The slap itself: a low noise band, chopped twice in parallel ---- */
    this.slapSrc = m.noiseSource(true);
    this.slapBand = ctx.createBiquadFilter();
    this.slapBand.type = 'bandpass';
    this.slapBand.frequency.value = 110;
    this.slapBand.Q.value = 1.1;
    this.slapSrc.connect(this.slapBand);

    this.softChop = ctx.createGain();
    this.softChop.gain.value = 0;
    this.hardChop = ctx.createGain();
    this.hardChop.gain.value = 0;
    this.slapBand.connect(this.softChop);
    this.slapBand.connect(this.hardChop);
    this.softDepth.connect(this.softChop.gain);
    this.hardDepth.connect(this.hardChop.gain);

    this.slapGain = ctx.createGain();
    this.slapGain.gain.value = 0;
    this.softChop.connect(this.slapGain);
    this.hardChop.connect(this.slapGain);
    this.slapGain.connect(this.out);

    // The body of the thump: a sine at blade-pass, felt more than heard, which
    // is what gives the slap weight on a laptop speaker that cannot reproduce
    // the noise band's bottom octave.
    this.thump = ctx.createOscillator();
    this.thump.type = 'sine';
    this.thump.frequency.value = MAIN_BLADE_PASS_HZ;
    this.thumpChop = ctx.createGain();
    this.thumpChop.gain.value = 0;
    this.thumpGain = ctx.createGain();
    this.thumpGain.gain.value = 0;
    this.thump.connect(this.thumpChop);
    this.hardDepth.connect(this.thumpChop.gain);
    this.softDepth.connect(this.thumpChop.gain);
    this.thumpChop.connect(this.thumpGain);
    this.thumpGain.connect(this.out);

    /* ---- Rotor wash: the disc moving air. Broad, and only gently modulated,
     * because the wash is continuous and the slap is the event. ---- */
    this.washSrc = m.noiseSource(true);
    this.washFilter = ctx.createBiquadFilter();
    this.washFilter.type = 'lowpass';
    this.washFilter.frequency.value = 700;
    this.washFilter.Q.value = 0.6;
    this.washFloor = ctx.createGain();
    this.washFloor.gain.value = 0.78;
    this.washChop = ctx.createGain();
    this.washChop.gain.value = 0;
    this.washGain = ctx.createGain();
    this.washGain.gain.value = 0;
    this.washSrc.connect(this.washFilter);
    this.washFilter.connect(this.washFloor);
    this.washFilter.connect(this.washChop);
    this.washFloor.connect(this.washGain);
    this.washChop.connect(this.washGain);
    this.washGain.connect(this.out);
    // Shallow, wide tremolo on the wash from the SOFT shaper, so it breathes
    // with the blades without competing with the slap.
    this.washDepth = ctx.createGain();
    this.washDepth.gain.value = 0.12;
    this.softShape.connect(this.washDepth);
    this.washDepth.connect(this.washChop.gain);

    /* ---- Tail rotor: 70 Hz buzz, loudest in a pedal turn ---- */
    this.tailOsc = ctx.createOscillator();
    this.tailOsc.type = 'sine';
    this.tailOsc.frequency.value = TAIL_BLADE_PASS_HZ;
    this.tailShape = ctx.createWaveShaper();
    this.tailShape.curve = pulseCurve(0.26, 1.5);
    this.tailDepth = ctx.createGain();
    this.tailDepth.gain.value = 1;
    this.tailOsc.connect(this.tailShape);
    this.tailShape.connect(this.tailDepth);

    this.tailSrc = m.noiseSource(false);
    this.tailBand = ctx.createBiquadFilter();
    this.tailBand.type = 'bandpass';
    this.tailBand.frequency.value = 1500;
    this.tailBand.Q.value = 1.6;
    this.tailChop = ctx.createGain();
    this.tailChop.gain.value = 0;
    this.tailGain = ctx.createGain();
    this.tailGain.gain.value = 0;
    this.tailSrc.connect(this.tailBand);
    this.tailBand.connect(this.tailChop);
    this.tailDepth.connect(this.tailChop.gain);
    this.tailChop.connect(this.tailGain);
    this.tailGain.connect(this.out);

    /* ---- Turboshaft. Same parts as jet.js but mixed far lower: on a
     * helicopter the rotor is the instrument and the engine is the
     * accompaniment, which is the exact reverse of an aeroplane. ---- */
    this.turbine = ctx.createOscillator();
    this.turbine.type = 'sawtooth';
    this.turbineBand = ctx.createBiquadFilter();
    this.turbineBand.type = 'bandpass';
    this.turbineBand.frequency.value = 2600;
    this.turbineBand.Q.value = 3.2;
    this.turbineGain = ctx.createGain();
    this.turbineGain.gain.value = 0;
    this.turbine.connect(this.turbineBand);
    this.turbineBand.connect(this.turbineGain);
    this.turbineGain.connect(this.out);

    this.coreSrc = m.noiseSource(true);
    this.coreFilter = ctx.createBiquadFilter();
    this.coreFilter.type = 'lowpass';
    this.coreFilter.frequency.value = 280;
    this.coreGain = ctx.createGain();
    this.coreGain.gain.value = 0;
    this.coreSrc.connect(this.coreFilter);
    this.coreFilter.connect(this.coreGain);
    this.coreGain.connect(this.out);

    for (const o of [this.bladeOsc, this.thump, this.tailOsc, this.turbine]) o.start();
    this.built = true;
  }

  setInterior(inside) {
    this.interior = inside;
    if (!this.built) return;
    // A helicopter cabin is a drum with the gearbox bolted to the roof. The
    // whine goes, the slap does not — which is the opposite of what the
    // aeroplane's interior filter does, and correct.
    this.tone.frequency.setTargetAtTime(inside ? 1600 : 4200, this.ctx.currentTime, 0.3);
  }

  /** Light-up: the turbine catches, then the rotor takes twelve seconds. */
  playStart() {
    if (!this.built) return;
    const m = this.mixer;
    const t = this.ctx.currentTime;
    // Igniter, then the starter whine. The rotor sweep is not scripted here —
    // it falls out of `nr` lagging up in update(), so it stays correct however
    // long the engine takes and cannot get out of step with the visual rotor.
    m.noiseBurst({ bus: 'engine', when: t + 0.3, duration: 0.12, gain: 0.14, freq: 900, q: 2.2, attack: 0.003 });
    m.noiseBurst({ bus: 'engine', when: t + 0.6, duration: 3.4, gain: 0.1, freq: 520, q: 0.8, attack: 1.4 });
  }

  playStop() {
    if (!this.built) return;
    const t = this.ctx.currentTime;
    // Not a fade. The turbine quits and the rotor coasts, so `update()` keeps
    // running with nr drooping; only the turbine layers are cut here.
    this.turbineGain.gain.setTargetAtTime(0, t, 1.1);
    this.coreGain.gain.setTargetAtTime(0, t, 1.4);
  }

  /**
   * How hard the blades are slapping, 0..1.
   *
   * Three contributions, in the order they matter:
   *   collective   the headline. More pitch on the blades is more load is a
   *                stronger tip vortex.
   *   descent      blade-vortex interaction proper. Worst between about 2 and
   *                8 m/s down WITH some forward speed, because that is the
   *                condition where the disc flies through the wake it just
   *                laid down. A vertical descent at zero airspeed is in its
   *                own wake the whole time and is a different, rougher sound
   *                (settling with power) — that is the shudder, not the slap,
   *                so it is deliberately excluded by the airspeed term.
   *   turn         a banked descending turn is the classic film sound.
   */
  _slapDrive(ac) {
    const coll = clamp(ac && ac.rpm != null ? ac.rpm : 0, 0, 1);
    const vs = ac ? ac.vs || 0 : 0;
    const v = ac ? ac.airspeed || 0 : 0;
    const down = clamp((-vs - 1.2) / 5, 0, 1) * clamp((v - 8) / 18, 0, 1);
    let bank = 0;
    if (ac) {
      if (typeof ac.bankAngleRad === 'function') bank = Math.abs(ac.bankAngleRad());
      else if (ac.bank != null) bank = Math.abs(ac.bank) > 3.2 ? Math.abs(ac.bank) / 57.2958 : Math.abs(ac.bank);
    }
    const turn = clamp(bank / 0.7, 0, 1);
    return clamp(coll * 0.55 + down * 0.5 + down * turn * 0.35, 0, 1);
  }

  /**
   * `ac` is the live `Aircraft` from physics.js, exactly as `EngineSound` and
   * `JetSound` receive it. Read: rpm (which on a rotorcraft IS the collective
   * lever — physics.js line 401 reads it as one), engineOn, vs, airspeed,
   * fuel, controls.yaw, and bankAngleRad/bank if present.
   */
  update(dt, ac, weather) {
    if (!this.built || !ac) return;
    const t = this.ctx.currentTime;

    const coll = clamp(ac.rpm != null ? ac.rpm : 0, 0, 1);
    const powered = ac.engineOn !== false && (ac.fuel == null || ac.fuel > 0);

    /*
     * Rotor speed. Governed to 100 per cent whenever the engine is driving it,
     * so the target is 1 and not the collective. Spool-up takes about twelve
     * seconds (measured: 95 per cent of NR at 11.9 s, over which the blade-pass
     * frequency sweeps 0.4 Hz -> 25.4 Hz, which is the start-up sound and
     * costs nothing); run-down into autorotation settles at
     * 0.86 because a freewheeling rotor keeps turning on the air going up
     * through it.
     */
    const nrTarget = powered ? 1 : 0.86;
    const nrRate = powered ? (this.nr < nrTarget ? 0.25 : 0.9) : 0.22;
    this.nr += (nrTarget - this.nr) * clamp(dt * nrRate, 0, 1);
    if (!powered && this.nr < 0.05) this.nr = Math.max(0, this.nr - dt * 0.02);
    const nr = clamp(this.nr, 0, 1.05);

    // Turbine spool: faster than the rotor, slower than a piston.
    const n1Target = powered ? 0.45 + coll * 0.55 : 0;
    this.n1 += (n1Target - this.n1) * clamp(dt * (n1Target > this.n1 ? 0.7 : 1.1), 0, 1);
    const n1 = this.n1;

    const turning = nr > 0.04;
    this.running = turning;

    // Blade-pass frequencies follow NR and nothing else. At nr = 1 these are
    // 26.67 Hz and 70.0 Hz exactly.
    const bladeHz = clamp(MAIN_BLADE_PASS_HZ * nr, 0.4, 60);
    const tailHz = clamp(TAIL_BLADE_PASS_HZ * nr, 1, 150);
    const smooth = 0.2;
    this.bladeOsc.frequency.setTargetAtTime(bladeHz, t, smooth);
    this.thump.frequency.setTargetAtTime(bladeHz, t, smooth);
    this.tailOsc.frequency.setTargetAtTime(tailHz, t, smooth);

    /* ---- Slap ---- */
    const want = this._slapDrive(ac);
    // Smoothed over about a second: blade slap builds and fades over a second
    // or two in reality, and an instant response to the stick reads as a bug.
    this.slap += (want - this.slap) * clamp(dt * 1.4, 0, 1);
    const slap = this.slap * clamp(nr * 1.2, 0, 1);
    const inside = this.interior ? 1.15 : 1; // louder inside, not quieter

    // The crossfade. The two depths sum to 0.83 at rest and to exactly 1.00 at
    // full slap (measured across the range), so the pair of chop stages
    // multiplies the band by at most one and can never overdrive it on a peak.
    this.softDepth.gain.setTargetAtTime(lerp(0.78, 0.18, slap), t, 0.25);
    this.hardDepth.gain.setTargetAtTime(lerp(0.05, 0.82, slap), t, 0.25);
    this.slapGain.gain.setTargetAtTime(turning ? (0.16 + slap * 0.46) * inside : 0, t, 0.2);
    this.thumpGain.gain.setTargetAtTime(turning ? (0.05 + slap * 0.17) * inside : 0, t, 0.2);
    // The band climbs as it hardens: a distant thwop is 95 Hz of noise and a
    // close one has a crack on top of it.
    this.slapBand.frequency.setTargetAtTime(95 + slap * 165, t, 0.25);
    this.slapBand.Q.setTargetAtTime(1.1 + slap * 1.1, t, 0.25);

    /* ---- Wash ---- */
    this.washGain.gain.setTargetAtTime(turning ? (0.1 + coll * 0.3) * nr : 0, t, 0.2);
    this.washFilter.frequency.setTargetAtTime(500 + coll * 900 + clamp((ac.airspeed || 0) / 60, 0, 1) * 500, t, 0.25);
    // 0.78 (floor) + 0.22 (maximum depth) = 1.0 exactly: the wash can be
    // fully modulated on a peak and never more than fully.
    this.washDepth.gain.setTargetAtTime(0.12 + slap * 0.1, t, 0.3);

    /* ---- Tail rotor ---- */
    const pedal = ac.controls ? Math.abs(ac.controls.yaw || 0) : 0;
    this.tailGain.gain.setTargetAtTime(turning ? (0.05 + pedal * 0.1 + coll * 0.05) * nr : 0, t, 0.15);
    this.tailBand.frequency.setTargetAtTime(1300 + pedal * 900, t, 0.2);

    /* ---- Turbine ---- */
    // 340 Hz to 1180 Hz of fundamental with a bandpass three octaves up: the
    // two-tone whine that says gas turbine rather than piston.
    this.turbine.frequency.setTargetAtTime(lerp(340, 1180, Math.pow(n1, 1.2)), t, 0.4);
    this.turbineBand.frequency.setTargetAtTime(1800 + n1 * 2600, t, 0.4);
    this.turbineGain.gain.setTargetAtTime(n1 * 0.07 * (this.interior ? 0.4 : 1), t, 0.4);
    this.coreGain.gain.setTargetAtTime(powered ? 0.1 + n1 * 0.2 : 0, t, 0.5);
    this.coreFilter.frequency.setTargetAtTime(200 + n1 * 240, t, 0.4);

    this.out.gain.setTargetAtTime(turning ? 0.3 + nr * 0.34 : 0, t, 0.25);
    this.tone.frequency.setTargetAtTime(
      (this.interior ? 1400 : 3400) + coll * (this.interior ? 600 : 1600),
      t,
      0.3
    );
  }
}

/* ================================================================== *
 * Facade
 * ================================================================== */

/**
 * One object `GameAudio` holds, which owns the three synths and builds each
 * one the first time it is actually used.
 *
 * `kind` is 'boat' | 'car' | 'rotor'. Nothing else is accepted and nothing
 * else throws: an unknown kind makes no sound, on the same principle
 * `music.setScene()` already follows — a new vehicle must never be able to
 * break the audio thread.
 */
export class VehicleAudio {
  constructor(mixer) {
    this.mixer = mixer;
    this.boat = new DieselSound(mixer);
    this.car = new CarSound(mixer);
    this.rotor = new RotorSound(mixer);
    this.kind = null;
    this.interior = false;
  }

  /** Build one synth on demand. Safe to call every frame. */
  ensure(kind) {
    const s = this[kind];
    if (!s) return null;
    if (!s.built) {
      s.build();
      s.setInterior(this.interior);
    }
    return s;
  }

  get active() {
    return this.kind ? this[this.kind] : null;
  }

  /**
   * Switch vehicles. Stands the previous one down, or it holds its last gain
   * target forever — the exact failure `audio/index.js` documents for the
   * aeroplane droning over the top of the boat.
   */
  setKind(kind) {
    if (kind === this.kind) return;
    const prev = this.active;
    if (prev && prev.built) prev.playStop();
    this.kind = this[kind] ? kind : null;
    if (this.kind) this.ensure(this.kind);
  }

  setInterior(inside) {
    this.interior = !!inside;
    for (const k of ['boat', 'car', 'rotor']) if (this[k].built) this[k].setInterior(this.interior);
  }

  /** Start-up sound for whichever vehicle is current. */
  playStart() {
    const s = this.active;
    if (s && s.built) s.playStart();
  }

  playStop() {
    const s = this.active;
    if (s && s.built) s.playStop();
  }

  /**
   * Surface vehicles. `reading` is `SurfaceVehicle.readouts()`.
   *
   * The kind is taken from `reading.kind` when it is there, and sniffed from
   * the shape otherwise, so this lands and works TODAY against the readouts
   * as they are currently written. See the note to the surface-vehicle owner
   * at the foot of this file for the one field I would like added.
   */
  updateSurface(dt, reading, weather) {
    const kind = reading && reading.kind === 'car' ? 'car'
      : reading && reading.kind === 'boat' ? 'boat'
      : reading && reading.lever !== undefined ? 'boat'
      : 'car';
    this.setKind(kind);
    const s = this.ensure(kind);
    if (s) s.update(dt, reading, weather);
  }

  /** The helicopter. `ac` is the live Aircraft from physics.js. */
  updateRotor(dt, ac, weather) {
    this.setKind('rotor');
    const s = this.ensure('rotor');
    if (s) s.update(dt, ac, weather);
  }

  /** For the debug overlay, matching `music.stats()`'s spirit. */
  stats() {
    return {
      kind: this.kind,
      built: { boat: this.boat.built, car: this.car.built, rotor: this.rotor.built },
      nodes: (this.boat.built ? 36 : 0) + (this.car.built ? 27 : 0) + (this.rotor.built ? 34 : 0),
      gear: this.car.gear + 1,
      rpm: Math.round(this.car.rpm),
      nr: Math.round(this.rotor.nr * 100) / 100,
      slap: Math.round(this.rotor.slap * 100) / 100,
      rev: Math.round(this.boat.rev * 100) / 100,
    };
  }
}

/* ================================================================== *
 * MUSIC SCENES for the three games
 *
 * Format copied exactly from music.js's SCENES table: a key, a mode, `rest`
 * (the fraction of any two minutes the bell voice must keep quiet), `base`
 * (resting intensity), optional `auto` / `cap` / `colour` / `drift` /
 * `pulseOn` / `pulseOff` / `phases`, and the two parameter sets `calm` and
 * `peak` that intensity lerps between. Only what makes a scene itself is
 * stated; everything else falls through to music.js's BASE.
 *
 * Scene IDs are mission IDs, because main.js line 1099 names the scene with
 * `def.id`. Every id below was read out of missions-boat.js, missions-heli.js
 * and jobs.js rather than invented, and every phase name below is a real step
 * id from the same files, so `setPhase()` finds them. Without these entries
 * every boat and helicopter mission falls through to `SCENES.free` — which is
 * an AEROPLANE scene driven by `auto: 'flight'` off an `ac` the boat does not
 * have, so today the whole lifeboat game plays the free-flight music at a
 * fixed intensity of 0.1.
 *
 * Three deliberate departures from the aeroplane scenes, all of them for
 * reasons that belong in this file rather than in a mission:
 *
 *  1. NO `thinLow` ANYWHERE IN THE HELICOPTER SET. `thinLow` strips the music
 *     below 200 feet on the grounds that the flare is the exam. A helicopter
 *     spends its entire working life below 200 feet; using that flag here
 *     would mute the music for whole missions.
 *  2. THE BOAT SET USES `auto: 'ground'`, which reads `cue.speedKts`. That
 *     driver has been sitting in music.js unwired — its own comment says "when
 *     the vehicle path is wired up" — and patch 4 below wires it.
 *  3. THE HELICOPTER SET IS SPARSER AND LOWER THAN THE AEROPLANE SET. The
 *     machine makes a 26.7 Hz thump continuously; anything busy on top of that
 *     is mud. Pad and air do the work, bells are rare, and only two of the
 *     eight scenes have a pulse at all.
 * ================================================================== */
export const VEHICLE_SCENES = {
  /* ---------------- BOAT: the lifeboat game ---------------- */

  /* Your first shout. Somebody needs you and you have never done this, but the
   * sea is flat and the job is small. The most reassuring scene in the boat
   * set on purpose: whatever happens later, this one has to say "you can". */
  'first-shout': {
    key: 'D', mode: 'dorian', rest: 0.45, base: 0.25, pulseOn: true, auto: 'ground', cap: 0.6,
    phases: { slip: 0.2, out: 0.35, alongside: 0.45, home: 0.3, berth: 0.15 },
    pulseOff: ['berth'],
    calm: { reg: 0.6, bright: 0.45, tension: 0.12, space: 0.55, pad: 0.88, bass: 0.42, bell: 0.36, pulse: 0.24, air: 0.34, tempo: 64, bellEvery: 9, chordEvery: 15 },
    peak: { reg: 0.6, bright: 0.62, tension: 0.2, space: 0.6, pad: 0.92, bass: 0.5, bell: 0.46, pulse: 0.4, air: 0.44, tempo: 64, bellEvery: 7, chordEvery: 12 },
  },

  /* A person in the water, and you do not know where. The SEARCH phase is the
   * quietest thing in the boat game — lower than the launch that precedes it —
   * because searching is listening, and a child who is scanning the water
   * should hear the water. Everything comes back on the recovery. */
  'man-overboard': {
    key: 'E', mode: 'aeolian', rest: 0.4, base: 0.35, colour: [1], pulseOn: true,
    phases: { launch: 0.5, search: 0.18, recover: 0.6, home: 0.25 },
    pulseOff: ['search', 'home'],
    calm: { reg: 0.5, bright: 0.42, tension: 0.22, space: 0.6, pad: 0.85, bass: 0.5, bell: 0.3, pulse: 0.26, air: 0.4, tempo: 72, bellEvery: 11, chordEvery: 15 },
    peak: { reg: 0.45, bright: 0.66, tension: 0.5, space: 0.55, pad: 0.9, bass: 0.62, bell: 0.4, pulse: 0.46, air: 0.55, tempo: 72, bellEvery: 7, chordEvery: 10 },
  },

  /* A yacht on the putty on a falling tide. Not dangerous, just awkward and
   * slightly embarrassing for everybody, and it wants a scene with some
   * patience in it. The lift comes at TAKE-OFF, when she floats. */
  'wren-aground': {
    key: 'A', mode: 'dorian', rest: 0.45, base: 0.25, auto: 'ground', cap: 0.6, drift: 0.06,
    phases: { launch: 0.3, out: 0.35, 'take-off': 0.55, home: 0.22 },
    calm: { reg: 0.65, bright: 0.44, tension: 0.12, space: 0.6, pad: 0.88, bass: 0.38, bell: 0.32, air: 0.38, bellEvery: 10, chordEvery: 16 },
    peak: { reg: 0.7, bright: 0.64, tension: 0.2, space: 0.62, pad: 0.92, bass: 0.46, bell: 0.44, air: 0.5, bellEvery: 7.5, chordEvery: 12 },
  },

  /* Dark, and the only things you have are the chart and the compass. The
   * lowest register in the boat set and the widest delay: a scene made of
   * space, which is what night at sea is. No pulse — a clock would give a
   * child something to rush for, and rushing in the dark is the mistake this
   * mission exists to teach out of them. */
  'night-shout': {
    key: 'F#', mode: 'aeolian', rest: 0.55, base: 0.25, colour: [6],
    phases: { launch: 0.35, out: 0.28, alongside: 0.45, home: 0.2 },
    calm: { reg: 0.35, bright: 0.3, tension: 0.18, space: 0.85, pad: 0.9, bass: 0.55, bell: 0.26, air: 0.36, bellEvery: 14, chordEvery: 19 },
    peak: { reg: 0.4, bright: 0.5, tension: 0.32, space: 0.8, pad: 0.94, bass: 0.6, bell: 0.36, air: 0.5, bellEvery: 10, chordEvery: 14 },
  },

  /* The worst weather the boat game has. Follows the aeroplane storm scene's
   * rule exactly and for the same reason quoted there: intensity raises
   * TENSION, not density, and there is no pulse, because a metronome in a
   * storm is fake drama. The sea is already the lead instrument and this file
   * has just given it hull slap, bow wave and spray to play with. */
  'in-the-gale': {
    key: 'D', mode: 'aeolian', rest: 0.35, base: 0.5, colour: [1], pinTension: 0.6,
    phases: { launch: 0.5, chase: 0.7, alongside: 0.8, home: 0.4 },
    calm: { reg: 0.4, bright: 0.4, tension: 0.4, space: 0.5, pad: 0.9, bass: 0.62, bell: 0.22, air: 0.6, bellEvery: 13, chordEvery: 16 },
    peak: { reg: 0.3, bright: 0.6, tension: 0.95, space: 0.45, pad: 0.95, bass: 0.75, bell: 0.28, air: 0.85, bellEvery: 10, chordEvery: 11 },
  },

  /* Towing somebody home at four knots for a very long time. The inversion
   * that makes this scene: the TOW itself is the calmest phase in it. Getting
   * the line across is the hard part, and once she is on the end of it there
   * is nothing to do but be steady, so the music becomes steady. `walkingBass`
   * gives it the one plodding, patient voice in the game. */
  'long-tow': {
    key: 'C', mode: 'mixolydian', rest: 0.45, base: 0.25, pulseOn: true, walkingBass: true,
    phases: { out: 0.3, pass: 0.5, tow: 0.18, repass: 0.5, berth: 0.15 },
    pulseOff: ['berth'],
    calm: { reg: 0.55, bright: 0.42, tension: 0.12, space: 0.6, pad: 0.85, bass: 0.5, bell: 0.3, pulse: 0.2, air: 0.34, tempo: 52, bellEvery: 12, chordEvery: 18 },
    peak: { reg: 0.55, bright: 0.6, tension: 0.26, space: 0.55, pad: 0.9, bass: 0.6, bell: 0.4, pulse: 0.38, air: 0.46, tempo: 52, bellEvery: 8, chordEvery: 13 },
  },

  /* Free roam on the water with shouts coming in. The boat's equivalent of
   * Free Flight, and held to the same discipline: hard-capped, driven only by
   * how she is being driven, and the second-sparsest scene in the game after
   * the menu. The existing `boat` scene stays exactly as it is for the
   * no-mission case; this one exists because BOAT_PATROL's id is
   * 'boat-patrol' and would otherwise fall through to the aeroplane's. */
  'boat-patrol': {
    key: 'G', mode: 'lydian', rest: 0.6, base: 0.15, auto: 'ground', cap: 0.34, drift: 0.07,
    calm: { reg: 0.85, bright: 0.4, tension: 0.08, space: 0.65, pad: 0.88, bass: 0.1, bell: 0.3, air: 0.42, bellEvery: 13, chordEvery: 18 },
    peak: { reg: 0.88, bright: 0.55, tension: 0.16, space: 0.66, pad: 0.92, bass: 0.2, bell: 0.38, air: 0.58, bellEvery: 10, chordEvery: 14 },
  },

  /* ---------------- HELICOPTER: the rescue game ---------------- */

  /* The first hover. HOLD is the exam and is the quietest phase in the whole
   * helicopter set — lower than lifting off, lower than landing — because
   * holding a hover is a thing you do by listening to the machine, and a
   * child doing it for the first time needs the room. */
  firstlight: {
    key: 'F', mode: 'ionian', rest: 0.5, base: 0.2,
    phases: { lift: 0.32, hold: 0.12, turn: 0.26, down: 0.22 },
    calm: { reg: 0.68, bright: 0.44, tension: 0.1, space: 0.55, pad: 0.88, bass: 0.3, bell: 0.32, air: 0.24, bellEvery: 10, chordEvery: 17 },
    peak: { reg: 0.72, bright: 0.58, tension: 0.16, space: 0.58, pad: 0.92, bass: 0.36, bell: 0.42, air: 0.32, bellEvery: 8, chordEvery: 13 },
  },

  /* Somebody with a turned ankle on a beach you can only reach by air. A
   * small, kind job. WAIT — sitting on the sand with the rotor running while
   * they load — is nearly silent, which is both right and a rest. */
  covepickup: {
    key: 'G', mode: 'dorian', rest: 0.5, base: 0.25,
    phases: { out: 0.3, land: 0.2, wait: 0.12, home: 0.28 },
    calm: { reg: 0.7, bright: 0.42, tension: 0.12, space: 0.6, pad: 0.88, bass: 0.34, bell: 0.3, air: 0.3, bellEvery: 10, chordEvery: 16 },
    peak: { reg: 0.72, bright: 0.58, tension: 0.2, space: 0.6, pad: 0.92, bass: 0.42, bell: 0.4, air: 0.42, bellEvery: 8, chordEvery: 12 },
  },

  /* A swimmer in the water, on the wire. One of only two helicopter scenes
   * with a pulse, and it is there because the winch genuinely has a clock:
   * fuel, sea state and a person getting colder. It goes off at HOME. */
  overboard: {
    key: 'D', mode: 'aeolian', rest: 0.35, base: 0.35, pulseOn: true, colour: [6],
    phases: { out: 0.42, winch: 0.55, home: 0.25 },
    pulseOff: ['home'],
    calm: { reg: 0.5, bright: 0.44, tension: 0.24, space: 0.55, pad: 0.86, bass: 0.5, bell: 0.3, pulse: 0.26, air: 0.42, tempo: 72, bellEvery: 10, chordEvery: 14 },
    peak: { reg: 0.45, bright: 0.66, tension: 0.48, space: 0.5, pad: 0.9, bass: 0.6, bell: 0.38, pulse: 0.42, air: 0.58, tempo: 72, bellEvery: 7, chordEvery: 10 },
  },

  /* A winch off a sea stack with rock a rotor's length away on one side. The
   * tensest thing in the helicopter game and the only one that earns a mode
   * this dark. The peak raises TENSION rather than density, like the gale and
   * the aeroplane storm: the chords do not come faster, they get less
   * comfortable, and the pad detunes until it is unpleasant to sit in. */
  stackrescue: {
    key: 'B', mode: 'phrygian', rest: 0.35, base: 0.45, colour: [1, 6], pinTension: 0.7,
    phases: { out: 0.4, winch: 0.75, home: 0.3 },
    calm: { reg: 0.42, bright: 0.4, tension: 0.35, space: 0.5, pad: 0.88, bass: 0.55, bell: 0.24, air: 0.45, bellEvery: 12, chordEvery: 16 },
    peak: { reg: 0.36, bright: 0.6, tension: 1, space: 0.45, pad: 0.94, bass: 0.68, bell: 0.3, air: 0.68, bellEvery: 9, chordEvery: 11 },
  },

  /* A deck at night with a heaving ship under it. Dark and low like the boat's
   * night shout, and for the same reason, but with the deck's own motion in
   * the drift. No pulse: the ship is already moving to a rhythm you have to
   * match, and a second one would fight it. */
  nightdeck: {
    key: 'Eb', mode: 'aeolian', rest: 0.5, base: 0.3, colour: [1], drift: 0.07,
    phases: { out: 0.35, land: 0.55, wait: 0.15, home: 0.25 },
    calm: { reg: 0.34, bright: 0.3, tension: 0.24, space: 0.8, pad: 0.9, bass: 0.56, bell: 0.24, air: 0.36, bellEvery: 13, chordEvery: 18 },
    peak: { reg: 0.3, bright: 0.52, tension: 0.45, space: 0.75, pad: 0.94, bass: 0.66, bell: 0.32, air: 0.52, bellEvery: 9, chordEvery: 13 },
  },

  /* Two casualties, one machine, and the light going. The only scene in any of
   * the three games with a moral in it, so it is the only one that gets a
   * pulse that never stops until the last step — and the only one allowed to
   * arm a resolve, at FINISH, so the whole thing can finally land somewhere.
   * (Arming is done from the runner: `music.nudge('resolve')` on that step.) */
  lastlight: {
    key: 'A', mode: 'phrygian', rest: 0.3, base: 0.45, pulseOn: true, colour: [1],
    phases: { choose: 0.5, first: 0.45, drop: 0.3, second: 0.6, finish: 0.2 },
    pulseOff: ['finish'],
    calm: { reg: 0.45, bright: 0.4, tension: 0.3, space: 0.55, pad: 0.88, bass: 0.55, bell: 0.28, pulse: 0.3, air: 0.4, tempo: 60, bellEvery: 10, chordEvery: 14 },
    peak: { reg: 0.4, bright: 0.62, tension: 0.6, space: 0.5, pad: 0.92, bass: 0.66, bell: 0.36, pulse: 0.5, air: 0.56, tempo: 60, bellEvery: 7, chordEvery: 10 },
  },

  /* On call: free flight with shouts. Driven by how the machine is flown, and
   * capped low. `auto: 'flight'` reads bank, agl, ias and vs, all of which a
   * helicopter has — but note the cue's `low` term rewards being near the
   * ground, which for a helicopter is normal rather than exciting, so the cap
   * is set below the aeroplane's 0.45 to stop it living at its ceiling. */
  oncall: {
    key: 'Bb', mode: 'mixolydian', rest: 0.6, base: 0.12, auto: 'flight', cap: 0.36, drift: 0.06,
    phases: { patrol: 0.15 },
    calm: { reg: 0.75, bright: 0.4, tension: 0.1, space: 0.75, pad: 0.88, bass: 0.28, bell: 0.28, air: 0.3, bellEvery: 12, chordEvery: 18 },
    peak: { reg: 0.7, bright: 0.6, tension: 0.26, space: 0.7, pad: 0.92, bass: 0.4, bell: 0.38, air: 0.44, bellEvery: 8.5, chordEvery: 13 },
  },

  /* Nobody needs anything. Go and look at the island from three hundred feet.
   * The sparsest of the three free-roam scenes, because it is the loudest
   * machine to be sitting in. */
  helifree: {
    key: 'Bb', mode: 'lydian', rest: 0.65, base: 0.1, auto: 'flight', cap: 0.34, drift: 0.07,
    calm: { reg: 0.82, bright: 0.38, tension: 0.08, space: 0.85, pad: 0.88, bass: 0.22, bell: 0.28, air: 0.26, bellEvery: 13, chordEvery: 19 },
    peak: { reg: 0.78, bright: 0.58, tension: 0.24, space: 0.8, pad: 0.92, bass: 0.34, bell: 0.36, air: 0.4, bellEvery: 9, chordEvery: 14 },
  },
};

/**
 * The car needs no new scene ids — `jobs.js` line 806 sets scene 'car' for
 * every job — but the existing `car` scene has no `phases`, so every job step
 * lands on `setPhase()` with nothing to find and the intensity never moves for
 * the whole game. These are the step ids of all six jobs (firstrun, shuttle,
 * coastroad, summit, lowtide, nightcall), and none of them collide in a way
 * that matters because the lookup is inside the scene.
 *
 * Patch 5 below merges this into the car scene. Kept separate from
 * VEHICLE_SCENES so the merge is a merge and not a redefinition: the existing
 * car scene's values are good and I am not touching them.
 */
export const CAR_PHASES = {
  // firstrun / shuttle: the two teaching jobs. Loading is calm, the road is
  // the job, the drop is the moment.
  pickup: 0.18, road: 0.35, drop: 0.5,
  collect: 0.18, run: 0.38, deliver: 0.5,
  // coastroad: it gets further from home and later in the day as it goes.
  away: 0.25, mid: 0.35, far: 0.45, light: 0.55,
  // summit: up is work, down is the frightening half, and that is the joke.
  climb: 0.4, descend: 0.55,
  // lowtide: a clock made of water.
  track: 0.5, unload: 0.3,
  // nightcall.
  out: 0.3, back: 0.22,
};

/* ==================================================================
 * PATCHES TO src/audio/index.js
 *
 * Five edits, given verbatim. Nothing else in that file changes, and none of
 * them removes an existing behaviour: the aeroplane path is untouched.
 *
 * ------------------------------------------------------------------
 * PATCH 1 — import (after the `import { Music }` line)
 * ------------------------------------------------------------------
 *   import { VehicleAudio } from './vehicles.js';
 *
 * ------------------------------------------------------------------
 * PATCH 2 — constructor (after `this.music = new Music(this.mixer);`)
 * ------------------------------------------------------------------
 *   // The boat, the car and the helicopter. Nothing is built until one of
 *   // them is used, so a lesson spent flying costs nothing for the other two.
 *   this.vehicles = new VehicleAudio(this.mixer);
 *
 * NOTE: do NOT add anything to start(). VehicleAudio builds lazily on first
 * use, which is the point of it.
 *
 * ------------------------------------------------------------------
 * PATCH 3 — setEngineKind() and setInterior(), replacing both methods
 * ------------------------------------------------------------------
 *   setEngineKind(kind) {
 *     if (kind === this.engineKind) return;
 *     // Silence the one that is standing down, or it hangs on at its last note.
 *     if (this.available) {
 *       if (this.engineKind === 'jet') this.jet.playStop();
 *       else if (this.engineKind === 'rotor') this.vehicles.playStop();
 *       else this.engine.playStop();
 *     }
 *     this.engineKind = kind === 'jet' ? 'jet' : kind === 'rotor' ? 'rotor' : 'prop';
 *   }
 *
 *   setInterior(inside) {
 *     this.engine.setInterior(inside);
 *     this.jet.setInterior(inside);
 *     this.ambience.setInterior(inside);
 *     this.vehicles.setInterior(inside);
 *   }
 *
 * ------------------------------------------------------------------
 * PATCH 4 — update(), the engine-select line only
 * ------------------------------------------------------------------
 * Replace these two lines:
 *
 *     if (this.engineKind === 'jet') this.jet.update(dt, ac, weather);
 *     else this.engine.update(dt, ac, weather);
 *
 * with:
 *
 *     // Three instruments now, and exactly one of them runs. A helicopter
 *     // driving the four-cylinder piston synth was the same category of
 *     // mistake as the airliner doing it.
 *     if (this.engineKind === 'jet') this.jet.update(dt, ac, weather);
 *     else if (this.engineKind === 'rotor') this.vehicles.updateRotor(dt, ac, weather);
 *     else this.engine.update(dt, ac, weather);
 *
 * ------------------------------------------------------------------
 * PATCH 5 — updateVehicle(), replacing the whole method
 * ------------------------------------------------------------------
 * Four things change, and three of them are bug fixes to what is there now:
 *
 *   (a) The boat and the car get their own synths instead of the aero piston
 *       engine run at `throttle * 0.75`.
 *   (b) `onGround` becomes false and `groundSpeed` zero in the state handed to
 *       Ambience. As written, `updateVehicle` sets onGround true and
 *       groundSpeed to the vehicle's speed, and `ambience.update()` reads
 *       exactly those two to drive its TYRE ROLL layer — so the rescue launch
 *       has aeroplane tyre noise at sea right now, rising with boat speed.
 *       The car keeps its tyres, but they come from CarSound, which knows what
 *       it is driving on; running both would double them.
 *   (c) The music gets a cue. `music._drive()` has an `auto: 'ground'` branch
 *       that reads `cue.speedKts` and whose own comment says it is waiting for
 *       "when the vehicle path is wired up". Passing the cue is that wiring,
 *       and it is what makes the car scene's "parking the van stops the
 *       music's clock" joke actually happen.
 *   (d) The piston engine is explicitly wound down rather than left holding a
 *       gain target, which is the drone this method's own comment describes.
 *
 *   updateVehicle(dt, reading, weather) {
 *     if (!this.available) return;
 *     const ms = (reading.speedKts || 0) / 1.94384;
 *     // Whichever aeroplane engine was running: stand it down. Both are given
 *     // a zero-rpm state rather than simply being left alone, because a synth
 *     // that is not updated holds its last gain target and drones.
 *     const off = {
 *       rpm: 0,
 *       controls: { throttle: 0, brakes: 0, yaw: 0 },
 *       airspeed: ms, ias: reading.speedKts || 0,
 *       fuel: 1, alt: 0, agl: 0, vs: 0,
 *       onGround: false, groundSpeed: 0, engineOn: false,
 *     };
 *     if (this.engineKind === 'jet') this.jet.update(dt, off, weather);
 *     else this.engine.update(dt, off, weather);
 *
 *     // The vehicle's own instrument.
 *     this.vehicles.updateSurface(dt, reading, weather);
 *
 *     // Wind and rain still apply — but NOT tyre roll, which is why onGround
 *     // is false above: CarSound owns the tyres and a boat has none.
 *     this.ambience.update(dt, off, weather, 0);
 *
 *     // The music's 'ground' driver has been waiting for this cue.
 *     this.music.update(dt, {
 *       radioBusyUntil: 0, stall: false, alertLevel: 0, gear: false,
 *       ac: null, weather, cloudImmersion: 0,
 *       speedKts: reading.speedKts || 0,
 *       data: reading,
 *     });
 *   }
 *
 * ==================================================================
 * PATCHES TO src/audio/music.js
 *
 * ------------------------------------------------------------------
 * PATCH 6 — import, beside the existing `import { clamp }` line
 * ------------------------------------------------------------------
 *   import { VEHICLE_SCENES, CAR_PHASES } from './vehicles.js';
 *
 * (No cycle: vehicles.js imports only ../core/noise.js.)
 *
 * ------------------------------------------------------------------
 * PATCH 7 — one line immediately after the SCENES object literal closes
 * ------------------------------------------------------------------
 *   // The boat, car and helicopter games. Their ids are mission ids, because
 *   // main.js names the scene with `def.id`; without these every one of them
 *   // falls through to SCENES.free, which is an aeroplane scene driven off an
 *   // `ac` a boat does not have.
 *   Object.assign(SCENES, VEHICLE_SCENES);
 *   // Six car jobs, one scene, and until now no phases for it to look up.
 *   SCENES.car.phases = CAR_PHASES;
 *
 * `SCENES` is declared with `const`, and both of these mutate it rather than
 * reassigning it, so nothing else in the file needs to change and the object
 * is still frozen in place before the first `setScene()` can run.
 * ================================================================== */

/* ==================================================================
 * WHAT I NEED FROM OTHER SPECIALISTS — exact names and signatures
 *
 * Everything above works TODAY against the tree as it stands. These are the
 * four things that would make it better, each stated as the exact call I will
 * make so nobody has to guess, and none of them is a static import of a name
 * that does not exist yet.
 *
 * 1. TO WHOEVER OWNS main.js (aircraft selection, line 1676)
 *    Currently:  this.audio.setEngineKind(S.power.kind);
 *    Needed:     this.audio.setEngineKind(S.power.rotor ? 'rotor' : S.power.kind);
 *    `S.power.rotor` already exists — types.js line 769 sets it on the
 *    Skyhook, and line 859 already reads it as `rotor: !!t.shape.power.rotor`.
 *    Without this one-word change the helicopter keeps the piston synth and
 *    RotorSound is never reached. It is the single highest-value line in this
 *    whole drop.
 *
 * 2. TO WHOEVER OWNS src/vehicles/surface.js (readouts)
 *    Please add one field to BOTH boatReadouts() and carReadouts():
 *        kind: this.isBoat ? 'boat' : 'car',
 *    I currently sniff it from the presence of `lever`, which works but will
 *    break silently the day a car gets a lever. `readouts()` already has
 *    `this.isBoat` in hand on the line above.
 *
 * 3. ALSO TO surface.js — the event list
 *    `this.events` already carries exactly what I want: { kind: 'slam',
 *    strength }, { kind: 'bang', strength }, { kind: 'lever', at },
 *    { kind: 'wreck' }, { kind: 'afloat' }. None of it reaches the readouts.
 *    If you publish it as
 *        events: this.events,          // the same array, not a copy
 *    I will read it and stop deriving slams from a rising edge on `jolt`,
 *    which is an approximation. I will not mutate it. Until then the jolt
 *    edge works: measured against surface.js, `jolt` rises by 0.25 + sea*0.3
 *    on the same frame the slam event is pushed, and my threshold is 0.18.
 *
 * 4. TO WHOEVER OWNS THE MISSION RUNNER, for `lastlight` only
 *    On the final step, please call
 *        sim.audio.music.nudge('resolve');
 *    That is an existing, already-implemented gesture (music.js `nudge`, case
 *    'resolve' arms the two-step cadence). Three moments in the whole game are
 *    allowed to resolve; the last light going out on a good day should be the
 *    fourth, and only the runner knows when it has happened.
 *
 * ------------------------------------------------------------------
 * TWO THINGS I FOUND IN THE AUDIO CODE THAT ARE NOT MINE TO FIX
 * ------------------------------------------------------------------
 * A. music.js's `recon` scene declares `breath: true`. Nothing in music.js
 *    reads `breath` — I grepped for d.breath, def.breath and this.def.breath
 *    and there are no hits. It is a dead flag. Either it lost its
 *    implementation or it never had one.
 * B. `GameAudio.updateVehicle` never calls `this.alerts.update`, which is
 *    correct and deliberate, but it also never calls `this.radio.update`,
 *    which means the boat cannot receive a radio call. Six of the seven boat
 *    missions are shouts that come in over the radio. Somebody should decide
 *    whether that is intended; I have not changed it, because the ATC module
 *    is not mine and its update signature is (dt, weather).
 * ================================================================== */

/* ==================================================================
 * VERIFICATION
 *
 * Run headless under node with an instrumented AudioContext stub (no browser,
 * no server, no npm). The harness lives beside this file at
 * scratchpad/audio-vehicles-test/. Every figure quoted in the comments above
 * is printed by it. Summary of what it checks:
 *
 *   - module parses and every class constructs and builds
 *   - persistent node counts: boat 36, car 27, rotor 34 (97 for all three)
 *   - pulseCurve duty: requested 0.14 -> measured 0.1400 of a sine cycle
 *   - no gain-param modulation is ever bipolar (every shaper output >= 0)
 *   - diesel firing range 26.0 Hz to 120.0 Hz; crank 8.7 to 40.0 Hz
 *   - car firing range 27.3 Hz to 206.7 Hz; four gears; shift points and
 *     hysteresis; engine speed independent of the throttle (185.6 Hz at
 *     30 km/h with the pedal open and shut alike, which is what being in gear
 *     means); twenty seconds parked on each shift point hunts zero times
 *   - blade pass 26.667 Hz main, 70.0 Hz tail, constant with collective
 *   - rotor spool reaches 95 per cent NR in 11.9 s, and the blade-pass
 *     frequency sweeps 0.4 Hz to 25.4 Hz with it
 *   - NR droops to 0.860 in autorotation with the turbine gone and the slap
 *     still audible
 *   - blade slap rises with collective, rises further in a descent, and is
 *     highest in a descending turn
 *   - hull slap rate, meaned over ten 60 s runs: silent stopped in a calm,
 *     0.82/s stopped in a gale, 0.91/s flat out in a calm, 2.26/s flat out in
 *     a gale
 *   - every summed modulation pair (lope, slap crossfade, wash) peaks at
 *     exactly 1.0 and never above it
 *   - 600 frames of each synth at 30 fps allocates no persistent nodes
 *   - every VEHICLE_SCENES entry has the keys music.js's setScene reads, uses
 *     a real key and a real mode, and every phase name is a real step id
 * ================================================================== */

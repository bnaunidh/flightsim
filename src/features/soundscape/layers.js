/**
 * The soundscape: what the first-load synths (src/audio) leave out, added on
 * top of them after the menu. All synthesised: no files, nothing to fetch.
 *
 *   ENGINES   piston: the propeller tips' rasp at take-off power, beating at
 *             the blade rate, and the exhaust's bark at the firing rate, with
 *             a few pops when the throttle comes off at high rpm.
 *             turboprop: the gas generator's howl on its own lagging spool
 *             (Ng), and a twin's two propellers drifting in and out of step.
 *             turbofan: the core (N2) on its own spool, leading the fan (N1)
 *             as a real one does; the low roar of the exhaust mixing with the
 *             air, and its crackle behind a big engine at full power.
 *   WHERE     outside, each part is loudest where it really radiates: a fan's
 *             whine ahead, the roar behind, a propeller abeam. The ground's
 *             echo combs the sound as an aeroplane goes over (the fly-by
 *             "phasing"), and a reverb answers it, more of it far off.
 *   AIR       the airframe's low rumble with dynamic pressure, more in a
 *             sideslip or at a high angle of attack, gusting with turbulence.
 *   GROUND    tyres squealing when they scrub sideways, brakes groaning in the
 *             last of the roll; a touchdown's strut thump and spin-up scrub.
 *   WEATHER   raindrops and hailstones as single hits on the airframe (the
 *             first-load rain is a hiss), and thunder that rolls.
 *   COCKPIT   the avionics: an airliner's 400 Hz power and its cooling fans, a
 *             light aircraft's gyros spinning up; trim-wheel ticks.
 *   OTHERS    the nearest other aircraft, by type, with distance and doppler;
 *             the town's traffic as a bed of tyre roar.
 *
 * Every loop is a gain stage driven each frame, and every group is off the
 * graph while it is silent (an unconnected node is not computed). Nothing is
 * built while the game is muted, which is how it starts.
 */

import { pulseCurve } from '../../audio/vehicles.js';
import { FAMILIES, partials } from '../../audio/profile.js';
import { atDistance, doppler } from '../flight-sound.js';
import { clamp, lerp, aspectGains, groundEcho, reverbSend, clickGain, CLICK_T, rainRate, hailLevel, touchdownExtra, spool } from './maths.js';

const JETS = new Set(['regional', 'narrow', 'wide', 'fighter', 'turbojet', 'highbypass']);

/** The click shaper's curve: only the top (1 - CLICK_T) of the input gets through, rescaled to full. */
function clickCurve(n = 16385) {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const a = Math.abs(x);
    c[i] = a > CLICK_T ? Math.sign(x) * ((a - CLICK_T) / (1 - CLICK_T)) : 0;
  }
  return c;
}

/** Six comb delays (s), no two in step, so the tail is a wash and not one note ringing. */
export const COMBS = [0.0297, 0.0371, 0.0411, 0.0437, 0.0533, 0.0611];

/**
 * The outdoor reverb: a short pre-delay, then six feedback combs, each with a
 * lowpass inside its loop, so every pass round loses top end the way a long
 * path through the air does. `rt` is the time to fall 60 dB. Two dozen small
 * nodes, cheaper than a convolver and the same on every browser.
 */
export function combReverb(ctx, rt = 1.6) {
  const input = ctx.createGain();
  const output = ctx.createGain();
  output.gain.value = 0.2;
  // Nothing under 150 Hz goes in: the combs pile up their lows, and the open air gives little of them back.
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 150;
  hp.Q.value = 0.6;
  const pre = ctx.createDelay(0.1);
  pre.delayTime.value = 0.018;
  input.connect(hp);
  hp.connect(pre);
  for (const d of COMBS) {
    const dl = ctx.createDelay(0.1);
    dl.delayTime.value = d;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3600;
    lp.Q.value = 0.5;
    const fb = ctx.createGain();
    fb.gain.value = 10 ** ((-3 * d) / rt);
    pre.connect(dl);
    dl.connect(lp);
    lp.connect(fb);
    fb.connect(dl);
    lp.connect(output);
  }
  return { input, output };
}

export class Soundscape {
  /** `audio` is the game's GameAudio. `lite`: no reverb, echo or other traffic (Low, the iPads). */
  constructor(audio, { lite = false } = {}) {
    this.audio = audio;
    this.mixer = audio.mixer;
    this.lite = lite;
    this.built = false;
    this.parked = true;
    this.ng = 0;
    this.n2 = 0;
    this.gyro = 0;
    this.throttleWas = 0;
    this.burble = 0;
    this.chopT = 0;
    this.wander = 0.4;
    this.shaft = 0;
    this.t = 0;
    this.lastAc = null;
    this.on = {};
    this.wrapped = null;
    /** What each param was last driven to: the numbers a check reads (a suspended clock never moves .value). */
    this.tg = new WeakMap();
  }

  /* ---------------- graph ---------------- */

  build() {
    const m = this.mixer;
    if (this.built || !m.ctx) return this.built;
    const ctx = (this.ctx = m.ctx);
    const gain = (v = 0, into = null) => {
      const g = ctx.createGain();
      g.gain.value = v;
      if (into) g.connect(into);
      return g;
    };
    const filt = (type, f, q = 0.7, into = null) => {
      const b = ctx.createBiquadFilter();
      b.type = type;
      b.frequency.value = f;
      b.Q.value = q;
      if (into) b.connect(into);
      return b;
    };
    const osc = (f, wave = 'sine') => {
      const o = ctx.createOscillator();
      if (typeof wave === 'string') o.type = wave;
      else o.setPeriodicWave(wave);
      o.frequency.value = f;
      o.start();
      return o;
    };
    /** A unipolar pulse train at `f` driving `param` (a gain's): the chopper of vehicles.js. */
    const chopper = (param, duty, shape) => {
      const o = osc(20);
      const s = ctx.createWaveShaper();
      s.curve = pulseCurve(duty, shape);
      o.connect(s);
      s.connect(param);
      return o;
    };
    const clicks = () => {
      const src = m.noiseSource(false);
      // At the threshold itself nothing gets through: the rest point, so a shower starts at once (from 0 it took 2 s to climb there).
      const pre = gain(CLICK_T);
      const s = ctx.createWaveShaper();
      s.curve = this._clickCurve || (this._clickCurve = clickCurve());
      src.connect(pre);
      pre.connect(s);
      return { pre, out: s };
    };
    this._gain = gain;
    this._filt = filt;

    /* ---- outputs, one per bus, plus the listener's space ---- */
    this.engOut = gain(0);
    this.engLp = filt('lowpass', 9000, 0.5);
    this.engMix = gain(1);
    this.engMix.connect(this.engLp);
    this.engLp.connect(this.engOut);
    this.envOut = gain(1);
    this.cabOut = gain(1, this.envOut);
    // The space: what the engines feed in (tap), the reverb (send) and the ground's echo.
    this.tap = gain(1);
    this.send = gain(0);
    this.echo = ctx.createDelay(0.1);
    this.echo.delayTime.value = 0.004;
    this.echoGain = gain(0);
    this.echo.connect(this.echoGain);
    if (!this.lite) {
      const rv = combReverb(ctx);
      this.verb = rv.input;
      this.verbOut = gain(1);
      this.send.connect(this.verb);
      rv.output.connect(this.verbOut);
    }
    this.engOut.connect(this.tap);

    /* ---- piston ---- */
    const P = (this.piston = { out: gain(1) });
    P.tipSrc = m.noiseSource(false);
    P.tipBand = filt('bandpass', 1600, 0.9);
    P.tipChop = gain(0);
    P.tipGain = gain(0, P.out);
    P.tipSrc.connect(P.tipBand);
    P.tipBand.connect(P.tipChop);
    P.tipChop.connect(P.tipGain);
    P.tipRate = chopper(P.tipChop.gain, 0.2, 1.8);
    P.barkSrc = m.noiseSource(false);
    P.barkBand = filt('bandpass', 620, 0.8);
    P.barkChop = gain(0);
    P.barkGain = gain(0, P.out);
    P.barkSrc.connect(P.barkBand);
    P.barkBand.connect(P.barkChop);
    P.barkChop.connect(P.barkGain);
    P.barkRate = chopper(P.barkChop.gain, 0.3, 1.3);

    /* ---- turboprop ---- */
    const T = (this.turbo = { out: gain(1) });
    T.howlA = osc(1200);
    T.howlB = osc(4400);
    T.howlAGain = gain(0, T.out);
    T.howlBGain = gain(0, T.out);
    T.howlA.connect(T.howlAGain);
    T.howlB.connect(T.howlBGain);
    T.blade = osc(100, partials(ctx, 8, (h) => 0.75 ** h));
    T.beatStage = gain(0.6);
    T.beatGain = gain(0, T.out);
    T.blade.connect(T.beatStage);
    T.beatStage.connect(T.beatGain);
    T.lfo = osc(0.4);
    T.lfoDepth = gain(0.4);
    T.lfo.connect(T.lfoDepth);
    T.lfoDepth.connect(T.beatStage.gain);

    /* ---- turbofan ---- */
    const J = (this.jet = { out: gain(1) });
    J.coreA = osc(4000);
    J.coreB = osc(8000);
    J.coreGain = gain(0, J.out);
    J.coreBGain = gain(0.35, J.coreGain);
    J.coreA.connect(J.coreGain);
    J.coreB.connect(J.coreBGain);
    J.rumbleSrc = m.noiseSource(true);
    J.rumbleLp = filt('lowpass', 150, 0.6);
    J.rumbleGain = gain(0, J.out);
    J.rumbleSrc.connect(J.rumbleLp);
    J.rumbleLp.connect(J.rumbleGain);
    const jc = clicks();
    J.crackPre = jc.pre;
    J.crackBand = filt('bandpass', 1900, 0.7);
    J.crackGain = gain(0);
    jc.out.connect(J.crackBand);
    J.crackBand.connect(J.crackGain);

    /* ---- the air on the airframe ---- */
    const A = (this.air = {});
    A.src = m.noiseSource(true);
    A.lp = filt('lowpass', 120, 0.7);
    A.gust = gain(1);
    A.gain = gain(0);
    A.src.connect(A.lp);
    A.lp.connect(A.gust);
    A.gust.connect(A.gain);
    A.g1 = osc(0.37);
    A.g2 = osc(0.61);
    A.d1 = gain(0.06);
    A.d2 = gain(0.06);
    A.g1.connect(A.d1);
    A.g2.connect(A.d2);
    A.d1.connect(A.gust.gain);
    A.d2.connect(A.gust.gain);

    /* ---- tyres and brakes ---- */
    const G = (this.ground = { out: gain(1) });
    G.squealSrc = m.noiseSource(false);
    G.squealBand = filt('bandpass', 1150, 4);
    G.squealGain = gain(0, G.out);
    G.squealSrc.connect(G.squealBand);
    G.squealBand.connect(G.squealGain);
    G.groan = osc(105, 'sawtooth');
    G.groanBand = filt('bandpass', 320, 3);
    G.groanGain = gain(0, G.out);
    G.groan.connect(G.groanBand);
    G.groanBand.connect(G.groanGain);

    /* ---- rain and hail, hit by hit ---- */
    const W = (this.wet = { out: gain(1) });
    const rc = clicks();
    W.rainPre = rc.pre;
    W.rainNorm = gain(0);
    rc.out.connect(W.rainNorm);
    W.rainHi = filt('bandpass', 3300, 1.1);
    W.rainHiGain = gain(0, W.out);
    W.rainLo = filt('lowpass', 380, 0.7);
    W.rainLoGain = gain(0, W.out);
    W.rainNorm.connect(W.rainHi);
    W.rainNorm.connect(W.rainLo);
    W.rainHi.connect(W.rainHiGain);
    W.rainLo.connect(W.rainLoGain);
    const hc = clicks();
    W.hailPre = hc.pre;
    W.hailNorm = gain(0);
    hc.out.connect(W.hailNorm);
    W.hailBand = filt('bandpass', 1500, 1.6);
    W.hailBody = filt('lowpass', 650, 0.9);
    W.hailGain = gain(0, W.out);
    W.hailNorm.connect(W.hailBand);
    W.hailNorm.connect(W.hailBody);
    W.hailBand.connect(W.hailGain);
    W.hailBody.connect(W.hailGain);

    /* ---- the cockpit's own sounds ---- */
    const K = (this.cab = { out: gain(1) });
    K.hum = osc(400, partials(ctx, 6, (h) => [0, 1, 0.45, 0.32, 0.1, 0.14, 0.05][h]));
    K.humGain = gain(0, K.out);
    K.hum.connect(K.humGain);
    K.gyro = osc(10);
    K.gyroGain = gain(0, K.out);
    K.gyro.connect(K.gyroGain);
    K.fanSrc = m.noiseSource(true);
    K.fanBand = filt('bandpass', 1150, 0.6);
    K.fanGain = gain(0, K.out);
    K.fanSrc.connect(K.fanBand);
    K.fanBand.connect(K.fanGain);

    /* ---- other aircraft, and the town ---- */
    this.voices = [];
    if (!this.lite) {
      const waves = {
        jet: partials(ctx, 6, (h) => 0.6 ** h),
        prop: partials(ctx, 24, (h) => 1 / h ** 0.9),
        rotor: partials(ctx, 30, (h) => 1 / h ** 0.7),
      };
      this.waves = waves;
      for (let i = 0; i < 2; i++) {
        const v = { key: null, kind: null };
        v.tone = osc(100, waves.prop);
        v.toneGain = gain(0);
        v.src = m.noiseSource(true);
        v.band = filt('bandpass', 500, 0.6);
        v.chop = gain(1);
        v.noiseGain = gain(0);
        v.lp = filt('lowpass', 4000, 0.5);
        v.out = gain(0);
        v.tone.connect(v.toneGain);
        v.toneGain.connect(v.lp);
        v.src.connect(v.band);
        v.band.connect(v.chop);
        v.chop.connect(v.noiseGain);
        v.noiseGain.connect(v.lp);
        v.lp.connect(v.out);
        v.slap = osc(19);
        v.slapShape = ctx.createWaveShaper();
        v.slapShape.curve = pulseCurve(0.16, 1.8);
        v.slap.connect(v.slapShape);
        this.voices.push(v);
      }
      const R = (this.road = { out: gain(1) });
      R.src = m.noiseSource(true);
      R.band = filt('bandpass', 600, 0.6);
      R.roar = gain(0, R.out);
      R.src.connect(R.band);
      R.band.connect(R.roar);
      R.hum = osc(62, 'sawtooth');
      R.humLp = filt('lowpass', 180, 0.7);
      R.humGain = gain(0, R.out);
      R.hum.connect(R.humLp);
      R.humLp.connect(R.humGain);
    }

    this.built = true;
    this.parked = true;
    this.unpark();
    this.retap();
    this._surgery();
    return true;
  }

  /**
   * Each part of the first-load engines through a stage of its own, so the
   * aspect can weigh it: the fan's tones ahead, the roar behind, the
   * propeller abeam. The stages sit at 1 until the listener is off the aeroplane.
   */
  _surgery() {
    const a = this.audio;
    const route = (nodes, stage, out) => {
      for (const n of nodes) {
        if (!n) continue;
        try {
          n.disconnect(out);
        } catch (e) {
          /* not connected there: leave it */
          continue;
        }
        n.connect(stage);
      }
      stage.connect(out);
    };
    const j = a.jet;
    if (j && j.built && !this.jetFront) {
      this.jetFront = this._gain(1);
      this.jetRear = this._gain(1);
      route([j.fanGain, j.n2Gain, j.buzzGain], this.jetFront, j.out);
      route([j.exGain, j.coreGain], this.jetRear, j.out);
    }
    const e = a.engine;
    if (e && e.built && !this.propDisc) {
      this.propDisc = this._gain(1);
      route([e.bladeGain, e.blade2Gain, e.propGain], this.propDisc, e.out);
    }
  }

  /** The first-load engines feed the space too (their plug() unplugs everything, so after every plug). */
  retap() {
    if (!this.built) return;
    for (const s of [this.audio.engine, this.audio.jet]) {
      if (!s || !s.built || !s.tone) continue;
      if (s.plugged && !this.parked) {
        try {
          s.tone.connect(this.tap);
        } catch (e) {
          /* a context that has gone away */
        }
      }
    }
  }

  /** Off the graph entirely: muted. Only the outputs come off; each group keeps its own state. */
  park() {
    if (!this.built || this.parked) return;
    this.parked = true;
    const off = (n, bus) => {
      try {
        if (n) n.disconnect(this.mixer.bus(bus));
      } catch (e) {
        /* was not connected */
      }
    };
    off(this.engOut, 'engine');
    off(this.echoGain, 'engine');
    off(this.envOut, 'environment');
    off(this.verbOut, 'environment');
    for (const s of [this.audio.engine, this.audio.jet]) {
      if (s && s.built && s.tone) {
        try {
          s.tone.disconnect(this.tap);
        } catch (e) {
          /* was not tapped */
        }
      }
    }
  }

  unpark() {
    if (!this.built || !this.parked) return;
    this.parked = false;
    this.engOut.connect(this.mixer.bus('engine'));
    this.envOut.connect(this.mixer.bus('environment'));
    if (this.verbOut) this.verbOut.connect(this.mixer.bus('environment'));
    this.echoGain.connect(this.mixer.bus('engine'));
    this.retap();
  }

  /**
   * A group that has gone quiet stays on the graph a second longer (its last
   * glide down to silence), then comes off; true while it is on. Decided by
   * time, not by reading the gain: a suspended clock never moves .value.
   */
  _live(name, node, into, want, dt) {
    const r = (this.rel || (this.rel = {}));
    r[name] = want ? 1 : Math.max(0, (r[name] || 0) - dt);
    this._plug(name, node, into, r[name] > 0);
    return !!this.on[name];
  }

  /** A group's output on or off `into`, by whether it has anything to play. Only that one connection. */
  _plug(name, node, into, want) {
    if (!!this.on[name] === !!want) return;
    this.on[name] = !!want;
    if (want) node.connect(into);
    else node.disconnect(into);
  }

  /** Everything to nothing inside a quarter of a second: the menus (GameAudio.hush). */
  silence() {
    // Once: GameAudio.hush runs every frame of a menu, and a ramp restarted every frame never arrives.
    if (!this.built || this.quiet) return;
    const t = this.ctx.currentTime;
    for (const g of [this.engOut, this.envOut, this.cabOut, this.send, this.echoGain]) {
      this.tg.set(g.gain, 0);
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(Math.max(0, g.gain.value), t);
        g.gain.linearRampToValueAtTime(0, t + 0.25);
      } catch (e) {
        g.gain.value = 0;
      }
    }
    this.quiet = true;
  }

  reset() {
    this.ng = 0;
    this.n2 = 0;
    this.gyro = 0;
    this.burble = 0;
    this.throttleWas = 0;
    for (const v of this.voices || []) v.key = null;
  }

  /* ---------------- every frame ---------------- */

  /**
   * `s` is where things are this frame (features/soundscape.js listen):
   *   ac       the flight's frame, or null (driving, walking: no aeroplane engine)
   *   weather, cloud     the weather and the cloud immersion
   *   inside, near       the cockpit view; the camera on the aeroplane (< NEAR)
   *   dist, cos          metres to the aeroplane; aspectCos round it
   *   earAgl, acAgl, horiz, surface    for the ground's echo
   *   voices   [{ key, kind, d, rate }] the other aircraft to voice, nearest first
   *   cars     { weight } the town's traffic round the ear;  snow: a snow map
   */
  update(dt, s) {
    if (!this.built || this.parked) return;
    s.dt = dt;
    const t = this.ctx.currentTime;
    this.t += dt;
    const set = (p, v, tau = 0.15) => {
      p.setTargetAtTime(v, t, tau);
      this.tg.set(p, v);
    };
    if (this.quiet) {
      this.quiet = false;
      for (const g of [this.envOut, this.cabOut]) {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        set(g.gain, 1, 0.1);
      }
      this.engOut.gain.cancelScheduledValues(t);
      this.engOut.gain.setValueAtTime(this.engOut.gain.value, t);
    }
    const a = this.audio;
    const v = this.mixer.view;
    const ac = s.ac;
    this.lastAc = ac;
    const inside = !!s.inside;
    const asp = aspectGains(s.cos || 0, inside || s.near);
    const fam = ac ? a.family || 'piston' : null;
    const F = (fam && FAMILIES[fam]) || FAMILIES.piston;
    const kind = !ac || fam === 'rotor' ? null : F.prop ? (F.turbo ? 'turbo' : 'piston') : JETS.has(fam) ? 'jet' : null;
    const rpm = ac ? ac.rpm || 0 : 0;
    const running = rpm > 0.04;
    const thr = ac && ac.controls ? ac.controls.throttle || 0 : 0;
    const ias = ac ? (Number.isFinite(ac.ias) ? ac.ias : ac.airspeed || 0) : 0;

    /* ---- the engine bus: level, distance, cockpit ---- */
    const engLevel = kind ? v.gain * v.synth * (inside ? F.inside : 1) : 0;
    set(this.engOut.gain, engLevel, 0.2);
    set(this.engLp.frequency, Math.min(v.cut, inside ? 1500 : 9000), 0.25);
    this._plug('piston', this.piston.out, this.engMix, kind === 'piston');
    this._plug('turbo', this.turbo.out, this.engMix, kind === 'turbo');
    this._plug('jet', this.jet.out, this.engMix, kind === 'jet');

    if (this.jetFront) {
      set(this.jetFront.gain, asp.front, 0.2);
      set(this.jetRear.gain, asp.rear, 0.2);
    }
    if (this.propDisc) set(this.propDisc.gain, asp.disc, 0.2);

    if (kind === 'piston' || kind === 'turbo') {
      // The same propeller speed engine.js works out.
      const n = F.turbo ? clamp(rpm / 0.45, 0, 1) : rpm;
      const sf = clamp((ac.airspeed || 0) / 70, 0, 1);
      const rpmAbs = (n <= 0.18 ? (n / 0.18) * F.idleRpm : lerp(F.idleRpm, F.maxRpm, (n - 0.18) / 0.82)) * (1 + sf * 0.04);
      const bladeHz = Math.max(2, (rpmAbs / 60) * F.blades) * v.pitch;
      const on = running ? 1 : 0;
      if (kind === 'piston') {
        const P = this.piston;
        const tip = (rpmAbs / F.maxRpm) ** 6 * (0.4 + 0.6 * thr);
        set(P.tipRate.frequency, bladeHz, 0.09);
        set(P.tipGain.gain, on * tip * 2.0 * (inside ? 0.08 : asp.disc), 0.12);
        set(P.tipBand.frequency, 1300 + tip * 900, 0.2);
        set(P.barkRate.frequency, Math.max(1, (rpmAbs / 60) * 2 * v.pitch), 0.09);
        set(P.barkGain.gain, on * (0.08 + 0.48 * clamp(rpm * 0.75 + thr * 0.25, 0, 1)) * (inside ? 0.25 : asp.rear), 0.12);
        // Throttle chopped at high rpm: a few pops from the exhaust as the mixture goes rich.
        this.chopT += dt;
        if (this.chopT > 0.35) {
          if (this.throttleWas - thr > 0.3 && rpm > 0.45) this.burble = 1.1;
          this.throttleWas = thr;
          this.chopT = 0;
        }
        if (this.burble > 0) {
          this.burble -= dt;
          if (running && Math.random() < dt * 9) {
            this.burst({ bus: 'engine', freq: 380 + Math.random() * 300, q: 1, type: 'lowpass', dur: 0.04 + Math.random() * 0.05, gain: (0.18 + Math.random() * 0.2) * v.gain * (inside ? 0.35 : asp.rear) });
          }
        }
      } else {
        const T = this.turbo;
        const target = running ? 0.55 + 0.45 * clamp((rpm - 0.18) / 0.82, 0, 1) : 0;
        this.ng = spool(this.ng, target, 0.45, 0.32, dt);
        const ng = this.ng;
        set(T.howlA.frequency, lerp(1100, 2400, ng) * v.pitch, 0.2);
        set(T.howlB.frequency, lerp(4200, 8200, ng) * v.pitch, 0.2);
        // Quiet at ground idle, a howl at take-off power: by the square of how far above idle Ng is.
        const howl = ng > 0.02 ? 0.12 + 0.88 * clamp((ng - 0.55) / 0.45, 0, 1) ** 2 : 0;
        set(T.howlAGain.gain, howl * 0.035 * (inside ? 0.18 : asp.front), 0.2);
        set(T.howlBGain.gain, howl * 0.012 * (inside ? 0.08 : asp.front), 0.2);
        // The synchrophaser never quite holds: the beat between the two wanders.
        this.wander = clamp(this.wander + (Math.random() - 0.5) * dt * 0.3, 0.15, 0.8);
        set(T.lfo.frequency, this.wander, 0.5);
        set(T.blade.frequency, bladeHz, 0.09);
        set(T.beatGain.gain, (a.engine && a.engine.twin ? 1 : 0.4) * on * (0.25 + 0.75 * clamp(thr, 0, 1)) * 0.07 * (inside ? 0.8 : 0.6 * asp.disc), 0.2);
      }
    } else if (kind === 'jet') {
      const J = this.jet;
      const n1 = a.jet ? a.jet.n1 : rpm;
      // The core is lighter than the fan and answers first.
      this.n2 = spool(this.n2, rpm, F.up * 1.8, F.down * 1.25, dt);
      const n2 = this.n2;
      const on = n2 > 0.03 ? 1 : 0;
      set(J.coreA.frequency, F.n2 * (0.55 + 0.45 * n2) * v.pitch, 0.2);
      set(J.coreB.frequency, F.n2 * (0.55 + 0.45 * n2) * 1.5 * v.pitch, 0.2);
      set(J.coreGain.gain, on * (0.3 + 0.7 * n2) * 0.022 * F.whine * (inside ? 0.15 : asp.front), 0.2);
      const blast = clamp(n1, 0, 1) ** 1.7 * F.blast;
      set(J.rumbleGain.gain, on * (0.04 + blast * 0.6) * (inside ? 0.25 : asp.rear), 0.25);
      const crack = inside || s.near ? 0 : clamp((n1 - 0.8) / 0.2, 0, 1) * F.blast;
      this._plug('crack', J.crackGain, J.out, crack > 0.01);
      if (crack > 0.01) {
        const k = clickGain(40 + crack * 60, this.ctx.sampleRate);
        set(J.crackPre.gain, k || CLICK_T, 0.03);
        set(J.crackGain.gain, crack * 0.8 * asp.rear * asp.rear, 0.2);
      }
    }

    /* ---- the space round the ear ---- */
    const outside = !inside;
    const space = outside && kind;
    if (this.verb) {
      const wet = space ? reverbSend(s.dist || 0, false, s.earAgl == null ? 2 : s.earAgl) : 0;
      set(this.send.gain, wet, 0.3);
    }
    const echo = space ? groundEcho(s.horiz || 0, s.acAgl || 0, s.earAgl == null ? 2 : s.earAgl, s.surface) : { delay: 0.004, gain: 0 };
    // Under half a millisecond the echo is the same sound (an aeroplane on the ground): no comb, so none.
    const eg = this.lite ? 0 : echo.gain * (s.near ? 0.35 : 1) * (echo.delay > 0.095 ? 0 : 1) * clamp((echo.delay - 0.0003) / 0.0007, 0, 1);
    if (eg > 0) set(this.echo.delayTime, clamp(echo.delay, 0.0002, 0.095), 0.08);
    set(this.echoGain.gain, eg, 0.1);
    // The tap only while something listens to it.
    this._live('tapVerb', this.tap, this.verb ? this.send : this.echo, !this.lite && !!space, dt);
    this._plug('tapEcho', this.tap, this.echo, !this.lite && eg > 0);

    /* ---- the air ---- */
    const sN = ias / 75;
    const q = Math.min(3, sN < 1.4 ? sN : 1.4 + 0.75 * Math.log(sN / 1.4));
    const slip = Math.abs((ac && ac.beta) || 0);
    const aoa = Math.max(0, ((ac && ac.alpha) || 0) - 0.12);
    const turb = (s.weather && s.weather.cond && s.weather.cond.turb) || 0;
    const air = ac ? q * q * (1 + slip * 4 + aoa * 3) * (inside ? 0.05 : 0.022 * v.gain) : 0;
    if (this._live('air', this.air.gain, this.envOut, air > 0.0005, dt)) {
      set(this.air.gain.gain, air, 0.2);
      set(this.air.lp.frequency, 90 + q * 40, 0.3);
      set(this.air.d1.gain, 0.06 + 0.22 * turb, 0.5);
      set(this.air.d2.gain, 0.04 + 0.16 * turb, 0.5);
    }

    /* ---- tyres and brakes ---- */
    const G = this.ground;
    const gs = ac && ac.onGround ? ac.groundSpeed || 0 : 0;
    const squeal = ac && ac.onGround ? clamp(((ac.sideScrub || 0) - 1.2) / 4, 0, 1) * clamp(gs / 15, 0, 1) : 0;
    const brakes = ac && ac.controls ? ac.controls.brakes || 0 : 0;
    const groan = ac && ac.onGround && gs > 1.5 && gs < 14 && brakes > 0.4 ? brakes * (0.3 + (a.ambience.heavy || 0)) * clamp((14 - gs) / 6, 0, 1) : 0;
    if (this._live('ground', G.out, this.envOut, squeal > 0 || groan > 0, dt)) {
      set(G.squealGain.gain, squeal * 0.16 * v.gain, 0.08);
      set(G.squealBand.frequency, 1050 + squeal * 300, 0.1);
      set(G.groanGain.gain, groan * 0.04 * v.gain * (inside ? 1.3 : 1), 0.15);
      set(G.groan.frequency, 95 + gs * 2.2, 0.2);
    }

    /* ---- rain and hail ---- */
    const W = this.wet;
    const cond = (s.weather && s.weather.cond) || {};
    const rain = s.snow ? 0 : cond.rain || 0;
    const rate = rainRate(rain, ias, inside);
    this.shaft = clamp(0.5 + 0.5 * Math.sin(this.t * 0.11) * Math.sin(this.t * 0.047 + 1.3), 0, 1);
    const hail = hailLevel(cond, this.shaft, s.cloud || 0, !!s.snow);
    this.hail = hail;
    this._live('wet', W.out, this.envOut, rate > 0 || hail > 0, dt);
    if (this.on.wet) {
      const sr = this.ctx.sampleRate;
      const kR = clickGain(rate, sr);
      const kH = clickGain(hail * (inside ? 75 : 45), sr);
      set(W.rainPre.gain, kR || CLICK_T, 0.03);
      set(W.rainNorm.gain, kR > 0 ? 1 / Math.min(1, (kR - CLICK_T) / (1 - CLICK_T)) : 0, 0.2);
      set(W.rainHiGain.gain, rate > 0 ? (inside ? 1.6 : 0.6) * Math.sqrt(rain) : 0, 0.3);
      set(W.rainLoGain.gain, rate > 0 && inside ? 1.8 * rain : 0, 0.3);
      set(W.hailPre.gain, kH || CLICK_T, 0.03);
      set(W.hailNorm.gain, kH > 0 ? 1 / Math.min(1, (kH - CLICK_T) / (1 - CLICK_T)) : 0, 0.3);
      set(W.hailGain.gain, hail * (inside ? 9 : 3.5), 0.4);
    }

    /* ---- the cockpit ---- */
    const K = this.cab;
    const powered = !!(ac && (ac.engineOn || running || ac.starting));
    this.gyro = spool(this.gyro, powered ? 1 : 0, 0.18, 0.05, dt);
    const airliner = kind === 'jet' || kind === 'turbo';
    this._plug('cab', K.out, this.cabOut, inside && (powered || this.gyro > 0.02));
    if (this.on.cab) {
      set(K.humGain.gain, airliner && powered ? 0.014 : 0, 0.2);
      set(K.gyro.frequency, 30 + 1870 * this.gyro, 0.3);
      set(K.gyroGain.gain, !airliner ? 0.0045 * this.gyro : 0, 0.3);
      set(K.fanGain.gain, powered ? (airliner ? 0.022 : 0.009) : 0, 0.3);
    }

    /* ---- the others ---- */
    if (!this.lite) this._others(s, set, inside);
  }

  _others(s, set, inside) {
    const list = s.voices || [];
    for (let i = 0; i < this.voices.length; i++) {
      const v = this.voices[i];
      const b = list[i];
      const want = !!b;
      this._live(`voice${i}`, v.out, this.envOut, want, s.dt || 0.033);
      if (!want) {
        set(v.out.gain, 0, 0.2);
        continue;
      }
      if (b.key !== v.key) {
        // A different aircraft in this voice: start from silence, not from the last one's level.
        v.key = b.key;
        v.out.gain.cancelScheduledValues(this.ctx.currentTime);
        v.out.gain.setValueAtTime(0, this.ctx.currentTime);
      }
      if (b.kind !== v.kind) {
        v.kind = b.kind;
        v.tone.setPeriodicWave(this.waves[b.kind] || this.waves.prop);
        if (b.kind === 'rotor') {
          v.chop.gain.value = 0;
          v.slapShape.connect(v.chop.gain);
        } else {
          try {
            v.slapShape.disconnect();
          } catch (e) {
            /* was not chopping */
          }
          v.chop.gain.value = 1;
        }
      }
      const at = atDistance(b.d);
      const p = doppler(b.rate || 0);
      const k = b.kind;
      set(v.tone.frequency, (k === 'jet' ? 2100 : k === 'rotor' ? 19 : 92) * p, 0.1);
      set(v.slap.frequency, 19 * p, 0.1);
      set(v.band.frequency, (k === 'jet' ? 650 : k === 'rotor' ? 520 : 380) * p, 0.2);
      set(v.toneGain.gain, k === 'jet' ? 0.12 : k === 'rotor' ? 0.35 : 0.45, 0.2);
      set(v.noiseGain.gain, k === 'jet' ? 0.7 : k === 'rotor' ? 0.9 : 0.4, 0.2);
      set(v.lp.frequency, Math.min(at.cut, inside ? 1200 : 20000), 0.2);
      set(v.out.gain, at.gain * (k === 'jet' ? 0.4 : 0.3) * (inside ? 0.35 : 1), 0.15);
    }
    const R = this.road;
    const w = s.cars ? s.cars.weight || 0 : 0;
    this._live('road', R.out, this.envOut, w > 0.001, s.dt || 0.033);
    const lvl = Math.sqrt(clamp(w, 0, 6)) * (inside ? 0.3 : 1);
    set(R.roar.gain, lvl * 0.07, 0.3);
    set(R.humGain.gain, lvl * 0.03, 0.3);
  }

  /* ---------------- one-shots ---------------- */

  /** A noise burst like mixer.noiseBurst, into a bus and (outside) the reverb. Under the same voice cap. */
  burst({ bus = 'environment', freq = 1000, q = 1, type = 'bandpass', dur = 0.2, gain = 0.2, attack = 0.004, when = null, pink = false, sweep = null, verb = true, tail = false } = {}) {
    const m = this.mixer;
    if (!this.built || this.parked || m.frozen || m._shots >= 24 || gain <= 0.0002) return null;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    m._shot(src);
    src.buffer = pink ? m.pinkBuffer() : m.noiseBuffer();
    src.loop = true;
    const f = this._filt(type, freq, q);
    const g = ctx.createGain();
    const t = when == null ? ctx.currentTime : Math.max(when, ctx.currentTime);
    if (sweep) {
      f.frequency.setValueAtTime(freq, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(20, sweep), t + dur);
    }
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gain), t + attack);
    // A rumble swells and dies away slowly (a quarter of its length per e-fold); a click is gone at once.
    if (tail) g.gain.setTargetAtTime(0.0001, t + attack, dur / 4);
    else g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(g);
    g.connect(m.bus(bus));
    if (verb && this.verb && !this.audio.engine.interior) g.connect(this.send);
    src.start(t, Math.random() * src.buffer.duration);
    src.stop(t + dur * (tail ? 1.3 : 1) + 0.05);
    return g;
  }

  /** A struck, falling low note: a thump with weight in it. */
  thud({ bus = 'environment', f0 = 70, f1 = 42, dur = 0.25, gain = 0.2, when = null, wave = 'sine' } = {}) {
    const m = this.mixer;
    if (!this.built || this.parked || m.frozen || m._shots >= 24 || gain <= 0.0002) return null;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    m._shot(o);
    o.type = wave;
    const g = ctx.createGain();
    const t = when == null ? ctx.currentTime : Math.max(when, ctx.currentTime);
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(m.bus(bus));
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  /** A held motor note (gear pump, flap jack): rises to `f1` under load, then stops. */
  motor({ f0, f1, dur, gain, band, q = 2, wave = 'sawtooth', when = null }) {
    const m = this.mixer;
    if (!this.built || this.parked || m.frozen || m._shots >= 24) return null;
    const ctx = this.ctx;
    const t = when == null ? ctx.currentTime : Math.max(when, ctx.currentTime);
    const o = ctx.createOscillator();
    m._shot(o);
    o.type = wave;
    const f = this._filt('bandpass', band, q);
    const g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.linearRampToValueAtTime(f1, t + dur * 0.4);
    o.frequency.setValueAtTime(f1, t + dur * 0.85);
    o.frequency.linearRampToValueAtTime(f1 * 1.04, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.12);
    g.gain.setValueAtTime(gain, t + dur - 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(m.bus('environment'));
    o.start(t);
    o.stop(t + dur + 0.05);
    return g;
  }

  /** On top of the first-load touchdown: the struts' thump and the tyres spinning up. */
  touchdown(impact, surface) {
    const ac = this.lastAc;
    const heavy = this.audio.ambience.heavy || 0;
    const x = touchdownExtra(impact, ac ? ac.groundSpeed || 0 : 40, heavy);
    const far = this.mixer.view.gain;
    this.thud({ f0: 78 - heavy * 22, f1: 40, dur: 0.22 + heavy * 0.15, gain: 0.32 * x.thump * far });
    this.burst({ freq: 170, type: 'lowpass', q: 0.8, dur: 0.12, gain: 0.25 * x.thump * far, pink: true });
    if (surface === 'paved') this.burst({ freq: 1500 - heavy * 300, q: 2.4, dur: 0.25 + heavy * 0.15, gain: 0.2 * x.scrub * far, sweep: 700, when: this.ctx.currentTime + 0.02 });
    return x;
  }

  /** On top of the first-load gear: the pump or the motor's whine, the doors, a lock with weight. */
  gear(down) {
    const heavy = this.audio.ambience.heavy || 0;
    const t = this.ctx.currentTime;
    if (heavy > 0.2) {
      this.motor({ f0: 330, f1: 400, dur: 2.2, gain: 0.03 + heavy * 0.02, band: 800, q: 1.6 });
      this.burst({ freq: 150, type: 'lowpass', dur: 0.3, gain: 0.22 * heavy, when: t + 0.1, pink: true });
      this.burst({ freq: 150, type: 'lowpass', dur: 0.32, gain: 0.26 * heavy, when: t + 2.05, pink: true });
    } else {
      this.motor({ f0: 820, f1: 960, dur: 2.2, gain: 0.012, band: 1800, q: 3 });
    }
    this.thud({ f0: 90 - heavy * 30, f1: 52, dur: 0.18 + heavy * 0.1, gain: 0.16 + heavy * 0.12, when: t + 2.25 });
    for (let i = 0; i < 3; i++) this.burst({ freq: 2600 + i * 400, q: 3, dur: 0.03, gain: 0.05, when: t + 2.27 + i * 0.035, verb: false });
    void down;
  }

  /** On top of the first-load flaps: the screw jacks' whirr, and the detent. */
  flaps() {
    const heavy = this.audio.ambience.heavy || 0;
    const dur = 1.1 + heavy * 1.2;
    this.motor({ f0: lerp(260, 140, heavy), f1: lerp(280, 150, heavy), dur, gain: 0.03, band: lerp(780, 450, heavy), q: 2.5, wave: 'square' });
    this.thud({ f0: 120, f1: 70, dur: 0.12, gain: 0.12, when: this.ctx.currentTime + dur - 0.04 });
  }

  /**
   * Thunder that rolls: a close strike's crack and tearing, the boom under
   * it, then rumbles coming back off the cloud at random over seconds, darker
   * and longer the further off it is. Replaces the first-load thunder.
   */
  thunder(distance = 0.5) {
    const near = 1 - clamp(distance, 0, 1);
    const t = this.ctx.currentTime;
    if (near > 0.55) {
      this.burst({ type: 'highpass', freq: 1800, dur: 0.1, gain: 0.32 * near, attack: 0.002 });
      for (let i = 0; i < 4; i++) this.burst({ freq: 2400 + Math.random() * 2200, q: 2, dur: 0.05 + Math.random() * 0.05, gain: 0.1 * near, when: t + 0.02 + Math.random() * 0.4, verb: false });
    }
    if (near > 0.3) this.thud({ f0: 58, f1: 36, dur: 1.2, gain: 0.3 * near });
    const rolls = 3 + Math.round(3 * (1 - near));
    for (let i = 0; i < rolls; i++) {
      const at = t + (i === 0 ? 0.02 : Math.random() * (0.4 + 3 * (1 - near)));
      const dur = 1.2 + Math.random() * 1.4 + (1 - near) * 1.2;
      this.burst({ type: 'lowpass', freq: 110 + near * 320 + Math.random() * 60, q: 0.7, dur, attack: 0.05 + (1 - near) * 0.35, gain: (0.08 + 0.3 * near) * (0.5 + Math.random() * 0.5), when: at, pink: true, tail: true });
    }
    return rolls;
  }

  /**
   * After the first-load ambience has set its rain (audio/ambience.js
   * update: the same sums, kept in step by the check), turn the hiss down
   * while the drops play: real rain on a windscreen is hits, not a hiss.
   */
  duckRain(amb, ac, weather, snow) {
    if (!amb.rainGain || !this.on.wet) return;
    const rain = snow ? 0 : (weather && weather.cond && weather.cond.rain) || 0;
    if (!(rain > 0.002)) return;
    const v = Number.isFinite(ac.ias) ? ac.ias : ac.airspeed || 0;
    const speed = 1 + clamp(v / 60, 0, 1.2);
    const inside = amb.interior;
    const t = this.ctx.currentTime;
    const hiss = rain * (inside ? 0.16 : 0.3) * speed * 0.8 * (inside ? 0.45 : 0.7);
    const body = (inside ? rain * 0.16 * speed : rain * 0.07) * (inside ? 0.4 : 0.7);
    amb.rainGain.gain.setTargetAtTime(hiss, t, 0.3);
    amb.rainBodyGain.gain.setTargetAtTime(body, t, 0.3);
    this.tg.set(amb.rainGain.gain, hiss);
    this.ducked = { hiss: +hiss.toFixed(4), body: +body.toFixed(4) };
  }

  /** A trim wheel's tick. */
  tick() {
    this.burst({ freq: 3200, q: 2, dur: 0.016, gain: 0.13, bus: 'alerts', attack: 0.001, verb: false });
  }

  /** Every level that matters, as numbers, for the checks (null until built). */
  levels() {
    if (!this.built) return null;
    const g = (n) => (n && n.gain ? +(this.tg.has(n.gain) ? this.tg.get(n.gain) : n.gain.value).toFixed(5) : 0);
    return {
      parked: this.parked,
      engOut: g(this.engOut),
      tip: g(this.piston.tipGain),
      bark: g(this.piston.barkGain),
      howl: g(this.turbo.howlAGain),
      beat: g(this.turbo.beatGain),
      core: g(this.jet.coreGain),
      rumble: g(this.jet.rumbleGain),
      crackle: g(this.jet.crackGain),
      front: g(this.jetFront),
      rear: g(this.jetRear),
      disc: g(this.propDisc),
      send: g(this.send),
      echo: g(this.echoGain),
      echoDelay: +(this.tg.has(this.echo.delayTime) ? this.tg.get(this.echo.delayTime) : this.echo.delayTime.value).toFixed(5),
      air: g(this.air.gain),
      squeal: g(this.ground.squealGain),
      groan: g(this.ground.groanGain),
      rain: g(this.wet.rainHiGain),
      rainPre: g(this.wet.rainPre),
      hail: g(this.wet.hailGain),
      hum: g(this.cab.humGain),
      gyro: g(this.cab.gyroGain),
      fan: g(this.cab.fanGain),
      voices: (this.voices || []).map((v) => g(v.out)),
      road: this.road ? g(this.road.roar) : 0,
      ng: +this.ng.toFixed(4),
      n2: +this.n2.toFixed(4),
      on: { ...this.on },
    };
  }
}

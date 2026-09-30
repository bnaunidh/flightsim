/**
 * The rocket's sound, on the game's own mixer (audio/mixer.js), on its
 * 'engine' and 'alerts' buses so the volume sliders and the mute already
 * work on it.
 *
 * The roar is two noises — a deep rumble and a crackle on top — and its
 * loudness is the engine's power times how much air there is to carry it.
 * So it fades as the rocket climbs and is silent in space, which is true,
 * and which is the moment the HUD says so. The countdown beeps, separation
 * clunks and the touchdown thump are one-shots.
 *
 * `level` and `crackle` are kept on the object as plain numbers — what the
 * gains were last asked for — so the browser check can read what the
 * sound is doing without anybody having to listen to it.
 */

export class RocketAudio {
  constructor(sim) {
    this.sim = sim;
    this.nodes = null;
    this.level = 0;
    this.crackle = 0;
  }

  get mixer() {
    const a = this.sim && this.sim.audio;
    return a && a.available && a.mixer && a.mixer.ctx ? a.mixer : null;
  }

  ensure() {
    if (this.nodes) return true;
    const mx = this.mixer;
    if (!mx) return false;
    try {
      const ctx = mx.ctx;
      const rumble = mx.noiseSource(true);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 240;
      lp.Q.value = 0.7;
      const rg = ctx.createGain();
      rg.gain.value = 0;
      rumble.connect(lp);
      lp.connect(rg);
      rg.connect(mx.bus('engine'));
      const hiss = mx.noiseSource(false);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.6;
      const cg = ctx.createGain();
      cg.gain.value = 0;
      hiss.connect(bp);
      bp.connect(cg);
      cg.connect(mx.bus('engine'));
      this.nodes = { rumble, hiss, lp, bp, rg, cg };
      return true;
    } catch (e) {
      console.warn('[rocket] no engine sound', e);
      this.nodes = null;
      return false;
    }
  }

  /**
   * @param {number} dt
   * @param {number} power 0..1, the engine
   * @param {number} air   0..1, how much air there is to hear it through
   * @param {number} near  0..1, how close the camera is (the ground camera is far)
   */
  update(dt, power, air, near = 1) {
    const flick = 0.85 + Math.random() * 0.3;
    this.level = Math.max(0, Math.min(1, power * air * near)) * 0.9;
    this.crackle = this.level * 0.45 * flick;
    if (!this.ensure()) return;
    const t = this.nodes.rg.context.currentTime;
    this.nodes.rg.gain.setTargetAtTime(this.level, t, 0.08);
    this.nodes.cg.gain.setTargetAtTime(this.crackle, t, 0.05);
    this.nodes.lp.frequency.setTargetAtTime(180 + power * 160, t, 0.2);
  }

  beep(high = false) {
    const mx = this.mixer;
    if (!mx) return;
    mx.tone({ bus: 'alerts', freq: high ? 1320 : 880, duration: high ? 0.5 : 0.16, gain: 0.22, type: 'sine' });
  }

  clunk() {
    const mx = this.mixer;
    if (!mx) return;
    mx.noiseBurst({ bus: 'engine', duration: 0.35, gain: 0.5, type: 'lowpass', freq: 220, q: 0.8 });
    mx.tone({ bus: 'engine', freq: 90, duration: 0.25, gain: 0.25, type: 'triangle', sweepTo: 50 });
  }

  thump() {
    const mx = this.mixer;
    if (!mx) return;
    mx.noiseBurst({ bus: 'engine', duration: 0.5, gain: 0.6, type: 'lowpass', freq: 160, q: 0.7 });
  }

  chime(good = true) {
    const a = this.sim && this.sim.audio;
    if (!a || !a.available || !a.alerts) return;
    try {
      if (good) a.alerts.success();
      else a.alerts.failure();
    } catch (e) {
      /* a missing jingle is not worth a thrown frame */
    }
  }

  /** Quiet everything the aeroplane's synths might still be holding. */
  hushAeroplane(dt) {
    const a = this.sim && this.sim.audio;
    if (!a || !a.available) return;
    const w = this.sim.weather;
    const off = {
      rpm: 0,
      controls: { throttle: 0, brakes: 0, yaw: 0 },
      airspeed: 0,
      ias: 0,
      fuel: 1,
      alt: 0,
      agl: 0,
      vs: 0,
      onGround: false,
      groundSpeed: 0,
      engineOn: false,
    };
    try {
      if (a.engineKind === 'jet') a.jet.update(dt, off, w);
      else if (a.engineKind === 'rotor' && a.vehicles && a.vehicles.updateRotor) a.vehicles.updateRotor(dt, off, w);
      else a.engine.update(dt, off, w);
    } catch (e) {
      /* see above */
    }
  }

  stop() {
    this.level = 0;
    this.crackle = 0;
    if (!this.nodes) return;
    try {
      this.nodes.rumble.stop();
      this.nodes.hiss.stop();
      this.nodes.rg.disconnect();
      this.nodes.cg.disconnect();
    } catch (e) {
      /* already stopped */
    }
    this.nodes = null;
  }
}

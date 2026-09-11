/**
 * Audio facade: one object the rest of the game talks to.
 */

import { AudioMixer, BUSES } from './mixer.js';
import { EngineSound } from './engine.js';
import { JetSound } from './jet.js';
import { Ambience } from './ambience.js';
import { Radio } from './atc.js';
import { Alerts } from './alerts.js';
import { Music } from './music.js';

export class GameAudio {
  constructor() {
    this.mixer = new AudioMixer();
    this.engine = new EngineSound(this.mixer);
    this.jet = new JetSound(this.mixer);
    /** Which of the two is making the noise. */
    this.engineKind = 'prop';
    this.ambience = new Ambience(this.mixer);
    this.radio = new Radio(this.mixer);
    this.alerts = new Alerts(this.mixer);
    this.music = new Music(this.mixer);
    this.started = false;
    this.musicEnabled = true;
    this._lastFlash = 0;
  }

  /** Called from the first click/keypress — browsers require a gesture. */
  async start() {
    const ok = await this.mixer.ensure();
    if (!ok) return false;
    this.engine.build();
    this.jet.build();
    this.ambience.build();
    this.radio.build();
    this.alerts.build();
    this.music.build();
    this.started = true;
    return true;
  }

  get available() {
    return this.started && !this.mixer.failed;
  }

  setVolume(bus, v) {
    this.mixer.setVolume(bus, v);
  }

  setMuted(m) {
    this.mixer.setMuted(m);
  }

  setMusicEnabled(on) {
    this.musicEnabled = on;
    if (!on) this.music.stop();
  }

  /** Called when the aeroplane changes. */
  setEngineKind(kind) {
    if (kind === this.engineKind) return;
    // Silence the one that is standing down, or it hangs on at its last note.
    if (this.available) (this.engineKind === 'jet' ? this.jet : this.engine).playStop();
    this.engineKind = kind === 'jet' ? 'jet' : 'prop';
  }

  setInterior(inside) {
    this.engine.setInterior(inside);
    this.jet.setInterior(inside);
    this.ambience.setInterior(inside);
  }

  update(dt, ac, weather, cloudImmersion) {
    if (!this.available) return;
    // Only one of them runs. A turbofan making piston noises was the single
    // most obviously wrong thing about flying the airliner.
    if (this.engineKind === 'jet') this.jet.update(dt, ac, weather);
    else this.engine.update(dt, ac, weather);
    this.ambience.update(dt, ac, weather, cloudImmersion);
    this.alerts.update(dt, ac, weather);
    this.radio.update(dt, weather);
    this.music.update(dt);

    // Thunder follows the lightning flash.
    if (weather.lightningFlash > 0.9 && this._lastFlash <= 0.9) {
      const distance = Math.random();
      setTimeout(() => this.ambience.playThunder(distance), 300 + distance * 3200);
    }
    this._lastFlash = weather.lightningFlash;
  }

  /**
   * Sound while you are driving the boat or the car.
   *
   * The drive loop returns before update(), so two things were true at once:
   * the boat was completely silent, and the aeroplane's engine held its last
   * gain target and droned over the top of it for the whole trip — take the
   * boat out at cruise power and you hear a Skylark from the water.
   *
   * So the aeroplane's engine is wound down, and the vehicle drives the same
   * piston synth from its own throttle. The stall warner and the radio are not
   * called: a boat has neither, and the alerts read altitudes it does not have.
   */
  updateVehicle(dt, reading, weather) {
    if (!this.available) return;
    const ms = (reading.speedKts || 0) / 1.94384;
    // Every field the three synths actually read — checked against them
    // rather than guessed, which is how the first attempt threw on
    // ac.controls.throttle one frame into the boat.
    const throttle = reading.throttle || 0;
    const state = {
      rpm: 0,
      controls: { throttle, brakes: 0 },
      airspeed: ms,
      ias: reading.speedKts || 0,
      fuel: 1,
      alt: 0,
      agl: 0,
      vs: 0,
      onGround: true,
      groundSpeed: ms,
    };
    // Whichever one was flying: stand it down.
    if (this.engineKind === 'jet') this.jet.update(dt, state, weather);
    // The vehicle's own note, from its own throttle. A boat at full ahead and
    // a car at full throttle both sit around three-quarter rpm, which is a
    // working engine rather than a screaming one.
    this.engine.update(dt, { ...state, rpm: throttle * 0.75 }, weather);
    this.ambience.update(dt, state, weather, 0);
    this.music.update(dt);
  }

  volumes() {
    return { master: this.mixer.volumes.master, ...BUSES.reduce((o, b) => ((o[b] = this.mixer.volumes[b]), o), {}) };
  }
}

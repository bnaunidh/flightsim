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
import { VehicleAudio } from './vehicles.js';

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
    // The boat, the car and the helicopter. Nothing is built until one of them
    // is used, so a lesson spent flying costs nothing for the other two.
    this.vehicles = new VehicleAudio(this.mixer);
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
    if (this.available) {
      if (this.engineKind === 'jet') this.jet.playStop();
      else if (this.engineKind === 'rotor') this.vehicles.playStop();
      else this.engine.playStop();
    }
    this.engineKind = kind === 'jet' ? 'jet' : kind === 'rotor' ? 'rotor' : 'prop';
  }

  setInterior(inside) {
    this.engine.setInterior(inside);
    this.jet.setInterior(inside);
    this.ambience.setInterior(inside);
    this.vehicles.setInterior(inside);
  }

  update(dt, ac, weather, cloudImmersion) {
    if (!this.available) return;
    // Only one of them runs. A turbofan making piston noises was the single
    // most obviously wrong thing about flying the airliner.
    // Three instruments now, and exactly one of them runs. A helicopter
    // driving the four-cylinder piston synth was the same category of mistake
    // as the airliner doing it.
    if (this.engineKind === 'jet') this.jet.update(dt, ac, weather);
    else if (this.engineKind === 'rotor') this.vehicles.updateRotor(dt, ac, weather);
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
  /**
   * The boat and the car.
   *
   * Three bugs went with the rewrite. The aeroplane's piston synth was being
   * run at `throttle * 0.75` for both of them, which is a four-cylinder
   * aero engine and neither a diesel nor a road car. `onGround: true` with
   * `groundSpeed: ms` drove Ambience's TYRE ROLL layer, so the rescue launch
   * had aeroplane tyre noise at sea, rising with boat speed. And whichever
   * aeroplane engine was not selected was left holding its last gain target
   * rather than being wound down, which is the drone.
   */
  updateVehicle(dt, reading, weather) {
    if (!this.available) return;
    const ms = (reading.speedKts || 0) / 1.94384;
    // Both aeroplane engines get an explicit zero-rpm state rather than being
    // left alone: a synth that is not updated holds its last gain and drones.
    const off = {
      rpm: 0,
      controls: { throttle: 0, brakes: 0, yaw: 0 },
      airspeed: ms,
      ias: reading.speedKts || 0,
      fuel: 1,
      alt: 0,
      agl: 0,
      vs: 0,
      onGround: false,
      groundSpeed: 0,
      engineOn: false,
    };
    if (this.engineKind === 'jet') this.jet.update(dt, off, weather);
    else this.engine.update(dt, off, weather);

    // The vehicle's own instrument.
    this.vehicles.updateSurface(dt, reading, weather);

    // Wind and rain still apply — but NOT tyre roll, which is why onGround is
    // false above: the car's own synth owns the tyres and a boat has none.
    this.ambience.update(dt, off, weather, 0);

    // The music's 'ground' driver has been waiting for this cue.
    this.music.update(dt, {
      radioBusyUntil: 0,
      stall: false,
      alertLevel: 0,
      gear: false,
      ac: null,
      weather,
      cloudImmersion: 0,
      speedKts: reading.speedKts || 0,
      data: reading,
    });
  }

  volumes() {
    return { master: this.mixer.volumes.master, ...BUSES.reduce((o, b) => ((o[b] = this.mixer.volumes[b]), o), {}) };
  }
}

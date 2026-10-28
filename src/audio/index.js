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

/**
 * A gain to exactly nothing inside a quarter of a second, whatever was
 * scheduled on it (an engine's 1.6 s wind-down, a 2.6 s spool-down): the
 * timeline is cleared first, so the ramp is the only thing left on it.
 */
export function rampOff(gain, t, seconds = 0.25) {
  try {
    gain.cancelScheduledValues(t);
    gain.setValueAtTime(Math.max(0, gain.value), t);
    gain.linearRampToValueAtTime(0, t + seconds);
  } catch (e) {
    gain.value = 0;
  }
}

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
    // The device's speech voice is outside the mixer: stop it mid-sentence too.
    if (m) this.radio.stopSpeech();
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

  /**
   * Nothing of the flight loops while there is no flight.
   *
   * Tomm1z's video (3:05-3:20): a crash into the terminal, "Main menu", and
   * in the menu and Settings "What is that sound? ... Is this like a horror
   * game?" What he heard: quitToMenu() stands the aeroplane back on the
   * runway with its engine running and update() kept driving the engine
   * synth at idle, the slipstream and breeze, the stall warner and the
   * radio's background chatter (formant gibberish voices) behind the blurred
   * menu — with nothing on screen to explain any of it. Now the engine, jet
   * and rotor synths are stopped, the ambience is silenced, the warners are
   * off and the radio's queue is dropped the moment the state leaves
   * 'flying'; only the music plays in the menus. `hushed` is readable, so a
   * test can check it as data.
   */
  hush() {
    if (this.hushed) return;
    this.hushed = true;
    if (!this.available) return;
    this.engine.playStop();
    this.jet.playStop();
    this.vehicles.playStop();
    // ...and their outputs to nothing inside a quarter of a second: the
    // stops above are the sound of an engine winding down (1.6 s, 2.6 s),
    // right in flight and wrong behind a menu.
    const t = this.mixer.time;
    for (const s of [this.engine, this.jet, this.vehicles.rotor]) {
      if (s && s.out && s.out.gain) rampOff(s.out.gain, t);
    }
    this.ambience.silence();
    this.alerts.setStall(false);
    this.alerts.setGearWarning(false);
    this.radio.hush();
  }

  /** What is still sounding, as numbers, for the checks (null before the first gesture). */
  loopLevels() {
    if (!this.available) return null;
    const g = (n) => (n && n.gain ? +n.gain.value.toFixed(4) : 0);
    return {
      engine: g(this.engine.out),
      jet: g(this.jet.out),
      wind: g(this.ambience.windGain),
      whistle: g(this.ambience.whistleGain),
      rain: g(this.ambience.rainGain),
      tyres: g(this.ambience.rollGain),
      cabin: g(this.ambience.cabinGain),
      stall: g(this.alerts.stallGain),
      gearHorn: g(this.alerts.gearGain),
      radioQueue: this.radio.queue ? this.radio.queue.length : 0,
      hushed: !!this.hushed,
    };
  }

  update(dt, ac, weather, cloudImmersion, quiet = false) {
    if (!this.available) return;
    if (quiet) {
      this.hush();
      this.music.update(dt);
      return;
    }
    this.hushed = false;
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

    // Thunder follows the lightning flash: a disaster's full-strength bolt,
    // or one of the storm's own strikes (weather.thunderSeq) — those are soft
    // flashes since wave 19 (never past 0.9), and none at all with Reduce
    // flashing on, but the storm still thunders.
    const struck = weather.thunderSeq != null && this._thunderSeq != null && weather.thunderSeq !== this._thunderSeq;
    if ((weather.lightningFlash > 0.9 && this._lastFlash <= 0.9) || struck) {
      const distance = Math.random();
      setTimeout(() => this.ambience.playThunder(distance), 300 + distance * 3200);
    }
    this._lastFlash = weather.lightningFlash;
    this._thunderSeq = weather.thunderSeq;
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

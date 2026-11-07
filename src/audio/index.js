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
import { FAMILIES, engineFamily } from './profile.js';

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
    this._plug();
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
    this._plug();
  }

  /** Only the synth in use stays on the graph. */
  _plug() {
    const k = this._hushedLong ? '' : this.engineKind;
    this.engine.plug(k === 'prop');
    this.jet.plug(k === 'jet');
  }

  /** Which of the families (profile.js) this aeroplane is. `type` is its roster entry. */
  setProfile(type) {
    this.family = engineFamily(type);
    const F = FAMILIES[this.family];
    const n = (type && type.shape && type.shape.power && type.shape.power.count) || 1;
    if (F.prop) this.engine.setProfile(F, n > 1);
    else if (!F.rotor) this.jet.setProfile(F, n);
    this.ambience.heavy = F.heavy;
  }

  /** The engine in use, whichever it is. The event handlers used to call the piston synth for every aircraft. */
  get activeEngine() {
    return this.engineKind === 'jet' ? this.jet : this.engineKind === 'rotor' ? this.vehicles : this.engine;
  }

  setInterior(inside) {
    this.engine.setInterior(inside);
    this.jet.setInterior(inside);
    this.ambience.setInterior(inside);
    this.vehicles.setInterior(inside);
  }

  /**
   * Nothing of the flight loops while there is no flight (Tomm1z, 3:05: a crash,
   * the menu, and "is this like a horror game?" from an idling synth behind it).
   * The moment the state leaves 'flying' the engines stop, the ambience and the
   * warners go silent and the radio's queue is dropped; only the music plays.
   * `hushed` is readable so a test can check it as data.
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
      this._quietFor = (this._quietFor || 0) + dt;
      if (this._quietFor > 0.5 && !this._hushedLong) {
        this._hushedLong = true;
        this._plug();
      }
      this.music.update(dt);
      return;
    }
    this.hushed = false;
    this._quietFor = 0;
    if (this._hushedLong) {
      this._hushedLong = false;
      this._plug();
    }
    // Exactly one instrument runs.
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
   * The boat and the car. The drive loop returns before update(), so the
   * aeroplane's engine is wound down here (a synth not updated holds its last
   * gain and drones) and the vehicle drives its own. No stall warner or radio.
   */
  updateVehicle(dt, reading, weather) {
    if (!this.available) return;
    const ms = (reading.speedKts || 0) / 1.94384;
    const off = {
      rpm: 0,
      controls: { throttle: 0, brakes: 0, yaw: 0 },
      airspeed: ms,
      ias: ms,
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

    // Wind and rain still apply; tyre roll does not: the car's synth owns the tyres.
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

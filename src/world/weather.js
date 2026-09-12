/**
 * Weather model.
 *
 * Holds the single source of truth for time of day, cloud/rain conditions and
 * wind. The sky, lighting, clouds, rain, audio and flight physics all read from
 * this object, so changing a preset changes the whole world consistently.
 *
 * Wind is stored the way real aviation reports it: the direction the wind is
 * coming FROM, in degrees true, plus a speed in knots.
 */

import * as THREE from '../vendor/three.module.js';
import { clamp, lerp } from '../core/noise.js';

export const TIMES = {
  day: { label: 'Midday', sunElev: 62, sunAzim: 135 },
  sunset: { label: 'Sunset', sunElev: 4.5, sunAzim: 255 },
  night: { label: 'Night', sunElev: -14, sunAzim: 300 },
};

export const CONDITIONS = {
  clear: { label: 'Clear', cloud: 0.16, rain: 0, fog: 0.000018, turb: 0.12, gust: 0.1, cloudBase: 1150 },
  cloudy: { label: 'Cloudy', cloud: 0.62, rain: 0, fog: 0.00006, turb: 0.32, gust: 0.25, cloudBase: 1050 },
  rainy: { label: 'Rainy', cloud: 0.85, rain: 0.55, fog: 0.00014, turb: 0.5, gust: 0.4, cloudBase: 780 },
  stormy: { label: 'Stormy', cloud: 1.0, rain: 1.0, fog: 0.00022, turb: 1.0, gust: 0.75, cloudBase: 560 },
};

/** Ready-made combinations offered in the UI. */
export const PRESETS = [
  { id: 'bluebird', name: 'Blue Bird Day', time: 'day', condition: 'clear', wind: 4, dir: 90, hint: 'Perfect for learning.' },
  { id: 'breezy', name: 'Breezy Afternoon', time: 'day', condition: 'cloudy', wind: 12, dir: 140, hint: 'A bit of a push from the side.' },
  { id: 'golden', name: 'Golden Sunset', time: 'sunset', condition: 'clear', wind: 7, dir: 70, hint: 'Beautiful light, calm air.' },
  { id: 'nightflight', name: 'Night Flight', time: 'night', condition: 'clear', wind: 5, dir: 100, hint: 'Runway lights on.' },
  { id: 'drizzle', name: 'Rainy Coast', time: 'day', condition: 'rainy', wind: 16, dir: 20, hint: 'Wet runway, gusty crosswind.' },
  { id: 'storm', name: 'Storm Front', time: 'sunset', condition: 'stormy', wind: 26, dir: 350, hint: 'Hard mode. Strong crosswind.' },
];

export class Weather {
  constructor() {
    this.time = 'day';
    this.condition = 'clear';
    this.windSpeedKts = 4;
    this.windDirDeg = 90; // coming FROM
    this.turbulenceScale = 1;
    this.gustPhase = Math.random() * 100;
    this.time_s = 0;

    this._wind = new THREE.Vector3();
    this._gust = new THREE.Vector3();
    this.lightningFlash = 0;
    /** Active weather events. Null unless a disaster is running. */
    this._shear = null;
    this._tempCond = null;
    this._front = null;
    this._nextLightning = 6;

    /* ---- Random winds ---- */
    // Off by default: a steady wind is what you want while you are learning.
    // Switched on, the wind wanders and every so often a gust rolls through,
    // which is what real flying is actually like.
    this.randomWinds = false;
    this.baseWindKts = this.windSpeedKts;
    this.baseWindDirDeg = this.windDirDeg;
    this._targetKts = this.windSpeedKts;
    this._targetDirDeg = this.windDirDeg;
    this._nextShift = 18;
    this._nextGust = 25;
    this._gustKts = 0;
    this._gustLeft = 0;
    /** Set by the game so it can tell the player a gust has arrived. */
    this.onGust = null;
  }

  /**
   * Turn wandering wind on or off. The wind always returns to the speed and
   * direction you actually chose, so switching it off leaves the weather
   * exactly as you set it.
   */
  setRandomWinds(on) {
    this.randomWinds = !!on;
    if (on) {
      this.baseWindKts = this.windSpeedKts;
      this.baseWindDirDeg = this.windDirDeg;
      this._targetKts = this.windSpeedKts;
      this._targetDirDeg = this.windDirDeg;
      this._nextShift = 12 + Math.random() * 20;
      this._nextGust = 18 + Math.random() * 30;
    } else {
      this.windSpeedKts = this.baseWindKts;
      this.windDirDeg = this.baseWindDirDeg;
      this._gustKts = 0;
      this._gustLeft = 0;
    }
    return this.randomWinds;
  }

  /** Wander the wind and roll the occasional gust through. */
  _updateRandomWinds(dt) {
    // Every so often, pick a new steady wind to drift towards.
    this._nextShift -= dt;
    if (this._nextShift <= 0) {
      this._nextShift = 20 + Math.random() * 40;
      // Stay in the neighbourhood of the wind you chose: ±8 kt and ±50°, and
      // never a dead calm that would make the whole thing pointless.
      this._targetKts = Math.max(2, this.baseWindKts + (Math.random() * 2 - 1) * 6);
      this._targetDirDeg = this.baseWindDirDeg + (Math.random() * 2 - 1) * 50;
    }

    // Drift towards it slowly — about a minute to make the full change.
    const k = Math.min(1, dt * 0.06);
    this.windSpeedKts += (this._targetKts - this.windSpeedKts) * k;
    let dDir = ((this._targetDirDeg - this.windDirDeg + 540) % 360) - 180;
    this.windDirDeg = (this.windDirDeg + dDir * k + 360) % 360;

    // Gusts: a sharp rise that fades over a few seconds.
    this._nextGust -= dt;
    if (this._nextGust <= 0) {
      this._nextGust = 15 + Math.random() * 45;
      this._gustKts = 5 + Math.random() * 12;
      this._gustLeft = 3.5 + Math.random() * 4;
      if (this.onGust) this.onGust(Math.round(this._gustKts), Math.round(this.windDirDeg));
    }
    if (this._gustLeft > 0) {
      this._gustLeft -= dt;
      if (this._gustLeft <= 0) this._gustKts = 0;
    }
  }

  /** Wind speed including any gust currently blowing through. */
  get effectiveWindKts() {
    if (!this.randomWinds || this._gustLeft <= 0) return this.windSpeedKts;
    // Fast in, slow out — that is what a gust feels like.
    const f = Math.min(1, this._gustLeft / 2.5);
    return this.windSpeedKts + this._gustKts * f;
  }

  applyPreset(id) {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    this.time = p.time;
    this.condition = p.condition;
    this.windSpeedKts = p.wind;
    this.windDirDeg = p.dir;
  }

  get cond() {
    const base = CONDITIONS[this._tempCond ? this._tempCond.id : this.condition];
    if (this._tempCond && this._tempCond.overrides) return { ...base, ...this._tempCond.overrides };
    return base;
  }

  /**
   * Windshear: a column of sinking air with an outflow at the bottom, which is
   * what a microburst actually is. The downdraught is the frightening part but
   * the headwind-to-tailwind swing through the middle is the dangerous one.
   */
  startShear({ down = 10, headwind = 12, seconds = 30 } = {}) {
    this._shear = { left: seconds, total: seconds, down, headwind };
  }

  /** A gust front: the wind jumps in strength and swings round. */
  gustFront({ speedMultiplier = 2.5, turnDeg = 60, seconds = 60 } = {}) {
    this._front = {
      left: seconds,
      fromKts: this.windSpeedKts,
      fromDir: this.windDirDeg,
    };
    this.windSpeedKts = this.windSpeedKts * speedMultiplier + 6;
    this.windDirDeg = (this.windDirDeg + turnDeg + 360) % 360;
    this.baseWindKts = this.windSpeedKts;
    this.baseWindDirDeg = this.windDirDeg;
  }

  /** Swap the sky for a while, then put it back the way it was. */
  /**
   * The weather that is actually in force: a temporary condition if one is
   * running, otherwise the base. Anything asking "is it stormy" wants this.
   */
  get effectiveCondition() {
    return this._tempCond ? this._tempCond.id : this.condition;
  }

  temporaryCondition(id, seconds, overrides = null) {
    if (!CONDITIONS[id]) return;
    this._tempCond = { id, left: seconds, overrides };
  }

  /**
   * Vertical air movement in metres per second, positive downwards. Only a
   * microburst produces it, and the flight model subtracts it from the
   * aeroplane's relative airflow.
   */
  get downdraft() {
    if (!this._shear || this._shear.left <= 0) return 0;
    // Strongest in the middle of the encounter, nothing at the edges.
    const t = 1 - this._shear.left / this._shear.total;
    return this._shear.down * Math.sin(Math.min(1, Math.max(0, t)) * Math.PI);
  }

  /**
   * The headwind gained or lost inside the shear, in m/s along the current
   * wind direction: a gain on the way in, a loss on the way out, which is the
   * part that catches people.
   */
  get shearHeadwind() {
    if (!this._shear || this._shear.left <= 0) return 0;
    const t = 1 - this._shear.left / this._shear.total;
    return this._shear.headwind * Math.cos(Math.min(1, Math.max(0, t)) * Math.PI);
  }

  get timeInfo() {
    return TIMES[this.time];
  }

  get isNight() {
    return this.time === 'night';
  }

  /** Sun direction as a unit vector pointing FROM the scene TO the sun. */
  sunDirection(out = new THREE.Vector3()) {
    const t = this.timeInfo;
    const el = THREE.MathUtils.degToRad(t.sunElev);
    const az = THREE.MathUtils.degToRad(t.sunAzim);
    out.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az));
    return out.normalize();
  }

  /**
   * Steady wind as a world-space velocity in metres/second.
   * X is east, Z is south (three.js default: -Z is north).
   */
  windVector(out = this._wind) {
    // A microburst adds a headwind that decays into a tailwind as you pass
    // through it, on top of whatever the wind was already doing.
    const speed = this.effectiveWindKts * 0.514444 + this.shearHeadwind;
    const from = THREE.MathUtils.degToRad(this.windDirDeg);
    // Wind FROM north (0°) blows toward the south (+Z).
    out.set(-Math.sin(from) * speed, 0, Math.cos(from) * speed);
    return out;
  }

  /** Gust + turbulence component, smoothly varying. */
  gustVector(out = this._gust) {
    const t = this.time_s;
    const c = this.cond;
    const amp = this.effectiveWindKts * 0.514444 * c.gust * this.turbulenceScale;
    const s1 = Math.sin(t * 0.53 + this.gustPhase) * Math.sin(t * 0.21 + 1.7);
    const s2 = Math.sin(t * 0.37 + this.gustPhase * 1.7) * Math.sin(t * 0.13);
    const s3 = Math.sin(t * 0.79 + this.gustPhase * 0.3) * Math.sin(t * 0.29 + 4.1);
    out.set(s1 * amp, s3 * amp * 0.45, s2 * amp);
    return out;
  }

  /** Random buffeting for the airframe, scaled by the condition. */
  turbulenceLevel() {
    return this.cond.turb * this.turbulenceScale;
  }

  update(dt) {
    this.time_s += dt;
    if (this.randomWinds) this._updateRandomWinds(dt);

    // Weather events run themselves down and put things back as they were.
    if (this._shear) {
      this._shear.left -= dt;
      if (this._shear.left <= 0) this._shear = null;
    }
    if (this._tempCond) {
      this._tempCond.left -= dt;
      if (this._tempCond.left <= 0) this._tempCond = null;
    }
    if (this._front) {
      this._front.left -= dt;
      if (this._front.left <= 0) {
        this.windSpeedKts = this._front.fromKts;
        this.windDirDeg = this._front.fromDir;
        this.baseWindKts = this.windSpeedKts;
        this.baseWindDirDeg = this.windDirDeg;
        this._front = null;
      }
    }
    /*
     * Lightning during storms — including the ones a disaster brings.
     *
     * This read `this.condition`, the BASE weather, while Storm cell and
     * Typhoon both work by setting a temporary condition over the top of it.
     * So the two disasters in the game whose whole point is a thunderstorm
     * were the two that never produced a single flash.
     */
    if (this.effectiveCondition === 'stormy') {
      this._nextLightning -= dt;
      if (this._nextLightning <= 0) {
        this.lightningFlash = 1;
        this._nextLightning = 4 + Math.random() * 9;
      }
    }
    this.lightningFlash = Math.max(0, this.lightningFlash - dt * 3.2);
  }

  /** Colour palette derived from time of day + cloud cover. */
  palette() {
    const c = this.cond;
    const overcast = c.cloud;
    let top, horizon, sun, ground, ambient, sunIntensity, ambIntensity;
    if (this.time === 'day') {
      top = new THREE.Color(0x2f6fd0);
      horizon = new THREE.Color(0xbcd7f2);
      sun = new THREE.Color(0xfff4e0);
      ground = new THREE.Color(0x5a6b52);
      ambient = new THREE.Color(0x9fb8d8);
      sunIntensity = 3.1;
      ambIntensity = 1.05;
    } else if (this.time === 'sunset') {
      top = new THREE.Color(0x24427a);
      horizon = new THREE.Color(0xf3a35c);
      sun = new THREE.Color(0xffb066);
      ground = new THREE.Color(0x4a4034);
      ambient = new THREE.Color(0xb98a6a);
      sunIntensity = 2.1;
      ambIntensity = 0.75;
    } else {
      top = new THREE.Color(0x040a18);
      horizon = new THREE.Color(0x121d33);
      sun = new THREE.Color(0x9db4d8);
      ground = new THREE.Color(0x0b1018);
      ambient = new THREE.Color(0x2a3a55);
      sunIntensity = 0.38;
      ambIntensity = 0.3;
    }
    // Overcast washes colour out toward flat grey and kills the sun.
    const grey = new THREE.Color(this.isNight ? 0x161c26 : 0x8b94a0);
    top = top.clone().lerp(grey, overcast * 0.72);
    horizon = horizon.clone().lerp(grey, overcast * 0.6);
    sunIntensity *= lerp(1, 0.3, overcast);
    ambIntensity *= lerp(1, 0.85, overcast);
    return {
      top,
      horizon,
      sun,
      ground,
      ambient,
      sunIntensity,
      ambIntensity,
      fogDensity: c.fog,
      fogColor: horizon.clone().lerp(new THREE.Color(0xffffff), this.isNight ? 0 : 0.08),
    };
  }

  /** Kid-friendly summary of the wind relative to a runway heading. */
  windDescription(runwayHeadingDeg = 90) {
    const rel = ((this.windDirDeg - runwayHeadingDeg + 540) % 360) - 180; // -180..180
    const kts = Math.round(this.windSpeedKts);
    if (kts < 2) return { text: 'Air is calm', side: 'none', cross: 0, head: 0 };
    const rad = THREE.MathUtils.degToRad(rel);
    const cross = Math.abs(Math.sin(rad)) * kts;
    const head = Math.cos(rad) * kts;
    let side = 'none';
    if (Math.abs(rel) > 20 && Math.abs(rel) < 160) side = rel > 0 ? 'right' : 'left';
    let text;
    if (Math.abs(rel) <= 20) text = `Wind on the nose, ${kts} kt`;
    else if (Math.abs(rel) >= 160) text = `Wind from behind, ${kts} kt`;
    else text = `Wind pushing from the ${side === 'left' ? 'left' : 'right'}, ${kts} kt`;
    return { text, side, cross, head };
  }

  serialize() {
    return {
      time: this.time,
      condition: this.condition,
      // Save the wind you chose, not whatever the random gusts have wandered
      // to — otherwise the setting creeps every time you play.
      windSpeedKts: this.randomWinds ? this.baseWindKts : this.windSpeedKts,
      windDirDeg: this.randomWinds ? this.baseWindDirDeg : this.windDirDeg,
      randomWinds: this.randomWinds,
    };
  }

  load(data = {}) {
    if (data.time && TIMES[data.time]) this.time = data.time;
    if (data.condition && CONDITIONS[data.condition]) this.condition = data.condition;
    if (typeof data.windSpeedKts === 'number') this.windSpeedKts = clamp(data.windSpeedKts, 0, 40);
    if (typeof data.windDirDeg === 'number') this.windDirDeg = (data.windDirDeg + 360) % 360;
    this.baseWindKts = this.windSpeedKts;
    this.baseWindDirDeg = this.windDirDeg;
    if (typeof data.randomWinds === 'boolean') this.setRandomWinds(data.randomWinds);
  }
}

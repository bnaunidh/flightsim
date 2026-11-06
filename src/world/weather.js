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
import { FLASH, CAPS, dim } from '../render/flash-safety.js';
import { WxSystem, newSeed, climateFor, visibilityAt, windWords, visibilityWords, changeWords, VIS_OD, DECK_TOP_M } from './wx.js';
import {
  LATITUDE_BY_CLIMATE, PRESET_ELEVATION, sunPosition, hourForElevation, timeBucket, daylight, dayOfYearOf,
  sunLight, moonLight, skyLight, exposureFor,
} from './atmos.js';
import { windProfile, ROUGHNESS } from './turbulence.js';

/*
 * The three times of day, now PRESETS on a real sun (world/atmos.js): each
 * names the elevation it aims for (the fixed sun it used to be), and
 * Weather.setTime() finds the hour that puts this map's sun there today.
 * The keys are the words every mission, map and the multiplayer index use;
 * `sunElev`/`sunAzim` are the old fixed values, kept for anything that
 * still reads them as a description of the preset.
 */
export const TIMES = {
  day: { label: 'Midday', sunElev: 62, sunAzim: 135, elev: PRESET_ELEVATION.day },
  sunset: { label: 'Sunset', sunElev: 4.5, sunAzim: 255, elev: PRESET_ELEVATION.sunset },
  night: { label: 'Night', sunElev: -14, sunAzim: 300, elev: PRESET_ELEVATION.night },
};

/** A map's latitude: its own `latitude`, else by climate (atmos.js LATITUDE_BY_CLIMATE). */
export function latitudeOf(map) {
  if (map && Number.isFinite(map.latitude)) return map.latitude;
  return LATITUDE_BY_CLIMATE[climateFor(map)] || LATITUDE_BY_CLIMATE.temperate;
}

/*
 * The fixed skies. Since wave 19 each also says what its clouds are made of
 * (cu / tcu / cb / stratus / cirrus / scud — clouds.js), its visibility is
 * read from its fog (wx.js visibilityAt), and none of them has a low mist.
 * 'random' is the default (wx.js): it rolls a sky for the flight and moves
 * it on in phases; its entry here is only what it looks like before the
 * roll. It is LAST so the multiplayer index of the four older ones holds.
 */
export const CONDITIONS = {
  clear: { label: 'Clear', cloud: 0.16, deck: 0.14, rain: 0, fog: 0.000018, turb: 0.12, gust: 0.1, cloudBase: 1150, cu: 0.22, cirrus: 0.25 },
  cloudy: { label: 'Cloudy', cloud: 0.62, deck: 0.76, rain: 0, fog: 0.00006, turb: 0.32, gust: 0.25, cloudBase: 1050, cu: 0.8, tcu: 0.25, stratus: 0.35, cirrus: 0.1 },
  rainy: { label: 'Rainy', cloud: 0.85, deck: 0.92, rain: 0.55, fog: 0.00014, turb: 0.5, gust: 0.4, cloudBase: 780, cu: 0.3, stratus: 0.95, scud: 0.5 },
  stormy: { label: 'Stormy', cloud: 1.0, deck: 0.96, rain: 1.0, fog: 0.00022, turb: 1.0, gust: 0.75, cloudBase: 560, cu: 0.3, tcu: 0.6, cb: 1, stratus: 0.7, scud: 0.8, storm: 1 },
  random: { label: 'Random', cloud: 0.24, deck: 0.6, rain: 0, fog: 0.000038, turb: 0.16, gust: 0.14, cloudBase: 1150, cu: 0.42, cirrus: 0.3 },
};
for (const c of Object.values(CONDITIONS)) {
  for (const k of ['cu', 'tcu', 'cb', 'stratus', 'cirrus', 'scud', 'snow', 'mist', 'haze', 'hfA', 'storm']) if (c[k] == null) c[k] = 0;
  c.hfH = 150;
  c.base = c.cloudBase;
  c.visM = visibilityAt(c, 0);
}

/** The Sky picker's order and words: Random first (the default), Clear always for a calm demo. */
export const SKY_CHOICES = [
  { id: 'random', label: 'Random — changes as you fly' },
  { id: 'clear', label: 'Clear always' },
  { id: 'cloudy', label: 'Cloudy' },
  { id: 'rainy', label: 'Rainy' },
  { id: 'stormy', label: 'Stormy' },
];

/** Ambient lightning: one soft flash per 20 s at most, never with Reduce flashing on. */
export const LIGHTNING_MIN_GAP_S = 20;
export const LIGHTNING_PEAK = 0.45;
/** The glow inside a storm cell's cloud at its brightest (clouds.js uCellFlash). */
export const CELL_FLASH_PEAK = 0.6;

/** Ready-made combinations offered in the UI. */
export const PRESETS = [
  { id: 'bluebird', name: 'Blue Bird Day', time: 'day', condition: 'clear', wind: 4, dir: 90, hint: 'Perfect for learning.' },
  { id: 'breezy', name: 'Breezy Afternoon', time: 'day', condition: 'cloudy', wind: 12, dir: 140, hint: 'A bit of a push from the side.' },
  { id: 'golden', name: 'Golden Sunset', time: 'sunset', condition: 'clear', wind: 7, dir: 70, hint: 'Beautiful light, calm air.' },
  { id: 'nightflight', name: 'Night Flight', time: 'night', condition: 'clear', wind: 5, dir: 100, hint: 'Runway lights on.' },
  { id: 'drizzle', name: 'Rainy Coast', time: 'day', condition: 'rainy', wind: 16, dir: 20, hint: 'Wet runway, gusty crosswind.' },
  { id: 'storm', name: 'Storm Front', time: 'sunset', condition: 'stormy', wind: 26, dir: 350, hint: 'Hard mode. Strong crosswind.' },
];

/**
 * Today's moon. Days since a known new moon (2000-01-06 18:14 UTC), modulo
 * the synodic month, gives its age; the lit fraction of the disc follows from
 * that. Taken at local noon so it holds still for the whole of a day's play.
 *   illum   0 new .. 1 full
 *   waxing  true for the first half of the cycle (lit on the right)
 */
const SYNODIC_DAYS = 29.530588853;
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);
export function moonPhaseAt(ms) {
  const days = (ms - NEW_MOON_MS) / 86400000;
  const age = ((days % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  return {
    age,
    illum: (1 - Math.cos((2 * Math.PI * age) / SYNODIC_DAYS)) / 2,
    waxing: age < SYNODIC_DAYS / 2,
  };
}

function todaysNoon(now = Date.now()) {
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

export class Weather {
  constructor() {
    /*
     * The moon's phase, seeded per day: a real calendar's moon, so the night
     * sky is not the same every night. The sky reads it for the shape of the
     * moon and how many stars it washes out (sky.js).
     */
    const moon = moonPhaseAt(todaysNoon());
    this.moonPhase = moon.illum;
    this.moonWaxing = moon.waxing;

    /*
     * Time of day (world/atmos.js): a latitude, a day of the year and an
     * hour (local solar time, 0..24). `time` is a word derived from the sun's
     * elevation ('day' / 'sunset' / 'night'); setting it picks the preset's
     * hour. `clockRate` > 0 lets the hour run (game seconds per hour; 0 holds
     * it still, as the fixed skies always did).
     */
    this.latitude = LATITUDE_BY_CLIMATE.temperate;
    this.dayOfYear = dayOfYearOf();
    this.hour = 12;
    this._preset = null;
    this.clockRate = 0;
    this._sun = { elevDeg: 62, azimDeg: 180 };
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

    /* ---- Random weather (wx.js) ---- */
    /** The rolled sky while the condition is 'random'; null otherwise. */
    this.wx = null;
    /** Where the player is, for the regional weather and the approach hold (main.js observe()). */
    this.obs = { x: 0, z: 0, hold: false };
    /** Set by the game: the weather's news ({ kind: 'soon'|'start'|'done', ... }) for the HUD and the radio. */
    this.onWxNews = null;
    this._wxGustKts = 0;
    this._wxGustLeft = 0;
    this._wxNextGust = 20;
    this._chosenKts = this.windSpeedKts;
    this._chosenDir = this.windDirDeg;
    this._lightT = LIGHTNING_MIN_GAP_S * 0.5;
    this._lightRise = 0;
    /** Lightning glowing inside the storm cells' clouds only (clouds.js); flash-safe like the rest. */
    this.cellFlash = 0;
    this._cellT = LIGHTNING_MIN_GAP_S * 0.5;
    this._cellRise = 0;
    /*
     * The ONE gap every flash the weather makes keeps (the storm's own and
     * the storm cells' glow alike): the owner's "max 1 soft flash per ~20 s"
     * is for the screen, not for each source — a stormy sky has both, and
     * on separate clocks they flashed 2 s apart. A disaster's bolt counts.
     */
    this._lastFlashAt = -Infinity;
    /** Counts the storm's strikes, seen or not (Reduce flashing hides the flash, not the thunder) — audio/index.js. */
    this.thunderSeq = 0;
  }

  /** May a flash start now: the last one, of any kind, LIGHTNING_MIN_GAP_S or more ago? */
  _flashFree() {
    return this.time_s - this._lastFlashAt >= LIGHTNING_MIN_GAP_S;
  }

  /** Is the sky the rolled, changing one? */
  get isRandom() {
    return this.condition === 'random';
  }

  /**
   * Roll the sky for a flight (condition 'random' only; anything else clears
   * it). `ctx`: { seed, map, regions, time } — the map's description and its
   * usual wind decide the climate and the day's wind; `regions` (the World
   * Map's) give each region its own weather. The same seed and map always
   * give the same weather (tests/features/weather.mjs).
   */
  beginFlight(ctx = {}) {
    if (!this.isRandom) {
      this.wx = null;
      return null;
    }
    /*
     * A roll with no map named (the menu's sky at boot, the sky put back
     * after a boat or a van job) is for the map the last one was: before,
     * it was a temperate roll anywhere — fog on the tropical Kestrel, rain
     * not snow on the Fjord — and on the World Map one sky for every region.
     */
    const map = 'map' in ctx ? ctx.map || null : this._lastMap || null;
    const regions = 'regions' in ctx ? ctx.regions || null : this._lastRegions || null;
    this._lastMap = map;
    this._lastRegions = regions;
    const mw = (map && map.weather) || {};
    const seed = Number.isFinite(ctx.seed) ? ctx.seed >>> 0 : newSeed();
    this.wx = new WxSystem({
      seed,
      climate: ctx.climate || climateFor(map),
      time: this.time,
      windKts: Number.isFinite(mw.windSpeedKts) ? mw.windSpeedKts : Math.max(4, this._chosenKts),
      windDirDeg: Number.isFinite(mw.windDirDeg) ? mw.windDirDeg : this._chosenDir,
      regions,
    });
    this.wxSeed = seed;
    if (ctx.x != null) { this.obs.x = ctx.x; this.obs.z = ctx.z; }
    this.wx.update(0, this.obs);
    this._applyWxWind();
    return this.wx;
  }

  /** Where the player is, and whether they are on an approach (the murk waits). */
  observe(x, z, hold = false) {
    this.obs.x = x;
    this.obs.z = z;
    this.obs.hold = !!hold;
  }

  _applyWxWind() {
    const w = this.wx.wind;
    this.windSpeedKts = w.kts;
    this.windDirDeg = w.dirDeg;
  }

  /** The gust the rolled sky is blowing, kt (the peak a report would give). */
  get gustKts() {
    if (this.wx) return this.wx.wind.gustKts;
    return this.windSpeedKts + (this.randomWinds ? this._gustKts : 0);
  }

  /** Visibility where the player is, metres (at `altM` above the sea). */
  visibilityM(altM = 0) {
    return visibilityAt(this.cond, altM);
  }

  /**
   * The weather in words, for the card, the briefing and the radio:
   * { label, word, wind ("wind 240 at 14 gusting 22"), windRadio, visM,
   *   vis ("visibility 3 km in mist" or ''), change ("Weather changing: …"
   *   or ''), random, seed }.
   */
  describe() {
    const c = this.cond;
    const visM = visibilityAt(c, 0);
    const fc = this.wx ? this.wx.forecast() : null;
    const soon = fc && (fc.blending || (fc.warned && fc.inS <= 300));
    return {
      label: c.label,
      word: c.word || String(c.label || '').toLowerCase(),
      wind: windWords(this.windDirDeg, this.windSpeedKts, this.gustKts),
      windRadio: windWords(this.windDirDeg, this.windSpeedKts, this.gustKts, { radio: true }),
      visM,
      vis: visibilityWords(c, visM),
      change: soon ? changeWords(fc) : '',
      forecast: fc,
      random: !!this.wx,
      seed: this.wx ? this.wx.seed : null,
    };
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
    if (this.wx && this._wxGustLeft > 0) {
      const f = Math.min(1, this._wxGustLeft / 2.5);
      return this.windSpeedKts + this._wxGustKts * f;
    }
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
    if (this._tempCond) {
      const base = CONDITIONS[this._tempCond.id];
      if (this._tempCond.overrides) return { ...base, ...this._tempCond.overrides };
      return base;
    }
    if (this.isRandom) {
      // Rolled lazily for the menu's sky; a flight rolls its own (beginFlight).
      if (!this.wx) this.beginFlight({});
      return this.wx.cond;
    }
    return CONDITIONS[this.condition];
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
    if (this._tempCond) return this._tempCond.id;
    // The rolled sky as one of the four older words, for whatever asks "is it stormy".
    if (this.isRandom) return this.cond.bucket || 'clear';
    return this.condition;
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

  /* ---------------------------------------------------- time of day ---- */

  /** Where the sun is now: { elevDeg, azimDeg (compass, from north) }, cached per hour/latitude/day. */
  get sun() {
    // Compared field by field, not through a key string: this is read dozens of times a frame
    // (isNight, time, timeInfo), and a string each time was garbage a Chromebook had to collect.
    if (this._sunH !== this.hour || this._sunLat !== this.latitude || this._sunDay !== this.dayOfYear) {
      this._sunH = this.hour;
      this._sunLat = this.latitude;
      this._sunDay = this.dayOfYear;
      this._sun = sunPosition(this.latitude, this.dayOfYear, this.hour);
    }
    return this._sun;
  }

  /*
   * The sun's and the sky's light (world/atmos.js) for an elevation, a haze and a moon phase,
   * kept until one of them changes: palette() runs several times a frame, and with the sun
   * still these are the same numbers every time (and two dozen small arrays a call).
   */
  _atmosFor(el, haze, phase) {
    const c = this._atmos;
    if (c && c.el === el && c.haze === haze && c.phase === phase) return c;
    return (this._atmos = { el, haze, phase, S: sunLight(el, { haze }), K: skyLight(el, { haze }), M: moonLight(el, phase) });
  }

  /** The word for the sun's height now: 'day', 'sunset' (either twilight) or 'night'. */
  get time() {
    return timeBucket(this.sun.elevDeg);
  }

  /** Setting the word picks that preset's hour on this map today (setTime). */
  set time(id) {
    this.setTime(id);
  }

  /** The hour (12..24) at which this map's sun stands where the preset wants it today. */
  presetHour(id) {
    const t = TIMES[id] || TIMES.day;
    return hourForElevation(this.latitude, this.dayOfYear, t.elev);
  }

  /** Pick a preset: its hour, re-found whenever the map (latitude) changes. */
  setTime(id) {
    if (!TIMES[id]) return false;
    this._preset = id;
    this.hour = this.presetHour(id);
    return true;
  }

  /** Any hour, 0..24 (local solar time). Leaves the presets behind until setTime() is called again. */
  setHour(h) {
    if (!Number.isFinite(h)) return;
    this.hour = ((h % 24) + 24) % 24;
    this._preset = null;
  }

  /** The preset in force ('day' / 'sunset' / 'night'), or null when an hour was set by hand. */
  get preset() {
    return this._preset;
  }

  /**
   * Where this is: the map's latitude (and, if given, a day of the year). A
   * preset keeps its sun (its hour is found again); a hand-set hour stays.
   */
  setLocation(map, dayOfYear = null) {
    this.latitude = latitudeOf(map);
    if (Number.isFinite(dayOfYear)) this.dayOfYear = dayOfYear;
    if (this._preset) this.hour = this.presetHour(this._preset);
  }

  /**
   * { label, sunElev, sunAzim, hour, preset }: the sun's elevation in degrees
   * and its azimuth in the game's own convention (sunDirection: x = cos·sin,
   * z = cos·cos, so the compass bearing A reads as 180 − A).
   */
  get timeInfo() {
    const sun = this.sun;
    const o = this._timeInfo || (this._timeInfo = { label: '', sunElev: 0, sunAzim: 0, hour: 0, preset: null, daylight: 1 });
    o.label = TIMES[this.time].label;
    o.sunElev = sun.elevDeg;
    o.sunAzim = ((180 - sun.azimDeg) % 360 + 360) % 360;
    o.hour = this.hour;
    o.preset = this._preset;
    o.daylight = daylight(sun.elevDeg);
    return o;
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
   * The direction the scene's one directional light shines FROM: the sun
   * while it is up (never under 2° — a horizontal light is all shadow
   * acne), the moon — opposite the sun, as the dome draws it — once it is
   * down. Shadows follow it round through the day (sky.js followTarget).
   */
  lightDirection(out = new THREE.Vector3()) {
    this.sunDirection(out);
    const el = this.sun.elevDeg;
    /*
     * The moon takes over exactly where palette() hands it the light's colour
     * and strength (the brighter of the two), not at 0°: between −1° and 0°
     * the light was the red sun's but shone from the moon's side of the sky.
     */
    if (el < 3 && !this._sunIsTheLight(el)) out.multiplyScalar(-1);
    const minY = Math.sin(THREE.MathUtils.degToRad(2));
    if (out.y < minY) {
      const h = Math.hypot(out.x, out.z) || 1;
      const k = Math.sqrt(1 - minY * minY) / h;
      out.set(out.x * k, minY, out.z * k);
    }
    return out;
  }

  /** palette()'s choice: is the sun (not the moon) the scene's light at this elevation? */
  _sunIsTheLight(el) {
    const haze = this.wx && this.cond ? clamp(this.cond.haze || 0, 0, 1) : 0;
    const a = this._atmosFor(el, haze, this.moonPhase);
    return a.S.intensity >= a.M.intensity;
  }

  /** The tone-mapping exposure for this sun and sky (atmos.js exposureFor). */
  get exposure() {
    return exposureFor(this.sun.elevDeg, this.cond.cloud);
  }

  /**
   * Steady wind as a world-space velocity in metres/second.
   * X is east, Z is south (three.js default: -Z is north).
   *
   * With `aglM` given, the wind at that height over ground of roughness
   * `z0` (world/turbulence.js windProfile, the log law): the chosen wind is
   * the 10 m wind over grass (what the tower and the HUD report); below it
   * the wind drops — on short final the headwind fades over the last fifty
   * feet, so the airspeed sags and the crosswind changes as it does in real
   * life — and above it the wind is stronger, about 1.5× from 200 m up.
   * Without a height it is the chosen wind itself, as every other reader
   * expects. A microburst's shear is felt in full at any height.
   */
  windVector(out = this._wind, aglM = null, z0 = ROUGHNESS.grass) {
    // A microburst adds a headwind that decays into a tailwind as you pass
    // through it, on top of whatever the wind was already doing.
    const layer = Number.isFinite(aglM) ? windProfile(aglM, z0) : 1;
    const speed = this.effectiveWindKts * 0.514444 * layer + this.shearHeadwind;
    const from = THREE.MathUtils.degToRad(this.windDirDeg);
    // Wind FROM north (0°) blows toward the south (+Z).
    out.set(-Math.sin(from) * speed, 0, Math.cos(from) * speed);
    return out;
  }

  /** The multiple of the chosen (10 m) wind felt at `aglM` over ground of roughness `z0` (windProfile). */
  windLayer(aglM, z0 = ROUGHNESS.grass) {
    return windProfile(aglM, z0);
  }

  /**
   * Gust + turbulence component, smoothly varying — the old sum of sines.
   * The aeroplane no longer flies through this (physics.js carries a Dryden
   * filter per aircraft, world/turbulence.js); it is kept for anything else
   * that wants a cheap wobble.
   */
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
    // Inside cloud the air is bumpy (main.js sets `immersion` from the clouds' whiteout).
    return (this.cond.turb + (this.immersion || 0) * 0.3) * this.turbulenceScale;
  }

  update(dt) {
    this.time_s += dt;
    // The clock, if it runs: clockRate game-seconds per hour of sun (0 holds it).
    if (this.clockRate > 0 && dt > 0) {
      this.hour = (this.hour + dt / this.clockRate) % 24;
      this._preset = null;
    }
    if (this.isRandom) {
      if (!this.wx) this.beginFlight({});
      const news = this.wx.update(dt, this.obs);
      this._applyWxWind();
      // The rolled sky's gusts: up to its reported gust, every so often.
      this._wxNextGust -= dt;
      if (this._wxNextGust <= 0) {
        const spread = this.wx.wind.gustKts - this.wx.wind.kts;
        this._wxNextGust = 12 + Math.random() * 30;
        if (spread >= 3) {
          this._wxGustKts = spread * (0.5 + Math.random() * 0.5);
          this._wxGustLeft = 3 + Math.random() * 3;
        }
      }
      if (this._wxGustLeft > 0) this._wxGustLeft -= dt;
      if (news && this.onWxNews) this.onWxNews(news, this);
    } else if (this.randomWinds) this._updateRandomWinds(dt);

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
    // A disaster's bolt (full strength, set from outside) holds the weather's own flashes off too.
    if (this.lightningFlash > LIGHTNING_PEAK + 0.01 && !this._ambientFlash) this._lastFlashAt = this.time_s;
    if (this.effectiveCondition === 'stormy') this._updateLightning(dt);
    else this._lightRise = 0;
    // A storm's own strike fades softly (about half a second); a disaster's bolt as it always has.
    this.lightningFlash = Math.max(0, this.lightningFlash - dt * (this._ambientFlash ? 0.9 : 3.2));
    if (this.lightningFlash <= 0) this._ambientFlash = false;
    this._updateCellFlash(dt);
  }

  /**
   * Lightning inside the storm cells' own clouds — the towering, dark-based
   * cumulonimbus clouds.js draws, near or far: a glow inside the cloud, not
   * a wash over the sky. The same rules as the storm's: with Reduce flashing
   * on, none; off, at most one per LIGHTNING_MIN_GAP_S, rising over a
   * quarter of a second to CELL_FLASH_PEAK and fading over half a second.
   */
  _updateCellFlash(dt) {
    this._cellT -= dt;
    if (this._cellRise > 0) {
      this._cellRise -= dt;
      const k = 1 - Math.max(0, this._cellRise) / 0.25;
      this.cellFlash = Math.max(this.cellFlash, CELL_FLASH_PEAK * k);
    } else {
      this.cellFlash = Math.max(0, this.cellFlash - dt * 1.2);
    }
    if (FLASH.reduce || (this.cond.cb || 0) < 0.5) return;
    if (this._cellT <= 0 && this._cellRise <= 0) {
      if (!this._flashFree()) {
        // The storm flashed a moment ago: this glow waits its turn.
        this._cellT = LIGHTNING_MIN_GAP_S - (this.time_s - this._lastFlashAt) + Math.random() * 8;
        return;
      }
      this._cellT = LIGHTNING_MIN_GAP_S + Math.random() * 20;
      this._cellRise = 0.25;
      this._lastFlashAt = this.time_s;
    }
  }

  /**
   * Lightning inside the storm — flash-safe by construction (render/flash-
   * safety.js; the owner's brief: "max 1 soft flash per ~20 s, never
   * full-screen white, off when Reduce flashing is on").
   *
   * This read `this.condition`, the BASE weather, while Storm cell and
   * Typhoon both work by setting a temporary condition over the top of it —
   * so it asks effectiveCondition. It used to strike every 4 to 13 seconds
   * at full strength in one frame; now a strike is at least
   * LIGHTNING_MIN_GAP_S after the last, rises over a fifth of a second to
   * LIGHTNING_PEAK and fades over about half a second, and with Reduce
   * flashing on (the default) there is none at all — the storm is still
   * dark, wet and rough. A disaster's own bolt (main.js) still sets
   * lightningFlash itself, dimmed by flash-safety where it is drawn.
   */
  _updateLightning(dt) {
    this._lightT -= dt;
    if (this._lightRise > 0) {
      this._lightRise -= dt;
      const k = 1 - Math.max(0, this._lightRise) / 0.2;
      if (this.lightningFlash <= LIGHTNING_PEAK * k) {
        this.lightningFlash = LIGHTNING_PEAK * k;
        this._ambientFlash = true;
      }
    }
    if (this._lightT > 0) return;
    if (FLASH.reduce) {
      // A strike nobody sees: still the thunder (muted by default like every sound).
      this._lightT = LIGHTNING_MIN_GAP_S + Math.random() * 15;
      this.thunderSeq++;
      return;
    }
    if (!this._flashFree()) {
      // A storm cell glowed a moment ago: the strike waits its turn.
      this._lightT = LIGHTNING_MIN_GAP_S - (this.time_s - this._lastFlashAt) + Math.random() * 6;
      return;
    }
    this._lightT = LIGHTNING_MIN_GAP_S + Math.random() * 15;
    this._lightRise = 0.2;
    this._lastFlashAt = this.time_s;
    this.thunderSeq++;
  }

  /** Colour palette derived from time of day + cloud cover. */
  palette() {
    const c = this.cond;
    /*
     * Over the top of the cloud layer (10,000 ft, cloud-deck.js) the sky is a
     * clear one on every sky: main.js keeps `eyeY`, and the overcast and the
     * murk stay under you. A disaster's sky is the disaster's.
     */
    let above = 0;
    if (!this._tempCond && Number.isFinite(this.eyeY)) {
      above = clamp((this.eyeY - DECK_TOP_M + 200) / 400, 0, 1);
      above = above * above * (3 - 2 * above);
    }
    const overcast = c.cloud * (1 - above);
    /*
     * The colours from the sun's elevation (world/atmos.js): the sun's own
     * through the air it crosses, the sky's blended from it. At the three
     * presets' suns these are the colour sets the palettes had; between them
     * a sunset is a smooth ramp, not three looks. At night the light is the
     * moon's (sky.js aims it), by its phase.
     */
    const el = this.sun.elevDeg;
    const haze = this.wx ? clamp(c.haze || 0, 0, 1) : 0;
    const { S, K, M } = this._atmosFor(el, haze, this.moonPhase);
    // atmos.js works in the palettes' own (sRGB) values, as the old hex colours were.
    const srgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
    const top = srgb(K.zenith);
    let horizon = srgb(K.horizon);
    const ambient = srgb(K.ambient);
    const ground = srgb(K.ground);
    // Day: the sun. Night: the moon's colour and strength. Twilight: the brighter of the two.
    const sun = srgb(S.intensity >= M.intensity ? S.color : M.color);
    let sunIntensity = Math.max(S.intensity, M.intensity);
    let ambIntensity = K.ambIntensity;
    // Overcast washes colour out toward flat grey and kills the sun.
    const grey = new THREE.Color(this.isNight ? 0x161c26 : 0x8b94a0);
    top.lerp(grey, overcast * 0.72);
    horizon.lerp(grey, overcast * 0.6);
    sunIntensity *= lerp(1, 0.3, overcast);
    ambIntensity *= lerp(1, 0.85, overcast);
    /*
     * The rolled sky's murk (wx.js): a sky seen through haze, mist or rain
     * goes the colour of the murk, lit by the sun — whitish by day, warm at
     * sunset, dark at night — and the fog takes the same colour, so the
     * ground fades into it rather than into blue. Only the random sky: the
     * four fixed ones look exactly as they always have.
     */
    let fogColor = horizon.clone().lerp(new THREE.Color(0xffffff), this.isNight ? 0 : 0.08);
    if (this.wx && !this._tempCond) {
      const visU = c.fog > 0 ? Math.sqrt(VIS_OD) / c.fog : 1e5;
      const m = clamp((Math.log(40000) - Math.log(visU)) / (Math.log(40000) - Math.log(2500)), 0, 1);
      const murk = m * m * (3 - 2 * m) * (1 - above);
      const haze = clamp(c.haze || 0, 0, 1);
      const murkCol = this.isNight
        ? new THREE.Color(0x182030)
        : horizon.clone().lerp(sun, 0.22).lerp(new THREE.Color(0xe4e6e8), 0.4);
      // Rain and a storm are dark murk, not white: under a thunderstorm the day goes grey.
      if (!this.isNight) murkCol.lerp(new THREE.Color(0x5f6874), clamp((c.rain || 0) * 0.55 + (c.storm || 0) * 0.3, 0, 0.85));
      if (haze > 0 && !this.isNight) {
        // Haze: a pale, sunlit horizon and a washed-out blue overhead.
        horizon.lerp(new THREE.Color(0xd9d3c3), haze * 0.45);
        top.lerp(horizon, haze * 0.25);
      }
      top.lerp(murkCol, murk * 0.75);
      horizon.lerp(murkCol, murk * 0.85);
      fogColor = horizon.clone().lerp(murkCol, 0.4 + murk * 0.4);
      sunIntensity *= lerp(1, 0.55, murk * (c.mist || 0.5));
    }
    return {
      top,
      horizon,
      sun,
      ground,
      ambient,
      sunIntensity,
      ambIntensity,
      overcast,
      fogDensity: c.fog + (Math.min(c.fog, 0.00003) - c.fog) * above,
      fogColor,
      sunElev: el,
      daylight: K.daylight,
      moonlight: M.intensity,
      exposure: exposureFor(el, overcast),
    };
  }

  /**
   * The colour grade and glow for this weather — read every frame by the
   * bloom pass at High and Ultra (render/post.js). Gentle on purpose: warmer
   * at sunset, cooler and flatter as the cloud thickens, a touch of punch on
   * a clear day. `threshold` is in display terms: a clear midday needs a
   * value over 1 to glow, so only the sun's disc and its glints do; at night
   * the runway and town lights do.
   */
  look() {
    const o = this._look || (this._look = {});
    const over = clamp((this.cond.cloud - 0.3) / 0.7, 0, 1);
    const k = over * over * (3 - 2 * over);
    let warmth;
    let contrast;
    let saturation;
    let bloom;
    let threshold;
    if (this.time === 'sunset') {
      warmth = 0.55; contrast = 1.06; saturation = 1.08; bloom = 0.55; threshold = 0.9;
    } else if (this.isNight) {
      warmth = -0.15; contrast = 1.05; saturation = 0.97; bloom = 0.9; threshold = 0.62;
    } else {
      warmth = 0.04; contrast = 1.03; saturation = 1.05; bloom = 0.35; threshold = 1.0;
    }
    o.warmth = lerp(warmth, this.isNight ? -0.2 : -0.3, k);
    o.contrast = lerp(contrast, 0.95, k);
    o.saturation = lerp(saturation, 0.85, k);
    o.bloom = bloom * (1 + dim(this.lightningFlash, CAPS.lightning) * 0.5);
    o.threshold = threshold;
    o.knee = 0.25;
    return o;
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
      time: this._preset || this.time,
      // The hour, only when it was set by hand (a preset is saved as its word, so it follows the map's sun).
      hour: this._preset ? undefined : this.hour,
      condition: this.condition,
      // Save the wind you chose, not whatever the random gusts have wandered
      // to — otherwise the setting creeps every time you play.
      // And with the rolled sky, the wind you set, not the day's.
      windSpeedKts: this.isRandom ? this._chosenKts : this.randomWinds ? this.baseWindKts : this.windSpeedKts,
      windDirDeg: this.isRandom ? this._chosenDir : this.randomWinds ? this.baseWindDirDeg : this.windDirDeg,
      randomWinds: this.randomWinds,
    };
  }

  load(data = {}) {
    /*
     * A name this file does not know used to be dropped in silence.
     *
     * Two shipped that way: a car job asking for 'rain' when the condition is
     * called 'rainy', and a map asking for 'hazy', which is not a condition at
     * all. Both simply inherited whatever weather was already in force, so the
     * night call-out was written as a wet night and played as a dry one, and
     * nothing anywhere said so. Saying it out loud costs one line and is the
     * only way the next one gets found.
     */
    if (data.time && !TIMES[data.time]) {
      console.warn(`[weather] no time of day called "${data.time}" — keeping ${this.time}`);
    }
    if (data.condition && !CONDITIONS[data.condition]) {
      console.warn(
        `[weather] no condition called "${data.condition}" — keeping ${this.condition}. `
          + `Known: ${Object.keys(CONDITIONS).join(', ')}`
      );
    }
    const wasTime = this.time;
    const wasCond = this.condition;
    if (data.time && TIMES[data.time]) this.setTime(data.time);
    // An hour set by hand (the Free Flight slider) wins over the word beside it.
    if (Number.isFinite(data.hour)) this.setHour(data.hour);
    if (Number.isFinite(data.clockRate)) this.clockRate = Math.max(0, data.clockRate);
    if (data.condition && CONDITIONS[data.condition]) this.condition = data.condition;
    if (typeof data.windSpeedKts === 'number') this.windSpeedKts = clamp(data.windSpeedKts, 0, 40);
    if (typeof data.windDirDeg === 'number') this.windDirDeg = (data.windDirDeg + 360) % 360;
    this._chosenKts = this.windSpeedKts;
    this._chosenDir = this.windDirDeg;
    // A different sky or time of day is a different roll; a fixed sky has none.
    if (!this.isRandom || wasTime !== this.time || wasCond !== this.condition) this.wx = null;
    if (this.isRandom && this.wx) this._applyWxWind();
    this.baseWindKts = this.windSpeedKts;
    this.baseWindDirDeg = this.windDirDeg;
    if (typeof data.randomWinds === 'boolean') this.setRandomWinds(data.randomWinds);
  }
}

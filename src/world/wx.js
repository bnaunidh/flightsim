/**
 * Random weather — the sky's own story over a flight.
 *
 * The owner (2026-10-26): "more u fly theres gonna be weather phases". The
 * Sky choice 'random' (the default since wave 19) rolls a plausible weather
 * for the map from a seed — mostly fair, sometimes scattered or broken cloud,
 * overcast, light or heavy rain, morning mist over the water and in the
 * valleys, haze, snow only where it is cold, a gusty day, storm cells far
 * off — and then moves on, phase by phase: every 8 to 20 minutes the sky
 * blends, over two or three minutes, into the next plausible phase (clear →
 * cumulus building → showers → clearing → evening haze …).
 *
 * Pure: no three.js, no DOM, nothing but numbers, so the roll, the phases
 * and the words are tested in node (tests/features/weather.mjs). The same
 * seed and the same map always give the same weather.
 *
 * What a phase is made of (every field 0..1 unless it says otherwise):
 *   cloud     cover, the number the older code has always read
 *   cu        fair-weather cumulus      tcu  towering cumulus
 *   cb        cumulonimbus (storm cells, near or far)
 *   stratus   a flat grey deck at the base      cirrus  high wisps
 *   scud      low ragged cloud under rain
 *   rain      0 none .. 1 a downpour     snow  the same, as snow (cold only)
 *   visM      visibility at the surface, metres
 *   mist      the share of that murk that lies low (height fog) — 0 an even
 *             haze through the whole sky, 1 a fog bank you climb out of
 *   mistH     how deep the low part is, metres (its scale height)
 *   haze      the dusty, sunlit look (sky.js)
 *   turb, gust  as the fixed conditions in weather.js
 *   base      cloud base, metres     windMul  the phase's wind against the day's
 *   storm     a thunderstorm overhead (lightning; flash-safety rules apply)
 */
import { makeRandom, valueNoise2D } from '../core/noise.js';

/**
 * Visibility is where a dark object fades to 5% contrast: an optical depth
 * of ln(20) = 3.0 along the line of sight (Koschmieder). The game's fog is
 * FogExp2, factor 1 - exp(-(d·D)²), plus the height fog (render/height-fog.js),
 * optical depth a·D at the surface; at the visibility the two add to 3.
 */
export const VIS_OD = Math.log(20);

/** The FogExp2 density that gives `visM` on its own. */
export function densityForVisibility(visM) {
  return Math.sqrt(VIS_OD) / Math.max(50, visM);
}

/**
 * The fog that gives a surface visibility `visM`, `mist` of it lying low
 * in a layer `mistH` deep: { fog (FogExp2 density), hfA (height fog
 * extinction at sea level, 1/m), hfH (its scale height, m) }.
 */
export function fogFor(visM, mist = 0, mistH = 150) {
  const V = Math.max(50, visM);
  const m = Math.min(0.97, Math.max(0, mist));
  return {
    fog: Math.sqrt(VIS_OD * (1 - m)) / V,
    hfA: (VIS_OD * m) / V,
    hfH: Math.max(20, mistH),
  };
}

/**
 * Visibility (metres) at height `altM` above the sea in weather `c` — the
 * inverse of fogFor, read from the fog the renderer actually draws, so a
 * disaster's fog bank (weather.js temporaryCondition overrides `fog`) is
 * read as what it looks like. Solves (d·V)² + a·V = 3 for V.
 */
export function visibilityAt(c, altM = 0) {
  if (!c) return 60000;
  const d = Math.max(0, c.fog || 0);
  const a = Math.max(0, c.hfA || 0) * Math.exp(-Math.max(-50, altM) / Math.max(20, c.hfH || 150));
  let V;
  if (d < 1e-9) V = a > 1e-12 ? VIS_OD / a : 99999;
  else V = (-a + Math.sqrt(a * a + 4 * d * d * VIS_OD)) / (2 * d * d);
  return Math.max(30, Math.min(99999, V));
}

/* ------------------------------------------------------------------ phases */

const RAW = {
  clear:     { label: 'Clear', word: 'clear skies', cloud: 0.08, cu: 0.1, cirrus: 0.25, visM: 60000, haze: 0.05, turb: 0.1, gust: 0.1, base: 1250, windMul: 0.95 },
  fair:      { label: 'Fair', word: 'fair-weather cumulus', cloud: 0.24, cu: 0.42, cirrus: 0.3, visM: 45000, haze: 0.1, turb: 0.16, gust: 0.14, base: 1150, windMul: 1 },
  scattered: { label: 'Scattered cloud', word: 'scattered cloud', cloud: 0.42, cu: 0.68, tcu: 0.12, cirrus: 0.2, visM: 30000, haze: 0.1, turb: 0.26, gust: 0.22, base: 1050, windMul: 1.05 },
  broken:    { label: 'Broken cloud', word: 'broken cloud', cloud: 0.62, cu: 0.8, tcu: 0.28, stratus: 0.3, cirrus: 0.1, visM: 20000, haze: 0.05, turb: 0.34, gust: 0.28, base: 950, windMul: 1.15 },
  overcast:  { label: 'Overcast', word: 'overcast', cloud: 0.84, cu: 0.25, stratus: 0.95, visM: 12000, mist: 0.15, mistH: 300, turb: 0.3, gust: 0.25, base: 760, windMul: 1.1 },
  showers:   { label: 'Showers', word: 'showers', cloud: 0.76, cu: 0.75, tcu: 0.65, cb: 0.2, stratus: 0.25, scud: 0.3, rain: 0.42, visM: 7000, mist: 0.2, mistH: 250, turb: 0.5, gust: 0.42, base: 820, windMul: 1.3 },
  rain:      { label: 'Light rain', word: 'light rain', cloud: 0.88, cu: 0.2, stratus: 1, scud: 0.55, rain: 0.5, visM: 5000, mist: 0.3, mistH: 250, turb: 0.42, gust: 0.35, base: 620, windMul: 1.2 },
  heavyRain: { label: 'Heavy rain', word: 'heavy rain', cloud: 0.95, cu: 0.15, tcu: 0.3, cb: 0.3, stratus: 1, scud: 0.8, rain: 0.85, visM: 2800, mist: 0.3, mistH: 250, turb: 0.62, gust: 0.5, base: 520, windMul: 1.4 },
  storm:     { label: 'Thunderstorm', word: 'thunderstorm', cloud: 1, cu: 0.3, tcu: 0.6, cb: 1, stratus: 0.7, scud: 0.8, rain: 1, visM: 2200, mist: 0.25, mistH: 250, turb: 1, gust: 0.75, base: 540, windMul: 1.75, storm: 1 },
  cells:     { label: 'Storms in the distance', word: 'storm cells in the distance', cloud: 0.46, cu: 0.55, tcu: 0.55, cb: 0.7, cirrus: 0.35, visM: 25000, haze: 0.15, turb: 0.3, gust: 0.25, base: 1000, windMul: 1.1 },
  clearing:  { label: 'Clearing', word: 'clearing', cloud: 0.34, cu: 0.55, stratus: 0.1, cirrus: 0.2, visM: 35000, turb: 0.2, gust: 0.18, base: 1100, windMul: 1 },
  haze:      { label: 'Haze', word: 'haze', cloud: 0.14, cu: 0.15, cirrus: 0.3, visM: 8000, mist: 0.35, mistH: 900, haze: 0.85, turb: 0.1, gust: 0.08, base: 1300, windMul: 0.7 },
  mist:      { label: 'Mist', word: 'mist', cloud: 0.25, cu: 0.1, stratus: 0.15, visM: 3000, mist: 0.9, mistH: 120, haze: 0.3, turb: 0.06, gust: 0.04, base: 900, windMul: 0.45 },
  fog:       { label: 'Fog', word: 'fog', cloud: 0.4, stratus: 0.3, visM: 900, mist: 0.95, mistH: 110, haze: 0.2, turb: 0.04, gust: 0.03, base: 700, windMul: 0.3 },
  snow:      { label: 'Snow', word: 'snow', cloud: 0.88, cu: 0.15, stratus: 0.95, scud: 0.4, snow: 0.6, visM: 2500, mist: 0.2, mistH: 300, turb: 0.34, gust: 0.3, base: 600, windMul: 1.15 },
  snowShowers: { label: 'Snow showers', word: 'snow showers', cloud: 0.7, cu: 0.65, tcu: 0.4, stratus: 0.25, snow: 0.4, visM: 5000, mist: 0.15, mistH: 300, turb: 0.42, gust: 0.4, base: 750, windMul: 1.3 },
};

/** Every number a phase carries, and what it is when a phase leaves it out. */
const KEYS = ['cloud', 'cu', 'tcu', 'cb', 'stratus', 'cirrus', 'scud', 'rain', 'snow', 'visM', 'mist', 'mistH', 'haze', 'turb', 'gust', 'base', 'windMul', 'storm'];
const DEFAULTS = { cloud: 0, cu: 0, tcu: 0, cb: 0, stratus: 0, cirrus: 0, scud: 0, rain: 0, snow: 0, visM: 40000, mist: 0, mistH: 150, haze: 0, turb: 0.1, gust: 0.1, base: 1100, windMul: 1, storm: 0 };

export const PHASES = Object.freeze(Object.fromEntries(Object.entries(RAW).map(([id, p]) => [id, Object.freeze({ id, ...DEFAULTS, ...p })])));
export const PHASE_IDS = Object.keys(PHASES);

/** The older code's four words, for anything that asks "is it stormy". */
export function bucketOf(c) {
  if (!c) return 'clear';
  if ((c.storm || 0) > 0.5) return 'stormy';
  if ((c.rain || 0) > 0.25 || (c.snow || 0) > 0.3) return 'rainy';
  if ((c.cloud || 0) > 0.5 || (c.visM || 99999) < 5000) return 'cloudy';
  return 'clear';
}

/**
 * Fill in the derived fields of a weather (the fog the renderer draws, the
 * older names) — in place, so the per-frame blend allocates nothing.
 */
export function finishCond(c) {
  const f = fogFor(c.visM, c.mist, c.mistH);
  c.fog = f.fog;
  c.hfA = f.hfA;
  c.hfH = f.hfH;
  c.cloudBase = c.base;
  c.bucket = bucketOf(c);
  return c;
}

/* ---------------------------------------------------------------- climates */

/**
 * What kind of place this is, from the map's own description: 'tropical',
 * 'cold', 'arid' or 'temperate'. The World Map's regions say it outright
 * (preview-data.js `band`).
 */
export function climateFor(map, region = null) {
  if (region && region.band) {
    if (/cold|arctic|polar/i.test(region.band)) return 'cold';
    if (/trop/i.test(region.band)) return 'tropical';
    if (/arid|desert/i.test(region.band)) return 'arid';
    return 'temperate';
  }
  if (!map) return 'temperate';
  if (map.precip === 'snow') return 'cold';
  const t = `${map.subtitle || ''} ${map.id || ''}`;
  if (/arctic|cold|snow|fjord|frozen|ice\b/i.test(t)) return 'cold';
  if (/desert|arid/i.test(t)) return 'arid';
  if (/tropic|reef|atoll|cay|lagoon|palm/i.test(t)) return 'tropical';
  return 'temperate';
}

/** Rain where it is cold falls as snow; nothing else changes. */
function localise(id, climate) {
  if (climate !== 'cold') {
    if (id === 'snow') return 'rain';
    if (id === 'snowShowers') return 'showers';
    return id;
  }
  if (id === 'rain' || id === 'heavyRain') return 'snow';
  if (id === 'showers') return 'snowShowers';
  if (id === 'storm') return 'snow';
  return id;
}

/** Pick a key from { key: weight } with the random number `u` (0..1). */
function pick(weights, u) {
  let total = 0;
  for (const k in weights) total += Math.max(0, weights[k]);
  let x = u * total;
  for (const k in weights) {
    const w = Math.max(0, weights[k]);
    if (x < w) return k;
    x -= w;
  }
  return Object.keys(weights)[0];
}

/**
 * The first phase of a flight. Mostly fair; the rest rarer, and weighted by
 * the place and the time of day — mist at night and early in the day, haze
 * in the evening, showers and far-off cells in the tropics, no fog in the
 * desert, snow only where it is cold (localise()).
 */
export function startWeights(climate = 'temperate', time = 'day') {
  const w = { clear: 18, fair: 30, scattered: 17, broken: 8, overcast: 6, showers: 4, rain: 3, heavyRain: 1, cells: 4, haze: 4, mist: 4, fog: 1 };
  if (time === 'night') { w.mist += 4; w.fog += 2; w.haze = 0; w.cells += 1; }
  if (time === 'sunset') { w.haze += 5; w.mist += 2; }
  if (climate === 'tropical') { w.showers += 5; w.cells += 4; w.fog = 0; w.mist = Math.max(0, w.mist - 2); w.overcast -= 2; }
  if (climate === 'cold') { w.overcast += 5; w.rain += 3; w.haze = 0; w.cells = 0; w.fog += 1; }
  if (climate === 'arid') { w.clear += 14; w.haze += 6; w.fog = 0; w.mist = 0; w.rain = 1; w.heavyRain = 0; w.overcast = 2; }
  return w;
}

/** What may follow each phase, and how likely. The sky's story. */
export function nextWeights(id, climate = 'temperate', time = 'day') {
  const T = {
    clear: { fair: 5, scattered: 2, haze: 1.5, mist: 0.6 },
    fair: { scattered: 4.5, clear: 2, haze: 1, cells: 1, clearing: 0.5 },
    scattered: { broken: 3.5, fair: 3, showers: 2, cells: 1.5 },
    broken: { showers: 3.5, overcast: 3, scattered: 2.5, cells: 1 },
    overcast: { rain: 3.5, broken: 3, clearing: 2.5, mist: 1 },
    showers: { clearing: 4.5, broken: 2.5, rain: 1.5, storm: 0.8 },
    rain: { clearing: 3.5, overcast: 3.5, showers: 2, heavyRain: 1, mist: 1 },
    heavyRain: { rain: 4, showers: 3, clearing: 2 },
    storm: { showers: 5, clearing: 5 },
    cells: { scattered: 4, showers: 3, fair: 3 },
    clearing: { fair: 5, scattered: 3, haze: 2 },
    haze: { fair: 4, scattered: 4, mist: 1.5 },
    mist: { clearing: 4, fair: 4, haze: 2 },
    fog: { mist: 6, clearing: 4 },
    snow: { overcast: 5, clearing: 3, snowShowers: 2 },
    snowShowers: { clearing: 4, overcast: 3, snow: 2 },
  };
  const w = { ...(T[id] || T.fair) };
  // Evening: haze and mist settle in as the air cools.
  // Fog only thickens out of something already murky (mist, haze, rain, a low deck) — never out of a clear sky.
  if (time === 'sunset' || time === 'night') {
    if (w.mist != null) w.mist += 1.5;
    if (w.haze != null) w.haze += 1;
    if (PHASES[id] && PHASES[id].visM <= 12000) w.fog = (w.fog || 0) + (time === 'night' ? 0.6 : 0.3);
  }
  if (climate === 'tropical') { if (w.showers != null) w.showers += 1.5; delete w.fog; }
  if (climate === 'arid') { delete w.fog; delete w.mist; if (w.rain != null) w.rain *= 0.3; if (w.showers != null) w.showers *= 0.4; w.clear = (w.clear || 0) + 2; }
  if (climate === 'cold') { delete w.haze; delete w.storm; delete w.cells; }
  return w;
}

/* ---------------------------------------------------------------- the clock */

/** A phase lasts 8 to 20 minutes (a storm, 5 to 9), and blends for 2 to 3. */
export const PHASE_MIN_S = 480;
export const PHASE_MAX_S = 1200;
export const STORM_MAX_S = 540;
export const BLEND_MIN_S = 120;
export const BLEND_MAX_S = 180;
/**
 * A change that thickens the murk blends more slowly: never faster than the
 * visibility halving in a minute — MURK_BLEND_PER_LN seconds per e-fold of
 * the drop, up to MURK_BLEND_MAX_S (seven and a half minutes).
 */
export const MURK_BLEND_PER_LN = 140;
export const MURK_BLEND_MAX_S = 450;
/** Notice of a change before its blend starts, and more for murk. */
export const WARN_S = 120;
export const WARN_MURK_S = 180;
/** The longest a change that thickens the murk is held off for an approach. */
export const HOLD_MAX_S = 900;

function phaseDuration(id, rng) {
  if (id === 'storm') return 300 + rng() * (STORM_MAX_S - 300);
  return PHASE_MIN_S + rng() * (PHASE_MAX_S - PHASE_MIN_S);
}

const smooth = (k) => k * k * (3 - 2 * k);

/** Does going from a to b thicken the murk enough to be unfair on an approach? */
export function murkier(a, b) {
  return b.visM < 8000 && b.visM < a.visM * 0.7;
}

/** Blend two phases (or blended conds) into `out`, visibility in log space. */
export function blendInto(out, a, b, k) {
  for (const key of KEYS) {
    if (key === 'visM') out.visM = Math.exp(Math.log(a.visM) + (Math.log(b.visM) - Math.log(a.visM)) * k);
    else out[key] = a[key] + (b[key] - a[key]) * k;
  }
  out.label = k < 0.5 ? a.label : b.label;
  out.word = k < 0.5 ? a.word : b.word;
  out.phase = k < 0.5 ? a.id || a.phase : b.id || b.phase;
  return finishCond(out);
}

/**
 * One place's weather over time: a phase, the next one, and the blend.
 * `update(dt, hold)` with dt in SIM seconds (the sim rate counts); `hold`
 * true while the player is on an approach — a change that thickens the murk
 * waits until they are down or away (up to HOLD_MAX_S), always after a
 * warning.
 */
export class WxTimeline {
  constructor(seed, { climate = 'temperate', time = 'day', start = null } = {}) {
    this.seed = seed >>> 0;
    this.climate = climate;
    this.time = time;
    this.rng = makeRandom(this.seed ^ 0x9e3779b9);
    const first = start && PHASES[start] ? start : localise(pick(startWeights(climate, time), this.rng()), climate);
    this.phase = first;
    this.next = this._pickNext(first);
    // A flight joins the day partway through a phase, so the first change is not always the same minutes away.
    this.dur = phaseDuration(first, this.rng);
    this.t = this.dur * (0.15 + this.rng() * 0.45);
    this.blendDur = this._blendFor(this.phase, this.next);
    this.k = 0;
    this.held = 0;
    this.warned = false;
    this.cond = blendInto({}, PHASES[this.phase], PHASES[this.phase], 0);
    /** Every phase this place has been in, oldest first. */
    this.history = [this.phase];
  }

  /** 2 to 3 minutes; a thickening murk longer (MURK_BLEND_PER_LN), so fog never rolls in at once. */
  _blendFor(a, b) {
    const base = BLEND_MIN_S + this.rng() * (BLEND_MAX_S - BLEND_MIN_S);
    const A = PHASES[a];
    const B = PHASES[b];
    if (!A || !B || B.visM >= A.visM) return base;
    return Math.max(base, Math.min(MURK_BLEND_MAX_S, Math.log(A.visM / B.visM) * MURK_BLEND_PER_LN));
  }

  _pickNext(id) {
    return localise(pick(nextWeights(id, this.climate, this.time), this.rng()), this.climate);
  }

  /** Seconds of notice the next change gets. */
  get warnS() {
    return murkier(PHASES[this.phase], PHASES[this.next]) ? WARN_MURK_S : WARN_S;
  }

  /** Seconds until the next change starts to blend in (0 while it blends). */
  get etaS() {
    return Math.max(0, this.dur - this.t);
  }

  /**
   * Advance. Returns the news, if any: { kind: 'soon' | 'start' | 'done',
   * from, to, inS, murk }.
   */
  update(dt, hold = false) {
    let news = null;
    const from = PHASES[this.phase];
    const to = PHASES[this.next];
    const murk = murkier(from, to);
    const holding = hold && murk && this.held < HOLD_MAX_S;
    if (this.k <= 0) {
      if (holding && this.t + dt >= this.dur) {
        // On an approach: keep it at the warning's end, and say so once.
        this.held += dt;
        this.t = Math.min(this.t, this.dur);
      } else {
        this.t += dt;
      }
      if (!this.warned && this.t >= this.dur - this.warnS) {
        this.warned = true;
        news = { kind: 'soon', from: from.id, to: to.id, inS: Math.max(0, this.dur - this.t), murk };
      }
      if (this.t >= this.dur) {
        // Never start without the warning first.
        if (!this.warned) {
          this.warned = true;
          this.t = this.dur - this.warnS;
          return { kind: 'soon', from: from.id, to: to.id, inS: this.warnS, murk };
        }
        this.k = 1e-6;
        news = { kind: 'start', from: from.id, to: to.id, inS: 0, murk };
      }
    } else if (holding) {
      this.held += dt;
    } else {
      this.k = Math.min(1, this.k + dt / this.blendDur);
      if (this.k >= 1) {
        this.phase = this.next;
        this.history.push(this.phase);
        this.next = this._pickNext(this.phase);
        this.dur = phaseDuration(this.phase, this.rng);
        this.blendDur = this._blendFor(this.phase, this.next);
        this.t = 0;
        this.k = 0;
        this.held = 0;
        this.warned = false;
        news = { kind: 'done', from: from.id, to: this.phase, inS: 0, murk };
      }
    }
    blendInto(this.cond, PHASES[this.phase], PHASES[this.next], this.k > 0 ? smooth(this.k) : 0);
    return news;
  }
}

/* ------------------------------------------------------------ the whole sky */

/** A 32-bit hash of a seed and a name, for each region's own timeline. */
export function hashSeed(seed, name = '') {
  let h = (seed >>> 0) ^ 0x811c9dc5;
  const s = String(name);
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 13)) >>> 0;
}

/** A fresh seed for a flight. */
export function newSeed() {
  return (Math.random() * 4294967296) >>> 0;
}

/** The rolled sky's strongest wind, kt: a mean of 30 at most, gusts at most 18 over it and 45 in all. */
export const WIND_MAX_KTS = 30;
export const GUST_SPREAD_MAX_KTS = 18;
export const GUST_MAX_KTS = 45;

/** How far a region's weather reaches, metres: by twice this the next one has it. */
const REGION_REACH = 70000;
/** Fronts move with the wind at this fraction of it (they are slow). */
const FRONT_DRIFT = 0.5;

/**
 * The weather of a whole map. One place on an ordinary map; on the World Map
 * one timeline per region, blended by distance, the lot drifting downwind
 * (fronts across the sea) — so flying far is flying into different weather.
 *
 *   new WxSystem({ seed, climate, time, windKts, windDirDeg, regions })
 *     regions: [{ id, cx, cz, band? , name? }] or none for one place
 *   update(dt, { x, z, hold })   once a frame; returns news or null
 *   cond                         the weather where the player is (blended)
 *   at(x, z, out)                the weather anywhere (the live map's icons)
 *   wind                         { dirDeg, kts, gustKts } where the player is
 */
export class WxSystem {
  constructor({ seed = newSeed(), climate = 'temperate', time = 'day', windKts = 8, windDirDeg = 250, regions = null } = {}) {
    this.seed = seed >>> 0;
    this.climate = climate;
    this.time = time;
    const rng = makeRandom(hashSeed(this.seed, 'wind'));
    // The day's wind: the map's prevailing direction, give or take, and a speed round its usual one.
    this.baseDir = (((windDirDeg + (rng() * 2 - 1) * 45) % 360) + 360) % 360;
    this.baseKts = Math.max(3, Math.min(22, windKts * (0.55 + rng() * 0.8)));
    // A gusty day, now and then.
    this.gusty = rng() < (climate === 'cold' ? 0.3 : 0.2);
    this.veer = (rng() * 2 - 1) * 25;
    this.regions = (regions && regions.length ? regions : [{ id: 'local', cx: 0, cz: 0, band: null }]).map((r) => ({
      id: r.id, name: r.name || r.id, cx: r.cx || 0, cz: r.cz || 0,
      climate: r.band ? climateFor(null, r) : climate,
    }));
    this.lines = this.regions.map((r) => new WxTimeline(this.regions.length === 1 ? hashSeed(this.seed, 'sky') : hashSeed(this.seed, r.id), { climate: r.climate, time }));
    this.t = 0;
    this.drift = { x: 0, z: 0 };
    this.cond = {};
    this.wind = { dirDeg: this.baseDir, kts: this.baseKts, gustKts: this.baseKts };
    this.here = 0;
    this._w = new Float64Array(this.regions.length);
    this.sample(0, 0, this.cond);
    this._windFor(this.cond);
  }

  /** Index of the region whose weather is strongest at (x, z). */
  regionIndexAt(x, z) {
    this._weights(x, z);
    let best = 0;
    for (let i = 1; i < this._w.length; i++) if (this._w[i] > this._w[best]) best = i;
    return best;
  }

  _weights(x, z) {
    const w = this._w;
    if (w.length === 1) { w[0] = 1; return w; }
    // Sample upwind: the weather a point has now is what was upwind of it.
    const px = x - this.drift.x;
    const pz = z - this.drift.z;
    let sum = 0;
    for (let i = 0; i < this.regions.length; i++) {
      const r = this.regions[i];
      const d = Math.hypot(px - r.cx, pz - r.cz) / REGION_REACH;
      w[i] = Math.exp(-d * d) + 1e-9;
      sum += w[i];
    }
    for (let i = 0; i < w.length; i++) w[i] /= sum;
    return w;
  }

  /** The weather at (x, z), into `out`. */
  sample(x, z, out = {}) {
    const w = this._weights(x, z);
    if (w.length === 1) {
      const c = this.lines[0].cond;
      for (const k of KEYS) out[k] = c[k];
      out.label = c.label; out.word = c.word; out.phase = c.phase;
      return finishCond(out);
    }
    let logVis = 0;
    for (const k of KEYS) out[k] = 0;
    let bi = 0;
    for (let i = 0; i < w.length; i++) {
      const c = this.lines[i].cond;
      for (const k of KEYS) if (k !== 'visM') out[k] += c[k] * w[i];
      logVis += Math.log(c.visM) * w[i];
      if (w[i] > w[bi]) bi = i;
    }
    out.visM = Math.exp(logVis);
    const top = this.lines[bi].cond;
    out.label = top.label; out.word = top.word; out.phase = top.phase;
    out.region = this.regions[bi].id;
    return finishCond(out);
  }

  /** The weather anywhere — the live map's per-region icons. */
  at(x, z, out = {}) {
    return this.sample(x, z, out);
  }

  _windFor(c) {
    // A storm on a windy map (Ravencrag, Stormcoast: 24 kt) was 38 kt gusting 72 — past what the
    // fixed Stormy sky ever blows, and no light aeroplane's day out. A gale, at most, gusting 45.
    const k = Math.min(WIND_MAX_KTS, this.baseKts * c.windMul);
    const spread = Math.min(GUST_SPREAD_MAX_KTS, (this.gusty ? 8 : 0) + k * c.gust * 0.9);
    this.wind.kts = k;
    this.wind.gustKts = Math.min(GUST_MAX_KTS, k + spread);
    this.wind.dirDeg = (((this.baseDir + this.veer * Math.sin(this.t / 1800)) % 360) + 360) % 360;
    return this.wind;
  }

  /**
   * Advance every place's weather by dt sim seconds. `obs`: where the player
   * is and whether they are on an approach (the murk waits for them).
   */
  update(dt, obs = {}) {
    this.t += dt;
    let news = null;
    const x = obs.x || 0;
    const z = obs.z || 0;
    this.here = this.regionIndexAt(x, z);
    for (let i = 0; i < this.lines.length; i++) {
      // Only the place the player is in waits for their approach; the others go on.
      const n = this.lines[i].update(dt, !!obs.hold && i === this.here);
      if (n && i === this.here) news = { ...n, region: this.regions[i].id, regionName: this.regions[i].name };
    }
    // Fronts drift downwind (the wind blows TOWARDS dir + 180).
    if (this.lines.length > 1) {
      const sp = this.baseKts * 0.514444 * FRONT_DRIFT * dt;
      const from = (this.baseDir * Math.PI) / 180;
      this.drift.x += -Math.sin(from) * sp;
      this.drift.z += Math.cos(from) * sp;
    }
    this.sample(x, z, this.cond);
    this._windFor(this.cond);
    return news;
  }

  /** What is coming where the player is: { to, label, inS, murk } or null. */
  forecast() {
    const L = this.lines[this.here];
    if (!L) return null;
    const to = PHASES[L.next];
    return { from: L.phase, to: L.next, label: to.label, word: to.word, inS: L.k > 0 ? 0 : L.etaS, blending: L.k > 0, murk: murkier(PHASES[L.phase], to), warned: L.warned };
  }

  /**
   * The weather `km` ahead along `hdgDeg` (0 north, 90 east), if it is
   * clearly worse than here: { word, label, km, visM, rain } or null.
   */
  ahead(x, z, hdgDeg, km = 35, out = {}) {
    if (this.lines.length === 1) return null;
    const r = (hdgDeg * Math.PI) / 180;
    const c = this.sample(x + Math.sin(r) * km * 1000, z - Math.cos(r) * km * 1000, out);
    const h = this.cond;
    const worse = (c.rain + c.snow > h.rain + h.snow + 0.25) || c.visM < h.visM * 0.45 || (c.cb > 0.6 && h.cb < 0.3) || (c.storm > 0.5 && h.storm < 0.5);
    return worse ? { word: c.word, label: c.label, km, visM: c.visM, rain: c.rain, snow: c.snow } : null;
  }
}

/* --------------------------------------------------------------- the words */

/** "3 km", "900 metres", "10 km or more". */
export function visibilityPhrase(visM) {
  if (visM >= 10000) return '10 km or more';
  if (visM >= 5000) return `${Math.round(visM / 1000)} km`;
  if (visM >= 1500) return `${(Math.round(visM / 500) * 500 / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} km`;
  return `${Math.max(100, Math.round(visM / 100) * 100)} metres`;
}

/** What is cutting the visibility: "in mist", "in fog", "in rain", "in snow", "in haze". */
export function obscuredBy(c) {
  if (!c) return '';
  if ((c.snow || 0) > 0.15) return 'in snow';
  if ((c.rain || 0) > 0.15) return 'in rain';
  if (c.visM < 1000 && (c.mist || 0) > 0.5) return 'in fog';
  if ((c.mist || 0) > 0.5) return 'in mist';
  if ((c.haze || 0) > 0.5) return 'in haze';
  return '';
}

/** "visibility 3 km in mist" — or '' when it is 10 km or more and nothing is in the way. */
export function visibilityWords(c, visM = c ? c.visM : 99999) {
  if (visM >= 10000) return '';
  const why = obscuredBy(c);
  return `visibility ${visibilityPhrase(visM)}${why ? ` ${why}` : ''}`;
}

/**
 * "wind 240 at 14 gusting 22" (radio: digits spoken one at a time, "wind
 * 2 4 0 at 14 gusting 22"). Gusts are reported when they run 7 kt or more
 * over the mean (a METAR's rule is 10; the game's winds are gentler).
 */
export function windWords(dirDeg, kts, gustKts = kts, { radio = false } = {}) {
  const k = Math.round(kts);
  if (k < 1) return 'wind calm';
  const d3 = String(Math.round(dirDeg / 10) * 10 % 360 || 360).padStart(3, '0');
  const dir = radio ? d3.split('').join(' ') : d3;
  const g = Math.round(gustKts);
  return `wind ${dir} at ${k}${g - k >= 7 ? ` gusting ${g}` : ''}`;
}

/** "Showers in ~2 min" — the HUD's notice of a change. */
export function changeWords(fc) {
  if (!fc) return '';
  if (fc.blending) return `Weather changing: ${fc.word} moving in`;
  const m = Math.max(1, Math.round(fc.inS / 60));
  return `Weather changing: ${fc.word} in ~${m} min`;
}

/** The fog-bank mottle: 0..1 at (x, z), kilometres across, for "fog banks you fly out of". */
export function bankAt(x, z, seed = 0) {
  return valueNoise2D(x / 5200, z / 5200, seed & 1023) * 0.65 + valueNoise2D(x / 1900, z / 1900, (seed + 7) & 1023) * 0.35;
}

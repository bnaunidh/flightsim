/**
 * The sun and the air — pure functions, no three.js.
 *
 * WHERE THE SUN IS (L1 of the rival brief): a latitude for each map and a day
 * of the year give the solar declination, 23.44° × sin(360°·(284 + day)/365);
 * the hour angle is 15° an hour from solar noon; elevation and azimuth follow
 * from the standard spherical-astronomy formulas. The three fixed suns the
 * game had (midday 62°, sunset 4.5°, night −14°) are now the elevations the
 * presets AIM for: hourForElevation() finds the afternoon hour that puts the
 * sun there on this map on this day, so a mission that asks for 'sunset' gets
 * the same low sun it always did, and any hour in between is real.
 *
 * WHAT THE SUN LOOKS LIKE (L2): sunlight crosses more air as the sun drops.
 * Air mass by Kasten–Young; each colour channel dimmed by exp(−m·τ), with
 * Rayleigh's λ⁻⁴ (blue lost ~5× faster than red), a grey Mie haze term that
 * grows with the weather's haze, and a little ozone so twilight stays blue.
 * The result drives the directional light's colour and strength, and the
 * sky's zenith, horizon, sky-bounce and ground-bounce colours are blended
 * from it by elevation, calibrated so that at the three preset elevations
 * they land on the colours the game's palettes had (weather.js palette()).
 * Everything is CPU, once a frame, a few dozen multiplies.
 *
 * Game convention for azimuth: compass bearing, degrees clockwise from north.
 * weather.js turns that into a direction (east = +x, north = −z).
 */

const DEG = Math.PI / 180;

/** Twilight bands, degrees of sun elevation. */
export const TWILIGHT = Object.freeze({ civil: -6, nautical: -12, astronomical: -18 });

/**
 * A map's latitude when it does not say (maps.js `latitude`): by climate
 * (world/wx.js climateFor). Chosen so that an autumn midday is still a day:
 * at 56° on 31 October the noon sun is 20° up, in June 57°.
 */
export const LATITUDE_BY_CLIMATE = Object.freeze({ cold: 56, temperate: 46, arid: 33, tropical: 12 });

/** The reference elevations the three presets aim for (the game's old fixed suns). */
export const PRESET_ELEVATION = Object.freeze({ day: 62, sunset: 4.5, night: -14 });

export function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
export function smooth(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];

/** Day of the year, 1..366, of a time in ms (local date). */
export function dayOfYearOf(ms = Date.now()) {
  const d = new Date(ms);
  const start = new Date(d.getFullYear(), 0, 1);
  return Math.floor((d - start) / 86400000) + 1;
}

/** Solar declination in degrees for a day of the year. */
export function solarDeclinationDeg(day) {
  return 23.44 * Math.sin(((284 + day) / 365) * 2 * Math.PI);
}

/**
 * Where the sun is: { elevDeg, azimDeg } for a latitude (degrees, north
 * positive), a day of the year and a local solar hour (0..24, 12 = noon).
 * azimDeg is the compass bearing of the sun, clockwise from north.
 */
export function sunPosition(latDeg, day, hour) {
  const lat = latDeg * DEG;
  const decl = solarDeclinationDeg(day) * DEG;
  const H = (hour - 12) * 15 * DEG;
  const sinEl = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const elev = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // atan2 of the hour angle's sine against the latitude/declination term, from south; +180 puts north at 0.
  let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / DEG + 180;
  az = ((az % 360) + 360) % 360;
  return { elevDeg: elev / DEG, azimDeg: az };
}

/** The sun's highest and lowest elevations of the day (noon and midnight). */
export function sunRangeDeg(latDeg, day) {
  return { noon: sunPosition(latDeg, day, 12).elevDeg, midnight: sunPosition(latDeg, day, 24).elevDeg };
}

/**
 * The afternoon hour (12..24) at which the sun stands at `targetDeg` on this
 * day at this latitude. Elevation falls steadily from noon to midnight, so a
 * bisection finds it; a target above noon's sun gives 12 (noon), one below
 * midnight's gives 24 (midnight).
 */
export function hourForElevation(latDeg, day, targetDeg) {
  const r = sunRangeDeg(latDeg, day);
  if (targetDeg >= r.noon) return 12;
  if (targetDeg <= r.midnight) return 24;
  let lo = 12;
  let hi = 24;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (sunPosition(latDeg, day, mid).elevDeg > targetDeg) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** Which of the three words a sun elevation is: 'day', 'sunset' (either twilight) or 'night'. */
export function timeBucket(elevDeg) {
  if (elevDeg > 10) return 'day';
  if (elevDeg > TWILIGHT.civil - 1) return 'sunset';
  return 'night';
}

/** How much daylight there is: 1 with the sun up, fading through civil twilight to 0. */
export function daylight(elevDeg) {
  return smooth(TWILIGHT.civil - 2, 6, elevDeg);
}

/** Relative air mass, Kasten–Young (1989); the sun below the horizon counts as on it. */
export function airMass(elevDeg) {
  const el = Math.max(0, elevDeg);
  return 1 / (Math.sin(el * DEG) + 0.50572 * Math.pow(el + 6.07995, -1.6364));
}

/* Optical depths of one air mass, per channel (red ~680 nm, green ~550 nm, blue ~440 nm). */
const TAU_RAYLEIGH = [0.041, 0.097, 0.243];
/** Mie haze per unit of turbidity, ∝ λ^-1.3 (grey-ish: it dims more than it colours). */
const TAU_MIE_UNIT = [1.65, 2.18, 2.9];
const TAU_OZONE = [0.01, 0.03, 0.003];

/** Direct-sun transmittance per channel at this elevation, `haze` 0 (clean) .. 1 (hazy). */
export function sunTransmittance(elevDeg, haze = 0) {
  const m = airMass(elevDeg);
  const beta = 0.04 + 0.14 * clamp01(haze);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) out[i] = Math.exp(-m * (TAU_RAYLEIGH[i] + beta * TAU_MIE_UNIT[i] + TAU_OZONE[i]));
  return out;
}
const T_ZENITH = sunTransmittance(90, 0);
const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/*
 * The palette's own colours at the three old suns, as the calibration points
 * (0..1 linear-ish, the hex the palettes had): the model lands on these at
 * 62°, 4.5° and −14° and is continuous in between.
 */
const REF = {
  sunWhite: [1, 0.957, 0.878], // 0xfff4e0: the day sun's own warmth
  zenithDay: [0.184, 0.435, 0.816], // 0x2f6fd0
  zenithLow: [0.141, 0.259, 0.478], // 0x24427a
  zenithNight: [0.016, 0.039, 0.094], // 0x040a18
  horizonDay: [0.737, 0.843, 0.949], // 0xbcd7f2
  horizonNight: [0.071, 0.114, 0.2], // 0x121d33
  ambientDay: [0.624, 0.722, 0.847], // 0x9fb8d8
  ambientNight: [0.165, 0.227, 0.333], // 0x2a3a55
  groundDay: [0.353, 0.42, 0.322], // 0x5a6b52
  groundNight: [0.043, 0.063, 0.094], // 0x0b1018
  moon: [0.616, 0.706, 0.847], // 0x9db4d8: the night's stand-in light
};

/**
 * The sun's light: { color [r,g,b] (max channel 1), intensity } for the
 * directional light. White-balanced against the zenith sun, then the
 * transmittance's colour is softened (pow 0.5: the sky fills in some of what
 * the air takes from the beam), so a 4.5° sun is orange (about 2500 K), not
 * blood red.
 * Intensity follows the transmitted luminance gently (pow 0.35, exposure
 * does the rest), rises over the first degrees and is gone a degree under.
 */
export function sunLight(elevDeg, { haze = 0 } = {}) {
  const T = sunTransmittance(elevDeg, haze);
  const rel = [T[0] / T_ZENITH[0], T[1] / T_ZENITH[1], T[2] / T_ZENITH[2]];
  const soft = rel.map((v) => Math.pow(Math.max(1e-4, v), 0.5));
  const peak = Math.max(soft[0], soft[1], soft[2]);
  const color = [(soft[0] / peak) * REF.sunWhite[0], (soft[1] / peak) * REF.sunWhite[1], (soft[2] / peak) * REF.sunWhite[2]];
  // Rising over the first degrees (a sun half-set is half a sun), gone a degree under.
  const up = smooth(-1, 3.5, elevDeg);
  const intensity = 3.2 * Math.pow(Math.max(1e-4, lum(rel)), 0.35) * up;
  return { color, intensity, transmittance: rel };
}

/**
 * Moonlight as the night's light: colour REF.moon, strength by how dark it is
 * and how full the moon (0 new .. 1 full). 0.38 at full moon in deep night,
 * which is what the night palette gave its 'sun'.
 */
export function moonLight(elevDeg, phase = 1) {
  const dark = 1 - daylight(elevDeg);
  return { color: REF.moon.slice(), intensity: 0.38 * (0.35 + 0.65 * clamp01(phase)) * dark };
}

/**
 * The sky's light at this sun: { zenith, horizon, ambient, ground, ambIntensity,
 * daylight, lowness } — colours as [r,g,b]. `lowness` is how near the horizon
 * the sun is (1 at the horizon, 0 from 25° up): the horizon, the sky-bounce
 * and the ground-bounce take the sun's own colour as it drops.
 */
export function skyLight(elevDeg, { haze = 0 } = {}) {
  const d = daylight(elevDeg);
  const high = smooth(0, 30, elevDeg);
  const lowness = 1 - smooth(0, 25, elevDeg);
  // The sky is lit along higher paths than the beam to the eye: the warmth it takes is the sun's from 5° higher.
  const sun = sunLight(Math.max(elevDeg, 0) + 5, { haze }).color;
  const zenith = mix3(REF.zenithNight, mix3(REF.zenithLow, REF.zenithDay, high), d);
  // The horizon toward a low sun takes the sun's colour (the away side is the dome's uHorizonAway).
  const warmH = [sun[0] * 0.96, sun[1] * 0.96, sun[2] * 0.96];
  const horizon = mix3(REF.horizonNight, mix3(REF.horizonDay, warmH, 0.85 * lowness), d);
  const warmA = mix3(REF.ambientDay, sun, 0.62);
  const ambient = mix3(REF.ambientNight, mix3(REF.ambientDay, warmA, lowness), d);
  // Sunlit ground bounce: the ground's own colour, lit by the low sun (half its tint), a little darker.
  const tint = mix3([1, 1, 1], sun, 0.6);
  const warmG = [REF.groundDay[0] * tint[0] * 0.9, REF.groundDay[1] * tint[1] * 0.9, REF.groundDay[2] * tint[2] * 0.9];
  const ground = mix3(REF.groundNight, mix3(REF.groundDay, warmG, lowness), d);
  const ambIntensity = mix(0.3, mix(1.05, 0.75, lowness), d);
  return { zenith, horizon, ambient, ground, ambIntensity, daylight: d, lowness };
}

/**
 * Tone-mapping exposure from the sun (L5): 1.12 is what the game always ran at,
 * at every preset; dusk gets a lift of up to 0.2 so it is not muddy now that
 * the sun's own strength falls with elevation; overcast takes a little off.
 * Nothing here measures the frame, so it cannot pump or flicker.
 */
export function exposureFor(elevDeg, overcast = 0) {
  const d = daylight(elevDeg);
  const lowness = 1 - smooth(0, 25, elevDeg);
  return 1.12 + 0.2 * lowness * d - 0.06 * clamp01(overcast) * d;
}

/**
 * Aerial perspective, the CPU half (L4): the even fog's density from the
 * eye's height. Haze lives in the lowest kilometre or two of air (the
 * aerosol scale height is about 1.2–2 km), so from 10,000 ft the horizon
 * is clearer than from the ground — there is less air at your level. 1 up
 * to `floorM` (every approach, the weather checks' heights), then falling
 * on a 3 km scale to a floor of 0.4: at 3,000 m the fog is 0.68 of the
 * weather's, at 9,000 m 0.44. Never thicker than the weather says.
 */
export function fogThinning(eyeM, floorM = 700) {
  const h = Math.max(0, (eyeM || 0) - floorM);
  return 0.4 + 0.6 * Math.exp(-h / 3000);
}

/** [r,g,b] → 0xRRGGBB, for logs and tests. */
export function hexOf(c) {
  const b = (v) => Math.round(clamp01(v) * 255);
  return (b(c[0]) << 16) | (b(c[1]) << 8) | b(c[2]);
}

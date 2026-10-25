/**
 * Plain words for the sky, and the three HUD modes.
 *
 * The wind card folds to a chip after a few seconds (hud-stack.js). The chip
 * used to read "4 kt from 090°", which is a number and a bearing, and a
 * ten-year-old reads neither at a glance. The folded card now says what a
 * person would say looking out of the window — "Midday · clear skies · light
 * breeze" — and a tap opens the full card with the rose and the numbers.
 *
 * The HUD has three densities. Clean (the default) folds information away,
 * Full keeps every panel open, and Photo keeps only the warnings, the radio
 * and the dock, for a screenshot or a clean view out of the window. One key
 * and one dock button cycle them; the Settings select picks one directly.
 */

export const DENSITIES = ['full', 'clean', 'photo'];

export const DENSITY_WORDS = {
  full: 'Full HUD — every panel stays open',
  clean: 'Clean HUD — information folds to small chips',
  photo: 'Photo — only the warnings, the radio and the buttons',
};

/** Short label for the dock button. */
export const DENSITY_SHORT = { full: 'Full', clean: 'Clean', photo: 'Photo' };

/** The next mode round: clean → photo → full → clean. */
export function nextDensity(d) {
  const i = DENSITIES.indexOf(d);
  return DENSITIES[(i < 0 ? 1 : i) + 1] || DENSITIES[0];
}

/** Wind speed in knots as a word. Bands from the Beaufort scale, rounded for kids. */
export function windWord(kts) {
  const k = Math.max(0, Number(kts) || 0);
  if (k < 2) return 'calm';
  if (k < 8) return 'light breeze';
  if (k < 15) return 'breezy';
  if (k < 24) return 'windy';
  return 'gale';
}

/** The condition's label (Clear, Cloudy, Rainy, Stormy) as what you would see. */
export function conditionWord(label) {
  switch (String(label || '').toLowerCase()) {
    case 'clear':
      return 'clear skies';
    case 'cloudy':
      return 'cloudy';
    case 'rainy':
      return 'rain';
    case 'stormy':
      return 'storm';
    default:
      return String(label || '').toLowerCase() || 'clear skies';
  }
}

/**
 * "Midday · clear skies · light breeze". The time label comes straight from
 * weather.js (Midday / Sunset / Night); the game has no clock to print.
 */
export function conditionsWords({ timeLabel, condLabel, windKts } = {}) {
  return [timeLabel || 'Midday', conditionWord(condLabel), windWord(windKts)].join(' · ');
}

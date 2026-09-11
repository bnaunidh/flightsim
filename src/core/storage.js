/**
 * Local save data: settings, mission progress and best landing scores.
 * Everything lives in localStorage, so it survives offline and needs no server.
 */

const SETTINGS_KEY = 'islandsim.settings.v1';
const PROGRESS_KEY = 'islandsim.progress.v1';

export const DEFAULT_SETTINGS = {
  quality: 'high',
  // Which of the five places you are flying. See world/maps.js.
  map: 'kestrel',
  flightMode: 'simplified',
  /**
   * 'easy' | 'normal' | 'realistic'. Normal is the game exactly as it has
   * always played, so it stays the default and nobody's scores change meaning.
   * Easy is for someone who has never flown anything; realistic switches the
   * assists off entirely and is the old 'realistic' flight mode.
   */
  difficulty: 'normal',
  volumes: { master: 0.85, engine: 0.8, environment: 0.7, atc: 0.85, alerts: 0.9, music: 0.35 },
  /**
   * On/off per source, separate from the volumes. Turning the ATC slider to
   * zero and forgetting you did it is not the same as switching the radio off,
   * and only one of those is easy to undo.
   */
  soundOn: { engine: true, environment: true, atc: true, alerts: true, music: true },
  // Sound starts off so the game never surprises anyone with noise; there is
  // a one-click toggle on the start screen and in Settings → Sound.
  muted: true,
  music: true,
  subtitles: true,
  reducedMotion: false,
  highContrast: false,
  largeText: false,
  mouseFlying: false,
  invertMouse: false,
  sensitivity: 1,
  gamepad: true,
  showHints: true,
  guidance: true,
  /**
   * How the next objective is shown: 'arrow' points the way, 'beacon' stands a
   * shaft of light on the spot, 'both' does each. An arrow is precise but
   * abstract; a beacon is something you fly towards without thinking. Asked
   * for by a class of twenty-nine, who did not all want the same one.
   */
  guideStyle: 'arrow',
  // Wandering wind with occasional gusts. Off while you are learning.
  randomWinds: false,
  // Flat 1% of the tank every 30 seconds. Off by default.
  realisticFuel: false,
  // Look around the cockpit with the mouse or arrow keys.
  freeLook: false,
  // Free flight begins on the parking stand and you taxi out.
  startAtGate: false,
  // The pilot's-eye cockpit view: narrower field of view, and the flight
  // instruments read off the panel instead of the overlay.
  realisticCockpit: false,
  aircraft: 'skylark',
  /** Which airline paint scheme. 'house' means each type's own colours. */
  livery: 'house',
  atcChatter: true,
  // 'radio' (synthesised, no TTS) | 'speech' (browser TTS) | 'recordings'
  atcVoice: 'radio',
  weather: { time: 'day', condition: 'clear', windSpeedKts: 4, windDirDeg: 90 },
};

export const DEFAULT_PROGRESS = {
  tutorialComplete: false,
  missions: {}, // id -> { complete, bestScore, bestTime }
  bestLanding: null, // { score, vsFpm, date }
  landings: 0,
  flights: 0,
  takeoffs: 0,
  crashes: 0,
  hoursFlown: 0,
};

function deepMerge(base, extra) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k in extra) {
    if (extra[k] && typeof extra[k] === 'object' && !Array.isArray(extra[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], extra[k]);
    } else if (extra[k] !== undefined) {
      out[k] = extra[k];
    }
  }
  return out;
}

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { ...fallback };
    return deepMerge(fallback, JSON.parse(raw));
  } catch (e) {
    console.warn('Could not read saved data — using defaults.', e);
    return { ...fallback };
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    console.warn('Could not save data (storage may be full or blocked).', e);
    return false;
  }
}

export function loadSettings() {
  return read(SETTINGS_KEY, DEFAULT_SETTINGS);
}

export function saveSettings(s) {
  return write(SETTINGS_KEY, s);
}

export function loadProgress() {
  return read(PROGRESS_KEY, DEFAULT_PROGRESS);
}

export function saveProgress(p) {
  return write(PROGRESS_KEY, p);
}

export function recordLanding(progress, grade) {
  progress.landings++;
  if (!grade.crashed && (!progress.bestLanding || grade.score > progress.bestLanding.score)) {
    progress.bestLanding = {
      score: grade.score,
      vsFpm: grade.vsFpm,
      date: new Date().toISOString().slice(0, 10),
    };
  }
  saveProgress(progress);
  return progress;
}

export function recordMission(progress, id, { score = 0, time = 0 } = {}) {
  const prev = progress.missions[id] || { complete: false, bestScore: 0, bestTime: null };
  progress.missions[id] = {
    complete: true,
    bestScore: Math.max(prev.bestScore, score),
    bestTime: prev.bestTime === null ? time : Math.min(prev.bestTime, time),
  };
  saveProgress(progress);
  return progress;
}

/**
 * Saved Free Flight setups.
 *
 * Five slots, because the whole point is picking one at a glance — a list you
 * have to scroll is no faster than setting it up again. Kept apart from the
 * settings blob so that clearing your settings does not throw away your
 * favourite weather.
 */
const PRESETS_KEY = 'islandsim.freepresets.v1';
export const MAX_FREE_PRESETS = 5;

export function loadFreePresets() {
  try {
    const raw = localStorage.getItem(PRESETS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.slice(0, MAX_FREE_PRESETS) : [];
  } catch (e) {
    console.warn('Could not read saved flights — starting with none.', e);
    return [];
  }
}

export function saveFreePresets(list) {
  try {
    localStorage.setItem(PRESETS_KEY, JSON.stringify((list || []).slice(0, MAX_FREE_PRESETS)));
    return true;
  } catch (e) {
    console.warn('Could not save flights (storage may be full or blocked).', e);
    return false;
  }
}

export function resetAll() {
  try {
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem('islandsim.bindings.v1');
  } catch (e) {
    /* ignore */
  }
}

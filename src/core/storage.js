/**
 * Local save data: settings, mission progress and best landing scores.
 * Everything lives in localStorage, so it survives offline and needs no server.
 */

const SETTINGS_KEY = 'islandsim.settings.v1';
const PROGRESS_KEY = 'islandsim.progress.v1';

export const DEFAULT_SETTINGS = {
  /*
   * Graphics. `quality` is ALWAYS a concrete tier — low, medium, high or
   * ultra — because nineteen modules compare it with those words. "Auto" is
   * the separate flag beside it: on for a new install, where a short
   * frame-time probe at the first boot picks the tier
   * (render/quality-probe.js) and remembers what it picked, so later boots
   * do not probe again. A save from before Auto existed has no `qualityAuto`
   * key and keeps the tier its player chose (see coerceQuality).
   */
  quality: 'high',
  qualityAuto: true,
  qualityAutoPicked: null,
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
  /*
   * Reduce flashing (Settings → Graphics). On unless switched off: lightning,
   * explosions, hits, strobes and the cockpit's engine buzz kept dim, soft
   * and at most three flashes a second (render/flash-safety.js). A safety
   * setting, so it is the default and a save that predates it gets it too.
   */
  reduceFlashing: true,
  /*
   * Comic effects (Settings → Graphics): comic words and cards, stars, the
   * cartoon crashes, the starburst on the map (render/comic.js). OFF — "remove
   * the comic stuff, put it in settings and default off" — and a save that
   * predates the setting has no value for it, so it gets the default too.
   */
  comicEffects: false,
  highContrast: false,
  largeText: false,
  /*
   * HUD density (Settings → Accessibility): 'clean' folds the informational
   * cards (the wind, the damage diagram, tips, the key line) to chips a few
   * seconds after they change, so the world is what you see — the owner's
   * "so the map isn't clogged". 'full' keeps every panel open, as before.
   */
  hudDensity: 'clean',
  /*
   * The gun crosshair (Settings → Accessibility): 'square' is a small square
   * that turns red while something you can shoot is under it — the owner's
   * "make the crosshair a mini square you can toggle, and if you look at
   * something shootable like a player … it becomes red" — and it also hides
   * the heat-seeker's big dashed ring ("i dont like that circle").
   * 'classic' is the ring with range ticks, as before.
   */
  crosshair: 'square',
  /* The minimap's dashed approach lines out from every runway end (Settings → Accessibility). */
  runwayLines: true,
  /* The big PULL UP / TERRAIN words in the middle of the screen (Settings → Accessibility). Off: the warning card still shows. */
  bigWarnings: false,
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
  // The helicopter's stability assist (hover hold, height hold, auto-level).
  // On; switched off it is the raw lever and stick. See rotor-assist.js.
  heliAssist: true,
  // Flat 1% of the tank every 30 seconds. Off by default.
  realisticFuel: false,
  // Look around the cockpit with the mouse or arrow keys.
  freeLook: false,
  // Free flight begins on the parking stand and you taxi out.
  startAtGate: false,
  // The pilot's-eye cockpit view: narrower field of view, and the flight
  // instruments read off the panel instead of the overlay.
  realisticCockpit: false,
  /*
   * The alternative aircraft models in src/fleet/.
   *
   * Off, because the built-in ones read better side by side — see
   * model-adapter.js. Here as a switch rather than deleted so the two can be
   * compared without a rebuild, and so it can become the default the moment
   * the new shapes have some volume in them.
   */
  fleetModels: false,
  /*
   * Which way that switch was last set *by the game* rather than by a person.
   *
   * Settings that are already saved beat the defaults, which is right for
   * everything somebody chose and wrong for a default the game has since
   * changed its mind about: the pack was on, and everyone who has played
   * would have gone on flying it forever. Bumping this hands the choice back
   * once. Flip the switch yourself afterwards and it stays flipped.
   */
  modelSetRev: 2,
  /*
   * See MIGRATIONS: bumping this hands the damage default back once.
   *
   * Bumped to 2 because rev 1 briefly shipped with damage ON, and a saved
   * setting beats a default — so anybody who loaded that build would have
   * kept the landing regression forever, which is exactly the trap this
   * mechanism exists to get out of.
   */
  damageRev: 2,
  /*
   * The minimap, on by default.
   *
   * It was off, toggled by a key nobody is told about, behind a button in the
   * overflow tray whose tooltip named the wrong key. It was asked for
   * specifically; it should be on screen.
   */
  minimap: true,
  /*
   * Battle damage, on by default and out of Dev mode.
   *
   * Clipping something, or being shot, hurts the part that took it instead of
   * always ending the flight: a hurt wing rolls you towards it, a hurt tail
   * goes soft, a hurt nose loses power, and the panel shows where you were
   * hit. It is out of Dev mode and in the ordinary settings now, so anybody
   * can switch it on — but it is not the default yet, and here is exactly
   * why, measured rather than guessed.
   *
   * With it on, the suite's own approach turned a greased 444 ft/min arrival
   * into a 1,842 ft/min crash. Instrumenting the landing showed the cause:
   * the NOSE hard point touches the runway during a normal, wheels-down,
   * gear-fully-extended landing — `glancingBlow` is called for it every
   * frame at 1 m AGL with a closing speed of 0.09 m/s — so the aeroplane
   * takes a nose hit every half second simply for landing properly, and a
   * hurt nose costs power on short final.
   *
   * That is a hard-point geometry problem, not a threshold to tune, and it
   * has to be fixed before this can be the default. Shipping it on would
   * have handed every child in the class a worse landing than they had
   * yesterday.
   */
  damageModel: false,
  /*
   * A moment of slow motion when a crash really breaks the aeroplane up
   * (src/features/breakup.js): a third of real speed for half a second. The
   * owner asked for it as "optional", so it is a switch, on by default.
   */
  crashSlowMo: true,
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

/** What is actually in the save, with no defaults merged into it. */
function readRaw(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

/**
 * Defaults the game has since changed its mind about.
 *
 * A saved setting beats a default, which is right for everything somebody
 * chose and wrong for a default that has moved: whoever has already played
 * would keep the old value forever and never see the change. Each entry here
 * hands that one setting back, once, and then never again — flip the switch
 * yourself afterwards and it stays flipped.
 *
 * The revision is asked of the SAVE, not of the loaded settings. `read` merges
 * the defaults in for every key a save has never carried, so the merged object
 * always claims to be at the current revision — the first version of this
 * shipped dead for exactly that reason and the switch never once moved.
 */
const MIGRATIONS = [
  // The aeroplane models: the pack for the military three, built-in for the rest.
  { rev: 'modelSetRev', keys: ['fleetModels'] },
  // Battle damage, brought out of Dev mode and turned on.
  { rev: 'damageRev', keys: ['damageModel'] },
];

const QUALITY_TIERS = ['low', 'medium', 'high', 'ultra'];

/**
 * Make the graphics settings obey their contract, whatever the save holds.
 *
 *   - A save from before Auto existed (no `qualityAuto` key) is a player who
 *     chose their tier, or lived with the default: either way it is kept,
 *     and Auto stays off until they ask for it.
 *   - `quality` is always a tier. 'auto' written there (by anything) means
 *     Auto: the flag goes on and the tier is the one already picked, or High
 *     until a probe picks one. Any other non-tier is High.
 *   - `qualityAutoPicked` is a tier or null; with Auto on, `quality` follows
 *     it, so the boot builds the world at the tier the probe chose.
 *
 * Pure: mutates and returns `s`. `saved` is the raw save (null when none).
 */
export function coerceQuality(s, saved) {
  if (saved && typeof saved === 'object' && !('qualityAuto' in saved)) s.qualityAuto = false;
  if (!QUALITY_TIERS.includes(s.qualityAutoPicked)) s.qualityAutoPicked = null;
  if (s.quality === 'auto') s.qualityAuto = true;
  s.qualityAuto = s.qualityAuto === true;
  if (s.qualityAuto && s.qualityAutoPicked) s.quality = s.qualityAutoPicked;
  if (!QUALITY_TIERS.includes(s.quality)) s.quality = 'high';
  return s;
}

export function loadSettings() {
  const s = read(SETTINGS_KEY, DEFAULT_SETTINGS);
  const saved = readRaw(SETTINGS_KEY);
  coerceQuality(s, saved);
  if (!saved) return s;
  let changed = false;
  for (const m of MIGRATIONS) {
    if (saved[m.rev] === DEFAULT_SETTINGS[m.rev]) continue;
    for (const k of m.keys) s[k] = DEFAULT_SETTINGS[k];
    s[m.rev] = DEFAULT_SETTINGS[m.rev];
    changed = true;
  }
  if (changed) write(SETTINGS_KEY, s);
  return s;
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

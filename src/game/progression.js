/**
 * The career: ranks, pay, paint schemes and achievements.
 *
 * The campaign is meant to feel like a job you are getting better at. You fly a
 * mission, you get paid and you gain experience; experience raises your rank,
 * rank and money unlock new paint schemes, and finishing missions unlocks the
 * ones after them. Nothing here can be bought with real money — every credit in
 * the game is earned by flying it.
 *
 * This module owns its own save slot ('islandsim.career.v1') and never writes to
 * the older settings/progress slots in core/storage.js. It does *read* the old
 * progress once, when a career is created for the first time, so a player who
 * flew before the campaign existed keeps their flights, landings and best
 * landing instead of starting from nothing.
 *
 * Progress-bar helpers, because the names are easy to mix up:
 *   career.xpIntoRank      getter — experience earned since the current rank
 *   career.xpForNextRank() method — size of the current rank band
 *   career.rankProgress    getter — 0..1, ready to drop straight into a bar
 */

import { loadProgress } from '../core/storage.js';

const CAREER_KEY = 'islandsim.career.v1';

/**
 * Bump this whenever the saved shape changes, and add the matching step to
 * MIGRATIONS below. Old saves are upgraded, never thrown away.
 */
export const CAREER_VERSION = 1;

/** Flight pay is in credits. There is no way to buy them. */
export const CURRENCY = { name: 'credits', symbol: '◈' };

/**
 * Ranks, lowest first. `xp` is the total experience needed to hold the rank, so
 * the first entry must sit at zero.
 */
export const RANKS = [
  {
    id: 'student',
    name: 'Student Pilot',
    xp: 0,
    blurb: 'You are learning the basics: throttle, turns and getting back down in one piece.',
  },
  {
    id: 'solo',
    name: 'Solo Pilot',
    xp: 300,
    blurb: 'The instructor has climbed out and left you the aeroplane. The island is yours to explore.',
  },
  {
    id: 'private',
    name: 'Private Pilot',
    xp: 800,
    blurb: 'You can navigate between the islands and land where you mean to land.',
  },
  {
    id: 'island',
    name: 'Island Flyer',
    xp: 1600,
    blurb: 'Wind, cloud and short strips no longer worry you. The locals know your engine by sound.',
  },
  {
    id: 'commercial',
    name: 'Commercial Pilot',
    xp: 2700,
    blurb: 'You fly for a living now — cargo, passengers and the odd job nobody else wants.',
  },
  {
    id: 'senior',
    name: 'Senior Pilot',
    xp: 4000,
    blurb: 'Night, storms and emergencies are all in the logbook, and none of them beat you.',
  },
  {
    id: 'chief',
    name: 'Chief Pilot',
    xp: 5400,
    blurb: 'You are the one the tower calls when the weather turns and somebody has to go.',
  },
  {
    id: 'captain',
    name: 'Captain',
    xp: 7000,
    blurb: 'Four stripes. There is nothing left on this island chain that you cannot fly.',
  },
];

/**
 * Paint schemes. `livery` is the main body colour and `accent` the stripe; the
 * pair is handed straight to createAircraftModel({ livery, accent }).
 * `requiresRank` is a rank id — you must hold that rank *and* have the money.
 */
export const LIVERIES = [
  {
    id: 'classic',
    name: 'Kestrel Classic',
    livery: '#eef1f5',
    accent: '#c8102e',
    cost: 0,
    requiresRank: 'student',
    blurb: 'The flying school aeroplane: white with a red stripe.',
  },
  {
    id: 'skyblue',
    name: 'Sky Blue',
    livery: '#e9f2fb',
    accent: '#1f6fd0',
    cost: 350,
    requiresRank: 'solo',
    blurb: 'The colour of a clear morning over the bay.',
  },
  {
    id: 'sunset',
    name: 'Sunset Orange',
    livery: '#fdf0e2',
    accent: '#f4761f',
    cost: 600,
    requiresRank: 'solo',
    blurb: 'Warm orange stripes that glow on an evening approach.',
  },
  {
    id: 'jungle',
    name: 'Jungle Green',
    livery: '#eef3e6',
    accent: '#2f7d3a',
    cost: 900,
    requiresRank: 'private',
    blurb: 'Green as the hills behind the runway.',
  },
  {
    id: 'coral',
    name: 'Coral Reef',
    livery: '#fdeef1',
    accent: '#e8547c',
    cost: 1300,
    requiresRank: 'private',
    blurb: 'Pink and white, like the shallows off Mango Cay.',
  },
  {
    id: 'storm',
    name: 'Storm Grey',
    livery: '#c9ced6',
    accent: '#2b3440',
    cost: 1800,
    requiresRank: 'island',
    blurb: 'Weather-beaten grey for pilots who fly whatever the sky is doing.',
  },
  {
    id: 'lighthouse',
    name: 'Needle Rock',
    livery: '#f4f6f8',
    accent: '#1b6f63',
    cost: 2400,
    requiresRank: 'commercial',
    blurb: 'Teal and white, painted to match the lighthouse on the rock.',
  },
  {
    id: 'midnight',
    name: 'Midnight Navy',
    livery: '#212a3b',
    accent: '#f2c14e',
    cost: 3200,
    requiresRank: 'senior',
    blurb: 'Dark blue with gold trim. Made for flying after sunset.',
  },
  {
    id: 'carbon',
    name: 'Carbon Black',
    livery: '#1b1c1f',
    accent: '#d6d9de',
    cost: 4200,
    requiresRank: 'chief',
    blurb: 'Matt black with a silver flash down the side.',
  },
  {
    id: 'goldstripe',
    name: "Captain's Gold",
    livery: '#f7efdc',
    accent: '#c9a227',
    cost: 5000,
    requiresRank: 'captain',
    blurb: 'Cream and gold. Everyone on the apron knows who just landed.',
  },
];

/**
 * Achievements. Each check() is handed the stats snapshot from Career#stats, so
 * a check may only read numbers that this file actually keeps.
 */
export const ACHIEVEMENTS = [
  {
    id: 'wheels_up',
    name: 'Wheels Up',
    description: 'Take off for the very first time.',
    check: (s) => s.takeoffs >= 1,
  },
  {
    id: 'back_down',
    name: 'Back on the Ground',
    description: 'Land the aeroplane once.',
    check: (s) => s.landings >= 1,
  },
  {
    id: 'butter',
    name: 'Butter Landing',
    description: 'Score 95 or more on a landing.',
    check: (s) => !!s.bestLanding && s.bestLanding.score >= 95,
  },
  {
    id: 'smooth_ten',
    name: 'Smooth Operator',
    description: 'Touch down gently ten times.',
    check: (s) => s.perfectLandings >= 10,
  },
  {
    id: 'night_owl',
    name: 'Night Owl',
    description: 'Land after dark.',
    check: (s) => s.nightLandings >= 1,
  },
  {
    id: 'storm_chaser',
    name: 'Storm Chaser',
    description: 'Land safely in a thunderstorm.',
    check: (s) => s.stormLandings >= 1,
  },
  {
    id: 'dead_stick',
    name: 'Dead Stick',
    description: 'Land with the engine stopped.',
    check: (s) => s.deadstickLandings >= 1,
  },
  {
    id: 'courier',
    name: 'Island Courier',
    description: 'Deliver five crates of supplies.',
    check: (s) => s.cargoDelivered >= 5,
  },
  {
    id: 'explorer',
    name: 'Island Explorer',
    description: 'Fly over Mango Cay and Needle Rock.',
    check: (s) => s.visited.includes('mango') && s.visited.includes('needle'),
  },
  {
    id: 'high_flyer',
    name: 'Top of the Sky',
    description: 'Climb above 10,000 feet.',
    check: (s) => s.maxAltitudeFt >= 10000,
  },
  {
    id: 'long_way',
    name: 'The Long Way Round',
    description: 'Fly 250 kilometres in total.',
    check: (s) => s.distanceKm >= 250,
  },
  {
    id: 'ring_master',
    name: 'Ring Master',
    description: 'Fly through 50 checkpoint rings.',
    check: (s) => s.gatesPassed >= 50,
  },
  {
    id: 'steady_hands',
    name: 'Steady Hands',
    description: 'Finish five flights in a row without crashing.',
    check: (s) => s.bestCleanStreak >= 5,
  },
  {
    id: 'air_time',
    name: 'Air Time',
    description: 'Spend five hours in the air.',
    check: (s) => s.hours >= 5,
  },
  {
    id: 'half_way',
    name: 'Halfway There',
    description: 'Complete five missions.',
    check: (s) => s.missionsCompleted >= 5,
  },
  {
    id: 'career_pilot',
    name: 'Career Pilot',
    description: 'Complete ten missions.',
    check: (s) => s.missionsCompleted >= 10,
  },
  {
    id: 'top_marks',
    name: 'Top Marks',
    description: 'Finish a mission with a score of 95 or more.',
    check: (s) => s.bestMissionScore >= 95,
  },
  {
    id: 'collector',
    name: 'Paint Collector',
    description: 'Own five different paint schemes.',
    check: (s) => s.liveriesOwned >= 5,
  },
  {
    id: 'four_stripes',
    name: 'Four Stripes',
    description: 'Reach the rank of Captain.',
    check: (s) => s.rankIndex >= RANKS.length - 1,
  },
];

/** Every achievement is worth the same, so none of them feels like the dud. */
const ACHIEVEMENT_XP = 75;

/** Pay and experience for a mission that does not name its own reward. */
const DIFFICULTY_REWARD = {
  easy: { pay: 260, xp: 130 },
  medium: { pay: 430, xp: 210 },
  hard: { pay: 640, xp: 320 },
  expert: { pay: 900, xp: 460 },
};
const DEFAULT_REWARD = DIFFICULTY_REWARD.medium;

/** A side objective the mission has not priced itself. */
const DEFAULT_OPTIONAL = { pay: 120, xp: 60 };

/** Flying a finished mission again still pays, but not like the first time. */
const REPLAY_RATE = 0.4;

function freshStats() {
  return {
    flights: 0,
    takeoffs: 0,
    landings: 0,
    crashes: 0,
    hours: 0,
    distanceKm: 0,
    maxAltitudeFt: 0,
    gatesPassed: 0,
    cargoDelivered: 0,
    perfectLandings: 0,
    nightLandings: 0,
    stormLandings: 0,
    deadstickLandings: 0,
    cleanStreak: 0,
    bestCleanStreak: 0,
    bestMissionScore: 0,
    visited: [],
    bestLanding: null, // { score, vsFpm, date }
  };
}

export function freshCareer() {
  return {
    version: CAREER_VERSION,
    xp: 0,
    money: 0,
    liveries: ['classic'],
    livery: 'classic',
    missions: {}, // id -> { complete, plays, bestScore, bestTime, optionals: [] }
    tutorialComplete: false,
    achievements: [], // ids, in the order they were earned
    stats: freshStats(),
    created: new Date().toISOString().slice(0, 10),
    updated: null,
  };
}

function isObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Fill in anything a saved blob is missing without discarding what it has. */
function withDefaults(base, saved) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  if (!isObject(saved)) return out;
  for (const key of Object.keys(saved)) {
    const val = saved[key];
    if (val === undefined) continue;
    if (isObject(base[key]) && isObject(val)) out[key] = withDefaults(base[key], val);
    else out[key] = val;
  }
  return out;
}

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function uniqueStrings(list) {
  if (!Array.isArray(list)) return [];
  return [...new Set(list.filter((x) => typeof x === 'string'))];
}

/**
 * Pull the pre-campaign save into a brand-new career. It is read-only: the old
 * keys stay exactly where they are, so an older build of the game would still
 * find its data if the player ever went back to one.
 */
function importLegacyProgress(career) {
  let old = null;
  try {
    old = loadProgress();
  } catch (e) {
    return career;
  }
  if (!isObject(old)) return career;

  const s = career.stats;
  s.flights = num(old.flights);
  s.takeoffs = num(old.takeoffs);
  s.landings = num(old.landings);
  s.crashes = num(old.crashes);
  s.hours = num(old.hoursFlown);
  if (isObject(old.bestLanding) && num(old.bestLanding.score) > 0) s.bestLanding = { ...old.bestLanding };

  if (isObject(old.missions)) {
    for (const [id, m] of Object.entries(old.missions)) {
      if (!isObject(m)) continue;
      career.missions[id] = {
        complete: !!m.complete,
        plays: m.complete ? 1 : 0,
        bestScore: num(m.bestScore),
        bestTime: num(m.bestTime, null),
        optionals: [],
      };
      // Credit the flying they already did, so the campaign does not feel like
      // it has wiped their logbook.
      if (m.complete) {
        career.xp += DEFAULT_REWARD.xp;
        career.money += DEFAULT_REWARD.pay;
        s.bestMissionScore = Math.max(s.bestMissionScore, num(m.bestScore));
      }
    }
  }
  if (old.tutorialComplete) career.tutorialComplete = true;
  return career;
}

/**
 * Upgrade steps, keyed by the version being upgraded *from*. Version 0 covers
 * anything saved before this file existed or without a version field.
 */
const MIGRATIONS = {
  0: (data) => {
    const out = withDefaults(freshCareer(), data);
    // A version-less blob may really be an old progress save, where the counters
    // sat at the top level rather than under `stats`.
    if (!isObject(data.stats)) {
      out.stats = withDefaults(freshStats(), {
        flights: num(data.flights),
        takeoffs: num(data.takeoffs),
        landings: num(data.landings),
        crashes: num(data.crashes),
        hours: num(data.hoursFlown, num(data.hours)),
        bestLanding: isObject(data.bestLanding) ? data.bestLanding : null,
      });
    }
    out.version = 1;
    return out;
  },
};

function migrate(data) {
  let out = isObject(data) ? { ...data } : {};
  let guard = 0;
  while (num(out.version, 0) < CAREER_VERSION && guard++ < 32) {
    const from = num(out.version, 0);
    const step = MIGRATIONS[from];
    if (!step) {
      // No recipe for this version: keep the data, stamp it current rather than
      // spinning forever or dropping the player's career.
      out.version = CAREER_VERSION;
      break;
    }
    out = step(out);
    if (num(out.version, 0) <= from) out.version = from + 1;
  }
  return out;
}

function storage() {
  // Guarding here means the whole career still works in a page with storage
  // blocked; it simply forgets everything when you close the tab.
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch (e) {
    return null;
  }
}

export function rankById(id) {
  return RANKS.find((r) => r.id === id) || null;
}

export function rankIndexById(id) {
  return RANKS.findIndex((r) => r.id === id);
}

export function liveryById(id) {
  return LIVERIES.find((l) => l.id === id) || null;
}

export function achievementById(id) {
  return ACHIEVEMENTS.find((a) => a.id === id) || null;
}

/** '◈ 1,250' — the one place credits get formatted, so it reads the same everywhere. */
export function formatMoney(amount) {
  return `${CURRENCY.symbol} ${Math.round(num(amount)).toLocaleString('en-GB')}`;
}

export class Career {
  /**
   * @param {object} [opts]
   * @param {Array}  [opts.missions] the mission catalogue, if the caller has it.
   *   It is only used to report which missions a result has just unlocked; every
   *   other method takes the mission object it needs directly.
   */
  constructor(opts = {}) {
    this.catalogue = Array.isArray(opts.missions) ? opts.missions : [];
    /** Called with (achievement) each time one is earned, for the pop-up. */
    this.onAchievement = null;
    /** Called with (rank) on promotion. */
    this.onRankUp = null;
    this.data = freshCareer();
    this.load();
  }

  /** Hand over the mission list later, once the game has built it. */
  setMissions(list) {
    this.catalogue = Array.isArray(list) ? list : [];
  }

  // ---- Rank ---------------------------------------------------------------

  get rankIndex() {
    let idx = 0;
    for (let i = 0; i < RANKS.length; i++) if (this.data.xp >= RANKS[i].xp) idx = i;
    return idx;
  }

  get rank() {
    return RANKS[this.rankIndex];
  }

  get nextRank() {
    return RANKS[this.rankIndex + 1] || null;
  }

  get xpIntoRank() {
    return Math.max(0, this.data.xp - this.rank.xp);
  }

  /** Size of the current rank band; 0 at Captain, where there is nothing left. */
  xpForNextRank() {
    const next = this.nextRank;
    return next ? next.xp - this.rank.xp : 0;
  }

  /** Experience still to earn before the next promotion. */
  get xpToNextRank() {
    const next = this.nextRank;
    return next ? Math.max(0, next.xp - this.data.xp) : 0;
  }

  /** 0..1 through the current rank — feed this straight to a progress bar. */
  get rankProgress() {
    const band = this.xpForNextRank();
    return band > 0 ? Math.min(1, this.xpIntoRank / band) : 1;
  }

  hasRank(id) {
    const idx = rankIndexById(id);
    return idx < 0 ? true : this.rankIndex >= idx;
  }

  // ---- Money and paint ----------------------------------------------------

  get money() {
    return this.data.money;
  }

  get xp() {
    return this.data.xp;
  }

  get ownedLiveries() {
    return LIVERIES.filter((l) => this.data.liveries.includes(l.id));
  }

  /** Paint schemes you have the rank for but have not bought yet. */
  get availableLiveries() {
    return LIVERIES.filter((l) => !this.data.liveries.includes(l.id) && this.hasRank(l.requiresRank));
  }

  ownsLivery(id) {
    return this.data.liveries.includes(id);
  }

  canBuyLivery(id) {
    const l = liveryById(id);
    if (!l || this.ownsLivery(id)) return false;
    return this.hasRank(l.requiresRank) && this.data.money >= l.cost;
  }

  buyLivery(id) {
    if (!this.canBuyLivery(id)) return false;
    const l = liveryById(id);
    this.data.money -= l.cost;
    this.data.liveries.push(l.id);
    this._checkAchievements();
    this.save();
    return true;
  }

  setLivery(id) {
    if (!this.ownsLivery(id)) return false;
    this.data.livery = id;
    this.save();
    return true;
  }

  /** The { livery, accent } pair for createAircraftModel(). */
  get livery() {
    return liveryById(this.data.livery) || LIVERIES[0];
  }

  get liveryColours() {
    const l = this.livery;
    return { livery: l.livery, accent: l.accent };
  }

  // ---- Missions -----------------------------------------------------------

  missionRecord(id) {
    return this.data.missions[id] || null;
  }

  isMissionComplete(id) {
    const m = this.data.missions[id];
    return !!(m && m.complete);
  }

  get completedMissionIds() {
    return Object.keys(this.data.missions).filter((id) => this.data.missions[id].complete);
  }

  /**
   * A mission is open if every mission it names in `requires` is complete and
   * you hold the rank it asks for. Missions that ask for nothing are always
   * open, which keeps free flight and the tutorial available from the start.
   */
  isMissionUnlocked(mission) {
    const def = typeof mission === 'string' ? this._fromCatalogue(mission) : mission;
    if (!def) return false;
    if (def.alwaysUnlocked) return true;

    const requires = Array.isArray(def.requires) ? def.requires : [];
    for (const id of requires) if (!this.isMissionComplete(id)) return false;

    const rankId = def.requiresRank || def.minRank || null;
    if (rankId && !this.hasRank(rankId)) return false;

    if (num(def.requiresXp) > 0 && this.data.xp < def.requiresXp) return false;
    if (def.requiresTutorial && !this.data.tutorialComplete) return false;
    return true;
  }

  /** Why a mission is still shut, in words a beginner can act on. */
  lockReason(mission) {
    const def = typeof mission === 'string' ? this._fromCatalogue(mission) : mission;
    if (!def || this.isMissionUnlocked(def)) return null;
    const requires = Array.isArray(def.requires) ? def.requires : [];
    const missing = requires.filter((id) => !this.isMissionComplete(id));
    if (missing.length) {
      const names = missing.map((id) => {
        const m = this._fromCatalogue(id);
        return m ? m.name : id;
      });
      return `Finish ${names.join(' and ')} first.`;
    }
    const rankId = def.requiresRank || def.minRank || null;
    if (rankId && !this.hasRank(rankId)) {
      const r = rankById(rankId);
      return `You need to reach ${r ? r.name : rankId}.`;
    }
    if (num(def.requiresXp) > 0 && this.data.xp < def.requiresXp) {
      return `You need ${def.requiresXp - this.data.xp} more experience.`;
    }
    if (def.requiresTutorial) return 'Finish Flight School first.';
    return 'Not available yet.';
  }

  markTutorialComplete() {
    if (this.data.tutorialComplete) return false;
    this.data.tutorialComplete = true;
    this.save();
    return true;
  }

  /**
   * Bank a finished mission.
   *
   * @param {string} missionId
   * @param {object} result { score, time, landing, optionals: [ids], mission }
   *   `mission` is the definition, if the caller has it — it supplies pay, xp
   *   and the names of the optional objectives. Without it the difficulty
   *   defaults are used, so this never fails just because it was called bare.
   * @returns {{xpGained:number, moneyGained:number, rankUp:object|null,
   *           newAchievements:Array, unlocked:Array, breakdown:object}}
   */
  addResult(missionId, result = {}) {
    const def = result.mission || this._fromCatalogue(missionId) || {};
    const score = Math.max(0, Math.min(100, num(result.score)));
    const time = num(result.time);
    const optionals = uniqueStrings(result.optionals);

    const beforeRank = this.rankIndex;
    const beforeUnlocked = new Set(this._unlockedIds());
    const beforeLiveries = new Set(this.availableLiveries.map((l) => l.id));

    const prev = this.data.missions[missionId] || {
      complete: false,
      plays: 0,
      bestScore: 0,
      bestTime: null,
      optionals: [],
    };
    const firstTime = !prev.complete;

    // How well you flew it scales the pay, but a scrappy success still pays
    // enough that a beginner is never stuck: half the fee at zero marks.
    const reward = this._rewardFor(def);
    const quality = 0.5 + score / 200;
    const replay = firstTime ? 1 : REPLAY_RATE;

    let pay = reward.pay * quality * replay;
    let xp = reward.xp * quality * replay;

    // Optional objectives pay their own bonus, once each per mission.
    const alreadyDone = new Set(prev.optionals || []);
    const freshOptionals = optionals.filter((id) => !alreadyDone.has(id));
    let optionalPay = 0;
    let optionalXp = 0;
    for (const id of freshOptionals) {
      const o = this._optionalFor(def, id);
      optionalPay += o.pay;
      optionalXp += o.xp;
    }
    pay += optionalPay;
    xp += optionalXp;

    // A tidy arrival is worth real money — it is the skill the whole game is about.
    const landing = result.landing || null;
    const landingBonus = landing && !landing.crashed ? Math.round(num(landing.score) * 1.5) : 0;
    pay += landingBonus;

    const moneyGained = Math.round(pay);
    const xpGained = Math.round(xp);

    this.data.missions[missionId] = {
      complete: true,
      plays: prev.plays + 1,
      bestScore: Math.max(prev.bestScore, score),
      bestTime: prev.bestTime === null || time < prev.bestTime ? time : prev.bestTime,
      optionals: [...alreadyDone, ...freshOptionals],
      lastScore: score,
      lastTime: time,
    };
    this.data.money += moneyGained;
    this.data.xp += xpGained;
    this.data.stats.bestMissionScore = Math.max(this.data.stats.bestMissionScore, score);

    const newAchievements = this._checkAchievements();
    const rankUp = this.rankIndex > beforeRank ? this.rank : null;
    if (rankUp && this.onRankUp) this.onRankUp(rankUp);

    const unlocked = [];
    for (const id of this._unlockedIds()) {
      if (beforeUnlocked.has(id)) continue;
      const m = this._fromCatalogue(id);
      unlocked.push({ type: 'mission', id, name: m ? m.name : id });
    }
    for (const l of this.availableLiveries) {
      if (!beforeLiveries.has(l.id)) unlocked.push({ type: 'livery', id: l.id, name: l.name });
    }

    this.save();
    return {
      xpGained,
      moneyGained,
      rankUp,
      newAchievements,
      unlocked,
      breakdown: {
        firstTime,
        basePay: Math.round(reward.pay * quality * replay),
        optionalPay,
        landingBonus,
        optionals: freshOptionals,
        score,
      },
    };
  }

  // ---- Logbook ------------------------------------------------------------

  /**
   * Called when a flight ends, however it ended.
   *
   * @param {object} summary { seconds, distanceM, maxAltFt, crashed, tookOff,
   *                           gates, cargo, visited: [ids] }
   */
  recordFlight(summary = {}) {
    const s = this.data.stats;
    s.flights += 1;
    s.hours += Math.max(0, num(summary.seconds)) / 3600;
    s.distanceKm += Math.max(0, num(summary.distanceM)) / 1000;
    s.maxAltitudeFt = Math.max(s.maxAltitudeFt, num(summary.maxAltFt));
    s.gatesPassed += Math.max(0, Math.round(num(summary.gates)));
    s.cargoDelivered += Math.max(0, Math.round(num(summary.cargo)));
    if (summary.tookOff) s.takeoffs += 1;
    if (summary.crashed) {
      s.crashes += 1;
      s.cleanStreak = 0;
    } else {
      s.cleanStreak += 1;
      s.bestCleanStreak = Math.max(s.bestCleanStreak, s.cleanStreak);
    }
    for (const place of uniqueStrings(summary.visited)) {
      if (!s.visited.includes(place)) s.visited.push(place);
    }
    const earned = this._checkAchievements();
    this.save();
    return earned;
  }

  /**
   * Called on every touchdown with the grade from Aircraft#gradeTouchdown.
   *
   * @param {object} grade   { score, vsFpm, crashed, quality, ... }
   * @param {object} [info]  { night, storm, engineOut } — the conditions it was
   *                         flown in, which is what the badges care about.
   */
  recordLanding(grade = {}, info = {}) {
    if (grade.crashed) return [];
    const s = this.data.stats;
    s.landings += 1;
    const score = num(grade.score);
    if (!s.bestLanding || score > s.bestLanding.score) {
      s.bestLanding = {
        score,
        vsFpm: num(grade.vsFpm),
        date: new Date().toISOString().slice(0, 10),
      };
    }
    if (grade.quality === 'perfect' || Math.abs(num(grade.vsFpm)) < 150) s.perfectLandings += 1;
    if (info.night) s.nightLandings += 1;
    if (info.storm) s.stormLandings += 1;
    if (info.engineOut) s.deadstickLandings += 1;
    const earned = this._checkAchievements();
    this.save();
    return earned;
  }

  /** Somewhere new seen from the air: 'mango', 'needle', and so on. */
  recordVisit(place) {
    if (typeof place !== 'string' || !place) return false;
    const s = this.data.stats;
    if (s.visited.includes(place)) return false;
    s.visited.push(place);
    this._checkAchievements();
    this.save();
    return true;
  }

  // ---- Stats and achievements --------------------------------------------

  /** A read-only snapshot: raw counters plus the numbers the badges test. */
  get stats() {
    const s = this.data.stats;
    return {
      ...s,
      visited: [...s.visited],
      bestLanding: s.bestLanding ? { ...s.bestLanding } : null,
      money: this.data.money,
      xp: this.data.xp,
      rankId: this.rank.id,
      rankName: this.rank.name,
      rankIndex: this.rankIndex,
      liveriesOwned: this.data.liveries.length,
      missionsCompleted: this.completedMissionIds.length,
      achievementsEarned: this.data.achievements.length,
    };
  }

  get achievements() {
    return ACHIEVEMENTS.map((a) => ({ ...a, earned: this.data.achievements.includes(a.id) }));
  }

  hasAchievement(id) {
    return this.data.achievements.includes(id);
  }

  /**
   * Award anything newly deserved. A badge is checked against the snapshot, and
   * its experience is added before the next one is tested, which is why the
   * rank-based badge can only ever land on the following check — that is fine,
   * and it keeps the awards from cascading unpredictably in one frame.
   */
  _checkAchievements() {
    const earned = [];
    const snapshot = this.stats;
    for (const a of ACHIEVEMENTS) {
      if (this.data.achievements.includes(a.id)) continue;
      let ok = false;
      try {
        ok = !!a.check(snapshot);
      } catch (e) {
        ok = false;
      }
      if (!ok) continue;
      this.data.achievements.push(a.id);
      this.data.xp += ACHIEVEMENT_XP;
      earned.push(a);
      if (this.onAchievement) this.onAchievement(a);
    }
    return earned;
  }

  _rewardFor(def) {
    const named = { pay: num(def.pay, NaN), xp: num(def.xp, NaN) };
    const key = String(def.difficulty || '').toLowerCase();
    const base = DIFFICULTY_REWARD[key] || DEFAULT_REWARD;
    return {
      pay: Number.isFinite(named.pay) ? named.pay : base.pay,
      xp: Number.isFinite(named.xp) ? named.xp : base.xp,
    };
  }

  _optionalFor(def, id) {
    const list = def.optionals || def.optionalObjectives || [];
    const found = Array.isArray(list) ? list.find((o) => o && o.id === id) : null;
    if (!found) return DEFAULT_OPTIONAL;
    return {
      pay: num(found.pay, DEFAULT_OPTIONAL.pay),
      xp: num(found.xp, DEFAULT_OPTIONAL.xp),
    };
  }

  _fromCatalogue(id) {
    return this.catalogue.find((m) => m && m.id === id) || null;
  }

  _unlockedIds() {
    return this.catalogue.filter((m) => this.isMissionUnlocked(m)).map((m) => m.id);
  }

  // ---- Saving -------------------------------------------------------------

  load() {
    const store = storage();
    if (!store) {
      this.data = freshCareer();
      return this.data;
    }
    let raw = null;
    try {
      raw = store.getItem(CAREER_KEY);
    } catch (e) {
      raw = null;
    }
    if (!raw) {
      // First run of the campaign: carry across whatever the old save knew.
      this.data = importLegacyProgress(freshCareer());
      return this.data;
    }
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      console.warn('Career save was unreadable — starting a fresh career.', e);
      this.data = freshCareer();
      return this.data;
    }
    if (!isObject(parsed)) {
      console.warn('Career save was not in the expected shape — starting a fresh career.');
      this.data = freshCareer();
      return this.data;
    }
    try {
      this.data = this._sanitise(withDefaults(freshCareer(), migrate(parsed)));
    } catch (e) {
      console.warn('Career save could not be upgraded — starting a fresh career.', e);
      this.data = freshCareer();
    }
    return this.data;
  }

  /** Guarantee the types the rest of the class assumes, whatever was on disk. */
  _sanitise(d) {
    const out = d;
    out.version = CAREER_VERSION;
    out.xp = Math.max(0, num(out.xp));
    out.money = Math.max(0, num(out.money));
    out.liveries = uniqueStrings(out.liveries).filter((id) => !!liveryById(id));
    if (!out.liveries.includes('classic')) out.liveries.unshift('classic');
    if (!out.liveries.includes(out.livery)) out.livery = 'classic';
    out.achievements = uniqueStrings(out.achievements).filter((id) => !!achievementById(id));
    out.missions = isObject(out.missions) ? out.missions : {};
    for (const [id, m] of Object.entries(out.missions)) {
      if (!isObject(m)) {
        delete out.missions[id];
        continue;
      }
      m.complete = !!m.complete;
      m.plays = Math.max(0, Math.round(num(m.plays, m.complete ? 1 : 0)));
      m.bestScore = Math.max(0, num(m.bestScore));
      m.bestTime = typeof m.bestTime === 'number' && Number.isFinite(m.bestTime) ? m.bestTime : null;
      m.optionals = uniqueStrings(m.optionals);
    }
    const s = withDefaults(freshStats(), isObject(out.stats) ? out.stats : {});
    for (const key of Object.keys(freshStats())) {
      if (key === 'visited' || key === 'bestLanding') continue;
      s[key] = Math.max(0, num(s[key]));
    }
    s.visited = uniqueStrings(s.visited);
    s.bestLanding = isObject(s.bestLanding) ? { ...s.bestLanding, score: num(s.bestLanding.score) } : null;
    out.stats = s;
    return out;
  }

  save() {
    const store = storage();
    if (!store) return false;
    this.data.version = CAREER_VERSION;
    this.data.updated = new Date().toISOString().slice(0, 10);
    try {
      store.setItem(CAREER_KEY, JSON.stringify(this.data));
      return true;
    } catch (e) {
      console.warn('Could not save your career (storage may be full or blocked).', e);
      return false;
    }
  }

  /** Wipe the career only. Settings and the old progress slot are left alone. */
  reset() {
    const store = storage();
    if (store) {
      try {
        store.removeItem(CAREER_KEY);
      } catch (e) {
        /* nothing sensible to do; the in-memory reset below still happens */
      }
    }
    this.data = freshCareer();
    this.save();
    return this.data;
  }
}

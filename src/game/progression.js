/**
 * Ranks, credits and a leaderboard — all of it local.
 *
 * The class asked for ranks, a leaderboard and a credit economy. Those usually
 * imply a server, and this game deliberately has none: no account, no network,
 * nothing to sign into, which is why it opens instantly on a school laptop and
 * keeps working when the wifi does not.
 *
 * So all three are built on what the game already knows about you. The
 * leaderboard is your own best flights — which is the version that actually
 * gets played, because a global board is somebody else's score and a personal
 * board is yours to beat. Credits come from flying well rather than from
 * waiting, and unlock aeroplanes rather than stat boosts, because an unlock
 * you can feel is worth more than a number that goes up.
 */

const KEY = 'islandsim.progression.v1';

/**
 * The ranks the class asked for. Founder and Admin are not earnable: they
 * belong to whoever made and runs the thing, which is the whole point of them.
 */
export const RANKS = [
  { id: 'cadet', name: 'Cadet', at: 0, blurb: 'Everyone starts here' },
  { id: 'pilot', name: 'Pilot', at: 400, blurb: 'You can take off and land on purpose' },
  { id: 'senior', name: 'Senior Pilot', at: 1200, blurb: 'Landings are no longer luck' },
  { id: 'captain', name: 'Captain', at: 2600, blurb: 'Trusted with the heavy metal' },
  { id: 'instructor', name: 'Instructor', at: 5000, blurb: 'You could teach this' },
  { id: 'top', name: 'Top Player', at: 9000, blurb: 'Better than everyone you know' },
  { id: 'mod', name: 'Mod', at: Infinity, blurb: 'Appointed, not earned', granted: true },
  { id: 'admin', name: 'Admin', at: Infinity, blurb: 'Appointed, not earned', granted: true },
  { id: 'founder', name: 'Founder', at: Infinity, blurb: 'There is one', granted: true },
];

/** Aeroplanes you have to earn. The trainer and tourer are always yours. */
export const UNLOCKS = [
  { aircraft: 'meridian', cost: 600, why: 'Forty seats and a lot of momentum' },
  { aircraft: 'vanguard', cost: 1400, why: 'Enormous thrust, no forgiveness' },
  { aircraft: 'osprey', cost: 1000, why: 'Built for a moving deck' },
  { aircraft: 'tempest', cost: 2200, why: 'A tornado cannot break it' },
  { aircraft: 'nightjar', cost: 3000, why: 'No tail, and it shows', military: true },
  { aircraft: 'a320', cost: 600, why: 'The airliner you have probably flown on' },
  { aircraft: 'b747', cost: 1200, why: 'The Jumbo, hump and all' },
  { aircraft: 'a380', cost: 1600, why: 'Two decks, four engines, twenty-two wheels' },
  { aircraft: 'fa18', cost: 1800, why: 'Built for the carrier', military: true },
  { aircraft: 'f35b', cost: 2600, why: 'It can stop in mid-air', military: true },
  { aircraft: 'f22', cost: 3400, why: 'The quickest of the real jets', military: true },
  { aircraft: 'a10', cost: 2400, why: 'Slow, tough, and that gun', military: true },
  { aircraft: 'massimo', cost: 3600, why: 'The fastest thing in the game' },
];

/*
 * Yours from the start.
 *
 * The Skyhook is on this list because it is not really an aeroplane you buy —
 * it is one of the four games in the switcher, alongside the boat and the car,
 * and those are free. It also had to be: it is in no UNLOCKS row, so costOf()
 * returned 0 and buy() answered "Not for sale" while the hub cheerfully told
 * you to unlock it in the hangar. The helicopter the class asked for could not
 * be reached by any route at all.
 */
const FREE = ['skylark', 'courier', 'harrier'];

/**
 * Military aircraft sit behind a passcode.
 *
 * This was the class's own idea, and it is a good one: they wanted the
 * military side gated so it is not simply there for anyone who opens the game.
 * It is not a security measure — anyone can read this file — it is a door, so
 * that flying the bomber is a thing you were let into rather than a thing you
 * wandered into. Whoever runs the game decides who gets told the word.
 *
 * Typed case-insensitively, so `mc1234` and `MC1234` are the same door.
 *
 * It opens ONCE. `militaryUnlocked` lives in the saved progression and is
 * never cleared — not by finishing, not by crashing, not by "Reset
 * everything", which only touches settings, keys and mission progress. Being
 * let in is a thing that happened to you, not a score you can lose, so the
 * game must never make a kid go and ask for the word a second time.
 */
export const MILITARY_CODE = 'MC1234';

/**
 * Dev mode.
 *
 * A door for things that are built but not finished — a new set of aeroplane
 * models, a half-drawn boat, whatever is being tried this week. Everyone else
 * gets the game as it is meant to be; behind this code you get the workbench.
 *
 * It exists because the alternative is shipping half-finished work to a
 * classroom of twenty-nine and hoping nobody notices, or not being able to see
 * the work in the real game at all. Neither is any good.
 *
 * Same rules as the military code: case-insensitive, opens once, stays open.
 */
export const DEV_CODE = 'DEV1234';

function blank() {
  return {
    credits: 0,
    earned: 0, // lifetime, which is what the rank is based on
    militaryUnlocked: false,
    devUnlocked: false,
    unlocked: [...FREE],
    grantedRank: null,
    best: [], // the leaderboard: your own best flights
    redeemed: [],
  };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const p = JSON.parse(raw);
    // JSON.parse('null') is null, which survives the spread and then throws on
    // the next line — a silent total reset dressed up as a corrupt save.
    if (!p || typeof p !== 'object') return blank();
    return { ...blank(), ...p, unlocked: [...new Set([...FREE, ...(p.unlocked || [])])] };
  } catch (e) {
    console.warn('Could not read your progress — starting fresh.', e);
    return blank();
  }
}

export function save(p) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
    return true;
  } catch (e) {
    console.warn('Could not save progress.', e);
    return false;
  }
}

/** Which rank a lifetime score buys, or the one that was granted. */
export function rankFor(p) {
  if (p.grantedRank) {
    const g = RANKS.find((r) => r.id === p.grantedRank);
    if (g) return g;
  }
  let out = RANKS[0];
  for (const r of RANKS) {
    if (!r.granted && p.earned >= r.at) out = r;
  }
  return out;
}

/** How far to the next one, for the bar on the debrief. */
export function nextRank(p) {
  const cur = rankFor(p);
  if (cur.granted) return null;
  const i = RANKS.findIndex((r) => r.id === cur.id);
  const next = RANKS.slice(i + 1).find((r) => !r.granted);
  if (!next) return null;
  return { rank: next, need: next.at - p.earned, span: next.at - cur.at, into: p.earned - cur.at };
}

/* ====================================================================== */
/*
 * WHAT A MISSION PAYS.
 *
 * "The harder the mission and category, the more credits you get" — the
 * owner. It used to be one price for everything: 120 plus the score, so the
 * first lap of the island paid exactly what a night carrier trap paid, and a
 * child saving for the F-22 did best by flying Island Circuit forty times.
 *
 * Now four things decide it, in this order:
 *
 *   1. how hard the MISSION is      its `difficulty` label   → DIFFICULTIES
 *   2. how demanding its CATEGORY is the heading it sits under → CATEGORY_TIERS
 *   3. the settings difficulty      Easy / Normal / Realistic → SETTINGS_PAY
 *   4. how well you flew            the 0–100 score            → SCORE_FLOOR
 *
 * 1 × 2 × 3, rounded to ten, is the most a mission can pay: the "Up to 380
 * credits" on its card. The score then decides how much of that you get —
 * finishing at all is worth SCORE_FLOOR of it, a perfect run all of it.
 *
 * Everything is read off the label and the heading, never off a list of
 * mission ids, so a mission that does not exist yet is priced the moment it
 * says what it is. A label nobody has used before is read generously
 * ('Tricky' is Hard, 'Expert' is above Very hard); one that cannot be read at
 * all is Medium, which is what the mission board prints for it.
 *
 * Crashing still pays nothing and never takes anything away.
 */

/**
 * Every difficulty label in use, easiest first. `rank` is THE ordering — the
 * one thing a list sorted by difficulty and the pay both read, through
 * difficultyRank() — and `pay` is what that difficulty is worth, at the top
 * score, in the plainest category on Normal.
 *
 * Free is the free-roam entries (the boat's patrol, the van's open roads):
 * not a mission, nothing to finish, and first in any sort.
 */
export const DIFFICULTIES = [
  { id: 'free', label: 'Free', rank: 0, pay: 80 },
  { id: 'training', label: 'Training', rank: 1, pay: 140 },
  { id: 'easy', label: 'Easy', rank: 2, pay: 180 },
  { id: 'medium', label: 'Medium', rank: 3, pay: 240 },
  { id: 'hard', label: 'Hard', rank: 4, pay: 330 },
  { id: 'very-hard', label: 'Very hard', rank: 5, pay: 420 },
  { id: 'expert', label: 'Expert', rank: 6, pay: 500 },
];

/* Words a mission team might type, mapped onto the rows above. */
const DIFFICULTY_WORDS = {
  free: 'free', sandbox: 'free', 'free roam': 'free', none: 'free',
  training: 'training', tutorial: 'training', lesson: 'training', intro: 'training', beginner: 'training', starter: 'training',
  easy: 'easy', simple: 'easy', gentle: 'easy',
  medium: 'medium', normal: 'medium', moderate: 'medium', intermediate: 'medium', average: 'medium',
  hard: 'hard', tricky: 'hard', tough: 'hard', difficult: 'hard', advanced: 'hard', challenging: 'hard',
  'very hard': 'very-hard', 'very-hard': 'very-hard', veryhard: 'very-hard', 'really hard': 'very-hard', 'super hard': 'very-hard',
  expert: 'expert', extreme: 'expert', insane: 'expert', master: 'expert', legendary: 'expert', impossible: 'expert',
};

const MEDIUM = DIFFICULTIES.find((d) => d.id === 'medium');

/**
 * The row for a difficulty label, read generously. A number counts from Easy
 * (1 Easy … 5 Expert), the way the map picker writes it.
 */
export function difficultyOf(label) {
  if (typeof label === 'number' && isFinite(label)) {
    const rank = Math.max(2, Math.min(6, Math.round(label) + 1));
    return DIFFICULTIES.find((d) => d.rank === rank);
  }
  const s = String(label == null ? '' : label).toLowerCase().trim().replace(/[_]+/g, ' ').replace(/\s+/g, ' ');
  if (!s) return MEDIUM;
  const id = DIFFICULTY_WORDS[s] || DIFFICULTY_WORDS[s.replace(/-/g, ' ')];
  if (id) return DIFFICULTIES.find((d) => d.id === id);
  // 'Very Tricky', 'Hard+' and the like: the strongest word in it wins.
  if (/expert|extreme|insane|impossible/.test(s)) return DIFFICULTIES.find((d) => d.id === 'expert');
  if (/very|super|really/.test(s) && /hard|tricky|tough|difficult/.test(s)) return DIFFICULTIES.find((d) => d.id === 'very-hard');
  if (/hard|tricky|tough|difficult|advanced/.test(s)) return DIFFICULTIES.find((d) => d.id === 'hard');
  if (/easy|simple|gentle/.test(s)) return DIFFICULTIES.find((d) => d.id === 'easy');
  if (/train|tutorial|lesson|learn/.test(s)) return DIFFICULTIES.find((d) => d.id === 'training');
  return MEDIUM;
}

/**
 * How hard a difficulty label is, as a number: 0 Free, 1 Training, 2 Easy,
 * 3 Medium, 4 Hard, 5 Very hard, 6 Expert. Sort by this — the pay does, so a
 * list sorted with it and the credits on its cards always agree.
 */
export function difficultyRank(label) {
  return difficultyOf(label).rank;
}

/**
 * How demanding each mission heading really is (the headings are menus.js's
 * MISSION_CATEGORIES, plus the rocket's Space). Placed by reading the missions
 * under each one, not by the name on the heading:
 *
 *   1 Practice  Training — one new thing at a time, nothing to break (First
 *               Run is "learn where the pedals are").
 *   2 Jobs      Deliveries and Passengers & cargo — a clock and a load, flown
 *               or driven somewhere ordinary. Meteor mode — dodging and
 *               zapping rocks in the Courier, an arcade game in the sky.
 *   3 Danger    Rescue and Firefighting — hovering over the sea, winching off
 *               a deck at night, a lifeboat in a gale, scooping water and
 *               dropping it on a moving fire. Challenges — a timed lap of an
 *               erupting volcano in the fighter, three passes through a
 *               tornado. Emergencies — a dead engine over the sea, a hijack.
 *               Space — landing a booster on a ship.
 *   4 Elite     Military — behind the passcode, in the twitchiest aeroplanes
 *               in the game: a trap on a moving carrier deck, the tailless
 *               wing at night below 500 feet.
 *
 * A heading that is not listed (a team invents "Stunts") pays as Jobs until
 * somebody places it here.
 */
export const CATEGORY_TIERS = [
  { tier: 1, name: 'Practice', mult: 1, categories: ['training'] },
  { tier: 2, name: 'Jobs', mult: 1.25, categories: ['delivery', 'airline', 'meteor'] },
  { tier: 3, name: 'Danger', mult: 1.5, categories: ['rescue', 'fire', 'challenge', 'events', 'space'] },
  { tier: 4, name: 'Elite', mult: 1.75, categories: ['military'] },
];
const DEFAULT_TIER = CATEGORY_TIERS[1];

/** The tier a heading id is in. */
export function categoryTier(category) {
  const id = String(category == null ? '' : category).toLowerCase().trim();
  return CATEGORY_TIERS.find((t) => t.categories.includes(id)) || DEFAULT_TIER;
}

/*
 * Which heading a mission is under. menus.js owns that answer
 * (missionCategory(): the mission's own `category`, a table for the old ones,
 * the passcode, the words in its name) and hands it over when it loads — so
 * the pay and the board can never disagree about where a mission sits, and
 * this file does not have to import the whole menu to find out. Until it has,
 * a mission's own `category` field is used as written.
 */
let categoryResolver = null;
export function setCategoryResolver(fn) {
  categoryResolver = typeof fn === 'function' ? fn : null;
}
export function categoryOfMission(m) {
  if (!m) return '';
  if (categoryResolver) {
    try {
      return categoryResolver(m);
    } catch (e) {
      /* fall through to the field */
    }
  }
  return String(m.category || '').toLowerCase().trim();
}

/**
 * The settings difficulty, as today: Easy pays less, which is the honest trade
 * for a softer undercarriage; Realistic pays more for a harder one.
 */
export const SETTINGS_PAY = { easy: 0.6, normal: 1, realistic: 1.5 };

/*
 * Games whose vehicle does not read the settings difficulty, so it must not
 * change their pay either. The rocket flies the same on every setting.
 */
const SETTINGS_FREE_GAMES = ['rocket'];

/** Finishing at all earns this share of the most; the score earns the rest. */
export const SCORE_FLOOR = 0.4;

function settingsMult(settings, game) {
  if (game && SETTINGS_FREE_GAMES.includes(game)) return 1;
  return SETTINGS_PAY[settings] || 1;
}

/**
 * The most a mission can pay — the number on its card.
 *
 * @param {object} mission   a mission def, or just { difficulty, category }
 * @param {object} [o]
 * @param {string} [o.category]  the heading id, if the caller already knows it
 * @param {string} [o.settings]  'easy' | 'normal' | 'realistic'
 * @param {string} [o.game]      'flight' | 'heli' | 'boat' | 'car' | 'rocket'
 * @returns {number} credits, a round ten
 */
export function maxPayout(mission, { category, settings = 'normal', game } = {}) {
  const m = mission || {};
  const cat = category != null ? category : categoryOfMission(m);
  const raw = difficultyOf(m.difficulty).pay * categoryTier(cat).mult * settingsMult(settings, game || m.game);
  return Math.max(10, Math.round(raw / 10) * 10);
}

/** What a finished mission pays at a score of 0–100. Never more than the most. */
export function payoutFor(max, score) {
  const s = Math.max(0, Math.min(1, (Number(score) || 0) / 100));
  return Math.min(max, Math.round((max * (SCORE_FLOOR + (1 - SCORE_FLOOR) * s)) / 5) * 5);
}

/** The one small line on a mission card or a briefing. */
export function payLine(max) {
  return `Up to ${formatCredits(max)} credits`;
}

/**
 * The debrief's row for what award() paid: "Credits +230 of up to 270". Empty
 * when nothing was paid, so a crash's debrief does not mention money at all.
 */
export function debriefPayRow(paid) {
  if (!paid || !(paid.credits > 0)) return '';
  const of = paid.max ? ` <span class="debrief-pay-of">of up to ${formatCredits(paid.max)}</span>` : '';
  return `<li class="debrief-pay" data-debrief-pay>Credits <b>+${formatCredits(paid.credits)}</b>${of}</li>`;
}

/*
 * What a run that is not one of the missions is priced as.
 *
 * Flight school is a long lesson — a Medium in Training. A free flight (the
 * rocket's free launches, today the only free flight that finishes) pays "a
 * little", as main.js always said it should: the Free row, in its category.
 */
const TUTORIAL_AS = { difficulty: 'Medium', category: 'training' };
const FREE_AS = { difficulty: 'Free', category: 'free' };

/**
 * Pay for a flight.
 *
 * Deliberately weighted towards *how* you flew rather than how long: a gentle
 * landing is worth more than a long cruise, because that is the thing worth
 * practising. Crashing pays nothing, but it does not take anything away —
 * losing credits for crashing punishes exactly the person who most needs to
 * keep trying.
 *
 * `difficulty` is the SETTINGS difficulty (easy / normal / realistic), as it
 * always was. The mission's own difficulty and heading come from `mission` —
 * the def that was flown, or just { difficulty, category } — and `category`
 * overrides the heading when the caller knows better.
 *
 * @returns {{credits:number, total:number, max:number}}
 */
export function award(p, { kind, score = 0, crashed = false, difficulty = 'normal', label = '', mission = null, category, game } = {}) {
  const priced = kind === 'tutorial' ? TUTORIAL_AS : kind === 'free' ? FREE_AS : mission || {};
  const max = maxPayout(priced, { category, settings: difficulty, game: game || (mission && mission.game) });
  if (crashed) return { credits: 0, total: p.credits, max };
  const earned = payoutFor(max, score);
  p.credits += earned;
  p.earned += earned;
  // The leaderboard: your five best, ever.
  p.best.push({ label: label || kind, score: Math.round(score), credits: earned, date: new Date().toISOString().slice(0, 10) });
  p.best.sort((a, b) => b.score - a.score);
  p.best = p.best.slice(0, 5);
  save(p);
  return { credits: earned, total: p.credits, max };
}

export function isUnlocked(p, aircraftId) {
  return p.unlocked.includes(aircraftId);
}

/** True if this aeroplane needs the passcode and has not been let through. */
export function needsPasscode(p, type) {
  return !!(type && type.military) && !p.militaryUnlocked;
}

export function enterPasscode(p, raw) {
  if (String(raw || '').trim().toUpperCase() !== MILITARY_CODE) {
    return { ok: false, why: 'That is not the word' };
  }
  p.militaryUnlocked = true;
  /*
   * Only say it opened if it actually stayed open.
   *
   * save() swallows its own failure — a full quota, a private window, a
   * locked-down school profile — and returns false. Reporting success anyway
   * gave you a session that worked perfectly and an unlock that was gone next
   * morning, which is precisely the "go and ask for the word again" this is
   * supposed to prevent. It still works for this session; you are just told.
   */
  if (!save(p)) {
    return { ok: true, warn: 'Open for now — this browser would not save it, so you may have to enter it again.' };
  }
  return { ok: true };
}

/** Is the workbench open? */
export function isDev(p) {
  return !!(p && p.devUnlocked);
}

export function enterDevCode(p, raw) {
  if (String(raw || '').trim().toUpperCase() !== DEV_CODE) {
    return { ok: false, why: 'That is not the word' };
  }
  p.devUnlocked = true;
  if (!save(p)) {
    return { ok: true, warn: 'Open for now — this browser would not save it, so you may have to enter it again.' };
  }
  return { ok: true };
}

export function leaveDev(p) {
  p.devUnlocked = false;
  save(p);
}

export function costOf(aircraftId) {
  const u = UNLOCKS.find((x) => x.aircraft === aircraftId);
  return u ? u.cost : 0;
}

/** @returns {{ok:boolean, why?:string}} */
export function buy(p, aircraftId) {
  if (isUnlocked(p, aircraftId)) return { ok: false, why: 'Already yours' };
  const cost = costOf(aircraftId);
  if (!cost) return { ok: false, why: 'Not for sale' };
  if (p.credits < cost) return { ok: false, why: `${cost - p.credits} more credits needed` };
  p.credits -= cost;
  p.unlocked.push(aircraftId);
  save(p);
  return { ok: true };
}

/**
 * Codes.
 *
 * The class asked for discount codes you get by asking the CEO, which is a
 * lovely idea and costs nothing to honour: these are just words that pay out
 * once each, and whoever runs the game decides who is told about them.
 *
 * The words themselves are NOT in this file, or anywhere else in the game.
 * This file is public JavaScript — anyone can open it in the browser — and a
 * list of code words here is a list of free credits for whoever reads it,
 * which is exactly how a friend once handed themselves a billion. What is kept
 * here is each code's SHA-256 fingerprint and what it grants. Typing a code
 * hashes it and looks the hash up; a hash cannot be turned back into the word.
 *
 * The amount or rank sits beside the hash rather than being read out of the
 * code's name: a name that said what it paid was the second half of the leak,
 * because a word that ends in "1b" tells anyone who sees it over a shoulder
 * precisely what it is worth.
 *
 * To add a code: `node tools/hash-code.mjs`, type the word and what it should
 * be worth, and paste the printed line in below. Nothing else. Every code that
 * was on the old plaintext list has been retired — none of them works now.
 *
 * Shape: '<64 hex>': { credits: <number>, note: '<why>' }
 *    or: '<64 hex>': { rank: 'founder' | 'admin' | 'mod', note: '<why>' }
 */
export const CODES = Object.freeze({
  // Nothing shipped. The owner adds their own entries here, privately.
});

/**
 * Pattern codes: a PREFIX the owner chooses, followed by the AMOUNT it pays.
 *
 * One hashed word that pays whatever number is typed after it, so the owner
 * does not have to make (and remember) a separate code for 500, for 1,000
 * and for 2,500 — `PREFIX500` pays 500, `PREFIX1.5K` pays 1,500,
 * `PREFIX2M` pays two million. The game splits what was typed at its FIRST
 * DIGIT: everything before it is the prefix (so a prefix has no digits in
 * it), everything from it on is the amount. The prefix is hashed the same way
 * a whole code is (trimmed, lower-cased, SHA-256) and looked up here; the
 * amount is read by parseCodeAmount() below.
 *
 * Each exact code — this prefix with THIS amount — works once per player:
 * the wallet stamps the fingerprint of the normalised code (lower-cased
 * prefix followed by the amount as a plain number, so `PREFIX0.5K` and
 * `PREFIX500` are one code, not two). A different amount is a different code.
 *
 * As with CODES, the words themselves are not here and never will be. Make an
 * entry with `node tools/hash-code.mjs --prefix` and paste the printed line.
 *
 * Shape: '<64 hex>': { note: '<why>' }
 *    or: '<64 hex>': { note: '<why>', max: <the most one code may pay> }
 */
export const PREFIXES = Object.freeze({
  // Nothing shipped. The owner adds their own entries here, privately.
});

/** The most any pattern code may pay, whatever the owner's entry says. */
export const CODE_AMOUNT_MAX = 1000000000;

/**
 * The amount part of a pattern code, as a whole number of credits — or null
 * when it is not one.
 *
 *   digits, an optional '.' with one or two decimals, an optional K / M / B
 *   (thousand / million / billion, either case); no suffix is a plain number.
 *
 *   500 → 500   1.5K → 1500   1.25K → 1250   2M → 2000000   1B → 1000000000
 *
 * Refused: three or more decimals (1.255K), an amount that does not come to a
 * whole credit (1.5 with no suffix, 1.2345K), zero, and anything over a
 * billion. The arithmetic is done in whole hundredths so 1.1K is exactly 1100
 * and never 1100.0000000000002.
 */
export function parseCodeAmount(text) {
  const s = String(text == null ? '' : text).trim();
  const m = /^(\d{1,12})(?:\.(\d{1,2}))?([kmb])?$/i.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = m[2] ? Number(m[2].padEnd(2, '0')) : 0;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[(m[3] || '').toLowerCase()] || 1;
  const hundredths = (whole * 100 + frac) * mult;
  if (!Number.isSafeInteger(hundredths) || hundredths % 100 !== 0) return null;
  const amount = hundredths / 100;
  if (amount <= 0 || amount > CODE_AMOUNT_MAX) return null;
  return amount;
}

/**
 * A typed code split into its prefix and its amount, or null when it has no
 * such shape (no digit in it, or it starts with one — a prefix is at least a
 * letter). Nothing here says whether the prefix is a real one.
 */
export function splitPatternCode(raw) {
  const typed = String(raw == null ? '' : raw).trim();
  const i = typed.search(/\d/);
  if (i <= 0) return null;
  const amount = parseCodeAmount(typed.slice(i));
  if (amount === null) return null;
  // Trimmed: "WORD 500" is the same code as "WORD500" (the hash trims the
  // prefix anyway), so it must stamp the same fingerprint, or a space would
  // let one code pay twice.
  const prefix = typed.slice(0, i).trim();
  if (!prefix) return null;
  return { prefix, amount };
}

/**
 * SHA-256 in plain JavaScript, for the places crypto.subtle is missing — a
 * phone opening the game over a plain-http LAN address in a classroom is not
 * a secure context, and it should still be able to type a code. Byte-for-byte
 * the same answer as crypto.subtle (tests/features/redeem-codes.mjs checks it
 * against node:crypto), so which one ran never matters.
 */
const SHA_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256Hex(input) {
  const msg = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  const len = msg.length;
  // Pad to a multiple of 64 bytes: 0x80, zeros, then the bit length as 64 bits.
  const padded = new Uint8Array(((len + 9 + 63) >> 6) << 6);
  padded.set(msg);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  const bits = len * 8;
  dv.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  dv.setUint32(padded.length - 4, bits >>> 0);

  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + SHA_K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  let out = '';
  for (let i = 0; i < 8; i++) out += H[i].toString(16).padStart(8, '0');
  return out;
}

/**
 * The fingerprint of a typed code: SHA-256 of it trimmed and lower-cased, as
 * hex. Case-insensitive because nobody types a code the way it was written
 * down, and the SAME normalisation the owner's tool uses, or a code would
 * work in the tool and fail in the game. crypto.subtle when the page has it,
 * the plain-JavaScript version when it does not.
 */
export async function codeHash(raw) {
  const text = String(raw == null ? '' : raw).trim().toLowerCase();
  const bytes = new TextEncoder().encode(text);
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const buf = await subtle.digest('SHA-256', bytes);
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
      // Fall through to the plain version: an odd browser, not a wrong code.
    }
  }
  return sha256Hex(bytes);
}

/** True if `s` has the shape of a code fingerprint — 64 hex characters. */
export function isCodeHash(s) {
  return typeof s === 'string' && /^[0-9a-f]{64}$/.test(s);
}

/**
 * A credit balance short enough to sit in the nav bar.
 *
 * Full grouped numbers below ten thousand, because 2,450 is a number a
 * ten-year-old reads at a glance and "2.5k" is one they have to decode.
 * Above that the digits stop meaning anything individually, so it goes
 * compact — and a billion-credit code would otherwise be thirteen characters
 * wide and push the switcher off a phone screen.
 */
export function formatCredits(n) {
  const v = Math.round(Number(n) || 0);
  if (v < 10000) return v.toLocaleString();
  const at = (scale, suffix) => {
    const x = v / scale;
    return `${x < 100 ? +x.toFixed(1) : Math.round(x)}${suffix}`;
  };
  // The boundaries are where the ROUNDED figure would tip over, not where the
  // real one does — otherwise 999,999 credits show as "1000k", which is a
  // million written the long way round.
  if (v < 999500) return at(1e3, 'k');
  if (v < 999500000) return at(1e6, 'M');
  return at(1e9, 'B');
}

/**
 * Redeem a typed code against `table` (the shipped CODES unless a test hands
 * in its own) and, failing that, as a pattern code against `prefixes` (the
 * shipped PREFIXES): a known prefix followed by an amount. Asynchronous,
 * because the hash is.
 *
 * The answers are the same three sentences the box has always shown — a blank,
 * a word that is not a code, a code already used — and a pay-out says what it
 * was for. Nothing about the result reveals which codes exist: a retired code
 * and a made-up one get the same answer.
 *
 * The `redeemed` list remembers the fingerprint, never the word.
 */
export async function redeem(p, raw, table = CODES, prefixes = PREFIXES) {
  const typed = String(raw || '').trim();
  if (!typed) return { ok: false, why: 'Type a code first' };

  const own = (t, k) => !!t && typeof t === 'object' && Object.prototype.hasOwnProperty.call(t, k) && t[k] && typeof t[k] === 'object';
  const hash = await codeHash(typed);
  let entry = own(table, hash) ? table[hash] : null;
  // The fingerprint the wallet keeps: the whole code's, or for a pattern code
  // the normalised code's (lower-cased prefix, then the amount as a number).
  let stamp = hash;
  if (!entry) {
    // Not a whole code: perhaps a prefix with an amount after it (PREFIXES).
    const pat = splitPatternCode(typed);
    if (pat) {
      const ph = await codeHash(pat.prefix);
      const pe = own(prefixes, ph) ? prefixes[ph] : null;
      const cap = pe && Number.isFinite(Number(pe.max)) && Number(pe.max) > 0 ? Math.min(Number(pe.max), CODE_AMOUNT_MAX) : CODE_AMOUNT_MAX;
      if (pe && pat.amount <= cap) {
        entry = { credits: pat.amount, note: pe.note };
        stamp = await codeHash(`${pat.prefix.toLowerCase()}${pat.amount}`);
      }
    }
  }
  if (!entry) return { ok: false, why: 'That code does not work' };

  if (!Array.isArray(p.redeemed)) p.redeemed = [];
  if (p.redeemed.includes(stamp)) return { ok: false, why: 'You have already used that one' };

  const amount = Math.max(0, Math.round(Number(entry.credits) || 0));
  const rank = typeof entry.rank === 'string' && entry.rank ? entry.rank : null;
  if (!amount && !rank) return { ok: false, why: 'That code does not work' };

  p.redeemed.push(stamp);
  if (amount) {
    p.credits += amount;
    p.earned += amount;
  }
  if (rank) p.grantedRank = rank;
  save(p);
  return { ok: true, credits: amount, rank, note: entry.note || 'Code accepted' };
}

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

/**
 * Pay for a flight.
 *
 * Deliberately weighted towards *how* you flew rather than how long: a gentle
 * landing is worth more than a long cruise, because that is the thing worth
 * practising. Crashing pays nothing, but it does not take anything away —
 * losing credits for crashing punishes exactly the person who most needs to
 * keep trying.
 */
export function award(p, { kind, score = 0, crashed = false, difficulty = 'normal', label = '' }) {
  if (crashed) return { credits: 0, total: p.credits };
  const base = kind === 'mission' ? 120 : kind === 'tutorial' ? 200 : 25;
  // Easy pays less, which is the honest trade for a softer undercarriage.
  const mult = difficulty === 'easy' ? 0.6 : difficulty === 'realistic' ? 1.5 : 1;
  const earned = Math.round((base + score * 2.2) * mult);
  p.credits += earned;
  p.earned += earned;
  // The leaderboard: your five best, ever.
  p.best.push({ label: label || kind, score: Math.round(score), credits: earned, date: new Date().toISOString().slice(0, 10) });
  p.best.sort((a, b) => b.score - a.score);
  p.best = p.best.slice(0, 5);
  save(p);
  return { credits: earned, total: p.credits };
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
 */
/**
 * Codes, named so the name says what it is worth.
 *
 * The convention is `<whoever><amount>`: doritofc1k is a thousand credits,
 * doritofc1m is a million, doritofc1b is a billion, kestrel500 is five
 * hundred. The amount is PARSED OUT OF THE NAME rather than written beside
 * it, so the two can never disagree — a code called 1m cannot quietly be
 * worth 1000, which is exactly the sort of thing that goes unnoticed for
 * months and then makes someone feel cheated.
 *
 * Only codes on this list work. The suffix decides the amount; it does not
 * mint credits on its own, or anyone could type `me99b` and help themselves.
 *
 * To add one: put the name on the list with a note. Nothing else.
 */
const CREDIT_CODES = {
  doritofc1k: 'For Dorito',
  doritofc1m: 'For Dorito, seriously',
  doritofc1b: 'For Dorito, absurdly',
  firstsolo300: 'Your first solo',
  kestrel500: 'Island hopper',
  tornado800: 'You went and looked',
  classof29_1500: 'For the class that tested it',
};

/** Rank grants, which are appointed rather than earned. */
const RANK_CODES = {
  FOUNDER: { rank: 'founder', note: 'There is one' },
  ADMIN: { rank: 'admin', note: 'Appointed' },
  MOD: { rank: 'mod', note: 'Appointed' },
};

/**
 * How much a suffix multiplies by. Thousand, million, billion, and that is
 * where it stops — there is nothing in the game that costs more than a
 * billion credits, so a `t` would only be a number with no meaning behind it.
 */
const SCALES = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * Read the payout off the end of a code name.
 *
 * `1k` → a thousand, `1m` → a million, `1b` → a billion, `2500` → itself.
 * Returns 0 if the name does not end in a number, which is how a rank code or
 * a typo fails safely rather than paying out something arbitrary.
 */
export function creditsInName(name) {
  const m = String(name).toLowerCase().match(/(\d+)([kmb]?)$/);
  if (!m) return 0;
  return Number(m[1]) * (SCALES[m[2]] || 1);
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

export function redeem(p, raw) {
  // Case-insensitive, because nobody types a code the way it was written down.
  const typed = String(raw || '').trim();
  if (!typed) return { ok: false, why: 'Type a code first' };
  const key = typed.toLowerCase();
  const upper = typed.toUpperCase();

  const creditNote = Object.keys(CREDIT_CODES).find((k) => k.toLowerCase() === key);
  const rankCode = RANK_CODES[upper];
  if (!creditNote && !rankCode) return { ok: false, why: 'That code does not work' };

  const stamp = creditNote ? creditNote.toLowerCase() : upper;
  if (p.redeemed.includes(stamp)) return { ok: false, why: 'You have already used that one' };
  p.redeemed.push(stamp);

  if (creditNote) {
    const amount = creditsInName(creditNote);
    p.credits += amount;
    p.earned += amount;
    save(p);
    return { ok: true, credits: amount, rank: null, note: CREDIT_CODES[creditNote] };
  }
  p.grantedRank = rankCode.rank;
  save(p);
  return { ok: true, credits: 0, rank: rankCode.rank, note: rankCode.note };
}

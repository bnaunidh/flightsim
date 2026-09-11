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

const FREE = ['skylark', 'courier'];

/**
 * Military aircraft sit behind a passcode.
 *
 * This was the class's own idea, and it is a good one: they wanted the
 * military side gated so it is not simply there for anyone who opens the game.
 * It is not a security measure — anyone can read this file — it is a door, so
 * that flying the bomber is a thing you were let into rather than a thing you
 * wandered into. Whoever runs the game decides who gets told the word.
 */
export const MILITARY_CODE = 'REDTAIL';

function blank() {
  return {
    credits: 0,
    earned: 0, // lifetime, which is what the rank is based on
    militaryUnlocked: false,
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
  save(p);
  return { ok: true };
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
 * kestrel500 is five hundred. The amount is PARSED OUT OF THE NAME rather than
 * written beside it, so the two can never disagree — a code called 1k cannot
 * quietly be worth 500, which is exactly the sort of thing that goes unnoticed
 * for months and then makes someone feel cheated.
 *
 * Only codes on this list work. The suffix decides the amount; it does not
 * mint credits on its own, or anyone could type `me99k` and help themselves.
 *
 * To add one: put the name on the list with a note. Nothing else.
 */
const CREDIT_CODES = {
  doritofc1k: 'For Dorito',
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
 * Read the payout off the end of a code name.
 * `1k` / `2K` → thousands; a bare number → itself. Returns 0 if there is none.
 */
export function creditsInName(name) {
  const m = String(name).toLowerCase().match(/(\d+)(k?)$/);
  if (!m) return 0;
  const n = Number(m[1]);
  return m[2] === 'k' ? n * 1000 : n;
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

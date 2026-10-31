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

/*
 * Military aircraft are NOT behind a passcode any more (owner, 2026-10-30:
 * "remove military code, we dont need it"). This ChatGPT build shares its
 * save with the main game (same localStorage key), and the main game drops the
 * old `militaryUnlocked` flag, so this copy opens the military side too:
 * needsPasscode() is always false and the hangar's military box is gone.
 */

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
 * Case-insensitive, opens once, stays open. Only the fingerprint lives here
 * (`node tools/hash-code.mjs --passcode=dev` makes a new one).
 */
export const DEV_CODE_HASH = 'a78f8128f2109434daf14d867c665d97a242909409b29bc0a965111d8a4a9f80';

/**
 * Does `raw` open the door whose fingerprint is `hash`? Trimmed and
 * case-insensitive, exactly as the hangar's codes are, so `word`, ` WORD `
 * and `Word` are one word. A door with no fingerprint (not 64 hex) opens for
 * nothing, rather than for everything.
 */
async function isTheWord(raw, hash) {
  if (!isCodeHash(hash)) return false;
  return (await codeHash(raw)) === hash;
}

function blank() {
  return {
    credits: 0,
    earned: 0, // lifetime, which is what the rank is based on
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
    delete p.militaryUnlocked;
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

/** Kept for this copy's callers: nothing needs a passcode any more (see above). */
export function needsPasscode() {
  return false;
}

/** Is the workbench open? */
export function isDev(p) {
  return !!(p && p.devUnlocked);
}

/** Try a word at the workbench door (hashed: see isTheWord). */
export async function enterDevCode(p, raw, hash = DEV_CODE_HASH) {
  if (!(await isTheWord(raw, hash))) {
    return { ok: false, why: 'That is not the word' };
  }
  p.devUnlocked = true;
  if (!save(p)) {
    return { ok: true, warn: 'Open for now — this browser would not save it, so you may have to enter it again.' };
  }
  return { ok: true };
}

/**
 * SHA-256 in plain JavaScript, for the places crypto.subtle is missing — a
 * phone opening the game over a plain-http LAN address in a classroom is not
 * a secure context, and it should still be able to type a code. Byte-for-byte
 * the same answer as crypto.subtle (the same code as src/game/progression.js), so which one ran never matters.
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
 * Codes. RETIRED, all of them.
 *
 * This copy of the game is served from the same address as the main one and
 * shares its save (the same localStorage key), so a plaintext list here would
 * pay out into the real game. The words that used to be listed here leaked and
 * have been retired everywhere; the main game now keeps only SHA-256
 * fingerprints (src/game/progression.js CODES). In this copy no code works.
 */
const CREDIT_CODES = Object.freeze({});

/** Rank grants: none, for the same reason. */
const RANK_CODES = Object.freeze({});

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

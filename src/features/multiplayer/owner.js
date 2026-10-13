/**
 * Owner: "if i press the fan on the main page 10 times and put in the code
 * i get owner on that device for 1 hour".
 *
 * The same idea as an admin (./admin.js, whose header says why no code is in
 * any file of the game: the source is public), with the owner's own key and
 * label, and an hour on it:
 *
 *   d = SHA-256("island-flight-sim owner v1\n" + code.trim().toLowerCase()),
 *       hashed again (SHA-256 of d) until 0 < d < n
 *
 * What ships is the owner's PUBLIC key (x and y) and nothing else. The code
 * box on the main menu (../owner.js) works d out and keeps it only if its
 * public point is an owner key. Then:
 *
 *   - d signs a PASS for a brand-new random key made on this device, good
 *     for one hour: "this key is the owner's from iat until exp". d itself is
 *     zeroed straight away and never kept, anywhere. What this device keeps
 *     (localStorage) is the pass and the new key's private half, never the
 *     code and never d;
 *   - a host believes a player is the owner only after checking, itself:
 *     the pass is signed by an owner key, it is at most an hour long, it has
 *     not run out by the HOST's clock, and the player signed this host's
 *     fresh random nonce (bound to the host's id and the player's, as with
 *     an admin) with the pass's key. So a pass with its hour edited is not
 *     signed (the signature covers exp); a run-out one is refused by the host
 *     whatever the device says; a made-up one — the public x and y copied out
 *     of this file, with any key — is signed by nobody who matters. And the
 *     host takes the owner's powers away by itself when exp goes by;
 *   - on this device, at exp (or "End owner now") the pass and its key are
 *     wiped from memory and storage. A kept pass is checked, not trusted,
 *     when the game starts: run out → wiped; anything that does not check
 *     out → wiped.
 *
 * The hour belongs to the device it was made on as far as a browser can say
 * so: the pass is a bearer token for what is left of its hour. Anybody who
 * copies this device's localStorage within the hour holds it too, until exp —
 * the same as anybody at the keyboard. Nobody can make a longer one, or a new
 * one, without the code.
 *
 * Wrong codes: "Not that one", whatever is wrong, and only TRIES a minute
 * (kept in localStorage, and in memory for a browser that will not keep it).
 * That is manners, not the lock: the lock is that the code is long enough
 * that nobody guesses it from the public key.
 *
 * All of it is ./p256.js — BigInt, a few milliseconds a signature — so it is
 * the same on https and on a LAN server's plain http, where there is no
 * WebCrypto.
 *
 * `addOwnerKey` is for the tests: they add the TEST owner key (whose code is
 * in .claude/devtools, not in the game), and nothing ships with it.
 */

import { p256Ready, sha256, publicOf, sign as signJs, verify as verifyJs } from './p256.js';
import { b64url, unb64url } from './admin.js';

/** The prefix the code is hashed after. Part of the scheme: changing it changes the owner's key. */
export const OWNER_SCHEME = 'island-flight-sim owner v1\n';
/** How long a pass lasts: an hour. */
export const OWNER_MS = 60 * 60 * 1000;
/** How far ahead of a host's clock an owner's may run and still be believed (laptop clocks drift). */
export const CLOCK_SLACK_MS = 10 * 60 * 1000;
/** Wrong codes: this many a minute, then "wait a minute". */
export const TRIES = 3;
export const TRIES_MS = 60 * 1000;

const STORE_KEY = 'islandsim.owner.v1';
const TRIES_KEY = 'islandsim.owner.tries.v1';

/** The owner's public key. x and y only: the private half is made from the code, which is not in the game. */
const SHIPPED = Object.freeze([
  Object.freeze({ x: 'dV7q3YDzIVSKVzgTls283jQEh1mTeoBGthzVuZqPRJU', y: 'CmIonNc4pWPLkPUsm1vseg8enqsvjWveKHl8htj-qRs' }),
]);
const KEYS = [...SHIPPED];
const B64 = /^[A-Za-z0-9_-]{43}$/;
const SIG = /^[A-Za-z0-9_-]{86}$/;
const N_HEX = 'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551';

const utf8 = (s) => new TextEncoder().encode(String(s));
const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');
const inRange = (d) => {
  const h = hex(d);
  return /[1-9a-f]/.test(h) && h < N_HEX;
};

/** Every owner public key this copy accepts. */
export function ownerKeys() {
  return KEYS.map((k) => ({ x: k.x, y: k.y }));
}

/** One more public key accepted as an owner's — the tests' key, never shipped. False for anything that is not one. */
export function addOwnerKey(k) {
  if (!k || !B64.test(String(k.x)) || !B64.test(String(k.y))) return false;
  if (!KEYS.some((q) => q.x === k.x && q.y === k.y)) KEYS.push({ x: k.x, y: k.y });
  return true;
}

/** Back to only the shipped key. */
export function resetOwnerKeys() {
  KEYS.length = 0;
  KEYS.push(...SHIPPED);
}

const knownKey = (x, y) => KEYS.find((k) => k.x === x && k.y === y) || null;

/** Whether this browser can make or check an owner pass (BigInt). */
export function ownerCrypto() {
  return p256Ready();
}

/** The private number a code makes, as 32 bytes — the caller zeroes it. Null where there is no way to make one. */
export function deriveOwnerD(code) {
  if (!ownerCrypto()) return null;
  let d = sha256(utf8(OWNER_SCHEME + String(code == null ? '' : code).trim().toLowerCase()));
  for (let i = 0; i < 64 && !inRange(d); i++) d = sha256(d);
  return inRange(d) ? d : null;
}

/** What the owner's key signs: this key is the owner's from iat until exp (ms since 1970, both). */
export function passText(c) {
  return `island-flight-sim owner pass v1|${c.ox}|${c.oy}|${c.sx}|${c.sy}|${c.iat}|${c.exp}`;
}

/** What a pass's key signs to answer a host: as admin.js proofText, its own words so one is never the other. */
export function ownerProofText(n, hostId, peerId) {
  return `island-flight-sim owner proof v1|${n}|${hostId}|${peerId}`;
}

/** A pass as sent or kept, checked for shape only; null for anything else. */
export function readCred(c) {
  if (!c || typeof c !== 'object') return null;
  const { ox, oy, sx, sy, c: sig } = c;
  const iat = Number(c.iat);
  const exp = Number(c.exp);
  if (![ox, oy, sx, sy].every((v) => typeof v === 'string' && B64.test(v))) return null;
  if (typeof sig !== 'string' || !SIG.test(sig)) return null;
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp) || iat <= 0) return null;
  return { ox, oy, sx, sy, iat, exp, c: sig };
}

/** The pass is signed by an owner key this copy accepts, and is at most an hour long. Says nothing about now. */
function signedPass(cr) {
  if (!cr || !ownerCrypto()) return false;
  const k = knownKey(cr.ox, cr.oy);
  if (!k || !(cr.exp > cr.iat) || cr.exp - cr.iat > OWNER_MS) return false;
  return verifyJs(unb64url(k.x), unb64url(k.y), utf8(passText(cr)), unb64url(cr.c));
}

/** The pass holds at `now` (a host's clock): not run out, and not made in the future. */
function inTime(cr, now) {
  return cr.exp > now && cr.iat <= now + CLOCK_SLACK_MS;
}

/**
 * The host's check. The time the owner's pass runs out (ms since 1970, the
 * pass's own exp) if `sig` is the pass's key's signature of exactly `text`
 * and the pass is a good one at `now`; 0 for anything else. Never throws.
 */
export function verifyOwnerProof(text, sig, cred, now = Date.now()) {
  try {
    if (!ownerCrypto() || typeof text !== 'string' || typeof sig !== 'string' || !SIG.test(sig)) return 0;
    const cr = readCred(cred);
    if (!cr || !inTime(cr, now) || !signedPass(cr)) return 0;
    return verifyJs(unb64url(cr.sx), unb64url(cr.sy), utf8(text), unb64url(sig)) ? cr.exp : 0;
  } catch (err) {
    return 0;
  }
}

/** Whether d (kept: 43 characters) is the private half of (x, y). */
function owns(d, x, y) {
  if (!ownerCrypto() || typeof d !== 'string' || !B64.test(d)) return false;
  const raw = unb64url(d);
  if (!raw || raw.length !== 32) return false;
  let pub = null;
  try {
    pub = publicOf(raw);
  } catch (err) {
    pub = null;
  }
  return !!pub && b64url(pub.x) === x && b64url(pub.y) === y;
}

function randomD() {
  const u = new Uint8Array(32);
  for (let i = 0; i < 16; i++) {
    globalThis.crypto.getRandomValues(u);
    if (inRange(u)) return u;
  }
  throw new Error('no random key');
}

/* ---- this device's pass ------------------------------------------------- */

export class OwnerPass {
  constructor(cr, sd, devBefore = false) {
    Object.assign(this, { ox: cr.ox, oy: cr.oy, sx: cr.sx, sy: cr.sy, iat: cr.iat, exp: cr.exp, c: cr.c });
    /** The pass's key's private half (43 characters). Null once wiped. */
    this._sd = sd;
    /** Whether Dev mode was on before this hour started: it goes back to that at the end. */
    this.devBefore = !!devBefore;
  }

  /** One of the owner keys this copy accepts (a test key is not, once the tests are gone). */
  get known() {
    return !!knownKey(this.ox, this.oy);
  }

  /** Owner right now, on this device. */
  live(now = Date.now()) {
    return !!this._sd && this.known && this.exp > now;
  }

  /** How long is left, in ms. */
  left(now = Date.now()) {
    return Math.max(0, this.exp - now);
  }

  cred() {
    return { ox: this.ox, oy: this.oy, sx: this.sx, sy: this.sy, iat: this.iat, exp: this.exp, c: this.c };
  }

  /** The answer to a host's question: { o, c }, the signature and the pass — or null once the hour is over. */
  async answer(text) {
    if (!this.live()) return null;
    return { o: b64url(signJs(unb64url(this._sd), utf8(text))), c: this.cred() };
  }

  save() {
    if (!this._sd) return false;
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ on: 1, ...this.cred(), sd: this._sd, dev: this.devBefore ? 1 : 0 }));
      return true;
    } catch (err) {
      return false; // private mode: owner until this tab closes, or the hour is up
    }
  }

  /** Gone from memory: nothing left here signs anything. */
  wipe() {
    this._sd = null;
  }

  /**
   * Try a code. The pass it makes, or null — the same null for every kind of
   * wrong. d is worked out, checked against the owner keys, signs the pass,
   * and is zeroed; it is never kept and never leaves this function.
   */
  static fromCode(code, { now = Date.now(), devBefore = false } = {}) {
    const typed = String(code == null ? '' : code).trim();
    if (!typed || typed.length > 200 || !ownerCrypto()) return null;
    let d = null;
    try {
      d = deriveOwnerD(typed);
      if (!d) return null;
      const pub = publicOf(d);
      const k = pub && knownKey(b64url(pub.x), b64url(pub.y));
      if (!k) return null;
      const sd = randomD();
      const spub = publicOf(sd);
      const iat = Math.floor(now);
      const cr = { ox: k.x, oy: k.y, sx: b64url(spub.x), sy: b64url(spub.y), iat, exp: iat + OWNER_MS };
      cr.c = b64url(signJs(d, utf8(passText(cr))));
      const pass = new OwnerPass(cr, b64url(sd), devBefore);
      sd.fill(0);
      return pass;
    } catch (err) {
      return null;
    } finally {
      if (d) d.fill(0);
    }
  }

  /**
   * What this device kept, checked: { pass } for a good one still in its
   * hour; { pass: null, ended: true, devBefore } for a real one that has run
   * out (wiped here); { pass: null } for nothing, or anything that does not
   * check out (wiped too). A pass under a key this copy does not accept (a
   * test key, the tests gone) is left alone and not used.
   */
  static load(now = Date.now()) {
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (err) {
      s = undefined;
    }
    if (s === null) return { pass: null };
    const cr = s && s.on === 1 ? readCred(s) : null;
    if (!cr || typeof s.sd !== 'string' || !B64.test(s.sd)) {
      OwnerPass.forget();
      return { pass: null, dropped: true };
    }
    if (!knownKey(cr.ox, cr.oy) || !ownerCrypto()) return { pass: null };
    const real = signedPass(cr) && owns(s.sd, cr.sx, cr.sy);
    if (!real) {
      OwnerPass.forget();
      return { pass: null, dropped: true };
    }
    if (!inTime(cr, now) || cr.exp - now > OWNER_MS + CLOCK_SLACK_MS) {
      OwnerPass.forget();
      return { pass: null, ended: true, devBefore: s.dev === 1 };
    }
    return { pass: new OwnerPass(cr, s.sd, s.dev === 1) };
  }

  /** Owner off on this device: what was kept is gone. */
  static forget() {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch (err) {
      /* nothing kept */
    }
  }
}

/* ---- wrong codes: a few a minute ------------------------------------------ */

let memTries = [];

function readTries(now) {
  let kept = [];
  try {
    const v = JSON.parse(localStorage.getItem(TRIES_KEY) || '[]');
    if (Array.isArray(v)) kept = v.filter((t) => Number.isFinite(t));
  } catch (err) {
    kept = [];
  }
  // A clock put back does not give tries back: anything "from the future" still counts until the clock passes it.
  // Storage cleared by hand does not either: what this tab remembers counts too, whichever list is longer.
  const recent = (list) => list.filter((t) => t > now - TRIES_MS).sort((a, b) => a - b);
  const a = recent(kept);
  const b = recent(memTries);
  return a.length >= b.length ? a : b;
}

function writeTries(list) {
  memTries = list.slice(-TRIES * 2);
  try {
    if (memTries.length) localStorage.setItem(TRIES_KEY, JSON.stringify(memTries));
    else localStorage.removeItem(TRIES_KEY);
  } catch (err) {
    /* in memory only */
  }
}

/** { ok } if a code may be tried now; else { ok: false, waitMs }. */
export function mayTry(now = Date.now()) {
  const list = readTries(now);
  if (list.length < TRIES) return { ok: true, waitMs: 0 };
  return { ok: false, waitMs: Math.max(1000, list[list.length - TRIES] + TRIES_MS - now) };
}

export function noteWrong(now = Date.now()) {
  writeTries([...readTries(now), now]);
}

export function clearTries() {
  writeTries([]);
}

/* ---- the owner, on this device ---------------------------------------------- */

/**
 * This device's owner state: the pass if there is one, wiped at exp or by
 * end(). Listeners hear { on: true, pass } when an hour starts and
 * { on: false, why, devBefore } when one ends (why: 'ended' — "End owner
 * now" —, 'expired', or 'elsewhere' — another tab of this browser ended it).
 */
class OwnerState {
  constructor() {
    this.pass = null;
    this.now = () => Date.now();
    this._fns = new Set();
    this._timer = null;
    this._watching = false;
  }

  /** The pass, while it is the owner's hour on this device; else null. */
  current() {
    return this.pass && this.pass.live(this.now()) ? this.pass : null;
  }

  get active() {
    return !!this.current();
  }

  /** Until when (ms since 1970), or 0. */
  get until() {
    const p = this.current();
    return p ? p.exp : 0;
  }

  on(fn) {
    this._fns.add(fn);
    return () => this._fns.delete(fn);
  }

  _emit(e) {
    for (const fn of [...this._fns]) {
      try {
        fn(e);
      } catch (err) {
        console.error('[owner] a listener threw', err);
      }
    }
  }

  /** What was kept, checked (OwnerPass.load). Returns what load said, so a run-out hour's Dev mode can be put back. */
  load() {
    const r = OwnerPass.load(this.now());
    if (r.pass) {
      this.pass = r.pass;
      this._arm();
    }
    this._watch();
    return r;
  }

  /**
   * A code from the main menu's box. { ok: true, until } for the owner's
   * code; { ok: false, why: 'wrong' } for anything else; { ok: false, why:
   * 'wait', waitMs } when too many were tried this minute. `devNow`: whether
   * Dev mode is on right now — what it goes back to after the hour (if an
   * hour is already running, what it was before that one).
   */
  tryCode(code, devNow = false) {
    const now = this.now();
    const gate = mayTry(now);
    if (!gate.ok) return { ok: false, why: 'wait', waitMs: gate.waitMs };
    const running = this.current();
    const pass = OwnerPass.fromCode(code, { now, devBefore: running ? running.devBefore : devNow });
    if (!pass) {
      noteWrong(now);
      return { ok: false, why: 'wrong' };
    }
    clearTries();
    if (this.pass && this.pass !== pass) this.pass.wipe();
    this.pass = pass;
    pass.save();
    this._arm();
    this._watch();
    this._emit({ on: true, pass });
    return { ok: true, until: pass.exp };
  }

  /** The hour is over: wiped, here and in storage. False if there was none. */
  end(why = 'ended') {
    const p = this.pass;
    clearTimeout(this._timer);
    this._timer = null;
    this.pass = null;
    if (why !== 'elsewhere') OwnerPass.forget();
    if (!p) return false;
    p.wipe();
    this._emit({ on: false, why, devBefore: p.devBefore });
    return true;
  }

  /** Ends a pass whose hour is up. Cheap; called every second while one runs, and by the timer at exp. */
  check() {
    if (this.pass && !this.pass.live(this.now())) this.end('expired');
  }

  _arm() {
    clearTimeout(this._timer);
    this._timer = null;
    if (!this.pass) return;
    const ms = Math.min(2 ** 31 - 1, Math.max(0, this.pass.exp - this.now()) + 25);
    this._timer = setTimeout(() => this.check(), ms);
  }

  /** Another tab of this browser ended the hour (its "End owner now"): this one ends too. */
  _watch() {
    if (this._watching || typeof window === 'undefined' || !window.addEventListener) return;
    this._watching = true;
    window.addEventListener('storage', (e) => {
      if (e.key === STORE_KEY && e.newValue === null && this.pass) this.end('elsewhere');
    });
  }
}

/** This device's owner. */
export const owner = new OwnerState();

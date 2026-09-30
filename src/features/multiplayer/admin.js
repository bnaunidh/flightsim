/**
 * Admin: "if i put in the code in the hangar it gives me admin in every
 * server, and i get access to other private servers, i can kick, mute,
 * freeze, close server etc."
 *
 * THE GAME'S SOURCE IS PUBLIC (GitHub Pages and a source zip), so nothing in
 * it may be the code or anything the code can be worked back from. What is
 * here is a PUBLIC key — the x and y of a point on the P-256 curve — and the
 * rule that turns a code into the matching private number:
 *
 *   d = SHA-256("island-flight-sim admin v1\n" + code.trim().toLowerCase()),
 *       hashed again (SHA-256 of d) until 0 < d < n
 *
 * Only the code gives that d, and only that d signs anything the public key
 * accepts. So:
 *
 *   - the hangar's code box (menus.js, through extensions.js' code hook)
 *     works d out, imports { kty, crv, x, y, d } as an ECDSA P-256 key in
 *     WebCrypto for each admin public key the game knows, and keeps it if a
 *     signature made with it checks out against that public key. A wrong
 *     code is simply not an admin code: it falls through to the ordinary
 *     codes, which say "That code does not work" — no hint which part was
 *     wrong, and nothing to try against but the code itself;
 *   - what is kept, on this device only, is a flag and the derived key
 *     (localStorage) — never the code. What is kept is not taken on trust
 *     when the game starts: its d must work out (p256.js) to exactly the x
 *     and y kept beside it, and those must be an admin key's. A flag made up
 *     by hand — the public x and y, copied out of this file, with any d — is
 *     not an admin, and is forgotten; so is anything else whose d is not
 *     that key's private half. (A host is its own server and takes its own
 *     word for being an admin, so this check is what stands between a faked
 *     flag and every game that device hosts.)
 *   - an admin proves it to a host by signing the host's FRESH RANDOM nonce,
 *     bound to the host's id and the admin's own id as the matchmaking server
 *     stamps them (proofText). The host checks it with the public key. A
 *     signature is good for that one question, from that one host, to that
 *     one socket: nothing an ordinary client can copy, replay or relay from
 *     somebody else's game makes it an admin (tests/features/multiplayer.admin.mjs).
 *
 * The HOST enforces everything an admin does, in every lobby, Wi-Fi, World
 * or private: a host believes a player is an admin only after checking
 * their signature itself, and a player's "I am an admin" is only a request
 * to be asked. What the other players see (the ADMIN badge, the crown) is
 * what the host says, like everything else in a game: a host is the server.
 *
 * Without WebCrypto — plain http on a school network's LAN server, where
 * crypto.subtle does not exist — the same maths runs from ./p256.js: the
 * same d, the same key (checked against the public key directly), and
 * signatures in the same format, so an admin and a host need not both be on
 * https or both on http.
 *
 * `addAdminKey` is for the tests: they add the TEST key (whose code is in
 * .claude/devtools, not in the game) so the checks can run without the real
 * code, and nothing ships with it.
 */

import { p256Ready, sha256 as sha256js, publicOf, sign as signJs, verify as verifyJs } from './p256.js';

/** The prefix the code is hashed after. Part of the scheme: changing it changes every admin's key. */
export const ADMIN_SCHEME = 'island-flight-sim admin v1\n';
const STORE_KEY = 'islandsim.admin.v1';

/** The owner's public key. x and y only: the private half is made from the code, which is not in the game. */
const SHIPPED = Object.freeze([
  Object.freeze({ x: 'E3EMidrAOF9ROYrepErhMPQPNVXUE7nlBNIdPmF8nwE', y: 'fhXltTqXbnWKm8e9Pk8dRFdffeN98RDS1ITJyZ99Sgg' }),
]);
const KEYS = [...SHIPPED];
const B64 = /^[A-Za-z0-9_-]{43}$/;

/** The P-256 group order. */
const N_HEX = 'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551';

/** Every admin public key this copy accepts. */
export function adminKeys() {
  return KEYS.map((k) => ({ x: k.x, y: k.y }));
}

/** One more public key accepted as an admin's — the tests' key, never shipped. False for anything that is not one. */
export function addAdminKey(k) {
  if (!k || !B64.test(String(k.x)) || !B64.test(String(k.y))) return false;
  if (!KEYS.some((q) => q.x === k.x && q.y === k.y)) KEYS.push({ x: k.x, y: k.y });
  return true;
}

/** Back to only the shipped key (the tests, when they are done). */
export function resetAdminKeys() {
  KEYS.length = 0;
  KEYS.push(...SHIPPED);
  pubCache.clear();
}

const subtle = () => (globalThis.crypto && globalThis.crypto.subtle) || null;

/** Whether this browser can make or check an admin: WebCrypto (https, localhost), or ./p256.js (needs BigInt). */
export function adminCrypto() {
  return !!subtle() || p256Ready();
}

/* ---- bytes ------------------------------------------------------------- */

export function b64url(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
  const b = typeof btoa === 'function' ? btoa(s) : Buffer.from(s, 'binary').toString('base64');
  return b.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64url(text) {
  if (typeof text !== 'string' || !/^[A-Za-z0-9_-]*$/.test(text)) return null;
  const b = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  let s;
  try {
    s = typeof atob === 'function' ? atob(b) : Buffer.from(b, 'base64').toString('binary');
  } catch (err) {
    return null;
  }
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}

const hex = (u) => [...u].map((b) => b.toString(16).padStart(2, '0')).join('');

/** 0 < d < n, as the scheme needs. */
function inRange(d) {
  const h = hex(d);
  return /[1-9a-f]/.test(h) && h < N_HEX;
}

async function sha256(bytes) {
  if (!subtle()) return sha256js(bytes);
  return new Uint8Array(await subtle().digest('SHA-256', bytes));
}

/** The private number a code makes, as 32 bytes. Null where there is no way to make one. */
export async function deriveD(code) {
  if (!adminCrypto()) return null;
  let d = await sha256(new TextEncoder().encode(ADMIN_SCHEME + String(code == null ? '' : code).trim().toLowerCase()));
  for (let i = 0; i < 64 && !inRange(d); i++) d = await sha256(d);
  return inRange(d) ? d : null;
}

/* ---- keys ---------------------------------------------------------------- */

const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };
const pubCache = new Map();

function publicKey(k) {
  const id = `${k.x}.${k.y}`;
  if (!pubCache.has(id)) {
    const p = subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: k.x, y: k.y, ext: true }, ALG, false, ['verify']);
    // A key that will not import is no admin's: forget the failure so a later call does not rethrow it forever.
    p.catch(() => pubCache.delete(id));
    pubCache.set(id, p);
  }
  return pubCache.get(id);
}

async function privateKey(k, d) {
  return subtle().importKey('jwk', { kty: 'EC', crv: 'P-256', x: k.x, y: k.y, d, ext: false }, ALG, false, ['sign']);
}

/**
 * Whether `priv` really is the private half of admin key `k`: a signature made
 * with it must check out against the public key. Some browsers import a d that
 * does not match the x and y it was given without a word, so this is the test,
 * not the import.
 */
async function matches(k, priv) {
  const probe = new TextEncoder().encode(`island-flight-sim admin key check ${nonce()}`);
  const sig = await subtle().sign(SIGN, priv, probe);
  return subtle().verify(SIGN, await publicKey(k), sig, probe);
}

/** A fresh random nonce, as text: 18 bytes, 24 characters. */
export function nonce() {
  const u = new Uint8Array(18);
  globalThis.crypto.getRandomValues(u);
  return b64url(u);
}

/**
 * What an admin signs to answer a host: the host's nonce, the id the host
 * holds (the one the admin connected to) and the admin's own id, as the
 * matchmaking server stamps them. The ids make the answer useless anywhere
 * but on that one line: a host that passes another host's question on to an
 * admin gets back an answer for itself, not for the other host.
 */
export function proofText(n, hostId, peerId) {
  return `island-flight-sim admin proof v1|${n}|${hostId}|${peerId}`;
}

/** The host's check. True only if one of the admin keys signed exactly this text. Never throws. */
export async function verifyProof(text, sig) {
  if (!adminCrypto() || typeof text !== 'string' || typeof sig !== 'string' || sig.length > 200) return false;
  const bytes = unb64url(sig);
  if (!bytes || bytes.length !== 64) return false;
  const data = new TextEncoder().encode(text);
  if (!subtle()) return KEYS.some((k) => verifyJs(unb64url(k.x), unb64url(k.y), data, bytes));
  for (const k of [...KEYS]) {
    try {
      if (await subtle().verify(SIGN, await publicKey(k), bytes, data)) return true;
    } catch (err) {
      /* not this key */
    }
  }
  return false;
}

/**
 * Whether d (as kept: 43 characters of base64url) is the private number of
 * public key k — its public point worked out with p256.js, a few milliseconds.
 * False for anything else, and where there is no BigInt to work it out with.
 */
function ownsKey(k, d) {
  if (!p256Ready()) return false;
  const raw = typeof d === 'string' && B64.test(d) ? unb64url(d) : null;
  if (!raw || raw.length !== 32) return false;
  let pub = null;
  try {
    pub = publicOf(raw);
  } catch (err) {
    pub = null;
  }
  return !!pub && b64url(pub.x) === k.x && b64url(pub.y) === k.y;
}

/* ---- this device --------------------------------------------------------- */

/**
 * This device's admin key, if it has one: made from a code typed in the
 * hangar, or loaded from what was kept. `sign(text)` answers a host.
 */
export class AdminKey {
  /** `owns`: d is already known to be (x, y)'s private half — fromCode checked it. Otherwise it is worked out before it counts. */
  constructor(k, d, priv = null, owns = false) {
    this.x = k.x;
    this.y = k.y;
    this._d = d;
    this._priv = priv ? Promise.resolve(priv) : null;
    this._owns = owns ? true : undefined;
  }

  /** One of the keys this copy accepts (a kept test key is not, once the tests are gone). */
  get known() {
    return KEYS.some((k) => k.x === this.x && k.y === this.y);
  }

  /** Whether d really is this key's private half: worked out once, never taken from what was kept. */
  get owns() {
    if (this._owns === undefined) this._owns = ownsKey(this, this._d);
    return this._owns;
  }

  /** An admin key here: one this copy accepts, and d its private half. */
  get valid() {
    return this.known && this.owns;
  }

  async sign(text) {
    if (!subtle()) {
      if (!p256Ready()) throw new Error('no way to sign here');
      return b64url(signJs(unb64url(this._d), new TextEncoder().encode(String(text))));
    }
    if (!this._priv) this._priv = privateKey(this, this._d);
    const sig = await subtle().sign(SIGN, await this._priv, new TextEncoder().encode(String(text)));
    return b64url(sig);
  }

  save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ on: 1, x: this.x, y: this.y, d: this._d }));
      return true;
    } catch (err) {
      return false; // private mode: admin for this visit only
    }
  }

  /** Try a code. The admin key it makes, or null — the same null for every kind of wrong. */
  static async fromCode(code) {
    const typed = String(code == null ? '' : code).trim();
    if (!typed || typed.length > 200 || !adminCrypto()) return null;
    let d;
    let raw;
    try {
      raw = await deriveD(typed);
      if (!raw) return null;
      d = b64url(raw);
    } catch (err) {
      return null;
    }
    if (!subtle()) {
      // No WebCrypto: the public point of d, worked out (p256.js), must be an admin key's.
      const pub = publicOf(raw);
      const k = pub && KEYS.find((q) => q.x === b64url(pub.x) && q.y === b64url(pub.y));
      return k ? new AdminKey(k, d, null, true) : null;
    }
    for (const k of [...KEYS]) {
      try {
        const priv = await privateKey(k, d);
        if (await matches(k, priv)) return new AdminKey(k, d, priv, true);
      } catch (err) {
        /* not this key's code */
      }
    }
    return null;
  }

  /**
   * The key kept on this device, if there is one and it is still an admin key
   * here — checked, not trusted: its d must work out to its x and y. A kept
   * flag that fails that (made up, or copied from somewhere with a d that is
   * not the key's) is forgotten. One this copy does not accept (a test key,
   * the tests gone) is left alone and not used; so is any kept key where the
   * maths cannot run (no BigInt) — that browser is an admin only until it
   * closes, after the code is typed.
   */
  static load() {
    let s = null;
    try {
      s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
    } catch (err) {
      s = null;
    }
    if (!s || s.on !== 1 || !B64.test(String(s.x)) || !B64.test(String(s.y)) || !B64.test(String(s.d))) return null;
    const key = new AdminKey({ x: s.x, y: s.y }, s.d);
    if (!key.known || !p256Ready()) return null;
    if (!key.owns) {
      AdminKey.forget();
      return null;
    }
    return key;
  }

  /** Admin off on this device: the key is forgotten. */
  static forget() {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch (err) {
      /* nothing kept */
    }
  }
}

/**
 * P-256 ECDSA and SHA-256, written out — for admin.js where WebCrypto is not.
 *
 * crypto.subtle only exists on https and localhost. The game is also served
 * straight off a Mac on a network with no internet (tools/lan-server.py,
 * plain http on 192.168.x.x), and there it is undefined: no admin could be
 * made, and no host could check one. This is the same maths — the same key,
 * the same signatures, byte for byte the format WebCrypto uses (r ‖ s, 32
 * bytes each) — so a host on https checks an admin on http and the other way
 * round (tests/features/multiplayer.admin.mjs signs with each and checks
 * with the other).
 *
 * Not constant-time. It signs on the admin's own device, a few times a game,
 * and checks public signatures on the host's: there is no secret on the
 * host's side to leak, and an attacker timing the admin's own browser is
 * already on the admin's own browser. BigInt without BigInt literals (`1n`),
 * so an older browser that has no BigInt still loads the game — admin.js
 * asks p256Ready() first.
 */

const big = (x) => BigInt(x);
export const p256Ready = () => typeof BigInt === 'function';

let C = null;
function curve() {
  if (C) return C;
  const ONE = big(1);
  const P = (ONE << big(256)) - (ONE << big(224)) + (ONE << big(192)) + (ONE << big(96)) - ONE;
  C = {
    P,
    N: big('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551'),
    B: big('0x5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b'),
    G: {
      x: big('0x6b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c296'),
      y: big('0x4fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5'),
    },
    ZERO: big(0),
    ONE,
    TWO: big(2),
    THREE: big(3),
    FOUR: big(4),
    EIGHT: big(8),
  };
  return C;
}

const mod = (a, m) => {
  const r = a % m;
  return r < curve().ZERO ? r + m : r;
};

function inv(a, m) {
  const { ZERO, ONE } = curve();
  let t = ZERO;
  let nt = ONE;
  let r = m;
  let nr = mod(a, m);
  while (nr !== ZERO) {
    const q = r / nr;
    [t, nt] = [nt, t - q * nt];
    [r, nr] = [nr, r - q * nr];
  }
  if (r !== ONE) throw new Error('not invertible');
  return mod(t, m);
}

/* Points in Jacobian coordinates { X, Y, Z }; null is the point at infinity. a = -3. */
function dbl(p) {
  if (!p) return null;
  const { P, ZERO, THREE, FOUR, EIGHT } = curve();
  if (p.Y === ZERO) return null;
  const delta = mod(p.Z * p.Z, P);
  const gamma = mod(p.Y * p.Y, P);
  const beta = mod(p.X * gamma, P);
  const alpha = mod(THREE * (p.X - delta) * (p.X + delta), P);
  const X = mod(alpha * alpha - EIGHT * beta, P);
  const Z = mod((p.Y + p.Z) * (p.Y + p.Z) - gamma - delta, P);
  const Y = mod(alpha * (FOUR * beta - X) - EIGHT * gamma * gamma, P);
  return { X, Y, Z };
}

function add(p, q) {
  if (!p) return q;
  if (!q) return p;
  const { P, ZERO, TWO } = curve();
  const z1z1 = mod(p.Z * p.Z, P);
  const z2z2 = mod(q.Z * q.Z, P);
  const u1 = mod(p.X * z2z2, P);
  const u2 = mod(q.X * z1z1, P);
  const s1 = mod(p.Y * q.Z * z2z2, P);
  const s2 = mod(q.Y * p.Z * z1z1, P);
  const h = mod(u2 - u1, P);
  const r = mod(TWO * (s2 - s1), P);
  if (h === ZERO) return r === ZERO ? dbl(p) : null;
  const i = mod(TWO * h * TWO * h, P);
  const j = mod(h * i, P);
  const v = mod(u1 * i, P);
  const X = mod(r * r - j - TWO * v, P);
  const Y = mod(r * (v - X) - TWO * s1 * j, P);
  const Z = mod(((p.Z + q.Z) * (p.Z + q.Z) - z1z1 - z2z2) * h, P);
  return { X, Y, Z };
}

function mul(k, pt) {
  const { ZERO, ONE } = curve();
  let acc = null;
  const base = { X: pt.x, Y: pt.y, Z: ONE };
  for (let i = k.toString(2).length - 1; i >= 0; i--) {
    acc = dbl(acc);
    if (((k >> big(i)) & ONE) !== ZERO) acc = add(acc, base);
  }
  return acc;
}

function affine(p) {
  if (!p) return null;
  const { P } = curve();
  const zi = inv(p.Z, P);
  const zi2 = mod(zi * zi, P);
  return { x: mod(p.X * zi2, P), y: mod(p.Y * zi2 * zi, P) };
}

function onCurve(x, y) {
  const { P, B, THREE, ZERO } = curve();
  if (x < ZERO || y < ZERO || x >= P || y >= P) return false;
  return mod(y * y - (x * x * x - THREE * x + B), P) === ZERO;
}

/* ---- bytes ---------------------------------------------------------------- */

export function toBig(bytes) {
  let h = '0x0';
  for (const b of bytes) h += b.toString(16).padStart(2, '0');
  return big(h);
}

export function toBytes(n, len = 32) {
  const h = n.toString(16).padStart(len * 2, '0');
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/* ---- SHA-256, of bytes ------------------------------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function sha256(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const len = bytes.length;
  const total = Math.ceil((len + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[len] = 0x80;
  const dv = new DataView(buf.buffer);
  const bits = len * 8;
  dv.setUint32(total - 4, bits >>> 0);
  dv.setUint32(total - 8, Math.floor(bits / 0x100000000));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15];
      const b = w[i - 2];
      w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d;
    H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  const out = new Uint8Array(32);
  const odv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) odv.setUint32(i * 4, H[i]);
  return out;
}

/* ---- keys and signatures ------------------------------------------------------ */

/** The public point of private number d (32 bytes): { x, y } as 32 bytes each, or null for a d that is not one. */
export function publicOf(dBytes) {
  const { N, ZERO, G } = curve();
  const d = toBig(dBytes);
  if (d <= ZERO || d >= N) return null;
  const q = affine(mul(d, G));
  return q ? { x: toBytes(q.x), y: toBytes(q.y) } : null;
}

function randomScalar() {
  const { N, ONE } = curve();
  const u = new Uint8Array(48);
  globalThis.crypto.getRandomValues(u);
  return mod(toBig(u), N - ONE) + ONE;
}

/** ECDSA with SHA-256: the signature of `msg` by d, r ‖ s (64 bytes) — WebCrypto's own format. */
export function sign(dBytes, msg) {
  const { N, ZERO, G } = curve();
  const d = toBig(dBytes);
  if (d <= ZERO || d >= N) throw new Error('not a private key');
  const e = mod(toBig(sha256(msg)), N);
  for (;;) {
    const k = randomScalar();
    const R = affine(mul(k, G));
    const r = mod(R.x, N);
    if (r === ZERO) continue;
    const s = mod(inv(k, N) * (e + r * d), N);
    if (s === ZERO) continue;
    const out = new Uint8Array(64);
    out.set(toBytes(r), 0);
    out.set(toBytes(s), 32);
    return out;
  }
}

/** Whether `sig` (r ‖ s) is public key (x, y)'s signature of `msg`. Never throws. */
export function verify(xBytes, yBytes, msg, sig) {
  try {
    const { N, ZERO, G } = curve();
    if (!sig || sig.length !== 64) return false;
    const x = toBig(xBytes);
    const y = toBig(yBytes);
    if (!onCurve(x, y)) return false;
    const r = toBig(sig.subarray(0, 32));
    const s = toBig(sig.subarray(32, 64));
    if (r <= ZERO || r >= N || s <= ZERO || s >= N) return false;
    const e = mod(toBig(sha256(msg)), N);
    const w = inv(s, N);
    const X = affine(add(mul(mod(e * w, N), G), mul(mod(r * w, N), { x, y })));
    return !!X && mod(X.x, N) === r;
  } catch (err) {
    return false;
  }
}

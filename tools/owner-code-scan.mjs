/**
 * Proof that the owner's code is in none of the files given — without
 * knowing the code.
 *
 *   node tools/owner-code-scan.mjs [--key=<public-key.json>] [--git=<range>] [paths…]
 *
 * The code is not in the game and is not known to whoever runs this; only
 * the owner's PUBLIC key is (src/features/multiplayer/owner.js). So instead
 * of grepping for the code, this takes every string in the files that could
 * be one — every line, every word, every quoted string, every run of letters
 * and digits, every piece between = : , ; and brackets — works the owner's
 * private number out of each exactly as the game does (SHA-256 of the
 * owner's label and the trimmed, lower-cased string, rehashed until it is a
 * P-256 private number) and checks whether its public key is the owner's.
 * No hit means no string in those files is the code (or the code with other
 * spaces or capitals).
 *
 * --git=<range> adds the commit messages and diffs of that range.
 * --key=<file> checks against another public key — the TEST owner key, to
 * prove the scan finds a code that IS there (run it on the test key's own
 * file: it must say "found"). Hits are reported by file and line, never by
 * what was found.
 *
 * Paths default to the tree this tool is in (git ls-files). Exit 0: not
 * found; 1: found; 2: could not run.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs';
import { createHash, createECDH } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (k) => {
  const a = args.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : null;
};
const paths = args.filter((a) => !a.startsWith('--'));

const LABEL = 'island-flight-sim owner v1\n';
const N = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function shippedKey() {
  const src = readFileSync(join(ROOT, 'src', 'features', 'multiplayer', 'owner.js'), 'utf8');
  const m = src.match(/x: '([A-Za-z0-9_-]{43})', y: '([A-Za-z0-9_-]{43})'/);
  if (!m) throw new Error('no public key found in owner.js');
  return { x: m[1], y: m[2] };
}

const keyFile = opt('key');
const KEY = keyFile ? JSON.parse(readFileSync(keyFile, 'utf8')) : shippedKey();
const WANT = Buffer.concat([Buffer.from([4]), Buffer.from(KEY.x, 'base64url'), Buffer.from(KEY.y, 'base64url')]);

const ec = createECDH('prime256v1');
function isOwners(candidate) {
  let d = createHash('sha256').update(LABEL + candidate.trim().toLowerCase()).digest();
  for (let i = 0; i < 64; i++) {
    const v = BigInt(`0x${d.toString('hex')}`);
    if (v > 0n && v < N) break;
    d = createHash('sha256').update(d).digest();
  }
  try {
    ec.setPrivateKey(d);
  } catch (err) {
    return false;
  }
  return ec.getPublicKey().equals(WANT);
}

/** Every string in `text` that could be the code. */
function candidates(text, out) {
  const add = (s) => {
    const t = s.trim();
    if (t && t.length <= 200) out.add(t);
  };
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    add(line);
    for (const w of line.split(/\s+/)) {
      add(w);
      add(w.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''));
    }
    for (const w of line.split(/[=:,;()[\]{}<>"'`|]+/)) add(w);
    for (const w of line.split(/[^A-Za-z0-9]+/)) add(w);
    for (const m of line.matchAll(/'([^'\n]{1,200})'|"([^"\n]{1,200})"|`([^`\n]{1,200})`/g)) add(m[1] || m[2] || m[3] || '');
  }
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|glb|gltf|bin|zip|gz|mp3|wav|ogg|m4a|woff2?|ttf|otf|pdf|blend|mp4|webm)$/i;

function listFiles() {
  if (paths.length) {
    const out = [];
    const walk = (p) => {
      if (!existsSync(p)) return;
      if (statSync(p).isDirectory()) for (const n of readdirSync(p)) { if (n !== '.git' && n !== 'node_modules') walk(join(p, n)); }
      else out.push(p);
    };
    for (const p of paths) walk(resolve(p));
    return out;
  }
  return execFileSync('git', ['ls-files', '-z'], { cwd: ROOT }).toString('utf8').split('\0').filter(Boolean).map((f) => join(ROOT, f));
}

const t0 = Date.now();
const files = listFiles().filter((f) => !BINARY.test(f) && statSync(f).size < 20e6);
const hits = [];
let tried = 0;
const seen = new Set();
const scan = (where, text) => {
  const c = new Set();
  candidates(text, c);
  for (const s of c) {
    if (seen.has(s)) continue;
    seen.add(s);
    tried++;
    if (isOwners(s)) {
      const line = text.split(/\r?\n/).findIndex((l) => l.includes(s) || l.toLowerCase().includes(s.trim().toLowerCase()));
      hits.push(`${where}${line >= 0 ? `:${line + 1}` : ''}`);
    }
  }
};
for (const f of files) {
  let text;
  try {
    text = readFileSync(f, 'utf8');
  } catch (err) {
    continue;
  }
  scan(relative(ROOT, f) || f, text);
}
const range = opt('git');
if (range) {
  const log = execFileSync('git', ['log', '-p', '--format=%H%n%an <%ae>%n%B', range], { cwd: ROOT, maxBuffer: 512e6 }).toString('utf8');
  scan(`git ${range}`, log);
}
const secs = ((Date.now() - t0) / 1000).toFixed(1);
if (hits.length) {
  console.log(`found — ${hits.length} place(s): ${hits.join(', ')} (${tried} strings, ${files.length} files, ${secs} s)`);
  process.exit(1);
}
console.log(`not found — ${tried} distinct strings from ${files.length} files${range ? ` and git ${range}` : ''} checked against the ${keyFile ? 'given' : 'shipped owner'} public key in ${secs} s`);
process.exit(0);

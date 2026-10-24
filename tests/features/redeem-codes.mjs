/**
 * Node checks for the hangar's redeem codes — hashed, not plaintext.
 *
 *   node tests/features/redeem-codes.mjs
 *
 * A friend read the old CREDIT_CODES list out of the public JavaScript and
 * gave themselves a billion credits. So:
 *
 *   1. The shipped table (progression.js CODES) holds only SHA-256
 *      fingerprints, each with an amount or a rank beside it — and nothing
 *      that was on the old plaintext list is in it. The old codes are read
 *      from git history AT TEST TIME, never written here, and every one of
 *      them is rejected with the same sentence a made-up code gets.
 *   2. A test-only table — a code made up for this run, hashed by the game's
 *      own codeHash() — pays out once, is refused the second time, ignores
 *      case and surrounding spaces, and a rank entry appoints the rank.
 *   3. No plaintext in src: the identifiers CREDIT_CODES / RANK_CODES /
 *      creditsInName are gone, and no word-like token anywhere under src/
 *      hashes to a shipped code.
 *   4. The plain-JavaScript SHA-256 (for pages without crypto.subtle) agrees
 *      with node:crypto, byte for byte, on a spread of inputs.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const Prog = await import(new URL('../../src/game/progression.js', import.meta.url).href);

let fails = 0;
let n = 0;
const ok = (name, pass, detail) => {
  n++;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const wallet = () => ({ credits: 500, earned: 900, best: [], unlocked: [], redeemed: [], grantedRank: null });
const nodeHash = (s) => createHash('sha256').update(String(s).trim().toLowerCase()).digest('hex');

/* ---- 1. The shipped table ---------------------------------------- */
{
  const keys = Object.keys(Prog.CODES);
  ok('every shipped key is a 64-hex SHA-256 fingerprint', keys.every(Prog.isCodeHash), `${keys.length} entries`);
  ok('every shipped entry carries its amount or rank beside the hash',
    keys.every((k) => { const e = Prog.CODES[k]; return e && ((Number(e.credits) > 0) || ['founder', 'admin', 'mod'].includes(e.rank)); }));
  ok('the table is frozen — nothing at run time can add a code to it', Object.isFrozen(Prog.CODES));

  // The old plaintext list, straight out of git history, never out of this file.
  const OLD = '343d37b38a7a1e116ec18297ada67f751c3ccb93';
  let oldWords = null;
  try {
    const src = execFileSync('git', ['show', `${OLD}:src/game/progression.js`], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const block = (name) => {
      const m = src.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\n\\};`));
      return m ? [...m[1].matchAll(/^\s*([A-Za-z0-9_-]+):/gm)].map((x) => x[1]) : [];
    };
    oldWords = [...block('CREDIT_CODES'), ...block('RANK_CODES')];
  } catch (e) {
    oldWords = null;
  }
  if (!oldWords) {
    console.log('SKIP  old codes: git history not available here');
  } else {
    ok('the old list is found in history (so the retirement check is real)', oldWords.length >= 10, `${oldWords.length} words`);
    const inTable = oldWords.filter((w) => Prog.CODES[nodeHash(w)]);
    ok('none of the old codes is in the shipped table', inTable.length === 0, inTable.length ? `${inTable.length} still live` : '');
    const answers = [];
    for (const w of oldWords) {
      for (const typed of [w, w.toUpperCase(), ` ${w} `]) {
        const p = wallet();
        const r = await Prog.redeem(p, typed);
        answers.push([r.ok, r.why, p.credits, p.earned, p.grantedRank, p.redeemed.length]);
      }
    }
    ok('every old code, in any case, is rejected and changes nothing',
      answers.every(([k, why, c, e, g, red]) => !k && why === 'That code does not work' && c === 500 && e === 900 && g === null && red === 0),
      `${answers.length} attempts`);

    // The ChatGPT build under gpt/ is served from the same origin and writes
    // the SAME save (same localStorage key): a live plaintext list there would
    // pay straight into the real game. Its redeem must refuse every old code too.
    const Gpt = await import(new URL('../../gpt/src/game/progression.js', import.meta.url).href);
    const gptAnswers = [];
    for (const w of oldWords) {
      for (const typed of [w, w.toUpperCase()]) {
        const p = wallet();
        const r = Gpt.redeem(p, typed);
        gptAnswers.push([r.ok, p.credits, p.grantedRank]);
      }
    }
    ok('the gpt/ copy (shares the save) rejects every old code as well',
      gptAnswers.every(([k, c, g]) => !k && c === 500 && g === null), `${gptAnswers.length} attempts`);

    // And no old word survives in any file the site serves (src/, gpt/, the root pages).
    const served = [];
    const walkServed = (d) => {
      for (const f of readdirSync(d)) {
        if (['.git', '.claude', 'node_modules', 'tests', 'download', 'vendor'].includes(f)) continue;
        const p = join(d, f);
        if (statSync(p).isDirectory()) walkServed(p);
        else if (/\.(js|mjs|html|json|webmanifest|md|txt)$/.test(f)) served.push(p);
      }
    };
    walkServed(ROOT);
    const creditWords = oldWords.filter((w) => /\d/.test(w)).map((w) => w.toLowerCase());
    let leaks = 0;
    for (const f of served) {
      const text = readFileSync(f, 'utf8').toLowerCase();
      for (const w of creditWords) if (new RegExp(`(^|[^a-z0-9_])${w}([^a-z0-9_]|$)`).test(text)) leaks++;
    }
    ok('no old credit code appears in any served file', leaks === 0, `${served.length} files, ${leaks} hits`);
  }
}

/* ---- 2. A test-only table ---------------------------------------- */
{
  const word = `test-${randomUUID()}`;
  const hash = await Prog.codeHash(word);
  ok('codeHash() is SHA-256 of the trimmed, lower-cased word', hash === nodeHash(`  ${word.toUpperCase()}  `) && Prog.isCodeHash(hash));
  const rankWord = `rank-${randomUUID()}`;
  const table = { [hash]: { credits: 2500, note: 'For the test' }, [await Prog.codeHash(rankWord)]: { rank: 'mod', note: 'Appointed' } };

  const p = wallet();
  const r1 = await Prog.redeem(p, word.toUpperCase(), table);
  ok('a test-only hash pays out, from the amount beside the hash, with its note',
    r1.ok && r1.credits === 2500 && r1.rank === null && r1.note === 'For the test' && p.credits === 3000 && p.earned === 3400, JSON.stringify(r1));
  const r2 = await Prog.redeem(p, `  ${word}  `, table);
  ok('the same code a second time is refused, as before', !r2.ok && r2.why === 'You have already used that one' && p.credits === 3000, JSON.stringify(r2));
  ok('the wallet remembers the fingerprint, never the word', p.redeemed.length === 1 && p.redeemed[0] === hash && !JSON.stringify(p).includes(word));
  const r3 = await Prog.redeem(p, rankWord, table);
  ok('a rank entry appoints the rank and pays nothing', r3.ok && r3.credits === 0 && r3.rank === 'mod' && p.grantedRank === 'mod' && p.credits === 3000, JSON.stringify(r3));
  const r4 = await Prog.redeem(p, '', table);
  ok('a blank still says to type one', !r4.ok && r4.why === 'Type a code first');
  const r5 = await Prog.redeem(p, `${word}x`, table);
  ok('one letter off is a code that does not work', !r5.ok && r5.why === 'That code does not work');
  const r6 = await Prog.redeem(wallet(), hash, table);
  ok('typing the hash itself is not the code', !r6.ok && r6.why === 'That code does not work');
  const r7 = await Prog.redeem(wallet(), 'constructor', table);
  ok('prototype names are not codes', !r7.ok && r7.why === 'That code does not work');
  const saved = JSON.parse(store.get('islandsim.progression.v1') || 'null');
  ok('a pay-out is saved', saved && saved.credits === 3000);
}

/* ---- 3. No plaintext in src ------------------------------------- */
{
  const files = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) { if (f !== 'vendor') walk(p); }
      else if (/\.(js|mjs)$/.test(f)) files.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  const prog = readFileSync(join(ROOT, 'src/game/progression.js'), 'utf8');
  ok('the plaintext tables and the name-parser are gone from progression.js',
    !/CREDIT_CODES|RANK_CODES|creditsInName/.test(prog) && !/const SCALES/.test(prog));
  const menus = readFileSync(join(ROOT, 'src/ui/menus.js'), 'utf8');
  ok('the hangar waits for the hashed answer (redeem is async)', /Prog\.redeem\(p, typed\)\.then\(/.test(menus));

  // Every word-like token under src/, hashed as a code would be: none may be a shipped code.
  const shipped = new Set(Object.keys(Prog.CODES));
  const tokens = new Set();
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/[A-Za-z0-9_-]{3,40}/g)) tokens.add(m[0].toLowerCase());
  }
  let hits = 0;
  if (shipped.size) for (const t of tokens) if (shipped.has(nodeHash(t))) hits++;
  ok('no token anywhere under src/ hashes to a shipped code', hits === 0, `${files.length} files, ${tokens.size} tokens, ${shipped.size} shipped codes`);
}

/* ---- 4. The plain-JavaScript SHA-256 ---------------------------- */
{
  const inputs = ['', 'a', 'abc', 'The quick brown fox jumps over the lazy dog', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(63), 'x'.repeat(64), 'x'.repeat(65), 'y'.repeat(1000), 'héllo wörld ✈️'];
  const bad = inputs.filter((s) => Prog.sha256Hex(s) !== createHash('sha256').update(s).digest('hex'));
  ok('sha256Hex() agrees with node:crypto across block boundaries and unicode', bad.length === 0, bad.length ? `${bad.length} differ` : `${inputs.length} inputs`);
  const saved = globalThis.crypto;
  try {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true });
    const h = await Prog.codeHash('Fallback Path');
    ok('codeHash() without crypto.subtle gives the same fingerprint', h === nodeHash('fallback path'));
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: saved, configurable: true, writable: true });
  }
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

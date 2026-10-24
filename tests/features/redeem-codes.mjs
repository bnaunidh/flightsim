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
 *   5. PATTERN CODES (progression.js PREFIXES): a code is a hashed PREFIX
 *      followed by an AMOUNT — digits, up to two decimals, an optional K/M/B.
 *      The shipped table is hashes only (and empty); a test-only prefix pays
 *      the amount typed after it, every exact amount once, in any case; the
 *      amount grammar accepts and refuses exactly what it should; and the
 *      tool's --prefix mode prints the entry for it.
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

/* ---- 5. Pattern codes: PREFIX + AMOUNT -------------------------- */
{
  const pkeys = Object.keys(Prog.PREFIXES);
  ok('PREFIXES: every shipped key is a 64-hex fingerprint, each with a note', pkeys.every((k) => Prog.isCodeHash(k) && Prog.PREFIXES[k] && typeof Prog.PREFIXES[k].note === 'string'), `${pkeys.length} entries`);
  ok('PREFIXES: the table is frozen', Object.isFrozen(Prog.PREFIXES));
  ok('PREFIXES: the cap is a billion', Prog.CODE_AMOUNT_MAX === 1000000000);

  // The amount grammar.
  const AMOUNTS = [
    ['500', 500], ['1.5K', 1500], ['1.5k', 1500], ['1.25K', 1250], ['2M', 2000000], ['1B', 1000000000], ['0.5K', 500],
    ['1000000000', 1000000000], ['1.1k', 1100], ['12.34M', 12340000], ['7', 7],
    ['1.255K', null], ['0', null], ['0.0', null], ['500.5', null], ['1.5', null], ['1.2345K', null], ['1.01B', null], ['2B', null],
    ['1000000001', null], ['', null], ['abc', null], ['1.', null], ['.5', null], ['1,000', null], ['1 000', null], ['1e3', null], ['-5', null], ['5KK', null],
  ];
  const wrong = AMOUNTS.filter(([t, want]) => Prog.parseCodeAmount(t) !== want).map(([t, want]) => `${t}→${Prog.parseCodeAmount(t)} (want ${want})`);
  ok('amount: digits, up to two decimals, K/M/B; whole credits only, above zero, at most a billion', wrong.length === 0, wrong.join(', ') || `${AMOUNTS.length} cases`);
  ok('split: at the first digit; no digit or a leading digit is not a pattern code',
    JSON.stringify(Prog.splitPatternCode(' Sky1.5k ')) === JSON.stringify({ prefix: 'Sky', amount: 1500 }) && Prog.splitPatternCode('sky') === null && Prog.splitPatternCode('5sky') === null && Prog.splitPatternCode('sky1.255k') === null);

  // A test-only prefix (letters only: a prefix cannot hold a digit).
  const letters = () => Array.from(randomUUID().replace(/[^a-f-]/g, '')).join('');
  const PREFIX = `tp-${letters()}-${letters()}`;
  const ph = await Prog.codeHash(PREFIX);
  ok('a prefix hashes like a whole code (trimmed, lower-cased)', ph === nodeHash(PREFIX.toUpperCase()));
  const prefixes = { [ph]: { note: 'Ask the CEO' } };
  const codes = {};
  const p = wallet();
  const r1 = await Prog.redeem(p, `${PREFIX}500`, codes, prefixes);
  ok('PREFIX500 pays 500, with the prefix\'s note', r1.ok && r1.credits === 500 && r1.rank === null && r1.note === 'Ask the CEO' && p.credits === 1000 && p.earned === 1400, JSON.stringify(r1));
  const r2 = await Prog.redeem(p, `  ${PREFIX.toUpperCase()}1.5K  `, codes, prefixes);
  ok('PREFIX1.5K pays 1,500 — a different amount is a different code; case and spaces do not matter', r2.ok && r2.credits === 1500 && p.credits === 2500, JSON.stringify(r2));
  const r3 = await Prog.redeem(p, `${PREFIX}500`, codes, prefixes);
  ok('the same exact code again is "already used"', !r3.ok && r3.why === 'You have already used that one' && p.credits === 2500, JSON.stringify(r3));
  const r4 = await Prog.redeem(p, `${PREFIX}0.5k`, codes, prefixes);
  ok('PREFIX0.5K is the same code as PREFIX500 (the normalised code is stamped), so it is "already used" too', !r4.ok && r4.why === 'You have already used that one' && p.credits === 2500, JSON.stringify(r4));
  const r4b = await Prog.redeem(p, `${PREFIX} 500`, codes, prefixes);
  const r4c = await Prog.redeem(p, `${PREFIX}\t0.5K`, codes, prefixes);
  ok('a space between the prefix and the amount is the same code too (no second pay-out)', !r4b.ok && r4b.why === 'You have already used that one' && !r4c.ok && r4c.why === 'You have already used that one' && p.credits === 2500, JSON.stringify([r4b, r4c]));
  const r5 = await Prog.redeem(p, `${PREFIX}1.25K`, codes, prefixes);
  ok('PREFIX1.25K pays 1,250', r5.ok && r5.credits === 1250 && p.credits === 3750, JSON.stringify(r5));
  const refused = [];
  for (const amt of ['1.255K', '0', '500.5', '2B', '1.01B', '1.5', '']) {
    const q = wallet();
    const r = await Prog.redeem(q, `${PREFIX}${amt}`, codes, prefixes);
    refused.push([amt, r.ok, r.why, q.credits, q.redeemed.length]);
  }
  ok('three decimals, zero, a fraction of a credit, over a billion, or no amount at all: "That code does not work", nothing changes',
    refused.every(([, k, why, c, red]) => !k && why === 'That code does not work' && c === 500 && red === 0), JSON.stringify(refused));
  const r6 = await Prog.redeem(wallet(), `${PREFIX}1B`, codes, prefixes);
  ok('PREFIX1B pays exactly a billion, the most a code may', r6.ok && r6.credits === 1000000000, JSON.stringify(r6));
  const r7 = await Prog.redeem(wallet(), `nope-${letters()}500`, codes, prefixes);
  ok('an unknown prefix with a good amount does not work', !r7.ok && r7.why === 'That code does not work');
  const r8 = await Prog.redeem(wallet(), `${ph}500`, codes, prefixes);
  ok('the prefix\'s hash is not the prefix', !r8.ok && r8.why === 'That code does not work');
  ok('the wallet keeps fingerprints only — never the prefix, never the typed code',
    p.redeemed.length === 3 && p.redeemed.every(Prog.isCodeHash) && !JSON.stringify(p).toLowerCase().includes(PREFIX.toLowerCase())
      && p.redeemed[0] === nodeHash(`${PREFIX}500`) && p.redeemed[1] === nodeHash(`${PREFIX}1500`), JSON.stringify(p.redeemed));

  // A per-prefix cap, when the owner sets one.
  const capped = { [ph]: { note: 'Small change', max: 2000 } };
  const r9 = await Prog.redeem(wallet(), `${PREFIX}2K`, codes, capped);
  const r10 = await Prog.redeem(wallet(), `${PREFIX}2.5K`, codes, capped);
  ok('an entry\'s `max` caps what one of its codes may pay', r9.ok && r9.credits === 2000 && !r10.ok && r10.why === 'That code does not work');

  // A whole code wins over a pattern read of the same text.
  const wholeWord = `${PREFIX}777`;
  const both = { [await Prog.codeHash(wholeWord)]: { credits: 42, note: 'The whole word' } };
  const r11 = await Prog.redeem(wallet(), wholeWord, both, prefixes);
  ok('a text that is a whole code in CODES pays as that code, not as prefix + amount', r11.ok && r11.credits === 42 && r11.note === 'The whole word', JSON.stringify(r11));

  // The default tables are the shipped ones.
  const r12 = await Prog.redeem(wallet(), `${PREFIX}500`);
  ok('against the shipped tables a test-only prefix does not work', !r12.ok && r12.why === 'That code does not work');

  // The tool's --prefix mode prints the entry.
  try {
    const out = execFileSync(process.execPath, [join(ROOT, 'tools/hash-code.mjs'), '--prefix', '--note=Ask the CEO', '--max=5000'], { cwd: ROOT, encoding: 'utf8', input: `${PREFIX}\n`, stdio: ['pipe', 'pipe', 'pipe'] });
    ok('tools/hash-code.mjs --prefix prints a PREFIXES line with the prefix\'s fingerprint, the note and the cap',
      out.includes('PREFIXES') && out.includes(`'${ph}': { note: 'Ask the CEO', max: 5000 },`) && !out.toLowerCase().includes(PREFIX.toLowerCase()), out.trim().split('\n')[2]);
    let bad = '';
    try {
      execFileSync(process.execPath, [join(ROOT, 'tools/hash-code.mjs'), '--prefix', '--note=x'], { cwd: ROOT, encoding: 'utf8', input: 'has9digit\n', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      bad = String(e.stderr || '');
    }
    ok('…and refuses a prefix with a digit in it', /digit/.test(bad), bad.trim().slice(0, 80));
  } catch (e) {
    ok('tools/hash-code.mjs --prefix runs', false, String(e.message || e).slice(0, 200));
  }
}

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

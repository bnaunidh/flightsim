/**
 * Multiplayer, in plain node (22 or later, for the built-in WebSocket):
 *
 *   node tests/features/multiplayer.mjs          # no network at all
 *   node tests/features/multiplayer.mjs --real   # the signaling half against 0.peerjs.com
 *   node tests/features/multiplayer.mjs --lan=ws://127.0.0.1:8807/peerjs
 *                                                # ...against tools/lan-server.py
 *
 * By default the signaling server and WebRTC are the fakes in
 * multiplayer.fakes.js, which behave the way the real ones were measured to;
 * everything else is the shipped code. With --real, every signaling message
 * goes to the public PeerJS server under random ids. Exits non-zero on any
 * failure.
 */

import { createHash } from 'node:crypto';

// The DOM stub every module in this game is imported under in node.
global.document = {
  createElement: () => ({
    getContext: () => new Proxy({}, { get: () => () => ({ addColorStop() {}, data: new Uint8ClampedArray(4) }) }),
    width: 0,
    height: 0,
    style: {},
  }),
  body: { appendChild() {} },
};

const results = [];
const ok = (name, pass, detail = '') => {
  results.push({ name, pass: !!pass, detail: String(detail) });
  console.log(`${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  return !!pass;
};
// A promise nobody was waiting for is a bug in the code under test, not a reason to stop counting.
process.on('unhandledRejection', (err) => ok('no unhandled rejections', false, err && err.stack ? err.stack.split('\n').slice(0, 4).join(' | ') : err));

const P = await import('../../src/features/multiplayer/protocol.js');
const { Track } = await import('../../src/features/multiplayer/interp.js');
const { Signaling, PUBLIC_BACKEND } = await import('../../src/features/multiplayer/signaling.js');
const { Net } = await import('../../src/features/multiplayer/link.js');
const S = await import('../../src/features/multiplayer/session.js');
const { FakeSignalServer, makeFakeRTC, sleep, until } = await import('./multiplayer.fakes.js');

/* ---- every module imports under the DOM stub ------------------------ */
for (const m of ['multiplayer/remotes.js', 'multiplayer/ui.js', 'multiplayer.js']) {
  try {
    await import(`../../src/features/${m}`);
    ok(`imports in node: src/features/${m}`, true);
  } catch (err) {
    ok(`imports in node: src/features/${m}`, false, err && err.stack ? err.stack.split('\n').slice(0, 3).join(' | ') : err);
  }
}

/* ---- which server, which network: asked once, whoever asks ----------- */
/*
 * The two-page playtest: the list asked "is there a LAN server?" as the
 * screen opened, Host was clicked before the answer came, and Host went to
 * Cloudflare for a hash that then overwrote the LAN's — slot 1 taken under a
 * hash nobody's list looks at. Here /lan/info answers in 60 ms and the trace
 * in 5, and the list and Host ask at the same moment.
 */
{
  const { multiplayer } = await import('../../src/features/multiplayer.js');
  const Mp = multiplayer.constructor;
  const realFetch = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    asked.push(u.replace(/^https?:\/\/[^/]+/, ''));
    if (u.endsWith('/lan/info')) {
      await sleep(60);
      return new Response(JSON.stringify({ lan: true, net: 'abcdef012345', name: 'Classroom Mac', version: 1 }));
    }
    await sleep(5);
    return new Response('fl=1\nip=203.0.113.9\nts=1\n');
  };
  try {
    const m = new Mp();
    const [a, b] = await Promise.all([m.ensureNetwork(), m.ensureNetwork()]);
    ok('the list and Host, asking at once, both get the LAN server\'s network', a === 'abcdef012345' && b === a && m.backend.id === 'lan' && m.hashVia === 'lan',
      `${a} / ${b} via ${m.hashVia}, backend ${m.backend.id}; fetched ${asked.join(', ')}`);
    ok('and /lan/info was asked once', asked.filter((u) => u.endsWith('/lan/info')).length === 1);

    // No LAN server: the public address's hash, fetched once for both.
    asked.length = 0;
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      await sleep(String(url).endsWith('/lan/info') ? 5 : 60);
      return String(url).endsWith('/lan/info') ? new Response('nope', { status: 404 }) : new Response('fl=1\nip=203.0.113.9\nts=1\n');
    };
    const m2 = new Mp();
    const [c, d] = await Promise.all([m2.ensureNetwork(), m2.ensureNetwork()]);
    ok('with no LAN server both get the same hash, from one trace — not one of them none', c && c === d && c === P.netHashFor('203.0.113.9') && asked.filter((u) => /trace/.test(u)).length === 1,
      `${c} / ${d}; ${asked.length} fetches`);

    // The LAN server's answer does not arrive (a busy page, a slow machine): "don't know", not "no" — asked again next time.
    let lanUp = false;
    const methods = [];
    globalThis.fetch = async (url, init = {}) => {
      if (String(url).endsWith('/lan/info')) {
        methods.push(init.method || 'GET');
        if (!lanUp) throw new TypeError('Failed to fetch');
        return new Response(JSON.stringify({ lan: true, net: 'abcdef012345', name: 'Classroom Mac', version: 1 }));
      }
      return new Response('fl=1\nip=203.0.113.9\nts=1\n');
    };
    const m3 = new Mp();
    const first = await m3.ensureNetwork();
    lanUp = true;
    m3._hashAt = -Infinity;
    await m3.ensureBackend();
    ok('a LAN check that went unanswered is asked again, and then wins over the public hash',
      first === P.netHashFor('203.0.113.9') && m3.backend.id === 'lan' && m3.hash === 'abcdef012345' && methods.length === 2,
      `${first} then ${m3.hash} on ${m3.backend.id}`);
    ok('and it is asked with a POST, which the service worker does not cache', methods.every((x) => x === 'POST'), methods.join(','));

    // A static host refuses the POST: that IS an answer, and it is not asked again.
    const refused = [];
    globalThis.fetch = async (url) => {
      if (String(url).endsWith('/lan/info')) {
        refused.push(url);
        return new Response('Method Not Allowed', { status: 405 });
      }
      return new Response('fl=1\nip=203.0.113.9\nts=1\n');
    };
    const m4 = new Mp();
    await m4.ensureNetwork();
    await m4.ensureBackend();
    ok('a 405 from a static host means "not a LAN server", asked once', m4.backend.id === 'public' && refused.length === 1);
  } finally {
    globalThis.fetch = realFetch;
  }
}

/* ---- hashing and the network key ------------------------------------ */
{
  const words = ['', 'abc', 'island-flight-lan:203.0.113.7', 'x'.repeat(55), 'y'.repeat(56), 'z'.repeat(200), 'Ünïcødé ✈'];
  const bad = words.filter((w) => P.sha256Hex(w) !== createHash('sha256').update(w).digest('hex'));
  ok('sha256 matches node crypto', bad.length === 0, bad.length ? `wrong for ${JSON.stringify(bad)}` : `${words.length} inputs`);
  const h = P.netHashFor('203.0.113.7');
  ok('net hash is the first 12 hex of sha256("island-flight-lan:" + ip)', h === createHash('sha256').update('island-flight-lan:203.0.113.7').digest('hex').slice(0, 12), h);
  ok('different networks, different hashes', P.netHashFor('203.0.113.8') !== h);
  const a = P.netHashFor('2001:db8:1:2:aaaa::1');
  const b = P.netHashFor('2001:0db8:0001:0002:bbbb:cccc:dddd:eeee');
  ok('IPv6: two devices on one /64 share a hash', a && a === b, `${a} ${b}`);
  ok('IPv6: another /64 does not', P.netHashFor('2001:db8:1:3::1') !== a);
  ok('trace parsing', P.parseTrace('fl=1\nh=www.cloudflare.com\nip=198.51.100.23\nts=1\n') === '198.51.100.23' && P.parseTrace('nothing') === null);
  ok('slot ids', P.slotId(h, 3) === `ifs-${h}-3` && P.slotOf(h, `ifs-${h}-3`) === 3 && P.slotOf(h, `ifs-${h}-6`) === 0);
}

/* ---- words this file must not spell, ROT13'd -------------------------- */
const r13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });
/*
 * The word lists (call signs, server names, join codes) were read pair by
 * pair; these keep them that way when a word is added. No list word is one
 * of WHOLE, and no word or pair run together contains any of ROOTS — ROT13'd,
 * so this file does not read like a playground wall.
 */
// "kys" is in WHOLE and not in ROOTS: run together it is in Lucky Seal and Plucky Swan, which nobody reads with the space taken out;
// the same for the slur in Speedy Kestrel.
const WHOLE = ['xlf', 'nff', 'gvg', 'phz', 'frk', 'uryy', 'qnza', 'penc', 'tnl', 'ubzb', 'cbb', 'crr', 'ohz', 'nefr', 'obbo', 'ahqr', 'sng', 'htyl', 'qhzo', 'fghcvq', 'vqvbg',
  'ybfre', 'sbby', 'zbeba', 'jrveq', 'cvt', 'pbj', 'ong', 'eng', 'ncr', 'zbaxrl', 'qbaxrl', 'tbbfr', 'ghexrl', 'puvpxra', 'jbez', 'fyht', 'fanxr', 'jrnfry', 'qlxr'].map(r13);
const ROOTS = ['shpx', 'shx', 'spx', 'fuvg', 'phag', 'ovgpu', 'avtt', 'avtn', 'snt', 'juber', 'fyhg', 'cravf', 'intvan', 'qvpx', 'pbpx', 'chffl', 'cvff', 'cbea',
  'wvmm', 'encr', 'anmv', 'uvgyre', 'gjng', 'jnax', 'ergneq', 'qvyqb', 'obbo', 'cbbc', 'sneg', 'gheq', 'frkl', 'ubea', 'zvys', 'fcnm', 'xvxr', 'pbba', 'fcvp',
  'puvax', 'jbt', 'enturnq', 'unaqwbo', 'oybjwbo', 'ahgfnpx', 'onyyf', 'fcrez', 'betl',
  // And the slurs the fourth review spelt in a join code without their vowels, with them.
  'erqfxva', 'ornare', 'jrgonpx', 'tbbx', 'genaal'].map(r13);

/*
 * The look-alike attacks the third review got through the old word filter,
 * as data: eleven words (ROT13'd, so this file does not read like a
 * playground wall) with every i and l written eight ways — letters from
 * other alphabets, and digits that are not ASCII. 11 × 8 = 88.
 */
const LOOKALIKE_WORDS = ['fuvg', 'fyhg', 'ovgpu', 'qvpx', 'cvff', 'pyvg', 'qvyqb', 'avttre', 'xvyy lbhefrys', 'ohyyfuvg', 'uvgyre'].map(r13);
const LOOKALIKE_LETTERS = [
  { what: 'Cyrillic і and palochka', i: 'і', l: 'ӏ' },
  { what: 'Greek iota and capital iota', i: 'ι', l: 'Ι' },
  { what: 'dotless ı and the dental click ǀ', i: 'ı', l: 'ǀ' },
  { what: 'full-width letters', i: 'ｉ', l: 'ｌ' },
  { what: 'Roman numerals ⅰ and Ⅰ', i: 'ⅰ', l: 'Ⅰ' },
  { what: 'Arabic-Indic digit one', i: '١', l: '١' },
  { what: 'Extended Arabic-Indic digit one', i: '۱', l: '۱' },
  { what: 'mathematical bold digit one', i: '\u{1d7cf}', l: '\u{1d7cf}' },
];
const LOOKALIKE_ATTACKS = LOOKALIKE_WORDS.flatMap((w) => LOOKALIKE_LETTERS.map((sub) => w.replace(/i/g, sub.i).replace(/l/g, sub.l)));
/*
 * And the same tricks on names that are nearly call signs: a look-alike
 * letter or digit, a space that is not a space, a zero-width character,
 * the wrong case, the words the other way round, a number that is not one.
 */
const NEAR_MISSES = [
  'Brave Οtter', 'Brave Otter​', 'Brave Otter', 'Brave  Otter', ' Brave Otter', 'Brave Otter ', 'Brave Otter\n', 'brave otter',
  'BRAVE OTTER', 'Otter Brave', 'Brave Brave', 'Otter Otter', 'BraveOtter', 'Brave Otter 0', 'Brave Otter 07', 'Brave Otter 100',
  'Brave Otter 69', 'Brave Otter 88', 'Brave Otter 14', 'Brave Otter 18', 'Brave Otter 28', 'Brave Otter 83', 'Brave Otter 12', 'Brave Otter 13',
  'Brave Otter 23', 'Brave Otter 33', 'Brave Otter 38', 'Brave Otter 43', 'Brave Otter -1', 'Brave Otter 1.5', 'Brave Otter ١', 'Brave Otter \u{1d7d5}',
  'Brave Otter ７', 'Brave Otter 7 7', 'Brave Otter Otter', 'Brаve Otter', 'Brave Ottеr', 'Braveǀ Otter', 'Ｂrave Otter', 'Brave Otteŕ',
  '<b>Brave Otter</b>', 'Brave Otter<script>', 'Pilot 42', 'Hana', 'Brave Tiger‮', 'Brave Tigers', 'Harbour Hangar', 'Snowy Yeti\u0000',
];
const NOT_STRINGS = [null, undefined, 42, true, {}, [], ['Brave Otter'], { toString: () => 'Brave Otter' }, new String('Brave Otter')];

/* ---- codes ---------------------------------------------------------- */
/*
 * The join code is on every player's screen for the whole game. Five letters
 * could spell things: review got HELLO onto a joiner's badge from a modified
 * host; then, with the vowels gone and a list of rude consonant runs refused,
 * it got a swear word and a slur through (the first two below, ROT13'd) —
 * from an honest host's own dice, and from a modified one. Now a code is two
 * list words and a list number, and nothing else is a code.
 */
/** A real code, not written the way the game writes it: fine typed into the box, never shown. */
const NEARLY_CODES = ['Maple-kite-42', 'MAPLE-KITE-42', 'maple kite 42', 'maplekite42', 'maple-kite-42 ', ' maple-kite-42', 'maple--kite-42'];
/** What a modified host might send as its code: every one must be dropped. The first eight are the fourth review's, ROT13'd. */
const JUNK_CODES = [
  ...['CUPXE', 'EQFXA', 'CUPXQ', 'CUPXF', 'FCXFO', 'OAEFO', 'XAGFO', 'JGOXF', 'cupxe', 'eqfxa'].map(r13),
  'HELLO', 'KDPTM', 'KXPTM', 'BCDGH', 'ZZZZZ',
  ...NEARLY_CODES,
  'maple_kite_42', 'maple-kite-042', 'maple-kite', 'maple-kite-42-7', 'kite-maple-42', 'maple-maple-42', 'kite-kite-42', 'maple-kite-0', 'maple-kite-100', 'maple-kite-4.2',
  // Numbers a code never carries.
  'maple-kite-12', 'maple-kite-13', 'maple-kite-14', 'maple-kite-18', 'maple-kite-23', 'maple-kite-28', 'maple-kite-33', 'maple-kite-38', 'maple-kite-43',
  'maple-kite-69', 'maple-kite-83', 'maple-kite-88',
  // Look-alikes: Cyrillic а, the Kelvin sign, full-width and Arabic-Indic digits, an en dash, a non-breaking hyphen, a zero-width space, a right-to-left override.
  'mаple-kite-42', 'maple-Kite-42', 'maple-kite-４２', 'maple-kite-٤٢', 'maple–kite-42', 'maple‑kite-42', 'maple-kite-42​', '‮maple-kite-42',
  // Call signs and server names are not codes.
  'Brave Otter 7', 'brave-otter-7', 'Harbour Hangar', 'harbour-hangar-7',
  // And things that are not strings.
  null, undefined, 42, ['maple-kite-42'], { toString: () => 'maple-kite-42' }, new String('maple-kite-42'),
];
/** Dice that roll these codes one after another, and then start again. */
const diceFor = (codes) => {
  const picks = codes.flatMap((c) => {
    const p = P.parseCode(c);
    return [[P.CODE_FIRST, p.first], [P.CODE_SECOND, p.second], [P.CALLSIGN_NUMBERS, p.number]].map(([list, v]) => (list.indexOf(v) + 0.5) / list.length);
  });
  let n = 0;
  return () => picks[n++ % picks.length];
};
{
  const F = P.CODE_FIRST;
  const S2 = P.CODE_SECOND;
  const N = P.CALLSIGN_NUMBERS;
  const inOrder = (l) => l.every((w, i) => !i || l[i - 1] < w);
  ok('the code lists: over a hundred words each, lower-case ASCII, in order, none twice, none in both',
    F.length >= 100 && S2.length >= 100 && [...F, ...S2].every((w) => /^[a-z]{2,12}$/.test(w)) && inOrder(F) && inOrder(S2) && !F.some((w) => S2.includes(w)),
    `${F.length} × ${S2.length} words × ${N.length} numbers = ${F.length * S2.length * N.length} codes`);
  ok('there are as many codes as there were five-letter ones (1.1 million)', F.length * S2.length * N.length >= 1_099_263);
  const badWords = [...F, ...S2].filter((w) => WHOLE.includes(w) || ROOTS.some((r) => w.includes(r)));
  const runTogether = [];
  for (const a of F) for (const b of S2) if (ROOTS.some((r) => (a + b).includes(r))) runTogether.push(`${a}-${b}`);
  ok('no code word is a rude word, and no pair run together spells one', badWords.length === 0 && runTogether.length === 0,
    [...badWords, ...runTogether].join(', ') || `${F.length + S2.length} words, ${F.length * S2.length} pairs`);
  ok('no two pairs run together the same way, so a code typed without spaces reads one way only', P.CODE_JOINED_COUNT === F.length * S2.length, `${P.CODE_JOINED_COUNT} ways`);

  // Exhaustive, one way: every code there is — every pair with every number — is taken as it is and parses back into its list words.
  const t0 = performance.now();
  let all = 0;
  const wrong = [];
  let longest = '';
  for (const a of F) for (const b of S2) {
    const pair = P.formatCode({ first: a, second: b, number: 99 });
    if (P.shownCode(pair) !== pair || P.normaliseCode(`${a} ${b} 99`) !== pair) wrong.push(pair);
    if (pair.length > longest.length) longest = pair;
    for (const n of N) {
      const s = `${a}-${b}-${n}`;
      all++;
      const p = P.parseCode(s);
      if (!p || p.first !== a || p.second !== b || p.number !== n) wrong.push(s);
    }
  }
  ok('every one of the codes (each pair, each number) is a code, shown as it is, and parses back into its list words', wrong.length === 0 && longest.length <= P.CODE_MAX,
    wrong.length ? `${wrong.length} wrong: ${wrong.slice(0, 3).join(', ')}` : `${all} codes in ${Math.round(performance.now() - t0)} ms; longest "${longest}"`);

  /*
   * Exhaustive, the other way: a code is three parts, and each part is looked
   * up on its own — so every string in each part's place, with the other two
   * right, is taken exactly when it is a list word (or a list number). Tried
   * in each place: every string of one to three lower-case letters, every
   * list word with a letter changed, added or taken away, every word from
   * the other lists, and the look-alikes; every string of one to three
   * digits. And whatever is taken splits into exactly two list words and a
   * list number.
   */
  const t1 = performance.now();
  const abc = 'abcdefghijklmnopqrstuvwxyz';
  const short = [''];
  for (let len = 1; len <= 3; len++) for (const w of short.filter((x) => x.length === len - 1)) for (const ch of abc) short.push(w + ch);
  const edits = (w) => {
    const out = [];
    for (let i = 0; i <= w.length; i++) {
      for (const ch of abc) out.push(w.slice(0, i) + ch + w.slice(i), w.slice(0, i) + ch + w.slice(i + 1));
      if (i < w.length) out.push(w.slice(0, i) + w.slice(i + 1));
    }
    return out;
  };
  const LOOK = { a: 'а', e: 'е', o: 'о', p: 'р', c: 'с', i: 'і', k: 'K', l: 'ӏ', s: 'ѕ', y: 'у' };
  const lookalikes = (w) => [...w].flatMap((ch, i) => (LOOK[ch] ? [w.slice(0, i) + LOOK[ch] + w.slice(i + 1)] : []));
  const other = [...P.CALLSIGN_ADJECTIVES, ...P.CALLSIGN_NOUNS, ...P.SERVER_PLACES, ...P.SERVER_BASES];
  const tokensFor = (list) => new Set([...short, ...list.flatMap(edits), ...list.flatMap(lookalikes), ...list.map((w) => w.toUpperCase()), ...list.map((w) => w[0].toUpperCase() + w.slice(1)),
    ...other, ...other.map((w) => w.toLowerCase()), ...F, ...S2, ...WHOLE, ...ROOTS, ...JUNK_CODES.filter((x) => typeof x === 'string'), ' maple', 'maple ', 'map le']);
  const numbers = new Set(['', '-1', '+7', '4.2', '1e1', '0x1', '７', '٤٢', '\u{1d7d5}', ' 7', '7 ']);
  for (let len = 1; len <= 3; len++) for (let k = 0; k < 10 ** len; k++) numbers.add(String(k).padStart(len, '0'));
  let tried = 0;
  const leaks = [];
  const check = (s, want) => {
    tried++;
    const got = P.shownCode(s) === s;
    if (got !== want) leaks.push(JSON.stringify(s));
    if (got) {
      const parts = s.split('-');
      if (parts.length !== 3 || !F.includes(parts[0]) || !S2.includes(parts[1]) || !N.includes(Number(parts[2])) || String(Number(parts[2])) !== parts[2]) leaks.push(`not from the lists: ${JSON.stringify(s)}`);
    }
  };
  for (const t of tokensFor(F)) check(`${t}-kite-42`, F.includes(t));
  for (const t of tokensFor(S2)) check(`maple-${t}-42`, S2.includes(t));
  for (const t of numbers) check(`maple-kite-${t}`, N.includes(Number(t)) && String(Number(t)) === t);
  ok('each part of a code is taken only when it is a list word or a list number, and whatever is taken splits into exactly those',
    leaks.length === 0, leaks.length ? `${leaks.length}: ${leaks.slice(0, 5).join(', ')}` : `${tried} strings in ${Math.round(performance.now() - t1)} ms`);

  // Made by the game: the dice, whatever they roll.
  let bad = 0;
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const c = P.makeCode();
    seen.add(c);
    if (P.shownCode(c) !== c) bad++;
  }
  const edge = [() => 0, () => 0.9999999, () => 1].map((r) => P.makeCode(r));
  ok('every code the game makes is one it would show, even from dice at their very edges', bad === 0 && seen.size > 19000 && edge.every((c) => P.shownCode(c) === c),
    `${seen.size} different in 20000; edges ${edge.join(', ')}`);

  // Typed by a child: any case, spaces or hyphens or none — and read back as the lists spell it.
  const typed = [...NEARLY_CODES, 'maple-kite-42', 'Maple Kite 42', 'MAPLE KITE 42', ' maple  kite - 42 ', 'MapleKite 42', 'maple kite42'];
  ok('codes are typed forgivingly, and come back exactly as the game writes them', typed.every((t) => P.normaliseCode(t) === 'maple-kite-42'),
    typed.map((t) => P.normaliseCode(t)).join(', '));
  const typedBad = [...JUNK_CODES.filter((x) => !NEARLY_CODES.includes(x)), ...LOOKALIKE_ATTACKS, ...NEAR_MISSES, 'maple kite', '42', 'kite maple 42',
    'maple kite 4 2x', 'constructor1', '__proto__7', 'maple\tkite 42', 'maple.kite.42'].filter((t) => P.normaliseCode(t) !== null);
  ok('and refuse what they cannot be: the fourth review\'s codes, look-alikes, other lists, numbers a code never has, not a string', typedBad.length === 0,
    typedBad.length ? `${typedBad.length} through: ${typedBad.slice(0, 5).map((t) => JSON.stringify(t)).join(', ')}` : 'all refused');
  let kinds = 0;
  const shownBad = JUNK_CODES.filter((w) => { kinds++; return P.shownCode(w) !== null; });
  ok('a code is shown only as the exact string: not the fourth review\'s, not upper case, spaced, look-alike, or not a string', shownBad.length === 0 && P.shownCode('maple-kite-42') === 'maple-kite-42',
    shownBad.length ? `${shownBad.length} through: ${shownBad.map((w) => JSON.stringify(w)).join(', ')}` : `${kinds} refused`);
  // The old five-letter codes are not codes at all now: a sample of 20,000 from the old alphabet, and all eight of the fourth review's.
  const OLD = 'BCDGHJKMNPQRSTVWZ';
  let oldTaken = 0;
  for (let i = 0; i < 20000; i++) {
    let s = '';
    for (let j = 0; j < 5; j++) s += OLD[Math.floor(Math.random() * OLD.length)];
    if (P.shownCode(s) !== null || P.normaliseCode(s) !== null || P.normaliseCode(s.toLowerCase()) !== null) oldTaken++;
  }
  ok('no five-letter code is a code any more', oldTaken === 0, `${oldTaken} of 20000 taken`);

  // A player who joined by typing a code is shown that code; the id says which.
  ok('the code a player joined by is read from the id they joined, and only if it is a code',
    P.codeOfId(P.codeId('maple-kite-42')) === 'maple-kite-42' && P.codeOfId(`ifs-code-${r13('CUPXE')}`) === null && P.codeOfId('ifs-code-Maple-kite-42') === null
    && P.codeOfId(P.slotId('abcdef012345', 1)) === null && P.codeOfId(null) === null && P.codeOfId({ toString: () => 'ifs-code-maple-kite-42' }) === null);

  // claimCode claims only a code it will show, whatever the dice roll.
  const opened = [];
  const fakeSig = () => ({ open: async (id) => { opened.push(id); }, close() {} });
  const lows = await S.claimCode({ makeSig: fakeSig, rand: () => 0 });
  const highs = await S.claimCode({ makeSig: fakeSig, rand: () => 0.9999999 });
  const steered = await S.claimCode({ makeSig: fakeSig, rand: diceFor(['sunflower-lighthouse-99']) });
  ok('claiming a code claims only one it will show, whatever the dice roll', [lows, highs, steered].every((g) => P.shownCode(g.code) === g.code)
    && opened.join() === [lows, highs, steered].map((g) => P.codeId(g.code)).join() && steered.code === 'sunflower-lighthouse-99',
    `${lows.code}, ${highs.code}, ${steered.code}`);
}

/* ---- names: call signs from the lists, and nothing else -------------- */
/*
 * There is no free text any more: a name is an adjective and an animal (or
 * aircraft word) from two lists, maybe with a number, and a server name is a
 * place and a base from two more. Anything else is refused, and replaced by
 * the host with a call sign made from the player's number.
 */
{
  const A = P.CALLSIGN_ADJECTIVES;
  const N = P.CALLSIGN_NOUNS;
  const all = [...A, ...N, ...P.SERVER_PLACES, ...P.SERVER_BASES];
  ok('the lists: about sixty adjectives and sixty animals and aircraft, each a plain word, none twice',
    A.length >= 55 && N.length >= 55 && new Set(A).size === A.length && new Set(N).size === N.length
    && new Set(P.SERVER_PLACES).size === P.SERVER_PLACES.length && new Set(P.SERVER_BASES).size === P.SERVER_BASES.length
    && all.every((w) => /^[A-Z][a-z]{1,11}$/.test(w)), `${A.length} adjectives × ${N.length} nouns, ${P.SERVER_PLACES.length} × ${P.SERVER_BASES.length} server words`);

  // Every pair, with no number and with every number: accepted, and made of list words only.
  let pairs = 0;
  let withNumbers = 0;
  const wrong = [];
  const long = [];
  for (const a of A) for (const n of N) {
    pairs++;
    for (const num of [0, ...P.CALLSIGN_NUMBERS]) {
      const s = P.formatCallSign({ adjective: a, noun: n, number: num });
      withNumbers++;
      const r = P.cleanName(s);
      const back = P.parseCallSign(s);
      if (!r.ok || r.name !== s || !back || back.adjective !== a || back.noun !== n || back.number !== num || !A.includes(back.adjective) || !N.includes(back.noun)) wrong.push(s);
      if (s.length > P.NAME_MAX) long.push(s);
    }
  }
  ok('every list pair is a call sign, with and without a number, and parses back into list words', wrong.length === 0 && long.length === 0,
    wrong.length ? `${wrong.length} wrong: ${wrong.slice(0, 5).join(', ')}` : long.length ? `too long: ${long[0]}` : `${pairs} pairs, ${withNumbers} with numbers`);
  let spairs = 0;
  const swrong = [];
  for (const a of P.SERVER_PLACES) for (const b of P.SERVER_BASES) {
    spairs++;
    const s = `${a} ${b}`;
    if (!P.parseServerName(s) || P.safeServerName(s) !== s || s.length > P.SERVER_NAME_MAX) swrong.push(s);
  }
  ok('every server-name pair is accepted as it is', swrong.length === 0, swrong.join(', ') || `${spairs} pairs`);

  // WHOLE and ROOTS are at the top of the file, shared with the join codes.
  const badWords = all.filter((w) => WHOLE.includes(w.toLowerCase()) || ROOTS.some((r) => w.toLowerCase().includes(r)));
  const runTogether = [];
  for (const a of A) for (const n of N) {
    const s = (a + n).toLowerCase();
    if (ROOTS.some((r) => s.includes(r))) runTogether.push(`${a} ${n}`);
  }
  for (const a of P.SERVER_PLACES) for (const b of P.SERVER_BASES) {
    const s = (a + b).toLowerCase();
    if (ROOTS.some((r) => s.includes(r))) runTogether.push(`${a} ${b}`);
  }
  ok('no list word is a rude word, and no pair run together spells one', badWords.length === 0 && runTogether.length === 0,
    [...badWords, ...runTogether].join(', ') || `${all.length} words, ${pairs + spairs} pairs`);
  // Every number from 1 to 99 that the ADL's hate-symbol database lists on its own (12 and 13 are prison gangs); 69 is 69.
  const NOT = [12, 13, 14, 18, 23, 28, 33, 38, 43, 69, 83, 88];
  ok('the numbers are 1 to 99 without 12, 13, 14, 18, 23, 28, 33, 38, 43, 69, 83 and 88', P.CALLSIGN_NUMBERS.length === 87 && P.CALLSIGN_NUMBERS[0] === 1 && P.CALLSIGN_NUMBERS.at(-1) === 99
    && NOT.every((n) => !P.CALLSIGN_NUMBERS.includes(n) && P.NOT_NUMBERS.includes(n)) && P.NOT_NUMBERS.length === NOT.length
    && NOT.every((n) => !P.parseCallSign(`Swift Falcon ${n}`) && P.safeName(`Swift Falcon ${n}`, 'Brave Otter') === 'Brave Otter'),
    `${P.CALLSIGN_NUMBERS.length} numbers`);

  // The 88 look-alike attacks, and the near misses: every one refused, and replaced.
  const fallback = P.callSignForId(3);
  const through = LOOKALIKE_ATTACKS.filter((w) => P.cleanName(w).ok || P.safeName(w, fallback) !== fallback);
  ok('the 88 look-alike attacks are all refused and replaced', LOOKALIKE_ATTACKS.length === 88 && new Set(LOOKALIKE_ATTACKS).size === 88 && through.length === 0,
    through.length ? `${through.length} through: ${through.map((w) => JSON.stringify(w)).join(', ')}` : `${LOOKALIKE_ATTACKS.length} refused`);
  const near = NEAR_MISSES.filter((w) => P.cleanName(w).ok || P.safeName(w, fallback) !== fallback);
  ok('a name that is nearly a call sign is not one', near.length === 0, near.map((w) => JSON.stringify(w)).join(', ') || `${NEAR_MISSES.length} refused`);
  const odd = NOT_STRINGS.filter((w) => P.cleanName(w).ok || P.safeName(w, fallback) !== fallback);
  ok('nor is anything that is not a string', odd.length === 0, `${odd.length} through`);
  ok('an empty name is refused as empty', P.cleanName('').why === 'empty' && P.cleanName(null).why === 'empty' && P.cleanName('Hana').why === 'list');
  ok('server names too: only a place and a base', ['Harbour  Hangar', 'harbour hangar', 'Hangar Harbour', 'Hana’s server', 'Нarbour Hangar', 'Brave Otter', 'Cloud Base 7', 'Cloud Base​']
    .every((w) => !P.parseServerName(w) && P.safeServerName(w) === 'A server'));

  // Made by the game: the dice, the fallbacks, the defaults.
  let dice = 0;
  let diceBad = 0;
  let numbered = 0;
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const s = P.randomCallSign();
    dice++;
    seen.add(s);
    const p = P.parseCallSign(s);
    if (!p) diceBad++;
    else if (p.number) numbered++;
  }
  ok('the dice only ever rolls call signs, about half with a number', diceBad === 0 && numbered > 700 && numbered < 1300 && seen.size > 1500, `${dice} rolls, ${seen.size} different, ${numbered} numbered`);
  const byId = [0, 1, 2, 3, 4].map(P.callSignForId);
  ok('the call sign made from a player’s number is a call sign, one each', byId.every((s) => P.parseCallSign(s)) && new Set(byId).size === 5, byId.join(', '));
  const servers = new Set();
  for (let i = 0; i < 500; i++) servers.add(P.randomServerName());
  for (let i = 0; i < 500; i++) servers.add(P.serverNameFor(`key${i}`));
  ok('rolled and default server names are server names', [...servers].every((s) => P.parseServerName(s)) && servers.size > 300 && P.serverNameFor('abc') === P.serverNameFor('abc'), `${servers.size} different`);

  // Two of the same.
  ok('two Swift Falcons become Swift Falcon and Swift Falcon 2', P.uniqueName('Swift Falcon', ['Swift Falcon', 'Brave Otter']) === 'Swift Falcon 2'
    && P.uniqueName('Swift Falcon 7', ['Swift Falcon 7', 'Swift Falcon 2']) === 'Swift Falcon 3' && P.uniqueName('Brave Otter', ['Swift Falcon']) === 'Brave Otter');

  // Through the wire format and back: a call sign arrives as it was sent; anything else arrives as the fallback.
  const trip = (name, id = 2) => P.readPlayer(P.readEvent(P.writeEvent({ t: 'join', p: { id, name, colour: P.COLOURS[1] } })).p);
  const cs = ['Brave Otter', 'Swift Falcon 7', 'Cheerful Albatross 99', P.randomCallSign(), P.callSignForId(4)];
  ok('a call sign survives encode and decode as it is', cs.every((s) => trip(s).name === s), cs.map((s) => trip(s).name).join(', '));
  const tripBad = [...LOOKALIKE_ATTACKS, ...NEAR_MISSES].filter((w) => trip(w, 2).name !== P.callSignForId(2));
  ok('and anything else arrives as the call sign made from the player’s number', tripBad.length === 0, tripBad.length ? `${tripBad.length} through` : `${LOOKALIKE_ATTACKS.length + NEAR_MISSES.length} replaced`);
  const info = P.readInfo(P.readEvent(P.writeEvent({ t: 'info', name: 'Sunset Pier', map: 'kestrel', mapName: 'anything the host liked', game: 'flight', players: 1, max: 5 })));
  const infoBad = P.readInfo({ t: 'info', name: LOOKALIKE_ATTACKS[0], map: 'nowhere', mapName: LOOKALIKE_ATTACKS[1], game: 'flight', players: 1, max: 5 });
  ok('a server’s name arrives only if it is from the lists; its map’s name is always this copy’s own', info.name === 'Sunset Pier' && info.mapName === 'Kestrel Island'
    && infoBad.name === 'A server' && infoBad.mapName === 'An island', `${info.name} / ${info.mapName}; ${infoBad.name} / ${infoBad.mapName}`);
  {
    // A modified HOST: its roster, its reasons for a leave and a refusal are read against this copy's own lists and tables.
    const events = [];
    const c = new S.ClientSession({ net: null, target: P.codeId('maple-kite-42'), profile: { name: 'Brave Otter', colour: P.COLOURS[0], key: 'k' }, onEvent: (...e) => events.push(e) });
    c.link = { send() {}, close() {} };
    let refusal = null;
    c._resolve = () => {};
    c._reject = (e) => (refusal = e);
    c._event({ t: 'deny', why: 'constructor' });
    c.welcomed = true;
    c.id = 1;
    c._event({ t: 'roster', players: [{ id: 0, name: LOOKALIKE_ATTACKS[5], host: true }, { id: 1, name: 'Hana' }, { id: 2, name: 'Swift Falcon 7' }, { id: 3, name: NEAR_MISSES[0] }] });
    c._event({ t: 'leave', id: 2, why: 'constructor' });
    const names = [...c.players.values()].map((p) => p.name);
    const left = events.find((e) => e[0] === 'leave');
    ok('a modified host’s roster, leave and refusal show only list words and this copy’s own sentences',
      refusal && refusal.code === 'denied' && refusal.message === 'The server said no.' && c.name === P.callSignForId(1)
      && names.join('|') === [P.callSignForId(0), P.callSignForId(3)].join('|') && left && left[1].name === 'Swift Falcon 7' && left[2] === 'left',
      `${refusal && refusal.message}; me ${c.name}; roster ${names.join(', ')}; leave ${left && left[2]}`);
  }
  {
    /*
     * A modified HOST's join code. The code is on the joiner's badge and in
     * their player list all game long; review got HELLO onto both, and then
     * a swear word and a slur spelt without vowels. Now a host's code is kept
     * only if it is exactly two list words and a list number — so the most a
     * modified host can do is pick one of those — and a player who typed a
     * code is shown the code they typed.
     */
    const welcomeWith = (code, target = P.slotId('abcdef012345', 1)) => {
      const c = new S.ClientSession({ net: null, target, profile: { name: 'Brave Otter', colour: P.COLOURS[0], key: 'k' }, onEvent() {} });
      c.link = { send() {}, close() {} };
      c._event({ t: 'welcome', you: 1, name: 'Brave Otter', server: { name: 'Cloud Base', map: 'kestrel', game: 'flight', code, slot: 88 }, players: [] });
      return c.server;
    };
    const kept = JUNK_CODES.map((code) => [code, welcomeWith(code).code]).filter(([, shown]) => shown !== null);
    const good = welcomeWith('maple-kite-42');
    const review = ['CUPXE', 'EQFXA', 'CUPXQ', 'CUPXF', 'FCXFO', 'OAEFO', 'XAGFO', 'JGOXF'].map(r13).map((code) => welcomeWith(code).code);
    ok('a modified host’s code is dropped unless it is exactly two list words and a list number — including every code the fourth review got through',
      kept.length === 0 && review.every((x) => x === null) && good.code === 'maple-kite-42' && good.slot === 0,
      kept.length ? `${kept.length} kept: ${kept.map(([, x]) => JSON.stringify(x)).join(', ')}` : `${JUNK_CODES.length} dropped; maple-kite-42 kept`);
    const typedIn = P.codeId('moon-rover-7');
    const mine = [welcomeWith('maple-kite-42', typedIn).code, welcomeWith(r13('CUPXE'), typedIn).code, welcomeWith(null, typedIn).code];
    ok('a player who joined by typing a code is shown the code they typed, whatever the host says its code is', mine.every((x) => x === 'moon-rover-7'), mine.join(', '));

    // And its pings: any number it likes arrives, but a ping is only ever shown in round steps.
    const allowed = new Set(['', 'under 10 ms', 'over 1000 ms']);
    for (let k = 1; k <= 9; k++) allowed.add(`${k * 10} ms`);
    for (let k = 1; k <= 10; k++) allowed.add(`${k * 100} ms`);
    const shown = new Set();
    for (let ms = -5; ms <= 12000; ms += 0.25) shown.add(P.pingLabel(ms));
    for (const v of [null, undefined, NaN, Infinity, '88', {}]) shown.add(P.pingLabel(v));
    const odd = [...shown].filter((s) => !allowed.has(s));
    const roster = [88, 1488, 14, 18, 28, 83, 69, 311, 9999].map((ping) => P.pingLabel(P.readPlayer({ id: 2, name: 'Swift Falcon', ping }).ping));
    ok('a ping is shown only as 10–90 or 100–1000 in round steps, whatever number the host sends', odd.length === 0
      && roster.every((l) => !/\b(14|18|28|69|83|88|311|1488)\b/.test(l)) && P.pingLabel(88) === '90 ms' && P.pingLabel(3) === 'under 10 ms',
      odd.length ? `shown: ${odd.join(', ')}` : roster.join(', '));

    // And its weather: 'constructor' is in every table weather.js looks names up in.
    const wx = P.readWeather({ time: 'constructor', condition: 'constructor', windSpeedKts: 5 });
    const wxOk = P.readWeather({ time: 'night', condition: 'rainy' });
    ok('a modified host’s weather cannot name what every object has', !('time' in wx) && !('condition' in wx) && wx.windSpeedKts === 5 && wxOk.time === 'night' && wxOk.condition === 'rainy');
  }
  {
    const { MAPS } = await import('../../src/world/maps.js');
    const lost = MAPS.filter((m) => P.mapNameFor(m.id) !== m.name).map((m) => m.id);
    ok('every map is named from the game’s own list', lost.length === 0, lost.join(', ') || `${MAPS.length} maps`);
  }
}

/* ---- snapshots ------------------------------------------------------ */
{
  const s = {
    id: 3, seq: 70000, t: 123456.7, pos: { x: -3412.345, y: 612.25, z: 18999.9 },
    quat: { x: 0.1, y: -0.7, z: 0.05, w: 0.7 }, vel: { x: 61.23, y: -3.3, z: -0.05 },
    game: 'heli', gearDown: true, lights: true, engineOn: true, onGround: false, crashed: false, brakes: true,
    gearPos: 0.5, flaps: 0.66, throttle: 0.8, rpm: 1.02, pitch: -0.4, roll: 0.9, yaw: 0, steer: -1, type: 'harrier',
  };
  const buf = P.encodeState(s);
  const d = P.decodeState(buf);
  const ql = Math.hypot(0.1, 0.7, 0.05, 0.7);
  const qerr = Math.max(Math.abs(d.quat.x - 0.1 / ql), Math.abs(d.quat.y + 0.7 / ql), Math.abs(d.quat.w - 0.7 / ql));
  ok('snapshot is small', buf.byteLength <= 70, `${buf.byteLength} bytes`);
  ok('snapshot round trip: position to a centimetre', Math.abs(d.pos.x - s.pos.x) < 0.01 && Math.abs(d.pos.z - s.pos.z) < 0.01 && Math.abs(d.pos.y - s.pos.y) < 0.01,
    `${d.pos.x.toFixed(3)}, ${d.pos.y.toFixed(3)}, ${d.pos.z.toFixed(3)}`);
  ok('snapshot round trip: attitude and velocity', qerr < 1e-4 && Math.abs(d.vel.x - 61.25) < 0.03 && Math.abs(d.vel.y + 3.3) < 0.03, `quat err ${qerr.toExponential(1)}`);
  ok('snapshot round trip: flags, controls, type', d.id === 3 && d.seq === 70000 % 65536 && d.t === 123457 && d.game === 'heli' && d.gearDown && d.brakes && !d.onGround
    && Math.abs(d.flaps - 0.66) < 0.01 && Math.abs(d.rpm - 1.02) < 0.01 && Math.abs(d.roll - 0.9) < 0.01 && d.steer === -1 && d.type === 'harrier');
  const junk = [new ArrayBuffer(10), new ArrayBuffer(200), (() => { const b = P.encodeState(s); new DataView(b).setUint8(0, 1); return b; })(),
    (() => { const b = P.encodeState(s); new DataView(b).setFloat32(8, NaN, true); return b; })(),
    (() => { const b = P.encodeState(s); new DataView(b).setUint8(44, 30); return b; })()];
  ok('malformed snapshots are refused', junk.every((b) => P.decodeState(b) === null));
  P.stampStateId(buf, 1);
  ok('the host can restamp the sender', P.decodeState(buf).id === 1);
  ok('events: junk is null, a known one parses', P.readEvent('{"t":"nope"}') === null && P.readEvent('not json') === null && P.readEvent('x'.repeat(5000)) === null && P.readEvent('{"t":"chat","m":1}').m === 1);
}

/* ---- interpolation -------------------------------------------------- */
{
  // A plane flying east at 60 m/s, sending at 15 Hz with 30–90 ms of jitter.
  const truth = (tMs) => ({ x: 60 * (tMs / 1000), y: 500, z: 0 });
  const tr = new Track();
  const offset = 5000; // the receiver's clock is ahead by five seconds
  let worst = 0;
  let rand = 1;
  const rnd = () => ((rand = (rand * 16807) % 2147483647) / 2147483647);
  const arrivals = [];
  for (let t = 0; t <= 6000; t += 1000 / 15) arrivals.push({ t, at: t + offset + 30 + rnd() * 60 });
  arrivals.sort((a, b) => a.at - b.at);
  let k = 0;
  for (let now = offset + 200; now < offset + 6000; now += 16) {
    while (k < arrivals.length && arrivals[k].at <= now) {
      const a = arrivals[k++];
      tr.push({ t: a.t, pos: truth(a.t), vel: { x: 60, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } }, a.at);
    }
    const out = tr.sample(now);
    if (!out || now < offset + 1500) continue; // let the clock estimate settle
    // Drawn about 100 ms (plus the minimum delay) behind: compare against the truth at the moment it is drawing.
    const drawnAt = now - tr.offset - tr.delayMs;
    worst = Math.max(worst, Math.abs(out.pos.x - truth(drawnAt).x));
  }
  ok('interpolation follows a jittery stream to within 5 cm', worst < 0.05, `worst ${worst.toFixed(3)} m`);
  const lag = (offset + 6000 - 16) - tr.offset - tr.delayMs;
  ok('and draws it about 130 ms behind', tr.offset - offset < 45 && tr.offset - offset >= 29, `offset settles ${Math.round(tr.offset - offset)} ms above the true clock gap; last drawn t=${Math.round(lag)}`);

  // A busy network: packets 30 to 600 ms late. A fixed 100 ms buffer would be guessing most of the time.
  {
    const trj = new Track();
    const fixed = new Track({ delayMs: 100, maxDelayMs: 100 });
    const arr = [];
    for (let t = 0; t <= 20000; t += 1000 / 15) arr.push({ t, at: t + offset + 30 + (rnd() ** 3) * 570 });
    arr.sort((a, b) => a.at - b.at);
    let j = 0;
    let n = 0;
    let exAdaptive = 0;
    let exFixed = 0;
    let worstA = 0;
    for (let now = offset + 200; now < offset + 20000; now += 16) {
      while (j < arr.length && arr[j].at <= now) {
        const a = arr[j++];
        const snap = { t: a.t, pos: truth(a.t), vel: { x: 60, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } };
        trj.push(snap, a.at);
        fixed.push(snap, a.at);
      }
      if (now < offset + 5000) continue;
      const sa = trj.sample(now);
      const sf = fixed.sample(now);
      n++;
      if (sa.extrapolated) exAdaptive++;
      if (sf.extrapolated) exFixed++;
      worstA = Math.max(worstA, Math.abs(sa.pos.x - truth(now - trj.offset - trj.delayMs).x));
    }
    ok('on a jittery network the buffer grows and stops guessing', exAdaptive / n < 0.1 && exFixed / n > 0.3 && trj.delayMs > 150,
      `extrapolating ${Math.round((100 * exAdaptive) / n)} % of frames vs ${Math.round((100 * exFixed) / n)} % with a fixed 100 ms; delay settled at ${Math.round(trj.delayMs)} ms; worst ${worstA.toFixed(2)} m`);
  }

  // Out of order and a gap.
  const t2 = new Track({ delayMs: 100 });
  const snap = (t, x) => ({ t, pos: { x, y: 0, z: 0 }, vel: { x: 50, y: 0, z: 0 }, quat: { x: 0, y: 0, z: 0, w: 1 } });
  t2.push(snap(0, 0), 20);
  t2.push(snap(132, 6.6), 152);
  t2.push(snap(66, 3.3), 170); // late
  ok('an out-of-order snapshot is slotted in, not appended', t2.snaps.map((s) => s.t).join(',') === '0,66,132');
  const mid = t2.sample(20 + 66 + 100);
  ok('samples between snapshots', Math.abs(mid.pos.x - 3.3) < 0.01 && !mid.extrapolated, mid.pos.x.toFixed(3));
  const ahead = t2.sample(20 + 132 + 100 + 200);
  ok('extrapolates along the velocity when the stream stops', ahead.extrapolated && Math.abs(ahead.pos.x - (6.6 + 50 * 0.2)) < 0.01, ahead.pos.x.toFixed(2));
  const far = t2.sample(20 + 132 + 100 + 3000);
  ok('and holds after half a second', Math.abs(far.pos.x - (6.6 + 50 * 0.5)) < 0.01, far.pos.x.toFixed(2));

  // A respawn: two snapshots a kilometre apart are not slid between.
  const t3 = new Track({ delayMs: 100 });
  t3.push(snap(0, 0), 10);
  t3.push({ ...snap(66, 1000), vel: { x: 0, y: 0, z: 0 } }, 76);
  const j = t3.sample(10 + 33 + 100);
  ok('a teleport is jumped, not flown through', j.pos.x < 5 || j.pos.x > 995, j.pos.x.toFixed(1));
}

/* ---- what is drawn: the sample with its seams smoothed ---------------- */
{
  const { Smoother } = await import('../../src/features/multiplayer/interp.js');
  const sm = new Smoother();
  const v = { x: 55, y: 0, z: 0 };
  let worstOff = 0;
  for (let i = 0; i <= 60; i++) {
    const raw = { x: 55 * (i / 60), y: 300, z: 0 };
    const o = sm.step(raw, v, 1 / 60);
    worstOff = Math.max(worstOff, Math.hypot(o.x - raw.x, o.y - raw.y, o.z - raw.z));
  }
  ok('steady flight is drawn exactly where it is sampled', worstOff < 1e-9, `${worstOff} m`);
  // A late snapshot after extrapolating: the sample jumps 8 m sideways in one frame.
  let x = 55;
  const before = { ...sm.step({ x, y: 300, z: 0 }, v, 1 / 60) };
  x += 55 / 60;
  const first = { ...sm.step({ x, y: 300, z: 8 }, v, 1 / 60) };
  const step = Math.hypot(first.x - before.x, first.z - before.z);
  let o = first;
  for (let i = 0; i < 30; i++) {
    x += 55 / 60;
    o = sm.step({ x, y: 300, z: 8 }, v, 1 / 60);
  }
  ok('a sample that jumps 8 m is slid over, not teleported: the first frame moves about as far as the speed allows',
    step < 55 / 60 + 0.5, `${step.toFixed(2)} m in one frame (${(step * 60).toFixed(0)} m/s)`);
  ok('and it has caught up within half a second', Math.abs(o.z - 8) < 0.4, `${(8 - o.z).toFixed(2)} m still to go`);
  const r = sm.step({ x: x + 500, y: 300, z: 8 }, v, 1 / 60);
  ok('a jump of hundreds of metres is a respawn, and is drawn at once', Math.abs(r.x - (x + 500)) < 1e-9);
}

/* ---- predict: drawn where they are now (list 2, "less lag") ------------ */
{
  const I = await import('../../src/features/multiplayer/interp.js');
  // A Skylark in a steady 30° turn: 55 m/s, turning at g·tan30/v.
  const w = (9.81 * Math.tan(Math.PI / 6)) / 55;
  const at = (tMs) => {
    const s = tMs / 1000;
    const psi = w * s;
    const R = 55 / w;
    return {
      pos: { x: R * Math.sin(psi), y: 400, z: -R * (1 - Math.cos(psi)) + 0 },
      vel: { x: 55 * Math.cos(psi), y: 0, z: -55 * Math.sin(psi) },
      quat: { x: 0, y: Math.sin(-psi / 2 + Math.PI / 4), z: 0, w: Math.cos(-psi / 2 + Math.PI / 4) },
    };
  };
  const tr = new I.Track();
  const clock = 7000;
  for (let t = 0; t <= 2000; t += 1000 / 15) tr.push({ t, ...at(t) }, t + clock + 8);
  // 90 ms after the last snapshot was sent — what a receiver sees just before the next one lands.
  const last = Math.floor(2000 / (1000 / 15)) * (1000 / 15);
  const now = last + clock + 8 + 90;
  const p = tr.predict(now);
  const truth = at(last + 90);
  const err = Math.hypot(p.pos.x - truth.pos.x, p.pos.y - truth.pos.y, p.pos.z - truth.pos.z);
  const old = tr.sample(now);
  const oldErr = Math.hypot(old.pos.x - truth.pos.x, old.pos.z - truth.pos.z);
  ok('predict: a Skylark in a 30° turn, guessed 90 ms past its last snapshot, is within 5 cm of where it is', err < 0.05, `${(err * 100).toFixed(1)} cm (sample(), 100 ms in the past: ${oldErr.toFixed(1)} m)`);
  const ang = (I.quatAngle(p.quat, truth.quat) * 180) / Math.PI;
  ok('and it is pointing the right way: the turn carried on', ang < 0.5, `${ang.toFixed(2)}° off`);
  const far = tr.predict(last + clock + 8 + 5000);
  const hold = tr.predict(last + clock + 8 + 9000);
  const lastSnap = tr.snaps[tr.snaps.length - 1];
  const ran = Math.hypot(far.pos.x - lastSnap.pos.x, far.pos.z - lastSnap.pos.z);
  ok('predict: a stream that stops coasts a little way to a stop, and is held there',
    Math.abs(far.pos.x - hold.pos.x) < 1e-6 && far.vel.x === 0 && ran > 5 && ran < 25, `${ran.toFixed(1)} m past the last snapshot, at 55 m/s`);

  // The rotation smoother: a 4° disagreement at a seam is eased over, a respawn is not.
  const rs = new I.RotSmoother();
  const q0 = { x: 0, y: 0, z: 0, w: 1 };
  rs.step(q0, { x: 0, y: 0, z: 0 }, 1 / 30);
  const q4 = { x: 0, y: Math.sin((4 * Math.PI) / 360), z: 0, w: Math.cos((4 * Math.PI) / 360) };
  const first = rs.step(q4, { x: 0, y: 0, z: 0 }, 1 / 30);
  const firstDeg = (I.quatAngle(first, q0) * 180) / Math.PI;
  let o = first;
  for (let i = 0; i < 20; i++) o = rs.step(q4, { x: 0, y: 0, z: 0 }, 1 / 30);
  ok('a 4° seam in attitude is turned through over a few frames, not in one', firstDeg < 1.5 && I.quatAngle(o, q4) < 0.02, `${firstDeg.toFixed(2)}° in the first frame`);
  const q90 = { x: 0, y: Math.SQRT1_2, z: 0, w: Math.SQRT1_2 };
  const snapped = rs.step(q90, { x: 0, y: 0, z: 0 }, 1 / 30);
  ok('and a respawn facing another way is gone to at once', I.quatAngle(snapped, q90) < 1e-6);
}

/* ---- the host's bundles ------------------------------------------------ */
{
  const snaps = [1, 2, 5].map((id) => P.encodeState({ id, t: 100 * id, pos: { x: id, y: 2, z: 3 }, quat: { w: 1 }, vel: {}, game: 'flight', type: id === 5 ? 'harrier' : 'skylark' }));
  const b = P.encodeBundle(snaps);
  const back = P.decodeStates(b);
  ok('a bundle carries three snapshots and gives back three', back.length === 3 && back.map((s) => s.id).join() === '1,2,5' && back[2].type === 'harrier', back.map((s) => s.id).join());
  const u = new Uint8Array(b);
  const junk = [u.slice(0, u.length - 1), Uint8Array.of(0x42, 0), Uint8Array.of(0x42, 9, 1, 2), (() => { const x = u.slice(); x[2] = 200; return x; })(), Uint8Array.from([...u, 7])];
  ok('a malformed bundle is nothing, not a crash', junk.every((j) => P.decodeBundle(j.buffer) === null && P.decodeStates(j.buffer).length === 0));
  ok('and a plain snapshot still reads as one', P.decodeStates(snaps[0]).length === 1);

  // Eight in a lobby, each sending 15 a second for 2 s; count the host's packets with bundling off (as before) and on.
  const run = (bundleMs) => {
    let t = 0;
    const host = new S.HostSession({ profile: { name: 'Brave Otter', colour: P.COLOURS[0], key: 'h' }, server: { map: 'kestrel', game: 'flight' }, mode: 'lobby', now: () => t });
    host.bundleMs = bundleMs;
    const got = new Map();
    for (let id = 1; id <= 7; id++) {
      got.set(id, { packets: 0, snaps: 0, latest: new Map() });
      host.players.set(id, { id, name: `P${id}`, link: { sendState: (buf) => { const g = got.get(id); g.packets++; for (const s of P.decodeStates(buf)) { g.snaps++; g.latest.set(s.id, s.t); } return true; }, send() { return true; }, lastHeard: 0, state: 'open' } });
    }
    const phase = [0, 9, 17, 23, 31, 44, 52, 61];
    for (t = 0; t < 2000; t += 1) {
      for (let id = 1; id <= 7; id++) if ((t - phase[id]) % 67 === 0 && t >= phase[id]) host._state(host.players.get(id), P.encodeState({ id, t, pos: { x: id }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark' }));
      // The host's own frames at 30 fps, its own snapshot on every other one.
      if (t % 33 === 0) host.tick(t, t % 66 === 0 ? P.encodeState({ id: 0, t, pos: { x: 0 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark' }) : null);
    }
    const all = [...got.values()];
    return { perSec: all.reduce((a, g) => a + g.packets, 0) / 2, perPlayer: all.map((g) => g.packets / 2), fresh: all.every((g) => g.latest.size === 7 && [...g.latest.values()].every((x) => x > 1850)) };
  };
  const before = run(0);
  const after = run(S.BUNDLE_MS);
  ok('eight in a lobby: the host sends a fraction of the packets it did, and every player still hears all seven others',
    after.perSec < before.perSec / 4 && after.fresh && before.fresh && Math.max(...after.perPlayer) <= 21,
    `${before.perSec} packets/s from the host relaying each → ${after.perSec}/s bundled (${Math.min(...after.perPlayer)}-${Math.max(...after.perPlayer)} per player)`);
}

/* ---- the signaling server --------------------------------------------- */
/*
 * `--real` runs everything below against the public PeerJS server instead of
 * the fake: real sockets, real ID-TAKEN, real EXPIRE, real payload checks.
 * WebRTC is still the fake (node has none), and the network hash and every id
 * are random, so nobody else's game is touched.
 */
const LAN = (process.argv.find((a) => a.startsWith('--lan=')) || '').slice(6);
const REAL = process.argv.includes('--real') || !!LAN;
const RUN = Math.random().toString(36).slice(2, 8);
const server = REAL ? null : new FakeSignalServer();
const sent = [];
const BaseWS = REAL ? globalThis.WebSocket : server.WebSocket;
// Every message this test sends to the signaling server, to prove what never went there.
class LogWS extends BaseWS {
  send(d) {
    sent.push(String(d));
    return super.send(d);
  }
}
const backend = LAN ? { url: LAN, key: 'peerjs' } : REAL ? PUBLIC_BACKEND : { url: 'wss://fake.test/peerjs', key: 'peerjs' };
const RTC = makeFakeRTC();
const makeSig = () => new Signaling(backend, { WebSocketImpl: LogWS, heartbeatMs: REAL ? 5000 : 50 });
const untilT = (fn, ms = 3000) => until(fn, REAL ? ms * 4 : ms);
if (REAL) console.log(`\n-- against ${backend.url}, run ${RUN} --`);
{
  const idA = `ifs-test-${RUN}-a`;
  const a = makeSig();
  ok('signaling: OPEN for a free id', (await a.open(idA)) === 'open');
  const b = makeSig();
  let code = null;
  try {
    await b.open(idA);
  } catch (err) {
    code = err.code;
  }
  ok('signaling: ID-TAKEN for a held id', code === 'taken');
  const tok = a.token;
  let closed = null;
  a.onclose = (why) => (closed = why);
  const a2 = new Signaling(backend, { WebSocketImpl: LogWS, token: tok });
  await a2.open(idA);
  await untilT(() => closed);
  ok('signaling: the same token takes the id over', closed === 'takeover');
  const net = new Net(a2, { RTC });
  const t0 = Date.now();
  ok('ping to nobody comes back empty, at once', (await net.ping(`ifs-test-${RUN}-nobody`)) === 'empty', `${Date.now() - t0} ms`);
  const before = server ? server.hungUp : 0;
  a2.send('LEAVE', `ifs-test-${RUN}-nobody`);
  await untilT(() => a2.state === 'closed');
  ok('the server hangs up on a LEAVE (which is why the game never sends one)', a2.state === 'closed' && (!server || server.hungUp === before + 1));
}

/* ---- five slots, and a sixth host is told there is no room ----------- */
const hash = REAL ? P.sha256Hex(`test-${RUN}-${Date.now()}`).slice(0, 12) : P.netHashFor('192.0.2.44');
{
  const held = [];
  for (let i = 0; i < 5; i++) held.push(await S.claimSlot({ hash, makeSig }));
  ok('five hosts get slots 1 to 5', held.map((h) => h && h.n).join(',') === '1,2,3,4,5');
  const sixth = await S.claimSlot({ hash, makeSig });
  ok('a sixth host finds every slot taken', sixth === null);
  held[1].sig.close();
  await sleep(REAL ? 1500 : 10);
  const again = await S.claimSlot({ hash, makeSig });
  ok('a slot that is let go is taken by the next host', again && again.n === 2);
  for (const h of [...held, again]) h && h.sig.close();
  const c1 = await S.claimCode({ makeSig });
  // The first two tries roll the code already held; the third does not.
  const other = c1.code === 'maple-kite-42' ? 'moon-rover-7' : 'maple-kite-42';
  const c2 = await S.claimCode({ makeSig, rand: diceFor([c1.code, c1.code, other]) });
  ok('a code that is already held is skipped', c2.code === other && c1.code !== c2.code, `${c1.code} then ${c2.code}`);
  c1.sig.close();
  c2.sig.close();
}

/* ---- a real session over the fakes ---------------------------------- */
/*
 * Every player in these tests has a call sign from the lists; the short
 * names are only how the test refers to them. makeClient() passes anything
 * that is not one of these through as it is, which is how the attacks below
 * send what a modified client would.
 */
const NAME = {
  Hana: 'Brave Otter',
  Sam: 'Swift Falcon',
  Priya: 'Sunny Puffin',
  Leo: 'Jolly Penguin',
  Zed: 'Clever Koala',
  Mo: 'Mighty Moose',
  Ivy: 'Gentle Lark',
  Ola: 'Happy Hedgehog',
  Pip: 'Plucky Puffin',
  Late: 'Steady Seal',
  Uma: 'Kind Koala',
  Rae: 'Radiant Robin',
  Tao: 'Trusty Toucan',
  Uri: 'Lucky Llama',
  Kai: 'Keen Kestrel',
  Ada: 'Daring Dolphin',
  Bea: 'Breezy Bumblebee',
  Cal: 'Calm Condor',
  Dee: 'Dapper Dragon',
  Lou: 'Loyal Lynx',
  Fin: 'Fuzzy Finch',
  Max: 'Mighty Meerkat',
  Gus: 'Groovy Gecko',
  Hal: 'Honest Hawk',
  Old: 'Noble Narwhal',
  Bo: 'Bright Badger',
  Noor: 'Nimble Narwhal',
  Eli: 'Eager Eagle',
  Nia: 'Snowy Yeti',
};
const nameOf = (who) => NAME[who] || who;
/** The host's server name: from the lists, the same for the same host. */
const serverOf = (who) => P.serverNameFor(`test-${who}`);
function makeHost(name = 'Hana', n = 1, rtc = RTC) {
  return (async () => {
    const claim = await S.claimSlot({ hash, makeSig, prefer: n });
    const code = await S.claimCode({ makeSig });
    const events = [];
    const host = new S.HostSession({
      profile: { name: nameOf(name), colour: P.COLOURS[0], key: 'host-key' },
      server: { name: serverOf(name), map: 'kestrel', mapName: 'Kestrel Island', game: 'flight', code: code.code, slot: claim.n },
      spawnInfo: () => ({ x: 100, y: 400, z: 0, heading: 90, speed: 55, agl: 390, onGround: false }),
      weather: () => ({ time: 'day', condition: 'clear', windSpeedKts: 5, windDirDeg: 90 }),
      onEvent: (...e) => events.push(e),
    });
    const nets = [new Net(claim.sig, { RTC: rtc }), new Net(code.sig, { RTC: rtc })];
    for (const net of nets) host.attach(net);
    return { host, events, claim, code, nets };
  })();
}

async function makeClient(target, name, key = `${name}-key`, rtc = RTC, connectTimeoutMs = 15000) {
  const sig = makeSig();
  await sig.open(P.playerPeerId());
  const net = new Net(sig, { RTC: rtc, connectTimeoutMs });
  const events = [];
  const c = new S.ClientSession({ net, target, profile: { name: nameOf(name), colour: P.COLOURS[2], key }, onEvent: (...e) => events.push(e) });
  let welcome = null;
  let error = null;
  try {
    welcome = await c.start();
  } catch (err) {
    error = err;
  }
  return { c, events, welcome, error, sig, net };
}

{
  const H = await makeHost('Hana', 1);
  const target = P.slotId(hash, H.claim.n);

  // The LAN list sees it.
  const psig = makeSig();
  await psig.open(P.playerPeerId());
  const prober = new S.Prober({ net: new Net(psig, { RTC }), hash, pingEveryMs: REAL ? 1500 : 60, infoEveryMs: REAL ? 1000 : 40 });
  prober.start();
  await untilT(() => prober.slots[0].state === 'open' && prober.slots.slice(1).every((s) => s.state === 'empty'));
  const s0 = prober.slots[0];
  ok('the LAN list finds the server in slot 1 and four empty slots', s0.state === 'open' && prober.slots.slice(1).every((s) => s.state === 'empty'),
    prober.slots.map((s) => s.state).join(','));
  ok('and reads its name, map, game and head-count over the data channel', s0.info && s0.info.name === serverOf('Hana') && s0.info.mapName === 'Kestrel Island'
    && s0.info.game === 'flight' && s0.info.players === 1 && s0.info.max === 5 && s0.ping > 0, JSON.stringify(s0.info));
  const named = new RegExp([NAME.Hana, NAME.Priya, NAME.Sam, serverOf('Hana')].join('|'));
  ok('names never went through the signaling server', sent.length > 0 && !sent.some((m) => named.test(m)), `${sent.length} messages sent, none with a name`);

  const clients = [];
  for (const name of ['Sam', 'Sam', 'Priya', 'Leo']) clients.push(await makeClient(target, name));
  ok('four friends join', clients.every((c) => c.welcome), clients.map((c) => c.error && c.error.code).join(','));
  ok('each gets a number and the host is 0', clients.map((c) => c.welcome.you).join(',') === '1,2,3,4');
  ok('the second Swift Falcon is Swift Falcon 2', clients[0].welcome.name === NAME.Sam && clients[1].welcome.name === `${NAME.Sam} 2`, clients[1].welcome.name);
  ok('the welcome carries the map, the game and where the host is', clients[0].welcome.server.map === 'kestrel' && clients[0].welcome.server.game === 'flight'
    && clients[0].welcome.at && clients[0].welcome.at.x === 100 && clients[0].welcome.weather.time === 'day');
  await untilT(() => s0.info.players === 5 && s0.state === 'full', 2000);
  ok('the LAN list shows 5/5 and full', s0.info.players === 5 && s0.state === 'full', `${s0.info.players}/${s0.info.max} ${s0.state}`);

  const sixth = await makeClient(target, 'Zed');
  ok('a sixth player is told the server is full', sixth.error && sixth.error.code === 'full' && /full/i.test(sixth.error.message), sixth.error && sixth.error.message);
  ok('the host still has five', H.host.count === 5);

  // Rosters settle.
  H.host.tick(performance.now());
  await untilT(() => clients.every((c) => c.c.players.size === 4));
  ok('every player sees the other four', clients.every((c) => c.c.players.size === 4), clients.map((c) => c.c.players.size).join(','));

  // State: client 1 claims to be player 3; it arrives as player 1, everywhere else.
  const got = new Map();
  for (const c of clients) c.events.length = 0;
  const buf = P.encodeState({ id: 3, t: 1000, pos: { x: 1, y: 2, z: 3 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark' });
  clients[0].c.tick(performance.now(), buf);
  await untilT(() => clients.slice(1).every((c) => c.events.some((e) => e[0] === 'state')) && H.events.some((e) => e[0] === 'state'));
  for (const [i, c] of clients.entries()) got.set(i, c.events.filter((e) => e[0] === 'state').map((e) => e[1].id));
  const hostGot = H.events.filter((e) => e[0] === 'state').map((e) => e[1].id);
  ok('a snapshot reaches the host and the other three', hostGot.includes(1) && [1, 2, 3].every((i) => got.get(i).includes(1)), JSON.stringify([...got]));
  ok('stamped with the sender, whatever it claimed', !hostGot.includes(3) && [1, 2, 3].every((i) => !got.get(i).includes(3)) && got.get(0).length === 0);

  // The host's own snapshot reaches everybody as player 0.
  H.host.tick(performance.now(), P.encodeState({ id: 4, t: 2000, pos: { x: 9, y: 9, z: 9 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'courier' }));
  // The host's frames go on: a snapshot held for a player (bundling, session.js) goes out on the next one that is due.
  await untilT(() => {
    H.host.tick(performance.now());
    return clients.every((c) => c.events.some((e) => e[0] === 'state' && e[1].id === 0));
  });
  ok("the host's snapshot reaches all four as player 0", clients.every((c) => c.events.some((e) => e[0] === 'state' && e[1].id === 0 && e[1].type === 'courier')));

  // Quick chat.
  for (const c of clients) c.events.length = 0;
  H.events.length = 0;
  clients[2].c.chat(1);
  await untilT(() => [0, 1, 3].every((i) => clients[i].events.some((e) => e[0] === 'chat')) && H.events.some((e) => e[0] === 'chat'));
  const heard = [0, 1, 3].map((i) => clients[i].events.find((e) => e[0] === 'chat'));
  ok('quick chat reaches everybody else, from the right player', heard.every((e) => e && e[1].id === 3 && e[2] === 1) && H.events.find((e) => e[0] === 'chat')[1].name === NAME.Priya);
  ok('and not the sender', !clients[2].events.some((e) => e[0] === 'chat'));
  ok('a second message inside 1.2 s is dropped', clients[2].c.chat(2) === false);
  clients[3].c.link.send({ t: 'chat', m: 99 });
  clients[3].c.link.send({ t: 'chat', m: 'Nice landing! <script>' });
  await sleep(30);
  ok('a chat index that does not exist goes nowhere', !clients[0].events.some((e) => e[0] === 'chat' && e[1].id === 4));

  // Kick Priya; she cannot come back — by her key, never by her name.
  for (const c of clients) c.events.length = 0;
  H.host.kick(3);
  await untilT(() => clients[2].events.some((e) => e[0] === 'ended'));
  ok('a kicked player is told', clients[2].events.some((e) => e[0] === 'ended' && e[1] === 'kicked'));
  await untilT(() => clients[0].events.some((e) => e[0] === 'leave'));
  ok('and everybody else sees them leave', [0, 1, 3].every((i) => clients[i].events.some((e) => e[0] === 'leave' && e[1].id === 3 && e[2] === 'kicked')));
  const back = await makeClient(target, 'Priya', 'Priya-key');
  ok('a kicked player cannot rejoin with the same key', back.error && back.error.code === 'kicked', back.error && back.error.code);
  ok('and is told gently', back.error && /for now/.test(back.error.message) && !/removed|banned|kicked/i.test(back.error.message), back.error && back.error.message);
  const renamed = await makeClient(target, 'Zed', 'Priya-key');
  ok('nor by picking a different call sign: it is the key that is kept out', renamed.error && renamed.error.code === 'kicked', renamed.error ? renamed.error.code : 'let in');
  // Review: banning the name as well locked out the next child who happened to pick the same call sign.
  const sameName = await makeClient(target, 'Priya', `another-child-${RUN}`);
  ok('another child with the same call sign and their own key is let in, under that call sign', sameName.welcome && sameName.welcome.you === 3 && sameName.welcome.name === NAME.Priya,
    sameName.error ? sameName.error.code : sameName.welcome.name);
  ok('the host keeps out keys, and has no list of names at all', H.host.banned.has('Priya-key') && H.host.banned.size === 1 && !('bannedNames' in H.host));
  H.host.kick(3);
  await sleep(20);
  const other = await makeClient(target, 'Mo');
  ok('but the seat is free for somebody else, and they get number 3', other.welcome && other.welcome.you === 3);

  // Join by code works the same way.
  H.host.kick(3);
  await sleep(20);
  const byCode = await makeClient(P.codeId(H.code.code), 'Ivy');
  ok('joining by code reaches the same server', byCode.welcome && byCode.welcome.server.name === serverOf('Hana') && byCode.welcome.you === 3);

  // Leo leaves politely.
  clients[3].c.leave();
  await untilT(() => H.events.some((e) => e[0] === 'leave' && e[1].name === NAME.Leo));
  ok('a player who leaves is announced as having left', H.events.some((e) => e[0] === 'leave' && e[1].name === NAME.Leo && e[2] === 'left'));

  // Sam drops without a word: his connection just closes.
  clients[0].c.link.pc.close();
  await untilT(() => H.events.some((e) => e[0] === 'leave' && e[1].name === NAME.Sam), 3000);
  ok('a dropped connection is noticed and announced', H.events.some((e) => e[0] === 'leave' && e[1].name === NAME.Sam && e[2] === 'dropped'));

  // The host quits.
  const stillIn = [clients[1], byCode];
  H.host.close();
  await untilT(() => stillIn.every((c) => c.events.some((e) => e[0] === 'ended')));
  ok('when the host quits, everybody is told the server closed', stillIn.every((c) => c.events.some((e) => e[0] === 'ended' && e[1] === 'closed')));
  prober.stop();
  psig.close();
  for (const s of [H.claim.sig, H.code.sig]) s.close();
}

/* ---- the 88 look-alike names, end to end ------------------------------ */
/*
 * The third review sent these as a modified client would, over the real
 * server, and every one reached the other players. Here each joins in turn
 * with one of them as its name, while another player watches: the host must
 * replace every one with the call sign made from the player's number before
 * anybody sees it — in the welcome, the join, the roster and the host's own
 * events. Run with --lan=... to send them over tools/lan-server.py.
 */
{
  const H = await makeHost('Nia', 2);
  const target = P.slotId(hash, H.claim.n);
  const watcher = await makeClient(target, 'Sam', 'watcher-key');
  const expect = P.callSignForId(2);
  const shown = [];
  const refused = [];
  let joined = 0;
  const t0 = Date.now();
  for (const [i, attack] of LOOKALIKE_ATTACKS.entries()) {
    const c = await makeClient(target, attack, `attack-${i}`);
    if (!c.welcome) {
      refused.push(`#${i} ${c.error && c.error.code}`);
      c.sig.close();
      continue;
    }
    if (c.welcome.name === expect) joined++;
    shown.push(c.welcome.name, ...c.welcome.players.map((p) => p.name));
    H.host.tick(performance.now());
    await untilT(() => watcher.c.players.has(c.welcome.you));
    shown.push(...[...watcher.c.players.values()].map((p) => p.name));
    c.c.leave();
    await untilT(() => H.host.players.size === 1 && !watcher.c.players.has(c.welcome.you));
    c.sig.close();
  }
  for (const e of [...H.events, ...watcher.events]) if (e[1] && typeof e[1].name === 'string') shown.push(e[1].name);
  const leaked = shown.filter((n) => !P.parseCallSign(n));
  const everything = JSON.stringify([H.events, watcher.events, H.host.roster()]);
  const verbatim = LOOKALIKE_ATTACKS.filter((w) => everything.includes(JSON.stringify(w).slice(1, -1)));
  ok('the 88 look-alike names, sent by a modified client: every one joins as the call sign made from its number', joined === 88 && refused.length === 0,
    `${joined}/88 as "${expect}" in ${Date.now() - t0} ms${refused.length ? `; not let in: ${refused.slice(0, 3).join(', ')}` : ''}`);
  ok('and nobody — host or watcher, welcome, join, roster or leave — was shown anything but a call sign', leaked.length === 0 && verbatim.length === 0 && shown.length > 88 * 3,
    leaked.length || verbatim.length ? `${leaked.length} shown, ${verbatim.length} verbatim: ${JSON.stringify(leaked[0] || verbatim[0])}` : `${shown.length} names shown, all call signs`);
  watcher.c.leave();
  H.host.close();
  await sleep(REAL ? 500 : 30);
  for (const s of [H.claim.sig, H.code.sig, watcher.sig]) s.close();
}

/* ---- a whole class looking at one server ---------------------------- */
/*
 * Measured in review with these fakes: one host, twenty server lists open.
 * The host had room for twelve details connections and did not answer the
 * rest, so eight lists waited out the 15 s connection timeout and showed the
 * host as "Found, but can't connect" with Join greyed out — at 16, 31, 33, 46
 * and 62 s, the same eight each time. Here the timers are shortened (pings
 * every 60 ms, a busy host asked again after 40-120 ms) and the rule is the
 * same: every list must be able to Join, and every list must get the name.
 */
// Twenty sockets at once: against the fake or tools/lan-server.py, not a free public server.
if (!REAL || LAN) {
  const H = await makeHost('Ola', 3);
  const lists = [];
  let worstInfo = 0;
  let everUnreachable = 0;
  const offerJoin = (s) => S.Prober.joinable(s) || s.state === 'looking';
  for (let i = 0; i < 20; i++) {
    const sig = makeSig();
    await sig.open(P.playerPeerId());
    const pr = new S.Prober({
      net: new Net(sig, { RTC }), hash, pingEveryMs: 60, infoEveryMs: 400, busyRetryMs: [40, 120], failRetryMs: [300, 600],
      onChange: (slots) => {
        if (slots[H.claim.n - 1].state === 'unreachable') everUnreachable++;
        worstInfo = Math.max(worstInfo, H.host.info.size);
      },
    });
    lists.push({ pr, sig });
  }
  const t0 = Date.now();
  for (const l of lists) l.pr.start();
  const slotOf = (l) => l.pr.slots[H.claim.n - 1];
  const named = await until(() => lists.every((l) => slotOf(l).info && slotOf(l).info.name === serverOf('Ola')), 8000);
  const took = Date.now() - t0;
  ok('twenty server lists open on one host: every one gets its name', !!named,
    `${lists.filter((l) => slotOf(l).info).length}/20 named in ${took} ms; states ${[...new Set(lists.map((l) => slotOf(l).state))].join(',')}`);
  ok('and no list ever showed it as unreachable', everUnreachable === 0, `${everUnreachable} times`);
  ok('the host never read its details to more than twelve lists at once', worstInfo <= S.INFO_AT_ONCE && worstInfo > 0, `${worstInfo} at once`);
  // Keep them all open for a while, re-reading the name every 400 ms: nobody is ever left without a Join button.
  let stuck = 0;
  for (let k = 0; k < 20; k++) {
    await sleep(100);
    stuck += lists.filter((l) => !offerJoin(slotOf(l))).length;
  }
  ok('and for two seconds of all twenty re-reading it, every list could Join', stuck === 0, `${stuck} list-samples without Join`);
  // A friend joins: every list's head-count follows from the pings alone.
  const f = await makeClient(P.slotId(hash, H.claim.n), 'Pip');
  const counted = await until(() => lists.every((l) => slotOf(l).info && slotOf(l).info.players === 2), 3000);
  ok('a join shows up as 2/5 on every list', !!counted, lists.map((l) => slotOf(l).info && slotOf(l).info.players).join(''));
  // Locked: every list says so, and a newcomer is told.
  H.host.setLocked(true);
  const lockedSeen = await until(() => lists.every((l) => slotOf(l).state === 'locked'), 3000);
  ok('a host who locks the server: every list shows it locked', !!lockedSeen, [...new Set(lists.map((l) => slotOf(l).state))].join(','));
  const late = await makeClient(P.slotId(hash, H.claim.n), 'Late');
  ok('and a newcomer is told it is locked', late.error && late.error.code === 'locked', late.error && late.error.message);
  H.host.setLocked(false);
  const back = await until(() => lists.every((l) => slotOf(l).state === 'open'), 3000);
  ok('unlocked, it is open again', !!back);
  for (const l of lists) {
    l.pr.stop();
    l.sig.close();
  }
  f.c.leave();
  f.sig.close();
  H.host.close();
  await sleep(300);
  for (const s of [H.claim.sig, H.code.sig]) s.close();
}

/* ---- a busy host says so; it does not go quiet ---------------------- */
{
  const H = await makeHost('Uma', 4);
  // Fill every details place, then knock.
  const psig = makeSig();
  await psig.open(P.playerPeerId());
  const net = new Net(psig, { RTC });
  const holders = [];
  for (let i = 0; i < S.INFO_AT_ONCE; i++) holders.push(net.connect(P.slotId(hash, H.claim.n), 'info'));
  await untilT(() => H.host.info.size === S.INFO_AT_ONCE);
  const t0 = Date.now();
  const extra = net.connect(P.slotId(hash, H.claim.n), 'info');
  const why = await new Promise((res) => {
    extra.onclose = (reason) => res(reason);
  });
  ok('a host with no room for another details connection answers "busy" at once', why === 'busy' && Date.now() - t0 < (REAL ? 5000 : 500), `${why} in ${Date.now() - t0} ms`);
  const r = await net.pingInfo(P.slotId(hash, H.claim.n));
  const c = P.readCount(r.meta);
  ok("its pings carry the head-count and nothing else", r.r === 'here' && c && c.players === 1 && c.max === 5 && !c.full
    && Object.keys(r.meta).every((k) => ['k', 'v', 'n', 'max', 'lk'].includes(k)), JSON.stringify(r.meta));
  for (const l of [...holders, extra]) l.close();
  net.destroy();
  psig.close();
  H.host.close();
  await sleep(300);
  for (const s of [H.claim.sig, H.code.sig]) s.close();
}

/* ---- what the signaling server is told about addresses -------------- */
/*
 * Recorded in review on the real public server: 8 of 20 CANDIDATE messages
 * carried the Mac's public IPv4 and IPv6 addresses. The fake RTC gathers the
 * same kinds of candidate a browser does (see multiplayer.fakes.js); here is
 * what of them goes out, by the path a player took.
 */
{
  const H = await makeHost('Rae', 5);
  const cands = (from) => sent.slice(from).filter((m) => m.includes('"CANDIDATE"'));
  const pub = /203\.0\.113\.77/;
  const v6 = /2001:db8:77/;

  let at = sent.length;
  const lsig = makeSig();
  await lsig.open(P.playerPeerId());
  const lnet = new Net(lsig, { RTC });
  const info = lnet.connect(P.slotId(hash, H.claim.n), 'info');
  await untilT(() => info.isOpen);
  const listMsgs = cands(at);
  ok('the server list sends no public address to the signaling server', info.isOpen && listMsgs.length > 0 && !listMsgs.some((m) => pub.test(m) || v6.test(m)),
    `${listMsgs.length} candidates, ${listMsgs.filter((m) => pub.test(m) || v6.test(m)).length} public`);
  info.close();

  at = sent.length;
  const viaSlot = await makeClient(P.slotId(hash, H.claim.n), 'Tao');
  const slotMsgs = cands(at);
  const hostSide = [...H.host.players.values()].find((p) => p.name === NAME.Tao);
  ok('joining from the list: no public address either, from the player or the host', viaSlot.welcome && slotMsgs.length >= 2 && !slotMsgs.some((m) => pub.test(m) || v6.test(m)),
    `${slotMsgs.length} candidates, ${slotMsgs.filter((m) => pub.test(m) || v6.test(m)).length} public`);
  ok('and neither side even asks a STUN server what its address is', viaSlot.c.link.pc.cfg.iceServers.length === 0 && hostSide && hostSide.link.pc.cfg.iceServers.length === 0);

  at = sent.length;
  const viaCode = await makeClient(P.codeId(H.code.code), 'Uri');
  const codeMsgs = cands(at);
  ok('joining by code: the public IPv4 goes to the other side, as a path between two networks needs it',
    viaCode.welcome && codeMsgs.some((m) => pub.test(m)) && viaCode.c.link.pc.cfg.iceServers.length === 1, `${codeMsgs.filter((m) => pub.test(m)).length} of ${codeMsgs.length}`);
  ok('but never the per-device IPv6 address or a public host address', !codeMsgs.some((m) => v6.test(m)));

  for (const c of [viaSlot, viaCode]) {
    c.c.leave();
    c.sig.close();
  }
  lnet.destroy();
  lsig.close();
  H.host.close();
  await sleep(300);
  for (const s of [H.claim.sig, H.code.sig]) s.close();
}

/* ---- the silent failures -------------------------------------------- */
{
  const H = await makeHost('Kai', 2);
  const target = P.slotId(hash, H.claim.n);
  // The host ticks once a second, as idle() does, over `secs` seconds of silence from everybody.
  const quiet = (from, secs) => {
    for (let k = 1; k <= secs; k++) H.host.tick(from + k * 1000);
  };
  const snapFrom = async (cl, p) => {
    cl.c.tick(performance.now(), P.encodeState({ t: 1, pos: { x: 1, y: 2, z: 3 }, quat: { w: 1 }, vel: {}, game: 'flight', type: 'skylark' }));
    await untilT(() => p.lastSnap);
  };

  const c = await makeClient(target, 'Ada');
  const p = H.host.players.get(1);
  // Joined, but no snapshot yet: still loading the island, on a machine that may be slow at it.
  quiet(p.link.lastHeard, 13);
  ok('a player still loading the island (no snapshot yet) is not dropped at 12 s', H.host.players.has(1));
  quiet(p.link.lastHeard, 46);
  ok('but is at 45 s', !H.host.players.has(1) && H.events.some((e) => e[0] === 'leave' && e[1].name === NAME.Ada && /45 s/.test(e[3])));
  await untilT(() => c.events.some((e) => e[0] === 'ended'));

  // In the world, then silent: dropped at 12 s.
  const c2 = await makeClient(target, 'Bea');
  const p2 = H.host.players.get(1);
  await snapFrom(c2, p2);
  quiet(p2.link.lastHeard, 13);
  ok('a player who goes silent for 12 s is dropped', !H.host.players.has(1) && H.events.some((e) => e[0] === 'leave' && e[1].name === NAME.Bea && e[2] === 'dropped'));
  await untilT(() => c2.events.some((e) => e[0] === 'ended'));
  ok('and finds out', c2.events.some((e) => e[0] === 'ended'));

  // The host's OWN tab stalls for 13 s: nobody's messages could be read either, so nobody is blamed on the first tick back.
  const c3 = await makeClient(target, 'Cal');
  const p3 = H.host.players.get(1);
  await snapFrom(c3, p3);
  const t3 = p3.link.lastHeard;
  H.host.tick(t3 + 100);
  H.host.tick(t3 + 13100);
  ok('a host waking from its own 13 s stall drops nobody on the first tick', H.host.players.has(1));
  H.host.tick(t3 + 16000);
  ok('and still drops a player who is silent once the grace is over', !H.host.players.has(1));
  await untilT(() => c3.events.some((e) => e[0] === 'ended'));

  // The same on the player's side: a client whose own tab stalled does not call the host gone.
  const c4 = await makeClient(target, 'Dee');
  const t4 = c4.c.link.lastHeard;
  c4.c.tick(t4 + 100);
  c4.c.tick(t4 + 13100);
  ok('a player waking from their own 13 s stall does not leave on the first tick', !c4.events.some((e) => e[0] === 'ended'));
  c4.c.leave();
  await sleep(REAL ? 1000 : 30);

  /*
   * A CLOSED tab. In the two-page playtest the host's goodbye never arrived —
   * a closing page gets no time to send it — and the player was told "Lost
   * the connection" 11.3 s later. What a closed tab does leave behind is its
   * signaling sockets, gone at once.
   */
  {
    const H3 = await makeHost('Lou', 4);
    const cl = await makeClient(P.slotId(hash, H3.claim.n), 'Fin');
    // The host's tab is gone: it hears nothing, says nothing, and its two sockets have closed.
    for (const q of H3.host.players.values()) q.link.onevent = q.link.onstate = null;
    H3.host.closed = true;
    H3.claim.sig.close();
    H3.code.sig.close();
    const tq = cl.c.link.lastHeard;
    cl.c.tick(tq + 1000);
    await sleep(REAL ? 1500 : 30);
    ok('a host quiet for one second is not asked after yet', !cl.events.some((e) => e[0] === 'ended'));
    const t0 = Date.now();
    cl.c.tick(tq + 1600);
    await untilT(() => cl.events.some((e) => e[0] === 'ended'));
    ok('a host whose tab was closed is known to have CLOSED the server within a probe, not after 12 s',
      cl.events.some((e) => e[0] === 'ended' && e[1] === 'closed'), `${Date.now() - t0} ms`);
    cl.sig.close();
  }
  {
    // A host that is quiet but still there (a stalled tab): asked, found, and left to the timeout.
    const H4 = await makeHost('Max', 4);
    const cl = await makeClient(P.slotId(hash, H4.claim.n), 'Gus');
    for (const q of H4.host.players.values()) q.link.onevent = q.link.onstate = null;
    const tq = cl.c.link.lastHeard;
    cl.c.tick(tq + 1600);
    await sleep(REAL ? 3000 : 60);
    ok('a host that is quiet but still holds its slot is not called closed', !cl.events.some((e) => e[0] === 'ended'));

    // The PLAYER's tab closed: the host says they left, in seconds.
    const p = H4.host.players.get(1);
    await snapFrom(cl, p);
    cl.c.link.onevent = cl.c.link.onstate = null;
    cl.c.ended = true;
    cl.sig.close();
    const t0 = Date.now();
    // Ticked every frame, as the game does: against the real server the first question can
    // overtake the closing socket and be forwarded to it, unanswered; the next one is not.
    const base = p.link.lastHeard + 4100;
    await untilT(() => {
      H4.host.tick(base + (Date.now() - t0));
      return !H4.host.players.has(1);
    });
    ok('a player whose tab was closed is announced as having LEFT, in seconds',
      H4.events.some((e) => e[0] === 'leave' && e[1].name === NAME.Gus && e[2] === 'left' && /closed/.test(e[3])), `${Date.now() - t0} ms`);

    // And a player who is quiet but still holds their socket — loading the island — is not.
    const cl2 = await makeClient(P.slotId(hash, H4.claim.n), 'Hal');
    const p2 = H4.host.players.get(1);
    cl2.c.link.onevent = null;
    H4.host.tick(p2.link.lastHeard + 4100);
    await sleep(REAL ? 3000 : 60);
    ok('a quiet player still on the signaling server is not dropped by the probe', H4.host.players.has(1));
    cl2.c.leave();
    H4.host.close();
    await sleep(REAL ? 500 : 30);
    for (const s of [H4.claim.sig, H4.code.sig, cl2.sig]) s.close();
  }

  // Wrong version.
  const sig = makeSig();
  await sig.open(P.playerPeerId());
  const net = new Net(sig, { RTC });
  const link = net.connect(target, 'join');
  const denied = await new Promise((resolve) => {
    link.onopen = () => link.send({ t: 'hello', v: 999, name: 'Old', colour: P.COLOURS[1] });
    link.onevent = (ev) => ev.t === 'deny' && resolve(ev.why);
    setTimeout(() => resolve(null), 2000);
  });
  ok('a different version is refused by name', denied === 'version');

  // Nobody there.
  const gone = await makeClient(P.codeId('acorn-airship-1'), 'Bo');
  ok('a code nobody holds says so, quickly', gone.error && gone.error.code === 'gone', gone.error && gone.error.message);

  // ICE that never connects: a school Wi-Fi that keeps devices apart.
  const blocked = makeFakeRTC({ fail: () => true });
  const H2 = await makeHost('Noor', 3, blocked);
  const t0 = Date.now();
  const stuck = await makeClient(P.slotId(hash, H2.claim.n), 'Eli', 'eli', blocked, 800);
  ok('failed ICE gives the kind message, not a hang — and points at the code', stuck.error && /over this Wi-Fi.*code/.test(stuck.error.message) && Date.now() - t0 < 3000, stuck.error && stuck.error.message);
  const stuck2 = await makeClient(P.codeId(H2.code.code), 'Eli', 'eli', blocked, 800);
  ok('by code, it says so in words a child can act on: the friend’s internet, and the code', stuck2.error && /Couldn’t reach your friend’s game — ask them to check their internet/.test(stuck2.error.message), stuck2.error && stuck2.error.message);
  H.host.close();
  H2.host.close();
  await sleep(300);
  for (const s of [H.claim.sig, H.code.sig, H2.claim.sig, H2.code.sig]) s.close();
}

/* ---- range: joins by code across networks (list 2) ---------------------- */
{
  const L = await import('../../src/features/multiplayer/link.js');
  const C = (t, extra = '') => `candidate:1 1 udp 1 ${t} ${extra}`.trim();
  ok('range: a relay candidate may go for a join by code, never on the Wi-Fi',
    L.candidateAllowed(C('198.51.100.9 3478 typ relay raddr 203.0.113.77 rport 5000'), 'v4')
    && !L.candidateAllowed(C('198.51.100.9 3478 typ relay raddr 203.0.113.77 rport 5000'), 'lan')
    && L.candidateAllowed(C('198.51.100.9 3478 typ relay raddr 0.0.0.0 rport 0'), 'v4'));
  ok('range: but not one that names this device’s IPv6 address as where it came from, nor an IPv6 srflx',
    !L.candidateAllowed(C('198.51.100.9 3478 typ relay raddr 2001:db8:77::1 rport 5000'), 'v4')
    && !L.candidateAllowed(C('2001:db8:77::1 9 typ srflx raddr :: rport 0'), 'v4'));
  ok('range: two STUN servers in one entry, and no relay until somebody configures one', L.ICE_SERVERS.length === 1 && L.ICE_SERVERS[0].urls.length === 2 && L.RELAY_SERVERS.length === 0 && L.CODE_CONNECT_MS === 25000);
  // A configured relay: offered with the STUN servers for a join by code, alone (relay only) on the second try, and never on the Wi-Fi.
  const relay = [{ urls: 'turn:relay.test:3478', username: 'u', credential: 'c' }];
  const sig = makeSig();
  await sig.open(P.playerPeerId());
  const net = new Net(sig, { RTC, relayServers: relay });
  const first = net.connect(P.codeId('maple-kite-42'), 'join');
  const second = net.connect(P.codeId('maple-kite-42'), 'join', { relayOnly: true });
  const lan = net.connect(P.slotId(hash, 1), 'info');
  await sleep(20);
  ok('range: a configured relay is offered for a join by code, forced on the second try, and never used on the Wi-Fi',
    first.pc.cfg.iceServers.length === 2 && !first.pc.cfg.iceTransportPolicy && second.pc.cfg.iceTransportPolicy === 'relay' && lan.pc.cfg.iceServers.length === 0,
    JSON.stringify([first.pc.cfg, second.pc.cfg.iceTransportPolicy, lan.pc.cfg.iceServers.length]));
  ok('range: a join by code has 25 s to connect, a join on the Wi-Fi 15 s', new Net(sig, { RTC }).codeConnectMs === 25000 && new Net(sig, { RTC }).connectTimeoutMs === 15000);
  for (const l of [first, second, lan]) l.close();
  net.destroy();
  sig.close();
  // Nobody holding the code: the words say to check it.
  const gone = await makeClient(P.codeId('maple-kite-43'), 'Sam', 'samgonekeysamgonekey');
  ok('range: a code nobody is using says to check it with the friend', gone.error && gone.error.code === 'gone' && /No game has that code right now/.test(gone.error.message), gone.error && gone.error.message);
  gone.sig.close();
  // What a private match's pong carries now: head-count, most, map and game, as numbers — for the card a friend sees.
  const pc = P.readPrivateCount({ k: 'pong', n: 3, max: 8, lk: 0, m: 0, g: 0 });
  ok('range: a private match answers a ping with numbers a card can show — 3/8 on the first island, not locked',
    pc && pc.players === 3 && pc.max === 8 && pc.map === P.mapAtIndex(0) && !pc.locked && P.readPrivateCount({ k: 'pong', n: 1, max: 8 }).map === null);
}

/* ---- a private match, and the game-events channel (events.js) ---------- */
{
  const E = await import('../../src/features/multiplayer/events.js');
  const defs = (ev) => ev
    .define('race:gate', { validate: (d) => (d && Number.isInteger(d.gate) && d.gate >= 0 && d.gate < 40 ? { gate: d.gate } : null), rate: 5 })
    .define('race:start', { from: 'host' })
    .define('free')
    .define('race', { from: 'host', validate: (d) => (d && Number.isInteger(d.lap) && d.lap >= 0 && d.lap < 10 ? { lap: d.lap } : null) });
  const code = await S.claimCode({ makeSig });
  const hostEv = defs(new E.GameEvents());
  const host = new S.HostSession({
    mode: 'code',
    profile: { name: 'Brave Otter', colour: P.COLOURS[0], key: 'hostkeyhostkeyhostke' },
    server: { name: 'Cloud Base', map: 'kestrel', mapName: 'Kestrel Island', game: 'flight', code: code.code, slot: 0 },
    onEvent: (t, a, b) => {
      if (t === 'gev') hostEv.fromWire(a, b);
      if (t === 'join') hostEv.joined(a);
    },
  });
  host.attach(new Net(code.sig, { RTC }));
  hostEv.attach(host, 'host', 0);
  const locals = [];
  hostEv.on('mp:join', (p) => locals.push(p.name));
  const got = (ev, kind) => {
    const list = [];
    ev.on(kind, (d, from, meta) => list.push({ d, from: from && from.id, host: from && from.host, toHost: !!(meta && meta.toHost) }));
    return list;
  };
  const hGate = got(hostEv, 'race:gate');
  const join = async (name, key) => {
    const sig = makeSig();
    await sig.open(P.playerPeerId());
    const ev = defs(new E.GameEvents());
    const c = new S.ClientSession({
      net: new Net(sig, { RTC }), target: P.codeId(code.code), profile: { name, colour: P.COLOURS[2], key },
      onEvent: (t, a, b) => {
        if (t === 'gev') ev.fromWire(a, b);
        if (t === 'gst') ev.stateFromWire(a);
      },
    });
    let welcome = null;
    let error = null;
    try {
      welcome = await c.start();
      ev.attach(c, 'client', welcome.you);
    } catch (err) {
      error = err;
    }
    return { c, ev, welcome, error, sig };
  };
  const A = await join('Swift Falcon', 'akeyakeyakeyakeyakey');
  const B = await join('Sunny Puffin', 'bkeybkeybkeybkeybkey');
  ok('a private match: friends with the code get in, told it is private and that eight is the most',
    A.welcome && B.welcome && A.welcome.server.priv === true && A.welcome.server.max === 8 && A.welcome.server.code === code.code && !A.welcome.server.slot
    // ...and the island it was made on, which is where they are taken.
    && A.welcome.server.map === 'kestrel' && B.welcome.server.mapName === 'Kestrel Island',
    A.welcome ? JSON.stringify({ priv: A.welcome.server.priv, max: A.welcome.server.max, slot: A.welcome.server.slot }) : A.error && A.error.message);
  const dupe = await join('Swift Falcon', 'ckeyckeyckeyckeyckey');
  ok('and one username to one player there too, with a free one offered', dupe.error && dupe.error.code === 'name' && /^Swift Falcon \d+$/.test(dupe.error.suggest || ''), dupe.error && `${dupe.error.code} ${dupe.error.suggest}`);
  dupe.sig.close();
  await untilT(() => A.c.players.size === 2 && B.c.players.size === 2);

  const aGate = got(A.ev, 'race:gate');
  const bGate = got(B.ev, 'race:gate');
  const bStart = got(B.ev, 'race:start');
  const aStart = got(A.ev, 'race:start');
  ok('events: a player sends a defined kind; it passes its own validate() on the way out', A.ev.send('race:gate', { gate: 3 }) && !A.ev.send('race:gate', { gate: 'three' }) && !A.ev.send('nobody-defined-this', {}));
  await untilT(() => bGate.length && hGate.length);
  ok('events: the host hears it and relays it, stamped with who sent it; the sender does not hear itself',
    bGate.length === 1 && bGate[0].d.gate === 3 && bGate[0].from === A.welcome.you && hGate[0].from === A.welcome.you && aGate.length === 0, JSON.stringify({ b: bGate, h: hGate }));
  // A modified player: speaks for somebody else, sends a host-only kind, a kind nobody defined, and junk data.
  A.c.link.send({ t: 'gev', k: 'race:gate', d: { gate: 7 }, f: B.welcome.you });
  A.c.link.send({ t: 'gev', k: 'race:start', d: null });
  A.c.link.send({ t: 'gev', k: 'not-a-kind', d: null });
  A.c.link.send({ t: 'gev', k: 'race:gate', d: { gate: 1e9 } });
  await sleep(150);
  ok('events: a modified player cannot speak for another, send a host-only kind, an undefined kind or junk',
    bGate.length === 2 && bGate[1].from === A.welcome.you && bStart.length === 0 && hostEv.dropped.some((x) => /not the host/.test(x)) && hostEv.dropped.some((x) => /not-a-kind/.test(x)) && hostEv.dropped.some((x) => /validate/.test(x)),
    hostEv.dropped.join(' | '));
  ok('events: a host-only kind cannot even be sent by a player', !A.ev.send('race:start'));
  A.ev.toHost('race:gate', { gate: 9 });
  await untilT(() => hGate.some((g) => g.toHost));
  await sleep(100);
  ok('events: toHost() is heard by the host alone, marked as a claim', hGate.some((g) => g.toHost && g.d.gate === 9) && !bGate.some((g) => g.d.gate === 9));
  ok('events: the host sends a host-only kind to everybody', hostEv.send('race:start'));
  await untilT(() => bStart.length && aStart.length);
  ok('events: and both players get it, from the host', bStart[0] && bStart[0].host === true && aStart[0] && aStart[0].from === 0);
  // No free text without a validate(): ids and numbers only.
  ok('events: without a validate(), no words — ids, numbers, booleans only', !A.ev.send('free', { say: 'hello there' }) && !A.ev.send('free', { say: 'x'.repeat(30) }) && A.ev.send('free', { n: 3, id: 'gate-7', on: true, list: [1, 2] }));
  // Rate: five a second, bursts of ten.
  const before = bGate.length;
  for (let i = 0; i < 40; i++) A.c.link.send({ t: 'gev', k: 'race:gate', d: { gate: i % 40 } });
  await sleep(250);
  const through = bGate.length - before;
  ok('events: a player sending forty at once gets its burst through and no more', through >= 5 && through <= 11, `${through} of 40 relayed`);
  // Shared state, host-authoritative.
  const aRace = [];
  A.ev.onState('race', (v) => aRace.push(v));
  ok('state: only the host sets it', hostEv.setState('race', { lap: 2 }) && !A.ev.setState('race', { lap: 5 }) && !hostEv.setState('race', { lap: 99 }));
  await untilT(() => A.ev.getState('race') && B.ev.getState('race'));
  ok('state: everybody sees the host’s value', A.ev.getState('race').lap === 2 && B.ev.getState('race').lap === 2 && aRace.length === 1);
  const C = await join('Jolly Penguin', 'dkeydkeydkeydkeydkey');
  await untilT(() => C.ev.getState('race'));
  ok('state: and somebody who joins later has it straight away', C.ev.getState('race') && C.ev.getState('race').lap === 2 && locals.includes('Jolly Penguin'));
  hostEv.setState('race', null);
  await untilT(() => A.ev.getState('race') === undefined && C.ev.getState('race') === undefined);
  ok('state: cleared for everybody', A.ev.getState('race') === undefined && aRace[aRace.length - 1] === undefined);
  // Out of a game: nothing is sent, nothing throws.
  const solo = defs(new E.GameEvents());
  ok('events: outside a game, send() is false and nothing throws', solo.send('race:gate', { gate: 1 }) === false && solo.toHost('race:gate', { gate: 1 }) === false && solo.players().length === 0 && !solo.active);
  // A ninth player: full.
  const more = [];
  for (let i = 0; i < 5; i++) more.push(await join(['Clever Koala', 'Mighty Moose', 'Gentle Lark', 'Happy Hedgehog', 'Plucky Puffin'][i], `m${i}keym${i}keym${i}keym${i}ke`));
  ok('a private match holds eight; the ninth is told it is full', more.slice(0, 4).every((m) => m.welcome) && more[4].error && more[4].error.code === 'full', more.map((m) => (m.welcome ? 'in' : m.error.code)).join(','));
  host.close();
  await sleep(300);
  for (const x of [A, B, C, ...more]) x.sig.close();
  code.sig.close();
}

/* ---- lobbies and usernames (multiplayer.lobbies.mjs) ------------------ */
{
  const L = await import('../../src/features/multiplayer/lobby.js');
  const { lobbyTests } = await import('./multiplayer.lobbies.mjs');
  const ctx = { P, S, L, Signaling, Net, backend, WS: LogWS, RTC, ok, sleep, until, REAL, ROOTS, WHOLE, server };
  const before = sent.length;
  await lobbyTests(ctx);
  // The lobby list and the lobbies themselves: nothing the signaling server was sent carried a username.
  const lobbyNamed = /Swift Falcon|Brave Otter|Dapper Dragon|Radiant Robin|Kind Koala|Groovy Gecko/;
  ok('no username went through the signaling server in any of the lobby tests', sent.length > before && !sent.slice(before).some((m) => lobbyNamed.test(m)),
    `${sent.length - before} messages`);
  console.log(`lobby numbers: ${JSON.stringify(ctx.lobbyNumbers)}`);
}

/* ---- list 3: lobby islands and the world lobbies (multiplayer.worlds.mjs) ---- */
{
  const L = await import('../../src/features/multiplayer/lobby.js');
  const { worldTests } = await import('./multiplayer.worlds.mjs');
  const ctx = { P, S, L, Signaling, Net, backend, WS: LogWS, RTC, makeFakeRTC, ok, sleep, until, REAL, server };
  const before = sent.length;
  await worldTests(ctx);
  const worldNamed = /Swift Falcon|Brave Otter|Sunny Puffin|Kind Koala|Lucky Llama|Zany Zebra|Lucky Lark|Plucky Puffin/;
  ok('no username went through the signaling server in any of the world lobby tests', sent.length > before && !sent.slice(before).some((m) => worldNamed.test(m)),
    `${sent.length - before} messages`);
}

/* ---- part 3b: the crown and admins (multiplayer.admin.mjs) ------------ */
{
  const L = await import('../../src/features/multiplayer/lobby.js');
  const { adminTests } = await import('./multiplayer.admin.mjs');
  const before = sent.length;
  await adminTests({ P, S, L, Signaling, Net, backend, WS: LogWS, RTC, ok, sleep, until, REAL, server });
  // An admin's proof and requests go player to host, never through the signaling server.
  ok('no admin proof, request or username went through the signaling server', sent.length > before && !sent.slice(before).some((m) => /"prove"|"chal"|"adm"|Swift Falcon|Sunny Puffin/.test(m)),
    `${sent.length - before} messages`);
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log('FAILED:', failed.map((f) => f.name).join('; '));
  process.exit(1);
}
process.exit(0);

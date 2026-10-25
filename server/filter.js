/**
 * The lobby server's word filter.
 *
 * The game has no free-text chat: players send a quick-chat INDEX (a number
 * into protocol.js QUICK_CHAT), and usernames and server names are built from
 * word lists that were read pair by pair. So the relay's first filter is the
 * strict one — a chat message is relayed only if it is one of the preset
 * indices — and this list is the second line, for anything that ever carries
 * text (a future "say" event, a name a modified client sends): the same word
 * roots the game's own tests read every username pair and join code against
 * (tests/features/multiplayer.mjs, ROOTS and WHOLE), kept ROT13'd so this
 * file does not read like a playground wall.
 *
 * Plain module, no imports: node, the Worker and the tests all load it.
 */

const r13 = (s) => s.replace(/[a-z]/gi, (c) => { const b = c <= 'Z' ? 65 : 97; return String.fromCharCode(((c.charCodeAt(0) - b + 13) % 26) + b); });

/** Whole words that are refused on their own (not as part of a longer word). */
export const WHOLE = Object.freeze(['xlf', 'nff', 'gvg', 'phz', 'frk', 'uryy', 'qnza', 'penc', 'tnl', 'ubzb', 'cbb', 'crr', 'ohz', 'nefr', 'obbo', 'ahqr', 'sng', 'htyl', 'qhzo', 'fghcvq', 'vqvbg',
  'ybfre', 'sbby', 'zbeba', 'jrveq', 'cvt', 'pbj', 'ong', 'eng', 'ncr', 'zbaxrl', 'qbaxrl', 'tbbfr', 'ghexrl', 'puvpxra', 'jbez', 'fyht', 'fanxr', 'jrnfry', 'qlxr'].map(r13));

/** Roots refused wherever they appear, run together or not. */
export const ROOTS = Object.freeze(['shpx', 'shx', 'spx', 'fuvg', 'phag', 'ovgpu', 'avtt', 'avtn', 'snt', 'juber', 'fyhg', 'cravf', 'intvan', 'qvpx', 'pbpx', 'chffl', 'cvff', 'cbea',
  'wvmm', 'encr', 'anmv', 'uvgyre', 'gjng', 'jnax', 'ergneq', 'qvyqb', 'obbo', 'cbbc', 'sneg', 'gheq', 'frkl', 'ubea', 'zvys', 'fcnm', 'xvxr', 'pbba', 'fcvp',
  'puvax', 'jbt', 'enturnq', 'unaqwbo', 'oybjwbo', 'ahgfnpx', 'onyyf', 'fcrez', 'betl',
  'erqfxva', 'ornare', 'jrgonpx', 'tbbx', 'genaal'].map(r13));

/*
 * Look-alikes: digits and symbols people use for letters to get round a
 * filter, folded back before the text is read ("sh1t", "f*ck", "a$$").
 */
const FOLD = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i', '|': 'i', '+': 't', '€': 'e', '£': 'l' };

/** Lower-case ASCII letters and spaces only, look-alikes folded, accents stripped, everything else dropped. */
export function fold(text) {
  let s = String(text || '').toLowerCase();
  try {
    s = s.normalize('NFKD');
  } catch (err) {
    /* an engine without normalize: the raw text is read */
  }
  let out = '';
  for (const ch of s) {
    if (ch >= 'a' && ch <= 'z') out += ch;
    else if (FOLD[ch]) out += FOLD[ch];
    else if (ch === ' ' || ch === '-' || ch === '_' || ch === '.' || ch === ',') out += ' ';
    // Anything else (a combining accent, a digit that is not a look-alike, punctuation) is dropped.
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Why `text` may not be shown: 'root' (contains a refused root), 'whole' (a refused word on its own), or null if it may. */
export function offends(text) {
  const f = fold(text);
  if (!f) return null;
  const joined = f.replace(/ /g, '');
  for (const r of ROOTS) if (joined.includes(r)) return 'root';
  // Repeated letters squeezed too ("shiiit"): a root hidden by stretching.
  const squeezed = joined.replace(/(.)\1+/g, '$1');
  for (const r of ROOTS) if (squeezed.includes(r)) return 'root';
  for (const w of f.split(' ')) if (WHOLE.includes(w)) return 'whole';
  return null;
}

/** { ok, why, text }: the text as it may be relayed (trimmed, at most `max` characters), or ok: false and why. */
export function cleanText(text, max = 120) {
  if (typeof text !== 'string') return { ok: false, why: 'type', text: '' };
  const t = text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  if (!t) return { ok: false, why: 'empty', text: '' };
  const why = offends(t);
  return why ? { ok: false, why, text: '' } : { ok: true, why: null, text: t };
}

/** The same, for a chat event: a preset index is always fine; text goes through the filter. */
export function cleanChat(ev, presetCount) {
  const m = Number(ev && ev.m);
  if (Number.isInteger(m) && m >= 0 && m < presetCount) return { ok: true, m };
  if (ev && typeof ev.text === 'string') {
    const c = cleanText(ev.text);
    return c.ok ? { ok: true, text: c.text } : { ok: false, why: c.why };
  }
  return { ok: false, why: 'preset' };
}

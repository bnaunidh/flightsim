/**
 * Browser checks for the hangar's redeem codes, in the page:
 *
 *   - the hangar still has its code box and Redeem button;
 *   - a made-up code typed into the box is answered "That code does not work"
 *     (the answer now arrives a moment later — the code is hashed first — so
 *     the box has to wait for it rather than read it straight back);
 *   - the shipped table holds only fingerprints, and crypto.subtle (this is a
 *     secure origin) and the plain-JavaScript fallback agree on them;
 *   - a test-only table pays out through the game's own redeem(), once.
 *
 * Nothing here types a real code: there are none in the game to type.
 */

export const id = 'redeem-codes';

export async function check(sim, r, say) {
  say && say('redeem codes');
  const Prog = await import('../../src/game/progression.js');
  const menus = sim && sim.menus;
  const box = menus && menus.screens && menus.screens.hangar;
  const input = box && box.querySelector('[data-code]');
  const msg = box && box.querySelector('[data-code-msg]');
  const button = box && box.querySelector('[data-redeem]');
  r.ok('redeem: the hangar has its code box, its message line and its Redeem button', !!input && !!msg && !!button);
  if (!input || !msg || !button) return;

  // A made-up code, through the real button.
  const before = Prog.load().credits;
  const was = msg.textContent;
  input.value = `nope-${Math.random().toString(36).slice(2, 10)}`;
  button.click();
  const sync = msg.textContent;
  for (let i = 0; i < 150 && msg.textContent === was; i++) await new Promise((res) => setTimeout(res, 20));
  r.ok('redeem: a made-up code is answered "That code does not work", a moment after the click',
    msg.textContent === 'That code does not work' && Prog.load().credits === before, `at once: "${sync}", then: "${msg.textContent}"`);
  input.value = '';
  msg.textContent = was;

  // The shipped table.
  const keys = Object.keys(Prog.CODES);
  r.ok('redeem: the shipped table is fingerprints only, frozen', keys.every(Prog.isCodeHash) && Object.isFrozen(Prog.CODES), `${keys.length} entries`);

  // crypto.subtle and the fallback agree, on this very origin.
  const word = `test-${Math.random().toString(36).slice(2)}`;
  const viaSubtle = await Prog.codeHash(word);
  const viaJs = Prog.sha256Hex(word.toLowerCase());
  r.ok('redeem: crypto.subtle and the plain-JavaScript SHA-256 give the same fingerprint',
    !!(globalThis.crypto && globalThis.crypto.subtle) && viaSubtle === viaJs && Prog.isCodeHash(viaSubtle));

  // A test-only table through the game's own redeem(); the wallet is a throwaway.
  const p = { credits: 10, earned: 10, best: [], unlocked: [], redeemed: [], grantedRank: null };
  const saveKey = 'islandsim.progression.v1';
  const keep = localStorage.getItem(saveKey);
  try {
    const table = { [viaSubtle]: { credits: 1234, note: 'For the test' } };
    const a = await Prog.redeem(p, word.toUpperCase(), table);
    const b = await Prog.redeem(p, word, table);
    r.ok('redeem: a test-only hash pays out once from the amount beside it, then is refused',
      a.ok && a.credits === 1234 && p.credits === 1244 && !b.ok && b.why === 'You have already used that one', JSON.stringify([a, b]));
    // A pattern code: a test-only PREFIX, then the amount typed after it.
    const prefix = `tp-${Math.random().toString(36).replace(/[0-9]/g, '').slice(2)}`;
    const prefixes = { [await Prog.codeHash(prefix)]: { note: 'Ask the CEO' } };
    const c = await Prog.redeem(p, `${prefix.toUpperCase()}1.5K`, table, prefixes);
    const d = await Prog.redeem(p, `${prefix}1500`, table, prefixes);
    const e = await Prog.redeem(p, `${prefix}1.255K`, table, prefixes);
    r.ok('redeem: PREFIX1.5K pays 1,500 once (PREFIX1500 is the same code), and 1.255K does not work',
      c.ok && c.credits === 1500 && c.note === 'Ask the CEO' && p.credits === 2744 && !d.ok && d.why === 'You have already used that one' && !e.ok && e.why === 'That code does not work', JSON.stringify([c, d, e]));
    r.ok('redeem: the shipped PREFIXES table is fingerprints only, frozen', Object.keys(Prog.PREFIXES).every(Prog.isCodeHash) && Object.isFrozen(Prog.PREFIXES));
  } finally {
    if (keep === null) localStorage.removeItem(saveKey); else localStorage.setItem(saveKey, keep);
  }
}

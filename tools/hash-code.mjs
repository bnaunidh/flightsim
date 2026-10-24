#!/usr/bin/env node
/**
 * Make the entry for a redeem code — without the code ever being written down.
 *
 *   node tools/hash-code.mjs
 *   node tools/hash-code.mjs --credits=2500 --note="For the class"
 *   node tools/hash-code.mjs --rank=mod --note="Appointed"
 *
 * It asks for the code word at the prompt (typing is not echoed, and the word
 * is never a command-line argument, so it does not land in the shell history),
 * then prints ONE line to paste into CODES in src/game/progression.js:
 *
 *   '<sha-256 of the trimmed, lower-cased word>': { credits: 2500, note: 'For the class' },
 *
 * The amount or rank sits beside the hash; nothing about the word is kept.
 * The hash is made by the game's own codeHash(), so what works here works in
 * the hangar's box — same trimming, same lower-casing.
 *
 * With stdin piped (`echo word | node tools/hash-code.mjs --credits=100`), the
 * first line of stdin is the word; the terminal prompt is only for a terminal.
 */
import { createInterface } from 'node:readline';
import { codeHash } from '../src/game/progression.js';

const args = process.argv.slice(2);
const opt = (k) => {
  const a = args.find((x) => x === `--${k}` || x.startsWith(`--${k}=`));
  if (!a) return null;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : '';
};
if (opt('help') !== null || args.includes('-h')) {
  console.log('node tools/hash-code.mjs [--credits=<n> | --rank=<founder|admin|mod>] [--note="..."]');
  process.exit(0);
}

const RANKS = ['founder', 'admin', 'mod'];

/** Ask one question; `hidden` keeps the typed text off the screen. */
function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    if (hidden && process.stdin.isTTY) {
      const write = rl._writeToOutput.bind(rl);
      rl._writeToOutput = (s) => {
        // Echo the prompt itself and newlines; swallow the typed characters.
        if (s.includes(question) || s === '\r\n' || s === '\n') write(s.includes(question) ? question : s);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden && process.stdin.isTTY) process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main() {
  const word = process.stdin.isTTY ? await ask('Code word (not shown as you type): ', { hidden: true }) : await ask('');
  const text = String(word || '').trim();
  if (!text) {
    console.error('No code typed. Nothing made.');
    process.exit(2);
  }
  if (/\s/.test(text)) console.error('Note: the word has spaces inside it; players will have to type them too.');

  let credits = opt('credits');
  let rank = opt('rank');
  if (credits === null && rank === null) {
    const what = (await ask('What it grants — a number of credits, or a rank (founder / admin / mod): ')).trim().toLowerCase();
    if (RANKS.includes(what)) rank = what;
    else credits = what;
  }
  let entry;
  if (rank !== null && rank !== '') {
    if (!RANKS.includes(rank)) {
      console.error(`Unknown rank "${rank}". One of: ${RANKS.join(', ')}.`);
      process.exit(2);
    }
    entry = { rank };
  } else {
    const n = Math.round(Number(String(credits).replace(/[,_\s]/g, '')));
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`"${credits}" is not a number of credits above zero.`);
      process.exit(2);
    }
    entry = { credits: n };
  }
  let note = opt('note');
  if (note === null) note = (await ask('Note shown when it is redeemed (e.g. "For the class"): ')).trim();
  note = String(note || '').trim() || 'Code accepted';

  const hash = await codeHash(text);
  const body = entry.rank
    ? `rank: '${entry.rank}', note: ${JSON.stringify(note).replace(/'/g, "\\'").replace(/^"|"$/g, "'")}`
    : `credits: ${entry.credits}, note: ${JSON.stringify(note).replace(/'/g, "\\'").replace(/^"|"$/g, "'")}`;
  console.log('\nPaste this line into CODES in src/game/progression.js:\n');
  console.log(`  '${hash}': { ${body} },`);
  console.log('\nThe word itself is not saved anywhere. Keep it somewhere private.');
}

main().catch((e) => {
  console.error(e && e.message ? e.message : e);
  process.exit(2);
});

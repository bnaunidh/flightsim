/**
 * Holiday decorations at the home field (the owner, 2026-11-01: "nov 1st its
 * time to get ready for christmas"): on by themselves Dec 1 - Jan 6 only, so
 * the Nov 4 class demo is untouched; steady lights (flash-safe); one Points draw.
 */
import { readFileSync } from 'node:fs';
const SRC = new URL('../../src/', import.meta.url).href;
let n = 0;
let fails = 0;
const ok = (name, pass, detail = '') => { n++; if (!pass) fails++; console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`); };
const src = readFileSync(new URL('../../src/features/festive.js', import.meta.url), 'utf8');
// The module draws with three.js; only its date rules are imported here, by evaluating them alone.
const rules = src.slice(src.indexOf('export const SEASON'), src.indexOf('function forcedByUrl'))
  .replace(/^export const TREE.*$/m, '').replace(/^const BULB_GAP[\s\S]*?^const BULB_COLOURS.*$/m, '').replace(/export /g, '');
const { inSeason, decorationsOn } = new Function(`${rules}; return { inSeason, decorationsOn };`)();
const d = (m, day) => new Date(2026, m - 1, day, 12);
ok('not up for the class demo (Nov 4)', !inSeason(d(11, 4)) && !decorationsOn('auto', d(11, 4)));
ok('not up on Nov 30', !inSeason(d(11, 30)));
ok('up on Dec 1, Christmas Day and New Year\'s Eve', inSeason(d(12, 1)) && inSeason(d(12, 25)) && inSeason(d(12, 31)));
ok('up on Jan 1 to Jan 6, down on Jan 7', inSeason(d(1, 1)) && inSeason(d(1, 6)) && !inSeason(d(1, 7)));
ok('"On" and "Off" beat the calendar', decorationsOn('on', d(7, 1)) && !decorationsOn('off', d(12, 25)));
ok('?festive=1 puts them up for a test', decorationsOn('off', d(7, 1), true));
ok('flash-safe: nothing in it animates the lights', !/requestAnimationFrame|Math\.sin\([^)]*time|opacity\s*=|\.size\s*=/.test(src.slice(src.indexOf('registerExtension'))));
ok('one Points draw for every bulb', (src.match(/new THREE\.Points\(/g) || []).length === 1);
const store = readFileSync(new URL('../../src/core/storage.js', import.meta.url), 'utf8');
ok("the setting defaults to 'auto'", /festive: 'auto'/.test(store));
const menus = readFileSync(new URL('../../src/ui/menus.js', import.meta.url), 'utf8');
ok('Settings → Graphics has the Holiday decorations picker (works by touch: a select)', /<select data-set="festive">/.test(menus));
const sw = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
ok('it is in the offline cache', /src\/features\/festive\.js/.test(sw));
console.log(`\nfestive: ${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

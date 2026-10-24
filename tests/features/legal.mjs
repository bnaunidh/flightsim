/**
 * Node checks for the legal lines.
 *
 *   node tests/features/legal.mjs
 *
 *   - LICENSE at the root: copyright thankdapro, use/copy/change with credit,
 *     not in Roblox games or as Roblox assets, three.js stays MIT;
 *   - the credits screen carries "© thankdapro", the inspiration line and the
 *     parody line, and no longer calls anything CC0;
 *   - the front page's footer carries "© thankdapro" and the parody line;
 *   - the README says the same as LICENSE.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
let fails = 0;
let n = 0;
const ok = (name, pass, detail) => {
  n++;
  if (!pass) fails++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const read = (p) => readFileSync(`${ROOT}${p}`, 'utf8');

const INSPIRED = 'Inspired by PTFS (Pilot Training Flight Simulator) and the Google Earth flight simulator.';
const PARODY = 'All airlines are parody and not affiliated with any real company.';

ok('LICENSE exists at the root', existsSync(`${ROOT}LICENSE`));
const lic = existsSync(`${ROOT}LICENSE`) ? read('LICENSE') : '';
ok('LICENSE: copyright thankdapro', /Copyright \(c\) [0-9–-]+ thankdapro/.test(lic));
ok('LICENSE: anyone may use, copy, change and build on it with credit to thankdapro', /copy it, share it, change it/.test(lic) && /give credit to thankdapro/.test(lic));
ok('LICENSE: not in Roblox games or as Roblox assets', /not use this game[\s\S]*in a Roblox game, as a Roblox asset/.test(lic) && /No exceptions/.test(lic));
ok('LICENSE: three.js stays MIT', /three\.js[\s\S]*MIT licence/.test(lic) && /three\.LICENSE/.test(lic));
ok('LICENSE: no warranty', /no warranty/i.test(lic));
ok('LICENSE: carries the inspiration and parody lines', lic.includes('Inspired by PTFS (Pilot Training Flight Simulator) and the Google Earth') && lic.includes('parody and not affiliated'));

const credits = read('src/ui/credits.js');
ok('credits screen: © thankdapro', /&copy; thankdapro/.test(credits));
ok('credits screen: the inspiration line, exactly', credits.includes(INSPIRED));
ok('credits screen: the parody line, exactly', credits.includes(PARODY));
ok('credits screen: with credit to thankdapro, not for Roblox, points at LICENSE', /with credit to thankdapro/.test(credits) && /Roblox/.test(credits) && /<code>LICENSE<\/code>/.test(credits));
ok('credits screen: nothing is called CC0 or public domain any more (the FAA references aside)',
  !/CC0/.test(credits) && (credits.match(/public domain/gi) || []).length === 2 && !/\(public domain\)/.test(credits));

const menus = read('src/ui/menus.js');
ok('front page footer: © thankdapro and the parody line', /data-copyright[^>]*>&copy; thankdapro/.test(menus) && menus.includes('All airlines are parody and not affiliated with any real company'));
const css = read('styles/main.css');
ok('the footer line has a style', /\.tiny\.copyright/.test(css));

const readme = read('README.md');
ok('README: © thankdapro, LICENSE link, credit, no Roblox, the two lines', /© thankdapro/.test(readme) && /\[`LICENSE`\]\(LICENSE\)/.test(readme) && /credit to thankdapro/.test(readme) && /Roblox/.test(readme) && /Inspired by PTFS/.test(readme) && /parody and not affiliated/.test(readme) && !/CC0/.test(readme));

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

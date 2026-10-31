/**
 * Node checks for the legal lines.
 *
 *   node tests/features/legal.mjs
 *
 *   - LICENSE at the root: copyright thankdapro, use/copy/change/share with
 *     credit and nothing else (the Roblox ban is gone — the owner, 2026-10-24:
 *     Roblox games and assets are allowed with credit), three.js stays MIT,
 *     and a section for the SCP Foundation content (CC BY-SA 3.0 by
 *     the SCP Wiki community, scpwiki.com);
 *   - the credits screen carries "© thankdapro", "You may copy the game —
 *     please give us credit (thankdapro)", the SCP line, the inspiration line
 *     and the parody line, and no longer calls anything CC0 or bans Roblox;
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
ok('LICENSE: anyone may use, copy, change, share and build on it with credit to thankdapro', /copy it, share it, change it/.test(lic) && /give credit[\s\S]{0,4}to thankdapro/.test(lic));
ok('LICENSE: credit is the only condition — Roblox games and assets are allowed, the old ban is gone', /Roblox or any other platform/.test(lic) && !/may not use this game/.test(lic) && !/No exceptions/.test(lic) && !/not[\s\S]{0,40}in a Roblox game/.test(lic));
ok('LICENSE: you may not claim it or drop the credit', /may not claim you made it/.test(lic) && /remove the credit to thankdapro/.test(lic));
ok('LICENSE: three.js stays MIT', /three\.js[\s\S]*MIT licence/.test(lic) && /three\.LICENSE/.test(lic));
ok('LICENSE: SCP Foundation content (the Site, the Class-D transfer) is CC BY-SA 3.0 by the SCP Wiki community', /SCP FOUNDATION CONTENT/.test(lic) && /Site-91 North/.test(lic) && /Class-D transfer/.test(lic) && !/none in the game yet/.test(lic) && /CC BY-SA 3\.0/.test(lic) && /scpwiki\.com/.test(lic) && /creativecommons\.org\/licenses\/by-sa\/3\.0/.test(lic));
ok('LICENSE: no warranty', /no warranty/i.test(lic));
ok('LICENSE: carries the inspiration and parody lines', lic.includes('Inspired by PTFS (Pilot Training Flight Simulator) and the Google Earth') && lic.includes('parody and not affiliated'));

const credits = read('src/ui/credits.js');
ok('credits screen: © thankdapro', /&copy; thankdapro/.test(credits));
ok('credits screen: the inspiration line, exactly', credits.includes(INSPIRED));
ok('credits screen: the parody line, exactly', credits.includes(PARODY));
ok('credits screen: "You may copy the game — please give us credit (thankdapro)", exactly', credits.includes('You may copy the game — please give us\n    credit (thankdapro)') || credits.includes('You may copy the game — please give us credit (thankdapro)'));
ok('credits screen: with credit to thankdapro, Roblox allowed (no "not" line), points at LICENSE', /with credit to thankdapro/.test(credits) && /in Roblox games and\s+assets too/.test(credits) && !/not<\/strong> be used in Roblox/.test(credits) && !/not for Roblox/.test(credits) && /<code>LICENSE<\/code>/.test(credits));
ok('credits screen: the SCP Foundation line — the Site and the transfer, CC BY-SA 3.0, the SCP Wiki community, scpwiki.com', /SCP Foundation-based content \(the Site on Nunatak Reach/.test(credits) && !/none yet/.test(credits) && /CC BY-SA 3\.0/.test(credits) && /SCP Wiki/.test(credits) && /href="https:\/\/scpwiki\.com"/.test(credits));
// Third-party assets that really are CC0 (the Poly Haven scenery) keep their credit rows;
// the rule is that the game itself is never called CC0 or public domain.
const creditsOwn = credits.replace(/<tr>[\s\S]*?<\/tr>/g, '').replace(/<h3>[^<]*models[^<]*<\/h3>/gi, '');
ok('credits screen: the game itself is not called CC0 or public domain (credited CC0 assets and the FAA references aside)',
  !/CC0/.test(creditsOwn) && (credits.match(/public domain/gi) || []).length === 2 && !/\(public domain\)/.test(credits));

const menus = read('src/ui/menus.js');
ok('front page footer: © thankdapro and the parody line', /data-copyright[^>]*>&copy; thankdapro/.test(menus) && menus.includes('All airlines are parody and not affiliated with any real company'));
const css = read('styles/main.css');
ok('the footer line has a style', /\.tiny\.copyright/.test(css));

const readme = read('README.md');
ok('README: © thankdapro, LICENSE link, credit, Roblox allowed, the SCP line, the two lines', /© thankdapro/.test(readme) && /\[`LICENSE`\]\(LICENSE\)/.test(readme) && /credit to thankdapro/.test(readme) && /in Roblox games and assets too/.test(readme) && !/\*\*not\*\* be used in Roblox/.test(readme) && /CC BY-SA 3\.0/.test(readme) && /scpwiki\.com/.test(readme) && /Inspired by PTFS/.test(readme) && /parody and not affiliated/.test(readme) && !/CC0/.test(readme));

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

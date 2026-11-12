/**
 * Node checks for the legal lines.
 *
 *   node tests/features/legal.mjs
 *
 *   - LICENSE at the root: copyright thankdapro, ALL RIGHTS RESERVED — not open
 *     source since 2026-11-11 (the owner: "can we not make it open source
 *     anymore"): free to play, show, record and stream; no copying, re-hosting,
 *     changing or building on it without permission; earlier versions keep
 *     their open licence; three.js stays MIT, the SCP Foundation content
 *     CC BY-SA 3.0 (the SCP Wiki community, scpwiki.com), the downloaded
 *     models CC BY 4.0 and the fonts OFL;
 *   - no Source ZIP: not on the main menu, not in the repo, not built;
 *   - the credits screen carries "© thankdapro", "All rights reserved", the SCP
 *     line, the inspiration line and the parody line, and no CC0 for the game;
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
ok('LICENSE: all rights reserved, not open source', /ALL RIGHTS RESERVED/.test(lic) && /not open source/.test(lic) && !/build your own\s+things from it/.test(lic));
ok('LICENSE: free to play, show, record and stream', /Play it, free/.test(lic) && /Record it, stream it/.test(lic));
ok('LICENSE: no copying, re-hosting, changing or building on it without permission; no claiming it', /may not copy, download to\s+re-host, change, sell, or re-publish/.test(lic) && /build your own game, mod, Roblox game or asset from it/.test(lic) && /may not claim you made it/.test(lic));
ok('LICENSE: earlier versions keep the open licence they came with', /EARLIER VERSIONS/.test(lic) && /11 November 2026/.test(lic));
ok('LICENSE: the downloaded models (CC BY 4.0) and fonts (OFL) keep their own licences', /CC BY 4\.0/.test(lic) && /Open Font Licence/.test(lic));
ok('no Source ZIP: not on the menu, not in the repo, not built', !/data-zip|Source ZIP/.test(read('src/ui/menus.js')) && !existsSync(`${ROOT}download/island-flight-sim-source.zip`) && !existsSync(`${ROOT}tools/build-source-zip.sh`));
ok('LICENSE: three.js stays MIT', /three\.js[\s\S]*MIT licence/.test(lic) && /three\.LICENSE/.test(lic));
ok('LICENSE: SCP Foundation content (the Site, the Class-D transfer) is CC BY-SA 3.0 by the SCP Wiki community', /SCP FOUNDATION CONTENT/.test(lic) && /Site-91 North/.test(lic) && /Class-D transfer/.test(lic) && !/none in the game yet/.test(lic) && /CC BY-SA 3\.0/.test(lic) && /scpwiki\.com/.test(lic) && /creativecommons\.org\/licenses\/by-sa\/3\.0/.test(lic));
ok('LICENSE: no warranty', /no warranty/i.test(lic));
ok('LICENSE: carries the inspiration and parody lines', lic.includes('Inspired by PTFS (Pilot Training Flight Simulator) and the Google Earth') && lic.includes('parody and not affiliated'));

const credits = read('src/ui/credits.js');
ok('credits screen: © thankdapro', /&copy; thankdapro/.test(credits));
ok('credits screen: the inspiration line, exactly', credits.includes(INSPIRED));
ok('credits screen: the parody line, exactly', credits.includes(PARODY));
ok('credits screen: all rights reserved — free to play, not to copy or build on', /All rights reserved/.test(credits) && /free to play/.test(credits) && /not to copy, re-host, change or build/.test(credits) && !/You may copy the game/.test(credits));
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
ok('README: © thankdapro, all rights reserved, LICENSE link, earlier versions, the SCP line, the two lines', /© thankdapro/.test(readme) && /All rights reserved/.test(readme) && /\[`LICENSE`\]\(LICENSE\)/.test(readme) && /keep the open licence/.test(readme) && /CC BY-SA 3\.0/.test(readme) && /scpwiki\.com/.test(readme) && /Inspired by PTFS/.test(readme) && /parody and not affiliated/.test(readme) && !/CC0/.test(readme));

console.log(`\n${n - fails}/${n} passed`);
process.exit(fails ? 1 : 0);

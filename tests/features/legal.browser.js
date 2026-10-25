/**
 * Browser checks for the legal lines, in the built menus:
 *
 *   - the front page's footer shows "© thankdapro" and the parody line;
 *   - the Credits & licences screen shows "© thankdapro", "You may copy the
 *     game — please give us credit (thankdapro)", the SCP Foundation line
 *     (CC BY-SA 3.0, the SCP Wiki community), the inspiration line and the
 *     parody line, word for word; nothing on it is CC0 and nothing bans Roblox;
 *   - the footer line does not push the page sideways.
 */

export const id = 'legal';

export async function check(sim, r, say) {
  say && say('legal lines');
  const menus = sim && sim.menus;
  if (!menus || !menus.screens) {
    r.ok('legal: the menus exist to be checked', false, 'sim.menus missing');
    return;
  }
  const main = menus.screens.main;
  const foot = main && main.querySelector('[data-copyright]');
  r.ok('legal: the front page footer says © thankdapro and that the airlines are parody',
    !!foot && /© thankdapro/.test(foot.textContent) && /All airlines are parody and not affiliated with any real company/.test(foot.textContent),
    foot ? foot.textContent : 'no footer line');
  r.ok('legal: nothing on the front page scrolls sideways', !!main && main.scrollWidth <= main.clientWidth + 1, main ? `${main.scrollWidth} > ${main.clientWidth}` : '');

  const credits = menus.screens.credits;
  const text = credits ? credits.textContent : '';
  r.ok('legal: the credits screen says © thankdapro', /© thankdapro/.test(text));
  r.ok('legal: the credits screen carries the inspiration line, exactly', text.includes('Inspired by PTFS (Pilot Training Flight Simulator) and the Google Earth flight simulator.'));
  r.ok('legal: the credits screen carries the parody line, exactly', text.includes('All airlines are parody and not affiliated with any real company.'));
  r.ok('legal: the credits screen names the licence terms — credit thankdapro, Roblox allowed, LICENSE', /with credit to thankdapro/.test(text) && /in Roblox games and\s+assets too/.test(text) && !/not be used in Roblox/.test(text) && !/not for Roblox/.test(text) && /LICENSE/.test(text));
  r.ok('legal: the credits screen says you may copy the game and asks for credit, exactly', /You may copy the game — please give us\s+credit \(thankdapro\)\./.test(text));
  r.ok('legal: the credits screen carries the SCP Foundation line — the Site and the transfer, CC BY-SA 3.0, the SCP Wiki community', /SCP Foundation-based content \(the Site on Nunatak Reach/.test(text) && /CC BY-SA 3\.0/.test(text) && /SCP Wiki/.test(text) && /scpwiki\.com/.test(text));
  r.ok('legal: nothing on the credits screen is called CC0 any more', !/CC0/.test(text));
}

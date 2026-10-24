/**
 * Browser checks for the legal lines, in the built menus:
 *
 *   - the front page's footer shows "© thankdapro" and the parody line;
 *   - the Credits & licences screen shows "© thankdapro", the inspiration
 *     line and the parody line, word for word, and nothing on it is CC0;
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
  r.ok('legal: the credits screen names the licence terms — credit thankdapro, not for Roblox', /with credit to thankdapro/.test(text) && /Roblox/.test(text) && /LICENSE/.test(text));
  r.ok('legal: nothing on the credits screen is called CC0 any more', !/CC0/.test(text));
}

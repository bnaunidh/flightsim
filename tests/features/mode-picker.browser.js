/**
 * Browser checks for the class-demo game switch (src/ui/shown-games.js), in
 * the built menus:
 *
 *   - the bar offers exactly the games the switch allows (the aeroplane and
 *     the helicopter), in that order, and no Rocket button;
 *   - the More screen's "other games" has no boat or car card, and no rocket;
 *   - the hangar's list of games has none either;
 *   - the hidden games still exist: switchGame('boat') still goes to the
 *     boat's front page and back, so nothing was deleted.
 *
 * With the switch off, the same checks expect all four (plus the rocket where
 * it is live) — the test follows the flag, not a hard-coded list.
 */

export const id = 'mode-picker';

export async function check(sim, r, say) {
  say && say('mode picker');
  const S = await import('../../src/ui/shown-games.js');
  const menus = sim && sim.menus;
  if (!menus || !menus.bar || !menus.screens) {
    r.ok('mode picker: the menus exist to be checked', false, 'sim.menus missing');
    return;
  }
  const want = ['flight', 'heli', 'boat', 'car'].filter(S.gameShown);
  const bar = [...menus.bar.querySelectorAll('.switcher [data-game]')].map((b) => b.dataset.game);
  const extras = bar.filter((g) => !S.gameShown(g));
  r.ok(`mode picker: the bar offers ${want.join(' + ')} and nothing else`,
    want.every((g, i) => bar[i] === g) && extras.length === 0, bar.join(' '));
  r.ok('mode picker: no Rocket button unless the switch allows it', !!menus.bar.querySelector('[data-game="rocket"]') === S.gameShown('rocket'));

  const more = menus.screens.more;
  const moreCards = more ? [...more.querySelectorAll('[data-more-games] [data-drive]')].map((b) => b.dataset.drive) : null;
  r.ok('mode picker: More lists only the drives on offer',
    !!moreCards && moreCards.every(S.gameShown) && (S.gameShown('boat') ? moreCards.includes('boat') : !moreCards.includes('boat')),
    moreCards ? `drives: ${moreCards.join(' ') || 'none'}` : 'no More screen');
  r.ok('mode picker: More still has the helicopter card', !!more && !!more.querySelector('[data-more-games] [data-pick]'));
  r.ok('mode picker: no Rocket card on More unless the switch allows it', !!(more && more.querySelector('[data-rk-more]')) === S.gameShown('rocket'));

  const hangar = menus.screens.hangar;
  const hangarDrives = hangar ? [...hangar.querySelectorAll('[data-games] [data-drive]')].map((b) => b.dataset.drive) : null;
  r.ok('mode picker: the hangar lists only the drives on offer',
    !!hangarDrives && hangarDrives.every(S.gameShown) && (S.gameShown('car') ? hangarDrives.includes('car') : !hangarDrives.includes('car')),
    hangarDrives ? `drives: ${hangarDrives.join(' ') || 'none'}` : 'no hangar');
  r.ok('mode picker: the hangar still says which game this is', !!hangar && !!hangar.querySelector('[data-games] .is-here'));

  // Hidden, not deleted: the boat's front page is still there behind switchGame().
  const g0 = menus.currentGame || 'flight';
  let boat = null;
  try {
    await sim.switchGame('boat');
    boat = { game: menus.currentGame, screen: menus.current, state: sim.state };
  } finally {
    await sim.switchGame(g0 === 'boat' ? 'flight' : g0);
  }
  r.ok('mode picker: the boat still exists behind switchGame — hidden, not deleted',
    !!boat && boat.game === 'boat' && boat.state === 'menu' && menus.currentGame !== 'boat', JSON.stringify(boat));
}

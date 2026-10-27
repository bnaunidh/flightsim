/**
 * Browser checks for the two editions (src/core/edition.js), in the built menus.
 *
 * The owner: "remove tpose harrison and air massimo from thankdapro.github".
 * On the thankdapro copy (or any copy opened with ?edition=thankdapro) no
 * screen the menus have built shows T-Pose Harrison or Air Massimo — no card,
 * no tile, no name, no key — and neither is the aeroplane the game flies.
 * On every other copy (bnaunidh.github.io, localhost) both are still there.
 * tests/features/edition.mjs covers the lists themselves, per address.
 */

import { EDITION, HIDDEN_AIRCRAFT } from '../../src/core/edition.js';
import { AIRCRAFT } from '../../src/aircraft/types.js';
import { ACTIONS } from '../../src/flight/input.js';

export const id = 'edition';

const NAMES = /Air Massimo|T-Pose Harrison|Harrison-ify|Mach Massimo|Floats Like Harrison/;

export async function check(sim, r, say) {
  say && say(`edition: ${EDITION}`);
  const menus = sim && sim.menus;
  if (!menus || !menus.screens) {
    r.ok('edition: the menus exist to be checked', false, 'sim.menus missing');
    return;
  }
  const host = (menus.layer && menus.layer.ownerDocument) || document;
  const cards = (id) => host.querySelectorAll(`[data-aircraft="${id}"], [data-hs-pick="${id}"], [data-fleet-art="${id}"]`).length;
  const screens = Object.entries(menus.screens).filter(([, el]) => el && el.textContent);
  const named = screens.filter(([, el]) => NAMES.test(el.textContent)).map(([k]) => k);

  if (EDITION === 'thankdapro') {
    r.ok('edition: thankdapro hides exactly T-Pose Harrison and Air Massimo', [...HIDDEN_AIRCRAFT].sort().join() === 'massimo,tpose');
    r.ok('edition: neither is in the roster the page loaded', !AIRCRAFT.some((a) => HIDDEN_AIRCRAFT.has(a.id)));
    r.ok('edition: no card, tile or picture of either anywhere in the menus', cards('tpose') + cards('massimo') === 0, `${cards('tpose')} + ${cards('massimo')}`);
    r.ok('edition: no built screen names either', !named.length, named.join(', '));
    r.ok('edition: no Harrison keys and no drag chute key', !ACTIONS.harrisonSpin && !ACTIONS.harrisonBoost && !ACTIONS.dragChute);
    const flying = sim.aircraftType && sim.aircraftType.id;
    r.ok('edition: the aeroplane the game holds is not one of them', !HIDDEN_AIRCRAFT.has(flying) && !HIDDEN_AIRCRAFT.has(menus.chosenAircraft), `${flying} / ${menus.chosenAircraft}`);
  } else {
    r.ok('edition: the full edition hides nothing', HIDDEN_AIRCRAFT.size === 0, [...HIDDEN_AIRCRAFT].join());
    r.ok('edition: both are in the roster', AIRCRAFT.some((a) => a.id === 'tpose') && AIRCRAFT.some((a) => a.id === 'massimo'));
    r.ok('edition: both have a card on the Free Flight screen', !!menus.screens.free && !!menus.screens.free.querySelector('[data-aircraft="tpose"]') && !!menus.screens.free.querySelector('[data-aircraft="massimo"]'));
    r.ok('edition: Harrison\'s keys and the drag chute key are there', !!ACTIONS.harrisonSpin && !!ACTIONS.harrisonBoost && !!ACTIONS.dragChute);
  }
}

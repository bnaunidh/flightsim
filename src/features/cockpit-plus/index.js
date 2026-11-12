/**
 * COCKPITS PLUS (the owner: "improve cockpits a lot"). Loaded the first time
 * the player sits in a cockpit (features/cockpit-dress.js imports it then),
 * never in the first-load bundle, and it only ever touches the cockpit in view.
 *
 *   pilot    your legs on the pedals and your hands on the stick, the wheel,
 *            the throttle or the collective, moving with them (pilot.js)
 *   bezels   the round instruments stand out of the panel: bezel, case screws,
 *            and a cover glass that reflects the sky as the head moves (bezels.js)
 *   night    the cabin goes dark under its roof at night; the panel's lighting
 *            and the flood lights over the panel and consoles carry it (night.js)
 *
 * Cost: on Low the pilot (fewer sides) and the bezels, 2 draws; elsewhere 3.
 * Per frame: the pilot's bones (a few dozen matrix sums), nothing uploaded.
 */
import { buildPilot } from './pilot.js';
import { fitBezels } from './bezels.js';
import { nightLight } from './night.js';

export function plus(cp, sim, { fill = [], fillLevel = () => 0, low = false } = {}) {
  const ud = cp.userData;
  const fam = ud.family;
  const made = { draws: 0, pilot: null, bezels: [], night: null };
  if (!fam || fam === 'none') return made;
  try {
    made.pilot = buildPilot(cp, fam, { low });
  } catch (e) {
    console.warn('[cockpit-plus] no pilot', e);
  }
  if (made.pilot) made.draws++;
  made.bezels = fitBezels(ud.panel, { low });
  made.draws += made.bezels.length;
  made.night = nightLight(cp, fam, fill);
  const inner = ud.update;
  let dt0 = 0;
  ud.update = (dt, ac, weather, s, ...rest) => {
    inner(dt, ac, weather, s, ...rest);
    dt0 = dt;
    const game = s || sim;
    if (made.pilot) made.pilot.update(dt, !!(game && game.rig && game.rig.realisticCockpit));
    made.night.update(weather, fillLevel(weather), dt0);
  };
  ud.plus = made;
  return made;
}

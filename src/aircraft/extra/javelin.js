/**
 * The Nullspire Javelin: the secret aeroplane parked on the hidden city's
 * ramp, a hundred kilometres out in the void (worldmap/void-city.js). The
 * owner, 2026-11-08: "add a secret aircraft there", "make the secret plane
 * super fast like mach 5".
 *
 * NOT IN THE ROSTER UNTIL FOUND. The other secret planes (./secret.js) are in
 * AIRCRAFT from the start and the Hangar draws them as silhouettes; this one
 * must appear nowhere until you have it, so it is a module nothing in the
 * first load imports. registerJavelin() puts it into AIRCRAFT: called by
 * features/secrets.js at load when progression says it is yours, and by
 * features/farlands-run.js the moment you earn it (a landing at Nullspire,
 * or walking up to it on the ramp). Every test that walks AIRCRAFT sees the
 * roster it always saw (fighters.mjs: Massimo stays the fastest thing in the
 * shop; this is not in the shop).
 *
 * WHAT IT IS. A version of the Massimo racer (the same airframe drawn, seated
 * and sounded), in the city's own paint, with a scramjet's law in place of
 * the burners: ./reheat.js's jet law with a bigger ram term, a red line of
 * 490 m/s indicated and a ceiling of 120,000 ft, so from Mach 2.4 at 20 km
 * (65,000 ft, under the 70,000 ft top of the sky) it is at Mach 5 in forty
 * seconds and the inlets' wall holds it there (measured: 5.18). Low and slow
 * it is a Massimo: it lands on Nullspire's 3,600 m like one.
 */
import { AIRCRAFT, getAircraft } from '../types.js';

export const JAVELIN_ID = 'javelin';
export const BASE_ID = 'massimo';

/** The scramjet's law (./reheat.js PROFILES' shape): Mach 5 at 26 km, the inlets' wall just over it. */
export const JAVELIN_REHEAT = Object.freeze({ mach: 5.0, alt: 20000, ram: 1.0, mdd: 0.93, wave: 0.008, choke: 5.1 });

/** The type, from the roster's Massimo. Null if there is no Massimo (there always is). */
export function javelinType() {
  const b = AIRCRAFT.find((t) => t.id === BASE_ID);
  if (!b) return null;
  return {
    ...b,
    id: JAVELIN_ID,
    variantOf: b.id,
    name: 'Nullspire Javelin',
    class: 'Hypersonic',
    category: 'special',
    blurb:
      'The one aeroplane that belongs to the city in the void. A racer’s airframe round a scramjet: at 85,000 ft it ' +
      'holds Mach 5 and the sky goes black. Low and slow it is a Massimo, and lands like one.',
    stats: { speed: 5, handling: 3, ease: 1 },
    livery: '#10131a',
    accent: '#ffb04a',
    callsign: 'Javelin one',
    secret: { how: 'found', hint: 'Parked at the city in the void, 100 km past the edge of the world' },
    shape: b.shape,
    aero: {
      ...b.aero,
      thrustMax: b.aero.thrustMax * 0.9,
      vne: 490,
      ceiling: 120000,
      fuelCapacity: b.aero.fuelCapacity * 1.6,
      // The scramjet, read by physics.js applyAircraft in place of ./reheat.js's table.
      reheat: JAVELIN_REHEAT,
    },
    buildModel: undefined,
  };
}

/** Put it in the roster, once. Returns the type, or null. */
export function registerJavelin() {
  const have = AIRCRAFT.find((t) => t.id === JAVELIN_ID);
  if (have) return have;
  const t = javelinType();
  if (!t) return null;
  delete t.buildModel;
  AIRCRAFT.push(t);
  return t;
}

/** Is it in the roster now? */
export function javelinRegistered() {
  return !!getAircraft && AIRCRAFT.some((t) => t.id === JAVELIN_ID);
}

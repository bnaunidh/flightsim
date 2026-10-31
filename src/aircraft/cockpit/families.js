/**
 * Which cockpit each aeroplane gets.
 *
 * Every type belongs to one family — the kind of room the pilot sits in — and
 * each family has (or will have) one builder:
 *
 *   light     steam gauges, yokes, throttle / mixture, side windows
 *             (skylark, courier, tempest)
 *   airliner  glass flight deck, overhead panel, side-sticks or yokes
 *             (meridian, a320, b747, a380)
 *   jet       bubble canopy, HUD, MFDs, centre or side stick
 *             (vanguard, osprey, nightjar, f22, f35b, fa18)
 *   racer     Air Massimo's race cockpit
 *   heli      the helicopter: collective, cyclic, chin bubble (harrier)
 *   none      T-Pose Harrison, whose view is from his own head: no room,
 *             a visor readout and his arms (harrison.js; eject.js hides
 *             his head from inside)
 *
 * A family with no builder registered gets the generic cockpit (generic.js),
 * which is exactly the one every aeroplane had before — so adding a family is
 * one new file plus one registerCockpitBuilder() call, and nothing else
 * changes for anyone until it lands.
 */

/** By type id. The roster's own ids, so a test can check every type is here. */
export const FAMILY = Object.freeze({
  skylark: 'light',
  courier: 'light',
  tempest: 'light',
  meridian: 'airliner',
  a320: 'airliner',
  b747: 'airliner',
  a380: 'airliner',
  vanguard: 'jet',
  osprey: 'jet',
  nightjar: 'jet',
  f22: 'jet',
  f35b: 'jet',
  fa18: 'jet',
  massimo: 'racer',
  harrier: 'heli',
  tpose: 'none',
  // The fleet added after v67 (jets.js, giants.js, c17.js, lancer.js,
  // attack.js, extra/helis.js). Each airliner publishes its flight-deck
  // outline through dressAirliner, so the airliner room fits every one.
  b737: 'airliner',
  a321: 'airliner',
  b787: 'airliner',
  a350: 'airliner',
  b777: 'airliner',
  q400: 'airliner',
  concorde: 'airliner',
  belugaxl: 'airliner',
  dreamlifter: 'airliner',
  an225: 'airliner',
  c5: 'airliner',
  c17: 'airliner',
  b1b: 'airliner', // a side-by-side deck on centre sticks: the flight-deck room
  a10: 'jet',
  bell407: 'heli',
  h145: 'heli',
  r44: 'heli',
  aw139: 'heli',
  uh60: 'heli',
  ch47: 'heli',
  ah64: 'heli',
  vh3d: 'heli',
});

/** For an aeroplane added later and not listed above: guess from its class. */
const BY_CLASS = Object.freeze({
  trainer: 'light',
  tourer: 'light',
  airliner: 'airliner',
  fighter: 'jet',
  carrier: 'jet',
  racer: 'racer',
  helicopter: 'heli',
});

export function cockpitFamily(type) {
  if (!type) return 'light';
  if (FAMILY[type.id]) return FAMILY[type.id];
  const byClass = BY_CLASS[String(type.class || '').toLowerCase()];
  if (byClass) return byClass;
  // A rotor is a helicopter whatever its class says.
  if (type.shape && type.shape.power && type.shape.power.rotor) return 'heli';
  return 'light';
}

const builders = new Map();

/**
 * Register the builder for a family. `build(ctx)` returns the cockpit Group
 * (see README.md for the contract); `opts.types`, if given, limits it to those
 * type ids — a family can be rolled out a type at a time.
 */
export function registerCockpitBuilder(family, build, opts = {}) {
  builders.set(family, { family, build, types: opts.types ? new Set(opts.types) : null, name: opts.name || family });
}

/** The builder for this type, or null for "use the generic cockpit". */
export function builderFor(type) {
  const fam = cockpitFamily(type);
  const b = builders.get(fam);
  if (!b) return null;
  if (b.types && !(type && b.types.has(type.id))) return null;
  return b;
}

/** For tests and the console: which families have builders. */
export const registeredFamilies = () => [...builders.keys()];
